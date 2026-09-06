import { enrichBrandFromArchitonic } from '../utils/architonicAdapter.js';
const name = process.argv[2] || 'Figueras';
const r = await enrichBrandFromArchitonic({ brandName: name, maxPages: 4 });
console.log('OK:', r.ok, 'PAGE:', r.brandPageUrl || '-', 'REASON:', r.reason || '-');
for (const p of (r.products || [])) {
  console.log('-', String(p.model).slice(0, 65), '|', String(p.imageUrl || 'NOIMG').slice(0, 70), '|', p.category);
}
