/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Value Engineered Offer — Dedicated LLM Matching Utilities              │
 * │                                                                         │
 * │  Option 1: Single Brand (Global Scope)                                  │
 * │    AI Query: What is the best single "Model Name" for                   │
 * │              "[Item Description]" from "[Brand Name]"?                  │
 * │                                                                         │
 * │  Option 2: Brand Advanced (Categorical Scope)                            │
 * │    AI Query: What is the best single "Model Name" for                   │
 * │              "[Item Description]" from "[Selected Category]"            │
 * │              from "[Brand Name]"?                                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { callGoogle, safeParseJSON, GOOGLE_MODEL, GROUNDING_MODEL } from './llmUtils.js';
import axios from 'axios';

// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Option 1: Global Brand Scope
 * Prompt: What is the best single "Model Name" for "[description]" from "[brand]"?
 */
const VE_SIMPLE_SYSTEM = (brand, modelList = []) => `You are a premium Furniture Specification Expert for a Value Engineered Offer.
Your sole task is to identify the single best product model from the brand "${brand}" that matches the given item description.

### 🏢 BRAND:
- Brand Name: ${brand}
- Goal: Value Engineering — identify the most practical, commercially-available model that fulfills the specification.

${modelList.length > 0 ? `### 📦 KNOWN PRODUCT CATALOG (from "${brand}"):
You MUST prioritize matching to one of these if the description fits:
- ${modelList.slice(0, 500).join('\n- ')}` : `### 📦 PRODUCT CATALOG:
No local catalog available. Use your knowledge of the brand's official product range from Architonic, the brand website, or Stylepark.`}

### 📐 MATCHING RULES:
- Match by FUNCTION first (chair ≠ stool, coffee table ≠ meeting table)
- Match by SIZE/SCALE context when qty/dimensions are mentioned
- Return the most specific, commercially-real model name (not a generic category name)
- If no exact match: return the closest real model in the same functional category

Return ONLY valid JSON — no markdown, no explanation:
{
  "brand": "${brand}",
  "model": "Exact Product Model Name",
  "mainCategory": "e.g. Seating / Desking / Storage",
  "subCategory": "e.g. Task Chair / Sit-Stand Desk",
  "logic": "1-sentence reason for this selection"
}`;

/**
 * Option 2: Advanced Categorical Scope
 * Prompt: What is the best single "Model Name" for "[description]" from "[category]" from "[brand]"?
 */
const VE_ADVANCED_SYSTEM = (brand, category, modelList = []) => `You are a premium Furniture Specification Expert for a Value Engineered Offer.
Your sole task is to identify the single best product model from the brand "${brand}" — specifically within the "${category}" category — that matches the given item description.

### 🏢 BRAND + CATEGORY SCOPE:
- Brand Name: ${brand}
- Assigned Category: ${category}
- This brand has been specifically selected by the user for this category. Stay within this scope.

${modelList.length > 0 ? `### 📦 KNOWN PRODUCT CATALOG (${brand} — ${category}):
You MUST prioritize matching to one of these if the description fits:
- ${modelList.slice(0, 500).join('\n- ')}` : `### 📦 PRODUCT CATALOG:
No local catalog available. Use your knowledge of the brand's "${category}" range from Architonic, the brand website, or Stylepark.`}

### 📐 MATCHING RULES:
- You are scoped to the "${category}" category ONLY — do not suggest items outside this
- Match by FUNCTION first (chair ≠ stool, coffee table ≠ meeting table)
- Match by SIZE/SCALE context when qty/dimensions are mentioned
- Return the most specific, commercially-real model name (not a generic category name)
- If no exact match within "${category}": return the closest real model in the same functional category

Return ONLY valid JSON — no markdown, no explanation:
{
  "brand": "${brand}",
  "model": "Exact Product Model Name",
  "mainCategory": "${category}",
  "subCategory": "e.g. Task Chair / Sit-Stand Desk",
  "logic": "1-sentence reason for this selection — must reference the ${category} category"
}`;

// ──────────────────────────────────────────────────────────────────────────────
// OPTION 1: SIMPLE BRAND MATCH
// What is the best single "Model Name" for "[description]" from "[brand]"?
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} description  - Item description from BOQ
 * @param {string} brand        - Single selected brand (global scope)
 * @param {string[]} modelList  - Known models from local DB (optional, for cache-boost)
 * @param {string} providerModel - Specific model override
 * @returns {{ status: 'success'|'error', brand, model, mainCategory, subCategory, logic, error_message? }}
 */
export async function veMatchSimple(description, brand, modelList = [], providerModel = null) {
    const system = VE_SIMPLE_SYSTEM(brand, modelList);
    const user = `What is the best single "Model Name" for "${description}" from "${brand}"?`;

    console.log(`\n🎯 [VE Simple] Brand: ${brand} | Desc: "${description.substring(0, 60)}..."`);
    if (process.env.DEBUG_AI === 'true') {
        console.log(`  📝 [VE Simple Prompt] User: ${user}`);
    }

    try {
        const parsed = await callGoogle(system, user, true, providerModel || GROUNDING_MODEL);

        if (parsed && parsed.model && parsed.model !== 'FAILED') {
            console.log(`  ✅ [VE Simple] Match: ${brand} → "${parsed.model}"`);
            return {
                status: 'success',
                brand: parsed.brand || brand,
                model: parsed.model,
                mainCategory: parsed.mainCategory || '',
                subCategory: parsed.subCategory || '',
                logic: parsed.logic || ''
            };
        }

        throw new Error('AI did not return a valid model name');
    } catch (err) {
        console.error(`  ❌ [VE Simple] Failed for ${brand}:`, err.message);
        return { status: 'error', brand, model: '', error_message: err.message };
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// OPTION 2: ADVANCED CATEGORICAL MATCH
// What is the best single "Model Name" for "[description]" from "[category]" from "[brand]"?
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} description  - Item description from BOQ
 * @param {string} brand        - Brand assigned to this category
 * @param {string} category     - Category label (e.g. "Desking", "Seating")
 * @param {string[]} modelList  - Known models from local DB (optional)
 * @param {string} providerModel - Specific model override
 * @returns {{ status: 'success'|'error', brand, model, mainCategory, subCategory, logic, error_message? }}
 */
export async function veMatchAdvanced(description, brand, category, modelList = [], providerModel = null) {
    const system = VE_ADVANCED_SYSTEM(brand, category, modelList);
    const user = `What is the best single "Model Name" for "${description}" from "${category}" from "${brand}"?`;

    console.log(`\n🎯 [VE Advanced] Brand: ${brand} | Category: ${category} | Desc: "${description.substring(0, 60)}..."`);
    if (process.env.DEBUG_AI === 'true') {
        console.log(`  📝 [VE Advanced Prompt] User: ${user}`);
    }

    try {
        const parsed = await callGoogle(system, user, true, providerModel || GROUNDING_MODEL);

        if (parsed && parsed.model && parsed.model !== 'FAILED') {
            console.log(`  ✅ [VE Advanced] Match: ${brand} [${category}] → "${parsed.model}"`);
            return {
                status: 'success',
                brand: parsed.brand || brand,
                model: parsed.model,
                mainCategory: parsed.mainCategory || category,
                subCategory: parsed.subCategory || '',
                logic: parsed.logic || ''
            };
        }

        throw new Error('AI did not return a valid model name');
    } catch (err) {
        console.error(`  ❌ [VE Advanced] Failed for ${brand} [${category}]:`, err.message);
        return { status: 'error', brand, model: '', error_message: err.message };
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// DETAIL FETCHER (shared for both options — finds image + website URL)
// ──────────────────────────────────────────────────────────────────────────────

const VE_DETAIL_SYSTEM = (brand, model) => `You are a Furniture Detail Specialist for a Value Engineered Offer.
Find the official product details for: "${brand} ${model}".

### 🔍 DISCOVERY PROTOCOL (Strict Order):
1. **Architonic**: First source for European/Global furniture brands.
2. **Official Brand Website**: For technical specs and direct product links.
3. **Stylepark**: Fallback for high-end design items.

### DATA TO RETURN:
- imageUrl: Direct link to a high-resolution product image (jpg/png/webp) — NOT a page URL
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
 * Shared by both Option 1 and Option 2.
 */
export async function veGetProductDetails(brand, model, providerModel = null) {
    const system = VE_DETAIL_SYSTEM(brand, model);
    const user = `Find the product image and page for: ${brand} ${model}`;

    console.log(`  🌐 [VE Details] Fetching details for: ${brand} ${model}`);

    try {
        const parsed = await callGoogle(system, user, true, providerModel || GROUNDING_MODEL);

        if (!parsed) throw new Error('Empty response from AI');

        parsed.brand = parsed.brand || brand;
        parsed.model = parsed.model || model;
        parsed.price = parseFloat(parsed.price) || 0;

        return { status: 'success', product: parsed };
    } catch (err) {
        console.error(`  ❌ [VE Details] Failed for ${brand} ${model}:`, err.message);
        return { status: 'error', error_message: err.message };
    }
}
