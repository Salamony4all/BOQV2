
import ScraperService from './server/scraper.js';

async function testArchitonic() {
    const scraper = new ScraperService();
    const url = "https://www.architonic.com/en/b/narbutas/collections/10001981/";

    console.log("Testing Architonic scraper...\n");
    const products = await scraper.scrapeBrand(url, 'architonic');

    console.log(`\n=== RESULTS ===`);
    console.log(`Total products: ${products.length}`);

    // Group by category
    const categories = {};
    products.forEach(p => {
        if (!categories[p.mainCategory]) {
            categories[p.mainCategory] = [];
        }
        categories[p.mainCategory].push(p.model);
    });

    console.log("\nCategories:");
    for (const [cat, prods] of Object.entries(categories)) {
        console.log(`  ${cat}: ${prods.length} products`);
        console.log(`    -> ${prods.slice(0, 3).join(', ')}${prods.length > 3 ? '...' : ''}`);
    }

    if (products.length > 0 && products[0].mainCategory !== 'Error') {
        console.log("\nSample product:");
        console.log(JSON.stringify(products[0], null, 2));
    }
}

testArchitonic();
