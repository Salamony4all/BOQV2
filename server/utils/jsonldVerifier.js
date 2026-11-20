// jsonldVerifier.js — Phase 3: read product facts off any page (Architonic, Archiproducts, maker sites)
// All three page types publish schema.org/Product blocks. One reader fits all.
// Returns a clean product or null (never throws for page problems).
// Vercel-safe: global fetch (native in Node 18+ and Vercel), no browser dep.
import { load as cheerioLoad } from 'cheerio';

const TIMEOUT = 15000;

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

function cleanText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveImgUrl(src, baseUrl) {
  if (!src || typeof src !== 'string') return '';
  const s = src.trim();
  if (!s || s.startsWith('data:')) return '';
  try { return new URL(s, baseUrl).toString(); } catch { return ''; }
}

function isBadProductImage(url) {
  if (!url) return true;
  const low = url.toLowerCase();
  return /logo|favicon|icon|avatar|pixel|spinner|placeholder|badge|\.svg(\?|$)/i.test(low);
}

function extractBestImage($, pageUrl, jsonLdImg = '') {
  const ogImg = resolveImgUrl(
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('meta[property="twitter:image"]').attr('content') ||
    $('link[rel="image_src"]').attr('href'),
    pageUrl
  );
  const ldResolved = resolveImgUrl(jsonLdImg, pageUrl);

  // Prefer og:image when JSON-LD uses a smaller PrestaShop home_default/medium thumbnail
  if (ogImg && !isBadProductImage(ogImg)) {
    if (!ldResolved || /home_default|medium_default|small_default/i.test(ldResolved)) {
      return ogImg;
    }
  }
  if (ldResolved && !isBadProductImage(ldResolved)) return ldResolved;

  const galleryImgs = $(
    '.product-cover img, .js-qv-product-cover, img.wp-post-image, .woocommerce-product-gallery__image img, ' +
    '.product-images img, .product-gallery img, img.pds-slider__image--selected, img[class*="gallery"]--selected, ' +
    '.field--name-field-image img, .field--type-image img, .swiper-slide img, .carousel-item img, .slick-slide img, ' +
    '[itemprop="image"], main img, article img, img[src*="/sites/default/files/"], img[src*="/wp-content/uploads/"]'
  );
  for (let i = 0; i < galleryImgs.length; i++) {
    const el = galleryImgs[i];
    const w = parseInt($(el).attr('width') || '0', 10);
    if (w > 0 && w < 180) continue;
    const raw = $(el).attr('data-large_image') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('src');
    const resolved = resolveImgUrl(raw, pageUrl);
    if (resolved && !isBadProductImage(resolved)) return resolved;
  }
  return ogImg || ldResolved || '';
}

function isFooterOrBoilerplateDesc(text = '') {
  const t = String(text || '').trim();
  if (!t) return true;
  return /^(?:©|copyright)\s*\d{4}/i.test(t)
    || /legal\s*statement\s*privacy\s*policy|privacy\s*policy\s*disclaimer|back\s*to\s*top|all\s*rights\s*reserved|cookie\s*policy/i.test(t);
}

function extractDescription($, node = null) {
  const candidates = [
    cleanText(node?.description),
    cleanText($('.woocommerce-product-details__short-description, .product-short-description, #product-description-short, [itemprop="description"]').first().text()),
    cleanText($('.product-description, .description-short, .product-info-description, .field--name-body, .product-detail p, .entry-content p').first().text()),
    cleanText($('meta[property="og:description"]').attr('content')),
    cleanText($('meta[name="description"]').attr('content'))
  ].filter(c => c && !isFooterOrBoilerplateDesc(c));

  // Pick richest non-trivial snippet without repeating title-only stubs
  const substantive = candidates.find(c => c.length >= 40);
  if (substantive) return substantive;
  // Last resort: first substantive paragraph inside main/article
  let paraFallback = '';
  $('main p, article p').each((_, el) => {
    if (paraFallback) return;
    const t = cleanText($(el).text());
    if (t.length >= 45 && !isFooterOrBoilerplateDesc(t) && !/cookie|privacy|all rights reserved|newsletter/i.test(t)) {
      paraFallback = t;
    }
  });
  return paraFallback || candidates[0] || '';
}

function parseNumericPrice(val) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val !== 'string') return 0;
  const m = val.replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/);
  return m ? (parseFloat(m[0]) || 0) : 0;
}

function detectCurrency(text = '') {
  const s = String(text).toUpperCase();
  if (/\bAED\b|د\.إ/.test(s)) return 'AED';
  if (/\bOMR\b/.test(s)) return 'OMR';
  if (/\bSAR\b/.test(s)) return 'SAR';
  if (/\bEUR\b|€/.test(s)) return 'EUR';
  if (/\bGBP\b|£/.test(s)) return 'GBP';
  if (/\bUSD\b|\$/.test(s)) return 'USD';
  return '';
}

function extractOffer($, node = null) {
  const offers = node?.offers ? (Array.isArray(node.offers) ? node.offers : [node.offers]) : [];
  for (const off of offers) {
    if (!off || typeof off !== 'object') continue;
    const p = parseNumericPrice(off.price ?? off.lowPrice);
    if (p > 0) {
      return { price: p, currency: String(off.priceCurrency || '').trim().toUpperCase() || 'USD' };
    }
  }
  const metaAmt = parseNumericPrice($('meta[property="product:price:amount"]').attr('content'));
  const metaCurr = String($('meta[property="product:price:currency"]').attr('content') || '').trim().toUpperCase();
  if (metaAmt > 0) return { price: metaAmt, currency: metaCurr || 'USD' };

  const domPriceEl = $('.current-price [itemprop="price"], [itemprop="price"], .current-price-value, .summary .price .woocommerce-Price-amount, .product-price .price, .product-price').first();
  const rawDom = (domPriceEl.attr('content') || domPriceEl.text() || '').trim();
  const domAmt = parseNumericPrice(rawDom);
  if (domAmt > 0) {
    return { price: domAmt, currency: metaCurr || detectCurrency(domPriceEl.text()) || 'USD' };
  }
  return { price: 0, currency: metaCurr || '' };
}

/**
 * Fetch a product page and pull its facts. { pageUrl } ->
 * { ok, product: {model, brand, description, imageUrl, price, currency, category, trail, officialProductUrl, source} } or { ok:false, reason }
 */
export async function fetchProductFacts(pageUrl, opts = {}) {
  // 1) Check URL cache first
  const cached = cacheGet(pageUrl);
  if (cached) return { ok: true, product: cached };

  const timeoutMs = Number(opts?.timeoutMs) > 0 ? Number(opts.timeoutMs) : TIMEOUT;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
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
    const node = blocks.length > 0 ? pickProductNode(blocks) : null;
    const trail = breadcrumbTrail(blocks);
    const description = extractDescription($, node);
    const offer = extractOffer($, node);

    if (!node) {
      // Fallback: many maker pages (Sitecore et al.) ship zero JSON-LD.
      // Open Graph + first H1 + breadcrumb nav still identify the product.
      const ogTitle = cleanText($('meta[property="og:title"]').attr('content'));
      const ogSiteName = cleanText($('meta[property="og:site_name"]').attr('content')).toLowerCase();
      const pageTitle = cleanText($('title').text());
      const h1 = cleanText($('h1').first().text());
      const crumbs = [];
      $('nav[aria-label*="bread" i] a, nav.breadcrumb a, ol.breadcrumb li, ul.breadcrumb li').each((_, el) => {
        const textVal = cleanText($(el).text());
        if (textVal && textVal.length > 1 && !/^home$/i.test(textVal)) crumbs.push(textVal);
      });
      const cleanOg = ogTitle.split(/\s+[|–—-]\s+/)[0].trim();
      const cleanPageTitle = pageTitle.split(/\s+[|–—-]\s+/)[0].trim();
      const ogIsSiteOnly = ogSiteName && cleanOg.toLowerCase() === ogSiteName;
      const model = (!ogIsSiteOnly && cleanOg.length >= 2 ? cleanOg : '') || (h1.length >= 2 ? h1 : '') || cleanPageTitle;
      if (!model || model.length < 2) return { ok: false, reason: 'no-product-node' };

      const fbImg = extractBestImage($, pageUrl, '');
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
          description,
          imageUrl: fbImg,
          price: offer.price,
          currency: offer.currency || 'USD',
          category: fbCat,
          trail: crumbs,
          officialProductUrl: pageUrl,
          source: `og:${hostOf(pageUrl)}`
        }
      };
      cacheSet(pageUrl, result.product);
      return result;
    }

    const brand = firstString(node.brand) || '';
    const rawCat = firstString(node.category);
    const modelName = cleanText(firstString(node.name));
    // Shelf = trail's parent (Home > WC > product -> "WC"); node.category often echoes the name
    const category = (rawCat && rawCat !== modelName) ? rawCat
      : (trail.length >= 2 ? trail[trail.length - 2] : (trail[0] || ''));
    const imageUrl = extractBestImage($, pageUrl, firstString(node.image));
    const result = {
      ok: true,
      via: 'jsonld',
      product: {
        model: modelName,
        brand,
        description,
        imageUrl,
        price: offer.price,
        currency: offer.currency || 'USD',
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
