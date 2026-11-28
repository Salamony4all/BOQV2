import { GoogleGenerativeAI } from "@google/generative-ai";
import { AsyncLocalStorage } from 'async_hooks';
import axios from 'axios';
import 'dotenv/config';
import { TAXONOMY } from './normalizer.js';
import { readSettings } from '../settings.js';
import { preprocessPlanFiles } from './planPreprocessor.js';
import { coercePlanAnswer, describePlanAnswer } from './planAnswer.js';
import { detectCustomFabrication } from './customFabricationDetector.js';
import { searchFabricationHybrid } from '../repositories/supabaseCatalogRepo.js';
import {
    PIPELINE_TIMEOUT_MS,
    isGoogleFreeTierActive,
    ensureLiveCatalogSynced,
    getPipelineModelCandidates,
    recordModelFailure,
    recordModelSuccess,
    withModelTimeout
} from './freeModelRouter.js';

export const aiKeyStorage = new AsyncLocalStorage();

// ──────────────────────────────────────────────────────────────────────────────
// CONFIGURATION — keys come from browser (request context) or file store.
// Nothing is hardcoded. Use the Settings panel in the browser to configure.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resolve an AI setting value.
 * Priority: request context (browser headers) → file store → undefined
 */
function resolveKey(contextKey, fileKey) {
    const ctx = aiKeyStorage.getStore() || {};
    const val = ctx[contextKey];
    if (val) return val;
    const saved = readSettings();
    return saved[fileKey || contextKey] || '';
}

// Re-exported for legacy callers — now always dynamic
export const MODEL_MAPPING = {
    'gemini-pro': 'gemini-pro-latest',
    'gemini-flash': 'gemini-flash-lite-latest',
    'gemini-2-pro': 'gemini-2.5-pro',
    'gemini-2-flash': 'gemini-flash-lite-latest',
};

// Dynamic accessors — evaluated at call time, never at module load
export const getGoogleModel = () => resolveKey('googleModel', 'googleModel') || resolveKey('model', 'model') || 'gemini-flash-lite-latest';
export const getOpenRouterModel = () => resolveKey('openrouterModel', 'openrouterModel');
export const getNvidiaModel = () => resolveKey('nvidiaModel', 'nvidiaModel');

// Legacy constant aliases — now aligned with empirically verified Free-Tier best defaults
export const GOOGLE_MODEL = 'gemini-2.5-flash-lite';
export const GROUNDING_MODEL = 'gemini-2.5-flash-lite';
export const VISION_MODEL = 'gemini-2.5-flash';
export const OPENROUTER_MODEL = '';
export const NVIDIA_MODEL = '';

// No static model allow-lists — models are discovered live from the provider APIs
export const VALID_OPENROUTER_MODELS = [];
export const VALID_NVIDIA_MODELS = [];
export const VALID_LOCAL_MODELS = ['local/yolov8-llama3.2'];

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

    // Retrieve request-scoped keys: headers (browser) → file store
    const contextStore = aiKeyStorage.getStore() || {};
    const saved = readSettings();

    const reqGoogleApiKey = contextStore.googleApiKey || saved.googleApiKey;
    const reqGoogleFreeKey = contextStore.googleFreeKey || saved.googleFreeKey;
    const reqActiveTier = contextStore.activeTier || saved.activeTier || 'free';

    const finalApiKey = reqGoogleApiKey;
    const finalFreeApiKey = reqGoogleFreeKey;

    // Determine whether to use Billed Key or Free Key based on active tier
    let useBilledKey = (reqActiveTier === 'billed') || forceBilled;

    // Respect explicit Free Tier selection whenever a free key is configured
    if (useBilledKey || !finalFreeApiKey) {
        if (finalApiKey) {
            console.log(`  🔑 [LLM Utils] Using Google API Key (${maskKey(finalApiKey)}) for "${normalizedModel}".`);
            return new GoogleGenerativeAI(finalApiKey);
        }
        if (finalFreeApiKey) {
            console.log(`  💎 [LLM Utils] Falling back to Free Key (${maskKey(finalFreeApiKey)}) for "${normalizedModel}".`);
            return new GoogleGenerativeAI(finalFreeApiKey);
        }
        throw new Error(`Google API key is not configured. Open Settings → AI Configuration to add your key.`);
    } else {
        console.log(`  💎 [LLM Utils] Using FREE Key (${maskKey(finalFreeApiKey)}) for "${normalizedModel}".`);
        return new GoogleGenerativeAI(finalFreeApiKey);
    }
}

export const LOCAL_MODEL = 'local/yolov8-llama3.2';
export const PYTHON_SERVICE_URL = (process.env.NODE_ENV === 'development' && process.env.PYTHON_SERVICE_URL)
    ? process.env.PYTHON_SERVICE_URL
    : '';

// Deprecated: kept for any stale callers — resolves dynamically at runtime
const genAI = (() => {
    try {
        const saved = readSettings();
        const key = saved.googleApiKey || saved.googleFreeKey;
        if (key) return new GoogleGenerativeAI(key);
    } catch (_) {}
    // Return a dummy instance — will throw on actual use if no key is configured
    return null;
})();

export const getProviderForModel = (modelName) => {
    if (!modelName) return 'google';
    if (modelName.startsWith('nvidia/')) return 'nvidia';
    if (modelName.startsWith('local/')) return 'local';

    // If it has a slash and isn't nvidia/local, it's likely OpenRouter (e.g. google/gemini-2.0-flash-lite-001)
    if (modelName.includes('/')) return 'openrouter';
    return 'google';
};

const isValidProviderModel = (provider, model) => {
    if (!model || !String(model).trim()) return false;
    if (provider === 'local') return true;
    if (provider === 'google') return true; // Models are discovered dynamically from Google AI API
    if (provider === 'openrouter') return VALID_OPENROUTER_MODELS.includes(model) || model.includes('/');
    if (provider === 'nvidia') return VALID_NVIDIA_MODELS.includes(model) || String(model).trim().length > 0;
    return false;
};

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────

export function safeParseJSON(text) {
    if (!text) throw new Error('Empty AI response');

    // 0. Extract from markdown code fence if present anywhere in text
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const primaryText = codeBlockMatch ? codeBlockMatch[1].trim() : text;

    const cleanText = primaryText
        .replace(/^```(?:json)?\s*/im, '')
        .replace(/\s*```$/im, '')
        .trim();

    const attemptParse = (str) => {
        if (!str) return null;
        // Strip control characters that might break JSON.parse
        const san = str.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
        try {
            return JSON.parse(san);
        } catch (e) {
            try {
                // Retry after stripping trailing commas before } or ]
                return JSON.parse(san.replace(/,\s*([}\]])/g, '$1'));
            } catch (e2) {
                return null;
            }
        }
    };

    // 1. Try parsing directly
    let result = attemptParse(cleanText);
    if (result) return result;

    // 2. Helper to find balanced JSON structure (handles appended text or duplicate objects)
    const extractBalancedJSON = (txt, openChar, closeChar) => {
        const startIdx = txt.indexOf(openChar);
        if (startIdx === -1) return null;
        
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = startIdx; i < txt.length; i++) {
            const char = txt[i];
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            if (char === '\\') {
                escapeNext = true;
                continue;
            }
            if (char === '"') {
                inString = !inString;
                continue;
            }
            if (!inString) {
                if (char === openChar) depth++;
                else if (char === closeChar) {
                    depth--;
                    if (depth === 0) {
                        return txt.substring(startIdx, i + 1);
                    }
                }
            }
        }
        return null;
    };

    // 3. Try extracting first object
    const firstObj = extractBalancedJSON(cleanText, '{', '}');
    if (firstObj) {
        result = attemptParse(firstObj);
        if (result) return result;
    }

    // 4. Try extracting first array
    const firstArr = extractBalancedJSON(cleanText, '[', ']');
    if (firstArr) {
        result = attemptParse(firstArr);
        if (result) return result;
    }

    console.warn(`  ⚠️ [LLM Utils] Standard parse failed (chars=${cleanText.length}), attempting string-aware surgical repair...`);

    // 5. String-aware fallback repair (handles truncated arrays/objects & brackets inside string values)
    const firstObjIdx = cleanText.indexOf('{');
    const firstArrIdx = cleanText.indexOf('[');
    let startIdx = -1;
    if (firstObjIdx !== -1 && firstArrIdx !== -1) startIdx = Math.min(firstObjIdx, firstArrIdx);
    else startIdx = Math.max(firstObjIdx, firstArrIdx);

    const scanStructure = (str) => {
        const stack = [];
        let inString = false;
        let escapeNext = false;
        let lastArrayItemEnd = -1;

        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            if (inString) {
                if (ch === '\\') escapeNext = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') {
                inString = true;
            } else if (ch === '{') {
                stack.push('}');
            } else if (ch === '[') {
                stack.push(']');
            } else if (ch === '}' || ch === ']') {
                if (stack.length > 0 && stack[stack.length - 1] === ch) {
                    stack.pop();
                    if (ch === '}' && stack.length > 0 && stack[stack.length - 1] === ']') {
                        lastArrayItemEnd = i;
                    }
                }
            }
        }
        return { stack, inString, escapeNext, lastArrayItemEnd };
    };

    const closeTruncatedFragment = (fragment) => {
        const { stack, inString, escapeNext } = scanStructure(fragment);
        let candidate = fragment;
        if (escapeNext) candidate = candidate.slice(0, -1);
        if (inString) candidate += '"';
        candidate = candidate.replace(/,\s*$/, '');
        candidate += stack.slice().reverse().join('');
        return attemptParse(candidate);
    };

    if (startIdx !== -1) {
        const sliced = cleanText.slice(startIdx);
        result = closeTruncatedFragment(sliced);
        if (result) return result;

        // If truncated mid-item inside an array (e.g. {"items": [{...}, {...}, {"desc": "cut off...),
        // roll back to the last complete item object and close remaining open brackets cleanly.
        const { lastArrayItemEnd } = scanStructure(sliced);
        if (lastArrayItemEnd > 0) {
            const recoveredSlice = sliced.slice(0, lastArrayItemEnd + 1);
            result = closeTruncatedFragment(recoveredSlice);
            if (result) {
                console.warn(`  🩹 [LLM Utils] Recovered truncated JSON array cleanly up to char ${lastArrayItemEnd + 1}/${sliced.length}.`);
                return result;
            }
        }
    }

    console.error(`  ❌ [LLM Utils] All JSON repair strategies exhausted (chars=${cleanText.length}). Head: ${JSON.stringify(cleanText.slice(0, 180))} | Tail: ${JSON.stringify(cleanText.slice(-180))}`);
    const finalErr = new Error('The AI response was severely malformed or truncated.');
    finalErr.rawResponse = text;
    throw finalErr;
}

/** Generic OpenRouter call expecting JSON object back. */
export async function callOpenRouter(systemPrompt, userPrompt, modelName = null) {
    const contextStore = aiKeyStorage.getStore() || {};
    const saved = readSettings();
    const effectiveApiKey = contextStore.openrouterApiKey || saved.openrouterApiKey;
    const effectiveModel = modelName || contextStore.openrouterModel || saved.openrouterModel || contextStore.googleModel || saved.googleModel;

    try {
        const res = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: effectiveModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            },
            {
                headers: {
                    'Authorization': `Bearer ${effectiveApiKey}`,
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
export async function callNvidia(systemPrompt, userPrompt, modelName = null) {
    const contextStore = aiKeyStorage.getStore() || {};
    const saved = readSettings();
    const effectiveApiKey = contextStore.nvidiaApiKey || saved.nvidiaApiKey;
    const effectiveModel = modelName || contextStore.nvidiaModel || saved.nvidiaModel || contextStore.googleModel || saved.googleModel;

    try {
        const res = await axios.post(
            'https://integrate.api.nvidia.com/v1/chat/completions',
            {
                model: effectiveModel,
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
                    'Authorization': `Bearer ${effectiveApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );
        const raw = res.data.choices[0].message.content;
        return typeof raw === 'string' ? safeParseJSON(raw) : raw;
    } catch (err) {
        console.error(`  ❌ [NVIDIA] Status: ${err.response?.status}, Model: ${effectiveModel}, Message: ${err.response?.data?.detail || err.response?.data?.error?.message || err.message}`);
        throw err;
    }
}

/**
 * Google Gemini call with optional Grounding, pipeline-aware Free-Tier routing,
 * circuit-breaker cooldowns, and automatic model failover.
 */
export async function callGoogle(systemPrompt, userPrompt, useSearch = false, modelName = null, pipeline = null) {
    const contextStore = aiKeyStorage.getStore() || {};
    const reqGoogleModel = contextStore.googleModel;
    const rawModelName = reqGoogleModel || modelName || (useSearch ? GROUNDING_MODEL : GOOGLE_MODEL);
    const forceBilledSuffix = String(rawModelName || '').toLowerCase().trim().endsWith(':billed') ? ':billed' : '';
    const freeTier = isGoogleFreeTierActive(aiKeyStorage, rawModelName);
    const effectivePipeline = pipeline || (useSearch ? 'grounding' : 'matching');
    const timeoutMs = PIPELINE_TIMEOUT_MS[effectivePipeline] || 25000;

    // Ensure live Google /v1beta/models catalog is synced (0ms once cached for 30m)
    const activeCatalogKey = freeTier
        ? (contextStore.googleFreeKey || contextStore.googleApiKey || '')
        : (contextStore.googleApiKey || contextStore.googleFreeKey || '');
    await ensureLiveCatalogSynced(activeCatalogKey);

    const executeAttempt = async (candidateModel, attachSearch) => {
        const tools = attachSearch ? [{ googleSearch: {} }] : [];
        const genAIInstance = getGoogleAI(`${candidateModel}${forceBilledSuffix}`);
        const model = genAIInstance.getGenerativeModel({
            model: candidateModel,
            systemInstruction: systemPrompt,
            tools,
            generationConfig: {
                temperature: 0,
                ...(tools.length > 0 ? {} : { responseMimeType: "application/json" })
            }
        });
        const result = await withModelTimeout(
            model.generateContent(userPrompt),
            timeoutMs,
            `Google(${candidateModel}${attachSearch ? ':search' : ''})`
        );
        const text = result.response.text();

        if (process.env.DEBUG_AI === 'true') {
            console.log(`\n🤖 [AI Raw Response] (${attachSearch ? 'Search' : 'Direct'} | ${candidateModel}):\n${text.substring(0, 500)}...`);
        }

        try {
            return safeParseJSON(text);
        } catch (parseErr) {
            if (text && (text.toLowerCase().includes('failed') || text.toLowerCase().includes('not found'))) {
                return { model: 'FAILED', logic: text };
            }
            throw parseErr;
        }
    };

    const candidates = getPipelineModelCandidates(effectivePipeline, rawModelName, {
        freeTier,
        useSearch,
        modelMapping: MODEL_MAPPING
    });

    let lastError = null;
    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        try {
            if (freeTier && i === 0 && rawModelName && rawModelName.replace(':billed', '').trim() !== candidate) {
                console.log(`  🧭 [Free Router:${effectivePipeline}] Routed "${rawModelName}" → "${candidate}"${useSearch ? ' (grounded)' : ''}`);
            } else if (i > 0) {
                console.log(`  🔁 [Model Failover:${effectivePipeline}] Switching to fallback "${candidate}"${useSearch ? ' (grounded)' : ''}...`);
            }
            const t0 = Date.now();
            const parsed = await executeAttempt(candidate, useSearch);
            recordModelSuccess(candidate, { useSearch, freeTier, latencyMs: Date.now() - t0 });
            return parsed;
        } catch (err) {
            lastError = err;
            const info = recordModelFailure(candidate, err, { useSearch, freeTier });
            console.warn(`  ⚠️ [Google:${effectivePipeline}] "${candidate}" failed (${info.category}): ${err.message}`);
            if (!info.retryableOnNextModel) {
                throw err;
            }
        }
    }

    // If grounded calls exhausted the Free Search Grounding quota (e.g. 20 RPD on 2.5 series), automatically rescue with ungrounded JSON chain
    if (useSearch && freeTier) {
        const rescueCandidates = getPipelineModelCandidates('grounding_ungrounded_rescue', null, {
            freeTier: true,
            useSearch: false,
            modelMapping: MODEL_MAPPING
        });
        for (const rescueModel of rescueCandidates) {
            try {
                console.log(`  🛟 [Free Router:${effectivePipeline}] Search grounding unavailable — rescuing ungrounded via "${rescueModel}"...`);
                const parsed = await executeAttempt(rescueModel, false);
                recordModelSuccess(rescueModel, { useSearch: false, freeTier: true });
                return parsed;
            } catch (err) {
                lastError = err;
                const info = recordModelFailure(rescueModel, err, { useSearch: false, freeTier: true });
                console.warn(`  ⚠️ [Google Rescue:${effectivePipeline}] "${rescueModel}" failed (${info.category}): ${err.message}`);
                if (!info.retryableOnNextModel) throw err;
            }
        }
    }

    if (lastError) {
        lastError.allModelsExhausted = true;
        throw lastError;
    }
    const err = new Error(`All Google fallback models failed for pipeline "${effectivePipeline}"`);
    err.allModelsExhausted = true;
    throw err;
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

    return `You are an expert Commercial FF&E Furniture Specialist for Boqify.
Your task is to identify the EXACT product model from the brand "${brand}" that best matches the provided BOQ specification.
${strictCategoryRule}
### 🎯 STRICT FUNCTIONAL ARCHETYPE & ANTI-HALLUCINATION RULES:
1. NEVER match a Chair/Seating product to a Desk/Table/Workstation specification, and NEVER match a Desk/Table/Cabinet/Acoustic-Pod product to a Chair/Seating specification.
2. NEVER invent or hallucinate product mechanisms not supported by the catalog entry — NEVER guess a model's furniture type from phonetic or spelling similarity (e.g. unrelated sofa/lounge names vs. "training" or "swivel").
   - NEVER match modular lounge sofas, reception soft seating, waiting-room benches, poufs, or high bar stools to an individual training/nesting/conference/task chair specification.
   - NEVER match acoustic pods/booths, screens, or reception counters to a desk/folding table specification.
3. Match physical form & commercial use case (e.g. folding/flip-top desk -> folding/flip-top/meeting table): for training/nesting/visitor chairs, strongly prefer catalog entries whose model name, category, or catalog summary confirms they are an actual Chair / Office Chair / Conference Chair / Visitor Chair / Task Chair / Operative Seating (containing Chair / Task / Visitor / Conference / Seduta / Operative), rather than unknown seating names when confirmed chair models exist.
4. Return ONLY the clean verbatim model name in "model" — strip any bracketed category tag (" [...]") and any trailing summary (" — ...") when forming the "model" string.
5. If this brand's catalog truly contains NO compatible product for the requested functional archetype, return "model": "FAILED" rather than forcing a mismatched category.

### 🏢 BRAND PROFILE:
- Brand Name: ${brand}
- Segment: ${tier.toUpperCase()} ${tier === 'budgetary' ? '(Prioritize simple, functional, value-driven models)' : '(Look for iconic, design-led, unique names)'}

${modelList.length > 0 ? `### 📦 KNOWN PRODUCT CATALOG:
Each line gives: Model Name [Catalog Category] — Catalog Summary (when available).
You MUST select ONE EXACT model name VERBATIM from this list below (closest matching functional archetype). DO NOT invent generic names (like "TRAINING CHAIR" or "CONFERENCE DESK") that are not listed below:
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
        const user = `What is the best matching model for: "${description}" from "${brand}"? Return strictly valid JSON only.`;

        if (process.env.DEBUG_AI === 'true') {
            console.log(`\n🤖 [AI Identify] (Brand: ${brand}): Matching "${description.substring(0, 50)}..."`);
        }

        let parsed;
        if (provider === 'google') {
            // Use strict JSON mode when matching against a known catalog list (tools disable responseMimeType and often emit Markdown)
            const useGrounding = modelList.length < 3;
            try {
                parsed = await callGoogle(system, user, useGrounding, providerModel || (useGrounding ? GROUNDING_MODEL : GOOGLE_MODEL));
            } catch (parseOrApiErr) {
                if (useGrounding) {
                    console.warn(`  ⚠️ [AI Identify] Grounded call returned non-JSON for ${brand}; rescuing with strict JSON mode...`);
                    parsed = await callGoogle(system, user, false, providerModel || GOOGLE_MODEL);
                } else {
                    throw parseOrApiErr;
                }
            }
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

const AUTO_MATCH_MULTI_ROUTER_SYSTEM = (availableBrands = []) => `You are a high-speed FF&E routing agent across multiple brands (${availableBrands.join(', ')}).
Your task is to categorize the provided item descriptions into functional groups to optimize downstream multi-brand matching.
CRITICAL: Output ONLY valid JSON exactly matching this structure, with no markdown:
{
  "desking": ["id1", "id3"],
  "seating": ["id2"],
  "softSeating": [],
  "storage": [],
  "accessories": []
}`;

const AUTO_MATCH_MULTI_AGENT_SYSTEM = (availableBrands = [], category = 'furniture', tier = 'mid') => `You are an expert FF&E Furniture Specialist specialized in "${category}".
Your task is to select the best matching Brand and exact Model from the available brands for each item description.

### 🏢 AVAILABLE BRANDS (${tier.toUpperCase()} TIER):
- ${availableBrands.join('\n- ')}

### 🌍 GLOBAL CATEGORY MAPPING:
You MUST map each item to:
- Main Category: ${ALLOWED_CATEGORIES}
- Sub-Category: ${ALLOWED_SUB_CATEGORIES}

### 📝 INSTRUCTIONS:
1. Choose ONLY from the available brands listed above.
2. Select the most accurate real product model for that brand matching the item's function, form factor, and dimensions.
3. Return concise reasoning in "logic".

Return ONLY valid JSON matching this structure:
{
  "matches": [
    {
      "id": "original_item_id",
      "brand": "Selected Brand Name",
      "model": "Exact Model Name",
      "mainCategory": "Main Category",
      "subCategory": "Sub-Category",
      "logic": "Brief reasoning"
    }
  ]
}`;

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
    if (/\/logo\/|favicon|\.svg(\?|$)/i.test(url)) return false;

    const isImageFile = /\.(jpg|jpeg|png|webp|avif|gif)$/i.test(url.split('?')[0]);
    const wafTrustedDomains = ['narbutas.com', 'steelcase.com', 'hermanmiller.com', 'knoll.com', 'vitra.com', 'muuto.com', 'haworth.com', 'architonic.com'];
    const lowerUrl = url.toLowerCase();
    const isWafWhitelisted = wafTrustedDomains.some(d => lowerUrl.includes(d));
    let refererHeader = {};
    try { refererHeader = { 'Referer': new URL(url).origin + '/' }; } catch {}

    try {
        const res = await axios.head(url, {
            timeout: 2500,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                ...refererHeader
            }
        });
        const contentType = String(res.headers['content-type'] || '').toLowerCase();
        if (res.status >= 200 && res.status < 400 && (contentType.startsWith('image/') || isImageFile) && !contentType.includes('html')) return true;

        const resGet = await axios.get(url, {
            timeout: 2500,
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Range': 'bytes=0-2048',
                ...refererHeader
            }
        });
        const getCt = String(resGet.headers['content-type'] || '').toLowerCase();
        return resGet.status >= 200 && resGet.status < 400 && (getCt.startsWith('image/') || isImageFile) && !getCt.includes('html');
    } catch (err) {
        const httpStatus = err?.response?.status;
        // Never treat HTTP 404/410 hallucinations as valid; only allow WAF 403 bypass for explicit CDN allowlist
        if (httpStatus === 403 && isImageFile && isWafWhitelisted) {
            console.log(`  ✅ [Stage 3.5] Smart Trust applied for WAF 403 CDN: "${url.substring(0, 50)}..."`);
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

const PLAN_ANALYSIS_PROMPT = (includeFitout = false) => `You are an Elite Senior Quantity Surveyor (SQS) & Interior Fitout Specification Writer. Your mission is to extract a high-precision, tender-ready Bill of Quantities (BOQ) from architectural drawings with rich technical specifications for automated catalog & pricing matching.
${!includeFitout ? `
### 🚨 STRICT SCOPE: FURNITURE ONLY
- You MUST EXCLUSIVELY extract loose & system furniture items (Task Chairs, Meeting Chairs, Visitor Chairs, Lounge Seating, Conference Tables, Workstations, Executive Desks, Reception Counters, Dining/Pantry Tables, Storage Cabinets, Pedestals, Acoustic Pods/Booths).
- You MUST NOT extract any architectural or fitout elements such as Partition Walls, Doors, Flooring, Ceilings, Skirting, or MEP services.
` : `
### 🏗️ SCOPE: FULL FITOUT & FURNITURE
- Extract BOTH all Architectural Fitout elements (Partitions, Doors & Glazing, Flooring Finishes, False Ceilings, Wall Cladding, Skirting, Fixed Joinery/Pantry Counters & Sinks, Lighting/MEP) AND all loose/system Furniture items as distinct line items.
- Do NOT lump Furniture and Fitout into one item.
`}

### 🎯 ACCURACY PROTOCOL - REJECT "LOT":
You are strictly FORBIDDEN from using units like "Lot", "LS", "Lumpsum", or "Package". Every item MUST have a measurable numerical quantity and unit ("Nos", "SQM", or "LM").

### 📐 QUANTITY & DIMENSION CALIBRATION DIRECTIVES:
1. **Calibrate Scale First**: Read explicit dimension strings on the plan (e.g., millimeter strings like 16950, 7105, 4585, 5260, 4600, 3000, room areas in m2, or Scale Bars like 1:100). If missing, use standard architectural door leaf width (~900 mm / 0.9 m) to calibrate room dimensions and furniture sizes.
2. **Nos (Count)**: Carefully count EVERY individual chair (count cluster by cluster + conference room + cabins + pantry), workstation desk/position, table, door leaf (swing vs sliding), acoustic pod, storage unit, sink, and lighting fixture.
   - If open office workstations are arranged in clusters (e.g., 5 clusters x 6 seats = 30 workstations), extract accurate total counts or clear cluster line items with exact total count matching the drawing annotations.
3. **SQM (Area)**: For Flooring (Carpet Tile, Porcelain Tile, Vinyl, Marble), False Ceilings (Gypsum Board, Acoustic Grid Tile), and Wall Cladding: use explicit room areas or calibrated Length x Width (in meters) per zone.
4. **LM (Linear)**: For Interior Partition Walls (Drywall / Glass Partitions), Skirting, and Fixed Pantry Counters/Wall Cabinets: measure total drawn wall/counter length along each zone.

### ✍️ MANDATORY TECHNICAL SPECIFICATION ENRICHMENT (FOR AUTO-MATCHING):
Write a crisp, tender-grade technical BOQ specification for EVERY item derived accurately from the drawing — **WITHOUT inventing brand/model names, WITHOUT "Supply and installation of..." filler, and WITHOUT repeating clauses**:
- **Tone & Conciseness**: Keep description crisp, factual, and scannable (20-32 words max, single sentence/clause format). Never invent an unseen base mechanism (for instance, do NOT write "cantilever-style" on chairs drawn around a table unless cantilever/sled legs are visually unmistakable; state "swivel / 4-leg / sled commercial base" if unshown).
- **For Seating**: State chair role & geometry seen on plan (e.g., open office 5-star swivel task chair vs meeting room mid-back meeting/conference chair vs pantry cafe dining chair vs reception 2-seater / 3-seater / L-shaped modular lounge sofa ONLY if drawn as a multi-seat/L-shape, or lounge armchair if drawn as single square chairs), upholstery/back finish, base material, and calibrated W x D x H mm.
  - Good example: "Mid-Back Conference / Meeting Chair (~600 x 600 x 880 mm) — Upholstered high-density molded foam seat, breathable mesh or fabric back, fixed/adjustable armrests, steel or aluminum base."
- **For Desks, Tables & Workstations**: State exact geometry & seating capacity from plan (e.g., 12-Pax Rectangular/Boat Boardroom Conference Table with ~4200 x 1400 x 750 mm for long boardroom tables vs small round tables ONLY if drawn round, Executive L-Shaped Desk with Side Return, Linear Back-to-Back Workstation Desk System, Curved Reception Counter, Coffee Side Table), 25 mm E1 MFC/HPL worktop with 2 mm ABS edging, cable management/power box, and powder-coated steel frame.
- **For Storage / Joinery / Pods**: State cabinet/pod type (Mobile 3-Drawer Pedestal, Low Storage Credenza, Acoustic Phone Booth / Pod if enclosed pod symbol exists), central lock, and L x W x H mm.
- **For Fitout - Flooring**: State commercial system & finish from room context/hatching (Heavy-Duty Commercial Tufted Nylon Carpet Tile, 500x500 mm, bitumen/acoustic backing, Class 33, Bfl-s1; pantry/wet areas -> Rectified Anti-Slip Porcelain Floor Tile, 600x600x10 mm, R10 matte finish, cementitious screed & epoxy grout).
- **For Fitout - Ceilings**: State ceiling system (12.5 mm Gypsum Board False Ceiling on 0.5 mm concealed galvanized MF steel furring grid, taped & matte emulsion paint; or 600x600x15 mm Acoustic Mineral Fiber Tile Ceiling on exposed T-grid).
- **For Fitout - Partitions, Doors & Pantry Joinery**: State wall/door build-up (100-125 mm Acoustic Drywall Partition: double 12.5 mm plasterboard on 70 mm galvanized C-studs with 50 mm 60 kg/m3 rockwool infill; 10-12 mm Slimline Toughened Glass Partition in powder-coated aluminum channels; 900x2100x45 mm Solid-Core Flush Laminate Single Leaf Swing Door / Toughened Glass Sliding Door with overhead aluminum track; or Built-in Pantry Base/Wall Cabinet in HMR MDF/HPL with 20 mm quartz top & SS undermount sink).

### 🧭 CATEGORY & SCOPE MAPPING:
1. Map every item to an accurate main typology hint aligned with: ${ALLOWED_CATEGORIES}.
2. SEPARATION OF CONCERNS (4 SCOPES):
   - "Furniture": Standard catalog chairs, desks, conference tables (<=3200mm), workstations, cafe/coffee tables, pedestals, filing cabinets, loose sofas, lounge armchairs, acoustic pods.
   - "Custom Fabrication": Bespoke workshop/site-fabricated items — custom/curved/L-shaped reception counters, built-in upholstered banquettes & booth seating, oversized boardroom tables (>3600mm or 14+ pax), full-height executive wall joinery/lockers, fluted timber/slatted acoustic feature walls, CNC screens/metal dividers, custom planter troughs, built-in pantry/vanity counters, monolithic terrazzo benches.
   - "Fitout (Architectural)": Partition walls, glass partitions, flooring finishes (Carpet Tile, Porcelain Tile, Vinyl, Marble), false ceilings (Gypsum / Acoustic Grid), swing/sliding doors, skirting, window blinds.
   - "Fitout (Lighting)" / "Fitout (MEP)" / "Fitout (AV)": Only if clearly indicated on the plan.

Return ONLY valid JSON. No markdown fences or conversational text.

### 📦 OUTPUT FORMAT:
{
  "zones": [
    { "name": "Room / Zone", "areaSqm": 28.5, "perimeterLm": 22.0, "floorFinish": "Carpet Tile", "ceilingType": "Gypsum Board" }
  ],
  "items": [
    {
      "location": "Exact Room / Zone Name from Plan",
      "scope": "Furniture" | "Custom Fabrication" | "Fitout (Architectural)" | "Fitout (Joinery)" | "Fitout (Lighting)" | "Fitout (MEP)" | "Fitout (AV)",
      "code": "Tag if shown on plan or systematic code e.g. CH-01, WS-01, FAB-01, FL-01, DR-01",
      "name": "Concise Standardized Item Title (no brand/model names)",
      "dimensions": "Calibrated L x W x H mm or module size (e.g. '4200 x 1400 x 750 mm')",
      "shape": "rectangular" | "curved" | "l-shape" | "u-shape" | "round",
      "designBuildKind": "reception" | "sofa" | "table" | "cabinet" | "counter" | "partition" | "seat" | "desk" | "bench" | "planter",
      "materialSpec": "Short non-repeating finish/construction spec",
      "categoryHint": "Valid category from allowed categories, Custom Fabrication, or Fitout trade",
      "description": "One clean, non-repetitive tender BOQ specification (title + dimensions + key construction specs in ~20-32 words, no 'Supply and installation of')",
      "confidence": "high" | "medium" | "low",
      "evidence": "Brief visual/CAD basis e.g. 'Counted 12 chairs + CAD tag CH-01 at 1:100 scale'",
      "qty": 12.5,
      "unit": "Nos" | "SQM" | "LM"
    }
  ],
  "planSummary": "Extraction of N items completed."
}
`;

const normalizePlanScope = (rawScope, desc, includeFitout) => {
    const scopeStr = String(rawScope || '').trim();
    const lowerDesc = String(desc || '').toLowerCase();
    if (/custom\s*fab|bespoke|millwork/i.test(scopeStr)) return 'Custom Fabrication';

    const fabCheck = detectCustomFabrication(desc, scopeStr);
    if (fabCheck.isCustomFabrication && !/\b(carpet\s*tile|porcelain|gypsum\s*ceiling|drywall|glass\s*partition|swing\s*door)\b/i.test(lowerDesc)) {
        return 'Custom Fabrication';
    }

    const isClearArchitecturalFitout = /\b(carpet tile|carpet flooring|porcelain tile|tile flooring|vinyl flooring|marble flooring|gypsum ceiling|false ceiling|mineral fiber ceiling|acoustic grid ceiling|partition wall|drywall partition|glass partition|swing door|sliding door|wall cladding|skirting|ceiling finish|floor finish)\b/i.test(lowerDesc)
        && !/\b(mobile|freestanding|acoustic pod|phone booth|desk screen|privacy screen|banquette|reception counter)\b/i.test(lowerDesc);
    const isClearFixedJoinery = /\b(pantry cabinet|built-in pantry|vanity counter|pantry sink|undermount sink)\b/i.test(lowerDesc);

    if (isClearArchitecturalFitout) return 'Fitout (Architectural)';
    if (isClearFixedJoinery && /fitout|joinery|cabinet|pantry/i.test(scopeStr || lowerDesc)) return 'Custom Fabrication';
    if (scopeStr) return scopeStr;
    return includeFitout ? 'Fitout (Architectural)' : 'Furniture';
};

const formatEnrichedPlanDescription = (item = {}) => {
    const name = String(item.name || '').trim();
    const rawDesc = String(item.description || '')
        .replace(/^(supply\s+(?:and|&)\s+installation\s+of\s+(?:a|an|the)?\s*|supply\s+of\s+(?:a|an|the)?\s*)/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    const dims = String(item.dimensions || '').replace(/^dimensions\s*:?\s*/i, '').trim();
    const spec = String(item.materialSpec || item.material_spec || '').trim();

    let out = rawDesc || name || 'Architectural BOQ Item';
    if (name && rawDesc) {
        const nameWords = name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
        const rawLower = rawDesc.toLowerCase();
        const covered = nameWords.length > 0 && nameWords.every(w => rawLower.includes(w));
        if (!covered && !rawLower.includes(name.toLowerCase())) {
            out = `${name} — ${rawDesc.charAt(0).toUpperCase()}${rawDesc.slice(1)}`;
        }
    }

    if (dims) {
        const dimNums = dims.match(/\d{3,4}/g) || [];
        const hasDimInOut = /\d{3,4}\s*[x×]\s*\d{3,4}/i.test(out)
            || out.toLowerCase().includes(dims.toLowerCase())
            || (dimNums.length >= 2 && dimNums.slice(0, 2).every(tok => out.includes(tok)));
        if (!hasDimInOut) {
            const cleanOut = out.replace(/[;.\s]+$/, '');
            out = `${cleanOut} (${dims})`;
        }
    }

    // Only append non-overlapping material clauses if the description is short
    if (spec && out.length < 75) {
        const outWordSet = new Set(out.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3));
        const clauses = spec.split(/[;•]+/).map(c => c.trim()).filter(Boolean);
        const freshClauses = clauses.filter(clause => {
            const cWords = clause.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
            if (cWords.length === 0) return false;
            const overlap = cWords.filter(w => outWordSet.has(w)).length;
            return (overlap / cWords.length) < 0.45;
        });
        if (freshClauses.length > 0) {
            const cleanOut = out.replace(/[;.\s]+$/, '');
            out = `${cleanOut}; ${freshClauses.join(', ')}`;
        }
    }

    return out.replace(/\s+/g, ' ').replace(/\s*;\s*$/, '').trim();
};

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
// Models that rejected `thinkingConfig.thinkingBudget = 0` (learned at runtime, per process)
const thinkingControlUnsupported = new Set();

export async function callUniversalMultimodalAI(systemPrompt, userPrompt, assets = [], modelName = null, jsonMode = false, pipeline = null) {
    const contextStore = aiKeyStorage.getStore() || {};
    const reqGoogleModel = contextStore.googleModel;
    const reqOpenRouterModel = contextStore.openrouterModel;
    const reqNvidiaModel = contextStore.nvidiaModel;
    const reqProvider = contextStore.aiProvider || 'google';

    const provider = getProviderForModel(modelName || reqGoogleModel || reqOpenRouterModel || reqNvidiaModel) || reqProvider;
    let finalModel = modelName;
    if (provider === 'google') {
        finalModel = modelName || reqGoogleModel || GOOGLE_MODEL;
    } else if (provider === 'openrouter') {
        finalModel = modelName || reqOpenRouterModel || reqGoogleModel || OPENROUTER_MODEL;
    } else if (provider === 'nvidia') {
        finalModel = modelName || reqNvidiaModel || reqGoogleModel || NVIDIA_MODEL;
    } else {
        finalModel = modelName || reqGoogleModel || GOOGLE_MODEL;
    }

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
        const forceBilledSuffix = String(rawModelName || '').toLowerCase().trim().endsWith(':billed') ? ':billed' : '';
        const freeTier = isGoogleFreeTierActive(aiKeyStorage, rawModelName);
        const hasPdfAsset = Array.isArray(assets) && assets.some(a => /pdf/i.test(String(a?.mimeType || '')));
        const effectivePipeline = pipeline || (hasPdfAsset ? 'pdf_boq' : 'matching');
        const timeoutMs = PIPELINE_TIMEOUT_MS[effectivePipeline] || 30000;

        const activeCatalogKey = freeTier
            ? (contextStore.googleFreeKey || contextStore.googleApiKey || '')
            : (contextStore.googleApiKey || contextStore.googleFreeKey || '');
        await ensureLiveCatalogSynced(activeCatalogKey);

        const candidates = getPipelineModelCandidates(effectivePipeline, rawModelName, {
            freeTier,
            useSearch: false,
            modelMapping: MODEL_MAPPING
        });

        const promptParts = [
            { text: userPrompt },
            ...assets.map(asset => ({
                inlineData: { data: asset.base64Data, mimeType: asset.mimeType }
            }))
        ];

        // PDF table extraction is transcription, not reasoning: "thinking" roughly doubles the
        // latency for the same rows. It is switched off per model, and learned at runtime — a
        // model that rejects the setting is retried without it and remembered.
        const wantsFastExtraction = effectivePipeline === 'pdf_boq';
        // Serverless functions have a hard wall-clock limit: spend it across the failover chain
        // instead of letting one congested model consume all of it.
        const onServerless = process.env.VERCEL === '1';
        const budgetMs = onServerless && wantsFastExtraction ? Number(process.env.PDF_BOQ_BUDGET_MS || 50000) : Infinity;
        const budgetStart = Date.now();

        let lastError = null;
        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];
            const remainingMs = budgetMs - (Date.now() - budgetStart);
            if (remainingMs < 6000) {
                console.warn(`  ⏳ [Multimodal:${effectivePipeline}] Time budget exhausted before "${candidate}".`);
                break;
            }
            // Keep a reserve for one fast fallback when more candidates remain
            const reserveMs = i < candidates.length - 1 ? 14000 : 0;
            const attemptTimeoutMs = Math.min(timeoutMs, Math.max(6000, remainingMs - reserveMs));
            try {
                if (freeTier && i === 0 && rawModelName && rawModelName.replace(':billed', '').trim() !== candidate) {
                    console.log(`  🧭 [Free Router:${effectivePipeline}] Multimodal routed "${rawModelName}" → "${candidate}"`);
                } else if (i > 0) {
                    console.log(`  🔁 [Multimodal Failover:${effectivePipeline}] Switching to fallback "${candidate}"...`);
                }
                const genAIInstance = getGoogleAI(`${candidate}${forceBilledSuffix}`);
                const runOnce = (thinkingOff) => {
                    const model = genAIInstance.getGenerativeModel({
                        model: candidate,
                        systemInstruction: systemPrompt,
                        generationConfig: {
                            temperature: 0,
                            maxOutputTokens: (effectivePipeline === 'pdf_boq' || effectivePipeline === 'plan_vision') ? 65536 : 16384,
                            ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
                            ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {})
                        }
                    });
                    return withModelTimeout(
                        model.generateContent({ contents: [{ role: 'user', parts: promptParts }] }),
                        attemptTimeoutMs,
                        `GoogleMultimodal(${candidate})`
                    );
                };

                const t0 = Date.now();
                const thinkingOff = wantsFastExtraction && /^gemini/i.test(candidate) && !thinkingControlUnsupported.has(candidate);
                let result;
                try {
                    result = await runOnce(thinkingOff);
                } catch (firstErr) {
                    const rejectedSetting = thinkingOff && /thinking|budget|unknown name|generation_?config/i.test(String(firstErr?.message || ''));
                    if (!rejectedSetting) throw firstErr;
                    thinkingControlUnsupported.add(candidate);
                    console.log(`  ↩️  [Multimodal:${effectivePipeline}] "${candidate}" does not accept thinking-off; retrying with its default.`);
                    result = await runOnce(false);
                }
                const parsed = safeParseJSON(result.response.text());
                const latencyMs = Date.now() - t0;
                recordModelSuccess(candidate, { useSearch: false, freeTier, latencyMs });
                if (wantsFastExtraction) console.log(`  ⚡ [Multimodal:${effectivePipeline}] "${candidate}" answered in ${latencyMs}ms (thinking ${thinkingOff && !thinkingControlUnsupported.has(candidate) ? 'off' : 'default'}).`);
                return parsed;
            } catch (err) {
                lastError = err;
                const info = recordModelFailure(candidate, err, { useSearch: false, freeTier });
                console.error(`  ❌ [Google Multimodal:${effectivePipeline}] "${candidate}" failed (${info.category}):`, err.message);
                if (!info.retryableOnNextModel) {
                    throw err;
                }
            }
        }

        if (lastError) {
            lastError.allModelsExhausted = true;
            throw lastError;
        }
        const err = new Error(`All Google multimodal models failed for pipeline "${effectivePipeline}"`);
        err.allModelsExhausted = true;
        throw err;
    } else {
        // Nvidia or OpenRouter (OpenAI-style Vision)
        const endpoint = provider === 'nvidia' ? 'https://integrate.api.nvidia.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
        const apiKey = provider === 'nvidia'
            ? (resolveKey('nvidiaApiKey', 'nvidiaApiKey') || process.env.NVIDIA_API_KEY || '')
            : (resolveKey('openrouterApiKey', 'openrouterApiKey') || process.env.OPENROUTER_API_KEY || '');

        if (!apiKey) throw new Error(`API Key for ${provider} is missing in .env or Settings`);

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
    
    // Retrieve request-scoped keys/model from AsyncLocalStorage
    const contextStore = aiKeyStorage.getStore() || {};
    const reqGoogleModel = contextStore.googleModel;
    console.log(`\\n🏗️ [Plan Analyzer] Analyzing ${filesData.length} sheets with provider=${provider}, model=${providerModel || ''}...`);

    if (!filesData || filesData.length === 0) {
        return { status: 'error', error_message: 'No files provided for analysis' };
    }

    const selectedModel = providerModel || (provider === 'google' ? (reqGoogleModel || GOOGLE_MODEL) : provider === 'openrouter' ? OPENROUTER_MODEL : NVIDIA_MODEL);
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
        // Hybrid CAD Vector + High-DPI Image Preprocessing via mupdf
        const { visionAssets, cadContext } = await preprocessPlanFiles(filesData);
        const activeAssets = visionAssets.length > 0 ? visionAssets : filesData;
        const promptText = cadContext
            ? `${PLAN_ANALYSIS_PROMPT(includeFitout)}\n\n### 📐 GROUND-TRUTH CAD VECTOR CALIBRATION CONTEXT (from PDF text layer — trust these exact scales, m² areas, dimensions, and tag codes):\n${cadContext}`
            : PLAN_ANALYSIS_PROMPT(includeFitout);

        let parsed;
        let actualModelUsed = selectedModel;

        if (provider === 'google') {
            const rawModel = reqGoogleModel || providerModel || VISION_MODEL;
            const forceBilledSuffix = String(rawModel || '').toLowerCase().trim().endsWith(':billed') ? ':billed' : '';
            const freeTier = isGoogleFreeTierActive(aiKeyStorage, rawModel);
            const activeCatalogKey = freeTier
                ? (contextStore.googleFreeKey || contextStore.googleApiKey || '')
                : (contextStore.googleApiKey || contextStore.googleFreeKey || '');
            await ensureLiveCatalogSynced(activeCatalogKey);
            const candidates = getPipelineModelCandidates('plan_vision', rawModel, {
                freeTier,
                useSearch: false,
                modelMapping: MODEL_MAPPING
            });
            const onServerless = process.env.VERCEL === '1';
            const totalBudgetMs = onServerless ? 48000 : (PIPELINE_TIMEOUT_MS.plan_vision || 95000);
            const startedAt = Date.now();

            const promptParts = [
                { text: promptText },
                ...activeAssets.map(f => ({
                    inlineData: { data: f.base64Data, mimeType: f.mimeType }
                }))
            ];

            let lastPlanErr = null;
            for (let i = 0; i < candidates.length; i++) {
                const candidate = candidates[i];
                const remainingMs = totalBudgetMs - (Date.now() - startedAt);
                if (remainingMs < 7000) {
                    console.warn(`  ⏳ [Plan Analyzer] Time budget exhausted before "${candidate}".`);
                    break;
                }
                // On the hosted app the whole request has 48 s. A first model that uses its full 38 s
                // leaves the next one about 10 s, which is just short of what the fast models need,
                // so while there is another model to try, the first keeps 15 s back for it.
                const reserveMs = (onServerless && i === 0 && candidates.length > 1) ? 15000 : 0;
                const attemptTimeout = Math.min(onServerless ? 38000 : (PIPELINE_TIMEOUT_MS.plan_vision || 95000), remainingMs - reserveMs);
                try {
                    console.log(`  📍 [Plan Analyzer] Attempt ${i + 1}/${candidates.length} using Google model: ${candidate} (${activeAssets.length} sheet images, FreeTier=${freeTier})`);
                    const genAIInstance = getGoogleAI(`${candidate}${forceBilledSuffix}`);
                    const genCfg = { temperature: 0.1, responseMimeType: 'application/json' };
                    if (onServerless && /^gemini/i.test(candidate)) {
                        genCfg.thinkingConfig = { thinkingBudget: 1024 };
                    }
                    const model = genAIInstance.getGenerativeModel({
                        model: candidate,
                        generationConfig: genCfg
                    });

                    const result = await withModelTimeout(
                        model.generateContent({ contents: [{ role: 'user', parts: promptParts }] }),
                        attemptTimeout,
                        `PlanAnalyzer(${candidate})`
                    );
                    const candidateRes = result.response?.candidates?.[0];
                    const finishReason = candidateRes?.finishReason || 'UNKNOWN';
                    const rawText = result.response.text();
                    console.log(`  📄 [Plan Analyzer] Response received (${candidate}): finishReason=${finishReason}, chars=${rawText?.length || 0}`);
                    // Models do not always send the object that was asked for (a list per sheet, the
                    // bare list of lines, another key, one line with a syntax slip): read the lines
                    // wherever they are before deciding the model found nothing.
                    let firstRead = null;
                    try {
                        firstRead = safeParseJSON(rawText);
                    } catch { /* unparseable as a whole: the lines are read one by one below */ }
                    const { answer: candidateParsed, how: readAs } = coercePlanAnswer(firstRead, rawText);
                    if (candidateParsed.items.length === 0) {
                        console.warn(`  🧩 [Plan Analyzer] "${candidate}" sent an answer with no BOQ lines in it: ${JSON.stringify(describePlanAnswer(firstRead, rawText))}`);
                        throw new Error(`Model ${candidate} returned 0 items from floor plan`);
                    }
                    if (readAs !== 'object') {
                        console.log(`  🧩 [Plan Analyzer] "${candidate}" answered as "${readAs}", not as the object asked for; read ${candidateParsed.items.length} lines from it.`);
                    }
                    parsed = candidateParsed;
                    actualModelUsed = candidate;
                    recordModelSuccess(candidate, { useSearch: false, freeTier });
                    break;
                } catch (planErr) {
                    lastPlanErr = planErr;
                    const info = recordModelFailure(candidate, planErr, { useSearch: false, freeTier });
                    console.warn(`  ⚠️ [Plan Analyzer] "${candidate}" failed (${info.category}): ${planErr.message}`);
                    if (!info.retryableOnNextModel) throw planErr;
                }
            }
            if (!parsed) {
                throw lastPlanErr || new Error('All Google vision models failed to analyze floor plan');
            }

        } else if (provider === 'openrouter' || provider === 'nvidia') {
            const isOR = provider === 'openrouter';
            const modelName = providerModel || (isOR ? OPENROUTER_MODEL : NVIDIA_MODEL);
            const apiKey = isOR
                ? (resolveKey('openrouterApiKey', 'openrouterApiKey') || process.env.OPENROUTER_API_KEY || '')
                : (resolveKey('nvidiaApiKey', 'nvidiaApiKey') || process.env.NVIDIA_API_KEY || '');
            if (!apiKey) throw new Error(`${isOR ? 'OpenRouter' : 'NVIDIA'} API key is not configured. Open Settings → AI Configuration to add your key.`);
            const endpoint = isOR ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://integrate.api.nvidia.com/v1/chat/completions';

            // Process ALL preprocessed sheet images instead of silently dropping files[1..]
            const allItemsMerged = [];
            for (const sheet of activeAssets) {
                const resSheet = await callVisionAPI(
                    promptText,
                    `Analyze architectural sheet "${sheet.originalname || 'floorplan'}" and extract BOQ items as JSON`,
                    sheet.base64Data,
                    sheet.mimeType,
                    modelName,
                    endpoint,
                    apiKey
                );
                const sheetItems = coercePlanAnswer(resSheet).answer.items;
                if (sheetItems.length) allItemsMerged.push(...sheetItems);
            }
            parsed = { items: allItemsMerged, planSummary: `Extraction completed across ${activeAssets.length} sheet(s).` };

        } else if (provider === 'local') {
            if (!PYTHON_SERVICE_URL) {
                throw new Error('Local Python Vision Engine is disabled in serverless production (set NODE_ENV=development and PYTHON_SERVICE_URL locally).');
            }
            parsed = await callLocalVision(activeAssets[0].base64Data, activeAssets[0].mimeType);

        } else {
            throw new Error(`Unknown provider: ${provider}. Supported: google, openrouter, nvidia`);
        }

        // Process extracted items + Early Custom Fabrication enrichment
        let flatItems = [];
        if (parsed.items && Array.isArray(parsed.items)) {
            flatItems = await Promise.all(parsed.items
                .filter(item => item && (item.description || item.name))
                .map(async (item) => {
                    const enrichedDescription = formatEnrichedPlanDescription(item);
                    const normalizedScope = normalizePlanScope(item.scope, enrichedDescription, includeFitout);
                    const unit = String(item.unit || 'Nos').trim();
                    const qty = cleanQty(item.qty);
                    const fabDetect = detectCustomFabrication(enrichedDescription, normalizedScope);

                    let fabFields = {};
                    if (normalizedScope === 'Custom Fabrication' || fabDetect.isCustomFabrication) {
                        const hits = await searchFabricationHybrid({
                            queryText: enrichedDescription,
                            tier: 'mid',
                            designBuildKind: item.designBuildKind || fabDetect.designBuildKind,
                            shape: item.shape || fabDetect.shape,
                            parsedDimsMm: fabDetect.parsedDimsMm,
                            qty,
                            unit,
                            topK: 1,
                        }).catch(() => []);
                        const tpl = hits[0];
                        fabFields = {
                            fulfillmentType: 'custom_fabrication',
                            fabricationId: tpl?.id || tpl?.sku_code || '',
                            skuCode: tpl?.sku_code || '',
                            designBuildKind: item.designBuildKind || tpl?.design_build_kind || fabDetect.designBuildKind || '',
                            shape: item.shape || tpl?.shape || fabDetect.shape || 'rectangular',
                            workshopTrade: tpl?.workshop_trade || 'Joinery',
                            leadTimeDays: tpl?.lead_time_days || 21,
                            estimatedRate: tpl?.computedRate || 0,
                        };
                    }

                    return {
                        location: String(item.location || 'General Area').trim(),
                        scope: (fabFields.fulfillmentType === 'custom_fabrication') ? 'Custom Fabrication' : normalizedScope,
                        code: item.code ? String(item.code).trim() : (fabFields.skuCode || ''),
                        name: item.name ? String(item.name).trim() : '',
                        dimensions: item.dimensions ? String(item.dimensions).trim() : (fabDetect.parsedDimsMm?.raw || ''),
                        materialSpec: (item.materialSpec || item.material_spec) ? String(item.materialSpec || item.material_spec).trim() : '',
                        categoryHint: (item.categoryHint || item.category_hint) ? String(item.categoryHint || item.category_hint).trim() : '',
                        confidence: ['high', 'medium', 'low'].includes(String(item.confidence || '').toLowerCase()) ? String(item.confidence).toLowerCase() : 'medium',
                        evidence: item.evidence ? String(item.evidence).trim() : '',
                        description: enrichedDescription,
                        qty,
                        unit,
                        ...fabFields,
                    };
                }));

            // Safety Filter: If user requested Furniture only, strip out flat Architectural Fitout (keep Furniture & Custom Fabrication pieces)
            if (!includeFitout) {
                const beforeCount = flatItems.length;
                flatItems = flatItems.filter(item =>
                    String(item.scope).toLowerCase().includes('furniture') ||
                    String(item.scope).toLowerCase().includes('custom fabrication') ||
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
            zones: Array.isArray(parsed.zones) ? parsed.zones : [],
            items: flatItems,
            provider: provider,
            model: actualModelUsed || providerModel || (provider === 'google' ? VISION_MODEL : provider === 'openrouter' ? OPENROUTER_MODEL : NVIDIA_MODEL)
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

/** Generic retry wrapper for async operations with intelligent 429 quota backoff */
export async function withRetry(fn, retries = 4, delay = 1500) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            const errMsg = err.message || '';
            // Do not waste 25s retrying hard billing caps or already-exhausted full failover chains
            if (/exceeded its monthly spending cap/i.test(errMsg) || err?.allModelsExhausted) {
                throw err;
            }
            if (i === retries - 1) throw err;
            let waitTime = delay * (i + 1);
            
            // Check if error is a 429 rate limit / quota error
            const isRateLimit = errMsg.includes('429') || errMsg.includes('Quota exceeded') || errMsg.includes('rate-limits') || errMsg.includes('RESOURCE_EXHAUSTED');
            if (isRateLimit) {
                // Try to extract suggested retry delay (e.g. "Please retry in 3.35s" or "retryDelay":"3s")
                const matchSeconds = errMsg.match(/retry in ([\d\.]+)s/i) || errMsg.match(/retryDelay["']?\s*:\s*["']?(\d+)/i);
                if (matchSeconds && matchSeconds[1]) {
                    const parsedSec = parseFloat(matchSeconds[1]);
                    waitTime = Math.max(waitTime, (parsedSec * 1000) + 750);
                } else {
                    waitTime = Math.max(waitTime, 3500 * (i + 1));
                }
                console.warn(`  ⏳ [LLM Utils Rate Limit] 429 Quota limit encountered. Backing off for ${(waitTime / 1000).toFixed(1)}s before retry ${i + 1}/${retries}...`);
            } else {
                console.warn(`  ⚠️  Retrying after error: ${errMsg}. Attempt ${i + 1}/${retries} (delay: ${waitTime}ms)`);
            }
            
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

/**
 * Call LLM expecting structured JSON matching a strict schema, with automatic retry on validation failure.
 * @param {string} systemPrompt - System prompt instructions
 * @param {string} userPrompt - User query text
 * @param {object} schema - JSON schema specification with required properties
 * @param {number} maxRetries - Maximum retry count (default: 2)
 * @param {string} providerModel - Optional model override
 * @returns {Promise<object>} Validated JSON response
 */
export async function callWithSchemaRetry(systemPrompt, userPrompt, schema = null, maxRetries = 2, providerModel = null, pipeline = 'matching', useSearch = false) {
    let attempt = 0;
    let lastError = null;
    let currentSystemPrompt = systemPrompt;
    let currentUserPrompt = userPrompt;

    while (attempt <= maxRetries) {
        try {
            const parsed = await callGoogle(currentSystemPrompt, currentUserPrompt, useSearch, providerModel, pipeline);
            if (!parsed || typeof parsed !== 'object') {
                throw new Error('AI returned non-object response');
            }

            // Validate required schema properties
            if (schema && Array.isArray(schema.required)) {
                for (const reqKey of schema.required) {
                    if (parsed[reqKey] === undefined || parsed[reqKey] === null) {
                        throw new Error(`Missing required schema property: "${reqKey}"`);
                    }
                }
            }

            return parsed;
        } catch (err) {
            if (/exceeded its monthly spending cap/i.test(err?.message || '') || err?.allModelsExhausted) {
                throw err;
            }
            lastError = err;
            attempt++;
            console.warn(`  ⚠️ [LLM Schema Validation Retry ${attempt}/${maxRetries}] Error: ${err.message}`);
            
            if (attempt <= maxRetries) {
                const schemaGuide = schema ? `\nREQUIRED SCHEMA: ${JSON.stringify(schema)}` : '';
                currentUserPrompt = `${userPrompt}\n\n[CRITICAL ERROR IN PREVIOUS ATTEMPT: ${err.message}. You MUST fix this error and output strictly valid JSON conforming to the schema.]${schemaGuide}`;
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }

    throw new Error(`Strict JSON Schema validation failed after ${maxRetries} retries: ${lastError.message}`);
}