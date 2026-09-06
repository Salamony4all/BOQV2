// jsonldVerifier.js — Phase 3: read product facts off any page (Architonic, Archiproducts, maker sites)
// All three page types publish schema.org/Product blocks. One reader fits all.
// Returns a clean product or null (never throws for page problems).
// Vercel-safe: global fetch (native in Node 18+ and Vercel), no browser dep.
import { load as cheerioLoad } from 'cheerio';

const TIMEOUT = 25000;

// ── URL cache ──────────────────────────────────────────────────────────────
// Avoid re-fetching the same product page within a batch (dedup across sitemap
// + Architonic sources). TTL = 24h, max entries = 1000.
const factCache = new Map(); // url -> { product, ts }
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;

function cacheGet(url) {
  const entry = factCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    factCache.delete(url);
    return null;
  }
  return entry.product;
}

function cacheSet(url, product) {
  if (factCache.size >= CACHE_MAX) {
    const oldest = factCache.keys().next().value;
    factCache.delete(oldest);
  }
  factCache.set(url, { product, ts: Date.now() });
}

function pickProductNode(json) {
  const nodes = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
    if (types.some((t) => String(t).toLowerCase() === 'product')) nodes.push(n);
    if (Array.isArray(n['@graph'])) n['@graph'].forEach(walk);
    Object.values(n).forEach((v) => { if (v && typeof v === 'object') walk(v); });
  };
  walk(json);
  // Richest node wins (most fields filled)
  nodes.sort((a, b) => Object.keys(b).length - Object.keys(a).length);
  return nodes[0] || null;
}

function firstString(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) { for (const x of v) { const s = firstString(x); if (s) return s; } return ''; }
  if (typeof v === 'object') return firstString(v.url || v.name || v.contentUrl);
  return '';
}

function breadcrumbTrail(json) {
  // BreadcrumbList on the same page tells us the shelf position (Furniture > Seating > ...)
  const trail = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
    if (types.some((t) => String(t).toLowerCase() === 'breadcrumblist') && Array.isArray(n.itemListElement)) {
      n.itemListElement
        .slice()
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .forEach((li) => { const nm = firstString(li.name || li.item?.name); if (nm) trail.push(nm); });
    }
    Object.values(n).forEach((v) => { if (v && typeof v === 'object') walk(v); });
  };
  try { walk(json); } catch { /* keep what we have */ }
  return trail;
}

/**
 * Fetch a product page and pull its facts. { pageUrl } →
 * { ok, product: {model, brand, imageUrl, category, trail, officialProductUrl, source} } or { ok:false, reason }
 */
export async function fetchProductFacts(pageUrl) {
  // 1) Check URL cache first
  const cached = cacheGet(pageUrl);
  if (cached) return { ok: true, product: cached };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const html = await res.text();
    const $ = cheerioLoad(html);
    const blocks = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try { blocks.push(JSON.parse($(el).text())); } catch { /* broken block */ }
    });
    if (blocks.length === 0) {
      // No structured data at all (common on Sitecore/custom maker pages) —
      // fall through to the Open Graph / H1 reader below.
    }
    const node = blocks.length > 0 ? pickProductNode(blocks) : null;
    if (!node) {
      // Fallback: many maker pages (Sitecore et al.) ship zero JSON-LD.
      // Open Graph + first H1 + breadcrumb nav still identify the product.
      const ogTitle = ($('meta[property="og:title"]').attr('content') || '').trim();
      const ogImage = ($('meta[property="og:image"]').attr('content') || '').trim();
      const h1 = ($('h1').first().text() || '').trim().replace(/\s+/g, ' ');
      const crumbs = [];
      $('nav[aria-label*="bread" i] a, nav.breadcrumb a, ol.breadcrumb li, ul.breadcrumb li').each((_, el) => {
        const t = ($(el).text() || '').trim().replace(/\s+/g, ' ');
        if (t && t.length > 1 && !/^home$/i.test(t)) crumbs.push(t);
      });
      const model = ogTitle || h1;
      if (!model || model.length < 3) return { ok: false, reason: 'no-product-node' };
      // Image: OG first, else the selected gallery image / largest content photo
      let fbImg = ogImage;
      if (!fbImg) {
        const picked = $('img.pds-slider__image--selected, img[class*="gallery"]--selected, main img').filter((_, el) => {
          const s = ($(el).attr('src') || '').toLowerCase();
          if (!s || s.includes('logo') || s.includes('icon') || s.endsWith('.svg')) return false;
          const w = parseInt($(el).attr('width') || '0', 10);
          return w === 0 || w >= 250; // unknown size kept, tiny thumbs dropped
        }).first();
        fbImg = $(picked).attr('src') || '';
        if (fbImg && !fbImg.startsWith('http')) {
          try { fbImg = new URL(fbImg, pageUrl).toString(); } catch { fbImg = ''; }
        }
      }
      // Category: breadcrumb tail, else URL shelf below the finder/listing level
      let fbCat = crumbs.length >= 1 ? crumbs[crumbs.length - 1] : '';
      if (!fbCat) {
        try {
          const segs = new URL(pageUrl).pathname.split('/').filter(Boolean)
            .filter((s) => !/^(de-de|de|en|en-us|fr|it|es|nl|produkt-finder|product-finder|finder|collections?|kollektion)$/i.test(s));
          fbCat = (segs[0] || '').replace(/[-_]/g, ' ');
        } catch { /* no category */ }
      }
      const result = {
        ok: true,
        via: 'og',
        product: {
          model: model.split(/ [|–—-] /)[0].trim(),
          brand: '',
          imageUrl: fbImg,
          category: fbCat,
          trail: crumbs,
          officialProductUrl: pageUrl,
          source: `og:${hostOf(pageUrl)}`
        }
      };
      cacheSet(pageUrl, result.product);
      return result;
    }
    const trail = breadcrumbTrail(blocks);
    const brand = firstString(node.brand) || '';
    const rawCat = firstString(node.category);
    const modelName = firstString(node.name);
    // Shelf = trail's parent (Home > WC > product → "WC"); node.category often echoes the name
    const category = (rawCat && rawCat !== modelName) ? rawCat
      : (trail.length >= 2 ? trail[trail.length - 2] : (trail[0] || ''));
    const result = {
      ok: true,
      via: 'jsonld',
      product: {
        model: modelName,
        brand,
        imageUrl: firstString(node.image),
        category,
        trail,
        officialProductUrl: pageUrl,
        source: `jsonld:${hostOf(pageUrl)}`
      }
    };
    cacheSet(pageUrl, result.product);
    return result;
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : String(e.message).slice(0, 80) };
  } finally { clearTimeout(t); }
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
