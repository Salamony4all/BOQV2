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
            'bookcase', 'wardrobe', 'sideboard', 'cupboard', 'drawers', 'tambour', 'swing door', 'sliding door'
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
    const text = String(description || '').toLowerCase();

    // 0. Auditorium & Theater Seating (tip-up, gravity, row numbering, auditorium, theater)
    if (/\b(theatre\s*seats|theater\s*seats|theatre|theater|auditorium|cinema|tip-up|tip\s*up|gravity\s*set|row\s*numbering|stadium\s*seating)\b/i.test(text)) {
        return 'auditoriumAndTheater';
    }

    // 0.1 Custom Landscape, Terrazzo & Precast Concrete Seating (ATTF, Assarain, 5000mm outdoor terrazzo bench, monolithic benches)
    if (/\b(terrazzo|terazzo|precast\s*concrete|cast\s*concrete|concrete\s*outdoor|concrete\s*bench|monolithic\s*bench|landscape\s*bench|capsule\s*shapes?\s*seating|capsule\s*shape\s*seat|outdoor\s*terrazzo|arcade\s*bench|street\s*furniture|automatic\s*terrazzo|attf|assarain)\b/i.test(text)) {
        return 'customLandscapeAndTerrazzo';
    }

    // 1. Classroom & Multi-Purpose Stackable Chairs
    if (/\b(student\s*chair|classroom\s*chair|stackable\s*chair|multi\s*purpose\s*chair|multipurpose\s*chair|polypropylene\s*seat|floor\s*glides|light\s*weight\s*and\s*stackable|training\s*chair|school\s*chair)\b/i.test(text) && !/\b(sofa|couch|lounge|armchair|executive\s*desk|folding|foldable)\b/i.test(text)) {
        return 'classroomAndStackable';
    }

    // 1.1 Folding & Portable Chairs / Stools (X-shape legs, handle to carry, portable folding stools)
    if (/\b(foldable\s*chair|folding\s*chair|round\s*chair\s*\(\s*foldable\s*\)|round\s*foldable\s*chair|foldable\s*stool|folding\s*stool|x-shape\s*legs|x-shape|x\s*shape|handle\s*to\s*carry|portable\s*chair|portable\s*stool|collapsible\s*chair|collapsible\s*stool)\b/i.test(text)) {
        return 'foldingAndPortableSeating';
    }

    // 2. Generic / Retail Minor Accessories & Marketplace items (mobile vendor carts, monitor arms, power strips, accessories)
    if (/\b(mobile cart|vendor cart|retail cart|food cart|utility cart|trolley|craft|sewing|hobby|cable grommet|power strip|power box|monitor arm|pencil drawer|extension cord|whiteboard|notice board|waste bin|trash can|desk lamp|floor lamp|table lamp|pillow|cushion|clock)\b/i.test(text) || /https?:\/\/(www\.)?(amazon|noon|homedepot|gear4music|ikea)\./i.test(text)) {
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

    // 5. Storage & Cabinetry (high/low cabinets, credenzas, bookcases, wardrobes, standalone pedestals)
    if (/\b(high cabinet|low cabinet|cabinet|credenza|pedestal|filing|bookcase|wardrobe|sideboard|cupboard|drawers|tambour|storage unit)\b/i.test(text)) {
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

/**
 * Resolves a brand from a catalog by exact, alias, or fuzzy name.
 */
export function findBrandInCatalog(brandName, allBrands = []) {
    if (!brandName || !allBrands || allBrands.length === 0) return null;
    const target = brandName.toLowerCase().trim();
    const canonicalTarget = (BRAND_ALIASES[target] || target).toLowerCase();

    // 1. Direct exact or canonical alias match
    let match = allBrands.find(b => {
        if (!b || !b.name) return false;
        const bLower = b.name.toLowerCase().trim();
        const bCanonical = (BRAND_ALIASES[bLower] || bLower).toLowerCase();
        return bLower === target || bCanonical === canonicalTarget || bLower === canonicalTarget;
    });
    if (match) return match;

    // 2. Substring match
    return allBrands.find(b => {
        if (!b || !b.name) return false;
        const bLower = b.name.toLowerCase().trim();
        return bLower.includes(target) || target.includes(bLower) || bLower.includes(canonicalTarget) || canonicalTarget.includes(bLower);
    });
}
