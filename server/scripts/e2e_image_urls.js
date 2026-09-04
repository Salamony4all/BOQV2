// E2E: extraction image-URL audit (Supabase vs localhost) — branded + non-branded.
// Usage: node server/scripts/e2e_image_urls.js "<pdf path>"
import { extractMultiplePdfsV21 } from '../universalPatternParsersVercel.v22.dynamic-header-boq-spec.js';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node e2e_image_urls.js "<pdf path>"');
  process.exit(1);
}

const started = Date.now();
console.log(`[E2E] Extracting: ${pdfPath}`);
const data = await extractMultiplePdfsV21([pdfPath], (p) => {
  if (p % 25 === 0) console.log(`[E2E] progress: ${p}%`);
});

const urls = [];
for (const t of data.tables || []) {
  for (const r of t.rows || []) {
    for (const c of r.cells || []) {
      for (const img of c.images || []) {
        if (img?.url) urls.push(img.url);
      }
      if (c.image?.url && !urls.includes(c.image.url)) urls.push(c.image.url);
    }
  }
}

const isPublic = (u) => u.startsWith('http') && !u.includes('localhost') && !u.includes('127.0.0.1');
const pub = urls.filter(isPublic);
const local = urls.filter((u) => !isPublic(u));
console.log(`[E2E] DONE in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`[E2E] tables=${(data.tables || []).length} rows=${(data.tables || []).reduce((n, t) => n + (t.rows || []).length, 0)} total_images=${urls.length} supabase_public=${pub.length} localhost=${local.length}`);
console.log('[E2E] --- sample public (3) ---');
pub.slice(0, 3).forEach((u) => console.log('  PUB ', u.slice(0, 120)));
console.log('[E2E] --- sample local (3) ---');
local.slice(0, 3).forEach((u) => console.log('  LOCAL', String(u).slice(0, 120)));
console.log(`[E2E] RESULT ${urls.length > 0 && local.length === 0 ? 'PASS_ALL_SUPABASE' : urls.length > 0 ? 'PARTIAL' : 'NO_IMAGES'}`);
