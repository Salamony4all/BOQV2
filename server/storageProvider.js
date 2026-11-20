import {
    supabase,
    supabaseAdmin,
    getSupabaseBrands,
    saveSupabaseBrand,
    uploadToSupabase,
    listSupabaseFiles,
    deleteFromSupabase
} from './utils/supabaseStorage.js';
import { classifyContractCategory, getCanonicalBrandLogo, resolveBrandLogo } from './utils/brandLogos.js';
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

// Non-persistent marketplace brands (evaluated on-the-fly without saving DB files)
export const NO_PERSIST_BRANDS = new Set([
    'amazon', 'amazon uae', 'amazon us', 'amazon.com', 'amazon basics',
    'noon', 'desertcart', 'ubuy', 'marketplace', 'homedepot', 'home depot', 'ikea', 'retail'
]);

export const VIRTUAL_MARKETPLACE_BRANDS = [
    {
        id: 'virtual-amazon',
        name: 'Amazon',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg',
        budgetTier: 'budget',
        origin: 'Global Marketplace (On-the-fly)',
        isVirtual: true,
        products: []
    }
];


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
                        if (!parsed.id && parsed.name) {
                            parsed.id = parsed.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                        } else if (!parsed.id) {
                            parsed.id = file.replace('.json', '');
                        }
                        return parsed;
                    } catch (e) {
                        console.error(`❌ [Storage] Error reading/parsing ${fullPath}:`, e.message);
                        return null;
                    }
                }));

                for (const brand of brands) {
                    if (brand && (brand.id || brand.name)) {
                        const brandIdStr = String(brand.id || brand.name);
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

let cachedBrands = null;
let lastBrandCacheTime = 0;
let inflightBrandsPromise = null;
let lastSupabaseBrandsSnapshot = [];
const BRAND_CACHE_TTL_MS = 180000; // 3 minutes in-memory cache

export const brandStorage = {
    invalidateCache() {
        cachedBrands = null;
        lastBrandCacheTime = 0;
        inflightBrandsPromise = null;
    },

    async getAllBrands(forceRefresh = false) {
        if (cachedBrands && !forceRefresh && (Date.now() - lastBrandCacheTime < BRAND_CACHE_TTL_MS)) {
            return cachedBrands;
        }
        if (inflightBrandsPromise && !forceRefresh) {
            return inflightBrandsPromise;
        }

        const loadPromise = (async () => {
        // Master list
        const brandMap = new Map();

        // 1. Supabase - Top Priority "Source of Truth" with 5s timeout + last-known snapshot fallback
        if (supabase) {
            try {
                const supabasePromise = getSupabaseBrands();
                const timeoutPromise = new Promise(resolve => setTimeout(() => resolve([]), 5000));
                let supabaseBrands = await Promise.race([supabasePromise, timeoutPromise]);

                if (Array.isArray(supabaseBrands) && supabaseBrands.length > 0) {
                    lastSupabaseBrandsSnapshot = supabaseBrands;
                    console.log(`✅ [Storage] Loaded ${supabaseBrands.length} brands from Supabase.`);
                } else if (lastSupabaseBrandsSnapshot.length > 0) {
                    supabaseBrands = lastSupabaseBrandsSnapshot;
                    console.warn(`⚠️ [Storage] Supabase timed out/empty — preserving ${supabaseBrands.length} cached Supabase brands.`);
                }

                supabaseBrands.forEach(b => {
                    if (b && (b.id || b.name)) {
                        const brandObj = {
                            ...b,
                            id: b.id || Date.now(),
                            origin: b.source || 'Supabase',
                            products: Array.isArray(b.products) ? b.products : []
                        };
                        brandMap.set(String(brandObj.id), brandObj);
                    }
                });
            } catch (e) {
                console.error('❌ [Storage] Supabase load failed:', e.message);
                if (lastSupabaseBrandsSnapshot.length > 0) {
                    lastSupabaseBrandsSnapshot.forEach(b => {
                        if (b && (b.id || b.name)) {
                            const brandObj = {
                                ...b,
                                id: b.id || Date.now(),
                                origin: b.source || 'Supabase',
                                products: Array.isArray(b.products) ? b.products : []
                            };
                            brandMap.set(String(brandObj.id), brandObj);
                        }
                    });
                    console.warn(`⚠️ [Storage] Reused ${lastSupabaseBrandsSnapshot.length} cached Supabase brands after error.`);
                }
            }
        }

        // 2. Load Local Brands (Filesystem / Tmp) - Fallback/Migration Layer
        const localBrands = await getLocalBrands();
        localBrands.forEach(b => {
            const id = String(b.id);
            if (!brandMap.has(id)) {
                brandMap.set(id, b);
            } else {
                // Merge local products with remote products for highest fidelity
                const existing = brandMap.get(id);
                const existingProducts = existing.products || [];
                const localProds = b.products || [];
                const mergedProducts = [...localProds];
                const seenModels = new Set(localProds.map(p => (p.model || '').toLowerCase().trim()));
                for (const ep of existingProducts) {
                    const mNorm = (ep.model || '').toLowerCase().trim();
                    if (!seenModels.has(mNorm)) {
                        seenModels.add(mNorm);
                        mergedProducts.push(ep);
                    }
                }
                existing.products = mergedProducts;
            }
        });

        // 2b. Heal stale/mangled brand logos and build dynamic category trees (zero Supabase writes)
        for (const [id, brand] of brandMap) {
            brand.logo = resolveBrandLogo(brand) || brand.logo || '';
            const categoryTree = {};
            const products = Array.isArray(brand.products) ? brand.products : [];
            products.forEach(p => {
                const main = (p.mainCategory || p.category || 'General').trim() || 'General';
                const sub = (p.subCategory || p.type || '').trim();
                if (!categoryTree[main]) categoryTree[main] = [];
                if (sub && !categoryTree[main].includes(sub)) {
                    categoryTree[main].push(sub);
                }
            });
            brand.categoryTree = categoryTree;
            brand.categoryList = Object.keys(categoryTree);
        }


        // 3. Filter out any brands that were deleted during this server lifetime
        if (deletedBrandIds.size > 0) {
            for (const [id] of brandMap) {
                if (deletedBrandIds.has(id)) brandMap.delete(id);
            }
        }

        // 4. Inject Virtual Marketplace Brands (Amazon, etc.) if not already present
        for (const vBrand of VIRTUAL_MARKETPLACE_BRANDS) {
            const hasBrand = Array.from(brandMap.values()).some(
                b => b.name && b.name.toLowerCase().trim() === vBrand.name.toLowerCase().trim()
            );
            if (!hasBrand && !deletedBrandIds.has(String(vBrand.id))) {
                brandMap.set(String(vBrand.id), { ...vBrand });
            }
        }

        const finalBrands = Array.from(brandMap.values());
        cachedBrands = finalBrands;
        lastBrandCacheTime = Date.now();
        return finalBrands;
        })();

        inflightBrandsPromise = loadPromise;
        try {
            return await loadPromise;
        } finally {
            if (inflightBrandsPromise === loadPromise) {
                inflightBrandsPromise = null;
            }
        }
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

        // ⚡ Zero-Database Persistence Guard for Amazon & Marketplaces
        const brandNameLower = String(brand.name).toLowerCase().trim();
        if (brand.isVirtual || NO_PERSIST_BRANDS.has(brandNameLower) || /^(amazon|noon|desertcart|ubuy|marketplace|ikea|homedepot)/i.test(brandNameLower)) {
            console.log(`⚡ [Storage] Skipping DB & File persistence for virtual marketplace brand "${brand.name}".`);
            return true;
        }

        // 🏷️ Auto-Resolve Brand Logo if missing, Clearbit, or naive .com placeholder
        const canonicalLogo = resolveBrandLogo(brand, brand.websiteUrl);
        if (canonicalLogo) brand.logo = canonicalLogo;

        // 1. Supabase Save (Attempt if configured)
        if (supabase) {
            try {
                const ok = await saveSupabaseBrand(brand);
                if (ok) {
                    console.log(`✅ [Storage] Saved brand "${brand.name}" to Supabase.`);
                } else {
                    console.warn(`⚠️ [Storage] Supabase save returned false for "${brand.name}". Falling back to local storage.`);
                }
            } catch (err) {
                console.warn(`⚠️ [Storage] Supabase save exception for "${brand.name}":`, err.message);
            }
        }

        // 2. KV Redundancy
        if (kv) {
            try {
                await kv.set(`brand:${brand.id}`, brand);
            } catch (error) { /* continue */ }
        }

        // 3. Railway Persistent Volume Replication (async non-blocking backup)
        const scraperUrl = process.env.JS_SCRAPER_SERVICE_URL;
        if (scraperUrl) {
            const sanitizedName = brand.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const filename = `${sanitizedName}-${brand.budgetTier || 'mid'}.json`;
            axios.post(`${scraperUrl}/brands/upload`, JSON.stringify(brand, null, 2), {
                headers: {
                    'Content-Type': 'text/plain',
                    'X-Filename': filename
                },
                timeout: 10000
            }).then(() => {
                console.log(`✅ [Storage] Backed up brand "${brand.name}" to Railway volume.`);
            }).catch(err => {
                console.warn(`⚠️ [Storage] Railway volume replication warning:`, err.message);
            });
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

            this.invalidateCache();
            return true;
        } catch (error) {
            console.error('[Storage] Filesystem save failed:', error);
            return false;
        }
    },

    async addProductToBrand(brandName, budgetTier, product) {
        const brandNameLower = String(brandName || '').toLowerCase().trim();

        // ⚡ Zero-Database Persistence Guard for Amazon & Marketplaces
        if (NO_PERSIST_BRANDS.has(brandNameLower) || /^(amazon|noon|desertcart|ubuy|marketplace|ikea|homedepot)/i.test(brandNameLower)) {
            console.log(`⚡ [Storage] Skipping product DB hardening for marketplace brand "${brandName}". Evaluated dynamically on-the-fly.`);
            return true;
        }

        const brands = await this.getAllBrands();
        // Case-insensitive match for name and tier (fallback to any tier for that brand)
        const targetBrand = brands.find(b =>
            b.name.toLowerCase().trim() === brandNameLower &&
            (b.budgetTier || 'mid').toLowerCase() === (budgetTier || 'mid').toLowerCase()
        ) || brands.find(b => b.name && b.name.toLowerCase().trim() === brandNameLower);

        if (!targetBrand) {
            console.warn(`⚠️ [Storage] Brand ${brandName} (${budgetTier}) not found for hardening.`);
            return false;
        }

        // Initialize products array if missing
        if (!targetBrand.products) targetBrand.products = [];

        // Append or upgrade incomplete stub product with normalized contract taxonomy metadata
        const { status, logic, error_message, ...cleanProduct } = product;
        const norm = classifyContractCategory(
            cleanProduct.mainCategory,
            cleanProduct.subCategory,
            cleanProduct.model,
            cleanProduct.description
        );
        const preparedProduct = {
            ...cleanProduct,
            mainCategory: cleanProduct.mainCategory || norm.mainCategory,
            subCategory: cleanProduct.subCategory || norm.subCategory,
            verified: Boolean(cleanProduct.imageUrl) && cleanProduct.verified !== false && cleanProduct.source !== 'grounded-search',
            lastUpdated: new Date().toISOString(),
            source: cleanProduct.source || 'AI-Specialist-Discovery'
        };

        const lookupModels = new Set(
            [product.model, product.sourceModel]
                .map(m => String(m || '').toLowerCase().trim())
                .filter(Boolean)
        );
        const existingIdx = targetBrand.products.findIndex(p =>
            lookupModels.has(String(p.model || '').toLowerCase().trim())
        );

        if (existingIdx !== -1) {
            const existing = targetBrand.products[existingIdx];
            const isDeadExistingImg = /img\.architonic\.com/i.test(existing.imageUrl || '')
                || !String(existing.imageUrl || '').startsWith('http');
            const isGroundedUpgrade = existing.source === 'grounded-search'
                && Boolean(preparedProduct.imageUrl)
                && preparedProduct.source !== 'grounded-search';
            const isOfficialUpgrade = Boolean(preparedProduct.officialRefreshedAt && preparedProduct.imageUrl)
                && (!existing.officialRefreshedAt || preparedProduct.forceOfficialRefresh === true);
            const isForcedImageUpgrade = preparedProduct.forceImageUpgrade === true
                && Boolean(preparedProduct.imageUrl)
                && preparedProduct.imageUrl !== existing.imageUrl;
            const needsUpgrade = (!existing.imageUrl && preparedProduct.imageUrl) ||
                (isDeadExistingImg && preparedProduct.imageUrl) ||
                isGroundedUpgrade ||
                isForcedImageUpgrade ||
                isOfficialUpgrade ||
                (!existing.description && preparedProduct.description) ||
                (existing.verified === false && preparedProduct.verified === true) ||
                (!(parseFloat(existing.price) > 0) && parseFloat(preparedProduct.price) > 0);
            if (!needsUpgrade) {
                console.log(`ℹ️ [Storage] Product "${product.model}" already exists in ${brandName}. Skipping hardening.`);
                return true;
            }
            const { sourceModel: _sm, forceOfficialRefresh: _for, forceImageUpgrade: _fiu, ...cleanPrepared } = preparedProduct;
            targetBrand.products[existingIdx] = {
                ...existing,
                ...cleanPrepared,
                model: existing.model || cleanPrepared.model,
                imageUrl: cleanPrepared.imageUrl || existing.imageUrl || '',
                description: cleanPrepared.description || existing.description || '',
                price: parseFloat(cleanPrepared.price) > 0 ? cleanPrepared.price : (existing.price || 0),
                verified: Boolean(cleanPrepared.imageUrl || existing.imageUrl) && (cleanPrepared.verified || existing.verified)
            };
            console.log(`💎 [Storage] Upgraded "${existing.model}" in ${brandName} with live official image/specs.`);
            return await this.saveBrand(targetBrand);
        }

        const { sourceModel: _smNew, forceOfficialRefresh: _forNew, forceImageUpgrade: _fiuNew, ...cleanNewProduct } = preparedProduct;
        targetBrand.products.push(cleanNewProduct);

        console.log(`💎 [Storage] Hardening ${brandName}: Added "${product.model}" (Category: ${cleanProduct.mainCategory || norm.mainCategory} ➔ ${cleanProduct.subCategory || norm.subCategory})`);
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
            this.invalidateCache();
            return actualCloudDeletionSuccess;
        } catch (error) {
            this.invalidateCache();
            return actualCloudDeletionSuccess;
        }
    }
};