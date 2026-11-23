/**
 * Contract Furniture Brand Logo Registry & Taxonomy Normalization Utilities
 */

import { isBedSpecHeadline } from './specArchetypes.js';

export const CONTRACT_BRAND_LOGOS = {
    'narbutas': 'https://media.architonic.com/m-on/10001981/logo/narbutas_logo_c1db0dc7.jpeg?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'b&t design': 'https://media.architonic.com/m-on/3103498/logo/b-t-design_logo_b083bc1d.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'bt design': 'https://media.architonic.com/m-on/3103498/logo/b-t-design_logo_b083bc1d.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'b&t': 'https://media.architonic.com/m-on/3103498/logo/b-t-design_logo_b083bc1d.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'ottimo': 'https://ottimouae.com/wp-content/uploads/2022/08/ottimo-logo-retina.png',
    'ottimo furniture': 'https://ottimouae.com/wp-content/uploads/2022/08/ottimo-logo-retina.png',
    'nurus': 'https://media.architonic.com/m-on/3100100/logo/nurus_logo_779d6867.jpeg?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'sedus': 'https://media.architonic.com/m-on/3100165/logo/sedus-stoll_logo_2a03183e.png',
    'sedus stoll': 'https://media.architonic.com/m-on/3100165/logo/sedus-stoll_logo_2a03183e.png',
    'sokoa': 'https://media.architonic.com/m-on/3103368/logo/sokoa_logo_03b4fd9d.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'las': 'https://www.las.it/wp-content/themes/las/assets/images/logo-menu.svg',
    'las mobili': 'https://www.las.it/wp-content/themes/las/assets/images/logo-menu.svg',
    'ofifran': 'https://media.architonic.com/m-on/3104433/logo/ofifran_logo_732b4c6b.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'rim': 'https://media.architonic.com/m-on/3105033/logo/rim_logo_98da7a6b.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'pedrali': 'https://media.architonic.com/m-on/3100115/logo/pedrali_logo_f3da.jpg',
    'arper': 'https://media.architonic.com/m-on/3100610/logo/arper_logo_2bbd6b5f.jpeg?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'frezza': 'https://media.architonic.com/m-on/3101675/logo/frezza_logo_d9f68f35.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'm&w': 'https://www.mwworkstation.com/Public/www/images/logo.png',
    'mw structure test': 'https://www.mwworkstation.com/Public/www/images/logo.png',
    'dauphin': 'https://media.architonic.com/m-on/3102096/logo/dauphin_logo_074f8022.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'dauphin products, collections and more': 'https://media.architonic.com/m-on/3102096/logo/dauphin_logo_074f8022.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'teknion': 'https://www.teknion.com/docs/default-source/sitetemplatefiles/teknion-logo.svg',
    'teknion me': 'https://www.teknion.com/docs/default-source/sitetemplatefiles/teknion-logo.svg',
    'freifrau': 'https://media.architonic.com/m-on/3104694/logo/freifrau_logo_5cf3.jpg',
    'dedon': 'https://media.architonic.com/m-on/3100020/logo/dedon_logo_691e.jpg',
    'emu': 'https://media.architonic.com/m-on/3100062/logo/emu_logo_01dc.jpg',
    'figueras': 'https://media.architonic.com/m-on/3100234/logo/figueras_logo_fba6.jpg',
    'ton': 'https://media.architonic.com/m-on/3100171/logo/ton_logo_1a8e.jpg',
    'andreu world': 'https://media.architonic.com/m-on/3100015/logo/andreu-world_logo_3979.jpg',
    'magis': 'https://media.architonic.com/m-on/3100013/logo/magis_logo_f158.jpg',
    'wiesner hager': 'https://media.architonic.com/m-on/3100185/logo/wiesner-hager_logo_e11d.jpg',
    'wiesner-hager': 'https://media.architonic.com/m-on/3100185/logo/wiesner-hager_logo_e11d.jpg',
    'interstuhl': 'https://media.architonic.com/m-on/3100016/logo/interstuhl_logo_70da.jpg',
    'wilkhahn': 'https://media.architonic.com/m-on/3100017/logo/wilkhahn_logo_8a43.jpg',
    'boss design': 'https://media.architonic.com/m-on/3101569/logo/boss-design_logo_f158.jpg',
    'bene': 'https://media.architonic.com/m-on/3100024/logo/bene_logo_5cf3.jpg',
    'walter knoll': 'https://media.architonic.com/m-on/3100012/logo/walter-knoll_logo_4da1.jpg',
    'cassina': 'https://media.architonic.com/m-on/3100003/logo/cassina_logo_8141.jpg',
    'poltrona frau': 'https://media.architonic.com/m-on/3100004/logo/poltrona-frau_logo_773d.jpg',
    'viccarbe': 'https://media.architonic.com/m-on/3100877/logo/viccarbe_logo_3979.jpg',
    'moroso': 'https://media.architonic.com/m-on/3100005/logo/moroso_logo_2bf8.jpg',
    'hay': 'https://media.architonic.com/m-on/3101594/logo/hay_logo_1b5b.jpg',
    'muuto': 'https://media.architonic.com/m-on/3102434/logo/muuto_logo_01dc.jpg',
    'kinnarps': 'https://media.architonic.com/m-on/3100021/logo/kinnarps_logo_691e.jpg',
    'flokk': 'https://media.architonic.com/m-on/3104690/logo/flokk_logo_03bb.jpg',
    'vitra': 'https://media.architonic.com/m-on/3100007/logo/vitra_logo_b412.jpg',
    'herman miller': 'https://media.architonic.com/m-on/3100010/logo/herman-miller_logo_53b0.jpg',
    'steelcase': 'https://media.architonic.com/m-on/3100008/logo/steelcase_logo_b8d6.jpg',
    'haworth': 'https://media.architonic.com/m-on/3100018/logo/haworth_logo_9bfb.jpg',
    'knoll': 'https://media.architonic.com/m-on/3100011/logo/knoll_logo_5c50.jpg',
    'framery': 'https://media.architonic.com/m-on/3104634/logo/framery_logo_03bb.jpg',
    'buzzi space': 'https://media.architonic.com/m-on/3101962/logo/buzzispace_logo_773d.jpg',
    'buzzispace': 'https://media.architonic.com/m-on/3101962/logo/buzzispace_logo_773d.jpg',
    'amazon': 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg',
    'noon': 'https://z.nooncdn.com/s/app/com/noon/images/logos/noon-black-en.svg'
};

/**
 * Official website registry for contract & prescan-discovered brands, ensuring
 * non-.com TLDs (.ae, .it, .fr, .nl, .de, .eu, .co.uk, .dk, .design, .space)
 * never get mangled into invalid .com favicon guesses.
 */
export const KNOWN_BRAND_WEBSITES = {
    'workspace': 'https://workspace.ae',
    'workspace.ae': 'https://workspace.ae',
    'narbutas': 'https://www.narbutas.com',
    'nurus': 'https://www.nurus.com',
    'ottimo': 'https://ottimouae.com',
    'ottimo furniture': 'https://ottimouae.com',
    'b&t': 'https://bt.design',
    'bt': 'https://bt.design',
    'bt design': 'https://bt.design',
    'b&t design': 'https://bt.design',
    'pedrali': 'https://www.pedrali.com',
    'sedus': 'https://www.sedus.com',
    'sedus stoll': 'https://www.sedus.com',
    'sokoa': 'https://www.sokoa.com',
    'las': 'https://www.las.it',
    'las mobili': 'https://www.las.it',
    'ofifran': 'https://www.ofifran.com',
    'arper': 'https://www.arper.com',
    'frezza': 'https://www.frezza.com',
    'ismobil': 'https://www.ismobil.com',
    'dedon': 'https://www.dedon.de',
    'emu': 'https://www.emu.it',
    'freifrau': 'https://www.freifrau.com',
    'figueras': 'https://figueras.com',
    'magis': 'https://www.magisdesign.com',
    'magis spa': 'https://www.magisdesign.com',
    'encore seating': 'https://encoreseating.com',
    'kirkhouse': 'https://www.kirkhouse.co.uk',
    'studiodesk': 'https://www.studiodesk.net',
    "bree's new world": 'https://www.breesnewworld.nl',
    'brees new world': 'https://www.breesnewworld.nl',
    'sprout': 'https://sprout-kids.com',
    'sprout kids': 'https://sprout-kids.com',
    'scandinavian designs': 'https://scandinaviandesigns.com',
    'west elm': 'https://www.westelm.com',
    'meeden': 'https://meedenart.com',
    'milimetry': 'https://milimetry.com',
    'ciment studio': 'https://www.cimentstudio.com',
    'sui generis': 'https://www.suigeneris.co.uk',
    'infabbrica': 'https://www.infabbrica.com',
    'wiesner hager': 'https://www.wiesner-hager.com',
    'wiesner-hager': 'https://www.wiesner-hager.com',
    'herman miller': 'https://www.hermanmiller.com',
    'moodie': 'https://www.moonako.fr',
    'moonako': 'https://www.moonako.fr',
    'planurban': 'https://www.planurban.it',
    'ton': 'https://www.ton.eu',
    'framery': 'https://www.frameryacoustics.com',
    'buzzi': 'https://www.buzzi.space',
    'buzzispace': 'https://www.buzzi.space',
    'buzzi space': 'https://www.buzzi.space',
    'please wait to be seated': 'https://www.pleasewaittobeseated.com',
    'andreu world': 'https://www.andreuworld.com',
    'vitra': 'https://www.vitra.com',
    'hay': 'https://hay.dk',
    'muuto': 'https://www.muuto.com',
    'knoll': 'https://www.knoll.com',
    'steelcase': 'https://www.steelcase.com'
};

function extractHostname(urlOrHost) {
    if (!urlOrHost || typeof urlOrHost !== 'string') return '';
    const trimmed = urlOrHost.trim();
    if (!trimmed) return '';
    try {
        const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        const host = new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase();
        return (host && host.includes('.') && !host.includes('localhost')) ? host : '';
    } catch {
        return '';
    }
}

/**
 * Resolves the canonical official website URL for a brand when known.
 */
export function getCanonicalBrandWebsite(brandName = '') {
    if (!brandName || typeof brandName !== 'string') return '';
    const nameLower = brandName.toLowerCase().trim();
    if (KNOWN_BRAND_WEBSITES[nameLower]) return KNOWN_BRAND_WEBSITES[nameLower];
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(nameLower)) {
        return `https://${nameLower.replace(/^www\./, '')}`;
    }
    return '';
}

/**
 * Returns a high-definition logo URL for a brand, falling back to Favicon or SVG monogram.
 */
export function getCanonicalBrandLogo(brandName, websiteUrl = '') {
    if (!brandName || typeof brandName !== 'string') return '';
    const nameLower = brandName.toLowerCase().trim();

    // 1. Check exact match in static contract logos registry
    if (CONTRACT_BRAND_LOGOS[nameLower]) {
        return CONTRACT_BRAND_LOGOS[nameLower];
    }

    // 2. Check whole-token / word-boundary match in registry (avoids 3-char keys like 'las', 'rim', 'ton', 'emu', 'hay' matching inside unrelated words like 'plastics', 'primary', 'hilton')
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matchesWholeToken = (haystack, needle) => {
        if (!haystack || !needle) return false;
        const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:$|[^a-z0-9])`, 'i');
        return re.test(haystack);
    };
    for (const [key, logoUrl] of Object.entries(CONTRACT_BRAND_LOGOS)) {
        if (matchesWholeToken(nameLower, key)) {
            return logoUrl;
        }
        if (nameLower.length >= 4 && matchesWholeToken(key, nameLower)) {
            return logoUrl;
        }
    }

    // 3. Extract hostname from explicit websiteUrl or canonical website registry
    const explicitHost = extractHostname(websiteUrl);
    if (explicitHost) {
        return `https://www.google.com/s2/favicons?domain=${explicitHost}&sz=128`;
    }

    const knownHost = extractHostname(getCanonicalBrandWebsite(brandName));
    if (knownHost) {
        return `https://www.google.com/s2/favicons?domain=${knownHost}&sz=128`;
    }

    // 4. Preserve domain-shaped names (e.g. "workspace.ae"), else default to .com
    const domainShaped = nameLower.replace(/\s+/g, '');
    if (/^[a-z0-9-]+(\.[a-z]{2,})+$/.test(domainShaped)) {
        return `https://www.google.com/s2/favicons?domain=${domainShaped}&sz=128`;
    }

    const cleanDomain = nameLower.replace(/[^a-z0-9]/g, '');
    if (cleanDomain.length >= 3) {
        return `https://www.google.com/s2/favicons?domain=${cleanDomain}.com&sz=128`;
    }

    return '';
}

/**
 * Heals missing, Clearbit-dead, or naive `.com`-mangled favicon URLs on brand records.
 */
export function resolveBrandLogo(brandOrName, fallbackWebsiteUrl = '') {
    const brandObj = (brandOrName && typeof brandOrName === 'object') ? brandOrName : null;
    const brandName = brandObj ? brandObj.name : String(brandOrName || '');
    const currentLogo = brandObj?.logo ? String(brandObj.logo).trim() : '';

    const prodSite = brandObj?.products?.find(p => p?.officialProductUrl || (p?.websiteUrl && String(p.websiteUrl).startsWith('http')));
    const bestWebsite = brandObj?.websiteUrl || brandObj?.url || brandObj?.registry?.officialDomain || prodSite?.officialProductUrl || prodSite?.websiteUrl || fallbackWebsiteUrl || '';

    const canonical = getCanonicalBrandLogo(brandName, bestWebsite);
    if (!currentLogo || currentLogo.includes('clearbit.com') || currentLogo.includes('via.placeholder')) {
        return canonical || currentLogo;
    }

    // Replace broken `<stripped>.com` favicon guesses when a static registry logo or non-.com official domain exists
    const favMatch = currentLogo.match(/google\.com\/s2\/favicons\?domain=([^&]+)/i);
    if (favMatch && canonical && favMatch[1].toLowerCase() !== (extractHostname(bestWebsite) || extractHostname(getCanonicalBrandWebsite(brandName)))) {
        const expectedHost = extractHostname(canonical) || extractHostname(bestWebsite) || extractHostname(getCanonicalBrandWebsite(brandName));
        if (CONTRACT_BRAND_LOGOS[String(brandName || '').toLowerCase().trim()] || (expectedHost && favMatch[1].toLowerCase() !== expectedHost)) {
            return canonical;
        }
    }

    return currentLogo;
}

/**
 * Classifies any FF&E item into the standard 4-tier contract taxonomy.
 */
export function classifyContractCategory(mainHint, subHint, model, description) {
    const combined = `${mainHint || ''} ${subHint || ''} ${model || ''} ${description || ''}`.toLowerCase();

    // ── 0. FLOORING, CARPET & WINDOW TREATMENTS (Never fall through to Seating) ──
    if (/\b(carpet\s*tiles?|broadloom|tufted\s*nylon\s*carpet|carpet\s*flooring|wall[\s-]?to[\s-]?wall\s*carpet|prayer\s*room\s*carpet|tuntex|solution\s*dyed\s*nylon|luxcushion|duraback|pile\s*height|multi\s*hi\s*\/\s*lo\s*loop|carpet)\b/i.test(combined)
        && !/\b(chair|sofa|desk|table|cabinet)\b/i.test(`${mainHint || ''} ${subHint || ''} ${model || ''}`.toLowerCase())) {
        if (/\b(broadloom|wall[\s-]?to[\s-]?wall|roll\s*carpet|prayer\s*room)\b/i.test(combined)) {
            return { mainCategory: 'Flooring', subCategory: 'Broadloom' };
        }
        return { mainCategory: 'Flooring', subCategory: 'Carpet Tiles' };
    }
    if (/\b(luxury\s*vinyl|vinyl\s*tiles?|lvt|spc\s*flooring|vinyl\s*flooring)\b/i.test(combined)) {
        return { mainCategory: 'Flooring', subCategory: 'Luxury Vinyl Tiles' };
    }
    if (/\b(porcelain\s*(?:floor\s*)?tiles?|ceramic\s*(?:floor\s*)?tiles?|marble\s*flooring|stone\s*flooring)\b/i.test(combined)) {
        return { mainCategory: 'Flooring', subCategory: 'Ceramic/Porcelain' };
    }
    if (/\b(electric\s*curtain|motorized\s*curtain|window\s*curtain|roller\s*blinds?|blackout\s*blinds?|sunscreen\s*blinds?|venetian\s*blinds?|vertical\s*blinds?|window\s*blinds?|window\s*treatments?|drapery)\b/i.test(combined)) {
        return { mainCategory: 'Doors & Windows', subCategory: 'Window Treatments' };
    }

    // ── 1. AUDITORIUM & SPECIALIST SEATING (Highest Priority) ──
    if (/\b(auditorium|theatre|theater|cinema|stadium|fixed seat|scala|tip-up|lecture hall|specialist chair|auditorium tip-up)\b/i.test(combined)) {
        return { mainCategory: 'Office Seating', subCategory: 'Specialist Chairs' };
    }

    // ── 2. PLANTERS & LANDSCAPE (Prioritized over generic words) ──
    if (/\b(planter|modular planter|limone|flower pot|plant box|landscape planter)\b/i.test(combined)) {
        return { mainCategory: 'Furniture', subCategory: 'Planters' };
    }

    const titleOnly = `${mainHint || ''} ${subHint || ''} ${model || ''}`.toLowerCase();

    // ── 2.5 BEDS (bunk / single / hostel beds), judged on the product title ──
    if (isBedSpecHeadline(String(model || '')) || isBedSpecHeadline(`${subHint || ''} ${model || ''}`)
        || (!String(model || '').trim() && isBedSpecHeadline(String(description || '').split(/[\r\n|.]+/)[0]))) {
        return { mainCategory: 'Furniture', subCategory: 'Beds' };
    }

    // ── 3. FOLDING, NESTING, TRAINING & STACKING CHAIRS ──
    if (/\b(foldable chair|folding chair|training chair|nesting chair|nesting training chair|educational chair|piper|pila|stackable chair|stacking chair|seminar chair|round chair \(foldable\))\b/i.test(combined)) {
        return { mainCategory: 'Office Seating', subCategory: 'Training Chairs' };
    }
    if (/\b(desks?|conference tables?|meeting tables?|workstations?)\b/i.test(titleOnly) && !/\b(chair|sofa|couch|armchair|lounge|stool)\b/i.test(titleOnly)) {
        if (/\b(conference|meeting)\b/i.test(titleOnly)) return { mainCategory: 'Desk & Table', subCategory: 'Conference Tables' };
        if (/\b(height adjustable|sit.stand)\b/i.test(titleOnly)) return { mainCategory: 'Desk & Table', subCategory: 'Height Adjustable Desks' };
        return { mainCategory: 'Desk & Table', subCategory: 'Single Desks' };
    }

    // ── 4. SOFAS, BENCHES & LOUNGE SEATING ──
    if (/\b(sofa|couch|modular sofa|3 seater|2 seater|three seater|two seater|ottoman|pouf|pouffe|bench|modular bench|outdoor bench|capsule bench|landscape bench|terrazzo bench|concrete bench|halo modern|circular seating|daybed|banquette)\b/i.test(combined)) {
        return { mainCategory: 'Office Seating', subCategory: 'Sofas' };
    }
    if (/\b(lounge|lounge chair|armchair|soft seating|easy chair|club chair|relax chair|wingback|stella|arm chair|bergere)\b/i.test(combined)) {
        return { mainCategory: 'Office Seating', subCategory: 'Lounge Chairs' };
    }

    // ── 4. TASK & ERGONOMIC CHAIRS ──
    if (/\b(task chair|staff chair|mesh chair|operator|operative|work chair|ergonomic chair|se:motion|se:flex|se:air|freek|joyce|work chairs|black dot)\b/i.test(combined)) {
        return { mainCategory: 'Office Seating', subCategory: 'Staff Chairs' };
    }
    if (/\b(executive chair|high back|high-back|boss chair|director chair|presidential|head of chair|ceo chair)\b/i.test(combined)) {
        return { mainCategory: 'Office Seating', subCategory: 'Executive Chairs' };
    }
    if (/\b(stool|bar stool|counter stool|drafting stool|high stool|barstool|p\.o\.v\.|se:café|se:cafe)\b/i.test(combined)) {
        return { mainCategory: 'Office Seating', subCategory: 'Stools' };
    }
    if (/\bchair\b/i.test(titleOnly) && !/\b(table|desk|cabinet|rack|trolley|caddy)\b/i.test(titleOnly)) {
        return { mainCategory: 'Office Seating', subCategory: 'Conference Chairs' };
    }
    if (/\b(chair|dining chair|side chair|meeting chair|conference chair|visitor chair|carousel|plastic chair|multipurpose|multi-use|seating)\b/i.test(combined) && !/\b(table|desk|storage|cabinet)\b/i.test(combined)) {
        return { mainCategory: 'Office Seating', subCategory: 'Conference Chairs' };
    }

    // ── 5. PLANTERS & ACCESSORIES ──
    if (/\b(planter|modular planter|limone|flower pot|plant box|landscape planter)\b/i.test(combined)) {
        return { mainCategory: 'Furniture', subCategory: 'Planters' };
    }
    if (/\b(cable tray|power socket|power box|monitor arm|coat stand|waste bin|accessory|wire management|lighting|electrical)\b/i.test(combined) && !/\b(table|desk|workstation|skill)\b/i.test(combined)) {
        return { mainCategory: 'Accessories', subCategory: 'wires managerment' };
    }

    // ── 6. ACOUSTIC SOLUTIONS (Strictly Pods & Soundproof Rooms) ──
    if (/\b(soundproof pod|phone booth|acoustic booth|silence room|meeting pod|framery|silent room|acoustic pod|office pod|soundproof cabin)\b/i.test(combined)) {
        return { mainCategory: 'Acoustic Solutions', subCategory: 'Office Pods' };
    }
    if (/\b(acoustic panel|wall panel|sound absorbing|baffle|acoustic screen|acoustic baffle|wall dampening)\b/i.test(combined)) {
        return { mainCategory: 'Acoustic Solutions', subCategory: 'Acoustic Panels' };
    }

    // ── 7. DESK & TABLES ──
    if (/\b(coffee table|side table|low table|breakout table|center table|satellite|occasional table|cocktail table)\b/i.test(combined)) {
        return { mainCategory: 'Desk & Table', subCategory: 'Coffee Tables' };
    }
    if (/\b(conference table|meeting table|boardroom table|discussion table|forum|collaborative table)\b/i.test(combined)) {
        return { mainCategory: 'Desk & Table', subCategory: 'Conference Tables' };
    }
    if (/\b(reception desk|front desk|reception counter|counter desk|reception furniture)\b/i.test(combined)) {
        return { mainCategory: 'Desk & Table', subCategory: 'Reception Desks' };
    }
    if (/\b(height adjustable|sit.stand|sit-to-stand|electric desk|motorized desk|lift desk)\b/i.test(combined)) {
        return { mainCategory: 'Desk & Table', subCategory: 'Height Adjustable Desks' };
    }
    if (/\b(workstation|desk system|bench system|cluster|modular desk|nova|move|benching|work table|desking system)\b/i.test(combined)) {
        return { mainCategory: 'Desk & Table', subCategory: 'Desk System' };
    }
    if (/\b(dining table|mesa cuvier|skill|bistro table|restaurant table|cafe table|lounge table|display table|fixture table)\b/i.test(combined)) {
        return { mainCategory: 'Desk & Table', subCategory: 'Lounge Tables' };
    }
    if (/\b(folding tables?|foldable tables?|flip-top tables?|flip top tables?|desks?|single desks?|freestanding desks?|individual desks?|executive desks?|computer desks?|training desks?)\b/i.test(combined)) {
        return { mainCategory: 'Desk & Table', subCategory: 'Single Desks' };
    }
    if (/\btables?\b/i.test(titleOnly) && !/\b(chair|stool|cabinet|shelf)\b/i.test(titleOnly)) {
        return { mainCategory: 'Desk & Table', subCategory: 'Conference Tables' };
    }

    // ── 8. STORAGE & DISPLAY RACKS ──
    if (/\b(display rack|rack|bookshelf|bookcase|shelving|open shelving|library shelf|california booth)\b/i.test(combined)) {
        return { mainCategory: 'Storage', subCategory: 'bookcase' };
    }
    if (/\b(mobile drawer|underdesk drawer|drawer unit)\b/i.test(combined)) {
        return { mainCategory: 'Storage', subCategory: 'pedestals' };
    }
    if (/\b(lateral file|filing cabinet|file storage)\b/i.test(combined)) {
        return { mainCategory: 'Storage', subCategory: 'lateral files' };
    }
    if (/\b(credenza|sideboard|low storage|side cabinet)\b/i.test(combined)) {
        return { mainCategory: 'Storage', subCategory: 'credenzas' };
    }
    if (/\b(wardrobe|locker|personal locker|coat locker)\b/i.test(combined)) {
        return { mainCategory: 'Storage', subCategory: 'wardrobes' };
    }
    if (/\b(cabinet|cupboard|storage|wardrobe|credenza|lockers|choice cabinet|sliding door unit|tambour|mobile cart|vendor cart)\b/i.test(combined)) {
        return { mainCategory: 'Storage', subCategory: 'cabinets' };
    }

    // ── 9. PARTITION WALL & CUBICLE ──
    if (/\b(cubicle|call center|workstation screen|desk screen|privacy screen|table divider|modular cubicle)\b/i.test(combined)) {
        return { mainCategory: 'Office Cubicle', subCategory: 'Modular Cubicle' };
    }
    if (/\b(full height|glass partition|demountable partition|movable partition|operable wall|space division|partition wall|wall cladding)\b/i.test(combined)) {
        return { mainCategory: 'Partition Wall', subCategory: 'full height partition wall' };
    }

    // Canonical Fallback by Main Hint
    if (mainHint && /desk|table/i.test(mainHint)) {
        return { mainCategory: 'Desk & Table', subCategory: 'Single Desks' };
    }
    if (mainHint && /storage|filing/i.test(mainHint)) {
        return { mainCategory: 'Storage', subCategory: 'cabinets' };
    }
    if (mainHint && /acoustic|pod|booth/i.test(mainHint)) {
        return { mainCategory: 'Acoustic Solutions', subCategory: 'Office Pods' };
    }
    if (mainHint && /cubicle|workstation/i.test(mainHint)) {
        return { mainCategory: 'Office Cubicle', subCategory: 'Modular Cubicle' };
    }
    if (mainHint && /partition|wall/i.test(mainHint)) {
        return { mainCategory: 'Partition Wall', subCategory: 'full height partition wall' };
    }
    if (mainHint && /access/i.test(mainHint)) {
        return { mainCategory: 'Accessories', subCategory: 'accessories' };
    }

    return {
        mainCategory: 'Office Seating',
        subCategory: 'Conference Chairs'
    };
}
