import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from 'axios';
import 'dotenv/config';

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
    'gemma-4-26b-a4b-it',
    'gemma-4-31b-it',
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

/** Strip markdown fences, then parse JSON with surgical precision. */
export function safeParseJSON(text) {
    if (!text) throw new Error('Empty AI response');
    
    // 0. High-Precision Extraction: Look for the specific "rows" JSON block if it's a BOQ response
    const rowsBlockMatch = text.match(/\{[\s\S]*?"rows"[\s\S]*?\[[\s\S]*?\][\s\S]*?\}/);
    if (rowsBlockMatch) {
        try {
            const potential = rowsBlockMatch[0].trim();
            const opens = (potential.match(/\{/g) || []).length;
            const closes = (potential.match(/\}/g) || []).length;
            if (opens === closes) {
                return JSON.parse(potential.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''));
            }
        } catch (e) { /* continue to generic logic */ }
    }

    // 1. Structural Anchor Discovery
    let cleaned = '';
    const lastBraceIdx = text.lastIndexOf('}');
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
            const san = str.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
            return JSON.parse(san);
        } catch (e) {
            return null;
        }
    };

    let result = attemptParse(cleaned);
    if (result) return result;

    // Surgical repair
    let fixed = cleaned;
    const quoteMatches = fixed.match(/"/g) || [];
    if (quoteMatches.length % 2 !== 0) fixed += '"';

    const balanceAndParse = (str) => {
        let stack = [];
        for (let char of str) {
            if (char === '{') stack.push('}');
            else if (char === '[') stack.push(']');
            else if (char === '}') { if (stack[stack.length-1] === '}') stack.pop(); }
            else if (char === ']') { if (stack[stack.length-1] === ']') stack.pop(); }
        }
        return attemptParse(str + stack.reverse().join(''));
    };

    result = balanceAndParse(fixed);
    if (result) return result;

    const finalErr = new Error('The AI response was severely malformed or truncated.');
    finalErr.rawResponse = text;
    throw finalErr;
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
