import { promises as fs } from 'fs';
import fs_sync from 'fs';
import path from 'path';
import { callGoogleMultimodalFallback } from './utils/llmPDFTable.js';
import { renderPDFWithLayout, renderPDFToSimpleImages } from './utils/pdfRenderer.js';
import crypto from 'crypto';

const PARALLEL_BOQ_SYSTEM = `You are a Precise Data Extraction Engine for BOQ documents.
Your goal is to create a 1:1 digital replica of the table data in the provided image.

### 🎯 STRICTOR EXTRACTION RULES:
1. **Verbatim Text**: Copy descriptions EXACTLY as written. Do not summarize.
2. **Numeric Precision**: Capture Qty, Rate, and Amount as numbers. Remove currency symbols.
3. **Multi-line Rows**: Merge multi-line descriptions into a single string.
4. **No Hallucinations**: Only extract what is visually present. EXTRACT EVERY SINGLE ITEM ROW.
5. NO BOUNDING BOXES NEEDED. Do NOT try to extract image bounding boxes.

### 🚨 OUTPUT FORMAT:
- OUTPUT JSON ONLY.
- NO MARKDOWN (\`\`\`json).
- START WITH '{'.

### JSON SCHEMA:
{
  "rows": [
    {
      "sn": "Original S.N",
      "description": "EXACT TEXT FROM TABLE",
      "qty": 0.0,
      "unit": "Unit",
      "rate": 0.0,
      "amount": 0.0
    }
  ]
}`;

/**
 * Saves a matched native image to the temp dir and updates the row's image field.
 * Called by all three pairing strategies to avoid code duplication.
 */
async function _saveAndPairImage(matchedImage, row, pageNum, tempDir, uploadId) {
    try {
        const filename = `page_${pageNum}_row_${row.rowIdx}.jpg`;
        const imgLocalPath = path.join(tempDir, filename);

        if (matchedImage.path) {
            await fs.copyFile(matchedImage.path, imgLocalPath);
        } else if (matchedImage.dataUrl) {
            const base64Data = matchedImage.dataUrl.replace(/^data:image\/\w+;base64,/, '');
            await fs.writeFile(imgLocalPath, Buffer.from(base64Data, 'base64'));
        } else {
            return; // Nothing to save
        }

        // Update row so metadata.json write picks it up
        row.image = { 
            url: `/temp/extracted_images/${uploadId}/${filename}`,
            sn: row.sn 
        };
        console.log(`    🔗 [Background] Paired SN=${row.sn} (P${pageNum}/R${row.rowIdx}) → ${filename}`);
    } catch (e) {
        console.error(`    ❌ [Background] Failed to save image for P${pageNum} R${row.rowIdx}:`, e.message);
    }
}

export async function extractParallelBOQData(filePath, mimeType, progressCallback = () => {}, modelName = null) {
    const isVercel = process.env.VERCEL === '1';
    const uploadId = crypto.randomUUID();
    
    // Choose writable directory
    const baseTempDir = isVercel ? '/tmp/extracted_images' : path.join(process.cwd(), 'public', 'temp', 'extracted_images');
    const tempDir = path.join(baseTempDir, uploadId);
    
    await fs.mkdir(tempDir, { recursive: true });

    console.log(`  ⏱️ [Parallel Extractor] Launching concurrent processes... Environment: ${isVercel ? 'Vercel' : 'Local'}${modelName ? ` | Model: ${modelName}` : ''}`);
    
    // Kick off fast screenshot rendering for AI
    const simpleImages = await renderPDFToSimpleImages(filePath);
    progressCallback(30);

    // Kick off slow image extraction in background, DO NOT AWAIT IT for returning text
    const layoutsPromise = renderPDFWithLayout(filePath).catch(err => {
        console.error('Layout Extraction Failed:', err.message);
        return [];
    });

    let globalRowCounter = 1;

    // Fast AI Extraction
    const pagePromises = simpleImages.map(async (pageBuffer, idx) => {
        const pageNum = idx + 1;
        try {
            console.log(`  🤖 [AI] Analyzing Page ${pageNum}...`);
            const base64 = pageBuffer.toString('base64');
            
            const result = await callGoogleMultimodalFallback(
                PARALLEL_BOQ_SYSTEM,
                `MANDATORY: Convert Page ${pageNum} to JSON. Capture EVERY row verbatim INCLUDING the original Serial Number (S.N) column. Output JSON only starting with {`,
                [{ base64Data: base64, mimeType: 'image/png' }],
                modelName || 'gemma-4-26b-a4b-it',
                true 
            );
            
            if (result && (result.rows || result.items)) {
                const rows = result.rows || result.items;
                return rows.map((row, rowIdx) => {
                    const aiSN = String(row.sn || '').trim();
                    const isValidSN = aiSN.length > 0 && !aiSN.includes('undefined');
                    const displaySN = isValidSN ? aiSN : String(globalRowCounter++);
                    
                    return {
                        ...row,
                        sn: displaySN,
                        // Provide a placeholder URL right away! The frontend can lazy load it.
                        image: {
                            url: `/api/lazy-image/${uploadId}/${pageNum}/${rowIdx}`,
                            sn: displaySN
                        },
                        pageNum,
                        rowIdx
                    };
                });
            }
            return [];
        } catch (err) {
            console.error(`  ⚠️ [AI Error] Page ${pageNum} failed: ${err.message}`);
            return [];
        }
    });

    // Wait for AI logic to finish (fast)
    const pageResults = await Promise.all(pagePromises);
    progressCallback(100);

    const allRowsArr = pageResults.flat();
    
    const headerKeywords = ["sl.no", "description", "qty", "unit", "rate", "total", "amount", "price"];
    const filteredRows = allRowsArr.filter(r => {
        const desc = (r.description || '').toLowerCase();
        const matches = headerKeywords.filter(k => desc.includes(k));
        if (matches.length >= 2 && desc.length < 80) return false; // filter out header rows
        return true;
    });

    // SAVE METADATA IMMEDIATELY (Lightweight, prevents race condition with UI requests)
    const layouts = await layoutsPromise;
    const metadata = {
        uploadId,
        pdfPath: path.resolve(filePath), // Store for fallback rendering
        rows: filteredRows,
        pages: layouts.map(l => ({
            page: l.page,
            textItems: l.textItems,
            nativeImages: l.extractedImages, // Save these!
            viewport: l.viewport
        }))
    };
    await fs.writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
    
    // Handle BACKGROUND Image Matching (Heavy processing)
    console.log(`  🕒 [Parallel Extractor] Starting background image extraction for UploadID: ${uploadId}`);
    setTimeout(async () => {
        try {
            console.log(`  🖼️ [Background] Positional image pairing for ${uploadId}...`);
            
            for (const layout of layouts) {
                const pageNum = layout.page;
                if (!layout.extractedImages || layout.extractedImages.length === 0) continue;

                // Get rows for this page, sorted by their visual order (rowIdx = AI extraction order = top→bottom)
                const pageRows = filteredRows
                    .filter(r => r.pageNum === pageNum)
                    .sort((a, b) => a.rowIdx - b.rowIdx);

                // Identify Table Header Y to skip logos
                let headerY = -1;
                for (const it of layout.textItems || []) {
                    const txt = String(it.str || '').toLowerCase();
                    if (txt.includes('s.n') || txt.includes('sl.no') || txt.includes('item') || 
                        txt.includes('description') || txt.includes('qty') || txt.includes('total')) {
                        if (headerY === -1 || it.y < headerY) headerY = it.y;
                    }
                }

                // Images are already sorted top→bottom by Y from Python (pdf_navigator.py).
                // Filter out tiny decorative images (logos, icons < 30px height).
                // ALSO Filter out images above the table header (logos in header area).
                const productImages = layout.extractedImages
                    .filter(img => {
                        const isSizeOk = img.h >= 30 && img.w >= 30;
                        const isNotHeader = headerY === -1 || img.y >= (headerY - 10);
                        if (isSizeOk && !isNotHeader) console.log(`    🚫 [Background] P${pageNum}: Skipping header image (y=${Math.round(img.y)} < headerY=${Math.round(headerY)})`);
                        return isSizeOk && isNotHeader;
                    })
                    .sort((a, b) => a.y - b.y || a.x - b.x); // Ensure Y sort in JS too

                console.log(`    📐 [Background] Page ${pageNum}: ${pageRows.length} rows, ${productImages.length} images (HeaderY: ${Math.round(headerY)})`);

                // ── STRATEGY 1: Perfect positional pairing (1:1 index match) ────────────
                // Works when #images === #rows — most common case in BOQ PDFs.
                if (productImages.length === pageRows.length && pageRows.length > 0) {
                    console.log(`    ✅ [Background] P${pageNum}: Perfect 1:1 positional pairing`);
                    for (let i = 0; i < pageRows.length; i++) {
                        await _saveAndPairImage(productImages[i], pageRows[i], pageNum, tempDir, uploadId);
                    }
                    continue;
                }

                // ── STRATEGY 2: Y-band pairing (when counts differ slightly) ─────────────
                // For each row, find the image whose Y-center is closest to the row's text Y.
                // Each image can only be claimed once (greedy nearest-neighbor).
                const usedImageIndices = new Set();
                
                // Build row Y positions from text items
                const textItems = layout.textItems || [];
                const normalize = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

                for (const row of pageRows) {
                    const targetSN = normalize(row.sn);
                    const descPrefix = normalize((row.description || '').substring(0, 20));

                    // Find best text anchor Y for this row
                    let anchorY = null;
                    const snMatch = textItems.find(it => {
                        const norm = normalize(it.str);
                        return norm === targetSN && norm.length > 0;
                    });
                    if (snMatch) anchorY = snMatch.y;

                    if (anchorY === null && descPrefix.length > 3) {
                        const descMatch = textItems.find(it => normalize(it.str).includes(descPrefix.substring(0, 10)));
                        if (descMatch) anchorY = descMatch.y;
                    }

                    // Find closest unused image by Y distance
                    let bestIdx = -1;
                    let bestDist = Infinity;
                    for (let i = 0; i < productImages.length; i++) {
                        if (usedImageIndices.has(i)) continue;
                        const img = productImages[i];
                        const imgCenterY = img.y + img.h / 2;
                        const dist = anchorY !== null
                            ? Math.abs(imgCenterY - anchorY)
                            : Math.abs(i - pageRows.indexOf(row)) * 200; // fallback positional weight
                        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                    }

                    if (bestIdx !== -1 && bestDist < 300) {
                        usedImageIndices.add(bestIdx);
                        await _saveAndPairImage(productImages[bestIdx], row, pageNum, tempDir, uploadId);
                    } else {
                        // ── STRATEGY 3: Pure positional fallback ─────────────────────────
                        // If no good Y match, fall back to strictly positional by row order
                        const fallbackIdx = pageRows.indexOf(row);
                        if (fallbackIdx < productImages.length && !usedImageIndices.has(fallbackIdx)) {
                            usedImageIndices.add(fallbackIdx);
                            await _saveAndPairImage(productImages[fallbackIdx], row, pageNum, tempDir, uploadId);
                            console.log(`    ⚡ [Background] P${pageNum} Row ${row.sn}: positional fallback → img[${fallbackIdx}]`);
                        }
                    }
                }
            }
            
            // CRITICAL: Update metadata.json with the new image paths
            await fs.writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
            console.log(`  ✅ [Background] Lazy image matching finished and metadata updated for ${uploadId}.`);
        } catch (e) {
            console.error('  ❌ [Background Error] Image matching failed:', e.message, e.stack);
        }
    }, 500); // 500ms delay to ensure main response is sent first

    const header = ["S.N", "Image", "Description", "Qty", "Unit", "Rate", "Amount"];

    const formattedRows = filteredRows.map(r => {
        return {
            cells: [
                { value: r.sn || '', images: [], isMerged: false },
                { value: '', image: r.image, images: [r.image], isMerged: false },
                { value: r.description || '', images: [], isMerged: false },
                { value: +(r.qty || 0) || '', images: [], isMerged: false },
                { value: r.unit || '', images: [], isMerged: false },
                { value: +(r.rate || 0) || '', images: [], isMerged: false },
                { value: +(r.amount || 0) || '', images: [], isMerged: false }
            ],
            isHeader: false,
            isSummary: false
        };
    });

    return {
        tables: [{
            sheetName: "AI Fast Extraction",
            header,
            rows: formattedRows,
            columnCount: header.length,
            uploadId
        }],
        totalTables: 1
    };
}
