import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { FITOUT_CATALOG_SEED, toLegacyFitoutBrand } from '../server/data/fitoutCatalogSeed.js';
import { FABRICATION_CATALOG_SEED } from '../server/data/fabricationCatalogSeed.js';
import { FITOUT_OFFICIAL_FINISH_CARDS, resolveItemFinishes } from '../src/utils/officialBrandFinishes.js';
import { getEmbedding } from '../server/embeddingService.js';
import { supabase, supabaseAdmin, uploadToSupabase } from '../server/utils/supabaseStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env.local') });

const client = supabaseAdmin || supabase;
if (!client) {
  console.error('❌ Missing Supabase client.');
  process.exit(1);
}

const aiSettingsPath = path.join(rootDir, 'server', 'data', 'ai-settings.json');
const aiSettings = fs.existsSync(aiSettingsPath) ? JSON.parse(fs.readFileSync(aiSettingsPath, 'utf8')) : {};
const GEMINI_API_KEY = String(
  process.env.GEMINI_API_KEY || aiSettings.googleApiKey || aiSettings.googleFreeKey || '',
).trim();
if (!GEMINI_API_KEY) {
  console.error('❌ Missing Gemini API key in env or server/data/ai-settings.json');
  process.exit(1);
}

const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
  'gemini-2.5-flash-image',
];

const PHOTO_CACHE_DIR = path.join(os.tmpdir(), 'boqflow-material-cache-v2');
fs.mkdirSync(PHOTO_CACHE_DIR, { recursive: true });
const FORCE_REGEN = process.argv.includes('--force');
const ASSET_VERSION = String(Date.now());

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a photorealistic architectural material/product sample photograph using Gemini
 * native image generation. Retries across fallback models and caches raw images in tmpdir.
 */
async function generateGeminiMaterialPhoto(cacheKey, promptText) {
  const safeKey = cacheKey.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const cacheFile = path.join(PHOTO_CACHE_DIR, `${safeKey}.bin`);
  const cacheMetaFile = path.join(PHOTO_CACHE_DIR, `${safeKey}.mime`);

  if (!FORCE_REGEN && fs.existsSync(cacheFile) && fs.existsSync(cacheMetaFile)) {
    const buf = fs.readFileSync(cacheFile);
    const mime = fs.readFileSync(cacheMetaFile, 'utf8').trim() || 'image/jpeg';
    if (buf.length > 10240) {
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
  }

  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const model = GEMINI_IMAGE_MODELS[attempt % GEMINI_IMAGE_MODELS.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(45000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Photorealistic architectural specification photography only. No text labels, no watermarks, no overlaid badges, no collage borders. ${promptText}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: '4:3' },
          },
        }),
      });

      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '');
        lastErr = `${model} HTTP ${resp.status}: ${bodyText.slice(0, 180)}`;
        const waitMs = resp.status === 429 ? 2500 * (attempt + 1) : 1200 * (attempt + 1);
        await sleep(waitMs);
        continue;
      }

      const json = await resp.json();
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find((p) => p?.inlineData?.data && String(p?.inlineData?.mimeType || '').startsWith('image/'));
      if (!imgPart) {
        lastErr = `${model} returned no inlineData image`;
        await sleep(1000);
        continue;
      }

      const mime = String(imgPart.inlineData.mimeType || 'image/jpeg').split(';')[0];
      const buf = Buffer.from(imgPart.inlineData.data, 'base64');
      if (buf.length <= 10240) {
        lastErr = `${model} image too small (${buf.length} bytes)`;
        await sleep(800);
        continue;
      }

      fs.writeFileSync(cacheFile, buf);
      fs.writeFileSync(cacheMetaFile, mime);
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch (err) {
      lastErr = `${model} error: ${err?.message || err}`;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw new Error(`Failed to generate material photo for ${cacheKey}: ${lastErr}`);
}

async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/**
 * Renders an 840x560 photorealistic material & finish sample card PNG:
 * - Top 75% (420px): full-bleed real material studio photo + subtle GCC manufacturer & spec pills
 * - Bottom 25% (140px): crisp title, system subtitle, and 3 official material finish swatches
 */
async function renderCardPng(page, item) {
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const chips = (item.finishes || []).slice(0, 3).map((f) => `
    <div style="flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:6px 9px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:7px;">
      <span style="width:18px;height:18px;border-radius:5px;background:${esc(f.hex)};border:1px solid rgba(15,23,42,0.18);flex-shrink:0;"></span>
      <div style="min-width:0;line-height:1.15;">
        <div style="font-size:10.5px;font-weight:700;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(f.code ? `${f.code} · ${f.name}` : f.name)}</div>
        <div style="font-size:9px;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(f.role || 'Finish')}</div>
      </div>
    </div>
  `).join('');

  const mfgBadge = item.manufacturer
    ? `<span style="background:rgba(15,23,42,0.86);color:#FFFFFF;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.3px;backdrop-filter:blur(4px);box-shadow:0 2px 6px rgba(0,0,0,0.22);">${esc(item.manufacturer)}</span>`
    : `<span style="background:rgba(30,41,59,0.78);color:#E2E8F0;padding:5px 11px;border-radius:999px;font-size:10.5px;font-weight:700;letter-spacing:0.3px;">${esc(item.category || 'GCC Standard')}</span>`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;width:840px;height:560px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FFFFFF;">
    <div style="width:840px;height:560px;border:1px solid #E2E8F0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;background:#FFFFFF;">
      <div style="width:840px;height:412px;position:relative;overflow:hidden;background:#E2E8F0;flex-shrink:0;">
        <img src="${item.photoDataUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" />
        <div style="position:absolute;left:0;right:0;bottom:0;height:86px;background:linear-gradient(to top,rgba(15,23,42,0.52),rgba(15,23,42,0));pointer-events:none;"></div>
        <div style="position:absolute;left:16px;right:16px;bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
          ${mfgBadge}
          <span style="background:rgba(255,255,255,0.94);color:#0F172A;padding:5px 10px;border-radius:999px;font-size:10.5px;font-weight:700;letter-spacing:0.3px;box-shadow:0 2px 6px rgba(0,0,0,0.16);">
            ${esc(item.code)} · ${esc(item.specBadge || item.category)}
          </span>
        </div>
      </div>
      <div style="flex:1;padding:13px 18px 14px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;background:#FFFFFF;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;">
          <div style="min-width:0;flex:1;">
            <div style="font-size:16px;font-weight:800;color:#0F172A;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.name)}</div>
          </div>
          <div style="font-size:11px;font-weight:700;color:#2D66F6;white-space:nowrap;">${esc(item.brandSystem)}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:stretch;">
          ${chips}
        </div>
      </div>
    </div>
  </body></html>`;

  await page.setContent(html, { waitUntil: 'load' });
  return await page.screenshot({ type: 'png' });
}

function buildFabPhotoPrompt(fb) {
  if (fb.design_build_kind === 'sanitary' || /vanity|washroom/i.test(fb.category + fb.name)) {
    return `Studio architectural joinery & stone detail photograph of ${fb.name}, featuring ${fb.material_spec_mid}, crisp DuPont Corian Glacier White thermoformed solid surface edge meeting fluted walnut marine veneer cabinetry and chrome basin hardware, bright showroom light`;
  }
  return `Studio architectural custom millwork and interior joinery material photograph of ${fb.name}: ${fb.material_spec_mid}. Show real Egger timber grain, engineered quartz vein edge or architectural PVD metalwork joints in warm studio daylight cleanly framed`;
}

console.log(`1. Generating photorealistic material photos via Gemini (${FITOUT_CATALOG_SEED.length} FitOut + ${FABRICATION_CATALOG_SEED.length} Fab)...`);

const fitoutTasks = FITOUT_CATALOG_SEED.map((it) => {
  const cardMeta = FITOUT_OFFICIAL_FINISH_CARDS[it.code] || {};
  const prompt = cardMeta.photoPrompt || `Studio material swatch photography for commercial architectural specification: ${it.name}, ${it.spec_mid}`;
  return { it, cardMeta, prompt };
});

const fitoutPhotos = await runPool(fitoutTasks, 5, async ({ it, prompt }, idx) => {
  const photoDataUrl = await generateGeminiMaterialPhoto(`fitout-${it.code}`, prompt);
  console.log(`   [FitOut Photo ${idx + 1}/${fitoutTasks.length}] ${it.code} (${it.manufacturer || 'Generic GCC'}) ready`);
  return photoDataUrl;
});

const fabPhotos = await runPool(FABRICATION_CATALOG_SEED, 5, async (fb, idx) => {
  const prompt = buildFabPhotoPrompt(fb);
  const photoDataUrl = await generateGeminiMaterialPhoto(`fab-${fb.sku_code}`, prompt);
  console.log(`   [Fab Photo ${idx + 1}/${FABRICATION_CATALOG_SEED.length}] ${fb.sku_code} ready`);
  return photoDataUrl;
});

console.log('2. Rendering PNG swatch cards, refreshing embeddings & uploading to Supabase Storage...');
const imageMap = { fitout: {}, fabrication: {} };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 840, height: 560 } });

for (let i = 0; i < FITOUT_CATALOG_SEED.length; i++) {
  const it = FITOUT_CATALOG_SEED[i];
  const cardMeta = FITOUT_OFFICIAL_FINISH_CARDS[it.code] || {
    manufacturer: it.manufacturer || '',
    brandSystem: it.brand_system || it.trade,
    specBadge: it.unit,
    finishes: resolveItemFinishes({ model: it.code, description: it.spec_mid, brand: 'FitOut V2' }),
  };
  const png = await renderCardPng(page, {
    code: it.code,
    name: it.name,
    category: it.trade,
    manufacturer: cardMeta.manufacturer ?? it.manufacturer ?? '',
    brandSystem: cardMeta.brandSystem || it.brand_system || it.trade,
    specBadge: cardMeta.specBadge || it.unit,
    finishes: cardMeta.finishes || it.finishes,
    photoDataUrl: fitoutPhotos[i],
  });
  const slug = it.code.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const uploaded = await uploadToSupabase('product-images', `fitout-v2/${slug}.png`, png, {
    contentType: 'image/png',
    cacheControl: '31536000',
    public: true,
    fileSizeLimit: 10485760,
  });
  const versionedUrl = `${uploaded.url}?v=${ASSET_VERSION}`;
  imageMap.fitout[it.code] = versionedUrl;

  const vec = await getEmbedding(
    `${it.code} | ${it.trade} | ${it.sub_trade} | ${it.name} | ${cardMeta.brandSystem || ''} | ${it.spec_mid}`,
  );
  const { error } = await client.from('fitout_catalog').upsert({
    code: it.code,
    trade: it.trade,
    sub_trade: it.sub_trade,
    unit: it.unit,
    name: it.name,
    spec_budgetary: it.spec_budgetary,
    rate_budgetary: it.rate_budgetary,
    spec_mid: it.spec_mid,
    rate_mid: it.rate_mid,
    spec_high: it.spec_high,
    rate_high: it.rate_high,
    currency: it.currency,
    image_url: versionedUrl,
    embedding: vec || null,
  }, { onConflict: 'code' });
  if (error) throw error;
  console.log(`   [${i + 1}/${FITOUT_CATALOG_SEED.length}] ${it.code} -> uploaded & upserted`);
}

for (let i = 0; i < FABRICATION_CATALOG_SEED.length; i++) {
  const fb = FABRICATION_CATALOG_SEED[i];
  const finishes = resolveItemFinishes({
    brand: 'Custom Fabrication',
    model: fb.name,
    description: fb.description_template,
    category: fb.category,
    materialSpec: fb.material_spec_mid,
  });
  const png = await renderCardPng(page, {
    code: fb.sku_code,
    name: fb.name,
    category: fb.category,
    manufacturer: fb.workshop_trade === 'Stone/Corian' ? 'Corian® / Silestone® / SS 304' : 'Bespoke GCC Millwork',
    brandSystem: fb.workshop_trade === 'Stone/Corian' ? 'Solid Surface & Engineered Quartz' : 'Egger® Veneer + Acoustic Joinery',
    specBadge: `${fb.shape} · ${fb.pricing_unit} · ${fb.lead_time_days}d lead`,
    finishes,
    photoDataUrl: fabPhotos[i],
  });
  const slug = fb.sku_code.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const uploaded = await uploadToSupabase('product-images', `fabrication/${slug}.png`, png, {
    contentType: 'image/png',
    cacheControl: '31536000',
    public: true,
    fileSizeLimit: 10485760,
  });
  const versionedUrl = `${uploaded.url}?v=${ASSET_VERSION}`;
  imageMap.fabrication[fb.sku_code] = versionedUrl;
  const { error } = await client.from('fabrication_catalog').update({ image_url: versionedUrl }).eq('sku_code', fb.sku_code);
  if (error) throw error;
  console.log(`   [${i + 1}/${FABRICATION_CATALOG_SEED.length}] ${fb.sku_code} -> uploaded & updated`);
}

await browser.close();

const mapPath = path.join(rootDir, 'server', 'data', 'fitoutFabImages.json');
fs.writeFileSync(mapPath, JSON.stringify(imageMap, null, 2));
console.log(`3. Wrote ${mapPath} (${Object.keys(imageMap.fitout).length} fitout + ${Object.keys(imageMap.fabrication).length} fab URLs)`);

for (const tier of ['budgetary', 'mid', 'high']) {
  const legacyObj = toLegacyFitoutBrand(tier);
  legacyObj.products = legacyObj.products.map((p) => ({
    ...p,
    imageUrl: imageMap.fitout[p.model] || p.imageUrl || '',
  }));
  const jsonPath = path.join(rootDir, 'server', 'data', 'brands', `fitout_v2-${tier}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(legacyObj, null, 2));
  const { error } = await client.from('brands').update({ products: legacyObj.products }).eq('id', String(legacyObj.id));
  if (error) console.warn(`   ⚠️ Legacy brand update skipped for ${tier}: ${error.message}`);
  else console.log(`   ✅ Synced fitout_v2-${tier}.json & public.brands (${legacyObj.products.length} items)`);
}

console.log(`🎉 ALL ${FITOUT_CATALOG_SEED.length + FABRICATION_CATALOG_SEED.length} PHOTOREALISTIC MATERIAL CARDS ENRICHED AND SYNCED!`);
