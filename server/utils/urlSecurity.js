import dns from 'dns/promises';
import net from 'net';

const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
    'metadata.google.internal',
    'metadata.goog',
    'instance-data',
]);

/**
 * Returns true if an IPv4 or IPv6 literal belongs to a private, loopback,
 * link-local, CGNAT, metadata, multicast, or unspecified address range.
 */
export function isPrivateOrReservedIp(ip) {
    if (!ip || typeof ip !== 'string') return true;
    const raw = ip.trim().toLowerCase();

    // Unwrap IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (raw.startsWith('::ffff:')) {
        const tail = raw.slice(7);
        if (net.isIPv4(tail)) return isPrivateOrReservedIp(tail);
        const hexParts = tail.split(':');
        if (hexParts.length === 2) {
            const hi = parseInt(hexParts[0], 16);
            const lo = parseInt(hexParts[1], 16);
            if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
                const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
                return isPrivateOrReservedIp(v4);
            }
        }
    }

    if (net.isIPv4(raw)) {
        const parts = raw.split('.').map(Number);
        if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
        const [a, b] = parts;
        if (a === 0) return true;                          // 0.0.0.0/8 (unspecified)
        if (a === 10) return true;                         // 10.0.0.0/8 (RFC1918)
        if (a === 127) return true;                        // 127.0.0.0/8 (loopback)
        if (a === 169 && b === 254) return true;           // 169.254.0.0/16 (link-local / cloud metadata)
        if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 (RFC1918)
        if (a === 192 && b === 168) return true;           // 192.168.0.0/16 (RFC1918)
        if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
        if (a === 192 && b === 0) return true;             // 192.0.0.0/24, 192.0.2.0/24
        if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmark)
        if (a >= 224) return true;                         // Multicast / reserved
        return false;
    }

    if (net.isIPv6(raw)) {
        if (raw === '::' || raw === '::1') return true;
        // Unique Local Addresses fc00::/7 (fc.. / fd..)
        if (/^f[cd][0-9a-f]{2}:/.test(raw) || /^f[cd][0-9a-f]{0,2}$/.test(raw.split(':')[0])) return true;
        // Link-local fe80::/10 (fe80..febf)
        if (/^fe[89ab][0-9a-f]:/.test(raw)) return true;
        // Multicast ff00::/8
        if (raw.startsWith('ff')) return true;
        return false;
    }

    return true;
}

/**
 * Validates that a user-supplied URL is a safe external http(s) URL
 * and does not resolve to localhost, private RFC1918 networks, or cloud metadata IPs.
 *
 * @param {string} rawUrl
 * @param {object} [options]
 * @param {string[]} [options.allowedHosts] - Optional hostnames explicitly trusted (e.g. configured Supabase/Railway hosts)
 * @returns {Promise<URL>}
 */
export async function assertSafeExternalUrl(rawUrl, { allowedHosts = [] } = {}) {
    let parsed;
    try {
        parsed = new URL(String(rawUrl || '').trim());
    } catch {
        const err = new Error('Invalid URL format');
        err.statusCode = 400;
        throw err;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        const err = new Error(`Unsupported URL protocol: ${parsed.protocol}`);
        err.statusCode = 403;
        throw err;
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname) {
        const err = new Error('URL hostname is required');
        err.statusCode = 400;
        throw err;
    }

    const normalizedAllowed = allowedHosts
        .filter(Boolean)
        .map(h => String(h).toLowerCase().trim());
    if (normalizedAllowed.includes(hostname)) {
        return parsed;
    }

    if (
        BLOCKED_HOSTNAMES.has(hostname) ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal')
    ) {
        const err = new Error(`Blocked internal hostname: ${hostname}`);
        err.statusCode = 403;
        throw err;
    }

    if (net.isIP(hostname)) {
        if (isPrivateOrReservedIp(hostname)) {
            const err = new Error(`Blocked private/reserved IP address: ${hostname}`);
            err.statusCode = 403;
            throw err;
        }
        return parsed;
    }

    let records;
    try {
        records = await dns.lookup(hostname, { all: true });
    } catch {
        const err = new Error(`Unable to resolve hostname: ${hostname}`);
        err.statusCode = 502;
        throw err;
    }

    if (!Array.isArray(records) || records.length === 0) {
        const err = new Error(`No DNS records found for hostname: ${hostname}`);
        err.statusCode = 502;
        throw err;
    }

    for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) {
            const err = new Error(`Blocked private/reserved target IP (${rec.address}) for hostname: ${hostname}`);
            err.statusCode = 403;
            throw err;
        }
    }

    return parsed;
}

/**
 * Performs an axios GET request while validating the initial URL and every
 * HTTP 3xx redirect target against SSRF/private-IP rules.
 */
export async function safeAxiosGet(axiosInstance, initialUrl, axiosConfig = {}, { allowedHosts = [], maxRedirects = 5 } = {}) {
    let currentUrl = initialUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        await assertSafeExternalUrl(currentUrl, { allowedHosts });
        const response = await axiosInstance.get(currentUrl, {
            ...axiosConfig,
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400
        });
        if (response.status >= 300 && response.status < 400 && response.headers?.location) {
            if (hop === maxRedirects) {
                const err = new Error('Too many redirects');
                err.statusCode = 502;
                throw err;
            }
            currentUrl = new URL(response.headers.location, currentUrl).toString();
            continue;
        }
        return response;
    }
    const err = new Error('Too many redirects');
    err.statusCode = 502;
    throw err;
}

