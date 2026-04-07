import ScraperService from './scraper.js';
import fs from 'fs';
import path from 'path';

async function testArchitonicFix() {
    const scraper = new ScraperService();
    const testUrl = 'https://www.architonic.com/en/b/narbutas/10001981/collection/acoustic-screens/4004792';
    
    console.log('🚀 TESTING ARCHITONIC FIX:', testUrl);
    
    try {
        // Mocking onProgress
        const onProgress = (prog, msg) => {
            console.log(`[${prog}%] ${msg}`);
        };
        
        const result = await scraper.scrapeBrand(testUrl, onProgress).catch(err => {
            console.error('❌ ScrapeBrand FAILED:', err);
            throw err;
        });
        
        console.log('\n📊 SCRAPE RESULTS:');
        console.log(`Total Products Found: ${result.products.length}`);
        
        if (result.products.length > 0) {
            console.log('\n✅ SAMPLE PRODUCT:');
            const sample = result.products[0];
            console.log(`Name: ${sample.model}`);
            console.log(`Image: ${sample.imageUrl}`);
            console.log(`URL: ${sample.productUrl}`);
            
            // Check for valid data
            if (!sample.model || sample.model.length < 3) {
                console.error('❌ Error: Product name too short or missing!');
            }
            if (!sample.imageUrl || sample.imageUrl.includes('placeholder')) {
                console.warn('⚠️ Warning: Using placeholder image OR image missing.');
            }
        } else {
            console.error('❌ FAILED: No products found! Check if selectors correctly matched.');
        }
        
    } catch (err) {
        console.error('🔥 CRITICAL ERROR DURING TEST:', err);
    }
}

testArchitonicFix();
