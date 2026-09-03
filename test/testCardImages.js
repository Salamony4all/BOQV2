import { renderPDFWithLayoutMuPDF } from '../server/utils/pdfRendererMupdf.js';
import fs from 'fs';

async function main() {
  const layouts = await renderPDFWithLayoutMuPDF('./PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf');
  const page20 = layouts.find(l => l.page === 20);

  console.log('Page 20 layout details:');
  console.log('Viewport:', page20.viewport);
  console.log('Extracted images count on page 20:', page20.extractedImages?.length);

  // Let's test header detection on page 20
  const lineItems = (page20.textItems || []).filter(it => (it.text || it.str || '').trim().length > 0);
  const headers = [];
  const headerRx = /\bLF\s*[-–]\s*\d{3}/i;
  for (const it of lineItems) {
    const t = (it.text || it.str || '').trim();
    if (headerRx.test(t) && (t.includes('–') || t.includes('-') || t.length > 8)) {
      if (!headers.some(h => Math.abs(h.x - it.x) < 20 && Math.abs(h.y - it.y) < 20)) {
        headers.push({ ...it, text: t });
      }
    }
  }

  console.log('\nDetected headers on Page 20:');
  headers.forEach((h, i) => {
    console.log(`  Header ${i + 1}: "${h.text}" at x=${Math.round(h.x)}, y=${Math.round(h.y)}`);
  });

  const width = page20.viewport?.width || 1920;
  const height = page20.viewport?.height || 1080;

  // Let's compute card bounding boxes using start of next card
  headers.sort((a, b) => a.x - b.x || a.y - b.y);
  const cards = [];
  if (headers.length === 1) {
    cards.push({ header: headers[0], left: 0, right: width, top: 0, bottom: height });
  } else {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      const left = i === 0 ? 0 : headers[i].x - 30;
      const right = i === headers.length - 1 ? width : headers[i + 1].x - 30;
      cards.push({ header: h, left, right, top: 0, bottom: height });
    }
  }

  console.log('\nProper Card bounding boxes:');
  cards.forEach((c, i) => {
    console.log(`  Card ${i + 1} ("${c.header.text}"): left=${Math.round(c.left)}, right=${Math.round(c.right)}`);
    const cardImages = (page20.extractedImages || []).filter(img => {
      const centerX = img.x + img.w / 2;
      const centerY = img.y + img.h / 2;
      return centerX >= c.left && centerX < c.right && centerY > 100 && centerY < (height - 100) && img.w > 25 && img.h > 25;
    });
    console.log(`    Images paired to Card ${i + 1}: ${cardImages.length}`);
    cardImages.forEach((img, j) => {
      console.log(`      Img ${j + 1}: x=${Math.round(img.x)}, y=${Math.round(img.y)}, w=${Math.round(img.w)}, h=${Math.round(img.h)}`);
    });
  });

}

main().catch(console.error);
