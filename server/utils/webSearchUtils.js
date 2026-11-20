/**
 * Lightweight zero-LLM web search & official domain discovery utilities.
 * Uses DuckDuckGo HTML endpoint (no API key, no browser dependency) with
 * in-memory caching and strict filtering of marketplaces/social directories.
 */

import { load as cheerioLoad } from 'cheerio';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SEARCH_TIMEOUT_MS = 6500;
const CACHE_TTL_MS = 30 * 60 * 1000;

const searchCache = new Map();
const originCache = new Map();

let ddgQueueTail = Promise.resolve();
let lastDdgCallTs = 0;
const DDG_MIN_GAP_MS = 700;

function enqueueDdgFetch(fn) {
    const run = ddgQueueTail.then(async () => {
        const wait = Math.max(0, DDG_MIN_GAP_MS - (Date.now() - lastDdgCallTs));
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastDdgCallTs = Date.now();
        return fn();
    });
    ddgQueueTail = run.catch(() => {});
    return run;
}

const NON_OFFICIAL_HOSTS = /(^|\.)(duckduckgo|google|bing|yahoo|facebook|instagram|linkedin|pinterest|youtube|tiktok|twitter|x|wikipedia|wikidata|amazon|noon|ebay|alibaba|aliexpress|made-in-china|dhgate|indiamart|tradeindia|globalsources|ubuy|desertcart|wayfair|etsy|houzz|archdaily|dezeen|archiproducts|architonic|archilovers|bimobject|3dwarehouse|yelp|yellowpages|dnb|zoominfo|crunchbase|bloomberg|opencorporates|reddit|quora|medium|scribd|issuu|yumpu|slideshare|fliphtml5|pdfdrive)\.[a-z.]+$/i;

export function isNonOfficialHost(hostname = '') {
    const h = String(hostname || '').toLowerCase().replace(/^www\./, '');
    if (!h) return true;
    return NON_OFFICIAL_HOSTS.test(h);
}

/**
 * Search DuckDuckGo HTML endpoint for live URLs without requiring any LLM/API quota.
 * Returns [{ title, url, snippet, hostname }].
 */
export async function searchWebHtml(query, limit = 6) {
    const q = String(query || '').trim();
    if (!q) return [];

    const cacheKey = `${q.toLowerCase()}::${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
        return cached.results;
    }

    return enqueueDdgFetch(async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
        try {
            const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
                signal: ctrl.signal,
                redirect: 'follow',
                headers: {
                    'User-Agent': BROWSER_UA,
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            if (!res.ok) return [];
            const html = await res.text();
            const $ = cheerioLoad(html);
            const results = [];
            const seen = new Set();

            $('.result').each((_, el) => {
                const linkEl = $(el).find('.result__a').first();
                let href = linkEl.attr('href') || '';
                const uddg = href.match(/uddg=([^&]+)/);
                if (uddg) {
                    try { href = decodeURIComponent(uddg[1]); } catch { /* keep raw */ }
                }
                if (!/^https?:\/\//i.test(href)) return;
                let hostname = '';
                try { hostname = new URL(href).hostname.replace(/^www\./, '').toLowerCase(); } catch { return; }
                if (seen.has(href)) return;
                seen.add(href);

                const title = linkEl.text().replace(/\s+/g, ' ').trim();
                const snippet = $(el).find('.result__snippet').first().text().replace(/\s+/g, ' ').trim();
                results.push({ title, url: href, snippet, hostname });
            });

            const trimmed = results.slice(0, limit);
            if (trimmed.length > 0) {
                if (searchCache.size >= 400) searchCache.delete(searchCache.keys().next().value);
                searchCache.set(cacheKey, { results: trimmed, ts: Date.now() });
            }
            return trimmed;
        } catch {
            return [];
        } finally {
            clearTimeout(timer);
        }
    });
}

async function probeDirectDomain(url, brandTokens) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3200);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            redirect: 'follow',
            headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' }
        });
        if (!res.ok) return '';
        const html = (await res.text()).slice(0, 18000).toLowerCase();
        const finalOrigin = new URL(res.url).origin;
        if (isNonOfficialHost(new URL(res.url).hostname)) return '';
        // Confirm page mentions brand AND has commercial/furniture/carpet/design/product relevance
        const brandHit = brandTokens.some(t => html.includes(t));
        const domainRelevant = /(furniture|chair|sofa|table|desk|carpet|tile|seating|outdoor|lighting|product|collection|design|interior|contract|office|bespoke)/i.test(html);
        if (brandHit && domainRelevant) return finalOrigin;
        return '';
    } catch {
        return '';
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Dynamically discovers the official manufacturer origin (e.g. "https://www.tuntex-carpet.com")
 * for any contract brand name via direct domain probe + live web search (zero-LLM, cached).
 */
export async function discoverOfficialOriginViaWeb(brandName, categoryHint = '') {
    const cleanBrand = String(brandName || '').trim();
    if (!cleanBrand || cleanBrand.length < 2) return '';

    const key = cleanBrand.toLowerCase();
    const cached = originCache.get(key);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
        return cached.origin;
    }

    const brandTokens = cleanBrand
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 2 && !/^(furniture|design|group|inc|ltd|llc|co|corp|studio|contract|systems?|international)$/i.test(t));

    // Step 1: Fast direct domain probe (zero search-engine usage: finds sancrea.com, kzbespoke.com, etc. in <400ms)
    const compactSlug = cleanBrand.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dashSlug = cleanBrand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (compactSlug.length >= 4 && brandTokens.length > 0) {
        const isCarpetHint = /\b(carpet|floor|tile|rug)\b/i.test(categoryHint);
        const directCandidates = [...new Set([
            `https://www.${compactSlug}.com`,
            `https://${compactSlug}.com`,
            dashSlug !== compactSlug ? `https://www.${dashSlug}.com` : '',
            isCarpetHint ? `https://www.${compactSlug}-carpet.com` : '',
            isCarpetHint ? `https://www.${compactSlug}carpet.com` : ''
        ].filter(Boolean))];
        const probed = await Promise.all(directCandidates.map(u => probeDirectDomain(u, brandTokens)));
        const directHit = probed.find(Boolean);
        if (directHit) {
            if (originCache.size >= 300) originCache.delete(originCache.keys().next().value);
            originCache.set(key, { origin: directHit, ts: Date.now() });
            return directHit;
        }
    }

    const hintWords = /carpet|floor|tile/i.test(categoryHint)
        ? 'carpet flooring official website'
        : 'furniture official website';

    const hits = await searchWebHtml(`"${cleanBrand}" ${hintWords}`, 8);
    let bestOrigin = '';
    let bestScore = -1;

    for (const h of hits) {
        if (!h.url || /\.pdf(\?|$)/i.test(h.url) || isNonOfficialHost(h.hostname)) continue;
        const hostLow = h.hostname.toLowerCase();
        const titleLow = `${h.title} ${h.snippet}`.toLowerCase();
        let score = 0;

        for (const tok of brandTokens) {
            if (hostLow.includes(tok)) score += 40;
            if (titleLow.includes(tok)) score += 15;
        }
        if (score === 0) continue; // Host & title don't even mention the brand

        // Prefer root/English pages over deep random dealer pages
        try {
            const u = new URL(h.url);
            if (u.pathname === '/' || /^\/(en|en-us|home)\/?$/i.test(u.pathname)) score += 15;
            if (/official|manufacturer|products|collections/i.test(titleLow)) score += 10;
            // Penalize obvious multi-brand regional retailers/dealers
            if (/\/brands?\/|\/shop\/|\/collections\/vendors/i.test(u.pathname)) score -= 25;

            if (score > bestScore) {
                bestScore = score;
                bestOrigin = u.origin;
            }
        } catch { /* ignore */ }
    }

    const resolved = bestScore >= 40 ? bestOrigin : '';
    if (originCache.size >= 300) originCache.delete(originCache.keys().next().value);
    originCache.set(key, { origin: resolved, ts: Date.now() });
    return resolved;
}
