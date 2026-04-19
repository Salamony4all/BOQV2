import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from 'axios';
import 'dotenv/config';
import { safeParseJSON } from './llmUtils.js';

// ──────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────────────────────────────────────
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const GOOGLE_FREE_KEY = process.env.GOOGLE_FREE_KEY || process.env.GEMINI_FREE_KEY || process.env.GEMINI_API_KEY_FREE;
const FORCE_FREE_GOOGLE = process.env.FORCE_FREE_GOOGLE_KEY === 'true';

export const FREE_GOOGLE_MODELS = [
    'gemma-4-31b-it',
    'gemma-4-26b-a4b-it',
    'gemma-4-e4b-it',
    'gemma-4-e2b-it',
    'gemini-1.5-flash',
    'gemini-2.0-flash'
];

export const GEMMA4_FAMILY_MODELS = [
    'gemma-4-31b-it',
    'gemma-4-26b-a4b-it',
    'gemma-4-e4b-it',
    'gemma-4-e2b-it'
];

function getGoogleAI(modelName) {
    const isFreeModel = FREE_GOOGLE_MODELS.includes(modelName) || (modelName && modelName.toLowerCase().includes('gemma'));
    if (FORCE_FREE_GOOGLE) {
        if (!GOOGLE_FREE_KEY) throw new Error('FORCE_FREE_GOOGLE set but GOOGLE_FREE_KEY is missing.');
        return new GoogleGenerativeAI(GOOGLE_FREE_KEY);
    }
    if (isFreeModel) {
        if (!GOOGLE_FREE_KEY) throw new Error(`Model "${modelName}" requires a Google Free Key (GOOGLE_FREE_KEY) which is missing.`);
        return new GoogleGenerativeAI(GOOGLE_FREE_KEY);
    } else {
        if (!GOOGLE_API_KEY) throw new Error(`Model "${modelName}" requires a Google Billed Key (GOOGLE_API_KEY) which is missing.`);
        return new GoogleGenerativeAI(GOOGLE_API_KEY);
    }
}


/** Call Google model with Vision capabilities. */
export async function callGoogleMultimodal(systemPrompt, userPrompt, assets = [], modelName = null, jsonMode = false) {
    const finalModel = modelName || 'gemma-4-26b-a4b-it';
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
        const text = result.response.text();
        return safeParseJSON(text);
    } catch (err) {
        console.error(`  ❌ [llmPDFTable] Error:`, err.message);
        throw err;
    }
}

export async function callGoogleMultimodalFallback(systemPrompt, userPrompt, assets = [], modelName = null, jsonMode = false) {
    const candidateModels = modelName ? [modelName] : GEMMA4_FAMILY_MODELS;
    let lastError = null;

    for (const candidate of candidateModels) {
        try {
            console.log(`🚀 [llmPDFTable] Trying model: ${candidate}`);
            return await callGoogleMultimodal(systemPrompt, userPrompt, assets, candidate, jsonMode);
        } catch (err) {
            lastError = err;
            console.warn(`❌ [llmPDFTable] Model ${candidate} failed: ${err.message}`);
        }
    }

    if (lastError) throw lastError;
    throw new Error('No valid response returned from Gemma 4 family');
}
