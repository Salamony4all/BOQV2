/**
 * Dynamic System Set Matcher (Anchor-First, Brand & Family Coherent)
 *
 * Resolves a workstation / L-shape desk / folding-table set / conference-table set as ONE
 * cohesive same-manufacturer system:
 *  1. Locks in the Anchor component (workstation desk or bench, executive desk, folding table,
 *     conference table), honouring cluster size ("Cluster of 4", "2 Pax") and layout (L-shape,
 *     face-to-face) of catalog products.
 *  2. Fetches the remaining components (side return, divider screen, modesty panel, cable tray,
 *     power & data box, pedestal, monitor arm, chairs) from the SAME brand & product family.
 *     Hardware without its own SKU — or already part of the anchor product — is returned as
 *     "included in system" at price 0 so nothing is double-counted.
 *
 * Catalog products may carry explicit tags that override name heuristics:
 *   setRoles: ['workstation_desk', 'folding_table', …]   roles the product can fill (authoritative)
 *   seatsPerUnit: 4                                        positions covered by ONE unit
 *   includesRoles: ['side_return']                         components that are part of the product
 *   excludeFromSets: true                                  never offered as a set component
 */

const ROLE_RULES = {
  workstation_desk: {
    mustTitleCat: /\b(workstation|bench|desks?|desking|table\s*system)\b/i,
    forbidTitleCat: /\b(chair|armchair|sofa|couch|stool|pouf|ottoman|screen|sreens|divider|partition|pedestal|cabinet|locker|shelving|bookcase|wardrobe|coffee\s*table|side\s*table|conference|meeting|high\s*table|dining|artwork|pod|booth|column|reception|tower|cable\s*tray|power\s*block|modesty)\b/i,
    positive: [
      { re: /\b(workstation|bench\s*desk|desk\s*bench|bench\s*system|cluster|linear\s*desk|double\s*desk|back[-\s]?to[-\s]?back|zedo\s*bench|nova\s*u\s*bench|be\.1|temptation\s*four|5th\s*element|oxi)\b/i, w: 46 },
      { re: /\b(nova\s*[uh]|nova\s*wood|air\s*desk|optima|bench|desking|operational\s*desk|staff\s*desk|modular\s*desk|work\s*desk|office\s*desk)\b/i, w: 30 },
      { re: /\b(desks?|worktop|table\s*system)\b/i, w: 16 },
    ],
    catPositive: [
      { re: /\b(workstations?|bench|desking|desks|sit\s*stand)\b/i, w: 28 },
      { re: /\bsingle\s*desks?\b/i, w: 10 },
    ],
    negative: [
      { re: /\b(executive\s*(?:furniture|desk|suite|cabinet|table)|manager\s*desk|director\s*desk|ceo\s*desk)\b/i, w: -45 },
      { re: /\b(multipurpose|cafe|bar|dining)\b/i, w: -12 },
    ],
    minScore: 16,
  },
  executive_desk: {
    mustTitleCat: /\b(executive|manager(?:ial)?|director|l[-\s]?shape|desks?|desking|mux70|alplus|plana|move\s*&\s*lead|vytis|air\s*executive|nova\s*executive|temptation\s*prime|5th\s*element|next)\b/i,
    forbidTitleCat: /\b(chair|armchair|sofa|couch|stool|screen|sreens|divider|partition|pedestal|cabinet|locker|shelving|bookcase|wardrobe|coffee\s*table|side\s*table|conference|meeting|high\s*table|dining|artwork|pod|booth|column|reception|tower|cable\s*tray|power\s*block|modesty|credenza)\b/i,
    positive: [
      { re: /\b(executive\s*(?:l[-\s]?shaped?\s*)?(?:desk|furniture)|l[-\s]?shaped?\s*(?:executive\s*)?desk|nova\s*executive|air\s*executive|plana\s*executive|move\s*&\s*lead|alplus\s*executive|mux70|temptation\s*prime|vytis)\b/i, w: 54 },
      { re: /\b(executive|manager(?:ial)?|director|return|desks?)\b/i, w: 24 },
    ],
    catPositive: [
      { re: /\b(executive\s*(?:desks?|furniture)|desks?|single\s*desks?)\b/i, w: 28 },
    ],
    negative: [
      { re: /\b(bench\s*desk|folding|flip\s*top|sit\s*stand)\b/i, w: -18 },
    ],
    minScore: 20,
  },
  side_return: {
    mustTitleCat: /\b(return|credenzas?|sideboards?|cabinets?|pedestals?|service\s*units?|storage|drawers?)\b/i,
    forbidTitleCat: /\b(chair|armchair|sofa|couch|stool|screen|sreens|divider|partition|coffee\s*table|conference|meeting|artwork|pod|booth|column|reception|wardrobe|cloakroom|cable\s*tray|power\s*block|\d+\s*pax|cluster|face\s*to\s*face|single\s*line|workstations?|full\s*height|bookcases?|lockers?)\b/i,
    positive: [
      { re: /\b(side\s*return|return\s*(?:credenza|storage|cabinet|unit)|executive\s*cabinets?|credenzas?|sideboards?|service\s*units?|choice\s*cabinets?|nova\s*pedestals?)\b/i, w: 58 },
      { re: /\b(cabinets?|pedestals?|storage|drawers?)\b/i, w: 26 },
    ],
    catPositive: [
      { re: /\b(return|credenzas?|executive\s*cabinets?|cabinets?|storage|pedestals?)\b/i, w: 26 },
    ],
    negative: [
      { re: /\b(lockers?|towers?|high\s*shelving|bookcase)\b/i, w: -16 },
    ],
    minScore: 22,
  },
  folding_table: {
    mustTitleCat: /\b(flip[\s-]?tops?|fliptop|fold(?:ing|able)?|tilting|nesting|training\s*tables?|learning\s*tables?|seminar\s*tables?|trainee|mastermind\s*fold|ypsilon\s*tilting|piego|chiudo|se:?lab\s*(?:flip|fold))\b/i,
    forbidTitleCat: /\b(chair|armchair|sofa|couch|stool|screen|sreens|divider|partition|pedestal|cabinet|locker|coffee\s*table|side\s*table|occasional|high\s*table|bar\s*table|artwork|pod|booth|column|reception|executive\s*furniture|cable\s*tray|power\s*block|modesty|lectern|podium|easel|markerboard|(?:two|three|four|five|six|eight|ten|twelve)[-\s]?fold)\b/i,
    positive: [
      { re: /\b(flip[\s-]?tops?|fliptop|folding\s*(?:conference|meeting|training|desk)?\s*tables?|foldable\s*(?:desk|table)s?|tilting\s*(?:folding\s*)?(?:conference|meeting)?\s*tables?|mastermind\s*fold|ypsilon\s*tilting|nesting\s*tables?|mobile\s*(?:folding|meeting|training)|piego|chiudo|se:?lab\s*(?:flip|fold)|pop\s*folding)\b/i, w: 62 },
      { re: /\b(training\s*tables?|learning\s*tables?|seminar\s*tables?|trainee|fold(?:ing|able)?)\b/i, w: 38 },
    ],
    catPositive: [
      { re: /\b(folding|flip[\s-]?top|training|conference\s*tables?|meeting\s*tables?|multi[-\s]?purpose)\b/i, w: 24 },
    ],
    negative: [
      { re: /\b(round\s*multipurpose|coffee|lounge|executive\s*desk|folding\s*chairs?|stools?)\b/i, w: -24 },
    ],
    minScore: 30,
  },
  conference_table: {
    mustTitleCat: /\b(conference\s*tables?|meeting\s*tables?|boardroom|t[-\s]?meeting|arqus\s*meeting|arki[-\s]?table|i[-\s]?meet|elliot|get\s*together|flip[\s-]?top|tables?)\b/i,
    forbidTitleCat: /\b(chair|armchair|sofa|couch|stool|screen|sreens|divider|partition|pedestal|cabinet|locker|coffee\s*table|side\s*table|occasional|high\s*table|bar\s*table|artwork|pod|booth|column|reception|cable\s*tray|power\s*block|modesty|lectern|podium)\b/i,
    positive: [
      { re: /\b(conference\s*tables?|boardroom\s*tables?|meeting\s*tables?|arqus\s*meeting|arki[-\s]?table|i[-\s]?meet|t[-\s]?meeting|get\s*together)\b/i, w: 54 },
      { re: /\b(modular\s*table|multi[-\s]?purpose\s*table|boardroom|conference|meeting)\b/i, w: 20 },
    ],
    catPositive: [
      { re: /\b(conference\s*tables?|meeting\s*tables?|boardroom)\b/i, w: 30 },
    ],
    negative: [
      { re: /\b(coffee|side|occasional|high\s*table|bar|cafeteria|canteen|dining|workshop)\b/i, w: -30 },
    ],
    minScore: 22,
  },
  meeting_chair: {
    mustTitleCat: /\b(chairs?|seating)\b/i,
    forbidTitleCat: /\b(sofa|couch|lounge|armchair|stool|high\s*chair|bar\s*chair|desk|table|pedestal|cabinet|screen|pod|bench|artwork|column)\b/i,
    positive: [
      { re: /\b(conference\s*chairs?|meeting\s*chairs?|visitor\s*chairs?|stackable\s*chairs?|nesting\s*chairs?|training\s*chairs?|task\s*chairs?|office\s*chairs?)\b/i, w: 54 },
      { re: /\b(chairs?)\b/i, w: 14 },
    ],
    catPositive: [
      { re: /\b(conference\s*chairs?|meeting\s*chairs?|visitor\s*chairs?|task\s*chairs?|office\s*seating)\b/i, w: 32 },
    ],
    negative: [],
    minScore: 22,
  },
  screen: {
    mustTitleCat: /\b(screens?|sreens?|dividers?|partitions?|privacy\s*panels?|baffles?)\b/i,
    forbidTitleCat: /\b(artwork|cloud|pod|booth|column|chair|sofa|couch|stool|pedestal|cabinet|locker|coffee\s*table|conference|meeting|tower|free[\s-]?standing|floor[\s-]?standing|enclosures?|easels?|lite\s*wall|markerboards?|round\s*pet|ottomans?|lounge)\b/i,
    positive: [
      { re: /\b(desk\s*(?:\d+\s*)?(?:acoustic\s*)?s?creens?|desktop\s*s?creens?|workstation\s*s?creens?|desk\s*dividers?|privacy\s*s?creens?|table\s*s?creens?|mounted\s*s?creens?|modus\s*acoustic|top\s*530|desk\s*760)\b/i, w: 54 },
      { re: /\b(acoustic\s*s?creens?|divider\s*s?creens?|acoustic\s*dividers?|desk\s*partitions?|pinboards?|tackboards?|pet\s*acoustic\s*s?creens?)\b/i, w: 40 },
      { re: /\b(screens?|sreens?|dividers?|partitions?|baffles?)\b/i, w: 22 },
    ],
    catPositive: [
      { re: /\b(acoustic\s*screens?|desk\s*screens?|screens?|partitions?|dividers?)\b/i, w: 30 },
    ],
    negative: [
      { re: /\bfree\s*standing\b/i, w: -16 },
      { re: /\bfloor\s*standing\b/i, w: -16 },
    ],
    minScore: 24,
  },
  modesty_panel: {
    mustTitleCat: /\b(modesty|under[\s-]?desk\s*panels?|front\s*panels?|desk\s*(?:\d+\s*)?(?:acoustic\s*)?s?creens?|desktop\s*s?creens?|desk\s*panels?)\b/i,
    forbidTitleCat: /\b(artwork|cloud|free\s*standing|floor\s*standing|pod|booth|column|chair|sofa|couch|stool|pedestal|cabinet|locker|tower|executive\s*furniture|reception)\b/i,
    positive: [
      { re: /\b(modesty\s*panels?|front\s*modesty|under[\s-]?desk\s*panels?|front\s*panels?|modesty\s*screens?)\b/i, w: 60 },
      { re: /\b(desk\s*(?:\d+\s*)?(?:acoustic\s*)?s?creens?|desktop\s*s?creens?|desk\s*panels?|under[\s-]?desk\s*screens?|privacy\s*panels?)\b/i, w: 30 },
    ],
    catPositive: [
      { re: /\b(modesty|desk\s*screens?|acoustic\s*screens?)\b/i, w: 18 },
    ],
    negative: [],
    minScore: 26,
  },
  cable_management: {
    mustTitleCat: /\b(cable|wire\s*(?:trays?|management|channels?|ducts?|baskets?)|grommets?|raceways?|trunking|cable\s*spines?|under[\s-]?desk\s*trays?)\b/i,
    forbidTitleCat: /\b(chair|sofa|couch|stool|lounge|pedestal|cabinet|locker|wardrobe|coffee\s*table|conference|meeting|pod|booth|reception|executive|artwork|screen|tower|bench\s*desk|sit\s*stand\s*desk)\b/i,
    positive: [
      { re: /\b(cable\s*(?:trays?|management|channels?|troughs?|baskets?|spines?|ducts?|risers?|raceways?|trunking|box(?:es)?)|wire\s*(?:trays?|management|baskets?)|under[\s-]?desk\s*cable)\b/i, w: 65 },
      { re: /\b(grommets?|cable\s*ports?|cable\s*hatch|flip[\s-]?top\s*(?:box|cable)|wire\s*channels?)\b/i, w: 42 },
      { re: /\b(cable|wiring)\b/i, w: 24 },
    ],
    catPositive: [
      { re: /\b(cable|electrification|wire)\b/i, w: 26 },
    ],
    negative: [],
    minScore: 30,
  },
  power_box: {
    mustTitleCat: /\b(power|electrif|sockets?|outlets?|data\s*(?:box(?:es)?|modules?|ports?)|usb|grommets?|pop[\s-]?up|charging\s*modules?)\b/i,
    forbidTitleCat: /\b(chair|sofa|couch|stool|lounge|pedestal|cabinet|locker|wardrobe|coffee\s*table|conference|meeting|pod|booth|reception|executive|artwork|screen|tower|bench\s*desk|sit\s*stand\s*desk)\b/i,
    positive: [
      { re: /\b(power\s*(?:box(?:es)?|modules?|sockets?|outlets?|strips?|bars?|units?|data|&\s*data|and\s*data|dock)|data\s*(?:box(?:es)?|modules?|sockets?)|electrification|desk\s*sockets?|pop[\s-]?up\s*(?:sockets?|box(?:es)?)|usb\s*(?:chargers?|modules?|sockets?))\b/i, w: 65 },
      { re: /\b(power\s*access|flip[\s-]?top\s*power|grommets?|socket\s*box(?:es)?|charging\s*modules?)\b/i, w: 45 },
      { re: /\b(power|sockets?|electrif)/i, w: 24 },
    ],
    catPositive: [
      { re: /\b(electrification|power)\b/i, w: 26 },
    ],
    negative: [],
    minScore: 30,
  },
  pedestal: {
    mustTitleCat: /\b(pedestals?|drawers?|cadd(?:y|ies)|under[\s-]?desk\s*storage)\b/i,
    forbidTitleCat: /\b(chair|sofa|couch|stool|lounge|screen|partition|divider|coffee\s*table|conference|meeting|pod|booth|reception|wardrobe|cloakroom|cable\s*tray|artwork|\d+\s*pax|cluster|face\s*to\s*face|single\s*line|workstations?|executive\s*desk|l[-\s]?shape|pedestal\s*(?:work|table)|work\s*tables?)\b/i,
    positive: [
      { re: /\b(mobile\s*pedestals?|under[\s-]?desk\s*pedestals?|drawer\s*pedestals?|[234][-\s]?drawer\s*pedestals?|pedestals?|cadd(?:y|ies)|drawer\s*units?|under[\s-]?desk\s*storage)\b/i, w: 58 },
      { re: /\b(drawers?|side\s*storage|return\s*storage|filing\s*drawers?)\b/i, w: 30 },
    ],
    catPositive: [
      { re: /\b(pedestals?|storage|drawers?)\b/i, w: 24 },
    ],
    negative: [
      { re: /\b(towers?|lockers?|high\s*cabinets?|bookcases?|shelving|wardrobes?)\b/i, w: -28 },
    ],
    minScore: 26,
  },
  monitor_arm: {
    mustTitleCat: /\b(monitor\s*arms?|vesa|display\s*arms?|monitor\s*(?:holders?|mounts?|stands?)|screen\s*arms?)\b/i,
    forbidTitleCat: /\b(chair|sofa|desk|table|pedestal|cabinet|locker|acoustic\s*screen|pod|artwork)\b/i,
    positive: [
      { re: /\b(monitor\s*arms?|dual\s*monitor|single\s*monitor|vesa\s*(?:arms?|mounts?)|screen\s*arms?|display\s*arms?|monitor\s*holders?|monitor\s*stands?)\b/i, w: 62 },
    ],
    catPositive: [
      { re: /\b(monitor|ergonomic)\b/i, w: 22 },
    ],
    negative: [],
    minScore: 30,
  },
  task_chair: {
    mustTitleCat: /\b(chairs?|seating)\b/i,
    forbidTitleCat: /\b(sofa|couch|lounge|armchair|stool|high\s*chair|bar\s*chair|visitor|conference\s*chair|executive\s*chair|desk|table|pedestal|cabinet|screen|pod|bench|artwork)\b/i,
    positive: [
      { re: /\b(task\s*chairs?|ergonomic\s*(?:office\s*)?chairs?|operational\s*chairs?|mesh\s*(?:task\s*)?chairs?|workstation\s*chairs?|swivel\s*chairs?|staff\s*chairs?|office\s*chairs?)\b/i, w: 54 },
      { re: /\b(chairs?)\b/i, w: 12 },
    ],
    catPositive: [
      { re: /\b(task\s*chairs?|staff\s*chairs?|office\s*seating|ergonomic\s*chairs?|operational\s*chairs?)\b/i, w: 32 },
    ],
    negative: [],
    minScore: 24,
  },
  accessory: {
    mustTitleCat: /\b(cpu\s*holders?|keyboard\s*trays?|pen\s*trays?|desk\s*lamps?|task\s*lights?|bag\s*hooks?|organizers?)\b/i,
    forbidTitleCat: /\b(sofa|couch|lounge|conference|executive\s*furniture|pod|wardrobe|artwork)\b/i,
    positive: [
      { re: /\b(cpu\s*holders?|keyboard\s*trays?|pen\s*trays?|desk\s*lamps?|task\s*lights?|bag\s*hooks?|organizers?)\b/i, w: 52 },
    ],
    catPositive: [
      { re: /\b(lighting|desk\s*accessories)\b/i, w: 20 },
    ],
    negative: [],
    minScore: 26,
  },
};

const ANCHOR_ROLES = new Set(['workstation_desk', 'executive_desk', 'folding_table', 'conference_table']);

const FAMILY_STOPWORDS = new Set([
  'desk', 'desks', 'table', 'tables', 'chair', 'chairs', 'sofa', 'sofas',
  'workstation', 'workstations', 'bench', 'system', 'office', 'furniture',
  'executive', 'single', 'double', 'linear', 'modular', 'acoustic', 'screen',
  'screens', 'panel', 'panels', 'pedestal', 'pedestals', 'storage', 'cabinet',
  'cabinets', 'task', 'ergonomic', 'wood', 'metal', 'fabric', 'glass', 'round',
  'square', 'multipurpose', 'free', 'standing', 'active', 'sit', 'stand', 'the',
  'and', 'for', 'with', 'series', 'collection', 'model', 'type', 'new', 'plus'
]);

/**
 * Extracts a clean product family root from an anchor workstation model name, e.g.:
 *   "Nova U Desks #20264116" -> "nova"
 *   "Air Desks #20264032" -> "air"
 *   "Q Active Sit Stand Desk" -> "q active"
 */
export function extractAnchorFamily(product = {}, brandName = '') {
  const brandLow = String(brandName || '').toLowerCase().trim();
  const explicitFamily = String(product.family || '').trim();
  if (
    explicitFamily &&
    explicitFamily.length >= 2 &&
    explicitFamily.toLowerCase() !== 'collection' &&
    explicitFamily.toLowerCase() !== brandLow &&
    !brandLow.includes(explicitFamily.toLowerCase()) &&
    !FAMILY_STOPWORDS.has(explicitFamily.toLowerCase())
  ) {
    return explicitFamily.toLowerCase();
  }
  const cleanModel = String(product.model || '')
    .replace(/#\d+/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  const tokens = cleanModel.split(/[\s\-_/]+/).filter(Boolean);
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (low.length >= 3 && !/^\d+$/.test(low) && low !== brandLow && !FAMILY_STOPWORDS.has(low)) {
      return low;
    }
  }
  return '';
}

export function inferComponentRole(component = {}) {
  if (component.componentRole && ROLE_RULES[component.componentRole]) {
    return component.componentRole;
  }
  const text = `${component.label || ''} ${component.description || ''}`.toLowerCase();
  if (/\b(flip[\s-]?top|folding\s*(?:conference|meeting|training)?\s*table|tilting\s*table|nesting\s*table)\b/.test(text)) return 'folding_table';
  if (/\b(conference\s*table|boardroom\s*table|meeting\s*(?:room\s*)?table)\b/.test(text)) return 'conference_table';
  if (/\b(side\s*return|return\s*(?:credenza|storage|cabinet|extension|desk|unit)|meeting\s*room\s*storage\s*credenza|credenza|sideboard)\b/.test(text)) return 'side_return';
  if (/\b(executive\s*(?:l[-\s]?shape\s*)?(?:main\s*)?desk)\b/.test(text)) return 'executive_desk';
  if (/\bl[-\s]?shaped?\b[^\n]{0,30}\bdesks?\b/.test(text) && !/\b(workstations?|bench|cluster|linear|back[-\s]?to[-\s]?back|face[-\s]?to[-\s]?face)\b/.test(text)) return 'executive_desk';
  if (/\b(modesty\s*panels?|front\s*modesty|under[\s-]?desk\s*panels?)\b/.test(text)) return 'modesty_panel';
  if (/\b(power\s*(?:box(?:es)?|modules?|sockets?|outlets?|strips?|units?|data|&\s*data)|data\s*(?:box(?:es)?|ports?|sockets?)|electrification|pop[\s-]?ups?|usb)\b/.test(text)) return 'power_box';
  if (/\b(cable\s*(?:trays?|management|channels?|troughs?|baskets?|spines?|ducts?|risers?|raceways?)|wire\s*(?:trays?|management)|grommets?)\b/.test(text)) return 'cable_management';
  if (/\b(monitor\s*arms?|screen\s*arms?|vesa\s*mounts?|display\s*arms?)\b/.test(text)) return 'monitor_arm';
  if (/\b(screens?|dividers?|partitions?|privacy\s*panels?|acoustic\s*panels?|pinboards?|tackboards?|baffles?)\b/.test(text)) return 'screen';
  if (/\b(pedestals?|drawer\s*(?:units?|box(?:es)?|cabinets?)|[234][-\s]?drawers?|under[\s-]?desk\s*storage|cadd(?:y|ies))\b/.test(text)) return 'pedestal';
  if (/\b((?:conference|meeting|training|stackable|nesting|visitor)\s*chairs?)\b/.test(text)) return 'meeting_chair';
  if (/\b(task\s*chairs?|office\s*chairs?|ergonomic\s*chairs?|mesh\s*chairs?|swivel\s*chairs?|chairs?)\b/.test(text)) return 'task_chair';
  if (/\b(cpu\s*holders?|keyboard\s*trays?|pen\s*trays?|desk\s*lamps?|task\s*lights?)\b/.test(text)) return 'accessory';
  return 'workstation_desk';
}

function isUsableProductImage(url = '') {
  const s = String(url || '').trim();
  if (!s) return false;
  if (/img\.architonic\.com/i.test(s)) return false;
  if (/placeholder|no-image|default-logo|blank\./i.test(s)) return false;
  return true;
}

// ── Catalog hygiene: scraped navigation / category / gallery entries are not products ──
const JUNK_MODEL_RE = /^(?:previous|next|colou?r\s*charts?|find\s*out\s*more|read\s*more|learn\s*more|view\s*(?:all|more)|see\s*(?:all|more)|planning\s*scenarios?|find\s*a\s*showroom|image\s*gallery|full\s*product\s*list|product\s*details|products?\s*featured.*|downloads?|catalogues?|catalogs?|brochures?|contacts?(?:\s*us)?|about(?:\s*us)?|news|home|menu|search|login|sign\s*in|designers?|collections?|products?|failed|visit\s+.+|explore\s+.+|what'?s\s*new|pricing\s*module.*)$/i;
const JUNK_CATEGORY_RE = /^(?:full\s*product\s*list|what'?s\s*new|explore\s*all\s*settings?|image\s*gallery|designers?|news|downloads?)$/i;
const JUNK_URL_RE = /^(?:javascript:|#|mailto:|tel:)|\/designers?\/|\/pricing-module\//i;

export function isJunkCatalogEntry(product) {
  if (!product) return true;
  if (product.excludeFromSets === true) return true; // unverified placeholder entries
  if (Array.isArray(product.setRoles) && product.setRoles.length > 0) return false;
  const model = String(product.model || '').trim();
  if (!model || /^n\/?a$/i.test(model)) return true;
  if (JUNK_MODEL_RE.test(model) || /\bgallery$/i.test(model)) return true;
  if (model.length > 90 || /\b(?:feature|featuring|pictured|shown\s+(?:here|with))\b/i.test(model)) return true; // scraped captions
  const main = String(product.mainCategory || product.category || '').trim();
  const sub = String(product.subCategory || '').trim();
  if (JUNK_CATEGORY_RE.test(main) || JUNK_CATEGORY_RE.test(sub)) return true;
  // A category's own navigation entry ("DESKING SYSTEMS" inside the DESKING SYSTEMS category)
  const squash = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (main && squash(model) === squash(main)) return true;
  const url = String(product.productUrl || product.websiteUrl || '').trim();
  if (url && JUNK_URL_RE.test(url)) return true;
  return false;
}

/** Positions covered by ONE unit of a catalog workstation product ("Cluster of 4 Face to Face" → 4). */
export function getSeatsPerUnit(product = {}) {
  const explicit = parseInt(product.seatsPerUnit, 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const model = String(product.model || '');
  const m = model.match(/\bcluster\s*(?:of\s*)?(\d{1,2})\b/i) || model.match(/\b(\d{1,2})\s*[-\s]?(?:pax|persons?|seaters?|users?|way)\b/i);
  const n = m ? parseInt(m[1], 10) : 0;
  return n >= 2 && n <= 24 ? n : 1;
}

const FOLDING_PRODUCT_RE = /\b(flip[\s-]?tops?|fliptop|fold(?:ing|able)?|tilting|nesting)\b/i;
const L_SHAPE_PRODUCT_RE = /\bl[-\s]?shaped?\b|\blshape\b/i;

/**
 * Scores a single catalog product for a specific system-set component role.
 * opts.desiredSeats → positions the set needs from the anchor desk (cluster-size aware matching).
 */
export function scoreCatalogProductForRole(product, role, queryText = '', anchorFamily = '', opts = {}) {
  if (!product || !product.model) return -999;
  const modelText = String(product.model || '').trim();
  if (!modelText || /^n\/?a$/i.test(modelText)) return -999;
  if (isJunkCatalogEntry(product)) return -999;

  const rules = ROLE_RULES[role] || ROLE_RULES.workstation_desk;
  const catText = `${product.mainCategory || product.category || ''} ${product.subCategory || ''} ${product.normalization?.category || ''} ${product.normalization?.subCategory || ''}`;
  const titleAndCat = `${modelText} ${product.family || ''} ${catText}`;
  const fullText = `${titleAndCat} ${String(product.description || '').slice(0, 220)}`;
  const queryLow = String(queryText || '').toLowerCase();
  const taggedRoles = Array.isArray(product.setRoles) ? product.setRoles : null;
  const isTaggedForRole = Boolean(taggedRoles && taggedRoles.includes(role));

  // Strict identity gate on model name + category (prevents sofas/desks/wall-art from hijacking accessories).
  // An explicit catalog tag is the strongest identity signal and bypasses the name heuristics.
  if (!isTaggedForRole) {
    if (taggedRoles && taggedRoles.length > 0) return -999; // tags are authoritative: only the listed roles
    if (rules.mustTitleCat && !rules.mustTitleCat.test(titleAndCat)) return -999;
    if (rules.forbidTitleCat && rules.forbidTitleCat.test(titleAndCat)) return -999;
  }

  let score = isTaggedForRole ? 70 : 0;

  for (const { re, w } of rules.positive) {
    if (re.test(titleAndCat)) score += w;
    else if (re.test(fullText)) score += Math.round(w * 0.35);
  }
  for (const { re, w } of (rules.catPositive || [])) {
    if (re.test(catText)) score += w;
  }
  for (const { re, w } of rules.negative) {
    if (role === 'workstation_desk' && /executive/i.test(re.source) && /\bexecutive\b/.test(queryLow)) {
      continue;
    }
    if (re.test(fullText)) score += w;
  }

  const wantsLShape = /\bl[-\s]?shaped?\b|\bside\s*return\b/.test(queryLow);
  const prodIsLShape = L_SHAPE_PRODUCT_RE.test(titleAndCat)
    || (Array.isArray(product.includesRoles) && product.includesRoles.includes('side_return'));

  if (role === 'workstation_desk') {
    // Sit-stand alignment
    const wantsSitStand = /\b(sit[-\s]?stand|height[-\s]?adjustable|motorized|electric)\b/i.test(queryLow);
    const prodIsSitStand = /\b(sit[-\s]?stand|height[-\s]?adjustable|standing|active)\b/i.test(titleAndCat);
    if (wantsSitStand && prodIsSitStand) score += 28;
    else if (!wantsSitStand && prodIsSitStand) score -= 8;

    // Layout alignment (L-shape / face-to-face / single line)
    if (wantsLShape && prodIsLShape) score += 30;
    else if (!wantsLShape && prodIsLShape) score -= 30;
    else if (wantsLShape && !prodIsLShape) score -= 30;
    const wantsFacing = /\b(back[-\s]?to[-\s]?back|face[-\s]?to[-\s]?face|double[-\s]?sided)\b/.test(queryLow);
    const wantsSingleLine = /\b(single[-\s]?sided|single\s*line)\b/.test(queryLow);
    if (wantsFacing && /\b(face\s*to\s*face|back\s*to\s*back|bench|double)\b/i.test(titleAndCat)) score += 12;
    if (wantsSingleLine && /\bsingle\s*line\b/i.test(titleAndCat)) score += 14;
    if (wantsFacing && /\bsingle\s*line\b/i.test(titleAndCat)) score -= 14;

    // Cluster-size alignment ("Cluster of 4" for a 4-position set, single desks for per-position rows)
    const desired = Number(opts.desiredSeats) || 0;
    const seats = getSeatsPerUnit(product);
    if (desired > 0 && seats > 1) {
      if (seats === desired) score += 26;
      else if (seats < desired && desired % seats === 0) score += 10;
      else if (seats < desired) score -= 12;
      else score -= 14 + Math.min(40, (seats - desired) * 8);
    }
  }

  if (role === 'executive_desk') {
    if (wantsLShape && prodIsLShape) score += 24;
    // Basic L-shape / office desk rows must not land on executive-range products
    if (!/\bexecutive\b/.test(queryLow) && /\bexecutive\b/i.test(titleAndCat)) score -= 90;
    if (getSeatsPerUnit(product) > 1) score -= 40;
  }

  // Fixed conference tables: flip-top / folding products only when the BOQ asks for them
  if (role === 'conference_table' && FOLDING_PRODUCT_RE.test(titleAndCat) && !FOLDING_PRODUCT_RE.test(queryLow)) {
    score -= 44;
  }

  // Query token overlap boost (e.g., "pet", "glass", "3-drawer", "dual", "metal", "wood")
  const queryKeywords = queryLow
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !/^(?:with|for|the|and|nos|pcs|set|unit|item|mm|cm|per|position)$/.test(t));
  const fullLow = fullText.toLowerCase();
  let tokenHits = 0;
  for (const tok of queryKeywords) {
    if (fullLow.includes(tok)) tokenHits++;
  }
  score += Math.min(tokenHits * 3, 18);

  // Anchor family coherence boost (e.g. "Nova U Desks" + "Nova Pedestals")
  if (anchorFamily && score > 0 && titleAndCat.toLowerCase().includes(anchorFamily)) {
    score += 36;
  }

  // Data quality bonus (real product image + real price + verified official page)
  if (isUsableProductImage(product.imageUrl || product.images?.[0])) {
    score += 10;
  } else {
    score -= 6;
  }
  if (parseFloat(product.price) > 0) {
    score += 6;
  }
  if (product.verified === true) {
    score += 4;
  }

  return score;
}

function findBestInBrandForRole(brandObj, role, queryText, anchorFamily = '', usedKeys = null, opts = {}) {
  if (!brandObj || !Array.isArray(brandObj.products) || brandObj.products.length === 0) {
    return null;
  }
  const rules = ROLE_RULES[role] || ROLE_RULES.workstation_desk;
  let best = null;
  let bestScore = -Infinity;

  for (const prod of brandObj.products) {
    let s = scoreCatalogProductForRole(prod, role, queryText, anchorFamily, opts);
    if (s <= -500) continue;
    const key = `${brandObj.name.toLowerCase()}::${String(prod.model || '').toLowerCase().trim()}`;
    if (usedKeys && usedKeys.has(key)) s -= 22;
    if (s > bestScore) {
      bestScore = s;
      best = prod;
    }
  }

  if (!best || bestScore < rules.minScore) return null;
  return { brandObj, product: best, score: bestScore };
}

/**
 * Ranks brands that offer the most complete system (anchor + requested component roles)
 * while respecting VE_CATEGORY_CONFIG desking priority order (e.g. NARBUTAS -> Ottimo -> ISMOBIL -> LAS -> Nurus -> FREZZA)
 * so unbranded rows select the preferred contract manufacturer first.
 */
const DESKING_PRIORITY_ORDER = [
  'narbutas', 'ottimo furniture', 'ottimo', 'ismobil', 'las', 'las mobili', 'nurus', 'frezza', 'sedus stoll', 'ofifran', 'arper'
];

const MEETING_FOLDING_PRIORITY_ORDER = [
  'narbutas', 'sedus stoll', 'pedrali', 'frezza', 'ottimo furniture', 'nurus', 'las', 'b&t design', 'arper'
];

function pickBestWorkstationSystemBrand(brandsList, components, parentDescription, anchorRole = 'workstation_desk', anchorQuery = '', opts = {}) {
  let bestBrand = null;
  let bestSystemScore = -Infinity;
  const roles = components.map(c => inferComponentRole(c));
  const priorityOrder = (anchorRole === 'folding_table' || anchorRole === 'conference_table')
    ? MEETING_FOLDING_PRIORITY_ORDER
    : DESKING_PRIORITY_ORDER;

  for (const b of brandsList) {
    if (!b || !b.name || b.name.toLowerCase().includes('fitout') || !Array.isArray(b.products) || b.products.length === 0) continue;
    const deskHit = findBestInBrandForRole(b, anchorRole, anchorQuery || parentDescription, '', null, opts);
    if (!deskHit) continue;

    const family = extractAnchorFamily(deskHit.product, b.name);
    let systemScore = deskHit.score * 1.4;
    let roleCoverage = 1;

    for (const r of roles) {
      if (r === anchorRole) continue;
      const compHit = findBestInBrandForRole(b, r, parentDescription, family);
      if (compHit) {
        roleCoverage++;
        systemScore += Math.min(compHit.score, 60) * 0.65;
      }
    }

    const bLow = b.name.toLowerCase().trim();
    const prioIdx = priorityOrder.findIndex(p => bLow === p || bLow.includes(p));
    if (prioIdx !== -1) {
      systemScore += Math.max(10, 65 - prioIdx * 10);
    }

    systemScore += roleCoverage * 16;
    if (systemScore > bestSystemScore) {
      bestSystemScore = systemScore;
      bestBrand = { brandObj: b, deskHit, family, systemScore, roleCoverage };
    }
  }

  return bestBrand;
}

/**
 * Routes an external product image through the server image proxy (CORS / hot-link safe).
 * `proxyBaseUrl` is what the server's getProxyBase(req) returns — it already ends with
 * "/api/image-proxy?url=" — a bare origin is accepted too. Never wraps twice.
 */
export function toProxiedImageUrl(rawImg, proxyBaseUrl = '') {
  const img = String(rawImg || '');
  if (!img || !proxyBaseUrl || !/^https?:\/\//i.test(img) || img.includes('/api/image-proxy')) return img;
  const base = /\/api\/image-proxy\?url=$/i.test(proxyBaseUrl)
    ? proxyBaseUrl
    : `${String(proxyBaseUrl).replace(/\/+$/, '')}/api/image-proxy?url=`;
  return `${base}${encodeURIComponent(img)}`;
}

function formatProductResult(brandObj, prod, role, matchSource, resolveBrandLogo, proxyBaseUrl) {
  const rawImg = isUsableProductImage(prod.imageUrl)
    ? prod.imageUrl
    : (Array.isArray(prod.images) ? prod.images.find(isUsableProductImage) || '' : '');
  const imageUrl = toProxiedImageUrl(rawImg, proxyBaseUrl);

  const brandLogo = typeof resolveBrandLogo === 'function'
    ? resolveBrandLogo(brandObj, prod.websiteUrl || prod.productUrl || '')
    : (brandObj.logo || '');

  return {
    brand: brandObj.name,
    brandLogo,
    model: prod.model || '',
    mainCategory: prod.mainCategory || prod.category || prod.normalization?.category || '',
    subCategory: prod.subCategory || prod.normalization?.subCategory || '',
    family: prod.family || extractAnchorFamily(prod) || '',
    imageUrl,
    productUrl: prod.productUrl || prod.websiteUrl || rawImg || '',
    websiteUrl: prod.websiteUrl || prod.productUrl || '',
    price: parseFloat(prod.price) || 0,
    description: prod.description || prod.model || '',
    componentRole: role,
    matchSource,
  };
}

/**
 * Component roles that are part of the anchor product itself: either tagged in the catalog
 * (includesRoles) or stated in the product NAME ("L Shape Executive Desk", "… With Metal Pedestal").
 */
const ANCHOR_NAME_INCLUDES_RE = {
  side_return: /\bl[-\s]?shaped?\b|\blshape\b|\bwith\s+(?:side\s*)?return\b|\bwith\s+credenza\b/i,
  screen: /\b(?:with|incl(?:uding)?\.?|c\/w)\s+(?:\w+\s+){0,2}(?:screens?|partitions?|dividers?|glass)\b/i,
  pedestal: /\b(?:with|incl(?:uding)?\.?|c\/w)\s+(?:\w+\s+){0,2}(?:pedestals?|drawers?)\b/i,
};
function anchorIncludesRole(anchorProduct, role) {
  if (!anchorProduct) return false;
  if (Array.isArray(anchorProduct.includesRoles) && anchorProduct.includesRoles.includes(role)) return true;
  const re = ANCHOR_NAME_INCLUDES_RE[role];
  return Boolean(re && re.test(String(anchorProduct.model || '')));
}
const INTEGRATED_HARDWARE_ROLES = new Set(['cable_management', 'power_box', 'modesty_panel', 'monitor_arm', 'accessory']);

function findBrandByName(brandsList, name) {
  const low = String(name || '').toLowerCase().trim();
  if (!low) return null;
  return brandsList.find(b => b.name.toLowerCase().trim() === low)
    || brandsList.find(b => b.name.toLowerCase().includes(low) || low.includes(b.name.toLowerCase()))
    || null;
}

/**
 * Executes Anchor-First Dynamic System Set Matching.
 * preferredBrand → soft preference in auto mode (e.g. the brand already matched for the row's
 * single-table item, so its "set of folding tables" option comes from the same manufacturer).
 */
export async function matchWorkstationSet({
  parentDescription = '',
  components = [],
  targetBrand = '',
  preferredBrand = '',
  isAuto = true,
  availableBrands = null,
  allLocalBrands = [],
  providerModel = null,
  veMatchSimple = null,
  veMatchAuto = null,
  detectSpecifiedBrandInText = null,
  resolveBrandLogo = null,
  proxyBaseUrl = '',
}) {
  const isExcludedCatalogBrand = (b) => {
    if (!b || !b.name) return true;
    const low = b.name.toLowerCase();
    if (low.includes('fitout')) return true;
    if (/\bstructure\s*test\b|\btest\s*brand\b/i.test(low) && low.trim() !== String(targetBrand || '').toLowerCase().trim()) return true;
    return false;
  };
  const nonFitoutBrands = (allLocalBrands || []).filter(b => !isExcludedCatalogBrand(b));

  // Scope eligible brands if Multi-Budget passed availableBrands filter
  const eligibleBrands = (Array.isArray(availableBrands) && availableBrands.length > 0)
    ? nonFitoutBrands.filter(b => availableBrands.some(ab => String(ab).toLowerCase().trim() === b.name.toLowerCase().trim()))
    : nonFitoutBrands;
  const searchBrands = eligibleBrands.length > 0 ? eligibleBrands : nonFitoutBrands;

  const normalizedComponents = (Array.isArray(components) ? components : []).map((c, idx) => ({
    ...c,
    _idx: idx,
    componentRole: inferComponentRole(c),
  }));

  if (normalizedComponents.length === 0) {
    return { status: 'error', message: 'No workstation components provided', components: [] };
  }

  // Locate anchor component (workstation_desk / executive_desk / folding_table / conference_table)
  const foundAnchorIdx = normalizedComponents.findIndex(c => ANCHOR_ROLES.has(c.componentRole));
  const anchorIdx = foundAnchorIdx >= 0 ? foundAnchorIdx : 0;
  const anchorComp = normalizedComponents[anchorIdx];
  const anchorRole = anchorComp.componentRole || 'workstation_desk';
  const desiredSeats = anchorRole === 'workstation_desk'
    ? (parseFloat(anchorComp.seatCount) || parseFloat(anchorComp.qty) || 0)
    : 0;
  const anchorOpts = { desiredSeats };

  // Resolve requested/specified brand if any
  let requestedBrandName = (!isAuto && targetBrand && targetBrand !== 'Auto' && targetBrand !== 'Auto Detected')
    ? String(targetBrand).trim()
    : '';

  if (!requestedBrandName && typeof detectSpecifiedBrandInText === 'function') {
    const detected = detectSpecifiedBrandInText(parentDescription, searchBrands);
    if (detected) requestedBrandName = typeof detected === 'string' ? detected : (detected.name || detected.brand || '');
  }

  let anchorBrandObj = requestedBrandName ? findBrandByName(searchBrands, requestedBrandName) : null;

  let anchorProduct = null;
  let anchorFamily = '';
  let anchorSource = 'workstation-system-catalog';

  // ── STAGE 1: RESOLVE ANCHOR SYSTEM COMPONENT (Workstation / L-Shape Desk / Folding or Fixed Conference Table) ──
  const hasSideReturn = normalizedComponents.some(c => c.componentRole === 'side_return');
  const anchorQuery = `${anchorComp.description || anchorComp.label || ''} ${hasSideReturn ? 'with side return ' : ''}${parentDescription.slice(0, 180)}`.trim();

  if (anchorBrandObj) {
    const deskHit = findBestInBrandForRole(anchorBrandObj, anchorRole, anchorQuery, '', null, anchorOpts);
    if (deskHit) {
      anchorProduct = deskHit.product;
      anchorFamily = extractAnchorFamily(deskHit.product, anchorBrandObj.name);
      anchorSource = 'system-brand-catalog';
    }
  } else {
    // Soft preference: keep the manufacturer already chosen for this row when it offers the anchor
    const preferredBrandObj = preferredBrand ? findBrandByName(searchBrands, preferredBrand) : null;
    const preferredHit = preferredBrandObj
      ? findBestInBrandForRole(preferredBrandObj, anchorRole, anchorQuery, '', null, anchorOpts)
      : null;
    if (preferredHit) {
      anchorBrandObj = preferredBrandObj;
      anchorProduct = preferredHit.product;
      anchorFamily = extractAnchorFamily(preferredHit.product, preferredBrandObj.name);
      anchorSource = 'system-preferred-brand';
    } else {
      // Auto Detect: pick best complete same-manufacturer system brand honoring category priority order
      const sysPick = pickBestWorkstationSystemBrand(searchBrands, normalizedComponents, parentDescription, anchorRole, anchorQuery, anchorOpts);
      if (sysPick && sysPick.deskHit) {
        anchorBrandObj = sysPick.brandObj;
        anchorProduct = sysPick.deskHit.product;
        anchorFamily = sysPick.family;
        anchorSource = 'system-auto-priority';
      }
    }
  }

  // Fallback to AI identity if brand had no local anchor match
  if (!anchorProduct && anchorBrandObj && typeof veMatchSimple === 'function') {
    try {
      const candidateProducts = (anchorBrandObj.products || []).filter(p => !isJunkCatalogEntry(p));
      const modelList = candidateProducts.map(p => p.model).filter(Boolean);
      const aiRes = await veMatchSimple(anchorQuery, anchorBrandObj.name, modelList, providerModel);
      if (aiRes?.status === 'success' && aiRes.model) {
        const hit = candidateProducts.find(p => p.model && p.model.toLowerCase().trim() === aiRes.model.toLowerCase().trim())
          || candidateProducts.find(p => p.model && p.model.toLowerCase().includes(aiRes.model.toLowerCase()));
        if (hit) {
          anchorProduct = hit;
          anchorFamily = extractAnchorFamily(hit, anchorBrandObj.name);
          anchorSource = 'system-ai-brand';
        }
      }
    } catch (e) {
      console.warn('[SystemSetMatcher] Anchor AI fallback warning:', e.message);
    }
  }

  if (!anchorProduct && isAuto && typeof veMatchAuto === 'function') {
    try {
      const brandNames = searchBrands.map(b => b.name);
      const aiAuto = await veMatchAuto(anchorQuery, providerModel, [], brandNames, searchBrands);
      if (aiAuto?.status === 'success' && aiAuto.brand) {
        const foundBrand = searchBrands.find(b => b.name.toLowerCase().trim() === String(aiAuto.brand).toLowerCase().trim());
        if (foundBrand) {
          const deskHit = findBestInBrandForRole(foundBrand, anchorRole, anchorQuery, '', null, anchorOpts);
          if (deskHit) {
            anchorBrandObj = foundBrand;
            anchorProduct = deskHit.product;
            anchorFamily = extractAnchorFamily(deskHit.product, foundBrand.name);
            anchorSource = 'system-ai-upgraded';
          }
        }
      }
    } catch (e) {
      console.warn('[SystemSetMatcher] Auto anchor warning:', e.message);
    }
  }

  const results = new Array(normalizedComponents.length).fill(null);
  const usedKeys = new Set();

  if (anchorBrandObj && anchorProduct) {
    usedKeys.add(`${anchorBrandObj.name.toLowerCase()}::${String(anchorProduct.model || '').toLowerCase().trim()}`);
    const anchorResult = formatProductResult(anchorBrandObj, anchorProduct, anchorRole, anchorSource, resolveBrandLogo, proxyBaseUrl);
    // A cluster product covers several positions: tell the client how many units ONE set needs
    const seatsPerUnit = anchorRole === 'workstation_desk' ? getSeatsPerUnit(anchorProduct) : 1;
    if (seatsPerUnit > 1 && desiredSeats > 0) {
      anchorResult.seatsPerUnit = seatsPerUnit;
      anchorResult.suggestedQty = Math.round((desiredSeats / seatsPerUnit) * 100) / 100;
    }
    results[anchorIdx] = {
      index: anchorIdx,
      status: 'success',
      product: anchorResult,
      confidenceScore: 94,
    };
  }

  const includedInAnchor = (comp, role, reason) => {
    const anchorFormatted = formatProductResult(anchorBrandObj, anchorProduct, role, 'workstation-same-brand-integrated', resolveBrandLogo, proxyBaseUrl);
    return {
      ...anchorFormatted,
      model: `${anchorFormatted.model} — ${comp.label || role}`,
      description: `${comp.description || comp.label} (${reason})`,
      imageUrl: '', // Avoid duplicating the anchor photo in the multi-image gallery
      price: 0,     // Included in the anchor system price (prevents double-counting)
      includedInSystem: true,
    };
  };

  // ── STAGE 2: STRICT SAME-MANUFACTURER COMPONENT FETCH ──
  // Every component of a system set MUST belong to anchorBrandObj (never mix a second manufacturer!).
  for (let i = 0; i < normalizedComponents.length; i++) {
    if (i === anchorIdx && results[i]) continue;
    const comp = normalizedComponents[i];
    const role = comp.componentRole;
    const compQuery = `${comp.description || comp.label || ''} ${anchorFamily}`.trim();

    if (anchorBrandObj && anchorProduct) {
      // 1. Component already part of the anchor product (L-shape desk with its return, cluster with partitions…)
      if (anchorIncludesRole(anchorProduct, role)) {
        results[i] = {
          index: i,
          status: 'success',
          product: includedInAnchor(comp, role, `Included in ${anchorBrandObj.name} ${anchorProduct.model}`),
          confidenceScore: 90,
        };
        continue;
      }

      // 2. Same-Brand (Family-Coherent) Catalog Match
      const sameBrandHit = findBestInBrandForRole(anchorBrandObj, role, compQuery, anchorFamily, usedKeys);
      if (sameBrandHit) {
        usedKeys.add(`${anchorBrandObj.name.toLowerCase()}::${String(sameBrandHit.product.model || '').toLowerCase().trim()}`);
        results[i] = {
          index: i,
          status: 'success',
          product: formatProductResult(
            anchorBrandObj,
            sameBrandHit.product,
            role,
            anchorFamily && String(sameBrandHit.product.model || '').toLowerCase().includes(anchorFamily)
              ? 'workstation-same-family'
              : 'workstation-same-brand',
            resolveBrandLogo,
            proxyBaseUrl
          ),
          confidenceScore: 92,
        };
        continue;
      }

      // 3. Integrated desk hardware (cable tray, power box, modesty panel, monitor arm) without a separate SKU
      // stays strictly under the SAME manufacturer as an integrated system component
      // (never pulling an unrelated second manufacturer into the set!).
      if (INTEGRATED_HARDWARE_ROLES.has(role)) {
        results[i] = {
          index: i,
          status: 'success',
          product: includedInAnchor(comp, role, `Integrated ${anchorBrandObj.name} System Accessory`),
          confidenceScore: 88,
        };
        continue;
      }
    }

    results[i] = {
      index: i,
      status: 'no_match',
      componentRole: role,
      message: `No same-manufacturer catalog match found in ${anchorBrandObj?.name || 'selected brand'} for ${comp.label || role}`,
    };
  }

  return {
    status: 'success',
    anchorBrand: anchorBrandObj?.name || '',
    anchorFamily,
    components: results,
  };
}
