/**
 * Geometric (layout-driven) PDF table parser — format-agnostic.
 *
 * Unlike the pattern parsers, nothing here depends on a known document layout or on
 * header wording. A table is recognised by its SHAPE:
 *   1. a header row naming at least two measure columns (qty / unit / rate / amount),
 *   2. column bands taken from the header positions and the whitespace gutters below,
 *   3. "anchor" rows = positions where measure columns hold values,
 *   4. description paragraphs attached to anchors by vertical proximity (works for
 *      numbers centred on a wrapped paragraph and for numbers on its first line),
 *   5. lone short paragraphs between items = section headings; total / VAT / discount
 *      lines = summary rows (kept out of the items and used to reconcile the sum).
 *
 * Runs on MuPDF-WASM only, so it is safe on Vercel.
 */
import fs from 'fs/promises';

export const GEOMETRIC_PARSER_VERSION = 'geometric-v2';

// ── Column role vocabulary (multi-language, deliberately small: shape does the rest) ──
const ROLE_PATTERNS = [
  { role: 'sn', rx: /^(s\.?\s*n\.?o?\.?|sr\.?\s*n\.?o?\.?|sl\.?\s*n\.?o?\.?|ser(ial)?\.?(\s*no\.?)?|item(\s*(no\.?|#))?|line(\s*(no\.?|#))?|no\.?|#|pos\.?|position|ref\.?|م|الرقم|البند|رقم البند)$/i },
  { role: 'qty', rx: /\b(qty|quantity|quantities|qnty|q'?ty|quanity|count|menge|anzahl|quantit[eé]|cantidad)\b|الكمية|العدد/i },
  { role: 'unit', rx: /^(unit|units|uom|u\.o\.m\.?|u\/m|measure|unit of measure(ment)?|einheit|unit[eé]|unidad|الوحدة)$/i },
  { role: 'rate', rx: /\b(rate|unit\s*rate|unit\s*price|price|unit\s*cost|u\.?\s*price|einheitspreis|prix\s*unitaire|precio)\b|السعر|سعر الوحدة/i },
  { role: 'amount', rx: /\b(amount|total|value|sum|extended|ext\.?\s*price|gesamt(betrag|preis)?|montant|importe)\b|الإجمالي|المبلغ|القيمة/i },
  { role: 'desc', rx: /\b(description|desc\.?|particulars?|details?|specifications?|scope(\s*of\s*(work|supply))?|item\s*description|bezeichnung|beschreibung|d[eé]signation|descripci[oó]n)\b|الوصف|البيان|وصف/i },
  { role: 'image', rx: /\b(image|photo|picture|img|sketch|illustration)s?\b|صورة/i },
  { role: 'code', rx: /\b(code|item\s*code|product\s*code|model|article|sku|part\s*no\.?)\b|الرمز/i },
  { role: 'remarks', rx: /\b(remarks?|notes?|comments?)\b|ملاحظات/i }
];
const MEASURE_ROLES = new Set(['qty', 'unit', 'rate', 'amount']);
const CANONICAL_LABEL = { sn: 'S.No', desc: 'Item Description', unit: 'Unit', qty: 'Quantity', rate: 'Unit Rate', amount: 'Total', image: 'Image', code: 'Product Code', remarks: 'Remarks' };

const SUMMARY_RX = /^\(?\s*(sub[\s-]*total|grand\s*total|net\s*total|total|net\s*amount|gross\s*total|less\b|discount|add\b|vat|tax|carried|brought|c\/f|b\/f|المجموع|الإجمالي|الخصم|الضريبة)/i;
// Labels of a totals block when they carry no figure of their own (unpriced tender forms)
const TOTALS_LABEL_RX = /^\(?\s*(\d+(\.\d+)?\s*%\s*)?(sub[\s-]*total|grand\s*total|net\s*total|total|vat|tax|gst|contingenc(y|ies)|discount|contract\s*(price|sum|total|amount)|carried|brought|rounding)\b/i;
const FOOTER_RX = /^(notes?\s*:|terms\s*(&|and)\s*conditions|payment\s*terms|validity|exclusions?\s*:|prepared\s*by|authori[sz]ed|for\s+and\s+on\s+behalf|signature)/i;

function roleOf(text) {
  const clean = String(text || '').replace(/\([^)]*\)/g, ' ').replace(/\b(omr|aed|usd|sar|qar|eur|gbp|kwd|bhd|egp|inr|sdg|r\.?o\.?)\b\.?/gi, ' ').replace(/[-–|:]+\s*$/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 48) return null;
  // "Total Qty" is a quantity, "Unit Price" is a rate: test compound meanings first
  if (/\b(total|est\.?|base)\s*(qty|quantity)\b/i.test(clean)) return 'qty';
  if (/\b(ext(ended)?\.?|total|net\s*total|line)\s*(net\s*)?(price|cost|amount|value)\b/i.test(clean)) return 'amount';
  if (/\bunit\s*(net\s*)?(rate|price|cost)\b/i.test(clean)) return 'rate';
  for (const { role, rx } of ROLE_PATTERNS) if (rx.test(clean)) return role;
  // A label broken mid-word by a narrow cell ("Quantit" / "y")
  if (/\s/.test(clean) && clean.length <= 16) {
    const glued = clean.replace(/\s+/g, '');
    for (const { role, rx } of ROLE_PATTERNS) if (role !== 'sn' && rx.test(glued)) return role;
  }
  return null;
}

/** Tolerant number parser: 5,250.000 | 1.234,56 | (848.000) | 2.5 | OMR 12.500 */
export function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[()\s]/g, '').replace(/^[^\d.,-]+|[^\d.,]+$/g, '').replace(/^-/, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  // European style only when unambiguous: 1.234,56 | 1.234.567 | 12,5 (a lone 636.000 is 3-decimal money)
  if (/^\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ── 1. Positioned text segments ──────────────────────────────────────────────
function pageSegments(page) {
  const segs = [];
  let cur = null;
  let lastX1 = null;
  const flush = () => {
    if (cur && cur.text.trim()) {
      cur.text = cur.text.replace(/\s+/g, ' ').trim();
      segs.push(cur);
    }
    cur = null;
    lastX1 = null;
  };
  page.toStructuredText('preserve-whitespace').walk({
    beginLine() { flush(); },
    onChar(c, origin, font, size, quad) {
      const x0 = Math.min(quad[0], quad[4]);
      const x1 = Math.max(quad[2], quad[6]);
      // Glyph boxes can be far taller than the text (fonts with big ascent/descent), which
      // would glue neighbouring lines together: derive the line box from baseline + size.
      let y0 = Math.min(quad[1], quad[3]);
      let y1 = Math.max(quad[5], quad[7]);
      if (origin && size > 0 && y1 - y0 > size * 1.35) { y0 = origin[1] - size * 0.82; y1 = origin[1] + size * 0.24; }
      // A wide horizontal jump inside one MuPDF line means two table cells
      if (cur && lastX1 !== null && x0 - lastX1 > Math.max(size * 1.6, 9)) flush();
      if (!cur) {
        let bold = false;
        try { bold = /bold|black|heavy|semibold|demi/i.test(font.getName()) || font.isBold(); } catch { /* ignore */ }
        cur = { x0, x1, y0, y1, text: '', bold, size };
      }
      cur.text += c;
      if (c.trim()) {
        cur.x0 = Math.min(cur.x0, x0); cur.x1 = Math.max(cur.x1, x1);
        cur.y0 = Math.min(cur.y0, y0); cur.y1 = Math.max(cur.y1, y1);
        lastX1 = x1;
      }
    },
    endLine() { flush(); }
  });
  flush();
  for (const s of segs) { s.cy = (s.y0 + s.y1) / 2; s.h = Math.max(1, s.y1 - s.y0); }
  return segs;
}

/** Horizontal ruling lines of a page (table row borders), as sorted y positions. */
function pageHorizontalRules(mupdf, page) {
  const ys = [];
  try {
    const bounds = page.getBounds();
    const minLen = (bounds[2] - bounds[0]) * 0.25;
    const collect = (path, ctm) => {
      const T = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
      let cur = null, start = null;
      const add = (p, q) => { if (Math.abs(p[1] - q[1]) < 0.8 && Math.abs(p[0] - q[0]) >= minLen) ys.push((p[1] + q[1]) / 2); };
      path.walk({
        moveTo(x, y) { cur = T(x, y); start = cur; },
        lineTo(x, y) { const p = T(x, y); if (cur) add(cur, p); cur = p; },
        curveTo() { cur = null; },
        closePath() { if (cur && start) add(cur, start); cur = start; }
      });
    };
    const device = new mupdf.Device({
      fillPath(path, evenOdd, ctm) { collect(path, ctm); },
      strokePath(path, stroke, ctm) { collect(path, ctm); }
    });
    page.run(device, mupdf.Matrix.identity);
    try { device.close(); } catch { /* older builds */ }
  } catch { return []; }
  ys.sort((a, b) => a - b);
  const out = [];
  for (const y of ys) if (!out.length || y - out[out.length - 1] > 2.5) out.push(y);
  return out;
}

export async function loadPdfSegments(pdfPath) {
  const mupdf = await import('mupdf');
  const data = await fs.readFile(pdfPath);
  const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    try {
      const page = doc.loadPage(i);
      pages.push({ pageNum: i + 1, segs: pageSegments(page), rules: pageHorizontalRules(mupdf, page) });
    } catch { pages.push({ pageNum: i + 1, segs: [], rules: [] }); }
  }
  return pages;
}

function visualRows(segs) {
  const sorted = [...segs].sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
  const rows = [];
  for (const s of sorted) {
    const row = rows.length ? rows[rows.length - 1] : null;
    if (row && Math.abs(row.cy - s.cy) <= Math.max(row.h, s.h) * 0.45) {
      row.segs.push(s); row.cy = (row.cy * (row.segs.length - 1) + s.cy) / row.segs.length; row.h = Math.max(row.h, s.h);
      row.y0 = Math.min(row.y0, s.y0); row.y1 = Math.max(row.y1, s.y1);
    } else rows.push({ cy: s.cy, h: s.h, y0: s.y0, y1: s.y1, segs: [s] });
  }
  rows.forEach(r => r.segs.sort((a, b) => a.x0 - b.x0));
  return rows;
}

// ── 2. Header + column bands ─────────────────────────────────────────────────
/** Merge the segments of 1-3 stacked header lines into header cells by horizontal overlap. */
function mergeHeaderRows(rowGroup) {
  // The main line is the one naming the most columns; other lines only add to it
  let main = rowGroup[0], mainRoles = -1;
  for (const row of rowGroup) {
    const n = row.segs.filter(s => roleOf(s.text)).length;
    if (n > mainRoles) { mainRoles = n; main = row; }
  }
  const cells = [];
  for (const row of rowGroup) {
    for (const s of row.segs) {
      const hit = cells.find(c => Math.min(c.x1, s.x1) - Math.max(c.x0, s.x0) > -2 || Math.abs((c.x0 + c.x1) / 2 - (s.x0 + s.x1) / 2) < 10);
      const near = row === main || (Math.min(s.y1, main.y1) - Math.max(s.y0, main.y0)) > 0;
      if (hit) { hit.text = `${hit.text} ${s.text}`; hit.x0 = Math.min(hit.x0, s.x0); hit.x1 = Math.max(hit.x1, s.x1); hit.parts++; hit.near = hit.near || near; }
      else cells.push({ text: s.text, x0: s.x0, x1: s.x1, parts: 1, near });
    }
  }
  cells.sort((a, b) => a.x0 - b.x0);
  // A lone label on a separate line that touches nothing in the main line (a title or
  // reference caught above the header) is not a column
  return cells.filter(c => c.near || c.parts > 1 || roleOf(c.text));
}

function headerScore(cells) {
  if (cells.length < 3) return 0;
  if (cells.some(c => c.text.length > 60)) return 0;
  if (cells.filter(c => parseAmount(c.text) !== null).length > cells.length / 3) return 0; // data, not labels
  const roles = cells.map(c => roleOf(c.text));
  const measures = new Set(roles.filter(x => MEASURE_ROLES.has(x)));
  if (measures.size < 2) return 0;
  return measures.size * 10 + new Set(roles.filter(Boolean)).size;
}

/** Header = the 1-3 adjacent lines whose merged labels name the most column roles. */
function findHeader(rows, fromIdx = 0) {
  for (let i = fromIdx; i < rows.length; i++) {
    let best = null;
    for (let span = 1; span <= 3 && i + span <= rows.length; span++) {
      const group = rows.slice(i, i + span);
      const tight = group.every((r, k) => k === 0 || r.y0 - group[k - 1].y1 < Math.max(r.h, group[k - 1].h) * 1.3);
      if (!tight) break;
      if (group.some(r => r.segs.some(s => s.text.length > 48))) break;
      const cells = mergeHeaderRows(group);
      const score = headerScore(cells);
      if (score > 0 && (!best || score > best.score)) best = { idx: i, endIdx: i + span - 1, score, row: { segs: cells.map(c => ({ ...c })), y0: group[0].y0, y1: group[span - 1].y1, h: group[0].h } };
    }
    if (best) {
      // A later start inside the same band may capture the labels better (e.g. band starts with a title line)
      for (let j = i + 1; j <= best.endIdx; j++) {
        const alt = findHeaderAt(rows, j);
        if (alt && alt.score > best.score) best = alt;
      }
      return best;
    }
  }
  return null;
}

function findHeaderAt(rows, i) {
  let best = null;
  for (let span = 1; span <= 3 && i + span <= rows.length; span++) {
    const group = rows.slice(i, i + span);
    const tight = group.every((r, k) => k === 0 || r.y0 - group[k - 1].y1 < Math.max(r.h, group[k - 1].h) * 1.3);
    if (!tight) break;
    const cells = mergeHeaderRows(group);
    const score = headerScore(cells);
    if (score > 0 && (!best || score > best.score)) best = { idx: i, endIdx: i + span - 1, score, row: { segs: cells.map(c => ({ ...c })), y0: group[0].y0, y1: group[span - 1].y1, h: group[0].h } };
  }
  return best;
}

const SERIAL_CELL_RX = /^\(?(\d{1,3}|[A-Za-z]|[ivxIVX]{1,5})(?:[.\-]\d+){0,3}[.)]?$/;

/**
 * One text run can hold two header labels ("ITEM No. DESCRIPTION"). Split it when the left
 * part names a serial column and the right part another role; a bare "Item ..." is only split
 * when the body really shows a serial column under its left edge.
 */
function splitCompoundHeaderCells(cells, bodySegs) {
  const out = [];
  for (const c of cells) {
    const words = c.text.trim().split(/\s+/);
    let done = false;
    for (let k = words.length - 1; k >= 1 && !done; k--) {
      const left = words.slice(0, k).join(' '), right = words.slice(k).join(' ');
      if (roleOf(left) !== 'sn') continue;
      const rr = roleOf(right);
      if (rr === 'sn' || MEASURE_ROLES.has(rr)) continue;
      const width = c.x1 - c.x0;
      const splitX = c.x0 + width * (left.length + 0.5) / c.text.trim().length;
      if (!rr || /^items?$/i.test(left)) {
        const serials = bodySegs.filter(s => s.x0 >= c.x0 - 12 && s.x1 <= splitX + 6 && SERIAL_CELL_RX.test(s.text.trim())).length;
        if (serials < 3) continue;
      }
      out.push({ ...c, text: left, x1: splitX - 1 }, { ...c, text: right, x0: splitX + 1 });
      done = true;
    }
    if (!done) out.push(c);
  }
  return out;
}

function buildColumns(headerRow, bodySegs) {
  const cols = headerRow.segs.map(s => ({ label: s.text, hx0: s.x0, hx1: s.x1, role: roleOf(s.text) }));
  // 'Item' is a serial column unless it directly follows quantity (then it is a unit)
  cols.forEach((c, i) => { if (/^item$/i.test(c.label.trim())) c.role = (i > 0 && cols[i - 1].role === 'qty') ? 'unit' : 'sn'; });

  // Gutters: x-ranges that (almost) no body text crosses
  const minX = Math.floor(Math.min(...cols.map(c => c.hx0), ...bodySegs.map(s => s.x0)) - 2);
  const maxX = Math.ceil(Math.max(...cols.map(c => c.hx1), ...bodySegs.map(s => s.x1)) + 2);
  const cover = new Array(Math.max(1, maxX - minX + 1)).fill(0);
  // Runs crossing most of the table (notes, titles, footers) are not cell content
  const wide = cols.length >= 4 ? (maxX - minX) * 0.55 : Infinity;
  for (const s of bodySegs) {
    if (s.x1 - s.x0 > wide) continue;
    for (let x = Math.max(minX, Math.round(s.x0)); x <= Math.min(maxX, Math.round(s.x1)); x++) cover[x - minX]++;
  }
  // Clean gutters first; ragged columns (centred serials, justified text) need a looser look
  const tolerances = [0.012, 0.05, 0.12].map(f => Math.max(0, Math.floor(bodySegs.length * f)));

  const bounds = [minX];
  const hasGutter = [];
  for (let i = 0; i < cols.length - 1; i++) {
    const lo = Math.floor(cols[i].hx0 + 1), hi = Math.ceil(cols[i + 1].hx1 - 1);
    const target = (cols[i].hx1 + cols[i + 1].hx0) / 2;
    // A header label sits inside its own column, so the boundary normally falls in the gap
    // between two labels: a gutter there beats a cleaner one elsewhere (e.g. the blank
    // strip beside right-aligned numbers).
    const gapLo = Math.min(cols[i].hx1, cols[i + 1].hx0) - 1, gapHi = Math.max(cols[i].hx1, cols[i + 1].hx0) + 1;
    let best = null, tier = -1, outside = null;
    for (const tolerance of tolerances) {
      tier++;
      let start = null;
      for (let x = lo; x <= hi + 1; x++) {
        const free = x <= hi && cover[x - minX] <= tolerance;
        if (free && start === null) start = x;
        if (!free && start !== null) {
          const width = x - start;
          const inGap = Math.min(x, gapHi) - Math.max(start, gapLo) > 0;
          const mid = inGap ? (Math.max(start, gapLo) + Math.min(x, gapHi)) / 2 : (start + x) / 2;
          // Prefer the gutter nearest to the gap between the two header labels
          const score = width - Math.abs(mid - target) * 0.15;
          if (width >= 2) {
            if (inGap) { if (!best || score > best.score) best = { mid, score }; }
            else if (!outside || (outside.tier === tier && score > outside.score)) outside = { mid, score, tier };
          }
          start = null;
        }
      }
      if (best || (outside && tier >= 1)) break;
    }
    if (!best && outside) { best = outside; tier = outside.tier; }
    bounds.push(best ? best.mid : target);
    hasGutter.push(Boolean(best) && tier < 2);
  }
  bounds.push(maxX);
  cols.forEach((c, i) => { c.x0 = bounds[i]; c.x1 = bounds[i + 1]; });
  // A label with no role and no body column of its own (a title line caught in the header
  // band, a two-word label split by spacing) belongs to the neighbour it shares text with.
  for (let i = cols.length - 1; i >= 0; i--) {
    if (cols[i].role || cols.length <= 3) continue;
    const openRight = i < cols.length - 1 && !hasGutter[i];
    const openLeft = i > 0 && !hasGutter[i - 1];
    if (!openRight && !openLeft) continue;
    const into = openRight ? i + 1 : i - 1;
    cols[into].x0 = Math.min(cols[into].x0, cols[i].x0);
    cols[into].x1 = Math.max(cols[into].x1, cols[i].x1);
    cols[into].hx0 = Math.min(cols[into].hx0, cols[i].hx0);
    cols[into].hx1 = Math.max(cols[into].hx1, cols[i].hx1);
    // Text running under a picture column's label: the text column wins, the picture has no text
    if (cols[into].role === 'image') { cols[into].role = null; cols[into].label = cols[i].label; }
    else if (!cols[into].role) cols[into].label = openRight ? `${cols[i].label} ${cols[into].label}` : `${cols[into].label} ${cols[i].label}`;
    hasGutter.splice(openRight ? i : i - 1, 1);
    cols.splice(i, 1);
  }
  return cols;
}

function columnIndexOf(seg, cols) {
  let best = -1, bestOverlap = 0;
  for (let i = 0; i < cols.length; i++) {
    const overlap = Math.min(seg.x1, cols[i].x1) - Math.max(seg.x0, cols[i].x0);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }
  }
  return best;
}

function inferDescriptionColumn(cols, bodySegs) {
  if (cols.some(c => c.role === 'desc')) return;
  const chars = cols.map(() => 0);
  for (const s of bodySegs) {
    const ci = columnIndexOf(s, cols);
    if (ci >= 0 && parseAmount(s.text) === null) chars[ci] += s.text.length;
  }
  let best = -1;
  cols.forEach((c, i) => {
    if (MEASURE_ROLES.has(c.role) || c.role === 'sn' || c.role === 'image') return;
    if (best === -1 || chars[i] > chars[best]) best = i;
  });
  if (best >= 0 && chars[best] > 0) { cols[best].inferredFrom = cols[best].label; cols[best].role = 'desc'; }
}

// ── 3-5. Body: anchors, paragraphs, sections, summaries ──────────────────────
function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function parsePageBody(segs, cols, pageNum, state, rules = [], map = null) {
  const descIdx = cols.findIndex(c => c.role === 'desc');
  // Page column index -> index in the document's (master) column list
  const M = (i) => (map ? map[i] : i);
  const width = map ? Math.max(state.width || 0, ...map.map(i => i + 1)) : cols.length;
  const toMaster = (vals) => { const out = new Array(width).fill(''); vals.forEach((v, i) => { if (v) out[M(i)] = out[M(i)] ? `${out[M(i)]} ${v}` : v; }); return out; };
  const idxOf = role => cols.findIndex(c => c.role === role);
  const qtyIdx = idxOf('qty'), rateIdx = idxOf('rate'), amountIdx = idxOf('amount'), unitIdx = idxOf('unit'), snIdx = idxOf('sn');
  const firstMeasure = cols.findIndex(c => MEASURE_ROLES.has(c.role));

  // Two kinds of column. MARK columns (serial, quantity, unit, prices) hold one short value
  // per item and tell us where items are. TEXT columns (description, category, brand,
  // remarks ...) hold paragraphs that may wrap over several lines in any of them.
  const isText = cols.map((c, i) => !MEASURE_ROLES.has(c.role) && i !== snIdx);
  const colOf = new Map();
  for (const s of segs) colOf.set(s, columnIndexOf(s, cols));
  const textSegs = segs.filter(s => colOf.get(s) >= 0 && isText[colOf.get(s)]);
  const markSegs = segs.filter(s => colOf.get(s) >= 0 && !isText[colOf.get(s)]);

  // Anchors: y-clusters of mark values that identify an item
  const marks = []; // serial-only rows: an item's first line, a section letter, a merged cell
  const anchors = visualRows(markSegs).map(r => {
    const cells = cols.map(() => '');
    for (const s of r.segs) { const ci = colOf.get(s); cells[ci] = cells[ci] ? `${cells[ci]} ${s.text}` : s.text; }
    return { cy: r.cy, y0: r.y0, y1: r.y1, h: r.h, cells, lines: [] };
  }).filter(a => {
    const hasNumber = [qtyIdx, rateIdx, amountIdx].some(i => i >= 0 && parseAmount(a.cells[i]) !== null);
    const hasUnit = unitIdx >= 0 && a.cells[unitIdx] && a.cells[unitIdx].length <= 12;
    const hasSn = snIdx >= 0 && a.cells[snIdx];
    if (hasNumber || (hasUnit && hasSn)) return true;
    if (hasSn && a.cells[snIdx].length <= 12) marks.push({ cy: a.cy, y0: a.y0, y1: a.y1, h: a.h, text: a.cells[snIdx], lead: null });
    return false;
  });

  // A "primary" anchor identifies an item (serial, quantity or unit). A "partial" one only
  // carries a price typed at a different height of the same cell.
  const isPrimary = (a) => (snIdx >= 0 && a.cells[snIdx]) || (qtyIdx >= 0 && parseAmount(a.cells[qtyIdx]) !== null) || (unitIdx >= 0 && a.cells[unitIdx]);

  // Text lines across all text columns
  const lines = visualRows(textSegs).map(r => {
    const parts = cols.map(() => '');
    for (const s of r.segs) { const ci = colOf.get(s); parts[ci] = parts[ci] ? `${parts[ci]} ${s.text}` : s.text; }
    return { cy: r.cy, y0: r.y0, y1: r.y1, h: r.h, parts, text: r.segs.map(s => s.text).join(' '), bold: r.segs.every(s => s.bold), mark: null };
  });
  const descLines = descIdx >= 0 ? visualRows(textSegs.filter(s => colOf.get(s) === descIdx)) : [];
  const pitchBase = descLines.length >= 3 ? descLines : lines;
  const pitch = median(pitchBase.slice(1).map((l, i) => l.cy - pitchBase[i].cy).filter(d => d > 0)) || median(lines.map(l => l.h)) * 1.2 || 10;

  // Serial-only rows. If the next item below has no serial of its own, the mark is that
  // item's serial and its line is the item's first line; otherwise it numbers a heading.
  marks.sort((x, y) => x.cy - y.cy);
  marks.forEach((m, k) => {
    const next = anchors.find(a => a.cy > m.cy + m.h * 0.6);
    const nextMark = marks[k + 1];
    if (next && !(snIdx >= 0 && next.cells[snIdx]) && (!nextMark || nextMark.cy > next.cy)) m.lead = next;
    m.line = lines.find(l => Math.abs(l.cy - m.cy) <= Math.max(l.h, m.h) * 0.6) || null;
    if (m.line) m.line.mark = m;
  });

  // Row bands: ruling lines are the table's own answer to "which lines share a cell".
  // Without rules (or outside them) fall back to paragraph gaps.
  const bandOf = (cy) => {
    for (let i = 0; i < rules.length - 1; i++) if (cy > rules[i] && cy <= rules[i + 1]) return i;
    return -1;
  };
  const ruledAnchors = anchors.filter(a => bandOf(a.cy) >= 0).length;
  // Rules only help when they separate the items; a frame around the whole table does not
  const bandsWithAnchors = new Set(anchors.map(a => bandOf(a.cy)).filter(k => k >= 0)).size;
  const useRules = rules.length >= 3 && ruledAnchors >= anchors.length * 0.6 && bandsWithAnchors >= Math.max(2, anchors.length * 0.5);
  const blocks = [];
  for (const l of lines) {
    const band = useRules ? bandOf(l.cy) : -1;
    const last = blocks[blocks.length - 1];
    if (band >= 0) {
      if (last && last.band === band) { last.lines.push(l); last.y1 = Math.max(last.y1, l.y1); }
      else blocks.push({ lines: [l], y0: l.y0, y1: l.y1, band, ay0: rules[band], ay1: rules[band + 1] });
    } else if (last && last.band === -1 && !last.closed && !l.mark && l.cy - last.lines[last.lines.length - 1].cy <= pitch * 1.38) {
      last.lines.push(l); last.y1 = Math.max(last.y1, l.y1);
    } else blocks.push({ lines: [l], y0: l.y0, y1: l.y1, band: -1, closed: Boolean(l.mark && !l.mark.lead) });
  }

  const events = []; // ordered: {type:'section'|'item'|'summary'|'orphan', y}
  const usedAnchors = new Set();
  const slack = pitch * 0.55;
  const insideOf = (b) => (b.band >= 0
    ? anchors.filter(a => a.cy > b.ay0 && a.cy <= b.ay1)
    : anchors.filter(a => a.cy >= b.y0 - slack && a.cy <= b.y1 + slack));

  // An item that opens with its serial: every paragraph from that line down to the line
  // carrying its quantity belongs to it, however the paragraphs are spaced.
  for (const m of marks) {
    if (!m.lead || !m.line) continue;
    for (const b of blocks) {
      if (b.band >= 0 || b.consumed || b.y0 < m.line.y0 - 0.5 || b.y0 > m.lead.cy) continue;
      if (insideOf(b).some(a => a !== m.lead)) continue;
      m.lead.lines.push(...b.lines); b.consumed = true; usedAnchors.add(m.lead);
    }
    if (snIdx >= 0 && !m.lead.cells[snIdx]) m.lead.cells[snIdx] = m.text;
  }

  for (const b of blocks) {
    if (b.consumed) continue;
    const inside = insideOf(b);
    if (inside.length > 1) mergePartialAnchors(inside, anchors, isPrimary);
    if (inside.length === 1) {
      inside[0].lines.push(...b.lines); usedAnchors.add(inside[0]);
    } else if (inside.length > 1) {
      // Dense rows without gaps. Numbers usually sit on the FIRST line of their item, but
      // some schedules print them on the LAST: take the reading in which items start like
      // sentences rather than mid-phrase.
      inside.sort((x, y) => x.cy - y.cy);
      const assign = (mode) => {
        const own = new Map(inside.map(a => [a, []]));
        for (const l of b.lines) {
          let owner = null;
          if (mode === 'top') { for (const a of inside) if (a.cy <= l.cy + l.h * 0.6) owner = a; owner = owner || inside[0]; }
          else { for (let k = inside.length - 1; k >= 0; k--) if (inside[k].cy >= l.cy - l.h * 0.6) owner = inside[k]; owner = owner || inside[inside.length - 1]; }
          own.get(owner).push(l);
        }
        return own;
      };
      const badness = (own) => {
        let bad = 0;
        for (const ls of own.values()) {
          if (!ls.length) { bad++; continue; }
          const first = String((descIdx >= 0 && ls[0].parts[descIdx]) || ls[0].text).trim();
          if (/^[a-z)\],;]/.test(first)) bad++;
        }
        return bad;
      };
      const top = assign('top'), bottom = assign('bottom');
      const chosen = badness(bottom) < badness(top) ? bottom : top;
      for (const [a, ls] of chosen) a.lines.push(...ls);
      inside.forEach(a => usedAnchors.add(a));
    } else {
      // A heading is read from the description column when it has text there (page or
      // reference columns beside it are not part of the heading)
      const descText = descIdx >= 0 ? b.lines.map(l => l.parts[descIdx]).filter(Boolean).join(' ').trim() : '';
      const text = descText || b.lines.map(l => l.text).join(' ').trim();
      // Text only in the trailing columns (remarks after the prices) continues an item
      const trailingOnly = firstMeasure >= 0 && b.lines.every(l => l.parts.every((v, i) => !v || i > firstMeasure));
      const letters = text.replace(/[^A-Za-z\u0600-\u06ff]/g, '');
      const strong = b.lines.every(l => l.bold) || b.lines.some(l => l.mark) || (letters.length >= 3 && text.replace(/[^A-Z]/g, '').length >= letters.length * 0.7);
      const headingLike = !trailingOnly && b.lines.length <= 2 && text.length <= 90 && !/[.;,]$/.test(text) && !/^[a-z]/.test(text);
      events.push({ type: headingLike ? 'section' : 'orphan', y: b.y0, text, block: b, strong });
    }
  }
  // Serial-only rows with no text line of their own (a cell merged over several rows)
  for (const m of marks) {
    if (m.lead || m.line || snIdx < 0) continue;
    const host = anchors.find(a => !a.cells[snIdx] && m.cy >= Math.min(a.y0, ...a.lines.map(l => l.y0)) - slack && m.cy <= Math.max(a.y1, ...a.lines.map(l => l.y1)) + slack);
    if (host) host.cells[snIdx] = m.text;
  }
  for (const a of anchors) {
    a.lines.sort((p, q) => p.cy - q.cy);
    events.push({ type: 'anchor', y: a.lines.length ? Math.min(a.y0, a.lines[0].y0) : a.y0, anchor: a });
  }
  events.sort((x, y) => x.y - y.y);
  const lastMarkY = Math.max(-Infinity, ...anchors.map(a => a.cy));
  const joinParts = (ls) => cols.map((c, i) => (isText[i] ? ls.map(l => l.parts[i]).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() : ''));

  let firstEvent = true;
  for (const ev of events) {
    if (state.ended) break;
    // The first lines of a page, before any figure, in plain type: the tail of the item
    // that was cut by the page break rather than a new heading
    if (firstEvent && ev.type === 'section' && !ev.strong && state.items.length && state.items[state.items.length - 1].pageNum !== pageNum) ev.type = 'orphan';
    firstEvent = false;
    if (ev.type === 'section') {
      if (FOOTER_RX.test(ev.text) && ev.y > lastMarkY) { state.ended = true; break; }
      if (SUMMARY_RX.test(ev.text)) continue;
      state.section = ev.text;
      state.pendingHeadings.push(ev.text);
      continue;
    }
    if (ev.type === 'orphan') {
      if (FOOTER_RX.test(ev.text) && ev.y > lastMarkY) { state.ended = true; break; }
      // A stack of total labels with no figures is the (unpriced) totals block
      if (ev.block.lines.every(l => l.text.length <= 60 && TOTALS_LABEL_RX.test(l.text))) {
        for (const l of ev.block.lines) state.summaries.push({ label: l.text, amount: null, pageNum });
        continue;
      }
      // A paragraph with no numbers continues the previous item (across a page break, or
      // further down the same cell while the table is still running below it)
      const prev = state.items[state.items.length - 1];
      if (prev && (prev.pageNum !== pageNum || ev.y - prev.yEnd <= pitch * 2.4 || ev.y < lastMarkY)) {
        joinParts(ev.block.lines).forEach((v, i) => { if (v) prev.values[M(i)] = `${prev.values[M(i)] || ''} ${v}`.trim(); });
        prev.yEnd = ev.block.y1;
      }
      continue;
    }
    const a = ev.anchor;
    // Unnumbered total labels printed right under the last item are not part of it
    while (a.lines.length > 1) {
      const tail = a.lines[a.lines.length - 1];
      if (tail.cy <= a.cy + a.h || tail.text.length > 60 || !TOTALS_LABEL_RX.test(tail.text)) break;
      state.summaries.push({ label: tail.text, amount: null, pageNum });
      a.lines.pop();
    }
    const texts = joinParts(a.lines);
    const values = a.cells.map((v, i) => (isText[i] ? texts[i] : v));
    const desc = descIdx >= 0 ? values[descIdx] : '';
    const label = desc || values.find(Boolean) || '';
    const hasText = texts.some(Boolean);

    // Price-only values in the next band of the same cell complete the previous item
    const prevItem = state.items[state.items.length - 1];
    if (!isPrimary(a) && prevItem && prevItem.pageNum === pageNum && !SUMMARY_RX.test(label)
      && a.y0 - prevItem.yEnd <= pitch * 4 && !a.cells.some((v, i) => v && !isText[i] && prevItem.values[M(i)])) {
      values.forEach((v, i) => { if (!v) return; prevItem.values[M(i)] = isText[i] ? `${prevItem.values[M(i)] || ''} ${v}`.trim() : v; });
      prevItem.yEnd = Math.max(prevItem.yEnd, a.y1, ...(a.lines.map(l => l.y1)));
      continue;
    }

    // A line carrying only an amount, in a table that has quantity / rate columns, is a total
    const hasQtyOrRate = [qtyIdx, rateIdx].some(i => i >= 0 && parseAmount(values[i]) !== null);
    const amountOnly = (qtyIdx >= 0 || rateIdx >= 0) && !hasQtyOrRate && amountIdx >= 0 && parseAmount(values[amountIdx]) !== null
      && !(unitIdx >= 0 && values[unitIdx]) && !(snIdx >= 0 && values[snIdx]);
    // "Total thickness 5mm ... 69.59 sqm" is an item: a measured quantity with its unit or
    // serial outranks a description that merely starts like a total
    const measuredItem = qtyIdx >= 0 && parseAmount(values[qtyIdx]) !== null
      && ((unitIdx >= 0 && values[unitIdx]) || (snIdx >= 0 && SERIAL_CELL_RX.test(String(values[snIdx] || '').trim())));
    if (amountOnly || (!measuredItem && (SUMMARY_RX.test(label) || (snIdx >= 0 && SUMMARY_RX.test(values[snIdx] || ''))))) {
      const amount = [amountIdx, rateIdx, qtyIdx].map(i => (i >= 0 ? parseAmount(values[i]) : null)).find(v => v !== null);
      state.summaries.push({ label, amount: amount ?? null, pageNum });
      continue;
    }
    if (FOOTER_RX.test(label) && a.cy >= lastMarkY) { state.ended = true; break; }
    if (!hasText && !(snIdx >= 0 && values[snIdx])) continue;

    state.items.push({ values: toMaster(values), pageNum, section: state.section, headings: state.pendingHeadings, yEnd: Math.max(a.y1, ...(a.lines.map(l => l.y1))) });
    state.pendingHeadings = [];
  }
}

/** Fold price-only anchors into the item anchor of the same cell (values at different heights). */
function mergePartialAnchors(inside, anchors, isPrimary) {
  const primaries = inside.filter(isPrimary);
  if (!primaries.length || primaries.length === inside.length) return;
  for (const part of inside.filter(a => !isPrimary(a))) {
    const host = primaries.reduce((best, p) => (Math.abs(p.cy - part.cy) < Math.abs(best.cy - part.cy) ? p : best), primaries[0]);
    const clash = part.cells.some((v, i) => v && host.cells[i]);
    if (clash) continue;
    part.cells.forEach((v, i) => { if (v) host.cells[i] = v; });
    host.y0 = Math.min(host.y0, part.y0); host.y1 = Math.max(host.y1, part.y1);
    inside.splice(inside.indexOf(part), 1);
    anchors.splice(anchors.indexOf(part), 1);
  }
}

/**
 * @param {Array<{pageNum:number, segs:Array}>} pages
 * @returns table candidate or null
 */
export function parseGeometricTable(pages, opts = {}) {
  let cols = null;      // master columns: the document's header
  let geo = null;       // columns (geometry) of the table currently being read
  let map = null;       // geo index -> master index
  const state = { items: [], summaries: [], section: '', pendingHeadings: [], ended: false, sawSummary: false, width: 0 };
  const norm = (t) => String(t || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9\u0600-\u06ff]+/g, '');
  /** Line a later table's columns up with the master's (same role / same label); new ones are appended. */
  const mapToMaster = (pageCols) => {
    const used = new Set();
    return pageCols.map(pc => {
      let hit = cols.findIndex((mc, i) => !used.has(i) && mc.role === pc.role && norm(mc.label) === norm(pc.label));
      if (hit < 0 && pc.role) hit = cols.findIndex((mc, i) => !used.has(i) && mc.role === pc.role);
      if (hit < 0) {
        const a = norm(pc.label);
        hit = cols.findIndex((mc, i) => { const b = norm(mc.label); return !used.has(i) && a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)) && (!mc.role || !pc.role); });
        if (hit >= 0 && !cols[hit].role && pc.role) { cols[hit].role = pc.role; cols[hit].label = pc.label; }
      }
      if (hit < 0) { cols.push({ ...pc }); hit = cols.length - 1; }
      used.add(hit);
      return hit;
    });
  };

  // Letterheads / running titles: the same words at the same height on most pages
  const seen = new Map();
  const furnitureKey = (s) => `${s.text.toLowerCase()}|${Math.round(s.cy / 4)}`;
  for (const page of pages) {
    const keys = new Set(page.segs.filter(s => s.text.length >= 12 && /[^\d\W]/.test(s.text)).map(furnitureKey));
    for (const k of keys) seen.set(k, (seen.get(k) || 0) + 1);
  }
  const furnitureMin = Math.max(3, Math.ceil(pages.length * 0.6));
  const isFurniture = (s) => (seen.get(furnitureKey(s)) || 0) >= furnitureMin;

  for (const page of pages) {
    if (!page.segs.length) continue;
    const rows = visualRows(page.segs);
    const header = findHeader(rows);
    let bodySegs;
    if (header) {
      const bodyStartY = header.row.y1;
      bodySegs = page.segs.filter(s => s.cy > bodyStartY);
      header.row.segs = splitCompoundHeaderCells(header.row.segs, bodySegs);
      const pageCols = buildColumns(header.row, bodySegs);
      inferDescriptionColumn(pageCols, bodySegs);
      if (!cols) { cols = pageCols.map(c => ({ ...c })); geo = pageCols; map = pageCols.map((c, i) => i); }
      else if (pageCols.length === cols.length && pageCols.every((c, i) => c.role === cols[i].role)) { geo = pageCols; map = pageCols.map((c, i) => i); }
      else if (pageCols.some(c => c.role === 'desc') && pageCols.filter(c => MEASURE_ROLES.has(c.role)).length >= 2) {
        // A further table with its own layout (another bill, an annex): read it with its own
        // geometry and file its values under the matching master columns.
        geo = pageCols; map = mapToMaster(pageCols);
      }
      state.ended = false;
    } else {
      if (!cols || state.ended) continue;
      bodySegs = page.segs;
    }
    state.width = cols.length;
    // Drop page furniture outside the table's horizontal band
    const tx0 = geo[0].x0 - 4, tx1 = geo[geo.length - 1].x1 + 4;
    bodySegs = bodySegs.filter(s => s.x1 > tx0 && s.x0 < tx1 && !/^(page\s*\d+(\s*(of|\/)\s*\d+)?|[-–—]\s*\d+\s*[-–—])$/i.test(s.text.trim()));
    {
      // ... dropped only outside the item rows of the page (above the first / below the last figure)
      const figureYs = bodySegs.filter(s => { const ci = columnIndexOf(s, geo); return ci >= 0 && MEASURE_ROLES.has(geo[ci].role) && parseAmount(s.text) !== null; }).map(s => s.cy);
      if (figureYs.length) {
        const top = Math.min(...figureYs) - 2, bottom = Math.max(...figureYs) + 2;
        bodySegs = bodySegs.filter(s => !((s.cy < top || s.cy > bottom) && isFurniture(s)));
      }
    }
    if (opts.debug) console.log('page', page.pageNum, 'header', Boolean(header), 'cols', geo.map(c => `${c.role || '?'}:${c.label}[${c.x0.toFixed(0)}-${c.x1.toFixed(0)}]`).join(' '), 'body', bodySegs.length, 'items', state.items.length, 'ended', state.ended);
    parsePageBody(bodySegs, geo, page.pageNum, state, page.rules || [], map);
  }
  if (cols) for (const it of state.items) while (it.values.length < cols.length) it.values.push('');

  if (!cols || !state.items.length) return null;
  if (state.items.length < 2) {
    // A one-line schedule is still a schedule, but only when it is unmistakably one
    const q = cols.findIndex(c => c.role === 'qty'), d = cols.findIndex(c => c.role === 'desc');
    const only = state.items[0].values;
    if (q < 0 || d < 0 || parseAmount(only[q]) === null || String(only[d] || '').length < 10) return null;
  }

  const idxOf = role => cols.findIndex(c => c.role === role);
  const qtyIdx = idxOf('qty'), rateIdx = idxOf('rate'), amountIdx = idxOf('amount'), descIdx = idxOf('desc');
  const header = cols.map(c => CANONICAL_LABEL[c.role] || c.label);

  // Serial numbers printed flush against the description ("1.1 Excavate ...") come out as one
  // text run: peel them back into the serial column when that column is mostly empty.
  const snCol = idxOf('sn');
  if (snCol >= 0 && descIdx >= 0) {
    const SERIAL_RX = /^((?:\d+|[A-Za-z])(?:[.\-]\d+){0,4}[.)]?)\s+(?=\S)/;
    const emptySn = state.items.filter(it => !it.values[snCol]);
    const peelable = emptySn.filter(it => SERIAL_RX.test(it.values[descIdx] || ''));
    if (emptySn.length >= state.items.length * 0.4 && peelable.length >= emptySn.length * 0.7) {
      for (const it of peelable) {
        const m = it.values[descIdx].match(SERIAL_RX);
        it.values[snCol] = m[1];
        it.values[descIdx] = it.values[descIdx].slice(m[0].length);
      }
    }
  }

  // Units printed so close to the description that they read as its last word
  const unitCol = idxOf('unit');
  if (unitCol >= 0 && descIdx >= 0) {
    const UNIT_TAIL_RX = /\s(nos?\.?|no\.?s|pcs?\.?|ea(?:ch)?\.?|sets?|items?|l\.?s\.?|lump\s?sum|sum|p(?:rov)?\.?\s?sum|m|m2|m3|m²|m³|sqm|sq\.?\s?m|cum|cu\.?\s?m|lm|rm|rmt|r\.?ft|sft|sq\.?\s?ft|kg|tonnes?|ton|ltr?s?|lot|pairs?|rolls?|bags?|days?|months?|hrs?|weeks?|job|unit)$/i;
    const withUnit = state.items.filter(it => it.values[unitCol]).length;
    if (withUnit >= state.items.length * 0.5) {
      for (const it of state.items) {
        if (it.values[unitCol] || qtyIdx < 0 || parseAmount(it.values[qtyIdx]) === null) continue;
        const m = String(it.values[descIdx] || '').match(UNIT_TAIL_RX);
        if (m) { it.values[unitCol] = m[1]; it.values[descIdx] = it.values[descIdx].slice(0, m.index).trim(); }
      }
    }
  }

  // The reverse: a serial and its text read as one run that landed in the serial column
  if (snCol >= 0 && descIdx >= 0) {
    for (const it of state.items) {
      if (it.values[descIdx]) continue;
      const m = String(it.values[snCol] || '').match(/^((?:\d+|[A-Za-z])(?:[.\-]\d+){0,4}[.)]?)\s+(\S.{2,})$/);
      if (m) { it.values[snCol] = m[1]; it.values[descIdx] = m[2]; }
    }
  }

  // Lone short lines between items are either SECTION headings (a few, each covering several
  // items) or ITEM TITLES (one above nearly every item). Titles are part of the description;
  // either way no text is dropped.
  const withHeading = state.items.filter(it => it.headings.length > 0).length;
  const titleMode = descIdx >= 0 && state.items.length >= 3 && withHeading >= state.items.length * 0.8;
  if (titleMode) {
    for (const it of state.items) {
      if (it.headings.length) it.values[descIdx] = `${it.headings.join(' ')} ${it.values[descIdx] || ''}`.trim();
      it.section = '';
    }
  }

  let arithmeticChecked = 0, arithmeticOk = 0, lineSum = 0;
  const rows = state.items.map((it, i) => {
    const warnings = [];
    const q = qtyIdx >= 0 ? parseAmount(it.values[qtyIdx]) : null;
    const r = rateIdx >= 0 ? parseAmount(it.values[rateIdx]) : null;
    const a = amountIdx >= 0 ? parseAmount(it.values[amountIdx]) : null;
    if (a !== null) lineSum += a;
    if (q !== null && r !== null && a !== null) {
      arithmeticChecked++;
      if (Math.abs(q * r - a) <= Math.max(0.02, Math.abs(a) * 0.001)) arithmeticOk++;
      else warnings.push({ code: 'ARITHMETIC_MISMATCH', message: `${q} x ${r} != ${a}` });
    }
    return {
      id: `geo-${i + 1}`,
      pageNum: it.pageNum,
      sectionLabel: it.section || '',
      isHeader: false,
      isSummary: false,
      cells: it.values.map(v => ({ value: String(v || '').trim(), image: null, images: [], source: 'extracted', confidence: 0.96 })),
      warnings
    };
  });

  const arithmeticPass = arithmeticChecked ? arithmeticOk / arithmeticChecked : 1;
  // A complete row names the item and measures it; empty price cells (unpriced tender
  // schedules) or an unnumbered serial column are not missing data.
  const unitIdx = idxOf('unit');
  const completeness = state.items.filter(it => {
    const v = it.values;
    const named = v.some((x, i) => x && String(x).length >= 3 && !MEASURE_ROLES.has(cols[i].role) && cols[i].role !== 'sn');
    const measured = [qtyIdx, amountIdx, rateIdx].some(i => i >= 0 && parseAmount(v[i]) !== null) || (unitIdx >= 0 && v[unitIdx]);
    return named && measured;
  }).length / rows.length;
  const declared = lineSum <= 0 ? null : state.summaries.find(s => s.amount !== null && Math.abs(s.amount - lineSum) <= Math.max(0.02, Math.abs(lineSum) * 0.0001));
  const reconciled = Boolean(declared);
  let confidence = 0.86;
  // Self-verified only when qty x rate = amount could be checked on (nearly) every row
  if (arithmeticChecked >= Math.max(2, rows.length * 0.8) && arithmeticPass >= 0.95) confidence = 0.955;
  if (reconciled && arithmeticChecked >= rows.length * 0.5 && arithmeticPass >= 0.9) confidence = 0.985;
  // Unpriced schedules (quantities only) cannot be checked by arithmetic: verify their structure
  const priced = rows.filter((r, i) => amountIdx >= 0 && parseAmount(state.items[i].values[amountIdx]) !== null).length;
  const structured = rows.filter((r, i) => {
    const v = state.items[i].values;
    const named = v.some((x, k) => x && String(x).length >= 3 && !MEASURE_ROLES.has(cols[k].role) && cols[k].role !== 'sn');
    return named && qtyIdx >= 0 && (parseAmount(v[qtyIdx]) !== null || (unitIdx >= 0 && v[unitIdx] && cols[snCol >= 0 ? snCol : 0] && v[snCol >= 0 ? snCol : 0]));
  }).length;
  const unpricedSchedule = priced <= rows.length * 0.1 && rows.length >= 3 && structured >= rows.length * 0.9;
  if (unpricedSchedule) confidence = Math.max(confidence, 0.95);
  confidence = Math.min(confidence, 0.6 + 0.4 * completeness);

  return {
    sheetName: 'Bill of Quantities',
    header,
    rows,
    columnCount: header.length,
    engineUsed: GEOMETRIC_PARSER_VERSION,
    confidence,
    quality: { rowCount: rows.length, arithmeticPass, arithmeticChecked, completeness, reconciled, unpricedSchedule },
    columnRoles: cols.map(c => c.role || 'other'),
    originalHeaders: cols.map(c => c.label),
    documentSummary: state.summaries,
    reconciliation: {
      extractedLineTotal: lineSum.toFixed(2),
      sourceDeclaredTotal: declared ? String(declared.amount) : '',
      difference: declared ? (declared.amount - lineSum).toFixed(2) : '',
      status: declared ? 'PASS' : (state.summaries.length ? 'REVIEW' : 'NOT_AVAILABLE')
    },
    supportsMultiImages: true,
    tableKind: 'GEOMETRIC_BOQ'
  };
}

export async function extractGeometricTable(pdfPath) {
  const pages = await loadPdfSegments(pdfPath);
  return parseGeometricTable(pages);
}
