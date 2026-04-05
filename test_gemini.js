import { identifyModel } from './server/utils/llmUtils.js';

async function test() {
    process.env.GOOGLE_MODEL = 'gemini-1.5-flash';
    const description = "OFFICE CHAIR";
    const brand = "Ottimo Furniture";
    
    console.log(`🚀 Testing gemini-1.5-flash with: "${description}" by ${brand}...`);
    try {
        const result = await identifyModel(description, brand);
        console.log("✅ AI Result:", JSON.stringify(result, null, 2));
    } catch (err) {
        console.error("❌ Test Failed:", err.message);
    }
}

test();
