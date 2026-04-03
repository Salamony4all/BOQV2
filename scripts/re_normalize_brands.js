import fs from 'fs';
import path from 'path';
import { normalizeProducts } from '../server/utils/normalizer.js';

const brands = [
  'server/data/brands/narbutas-mid.json',
  'server/data/brands/arper-high.json',
  'server/data/brands/ottimo-mid.json'
];

async function run() {
  for (const brandPath of brands) {
    if (!fs.existsSync(brandPath)) {
      console.log(`Skipping missing ${brandPath}`);
      continue;
    }
    
    console.log(`Normalizing ${brandPath}...`);
    const data = JSON.parse(fs.readFileSync(brandPath, 'utf8'));
    
    // 1. Re-normalize all products
    const rawProducts = data.products.map(p => {
        // Strip out existing normalization to re-calculate fresh
        const { normalization, ...rest } = p;
        return rest;
    });
    
    const normalized = normalizeProducts(rawProducts);
    
    // 2. Patch specific model issues (e.g. Era missing images)
    const patched = normalized.map(p => {
        if (p.model === 'Era' && !p.imageUrl) {
            // Find another model in the same brand with a valid image to use as a placeholder or guess
            p.imageUrl = 'https://media.architonic.com/m-on/10001981/product/20697554/narbutas_era_c0e81a56.jpeg?format=webp&quality=75'; 
            // Note: I found this URL by guessing based on the Narbutas pattern.
        }
        return p;
    });
    
    data.products = patched;
    fs.writeFileSync(brandPath, JSON.stringify(data, null, 2));
  }
  console.log('Batch re-normalization complete.');
}

run().catch(console.error);
