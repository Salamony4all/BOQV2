/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Furnishing Material Category & Brand Sequence Priority Strategy         │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Provides intelligent categorization and prioritized partner matching when
 * no explicit contract manufacturer is specified in the schedule.
 */

import { findSemanticMatches } from '../embeddingService.js';

export const VE_CATEGORY_CONFIG = {
    auditoriumAndTheater: {
        id: 'auditoriumAndTheater',
        label: 'Auditorium & Theater Seating',
        priorityBrands: ['TMA', 'LEADCOM', 'Figueras', 'Ferco Seating', 'Quinette Gallay', 'Ezcaray Seating', 'Ares Line', 'Cinearredo', 'Lamm', 'Destro'],
        keywords: [
            'theatre seats', 'theater seats', 'theatre', 'theater', 'auditorium', 'cinema',
            'tip-up', 'tip up', 'gravity', 'row numbering', 'wooden armrest', 'wooden panel',
            'acoustic seat', 'stadium seat', 'spectator seating'
        ]
    },
    classroomAndStackable: {
        id: 'classroomAndStackable',
        label: 'Classroom & Multi-Purpose Stackable Seating',
        priorityBrands: ['Sedus Stoll', 'Pedrali', 'Arper', 'NARBUTAS', 'Nurus', 'Andreu World', 'Sokoa', 'Magis', 'Plank', 'Actiu', 'B&T Design'],
        keywords: [
            'student chair', 'classroom chair', 'stackable chair', 'stackable', 'multi-purpose chair',
            'multipurpose chair', 'polypropylene chair', 'polypropylene seat', 'polished chrome metal frame',
            'floor glides', 'light weight and stackable', 'training chair', 'school chair', 'nesting chair'
        ]
    },
    foldingAndPortableSeating: {
        id: 'foldingAndPortableSeating',
        label: 'Folding & Portable Chairs / Stools',
        priorityBrands: ['Ottimo Furniture', 'Pedrali', 'Sokoa', 'Amara', 'B&T Design'],
        keywords: [
            'folding chair', 'foldable chair', 'round chair ( foldable)', 'round foldable chair',
            'folding stool', 'foldable stool', 'x-shape legs', 'x-shape', 'x shape', 'handle to carry',
            'portable chair', 'portable stool', 'folding seat', 'compact stool', 'telescopic stool',
            'fahmy furniture', 'kr furniture', 'al jassar'
        ]
    },
    desking: {
        id: 'desking',
        label: 'Desking & Tables',
        priorityBrands: ['Narbutas', 'Ottimo', 'Ismobil', 'LAS Mobili', 'M&W', 'Actiu', 'Fantoni', 'Nurus', 'FREZZA', 'Ofifran', 'MW Structure Test'],
        keywords: [
            'desk', 'workstation', 'table', 'meeting', 'conference', 'reception', 'counter',
            'executive desk', 'folding desk', 'bench table', 'managerial desk', 'l-shape', 'l shape',
            'work top', 'training table', 'flip top', 'height adjustable'
        ]
    },
    taskSeating: {
        id: 'taskSeating',
        label: 'Task & Office Seating',
        priorityBrands: ['Narbutas', 'Sedus', 'Sokoa', 'RIM', 'Interstuhl', 'Dauphin', 'SitLand', 'Nurus', 'Ottimo Furniture'],
        keywords: [
            'task chair', 'operator chair', 'executive chair', 'mesh chair', 'visitor chair',
            'cantilever', 'medium back', 'high back', 'low back', 'conference chair', 'swivel chair',
            'drafting chair', 'ergonomic chair', 'office chair', 'staff chair', 'racer'
        ]
    },
    softSeating: {
        id: 'softSeating',
        label: 'Soft & Lounge Seating',
        priorityBrands: ['B&T Design', 'Pedrali', 'Marelli', 'Tacchini', 'Arper', 'Sancal', 'Kastel', 'True Design', 'AMARA', 'Divani', 'FREZZA', 'NARBUTAS'],
        keywords: [
            'sofa', 'single seater', 'two seater', 'three seater', 'lounge', 'armchair',
            'ottoman', 'pouf', 'modular sofa', 'booth', 'acoustic sofa', 'couch',
            'breakout', 'reception sofa', 'roma', 'terminal'
        ]
    },
    outdoorSeating: {
        id: 'outdoorSeating',
        label: 'Outdoor & Landscape Seating',
        priorityBrands: ['Pedrali', 'B&T Design', 'Emu', 'Vondom', 'Kettal', 'Scab Design', 'Dedon', 'Slide Design', 'Escofet'],
        keywords: [
            'outdoor chair', 'outdoor table', 'patio chair', 'terrace seating', 'garden chair',
            'polyethylene outdoor', 'weather resistant', 'outdoor bench', 'exterior seating'
        ]
    },
    auditoriumAndTheatre: {
        id: 'auditoriumAndTheatre',
        label: 'Auditorium & Theatre Seating',
        priorityBrands: ['TMA', 'LEADCOM', 'Figueras', 'Ferco Seating', 'Quinette Gallay', 'Ezcaray Seating', 'Ares Line', 'Cinearredo', 'Lamm', 'Destro'],
        keywords: [
            'auditorium chair', 'auditorium seating', 'theatre chair', 'theatre seating', 'theater chair',
            'theater seating', 'cinema chair', 'cinema seating', 'tip-up seat', 'foldable auditorium',
            'lecture hall chair', 'acoustic auditorium', 'stadium seat', 'grandstand'
        ]
    },
    benchesAndPublicSeating: {
        id: 'benchesAndPublicSeating',
        label: 'Benches & Public Seating',
        priorityBrands: ['Sellex', 'Kastel', 'Arconas', 'Segis', 'Profim', 'Diemme', 'Pedrali', 'Vondom', 'Slide Design', 'Arper', 'B&T Design', 'NARBUTAS', 'Nurus', 'Sedus Stoll', 'AMARA', 'Divani', 'Ottimo Furniture'],
        keywords: [
            'bench', 'benches', 'modular bench', 'indoor bench', 'polyethylene bench',
            'public seating', 'beam seating', 'banquette', 'lobby bench', 'waiting bench'
        ]
    },
    customLandscapeAndTerrazzo: {
        id: 'customLandscapeAndTerrazzo',
        label: 'Custom Landscape, Terrazzo & Precast Seating',
        priorityBrands: ['ATTF (Automatic Terrazzo Tiles Factory)', 'Assarain Concrete Products', 'Escofet', 'Vondom', 'FitOut V2 (Custom Joinery)'],
        keywords: [
            'terrazzo', 'terazzo', 'precast concrete', 'cast concrete', 'concrete outdoor bench',
            'capsule shapes seating', 'capsule shape seat', 'monolithic bench', 'landscape seating',
            'outdoor terrazzo', 'arcade bench', 'street furniture', 'concrete frame & legs',
            'automatic terrazzo tiles factory', 'attf', 'assarain'
        ]
    },
    tables: {
        id: 'tables',
        label: 'Meeting & Coffee Tables',
        priorityBrands: ['B&T Design', 'Pedrali', 'Ottimo Furniture', 'NARBUTAS', 'Nurus', 'Arper', 'FREZZA', 'Sedus Stoll', 'LAS'],
        keywords: [
            'coffee table', 'side table', 'center table', 'meeting table', 'conference table', 'boardroom table', 'low table'
        ]
    },
    storage: {
        id: 'storage',
        label: 'Storage & Cabinetry',
        priorityBrands: ['NARBUTAS', 'Nurus', 'Ottimo Furniture', 'MW Structure Test', 'LAS', 'Ofifran', 'FREZZA'],
        keywords: [
            'high cabinet', 'low cabinet', 'credenza', 'pedestal', 'storage', 'filing',
            'bookcase', 'wardrobe', 'sideboard', 'cupboard', 'drawers', 'tambour'
        ]
    },
    heavyDutyAndMobileFiling: {
        id: 'heavyDutyAndMobileFiling',
        label: 'Steel & Mobile Filing Systems',
        priorityBrands: ['MW Structure Test', 'Ottimo Furniture', 'NARBUTAS', 'FREZZA', 'Nurus', 'LAS', 'Ofifran'],
        keywords: [
            'mobile filing', 'mechanical mobile filing', 'mobile shelving', 'compactor',
            'high density filing', 'high-density shelving', 'filing racks', 'filing rack',
            'archive shelving', 'steel shelving', 'steel filing', 'box file', 'arch file'
        ]
    },
    fitoutArchitectural: {
        id: 'fitoutArchitectural',
        label: 'Architectural Fitout',
        priorityBrands: ['FitOut V2'],
        keywords: [
            'carpet tile', 'carpet flooring', 'porcelain tile', 'ceramic tile', 'tile flooring',
            'vinyl flooring', 'marble flooring', 'gypsum ceiling', 'false ceiling', 'mineral fiber ceiling',
            'acoustic ceiling', 'partition wall', 'drywall partition', 'glass partition', 'wall cladding',
            'skirting', 'swing door', 'sliding door', 'pantry cabinet', 'pantry sink',
            'electric curtain', 'motorized curtain', 'window curtain', 'roller blind', 'blackout blind',
            'sunscreen blind', 'venetian blind', 'vertical blind', 'window blind', 'drapery'
        ]
    },
    commercialAccessories: {
        id: 'commercialAccessories',
        label: 'Commercial Contract Accessories',
        priorityBrands: ['B&T Design', 'Ottimo Furniture', 'NARBUTAS', 'MW Structure Test'],
        keywords: [
            'planter', 'acoustic pod', 'architectural screen', 'partition', 'lighting',
            'coat stand', 'waste bin', 'contract accessories', 'coffee table', 'side table',
            'center table', 'power rail', 'modesty panel', 'round center table'
        ]
    },
    cinemaSeating: {
        id: 'cinemaSeating',
        label: 'Cinema Seating',
        priorityBrands: ['Ferco Seating', 'LEADCOM', 'Camatic', 'Figueras', 'Skeie'],
        keywords: [
            'cinema chair', 'cinema seating', 'cinema seat', 'cinema seats',
            'movie theater', 'multiplex seating'
        ]
    },
    diningSeating: {
        id: 'diningSeating',
        label: 'Dining & Restaurant Seating',
        priorityBrands: ['Pedrali', 'Andreu World', 'TON', 'Billiani', 'Et al. (Metalmobil)', 'Very Wood', 'Gaber'],
        keywords: [
            'dining chair', 'dining seating', 'restaurant chair', 'restaurant seating',
            'bistro chair', 'bistro seating', 'cafe chair', 'banquette seating'
        ]
    },
    urbanOutdoor: {
        id: 'urbanOutdoor',
        label: 'Urban Outdoor & Public Realm',
        priorityBrands: ['mmcité', 'Escofet', 'Santa & Cole', 'Metalco', 'Benito Urban', 'Vondom', 'Pedrali'],
        keywords: [
            'urban furniture', 'park bench', 'street bench', 'urban bench',
            'bollard', 'litter bin', 'bus shelter', 'public realm'
        ]
    },
    genericAccessories: {
        id: 'genericAccessories',
        label: 'Generic & Retail Accessories',
        priorityBrands: ['Amazon', 'Noon', 'IKEA', 'Home Centre'],
        keywords: [
            'cable grommet', 'power strip', 'monitor arm', 'pencil drawer', 'extension cord',
            'craft cart', 'sewing', 'consumer accessory', 'generic cable', 'power box',
            'mobile cart', 'vendor cart', 'retail cart', 'awning', 'food cart', 'utility cart',
            'trolley', 'whiteboard', 'notice board', 'waste bin', 'trash can', 'desk lamp',
            'floor lamp', 'table lamp', 'clock', 'cushion', 'pillow'
        ]
    }
};

/**
 * Model names, origin tags, or generic specification words that must NEVER be treated as brand names.
 */
export const NON_BRAND_MODEL_WORDS = new Set([
    'roma', 'racer', 'terminal', 'app', 'wind', 'nova', 'eva', 'optima', 'choice', 'easy',
    'single seater', 'two seater', 'three seater', 'sofa', 'desk', 'chair', 'table',
    'l-shape', 'l-shaped', 'high cabinet', 'reception counter', 'workstation', 'credenza',
    'visitor chair', 'task chair', 'medium back', 'high back', 'executive', 'coffee table',
    'local', 'local-uae', 'local uae', 'far east', 'fareast', 'custom', 'unbranded', 'sample',
    'mdf', 'melamine', 'veneer', 'hpl', 'fabric', 'leather', 'mesh', 'black', 'white', 'grey'
]);

/**
 * Classifies a BOQ item into one of the furnishing material categories.
 */
export function classifyFurnishingCategory(description = '') {
    const raw = String(description || '');
    const firstLine = raw.split(/[\r\n|]+/)[0].trim().toLowerCase();
    // Strip trailing room/table metadata pipes (e.g., "| Item: Theater | TOTAL: ... | Supplier: ...") so room names don't hijack item type
    const bodyText = raw.replace(/\|\s*(?:item|room|location|area|total(?:\s*qty)?|qty|unit|supplier|model)\s*:[^|]*/gi, ' ').toLowerCase();
    const text = bodyText.trim() || raw.toLowerCase();

    // 0.0 High-Signal Headline / Primary Subject Overrides (prevents footnotes like "refer to desk" or "seat cushion" or "| Item: Theater" from hijacking)
    if (/\b(podium|lectern)\b/i.test(firstLine)) {
        return 'desking';
    }
    if (/\b(electric\s*curtain|motorized\s*curtain|curtain\s*(?:blackout|sunscreen|roller|track|lift)|roller\s*blinds?|blackout\s*blinds?|sunscreen\s*blinds?|venetian\s*blinds?|vertical\s*blinds?|window\s*blinds?|window\s*curtains?|drapery|sheer\s*curtain)\b/i.test(firstLine)
        || /\b(motorized\s*curtain|motorized\s*lift\s*curtain|blackout\s*roller\s*blind|sunscreen\s*roller\s*blind|roller\s*blind|steel\s*ball\s*chain.*bracket|aluminium\s*tube.*bottom\s*bar)\b/i.test(text)) {
        return 'fitoutArchitectural';
    }
    if (/\b(prayer\s*room\s*carpet|wall[\s-]?to[\s-]?wall\s*carpet|carpet\s*for\b|carpet\s*tile|carpet\s*flooring|broadloom\s*carpet)\b/i.test(firstLine)
        || /\b(prayer\s*room\s*carpet|carpet\s*with\s*underlay)\b/i.test(text)) {
        return 'fitoutArchitectural';
    }
    if (/\b(plastic\s*sheet|chair\s*mat|floor\s*protector)\b/i.test(firstLine)) {
        return 'genericAccessories';
    }
    if (/\b(mechanical\s*mobile\s*filing|mobile\s*filing\s*system|mobile\s*shelving|compactor\s*(?:filing|shelving)|high[\s-]?density\s*(?:filing|shelving)|filing\s*racks?)\b/i.test(text)) {
        return 'heavyDutyAndMobileFiling';
    }
    if (/\b(shoe\s*rack|coat\s*rack|storage\s*rack|shelving\s*rack|wardrobe|credenza|bookcase|filing\s*cabinet|high\s*cabinet|low\s*cabinet)\b/i.test(firstLine)
        || /^cabinet\b/i.test(firstLine)) {
        return 'storage';
    }
    if (/\b(outdoor\s+dining|outdoor\s+sofa|outdoor\s+chair|outdoor\s+furniture|terrace|patio)\b/i.test(firstLine) && !/\b(terrazzo|precast\s*concrete)\b/i.test(text)) {
        return 'outdoorSeating';
    }
    if (/\b(vip\s*chair|vvip\s*chair|executive\s*chair|task\s*chair|visitor\s*chair|meeting\s*chair|office\s*chair|swivel\s*chair|staff\s*chair)\b/i.test(firstLine)) {
        return 'taskSeating';
    }
    if (/\b(desk|workstation|meeting\s*(?:room\s*)?table|conference\s*table|boardroom\s*table|movable\s*meeting\s*table|folding\s*(?:meeting\s*|conference\s*|training\s*)?table|flip[\s-]?top\s*table|reception\s*(desk|counter))\b/i.test(firstLine) && !/\b(desk\s*lamp|desk\s*organizer|desk\s*pad|cable|grommet|power\s*box)\b/i.test(firstLine)) {
        return 'desking';
    }
    if (/\b(vip\s*lounge|lounge|waiting\s*area|courtyard)\b/i.test(firstLine) && /\b(furniture\s*set|sofa|seating|armchair)\b/i.test(firstLine)) {
        return 'softSeating';
    }
    if (/\b(cafeteria|canteen|dining\s*area)\b/i.test(firstLine) && !/\boutdoor\b/i.test(firstLine)) {
        return 'diningSeating';
    }

    // 0. Auditorium & Theater Seating (tip-up, gravity, row numbering, auditorium, theater seating)
    if (/\b(theatre\s*seats?|theater\s*seats?|auditorium\s*seat|auditorium\s*chair|cinema\s*seat|cinema\s*chair|tip-up|tip\s*up|gravity\s*set|row\s*numbering|stadium\s*seating)\b/i.test(text)
        || (/\b(theatre|theater|auditorium|cinema)\b/i.test(firstLine) && !/\b(podium|lectern|table|desk|screen|carpet)\b/i.test(firstLine))) {
        return 'auditoriumAndTheater';
    }

    // 0.1 Custom Landscape, Terrazzo & Precast Concrete Seating (ATTF, Assarain, 5000mm outdoor terrazzo bench, monolithic benches)
    if (/\b(terrazzo|terazzo|precast\s*concrete|cast\s*concrete|concrete\s*outdoor|concrete\s*bench|monolithic\s*bench|landscape\s*bench|capsule\s*shapes?\s*seating|capsule\s*shape\s*seat|outdoor\s*terrazzo|arcade\s*bench|street\s*furniture|automatic\s*terrazzo|attf|assarain)\b/i.test(text)) {
        return 'customLandscapeAndTerrazzo';
    }

    // 0.2 Architectural Fitout Elements (Flooring, Ceilings, Partitions, Doors, Fixed Pantry Joinery/Sinks)
    const isClearFurnitureOverride = /\b(mobile\s*(cart|divider|partition|whiteboard)|freestanding\s*partition|acoustic\s*pod|phone\s*booth|desk\s*screen|privacy\s*screen|conference\s*table|meeting\s*table|task\s*chair|office\s*chair|workstation|sofa|lounge\s*chair)\b/i.test(text);
    const isCabinetDoorFurniture = /\b(swing\s*door|sliding\s*door)\b/i.test(text) && /\b(cabinet|credenza|cupboard|bookcase|wardrobe|locker|tambour|pedestal|storage)\b/i.test(text);
    if (!isClearFurnitureOverride && !isCabinetDoorFurniture && (
        /\b(carpet\s*tile|carpet\s*flooring|tufted\s*nylon\s*carpet|prayer\s*room\s*carpet|carpet\s*with\s*underlay|porcelain\s*(floor\s*)?tile|ceramic\s*(floor\s*)?tile|tile\s*flooring|vinyl\s*flooring|marble\s*flooring|stone\s*flooring|floor\s*finish|self\s*leveling)\b/i.test(text)
        || /\b(gypsum\s*(board\s*)?(false\s*)?ceiling|plasterboard\s*ceiling|false\s*ceiling|mineral\s*fiber\s*(suspended\s*)?ceiling|acoustic\s*(grid\s*|tile\s*)?ceiling|ceiling\s*finish)\b/i.test(text)
        || /\b(partition\s*wall|drywall\s*partition|gypsum\s*partition|glass\s*partition|acoustic\s*partition|wall\s*cladding|skirting)\b/i.test(text)
        || /\b(single\s*leaf\s*swing\s*door|double\s*leaf\s*swing\s*door|swing\s*door|sliding\s*door|flush\s*timber\s*door|wooden\s*door|frameless\s*glazed\s*door|pocket\s*sliding\s*door)\b/i.test(text)
        || /\b(pantry\s*cabinet|built-in\s*pantry|pantry\s*counter|pantry\s*sink|undermount\s*sink|vanity\s*counter)\b/i.test(text)
    )) {
        return 'fitoutArchitectural';
    }

    // 1. Classroom & Multi-Purpose Stackable Chairs
    if (/\b(student\s*chair|classroom\s*chair|stackable\s*chair|multi\s*purpose\s*chair|multipurpose\s*chair|polypropylene\s*seat|floor\s*glides|light\s*weight\s*and\s*stackable|training\s*chair|school\s*chair)\b/i.test(text) && !/\b(sofa|couch|lounge|armchair|executive\s*desk|folding|foldable)\b/i.test(text)) {
        return 'classroomAndStackable';
    }

    // 1.1 Folding & Portable Chairs / Stools (X-shape legs, handle to carry, portable folding stools)
    if (/\b(foldable\s*chair|folding\s*chair|round\s*chair\s*\(\s*foldable\s*\)|round\s*foldable\s*chair|foldable\s*stool|folding\s*stool|x-shape\s*legs|x-shape|x\s*shape|handle\s*to\s*carry|portable\s*chair|portable\s*stool|collapsible\s*chair|collapsible\s*stool)\b/i.test(text)) {
        return 'foldingAndPortableSeating';
    }

    // 2. Generic / Retail Minor Accessories & Marketplace items (avoid matching "seat cushion" inside chairs/sofas)
    const isSeatingSpec = /\b(chair|sofa|armchair|lounge|stool|bench|couch|ottoman|pouf)\b/i.test(firstLine);
    const matchesLooseAccessory = /\b(mobile cart|vendor cart|retail cart|food cart|utility cart|trolley|craft|sewing|hobby|cable grommet|power strip|power box|monitor arm|pencil drawer|extension cord|whiteboard|notice board|waste bin|trash can|desk lamp|floor lamp|table lamp|clock|artwork|art\s*work|painting|sculpture|statue|framed\s*photo|photo\s*frame|portrait|amir\s*photo|emir\s*photo|wall\s*art|decorative\s*object|vase|mirror)\b/i.test(text)
        || (!isSeatingSpec && /\b(throw\s*pillow|decorative\s*cushion|pillow|cushion)\b/i.test(firstLine));
    if (matchesLooseAccessory || /https?:\/\/(www\.)?(amazon|noon|homedepot|gear4music|ikea)\./i.test(text)) {
        return 'genericAccessories';
    }

    // 3. Commercial Accessories & Tables (coffee tables, side tables, center tables, pods, planters)
    if (/\b(coffee table|side table|center table|round center table|planter|acoustic pod|lamp|coat stand|waste bin)\b/i.test(text)) {
        return 'commercialAccessories';
    }

    // 4. Desking & Workstations (desks, workstations, meeting/conference tables, reception desks)
    if (/\b(desk|workstation|l-shape|l shape|l-shaped|executive desk|managerial desk|office desk|meeting table|conference table|reception desk|reception counter|folding desk|bench desk|sit-stand|height adjustable)\b/i.test(text)) {
        return 'desking';
    }

    // 5. Storage & Cabinetry (high/low cabinets, credenzas, bookcases, wardrobes, shoe racks, standalone pedestals)
    if (/\b(high cabinet|low cabinet|cabinet|credenza|pedestal|filing|bookcase|wardrobe|sideboard|cupboard|drawers|tambour|storage unit|shoe\s*rack)\b/i.test(text)) {
        return 'storage';
    }

    // 6. Auditorium & Theatre Seating
    if (/\b(auditorium|theatre|theater|cinema|tip-up|lecture hall|stadium seat|grandstand)\b/i.test(text)) {
        return 'auditoriumAndTheatre';
    }

    // 7. Outdoor & Landscape Seating
    if (/\b(outdoor chair|outdoor table|patio|terrace seating|garden chair|polyethylene outdoor|weather resistant|arcade bench|exterior seating)\b/i.test(text) && !/\b(terrazzo|precast concrete)\b/i.test(text)) {
        return 'outdoorSeating';
    }

    // 8. Soft Seating & Lounge (sofas, 2/3 seaters, armchairs, lounge chairs, ottomans, poufs, breakout)
    if (/\b(sofa|three seater|two seater|single seater|lounge chair|armchair|ottoman|pouf|couch|modular sofa|booth|acoustic sofa|roma|terminal|beam seating)\b/i.test(text) && !/\b(task|mesh|operator|executive|visitor|folding|stacking)\b/i.test(text)) {
        return 'softSeating';
    }

    // 9. Task Seating & Office Chairs (task chairs, mesh chairs, visitor chairs, executive chairs, stools, folding chairs)
    if (/\b(task chair|mesh chair|operator chair|executive chair|visitor chair|cantilever|medium back|high back|low back|swivel chair|office chair|racer|wind|drafting chair|staff chair|foldable chair|folding chair|stacking chair)\b/i.test(text)) {
        return 'taskSeating';
    }

    // Default fallbacks
    if (text.includes('chair') || text.includes('stool') || text.includes('seat')) return 'taskSeating';
    if (text.includes('table') || text.includes('desk')) return 'desking';
    return 'desking';
}

/**
 * Known established contract manufacturer brands (both local catalog and international specifications).
 */
export const KNOWN_CONTRACT_BRANDS = new Set([
    'narbutas', 'nurus', 'ottimo', 'ottimo furniture', 'b&t design', 'bt design', 'b&t', 'pedrali',
    'sedus', 'sedus stoll', 'sokoa', 'las', 'ofifran', 'rim', 'm&w', 'mw structure test', 'mw',
    'ismobil', 'arper', 'frezza', 'teknion', 'teknion me', 'dauphin', 'dauphin products, collections and more',
    'vitra', 'herman miller', 'steelcase', 'haworth', 'knoll', 'amara', 'andreu world', 'true design',
    'freifrau', 'dedon', 'emu', 'magis', 'figueras', 'tma', 'leadcom', 'ferco', 'wiesner hager', 'wiesner-hager', 'please wait to be seated',
    'encore seating', 'ton', 'milimetry', 'ciment studio', 'sui generis', 'infabbrica', 'studiodesk',
    'kirkhouse', 'planurban', "bree's new world", 'brees new world', 'scandinavian designs', 'west elm',
    'meeden', 'sprout kids', 'sprout-kids', 'workspace.ae', 'workspace', 'modul', 'moonako',
    'interstuhl', 'wilkhahn', 'boss design', 'bene', 'walter knoll', 'cassina', 'poltrona frau',
    'viccarbe', 'moroso', 'hay', 'muuto', 'kinnarps', 'flokk', 'framery', 'buzzispace', 'buzzi space',
    'amazon', 'ikea', 'home centre', 'homecenter'
]);

/**
 * Brand aliases mapping dictionary
 */
export const BRAND_ALIASES = {
    'm&w': 'MW Structure Test',
    'mw': 'MW Structure Test',
    'mw structure': 'MW Structure Test',
    'mw structure test': 'MW Structure Test',
    'ottimo': 'Ottimo Furniture',
    'ottimo furniture': 'Ottimo Furniture',
    'sedus': 'Sedus Stoll',
    'sedus stoll': 'Sedus Stoll',
    'narbutas': 'NARBUTAS',
    'b&t': 'B&T Design',
    'bt': 'B&T Design',
    'bt design': 'B&T Design',
    'b&t design': 'B&T Design',
    'true design': 'True Design',
    'tma': 'TMA',
    'leadcom': 'Leadcom',
    'ikea': 'IKEA',
    'home centre': 'Home Centre',
    'homecenter': 'Home Centre',
    'dauphin': 'Dauphin products, collections and more',
    'dauphin products': 'Dauphin products, collections and more',
    'dauphin products, collections and more': 'Dauphin products, collections and more',
    'workspace': 'Workspace.ae',
    'workspace.ae': 'Workspace.ae',
    'timeout space': 'TON',
    'timeoutspace': 'TON',
    'moonako arabesque collection': 'Moonako',
    'moodie': 'Moonako'
};

/**
 * Checks if a string is a recognized genuine contract manufacturer brand name.
 */
export function isGenuineContractBrand(brandName, allBrands = []) {
    if (!brandName || typeof brandName !== 'string') return false;
    const nameLower = brandName.toLowerCase().trim();

    // Reject known model names, origin tags & generic terms
    if (NON_BRAND_MODEL_WORDS.has(nameLower)) return false;
    if (/^(supplier|dealer|generic|unknown|amazon|noon|ikea|home depot|attf|assarain|acp|kr furniture|fahmy|local|far east)/i.test(nameLower)) return false;

    // Check alias mapping
    if (BRAND_ALIASES[nameLower]) return true;

    // Check if brand exists in allBrands catalog
    const hit = allBrands.find(b => b && b.name && (b.name.toLowerCase().trim() === nameLower || BRAND_ALIASES[b.name.toLowerCase().trim()] === BRAND_ALIASES[nameLower]));
    if (hit) return true;

    if (KNOWN_CONTRACT_BRANDS.has(nameLower)) return true;

    // If it's a valid non-empty manufacturer/maker name (>= 3 chars) not in generic blacklist, accept as genuine
    if (nameLower.length >= 3 && !/^(item|spec|table|chair|sofa|desk|cabinet|booth|cart|unit|finish|code|type|sample|custom)/i.test(nameLower)) {
        return true;
    }

    return false;
}

function normalizeBrandRoot(raw = '') {
    return String(raw || '')
        .toLowerCase()
        // Strip origin/location tags commonly appended in BOQ schedules (e.g. "Brand - UAE", "Brand (Italy)")
        .replace(/\s*[\(\[]\s*[^)\]]+\s*[\)\]]\s*$/g, '')
        .replace(/\s*[-–|\/]\s*(uae|u\.a\.e\.?|italy|it|uk|usa|us|germany|de|france|fr|spain|es|turkey|tr|china|cn|dubai|abu dhabi|oman|saudi|ksa|qatar|europe|eu|local)\b.*$/i, '')
        // Strip domain TLDs so "workspace.ae" and "workspace" share a root token
        .replace(/\.(co\.uk|com|ae|it|de|fr|nl|dk|es|eu|net|org|space|design)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function scoreCatalogCandidate(b, { target, targetRoot, canonicalTarget, canonicalRoot, modelHintNorm }) {
    const bLower = String(b?.name || '').toLowerCase().trim();
    const bRoot = normalizeBrandRoot(b?.name);
    const bCanonical = (BRAND_ALIASES[bLower] || BRAND_ALIASES[bRoot] || bLower).toLowerCase();
    const prods = Array.isArray(b?.products) ? b.products : [];

    let score = 0;
    if (bLower === target) score += 100;
    else if (bLower === canonicalTarget || bCanonical === canonicalTarget) score += 90;
    else if (targetRoot.length >= 3 && (bRoot === targetRoot || bRoot === canonicalRoot)) score += 70;
    else if (bLower.includes(target) || target.includes(bLower) || bLower.includes(canonicalTarget) || canonicalTarget.includes(bLower)) score += 40;
    else if (targetRoot.length >= 4 && bRoot.length >= 4 && (bRoot.includes(targetRoot) || targetRoot.includes(bRoot))) score += 30;
    else return -1;

    if (modelHintNorm && prods.some(p => {
        const pm = String(p?.model || '').toLowerCase().trim();
        return pm && (pm === modelHintNorm || pm.includes(modelHintNorm) || modelHintNorm.includes(pm));
    })) {
        score += 500;
    }

    const imagedVerified = prods.filter(p => p?.imageUrl && p?.verified !== false).length;
    const priced = prods.filter(p => parseFloat(p?.price) > 0).length;
    score += Math.min(imagedVerified * 2 + priced * 2 + Math.min(prods.length, 50) * 0.2, 80);
    return score;
}

/**
 * Resolves a brand from a catalog by exact, alias, root-normalized, or fuzzy name,
 * preferring verified/model-matching catalogs when duplicate entries share a root.
 */
export function findBrandInCatalog(brandName, allBrands = [], modelHint = '') {
    if (!brandName || !allBrands || allBrands.length === 0) return null;
    const target = brandName.toLowerCase().trim();
    const targetRoot = normalizeBrandRoot(brandName);
    const canonicalTarget = (BRAND_ALIASES[target] || BRAND_ALIASES[targetRoot] || target).toLowerCase();
    const canonicalRoot = normalizeBrandRoot(canonicalTarget);
    const modelHintNorm = String(modelHint || '').toLowerCase().trim();

    let bestBrand = null;
    let bestScore = -1;
    for (const b of allBrands) {
        if (!b || !b.name) continue;
        const sc = scoreCatalogCandidate(b, { target, targetRoot, canonicalTarget, canonicalRoot, modelHintNorm });
        if (sc > bestScore) {
            bestScore = sc;
            bestBrand = b;
        }
    }
    return bestBrand;
}
