import axios from 'axios';

/**
 * Shared utility for calling LLM via OpenRouter or NVIDIA NIM.
 * Supported config via environment variables:
 * - AI_PROVIDER: 'openrouter' (default) or 'nvidia'
 * - AI_MODEL: model name (e.g. google/gemini-2.0-flash-exp:free)
 * - AI_TIMEOUT_MS: default 60000
 * - OPENROUTER_API_KEY or NVIDIA_API_KEY
 */
export async function callLlm(prompt, options = {}) {
  const provider = (process.env.AI_PROVIDER || 'openrouter').toLowerCase().trim();
  const apiKey = (process.env.OPENROUTER_API_KEY || process.env.NVIDIA_API_KEY || '').trim();
  const model = options.model || (process.env.AI_MODEL || 'google/gemini-2.0-flash-exp:free').trim();
  const timeoutMs = options.timeout || parseInt(process.env.AI_TIMEOUT_MS) || 60000;

  const baseUrl = provider === 'nvidia' 
    ? 'https://integrate.api.nvidia.com/v1/chat/completions' 
    : 'https://openrouter.ai/api/v1/chat/completions';

  if (!apiKey) throw new Error(`${provider.toUpperCase()}_API_KEY not configured`);

  try {
    const response = await axios.post(baseUrl, {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature || 0.1,
      max_tokens: options.max_tokens || 1024
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'BOQFLOW'
      },
      timeout: timeoutMs
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    throw new Error(`LLM Error [${status}] at ${baseUrl} (${model}): ${JSON.stringify(data || error.message)}`);
  }
}
