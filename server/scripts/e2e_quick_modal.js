// e2e_quick_modal.js — PDF upload → ve-match-auto (quick-action modal pipeline) → lens capability → tab order
// Usage: node server/scripts/e2e_quick_modal.js
import fs from 'node:fs';

const API = 'http://localhost:3001';
const BRANDED = 'PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf';
const results = { checks: [] };
const check = (name, ok, detail = '') => {
  results.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const sessionId = `e2e-${Date.now()}`;

// 1) Upload branded PDF (same contract as App.jsx: multipart `file` + headers)
console.log(`[1/4] uploading ${BRANDED} ...`);
const buf = fs.readFileSync(BRANDED);
const fd = new FormData();
fd.append('file', new Blob([buf], { type: 'application/pdf' }), '02. SCHEDULE OF LOOSE FURNITURE.pdf');
const upRes = await fetch(`${API}/api/upload`, {
  method: 'POST',
  headers: { 'x-session-id': sessionId, 'x-extraction-mode': 'wordcom_v22' },
  body: fd
});
const upJson = await upRes.json().catch(() => ({}));
const tables = upJson?.data?.tables || [];
let rowCount = 0;
const rows = [];
for (const t of tables) for (const r of (t.rows || [])) { rowCount++; rows.push(r); }
check('branded-upload-68-rows', rowCount === 68, `rows=${rowCount} tables=${tables.length}`);
check('branded-first-row-LF001', JSON.stringify(rows[0] || {}).includes('LF-001'), JSON.stringify(rows[0]).slice(0, 160));
const supaImgs = rows.filter((r) => JSON.stringify(r).includes('supabase')).length;
check('branded-supabase-images', supaImgs > 0, `${supaImgs}/${rowCount} rows carry supabase URLs`);

// 2) Quick-action modal pipeline: rebuild the item EXACTLY as TableViewer does
// (openSemanticMatchModal: header-driven descParts join + image-column images)
const table = tables[0] || {};
const header = (table.header || table.columns || []).map((h) => String(h ?? ''));
const row = rows[0] || {};
const H = (re) => header.findIndex((h) => re.test(h));
const modelIdx = H(/model|code|item_code|product/i);
const qtyIdx = H(/qty|quantity|qt/i);
const unitIdx = H(/unit|uom/i);
const brandIdx = H(/brand|maker|manufacturer/i);
const imgIdx = H(/\b(image|photo|picture|img|pic|illustration|drawing|sketch)\b/i);
const descIdx = H(/descript|spec|particular|narrat/i);
const cellImages = (imgIdx !== -1 && row.cells?.[imgIdx])
  ? (row.cells[imgIdx].images || (row.cells[imgIdx].image ? [row.cells[imgIdx].image] : []))
  : [];
const firstImg = cellImages.length > 0
  ? (typeof cellImages[0] === 'string' ? cellImages[0] : (cellImages[0].url || cellImages[0].src || ''))
  : null;
const excluded = /^(s\.?n\.?|item\s*no|pos|#|qty|quantity|qt|unit\s*rate|unit\s*price|rate|price|amount|total|image|photo|picture|img|pic)$/i;
const descParts = [];
header.forEach((h, cIdx) => {
  if (excluded.test(h.trim())) return;
  const v = (row.cells?.[cIdx]?.value || '').trim();
  if (v && v !== '-' && !descParts.includes(v)) descParts.push(v);
});
const fullDescription = descParts.length > 0 ? descParts.join(' | ') : (descIdx !== -1 ? row.cells?.[descIdx]?.value : (row.cells?.[1]?.value || ''));
check('modal-item-description', fullDescription.length > 20, JSON.stringify(fullDescription).slice(0, 140));
const item = {
  description: fullDescription,
  quantity: qtyIdx !== -1 ? parseFloat(row.cells?.[qtyIdx]?.value) || 1 : 1,
  unit: unitIdx !== -1 ? row.cells?.[unitIdx]?.value : 'pcs',
  imageUrl: firstImg || null,
  images: cellImages,
  category: row.sectionLabel || table.sheetName || null
};
console.log(`[2/4] ve-match-auto desc=${JSON.stringify(item.description).slice(0, 120)} ...`);
const veRes = await fetch(`${API}/api/ve-match-auto`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    description: item.description,
    qty: item.quantity || 1,
    unit: item.unit || 'pcs',
    imageUrl: item.imageUrl || null,
    imageAssets: item.images || (item.imageUrl ? [{ url: item.imageUrl }] : []),
    category: item.category || item.mainCategory || null,
    tier: 'mid'
  })
}).then((r) => r.json()).catch((e) => ({ status: 'error', message: e.message }));
check('automatch-success', veRes.status === 'success' && !!veRes.product, `status=${veRes.status} brand=${veRes?.product?.brand || '-'} model=${veRes?.product?.model || '-'} tier=${veRes?.matchTier || '-'}`);
check('automatch-alternatives', Array.isArray(veRes.alternatives) && veRes.alternatives.length > 0, `alts=${veRes?.alternatives?.length || 0}`);

// 3) Lens capability (modal gates server-headless on this)
const caps = await fetch(`${API}/api/lens/capabilities`).then((r) => r.json()).catch(() => null);
check('lens-capability', !!caps && typeof caps.supported === 'boolean', JSON.stringify(caps));

// 4) Tab order: Auto-Match → Lens → Alternatives (logical flow), scoped to the tab bar
const src = fs.readFileSync('src/components/AISemanticMatchModal.jsx', 'utf8');
const tabBar = src.slice(src.indexOf('tabsContainer'));
const iAuto = tabBar.indexOf('Full Auto-Match Result');
const iLens = tabBar.indexOf('Lens Visual Match');
const iAlt = tabBar.indexOf('Partner Alternatives');
check('tab-order-auto-lens-alts', iAuto > 0 && iAuto < iLens && iLens < iAlt, `auto@${iAuto} lens@${iLens} alts@${iAlt}`);

const failed = results.checks.filter((c) => !c.ok);
console.log(`\nE2E: ${results.checks.length - failed.length}/${results.checks.length} passed`);
process.exit(failed.length ? 1 : 0);
