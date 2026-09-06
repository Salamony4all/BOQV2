// e2e_match_sweep.js — full-file sweet-spot sweep (branded BOQ).
// Uploads once, rebuilds each row's modal description EXACTLY like TableViewer,
// fires /api/ve-match-auto per row, grades result brand vs the maker the row
// text itself names (catalog-name hit). Rows naming no maker are exploratory.
// Prints per-row verdicts + summary + failure list (the sweet-spot targets).
// Usage: node server/scripts/e2e_match_sweep.js
import fs from 'node:fs';

const API = 'http://localhost:3001';
const BRANDED = 'PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf';

// Brand list = live catalog (same source the modal/AI sees)
const brands = await fetch(`${API}/api/brands`).then((r) => r.json()).catch(() => ({}));
const names = [...new Set(((brands?.data || brands?.brands || brands || []))
  .map((b) => (typeof b === 'string' ? b : b.name)).filter(Boolean))]
  .filter((n) => !/fitout/i.test(n)).sort((a, b) => b.length - a.length);

const sessionId = `sweep-${Date.now()}`;
const buf = fs.readFileSync(BRANDED);
const fd = new FormData();
fd.append('file', new Blob([buf], { type: 'application/pdf' }), '02. SCHEDULE OF LOOSE FURNITURE.pdf');
const up = await fetch(`${API}/api/upload`, {
  method: 'POST', headers: { 'x-session-id': sessionId, 'x-extraction-mode': 'wordcom_v22' }, body: fd
}).then((r) => r.json()).catch(() => ({}));
const tables = up?.data?.tables || [];
const header = ((tables[0] || {}).header || (tables[0] || {}).columns || []).map((h) => String(h ?? ''));
const rows = [];
for (const t of tables) for (const r of (t.rows || [])) rows.push(r);
console.log(`setup: rows=${rows.length} catalog-brands=${names.length}`);

const excluded = /^(s\.?n\.?|item\s*no|pos|#|qty|quantity|qt|unit\s*rate|unit\s*price|rate|price|amount|total|image|photo|picture|img|pic)$/i;
const descOf = (row) => {
  const parts = [];
  header.forEach((h, i) => {
    if (excluded.test(h.trim())) return;
    const v = (row.cells?.[i]?.value || '').trim();
    if (v && v !== '-' && !parts.includes(v)) parts.push(v);
  });
  return parts.join(' | ');
};
const expectedOf = (text) => {
  for (const n of names) {
    if (n.length < 3) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      // Word boundaries: "LAS" must not match "pLastic", "TON" not "cotton"
      if (new RegExp(`\\b${esc}\\b`, 'i').test(text)) return n;
    } catch { if (text.toLowerCase().includes(n.toLowerCase())) return n; }
  }
  return null;
};

let pass = 0, fail = 0, expl = 0;
const failures = [];
for (let i = 0; i < rows.length; i++) {
  const desc = descOf(rows[i]);
  const want = expectedOf(desc);
  const code = (desc.match(/LF-\d+/) || ['?'])[0];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 55000);
  try {
    const r = await fetch(`${API}/api/ve-match-auto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal, body: JSON.stringify({ description: desc, qty: 1, unit: 'pcs' })
    }).then((x) => x.json());
    clearTimeout(t);
    const got = r?.product?.brand || r?.brand || '?';
    if (!want) { expl++; console.log(`EXPL  row${i + 1} ${code} — no maker in text → got "${got}" tier=${r?.matchTier || r?.status}`); continue; }
    const ok = got.toLowerCase().includes(want.toLowerCase()) || want.toLowerCase().includes(got.toLowerCase());
    if (ok) { pass++; console.log(`PASS  row${i + 1} ${code} — want "${want}" got "${got}" tier=${r?.matchTier}`); }
    else { fail++; failures.push({ row: i + 1, code, want, got, tier: r?.matchTier || r?.status }); console.log(`FAIL  row${i + 1} ${code} — want "${want}" got "${got}" tier=${r?.matchTier || r?.status}`); }
  } catch (e) {
    clearTimeout(t);
    fail++; failures.push({ row: i + 1, code, want: want || '?', got: 'TIMEOUT/ERR', tier: '-' });
    console.log(`FAIL  row${i + 1} ${code} — request failed (${e.name === 'AbortError' ? 'timeout' : e.message})`);
  }
}
console.log(`\nSWEEP: ${pass} pass / ${fail} fail / ${expl} exploratory (no maker in text) of ${rows.length}`);
if (failures.length) { console.log('FAILURES:'); failures.forEach((f) => console.log(`  row${f.row} ${f.code}: want "${f.want}" got "${f.got}" [${f.tier}]`)); }
process.exit(fail === 0 ? 0 : 1);
