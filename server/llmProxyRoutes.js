import express from 'express';
import axios from 'axios';
import { safeParseJSON, OPENROUTER_MODEL } from './utils/llmUtils.js';

const router = express.Router();

// The python agent will send POST to /chat/completions (because it appends /chat/completions to OPENAI_BASE_URL)
router.post('/chat/completions', async (req, res) => {
    try {
        console.log('🤖 [LLM Proxy] Intercepted chat completion request from AutoBrowser...');
        
        // Forward the request to OpenRouter
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        if (!openRouterKey) {
            throw new Error('OPENROUTER_API_KEY is not configured in BOQ app');
        }

        const payload = req.body;
        
        // Python agent sends model="gemini" or "openai". We translate it to our actual target model on OpenRouter.
        const targetModel = process.env.GOOGLE_MODEL || OPENROUTER_MODEL || 'google/gemma-2-9b-it:free';
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
                // Allow longer timeout for the LLM
                timeout: 60000 
            }
        );

        const responseData = response.data;
        
        // Intercept the response and repair JSON in tool_calls
        if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
            const message = responseData.choices[0].message;
            if (message.tool_calls && message.tool_calls.length > 0) {
                for (let tc of message.tool_calls) {
                    if (tc.function && typeof tc.function.arguments === 'string') {
                        const rawArgs = tc.function.arguments;
                        try {
                            console.log('🤖 [LLM Proxy] Attempting to repair tool_call arguments...');
                            // Try to parse using our robust parser
                            const repairedJson = safeParseJSON(rawArgs);
                            // Serialize back to clean string without markdown
                            tc.function.arguments = JSON.stringify(repairedJson);
                            console.log('✅ [LLM Proxy] Successfully repaired JSON arguments!');
                        } catch (repairErr) {
                            console.warn('⚠️ [LLM Proxy] Failed to repair JSON arguments, passing raw:', repairErr.message);
                        }
                    }
                }
            } else if (typeof message.content === 'string' && message.content.includes('```json')) {
                // Sometimes the model puts the tool call in the content instead of tool_calls, though openai_adapter might reject it anyway
                console.log('🤖 [LLM Proxy] Found JSON in content, leaving as is since python adapter expects tool_calls...');
            }
        }

        res.status(200).json(responseData);
    } catch (error) {
        console.error('❌ [LLM Proxy Error]:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'LLM Proxy failed' });
    }
});

export default router;
