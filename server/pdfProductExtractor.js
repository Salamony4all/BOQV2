// NOTE: browser API polyfills (DOMMatrix, DOMRect, etc.) are applied in
// server/nodePolyfills.js which is imported at server.js startup — BEFORE
// this module is lazily loaded. Do NOT add polyfills here (ES module hoisting
// means code above `import` statements never runs first).

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callGoogleMultimodalFallback } from './utils/llmPDFTable.js';
import { safeParseJSON, callUniversalMultimodalAI } from './utils/llmUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Worker configuration for Node.js / Vercel serverless:
// Node.js ESM only supports file:// URLs for dynamic module loading.
// Vercel bundles node_modules into the serverless function, so this path resolves correctly.
// We use import.meta.url to get an absolute file:// URL regardless of CWD.
const workerUrl = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
console.log(`📌 [PdfProductExtractor] workerSrc = ${pdfjs.GlobalWorkerOptions.workerSrc}`);

// Global Store for temporary session images
export const tempImageStore = new Map();

/**
 * VERCEL-SAFE PDF BOQ EXTRACTOR
 *
 * On Vercel: pdfjs.getDocument() hangs indefinitely because @napi-rs/canvas
 * (a native binary) is not available in the serverless environment.
 * Solution: bypass pdfjs entirely — send the raw PDF bytes to Gemini which
 * reads PDFs natively using its multimodal vision API.
 *
 * On local dev: use the full pdfjs text-extraction + image-anchoring pipeline.
 */
export async function extractProductBoqFromPdf(filePath, progressCallback = () => {}, modelName = null) {
    console.log(`\n🚀 [PdfProductExtractor] Starting Extraction: ${path.basename(filePath)}${modelName ? ` using ${modelName}` : ''}`);

    const data = await fs.readFile(filePath);

    // ─── VERCEL PATH: mupdf for images + Gemma for BOQ text ───────────────────
    if (process.env.VERCEL === '1') {
        console.log(`   ☁️  Vercel mode: mupdf image extraction + ${modelName || 'Gemma'} BOQ parsing`);
        progressCallback({ percent: 5, message: 'Extracting embedded images...' });

        // ── STEP 1: Extract embedded images via mupdf (WASM, no native binaries) ──
        // On Vercel (serverless), we embed images as base64 data URIs directly into
        // cell data because the in-memory tempImageStore is not shared across
        // invocations — /api/temp-image/:id requests hit a fresh instance.
            const imageRefs = []; 
            try {
                const mupdf = await import('mupdf');
                const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
                
                // Track SN to Image mapping: Map<sn_string, dataUri>
                const snImageMap = new Map();
                let imgCounter = 1;

                for (let pageIdx = 0; pageIdx < doc.countPages(); pageIdx++) {
                    const page = doc.loadPage(pageIdx);
                    let headerY = -1;
                    let tableStartY = -1;
                    let imageColumnX = -1;
                    const snAnchors = []; // { sn, y }
                    
                    // 1. EXTRACT ALL TEXT LINES
                    const lines = [];
                    page.toStructuredText().walk({
                        onLine(bbox, line) {
                            lines.push({ bbox, text: line.trim().toLowerCase() });
                        }
                    });

                    // 2. DETECT HEADER & TABLE BOUNDARY
                    let maxHits = 0;
                    const keywords = ['sl.no', 's.n', 'sr.no', 'no.', 'item', 'description', 'image', 'qty', 'unit', 'total', 'rate', 'price'];
                    for (let i = 0; i < lines.length; i++) {
                        let hits = 0;
                        let currentY = lines[i].bbox[1];
                        let imgX = -1;
                        
                        // Check neighbors for header structure
                        for (let j = 0; j < lines.length; j++) {
                            if (Math.abs(lines[j].bbox[1] - currentY) < 15) {
                                for (const k of keywords) {
                                    if (lines[j].text.includes(k)) {
                                        hits++;
                                        if (lines[j].text.includes('image')) imgX = lines[j].bbox[0];
                                    }
                                }
                            }
                        }
                        
                        if (hits > maxHits) {
                            maxHits = hits;
                            headerY = currentY;
                            if (imgX !== -1) imageColumnX = imgX;
                        }
                    }

                    // 3. IDENTIFY ALL SN ANCHORS & DEFINE HARD BOUNDARY
                    for (const line of lines) {
                        // S.N. column is usually leftmost (x < 120)
                        if (line.bbox[0] < 120) {
                            const snMatch = line.text.match(/^\s*(\d+)[.\s-]*$/);
                            if (snMatch) {
                                const snVal = parseInt(snMatch[1]).toString();
                                const midY = (line.bbox[1] + line.bbox[3]) / 2;
                                snAnchors.push({ sn: snVal, y: midY });
                                // The very first serial number (1, 10, etc) defines where the table rows start
                                if (tableStartY === -1 || line.bbox[1] < tableStartY) {
                                    tableStartY = line.bbox[1];
                                }
                            }
                        }
                    }

                    // Fallback: If no S.N. found, use headerY
                    const hardLogoBoundary = tableStartY !== -1 ? tableStartY : (headerY !== -1 ? headerY : 150);
                    console.log(`   🎯 Page ${pageIdx + 1}: Table Head at Y=${Math.round(hardLogoBoundary)}`);

                    // 4. EXTRACT AND FILTER IMAGES
                    const pageImgsForSort = [];
                    page.toStructuredText('preserve-images').walk({
                        onImageBlock(bbox, _transform, image) {
                            try {
                                const w = bbox[2] - bbox[0];
                                const h = bbox[3] - bbox[1];
                                const imgY = (bbox[1] + bbox[3]) / 2;
                                const imgX = bbox[0];

                                // A. HARD BOUNDARY FILTER
                                // If image is above the first Serial Number or Header, it is 100% a logo.
                                if (bbox[1] < (hardLogoBoundary - 10)) {
                                    console.log(`     🚫 Skipping logo above table start (y=${Math.round(bbox[1])} < start=${Math.round(hardLogoBoundary)})`);
                                    return;
                                }

                                if (w < 20 || h < 20) return;

                                const pngBytes = image.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false).asPNG();
                                if (pngBytes.length < 500) return;
                                const dataUri = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`;

                                // B. SPATIAL LOCK TO S.N.
                                let matchedSN = null;
                                let bestDist = 120;
                                for (const anchor of snAnchors) {
                                    const vDist = Math.abs(anchor.y - imgY);
                                    if (vDist < bestDist) {
                                        bestDist = vDist;
                                        matchedSN = anchor.sn;
                                    }
                                }

                                if (matchedSN) {
                                    snImageMap.set(`${pageIdx}_${matchedSN}`, dataUri);
                                }
                                
                                pageImgsForSort.push({ y: bbox[1], url: dataUri });
                            } catch (err) { }
                        }
                    });

                    pageImgsForSort.sort((a, b) => a.y - b.y);
                    for (const img of pageImgsForSort) {
                        imageRefs.push({ ref: imgCounter++, url: img.url });
                    }
                }
                
                imageRefs.spatialMap = snImageMap;
                console.log(`   📸 Extraction complete: ${imageRefs.length} images, ${snImageMap.size} spatial locks.`);
            } catch (err) {
                console.error(`   ❌ mupdf critical extraction error:`, err);
            }

        progressCallback({ percent: 20, message: `Sending PDF to ${modelName || 'Gemma'} AI...` });

        // ── STEP 2: Extract BOQ data using universal model ────────
        const { getProviderForModel } = await import('./utils/llmUtils.js');
        const provider = getProviderForModel(modelName || 'gemma-4-26b-a4b-it');
        
        let assets = [];
        if (provider === 'google') {
            assets = [{ base64Data: data.toString('base64'), mimeType: 'application/pdf' }];
        } else {
            console.log(`🖼️ [Vercel] AI Provider ${provider} does not support PDF natively. Rendering first 15 pages as images...`);
            try {
                for (let i = 0; i < Math.min(doc.countPages(), 15); i++) {
                    const page = doc.loadPage(i);
                    const pixmap = page.toPixmap(mupdf.Matrix.scale(1.2, 1.2), mupdf.ColorSpace.DeviceRGB, false);
                    const png = pixmap.asPNG();
                    assets.push({ 
                        base64Data: Buffer.from(png).toString('base64'), 
                        mimeType: 'image/png' 
                    });
                }
            } catch (renderErr) {
                console.error("   ❌ Failed to render PDF pages for vision AI:", renderErr);
                // Fallback to sending the PDF and hoping for the best (or it will fail with a better error)
                assets = [{ base64Data: data.toString('base64'), mimeType: 'application/pdf' }];
            }
        }

        const prompt = `CRITICAL: You are a raw data extraction engine.
Output ONLY the JSON object. 
DO NOT INCLUDE any preamble, introductory text, schema definitions, or conclusions. 
START with { and END with }.

Schema:
{
  "items": [
    {
      "sn": "1",
      "description": "Full item description",
      "qty": 10,
      "unit": "Nos",
      "rate": 250.00,
      "total": 2500.00,
      "hasImage": true
    }
  ]
}

Instructions:
- Extract EVERY Bill of Quantities row from the PDF.
- qty/rate/total MUST be numeric values (no currency symbols).
- Set "hasImage": true if there is a picture column for that row.
- Return ONLY the raw JSON string.`;

        const aiResponse = await callUniversalMultimodalAI(
            "You are a Furniture Procurement Specialist and Data Extraction Engine.",
            prompt + '\nIMPORTANT: Do NOT repeat the schema above. Start your response immediately with the { character.',
            assets,
            modelName || 'gemma-4-26b-a4b-it',
            true // jsonMode
        );

        console.log(`🤖 AI Response Received (${modelName || 'Gemma'}):`, JSON.stringify(aiResponse).substring(0, 200));
        
        const extractedItems = aiResponse.items || aiResponse.rows || [];

        progressCallback({ percent: 90, message: 'Building table...' });

        const items = extractedItems;
        if (items.length === 0) {
            throw new Error(`${modelName || 'AI'} returned no items from PDF`);
        }

        // Smart image-to-row mapping:
        // 1. Try spatial S.N mapping first (Primary anchoring)
        // 2. Fall back to hasImage-based sequential mapping
        let imgCursor = 0;
        const spatialMap = imageRefs.spatialMap;

            const rows = items.map((item, index) => {
                let imgMatch = null;
                const sn = item.sn ? String(item.sn) : null;

                // Priority 1: Spatial SN anchoring (Look across all possible page prefixes)
                if (sn && spatialMap) {
                    // Check if any page has this SN. Since we don't know the exact page from the AI,
                    // we try common prefixes or just finding any match for this SN if it's unique.
                    for (let pCandidate = 0; pCandidate < 50; pCandidate++) {
                        const candidateKey = `${pCandidate}_${sn}`;
                        if (spatialMap.has(candidateKey)) {
                            imgMatch = { url: spatialMap.get(candidateKey) };
                            break;
                        }
                    }
                }

                // Priority 2: hasImage-based sequential (if spatial failed or no SN)
                if (!imgMatch && Array.isArray(imageRefs)) {
                    if (item.hasImage && imgCursor < imageRefs.length) {
                        imgMatch = imageRefs[imgCursor];
                        imgCursor++;
                    }
                }

                return {
                    cells: [
                        { value: sn || String(index + 1) },
                        { value: '', image: imgMatch ? { url: imgMatch.url } : null },
                        { value: item.description || '' },
                        { value: item.qty != null ? String(item.qty) : '' },
                        { value: item.unit || '' },
                        { value: item.rate != null ? String(item.rate) : '' },
                        { value: item.total != null ? String(item.total) : '' }
                    ]
                };
            });

            progressCallback({ percent: 100, message: 'Done' });

            return {
                tables: [{
                    sheetName: 'AI PDF BOQ',
                    header: ['S.N', 'Image', 'Description', 'Qty', 'Unit', 'Rate', 'Total'],
                    rows,
                    columnCount: 7
                }],
                totalTables: 1
            };
    }



    // ─── LOCAL DEV PATH: full pdfjs text + image extraction pipeline ──────────
    console.log(`   🖥️  Local mode: using pdfjs extraction pipeline`);

    const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(data),
        useSystemFonts: true,
        stopAtErrors: false
    });
    const pdf = await loadingTask.promise;
    console.log(`   📂 PDF Loaded: ${pdf.numPages} pages.`);

    let allExtractedRows = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        console.log(`   📄 Processing Page ${pageNum}/${pdf.numPages}...`);
        const page = await pdf.getPage(pageNum);

        // --- 1. Extract Text with Coordinates ---
        const textContent = await page.getTextContent();
        const textClusters = {};
        const yTolerance = 10;

        textContent.items.forEach(item => {
            const y = Math.round(item.transform[5]);
            let targetY = Object.keys(textClusters).find(keyY => Math.abs(parseInt(keyY) - y) <= yTolerance);
            if (!targetY) {
                targetY = y;
                textClusters[targetY] = [];
            }
            textClusters[targetY].push(item);
        });

        const sortedY = Object.keys(textClusters).sort((a, b) => b - a);
        const lineMetadata = sortedY.map(y => {
            const items = textClusters[y].sort((a, b) => a.transform[4] - b.transform[4]);
            return {
                y: parseInt(y),
                text: items.map(it => it.str).join(' ').trim(),
                items: items.map(it => ({ str: it.str, x: Math.round(it.transform[4]) }))
            };
        }).filter(l => l.text.length > 0);

        // --- 2. FIND HEADER ANCHOR ---
        const headerKeywords = ['sl.no', 'description', 'qty', 'item', 'unit', 'total'];
        const headerLine = lineMetadata.find(l =>
            headerKeywords.some(k => l.text.toLowerCase().includes(k))
        );
        const headerY = headerLine ? headerLine.y : 9999;

        const pageTextBlob = lineMetadata.map(l => l.text).join('\n');

        // --- 3. Extract Images Below Anchor ---
        const allImagesOnPage = [];
        const operatorList = await page.getOperatorList();
        const OPS = pdfjs.OPS || {};
        let currentTransform = [1, 0, 0, 1, 0, 0];

        for (let i = 0; i < operatorList.fnArray.length; i++) {
            const fn = operatorList.fnArray[i];
            const args = operatorList.argsArray[i];

            if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
                const imgName = args[0];
                const imgY = Math.round(currentTransform[5]);

                if (imgY < headerY - 5) {
                    try {
                        const imgObj = await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
                            page.objs.get(imgName, (obj) => {
                                clearTimeout(timeout);
                                if (obj) resolve(obj);
                                else reject(new Error('Failed'));
                            });
                        });

                        if (imgObj && imgObj.data) {
                            allImagesOnPage.push({ y: imgY, data: imgObj.data });
                        }
                    } catch (err) {}
                }
            } else if (fn === OPS.transform) {
                currentTransform = args;
            }
        }

        console.log(`      📸 Found ${allImagesOnPage.length} potential product images on p${pageNum}`);

        const sortedImages = allImagesOnPage.sort((a, b) => b.y - a.y);
        const imageRefs = sortedImages.map((img, idx) => {
            const refId = `p${pageNum}_ref${idx + 1}_${Date.now()}`;
            const imgBuffer = Buffer.from(img.data);
            tempImageStore.set(refId, imgBuffer);
            return { ref: idx + 1, url: `/api/temp-image/${refId}`, coordY: img.y };
        });

        // --- 4. AI Extraction ---
        const systemPrompt = `You are a professional furniture procurement expert. Extract ONLY the BOQ table from the uploaded PDF. Do not include any header text, footers, or page numbers. Use the exact table structure present in the document.`;
        const userPrompt = `Read the PDF content and return only valid JSON with a top-to-bottom row order. Each row should include imageRef where applicable so the stored product images can be anchored to the same row.

Expected schema:
{
  "items": [
    {
      "sn": "1",
      "description": "...",
      "qty": 10,
      "unit": "Nos",
      "rate": 250,
      "total": 2500,
      "imageRef": 1
    }
  ]
}

If an item has no image, set imageRef to null or omit it.

PDF text:
---------
${pageTextBlob}`;

        try {
            const aiResponse = await callGoogleMultimodalFallback(
                systemPrompt,
                userPrompt,
                [{ base64Data: data.toString('base64'), mimeType: 'application/pdf' }],
                null,
                true
            );

            const items = aiResponse?.items || aiResponse?.rows || [];
            if (Array.isArray(items)) {
                items.forEach((item, index) => {
                    const snValue = item.sn ? String(item.sn).trim() : null;
                    const normalize = (s) => String(s).replace(/[^a-z0-9]/gi, '').toLowerCase();
                    const targetSN = snValue ? normalize(snValue) : null;

                    const snLine = targetSN ? lineMetadata.find(l => l.items.some(it => {
                        const itNorm = normalize(it.str);
                        return itNorm === targetSN || (itNorm.length > 0 && targetSN.startsWith(itNorm));
                    })) : null;
                    const targetY = snLine ? snLine.y : null;

                    let imgMatch = null;
                    if (targetY !== null) {
                        imgMatch = imageRefs.find(r => Math.abs(r.coordY - targetY) < 40);
                    }

                    if (!imgMatch) {
                        let imageRef = item.imageRef ?? item.image_ref ?? null;
                        if (typeof imageRef === 'string' && imageRef.trim().length) {
                            imageRef = Number(imageRef.trim());
                        }
                        imgMatch = imageRefs.find(r => r.ref === imageRef) || imageRefs[index] || null;
                    }

                    const row = {
                        cells: [
                            { value: item.sn ? String(item.sn) : String(index + 1) },
                            { value: '', image: imgMatch ? { url: imgMatch.url } : null },
                            { value: item.description || '' },
                            { value: item.qty != null ? String(item.qty) : '' },
                            { value: item.unit || '' },
                            { value: item.rate != null ? String(item.rate) : '' },
                            { value: item.total != null ? String(item.total) : '' }
                        ]
                    };
                    allExtractedRows.push(row);
                });
            }
        } catch (err) {
            console.error(`   ❌ AI Failure on p${pageNum}:`, err.message);
        }

        progressCallback({ percent: Math.round((pageNum / pdf.numPages) * 100), message: `Page ${pageNum} complete` });
    }

    return {
        tables: [{
            sheetName: 'AI PDF BOQ',
            header: ['S.N', 'Image', 'Description', 'Qty', 'Unit', 'Rate', 'Total'],
            rows: allExtractedRows,
            columnCount: 7
        }],
        totalTables: 1
    };
}
