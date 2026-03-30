/**
 * ScrapingBee Cloud Scraper
 * Uses ScrapingBee API for web scraping with anti-bot bypass - works on Vercel serverless
 */

import { ScrapingBeeClient } from 'scrapingbee';
import * as cheerio from 'cheerio';

class ScrapingBeeScraper {
    constructor() {
        this.apiKey = process.env.SCRAPINGBEE_API_KEY;
        this.client = this.apiKey ? new ScrapingBeeClient(this.apiKey) : null;
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }

    /**
     * Check if ScrapingBee is configured
     */
    isConfigured() {
        if (!this.apiKey && process.env.SCRAPINGBEE_API_KEY) {
            this.apiKey = process.env.SCRAPINGBEE_API_KEY;
            this.client = new ScrapingBeeClient(this.apiKey);
        }
        return !!this.apiKey;
    }

    /**
     * Fetch a page using ScrapingBee with premium proxies
     */
    async fetchPage(url, options = {}) {
        if (!this.client) {
            throw new Error('ScrapingBee API key not configured');
        }

        console.log(`📡 Fetching: ${url}`);

        try {
            const response = await this.client.get({
                url: url,
                params: {
                    premium_proxy: 'true',
                    country_code: 'de',
                    ...options.params
                }
            });

            if (response.status !== 200) {
                throw new Error(`ScrapingBee returned status ${response.status}`);
            }

            return response.data.toString();
        } catch (error) {
            console.error(`❌ ScrapingBee error for ${url}:`, error.message);
            throw error;
        }
    }

    /**
     * Extract brand info from page HTML
     */
    extractBrandInfo(html, url) {
        const $ = cheerio.load(html);

        let name = $('h1').first().text().trim();
        if (name) {
            name = name.replace(/Collections by/i, '')
                .replace(/Products by/i, '').replace(/Collections/i, '').replace(/Products/i, '').trim();
        }

        if (!name || name.length < 2) {
            name = $('title').text().split(/[|–\-:]/)[0].trim() || 'Unknown';
        }

        let logo = '';
        const logoSelectors = ['img[src*="logo"]', '.logo img', 'header img'];
        for (const sel of logoSelectors) {
            const src = $(sel).first().attr('src');
            if (src) {
                logo = src.startsWith('http') ? src : new URL(src, url).href;
                break;
            }
        }

        return { name, logo };
    }

    // ... (Keep existing Architonic helpers if needed, but for brevity in this specific fix, I'm focusing on consistency)
    // Re-implementing Architonic helpers to ensure file integrity

    extractCollectionLinks(html, baseUrl) {
        const $ = cheerio.load(html);
        const links = new Set();
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            try {
                const fullUrl = new URL(href, baseUrl).href;
                if (fullUrl.includes('architonic.com') && (fullUrl.includes('/collection/') || fullUrl.includes('/collections/') || fullUrl.includes('/products/'))) {
                    links.add(fullUrl);
                }
            } catch (e) { }
        });
        return [...links].slice(0, 15);
    }

    extractProductLinks(html) {
        const $ = cheerio.load(html);
        const links = new Set();
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && /\/p\/[a-z0-9-]+\d+\/?/i.test(href)) {
                try {
                    const fullUrl = new URL(href, 'https://www.architonic.com').href;
                    links.add(fullUrl);
                } catch (e) { }
            }
        });
        return [...links].slice(0, 50);
    }

    extractProductDetails(html, url) {
        const $ = cheerio.load(html);
        const name = $('h1').first().text().trim() || '';
        let imageUrl = '';
        const imgSelectors = ['img.opacity-100', 'img[src*="/product/"]', '#product-page img', 'main img'];
        for (const sel of imgSelectors) {
            const src = $(sel).first().attr('src');
            if (src && src.includes('architonic.com') && !src.includes('logo') && !src.includes('/family/')) {
                imageUrl = src;
                break;
            }
        }
        if (!imageUrl) {
            $('img').each((i, el) => {
                const src = $(el).attr('src');
                if (src && src.includes('architonic.com') && !src.includes('logo')) {
                    imageUrl = src;
                    return false;
                }
            });
        }
        let description = $('meta[name="description"]').attr('content') || '';
        if (!description || description.length < 30) {
            description = $('.product-description, #description, .details-content').first().text().trim() || name;
        }
        let model = name;
        try {
            const urlParts = url.split('/').filter(Boolean);
            const lastPart = urlParts[urlParts.length - 1];
            const idMatch = lastPart.match(/-(\d+)$/);
            if (idMatch && idMatch[1]) model = `${name} #${idMatch[1]}`;
        } catch (e) { }

        return { name, model, imageUrl, description };
    }

    async scrapeArchitonic(url, onProgress = null) {
        console.log(`\n🐝 [ScrapingBee] Starting Architonic Scrape: ${url}`);
        const allProducts = [];
        let brandName = 'Architonic Brand';
        let brandLogo = '';
        try {
            if (onProgress) onProgress(10, 'Connecting to ScrapingBee...');
            const mainHtml = await this.fetchPage(url, { params: { wait: 5000 } });
            if (mainHtml.includes('403') || mainHtml.includes('Access Denied')) throw new Error('Site returned 403 - access blocked');

            const brandInfo = this.extractBrandInfo(mainHtml, url);
            brandName = brandInfo.name;
            brandLogo = brandInfo.logo;

            const collectionLinks = this.extractCollectionLinks(mainHtml, url);
            const directProducts = this.extractProductLinks(mainHtml);

            let collectionIndex = 0;
            for (const collUrl of collectionLinks) {
                collectionIndex++;
                const progress = 30 + Math.round((collectionIndex / collectionLinks.length) * 30);
                try {
                    if (onProgress) onProgress(progress, `Scraping collection ${collectionIndex}/${collectionLinks.length}...`);
                    const collHtml = await this.fetchPage(collUrl, { params: { wait: 3000 } });
                    const $ = cheerio.load(collHtml);
                    const collectionName = $('h1').first().text().trim() || 'Collection';
                    const productLinks = this.extractProductLinks(collHtml);
                    for (const prodUrl of productLinks.slice(0, 20)) {
                        try {
                            const prodHtml = await this.fetchPage(prodUrl, { params: { wait: 2000 } });
                            const product = this.extractProductDetails(prodHtml, prodUrl);
                            if (product.name && product.imageUrl) {
                                allProducts.push({
                                    mainCategory: 'Furniture',
                                    subCategory: collectionName,
                                    family: brandName,
                                    model: product.model,
                                    description: product.description,
                                    imageUrl: product.imageUrl,
                                    productUrl: prodUrl,
                                    price: 0
                                });
                            }
                        } catch (e) { }
                    }
                } catch (e) { }
            }
            if (allProducts.length < 30 && directProducts.length > 0) {
                for (const prodUrl of directProducts.slice(0, 15)) {
                    try {
                        const prodHtml = await this.fetchPage(prodUrl, { params: { wait: 2000 } });
                        const product = this.extractProductDetails(prodHtml, prodUrl);
                        if (product.name && product.imageUrl) {
                            allProducts.push({ mainCategory: 'Furniture', subCategory: 'Featured', family: brandName, model: product.model, description: product.description, imageUrl: product.imageUrl, productUrl: prodUrl, price: 0 });
                        }
                    } catch (e) { }
                }
            }
            if (onProgress) onProgress(100, 'Complete!');
        } catch (error) {
            console.error('Architonic Scrape Error', error);
        }
        const seen = new Set();
        const uniqueProducts = allProducts.filter(p => { const key = `${p.model}|${p.imageUrl}`; if (seen.has(key)) return false; seen.add(key); return true; });
        return { products: uniqueProducts, brandInfo: { name: brandName, logo: brandLogo } };
    }

    /**
     * Helper to scan for category links (Single Level)
     */
    scanForCategories($, baseUrl, ignoreUrl) {
        const categoryLinks = [];
        const seenUrls = new Set();

        $('a').each((i, el) => {
            const $el = $(el);
            const href = $el.attr('href');
            if (!href || href.includes('javascript') || href === '#') return;

            const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
            if (fullUrl === ignoreUrl || seenUrls.has(fullUrl)) return;

            // Allow /product-category/ or /products/
            if (!fullUrl.includes('/product-category/') && !fullUrl.includes('/category/') && !fullUrl.includes('/products/')) return;
            if (fullUrl.includes('uncategorized')) return;

            // Strategy: URL Pattern (Amara style)
            const isAmaraCategory = fullUrl.includes('/product-category/');

            // Text Fallback
            let text = $el.text().replace(/\s+/g, ' ').trim();
            let match = text.match(/^(.+?)\s*\(\s*(\d+)\s*\)$/);

            if (match) {
                const name = match[1].trim();
                categoryLinks.push({ url: fullUrl, name: name });
                seenUrls.add(fullUrl);
            } else if (isAmaraCategory) {
                const parts = fullUrl.split('/').filter(x => x);
                let nameFromUrl = parts[parts.length - 1];
                if (nameFromUrl === 'page' || /^\d+$/.test(nameFromUrl)) return;

                nameFromUrl = nameFromUrl.replace(/-/g, ' ').toUpperCase();
                if (!categoryLinks.some(c => c.name === nameFromUrl)) {
                    categoryLinks.push({ url: fullUrl, name: nameFromUrl });
                    seenUrls.add(fullUrl);
                }
            }
        });
        return categoryLinks;
    }

    /**
     * Universal scrape for non-Architonic sites (Credit Efficient)
     */
    async scrapeUniversal(url, onProgress = null) {
        console.log(`\n🐝 [ScrapingBee] Starting Universal Scrape: ${url}`);
        const allProducts = [];
        const baseUrl = new URL(url).origin;

        try {
            if (onProgress) onProgress(15, 'Fetching page...');
            const html = await this.fetchPage(url, { params: { wait: 5000, render_js: 'true' } });

            if (onProgress) onProgress(30, 'Extracting brand info...');
            let brandInfo = this.extractBrandInfo(html, url);
            // Fix Amara Brand Name
            if (url.includes('amara-art.com') && (brandInfo.name === 'Products' || brandInfo.name === 'Collections')) {
                brandInfo.name = 'AMARA';
            }

            // --- Helper: Extract Products with URL Parsing for Hierarchy ---
            const extractFromHtml = (htmlSource, defaultSub, defaultFamily) => {
                const $ = cheerio.load(htmlSource);
                const found = [];
                const selectors = ['.product', '.product-item', '.product-card', '[class*="product"]', 'li.item', 'div.item'];

                for (const selector of selectors) {
                    $(selector).each((i, el) => {
                        const $el = $(el);
                        let title = $el.find('h2, h3, h4, h5, .title, .name, .product-name').first().text().trim();
                        if (!title) title = $el.find('a').first().text().trim();

                        let imgSrc = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
                        let link = $el.find('a[href]').first().attr('href');

                        if (imgSrc && !imgSrc.startsWith('http')) imgSrc = new URL(imgSrc, baseUrl).href;
                        if (link && !link.startsWith('http') && link) link = new URL(link, baseUrl).href;

                        if (title && title.length > 2 && imgSrc && !imgSrc.includes('logo')) {
                            // Smart Hierarchy Extraction from URL
                            let subCategory = defaultSub;
                            let family = defaultFamily;

                            if (link && link.includes('amara-art.com')) {
                                try {
                                    // URL: .../product-category/products/outdoor/aluminum/slug
                                    const parts = new URL(link).pathname.split('/').filter(p => p && p !== 'product-category' && p !== 'product');
                                    const slug = parts.pop(); // Remove slug

                                    // Remaining parts are categories. E.g. ['products', 'outdoor', 'aluminum']
                                    // Remove 'products' if it's the root
                                    const cats = parts.filter(p => p !== 'products');

                                    if (cats.length >= 1) subCategory = cats[0].toUpperCase().replace(/-/g, ' ');
                                    if (cats.length >= 2) family = cats[1].toUpperCase().replace(/-/g, ' ');
                                } catch (e) { }
                            }

                            found.push({
                                mainCategory: 'Products',
                                subCategory: subCategory,
                                family: family,
                                model: title,
                                description: title,
                                imageUrl: imgSrc,
                                productUrl: link || url,
                                price: 0
                            });
                        }
                    });
                    if (found.length > 0) break;
                }
                return found;
            };

            // --- Step 1: Scan for Main Categories (Flat Scan - 1 Level) ---
            if (onProgress) onProgress(50, 'Scanning for categories...');
            const $ = cheerio.load(html);
            // Limit to first 10 categories to save credits if user has low balance
            const categories = this.scanForCategories($, baseUrl, url).slice(0, 10);

            if (categories.length > 0) {
                console.log(`   Found ${categories.length} categories. Scraping products (Credit Efficient Mode)...`);

                for (let i = 0; i < categories.length; i++) {
                    const cat = categories[i];
                    if (onProgress) onProgress(50 + Math.round((i / categories.length) * 40), `Scraping: ${cat.name}...`);

                    try {
                        const catHtml = await this.fetchPage(cat.url, { params: { wait: 3000 } });
                        // Extract products using URL parsing to get 'Aluminum' etc. without visiting 'Aluminum' page
                        const catProducts = extractFromHtml(catHtml, cat.name, brandInfo.name);
                        console.log(`      ${cat.name}: Found ${catProducts.length} products`);
                        allProducts.push(...catProducts);
                    } catch (e) {
                        console.error(`Failed category ${cat.name}: ${e.message}`);
                    }
                }
            } else {
                console.log('   No categories found. Scraping page directly.');
                const mainProducts = extractFromHtml(html, 'General', brandInfo.name);
                allProducts.push(...mainProducts);
            }

            if (onProgress) onProgress(90, `Found total ${allProducts.length} products`);

        } catch (error) {
            console.error('ScrapingBee universal error:', error.message);
            throw error;
        }

        const seen = new Set();
        const uniqueProducts = allProducts.filter(p => { const key = `${p.model}|${p.imageUrl}`; if (seen.has(key)) return false; seen.add(key); return true; });

        console.log(`\n✅ Universal scrape complete: ${uniqueProducts.length} products`);
        if (onProgress) onProgress(100, 'Complete!');

        return { products: uniqueProducts, brandInfo: { name: brandInfo.name || 'Brand', logo: brandInfo.logo } };
    }

    async scrapeBrand(url, onProgress = null) {
        if (!this.isConfigured()) throw new Error('ScrapingBee API key not configured.');
        if (url.includes('architonic.com')) return await this.scrapeArchitonic(url, onProgress);
        else return await this.scrapeUniversal(url, onProgress);
    }
}

export default ScrapingBeeScraper;
