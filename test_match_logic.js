
import axios from 'axios';

const KEY = "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";

const TEST_PROMPT = `
Identify the category and suggest 3 high-quality product models for this BOQ description:
"Executive Leather Chair with tilt and adjustable arms for CEO office"

Return JSON format:
{
  "category": "...",
  "products": ["Model 1", "Model 2", "Model 3"]
}
`;

async function testNvidiaMatch() {
  console.log("Testing NVIDIA via OpenRouter for BOQ Matching...");
  try {
    const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: "nvidia/llama-3.1-405b-instruct", // High-end model for quality testing
      messages: [{ role: "user", content: TEST_PROMPT }],
      response_format: { type: "json_object" }
    }, {
      headers: { 
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'BOQFLOW Test'
      },
      timeout: 20000
    });
    
    const content = res.data.choices[0].message.content;
    console.log("✅ Analysis Result:", JSON.parse(content));
    return true;
  } catch (e) {
    console.log("❌ Failed:", e.response?.data || e.message);
    return false;
  }
}

testNvidiaMatch();
