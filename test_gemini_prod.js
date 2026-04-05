import { identifyModel, callGoogle } from './server/utils/llmUtils.js';

async function testGrounding() {
    process.env.GOOGLE_MODEL = 'gemini-2.5-flash';
    const description = "BOBO CHAIR";
    const brand = "Ottimo Furniture";
    
    console.log(`🚀 Testing Grounded Search Identifcation...`);
    try {
        // Test 1: Direct ID
        console.log("Stage 1: Direct ID (No Search)...");
        const direct = await callGoogle("Identify model", `Identify ${brand} ${description}`, false);
        console.log("✅ Stage 1 OK:", direct.model);

        // Test 2: Grounded ID
        console.log("Stage 2: Grounded ID (Live Search)...");
        const grounded = await identifyModel(description, brand);
        console.log("✅ Stage 2 OK:", grounded.model);

    } catch (err) {
        console.error("❌ Infrastructure Failure:", err.message);
    }
}

testGrounding();
