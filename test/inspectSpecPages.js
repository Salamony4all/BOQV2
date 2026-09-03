import { renderPDFWithLayoutMuPDF } from '../server/utils/pdfRendererMupdf.js';

async function testLayout() {
  console.log('Rendering PDF pages with MuPDF layout engine...');
  const layouts = await renderPDFWithLayoutMuPDF('./PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf');
  console.log('Total page layouts rendered:', layouts.length);

  for (const l of layouts) {
    const text = (l.textItems || []).map(t => t.text || t.str).join(' ');
    if (text.includes('LF-018') || text.includes('LF-019') || text.includes('LF-020')) {
      console.log(`\n================== PAGE ${l.page} (W: ${l.viewport?.width}, H: ${l.viewport?.height}) ==================`);
      console.log(`Images on page: ${l.extractedImages?.length || 0}`);
      (l.extractedImages || []).forEach((img, idx) => {
        console.log(`  Img ${idx + 1}: x=${Math.round(img.x)}, y=${Math.round(img.y)}, w=${Math.round(img.w)}, h=${Math.round(img.h)} | aspect=${(img.w/img.h).toFixed(2)}`);
      });
      console.log('Key text items mentioning LF-:');
      (l.textItems || []).filter(t => (t.text || t.str || '').includes('LF-')).forEach(t => {
        console.log(`  Text: "${t.text || t.str}" at x=${Math.round(t.x)}, y=${Math.round(t.y)}`);
      });
      console.log('Section labels (TYPE, SIZE, FINISH, SUPPLIER):');
      (l.textItems || []).filter(t => /^(TYPE|SIZE|FINISH|SUPPLIER)$/i.test((t.text || t.str || '').trim())).forEach(t => {
        console.log(`  Label: "${t.text || t.str}" at x=${Math.round(t.x)}, y=${Math.round(t.y)}`);
      });
    }
  }
}

testLayout().catch(console.error);
