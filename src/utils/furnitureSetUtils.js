/**
 * Furniture Set Detection, Component Parsing, Templates & Lump-Sum Rollup Utilities.
 *
 * Allows lump-sum multi-item BOQ rows (e.g. "OUTDOOR DINING AREA - FURNITURE SET",
 * "VIP LOUNGE - FURNITURE SET", "CLINIC - FURNITURE SET", "LIBRARY SET") to be
 * assigned a dedicated Set Type, decomposed into per-piece matched components, and
 * rolled back up into the parent lump-sum row while preserving original BOQ order.
 *
 * System sets: every workstation, L-shape desk and group of folding tables is an ACTIVE set
 * (matched as one same-manufacturer system). A single conference / meeting table stays a
 * single item and carries a SET OPTION — "set of N folding tables" — shown below its row.
 * See resolveRowSetPlan() and the row-level helpers at the end of this file.
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
        id: 'l_shape_desk_set',
        label: 'L-Shape Desk Set',
        shortLabel: 'L-Shape Desk Set',
        matchPrefix: 'Office',
        defaultSlots: [
            { label: 'Executive / Main Desk', description: 'Executive Office Main Desk', componentRole: 'executive_desk', qty: '1', unit: 'Nos' },
            { label: 'Side Return Storage Credenza', description: 'Side Return Storage Cabinet Credenza for L-Shape Desk', componentRole: 'side_return', qty: '1', unit: 'Nos' },
            { label: 'Modesty Panel & Cable Access', description: 'Under-Desk Modesty Panel & Cable Management', componentRole: 'modesty_panel', qty: '1', unit: 'Nos' }
        ]
    },
    {
        id: 'folding_meeting_set',
        label: 'Modular Folding Conference Set',
        shortLabel: 'Folding Conference Set',
        matchPrefix: 'Conference',
        defaultSlots: [
            { label: 'Flip-Top Folding Conference Table', description: 'Mobile Flip-Top Folding Conference Meeting Table on Lockable Castors', componentRole: 'folding_table', qty: '4', unit: 'Nos' },
            { label: 'Power & Data Access Module', description: 'Integrated Power & Data Socket Module for Conference Table', componentRole: 'power_box', qty: '2', unit: 'Nos' },
            { label: 'Under-Table Modesty / Cable Tray', description: 'Modesty Panel and Cable Management Tray for Folding Conference Table', componentRole: 'cable_management', qty: '4', unit: 'Nos' }
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
        componentRole: partial.componentRole || '',
        // Positions / seats this component stands for in ONE set (kept even when a cluster product changes its qty)
        seatCount: Number(partial.seatCount) > 0 ? Number(partial.seatCount) : undefined,
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

const STANDALONE_ACCESSORY_PREFIX_RE = /^(?:side\s*table|coffee\s*table|center\s*table|lamp|cushion|rug|carpet|task\s*chair|office\s*chair|workstation\s*(?:task\s*)?chair|conference\s*chair|meeting\s*chair|acoustic\s*screen|divider\s*screen|privacy\s*screen|modesty\s*panel|cable\s*tray|power\s*box|mobile\s*pedestal|pedestal|monitor\s*arm|cpu\s*holder)\b/i;

const WORKSTATION_SYSTEM_RE = /\b(?:(?:linear|open[\s-]?plan|modular|single[-\s]?sided|double[-\s]?sided|back[-\s]?to[-\s]?back|face[-\s]?to[-\s]?face|sit[-\s]?stand|height[-\s]?adjustable|staff|manager|operational|bench)\s+(?:back[-\s]?to[-\s]?back\s+|face[-\s]?to[-\s]?face\s+|single[-\s]?sided\s+|double[-\s]?sided\s+|modular\s+|linear\s+)?workstation|workstation\s+(?:desk\s+|bench\s+|table\s+)?(?:system|set|cluster|bench|unit|station)|bench\s+workstation|workstation\s+bench|cluster\s+(?:of\s+)?\d+\s*workstation|(?:[2-9]|1[0-2])[-\s]?(?:way|pax|person|seater|seat|user|station)\s+(?:linear\s+|back[-\s]?to[-\s]?back\s+|modular\s+)?workstation|120\s*(?:deg|°)\s*(?:3[-\s]?way\s+)?workstation|\bworkstation\b)\b/i;

const L_SHAPE_DESK_SET_RE = /\b(?:l[-\s]?shaped?\s+(?:executive\s+|manager(?:ial)?\s+|director\s+|office\s+|workstation\s+|corner\s+)?desks?|executive\s+l[-\s]?shaped?\s+desks?|manager(?:ial)?\s+l[-\s]?shaped?\s+desks?|(?:executive|manager(?:ial)?|director|office|staff)\s+desks?\s*(?:with|w\/|\+|,|and|&|featuring|including|incl\.?|c\/w)\s+(?:attached\s+|integrated\s+|matching\s+)?(?:side\s*)?returns?|corner\s+(?:office\s+|executive\s+|manager(?:ial)?\s+)?desks?\s+(?:with|w\/|featuring)\s+(?:returns?|storage|pedestals?|credenzas?))\b/i;

/** Desks that are joinery / counters, never decomposed into "desk + side return" sets. */
const NON_OFFICE_DESK_HEADLINE_RE = /\b(?:reception|counters?|cashier|security|concierge|nurses?|teller|check[-\s]?in|information\s+desk|help\s*desk|bar|lectern|podium)\b/i;

/** Headlines that are workstation ACCESSORIES or IT hardware, not furniture workstation systems. */
const WORKSTATION_ACCESSORY_HEADLINE_RE = /\bworkstations?\s+(?:task\s+|office\s+|desk\s+)?(?:screens?|partitions?|dividers?|pedestals?|chairs?|seating|accessor(?:y|ies)|modesty|cable|power|monitor|lamps?|lights?|lighting|storage|cabinets?|lockers?|shel(?:f|ves|ving)|credenzas?|cadd(?:y|ies))\b|\b(?:screens?|partitions?|dividers?|pedestals?|chairs?|panels?|lockers?|cabinets?|storage|lights?|lighting|sockets?|power\s*(?:box(?:es)?|modules?))\s+(?:for|to|at|of|between)\s+(?:the\s+|each\s+)?(?:staff\s+|office\s+|open\s+office\s+)?workstations?\b/i;
const IT_WORKSTATION_HEADLINE_RE = /\b(?:pc|computers?|laptops?|intel|xeon|ryzen|core\s*i[3579]|\d+\s*gb|ssd|hdd|gpu|nvidia|windows|dell|lenovo|thinkstation|servers?|software|licen[sc]es?|docking)\b/i;

/** Dynamic system sets that are resolved as ONE cohesive same-manufacturer system by the backend set matcher. */
export const SYSTEM_SET_TYPES = ['workstation_set', 'l_shape_desk_set', 'folding_meeting_set', 'meeting_set'];

export function isSystemSetType(setType) {
    return SYSTEM_SET_TYPES.includes(setType);
}

const SET_UNIT_RE = /^(?:lum|lump|lumpsum|lump\s*sum|ls|l\.s\.?|set|sets|lot|lots|cluster|clusters)$/i;

function isSetLikeUnit(unit = '') {
    return SET_UNIT_RE.test(String(unit || '').trim());
}

function splitHeadline(description = '') {
    return String(description || '').split(/[\r\n|]+/)[0].trim();
}

function stripPipeMetadata(description = '') {
    const raw = String(description || '');
    return raw.split(/\s*\|\s*(?:TOTAL|Supplier|Model|Item|Qty|Unit)\b/i)[0] || raw;
}

/** Formats a component quantity (keeps shared half-quantities such as 0.5 readable). */
function fmtQty(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '1';
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/**
 * Parses seating capacity from BOQ wording: "12 pax", "12-Pax", "for 10 persons", "8-10 seater",
 * "seats up to 14", "capacity of 16". Returns 0 when no capacity is stated.
 */
export function parseSeatingCapacity(text = '') {
    const s = String(text || '');
    const range = s.match(/\b(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*[-\s]?(?:pax|persons?|people|seaters?|seats?|users?|delegates?|attendees?|participants?)\b/i);
    if (range) return Math.max(parseInt(range[1], 10), parseInt(range[2], 10));
    const direct = s.match(/\b(\d{1,2})\s*[-\s]?(?:pax|persons?|people|seaters?|seats?|users?|delegates?|attendees?|participants?)\b/i);
    if (direct) return parseInt(direct[1], 10);
    const reversed = s.match(/\b(?:seats?|seating\s*(?:for|capacity(?:\s*of)?)|capacity(?:\s*of)?|accommodates?)\s*(?:up\s*to\s*)?(\d{1,2})\b/i);
    if (reversed) return parseInt(reversed[1], 10);
    return 0;
}

/**
 * Parses furniture plan dimensions and normalises them to millimetres.
 * Supports "4200 x 1400 x 750 mm", "W1400 x D700 x H750", "160x80 cm", "4.2 x 1.4 m".
 * `lengthMm` is always the longer plan side and `depthMm` the shorter one.
 */
export function parseFurnitureDimensions(text = '') {
    const s = String(text || '');
    const out = { lengthMm: 0, depthMm: 0, heightMm: 0, text: '' };
    const toMm = (val, unit) => {
        const n = parseFloat(val);
        if (!Number.isFinite(n)) return 0;
        if (unit === 'm') return Math.round(n * 1000);
        if (unit === 'cm') return Math.round(n * 10);
        return Math.round(n);
    };

    let a = 0;
    let b = 0;
    let h = 0;
    const mm3 = s.match(/(?:\b[LWD]\s*)?(\d{3,4})\s*(?:mm)?\s*[×xX*]\s*(?:[LWD]\s*)?(\d{3,4})\s*(?:mm)?\s*[×xX*]\s*(?:H\s*)?(\d{3,4})\s*(mm|cm)?\b/);
    const mm2 = !mm3 ? s.match(/(?:\b[LWD]\s*)?(\d{3,4})\s*(?:mm)?\s*[×xX*]\s*(?:[LWD]\s*)?(\d{3,4})\s*(mm|cm)?\b/) : null;
    const cm2 = (!mm3 && !mm2) ? s.match(/\b(\d{2,3})\s*[×xX*]\s*(\d{2,3})(?:\s*[×xX*]\s*(\d{2,3}))?\s*cm\b/i) : null;
    const m2 = (!mm3 && !mm2 && !cm2) ? s.match(/\b(\d(?:[.,]\d{1,2})?)\s*m?\s*[×xX*]\s*(\d(?:[.,]\d{1,2})?)\s*m\b/i) : null;

    if (mm3) {
        const u = (mm3[4] || 'mm').toLowerCase();
        a = toMm(mm3[1], u); b = toMm(mm3[2], u); h = toMm(mm3[3], u);
    } else if (mm2) {
        const u = (mm2[3] || 'mm').toLowerCase();
        a = toMm(mm2[1], u); b = toMm(mm2[2], u);
    } else if (cm2) {
        a = toMm(cm2[1], 'cm'); b = toMm(cm2[2], 'cm'); h = cm2[3] ? toMm(cm2[3], 'cm') : 0;
    } else if (m2) {
        a = toMm(String(m2[1]).replace(',', '.'), 'm'); b = toMm(String(m2[2]).replace(',', '.'), 'm');
    }

    if (a > 0 && b > 0) {
        out.lengthMm = Math.max(a, b);
        out.depthMm = Math.min(a, b);
        out.heightMm = h;
        out.text = h > 0 ? `${a} × ${b} × ${h} mm` : `${a} × ${b} mm`;
    }
    return out;
}

/**
 * Returns true if a BOQ row represents an L-Shaped Desk / Executive Desk with Side Return set.
 */
export function isLShapeDeskSetDescription(description = '') {
    const raw = String(description || '').trim();
    if (!raw) return false;
    const firstLine = splitHeadline(raw);
    if (STANDALONE_ACCESSORY_PREFIX_RE.test(firstLine)) return false;
    if (NON_OFFICE_DESK_HEADLINE_RE.test(firstLine)) return false;
    if (L_SHAPE_DESK_SET_RE.test(raw)) return true;
    // Also detect any "Desk ... with side return / return storage / return credenza"
    if (/\bdesks?\b/i.test(firstLine) && /\b(?:side\s*returns?|returns?\s*(?:desk|unit|storage|credenza|cabinet|wing)s?|l[-\s]?shaped?)\b/i.test(raw)) {
        return true;
    }
    return false;
}

// ── Conference / Meeting / Training table classification ─────────────────────────────────────

const MEETING_ROOM_WORD_RE = /\b(?:conference|meeting|board\s*room|boardroom|training|seminar|workshop|class\s*room|classroom|multi[-\s]?purpose|multipurpose|multi[-\s]?function(?:al)?|multi[-\s]?use|collaboration)\b/i;

/** Hard folding cues: the table itself folds / flips / nests. */
const FOLDING_HARD_CUE_RE = /\b(?:fold(?:ing|able|[-\s]?up|s)?|flip[-\s]?tops?|tilt(?:ing)?(?:[-\s]?tops?)?|nest(?:ing|able)|collapsible)\b/i;

/** Soft cues: the room/table is meant to be re-arranged, so a set of folding tables is a valid alternative. */
const MULTI_PURPOSE_CUE_RE = /\b(?:multi[-\s]?purpose|multipurpose|multi[-\s]?function(?:al)?|multi[-\s]?use|re[-\s]?configurable|flexible\s*(?:layout|configuration|use)|training|seminar|workshop|class\s*room|classroom|u[-\s]?shaped?\s*(?:layout|arrangement|configuration)|hollow\s*square)\b/i;

const NON_MEETING_TABLE_RE = /\b(?:coffee|side|end|center|centre|occasional|dining|cafeteria|canteen|pantry|bistro|bar|high|console|bedside|dressing|picnic|lab(?:oratory)?|drafting|billiard|pool|ping[-\s]?pong|operating|examination|changing)\s*(?:room\s*)?tables?\b/i;

const NON_TABLE_HEADLINE_NOUN_RE = /\b(?:chairs?|seating|sofas?|armchairs?|stools?|credenzas?|cabinets?|screens?|displays?|projectors?|podiums?|lecterns?|whiteboards?|carpets?|flooring|ceilings?|walls?|paint|lights?|lighting|cameras?|speakers?|microphones?|partitions?|doors?|curtains?|blinds?|desks?|workstations?)\b/i;

const CHAIR_ADJECTIVES = '(?:conference|meeting|training|boardroom|stackable|stacking|nesting|swivel|visitor|ergonomic|executive|leather|mesh|high[-\\s]?back|mid[-\\s]?back|low[-\\s]?back|upholstered|fabric|cantilever|sled[-\\s]?base|mobile|office|folding|matching)';
const INCLUDED_CHAIRS_RE = new RegExp(
    `(?:\\b(?:with|and|incl(?:uding|usive\\s+of)?\\.?|plus|complete\\s+with|along\\s+with)|c\\/w|&|\\+)\\s*(?:\\(?\\d{1,3}\\)?\\s*(?:nos?\\.?|x|pcs?\\.?)?\\s*)?(?:${CHAIR_ADJECTIVES}\\s+){0,3}chairs?\\b`
    + `|\\b\\d{1,3}\\s*(?:nos?\\.?|x|pcs?\\.?)?\\s*(?:${CHAIR_ADJECTIVES}\\s+){0,3}chairs?\\b`,
    'i'
);
const EXPLICIT_CHAIR_COUNT_RE = new RegExp(`\\b(\\d{1,3})\\s*(?:nos?\\.?|x|pcs?\\.?)?\\s*(?:${CHAIR_ADJECTIVES}\\s+){0,3}chairs?\\b`, 'i');
const EXCLUDED_CHAIRS_RE = /\b(?:excl(?:uding|usive\s+of)?\.?|without|not\s+incl(?:uded|uding)?\.?|w\/o)\b[^.;\n|]{0,40}\bchairs?\b|\bchairs?\b[^.;\n|]{0,40}\b(?:not\s+included|excluded|measured\s+(?:separately|elsewhere)|by\s+others|separately)\b/gi;

/** True when the table itself folds (ignores "flip-top power box" style accessory wording). */
function hasFoldingTableCue(text = '') {
    const cleaned = String(text || '')
        .replace(/\bflip[-\s]?(?:tops?|ups?|lids?)\s+(?:power|data|socket|box|access|cable|grommet|cover|module|outlet|panel|unit|lid|av)\w*/gi, ' ')
        .replace(/\b(?:power|data|socket|cable|access|av)\s+(?:&\s*data\s+|and\s+data\s+)?(?:box(?:es)?|modules?|units?|outlets?|sockets?)?\s*(?:with\s+)?flip[-\s]?(?:tops?|ups?|lids?)\b/gi, ' ');
    return FOLDING_HARD_CUE_RE.test(cleaned);
}

/** True when chairs are part of the row's supply (not just mentioned as excluded). */
function mentionsIncludedChairs(text = '') {
    const cleaned = String(text || '').replace(EXCLUDED_CHAIRS_RE, ' ');
    return INCLUDED_CHAIRS_RE.test(cleaned) || /\bchairs?\b/i.test(splitHeadline(cleaned));
}

/**
 * True when the BOQ headline is a conference / meeting / boardroom / training / multi-purpose table
 * (or a multi-purpose conference-meeting row written without the word "table").
 */
export function isMeetingTableHeadline(description = '') {
    const firstLine = splitHeadline(description);
    if (!firstLine) return false;
    if (STANDALONE_ACCESSORY_PREFIX_RE.test(firstLine)) return false;
    if (NON_MEETING_TABLE_RE.test(firstLine)) return false;

    if (/\btables?\b/i.test(firstLine)) {
        if (/\b(?:workstations?|desks?)\b/i.test(firstLine) && !MEETING_ROOM_WORD_RE.test(firstLine)) return false;
        return MEETING_ROOM_WORD_RE.test(firstLine) || hasFoldingTableCue(firstLine);
    }
    // "Multi-purpose conference / meeting" rows written without the word "table"
    return /\b(?:multi[-\s]?purpose|multipurpose|multi[-\s]?function(?:al)?)\b/i.test(firstLine)
        && /\b(?:conference|meeting|training|seminar)\b/i.test(firstLine)
        && !NON_TABLE_HEADLINE_NOUN_RE.test(firstLine);
}

/**
 * Seating capacity of ONE row unit. "Meeting tables for 20 persons" priced as 5 Nos seats 4 per table.
 */
function resolvePerUnitPax(description = '', unit = '', qty = undefined) {
    const pax = parseSeatingCapacity(stripPipeMetadata(description));
    const rowQty = parseFloat(qty);
    if (pax > 0 && rowQty > 1 && !isSetLikeUnit(unit) && /\btables\b/i.test(splitHeadline(description))) {
        return Math.max(1, Math.ceil(pax / rowQty));
    }
    return pax;
}

function isRoundTableSpec(description = '') {
    return /\b(?:round|circular|oval|elliptical)\b|\bdia(?:meter)?\.?\s*\d|[Øø]\s*\d/i.test(splitHeadline(description));
}

/**
 * Returns the ACTIVE meeting set type of a row, or null:
 *  - 'folding_meeting_set' when the row itself IS a group / set of folding (flip-top, nesting, training) tables
 *  - 'meeting_set' when a fixed conference table is specified together with other furniture (chairs, credenza)
 * A single conference / meeting table (even with integrated power & cable management) stays a
 * single item — see detectSetOptionType() for its additional "set of folding tables" option.
 */
export function detectMeetingSetType(description = '', unit = '', options = {}) {
    const raw = String(description || '').trim();
    if (!raw) return null;
    if (!isMeetingTableHeadline(raw)) return null;

    const firstLine = splitHeadline(raw);
    const body = stripPipeMetadata(raw);
    const setUnit = isSetLikeUnit(unit);
    const pax = resolvePerUnitPax(raw, unit, options.qty);
    // "Folding tables — 10 Nos": every unit is one table, never a set of tables
    const countedIndividually = !setUnit && parseFloat(options.qty) > 1;
    const pluralTables = /\btables\b/i.test(firstLine);
    const hardFolding = hasFoldingTableCue(body);
    const saysSetOfTables = /\btables?\s*(?:set|system|cluster|configuration|arrangement)\b|\b(?:set|cluster|group|configuration|arrangement)\s+of\s+(?:\d+\s+)?(?:(?:folding|foldable|flip[-\s]?top|nesting|training|mobile|modular|tilting)\s+)*tables?\b|\b(?:composed|made\s*up|consisting)\s+of\b[^.;\n|]*\btables\b/i.test(body);

    // A. The row itself is a set of folding / training tables
    const trainingTablesGroup = pluralTables && /\b(?:training|seminar|workshop|class\s*room|classroom)\b/i.test(firstLine)
        && (setUnit || (pax >= 6 && !countedIndividually));
    if ((hardFolding && (saysSetOfTables || setUnit || (pluralTables && pax >= 6 && !countedIndividually)))
        || (saysSetOfTables && MULTI_PURPOSE_CUE_RE.test(body))
        || trainingTablesGroup) {
        return 'folding_meeting_set';
    }

    // B. Fixed table specified together with other furniture pieces (chairs / credenza)
    if (/\b(?:credenzas?|sideboards?|buffets?)\b/i.test(body) || mentionsIncludedChairs(body)) {
        return 'meeting_set';
    }
    return null;
}

/**
 * Returns 'folding_meeting_set' when a single conference / meeting / training table row can ALSO be
 * supplied as a set of many folding tables — offered as an additional option BELOW the row's
 * single-table item (the row itself stays a single item).
 */
export function detectSetOptionType(description = '', unit = '', options = {}) {
    const raw = String(description || '').trim();
    if (!raw) return null;
    if (!isMeetingTableHeadline(raw)) return null;
    if (isRoundTableSpec(raw)) return null;
    if (detectMeetingSetType(raw, unit, options)) return null;

    const body = stripPipeMetadata(raw);
    const pax = resolvePerUnitPax(raw, unit, options.qty);
    const dims = parseFurnitureDimensions(body);
    const capacityCue = pax >= 6 || dims.lengthMm >= 2400;
    const hardFolding = hasFoldingTableCue(body);
    const multiPurpose = MULTI_PURPOSE_CUE_RE.test(body);
    const countedIndividually = !isSetLikeUnit(unit) && parseFloat(options.qty) > 1;

    // A row that is itself ONE folding table module is already the folding item — no set option needed
    if (hardFolding && (!capacityCue || countedIndividually)) return null;
    // Small fixed meeting tables (≤ 5 pax / < 2.4 m) are not replaced by table clusters
    if (!capacityCue && !multiPurpose) return null;
    if (!capacityCue && ((pax > 0 && pax < 6) || (dims.lengthMm > 0 && dims.lengthMm < 2000))) return null;

    return 'folding_meeting_set';
}

/**
 * Returns true if a BOQ row represents ANY workstation system (linear, back-to-back, bench,
 * cluster, single-sided, sit-stand, L-shape workstation) that should be dynamically decomposed.
 */
export function isWorkstationSetDescription(description = '') {
    const raw = String(description || '').trim();
    if (!raw) return false;
    const firstLine = splitHeadline(raw);

    // Never hijack standalone chairs, screens, pedestals, cables, accessories or IT hardware
    if (STANDALONE_ACCESSORY_PREFIX_RE.test(firstLine)) return false;
    if (WORKSTATION_ACCESSORY_HEADLINE_RE.test(firstLine)) return false;
    if (IT_WORKSTATION_HEADLINE_RE.test(firstLine)) return false;

    // L-shape desks are handled by isLShapeDeskSetDescription unless explicitly titled "Workstation"
    if (!/\bworkstations?\b/i.test(firstLine) && isLShapeDeskSetDescription(raw)) {
        return false;
    }

    if (WORKSTATION_SYSTEM_RE.test(firstLine) || /\b(?:linear|back[-\s]?to[-\s]?back|face[-\s]?to[-\s]?face|bench|cluster)\s+workstation\b/i.test(raw)) {
        return true;
    }

    // Every workstation headline is a workstation system ("Staff Workstation", "30 Open Office Workstations")
    if (/\bworkstations?\b/i.test(firstLine)) {
        return true;
    }

    // Bench desks / desking clusters written without the word "workstation"
    if (/\b(?:bench\s*desk(?:ing)?s?|desk(?:ing)?\s*bench(?:es)?|desking\s*(?:system|cluster)|cluster\s+(?:of\s+)?\d+\s*desks?|back[-\s]?to[-\s]?back\s+desks?|face[-\s]?to[-\s]?face\s+desks?)\b/i.test(firstLine)) {
        return true;
    }

    return false;
}

/**
 * Unified dynamic system-set classifier used across BOQ loading and AI matching.
 * Returns the ACTIVE system set type of a row:
 * 'workstation_set' | 'l_shape_desk_set' | 'folding_meeting_set' | 'meeting_set' | null.
 * (The optional "set of folding tables" alternative of a single conference table is NOT an
 * active set — it is reported by detectSetOptionType().)
 */
export function isDynamicSystemSetDescription(description = '', unit = '', options = {}) {
    if (isWorkstationSetDescription(description)) return 'workstation_set';
    if (isLShapeDeskSetDescription(description)) return 'l_shape_desk_set';
    const meetingType = detectMeetingSetType(description, unit, options);
    if (meetingType) return meetingType;
    return null;
}

/**
 * Dynamically extracts the real workstation set components from a BOQ workstation specification,
 * scaling quantities PER PARENT ROW UNIT:
 *  - "per position" rows and plain count-unit rows (Nos / Pcs) price ONE position per unit, so
 *    Rate × Qty reproduces the exact BOQ total;
 *  - explicit clusters ("4-pax", "cluster of 6", "for 4 persons"), cluster dimensions
 *    (e.g. 2800 × 1400) and lump-sum / set units scale every component to the cluster size;
 *  - back-to-back benches share ONE central screen and cable tray between two facing positions.
 * L-shape workstations add their side return, 120° clusters default to 3 positions.
 */
export function extractWorkstationComponents(description = '', options = {}) {
    const raw = String(description || '');
    const bodyOnly = stripPipeMetadata(raw);
    const lower = bodyOnly.toLowerCase();
    const setUnit = isSetLikeUnit(options.unit);

    const isPerPosition = /\b(?:per\s*(?:position|seat|user|person|station|workstation|desk)|each\s*(?:position|seat|station)|\/\s*(?:position|seat|person|user))\b/i.test(bodyOnly);
    const saysBackToBack = /\b(?:back[-\s]?to[-\s]?back|face[-\s]?to[-\s]?face|double[-\s]?sided|dual[-\s]?sided|b2b)\b/i.test(bodyOnly);
    const isSingleSided = /\b(?:single[-\s]?sided|single\s*(?:linear|line|row)|side[-\s]?by[-\s]?side)\b/i.test(bodyOnly);
    const isSitStand = /\b(?:sit[-\s]?stand|height[-\s]?adjustable|motorized|motorised|electric\s*lift)\b/i.test(bodyOnly);
    const is120Deg = /\b120\s*(?:deg(?:ree)?s?|°)/i.test(bodyOnly);
    const isLShape = /\bl[-\s]?shaped?\b|\bcorner\s+workstation|\bwith\s+(?:a\s+)?(?:side\s*)?return\b|\breturn\s*(?:desk|unit|wing|extension)\b/i.test(bodyOnly);

    // Explicit cluster size (e.g. "4-pax", "6-way", "cluster of 4", "for 8 persons", "quad")
    let explicitSeats = 0;
    const paxMatch = bodyOnly.match(/\b([2-9]|1\d|20)\s*[-\s]?(?:way|pax|persons?|people|seaters?|seats?|users?|stations?|positions?|man)\b/i)
        || bodyOnly.match(/\bcluster\s*(?:of\s*)?([2-9]|1\d|20)\b/i);
    if (paxMatch && paxMatch[1]) {
        explicitSeats = parseInt(paxMatch[1], 10) || 0;
    } else if (is120Deg) {
        explicitSeats = 3;
    } else if (/\b(?:quad|4[-\s]?pack)\b/i.test(bodyOnly)) {
        explicitSeats = 4;
    } else if (/\b(?:twin|dual|double)\s+workstation\b/i.test(bodyOnly)) {
        explicitSeats = 2;
    }
    // "Workstations for 8 persons" priced as 8 Nos: the head-count is the row total, not a cluster size
    const rowQty = parseFloat(options.qty);
    const totalHeadcount = bodyOnly.match(/\bfor\s+(\d{1,2})\s*(?:persons?|people|users?|staff|employees?)\b/i);
    if (!setUnit && explicitSeats > 1 && rowQty > 1 && totalHeadcount && parseInt(totalHeadcount[1], 10) === rowQty && explicitSeats === rowQty) {
        explicitSeats = 0;
    }

    // Dimensions: a footprint of 2.2 m+ length or 1.15 m+ depth describes a CLUSTER (rows × desks per row);
    // L-shape footprints describe ONE desk with its return.
    const dims = parseFurnitureDimensions(bodyOnly);
    const footprintRows = dims.depthMm >= 1150 ? 2 : 1;
    const footprintPerRow = dims.lengthMm >= 2200 ? Math.max(1, Math.round(dims.lengthMm / 1400)) : 1;
    const footprintSeats = (!isLShape && !isPerPosition && dims.lengthMm > 0) ? footprintRows * footprintPerRow : 0;
    const dimsAreCluster = footprintSeats > 1;

    // Positions covered by ONE parent row unit
    let seatCount = 1;
    if (isPerPosition) {
        seatCount = 1;
    } else if (explicitSeats > 0) {
        seatCount = explicitSeats;
    } else if (dimsAreCluster) {
        seatCount = footprintSeats;
    } else if (setUnit) {
        seatCount = saysBackToBack ? 4 : 2;
    }

    // Benches / clusters of an even number of 4+ positions and two-row footprints face each other
    const isBackToBack = saysBackToBack || (!isSingleSided && !isLShape && !is120Deg && (
        (/\b(?:bench|cluster)\b/i.test(bodyOnly) && seatCount >= 4 && seatCount % 2 === 0)
        || (dimsAreCluster && footprintRows === 2)
    ));

    // Per-desk size (cluster footprints are split into their positions)
    let deskDimText = dims.text;
    let deskWidthMm = dims.lengthMm;
    if (dimsAreCluster) {
        const perRow = explicitSeats > 0 ? Math.max(1, Math.ceil(seatCount / footprintRows)) : footprintPerRow;
        const deskLenMm = Math.round(dims.lengthMm / perRow / 10) * 10;
        const deskDepthMm = Math.round(dims.depthMm / footprintRows / 10) * 10;
        deskDimText = `${deskLenMm} × ${deskDepthMm} mm`;
        deskWidthMm = deskLenMm;
    }

    // Components shared by two facing positions of a back-to-back bench (central screen / cable tray)
    const sharedQty = isBackToBack ? seatCount / 2 : seatCount;
    const sharedNote = (isBackToBack && seatCount === 1) ? ' — shared by 2 facing positions' : '';

    // Worktop material / thickness hint (e.g. "25 mm E1 MFC")
    const matMatch = bodyOnly.match(/\b(\d{2}\s*mm\s*(?:E1\s*)?(?:MFC|MDF|HPL|melamine|laminate|veneer)|E1\s*MFC|melamine\s*worktop|HPL\s*worktop|powder[\s-]?coated\s*steel\s*frame)\b/i);
    const matHint = matMatch ? matMatch[1].trim() : '';

    const layoutPrefix = isLShape
        ? 'L-Shape'
        : is120Deg
            ? '120° Cluster'
            : isBackToBack
                ? 'Linear Back-to-Back'
                : isSingleSided
                    ? 'Linear Single-Sided'
                    : 'Linear';

    const results = [];

    // 1. Core Workstation Desk / Bench Frame & Worktop (Always first — Anchor Component)
    results.push({
        label: `${layoutPrefix} Workstation ${isSitStand ? 'Sit-Stand ' : ''}Desk${deskDimText ? ` (${deskDimText})` : ''}`,
        description: [
            `${layoutPrefix} Office Workstation ${isSitStand ? 'Sit-Stand Height-Adjustable ' : ''}${isLShape ? 'Desk with Side Return' : 'Bench Desk'}`,
            deskDimText ? `Dimensions: ${deskDimText}` : '',
            dimsAreCluster ? `Cluster footprint: ${dims.text}` : '',
            matHint ? `Finish: ${matHint}` : '',
            seatCount > 1 ? `${seatCount}-Person Cluster` : 'Per Workstation Position'
        ].filter(Boolean).join(' | '),
        componentRole: 'workstation_desk',
        seatCount,
        qty: fmtQty(seatCount),
        unit: 'Nos',
    });

    // 1b. L-shape workstation side return
    if (isLShape) {
        const hasReturnStorage = /\b(?:return\s*(?:storage|credenza|cabinet|pedestal)|storage\s*return|credenza)\b/i.test(lower);
        results.push({
            label: hasReturnStorage ? 'Workstation Side Return Storage Unit' : 'Workstation Side Return Extension',
            description: hasReturnStorage
                ? 'Side Return Storage Credenza Unit for L-Shape Office Workstation'
                : 'Side Return Extension Worktop for L-Shape Office Workstation',
            componentRole: 'side_return',
            qty: fmtQty(seatCount),
            unit: 'Nos',
        });
    }

    // 2. Acoustic / Privacy Divider Screen
    const mentionsScreen = /\b(screens?|dividers?|partitions?|privacy\s*panels?|acoustic\s*panels?|pinboards?|tackboards?|baffles?|glass\s*dividers?)\b/i.test(bodyOnly);
    if (mentionsScreen) {
        const screenMat = /\bfrosted\s*glass|tempered\s*glass|glass\b/i.test(lower)
            ? 'Frosted Glass'
            : /\bpet\s*felt|felt\b/i.test(lower)
                ? 'PET Acoustic Felt'
                : 'Fabric Acoustic';
        results.push({
            label: `Desk-Mounted ${screenMat} Divider Screen${deskWidthMm ? ` (${deskWidthMm} mm)` : ''}${sharedNote}`,
            description: `Desk-Mounted ${screenMat} Privacy Divider Screen for Linear Workstation${deskWidthMm ? ` W${deskWidthMm} mm` : ''}`,
            componentRole: 'screen',
            qty: fmtQty(sharedQty),
            unit: 'Nos',
        });
    }

    // 3. Modesty Panel
    if (/\b(modesty\s*panels?|front\s*modesty|under[\s-]?desk\s*panels?|perforated\s*modesty)\b/i.test(bodyOnly)) {
        const modMat = /\bperforated|metal|steel\b/i.test(lower) ? 'Perforated Steel' : (matHint || 'MFC');
        results.push({
            label: `Workstation Modesty Panel${deskWidthMm ? ` (${deskWidthMm} mm)` : ''}`,
            description: `Under-Desk Modesty Panel (${modMat}) for Office Workstation${deskWidthMm ? ` W${deskWidthMm} mm` : ''}`,
            componentRole: 'modesty_panel',
            qty: fmtQty(seatCount),
            unit: 'Nos',
        });
    }

    // 4. Under-Desk Cable Management / Wire Tray
    if (/\b(cable\s*(?:trays?|management|channels?|troughs?|baskets?|spines?|ducts?|risers?|raceways?|trunking)|wire\s*(?:trays?|management|baskets?)|grommets?|flip[\s-]?tops?)\b/i.test(bodyOnly)) {
        results.push({
            label: `Under-Desk Cable Management Tray${sharedNote}`,
            description: `Under-Desk Horizontal Cable Management Tray & Wire Channel for Workstation${deskWidthMm ? ` W${deskWidthMm} mm` : ''}`,
            componentRole: 'cable_management',
            qty: fmtQty(sharedQty),
            unit: 'Nos',
        });
    }

    // 5. Power & Data Module / Box
    if (/\b(power\s*(?:box(?:es)?|modules?|sockets?|outlets?|strips?|bars?|units?|data|&\s*data|and\s*data|\/\s*data|points?|access)|data\s*(?:box(?:es)?|ports?|sockets?|outlets?|access)|electrification|usb\s*(?:ports?|chargers?)|pop[\s-]?up\s*(?:box(?:es)?|sockets?)|desk\s*sockets?)\b/i.test(bodyOnly)) {
        results.push({
            label: 'Power & Data Module Box',
            description: 'Desk-Mounted Power & Data Electrification Socket Module Box (Power + RJ45 + USB) for Workstation',
            componentRole: 'power_box',
            qty: fmtQty(seatCount),
            unit: 'Nos',
        });
    }

    // 6. Mobile Pedestal / Under-Desk Drawer Storage
    if (/\b(pedestals?|drawer\s*(?:units?|box(?:es)?|cabinets?)|[234][-\s]?drawers?|under[\s-]?desk\s*storage|side\s*storage|cadd(?:y|ies)|personal\s*lockers?)\b/i.test(bodyOnly)) {
        const drawerMatch = bodyOnly.match(/\b([234])[-\s]?drawers?\b/i);
        const drawerLabel = drawerMatch ? `${drawerMatch[1]}-Drawer` : '3-Drawer';
        const isLockable = /\block(?:able|ing)?\b/i.test(lower);
        results.push({
            label: `Under-Desk Mobile Pedestal (${drawerLabel})`,
            description: `Under-Desk ${isLockable ? 'Lockable ' : ''}Mobile Pedestal ${drawerLabel} Storage Unit for Office Workstation`,
            componentRole: 'pedestal',
            qty: fmtQty(seatCount),
            unit: 'Nos',
        });
    }

    // 7. Monitor Arm
    if (/\b(monitor\s*arms?|screen\s*arms?|vesa\s*mounts?|dual\s*monitors?|single\s*monitors?)\b/i.test(bodyOnly)) {
        const isDual = /\bdual\s*monitors?\b/i.test(lower);
        results.push({
            label: `${isDual ? 'Dual' : 'Single'} Articulated Monitor Arm`,
            description: `Desk-Mounted ${isDual ? 'Dual' : 'Single'} VESA Articulated Monitor Arm for Office Workstation`,
            componentRole: 'monitor_arm',
            qty: fmtQty(seatCount),
            unit: 'Nos',
        });
    }

    // 8. CPU Holder / Desk Accessories
    if (/\b(cpu\s*holders?|keyboard\s*trays?|desk\s*lamps?|task\s*lights?)\b/i.test(bodyOnly)) {
        const accName = /\bcpu\s*holders?\b/i.test(lower)
            ? 'Under-Desk CPU Holder'
            : /\bkeyboard\s*trays?\b/i.test(lower)
                ? 'Sliding Keyboard Tray'
                : 'Workstation Task Light';
        results.push({
            label: accName,
            description: `${accName} Accessory for Office Workstation`,
            componentRole: 'accessory',
            qty: fmtQty(seatCount),
            unit: 'Nos',
        });
    }

    // 9. Ergonomic Task Chair (ONLY when explicitly included in the workstation BOQ spec!)
    if (/\b((?:ergonomic\s+|mesh\s+|swivel\s+|office\s+|workstation\s+)*task\s*chairs?|(?:ergonomic|office|swivel|mesh)\s+chairs?|with\s*chairs?|incl(?:uding)?\.?\s*chairs?)\b/i.test(bodyOnly)) {
        results.push({
            label: 'Ergonomic Workstation Task Chair',
            description: 'Ergonomic Mesh Back Swivel Office Task Chair with Adjustable Armrests',
            componentRole: 'task_chair',
            qty: fmtQty(seatCount),
            unit: 'Nos',
        });
    }

    // 10. Sensible workstation kit if the description was bare (e.g. just "Linear Back-to-Back Workstation")
    const onlyCore = results.every(r => r.componentRole === 'workstation_desk' || r.componentRole === 'side_return');
    if (onlyCore) {
        results.push(
            {
                label: `Desk-Mounted Acoustic Divider Screen${deskWidthMm ? ` (${deskWidthMm} mm)` : ''}${sharedNote}`,
                description: `Desk-Mounted Fabric Acoustic Privacy Divider Screen for Linear Workstation${deskWidthMm ? ` W${deskWidthMm} mm` : ''}`,
                componentRole: 'screen',
                qty: fmtQty(sharedQty),
                unit: 'Nos',
            },
            {
                label: `Under-Desk Cable Management Tray${sharedNote}`,
                description: 'Under-Desk Horizontal Cable Management Tray & Wire Channel for Workstation',
                componentRole: 'cable_management',
                qty: fmtQty(sharedQty),
                unit: 'Nos',
            },
            {
                label: 'Power & Data Module Box',
                description: 'Desk-Mounted Power & Data Electrification Socket Module Box for Workstation',
                componentRole: 'power_box',
                qty: fmtQty(seatCount),
                unit: 'Nos',
            },
            {
                label: 'Under-Desk Mobile Pedestal (3-Drawer)',
                description: 'Under-Desk Lockable Mobile Pedestal 3-Drawer Storage Unit for Office Workstation',
                componentRole: 'pedestal',
                qty: fmtQty(seatCount),
                unit: 'Nos',
            }
        );
    }

    return results;
}

/**
 * Dynamically extracts the modular components of an L-Shaped Desk / Executive Desk with Side Return.
 */
export function extractLShapeDeskComponents(description = '') {
    const raw = String(description || '');
    const bodyOnly = stripPipeMetadata(raw);
    const lower = bodyOnly.toLowerCase();

    const isExecutive = /\b(executive|manager(?:ial)?|director|ceo|presidential|cabin)\b/i.test(bodyOnly);
    const deskDimText = parseFurnitureDimensions(bodyOnly).text;
    const matMatch = bodyOnly.match(/\b(\d{2}\s*mm\s*(?:E1\s*)?(?:MFC|MDF|HPL|melamine|laminate|veneer)|E1\s*MFC|wood\s*veneer|melamine|HPL)\b/i);
    const matHint = matMatch ? matMatch[1].trim() : '';
    const returnHasStorage = /\b(storage|cabinet|credenza|drawer)\b/i.test(lower);

    const results = [
        {
            label: `${isExecutive ? 'Executive' : 'Office'} L-Shape Main Desk${deskDimText ? ` (${deskDimText})` : ''}`,
            description: [
                `${isExecutive ? 'Executive Managerial' : 'Office'} L-Shaped Desk Main Worktop & Frame`,
                deskDimText ? `Dimensions: ${deskDimText}` : '',
                matHint ? `Finish: ${matHint}` : ''
            ].filter(Boolean).join(' | '),
            componentRole: 'executive_desk',
            qty: '1',
            unit: 'Nos',
        },
        {
            label: returnHasStorage
                ? 'Integrated Side Return Storage Credenza'
                : 'Desk Side Return Extension Unit',
            description: returnHasStorage
                ? `Side Return Storage Credenza Cabinet with Lockable Drawers for ${isExecutive ? 'Executive' : 'Office'} L-Shape Desk`
                : `Side Return Extension Desk & Service Unit for ${isExecutive ? 'Executive' : 'Office'} L-Shape Desk`,
            componentRole: 'side_return',
            qty: '1',
            unit: 'Nos',
        }
    ];

    if (/\b(modesty\s*panels?|front\s*modesty|under[\s-]?desk\s*panels?)\b/i.test(bodyOnly)) {
        results.push({
            label: 'Desk Modesty Panel',
            description: `Under-Desk Modesty Panel (${matHint || 'MFC'}) for L-Shape Desk`,
            componentRole: 'modesty_panel',
            qty: '1',
            unit: 'Nos',
        });
    }

    if (/\b(pedestals?|[234][-\s]?drawers?\s*(?:mobile\s*)?pedestal)\b/i.test(bodyOnly)) {
        results.push({
            label: 'Under-Desk Mobile Pedestal (3-Drawer)',
            description: 'Under-Desk Lockable Mobile Pedestal 3-Drawer Unit for L-Shape Desk',
            componentRole: 'pedestal',
            qty: '1',
            unit: 'Nos',
        });
    }

    if (/\b(cable\s*(?:trays?|management|channels?|grommets?)|wire\s*(?:management|trays?)|grommets?|flip[\s-]?tops?)\b/i.test(bodyOnly)) {
        results.push({
            label: 'Cable Management Tray & Grommet',
            description: 'Under-Desk Cable Management Tray & Desktop Wire Access Grommet for L-Shape Desk',
            componentRole: 'cable_management',
            qty: '1',
            unit: 'Nos',
        });
    }

    if (/\b(power\s*(?:box(?:es)?|modules?|sockets?|outlets?|data|&\s*data|and\s*data|\/\s*data|access)|data\s*(?:box(?:es)?|ports?|access)|electrification|pop[\s-]?ups?|usb)\b/i.test(bodyOnly)) {
        results.push({
            label: 'Power & Data Access Module',
            description: 'Desktop Power & Data Electrification Socket Module Box for Executive Desk',
            componentRole: 'power_box',
            qty: '1',
            unit: 'Nos',
        });
    }

    if (/\b(screens?|dividers?|privacy\s*panels?|acoustic\s*panels?)\b/i.test(bodyOnly)) {
        results.push({
            label: 'Desk Privacy Screen',
            description: 'Desk-Mounted Acoustic Privacy Screen for L-Shape Workstation Desk',
            componentRole: 'screen',
            qty: '1',
            unit: 'Nos',
        });
    }

    if (/\b((?:executive|task|visitor|office|ergonomic)\s*chairs?|with\s*chairs?)\b/i.test(bodyOnly)) {
        results.push({
            label: isExecutive ? 'Executive Office Chair' : 'Ergonomic Task Chair',
            description: isExecutive ? 'High-Back Executive Ergonomic Swivel Office Chair' : 'Ergonomic Mesh Office Task Chair',
            componentRole: 'task_chair',
            qty: '1',
            unit: 'Nos',
        });
    }

    return results;
}

const FOLDING_MODULE_LENGTHS_MM = [1600, 1400, 1800, 1200];

/**
 * Plans how many folding table modules reproduce a conference / meeting table of a given footprint or
 * seating capacity. Modules are standard flip-top sizes (1200–1800 long, 600–900 deep); tables wider
 * than 1.2 m are built as two rows of modules pushed together; one module seats two people.
 * Priority: explicit table count → table footprint → seating capacity → standard 4-module layout.
 */
export function planFoldingTableModules(description = '', options = {}) {
    const bodyOnly = stripPipeMetadata(description);
    const pax = Number.isFinite(options.pax) ? options.pax : parseSeatingCapacity(bodyOnly);
    const dims = parseFurnitureDimensions(bodyOnly);

    // Dimensions up to 2.0 m describe ONE module (e.g. "folding tables 1400 x 700"), larger ones the whole table
    const dimsAreModule = dims.lengthMm > 0 && dims.lengthMm <= 2000;
    const snapDepth = (mm) => Math.min(900, Math.max(600, Math.round((mm || 700) / 50) * 50));
    let moduleLengthMm = dimsAreModule ? dims.lengthMm : 1400;
    let moduleDepthMm = dimsAreModule ? snapDepth(dims.depthMm) : 700;

    const explicit = bodyOnly.match(/\b(\d{1,2})\s*(?:nos?\.?|x|pcs?\.?)?\s*(?:(?:folding|foldable|flip[-\s]?top|nesting|training|mobile|modular|linked|tilting|rectangular)\s+)*tables\b/i);
    const explicitQty = explicit ? parseInt(explicit[1], 10) : 0;

    if (explicitQty >= 2 && explicitQty <= 60) {
        const rows = explicitQty >= 4 && explicitQty % 2 === 0 ? 2 : 1;
        return {
            tableQty: explicitQty, rows, perRow: Math.ceil(explicitQty / rows),
            moduleLengthMm, moduleDepthMm, pax, targetDimText: dimsAreModule ? '' : dims.text, basis: 'explicit'
        };
    }

    if (dims.lengthMm >= 2400) {
        const rows = dims.depthMm >= 1200 ? 2 : 1;
        // Pick the standard module length that divides the table length most evenly
        let bestRemainder = Infinity;
        for (const len of FOLDING_MODULE_LENGTHS_MM) {
            const count = Math.max(1, Math.round(dims.lengthMm / len));
            const remainder = Math.abs(dims.lengthMm - count * len);
            if (remainder < bestRemainder - 1) {
                bestRemainder = remainder;
                moduleLengthMm = len;
            }
        }
        const perRow = Math.max(1, Math.round(dims.lengthMm / moduleLengthMm));
        moduleDepthMm = snapDepth(rows === 2 ? dims.depthMm / 2 : dims.depthMm);
        return {
            tableQty: rows * perRow, rows, perRow, moduleLengthMm, moduleDepthMm,
            pax, targetDimText: dims.text, basis: 'dimensions'
        };
    }

    if (pax >= 3) {
        const tableQty = Math.max(2, Math.ceil(pax / 2));
        const rows = tableQty >= 4 ? 2 : 1;
        return {
            tableQty, rows, perRow: Math.ceil(tableQty / rows), moduleLengthMm, moduleDepthMm,
            pax, targetDimText: dimsAreModule ? '' : dims.text, basis: 'capacity'
        };
    }

    // No size stated: standard reconfigurable 8-person layout (4 modules)
    return {
        tableQty: 4, rows: 2, perRow: 2, moduleLengthMm, moduleDepthMm,
        pax, targetDimText: dimsAreModule ? '' : dims.text, basis: 'default'
    };
}

/**
 * Dynamically extracts components of a Conference / Meeting / Training table set.
 *  - isFolding = true  → a set of flip-top / folding table modules (count planned from footprint or capacity)
 *  - isFolding = false → a fixed conference table with the furniture specified around it (meeting_set)
 * options.asOption = true builds the lean "set of folding tables" alternative offered below a
 * single-table row (tables + only the power / cable / modesty accessories the BOQ row asks for).
 */
export function extractFoldingMeetingComponents(description = '', isFolding = true, options = {}) {
    const raw = String(description || '');
    const bodyOnly = stripPipeMetadata(raw);
    const asOption = Boolean(options.asOption);
    const dims = parseFurnitureDimensions(bodyOnly);
    const paxCount = resolvePerUnitPax(raw, options.unit, options.qty);
    const dimText = dims.text;
    const lengthMm = dims.lengthMm;

    const plan = isFolding ? planFoldingTableModules(bodyOnly, { pax: paxCount }) : null;
    const tableQty = plan ? plan.tableQty : 1;
    const moduleText = plan ? `${plan.moduleLengthMm} × ${plan.moduleDepthMm} mm` : '';
    const layoutText = plan
        ? (plan.rows === 2 ? `2 rows × ${plan.perRow} tables` : `${plan.perRow} tables in line`)
        : '';

    const results = [];

    if (isFolding) {
        results.push({
            label: `Flip-Top Folding Table Module (${moduleText})`,
            description: [
                'Mobile Flip-Top Folding Multi-Purpose Conference & Training Table on Lockable Castors, Nesting, with Table-to-Table Linking',
                `Module: ${moduleText}`,
                `Layout: ${layoutText}`,
                plan.targetDimText ? `Replaces table: ${plan.targetDimText}` : '',
                paxCount > 0 ? `Capacity: ${paxCount} Pax` : ''
            ].filter(Boolean).join(' | '),
            componentRole: 'folding_table',
            seatCount: paxCount || tableQty * 2,
            qty: fmtQty(tableQty),
            unit: 'Nos',
        });
    } else {
        results.push({
            label: `Conference / Boardroom Table${dimText ? ` (${dimText})` : ''}`,
            description: [
                'Commercial Conference Boardroom Meeting Table with Integrated Cable Routing',
                dimText ? `Dimensions: ${dimText}` : '',
                paxCount > 0 ? `Capacity: ${paxCount} Pax` : ''
            ].filter(Boolean).join(' | '),
            componentRole: 'conference_table',
            seatCount: paxCount || 0,
            qty: '1',
            unit: 'Nos',
        });
    }

    // Modesty panel / front skirt (only when the BOQ asks for it)
    if (/\b(modesty\s*panels?|front\s*(?:panel|skirt)s?)\b/i.test(bodyOnly)) {
        results.push({
            label: isFolding ? 'Folding Table Modesty Panel' : 'Conference Table Modesty Panel',
            description: isFolding
                ? 'Under-Table Modesty Panel for Flip-Top Folding Conference Tables'
                : 'Under-Table Modesty Panel for Conference Table',
            componentRole: 'modesty_panel',
            qty: fmtQty(isFolding ? tableQty : 1),
            unit: 'Nos',
        });
    }

    // Power & Data Box / Connectivity Module (only when the BOQ asks for it)
    if (/\b(power\s*(?:box(?:es)?|modules?|sockets?|outlets?|data|&\s*data|and\s*data|\/\s*data|access|points?)|data\s*(?:box(?:es)?|ports?|access|points?)|electrification|electrified|pop[\s-]?ups?|av\s*box|hdmi|usb)\b/i.test(bodyOnly)) {
        const powerQty = isFolding ? Math.max(1, Math.ceil(tableQty / 2)) : Math.max(1, Math.ceil((lengthMm || 2800) / 1800));
        results.push({
            label: 'Conference Table Power & Data Access Box',
            description: 'Flush Flip-Lid Power, Data (RJ45), HDMI & USB Electrification Module Box for Conference Table',
            componentRole: 'power_box',
            qty: fmtQty(powerQty),
            unit: 'Nos',
        });
    }

    // Cable Management Tray / Spine
    if (/\b(cable\s*(?:trays?|management|channels?|spines?|risers?|ducts?|routing)|wire\s*(?:trays?|management)|grommets?)\b/i.test(bodyOnly)) {
        results.push({
            label: 'Under-Table Cable Management Tray & Spine',
            description: 'Horizontal Under-Table Cable Management Tray & Vertical Cable Spine for Conference Tables',
            componentRole: 'cable_management',
            qty: fmtQty(Math.max(1, Math.ceil(tableQty / 2))),
            unit: 'Nos',
        });
    }

    if (!asOption) {
        // Meeting Room Storage Credenza / Sideboard
        if (/\b(credenzas?|sideboards?|buffets?)\b/i.test(bodyOnly)) {
            results.push({
                label: 'Meeting Room Storage Credenza',
                description: 'Low Storage Credenza Sideboard Cabinet for Conference & Meeting Room',
                componentRole: 'side_return',
                qty: '1',
                unit: 'Nos',
            });
        }

        // Conference / Nesting Meeting Chairs (only when chairs are part of the row's supply)
        if (mentionsIncludedChairs(bodyOnly)) {
            const explicitChairs = bodyOnly.replace(EXCLUDED_CHAIRS_RE, ' ').match(EXPLICIT_CHAIR_COUNT_RE);
            const chairQty = explicitChairs ? parseInt(explicitChairs[1], 10) : (paxCount > 0 ? paxCount : (tableQty * 2));
            results.push({
                label: isFolding ? 'Stackable / Nesting Meeting Chair' : 'Conference Meeting Room Chair',
                description: isFolding
                    ? 'Stackable / Nesting Multi-Purpose Conference & Training Chair on Castors or 4 Legs'
                    : 'Upholstered Commercial Conference & Boardroom Meeting Chair',
                componentRole: 'meeting_chair',
                qty: fmtQty(chairQty),
                unit: 'Nos',
            });
        }
    }

    return results;
}

/**
 * Classifies which dedicated Set Type fits a multi-item BOQ description.
 */
export function inferSetTypeFromText(description = '', options = {}) {
    const raw = String(description || '');
    const firstLine = raw.split(/[\r\n|]+/)[0].trim().toLowerCase();
    const full = raw.toLowerCase();

    if (/\b(workstation\s*(?:cluster|set|system|bench)|cluster\s*of\s*[2-9]|(?:2|4|6|8)[-\s]?pax\s*workstation|linear\s*workstation|back[-\s]?to[-\s]?back\s*workstation)\b/.test(firstLine)
        || (/\bworkstation\b/.test(firstLine) && /\b(screen|pedestal|chair|cable|drawer)\b/.test(full))) {
        return 'workstation_set';
    }
    if (/\bl[-\s]?shaped?\s*(?:executive\s*|manager(?:ial)?\s*|office\s*)?desk\b/.test(firstLine)) {
        return 'l_shape_desk_set';
    }
    if (/\b(?:fold(?:ing|able)|flip[-\s]?top|nesting|training)\s*(?:conference\s*|meeting\s*|training\s*|seminar\s*)*tables?\b/.test(firstLine)) {
        return 'folding_meeting_set';
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
    // Secondary signals from body (weak: skipped when only the headline may decide)
    if (options.headlineOnly) return 'custom_set';
    if (/\b(sofa|armchair|sponge|fabric)\b/.test(full) && !/\boffice\s*desk\b/.test(full)) {
        return 'seating_set';
    }
    if (/\b(office\s*desk|workstation|executive\s*desk)\b/.test(full)) {
        return 'desking_set';
    }
    return 'custom_set';
}

/**
 * Plans how the set concept applies to a BOQ row:
 *  - activeType: the row itself is matched as a multi-component set (all workstations,
 *    L-shape desks, groups of folding tables, meeting-room sets, lump-sum furniture sets…)
 *  - optionType: the row stays a SINGLE item, and the set is offered as an additional option
 *    below it (a conference / meeting table that can also be supplied as many folding tables)
 */
export function resolveRowSetPlan(description = '', unit = '', options = {}) {
    const none = { activeType: null, optionType: null };
    const raw = String(description || '');
    if (!raw.trim()) return none;

    const firstLine = raw.split(/[\r\n|]+/)[0].trim().toLowerCase();
    const isLumpUnit = isSetLikeUnit(unit) && !/^cluster/i.test(String(unit || '').trim());

    // Avoid catching single accessories like "SIDE TABLE FOR SOFA SET" or "Workstation Task Chair"
    if (/^(side\s*table|coffee\s*table|center\s*table|lamp|cushion|rug|carpet)\s+for\b/i.test(firstLine)) {
        return none;
    }

    const hasExplicitSetHeadline = /\b(furniture\s*set|sofa\s*set|lounge\s*set|dining\s*set|seating\s*set|desking\s*set|office\s*set|library\s*set|meeting\s*set|room\s*set|workstation\s*set|workstation\s*cluster|modular\s*seating\s*set|modular\s*sofa\s*set)\b/i.test(firstLine);
    if (hasExplicitSetHeadline) {
        return { activeType: inferSetTypeFromText(raw), optionType: null };
    }

    // ALL workstations, L-shape desks and groups of folding tables are sets even when the unit is Nos / Pcs
    const dynamicSetType = isDynamicSystemSetDescription(raw, unit, options);
    if (dynamicSetType) {
        return { activeType: dynamicSetType, optionType: null };
    }

    // A single conference / meeting table keeps its single-table match + a "set of folding tables" option below
    const optionType = detectSetOptionType(raw, unit, options);
    if (optionType) {
        return { activeType: null, optionType };
    }

    // Lump-sum / set workstations & modular seating concepts
    if (isLumpUnit && /\b(workstation|cluster|modular\s*seating|modular\s*sofa|lounge|furniture|set)\b/i.test(firstLine)) {
        return { activeType: inferSetTypeFromText(raw), optionType: null };
    }

    // Multi-component dimension specs or multiple bulleted furniture items under LUM/Set unit
    const dimMatches = raw.match(/dimension\s+[a-z]\s*[:-]/gi) || [];
    if (dimMatches.length >= 2) {
        return { activeType: inferSetTypeFromText(raw), optionType: null };
    }

    if (isLumpUnit) {
        const bulletCount = extractNamedBulletComponents(raw, 'custom_set').length;
        if (bulletCount >= 2) {
            return { activeType: inferSetTypeFromText(raw), optionType: null };
        }
    }

    return none;
}

/**
 * Detects whether a BOQ row represents a multi-item Furniture Set.
 * Returns the detected ACTIVE Set Type ID (e.g. 'outdoor_set', 'workstation_set') or null for single items.
 * Rows that stay single but carry an optional set alternative are reported by detectSetOptionType().
 */
export function detectFurnitureSetType(description = '', unit = '', options = {}) {
    return resolveRowSetPlan(description, unit, options).activeType;
}

const SKIP_BULLET_LINE = /^(warranty|origin|inner\s*frame|frame|sponge|fabric|cloth|footpads?|feet|panel|tripod|color\s*matching|accessories|note|remark|total|supplier|model|item|dimension\s+[a-z]|[a-z]\s*\*\s*\d+\s*nos?)\b/i;

const FURNITURE_ITEM_NOUN = /\b(sofa|couch|armchair|chair|stool|bench|pouf|ottoman|table|desk|workstation|cabinet|credenza|bookcase|shelf|shelving|rack|wardrobe|counter|pedestal|bed|booth|pod|lounger|recliner|divan|seating|mirror|lamp|planter)\b/i;

/** Accessory lines that are real components of workstation / desk / conference system sets. */
const SYSTEM_SET_ACCESSORY_NOUN = /\b(screens?|dividers?|partitions?|modesty\s*panels?|cable\s*(?:trays?|management|spines?)|power\s*(?:box(?:es)?|modules?|sockets?)|sockets?|monitor\s*arms?|cpu\s*holders?|returns?|drawers?)\b/i;

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
    const allowAccessories = isSystemSetType(setType);
    const results = [];

    for (const line of lines) {
        const cleaned = line.replace(/^[\s*•\-–—]+/, '').replace(/^\d+[.)]\s*/, '').trim();
        if (!cleaned || cleaned.length < 4) continue;
        if (SKIP_BULLET_LINE.test(cleaned)) continue;
        const isItemLine = (text) => FURNITURE_ITEM_NOUN.test(text) || (allowAccessories && SYSTEM_SET_ACCESSORY_NOUN.test(text));
        if (!isItemLine(cleaned)) continue;

        let qty = '1';
        let unit = 'Nos';
        let itemLabel = cleaned;
        let explicitQty = true;

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
            explicitQty = false;
        }

        // Remove trailing punctuation/separators
        itemLabel = itemLabel.replace(/[-–—:,*]+$/, '').trim();
        if (!itemLabel || !isItemLine(itemLabel)) continue;

        const needsPrefix = prefix
            && !itemLabel.toLowerCase().includes(prefix.toLowerCase())
            && (setType === 'outdoor_set' || setType === 'cafeteria_set' || setType === 'library_set');
        const matchDesc = needsPrefix ? `${prefix} ${itemLabel}` : itemLabel;

        results.push({
            label: itemLabel,
            description: matchDesc,
            modelHint: extractComponentModelHint(itemLabel),
            qty,
            unit,
            explicitQty
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
    const dimLineRegex = /dimension\s+([A-G])\s*[:-]\s*([^\r\n]+)/gi;
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
 *  3. Dynamic system-set parsers (workstations, L-shape desks, folding / fixed conference tables)
 *  4. Default template slots for the chosen Set Type
 * options.unit     → parent row unit (lump-sum / set units scale workstation clusters)
 * options.asOption → build the lean alternative offered below a single-item row
 */
export function parseSetComponentsFromDescription(description = '', setType = 'custom_set', parentId = 'set', options = {}) {
    const effectiveType = setType && setType !== 'single' ? setType : inferSetTypeFromText(description);
    const parentBrand = extractParentSupplierContext(description);
    const isSystemType = isSystemSetType(effectiveType);
    const asOption = Boolean(options.asOption);
    const toComponents = (items) => items.map((item, idx) => createEmptySetComponent(parentId, idx, { ...item, parentBrand }));

    if (!asOption) {
        // 1. Named bullets. For system sets, spec bullets without quantities ("* Top: 25 mm MFC") describe
        //    ONE product, so only explicit quantity lists replace the dynamic component parser.
        const namedBullets = extractNamedBulletComponents(description, effectiveType);
        const qualifyingBullets = isSystemType ? namedBullets.filter(b => b.explicitQty) : namedBullets;
        if (qualifyingBullets.length >= 2) {
            return toComponents(namedBullets);
        }

        // 2. Coded dimensions (A/B/C/D)
        const codedDims = extractCodedDimensionComponents(description, effectiveType);
        if (codedDims.length >= 2) {
            return toComponents(codedDims);
        }
    }

    // 3. Dynamic System Set Component Parsers
    if (effectiveType === 'workstation_set') {
        const wsComps = extractWorkstationComponents(description, { unit: options.unit, qty: options.qty });
        if (wsComps.length > 0) return toComponents(wsComps);
    }
    if (effectiveType === 'l_shape_desk_set') {
        const lComps = extractLShapeDeskComponents(description);
        if (lComps.length > 0) return toComponents(lComps);
    }
    if (effectiveType === 'folding_meeting_set') {
        const fComps = extractFoldingMeetingComponents(description, true, { asOption, unit: options.unit, qty: options.qty });
        if (fComps.length > 0) return toComponents(fComps);
    }
    if (effectiveType === 'meeting_set' && isMeetingTableHeadline(description)) {
        const mComps = extractFoldingMeetingComponents(description, false, { asOption, unit: options.unit, qty: options.qty });
        if (mComps.length > 0) return toComponents(mComps);
    }

    // 4. Template fallback for the selected Set Type
    const meta = getSetTypeMeta(effectiveType);
    const slots = meta.defaultSlots && meta.defaultSlots.length > 0
        ? meta.defaultSlots
        : FURNITURE_SET_TYPE_MAP.custom_set.defaultSlots;

    return toComponents(slots);
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

    const primaryBrand = setItems.find(it => (it.selectedBrand || '').trim())?.selectedBrand?.trim() || uniqueBrands[0] || (parentRow.selectedBrand || '');

    return {
        ...parentRow,
        setItems,
        selectedBrand: primaryBrand,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Row-level set plan helpers (shared by the Multi-Budget and Value-Engineering tables)
//
//  • ACTIVE SET  → row.setType !== 'single' and row.setItems hold the components that are rolled
//                  up into the row (all workstations, L-shape desks, groups of folding tables…)
//  • SET OPTION  → the row stays a SINGLE item and row.setOption = { type, items, expanded, status }
//                  is an additional alternative shown BELOW the row (a conference / meeting table
//                  that can also be supplied as a set of many folding tables)
//  • row.singleAlt keeps the single-item match while a set is active, so switching back is lossless
//  • row.setChoice = 'single' | 'set' records an explicit user choice (auto-detection respects it)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const SINGLE_MATCH_FIELDS = [
    'selectedBrand', 'selectedMainCat', 'selectedSubCat', 'selectedFamily', 'selectedModel', 'selectedModelUrl',
    'brandImage', 'brandImages', 'brandLogo', 'brandDesc', 'basePrice', 'rate', 'amount',
    'aiStatus', 'aiResult', 'aiError', 'matchTier', 'confidenceScore', 'evidence', 'imageVerification'
];

function blankSingleMatch() {
    return {
        selectedBrand: '', selectedMainCat: '', selectedSubCat: '', selectedFamily: '', selectedModel: '', selectedModelUrl: '',
        brandImage: '', brandImages: [], brandLogo: '', brandDesc: '',
        aiStatus: 'idle', aiResult: null, aiError: null,
        matchTier: undefined, confidenceScore: undefined, evidence: null, imageVerification: null
    };
}

function snapshotSingleMatch(row) {
    const snap = {};
    for (const key of SINGLE_MATCH_FIELDS) {
        if (row[key] !== undefined) snap[key] = row[key];
    }
    if (snap.aiStatus === 'processing') snap.aiStatus = 'idle';
    return snap;
}

/** True when a set component carries a product selection. */
export function isMatchedSetItem(item) {
    return Boolean(item && (item.selectedBrand || item.selectedModel));
}

/** True when a matched component is part of the anchor product (no SKU / price of its own). */
export function isIncludedSetItem(item) {
    return Boolean(item && item.aiResult && item.aiResult.product && item.aiResult.product.includedInSystem);
}

/** Price cell of a set component: its rate, "Included" (part of the anchor), "No price" or a dash. */
export function describeSetItemPrice(item) {
    const rate = parseFloat(item?.rate) || 0;
    if (rate > 0) return rate.toFixed(2);
    if (!isMatchedSetItem(item)) return '—';
    return isIncludedSetItem(item) ? 'Included' : 'No price';
}

function deriveSetItemsStatus(items = []) {
    if (!Array.isArray(items) || items.length === 0) return 'idle';
    if (items.some(it => it.aiStatus === 'processing')) return 'processing';
    if (items.some(it => it.aiStatus === 'success' || isMatchedSetItem(it))) return 'success';
    if (items.every(it => it.aiStatus === 'error' || it.aiStatus === 'no_match')) return 'error';
    return 'idle';
}

/** True when the row is currently matched as a multi-component set. */
export function hasActiveSet(row) {
    return Boolean(row && row.setType && row.setType !== 'single' && Array.isArray(row.setItems) && row.setItems.length > 0);
}

/** True when the single-item snapshot kept beside an active set holds a product selection. */
export function hasSingleAlternative(row) {
    return Boolean(row && row.singleAlt && (row.singleAlt.selectedBrand || row.singleAlt.selectedModel));
}

/** Fit-out scope rows (partitions, flooring, joinery…) are never furniture sets. */
function isFitoutScopeRow(row) {
    return /fit[\s-]?out/i.test(String(row?.scope || ''));
}

function getSetSourceKey(description = '', unit = '', qty = undefined) {
    return `${String(description || '').trim()}¦${String(unit || '').trim().toLowerCase()}¦${parseFloat(qty) > 1 ? 'n' : '1'}`;
}

/**
 * Builds the additional set alternative of a single-item row
 * (e.g. the "set of N folding tables" option of a conference / meeting table).
 */
export function buildSetOption(description = '', unit = '', parentId = 'row', optionType = null, qty = undefined) {
    const type = optionType || detectSetOptionType(description, unit, { qty });
    if (!type) return null;
    const items = parseSetComponentsFromDescription(description, type, `${parentId}_opt`, { unit, qty, asOption: true });
    if (!items.length) return null;
    return { type, items, expanded: false, status: 'idle', sourceKey: getSetSourceKey(description, unit, qty) };
}

/** Replaces the components of a row's set option and re-derives its status. */
export function withSetOptionItems(row, items, extra = {}) {
    if (!row || !row.setOption) return row;
    const nextItems = Array.isArray(items) ? items : [];
    return { ...row, setOption: { ...row.setOption, ...extra, items: nextItems, status: deriveSetItemsStatus(nextItems) } };
}

function activateSetWithItems(row, setType, items, { expanded = true, choice = 'set' } = {}) {
    const hadMatchPrice = (parseFloat(row.basePrice) || 0) > 0;
    const base = {
        ...row,
        ...blankSingleMatch(),
        ...(hadMatchPrice ? { rate: '', amount: '', basePrice: 0 } : {}),
        setType,
        setItems: items,
        setExpanded: expanded,
        setOption: null,
        singleAlt: snapshotSingleMatch(row),
        setChoice: choice
    };
    return computeSetParentRollup(base, items);
}

/**
 * Applies the set plan to a freshly loaded BOQ row:
 * active sets get their components, single conference / meeting tables get their folding-set option.
 */
export function applySetPlanToRow(baseRow = {}) {
    const plan = isFitoutScopeRow(baseRow)
        ? { activeType: null, optionType: null }
        : resolveRowSetPlan(baseRow.description, baseRow.unit, { qty: baseRow.qty });
    if (plan.activeType) {
        const items = parseSetComponentsFromDescription(baseRow.description, plan.activeType, baseRow.id, { unit: baseRow.unit, qty: baseRow.qty });
        if (items.length > 0) {
            return {
                ...baseRow,
                setType: plan.activeType,
                setItems: items,
                setExpanded: false,
                setOption: null,
                singleAlt: null,
                brandImages: []
            };
        }
    }
    return {
        ...baseRow,
        setType: 'single',
        setItems: [],
        setExpanded: false,
        setOption: plan.optionType ? buildSetOption(baseRow.description, baseRow.unit, baseRow.id, plan.optionType, baseRow.qty) : null,
        singleAlt: null,
        brandImages: []
    };
}

/**
 * Re-evaluates the set plan of a single-item row right before matching, so descriptions typed or
 * edited after loading are still recognised. An explicit user choice of "single item" is respected.
 */
export function refreshRowSetPlan(row) {
    if (!row || hasActiveSet(row) || isFitoutScopeRow(row)) return row;
    const plan = resolveRowSetPlan(row.description, row.unit, { qty: row.qty });

    if (plan.activeType && row.setChoice !== 'single') {
        const items = parseSetComponentsFromDescription(row.description, plan.activeType, row.id, { unit: row.unit, qty: row.qty });
        if (items.length > 0) {
            return activateSetWithItems(row, plan.activeType, items, { expanded: false, choice: undefined });
        }
    }

    if (plan.optionType) {
        const existing = row.setOption;
        const existingMatched = Boolean(existing && (existing.items || []).some(isMatchedSetItem));
        const isStale = existing && existing.type === plan.optionType
            && existing.sourceKey !== getSetSourceKey(row.description, row.unit, row.qty) && !existingMatched;
        if (!existing || isStale) {
            const option = buildSetOption(row.description, row.unit, row.id, plan.optionType, row.qty);
            if (option) return { ...row, setOption: option };
        }
    }
    return row;
}

/** Short human label of a set alternative, e.g. "Set of 6 folding tables". */
export function describeSetOption(option) {
    const items = Array.isArray(option?.items) ? option.items : [];
    const meta = getSetTypeMeta(option?.type);
    if (option?.type === 'folding_meeting_set') {
        const tableQty = items
            .filter(it => it.componentRole === 'folding_table')
            .reduce((acc, it) => acc + (parseFloat(it.qty) || 0), 0);
        if (tableQty > 0) return `Set of ${fmtQty(tableQty)} folding tables`;
    }
    return `${meta.shortLabel || meta.label} (${items.length} component${items.length === 1 ? '' : 's'})`;
}

/** Totals and display data of a set alternative for ONE parent unit and for the whole row quantity. */
export function summarizeSetOption(option, parentQty = 1) {
    const items = Array.isArray(option?.items) ? option.items : [];
    const meta = getSetTypeMeta(option?.type);
    let ratePerSet = 0;
    for (const it of items) {
        const q = parseFloat(it.qty) || 0;
        const r = parseFloat(it.rate) || 0;
        if (q > 0 && r > 0) ratePerSet += q * r;
    }
    const unique = (list) => Array.from(new Set(list.map(v => String(v || '').trim()).filter(Boolean)));
    const qtyNum = parseFloat(parentQty);
    const effectiveQty = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1;
    return {
        type: option?.type || '',
        typeLabel: meta.label,
        label: describeSetOption(option),
        itemCount: items.length,
        matchedCount: items.filter(isMatchedSetItem).length,
        // Matched components with their own SKU but no catalog price: not part of ratePerSet
        unpricedCount: items.filter(it => isMatchedSetItem(it) && !isIncludedSetItem(it) && !((parseFloat(it.rate) || 0) > 0)).length,
        brands: unique(items.map(it => it.selectedBrand)),
        models: unique(items.map(it => it.selectedModel)),
        images: unique(items.map(it => it.brandImage)),
        brandLogo: items.find(it => it.brandLogo)?.brandLogo || '',
        ratePerSet,
        hasPrice: ratePerSet > 0,
        amount: ratePerSet * effectiveQty,
        status: deriveSetItemsStatus(items)
    };
}

/** Promotes the set option of a single-item row to the active match (the single match is kept as alternative). */
export function activateSetOption(row) {
    const option = row?.setOption;
    if (!row || !option || !Array.isArray(option.items) || option.items.length === 0) return row;
    return activateSetWithItems(row, option.type, option.items);
}

/** Switches an active set back to the single item; the set stays available as the option below the row. */
export function revertSetToSingle(row) {
    if (!row) return row;
    if (!hasActiveSet(row)) {
        return { ...row, setType: 'single', setItems: [], setExpanded: false, setChoice: 'single' };
    }
    const items = row.setItems;
    const rollupPriced = items.some(it => (parseFloat(it.rate) || 0) > 0);
    const restored = row.singleAlt
        ? { ...blankSingleMatch(), ...row.singleAlt }
        : { ...blankSingleMatch(), ...(rollupPriced ? { rate: '', amount: '', basePrice: 0 } : {}) };
    return {
        ...row,
        ...restored,
        setType: 'single',
        setItems: [],
        setExpanded: false,
        setOption: {
            type: row.setType,
            items,
            expanded: false,
            status: deriveSetItemsStatus(items),
            sourceKey: getSetSourceKey(row.description, row.unit, row.qty)
        },
        singleAlt: null,
        setChoice: 'single'
    };
}

/** Removes the set alternative of a single-item row. */
export function dismissSetOption(row) {
    if (!row || !row.setOption) return row;
    return { ...row, setOption: null, setChoice: 'single' };
}

/** Changes the set type of a row ('single' reverts to the single item, keeping the set as an option). */
export function changeRowSetType(row, newSetType) {
    if (!row) return row;
    if (!newSetType || newSetType === 'single') return revertSetToSingle(row);

    if (!hasActiveSet(row)) {
        if (row.setOption && row.setOption.type === newSetType && row.setOption.items?.length > 0) {
            return activateSetOption(row);
        }
        const items = parseSetComponentsFromDescription(row.description, newSetType, row.id, { unit: row.unit, qty: row.qty });
        return activateSetWithItems(row, newSetType, items);
    }

    const existingItems = row.setItems;
    const hasMatchedOrEdited = existingItems.some(it => it.selectedBrand || it.selectedModel || it.brandImage || parseFloat(it.rate) > 0);
    const nextItems = hasMatchedOrEdited
        ? existingItems
        : parseSetComponentsFromDescription(row.description, newSetType, row.id, { unit: row.unit, qty: row.qty });
    return computeSetParentRollup({ ...row, setType: newSetType, setExpanded: true, setChoice: 'set' }, nextItems);
}

/**
 * Manual "Set" action on a single-item row. The headline decides the set type; a row whose headline
 * names no set becomes a Custom Furniture Set that starts with the row's own item (keeping its
 * current match) plus one empty component — never a guessed template.
 */
export function convertRowToSet(row) {
    if (!row || hasActiveSet(row)) return row;
    if (row.setOption && Array.isArray(row.setOption.items) && row.setOption.items.length > 0) {
        return activateSetOption(row);
    }
    const setType = inferSetTypeFromText(row.description, { headlineOnly: true });
    if (setType !== 'custom_set') return changeRowSetType(row, setType);

    const headline = String(row.description || '').split(/[\r\n|]+/)[0].trim();
    const ownMatch = (row.selectedBrand || row.selectedModel) ? {
        selectedBrand: row.selectedBrand, selectedMainCat: row.selectedMainCat, selectedSubCat: row.selectedSubCat,
        selectedFamily: row.selectedFamily, selectedModel: row.selectedModel, selectedModelUrl: row.selectedModelUrl,
        brandImage: row.brandImage, brandLogo: row.brandLogo, brandDesc: row.brandDesc,
        rate: (parseFloat(row.rate) || 0) > 0 ? row.rate : '', basePrice: row.basePrice,
        aiStatus: 'success', aiResult: row.aiResult || null
    } : {};
    const items = [
        createEmptySetComponent(row.id, 0, { ...(headline ? { label: headline.slice(0, 140), description: headline } : {}), ...ownMatch }),
        createEmptySetComponent(row.id, 1, {})
    ];
    return activateSetWithItems(row, 'custom_set', items);
}

/** Applies a costing multiplier (markup × exchange rate) to set components that carry a base price. */
export function applyCostingToSetItems(items = [], multiplier = 1) {
    return (Array.isArray(items) ? items : []).map(sub => {
        const subBase = parseFloat(sub.basePrice) || 0;
        if (subBase <= 0) return sub;
        const costedRate = subBase * multiplier;
        const subQty = parseFloat(sub.qty) || 0;
        return { ...sub, rate: costedRate.toFixed(2), amount: (costedRate * subQty).toFixed(2) };
    });
}

/** Applies a costing multiplier to the inactive alternates of a row (set option / single-item snapshot). */
export function applyCostingToRowAlternates(row, multiplier = 1) {
    if (!row) return row;
    let next = row;
    if (row.setOption && Array.isArray(row.setOption.items)) {
        next = { ...next, setOption: { ...row.setOption, items: applyCostingToSetItems(row.setOption.items, multiplier) } };
    }
    const altBase = parseFloat(row.singleAlt?.basePrice) || 0;
    if (altBase > 0) {
        const costed = altBase * multiplier;
        next = {
            ...next,
            singleAlt: { ...row.singleAlt, rate: costed.toFixed(2), amount: (costed * (parseFloat(row.qty) || 0)).toFixed(2) }
        };
    }
    return next;
}

/** Gives a copied row (e.g. one copy per budget tier) its own id and component ids. */
export function reidRowSetState(row, newId) {
    const reid = (items, tag) => (Array.isArray(items) ? items : []).map((s, si) => ({ ...s, id: `${newId}_${tag}_${si}` }));
    return {
        ...row,
        id: newId,
        setItems: reid(row.setItems, 'sub'),
        setOption: row.setOption ? { ...row.setOption, items: reid(row.setOption.items, 'opt') } : null
    };
}
