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
