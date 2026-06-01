import express from 'express';
import axios from 'axios';
import { safeParseJSON, OPENROUTER_MODEL, FREE_GOOGLE_MODELS } from './utils/llmUtils.js';

const router = express.Router();

// 1. Google Gemini API Proxy Route
// The python agent using gemini_adapter will send POST to /models/{model}:generateContent
router.post('/models/*', async (req, res) => {
    try {
        const modelStr = req.params[0]; // e.g. "gemma-4-31b-it:generateContent"
        
        // We only want to handle generateContent calls
        if (!modelStr || !modelStr.endsWith(':generateContent')) {
            return res.status(404).json({ error: 'Not found' });
        }
        
        const modelName = modelStr.replace(':generateContent', '');
        console.log(`🤖 [LLM Proxy] Intercepted Gemini API request for model: ${modelName}`);
        
        // Use the official Google API key from the app
        const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        const googleFreeKey = process.env.GOOGLE_FREE_KEY || process.env.GEMINI_FREE_KEY || process.env.GEMINI_API_KEY_FREE;
        const FORCE_FREE_GOOGLE = process.env.FORCE_FREE_GOOGLE_KEY === 'true';
        
        const isFreeModel = FREE_GOOGLE_MODELS.some(m => modelName.toLowerCase().includes(m.toLowerCase()));
        
        let apiKey = googleApiKey;
        if (FORCE_FREE_GOOGLE || isFreeModel) {
            apiKey = googleFreeKey || googleApiKey;
        }

        if (!apiKey) {
            throw new Error('Google API key is not configured in BOQ app');
        }

        const payload = req.body;
        
        // Forward the request to the official Google Gemini API
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 60000 
            }
        );

        const responseData = response.data;
        
        // Intercept the response and repair JSON if needed
        // Gemini returns: { candidates: [ { content: { parts: [ { text: "..." } ] } } ] }
        if (responseData.candidates && responseData.candidates[0] && responseData.candidates[0].content) {
            const parts = responseData.candidates[0].content.parts;
            if (parts && parts.length > 0) {
                for (let part of parts) {
                    if (part.text && typeof part.text === 'string') {
                        const rawText = part.text;
                        // Only try to repair if it looks like it might have markdown or valid JSON structure
                        if (rawText.includes('```') || rawText.trim().startsWith('{')) {
                            try {
                                console.log('🤖 [LLM Proxy] Attempting to repair Gemini JSON text...');
                                // Try to parse using our robust parser
                                const repairedJson = safeParseJSON(rawText);
                                // Serialize back to clean string without markdown
                                part.text = JSON.stringify(repairedJson);
                                console.log('✅ [LLM Proxy] Successfully repaired Gemini JSON text!');
                            } catch (repairErr) {
                                console.warn('⚠️ [LLM Proxy] Failed to repair Gemini JSON text, passing raw:', repairErr.message);
                            }
                        }
                    }
                }
            }
        }

        res.status(200).json(responseData);
    } catch (error) {
        console.error('❌ [LLM Proxy Error]:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'LLM Proxy failed' });
    }
});

// 2. OpenRouter API Proxy Route (Kept for fallback/compatibility if they switch to openrouter/openai)
router.post('/chat/completions', async (req, res) => {
    try {
        console.log('🤖 [LLM Proxy] Intercepted chat completion request...');
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        if (!openRouterKey) {
            throw new Error('OPENROUTER_API_KEY is not configured in BOQ app');
        }

        const payload = req.body;
        const targetModel = process.env.GOOGLE_MODEL || OPENROUTER_MODEL || 'google/gemma-4-31b-it:free';
        payload.model = targetModel;
        
        console.log(`🤖 [LLM Proxy] Forwarding to OpenRouter with model: ${targetModel}`);
        
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${openRouterKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://boqv2.vercel.app',
                    'X-Title': 'Boqify'
                },
                timeout: 60000 
            }
        );

        const responseData = response.data;
        
        if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
            const message = responseData.choices[0].message;
            if (message.tool_calls && message.tool_calls.length > 0) {
                for (let tc of message.tool_calls) {
                    if (tc.function && typeof tc.function.arguments === 'string') {
                        const rawArgs = tc.function.arguments;
                        try {
                            const repairedJson = safeParseJSON(rawArgs);
                            tc.function.arguments = JSON.stringify(repairedJson);
                        } catch (repairErr) {
                            console.warn('⚠️ [LLM Proxy] Failed to repair JSON arguments, passing raw:', repairErr.message);
                        }
                    }
                }
            }
        }

        res.status(200).json(responseData);
    } catch (error) {
        console.error('❌ [LLM Proxy Error]:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'LLM Proxy failed' });
    }
});

export default router;
