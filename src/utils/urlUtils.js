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
    
    return `${API_BASE}${normalizedUrl.startsWith('/') ? '' : '/'}${normalizedUrl}`;
};

const buildWordmarkSvg = (label, { color = '#0f172a', accent = '#d97706', fontWeight = '700', letterSpacing = '2', fontSize = '30', italic = false, mark = 'bar' } = {}) => {
    const safeLabel = String(label || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const styleAttr = italic ? ' font-style="italic"' : '';
    const markEl = mark === 'dot'
        ? `<circle cx="24" cy="40" r="6" fill="${accent}"/>`
        : mark === 'circle'
            ? `<circle cx="120" cy="66" r="3" fill="${accent}"/><rect x="66" y="65" width="44" height="2" rx="1" fill="${accent}" opacity="0.55"/><rect x="130" y="65" width="44" height="2" rx="1" fill="${accent}" opacity="0.55"/>`
            : `<rect x="78" y="63" width="84" height="3" rx="1.5" fill="${accent}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80" width="240" height="80"><text x="120" y="45" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="${fontWeight}" font-size="${fontSize}" letter-spacing="${letterSpacing}"${styleAttr} fill="${color}" dominant-baseline="middle" text-anchor="middle">${safeLabel}</text>${markEl}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const LAS_DARK_SVG = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="93.403" height="47.238" viewBox="0 0 93.403 47.238"><path fill="#0f172a" d="M72.772,26.785a12.2,12.2,0,0,1,.141-17.849,13.752,13.752,0,0,1,18.766.141l6.04,5.786L90.94,21.206l-6.04-5.79a3.881,3.881,0,0,0-5.292-.037,3.441,3.441,0,0,0-.042,5.039h0l7.6,6.455M51.349,31.566,47.356,16.548c-.44-1.245-1.154-1.245-1.59,0l-4.4,15.034ZM76.221,43.388H82.7a3.736,3.736,0,0,0,2.6-1.067,3.5,3.5,0,0,0,.1-5.081l-1-.967-11.622-9.51a12.2,12.2,0,0,1,.141-17.849,13.752,13.752,0,0,1,18.766.141l6.04,5.786L90.94,21.206l-6.04-5.79a3.881,3.881,0,0,0-5.292-.037,3.441,3.441,0,0,0-.042,5.039h0l13.864,11.8h0a11.473,11.473,0,0,1,0,16.794,12.416,12.416,0,0,1-9.194,3.424h-16.6a12.7,12.7,0,0,1-11.975-8.011L54.2,40.4H38.428l-1.449,4.026a12.655,12.655,0,0,1-11.971,8.011H8.691A4.292,4.292,0,0,1,4.32,48.286v-4.2h0V5.2h9.505V40.993c0,2.408,0,2.416,2.536,2.416H23.9a4.993,4.993,0,0,0,4.437-3.051l2.337-6.729,7.106-22.116a9.435,9.435,0,0,1,17.554-.075L61.98,33.629l2.337,6.729a5.02,5.02,0,0,0,4.437,3.051H76.2M95.237,8.18h.311V7.35h.295a.436.436,0,0,1,.486.365,2.184,2.184,0,0,0,.158.448h.324a2.491,2.491,0,0,1-.187-.515.494.494,0,0,0-.353-.382h0c.253-.066.457-.228.457-.477a.415.415,0,0,0-.191-.357,1.187,1.187,0,0,0-.7-.154,4.184,4.184,0,0,0-.6.037ZM95.548,6.5a1.988,1.988,0,0,1,.307-.021c.332,0,.556.108.556.349s-.212.357-.544.357h-.32Zm2.175.755a1.814,1.814,0,0,0-3.624,0,1.814,1.814,0,0,0,3.624,0Zm-.291,0a1.523,1.523,0,0,1-3.043,0,1.523,1.523,0,0,1,3.043,0Z" transform="translate(-4.32 -5.2)"/></svg>')}`;

/**
 * Static high-definition logo registry for established contract manufacturers & marketplaces.
 */
export const STATIC_BRAND_LOGOS = {
    'narbutas': 'https://media.architonic.com/m-on/10001981/logo/narbutas_logo_c1db0dc7.jpeg?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'b&t design': 'https://media.architonic.com/m-on/3103498/logo/b-t-design_logo_b083bc1d.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'bt design': 'https://media.architonic.com/m-on/3103498/logo/b-t-design_logo_b083bc1d.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'ottimo': 'https://ottimouae.com/wp-content/uploads/2022/08/ottimo-logo-retina.png',
    'ottimo furniture': 'https://ottimouae.com/wp-content/uploads/2022/08/ottimo-logo-retina.png',
    'nurus': 'https://media.architonic.com/m-on/3100100/logo/nurus_logo_779d6867.jpeg?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'sedus': 'https://media.architonic.com/m-on/3100165/logo/sedus-stoll_logo_2a03183e.png',
    'sedus stoll': 'https://media.architonic.com/m-on/3100165/logo/sedus-stoll_logo_2a03183e.png',
    'sokoa': 'https://media.architonic.com/m-on/3103368/logo/sokoa_logo_03b4fd9d.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'las': LAS_DARK_SVG,
    'las mobili': LAS_DARK_SVG,
    'ofifran': 'https://media.architonic.com/m-on/3104433/logo/ofifran_logo_732b4c6b.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'rim': 'https://media.architonic.com/m-on/3105033/logo/rim_logo_98da7a6b.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'pedrali': buildWordmarkSvg('pedrali', { color: '#111827', accent: '#dc2626', fontWeight: '800', letterSpacing: '3', fontSize: '31', mark: 'circle' }),
    'arper': 'https://media.architonic.com/m-on/3100610/logo/arper_logo_2bbd6b5f.jpeg?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'frezza': 'https://media.architonic.com/m-on/3101675/logo/frezza_logo_d9f68f35.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'm&w': 'https://www.mwworkstation.com/Public/www/images/logo.png',
    'mw structure test': 'https://www.mwworkstation.com/Public/www/images/logo.png',
    'dauphin': 'https://media.architonic.com/m-on/3102096/logo/dauphin_logo_074f8022.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'dauphin products, collections and more': 'https://media.architonic.com/m-on/3102096/logo/dauphin_logo_074f8022.png?width=320&height=120&fit=inside&crop=true&format=webp&quality=90',
    'teknion': 'https://www.teknion.com/docs/default-source/sitetemplatefiles/teknion-logo.svg',
    'teknion me': 'https://www.teknion.com/docs/default-source/sitetemplatefiles/teknion-logo.svg',
    'freifrau': buildWordmarkSvg('FREIFRAU', { color: '#1f2937', accent: '#b45309', fontWeight: '500', letterSpacing: '6', fontSize: '24', mark: 'circle' }),
    'dedon': buildWordmarkSvg('DEDON', { color: '#18181b', accent: '#d97706', fontWeight: '800', letterSpacing: '6', fontSize: '28' }),
    'emu': buildWordmarkSvg('emu', { color: '#0f172a', accent: '#16a34a', fontWeight: '800', letterSpacing: '4', fontSize: '34', mark: 'circle' }),
    'figueras': buildWordmarkSvg('FIGUERAS', { color: '#111827', accent: '#2563eb', fontWeight: '700', letterSpacing: '4', fontSize: '24' }),
    'ton': buildWordmarkSvg('TON', { color: '#111827', accent: '#b91c1c', fontWeight: '900', letterSpacing: '7', fontSize: '32', mark: 'circle' }),
    'moonako': 'https://www.google.com/s2/favicons?domain=moonako.fr&sz=128',
    'moodie': 'https://www.google.com/s2/favicons?domain=moonako.fr&sz=128',
    'andreu world': buildWordmarkSvg('Andreu World', { color: '#111827', accent: '#dc2626', fontWeight: '700', letterSpacing: '1', fontSize: '25' }),
    'magis': buildWordmarkSvg('MAGIS', { color: '#0f172a', accent: '#e11d48', fontWeight: '900', letterSpacing: '6', fontSize: '30' }),
    'wiesner hager': buildWordmarkSvg('wiesner hager', { color: '#1e293b', accent: '#0284c7', fontWeight: '600', letterSpacing: '1.5', fontSize: '24' }),
    'wiesner-hager': buildWordmarkSvg('wiesner hager', { color: '#1e293b', accent: '#0284c7', fontWeight: '600', letterSpacing: '1.5', fontSize: '24' }),
    'interstuhl': buildWordmarkSvg('interstuhl', { color: '#0f172a', accent: '#e11d48', fontWeight: '800', letterSpacing: '1.5', fontSize: '30', mark: 'circle' }),
    'wilkhahn': buildWordmarkSvg('Wilkhahn', { color: '#111827', accent: '#1d4ed8', fontWeight: '700', letterSpacing: '1.5', fontSize: '28' }),
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
    'vitra': buildWordmarkSvg('vitra.', { color: '#09090b', accent: '#f59e0b', fontWeight: '800', letterSpacing: '1', fontSize: '34', mark: 'circle' }),
    'herman miller': buildWordmarkSvg('HermanMiller', { color: '#111827', accent: '#dc2626', fontWeight: '700', letterSpacing: '0.5', fontSize: '25' }),
    'steelcase': buildWordmarkSvg('Steelcase', { color: '#0f172a', accent: '#2563eb', fontWeight: '800', letterSpacing: '1', fontSize: '28' }),
    'haworth': buildWordmarkSvg('HAWORTH', { color: '#111827', accent: '#0d9488', fontWeight: '700', letterSpacing: '3', fontSize: '25' }),
    'knoll': buildWordmarkSvg('Knoll', { color: '#b91c1c', accent: '#111827', fontWeight: '800', letterSpacing: '1.5', fontSize: '33' })
};

/**
 * Gets the proxy-wrapped brand logo URL.
 * Checks static CDN/wordmark registry, explicit brand logo URL, or generates a clean SVG monogram badge.
 */
export const getBrandLogo = (brand) => {
    if (!brand) return '';

    const name = (typeof brand === 'string' ? brand : (brand.name || '')).toLowerCase().trim();

    // 1. Check exact match in verified static logo registry
    if (STATIC_BRAND_LOGOS[name]) {
        return getFullUrl(STATIC_BRAND_LOGOS[name]);
    }

    // 2. Check prefix/exact-token match for short keys ('las', 'rim', 'm&w', 'ton', 'emu', 'hay')
    for (const key of ['las', 'rim', 'm&w', 'ton', 'emu', 'hay']) {
        if (STATIC_BRAND_LOGOS[key] && (name === key || name.startsWith(key + ' '))) {
            return getFullUrl(STATIC_BRAND_LOGOS[key]);
        }
    }

    // 3. Check partial matches in static registry
    for (const [key, logoUrl] of Object.entries(STATIC_BRAND_LOGOS)) {
        if (key.length < 4) continue;
        if (name.includes(key) || key.includes(name)) {
            return getFullUrl(logoUrl);
        }
    }

    // 4. If brand has a valid explicit non-placeholder logo URL, proxy and return
    if (
        brand.logo &&
        typeof brand.logo === 'string' &&
        brand.logo.trim() &&
        !brand.logo.includes('clearbit.com') &&
        !brand.logo.includes('logo-menu.svg') &&
        !brand.logo.includes('logo-las-white.svg')
    ) {
        return getFullUrl(brand.logo);
    }

    // 5. Return instant SVG monogram fallback with crisp branding colors
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
