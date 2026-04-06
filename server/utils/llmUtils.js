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
// Valid model names: gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash-exp, etc.
// Default to 2.0-flash-exp if .env is missing or has a typo (like gemini-2.5-pro)
const VALID_GOOGLE_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-3.1-flash-live-preview',
    'gemini-2.0-flash-exp', 
    'gemini-2.0-flash-001', 
    'gemini-2.0-flash-lite-001'
];
const GOOGLE_MODEL = VALID_GOOGLE_MODELS.includes(process.env.GOOGLE_MODEL) ? process.env.GOOGLE_MODEL : 'gemini-2.5-flash';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-lite-001';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'meta/llama-3.1-405b-instruct';
const GROUNDING_MODEL = 'gemini-2.5-flash'; // Standard model for this environment

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

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
            max_tokens: 16384,
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

const IDENTIFY_SYSTEM = (brand) => `You are a Senior Furniture Architect.
Identify the single best real-world product model from ${brand} for this description.

Return ONLY valid JSON:
{ 
  "brand": "${brand}", 
  "model": "Exact Model Name",
  "category": "Standard Category (e.g. Chairs, Tables, Desks, Sofas, Storage)",
  "logic": "Brief reasoning" 
}`;

export async function identifyModel(description, brand, provider = 'google') {
    const system = IDENTIFY_SYSTEM(brand);
    const user = `What is the best One Model for "${description}" from "${brand}"?`;

    if (process.env.DEBUG_AI === 'true') {
        console.log(`\n🤖 [AI Stage 1 Prompt] (Brand: ${brand}):\nSystem: ${system.substring(0, 200)}...\nUser: ${user}`);
    }

    try {
        // Attempt 1: Search Grounded Identification
        const parsed = provider === 'google' ? await callGoogle(system, user, true) : await callOpenRouter(system, user);
        
        if (parsed && parsed.model && parsed.model !== 'FAILED') {
            return { 
                status: 'success', 
                brand: parsed.brand || brand, 
                model: parsed.model,
                category: parsed.category || ''
            };
        }
        
        throw new Error('Search did not yield a valid model');
    } catch (err) {
        console.warn(`  ⚠️ [AI Fallback] Search Identification failed for ${brand}, trying internal knowledge...`);
        try {
            // Attempt 2: Internal Knowledge Fallback (Non-Search)
            const fallbackParsed = await callGoogle(system, user, false);
            if (fallbackParsed && fallbackParsed.model && fallbackParsed.model !== 'FAILED') {
                return { 
                    status: 'success', 
                    brand: fallbackParsed.brand || brand, 
                    model: fallbackParsed.model,
                    category: fallbackParsed.category || ''
                };
            }
        } catch (innerErr) {
            console.error(`  ❌ [AI Critical] Both search and internal ID failed for ${brand}:`, innerErr.message);
        }
        return { status: 'error', brand, model: '', category: '', error_message: err.message };
    }
}

const FETCH_SYSTEM = (brand, model) => `You are a senior FF&E researcher specializing in global furniture sourcing.

Your task: Find full product details for "${model}" by ${brand}.

### 🔍 Search Strategy:
1. **Primary Source (Official Catalog)**: Search for the official brand website (e.g. las.it, ismobil.com, ottimo.ae, teknion.com). This is the "Pillar of Truth".
2. **Secondary Source (Architonic)**: Use Architonic as a reference library if the official site is restricted or lacks clear imagery.
3. **Asset Quality**: 
   - Prioritize DIRECT, functional image URLs. 
   - AVOID generic thumbnails or broken redirects.
   - If a brand is missing from Architonic (like Ottimo or LAS), use Google search to find their official catalog index.

Extract and return ONLY valid JSON (no markdown):
{
  "brand": "${brand}",
  "mainCategory": "Furniture",
  "subCategory": "Standardized sub-category",
  "family": "Collection/Series name",
  "model": "${model}",
  "description": "Professional 2-4 sentence description with technical specs.",
  "imageUrl": "DIRECT functional URL ending in .jpg, .png, or .webp",
  "productUrl": "Direct product page URL",
  "price": 0
}

IMPORTANT: If no live image is available on ANY official platform, return "imageUrl": "FAILED".`;

export async function fetchProductDetails(brand, model, tier, provider = 'google') {
    const system = FETCH_SYSTEM(brand, model);
    const user = `Execute deep search for: ${brand} ${model}. Find the direct image URL and product page. Return JSON.`;

    if (process.env.DEBUG_AI === 'true') {
        console.log(`\n🤖 [AI Stage 3 Prompt] (Fetch: ${brand} ${model}):\nSystem: ${system.substring(0, 200)}...\nUser: ${user}`);
    }

    try {
        let parsed = provider === 'google' ? await callGoogle(system, user, true) : await callOpenRouter(system, user);
        return { status: 'success', product: parsed };
    } catch (err) {
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
 * uses Gemini 2.5 Flash for high-speed lookup.
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

### 🏷️ CATEGORIZATION & SCOPE:
- **Location**: Use the exact room name/number from the drawing.
- **Categorization**: ${includeFitout ? 'Furniture vs Fitout' : 'Furniture only'}.
- **Scope**: ${includeFitout ? 'All loose furniture PLUS architectural items (flooring, ceiling, walls, doors) AND MEP/AV items (lighting, electrical, plumbing, screens).' : 'Loose furniture only (desks, chairs, storage).'}
- **Special Rule (Joinery)**: Doors and all wood works (wooden cabinets, counters, wall claddings) MUST be categorized STRICTLY as "Fitout (Joinery)".
- **Special Rule (MEP)**: Mechanical, electrical, and plumbing MUST be categorized STRICTLY as "Fitout (MEP)".
- **Special Rule (Lighting & AV)**: All lighting fixtures MUST be "Fitout (Lighting)". Audio/Visual equipment (screens, projectors, speakers) MUST be "Fitout (AV)".

### 📜 CORE RULES:
- **EXHAUSTIVE EXTRACTION (NO SHORTCUTS)**: You MUST extract absolutely EVERY SINGLE ITEM visible across the ENTIRE plan. Do not stop after 10 items. Do not provide a "sample". If there are 150 items, output 150 JSON items.
- **FULL FLOOR PLAN COVERAGE**: Segregate Fitout items cleanly with their respective scope subheaders ("Fitout (Architectural)", "Fitout (MEP)", etc). Absolutely ensure ALL loose furniture is completely isolated from the Fitout items and categorized strictly as "Furniture".
- **VISUAL MAGNIFICATION**: Zoom into every corner. Don't miss tiny text or symbols.
- **NO BUNDLING**: Break down "Typical Rooms" into individual line items per room.
- **UNIT STICKINESS**: Only use "Nos", "SQM", or "LM".

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
 * Perform AI analysis on floor plan drawing(s).
 * @param {Array} filesData - Array of objects { base64Data, mimeType, originalname }
 */
export async function analyzePlan(filesData, options = {}) {
    const { includeFitout = false } = options;
    console.log(`\n🏗️ [Plan Analyzer] Analyzing ${filesData.length} sheets...`);

    try {
        const model = genAI.getGenerativeModel({
            model: GOOGLE_MODEL,
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 16384
            }
        });

        const promptText = PLAN_ANALYSIS_PROMPT(includeFitout);
        
        // Prepare parts
        const promptParts = [
            { text: promptText },
            ...filesData.map(file => ({
                inlineData: {
                    data: file.base64Data,
                    mimeType: file.mimeType
                }
            }))
        ];

        const result = await model.generateContent({ contents: [{ role: 'user', parts: promptParts }] });
        const responseText = result.response.text();
        const parsed = safeParseJSON(responseText);

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
            items: flatItems
        };
    } catch (err) {
        console.error(`  ❌ [Plan Analyzer Error]:`, err.message);
        return { status: 'error', error_message: err.message };
    }
}
