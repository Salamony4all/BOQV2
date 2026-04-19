import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️  [SupabaseStorage] Supabase credentials missing (SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL)');
}

export const supabase = (supabaseUrl && supabaseKey) 
    ? createClient(supabaseUrl, supabaseKey)
    : null;

/**
 * Uploads a file to a Supabase bucket
 * @param {string} bucket - The bucket name
 * @param {string} path - The path inside the bucket
 * @param {Buffer|Blob|File} fileObject - The file data
 * @param {object} options - Supabase storage options (e.g. contentType)
 */
export async function uploadToSupabase(bucket, path, fileObject, options = {}) {
    if (!supabase) throw new Error('Supabase client not initialized');

    const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, fileObject, {
            upsert: true,
            ...options
        });

    if (error) {
        console.error(`❌ [SupabaseStorage] Upload failed:`, error.message);
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

    // Map DB rows to match the app's brand object structure if needed
    return data;
}

/**
 * Brand DB Logic - Save or Update a brand
 */
export async function saveSupabaseBrand(brand) {
    if (!supabase) return false;

    // Use upsert - assumes 'id' is unique
    const { data, error } = await supabase
        .from('brands')
        .upsert({
            id: brand.id,
            name: brand.name,
            logo: brand.logo,
            budgetTier: brand.budgetTier,
            products: brand.products || [],
            source: brand.origin || 'App',
            updated_at: new Date().toISOString()
        });

    if (error) {
        console.error(`❌ [SupabaseStorage] Save brand failed:`, error.message);
        return false;
    }

    return true;
}
