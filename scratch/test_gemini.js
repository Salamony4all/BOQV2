import 'dotenv/config';
import { getAiMatch } from '../server/utils/llmUtils.js';

async function testGeminiFree() {
    const models = [
        'gemini-1.5-flash',
        'gemini-2.0-flash-exp'
    ];
    
    console.log("🚀 Testing Gemini family with Forced FREE Key...");
    
    for (const model of models) {
        console.log(`\nTesting Gemini model: ${model}`);
        try {
            const result = await getAiMatch("Ergonomic chair", "Vitra", "high", "google", model);
            console.log(`✅ ${model} Result:`, JSON.stringify(result, null, 2));
        } catch (error) {
            console.error(`❌ ${model} Error:`, error.message);
        }
    }
}

testGeminiFree();
