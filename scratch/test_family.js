import 'dotenv/config';
import { getAiMatch } from '../server/utils/llmUtils.js';

async function testGemmaFamily() {
    const models = [
        'gemma-4-31b-it',
        'gemma-4-26b-a4b-it',
        'gemma-4-e4b-it'
    ];
    
    console.log("🚀 Testing ALL Gemma 4 family members...");
    
    // Disable force flag for this test to verify the logic inside the function
    process.env.FORCE_FREE_GOOGLE_KEY = 'false';
    
    for (const model of models) {
        console.log(`\nTesting model: ${model}`);
        try {
            await getAiMatch("Test", "Test", "low", "google", model);
            console.log(`✅ ${model} routed correctly.`);
        } catch (error) {
            console.log(`⚠️ ${model} execution failed (expected if non-existent), but check logs above for key routing.`);
        }
    }
}

testGemmaFamily();
