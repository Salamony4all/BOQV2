/**
 * Furniture Set Detection, Component Parsing, Templates & Lump-Sum Rollup Utilities.
 *
 * Allows lump-sum multi-item BOQ rows (e.g. "OUTDOOR DINING AREA - FURNITURE SET",
 * "VIP LOUNGE - FURNITURE SET", "CLINIC - FURNITURE SET", "LIBRARY SET") to be
 * assigned a dedicated Set Type, decomposed into per-piece matched components, and
 * rolled back up into the parent lump-sum row while preserving original BOQ order.
 */

export const FURNITURE_SET_TYPES = [
    {
        id: 'single',
        label: 'Single Item',
        shortLabel: 'Single',
        matchPrefix: '',
        defaultSlots: []
    },
    {
        id: 'workstation_set',
        label: 'Workstation Cluster Set',
        shortLabel: 'Workstation Set',
        matchPrefix: 'Workstation',
        defaultSlots: [
            { label: 'Workstation Desk / Worktop', description: 'Office Workstation Desk', qty: '4', unit: 'Nos' },
            { label: 'Acoustic Desk Divider Screen', description: 'Acoustic Desk Privacy Screen', qty: '2', unit: 'Nos' },
            { label: 'Mobile Pedestal / Drawers', description: 'Underdesk Mobile Pedestal 3 Drawers', qty: '4', unit: 'Nos' },
            { label: 'Cable Tray / Power Box', description: 'Underdesk Cable Management Tray Power Box', qty: '2', unit: 'Nos' },
            { label: 'Ergonomic Task Chairs', description: 'Ergonomic Mesh Office Task Chair', qty: '4', unit: 'Nos' }
        ]
    },
    {
        id: 'modular_seating_set',
        label: 'Modular Seating Set',
        shortLabel: 'Modular Seating',
        matchPrefix: 'Modular',
        defaultSlots: [
            { label: 'Modular Corner Unit', description: 'Modular Lounge Corner Sofa Module', qty: '2', unit: 'Nos' },
            { label: 'Modular Straight / Armless Unit', description: 'Modular Lounge Straight Sofa Module', qty: '3', unit: 'Nos' },
            { label: 'Modular Ottoman / Pouf', description: 'Modular Lounge Ottoman Pouf', qty: '2', unit: 'Nos' },
            { label: 'Integrated / Side Table', description: 'Lounge Side Coffee Table', qty: '2', unit: 'Nos' }
        ]
    },
    {
        id: 'desking_set',
        label: 'Desking Set',
        shortLabel: 'Desking Set',
        matchPrefix: 'Office',
        defaultSlots: [
            { label: 'Executive / Office Desk', description: 'Office Desk with side return', qty: '1', unit: 'Nos' },
            { label: 'Executive / Task Chair', description: 'Ergonomic Executive Office Chair', qty: '1', unit: 'Nos' },
            { label: 'Visitor Chair', description: 'Office Visitor Chair', qty: '2', unit: 'Nos' },
            { label: 'Storage Cabinet', description: 'Office Storage Cabinet / Credenza', qty: '1', unit: 'Nos' }
        ]
    },
    {
        id: 'seating_set',
        label: 'Seating / Lounge Set',
        shortLabel: 'Lounge Set',
        matchPrefix: 'Lounge',
        defaultSlots: [
            { label: 'Three Seater Sofa', description: 'Lounge Three Seater Sofa', qty: '1', unit: 'Nos' },
            { label: 'Single Seater Armchair', description: 'Lounge Single Seater Armchair', qty: '2', unit: 'Nos' },
            { label: 'Coffee Table', description: 'Lounge Coffee Table', qty: '1', unit: 'Nos' },
            { label: 'Side Table', description: 'Side Table for Sofa Set', qty: '2', unit: 'Nos' }
        ]
    },
    {
        id: 'meeting_set',
        label: 'Meeting Room Set',
        shortLabel: 'Meeting Set',
        matchPrefix: 'Meeting Room',
        defaultSlots: [
            { label: 'Conference / Meeting Table', description: 'Conference Meeting Room Table', qty: '1', unit: 'Nos' },
            { label: 'Conference Chairs', description: 'Conference Meeting Chair', qty: '8', unit: 'Nos' },
            { label: 'Credenza / Sideboard', description: 'Meeting Room Storage Credenza', qty: '1', unit: 'Nos' }
        ]
    },
    {
        id: 'outdoor_set',
        label: 'Outdoor & Courtyard Set',
        shortLabel: 'Outdoor Set',
        matchPrefix: 'Outdoor',
        defaultSlots: [
            { label: 'Outdoor Sofa', description: 'Outdoor Three Seater Sofa', qty: '1', unit: 'Nos' },
            { label: 'Outdoor Armchair', description: 'Outdoor Lounge Armchair', qty: '2', unit: 'Nos' },
            { label: 'Outdoor Coffee Table', description: 'Outdoor Low Coffee Table', qty: '1', unit: 'Nos' },
            { label: 'Outdoor Dining Table', description: 'Outdoor Dining Table', qty: '1', unit: 'Nos' },
            { label: 'Outdoor Dining Chair', description: 'Outdoor Dining Chair', qty: '4', unit: 'Nos' }
        ]
    },
    {
        id: 'cafeteria_set',
        label: 'Cafeteria & Dining Set',
        shortLabel: 'Cafeteria Set',
        matchPrefix: 'Cafeteria',
        defaultSlots: [
            { label: 'Cafeteria Dining Table', description: 'Cafeteria Dining Table', qty: '1', unit: 'Nos' },
            { label: 'Cafeteria Dining Chairs', description: 'Cafeteria Dining Chair', qty: '4', unit: 'Nos' },
            { label: 'Cafeteria Lounge / Booth', description: 'Cafeteria Banquette Sofa Bench', qty: '1', unit: 'Nos' }
        ]
    },
    {
        id: 'library_set',
        label: 'Library & Study Set',
        shortLabel: 'Library Set',
        matchPrefix: 'Library',
        defaultSlots: [
            { label: 'Library Study Table', description: 'Library Reading Study Table', qty: '1', unit: 'Nos' },
            { label: 'Reading / Study Chairs', description: 'Library Study Chair', qty: '4', unit: 'Nos' },
            { label: 'Bookcase / Shelving', description: 'Library High Bookcase Shelving Cabinet', qty: '2', unit: 'Nos' },
            { label: 'Reading Lounge Armchair', description: 'Library Lounge Armchair', qty: '2', unit: 'Nos' }
        ]
    },
    {
        id: 'reception_set',
        label: 'Reception & Waiting Set',
        shortLabel: 'Reception Set',
        matchPrefix: 'Reception',
        defaultSlots: [
            { label: 'Reception Counter Desk', description: 'Reception Counter Desk', qty: '1', unit: 'Nos' },
            { label: 'Waiting Area Sofa', description: 'Reception Waiting Area Three Seater Sofa', qty: '1', unit: 'Nos' },
            { label: 'Waiting Armchair', description: 'Reception Waiting Armchair', qty: '2', unit: 'Nos' },
            { label: 'Center Coffee Table', description: 'Reception Coffee Table', qty: '1', unit: 'Nos' }
        ]
    },
    {
        id: 'clinic_set',
        label: 'Clinic & Specialist Set',
        shortLabel: 'Clinic Set',
        matchPrefix: 'Clinic',
        defaultSlots: [
            { label: 'Office Desk', description: 'Office Desk', qty: '1', unit: 'Nos' },
            { label: 'Office Chair', description: 'Ergonomic Office Task Chair', qty: '1', unit: 'Nos' },
            { label: 'Visitor / Waiting Chairs', description: 'Visitor Conference Chair', qty: '2', unit: 'Nos' },
            { label: 'Storage Cabinet', description: 'High Storage Cabinet', qty: '1', unit: 'Nos' }
        ]
    },
    {
        id: 'nursery_set',
        label: 'Nursery & Breakout Set',
        shortLabel: 'Nursery Set',
        matchPrefix: 'Breakout',
        defaultSlots: [
            { label: 'Soft Lounge Seating', description: 'Breakout Lounge Sofa Seating', qty: '1', unit: 'Nos' },
            { label: 'Low Activity Table', description: 'Low Coffee Side Table', qty: '1', unit: 'Nos' },
            { label: 'Storage Cabinet', description: 'Storage Shelving Cabinet', qty: '1', unit: 'Nos' }
        ]
    },
    {
        id: 'custom_set',
        label: 'Custom Furniture Set',
        shortLabel: 'Custom Set',
        matchPrefix: '',
        defaultSlots: [
            { label: 'Set Component 1', description: 'Furniture Component 1', qty: '1', unit: 'Nos' },
            { label: 'Set Component 2', description: 'Furniture Component 2', qty: '1', unit: 'Nos' }
        ]
    }
];

export const FURNITURE_SET_TYPE_MAP = Object.fromEntries(
    FURNITURE_SET_TYPES.map(t => [t.id, t])
);

export function getSetTypeMeta(setType) {
    return FURNITURE_SET_TYPE_MAP[setType] || FURNITURE_SET_TYPE_MAP.single;
}

const GENERIC_PARENT_BRAND_RE = /^(?:local|local[\s-]?uae|far\s*east|fareast|custom|unbranded|generic|unknown|various|tbc|tbd|n\/a|none|approved|similar|or\s*equal|client\s*supply|-+)$/i;

const GENERIC_MODEL_SUFFIX_RE = /^(?:nos?|pcs?|sets?|units?|ea|lot|lum|lump|china|turkey|spain|italy|uae|malaysia|taiwan|europe|wood|metal|steel|fabric|leather|mesh|black|white|grey|gray|brown|beige|outdoor|indoor|custom|standard|small|medium|large)$/i;

/**
 * Extracts explicit Supplier / Brand / Manufacturer name from a parent BOQ set description
 * so sub-components inherit the specified brand and attempt exact matching before alternatives.
 */
export function extractParentSupplierContext(description = '') {
    const raw = String(description || '');
    if (!raw) return '';

    const labelMatch = raw.match(/(?:\||\r?\n|^)\s*(?:supplier|brand|manufacturer|make|proposed\s*brand)\s*:\s*([^|\r\n]+)/i);
    if (labelMatch && labelMatch[1]) {
        const candidate = labelMatch[1]
            .replace(/\s*\([^)]*\)\s*$/, '')
            .replace(/\s*\/\s*.*$/, '')
            .trim();
        if (candidate.length >= 2 && !GENERIC_PARENT_BRAND_RE.test(candidate)) {
            return candidate;
        }
    }
    return '';
}

/**
 * Extracts a specific model / series / ref token from a set sub-component label, e.g.:
 *   "Corner Sofa - Azur"           -> "Azur"
 *   "3 Seater Outdoor Sofa - Maroc"-> "Maroc"
 *   "Outdoor Dining Chair - Solaris"-> "Solaris"
 *   "Coffee Table - Bonita"        -> "Bonita"
 */
export function extractComponentModelHint(label = '', refCode = '') {
    const explicitRef = String(refCode || '').trim();
    if (explicitRef && explicitRef.length >= 2 && !GENERIC_MODEL_SUFFIX_RE.test(explicitRef)) {
        return explicitRef;
    }
    const clean = String(label || '').trim();
    if (!clean) return '';

    // Check trailing dash segment ("Corner Sofa - Azur", "Coffee Table - Bonita")
    const parts = clean.split(/\s+[-–—]\s+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
        const tail = parts[parts.length - 1]
            .replace(/\s*\(\s*[^)]*\)\s*$/, '')
            .trim();
        if (
            tail.length >= 2 &&
            tail.length <= 40 &&
            !GENERIC_MODEL_SUFFIX_RE.test(tail) &&
            !/^\d+(?:\.\d+)?\s*(?:nos?|pcs?|mm|cm|m)?$/i.test(tail) &&
            !/^(?:sofa|chair|table|desk|cabinet|bench|stool|armchair|bed|rack|shelf|shelving|bookcase|credenza|pouf|ottoman)\b/i.test(tail)
        ) {
            return tail;
        }
    }

    // Check embedded "Ref: XXXX"
    const refMatch = clean.match(/\bref\s*:\s*([A-Z0-9][A-Z0-9\-_/]{1,24})/i);
    if (refMatch && refMatch[1]) return refMatch[1].trim();
    return '';
}

/**
 * Builds the enriched match query for a furniture set component, preserving the parent's
 * specified Supplier/Brand and component Model/Ref so the backend runs Exact Match
 * (local DB -> official manufacturer site -> Architonic -> save to DB) BEFORE falling back to alternatives.
 */
export function buildSetComponentMatchQuery(sub, parentRow, setMeta = null) {
    const rawSubDesc = String(sub?.description || sub?.label || '').trim();
    if (!rawSubDesc) return '';

    const meta = setMeta || getSetTypeMeta(parentRow?.setType);
    let q = meta.matchPrefix
        && !rawSubDesc.toLowerCase().includes(meta.matchPrefix.toLowerCase())
        && ['outdoor_set', 'cafeteria_set', 'library_set'].includes(parentRow?.setType)
        ? `${meta.matchPrefix} ${rawSubDesc}`
        : rawSubDesc;

    const inheritedBrand = String(sub?.parentBrand || extractParentSupplierContext(parentRow?.description || '')).trim();
    const modelHint = String(sub?.modelHint || extractComponentModelHint(sub?.label || rawSubDesc)).trim();

    if (inheritedBrand && !/\b(?:supplier|brand)\s*:/i.test(q) && !q.toLowerCase().includes(inheritedBrand.toLowerCase())) {
        q += ` | Supplier: ${inheritedBrand}`;
    }
    if (modelHint && !/\bmodel\s*:/i.test(q)) {
        q += ` | Model: ${modelHint}`;
    }
    return q;
}

export function createEmptySetComponent(parentId, idx = 0, partial = {}) {
    const qtyNum = parseFloat(partial.qty);
    const rateNum = parseFloat(partial.rate);
    const computedAmount = (!isNaN(qtyNum) && !isNaN(rateNum) && rateNum > 0)
        ? (qtyNum * rateNum).toFixed(2)
        : (partial.amount || '');

    return {
        id: partial.id || `${parentId}_sub_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        label: partial.label || `Component ${idx + 1}`,
        description: partial.description || partial.label || '',
        parentBrand: partial.parentBrand || '',
        modelHint: partial.modelHint || '',
        qty: partial.qty !== undefined && partial.qty !== null && String(partial.qty).trim() !== '' ? String(partial.qty) : '1',
        unit: partial.unit || 'Nos',
        rate: partial.rate !== undefined && partial.rate !== null ? String(partial.rate) : '',
        basePrice: parseFloat(partial.basePrice) || 0,
        amount: computedAmount,
        selectedBrand: partial.selectedBrand || '',
        selectedMainCat: partial.selectedMainCat || '',
        selectedSubCat: partial.selectedSubCat || '',
        selectedFamily: partial.selectedFamily || '',
        selectedModel: partial.selectedModel || '',
        selectedModelUrl: partial.selectedModelUrl || '',
        brandImage: partial.brandImage || '',
        brandLogo: partial.brandLogo || '',
        brandDesc: partial.brandDesc || '',
        aiStatus: partial.aiStatus || 'idle',
        aiResult: partial.aiResult || null
    };
}

/**
 * Classifies which dedicated Set Type fits a multi-item BOQ description.
 */
export function inferSetTypeFromText(description = '') {
    const raw = String(description || '');
    const firstLine = raw.split(/[\r\n|]+/)[0].trim().toLowerCase();
    const full = raw.toLowerCase();

    if (/\b(workstation\s*(?:cluster|set|system|bench)|cluster\s*of\s*[2-9]|(?:2|4|6|8)[-\s]?pax\s*workstation|linear\s*workstation|back[-\s]?to[-\s]?back\s*workstation)\b/.test(firstLine)
        || (/\bworkstation\b/.test(firstLine) && /\b(screen|pedestal|chair|cable|drawer)\b/.test(full))) {
        return 'workstation_set';
    }
    if (/\b(modular\s*(?:seating|sofa|lounge|bench)|sectional\s*sofa|l[-\s]?shaped\s*modular|u[-\s]?shaped\s*modular|modular\s*lounge\s*set)\b/.test(firstLine)
        || /\bmodular\s*(?:seating|sofa\s*system)\b/.test(full)) {
        return 'modular_seating_set';
    }
    if (/\b(outdoor|courtyard|terrace|patio|garden)\b/.test(firstLine) || /\boutdoor\s+(dining|sofa|chair|table|furniture)\b/.test(full)) {
        return 'outdoor_set';
    }
    if (/\b(cafeteria|canteen|pantry\s*dining|food\s*court|dining\s*area|dining\s*set)\b/.test(firstLine)) {
        return 'cafeteria_set';
    }
    if (/\b(library|reading\s*room|study\s*area|study\s*room|archive)\b/.test(firstLine)) {
        return 'library_set';
    }
    if (/\b(clinic|medical|nurse|doctor|consultation|examination)\b/.test(firstLine)) {
        return 'clinic_set';
    }
    if (/\b(nursery|kids|child|play\s*room|kindergarten|daycare)\b/.test(firstLine)) {
        return 'nursery_set';
    }
    if (/\b(reception|lobby)\b/.test(firstLine) && /\b(counter|desk|set|waiting)\b/.test(full)) {
        return 'reception_set';
    }
    if (/\b(meeting\s*room|conference\s*room|boardroom)\b/.test(firstLine)) {
        return 'meeting_set';
    }
    if (/\b(lounge|waiting\s*area|waiting\s*room|vip\s*lounge|majlis|sofa\s*set|seating\s*set)\b/.test(firstLine)) {
        return 'seating_set';
    }
    if (/\b(executive\s*office|manager\s*office|director|workstation|desking|office\s*set|office\s*furniture\s*set)\b/.test(firstLine)) {
        return 'desking_set';
    }
    // Secondary signals from body
    if (/\b(sofa|armchair|sponge|fabric)\b/.test(full) && !/\boffice\s*desk\b/.test(full)) {
        return 'seating_set';
    }
    if (/\b(office\s*desk|workstation|executive\s*desk)\b/.test(full)) {
        return 'desking_set';
    }
    return 'custom_set';
}

/**
 * Detects whether a BOQ row represents a multi-item Furniture Set.
 * Returns the detected Set Type ID (e.g. 'outdoor_set', 'seating_set') or null for standard single items.
 */
export function detectFurnitureSetType(description = '', unit = '') {
    const raw = String(description || '');
    if (!raw.trim()) return null;

    const firstLine = raw.split(/[\r\n|]+/)[0].trim().toLowerCase();
    const unitNorm = String(unit || '').trim().toLowerCase();
    const isLumpUnit = /^(lum|lump|ls|l\.s\.?|set|sets|lot)$/.test(unitNorm);

    const hasExplicitSetHeadline = /\b(furniture\s*set|sofa\s*set|lounge\s*set|dining\s*set|seating\s*set|desking\s*set|office\s*set|library\s*set|meeting\s*set|room\s*set|workstation\s*set|workstation\s*cluster|modular\s*seating\s*set|modular\s*sofa\s*set)\b/i.test(firstLine);
    // Avoid catching single accessories like "SIDE TABLE FOR SOFA SET"
    if (/^(side\s*table|coffee\s*table|center\s*table|lamp|cushion|rug|carpet)\s+for\b/i.test(firstLine)) {
        return null;
    }
    if (hasExplicitSetHeadline) {
        return inferSetTypeFromText(raw);
    }

    // Also auto-detect lump-sum / set workstations & modular seating concepts
    if (isLumpUnit && /\b(workstation|cluster|modular\s*seating|modular\s*sofa|lounge|furniture|set)\b/i.test(firstLine)) {
        return inferSetTypeFromText(raw);
    }

    // Check for multi-component dimension specs or multiple bulleted furniture items under LUM/Set unit
    const dimMatches = raw.match(/dimension\s+[a-z]\s*[:\-]/gi) || [];
    if (dimMatches.length >= 2) {
        return inferSetTypeFromText(raw);
    }

    if (isLumpUnit) {
        const bulletCount = extractNamedBulletComponents(raw, 'custom_set').length;
        if (bulletCount >= 2) {
            return inferSetTypeFromText(raw);
        }
    }

    return null;
}

const SKIP_BULLET_LINE = /^(warranty|origin|inner\s*frame|frame|sponge|fabric|cloth|footpads?|feet|panel|tripod|color\s*matching|accessories|note|remark|total|supplier|model|item|dimension\s+[a-z]|[a-z]\s*\*\s*\d+\s*nos?)\b/i;

const FURNITURE_ITEM_NOUN = /\b(sofa|couch|armchair|chair|stool|bench|pouf|ottoman|table|desk|workstation|cabinet|credenza|bookcase|shelf|shelving|rack|wardrobe|counter|pedestal|bed|booth|pod|lounger|recliner|divan|seating|mirror|lamp|planter)\b/i;

/**
 * Pass 1: Extracts explicit named component bullets like:
 *   "* Corner Sofa - Azur - 11 Nos"
 *   "* Office Desk * 2 Nos"
 *   "* 3 Seater Outdoor Sofa - Maroc - 5 Nos"
 */
function extractNamedBulletComponents(description = '', setType = 'custom_set') {
    const raw = String(description || '');
    // Strip trailing pipe metadata (| TOTAL: ... | Supplier: ...)
    const bodyOnly = raw.split(/\s*\|\s*(?:TOTAL|Supplier|Model|Item|Qty|Unit)\b/i)[0] || raw;
    const lines = bodyOnly.split(/\r?\n/).slice(1); // Skip headline line

    const prefix = getSetTypeMeta(setType).matchPrefix;
    const results = [];

    for (const line of lines) {
        const cleaned = line.replace(/^[\s*•\-–—]+/, '').replace(/^\d+[.)]\s*/, '').trim();
        if (!cleaned || cleaned.length < 4) continue;
        if (SKIP_BULLET_LINE.test(cleaned)) continue;
        if (!FURNITURE_ITEM_NOUN.test(cleaned)) continue;

        let qty = '1';
        let unit = 'Nos';
        let itemLabel = cleaned;

        // Pattern A: "Office Desk * 2 Nos" or "Clinic Bed x 1 No"
        const multMatch = cleaned.match(/^(.*?)\s*[*×x]\s*(\d+(?:\.\d+)?)\s*(nos?|pcs?|units?|sets?|ea)?\s*$/i);
        // Pattern B: "Corner Sofa - Azur - 11 Nos" or "Coffee Table - 16 Nos"
        const dashQtyMatch = cleaned.match(/^(.*?)\s*[-–—:,]\s*(\d+(?:\.\d+)?)\s*(nos?|pcs?|units?|sets?|ea)\s*$/i);
        // Pattern C: "11 Nos Corner Sofa"
        const leadingQtyMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(nos?|pcs?|units?|sets?)\s+(?:of\s+)?(.+)$/i);

        if (multMatch && multMatch[1].trim().length >= 3) {
            itemLabel = multMatch[1].trim();
            qty = multMatch[2];
            if (multMatch[3]) unit = normalizeSubUnit(multMatch[3]);
        } else if (dashQtyMatch && dashQtyMatch[1].trim().length >= 3) {
            itemLabel = dashQtyMatch[1].trim();
            qty = dashQtyMatch[2];
            if (dashQtyMatch[3]) unit = normalizeSubUnit(dashQtyMatch[3]);
        } else if (leadingQtyMatch && leadingQtyMatch[3].trim().length >= 3) {
            qty = leadingQtyMatch[1];
            unit = normalizeSubUnit(leadingQtyMatch[2]);
            itemLabel = leadingQtyMatch[3].trim();
        } else {
            // Only accept bullet without explicit qty if it's concise (not a long material paragraph)
            if (cleaned.length > 75) continue;
        }

        // Remove trailing punctuation/separators
        itemLabel = itemLabel.replace(/[-–—:,*]+$/, '').trim();
        if (!itemLabel || !FURNITURE_ITEM_NOUN.test(itemLabel)) continue;

        const needsPrefix = prefix
            && !itemLabel.toLowerCase().includes(prefix.toLowerCase())
            && (setType === 'outdoor_set' || setType === 'cafeteria_set' || setType === 'library_set');
        const matchDesc = needsPrefix ? `${prefix} ${itemLabel}` : itemLabel;

        results.push({
            label: itemLabel,
            description: matchDesc,
            modelHint: extractComponentModelHint(itemLabel),
            qty,
            unit
        });
    }

    return results;
}

function normalizeSubUnit(u = '') {
    const low = String(u || '').toLowerCase();
    if (/^no/.test(low)) return 'Nos';
    if (/^pc/.test(low)) return 'Pcs';
    if (/^set/.test(low)) return 'Set';
    if (/^unit/.test(low)) return 'Unit';
    return 'Nos';
}

/**
 * Infers an intuitive furniture type from physical W x D x H (or Dia x H) dimensions + Set Type context.
 */
function inferPieceTypeFromDimensions({ widthMm, depthMm, heightMm, diaMm, setType, rawBody = '' }) {
    const bodyLow = rawBody.toLowerCase();

    // 1. Round tables (Dia x H)
    if (diaMm > 0) {
        if (heightMm > 0 && heightMm <= 620) {
            return diaMm >= 720 ? 'Round Coffee Table' : 'Round Side Table';
        }
        return setType === 'cafeteria_set' ? 'Round Cafeteria Dining Table' : 'Round Meeting / Bistro Table';
    }

    // 2. Tall storage cabinets / shelving
    if (heightMm >= 1350 && widthMm > 0 && depthMm <= 700) {
        return setType === 'library_set' ? 'Library Bookcase / High Shelving' : 'High Storage Cabinet';
    }

    // 3. Low tables (coffee / side tables)
    if (heightMm > 0 && heightMm <= 530 && widthMm > 0) {
        // Check if body explicitly mentions pouf/ottoman vs table
        if (widthMm >= 750) {
            return setType === 'outdoor_set' ? 'Outdoor Coffee Table' : 'Coffee Table';
        }
        return setType === 'outdoor_set' ? 'Outdoor Side Table' : 'Side Table';
    }

    // 4. Cafeteria / Dining sets
    if (setType === 'cafeteria_set') {
        if (widthMm >= 1000 && depthMm >= 700 && heightMm >= 680 && heightMm <= 820) return 'Cafeteria Dining Table';
        if (widthMm >= 1200 && depthMm > 0 && depthMm < 700) return 'Cafeteria Banquette / 2-Seater Bench';
        if (widthMm > 0 && widthMm <= 750) return 'Cafeteria Dining Chair';
    }

    // 5. Desking / Meeting / Library / Clinic sets
    if (['desking_set', 'meeting_set', 'library_set', 'clinic_set'].includes(setType)) {
        if (widthMm >= 1800 && depthMm >= 900 && heightMm >= 700 && heightMm <= 800) {
            return 'Conference / Meeting Table';
        }
        if (widthMm >= 1100 && depthMm >= 600 && heightMm >= 700 && heightMm <= 800) {
            return setType === 'library_set' ? 'Library Study Table' : 'Office Desk';
        }
        if (widthMm > 0 && widthMm <= 760 && heightMm >= 750) {
            return 'Office / Conference Chair';
        }
    }

    // 6. Lounge / Courtyard / Waiting / Outdoor / Reception soft seating sets
    if (widthMm >= 1850) {
        return setType === 'outdoor_set' ? 'Outdoor Three Seater Sofa' : 'Three Seater Sofa';
    }
    if (widthMm >= 1300) {
        return setType === 'outdoor_set' ? 'Outdoor Two Seater Sofa' : 'Two Seater Sofa';
    }
    if (widthMm >= 650 && (heightMm === 0 || heightMm >= 580)) {
        return setType === 'outdoor_set' ? 'Outdoor Lounge Armchair' : 'Single Seater Armchair';
    }

    if (/\b(sofa|sponge|fabric|leather)\b/.test(bodyLow)) {
        return 'Lounge Seating';
    }
    return 'Furniture Component';
}

/**
 * Pass 2: Extracts coded dimension items like:
 *   "* A * 3 Nos + B * 6 Nos + C * 3 Nos + D * 6 Nos"
 *   "* Dimension A : A9051-A - W2325 X D800 X H720 mm"
 *   "* Dimension D : T61A - Dia1100 X H350 mm"
 */
function extractCodedDimensionComponents(description = '', setType = 'custom_set') {
    const raw = String(description || '');
    const bodyOnly = raw.split(/\s*\|\s*(?:TOTAL|Supplier|Model|Item|Qty|Unit)\b/i)[0] || raw;

    // 1. Parse quantity mapping: "A * 3 Nos", "B * 6 Nos", "F*14 Nos", "C&D * 1 No"
    const qtyMap = {};
    const qtyRegex = /\b([A-G](?:\s*&\s*[A-G])?)\s*[*×]\s*(\d+)\s*(?:nos?|sets?|pcs?)?/gi;
    let qm;
    while ((qm = qtyRegex.exec(bodyOnly)) !== null) {
        const codes = qm[1].toUpperCase().split('&').map(s => s.trim());
        for (const c of codes) {
            if (!qtyMap[c]) qtyMap[c] = qm[2];
        }
    }

    // 2. Parse Dimension A / B / C / D / E / F lines
    const results = [];
    const dimLineRegex = /dimension\s+([A-G])\s*[:\-]\s*([^\r\n]+)/gi;
    let dm;
    while ((dm = dimLineRegex.exec(bodyOnly)) !== null) {
        const code = dm[1].toUpperCase();
        const specLine = dm[2].trim();

        const wMatch = specLine.match(/\bW\s*(\d{3,5})\b/i);
        const dMatch = specLine.match(/\bD\s*(\d{3,5})\b/i);
        const hMatch = specLine.match(/\bH\s*(\d{3,5})\b/i);
        const diaMatch = specLine.match(/\bDia\.?\s*(\d{3,5})\b/i);

        const widthMm = wMatch ? parseInt(wMatch[1], 10) : 0;
        const depthMm = dMatch ? parseInt(dMatch[1], 10) : 0;
        // Sanity clamp typo heights like H6900 -> 690
        let heightMm = hMatch ? parseInt(hMatch[1], 10) : 0;
        if (heightMm > 3000) heightMm = Math.round(heightMm / 10);
        const diaMm = diaMatch ? parseInt(diaMatch[1], 10) : 0;

        // Extract supplier code prefix if present (e.g. "A9051-A", "T67-A", "H-239A")
        const refMatch = specLine.match(/^([A-Z0-9][A-Z0-9\-_]{1,14})\s*[-–—]\s*/i);
        const refCode = refMatch ? refMatch[1].trim() : '';

        const inferredPiece = inferPieceTypeFromDimensions({
            widthMm, depthMm, heightMm, diaMm, setType, rawBody: bodyOnly
        });

        const dimSummary = diaMm
            ? `Dia ${diaMm}${heightMm ? ` × H${heightMm}` : ''} mm`
            : [widthMm && `W${widthMm}`, depthMm && `D${depthMm}`, heightMm && `H${heightMm}`].filter(Boolean).join(' × ') + (widthMm ? ' mm' : '');

        const label = `${code} — ${inferredPiece}${dimSummary ? ` (${dimSummary})` : ''}`;
        const matchDescription = [
            inferredPiece,
            dimSummary ? `Dimensions: ${dimSummary}` : '',
            refCode ? `Ref: ${refCode}` : ''
        ].filter(Boolean).join(' | ');

        results.push({
            label,
            description: matchDescription,
            modelHint: extractComponentModelHint(label, refCode),
            qty: qtyMap[code] || '1',
            unit: 'Nos'
        });
    }

    return results;
}

/**
 * Parses a BOQ set row into structured sub-components.
 * Priority:
 *  1. Explicit named bullets with quantities ("* Corner Sofa - Azur - 11 Nos")
 *  2. Coded dimension lines ("Dimension A : A9051-A - W2325 X D800 X H720 mm")
 *  3. Default template slots for the chosen Set Type
 */
export function parseSetComponentsFromDescription(description = '', setType = 'custom_set', parentId = 'set') {
    const effectiveType = setType && setType !== 'single' ? setType : inferSetTypeFromText(description);
    const parentBrand = extractParentSupplierContext(description);

    // 1. Named bullets
    const namedBullets = extractNamedBulletComponents(description, effectiveType);
    if (namedBullets.length >= 2) {
        return namedBullets.map((item, idx) => createEmptySetComponent(parentId, idx, { ...item, parentBrand }));
    }

    // 2. Coded dimensions (A/B/C/D)
    const codedDims = extractCodedDimensionComponents(description, effectiveType);
    if (codedDims.length >= 2) {
        return codedDims.map((item, idx) => createEmptySetComponent(parentId, idx, { ...item, parentBrand }));
    }

    // 3. Template fallback for the selected Set Type
    const meta = getSetTypeMeta(effectiveType);
    const slots = meta.defaultSlots && meta.defaultSlots.length > 0
        ? meta.defaultSlots
        : FURNITURE_SET_TYPE_MAP.custom_set.defaultSlots;

    return slots.map((slot, idx) => createEmptySetComponent(parentId, idx, { ...slot, parentBrand }));
}

/**
 * Rolls up all component items back onto the parent lump-sum BOQ row so:
 * - Original BOQ row count, SL numbering, and Lump-Sum structure stay intact.
 * - Parent BRAND IMG collects all matched component photos.
 * - Parent BRAND DESC compiles a structured itemized summary.
 * - Parent RATE / BASE PRICE / AMOUNT auto-sum SUM(subQty * subRate) when priced.
 */
export function computeSetParentRollup(parentRow, setItems = []) {
    if (!parentRow || !Array.isArray(setItems) || setItems.length === 0) {
        return parentRow;
    }

    const meta = getSetTypeMeta(parentRow.setType);
    const matchedItems = setItems.filter(it => it.selectedBrand || it.selectedModel || it.brandImage);

    const uniqueBrands = Array.from(new Set(setItems.map(it => (it.selectedBrand || '').trim()).filter(Boolean)));
    const uniqueModels = Array.from(new Set(setItems.map(it => (it.selectedModel || '').trim()).filter(Boolean)));
    const allImages = Array.from(new Set(setItems.map(it => (it.brandImage || '').trim()).filter(Boolean)));
    const firstLogo = setItems.find(it => it.brandLogo)?.brandLogo || parentRow.brandLogo || '';

    // Sum component amounts for 1 Set
    let sumRatePerSet = 0;
    let sumBasePerSet = 0;
    let hasAnyPricedItem = false;

    for (const item of setItems) {
        const subQty = parseFloat(item.qty) || 0;
        const subRate = parseFloat(item.rate) || 0;
        const subBase = parseFloat(item.basePrice) || subRate;
        if (subRate > 0 && subQty > 0) {
            sumRatePerSet += subQty * subRate;
            hasAnyPricedItem = true;
        }
        if (subBase > 0 && subQty > 0) {
            sumBasePerSet += subQty * subBase;
        }
    }

    // Build clean itemized parent brand description
    const headerLine = `[${meta.label} — ${setItems.length} Components]`;
    const itemLines = setItems.map((it, idx) => {
        const qtyPart = `${it.qty || 1} ${it.unit || 'Nos'}`;
        const brandModel = [it.selectedBrand, it.selectedModel].filter(Boolean).join(' — ');
        const specText = brandModel || it.label || it.description || `Component ${idx + 1}`;
        const pricePart = parseFloat(it.rate) > 0 ? ` @ ${parseFloat(it.rate).toFixed(2)}` : '';
        return `• ${idx + 1}. ${it.label || it.description} (${qtyPart}): ${specText}${pricePart}`;
    });
    const compiledBrandDesc = matchedItems.length > 0
        ? [headerLine, ...itemLines].join('\n')
        : parentRow.brandDesc || '';

    const parentQtyNum = parseFloat(parentRow.qty) || 1;
    const nextRate = hasAnyPricedItem ? sumRatePerSet.toFixed(2) : parentRow.rate;
    const nextAmount = hasAnyPricedItem ? (sumRatePerSet * parentQtyNum).toFixed(2) : parentRow.amount;
    const nextBasePrice = sumBasePerSet > 0 ? sumBasePerSet : (parentRow.basePrice || 0);

    // Aggregate AI status across components
    const anyProcessing = setItems.some(it => it.aiStatus === 'processing');
    const anySuccess = setItems.some(it => it.aiStatus === 'success');
    const allError = setItems.length > 0 && setItems.every(it => it.aiStatus === 'error' || it.aiStatus === 'no_match');
    const nextAiStatus = anyProcessing
        ? 'processing'
        : anySuccess
            ? 'success'
            : allError
                ? 'error'
                : (parentRow.aiStatus === 'processing' ? 'idle' : (parentRow.aiStatus || 'idle'));

    return {
        ...parentRow,
        setItems,
        selectedBrand: uniqueBrands.length > 0 ? uniqueBrands.join(' + ') : (parentRow.selectedBrand || ''),
        selectedModel: uniqueModels.length > 0
            ? (uniqueModels.length <= 3 ? uniqueModels.join(' + ') : `${uniqueModels.slice(0, 2).join(' + ')} +${uniqueModels.length - 2} more`)
            : (parentRow.selectedModel || ''),
        selectedMainCat: meta.label,
        selectedSubCat: `${setItems.length} Components`,
        brandImage: allImages[0] || parentRow.brandImage || '',
        brandImages: allImages,
        brandLogo: firstLogo,
        brandDesc: compiledBrandDesc,
        basePrice: nextBasePrice,
        rate: nextRate,
        amount: nextAmount,
        aiStatus: nextAiStatus
    };
}
