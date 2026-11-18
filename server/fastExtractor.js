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
    { role: 'desc', pattern: /\b(description|desc\.?|particulars?|item\s*description|work\s*description|material\s*description|product\s*name|item\s*name|furniture\s*description|boq\s*description|scope)\b/i },
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

function validateBoqHeader(header) {
    const nonEmpty = header.map(h => String(h || '').trim()).filter(Boolean);
    if (nonEmpty.length < 3) return false;

    const roles = [];
    let prevRole = null;
    for (const h of header) {
        const r = getColumnRole(h, prevRole);
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
    if (!validateBoqHeader(header)) return null;

    return {
        header,
        firstCol,
        lastCol,
        headerEndIdx: hasSubHeader ? idx + 1 : idx
    };
}

function buildRoleIndices(header) {
    const roles = [];
    const byRole = {};
    let prevRole = null;
    for (let i = 0; i < header.length; i++) {
        const role = getColumnRole(header[i], prevRole) || 'other';
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
        return v !== '' && v.length <= 20;
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

    if (allIdentical) {
        const unifiedRows = [];
        for (const t of sheetTables) unifiedRows.push(...t.rows);
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

        for (let i = 0; i < rows.length; i++) {
            const detected = detectHeaderAt(rows, i);
            if (!detected) continue;

            const candidateRoleInfo = buildRoleIndices(detected.header);
            const candidateRows = [];

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

                if (!isValidBoqDataRow(slicedCells, candidateRoleInfo, rowHasPotentialAnchor)) continue;

                candidateRows.push({
                    rowNumber: rawRow.rowNumber,
                    cells: slicedCells
                });
            }

            if (candidateRows.length > 0) {
                headerMatch = detected;
                roleInfo = candidateRoleInfo;
                preAnchoredRows = candidateRows;
                break;
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
                        try { fsSync.unlinkSync(tempInputPath); } catch (e) {}
                        try { fsSync.unlinkSync(pngPath); } catch (e) {}
                    } else {
                        try { if (fsSync.existsSync(tempInputPath)) fsSync.unlinkSync(tempInputPath); } catch (e) {}
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

            if (!directUrl) {
                try {
                    const form = new FormData();
                    form.append('key', '6d207e02198a847aa98d0a2a901485a5');
                    form.append('action', 'upload');
                    form.append('source', data.toString('base64'));
                    form.append('format', 'json');
                    const res1 = await axios.post('https://freeimage.host/api/1/upload', form, { headers: form.getHeaders() });
                    if (res1.status === 200 && res1.data && res1.data.image) directUrl = res1.data.image.url;
                } catch (e1) {
                    console.warn(`[FastExtractor] Provider 1 (FreeImage) failed for ${fileName}, falling back to local.`);
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
