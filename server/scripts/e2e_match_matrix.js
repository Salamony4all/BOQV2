// e2e_match_matrix.js — brand-matching matrix over the REAL modal pipeline.
// Uploads the branded BOQ, takes live LF-001 + LF-019 rows, then fires
// /api/ve-match-auto with every input combination:
// full desc, +image, no image, brand-only, model-only, partial, code-only,
// code-stripped, brand+model. Must-pass scenarios FAIL the run; ambiguous
// single-word inputs (Lobby, LF-001) are exploratory and only reported.
// Usage: node server/scripts/e2e_match_matrix.js
import fs from 'node:fs';

const API = 'http://localhost:3001';
const BRANDED = 'PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf';
let pass = 0, fail = 0;
const rowsOut = [];
const check = (name, mustPass, ok, detail = '') => {
  rowsOut.push({ name, mustPass, ok, detail });
  if (ok) pass++;
  else if (mustPass) fail++;
  console.log(`${ok ? 'PASS' : (mustPass ? 'FAIL' : 'INFO')}  ${mustPass ? '[must]' : '[expl]'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const match = async (label, mustPass, body, expectBrand) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 55000);
  try {
    const r = await fetch(`${API}/api/ve-match-auto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal, body: JSON.stringify({ qty: 1, unit: 'pcs', ...body })
    }).then((x) => x.json());
    clearTimeout(t);
    const brand = (r?.product?.brand || r?.brand || '').toLowerCase();
    const ok = brand.includes(expectBrand.toLowerCase());
    check(label, mustPass, ok, `brand="${r?.product?.brand || r?.brand || '?'}" tier=${r?.matchTier || r?.status} model="${r?.product?.model || ''}"`);
  } catch (e) {
    clearTimeout(t);
    check(label, mustPass, false, `request failed: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
  }
};

// 1) Ground in real data: upload + take two live rows
const sessionId = `matrix-${Date.now()}`;
const buf = fs.readFileSync(BRANDED);
const fd = new FormData();
fd.append('file', new Blob([buf], { type: 'application/pdf' }), '02. SCHEDULE OF LOOSE FURNITURE.pdf');
const up = await fetch(`${API}/api/upload`, {
  method: 'POST', headers: { 'x-session-id': sessionId, 'x-extraction-mode': 'wordcom_v22' }, body: fd
}).then((r) => r.json()).catch(() => ({}));
const tables = up?.data?.tables || [];
const all = [];
for (const t of tables) for (const r of (t.rows || [])) all.push(r);
const textOf = (r) => (r.cells || []).map((c) => c.value || '').filter((v) => v && v !== '-').join(' | ');
const lf001 = all.find((r) => textOf(r).includes('LF-001'));
const lf019 = all.find((r) => textOf(r).includes('LF-019'));
if (!lf001 || !lf019) { console.log(`FAIL  setup — rows found=${all.length}, LF-001=${!!lf001}, LF-019=${!!lf019}`); process.exit(1); }
const d001 = textOf(lf001);
const d019 = textOf(lf019);
const imgOf = (r) => {
  for (const c of (r.cells || [])) {
    const im = c.images || (c.image ? [c.image] : []);
    for (const m of im) {
      const u = typeof m === 'string' ? m : (m.url || m.src || '');
      if (u) return u;
    }
  }
  return null;
};
const i001 = imgOf(lf001);
console.log(`setup: rows=${all.length} img001=${i001 ? 'yes' : 'no'}`);

// 2) LF-001 Moonako Lobby matrix
await match('001-full-desc', true, { description: d001 }, 'Moonako');
await match('001-full-desc+image', true, { description: d001, imageUrl: i001 }, 'Moonako');
await match('001-partial-desc-80ch', true, { description: d001.slice(0, 80) }, 'Moonako');
await match('001-code-stripped', true, { description: d001.replace(/LF-001/g, '').replace(/A-1/g, '') }, 'Moonako');
await match('001-brand+model', true, { description: 'Moonako Lobby' }, 'Moonako');
await match('001-full-figueras-desc', true, { description: d019 }, 'Figueras');
await match('001-brand-only', false, { description: 'Moonako' }, 'Moonako');
await match('001-model-only', false, { description: 'Lobby' }, 'Moonako');
await match('001-code-only', false, { description: 'LF-001' }, 'Moonako');

// 3) LF-019 Figueras Scala matrix
await match('019-brand+model', true, { description: 'Figueras Scala' }, 'Figueras');
await match('019-category+brand+model', true, { description: 'theatre seat Figueras Scala' }, 'Figueras');

console.log(`\nMATRIX: must-pass ${fail === 0 ? 'ALL GREEN' : `${fail} FAILED`} (${pass} ok)`);
process.exit(fail === 0 ? 0 : 1);
