/**
 * Commercial Brand Specialization & Domain Taxonomy
 * Generated from Deep Database Product Audit (20 Brand Catalogs, 5,232+ SKUs)
 */

export const BRAND_SPECIALTIES = {
  // Auditorium & Theater Seating (TMA = LEADCOM highest priority)
  auditoriumAndTheater: [
    'tma',
    'leadcom',
    'figueras',
    'ares line',
    'cinearredo',
    'lamm',
    'ferco seating',
    'quinette gallay',
    'ezcaray seating',
    'destro',
    'jezet seating'
  ],

  // Cinema Seating (Ferco-led)
  cinemaSeating: [
    'ferco seating',
    'leadcom',
    'camatic',
    'figueras',
    'skeie',
    'quinette gallay'
  ],

  // Dining & Restaurant Seating
  diningSeating: [
    'pedrali',
    'andreu world',
    'ton',
    'billiani',
    'et al.',
    'et al. (metalmobil)',
    'very wood',
    'gaber',
    'magis',
    'plank',
    'sokoa'
  ],

  // Urban Outdoor & Public Realm
  urbanOutdoor: [
    'mmcité',
    'mmcite',
    'escofet',
    'santa & cole',
    'santa and cole',
    'metalco',
    'benito urban',
    'vondom',
    'pedrali',
    'attf (automatic terrazzo tiles factory)',
    'assarain concrete products'
  ],

  // Classroom & Multi-Purpose Stackable Seating
  classroomAndStackable: [
    'sedus stoll',
    'pedrali',
    'arper',
    'narbutas',
    'nurus',
    'andreu world',
    'sokoa',
    'magis',
    'plank',
    'actiu',
    'b&t design'
  ],

  // Folding & Portable Seating (Stools, X-frame folding chairs)
  foldingAndPortableSeating: [
    'ottimo',
    'ottimo furniture',
    'pedrali',
    'sokoa',
    'amara',
    'sedus stoll',
    'amazon'
  ],

  // Benches & Modular Public/Lounge Seating
  benchesAndPublicSeating: [
    'vondom',
    'pedrali',
    'slide design',
    'magis',
    'plank',
    'arper',
    'b&t',
    'b&t design',
    'narbutas',
    'nurus',
    'sedus',
    'sedus stoll',
    'amara',
    'divani',
    'ottimo',
    'ottimo furniture'
  ],

  // Soft Furniture & Soft Seating / Lounge / Sofas (586 catalog products in DB)
  softSeating: [
    'b&t',
    'b&t design',
    'pedrali',
    'arper',
    'b t_design',
    'divani',
    'poliform',
    'amara',
    'frezza',
    'ottimo',
    'ottimo furniture',
    'narbutas',
    'nurus',
    'teknion me',
    'rim',
    'las'
  ],

  // Task Seating & Office Chairs (Narbutas > Sedus > Sokoa > RIM-led)
  taskSeating: [
    'narbutas',
    'sedus',
    'sedus stoll',
    'sokoa',
    'rim',
    'dauphin',
    'dauphin products__collections_and_more',
    'mw',
    'mw structure_test',
    'ottimo',
    'ottimo furniture',
    'arper',
    'frezza',
    'narbutas',
    'nurus',
    'teknion me'
  ],

  // Desking & Workstations (Narbutas > Ottimo > Ismobil-led)
  desking: [
    'narbutas',
    'ottimo',
    'ottimo furniture',
    'ismobil',
    'las',
    'mw',
    'mw structure_test',
    'nurus',
    'frezza',
    'teknion',
    'teknion me',
    'sedus',
    'sedus stoll',
    'ofifran'
  ],

  // Meeting Tables & Coffee Tables
  tables: [
    'b&t',
    'b&t design',
    'pedrali',
    'ottimo',
    'ottimo furniture',
    'narbutas',
    'nurus',
    'arper',
    'frezza',
    'sedus stoll',
    'ofifran',
    'las'
  ],

  // Storage & Cabinetry (260 catalog products in DB)
  storage: [
    'narbutas',
    'nurus',
    'frezza',
    'ottimo',
    'ottimo furniture',
    'mw',
    'mw structure_test',
    'teknion',
    'teknion me',
    'ofifran',
    'sedus stoll',
    'las'
  ],

  // Metal Furniture, Fitout & Partitions (250 catalog products in DB)
  metalAndFitout: [
    'hadid',
    'fitout v2',
    'fitout',
    'mw structure_test',
    'frezza',
    'teknion'
  ]
};

/**
 * Strict Domain Exclusion Rules
 * Prevents inappropriate cross-category matching (e.g. Desks to Task Seating manufacturers)
 */
export const DOMAIN_EXCLUSIONS = {
  // If an item is Auditorium/Theater seating, these office/retail brands MUST NOT be matched
  auditoriumAndTheater: ['hadid', 'fitout v2', 'ismobil', 'divani', 'amara', 'sokoa', 'rim', 'ofifran', 'mw structure test'],

  // If an item is a Folding / Portable Chair or Stool, exclude executive / swivel / mesh / heavy lounge furniture
  foldingAndPortableSeating: ['hadid', 'fitout v2', 'ismobil', 'divani', 'ofifran', 'rim', 'dauphin', 'mw structure test', 'las'],

  // If an item is a Classroom / Stackable Chair, exclude pure desking/storage/upholstered sofas
  classroomAndStackable: ['hadid', 'fitout v2', 'ismobil', 'divani', 'amara'],

  // Custom Landscape, Terrazzo & Precast Seating
  customLandscapeAndTerrazzo: [
    'attf',
    'automatic terrazzo tiles factory',
    'assarain',
    'assarain concrete products',
    'escofet',
    'vondom',
    'fitout v2',
    'ciment studio',
    'sui generis'
  ],

  // If an item is a Custom Terrazzo / Precast Landscape bench, indoor office seating brands MUST NOT be matched
  customLandscapeAndTerrazzo: ['sedus', 'sedus stoll', 'narbutas', 'sokoa', 'rim', 'ofifran', 'frezza', 'las', 'nurus'],

  // If an item is a Bench / Public Seating, these pure desking/storage/retail brands MUST NOT be matched
  benchesAndPublicSeating: ['hadid', 'fitout v2', 'ismobil', 'sokoa', 'rim', 'ofifran'],

  // If an item is a Desk/Workstation, these brands MUST NOT be matched
  desking: ['rim', 'dauphin', 'dauphin products__collections_and_more', 'sokoa', 'amara', 'divani'],

  // If an item is a Task Chair, these brands MUST NOT be matched
  taskSeating: ['hadid', 'fitout v2', 'ismobil', 'divani', 'amara'],

  // If an item is a Sofa / Soft Seating, these brands MUST NOT be matched
  softSeating: ['hadid', 'fitout v2', 'ismobil', 'dauphin', 'dauphin products, collections and more'],

  // If an item is a Storage / Cabinet, these pure seating brands MUST NOT be matched
  storage: ['sokoa', 'rim', 'dauphin', 'dauphin products, collections and more', 'amara', 'divani']
};

/**
 * Detect the furniture archetype of a specification
 */
export function detectSpecArchetype(description, categoryHint = '') {
  const text = `${description} ${categoryHint}`.toLowerCase();

  // 0. Retail / generic accessories sold on consumer marketplaces (Amazon, Noon,
  // IKEA). A retailer product URL means a retail item: keep the exact listing
  // as primary and source fast-delivery GCC equivalents — never contract chairs.
  const isRetailMarketplace = /https?:\/\/(www\.)?(amazon|noon|ikea|homecentre|home centre)\.[a-z.]+\//i.test(text);
  if (isRetailMarketplace) {
    return 'genericAccessories';
  }

  // 0. Cinema Seating (strict chair/seating keywords — checked before auditorium
  // so shared words like "tip-up" don't drag cinema rows into theater)
  const isCinemaSeating = /\b(cinema\s*chairs?|cinema\s*seating|cinema\s*seats?|movie\s*theater|multiplex\s*seating)\b/i.test(text);
  if (isCinemaSeating) {
    return 'cinemaSeating';
  }

  // 0. Auditorium & Theater Seating (Highest Specificity)
  const isAuditorium = /\b(theatre\s*seats|theater\s*seats|theatre|theater|auditorium|cinema|tip-up|tip\s*up|gravity\s*set|row\s*numbering|stadium\s*seating)\b/i.test(text);
  if (isAuditorium) {
    return 'auditoriumAndTheater';
  }

  // 0.1 Custom Landscape, Terrazzo & Precast Concrete Seating (ATTF, Assarain, 5000mm outdoor terrazzo bench, monolithic benches)
  const isTerrazzoOrPrecast = /\b(terrazzo|terazzo|precast\s*concrete|cast\s*concrete|concrete\s*outdoor|concrete\s*bench|monolithic\s*bench|landscape\s*bench|capsule\s*shapes?\s*seating|capsule\s*shape\s*seat|outdoor\s*terrazzo|arcade\s*bench|street\s*furniture|automatic\s*terrazzo|attf|assarain)\b/i.test(text);
  if (isTerrazzoOrPrecast) {
    return 'customLandscapeAndTerrazzo';
  }

  // 0.2 Folding & Portable Seating (Folding stools, X-shape legs, carry handles, collapsible chairs)
  const isFolding = /\b(foldable\s*chair|folding\s*chair|round\s*chair\s*\(\s*foldable\s*\)|round\s*foldable\s*chair|foldable\s*stool|folding\s*stool|x-shape\s*legs|x-shape|x\s*shape|handle\s*to\s*carry|portable\s*chair|portable\s*stool|collapsible\s*chair|collapsible\s*stool)\b/i.test(text);
  if (isFolding) {
    return 'foldingAndPortableSeating';
  }

  // 0.4 Dining & Restaurant Seating (product-type + chair/seating required, so
  // "bistro table" and "dining table" still fall through to tables)
  const isDiningSeating = /\b(dining\s*chairs?|dining\s*seating|restaurant\s*chairs?|restaurant\s*seating|bistro\s*(chair|seating)|cafe\s*chair|caf[eé]\s*chair|brasserie\s*chair|banquette\s*seating)\b/i.test(text);
  if (isDiningSeating) {
    return 'diningSeating';
  }

  // 0.5 Urban Outdoor & Public Realm (street/park furniture — not terrazzo,
  // which is claimed above; generic "bench" still routes to public seating)
  const isUrbanOutdoor = /\b(urban\s*furniture|park\s*bench|street\s*bench|urban\s*bench|bollards?|litter\s*bins?|bus\s*shelter|public\s*realm)\b/i.test(text);
  if (isUrbanOutdoor) {
    return 'urbanOutdoor';
  }

  // 1. Classroom & Multi-Purpose Stackable Seating
  const isClassroomStackable = /\b(student\s*chair|classroom\s*chair|stackable\s*chair|stackable|multi\s*purpose\s*chair|multipurpose\s*chair|polypropylene\s*seat|floor\s*glides|light\s*weight\s*and\s*stackable|training\s*chair|school\s*chair)\b/i.test(text);
  if (isClassroomStackable && !/\b(sofa|couch|lounge|armchair|executive\s*desk)\b/i.test(text)) {
    return 'classroomAndStackable';
  }

  // 2. Bench & Public / Modular Seating (Disambiguated from desk benching)
  const isBenchKeyword = text.includes('bench') || text.includes('benches') || text.includes('banquette') || text.includes('beam seating');
  const isDeskContext = /\b(workstation|desk|desks|face\s*to\s*face|screen|cable\s*tray|wire\s*box|power\s*socket|pc|monitor)\b/i.test(text);
  const isSeatingContext = /\b(modular|indoor|outdoor|polyethylene|seating|seat|lounge|public|lobby|waiting|cushion|upholstered|pouf|arper|pedrali|vondom|slide)\b/i.test(text);

  if (isBenchKeyword && (!isDeskContext || isSeatingContext)) {
    return 'benchesAndPublicSeating';
  }

  // 3. Storage & Cabinetry
  const isStorage = text.includes('cabinet') ||
    text.includes('credenza') ||
    text.includes('bookcase') ||
    text.includes('shelving') ||
    text.includes('shelf') ||
    text.includes('filing') ||
    text.includes('pedestal') ||
    text.includes('wardrobe') ||
    text.includes('sideboard') ||
    text.includes('cupboard') ||
    text.includes('drawers');

  // 4. Soft Seating / Lounge / Sofas
  const isSoft = text.includes('sofa') ||
    text.includes('couch') ||
    text.includes('lounge') ||
    text.includes('armchair') ||
    text.includes('pouf') ||
    text.includes('ottoman') ||
    text.includes('soft seating') ||
    text.includes('waiting area') ||
    text.includes('reception sofa') ||
    text.includes('1 seater') ||
    text.includes('2 seater') ||
    text.includes('3 seater') ||
    text.includes('single seater') ||
    text.includes('two seater') ||
    text.includes('three seater');

  // 5. Task Seating / Office Chairs
  const isTaskChair = text.includes('chair') ||
    text.includes('seating') ||
    text.includes('office seating') ||
    text.includes('mesh') ||
    text.includes('task chair') ||
    text.includes('visitor chair') ||
    text.includes('executive chair') ||
    text.includes('cantilever') ||
    text.includes('swivel') ||
    text.includes('operator chair') ||
    text.includes('ergonomic chair') ||
    text.includes('armrest') ||
    text.includes('castors') ||
    text.includes('stool');

  // 6. Tables & Coffee Tables (incl. work/folding/training tables — "swiveled
  // casters" must not drag these into taskSeating; tables win on priority)
  const isTable = text.includes('coffee table') ||
    text.includes('side table') ||
    text.includes('center table') ||
    text.includes('low table') ||
    text.includes('meeting table') ||
    text.includes('conference table') ||
    text.includes('boardroom table') ||
    text.includes('dining table') ||
    text.includes('working table') ||
    text.includes('work table') ||
    text.includes('folding table') ||
    text.includes('foldable table') ||
    text.includes('training table') ||
    text.includes('flip-top') ||
    text.includes('flip top') ||
    text.includes('tilt-top') ||
    text.includes('tilt top') ||
    text.includes('height-adjustable table') ||
    text.includes('height adjustable table') ||
    text.includes('sit-stand');

  // 7. Desking / Workstations
  const isDesk = text.includes('desk') ||
    text.includes('desks') ||
    text.includes('workstation') ||
    text.includes('l-shape') ||
    text.includes('l shape') ||
    text.includes('executive desk') ||
    (isBenchKeyword && isDeskContext) ||
    text.includes('wire box') ||
    text.includes('modesty panel');

  // 8. Metal / Fitout / Partitions
  const isMetalFitout = text.includes('metal') ||
    text.includes('steel') ||
    text.includes('iron') ||
    text.includes('partition') ||
    text.includes('cladding') ||
    text.includes('locker') ||
    text.includes('fitout') ||
    text.includes('hadid');

  // Specificity Priority:
  if (isDesk) return 'desking';
  if (isStorage && !text.includes('chair') && !text.includes('table top')) return 'storage';
  if (isTable) return 'tables';
  if (isSoft && !text.includes('desk') && !text.includes('table top')) return 'softSeating';
  if (isTaskChair && !text.includes('desk') && !text.includes('table top')) return 'taskSeating';
  if (isMetalFitout) return 'metalAndFitout';
  if (isTaskChair) return 'taskSeating';
  if (isSoft) return 'softSeating';
  if (isStorage) return 'storage';

  return null;
}

/**
 * Get affinity score modifier between a spec description and a brand
 */
export function getBrandAffinityScore(description, brandName, categoryHint = '') {
  if (!brandName) return 0;
  const normalizedBrand = String(brandName).toLowerCase().trim();
  const archetype = detectSpecArchetype(description, categoryHint);

  if (!archetype) return 0;

  // Check strict exclusions
  const excluded = DOMAIN_EXCLUSIONS[archetype] || [];
  if (excluded.some(b => normalizedBrand === b || normalizedBrand.includes(b))) {
    return -0.90; // Strict penalty completely blocks brand
  }

  // Check primary specialized brands
  const primaryBrands = BRAND_SPECIALTIES[archetype] || [];
  const rankIndex = primaryBrands.findIndex(b => normalizedBrand === b || normalizedBrand.includes(b) || b.includes(normalizedBrand));

  if (rankIndex !== -1) {
    const positionBoost = Math.max(0.20, 0.55 - (rankIndex * 0.025));
    return positionBoost;
  }

  return 0;
}
