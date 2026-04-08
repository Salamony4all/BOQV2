import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from 'axios';
import 'dotenv/config';
import { TAXONOMY } from './normalizer.js';

// ──────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────────────────────────────────────
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Model ids
// Valid model names: gemini-1.5-pro, gemini-1.5-flash, gemini-2.5-flash, gemini-2.0-flash-exp, etc.
// Default to 2.5-flash if .env is missing or has a typo
export const VALID_GOOGLE_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash',
    'gemini-1.5-flash-002',
    'gemini-1.5-pro'
];
export const VALID_OPENROUTER_MODELS = [
    // Google Vision Models
    'google/gemini-2.5-flash-lite-001',
    'google/gemini-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
    'google/gemma-4-31b-it:free',
    'google/gemini-2.5-pro',
    // Anthropic Vision Models
    'anthropic/claude-opus-4.6-fast',
    'anthropic/claude-opus-4',
    'anthropic/claude-sonnet-4-20250514',
    // OpenAI Vision Models
    'openai/gpt-4-vision-preview',
    'openai/gpt-4-turbo-vision',
    // Other vision models
    'z-ai/glm-5.1',
    'cohere/rerank-4-pro'
];
export const VALID_NVIDIA_MODELS = [
    'nvidia/llama-3.3-70b-instruct',
    'nvidia/llama-3.1-70b-instruct',
    'nvidia/nemotron-3-super-120b-a12b',
    'nvidia/gemma-4-31b-it',
    'nvidia/cosmos-transfer2_5-2b',
    // Vision models
    'nvidia/vila',
    'nvidia/vlia',
    'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
    'nvidia/nemotron-nano-12b-v2-vl',
    // Other free/paid models
    'nvidia/llama-3.1-nemotron-nano-8b-v1',
    'nvidia/llama-3.1-nemotron-70b-reward',
    'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    'nvidia/llama-3.3-nemotron-super-49b-v1',
    'nvidia/llama-3.3-nemotron-super-49b-v1.5'
];
export const GOOGLE_MODEL = VALID_GOOGLE_MODELS.includes(process.env.GOOGLE_MODEL) ? process.env.GOOGLE_MODEL : 'gemini-2.5-flash';
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite-001';
export const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'nvidia/llama-3.3-70b-instruct';
export const GROUNDING_MODEL = process.env.GOOGLE_MODEL || 'gemini-2.5-flash'; // Standard model for this environment

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

const isValidProviderModel = (provider, model) => {
    if (!model) return false;
    if (provider === 'google') return VALID_GOOGLE_MODELS.includes(model);
    if (provider === 'openrouter') return VALID_OPENROUTER_MODELS.includes(model);
    if (provider === 'nvidia') return VALID_NVIDIA_MODELS.includes(model);
    return false;
};

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────

/** Strip markdown fences, then parse JSON with surgical precision. */
function safeParseJSON(text) {
    if (!text) throw new Error('Empty AI response');
    
    // 1. Structural Anchor Discovery (Regex-based)
    let cleaned = text;
    const itemsMatch = text.match(/\{\s*"items"\s*:/);
    const invMatch = text.match(/\{\s*"inventory"\s*:/);
    
    const itemsStartIdx = itemsMatch ? itemsMatch.index : -1;
    const invStartIdx = invMatch ? invMatch.index : -1;
    
    let startIdx = -1;
    if (itemsStartIdx !== -1 && invStartIdx !== -1) {
        startIdx = Math.min(itemsStartIdx, invStartIdx);
    } else {
        startIdx = itemsStartIdx !== -1 ? itemsStartIdx : invStartIdx;
    }
    
    const lastBraceIdx = text.lastIndexOf('}');
    
    // If we have a lot of text before the first '{', find the first '{' that looks like JSON
    const firstBraceIdx = text.indexOf('{');
    
    if (firstBraceIdx !== -1 && lastBraceIdx !== -1 && lastBraceIdx > firstBraceIdx) {
        cleaned = text.substring(firstBraceIdx, lastBraceIdx + 1);
    } else {
        cleaned = text
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
    }

    const attemptParse = (str) => {
        try {
            // Further clean: strip control characters that might break JSON.parse
            const san = str.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
            return JSON.parse(san);
        } catch (e) {
            return null;
        }
    };

    let result = attemptParse(cleaned);
    if (result) return result;

    console.warn('  ⚠️ [LLM Utils] Standard parse failed, attempting surgical repair...');

    let fixed = cleaned;
    const quoteMatches = fixed.match(/"/g) || [];
    if (quoteMatches.length % 2 !== 0) {
        fixed += '"';
    }

    const balanceAndParse = (str) => {
        let stack = [];
        let finalStr = str;
        for (let char of str) {
            if (char === '{') stack.push('}');
            else if (char === '[') stack.push(']');
            else if (char === '}') { if (stack[stack.length-1] === '}') stack.pop(); }
            else if (char === ']') { if (stack[stack.length-1] === ']') stack.pop(); }
        }
        finalStr += stack.reverse().join('');
        return attemptParse(finalStr);
    };

    result = balanceAndParse(fixed);
    if (result) return result;

    console.error('  ❌ [LLM Utils] All JSON repair strategies exhausted.');
    const finalErr = new Error('The AI response was severely malformed or truncated.');
    finalErr.rawResponse = text;
    throw finalErr;
}

/** Generic OpenRouter call expecting JSON object back. */
async function callOpenRouter(systemPrompt, userPrompt, modelName = null) {
    try {
        const res = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: modelName || OPENROUTER_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            },
            {
                headers: { 
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://boqv2.vercel.app',
                    'X-Title': 'Boqify'
                },
                timeout: 60000
            }
        );
        const raw = res.data.choices[0].message.content;
        return typeof raw === 'string' ? safeParseJSON(raw) : raw;
    } catch (err) {
        console.error(`  ❌ [OpenRouter] Status: ${err.response?.status}, Message: ${err.response?.data?.error?.message || err.message}`);
        throw err;
    }
}

/** Generic NVIDIA NIM call expecting JSON object back. */
async function callNvidia(systemPrompt, userPrompt, modelName = null) {
    try {
        const res = await axios.post(
            'https://integrate.api.nvidia.com/v1/chat/completions',
            {
                model: modelName || NVIDIA_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                max_tokens: 16384,
                response_format: { type: 'json_object' }
            },
            {
                headers: { 
                    'Authorization': `Bearer ${NVIDIA_API_KEY}`, 
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );
        const raw = res.data.choices[0].message.content;
        return typeof raw === 'string' ? safeParseJSON(raw) : raw;
    } catch (err) {
        console.error(`  ❌ [NVIDIA] Status: ${err.response?.status}, Model: ${modelName || NVIDIA_MODEL}, Message: ${err.response?.data?.detail || err.response?.data?.error?.message || err.message}`);
        throw err;
    }
}

/** Google Gemini call with optional Grounding or specific Model override. */
export async function callGoogle(systemPrompt, userPrompt, useSearch = false, modelName = null) {
    const tools = useSearch ? [{ googleSearch: {} }] : [];
    const finalModel = modelName || (useSearch ? GROUNDING_MODEL : GOOGLE_MODEL);
    const model = genAI.getGenerativeModel({
        model: finalModel,
        systemInstruction: systemPrompt,
        tools: tools,
        generationConfig: {
            temperature: 0.1
        }
    });
    const result = await model.generateContent(userPrompt);
    const text = result.response.text();
    
    // Log for debugging
    if (process.env.DEBUG_AI === 'true') {
        console.log(`\n🤖 [AI Raw Response] (${useSearch ? 'Search' : 'Direct'}):\n${text.substring(0, 500)}...`);
    }

    try {
        return safeParseJSON(text);
    } catch (err) {
        // If it's a search result, sometimes it returns plain text if it failed to find anything.
        // We handle this at the caller level, but let's try a generic wrapper here.
        if (text.toLowerCase().includes('failed') || text.toLowerCase().includes('not found')) {
            return { model: 'FAILED', logic: text };
        }
        throw err;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
// ──────────────────────────────────────────────────────────────────────────────

const ALLOWED_CATEGORIES = Object.keys(TAXONOMY).join(', ');
const ALLOWED_SUB_CATEGORIES = Object.values(TAXONOMY).flatMap(cat => Object.keys(cat)).join(', ');

const IDENTIFY_SYSTEM = (brand, knownCategories = [], modelList = [], tier = 'mid-range') => `You are an expert Furniture Specialist for Boqify.
Your task is to identify furniture products from user descriptions for the brand "${brand}".

### 🏢 BRAND PROFILE:
- Brand Name: ${brand}
- Segment: ${tier.toUpperCase()} ${tier === 'budgetary' ? '(Prioritize simple, functional, value-driven models)' : '(Look for iconic, design-led, unique names)'}

${modelList.length > 0 ? `### 📦 KNOWN PRODUCT CATALOG:
The following models ARE available for this brand. You MUST prioritize matching to one of these if the description fits:
- ${modelList.slice(0, 500).join('\n- ')}` : ''}

### 🏷️ NATURAL TAXONOMY HINTS (Brand's Existing Categories):
${knownCategories.length > 0 ? `Prefer these categories if they match logically: ${knownCategories.join(', ')}` : 'No specific brand categories provided, use global taxonomy.'}

### 🌍 GLOBAL CATEGORY MAPPING:
If the brand categories above don't fit, you MUST map to one of these:
Main Categories: ${ALLOWED_CATEGORIES}
Sub-Categories: ${ALLOWED_SUB_CATEGORIES}

Return ONLY valid JSON:
{ 
  "brand": "${brand}", 
  "model": "Exact Model Name",
  "mainCategory": "Main Category",
  "subCategory": "Sub-Category",
  "logic": "Brief reasoning" 
} (Use the most descriptive name found on Architonic or official site)`;

export async function identifyModel(description, brand, provider = 'google', knownCategories = [], modelList = [], tier = 'mid-range', providerModel = null) {
    const system = IDENTIFY_SYSTEM(brand, knownCategories, modelList, tier);
    const user = `what is the best One "Model" for "${description}" from "${brand}"?`;

    if (process.env.DEBUG_AI === 'true') {
        console.log(`\n🤖 [AI Stage 1 Prompt] (Brand: ${brand}):\nSystem: ${system.substring(0, 200)}...\nUser: ${user}`);
    }

    try {
        // Attempt 1: Search Grounded Identification with the selected provider only
        let parsed;
        if (provider === 'google') {
            parsed = await callGoogle(system, user, true, providerModel || GOOGLE_MODEL);
        } else if (provider === 'nvidia') {
            parsed = await callNvidia(system, user, providerModel || NVIDIA_MODEL);
        } else {
            parsed = await callOpenRouter(system, user, providerModel || OPENROUTER_MODEL);
        }

        if (parsed && parsed.model && parsed.model !== 'FAILED') {
            return {
                status: 'success',
                brand: parsed.brand || brand,
                model: parsed.model,
                mainCategory: parsed.mainCategory || ''
            };
        }

        throw new Error('Provider did not return a valid model');
    } catch (err) {
        console.error(`  ❌ [AI Error] ${provider.toUpperCase()} identification failed for ${brand}:`, err.message);
        return { status: 'error', brand, model: '', category: '', error_message: err.message };
    }
}

/**
 * Verifies if an image URL is alive and accessible.
 * Optimized with 'Smart Trust' to prevent common Forbidden errors on known brand sites.
 */
async function verifyImageUrl(url, brand = '') {
    if (!url || url === 'FAILED' || !url.startsWith('http')) return false;

    // 1. Extension and Trusted Domain Fast-Path
    const isImageFile = /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url.split('?')[0]);
    const trustedDomains = ['narbutas.com', 'steelcase.com', 'hermanmiller.com', 'knoll.com', 'vitra.com', 'muuto.com', 'haworth.com'];
    const lowerUrl = url.toLowerCase();
    const isTrusted = trustedDomains.some(d => lowerUrl.includes(d)) || (brand && lowerUrl.includes(brand.toLowerCase()));

    try {
        const res = await axios.head(url, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });
        const contentType = res.headers['content-type'] || '';
        if (res.status >= 200 && res.status < 400 && contentType.startsWith('image/')) return true;
        
        // 2. HEAD blocked? Fallback to small GET
        const resGet = await axios.get(url, {
            timeout: 5000,
            range: 'bytes=0-1024',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        return resGet.status >= 200 && resGet.status < 400;
    } catch (err) {
        // 3. WAF / 403 Protection Bypass: If it's a known image link from a trusted domain, trust it.
        if (isImageFile && isTrusted) {
            console.log(`  ✅ [Stage 3.5] Smart Trust applied for: "${url.substring(0, 50)}..." (Domain/Ext Verified)`);
            return true;
        }
        return false;
    }
}

const FETCH_SYSTEM = (brand, model) => `You are a Furniture Detail Specialist for Boqify.
Your task is to find the official 'imageUrl' (direct high-resolution image file) and 'websiteUrl' for the product: "${brand} ${model}".

### 🔍 DISCOVERY PROTOCOL (Strict Order):
1. **Architonic**: This is the mandatory first source for European/Global furniture brands.
2. **Official Brand Website**: Use this for technical specifications and direct product links.
3. **Stylepark**: Use as a fallback for high-end design items.

### 🏷️ CATEGORY & DATA:
- Search for "Architonic ${brand} ${model}" to find the correct family and description.
- Ensure the 'imageUrl' is a direct link to the image file (jpg/png/webp), not a page.
- "mainCategory" and "subCategory" should align with our global taxonomy if possible: ${Object.keys(TAXONOMY).join(', ')}.

### 💰 PRICING:
Return the actual currency-converted price if found (USD/EUR). If not available, set price to 0.

Return ONLY valid JSON:
{
  "brand": "${brand}",
  "model": "${model}",
  "imageUrl": "Direct URL to high-res image file",
  "websiteUrl": "Link to direct model product page",
  "mainCategory": "Main Category",
  "subCategory": "Sub-Category",
  "family": "Collection/Series Name",
  "price": 0,
  "description": "Short technical description (max 20 words)",
  "logic": "Brief reasoning explaining why this is the best match from Architonic/Brand Site"
}
`;

export async function fetchProductDetails(brand, model, tier, provider = 'google', providerModel = null) {
    const system = FETCH_SYSTEM(brand, model);
    const user = `Perform a deep search for: ${brand} ${model}. Find its high-res image, official product page, and correct category on Architonic or ${brand} site.`;

    try {
        let parsed;
        if (provider === 'google') {
            parsed = await callGoogle(system, user, true, providerModel || GOOGLE_MODEL);
        } else if (provider === 'nvidia') {
            parsed = await callNvidia(system, user, providerModel || NVIDIA_MODEL);
        } else {
            parsed = await callOpenRouter(system, user, providerModel || OPENROUTER_MODEL);
        }

        if (!parsed || parsed === 'FAILED') {
            throw new Error(`${provider.toUpperCase()} did not return valid product details`);
        }

        // Stage 3.5: Image verification if the provider returned an image URL
        if (parsed.imageUrl && parsed.imageUrl !== 'FAILED') {
            const isAlive = await verifyImageUrl(parsed.imageUrl, brand);
            if (!isAlive) {
                console.warn(`  ⚠️  [Stage 3.5] Image verification failed for: "${parsed.imageUrl.substring(0, 50)}...".`);
                parsed.imageUrl = 'FAILED';
            }
        }

        // Final sanitation: Ensure we have at least partial data
        parsed.brand = parsed.brand || brand;
        parsed.model = parsed.model || model;
        parsed.price = parseFloat(parsed.price) || 0;
        return { status: 'success', product: parsed };
    } catch (err) {
        console.error(`  ❌ [Fetch Details Error] for ${brand} ${model} using ${provider.toUpperCase()}:`, err.message);
        return { status: 'error', error_message: err.message };
    }
}

/**
 * Comprehensive Enrichment: Deep search + Verification + Data Shaping.
 * This is the core logic for the "Always Strengthen DB" requirement.
 */
export async function searchAndEnrichModel(brandName, modelName, expectedTier = 'mid') {
    console.log(`\n💎 [Enrichment] Starting discovery for: ${brandName} "${modelName}" (Tier: ${expectedTier})`);

    try {
        const result = await fetchProductDetails(brandName, modelName, expectedTier);
        
        if (result.status === 'success' && result.product) {
            const p = result.product;
            
            // Normalize categories just in case AI deviated from protocol
            const mainCat = Object.keys(TAXONOMY).find(c => c.toLowerCase() === (p.mainCategory || '').toLowerCase()) || 'Furniture';
            const subCats = TAXONOMY[mainCat] ? Object.keys(TAXONOMY[mainCat]) : [];
            const subCat = subCats.find(s => s.toLowerCase() === (p.subCategory || '').toLowerCase()) || (subCats[0] || 'General');

            const enrichmentData = {
                id: `ai_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                brand: brandName,
                model: p.model || modelName,
                family: p.family || (p.model || modelName),
                description: p.description || `Official ${brandName} ${modelName} extracted via AI Discovery.`,
                imageUrl: p.imageUrl,
                websiteUrl: p.websiteUrl,
                mainCategory: mainCat,
                subCategory: subCat,
                price: parseFloat(p.price) || 0,
                currency: 'USD', // Default for now
                lastUpdated: new Date().toISOString(),
                source: 'AI-Enrichment'
            };

            console.log(`  ✅ [Enrichment] Success: Found ${enrichmentData.model} in ${mainCat} > ${subCat}`);
            return { status: 'success', product: enrichmentData };
        }
        
        return { status: 'error', error_message: result.error_message || 'Model details not found online.' };
    } catch (err) {
        console.error(`  ❌ [Enrichment Error]:`, err.message);
        return { status: 'error', error_message: err.message };
    }
}


export async function getAiMatch(description, brandTarget, tier, provider = 'google') {
    const system = `You are an FF&E Product Matcher.
Match: "${description}" to ${brandTarget}.

### 🚨 FORBIDDEN MATCHES:
- **ARMCHAIR** != STOOL (Match by height).
- **COFFEE TABLE** != MEETING TABLE (Match by size/height).
- **VISITOR CHAIR** != EXECUTIVE CHAIR (Match by function).
- **FLOORING** == TILES (Ignore suffix mismatches for Carpets/Vinyl if functional category matches).

Return JSON ONLY:
{ 
  "status": "success", 
  "product": {
    "brand": "Selected Brand",
    "model": "Exact Model Series",
    "description": "Short justification.",
    "price": 0
  }
}`;
    const user = `Match: ${description}\nBrands: ${brandTarget}\nTier: ${tier}`;
    try {
        return await callGoogle(system, user, false);
    } catch (err) {
        return { status: 'error', error_message: err.message };
    }
}

/** 
 * specialized function for rapid, highly-precise matching of fitout items from internal DB.
 * uses Gemini 2.0 Flash for high-speed lookup.
 */
export async function matchFitoutItem(description, internalProducts = [], tier = 'mid') {
    const system = `You are an Elite Fitout Estimator.
Match the description to ONE specific item from the internal database below.
If no exact match exists, pick the one with most similar function/material.

### INTERNAL DATABASE:
${JSON.stringify(internalProducts, null, 2)}

Return ONLY valid JSON:
{
  "status": "success",
  "product": {
    "brand": "FitOut V2",
    "model": "Model ID",
    "description": "Full item description",
    "price": 0,
    "mainCategory": "Category",
    "subCategory": "Sub-category",
    "matchScore": 0.0 to 1.0,
    "logic": "Functional match reason"
  }
}

### CRITICAL RULES:
- Ignore suffix mismatches like "Flooring" vs "Tiles" for Carpets/Vinyl. If the Material matches, it is a Match.
- Match by Material/Finish if exact model name differs slightly (e.g. Model v1 vs Model v2).`;

    const user = `Find best match for: "${description}" (Tier: ${tier})`;
    try {
        // Use gemini-2.5-flash for speed and efficiency as requested.
        return await callGoogle(system, user, false, 'gemini-2.5-flash');
    } catch (err) {
        console.error('  ❌ [Fitout Matcher] Error:', err.message);
        return { status: 'error', error_message: err.message };
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PLAN ANALYZER
// ──────────────────────────────────────────────────────────────────────────────

const PLAN_ANALYSIS_PROMPT = (includeFitout = false) => `You are an Elite Senior Quantity Surveyor (SQS). Your mission is to extract a high-precision BOQ from architectural drawings.

### 🎯 ACCURACY PROTOCOL - REJECT "LOT":
You are strictly FORBIDDEN from using units like "Lot", "LS", "Lumpsum", or "Package". Every item MUST have a measurable numerical quantity and unit.

### 📐 QUANTITY CALCULATION DIRECTIVES:
1. ** Nos (Count)**: Manually count every individual door, chair, desk, and lighting fixture.
2. ** SQM (Area)**: For Flooring, Ceiling, and Wall Finishes:
   - Search for room labels with area (e.g., "Office 01 - 15.5m2"). Use that number.
   - If missing, find the Scale Bar (e.g., 1:100) and estimate dimensions (Length x Width).
   - If no scale is found, use standard architectural dimensions (e.g., a standard office door is 0.9m, use this to calibrate the room size).
3. ** LM (Linear)**: For Partitions, Skirting, and Cabinets, calculate the total length of the lines drawn.
4. If a description mentions a group of items (e.g., '6 workstations'), set quantity to 6.
5. CATEGORY MAPPING: You MUST map every item to one of these valid Main Categories: ${ALLOWED_CATEGORIES}.
6. SEPARATION OF CONCERNS:
   - FURNITURE: Includes chairs, desks, tables, storage, pods, and mobile accessories.
   - FITOUT: Includes architectural elements like 'Partition Wall', 'Tile Flooring', 'Gypsum Ceiling', 'Curtain Wall', 'Carpeting', 'Wall Cladding', or any fixed MEP/HVAC elements. 
   - IMPORTANT: If an item is an architectural element (Fixed Partition, Flooring, Ceiling), it belongs to FITOUT.

Return ONLY the JSON. No conversational text.

### 📦 OUTPUT FORMAT:
Return ONLY a valid JSON object:
{
  "items": [
    { 
      "location": "Room Name/Zone", 
      "scope": "Fitout (Architectural)" | "Fitout (MEP)" | "Fitout (Joinery)" | "Fitout (AV)" | "Fitout (Lighting)" | "Furniture", 
      "code": "e.g., CH-01",
      "description": "Specific naming (e.g., Ergonomic Task Chair, Carpet Type A)", 
      "qty": 12.5, 
      "unit": "Nos" | "SQM" | "LM" 
    }
  ],
  "planSummary": "Extraction of $TOTAL_ITEMS items completed."
}
`;

const cleanQty = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 1;
    const s = String(val).toLowerCase().trim();
    const words = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10 };
    if (words[s]) return words[s];
    const match = s.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 1;
};

/**
 * Call OpenAI-compatible API (OpenRouter/NVIDIA) with vision support.
 */
async function callVisionAPI(systemPrompt, userPrompt, imageBase64, imageMimeType, modelName, apiEndpoint, apiKey) {
    try {
        const res = await axios.post(
            apiEndpoint,
            {
                model: modelName,
                messages: [
                    { role: 'system', content: systemPrompt },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: userPrompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${imageMimeType};base64,${imageBase64}`
                                }
                            }
                        ]
                    }
                ],
                temperature: 0.1,
                max_tokens: 16384,
                response_format: { type: 'json_object' }
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 120000
            }
        );
        const raw = res.data.choices[0].message.content;
        return typeof raw === 'string' ? safeParseJSON(raw) : raw;
    } catch (err) {
        console.error(`  ❌ [Vision API Error] Model: ${modelName}, Status: ${err.response?.status}, Message: ${err.response?.data?.error?.message || err.message}`);
        throw new Error(`${modelName} failed: ${err.response?.data?.error?.message || err.message}`);
    }
}

/**
 * Perform AI analysis on floor plan drawing(s).
 * @param {Array} filesData - Array of objects { base64Data, mimeType, originalname }
 */
export async function analyzePlan(filesData, options = {}) {
    const { includeFitout = false, provider = 'google', providerModel = null } = options;
    console.log(`\n🏗️ [Plan Analyzer] Analyzing ${filesData.length} sheets with provider=${provider}, model=${providerModel || ''}...`);

    if (!filesData || filesData.length === 0) {
        return { status: 'error', error_message: 'No files provided for analysis' };
    }

    const selectedModel = providerModel || (provider === 'google' ? GOOGLE_MODEL : provider === 'openrouter' ? OPENROUTER_MODEL : NVIDIA_MODEL);
    if (!isValidProviderModel(provider, selectedModel)) {
        const invalidMsg = `Invalid model for provider ${provider}: ${selectedModel}. Please choose a supported model.`;
        console.error(`  ❌ [Plan Analyzer Validation] ${invalidMsg}`);
        return {
            status: 'error',
            error_message: invalidMsg,
            provider,
            model: selectedModel
        };
    }

    try {
        const promptText = PLAN_ANALYSIS_PROMPT(includeFitout);
        const file = filesData[0];

        let parsed;

        if (provider === 'google') {
            // Use Google Gemini SDK with multimodal support
            const modelName = providerModel || GOOGLE_MODEL;
            console.log(`  📍 Using Google model: ${modelName}`);
            
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: { temperature: 0.1, maxOutputTokens: 16384 }
            });

            const promptParts = [
                { text: promptText },
                ...filesData.map(f => ({
                    inlineData: { data: f.base64Data, mimeType: f.mimeType }
                }))
            ];

            const result = await model.generateContent({ contents: [{ role: 'user', parts: promptParts }] });
            parsed = safeParseJSON(result.response.text());

        } else if (provider === 'openrouter') {
            // Use OpenRouter API with multimodal support
            const modelName = providerModel || OPENROUTER_MODEL;
            console.log(`  📍 Using OpenRouter model: ${modelName}`);
            
            parsed = await callVisionAPI(
                promptText,
                'Analyze this floor plan PDF and extract BOQ items as JSON',
                file.base64Data,
                file.mimeType,
                modelName,
                'https://openrouter.ai/api/v1/chat/completions',
                OPENROUTER_API_KEY
            );

        } else if (provider === 'nvidia') {
            // Use NVIDIA NIM API with multimodal support
            const modelName = providerModel || NVIDIA_MODEL;
            console.log(`  📍 Using NVIDIA model: ${modelName}`);
            
            parsed = await callVisionAPI(
                promptText,
                'Analyze this floor plan PDF and extract BOQ items as JSON',
                file.base64Data,
                file.mimeType,
                modelName,
                'https://integrate.api.nvidia.com/v1/chat/completions',
                NVIDIA_API_KEY
            );

        } else {
            throw new Error(`Unknown provider: ${provider}. Supported: google, openrouter, nvidia`);
        }

        // Process extracted items
        let flatItems = [];
        if (parsed.items && Array.isArray(parsed.items)) {
            flatItems = parsed.items.map(item => ({
                location: String(item.location || 'General Area').trim(),
                scope: String(item.scope || (includeFitout ? 'Fitout' : 'Furniture')).trim(),
                code: item.code ? String(item.code).trim() : '',
                description: String(item.description).trim(),
                qty: cleanQty(item.qty),
                unit: String(item.unit || 'Nos').trim()
            }));
        }

        return {
            status: 'success',
            planSummary: parsed.planSummary || `Extracted ${flatItems.length} items.`,
            items: flatItems,
            provider: provider,
            model: providerModel || (provider === 'google' ? GOOGLE_MODEL : provider === 'openrouter' ? OPENROUTER_MODEL : NVIDIA_MODEL)
        };

    } catch (err) {
        const errorMsg = err.message || 'Unknown error during plan analysis';
        console.error(`  ❌ [Plan Analyzer Error]:`, errorMsg);
        return {
            status: 'error',
            error_message: `Failed to analyze plan with ${provider}${providerModel ? ` (${providerModel})` : ''}: ${errorMsg}. Please try another provider/model.`,
            provider: provider,
            model: providerModel
        };
    }
}
