/**
 * Catalog Hygiene & Dynamic Product Image Recovery (Audit + Live Auto-Heal).
 * - Filters out non-product web artifacts (certificates, ISO PDFs, videos, designer bios,
 *   gallery stubs, fabric swatch PDFs, "FAILED", "502 Bad Gateway", HTML tags, nav headers)
 *   while preserving 100% of legitimate commercial furniture models.
 * - Normalizes relative/whitespace URLs, rejects fake/placeholder/logo images, and
 *   dynamically recovers real product photos from official URLs, WP media endpoints,
 *   or verified web search mirrored into Supabase Storage (`product-images`).
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { fetchProductFacts } from './jsonldVerifier.js';
import { mirrorImageToSupabaseStorage } from './supabaseStorage.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const BRAND_OFFICIAL_ORIGINS = new Map([
  ['m&w', 'https://www.mwworkstation.com'],
  ['mw', 'https://www.mwworkstation.com'],
  ['teknion me', 'https://www.teknion.com'],
  ['teknion', 'https://www.teknion.com'],
  ['amara', 'https://amara-art.com'],
  ['narbutas', 'https://www.narbutas.com'],
  ['arper', 'https://www.arper.com'],
  ['frezza', 'https://www.frezza.com'],
  ['ismobil', 'https://www.ismobel.com'],
  ['las', 'https://www.las.it'],
  ['rim', 'https://www.rim.cz'],
  ['nurus', 'https://www.nurus.com'],
  ['sedus stoll', 'https://www.sedus.com'],
  ['steelcase', 'https://www.steelcase.com'],
  ['herman miller', 'https://www.hermanmiller.com'],
  ['ottimo furniture', 'https://ottimouae.com'],
  ['workspace.ae', 'https://www.workspace.ae'],
  ['xinda clover', 'https://www.xindaclover.com'],
  ['wiesner hager', 'https://www.wiesner-hager.com'],
  ['west elm', 'https://www.westelm.com'],
  ['planurban', 'https://www.planurban.it'],
  ['sedia systems', 'https://www.sediasystems.com'],
  ['pedrali', 'https://www.pedrali.com'],
  ['figueras', 'https://www.figueras.com'],
  ['freifrau', 'https://www.freifrau.com'],
  ['emu', 'https://www.emu.it'],
  ['dedon', 'https://www.dedon.de'],
  ['martela', 'https://www.martela.com'],
  ['b&t design', 'https://www.bt.design'],
  ['magis', 'https://www.magisdesign.com'],
]);

export function resolveBrandOrigin(brandName = '', officialUrl = '') {
  try {
    if (officialUrl && /^https?:\/\//i.test(officialUrl.trim())) {
      const u = new URL(officialUrl.trim());
      if (!/google\.com|youtu\.be|youtube\.com|pinterest\.|webinarninja/i.test(u.hostname)) {
        return u.origin;
      }
    }
  } catch { /* ignore */ }
  const key = String(brandName || '').toLowerCase().trim();
  return BRAND_OFFICIAL_ORIGINS.get(key) || '';
}

export function isBadOrPlaceholderImageUrl(url) {
  const s = String(url || '').trim();
  if (!s) return true;
  if (s.startsWith('data:image/svg')) return true;
  if (s.startsWith('data:')) return true; // Reject inline base64 blobs (often scraped PDF/header banners)
  if (!/^https?:\/\//i.test(s)) return true;
  const low = s.toLowerCase();
  return (
    /placehold\.co|via\.placeholder|dummyimage|image%20not%20found|no[-_]?image|default[-_]?logo/i.test(low) ||
    /\/logo\/|[_-]logo\b|\blogo[_-]|\bfavicon\b|proshow-video-btn|service-bg|search\.png|right\.png|bg-banner/i.test(low) ||
    /\.(svg|ico)(\?|$)/i.test(low)
  );
}

export function normalizeProductImageUrl(imageUrl, officialUrl = '', brandName = '') {
  let raw = String(imageUrl || '').trim();
  if (!raw) return '';

  // Reject inline base64 / data URIs immediately
  if (raw.startsWith('data:')) return '';

  // Resolve relative path like `/Uploads/202404/ambi.jpg` against officialUrl or known brand domain
  if (raw.startsWith('/')) {
    const origin = resolveBrandOrigin(brandName, officialUrl);
    if (!origin) return '';
    try {
      raw = new URL(raw, origin).toString();
    } catch {
      return '';
    }
  }

  if (isBadOrPlaceholderImageUrl(raw)) return '';
  return raw;
}

const EXACT_JUNK_MODELS = new Set([
  'failed',
  '502 bad gateway',
  'not specified',
  'n/a',
  'na',
  'null',
  'undefined',
  'error',
  'untitled',
  'local',
  'custom',
  'facebook',
  'instagram',
  'linkedin',
  'twitter',
  'youtube',
  'pinterest',
  'products',
  'productos',
  'furniture',
  'mobiliario',
  'seating',
  'walls',
  'public',
  'design:',
  'diseño:',
  'about us',
  'sales service',
  'oem&odm',
  'videos',
  'images',
  'cases',
  'm&w cases',
  'documents',
  'resource',
  'insight',
  'certificates',
  'certificados',
  'test certificates',
  'certificados de ensayos',
  'quality',
  'calidad',
  'product knowledge',
  'download',
  'downloads',
  '3d models',
  'features',
  'table leg design',
  'flexible design',
  'environment',
  'colour chart',
  'color chart',
  'introduction',
  'introducción',
  'product details',
  'share selection',
  'planning scenarios',
  'configurator',
  'seating at a glance',
  'seating construction notes',
  "what's new",
  "what's new fall 2025",
  'what’s new fall 2025',
  'explore more teknion',
  'see the fabrics',
  'teknion middle east',
  'find a showroom',
  'micro-architecture',
  'finishes',
  'fabrics and finishes',
  'architectural fabrics',
  'architectural finishes',
  'panel fabrics',
  'quilted fabrics',
  'seating finishes',
  'upholstery fabrics',
  'boutique',
  'boutique surfaces',
  'download swatches',
  'download tileable images',
  'veiw full sample card',
  'view full sample card',
  'view full sample card>',
  "discover what's new",
  'discover what’s new',
  'explore four base space typologies',
  'case study furnware',
  'buy or rent an effective names domain',
  'h.e. father amir photo',
  '90 x 120 cm - 2.2 mm thick',
  'mocha mousse',
  'custom-made desks and tables',
  'on the ground',
  'ancillary',
  '120 degrees',
  'benching',
  'cafe / hospitality',
]);

const TEKNION_SECTION_HEADERS = new Set([
  'desking systems',
  'boardroom / meeting tables',
  'ergonomic accessories',
  'freestanding screens',
  'height-adjustable tables',
  'casegoods / private office',
  'panel systems',
  'storage',
  'organization',
  'mobile work tools',
  'lockers',
  'electrical accessories',
  'architectural interiors',
  'work chairs',
  'classroom & training tables',
  'filing & storage',
  'pedestals',
  'other workflow accessories',
  'other ergonomic accessories',
  'zones',
]);

const JUNK_CATEGORIES_RE =
  /^(certificates|certificates and resources|company|ecodesign|ecodiseño|pcon planner|filosofia|philosophy|diseñadores|interior designers|find out more|image gallery|fabrics & finishes|bow tie|future smart|explore all settings|find a showroom|learn more|3d models|documents|insight|m&w cases|cases|product knowledge|sales service|videos|images|resource|space design solutions|education)$/i;

/**
 * Classifies whether a catalog row is non-product metadata / web artifact.
 * Strictly preserves legitimate commercial furniture items.
 */
export function isNonProductCatalogRow(row = {}, brandName = '') {
  const modelRaw = String(row.model || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const modelLower = modelRaw.toLowerCase().replace(/\s+/g, ' ');
  const mainCat = String(row.main_category ?? row.mainCategory ?? '').trim();
  const subCat = String(row.sub_category ?? row.subCategory ?? '').trim();
  const desc = String(row.description || '').trim();
  const url = String(row.official_url ?? row.officialProductUrl ?? row.productUrl ?? row.websiteUrl ?? '').trim();
  const brandLower = String(brandName || row.brand || '').toLowerCase().trim();

  if (!modelRaw || modelRaw.length <= 1) {
    return { isJunk: true, reason: 'empty_or_single_char_model' };
  }
  if (/<[^>]+>/.test(modelRaw)) {
    return { isJunk: true, reason: 'html_in_model' };
  }
  if (/^https?:\/\//i.test(modelRaw) || /\.(pdf|zip|dwg)$/i.test(modelRaw) || /^\d+$/.test(modelRaw)) {
    return { isJunk: true, reason: 'url_or_file_or_bare_number_model' };
  }
  if (EXACT_JUNK_MODELS.has(modelLower)) {
    return { isJunk: true, reason: `exact_junk_model:${modelLower}` };
  }

  // Category/section header rows (e.g., Teknion ME index headers or Sancrea/Encore nav category tiles)
  if (TEKNION_SECTION_HEADERS.has(modelLower) && brandLower.includes('teknion')) {
    return { isJunk: true, reason: 'teknion_section_header' };
  }
  if (brandLower === 'sancrea' && /^(chairs|sofas and armchairs|stools|tables)$/i.test(modelLower)) {
    return { isJunk: true, reason: 'generic_category_tile' };
  }
  if (brandLower === 'encore seating' && /^(executive & task|guest & stackable|multi-use|stools|lounge & modular)$/i.test(modelLower)) {
    return { isJunk: true, reason: 'generic_category_tile' };
  }

  // Regex model checks (does NOT match "Ofifran Gallery Desk #1543258", etc.)
  if (/\bgallery$/i.test(modelRaw) || /^products featured\s*\(\d+\)/i.test(modelRaw)) {
    return { isJunk: true, reason: 'gallery_or_featured_stub' };
  }
  if (/^(installation|introduction|outstanding features)\s+video$/i.test(modelRaw) || /^\d+\s+video\s+walkthrough$/i.test(modelRaw)) {
    return { isJunk: true, reason: 'video_entry' };
  }
  if (/^visit\s+(classroom|faculty|library|social|studiotk)/i.test(modelRaw)) {
    return { isJunk: true, reason: 'navigation_cta' };
  }
  if (/^0[1-4]\s+(ready for the future|remapping the workplace|reactivating the office)/i.test(modelLower)) {
    return { isJunk: true, reason: 'editorial_article' };
  }
  if (/^bow\s+tie\s+\d+\s+(essays|finishes palette|look book|pinterest board)/i.test(modelLower) || /^discover\s+bow\s+tie/i.test(modelLower)) {
    return { isJunk: true, reason: 'editorial_or_brochure_stub' };
  }
  if (/^(t\d+\s+.*installation instructions|3d models-|t\d+\s+.*-sgs|product recommendation portfolio|salvadoran design company|guangdong project|fabric\s*-screen-)/i.test(modelLower)) {
    return { isJunk: true, reason: 'doc_or_case_or_swatch' };
  }
  if (/^(sustainability at all times|sostenibilidad en todo momento|ismobel\s+(has|tiene)|presentaci[oó]n\s+grupo\s+ismobel|presentation of the ismobel group|we carefully work|realizamos un cuidadoso|power to the sales team|poder al equipo de ventas|we make space for your projects|move walls, not people|new product:\s*leading the aesthetic)/i.test(modelLower)) {
    return { isJunk: true, reason: 'company_marketing_copy' };
  }

  // Keep real series/products that happened to land under non-product bucket or PDF link
  if (/^(writing boards|t3 series|t8 series|t10 series|expansion casegoods reception desk|usb hub|laptop locker|accessory dock)$/i.test(modelLower)) {
    return { isJunk: false, reason: '' };
  }
  if (brandLower === 'las' && /^(jera chair|nice|i-meet|java|divo|sello)$/i.test(subCat.trim())) {
    return { isJunk: false, reason: '' };
  }

  // Category / sub-category non-product buckets
  if (JUNK_CATEGORIES_RE.test(mainCat) || JUNK_CATEGORIES_RE.test(subCat)) {
    return { isJunk: true, reason: `junk_category:${mainCat || subCat}` };
  }
  // LAS "PRODUCTS / SHARE" or "PRODUCTS / FESTIVAL" or "PRODUCTS / E.O.S." designer credit stubs
  if (/\/designer\/|\/disenadores\//i.test(url)) {
    return { isJunk: true, reason: 'designer_bio_page' };
  }
  if (brandLower === 'martela' && /interior designers/i.test(mainCat)) {
    return { isJunk: true, reason: 'designer_bio_page' };
  }
  if (/^(certificates|certificados)$/i.test(subCat) || /^calidad y medio ambiente$/i.test(subCat)) {
    return { isJunk: true, reason: 'certificate_category' };
  }

  // Non-product official URLs (PDF manuals, ZIP CAD bundles, YouTube videos, Google Search links, company/news/blog pages)
  if (
    /\.(pdf|zip|dwg)(\?|$)/i.test(url) ||
    /youtu\.be|youtube\.com|webinarninja\.com|pinterest\.|google\.com\/search/i.test(url) ||
    /\/(designer|designers|disenadores|history|articles|cases|instalaciones|ecodiseno|about\.html|blog\/|pantone-colour-of-the-year)(\/|$|\?|#)/i.test(url) ||
    (/\/typologies\/(furniture|walls|seating)\/?$/i.test(url) && !subCat)
  ) {
    return { isJunk: true, reason: 'non_product_url' };
  }

  // AI ghost "product not found" rows from old scraper
  if (/unfortunately,?\s*i was unable to find|could not be found on architonic|product not found\.\s*unable to retrieve|unable to find (a )?product description|as a furniture item could not be found/i.test(desc)) {
    return { isJunk: true, reason: 'ai_not_found_ghost' };
  }

  // LAS "Acoustic Furniture" index stub vs Narbutas index stubs without real description
  if (brandLower === 'narbutas' && /^(acoustic furniture)$/i.test(modelLower)) {
    return { isJunk: true, reason: 'category_index_stub' };
  }

  return { isJunk: false, reason: '' };
}

/**
 * Verifies an HTTP(S) image URL returns a valid non-SVG raster image.
 */
export async function verifyImageUrlReachable(url, timeoutMs = 8000) {
  if (!url || isBadOrPlaceholderImageUrl(url)) return false;
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      maxRedirects: 4,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,*/*',
        'Range': 'bytes=0-8191',
      },
      validateStatus: (s) => (s >= 200 && s < 300) || s === 206,
    });
    const ct = String(res.headers['content-type'] || '').toLowerCase();
    const byteLen = res.data ? (res.data.byteLength ?? res.data.length ?? 0) : 0;
    if (ct.includes('svg') || ct.startsWith('text/html')) return false;
    if (ct.startsWith('image/')) return byteLen > 300;
    return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url) && byteLen > 1000;
  } catch {
    return false;
  }
}

/**
 * Fetches all WordPress media items for a WordPress brand domain (e.g. AMARA) to match imageless SKUs fast.
 */
export async function loadWordPressMediaIndex(origin, maxPages = 6) {
  const media = [];
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(`${origin}/wp-json/wp/v2/media?per_page=100&page=${page}`, {
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENT },
        validateStatus: (s) => s === 200,
      });
      if (!Array.isArray(res.data) || res.data.length === 0) break;
      for (const item of res.data) {
        if (item?.source_url && /^https?:\/\//i.test(item.source_url) && !isBadOrPlaceholderImageUrl(item.source_url)) {
          media.push({
            url: item.source_url,
            slug: String(item.slug || '').toLowerCase(),
            title: String(item.title?.rendered || '').toLowerCase(),
            file: String(item.source_url).split('/').pop().toLowerCase(),
          });
        }
      }
      if (res.data.length < 100) break;
    } catch {
      break;
    }
  }
  return media;
}

export function matchWpMediaForModel(mediaIndex = [], model = '') {
  if (!mediaIndex.length || !model) return '';
  const clean = String(model).trim().toLowerCase();
  const norm = clean.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const tokens = clean.split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !/^(the|and|for|with|chair|table|sofa)$/i.test(t));

  // Prefer exact SKU/prefix match (e.g. 105_yase -> 105_yase-009.jpg)
  const exactPrefix = mediaIndex.find(m => m.file.includes(clean.replace(/\s+/g, '_')) || m.file.includes(norm) || m.slug.includes(norm));
  if (exactPrefix) return exactPrefix.url;

  if (tokens.length > 0) {
    // Score by longest distinctive token match (e.g. YASE, TOLEDO, YUCEL)
    const sortedTokens = [...tokens].sort((a, b) => b.length - a.length);
    for (const tok of sortedTokens) {
      if (tok.length < 4 && /^\d+$/.test(tok)) continue;
      const hit = mediaIndex.find(m => m.file.includes(tok) || m.slug.includes(tok));
      if (hit) return hit.url;
    }
  }
  return '';
}

async function searchOfficialSiteForImage(origin, brand, model) {
  const cleanModel = String(model || '').replace(/#\d+/g, '').replace(/\s+/g, ' ').trim();
  if (!origin || !cleanModel) return '';

  // 1. WordPress Media Search API
  try {
    const wpUrl = `${origin}/wp-json/wp/v2/media?per_page=5&search=${encodeURIComponent(cleanModel)}`;
    const wpRes = await axios.get(wpUrl, { timeout: 6000, headers: { 'User-Agent': USER_AGENT } });
    if (Array.isArray(wpRes.data) && wpRes.data.length > 0) {
      const hit = matchWpMediaForModel(
        wpRes.data
          .filter(x => x?.source_url && !isBadOrPlaceholderImageUrl(x.source_url))
          .map(x => ({
            url: x.source_url,
            slug: String(x.slug || '').toLowerCase(),
            title: String(x.title?.rendered || '').toLowerCase(),
            file: String(x.source_url).split('/').pop().toLowerCase(),
          })),
        cleanModel
      );
      if (hit) return hit;
    }
  } catch { /* not WP or disabled */ }

  // 2. Site HTML search (`/?s=...`) picking first product link and reading OpenGraph/JSON-LD
  try {
    const searchRes = await axios.get(`${origin}/?s=${encodeURIComponent(cleanModel)}`, {
      timeout: 7000,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (typeof searchRes.data === 'string' && searchRes.data.length > 500) {
      const $ = cheerio.load(searchRes.data);
      const token = cleanModel.toLowerCase().split(/\s+/).find(w => w.length >= 4) || cleanModel.toLowerCase();
      let candidateLink = '';
      $('a[href]').each((_, el) => {
        if (candidateLink) return;
        const href = String($(el).attr('href') || '').trim();
        const txt = $(el).text().toLowerCase();
        if (href.startsWith('http') && href.startsWith(origin) && (href.toLowerCase().includes(token) || txt.includes(token))) {
          if (!/\.(pdf|jpg|png|zip)$/i.test(href) && !/\/(\?s=|category|tag|about|contact)/i.test(href)) {
            candidateLink = href;
          }
        }
      });
      if (candidateLink) {
        const facts = await fetchProductFacts(candidateLink, { timeoutMs: 7000 });
        if (facts?.ok && facts.product?.imageUrl && !isBadOrPlaceholderImageUrl(facts.product.imageUrl)) {
          return facts.product.imageUrl;
        }
      }
    }
  } catch { /* ignore */ }

  return '';
}

async function searchDuckDuckGoImages(query) {
  try {
    const q = encodeURIComponent(query);
    const pageRes = await axios.get(`https://duckduckgo.com/?q=${q}&iax=images&ia=images`, {
      timeout: 7000,
      headers: { 'User-Agent': USER_AGENT },
    });
    const html = String(pageRes.data || '');
    const vqdMatch = html.match(/vqd=["']?([0-9-]+)["']?/i) || html.match(/vqd=([0-9-]+)/i);
    if (!vqdMatch) return '';
    const vqd = vqdMatch[1];
    const iRes = await axios.get(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${q}&vqd=${encodeURIComponent(vqd)}&f=,,,,,&p=1`, {
      timeout: 7000,
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://duckduckgo.com/',
      },
    });
    const results = Array.isArray(iRes.data?.results) ? iRes.data.results : [];
    for (const item of results.slice(0, 6)) {
      const cand = String(item?.image || '').trim();
      if (!cand || isBadOrPlaceholderImageUrl(cand)) continue;
      if (/dreamstime|shutterstock|alamy|istockphoto|123rf|gettyimages|pinterest/i.test(cand)) continue;
      const ok = await verifyImageUrlReachable(cand, 5000);
      if (ok) return cand;
    }
  } catch { /* ignore */ }
  return '';
}

/**
 * Dynamically recovers a real product photo (and optional description) for any product missing an image.
 */
export async function fetchDynamicProductImage({
  brand = '',
  model = '',
  officialUrl = '',
  wpMediaIndex = null,
  mirrorToStorage = true,
  allowWebSearch = true,
} = {}) {
  const cleanModel = String(model || '').replace(/#\d+/g, '').replace(/\s+/g, ' ').trim();
  if (!cleanModel) return { imageUrl: '', description: '', source: '' };

  let foundUrl = '';
  let foundDesc = '';
  let foundSource = '';

  // Tier 1: Direct product page (JSON-LD + OpenGraph) when `officialUrl` is a specific product page
  if (officialUrl && /^https?:\/\//i.test(officialUrl)) {
    let isBareHomepage = false;
    try {
      const u = new URL(officialUrl);
      isBareHomepage = !u.pathname || u.pathname === '/' || u.pathname === '/en' || u.pathname === '/en/';
    } catch { /* ignore */ }

    if (!isBareHomepage) {
      const facts = await fetchProductFacts(officialUrl, { timeoutMs: 9000 }).catch(() => null);
      if (facts?.ok) {
        if (facts.product?.description && facts.product.description.length >= 25) {
          foundDesc = facts.product.description;
        }
        const cand = normalizeProductImageUrl(facts.product?.imageUrl, officialUrl, brand);
        if (cand && (await verifyImageUrlReachable(cand, 6000))) {
          foundUrl = cand;
          foundSource = 'official_page';
        }
      }
    }
  }

  // Tier 2: Pre-loaded WordPress media index (AMARA, etc.)
  if (!foundUrl && Array.isArray(wpMediaIndex) && wpMediaIndex.length > 0) {
    const wpHit = matchWpMediaForModel(wpMediaIndex, cleanModel);
    if (wpHit && (await verifyImageUrlReachable(wpHit, 6000))) {
      foundUrl = wpHit;
      foundSource = 'wp_media_index';
    }
  }

  // Tier 3: Official Brand Website Search (WP Media API / `/?s=`)
  if (!foundUrl) {
    const origin = resolveBrandOrigin(brand, officialUrl);
    if (origin) {
      const siteHit = await searchOfficialSiteForImage(origin, brand, cleanModel);
      if (siteHit && !isBadOrPlaceholderImageUrl(siteHit) && (await verifyImageUrlReachable(siteHit, 6000))) {
        foundUrl = siteHit;
        foundSource = 'brand_site_search';
      }
    }
  }

  // Tier 4: Verified Web Image Search (bounded, watermark-filtered)
  if (!foundUrl && allowWebSearch) {
    const ddgHit = await searchDuckDuckGoImages(`"${brand}" "${cleanModel}" furniture`);
    if (ddgHit) {
      foundUrl = ddgHit;
      foundSource = 'web_image_search';
    }
  }

  if (!foundUrl) {
    return { imageUrl: '', description: foundDesc, source: '' };
  }

  if (mirrorToStorage) {
    try {
      const brandSlug = String(brand || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const mirrored = await mirrorImageToSupabaseStorage(foundUrl, brandSlug, cleanModel);
      if (mirrored && /^https?:\/\//i.test(mirrored)) {
        return { imageUrl: mirrored, sourceImageUrl: foundUrl, description: foundDesc, source: `${foundSource}+mirrored` };
      }
    } catch { /* keep verified original URL if storage mirror fails */ }
  }

  return { imageUrl: foundUrl, sourceImageUrl: foundUrl, description: foundDesc, source: foundSource };
}

/**
 * Runtime self-healing: if a matched catalog row lacks a valid image, recover & persist it to Supabase.
 */
export async function resolveAndPersistMissingImage(productRow, supabaseClient, timeoutMs = 4500) {
  if (!productRow || !isBadOrPlaceholderImageUrl(productRow.image_url)) return productRow?.image_url || '';
  const work = (async () => {
    const rec = await fetchDynamicProductImage({
      brand: productRow.brand_name || productRow.brand || '',
      model: productRow.model || '',
      officialUrl: productRow.official_url || '',
      mirrorToStorage: true,
      allowWebSearch: true,
    });
    if (rec?.imageUrl && supabaseClient && productRow.product_id) {
      const patch = {
        image_url: rec.imageUrl,
        source_image_url: rec.sourceImageUrl || rec.imageUrl,
        verified: true,
        updated_at: new Date().toISOString(),
      };
      if (rec.description && (!productRow.description || productRow.description.length < 20)) {
        patch.description = rec.description;
      }
      await supabaseClient.from('catalog_products').update(patch).eq('id', productRow.product_id);
      return rec.imageUrl;
    }
    return '';
  })();

  try {
    return await Promise.race([
      work,
      new Promise(resolve => setTimeout(() => resolve(''), timeoutMs)),
    ]);
  } catch {
    return '';
  }
}
