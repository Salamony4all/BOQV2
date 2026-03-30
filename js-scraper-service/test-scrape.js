import StructureScraper from './structureScraper.js';

(async () => {
    const scraper = new StructureScraper();
    const url = 'https://www.architonic.com/en/b/greyfox/collections/10007013/';
    console.log('Testing scraper for:', url);
    try {
        const result = await scraper.scrapeBrand(url, null, (p, msg) => console.log(`Progress ${p}%: ${msg}`));
        console.log('Final Brand Info:', JSON.stringify(result.brandInfo, null, 2));
        console.log('Found Products:', result.products.length);
    } catch (e) {
        console.error('Scrape Failed:', e);
    }
    process.exit(0);
})();
