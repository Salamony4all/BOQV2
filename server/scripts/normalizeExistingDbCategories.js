import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyContractCategory, getCanonicalBrandLogo } from '../utils/brandLogos.js';
import { brandStorage } from '../storageProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function normalizeAllBrands() {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('🚀 NORMALIZING ALL EXISTING DATABASE BRANDS & SKUS TO 4-TIER TAXONOMY');
    console.log('═══════════════════════════════════════════════════════════════════════\n');

    const baseDir = path.join(__dirname, '../data/brands');
    const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.json'));

    const categoryStats = {};
    let totalBrands = 0;
    let totalProducts = 0;

    for (const file of files) {
        const filePath = path.join(baseDir, file);
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const brand = JSON.parse(raw);

            if (!brand.name) continue;
            totalBrands++;

            // 1. Resolve canonical brand logo if missing or generic
            if (!brand.logo || brand.logo.includes('clearbit.com') || brand.logo.includes('via.placeholder')) {
                const resolvedLogo = getCanonicalBrandLogo(brand.name, brand.websiteUrl);
                if (resolvedLogo) {
                    brand.logo = resolvedLogo;
                }
            }

            // 2. Classify and normalize all products
            if (brand.products && Array.isArray(brand.products)) {
                brand.products = brand.products.map(p => {
                    totalProducts++;
                    const norm = classifyContractCategory(
                        p.mainCategory,
                        p.subCategory,
                        p.model,
                        p.description
                    );

                    const key = `${norm.mainCategory} ➔ ${norm.subCategory}`;
                    categoryStats[key] = (categoryStats[key] || 0) + 1;

                    return {
                        ...p,
                        family: p.family || (p.model ? p.model.split(' ')[0] : 'Standard'),
                        mainCategory: norm.mainCategory,
                        subCategory: norm.subCategory
                    };
                });
            }

            // 3. Save to local disk
            fs.writeFileSync(filePath, JSON.stringify(brand, null, 2));

            // 4. Save to Supabase and remote storage
            await brandStorage.saveBrand(brand);

            console.log(`✅ [Normalized] "${brand.name}" (${brand.products ? brand.products.length : 0} products)`);
        } catch (err) {
            console.error(`❌ Error normalizing ${file}:`, err.message);
        }
    }

    console.log('\n───────────────────────────────────────────────────────────────────────');
    console.log(`📊 NORMALIZATION SUMMARY: ${totalBrands} Brands, ${totalProducts} Products`);
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('Category Tree Distribution:');
    const sortedStats = Object.entries(categoryStats).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sortedStats) {
        console.log(`  📂 ${cat.padEnd(45)} : ${count} items`);
    }
    console.log('═══════════════════════════════════════════════════════════════════════\n');
}

normalizeAllBrands().catch(console.error);
