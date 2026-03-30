/**
 * Browserless Cloud Scraper
 * Uses Browserless.io for headless Chrome in the cloud - works on Vercel serverless
 */

import puppeteer from 'puppeteer-core';
import axios from 'axios';
import * as cheerio from 'cheerio';

// Helper function to delay (Puppeteer doesn't have waitForTimeout)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class BrowserlessScraper {
    constructor() {
        this.browserlessEndpoint = process.env.BROWSERLESS_API_KEY
            ? `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`
            : null;

        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    /**
     * Check if Browserless is configured
     */
    isConfigured() {
        return !!process.env.BROWSERLESS_API_KEY;
    }

    /**
     * Get browser connection with timeout - either local Puppeteer or Browserless cloud
     */
    async getBrowser() {
        if (!this.browserlessEndpoint) {
            throw new Error('BROWSERLESS_API_KEY is not configured. Please add it to your environment variables.');
        }

        console.log('🌐 Connecting to Browserless.io cloud browser...');

        // Add connection timeout (30 seconds)
        const connectionPromise = puppeteer.connect({
            browserWSEndpoint: this.browserlessEndpoint
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Browserless connection timeout after 30 seconds')), 30000)
        );

        try {
            const browser = await Promise.race([connectionPromise, timeoutPromise]);
            console.log('✅ Connected to cloud browser');
            return browser;
        } catch (error) {
            console.error('❌ Browserless connection failed:', error.message);
            throw new Error(`Failed to connect to Browserless: ${error.message}. Check your API key or try again.`);
        }
    }

    /**
     * Extract brand info from page
     */
    async extractBrandInfo(url) {
        try {
            const res = await axios.get(url, {
                headers: { 'User-Agent': this.userAgent },
                timeout: 10000
            });
            const $ = cheerio.load(res.data);

            let name = $('title').text().split(/[|–\-:]/)[0].trim();
            if (!name) name = new URL(url).hostname.replace('www.', '').split('.')[0];

            let logo = '';
            const logoSelectors = [
                '.custom-logo', '.site-logo img', '.logo img', 'a.logo img',
                'header img[src*="logo"]', '.navbar-brand img', '[class*="logo"] img',
                'img[alt*="logo" i]', 'img[class*="logo" i]'
            ];

            for (const sel of logoSelectors) {
                const src = $(sel).first().attr('src') || $(sel).first().attr('data-src');
                if (src && src.length > 0) {
                    logo = src.startsWith('http') ? src : new URL(src, url).href;
                    break;
                }
            }

            return { name, logo };
        } catch (e) {
            return { name: 'Unknown', logo: '' };
        }
    }

    /**
     * Main scrape method for Architonic using Browserless
     */
    async scrapeArchitonic(url, onProgress = null) {
        console.log(`\n🏗️ [Browserless] Starting Architonic Scrape: ${url}`);

        let browser;
        const allProducts = [];
        let brandName = 'Architonic Brand';
        let brandLogo = '';

        try {
            browser = await this.getBrowser();
            const page = await browser.newPage();

            // Set viewport and user agent
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent(this.userAgent);

            // Block heavy resources to save bandwidth/time
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const type = req.resourceType();
                if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            if (onProgress) onProgress(15, 'Navigating to brand page...');

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await delay(3000);

            // Extract brand name
            if (onProgress) onProgress(20, 'Identifying brand...');

            brandName = await page.$eval('h1', el => el.innerText).catch(() => '');
            if (brandName) {
                brandName = brandName
                    .replace(/Collections by/i, '')
                    .replace(/Products by/i, '')
                    .replace(/Collections/i, '')
                    .replace(/Products/i, '')
                    .trim();
            }

            if (!brandName || brandName.length < 2) {
                const title = await page.title();
                brandName = title.split('|')[0]
                    .replace(/Architonic/i, '')
                    .trim() || 'Architonic Brand';
            }

            console.log(`   Brand identified: ${brandName}`);
            if (onProgress) onProgress(25, `Found: ${brandName}`, brandName);

            // Try to get logo
            try {
                brandLogo = await page.$eval('img[src*="logo"]', el => el.src);
            } catch (e) { brandLogo = ''; }

            // Close any popups
            await page.evaluate(() => {
                const closeTerms = ['maybe later', 'i accept', 'close', 'continue', 'agree', 'accept all'];
                document.querySelectorAll('button, a').forEach(b => {
                    const text = b.innerText.toLowerCase();
                    if (closeTerms.some(term => text.includes(term))) {
                        try { b.click(); } catch (e) { }
                    }
                });
            });
            await delay(2000);

            // Find collection links
            if (onProgress) onProgress(30, 'Discovering collections...');

            const collectionLinks = await page.$$eval('a', (els, baseUrl) => {
                return els
                    .map(el => el.href)
                    .filter(href => {
                        if (!href || !href.includes('architonic.com')) return false;
                        return href.includes('/collection/') ||
                            href.includes('/collections/') ||
                            href.includes('/products/');
                    });
            }, url);

            const uniqueCollections = [...new Set(collectionLinks)].slice(0, 20); // Increased for better coverage
            console.log(`   Found ${uniqueCollections.length} collections to scrape`);

            // Also find direct product links on main page
            const directProducts = await page.$$eval('a', (els) => {
                return els
                    .map(el => el.href)
                    .filter(href => href && href.includes('/p/') && href.includes('architonic.com'));
            });

            const uniqueDirectProducts = [...new Set(directProducts)].slice(0, 100); // Increased
            console.log(`   Found ${uniqueDirectProducts.length} direct product links`);

            // Scrape each collection
            let collectionIndex = 0;
            for (const collUrl of uniqueCollections) {
                collectionIndex++;
                const progress = 30 + Math.round((collectionIndex / uniqueCollections.length) * 40);

                try {
                    if (onProgress) onProgress(progress, `Scraping collection ${collectionIndex}/${uniqueCollections.length}...`);

                    await page.goto(collUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await delay(2000);

                    // Get collection name
                    let collectionName = await page.$eval('h1', el => el.innerText).catch(() => 'Collection');

                    // Scroll to load more products - increased iterations
                    await page.evaluate(async () => {
                        for (let i = 0; i < 15; i++) {
                            window.scrollBy(0, 1500);
                            await new Promise(r => setTimeout(r, 600));
                            // Try to click Load More if visible
                            const loadMore = Array.from(document.querySelectorAll('button, a')).find(el =>
                                el.innerText.toLowerCase().includes('load more') ||
                                el.innerText.toLowerCase().includes('show more')
                            );
                            if (loadMore) try { loadMore.click(); } catch (e) { }
                        }
                    });

                    // Find product links in collection
                    const productLinks = await page.$$eval('a', (els) => {
                        return els
                            .map(el => el.href)
                            .filter(href => href && /\/p\/[a-z0-9-]+\d+\/?/i.test(href));
                    });

                    const uniqueProductLinks = [...new Set(productLinks)].slice(0, 100); // Increased to 100
                    console.log(`   📦 ${collectionName}: ${uniqueProductLinks.length} products`);

                    // Scrape each product
                    for (const prodUrl of uniqueProductLinks) {
                        try {
                            await page.goto(prodUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                            await delay(1500);

                            const productData = await page.evaluate(() => {
                                const name = document.querySelector('h1')?.innerText?.trim() || '';

                                // Find product image - IMPROVED to match original scraper
                                let imageUrl = '';
                                const allImgs = Array.from(document.querySelectorAll('img'));

                                // 1. Target the ACTIVE carousel image (opacity-100 class)
                                const activeVariantImg = allImgs.find(i =>
                                    (i.classList.contains('opacity-100') || i.classList.contains('active')) &&
                                    i.src.includes('architonic.com') &&
                                    !i.src.includes('/family/')
                                );
                                if (activeVariantImg) imageUrl = activeVariantImg.src;

                                // 2. Look for images with '/product/' in URL
                                if (!imageUrl) {
                                    const productImg = allImgs.find(i =>
                                        i.src.includes('/product/') &&
                                        (i.classList.contains('object-contain') || i.width > 200)
                                    );
                                    if (productImg) imageUrl = productImg.src;
                                }

                                // 3. Fallback selectors
                                if (!imageUrl) {
                                    const selectors = [
                                        '#product-page section img.opacity-100',
                                        '.product-gallery__main-image img',
                                        'img[itemprop="image"]',
                                        '.product-image img',
                                        'main img[src*="/product/"]'
                                    ];
                                    for (const sel of selectors) {
                                        const el = document.querySelector(sel);
                                        if (el && el.src && el.src.startsWith('http') && !el.src.includes('/family/')) {
                                            imageUrl = el.src;
                                            break;
                                        }
                                    }
                                }

                                // 4. Last fallback
                                if (!imageUrl) {
                                    const anyImg = allImgs.find(i =>
                                        i.width > 200 &&
                                        i.src.startsWith('http') &&
                                        i.src.includes('architonic.com') &&
                                        !i.src.includes('logo')
                                    );
                                    if (anyImg) imageUrl = anyImg.src;
                                }

                                // Get description - IMPROVED: try multiple sources
                                let description = '';

                                // Try meta description first
                                description = document.querySelector('meta[name="description"]')?.content || '';

                                // If short, try to get from page content
                                if (!description || description.length < 50) {
                                    // Try attribute elements
                                    const attrElements = Array.from(document.querySelectorAll('div[class*="Attribute"]'));
                                    if (attrElements.length > 0) {
                                        description = attrElements.map(el => el.innerText.trim()).join(' | ');
                                    }
                                }

                                // Try other content selectors
                                if (!description || description.length < 50) {
                                    const contentSelectors = ['.product-description', '#description', '.details-content', '.font-book.leading-normal'];
                                    for (const sel of contentSelectors) {
                                        const el = document.querySelector(sel);
                                        if (el && el.innerText.length > 30) {
                                            description = el.innerText.trim();
                                            break;
                                        }
                                    }
                                }

                                // Try to get variant-specific category
                                const subTitle = document.querySelector('h1 + div a span')?.innerText?.trim() || '';
                                if (subTitle && !description.includes(subTitle)) {
                                    description = `${subTitle}. ${description}`;
                                }

                                if (!description) description = name;

                                return { name, imageUrl, description };
                            });

                            if (productData.name && productData.imageUrl) {
                                // Add variant ID from URL (like original scraper)
                                let variantModel = productData.name;
                                try {
                                    const urlParts = prodUrl.split('/').filter(Boolean);
                                    const lastPart = urlParts[urlParts.length - 1];
                                    const idMatch = lastPart.match(/-(\\d+)$/);
                                    if (idMatch && idMatch[1]) {
                                        variantModel = `${productData.name} #${idMatch[1]}`;
                                    }
                                } catch (e) { }

                                allProducts.push({
                                    mainCategory: 'Furniture',
                                    subCategory: collectionName,
                                    family: brandName,
                                    model: variantModel,
                                    description: productData.description,
                                    imageUrl: productData.imageUrl,
                                    productUrl: prodUrl,
                                    price: 0
                                });

                                if (onProgress) {
                                    const prog = Math.min(90, progress + Math.round((allProducts.length / 50) * 20));
                                    onProgress(prog, `[${allProducts.length}] ${variantModel}`);
                                }
                            }
                        } catch (prodError) {
                            console.log(`   ⚠️ Failed to scrape product: ${prodUrl}`);
                        }
                    }
                } catch (collError) {
                    console.log(`   ⚠️ Failed to scrape collection: ${collUrl}`);
                }
            }

            // Also scrape direct products found on main page
            if (uniqueDirectProducts.length > 0 && allProducts.length < 50) {
                if (onProgress) onProgress(80, 'Scraping featured products...');

                for (const prodUrl of uniqueDirectProducts.slice(0, 20)) {
                    try {
                        await page.goto(prodUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                        await delay(1500);

                        const productData = await page.evaluate(() => {
                            const name = document.querySelector('h1')?.innerText?.trim() || '';
                            let imageUrl = '';
                            const imgs = Array.from(document.querySelectorAll('img'));
                            const productImg = imgs.find(i => i.width > 200 && i.src.includes('architonic.com'));
                            if (productImg) imageUrl = productImg.src;
                            const desc = document.querySelector('meta[name="description"]')?.content || name;
                            return { name, imageUrl, description: desc };
                        });

                        if (productData.name && productData.imageUrl) {
                            allProducts.push({
                                mainCategory: 'Furniture',
                                subCategory: 'Featured',
                                family: brandName,
                                model: productData.name,
                                description: productData.description,
                                imageUrl: productData.imageUrl,
                                productUrl: prodUrl,
                                price: 0
                            });
                        }
                    } catch (e) { }
                }
            }

            if (onProgress) onProgress(95, 'Finalizing...');

        } catch (error) {
            console.error('Browserless scrape error:', error.message);

            // If we have some products, return them even on partial failure
            if (allProducts.length > 0) {
                console.log(`⚠️ Partial scrape: returning ${allProducts.length} products despite error`);
                if (onProgress) onProgress(90, `Partial result: ${allProducts.length} products (error: ${error.message})`);
            } else {
                // No products at all - throw the error
                throw new Error(`Scraping failed: ${error.message}`);
            }
        } finally {
            if (browser) {
                try {
                    await browser.close();
                    console.log('🔒 Browser closed');
                } catch (closeError) {
                    console.error('Error closing browser:', closeError.message);
                }
            }
        }

        // Deduplicate
        const seen = new Set();
        const uniqueProducts = allProducts.filter(p => {
            const key = `${p.model}|${p.imageUrl}`.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        console.log(`\n✅ Browserless scrape complete: ${uniqueProducts.length} products`);
        if (onProgress) onProgress(100, 'Complete!');

        return {
            products: uniqueProducts,
            brandInfo: { name: brandName, logo: brandLogo }
        };
    }

    /**
     * Universal scrape for non-Architonic sites
     */
    async scrapeUniversal(url, onProgress = null) {
        console.log(`\n🌐 [Browserless] Starting Universal Scrape: ${url}`);

        let browser;
        const allProducts = [];
        const baseUrl = new URL(url).origin;

        // Get brand info first (no browser needed)
        const brandInfo = await this.extractBrandInfo(url);
        const brandName = brandInfo.name;

        if (onProgress) onProgress(15, `Identified: ${brandName}`, brandName);

        try {
            browser = await this.getBrowser();
            const page = await browser.newPage();

            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent(this.userAgent);

            // Block heavy resources
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const type = req.resourceType();
                if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            if (onProgress) onProgress(20, 'Navigating to site...');

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await delay(3000);

            // Scroll to load content
            await page.evaluate(async () => {
                for (let i = 0; i < 10; i++) {
                    window.scrollBy(0, 1000);
                    await new Promise(r => setTimeout(r, 500));
                }
            });

            if (onProgress) onProgress(40, 'Extracting products...');

            // Generic product extraction
            const products = await page.evaluate(({ brandName, baseUrl }) => {
                const items = [];
                const seen = new Set();

                // Look for product-like containers
                const selectors = [
                    '.product', '.product-item', '.product-card',
                    '[class*="product"]', '[class*="item"]',
                    '.grid-item', '.catalog-item'
                ];

                for (const selector of selectors) {
                    document.querySelectorAll(selector).forEach(el => {
                        // Find title
                        const titleEl = el.querySelector('h2, h3, h4, .title, .name, [class*="title"], [class*="name"]');
                        const title = titleEl?.innerText?.trim() || '';

                        if (!title || title.length < 3 || seen.has(title.toLowerCase())) return;

                        // Find image
                        const imgEl = el.querySelector('img');
                        let imageUrl = imgEl?.src || imgEl?.dataset?.src || '';

                        if (!imageUrl || imageUrl.includes('logo') || imageUrl.includes('icon')) return;

                        // Find link
                        const linkEl = el.querySelector('a[href]');
                        let productUrl = linkEl?.href || '';

                        seen.add(title.toLowerCase());
                        items.push({
                            mainCategory: 'Products',
                            subCategory: 'General',
                            family: brandName,
                            model: title,
                            description: title,
                            imageUrl: imageUrl.startsWith('http') ? imageUrl : new URL(imageUrl, baseUrl).href,
                            productUrl: productUrl,
                            price: 0
                        });
                    });

                    if (items.length > 0) break; // Stop if we found products
                }

                return items;
            }, { brandName, baseUrl });

            allProducts.push(...products);

            if (onProgress) onProgress(80, `Found ${allProducts.length} products`);

        } catch (error) {
            console.error('Browserless universal scrape error:', error.message);
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }

        console.log(`\n✅ Universal scrape complete: ${allProducts.length} products`);
        if (onProgress) onProgress(100, 'Complete!');

        return {
            products: allProducts,
            brandInfo
        };
    }

    /**
     * Main entry point
     */
    async scrapeBrand(url, onProgress = null) {
        if (!this.isConfigured()) {
            throw new Error('Browserless API key not configured. Please add BROWSERLESS_API_KEY to your environment variables. Get a free key at https://browserless.io');
        }

        if (url.includes('architonic.com')) {
            return await this.scrapeArchitonic(url, onProgress);
        } else {
            return await this.scrapeUniversal(url, onProgress);
        }
    }
}

export default BrowserlessScraper;
