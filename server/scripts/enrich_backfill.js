// enrich_backfill.js — one-time pass: enrich every quarantined brand missing verified products.
// Usage: node server/scripts/enrich_backfill.js [--apply]
// Dry-run lists candidates. --apply POSTs /api/brands/enrich sequentially (polite, ~1-2 min each).
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const API = 'http://localhost:3001';
const DIR = path.join(process.cwd(), 'server', 'data', 'brands');

// Read LOCAL files directly: the API merges in Supabase's old unstamped copies,
// which would hide the gateway flags. Local files are the source of truth here.
const cands = [];
for (const fn of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(DIR, fn), 'utf8')); } catch { continue; }
  if (d.gatewayVersion !== 1 || !d.discovery?.quarantine) continue;
  if (d.discovery?.expired) continue;
  const vc = (d.products || []).filter((p) => p.verified === true && p.imageUrl).length;
  if (vc < 3) cands.push({ name: d.name, rows: (d.products || []).length });
}
console.log(`CANDIDATES: ${cands.length}`);
cands.forEach((b) => console.log(' -', b.name, `(${b.rows} rows)`));
if (!APPLY) { console.log('DRY-RUN — add --apply to enrich'); process.exit(0); }

let addedTotal = 0;
for (const b of cands) {
  try {
    const r = await fetch(`${API}/api/brands/enrich`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandName: b.name, maxPages: 5 })
    }).then((x) => x.json());
    console.log(`${r.success ? 'PASS' : 'FAIL'} ${b.name}:`, r.success
      ? (r.skipped || `checked ${r.checked}, verified ${r.verified}, added ${r.added}`)
      : r.error);
    addedTotal += r.added || 0;
  } catch (e) { console.log(`FAIL ${b.name}:`, e.message); }
  await new Promise((r) => setTimeout(r, 8000)); // breathing room
}
console.log(`BACKFILL DONE — total added: ${addedTotal}`);
