/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Value Engineered Offer — Dedicated Auto-Detect LLM Utilities           │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { callUniversalMultimodalAI, withRetry, GOOGLE_MODEL, VISION_MODEL } from './llmUtils.js';
import { TAXONOMY } from './normalizer.js';

const ALLOWED_CATEGORIES = Object.keys(TAXONOMY).join(', ');
const ALLOWED_SUB_CATEGORIES = Object.values(TAXONOMY).flatMap(cat => Object.keys(cat)).join(', ');

// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS (Highly token-optimized)
// ──────────────────────────────────────────────────────────────────────────────

const VE_MATCH_AUTO_SYSTEM = (hasImage = false) => `You are an expert FF&E product matcher.
Task: Identify the EXACT Brand, Model, Main Category, and Sub-Category perfectly matching the description${hasImage ? ' and image' : ''}.

### 🌍 GLOBAL CATEGORY MAPPING:
You MUST map to one of these Main Categories: ${ALLOWED_CATEGORIES}
Sub-Categories: ${ALLOWED_SUB_CATEGORIES}

Return ONLY valid JSON:
{
  "status": "success",
  "brand": "Detected Brand Name (e.g., 'Narbutas', 'Sedus Stoll', 'Herman Miller')",
  "model": "Detected Model Name (e.g., 'Nova Wood Table', 'se:lounge', 'Aeron')",
  "mainCategory": "Matched Main Category",
  "subCategory": "Matched Sub-Category",
  "logic": "Brief reasoning"
}`;

// Micro-jitter to prevent "Thundering Herd" API bursts during parallel mapping
const randomJitter = () => new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 500));

/**
 * Matches specifications or extracts brands and models directly from the description (and image).
 * Uses withRetry for optimal parallel performance.
 * STRICTLY respects the UI providerModel selection, with a multi-stage safety rescue for API image failures.
 */
export async function veMatchAuto(description, providerModel = null, assets = []) {
    return withRetry(async () => {
        // Spread out parallel requests slightly to protect Free Tier quotas
        await randomJitter();

        const hasImage = assets && assets.length > 0;
        const system = VE_MATCH_AUTO_SYSTEM(hasImage);

        // Truncate user prompt to save maximum tokens
        const user = `Description: "${description}"`;

        console.log(`  🤖 [VE Match Auto] Executing match for: ${description.substring(0, 50)}...`);

        // Respect user selection, fallback to environment default only if null
        let effectiveModel = providerModel || GOOGLE_MODEL;
        let parsed;

        if (hasImage) {
            // Universal Asset Formatter
            const formattedAssets = assets.map(asset => {
                let rawData = asset?.inlineData?.data || asset?.data || asset?.base64Data || asset;
                let mime = asset?.inlineData?.mimeType || asset?.mimeType;

                if (typeof rawData === 'string' && rawData.startsWith('data:')) {
                    const mimeMatch = rawData.match(/^data:(image\/\w+);base64,/);
                    if (mimeMatch) mime = mimeMatch[1];
                    rawData = rawData.split(',')[1];
                }

                if (!mime || mime.trim() === '' || !mime.startsWith('image/')) {
                    mime = 'image/jpeg';
                }

                return {
                    base64Data: rawData,
                    mimeType: mime,
                    inlineData: {
                        data: rawData,
                        mimeType: mime
                    }
                };
            });

            try {
                // 1. Attempt using the user's selected model first (NO hardcoding)
                parsed = await callUniversalMultimodalAI(system, user, formattedAssets, effectiveModel, true);
            } catch (visionErr) {
                const errMsg = visionErr.message || '';
                console.warn(`  ⚠️ [VE Match Auto] Vision matching failed with "${effectiveModel}": ${errMsg}`);

                // If it is a rate limit or quota/limit error, let withRetry handle it.
                // Otherwise, it is an API capability or payload error, so we rescue it.
                const isRateLimit = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('limit');
                if (!isRateLimit) {
                    // If the original model was the 31b, step down to the 26b model
                    if (effectiveModel.includes('gemma-4-31b')) {
                        console.warn(`  ⚠️ [VE Match Auto] Model "${effectiveModel}" failed to process image on Google API. Retrying with "gemma-4-26b-a4b-it"...`);
                        try {
                            parsed = await callUniversalMultimodalAI(system, user, formattedAssets, 'gemma-4-26b-a4b-it', true);
                        } catch (secondErr) {
                            console.warn(`  ⚠️ [VE Match Auto] "gemma-4-26b-a4b-it" also failed: ${secondErr.message}. Rescuing with dedicated VISION_MODEL ("${VISION_MODEL}")...`);
                            // Ultimate fallback
                            parsed = await callUniversalMultimodalAI(system, user, formattedAssets, VISION_MODEL, true);
                        }
                    } else {
                        // If it wasn't the 31b model originally, jump straight to the Gemini vision fallback
                        console.warn(`  ⚠️ [VE Match Auto] Model "${effectiveModel}" failed to process the image. Rescuing task with dedicated VISION_MODEL ("${VISION_MODEL}")...`);
                        parsed = await callUniversalMultimodalAI(system, user, formattedAssets, VISION_MODEL, true);
                    }
                } else {
                    // Re-throw if it's a Rate Limit (429) so withRetry can do its job
                    throw visionErr;
                }
            }
        } else {
            // Text-only pipeline
            parsed = await callUniversalMultimodalAI(system, user, [], effectiveModel, true);
        }

        if (!parsed || parsed.model === 'FAILED') throw new Error('AI failed to match specification');

        // Normalize mainCategory and subCategory using TAXONOMY keys
        const rawMain = parsed.mainCategory || '';
        const rawSub = parsed.subCategory || '';
        const logicText = parsed.logic || '';

        const mainCat = Object.keys(TAXONOMY).find(c => c.toLowerCase() === rawMain.toLowerCase()) || 'Office Seating';
        const subCatsMap = TAXONOMY[mainCat] || {};
        const subCatKeys = Object.keys(subCatsMap);

        let subCat = subCatKeys.find(s => s.toLowerCase() === rawSub.toLowerCase());

        if (!subCat && rawSub) {
            subCat = subCatKeys.find(s => {
                const regex = subCatsMap[s];
                return regex instanceof RegExp && regex.test(rawSub);
            });
        }

        if (!subCat && logicText) {
            subCat = subCatKeys.find(s => {
                const regex = subCatsMap[s];
                return regex instanceof RegExp && regex.test(logicText);
            });
        }

        if (!subCat) {
            subCat = subCatKeys.includes('Staff Chairs') ? 'Staff Chairs' : (subCatKeys.includes('General') ? 'General' : (subCatKeys[0] || 'General'));
        }

        parsed.mainCategory = mainCat;
        parsed.subCategory = subCat;

        return { status: 'success', ...parsed };

    }, 3, 3000).catch(err => {
        console.error(`  ❌ [VE Match Auto] Failed:`, err.message);
        throw err; // Allows withRetry to handle exponential backoff properly
    });
}