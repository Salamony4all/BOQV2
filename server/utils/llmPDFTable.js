import axios from 'axios';
import 'dotenv/config';
import { callUniversalMultimodalAI } from './llmUtils.js';
import { buildDynamicPipelineChain } from './freeModelRouter.js';

// Dynamic PDF/Vision BOQ extraction candidates (kept as export for backward compatibility)
export const GEMMA4_FAMILY_MODELS = buildDynamicPipelineChain('pdf_boq', { freeTier: true });

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

/** Call universal model with Vision/PDF capabilities routed through the `pdf_boq` pipeline chain. */
export async function callGoogleMultimodal(systemPrompt, userPrompt, assets = [], modelName = null, jsonMode = false) {
    return callUniversalMultimodalAI(systemPrompt, userPrompt, assets, modelName, jsonMode, 'pdf_boq');
}

export async function callGoogleMultimodalFallback(systemPrompt, userPrompt, assets = [], modelName = null, jsonMode = false) {
    // callUniversalMultimodalAI now manages pipeline-aware Free-Tier routing + circuit-breaker failover across the full pdf_boq chain
    return callUniversalMultimodalAI(systemPrompt, userPrompt, assets, modelName, jsonMode, 'pdf_boq');
}
