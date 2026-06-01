import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️  [SupabaseStorage] Supabase credentials missing (SUPABASE_URL / SUPABASE_ANON_KEY)');
}

// Standard client (subject to RLS policies — safe for reads and inserts)
export const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

// Admin client (bypasses RLS — used ONLY for trusted server-side destructive ops like DELETE)
// Falls back to anon client if service role key is not configured
export const supabaseAdmin = (supabaseUrl && supabaseServiceKey)
    ? createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : supabase;

if (supabaseUrl && !supabaseServiceKey) {
    console.warn('⚠️  [SupabaseStorage] SUPABASE_SERVICE_ROLE_KEY not set — DELETE operations may be blocked by RLS. Add it to your Vercel environment variables.');
}

// Cache for verified buckets to avoid redundant API calls
const verifiedBuckets = new Set();

/**
 * Ensures the specified bucket exists in Supabase storage
 */
async function ensureBucket(bucketName) {
    if (!supabase) return false;
    if (verifiedBuckets.has(bucketName)) return true;

    try {
        // Attempt to list buckets to check existence
        const { data: buckets, error: listError } = await supabase.storage.listBuckets();

        // If we can't list buckets (often due to RLS), we'll just try to upload anyway
        // instead of failing. Most users don't have 'list' permissions on anon keys.
        if (listError) {
            console.warn(`[SupabaseStorage] Notice: Cannot list buckets (${listError.message}). Proceeding assuming "${bucketName}" exists.`);
            verifiedBuckets.add(bucketName);
            return true;
        }

        const exists = buckets.some(b => b.name === bucketName);
        if (!exists) {
            console.log(`[SupabaseStorage] Creating missing bucket: "${bucketName}"`);
            const { error: createError } = await supabase.storage.createBucket(bucketName, {
                public: true,
                fileSizeLimit: 10485760, // 10MB
            });
            if (createError) {
                // If creation fails (RLS), it might still exist but be hidden
                console.warn(`[SupabaseStorage] Warning: Failed to create bucket "${bucketName}" (${createError.message}). It may already exist.`);
            }
        }

        verifiedBuckets.add(bucketName);
        return true;
    } catch (err) {
        // Log once but don't block the upload attempt
        console.error(`[SupabaseStorage] Error during bucket check for "${bucketName}":`, err.message);
        verifiedBuckets.add(bucketName); // Mark as "checked" to stop retrying
        return false;
    }
}

/**
 * Uploads a file to a Supabase bucket
 * @param {string} bucket - The bucket name
 * @param {string} path - The path inside the bucket
 * @param {Buffer|Blob|File} fileObject - The file data
 * @param {object} options - Supabase storage options (e.g. contentType)
 */
export async function uploadToSupabase(bucket, path, fileObject, options = {}) {
    if (!supabase) {
        console.warn('[SupabaseStorage] Supabase client NOT initialized. Check SUPABASE_URL and SUPABASE_ANON_KEY.');
        throw new Error('Supabase client not initialized');
    }

    // Ensure bucket exists before upload
    await ensureBucket(bucket);

    const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, fileObject, {
            upsert: true,
            ...options
        });

    if (error) {
        console.error(`❌ [SupabaseStorage] Upload failed for path: ${path}`);
        console.error(`❌ [SupabaseStorage] Error message:`, error.message);
        console.error(`❌ [SupabaseStorage] Error details:`, error);
        throw error;
    }

    const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(data.path);

    return {
        path: data.path,
        url: urlData.publicUrl
    };
}

/**
 * Lists files in a Supabase bucket folder
 * @param {string} bucket 
 * @param {string} folder 
 */
export async function listSupabaseFiles(bucket, folder = '') {
    if (!supabase) throw new Error('Supabase client not initialized');

    const { data, error } = await supabase.storage
        .from(bucket)
        .list(folder, {
            limit: 100,
            offset: 0,
            sortBy: { column: 'created_at', order: 'desc' },
        });

    if (error) {
        console.error(`❌ [SupabaseStorage] List failed:`, error.message);
        throw error;
    }

    return data.map(file => ({
        ...file,
        url: supabase.storage.from(bucket).getPublicUrl(`${folder ? folder + '/' : ''}${file.name}`).data.publicUrl,
        pathname: `${folder ? folder + '/' : ''}${file.name}`
    }));
}

/**
 * Deletes a file from Supabase by its full path
 * @param {string} bucket 
 * @param {string} path 
 */
export async function deleteFromSupabase(bucket, path) {
    if (!supabase) throw new Error('Supabase client not initialized');

    const { data, error } = await supabase.storage
        .from(bucket)
        .remove([path]);

    if (error) {
        console.error(`❌ [SupabaseStorage] Delete failed:`, error.message);
        throw error;
    }

    return data;
}

/**
 * Brand DB Logic - Get all brands from 'brands' table
 */
export async function getSupabaseBrands() {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('brands')
        .select('*');

    if (error) {
        console.error(`❌ [SupabaseStorage] Fetch brands failed:`, error.message);
        return [];
    }

    // Map DB columns (snake_case) to app properties (camelCase)
    return data.map(b => ({
        ...b,
        budgetTier: b.budget_tier || b.budgetTier, // Handle both just in case
    }));
}

export async function saveSupabaseBrand(brand) {
    if (!supabase) {
        console.warn('⚠️ [SupabaseStorage] Cannot save brand: Supabase client not initialized');
        return false;
    }

    const brandId = String(brand.id);
    const brandName = brand.name;
    const productCount = brand.products?.length || 0;

    console.log(`📡 [SupabaseStorage] Attempting to upsert brand: "${brandName}" (ID: ${brandId}, Products: ${productCount})`);

    // Use upsert - assumes 'id' is unique
    const { data, error } = await supabase
        .from('brands')
        .upsert({
            id: brandId,
            name: brandName,
            products: brand.products || [],
            source: brand.origin || brand.source || 'App',
            budget_tier: brand.budgetTier || brand.budget_tier || 'mid',
            logo: brand.logo || ''
        }, {
            onConflict: 'id'
        })
        .select();

    if (error) {
        console.error(`❌ [SupabaseStorage] Upsert failed for "${brandName}":`, {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint
        });
        return false;
    }

    console.log(`✅ [SupabaseStorage] Successfully upserted brand "${brandName}". (ID: ${brandId})`);
    return true;
}

/**
 * Gets overview stats for the dashboard
 */
export async function getSupabaseStats() {
    if (!supabase) return { brands: 0, products: 0, assets: 0 };

    try {
        const { count: brandCount } = await supabase.from('brands').select('*', { count: 'exact', head: true });

        // Sum products across all brands
        const { data: brands } = await supabase.from('brands').select('products');
        const productCount = (brands || []).reduce((acc, b) => acc + (b.products?.length || 0), 0);

        return {
            brands: brandCount || 0,
            products: productCount,
            lastSync: new Date().toISOString()
        };
    } catch (e) {
        return { brands: 0, products: 0, lastSync: null };
    }
}

/**
 * Blueprint DB Logic - Get blueprint for a specific domain
 */
export async function getSupabaseBlueprint(domain_name) {
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
            .from('portal_blueprints')
            .select('blueprint')
            .eq('domain_name', domain_name)
            .single();

        if (error || !data) return null;
        return data.blueprint;
    } catch (err) {
        console.error(`❌ [SupabaseStorage] Fetch blueprint failed:`, err.message);
        return null;
    }
}

/**
 * Blueprint DB Logic - Save blueprint for a domain
 */
export async function saveSupabaseBlueprint(domain_name, blueprint) {
    if (!supabase) {
        console.warn('⚠️ [SupabaseStorage] Cannot save blueprint: Supabase client not initialized');
        return false;
    }

    console.log(`📡 [SupabaseStorage] Attempting to upsert blueprint for domain: "${domain_name}"`);

    const { error } = await supabase
        .from('portal_blueprints')
        .upsert({
            domain_name,
            blueprint
        }, {
            onConflict: 'domain_name'
        });

    if (error) {
        console.error(`❌ [SupabaseStorage] Upsert blueprint failed for "${domain_name}":`, error.message);
        return false;
    }

    console.log(`✅ [SupabaseStorage] Successfully upserted blueprint for "${domain_name}".`);
    return true;
}