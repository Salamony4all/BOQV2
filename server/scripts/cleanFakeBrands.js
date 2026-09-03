import 'dotenv/config';
import { supabase, getSupabaseBrands } from '../utils/supabaseStorage.js';
import { brandStorage } from '../storageProvider.js';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORBIDDEN_BRAND_NAMES = new Set([
    'roma', 'wind', 'app', 'racer', 'terminal', 'generic', 'unknown', 'not specified', 'moodie'
]);

async function cleanFakeBrands() {
    console.log('🧹 [CleanFakeBrands] Starting audit and purge of obsolete/fake brand records...');

    if (supabase) {
        try {
            const brands = await getSupabaseBrands();
            console.log(`📋 Found ${brands.length} brands in Supabase.`);
            for (const b of brands) {
                const nameLower = String(b.name || '').toLowerCase().trim();
                if (FORBIDDEN_BRAND_NAMES.has(nameLower)) {
                    console.log(`🗑️ Deleting brand from Supabase: "${b.name}" (ID: ${b.id})`);
                    const { error } = await supabase.from('brands').delete().eq('id', b.id);
                    if (error) {
                        console.warn(`  ⚠️ Delete error for ${b.name}:`, error.message);
                    } else {
                        console.log(`  ✅ Successfully deleted ${b.name}`);
                    }
                }
            }
        } catch (e) {
            console.warn('⚠️ Supabase purge error:', e.message);
        }
    }

    // Clean local disk
    const possiblePaths = [
        path.join(process.cwd(), 'server/data/brands'),
        path.join(__dirname, '../data/brands')
    ];

    for (const p of possiblePaths) {
        try {
            const files = await fs.readdir(p);
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                const fileBase = file.replace('.json', '').split('-')[0].toLowerCase().trim();
                if (FORBIDDEN_BRAND_NAMES.has(fileBase)) {
                    console.log(`🗑️ Deleting fake brand file: ${file}`);
                    try {
                        await fs.unlink(path.join(p, file));
                    } catch (e) {}
                }
            }
        } catch (e) {}
    }

    // Verify all remaining brands
    const remaining = await brandStorage.getAllBrands();
    console.log(`\n✅ Audit complete! Total active catalog brands: ${remaining.length}`);
    console.log('Brands:', remaining.map(b => b.name).join(', '));
}

cleanFakeBrands();
