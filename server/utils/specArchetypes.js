/**
 * Shared detectors for item types that need their own matching lane:
 *  - beds (bunk / single / hostel / staff-accommodation beds)
 *  - steel storage (lockers, steel cupboards / cabinets / filing / shelving)
 * plus a small helper that lets "4 tier" match "Four Tier".
 *
 * Kept dependency-free so the category router, the archetype guards, the
 * taxonomy classifier and the semantic matcher can all share one definition.
 */

// A word that names a bed (or a bunk / double-deck unit)
const BED_WORD_RX = /\b(?:bunk\s*beds?|beds?|bunks?|double[\s-]?deck(?:er)?s?)\b/i;

// Things that contain the word "bed" but are not a bed frame
const NOT_BED_RX = /\b(?:sofa|day|futon)[\s-]?beds?\b|\bbeds?[\s-]?(?:side|sheets?|linens?|spreads?|covers?|skirts?|throws?|runners?|rooms?|heads?|bugs?|plates?|joints?|bolts?|loads?)\b|\b(?:flower|seed|plant(?:er|ing)?|garden|lawn|grass|nursery|reed|filter|gravel|sand|mortar|concrete|cement|granular|stone|aggregate|test|river|sea|oyster)[\s-]?beds?\b/i;

// Phrases that can only mean a bed frame, even beside a civil word ("double deck bed, MS pipe frame")
const STRONG_BED_RX = /\b(?:bunk\s*beds?|double[\s-]?deck(?:er)?\s*beds?|(?:single|double|twin|queen|king|steel|metal|iron|wooden|timber|hospital|hostel|dormitory|staff|labou?r|military|camp)\s*beds?|(?:m\.?\s?s\.?|steel|metal|g\.?i\.?)\s+pipe\s*beds?|beds?\s*frames?)\b/i;

// Civil / finishing works where "bed" means a bedding layer (sand bed, mortar bed, pipe bed ...)
const CIVIL_WORKS_RX = /\b(?:cement|sand|mortar|concrete|screed|granito|terrazzo|excavat\w*|manholes?|reservoirs?|trench\w*|pipes?|piping|aggregates?|gravel|backfill\w*|asphalt|bitumen|tiles?|tiling|floor\s*finish\w*|plaster\w*|masonry|blockwork|brickwork|kerbs?|culverts?|drains?|drainage)\b/i;

// Other furniture / bedding nouns: whichever comes first in the headline is the item
const OTHER_ITEM_RX = /\b(?:sofas?|couch(?:es)?|settees?|futons?|armchairs?|ottomans?|poufs?|chairs?|stools?|bench(?:es)?|tables?|desks?|workstations?|wardrobes?|cabinets?|cupboards?|lockers?|lamps?|mattress(?:es)?|pillows?|duvets?|blankets?|linens?|quilts?|comforters?|sheets?)\b/i;

/** True when the headline describes a bed frame (bunk bed, single steel bed, double-deck bed ...). */
export function isBedSpecHeadline(headline = '') {
    const h = String(headline || '').toLowerCase();
    const bedAt = h.search(BED_WORD_RX);
    if (bedAt < 0) return false;
    if (NOT_BED_RX.test(h)) return false;
    if (CIVIL_WORKS_RX.test(h) && !STRONG_BED_RX.test(h)) return false;
    const otherAt = h.search(OTHER_ITEM_RX);
    return otherAt < 0 || bedAt < otherAt;
}

const STEEL_WORD = '(?:steel|metal|metallic|m\\.s\\.?|ms|mild\\s*steel|crca|cold[\\s-]?rolled(?:\\s*steel)?|galvani[sz]ed|powder[\\s-]?coated)';
const STORAGE_NOUN = '(?:lockers?|cupboards?|cabinets?|almirahs?|wardrobes?|filing(?:\\s*cabinets?)?|filers?|shel(?:f|ves|ving)|racks?|pedestals?|storage(?:\\s*units?)?|pigeon[\\s-]?holes?)';
// Up to two words may sit between the material and the noun ("steel 2 door cupboard"),
// but never a part name or another material ("steel legs and wooden cabinet")
const GAP_WORD = '(?:(?!(?:legs?|handles?|base|frame|feet|plinth|tops?|and|with|wood(?:en)?|mdf|melamine|veneer|laminated?|glass|hinges?)\\b)[\\w-]+\\s+)';
const STEEL_THEN_STORAGE_RX = new RegExp(`\\b${STEEL_WORD}\\s+${GAP_WORD}{0,2}${STORAGE_NOUN}\\b`, 'i');
// Electrical / fire-fighting / site items that happen to be steel cabinets or panels
const NON_FURNITURE_RX = /\b(?:switch\s*boards?|switchgear|panel\s*boards?|distribution\s*boards?|control\s*panels?|synchroni[sz]\w*|fire\s*alarm|facp|hydrants?|hose\s*reels?|siamese|sprinklers?|extinguishers?|electrical|mcc|ups|batter(?:y|ies)|transformers?|containers?|first\s*aid|valves?|pumps?|ducts?|cable\s*trays?|meters?|telecom|server\s*racks?|kits?)\b/i;
// ...but a material named for a part ("metal handles", "steel legs") does not make the body steel
const NOT_PART = '(?!\\s+(?:(?:steel|metal|metallic|chrome|aluminium|aluminum)\\s+)?(?:legs?|handles?|base|frame|feet|plinth|tops?|hinges?|pulls?|knobs?|trims?|edges?|structure)\\b)';
const STORAGE_OF_STEEL_RX = new RegExp(`\\b${STORAGE_NOUN}\\b[^.;\\n|]{0,50}?\\b(?:in|of|made\\s+of|made\\s+from|fabricated\\s+(?:from|of|in)|from|constructed\\s+(?:from|of|in))\\s+(?:\\w+\\s+){0,2}?${STEEL_WORD}\\b${NOT_PART}`, 'i');
const STORAGE_COMMA_STEEL_RX = new RegExp(`\\b${STORAGE_NOUN}\\s*[,(:\\-–]\\s*(?:\\w+\\s+)?${STEEL_WORD}\\b${NOT_PART}`, 'i');
const STORAGE_ITEM_RX = new RegExp(`\\b${STORAGE_NOUN}\\b|\\bslotted[\\s-]?angle\\b`, 'i');
const NON_STORAGE_ITEM_RX = /\b(?:sofas?|couch(?:es)?|armchairs?|chairs?|stools?|bench(?:es)?|tables?|desks?|workstations?|beds?(?![\s-]?side)|bunks?|counters?|podiums?|lecterns?)\b/i;
const NON_STEEL_LOCKER_RX = /\b(?:hpl|phenolic|compact\s*laminate|solid\s*grade\s*laminate|sgl|wood(?:en)?|timber|mdf|melamine|veneer|plywood|acrylic)\b/i;

/**
 * True when the item is steel storage: any locker (unless it is specified in
 * HPL / timber / laminate), or a cupboard, cabinet, filing unit, shelving or
 * rack that the headline says is made of steel / metal.
 */
export function isSteelStorageSpec(headline = '', fullText = headline) {
    const head = String(headline || '').toLowerCase();
    const body = String(fullText || head).toLowerCase();
    // Mechanical / mobile compactor systems and fixed joinery have their own lanes
    if (/\b(?:mobile\s*filing|mobile\s*shelving|compactors?|high[\s-]?density\s*(?:filing|shelving))\b/.test(body)) return false;
    if (/\b(?:kitchen|pantry|vanity|built[\s-]?in|overhead|wall[\s-]?hung|base)\s+(?:\w+\s+)?(?:cabinets?|cupboards?|units?)\b/.test(head)) return false;
    if (/\b(?:coat|shoe|magazine|bike|bicycle|cloth(?:es)?|garment|towel|wine|newspaper|umbrella|hat|server|data|network|tv|av|display)\s+(?:\w+\s+)?racks?\b/.test(head)) return false;
    if (NON_FURNITURE_RX.test(head)) return false;
    // Mixed-material office cabinetry (melamine / veneer / timber bodies with metal parts) stays in the office storage lane
    if (!/\blockers?\b/.test(head) && /\b(?:melamine|mdf|veneer|wood(?:en)?|timber|laminated?|hpl|plywood|chipboard|particle\s*board)\b/.test(head)) return false;
    // The headline's first furniture noun is the item ("bench with lockers" is a bench)
    const storageAt = head.search(STORAGE_ITEM_RX);
    const otherAt = head.search(NON_STORAGE_ITEM_RX);
    if (storageAt < 0 || (otherAt >= 0 && otherAt < storageAt)) return false;
    if (/\blockers?\b/.test(head)) return !NON_STEEL_LOCKER_RX.test(body.slice(0, 400));
    if (/\bslotted[\s-]?angle\b/.test(head)) return true;
    return STEEL_THEN_STORAGE_RX.test(head) || STORAGE_OF_STEEL_RX.test(head) || STORAGE_COMMA_STEEL_RX.test(head);
}

const NUMBER_WORDS = {
    1: ['single', 'one'], 2: ['two', 'double'], 3: ['three', 'triple'], 4: ['four'], 5: ['five'], 6: ['six'],
    7: ['seven'], 8: ['eight'], 9: ['nine'], 10: ['ten'], 11: ['eleven'], 12: ['twelve']
};
const COUNTED_NOUN_RX = /\b(\d{1,2})\s*[-\s]?(tiers?|doors?|drawers?|seaters?|shelves|shelf|compartments?|columns?|bays?|levels?|decks?|ways?)\b/gi;

/**
 * Appends the spelled-out form of counted features so "4 tier locker" also
 * reads "four tier locker" (and "2 door" reads "two door"). The original text
 * is kept as is; only bare numbers next to a counted noun are expanded.
 */
export function expandNumberWords(text = '') {
    const s = String(text || '');
    const extra = [];
    s.replace(COUNTED_NOUN_RX, (m, n, noun) => {
        const words = NUMBER_WORDS[Number(n)];
        if (words) words.forEach(w => extra.push(`${w} ${noun.toLowerCase()}`));
        return m;
    });
    return extra.length ? `${s} ${extra.join(' ')}` : s;
}

const COUNT_WORDS = {
    single: 1, one: 1, double: 2, two: 2, triple: 3, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
};
const COUNTED_FEATURE_RX = /\b(\d{1,2}|single|one|double|two|triple|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*[-\s]?(tiers?|compartments?|doors?|drawers?|shelf|shelves)\b/gi;

/**
 * Counted features named in a text: { tier: 4, drawer: 3, shelf: 5 }.
 * Locker doors count as tiers (a six-door locker has six compartments); cupboard
 * doors are ignored because a 2-door cupboard says nothing about its height or shelving.
 */
export function extractCountedFeatures(text = '') {
    const t = String(text || '').toLowerCase();
    const lockerContext = /\blockers?\b/.test(t);
    const out = {};
    for (const m of t.matchAll(COUNTED_FEATURE_RX)) {
        const n = /^\d/.test(m[1]) ? Number(m[1]) : COUNT_WORDS[m[1]];
        const noun = m[2];
        let family = null;
        if (/^(?:tiers?|compartments?)$/.test(noun)) family = 'tier';
        else if (/^doors?$/.test(noun)) family = lockerContext ? 'tier' : null;
        else if (/^drawers?$/.test(noun)) family = 'drawer';
        else if (/^(?:shelf|shelves)$/.test(noun)) family = 'shelf';
        if (family && n && !(family in out)) out[family] = n;
    }
    return out;
}
