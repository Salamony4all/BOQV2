/**
 * Multi-Budget High-Speed Batch Matcher (Phase 2.3).
 * Replaces 3 tiers × N brands LLM explosion with:
 *   1) Shared query embedding per row
 *   2) Strict tier-isolated Supabase hybrid search (or Fit-Out / Custom Fabrication lane)
 *   3) Single batched strict-JSON LLM rerank over Top-K real verified candidates
 */

import {
  buildSpecHash,
  getMatchCache,
  normalizeBudgetTier,
  searchFabricationHybrid,
  searchFitoutHybrid,
  searchProductsHybrid,
  setMatchCache,
} from '../repositories/supabaseCatalogRepo.js';
import { detectCustomFabrication } from './customFabricationDetector.js';
import { classifyFurnishingCategory } from './veCategoryPriority.js';
import { callUniversalMultimodalAI, GOOGLE_MODEL } from './llmUtils.js';
import { getEmbedding } from '../embeddingService.js';

const BATCH_RERANK_SYSTEM = `You are an Elite Commercial FF&E & Value Engineering Selector.
For each BOQ item and budget tier ("budgetary", "mid", "high"), choose the SINGLE best matching candidate index from that tier's provided CANDIDATES array.
Rules:
1. STRICT CANDIDATE GROUNDING: You MUST ONLY pick from the provided candidate list indices (0..K-1) for that tier. NEVER invent models or swap brands.
2. ARCHETYPE LOCK: Chair must match Chair (Task Swivel != Cantilever != Bar Stool); Table != Sofa; Storage != Partition.
3. MULTI-TIER DIFFERENTIATION: Ensure higher tiers pick genuinely higher-grade candidates when multiple options exist.
4. Return ONLY valid JSON:
{
  "selections": [
    {
      "rowId": "...",
      "tiers": {
        "budgetary": { "candidateIdx": 0, "logic": "short reason" },
        "mid": { "candidateIdx": 0, "logic": "short reason" },
        "high": { "candidateIdx": 0, "logic": "short reason" }
      }
    }
  ]
}`;

export async function matchMultiBudgetBatch({
  rows = [],
  tiers = ['budgetary', 'mid', 'high'],
  brandsByTier = {},
  allowTierFallback = false,
  providerModel = null,
  apiKey = null,
} = {}) {
  const activeTiers = (Array.isArray(tiers) && tiers.length > 0 ? tiers : ['budgetary', 'mid', 'high']).map(normalizeBudgetTier);
  const results = {};
  for (const r of rows) {
    results[String(r.id)] = {};
  }

  const furnitureNeedRerank = [];

  // Process each row deterministically across Fitout, Custom Fabrication, and Furniture Candidate Retrieval
  await Promise.all(rows.map(async (row) => {
    const rowId = String(row.id);
    const rawDesc = String(row.description || '').replace(/^(\s*\[[^\]]+\]\s*)+/, '').trim();
    const scopeStr = String(row.scope || '');
    const qty = parseFloat(row.qty) || 1;
    const unit = String(row.unit || 'Nos').trim();

    if (!rawDesc) return;

    const isFitout = /fitout/i.test(scopeStr) && !/custom\s*fab/i.test(scopeStr);
    const fabDetect = isFitout ? { isCustomFabrication: false } : detectCustomFabrication(rawDesc, scopeStr);
    let _qVecPromise = null;
    const ensureQueryVec = () => (_qVecPromise ??= getEmbedding(rawDesc, apiKey).catch(() => null));

    if (isFitout) {
      await Promise.all(activeTiers.map(async (tier) => {
        const hash = buildSpecHash({ description: rawDesc, mode: 'mb_fitout', tier, unit });
        const cached = await getMatchCache(hash);
        if (cached?.product) {
          results[rowId][tier] = cached;
          return;
        }
        const queryEmbedding = await ensureQueryVec();
        const hits = await searchFitoutHybrid({ queryText: rawDesc, queryEmbedding, tier, unitHint: unit, topK: 1 });
        if (hits[0]) {
          const payload = {
            status: 'success',
            source: 'fitout-catalog-v2',
            fulfillmentType: 'fitout',
            product: hits[0],
          };
          results[rowId][tier] = payload;
          await setMatchCache(hash, 'mb_fitout', tier, payload);
        } else {
          results[rowId][tier] = { status: 'no_match', message: 'No fit-out item matched' };
        }
      }));
      return;
    }

    if (fabDetect.isCustomFabrication) {
      await Promise.all(activeTiers.map(async (tier) => {
        const hash = buildSpecHash({ description: rawDesc, mode: 'mb_fab', tier, qty, unit });
        const cached = await getMatchCache(hash);
        if (cached?.product) {
          results[rowId][tier] = cached;
          return;
        }
        const queryEmbedding = await ensureQueryVec();
        const hits = await searchFabricationHybrid({
          queryText: rawDesc,
          queryEmbedding,
          tier,
          designBuildKind: fabDetect.designBuildKind,
          shape: fabDetect.shape,
          parsedDimsMm: fabDetect.parsedDimsMm,
          qty,
          unit,
          topK: 1,
        });
        if (hits[0]) {
          const top = hits[0];
          const payload = {
            status: 'success',
            source: 'fabrication-catalog',
            fulfillmentType: 'custom_fabrication',
            product: {
              brand: 'Custom Fabrication',
              model: top.name,
              skuCode: top.sku_code,
              fabricationId: top.id,
              mainCategory: 'Custom Fabrication',
              subCategory: top.category,
              family: top.sub_category || top.category,
              description: `${top.name} (${top.computedMaterialSpec || top.description_template})`,
              price: top.computedRate,
              currency: top.computedCurrency || 'OMR',
              priceSource: 'parametric_fabrication',
              imageUrl: top.image_url || '',
              designBuildKind: top.design_build_kind || fabDetect.designBuildKind,
              shape: top.shape || fabDetect.shape,
              dimensionsMm: fabDetect.parsedDimsMm?.raw || (top.default_width_mm ? `${top.default_width_mm}x${top.default_depth_mm || 600}x${top.default_height_mm || 750}mm` : ''),
              materialSpec: top.computedMaterialSpec || '',
              workshopTrade: top.workshop_trade || 'Joinery',
              leadTimeDays: top.lead_time_days || 21,
              pricingBasis: top.pricingBasis || '',
            },
          };
          results[rowId][tier] = payload;
          await setMatchCache(hash, 'mb_fab', tier, payload);
        }
      }));
      return;
    }

    // Standard / System Furniture: compute 1 shared canonical query embedding per row
    const archetype = classifyFurnishingCategory(rawDesc);
    const tierCandidates = {};

    await Promise.all(activeTiers.map(async (tier) => {
      const allowedBrands = Array.isArray(brandsByTier[tier]) && brandsByTier[tier].length > 0
        ? brandsByTier[tier]
        : null;
      const hash = buildSpecHash({ description: rawDesc, mode: 'mb_furniture', tier, brands: allowedBrands || [] });
      const cached = await getMatchCache(hash);
      if (cached?.product) {
        results[rowId][tier] = cached;
        return;
      }

      const queryEmbedding = await ensureQueryVec();
      const candidates = await searchProductsHybrid({
        queryText: rawDesc,
        queryEmbedding,
        tier,
        archetype,
        brandNames: allowedBrands,
        allowTierFallback,
        topK: 6,
        apiKey,
      });
      if (candidates.length > 0) {
        tierCandidates[tier] = candidates;
      } else {
        results[rowId][tier] = { status: 'no_match', message: `No ${tier} catalog candidates matched` };
      }
    }));

    if (Object.keys(tierCandidates).length > 0) {
      furnitureNeedRerank.push({ rowId, description: rawDesc, archetype, tierCandidates, brandsByTier });
    }
  }));

  // Single batched LLM rerank over all uncached furniture rows & tiers
  if (furnitureNeedRerank.length > 0) {
    const CHUNK = 8;
    for (let i = 0; i < furnitureNeedRerank.length; i += CHUNK) {
      const slice = furnitureNeedRerank.slice(i, i + CHUNK);
      const compactPromptPayload = slice.map((entry) => ({
        rowId: entry.rowId,
        description: entry.description.slice(0, 320),
        archetype: entry.archetype,
        tiers: Object.fromEntries(
          Object.entries(entry.tierCandidates).map(([t, list]) => [
            t,
            list.map((c, idx) => ({
              idx,
              brand: c.brand_name,
              model: c.model,
              subCat: c.sub_category || c.main_category,
              price: c.price,
              desc: String(c.description || '').slice(0, 140),
            })),
          ])
        ),
      }));

      let rerankedMap = new Map();
      try {
        const llmOut = await callUniversalMultimodalAI(
          BATCH_RERANK_SYSTEM,
          `Select best candidateIdx per tier for these items:\n${JSON.stringify(compactPromptPayload)}`,
          [],
          providerModel || GOOGLE_MODEL,
          true,
          'matching'
        );
        if (llmOut && Array.isArray(llmOut.selections)) {
          for (const sel of llmOut.selections) {
            rerankedMap.set(String(sel.rowId), sel.tiers || {});
          }
        }
      } catch (err) {
        console.warn('[MultiBudgetBatch] LLM rerank fell back to deterministic top hybrid score:', err.message);
      }

      for (const entry of slice) {
        const chosenByTier = rerankedMap.get(entry.rowId) || {};
        for (const [tier, list] of Object.entries(entry.tierCandidates)) {
          const pickedIdx = Number.isInteger(chosenByTier?.[tier]?.candidateIdx) && list[chosenByTier[tier].candidateIdx]
            ? chosenByTier[tier].candidateIdx
            : 0;
          const c = list[pickedIdx];
          const payload = {
            status: 'success',
            source: 'supabase-hybrid-batch',
            tierFallback: Boolean(c.tierFallback),
            product: {
              brand: c.brand_name,
              brandLogo: c.brand_logo || '',
              model: c.model,
              family: c.family || '',
              mainCategory: c.main_category || 'Office Furniture',
              subCategory: c.sub_category || '',
              description: c.description || c.model,
              imageUrl: c.image_url || '',
              productUrl: c.official_url || '',
              websiteUrl: c.official_url || '',
              price: Number(c.price) || 0,
              currency: c.currency || 'OMR',
              priceSource: c.priceSource || 'category_benchmark',
              logic: chosenByTier?.[tier]?.logic || `Hybrid retrieval score ${c.hybrid_score}`,
            },
          };
          results[entry.rowId][tier] = payload;
          const allowedBrands = Array.isArray(entry.brandsByTier?.[tier]) ? entry.brandsByTier[tier] : [];
          const hash = buildSpecHash({ description: entry.description, mode: 'mb_furniture', tier, brands: allowedBrands });
          await setMatchCache(hash, 'mb_furniture', tier, payload);
        }
      }
    }
  }

  return { status: 'success', results };
}
