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
            // Ensure headless on production (Railway), optional debug locally
            headless: true,

            // Important: Masquerade as real browser
            launchContext: {
                useChrome: false,
                userAgent: this.userAgent,
                launchOptions: {
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
                }
            },

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

                try {
                    // Randomize mouse movements/viewport to look human
                    await page.setViewportSize({ width: 1366, height: 768 });
                } catch (e) { }

                // Wait for network idle to ensure JS has executed (important for sites like Amara Art)
                try {
                    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
                } catch (e) { }

                // Allow time for any fades/transitions
                await page.waitForTimeout(3000);

                if (!label || label === 'ROOT') {
                    // Try to handle "enter site" or language selection screens
                    await this.handleInterstitials(page);

                    const title = await page.title();
                    console.log(`   🌍 Page Title: ${title}`);
                    if (title.includes('Just a moment') || title.includes('Attention Required')) {
                        console.error('   🛑 BLOCKED BY CLOUDFLARE/BOT DETECTION');
                        throw new Error('Bot Detection Triggered');
                    }

                    // ⚡ IMPROVED: Extract Brand Info using Playwright (Real Browser)
                    // This fixes issues where Axios misses og:image or dynamic content
                    if (!brandInfo.logo || brandInfo.logo.includes('placeholder')) {
                        console.log('   🕵️‍♂️ Attempting to refine brand logo via Playwright...');
                        try {
                            const pageLogo = await page.evaluate(() => {
                                // 1. Check og:image (Best for Architonic)
                                const og = document.querySelector('meta[property="og:image"]');
                                // ... extraction logic ...
                                const h1 = document.querySelector('h1')?.innerText;
                                return {
                                    og: og ? og.content : null,
                                    logoSelectors: !!document.querySelector('.nt-brand-header__logo img'),
                                    h1
                                };
                            });

                            console.log('     Page Analysis:', JSON.stringify(pageLogo));

                            const actualLogo = await page.evaluate(() => {
                                const og = document.querySelector('meta[property="og:image"]');
                                if (og && og.content && og.content.includes('logo')) return og.content;
                                // ... existing selector logic ...
                                const selectors = [
                                    '.nt-brand-header__logo img',
                                    '.brand-logo img',
                                    'img[alt*="Logo"]',
                                    'img[src*="logo"]'
                                ];
                                for (const s of selectors) {
                                    const el = document.querySelector(s);
                                    if (el && el.src) return el.src;
                                }
                                return null;
                            });

                            if (actualLogo) {
                                let refinedLogo = actualLogo;
                                // Cleanup
                                if (refinedLogo.startsWith('//')) refinedLogo = 'https:' + refinedLogo;
                                // Architonic cleanup
                                if (refinedLogo.includes('media.architonic.com') && refinedLogo.includes('?')) {
                                    refinedLogo = refinedLogo.split('?')[0];
                                }
                                console.log(`      ✓ Refined Logo found: ${refinedLogo}`);
                                brandInfo.logo = refinedLogo;
                            }
                        } catch (e) { console.log('      ⚠️ Logo refinement failed:', e.message); }
                    }

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

    // ===================== INTELLIGENT EXTRACTION LOGIC (Ported from Universal Scraper) =====================

    async analyzePage(page) {
        // Common product container selectors
        const productContainerSelectors = [
            '.product', 'li.product', '.products .product',
            '.product-item', '.product-card', '.product-box', '.product-tile',
            '[class*="product-item"]', '[class*="product-card"]', '[class*="ProductCard"]',
            '.grid-item', '.catalog-item', '.collection-item', '.shop-item',
            '.card', '.item-card', '.furniture-item',
            '[data-product]', '[data-item]'
        ];

        const titleSelectors = [
            'h2', 'h3', 'h4',
            '.product-title', '.product-name', '.item-title',
            '[class*="product-title"]', '[class*="product-name"]',
            '.title', '.name', 'a[title]'
        ];

        return await page.evaluate(({ containerSelectors, titleSelectors }) => {
            const results = [];
            for (const selector of containerSelectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length < 2) continue; // Need at least 2 to be a list

                    let score = 0;
                    let hasTitle = 0;
                    let hasImage = 0;
                    let hasLink = 0;

                    elements.forEach(el => {
                        const titleEl = el.querySelector(titleSelectors.join(','));
                        if (titleEl && titleEl.innerText.trim().length > 3) hasTitle++;
                        if (el.querySelector('img')) hasImage++;
                        if (el.querySelector('a[href]')) hasLink++;
                    });

                    // Scoring
                    score = (hasTitle / elements.length) * 30 +
                        (hasImage / elements.length) * 40 +
                        (hasLink / elements.length) * 30;

                    if (score > 50) {
                        results.push({
                            selector,
                            count: elements.length,
                            score,
                            hasTitle: hasTitle > 0,
                            hasImage: hasImage > 0
                        });
                    }
                } catch (e) { }
            }
            results.sort((a, b) => b.score - a.score);
            return results.slice(0, 1); // Best match
        }, { containerSelectors, titleSelectors });
    }

    async extractProducts(page, selector, brandName, category, subCategory) {
        return await page.evaluate(({ selector, brandName, category, subCategory }) => {
            const items = [];
            const seen = new Set();
            const containers = document.querySelectorAll(selector);

            containers.forEach(el => {
                // Extract Title
                let title = '';
                const titleEl = el.querySelector('h2, h3, h4, .title, .name, [class*="product-title"]');
                if (titleEl) title = titleEl.innerText.trim();
                if (!title) title = el.getAttribute('title') || '';

                if (!title || title.length < 2 || seen.has(title)) return;

                // Extract Image
                let imageUrl = '';
                const img = el.querySelector('img');
                if (img) {
                    imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
                    if (imageUrl && !imageUrl.startsWith('http')) {
                        // Will fix in Node
                    }
                }
                if (!imageUrl) return;

                // Extract Link
                const linkEl = el.querySelector('a[href]');
                const productUrl = linkEl ? linkEl.href : '';

                const lowerImg = imageUrl.toLowerCase();
                const ignore = ['logo', 'icon', 'arrow', 'placeholder', 'blank', 'loading'];
                if (ignore.some(k => lowerImg.includes(k))) return;

                seen.add(title);
                items.push({
                    mainCategory: category || 'General',
                    subCategory: subCategory || 'General',
                    family: brandName,
                    model: title,
                    description: title,
                    imageUrl,
                    productUrl,
                    price: 0
                });
            });
            return items;
        }, { selector, brandName, category, subCategory });
    }

    async extractProductsFromPage(page, brandName, category, subCategory) {
        // Wrapper: Analyze then Extract
        const analysis = await this.analyzePage(page);
        if (analysis.length > 0) {
            console.log(`      ⚡ Intelligent selector found: ${analysis[0].selector} (score: ${analysis[0].score.toFixed(0)})`);
            return await this.extractProducts(page, analysis[0].selector, brandName, category, subCategory);
        } else {
            console.log('      ⚠️ No structure detected, using fallback extraction...');
            // Minimal fallback for non-structured lists
            return await page.evaluate(({ brandName, category, subCategory }) => {
                const products = [];
                // Very basic fallback looking for any article/div with img+link
                const candidates = document.querySelectorAll('article, .item, .cell');
                candidates.forEach(el => {
                    const img = el.querySelector('img');
                    const link = el.querySelector('a');
                    if (img && link && link.innerText.length > 3) {
                        products.push({
                            mainCategory: category, subCategory, family: brandName,
                            model: link.innerText.trim(), imageUrl: img.src, productUrl: link.href
                        });
                    }
                });
                return products;
            }, { brandName, category, subCategory });
        }
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
        try {
            const isArchitonic = url.includes('architonic.com');
            const res = await axios.get(url, { headers: { 'User-Agent': this.userAgent }, timeout: 10000 });
            const $ = cheerio.load(res.data);

            // Name Extraction
            let name = $('title').text().split(/[|–\-:]/)[0].trim();
            if (isArchitonic) {
                // Architonic clean name
                const h1 = $('h1').text().trim();
                if (h1) name = h1;
            }
            if (!name) name = new URL(url).hostname.replace('www.', '').split('.')[0];

            let logo = '';

            // Architonic Specific Logic
            if (isArchitonic) {
                // Check meta og:image first (Most reliable)
                const ogImage = $('meta[property="og:image"]').attr('content');
                if (ogImage && ogImage.includes('logo')) {
                    logo = ogImage;
                }

                if (!logo) {
                    const selectors = [
                        '.nt-brand-header__logo img',   // New Architonic
                        '.brand-logo img',              // Standard
                        '.manufacturer-logo img',
                        `img[alt^="${name}"]`,          // Starts with Brand Name
                        '.header-logo img'
                    ];

                    for (const sel of selectors) {
                        const el = $(sel).first();
                        if (el.length) {
                            const src = el.attr('src') || el.attr('data-src');
                            if (src && !src.includes('placeholder')) {
                                logo = src;
                                break;
                            }
                        }
                    }
                }
            }

            // Fallback: Generic 'logo' search
            if (!logo) {
                // Get all images
                const images = $('img').toArray();

                // Score them
                const candidates = [];
                images.forEach(el => {
                    const src = $(el).attr('src') || $(el).attr('data-src') || '';
                    if (!src || src.length < 5) return;

                    const alt = $(el).attr('alt') || '';
                    const lowerSrc = src.toLowerCase();
                    const lowerAlt = alt.toLowerCase();

                    let score = 0;
                    if (lowerSrc.includes('logo')) score += 10;
                    if (lowerAlt.includes(name.toLowerCase())) score += 20;
                    if (lowerSrc.includes('brand')) score += 5;

                    // Penalize generic site icons
                    if (lowerSrc.includes('architonic-logo')) score -= 100;
                    if (lowerSrc.includes('footer')) score -= 50;
                    if (lowerSrc.includes('social')) score -= 50;
                    if (lowerSrc.includes('icon')) score -= 20;
                    if (lowerSrc.includes('placeholder')) score -= 50;
                    if (lowerSrc.includes('blank')) score -= 50;

                    if (score > 0) candidates.push({ src, score });
                });

                candidates.sort((a, b) => b.score - a.score);
                if (candidates.length > 0) logo = candidates[0].src;
            }

            // Normalize URL
            if (logo) {
                if (!logo.startsWith('http')) {
                    logo = new URL(logo, url).href;
                }
                // Architonic cleanup: remove query params to get full res PNG
                // e.g. .../logo.png?width=96&format=webp -> .../logo.png
                if (logo.includes('media.architonic.com') && logo.includes('?')) {
                    logo = logo.split('?')[0];
                }
            }

            console.log(`      Brand Info Found: ${name} (Logo: ${logo ? 'Yes' : 'No'})`);

            return { name, logo };
        } catch (e) {
            console.warn('Brand Extraction Failed:', e.message);
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
