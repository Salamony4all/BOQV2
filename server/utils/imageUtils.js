import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Extracts images from a specific PDF page with their Y-coordinates for row-mapping.
 */
export async function getPageImagesWithPositions(pdfBuffer, pageNum) {
    const loadingTask = pdfjs.getDocument({ data: pdfBuffer, verbosity: 0 });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNum);
    const opList = await page.getOperatorList();
    const imgs = [];

    const { fnArray, argsArray } = opList;
    const OPS = pdfjs.OPS;

    let currentTransform = [1, 0, 0, 1, 0, 0]; // Default identity

    for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i];

        if (fn === OPS.transform) {
            currentTransform = args;
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
            const imgName = args[0];
            try {
                const imgObj = await new Promise((resolve, reject) => {
                    page.objs.get(imgName, (obj) => {
                        if (obj) resolve(obj);
                        else reject(new Error('Image not found in resources'));
                    });
                });

                if (imgObj && imgObj.data) {
                    // Y-coordinate is the 6th element in transform matrix [a, b, c, d, e, f]
                    // In PDF.js coordinate system, higher Y is higher on page (relative to bottom)
                    // We want to sort by proximity to top, so we'll flip it later or use visual order.
                    imgs.push({
                        y: currentTransform[5],
                        x: currentTransform[4],
                        data: imgObj.data,
                        width: imgObj.width,
                        height: imgObj.height,
                        kind: imgObj.kind
                    });
                }
            } catch (e) {
                // Silently skip if image can't be fetched (often mask or small icon)
                // console.warn(`Failed to fetch image ${imgName}: ${e.message}`);
            }
        }
    }

    // Sort by Y-coordinate descending (Top to Bottom in PDF coordinates usually means y is decreasing if (0,0) is bottom)
    // Actually, we'll sort based on the visual flow.
    return imgs.sort((a, b) => b.y - a.y);
}

/**
 * Converts raw PDF image data to a PNG Buffer.
 */
export async function pdfImageToBuffer(imgData) {
    const { width, height, data, kind } = imgData;
    
    // Simple canvas-less conversion if possible, or use a library.
    // For now, we'll use a placeholder or a simple JPEG/PNG wrapper logic.
    // Since we are in Node, we can use 'sharp' if available, otherwise 'canvas'.
    // Let's check for sharp.
    return Buffer.from(data); // placeholder, need a real encoder
}
