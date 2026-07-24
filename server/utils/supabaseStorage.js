import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import process from 'node:process';
import { Buffer } from 'node:buffer';


const cleanEnvStr = (str) => {
    if (!str || typeof str !== 'string') return '';
    return str.trim().replace(/^["']|["']$/g, '').trim();
};

const rawSupabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const rawSupabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const rawSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

let supabaseUrl = cleanEnvStr(rawSupabaseUrl);
let supabaseKey = cleanEnvStr(rawSupabaseKey);
let supabaseServiceKey = cleanEnvStr(rawSupabaseServiceKey);

if (supabaseUrl && !/^https?:\/\//i.test(supabaseUrl)) {
    supabaseUrl = `https://${supabaseUrl}`;
}

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️  [SupabaseStorage] Supabase credentials missing or invalid (SUPABASE_URL / SUPABASE_ANON_KEY)');
}

// Standard client (subject to RLS policies — safe for reads and inserts)
let supabaseClient = null;
if (supabaseUrl && supabaseKey) {
    try {
        supabaseClient = createClient(supabaseUrl, supabaseKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
    } catch (err) {
        console.error('❌ [SupabaseStorage] Failed to create Supabase client:', err.message);
    }
}
export const supabase = supabaseClient;

// Admin client (bypasses RLS — used ONLY for trusted server-side destructive ops like DELETE)
let supabaseAdminClient = null;
if (supabaseUrl && supabaseServiceKey) {
    try {
        supabaseAdminClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
    } catch (err) {
        console.error('❌ [SupabaseStorage] Failed to create Supabase admin client:', err.message);
    }
}
export const supabaseAdmin = supabaseAdminClient || supabaseClient;

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

        if (listError) {
            console.warn(`[SupabaseStorage] Notice: Cannot list buckets (${listError.message}). Proceeding assuming "${bucketName}" exists.`);
            verifiedBuckets.add(bucketName);
            return true;
        }

        const exists = (buckets || []).some(b => b.name === bucketName);
        if (!exists) {
            console.log(`[SupabaseStorage] Creating missing bucket: "${bucketName}"`);
            const { error: createError } = await supabase.storage.createBucket(bucketName, {
                public: true,
                fileSizeLimit: 10485760, // 10MB
            });
            if (createError) {
                console.warn(`[SupabaseStorage] Warning: Failed to create bucket "${bucketName}" (${createError.message}). It may already exist.`);
            }
        }

        verifiedBuckets.add(bucketName);
        return true;
    } catch (err) {
        console.warn(`[SupabaseStorage] Notice during bucket check for "${bucketName}": ${err.message}`);
        verifiedBuckets.add(bucketName); // Mark as checked to prevent loop
        return true;
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

    try {
        await ensureBucket(bucket);

        let dataToUpload = fileObject;
        if (Buffer.isBuffer(fileObject)) {
            dataToUpload = fileObject.buffer.slice(fileObject.byteOffset, fileObject.byteOffset + fileObject.byteLength);
        }

        const { data, error } = await supabase.storage
            .from(bucket)
            .upload(path, dataToUpload, {
                upsert: true,
                ...options
            });

        if (error) {
            console.error(`❌ [SupabaseStorage] Upload failed for path: ${path} - ${error.message}`);
            throw error;
        }

        const { data: urlData } = supabase.storage
            .from(bucket)
            .getPublicUrl(data.path);

        return {
            path: data.path,
            url: urlData.publicUrl
        };
    } catch (err) {
        console.error(`❌ [SupabaseStorage] Upload exception for path "${path}": ${err.message}`);
        throw err;
    }
}

/**
 * Lists files in a Supabase bucket folder
 * @param {string} bucket 
 * @param {string} folder 
 */
export async function listSupabaseFiles(bucket, folder = '') {
    if (!supabase) return [];

    try {
        const { data, error } = await supabase.storage
            .from(bucket)
            .list(folder, {
                limit: 100,
                offset: 0,
                sortBy: { column: 'created_at', order: 'desc' },
            });

        if (error) {
            console.error(`❌ [SupabaseStorage] List failed:`, error.message);
            return [];
        }

        return (data || []).map(file => ({
            ...file,
            url: supabase.storage.from(bucket).getPublicUrl(`${folder ? folder + '/' : ''}${file.name}`).data.publicUrl,
            pathname: `${folder ? folder + '/' : ''}${file.name}`
        }));
    } catch (err) {
        console.error(`❌ [SupabaseStorage] List exception for folder "${folder}": ${err.message}`);
        return [];
    }
}

/**
 * Deletes a file from Supabase by its full path
 * @param {string} bucket 
 * @param {string} path 
 */
export async function deleteFromSupabase(bucket, path) {
    if (!supabase) return null;

    try {
        const { data, error } = await supabase.storage
            .from(bucket)
            .remove([path]);

        if (error) {
            console.error(`❌ [SupabaseStorage] Delete failed:`, error.message);
            return null;
        }

        return data;
    } catch (err) {
        console.error(`❌ [SupabaseStorage] Delete exception for path "${path}": ${err.message}`);
        return null;
    }
}

/**
 * Brand DB Logic - Get all brands from 'brands' table
 */
export async function getSupabaseBrands() {
    if (!supabase) return [];

    try {
        const { data, error } = await supabase
            .from('brands')
            .select('*');

        if (error) {
            console.error(`❌ [SupabaseStorage] Fetch brands failed: ${error.message}`);
            return [];
        }

        if (!data) return [];

        // Map DB columns (snake_case) to app properties (camelCase)
        return data.map(b => ({
            ...b,
            budgetTier: b.budget_tier || b.budgetTier || 'mid',
        }));
    } catch (err) {
        console.error(`❌ [SupabaseStorage] Fetch brands exception: ${err.message}`);
        return [];
    }
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

    try {
        const { error } = await supabase
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
    } catch (err) {
        console.error(`❌ [SupabaseStorage] Upsert brand exception for "${brandName}": ${err.message}`);
        return false;
    }
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
        console.warn(`[SupabaseStorage] Stats fetch notice: ${e.message}`);
        return { brands: 0, products: 0, lastSync: null };
    }
}

/**
 * Blueprint DB Logic - Get blueprint for a specific domain
 */
export async function getSupabaseBlueprint(domain_name) {
    const client = supabaseAdmin || supabase;
    if (!client) return null;

    try {
        const { data, error } = await client
            .from('portal_blueprints')
            .select('blueprint')
            .eq('domain_name', domain_name)
            .single();

        if (error || !data) return null;
        return data.blueprint;
    } catch (err) {
        console.error(`❌ [SupabaseStorage] Fetch blueprint failed: ${err.message}`);
        return null;
    }
}

/**
 * Blueprint DB Logic - Save blueprint for a domain
 */
export async function saveSupabaseBlueprint(domain_name, blueprint) {
    const client = supabaseAdmin || supabase;
    if (!client) {
        console.warn('⚠️ [SupabaseStorage] Cannot save blueprint: Supabase client not initialized');
        return false;
    }

    console.log(`📡 [SupabaseStorage] Attempting to upsert blueprint for domain: "${domain_name}"`);

    try {
        const { error } = await client
            .from('portal_blueprints')
            .upsert({
                domain_name,
                blueprint
            }, {
                onConflict: 'domain_name'
            });

        if (error) {
            console.error(`❌ [SupabaseStorage] Upsert blueprint failed for "${domain_name}": ${error.message}`);
            return false;
        }

        console.log(`✅ [SupabaseStorage] Successfully upserted blueprint for "${domain_name}".`);
        return true;
    } catch (err) {
        console.error(`❌ [SupabaseStorage] Upsert blueprint exception for "${domain_name}": ${err.message}`);
        return false;
    }
}