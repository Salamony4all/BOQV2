// Probe: dump first 3 rows' text cells + image counts for column-alignment check.
import { extractMultiplePdfsV21 } from '../universalPatternParsersVercel.v22.dynamic-header-boq-spec.js';
const pdfPath = process.argv[2];
const data = await extractMultiplePdfsV21([pdfPath], () => {});
const t = (data.tables || [])[0];
console.log(`TABLES=${(data.tables || []).length} ROWS=${t?.rows?.length} COLS=${t?.rows?.[0]?.cells?.length} VERCEL=${process.env.VERCEL || '0'}`);
(t?.rows || []).slice(0, 3).forEach((r, i) => {
  const cells = (r.cells || []).slice(0, 6).map((c) => String(c.value || '').slice(0, 40).replace(/\n/g, ' '));
  const imgs = (r.cells || []).reduce((n, c) => n + ((c.images || []).length), 0);
  console.log(`ROW${i} imgs=${imgs} | ` + cells.join(' || '));
});
console.log('PROBE-DONE');
