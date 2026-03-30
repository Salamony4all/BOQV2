
import ScraperService from './server/scraper.js';

async function testMartex() {
    const scraper = new ScraperService();
    const url = "https://www.architonic.com/en/b/martex/collections/3101472/";

    console.log("Testing Architonic Martex scraper...\n");
    try {
        const result = await scraper.scrapeBrand(url, (progress, status) => {
            console.log(`[${progress}%] ${status}`);
        });

        console.log(`\n=== RESULTS ===`);
        console.log(`Total products: ${result.products.length}`);

        if (result.products.length > 0) {
            console.log("\nSample product:");
            console.log(JSON.stringify(result.products[0], null, 2));
        } else {
            console.log("\nNo products found.");
        }
    } catch (error) {
        console.error("Test failed:", error);
    }
}

testMartex();
