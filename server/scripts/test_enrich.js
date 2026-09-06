import { enrichBrandFromOfficialSite } from '../utils/brandEnricher.js';
const domain = process.argv[2] || 'www.dedon.de';
const r = await enrichBrandFromOfficialSite({ domain, maxPages: 5 });
console.log('OK:', r.ok, 'CHECKED:', r.checked, 'SITEMAP:', r.sitemap || '-', 'REASON:', r.reason || '-');
for (const p of (r.products || [])) {
  console.log('-', String(p.model).slice(0, 70), '|', String(p.brand || '-').slice(0, 20), '|', String(p.imageUrl || 'NOIMG').slice(0, 70), '|', p.category);
}
