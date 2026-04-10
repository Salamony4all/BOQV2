import axios from 'axios';

async function testEnrichment() {
    const payload = {
        brandName: "Vitra",
        modelName: "Panton Chair",
        budgetTier: "high"
    };

    console.log("💎 Testing Enrichment with Gemma 4...");
    try {
        // Since the server is running on 3001
        const res = await axios.post('http://localhost:3001/api/models/enrich', payload);
        console.log("✅ Enrichment Success!");
        console.log(JSON.stringify(res.data, null, 2));
    } catch (error) {
        console.error("❌ Enrichment Failed!");
        console.error(error.response?.data || error.message);
    }
}

testEnrichment();
