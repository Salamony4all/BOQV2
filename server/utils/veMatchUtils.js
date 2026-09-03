/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Value Engineered Offer — Dedicated LLM Matching Utilities              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { callGoogle, callWithSchemaRetry, safeParseJSON, GOOGLE_MODEL, GROUNDING_MODEL, withRetry } from './llmUtils.js';
import axios from 'axios';
import { TAXONOMY } from './normalizer.js';

const ALLOWED_CATEGORIES = Object.keys(TAXONOMY).join(', ');
const ALLOWED_SUB_CATEGORIES = Object.values(TAXONOMY).flatMap(cat => Object.keys(cat)).join(', ');

// ──────────────────────────────────────────────────────────────────────────────
// STRICT JSON SCHEMAS
// ──────────────────────────────────────────────────────────────────────────────

const VE_MATCH_SCHEMA = {
  type: 'object',
  required: ['status', 'brand', 'model', 'mainCategory', 'subCategory', 'confidenceScore', 'evidence'],
  properties: {
    status: { type: 'string' },
    brand: { type: 'string' },
    model: { type: 'string' },
    family: { type: 'string' },
    mainCategory: { type: 'string' },
    subCategory: { type: 'string' },
    confidenceScore: { type: 'integer' },
    logic: { type: 'string' },
    evidence: {
      type: 'object',
      required: ['matchedKeywords', 'source'],
      properties: {
        matchedKeywords: { type: 'array', items: { type: 'string' } },
        source: { type: 'string' }
      }
    }
  }
};

const VE_DETAIL_SCHEMA = {
  type: 'object',
  required: ['brand', 'model', 'mainCategory', 'subCategory', 'imageUrl', 'websiteUrl', 'confidenceScore', 'evidence'],
  properties: {
    brand: { type: 'string' },
    brandLogo: { type: 'string' },
    model: { type: 'string' },
    family: { type: 'string' },
    mainCategory: { type: 'string' },
    subCategory: { type: 'string' },
    price: { type: 'number' },
    currency: { type: 'string' },
    imageUrl: { type: 'string' },
    websiteUrl: { type: 'string' },
    description: { type: 'string' },
    confidenceScore: { type: 'integer' },
    evidence: {
      type: 'object',
      required: ['sourceDomain'],
      properties: {
        sourceDomain: { type: 'string' },
        citationUrls: { type: 'array', items: { type: 'string' } }
      }
    }
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
// ──────────────────────────────────────────────────────────────────────────────

const VE_MATCH_SIMPLE_SYSTEM = (brand, modelList = []) => `You are an expert FF&E Product Matcher.
Your task is to identify the EXACT product model from the brand "${brand}" that best matches the provided description and image metadata.

### 🏢 BRAND: ${brand}

${modelList.length > 0 ? `### 📦 KNOWN PRODUCT CATALOG:
The following models ARE available for this brand. You MUST prioritize matching to one of these if the description fits:
- ${modelList.slice(0, 500).join('\n- ')}` : ''}

### 🌍 GLOBAL CATEGORY MAPPING:
You MUST map to one of these Main Categories: ${ALLOWED_CATEGORIES}
Sub-Categories: ${ALLOWED_SUB_CATEGORIES}

Return ONLY valid JSON strictly matching the schema:
{ 
  "status": "success",
  "brand": "${brand}", 
  "model": "Exact Model Name",
  "family": "Collection Name",
  "mainCategory": "Main Category",
  "subCategory": "Sub-Category",
  "confidenceScore": 95,
  "logic": "Brief reasoning",
  "evidence": {
    "matchedKeywords": ["keyword1", "keyword2"],
    "source": "SPECIFICATION_TEXT"
  }
}`;

const VE_MATCH_ADVANCED_SYSTEM = (brand, category, modelList = []) => `You are an expert FF&E Product Matcher specialized in "${category}".
Your task is to identify the EXACT product model from the brand "${brand}" within the "${category}" scope.

### 🏢 BRAND: ${brand}
### 🏷️ CATEGORY SCOPE: ${category}

${modelList.length > 0 ? `### 📦 KNOWN PRODUCT CATALOG:
The following models ARE available for this brand. You MUST prioritize matching to one of these if the description fits:
- ${modelList.slice(0, 500).join('\n- ')}` : ''}

### 🌍 GLOBAL CATEGORY MAPPING:
You MUST map to one of these Main Categories: ${ALLOWED_CATEGORIES}
Sub-Categories: ${ALLOWED_SUB_CATEGORIES}

Return ONLY valid JSON strictly matching the schema:
{ 
  "status": "success",
  "brand": "${brand}", 
  "model": "Exact Model Name",
  "family": "Collection Name",
  "mainCategory": "Main Category",
  "subCategory": "Sub-Category",
  "confidenceScore": 95,
  "logic": "Brief reasoning",
  "evidence": {
    "matchedKeywords": ["keyword1", "keyword2"],
    "source": "SPECIFICATION_TEXT"
  }
}`;

/**
 * Stage 1: Identification (Simple Global Scope) with Schema Retry
 */
export async function veMatchSimple(description, brand, modelList = [], providerModel = null, imageEvidence = []) {
    return withRetry(async () => {
        const system = VE_MATCH_SIMPLE_SYSTEM(brand, modelList);
        let user = `Description: "${description}"`;
        if (imageEvidence && imageEvidence.length > 0) {
            user += `\nImage Metadata & OCR Context: ${JSON.stringify(imageEvidence)}`;
        }

        console.log(`  🤖 [VE Match Simple] Matching: ${description.substring(0, 50)}...`);

        try {
            const parsed = await callWithSchemaRetry(system, user, VE_MATCH_SCHEMA, 2, providerModel);
            if (!parsed || parsed.model === 'FAILED') throw new Error('AI failed to match');
            return { status: 'success', ...parsed };
        } catch (err) {
            console.error(`  ❌ [VE Match Simple] Failed for ${description}:`, err.message);
            throw err;
        }
    });
}

/**
 * Stage 1: Identification (Advanced Categorical Scope) with Schema Retry
 */
export async function veMatchAdvanced(description, brand, category, modelList = [], providerModel = null, imageEvidence = []) {
    return withRetry(async () => {
        const system = VE_MATCH_ADVANCED_SYSTEM(brand, category, modelList);
        let user = `Description: "${description}" within "${category}" scope.`;
        if (imageEvidence && imageEvidence.length > 0) {
            user += `\nImage Metadata & OCR Context: ${JSON.stringify(imageEvidence)}`;
        }

        console.log(`  🤖 [VE Match Advanced] Matching: ${description.substring(0, 50)}... in ${category}`);

        try {
            const parsed = await callWithSchemaRetry(system, user, VE_MATCH_SCHEMA, 2, providerModel);
            if (!parsed || parsed.model === 'FAILED') throw new Error('AI failed to match');
            return { status: 'success', ...parsed };
        } catch (err) {
            console.error(`  ❌ [VE Match Advanced] Failed for ${description}:`, err.message);
            throw err;
        }
    });
}

const VE_DETAIL_SYSTEM = (brand, model, directUrl = '') => `You are an elite FF&E Architectural Product Data & High-Resolution Asset Specialist.
Your job is to discover and extract exact manufacturer product specifications from official manufacturer websites (or architectural platforms like Architonic, Archello, Archiproducts, Moodie).

Target Manufacturer: ${brand}
Target Model / Product: ${model}
${directUrl ? `Reference / Catalog URL: ${directUrl}` : ''}

Strict Extraction Rules:
1. ONLY extract genuine contract furniture MANUFACTURERS (e.g. Freifrau, Dedon, Figueras, Emu, Herman Miller, B&T Design, TON, Pedrali, Narbutas, Sedus, Moonako, Infabbrica, Sui Generis, Ciment Studio). Strictly ignore local dealers, trading suppliers, or retail stores.
2. Find the direct, high-resolution product image (JPG, PNG, WEBP) hosted on the official manufacturer CDN, reference page CDN, or Architonic CDN.
3. Determine the standard contract category tree:
   - mainCategory: Must be one of ["Desk & Table", "Office Seating", "Furniture", "Storage", "Office Cubicle", "Partition Wall", "Acoustic Solutions", "Accessories"]
   - subCategory: Specific sub-category (e.g. "Lounge Chairs", "Conference Tables", "Executive Desks", "Sofas", "Task Chairs", "Specialist Chairs", "Office Pods", "Coffee Tables", "Cabinets", "Benches")
   - family: Product collection/series name (e.g. "Stella", "Scala", "Satellite", "Carousel", "Noda", "Arco", "Lobby", "Limone", "Piper", "Pila")
4. Find the official brand logo URL (SVG or PNG).
5. Extract realistic contract price (number only) and currency ("USD", "EUR", "AED", "OMR", "GBP").
6. Provide a concise technical specification summary (materials, dimensions HxWxD, frame/base construction).
7. NEVER refuse or return conversational apologies. If exact details are partially missing, provide the closest authentic specifications from the reference catalog page or manufacturer. Output ONLY valid JSON matching the schema below.

Return ONLY valid JSON matching this exact structure:
{
  "brand": "${brand}",
  "brandLogo": "https://...",
  "model": "${model}",
  "family": "Collection Name",
  "mainCategory": "Office Seating",
  "subCategory": "Lounge Chairs",
  "imageUrl": "https://...",
  "websiteUrl": "${directUrl || 'https://...'}",
  "price": 0,
  "currency": "USD",
  "origin": "Country of Manufacture",
  "description": "Technical specifications, dimensions (WxDxH), structure, materials and finish details...",
  "confidenceScore": 95,
  "evidence": {
    "sourceDomain": "${directUrl ? 'direct_url' : 'official_manufacturer'}",
    "citationUrls": ["https://..."]
  }
}`;

/**
 * Fetch product image + website URL + category taxonomy for a VE-matched item.
 */
export async function veGetProductDetails(brand, model, providerModel = null, directUrl = '', categoryHint = '', imageEvidence = []) {
    return withRetry(async () => {
        const system = VE_DETAIL_SYSTEM(brand, model, directUrl);
        let user = `Discover official manufacturer specifications, high-res image, and category hierarchy for: ${brand} ${model}${categoryHint ? ` (Category Hint: ${categoryHint})` : ''}${directUrl ? ` [Official Page: ${directUrl}]` : ''}`;
        if (imageEvidence && imageEvidence.length > 0) {
            user += `\nSpatial Image OCR Context: ${JSON.stringify(imageEvidence)}`;
        }

        console.log(`  🌐 [VE Details] Fetching live details & taxonomy for: ${brand} ${model}${directUrl ? ` (${directUrl})` : ''}`);

        try {
            const parsed = await callWithSchemaRetry(system, user, VE_DETAIL_SCHEMA, 2, providerModel);

            if (!parsed) throw new Error('Empty response from AI');

            parsed.brand = parsed.brand || brand;
            parsed.model = parsed.model || model;
            parsed.price = parseFloat(parsed.price) || 0;
            if (directUrl && (!parsed.websiteUrl || parsed.websiteUrl.length < 5)) {
                parsed.websiteUrl = directUrl;
            }

            return { status: 'success', product: parsed };
        } catch (err) {
            console.error(`  ❌ [VE Details] Failed for ${brand} ${model}:`, err.message);
            return { status: 'error', error_message: err.message };
        }
    });
}

/**
 * Map-Reduce Routing Agent (Bulletproofed with schema validation & retry)
 * Categorizes items into functional groups to optimize downstream AI matching.
 */
export async function veRouteCategories(items, providerModel = null) {
    return withRetry(async () => {
        const system = `You are a high-speed FF&E routing agent. Categorize the provided items.
CRITICAL: Output ONLY valid JSON exactly matching this structure, with no markdown:
{
  "desking": ["id1"],
  "seating": ["id2"],
  "softSeating": [],
  "accessories": []
}`;

        const itemsList = items.map(item => `ID: "${item.id}" | Desc: "${item.desc}"`).join('\n');
        const user = `Categorize these items:\n${itemsList}`;

        console.log(`  🚀 [VE Route] Sending ${items.length} items to AI Router...`);
        const result = await callGoogle(system, user, false, providerModel);

        if (!result || typeof result !== 'object') throw new Error("Router returned non-object");
        if (result.desking === undefined && result.seating === undefined && result.softSeating === undefined && result.accessories === undefined) {
            throw new Error("Router returned invalid schema, missing category arrays");
        }

        return {
            desking: Array.isArray(result.desking) ? result.desking.map(String) : [],
            seating: Array.isArray(result.seating) ? result.seating.map(String) : [],
            softSeating: Array.isArray(result.softSeating) ? result.softSeating.map(String) : [],
            accessories: Array.isArray(result.accessories) ? result.accessories.map(String) : [],
            status: 'success'
        };
    }, 3, 2000).catch(err => {
        console.error(`  ❌ [VE Route] Categorization failed after retries:`, err.message);
        return { desking: [], seating: [], softSeating: [], accessories: [], status: 'error', error_message: err.message };
    });
}