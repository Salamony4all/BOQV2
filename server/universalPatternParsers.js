import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);
import { renderPDFWithLayout } from './utils/pdfRenderer.js';
import { uploadToSupabase, supabase } from './utils/supabaseStorage.js';
export const EXTRACTOR_VERSION = 'wordpdf-universal-v16.0';
const PAGE_BREAK = '\f';

export function normalizeInlineText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[\uFFFD]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function normalizeStructuredText(value = '') {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .split(PAGE_BREAK)
    .map(page => page.split('\n').map(normalizeInlineText).join('\n').replace(/\n{3,}/g, '\n\n').trim())
    .join(`\n${PAGE_BREAK}\n`)
    .trim();
}

function cell(value = '', source = 'extracted', extra = {}) {
  return { value: normalizeInlineText(value), image: null, images: [], source, confidence: source === 'extracted' ? 0.98 : 0.8, ...extra };
}
function safeNumber(v) {
  const s = String(v ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return s ? Number(s[0]) : null;
}
function money(v) { const n = safeNumber(v); return n === null ? '' : n.toFixed(3).replace(/\.000$/, '.000'); }
function pageOfIndex(text, index) { return text.slice(0, index).split(PAGE_BREAK).length; }
function warning(code, message, extra = {}) { return { code, message, ...extra }; }

async function emit(callback, value) {
  try { await callback?.(value); } catch (error) { console.warn(`[${EXTRACTOR_VERSION}] progress callback failed: ${error.message}`); }
}

async function pdfToText(pdfPath, workDir) {
  const output = path.join(workDir, 'document.txt');
  await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, output], { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
  return normalizeStructuredText(await fs.readFile(output, 'utf8'));
}

// v16 Parsers
export function joinSplitBillNumbers(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];
    const billMatch = line.match(/^([ \t]*Bill\s+No\.?)(?![ \t]*\d)/i);
    if (billMatch) {
      const numMatch = nextLine.match(/^([ \t]*)(0*\d+\.\d+)\b/);
      if (numMatch) {
        const numberStr = numMatch[2];
        lines[i] = line.replace(/^([ \t]*Bill\s+No\.?)/i, `$1 ${numberStr}`);
        lines[i + 1] = nextLine.replace(/^([ \t]*)(0*\d+\.\d+)\b/, `$1${' '.repeat(numberStr.length)}`);
      }
    }
  }
  return lines.join('\n');
}

function parseBillNo(rawText) {
  const text = joinSplitBillNumbers(rawText);
  if (!/Bill\s+No\.?\s*\d+\.\d+/i.test(text)) return null;
  const starts = [...text.matchAll(/Bill\s+No\.?\s*(\d+\.\d+)\b/gi)];
  const rows = [];
  const uomQtyRx = /\b(LS|job|m3|m2|m²|M\.L\.?|ML|No\.?|Nos|PCS|Set|Lot|Each|Item|m)\s+([\d,.]+)\b/i;
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    const segment = normalizeInlineText(text.slice(m.index + m[0].length, end));
    const uq = segment.match(uomQtyRx);
    if (!uq) continue;
    const after = segment.slice((uq.index || 0) + uq[0].length);
    const nums = [...after.matchAll(/\b[\d,]+(?:\.\d+)?\b/g)].map(x => x[0]);
    if (nums.length < 2) continue;
    const rateText = nums[0], amountText = nums[1];
    const before = normalizeInlineText(segment.slice(0, uq.index));
    const info = before.match(/\b(Item\s+Code|As per specifications|To the approval of the Engineer|Brushed brass finish)\s+([A-Z0-9-]+)?\s*$/i);
    const additional = info ? normalizeInlineText(info[0]) : '';
    const details = info ? normalizeInlineText(before.slice(0, info.index)) : before;
    const qty = safeNumber(uq[2]); const rate = safeNumber(rateText); const amount = safeNumber(amountText);
    if (!details || qty === null || rate === null || amount === null) continue;
    rows.push({ id: `bill-${m[1]}`, pageNum: pageOfIndex(text, m.index), sectionLabel: '', cells: [cell(`Bill No. ${m[1]}`), cell(''), cell(details), cell(additional), cell(uq[1]), cell(uq[2]), cell(rateText), cell(amountText)], provenance: { parser: 'bill-no', sourceRange: [m.index, end] }, warnings: Math.abs(qty * rate - amount) > Math.max(0.01, amount * 0.001) ? [warning('ARITHMETIC_MISMATCH', `${qty} x ${rate} != ${amount}`)] : [] });
  }
  return candidate('Bill No BOQ', ['Item Code','Item Name','Item Details','Additional Information','UOM','Quantity','Rate','Amount'], rows, 'bill-no', 0.99);
}

function parseSerialFinancial(text) {
  if (!/Sl\.?No\s+(Image Reference|Img\s*\.?\s*Ref|Image\s+Referenc)\s+(Item Description|Discription|Description)\s+(QTY|Qty)/i.test(text)) return null;
  const rows = [];
  const lineRx = /^[ \t]*(\d{1,4})[ \t]+(?:(.*?)[ \t]+)?(\d+(?:\.\d+)?)[ \t]+(Nos\.?|No\.?|PCS|Set|Lot|Each|M2|SQM|LM|Sqm\.?|m2|m²|Sq\.?Ft\.?|SqFt)[ \t]+([\d,]+(?:\.\d+)?)[ \t]+([\d,]+(?:\.\d+)?)[ \t]*$/gmi;
  const matches = [...text.matchAll(lineRx)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const prevEnd = i ? matches[i - 1].index + matches[i - 1][0].length : Math.max(0, m.index - 2000);
    let context = normalizeInlineText(text.slice(prevEnd, m.index));
    const originMatches = [...context.matchAll(/\b(LOCAL[-\s]*UAE|FAR\s+EAST)\b/gi)];
    const originMatch = originMatches.at(-1);
    const origin = originMatch ? originMatch[1].replace(/\s+/g, ' ').toUpperCase() : '';
    let desc = originMatch ? normalizeInlineText(context.slice(originMatch.index + originMatch[0].length)) : context;
    desc = normalizeInlineText([desc, m[2]].filter(Boolean).join(' '));
    desc = desc.replace(/Date:.*?Total \(AED\)/i, '').replace(/Page \d+ of \d+.*$/i, '').trim();
    if (!desc) continue;
    const qty = safeNumber(m[3]); const rate = safeNumber(m[5]); const amount = safeNumber(m[6]);
    rows.push({ id: `serial-${m[1]}`, pageNum: pageOfIndex(text, m.index), sectionLabel: '', cells: [cell(m[1]), cell(origin), cell(desc), cell(m[3]), cell(m[4]), cell(m[5]), cell(m[6])], provenance: { parser: 'serial-financial' }, warnings: Math.abs(qty * rate - amount) > 0.02 ? [warning('ARITHMETIC_MISMATCH', `${qty} x ${rate} != ${amount}`)] : [] });
  }
  return candidate('Serial Financial BOQ', ['SL.No','Image Reference','Item Description','QTY','Unit','Unit Price','Total'], rows, 'serial-financial', 0.98);
}

function parseSedus(text) {
  if (!/Sedus/i.test(text) || !/Position Net/i.test(text)) return null;
  const rows = [];
  const rx = /(?:^|\n)\s*(\d+(?:\.\d+){2,})\s+([A-Za-z0-9-]+)\s+([\s\S]*?)(\d[\d,]*)\s+[\s\S]*?Position Net\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const qty = safeNumber(m[4]); const rate = safeNumber(m[5]); const amount = safeNumber(m[6]);
    let desc = normalizeInlineText(m[3]).replace(/Article code \/ description Quantity SP\/EUR.*$/i, '').slice(0, 1200);
    if (!desc || qty === null || rate === null || amount === null || qty > 100000) continue;
    const alternative = /Alternative position Not included in total amount/i.test(m[0]);
    rows.push({ id: `sedus-${m[1]}-${m[2]}`, pageNum: pageOfIndex(text, m.index), sectionLabel: '', cells: [cell(m[1]), cell(m[2]), cell(desc), cell(m[4]), cell(m[5]), cell(m[6])], alternative, provenance: { parser: 'sedus-position' }, warnings: Math.abs(qty * rate - amount) > Math.max(0.02, amount * 0.001) ? [warning('ARITHMETIC_MISMATCH', `${qty} x ${rate} != ${amount}`)] : [] });
  }
  return candidate('Sedus Position Quote', ['Hierarchy','Article Code','Description','Quantity','SP/EUR','TP/EUR'], rows, 'sedus-position', 0.96);
}

const CANONICAL_HEADER = ['S.No', 'Image', 'Product Code', 'Item Description', 'Unit', 'Quantity', 'Unit Rate', 'Total'];

function cleanDescription(value) {
  return normalizeInlineText(value)
    .replace(/Article code \/ description\s+Quantity\s+SP\/EUR\s*\(excl\. VAT\)\s+TP\/EUR\s*\(excl\. VAT\)/gi, ' ')
    .replace(/Page\s+\d+\s+of\s+\d+/gi, ' ')
    .replace(/Position Net\s+[\d,.]+\s+[\d,.]+/gi, ' ')
    .replace(/Intermediate total:[\s\S]*$/i, ' ')
    .replace(/Alternative position Not included in total amount/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseOfmlProductSummary(text) {
  if (!/Sedus/i.test(text) || !/Intermediate total:\s*FU-/i.test(text)) return null;
  const familyRx = /^[ \t]*(\d+(?:\.\d+){2})[ \t]*(?:\n[ \t]*)?(FU-[A-Z0-9_#]+-[A-Z0-9_#/-]+)[ \t]+([^\n]+)/gmi;
  const starts = [...text.matchAll(familyRx)];
  const rows = [];
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i]; const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    const block = text.slice(m.index, end);
    const hierarchy = m[1], productCode = m[2], familyTitle = normalizeInlineText(m[3]);
    const childRx = new RegExp(`^[ \\t]*${hierarchy.replace(/\./g,'\\.')}\\.(\\d+)[ \\t]*([\\d,]+)?[ \\t]*\\n[ \\t]*([A-Za-z0-9-]+)[ \\t]*\\n([\\s\\S]*?)(?=^[ \\t]*Series:|^[ \\t]*Position Net)`, 'mi');
    const child = block.match(childRx);
    const qty = child?.[2] ? child[2].replace(/,/g, '') : '';
    const articleCode = child?.[3] || '';
    let technical = cleanDescription(child?.[4] || '');
    technical = technical.replace(/SP\/EUR\s+TP\/EUR\s+Article code \/ description\s+Quantity\s+\(excl\. VAT\)\s+\(excl\. VAT\)/gi, ' ').trim();
    const positions = [...block.matchAll(/Position Net[ \t]+([\d,]+\.\d{2})[ \t]+([\d,]+\.\d{2})/g)];
    let commercial = positions[0];
    for (const pos of positions) {
      const preceding = block.slice(Math.max(0, pos.index - 350), pos.index);
      if (!/Alternative position Not included in total amount/i.test(preceding)) { commercial = pos; break; }
    }
    const totalRx = new RegExp(`Intermediate total:[ \\t]*${productCode.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')}[^\\n]*?([\\d,]+\\.\\d{2})`, 'i');
    const total = block.match(totalRx)?.[1] || commercial?.[2] || '';
    const rate = commercial?.[1] || '';
    const desc = [familyTitle, technical, articleCode ? `Manufacturer Article: ${articleCode}` : ''].filter(Boolean).join('\n\n');
    rows.push({ id: `ofml-${productCode}`, pageNum: pageOfIndex(text, m.index), sectionLabel: '', isHeader: false, isSummary: false,
      cells: [cell(String(rows.length + 1)), cell(''), cell(productCode), cell(desc), cell(''), cell(qty), cell(rate), cell(total)],
      metadata: { serialAnchor: productCode, hierarchy, articleCode, alternative: false, sourceRange: [m.index, end] },
      provenance: { parser: 'ofml-product-summary', anchor: productCode }, warnings: [] });
  }
  return candidate('Product Schedule', CANONICAL_HEADER, rows, 'ofml-product-summary', 0.985);
}

function parseGenericFinancialSchedule(text) {
  if (!/(S\.?No|SL\.?No).{0,120}(DESCRIPTION|Description).{0,100}(UNIT|Unit).{0,50}(QTY|Qty).{0,80}(RATE|Rate).{0,80}(AMOUNT|Amount)/i.test(normalizeInlineText(text))) return null;
  const rx = /^[ \t]*(\d{1,4})[ \t]+(.*?)[ \t]*(SET|EA|No(?:’s|'s|s|\.)?|PCS|Pcs|Lot|Each|Item|M2|m2|SQM|LM|ML|job|LS)[ \t]+([\d,.]+)[ \t]+([\d,.]+)[ \t]+([\d,.]+)[ \t]*$/gmi;
  const matches = [...text.matchAll(rx)].filter(m => Number(m[1]) > 0 && Number(m[1]) < 10000);
  const rows = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const prior = i ? matches[i - 1].index + matches[i - 1][0].length : Math.max(0, m.index - 3000);
    let context = text.slice(prior, m.index);
    const pageHeader = context.lastIndexOf('S.No'); if (pageHeader >= 0) context = context.slice(pageHeader + 4);
    let desc = normalizeInlineText([context, m[2]].filter(Boolean).join(' '));
    desc = desc.replace(/^(REF\.IMAGE|DESCRIPTION|UNIT|QTY|RATE|AMOUNT \([^)]+\))+/i, '').replace(/^(CUSTOM|FAREAST|FAR EAST|LOCAL[- ]UAE)\s+/i, '').trim();
    if (desc.length < 3) desc = `Item ${m[1]}`;
    const qty = safeNumber(m[4]), rate = safeNumber(m[5]), amount = safeNumber(m[6]);
    rows.push({ id: `generic-${m[1]}`, pageNum: pageOfIndex(text, m.index), sectionLabel: '', cells: [cell(m[1]), cell(''), cell(desc), cell(m[3]), cell(m[4]), cell(m[5]), cell(m[6])], provenance: { parser: 'generic-financial' }, warnings: Math.abs(qty * rate - amount) > Math.max(.02, amount * 0.001) ? [warning('ARITHMETIC_MISMATCH', `${qty} x ${rate} != ${amount}`)] : [] });
  }
  return candidate('Universal Product Schedule', ['S.No','Image','Description','Unit','QTY','Rate','Amount'], rows, 'generic-financial', 0.96);
}

function parseHierarchicalBoq(text) {
  if (!/(Item\s*No|Item\s+Description).{0,150}(Description|Unit).{0,100}(Unit|Qty)/i.test(normalizeInlineText(text))) return null;
  const lines = text.split('\n'); const rows = [];
  const lineRx = /^[ \t]*(\d{1,3}(?:\.\d{1,3})+)[ \t]+(?:(.*?)[ \t]+)?(job|m3|M3|M\.L\.?|ML|No\.?|NO|Nos|PCS|Set|Lot|Each|Item|m2|m²|SQM|LM)[ \t]+([\d,.]+)(?:[ \t]+([\d,.]+))?(?:[ \t]+([\d,.]+))?[ \t]*$/i;
  let page = 1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(PAGE_BREAK)) page++;
    const m = lines[i].match(lineRx); if (!m) continue;
    let desc = normalizeInlineText(m[2]);
    if (desc.length < 3) {
      const follow = [];
      for (let j=i+1; j<Math.min(lines.length,i+5); j++) {
        if (/^[ \t]*\d{1,3}(?:\.\d{1,3})+\b/.test(lines[j])) break;
        if (normalizeInlineText(lines[j])) follow.push(lines[j]);
      }
      desc = normalizeInlineText(follow.join(' '));
    }
    if (desc.length < 3) desc = `BOQ item ${m[1]}`;
    rows.push({ id: `hier-${m[1]}`, pageNum: page, sectionLabel: m[1].split('.')[0], cells: [cell(m[1]), cell(''), cell(desc), cell(m[3]), cell(m[4]), cell(m[5] || ''), cell(m[6] || '')], provenance: { parser: 'hierarchical-boq' }, warnings: [] });
  }
  return candidate('Hierarchical BOQ', ['Item No','Image','Description','Unit','Qty','Unit Cost','Total Cost'], rows, 'hierarchical-boq', 0.97);
}

// v17 Parsers
const cleanV17 = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/[\uFFFD]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
const cV17 = (value = '', images = []) => ({ value: cleanV17(value), images: Array.isArray(images) ? images : [], image: images?.[0] || null, isMerged: false });
const rowV17 = (v, pageNum = 1, metadata = {}) => ({ cells: v.map(x => cV17(x)), isHeader: false, isSummary: false, pageNum, sectionLabel: '', metadata });
function cleanDescV17(s) { return cleanV17(s).replace(/^(?:DESCRIPTION|Item Description|IMAGE REF|FINISH|Unit|Quantity|Unit Rate|Amount R\.O\.)\s*/i, '').replace(/\b(?:teknion Page \d+ of \d+|www\.teknion\.com)\b.*$/i, '').trim(); }

export function parseTeknionV17(raw) {
  const text = cleanV17(raw); if (!/teknion/i.test(text) || !/Unit Net Price/i.test(text)) return null;
  const rx = /(\d{3})\.\s+(FU-[A-Z]{2}-[A-Z0-9]+)\s+Description:\s*(\d[\d,]*)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+(.+?)(?=\s+\d{3}\.\s+FU-|\s+teknion\s+Page|\s+Total\s+Product\s+Net|$)/gi;
  const rows = []; let m; while ((m = rx.exec(text))) rows.push(rowV17([m[1], '', m[2], cleanDescV17(m[6]), '', m[3], m[4], m[5]], Math.max(1, Math.ceil(rows.length / 6)), { serialAnchor: m[1], productAnchor: m[2] }));
  if (rows.length < 10) return null; 
  return candidateV17('Product Schedule', rows, 'universal-v17-teknion', 0.99, { totalProductNet: (text.match(/Total Product Net[^$]*\$([\d,]+\.\d{2})/i) || [])[1] || '' });
}

export function parseStudio184V17(raw) {
  const text = cleanV17(raw);
  const hasStudioTitle = /STUDIO\s*-?\s*184\s*KEYS/i.test(text);
  const hasStudioHeader = /SN\s+Location\s+INDICATIVE\s+IMAGE/i.test(text) || (/SN\s+Location/i.test(text) && /TOTAL AMOUNT/i.test(text));
  if (!(hasStudioTitle || hasStudioHeader) || !/UNIT RATE/i.test(text)) return null;
  const starts = [...text.matchAll(/(?:^|\s)(\d{1,3})\s+(TWIN BED|LIVING ROOM|BAR CHAIR|CONSOLE TABLE|ARTWORK|CURTAIN)\s+/gi)]; const rows = [];
  for (let i = 0; i < starts.length; i++) { const m = starts[i], end = i + 1 < starts.length ? starts[i + 1].index : text.length, seg = text.slice(m.index + m[0].length, end); const tail = seg.match(/\b(\d[\d,]*)\s+([\d,]+\.\d{2})\s+(?:QAR\s+)?([\d,]+\.\d{2})(?:\s+QAR)?\b/i); if (!tail) continue; let desc = cleanDescV17(seg.slice(0, tail.index)); if (!desc) continue; rows.push(rowV17([m[1], '', '', `${cleanV17(m[2])}\n\n${desc}`, '', tail[1], tail[2], tail[3]], pageOfIndex(raw, m.index), { serialAnchor: m[1], location: cleanV17(m[2]) })); }
  if (rows.length < 8) return null; 
  return candidateV17('Product Schedule', rows, 'universal-v17-studio184', 0.985, { currency: 'QAR' });
}

export function parseMuscatNestedV17(raw) {
  const text = String(raw || ''); if (!/MUSCAT UNIVERSITY NEW CAMPUS/i.test(text) || !/Unit Rate/i.test(text)) return null;
  const lines = text.split(/\r?\n/); const anchors = [];
  const lineRx = /^\s*([A-Z])\s+(.*?)\s+(Nr|No|item|m|Nos\.?|PCS|Set|Each)\s+(\d[\d,]*|-)\s+([\d,]+\.\d{2,3}|RATE ONLY|EXCLUDED)\s+([\d,]+\.\d{2,3}|RATE ONLY|EXCLUDED)\s*$/i;
  for (let i = 0; i < lines.length; i++) { const m = lines[i].match(lineRx); if (m) anchors.push({ i, m }); }
  const rows = [];
  for (let a = 0; a < anchors.length; a++) {
    const { i, m } = anchors[a], end = a + 1 < anchors.length ? anchors[a + 1].i : lines.length; const block = [m[2], ...lines.slice(i + 1, end)].join(' '); const refs = [...block.matchAll(/Ref\.\s*([A-Z0-9][A-Z0-9.,\/-]*)/gi)]; const ref = refs.at(-1); const code = ref ? cleanV17(ref[1]).replace(/,$/, '') : ''; let desc = cleanDescV17(block); desc = desc.replace(/\b(?:LOCAL UAE|FAREAST|NARBUTAS\s*-?\s*LITHUANIA|B&T\s*-?\s*TURKEY|SEDIA|SOKOA\s*-?\s*FRANCE|FURNWARENEWZELAND)\b/gi, ' ').replace(/\s+/g, ' ').trim(); if (!desc || /^(Page No|BILL|TOTAL|SUB TOTAL)/i.test(desc)) continue; const serial = String(rows.length + 1); rows.push(rowV17([serial, '', code, desc, m[3], m[4], m[5], m[6]], pageOfIndex(raw, lines.slice(0, i).join('\n').length), { serialAnchor: code || serial, sourceItemLabel: m[1] }));
  }
  if (rows.length < 10) return null; 
  return candidateV17('Product Schedule', rows, 'universal-v17-muscat-nested', 0.985, { currency: 'OMR' });
}

function parseCivilBoq(text) {
  if (!/Restoration Work/i.test(text) && !/CIVIL WORK/i.test(text)) return null;
  const rows = [];
  const lineRx = /^[ \t]*(\d+)[ \t]+(?:(.*?)[ \t]+)?([\d,]+(?:\.\d+)?)[ \t]+(Cum|Sqm|Nos?\.?|Rm|Kg|MT|Job|L\.?S\.?|P\.?C\.?|Bag|Rft|RM|Rm)[ \t]+([\d,]+(?:\.\d+)?)[ \t]+([\d,]+(?:\.\d+)?)[ \t]*$/gmi;
  const matches = [...text.matchAll(lineRx)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const prevEnd = i ? matches[i - 1].index + matches[i - 1][0].length : Math.max(0, m.index - 3000);
    let context = text.slice(prevEnd, m.index);
    let desc = normalizeInlineText([context, m[2]].filter(Boolean).join(' '));
    desc = desc.replace(/Sr\s+Item\s+Total\s+Item Description\s+Rate\s+Unit\s+Amount\s+No\.\s+Code\s+Quantity/gi, '').trim();
    const rateText = m[3];
    const qtyText = m[5];
    const amountText = m[6];
    rows.push({
      id: `civil-${m[1]}`,
      pageNum: pageOfIndex(text, m.index),
      sectionLabel: '',
      cells: [cell(m[1]), cell(''), cell(desc), cell(m[4]), cell(qtyText), cell(rateText), cell(amountText)],
      provenance: { parser: 'civil-boq' },
      warnings: []
    });
  }
  return candidate('Civil BOQ', ['S.No', 'Product Code', 'Item Description', 'Unit', 'QTY', 'Rate', 'Amount'], rows, 'civil-boq', 0.98);
}

function parseTenderBoq(text) {
  if (!/Page\s+Item Description/i.test(text) || !/Uom\s+Quantity/i.test(text)) return null;
  const rows = [];
  const lines = text.split('\n');
  const rowValueRx = /[ \t]+(m|m2|m3|m²|No\.?|Nos?|Sum|Each|job|hr|Pcs|Set|Lot|LS|Sum)[ \t]+([\d,.]+)[ \t]+([\d,.]+)(?:[ \t]+([\d,.]+))?[ \t]*$/i;
  
  let currentPos = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(rowValueRx);
    if (m) {
      let itemNumber = '';
      let startIdx = i;
      for (let j = i; j >= Math.max(0, i - 10); j--) {
        const matchStart = lines[j].match(/^([ \t]*\d+(?:[ \t]+\d+)*)[ \t]+[A-Za-z]/);
        if (matchStart) {
          itemNumber = matchStart[1].trim().replace(/[ \t]+/g, '.');
          startIdx = j;
          break;
        }
      }
      
      const descLines = [];
      for (let k = startIdx; k <= i; k++) {
        let lText = lines[k];
        if (k === startIdx) {
          lText = lText.replace(/^([ \t]*\d+(?:[ \t]+\d+)*)/, '');
        }
        if (k === i) {
          lText = lText.slice(0, lText.length - m[0].length);
        }
        descLines.push(lText.trim());
      }
      
      const desc = normalizeInlineText(descLines.filter(Boolean).join(' '));
      if (desc) {
        const unit = m[1];
        const qtyText = m[2];
        const rateText = m[3];
        const amountText = m[4] || '';
        
        rows.push({
          id: `tender-${itemNumber || i}`,
          pageNum: pageOfIndex(text, currentPos),
          sectionLabel: itemNumber ? itemNumber.split('.')[0] : '',
          cells: [cell(itemNumber || String(rows.length + 1)), cell(''), cell(desc), cell(unit), cell(qtyText), cell(rateText), cell(amountText)],
          provenance: { parser: 'tender-boq' },
          warnings: []
        });
      }
    }
    currentPos += line.length + 1;
  }
  return candidate('Tender BOQ', ['Item No', 'Image', 'Description', 'Unit', 'Qty', 'Unit Cost', 'Total Cost'], rows, 'tender-boq', 0.98);
}

function parseAlshayaStyleSchedule(text) {
  const isBoq = /Description/i.test(text) && /(Qty|Quantity)/i.test(text) && /(Unit|UOM)/i.test(text);
  if (!isBoq) return null;

  const rows = [];
  const lines = text.split('\n');
  
  const lineRx = /^[ \t]*([A-Za-z0-9_#.-]+)[ \t]+(?:([A-Z0-9_#-]{3,15})[ \t]+)?(.*?)[ \t]*(?:(?:([\d,.]+)[ \t]+(Nos\.?|No\.?|PCS|Set|Lot|Each|M2|SQM|LM|Sqm\.?|m2|m²|Sq\.?Ft\.?|SqFt|NOS|EA|U|Cum|job|sum|Nos)|(Nos\.?|No\.?|PCS|Set|Lot|Each|M2|SQM|LM|Sqm\.?|m2|m²|Sq\.?Ft\.?|SqFt|NOS|EA|U|Cum|job|sum|Nos)[ \t]+([\d,.]+)))[ \t]*(?:([\d,.]+)[ \t]+([\d,.]+))?[ \t]*$/i;
  
  let pendingItemNo = null;
  let pendingLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const standaloneMatch = line.match(/^[ \t]*([A-Za-z0-9.-]{1,6})[ \t]*$/);
    if (standaloneMatch) {
      const val = standaloneMatch[1];
      if (!/^(SET|PCS|NOS|EA|U|m|m2|m3|LS|sum|job)$/i.test(val)) {
        pendingItemNo = val;
        pendingLineIdx = i;
      }
    }

    const m = line.match(lineRx);
    if (!m) continue;
    
    let itemNo = m[1];
    if (itemNo.length > 6) continue;

    let specCode = m[2] || '';
    let desc = m[3].trim();
    
    const isBullet = /^[-\*•+xo]$/.test(itemNo) || itemNo.toLowerCase() === 'x';
    const recentPending = (pendingItemNo && (i - pendingLineIdx <= 8));
    
    if (isBullet || recentPending) {
      if (pendingItemNo) {
        itemNo = pendingItemNo;
        if (isBullet && m[1] !== itemNo) {
          desc = (m[1] + ' ' + desc).trim();
        }
        pendingItemNo = null;
      } else if (isBullet) {
        itemNo = '';
      }
    }

    if (!specCode) {
      const codeMatch = desc.match(/^([A-Za-z0-9_#-]{2,15})[ \t]{2,}(.*)/);
      if (codeMatch) {
        specCode = codeMatch[1];
        desc = codeMatch[2].trim();
      } else if (desc.match(/^[A-Za-z0-9_#-]{2,15}$/)) {
        specCode = desc;
        desc = '';
      }
    }
    
    const qtyText = m[4] || m[7];
    const unit = m[5] || m[6];
    const rateText = m[8] || '';
    const amountText = m[9] || '';
    
    const qty = safeNumber(qtyText);
    const rate = safeNumber(rateText);
    const amount = safeNumber(amountText);
    
    const descLines = [desc];
    const startLimit = pendingLineIdx !== -1 && i - pendingLineIdx <= 8 ? pendingLineIdx + 1 : i - 6;
    for (let j = i - 1; j >= Math.max(0, startLimit); j--) {
      const prevLine = lines[j].trim();
      if (!prevLine) continue;
      if (prevLine.match(/^[ \t]*([A-Za-z0-9_#.-]+)\b/) || prevLine.match(/Page|BILL|TOTAL|Amount|Rate|Qty|Description/i)) {
        break;
      }
      descLines.unshift(prevLine);
    }
    
    const fullDesc = normalizeInlineText(descLines.filter(Boolean).join(' '));
    const idx = text.indexOf(line);
    
    rows.push({
      id: `alshaya-${itemNo}-${i}`,
      pageNum: pageOfIndex(text, idx >= 0 ? idx : 0),
      sectionLabel: '',
      cells: [
        cell(itemNo),
        cell(specCode),
        cell(fullDesc),
        cell(unit),
        cell(qtyText),
        cell(rateText),
        cell(amountText)
      ],
      provenance: { parser: 'alshaya-schedule' },
      warnings: (qty !== null && rate !== null && amount !== null && amount > 0)
        ? (Math.abs(qty * rate - amount) > Math.max(0.02, amount * 0.001) ? [warning('ARITHMETIC_MISMATCH', `${qty} x ${rate} != ${amount}`)] : [])
        : []
    });
  }

  if (rows.length < 5) return null;

  return candidate(
    'Alshaya Style Schedule',
    ['S.No', 'Product Code', 'Item Description', 'Unit', 'Quantity', 'Unit Rate', 'Total'],
    rows,
    'alshaya-schedule',
    0.98
  );
}

function candidateV17(name, rows, engine, confidence = 0.97, audit = {}) {
  // Convert V17 rows structure to match V16 candidate expectations
  const parsedRows = rows.map(r => ({
    id: r.id || `row-${r.cells[0].value}`,
    pageNum: r.pageNum,
    sectionLabel: r.sectionLabel || '',
    cells: r.cells.map(c => cell(c.value, 'extracted', { images: c.images, image: c.image })),
    metadata: r.metadata || {}
  }));
  return candidate(name, CANONICAL_HEADER, parsedRows, engine.replace('universal-v17-', ''), confidence, audit);
}

// Canonicalization & Stitching utilities
function canonicalizeTable(table) {
  if (!table) return table;
  const h = table.header.map(x => normalizeInlineText(x).toLowerCase());
  const idx = (rx) => h.findIndex(x => rx.test(x));
  const serialIdx = idx(/^(s\.?no|sl\.?no|item no|hierarchy|item code)$/);
  const imageIdx = idx(/image|photo|picture|img|ref|drawing|sketch/);
  const codeIdx = idx(/product code|article code|item code/);
  const descIdx = idx(/description|details|item name|product/);
  const unitIdx = idx(/^unit$|uom/);
  const qtyIdx = idx(/qty|quantity/);
  const rateIdx = idx(/unit rate|unit price|rate|sp\/eur|unit cost/);
  const totalIdx = idx(/amount|total|tp\/eur/);

  const hasImage = imageIdx >= 0;
  const targetHeader = hasImage
    ? ['S.No', 'Image', 'Product Code', 'Item Description', 'Unit', 'Quantity', 'Unit Rate', 'Total']
    : ['S.No', 'Product Code', 'Item Description', 'Unit', 'Quantity', 'Unit Rate', 'Total'];

  if (table.header.join('|') === targetHeader.join('|')) return table;

  const rows = table.rows.map((row, ri) => {
    const get = (i) => i >= 0 ? row.cells[i] : cell('');
    const serial = normalizeInlineText(get(serialIdx).value) || String(ri + 1);
    const code = codeIdx >= 0 ? get(codeIdx) : cell('');
    const description = cell(cleanDescription(get(descIdx).value));

    const cells = hasImage
      ? [cell(serial), get(imageIdx), code, description, get(unitIdx), get(qtyIdx), get(rateIdx), get(totalIdx)]
      : [cell(serial), code, description, get(unitIdx), get(qtyIdx), get(rateIdx), get(totalIdx)];

    if (hasImage) {
      const imgCell = cells[1];
      imgCell.images = imgCell.images || [];
      imgCell.image = imgCell.images[0] || imgCell.image || null;
    }

    return { ...row, id: row.id || `row-${serial}`, sectionLabel: '', isHeader: false, isSummary: false,
      cells,
      metadata: { ...(row.metadata || {}), serialAnchor: row.metadata?.serialAnchor || serial, sourceHeader: table.header }
    };
  });
  return { ...table, sheetName: table.sheetName || 'Product Schedule', header: [...targetHeader], columnCount: targetHeader.length, rows };
}

export function dedupeRows(rows) {
  const seen = new Set(); const output = [];
  for (const row of rows || []) {
    const key = [row.pageNum, row.sectionLabel, ...row.cells.map(c => normalizeInlineText(c.value).toLowerCase())].join('|');
    if (seen.has(key)) continue;
    seen.add(key); output.push(row);
  }
  return output;
}

function buildAudit(table) {
  const warnings = table.rows.flatMap(r => (r.warnings || []).map(w => ({ rowId: r.id, pageNum: r.pageNum, ...w })));
  return { parser: table.engineUsed, rowCount: table.rows.length, confidence: table.confidence, quality: table.quality, warningCount: warnings.length, warnings, repairedCells: table.rows.flatMap(r => r.cells.filter(c => c.source !== 'extracted')) };
}

function candidate(name, header, rows, parser, baseConfidence, extraAudit = {}) {
  if (!rows?.length) return null;
  const arithmeticPass = rows.filter(r => !(r.warnings || []).some(w => w.code === 'ARITHMETIC_MISMATCH')).length / rows.length;
  const completeness = rows.filter(r => r.cells.filter(c => c.value).length >= Math.min(4, header.length)).length / rows.length;
  const confidence = Math.min(0.995, baseConfidence * 0.6 + arithmeticPass * 0.25 + completeness * 0.15);
  return { sheetName: name, header, rows, columnCount: header.length, engineUsed: `${EXTRACTOR_VERSION}-${parser}`, confidence, quality: { rowCount: rows.length, arithmeticPass, completeness }, ...extraAudit };
}

export function selectBestCandidate(candidates) {
  const valid = candidates.filter(Boolean);
  if (!valid.length) return null;
  const maxRows = Math.max(...valid.map(c => c.rows.length));
  return valid.map(c => ({ c, score: c.confidence * 0.55 + c.quality.arithmeticPass * 0.2 + c.quality.completeness * 0.15 + Math.min(1, c.rows.length / maxRows) * 0.1 }))
    .sort((a, b) => b.score - a.score)[0].c;
}

// Image extraction & distribution logic (v16 Poppler utility based)
async function extractAndPairImages(pdfPath, table, sessionId) {
  const publicRoot = path.join(process.cwd(), 'public', 'temp', 'extracted_images', sessionId);
  await fs.mkdir(publicRoot, { recursive: true });

  let layouts = [];
  try {
    const infoResult = await execFileAsync('pdfinfo', [pdfPath], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    const pageCount = Number((infoResult.stdout.match(/^Pages:\s+(\d+)/m) || [])[1] || 0);
    if (pageCount > 80) {
      table.extractionAudit = table.extractionAudit || { warnings: [] };
      table.extractionAudit.warnings.push(warning('IMAGE_PAIRING_DEFERRED', `Image pairing for ${pageCount} pages is deferred to the existing background metadata job.`));
      return;
    }
    
    // Use the native python extractor to get images and text layout!
    layouts = await renderPDFWithLayout(pdfPath);
  } catch (error) {
    table.extractionAudit = table.extractionAudit || { warnings: [] };
    table.extractionAudit.warnings.push(warning('IMAGE_EXTRACTION_UNAVAILABLE', error.message));
    return;
  }

  // 1. Group all extracted images by MD5 hash to compute page frequencies
  const hashToPages = new Map();
  const allImages = []; // List of all images with metadata
  
  for (const layout of layouts) {
    const pageNum = layout.page;
    if (!layout.extractedImages) continue;
    for (const img of layout.extractedImages) {
      try {
        const imgPath = img.path; // Absolute path returned by renderPDFWithLayout
        const data = await fs.readFile(imgPath);
        const hash = crypto.createHash('md5').update(data).digest('hex');
        
        allImages.push({ ...img, pageNum, hash });
        if (!hashToPages.has(hash)) hashToPages.set(hash, new Set());
        hashToPages.get(hash).add(pageNum);
      } catch (e) {
        console.warn(`[WordPdfExtractor] Failed to read image for hashing: ${e.message}`);
      }
    }
  }

  // 2. Identify logos/headers (image hashes present on 3 or more unique pages AND having typical logo geometry or margins)
  const logoHashes = new Set();
  for (const [hash, pagesSet] of hashToPages.entries()) {
    if (pagesSet.size >= 3) {
      const firstImg = allImages.find(x => x.hash === hash);
      if (firstImg) {
        const ar = firstImg.w / firstImg.h;
        const layout = layouts.find(l => l.page === firstImg.pageNum);
        const pageHeight = layout?.viewport?.height || 1000;
        const isMargin = firstImg.y < 100 || firstImg.y > (pageHeight - 100);
        const isLogoAr = ar > 3.2 || ar < 0.3;
        
        if (isLogoAr || isMargin) {
          logoHashes.add(hash);
          console.log(`[WordPdfExtractor] Filtering logo/template image (hash: ${hash}, pages: ${pagesSet.size}, ar: ${ar.toFixed(2)}, y: ${firstImg.y})`);
        }
      }
    }
  }

  // 3. Pair remaining product images using spatial proximity (anchored by S.No or description text)
  const snIdx = table.header.findIndex(h => /s\.?no|sl\.?no|sn|item\s*no|serial/i.test(h));
  const descIdx = table.header.findIndex(h => /desc/i.test(h));
  let imgIdx = table.header.findIndex(h => /image|photo|picture|img|ref|drawing|sketch/i.test(h));

  if (imgIdx === -1) {
    console.log('[WordPdfExtractor] Table has no image column. Skipping image pairing.');
    return;
  }

  const normalizeStr = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

  for (const layout of layouts) {
    const pageNum = layout.page;
    const pageRows = table.rows.filter(r => r.pageNum === pageNum);
    if (!pageRows.length) continue;

    // Filter out logos and tiny graphics
    const pageHeight = layout.viewport?.height || 1000;
    const productImages = allImages
      .filter(img => {
        if (img.pageNum !== pageNum) return false;
        if (logoHashes.has(img.hash)) return false; // Filtered by our logo filter!
        
        const ar = img.w / img.h;
        const isProportional = ar >= 0.2 && ar <= 3.2;
        const isNotMargin = img.y > 100 && img.y < (pageHeight - 100);
        return img.w >= 30 && img.h >= 30 && isProportional && isNotMargin;
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);

    if (!productImages.length) continue;

    console.log(`[WordPdfExtractor] Native pairing page ${pageNum}: ${pageRows.length} rows, ${productImages.length} product images`);

    const textItems = layout.textItems || [];

    // Step 3a: Determine anchorY for each row on this page
    const anchorYList = [];
    for (let i = 0; i < pageRows.length; i++) {
      const row = pageRows[i];
      const targetSN = normalizeStr(row.cells[snIdx]?.value || '');
      
      const snMatch = textItems.find(it => {
        const norm = normalizeStr(it.str);
        const isXOk = it.x !== undefined && it.x < 150;
        return norm === targetSN && norm.length > 0 && isXOk;
      });

      let descMatch = null;
      if (!snMatch && descIdx !== -1) {
        const descWords = (row.cells[descIdx]?.value || '')
          .split(/\s+/)
          .map(w => normalizeStr(w))
          .filter(w => w.length > 3);
          
        if (descWords.length > 0) {
          const firstTargetWord = descWords[0];
          descMatch = textItems.find((it, itIdx) => {
            const normStr = normalizeStr(it.str);
            if (normStr !== firstTargetWord) return false;
            if (descWords.length > 1) {
              const secondTargetWord = descWords[1];
              const limit = Math.min(textItems.length, itIdx + 6);
              for (let nextIdx = itIdx + 1; nextIdx < limit; nextIdx++) {
                if (normalizeStr(textItems[nextIdx].str) === secondTargetWord) {
                  return true;
                }
              }
              return false;
            }
            return true;
          });
        }
      }

      const anchorY = snMatch ? snMatch.y : (descMatch ? descMatch.y : null);
      anchorYList.push(anchorY);
    }

    // Step 3b: Interpolate missing anchorY values
    let firstKnownIdx = anchorYList.findIndex(y => y !== null);
    if (firstKnownIdx === -1) {
      // If no anchors found on this page, distribute evenly
      for (let i = 0; i < pageRows.length; i++) {
        anchorYList[i] = 150 + (i * (pageHeight - 300) / pageRows.length);
      }
    } else {
      // Default initial missing anchors
      for (let i = 0; i < firstKnownIdx; i++) {
        anchorYList[i] = Math.max(100, anchorYList[firstKnownIdx] - (firstKnownIdx - i) * 80);
      }
      
      // Interpolate middle missing anchors
      let lastKnownIdx = firstKnownIdx;
      for (let i = firstKnownIdx + 1; i < pageRows.length; i++) {
        if (anchorYList[i] !== null) {
          const gap = i - lastKnownIdx;
          if (gap > 1) {
            const step = (anchorYList[i] - anchorYList[lastKnownIdx]) / gap;
            for (let k = lastKnownIdx + 1; k < i; k++) {
              anchorYList[k] = anchorYList[lastKnownIdx] + (k - lastKnownIdx) * step;
            }
          }
          lastKnownIdx = i;
        }
      }
      
      // Default trailing missing anchors
      for (let i = lastKnownIdx + 1; i < pageRows.length; i++) {
        anchorYList[i] = Math.min(pageHeight - 100, anchorYList[lastKnownIdx] + (i - lastKnownIdx) * 80);
      }
    }

    // Step 3c: Define regions and assign images
    const rowRegions = [];
    for (let i = 0; i < pageRows.length; i++) {
      const startY = i === 0 ? 100 : (anchorYList[i - 1] + anchorYList[i]) / 2;
      const endY = i === pageRows.length - 1 ? pageHeight - 100 : (anchorYList[i] + anchorYList[i + 1]) / 2;
      rowRegions.push({ startY, endY, images: [] });
    }

    for (const img of productImages) {
      const centerY = img.y + img.h / 2;
      let matchedIdx = -1;
      for (let r = 0; r < rowRegions.length; r++) {
        if (centerY >= rowRegions[r].startY && centerY < rowRegions[r].endY) {
          matchedIdx = r;
          break;
        }
      }
      if (matchedIdx !== -1) {
        rowRegions[matchedIdx].images.push(img);
      }
    }

    // Step 3d: Copy and pair the matched images to each row
    for (let i = 0; i < pageRows.length; i++) {
      const row = pageRows[i];
      const regionImages = rowRegions[i].images;

      if (regionImages.length > 0) {
        regionImages.sort((a, b) => a.x - b.x);

        const rowImages = [];
        for (let j = 0; j < regionImages.length; j++) {
          const img = regionImages[j];
          const filename = `page_${pageNum}_row_${i}_img_${j}_${crypto.randomUUID().slice(0, 8)}.png`;
          const destPath = path.join(publicRoot, filename);
          let imageUrl = `/temp/extracted_images/${sessionId}/${filename}`;

          try {
            await fs.copyFile(img.path, destPath);

            // Cloud Storage Strategy (Supabase - matching fastExtractor.js)
            if (supabase) {
              try {
                const imgData = await fs.readFile(img.path);
                const supabasePath = `extracted-images/${sessionId}/${filename}`;
                const uploadResult = await uploadToSupabase('assets', supabasePath, imgData, {
                  contentType: 'image/png',
                  cacheControl: '3600'
                });
                if (uploadResult?.url) {
                  imageUrl = uploadResult.url;
                  console.log(`[WordPdfExtractor] Supabase upload success: ${imageUrl}`);
                }
              } catch (supErr) {
                console.warn(`[WordPdfExtractor] Supabase upload failed for ${filename}: ${supErr.message}`);
              }
            }

            rowImages.push({
              url: imageUrl,
              extension: 'png',
              source: 'pdf-native',
              pageNum,
              confidence: 0.85
            });
          } catch (e) {
            console.error(`[WordPdfExtractor] Failed to process native image: ${e.message}`);
          }
        }

        if (rowImages.length > 0) {
          row.cells[imgIdx].image = rowImages[0];
          row.cells[imgIdx].images = rowImages;
          console.log(`[WordPdfExtractor] Region paired ${rowImages.length} images to row ${row.cells[snIdx]?.value || i} page ${pageNum}`);
        }
      }
    }
  }

  // Cleanup: Delete any image files in publicRoot that did not end up paired to any row
  const pairedUrls = new Set();
  for (const r of table.rows) {
    const cellImages = r.cells[imgIdx]?.images || [];
    for (const img of cellImages) {
      if (img.url) pairedUrls.add(path.basename(img.url));
    }
  }
  try {
    const allFiles = await fs.readdir(publicRoot);
    for (const f of allFiles) {
      if (!pairedUrls.has(f)) {
        await fs.unlink(path.join(publicRoot, f)).catch(() => {});
      }
    }
  } catch (err) {
    console.warn(`[WordPdfExtractor] Failed to clean up unpaired files: ${err.message}`);
  }

  // Cleanup the python layout output directory under PDF folder
  const assetsDir = path.join(path.dirname(pdfPath), 'extracted_assets');
  await fs.rm(assetsDir, { recursive: true, force: true }).catch(() => {});
}

// Unified fast path executor
export async function extractPdfViaWordFastPath(filePath, progressCallback = () => {}) {
  const absInput = path.resolve(filePath);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boqflow-safe-'));
  const sessionId = `extract_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  try {
    await emit(progressCallback, 5);
    
    // Get page count for safety checks
    let pageCount = 1;
    try {
      const infoResult = await execFileAsync('pdfinfo', [absInput], { timeout: 30000 });
      const m = infoResult.stdout.match(/Pages:\s+(\d+)/);
      if (m) pageCount = parseInt(m[1], 10);
    } catch (e) {
      console.warn(`[WordPdfExtractor] Failed to run pdfinfo for page count check: ${e.message}`);
    }

    const text = await pdfToText(absInput, workDir);
    await emit(progressCallback, 45);
    
    // Evaluate both v16 and v17 regex patterns on layout text
    const candidates = [
      parseOfmlProductSummary(text),
      parseBillNo(text),
      parseSerialFinancial(text),
      parseSedus(text),
      parseGenericFinancialSchedule(text),
      parseHierarchicalBoq(text),
      parseTeknionV17(text),
      parseStudio184V17(text),
      parseMuscatNestedV17(text),
      parseCivilBoq(text),
      parseTenderBoq(text),
      parseAlshayaStyleSchedule(text)
    ].filter(Boolean);
    
    let selected = selectBestCandidate(candidates);
    if (selected) {
      console.log(`[WordPdfExtractor] Candidate found: ${selected.sheetName} (${selected.rows.length} rows, confidence: ${(selected.confidence * 100).toFixed(1)}%)`);
    } else {
      console.log(`[WordPdfExtractor] No candidates found for file.`);
    }

    if (selected && selected.confidence >= 0.94) {
      // Safety check: relaxed minimum expected rows from 8 to 3 to support short files
      const minExpectedRows = Math.max(3, Math.min(30, pageCount * 1.5));
      if (selected.rows.length < minExpectedRows) {
        console.warn(`[WordPdfExtractor] Fast path rejected: got ${selected.rows.length} rows for ${pageCount} pages (expected >= ${minExpectedRows}). Falling back to Word COM.`);
        return null;
      }

      selected = canonicalizeTable(selected);
      selected.rows = dedupeRows(selected.rows);
      selected.extractionAudit = buildAudit(selected);
      await extractAndPairImages(absInput, selected, sessionId);
      selected.serialAudit = selected.extractionAudit;
      await emit(progressCallback, 100);
      return {
        tables: [selected],
        totalTables: 1,
        isDirectExtraction: true,
        engineUsed: `wordpdf-universal-v16.0-fastpath (${selected.engineUsed})`,
        previewUrl: null,
        sessionId
      };
    }
    return null;
  } catch (error) {
    console.warn(`[WordPdfExtractor] Fast-path Poppler extraction failed: ${error.message}`);
    return null;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
