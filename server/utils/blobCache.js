import { list } from '@vercel/blob';

/**
 * Specialized Cache for Vercel Blob Listings
 * Prevents hitting "Advanced Operations" limits (2000 per month on Hobby).
 */
class BlobCacheManager {
    constructor() {
        this.cache = new Map(); // key -> { data, timestamp }
        this.ttl = 5 * 60 * 1000; // Default: 5 minutes
    }

    generateKey(options) {
        return JSON.stringify(options);
    }

    /**
     * List blobs with a caching layer.
     * @param {Object} options - Standard @vercel/blob list options
     * @param {Boolean} forceRefresh - Bypass cache and fetch fresh
     */
    async list(options = {}, forceRefresh = false) {
        const key = this.generateKey(options);
        const cached = this.cache.get(key);

        if (!forceRefresh && cached && (Date.now() - cached.timestamp < this.ttl)) {
            if (process.env.DEBUG_BLOB === 'true') {
                console.log(`📡 [BlobCache] HIT for ${key}`);
            }
            return cached.data;
        }

        if (process.env.DEBUG_AI === 'true' || process.env.DEBUG_BLOB === 'true') {
            console.log(`📡 [BlobCache] MISS for ${key} - Fetching from Vercel...`);
        }

        try {
            const result = await list(options);
            
            // Store in cache
            this.cache.set(key, {
                data: result,
                timestamp: Date.now()
            });

            return result;
        } catch (error) {
            console.error('❌ [BlobCache] Fetch error:', error.message);
            // If fetch fails but we have cached data, return it as fallback even if stale
            if (cached) {
                console.warn('⚠️ [BlobCache] Returning STALE data as fallback.');
                return cached.data;
            }
            throw error;
        }
    }

    /**
     * Selective invalidation based on prefix.
     * Useful when a single file is uploaded/deleted.
     */
    invalidate(prefix = null) {
        if (!prefix) {
            this.cache.clear();
            console.log('📡 [BlobCache] Full cache cleared.');
            return;
        }

        for (const [key, value] of this.cache.entries()) {
            const options = JSON.parse(key);
            if (options.prefix === prefix || !options.prefix) {
                this.cache.delete(key);
            }
        }
        console.log(`📡 [BlobCache] Cleared cache for prefix: ${prefix}`);
    }
}

export const BlobCache = new BlobCacheManager();
