/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  BOQFLOW — Brand-Grouped Factory RFQ Export Engine                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Splits any BOQ (from TableViewer or MultiBudgetModal) into separate,
 * ready-to-send Supplier Request For Quotation (RFQ) Excel workbooks —
 * one clean .xlsx per brand (with embedded product images, live =QTY*PRICE
 * formulas, editable supplier input columns, and zero client-margin leakage)
 * plus a 00_RFQ_Master_Summary.xlsx tracker bundled into a single .zip pack.
 */

import { extractImageUrl, getFullUrl, loadExportImageData } from './urlUtils';

const UNASSIGNED_BRAND = 'Unassigned / For Sourcing';

const INVALID_BRAND_VALUES = new Set([
    '', '-', '--', 'n/a', 'na', 'none', 'nil', 'tbd', 'tbc', 'null', 'undefined',
    'unknown', 'generic', 'local', 'custom', 'approved', 'as specified', 'standard',
    'brand', 'maker', 'manufacturer', 'supplier', 'origin'
]);

function sanitizeFilenamePart(str = '') {
    return String(str || '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 42) || 'General';
}

function parseNumericQty(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    const cleaned = String(raw || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return cleaned ? parseFloat(cleaned[0]) : 0;
}

function calcFitSize(imgW, imgH, maxW, maxH) {
    if (!imgW || !imgH) return { w: maxW, h: maxH };
    const ratio = Math.min(maxW / imgW, maxH / imgH);
    return { w: Math.round(imgW * ratio), h: Math.round(imgH * ratio) };
}

function normalizeColorArgb(hexOrRgb, fallback = '0F3E67') {
    if (!hexOrRgb || typeof hexOrRgb !== 'string') return fallback;
    const raw = hexOrRgb.trim();
    if (raw.startsWith('#')) {
        const clean = raw.slice(1).toUpperCase();
        if (clean.length === 6 && /^[0-9A-F]{6}$/.test(clean)) return clean;
        if (clean.length === 3 && /^[0-9A-F]{3}$/.test(clean)) {
            return clean.split('').map(c => c + c).join('');
        }
    }
    const rgbMatch = raw.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        return [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
            .map(n => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase();
    }
    return fallback;
}

function cleanBrandCandidate(raw = '') {
    let s = String(raw || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    // Strip leading labels like "Brand: " or "Manufacturer - "
    s = s.replace(/^(?:brand|manufacturer|maker|make|supplier|proposed\s*brand)\s*[:\-]\s*/i, '').trim();
    // Strip trailing country/origin parenthetical or pipe metadata
    s = s.split(/\s*\|\s*/)[0].trim();
    s = s.replace(/\s*\([^)]*(?:italy|germany|lithuania|turkey|spain|france|usa|uk|uae|china|czech|switzerland|canada|denmark|poland|europe)[^)]*\)\s*$/i, '').trim();
    // Strip trailing " - Model..." if clearly separated
    if (s.includes(' — ')) s = s.split(' — ')[0].trim();
    if (/^\d+(?:[.,]\d+)?$/.test(s)) return '';
    if (s.length < 2 || s.length > 60) return '';
    if (INVALID_BRAND_VALUES.has(s.toLowerCase())) return '';
    return s;
}

function buildCanonicalBrandLookup(allBrands = []) {
    const byKey = new Map();
    const sortedNames = [];
    for (const b of (Array.isArray(allBrands) ? allBrands : [])) {
        const name = String(b?.name || '').trim();
        if (!name || name.length < 2) continue;
        const key = name.toLowerCase();
        if (!byKey.has(key)) {
            byKey.set(key, name);
            sortedNames.push(name);
        }
    }
    // Match longer multi-word brand names before shorter substrings
    sortedNames.sort((a, b) => b.length - a.length);
    return { byKey, sortedNames };
}

function resolveCanonicalBrand(rawBrand, descText = '', modelText = '', brandLookup = { byKey: new Map(), sortedNames: [] }) {
    const direct = cleanBrandCandidate(rawBrand);
    if (direct) {
        const exact = brandLookup.byKey.get(direct.toLowerCase());
        if (exact) return exact;
        // Check if direct string contains a known catalog brand name
        for (const known of brandLookup.sortedNames) {
            const escaped = known.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(direct)) {
                return known;
            }
        }
        return direct;
    }

    const combined = `${modelText || ''}\n${descText || ''}`;

    // Explicit labeled tags in specification text
    const labelMatch = combined.match(/(?:^|\n|\|)\s*(?:proposed\s*brand|brand|manufacturer|maker|make|supplier)\s*[:\-]\s*([^\|\n,;]{2,48})/i);
    if (labelMatch) {
        const cleaned = cleanBrandCandidate(labelMatch[1]);
        if (cleaned) {
            return brandLookup.byKey.get(cleaned.toLowerCase()) || cleaned;
        }
    }

    // Match against known catalog brands by whole-token boundary
    if (combined.trim()) {
        for (const known of brandLookup.sortedNames) {
            if (known.length < 3) continue;
            const escaped = known.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(combined)) {
                return known;
            }
        }
    }

    return UNASSIGNED_BRAND;
}

function extractModelFromDescription(desc = '', brand = '') {
    const text = String(desc || '');
    const m = text.match(/(?:^|\n|\|)\s*(?:model|series|collection|product\s*code|item\s*code|code|sku)\s*[:\-]\s*([^\|\n]{2,60})/i);
    if (m) return m[1].trim();
    if (brand && brand !== UNASSIGNED_BRAND) {
        const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pair = text.match(new RegExp(`${escaped}\\s*[-–—:/]\\s*([^\\|\\n]{2,55})`, 'i'));
        if (pair) return pair[1].trim();
    }
    return '';
}

function getCellValueText(cell) {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'object') return String(cell.value ?? '').trim();
    return String(cell).trim();
}

function extractCellFirstImageUrl(cell) {
    if (!cell || typeof cell !== 'object') return '';
    const list = Array.isArray(cell.images) && cell.images.length > 0
        ? cell.images
        : (cell.image ? [cell.image] : []);
    for (const item of list) {
        const u = extractImageUrl(item);
        if (u) return u;
    }
    return '';
}

/**
 * Extracts normalized RFQ items grouped by canonical brand from TableViewer `tables`.
 */
export function groupTableViewerItemsByBrand(tables = [], allBrands = []) {
    const brandLookup = buildCanonicalBrandLookup(allBrands);
    const groupsMap = new Map(); // lowerKey -> { brand, items: [] }

    const pushItem = (brandName, item) => {
        const key = brandName.toLowerCase().trim();
        if (!groupsMap.has(key)) {
            groupsMap.set(key, { brand: brandName, items: [] });
        }
        groupsMap.get(key).items.push(item);
    };

    let globalSeq = 0;

    for (const table of (Array.isArray(tables) ? tables : [])) {
        const header = Array.isArray(table?.header) ? table.header : [];
        const rows = Array.isArray(table?.rows) ? table.rows : [];
        if (rows.length === 0) continue;

        const snColIdx = header.findIndex(h => /^(s\.?n\.?|sl\.?|sr\.?|no\.?|#|item\s*no\.?)$/i.test(String(h || '').trim()) || /\b(s\.?n|sl|sr\.?\s*no|item\s*#)\b/i.test(String(h || '')));
        const descColIdx = header.findIndex(h => /\b(description|desc|specification|specs|item\s*desc|product\s*desc|particulars)\b/i.test(String(h || '')));
        const brandColIdx = header.findIndex(h => /\b(brand|maker|manufacturer|supplier|make|proposed\s*brand)\b/i.test(String(h || '')));
        const modelColIdx = header.findIndex(h => /\b(model|series|collection|code|sku|item\s*code|ref)\b/i.test(String(h || '')) && !/image|photo|pic/i.test(String(h || '')));
        const qtyColIdx = header.findIndex(h => /\b(qty|quantity|qt|nos\.?)\b/i.test(String(h || '')) && !/total|amount|rate|price/i.test(String(h || '')));
        const uomColIdx = header.findIndex(h => /\b(uom|unit)\b/i.test(String(h || '')) && !/price|rate/i.test(String(h || '')));
        const locColIdx = header.findIndex(h => /\b(location|room|area|zone|floor|space|department)\b/i.test(String(h || '')));

        let imgColIdx = header.findIndex(h => /\b(brand\s*img|brand\s*image|proposed\s*image|image|photo|picture|img|pic|illustration|drawing)\b/i.test(String(h || '')));
        if (imgColIdx === -1) {
            for (let c = 0; c < header.length; c++) {
                if (rows.some(r => extractCellFirstImageUrl(r?.cells?.[c]))) {
                    imgColIdx = c;
                    break;
                }
            }
        }

        const effectiveDescIdx = descColIdx >= 0
            ? descColIdx
            : header.findIndex((_, idx) => idx !== snColIdx && idx !== imgColIdx && idx !== qtyColIdx && idx !== uomColIdx && idx !== brandColIdx);

        for (const row of rows) {
            if (!row || row.isHeader || row.isSummary || row.isOptionRow || row.isSetSubItem) continue;
            const cells = Array.isArray(row.cells) ? row.cells : [];

            const sn = snColIdx >= 0 ? getCellValueText(cells[snColIdx]) : '';
            const rawDesc = effectiveDescIdx >= 0 ? getCellValueText(cells[effectiveDescIdx]) : '';
            const rawBrandCell = brandColIdx >= 0 ? getCellValueText(cells[brandColIdx]) : '';
            const rawModelCell = modelColIdx >= 0 ? getCellValueText(cells[modelColIdx]) : '';
            const qtyVal = qtyColIdx >= 0 ? parseNumericQty(getCellValueText(cells[qtyColIdx])) : 1;
            const unitVal = uomColIdx >= 0 ? (getCellValueText(cells[uomColIdx]) || 'Nos') : 'Nos';
            const locationVal = locColIdx >= 0
                ? getCellValueText(cells[locColIdx])
                : (row.location || row.sectionLabel || '');

            // Skip empty / divider / total rows
            const descClean = rawDesc.trim();
            if (!descClean && !rawModelCell && !rawBrandCell) continue;
            if (/^(sub\s*total|subtotal|grand\s*total|total\s*amount|vat\s*\(|total\b)/i.test(descClean) && !rawBrandCell) continue;

            // Find best image (prefer dedicated image column, else first cell with an image)
            let imageUrl = imgColIdx >= 0 ? extractCellFirstImageUrl(cells[imgColIdx]) : '';
            if (!imageUrl) {
                for (const cell of cells) {
                    const candidate = extractCellFirstImageUrl(cell);
                    if (candidate) { imageUrl = candidate; break; }
                }
            }

            // If this TableViewer row carries rolled-up Furniture Set components, decompose into real component RFQs
            if (row.setType && row.setType !== 'single' && Array.isArray(row.setItems) && row.setItems.length > 0) {
                globalSeq += 1;
                const parentRef = sn || String(globalSeq);
                const parentQty = qtyVal > 0 ? qtyVal : 1;
                row.setItems.forEach((sub, sIdx) => {
                    if (!sub || sub.aiResult?.product?.includedInSystem) return;
                    const subDesc = String(sub.brandDesc || sub.description || sub.label || '').trim();
                    const subModel = String(sub.selectedModel || '').trim();
                    const brand = resolveCanonicalBrand(sub.selectedBrand || row.selectedBrand || rawBrandCell, subDesc, subModel, brandLookup);
                    const rawSubQty = parseNumericQty(sub.qty);
                    const perSetQty = rawSubQty > 0 ? rawSubQty : 1;
                    const totalSubQty = Math.max(1, Math.ceil(perSetQty * parentQty - 1e-9));
                    const setNote = descClean ? ` [Part of Set: ${descClean.split('\n')[0].slice(0, 55)}]` : '';
                    pushItem(brand, {
                        boqRef: `${parentRef}.${sIdx + 1}`,
                        location: locationVal,
                        brand,
                        model: subModel || sub.label || '',
                        description: `${subDesc || sub.label || 'Set Component'}${setNote}`,
                        qty: totalSubQty,
                        unit: sub.unit || 'Nos',
                        imageUrl: extractImageUrl(sub.brandImage) || imageUrl
                    });
                });
                continue;
            }

            const rowBrandMeta = row.selectedBrand || row.brand || row.matchedBrand || rawBrandCell;
            const brand = resolveCanonicalBrand(rowBrandMeta, descClean, rawModelCell, brandLookup);
            const model = (row.selectedModel || rawModelCell || extractModelFromDescription(descClean, brand) || '').trim();

            globalSeq += 1;
            pushItem(brand, {
                boqRef: sn || String(globalSeq),
                location: locationVal,
                brand,
                model,
                description: descClean || model,
                qty: qtyVal > 0 ? qtyVal : 1,
                unit: unitVal || 'Nos',
                imageUrl
            });
        }
    }

    return sortBrandGroups(Array.from(groupsMap.values()));
}

/**
 * Extracts normalized RFQ items grouped by canonical brand from MultiBudgetModal tier rows.
 * Automatically decomposes multi-component Furniture Sets into per-brand supplier line items.
 */
export function groupMultiBudgetRowsByBrand(rows = [], allBrands = []) {
    const brandLookup = buildCanonicalBrandLookup(allBrands);
    const groupsMap = new Map();

    const pushItem = (brandName, item) => {
        const key = brandName.toLowerCase().trim();
        if (!groupsMap.has(key)) {
            groupsMap.set(key, { brand: brandName, items: [] });
        }
        groupsMap.get(key).items.push(item);
    };

    let idxCounter = 0;
    for (const row of (Array.isArray(rows) ? rows : [])) {
        if (!row) continue;
        idxCounter += 1;
        const parentSn = String(row.sn || idxCounter);
        const parentQty = Math.max(1, parseNumericQty(row.qty) || 1);
        const isSet = row.setType && row.setType !== 'single' && Array.isArray(row.setItems) && row.setItems.length > 0;

        if (isSet) {
            row.setItems.forEach((sub, sIdx) => {
                // Accessories bundled inside the anchor SKU (includedInSystem) are not quoted separately
                if (!sub || sub.aiResult?.product?.includedInSystem) return;
                const subDesc = String(sub.brandDesc || sub.description || sub.label || '').trim();
                const subModel = String(sub.selectedModel || '').trim();
                const brand = resolveCanonicalBrand(sub.selectedBrand || row.selectedBrand, subDesc, subModel, brandLookup);
                // Preserve shared fractional quantities (e.g. 0.5 shared screen × 30 positions = 15, not 30)
                const rawSubQty = parseNumericQty(sub.qty);
                const perSetQty = rawSubQty > 0 ? rawSubQty : 1;
                const subQty = Math.max(1, Math.ceil(perSetQty * parentQty - 1e-9));
                const setNote = row.description ? ` [Part of Set: ${String(row.description).slice(0, 55)}]` : '';

                pushItem(brand, {
                    boqRef: `${parentSn}.${sIdx + 1}`,
                    location: row.location || '',
                    brand,
                    model: subModel || sub.label || '',
                    description: `${subDesc || sub.label || 'Set Component'}${setNote}`,
                    qty: subQty,
                    unit: sub.unit || 'Nos',
                    imageUrl: extractImageUrl(sub.brandImage) || extractImageUrl(row.brandImage) || extractImageUrl(row.imageRef)
                });
            });
            continue;
        }

        const desc = String(row.brandDesc || row.description || '').trim();
        const model = String(row.selectedModel || '').trim();
        const brand = resolveCanonicalBrand(row.selectedBrand, desc, model, brandLookup);
        if (!desc && !model && brand === UNASSIGNED_BRAND) continue;

        const imageUrl = extractImageUrl(row.brandImage)
            || extractImageUrl(row.imageRef)
            || (Array.isArray(row.imageRefs) ? extractImageUrl(row.imageRefs[0]) : '');

        pushItem(brand, {
            boqRef: parentSn,
            location: row.location || '',
            brand,
            model: model || extractModelFromDescription(desc, brand),
            description: desc || model,
            qty: parentQty,
            unit: row.unit || 'Nos',
            imageUrl
        });
    }

    return sortBrandGroups(Array.from(groupsMap.values()));
}

function sortBrandGroups(groups = []) {
    return groups
        .filter(g => g.items.length > 0)
        .sort((a, b) => {
            if (a.brand === UNASSIGNED_BRAND) return 1;
            if (b.brand === UNASSIGNED_BRAND) return -1;
            if (b.items.length !== a.items.length) return b.items.length - a.items.length;
            return a.brand.localeCompare(b.brand);
        });
}

/**
 * Builds one standalone, factory-ready RFQ Excel workbook buffer for a single brand.
 */
async function buildSingleBrandRfqBuffer(ExcelJS, group, {
    project = {},
    companyName = '',
    companyLogoData = null,
    primaryArgb = '0F3E67',
    accentArgb = 'D97706',
    imageCache = null
} = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = companyName || 'BOQFLOW';
    workbook.created = new Date();

    const safeTab = group.brand.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 28) || 'RFQ';
    const ws = workbook.addWorksheet(`RFQ - ${safeTab}`, {
        views: [{ state: 'frozen', ySplit: 9 }],
        pageSetup: {
            orientation: 'landscape',
            paperSize: 9, // A4
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0
        }
    });

    const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rfqCode = `RFQ-${sanitizeFilenamePart(group.brand).toUpperCase().slice(0, 12)}-${dateStamp}`;
    const totalQty = group.items.reduce((acc, it) => acc + (parseFloat(it.qty) || 0), 0);

    // Column definitions (12 clean supplier columns — zero client selling price / margin leaked)
    ws.columns = [
        { key: 'sl', width: 6 },
        { key: 'boqRef', width: 11 },
        { key: 'location', width: 16 },
        { key: 'image', width: 16 },
        { key: 'model', width: 22 },
        { key: 'description', width: 44 },
        { key: 'qty', width: 9 },
        { key: 'unit', width: 8 },
        { key: 'unitPrice', width: 16 },
        { key: 'totalPrice', width: 17 },
        { key: 'leadTime', width: 15 },
        { key: 'remarks', width: 26 }
    ];

    // ── ROW 1-2: Branded Header Banner ──
    ws.mergeCells('A1:J1');
    ws.getRow(1).height = 28;
    const bannerCell = ws.getCell('A1');
    bannerCell.value = `REQUEST FOR QUOTATION (RFQ) — ${group.brand.toUpperCase()}`;
    bannerCell.font = { name: 'Calibri', bold: true, size: 15, color: { argb: 'FFFFFF' } };
    bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
    bannerCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    ws.mergeCells('K1:L2');
    for (const addr of ['K1', 'L1', 'K2', 'L2']) {
        ws.getCell(addr).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
    }

    ws.mergeCells('A2:J2');
    ws.getRow(2).height = 20;
    const subBanner = ws.getCell('A2');
    subBanner.value = `${companyName || 'Commercial FF&E Procurement'}  |  Supplier Quotation Sheet  |  Ref: ${rfqCode}`;
    subBanner.font = { name: 'Calibri', italic: true, size: 10, color: { argb: 'E2E8F0' } };
    subBanner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
    subBanner.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    if (companyLogoData?.dataUrl) {
        try {
            const logoId = workbook.addImage({
                base64: companyLogoData.dataUrl.split(',')[1],
                extension: 'png'
            });
            const fit = calcFitSize(companyLogoData.width, companyLogoData.height, 140, 42);
            ws.addImage(logoId, {
                tl: { col: 10.15, row: 0.15 },
                ext: { width: fit.w, height: fit.h }
            });
        } catch { /* non-fatal */ }
    }

    // ── ROW 4-6: Project & RFQ Metadata Block (No confidential client pricing!) ──
    const metaRows = [
        ['Target Brand / Factory:', group.brand, 'RFQ Reference:', rfqCode, 'Issue Date:', todayStr],
        ['Project Name:', project.projectName || 'Commercial FF&E Tender', 'Project Location:', project.projectLocation || '—', 'Line Items:', `${group.items.length} items (${totalQty} units)`],
        ['Issued By:', companyName || project.companyName || 'Estimation Team', 'Requested Currency:', 'EUR / USD / AED (Specify below)', 'Required Incoterms:', 'EXW / CIF (Specify below)']
    ];

    ws.getRow(3).height = 6;
    metaRows.forEach((m, idx) => {
        const rNum = 4 + idx;
        const r = ws.getRow(rNum);
        r.height = 19;
        ws.mergeCells(rNum, 1, rNum, 2);
        ws.mergeCells(rNum, 3, rNum, 5);
        ws.mergeCells(rNum, 7, rNum, 8);
        ws.mergeCells(rNum, 10, rNum, 12);

        const pairs = [
            [1, m[0], true], [3, m[1], false],
            [6, m[2], true], [7, m[3], false],
            [9, m[4], true], [10, m[5], false]
        ];
        pairs.forEach(([col, val, isLabel]) => {
            const c = r.getCell(col);
            c.value = val;
            c.font = isLabel
                ? { bold: true, size: 9.5, color: { argb: primaryArgb } }
                : { bold: col === 3 && idx === 0, size: 9.5, color: { argb: '0F172A' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isLabel ? 'F1F5F9' : 'FFFFFF' } };
            c.alignment = { vertical: 'middle', horizontal: 'left', indent: 0.5 };
        });
        for (let col = 1; col <= 12; col++) {
            r.getCell(col).border = {
                top: { style: 'thin', color: { argb: 'CBD5E1' } },
                bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
                left: { style: 'thin', color: { argb: 'CBD5E1' } },
                right: { style: 'thin', color: { argb: 'CBD5E1' } }
            };
        }
    });

    // ── ROW 7-8: Supplier Fill Instructions ──
    ws.getRow(7).height = 6;
    ws.mergeCells('A8:L8');
    ws.getRow(8).height = 22;
    const instrCell = ws.getCell('A8');
    instrCell.value = 'SUPPLIER INSTRUCTIONS: Please fill in the yellow highlighted columns (Net Unit Price, Lead Time in Weeks, Finish / Remarks). Total Net Price calculates automatically (= Qty × Net Unit Price).';
    instrCell.font = { bold: true, size: 9.5, color: { argb: '92400E' } };
    instrCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
    instrCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    instrCell.border = {
        top: { style: 'thin', color: { argb: 'F59E0B' } },
        bottom: { style: 'thin', color: { argb: 'F59E0B' } },
        left: { style: 'thin', color: { argb: 'F59E0B' } },
        right: { style: 'thin', color: { argb: 'F59E0B' } }
    };

    // ── ROW 9: Table Header ──
    const headers = [
        'SL', 'BOQ Ref', 'Location / Room', 'Product Image', 'Model / Series',
        'Technical Specification / Description', 'Qty', 'Unit',
        'Net Unit Price', 'Total Net Price', 'Lead Time (Wks)', 'Finish / Supplier Remarks'
    ];
    const headerRow = ws.getRow(9);
    headerRow.height = 28;
    headers.forEach((h, i) => {
        const col = i + 1;
        const cell = headerRow.getCell(col);
        const isSupplierCol = col === 9 || col === 11 || col === 12;
        cell.value = h;
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isSupplierCol ? accentArgb : primaryArgb } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: '1E293B' } },
            bottom: { style: 'medium', color: { argb: '1E293B' } },
            left: { style: 'thin', color: { argb: '334155' } },
            right: { style: 'thin', color: { argb: '334155' } }
        };
    });

    // Preload product images in small parallel chunks (using Vercel-safe loadExportImageData)
    const loadedImages = new Array(group.items.length).fill(null);
    const CONCURRENCY = 6;
    for (let start = 0; start < group.items.length; start += CONCURRENCY) {
        const slice = group.items.slice(start, start + CONCURRENCY);
        const results = await Promise.all(
            slice.map(it => it.imageUrl
                ? loadExportImageData(getFullUrl(it.imageUrl), { maxWidth: 640, format: 'image/jpeg', quality: 0.9 }, imageCache).catch(() => null)
                : Promise.resolve(null))
        );
        results.forEach((res, offset) => {
            loadedImages[start + offset] = res;
        });
    }

    // ── DATA ROWS ──
    const firstDataRow = 10;
    group.items.forEach((item, idx) => {
        const rNum = firstDataRow + idx;
        const excelRow = ws.getRow(rNum);
        const imgData = loadedImages[idx];

        excelRow.getCell(1).value = idx + 1;
        excelRow.getCell(2).value = item.boqRef || '';
        excelRow.getCell(3).value = item.location || '';
        excelRow.getCell(4).value = ''; // Reserved for embedded image
        excelRow.getCell(5).value = item.model || '';
        excelRow.getCell(6).value = item.description || '';
        excelRow.getCell(7).value = parseFloat(item.qty) || 1;
        excelRow.getCell(8).value = item.unit || 'Nos';
        excelRow.getCell(9).value = null; // Editable factory Net Unit Price
        excelRow.getCell(10).value = { formula: `IF(ISNUMBER(I${rNum}),G${rNum}*I${rNum},0)` };
        excelRow.getCell(11).value = null; // Editable Lead Time (Weeks)
        excelRow.getCell(12).value = null; // Editable Finish / Remarks

        // Auto-size row height for image + wrapped description
        const descLines = Math.max(2, Math.ceil(String(item.description || '').length / 42) + (String(item.description || '').match(/\n/g) || []).length);
        const textHeight = descLines * 14 + 10;
        excelRow.height = Math.max(imgData ? 74 : 28, Math.min(180, textHeight));

        const zebraBg = idx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';
        for (let col = 1; col <= 12; col++) {
            const cell = excelRow.getCell(col);
            const isSupplierInput = col === 9 || col === 11 || col === 12;
            const isFormulaCol = col === 10;

            cell.font = {
                name: 'Calibri',
                size: 9.5,
                bold: col === 5 || col === 7 || isFormulaCol,
                color: { argb: isFormulaCol ? primaryArgb : '0F172A' }
            };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: isSupplierInput ? 'FEFCE8' : (isFormulaCol ? 'F1F5F9' : zebraBg) }
            };
            cell.border = {
                top: { style: 'thin', color: { argb: isSupplierInput ? 'F59E0B' : 'CBD5E1' } },
                bottom: { style: 'thin', color: { argb: isSupplierInput ? 'F59E0B' : 'CBD5E1' } },
                left: { style: 'thin', color: { argb: isSupplierInput ? 'F59E0B' : 'CBD5E1' } },
                right: { style: 'thin', color: { argb: isSupplierInput ? 'F59E0B' : 'CBD5E1' } }
            };

            if (col === 1 || col === 2 || col === 7 || col === 8 || col === 11) {
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            } else if (col === 9 || col === 10) {
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
                cell.numFmt = '#,##0.00';
            } else {
                cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            }
        }

        // Embed product photo in Column D (col index 3)
        if (imgData?.dataUrl) {
            try {
                const imgId = workbook.addImage({
                    base64: imgData.dataUrl.split(',')[1],
                    extension: 'jpeg'
                });
                const fit = calcFitSize(imgData.width, imgData.height, 98, 86);
                ws.addImage(imgId, {
                    tl: { col: 3.08, row: (rNum - 1) + 0.08 },
                    ext: { width: fit.w, height: fit.h },
                    editAs: 'oneCell'
                });
            } catch { /* non-fatal */ }
        }
    });

    const lastDataRow = firstDataRow + group.items.length - 1;

    // ── TOTALS ROW ──
    const totalRowNum = lastDataRow + 1;
    const totalRow = ws.getRow(totalRowNum);
    totalRow.height = 26;
    ws.mergeCells(totalRowNum, 1, totalRowNum, 6);
    totalRow.getCell(1).value = `TOTAL QUOTATION — ${group.brand.toUpperCase()} (${group.items.length} Line Items)`;
    totalRow.getCell(7).value = { formula: `SUM(G${firstDataRow}:G${lastDataRow})` };
    totalRow.getCell(8).value = 'Units';
    totalRow.getCell(9).value = 'NET TOTAL:';
    totalRow.getCell(10).value = { formula: `SUM(J${firstDataRow}:J${lastDataRow})` };
    totalRow.getCell(10).numFmt = '#,##0.00';
    ws.mergeCells(totalRowNum, 11, totalRowNum, 12);
    totalRow.getCell(11).value = 'Excl. VAT (specify currency below)';

    for (let col = 1; col <= 12; col++) {
        const c = totalRow.getCell(col);
        c.font = { bold: true, size: 10.5, color: { argb: 'FFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
        c.alignment = {
            vertical: 'middle',
            horizontal: (col === 10 || col === 9) ? 'right' : (col === 7 || col === 8 ? 'center' : 'left'),
            indent: col === 1 ? 1 : 0
        };
        c.border = {
            top: { style: 'medium', color: { argb: '0F172A' } },
            bottom: { style: 'medium', color: { argb: '0F172A' } },
            left: { style: 'thin', color: { argb: '334155' } },
            right: { style: 'thin', color: { argb: '334155' } }
        };
    }

    // ── COMMERCIAL TERMS BOX FOR SUPPLIER TO COMPLETE ──
    const termsHeaderNum = totalRowNum + 2;
    ws.mergeCells(termsHeaderNum, 1, termsHeaderNum, 12);
    const th = ws.getRow(termsHeaderNum);
    th.height = 22;
    th.getCell(1).value = 'SUPPLIER COMMERCIAL TERMS (TO BE COMPLETED BY MANUFACTURER / DISTRIBUTOR)';
    th.getCell(1).font = { bold: true, size: 10, color: { argb: primaryArgb } };
    th.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };
    th.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    const termPairs = [
        ['Quoted Currency (EUR / USD / AED):', '', 'Incoterms (EXW / FOB / CIF / DDP):', ''],
        ['Trade / Project Discount Applied (%):', '', 'Estimated CBM / Shipment Volume:', ''],
        ['Quote Validity (Days):', '', 'Payment Terms:', ''],
        ['Standard Warranty:', '', 'Supplier Contact Name & Email:', '']
    ];

    termPairs.forEach((pair, idx) => {
        const rNum = termsHeaderNum + 1 + idx;
        const r = ws.getRow(rNum);
        r.height = 20;
        ws.mergeCells(rNum, 1, rNum, 3);
        ws.mergeCells(rNum, 4, rNum, 6);
        ws.mergeCells(rNum, 7, rNum, 9);
        ws.mergeCells(rNum, 10, rNum, 12);

        r.getCell(1).value = pair[0];
        r.getCell(4).value = pair[1];
        r.getCell(7).value = pair[2];
        r.getCell(10).value = pair[3];

        for (let col = 1; col <= 12; col++) {
            const isInput = (col >= 4 && col <= 6) || (col >= 10 && col <= 12);
            const cell = r.getCell(col);
            cell.font = { bold: !isInput, size: 9.5, color: { argb: isInput ? '0F172A' : '334155' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isInput ? 'FEFCE8' : 'F8FAFC' } };
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 0.5 };
            cell.border = {
                top: { style: 'thin', color: { argb: isInput ? 'F59E0B' : 'CBD5E1' } },
                bottom: { style: 'thin', color: { argb: isInput ? 'F59E0B' : 'CBD5E1' } },
                left: { style: 'thin', color: { argb: isInput ? 'F59E0B' : 'CBD5E1' } },
                right: { style: 'thin', color: { argb: isInput ? 'F59E0B' : 'CBD5E1' } }
            };
        }
    });

    return await workbook.xlsx.writeBuffer();
}

/**
 * Builds the 00_RFQ_Master_Summary.xlsx tracker workbook bundled at the top of multi-brand RFQ ZIPs.
 */
async function buildMasterSummaryBuffer(ExcelJS, brandGroups, filenamesByBrand, {
    project = {},
    companyName = '',
    primaryArgb = '0F3E67'
} = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = companyName || 'BOQFLOW';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('RFQ Tracker Summary', {
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    ws.columns = [
        { width: 6 },
        { width: 26 },
        { width: 12 },
        { width: 12 },
        { width: 34 },
        { width: 14 },
        { width: 16 },
        { width: 16 },
        { width: 12 },
        { width: 16 }
    ];

    ws.mergeCells('A1:J1');
    ws.getRow(1).height = 28;
    const title = ws.getCell('A1');
    title.value = `BRAND RFQ DISPATCH & QUOTE TRACKER — ${project.projectName || 'BOQ TENDER'}`;
    title.font = { bold: true, size: 14, color: { argb: 'FFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    ws.mergeCells('A2:J2');
    ws.getRow(2).height = 19;
    ws.getCell('A2').value = `Generated: ${new Date().toLocaleDateString('en-GB')}  |  Total Brands: ${brandGroups.length}  |  Prepared By: ${companyName || 'Estimation Desk'}`;
    ws.getCell('A2').font = { italic: true, size: 9.5, color: { argb: '475569' } };

    const cols = ['#', 'Brand / Manufacturer', 'Line Items', 'Total Qty', 'RFQ Workbook File', 'Date Sent', 'Factory Quote Ref', 'Quoted Net Total', 'Currency', 'Status'];
    const hr = ws.getRow(4);
    hr.height = 24;
    cols.forEach((h, i) => {
        const c = hr.getCell(i + 1);
        c.value = h;
        c.font = { bold: true, size: 10, color: { argb: 'FFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
        c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    brandGroups.forEach((g, idx) => {
        const rNum = 5 + idx;
        const r = ws.getRow(rNum);
        r.height = 22;
        const qtySum = g.items.reduce((acc, it) => acc + (parseFloat(it.qty) || 0), 0);
        r.getCell(1).value = idx + 1;
        r.getCell(2).value = g.brand;
        r.getCell(3).value = g.items.length;
        r.getCell(4).value = qtySum;
        r.getCell(5).value = filenamesByBrand.get(g.brand) || '';
        r.getCell(6).value = '';
        r.getCell(7).value = '';
        r.getCell(8).value = null;
        r.getCell(9).value = '';
        r.getCell(10).value = 'Pending';

        for (let col = 1; col <= 10; col++) {
            const c = r.getCell(col);
            const isTrackCol = col >= 6;
            c.font = { size: 9.5, bold: col === 2, color: { argb: '0F172A' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isTrackCol ? 'FEFCE8' : (idx % 2 === 1 ? 'F8FAFC' : 'FFFFFF') } };
            c.alignment = { vertical: 'middle', horizontal: (col === 1 || col === 3 || col === 4 || col === 9 || col === 10) ? 'center' : (col === 8 ? 'right' : 'left') };
            if (col === 8) c.numFmt = '#,##0.00';
            c.border = {
                top: { style: 'thin', color: { argb: 'CBD5E1' } },
                bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
                left: { style: 'thin', color: { argb: 'CBD5E1' } },
                right: { style: 'thin', color: { argb: 'CBD5E1' } }
            };
        }
    });

    const lastRow = 4 + brandGroups.length;
    const tr = ws.getRow(lastRow + 1);
    tr.height = 24;
    tr.getCell(2).value = 'TOTAL';
    tr.getCell(3).value = { formula: `SUM(C5:C${lastRow})` };
    tr.getCell(4).value = { formula: `SUM(D5:D${lastRow})` };
    tr.getCell(8).value = { formula: `SUM(H5:H${lastRow})` };
    tr.getCell(8).numFmt = '#,##0.00';
    for (let col = 1; col <= 10; col++) {
        const c = tr.getCell(col);
        c.font = { bold: true, size: 10, color: { argb: 'FFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
        c.alignment = { vertical: 'middle', horizontal: col === 8 ? 'right' : (col === 3 || col === 4 ? 'center' : 'left') };
    }

    return await workbook.xlsx.writeBuffer();
}

/**
 * Generates and downloads the RFQ-by-Brand export (single .xlsx if 1 brand, or .zip pack with
 * per-brand .xlsx files + 00_RFQ_Master_Summary.xlsx if 2+ brands).
 */
async function executeBrandRfqDownload(brandGroups, {
    project = {},
    companyName = '',
    logoUrl = '',
    accentColor = '#0F3E67',
    secondaryColor = '#D97706',
    filenamePrefix = 'RFQ_By_Brand',
    imageCache = null
} = {}) {
    if (!brandGroups || brandGroups.length === 0) {
        alert('No BOQ line items found to group into Brand RFQs.');
        return { brandCount: 0, itemCount: 0 };
    }

    const ExcelJS = (await import('exceljs')).default;
    const { saveAs } = await import('file-saver');
    const primaryArgb = normalizeColorArgb(accentColor, '0F3E67');
    const accentArgb = normalizeColorArgb(secondaryColor, 'D97706');
    const dateStamp = new Date().toISOString().slice(0, 10);

    let companyLogoData = null;
    if (logoUrl) {
        companyLogoData = await loadExportImageData(logoUrl, { format: 'image/png', maxWidth: 500 }, imageCache).catch(() => null);
    }

    const totalItems = brandGroups.reduce((acc, g) => acc + g.items.length, 0);

    // Single brand -> direct .xlsx download (no zip wrapper needed)
    if (brandGroups.length === 1) {
        const g = brandGroups[0];
        const buffer = await buildSingleBrandRfqBuffer(ExcelJS, g, {
            project,
            companyName,
            companyLogoData,
            primaryArgb,
            accentArgb,
            imageCache
        });
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const fileName = `RFQ_${sanitizeFilenamePart(g.brand)}_${g.items.length}items_${dateStamp}.xlsx`;
        saveAs(blob, fileName);
        return { brandCount: 1, itemCount: totalItems, fileName };
    }

    // Multiple brands -> one .xlsx per brand + 00_RFQ_Master_Summary.xlsx inside a single .zip
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const filenamesByBrand = new Map();

    for (let i = 0; i < brandGroups.length; i++) {
        const g = brandGroups[i];
        const idxPrefix = String(i + 1).padStart(2, '0');
        const safeBrand = sanitizeFilenamePart(g.brand);
        const xlsxName = `${idxPrefix}_RFQ_${safeBrand}_${g.items.length}items.xlsx`;
        filenamesByBrand.set(g.brand, xlsxName);

        const buffer = await buildSingleBrandRfqBuffer(ExcelJS, g, {
            project,
            companyName,
            companyLogoData,
            primaryArgb,
            accentArgb,
            imageCache
        });
        zip.file(xlsxName, buffer);
    }

    const summaryBuffer = await buildMasterSummaryBuffer(ExcelJS, brandGroups, filenamesByBrand, {
        project,
        companyName,
        primaryArgb
    });
    zip.file('00_RFQ_Master_Summary.xlsx', summaryBuffer);

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const projSlug = project.projectName ? `_${sanitizeFilenamePart(project.projectName)}` : '';
    const zipName = `${filenamePrefix}${projSlug}_${brandGroups.length}Brands_${dateStamp}.zip`;
    saveAs(zipBlob, zipName);
    return { brandCount: brandGroups.length, itemCount: totalItems, fileName: zipName };
}

export async function exportRfqByBrandFromTables(tables, options = {}) {
    const groups = groupTableViewerItemsByBrand(tables, options.allBrands || []);
    return executeBrandRfqDownload(groups, options);
}

export async function exportRfqByBrandFromTierRows(rows, options = {}) {
    const groups = groupMultiBudgetRowsByBrand(rows, options.allBrands || []);
    return executeBrandRfqDownload(groups, options);
}
