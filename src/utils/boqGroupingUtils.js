/**
 * Shared BOQ Recategorization & Section Subheader Utilities
 * Supports both Furniture-only and Furniture + Fitout plan drawings / BOQ tables across:
 *  - ValueEngineeredModal
 *  - MultiBudgetModal
 *  - TableViewer & Offer/Submission Exports
 */

const normalizeText = (v) => String(v || '').replace(/\s+/g, ' ').trim();

/**
 * Strip leading [Location] / [Code] tags so typology classification relies on item spec.
 */
const stripLeadingTags = (v) => normalizeText(String(v || '').replace(/^(\s*\[[^\]]{1,45}\]\s*)+/g, ''));

/**
 * A bed frame (bunk / single / hostel bed) — not a sofa-bed, bedside unit, bedding, a mattress,
 * or a civil bedding layer (sand bed, concrete bed under pipes). Mirrors server/utils/specArchetypes.js.
 * Whichever furniture noun comes first in the headline is the item ("single bed with side table" is a bed).
 */
const BED_WORD_RX = /\b(?:bunk\s*beds?|beds?|bunks?|double[\s-]?deck(?:er)?s?)\b/;
const NOT_BED_RX = /\b(?:sofa|day|futon)[\s-]?beds?\b|\bbeds?[\s-]?(?:side|sheets?|linens?|spreads?|covers?|skirts?|throws?|runners?|rooms?|heads?|bugs?|plates?|joints?|bolts?|loads?)\b|\b(?:flower|seed|plant(?:er|ing)?|garden|lawn|grass|nursery|reed|filter|gravel|sand|mortar|concrete|cement|granular|stone|aggregate|test|river|sea|oyster)[\s-]?beds?\b/;
const STRONG_BED_RX = /\b(?:bunk\s*beds?|double[\s-]?deck(?:er)?\s*beds?|(?:single|double|twin|queen|king|steel|metal|iron|wooden|timber|hospital|hostel|dormitory|staff|labou?r|military|camp)\s*beds?|(?:m\.?\s?s\.?|steel|metal|g\.?i\.?)\s+pipe\s*beds?|beds?\s*frames?)\b/;
const CIVIL_WORKS_RX = /\b(?:cement|sand|mortar|concrete|screed|granito|terrazzo|excavat\w*|manholes?|reservoirs?|trench\w*|pipes?|piping|aggregates?|gravel|backfill\w*|asphalt|bitumen|tiles?|tiling|floor\s*finish\w*|plaster\w*|masonry|blockwork|brickwork|kerbs?|culverts?|drains?|drainage)\b/;
const OTHER_ITEM_RX = /\b(?:sofas?|couch(?:es)?|settees?|futons?|armchairs?|ottomans?|poufs?|chairs?|stools?|bench(?:es)?|tables?|desks?|workstations?|wardrobes?|cabinets?|cupboards?|lockers?|lamps?|mattress(?:es)?|pillows?|duvets?|blankets?|linens?|quilts?|comforters?|sheets?)\b/;

function isBedItemText(text = '') {
    const t = String(text || '').split(/[\r\n|]+/)[0].slice(0, 200).toLowerCase();
    const bedAt = t.search(BED_WORD_RX);
    if (bedAt < 0) return false;
    if (NOT_BED_RX.test(t)) return false;
    if (CIVIL_WORKS_RX.test(t) && !STRONG_BED_RX.test(t)) return false;
    const otherAt = t.search(OTHER_ITEM_RX);
    return otherAt < 0 || bedAt < otherAt;
}

/**
 * Determine whether a row belongs to Architectural / MEP / Joinery Fitout vs Furniture.
 */
export function isFitoutRow(row = {}) {
    const scopeStr = String(row.scope || '').toLowerCase();
    if (scopeStr.includes('fitout')) return true;
    if (String(row.type || '').toLowerCase() === 'fitout') return true;
    if (String(row.selectedBrand || '').toLowerCase().includes('fitout')) return true;

    const text = stripLeadingTags(
        `${row.categoryHint || ''} ${row.selectedMainCat || ''} ${row.selectedSubCat || ''} ${row.description || ''}`
    ).toLowerCase();

    const isFurnitureOverride = /\b(task chair|office chair|executive chair|visitor chair|meeting chair|conference table|meeting table|workstation|desk screen|privacy screen|sofa|lounge chair|acoustic pod|phone booth|mobile pedestal|credenza|freestanding)\b/i.test(text);
    if (isFurnitureOverride && !/\b(partition wall|drywall|gypsum ceiling|carpet tile|porcelain tile|floor tile|swing door|sliding door)\b/i.test(text)) {
        return false;
    }

    return /\b(carpet tile|carpet flooring|porcelain|ceramic|tile flooring|vinyl flooring|marble flooring|stone flooring|flooring|gypsum|false ceiling|mineral fiber|ceiling|partition wall|drywall|glass partition|wall cladding|skirting|swing door|sliding door|timber door|pantry cabinet|built-in pantry|undermount sink|hvac|mep|sprinkler|diffuser|lighting fixture|led panel)\b/i.test(text);
}

/**
 * Resolve canonical Trade & Item Category for Item-wise subheaders and Submission separator pages.
 * Handles both Furniture-only and Fitout & Furniture workflows dynamically.
 */
export function classifyBoqItemGroup(row = {}) {
    const fitout = isFitoutRow(row);
    const scopeStr = normalizeText(row.scope || '');
    const hintText = stripLeadingTags(
        `${row.categoryHint || ''} ${row.selectedMainCat || ''} ${row.selectedSubCat || ''} ${row.name || ''} ${row.description || ''}`
    ).toLowerCase();

    if (fitout) {
        let subCategory = 'Architectural Fitout Works';
        let order = 95;

        if (/\b(carpet|porcelain|ceramic|vinyl|marble|stone|screed|self leveling|flooring|floor tiles?|floor finish(?:es)?)\b/i.test(hintText)) {
            subCategory = 'Flooring & Wet Works';
            order = 60;
        } else if (/\b(ceilings?|gypsum boards?|plasterboards?|mineral fiber|t-grid|soffits?|acoustic panel.*ceiling|painting|emulsion)\b/i.test(hintText)) {
            subCategory = 'Ceiling & Paint Finishes';
            order = 62;
        } else if (/\b(partitions?|drywall|gypsum walls?|glass partitions?|cladding|skirting|veneer|acoustic walls?)\b/i.test(hintText)) {
            subCategory = 'Partitions & Wall Cladding';
            order = 64;
        } else if (/\b(doors?|windows?|curtains?|blinds?|glazing.*doors?|ironmongery)\b/i.test(hintText)) {
            subCategory = 'Doors, Glazing & Hardware';
            order = 66;
        } else if (/\b(pantry|joinery|built-in cabinets?|vanity|vanities|countertops?|sinks?|quartz)\b/i.test(hintText)) {
            subCategory = 'Pantry & Joinery Works';
            order = 68;
        } else if (/\b(lights?|lighting|leds?|luminaires?|downlights?)\b/i.test(hintText)) {
            subCategory = 'Lighting Works';
            order = 70;
        } else if (/\b(mep|hvac|electrical|plumbing|fire|av|audio|visual)\b/i.test(hintText) || /mep|lighting|av/i.test(scopeStr)) {
            subCategory = /lighting/i.test(scopeStr) ? 'Lighting Works' : /av/i.test(scopeStr) ? 'AV Systems' : 'MEP & Building Services';
            order = 72;
        }

        const categoryTitle = scopeStr && /fitout/i.test(scopeStr) ? scopeStr.toUpperCase() : 'FITOUT WORKS';
        return {
            trade: 'Fitout',
            categoryTitle,
            subheaderTitle: subCategory,
            sectionLabel: `${categoryTitle} — ${subCategory}`,
            sortOrder: order
        };
    }

    // Furniture subcategories (listed ahead of Fitout in Item-wise order)
    let subCategory = 'General Furniture';
    let order = 49;

    if (/\b(pods?|phone booths?|acoustic booths?|meeting pods?|work pods?|silence booths?|soundproof)\b/i.test(hintText)) {
        subCategory = 'Acoustic Pods & Booths';
        order = 28;
    } else if (isBedItemText(stripLeadingTags(row.description || row.name || '')) || /^beds$/i.test(normalizeText(row.selectedSubCat))) {
        subCategory = 'Beds & Accommodation';
        order = 27;
    } else if (/\b(reception counters?|reception desks?|reception furniture|counters?\.)\b/i.test(hintText)) {
        subCategory = 'Reception Counters & Joinery';
        order = 24;
    } else if (/\b(workstations?|bench systems?|benching|clusters?|executive.*desks?|manager.*desks?|office desks?|rectangular.*desks?|l-shaped desks?)\b/i.test(hintText)) {
        subCategory = 'Desks & Workstations';
        order = 12;
    } else if (/\b(conference tables?|meeting tables?|boardroom tables?|flip top tables?)\b/i.test(hintText)) {
        subCategory = 'Conference & Meeting Tables';
        order = 14;
    } else if (/\b(coffee tables?|side tables?|center tables?|occasional tables?|low tables?|dining tables?|pantry tables?|cafe tables?|cafeteria)\b/i.test(hintText)) {
        subCategory = 'Dining, Pantry & Coffee Tables';
        order = 22;
    } else if (/\b(sofas?|couches?|lounge chairs?|armchairs?|ottomans?|poufs?|soft seating|modular lounge)\b/i.test(hintText)) {
        subCategory = 'Lounge & Soft Seating';
        order = 20;
    } else if (/\b(high chairs?|bar stools?|counter stools?|bar chairs?|tall stools?)\b/i.test(hintText)) {
        subCategory = 'High Chairs & Bar Stools';
        order = 19;
    } else if (/\b(meeting chairs?|conference chairs?|visitor chairs?|cantilever.*chairs?|dining chairs?|cafe chairs?|cafeteria.*chairs?|stackable chairs?|training chairs?)\b/i.test(hintText)) {
        subCategory = 'Meeting, Visitor & Dining Seating';
        order = 18;
    } else if (/\b(task chairs?|swivel chairs?|executive chairs?|manager chairs?|operator chairs?|staff chairs?|mesh chairs?|chairs?|seating)\b/i.test(hintText)) {
        subCategory = 'Task & Executive Seating';
        order = 16;
    } else if (/\b(pedestals?|credenzas?|cabinets?|lockers?|storage|filing|bookcases?|shelving)\b/i.test(hintText)) {
        subCategory = 'Storage & Pedestals';
        order = 26;
    } else if (/\b(desks?|tables?)\b/i.test(hintText)) {
        subCategory = 'Desks & Tables';
        order = 15;
    }

    return {
        trade: 'Furniture',
        categoryTitle: 'FURNITURE',
        subheaderTitle: subCategory,
        sectionLabel: `FURNITURE — ${subCategory}`,
        sortOrder: order
    };
}

/**
 * Cleanly extract room / zone location from either a structured row object or TableViewer row cells.
 */
export function resolveRowLocation(row = {}, header = []) {
    const directLoc = normalizeText(row.location || row.Location || '');
    if (directLoc && !/^general\s*area$/i.test(directLoc) && !/^consolidated$/i.test(directLoc)) {
        return directLoc;
    }

    if (Array.isArray(header) && header.length > 0 && Array.isArray(row.cells)) {
        const locIdx = header.findIndex(h => /^(location|room|zone|area|space)$/i.test(normalizeText(h)));
        if (locIdx !== -1 && row.cells[locIdx]?.value) {
            const cellLoc = normalizeText(row.cells[locIdx].value);
            if (cellLoc) return cellLoc;
        }
    }

    // Fallback: parse leading bracket tag if present on legacy descriptions
    const descMatch = String(row.description || '').match(/^\s*\[([^\]]{2,45})\]/);
    if (descMatch && descMatch[1] && !/^[A-Z]{1,4}-\d{1,3}$/.test(descMatch[1].trim())) {
        return normalizeText(descMatch[1]);
    }

    return directLoc || 'General Area';
}

/**
 * Compute section grouping metadata for any BOQ row given mode ('item' | 'room').
 */
export function computeRowSectionMeta(row = {}, mode = 'item', header = []) {
    const itemGroup = classifyBoqItemGroup(row);
    if (mode === 'room') {
        const roomName = resolveRowLocation(row, header);
        const categoryTitle = roomName.toUpperCase();
        const subheaderTitle = itemGroup.subheaderTitle;
        return {
            categoryTitle,
            subheaderTitle: `${itemGroup.trade} — ${subheaderTitle}`,
            sectionLabel: categoryTitle,
            submissionTitle: `${categoryTitle} - ${itemGroup.trade.toUpperCase()}`,
            sortOrder: itemGroup.trade === 'Fitout' ? 200 + itemGroup.sortOrder : itemGroup.sortOrder,
            roomKey: roomName.toLowerCase()
        };
    }

    return {
        categoryTitle: itemGroup.categoryTitle,
        subheaderTitle: itemGroup.subheaderTitle,
        sectionLabel: itemGroup.sectionLabel,
        submissionTitle: `${itemGroup.categoryTitle} - ${itemGroup.subheaderTitle}`,
        sortOrder: itemGroup.sortOrder,
        roomKey: ''
    };
}

/**
 * Re-group & re-sequence modal BOQ rows by 'original' (as-is, default for uploaded BOQs/offers),
 * 'item' (default for extracted plan drawings), or 'room' without losing row identity or fields.
 */
export function recategorizeBoqRows(rows = [], mode = 'original', { preserveOrderWithinGroup = true } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    // Filter out legacy standalone header-divider pseudo-rows if any existed
    const cleanRows = rows.filter(r => r && !r.isSubheaderRow);

    if (!mode || mode === 'original' || mode === 'none') {
        const restored = cleanRows
            .map((row, idx) => ({ row, order: row._origOrder ?? idx }))
            .sort((a, b) => a.order - b.order)
            .map(({ row }) => {
                if (!row._autoSection) return row;
                const { sectionLabel, sectionCategory, sectionSubheader, submissionTitle, _autoSection, ...rest } = row;
                return {
                    ...rest,
                    sn: row._origSn !== undefined ? row._origSn : row.sn
                };
            });
        return restored;
    }

    // Track first-seen room order for natural architectural progression (Meeting Room -> Open Office -> Cabins -> Reception -> Pantry)
    const roomOrderMap = new Map();
    cleanRows.forEach(r => {
        const locKey = resolveRowLocation(r).toLowerCase();
        if (!roomOrderMap.has(locKey)) {
            roomOrderMap.set(locKey, roomOrderMap.size);
        }
    });

    const decorated = cleanRows.map((row, idx) => {
        const meta = computeRowSectionMeta(row, mode);
        const origOrder = row._origOrder ?? idx;
        const origSn = row._origSn !== undefined ? row._origSn : row.sn;
        return {
            row: {
                ...row,
                _origOrder: origOrder,
                _origSn: origSn,
                _autoSection: true,
                sectionLabel: meta.sectionLabel,
                sectionCategory: meta.categoryTitle,
                sectionSubheader: meta.subheaderTitle,
                submissionTitle: meta.submissionTitle
            },
            meta,
            origIdx: origOrder
        };
    });

    decorated.sort((a, b) => {
        if (mode === 'room') {
            const roomA = roomOrderMap.get(a.meta.roomKey) ?? 999;
            const roomB = roomOrderMap.get(b.meta.roomKey) ?? 999;
            if (roomA !== roomB) return roomA - roomB;
            if (a.meta.sortOrder !== b.meta.sortOrder) return a.meta.sortOrder - b.meta.sortOrder;
            return preserveOrderWithinGroup ? (a.origIdx - b.origIdx) : 0;
        }

        if (a.meta.sortOrder !== b.meta.sortOrder) return a.meta.sortOrder - b.meta.sortOrder;
        const lblCmp = a.meta.sectionLabel.localeCompare(b.meta.sectionLabel);
        if (lblCmp !== 0) return lblCmp;
        return preserveOrderWithinGroup ? (a.origIdx - b.origIdx) : 0;
    });

    return decorated.map((item, newIdx) => ({
        ...item.row,
        sn: newIdx + 1
    }));
}

/**
 * Re-group & re-sequence TableViewer tables by 'original' (as-is), 'item', or 'room',
 * preserving cells, images, original sequence & totals.
 */
export function recategorizeTables(tables = [], mode = 'original') {
    if (!Array.isArray(tables) || tables.length === 0) return tables;

    return tables.map(table => {
        const header = table.header || [];
        const rawRows = table.rows || [];
        if (rawRows.length === 0) return { ...table, recategorizeMode: mode || 'original' };

        const snIdx = header.findIndex(h => /^(s\.?n\.?|sl\.?no\.?|sr\.?no\.?|sr\.?|#|item\s*#?)$/i.test(String(h || '').trim()));

        if (!mode || mode === 'original' || mode === 'none') {
            const headerRows = [];
            const summaryRows = [];
            const dataRows = [];
            rawRows.forEach((row, idx) => {
                if (!row) return;
                if (row.isHeader) { headerRows.push(row); return; }
                if (row.isSummary) { summaryRows.push(row); return; }
                dataRows.push({ row, order: row._origOrder ?? idx });
            });
            dataRows.sort((a, b) => a.order - b.order);
            const restoredDataRows = dataRows.map(({ row }) => {
                if (!row._autoSection) return row;
                const restoredCells = (row.cells || []).map((cell, cIdx) => {
                    if (cIdx === snIdx && snIdx !== -1 && row._origSn !== undefined) {
                        return { ...cell, value: row._origSn };
                    }
                    return cell;
                });
                const { sectionLabel, sectionCategory, sectionSubheader, submissionTitle, _autoSection, ...rest } = row;
                return { ...rest, cells: restoredCells };
            });
            return {
                ...table,
                recategorizeMode: 'original',
                rows: [...headerRows, ...restoredDataRows, ...summaryRows]
            };
        }

        let descIdx = header.findIndex(h => !/^(item\s*(no\.?|#)?|s\.?n\.?|sl\.?no\.?|image|photo|img)$/i.test(normalizeText(h)) && /description|details|spec/i.test(String(h || '')));
        if (descIdx === -1) {
            descIdx = header.findIndex(h => !/^(item\s*(no\.?|#)?|s\.?n\.?|sl\.?no\.?|image|photo|img)$/i.test(normalizeText(h)) && /desc|disc|product|particulars|item\s*name/i.test(String(h || '')));
        }
        const scopeIdx = header.findIndex(h => /^scope$/i.test(normalizeText(h)));
        const locIdx = header.findIndex(h => /^(location|room|zone|area|space)$/i.test(String(h || '')));
        const brandIdx = header.findIndex(h => /\b(brand|maker|origin)\b/i.test(String(h || '')) && !/img|logo|image/i.test(String(h || '')));

        const getCellText = (row, idx) => (idx >= 0 && row.cells?.[idx]?.value !== undefined) ? String(row.cells[idx].value).trim() : '';

        const headerRows = [];
        const summaryRows = [];
        const dataDecorated = [];
        const roomOrderMap = new Map();

        rawRows.forEach((row, idx) => {
            if (!row) return;
            if (row.isHeader) {
                headerRows.push(row);
                return;
            }
            if (row.isSummary) {
                summaryRows.push(row);
                return;
            }

            const synthetic = {
                location: row.location || getCellText(row, locIdx),
                scope: row.scope || getCellText(row, scopeIdx),
                categoryHint: row.categoryHint || '',
                selectedMainCat: row.selectedMainCat || '',
                selectedSubCat: row.selectedSubCat || '',
                selectedBrand: row.selectedBrand || getCellText(row, brandIdx),
                description: row.description || getCellText(row, descIdx) || getCellText(row, 1) || getCellText(row, 0)
            };

            const locKey = resolveRowLocation(synthetic, header).toLowerCase();
            if (!roomOrderMap.has(locKey)) {
                roomOrderMap.set(locKey, roomOrderMap.size);
            }

            const meta = computeRowSectionMeta(synthetic, mode, header);
            const origOrder = row._origOrder ?? idx;
            const origSn = row._origSn !== undefined ? row._origSn : (snIdx !== -1 ? row.cells?.[snIdx]?.value : undefined);
            dataDecorated.push({ row, synthetic, meta, origIdx: origOrder, origSn });
        });

        dataDecorated.sort((a, b) => {
            if (mode === 'room') {
                const rA = roomOrderMap.get(a.meta.roomKey) ?? 999;
                const rB = roomOrderMap.get(b.meta.roomKey) ?? 999;
                if (rA !== rB) return rA - rB;
                if (a.meta.sortOrder !== b.meta.sortOrder) return a.meta.sortOrder - b.meta.sortOrder;
                return a.origIdx - b.origIdx;
            }
            if (a.meta.sortOrder !== b.meta.sortOrder) return a.meta.sortOrder - b.meta.sortOrder;
            const cmp = a.meta.sectionLabel.localeCompare(b.meta.sectionLabel);
            if (cmp !== 0) return cmp;
            return a.origIdx - b.origIdx;
        });

        const reorderedDataRows = dataDecorated.map((item, idx) => {
            const newCells = (item.row.cells || []).map((cell, cIdx) => {
                if (cIdx === snIdx && snIdx !== -1 && /^\d+$/.test(String(cell?.value || '').trim())) {
                    return { ...cell, value: String(idx + 1) };
                }
                return cell;
            });
            return {
                ...item.row,
                _origOrder: item.origIdx,
                ...(item.origSn !== undefined ? { _origSn: item.origSn } : {}),
                _autoSection: true,
                cells: newCells,
                location: item.synthetic.location || item.row.location || '',
                scope: item.synthetic.scope || item.row.scope || '',
                sectionLabel: item.meta.sectionLabel,
                sectionCategory: item.meta.categoryTitle,
                sectionSubheader: item.meta.subheaderTitle,
                submissionTitle: item.meta.submissionTitle
            };
        });

        return {
            ...table,
            recategorizeMode: mode,
            rows: [...headerRows, ...reorderedDataRows, ...summaryRows]
        };
    });
}

/**
 * Derive clean Titled Category + Subheader strings for a group of submission items.
 */
export function resolveSectionDividerMeta(groupRows = [], fallbackLabel = 'GENERAL ITEMS') {
    const first = groupRows[0] || {};
    const label = normalizeText(first.sectionLabel || fallbackLabel || 'GENERAL ITEMS');
    const categoryTitle = normalizeText(first.sectionCategory || (label.includes('—') ? label.split('—')[0] : label)).toUpperCase();

    if (first.sectionCategory && first.sectionSubheader && label === first.sectionLabel && label.includes('—')) {
        return {
            sectionKey: label,
            categoryTitle,
            subheaderTitle: normalizeText(first.sectionSubheader).toUpperCase(),
            fullTitle: `${categoryTitle} - ${normalizeText(first.sectionSubheader).toUpperCase()}`,
            itemCount: groupRows.length
        };
    }

    // Room-wise or custom sectionLabel: summarize trades & sub-categories inside this section
    const trades = new Set();
    const subCats = new Set();
    groupRows.forEach(r => {
        const g = classifyBoqItemGroup(r);
        trades.add(g.trade.toUpperCase());
        subCats.add(g.subheaderTitle);
    });
    const tradeStr = Array.from(trades).sort().join(' & ') || 'BOQ ITEMS';
    const subSample = Array.from(subCats).slice(0, 3).join(' • ');
    const subheaderTitle = subSample ? `${tradeStr} (${subSample})` : tradeStr;

    return {
        sectionKey: label,
        categoryTitle,
        subheaderTitle,
        fullTitle: `${categoryTitle} - ${tradeStr}`,
        itemCount: groupRows.length
    };
}

/**
 * Draw a dedicated Titled Category - Subheader separator page in jsPDF for submissions (MAS, MIR, WIR, Presentation PDF).
 */
export function drawPdfCategoryDividerPage(doc, {
    categoryTitle = 'CATEGORY',
    subheaderTitle = 'SUBHEADER',
    itemCount = 0,
    submissionType = 'SUBMISSION',
    project = {},
    companyName = '',
    colors = {},
    headerLogoData = null,
    clientLogoData = null,
    calcFitSize = null,
    processText = (t) => String(t || '')
}) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const primary = colors.primary || [15, 62, 103];
    const accent = colors.accent || colors.secondary || [245, 166, 35];
    const lightBg = colors.lightBg || [248, 250, 252];
    const textCol = colors.text || [30, 41, 59];
    const mutedCol = colors.lightText || [100, 116, 139];

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // Top corporate banner
    doc.setFillColor(...primary);
    doc.rect(0, 0, pageWidth, 32, 'F');
    doc.setFillColor(...accent);
    doc.rect(0, 32, pageWidth, 2, 'F');

    if (headerLogoData && calcFitSize) {
        try {
            const fit = calcFitSize(headerLogoData.width, headerLogoData.height, 55, 18);
            doc.addImage(headerLogoData.dataUrl, 'PNG', pageWidth - 12 - fit.w, 6, fit.w, fit.h);
        } catch { }
    }
    if (clientLogoData && calcFitSize) {
        try {
            const fit = calcFitSize(clientLogoData.width, clientLogoData.height, 55, 18);
            doc.addImage(clientLogoData.dataUrl, 'PNG', 12, 6, fit.w, fit.h);
        } catch { }
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(processText(String(submissionType || 'SECTION').toUpperCase()), pageWidth / 2, 20, { align: 'center' });

    // Center Titled Category - Subheader panel
    const boxY = Math.max(58, pageHeight * 0.28);
    const boxH = Math.min(82, pageHeight * 0.36);
    doc.setFillColor(...lightBg);
    doc.setDrawColor(...accent);
    doc.setLineWidth(0.8);
    doc.roundedRect(18, boxY, pageWidth - 36, boxH, 3, 3, 'FD');

    // Left accent bar
    doc.setFillColor(...accent);
    doc.rect(18, boxY, 4, boxH, 'F');

    doc.setTextColor(...mutedCol);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('CATEGORY SECTION', pageWidth / 2, boxY + 15, { align: 'center' });

    doc.setTextColor(...primary);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    const catLines = doc.splitTextToSize(processText(categoryTitle), pageWidth - 56);
    doc.text(catLines.slice(0, 2), pageWidth / 2, boxY + 30, { align: 'center' });

    doc.setDrawColor(...accent);
    doc.setLineWidth(0.5);
    const lineY = boxY + 38 + (catLines.length > 1 ? 8 : 0);
    doc.line(pageWidth * 0.25, lineY, pageWidth * 0.75, lineY);

    doc.setTextColor(...textCol);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    const subLines = doc.splitTextToSize(processText(subheaderTitle), pageWidth - 56);
    doc.text(subLines.slice(0, 2), pageWidth / 2, lineY + 11, { align: 'center' });

    doc.setTextColor(...mutedCol);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`${itemCount} ${itemCount === 1 ? 'Item' : 'Items'} Included`, pageWidth / 2, boxY + boxH - 9, { align: 'center' });

    // Project / Footer summary
    const projParts = [
        project?.projectName ? `Project: ${project.projectName}` : '',
        project?.clientName ? `Client: ${project.clientName}` : '',
        companyName || ''
    ].filter(Boolean);
    if (projParts.length > 0) {
        doc.setTextColor(...mutedCol);
        doc.setFontSize(9);
        doc.text(processText(projParts.join('   |   ')), pageWidth / 2, pageHeight - 16, { align: 'center' });
    }
}

/**
 * Add a dedicated Titled Category - Subheader separator slide in PptxGenJS.
 */
export function addPptxCategoryDividerSlide(pres, {
    masterName = 'BOQ_MASTER',
    categoryTitle = 'CATEGORY',
    subheaderTitle = 'SUBHEADER',
    itemCount = 0,
    colors = {},
    drawSlideDecorations = null,
    logoData = null,
    calcFitSize = null,
    projectName = ''
}) {
    const slide = pres.addSlide({ masterName });
    if (typeof drawSlideDecorations === 'function') {
        drawSlideDecorations(slide);
    }

    const primary = String(colors.primary || '0F3E67').replace('#', '');
    const accent = String(colors.accent || colors.secondary || 'F5A623').replace('#', '');
    const textCol = String(colors.text || '2D3748').replace('#', '');
    const lightText = String(colors.lightText || '64748B').replace('#', '');
    const lightBg = String(colors.lightBg || 'F8FAFC').replace('#', '');

    slide.addText('SECTION CATEGORY', {
        x: 0.4, y: 0.18, w: 6.5, h: 0.4, fontSize: 13, bold: true, color: 'FFFFFF'
    });

    if (logoData && calcFitSize) {
        try {
            const fit = calcFitSize(logoData.width, logoData.height, 1.3 * 96, 0.45 * 96);
            const fitW = fit.w / 96;
            const fitH = fit.h / 96;
            slide.addImage({
                data: logoData.dataUrl,
                x: 8.4 + (1.3 - fitW) / 2, y: 0.15 + (0.45 - fitH) / 2, w: fitW, h: fitH
            });
        } catch { }
    }

    slide.addShape('rect', {
        x: 0.8, y: 1.45, w: 8.4, h: 2.75, fill: { color: lightBg }, line: { color: accent, width: 1.5 }
    });
    slide.addShape('rect', {
        x: 0.8, y: 1.45, w: 0.14, h: 2.75, fill: { color: accent }
    });

    slide.addText(categoryTitle, {
        x: 1.15, y: 1.75, w: 7.8, h: 0.8, fontSize: 26, bold: true, color: primary, align: 'center', valign: 'middle'
    });
    slide.addShape('rect', {
        x: 3.1, y: 2.65, w: 3.8, h: 0.04, fill: { color: accent }
    });
    slide.addText(subheaderTitle, {
        x: 1.15, y: 2.8, w: 7.8, h: 0.7, fontSize: 16, bold: true, color: textCol, align: 'center', valign: 'middle'
    });
    slide.addText(`${itemCount} ${itemCount === 1 ? 'Item' : 'Items'}${projectName ? `  |  ${projectName}` : ''}`, {
        x: 1.15, y: 3.6, w: 7.8, h: 0.35, fontSize: 11, color: lightText, align: 'center'
    });

    return slide;
}

