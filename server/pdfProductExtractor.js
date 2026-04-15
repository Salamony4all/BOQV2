// NOTE: browser API polyfills (DOMMatrix, DOMRect, etc.) are applied in
// server/nodePolyfills.js which is imported at server.js startup — BEFORE
// this module is lazily loaded. Do NOT add polyfills here (ES module hoisting
// means code above `import` statements never runs first).

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callGoogleMultimodalFallback } from './utils/llmPDFTable.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
        const imageRefs = []; // { ref, dataUri } — inline base64 for Vercel
        try {
            const mupdf = await import('mupdf');
            const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
            let imgCounter = 1;

            for (let pageIdx = 0; pageIdx < doc.countPages(); pageIdx++) {
                const page = doc.loadPage(pageIdx);
                const pageImgs = [];

                page.toStructuredText('preserve-images').walk({
                    onImageBlock(bbox, _transform, image) {
                        try {
                            const pixmap = image.toPixmap(
                                mupdf.Matrix.identity,
                                mupdf.ColorSpace.DeviceRGB,
                                false  // no alpha channel
                            );
                            const pngBytes = pixmap.asPNG();
                            const buf = Buffer.from(pngBytes);
                            // Filter out tiny decorative images (icons, borders, etc.)
                            const w = bbox[2] - bbox[0];
                            const h = bbox[3] - bbox[1];
                            if (w < 30 || h < 30 || buf.length < 500) return;
                            // bbox = [x0, y0, x1, y1] — y0 is top in mupdf coords
                            pageImgs.push({ y: bbox[1], data: buf });
                        } catch (imgErr) {
                            console.warn(`  ⚠️ Image skip p${pageIdx + 1}:`, imgErr.message);
                        }
                    }
                });

                // Sort top-to-bottom (ascending y)
                pageImgs.sort((a, b) => a.y - b.y);

                for (const img of pageImgs) {
                    // Embed as base64 data URI — no temp store needed on Vercel
                    const dataUri = `data:image/png;base64,${img.data.toString('base64')}`;
                    imageRefs.push({ ref: imgCounter, url: dataUri });
                    imgCounter++;
                }
            }
            console.log(`   📸 mupdf extracted ${imageRefs.length} embedded product images`);
        } catch (imgErr) {
            console.warn(`   ⚠️ mupdf image extraction skipped:`, imgErr.message);
        }

        progressCallback({ percent: 20, message: `Sending PDF to ${modelName || 'Gemma'} AI...` });

        // ── STEP 2: Extract BOQ data using selected model ────────
        const apiKey = process.env.GOOGLE_FREE_KEY || process.env.GEMINI_FREE_KEY ||
                       process.env.GEMINI_API_KEY_FREE || process.env.GOOGLE_API_KEY ||
                       process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('No Google API key found. Set GOOGLE_FREE_KEY or GEMINI_API_KEY in Vercel environment variables.');

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: modelName || 'gemma-4-26b-a4b-it',
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 16384
            }
        });

        const prompt = `You are a BOQ extraction expert. Read the uploaded PDF and extract ALL Bill of Quantities rows.

You MUST respond with ONLY a raw JSON object. No markdown. No code blocks. No explanation. No prose. Start your response with { and end with }.

Required JSON schema:
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

Rules:
- Include ALL rows from ALL pages
- qty/rate/total must be numbers (not strings)
- Use null for missing numeric values
- Skip header rows, footers, page numbers
- Set "hasImage" to true ONLY for rows that have a visible product photo/picture next to them in the PDF
- Your entire response must be valid JSON starting with {`;

        try {
            console.log(`   🤖 Calling gemma-4-26b-a4b-it with PDF (${Math.round(data.length / 1024)}KB)...`);
            const result = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { inlineData: { data: data.toString('base64'), mimeType: 'application/pdf' } },
                        { text: prompt }
                    ]
                }]
            });
            const responseText = result.response.text();
            console.log(`   ✅ Gemma responded (${responseText.length} chars), extracting JSON...`);

            // Robust JSON extraction: strip any accidental markdown fences or prose
            let aiResponse;
            const cleaned = responseText
                .replace(/^```(?:json)?\s*/im, '')
                .replace(/\s*```$/im, '')
                .trim();
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            const jsonStr = firstBrace !== -1 && lastBrace > firstBrace
                ? cleaned.substring(firstBrace, lastBrace + 1)
                : cleaned;
            try {
                aiResponse = JSON.parse(jsonStr);
            } catch (parseErr) {
                console.error(`   ❌ JSON parse failed. Response preview: ${responseText.substring(0, 300)}`);
                throw new Error(`Gemma response could not be parsed as JSON: ${parseErr.message}`);
            }

            progressCallback({ percent: 90, message: 'Building table...' });

            const items = aiResponse?.items || aiResponse?.rows || [];
            if (!Array.isArray(items) || items.length === 0) {
                throw new Error('Gemma returned no items from PDF');
            }

            // Smart image-to-row mapping:
            // Only assign images to rows the AI flagged as having a product photo.
            // If the AI didn't provide hasImage flags, fall back to sequential.
            const hasImageFlags = items.some(it => it.hasImage === true || it.hasImage === false);
            let imgCursor = 0;

            const rows = items.map((item, index) => {
                let imgMatch = null;
                if (hasImageFlags) {
                    // AI-guided: only consume an image ref for rows the AI says have a photo
                    if (item.hasImage && imgCursor < imageRefs.length) {
                        imgMatch = imageRefs[imgCursor];
                        imgCursor++;
                    }
                } else {
                    // Fallback: sequential 1:1 mapping
                    imgMatch = imageRefs[index] || null;
                }

                return {
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
        } catch (err) {
            console.error(`   ❌ Gemma PDF extraction failed:`, err.message);
            throw err;
        }
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
