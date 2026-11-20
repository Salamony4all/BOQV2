/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Live Official-Site Product Discovery & Verification Engine             │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Discovers authentic product descriptions, photos, pricing, and URLs directly
 * from official manufacturer websites (JSON-LD, OpenGraph, site search,
 * sitemaps) with Google-Search-grounded AI fallback.
 */

import { load as cheerioLoad } from 'cheerio';
import { fetchProductFacts } from './jsonldVerifier.js';
import { fetchLiveProductImage, verifyImageUrl } from './veImageEnricher.js';
import { locsFromSitemap } from './brandEnricher.js';
import { getCanonicalBrandWebsite } from './brandLogos.js';
import { callGoogle, GROUNDING_MODEL } from './llmUtils.js';
import { isMarketplaceUrl } from './veAutoDetectUtils.js';
import { discoverOfficialOriginViaWeb, searchWebHtml } from './webSearchUtils.js';

const FETCH_TIMEOUT_MS = 4500;
const FACT_TIMEOUT_MS = 8500;
const GROUNDED_TIMEOUT_MS = 11000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const searchTemplateCache = new Map(); // origin -> { templates, ts }
const sitemapCache = new Map();        // origin -> { urls, ts }
const sitemapInflight = new Map();     // origin -> Promise<string[]>

function withTimeout(promise, ms, fallback = null) {
    let timer;
    return Promise.race([
        Promise.resolve(promise).catch(() => fallback),
        new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })
    ]).finally(() => clearTimeout(timer));
}

const STOP_WORDS = new Set(['with', 'for', 'and', 'the', 'from', 'size', 'unit', 'nos', 'pcs', 'set', 'qty', 'code', 'model', 'brand', 'maker', 'type', 'mm', 'cm']);

/**
 * Extracts a clean product title from a noisy BOQ row description.
 * Strips location prefixes, pipe-separated metadata, bullets, and dimensions.
 */
export function extractProductTitleHint(description = '', fallbackModel = '') {
    if (!description || typeof description !== 'string') return String(fallbackModel || '').trim();
    let s = description
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/https?:\/\/\S+/gi, ' ');

    const segments = s.split(/\s*\|\s*|\r?\n|•/);
    const cleanSegments = segments
        .map(seg => seg.trim())
        .filter(seg => seg.length > 2 && !/^(qty|unit|uom|size|code|product\s*code|item\s*code|model|item\s*model|brand|maker|manufacturer|supplier|ref|finish|finishes)\s*:/i.test(seg));

    let lead = cleanSegments[0] || '';
    lead = lead
        .replace(/\(\s*\d{2,4}\s*[wWdDhHlL]?\s*[xX*×]\s*\d{2,4}[^)]*\)/g, ' ')
        .replace(/\b\d{3,4}\s*[xX*×]\s*\d{3,4}(?:\s*[xX*×]\s*\d{3,4})?\s*(?:mm|cm)?\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (lead.length >= 4 && lead.length <= 100) return lead;
    if (lead.length > 100) return lead.slice(0, 90).replace(/\s+\S*$/, '').trim();
    return String(fallbackModel || '').trim();
}

function tokenize(text = '') {
    return String(text || '')
        .toLowerCase()
        .replace(/https?:\/\/[^/]+/, '')
        .split(/[^a-z0-9]+/)
        .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

function sameSiteHost(urlA, urlB) {
    try {
        const hA = new URL(urlA).hostname.replace(/^www\./i, '').toLowerCase();
        const hB = new URL(urlB).hostname.replace(/^www\./i, '').toLowerCase();
        return Boolean(hA && hA === hB);
    } catch {
        return false;
    }
}

function normalizeCandidateUrl(rawHref, origin) {
    try {
        const u = new URL(rawHref, origin);
        if (!sameSiteHost(u.toString(), origin)) return '';
        const targetProto = origin.startsWith('https://') ? 'https:' : u.protocol;
        const targetHost = new URL(origin).hostname;
        let clean = `${targetProto}//${targetHost}${u.pathname}${u.searchParams.get('product') ? `?product=${u.searchParams.get('product')}` : ''}`;
        clean = clean.split('#/')[0].replace(/\/+$/, '') || origin;
        return clean;
    } catch {
        return '';
    }
}

function isDeepProductUrl(urlStr) {
    if (!urlStr || !/^https?:\/\//i.test(urlStr)) return false;
    try {
        const u = new URL(urlStr);
        const path = u.pathname.replace(/\/+$/, '');
        return path.length > 1 && !/^\/(home|index|products|search|cart|checkout|contact|about|login)$/i.test(path);
    } catch {
        return false;
    }
}

function isLikelyNonProductPath(urlStr) {
    return /(\/cart|\/checkout|\/login|\/my-account|\/wishlist|\/contact|\/about|\/privacy|\/terms|\/blog|\/news|\/tag\/|\/category\/|controller=authentication|controller=cart|\.(pdf|jpe?g|png|webp|svg)$)/i.test(urlStr);
}

/**
 * Resolves the canonical manufacturer origin and any explicit deep product URL.
 */
export function resolveOfficialSite(brand, directUrl = '', localBrand = null) {
    let directProductUrl = '';
    let origin = '';

    const isAggregatorOrMarketplace = (u = '') => !u || isMarketplaceUrl(u) || /(^|\.)architonic\.com$/i.test((() => { try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname; } catch { return ''; } })());

    if (directUrl && /^https?:\/\//i.test(directUrl) && !isMarketplaceUrl(directUrl)) {
        try {
            const u = new URL(directUrl);
            if (!isAggregatorOrMarketplace(directUrl)) {
                origin = u.origin;
            }
            if (isDeepProductUrl(directUrl)) {
                directProductUrl = directUrl.split('#/')[0];
            }
        } catch { /* ignore */ }
    }

    if (!origin && brand) {
        const known = getCanonicalBrandWebsite(brand);
        if (known && !isAggregatorOrMarketplace(known)) {
            try { origin = new URL(known).origin; } catch { /* ignore */ }
        }
    }

    if (!origin && localBrand) {
        const domainCand = localBrand.websiteUrl || localBrand.url || (localBrand.registry?.officialDomain ? `https://${localBrand.registry.officialDomain}` : '');
        const prodCand = (localBrand.products || []).find(p => {
            const pu = p?.officialProductUrl || p?.websiteUrl || '';
            return pu && !isAggregatorOrMarketplace(pu);
        });
        const candUrl = (!isAggregatorOrMarketplace(domainCand) ? domainCand : '') || prodCand?.officialProductUrl || prodCand?.websiteUrl || '';
        if (candUrl) {
            try { origin = new URL(candUrl.startsWith('http') ? candUrl : `https://${candUrl}`).origin; } catch { /* ignore */ }
        }
    }

    return { origin, directProductUrl };
}

async function fetchHtmlWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': BROWSER_UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function getSiteSearchTemplates(origin) {
    const cached = searchTemplateCache.get(origin);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.templates;

    const templates = [];
    const html = await fetchHtmlWithTimeout(origin, 5000);
    if (html) {
        try {
            const $ = cheerioLoad(html);
            // 1. Schema.org SearchAction potentialAction target
            $('script[type="application/ld+json"]').each((_, el) => {
                try {
                    const data = JSON.parse($(el).text());
                    const nodes = Array.isArray(data) ? data : [data];
                    for (const n of nodes) {
                        const target = n?.potentialAction?.target?.urlTemplate || n?.potentialAction?.target;
                        if (typeof target === 'string' && target.includes('{search_term_string}')) {
                            templates.push(new URL(target, origin).toString());
                        }
                    }
                } catch { /* ignore invalid JSON-LD */ }
            });
            // 2. Storefront <form> search input
            $('form').each((_, form) => {
                const action = $(form).attr('action') || origin;
                const input = $(form).find('input[name="s"], input[name="q"], input[name="search_query"], input[name="keyword"]').first();
                const paramName = input.attr('name');
                if (paramName) {
                    try {
                        const u = new URL(action, origin);
                        if (u.origin === origin) {
                            templates.push(`${u.origin}${u.pathname}?${paramName}={search_term_string}`);
                        }
                    } catch { /* ignore */ }
                }
            });
        } catch { /* ignore parse failure */ }
    }

    // Common fallback storefront search routes (PrestaShop, WordPress/WooCommerce, Shopify)
    templates.push(
        `${origin}/search?controller=search&s={search_term_string}`,
        `${origin}/?s={search_term_string}`,
        `${origin}/search?q={search_term_string}`
    );

    const unique = [...new Set(templates)].slice(0, 4);
    searchTemplateCache.set(origin, { templates: unique, ts: Date.now() });
    return unique;
}

async function getCachedSitemapUrls(origin) {
    const cached = sitemapCache.get(origin);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.urls;
    if (sitemapInflight.has(origin)) return sitemapInflight.get(origin);

    const work = (async () => {
        const candidates = [];
        const robots = await fetchHtmlWithTimeout(`${origin}/robots.txt`, 3000);
        if (robots) {
            for (const m of robots.matchAll(/^sitemap:\s*(\S+)/gim)) candidates.push(m[1].trim());
        }
        candidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/1_index_sitemap.xml`);

        const rootXmls = await Promise.all([...new Set(candidates)].map(u => fetchHtmlWithTimeout(u, 3500)));
        let allUrls = [];
        for (const xml of rootXmls) {
            if (!xml || !xml.includes('<loc>')) continue;
            const locs = locsFromSitemap(xml);
            if (locs.length > 0 && locs.every(u => /\.xml(\?|$)/i.test(u))) {
                const productOnly = locs.filter(u => /product(?!category)/i.test(u));
                const chosen = productOnly.length > 0
                    ? productOnly.slice(0, 4)
                    : locs.sort((a, b) => (/product/i.test(b) ? 1 : 0) - (/product/i.test(a) ? 1 : 0)).slice(0, 3);
                const normalizedChildUrls = chosen.map(u => {
                    try {
                        const parsed = new URL(u);
                        if (origin.startsWith('https://') && parsed.protocol === 'http:' && sameSiteHost(u, origin)) {
                            parsed.protocol = 'https:';
                        }
                        return parsed.toString();
                    } catch { return u; }
                });
                const childXmls = await Promise.all(normalizedChildUrls.map(u => fetchHtmlWithTimeout(u, 9000)));
                for (const childXml of childXmls) {
                    if (childXml) allUrls.push(...locsFromSitemap(childXml));
                }
            } else {
                allUrls = locs;
            }
            if (allUrls.length > 0) break;
        }

        const NON_EN_LOCALE_RE = /\/(lt|de|fr|es|it|pl|ru|lv|ee|no|se|da|fi|nl|cs|hu|ro|bg|hr|sk|sl|uk|ar|zh|ja|ko|tr|pt|sv)\//i;
        const rawNorm = allUrls
            .map(u => normalizeCandidateUrl(u, origin))
            .filter(u => u && !isLikelyNonProductPath(u));
        const englishPreferred = rawNorm.filter(u => !NON_EN_LOCALE_RE.test(u));
        const deduped = [...new Set(englishPreferred.length >= 5 ? englishPreferred : rawNorm)];
        sitemapCache.set(origin, { urls: deduped, ts: Date.now() });
        return deduped;
    })().finally(() => {
        sitemapInflight.delete(origin);
    });

    sitemapInflight.set(origin, work);
    return work;
}

function scoreCandidate(url, labelText, queryTokens) {
    if (!url || queryTokens.length === 0) return 0;
    const urlSlug = url.replace(/^https?:\/\/[^/]+/, '').toLowerCase();
    const compactSlug = urlSlug.replace(/[^a-z0-9]/g, '');
    const combined = `${labelText || ''} ${urlSlug}`.toLowerCase();
    const compactQuery = queryTokens.join('');
    let hits = 0;
    let slugHits = 0;
    for (const tok of queryTokens) {
        if (combined.includes(tok)) hits++;
        if (urlSlug.includes(tok)) slugHits++;
    }
    const lastSeg = urlSlug.split('/').filter(Boolean).pop() || '';
    const lastSegCompact = lastSeg.replace(/[^a-z0-9]/g, '');
    // Match joined compound slugs like "flip top" <-> "/fliptop/" or "flip-top"
    if (compactQuery.length >= 4 && (lastSegCompact === compactQuery || compactSlug.includes(compactQuery))) {
        return lastSegCompact === compactQuery ? 1.0 : 0.88;
    }
    if (hits === 0) return 0;
    const ratio = hits / queryTokens.length;
    const slugBonus = slugHits / queryTokens.length;
    return ratio * 0.65 + slugBonus * 0.35;
}

async function collectSearchResultCandidates(origin, query) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const candidateMap = new Map(); // cleanUrl -> { url, score }

    // 1. Check cached official product sitemap FIRST (fast, exact, zero search-template flakiness)
    const sitemapUrls = await getCachedSitemapUrls(origin);
    for (const u of sitemapUrls) {
        const clean = normalizeCandidateUrl(u, origin);
        if (!clean || !isDeepProductUrl(clean)) continue;
        const score = scoreCandidate(clean, '', queryTokens);
        if (score >= 0.5) {
            const prev = candidateMap.get(clean);
            if (!prev || score > prev.score) candidateMap.set(clean, { url: clean, score });
        }
    }

    const bestSitemapScore = Math.max(0, ...Array.from(candidateMap.values()).map(c => c.score));

    // 2. Storefront search routes only if sitemap did not yield a high-confidence hit
    if (bestSitemapScore < 0.72) {
        const templates = await getSiteSearchTemplates(origin);
        const pages = await Promise.all(templates.map(tpl => {
            const searchUrl = tpl.replace('{search_term_string}', encodeURIComponent(query));
            return fetchHtmlWithTimeout(searchUrl, FETCH_TIMEOUT_MS);
        }));

        for (const html of pages) {
            if (!html) continue;

            if (html.trim().startsWith('{')) {
                try {
                    const json = JSON.parse(html);
                    const list = json.products || json.results || json.resources?.results?.products || [];
                    for (const item of (Array.isArray(list) ? list : [])) {
                        const clean = normalizeCandidateUrl(item.link || item.url || '', origin);
                        const label = item.name || item.title || '';
                        if (!clean || !isDeepProductUrl(clean) || isLikelyNonProductPath(clean)) continue;
                        const score = scoreCandidate(clean, label, queryTokens);
                        if (score > 0.3) {
                            const prev = candidateMap.get(clean);
                            if (!prev || score > prev.score) candidateMap.set(clean, { url: clean, score });
                        }
                    }
                } catch { /* fall through */ }
                if (candidateMap.size > 0) break;
                continue;
            }

            const $ = cheerioLoad(html);
            $('header, footer, nav, .menu, .breadcrumb').remove();
            const links = $('.product-title a, .product-miniature a, .products a, .search-results a, article a, main a, h2 a, h3 a');
            links.each((_, el) => {
                const href = $(el).attr('href');
                const clean = normalizeCandidateUrl(href, origin);
                if (!clean || !isDeepProductUrl(clean) || isLikelyNonProductPath(clean)) return;
                const text = $(el).text().trim() || $(el).closest('.product-miniature, article, li').find('h2, h3, .product-title').first().text().trim();
                const score = scoreCandidate(clean, text, queryTokens);
                if (score > 0.3) {
                    const prev = candidateMap.get(clean);
                    if (!prev || score > prev.score) candidateMap.set(clean, { url: clean, score });
                }
            });
            if (candidateMap.size > 0) break;
        }
    }

    // 3. Last-mile direct product-slug probe on official manufacturer sites
    if (candidateMap.size === 0) {
        const slug = String(query || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (slug.length >= 3) {
            const directSlugUrls = [
                `${origin}/en/product/${slug}`,
                `${origin}/product/${slug}`,
                `${origin}/en/products/${slug}`,
                `${origin}/products/${slug}`
            ];
            return directSlugUrls.map(url => ({ url, score: 0.7 }));
        }
    }

    return Array.from(candidateMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
}

function scoreScrapedFactsForBoq(product, boqDescription = '', queryTokens = []) {
    if (!product) return 0;
    const text = `${product.model || ''} ${product.description || ''} ${product.category || ''} ${product.officialProductUrl || ''}`.toLowerCase();
    let score = 0;

    for (const tok of queryTokens) {
        if (text.includes(tok)) score += 3;
    }

    const boqTokens = tokenize(boqDescription).slice(0, 12);
    for (const bt of boqTokens) {
        if (text.includes(bt)) score += 1.5;
    }

    // Typology alignment boost (e.g. task chair vs lounge chair vs executive chair within same series like North Cape)
    const boqLow = String(boqDescription || '').toLowerCase();
    const TYPOLOGY_PAIRS = [
        [/\b(task|staff|operator|swivel|ergonomic)\b/, /\b(task|staff|operator|swivel|ergonomic)\b/],
        [/\b(executive|manager|director|ceo|head)\b/, /\b(executive|manager|director)\b/],
        [/\b(visitor|guest|meeting|conference)\b/, /\b(visitor|guest|meeting|conference)\b/],
        [/\b(lounge|armchair|club|sofa|couch)\b/, /\b(lounge|armchair|sofa|soft)\b/],
        [/\b(bar\s*stool|high\s*chair|counter\s*stool)\b/, /\b(stool|high\s*chair)\b/],
        [/\b(coffee|side|low)\s*table\b/, /\b(coffee|side|low)\s*table\b/],
        [/\b(conference|meeting|boardroom)\s*table\b/, /\b(conference|meeting|boardroom)\b/]
    ];
    for (const [boqRe, pageRe] of TYPOLOGY_PAIRS) {
        if (boqRe.test(boqLow) && pageRe.test(text)) score += 4;
    }

    if (product.imageUrl && !/logo|favicon|\.svg(\?|$)/i.test(product.imageUrl)) score += 4;
    if (product.description && product.description.length >= 40) score += 2;
    if (parseFloat(product.price) > 0) score += 1;
    return score;
}

async function searchOfficialSite(origin, queries, brand, boqDescription = '') {
    for (const query of queries) {
        if (!query || query.length < 3) continue;
        const candidates = await collectSearchResultCandidates(origin, query);
        const queryTokens = tokenize(query);
        const top = candidates.slice(0, 3);
        if (top.length === 0) continue;

        const results = await Promise.all(top.map(c => fetchProductFacts(c.url, { timeoutMs: FACT_TIMEOUT_MS }).then(facts => ({ cand: c, facts }))));
        const compactQuery = queryTokens.join('');
        const matching = [];
        for (const { cand, facts } of results) {
            if (!facts.ok || !facts.product) continue;
            const pageText = `${facts.product.model || ''} ${facts.product.description || ''} ${cand.url}`.toLowerCase();
            const compactPage = pageText.replace(/[^a-z0-9]/g, '');
            const overlap = queryTokens.filter(t => pageText.includes(t)).length;
            const compactHit = compactQuery.length >= 4 && compactPage.includes(compactQuery);
            if (compactHit || overlap >= Math.min(2, queryTokens.length)) {
                matching.push({
                    product: facts.product,
                    rankScore: scoreScrapedFactsForBoq(facts.product, boqDescription, queryTokens) + (compactHit ? 6 : 0) + (cand.score || 0) * 3
                });
            }
        }
        if (matching.length > 0) {
            matching.sort((a, b) => b.rankScore - a.rankScore);
            return matching[0].product;
        }
    }
    return null;
}

async function groundedWebLookup({ brand, model, titleHint, officialOrigin, categoryHint, directUrl, providerModel }) {
    let domainHint = '';
    if (officialOrigin) {
        try { domainHint = new URL(officialOrigin).hostname.replace(/^www\./, ''); } catch { }
    }

    const system = `You are a commercial furniture specification researcher with live Google Search access.
Find the exact official product page URL, direct product image URL, authentic technical description, price, and currency.
Return ONLY valid JSON:
{
  "model": "Official Product Name",
  "description": "Verbatim or concise authentic product description from the manufacturer website",
  "websiteUrl": "https://...",
  "imageUrl": "https://...",
  "price": 0,
  "currency": "USD",
  "mainCategory": "Category",
  "subCategory": "Sub-Category"
}`;

    const searchSubject = titleHint && titleHint.toLowerCase() !== String(model || '').toLowerCase()
        ? `"${brand}" "${titleHint}" (BOQ code: ${model})`
        : `"${brand}" "${model || titleHint}"`;

    const user = `Find the official manufacturer product details for ${searchSubject}`
        + (domainHint ? ` on ${domainHint}` : '')
        + (categoryHint ? ` (Category: ${categoryHint})` : '')
        + (directUrl ? ` [Reference URL: ${directUrl}]` : '')
        + `. Return JSON only.`;

    try {
        const parsed = await withTimeout(
            callGoogle(system, user, true, providerModel || GROUNDING_MODEL),
            GROUNDED_TIMEOUT_MS,
            null
        );
        if (!parsed || typeof parsed !== 'object' || parsed.model === 'FAILED') return null;

        const candidateUrl = parsed.websiteUrl && /^https?:\/\//i.test(parsed.websiteUrl) ? parsed.websiteUrl : '';
        let scraped = null;
        if (candidateUrl && isDeepProductUrl(candidateUrl) && !isMarketplaceUrl(candidateUrl)) {
            const facts = await fetchProductFacts(candidateUrl, { timeoutMs: FACT_TIMEOUT_MS });
            if (facts.ok && facts.product) scraped = facts.product;
        }

        return {
            model: scraped?.model || parsed.model || model,
            description: scraped?.description || parsed.description || '',
            imageUrl: scraped?.imageUrl || parsed.imageUrl || '',
            price: scraped?.price || parseFloat(parsed.price) || 0,
            currency: scraped?.currency || parsed.currency || 'USD',
            websiteUrl: scraped?.officialProductUrl || candidateUrl || '',
            mainCategory: parsed.mainCategory || '',
            subCategory: parsed.subCategory || '',
            source: scraped ? 'grounded+scrape' : 'grounded-search'
        };
    } catch {
        return null;
    }
}

function isOpaqueSkuCode(model = '') {
    const m = String(model || '').trim();
    if (!m || m.length < 3) return true;
    // Separator + alphanumeric BOQ codes like "WS-FD-Y01", "SE:01", "LF-001" need the prose title hint
    return /^(?=.*\d)[a-z]{1,6}[-_:][a-z0-9\-_:]+$/i.test(m) && !/\s/.test(m);
}

/**
 * Resolves live official website product description, image, price, currency,
 * and product page URL for any identified manufacturer + BOQ specification.
 */
function extractSeriesRootQuery(model = '') {
    const clean = String(model || '')
        .replace(/\s*#\d+\s*$/, '')
        .replace(/\b(ii|iii|iv)\b/gi, ' ')
        .replace(/\b(conference|meeting|boardroom|coffee|side|low|high|standing|folding|training|office|executive|visitor|task|staff|lounge|acoustic|reception|modular|outdoor)\s*(tables?|desks?|chairs?|sofas?|armchairs?|screens?|furniture|cabinets?|lockers?|pedestals?|shelving|system|walls?|stools?|poufs?|benches?)\b/gi, ' ')
        .replace(/\b(tables?|desks?|chairs?|sofas?|armchairs?|screens?|furniture|cabinets?|lockers?|pedestals?|shelving|system|walls?|stools?|poufs?|benches?|head)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return clean.length >= 3 ? clean : '';
}

export async function enrichProductFromLiveWeb({
    brand,
    model = '',
    description = '',
    directUrl = '',
    localBrand = null,
    categoryHint = '',
    providerModel = null,
    skipLlm = false
}) {
    const cleanModelName = String(model || '').replace(/\s*#\d+\s*$/, '').trim();
    const seriesRoot = extractSeriesRootQuery(cleanModelName);
    const compactSeries = seriesRoot && seriesRoot.includes(' ') ? seriesRoot.replace(/\s+/g, '') : '';
    const useDescHint = isOpaqueSkuCode(cleanModelName) || (brand && description.toLowerCase().includes(brand.toLowerCase()));
    const titleHint = useDescHint ? extractProductTitleHint(description, cleanModelName) : cleanModelName;
    const hasArchitonicId = /#\d+\s*$/.test(String(model || ''));
    const queries = isOpaqueSkuCode(cleanModelName)
        ? [...new Set([titleHint, cleanModelName, seriesRoot, compactSeries, model].map(q => String(q || '').trim()).filter(q => q.length >= 3))]
        : (hasArchitonicId && seriesRoot)
            ? [...new Set([seriesRoot, compactSeries, cleanModelName, titleHint].map(q => String(q || '').trim()).filter(q => q.length >= 3))]
            : [...new Set([cleanModelName, seriesRoot, compactSeries, titleHint, model].map(q => String(q || '').trim()).filter(q => q.length >= 3))];
    let { origin, directProductUrl } = resolveOfficialSite(brand, directUrl, localBrand);

    // If official origin wasn't in our static map or localBrand, discover it dynamically without LLM
    if (!origin && brand && !/^(generic|unknown|local|custom|amazon|noon|ikea)$/i.test(String(brand).trim())) {
        origin = await withTimeout(discoverOfficialOriginViaWeb(brand, categoryHint), 5000, '') || '';
    }

    let enriched = null;
    let directFetchOk = false;

    // 1. Direct deep product URL passed in specification
    if (directProductUrl) {
        const directFacts = await fetchProductFacts(directProductUrl, { timeoutMs: FACT_TIMEOUT_MS });
        if (directFacts.ok && directFacts.product) {
            directFetchOk = true;
            enriched = directFacts.product;
        }
    }

    // 2. Search official site directly (skip if direct product page already loaded cleanly)
    if (!enriched && !directFetchOk && origin && queries.length > 0) {
        enriched = await withTimeout(searchOfficialSite(origin, queries, brand, description), 16000, null);
    }

    // 2b. Zero-LLM web discovery (official domain / Architonic page) if sitemap/search missed
    if ((!enriched || !enriched.imageUrl) && brand && (cleanModelName || seriesRoot)) {
        try {
            const domainHost = origin ? (() => { try { return new URL(origin).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';
            const webQ = domainHost
                ? `site:${domainHost} "${seriesRoot || cleanModelName}"`
                : `"${brand}" "${seriesRoot || cleanModelName}" (site:architonic.com/en/p/ OR furniture)`;
            const webHits = await withTimeout(searchWebHtml(webQ, 4), 5000, []);
            for (const hit of (webHits || [])) {
                if (!hit?.url || !isDeepProductUrl(hit.url) || isMarketplaceUrl(hit.url) || isLikelyNonProductPath(hit.url)) continue;
                const facts = await fetchProductFacts(hit.url, { timeoutMs: FACT_TIMEOUT_MS });
                if (facts.ok && facts.product && facts.product.imageUrl) {
                    const imgLive = await withTimeout(verifyImageUrl(facts.product.imageUrl, hit.url), 3000, false);
                    if (imgLive) {
                        enriched = {
                            ...(enriched || {}),
                            ...facts.product,
                            description: (enriched?.description && enriched.description.length >= 30) ? enriched.description : facts.product.description,
                            imageUrl: facts.product.imageUrl,
                            officialProductUrl: facts.product.officialProductUrl || hit.url,
                            source: facts.product.source || 'web-scrape'
                        };
                        break;
                    }
                }
            }
        } catch { /* continue */ }
    }

    // 3. Google-Search-grounded AI lookup if site search didn't find a full page (unless skipLlm)
    if (!skipLlm && (!enriched || !enriched.description || enriched.description.length < 30 || !enriched.imageUrl)) {
        const grounded = await groundedWebLookup({
            brand,
            model,
            titleHint,
            officialOrigin: origin,
            categoryHint,
            directUrl: directProductUrl || directUrl,
            providerModel
        });
        if (grounded) {
            enriched = {
                model: enriched?.model || grounded.model,
                description: (enriched?.description && enriched.description.length >= 30) ? enriched.description : grounded.description,
                imageUrl: enriched?.imageUrl || grounded.imageUrl,
                price: enriched?.price > 0 ? enriched.price : grounded.price,
                currency: enriched?.currency || grounded.currency,
                officialProductUrl: enriched?.officialProductUrl || grounded.websiteUrl,
                mainCategory: grounded.mainCategory || '',
                subCategory: grounded.subCategory || '',
                source: enriched ? `${enriched.source}+${grounded.source}` : grounded.source
            };
        }
    }

    const finalUrl = enriched?.officialProductUrl || directProductUrl || origin || '';
    let finalImage = enriched?.imageUrl || '';
    const badOrLogo = !finalImage || /logo|favicon|\.svg(\?|$)/i.test(finalImage);
    const verifiedImgOk = !badOrLogo && await withTimeout(verifyImageUrl(finalImage, finalUrl), 3000, false);
    if (!verifiedImgOk) {
        finalImage = await withTimeout(
            fetchLiveProductImage(brand, titleHint || model, isDeepProductUrl(finalUrl) ? finalUrl : ''),
            7000,
            ''
        ) || '';
    }

    return {
        titleHint,
        model: enriched?.model || model,
        description: enriched?.description || '',
        imageUrl: finalImage || '',
        price: parseFloat(enriched?.price) || 0,
        currency: enriched?.currency || 'USD',
        websiteUrl: finalUrl,
        mainCategory: enriched?.mainCategory || '',
        subCategory: enriched?.subCategory || '',
        source: enriched?.source || 'live-web'
    };
}
