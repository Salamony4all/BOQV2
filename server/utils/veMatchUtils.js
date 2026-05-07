/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Value Engineered Offer — Dedicated LLM Matching Utilities              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { callGoogle, safeParseJSON, GOOGLE_MODEL, GROUNDING_MODEL, withRetry } from './llmUtils.js';
import axios from 'axios';
import { TAXONOMY } from './normalizer.js';

const ALLOWED_CATEGORIES = Object.keys(TAXONOMY).join(', ');
const ALLOWED_SUB_CATEGORIES = Object.values(TAXONOMY).flatMap(cat => Object.keys(cat)).join(', ');

// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
// ──────────────────────────────────────────────────────────────────────────────

const VE_MATCH_SIMPLE_SYSTEM = (brand, modelList = []) => `You are an expert FF&E Product Matcher.
Your task is to identify the EXACT product model from the brand "${brand}" that best matches the provided description.

### 🏢 BRAND: ${brand}

${modelList.length > 0 ? `### 📦 KNOWN PRODUCT CATALOG:
The following models ARE available for this brand. You MUST prioritize matching to one of these if the description fits:
- ${modelList.slice(0, 500).join('\n- ')}` : ''}

### 🌍 GLOBAL CATEGORY MAPPING:
You MUST map to one of these Main Categories: ${ALLOWED_CATEGORIES}
Sub-Categories: ${ALLOWED_SUB_CATEGORIES}

Return ONLY valid JSON:
{ 
  "status": "success",
  "brand": "${brand}", 
  "model": "Exact Model Name",
  "mainCategory": "Main Category",
  "subCategory": "Sub-Category",
  "logic": "Brief reasoning" 
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

Return ONLY valid JSON:
{ 
  "status": "success",
  "brand": "${brand}", 
  "model": "Exact Model Name",
  "mainCategory": "Main Category",
  "subCategory": "Sub-Category",
  "logic": "Brief reasoning" 
}`;

/**
 * Stage 1: Identification (Simple Global Scope)
 */
export async function veMatchSimple(description, brand, modelList = [], providerModel = null) {
    return withRetry(async () => {
        const system = VE_MATCH_SIMPLE_SYSTEM(brand, modelList);
        const user = `What is the best matching model for: "${description}"?`;

        console.log(`  🤖 [VE Match Simple] Matching: ${description.substring(0, 50)}...`);

        try {
            const parsed = await callGoogle(system, user, false, providerModel);
            if (!parsed || parsed.model === 'FAILED') throw new Error('AI failed to match');
            return { status: 'success', ...parsed };
        } catch (err) {
            console.error(`  ❌ [VE Match Simple] Failed for ${description}:`, err.message);
            throw err;
        }
    });
}

/**
 * Stage 1: Identification (Advanced Categorical Scope)
 */
export async function veMatchAdvanced(description, brand, category, modelList = [], providerModel = null) {
    return withRetry(async () => {
        const system = VE_MATCH_ADVANCED_SYSTEM(brand, category, modelList);
        const user = `What is the best matching model for: "${description}" within the "${category}" category?`;

        console.log(`  🤖 [VE Match Advanced] Matching: ${description.substring(0, 50)}... in ${category}`);

        try {
            const parsed = await callGoogle(system, user, false, providerModel);
            if (!parsed || parsed.model === 'FAILED') throw new Error('AI failed to match');
            return { status: 'success', ...parsed };
        } catch (err) {
            console.error(`  ❌ [VE Match Advanced] Failed for ${description}:`, err.message);
            throw err;
        }
    });
}


const VE_DETAIL_SYSTEM = (brand, model) => `You are an FF&E Product Data Extraction Agent.
Find the official product page and high-quality image for the following item:
Brand: ${brand}
Model: ${model}

Return the following fields:
- brand: Confirmed brand name
- model: Confirmed model name
- imageUrl: Direct link to a clear product image (JPG/PNG/WEBP). MUST be a direct image URL.
- websiteUrl: Direct product page link
- price: Numeric price if available (USD/EUR), else 0
- description: Short technical description (max 20 words)

Return ONLY valid JSON:
{
  "brand": "${brand}",
  "model": "${model}",
  "imageUrl": "direct-image-url.jpg",
  "websiteUrl": "https://product-page-url",
  "price": 0,
  "description": "Short technical description"
}`;

/**
 * Fetch product image + website URL for a VE-matched item.
 */
export async function veGetProductDetails(brand, model, providerModel = null) {
    return withRetry(async () => {
        const system = VE_DETAIL_SYSTEM(brand, model);
        const user = `Find the product image and page for: ${brand} ${model}`;

        console.log(`  🌐 [VE Details] Fetching details for: ${brand} ${model}`);

        try {
            const parsed = await callGoogle(system, user, true, providerModel);

            if (!parsed) throw new Error('Empty response from AI');

            parsed.brand = parsed.brand || brand;
            parsed.model = parsed.model || model;
            parsed.price = parseFloat(parsed.price) || 0;

            return { status: 'success', product: parsed };
        } catch (err) {
            console.error(`  ❌ [VE Details] Failed for ${brand} ${model}:`, err.message);
            return { status: 'error', error_message: err.message };
        }
    }); // Wrapped in withRetry
}

/**
 * Map-Reduce Routing Agent (Bulletproofed with schema validation & retry)
 * Categorizes items into functional groups to optimize downstream AI matching.
 * * @param {Array<{id: string, desc: string}>} items - List of BOQ items to route
 * @param {string} providerModel - Specific model override
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

        // Validation: Force retry if AI hallucinates the structure
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