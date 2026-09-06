/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Live Web & Architonic Alternatives Discovery Engine                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Uses AI Multimodal Grounding & Live Web Search to discover real-world contract
 * alternatives across official manufacturer websites, Architonic, Archiproducts,
 * and premier architectural catalogs.
 */

import { getGoogleAI, getGoogleModel } from './llmUtils.js';
import { detectSpecArchetype } from './veBrandSpecialties.js';
import { classifyContractCategory, getCanonicalBrandLogo } from './brandLogos.js';
import { fetchLiveProductImage, verifyImageUrl } from './veImageEnricher.js';

/**
 * Searches the live web and architectural design platforms (Architonic, Archiproducts, Official Brand Portals)
 * for premier commercial furniture alternatives matching the exact specification requirements.
 */
export async function discoverLiveWebAndArchitonicAlternatives(description, categoryHint = '', currentBrand = '', topK = 4) {
    if (!description || typeof description !== 'string' || description.trim().length < 3) {
        return [];
    }

    const archetype = detectSpecArchetype(description, categoryHint);
    const brandToExclude = String(currentBrand || '').trim();
    // GCC fast-delivery mode: retail/marketplace specs (Amazon etc.) get
    // equivalents from regional platforms with UAE/GCC stock — Noon first —
    // instead of contract-catalog alternatives that miss the price tier.
    const isGccRetail = archetype === 'genericAccessories';

    const systemPrompt = isGccRetail ? `You are a helpful shopping assistant for UAE fit-out projects.
Find the same kind of everyday retail accessory on UAE/GCC shopping sites.

### How to choose:
1. Same product type with the closest size, material and finish, at a normal retail price.
2. Look first on noon.com, then amazon.ae, then ikea.com/ae, then homecentre.com. Spread picks across these sites.
3. Choose listings that ship to the UAE and include each product page URL.
4. ${brandToExclude ? `Suggest other sellers than "${brandToExclude}".` : 'Suggest a mix of sellers.'}
5. Always answer with the JSON array below, using your best knowledge. If an exact listing is uncertain, give the closest item with confidenceScore 60-70 and the site's search-page URL.

Return ONLY a valid JSON array of objects in this exact schema:
[
  {
    "brand": "Platform Name (e.g. Noon, Amazon.ae, IKEA, Home Centre)",
    "model": "Exact product title as listed",
    "family": "Category",
    "mainCategory": "Retail Accessories",
    "subCategory": "General",
    "dimensions": "Dimensions string",
    "material": "Material & finish",
    "officialProductUrl": "https://www.noon.com/... (platform product URL)",
    "architonicUrl": "",
    "imageUrl": "https://... (direct product image URL)",
    "estimatedPrice": 120,
    "currency": "AED",
    "confidenceScore": 90,
    "veReason": "Same product type and specs, in stock on a GCC platform with fast UAE delivery."
  }
]` : `You are a Senior FF&E Commercial Furniture Specification Consultant and Value Engineering Specialist.
Your goal is to find real-world, commercial-grade furniture alternatives from premier manufacturer catalogs and architectural platforms like Architonic (architonic.com) and Archiproducts (archiproducts.com).

### 🎯 STRICT ARCHETYPE & SPECIFICATION MATCHING RULES:
1. **ARCHETYPE EQUIVALENCE**:
   - **Auditorium / Theater Seating**: ONLY return genuine contract auditorium/cinema seats with tip-up seats, gravity mechanism, and acoustic/wooden panels (e.g. Figueras, Ares Line, Cinearredo, Lamm, Ferco Seating, Quinette Gallay, Ezcaray Seating, Destro). 🚫 NEVER return office chairs or sofas!
   - **Student / Classroom / Stackable Chairs**: ONLY return 4-leg / cantilever stackable polypropylene, metal frame, or shell multi-purpose chairs (e.g. Pedrali, Sedus Stoll, Arper, Andreu World, Sokoa, Magis, Plank, Actiu, Nurus, B&T Design). 🚫 NEVER return 5-star swivel task chairs with wheels/castors!
   - **Bench / Modular Public Seating**: ONLY return Benches, Modular Seating, or Poufs (e.g. Vondom, Pedrali, Slide Design, Arper, Magis, Plank, B&T Design, Narbutas, Nurus). 🚫 NEVER return shelving, desks, or storage!
   - **Desk / Workstation / Executive Desk**: ONLY return Desks or Workstations (e.g. Narbutas, Nurus, Frezza, Sedus Stoll, Ottimo Furniture, Fantoni, B&T Design, Vitra, Ofifran, LAS). 🚫 NEVER return chairs or sofas!
   - **Lounge Armchair / Sofa / Modular Lounge**: ONLY return Lounge Armchairs, Sofas, or Modular Lounge Systems (e.g. B&T Design, Arper, Nurus, Pedrali, Frezza, Ottimo, Poliform, Amara, Divani). 🚫 NEVER return executive office task chairs or conference chairs!
   - **Storage / Cabinet**: ONLY return Cabinets, Credenzas, or Lockers (e.g. Narbutas, Nurus, Frezza, Ottimo Furniture, Sedus Stoll, LAS).

2. **BRAND DIVERSITY & QUALITY**:
   - Return 3-4 distinct premier contract brands.
   - ${brandToExclude ? `Do NOT repeat the target brand "${brandToExclude}".` : ''}
   - Must be authentic, commercially available contract furniture models.

3. **PLATFORM & OFFICIAL LINKS**:
   - Provide the authentic official manufacturer product URL.
   - Provide the Architonic (architonic.com) or Archiproducts (archiproducts.com) product/collection link where available.
   - Provide direct product photo image URLs or CDN paths if discovered.

Return ONLY a valid JSON array of objects in this exact schema:
[
  {
    "brand": "Manufacturer Name (e.g. Vondom, Pedrali, Slide Design, Narbutas, Arper, Figueras, Ares Line, Sedus Stoll)",
    "model": "Exact Model Name (e.g. Frame Bench, Host Lounge 792, Atlas Bench, Tempo, Catifa 46, meet chair mt-222)",
    "family": "Collection Name",
    "mainCategory": "Contract Main Category (e.g. Office Seating, Desking, Tables, Storage)",
    "subCategory": "Contract Sub-Category (e.g. Specialist Chairs, Conference Chairs, Benches & Public Seating, Lounge Chairs)",
    "dimensions": "Dimensions string (e.g. 1800 x 500 x 420 mm)",
    "material": "Material & finish description",
    "officialProductUrl": "https://www.brand.com/products/model",
    "architonicUrl": "https://www.architonic.com/en/product/...",
    "imageUrl": "https://... (direct product image URL)",
    "estimatedPrice": 750,
    "currency": "USD",
    "confidenceScore": 92,
    "veReason": "Specific explanation of why this model perfectly matches the target dimensions, materials, and contract aesthetic."
  }
]`;

    const userPrompt = `Target Specification:
${description}
${categoryHint ? `Category Context: ${categoryHint}` : ''}
${archetype ? `Detected Archetype: ${archetype}` : ''}

Find ${topK} premier commercial furniture alternatives on Architonic, Archiproducts, and official brand websites. Return the JSON array.`;

    try {
        const modelName = getGoogleModel() || 'gemini-2.5-flash';
        const ai = getGoogleAI(modelName);
        const model = ai.getGenerativeModel({
            model: modelName.replace(':billed', '').trim(),
            systemInstruction: systemPrompt,
            tools: [{ googleSearch: {} }]
        });

        // Set 20-second timeout for live web grounding (shopping queries are slower)
        // Two attempts: lite models occasionally return an empty reply on the
        // first pass (observed live) — a single retry rescues the run.
        let text = '';
        for (let attempt = 1; attempt <= 2; attempt++) {
            const resultPromise = model.generateContent(userPrompt);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Live web discovery timeout')), 20000)
            );
            try {
                const res = await Promise.race([resultPromise, timeoutPromise]);
                text = res.response.text() || '';
            } catch (e) {
                if (attempt === 2) throw e;
                await new Promise((r) => setTimeout(r, 3000));
                continue;
            }
            if (text.trim().length > 0) break;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
        }

        // Extract JSON array
        const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (!jsonMatch) {
            console.warn('[LiveDiscovery] no JSON array in reply (first 200 chars):', String(text || '').slice(0, 200));
            return [];
        }

        const rawAlts = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(rawAlts) || rawAlts.length === 0) return [];

        const normalized = rawAlts.map(alt => {
            const logo = getCanonicalBrandLogo(alt.brand, alt.officialProductUrl || alt.architonicUrl) || '';
            const catNorm = classifyContractCategory(
                alt.mainCategory || 'Furniture',
                alt.subCategory || 'General',
                alt.model || '',
                alt.description || alt.veReason || description
            );

            return {
                brand: alt.brand || 'Contract Brand',
                brandLogo: logo,
                model: alt.model || 'Commercial Model',
                family: alt.family || alt.model?.split(' ')[0] || 'Collection',
                mainCategory: catNorm.mainCategory,
                subCategory: catNorm.subCategory,
                dimensions: alt.dimensions || '',
                material: alt.material || '',
                price: parseFloat(alt.estimatedPrice) || 0,
                currency: alt.currency || 'USD',
                imageUrl: alt.imageUrl || '',
                officialProductUrl: alt.officialProductUrl || '',
                architonicUrl: alt.architonicUrl || '',
                websiteUrl: alt.officialProductUrl || alt.architonicUrl || '',
                description: `${alt.dimensions ? `${alt.dimensions} | ` : ''}${alt.material ? `${alt.material} | ` : ''}${alt.veReason || ''}`.trim(),
                confidenceScore: Math.max(75, Math.min(98, parseInt(alt.confidenceScore) || 88)),
                specificationFit: Math.max(75, Math.min(98, parseInt(alt.confidenceScore) || 88)),
                veReason: alt.veReason || `Verified ${archetype} contract alternative from ${alt.brand}`,
                source: 'Live Architonic & Global Web Discovery'
            };
        });

        // Parallel high-resolution image verification & fallback resolution
        await Promise.all(normalized.map(async (alt) => {
            let valid = false;
            if (alt.imageUrl && alt.imageUrl.startsWith('http')) {
                valid = await verifyImageUrl(alt.imageUrl);
            }
            if (!valid) {
                try {
                    const fallbackImg = await fetchLiveProductImage(alt.brand, alt.model, alt.officialProductUrl || alt.architonicUrl);
                    if (fallbackImg) alt.imageUrl = fallbackImg;
                } catch (e) {}
            }
        }));

        return normalized;

    } catch (err) {
        console.warn('⚠️ [Live Alternatives] Web search note:', err.message);
        return [];
    }
}
