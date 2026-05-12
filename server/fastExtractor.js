import ExcelJS from 'exceljs';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { promisify } from 'util';
import xml2js from 'xml2js';
import { fileURLToPath } from 'url';
import axios from 'axios';
import FormData from 'form-data';
import { uploadToSupabase, supabase } from './utils/supabaseStorage.js';
import { convertEmfToPng } from './utils/emfConverter.js';
import { extractLegacyExcelData } from './legacyExtractor.js';
import { convertXlsToXlsx } from './utils/xlsToXlsxConverter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
const parseString = promisify(parser.parseString);

// Header patterns for BOQ detection (Must match at least 2 to be considered a table)
const BOQ_HEADER_KEYWORDS = [/description|desc/i, /qty|quantity/i, /unit/i, /rate|price/i, /amount|total/i, /image|photo/i, /sn|s\.n|no\.|item/i];

/**
 * Fast extraction using Stream Reader + Direct Zip Access for images
 * Reduces memory usage by 90% compared to standard generic extraction
 */
async function extractExcelData(filePath, progressCallback = () => { }, onBlobCreated = null) {
    // Verify file existence before processing
    try {
        await fs.access(filePath);

        // Attempt to open the file to check for legacy formats
        let fd;
        try {
            fd = await fs.open(filePath, 'r');
        } catch (openErr) {
            console.error(`[FastExtractor] Failed to open file at ${filePath}:`, openErr);
            throw new Error(`Could not open Excel file for reading. It may be locked or removed.`);
        }

        const buffer = Buffer.alloc(8);
        await fd.read(buffer, 0, 8, 0);
        await fd.close();

        // CFBF signature: D0 CF 11 E0 A1 B1 1A E1
        if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) {
            console.log(`[FastExtractor] Legacy .xls detected. Attempting high-fidelity conversion...`);
            try {
                const convertedPath = await convertXlsToXlsx(filePath);
                // Recursively call with the new .xlsx path to get full image support
                return await extractExcelData(convertedPath, progressCallback, onBlobCreated);
            } catch (convErr) {
                console.warn(`[FastExtractor] High-fidelity conversion failed, falling back to basic extractor:`, convErr.message);
                return await extractLegacyExcelData(filePath);
            }
        }
    } catch (err) {
        if (err.message.includes(".xls") || err.message.includes("LegacyExtractor") || err.message.includes("XlsConverter")) throw err;
        throw new Error(`Excel file not found at path: ${filePath}. It may have been cleaned up or upload failed.`);
    }

    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
        sharedStrings: 'cache',
        hyperlinks: 'ignore',
        styles: 'ignore',
        worksheets: 'emit'
    });

    const isVercel = process.env.VERCEL === '1';
    const imagesDir = isVercel ? '/tmp/uploads/images' : path.join(__dirname, '../uploads/images');

    // Ensure both base uploads and images directory exist
    await fs.mkdir(path.dirname(imagesDir), { recursive: true });
    await fs.mkdir(imagesDir, { recursive: true });

    // Extract all images first
    const imageMap = await extractImagesAndMap(filePath, imagesDir, onBlobCreated);
    console.log(`[Extracted Images] Total found: ${imageMap.length}`);
    if (imageMap.length > 0) {
        console.log(`[Image Sample] Sheet: ${imageMap[0].sheetIndex}, Row: ${imageMap[0].row}, Col: ${imageMap[0].col}`);
    }

    // Stitching State
    let unifiedHeader = null;
    let unifiedRows = [];
    let sheetCount = 0;

    for await (const worksheetReader of workbookReader) {
        sheetCount++;
        // Use ID if available, otherwise fallback to order, but log strictly
        const wsId = worksheetReader.id;
        console.log(`[Processing Sheet] Name: ${worksheetReader.name}, ID: ${wsId}, Order: ${sheetCount}`);

        // IMPORTANT: We need to match the logic used in extractImagesAndMap
        // If that used internal sheetId, we must ensure we use the same here.
        // For now, pass both to be safe or debug which one matches.

        // Process sheet
        try {
            const result = await processWorksheetStream(worksheetReader, imageMap, wsId);

            if (result && result.rows.length > 0) {
                // Valid table found
                if (!unifiedHeader) {
                    // First valid table defines the structure
                    unifiedHeader = result.header;
                    unifiedRows.push(...result.rows);
                } else {
                    // Subsequent tables: Append rows only
                    unifiedRows.push(...result.rows);
                }
            }
        } catch (err) {
            console.error(`[Stitching] CRITICAL ERROR processing sheet ${worksheetReader.name || wsId}:`, err);
        }

        progressCallback(50 + (sheetCount * 5));
    }

    // Return single stitched table
    const finalTable = unifiedHeader ? [{
        sheetName: "BOQ Schedule",
        rows: unifiedRows,
        columnCount: unifiedHeader.length,
        header: unifiedHeader
    }] : [];

    return {
        tables: finalTable,
        totalTables: finalTable.length
    };
}

async function extractImagesAndMap(filePath, imagesDir, onBlobCreated = null) {
    const imageLocations = []; // Array of { row, col, sheetId, imagePath }

    try {
        // Double check imagesDir exists for this process
        if (!fsSync.existsSync(imagesDir)) {
            fsSync.mkdirSync(imagesDir, { recursive: true });
        }

        console.log(`[FastExtractor] Opening zip file: ${filePath}`);
        if (!fsSync.existsSync(filePath)) {
            throw new Error(`ZIP source file missing: ${filePath}`);
        }

        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();

        // 1. Extract all media files
        const mediaEntries = zipEntries.filter(entry => entry.entryName.match(/^xl[\\\/]media[\\\/]/i));
        const savedImages = {};
        const timestamp = Date.now();
        console.log(`[FastExtractor] Found ${mediaEntries.length} media files to process.`);

        // Process in small batches to avoid timeouts/rate limits
        const BATCH_SIZE = 5;
        console.log(`[FastExtractor] Env Check - Supabase: ${!!supabase}, Railway: ${!!process.env.JS_SCRAPER_SERVICE_URL}`);

        for (let i = 0; i < mediaEntries.length; i += BATCH_SIZE) {
            const batch = mediaEntries.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (entry) => {
                const fileName = path.basename(entry.entryName);
                let data = entry.getData();
                let currentFileName = fileName;

                // Handle EMF support: Convert to PNG early so it works for cloud storage too
                if (fileName.toLowerCase().match(/\.(emf|wmf)$/)) {
                    console.log(`[FastExtractor] Detected EMF/WMF: ${fileName}. Converting to PNG...`);
                    const timestamp = Date.now();
                    const tempInputPath = path.join(imagesDir, `temp_${timestamp}_${fileName}`);

                    try {
                        // Ensure imagesDir exists
                        if (!fsSync.existsSync(imagesDir)) {
                            fsSync.mkdirSync(imagesDir, { recursive: true });
                        }

                        fsSync.writeFileSync(tempInputPath, data);
                        const pngPath = await convertEmfToPng(tempInputPath);

                        if (pngPath && fsSync.existsSync(pngPath)) {
                            data = fsSync.readFileSync(pngPath);
                            currentFileName = path.basename(pngPath).replace(/^temp_/, '');
                            console.log(`[FastExtractor] Successfully converted ${fileName} to ${currentFileName}`);

                            // Cleanup temp files
                            try {
                                fsSync.unlinkSync(tempInputPath);
                                fsSync.unlinkSync(pngPath);
                            } catch (e) { }
                        } else {
                            console.warn(`[FastExtractor] EMF conversion failed for ${fileName}. Using original.`);
                            try { if (fsSync.existsSync(tempInputPath)) fsSync.unlinkSync(tempInputPath); } catch (e) { }
                        }
                    } catch (err) {
                        console.error(`[FastExtractor] Error during EMF conversion for ${fileName}:`, err);
                    }
                }

                // Cloud Storage Strategy
                try {
                    let directUrl = null;

                    // Option 0: Supabase (Our own managed storage)
                    const bucketName = 'assets';
                    const supabasePath = `extracted-images/${timestamp}_${currentFileName}`;

                    if (supabase) {
                        console.log(`[FastExtractor] Attempting Supabase upload for ${currentFileName} to bucket "${bucketName}"...`);
                        try {
                            const { url, path: uploadedPath } = await uploadToSupabase(
                                bucketName,
                                supabasePath,
                                data,
                                {
                                    contentType: currentFileName.toLowerCase().endsWith('.png') ? 'image/png' :
                                        currentFileName.toLowerCase().endsWith('.jpg') || currentFileName.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' :
                                            'application/octet-stream',
                                    cacheControl: '3600'
                                }
                            );

                            if (url) {
                                directUrl = url;
                                console.log(`[FastExtractor] Supabase upload success: ${directUrl}`);
                                if (onBlobCreated) onBlobCreated({ url: directUrl, path: uploadedPath, bucket: bucketName });
                            }
                        } catch (supabaseErr) {
                            console.error(`[FastExtractor] Supabase upload failed for ${currentFileName}:`, supabaseErr.message);
                            // Continue to next provider
                        }
                    } else {
                        console.warn(`[FastExtractor] Supabase client not initialized, skipping upload.`);
                    }

                    // Option 0.5: Railway Sidecar (Persistent fallback for Vercel)
                    if (!directUrl && process.env.JS_SCRAPER_SERVICE_URL) {
                        try {
                            console.log(`[FastExtractor] Attempting Railway sidecar upload for ${currentFileName}...`);
                            const response = await axios.post(`${process.env.JS_SCRAPER_SERVICE_URL}/upload-media`, {
                                image: data.toString('base64'),
                                filename: currentFileName
                            }, { timeout: 15000 });
                            // ... existing code ...
                            // Ensure both base uploads and images directory exist
                            await fs.mkdir(path.dirname(imagesDir), { recursive: true });
                            await fs.mkdir(imagesDir, { recursive: true });

                            progressCallback(5); // Initialized

                            // Extract all images first
                            const { imageMap, totalSheets } = await extractImagesAndMap(filePath, imagesDir, onBlobCreated, progressCallback);
                            console.log(`[Extracted Images] Total found: ${imageMap.length}`);
                            if (imageMap.length > 0) {
                                // ... existing code ...
                                try {
                                    const result = await processWorksheetStream(worksheetReader, imageMap, wsId);

                                    if (result && result.rows.length > 0) {
                                        // Valid table found
                                        if (!unifiedHeader) {
                                            // First valid table defines the structure
                                            unifiedHeader = result.header;
                                            unifiedRows.push(...result.rows);
                                        } else {
                                            // Subsequent tables: Append rows only
                                            unifiedRows.push(...result.rows);
                                        }
                                    }
                                } catch (err) {
                                    console.error(`[Stitching] CRITICAL ERROR processing sheet ${worksheetReader.name || wsId}:`, err);
                                }

                                if (totalSheets > 0) {
                                    const sheetProgress = 50 + (sheetCount / totalSheets) * 45;
                                    progressCallback(Math.min(sheetProgress, 95));
                                } else {
                                    progressCallback(50 + (sheetCount * 5));
                                }
                            }

                            // Return single stitched table
                            const finalTable = unifiedHeader ? [{
                                sheetName: "BOQ Schedule",
                                rows: unifiedRows,
                                columnCount: unifiedHeader.length,
                                header: unifiedHeader
                            }] : [];

                            progressCallback(100);
                            return {
                                tables: finalTable,
                                totalTables: finalTable.length
                            };
                        }

async function extractImagesAndMap(filePath, imagesDir, onBlobCreated = null, progressCallback = null) {
                            const imageLocations = []; // Array of { row, col, sheetId, imagePath }

                            try {
                                // Double check imagesDir exists for this process
                                if (!fsSync.existsSync(imagesDir)) {
                                    fsSync.mkdirSync(imagesDir, { recursive: true });
                                }

                                console.log(`[FastExtractor] Opening zip file: ${filePath}`);
                                if (!fsSync.existsSync(filePath)) {
                                    throw new Error(`ZIP source file missing: ${filePath}`);
                                }

                                const zip = new AdmZip(filePath);
                                const zipEntries = zip.getEntries();

                                // Pre-parse workbook to get sheet count and prepare mapping for later
                                const wbRelsEntry = zipEntries.find(e => e.entryName === 'xl/_rels/workbook.xml.rels');
                                const wbEntry = zipEntries.find(e => e.entryName === 'xl/workbook.xml');
                                const fileToSheetId = {};
                                let totalSheets = 0;

                                if (wbRelsEntry && wbEntry) {
                                    const relsXml = wbRelsEntry.getData().toString('utf8');
                                    const relsResult = await parseString(relsXml);
                                    const rels = relsResult.Relationships?.Relationship;
                                    const rIdToTarget = {};
                                    if (rels) {
                                        (Array.isArray(rels) ? rels : [rels]).forEach(r => {
                                            rIdToTarget[r.Id] = r.Target;
                                        });
                                    }

                                    const wbXml = wbEntry.getData().toString('utf8');
                                    const wbResult = await parseString(wbXml);
                                    const sheets = wbResult.workbook?.sheets?.sheet;
                                    if (sheets) {
                                        totalSheets = Array.isArray(sheets) ? sheets.length : 1;
                                        (Array.isArray(sheets) ? sheets : [sheets]).forEach(s => {
                                            const rId = s['r:id'];
                                            const sheetId = parseInt(s.sheetId);
                                            const target = rIdToTarget[rId];
                                            if (target) {
                                                let normalizedTarget = target;
                                                if (!normalizedTarget.startsWith('xl/') && !normalizedTarget.startsWith('/')) {
                                                    normalizedTarget = 'xl/' + normalizedTarget;
                                                } else if (normalizedTarget.startsWith('/')) {
                                                    normalizedTarget = normalizedTarget.substring(1);
                                                }
                                                fileToSheetId[normalizedTarget] = sheetId;
                                            }
                                        });
                                    }
                                }

                                // 1. Extract all media files
                                const mediaEntries = zipEntries.filter(entry => entry.entryName.match(/^xl[\\\/]media[\\\/]/i));
                                // ... existing code ...
                                for (let i = 0; i < mediaEntries.length; i += BATCH_SIZE) {
                                    const batch = mediaEntries.slice(i, i + BATCH_SIZE);
                                    await Promise.all(batch.map(async (entry) => {
                                        // ... existing image upload logic ...
                                    }));

                                    if (progressCallback && mediaEntries.length > 0) {
                                        const imgProgress = 5 + ((i + BATCH_SIZE) / mediaEntries.length) * 45;
                                        progressCallback(Math.min(imgProgress, 50));
                                    }
                                }

                                const sheetDrawings = {};
                                // ... existing code ...
                                for (const [sheetId, drawingPath] of Object.entries(sheetDrawings)) {
                                    // ... existing code ...
                                }
                            } catch (error) {
                                console.error('Fast Image Extraction Error:', error);
                            }
                            return { imageLocations, totalSheets };
                        }
                        // ... existing code ...
                        console.warn(`[FastExtractor] Railway sidecar upload failed for ${currentFileName}: ${e_rail.message}`);
                        if (e_rail.response) {
                            console.warn(`[FastExtractor] Railway error status: ${e_rail.response.status}`);
                            console.warn(`[FastExtractor] Railway error data:`, e_rail.response.data);
                        }
                    }
                }

                    if (!directUrl) {
                    try {
                        const form = new FormData();
                        form.append('key', '6d207e02198a847aa98d0a2a901485a5');
                        form.append('action', 'upload');
                        form.append('source', data.toString('base64'));
                        form.append('format', 'json');
                        const res1 = await axios.post('https://freeimage.host/api/1/upload', form, { headers: form.getHeaders() });
                        if (res1.status === 200 && res1.data && res1.data.image) directUrl = res1.data.image.url;
                    } catch (e1) {
                        console.warn(`[FastExtractor] Provider 1 (FreeImage) failed for ${fileName}, falling back...`);
                    }
                }

                if (directUrl) {
                    savedImages[fileName] = directUrl;
                    return;
                }
            } catch (err) {
                console.error(`Free Tier storage bypass failed for ${fileName}, falling back to local:`, err.message);
            }

            const targetName = `${timestamp}_${currentFileName}`;
            const targetPath = path.join(imagesDir, targetName);
            try {
                const isVercel = process.env.VERCEL === '1';
                if (!fsSync.existsSync(imagesDir)) fsSync.mkdirSync(imagesDir, { recursive: true });
                fsSync.writeFileSync(targetPath, data);
                savedImages[fileName] = `/uploads/images/${targetName}`;
                console.log(`[FastExtractor] Saved local image for ${fileName} as ${targetName}`);

                if (isVercel) {
                    console.error(`⚠️ [Vercel Warning] Image ${fileName} saved to /tmp but will NOT be accessible in UI. Please configure Supabase or Railway Sidecar.`);
                }
            } catch (localErr) {
                console.error(`[FastExtractor] Failed to save local image for ${fileName}:`, localErr);
            }
        }));
    }

        const wbRelsEntry = zipEntries.find(e => e.entryName === 'xl/_rels/workbook.xml.rels');
    const wbEntry = zipEntries.find(e => e.entryName === 'xl/workbook.xml');
    const fileToSheetId = {};

    if (wbRelsEntry && wbEntry) {
        const relsXml = wbRelsEntry.getData().toString('utf8');
        const relsResult = await parseString(relsXml);
        const rels = relsResult.Relationships?.Relationship;
        const rIdToTarget = {};
        if (rels) {
            (Array.isArray(rels) ? rels : [rels]).forEach(r => {
                rIdToTarget[r.Id] = r.Target;
            });
        }

        const wbXml = wbEntry.getData().toString('utf8');
        const wbResult = await parseString(wbXml);
        const sheets = wbResult.workbook?.sheets?.sheet;
        if (sheets) {
            (Array.isArray(sheets) ? sheets : [sheets]).forEach(s => {
                const rId = s['r:id'];
                const sheetId = parseInt(s.sheetId);
                const target = rIdToTarget[rId];
                if (target) {
                    let normalizedTarget = target;
                    if (!normalizedTarget.startsWith('xl/') && !normalizedTarget.startsWith('/')) {
                        normalizedTarget = 'xl/' + normalizedTarget;
                    } else if (normalizedTarget.startsWith('/')) {
                        normalizedTarget = normalizedTarget.substring(1);
                    }
                    fileToSheetId[normalizedTarget] = sheetId;
                }
            });
        }
    }

    const sheetDrawings = {};
    for (const [sheetPath, sheetId] of Object.entries(fileToSheetId)) {
        const dir = path.dirname(sheetPath);
        const base = path.basename(sheetPath);
        const relsPath = `${dir}/_rels/${base}.rels`;
        const relsEntry = zipEntries.find(e => e.entryName === relsPath);
        if (!relsEntry) continue;

        const xmlData = relsEntry.getData().toString('utf8');
        const result = await parseString(xmlData);
        const rels = result.Relationships?.Relationship;
        if (rels) {
            const drawingRel = (Array.isArray(rels) ? rels : [rels]).find(r => r.Type.includes('drawing'));
            if (drawingRel) {
                let target = drawingRel.Target;
                if (target.startsWith('../')) target = 'xl/' + target.substring(3);
                sheetDrawings[sheetId] = target;
            }
        }
    }

    for (const [sheetId, drawingPath] of Object.entries(sheetDrawings)) {
        const drawingEntry = zipEntries.find(e => e.entryName === drawingPath);
        if (!drawingEntry) continue;

        const drawingDir = path.dirname(drawingPath);
        const drawingName = path.basename(drawingPath);
        const drawingRelsPath = `${drawingDir}/_rels/${drawingName}.rels`;
        const drawingRelsEntry = zipEntries.find(e => e.entryName === drawingRelsPath);
        const rIdToMedia = {};

        if (drawingRelsEntry) {
            const relsXml = drawingRelsEntry.getData().toString('utf8');
            const result = await parseString(relsXml);
            const rels = result.Relationships?.Relationship;
            if (rels) {
                (Array.isArray(rels) ? rels : [rels]).forEach(r => {
                    if (r.Target) rIdToMedia[r.Id] = path.basename(r.Target);
                });
            }
        }

        const drawingXml = drawingEntry.getData().toString('utf8');
        const drawingResult = await parseString(drawingXml);
        const wsDr = drawingResult['xdr:wsDr'];
        if (!wsDr) continue;

        const anchors = [];
        if (wsDr['xdr:twoCellAnchor']) anchors.push(...(Array.isArray(wsDr['xdr:twoCellAnchor']) ? wsDr['xdr:twoCellAnchor'] : [wsDr['xdr:twoCellAnchor']]));
        if (wsDr['xdr:oneCellAnchor']) anchors.push(...(Array.isArray(wsDr['xdr:oneCellAnchor']) ? wsDr['xdr:oneCellAnchor'] : [wsDr['xdr:oneCellAnchor']]));

        anchors.forEach(anchor => {
            const from = anchor['xdr:from'];
            if (!from) return;
            const row = parseInt(from['xdr:row']) + 1;
            const col = parseInt(from['xdr:col']) + 1;

            const pic = anchor['xdr:pic'];
            const blipFill = pic?.['xdr:blipFill'];
            const blip = blipFill?.['a:blip'];
            const rId = blip?.['r:embed'];

            const imageKey = rIdToMedia[rId];
            if (rId && imageKey && savedImages[imageKey]) {
                imageLocations.push({
                    sheetIndex: sheetId,
                    row: row,
                    col: col,
                    url: savedImages[imageKey],
                    extension: path.extname(imageKey).substring(1)
                });
            } else if (rId && imageKey) {
                // Fallback to filename if not in savedImages (helps catch bugs)
                console.log(`[FastExtractor] Warning: Image ${imageKey} not found in savedImages map`);
                const fallbackUrl = `/uploads/images/${timestamp}_${imageKey}`;
                imageLocations.push({
                    sheetIndex: sheetId,
                    row: row,
                    col: col,
                    url: fallbackUrl,
                    extension: path.extname(imageKey).substring(1)
                });
            }
        });
    }
} catch (error) {
    console.error('Fast Image Extraction Error:', error);
}
return imageLocations;
}

async function processWorksheetStream(worksheetReader, imageMap, sheetIndex) {
    const validRows = [];
    let headerRow = null;
    let isTableStarted = false;
    let headerRowIndex = -1;

    // Helper to extract text from any cell value type
    const extractText = (val) => {
        if (!val) return '';
        if (typeof val !== 'object') return String(val).trim();
        if (val.richText) return val.richText.map(t => t.text).join('').trim();
        if (val.text) return val.text.trim(); // Hyperlink
        if (val.result !== undefined) return String(val.result).trim(); // Formula
        return String(val).trim();
    };

    for await (const row of worksheetReader) {
        if (!row.values || row.values.length === 0) continue;

        const rowNumber = row.number;
        // Correctly extract text for potential headers
        const rowStrings = row.values.slice(1).map(extractText);

        // 1. Detect Header (if not yet found)
        if (!isTableStarted) {
            const matchCount = BOQ_HEADER_KEYWORDS.reduce((count, pattern) => {
                return count + (rowStrings.some(str => pattern.test(str)) ? 1 : 0);
            }, 0);

            if (matchCount >= 2) {
                isTableStarted = true;
                headerRow = rowStrings;
                headerRowIndex = rowNumber;
                continue;
            } else {
                continue;
            }
        }

        // ... Match logic ...

        // 2. Process Data Rows
        // Check if this is a repeated header row (must match AT LEAST 3 patterns to be a true header)
        // Also exclude summary rows like "TOTAL AMOUNT" which may falsely match
        const isSummaryRow = rowStrings.some(str => /^total\s*(amount)?$/i.test(str));

        const isRepeatedHeader = !isSummaryRow && BOQ_HEADER_KEYWORDS.reduce((count, pattern) => {
            return count + (rowStrings.some(str => pattern.test(str)) ? 1 : 0);
        }, 0) >= 3; // Increased from 2 to 3 for stricter matching

        if (isRepeatedHeader) continue;

        // Extract Data
        const rowData = [];
        const colCount = headerRow ? headerRow.length : row.values.length;
        let hasContent = false;

        for (let idx = 0; idx < colCount; idx++) {
            const colNumber = idx + 1;
            let cellValue = row.values[colNumber];

            // Use the same helper for data cells
            cellValue = extractText(cellValue);

            if (cellValue) hasContent = true;

            const imagesForCell = imageMap.filter(i =>
                i.sheetIndex == sheetIndex &&
                i.row == rowNumber &&
                i.col == colNumber
            );

            // Debug if finding images
            if (imagesForCell.length > 0) {
                // console.log(`Found image at Sheet ${sheetIndex}, Row ${rowNumber}, Col ${colNumber}`);
                hasContent = true;
            }

            rowData.push({
                value: cellValue || '',
                images: imagesForCell.map(img => ({ url: img.url, extension: img.extension })),
                isMerged: false,
                image: imagesForCell.length > 0 ? { url: imagesForCell[0].url, extension: imagesForCell[0].extension } : null
            });
        }

        if (hasContent) {
            validRows.push({
                cells: rowData,
                isHeader: false,
                isSummary: false
            });
        }
    }

    if (!isTableStarted || validRows.length === 0) return null;

    return {
        sheetName: worksheetReader.name || `Sheet${sheetIndex}`,
        header: headerRow,
        rows: validRows
    };
}

export { extractExcelData };
