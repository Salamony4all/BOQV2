import 'dotenv/config';
import { brandStorage } from '../storageProvider.js';
import { veMatchAuto } from '../utils/veAutoDetectUtils.js';
import { VE_CATEGORY_CONFIG, classifyFurnishingCategory, isGenuineContractBrand, findBrandInCatalog, NON_BRAND_MODEL_WORDS } from '../utils/veCategoryPriority.js';
import { findSemanticMatches } from '../embeddingService.js';

async function testItem() {
  const desc = '2-SEATER RECEPTION WAITING SOFA WITH SOLID WOOD FRAME AND HIGH DENSITY FOAM (ROMA), FAR EAST | Qty: 2, Unit: No.';
  const allBrands = await brandStorage.getAllBrands();
  const availableBrandNames = allBrands.filter(b => b.name && !b.name.toLowerCase().includes('fitout')).map(b => b.name);

  console.log('1. Calling veMatchAuto...');
  const identityResult = await veMatchAuto(desc, null, [], availableBrandNames);
  console.log('Identity result:', identityResult);

  const furnishingCat = classifyFurnishingCategory(desc);
  console.log('Classified category:', furnishingCat);

  const catConfig = VE_CATEGORY_CONFIG[furnishingCat];
  console.log('Priority Sequence:', catConfig.priorityBrands);

  for (const bName of catConfig.priorityBrands) {
    const b = findBrandInCatalog(bName, allBrands);
    if (!b) {
      console.log(`Brand ${bName} NOT found in catalog!`);
      continue;
    }
    console.log(`Brand ${bName} found with ${b.products?.length} products.`);
    const hits = await findSemanticMatches({
      description: desc,
      brandName: b.name,
      products: b.products,
      category: 'Soft Furniture',
      topK: 3
    });
    console.log(`Semantic hits for ${b.name}:`, hits.map(h => ({ model: h.model, score: h.confidenceScore })));
  }
}

testItem();
