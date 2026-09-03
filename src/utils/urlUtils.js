import { getApiBase } from './apiBase';

const API_BASE = getApiBase();

/**
 * Normalizes and proxies URLs for images.
 * Useful for bypassing CORS or hotlink protection.
 */
export const getFullUrl = (input) => {
    if (!input) return '';
    let url = typeof input === 'object' ? input.url : input;
    if (!url || typeof url !== 'string') return '';
    
    let normalizedUrl = url.trim();
    if (normalizedUrl.startsWith('//')) {
        normalizedUrl = 'https:' + normalizedUrl;
    }

    // If already routed through image-proxy or is data URL, return immediately
    if (normalizedUrl.includes('/api/image-proxy')) {
        if (normalizedUrl.startsWith('http')) return normalizedUrl;
        return `${API_BASE}${normalizedUrl.startsWith('/') ? '' : '/'}${normalizedUrl}`;
    }
    if (normalizedUrl.startsWith('data:image/')) {
        return normalizedUrl;
    }
    
    // List of external domains that need proxying (CORS/Hotlinking)
    const proxyDomains = [
        'amara-art.com',
        'architonic.com',
        'narbutas.com',
        'sedus.com',
        'hermanmiller.com',
        'steelcase.com',
        'vitra.com',
        'las.it',
        'ismobil.com',
        'teknion.com',
        'haworth.com',
        'knoll.com',
        'interstuhl.com',
        'wilkhahn.com',
        'bossdesign.com'
    ];

    // EMF/WMF files ALWAYS need proxying for server-side conversion to PNG
    const isEmfWmf = /\.(emf|wmf)(\?|$)/i.test(normalizedUrl);
    if (isEmfWmf) {
        return `${API_BASE}/api/image-proxy?url=${encodeURIComponent(normalizedUrl)}`;
    }

    // Domains that don't need proxying (public CDNs with CORS support)
    const directDomains = [
        'supabase.co',
        'images.unsplash.com',
        'googleusercontent.com',
        'freeimage.host',
        'iili.io',
        'logo.clearbit.com',
        'localhost'
    ];

    const hostname = (typeof window !== 'undefined' && window.location) ? window.location.hostname : 'localhost';
    const isDirect = directDomains.some(d => normalizedUrl.includes(d)) ||
                     (hostname && normalizedUrl.includes(hostname));

    if (isDirect) {
        return normalizedUrl;
    }

    const needsProxy = proxyDomains.some(domain => normalizedUrl.includes(domain)) || 
                      normalizedUrl.startsWith('http');

    if (needsProxy) {
        return `${API_BASE}/api/image-proxy?url=${encodeURIComponent(normalizedUrl)}`;
    }

    if (normalizedUrl.startsWith('http') || normalizedUrl.startsWith('data:')) {
        return normalizedUrl;
    }
    
    return `${API_BASE}${normalizedUrl}`;
};

/**
 * Static high-definition logo registry for established contract manufacturers & marketplaces.
 */
export const STATIC_BRAND_LOGOS = {
    'narbutas': 'https://media.architonic.com/m-on/10001981/logo/narbutas_logo_1b5b.jpg',
    'b&t design': 'https://media.architonic.com/m-on/3103498/logo/b-t-design_logo_f158.jpg',
    'bt design': 'https://media.architonic.com/m-on/3103498/logo/b-t-design_logo_f158.jpg',
    'ottimo': 'https://ottimouae.com/wp-content/uploads/2022/08/ottimo-logo.png',
    'ottimo furniture': 'https://ottimouae.com/wp-content/uploads/2022/08/ottimo-logo.png',
    'nurus': 'https://media.architonic.com/m-on/3100100/logo/nurus_logo_773d.jpg',
    'sedus': 'https://media.architonic.com/m-on/3100165/logo/sedus-stoll_logo_8141.jpg',
    'sedus stoll': 'https://media.architonic.com/m-on/3100165/logo/sedus-stoll_logo_8141.jpg',
    'sokoa': 'https://media.architonic.com/m-on/3103368/logo/sokoa_logo_03bb.jpg',
    'las': 'https://www.las.it/wp-content/themes/las/assets/images/logo-las-white.svg',
    'ofifran': 'https://media.architonic.com/m-on/3104433/logo/ofifran_logo_2977.jpg',
    'rim': 'https://media.architonic.com/m-on/3105033/logo/rim_logo_98da.jpg',
    'pedrali': 'https://media.architonic.com/m-on/3100115/logo/pedrali_logo_f3da.jpg',
    'arper': 'https://media.architonic.com/m-on/3100610/logo/arper_logo_2bf8.jpg',
    'frezza': 'https://media.architonic.com/m-on/3101675/logo/frezza_logo_dc96.jpg',
    'm&w': 'https://www.mwworkstation.com/Public/www/images/logo.png',
    'mw structure test': 'https://www.mwworkstation.com/Public/www/images/logo.png',
    'dauphin': 'https://media.architonic.com/m-on/3102096/logo/dauphin_logo_84d7.jpg',
    'dauphin products, collections and more': 'https://media.architonic.com/m-on/3102096/logo/dauphin_logo_84d7.jpg',
    'teknion': 'https://www.teknion.com/docs/default-source/sitetemplatefiles/logo.svg',
    'teknion me': 'https://www.teknion.com/docs/default-source/sitetemplatefiles/logo.svg',
    'freifrau': 'https://media.architonic.com/m-on/3104694/logo/freifrau_logo_5cf3.jpg',
    'dedon': 'https://media.architonic.com/m-on/3100020/logo/dedon_logo_691e.jpg',
    'emu': 'https://media.architonic.com/m-on/3100062/logo/emu_logo_01dc.jpg',
    'figueras': 'https://media.architonic.com/m-on/3100234/logo/figueras_logo_fba6.jpg',
    'ton': 'https://media.architonic.com/m-on/3100171/logo/ton_logo_1a8e.jpg',
    'moonako': 'https://moodie.ae/wp-content/uploads/2023/08/moonako-logo.svg',
    'moodie': 'https://moodie.ae/wp-content/uploads/2023/08/moodie-logo.svg',
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
    'amazon': 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg',
    'noon': 'https://z.nooncdn.com/s/app/com/noon/images/logos/noon-black-en.svg',
    'vitra': 'https://media.architonic.com/m-on/3100007/logo/vitra_logo_b412.jpg',
    'herman miller': 'https://media.architonic.com/m-on/3100010/logo/herman-miller_logo_53b0.jpg',
    'steelcase': 'https://media.architonic.com/m-on/3100008/logo/steelcase_logo_b8d6.jpg',
    'haworth': 'https://media.architonic.com/m-on/3100018/logo/haworth_logo_9bfb.jpg',
    'knoll': 'https://media.architonic.com/m-on/3100011/logo/knoll_logo_5c50.jpg'
};

/**
 * Gets the proxy-wrapped brand logo URL.
 * Checks brand object, static CDN registry, or generates a clean SVG monogram badge.
 */
export const getBrandLogo = (brand) => {
    if (!brand) return '';
    
    // 1. If brand has a valid explicit logo URL, proxy and return
    if (brand.logo && typeof brand.logo === 'string' && brand.logo.trim() && !brand.logo.includes('clearbit.com')) {
        return getFullUrl(brand.logo);
    }
    
    // 2. Check Static High-Definition Brand Logo Map
    const name = (typeof brand === 'string' ? brand : (brand.name || '')).toLowerCase().trim();
    if (STATIC_BRAND_LOGOS[name]) {
        return getFullUrl(STATIC_BRAND_LOGOS[name]);
    }

    // 3. Check partial matches in static registry
    for (const [key, logoUrl] of Object.entries(STATIC_BRAND_LOGOS)) {
        if (name.includes(key) || key.includes(name)) {
            return getFullUrl(logoUrl);
        }
    }
    
    // 4. Return instant SVG monogram fallback with crisp branding colors
    return getBrandLogoFallback(brand);
};

export const getBrandLogoFallback = (brand) => {
    if (!brand) return '';
    const name = (typeof brand === 'string' ? brand : (brand.name || 'B')).trim();
    const initial = (name[0] || 'B').toUpperCase();
    
    // Select stable premium HSL/Hex color palette based on name hash
    const colors = [
        ['#E0F2FE', '#0369A1'], // Sky light-blue
        ['#FEE2E2', '#B91C1C'], // Red
        ['#FEF3C7', '#B45309'], // Amber
        ['#ECFDF5', '#047857'], // Emerald
        ['#EEF2FF', '#4338CA'], // Indigo
        ['#FDF2F8', '#BE185D'], // Pink
        ['#F5F3FF', '#6D28D9'], // Purple
        ['#F0FDF4', '#15803D'], // Green
        ['#FFF7ED', '#C2410C'], // Orange
        ['#F1F5F9', '#334155']  // Slate
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
    const [bg, fg] = colors[hash % colors.length];
    
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <rect width="100" height="100" rx="20" fill="${bg.replace('#', '%23')}"/>
        <text x="50" y="52" font-family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-weight="700" font-size="48" fill="${fg.replace('#', '%23')}" dominant-baseline="middle" text-anchor="middle">${initial}</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${svg}`;
};
