import {
    supabase,
    supabaseAdmin,
    getSupabaseBrands,
    saveSupabaseBrand,
    uploadToSupabase,
    listSupabaseFiles,
    deleteFromSupabase
} from './utils/supabaseStorage.js';
import { createClient as createKvClient } from '@vercel/kv';
import axios from 'axios';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isVercel = process.env.VERCEL === '1';

// In-memory tombstone set — tracks IDs deleted during this server lifetime
// Prevents deleted brands from reappearing via stale local filesystem JSON files
const deletedBrandIds = new Set();


// Support multiple Vercel environment naming conventions
const KV_URL = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_TOKEN;

// Health states
let isBlobHealthy = true;

// Initialize KV client
export let kv = null;
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
        path.join(process.cwd(), 'server/data/brands'),
        path.join(__dirname, 'data/brands'),
        '/var/task/server/data/brands',
        '/tmp/data/brands'
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


        // 3. Filter out any brands that were deleted during this server lifetime
        if (deletedBrandIds.size > 0) {
            for (const [id] of brandMap) {
                if (deletedBrandIds.has(id)) brandMap.delete(id);
            }
        }

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
        // Integrity check: prevent saving corrupted or incomplete brand objects
        if (!brand || !brand.id || !brand.name) {
            console.error('❌ [Storage] Rejecting save: Brand object is missing critical identity fields (id or name).', brand);
            return false;
        }

        // 1. Supabase Save (Success here is primary completion)
        if (supabase) {
            try {
                const ok = await saveSupabaseBrand(brand);
                if (ok) {
                    console.log(`✅ [Storage] Saved brand "${brand.name}" to Supabase.`);
                } else {
                    console.error(`❌ [Storage] Supabase save returned false for "${brand.name}".`);
                    return false; // Stop if primary storage fails
                }
            } catch (err) {
                console.error(`❌ [Storage] Supabase save exception:`, err.message);
                return false;
            }
        }

        // 2. KV Redundancy
        if (kv) {
            try {
                await kv.set(`brand:${brand.id}`, brand);
            } catch (error) { /* continue */ }
        }

        // 3. Railway Persistent Volume Replication
        const scraperUrl = process.env.JS_SCRAPER_SERVICE_URL;
        if (scraperUrl) {
            try {
                const sanitizedName = brand.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const filename = `${sanitizedName}-${brand.budgetTier || 'mid'}.json`;
                
                console.log(`☁️ [Storage] Replicating brand "${brand.name}" to Railway persistent volume...`);
                await axios.post(`${scraperUrl}/brands/upload`, JSON.stringify(brand, null, 2), {
                    headers: {
                        'Content-Type': 'text/plain',
                        'X-Filename': filename
                    },
                    timeout: 10000
                });
                console.log(`✅ [Storage] Successfully backed up brand "${brand.name}" to Railway volume.`);
            } catch (err) {
                console.warn(`⚠️ [Storage] Railway volume replication warning:`, err.message);
            }
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
        let actualCloudDeletionSuccess = false;

        // Mark as deleted immediately so getAllBrands filters it out
        deletedBrandIds.add(String(brandId));

        // 1. Supabase Delete — use admin client (service role) to bypass RLS
        const deleteClient = supabaseAdmin || supabase;
        if (deleteClient) {
            try {
                const { data, error } = await deleteClient
                    .from('brands')
                    .delete()
                    .eq('id', String(brandId))
                    .select();

                if (error) {
                    console.error('❌ [Storage] Supabase backend deletion call returned error:', error.message);
                } else if (data && data.length > 0) {
                    console.log(`✅ [Storage] Brand safely extracted and killed in Supabase for ID: ${brandId}`);
                    actualCloudDeletionSuccess = true;
                } else {
                    console.warn(`⚠️ [Storage] Supabase table returned status 200, but ZERO matching items matched target ID: ${brandId}`);
                }
            } catch (err) {
                console.error('❌ [Storage] Supabase cross-network context error:', err.message);
            }
        }

        if (kv) {
            try {
                await kv.del(`brand:${brandId}`);
            } catch (error) { }
        }

        // Local /tmp and base fallback cache validation purge loop
        try {
            const workspacePaths = [
                isVercel ? '/tmp/data/brands' : path.join(process.cwd(), 'server/data/brands'),
                path.join(process.cwd(), 'server/data/brands'),
                path.join(__dirname, 'data/brands')
            ];

            for (const baseDir of workspacePaths) {
                try {
                    const files = await fs.readdir(baseDir);
                    for (const file of files) {
                        if (!file.endsWith('.json')) continue;
                        const fullPath = path.join(baseDir, file);
                        const content = await fs.readFile(fullPath, 'utf8');
                        const data = JSON.parse(content);

                        if (String(data.id) === String(brandId)) {
                            await fs.unlink(fullPath);
                            console.log(`🗑️ [Storage] Erased local cache database tracker file to protect runtime consistency: ${fullPath}`);
                        }
                    }
                } catch (e) { /* Segment path inaccessible, skipped safely */ }
            }
            return actualCloudDeletionSuccess;
        } catch (error) {
            return actualCloudDeletionSuccess;
        }
    }
};