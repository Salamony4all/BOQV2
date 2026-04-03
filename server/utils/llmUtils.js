import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from 'axios';
import 'dotenv/config';

// ──────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────────────────────────────────────
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Model ids
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-2.5-flash';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-lite-001';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'meta/llama-3.1-405b-instruct';

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────

/** Strip markdown fences, then parse JSON. */
function safeParseJSON(text) {
    if (!text) throw new Error('Empty AI response');
    const cleaned = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    return JSON.parse(cleaned);
}

/** Generic OpenRouter call expecting JSON object back. */
async function callOpenRouter(systemPrompt, userPrompt) {
    const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
            model: OPENROUTER_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        },
        {
            headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 60000
        }
    );
    const raw = res.data.choices[0].message.content;
    return typeof raw === 'string' ? safeParseJSON(raw) : raw;
}

/** Generic NVIDIA NIM call expecting JSON object back. */
async function callNvidia(systemPrompt, userPrompt) {
    const res = await axios.post(
        'https://integrate.api.nvidia.com/v1/chat/completions',
        {
            model: NVIDIA_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.1,
            max_tokens: 1024,
            response_format: { type: 'json_object' }
        },
        {
            headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 60000
        }
    );
    const raw = res.data.choices[0].message.content;
    return typeof raw === 'string' ? safeParseJSON(raw) : raw;
}

/** Google Gemini call with optional Grounding (Web Search). */
async function callGoogle(systemPrompt, userPrompt, useSearch = false) {
    const tools = useSearch ? [{ googleSearch: {} }] : [];
    const model = genAI.getGenerativeModel({
        model: GOOGLE_MODEL,
        systemInstruction: systemPrompt,
        tools: tools,
        generationConfig: {
            temperature: 0.1,
            responseMimeType: tools.length > 0 ? undefined : 'application/json'
        }
    });
    const result = await model.generateContent(userPrompt);
    return safeParseJSON(result.response.text());
}

// ──────────────────────────────────────────────────────────────────────────────
// STAGE 1 ─ IDENTIFY: "What is the best ONE model for [desc] from [brand]?"
// ──────────────────────────────────────────────────────────────────────────────

const IDENTIFY_SYSTEM = (brand, tier) => `You are a senior FF&E (Furniture, Fixtures & Equipment) procurement specialist.

Your task: Given a "BOQ Item Description" and a specific furniture brand "${brand}", identify the SINGLE BEST product model from that brand that best matches the description.

Rules:
- Respond with exactly ONE model name — the most precise flagship model.
- Do NOT invent or hallucinate models. Use your knowledge of ${brand}'s actual catalog.
- Use web search if needed to confirm the model name.
- Budget Tier: ${tier} (budgetary = value range, mid = standard office, high = premium/design).

Respond ONLY with valid JSON (no markdown):
{
  "brand": "${brand}",
  "model": "Exact official model name",
  "confidence": "high | medium | low"
}`;

/**
 * STAGE 1: Ask AI to identify the single best model for one brand.
 * Returns { brand, model } or throws.
 */
export async function identifyModel(description, brand, tier, provider = 'google') {
    const system = IDENTIFY_SYSTEM(brand, tier);
    const user = `BOQ Item Description: "${description}"\nBrand: ${brand}\nBudget Tier: ${tier}\n\nWhat is the best ONE model from ${brand} for this item?`;

    console.log(`  🔍 [Stage 1 / ${provider}] Identify: "${description.substring(0, 60)}" from ${brand}`);
    try {
        let parsed;
        if (provider === 'google') {
            parsed = await callGoogle(system, user, true); // enable web search
        } else if (provider === 'openrouter') {
            parsed = await callOpenRouter(system, user);
        } else if (provider === 'nvidia') {
            parsed = await callNvidia(system, user);
        } else {
            throw new Error(`Unsupported provider: ${provider}`);
        }

        if (!parsed.model) throw new Error('AI returned no model name');
        console.log(`  ✅ [Stage 1] Identified: ${brand} → ${parsed.model} (confidence: ${parsed.confidence || 'unknown'})`);
        return { status: 'success', brand: parsed.brand || brand, model: parsed.model };
    } catch (err) {
        console.error(`  ❌ [Stage 1 Error]:`, err.message);
        return { status: 'error', brand: brand, model: '', error_message: err.message };
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// STAGE 3 ─ FETCH: Get full product details from web when model is missing in DB
// ──────────────────────────────────────────────────────────────────────────────

const FETCH_SYSTEM = (brand, model) => `You are a senior FF&E researcher with expert knowledge of furniture brand catalogs (Architonic, brand official sites, etc.).

Your task: Find the full product details for "${model}" by ${brand}.

Search Architonic at: https://www.architonic.com/en/search?q=${encodeURIComponent(brand + ' ' + model)}
Or the brand's official website as fallback.

Extract and return ONLY valid JSON (no markdown):
{
  "brand": "${brand}",
  "mainCategory": "Furniture",
  "subCategory": "Standardized sub-category (e.g. Task Chairs, Lounge Chairs, Meeting Tables, Storage)",
  "family": "Collection/family name from the brand",
  "model": "${model}",
  "description": "Professional product description (2-4 sentences, technical specs)",
  "imageUrl": "MUST be a direct image URL ending in .jpg, .jpeg, .png, or .webp from the brand CDN or Architonic CDN (NOT a page URL, NOT a thumbnail without extension). Example: https://img.architonic.com/..../image.jpg",
  "productUrl": "Direct product page URL on Architonic or brand site",
  "price": 0
}

IMPORTANT: For imageUrl, only provide a URL that:
- Starts with https://
- Ends with .jpg, .jpeg, .png, or .webp (before any query string)
- Is a direct image file, NOT a page URL
- If you cannot find a valid direct image URL, set imageUrl to ""

If you cannot find the product, respond:
{ "status": "error", "error_message": "reason" }`;

/**
 * STAGE 3: Fetch full product details from web for a known brand+model.
 * Returns full product object or { status: 'error' }.
 */
export async function fetchProductDetails(brand, model, tier, provider = 'google') {
    const system = FETCH_SYSTEM(brand, model);
    const user = `Find full product details for: ${brand} ${model}\nUse Architonic or the brand's official website.`;

    console.log(`  🌐 [Stage 3 / ${provider}] Fetching web details: ${brand} ${model}`);
    try {
        let parsed;
        if (provider === 'google') {
            parsed = await callGoogle(system, user, true); // web search enabled
        } else if (provider === 'openrouter') {
            parsed = await callOpenRouter(system, user);
        } else if (provider === 'nvidia') {
            parsed = await callNvidia(system, user);
        } else {
            throw new Error(`Unsupported provider: ${provider}`);
        }

        if (parsed.status === 'error') return parsed;
        if (!parsed.model) throw new Error('AI returned no product data');

        console.log(`  ✅ [Stage 3] Fetched: ${brand} ${parsed.model}`);
        return { status: 'success', product: parsed };
    } catch (err) {
        console.error(`  ❌ [Stage 3 Error]:`, err.message);
        return { status: 'error', error_message: err.message };
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// LEGACY: getAiMatch (single-step, kept for backward compatibility)
// ──────────────────────────────────────────────────────────────────────────────

export async function getAiMatch(description, brandTarget, tier, provider = 'google') {
    // Wrap as single-step: identify + fetch in one prompt
    const isList = Array.isArray(brandTarget);
    const brandLabel = isList ? brandTarget.join(', ') : brandTarget;

    const system = `You are a senior FF&E procurement specialist. Given a BOQ item description and candidate brands, identify the single best matching product.

Return ONLY valid JSON:
{
  "status": "success",
  "product": {
    "brand": "exact brand name",
    "mainCategory": "Furniture",
    "subCategory": "category",
    "family": "collection name",
    "model": "official model name",
    "description": "technical description",
    "imageUrl": "direct image URL",
    "productUrl": "product page URL",
    "price": 0
  }
}`;

    const user = `BOQ Description: ${description}\nBrands to consider: ${brandLabel}\nBudget Tier: ${tier}`;

    try {
        let parsed;
        if (provider === 'google') {
            parsed = await callGoogle(system, user, false);
        } else if (provider === 'openrouter') {
            parsed = await callOpenRouter(system, user);
        } else {
            parsed = await callNvidia(system, user);
        }
        return parsed;
    } catch (err) {
        return { status: 'error', error_message: err.message };
    }
}
