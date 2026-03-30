
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

async function debugScrape() {
    const url = 'https://ottimouae.com/';
    let output = '';

    try {
        output += `\n\n--- SCRAPING: ${url} ---\n`;
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);

        // Find "New Arrivals" section
        const section = $('h3:contains("New Arrivals"), h2:contains("New Arrivals")').first().parent().parent();

        output += "Checking links in 'New Arrivals' vicinity...\n";

        // Look for product links and if they have companion category links
        section.find('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && (href.includes('product/') || href.includes('product-category'))) {
                output += `Link: ${href} (Text: ${$(el).text().trim()})\n`;
                output += `  Parent Class: ${$(el).parent().attr('class')}\n`;
            }
        });

    } catch (e) {
        output += `Error: ${e.message}\n`;
    }

    fs.writeFileSync('debug_output_home.txt', output);
    console.log("Done");
}

debugScrape();
