import { getApiBase } from './apiBase';

const API_BASE = getApiBase();

/**
 * Normalizes and proxies URLs for images.
 * Useful for bypassing CORS or hotlink protection.
 */
export const getFullUrl = (input) => {
    if (!input) return '';
    let url = typeof input === 'object' ? input.url : input;
    if (!url) return '';
    
    let normalizedUrl = url;
    if (url.startsWith('//')) {
        normalizedUrl = 'https:' + url;
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

    const isDirect = directDomains.some(d => normalizedUrl.includes(d)) ||
                     normalizedUrl.includes(window.location.hostname);

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
 * Gets the proxy-wrapped brand logo URL.
 * If no logo is found on the brand object, generates a domain-based fallback using Clearbit Logo API.
 */
export const getBrandLogo = (brand) => {
    if (!brand) return '';
    
    // If brand has a valid logo, proxy/normalize it
    if (brand.logo) {
        return getFullUrl(brand.logo);
    }
    
    // Otherwise, generate a Clearbit Logo API fallback based on brand name
    const name = brand.name || '';
    const cleanName = name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    if (!cleanName) return '';
    
    // Map common brands to their actual domains
    const brandDomains = {
        'homedesign': 'homedesign.it',
        'narbutas': 'narbutas.com',
        'pedrali': 'pedrali.it',
        'poliform': 'poliform.it',
        'amara': 'amara.com',
        'b&t design': 'bt.design',
        'bt design': 'bt.design',
        'arper': 'arper.com',
        'true design': 'truedesign.it',
        'divani': 'divani.it',
        'ottimo': 'ottimo.design',
        'infiniti': 'infinitidesign.it',
        'vitra': 'vitra.com',
        'herman miller': 'hermanmiller.com',
        'steelcase': 'steelcase.com',
        'sedus': 'sedus.com',
        'haworth': 'haworth.com',
        'knoll': 'knoll.com',
        'boss design': 'bossdesign.com'
    };
    
    const domain = brandDomains[name.toLowerCase().trim()] || `${cleanName}.com`;
    return `https://logo.clearbit.com/${domain}`;
};
export const getBrandLogoFallback = (brand) => {
    if (!brand) return '';
    const name = brand.name || 'B';
    const initial = name[0].toUpperCase();
    
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
