/**
 * StructureScraper - A deterministic scraper designed to map 
 * Category -> Subcategory -> Product/Model hierarchy.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { PlaywrightCrawler, Configuration, log } from 'crawlee';
import { promises as fs } from 'fs';

class StructureScraper {
    constructor() {
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        this.timeout = 30000;

        // Product keywords to identify product links
        this.productKeywords = ['product', 'item', 'furniture', 'chair', 'desk', 'table', 'office', 'collection', 'catalog', 'series', 'seating', 'workstation', 'storage', 'meeting'];
        this.categoryKeywords = ['category', 'collection', 'products', 'furniture', 'office', 'catalogue', 'series'];
        this.excludeKeywords = [
            'contact', 'about', 'login', 'cart', 'privacy', 'social', 'news', 'blog', 'terms', 'careers', 'account', 'faq', 'help',
            'project', 'history', 'download', 'press', 'event', 'exhibition', 'case-study', 'award', 'designer', 'sustainability',
            'video', 'career', 'partner', 'showroom', 'location', 'search', 'media', 'document'
        ];
    }

    /**
     * Main entry point
     */
    async scrapeBrand(url, brandNameOverride = null, onProgress = null) {
        console.log(`\n🏗️ [Structure Scraper] Starting hierarchical harvest for: ${url}`);

        // Check if running on Vercel serverless (Playwright won't work)
        const isVercel = process.env.VERCEL === '1';
        if (isVercel) {
            console.error('❌ Structure scraping not supported on Vercel serverless.');
            throw new Error('Web scraping is not available in the deployed environment. Please use the local development server for scraping operations, then sync brands to the cloud.');
        }

        const products = [];
        const visitedUrls = new Set();
        const baseUrl = new URL(url).origin;

        if (onProgress) onProgress(10, 'Extracting Brand Identity...');
        // 1. Get Brand Info
        const brandInfo = await this.extractBrandInfo(url);
        const brandName = brandNameOverride || brandInfo.name;
        console.log(`   Brand Identifed: ${brandName}`);

        if (onProgress) onProgress(20, 'Scanning main categories...', brandName);

        const crawler = new PlaywrightCrawler({
            maxConcurrency: 2, // Reduced for CPU stability
            maxRequestsPerCrawl: 300,
            navigationTimeoutSecs: 60,
            headless: false, // Debugging: Show the browser!

            requestHandler: async ({ page, request, enqueueLinks }) => {
                // Check for external cancellation
                if (onProgress && onProgress.isCancelled && onProgress.isCancelled()) {
                    console.log('🛑 [Structure Scraper] Cancellation detected. Aborting...');
                    await crawler.autoscaledPool.abort();
                    return;
                }

                const { label, category, subCategory } = request.userData;
                const currentUrl = request.url;

                if (visitedUrls.has(currentUrl)) return;
                visitedUrls.add(currentUrl);

                console.log(`   📄 Harvesting: ${currentUrl} [${label || 'ROOT'}]`);
                if (onProgress && label === 'CATEGORY') {
                    onProgress(Math.min(90, 20 + (visitedUrls.size / 5)), `Harvesting ${category}...`);
                }

                // Wait for network idle to ensure JS has executed (important for sites like Amara Art)
                try {
                    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
                } catch (e) { }

                // Allow time for any fades/transitions
                await page.waitForTimeout(3000);

                if (!label || label === 'ROOT') {
                    // Try to handle "enter site" or language selection screens
                    await this.handleInterstitials(page);

                    // Find Main Categories
                    const categories = await this.discoverHierarchyLinks(page, baseUrl);
                    console.log(`   Found ${categories.length} main categories/links`);

                    // If no categories found on homepage, try /products or /collections specially
                    if (categories.length === 0) {
                        console.log('   ⚠️ No categories on homepage. Checking /products...');
                        const productsUrl = new URL('/products/', baseUrl).href;

                        try {
                            await page.goto(productsUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                            await this.handleInterstitials(page);

                            // Re-scan for categories on the products page
                            const prodCategories = await this.discoverHierarchyLinks(page, baseUrl);
                            if (prodCategories.length > 0) {
                                console.log(`   Found ${prodCategories.length} categories on /products`);
                                categories.push(...prodCategories);
                            } else {
                                // If still no categories, maybe the sidebar links are just filters? 
                                // Let's try to grab the "Name (Count)" links specifically seen on Amara Art
                                const sidebarCategories = await this.extractSidebarCategories(page, baseUrl);
                                if (sidebarCategories.length > 0) {
                                    console.log(`   Found ${sidebarCategories.length} sidebar categories`);
                                    categories.push(...sidebarCategories);
                                }
                            }
                        } catch (e) {
                            console.log('   ⚠️ Could not load /products page');
                        }
                    }

                    // Fallback: Direct homepage product extraction if still nothing
                    if (categories.length === 0) {
                        const directProducts = await this.extractProductsFromPage(page, brandName, 'General', 'Homepage');
                        if (directProducts.length > 0) {
                            products.push(...directProducts);
                            console.log(`      ✓ Extracted ${directProducts.length} products from Homepage`);
                        }
                    }

                    for (const cat of categories) {
                        await crawler.addRequests([{
                            url: cat.url,
                            userData: { label: 'CATEGORY', category: cat.title }
                        }]);
                    }
                } else if (label === 'CATEGORY') {
                    // Extract Products + Look for subcategories or pagination
                    const pageProducts = await this.extractProductsFromPage(page, brandName, category, subCategory || category);
                    products.push(...pageProducts);
                    console.log(`      ✓ Extracted ${pageProducts.length} products from ${category}`);

                    // Look for pagination (Next > or numbers)
                    const pagination = await this.findPagination(page, baseUrl);
                    for (const pg of pagination) {
                        if (!visitedUrls.has(pg)) {
                            // High priority to finish the category
                            await crawler.addRequests([{
                                url: pg,
                                userData: { label: 'CATEGORY', category, subCategory }
                            }]);
                        }
                    }
                }
            }
        }, new Configuration({
            storagePath: `./storage/structure_${Date.now()}`,
            purgeOnStart: true
        }));

        await crawler.run([{ url, userData: { label: 'ROOT' } }]);

        if (onProgress) onProgress(95, 'Finalizing data...');
        // Final cleanup & Deduplication
        const uniqueProducts = this.deduplicate(products);
        console.log(`\n✅ Structure Scraper completed. Found ${uniqueProducts.length} unique products.`);

        return {
            products: uniqueProducts,
            brandInfo: {
                name: brandName,
                logo: brandInfo.logo
            }
        };
    }

    async handleInterstitials(page) {
        try {
            // Click "Enter Site", "English", "Close", etc.
            await page.evaluate(() => {
                const keywords = ['enter', 'english', 'en', 'welcome', 'accept', 'agree', 'close', 'x', 'start'];
                const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
                const target = buttons.find(b => {
                    const text = b.innerText?.toLowerCase() || '';
                    // Must be short text to avoid clicking random paragraphs
                    return keywords.some(k => text.includes(k)) && text.length < 20 && b.offsetParent !== null;
                });
                if (target) target.click();
            });
            await page.waitForTimeout(2000);
        } catch (e) { }
    }

    async extractSidebarCategories(page, baseUrl) {
        return await page.evaluate(({ baseUrl }) => {
            const links = [];
            const seenUrls = new Set();

            // Look for links that contain parentheses with numbers, e.g. "Chairs (12)"
            const allLinks = document.querySelectorAll('a');

            allLinks.forEach(a => {
                const text = a.innerText.trim();
                // Match "Anything (Number)" - non-greedy match for name
                const match = text.match(/^(.+?)\s*\((\d+)\)$/);

                if (match) {
                    const name = match[1].trim();
                    const href = a.getAttribute('href');
                    if (!href || href === '#' || href.startsWith('javascript')) return;

                    try {
                        const fullUrl = new URL(href, baseUrl).href;
                        if (!seenUrls.has(fullUrl)) {
                            seenUrls.add(fullUrl);
                            links.push({
                                title: name,
                                url: fullUrl
                            });
                        }
                    } catch (e) { }
                }
            });
            return links;
        }, { baseUrl });
    }

    async discoverHierarchyLinks(page, baseUrl) {
        return await page.evaluate(({ baseUrl, productKeywords, categoryKeywords, excludeKeywords }) => {
            const links = [];
            const seenUrls = new Set();

            const allLinks = document.querySelectorAll('a[href]');
            allLinks.forEach(a => {
                const href = a.getAttribute('href');
                if (!href || href === '#' || href.startsWith('javascript')) return;

                let fullUrl;
                try {
                    fullUrl = new URL(href, baseUrl).href;
                } catch (e) { return; }

                if (!fullUrl.startsWith(baseUrl)) return;
                if (seenUrls.has(fullUrl)) return;

                const text = a.innerText.trim();
                const textLower = text.toLowerCase();
                const urlLower = fullUrl.toLowerCase();

                // Skip excludes
                if (excludeKeywords.some(k => urlLower.includes(k) || textLower.includes(k))) return;

                // Priority: Navigation menus, category-like words
                const isNav = !!a.closest('nav, header, .menu, .navigation, .sidebar');
                const hasKeyword = productKeywords.some(k => urlLower.includes(k) || textLower.includes(k)) ||
                    categoryKeywords.some(k => urlLower.includes(k) || textLower.includes(k));

                if (isNav || hasKeyword) {
                    if (text.length > 2 && text.length < 50) {
                        seenUrls.add(fullUrl);
                        links.push({
                            url: fullUrl,
                            title: text
                        });
                    }
                }
            });
            return links;
        }, { baseUrl, productKeywords: this.productKeywords, categoryKeywords: this.categoryKeywords, excludeKeywords: this.excludeKeywords });
    }

    async extractProductsFromPage(page, brandName, category, subCategory) {
        return await page.evaluate(({ brandName, category, subCategory }) => {
            const products = [];
            const seen = new Set();

            // Generic search for product containers
            // Look for blocks that have an image and a title
            const potentialContainers = document.querySelectorAll('div, li, article, section');

            potentialContainers.forEach(el => {
                // Heuristic: Must have at least one image and one link/heading
                const img = el.querySelector('img');
                const link = el.querySelector('a[href]');
                const heading = el.querySelector('h1, h2, h3, h4, h5, .title, .name');

                if (img && link && (heading || link.innerText.length > 5)) {
                    // Check if it's "too large" (like a whole section)
                    if (el.innerText.length > 2000) return;

                    const name = (heading ? heading.innerText : link.innerText).trim();
                    if (!name || name.length < 3 || seen.has(name)) return;

                    let imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('srcset')?.split(' ')[0];
                    if (!imageUrl) return;

                    // Exclude common UI icons
                    const lowerImg = imageUrl.toLowerCase();
                    if (['logo', 'icon', 'arrow', 'chevron', 'dot', 'placeholder'].some(k => lowerImg.includes(k))) return;

                    seen.add(name);
                    products.push({
                        mainCategory: category || 'General',
                        subCategory: subCategory || 'General',
                        family: brandName,
                        model: name,
                        description: name, // Default to name
                        imageUrl: imageUrl,
                        productUrl: link.href,
                        price: 0
                    });
                }
            });

            return products;
        }, { brandName, category, subCategory });
    }

    async findPagination(page, baseUrl) {
        return await page.evaluate((baseUrl) => {
            const pgLinks = [];
            const seen = new Set();
            const selectors = ['.pagination a', '.pager a', 'a[class*="page"]', 'a[href*="page="]'];

            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(a => {
                    try {
                        const href = new URL(a.getAttribute('href'), baseUrl).href;
                        if (href.startsWith(baseUrl) && !seen.has(href)) {
                            seen.add(href);
                            pgLinks.push(href);
                        }
                    } catch (e) { }
                });
            });
            return pgLinks;
        }, baseUrl);
    }

    async extractBrandInfo(url) {
        // Fallback info extractor
        try {
            const res = await axios.get(url, { headers: { 'User-Agent': this.userAgent }, timeout: 10000 });
            const $ = cheerio.load(res.data);
            let name = $('title').text().split(/[|–\-:]/)[0].trim();
            if (!name) name = new URL(url).hostname.replace('www.', '').split('.')[0];

            let logo = '';
            $('img[src*="logo" i]').each((i, el) => {
                logo = $(el).attr('src');
                if (logo) {
                    if (!logo.startsWith('http')) logo = new URL(logo, url).href;
                    return false;
                }
            });
            return { name, logo };
        } catch (e) {
            return { name: 'Unknown', logo: '' };
        }
    }

    deduplicate(products) {
        const seen = new Set();
        return products.filter(p => {
            const key = `${p.model}|${p.productUrl}`.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}

export default StructureScraper;
