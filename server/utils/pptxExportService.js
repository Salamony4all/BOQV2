import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pptxgen = require('pptxgenjs');
import axios from 'axios';
import path from 'path';
import { promises as fs } from 'fs';
import { convertPptxToPdf } from './pptxToPdfConverter.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generates a PPTX and converts it to PDF using PowerPoint COM (Windows)
 * @param {Object} data - { tables, profile, project }
 */
export async function generatePresentationPdf(data) {
    const { tables, profile, project, origin } = data;
    const { companyName, logoOriginal, logoWhite, website, accentColor, secondaryColor } = profile || {};
    
    const pres = new pptxgen();
    pres.layout = 'LAYOUT_WIDE'; // Wide screen layout

    const fixHex = (hex) => (hex || '').replace('#', '');

    let primaryColorHex = fixHex(accentColor) || '0F3E67';
    if (primaryColorHex === '3B82F6' || primaryColorHex === '1E5FA8' || primaryColorHex === '2563EB') {
        primaryColorHex = '0F3E67';
    }

    const brandColors = {
        primary: primaryColorHex,
        accent: fixHex(secondaryColor) || 'F5A623',
        text: '333333',
        lightText: '666666',
        border: 'E0E0E0',
        bg: 'FFFFFF',
        lightBg: 'F5F5F5'
    };

    const totalItems = tables.reduce((acc, t) => acc + (t.rows?.filter(r => !r.isHeader && !r.isSummary)?.length || 0), 0);
    let itemNum = 1;

    const resolveImg = (src) => {
        if (!src) return null;
        if (src.startsWith('data:')) return { data: src };
        let finalSrc = src;
        if (src.startsWith('/')) finalSrc = (origin || 'http://localhost:3001') + src;
        return { path: finalSrc };
    };

    const addImg = (slideObj, src, opts) => {
        const resolved = resolveImg(src);
        if (resolved) slideObj.addImage({ ...resolved, ...opts });
    };

    // Define Slide Master with empty objects to make background elements selectable & editable
    const logoPpt = resolveImg(logoWhite || logoOriginal);
    pres.defineSlideMaster({
        title: 'BOQ_MASTER',
        background: { color: brandColors.bg },
        objects: []
    });

    const drawSlideDecorations = (slideObj) => {
        // Header bar (blue) - drawn on slide directly to make it selectable/editable
        slideObj.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: brandColors.primary } });
        // Gold accent line
        slideObj.addShape('rect', { x: 0, y: 0.8, w: '100%', h: 0.03, fill: { color: brandColors.accent } });
        // Footer background
        slideObj.addShape('rect', { x: 0, y: 5.3, w: '100%', h: 0.2, fill: { color: brandColors.lightBg } });
        // Company logo
        if (logoPpt) {
            slideObj.addImage({ ...logoPpt, x: 8.5, y: 0.1, w: 1.2, h: 0.6, sizing: { type: 'contain', w: 1.2, h: 0.6 } });
        }
    };

    // 1. Title Slide
    const titleSlide = pres.addSlide({ masterName: 'BOQ_MASTER' });
    drawSlideDecorations(titleSlide);
    if (logoOriginal || logoWhite) {
        addImg(titleSlide, logoOriginal || logoWhite, { x: 3.5, y: 1.2, w: 3.0, h: 1.5, sizing: { type: 'contain', w: 3.0, h: 1.5 } });
    }

    titleSlide.addText('PRODUCT SHOWCASE', {
        x: 0, y: 3.2, w: '100%', h: 0.6,
        fontSize: 42, bold: true, color: brandColors.primary, fontFace: 'Arial', align: 'center'
    });

    titleSlide.addText('Bill of Quantities - Product Presentation', {
        x: 0, y: 3.9, w: '100%', h: 0.4,
        fontSize: 14, color: brandColors.lightText, fontFace: 'Arial', align: 'center'
    });

    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    titleSlide.addText(`Date: ${dateStr}  |  Total Items: ${totalItems}`, {
        x: 0, y: 4.4, w: '100%', h: 0.3, fontSize: 11, color: brandColors.lightText, align: 'center'
    });

    // 2. Product Slides
    for (const table of tables) {
        const header = table.header || [];
        let descIdx = header.findIndex(h => !/image|photo|picture|img/i.test(h) && /description|details|spec|specification/i.test(h));
        if (descIdx === -1) {
            descIdx = header.findIndex(h => !/image|photo|picture|img/i.test(h) && /desc|disc|product|item name|particulars/i.test(h));
        }
        const brandIdx = header.findIndex(h => !/image|photo/i.test(h) && /brand|maker|origin|country/i.test(h));
        const qtyIdx = header.findIndex(h => /qty|quantity|qt/i.test(h));
        const finishIdx = header.findIndex(h => /finish|color|material/i.test(h));

        for (const row of table.rows) {
            if (row.isHeader || row.isSummary || !row.cells.some(c => c.value)) continue;
            
            const slide = pres.addSlide({ masterName: 'BOQ_MASTER' });
            drawSlideDecorations(slide);

            const imageCell = row.cells.find(c => c.images?.length > 0 || c.image);
            const allImages = imageCell?.images || (imageCell?.image ? [imageCell.image] : []);
            
            let desc = descIdx > -1 ? String(row.cells[descIdx]?.value || '').trim() : '';

            // Fallback: If desc is empty, scan row for all non-image, non-numeric description/spec text
            if (!desc && row.cells) {
                const textParts = [];
                header.forEach((headerName, i) => {
                    if (!/image|photo|picture|img|qty|quantity|unit|rate|price|amount|total|s\.?no|sl\.?no|item no/i.test(headerName)) {
                        const val = String(row.cells[i]?.value || '').trim();
                        if (val && !textParts.includes(val)) {
                            textParts.push(val);
                        }
                    }
                });
                desc = textParts.join(' ');
            }

            const brand = brandIdx > -1 ? String(row.cells[brandIdx]?.value || '') : '';
            const qty = qtyIdx > -1 ? String(row.cells[qtyIdx]?.value || '') : '';
            const finish = finishIdx > -1 ? String(row.cells[finishIdx]?.value || '') : '';

            // Extract first line/product name
            const firstLine = desc.split(/[\n*•]/)[0].trim();
            const headerTitle = firstLine ? (firstLine.length > 55 ? firstLine.substring(0, 52) + '...' : firstLine) : String(row.cells?.[0]?.value || '');

            slide.addText(`Item ${itemNum}: ${headerTitle}`, {
                x: 0.2, y: 0.15, w: 8.0, h: 0.4,
                fontSize: 14, color: brandColors.bg, bold: true, fontFace: 'Arial', valign: 'middle'
            });

            if (!logoWhite && !logoOriginal) {
                slide.addText(companyName || 'LOGO', {
                    x: 8.2, y: 0.25, w: 1.5, h: 0.2,
                    fontSize: 8, color: brandColors.lightText, align: 'center'
                });
            }

            // ===== LEFT SIDE: IMAGES =====
            const imgAreaX = 0.25;
            const imgAreaY = 0.95;
            const imgAreaW = 4.5;
            const imgAreaH = 4.1;

            slide.addShape('rect', {
                x: imgAreaX, y: imgAreaY, w: imgAreaW, h: imgAreaH,
                fill: { color: brandColors.lightBg },
                line: { color: brandColors.border, pt: 0.5 }
            });

            if (allImages.length === 1) {
                const maxW = imgAreaW - 0.2;
                const maxH = imgAreaH - 0.2;
                addImg(slide, allImages[0].url, { 
                    x: imgAreaX + 0.1, y: imgAreaY + 0.1, w: maxW, h: maxH, 
                    sizing: { type: 'contain', w: maxW, h: maxH }
                });
            } else if (allImages.length === 2) {
                const cellW = (imgAreaW - 0.3) / 2;
                const cellH = imgAreaH - 0.2;
                allImages.slice(0, 2).forEach((img, idx) => {
                    const cellX = imgAreaX + 0.1 + idx * (cellW + 0.1);
                    addImg(slide, img.url, { 
                        x: cellX, y: imgAreaY + 0.1, w: cellW, h: cellH, 
                        sizing: { type: 'contain', w: cellW, h: cellH } 
                    });
                });
            } else if (allImages.length >= 3) {
                const cols = 2;
                const rows = 2;
                const cellW = (imgAreaW - 0.3) / cols;
                const cellH = (imgAreaH - 0.3) / rows;
                allImages.slice(0, 4).forEach((img, idx) => {
                    const col = idx % cols;
                    const rowNum = Math.floor(idx / cols);
                    const cellX = imgAreaX + 0.1 + col * (cellW + 0.1);
                    const cellY = imgAreaY + 0.1 + rowNum * (cellH + 0.1);
                    addImg(slide, img.url, { 
                        x: cellX, y: cellY, w: cellW, h: cellH, 
                        sizing: { type: 'contain', w: cellW, h: cellH } 
                    });
                });
                if (allImages.length > 4) {
                    slide.addText(`+${allImages.length - 4} more`, {
                        x: imgAreaX + imgAreaW - 0.8, y: imgAreaY + imgAreaH - 0.3, w: 0.7, h: 0.2,
                        fontSize: 8, color: brandColors.lightText, align: 'right'
                    });
                }
            }

            // ===== RIGHT SIDE: PRODUCT DETAILS =====
            const detailX = 5;
            const detailW = 4.7;
            let detailY = 0.95;

            slide.addText('Product Details', {
                x: detailX, y: detailY, w: detailW, h: 0.35,
                fontSize: 18, bold: true, color: brandColors.primary, fontFace: 'Arial'
            });
            detailY += 0.45;

            slide.addText('Description:', {
                x: detailX, y: detailY, w: detailW, h: 0.25,
                fontSize: 11, bold: true, color: brandColors.primary, fontFace: 'Arial'
            });
            detailY += 0.28;

            const fullDesc = desc.trim();
            const maxDescY = 4.8;
            const availableDescH = maxDescY - detailY;
            const estLines = Math.ceil(fullDesc.length / 60) + (fullDesc.match(/[\n*•]/g) || []).length;
            const descBoxH = Math.min(availableDescH, Math.max(0.4, estLines * 0.15));

            slide.addText(fullDesc, {
                x: detailX, y: detailY, w: detailW, h: descBoxH,
                fontSize: 9, color: brandColors.text, fontFace: 'Arial', valign: 'top',
                wrap: true, shrinkText: true
            });
            detailY += descBoxH + 0.08;

            // Brand and Qty side-by-side above the footer
            const footerY = 4.72;
            slide.addText('Brand:', { x: detailX, y: footerY, w: 0.75, h: 0.35, fontSize: 10, bold: true, color: brandColors.primary, fontFace: 'Arial', valign: 'middle' });
            slide.addText(brand || 'N/A', { x: detailX + 0.75, y: footerY, w: 1.65, h: 0.35, fontSize: 9, color: brandColors.text, fontFace: 'Arial', valign: 'middle' });

            slide.addText('Qty:', { x: detailX + 2.5, y: footerY, w: 0.5, h: 0.35, fontSize: 10, bold: true, color: brandColors.primary, fontFace: 'Arial', valign: 'middle' });
            slide.addText(qty || 'As per BOQ', { x: detailX + 3.0, y: footerY, w: 1.7, h: 0.35, fontSize: 9, color: brandColors.text, fontFace: 'Arial', valign: 'middle' });

            // ===== FOOTER =====
            slide.addText('Warranty', { x: 0.2, y: 5.08, w: 1, h: 0.18, fontSize: 8, bold: true, color: brandColors.primary });
            slide.addText('As per manufacturer - 5 years', { x: 0.2, y: 5.24, w: 2.5, h: 0.15, fontSize: 7, color: brandColors.lightText });
            slide.addText(website || 'https://alshayaenterprises.com', { x: 3.5, y: 5.32, w: 3, h: 0.15, fontSize: 7, color: brandColors.primary, align: 'center' });
            slide.addText(`${itemNum} / ${totalItems}`, { x: 8.5, y: 5.32, w: 1, h: 0.15, fontSize: 7, color: brandColors.lightText, align: 'right' });

            itemNum++;
        }
    }

    // Save PPTX to temp file
    const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
    const tempDir = isVercel ? '/tmp' : path.join(__dirname, '../../uploads');
    try { await fs.mkdir(tempDir, { recursive: true }); } catch (e) {}
    
    const pptxFilename = `presentation_${Date.now()}.pptx`;
    const pptxPath = path.join(tempDir, pptxFilename);
    
    await pres.writeFile({ fileName: pptxPath });
    console.log(`[PptxExport] PPTX generated at ${pptxPath}`);

    // Convert to PDF
    try {
        const pdfPath = await convertPptxToPdf(pptxPath);
        return { pptxPath, pdfPath };
    } catch (err) {
        console.warn(`[PptxExport] PDF Conversion failed, returning only PPTX. Error: ${err.message}`);
        return { pptxPath, pdfPath: null };
    }
}

