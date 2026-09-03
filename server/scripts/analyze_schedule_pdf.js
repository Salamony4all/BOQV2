import * as mupdf from 'mupdf';
import fs from 'fs';

async function analyzePdf() {
  const doc = mupdf.Document.openDocument(fs.readFileSync('PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf'), 'application/pdf');
  console.log('Total PDF Pages:', doc.countPages());
  
  const extractedItems = [];

  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const text = page.toStructuredText('preserve-whitespace').asJSON();
    const data = JSON.parse(text);
    const lines = [];
    data.blocks?.forEach(b => {
      b.lines?.forEach(l => {
        const lineStr = l.text || l.spans?.map(s => s.text).join('') || '';
        if (lineStr.trim()) lines.push(lineStr.trim());
      });
    });
    const fullText = lines.join('\n');
    
    // Look for items on this page
    const itemMatches = [...fullText.matchAll(/LF-(\d+[a-z]?(\/\d+)?)\s*–\s*([^\n]+)/gi)];
    if (itemMatches.length > 0) {
      for (const m of itemMatches) {
        extractedItems.push({
          page: i + 1,
          code: 'LF-' + m[1],
          name: m[3].trim(),
          fullText: fullText
        });
      }
    }
  }

  console.log(`\nFound ${extractedItems.length} specification items in PDF:\n`);
  
  extractedItems.forEach((it, idx) => {
    // Extract supplier URL
    const urlMatch = it.fullText.match(/https?:\/\/[^\s\n\)]+/i);
    const url = urlMatch ? urlMatch[0].replace(/;$/, '') : 'None';
    
    console.log(`${(idx + 1).toString().padStart(2)}. [P.${it.page.toString().padStart(2)}] ${it.code.padEnd(10)} | ${it.name.padEnd(32)} | URL: ${url}`);
  });
}

analyzePdf().catch(console.error);
