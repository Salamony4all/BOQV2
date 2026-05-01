
import 'dotenv/config';
import { brandStorage } from '../storageProvider.js';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function syncLocalToSupabase() {
    console.log('🚀 Starting Local to Supabase Sync...');
    
    // 1. Get all local files from multiple possible paths
    const possiblePaths = [
        path.join(process.cwd(), 'server/data/brands'),
        path.join(process.cwd(), 'data/brands'),
        path.join(__dirname, '../data/brands'),
        path.join(__dirname, 'data/brands')
    ];

    let brandsToSync = [];
    let seenIds = new Set();

    for (const brandsPath of possiblePaths) {
        try {
            console.log(`🔍 Checking path: ${brandsPath}`);
            const files = await fs.readdir(brandsPath);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            
            for (const file of jsonFiles) {
                try {
                    const filePath = path.join(brandsPath, file);
                    const content = await fs.readFile(filePath, 'utf8');
                    const brand = JSON.parse(content);
                    if (brand && brand.id && !seenIds.has(String(brand.id))) {
                        brandsToSync.push(brand);
                        seenIds.add(String(brand.id));
                    }
                } catch (e) { /* skip bad files */ }
            }
        } catch (e) { /* skip missing paths */ }
    }

    console.log(`📂 Found ${brandsToSync.length} unique local brands to sync.`);

    let successCount = 0;
    let failCount = 0;

    for (const brand of brandsToSync) {
        try {
            console.log(`📤 Syncing "${brand.name}" (ID: ${brand.id})...`);
            
            // saveBrand in storageProvider already has Supabase logic
            const success = await brandStorage.saveBrand(brand);
            
            if (success) {
                console.log(`✅ Synced "${brand.name}"`);
                successCount++;
            } else {
                console.warn(`⚠️  Failed to sync "${brand.name}"`);
                failCount++;
            }
        } catch (err) {
            console.error(`❌ Error processing ${file}:`, err.message);
            failCount++;
        }
    }

    console.log('\n--- Sync Results ---');
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log('--------------------\n');

    return { success: true, successCount, failCount };
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    syncLocalToSupabase();
}
