import { extractPdfViaWord } from '../server/wordExtractorService.js';

async function main() {
  console.log('Analyzing PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf image pairing across rows 15-25...');
  const res = await extractPdfViaWord('./PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf', 'diag_loose_furniture', false, () => {});

  if (!res.tables || res.tables.length === 0) {
    console.log('No tables found.');
    return;
  }

  const table = res.tables[0];
  console.log(`\nTable contains ${table.rows.length} rows. Columns: ${table.header.join(' | ')}`);

  // Let's inspect rows around 17, 18, 19, 20
  for (let idx = 15; idx < Math.min(table.rows.length, 23); idx++) {
    const r = table.rows[idx];
    const sn = r.cells[0]?.value || '';
    const code = r.cells[1]?.value || '';
    const desc = (r.cells[2]?.value || '').replace(/\n/g, ' ').substring(0, 50);
    
    // Check all cells for images
    let allImgs = [];
    r.cells.forEach(c => {
      if (c.images && c.images.length > 0) allImgs.push(...c.images);
      else if (c.image) allImgs.push(c.image);
    });

    console.log(`\n▶ [Row ${idx + 1}] SN="${sn}" Code="${code}" Page=${r.pageNum}`);
    console.log(`  Desc: "${desc}..."`);
    console.log(`  Total Images Attached: ${allImgs.length}`);
    allImgs.forEach((im, i) => {
      console.log(`    Image ${i + 1}: ${im.url || im.path}`);
    });
  }
}

main().catch(console.error);
