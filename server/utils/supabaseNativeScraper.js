/**
 * 100% Supabase-Native Brand & Product Scraper (Phase 4.1).
 * Replaces Railway js-scraper-service & python-scraper with:
 *   1. Direct Sitemap / WooCommerce / Shopify / JSON-LD / OpenGraph discovery via fetch
 *   2. On-demand Browserless Chrome (BROWSERLESS_API_KEY) fallback ONLY for JS-heavy / Cloudflare sites
 *   3. Permanent verified photo mirroring into Supabase Storage `product-images` bucket
 *   4. Persistent job state tracking in Supabase `scrape_jobs` table
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { brandStorage } from '../storageProvider.js';
import {
  enqueueScrapeJob,
  updateScrapeJob,
  getScrapeJob,
  hasNormalizedSchema,
  normalizeBudgetTier,
} from '../repositories/supabaseCatalogRepo.js';
import { supabaseAdmin, mirrorImageToSupabaseStorage } from './supabaseStorage.js';
import { resolveBrandLogo } from './brandLogos.js';
import { fetchProductFacts } from './jsonldVerifier.js';
import { isNonProductCatalogRow, normalizeProductImageUrl } from './catalogHygiene.js';
import { classifyFurnishingCategory } from './veCategoryPriority.js';
import { getBatchEmbeddings } from '../embeddingService.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function fetchHtmlDirect(url, timeoutMs = 12000) {
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      maxRedirects: 4,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return typeof res.data === 'string' ? res.data : '';
  } catch {
    return '';
  }
}

async function fetchHtmlViaBrowserless(url) {
  if (!process.env.BROWSERLESS_API_KEY) return '';
  try {
    const { BrowserlessScraper } = await import('../browserlessScraper.js');
    const scraper = new BrowserlessScraper();
    if (!scraper.isConfigured()) return '';
    return await scraper.fetchPageContent(url);
  } catch {
    return '';
  }
}

export async function discoverProductUrls(baseUrl, limit = 250) {
  let origin = '';
  try { origin = new URL(baseUrl).origin; } catch { return []; }
  const cap = Math.min(500, Math.max(10, Number(limit) || 250));

  // 1. Paginated WooCommerce Store API or Shopify /products.json (zero-browser ultra-fast)
  const wcItems = [];
  for (let page = 1; page <= 5 && wcItems.length < cap; page++) {
    try {
      const res = await axios.get(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, {
        timeout: 8000,
        headers: { 'User-Agent': USER_AGENT },
      });
      const items = Array.isArray(res.data) ? res.data : [];
      if (items.length === 0) break;
      for (const it of items) {
        if (!it?.name) continue;
        wcItems.push({
          url: it.permalink || baseUrl,
          model: it.name,
          imageUrl: it.images?.[0]?.src || '',
          price: Number(it.prices?.price || 0) || 0,
          description: String(it.short_description || it.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        });
        if (wcItems.length >= cap) break;
      }
      if (items.length < 100) break;
    } catch { break; }
  }
  if (wcItems.length > 0) return wcItems.slice(0, cap);

  const shopifyItems = [];
  for (let page = 1; page <= 3 && shopifyItems.length < cap; page++) {
    try {
      const res = await axios.get(`${origin}/products.json?limit=250&page=${page}`, {
        timeout: 8000,
        headers: { 'User-Agent': USER_AGENT },
      });
      const items = Array.isArray(res.data?.products) ? res.data.products : [];
      if (items.length === 0) break;
      for (const it of items) {
        if (!it?.title) continue;
        shopifyItems.push({
          url: it.handle ? `${origin}/products/${it.handle}` : baseUrl,
          model: it.title,
          imageUrl: it.images?.[0]?.src || '',
          price: Number(it.variants?.[0]?.price || 0) || 0,
          description: String(it.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        });
        if (shopifyItems.length >= cap) break;
      }
      if (items.length < 250) break;
    } catch { break; }
  }
  if (shopifyItems.length > 0) return shopifyItems.slice(0, cap);

  // 2. Parse sitemap.xml / sitemap_index.xml across sub-sitemaps
  const urls = new Set();
  for (const smPath of ['/sitemap.xml', '/sitemap_index.xml', '/product-sitemap.xml']) {
    const xml = await fetchHtmlDirect(`${origin}${smPath}`, 10000);
    if (!xml || !xml.includes('<loc>')) continue;
    const locs = Array.from(xml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)).map(m => m[1].trim());
    for (const loc of locs) {
      if (/\.xml(\?|$)/i.test(loc) && /product|catalog|furniture|item/i.test(loc)) {
        const subXml = await fetchHtmlDirect(loc, 9000);
        for (const m of subXml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)) {
          if (!/\.xml$/i.test(m[1])) urls.add(m[1].trim());
          if (urls.size >= cap) break;
        }
      } else if (!/\.xml$/i.test(loc) && /\/(product|products|collection|furniture|chair|desk|table|sofa|seating|catalog|item|p)\//i.test(loc)) {
        urls.add(loc);
      }
      if (urls.size >= cap) break;
    }
    if (urls.size > 0) break;
  }

  // 3. Fallback: scrape links directly from provided category/home URL (with Browserless fallback if JS shell)
  if (urls.size === 0) {
    let html = await fetchHtmlDirect(baseUrl, 12000);
    if ((!html || html.length < 1500) && process.env.BROWSERLESS_API_KEY) {
      html = await fetchHtmlViaBrowserless(baseUrl);
    }
    if (html) {
      const $ = cheerio.load(html);
      $('a[href]').each((_, el) => {
        if (urls.size >= cap) return false;
        const href = $(el).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
        try {
          const abs = new URL(href, baseUrl).href;
          if (abs.startsWith(origin) && abs !== baseUrl && abs.split('/').length >= 4 && !/\.(pdf|jpg|png|css|js)$/i.test(abs)) {
            urls.add(abs);
          }
        } catch { /* ignore */ }
      });
    }
  }

  return Array.from(urls).slice(0, cap).map(u => ({ url: u }));
}

/**
 * Runs a complete Supabase-native scrape job (updating `scrape_jobs` + `brandStorage`).
 */
export async function runSupabaseScrapeJob({
  name,
  url,
  origin = 'Supabase-Native',
  budgetTier = 'mid',
  limit = 250,
  existingJobId = null,
  preDiscovered = null,
  skipComplete = false,
  totalDiscoveredCount = 0,
  processedOffset = 0
}) {
  const job = existingJobId
    ? { id: existingJobId }
    : await enqueueScrapeJob({ jobType: 'brand_full_scrape', brandName: name, targetUrl: url, payload: { origin, budgetTier, limit } });

  try {
    await updateScrapeJob(job.id, { status: 'running', progress: Math.max(10, Math.round((processedOffset / Math.max(1, totalDiscoveredCount || limit)) * 90)) });
    const discovered = Array.isArray(preDiscovered)
      ? preDiscovered
      : await discoverProductUrls(url, limit);
    const effectiveTotal = Math.max(1, totalDiscoveredCount || discovered.length);
    await updateScrapeJob(job.id, {
      progress: Math.min(92, Math.max(25, Math.round(((processedOffset + Math.min(discovered.length, 5)) / effectiveTotal) * 90))),
      result_summary: { discoveredCount: totalDiscoveredCount || discovered.length }
    });

    const brandSlug = String(name || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const extractedProducts = [];

    // Direct JSON feed hits already have full product payloads
    const feedItems = discovered.filter(d => d.model);
    const pageUrls = discovered.filter(d => !d.model).map(d => d.url);

    for (const item of feedItems) {
      const rowCandidate = { model: item.model, description: item.description || '', official_url: item.url };
      if (isNonProductCatalogRow(rowCandidate, name).isJunk) continue;
      const cleanImg = normalizeProductImageUrl(item.imageUrl, item.url, name);
      const mirrored = cleanImg ? await mirrorImageToSupabaseStorage(cleanImg, brandSlug, item.model) : '';
      extractedProducts.push({
        brand: name,
        model: item.model,
        description: item.description || item.model,
        price: item.price || 0,
        currency: 'USD',
        imageUrl: mirrored || cleanImg || '',
        productUrl: item.url,
        websiteUrl: item.url,
        officialProductUrl: item.url,
        verified: Boolean(mirrored || cleanImg),
        source: 'Supabase-Feed-Scraper',
      });
    }

    // Extract page URLs in parallel batches of 5 with cancellation checks
    const BATCH = 5;
    let cancelled = false;
    for (let i = 0; i < pageUrls.length; i += BATCH) {
      if (i > 0 && i % 15 === 0) {
        const curJob = await getScrapeJob(job.id).catch(() => null);
        if (curJob?.status === 'cancelled') {
          cancelled = true;
          break;
        }
      }
      const slice = pageUrls.slice(i, i + BATCH);
      const batchOut = await Promise.all(slice.map(async (prodUrl) => {
        const factRes = await fetchProductFacts(prodUrl, { timeoutMs: 10000 }).catch(() => null);
        const facts = factRes?.ok ? factRes.product : null;
        let model = String(facts?.model || '').trim();
        let ogImage = facts?.imageUrl || '';
        let ogDesc = facts?.description || '';

        if (!model || !ogImage) {
          let html = await fetchHtmlDirect(prodUrl, 10000);
          if (!html && process.env.BROWSERLESS_API_KEY) {
            html = await fetchHtmlViaBrowserless(prodUrl);
          }
          if (html) {
            const $ = cheerio.load(html);
            if (!model) model = ($('meta[property="og:title"]').attr('content') || $('h1').first().text() || '').trim();
            if (!ogImage) ogImage = $('meta[property="og:image"]').attr('content') || '';
            if (!ogDesc) ogDesc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
          }
        }

        if (!model || model.length < 2) return null;
        if (isNonProductCatalogRow({ model, description: ogDesc, official_url: prodUrl }, name).isJunk) return null;

        const cleanImg = normalizeProductImageUrl(ogImage, prodUrl, name);
        const mirrored = cleanImg ? await mirrorImageToSupabaseStorage(cleanImg, brandSlug, model) : '';
        return {
          brand: name,
          model,
          description: ogDesc || model,
          price: Number(facts?.price) || 0,
          currency: facts?.currency || 'USD',
          imageUrl: mirrored || cleanImg,
          productUrl: prodUrl,
          websiteUrl: prodUrl,
          officialProductUrl: prodUrl,
          verified: Boolean(mirrored || cleanImg),
          source: 'Supabase-Native-Scraper',
        };
      }));
      for (const p of batchOut) {
        if (p) extractedProducts.push(p);
      }
      const pct = Math.min(90, 25 + Math.round(((i + slice.length) / Math.max(1, pageUrls.length)) * 65));
      await updateScrapeJob(job.id, { progress: pct, result_summary: { discoveredCount: discovered.length, scrapedCount: extractedProducts.length } });
    }

    if (cancelled) {
      return {
        jobId: job.id,
        brandName: name,
        cancelled: true,
        scrapedCount: extractedProducts.length,
        totalProducts: extractedProducts.length,
        discoveredCount: discovered.length,
      };
    }

    // Merge into Supabase brand record cleanly
    const allBrands = await brandStorage.getAllBrands();
    const existing = allBrands.find(b => b.name && b.name.toLowerCase().trim() === String(name || '').toLowerCase().trim());
    const mergedProducts = [...(existing?.products || [])];
    const seen = new Set(mergedProducts.map(p => String(p.model || '').toLowerCase().trim()));
    for (const p of extractedProducts) {
      const k = p.model.toLowerCase().trim();
      if (!seen.has(k)) {
        seen.add(k);
        mergedProducts.push(p);
      }
    }

    const brandIdLegacy = existing?.id || Date.now();
    const resolvedLogo = resolveBrandLogo({ name, websiteUrl: url }, url) || existing?.logo || '';
    const resolvedTier = existing?.budgetTier || budgetTier || 'mid';
    const resolvedOrigin = existing?.origin || origin || 'Supabase-Native';

    await brandStorage.saveBrand({
      id: brandIdLegacy,
      name,
      origin: resolvedOrigin,
      budgetTier: resolvedTier,
      websiteUrl: url,
      logo: resolvedLogo,
      products: mergedProducts,
    });

    // Also sync directly into V2 normalized catalog (`catalog_brands`, `catalog_products`)
    // and backfill canonical 768-d `gemini-embedding-2` vectors so new products are
    // immediately searchable via hybrid pgvector + FTS without manual migration.
    let v2SyncedCount = 0;
    let embeddedCount = 0;
    try {
      if (supabaseAdmin && await hasNormalizedSchema()) {
        const slug = String(name || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || `brand-${Date.now()}`;
        const v2Tier = normalizeBudgetTier(resolvedTier);
        let officialDomain = null;
        try {
          officialDomain = new URL(url).hostname.replace(/^www\./, '');
        } catch { /* ignore invalid url */ }

        const { data: existingV2Brand } = await supabaseAdmin
          .from('catalog_brands')
          .select('id')
          .or(`slug.eq.${slug},name.ilike.${name.replace(/[,%]/g, '')}`)
          .limit(1)
          .maybeSingle();

        let catalogBrandId = existingV2Brand?.id || null;
        if (catalogBrandId) {
          await supabaseAdmin
            .from('catalog_brands')
            .update({
              budget_tier: v2Tier,
              origin: resolvedOrigin,
              official_domain: officialDomain,
              website_url: url,
              logo_url: resolvedLogo || null,
              status: 'verified',
              updated_at: new Date().toISOString(),
            })
            .eq('id', catalogBrandId);
        } else {
          const { data: insertedBrand, error: brandErr } = await supabaseAdmin
            .from('catalog_brands')
            .upsert({
              legacy_id: String(brandIdLegacy),
              slug,
              name,
              budget_tier: v2Tier,
              origin: resolvedOrigin,
              official_domain: officialDomain,
              website_url: url,
              logo_url: resolvedLogo || null,
              status: 'verified',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'slug' })
            .select('id')
            .single();
          if (brandErr) throw brandErr;
          catalogBrandId = insertedBrand?.id || null;
        }

        if (catalogBrandId && mergedProducts.length > 0) {
          const seenNorm = new Set();
          const v2Rows = [];
          for (const p of mergedProducts) {
            if (!p?.model || isNonProductCatalogRow(p).isJunk) continue;
            const modelNorm = String(p.model)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, ' ')
              .trim();
            if (!modelNorm || seenNorm.has(modelNorm)) continue;
            seenNorm.add(modelNorm);

            const cleanImg = normalizeProductImageUrl(p.image || p.imageUrl || p.image_url || '');
            const archetype = classifyFurnishingCategory(
              [p.mainCategory, p.subCategory, p.family, p.model, p.description].filter(Boolean).join(' ')
            );
            v2Rows.push({
              brand_id: catalogBrandId,
              model: p.model,
              model_normalized: modelNorm,
              family: p.family || null,
              main_category: p.mainCategory || null,
              sub_category: p.subCategory || null,
              archetype,
              description: p.description || null,
              dimensions_mm: p.dimensions || null,
              price: Number(p.price) > 0 ? Number(p.price) : 0,
              currency: p.currency || 'USD',
              price_source: Number(p.price) > 0 ? 'scraped_retail' : 'unpriced',
              image_url: cleanImg || null,
              source_image_url: p.sourceImage || p.source_image_url || null,
              official_url: p.url || p.productUrl || p.official_url || null,
              verified: Boolean(p.verified || cleanImg),
              source: p.source || 'Supabase-Native-Scraper',
              updated_at: new Date().toISOString(),
            });
          }

          if (v2Rows.length > 0) {
            for (let c = 0; c < v2Rows.length; c += 100) {
              const slice = v2Rows.slice(c, c + 100);
              await supabaseAdmin
                .from('catalog_products')
                .upsert(slice, { onConflict: 'brand_id,model_normalized' });
            }
            v2SyncedCount = v2Rows.length;

            // Backfill missing canonical 768-d embeddings for up to 100 newly harvested products
            const { data: unembedded } = await supabaseAdmin
              .from('catalog_products')
              .select('id, model, family, main_category, sub_category, archetype, dimensions_mm, description')
              .eq('brand_id', catalogBrandId)
              .is('embedding', null)
              .limit(100);

            if (Array.isArray(unembedded) && unembedded.length > 0) {
              const texts = unembedded.map(row => [
                `Brand: ${name}`,
                row.model ? `Model: ${row.model}` : '',
                row.family ? `Family: ${row.family}` : '',
                row.main_category ? `Category: ${row.main_category}` : '',
                row.sub_category ? `Subcategory: ${row.sub_category}` : '',
                row.archetype ? `Archetype: ${row.archetype}` : '',
                row.dimensions_mm ? `Dimensions: ${row.dimensions_mm}` : '',
                row.description ? `Description: ${String(row.description).slice(0, 800)}` : '',
              ].filter(Boolean).join('\n'));

              const vectors = await getBatchEmbeddings(texts);
              for (let j = 0; j < unembedded.length; j++) {
                const vec = vectors[j];
                if (Array.isArray(vec) && vec.length === 768) {
                  await supabaseAdmin
                    .from('catalog_products')
                    .update({ embedding: vec, updated_at: new Date().toISOString() })
                    .eq('id', unembedded[j].id);
                  embeddedCount++;
                }
              }
            }
          }
        }
      }
    } catch (syncErr) {
      console.warn(`⚠️ [Supabase-Native] V2 catalog/embedding sync partial for "${name}":`, syncErr.message);
    }

    const currentOffset = processedOffset + discovered.length;
    const progressPct = skipComplete
      ? Math.min(92, Math.max(25, Math.round((currentOffset / Math.max(1, totalDiscoveredCount || currentOffset)) * 92)))
      : 100;

    await updateScrapeJob(job.id, {
      status: skipComplete ? 'running' : 'completed',
      progress: progressPct,
      result_summary: {
        scrapedCount: extractedProducts.length,
        totalProducts: mergedProducts.length,
        v2SyncedCount,
        embeddedCount,
        ...(totalDiscoveredCount ? { discoveredCount: totalDiscoveredCount, processedCount: currentOffset } : {}),
      },
    });

    return {
      jobId: job.id,
      brandName: name,
      scrapedCount: extractedProducts.length,
      totalProducts: mergedProducts.length,
      v2SyncedCount,
      embeddedCount,
    };
  } catch (err) {
    await updateScrapeJob(job.id, { status: 'failed', error_message: err.message });
    throw err;
  }
}
