// architonicAdapter.js — Phase 3 second source: resolve a brand's Architonic
// page (AI finds the door, fetch verifies it) -> product pages -> JSON-LD verify.
// Demand-driven: only the brand you name. No browser.
// Vercel-safe: global fetch + cheerio (no puppeteer), AI fallback is graceful.
import { load as cheerioLoad } from 'cheerio';
import { fetchProductFacts } from './jsonldVerifier.js';
import { getGoogleAI, getGoogleModel } from './llmUtils.js';

const TIMEOUT = 25000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function getHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(t); }
}

/**
 * Normalize a brand name to an Architonic-friendly slug.
 * e.g. "Please Wait to Be Seated" -> "please-wait-to-be-seated"
 *      "Herman Miller" -> "herman-miller"
 */
function brandToSlug(brandName) {
  return String(brandName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Try to guess an Architonic brand page URL without AI.
 * Common patterns:
 *   https://www.architonic.com/en/b/<slug>/<numeric-id>/
 * The /en/brands/ directory listing has no sort/search params, but the URL
 * format is predictable. We try the most common brand names directly.
 * Returns null if it can't find a valid page.
 */
async function guessArchitonicBrandPage(brandName) {
  const slug = brandToSlug(brandName);
  if (!slug) return null;

  // Try a few candidate URLs with common ID patterns
  // Architonic uses numeric IDs, so we try a range. But first, try the
  // /en/b/ URL and see if it redirects to the actual brand page.
  const candidates = [
    `https://www.architonic.com/en/b/${slug}/`,
    `https://www.architonic.com/en/manufacturer/${slug}/`,
  ];

  for (const url of candidates) {
    try {
      const html = await getHtml(url);
      if (!html) continue;

      // Check if the brand name appears in the page content
      const title = (cheerioLoad(html)('title').text() || '').toLowerCase();
      const firstWord = brandName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';
      if (title.includes(slug) || (firstWord.length > 2 && (title.includes(firstWord) || html.toLowerCase().includes(`>${brandName.toLowerCase()}<`)))) {
        return url.replace(/\/$/, '') + '/';
      }
    } catch { /* skip */ }
  }

  // If no match found via direct slug, the AI approach below will handle it.
  return null;
}

/**
 * Resolve a brand's Architonic page URL via grounded AI (the /en/brands/
 * directory has no reliable sort or search param; slug-guessing 404s without
 * the numeric ID). AI only finds the door -> the URL is verified by fetch
 * before anything is crawled.
 * { brandName } -> brand page URL or null.
 * Vercel-safe: falls back to slug guessing if no AI key is configured.
 */
export async function findArchitonicBrandPage(brandName) {
  const want = String(brandName || '').trim();
  if (!want) return null;

  // Try AI first (if configured)
  try {
    const modelName = getGoogleModel() || 'gemini-2.5-flash';
    const ai = getGoogleAI(modelName);
    const model = ai.getGenerativeModel({
      model: modelName.replace(':billed', '').trim(),
      systemInstruction: 'You resolve official Architonic manufacturer page URLs. Reply with ONLY the URL, nothing else.',
      tools: [{ googleSearch: {} }]
    });
    const res = await Promise.race([
      model.generateContent(`What is the official Architonic brand page URL for the furniture manufacturer "${want}"? It looks like https://www.architonic.com/en/b/<slug>/<id>/. Reply with ONLY the URL.`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
    ]);
    const m = String(res.response.text() || '').match(/https?:\/\/www\.architonic\.com\/en\/(?:b|manufacturer)\/[^)\s"']+/i);
    if (m) {
      const url = m[0].replace(/\/$/, '') + '/';
      // Verify: must render and name the brand
      const html = await getHtml(url);
      if (html) {
        const title = (cheerioLoad(html)('title').text() || '').toLowerCase();
        const firstWord = want.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';
        if (firstWord.length > 2 && (title.includes(firstWord) || html.toLowerCase().includes(`>${want.toLowerCase()}<`))) return url;
      }
    }
  } catch {
    // AI failed (likely no key configured) -> continue to slug guessing
    console.log(`[Architonic] AI lookup for "${want}" failed, trying slug guess...`);
  }

  // Fallback: try slug guessing
  const slugUrl = await guessArchitonicBrandPage(brandName);
  if (slugUrl) return slugUrl;

  // Last resort: try the /en/b/ with the slug, even if title doesn't match
  // (Architonic sometimes redirects to a 404 with the brand name in meta tags)
  try {
    const slugUrl2 = `https://www.architonic.com/en/b/${brandToSlug(brandName)}/`;
    const html = await getHtml(slugUrl2);
    if (html && (html.toLowerCase().includes(brandName.toLowerCase()) || html.toLowerCase().includes(brandToSlug(brandName)))) {
      return slugUrl2.replace(/\/$/, '') + '/';
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * List product page URLs from a brand page.
 */
export async function listArchitonicBrandProducts(brandPageUrl, limit = 8) {
  const html = await getHtml(brandPageUrl);
  if (!html) return { ok: false, reason: 'fetch-fail', urls: [] };
  const $ = cheerioLoad(html);
  const urls = [];
  const seen = new Set();
  $('a[href*="/en/p/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/en\/p\/.+?-(\d+)\/?(?:[?#]|$)/);
    if (!m) return;
    let abs = href.startsWith('http') ? href : `https://www.architonic.com${href.split('?')[0]}`;
    if (seen.has(abs)) return;
    seen.add(abs);
    urls.push(abs);
  });
  return { ok: urls.length > 0, urls: urls.slice(0, limit), reason: urls.length ? null : 'no-product-links' };
}

/**
 * Full pass: { brandName, maxPages? } -> { ok, products, brandPageUrl }
 */
export async function enrichBrandFromArchitonic({ brandName, maxPages = 6 } = {}) {
  const brandPageUrl = await findArchitonicBrandPage(brandName);
  if (!brandPageUrl) return { ok: false, reason: 'brand-not-on-architonic', products: [] };
  const listed = await listArchitonicBrandProducts(brandPageUrl, maxPages);
  if (!listed.ok) return { ok: false, reason: listed.reason, products: [], brandPageUrl };
  const products = [];
  for (const url of listed.urls) {
    const r = await fetchProductFacts(url);
    if (r.ok && r.product.model) products.push({ ...r.product, brand: r.product.brand || brandName });
    if (products.length >= maxPages) break;
  }
  return { ok: products.length > 0, products, brandPageUrl, checked: listed.urls.length };
}
