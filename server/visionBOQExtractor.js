import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { callGoogleMultimodalFallback } from './utils/llmPDFTable.js';
import { put } from '@vercel/blob';
import chromium from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure the correct worker is used to avoid version mismatch (Fix for v5.4.449)
const workerPath = path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
console.log(`📌 [VisionBOQExtractor] PDF.js workerSrc set to: ${pdfjs.GlobalWorkerOptions.workerSrc}`);

// System prompt for the Vision model
const VISION_BOQ_SYSTEM = `You are a Furniture Procurement Specialist.
Your task is to extract a Bill of Quantities (BOQ) from the provided image/PDF.

### EXTRACTION PROTOCOL:
1. EXTRACT TABLE: Identify the main BOQ table. Extract all rows including Description, Quantity, Unit, and Total Amount.
2. DETECT PRODUCT IMAGES: For every row, check if there is a corresponding product image/thumbnail.
3. BOUNDING BOXES: If you see a product image, provide its normalized bounding box [ymin, xmin, ymax, xmax] where values are 0-1000 relative to the image size.
   - ymin: Top edge
   - xmin: Left edge
   - ymax: Bottom edge
   - xmax: Right edge
### MAPPING RULES:
- If a row is a header or summary, mark isHeader: true.
- Extract quantities as numbers.
- If a row is missing a description but looks like a continuation, merge logically.

### OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "rows": [
    {
      "description": "Ergonomic Task Chair with detailed specs...",
      "qty": 10,
      "unit": "Nos",
      "rate": 250,
      "amount": 2500,
      "imageBBox": [120, 45, 200, 150], // [ymin, xmin, ymax, xmax] or null
      "isHeader": false
    }
  ],
  "sheetSummary": "Total items extracted summary."
}
(If no items are found, return empty "rows" array)`;

/**
 * Main entry point for Vision BOQ Extraction
 */
export async function extractVisionBOQData(filePath, mimeType, progressCallback = () => {}, modelName = null) {
    console.log(`\n🖼️ [Vision Extractor] Processing file: ${path.basename(filePath)} (${mimeType})${modelName ? ` using ${modelName}` : ''}`);
    
    let imageBuffers = [];
    
    if (mimeType === 'application/pdf') {
        imageBuffers = await renderPDFToImages(filePath);
    } else {
        const buffer = await fs.readFile(filePath);
        imageBuffers = [buffer];
    }

    const allRows = [];
    const totalPages = imageBuffers.length;

    for (let i = 0; i < imageBuffers.length; i++) {
        console.log(`  📄 Processing Page ${i + 1}/${totalPages}... (Buffer size: ${imageBuffers[i]?.length || 0} bytes)`);
        progressCallback(20 + ((i / totalPages) * 60));

        const base64 = imageBuffers[i].toString('base64');
        const visionResult = await callGoogleMultimodalFallback(
            VISION_BOQ_SYSTEM,
            `Extract the BOQ from this page. If you find product images, provide their bounding boxes.`,
            [{ base64Data: base64, mimeType: 'image/png' }],
            modelName || 'gemma-4-26b-a4b-it', // Pass modelName
            true // jsonMode
        );

        console.log(`  🤖 Vision AI Response:`, JSON.stringify(visionResult).substring(0, 200));

        // Support both 'rows' and 'items' keys
        const extractedRows = visionResult?.rows || visionResult?.items || [];
        if (extractedRows.length > 0) {
            console.log(`  ✅ Found ${extractedRows.length} rows on page ${i + 1}`);
            const processedRows = await processVisionRows(extractedRows, imageBuffers[i]);
            allRows.push(...processedRows);
        } else {
            console.warn(`  ⚠️ No rows/items found in vision response for page ${i + 1}`);
        }
    }

    // Convert to TableViewer format
    const header = ["Image", "Description", "Qty", "Unit", "Rate", "Amount"];
    const formattedRows = allRows.filter(r => !r.isHeader).map(r => ({
        cells: [
            { value: '', image: r.imageUrl ? { url: r.imageUrl } : null },
            { value: r.description || '' },
            { value: r.qty || '' },
            { value: r.unit || '' },
            { value: r.rate || '' },
            { value: r.amount || '' }
        ]
    }));

    return {
        tables: [{
            sheetName: "Vision Extraction",
            header,
            rows: formattedRows,
            columnCount: header.length
        }],
        totalTables: 1
    };
}

/**
 * PDF to high-res PNG buffers
 */
async function renderPDFToImages(filePath) {
    const browser = await chromium.chromium.launch();
    const page = await browser.newPage();
    const pdfBuffer = await fs.readFile(filePath);
    const base64Pdf = pdfBuffer.toString('base64');
    console.log(`  📖 PDF file size: ${pdfBuffer.length} bytes`);

    const html = `
      <html>
        <body style="margin:0; padding:0; background:#fff;">
          <embed id="pdfEmbed" type="application/pdf" src="data:application/pdf;base64,${base64Pdf}" width="1200" height="1600" />
        </body>
      </html>`;

    await page.setViewportSize({ width: 1200, height: 1600 });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); // Extended wait for PDF rendering
    console.log(`  ✅ PDF embedded and rendered in Playwright`);

    const bodyHandle = await page.$('body');
    const boundingBox = await bodyHandle.boundingBox();
    const height = boundingBox?.height || 1600;
    console.log(`  📏 Rendered height: ${height}px`);

    const images = [];
    const viewportHeight = 1200;
    let currentY = 0;

    while (currentY < height) {
        const buffer = await page.screenshot({
            fullPage: false,
            clip: { x: 0, y: currentY, width: 1200, height: Math.min(viewportHeight, height - currentY) }
        });
        images.push(buffer);
        console.log(`  📸 Captured screenshot ${images.length}: ${buffer.length} bytes`);
        currentY += viewportHeight;
        if (images.length >= 10) break;
    }

    console.log(`  ✅ Total images captured: ${images.length}`);
    await browser.close();
    return images;
}

/**
 * Handle Image Cropping and Uploads
 */
async function processVisionRows(rows, pageBuffer) {
    console.log(`  🔄 Processing ${rows.length} rows...`);
    const processed = [];
    
    for (const row of rows) {
        if (row.imageBBox && Array.isArray(row.imageBBox)) {
            try {
                console.log(`    📦 Cropping image with bbox: ${JSON.stringify(row.imageBBox)}`);
                const cropUrl = await cropAndUpload(pageBuffer, row.imageBBox);
                row.imageUrl = cropUrl;
                console.log(`    ✅ Image uploaded: ${cropUrl.substring(0, 50)}...`);
            } catch (err) {
                console.error('    ⚠️ Crop failed:', err.message);
            }
        }
        processed.push(row);
    }
    
    console.log(`  ✅ Finished processing ${processed.length} rows`);
    return processed;
}

/**
 * Uses Playwright to crop a small portion of a buffer and upload to Vercel Blob
 */
async function cropAndUpload(buffer, bbox) {
    const [ymin, xmin, ymax, xmax] = bbox;
    
    const browser = await chromium.chromium.launch();
    const page = await browser.newPage();
    
    // Set a baseline viewport matching 1000x1000 for bbox conversion
    await page.setViewportSize({ width: 1000, height: 1000 });
    
    // Load image as background
    const base64 = buffer.toString('base64');
    await page.setContent(`<body style="margin:0; padding:0;"><img id="target" src="data:image/png;base64,${base64}" style="width:1000px; height:1000px;"></body>`);
    
    const clip = {
        x: xmin,
        y: ymin,
        width: xmax - xmin,
        height: ymax - ymin
    };

    const croppedBuffer = await page.screenshot({ clip });
    await browser.close();

    // Upload to Vercel
    const filename = `vision_crop_${Date.now()}_${Math.floor(Math.random()*1000)}.png`;
    const { url } = await put(filename, croppedBuffer, {
        access: 'public',
        contentType: 'image/png'
    });

    return url;
}
