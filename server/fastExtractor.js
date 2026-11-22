import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { promisify } from 'util';
import xml2js from 'xml2js';
import { fileURLToPath } from 'url';
import axios from 'axios';
import FormData from 'form-data';
import { uploadToSupabase, supabase } from './utils/supabaseStorage.js';
import { convertEmfToPng } from './utils/emfConverter.js';
import { extractLegacyExcelData } from './legacyExtractor.js';
import { convertXlsToXlsx } from './utils/xlsToXlsxConverter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
const parseString = promisify(parser.parseString);

// ──────────────────────────────────────────────────────────────────────────────
// Sheet-level & Table-level Classification Rules
// ──────────────────────────────────────────────────────────────────────────────

const NON_BOQ_SHEET_NAME_RE = /^(cover(\s*page|\s*sheet)?|title(\s*page)?|table\s*of\s*contents|t\.?o\.?c\.?|index|contents|general\s*notes?|notes?(\s*&\s*instructions)?|instructions?(\s*to\s*tenderers|\s*to\s*bidders)?|terms(\s*(&|and)\s*conditions)?|conditions|preamble|abbreviations|legend|appendix|appendices|clarifications|exclusions|assumptions|deviations|signature|sign[\s-]*off)$/i;

const SUMMARY_SHEET_NAME_RE = /\b(summary|recap|recapitulation|grand\s*summary|collection(\s*page|\s*sheet)?|bill\s*summary|summary\s*of\s*bills)\b/i;

const COLUMN_ROLE_PATTERNS = [
    { role: 'sn', pattern: /^(s\.?\s*n\.?o?\.?|sr\.?\s*n\.?o?\.?|sl\.?\s*n\.?o?\.?|item\s*(no\.?|#)|line\s*(no\.?|#)|no\.?|#)$/i },
    { role: 'image', pattern: /\b(image|img|photo|picture|pic|indicative\s*image|reference\s*image|illustration|sketch|visual)s?\b/i },
    { role: 'code', pattern: /\b(code|item\s*code|product\s*code|ref(\.?|erence)?(\s*no\.?)?|tag|id|mark|symbol|type\s*code|cat(\.?|alog)\s*no)\b/i },
    { role: 'desc', pattern: /\b(descriptions?|desc\.?|particulars?|items?\s*descriptions?|work\s*descriptions?|material\s*descriptions?|product\s*name|item\s*name|furniture\s*descriptions?|boq\s*descriptions?|scope(\s*of\s*works?)?)\b/i },
    { role: 'spec', pattern: /\b(spec(ification)?s?|details?|technical\s*spec|material\s*&?\s*finish|finish(es)?|dimensions?|size|model|brand|make|manufacturer|supplier|reference|type)\b/i },
    { role: 'location', pattern: /\b(location|area|room|zone|floor|level|building|department|space)\b/i },
    { role: 'qty', pattern: /\b(qty|quantity|quanity|qnty|q'?ty|total\s*qty|total\s*quantity|base\s*qty|est(\.|imated)?\s*qty|count)\b/i },
    { role: 'unit', pattern: /^(unit|uom|untit|u\.o\.m\.?|measure|unit\s*of\s*measure)$/i },
    { role: 'rate', pattern: /\b(rate|u\.?\s*rate|unit\s*rate|price|prise|unit\s*price|cost|unit\s*cost|supply\s*rate)\b/i },
    { role: 'amount', pattern: /\b(amount|total\s*amount|total\s*price|total\s*cost|extended\s*price|ext\.?\s*amount|total\s*value|net\s*amount|value|sum)\b|^total$/i },
    { role: 'remarks', pattern: /\b(remarks?|notes?|comments?)\b/i }
];

const CANONICAL_ROLE_ORDER = ['sn', 'code', 'image', 'location', 'desc', 'spec', 'qty', 'unit', 'rate', 'amount', 'remarks', 'other'];

const FOOTER_START_RE = /^(terms\s*(&|and)\s*conditions|general\s*notes?|special\s*conditions|exclusions?\s*:?|assumptions?\s*:?|clarifications?\s*:?|payment\s*terms|validity\s*:?|delivery\s*(period|time|terms)\s*:?|warranty\s*:?|prepared\s*by|checked\s*by|approved\s*by|authorized\s*signatory|for\s+and\s+on\s+behalf|contractor'?s?\s*(stamp|signature)|client'?s?\s*(stamp|signature)|consultant'?s?\s*(stamp|signature))\b/i;

const PAGE_ARTIFACT_RE = /^(page\s*(?:no\.?|#)?\s*(?:bill\b.*|\d+(?:\s*(?:of|\/)\s*\d+)?)|\d+\s*\/\s*\d+|p\.?\s*\d+|continued(\s*on\s*next\s*page|\.\.\.)?|\(continued\))$/i;

const SUMMARY_ROW_RE = /^((?:sub[\s-]*|grand\s*|net\s+|gross\s+)?total(?:\s+(?:amount|value|price|cost|qty|quantity|summary|for|of|in|including|excluding)\b.*|\s*\(.*\)|\s*[:\-–].*)?|net\s*(?:amount|value)(?:\s*\(.*\)|\s*[:\-–].*)?|total\s*(?:summary|of\s+.*).*|to\s*summary.*|contract\s*value.*|system\s*total.*|carried\s*(?:forward|to\s*summary|to\s*collection).*|brought\s*(?:forward|from).*|c\/f|b\/f|to\s*collection|vat(?:\s*\d+(?:\.\d+)?\s*%?)?.*|add\s*vat.*|tax(?:\s*\d+(?:\.\d+)?\s*%?)?.*|discount.*|less\s*discount.*|amount\s*in\s*words.*|say\s+(?:omr|aed|sar|usd|eur|gbp).*)$/i;

const METADATA_LABEL_RE = /^(project|client|customer|consultant|contractor|employer|tender|contract|package|subject|title|date|rev|revision|bill\s*no|sheet\s*no|ref\s*no|prepared\s*by|page)\b.*:/i;

const NOTES_PREFIX_RE = /^(notes?|remark|important|disclaimer|general)\s*:/i;

function isNonBoqSheetName(name) {
    return NON_BOQ_SHEET_NAME_RE.test(String(name || '').trim());
}

function isSummarySheetName(name) {
    return SUMMARY_SHEET_NAME_RE.test(String(name || '').trim());
}

function getColumnRole(headerText, prevRole = null) {
    const clean = String(headerText || '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > 60) return null;

    if (/^item$/i.test(clean)) {
        return prevRole === 'qty' ? 'unit' : 'sn';
    }

    for (const { role, pattern } of COLUMN_ROLE_PATTERNS) {
        if (pattern.test(clean)) return role;
    }
    return null;
}

function cleanLeakedSectionBanner(text) {
    if (!text) return '';
    let out = String(text).trim();
    out = out.replace(/\s+\d+[a-z]?\.\s+[A-Z0-9\s.&/–—-]{4,}(?:SPECS|SPECIFICATIONS|FURNITURE\s+SPECS|SCHEDULE|BOQ)\s*$/g, '');
    out = out.replace(/\s+(?:Nos\.\s+Description\s+Area\s+)?CODE\s+(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|GROUND|MEZZANINE|BASEMENT|LOWER|UPPER|ROOF)\s+(?:FLOOR|LEVEL)(?:\s+LOOSE\s+FURNITURE\s*-?\s*Supply\s+and\s+fixing(?:\s+[A-Z0-9\s/&–—-]+)?)?\s*$/g, '');
    return out.trim();
}

function extractText(val) {
    if (val === null || val === undefined) return '';
    if (val instanceof Date) return val.toISOString().split('T')[0];
    if (typeof val !== 'object') return String(val).trim();
    if (Array.isArray(val.richText)) return val.richText.map(t => t.text || '').join('').trim();
    if (val.text !== undefined && val.text !== null) return extractText(val.text);
    if (val.error) return '';
    if (val.result !== undefined) {
        if (typeof val.result === 'object' && val.result !== null && val.result.error) return '';
        return extractText(val.result);
    }
    if (val.formula !== undefined || val.sharedFormula !== undefined) return '';
    return '';
}

function isKeyValueMetadataRow(cells) {
    const nonEmpty = cells.map((c, idx) => ({ val: String(c || '').trim(), idx })).filter(x => x.val);
    if (nonEmpty.length === 0) return false;

    for (const item of nonEmpty) {
        if (METADATA_LABEL_RE.test(item.val)) return true;
    }

    // e.g. ["PROJECT DESCRIPTION:", "HQ Fitout", "UNIT:", "OMR"]
    let colonPairs = 0;
    for (let i = 0; i < cells.length - 1; i++) {
        const cur = String(cells[i] || '').trim();
        const nxt = String(cells[i + 1] || '').trim();
        if (cur.endsWith(':') && nxt && !nxt.endsWith(':')) {
            colonPairs++;
        }
    }
    if (colonPairs >= 1 && nonEmpty.some(x => x.val.endsWith(':'))) return true;

    return false;
}

function isPureNumeric(val) {
    const s = String(val || '').replace(/,/g, '').trim();
    return s !== '' && /^-?\d+(\.\d+)?$/.test(s);
}

function parsePositiveNumber(val) {
    const s = String(val || '').replace(/,/g, '').trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

function isSubHeaderRow(cells, topCells) {
    if (!cells || cells.length === 0) return false;
    const nonEmpty = cells.map(c => String(c || '').trim()).filter(Boolean);
    if (nonEmpty.length < 2) return false;

    // Data rows have numeric quantities/values or long sentence descriptions
    if (nonEmpty.some(c => c.length > 60 || isPureNumeric(c))) return false;

    let roleMatches = 0;
    let prevRole = null;
    for (const c of cells) {
        const role = getColumnRole(c, prevRole);
        if (role) roleMatches++;
        prevRole = role;
    }
    if (roleMatches >= 2) return true;

    // Also allow short sub-labels sitting beneath horizontal group headers
    const hasTopGroupLabels = topCells.some((t, i) => {
        const cur = String(t || '').trim();
        if (!cur) return false;
        const nextTop = String(topCells[i + 1] || '').trim();
        return (nextTop === '' || nextTop === cur) && String(cells[i] || '').trim() !== '';
    });
    return hasTopGroupLabels && roleMatches >= 1 && nonEmpty.every(c => c.length <= 25);
}

function validateBoqHeader(header, roleOverrides = null) {
    const nonEmpty = header.map(h => String(h || '').trim()).filter(Boolean);
    if (nonEmpty.length < 3) return false;

    const roles = [];
    let prevRole = null;
    for (let i = 0; i < header.length; i++) {
        const r = (roleOverrides && roleOverrides[i]) || getColumnRole(header[i], prevRole);
        roles.push(r || 'other');
        prevRole = r;
    }

    const matchedRoles = new Set(roles.filter(r => r !== 'other'));
    if (matchedRoles.size < 2) return false;

    const hasIdentifyingOrDesc = matchedRoles.has('desc') || matchedRoles.has('spec') || matchedRoles.has('code');
    const hasBoqMeasureOrDetail = matchedRoles.has('qty') || matchedRoles.has('unit') || matchedRoles.has('rate') || matchedRoles.has('spec') || matchedRoles.has('image');

    return hasIdentifyingOrDesc && hasBoqMeasureOrDetail;
}

function detectHeaderAt(rows, idx) {
    const topRow = rows[idx];
    if (!topRow || !topRow.cells || topRow.cells.length === 0) return null;
    if (isKeyValueMetadataRow(topRow.cells)) return null;

    const sanitizeHeaderCell = (val) => {
        const s = String(val || '').replace(/\s+/g, ' ').trim();
        if (!s || /^-?\d+(?:,\d{3})*(?:\.\d+)?\s*%?$/.test(s)) return '';
        return s;
    };

    const nextRow = rows[idx + 1];
    const hasSubHeader = nextRow && !isKeyValueMetadataRow(nextRow.cells) && isSubHeaderRow(nextRow.cells, topRow.cells);

    const maxLen = Math.max(topRow.cells.length, hasSubHeader ? nextRow.cells.length : 0);
    const mergedRaw = [];

    if (hasSubHeader) {
        for (let c = 0; c < maxLen; c++) {
            const top = sanitizeHeaderCell(topRow.cells[c]);
            const sub = sanitizeHeaderCell(nextRow.cells[c]);
            const subRole = getColumnRole(sub);
            const prevTop = c > 0 ? sanitizeHeaderCell(topRow.cells[c - 1]) : '';
            const nextTop = c + 1 < maxLen ? sanitizeHeaderCell(topRow.cells[c + 1]) : '';
            const isRepeatedGroup = Boolean(top) && (top === prevTop || top === nextTop);
            const isSpanningGroup = Boolean(top) && nextTop === '' && sanitizeHeaderCell(nextRow.cells[c + 1]) !== '';

            if (sub) {
                if (subRole || !top || isRepeatedGroup || isSpanningGroup) {
                    mergedRaw.push(sub);
                } else {
                    mergedRaw.push(`${top} - ${sub}`);
                }
            } else {
                mergedRaw.push(top);
            }
        }
    } else {
        for (let c = 0; c < maxLen; c++) {
            mergedRaw.push(sanitizeHeaderCell(topRow.cells[c]));
        }
    }

    let firstRoleCol = -1;
    let firstNonEmptyCol = -1;
    for (let c = 0; c < mergedRaw.length; c++) {
        if (!mergedRaw[c]) continue;
        if (firstNonEmptyCol === -1) firstNonEmptyCol = c;
        if (firstRoleCol === -1 && getColumnRole(mergedRaw[c])) {
            firstRoleCol = c;
        }
    }
    if (firstNonEmptyCol === -1) return null;

    let firstCol = firstRoleCol !== -1 ? firstRoleCol : firstNonEmptyCol;
    while (firstCol > 0 && mergedRaw[firstCol - 1]) {
        firstCol--;
    }

    let lastCol = firstCol;
    let emptyStreak = 0;
    for (let c = firstCol; c < mergedRaw.length; c++) {
        if (mergedRaw[c]) {
            lastCol = c;
            emptyStreak = 0;
        } else {
            emptyStreak++;
            if (emptyStreak >= 2 && validateBoqHeader(mergedRaw.slice(firstCol, lastCol + 1))) {
                break;
            }
        }
    }

    if (lastCol - firstCol + 1 < 3) return null;

    const header = mergedRaw.slice(firstCol, lastCol + 1);
    const headerEndIdx = hasSubHeader ? idx + 1 : idx;
    let roleOverrides = null;
    const namedRoles = [];
    { let prev = null; for (const h of header) { const r = getColumnRole(h, prev); namedRoles.push(r); prev = r; } }
    if (!namedRoles.includes('desc')) {
        // No column is NAMED as the description ("Service", "Works", "Item", another language...):
        // find it by shape instead. Two measure columns + a text-heavy column underneath.
        const inferred = inferDescriptionByShape(rows, headerEndIdx, header, firstCol);
        if (inferred && validateBoqHeader(header, inferred)) {
            roleOverrides = inferred;
            const di = roleOverrides.indexOf('desc');
            // Downstream code finds the description by header text, so make the label say so
            if (!/desc|item|product|spec|particular|detail|scope/i.test(header[di] || '')) {
                header[di] = header[di] ? `${header[di]} DESCRIPTION` : 'DESCRIPTION';
            }
        }
    }
    if (!validateBoqHeader(header, roleOverrides)) return null;

    // A header can disagree with its data ("QTY | Unit" above "LS | 20"): trust the data
    roleOverrides = alignQtyUnitWithData(rows, headerEndIdx, header, firstCol, roleOverrides);

    return {
        header,
        firstCol,
        lastCol,
        headerEndIdx,
        roleOverrides
    };
}

/**
 * Shape-based fallback for headers whose description column uses unknown wording.
 * Needs >= 2 measure columns (qty / unit / rate / amount) by name, then picks the column
 * holding the most free text in the rows below as the description.
 */
function inferDescriptionByShape(rows, headerEndIdx, header, firstCol) {
    const roles = [];
    let prevRole = null;
    for (const h of header) {
        const r = getColumnRole(h, prevRole);
        roles.push(r);
        prevRole = r;
    }
    const measures = new Set(roles.filter(r => r === 'qty' || r === 'unit' || r === 'rate' || r === 'amount'));
    if (measures.size < 2) return null;

    const textChars = header.map(() => 0);
    const textCells = header.map(() => 0);
    const softChars = header.map(() => 0);
    const softCells = header.map(() => 0);
    let numericRows = 0;
    for (let j = headerEndIdx + 1; j < Math.min(rows.length, headerEndIdx + 61); j++) {
        const cells = rows[j].cells || [];
        let rowHasMeasureNumber = false;
        for (let c = 0; c < header.length; c++) {
            const v = String(cells[firstCol + c] || '').trim();
            if (!v) continue;
            if (isPureNumeric(v)) {
                if (roles[c] === 'qty' || roles[c] === 'rate' || roles[c] === 'amount') rowHasMeasureNumber = true;
                continue;
            }
            if (roles[c] === null) { textChars[c] += v.length; textCells[c]++; }
            else { softChars[c] += v.length; softCells[c]++; }
        }
        if (rowHasMeasureNumber) numericRows++;
    }
    if (numericRows < 1) return null;

    // Unnamed columns first; a column named like a serial / code / location only qualifies
    // when its cells are clearly sentences (header "Item" above full descriptions)
    const firstSn = roles.indexOf('sn');
    const isCandidate = (c) => {
        if (roles[c] === null) return textCells[c] > 0;
        if (!softCells[c]) return false;
        const avg = softChars[c] / softCells[c];
        // A second "serial" column ("# | Item") cannot be a serial too
        if (roles[c] === 'sn' && firstSn !== -1 && c > firstSn) return avg >= 6;
        return (roles[c] === 'sn' || roles[c] === 'code' || roles[c] === 'location' || roles[c] === 'remarks') && avg >= 15;
    };
    let best = -1;
    for (let c = 0; c < header.length; c++) {
        if (!isCandidate(c)) continue;
        const chars = roles[c] === null ? textChars[c] : softChars[c];
        const bestChars = best === -1 ? -1 : (roles[best] === null ? textChars[best] : softChars[best]);
        if (chars > bestChars) best = c;
    }
    if (best === -1) return null;
    const avg = roles[best] === null ? textChars[best] / textCells[best] : softChars[best] / softCells[best];
    if (avg < 6) return null;

    const overrides = header.map(() => null);
    overrides[best] = 'desc';
    return overrides;
}

/** Swap quantity and unit when the cells under them are plainly the other way round. */
function alignQtyUnitWithData(rows, headerEndIdx, header, firstCol, roleOverrides) {
    const roles = [];
    let prev = null;
    for (let i = 0; i < header.length; i++) {
        const r = (roleOverrides && roleOverrides[i]) || getColumnRole(header[i], prev);
        roles.push(r);
        prev = r;
    }
    const q = roles.indexOf('qty'), u = roles.indexOf('unit');
    if (q === -1 || u === -1) return roleOverrides;
    let qNum = 0, qText = 0, uNum = 0, uText = 0;
    for (let j = headerEndIdx + 1; j < Math.min(rows.length, headerEndIdx + 61); j++) {
        const cells = rows[j].cells || [];
        const qv = String(cells[firstCol + q] || '').trim(), uv = String(cells[firstCol + u] || '').trim();
        if (qv) { if (isPureNumeric(qv)) qNum++; else if (qv.length <= 8) qText++; }
        if (uv) { if (isPureNumeric(uv)) uNum++; else if (uv.length <= 8) uText++; }
    }
    if (qText >= 2 && uNum >= 2 && qNum <= qText * 0.2 && uText <= uNum * 0.2) {
        const out = roles.slice();
        out[q] = 'unit'; out[u] = 'qty';
        [header[q], header[u]] = [header[u], header[q]];
        return out;
    }
    return roleOverrides;
}

const SHAPE_ROLE_LABEL = { sn: 'S.No', desc: 'Description', unit: 'Unit', qty: 'Qty', rate: 'Rate', amount: 'Amount' };

/**
 * Language-agnostic header detection: a row of short labels followed by rows that look like
 * BOQ items. Column roles come from the DATA: the text-heavy column is the description,
 * numeric columns where a x b = c are quantity / rate / amount, a short repeating text
 * column is the unit, a leading running number is the serial.
 */
function detectHeaderByShapeAt(rows, idx) {
    const top = rows[idx];
    if (!top || !top.cells) return null;
    const labelled = [];
    top.cells.forEach((c, i) => { if (String(c || '').trim()) labelled.push(i); });
    if (labelled.length < 3) return null;
    if (labelled.some(i => { const v = String(top.cells[i]).trim(); return v.length > 40 || isPureNumeric(v); })) return null;
    if (isKeyValueMetadataRow(top.cells)) return null;

    const firstCol = labelled[0];
    const lastCol = labelled[labelled.length - 1];
    const width = lastCol - firstCol + 1;
    const sample = rows.slice(idx + 1, idx + 41);
    if (sample.length < 2) return null;

    const stats = Array.from({ length: width }, () => ({ nums: [], numeric: 0, text: 0, chars: 0, values: new Set() }));
    const dataRows = [];
    for (const r of sample) {
        let hasNumber = false, hasText = false;
        const parsed = [];
        for (let c = 0; c < width; c++) {
            const v = String((r.cells || [])[firstCol + c] || '').trim();
            const n = v ? parsePositiveNumber(v) : null;
            parsed.push(n);
            if (!v) continue;
            if (n !== null) hasNumber = true; else if (v.length >= 4) hasText = true;
        }
        if (!(hasNumber && hasText)) continue;
        dataRows.push(parsed);
        for (let c = 0; c < width; c++) {
            const v = String((r.cells || [])[firstCol + c] || '').trim();
            if (!v) continue;
            if (parsed[c] !== null) { stats[c].numeric++; stats[c].nums.push(parsed[c]); }
            else { stats[c].text++; stats[c].chars += v.length; stats[c].values.add(v.toLowerCase()); }
        }
    }
    if (dataRows.length < 2 || dataRows.length < sample.length * 0.3) return null;

    const roles = Array.from({ length: width }, () => null);
    // Description: the column carrying the most free text
    let descCol = -1;
    stats.forEach((s, c) => { if (s.text && (descCol === -1 || s.chars > stats[descCol].chars)) descCol = c; });
    if (descCol === -1 || stats[descCol].chars / stats[descCol].text < 8) return null;
    roles[descCol] = 'desc';

    const numericCols = stats.map((s, c) => c).filter(c => c !== descCol && stats[c].numeric >= dataRows.length * 0.5);
    // Serial: leading running numbers 1,2,3...
    if (numericCols.length && numericCols[0] < descCol) {
        const seq = stats[numericCols[0]].nums;
        const steps = seq.slice(1).filter((n, i) => n - seq[i] === 1).length;
        if (seq.length >= 2 && steps >= (seq.length - 1) * 0.7) roles[numericCols.shift()] = 'sn';
    }
    // Quantity x rate = amount, in any column order
    let triple = null;
    for (const a of numericCols) for (const b of numericCols) for (const c of numericCols) {
        if (triple || a >= b || a === c || b === c) continue;
        let checked = 0, ok = 0;
        for (const row of dataRows) {
            if (row[a] === null || row[b] === null || row[c] === null) continue;
            checked++;
            if (Math.abs(row[a] * row[b] - row[c]) <= Math.max(0.02, Math.abs(row[c]) * 0.002)) ok++;
        }
        if (checked >= 2 && ok >= checked * 0.8) triple = [a, b, c];
    }
    if (triple) {
        roles[triple[0]] = 'qty'; roles[triple[1]] = 'rate'; roles[triple[2]] = 'amount';
    } else if (numericCols.length) {
        roles[numericCols[0]] = 'qty';
        if (numericCols[1] !== undefined) roles[numericCols[1]] = 'rate';
        if (numericCols[2] !== undefined) roles[numericCols[2]] = 'amount';
    } else {
        return null;
    }
    // Unit: short text that repeats (No, m2, LS ...), preferring the column next to the quantity
    const qtyCol = roles.indexOf('qty');
    const unitCandidates = stats.map((s, c) => c).filter(c => {
        const s = stats[c];
        if (roles[c] || s.text < dataRows.length * 0.5 || s.chars / s.text > 6) return false;
        return s.text < 3 || s.values.size <= s.text * 0.7;
    });
    if (unitCandidates.length) {
        unitCandidates.sort((x, y) => Math.abs(x - qtyCol) - Math.abs(y - qtyCol));
        roles[unitCandidates[0]] = 'unit';
    }
    // Serial: a leading column of short, all-different codes (A1, 1.2, I-3 ...)
    if (!roles.includes('sn')) {
        for (let c = 0; c < descCol; c++) {
            const s = stats[c];
            if (!roles[c] && s.text >= dataRows.length * 0.5 && s.chars / s.text <= 10 && s.values.size >= s.text * 0.9) { roles[c] = 'sn'; break; }
        }
    }

    const header = [];
    for (let c = 0; c < width; c++) {
        const original = String(top.cells[firstCol + c] || '').replace(/\s+/g, ' ').trim();
        const role = roles[c];
        if (role && getColumnRole(original) !== role) header.push(original ? `${SHAPE_ROLE_LABEL[role]} (${original})` : SHAPE_ROLE_LABEL[role]);
        else header.push(original);
    }
    if (!validateBoqHeader(header, roles)) return null;
    return { header, firstCol, lastCol, headerEndIdx: idx, roleOverrides: roles, detectedByShape: true };
}

function buildRoleIndices(header, roleOverrides = null) {
    const roles = [];
    const byRole = {};
    let prevRole = null;
    for (let i = 0; i < header.length; i++) {
        const role = (roleOverrides && roleOverrides[i]) || getColumnRole(header[i], prevRole) || 'other';
        roles.push(role);
        if (!byRole[role]) byRole[role] = [];
        byRole[role].push(i);
        prevRole = role;
    }
    return { roles, byRole };
}

function isRepeatedHeaderRow(cells, header) {
    const nonEmpty = cells.map(c => String(c || '').trim()).filter(Boolean);
    if (nonEmpty.length < 2) return false;
    if (nonEmpty.some(c => c.length > 60 || isPureNumeric(c))) return false;

    let exactMatches = 0;
    let roleMatches = 0;
    let prevRole = null;
    for (let i = 0; i < cells.length; i++) {
        const val = String(cells[i] || '').trim();
        if (!val) continue;
        if (header[i] && val.toLowerCase() === header[i].toLowerCase()) exactMatches++;
        const role = getColumnRole(val, prevRole);
        if (role) roleMatches++;
        prevRole = role;
    }
    return exactMatches >= 2 || roleMatches >= 2;
}

function isPageArtifactRow(cells) {
    const nonEmpty = cells.map(c => String(c || '').trim()).filter(Boolean);
    return nonEmpty.length > 0 && nonEmpty.every(c => PAGE_ARTIFACT_RE.test(c));
}

function isFinancialSummaryRow(cells, roleInfo) {
    const textIndices = new Set([
        ...(roleInfo.byRole.sn || []),
        ...(roleInfo.byRole.code || []),
        ...(roleInfo.byRole.desc || []),
        ...(roleInfo.byRole.spec || []),
        ...(roleInfo.byRole.location || [])
    ]);

    for (let i = 0; i < cells.length; i++) {
        const val = String(cells[i] || '').trim();
        if (!val) continue;
        if ((textIndices.has(i) || i === 0 || cells.filter(Boolean).length <= 3) && SUMMARY_ROW_RE.test(val)) {
            return true;
        }
    }
    return false;
}

function isFooterStartRow(cells, roleInfo) {
    const firstNonEmpty = cells.map(c => String(c || '').trim()).find(Boolean) || '';
    if (!firstNonEmpty) return false;
    if (!FOOTER_START_RE.test(firstNonEmpty)) return false;

    const hasQty = (roleInfo.byRole.qty || []).some(idx => parsePositiveNumber(cells[idx]) !== null);
    const hasCode = (roleInfo.byRole.code || []).some(idx => {
        const v = String(cells[idx] || '').trim();
        return v && !FOOTER_START_RE.test(v);
    });
    return !(hasQty && hasCode);
}

function isValidBoqDataRow(cells, roleInfo, hasImage) {
    const nonEmptyCount = cells.filter(c => String(c || '').trim() !== '').length;
    if (nonEmptyCount === 0 && !hasImage) return false;
    if (nonEmptyCount <= 1 && !hasImage) return false;

    const firstNonEmpty = cells.map(c => String(c || '').trim()).find(Boolean) || '';
    if (NOTES_PREFIX_RE.test(firstNonEmpty)) return false;

    const descIdx = roleInfo.byRole.desc?.[0];
    if (descIdx !== undefined && NOTES_PREFIX_RE.test(String(cells[descIdx] || '').trim())) {
        return false;
    }

    const hasQtyCol = (roleInfo.byRole.qty || []).length > 0;
    const hasUnitCol = (roleInfo.byRole.unit || []).length > 0;

    const hasNumericQty = (roleInfo.byRole.qty || []).some(idx => parsePositiveNumber(cells[idx]) !== null);
    const hasUnit = (roleInfo.byRole.unit || []).some(idx => {
        const v = String(cells[idx] || '').trim();
        // "Note" / "Remark" in the unit column marks an explanatory line, not a measured item
        return v !== '' && v.length <= 20 && !/^(notes?|remarks?|info|n\/?a)\.?$/i.test(v);
    });
    const hasRate = (roleInfo.byRole.rate || []).some(
        idx => parsePositiveNumber(cells[idx]) !== null
    );
    const hasCode = (roleInfo.byRole.code || []).some(idx => {
        const v = String(cells[idx] || '').trim();
        return v !== '' && !NOTES_PREFIX_RE.test(v);
    });
    const hasDescOrSpec = [...(roleInfo.byRole.desc || []), ...(roleInfo.byRole.spec || [])].some(
        idx => String(cells[idx] || '').trim() !== ''
    );

    if (hasQtyCol || hasUnitCol) {
        return (hasNumericQty || hasUnit || hasRate || hasImage) && (hasDescOrSpec || hasCode || hasImage);
    }

    return (hasCode && hasDescOrSpec) || hasImage;
}

function detectSectionTitle(cells, roleInfo) {
    const measureIdx = new Set([
        ...(roleInfo.byRole.qty || []), ...(roleInfo.byRole.unit || []),
        ...(roleInfo.byRole.rate || []), ...(roleInfo.byRole.amount || [])
    ]);
    const snIdx = new Set(roleInfo.byRole.sn || []);
    const texts = [];
    for (let i = 0; i < cells.length; i++) {
        const v = String(cells[i] || '').trim();
        if (!v) continue;
        if (measureIdx.has(i)) {
            // Empty-looking totals ("0", "-", "0.00") next to a heading do not make it an item
            if (/^[-–—\s]*$|^0+(\.0+)?$/.test(v)) continue;
            return '';
        }
        if (snIdx.has(i) && v.length <= 12) continue;
        if (isPureNumeric(v)) continue;
        texts.push(v);
    }
    const unique = [...new Set(texts)];
    if (unique.length !== 1) return '';
    const title = unique[0];
    if (title.length > 90 || !/\p{L}{2,}/u.test(title) || SUMMARY_ROW_RE.test(title) || NOTES_PREFIX_RE.test(title)) return '';
    return title;
}

function matchAnchorsToRows(anchors, validRows, headerInfo, roleInfo) {
    if (!anchors || anchors.length === 0 || validRows.length === 0) return new Map();

    const firstItemRow = validRows[0].rowNumber;
    const lastItemRow = validRows[validRows.length - 1].rowNumber;
    const firstColGlobal = headerInfo.firstCol + 1;
    const lastColGlobal = headerInfo.lastCol + 1;
    const imageColLocal = roleInfo.byRole.image?.[0] ?? -1;
    const imageColGlobal = imageColLocal !== -1 ? firstColGlobal + imageColLocal : -1;

    const rowMap = new Map(); // validRowIndex -> Map<localCol, anchor[]>

    for (const anchor of anchors) {
        if (anchor.colSpan >= 3) continue;
        if (anchor.centerRow < firstItemRow - 0.5 || anchor.centerRow > lastItemRow + 0.5) continue;
        if (anchor.centerCol < firstColGlobal - 0.5 || anchor.centerCol > lastColGlobal + 0.5) continue;

        // Match closest valid item row
        let bestRowIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < validRows.length; i++) {
            const rn = validRows[i].rowNumber;
            const d = Math.abs(rn - anchor.centerRow);
            if (d < bestDist || (d === bestDist && rn === anchor.fromRow)) {
                bestDist = d;
                bestRowIdx = i;
            }
        }
        if (bestRowIdx === -1 || bestDist > 1.5) continue;

        let localCol;
        if (
            imageColGlobal !== -1 &&
            ((anchor.fromCol <= imageColGlobal && imageColGlobal <= anchor.toCol) ||
                Math.abs(anchor.centerCol - imageColGlobal) <= 1)
        ) {
            localCol = imageColLocal;
        } else {
            localCol = Math.min(
                Math.max(0, Math.round(anchor.centerCol) - firstColGlobal),
                headerInfo.header.length - 1
            );
        }

        if (!rowMap.has(bestRowIdx)) rowMap.set(bestRowIdx, new Map());
        const colMap = rowMap.get(bestRowIdx);
        if (!colMap.has(localCol)) colMap.set(localCol, []);
        colMap.get(localCol).push(anchor);
    }

    return rowMap;
}

function stitchSheetTables(sheetTables) {
    if (sheetTables.length === 0) return [];
    if (sheetTables.length === 1) {
        return [{
            sheetName: 'BOQ Schedule',
            rows: sheetTables[0].rows,
            columnCount: sheetTables[0].header.length,
            header: sheetTables[0].header
        }];
    }

    const norm = (h) => String(h || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const firstNorm = sheetTables[0].header.map(norm);
    const allIdentical = sheetTables.every(
        t => t.header.length === firstNorm.length && t.header.every((h, idx) => norm(h) === firstNorm[idx])
    );

    // In a multi-sheet workbook the sheet is the top-level section ("Civil Works", "Bill No 3")
    const sectionFor = (table, row) => {
        const sheet = String(table.sheetName || '').trim();
        const inner = String(row.sectionLabel || '').trim();
        if (!sheet || /^sheet\s*\d+$/i.test(sheet)) return inner;
        return inner && inner.toLowerCase() !== sheet.toLowerCase() ? `${sheet} — ${inner}` : sheet;
    };

    if (allIdentical) {
        const unifiedRows = [];
        for (const t of sheetTables) unifiedRows.push(...t.rows.map(r => ({ ...r, sectionLabel: sectionFor(t, r) })));
        return [{
            sheetName: 'BOQ Schedule',
            rows: unifiedRows,
            columnCount: sheetTables[0].header.length,
            header: sheetTables[0].header
        }];
    }

    // Build unified header from richest table first, then merge missing columns in canonical role order
    const sortedByRichness = [...sheetTables].sort((a, b) => b.header.length - a.header.length);
    const unifiedCols = sortedByRichness[0].header.map((label, idx) => {
        const prevRole = idx > 0 ? getColumnRole(sortedByRichness[0].header[idx - 1]) : null;
        return {
            label,
            norm: norm(label),
            role: getColumnRole(label, prevRole) || 'other'
        };
    });

    for (const table of sortedByRichness.slice(1)) {
        let prevRole = null;
        for (const label of table.header) {
            const n = norm(label);
            const role = getColumnRole(label, prevRole) || 'other';
            prevRole = role;
            if (!n) continue;

            const hasExact = unifiedCols.some(c => c.norm === n);
            const hasRole = role !== 'other' && unifiedCols.some(c => c.role === role);
            if (!hasExact && !hasRole) {
                const roleRank = CANONICAL_ROLE_ORDER.indexOf(role);
                let insertIdx = unifiedCols.length;
                for (let k = 0; k < unifiedCols.length; k++) {
                    if (CANONICAL_ROLE_ORDER.indexOf(unifiedCols[k].role) > roleRank) {
                        insertIdx = k;
                        break;
                    }
                }
                unifiedCols.splice(insertIdx, 0, { label, norm: n, role });
            }
        }
    }

    const unifiedHeader = unifiedCols.map(c => c.label);
    const unifiedRows = [];

    for (const table of sheetTables) {
        const claimedTargets = new Set();
        const colMapping = new Array(table.header.length).fill(-1);

        // Pass 1: exact normalized header name match
        for (let srcIdx = 0; srcIdx < table.header.length; srcIdx++) {
            const n = norm(table.header[srcIdx]);
            if (!n) continue;
            const targetIdx = unifiedCols.findIndex((uc, idx) => !claimedTargets.has(idx) && uc.norm === n);
            if (targetIdx !== -1) {
                colMapping[srcIdx] = targetIdx;
                claimedTargets.add(targetIdx);
            }
        }

        // Pass 2: canonical role match
        let prevRole = null;
        for (let srcIdx = 0; srcIdx < table.header.length; srcIdx++) {
            const role = getColumnRole(table.header[srcIdx], prevRole) || 'other';
            prevRole = role;
            if (colMapping[srcIdx] !== -1 || role === 'other') continue;
            const targetIdx = unifiedCols.findIndex((uc, idx) => !claimedTargets.has(idx) && uc.role === role);
            if (targetIdx !== -1) {
                colMapping[srcIdx] = targetIdx;
                claimedTargets.add(targetIdx);
            }
        }

        for (const row of table.rows) {
            const alignedCells = Array.from({ length: unifiedHeader.length }, () => ({
                value: '',
                images: [],
                isMerged: false,
                image: null
            }));

            for (let srcIdx = 0; srcIdx < row.cells.length; srcIdx++) {
                const targetIdx = colMapping[srcIdx];
                if (targetIdx !== -1) {
                    alignedCells[targetIdx] = row.cells[srcIdx];
                }
            }

            unifiedRows.push({
                cells: alignedCells,
                sectionLabel: sectionFor(table, row),
                isHeader: false,
                isSummary: false
            });
        }
    }

    return [{
        sheetName: 'BOQ Schedule',
        rows: unifiedRows,
        columnCount: unifiedHeader.length,
        header: unifiedHeader
    }];
}

/**
 * Universal matrix-based BOQ table extractor shared by .xlsx and .xls paths.
 * @param {Array<{name: string, sheetId?: number, state?: string, rows: Array<{rowNumber: number, cells: string[]}>}>} sheetsData
 * @param {Object} options Optional anchor lookup & sheet metadata
 */
function extractCleanBoqTablesFromMatrix(sheetsData, options = {}) {
    const { anchorsBySheetId = {}, anchorsBySheetName = {} } = options;
    const candidates = [];

    for (const sheet of sheetsData) {
        if (!sheet || sheet.state === 'hidden' || sheet.state === 'veryHidden') continue;
        if (isNonBoqSheetName(sheet.name)) continue;

        const rows = (sheet.rows || []).filter(r => r && Array.isArray(r.cells) && r.cells.some(c => String(c || '').trim() !== ''));
        if (rows.length < 2) continue;

        let headerMatch = null;
        let preAnchoredRows = [];
        let roleInfo = null;
        const sheetAnchors =
            (sheet.sheetId !== undefined && anchorsBySheetId[sheet.sheetId]) ||
            anchorsBySheetName[String(sheet.name || '').trim()] ||
            [];

        // Pass 1: headers recognised by wording (with a shape fallback for the description).
        // Pass 2: headers in any wording or language, recognised purely by the data beneath.
        const headerPasses = [detectHeaderAt, detectHeaderByShapeAt];
        for (const detectFn of headerPasses) {
          if (headerMatch) break;
          for (let i = 0; i < rows.length; i++) {
            const detected = detectFn(rows, i);
            if (!detected) continue;

            const candidateRoleInfo = buildRoleIndices(detected.header, detected.roleOverrides);
            const candidateRows = [];
            let pendingSection = '';

            // Pass 1: collect valid BOQ item rows (pre-anchor)
            for (let j = detected.headerEndIdx + 1; j < rows.length; j++) {
                const rawRow = rows[j];
                const slicedCells = [];
                for (let c = detected.firstCol; c <= detected.lastCol; c++) {
                    slicedCells.push(cleanLeakedSectionBanner(rawRow.cells[c] || ''));
                }

                if (!slicedCells.some(Boolean)) continue;
                if (isFooterStartRow(slicedCells, candidateRoleInfo)) break;
                if (isRepeatedHeaderRow(slicedCells, detected.header)) continue;
                if (isPageArtifactRow(slicedCells)) continue;
                if (isFinancialSummaryRow(slicedCells, candidateRoleInfo)) continue;

                // Check if row has an anchor hovering right on it before rejecting image-only rows
                const rowHasPotentialAnchor = sheetAnchors.some(
                    a => a.colSpan < 3 && Math.abs(a.centerRow - rawRow.rowNumber) <= 0.6 && a.centerCol >= detected.firstCol + 1 && a.centerCol <= detected.lastCol + 1
                );

                if (!isValidBoqDataRow(slicedCells, candidateRoleInfo, rowHasPotentialAnchor)) {
                    // A short text-only row between items ("1 | Internal Wall Painting") is a section title
                    const sectionTitle = detectSectionTitle(slicedCells, candidateRoleInfo);
                    if (sectionTitle) pendingSection = sectionTitle;
                    continue;
                }

                candidateRows.push({
                    rowNumber: rawRow.rowNumber,
                    cells: slicedCells,
                    sectionLabel: pendingSection
                });
            }

            if (candidateRows.length > 0) {
                headerMatch = detected;
                roleInfo = candidateRoleInfo;
                preAnchoredRows = candidateRows;
                break;
            }
          }
        }

        if (!headerMatch || preAnchoredRows.length === 0) continue;

        // Pass 2: scoped anchor matching within [firstItemRow .. lastItemRow] & [firstCol .. lastCol]
        const rawMatchedAnchorsByRow = matchAnchorsToRows(sheetAnchors, preAnchoredRows, headerMatch, roleInfo);

        // Prune empty internal spacer columns and infer label for populated unlabelled columns
        const colHasAnchor = new Set();
        for (const colMap of rawMatchedAnchorsByRow.values()) {
            for (const cIdx of colMap.keys()) colHasAnchor.add(cIdx);
        }

        const keptCols = [];
        const oldToNewCol = new Map();
        const finalHeader = [];

        for (let c = 0; c < headerMatch.header.length; c++) {
            const hLabel = headerMatch.header[c];
            const hasCellData = preAnchoredRows.some(r => String(r.cells[c] || '').trim() !== '');
            const hasColAnchor = colHasAnchor.has(c);

            if (!hLabel && !hasCellData && !hasColAnchor) {
                continue; // prune completely empty spacer column
            }

            let resolvedLabel = hLabel;
            if (!resolvedLabel) {
                if (hasColAnchor) {
                    resolvedLabel = 'IMAGE';
                } else {
                    const colVals = preAnchoredRows.map(r => String(r.cells[c] || '').trim()).filter(Boolean);
                    const avgLen = colVals.reduce((sum, v) => sum + v.length, 0) / Math.max(1, colVals.length);
                    const looksLikeSpecs = avgLen > 28 || colVals.some(v => /;|mm\b|cm\b/i.test(v));
                    const hasImageRefAlready = headerMatch.header.some(x => /image\s*ref/i.test(x));
                    if (looksLikeSpecs) {
                        resolvedLabel = 'SPECIFICATIONS';
                    } else {
                        resolvedLabel = !hasImageRefAlready ? 'IMAGE REF' : 'Origin / Ref';
                    }
                }
            }

            oldToNewCol.set(c, keptCols.length);
            keptCols.push(c);
            finalHeader.push(resolvedLabel);
        }

        const prunedRows = preAnchoredRows.map(r => ({
            rowNumber: r.rowNumber,
            sectionLabel: r.sectionLabel || '',
            cells: keptCols.map(oldIdx => r.cells[oldIdx] || '')
        }));

        const matchedAnchorsByRow = new Map();
        for (const [rIdx, colMap] of rawMatchedAnchorsByRow.entries()) {
            const newColMap = new Map();
            for (const [oldCol, anchorList] of colMap.entries()) {
                const mappedCol = oldToNewCol.get(oldCol);
                if (mappedCol !== undefined) {
                    newColMap.set(mappedCol, anchorList);
                }
            }
            if (newColMap.size > 0) matchedAnchorsByRow.set(rIdx, newColMap);
        }

        candidates.push({
            sheetName: sheet.name,
            sheetId: sheet.sheetId,
            isSummarySheet: isSummarySheetName(sheet.name),
            header: finalHeader,
            rows: prunedRows,
            matchedAnchorsByRow
        });
    }

    if (candidates.length === 0) {
        return { tables: [], totalTables: 0, matchedCandidates: [] };
    }

    const nonSummaryCandidates = candidates.filter(c => !c.isSummarySheet);
    const activeCandidates = nonSummaryCandidates.length > 0 ? nonSummaryCandidates : candidates;

    const materialized = activeCandidates.map(c => ({
        sheetName: c.sheetName,
        header: c.header,
        rows: c.rows.map((r, rIdx) => {
            const colMap = c.matchedAnchorsByRow.get(rIdx);
            return {
                cells: r.cells.map((val, cIdx) => {
                    const cellAnchors = colMap?.get(cIdx) || [];
                    const imgs = cellAnchors.map(a => ({
                        url: a.uploadedUrl || '',
                        extension: path.extname(a.mediaFileName || '').substring(1)
                    })).filter(x => x.url);
                    return {
                        value: val || '',
                        images: imgs,
                        isMerged: false,
                        image: imgs.length > 0 ? imgs[0] : null
                    };
                }),
                sectionLabel: r.sectionLabel || '',
                isHeader: false,
                isSummary: false
            };
        })
    }));

    const stitched = stitchSheetTables(materialized);
    return {
        tables: stitched,
        totalTables: stitched.length,
        matchedCandidates: activeCandidates
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Scoped Drawing Anchor Parser & On-Demand Media Uploader
// ──────────────────────────────────────────────────────────────────────────────

function normalizeZipPath(baseDir, target) {
    if (!target) return '';
    const cleaned = String(target).replace(/\\/g, '/');
    if (cleaned.startsWith('/')) return cleaned.substring(1);
    if (cleaned.startsWith('xl/')) return cleaned;
    return path.posix.normalize(path.posix.join(baseDir, cleaned));
}

async function parseDrawingAnchors(filePath) {
    const anchorsBySheetId = {};
    const anchorsBySheetName = {};
    const mediaEntriesByName = {};
    let zip;

    try {
        if (!fsSync.existsSync(filePath)) return { anchorsBySheetId, anchorsBySheetName, mediaEntriesByName };
        zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        const findEntry = (entryPath) => {
            const lower = entryPath.replace(/\\/g, '/').toLowerCase();
            return zipEntries.find(e => e.entryName.replace(/\\/g, '/').toLowerCase() === lower);
        };

        for (const entry of zipEntries) {
            if (entry.entryName.match(/^xl[\\\/]media[\\\/]/i)) {
                mediaEntriesByName[path.basename(entry.entryName)] = entry;
            }
        }

        if (Object.keys(mediaEntriesByName).length === 0) {
            return { anchorsBySheetId, anchorsBySheetName, mediaEntriesByName };
        }

        const wbRelsEntry = findEntry('xl/_rels/workbook.xml.rels');
        const wbEntry = findEntry('xl/workbook.xml');
        const sheetMetaList = [];

        if (wbRelsEntry && wbEntry) {
            const relsResult = await parseString(wbRelsEntry.getData().toString('utf8'));
            const rels = relsResult.Relationships?.Relationship;
            const rIdToTarget = {};
            if (rels) {
                (Array.isArray(rels) ? rels : [rels]).forEach(r => {
                    if (r.Id && r.Target) rIdToTarget[r.Id] = r.Target;
                });
            }

            const wbResult = await parseString(wbEntry.getData().toString('utf8'));
            const sheets = wbResult.workbook?.sheets?.sheet;
            if (sheets) {
                (Array.isArray(sheets) ? sheets : [sheets]).forEach(s => {
                    const rId = s['r:id'];
                    const sheetId = parseInt(s.sheetId, 10);
                    const sheetName = String(s.name || '').trim();
                    const target = rIdToTarget[rId];
                    if (target) {
                        sheetMetaList.push({
                            sheetId,
                            sheetName,
                            sheetPath: normalizeZipPath('xl', target)
                        });
                    }
                });
            }
        } else {
            // Binary .xlsb or non-standard workbook fallback: discover sheet*.(xml|bin).rels directly
            for (const entry of zipEntries) {
                const normalized = entry.entryName.replace(/\\/g, '/');
                const match = normalized.match(/^xl\/worksheets\/_rels\/sheet(\d+)\.(?:xml|bin)\.rels$/i);
                if (match) {
                    const sheetId = parseInt(match[1], 10);
                    sheetMetaList.push({
                        sheetId,
                        sheetName: '',
                        sheetPath: `xl/worksheets/sheet${sheetId}.bin`,
                        directRelsEntry: entry
                    });
                }
            }
        }

        if (sheetMetaList.length === 0) {
            return { anchorsBySheetId, anchorsBySheetName, mediaEntriesByName };
        }

        for (const meta of sheetMetaList) {
            const dir = path.posix.dirname(meta.sheetPath);
            const base = path.posix.basename(meta.sheetPath);
            const relsPath = `${dir}/_rels/${base}.rels`;
            const relsEntry = meta.directRelsEntry || findEntry(relsPath);
            if (!relsEntry) continue;

            const result = await parseString(relsEntry.getData().toString('utf8'));
            const sheetRels = result.Relationships?.Relationship;
            if (!sheetRels) continue;

            const drawingRels = (Array.isArray(sheetRels) ? sheetRels : [sheetRels]).filter(
                r => r.Type && r.Type.includes('drawing') && r.Target
            );

            for (const drawingRel of drawingRels) {
                const drawingPath = normalizeZipPath(dir, drawingRel.Target);
                const drawingEntry = findEntry(drawingPath);
                if (!drawingEntry) continue;

                const drawingDir = path.posix.dirname(drawingPath);
                const drawingName = path.posix.basename(drawingPath);
                const drawingRelsEntry = findEntry(`${drawingDir}/_rels/${drawingName}.rels`);
                const rIdToMedia = {};

                if (drawingRelsEntry) {
                    const drRes = await parseString(drawingRelsEntry.getData().toString('utf8'));
                    const drRels = drRes.Relationships?.Relationship;
                    if (drRels) {
                        (Array.isArray(drRels) ? drRels : [drRels]).forEach(r => {
                            if (r.Id && r.Target) rIdToMedia[r.Id] = path.basename(r.Target);
                        });
                    }
                }

                const drawingResult = await parseString(drawingEntry.getData().toString('utf8'));
                const wsDr = drawingResult['xdr:wsDr'];
                if (!wsDr) continue;

                const rawAnchors = [];
                if (wsDr['xdr:twoCellAnchor']) {
                    rawAnchors.push(...(Array.isArray(wsDr['xdr:twoCellAnchor']) ? wsDr['xdr:twoCellAnchor'] : [wsDr['xdr:twoCellAnchor']]));
                }
                if (wsDr['xdr:oneCellAnchor']) {
                    rawAnchors.push(...(Array.isArray(wsDr['xdr:oneCellAnchor']) ? wsDr['xdr:oneCellAnchor'] : [wsDr['xdr:oneCellAnchor']]));
                }

                for (const anchor of rawAnchors) {
                    const from = anchor['xdr:from'];
                    if (!from) continue;

                    const fromRow = parseInt(from['xdr:row'], 10) + 1;
                    const fromCol = parseInt(from['xdr:col'], 10) + 1;
                    const to = anchor['xdr:to'];
                    const toRow = to ? parseInt(to['xdr:row'], 10) + 1 : fromRow;
                    const toCol = to ? parseInt(to['xdr:col'], 10) + 1 : fromCol;

                    const pic = anchor['xdr:pic'];
                    const rId = pic?.['xdr:blipFill']?.['a:blip']?.['r:embed'];
                    const mediaFileName = rId ? rIdToMedia[rId] : null;
                    if (!mediaFileName || !mediaEntriesByName[mediaFileName]) continue;

                    const desc = {
                        sheetId: meta.sheetId,
                        sheetName: meta.sheetName,
                        fromRow,
                        fromCol,
                        toRow,
                        toCol,
                        centerRow: (fromRow + toRow) / 2,
                        centerCol: (fromCol + toCol) / 2,
                        rowSpan: Math.max(1, toRow - fromRow + 1),
                        colSpan: Math.max(1, toCol - fromCol + 1),
                        mediaFileName,
                        uploadedUrl: null
                    };

                    if (!anchorsBySheetId[meta.sheetId]) anchorsBySheetId[meta.sheetId] = [];
                    anchorsBySheetId[meta.sheetId].push(desc);
                    if (meta.sheetName) {
                        if (!anchorsBySheetName[meta.sheetName]) anchorsBySheetName[meta.sheetName] = [];
                        anchorsBySheetName[meta.sheetName].push(desc);
                    }
                }
            }
        }
    } catch (error) {
        console.error('[FastExtractor] Drawing anchor parse error:', error.message);
    }

    return { anchorsBySheetId, anchorsBySheetName, mediaEntriesByName };
}

async function uploadMatchedMedia(matchedCandidates, mediaEntriesByName, imagesDir, onBlobCreated = null) {
    const neededMediaNames = new Set();
    for (const candidate of matchedCandidates) {
        for (const colMap of candidate.matchedAnchorsByRow.values()) {
            for (const anchorList of colMap.values()) {
                for (const anchor of anchorList) {
                    if (anchor.mediaFileName && mediaEntriesByName[anchor.mediaFileName]) {
                        neededMediaNames.add(anchor.mediaFileName);
                    }
                }
            }
        }
    }

    if (neededMediaNames.size === 0) return {};

    if (!fsSync.existsSync(imagesDir)) {
        await fs.mkdir(imagesDir, { recursive: true });
    }

    const savedImages = {};
    const timestamp = Date.now();
    const mediaList = Array.from(neededMediaNames);
    const BATCH_SIZE = process.env.VERCEL === '1' ? 10 : 5;

    for (let i = 0; i < mediaList.length; i += BATCH_SIZE) {
        const batch = mediaList.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (fileName) => {
            const entry = mediaEntriesByName[fileName];
            let data = entry.getData();
            let currentFileName = fileName;

            if (fileName.toLowerCase().match(/\.(emf|wmf)$/)) {
                const tempInputPath = path.join(imagesDir, `temp_${timestamp}_${fileName}`);
                try {
                    fsSync.writeFileSync(tempInputPath, data);
                    const pngPath = await convertEmfToPng(tempInputPath);
                    if (pngPath && fsSync.existsSync(pngPath)) {
                        data = fsSync.readFileSync(pngPath);
                        currentFileName = path.basename(pngPath).replace(/^temp_/, '');
                        try { fsSync.unlinkSync(tempInputPath); } catch (e) { }
                        try { fsSync.unlinkSync(pngPath); } catch (e) { }
                    } else {
                        try { if (fsSync.existsSync(tempInputPath)) fsSync.unlinkSync(tempInputPath); } catch (e) { }
                    }
                } catch (err) {
                    console.error(`[FastExtractor] Error during EMF conversion for ${fileName}:`, err.message);
                }
            }

            const isVercel = process.env.VERCEL === '1';
            const forceCloudUpload = process.env.FORCE_CLOUD_IMAGE_UPLOAD === '1';
            if (!isVercel && !forceCloudUpload) {
                const targetName = `${timestamp}_${currentFileName}`;
                const targetPath = path.join(imagesDir, targetName);
                try {
                    fsSync.writeFileSync(targetPath, data);
                    const localUrl = `/uploads/images/${targetName}`;
                    savedImages[fileName] = localUrl;
                    if (onBlobCreated) onBlobCreated({ url: localUrl, path: targetPath, bucket: 'local' });
                    return;
                } catch (localErr) {
                    console.error(`[FastExtractor] Failed to save local image for ${fileName}:`, localErr.message);
                }
            }

            let directUrl = null;
            const bucketName = 'assets';
            const supabasePath = `extracted-images/${timestamp}_${currentFileName}`;

            if (supabase) {
                try {
                    const { url, path: uploadedPath } = await uploadToSupabase(
                        bucketName,
                        supabasePath,
                        data,
                        {
                            contentType: currentFileName.toLowerCase().endsWith('.png')
                                ? 'image/png'
                                : (currentFileName.toLowerCase().match(/\.(jpg|jpeg)$/) ? 'image/jpeg' : 'application/octet-stream'),
                            cacheControl: '3600'
                        }
                    );
                    if (url) {
                        directUrl = url;
                        if (onBlobCreated) onBlobCreated({ url: directUrl, path: uploadedPath, bucket: bucketName });
                    }
                } catch (supabaseErr) {
                    console.error(`[FastExtractor] Supabase upload failed for ${currentFileName}:`, supabaseErr.message);
                }
            }

            if (!directUrl && process.env.JS_SCRAPER_SERVICE_URL) {
                try {
                    const response = await axios.post(`${process.env.JS_SCRAPER_SERVICE_URL}/upload-media`, {
                        image: data.toString('base64'),
                        filename: currentFileName
                    }, { timeout: 15000 });
                    if (response.data && response.data.url) {
                        directUrl = process.env.JS_SCRAPER_SERVICE_URL + response.data.url;
                    }
                } catch (eRail) {
                    console.warn(`[FastExtractor] Railway sidecar upload failed for ${currentFileName}:`, eRail.message);
                }
            }

            if (directUrl) {
                savedImages[fileName] = directUrl;
                return;
            }

            const targetName = `${timestamp}_${currentFileName}`;
            const targetPath = path.join(imagesDir, targetName);
            try {
                fsSync.writeFileSync(targetPath, data);
                savedImages[fileName] = `/uploads/images/${targetName}`;
            } catch (localErr) {
                console.error(`[FastExtractor] Failed to save local image for ${fileName}:`, localErr.message);
            }
        }));
    }

    return savedImages;
}

// ──────────────────────────────────────────────────────────────────────────────
// Workbook Readers (Low-Memory SheetJS Dense + Streaming ExcelJS Fallback)
// ──────────────────────────────────────────────────────────────────────────────

async function readWorkbookSheets(filePath) {
    try {
        const wb = XLSX.readFile(filePath, {
            cellStyles: false,
            cellHTML: false,
            cellFormula: false,
            dense: true
        });
        const sheetMeta = wb.Workbook?.Sheets || [];
        const sheetsData = wb.SheetNames.map((name, idx) => {
            const meta = sheetMeta[idx];
            const state = meta?.Hidden === 1 ? 'hidden' : (meta?.Hidden === 2 ? 'veryHidden' : 'visible');
            const parsedId = meta?.sheetId ? parseInt(meta.sheetId, 10) : NaN;
            const sheetId = Number.isFinite(parsedId) ? parsedId : (idx + 1);
            const ws = wb.Sheets[name];
            const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
            const rows = [];
            for (let r = 0; r < rawRows.length; r++) {
                const cells = (rawRows[r] || []).map(v => String(v ?? '').trim());
                if (cells.some(Boolean)) {
                    rows.push({ rowNumber: r + 1, cells });
                }
            }
            return {
                name,
                sheetId,
                state,
                rows
            };
        });

        return sheetsData;
    } catch (sheetJsErr) {
        console.warn(`[FastExtractor] SheetJS dense readFile failed (${sheetJsErr.message}), falling back to ExcelJS streaming WorkbookReader.`);
        const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
            sharedStrings: 'cache',
            hyperlinks: 'ignore',
            styles: 'ignore',
            worksheets: 'emit'
        });
        const sheetsData = [];
        let order = 0;
        for await (const ws of workbookReader) {
            order++;
            const rows = [];
            for await (const row of ws) {
                if (!row.values || row.values.length === 0) continue;
                const cells = row.values.slice(1).map(extractText);
                if (cells.some(Boolean)) {
                    rows.push({ rowNumber: row.number, cells });
                }
            }
            sheetsData.push({
                name: ws.name || `Sheet${order}`,
                sheetId: ws.id || order,
                state: ws.state || 'visible',
                rows
            });
        }
        return sheetsData;
    }
}

/**
 * Universal Excel BOQ extraction:
 * - Skips cover pages, TOC/index sheets, notes sheets, hidden sheets, and bill-summary sheets
 * - Consolidates single-row and 2-row merged headers and trims leading/trailing margin columns
 * - Strips pre-table metadata, post-table terms/signatures/totals, in-table subtotals, page numbers, and section banners
 * - Aligns multi-sheet columns by BOQ role and header name
 * - Filters out cover/header logos and footer stamps before uploading only matched product images
 */
async function extractExcelData(filePath, progressCallback = () => { }, onBlobCreated = null) {
    try {
        await fs.access(filePath);

        let fd;
        try {
            fd = await fs.open(filePath, 'r');
        } catch (openErr) {
            console.error(`[FastExtractor] Failed to open file at ${filePath}:`, openErr);
            throw new Error(`Could not open Excel file for reading. It may be locked or removed.`);
        }

        const buffer = Buffer.alloc(8);
        await fd.read(buffer, 0, 8, 0);
        await fd.close();

        // CFBF signature: D0 CF 11 E0 A1 B1 1A E1
        if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) {
            console.log(`[FastExtractor] Legacy .xls detected. Attempting high-fidelity conversion...`);
            try {
                const convertedPath = await convertXlsToXlsx(filePath);
                return await extractExcelData(convertedPath, progressCallback, onBlobCreated);
            } catch (convErr) {
                console.warn(`[FastExtractor] High-fidelity conversion failed, falling back to basic extractor:`, convErr.message);
                return await extractLegacyExcelData(filePath);
            }
        }
    } catch (err) {
        console.error('[FastExtractor] Error in extractExcelData:', err);
        const enrichedError = new Error(`Excel extraction failed at path: ${filePath}. Original Error: ${err.message}. Code: ${err.code || 'N/A'}`);
        enrichedError.code = err.code;
        enrichedError.stack = err.stack;
        throw enrichedError;
    }

    const isVercel = process.env.VERCEL === '1';
    const imagesDir = isVercel ? '/tmp/uploads/images' : path.join(__dirname, '../uploads/images');

    progressCallback(15);

    // Parse sequentially so SheetJS workbook buffers can be reclaimed before opening AdmZip
    const sheetsData = await readWorkbookSheets(filePath);
    progressCallback(30);
    const anchorData = await parseDrawingAnchors(filePath);
    progressCallback(50);

    // Filter sheets & rows first so non-product figures (cover logos, banners, stamps) are excluded before uploading
    const preResult = extractCleanBoqTablesFromMatrix(sheetsData, {
        anchorsBySheetId: anchorData.anchorsBySheetId,
        anchorsBySheetName: anchorData.anchorsBySheetName
    });

    if (preResult.matchedCandidates.length > 0 && Object.keys(anchorData.mediaEntriesByName).length > 0) {
        const savedImages = await uploadMatchedMedia(
            preResult.matchedCandidates,
            anchorData.mediaEntriesByName,
            imagesDir,
            onBlobCreated
        );
        anchorData.mediaEntriesByName = null;

        for (const candidate of preResult.matchedCandidates) {
            for (const colMap of candidate.matchedAnchorsByRow.values()) {
                for (const anchorList of colMap.values()) {
                    for (const anchor of anchorList) {
                        if (savedImages[anchor.mediaFileName]) {
                            anchor.uploadedUrl = savedImages[anchor.mediaFileName];
                        }
                    }
                }
            }
        }

        // Re-materialize rows now that matched anchors have uploadedUrl populated
        const materializedWithImages = preResult.matchedCandidates.map(c => ({
            sheetName: c.sheetName,
            header: c.header,
            rows: c.rows.map((r, rIdx) => {
                const colMap = c.matchedAnchorsByRow.get(rIdx);
                return {
                    cells: r.cells.map((val, cIdx) => {
                        const cellAnchors = colMap?.get(cIdx) || [];
                        const imgs = cellAnchors
                            .filter(a => a.uploadedUrl)
                            .map(a => ({
                                url: a.uploadedUrl,
                                extension: path.extname(a.mediaFileName || '').substring(1)
                            }));
                        return {
                            value: val || '',
                            images: imgs,
                            isMerged: false,
                            image: imgs.length > 0 ? imgs[0] : null
                        };
                    }),
                    isHeader: false,
                    isSummary: false
                };
            })
        }));

        const stitchedWithImages = stitchSheetTables(materializedWithImages);
        progressCallback(100);
        return {
            tables: stitchedWithImages,
            totalTables: stitchedWithImages.length
        };
    }

    progressCallback(100);
    return {
        tables: preResult.tables,
        totalTables: preResult.totalTables
    };
}

export { extractExcelData, extractCleanBoqTablesFromMatrix };
