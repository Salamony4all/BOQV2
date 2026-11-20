import axios from 'axios';
import { readSettings } from '../settings.js';

/**
 * Dynamic Free-Tier Pipeline Model Router & Circuit-Breaker Failover Engine.
 *
 * ZERO hardcoded model-name lock-in:
 * - Periodically fetches Google's live model catalog (`GET /v1beta/models`) using the
 *   active API key (metadata-only — consumes 0 generation tokens / 0 RPD).
 * - Dynamically parses each model's live API metadata (`inputTokenLimit`, `outputTokenLimit`,
 *   `supportedGenerationMethods`, `description`) and semantic family/tier/version pattern
 *   so newly released models (e.g. `gemini-3.9-flash-lite`, `gemini-4-flash`, `gemma-5-*`,
 *   `gemini-embedding-3`) are automatically discovered and ranked, while deprecated/removed
 *   models vanish automatically.
 * - Strictly scoped to Free Tier (`activeTier === 'free'` and no `:billed` override).
 *   Billed/Paid tier ALWAYS uses the user's selected model first with isolated cooldown state.
 */

const CATALOG_TTL_MS = 30 * 60 * 1000; // Refresh live model list every 30 minutes

// Emergency seed used ONLY if both Google's /v1beta/models API and local verifiedModels are unreachable
const EMERGENCY_OFFLINE_SEED = [
  { name: 'models/gemini-3.5-flash-lite', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3-flash-preview', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-lite', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemma-4-26b-a4b-it', inputTokenLimit: 262144, outputTokenLimit: 32768, supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-embedding-2', inputTokenLimit: 8192, outputTokenLimit: 1, supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemini-embedding-001', inputTokenLimit: 2048, outputTokenLimit: 1, supportedGenerationMethods: ['embedContent'] },
];

// Specialized non-BOQ model families to exclude from structured text/vision/PDF JSON pipelines
const NON_BOQ_MODEL_RE = /(tts|image|imagen|nano-banana|lyria|veo|live|audio|transcribe|robotics|computer-use|deep-research|antigravity|omni|aqa)/i;

// Per-pipeline timeout ceilings (ms) so a congested model fails over promptly instead of stalling the UI
export const PIPELINE_TIMEOUT_MS = {
  matching: 20000,
  grounding: 24000,
  tender_map: 28000,
  plan_vision: 90000,
  pdf_boq: 85000,
  embeddings: 15000,
};

// Live catalog state (populated dynamically from Google /v1beta/models)
let liveCatalog = [];           // Parsed descriptors
let catalogSource = 'uninitialized'; // 'live_api' | 'settings_cache' | 'emergency_seed'
let catalogFetchedAt = 0;
let inflightCatalogSync = null;

// Tier-isolated circuit-breaker cooldown tracker:
// key = "free:<model>" | "free:<model>:search" | "billed:<model>" | "billed:<model>:search"
const modelCooldowns = new Map();

// Runtime health telemetry (learns live success/latency per model without hardcoding!)
// key = "free:<model>" | "free:<model>:search" | "billed:<model>" ...
const modelTelemetry = new Map();

function stateKey(model, { useSearch = false, freeTier = true } = {}) {
  const tierPrefix = freeTier ? 'free' : 'billed';
  return useSearch ? `${tierPrefix}:${model}:search` : `${tierPrefix}:${model}`;
}

/**
 * Dynamically parses a raw Google `/v1beta/models` entry (or bare model ID string)
 * into capability descriptors without hardcoding specific version numbers.
 */
export function parseModelDescriptor(raw) {
  const isObj = raw && typeof raw === 'object';
  const rawName = isObj ? (raw.name || raw.id || '') : String(raw || '');
  const id = rawName.replace(/^models\//i, '').trim();
  if (!id) return null;

  const lower = id.toLowerCase();
  const description = isObj ? String(raw.description || '') : '';
  const methods = isObj && Array.isArray(raw.supportedGenerationMethods)
    ? raw.supportedGenerationMethods
    : null;

  const isDeprecated = /\bdeprecated\b|\bretired\b/i.test(description);
  const isEmbedding = methods ? methods.includes('embedContent') : /embed/i.test(lower);
  const isGenerate = methods ? methods.includes('generateContent') : !isEmbedding;
  const isSpecializedNonBoq = !isEmbedding && NON_BOQ_MODEL_RE.test(lower);

  let family = 'other';
  if (lower.startsWith('gemini')) family = 'gemini';
  else if (lower.startsWith('gemma')) family = 'gemma';

  // Extract numeric major.minor version dynamically (e.g. gemini-3.5-flash -> 3.5, gemma-5-27b -> 5, gemini-embedding-2 -> 2)
  let version = 0;
  const verMatch =
    lower.match(/^(?:gemini|gemma)-(\d+(?:\.\d+)?)\b/) ||
    lower.match(/embedding-(\d+(?:\.\d+)?)\b/);
  if (verMatch) version = parseFloat(verMatch[1]);

  const isAlias = /-latest$/i.test(lower);
  const isPreview = /-(preview|exp)\b/i.test(lower);
  const isCustomTools = /customtools/i.test(lower);

  let tier = 'other';
  if (isEmbedding) {
    tier = 'embedding';
  } else if (family === 'gemini') {
    if (/flash-lite/i.test(lower)) tier = 'flash-lite';
    else if (/\bflash\b/i.test(lower)) tier = 'flash';
    else if (/\bpro\b/i.test(lower)) tier = 'pro';
    else if (/^gemini-\d+(?:\.\d+)?-[a-z]+$/i.test(lower)) tier = 'flagship'; // e.g. gemini-4-argon/carbon/hydrogen/neon or future named flagships
  } else if (family === 'gemma') {
    // MoE pattern: e.g. gemma-4-26b-a4b-it (active params tag "a<N>b")
    tier = /-a\d+b\b/i.test(lower) ? 'gemma-moe' : 'gemma-dense';
  }

  // Reasonable defaults when only bare IDs from settings cache are available
  const inputTokenLimit = (isObj && Number(raw.inputTokenLimit))
    ? Number(raw.inputTokenLimit)
    : (isEmbedding ? (version >= 2 ? 8192 : 2048) : (family === 'gemini' ? 1048576 : 262144));
  const outputTokenLimit = (isObj && Number(raw.outputTokenLimit))
    ? Number(raw.outputTokenLimit)
    : (isEmbedding ? 1 : (family === 'gemini' ? 65536 : 32768));

  // Paid-only tiers on Google AI Studio Free Tier
  const isPaidOnlyOnFreeTier =
    tier === 'pro' ||
    tier === 'flagship' ||
    isCustomTools;

  return {
    id,
    family,
    tier,
    version,
    isAlias,
    isPreview,
    isDeprecated,
    isEmbedding,
    isGenerate,
    isSpecializedNonBoq,
    isPaidOnlyOnFreeTier,
    inputTokenLimit,
    outputTokenLimit,
    description,
  };
}

/**
 * Ingests a freshly fetched list of Google `/v1beta/models` objects (or ID strings)
 * directly into the live dynamic catalog (called by `/api/models/available` & `refreshLiveGoogleCatalog`).
 */
export function ingestLiveGoogleModels(rawModels, source = 'live_api') {
  if (!Array.isArray(rawModels) || rawModels.length === 0) return liveCatalog;
  const parsed = [];
  const seen = new Set();
  for (const item of rawModels) {
    const desc = parseModelDescriptor(item);
    if (!desc || seen.has(desc.id)) continue;
    seen.add(desc.id);
    parsed.push(desc);
  }
  if (parsed.length > 0) {
    liveCatalog = parsed;
    catalogSource = source;
    catalogFetchedAt = Date.now();
  }
  return liveCatalog;
}

/**
 * Resolves the current active catalog without blocking:
 * 1. Live Google API catalog (if already synced)
 * 2. Local settings `verifiedModels` cache (fetched previously by UI)
 * 3. Minimal emergency offline seed
 */
function getActiveCatalog() {
  if (liveCatalog.length > 0) return liveCatalog;

  try {
    const saved = readSettings();
    if (Array.isArray(saved.verifiedModels) && saved.verifiedModels.length > 0) {
      const fromSettings = saved.verifiedModels.map(parseModelDescriptor).filter(Boolean);
      // Also keep emergency embedding entries if verifiedModels only stored generateContent models
      const hasEmb = fromSettings.some((m) => m.isEmbedding);
      if (!hasEmb) {
        for (const seed of EMERGENCY_OFFLINE_SEED) {
          const d = parseModelDescriptor(seed);
          if (d && d.isEmbedding) fromSettings.push(d);
        }
      }
      if (fromSettings.length > 0) {
        liveCatalog = fromSettings;
        catalogSource = 'settings_cache';
        return liveCatalog;
      }
    }
  } catch { }

  return EMERGENCY_OFFLINE_SEED.map(parseModelDescriptor).filter(Boolean);
}

/**
 * Fetches Google's live `/v1beta/models` list (metadata only — 0 generation tokens/RPD).
 * Deduplicates concurrent calls and caches for 30 minutes.
 */
export async function refreshLiveGoogleCatalog(apiKey, { force = false } = {}) {
  const now = Date.now();
  if (!force && catalogSource === 'live_api' && liveCatalog.length > 0 && (now - catalogFetchedAt) < CATALOG_TTL_MS) {
    return liveCatalog;
  }

  let effectiveKey = apiKey;
  if (!effectiveKey) {
    try {
      const saved = readSettings();
      effectiveKey = saved.googleFreeKey || saved.googleApiKey || process.env.GOOGLE_FREE_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    } catch { }
  }
  if (!effectiveKey) return getActiveCatalog();

  if (inflightCatalogSync) return inflightCatalogSync;

  inflightCatalogSync = (async () => {
    try {
      const res = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(effectiveKey)}&pageSize=200`,
        { timeout: 8000 }
      );
      if (res.data && Array.isArray(res.data.models) && res.data.models.length > 0) {
        ingestLiveGoogleModels(res.data.models, 'live_api');
        console.log(`🔄 [Dynamic Model Router] Synced ${liveCatalog.length} live Google models from /v1beta/models.`);
      }
    } catch (err) {
      console.warn(`⚠️ [Dynamic Model Router] Live catalog refresh skipped (${err.message}); using ${catalogSource || 'fallback'}.`);
    } finally {
      inflightCatalogSync = null;
    }
    return getActiveCatalog();
  })();

  return inflightCatalogSync;
}

/**
 * Ensures the live Google catalog is populated before selecting models:
 * - If already fresh (`live_api` within 30m), returns immediately (0ms).
 * - If stale (`>30m`), triggers a non-blocking background refresh and returns current catalog immediately.
 * - If never synced yet, awaits a fast initial fetch (capped at 4s) so the very first request uses live models.
 */
export async function ensureLiveCatalogSynced(apiKey = null) {
  const now = Date.now();
  if (catalogSource === 'live_api' && liveCatalog.length > 0) {
    if ((now - catalogFetchedAt) >= CATALOG_TTL_MS && !inflightCatalogSync) {
      refreshLiveGoogleCatalog(apiKey).catch(() => { });
    }
    return liveCatalog;
  }
  // Cold start: await up to 4s so we immediately rank the real live catalog without stalling
  await withModelTimeout(refreshLiveGoogleCatalog(apiKey), 4000, 'GoogleCatalogSync').catch(() => { });
  return getActiveCatalog();
}

/**
 * Returns true ONLY when the current request / settings are running on Google's Free Tier.
 * When `activeTier === 'billed'` or `:billed` suffix is present, returns false.
 */
export function isGoogleFreeTierActive(aiKeyStorage, requestedModel = '') {
  const cleanReq = String(requestedModel || '').toLowerCase().trim();
  if (cleanReq.endsWith(':billed')) return false;

  const ctx = (aiKeyStorage && aiKeyStorage.getStore && aiKeyStorage.getStore()) || {};
  const saved = readSettings();
  const activeTier = String(ctx.activeTier || saved.activeTier || 'free').toLowerCase().trim();
  if (activeTier === 'billed') return false;

  const freeKey = ctx.googleFreeKey || saved.googleFreeKey || '';
  const billedKey = ctx.googleApiKey || saved.googleApiKey || '';
  return Boolean(freeKey) || !billedKey;
}

/**
 * Dynamically scores any live Google model for a specific BOQFLOW pipeline.
 * Works for all current AND future model generations without hardcoded model IDs.
 */
function scoreModelForPipeline(meta, pipeline, { freeTier = true, useSearch = false } = {}) {
  if (!meta || meta.isDeprecated) return -Infinity;

  // Embeddings pipeline: strictly embedContent models
  if (pipeline === 'embeddings') {
    if (!meta.isEmbedding) return -Infinity;
    let score = 0;
    score += Math.min(meta.inputTokenLimit, 32768) / 100; // 8192 -> +81.9 vs 2048 -> +20.5
    score += meta.version * 20;                          // newer version wins (v3 > v2 > v1)
    if (!meta.isPreview) score += 8;                     // stable GA preferred over preview of same version
    if (meta.family === 'gemini') score += 10;
    return score;
  }

  // Generative text/multimodal pipelines
  if (!meta.isGenerate || meta.isEmbedding || meta.isSpecializedNonBoq) return -Infinity;
  if (freeTier && meta.isPaidOnlyOnFreeTier) return -Infinity;

  const has1MContext = meta.inputTokenLimit >= 1000000;
  const has65kOut = meta.outputTokenLimit >= 65536;
  const tel = modelTelemetry.get(stateKey(meta.id, { useSearch, freeTier }));
  const telemetryBoost = tel
    ? (Math.min(tel.successes, 5) * 4) - (tel.avgMs > 8000 ? 12 : (tel.avgMs > 4000 ? 4 : 0))
    : 0;

  let score = telemetryBoost;
  if (has1MContext) score += 12;
  if (has65kOut) score += 10;

  // ── Pipeline 1: Grounding (Free Google Search Grounding) ──
  if (pipeline === 'grounding' || useSearch) {
    if (meta.family !== 'gemini') return -Infinity; // Gemma doesn't support Google Search Grounding
    if (meta.isAlias) score -= 25; // Aliases often point to 3.x where Search is paid-only on Free Tier
    if (meta.version >= 2.0 && meta.version < 3.0) {
      // 2.x Flash & Flash-Lite are empirically confirmed free-grounding capable
      score += 120;
      if (meta.tier === 'flash') score += 15;
      else if (meta.tier === 'flash-lite') score += 10;
    } else if (meta.version >= 3.0) {
      // Keep newer generations behind 2.x so if Google retires 2.x or enables free Search on 3.x/4.x, failover still discovers them
      score += 40 + (meta.version * 2);
      if (meta.tier === 'flash') score += 8;
      else if (meta.tier === 'flash-lite') score += 5;
    }
    if (!meta.isPreview) score += 5;
    return score;
  }

  // ── Pipeline 2: High-Volume BOQ Matching & Ungrounded Rescue ──
  if (pipeline === 'matching' || pipeline === 'grounding_ungrounded_rescue') {
    if (meta.tier === 'flash-lite') {
      if (meta.version >= 3.0) {
        // Newest 3.x+ flash-lite FIRST (fast, 0 thinking tokens, saves scarce 20-RPD 2.x buckets for grounding!)
        score += 140 + (meta.version * 8) + (meta.isPreview ? -4 : 6);
      } else if (meta.isAlias) {
        score += 128; // e.g. gemini-flash-lite-latest
      } else if (meta.version >= 2.0) {
        // Preserve 2.x flash-lite (20 RPD) behind 3.x+ flash-lite & fast flash/MoE backups
        score += 82 + (meta.version * 2);
      } else {
        score += 60;
      }
    } else if (meta.tier === 'flash') {
      if (meta.isPreview && meta.version >= 3.0 && meta.version < 3.5) {
        // Stable 3.0 preview flash (proven low-congestion)
        score += 124;
      } else if (meta.version >= 3.5) {
        // Newest 3.5+ / 4.x flash models — dynamically discovered & auto-promoted when healthy
        score += 116 + Math.min(meta.version, 10);
      } else if (meta.isAlias) {
        score += 100;
      } else {
        // Save 2.5-flash (20 RPD) for grounding / PDF extraction
        score += 75;
      }
    } else if (meta.tier === 'gemma-moe') {
      // Fast MoE open-weights backup (e.g. gemma-4-26b-a4b-it or future gemma-5 MoE)
      score += 96 + (meta.version * 3);
    } else if (meta.tier === 'gemma-dense') {
      // Dense Gemma last resort (heavier, slower)
      score += 55 + (meta.version * 2);
    } else {
      score += 30;
    }
    return score;
  }

  // ── Pipeline 3: Architectural Floor-Plan Vision (`plan_vision`) ──
  if (pipeline === 'plan_vision') {
    if (meta.tier === 'flash') {
      if (meta.isPreview && meta.version >= 3.0 && meta.version < 3.5) {
        score += 152; // Proven 3.x vision accuracy + 65K output
      } else if (meta.version >= 2.5 && meta.version < 3.0) {
        score += 144; // Proven native PDF/vision reliability
      } else if (meta.version >= 3.5) {
        score += 136 + Math.min(meta.version, 10); // Newer 3.5+/4.x flash dynamically included & promoted as telemetry confirms health
      } else if (meta.isAlias) {
        score += 120;
      } else {
        score += 100;
      }
    } else if (meta.tier === 'flash-lite') {
      score += 115 + (meta.version * 4) + (meta.isPreview ? -3 : 4);
    } else if (meta.tier === 'gemma-moe') {
      score += 80 + (meta.version * 2);
    } else if (meta.tier === 'gemma-dense') {
      score += 65 + (meta.version * 2);
    }
    return score;
  }

  // ── Pipeline 4: Native PDF / Vision BOQ Extraction (`pdf_boq`) ──
  if (pipeline === 'pdf_boq') {
    if (meta.tier === 'flash') {
      if (!meta.isPreview && meta.version >= 2.5 && meta.version < 3.0) {
        score += 154; // Rock-solid GA native PDF table fidelity
      } else if (meta.isPreview && meta.version >= 3.0 && meta.version < 3.5) {
        score += 148;
      } else if (meta.version >= 3.5) {
        score += 138 + Math.min(meta.version, 10);
      } else if (meta.isAlias) {
        score += 120;
      } else {
        score += 105;
      }
    } else if (meta.tier === 'flash-lite') {
      score += 122 + (meta.version * 4) + (meta.isPreview ? -3 : 4);
    } else if (meta.tier === 'gemma-moe') {
      score += 85 + (meta.version * 2);
    } else if (meta.tier === 'gemma-dense') {
      score += 60 + (meta.version * 2);
    }
    return score;
  }

  // ── Pipeline 5: Tender Portal DOM Mapping (`tender_map`) ──
  if (pipeline === 'tender_map') {
    if (meta.tier === 'flash') {
      if (meta.isPreview && meta.version >= 3.0 && meta.version < 3.5) score += 150;
      else if (meta.version >= 2.5 && meta.version < 3.0) score += 136;
      else if (meta.version >= 3.5) score += 132 + Math.min(meta.version, 10);
      else score += 110;
    } else if (meta.tier === 'flash-lite') {
      score += 130 + (meta.version * 5) + (meta.isPreview ? -3 : 4);
    } else if (meta.tier === 'gemma-moe') {
      score += 80 + (meta.version * 2);
    }
    return score;
  }

  return score;
}

/**
 * Dynamically computes the ranked candidate chain for a pipeline from the live Google catalog.
 */
export function buildDynamicPipelineChain(pipeline = 'matching', { freeTier = true, useSearch = false, maxCandidates = 6 } = {}) {
  const catalog = getActiveCatalog();
  const scored = [];
  for (const meta of catalog) {
    const score = scoreModelForPipeline(meta, pipeline, { freeTier, useSearch });
    if (Number.isFinite(score) && score > -Infinity) {
      scored.push({ id: meta.id, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, maxCandidates).map((s) => s.id);
}

/**
 * Classifies an error and places the failing model into an appropriate tier-scoped cooldown window.
 * If a daily RPD quota is exhausted (`GenerateRequestsPerDay` / `per day`), benches BOTH the base
 * model AND its `:search` entry together so no extra calls are wasted on the exhausted daily bucket.
 */
export function recordModelFailure(model, err, { useSearch = false, freeTier = true } = {}) {
  const msg = String(err?.message || err || '');
  const key = stateKey(model, { useSearch, freeTier });
  const prev = modelCooldowns.get(key) || { failures: 0 };
  const failures = prev.failures + 1;

  let cooldownMs = 30000;
  let category = 'transient';
  let benchBothModes = false;

  if (/exceeded its monthly spending cap/i.test(msg)) {
    return { retryableOnNextModel: false, cooldownMs: 0, category: 'spending_cap' };
  }

  if (/404|not found|no longer available|not supported|unsupported|invalid argument|does not support/i.test(msg)) {
    cooldownMs = 30 * 60 * 1000; // 30 minutes
    category = 'unsupported_or_retired';
    benchBothModes = /404|not found|no longer available/i.test(msg);
  } else if (/503|high demand|overloaded|unavailable|service unavailable|internal error|500|502|504/i.test(msg)) {
    cooldownMs = Math.min(5 * 60 * 1000, 120000 * Math.min(failures, 3)); // 2-5 min
    category = 'congested_503';
  } else if (/timeout|timed out|aborted|ECONNRESET|ETIMEDOUT/i.test(msg)) {
    cooldownMs = 120000; // 2 minutes
    category = 'timeout';
  } else if (/429|quota|rate-limit|resource_exhausted/i.test(msg)) {
    const retryDelaySecMatch = msg.match(/retryDelay["']?\s*:\s*["']?(\d+)s?/i);
    const retryInSecMatch = msg.match(/retry in ([\d.]+)s/i);
    const retryDelaySec = retryDelaySecMatch ? parseFloat(retryDelaySecMatch[1]) : (retryInSecMatch ? parseFloat(retryInSecMatch[1]) : 0);
    const isDailyRpd = /GenerateRequestsPerDay|requests per day|per day|daily/i.test(msg) || retryDelaySec > 3600;
    const isZeroLimit = /limit:\s*0\b/i.test(msg);

    if (isDailyRpd) {
      cooldownMs = Math.min(60 * 60 * 1000, Math.max(30 * 60 * 1000, retryDelaySec * 1000));
      category = 'daily_rpd_exhausted';
      benchBothModes = true;
    } else if (isZeroLimit) {
      cooldownMs = 30 * 60 * 1000;
      category = 'quota_limit_zero';
      benchBothModes = !useSearch;
    } else if (retryDelaySec > 0) {
      cooldownMs = Math.max(45000, Math.ceil(retryDelaySec * 1000) + 2000);
      category = 'rate_limit_429';
    } else {
      cooldownMs = 60000;
      category = 'rate_limit_429';
    }
  } else if (/malformed|truncated|empty ai response|non-object|json/i.test(msg)) {
    cooldownMs = 15000;
    category = 'bad_output';
  }

  const record = {
    until: Date.now() + cooldownMs,
    reason: category,
    failures,
    lastError: msg.slice(0, 160),
    updatedAt: new Date().toISOString(),
  };

  modelCooldowns.set(key, record);
  if (benchBothModes) {
    modelCooldowns.set(stateKey(model, { useSearch: false, freeTier }), record);
    modelCooldowns.set(stateKey(model, { useSearch: true, freeTier }), record);
  }

  return { retryableOnNextModel: true, cooldownMs, category };
}

/**
 * Clears any failure cooldown and updates runtime latency/reliability telemetry.
 */
export function recordModelSuccess(model, { useSearch = false, freeTier = true, latencyMs = 0 } = {}) {
  const key = stateKey(model, { useSearch, freeTier });
  if (modelCooldowns.has(key)) {
    modelCooldowns.delete(key);
  }
  const prev = modelTelemetry.get(key) || { successes: 0, avgMs: latencyMs || 1000 };
  const successes = prev.successes + 1;
  const avgMs = latencyMs > 0 ? Math.round((prev.avgMs * 0.7) + (latencyMs * 0.3)) : prev.avgMs;
  modelTelemetry.set(key, { successes, avgMs, lastSuccessAt: Date.now() });
}

/**
 * Checks whether a model is currently in cooldown for the given tier + search mode.
 */
export function getCooldownRemainingMs(model, { useSearch = false, freeTier = true } = {}) {
  const key = stateKey(model, { useSearch, freeTier });
  const entry = modelCooldowns.get(key);
  if (!entry) return 0;
  const remaining = entry.until - Date.now();
  if (remaining <= 0) {
    modelCooldowns.delete(key);
    return 0;
  }
  return remaining;
}

/**
 * Builds the ordered list of Google model IDs to attempt for a given pipeline,
 * dynamically derived from Google's live model catalog + live health/cooldown state.
 *
 * - When `freeTier === true`: ALWAYS assigns the pipeline's top dynamically scored Free model FIRST,
 *   followed by its live fallbacks, excluding paid-only/deprecated models and routing around
 *   currently congested or daily-exhausted models automatically.
 * - When `freeTier === false` (Billed / Paid): ALWAYS honors `requestedModel` FIRST with zero
 *   Free-Tier overrides or Free-Tier cooldowns; keeps dynamic fallbacks behind it only if
 *   the requested paid model encounters a transient error.
 */
export function getPipelineModelCandidates(pipeline = 'matching', requestedModel = null, { freeTier = true, useSearch = false, modelMapping = {} } = {}) {
  const cleanRequested = String(requestedModel || '').replace(':billed', '').trim();
  const mappedRequested = cleanRequested ? (modelMapping[cleanRequested] || cleanRequested) : '';
  const effectivePipeline = (useSearch && pipeline !== 'grounding') ? 'grounding' : pipeline;

  // Dynamic live-catalog scoring!
  const dynamicChain = buildDynamicPipelineChain(effectivePipeline, {
    freeTier,
    useSearch,
    maxCandidates: effectivePipeline === 'grounding' ? 4 : 10,
  });

  const rawList = [];
  const pushUnique = (m) => {
    if (!m || typeof m !== 'string') return;
    const trimmed = m.trim();
    if (!trimmed || rawList.includes(trimmed)) return;
    rawList.push(trimmed);
  };

  if (freeTier) {
    // 1. Dynamically ranked optimal Free-Tier chain for this specific pipeline FIRST
    for (const m of dynamicChain) pushUnique(m);

    // 2. Append user's selected model at the end ONLY if dynamically eligible on Free Tier
    if (mappedRequested) {
      const reqMeta = getActiveCatalog().find((d) => d.id === mappedRequested) || parseModelDescriptor(mappedRequested);
      const reqScore = scoreModelForPipeline(reqMeta, effectivePipeline, { freeTier: true, useSearch });
      if (Number.isFinite(reqScore) && reqScore > -Infinity) {
        pushUnique(mappedRequested);
      }
    }
  } else {
    // Paid / Billed tier: honor user's chosen model FIRST with zero free-tier interference
    if (mappedRequested) pushUnique(mappedRequested);
    for (const m of dynamicChain) pushUnique(m);
  }

  // Partition into healthy models vs currently cooled-down models (tier-scoped!)
  const healthy = [];
  const cooled = [];
  for (const m of rawList) {
    const rem = getCooldownRemainingMs(m, { useSearch, freeTier });
    if (rem <= 0) healthy.push(m);
    else cooled.push({ model: m, rem });
  }
  cooled.sort((a, b) => a.rem - b.rem);

  if (healthy.length > 0) {
    const soonestNonDaily = cooled.find((c) => {
      const entry = modelCooldowns.get(stateKey(c.model, { useSearch, freeTier }));
      return entry && entry.reason !== 'daily_rpd_exhausted' && entry.reason !== 'unsupported_or_retired' && entry.reason !== 'quota_limit_zero';
    });
    return soonestNonDaily ? [...healthy, soonestNonDaily.model] : healthy;
  }

  const recoverable = cooled.filter((c) => {
    const entry = modelCooldowns.get(stateKey(c.model, { useSearch, freeTier }));
    return !entry || (entry.reason !== 'unsupported_or_retired' && entry.reason !== 'quota_limit_zero');
  });
  return (recoverable.length ? recoverable : cooled).slice(0, 2).map((c) => c.model);
}

/**
 * Dynamic getter for backward compatibility (`FREE_PIPELINE_CHAINS` consumers).
 */
export function getDynamicPipelineChains(freeTier = true) {
  return {
    matching: buildDynamicPipelineChain('matching', { freeTier }),
    grounding: buildDynamicPipelineChain('grounding', { freeTier, useSearch: true }),
    grounding_ungrounded_rescue: buildDynamicPipelineChain('grounding_ungrounded_rescue', { freeTier }),
    plan_vision: buildDynamicPipelineChain('plan_vision', { freeTier }),
    pdf_boq: buildDynamicPipelineChain('pdf_boq', { freeTier }),
    tender_map: buildDynamicPipelineChain('tender_map', { freeTier }),
    embeddings: buildDynamicPipelineChain('embeddings', { freeTier }),
  };
}

/**
 * Wraps a promise with a clean timeout so a hung Google model triggers failover instead of stalling.
 */
export function withModelTimeout(promise, timeoutMs, label = 'Google AI') {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
      err.isTimeout = true;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Snapshot for observability (`GET /api/models/routing-status`).
 */
export function getRouterHealthSnapshot(aiKeyStorage) {
  const freeTierActive = isGoogleFreeTierActive(aiKeyStorage);
  const now = Date.now();
  const activeCooldowns = {};
  for (const [key, entry] of modelCooldowns.entries()) {
    const rem = entry.until - now;
    if (rem > 0) {
      activeCooldowns[key] = {
        remainingSeconds: Math.ceil(rem / 1000),
        reason: entry.reason,
        failures: entry.failures,
      };
    }
  }
  const pipelines = ['matching', 'grounding', 'plan_vision', 'pdf_boq', 'tender_map', 'embeddings'];
  const activeAssignments = {};
  for (const pipeline of pipelines) {
    activeAssignments[pipeline] = getPipelineModelCandidates(pipeline, null, {
      freeTier: freeTierActive,
      useSearch: pipeline === 'grounding',
    });
  }
  return {
    freeTierActive,
    routingMode: freeTierActive ? 'free-tier-dynamic-live-catalog' : 'billed-user-selected',
    catalog: {
      source: catalogSource,
      totalModels: getActiveCatalog().length,
      lastSyncedAt: catalogFetchedAt ? new Date(catalogFetchedAt).toISOString() : null,
      ttlMinutes: Math.round(CATALOG_TTL_MS / 60000),
    },
    activeAssignments,
    activeCooldowns,
  };
}
