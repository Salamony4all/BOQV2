import { createClient } from '@vercel/kv';
import { put, list, del } from '@vercel/blob';
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

// Initialize KV client
let kv = null;
if (KV_URL && KV_TOKEN) {
    try {
        kv = createClient({ url: KV_URL, token: KV_TOKEN });
    } catch (e) {
        console.error('[Storage] Failed to initialize KV client:', e.message);
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
            const files = await fs.readdir(brandsPath);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            if (jsonFiles.length > 0) {
                console.log(`[Storage] Found ${jsonFiles.length} brands in ${brandsPath}`);
                const brands = await Promise.all(jsonFiles.map(async file => {
                    try {
                        const content = await fs.readFile(path.join(brandsPath, file), 'utf8');
                        return JSON.parse(content);
                    } catch (e) { return null; }
                }));

                for (const brand of brands) {
                    if (brand && !seenIds.has(brand.id)) {
                        seenIds.add(brand.id);
                        allBrands.push(brand);
                    }
                }
            }
        } catch (e) { /* silent skip */ }
    }
    return allBrands;
}

export const brandStorage = {
    async getAllBrands() {
        // Master list
        const brandMap = new Map();

        // 1. Load Local Brands (Filesystem / Tmp) - Base Layer
        const localBrands = await getLocalBrands();
        localBrands.forEach(b => brandMap.set(String(b.id), b));

        // 2. Load Blob Brands (Persistent Storage Layer for Vercel without KV)
        if (!kv && process.env.BLOB_READ_WRITE_TOKEN) {
            try {
                const { blobs } = await list({ prefix: 'brands-db/' });
                // Parallel fetch of all brand files
                const blobPromises = blobs.map(async (blob) => {
                    try {
                        const res = await axios.get(blob.url);
                        return res.data;
                    } catch (e) { console.error('Failed to read blob brand:', e.message); return null; }
                });

                const blobBrands = await Promise.all(blobPromises);
                blobBrands.filter(Boolean).forEach(b => {
                    if (b && b.id) brandMap.set(String(b.id), b);
                });
                console.log(`[Storage] Loaded ${blobBrands.filter(Boolean).length} brands from Blob DB.`);
            } catch (e) {
                console.error('[Storage] Failed to load brands from Blob:', e.message);
            }
        }

        // 3. Load KV Brands (High-Performance Layer) - Top Priority
        if (isVercel && kv) {
            try {
                const keys = await kv.keys('brand:*');
                if (keys.length > 0) {
                    const kvBrands = await kv.mget(...keys);
                    kvBrands.filter(Boolean).forEach(b => brandMap.set(String(b.id), b));
                }
            } catch (e) { console.error('[Storage] KV Error:', e.message); }
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
        if (kv) {
            try {
                await kv.set(`brand:${brand.id}`, brand);
                return true;
            } catch (error) { return false; }
        }

        // Blob Storage Strategy (Persistent)
        if (process.env.BLOB_READ_WRITE_TOKEN) {
            try {
                console.log('[Storage] Saving to Blob DB...');
                // Save as JSON file in 'brands-db/' folder
                const filename = `brands-db/${brand.id}.json`;
                await put(filename, JSON.stringify(brand, null, 2), {
                    access: 'public',
                    addRandomSuffix: false, // Overwrite existing
                });
                return true;
            } catch (error) {
                console.error('[Storage] Blob save failed:', error);
                // Fallthrough to local tmp just in case
            }
        }

        // Local / Try-Hard Strategy
        try {
            // On Vercel, use /tmp/data/brands. On local, use server/data/brands
            const baseDir = isVercel ? '/tmp/data/brands' : path.join(__dirname, 'data/brands');

            const sanitizedName = brand.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const filename = `${sanitizedName}-${brand.budgetTier || 'mid'}.json`;

            await fs.mkdir(baseDir, { recursive: true });
            await fs.writeFile(path.join(baseDir, filename), JSON.stringify(brand, null, 2));
            return true;
        } catch (error) {
            console.error('[Storage] Filesystem save failed:', error);
            return false;
        }
    },

    async deleteBrand(brandId) {
        if (kv) {
            try {
                await kv.del(`brand:${brandId}`);
                return true;
            } catch (error) { return false; }
        }

        // Blob Delete
        if (process.env.BLOB_READ_WRITE_TOKEN) {
            try {
                const filename = `brands-db/${brandId}.json`;
                const { blobs } = await list({ prefix: 'brands-db/' });
                const blobToDelete = blobs.find(b => b.pathname === filename);
                if (blobToDelete) {
                    await del(blobToDelete.url);
                    return true;
                }
            } catch (e) { console.error('Blob delete error', e); }
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
