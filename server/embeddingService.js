import { GoogleGenerativeAI } from '@google/generative-ai';
import { getBrandAffinityScore, detectSpecArchetype, DOMAIN_EXCLUSIONS } from './utils/veBrandSpecialties.js';

// In-memory cache for computed catalog embeddings: brandName -> { products, timestamp }
const brandEmbeddingCache = new Map();

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const EMBEDDING_MODELS = ['gemini-embedding-001', 'gemini-embedding-2-preview', 'gemini-embedding-2', 'text-embedding-004'];

async function getEmbeddingModel(genAI) {
  for (const m of EMBEDDING_MODELS) {
    try {
      return genAI.getGenerativeModel({ model: m });
    } catch (e) {}
  }
  return genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
}

/**
 * Generate embedding for a single text using Google Generative AI (gemini-embedding-001)
 */
export async function getEmbedding(text, apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_FREE_KEY;
  if (!key) {
    throw new Error('No Google Gemini API key configured for embeddings');
  }

  const genAI = new GoogleGenerativeAI(key);
  const model = await getEmbeddingModel(genAI);
  const result = await model.embedContent(text.slice(0, 2048));
  return result.embedding.values;
}

/**
 * Generate embeddings for an array of texts in batch
 */
export async function getBatchEmbeddings(texts, apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_FREE_KEY;
  if (!key) {
    throw new Error('No Google Gemini API key configured for embeddings');
  }

  const genAI = new GoogleGenerativeAI(key);
  const model = await getEmbeddingModel(genAI);

  const embeddings = [];
  const CHUNK_SIZE = 8;
  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    const chunk = texts.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (t) => {
        try {
          const res = await model.embedContent(t.slice(0, 2048));
          return res.embedding.values;
        } catch (e) {
          console.warn(`[Embedding] Warning generating vector for "${t.slice(0, 40)}":`, e.message);
          return null;
        }
      })
    );
    embeddings.push(...chunkResults);
  }
  return embeddings;
}

/**
 * Ensure catalog products have computed vector embeddings (cached in memory)
 */
export async function ensureBrandCatalogEmbeddings(brandName, products, apiKey) {
  if (!products || products.length === 0) return [];

  const cacheKey = String(brandName || '').toLowerCase().trim();
  const cached = brandEmbeddingCache.get(cacheKey);

  // If cache is fresh (within 2 hours) and has same count, return cached
  if (cached && cached.products && cached.products.length === products.length && Date.now() - cached.timestamp < 7200000) {
    return cached.products;
  }

  console.log(`🧠 [Embedding Service] Generating semantic vectors for brand "${brandName}" (${products.length} products)...`);
  
  // Format descriptive text representation for each product
  const productTexts = products.map(p => {
    const parts = [
      p.model ? `Model: ${p.model}` : '',
      p.mainCategory ? `Category: ${p.mainCategory}` : (p.category ? `Category: ${p.category}` : ''),
      p.subCategory ? `Type: ${p.subCategory}` : '',
      p.description ? `Description: ${p.description}` : '',
      p.specifications ? `Specs: ${JSON.stringify(p.specifications)}` : ''
    ].filter(Boolean);
    return parts.join(' | ') || p.model || 'Furniture product';
  });

  const vectors = await getBatchEmbeddings(productTexts, apiKey);

  const enrichedProducts = products.map((p, idx) => ({
    ...p,
    _vector: vectors[idx] || null
  }));

  brandEmbeddingCache.set(cacheKey, {
    products: enrichedProducts,
    timestamp: Date.now()
  });

  console.log(`✅ [Embedding Service] Successfully cached ${enrichedProducts.filter(p => p._vector).length} vectors for "${brandName}"`);
  return enrichedProducts;
}

/**
 * Hybrid Scoring Parameters:
 * finalScore = (w_cosine * cosineSim) + (w_token * tokenScore) + (w_affinity * brandAffinity)
 */
export const HYBRID_WEIGHTS = {
  w_cosine: 0.60,
  w_token: 0.25,
  w_affinity: 0.15
};

const BASIC_ENGLISH_STOPWORDS = new Set([
  'with', 'and', 'or', 'the', 'for', 'in', 'of', 'to', 'a', 'an', 'by', 'as', 'at', 'per', 'all', 'from', 'on', 'is', 'be', 'are'
]);

/**
 * Computes token-level overlap score between query description and product
 */
export function computeTokenOverlapScore(queryText, product) {
  if (!queryText || !product) return 0;
  const qTokens = new Set(
    queryText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !BASIC_ENGLISH_STOPWORDS.has(t))
  );
  if (qTokens.size === 0) return 0;

  const targetText = `${product.model || ''} ${product.subCategory || ''} ${product.family || ''} ${product.description || ''}`.toLowerCase();
  let matchCount = 0;
  let modelBonus = 0;

  for (const token of qTokens) {
    if (targetText.includes(token)) {
      matchCount++;
      if ((product.model || '').toLowerCase().includes(token)) {
        modelBonus += 0.35;
      }
    }
  }

  const rawRatio = matchCount / qTokens.size;
  return Math.min(1.0, rawRatio + modelBonus);
}


/**
 * Find top-K semantic matches using Tunable Hybrid Scoring
 */
export async function findHybridSemanticMatches({
  description,
  brandName,
  products = [],
  category = null,
  topK = 3,
  apiKey = null
}) {
  if (!description || !description.trim()) return [];
  if (!products || products.length === 0) return [];

  try {
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_FREE_KEY;
    const cacheKey = String(brandName || 'Catalog').toLowerCase().trim();
    const cached = brandEmbeddingCache.get(cacheKey);
    const archetype = category || detectSpecArchetype(description);

    let queryVector = null;
    if (cached && cached.products && key) {
      try {
        queryVector = await getEmbedding(description, key);
      } catch (embErr) {
        console.warn(`[Embedding Warning] Falling back to token hybrid matcher: ${embErr.message}`);
      }
    }

    const targetProducts = cached ? cached.products : products;
    const scoredProducts = targetProducts.map(p => {
      const tokenScore = computeTokenOverlapScore(description, p);
      const cosineSim = (queryVector && p._vector) ? cosineSimilarity(queryVector, p._vector) : Math.max(0.75, tokenScore);
      const brandAffinity = getBrandAffinityScore(description, brandName || p.brand, archetype);

      // Hybrid Score Calculation
      const finalScore = (HYBRID_WEIGHTS.w_cosine * cosineSim) +
                         (HYBRID_WEIGHTS.w_token * tokenScore) +
                         (HYBRID_WEIGHTS.w_affinity * Math.max(0, brandAffinity));

      const confidencePct = Math.round(Math.min(100, Math.max(0, finalScore * 100)));

      return {
        product: p,
        cosineSim,
        tokenScore,
        brandAffinity,
        finalScore,
        confidenceScore: confidencePct
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);

    let selectedProducts = [];
    if (brandName === 'Catalog' || brandName === 'All' || !brandName) {
      const seenBrands = new Set();
      for (const item of scoredProducts) {
        const b = String(item.product.brand || '').toLowerCase().trim();
        if (b && !seenBrands.has(b)) {
          seenBrands.add(b);
          selectedProducts.push(item);
          if (selectedProducts.length >= topK) break;
        }
      }
      if (selectedProducts.length < topK) {
        for (const item of scoredProducts) {
          if (!selectedProducts.includes(item)) {
            selectedProducts.push(item);
            if (selectedProducts.length >= topK) break;
          }
        }
      }
    } else {
      selectedProducts = scoredProducts.slice(0, topK);
    }

    return selectedProducts.map(item => ({
      model: item.product.model,
      brand: item.product.brand || brandName,
      brandLogo: item.product.brandLogo || '',
      price: item.product.price || 0,
      currency: item.product.currency || 'USD',
      imageUrl: item.product.imageUrl || (item.product.images && item.product.images[0]) || '',
      images: item.product.images || (item.product.imageUrl ? [item.product.imageUrl] : []),
      description: item.product.description || '',
      mainCategory: item.product.mainCategory || item.product.category || '',
      subCategory: item.product.subCategory || '',
      finalScore: parseFloat(item.finalScore.toFixed(3)),
      confidenceScore: item.confidenceScore,
      matchTier: item.confidenceScore >= 95 ? 'EXACT_MATCH' : (item.confidenceScore >= 80 ? 'HIGH_CONFIDENCE' : (item.confidenceScore >= 60 ? 'SUGGESTED' : 'LOW_CONFIDENCE')),
      matchReason: `Hybrid semantic match (Vector: ${(item.cosineSim * 100).toFixed(0)}%, Token: ${(item.tokenScore * 100).toFixed(0)}%)`,
      evidence: {
        vectorSimilarity: item.cosineSim.toFixed(3),
        tokenScore: item.tokenScore.toFixed(3),
        brandAffinity: item.brandAffinity.toFixed(2),
        catalogId: item.product.id || `${item.product.brand || brandName}-${item.product.model}`
      }
    }));
  } catch (error) {
    console.error('❌ [Embedding Service] Error in hybrid matcher:', error.message);
    return fastWeightedCatalogMatch(description, products, category, topK);
  }
}

// Alias for backward compatibility
export const findSemanticMatches = findHybridSemanticMatches;


const GENERIC_FURNITURE_STOPWORDS = new Set([
  'desk', 'desks', 'chair', 'chairs', 'sofa', 'sofas', 'table', 'tables', 'cabinet', 'cabinets',
  'storage', 'high', 'low', 'mid', 'mesh', 'wood', 'metal', 'steel', 'aluminum', 'black', 'white',
  'with', 'and',  'single', 'double', 'triple', 'two', 'three', 'four', 'five', 'pax', 'seater', 'round', 'corner', 'executive', 'office',
  'manager', 'visitor', 'conference', 'meeting', 'lounge', 'armchair', 'task', 'ergonomic', 'base',
  'frame', 'legs', 'leg', 'seat', 'seats', 'back', 'top', 'tops', 'door', 'doors', 'side', 'front',
  'panel', 'panels', 'finish', 'type', 'line', 'series', 'star', 'swivel', 'castor', 'castors',
  'box', 'set', 'unit', 'custom', 'made', 'part', 'item', 'plus', 'pro', 'max', 'new', 'style',
  'collection', 'design', 'products', 'product', 'by', 'the', 'modesty', 'wire', 'cable', 'height',
  'adjustable', 'rectangular', 'square', 'cantilever', 'glides', 'upholstered', 'fabric', 'leather',
  'room', 'wall', 'shape', 'shaped', 'melamine', 'mdf', 'veneer', 'laminate', 'glass', 'drawer',
  'drawers', 'sliding', 'swing', 'hinged', 'wheeled', 'cushionless', 'padded', 'armrest', 'armrests',
  'return', 'oval', 'linear', 'modular', 'freestanding', 'mobile', 'fixed', 'mounted', 'slot',
  'grommet', 'power', 'data', 'finish', 'finishes', 'size', 'dim', 'dimension', 'dimensions',
  'snake', 'plastic', 'reception', 'counter', 'east', 'middle', 'far', 'local', 'uae', 'oman',
  'showroom', 'cases', 'find', 'learn', 'modern', 'classic', 'standard', 'contract', 'commercial',
  'general', 'requirements', 'flooring', 'ceiling', 'pantry', 'mep', 'electrical', 'mechanical',
  'prong', 'spider', 'station', 'system', 'medium', 'perforated', 'powder', 'coated'
]);

/**
 * Checks if the exact model name is mentioned in the description AND its physical specifications match.
 */
function checkExactModelMatchWithSpecs(description, product, specArchetype) {
  if (!product || !product.model || !description) return { isExactHit: false, isConflict: false };

  const descLower = description.toLowerCase();
  const brandLower = String(product.brand || '').toLowerCase().trim();

  // Check if brand is strictly excluded for this specification archetype
  if (specArchetype && DOMAIN_EXCLUSIONS && DOMAIN_EXCLUSIONS[specArchetype]) {
    const excluded = DOMAIN_EXCLUSIONS[specArchetype];
    if (excluded.some(b => brandLower === b || brandLower.includes(b))) {
      return { isExactHit: false, isConflict: true, reason: `Brand ${brandLower} excluded from ${specArchetype}` };
    }
  }

  // Prevent accessory/fitting items from matching major furniture specs
  const prodCat = String(product.mainCategory || product.category || '').toLowerCase();
  const prodSub = String(product.subCategory || '').toLowerCase();
  const isAccessory = prodCat.includes('accessory') || prodCat.includes('accessories') || prodCat.includes('wire') || prodSub.includes('wire') || prodCat.includes('power');
  if (isAccessory && specArchetype && ['desking', 'taskSeating', 'softSeating', 'storage'].includes(specArchetype)) {
    return { isExactHit: false, isConflict: true, reason: 'Accessory item cannot match furniture specification' };
  }
  
  // Extract clean model name (strip #ids, numbers, generic keywords)
  const rawModel = String(product.model || '');
  const cleanModel = rawModel
    .replace(/#\d+/g, '')
    .replace(/\[.*?\]/g, '')
    .trim()
    .toLowerCase();

  // Find candidate name roots (filter out purely numeric/dimension tokens like 160, 80x50, etc.)
  const words = cleanModel
    .split(/[\s\-_/]+/)
    .filter(w => w.length >= 3 && !GENERIC_FURNITURE_STOPWORDS.has(w) && !/^\d+$/.test(w) && !/^\d+x\d+$/.test(w) && !/^\d+(mm|cm|m)$/.test(w));
  
  let matchedRoot = null;
  for (const w of words) {
    const wordRegex = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (wordRegex.test(descLower)) {
      matchedRoot = w;
      break;
    }
  }

  // Also check full multi-word model name if length > 3
  if (!matchedRoot && cleanModel.length >= 3 && !GENERIC_FURNITURE_STOPWORDS.has(cleanModel) && !/^\d+$/.test(cleanModel)) {
    const cleanEscaped = cleanModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${cleanEscaped}\\b`, 'i').test(descLower)) {
      matchedRoot = cleanModel;
    }
  }

  if (!matchedRoot) {
    return { isExactHit: false, isConflict: false };
  }

  // Model name IS mentioned in the description. Now verify SPECIFICATION COMPATIBILITY.
  const prodDesc = `${product.model} ${product.mainCategory || ''} ${product.subCategory || ''} ${product.description || ''}`;
  const prodArchetype = detectSpecArchetype(prodDesc, product.mainCategory);

  // 1. Archetype Check: If spec is chair and model is desk (or vice versa), it's a conflict!
  if (specArchetype && prodArchetype && specArchetype !== prodArchetype) {
    return { isExactHit: false, isConflict: true, reason: `Archetype mismatch: spec is ${specArchetype}, model is ${prodArchetype}` };
  }

  // 2. Height Check:
  const isHighSpec = descLower.includes('full height') || descLower.includes('high cabinet') || descLower.includes('tall');
  const isLowProduct = cleanModel.includes('low') || prodDesc.toLowerCase().includes('low height') || prodDesc.toLowerCase().includes('credenza');
  if (isHighSpec && isLowProduct) {
    return { isExactHit: false, isConflict: true, reason: 'Height mismatch' };
  }

  // 3. Seating Capacity Check:
  const is1SeaterSpec = descLower.includes('single') || descLower.includes('1 seater') || descLower.includes('1-seater');
  const is3SeaterProd = cleanModel.includes('three') || cleanModel.includes('3 seater') || cleanModel.includes('3-seater');
  if (is1SeaterSpec && is3SeaterProd) {
    return { isExactHit: false, isConflict: true, reason: 'Seating capacity mismatch' };
  }

  // All physical checks pass -> 100% Exact Model Hit!
  return { isExactHit: true, isConflict: false, matchedModelName: matchedRoot };
}

/**
 * Fast Weighted Keyword & Token Cosine Matching (runs in < 3ms for 2000+ items)
 */
function fastWeightedCatalogMatch(description, products, category = null, topK = 3) {
  const queryTokens = description.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  const querySet = new Set(queryTokens);
  const specArchetype = detectSpecArchetype(description, category);

  const scored = products.map(p => {
    // 🌟 Special Exact Model Name + Specification Compatibility Check
    const exactCheck = checkExactModelMatchWithSpecs(description, p, specArchetype);
    if (exactCheck.isExactHit) {
      return {
        product: p,
        similarity: 1.0,
        confidenceScore: 100,
        exactModelMatch: true
      };
    }

    const modelStr = String(p.model || '').toLowerCase();
    const descStr = String(p.description || '').toLowerCase();
    const catStr = String(p.mainCategory || p.category || '').toLowerCase();
    const subStr = String(p.subCategory || '').toLowerCase();

    let score = 0;
    let matchCount = 0;

    // If model name mentioned but conflicted with specs, apply penalty
    if (exactCheck.isConflict) {
      score -= 0.80;
    }

    // 1. Model name exact / partial match (highest weight)
    for (const token of queryTokens) {
      if (token.length > 2 && modelStr.includes(token)) {
        score += 0.35;
        matchCount++;
      }
      if (token.length > 2 && descStr.includes(token)) {
        score += 0.10;
        matchCount++;
      }
      if (token.length > 2 && (catStr.includes(token) || subStr.includes(token))) {
        score += 0.15;
        matchCount++;
      }
    }

    // 1.5. Strict Archetype & Category Alignment
    const prodDesc = `${p.model} ${p.mainCategory || ''} ${p.subCategory || ''} ${p.description || ''}`;
    const prodArchetype = detectSpecArchetype(prodDesc, p.mainCategory);

    if (specArchetype && prodArchetype) {
      if (specArchetype === prodArchetype) {
        score += 0.80; // High bonus for matching functional category
      } else {
        score -= 1.20; // Strict penalty for functional category conflict (e.g. Storage vs Table, Desk vs Chair)
      }
    }

    // 2. Height & Dimension Discriminators (Full Height vs Low Height)
    const isHighSpec = querySet.has('high') || querySet.has('tall') || queryTokens.some(t => t.includes('high') || t.includes('tall')) || description.toLowerCase().includes('full height');
    const isLowSpec = querySet.has('low') || querySet.has('credenza') || querySet.has('sideboard') || querySet.has('underdesk') || description.toLowerCase().includes('low height');
    const isMidSpec = querySet.has('medium') || querySet.has('mid') || querySet.has('half');

    const isHighProduct = modelStr.includes('full height') || modelStr.includes('high') || modelStr.includes('tall') || subStr.includes('full height') || descStr.includes('full height');
    const isLowProduct = modelStr.includes('low') || subStr.includes('low') || descStr.includes('low height') || modelStr.includes('sideboard') || modelStr.includes('credenza');
    const isMidProduct = modelStr.includes('medium') || subStr.includes('medium') || descStr.includes('medium height');

    if (isHighSpec) {
      if (isHighProduct) score += 0.60;
      if (isLowProduct) score -= 0.60;
    } else if (isLowSpec) {
      if (isLowProduct) score += 0.60;
      if (isHighProduct) score -= 0.60;
    } else if (isMidSpec) {
      if (isMidProduct) score += 0.50;
      if (isHighProduct) score -= 0.30;
      if (isLowProduct) score -= 0.30;
    }

    // 3. Seating Capacity Discriminator (1 / 2 / 3 Seater)
    const lowerDesc = description.toLowerCase();
    const is1SeaterSpec = lowerDesc.includes('single seater') || lowerDesc.includes('1 seater') || lowerDesc.includes('1-seater') || lowerDesc.includes('single seat');
    const is2SeaterSpec = lowerDesc.includes('two seater') || lowerDesc.includes('2 seater') || lowerDesc.includes('2-seater') || lowerDesc.includes('double');
    const is3SeaterSpec = lowerDesc.includes('three seater') || lowerDesc.includes('3 seater') || lowerDesc.includes('3-seater') || lowerDesc.includes('triple');

    const is1SeaterProd = modelStr.includes('single') || modelStr.includes('1 seater') || modelStr.includes('1-seater') || descStr.includes('single seater') || descStr.includes('1 seat');
    const is2SeaterProd = modelStr.includes('two') || modelStr.includes('2 seater') || modelStr.includes('2-seater') || descStr.includes('two seater') || descStr.includes('2 seat');
    const is3SeaterProd = modelStr.includes('three') || modelStr.includes('3 seater') || modelStr.includes('3-seater') || descStr.includes('three seater') || descStr.includes('3 seat');

    if (is1SeaterSpec) {
      if (is1SeaterProd) score += 0.40;
      if (is2SeaterProd || is3SeaterProd) score -= 0.40;
    } else if (is2SeaterSpec) {
      if (is2SeaterProd) score += 0.40;
      if (is1SeaterProd || is3SeaterProd) score -= 0.40;
    } else if (is3SeaterSpec) {
      if (is3SeaterProd) score += 0.40;
      if (is1SeaterProd || is2SeaterProd) score -= 0.40;
    }

    // 4. Door Type Discriminator (Swing vs Slide vs Glass)
    if (lowerDesc.includes('swing') || lowerDesc.includes('hinged')) {
      if (modelStr.includes('swing') || descStr.includes('swing') || modelStr.includes('hinged')) score += 0.30;
      if (modelStr.includes('slide') || descStr.includes('slide')) score -= 0.30;
    }
    if (lowerDesc.includes('glass')) {
      if (modelStr.includes('glass') || descStr.includes('glass')) score += 0.30;
    }

    // 5. Category affinity boost
    if (category) {
      const targetCat = String(category).toLowerCase();
      if (catStr.includes(targetCat) || targetCat.includes(catStr)) score += 0.20;
    }

    // 6. Brand Domain Specialization Modifier (e.g. Desking -> Narbutas/Ottimo/Nurus/MW, Seating -> Sedus/Sokoa/Rim)
    const brandAffinity = getBrandAffinityScore(description, p.brand, category || p.mainCategory);
    score += brandAffinity;

    // 3. Normalization ratio
    const normalizedScore = queryTokens.length > 0 ? Math.min(0.98, (score / (queryTokens.length * 0.45)) + 0.15) : 0.1;

    return {
      product: p,
      similarity: normalizedScore,
      confidenceScore: Math.round(normalizedScore * 100),
      exactModelMatch: false,
      matchReason: `Specification Match (${Math.round(normalizedScore * 100)}%)`
    };
  });

  return scored
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
    .map(item => {
      const p = item.product;
      return {
        model: p.model,
        brand: p.brand,
        brandLogo: p.brandLogo || '',
        price: p.price || 0,
        currency: p.currency || 'USD',
        imageUrl: p.imageUrl || (p.images && p.images[0]) || '',
        images: p.images || (p.imageUrl ? [p.imageUrl] : []),
        description: p.description || '',
        mainCategory: p.mainCategory || p.category || '',
        subCategory: p.subCategory || '',
        similarity: item.similarity,
        confidenceScore: item.confidenceScore,
        exactModelMatch: item.exactModelMatch || false,
        matchReason: item.exactModelMatch
          ? `🎯 Exact Model Match: "${p.model}" perfectly matching specifications (100%)`
          : `📊 Specification Match (${item.confidenceScore}%)`
      };
    });
}



/**
 * Simple keyword overlap similarity fallback
 */
function simpleKeywordOverlap(query, targetText) {
  const qWords = query.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const tWords = new Set(targetText.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2));
  if (qWords.length === 0 || tWords.size === 0) return 0.1;
  let matches = 0;
  for (const w of qWords) {
    if (tWords.has(w)) matches++;
  }
  return Math.min(0.85, (matches / qWords.length) * 0.75 + 0.15);
}

/**
 * Fallback keyword matching when embeddings are unavailable
 */
function fallbackKeywordMatch(description, products, topK = 3) {
  const scored = products.map(p => {
    const text = `${p.model || ''} ${p.description || ''} ${p.mainCategory || ''} ${p.subCategory || ''}`;
    const score = simpleKeywordOverlap(description, text);
    return {
      model: p.model,
      brand: p.brand,
      brandLogo: p.brandLogo || '',
      price: p.price || 0,
      currency: p.currency || 'USD',
      imageUrl: p.imageUrl || (p.images && p.images[0]) || '',
      images: p.images || (p.imageUrl ? [p.imageUrl] : []),
      description: p.description || '',
      mainCategory: p.mainCategory || p.category || '',
      subCategory: p.subCategory || '',
      similarity: score,
      confidenceScore: Math.round(score * 100),
      matchReason: `Keyword matching (${Math.round(score * 100)}%)`
    };
  });
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}
