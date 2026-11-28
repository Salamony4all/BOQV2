// Supabase Edge Function: scrape-worker
// Unlimited Chunked Brand Catalog Scraper (no Railway, zero Vercel timeout).
// Processes `scrape_jobs` in 35-item chunks, mirrors product photos to Supabase Storage
// `product-images`, updates `brands` + `catalog_brands` + `catalog_products`, and chains
// asynchronously until 100% of discovered catalog URLs are harvested.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY') ?? '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const CHUNK_SIZE = 35;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface PendingItem {
  url: string;
  model?: string;
  imageUrl?: string;
  price?: number;
  description?: string;
}

async function fetchHtml(url: string, timeoutMs = 9500): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    clearTimeout(timer);
    if (res.ok) {
      const txt = await res.text();
      if (txt.length > 800) return txt;
    }
  } catch { /* fallback below */ }

  if (BROWSERLESS_API_KEY) {
    try {
      const bRes = await fetch(`https://chrome.browserless.io/content?token=${BROWSERLESS_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, waitFor: 1500 }),
      });
      if (bRes.ok) return await bRes.text();
    } catch { /* ignore */ }
  }
  return '';
}

function extractMeta(html: string, property: string): string {
  const rx = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  return rx.exec(html)?.[1]?.trim() || '';
}

function extractJsonLdProduct(html: string): { model?: string; imageUrl?: string; description?: string; price?: number; currency?: string } | null {
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed]);
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const typeStr = String(item['@type'] || '').toLowerCase();
        if (typeStr.includes('product')) {
          const rawImg = Array.isArray(item.image) ? item.image[0] : (typeof item.image === 'object' ? item.image?.url : item.image);
          const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          const price = Number(offers?.price || 0) || 0;
          return {
            model: String(item.name || '').trim(),
            imageUrl: typeof rawImg === 'string' ? rawImg.trim() : '',
            description: String(item.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
            price,
            currency: String(offers?.priceCurrency || 'USD'),
          };
        }
      }
    } catch { /* ignore invalid JSON-LD */ }
  }
  return null;
}

function isJunkProduct(model: string, prodUrl: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m || m.length < 2) return true;
  if (/^(failed|502 bad gateway|not found|404|home|products|catalog|contact|about|login|cart|privacy|terms)$/i.test(m)) return true;
  if (/\.(pdf|zip|docx?|xlsx?)$/i.test(prodUrl)) return true;
  return false;
}

async function discoverUrls(baseUrl: string, limit = 250): Promise<PendingItem[]> {
  let origin = '';
  try { origin = new URL(baseUrl).origin; } catch { return []; }

  const out: PendingItem[] = [];
  const seen = new Set<string>();

  // 1. Paginated WooCommerce Store API
  for (let page = 1; page <= 5 && out.length < limit; page++) {
    try {
      const res = await fetch(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, {
        headers: { 'User-Agent': UA },
      });
      if (!res.ok) break;
      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) break;
      for (const it of items) {
        const u = it.permalink || baseUrl;
        if (!it.name || seen.has(u)) continue;
        seen.add(u);
        out.push({
          url: u,
          model: String(it.name).trim(),
          imageUrl: it.images?.[0]?.src || '',
          price: Number(it.prices?.price || 0) || 0,
          description: String(it.short_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        });
        if (out.length >= limit) break;
      }
      if (items.length < 100) break;
    } catch { break; }
  }
  if (out.length > 0) return out;

  // 2. Paginated Shopify products.json
  for (let page = 1; page <= 3 && out.length < limit; page++) {
    try {
      const res = await fetch(`${origin}/products.json?limit=250&page=${page}`, {
        headers: { 'User-Agent': UA },
      });
      if (!res.ok) break;
      const data = await res.json();
      const items = Array.isArray(data?.products) ? data.products : [];
      if (items.length === 0) break;
      for (const it of items) {
        const u = it.handle ? `${origin}/products/${it.handle}` : baseUrl;
        if (!it.title || seen.has(u)) continue;
        seen.add(u);
        out.push({
          url: u,
          model: String(it.title).trim(),
          imageUrl: it.images?.[0]?.src || '',
          price: Number(it.variants?.[0]?.price || 0) || 0,
          description: String(it.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        });
        if (out.length >= limit) break;
      }
      if (items.length < 250) break;
    } catch { break; }
  }
  if (out.length > 0) return out;

  // 3. Multi-sitemap XML crawl
  for (const smPath of ['/sitemap.xml', '/sitemap_index.xml', '/product-sitemap.xml']) {
    const xml = await fetchHtml(`${origin}${smPath}`, 9000);
    if (!xml || !xml.includes('<loc>')) continue;
    const locs = Array.from(xml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)).map((m) => m[1].trim());
    for (const loc of locs) {
      if (out.length >= limit) break;
      if (/\.xml(\?|$)/i.test(loc) && /product|catalog|furniture|item/i.test(loc)) {
        const subXml = await fetchHtml(loc, 8000);
        for (const m of subXml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)) {
          const u = m[1].trim();
          if (!/\.xml$/i.test(u) && !seen.has(u)) {
            seen.add(u);
            out.push({ url: u });
            if (out.length >= limit) break;
          }
        }
      } else if (!/\.xml$/i.test(loc) && /\/(product|products|collection|furniture|chair|desk|table|sofa|seating|catalog|item|p)\//i.test(loc)) {
        if (!seen.has(loc)) {
          seen.add(loc);
          out.push({ url: loc });
        }
      }
    }
    if (out.length > 0) break;
  }

  // 4. HTML link fallback
  if (out.length === 0) {
    const html = await fetchHtml(baseUrl, 10000);
    if (html) {
      for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
        if (out.length >= limit) break;
        try {
          const abs = new URL(m[1], baseUrl).href;
          if (abs.startsWith(origin) && abs !== baseUrl && abs.split('/').length >= 4 && !/\.(pdf|jpg|png|css|js)$/i.test(abs) && !seen.has(abs)) {
            seen.add(abs);
            out.push({ url: abs });
          }
        } catch { /* ignore */ }
      }
    }
  }
  return out;
}

async function mirrorImage(imageUrl: string, brandSlug: string, model: string): Promise<string> {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return '';
  if (SUPABASE_URL && imageUrl.startsWith(SUPABASE_URL)) return imageUrl;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(imageUrl, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    clearTimeout(timer);
    if (!res.ok) return '';
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/') || ct.includes('svg')) return '';
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024 || buf.byteLength > 8 * 1024 * 1024) return '';
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    const safeModel = model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'item';
    const storagePath = `${brandSlug}/${safeModel}.${ext}`;
    const { data, error } = await supabase.storage.from('product-images').upload(storagePath, buf, {
      upsert: true,
      contentType: ct.split(';')[0].trim() || `image/${ext}`,
      cacheControl: '31536000',
    });
    if (error || !data?.path) return '';
    return supabase.storage.from('product-images').getPublicUrl(data.path).data.publicUrl;
  } catch {
    return '';
  }
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const jobId = body?.record?.id || body?.jobId;

    const query = jobId
      ? supabase.from('scrape_jobs').select('*').eq('id', jobId).limit(1)
      : supabase.from('scrape_jobs').select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(1);

    const { data: jobs, error } = await query;
    if (error || !jobs?.length) {
      return new Response(JSON.stringify({ ok: true, message: 'No queued scrape_jobs' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const job = jobs[0];
    if (job.status === 'cancelled') {
      return new Response(JSON.stringify({ ok: true, jobId: job.id, cancelled: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const payload = (job.payload && typeof job.payload === 'object') ? { ...job.payload } : {};
    const brandName = String(job.brand_name || 'Brand').trim();
    const targetUrl = String(job.target_url || '').trim();
    const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `brand-${Date.now()}`;
    const budgetTier = ['budgetary', 'mid', 'high'].includes(String(payload.budgetTier || 'mid').toLowerCase())
      ? String(payload.budgetTier).toLowerCase()
      : 'mid';

    let pendingUrls: PendingItem[] = Array.isArray(payload.pendingUrls) ? payload.pendingUrls : [];
    let cursor = Math.max(0, Number(payload.cursor) || 0);

    if (pendingUrls.length === 0 && targetUrl) {
      await supabase.from('scrape_jobs').update({ status: 'running', progress: 10, updated_at: new Date().toISOString() }).eq('id', job.id);
      const limit = Math.min(500, Math.max(20, Number(payload.limit) || 250));
      pendingUrls = await discoverUrls(targetUrl, limit);
      cursor = 0;
    }

    const slice = pendingUrls.slice(cursor, cursor + CHUNK_SIZE);
    const extracted: Array<Record<string, unknown>> = [];

    // Process 5 items concurrently inside each 35-item chunk
    for (let i = 0; i < slice.length; i += 5) {
      const sub = slice.slice(i, i + 5);
      const results = await Promise.all(sub.map(async (item) => {
        let model = String(item.model || '').trim();
        let imageUrl = String(item.imageUrl || '').trim();
        let description = String(item.description || '').trim();
        let price = Number(item.price) || 0;
        let currency = 'USD';

        if (!model || !imageUrl) {
          const html = await fetchHtml(item.url, 9000);
          if (html) {
            const ld = extractJsonLdProduct(html);
            if (!model) model = ld?.model || extractMeta(html, 'og:title') || (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '');
            if (!imageUrl) imageUrl = ld?.imageUrl || extractMeta(html, 'og:image') || '';
            if (!description) description = ld?.description || extractMeta(html, 'og:description') || extractMeta(html, 'description') || '';
            if (!price && ld?.price) price = ld.price;
            if (ld?.currency) currency = ld.currency;
          }
        }

        if (!model || isJunkProduct(model, item.url)) return null;
        if (imageUrl && imageUrl.startsWith('/')) {
          try { imageUrl = new URL(imageUrl, item.url).href; } catch { imageUrl = ''; }
        }
        const mirrored = imageUrl ? await mirrorImage(imageUrl, brandSlug, model) : '';
        const finalImg = mirrored || imageUrl;
        return {
          brand: brandName,
          model,
          description: description || model,
          price,
          currency,
          imageUrl: finalImg,
          productUrl: item.url,
          websiteUrl: item.url,
          officialProductUrl: item.url,
          verified: Boolean(finalImg),
          source: 'Supabase-Edge-Worker',
        };
      }));
      for (const r of results) if (r) extracted.push(r);
    }

    // Merge into legacy `brands` table + normalized `catalog_brands`/`catalog_products`
    let totalProducts = 0;
    if (extracted.length > 0) {
      const { data: allBrands } = await supabase.from('brands').select('id, name, products, budget_tier, logo, source');
      const existing = (allBrands || []).find((b) => String(b.name || '').toLowerCase().trim() === brandName.toLowerCase());
      const merged = Array.isArray(existing?.products) ? [...existing.products] : [];
      const seenModels = new Set(merged.map((p: Record<string, unknown>) => String(p.model || '').toLowerCase().trim()));
      for (const p of extracted) {
        const key = String(p.model || '').toLowerCase().trim();
        if (!seenModels.has(key)) {
          seenModels.add(key);
          merged.push(p);
        }
      }
      totalProducts = merged.length;
      const brandId = existing?.id || String(Date.now());
      await supabase.from('brands').upsert({
        id: String(brandId),
        name: brandName,
        products: merged,
        source: existing?.source || String(payload.origin || 'Supabase-Edge-Worker'),
        budget_tier: existing?.budget_tier || budgetTier,
        logo: existing?.logo || '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

      // Sync chunk into catalog_brands & catalog_products
      let domain: string | null = null;
      try { domain = new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
      const { data: v2Brand } = await supabase.from('catalog_brands').upsert({
        legacy_id: String(brandId),
        slug: brandSlug,
        name: brandName,
        budget_tier: budgetTier,
        origin: String(payload.origin || 'Supabase-Edge-Worker'),
        official_domain: domain,
        website_url: targetUrl,
        status: 'verified',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'slug' }).select('id').single();

      if (v2Brand?.id) {
        const v2Rows = extracted.map((p) => ({
          brand_id: v2Brand.id,
          model: String(p.model),
          model_normalized: String(p.model).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
          description: String(p.description || ''),
          price: Number(p.price) || 0,
          currency: String(p.currency || 'USD'),
          price_source: Number(p.price) > 0 ? 'scraped_retail' : 'unpriced',
          image_url: String(p.imageUrl || '') || null,
          official_url: String(p.productUrl || '') || null,
          verified: Boolean(p.verified),
          source: 'Supabase-Edge-Worker',
          updated_at: new Date().toISOString(),
        }));
        await supabase.from('catalog_products').upsert(v2Rows, { onConflict: 'brand_id,model_normalized' });
      }
    }

    const nextCursor = cursor + slice.length;
    const { data: freshJob } = await supabase.from('scrape_jobs').select('status').eq('id', job.id).maybeSingle();
    if (freshJob?.status === 'cancelled') {
      return new Response(JSON.stringify({ ok: true, jobId: job.id, cancelled: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const hasMore = nextCursor < pendingUrls.length;
    const progress = pendingUrls.length > 0
      ? (hasMore ? Math.min(95, Math.round((nextCursor / pendingUrls.length) * 100)) : 100)
      : 100;

    await supabase.from('scrape_jobs').update({
      status: hasMore ? 'running' : 'completed',
      progress,
      payload: hasMore ? { ...payload, pendingUrls, cursor: nextCursor } : { ...payload, pendingUrls: [], cursor: nextCursor },
      result_summary: {
        discoveredCount: pendingUrls.length,
        processedCount: nextCursor,
        scrapedChunk: extracted.length,
        totalProducts: totalProducts || Number(job.result_summary?.totalProducts || 0),
        worker: 'supabase-edge-chunked',
      },
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);

    if (hasMore && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const chainPromise = fetch(`${SUPABASE_URL}/functions/v1/scrape-worker`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ jobId: job.id }),
      }).catch(() => {});
      const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (edgeRuntime?.waitUntil) {
        edgeRuntime.waitUntil(chainPromise);
      } else {
        await Promise.race([chainPromise, new Promise((r) => setTimeout(r, 250))]);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      jobId: job.id,
      processed: nextCursor,
      discoveredCount: pendingUrls.length,
      hasMore,
      scrapedChunk: extracted.length,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
