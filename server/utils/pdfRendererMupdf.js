import { promises as fs, existsSync } from 'fs';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

/**
 * VERCEL-SAFE CLONE: WebAssembly MuPDF pure JS layout & native image extractor.
 * Clones PyMuPDF output structure, returning 2x-scaled coordinates matching PyMuPDF pdf_navigator.py.
 */
export async function renderPDFWithLayoutMuPDF(filePath, pages = null) {
    try {
        const mupdf = await import('mupdf');
        
        const data = await fs.readFile(filePath);
        const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
        const pageCount = doc.countPages();
        const results = [];
        
        const tempDir = process.env.VERCEL === '1'
            ? path.join(os.tmpdir(), 'extracted_assets')
            : path.join(path.dirname(filePath), 'extracted_assets');
            
        await fs.mkdir(tempDir, { recursive: true });

        const targetPageIndices = (pages && pages.length > 0)
            ? pages.map(p => p - 1)
            : Array.from({ length: pageCount }, (_, i) => i);

        for (const pageIdx of targetPageIndices) {
            if (pageIdx < 0 || pageIdx >= pageCount) continue;
            const pageNum = pageIdx + 1;
            const page = doc.loadPage(pageIdx);
            const bounds = page.getBounds();
            
            // PyMuPDF pdf_navigator.py uses 2x coordinate scaling factor
            const viewport = {
                width: Math.round((bounds[2] - bounds[0]) * 2),
                height: Math.round((bounds[3] - bounds[1]) * 2)
            };
            
            const extractedImages = [];
            const textItems = [];

            try {
                let currentLineText = '';
                let currentLineBbox = null;

                const finishLine = () => {
                    if (!currentLineText.trim() || !currentLineBbox) return;
                    const lineStr = currentLineText.trim();
                    const lineX0 = Math.round(currentLineBbox[0] * 2);
                    const lineY0 = Math.round(currentLineBbox[1] * 2);
                    const lineX1 = Math.round(currentLineBbox[2] * 2);
                    const lineY1 = Math.round(currentLineBbox[3] * 2);
                    const lineW = Math.max(1, lineX1 - lineX0);
                    const lineH = Math.max(1, lineY1 - lineY0);

                    // Add full line item
                    textItems.push({
                        str: lineStr,
                        text: lineStr,
                        x: lineX0,
                        y: lineY0,
                        w: lineW,
                        h: lineH
                    });

                    // Also split line into words so single-word anchors (like S.No numbers) are matched with exact x,y
                    const words = lineStr.split(/\s+/).filter(Boolean);
                    if (words.length > 1) {
                        let curX = lineX0;
                        const charWidthEst = lineW / Math.max(1, lineStr.length);
                        for (const word of words) {
                            const wordW = Math.round(word.length * charWidthEst);
                            textItems.push({
                                str: word,
                                text: word,
                                x: curX,
                                y: lineY0,
                                w: wordW,
                                h: lineH
                            });
                            curX += wordW + Math.round(charWidthEst);
                        }
                    }

                    currentLineText = '';
                    currentLineBbox = null;
                };

                page.toStructuredText('preserve-images').walk({
                    beginLine(bbox) {
                        finishLine();
                        currentLineBbox = bbox;
                        currentLineText = '';
                    },
                    onChar(c) {
                        if (currentLineBbox) {
                            currentLineText += c;
                        }
                    },
                    endLine() {
                        finishLine();
                    },
                    onImageBlock(bbox, _transform, image) {
                        try {
                            const x = Math.round(bbox[0] * 2);
                            const y = Math.round(bbox[1] * 2);
                            const w = Math.round((bbox[2] - bbox[0]) * 2);
                            const h = Math.round((bbox[3] - bbox[1]) * 2);
                            
                            const aspectRatio = w / Math.max(1, h);
                            if (aspectRatio > 4 || aspectRatio < 0.25) return;
                            if (w < 20 || h < 20) return;

                            const pixmap = image.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
                            const pngBytes = pixmap.asPNG();
                            if (pngBytes.length < 300) return;

                            const filename = `mupdf_${pageNum}_${crypto.randomUUID().slice(0, 8)}.png`;
                            const tmpPath = path.join(tempDir, filename);
                            fsSync.writeFileSync(tmpPath, Buffer.from(pngBytes));

                            extractedImages.push({
                                x, y, w, h,
                                path: tmpPath,
                                buffer: Buffer.from(pngBytes),
                                isNative: true
                            });
                        } catch (err) {}
                    }
                });

                finishLine();
            } catch (e) {
                console.warn(`    ⚠️ [MuPDF Renderer] Page ${pageNum} walk notice: ${e.message}`);
            }

            // CRITICAL: Sort images top-to-bottom by Y coordinate (matching PyMuPDF)
            extractedImages.sort((a, b) => a.y - b.y || a.x - b.x);

            results.push({
                page: pageNum,
                fullImage: null,
                extractedImages,
                nativeImages: extractedImages,
                textItems,
                viewport
            });
        }
        return results;
    } catch (err) {
        console.error(`    ❌ [MuPDF Renderer Error] ${err.message}`);
        throw err;
    }
}
