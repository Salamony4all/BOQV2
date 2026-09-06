// brandEnricher.js — Phase 3: enrich a quarantined brand from its official site.
// Small maker sitemaps (hundreds of URLs) -> product-ish paths -> JSON-LD verify.
// No bulk crawl: runs only for brands your documents actually ask about.
// Vercel-safe: no browser deps, global fetch + cheerio, native to Node 18+.
import { fetchProductFacts } from './jsonldVerifier.js';

const TIMEOUT = 25000;
const MAX_PAGES = 8;
const REQUEST_DELAY = 1000; // 1s between requests -> polite, avoids rate limits
// Vercel serverless caps at 60s: keep the whole pass inside ~45s there.
const GLOBAL_TIMEOUT = process.env.VERCEL === '1' ? 45000 : 600000; // 45s on Vercel, 10 min local
// URL path hints that usually mean "a product page" (EN/DE/FR/IT/ES/NL)
const PRODUCT_HINT = /(product|produkt|produit|prodotto|producto|finder|collect|katalog|catalog|assort|gamma|serie|series|moebel|meuble|arredo|stoel|chair|table|tisch|taf|bank|bed|bett|lettino|sedia|stoelen|fauteuil)/i;
const SKIP_HINT = /(store-finder|blog|news|journal|press|career|job|contact|about|ueber-uns|impress|privacy|agb|faq|event|stor|dealer|handler|showroom|project|referenz|\.pdf|\.jpg|\.png)/i;
const pathDepth = (u) => { try { return new URL(u).pathname.split('/').filter(Boolean).length; } catch { return 0; } };

// Category sanity: product name contains furniture category keywords but subCategory doesn't match
const CATEGORY_KEYWORDS = {
  seating: ['chair', 'armchair', 'lounge', 'sofa', 'bench', 'stool', 'seat'],
  table: ['table', 'desk', 'dining', 'coffee', 'side table'],
  storage: ['cabinet', 'shelf', 'wardrobe', 'drawer', 'cupboard', 'bookcase'],
  lighting: ['lamp', 'light', 'pendant', 'sconce', 'chandelier'],
  outdoor: ['garden', 'outdoor', 'terrace', 'patio', 'exterior'],
};
function checkCategorySanity(model, category) {
  if (!model || !category) return { ok: true };
  const modelLower = model.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => modelLower.includes(kw)) && !category.toLowerCase().includes(cat)) {
      return { ok: false, warning: `Model "${model}" suggests "${cat}" but category is "${category}"` };
    }
  }
  return { ok: true };
}

async function getText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' }
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(t); }
}

function locsFromSitemap(xml) {
  const out = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) && out.length < 5000) out.push(m[1].trim());
  return out;
}

/**
 * Enrich a brand: { domain, brandName, maxPages? } ->
 * { ok, products: [verified product facts], checked, sitemap }
 */
export async function enrichBrandFromOfficialSite({ domain, brandName = '', maxPages = MAX_PAGES } = {}) {
  if (!domain) return { ok: false, reason: 'no-domain', products: [] };
  // Hard cap on Vercel: 3 pages max so the pass fits the 60s serverless limit.
  if (process.env.VERCEL === '1') maxPages = Math.min(maxPages, 3);
  const startTime = Date.now();

  // 1) Find a sitemap: robots.txt Sitemap: directives first, then common spots
  const sitemapCands = [];
  try {
    const robots = await getText(`https://${domain}/robots.txt`);
    if (robots) {
      const re = /^sitemap:\s*(\S+)/gim;
      let m;
      while ((m = re.exec(robots))) sitemapCands.push(m[1].trim());
    }
  } catch { /* no robots */ }
  sitemapCands.push(
    `https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`,
    `https://${domain}/sitemap`, `http://${domain}/sitemap.xml`
  );
  let sitemapXml = null, sitemapUrl = null, urls = [];
  for (const cand of [...new Set(sitemapCands)]) {
    const txt = await getText(cand);
    if (txt && txt.includes('<loc>')) { sitemapXml = txt; sitemapUrl = cand; break; }
  }
  if (!sitemapXml) {
    // No sitemap (common on small maker sites) -> crawl the homepage's own
    // links instead and filter them the same way.
    for (const home of [`https://${domain}/`, `http://${domain}/`]) {
      const html = await getText(home);
      if (!html) continue;
      const hrefs = [...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
      const same = hrefs.map((h) => { try { return new URL(h, home).toString(); } catch { return ''; } })
        .filter((u) => { try { return new URL(u).hostname === domain.replace(/^www\./, '') || new URL(u).hostname === domain; } catch { return false; } });
      if (same.length > 0) {
        urls = same.map((u) => ({ u, productMap: false }));
        sitemapUrl = `${home} (homepage crawl)`;
        break;
      }
    }
    if (urls.length === 0) return { ok: false, reason: 'no-sitemap', products: [] };
  } else if (locsFromSitemap(sitemapXml).every((u) => u.endsWith('.xml'))) {
    // 2) One level of sitemap index (track which child each URL came from:
    // a child named *product* means every URL inside is a product -> no guessing)
    for (const idx of locsFromSitemap(sitemapXml).slice(0, 12)) {
      const txt = await getText(idx);
      if (!txt) continue;
      const fromProductMap = /product|produkt|produit|prodotto|producto/i.test(idx);
      for (const u of locsFromSitemap(txt)) urls.push({ u, productMap: fromProductMap });
      if (urls.length >= 3000) break;
    }
  } else {
    urls = locsFromSitemap(sitemapXml).map((u) => ({ u, productMap: false }));
  }
  // 3) Keep product-ish pages only -> deepest URLs first (listings are shallow,
  // real products sit 4+ segments deep: /finder/<category>/<family>/<Model>).
  // URLs from a *product* sitemap child skip the guessing entirely.
  const cands = urls
    .filter(({ u, productMap }) => productMap || (PRODUCT_HINT.test(u) && pathDepth(u) >= 4))
    .filter(({ u }) => !SKIP_HINT.test(u))
    // English locale first (kills FR/DE/ES/NL quadruplicates), then deepest
    .sort((a, b) => ((/\/en(\/|$)/.test(b.u) ? 1 : 0) - (/\/en(\/|$)/.test(a.u) ? 1 : 0)) || (pathDepth(b.u) - pathDepth(a.u)))
    .map(({ u }) => u);
  const finalCands = [...new Set(cands)].slice(0, maxPages);
  if (finalCands.length === 0) return { ok: false, reason: 'no-product-urls', products: [], sitemap: sitemapUrl };
  // 4) Verify each via JSON-LD (brand backfilled when the page omits it)
  const products = [];
  const seenImg = new Set();
  for (const url of finalCands) {
    // Global timeout check
    if (Date.now() - startTime > GLOBAL_TIMEOUT) {
      console.log(`[BrandEnrich] ${brandName}: global timeout reached (${GLOBAL_TIMEOUT/1000}s), returning ${products.length} products so far`);
      break;
    }
    const r = await fetchProductFacts(url);
    if (r.ok && r.product.model) {
      if (!r.product.brand && brandName) r.product.brand = brandName;
      // Generic one-word title ("Chair") -> rebuild from the URL slug instead
      if (/^(chairs?|armchairs?|sofas?|lounge chairs?|tables?|stools?|benchs|benches|chaises?|stuhls?|sillas?|sedias?|poltronas?|divanos?|tavolos?)$/i.test(r.product.model.trim())) {
        try {
          const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
          const words = slug.split(/[-_]+/).filter((w) => w && !(brandName && new RegExp(`^${brandName}$`, 'i').test(w)) && /^\d{4,}$/.test(w) === false);
          if (words.length > 1) r.product.model = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        } catch { /* keep generic title */ }
      }
      // Category sanity check -> log but don't reject (soft warning)
      const sanity = checkCategorySanity(r.product.model, r.product.category);
      if (!sanity.ok) {
        console.log(`[BrandEnrich] ${brandName}: category sanity warning -> ${sanity.warning}`);
        // Keep the product but clear the suspicious category
        r.product.category = '';
      }
      // Same photo = same product in another language -> keep the first (English-first order)
      const imgKey = (r.product.imageUrl || '').split('?')[0].toLowerCase();
      if (imgKey && seenImg.has(imgKey)) continue;
      if (imgKey) seenImg.add(imgKey);
      products.push(r.product);
    }
    // Rate limit: 1s between requests
    if (finalCands.indexOf(url) < finalCands.length - 1) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY));
    }
  }
  return { ok: products.length > 0, products, checked: finalCands.length, sitemap: sitemapUrl };
}
