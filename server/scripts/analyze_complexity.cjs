
const fs = require('fs');
const path = require('path');

const BRANDS_DIR = 'c:/Users/Mohamad60025/Desktop/App/BOQ - v2/server/data/brands';

async function analyze() {
  const files = fs.readdirSync(BRANDS_DIR).filter(f => f.endsWith('.json'));
  const results = [];

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(BRANDS_DIR, file), 'utf8'));
    const products = data.products || [];
    
    const subCategories = new Set(products.map(p => p.normalization?.subCategory || p.subCategory));
    const mainCategories = new Set(products.map(p => p.normalization?.category || p.mainCategory));
    const families = new Set(products.map(p => p.family));
    
    results.push({
      brand: data.name,
      file: file,
      productCount: products.length,
      subCatCount: subCategories.size,
      mainCatCount: mainCategories.size,
      familyCount: families.size,
      complexityScore: subCategories.size + families.size + (products.length / 100)
    });
  }

  results.sort((a, b) => b.complexityScore - a.complexityScore);
  console.log(JSON.stringify(results.slice(0, 5), null, 2));
}

analyze().catch(console.error);
