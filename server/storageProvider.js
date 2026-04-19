import { 
    supabase, 
    getSupabaseBrands, 
    saveSupabaseBrand, 
    uploadToSupabase, 
    listSupabaseFiles, 
    deleteFromSupabase 
} from './utils/supabaseStorage.js';
import axios from 'axios';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isVercel = process.env.VERCEL === '1';


// Support multiple Vercel environment naming conventions
const KV_URL = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_TOKEN;

// Health states
let isBlobHealthy = true;

// Initialize KV client
let kv = null;
if (KV_URL && KV_TOKEN) {
    try {
        kv = createKvClient({ url: KV_URL, token: KV_TOKEN });
        console.log('✅ [StorageProvider] KV client initialized.');
    } catch (err) {
        console.error('❌ [StorageProvider] Failed to initialize KV:', err.message);
    }
}

async function getLocalBrands() {
    // Try multiple possible paths where Vercel/Node might place the data
    const possiblePaths = [
        isVercel ? '/tmp/data/brands' : path.join(process.cwd(), 'server/data/brands'),
        path.join(process.cwd(), 'server/data/brands'),
        path.join(__dirname, 'data/brands'),
        '/var/task/server/data/brands'
    ];

    const allBrands = [];
    const seenIds = new Set();

    for (const brandsPath of possiblePaths) {
        try {
            console.log(`🔍 [Storage] Checking path: ${brandsPath}`);
            const files = await fs.readdir(brandsPath);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            if (jsonFiles.length > 0) {
                console.log(`✅ [Storage] Found ${jsonFiles.length} JSON files in ${brandsPath}`);
                const brands = await Promise.all(jsonFiles.map(async file => {
                    const fullPath = path.join(brandsPath, file);
                    try {
                        const content = await fs.readFile(fullPath, 'utf8');
                        const parsed = JSON.parse(content);
                        if (!parsed.id) {
                            console.warn(`⚠️ [Storage] Missing brand.id in ${file}`);
                        }
                        return parsed;
                    } catch (e) { 
                        console.error(`❌ [Storage] Error reading/parsing ${fullPath}:`, e.message);
                        return null; 
                    }
                }));

                for (const brand of brands) {
                    if (brand && brand.id) {
                        const brandIdStr = String(brand.id);
                        if (!seenIds.has(brandIdStr)) {
                            seenIds.add(brandIdStr);
                            allBrands.push(brand);
                        }
                    }
                }
            }
        } catch (e) { 
            console.log(`ℹ️ [Storage] Path not found or inaccessible: ${brandsPath}`);
        }
    }
    console.log(`📊 [Storage] Final Local Brand Count: ${allBrands.length}`);
    return allBrands;
}

export const brandStorage = {
    async getAllBrands() {
        // Master list
        const brandMap = new Map();

        // 1. Supabase - Top Priority "Source of Truth"
        if (supabase) {
            try {
                const supabaseBrands = await getSupabaseBrands();
                supabaseBrands.forEach(b => {
                    if (b && (b.id || b.name)) {
                        // Ensure products is parsed if it's stored as JSON string (though Supabase usually handles JSON columns)
                        const brandObj = {
                            ...b,
                            id: b.id || Date.now(),
                            origin: b.source || 'Supabase',
                            products: Array.isArray(b.products) ? b.products : []
                        };
                        brandMap.set(String(brandObj.id), brandObj);
                    }
                });
                if (supabaseBrands.length > 0) {
                    console.log(`✅ [Storage] Loaded ${supabaseBrands.length} brands from Supabase.`);
                }
            } catch (e) {
                console.error('❌ [Storage] Supabase load failed:', e.message);
            }
        }

        // 2. Load Local Brands (Filesystem / Tmp) - Fallback/Migration Layer
        const localBrands = await getLocalBrands();
        localBrands.forEach(b => {
            const id = String(b.id);
            if (!brandMap.has(id)) {
                brandMap.set(id, b);
            }
        });


        return Array.from(brandMap.values());
    },

    async getBrandById(brandId) {
        // Fast path for KV
        if (kv) {
            try {
                const brand = await kv.get(`brand:${brandId}`);
                if (brand) return brand;
            } catch (error) { /* fallback */ }
        }

        // Otherwise use the full load (handles Blob + Local merging)
        const brands = await this.getAllBrands();
        return brands.find(b => String(b.id) === String(brandId));
    },

    async saveBrand(brand) {
        // 1. Supabase Save (Success here is primary completion)
        if (supabase) {
            try {
                const ok = await saveSupabaseBrand(brand);
                if (ok) console.log(`✅ [Storage] Saved brand "${brand.name}" to Supabase.`);
                // We still fall back to local/blob for extra redundancy if desired, 
                // but if Supabase is our "new logic", we rely on it.
            } catch (err) {
                console.error(`❌ [Storage] Supabase save failed:`, err.message);
            }
        }

        // 2. KV Redundancy
        if (kv) {
            try {
                await kv.set(`brand:${brand.id}`, brand);
            } catch (error) { /* continue */ }
        }


        // Local / Try-Hard Strategy
        try {
            const baseDir = isVercel ? '/tmp/data/brands' : path.join(__dirname, 'data/brands');
            const sanitizedName = brand.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const filename = `${sanitizedName}-${brand.budgetTier || 'mid'}.json`;

            await fs.mkdir(baseDir, { recursive: true });
            const filePath = path.join(baseDir, filename);
            await fs.writeFile(filePath, JSON.stringify(brand, null, 2));
            console.log(`💾 [Storage] Successfully saved brand ${brand.name} to ${filePath}`);

            // MASTER DATABASE PERSISTENCE (DISABLED to use standalone brand databases)
            /*
            try {
              let masterDb = { products: [] };
              try {
                const data = await fs.readFile(MASTER_DB_PATH, 'utf8');
                masterDb = JSON.parse(data);
              } catch (e) { }

              // Merge products
              (brand.products || []).forEach(p => {
                const exists = masterDb.products.some(mp => mp.model === p.model && mp.family === p.family);
                if (!exists) masterDb.products.push({ ...p, brandId: brand.id, brandName: brand.name });
              });

              await fs.mkdir(path.dirname(MASTER_DB_PATH), { recursive: true });
              await fs.writeFile(MASTER_DB_PATH, JSON.stringify(masterDb, null, 2));
              console.log(`✅ [Storage] Master DB updated with ${brand.products?.length || 0} products from ${brand.name}`);
            } catch (e) { console.error('[Storage] Master DB save failed:', e.message); }
            */

            return true;
        } catch (error) {
            console.error('[Storage] Filesystem save failed:', error);
            return false;
        }
    },

    async addProductToBrand(brandName, budgetTier, product) {
        const brands = await this.getAllBrands();
        // Case-insensitive match for name and tier
        const targetBrand = brands.find(b => 
            b.name.toLowerCase().trim() === brandName.toLowerCase().trim() && 
            (b.budgetTier || 'mid').toLowerCase() === budgetTier.toLowerCase()
        );

        if (!targetBrand) {
            console.warn(`⚠️ [Storage] Brand ${brandName} (${budgetTier}) not found for hardening.`);
            return false;
        }

        // Initialize products array if missing
        if (!targetBrand.products) targetBrand.products = [];

        // Check if product already exists (by model name/number)
        const exists = targetBrand.products.some(p => 
            String(p.model).toLowerCase().trim() === String(product.model).toLowerCase().trim()
        );

        if (exists) {
            console.log(`ℹ️ [Storage] Product "${product.model}" already exists in ${brandName}. Skipping hardening.`);
            return true; 
        }

        // Append new product with metadata, cleaning up AI internal fields
        const { status, logic, error_message, ...cleanProduct } = product;
        targetBrand.products.push({
            ...cleanProduct,
            lastUpdated: new Date().toISOString(),
            source: 'AI-Specialist-Discovery'
        });

        console.log(`💎 [Storage] Hardening ${brandName}: Added "${product.model}"`);
        return await this.saveBrand(targetBrand);
    },

    async deleteBrand(brandId) {
        // 1. Supabase Delete
        if (supabase) {
            try {
                const { error } = await supabase.from('brands').delete().eq('id', brandId);
                if (error) console.error('Supabase delete error', error);
                else console.log(`✅ [Storage] Deleted brand ${brandId} from Supabase.`);
            } catch (err) {}
        }

        if (kv) {
            try {
                await kv.del(`brand:${brandId}`);
            } catch (error) { }
        }


        // Local Delete
        try {
            const baseDir = isVercel ? '/tmp/data/brands' : path.join(__dirname, 'data/brands');
            try { await fs.access(baseDir); } catch { return false; }

            const files = await fs.readdir(baseDir);
            for (const file of files) {
                const fullPath = path.join(baseDir, file);
                const content = await fs.readFile(fullPath, 'utf8');
                const data = JSON.parse(content);
                if (String(data.id) === String(brandId)) {
                    await fs.unlink(fullPath);
                    return true;
                }
            }
            return false;
        } catch (error) { return false; }
    }
};
