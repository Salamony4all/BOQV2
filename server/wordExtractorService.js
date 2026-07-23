import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { convertEmfToPng } from './utils/emfConverter.js';
import { renderPDFWithLayout } from './utils/pdfRenderer.js';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import crypto from 'crypto';
import { extractPdfViaWordFastPath } from './universalPatternParsers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = promisify(exec);
const WORDCOM_EXTRACTOR_VERSION = 'wordcom-hybrid-v17.1-fastpath';
console.log(`[WordPdfExtractor] Module loaded: ${WORDCOM_EXTRACTOR_VERSION}`);

const DEFAULT_HEADER = ['SL.No', 'Image Reference', 'Item Description', 'QTY', 'Unit', 'Unit Price', 'Total (AED)'];
const BOQ_HEADER_KEYWORDS = [
    /\b(description|desc|disc|product|specification|material|particulars|item\s*description|details)s?\b/i,
    /\b(qty|quantity|quanity|qnty|q'?ty|amount|vol)\b/i,
    /\b(unit|uom|untit|measure|nos|no\.?|pcs|set|lot)\b/i,
    /\b(rate|price|prise|u\.?rate|unit\s*price|unit\s*rate|sp|sp\/eur)\b/i,
    /\b(amount|total|sub\s*total|value|sum|tp|tp\/eur)\b/i,
    /\b(image|photo|picture|img|pic|image\s*reference|ref)\b/i,
    /\b(sn|s\.?n\.?|sl\.?no\.?|no\.?|item\s*no|sr|sl|serial)\b/i
];

const HEADER_ALIASES = {
    sn: ['SL.No', 'S.N', 'S/N', 'No.', 'Item No'],
    image: ['Image Reference', 'Image', 'Photo', 'Picture', 'Ref'],
    description: ['Item Description', 'Description', 'Particulars', 'Specification'],
    qty: ['QTY', 'Qty', 'Quantity'],
    unit: ['Unit', 'UOM'],
    rate: ['Unit Price', 'Rate', 'U.Rate', 'Unit Rate', 'SP/EUR'],
    amount: ['Total (AED)', 'Amount', 'Total', 'TP/EUR']
};

async function extractPdfViaWord(filePath, progressCallback = () => { }, onBlobCreated = null) {
    try {
        await fs.access(filePath);
    } catch {
        throw new Error(`PDF extraction initialization failed. File not found: ${filePath}`);
    }

    const isVercel = process.env.VERCEL === '1';
    const tempDir = isVercel ? '/tmp/uploads' : path.join(os.tmpdir(), 'boqflow-word-extraction');
    await fs.mkdir(tempDir, { recursive: true });

    const absInput = path.resolve(filePath);

    // Try fast-path Poppler-based extraction (v16 + v17 regex patterns)
    try {
        const fastResult = await extractPdfViaWordFastPath(filePath, progressCallback);
        if (fastResult) {
            if (onBlobCreated) {
                try { await onBlobCreated([]); } catch (err) { console.warn(`[WordPdfExtractor] blob callback failed: ${err.message}`); }
            }
            return fastResult;
        }
    } catch (fastErr) {
        console.warn(`[WordPdfExtractor] Fast-path Poppler extraction failed: ${fastErr.message}. Falling back to standard pipeline...`);
    }

    let finalHtmlPath = null;
    let pageCount = 0;
    try {
        const mupdf = await import('mupdf');
        const data = await fs.readFile(absInput);
        const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
        pageCount = doc.countPages();
        console.log(`[WordPdfExtractor] PDF page count: ${pageCount}`);
    } catch (e) {
        console.warn(`[WordPdfExtractor] Could not determine page count: ${e.message}`);
    }

    const skipHtmlConversion = pageCount > 50;
    if (skipHtmlConversion) {
        console.log(`[WordPdfExtractor] PDF has ${pageCount} pages. Skipping HTML conversion to avoid timeout/hang.`);
    }

    if (!skipHtmlConversion) {
        try {
            progressCallback(5);
            console.log('[WordPdfExtractor] Attempting LibreOffice conversion...');
            const cmd = `soffice --headless --convert-to html --outdir "${tempDir}" "${absInput}"`;
            await execPromise(cmd, { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
            const fileName = path.basename(absInput, path.extname(absInput));
            const htmlPath = path.join(tempDir, `${fileName}.html`);
            const htmPath = path.join(tempDir, `${fileName}.htm`);
            if (fsSync.existsSync(htmlPath)) finalHtmlPath = htmlPath;
            else if (fsSync.existsSync(htmPath)) finalHtmlPath = htmPath;
            if (finalHtmlPath) console.log(`[WordPdfExtractor] LibreOffice success: ${finalHtmlPath}`);
        } catch (libreErr) {
            console.warn(`[WordPdfExtractor] LibreOffice failed: ${libreErr.message}`);
        }

        if (!finalHtmlPath && process.platform === 'win32') {
            try {
                progressCallback(10);
                console.log('[WordPdfExtractor] Falling back to Word COM...');
                const outputHtmPath = path.join(tempDir, `converted_${Date.now()}.htm`);
                const absOutput = path.resolve(outputHtmPath);
                const psScript = `
            $absInput = "${absInput.replace(/\\/g, '\\\\')}";
            $absOutput = "${absOutput.replace(/\\/g, '\\\\')}";
            try {
              $word = New-Object -ComObject Word.Application;
              $word.Visible = $false;
              $word.DisplayAlerts = 0;
              $doc = $word.Documents.Open($absInput, $false, $true);
              $doc.SaveAs2($absOutput, 10);
              $doc.Close();
              $word.Quit();
              [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null;
              Write-Output "SUCCESS";
            } catch {
              Write-Error $_.Exception.Message;
              if ($word) { $word.Quit(); }
              exit 1;
            }
          `;
                const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
                const { stdout } = await execPromise(`powershell -EncodedCommand ${encodedScript}`, { timeout: 300000, maxBuffer: 20 * 1024 * 1024 });
                if (stdout.includes('SUCCESS') || fsSync.existsSync(absOutput)) {
                    finalHtmlPath = absOutput;
                    console.log(`[WordPdfExtractor] Word COM success: ${finalHtmlPath}`);
                }
            } catch (comErr) {
                console.error(`[WordPdfExtractor] Word COM failed: ${comErr.message}`);
            }
        }
    }

    if (!finalHtmlPath) {
        const directPdfText = await extractPdfPlainTextMupdf(absInput);
        if (directPdfText && directPdfText.trim()) {
            console.log('[WordPdfExtractor] HTML conversion failed. Falling back to direct PDF text parsing...');
            progressCallback(60);
            
            let tables = [];
            tables = recoverUniversalV12RowsFromFullText(null, {}, tables, directPdfText);
            if (tables && tables.length > 0) {
                // Assign correct page numbers to rows
                assignRowPageNumbers(tables, directPdfText);
                
                // Collect unique pages containing rows
                const firstTable = tables[0];
                const targetPages = [...new Set(firstTable.rows.map(r => r.pageNum))].sort((a, b) => a - b);
                console.log(`[WordPdfExtractor] Target pages for native layout extraction: ${targetPages.join(', ')}`);
                
                // Extract layout coordinates and native images only for target pages
                let layouts = [];
                try {
                    layouts = await renderPDFWithLayout(absInput, targetPages);
                    console.log(`[WordPdfExtractor] PyMuPDF native layout extraction retrieved ${layouts.length} pages.`);
                } catch (e) {
                    console.warn(`[WordPdfExtractor] PyMuPDF layout extraction failed: ${e.message}`);
                }
                
                const sessionId = `word_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
                await pairNativeImagesToFallbackRows(tables, layouts, sessionId, directPdfText);

                // CLEANUP: Delete the extracted_assets folder to avoid cluttering the workspace
                try {
                    const outputDir = path.join(path.dirname(absInput), 'extracted_assets');
                    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
                } catch (cleanupErr) {
                    console.warn(`[WordPdfExtractor] Failed to clean up extracted_assets: ${cleanupErr.message}`);
                }

                progressCallback(100);
                return {
                    tables,
                    totalTables: tables.length,
                    isDirectExtraction: true,
                    engineUsed: `${WORDCOM_EXTRACTOR_VERSION}-direct-text`,
                    previewUrl: null
                };
            }
        }
        throw new Error('All PDF-to-HTML conversion methods failed. Install LibreOffice or run on Windows with Microsoft Word.');
    }

    progressCallback(30);
    const assetFolder = finalAssetFolder(finalHtmlPath, tempDir);
    const imageMap = await extractWordImagesAndMap(assetFolder, onBlobCreated);

    progressCallback(60);
    const htmlContent = await fs.readFile(finalHtmlPath, 'utf8');
    const $ = cheerio.load(htmlContent, { decodeEntities: false });
    const directPdfText = await extractPdfPlainTextMupdf(absInput);
    if (directPdfText) console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} direct PDF text chars=${directPdfText.length}`);

    let tables = processConvertedHtml($, imageMap);
    tables = postProcessTables(tables);
    console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} after base parse: tables=${tables.length}, rows=${tables[0]?.rows?.length || 0}, engine=${tables[0]?.engineUsed || 'n/a'}`);
    tables = recoverUniversalV12RowsFromFullText($, imageMap, tables, directPdfText);
    console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} after universal V12: tables=${tables.length}, rows=${tables[0]?.rows?.length || 0}, engine=${tables[0]?.engineUsed || 'n/a'}`);
    tables = recoverDynamicBillNoRowsFromFullText($, tables);
    tables = recoverMissingSerialRowsFromFullText($, tables);
    tables = recoverMissingFinalSerialRowsV13($, tables, directPdfText);
    console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} final: tables=${tables.length}, rows=${tables[0]?.rows?.length || 0}, engine=${tables[0]?.engineUsed || 'n/a'}`);

    progressCallback(100);

    // CLEANUP: Clean up temporary HTML and asset files from hybrid conversion
    try {
        if (finalHtmlPath) {
            await fs.unlink(finalHtmlPath).catch(() => {});
        }
        if (assetFolder) {
            await fs.rm(assetFolder, { recursive: true, force: true }).catch(() => {});
        }
    } catch (cleanupErr) {
        console.warn(`[WordPdfExtractor] Failed to clean up hybrid conversion files: ${cleanupErr.message}`);
    }

    return {
        tables,
        totalTables: tables.length,
        isDirectExtraction: true,
        engineUsed: WORDCOM_EXTRACTOR_VERSION,
        previewUrl: null
    };
}

function finalAssetFolder(htmlPath, tempDir) {
    const fileName = path.basename(htmlPath);
    return path.join(tempDir, fileName.replace(/\.htm(l)?$/i, '_files'));
}

async function listFilesRecursive(dir) {
    if (!dir || !fsSync.existsSync(dir)) return [];
    const out = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...await listFilesRecursive(full));
        else out.push(full);
    }
    return out;
}

async function extractWordImagesAndMap(absAssetFolder, onBlobCreated = null) {
    const imageLocations = [];
    if (!absAssetFolder || !fsSync.existsSync(absAssetFolder)) return imageLocations;
    try {
        const mediaEntries = await listFilesRecursive(absAssetFolder);
        const sessionId = `word_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        const localAssetDir = path.join(process.cwd(), 'public', 'temp', 'extracted_images', sessionId);
        await fs.mkdir(localAssetDir, { recursive: true });

        for (const fullPath of mediaEntries) {
            const originalName = path.basename(fullPath);
            if (!/\.(png|jpe?g|gif|bmp|webp|emf|wmf|svg)$/i.test(originalName)) continue;
            const stat = await fs.stat(fullPath).catch(() => null);
            if (!stat || !stat.isFile() || stat.size < 100) continue;

            let data = await fs.readFile(fullPath);
            let currentFileName = originalName;
            if (/\.(emf|wmf)$/i.test(originalName)) {
                const tempInputPath = path.join(absAssetFolder, `temp_${Date.now()}_${originalName}`);
                try {
                    await fs.writeFile(tempInputPath, data);
                    const pngPath = await convertEmfToPng(tempInputPath);
                    if (pngPath && fsSync.existsSync(pngPath)) {
                        data = await fs.readFile(pngPath);
                        currentFileName = path.basename(pngPath).replace(/^temp_/, '').replace(/\.(emf|wmf)$/i, '.png');
                        try { await fs.unlink(pngPath); } catch { }
                    }
                } catch (err) {
                    console.error(`[WordPdfExtractor] Graphic conversion failed: ${err.message}`);
                } finally {
                    try { await fs.unlink(tempInputPath); } catch { }
                }
            }

            const safeName = `${imageStem(currentFileName)}_${crypto.randomUUID().slice(0, 6)}${path.extname(currentFileName) || '.png'}`.replace(/[^a-zA-Z0-9._-]/g, '_');
            const localSavePath = path.join(localAssetDir, safeName);
            await fs.writeFile(localSavePath, data);
            imageLocations.push({
                fileName: originalName,
                stem: imageStem(originalName),
                url: `/temp/extracted_images/${sessionId}/${safeName}`,
                extension: path.extname(safeName).substring(1),
                size: data.length,
                source: 'wordcom'
            });
        }
        if (onBlobCreated) onBlobCreated(imageLocations);
    } catch (error) {
        console.error('[WordPdfExtractor] Local asset compilation error:', error);
    }
    return imageLocations;
}

async function extractPdfPlainTextMupdf(filePath) {
    try {
        const mupdf = await import('mupdf');
        const data = await fs.readFile(filePath);
        const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
        const pages = [];
        for (let i = 0; i < doc.countPages(); i++) {
            try {
                const page = doc.loadPage(i);
                const text = page.toStructuredText().asText();
                if (text && text.trim()) pages.push(text.trim());
            } catch (pageErr) { console.warn(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} mupdf text page ${i + 1} failed: ${pageErr.message}`); }
        }
        return pages.join('\n--- PAGE BREAK ---\n');
    } catch (err) { console.warn(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} mupdf direct text unavailable: ${err.message}`); return ''; }
}

function cleanMojibake(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[\uFFFD�]+/g, ' ')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .replace(/[\uE000-\uF8FF]/g, ' ')
        .replace(/(?:\s*[\u25A0-\u25FF\u2600-\u27BF]\s*){2,}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function normText(value) { return cleanMojibake(value); }
function emptyCell() { return { value: '', images: [], image: null, isMerged: false }; }
function makeCell(value = '', images = [], extra = {}) {
    const cleanImages = uniqueImages(images || []);
    return { value: normText(value), images: cleanImages, image: cleanImages[0] || null, isMerged: false, ...extra };
}
function imageStem(file) {
    const base = path.basename(String(file || '').toLowerCase());
    return base.replace(/\.[a-z0-9]+$/i, '').replace(/^temp_\d+_/, '').replace(/[^a-z0-9]+/g, '');
}
function uniqueImages(images) {
    const seen = new Set();
    const out = [];
    for (const img of images || []) {
        if (!img || !img.url || seen.has(img.url)) continue;
        seen.add(img.url);
        out.push(img);
    }
    return out;
}
function scoreHeader(text) { return BOQ_HEADER_KEYWORDS.reduce((a, rx) => a + (rx.test(text || '') ? 1 : 0), 0); }
function looksLikeHeader(texts) {
    const joined = texts.map(normText).join(' | ');
    return scoreHeader(joined) >= 2 || (/description|desc|particulars|product/i.test(joined) && /qty|quantity|unit|rate|amount|total/i.test(joined));
}
function classifyHeader(text) {
    const t = normText(text).toLowerCase();
    
    // 1. sn (strict serial numbers / codes / tags / item numbers)
    if (/^(s\.?n\.?|sl\.?no\.?|sr\.?no\.?|no\.?|#|item\s*no|serial|code|tag)$/.test(t) || 
        /item\s*code|product\s*code|art\.?-\s*no/i.test(t)) {
        return 'sn';
    }
    // 2. image (ensure we don't match "item code | reference" as image because of "ref")
    if (/image|photo|picture|img|pic|ref/i.test(t) && !/code|tag/i.test(t)) {
        return 'image';
    }
    // 3. qty
    if (/qty|quantity|qnty|qt|vol/i.test(t)) {
        return 'qty';
    }
    // 4. description
    if (/description|desc|disc|product|specification|material|particulars|details|item/i.test(t)) {
        return 'description';
    }
    // 5. amount (Total / Ext) - check this BEFORE rate/unit to prevent Ext Price from matching Price/Unit
    if (/amount|total|value|sum|subtotal|\btp\b|\btp\//i.test(t) || 
        /ext\.?\s*net|ext\.?\s*price|ext\.?\s*cost|extended/i.test(t)) {
        return 'amount';
    }
    // 6. rate (Unit Price / Unit Net Price) - check this BEFORE unit UOM to prevent Unit Price from matching Unit
    if (/rate|price|prise|cost|u\.?rate|\bsp\b|\bsp\//i.test(t)) {
        return 'rate';
    }
    // 7. unit (UOM)
    if (/unit|uom|measure|untit|nos|pcs|set|lot/i.test(t)) {
        return 'unit';
    }
    return null;
}
function canonicalIndex(header, type) {
    const idx = (header || []).findIndex(h => classifyHeader(h) === type);
    if (idx !== -1) return idx;
    const fallback = { sn: 0, image: 1, description: 2, qty: 3, unit: 4, rate: 5, amount: 6 };
    return Math.min(fallback[type] ?? 0, Math.max((header || []).length - 1, 0));
}
function normalizeHeaderName(text, idx) {
    const type = classifyHeader(text);
    if (type) return HEADER_ALIASES[type][0];
    return normText(text) || DEFAULT_HEADER[idx] || `Column ${idx + 1}`;
}
function standardizeHeader(rawHeader, datasetHasImages = false) {
    let values = (rawHeader || []).map(normText).filter(Boolean);
    values = values.map((h, idx) => normalizeHeaderName(h, idx));
    if (!values.length) values = [...DEFAULT_HEADER];
    const hasDesc = values.some(h => classifyHeader(h) === 'description');
    const hasQty = values.some(h => classifyHeader(h) === 'qty');
    if (!hasDesc && !hasQty) values = [...DEFAULT_HEADER];
    if (datasetHasImages && !values.some(h => classifyHeader(h) === 'image')) {
        const snIdx = values.findIndex(h => classifyHeader(h) === 'sn');
        values.splice(snIdx >= 0 ? snIdx + 1 : 1, 0, 'Image Reference');
    }
    return dedupeHeaders(values);
}
function dedupeHeaders(headers) {
    const counts = new Map();
    return headers.map(h => {
        const key = h.toLowerCase();
        const count = counts.get(key) || 0;
        counts.set(key, count + 1);
        return count === 0 ? h : `${h} ${count + 1}`;
    });
}
function mapImageBySrc(src, imageMap) {
    if (!src) return null;
    const decoded = decodeURIComponent(String(src)).replace(/\\/g, '/');
    const base = path.basename(decoded).toLowerCase();
    const stem = imageStem(base);
    const found = (imageMap || []).find(a => {
        const fileBase = String(a.fileName || '').toLowerCase();
        const urlBase = path.basename(String(a.url || '')).toLowerCase();
        const fileStem = a.stem || imageStem(fileBase);
        const urlStem = imageStem(urlBase);
        return fileBase === base || urlBase === base || fileStem === stem || urlStem === stem || (stem && (fileBase.includes(stem) || urlBase.includes(stem)));
    });
    return found ? { url: found.url, extension: found.extension, source: 'wordcom' } : null;
}
function imagesFromElement($, el, imageMap) {
    const imgs = [];
    $(el).find('img').addBack('img').each((_, img) => {
        const match = mapImageBySrc($(img).attr('src') || $(img).attr('data-src') || '', imageMap);
        if (match) imgs.push(match);
    });
    return uniqueImages(imgs);
}
function parseLength(value) {
    if (value === undefined || value === null) return null;
    const m = String(value).trim().toLowerCase().match(/(-?\d+(?:\.\d+)?)(px|pt|cm|mm|in)?/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = m[2] || 'px';
    if (unit === 'pt') return n * 96 / 72;
    if (unit === 'cm') return n * 37.7952755906;
    if (unit === 'mm') return n * 3.77952755906;
    if (unit === 'in') return n * 96;
    return n;
}
function parseStyle(style = '') {
    const out = {};
    String(style).split(';').forEach(part => {
        const [k, ...rest] = part.split(':');
        if (k && rest.length) out[k.trim().toLowerCase()] = rest.join(':').trim();
    });
    return out;
}
function elementBox($, el) {
    const $el = $(el);
    const st = parseStyle($el.attr('style') || '');
    let x = parseLength(st.left ?? st['margin-left'] ?? st['text-indent']);
    let y = parseLength(st.top ?? st['margin-top']);
    let w = parseLength(st.width);
    let h = parseLength(st.height ?? st['line-height']);
    x = x ?? parseLength($el.attr('x')) ?? parseLength($el.attr('data-x'));
    y = y ?? parseLength($el.attr('y')) ?? parseLength($el.attr('data-y'));
    w = w ?? parseLength($el.attr('width')) ?? parseLength($el.attr('data-width'));
    h = h ?? parseLength($el.attr('height')) ?? parseLength($el.attr('data-height'));
    let p = $el.parent();
    let guard = 0;
    while ((x === null || y === null) && p && p.length && guard < 5) {
        const ps = parseStyle(p.attr('style') || '');
        if (x === null) x = parseLength(ps.left ?? ps['margin-left']);
        if (y === null) y = parseLength(ps.top ?? ps['margin-top']);
        p = p.parent();
        guard++;
    }
    return { x, y, w: w || 0, h: h || 12, hasXY: x !== null && y !== null };
}
function shouldUseLeaf($, el) {
    const text = normText($(el).clone().children('script,style').remove().end().text());
    if (!text && $(el).find('img').length === 0 && el.tagName !== 'img') return false;
    let childSame = false;
    $(el).children('p,div,span,td,th').each((_, child) => {
        const childText = normText($(child).text());
        if (childText && childText === text) childSame = true;
    });
    return !childSame;
}

function processConvertedHtml($, imageMap) {
    console.log('[WordPdfExtractor] Executing BOQ tuned scanner: tables -> geometry -> stream -> repair -> stitch');
    const nativeTables = parseActualHtmlTables($, imageMap);
    if (nativeTables.length) return nativeTables;
    const geometryTables = geometryReconstruct($, imageMap);
    if (geometryTables.length) return geometryTables;
    return sequentialFallback($, imageMap);
}

function parseActualHtmlTables($, imageMap) {
    const candidates = [];
    $('table').each((tableIdx, table) => {
        const sourceRows = [];
        $(table).find('tr').each((_, tr) => {
            const cells = [];
            $(tr).children('th,td').each((__, cell) => {
                cells.push(makeCell($(cell).text(), imagesFromElement($, cell, imageMap), {
                    isMerged: Number($(cell).attr('colspan') || 1) > 1 || Number($(cell).attr('rowspan') || 1) > 1,
                    colSpan: Number($(cell).attr('colspan') || 1),
                    rowSpan: Number($(cell).attr('rowspan') || 1)
                }));
            });
            if (cells.length) sourceRows.push(cells);
        });
        if (sourceRows.length < 2) {
            if (sourceRows.length === 1 && isLikelySerialDataRow(sourceRows[0])) {
                const header = [...DEFAULT_HEADER];
                const mapped = mapCellsToHeader(sourceRows[0], header, header);
                candidates.push({ sheetName: `Word HTML Table ${tableIdx + 1}`, header, rows: [{ cells: mapped, isHeader: false, isSummary: isSummaryRow(mapped), pageNum: 1, sectionLabel: '' }], columnCount: header.length, engineUsed: 'wordcom-hybrid-v12', confidence: 0.72 });
            }
            return;
        }

        let headerRowIdx = sourceRows.findIndex(r => looksLikeHeader(r.map(c => c.value)));
        if (headerRowIdx === -1) {
            const dataRich = sourceRows.some(r => r.some(c => /\d/.test(c.value)) && r.some(c => /pcs|nos|no\.?|m2|sqm|lm|lot|set|each|unit/i.test(c.value)));
            if (!dataRich) return;
            headerRowIdx = 0;
        }

        const rawHeader = sourceRows[headerRowIdx].map(c => c.value);
        const header = standardizeHeader(rawHeader, sourceRows.some(r => r.some(c => c.images.length > 0)));
        const rows = [];
        for (let r = headerRowIdx + 1; r < sourceRows.length; r++) {
            const mapped = mapCellsToHeader(sourceRows[r], rawHeader, header);
            if (hasUsefulData(mapped)) rows.push({ cells: mapped, isHeader: false, isSummary: isSummaryRow(mapped), pageNum: 1, sectionLabel: '' });
        }
        if (rows.length) candidates.push({ sheetName: `Word HTML Table ${tableIdx + 1}`, header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12', confidence: 0.88 });
    });
    return candidates;
}
function mapCellsToHeader(sourceCells, sourceHeader, targetHeader) {
    const mapped = Array(targetHeader.length).fill(null).map(() => emptyCell());
    let unitSeen = false;
    sourceCells.forEach((cell, idx) => {
        let type = classifyHeader(sourceHeader[idx]);
        if (type === 'unit') {
            if (unitSeen) type = 'rate';
            else unitSeen = true;
        }
        const target = type ? canonicalIndex(targetHeader, type) : Math.min(idx, targetHeader.length - 1);
        mapped[target] = makeCell([mapped[target].value, cell.value].filter(Boolean).join(' '), [...mapped[target].images, ...cell.images], { isMerged: cell.isMerged });
    });
    return mapped;
}
function hasUsefulData(cells) {
    const text = cells.map(c => normText(c.value)).join(' ').trim();
    const hasImage = cells.some(c => c.images && c.images.length > 0);
    if (!text && !hasImage) return false;
    return !(looksLikeHeader(cells.map(c => c.value)) && text.length < 120);
}
function isSummaryRow(cells) { return /grand\s*total|subtotal|vat|total\s*amount/i.test(cells.map(c => c.value).join(' ')); }
function groupByY(blocks, tolerance = 9) {
    const groups = [];
    [...blocks].sort((a, b) => (a.y - b.y) || (a.x - b.x)).forEach(b => {
        let g = groups.find(gr => Math.abs(gr.y - b.y) <= tolerance);
        if (!g) { g = { y: b.y, blocks: [] }; groups.push(g); }
        g.blocks.push(b);
        g.y = (g.y * (g.blocks.length - 1) + b.y) / g.blocks.length;
    });
    groups.forEach(g => g.blocks.sort((a, b) => a.x - b.x));
    return groups.sort((a, b) => a.y - b.y);
}
function geometryReconstruct($, imageMap) {
    const blocks = [];
    $('p,div,span,td,th').each((_, el) => {
        if (!shouldUseLeaf($, el)) return;
        const text = normText($(el).text());
        const images = imagesFromElement($, el, imageMap);
        const box = elementBox($, el);
        if ((!text && !images.length) || !box.hasXY) return;
        blocks.push({ text, images, x: box.x, y: box.y, w: box.w || Math.max(30, text.length * 5), h: box.h });
    });
    if (blocks.length < 4) return [];
    const groups = groupByY(blocks);
    let headerIdx = -1;
    let best = 0;
    groups.forEach((g, idx) => {
        const s = scoreHeader(g.blocks.map(b => b.text).join(' '));
        const hasNumbers = groups.slice(idx + 1, idx + 8).some(gr => gr.blocks.some(b => /\d/.test(b.text)));
        if (s > best && hasNumbers) { best = s; headerIdx = idx; }
    });
    if (headerIdx === -1 || best < 2) return [];
    const headerBlocks = groups[headerIdx].blocks;
    const header = standardizeHeader(headerBlocks.map(b => b.text), blocks.some(b => b.images.length));
    const minX = Math.min(...headerBlocks.map(b => b.x), 0);
    const maxX = Math.max(...headerBlocks.map(b => b.x + (b.w || 60)), minX + 700);
    const centers = Array(header.length).fill(null);
    headerBlocks.forEach(b => {
        const type = classifyHeader(b.text);
        if (type) centers[canonicalIndex(header, type)] = b.x + (b.w || 40) / 2;
    });
    const step = (maxX - minX) / Math.max(header.length, 1);
    centers.forEach((c, i) => { if (c === null) centers[i] = minX + step * (i + 0.5); });

    const rows = [];
    let sectionLabel = '';
    for (const g of groups.slice(headerIdx + 1)) {
        if (looksLikeHeader(g.blocks.map(b => b.text)) && g.blocks.map(b => b.text).join(' ').length < 120) continue;
        const cells = Array(header.length).fill(null).map(() => emptyCell());
        g.blocks.forEach(b => {
            const cx = b.x + (b.w || 0) / 2;
            let idx = 0;
            let dist = Infinity;
            centers.forEach((c, i) => { const d = Math.abs(cx - c); if (d < dist) { dist = d; idx = i; } });
            cells[idx] = makeCell([cells[idx].value, b.text].filter(Boolean).join(' '), [...cells[idx].images, ...b.images]);
        });
        const type = classifyRow(cells, header);
        if (type === 'section') { sectionLabel = cells.map(c => c.value).filter(Boolean).join(' '); continue; }
        if (hasUsefulData(cells)) rows.push({ cells, isHeader: false, isSummary: isSummaryRow(cells), pageNum: 1, sectionLabel });
    }
    return rows.length ? [{ sheetName: 'Word Geometry BOQ', header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12', confidence: 0.78 }] : [];
}
function sequentialFallback($, imageMap) {
    const stream = [];
    $('p,div,span,td,th').each((_, el) => {
        if (!shouldUseLeaf($, el)) return;
        const text = normText($(el).text());
        const images = imagesFromElement($, el, imageMap);
        if (text || images.length) stream.push({ text, images });
    });
    if (!stream.length) return [];
    let headerIdx = stream.findIndex((el, idx) => scoreHeader(el.text) > 0 && /\d/.test(stream.slice(idx + 1, idx + 12).map(x => x.text).join(' ')));
    if (headerIdx === -1) headerIdx = 0;
    const header = [...DEFAULT_HEADER];
    const rows = [];
    for (let i = headerIdx + 1; i < stream.length; i += header.length) {
        const cells = Array(header.length).fill(null).map(() => emptyCell());
        stream.slice(i, i + header.length).forEach((item, j) => { cells[j] = makeCell(item.text, item.images); });
        if (hasUsefulData(cells)) rows.push({ cells, isHeader: false, isSummary: isSummaryRow(cells), pageNum: 1, sectionLabel: '' });
    }
    return rows.length ? [{ sheetName: 'Word Stream Fallback', header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12', confidence: 0.45 }] : [];
}

function classifyRow(cells, header) {
    const joined = cells.map(c => normText(c.value)).filter(Boolean).join(' ');
    const hasImage = cells.some(c => c.images.length > 0);
    const sn = cells[canonicalIndex(header, 'sn')]?.value || '';
    const qty = cells[canonicalIndex(header, 'qty')]?.value || '';
    const unit = cells[canonicalIndex(header, 'unit')]?.value || '';
    const rate = cells[canonicalIndex(header, 'rate')]?.value || '';
    const amount = cells[canonicalIndex(header, 'amount')]?.value || '';
    const commercial = [qty, unit, rate, amount].some(v => normText(v));
    if (joined && !hasImage && !commercial && !/^\d+[\.)-]?$/.test(sn) && joined.split(/\s+/).length <= 8) return 'section';
    if (isSummaryRow(cells)) return 'summary';
    return 'data';
}
function isLikelySerialDataRow(cells) {
    if (!cells || !cells.length) return false;
    const joined = cells.map(c => normText(c.value)).join(' ');
    const hasSerial = cells.some(c => /^\s*\d{1,4}\s*$/.test(normText(c.value)));
    const hasMoney = /\d+(?:\.\d{2})/.test(joined);
    const hasQtyUnit = /\b(Nos|No\.?|PCS|Set|Lot|Each|M2|SQM|LM)\b/i.test(joined);
    return hasSerial && (hasMoney || hasQtyUnit || cells.some(c => c.images?.length));
}
function postProcessTables(tables) {
    const repaired = (tables || []).map(t => normalizeTable(t)).filter(t => t.rows.length > 0);
    const stitched = stitchTablesBySerialSequence(repaired);
    return stitched.map((t, idx) => {
        const rows = removeDuplicateRows(t.rows, t.header);
        const audit = buildSerialAudit(rows, t.header);
        return { ...t, sheetName: idx === 0 ? 'BOQ Schedule' : `BOQ Schedule ${idx + 1}`, columnCount: t.header.length, rows, extractionAudit: audit, serialAudit: audit, confidence: Math.max(t.confidence || 0, audit.sequenceConfidence || 0) };
    }).filter(t => t.rows.length > 0);
}
function normalizeTable(table) {
    const sourceHeader = table.header || [];
    const header = [...DEFAULT_HEADER];
    let rows = [];
    let currentSection = '';
    for (const row of table.rows || []) {
        let cells = mapRowToCanonical(row, sourceHeader, header);
        cells = repairCellCount(cells, header);
        cells = cleanRowCells(cells);
        cells = repairSerialOriginShift(cells, header);
        cells = repairDriftedNumericDescription(cells, header);
        cells = repairPartialRowsMissingDescription(cells, header);
        cells = normalizeImageColumn(cells, header);
        cells = repairImageTextDescriptionLeak(cells, header);
        cells = repairUnitRateAmount(cells, header);
        cells = repairAmountFromSingleMoney(cells, header);
        cells = repairAmountFromQtyRate(cells, header);
        cells = repairCommercialQtyRateDrift(cells, header);
        const type = classifyRow(cells, header);
        if (type === 'section') { currentSection = cells.map(c => c.value).filter(Boolean).join(' '); continue; }
        if (!hasUsefulData(cells)) continue;
        const isGrandTotal = /grand\s*total|total\s*amount/i.test(cells.map(c => c.value).join(' '));
        rows.push({ ...row, cells, isHeader: false, isSummary: type === 'summary' || isGrandTotal, sectionLabel: row.sectionLabel || currentSection || '', pageNum: row.pageNum || 1 });
        if (isGrandTotal) {
            console.log('[WordPdfExtractor] Found Grand Total. Ignoring subsequent rows.');
            break;
        }
    }
    return { ...table, header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12' };
}
function mapRowToCanonical(row, sourceHeader, targetHeader) {
    const mapped = Array(targetHeader.length).fill(null).map(() => emptyCell());
    const sourceCells = row.cells || [];
    let unitSeen = false;
    sourceCells.forEach((src, idx) => {
        let type = classifyHeader(sourceHeader[idx]);
        if (type === 'unit') { if (unitSeen) type = 'rate'; else unitSeen = true; }
        const targetIdx = type ? canonicalIndex(targetHeader, type) : Math.min(idx, targetHeader.length - 1);
        const srcImgs = src.images || (src.image ? [src.image] : []);
        mapped[targetIdx] = makeCell([mapped[targetIdx].value, src.value].filter(Boolean).join(' '), [...(mapped[targetIdx].images || []), ...srcImgs], { isMerged: src.isMerged });
    });
    return mapped;
}
function repairCellCount(cells, header) {
    const out = [...cells];
    while (out.length < header.length) out.push(emptyCell());
    if (out.length > header.length) {
        const descIdx = canonicalIndex(header, 'description');
        const extras = out.splice(header.length);
        out[descIdx] = makeCell([out[descIdx]?.value, ...extras.map(c => c.value)].filter(Boolean).join(' '), [...(out[descIdx]?.images || []), ...extras.flatMap(c => c.images || [])]);
    }
    return out;
}
function cleanRowCells(cells) { return cells.map(c => makeCell(c.value, c.images || [], { isMerged: c.isMerged })); }
function repairSerialOriginShift(cells, header) {
    const snIdx = canonicalIndex(header, 'sn');
    const imgIdx = canonicalIndex(header, 'image');
    const snText = normText(cells[snIdx]?.value || '');
    if (/^\d+$/.test(snText)) return cells;
    const m = snText.match(/^(.*?)(\d{1,4})$/);
    if (m && m[2]) { const prefix = normText(m[1]); cells[snIdx].value = m[2]; if (prefix) cells[imgIdx].value = [cells[imgIdx].value, prefix].filter(Boolean).join(' '); }
    return cells;
}
function repairDriftedNumericDescription(cells, header) {
    const imgIdx = canonicalIndex(header, 'image');
    const descIdx = canonicalIndex(header, 'description');
    const qtyIdx = canonicalIndex(header, 'qty');
    const imageText = normText(cells[imgIdx]?.value || '');
    const descText = normText(cells[descIdx]?.value || '');
    if (imageText.length > 25 && /^\d+(?:\.\d+)?$/.test(descText) && !normText(cells[qtyIdx]?.value || '')) { cells[qtyIdx].value = descText; cells[descIdx].value = ''; }
    return cells;
}
function repairPartialRowsMissingDescription(cells, header) {
    const imgIdx = canonicalIndex(header, 'image');
    const descIdx = canonicalIndex(header, 'description');
    const text = normText(cells[imgIdx]?.value || '');
    const desc = normText(cells[descIdx]?.value || '');
    if (!text || text.length < 25) return cells;
    if (!desc || /^\d+(?:\.\d+)?$/.test(desc)) {
        const originMatch = text.match(/^(LOCAL\s*-?\s*UAE|FAR\s+EAST|LOCAL-UAE|LOCAL UAE)\b\s*(.*)$/i);
        if (originMatch) { cells[imgIdx].value = originMatch[1].replace(/\s+/g, ' ').toUpperCase().replace('LOCAL UAE', 'LOCAL-UAE'); cells[descIdx].value = normText(originMatch[2]); }
        else {
            const trailingOrigin = text.match(/^(.*?)(LOCAL\s*-?\s*UAE|FAR\s+EAST|LOCAL-UAE|LOCAL UAE)$/i);
            if (trailingOrigin) { cells[descIdx].value = normText(trailingOrigin[1]); cells[imgIdx].value = trailingOrigin[2].replace(/\s+/g, ' ').toUpperCase().replace('LOCAL UAE', 'LOCAL-UAE'); }
            else { cells[descIdx].value = text; cells[imgIdx].value = ''; }
        }
    }
    return cells;
}
function normalizeImageColumn(cells, header) {
    const imgIdx = canonicalIndex(header, 'image');
    const allImages = [];
    cells.forEach((cell, idx) => { if (idx !== imgIdx && cell.images?.length) { allImages.push(...cell.images); cell.images = []; cell.image = null; } });
    if (allImages.length) { cells[imgIdx].images = uniqueImages([...(cells[imgIdx].images || []), ...allImages]); cells[imgIdx].image = cells[imgIdx].images[0] || null; }
    return cells;
}

function isLooseUnitText(value) { return /^(SET|Set|set|Nos|No\.?|PCS|Pcs|EA|Each|Item|Lot|M2|SQM|LM|MTR)$/i.test(normText(value || '')); }
function isUiPageTagText(value) { return /^P\.?\s*\d+$/i.test(normText(value || '')); }
function repairImageTextDescriptionLeak(cells, header) {
    const imgIdx = canonicalIndex(header, 'image'), descIdx = canonicalIndex(header, 'description'), unitIdx = canonicalIndex(header, 'unit');
    if (imgIdx === descIdx || imgIdx < 0 || descIdx < 0) return cells;
    const imgCell = cells[imgIdx] || emptyCell(), descCell = cells[descIdx] || emptyCell(), unitCell = cells[unitIdx] || emptyCell();
    const imgText = normText(imgCell.value || ''), descText = normText(descCell.value || ''), unitText = normText(unitCell.value || '');
    const hasImages = (imgCell.images && imgCell.images.length > 0) || !!imgCell.image;
    if (imgText.length >= 18 && /[A-Za-z]/.test(imgText) && !isLooseUnitText(imgText) && !isUiPageTagText(imgText) && (hasImages || !descText || isLooseUnitText(descText) || isUiPageTagText(descText))) {
        imgCell.value = '';
        const descParts = [imgText];
        if (descText && !isLooseUnitText(descText) && !isUiPageTagText(descText)) descParts.push(descText);
        descCell.value = normText(descParts.join(' '));
        if (isLooseUnitText(descText) && !unitText) unitCell.value = descText;
    }
    if (isLooseUnitText(descCell.value) && unitText) descCell.value = '';
    cells[imgIdx] = imgCell; cells[descIdx] = descCell; cells[unitIdx] = unitCell;
    return cells;
}

function extractNumbers(text) { return String(text || '').match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g) || []; }
function cleanNumber(value) { const m = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? m[0] : ''; }
function numericValue(value) { const n = parseFloat(cleanNumber(value)); return Number.isNaN(n) ? null : n; }
function repairUnitRateAmount(cells, header) {
    const unitIdx = canonicalIndex(header, 'unit'), rateIdx = canonicalIndex(header, 'rate'), amountIdx = canonicalIndex(header, 'amount');
    const unitText = cells[unitIdx]?.value || '', rateText = cells[rateIdx]?.value || '', amountText = cells[amountIdx]?.value || '';
    const numsInUnit = extractNumbers(unitText);
    const unitWords = unitText.replace(/-?\d+(?:,\d{3})*(?:\.\d+)?/g, ' ').replace(/[^a-zA-Z.%/-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (numsInUnit.length >= 2 && !cleanNumber(rateText) && !cleanNumber(amountText)) { cells[unitIdx].value = unitWords || guessUnit(unitText) || 'Nos'; cells[rateIdx].value = numsInUnit[0]; cells[amountIdx].value = numsInUnit[1]; return cells; }
    if (numsInUnit.length === 1 && !cleanNumber(rateText)) { cells[unitIdx].value = unitWords || guessUnit(unitText) || 'Nos'; cells[rateIdx].value = numsInUnit[0]; }
    if (cleanNumber(rateText) && !cleanNumber(amountText)) { const numsInRate = extractNumbers(rateText); if (numsInRate.length >= 2) { cells[rateIdx].value = numsInRate[0]; cells[amountIdx].value = numsInRate[1]; } }
    return cells;
}
function repairAmountFromSingleMoney(cells, header) {
    const qtyIdx = canonicalIndex(header, 'qty'), rateIdx = canonicalIndex(header, 'rate'), amountIdx = canonicalIndex(header, 'amount');
    const qty = numericValue(cells[qtyIdx]?.value), rate = numericValue(cells[rateIdx]?.value), amount = numericValue(cells[amountIdx]?.value);
    // If we have qty + rate but no amount, compute amount = qty × rate.
    // Previous logic assumed rate held the total — this was wrong when rate is genuinely the unit rate.
    if (qty !== null && rate !== null && amount === null) { cells[amountIdx].value = (qty * rate).toFixed(2); }
    return cells;
}
function repairAmountFromQtyRate(cells, header) {
    const qtyIdx = canonicalIndex(header, 'qty'), rateIdx = canonicalIndex(header, 'rate'), amountIdx = canonicalIndex(header, 'amount');
    const qty = numericValue(cells[qtyIdx]?.value), rate = numericValue(cells[rateIdx]?.value), amount = numericValue(cells[amountIdx]?.value);
    if (qty !== null) cells[qtyIdx].value = cleanNumber(cells[qtyIdx].value);
    if (rate !== null) cells[rateIdx].value = cleanNumber(cells[rateIdx].value);
    if (amount !== null) cells[amountIdx].value = cleanNumber(cells[amountIdx].value);
    if (qty !== null && rate !== null && amount === null) cells[amountIdx].value = (qty * rate).toFixed(2);
    return cells;
}

function approxEqualMoney(a, b, tolerance = 0.02) { if (a === null || b === null) return false; return Math.abs(a - b) <= tolerance; }
function extractUnitWordFromCells(cells, header) {
    const joined = (cells || []).map(c => normText(c?.value || '')).join(' ');
    const m = joined.match(/\b(SET|Set|set|Nos|No\.?|PCS|Pcs|EA|Each|Item|Lot|M2|SQM|LM|MTR)\b/i);
    if (!m) return ''; const v = m[1]; if (/^set$/i.test(v)) return 'SET'; if (/^no\.?$/i.test(v)) return 'No'; return v;
}
function repairCommercialQtyRateDrift(cells, header) {
    const qtyIdx = canonicalIndex(header, 'qty'), unitIdx = canonicalIndex(header, 'unit'), rateIdx = canonicalIndex(header, 'rate'), amountIdx = canonicalIndex(header, 'amount');
    const qtyVal = numericValue(cells[qtyIdx]?.value), unitAsNumber = numericValue(cells[unitIdx]?.value), rateVal = numericValue(cells[rateIdx]?.value), amountVal = numericValue(cells[amountIdx]?.value);
    if (qtyVal === null || unitAsNumber === null || amountVal === null) return cells;
    const unitWord = extractUnitWordFromCells(cells, header) || 'SET'; const tolerance = Math.max(0.05, Math.abs(amountVal) * 0.001);
    if (approxEqualMoney(qtyVal * unitAsNumber, amountVal, tolerance)) { cells[qtyIdx].value = String(unitAsNumber); cells[unitIdx].value = unitWord; cells[rateIdx].value = String(qtyVal); cells[amountIdx].value = String(amountVal); return cells; }
    if (rateVal !== null && approxEqualMoney(unitAsNumber * rateVal, amountVal, tolerance)) { cells[qtyIdx].value = String(unitAsNumber); cells[unitIdx].value = unitWord; cells[rateIdx].value = String(rateVal); cells[amountIdx].value = String(amountVal); return cells; }
    return cells;
}

function guessUnit(text) { const m = String(text || '').match(/\b(Nos|No\.?|PCS|Pcs|Set|Lot|Each|M2|SQM|LM|MTR|m)\b/i); return m ? m[0].replace(/\.$/, '') : ''; }
function rowSerial(row, header) {
    const snIdx = canonicalIndex(header, 'sn');
    const raw = normText(row.cells?.[snIdx]?.value || '');
    if (/\d+\.\d+/.test(raw)) return null; // hierarchical BOQ identifiers, not sequential serials
    const m = raw.match(/^\d+$/) || raw.match(/\b(\d{1,4})\b/);
    return m ? parseInt(m[0], 10) : null;
}
function firstSerial(table) { for (const row of table.rows || []) { const sn = rowSerial(row, table.header); if (sn !== null) return sn; } return null; }
function lastSerial(table) { for (let i = (table.rows || []).length - 1; i >= 0; i--) { const sn = rowSerial(table.rows[i], table.header); if (sn !== null) return sn; } return null; }
function normalizeHeaderFingerprint(header) { return (header || []).map(h => classifyHeader(h) || normText(h).toLowerCase().replace(/[^a-z0-9]+/g, '')).join('|'); }
function shouldMergeTables(prev, curr) {
    if (!prev || !curr) return false;
    const prevLast = lastSerial(prev), currFirst = firstSerial(curr);
    if (prevLast !== null && currFirst !== null && currFirst >= prevLast && currFirst <= prevLast + 3) return true;
    const prevFp = normalizeHeaderFingerprint(prev.header), currFp = normalizeHeaderFingerprint(curr.header);
    if (prevFp === currFp) return true;
    const compatibleWidth = Math.abs((prev.header?.length || 0) - (curr.header?.length || 0)) <= 2;
    const shareCore = ['description', 'qty', 'unit'].every(type => prev.header.some(h => classifyHeader(h) === type) && curr.header.some(h => classifyHeader(h) === type));
    return compatibleWidth && shareCore;
}
function stitchTablesBySerialSequence(tables) {
    const serialTables = (tables || []).filter(t => firstSerial(t) !== null).sort((a, b) => firstSerial(a) - firstSerial(b));
    const nonSerialTables = (tables || []).filter(t => firstSerial(t) === null);
    if (serialTables.length === 0) return nonSerialTables;
    const primary = { ...serialTables[0], header: [...DEFAULT_HEADER], rows: [] };
    for (const table of serialTables) { for (const row of table.rows || []) primary.rows.push({ ...row, cells: repairCellCount(row.cells || [], primary.header) }); primary.confidence = Math.max(primary.confidence || 0, table.confidence || 0); }
    primary.rows.sort((a, b) => { const sa = rowSerial(a, primary.header), sb = rowSerial(b, primary.header); if (sa === null && sb === null) return 0; if (sa === null) return 1; if (sb === null) return -1; return sa - sb; });
    return [primary, ...nonSerialTables];
}
function removeDuplicateRows(rows, header) {
    const seenSerials = new Set(), seenKeys = new Set(), out = [];
    for (const row of rows || []) {
        const sn = rowSerial(row, header);
        const descIdx = canonicalIndex(header, 'description'), qtyIdx = canonicalIndex(header, 'qty'), amountIdx = canonicalIndex(header, 'amount');
        const key = [sn, row.cells?.[descIdx]?.value, row.cells?.[qtyIdx]?.value, row.cells?.[amountIdx]?.value].map(v => normText(v)).join('|').toLowerCase();
        if (sn !== null && seenSerials.has(sn)) continue;
        if (key && seenKeys.has(key)) continue;
        if (sn !== null) seenSerials.add(sn);
        if (key) seenKeys.add(key);
        out.push(row);
    }
    return out;
}
function buildSerialAudit(rows, header) {
    const serials = [], duplicates = [], seen = new Set();
    for (const row of rows || []) { const sn = rowSerial(row, header); if (sn === null) continue; if (seen.has(sn)) duplicates.push(sn); seen.add(sn); serials.push(sn); }
    if (!serials.length) return { foundSerials: [], missingSerials: [], duplicateSerials: [], sequenceConfidence: 0 };
    const min = Math.min(...serials), max = Math.max(...serials), missing = [];
    for (let i = min; i <= max; i++) if (!seen.has(i)) missing.push(i);
    const expectedCount = max - min + 1;
    const sequenceConfidence = expectedCount > 0 ? (expectedCount - missing.length - duplicates.length) / expectedCount : 0;
    return { expectedStart: min, expectedEnd: max, foundSerials: [...new Set(serials)].sort((a, b) => a - b), missingSerials: missing, duplicateSerials: [...new Set(duplicates)].sort((a, b) => a - b), rowCount: rows.length, sequenceConfidence: Math.max(0, Math.min(1, sequenceConfidence)) };
}




function v12Cell(value, images = []) {
    const cleanImages = Array.isArray(images) ? uniqueImages(images.filter(Boolean)) : [];
    return { value: normText(value), images: cleanImages, image: cleanImages[0] || null, isMerged: false };
}
function v12Row(values, pageNum = 1, imagesByColumn = {}) {
    return { cells: values.map((v, idx) => v12Cell(v, imagesByColumn[idx] || [])), isHeader: false, isSummary: false, pageNum, sectionLabel: '' };
}
function v12BestTable(candidates, tables) {
    const currentBest = Math.max(0, ...(tables || []).map(t => (t.rows || []).length));
    const good = candidates.filter(t => t && Array.isArray(t.rows) && t.rows.length >= 3).sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || b.rows.length - a.rows.length);
    if (!good.length) return tables;
    const best = good[0];
    if ((best.confidence || 0) >= 0.94 || best.rows.length >= currentBest) return [best];
    return tables;
}

function splitDynamicHeaderParts(headerText) {
    const h = normText(headerText);
    // Match common first-row header layouts without forcing one schema.
    // The returned names are taken from the document terminology where possible.
    if (/item\s+no\s+description\s+unit\s+qty/i.test(h)) {
        const cost = /unit\s+cost/i.test(h) ? (h.match(/Unit\s+cost\s*\([^)]*\)|Unit\s+cost/i) || ['Unit cost'])[0] : 'Unit Cost';
        const total = /total\s+cost/i.test(h) ? (h.match(/Total\s+cost\s*\([^)]*\)|Total\s+cost/i) || ['Total cost'])[0] : 'Total Cost';
        return ['Item No', 'Description', 'Unit', 'Qty', cost, total];
    }
    if (/item\s+description\s+unit\s+qty/i.test(h)) return ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'];
    return null;
}

function parseGenericDynamicHeaderTableV13(rawText) {
    const text = normText(rawText);
    if (!text) return null;

    const headerMatch = text.match(/(Item\s+No\s+Description\s+Unit\s+Qty(?:\s+Unit\s*cost\s*\([^)]*\))?(?:\s+Total\s*cost\s*\([^)]*\))?)/i)
        || text.match(/(Item\s+Description\s+Unit\s+Qty(?:\s+Rate)?(?:\s+Amount)?)/i);
    if (!headerMatch) return null;
    const header = splitDynamicHeaderParts(headerMatch[1]);
    if (!header) return null;

    const stopRx = /\b(Total\s+VAT|Grand[-\s]*Total|Grand\s+Total|VAT\s*\(|Total\s*$)/i;
    let body = text.slice(headerMatch.index + headerMatch[0].length);
    const stop = body.search(stopRx);
    if (stop > 0) body = body.slice(0, stop);

    const rows = [];
    const itemNoRx = /\b(\d+(?:\.\d+)+)\b/g;
    const starts = [...body.matchAll(itemNoRx)]
        .filter(m => !/^\d{4}$/.test(m[1]) && m.index !== undefined)
        .map(m => ({ id: m[1], index: m.index }));
    if (!starts.length) return null;

    const unitRx = /(job|m3|M3|M\.L|ML|M\.L\.|M\.L\s|M2|m2|SQM|LM|No\.?|NO|Nos|PCS|Pcs|Set|Lot|Each|Item)\b/i;
    for (let i = 0; i < starts.length; i++) {
        const id = starts[i].id;
        const segStart = starts[i].index + id.length;
        const segEnd = i + 1 < starts.length ? starts[i + 1].index : body.length;
        let seg = normText(body.slice(segStart, segEnd));
        if (!seg || /^(Total|VAT|Grand)/i.test(seg)) continue;

        const unitMatches = [...seg.matchAll(new RegExp(`\\s${unitRx.source}\\s+(\\d+(?:\\.\\d+)?)`, 'gi'))];
        if (!unitMatches.length) continue;
        const tail = unitMatches[unitMatches.length - 1];
        const unit = normText(tail[1]).replace(/\.$/, '');
        const qty = normText(tail[2]);
        let desc = normText(seg.slice(0, tail.index));
        let after = normText(seg.slice(tail.index + tail[0].length));
        const nums = after.match(/[\d,]+(?:\.\d+)?/g) || [];
        const rate = nums[0] || '';
        const amount = nums[1] || '';
        if (!desc || desc.length < 3) continue;
        // Reject section headings accidentally captured as rows without real commercial tail.
        if (/^[A-Z\s&:]+$/.test(desc) && !qty) continue;
        rows.push(v12Row([id, desc, unit, qty, rate, amount], Math.max(1, Math.ceil(rows.length / 18))));
    }
    if (rows.length < 5) return null;
    return {
        sheetName: 'BOQ Schedule',
        header,
        rows,
        columnCount: header.length,
        engineUsed: 'wordcom-hybrid-v13.2-dynamic-text-table',
        confidence: 0.975,
        extractionAudit: { rowCount: rows.length, dynamicHeader: header },
        serialAudit: { rowCount: rows.length, dynamicHeader: header }
    };
}

function parsePresentationCatalogPagesV13(rawText) {
    const text = normText(rawText);
    const pages = text.split('--- PAGE BREAK ---').map(p => p.trim()).filter(Boolean);
    if (pages.length < 2) return null;

    const rows = [];
    const header = ['SL.No / Code', 'Description', 'Unit', 'Qty', 'Unit Price', 'Total (AED)'];
    const unitPatStr = '(job|m3|M3|M\\.L\\.?|ML|No\\.?|NO|Nos|m²|m2|SQM|LM|MTR|Set|SET|Lot|Each|EA|Item|Pcs|PCS)';
    const unitRx = new RegExp(`\\b${unitPatStr}\\b`, 'i');

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
        const pageText = pages[pIdx];
        
        // Find potential item code / tag (e.g. FU-CH-01, 1.1.1, etc.)
        const codeMatch = pageText.match(/\b([A-Z0-9]{2,}\-[A-Z0-9\-]{2,})\b/) 
            || pageText.match(/\b(\d{1,3}(?:\.\d{1,3}){2,})\b/);
            
        let code = codeMatch ? codeMatch[1] : '';
        
        if (!code) {
            const snMatch = pageText.match(/^(?:Item\s+|Sl\.?\s*No\.?\s*)?(\d{1,3})\b/i);
            if (snMatch) code = snMatch[1];
        }
        
        if (!code) continue;
        
        // Extract Qty
        let qty = '';
        const qtyMatch = pageText.match(/\b(?:Qty|QTY|Quantity|Quantity Required)[:\s]+(\d+)\b/i);
        if (qtyMatch) {
            qty = qtyMatch[1];
        } else {
            const unitQtyMatch = pageText.match(new RegExp(`(\\d+)\\s+\\b${unitPatStr}\\b`, 'i'))
                || pageText.match(new RegExp(`\\b${unitPatStr}\\b\\s*[:\\s]+\\s*(\\d+)\\b`, 'i'));
            if (unitQtyMatch) {
                qty = unitQtyMatch[1] || unitQtyMatch[2];
            }
        }
        if (!qty) qty = '1';
        
        // Extract Unit
        let unit = 'Nos';
        const unitMatch = pageText.match(unitRx);
        if (unitMatch) {
            unit = unitMatch[1].replace(/\.$/, '');
        }
        
        // Extract Prices
        const priceMatches = [...pageText.matchAll(/(?:\$|AED|EUR|OMR|SR)\s*([\d,]+\.\d{2})|([\d,]+\.\d{2})\s*(?:USD|AED|EUR|OMR|SR)/gi)]
            .map(m => m[1] || m[2])
            .filter(Boolean);
            
        if (!priceMatches.length) {
            const decMatches = [...pageText.matchAll(/\b([\d,]+\.\d{2})\b/g)].map(m => m[1]);
            priceMatches.push(...decMatches);
        }
        
        const uniquePrices = [...new Set(priceMatches)].map(p => parseFloat(p.replace(/,/g, ''))).filter(p => p > 0);
        
        let rate = '';
        let amount = '';
        
        if (uniquePrices.length >= 2) {
            uniquePrices.sort((a, b) => a - b);
            rate = uniquePrices[0].toFixed(2);
            amount = uniquePrices[1].toFixed(2);
        } else if (uniquePrices.length === 1) {
            rate = uniquePrices[0].toFixed(2);
            const nQty = parseFloat(qty);
            if (nQty > 1) {
                amount = (uniquePrices[0] * nQty).toFixed(2);
            } else {
                amount = rate;
            }
        }
        
        // Extract Description
        let lines = pageText.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0 && !/Page\s+\d+|Object\s+number|Date\s*:/i.test(l));
            
        let codeLineIdx = lines.findIndex(l => l.includes(code));
        if (codeLineIdx === -1) codeLineIdx = 0;
        
        const descLines = lines.slice(codeLineIdx, codeLineIdx + 4);
        let desc = descLines.join(' ').slice(0, 300);
        
        desc = desc.replace(code, '').replace(/^\s*[:\-–—,\.]\s*/, '').trim();
        if (!desc) desc = `Product item ${code}`;

        rows.push(v12Row([code, desc, unit, qty, rate, amount], pIdx + 1));
    }

    if (rows.length < 3) return null;
    return {
        sheetName: 'BOQ Schedule',
        header,
        rows,
        columnCount: header.length,
        engineUsed: 'wordcom-hybrid-v13.3-presentation-extractor',
        confidence: 0.90,
        extractionAudit: { rowCount: rows.length },
        serialAudit: { rowCount: rows.length }
    };
}

function parseUniversalDynamicTableV13(rawText) {
    const text = normText(rawText);
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    
    let header = null;
    let headerIdx = -1;
    let headerClasses = [];
    
    for (let i = 0; i < Math.min(lines.length, 100); i++) {
        const line = lines[i];
        if (line.includes('--- PAGE BREAK ---')) continue;
        let cols = line.split(/\t| {2,}/).map(c => c.trim()).filter(Boolean);
        if (cols.length < 3) continue;
        
        const classes = cols.map(classifyHeader);
        const uniqueClasses = new Set(classes.filter(Boolean));
        
        if (uniqueClasses.size >= 3) {
            header = cols;
            headerIdx = i;
            headerClasses = classes;
            break;
        }
    }
    
    if (!header) return null;
    
    const snIdx = headerClasses.indexOf('sn');
    const descIdx = headerClasses.indexOf('description');
    const qtyIdx = headerClasses.indexOf('qty');
    const unitIdx = headerClasses.indexOf('unit');
    const rateIdx = headerClasses.indexOf('rate');
    const amountIdx = headerClasses.indexOf('amount');
    
    if (descIdx === -1) return null;
    
    const rows = [];
    let pageNum = 1;
    
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.includes('--- PAGE BREAK ---')) {
            pageNum++;
            continue;
        }
        
        const cells = line.split(/\t| {2,}/).map(c => c.trim()).filter(Boolean);
        if (cells.length < 2) continue;
        
        const classes = cells.map(classifyHeader);
        if (classes.filter(c => c === 'amount').length > 0 && /grand\s*total|subtotal|vat/i.test(line)) {
            continue;
        }
        
        let sn = '';
        let desc = '';
        let qty = '';
        let unit = 'Nos';
        let rate = '';
        let amount = '';
        
        if (cells.length === header.length) {
            if (snIdx !== -1) sn = cells[snIdx];
            if (descIdx !== -1) desc = cells[descIdx];
            if (qtyIdx !== -1) qty = cells[qtyIdx];
            if (unitIdx !== -1) unit = cells[unitIdx];
            if (rateIdx !== -1) rate = cells[rateIdx];
            if (amountIdx !== -1) amount = cells[amountIdx];
        } else {
            const numericCells = cells.filter(c => /^\d+(?:\.\d+)?$/.test(c.replace(/,/g, '').replace(/^[$\u20AC]/, '')));
            const uomCell = cells.find(c => classifyHeader(c) === 'unit');
            
            if (snIdx !== -1 && cells[0] && cells[0].length < 20 && /^[A-Z0-9.\-]+$/i.test(cells[0])) {
                sn = cells[0];
            }
            
            let longestCell = cells.reduce((a, b) => (a.length > b.length ? a : b), '');
            if (longestCell && longestCell.length > 5) {
                desc = longestCell;
            }
            
            if (uomCell) unit = uomCell;
            
            if (numericCells.length >= 3) {
                qty = numericCells[0];
                rate = numericCells[1];
                amount = numericCells[2];
            } else if (numericCells.length === 2) {
                qty = numericCells[0];
                amount = numericCells[1];
            } else if (numericCells.length === 1) {
                qty = numericCells[0];
            }
        }
        
        desc = desc.replace(/^\d+(?:\.\d+)*\s+/, '').trim();
        if (!desc || desc.length < 3 || /^(total|vat|grand)/i.test(desc)) continue;
        if (!qty && !amount && !rate) continue;
        
        rows.push(v12Row([sn, desc, unit, qty, rate, amount], pageNum));
    }
    
    if (rows.length < 3) return null;
    
    const finalHeader = header.map((h, idx) => normalizeHeaderName(h, idx));
    return {
        sheetName: 'Vendor Quote',
        header: finalHeader,
        rows,
        columnCount: finalHeader.length,
        engineUsed: 'wordcom-hybrid-v13.3-universal-dynamic',
        confidence: 0.95,
        extractionAudit: { rowCount: rows.length },
        serialAudit: { rowCount: rows.length }
    };
}

function assignRowPageNumbers(tables, directPdfText) {
    if (!tables || !tables.length || !directPdfText) return;
    
    const pages = directPdfText.split('\n--- PAGE BREAK ---\n').map(p => p.toLowerCase());
    
    for (const table of tables) {
        if (!table.rows || !table.rows.length) continue;
        
        const snIdx = canonicalIndex(table.header, 'sn');
        const descIdx = canonicalIndex(table.header, 'description');
        
        let lastKnownPageNum = 1;
        for (const row of table.rows) {
            const descVal = String(row.cells[descIdx]?.value || '').toLowerCase().trim();
            const snVal = String(row.cells[snIdx]?.value || '').toLowerCase().trim();
            
            if (descVal.length > 5) {
                let matchedPageIdx = pages.findIndex(p => p.includes(descVal) && (snVal ? p.includes(snVal) : true));
                if (matchedPageIdx === -1) {
                    matchedPageIdx = pages.findIndex(p => p.includes(descVal));
                }
                if (matchedPageIdx === -1 && snVal.length > 2) {
                    matchedPageIdx = pages.findIndex(p => p.includes(snVal));
                }
                
                if (matchedPageIdx !== -1) {
                    row.pageNum = matchedPageIdx + 1;
                    lastKnownPageNum = row.pageNum;
                } else {
                    row.pageNum = lastKnownPageNum;
                }
            } else {
                row.pageNum = lastKnownPageNum;
            }
        }
    }
}

async function pairNativeImagesToFallbackRows(tables, layouts, sessionId, directPdfText = '') {
    if (!tables || !tables.length || !layouts || !layouts.length) return;
    
    const targetDir = path.join(process.cwd(), 'public', 'temp', 'extracted_images', sessionId);
    await fs.mkdir(targetDir, { recursive: true });
    
    for (const table of tables) {
        if (!table.rows || !table.rows.length) continue;
        
        const snIdx = canonicalIndex(table.header, 'sn');
        const descIdx = canonicalIndex(table.header, 'description');
        let imgIdx = table.header.findIndex(h => classifyHeader(h) === 'image');
        
        if (imgIdx === -1) {
            console.log('[WordPdfExtractor] Fallback table has no image column. Skipping image pairing.');
            continue;
        }
        
        // Step 2: Match images on each page
        for (const layout of layouts) {
            const pageNum = layout.page;
            if (!layout.extractedImages || layout.extractedImages.length === 0) continue;
            
            const pageRows = table.rows.filter(r => r.pageNum === pageNum);
            if (!pageRows.length) continue;
            
            const pageHeight = layout.viewport?.height || 1000;
            
            // Filter out logos (aspect ratio > 2.2, or top/bottom margins) and tiny graphics
            const productImages = layout.extractedImages
                .filter(img => {
                    const ar = img.w / img.h;
                    const isProportional = ar >= 0.25 && ar <= 2.2;
                    const isNotMargin = img.y > 100 && img.y < (pageHeight - 100);
                    return img.w >= 30 && img.h >= 30 && isProportional && isNotMargin;
                })
                .sort((a, b) => a.y - b.y || a.x - b.x);
                
            if (!productImages.length) continue;
            
            console.log(`[WordPdfExtractor] Native pairing page ${pageNum}: ${pageRows.length} rows, ${productImages.length} images`);
            
            const textItems = layout.textItems || [];
            const normalize = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
            const usedImageIndices = new Set();
            
            for (let i = 0; i < pageRows.length; i++) {
                const row = pageRows[i];
                const targetSN = normalize(row.cells[snIdx]?.value || '');
                
                const snMatch = textItems.find(it => {
                    const norm = normalize(it.str);
                    const isXOk = it.x !== undefined && it.x < 150;
                    return norm === targetSN && norm.length > 0 && isXOk;
                });
                
                let descMatch = null;
                if (!snMatch) {
                    const descWords = (row.cells[descIdx]?.value || '')
                        .split(/\s+/)
                        .map(w => normalize(w))
                        .filter(w => w.length > 3);
                        
                    if (descWords.length > 0) {
                        const firstTargetWord = descWords[0];
                        descMatch = textItems.find((it, itIdx) => {
                            const normStr = normalize(it.str);
                            if (normStr !== firstTargetWord) return false;
                            
                            if (descWords.length > 1) {
                                const secondTargetWord = descWords[1];
                                const limit = Math.min(textItems.length, itIdx + 6);
                                for (let nextIdx = itIdx + 1; nextIdx < limit; nextIdx++) {
                                    if (normalize(textItems[nextIdx].str) === secondTargetWord) {
                                        return true;
                                    }
                                }
                                return false;
                            }
                            return true;
                        });
                    }
                }
                
                const anchorY = snMatch ? snMatch.y : (descMatch ? descMatch.y : null);
                
                // Find all unused images on the page that lie within Y-proximity (e.g. 150px)
                const matchedImages = [];
                if (anchorY !== null) {
                    for (let j = 0; j < productImages.length; j++) {
                        if (usedImageIndices.has(j)) continue;
                        const img = productImages[j];
                        const imgCenterY = img.y + img.h / 2;
                        if (Math.abs(imgCenterY - anchorY) < 150) {
                            matchedImages.push({ img, idx: j });
                        }
                    }
                }
                
                if (matchedImages.length > 0) {
                    // Sort matched images left-to-right (by X coordinate)
                    matchedImages.sort((a, b) => a.img.x - b.img.x);
                    
                    const rowImages = [];
                    for (const item of matchedImages) {
                        usedImageIndices.add(item.idx);
                        const filename = `page_${pageNum}_row_${i}_img_${item.idx}_${crypto.randomUUID().slice(0, 8)}.png`;
                        const destPath = path.join(targetDir, filename);
                        try {
                            await fs.copyFile(item.img.path, destPath);
                            rowImages.push({ url: `/temp/extracted_images/${sessionId}/${filename}` });
                        } catch (e) {
                            console.error(`[WordPdfExtractor] Failed to copy native image: ${e.message}`);
                        }
                    }
                    
                    if (rowImages.length > 0) {
                        row.cells[imgIdx].image = rowImages[0];
                        row.cells[imgIdx].images = rowImages;
                        console.log(`[WordPdfExtractor] Paired ${rowImages.length} images (Y-proximity) to row ${row.cells[snIdx]?.value || i} page ${pageNum}`);
                    }
                } else {
                    // Fallback to first available unused image
                    let firstUnusedIdx = -1;
                    for (let j = 0; j < productImages.length; j++) {
                        if (!usedImageIndices.has(j)) {
                            firstUnusedIdx = j;
                            break;
                        }
                    }
                    if (firstUnusedIdx !== -1) {
                        usedImageIndices.add(firstUnusedIdx);
                        const img = productImages[firstUnusedIdx];
                        const filename = `page_${pageNum}_row_${i}_img_${firstUnusedIdx}_${crypto.randomUUID().slice(0, 8)}.png`;
                        const destPath = path.join(targetDir, filename);
                        try {
                            await fs.copyFile(img.path, destPath);
                            row.cells[imgIdx].image = { url: `/temp/extracted_images/${sessionId}/${filename}` };
                            row.cells[imgIdx].images = [{ url: `/temp/extracted_images/${sessionId}/${filename}` }];
                            console.log(`[WordPdfExtractor] Fallback paired image to row ${row.cells[snIdx]?.value || i} page ${pageNum}`);
                        } catch (e) {
                            console.error(`[WordPdfExtractor] Failed to copy native image: ${e.message}`);
                        }
                    }
                }
            }
        }
    }
}

function recoverUniversalV12RowsFromFullText($, imageMap, tables, directPdfText = '') {
    const rawText = directPdfText || String($ ? $('body').text() || '' : '').replace(/\u00a0/g, ' ');
    const candidates = [
        parseUniversalDynamicTableV13(rawText),
        parseGenericDynamicHeaderTableV13(rawText),
        parseBillNoV12(rawText),
        parseSerialFinancialV12(rawText),
        parseFfeCodeScheduleV12(rawText),
        parseTeknionCompactQuoteV12(rawText),
        parseSedusOfmlQuoteV12(rawText),
        parseNestedFurnitureScheduleV12(rawText),
        parseCivilHierarchicalBoqV12(rawText),
        parsePageItemTenderV12(rawText),
        parsePresentationCatalogPagesV13(rawText)
    ].filter(Boolean);
    console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} candidates=${candidates.map(c => `${c.engineUsed}:${c.rows?.length || 0}`).join(', ') || 'none'}`);
    return v12BestTable(candidates, tables);
}
function parseBillNoV12(rawText) {
    const text = normText(rawText);
    if (!/Bill\s+No\.?\s*\d+\.\d+/i.test(text)) return null;
    if (!/(Item\s+Code|Item\s+Name|Item\s+Description|Item\s+Details).{0,160}(UOM|Quant\s*ity|Qty).{0,100}(Rate|Amount)/i.test(text)) return null;
    const header = ['Item Code', 'Item Name', 'Item Description', 'Additional Information', 'UOM', 'Quantity', 'Rate', 'Amount'];
    const starts = [...text.matchAll(/Bill\s+No\.?\s*([0-9]+(?:\.[0-9]+)*)\s*/gi)];
    const rows = [];
    for (let i = 0; i < starts.length; i++) {
        const billNo = starts[i][1]; const start = starts[i].index + starts[i][0].length; const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
        let seg = normText(text.slice(start, end)).replace(/\s+(?:Page\s+\d+\s+of\s+\d+|GSM\s+No\.:|Total\s+VAT\s+G\.Total|TOTAL\s+VAT\s+INCL\.).*$/i, ' ').trim();
        const tails = [...seg.matchAll(/\b(No\.?|Nos|EA|SET|PCS|Pcs|Lot|Each|M2|SQM|LM|Item)\b\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/gi)];
        if (!tails.length) continue; const tail = tails[0];
        const uom = normText(tail[1]), qty = normText(tail[2]); let rate = normText(tail[3]), amount = normText(tail[4]);
        if (rate === billNo) { const next = (seg.slice(tail.index + tail[0].length).match(/\b[\d,]+(?:\.\d+)?\b/) || [])[0]; if (next) { rate = amount; amount = next; } }
        let before = normText(seg.slice(0, tail.index)); let info = ''; const idxInfo = Math.max(before.toLowerCase().lastIndexOf('item code'), before.toLowerCase().lastIndexOf('item no'));
        if (idxInfo >= 0) { info = before.slice(idxInfo).trim(); before = before.slice(0, idxInfo).trim(); }
        let name = '', desc = before; const mName = before.match(/^(LOOSE\s+(?:FURNITURE|EQUIPMENT|ITEM)\s*-\s*[^-]+|Furniture\s+and\s+fittings|Funiture\s+and\s+fiitings)\s*-?\s*(.*)$/i);
        if (mName) { name = normText(mName[1]); desc = normText(mName[2]); } else { const cm = before.match(/^([A-Z]{2,5}\d+[A-Z]?)\s*,?\s*(.*)$/); if (cm) { name = cm[1]; desc = cm[2]; } }
        rows.push(v12Row([`Bill No. ${billNo}`, name, desc || before, info, uom, qty, rate, amount], inferBillNoPageFromSerial(billNo)));
    }
    if (rows.length < 10) return null; const audit = buildBillNoAudit(rows);
    return { sheetName: 'BOQ Schedule', header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12-billno', confidence: 0.985, extractionAudit: audit, serialAudit: audit, supportsMultiImages: true };
}
function parseSerialFinancialV12(rawText) {
    const text = normText(rawText); if (!/(S\.?No|SL\.?No|SN|Sl\.No).{0,100}(Description|Discription|Item Description).{0,100}(Qty|Quantity).{0,90}(Rate|Unit Price|Amount)/i.test(text)) return null;
    const header = ['S.No', 'Image Reference', 'Description', 'Unit', 'QTY', 'Rate', 'Amount']; const starts = [...rawText.matchAll(/(?:^|\n)\s*(\d{1,3})\s+/g)].filter(m => Number(m[1]) > 0 && Number(m[1]) < 500); const rows = [];
    for (let i = 0; i < starts.length; i++) { const sn = starts[i][1]; const seg = normText(rawText.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : rawText.length)); const tail = [...seg.matchAll(/\b(SET|EA|No’s|Nos|No\.?|PCS|Pcs|Lot|Each|M2|SQM|LM|pc|set)\b\s+(\d[\d,]*)\s+([\d,]+(?:\.\d{2,3})|RATE\s+ONLY|EXCLUDED)\s+([\d,]+(?:\.\d{2,3})|RATE\s+ONLY|EXCLUDED)/gi)].pop(); if (!tail) continue; let desc = normText(seg.slice(0, tail.index)).replace(new RegExp('^' + sn + '\\s*'), '').replace(/^(CUSTOM|FAREAST|FAR\s+EAST|LOCAL\s*-?\s*UAE)\s+/i, ''); if (!desc || /TOTAL|VAT|TERMS|CONDITIONS/i.test(desc)) continue; rows.push(v12Row([sn, '', desc, tail[1], tail[2], tail[3], tail[4]], Math.max(1, Math.ceil(Number(sn) / 10)))); }
    if (rows.length < 8) return null; const audit = buildSerialAudit(rows, header); return { sheetName: 'BOQ Schedule', header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12-serial-financial', confidence: rows.length >= 20 ? 0.97 : 0.93, extractionAudit: audit, serialAudit: audit, supportsMultiImages: true };
}
function parseFfeCodeScheduleV12(rawText) { const text = normText(rawText); if (!/CODE\s+AREA\s+DESCRIPTION\s+IMAGE/i.test(text) && !/LEVEL\s+1.*TOTAL\s+QUANTITY\s+ITEM\s+UNIT\s+RATE/i.test(text)) return null; const header = ['Code', 'Area', 'Description', 'Level / Area Qty Split', 'Total Quantity', 'Unit', 'Unit Rate', 'Total Amount']; const starts = [...text.matchAll(/\b((?:FU|FF|RUG|P|TB|CH|AC|S|L|DR|CB|SF|CT|ST|WO|BOA|BIN|HOL|TRO|TAB|DES|CAB|MSF|SHE|LOC|DRA|RAC|WAR|BED|MAT|KETTLE|COFFEE\s+MACHINE|DISHWASHER|MINI\s+FRIDGE|MICROWAVE\s+OVEN)[A-Z0-9\-]*)\b/g)].filter(m => !/^(CODE|DATE|PROJECT)$/i.test(m[1])); const rows = []; for (let i = 0; i < starts.length; i++) { const code = normText(starts[i][1]); const seg = normText(text.slice(starts[i].index + starts[i][0].length, i + 1 < starts.length ? starts[i + 1].index : text.length)); const tail = seg.match(/((?:\d+\s+){0,6})(\d+)\s+(ITEM|pc|pcs|set|Nos|No\.?|EA)\s+([\d,]+\.\d{2,3}|ARTWORK|INCLUDED\s+IN\s+PS\s+RATE|RATE\s+ONLY)\s+([\d,]+\.\d{2,3}|RATE\s+ONLY|INCLUDED\s+IN\s+PS\s+RATE)?/i); if (!tail) continue; const desc = normText(seg.slice(0, tail.index)); if (!desc || /BILL NO\.|PROJECT SUBMISSION|DATE|REVISION/i.test(desc)) continue; rows.push(v12Row([code, '', desc, normText(tail[1]), tail[2], tail[3], tail[4], tail[5] || ''], Math.max(1, Math.ceil((rows.length + 1) / 4)))); } if (rows.length < 8) return null; return { sheetName: 'FFE Schedule', header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12-ffe-code-schedule', confidence: 0.955, extractionAudit: { rowCount: rows.length }, supportsMultiImages: true }; }
function parseTeknionCompactQuoteV12(rawText) { const text = normText(rawText); if (!/teknion/i.test(text) || !/Unit\s+Net\s+Price.*Ext\.?\s+Net\s+Price.*USD/i.test(text)) return null; const header = ['Item', 'Item Code', 'Description', 'QTY', 'Unit Net Price USD', 'Ext. Net Price USD']; const rx = /(\d{3})\.\s+([A-Z]{2}-[A-Z]{2}-[A-Z0-9]+)\s+Description:\s*(\d[\d,]*)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+(.+?)(?=\s+\d{3}\.\s+[A-Z]{2}-|\s+teknion\s+Page|\s+Total\s+Product\s+Net|$)/gi; const rows = []; let m; while ((m = rx.exec(text)) !== null) rows.push(v12Row([m[1], m[2], m[6], m[3], m[4], m[5]], Math.max(1, Math.ceil(rows.length / 6)))); if (rows.length < 10) return null; return { sheetName: 'Vendor Quote', header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12-teknion-quote', confidence: 0.965, extractionAudit: { rowCount: rows.length, totalProductNet: (text.match(/Total\s+Product\s+Net[^$]*\$([\d,]+\.\d{2})/i) || [])[1] || '' }, supportsMultiImages: true }; }
function parseSedusOfmlQuoteV12(rawText) { const text = normText(rawText); if (!/Article\s+code\s*\/\s*description/i.test(text) || !/Quantity\s+SP\/EUR\s*\(excl\.\s*VAT\).*TP\/EUR/i.test(text)) return null; const header = ['Hierarchy', 'Product Code', 'Product Description', 'Included Total EUR', 'Alternative', 'Section']; const rows = []; const rx = /Intermediate\s+total:\s+((?:FU-[A-Z]{2}-[A-Z0-9]+|[A-Z]{2})[^\d]*?)\s+([\d,]+\.\d{2})/gi; let activeSection = '', m; while ((m = rx.exec(text)) !== null) { const label = normText(m[1]); const code = (label.match(/FU-[A-Z]{2}-[A-Z0-9]+/) || [''])[0]; const desc = normText(label.replace(code, '')); if (/^[A-Z]{2}$/.test(label)) activeSection = label; rows.push(v12Row(['', code || label, desc || label, m[2], 'No', activeSection])); } if (rows.length < 15) return null; const netTotal = (text.match(/Net\s+Total\s+EUR\s+([\d,]+\.\d{2})/i) || text.match(/Net\s+Total[^\d]+([\d,]+\.\d{2})/i) || [])[1] || ''; return { sheetName: 'OFML Quote Summary', header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12-sedus-ofml', confidence: 0.985, extractionAudit: { rowCount: rows.length, netTotal }, supportsMultiImages: true }; }
function parseNestedFurnitureScheduleV12(rawText) { const text = normText(rawText); if (!/PRODUCT\s+DESCRIPTION\s+PRODUCT\s+DIMS/i.test(text) && !/UNIT\s+PRICE\s+IN\s+OMR\s+SUB\s+TOTAL/i.test(text)) return null; const header = ['Code', 'Description', 'Product Description', 'Product Dims', 'QTY', 'Unit Price OMR', 'Sub Total OMR']; const rx = /\b([A-Z]{2}\d{2}|WO\d{2}|ST\d{2}|CH\d{2}|SF\d{2}|TB\d{2})\b\s+([A-Z][A-Z \-/&]+?)\s+(.+?)\s+((?:STANDARD|Dia:?\s?\d+D?|\d{2,4}[W\*×].{0,80}?|MAIN\s+TABLE[:：].{0,80}?|\d{3,4}\*\d{2,4}\*?\d{0,4}H?))\s+(\d{1,4})\s+(?:0\.00|([\d,]+\.\d{2})\s+([\d,]+\.\d{2}))?/gi; const rows = []; let m; while ((m = rx.exec(text)) !== null) { const desc = normText(m[2]); if (/^(CODE|AREA|IMAGE|PRODUCT|OFFICE|FIRST|SECOND)$/i.test(desc)) continue; rows.push(v12Row([m[1], desc, m[3], m[4], m[5], m[6] || '0.00', m[7] || '0.00'])); } if (rows.length < 8) return null; return { sheetName: 'Furniture Schedule', header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12-nested-furniture', confidence: 0.945, extractionAudit: { rowCount: rows.length }, supportsMultiImages: true }; }
function parseCivilHierarchicalBoqV12(rawText) {
    const text = normText(rawText);
    // Detection: require Grand-Total/VAT marker
    const hasTotal = /Grand[-\u2010‐\u2013\u2014\s]*Total|VAT\s*\(/i.test(text);
    if (!hasTotal) return null;

    const header = ['Item No', 'Description', 'Unit', 'Qty', 'Unit Cost', 'Total Cost'];
    const unitPatStr = '(job|m3|M3|M\\.L\\.?|ML|No\\.?|NO|Nos|m²|m2|SQM|LM|M\\.T)';

    // Find the stop point (Total / VAT / Grand-Total)
    const stopRx = /\b(Total\s+VAT|Grand[-\u2010‐\u2013\u2014\s]*Total|VAT\s*\()/im;
    let workText = text;
    const stopMatch = workText.match(stopRx);
    if (stopMatch && stopMatch.index) workText = workText.slice(0, stopMatch.index);

    // --- Pass 1: Collect all candidate hierarchical IDs and their positions ---
    const candidateRx = /\b(\d{1,3}(?:\.\d{1,3})+)\b/g;
    const allCandidates = [...workText.matchAll(candidateRx)].map(m => ({
        id: m[1], index: m.index, parts: m[1].split('.').map(Number)
    }));
    // --- Pass 1.5: Reject candidates that appear inside parentheses (measurements like "(2.4 m)") ---
    const filteredCandidates = allCandidates.filter(c => {
        // Check ~20 chars before and after the match for enclosing parens
        const before = workText.slice(Math.max(0, c.index - 15), c.index);
        const after = workText.slice(c.index + c.id.length, c.index + c.id.length + 15);
        if (/\(\s*$/.test(before) && /^\s*(m|mm|cm|M|ft|in|kg|%)/.test(after)) return false;
        return true;
    });

    // --- Pass 2: Keep only IDs that look like BOQ item numbers ---
    // Strategy: a true item number X.Y should have siblings X.Z nearby (sequential under same parent)
    // or appear as X.Y.Z (3+ levels always treated as item numbers)
    function isLikelyItemNo(cand, allCands) {
        // 3+ level depth is always a real item number (e.g., 6.3.1)
        if (cand.parts.length >= 3) return true;
        // For 2-level (X.Y): child part should be small (item sub-numbers are usually 1-20)
        const parent = cand.parts[0];
        const child = cand.parts[1];
        if (child > 20) return false; // e.g., 2.83 → child=83
        if (parent > 50) return false; // e.g., 68.7 → parent too large for typical BOQ section
        // Must have at least one sibling within 1500 chars (same parent, adjacent child)
        const siblings = allCands.filter(c =>
            c.id !== cand.id && c.parts.length >= 2 && c.parts[0] === parent
            && Math.abs(c.parts[1] - child) <= 2
            && Math.abs(c.index - cand.index) < 1500
        );
        if (siblings.length >= 1) return true;
        // Fallback: single sub-item under a section (e.g., "7 Grill Cover : 960 7.1 Provide...")
        // Accept if the bare parent number appears as a standalone section header nearby
        const nearby = workText.slice(Math.max(0, cand.index - 500), cand.index);
        const sectionRx = new RegExp(`(?:^|\\s)${parent}\\s+[A-Z]`, 'm');
        if (sectionRx.test(nearby) && child <= 5) return true;
        return false;
    }

    const validItems = filteredCandidates.filter(c => isLikelyItemNo(c, filteredCandidates));
    if (validItems.length < 3) return null;

    // Must have at least 2 unit keywords to confirm this is a BOQ
    const unitCount = (workText.match(new RegExp(`\\b${unitPatStr}\\b`, 'gi')) || []).length;
    if (unitCount < 2) return null;

    // --- Pass 3: Parse rows from identified item number positions ---
    const rows = [];
    for (let i = 0; i < validItems.length; i++) {
        const item = validItems[i];
        const segStart = item.index + item.id.length;
        const segEnd = i + 1 < validItems.length ? validItems[i + 1].index : workText.length;
        const seg = normText(workText.slice(segStart, segEnd));
        if (!seg || seg.length < 3) continue;

        // Try to find unit keyword + qty in the segment
        const unitQtyRx = new RegExp(`(.+?)\\s+\\b${unitPatStr}\\b\\s+(\\d+(?:\\.\\d+)?)(?:\\s+([\\d,]+(?:\\.\\d+)?))?(?:\\s+([\\d,]+(?:\\.\\d+)?))?`, 'i');
        const match = seg.match(unitQtyRx);
        if (!match) {
            // Section header (e.g., "7 Grill Cover :") — skip silently
            continue;
        }
        let desc = normText(match[1]);
        // Clean leading section numbers from desc (e.g., "Supply and build..." not "6.3.1 Supply...")
        desc = desc.replace(/^\d+(?:\.\d+)*\s+/, '');
        // Clean surrounding quotes from desc
        desc = desc.replace(/^[""]|[""]$/g, '');
        if (!desc || desc.length < 3) continue;
        if (/^(total|vat|grand)/i.test(desc)) continue;

        const unit = match[2].replace(/\.$/, '');
        const qty = match[3];
        let unitCost = match[4] || '';
        let totalCost = match[5] || '';

        // Clean false costs that are actually section parent numbers
        // e.g., after "m3 2.12" the text has "7 Grill Cover" → "7" captured as unit cost
        const sectionParents = new Set(validItems.map(v => v.parts[0]));
        if (unitCost && /^\d{1,2}$/.test(unitCost) && sectionParents.has(parseInt(unitCost, 10))) unitCost = '';
        if (totalCost && /^\d{1,2}$/.test(totalCost) && sectionParents.has(parseInt(totalCost, 10))) totalCost = '';
        // Also clear if totalCost looks like a hierarchical ID (e.g., "8.1")
        if (totalCost && /^\d+\.\d+$/.test(totalCost) && validItems.some(v => v.id === totalCost)) totalCost = '';

        rows.push(v12Row([item.id, desc, unit, qty, unitCost, totalCost]));
    }
    if (rows.length < 3) return null;
    return {
        sheetName: 'Civil BOQ',
        header,
        rows,
        columnCount: header.length,
        engineUsed: 'wordcom-hybrid-v12-civil-hierarchical',
        confidence: 0.94,
        extractionAudit: { rowCount: rows.length },
        supportsMultiImages: false
    };
}
function parsePageItemTenderV12(rawText) { const text = normText(rawText); if (!/Page\s+Item\s+Description\s+Uom\s+Quantity\s+Rate\s+Amount\s+Total/i.test(text)) return null; const header = ['Page', 'Item', 'Description', 'UOM', 'Quantity', 'Rate', 'Amount']; const rx = /\b(\d{1,3})\s+(\d{1,3})\s+(.+?)\s+\b(Item|No|m²|m2|m|Tonnes)\s+([\d,]+\.\d{2})\s+([\d, ]+\.\d{2})(?:\s+([\d, ]+\.\d{2}))?/gi; const rows = []; let m; while ((m = rx.exec(text)) !== null) rows.push(v12Row([m[1], m[2], m[3], m[4], m[5], m[6], m[7] || ''])); if (rows.length < 8) return null; return { sheetName: 'Tender BOQ', header, rows, columnCount: header.length, engineUsed: 'wordcom-hybrid-v12-page-item-tender', confidence: 0.935, extractionAudit: { rowCount: rows.length }, supportsMultiImages: false }; }

function normalizeBillText(value) {
    return normText(String(value || '').replace(/\s+/g, ' '));
}

function isLikelyNoImageDynamicBill(bodyText) {
    return /Bill\s+No\.?\s*\d+\.\d+/i.test(bodyText) && /(Item\s+Code|Item\s+Name|Item\s+Description|Item\s+Details).{0,160}(UOM|Quant\s*ity|Qty).{0,100}(Rate|Amount)/i.test(bodyText);
}

function buildBillNoCell(value) {
    return { value: normalizeBillText(value), images: [], image: null, isMerged: false };
}


function recoverDynamicBillNoRowsFromFullText($, tables) {
    if ((tables || [])[0]?.engineUsed?.includes('wordcom-hybrid-v12-billno')) return tables;
    const bodyText = normalizeBillText($('body').text());
    if (!bodyText || !isLikelyNoImageDynamicBill(bodyText)) return tables;

    const header = ['Item Code', 'Item Name', 'Item Details', 'Additional Information', 'UOM', 'Quantity', 'Rate', 'Amount'];
    const rows = [];

    // More robust than one giant regex: split on every Bill No. token, then parse each segment tail-first.
    // This prevents late-page rows from being swallowed when Word COM merges line breaks or footer text.
    const billSplitRx = /Bill\s+No\.?\s*([0-9]+(?:\.[0-9]+)*)\s*/gi;
    const matches = [...bodyText.matchAll(billSplitRx)];
    for (let i = 0; i < matches.length; i++) {
        const billNo = matches[i][1];
        const start = matches[i].index + matches[i][0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index : bodyText.length;
        let segment = normalizeBillText(bodyText.slice(start, end));
        segment = segment.replace(/\s+GSM\s+No\.:.*$/i, '').replace(/\s+Total\s+VAT\s+G\.Total.*$/i, '').trim();
        if (!segment) continue;

        // Final-page rows can be followed by summary figures after the row amount, e.g.
        // "No. 1 2400 2,400.000 135,529.000 6,776.45 142,305.45 Total VAT G.Total".
        // Therefore do not anchor the commercial tail to segment end; take the last valid UOM-Qty-Rate-Amount match.
        const tailRx = /\s+(No\.?|Nos|PCS|Pcs|Set|Lot|Each|M2|SQM|LM)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/gi;
        const tailMatches = [...segment.matchAll(tailRx)];
        const tail = tailMatches.length ? tailMatches[tailMatches.length - 1] : null;
        if (!tail) continue;

        const uom = normalizeBillText(tail[1]);
        const quantity = normalizeBillText(tail[2]);
        const rate = normalizeBillText(tail[3]);
        const amount = normalizeBillText(tail[4]);
        let beforeTail = normalizeBillText(segment.slice(0, tail.index));

        // Additional information is normally the last "Item Code ..." or "Item No. ..." block before UOM.
        let additionalInfo = '';
        let itemPart = beforeTail;
        const infoMatch = beforeTail.match(/\b(Item\s+(?:Code|No)\.?\s*[A-Za-z0-9\-\/_, ]*)$/i);
        if (infoMatch) {
            additionalInfo = normalizeBillText(infoMatch[1]);
            itemPart = normalizeBillText(beforeTail.slice(0, beforeTail.length - infoMatch[1].length));
        } else {
            const idxCode = Math.max(beforeTail.toLowerCase().lastIndexOf('item code'), beforeTail.toLowerCase().lastIndexOf('item no'));
            if (idxCode >= 0) {
                additionalInfo = normalizeBillText(beforeTail.slice(idxCode));
                itemPart = normalizeBillText(beforeTail.slice(0, idxCode));
            }
        }

        let itemName = '';
        let itemDetails = itemPart;
        const knownName = itemPart.match(/^(Funiture\s+and\s+fiitings|Furniture\s+and\s+fittings)\b\s*(.*)$/i);
        if (knownName) {
            itemName = normalizeBillText(knownName[1]);
            itemDetails = normalizeBillText(knownName[2]);
        } else {
            const supplyIdx = itemPart.toLowerCase().indexOf('supplying and fixing');
            if (supplyIdx > 0) {
                itemName = normalizeBillText(itemPart.slice(0, supplyIdx));
                itemDetails = normalizeBillText(itemPart.slice(supplyIdx));
            } else {
                const parts = itemPart.split(/\s{2,}/).filter(Boolean);
                itemName = normalizeBillText(parts.shift() || '');
                itemDetails = normalizeBillText(parts.join(' ') || itemPart);
            }
        }

        // Reject non-row fragments and summary rows.
        if (!itemName && !itemDetails) continue;
        if (/^(total|vat|g\.total|gsm no)/i.test(itemDetails)) continue;

        rows.push({
            cells: [
                `Bill No. ${billNo}`,
                itemName,
                itemDetails,
                additionalInfo,
                uom,
                quantity,
                rate,
                amount
            ].map(buildBillNoCell),
            isHeader: false,
            isSummary: false,
            pageNum: inferBillNoPageFromSerial(billNo),
            sectionLabel: ''
        });
    }

    // Only take over if tail-first parsing is clearly better or specifically matches this no-image Bill No BOQ.
    const currentBest = Math.max(0, ...(tables || []).map(t => (t.rows || []).length));
    if (rows.length < 10 || rows.length < currentBest) return tables;

    const audit = buildBillNoAudit(rows);
    return [{
        sheetName: 'BOQ Schedule',
        header,
        rows,
        columnCount: header.length,
        engineUsed: 'wordcom-hybrid-v12-billno-legacy',
        confidence: 0.96,
        extractionAudit: audit,
        serialAudit: audit
    }];
}


function inferBillNoPageFromSerial(serialText, rowsPerPage = 12) {
    const n = parseFloat(String(serialText || '').split('.').pop() || '1');
    if (!Number.isFinite(n) || n <= 0) return 1;
    // Dynamic page inference: estimate page from row index using configurable rows-per-page
    return Math.max(1, Math.ceil(n / Math.max(1, rowsPerPage)));
}

function buildBillNoAudit(rows) {
    const nums = [];
    for (const row of rows || []) {
        const raw = row.cells?.[0]?.value || '';
        const m = String(raw).match(/(\d+)\.(\d+)/);
        if (m) nums.push(parseInt(m[2], 10));
    }
    const seen = new Set(nums);
    const min = nums.length ? Math.min(...nums) : 0;
    const max = nums.length ? Math.max(...nums) : 0;
    const missing = [];
    for (let i = min; i <= max; i++) if (!seen.has(i)) missing.push(i);
    const duplicates = nums.filter((n, i) => nums.indexOf(n) !== i);
    return {
        expectedStart: min,
        expectedEnd: max,
        foundSerials: [...seen].sort((a, b) => a - b),
        missingSerials: missing,
        duplicateSerials: [...new Set(duplicates)].sort((a, b) => a - b),
        rowCount: rows.length,
        sequenceConfidence: max >= min && max > 0 ? Math.max(0, Math.min(1, (max - min + 1 - missing.length - duplicates.length) / (max - min + 1))) : 0
    };
}

function recoverMissingSerialRowsFromFullText($, tables) {
    if (!tables || !tables.length) return tables;
    const primary = tables[0];
    if (!primary || !primary.header || !primary.header.some(h => classifyHeader(h) === 'sn')) return tables;
    const bodyText = normText($('body').text());
    if (!bodyText) return tables;

    const imgIdx = primary.header.findIndex(h => classifyHeader(h) === 'image');
    const snIdx = canonicalIndex(primary.header, 'sn');
    const descIdx = canonicalIndex(primary.header, 'description');
    const qtyIdx = canonicalIndex(primary.header, 'qty');
    const unitIdx = canonicalIndex(primary.header, 'unit');
    const rateIdx = canonicalIndex(primary.header, 'rate');
    const amountIdx = canonicalIndex(primary.header, 'amount');
    const found = new Set((primary.rows || []).map(r => rowSerial(r, primary.header)).filter(n => n !== null));
    const recovered = [];

    const rowRx = /(?:^|\s)(\d{1,4})\s+(LOCAL\s*-?\s*UAE|FAR\s+EAST|LOCAL-UAE|LOCAL UAE)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(Nos|No\.?|PCS|Pcs|Set|Lot|Each|M2|SQM|LM)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)(?=\s+(?:\d{1,4}\s+(?:LOCAL\s*-?\s*UAE|FAR\s+EAST|LOCAL-UAE|LOCAL UAE)|TOTAL|VAT|TERMS|GRAND\s*TOTAL|Sub\s*-?\s*Total|Note\s*:|Prepared\s+by|Page\s+\d+|GSM\s+No|TOTAL\s+VALUE|Signature|Authorized|TOTAL\s+C\/?F)|\s*$)/gi;
    let m;
    while ((m = rowRx.exec(bodyText)) !== null) {
        const serial = parseInt(m[1], 10);
        if (found.has(serial)) continue;
        const cells = Array(primary.header.length).fill(null).map(() => emptyCell());
        cells[snIdx].value = String(serial);
        if (imgIdx >= 0) cells[imgIdx].value = m[2].replace(/\s+/g, ' ').toUpperCase().replace('LOCAL UAE', 'LOCAL-UAE').replace('FAREAST', 'FAR EAST');
        cells[descIdx].value = normText(m[3]);
        cells[qtyIdx].value = m[4];
        cells[unitIdx].value = m[5].replace(/\.$/, '');
        cells[rateIdx].value = m[6];
        cells[amountIdx].value = m[7];
        recovered.push({ cells, isHeader: false, isSummary: false, sectionLabel: '', pageNum: 1, recoveredFromText: true });
        found.add(serial);
    }
    if (!recovered.length) return tables;
    // Image recovery: copy images from existing rows with matching descriptions
    for (const recRow of recovered) {
        const recDesc = normText(recRow.cells[descIdx]?.value || '').toLowerCase();
        if (!recDesc || recDesc.length < 10) continue;
        const recWords = recDesc.split(/\s+/).filter(w => w.length >= 3).slice(0, 5);
        if (recWords.length < 2) continue;
        for (const existingRow of primary.rows) {
            const existDesc = normText(existingRow.cells?.[descIdx]?.value || '').toLowerCase();
            if (!existDesc) continue;
            const matchCount = recWords.filter(w => existDesc.includes(w)).length;
            if (matchCount >= Math.min(3, recWords.length)) {
                const existImg = existingRow.cells?.[imgIdx >= 0 ? imgIdx : -1];
                if (existImg && existImg.images && existImg.images.length > 0) {
                    recRow.cells[imgIdx].images = [...existImg.images];
                    recRow.cells[imgIdx].image = existImg.images[0] || null;
                    break;
                }
            }
        }
    }
    primary.rows.push(...recovered);
    primary.rows.sort((a, b) => {
        const sa = rowSerial(a, primary.header);
        const sb = rowSerial(b, primary.header);
        if (sa === null && sb === null) return 0;
        if (sa === null) return 1;
        if (sb === null) return -1;
        return sa - sb;
    });
    primary.rows = removeDuplicateRows(primary.rows, primary.header);
    const audit = buildSerialAudit(primary.rows, primary.header);
    primary.extractionAudit = audit;
    primary.serialAudit = audit;
    primary.columnCount = primary.header.length;
    return tables;
}

function recoverMissingFinalSerialRowsV13($, tables, directPdfText = '') {

    if (!tables || !tables.length) return tables;
    const primary = tables[0];
    if (!primary || !primary.header || !primary.header.some(h => classifyHeader(h) === 'sn')) return tables;
    const htmlText = String($('body').text() || '');
    const bodyText = normText([htmlText, directPdfText].filter(Boolean).join(' '));
    console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} final-row text source htmlChars=${htmlText.length} directChars=${directPdfText ? directPdfText.length : 0}`);
    if (!bodyText) return tables;
    const found = new Set((primary.rows || []).map(r => rowSerial(r, primary.header)).filter(n => n !== null));
    // Text serial detection: match serial numbers followed by known origin keywords or capitalized words
    // NOTE: Do NOT use a broad "number + letter" match here — it creates false positives
    // from dimension strings like "120X60CM" or "25mm" embedded in descriptions
    const textSerials = [...bodyText.matchAll(/(?:^|\s)(\d{1,4})\s+(?:LOCAL\s*-?\s*UAE|LOCAL-UAE|FAR\s+EAST|FAREAST|[A-Z][A-Za-z]{2,})\b/gi)]
        .map(m => parseInt(m[1], 10))
        .filter(n => Number.isFinite(n) && n > 0 && n < 1000);
    // Also consider serials we already have — if we have serial N, then N+1 might be the missing last row
    const parsedMax = found.size ? Math.max(...found) : 0;
    // Cap at parsedMax + 3 to avoid runaway recovery from false text matches
    const maxTextSerial = Math.min(
        Math.max(textSerials.length ? Math.max(...textSerials) : 0, parsedMax + 1),
        parsedMax + 3
    );
    const targetSerials = []; for (let n = 1; n <= maxTextSerial; n++) if (!found.has(n)) targetSerials.push(n);
    console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} final-row scan: parsedMax=${parsedMax} textMax=${maxTextSerial} targets=${JSON.stringify(targetSerials)}`);
    const snIdx = canonicalIndex(primary.header, 'sn'), imgIdx = primary.header.findIndex(h => classifyHeader(h) === 'image'), descIdx = canonicalIndex(primary.header, 'description'), qtyIdx = canonicalIndex(primary.header, 'qty'), unitIdx = canonicalIndex(primary.header, 'unit'), rateIdx = canonicalIndex(primary.header, 'rate'), amountIdx = canonicalIndex(primary.header, 'amount');
    const recovered = [];
    for (const serial of targetSerials) {
        // Strategy 1: Normal match — serial followed by whitespace
        const startRx = new RegExp(`(?:^|\\s)${serial}\\s+`, 'g'); let startMatch;
        let matched = false;
        while ((startMatch = startRx.exec(bodyText)) !== null) {
            const start = startMatch.index + startMatch[0].search(String(serial)); const rest = bodyText.slice(start);
            if (!new RegExp(`^${serial}\\s+.{0,2200}?(Nos|No\\.?|PCS|Pcs|Set|SET|EA|Each|Item|Lot|M2|SQM|LM)\\s+[\\d,]+(?:\\.\\d+)?\\s+[\\d,]+(?:\\.\\d+)?`, 'i').test(rest)) continue;
            const nextOrTotal = rest.match(new RegExp(`\\s(?:${serial + 1}\\s+|TOTAL\\s+VALUE|TOTAL\\s+C\\/?F|GRAND\\s*TOTAL|Sub\\s*-?\\s*Total|VAT\\s*(?:5%?|@)|TERMS\\s*&\\s*CONDITIONS|Page\\s+\\d+|Note\\s*:|Prepared\\s+by|Signature|Authorized|GSM\\s+No)`, 'i'));
            const segment = normText(rest.slice(0, nextOrTotal && nextOrTotal.index ? nextOrTotal.index : Math.min(rest.length, 2200)));
            const tailMatches = [...segment.matchAll(/(\d+(?:\.\d+)?)\s+(Nos|No\.?|PCS|Pcs|Set|SET|EA|Each|Item|Lot|M2|SQM|LM)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/gi)];
            if (!tailMatches.length) continue; const tail = tailMatches[tailMatches.length - 1];
            let desc = normText(segment.slice(String(serial).length, tail.index));
            if (!desc || /^(Date|Ref|Project|TOTAL|VAT|TERMS|Page)\b/i.test(desc) || /Sl\.No\s+Image\s+Reference\s+Item\s+Description/i.test(desc)) continue;
            let origin = ''; const originMatch = desc.match(/^(LOCAL\s*-?\s*UAE|LOCAL-UAE|FAR\s+EAST|FAREAST)\s+(.+)$/i);
            if (originMatch) { origin = originMatch[1].replace(/\s+/g, ' ').toUpperCase().replace('LOCAL UAE', 'LOCAL-UAE'); desc = normText(originMatch[2]); }
            const cells = Array(primary.header.length).fill(null).map(() => emptyCell());
            cells[snIdx].value = String(serial); if (imgIdx >= 0) cells[imgIdx].value = origin; cells[descIdx].value = desc; cells[qtyIdx].value = tail[1]; cells[unitIdx].value = tail[2].replace(/\.$/, ''); cells[rateIdx].value = tail[3]; cells[amountIdx].value = tail[4];
            recovered.push({ cells, isHeader: false, isSummary: false, sectionLabel: '', pageNum: primary.rows?.at(-1)?.pageNum || 1, recoveredFromFinalText: true });
            found.add(serial); matched = true; break;
        }
        if (matched) continue;

        // Strategy 2: Concatenated serial — Word COM sometimes merges the serial number
        // directly with the next word, e.g. "36upholstered" instead of "36 upholstered"
        const concatRx = new RegExp(`(?:^|\\s)(${serial})([a-zA-Z])`, 'g'); let concatMatch;
        while ((concatMatch = concatRx.exec(bodyText)) !== null) {
            const start = concatMatch.index + concatMatch[0].search(String(serial));
            const rest = bodyText.slice(start);
            // Reject if the serial+letter is actually a dimension/measurement (e.g. 120X60CM, 25mm, 180x180)
            if (/^\d+[xX×]\d|^\d+(?:mm|cm|m\b|CM|MM|D\b|W\b|H\b|L\b)/i.test(rest)) continue;
            // Validate: after the concatenated serial+text, there should be UOM + qty + rate + amount
            if (!new RegExp(`^${serial}[a-zA-Z].{0,2200}?(Nos|No\\.?|PCS|Pcs|Set|SET|EA|Each|Item|Lot|M2|SQM|LM)\\s+[\\d,]+(?:\\.\\d+)?\\s+[\\d,]+(?:\\.\\d+)?`, 'i').test(rest)) continue;
            const nextOrTotal = rest.match(new RegExp(`\\s(?:${serial + 1}\\s+|TOTAL\\s+VALUE|TOTAL\\s+C\\/?F|GRAND\\s*TOTAL|Sub\\s*-?\\s*Total|VAT\\s*(?:5%?|@)|TERMS\\s*&\\s*CONDITIONS|Page\\s+\\d+|Note\\s*:|Prepared\\s+by|Signature|Authorized|GSM\\s+No)`, 'i'));
            const segment = normText(rest.slice(0, nextOrTotal && nextOrTotal.index ? nextOrTotal.index : Math.min(rest.length, 2200)));
            const tailMatches = [...segment.matchAll(/(\d+(?:\.\d+)?)\s+(Nos|No\.?|PCS|Pcs|Set|SET|EA|Each|Item|Lot|M2|SQM|LM)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/gi)];
            if (!tailMatches.length) continue; const tail = tailMatches[tailMatches.length - 1];
            // Extract description: skip the serial digits, the rest before the tail is the description
            let desc = normText(segment.slice(String(serial).length, tail.index));
            if (!desc || /^(Date|Ref|Project|TOTAL|VAT|TERMS|Page)\b/i.test(desc) || /Sl\.No\s+Image\s+Reference\s+Item\s+Description/i.test(desc)) continue;
            // Look for origin (FAR EAST / LOCAL-UAE) in the text BEFORE the serial position
            // Word COM often places the origin + beginning of description at the end of the previous row's text
            // e.g. "...2,412.00 FAR EAST RACER BLACK MEDIUM BACK CHAIR: Black frame with Black Mesh back and 36upholstered..."
            let origin = '';
            let descPrefix = '';
            const beforeSerial = bodyText.slice(Math.max(0, start - 500), start);
            // Find the LAST origin keyword in the text before serial
            const allOrigins = [...beforeSerial.matchAll(/(LOCAL\s*-?\s*UAE|LOCAL-UAE|FAR\s+EAST|FAREAST)\s*/gi)];
            if (allOrigins.length) {
                const lastOriginMatch = allOrigins[allOrigins.length - 1];
                origin = lastOriginMatch[1].replace(/\s+/g, ' ').toUpperCase().replace('LOCAL UAE', 'LOCAL-UAE');
                // Text between the origin keyword and the serial is the front of the description
                const afterOrigin = beforeSerial.slice(lastOriginMatch.index + lastOriginMatch[0].length);
                descPrefix = normText(afterOrigin);
                // Validate: the prefix should look like description text, not a different row's data
                if (/\d+\s+(Nos|No\.?|PCS|Pcs|Set|SET|Lot|Each|EA|Item|M2|SQM|LM|MTR)\s+[\d,]+/i.test(descPrefix)) {
                    // This looks like it belongs to a different row — discard
                    descPrefix = '';
                }
            } else {
                // Also check if origin is at the start of the description
                const originInDesc = desc.match(/^(LOCAL\s*-?\s*UAE|LOCAL-UAE|FAR\s+EAST|FAREAST)\s+(.+)$/i);
                if (originInDesc) { origin = originInDesc[1].replace(/\s+/g, ' ').toUpperCase().replace('LOCAL UAE', 'LOCAL-UAE'); desc = normText(originInDesc[2]); }
            }
            // Prepend the leaked description prefix to the description
            if (descPrefix) desc = normText(descPrefix + ' ' + desc);
            console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} concat-serial recovery: sn=${serial} origin="${origin}" desc="${desc.slice(0, 80)}" qty=${tail[1]} unit=${tail[2]} rate=${tail[3]} amount=${tail[4]}`);
            const cells = Array(primary.header.length).fill(null).map(() => emptyCell());
            cells[snIdx].value = String(serial); if (imgIdx >= 0) cells[imgIdx].value = origin; cells[descIdx].value = desc; cells[qtyIdx].value = tail[1]; cells[unitIdx].value = tail[2].replace(/\.$/, ''); cells[rateIdx].value = tail[3]; cells[amountIdx].value = tail[4];
            recovered.push({ cells, isHeader: false, isSummary: false, sectionLabel: '', pageNum: primary.rows?.at(-1)?.pageNum || 1, recoveredFromFinalText: true });
            found.add(serial); break;
        }
    }
    if (!recovered.length) { console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} final-row recovery added=0 parsedMax=${Math.max(0, ...found)} textMax=${maxTextSerial} missingTargets=${JSON.stringify(targetSerials)}`); return tables; }
    // Image recovery: text-only recovered rows have no images.
    // Try to find an existing row with a matching description and copy its image.
    for (const recRow of recovered) {
        const recDesc = normText(recRow.cells[descIdx]?.value || '').toLowerCase();
        if (!recDesc || recDesc.length < 10) continue;
        // Extract significant words (3+ chars) for matching
        const recWords = recDesc.split(/\s+/).filter(w => w.length >= 3).slice(0, 5);
        if (recWords.length < 2) continue;
        for (const existingRow of primary.rows) {
            const existDesc = normText(existingRow.cells?.[descIdx]?.value || '').toLowerCase();
            if (!existDesc) continue;
            // Check if the first few significant words match
            const matchCount = recWords.filter(w => existDesc.includes(w)).length;
            if (matchCount >= Math.min(3, recWords.length)) {
                // Found a matching row — copy its image
                const existImg = existingRow.cells?.[imgIdx >= 0 ? imgIdx : -1];
                if (existImg && existImg.images && existImg.images.length > 0) {
                    recRow.cells[imgIdx].images = [...existImg.images];
                    recRow.cells[imgIdx].image = existImg.images[0] || null;
                    console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} image-copy: sn=${recRow.cells[snIdx]?.value} from matching row sn=${existingRow.cells?.[snIdx]?.value} (${matchCount}/${recWords.length} words matched)`);
                    break;
                }
            }
        }
    }
    primary.rows.push(...recovered); primary.rows.sort((a, b) => { const sa = rowSerial(a, primary.header), sb = rowSerial(b, primary.header); if (sa === null && sb === null) return 0; if (sa === null) return 1; if (sb === null) return -1; return sa - sb; }); primary.rows = removeDuplicateRows(primary.rows, primary.header);
    const auditAfter = buildSerialAudit(primary.rows, primary.header); primary.extractionAudit = auditAfter; primary.serialAudit = auditAfter; primary.columnCount = primary.header.length;
    console.log(`[WordPdfExtractor] ${WORDCOM_EXTRACTOR_VERSION} final-row recovery added=${recovered.length} serials=${recovered.map(r => rowSerial(r, primary.header)).join(',')} missingNow=${JSON.stringify(auditAfter.missingSerials || [])}`);
    return tables;
}


export { extractPdfViaWord };
