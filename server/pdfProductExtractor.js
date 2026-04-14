import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { callGoogleMultimodalFallback } from './utils/llmPDFTable.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure correct worker path: use CDN on Vercel, local file for dev
if (process.env.VERCEL === '1') {
    // On Vercel, use the bundled worker via a relative import path
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
        import.meta.url
    ).href;
} else {
    const workerPath = path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
}
console.log(`📌 [PdfProductExtractor] PDF.js workerSrc set to: ${pdfjs.GlobalWorkerOptions.workerSrc}`);

// Global Store for temporary session images
export const tempImageStore = new Map();

/**
 * ENHANCED PDF PRODUCT EXTRACTOR (V3 - SEQUENCE ANCHORED)
 */
export async function extractProductBoqFromPdf(filePath, progressCallback = () => {}) {
    console.log(`\n🚀 [PdfProductExtractor] Starting Sequenced Extraction: ${path.basename(filePath)}`);
    
    const data = await fs.readFile(filePath);
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
        const headerKeywords = ["sl.no", "description", "qty", "item", "unit", "total"];
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

        // Sort Top-to-Bottom
        const sortedImages = allImagesOnPage.sort((a, b) => b.y - a.y);
        const imageRefs = sortedImages.map((img, idx) => {
            const refId = `p${pageNum}_ref${idx + 1}_${Date.now()}`;
            tempImageStore.set(refId, Buffer.from(img.data));
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
                null, // Use fallback models
                true
            );

            const items = aiResponse?.items || aiResponse?.rows || [];
            if (Array.isArray(items)) {
                items.forEach((item, index) => {
                    // --- COORDINATE MATCHING ---
                    // Try to find the SN in text metadata to get its Y coordinate
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
                        // Find image vertically near that SN
                        imgMatch = imageRefs.find(r => Math.abs(r.coordY - targetY) < 40);
                    }

                    // Fallback to original imageRef or sequence
                    if (!imgMatch) {
                        let imageRef = item.imageRef ?? item.image_ref ?? null;
                        if (typeof imageRef === 'string' && imageRef.trim().length) {
                            imageRef = Number(imageRef.trim());
                        }
                        imgMatch = imageRefs.find(r => r.ref === imageRef) || imageRefs[index] || null;
                    }

                    const row = {
                        cells: [
                            { value: '', image: imgMatch ? { url: imgMatch.url } : null },
                            { value: item.sn ? String(item.sn) : String(index + 1) },
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
            sheetName: "AI PDF BOQ",
            header: ["Image", "S.N", "Description", "Qty", "Unit", "Rate", "Total"],
            rows: allExtractedRows,
            columnCount: 7
        }],
        totalTables: 1
    };
}
