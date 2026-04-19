import axios from 'axios';
import pdfParse from 'pdf-parse';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { 
    PDF_BOQ_PROMPT, 
    PLAN_ANALYSIS_PROMPT, 
    SMART_MATCH_PROMPT, 
    VALIDATE_PRODUCT_PROMPT 
} from './llmPrompts.js';

// Environment variables
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Default configurations
const GOOGLE_MODEL = "gemini-2.0-flash";
const NVIDIA_MODEL = "nvidia/llama-3.1-nemotron-70b-instruct";
const OPENROUTER_MODEL = "google/gemini-2.0-flash-001";

// Global instances
let googleAI = null;

const getGoogleAI = (modelName = GOOGLE_MODEL) => {
  if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY is missing in .env");
  // Some models might require different endpoint versions, but standard SDK usually handles it
  return new GoogleGenerativeAI(GOOGLE_API_KEY);
};

// --- Helper Functions ---

const safeParseJSON = (text) => {
    try {
        // Remove markdown code blocks if present
        const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || 
                         text.match(/```\n?([\s\S]*?)\n?```/) ||
                         [null, text];
        
        const cleanJson = jsonMatch[1].trim();
        return JSON.parse(cleanJson);
    } catch (err) {
        console.error("  ❌ [JSON Parse Error]:", err.message);
        console.error("  📄 [Raw Model Output]:", text);
        // Fallback to extraction if structure is broken
        return { status: 'error', error_message: 'Model output was not valid JSON' };
    }
};

const cleanQty = (qty) => {
    if (typeof qty === 'number') return qty;
    const cleaned = String(qty).replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 1;
};

const isValidProviderModel = (provider, model) => {
    // Basic validation to prevent using wrong provider endpoints
    if (provider === 'google' && !model.includes('gemini')) {
        // Google SDK usually only handles Gemini (and maybe Gemma if setup)
        if (model.includes('gemma')) return true;
        return false;
    }
    if (provider === 'nvidia' && !model.includes('nvidia/')) return false;
    // OpenRouter is a gateway, so most names are valid if formatted correctly (provider/model)
    return true;
};

// --- Core API Handlers ---

async function callGeneralLLM(systemPrompt, userPrompt, options = {}) {
    const { 
        provider = 'google', 
        model: modelName = null, 
        jsonMode = true 
    } = options;

    const finalModel = modelName || (provider === 'google' ? GOOGLE_MODEL : provider === 'openrouter' ? OPENROUTER_MODEL : NVIDIA_MODEL);
    
    console.log(`  🤖 [General LLM] Provider: ${provider}, Model: ${finalModel}`);

    if (provider === 'google') {
        try {
            const genAIInstance = getGoogleAI(finalModel);
            const model = genAIInstance.getGenerativeModel({ 
                model: finalModel,
                systemInstruction: systemPrompt 
            });

            const result = await model.generateContent(userPrompt);
            const text = result.response.text();
            return jsonMode ? safeParseJSON(text) : text;
        } catch (err) {
            console.error(`  ❌ [Google LLM Error]:`, err.message);
            throw err;
        }
    } else {
        // NVIDIA or OpenRouter (OpenAI-compatible)
        const endpoint = provider === 'nvidia' ? 'https://integrate.api.nvidia.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
        const apiKey = provider === 'nvidia' ? NVIDIA_API_KEY : OPENROUTER_API_KEY;
        
        if (!apiKey) throw new Error(`API Key for ${provider} is missing in .env`);

        try {
            const response = await axios.post(endpoint, {
                model: finalModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.1,
                ...(jsonMode ? { response_format: { type: "json_object" } } : {})
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://boq-v2.vercel.app', 'X-Title': 'BOQ V2' } : {})
                }
            });

            const text = response.data.choices[0].message.content;
            return jsonMode ? safeParseJSON(text) : text;
        } catch (err) {
            console.error(`  ❌ [${provider} LLM Error]:`, err.response?.data || err.message);
            throw err;
        }
    }
}

// --- Specific Tasks ---

/**
 * Smart Match: Uses AI to map unstructured BOQ items to a product database
 */
export async function smartMatchItems(projectItems, productDatabase, options = {}) {
    const { provider = 'google', modelName = null } = options;
    console.log(`\n🧠 [Smart Match] Matching ${projectItems.length} items using ${provider}...`);

    const finalModel = modelName || (provider === 'google' ? GOOGLE_MODEL : provider === 'openrouter' ? OPENROUTER_MODEL : NVIDIA_MODEL);

    const systemPrompt = SMART_MATCH_PROMPT();
    const userPrompt = JSON.stringify({
        project_items: projectItems,
        brand_catalog: productDatabase
    });

    try {
        const results = await callGeneralLLM(systemPrompt, userPrompt, { provider, model: finalModel });
        return results.matches || [];
    } catch (err) {
        console.error(`  ❌ [Smart Match Failed]:`, err.message);
        return [];
    }
}

/**
 * Validate Product: Checks if a product exists or is similar in a brand's data
 */
export async function validateProduct(itemDesc, brandName, brandData, options = {}) {
    const { provider = 'google' } = options;
    
    const systemPrompt = VALIDATE_PRODUCT_PROMPT(brandName);
    const userPrompt = JSON.stringify({
        search_query: itemDesc,
        available_products: brandData
    });

    try {
        return await callGeneralLLM(systemPrompt, userPrompt, { provider });
    } catch (err) {
        return { is_valid: false, confidence: 0, reason: 'AI processing error' };
    }
}

// --- Utilities ---

export async function extractTextFromPDF(pdfBuffer) {
    try {
        const data = await pdfParse(pdfBuffer);
        return data.text;
    } catch (err) {
        console.error("  ❌ [PDF Extract Error]:", err.message);
        throw new Error("Could not parse PDF content");
    }
}

/**
 * Vision Extraction: Multimodal support for Drawings/PDFs
 */
export async function multimodalExtract(systemPrompt, userPrompt, assets, options = {}) {
    const { provider = 'google', model: modelName = null, jsonMode = true } = options;
    
    console.log(`  👁️ [Multimodal Vision] Provider: ${provider}, Model: ${modelName || 'default'}`);

    const finalModel = modelName || (provider === 'google' ? GOOGLE_MODEL : provider === 'openrouter' ? OPENROUTER_MODEL : NVIDIA_MODEL);

    if (provider === 'google') {
        const genAIInstance = getGoogleAI(finalModel);
        const model = genAIInstance.getGenerativeModel({
            model: finalModel,
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

        try {
            const response = await axios.post(endpoint, {
                model: finalModel,
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
