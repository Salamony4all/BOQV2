/**
 * Supabase-First Dual-Mode Catalog, Fit-Out, Custom Fabrication, Match Cache & Scrape Job Repository.
 * Uses normalized V2 Postgres tables + pgvector RPCs when migrated, with clean in-process / JSON fallback
 * on sanitized legacy data so zero endpoints break before or after SQL migration apply.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { supabase, supabaseAdmin, uploadToSupabase } from '../utils/supabaseStorage.js';
import { brandStorage } from '../storageProvider.js';
import { FITOUT_CATALOG_SEED } from '../data/fitoutCatalogSeed.js';
import { FABRICATION_CATALOG_SEED } from '../data/fabricationCatalogSeed.js';
import { FITOUT_OFFICIAL_FINISH_CARDS, resolveFitoutManufacturer } from '../../src/utils/officialBrandFinishes.js';
import { classifyFurnishingCategory } from '../utils/veCategoryPriority.js';
import { computeParametricFabricationRate } from '../utils/customFabricationDetector.js';
import { computeTokenOverlapDetail, cosineSimilarity, getEmbedding } from '../embeddingService.js';
import { isBadOrPlaceholderImageUrl, resolveAndPersistMissingImage } from '../utils/catalogHygiene.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isVercel = process.env.VERCEL === '1';

const CUSTOM_FAB_LOCAL_PATH = isVercel
  ? '/tmp/fabrication_custom.json'
  : path.resolve(__dirname, '../data/fabrication_custom.json');

// Bounded in-process fallback caches when match_cache / scrape_jobs tables aren't migrated yet
const LOCAL_MATCH_CACHE = new Map();
const LOCAL_SCRAPE_JOBS = new Map();
const MAX_LOCAL_CACHE = 400;

let schemaProbeCache = { checkedAt: 0, hasV2: false };
const SCHEMA_PROBE_TTL_MS = 60_000;

export function normalizeBudgetTier(raw = 'mid') {
  const t = String(raw || 'mid').toLowerCase().trim();
  if (t === 'budgetary' || t === 'budget' || t === 'economy' || t === 'low') return 'budgetary';
  if (t === 'high' || t === 'premium' || t === 'luxury') return 'high';
  return 'mid';
}

export const CATEGORY_BENCHMARK_RATES_OMR = {
  taskSeating: { budgetary: 45, mid: 115, high: 265 },
  softSeating: { budgetary: 140, mid: 320, high: 690 },
  desking: { budgetary: 95, mid: 225, high: 480 },
  tables: { budgetary: 75, mid: 185, high: 420 },
  storage: { budgetary: 65, mid: 145, high: 310 },
  steelStorage: { budgetary: 55, mid: 110, high: 220 },
  heavyDutyAndMobileFiling: { budgetary: 180, mid: 340, high: 580 },
  auditoriumAndTheater: { budgetary: 85, mid: 175, high: 350 },
  cinemaSeating: { budgetary: 110, mid: 210, high: 390 },
  classroomAndStackable: { budgetary: 28, mid: 65, high: 145 },
  diningSeating: { budgetary: 32, mid: 82, high: 195 },
  outdoorSeating: { budgetary: 48, mid: 135, high: 340 },
  benchesAndPublicSeating: { budgetary: 120, mid: 270, high: 540 },
  foldingAndPortableSeating: { budgetary: 22, mid: 52, high: 110 },
  commercialAccessories: { budgetary: 25, mid: 75, high: 180 },
  genericAccessories: { budgetary: 15, mid: 35, high: 75 },
  bedsAndAccommodation: { budgetary: 90, mid: 180, high: 340 },
  customLandscapeAndTerrazzo: { budgetary: 220, mid: 410, high: 680 },
  fitoutArchitectural: { budgetary: 22, mid: 38, high: 68 },
};

export function resolveBenchmarkPriceOMR(archetype = 'desking', tier = 'mid') {
  const t = normalizeBudgetTier(tier);
  const row = CATEGORY_BENCHMARK_RATES_OMR[archetype] || CATEGORY_BENCHMARK_RATES_OMR.desking;
  return row[t] || row.mid;
}

export async function hasNormalizedSchema(force = false) {
  if (!supabaseAdmin && !supabase) return false;
  if (!force && (Date.now() - schemaProbeCache.checkedAt) < SCHEMA_PROBE_TTL_MS) {
    return schemaProbeCache.hasV2;
  }
  const client = supabaseAdmin || supabase;
  try {
    const { error } = await client.from('fabrication_catalog').select('id').limit(1);
    const ok = !error;
    schemaProbeCache = { checkedAt: Date.now(), hasV2: ok };
    return ok;
  } catch {
    schemaProbeCache = { checkedAt: Date.now(), hasV2: false };
    return false;
  }
}

export function buildSpecHash({ description = '', mode = 've_auto', tier = 'mid', qty = '', unit = '', brands = [] }) {
  const clean = [
    String(mode),
    normalizeBudgetTier(tier),
    String(description || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    String(qty || '').trim(),
    String(unit || '').trim(),
    Array.isArray(brands) ? brands.slice().sort().join(',') : '',
  ].join('|');
  return crypto.createHash('sha256').update(clean).digest('hex');
}

// ──────────────────────────────────────────────────────────────────────────────
// Persistent Match Cache
// ──────────────────────────────────────────────────────────────────────────────

export async function getMatchCache(specHash) {
  if (!specHash) return null;
  const local = LOCAL_MATCH_CACHE.get(specHash);
  if (local && local.expiresAt > Date.now()) {
    return local.data;
  }
  if (await hasNormalizedSchema()) {
    try {
      const client = supabaseAdmin || supabase;
      const { data } = await client
        .from('match_cache')
        .select('result_json, expires_at')
        .eq('spec_hash', specHash)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (data?.result_json) {
        LOCAL_MATCH_CACHE.set(specHash, { data: data.result_json, expiresAt: Date.now() + 30 * 60_000 });
        return data.result_json;
      }
    } catch { /* fall through */ }
  }
  return null;
}

export async function setMatchCache(specHash, mode, tier, resultJson) {
  if (!specHash || !resultJson) return;
  if (LOCAL_MATCH_CACHE.size >= MAX_LOCAL_CACHE) {
    LOCAL_MATCH_CACHE.delete(LOCAL_MATCH_CACHE.keys().next().value);
  }
  LOCAL_MATCH_CACHE.set(specHash, { data: resultJson, expiresAt: Date.now() + 30 * 60_000 });

  if (await hasNormalizedSchema()) {
    try {
      const client = supabaseAdmin || supabase;
      await client.from('match_cache').upsert({
        spec_hash: specHash,
        mode: String(mode || 've_auto'),
        tier: tier ? normalizeBudgetTier(tier) : null,
        result_json: resultJson,
        expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'spec_hash' });
    } catch { /* non-fatal */ }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Custom Fabrication Repository (Supabase + Seed/JSON Overlay)
// ──────────────────────────────────────────────────────────────────────────────

function readLocalCustomOverlay() {
  try {
    if (!fs.existsSync(CUSTOM_FAB_LOCAL_PATH)) return [];
    const raw = fs.readFileSync(CUSTOM_FAB_LOCAL_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCustomOverlay(items) {
  try {
    fs.mkdirSync(path.dirname(CUSTOM_FAB_LOCAL_PATH), { recursive: true });
    fs.writeFileSync(CUSTOM_FAB_LOCAL_PATH, JSON.stringify(items, null, 2));
  } catch { /* ignore */ }
}

export async function listFabricationCatalog({ q = '', category = '', designBuildKind = '', shape = '' } = {}) {
  let rows = [];
  if (await hasNormalizedSchema()) {
    try {
      const client = supabaseAdmin || supabase;
      let query = client.from('fabrication_catalog').select('*').eq('active', true).order('sku_code');
      if (category) query = query.ilike('category', `%${category}%`);
      if (designBuildKind) query = query.eq('design_build_kind', designBuildKind);
      if (shape) query = query.eq('shape', shape);
      const { data, error } = await query;
      if (!error && Array.isArray(data) && data.length > 0) rows = data;
    } catch { /* fallback below */ }
  }

  if (rows.length === 0) {
    const custom = readLocalCustomOverlay();
    rows = [...FABRICATION_CATALOG_SEED.map((s, idx) => ({ id: s.sku_code || `fab-${idx}`, ...s })), ...custom];
    if (category) rows = rows.filter(r => String(r.category || '').toLowerCase().includes(category.toLowerCase()));
    if (designBuildKind) rows = rows.filter(r => String(r.design_build_kind || '').toLowerCase() === designBuildKind.toLowerCase());
    if (shape) rows = rows.filter(r => String(r.shape || '').toLowerCase() === shape.toLowerCase());
  }

  if (q && q.trim()) {
    const ql = q.toLowerCase().trim();
    rows = rows.filter(r =>
      `${r.sku_code} ${r.name} ${r.category} ${r.description_template} ${(r.detection_keywords || []).join(' ')}`.toLowerCase().includes(ql)
    );
  }
  return rows;
}

export async function createFabricationItem(payload = {}) {
  const cleanName = String(payload.name || '').trim();
  if (!cleanName) throw new Error('Custom fabrication item name is required');

  let imageUrl = String(payload.imageUrl || payload.image_url || '').trim();
  const imageDataUrl = String(payload.imageDataUrl || '').trim();
  if (imageDataUrl.startsWith('data:image/')) {
    const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      const ext = match[1].includes('png') ? 'png' : match[1].includes('webp') ? 'webp' : 'jpg';
      const buf = Buffer.from(match[2], 'base64');
      const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48) || 'custom';
      try {
        const uploaded = await uploadToSupabase('fabrication-assets', `${Date.now()}_${slug}.${ext}`, buf, {
          contentType: match[1],
          public: true,
        });
        if (uploaded?.url) imageUrl = uploaded.url;
      } catch { /* keep fallback dataUrl if Supabase upload fails offline */ }
      if (!imageUrl) imageUrl = imageDataUrl;
    }
  }

  const skuCode = String(payload.sku_code || payload.skuCode || `FAB-USR-${Date.now().toString(36).toUpperCase()}`);
  const rateMid = Number(payload.rate_mid ?? payload.rate ?? 0) || 0;
  const item = {
    sku_code: skuCode,
    name: cleanName,
    category: String(payload.category || 'Joinery & Millwork'),
    sub_category: String(payload.sub_category || payload.subCategory || 'Bespoke Item'),
    description_template: String(payload.description_template || payload.description || `${cleanName} — bespoke workshop fabrication`),
    pricing_unit: ['Nos', 'LM', 'SQM'].includes(payload.pricing_unit) ? payload.pricing_unit : 'Nos',
    default_width_mm: Number(payload.default_width_mm || payload.widthMm || 0) || null,
    default_depth_mm: Number(payload.default_depth_mm || payload.depthMm || 0) || null,
    default_height_mm: Number(payload.default_height_mm || payload.heightMm || 0) || null,
    shape: String(payload.shape || 'rectangular'),
    currency: String(payload.currency || 'OMR'),
    rate_budgetary: Number(payload.rate_budgetary ?? (rateMid > 0 ? Math.round(rateMid * 0.7) : 0)),
    rate_mid: rateMid,
    rate_high: Number(payload.rate_high ?? (rateMid > 0 ? Math.round(rateMid * 1.55) : 0)),
    material_spec_budgetary: String(payload.material_spec_budgetary || payload.materialSpec || ''),
    material_spec_mid: String(payload.material_spec_mid || payload.materialSpec || ''),
    material_spec_high: String(payload.material_spec_high || payload.materialSpec || ''),
    lead_time_days: Number(payload.lead_time_days || payload.leadTimeDays || 21),
    workshop_trade: String(payload.workshop_trade || payload.workshopTrade || 'Joinery'),
    design_build_kind: String(payload.design_build_kind || payload.designBuildKind || ''),
    render_prompt_hint: String(payload.render_prompt_hint || ''),
    image_url: imageUrl,
    detection_keywords: Array.isArray(payload.detection_keywords) ? payload.detection_keywords : [cleanName.toLowerCase()],
    active: true,
  };

  if (await hasNormalizedSchema()) {
    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from('fabrication_catalog')
      .upsert(item, { onConflict: 'sku_code' })
      .select()
      .single();
    if (!error && data) return data;
  }

  const overlay = readLocalCustomOverlay().filter(x => x.sku_code !== item.sku_code);
  const saved = { id: skuCode, ...item, created_at: new Date().toISOString() };
  overlay.push(saved);
  writeLocalCustomOverlay(overlay);
  return saved;
}

export async function deleteFabricationItem(idOrSku) {
  if (await hasNormalizedSchema()) {
    const client = supabaseAdmin || supabase;
    await client.from('fabrication_catalog').delete().or(`id.eq.${idOrSku},sku_code.eq.${idOrSku}`);
  }
  const overlay = readLocalCustomOverlay().filter(x => String(x.id) !== String(idOrSku) && String(x.sku_code) !== String(idOrSku));
  writeLocalCustomOverlay(overlay);
  return true;
}

export async function searchFabricationHybrid({
  queryText = '',
  queryEmbedding = null,
  tier = 'mid',
  designBuildKind = null,
  shape = null,
  parsedDimsMm = null,
  qty = 1,
  unit = 'Nos',
  topK = 5,
} = {}) {
  const normTier = normalizeBudgetTier(tier);
  const cleanQuery = String(queryText || '')
    .replace(/\|\s*(?:s\.?n\.?|item|room|location|area|total(?:\s*qty)?|qty|unit|supplier|model|scope)\s*:[^|]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || String(queryText || '').trim();
  const headline = cleanQuery.split(/\s*[—–\-|]\s*|\s*,\s*|\s+with\s+/i)[0].trim() || cleanQuery;
  const headlineTokens = headline.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
  const qLow = cleanQuery.toLowerCase();
  const qTokens = qLow.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);

  let candidates = [];
  if (await hasNormalizedSchema()) {
    try {
      const client = supabaseAdmin || supabase;
      let qVec = queryEmbedding;
      if (!qVec && cleanQuery) {
        qVec = await getEmbedding(cleanQuery).catch(() => null);
      }
      const { data, error } = await client.rpc('match_fabrication_hybrid', {
        query_embedding: qVec || null,
        query_text: cleanQuery,
        filter_db_kind: designBuildKind || null,
        filter_shape: shape || null,
        match_count: Math.max(topK * 3, 12),
      });
      if (!error && Array.isArray(data) && data.length > 0) candidates = data;
    } catch { /* fallback below */ }
  }

  if (candidates.length === 0) {
    candidates = await listFabricationCatalog();
  }

  // Re-rank with headline priority + Design & Build kind + shape + semantic vector similarity
  const ranked = candidates
    .map((item) => {
      const hay = `${item.name || ''} ${item.category || ''} ${item.sub_category || ''} ${item.description_template || ''} ${(item.detection_keywords || []).join(' ')}`.toLowerCase();
      let kwScore = 0;
      for (const kw of (item.detection_keywords || [])) {
        const kl = String(kw || '').toLowerCase();
        if (!kl) continue;
        if (headline.toLowerCase().includes(kl)) kwScore += 0.45;
        else if (qLow.includes(kl)) kwScore += 0.25;
      }
      const headlineHits = headlineTokens.filter(t => hay.includes(t)).length;
      const headlineRatio = headlineTokens.length ? headlineHits / headlineTokens.length : 0;
      const bodyHits = qTokens.filter(t => hay.includes(t)).length;
      const bodyRatio = qTokens.length ? bodyHits / qTokens.length : 0;
      const kindBonus = designBuildKind && item.design_build_kind === designBuildKind ? 0.35 : 0;
      const shapeBonus = shape && item.shape === shape ? 0.15 : 0;
      const vecSim = Number(item.cosine_sim || 0);
      const rpcScore = Number(item.hybrid_score || 0);
      const hybrid_score = (vecSim * 0.35) + (rpcScore * 0.2) + (headlineRatio * 0.45) + (bodyRatio * 0.2) + kwScore + kindBonus + shapeBonus;
      return { ...item, hybrid_score };
    })
    .sort((a, b) => b.hybrid_score - a.hybrid_score)
    .slice(0, topK);

  return ranked.map((tpl) => {
    const calc = computeParametricFabricationRate(tpl, normTier, parsedDimsMm, qty, unit);
    return {
      ...tpl,
      computedRate: calc.unitRate,
      computedCurrency: calc.currency,
      computedMaterialSpec: calc.materialSpec,
      pricingBasis: calc.pricingBasis,
      tier: normTier,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Architectural Fit-Out Repository (3-Tier Normalized + Clean Seed Fallback)
// ──────────────────────────────────────────────────────────────────────────────

const FITOUT_PRELIM_QUERY_RE = /\b(mobiliz|site\s*setup|temporary\s*(?:office|water|power)|hse|health\s*(?:&|and)\s*safety|debris|housekeeping|clean(?:ing)?|insurance|preliminar|handover)\b/i;

const FITOUT_TRADE_INTENT_RULES = [
  { queryRe: /\b(drywall|gypsum\s*(?:board\s*)?partition|plasterboard\s*partition)\b/i, codePrefix: 'PT-DRY-' },
  { queryRe: /\b(glass\s*partition|glazed\s*partition|frameless\s*partition)\b/i, codePrefix: 'PT-GLS-' },
  { queryRe: /\b(tv|television|led\s*display|display\s*screen|digital\s*signage|projector|video\s*wall|\d{2}\s*[-"]?\s*inch\s*(?:led|lcd|uhd|4k|display|tv|screen))\b/i, codePrefix: 'MEP-AV-01' },
  { queryRe: /\b(wc\b|toilet|water\s*closet|bidet|urinal)\b/i, codePrefix: 'MEP-SAN-02' },
  { queryRe: /\b(wash\s*basin|hand\s*basin|lavatory|countertop\s*(?:wash\s*)?basin|undermount\s*basin)\b/i, codePrefix: 'MEP-SAN-03' },
  { queryRe: /\b(shower\s*(?:head|mixer|set)|thermostatic\s*shower)\b/i, codePrefix: 'MEP-SAN-04' },
  { queryRe: /\b(pantry\s*sink|kitchen\s*sink|stainless.*sink)\b/i, codePrefix: 'MEP-SAN-01' },
  { queryRe: /\bcarpet\b/i, codePrefix: 'FL-CPT-' },
  { queryRe: /\b(porcelain|ceramic).*\btile|\btile\b.*\b(floor|porcelain|ceramic)\b/i, codePrefix: 'FL-POR-' },
  { queryRe: /\bskirting\b/i, codePrefix: 'FN-SKT-' },
  { queryRe: /\b(gypsum.*ceiling|false\s*ceiling|suspended\s*ceiling)\b/i, codePrefix: 'CL-GYP-01' },
  { queryRe: /\b(mineral\s*fiber.*ceiling|acoustic\s*(?:grid|tile)\s*ceiling)\b/i, codePrefix: 'CL-ACU-01' },
  { queryRe: /\bswing\s*door\b/i, codePrefix: 'DR-SWG-' },
  { queryRe: /\bsliding\s*door\b/i, codePrefix: 'DR-SLD-01' },
  { queryRe: /\b(downlight|panel\s*light|led\s*panel)\b/i, codePrefix: 'MEP-LGT-01' },
  { queryRe: /\b(strip\s*light|linear\s*led|cove\s*led|led\s*strip)\b/i, codePrefix: 'MEP-LGT-02' },
];

export async function searchFitoutHybrid({ queryText = '', queryEmbedding = null, tier = 'mid', unitHint = '', topK = 5 } = {}) {
  const normTier = normalizeBudgetTier(tier);
  const normUnit = /^(sqm|lm|nos)$/i.test(String(unitHint || '').trim()) ? String(unitHint).trim().toUpperCase() : null;
  const cleanQuery = String(queryText || '')
    .replace(/\|\s*(?:s\.?n\.?|item|room|location|area|total(?:\s*qty)?|qty|unit|supplier|model|scope)\s*:[^|]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || String(queryText || '').trim();
  const qLow = cleanQuery.toLowerCase();
  const qTokens = Array.from(new Set(
    qLow.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !/^(with|thick|type|work|works|system|complete|including|approx|size)$/.test(w))
  ));

  let rows = [];
  if (await hasNormalizedSchema()) {
    try {
      const client = supabaseAdmin || supabase;
      let qVec = queryEmbedding;
      if (!qVec && cleanQuery) {
        qVec = await getEmbedding(cleanQuery).catch(() => null);
      }
      // Keep filter_unit null so LM-measured partitions still match SQM partition catalog rows cleanly
      const { data, error } = await client.rpc('match_fitout_hybrid', {
        query_embedding: qVec || null,
        query_text: cleanQuery,
        filter_unit: null,
        match_count: 55,
      });
      if (!error && Array.isArray(data) && data.length > 0) {
        rows = data;
      }
    } catch { /* fallback */ }
  }

  if (rows.length === 0) {
    rows = FITOUT_CATALOG_SEED;
  }

  const isPrelimQuery = FITOUT_PRELIM_QUERY_RE.test(cleanQuery);
  const activeTradeBoosts = FITOUT_TRADE_INTENT_RULES.filter(rule => rule.queryRe.test(cleanQuery));

  // Re-rank with vector similarity + lexical overlap + trade intent boosts + General Requirements guard + soft unit bonus
  const ranked = rows.map((r) => {
    const codeUpper = String(r.code || '').toUpperCase();
    const hay = `${r.code || ''} ${r.name || ''} ${r.trade || ''} ${r.sub_trade || ''} ${r[`spec_${normTier}`] || r.spec_mid || ''}`.toLowerCase();
    const hits = qTokens.filter(t => hay.includes(t)).length;
    const lexScore = qTokens.length ? (hits / qTokens.length) : 0;
    const codeHit = r.code && qLow.includes(String(r.code).toLowerCase()) ? 0.4 : 0;
    const unitBonus = (normUnit && String(r.unit || '').toUpperCase() === normUnit) ? 0.06 : 0;
    const prelimPenalty = (r.trade === 'General Requirements' && !isPrelimQuery) ? -0.75 : 0;
    let tradeBoost = 0;
    for (const tb of activeTradeBoosts) {
      if (codeUpper.startsWith(tb.codePrefix)) {
        tradeBoost += 0.42;
      }
    }
    // Never let an AV / display screen match sanitaryware via generic "wall-mounted" phrase
    const isAvQuery = /\b(tv|television|led\s*display|display\s*screen|monitor|digital\s*signage|projector)\b/i.test(cleanQuery);
    const sanAvPenalty = (isAvQuery && codeUpper.startsWith('MEP-SAN-')) ? -0.9 : 0;
    const vecSim = Number(r.cosine_sim || 0);
    const rpcScore = Number(r.hybrid_score || 0);
    const finalScore = (vecSim > 0 ? vecSim * 0.45 : 0) + (rpcScore * 0.2) + (lexScore * 0.55) + codeHit + unitBonus + tradeBoost + prelimPenalty + sanAvPenalty;
    return { ...r, _fitoutFinalScore: finalScore };
  })
    .sort((a, b) => b._fitoutFinalScore - a._fitoutFinalScore)
    .slice(0, topK);

  return ranked.map((r) => {
    const meta = FITOUT_OFFICIAL_FINISH_CARDS[r.code] || {};
    const manufacturer = resolveFitoutManufacturer({ code: r.code, description: r[`spec_${normTier}`] || r.spec_mid }) || '';
    return {
      id: r.id || r.code,
      code: r.code,
      brand: 'FitOut V2',
      manufacturer,
      brandSystem: meta.brandSystem || r.brand_system || '',
      model: r.code,
      name: r.name,
      mainCategory: r.trade,
      subCategory: r.sub_trade || r.trade,
      family: String(r.code || '').split('-')[0] || 'FITOUT',
      unit: r.unit,
      price: Number(r[`rate_${normTier}`] ?? r.rate_mid ?? 0),
      currency: r.currency || 'OMR',
      description: `${r.name} — ${r[`spec_${normTier}`] || r.spec_mid}`,
      imageUrl: r.image_url || '',
      priceSource: 'fitout_catalog_3tier',
      tier: normTier,
      score: r._fitoutFinalScore || r.hybrid_score || 0,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Contract Furniture Hybrid Search (Strict Tier Isolation + Honest Vector Scoring)
// ──────────────────────────────────────────────────────────────────────────────

export async function searchProductsHybrid({
  queryText = '',
  queryEmbedding = null,
  tier = null,
  archetype = null,
  brandNames = null,
  allowTierFallback = false,
  topK = 8,
  apiKey = null,
} = {}) {
  const normTier = tier ? normalizeBudgetTier(tier) : null;
  const brandSlugs = Array.isArray(brandNames) && brandNames.length > 0
    ? brandNames.map(n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    : null;

  if (await hasNormalizedSchema()) {
    try {
      const client = supabaseAdmin || supabase;
      let qVec = queryEmbedding;
      if (!qVec) {
        qVec = await getEmbedding(queryText, apiKey).catch(() => null);
      }
      const { data, error } = await client.rpc('match_products_hybrid', {
        query_embedding: qVec || null,
        query_text: queryText,
        filter_tier: normTier,
        filter_archetype: archetype || null,
        filter_brand_slugs: brandSlugs,
        match_count: topK,
      });
      let merged = !error && Array.isArray(data) ? [...data] : [];

      // If strict archetype yielded <2 hits, broaden to all archetypes inside the SAME strict budget tier
      if (archetype && merged.length < 2) {
        const { data: wideData, error: wideErr } = await client.rpc('match_products_hybrid', {
          query_embedding: qVec || null,
          query_text: queryText,
          filter_tier: normTier,
          filter_archetype: null,
          filter_brand_slugs: brandSlugs,
          match_count: topK,
        });
        if (!wideErr && Array.isArray(wideData) && wideData.length > 0) {
          const seenIds = new Set(merged.map(r => r.product_id));
          for (const row of wideData) {
            if (!seenIds.has(row.product_id)) {
              seenIds.add(row.product_id);
              merged.push(row);
              if (merged.length >= topK) break;
            }
          }
        }
      }

      if (merged.length > 0) {
        if (isBadOrPlaceholderImageUrl(merged[0].image_url) && merged[0].product_id) {
          const healedImg = await resolveAndPersistMissingImage(merged[0], client, 4500);
          if (healedImg) merged[0].image_url = healedImg;
        }
        return merged.map(r => ({
          ...r,
          price: Number(r.price) > 0 ? Number(r.price) : resolveBenchmarkPriceOMR(r.archetype || archetype || 'desking', r.brand_tier || normTier || 'mid'),
          priceSource: Number(r.price) > 0 ? (r.price_source || 'scraped_retail') : 'category_benchmark',
          tierFallback: false,
        }));
      }
    } catch { /* fallback below */ }
  }

  // Fallback over sanitized Supabase/legacy brands via brandStorage
  const allBrands = await brandStorage.getAllBrands();
  const effectiveArch = archetype || classifyFurnishingCategory(queryText);

  const pickPool = (enforceTier) => allBrands.filter((b) => {
    if (!b || !b.name || /fitout/i.test(b.name) || b.type === 'fitout') return false;
    if (!Array.isArray(b.products) || b.products.length === 0) return false;
    if (Array.isArray(brandNames) && brandNames.length > 0) {
      const bLow = b.name.toLowerCase().trim();
      if (!brandNames.some(req => String(req).toLowerCase().trim() === bLow)) return false;
    }
    if (enforceTier && normTier) {
      if (normalizeBudgetTier(b.budgetTier || b.budget_tier) !== normTier) return false;
    }
    return true;
  });

  let poolBrands = pickPool(true);
  let usedTierFallback = false;
  if (poolBrands.length === 0 && allowTierFallback) {
    poolBrands = pickPool(false);
    usedTierFallback = true;
  }

  const scored = [];
  for (const b of poolBrands) {
    for (const p of b.products) {
      if (!p || !p.model) continue;
      const tok = computeTokenOverlapDetail(queryText, p);
      if (tok.score <= 0.05) continue;
      const vecSim = (queryEmbedding && Array.isArray(p._vector)) ? cosineSimilarity(queryEmbedding, p._vector) : null;
      const verifiedBoost = p.verified ? 0.08 : 0;
      const imageBoost = (p.imageUrl && !/img\.architonic\.com/i.test(p.imageUrl)) ? 0.06 : 0;
      const finalScore = vecSim !== null
        ? (0.60 * vecSim + 0.28 * tok.score + verifiedBoost + imageBoost * 0.5)
        : (0.86 * tok.score + verifiedBoost + imageBoost);

      const rawPrice = parseFloat(p.price) || 0;
      scored.push({
        brand_name: b.name,
        brand_tier: normalizeBudgetTier(b.budgetTier || b.budget_tier),
        brand_logo: b.logo || '',
        model: p.model,
        family: p.family || '',
        main_category: p.mainCategory || p.category || '',
        sub_category: p.subCategory || '',
        archetype: effectiveArch,
        description: p.description || '',
        price: rawPrice > 0 ? rawPrice : resolveBenchmarkPriceOMR(effectiveArch, normTier || b.budgetTier || 'mid'),
        currency: rawPrice > 0 ? (p.currency || 'USD') : 'OMR',
        priceSource: rawPrice > 0 ? 'scraped_retail' : 'category_benchmark',
        image_url: p.imageUrl || (p.images && p.images[0]) || '',
        official_url: p.officialProductUrl || p.productUrl || p.websiteUrl || '',
        verified: Boolean(p.verified),
        hybrid_score: Number(finalScore.toFixed(4)),
        tierFallback: usedTierFallback,
      });
    }
  }

  scored.sort((a, b) => (b.hybrid_score - a.hybrid_score) || ((b.verified ? 1 : 0) - (a.verified ? 1 : 0)));
  return scored.slice(0, topK);
}

// ──────────────────────────────────────────────────────────────────────────────
// Async Scrape Jobs Repository (Replaces Railway tasks + setTimeout)
// ──────────────────────────────────────────────────────────────────────────────

export async function enqueueScrapeJob({ jobType = 'brand_enrich', brandName = '', targetUrl = '', payload = {} }) {
  const id = crypto.randomUUID();
  const job = {
    id,
    job_type: jobType,
    brand_name: brandName,
    target_url: targetUrl,
    payload,
    status: 'queued',
    progress: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  LOCAL_SCRAPE_JOBS.set(id, job);

  if (await hasNormalizedSchema()) {
    try {
      const client = supabaseAdmin || supabase;
      const { data, error } = await client.from('scrape_jobs').insert(job).select().single();
      if (!error && data) {
        LOCAL_SCRAPE_JOBS.set(data.id, data);
        return data;
      }
    } catch { /* fallback */ }
  }
  return job;
}

export async function updateScrapeJob(id, patch = {}) {
  const existing = LOCAL_SCRAPE_JOBS.get(id) || { id };
  const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
  LOCAL_SCRAPE_JOBS.set(id, merged);

  if (await hasNormalizedSchema()) {
    try {
      const client = supabaseAdmin || supabase;
      await client.from('scrape_jobs').update(merged).eq('id', id);
    } catch { /* ignore */ }
  }
  return merged;
}

export async function getScrapeJob(id) {
  if (await hasNormalizedSchema()) {
    try {
      const client = supabaseAdmin || supabase;
      const { data } = await client.from('scrape_jobs').select('*').eq('id', id).maybeSingle();
      if (data) return data;
    } catch { /* fallback */ }
  }
  return LOCAL_SCRAPE_JOBS.get(id) || null;
}

export async function listScrapeJobs(limit = 25) {
  if (await hasNormalizedSchema()) {
    try {
      const client = supabaseAdmin || supabase;
      const { data, error } = await client.from('scrape_jobs').select('*').order('created_at', { ascending: false }).limit(limit);
      if (!error && Array.isArray(data)) return data;
    } catch { /* fallback */ }
  }
  return Array.from(LOCAL_SCRAPE_JOBS.values()).slice(-limit).reverse();
}
