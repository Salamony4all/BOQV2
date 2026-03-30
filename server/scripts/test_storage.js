import { brandStorage } from '../storageProvider.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
    console.log('🧪 Starting Storage Provider Fallback Test...');

    // 1. Force an invalid token for testing
    process.env.BLOB_READ_WRITE_TOKEN = 'token_abc_invalid_123';
    process.env.SKIP_BLOB = 'false'; // Ensure we try blob

    const testBrand = {
        id: 'test_' + Date.now(),
        name: 'Storage Fallback Test Brand',
        url: 'https://example.com/test',
        products: [
            { name: 'Test Product 1', price: 100 },
            { name: 'Test Product 2', price: 200 }
        ],
        budgetTier: 'mid'
    };

    console.log(`\n--- Test 1: Cloud Failure Fallback ---`);
    console.log('Purpose: Verify that saveBrand completes even if Vercel Blob fails.');
    
    try {
        const result = await brandStorage.saveBrand(testBrand);
        
        if (result) {
            console.log('✅ Success: saveBrand returned true despite invalid token.');
        } else {
            console.error('❌ Failure: saveBrand returned false.');
        }
    } catch (e) {
        console.error('❌ Crash: saveBrand threw an unhandled exception!', e);
    }

    console.log(`\n--- Test 2: Local Mode ---`);
    process.env.STORAGE_MODE = 'local';
    console.log('Purpose: Verify SKIP_BLOB/Local-Only mode avoids cloud calls.');
    
    try {
        const start = Date.now();
        const result = await brandStorage.saveBrand({ ...testBrand, id: 'test_local_' + Date.now() });
        const duration = Date.now() - start;
        
        if (result && duration < 500) {
            console.log(`✅ Success: Instant save to local filesystem (${duration}ms).`);
        } else {
            console.log(`⚠️ Warning: Local save took longer than expected (${duration}ms). Check if Blob was still attempted.`);
        }
    } catch (e) {
        console.error('❌ Crash in Local Mode!', e);
    }

    console.log('\n🏁 Storage Test Complete.');
    process.exit(0);
}

runTest().catch(err => {
    console.error('Fatal Test Error:', err);
    process.exit(1);
});
