import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeProducts } from '../utils/normalizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRANDS_DIR = path.join(__dirname, '../data/brands');

async function bulkNormalize() {
    console.log('🚀 Starting Bulk Normalization...');
    
    try {
        const files = await fs.readdir(BRANDS_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        
        console.log(`Found ${jsonFiles.length} brand files.`);
        
        for (const file of jsonFiles) {
            const filePath = path.join(BRANDS_DIR, file);
            console.log(`Processing ${file}...`);
            
            try {
                const content = await fs.readFile(filePath, 'utf8');
                const brand = JSON.parse(content);
                
                if (!brand.products || !Array.isArray(brand.products)) {
                    console.warn(`⚠️  Skip ${file}: No products array found.`);
                    continue;
                }
                
                const originalCount = brand.products.length;
                brand.products = normalizeProducts(brand.products);
                
                // Also ensure basic brand fields are present if possible
                if (!brand.budgetTier) {
                    if (file.includes('budgetary')) brand.budgetTier = 'budgetary';
                    else if (file.includes('mid')) brand.budgetTier = 'mid';
                    else if (file.includes('high')) brand.budgetTier = 'high';
                    else brand.budgetTier = 'mid';
                }

                await fs.writeFile(filePath, JSON.stringify(brand, null, 2));
                console.log(`✅ Normalized ${originalCount} products in ${file}`);
            } catch (err) {
                console.error(`❌ Error processing ${file}:`, err.message);
            }
        }
        
        console.log('\n✨ Bulk Normalization Complete!');
    } catch (err) {
        console.error('💥 Critical Error:', err.message);
    }
}

bulkNormalize();
