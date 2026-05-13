import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from 'axios';
import 'dotenv/config';
import { TAXONOMY } from './normalizer.js';

// ──────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────────────────────────────────────
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const GOOGLE_FREE_KEY = process.env.GOOGLE_FREE_KEY || process.env.GEMINI_FREE_KEY || process.env.GEMINI_API_KEY_FREE;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const FORCE_FREE_GOOGLE = process.env.FORCE_FREE_GOOGLE_KEY === 'true';

// Global Model Defaults (from .env)
export const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemma-4-31b-it';
export const GROUNDING_MODEL = process.env.GOOGLE_MODEL || 'gemma-4-31b-it';
export const VISION_MODEL = process.env.GOOGLE_VISION_MODEL || 'gemini-2.0-flash';
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free';
export const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'nvidia/llama-3.1-8b-instruct';

const MODEL_MAPPING = {
    // We map generic names to their most stable GA versions
    'gemini-pro': 'gemini-1.5-pro-latest',
    'gemini-flash': 'gemini-1.5-flash-latest',
    'gemini-2-pro': 'gemini-2.0-pro-exp-02-05',
    'gemini-2-flash': 'gemini-2.0-flash',
};

export const FREE_GOOGLE_MODELS = [
    // Tier 1: Development
    'gemma-4-31b-it',
    'gemma-4-26b-a4b-it',
    'gemma-4-e4b-it',
    'gemma-4-e2b-it',
    'gemma-4-9b-it',
    'gemma-4-2b-it',
    'gemma-2-27b-it',
    'gemma-2-9b-it',
    'gemma-2-2b-it',
    // Tier 2: Standard (Flash)
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-2.0-flash-lite-preview-02-05'
];

export const PAID_GOOGLE_MODELS = [
    // Tier 3: Pro / Premium
    'gemini-1.5-pro',
    'gemini-2.0-pro-exp-02-05',
    'gemini-2.0-flash-thinking-exp-01-21',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-exp-1206',
    'imagen-3.0-generate-001'
];

export const VALID_GOOGLE_MODELS = [...FREE_GOOGLE_MODELS, ...PAID_GOOGLE_MODELS];

const maskKey = (key) => {
    if (!key) return 'MISSING';
    if (key.length <= 8) return '********';
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
};

/** 
 * Resolver for Google AI Models
 * Ensures that if a model is Paid/Pro, it uses the Billed key.
 */
export function getGoogleAI(modelName) {
    let normalizedModel = (modelName || '').toLowerCase().trim();
    let forceBilled = false;

    // Support explicit billing override via suffix (e.g. "gemini-3-flash-preview:billed")
    if (normalizedModel.endsWith(':billed')) {
        forceBilled = true;
        normalizedModel = normalizedModel.replace(':billed', '').trim();
    }

    // 1. Force Free Key if environment override is active
    if (FORCE_FREE_GOOGLE) {
        console.log(`  ⚠️ [LLM Utils] OVERRIDE: Forcing FREE Key for "${normalizedModel}" via FORCE_FREE_GOOGLE_KEY=true.`);
        return new GoogleGenerativeAI(GOOGLE_FREE_KEY);
    }

    // 2. Identify if model belongs to Free Tier
    const isFreeModel = FREE_GOOGLE_MODELS.some(m => normalizedModel.includes(m.toLowerCase()));

    if (isFreeModel && !forceBilled) {
        if (!GOOGLE_FREE_KEY) throw new Error(`Model "${normalizedModel}" is a Free Tier model but GOOGLE_FREE_KEY is missing.`);
        console.log(`  💎 [LLM Utils] Free Tier model detected: Using FREE Key (${maskKey(GOOGLE_FREE_KEY)}) for "${normalizedModel}".`);
        return new GoogleGenerativeAI(GOOGLE_FREE_KEY);
    } else {
        // 3. Paid/Pro Models (Requires Billing)
        if (!GOOGLE_API_KEY) throw new Error(`Model "${normalizedModel}" requires a Google Billed Key (GOOGLE_API_KEY) which is missing in .env.`);
        console.log(`  💰 [LLM Utils] Billed Tier ${forceBilled ? '(FORCED) ' : ''}detected: Using Billed Key (${maskKey(GOOGLE_API_KEY)}) for "${normalizedModel}".`);
        return new GoogleGenerativeAI(GOOGLE_API_KEY);
    }
}

// Model ids
// Default to gemma-4-31b-it if .env is missing or has a typo
export const VALID_OPENROUTER_MODELS = [
    'google/gemini-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
    'google/gemini-2.5-flash-lite-001',
    'anthropic/claude-sonnet-4-20250514',
    'openai/gpt-4o'
];
export const VALID_NVIDIA_MODELS = [
    'nvidia/llama-3.1-405b-instruct',
    'nvidia/llama-3.1-70b-instruct',
    'nvidia/llama-3.1-8b-instruct',
    'nvidia/nemotron-70b-instruct'
];
export const VALID_LOCAL_MODELS = [
    'local/yolov8-llama3.2'
];

export const LOCAL_MODEL = 'local/yolov8-llama3.2';
export const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001';

// Deprecated: use getGoogleAI(modelName) instead
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

export const getProviderForModel = (modelName) => {
    if (!modelName) return 'google';
    if (modelName.startsWith('nvidia/')) return 'nvidia';
    if (modelName.startsWith('local/')) return 'local';

    // If it has a slash and isn't nvidia/local, it's likely OpenRouter (e.g. google/gemini-2.0-flash-lite-001)
    if (modelName.includes('/')) return 'openrouter';
    return 'google';
};

const isValidProviderModel = (provider, model) => {
    if (!model) return false;
    if (provider === 'local') return true;
    if (provider === 'google') return VALID_GOOGLE_MODELS.includes(model) || !model.includes('/');
    if (provider === 'openrouter') return VALID_OPENROUTER_MODELS.includes(model) || model.includes('/');
    if (provider === 'nvidia') return VALID_NVIDIA_MODELS.includes(model);
    return false;
};

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────

/** Strip markdown fences, then parse JSON with surgical precision. */
export function safeParseJSON(text) {
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

    // If we have specific JSON anchors, prioritize them. Else use first '{'.
    const firstBraceIdx = text.indexOf('{');
    const finalStartIdx = (startIdx !== -1) ? startIdx : firstBraceIdx;

    if (finalStartIdx !== -1 && lastBraceIdx !== -1 && lastBraceIdx > finalStartIdx) {
        cleaned = text.substring(finalStartIdx, lastBraceIdx + 1);
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
            else if (char === '}') { if (stack[stack.length - 1] === '}') stack.pop(); }
            else if (char === ']') { if (stack[stack.length - 1] === ']') stack.pop(); }
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
    
    // Resolve model name: passed param > env.GOOGLE_MODEL > default fallback
    const rawModelName = modelName || GOOGLE_MODEL || 'gemma-4-31b-it';
    const cleanModelName = rawModelName.replace(':billed', '').trim();
    const finalModel = MODEL_MAPPING[cleanModelName] || cleanModelName;

    const genAIInstance = getGoogleAI(rawModelName);
    const model = genAIInstance.getGenerativeModel({
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

const IDENTIFY_SYSTEM = (brand, knownCategories = [], modelList = [], tier = 'mid-range', brandCategoryRules = null) => {
    let strictCategoryRule = '';

    // Inject the VE Strict Airlock if categorized mode is active
    if (brandCategoryRules && typeof brandCategoryRules === 'object') {
        const assignedCategory = Object.keys(brandCategoryRules).find(key => brandCategoryRules[key] === brand);
        if (assignedCategory) {
            strictCategoryRule = `
### 🚨 STRICT CATEGORY ISOLATION:
You are scoped to the "${assignedCategory}" category ONLY. 
- You MUST NOT suggest items outside this functional category.
- If the item description implies a different functional category, return 'FAILED' for the model.
- CRITICAL: Ensure the "mainCategory" returned is exactly "${assignedCategory}" or a taxonomical parent.
`;
        }
    }

    return `You are an expert Furniture Specialist for Boqify.
Your task is to identify the EXACT product model from the brand "${brand}" that best matches the provided description.
${strictCategoryRule}
### 🏢 BRAND PROFILE:
- Brand Name: ${brand}
- Segment: ${tier.toUpperCase()} ${tier === 'budgetary' ? '(Prioritize simple, functional, value-driven models)' : '(Look for iconic, design-led, unique names)'}

${modelList.length > 0 ? `### 📦 KNOWN PRODUCT CATALOG:
The following models ARE available for this brand. You MUST prioritize matching to one of these if the description fits:
- ${modelList.slice(0, 500).join('\n- ')}` : ''}

### 🏷️ NATURAL TAXONOMY HINTS (Brand's Existing Categories):
${knownCategories.length > 0 ? `Prefer these categories if they match logically: ${knownCategories.join(', ')}` : 'No specific brand categories provided, use global taxonomy.'}

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
};

export async function identifyModel(description, brand, provider = 'google', knownCategories = [], modelList = [], tier = 'mid-range', providerModel = null, brandCategoryRules = null) {
    return withRetry(async () => {
        // Pass brandCategoryRules down to the prompt builder
        const system = IDENTIFY_SYSTEM(brand, knownCategories, modelList, tier, brandCategoryRules);
        const user = `What is the best matching model for: "${description}" from "${brand}"?`;

        if (process.env.DEBUG_AI === 'true') {
            console.log(`\n🤖 [AI Identify] (Brand: ${brand}): Matching "${description.substring(0, 50)}..."`);
        }

        let parsed;
        if (provider === 'google') {
            parsed = await callGoogle(system, user, true, providerModel || GROUNDING_MODEL);
        } else if (provider === 'nvidia') {
            parsed = await callNvidia(system, user, providerModel || NVIDIA_MODEL);
        } else if (provider === 'local') {
            console.log(`  📍 Using Local LLM (Llama 3.2) for identification...`);
            const responseText = await callLocalLLM(system, user, 'llama3.2');
            parsed = safeParseJSON(responseText);
        } else {
            parsed = await callOpenRouter(system, user, providerModel || OPENROUTER_MODEL);
        }

        if (parsed && parsed.model && parsed.model !== 'FAILED') {
            return {
                status: 'success',
                brand: parsed.brand || brand,
                model: parsed.model,
                mainCategory: parsed.mainCategory || '',
                subCategory: parsed.subCategory || '',
                logic: parsed.logic || ''
            };
        }

        throw new Error('AI failed to identify a valid model');
    }, 3, 2000).catch(err => {
        console.error(`  ❌ [AI Identify Error] ${provider.toUpperCase()} failed for ${brand}:`, err.message);
        return { status: 'error', brand, model: '', category: '', error_message: err.message };
    });
}

// ── SWARM AGENT PROMPTS (New) ────────────────────────────────────────────────

const AUTO_MATCH_ROUTER_SYSTEM = (brand) => `You are a high-speed FF&E routing agent for the brand "${brand}".
Your task is to categorize the provided item descriptions into functional groups to optimize downstream AI matching.
CRITICAL: Output ONLY valid JSON exactly matching this structure, with no markdown:
{
  "desking": ["id1", "id3"],
  "seating": ["id2"],
  "softSeating": [],
  "storage": [],
  "accessories": []
}`;

const AUTO_MATCH_AGENT_SYSTEM = (brand, category, knownCategories = [], modelList = [], tier = 'mid-range') => `You are an expert Furniture Specialist specialized in "${category}" for the brand "${brand}".
Your task is to identify the EXACT product model from the brand "${brand}" for a LIST of item descriptions.

### 🏢 BRAND PROFILE:
- Brand Name: ${brand}
- Segment: ${tier.toUpperCase()}

${modelList.length > 0 ? `### 📦 KNOWN PRODUCT CATALOG:
The following models ARE available for this brand. You MUST prioritize matching to one of these if the description fits:
- ${modelList.slice(0, 500).join('\n- ')}` : ''}

### 🌍 GLOBAL CATEGORY MAPPING:
You MUST map each item to:
- Main Category: ${ALLOWED_CATEGORIES}
- Sub-Category: ${ALLOWED_SUB_CATEGORIES}

### 📝 INSTRUCTIONS:
1. For each provided item description, find the best matching model from "${brand}".
2. Use the product catalog hints if available.
3. If no exact model matches, suggest the closest equivalent from the brand's style.
4. Return a "logic" for why this model was chosen.

Return ONLY valid JSON matching this structure:
{
  "matches": [
    {
      "id": "original_item_id",
      "model": "Exact Model Name",
      "mainCategory": "Main Category",
      "subCategory": "Sub-Category",
      "logic": "Brief reasoning"
    }
  ]
}`;


/**
 * Swarm-based Single Brand Matching.
 * Integrates the "swarm concept" from veMatchUtils for parallel agent execution.
 * 1. Routes items into functional categories using a Router Agent.
 * 2. Launches specialized Matching Agents for each category in parallel.
 * 3. Each agent processes its scope simultaneously for maximum speed.
 */
export async function autoMatchSingleBrand(items, brand, options = {}) {
    const { tier = 'mid', provider = 'google', providerModel = null, modelList = [], knownCategories = [] } = options;

    return withRetry(async () => {
        // Phase 1: Routing Agent
        const routerSystem = AUTO_MATCH_ROUTER_SYSTEM(brand);
        const routerUser = `Route these items for the brand "${brand}":\n${items.map(it => `- ID: ${it.id} | Desc: ${it.description}`).join('\n')}`;

        console.log(`  🌐 [Swarm Router] Categorizing ${items.length} items for "${brand}"...`);
        const categoryMap = await callGoogle(routerSystem, routerUser, false, providerModel || GROUNDING_MODEL);

        if (!categoryMap || typeof categoryMap !== 'object') throw new Error("Swarm Router returned invalid response");

        // Phase 2: Parallel Category Agents (Swarm)
        const categories = Object.keys(categoryMap).filter(cat =>
            Array.isArray(categoryMap[cat]) && categoryMap[cat].length > 0
        );

        console.log(`  🐝 [Swarm Execution] Launching agents for categories: ${categories.join(', ')}`);

        // Batch size for optimal accuracy (approx 8 items per LLM call)
        const BATCH_SIZE = 8;

        const swarmPromises = categories.map(async (category) => {
            const itemIdsInScope = categoryMap[category];
            const agentSystem = AUTO_MATCH_AGENT_SYSTEM(brand, category, knownCategories, modelList, tier);

            console.log(`  🤖 [Agent:${category}] Processing ${itemIdsInScope.length} items in parallel batches...`);

            const batches = [];
            for (let i = 0; i < itemIdsInScope.length; i += BATCH_SIZE) {
                batches.push(itemIdsInScope.slice(i, i + BATCH_SIZE));
            }

            const batchPromises = batches.map(async (batchIds) => {
                const batchItems = batchIds.map(id => items.find(it => it.id === id)).filter(Boolean);
                if (batchItems.length === 0) return [];

                const user = `Identify the EXACT models from "${brand}" for these items within the "${category}" category:
${batchItems.map(it => `- ID: ${it.id} | Description: ${it.description}`).join('\n')}`;

                try {
                    const parsed = await callGoogle(agentSystem, user, true, providerModel || GROUNDING_MODEL);

                    const matches = (parsed.matches || []).map(m => ({
                        id: m.id,
                        status: 'success',
                        brand,
                        model: m.model,
                        mainCategory: m.mainCategory,
                        subCategory: m.subCategory,
                        logic: m.logic
                    }));
                    return matches;
                } catch (err) {
                    console.error(`  ❌ [Agent:${category}] Batch failed:`, err.message);
                    return batchIds.map(id => ({ id, status: 'error', error_message: err.message }));
                }
            });

            const results = await Promise.all(batchPromises);
            return results.flat();
        });

        const allSwarmResults = (await Promise.all(swarmPromises)).flat().filter(Boolean);

        // Phase 3: Cleanup for items that weren't routed
        const matchedIds = new Set(allSwarmResults.map(r => r.id));
        const missingItems = items.filter(it => !matchedIds.has(it.id));

        if (missingItems.length > 0) {
            console.log(`  ⚠️ [Swarm Cleanup] Processing ${missingItems.length} unrouted/failed items...`);
            const cleanupResults = await Promise.all(missingItems.map(async (item) => {
                try {
                    const res = await identifyModel(item.description, brand, provider, knownCategories, modelList, tier, providerModel);
                    return { ...res, id: item.id };
                } catch (err) {
                    return { id: item.id, status: 'error', error_message: err.message };
                }
            }));
            allSwarmResults.push(...cleanupResults);
        }

        console.log(`  ✅ [Swarm Complete] Matched ${allSwarmResults.filter(r => r.status === 'success').length}/${items.length} items.`);

        return {
            status: 'success',
            brand,
            matches: allSwarmResults
        };
    }, 2, 1000).catch(err => {
        console.error(`  ❌ [Swarm Error] Critical failure:`, err.message);
        return { status: 'error', error_message: err.message, matches: [] };
    });
}

/**
 * Swarm-based Multi-Brand Matching.
 * 1. Routes items into functional categories.
 * 2. Specialized agents select the best brand/model per category.
 */
export async function autoMatchMultiBrand(items, availableBrands, options = {}) {
    const { tier = 'mid', provider = 'google', providerModel = null } = options;

    return withRetry(async () => {
        // Phase 1: Routing Agent
        const routerSystem = AUTO_MATCH_MULTI_ROUTER_SYSTEM(availableBrands);
        const routerUser = `Route these items for the available brands [${availableBrands.join(', ')}]:\n${items.map(it => `- ID: ${it.id} | Desc: ${it.description}`).join('\n')}`;

        console.log(`  🌐 [Multi-Swarm Router] Categorizing ${items.length} items for ${availableBrands.length} brands...`);
        const categoryMap = await callGoogle(routerSystem, routerUser, false, providerModel || GROUNDING_MODEL);

        if (!categoryMap || typeof categoryMap !== 'object') throw new Error("Multi-Swarm Router returned invalid response");

        // Phase 2: Parallel Category Agents
        const categories = Object.keys(categoryMap).filter(cat =>
            Array.isArray(categoryMap[cat]) && categoryMap[cat].length > 0
        );

        console.log(`  🐝 [Multi-Swarm Execution] Launching agents for categories: ${categories.join(', ')}`);

        const BATCH_SIZE = 8;

        const swarmPromises = categories.map(async (category) => {
            const itemIdsInScope = categoryMap[category];
            const agentSystem = AUTO_MATCH_MULTI_AGENT_SYSTEM(availableBrands, category, tier);

            const batches = [];
            for (let i = 0; i < itemIdsInScope.length; i += BATCH_SIZE) {
                batches.push(itemIdsInScope.slice(i, i + BATCH_SIZE));
            }

            const batchPromises = batches.map(async (batchIds) => {
                const batchItems = batchIds.map(id => items.find(it => it.id === id)).filter(Boolean);
                if (batchItems.length === 0) return [];

                const user = `Find the best Brand and Model from the available list for these items in "${category}":
${batchItems.map(it => `- ID: ${it.id} | Description: ${it.description}`).join('\n')}`;

                try {
                    const parsed = await callGoogle(agentSystem, user, true, providerModel || GROUNDING_MODEL);

                    return (parsed.matches || []).map(m => ({
                        id: m.id,
                        status: 'success',
                        brand: m.brand,
                        model: m.model,
                        mainCategory: m.mainCategory,
                        subCategory: m.subCategory,
                        logic: m.logic
                    }));
                } catch (err) {
                    console.error(`  ❌ [Multi-Agent:${category}] Batch failed:`, err.message);
                    return batchIds.map(id => ({ id, status: 'error', error_message: err.message }));
                }
            });

            const results = await Promise.all(batchPromises);
            return results.flat();
        });

        const allSwarmResults = (await Promise.all(swarmPromises)).flat().filter(Boolean);

        // Phase 3: Cleanup
        const matchedIds = new Set(allSwarmResults.map(r => r.id));
        const missingItems = items.filter(it => !matchedIds.has(it.id));

        if (missingItems.length > 0) {
            console.log(`  ⚠️ [Multi-Swarm Cleanup] Processing ${missingItems.length} unrouted items...`);
            const cleanupResults = await Promise.all(missingItems.map(async (item) => {
                try {
                    const res = await identifyModel(item.description, availableBrands[0], provider, [], [], tier, providerModel);
                    return { ...res, id: item.id };
                } catch (err) {
                    return { id: item.id, status: 'error', error_message: err.message };
                }
            }));
            allSwarmResults.push(...cleanupResults);
        }

        return { status: 'success', matches: allSwarmResults };
    }, 2, 1000).catch(err => {
        console.error(`  ❌ [Multi-Swarm Error] Critical failure:`, err.message);
        return { status: 'error', error_message: err.message, matches: [] };
    });
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
1. **Architonic**: Mandatory first source for European/Global furniture brands.
2. **Official Brand Website**: Use for technical specifications and direct product links.
3. **Stylepark**: Fallback for high-end design items.

### 🏷️ CATEGORY & DATA:
- Search for "Architonic ${brand} ${model}" to find the correct family and description.
- Ensure the 'imageUrl' is a direct link to the image file (jpg/png/webp).
- "mainCategory" and "subCategory" MUST align with our global taxonomy: ${ALLOWED_CATEGORIES}.

### 💰 PRICING:
Return the actual currency-converted price if found (USD/EUR), else set price to 0.

Return ONLY valid JSON:
{
  "status": "success",
  "brand": "${brand}",
  "model": "${model}",
  "imageUrl": "Direct URL to high-res image file",
  "websiteUrl": "Link to direct model product page",
  "mainCategory": "Main Category",
  "subCategory": "Sub-Category",
  "family": "Collection/Series Name",
  "price": 0,
  "description": "Short technical description (max 20 words)",
  "logic": "Brief reasoning"
}
`;

export async function fetchProductDetails(brand, model, tier, provider = 'google', providerModel = null) {
    return withRetry(async () => {
        const system = FETCH_SYSTEM(brand, model);
        const user = `Perform a deep search for: ${brand} ${model}. Find its high-res image, official product page, and correct category.`;

        console.log(`  🌐 [AI Fetch] Fetching details for: ${brand} ${model} using ${provider}`);

        let parsed;
        if (provider === 'google') {
            parsed = await callGoogle(system, user, true, providerModel || GROUNDING_MODEL);
        } else if (provider === 'nvidia') {
            parsed = await callNvidia(system, user, providerModel || NVIDIA_MODEL);
        } else {
            parsed = await callOpenRouter(system, user, providerModel || OPENROUTER_MODEL);
        }

        if (!parsed || parsed === 'FAILED' || parsed.status === 'error') {
            throw new Error(`${provider.toUpperCase()} did not return valid product details`);
        }

        // Stage 3.5: Image verification
        if (parsed.imageUrl && parsed.imageUrl !== 'FAILED') {
            const isAlive = await verifyImageUrl(parsed.imageUrl, brand);
            if (!isAlive) {
                console.warn(`  ⚠️  [Stage 3.5] Image verification failed for: "${parsed.imageUrl.substring(0, 50)}...".`);
                parsed.imageUrl = 'FAILED';
            }
        }

        parsed.brand = parsed.brand || brand;
        parsed.model = parsed.model || model;
        parsed.price = parseFloat(parsed.price) || 0;
        return { status: 'success', product: parsed };
    }, 3, 2000).catch(err => {
        console.error(`  ❌ [Fetch Details Error] for ${brand} ${model} using ${provider.toUpperCase()}:`, err.message);
        return { status: 'error', error_message: err.message };
    });
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


export async function getAiMatch(description, brandTarget, tier, provider = 'google', providerModel = null) {
    return withRetry(async () => {
        const system = `You are an expert FF&E Product Matcher.
Match: "${description}" to the brand "${brandTarget}".

### 🏢 TARGET BRAND: ${brandTarget}
### 📊 TIER: ${tier}

### 🚨 FORBIDDEN MATCHES:
- **ARMCHAIR** != STOOL (Match by height).
- **COFFEE TABLE** != MEETING TABLE (Match by size/height).
- **VISITOR CHAIR** != EXECUTIVE CHAIR (Match by function).
- **FLOORING** == TILES (Ignore suffix mismatches for Carpets/Vinyl if functional category matches).

Return ONLY valid JSON:
{ 
  "status": "success", 
  "product": {
    "brand": "${brandTarget}",
    "model": "Exact Model Series",
    "description": "Short justification.",
    "price": 0,
    "logic": "Brief reasoning"
  }
}`;
        const user = `Match description: "${description}"\nBrand: ${brandTarget}\nTier: ${tier}`;

        console.log(`  🤖 [AI Match] Matching "${description.substring(0, 50)}..." to ${brandTarget}`);

        let result;
        if (provider === 'google') {
            result = await callGoogle(system, user, false, providerModel || GROUNDING_MODEL);
        } else if (provider === 'local') {
            const responseText = await callLocalLLM(system, user, 'llama3.2');
            result = safeParseJSON(responseText);
        } else if (provider === 'nvidia') {
            result = await callNvidia(system, user, providerModel || NVIDIA_MODEL);
        } else if (provider === 'openrouter') {
            result = await callOpenRouter(system, user, providerModel || OPENROUTER_MODEL);
        } else {
            result = await callGoogle(system, user, false, providerModel || GROUNDING_MODEL);
        }

        if (!result || result.status === 'error' || !result.product) {
            throw new Error('AI failed to match product');
        }

        return result;
    }, 3, 2000).catch(err => {
        console.error(`  ❌ [AI Match Error] Failed for ${brandTarget}:`, err.message);
        return { status: 'error', error_message: err.message };
    });
}

/** 
 * specialized function for rapid, highly-precise matching of fitout items from internal DB.
 * uses the selected AI model for high-speed lookup.
 */
export async function matchFitoutItem(description, internalProducts = [], tier = 'mid', provider = 'google', providerModel = 'gemma-4-31b-it') {
    return withRetry(async () => {
        const system = `You are an Elite Fitout Estimator.
Match the description to ONE specific item from the internal database below.
If no exact match exists, pick the one with most similar function/material (e.g. "Commercial Grade Flooring" -> "Flooring - Stone" or "Flooring - Wood").

### INTERNAL DATABASE:
${JSON.stringify(internalProducts, null, 2)}

Return ONLY valid JSON:
{
  "status": "success" | "no_match",
  "product": {
    "brand": "FitOut V2",
    "model": "EXACT Model Name from matched item",
    "description": "EXACT Description from matched item",
    "price": 0,
    "mainCategory": "EXACT mainCategory from matched item",
    "subCategory": "EXACT subCategory from matched item",
    "family": "EXACT family from matched item",
    "unit": "EXACT unit from matched item",
    "matchScore": 0.0,
    "logic": "Brief explanation"
  }
}

### CRITICAL RULES:
- **No Match Protocol**: If NO reasonable match exists even as a functional substitute, return \`{"status": "no_match", "logic": "Reason why no match was found"}\`.
- **Dimension Normalization**: Treat "600x600", "600*600", "60x60cm", and "0.6x0.6m" as identical.
- If the item is generic (e.g. "Carpeting", "Flooring"), match it to the most professional entry in the database.
- **For Partitions**: Distinguish between "Glass" (Full height glass, toughened) and "Solid/Drywall" (Gypsum, Drywall, Masonry).
- **For Ceilings**: Map "Ceiling Finish" or "False Ceiling" to specific types: "Gypsum" (plasterboard), "Acoustic" (grid/mineral fiber), or "Open Cell" (baffles/metal).
- **For Joinery**: Descriptions mentioning "Cabinets", "Wardrobes", "Pantry", "Counter", or "Shelving" MUST map to the "Joinery" or "Pantry & Cabinetry" categories.
- **For Carpet**: Descriptions including "Carpet", "Flooring Carpet", "Floor Finish (Carpet)", or similar MUST map to items in the "Carpet Tiles" sub-category.
- **For Floor Finish**: Map "Main Floor Finish" or "Flooring" to specific materials if mentioned (Stone, Wood, etc.). If "Carpet/Tile" or "Carpet" is mentioned, prioritize "Carpet Tiles".
- **Dimension Priority**: If dimensions (e.g. "600x600", "1200x600") are present, prioritize items with matching dimensions.
- Ignore suffix mismatches like "Flooring" vs "Tiles" for Carpets/Vinyl. If the main Material matches, it is a Match.
- Match by Material/Finish if exact model name differs slightly (e.g. Model v1 vs Model v2).
- **Match Score**: Assign a "matchScore" (0.0 to 1.0). 1.0 = Perfect match, 0.7 = Functional match, 0.4 = Weak fallback.
- Ensure the Price is realistic for the tier provided.`;

        const user = `Find best match for: "${description}" (Tier: ${tier})`;

        console.log(`  🛠️ [Fitout Match] Matching "${description.substring(0, 50)}..."`);

        let result;
        if (provider === 'google') {
            result = await callGoogle(system, user, false, providerModel);
        } else if (provider === 'openrouter') {
            result = await callOpenRouter(system, user, providerModel);
        } else if (provider === 'nvidia') {
            result = await callNvidia(system, user, providerModel);
        } else if (provider === 'local') {
            const responseText = await callLocalLLM(system, user, 'llama3.2');
            result = safeParseJSON(responseText);
        } else {
            result = await callGoogle(system, user, false, 'gemma-4-31b-it');
        }

        if (!result || result.status === 'error') {
            throw new Error('AI failed to communicate with matching engine');
        }

        if (result.status === 'no_match') {
            return { status: 'no_match', logic: result.logic || 'No suitable item found in database' };
        }

        if (!result.product) {
            throw new Error('AI returned success but no product found');
        }

        return result;
    }, 3, 2000).catch(err => {
        console.error('  ❌ [Fitout Matcher Error]:', err.message);
        return { status: 'error', error_message: err.message };
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// PLAN ANALYZER
// ──────────────────────────────────────────────────────────────────────────────

const PLAN_ANALYSIS_PROMPT = (includeFitout = false) => `You are an Elite Senior Quantity Surveyor (SQS). Your mission is to extract a high-precision BOQ from architectural drawings.
${!includeFitout ? `
### 🚨 STRICT SCOPE: FURNITURE ONLY
- You MUST EXCLUSIVELY extract loose furniture items (Chairs, Desks, Tables, Sofas, Storage, etc.).
- You MUST NOT extract any architectural or fitout elements such as Partition Walls, Flooring, Ceilings, or MEP services.
` : `
### 🏗️ SCOPE: FULL FITOUT & FURNITURE
- Extract everything: Architectural elements (Partitions, Flooring, Ceilings), MEP services, and all Furniture items.
`}

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
9. **VISUAL PATTERN RECOGNITION (Architectural Logic)**:
   - **Flooring**: Identify "Carpet" by stippled/dotted hatch patterns. Identify "Tiles" by grid patterns. Identify "Stone/Marble" by irregular vein patterns or large slab outlines.
   - **Partitions**: "Glass Partitions" are typically thin double lines, often with a 'swing' symbol for doors. "Solid/Drywall Partitions" are thicker double lines, sometimes with solid or cross-hatch fill.
   - **Ceilings**: Grid patterns on the plan often indicate "Acoustic Tile" ceilings. Smooth areas with perimeter lines indicate "Gypsum" or "Plasterboard" ceilings.
   - **Joinery**: Built-in cabinets, pantries, and reception counters are typically identified by fixed outlines near walls, often with sink or equipment symbols.
10. CATEGORY MAPPING: You MUST map every item to one of these valid Main Categories: ${ALLOWED_CATEGORIES}.
11. SEPARATION OF CONCERNS:
   - FURNITURE: Includes chairs, desks, tables, storage, pods, and mobile accessories.
   - FITOUT: Includes architectural elements like 'Partition Wall', 'Tile Flooring', 'Gypsum Ceiling', 'Curtain Wall', 'Carpeting', 'Wall Cladding', or any fixed MEP/HVAC elements. 
   - FLOORING & CARPET: Items like 'Carpet Tile', 'Floor Carpet', 'Vinyl', or 'Main Floor Finish' MUST be identified as FITOUT.
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
  "planSummary": "Extraction of \$TOTAL_ITEMS items completed."
}
`;

const cleanQty = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 1;
    const s = String(val).toLowerCase().trim();
    const words = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10 };
    if (words[s]) return words[s];
    const match = s.match(/[\\d.]+/);
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
 * Call Local Python Vision Service.
 */
async function callLocalVision(imageBase64, imageMimeType) {
    try {
        const FormData = (await import('form-data')).default;
        const formData = new FormData();

        // Convert base64 to Buffer for Node.js
        const buffer = Buffer.from(imageBase64, 'base64');

        formData.append('file', buffer, {
            filename: 'floorplan.png',
            contentType: imageMimeType
        });

        const res = await axios.post(`${PYTHON_SERVICE_URL}/analyze-vision`, formData, {
            headers: { ...formData.getHeaders() },
            timeout: 180000 // 3 minutes for local heavy models
        });

        return res.data.boq;
    } catch (err) {
        const statusDetail = err.response?.data?.detail || err.response?.data?.error || err.response?.data?.message;
        const statusCode = err.response?.status ? `HTTP ${err.response.status}` : null;
        const code = err.code || null;
        const message = statusDetail || err.message || code || JSON.stringify(err) || 'Unknown local vision error';
        console.error(`  ❌ [Local Vision Error] ${statusCode || ''} ${message}`);
        throw new Error(`Local Vision Engine failed: ${message}`);
    }
}

async function callLocalLLM(systemPrompt, userPrompt, model = 'llama3.2') {
    try {
        const res = await axios.post(`${PYTHON_SERVICE_URL}/llm`, {
            system_prompt: systemPrompt,
            user_prompt: userPrompt,
            model: model
        });
        return res.data.content;
    } catch (err) {
        console.error(`  ❌ [Local LLM Error] Message: ${err.message}`);
        throw new Error(`Local LLM Engine failed: ${err.message}`);
    }
}

/**
 * Perform AI analysis on floor plan drawing(s).
 * @param {Array} filesData - Array of objects { base64Data, mimeType, originalname }
 */
/**
 * UNIVERSAL MULTIMODAL CALL
 * Routes to Google SDK or OpenAI-style Vision API (Nvidia/OpenRouter)
 */
export async function callUniversalMultimodalAI(systemPrompt, userPrompt, assets = [], modelName = null, jsonMode = false) {
    const provider = getProviderForModel(modelName);
    let finalModel = modelName || (provider === 'google' ? GOOGLE_MODEL : provider === 'openrouter' ? OPENROUTER_MODEL : NVIDIA_MODEL);

    // FIX: Auto-expand short names for NVIDIA known models
    if (provider === 'nvidia' && !finalModel.includes('/')) {
        const found = VALID_NVIDIA_MODELS.find(m => m.endsWith(finalModel));
        if (found) {
            console.log(`🔍 [NVIDIA] Expanding short name "${finalModel}" -> "${found}"`);
            finalModel = found;
        }
    }

    if (provider === 'google') {
        const rawModelName = finalModel;
        const cleanModelName = rawModelName.replace(':billed', '').trim();
        const sdkModelName = MODEL_MAPPING[cleanModelName] || cleanModelName;

        const genAIInstance = getGoogleAI(rawModelName);
        const model = genAIInstance.getGenerativeModel({
            model: sdkModelName,
            systemInstruction: systemPrompt,
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 16384,
                ...(jsonMode ? { responseMimeType: 'application/json' } : {})
            }
        });

        const promptParts = [
            { text: userPrompt },
            ...assets.map(asset => ({
                inlineData: { data: asset.base64Data, mimeType: asset.mimeType }
            }))
        ];

        try {
            const result = await model.generateContent({ contents: [{ role: 'user', parts: promptParts }] });
            return safeParseJSON(result.response.text());
        } catch (err) {
            console.error(`  ❌ [Google Multimodal] Global Error:`, err.message);
            throw err;
        }
    } else {
        // Nvidia or OpenRouter (OpenAI-style Vision)
        const endpoint = provider === 'nvidia' ? 'https://integrate.api.nvidia.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
        const apiKey = provider === 'nvidia' ? NVIDIA_API_KEY : OPENROUTER_API_KEY;

        if (!apiKey) throw new Error(`API Key for ${provider} is missing in .env`);

        // OpenAI Vision format
        const messages = [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: [
                    { type: "text", text: userPrompt },
                    ...assets.map(asset => {
                        // Some providers expect 'image_url' for both images and potentially PDFs? 
                        // Actually, most only support images. We assume assets are images here if not Google.
                        const mime = asset.mimeType || 'image/png';
                        return {
                            type: "image_url",
                            image_url: { url: `data:${mime};base64,${asset.base64Data}` }
                        };
                    })
                ]
            }
        ];

        // Strip our internal routing prefix for the actual provider call
        const apiModelName = finalModel.replace(/^(nvidia|openrouter|local)\//, '');

        try {
            console.log(`📡 [${provider}] Calling ${apiModelName} (Full Internal Name: ${finalModel}) at ${endpoint}...`);
            const response = await axios.post(endpoint, {
                model: apiModelName,
                messages,
                temperature: 0.1,
                max_tokens: 16384,
                ...(jsonMode ? { response_format: { type: "json_object" } } : {})
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://boq-v2.vercel.app', 'X-Title': 'BOQ V2' } : {})
                }
            });

            const text = response.data.choices[0].message.content;
            return safeParseJSON(text);
        } catch (err) {
            console.error(`  ❌ [${provider} Multimodal] Vision API Error:`, err.response?.data || err.message);
            throw new Error(`Vision AI Processing Failed (${provider}): ${err.message}`);
        }
    }
}

export async function analyzePlan(filesData, options = {}) {
    const { includeFitout = false, provider = 'google', providerModel = null } = options;
    console.log(`\\n🏗️ [Plan Analyzer] Analyzing ${filesData.length} sheets with provider=${provider}, model=${providerModel || ''}...`);

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

            const genAIInstance = getGoogleAI(modelName);
            const model = genAIInstance.getGenerativeModel({
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

        } else if (provider === 'local') {
            console.log(`  📍 Using Local Vision Engine (YOLOv8 + Llama 3.2)`);
            parsed = await callLocalVision(file.base64Data, file.mimeType);

        } else {
            throw new Error(`Unknown provider: ${provider}. Supported: google, openrouter, nvidia`);
        }

        // Process extracted items
        let flatItems = [];
        if (parsed.items && Array.isArray(parsed.items)) {
            flatItems = parsed.items
                .map(item => ({
                    location: String(item.location || 'General Area').trim(),
                    scope: String(item.scope || (includeFitout ? 'Fitout' : 'Furniture')).trim(),
                    code: item.code ? String(item.code).trim() : '',
                    description: String(item.description).trim(),
                    qty: cleanQty(item.qty),
                    unit: String(item.unit || 'Nos').trim()
                }));

            // Safety Filter: If user requested Furniture only, strip out anything labeled as Fitout
            if (!includeFitout) {
                const beforeCount = flatItems.length;
                flatItems = flatItems.filter(item => 
                    String(item.scope).toLowerCase().includes('furniture') || 
                    !String(item.scope).toLowerCase().includes('fitout')
                );
                if (flatItems.length < beforeCount) {
                    console.log(`  🧹 [Filter] Removed ${beforeCount - flatItems.length} fitout items from furniture-only request.`);
                }
            }
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

/** Generic retry wrapper for async operations */
export async function withRetry(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === retries - 1) throw err;
            console.warn(`  ⚠️  Retrying after error: ${err.message}. Attempt ${i + 1}/${retries}`);
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        }
    }
}