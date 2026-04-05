import { getApiBase } from './apiBase';

const API_BASE = getApiBase();

/**
 * Normalizes and proxies URLs for images.
 * Useful for bypassing CORS or hotlink protection.
 */
export const getFullUrl = (url) => {
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
        'vitra.com'
    ];

    const needsProxy = proxyDomains.some(domain => normalizedUrl.includes(domain));

    if (needsProxy) {
        // We use base64 for common domains to bypass some filters, or just raw for others
        // Server expects base64 if it doesn't start with http, but we can just use the query param
        return `${API_BASE}/api/image-proxy?url=${encodeURIComponent(normalizedUrl)}`;
    }

    if (normalizedUrl.startsWith('http') || normalizedUrl.startsWith('data:')) {
        return normalizedUrl;
    }
    
    return `${API_BASE}${normalizedUrl}`;
};
