import 'dotenv/config';
import { ScrapingBeeClient } from 'scrapingbee';
import * as cheerio from 'cheerio';

class ScrapingBeeScraper {
    constructor() {
        this.apiKey = process.env.SCRAPINGBEE_API_KEY;
        this.client = this.apiKey ? new ScrapingBeeClient(this.apiKey) : null;
    }

    async fetchPage(url) {
        if (!this.client) throw new Error('No API Key');
        console.log(`Fetching ${url}...`);
        // Use generic render_js for Amara (it's not Architonic)
        const response = await this.client.get({
            url: url,
            params: {
                render_js: 'true', // Amara seems to need JS
                wait: 10000,
                stealth_proxy: 'true' // Bypass Cloudflare/Anti-bot
            }
        });
        return response.data.toString();
    }
}

async function test() {
    console.log('Testing Amara Art with ScrapingBee...');
    const scraper = new ScrapingBeeScraper();

    try {
        const html = await scraper.fetchPage('https://amara-art.com/products/');
        console.log('HTML Length:', html.length);

        // Check for categories in sidebar
        const $ = cheerio.load(html);
        const categories = [];

        // Try the regex I just wrote
        $('a').each((i, el) => {
            const text = $(el).text().trim();
            const match = text.match(/^(.+?)\s*\((\d+)\)$/);
            if (match) {
                categories.push(match[1]);
            }
        });

        console.log('Categories found:', categories.length);
        if (categories.length > 0) {
            console.log('Examples:', categories.slice(0, 5));
        } else {
            console.log('No categories found. Sample text:', $('body').text().substring(0, 200));
        }

    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
