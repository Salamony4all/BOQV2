import { classifyFurnishingCategory } from '../utils/veCategoryPriority.js';
import { detectSpecArchetype } from '../utils/veBrandSpecialties.js';
import { generateCrossBrandAlternatives, generateCrossBrandAlternativesAsync } from '../utils/veAutoDetectUtils.js';
import { brandStorage } from '../storageProvider.js';

async function run() {
    console.log('Testing LF-008 classification and matching...\n');

    const desc = 'A-8 | LF-008 | Round Chair ( Foldable) Creative Market | No.s | ROUND FOLDABLE CHAIR | Round Foldable Chair with X-shape Legs and Handle to carry. | Dia – 300 x 450 mm ht. | Black Metal & Plastic. All finishes to approval. | Fahmy Furniture / KR Furniture / Al Jassar or similar | 13';

    const category = classifyFurnishingCategory(desc);
    console.log('1. Furnishing Category:', category);

    const archetype = detectSpecArchetype(desc);
    console.log('2. Detected Archetype:', archetype);

    const brands = await brandStorage.getAllBrands();
    console.log(`3. Loaded ${brands.length} local brand catalogs.`);

    const ottimo = brands.find(b => b.name && b.name.toLowerCase().includes('ottimo'));
    if (ottimo) {
        console.log(`Ottimo ID: ${ottimo.id}, Products count: ${ottimo.products.length}`);
        const fold = (ottimo.products || []).filter(p => (p.model || '').toLowerCase().includes('fold'));
        console.log('Ottimo folding products:', fold);
    }

    const alts = generateCrossBrandAlternatives('Generic', 'Round Foldable Stool', desc, brands, category, 4);
    console.log('4. Local Alternatives Found:', alts.length);
    alts.forEach((a, i) => {
        console.log(`  [${i + 1}] ${a.brand} - ${a.model} (${a.confidenceScore}% Fit, USD ${a.price})`);
        console.log(`      Archetype: ${a.mainCategory} -> ${a.subCategory}`);
        console.log(`      Image: ${a.imageUrl}`);
    });
}

run().catch(console.error);
