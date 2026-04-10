import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";

async function listModels() {
    const key = process.env.GOOGLE_FREE_KEY || process.env.GEMINI_FREE_KEY || process.env.GEMINI_API_KEY_FREE || process.env.GEMINI_API_KEY;
    
    console.log("🔍 Listing available models for Google Free Key...");
    if (!key) {
        console.error("❌ No Free Key found in .env!");
        return;
    }

    const genAI = new GoogleGenerativeAI(key);
    
    try {
        // The listModels method might not be directly on the client in the current version, 
        // sometimes you have to use a specific endpoint or just try common names.
        // Actually, the SDK has a way.
        
        // Let's try the fetch approach if the SDK method is unclear, 
        // but Google SDK usually has a listModels capability.
        // Actually, it's often better to check the documentation or just try!
        
        // For Google AI Studio, the endpoint is:
        // https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const data = await response.json();
        
        if (data.models) {
            console.log("\n✅ Available Models:");
            data.models.forEach(m => {
                const name = m.name.replace('models/', '');
                const support = m.supportedGenerationMethods.join(', ');
                console.log(`- ${name.padEnd(30)} [${support}]`);
            });
        } else {
            console.log("❌ No models returned or error in response.");
            console.log(JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.error("❌ Failed to list models:");
        console.error(error.message);
    }
}

listModels();
