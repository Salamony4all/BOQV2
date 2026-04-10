import 'dotenv/config';
import { getAiMatch, VALID_GOOGLE_MODELS } from '../server/utils/llmUtils.js';

async function testGemma() {
    const description = "Ergonomic office chair with lumbar support";
    const brand = "Herman Miller";
    const tier = "high";
    
    console.log("🚀 Testing Gemma 4 family with Forced Free Key...");
    console.log(`Current GOOGLE_MODEL: ${process.env.GOOGLE_MODEL}`);
    console.log(`FORCE_FREE_GOOGLE_KEY: ${process.env.FORCE_FREE_GOOGLE_KEY}`);
    
    try {
        const result = await getAiMatch(description, brand, tier, 'google');
        console.log("✅ Success!");
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("❌ Failed!");
        console.error(error.message);
    }
}

testGemma();
