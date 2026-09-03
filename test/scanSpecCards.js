import { renderPDFWithLayoutMuPDF } from '../server/utils/pdfRendererMupdf.js';

async function scanAllSpecCards() {
  const layouts = await renderPDFWithLayoutMuPDF('./PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf');
  const headerRx = /\bLF\s*[-–]\s*\d{3}/i;

  console.log(`Scanning all ${layouts.length} pages for specification cards...`);
  for (const l of layouts) {
    const lineItems = (l.textItems || []).filter(it => (it.text || it.str || '').trim().length > 0);
    const headers = [];
    for (const it of lineItems) {
      const t = (it.text || it.str || '').trim();
      if (headerRx.test(t) && (t.includes('–') || t.includes('-') || t.length > 8)) {
        if (!headers.some(h => Math.abs(h.x - it.x) < 30 && Math.abs(h.y - it.y) < 30)) {
          headers.push({ ...it, text: t });
        }
      }
    }

    if (headers.length > 0) {
      console.log(`\nPage ${l.page}: ${headers.length} card headers, ${l.extractedImages?.length || 0} images`);
      headers.forEach((h, i) => {
        console.log(`  [Card ${i + 1}] "${h.text}" at (x=${Math.round(h.x)}, y=${Math.round(h.y)})`);
      });
    }
  }
}

scanAllSpecCards().catch(console.error);
