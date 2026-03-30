import ScraperService from './scraper.js';
import fs from 'fs';

async function testTargetUrl() {
    const url = 'https://www.architonic.com/en/b/narbutas/collections/10001981/';
    console.log(`[TEST] Testing scraper on: ${url}`);
    
    const scraper = new ScraperService();
    try {
        const result = await scraper.scrapeArchitonic(url, (progress, message) => {
            console.log(`[Progress: ${progress}%] ${message}`);
        });

        console.log(`[TEST] Scraping finished. Found ${result.products.length} products.`);
        
        const categories = {};
        const subCategories = {};
        
        result.products.forEach(p => {
            categories[p.mainCategory] = (categories[p.mainCategory] || 0) + 1;
            subCategories[p.subCategory] = (subCategories[p.subCategory] || 0) + 1;
        });

        const report = {
            totalProducts: result.products.length,
            brand: result.brandInfo,
            categoryStats: categories,
            subCategoryStats: subCategories,
            sampleProducts: result.products.slice(0, 10)
        };

        fs.writeFileSync('test_scraper_output.json', JSON.stringify(report, null, 2));
        console.log('[TEST] Saved report to js-scraper-service/test_scraper_output.json');
        
    } catch (e) {
        console.error('[TEST] Error during scraping:', e);
    }
}

testTargetUrl();
