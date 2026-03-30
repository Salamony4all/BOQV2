/**
 * Universal Web Scraper for Furniture Websites
 * 
 * Supports multiple website layouts:
 * - WooCommerce (existing)
 * - Custom PHP/HTML sites (M&W, Las, etc.)
 * - React/Vue SPAs
 * - Architonic (multi-brand platform)
 * 
 * Strategy: Intelligent product detection using multiple patterns
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { PlaywrightCrawler, CheerioCrawler, Configuration, log } from 'crawlee';
import { promises as fs } from 'fs';
import path from 'path';

class ScraperService {
    constructor() {
        this.config = {
            timeout: 20000,
            maxConcurrency: 3,
            maxRequestsPerCrawl: 500,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        // Common product URL patterns for furniture sites
        this.productUrlPatterns = [
            '/product/', '/products/', '/p/', '/item/', '/items/',
            '/furniture/', '/collection/', '/collections/',
            '/catalog/', '/shop/', '/categories/', '/category/'
        ];

        // Common product container selectors (expanded)
        this.productContainerSelectors = [
            // WooCommerce
            '.product', 'li.product', '.products .product',
            // Generic product grids
            '.product-item', '.product-card', '.product-box', '.product-tile',
            '[class*="product-item"]', '[class*="product-card"]', '[class*="ProductCard"]',
            // Grid items
            '.grid-item', '.catalog-item', '.collection-item', '.shop-item',
            '[class*="grid-item"]', '[class*="catalog-item"]',
            // Card patterns
            '.card', '.item-card', '.furniture-item',
            // Custom layouts
            '.article-item', '.portfolio-item', '.gallery-item',
            // Data attributes
            '[data-product]', '[data-item]', '[data-product-id]',
            // Common frameworks
            '.col-item', '.masonry-item', '.isotope-item'
        ];

        // Title/name selectors
        this.titleSelectors = [
            'h2', 'h3', 'h4',
            '.product-title', '.product-name', '.item-title', '.item-name',
            '[class*="product-title"]', '[class*="product-name"]', '[class*="ProductName"]',
            '.title', '.name', '.heading',
            'a[title]'
        ];

        // Image selectors
        this.imageSelectors = [
            'img',
            'picture img', 'picture source',
            '[data-src]', '[data-lazy-src]', '[data-original]',
            '.product-image img', '.product-img img',
            '[class*="product-image"] img', '[class*="ProductImage"] img'
        ];

        // === MEMORY OPTIMIZATION FOR VERCEL HOBBY PLAN (2048 MB) ===
        log.setLevel(log.LEVELS.WARNING);

        // Configure Crawlee for low-memory environment
        process.env.CRAWLEE_MEMORY_MB = '1800'; // Leave headroom below 2048 limit
        process.env.CRAWLEE_AVAILABLE_MEMORY_RATIO = '0.85'; // Conservative ratio

        const config = Configuration.getGlobalConfig();
        config.set('logLevel', 'WARNING');
        config.set('maxUsedMemoryRatio', 0.80); // Start throttling at 80% to prevent OOM
        config.set('maxRequestRetries', 1); // Fail faster if memory is tight
        config.set('persistStorage', false); // Don't persist to disk (read-only on Vercel)
    }

    // ===================== UTILITIES =====================

    capitalize(str) {
        return str.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    getHeaders() {
        return {
            'User-Agent': this.config.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        };
    }

    isValidProductImage(url) {
        if (!url || url.length < 10) return false;
        const lower = url.toLowerCase();
        const ignore = ['logo', 'icon', 'placeholder', 'avatar', 'blank', 'default', 'loading', 'spinner', 'banner', 'hero', 'header', 'footer', 'social', 'facebook', 'twitter', 'instagram', 'linkedin', 'youtube', 'email', 'phone', 'contact', 'arrow', 'chevron', 'close', 'menu', 'search', 'cart', 'checkout'];
        return !ignore.some(term => lower.includes(term));
    }

    isProductUrl(url) {
        if (!url) return false;
        const lower = url.toLowerCase();
        return this.productUrlPatterns.some(pattern => lower.includes(pattern)) ||
            /\/(p|product|item|furniture)[\/-]\d+/i.test(url) ||
            /\/[a-z0-9-]+\.(html|php|aspx)$/i.test(url);
    }

    async checkUrlExists(url) {
        try {
            const res = await axios.head(url, {
                headers: this.getHeaders(),
                timeout: 5000,
                validateStatus: s => s < 500
            });
            return res.status === 200;
        } catch (e) {
            return false;
        }
    }

    // ===================== BRAND INFO =====================

    async extractBrandInfo(url) {
        try {
            const res = await axios.get(url, { headers: this.getHeaders(), timeout: this.config.timeout });
            const $ = cheerio.load(res.data);

            // Extract brand name from title
            const title = $('title').text().split(/[|–\-:]/)[0].trim();

            // Extract logo with expanded selectors
            let logo = '';
            const logoSelectors = [
                '.custom-logo', '.site-logo img', '.logo img', 'a.logo img',
                'header img[src*="logo"]', '.navbar-brand img', '[class*="logo"] img',
                'img[alt*="logo" i]', 'img[class*="logo" i]',
                '#logo img', '.header-logo img'
            ];

            for (const sel of logoSelectors) {
                const src = $(sel).first().attr('src') || $(sel).first().attr('data-src');
                if (src && src.length > 0) {
                    logo = src.startsWith('http') ? src : new URL(src, url).href;
                    break;
                }
            }

            return { name: title, logo };
        } catch (e) {
            return { name: '', logo: '' };
        }
    }

    // ===================== PAGE ANALYZER =====================
    // Analyzes page structure to find the best product container pattern

    async analyzePage(page) {
        const analysis = await page.evaluate((containerSelectors, titleSelectors) => {
            const results = [];

            for (const selector of containerSelectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length === 0) continue;

                    // Check if these elements look like product cards
                    let score = 0;
                    let hasTitle = 0;
                    let hasImage = 0;
                    let hasLink = 0;

                    elements.forEach(el => {
                        // Check for title
                        const titleEl = el.querySelector('h2, h3, h4, .title, .name, [class*="title"], [class*="name"]');
                        if (titleEl && titleEl.textContent.trim().length > 3) hasTitle++;

                        // Check for image
                        const imgEl = el.querySelector('img');
                        if (imgEl && (imgEl.src || imgEl.dataset.src)) hasImage++;

                        // Check for link
                        const linkEl = el.querySelector('a[href]');
                        if (linkEl) hasLink++;
                    });

                    // Calculate score based on completeness
                    if (elements.length >= 2) {
                        score = (hasTitle / elements.length) * 30 +
                            (hasImage / elements.length) * 40 +
                            (hasLink / elements.length) * 30;

                        // Bonus for grid layouts
                        const parent = elements[0].parentElement;
                        if (parent) {
                            const style = window.getComputedStyle(parent);
                            if (style.display === 'grid' || style.display === 'flex') {
                                score += 10;
                            }
                        }
                    }

                    if (score > 50) {
                        results.push({
                            selector,
                            count: elements.length,
                            score,
                            hasTitle: hasTitle / elements.length > 0.5,
                            hasImage: hasImage / elements.length > 0.5
                        });
                    }
                } catch (e) { }
            }

            // Sort by score
            results.sort((a, b) => b.score - a.score);
            return results.slice(0, 3); // Top 3 candidates

        }, this.productContainerSelectors, this.titleSelectors);

        return analysis;
    }

    // ===================== UNIVERSAL PRODUCT EXTRACTOR =====================

    async extractProducts(page, containerSelector, brandName, category) {
        const products = await page.evaluate(({ containerSelector, brandName, category, titleSelectors, validPatterns }) => {
            const items = [];
            const seen = new Set();

            const containers = document.querySelectorAll(containerSelector);

            containers.forEach(el => {
                // Extract title
                let title = '';
                for (const sel of titleSelectors) {
                    const titleEl = el.querySelector(sel);
                    if (titleEl) {
                        title = titleEl.textContent?.trim() || titleEl.getAttribute('title') || '';
                        if (title && title.length > 2 && title.length < 200) break;
                    }
                }

                if (!title || seen.has(title.toLowerCase())) return;

                // Extract image
                let imageUrl = '';
                const imgEl = el.querySelector('img');
                if (imgEl) {
                    imageUrl = imgEl.getAttribute('src') ||
                        imgEl.getAttribute('data-src') ||
                        imgEl.getAttribute('data-lazy-src') ||
                        imgEl.getAttribute('data-original') || '';

                    // Check srcset for higher resolution
                    const srcset = imgEl.getAttribute('srcset');
                    if (srcset) {
                        const srcsetParts = srcset.split(',').map(s => s.trim().split(' '));
                        if (srcsetParts.length > 0) {
                            imageUrl = srcsetParts[srcsetParts.length - 1][0] || imageUrl;
                        }
                    }
                }

                // Also check picture element
                if (!imageUrl) {
                    const sourceEl = el.querySelector('picture source');
                    if (sourceEl) {
                        imageUrl = sourceEl.getAttribute('srcset')?.split(',')[0]?.trim().split(' ')[0] || '';
                    }
                }

                // Extract product URL
                let productUrl = '';
                const linkEl = el.querySelector('a[href]');
                if (linkEl) {
                    productUrl = linkEl.getAttribute('href') || '';
                }

                // Skip if no image or invalid
                if (!imageUrl) return;

                // Skip invalid images (logos, icons, etc.)
                const lowerImg = imageUrl.toLowerCase();
                const ignore = ['logo', 'icon', 'placeholder', 'blank', 'banner', 'hero', 'social'];
                if (ignore.some(term => lowerImg.includes(term))) return;

                seen.add(title.toLowerCase());

                items.push({
                    mainCategory: category || 'Products',
                    subCategory: category || 'General',
                    family: brandName,
                    model: title,
                    description: title,
                    imageUrl,
                    productUrl,
                    price: 0
                });
            });

            return items;
        }, {
            containerSelector,
            brandName,
            category,
            titleSelectors: this.titleSelectors,
            validPatterns: this.productUrlPatterns
        });

        return products;
    }

    // ===================== DISCOVER PRODUCT PAGES =====================
    // Finds links to product categories/pages on the website

    async discoverProductPages(page, baseUrl) {
        const links = await page.evaluate((productPatterns) => {
            const found = new Map(); // url -> label

            // Look for navigation links
            const navSelectors = [
                'nav a', 'header a', '.menu a', '.navigation a',
                '[class*="menu"] a', '[class*="nav"] a',
                '.mega-menu a', '.dropdown-menu a',
                'a.nav-link', '.nav-item a'
            ];

            // Common category keywords
            const categoryKeywords = [
                'product', 'products', 'collection', 'collections', 'catalog',
                'furniture', 'seating', 'chairs', 'desks', 'tables', 'storage',
                'office', 'meeting', 'conference', 'executive', 'workstation',
                'sofa', 'lounge', 'partition', 'cabinet', 'accessori'
            ];

            for (const sel of navSelectors) {
                document.querySelectorAll(sel).forEach(link => {
                    const href = link.getAttribute('href');
                    const text = link.textContent?.trim()?.toLowerCase() || '';

                    if (!href || href === '#' || href.startsWith('javascript')) return;

                    // Check if it matches product patterns or keywords
                    const hrefLower = href.toLowerCase();
                    const isProductLink = productPatterns.some(p => hrefLower.includes(p)) ||
                        categoryKeywords.some(k => hrefLower.includes(k) || text.includes(k));

                    if (isProductLink && !found.has(href)) {
                        found.set(href, link.textContent?.trim() || 'Products');
                    }
                });
            }

            // Convert to array
            return Array.from(found.entries()).map(([url, label]) => ({ url, label }));
        }, this.productUrlPatterns);

        // Convert relative URLs to absolute
        return links.map(link => ({
            url: link.url.startsWith('http') ? link.url : new URL(link.url, baseUrl).href,
            label: link.label
        })).filter(link => {
            // Filter out non-product links
            const lower = link.url.toLowerCase();
            const exclude = ['contact', 'about', 'blog', 'news', 'career', 'login', 'cart', 'checkout', 'account', 'privacy', 'terms', 'cookie', 'faq', 'support', 'help'];
            return !exclude.some(e => lower.includes(e));
        });
    }

    // ===================== UNIVERSAL SCRAPER (NEW) =====================

    async scrapeUniversal(url, onProgress = null) {
        console.log(`\n🌐 Starting Universal Scrape: ${url}`);
        const allProducts = [];
        const visitedUrls = new Set();
        const baseUrl = new URL(url).origin;
        const parsedUrl = new URL(url);

        if (onProgress) onProgress(15, 'Extracting Brand Identity...');
        const brandInfo = await this.extractBrandInfo(url);
        const brandName = brandInfo.name || this.capitalize(parsedUrl.host.replace('www.', '').split('.')[0]);
        console.log(`   Brand: ${brandName}`);

        if (onProgress) onProgress(20, 'Discovering Categories...');

        const crawler = new PlaywrightCrawler({
            maxConcurrency: 1, // Single browser for memory efficiency
            maxRequestsPerCrawl: 150, // Reduced for memory safety
            requestHandlerTimeoutSecs: 45,
            navigationTimeoutSecs: 30,
            headless: true,

            // === MEMORY-OPTIMIZED BROWSER SETTINGS ===
            launchContext: {
                launchOptions: {
                    args: [
                        '--disable-gpu',
                        '--disable-dev-shm-usage',
                        '--disable-setuid-sandbox',
                        '--no-sandbox',
                        '--disable-extensions',
                        '--disable-background-networking',
                        '--disable-default-apps',
                        '--disable-sync',
                        '--disable-translate',
                        '--hide-scrollbars',
                        '--mute-audio',
                        '--no-first-run',
                        '--disable-features=TranslateUI',
                        '--disable-ipc-flooding-protection',
                        '--single-process', // Critical for memory
                        '--memory-pressure-off',
                        '--js-flags=--max-old-space-size=512' // Limit V8 heap
                    ]
                }
            },

            // Block heavy resources to save memory
            preNavigationHooks: [
                async ({ page }) => {
                    await page.route('**/*', (route) => {
                        const type = route.request().resourceType();
                        if (['image', 'font', 'media', 'stylesheet', 'websocket', 'manifest', 'texttrack'].includes(type)) {
                            return route.abort();
                        }
                        return route.continue();
                    });
                }
            ],

            requestHandler: async ({ page, request, enqueueLinks }) => {
                const { label, category, isProductPage } = request.userData || {};
                const currentUrl = request.url;

                if (visitedUrls.has(currentUrl)) return;
                visitedUrls.add(currentUrl);

                console.log(`   📄 Visiting: ${currentUrl} [${label || 'DISCOVERY'}]`);
                if (onProgress && label === 'CATEGORY') {
                    const prog = Math.min(85, 30 + (visitedUrls.size * 2));
                    onProgress(Math.round(prog), `Scanning ${category}...`);
                }

                // Wait for page to load
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(1500); // Allow JS to render

                if (!label || label === 'DISCOVERY') {
                    // === PHASE 1: DISCOVER PRODUCT PAGES ===
                    const productPages = await this.discoverProductPages(page, baseUrl);
                    console.log(`   Found ${productPages.length} potential product pages`);

                    // Queue discovered pages
                    for (const pg of productPages.slice(0, 20)) { // Limit to 20 categories
                        if (!visitedUrls.has(pg.url)) {
                            await crawler.addRequests([{
                                url: pg.url,
                                userData: { label: 'CATEGORY', category: pg.label }
                            }]);
                        }
                    }

                    // Also try to extract products from homepage
                    const analysis = await this.analyzePage(page);
                    if (analysis.length > 0) {
                        console.log(`   🔍 Found ${analysis[0].count} potential products on homepage`);
                        const products = await this.extractProducts(page, analysis[0].selector, brandName, 'Homepage');
                        allProducts.push(...products);
                    }

                } else if (label === 'CATEGORY') {
                    // === PHASE 2: SCRAPE CATEGORY PAGE ===
                    console.log(`   📦 Scraping category: ${category}`);

                    // Analyze page to find best product container
                    const analysis = await this.analyzePage(page);

                    if (analysis.length > 0) {
                        const bestSelector = analysis[0].selector;
                        console.log(`   Using selector: ${bestSelector} (score: ${analysis[0].score.toFixed(1)}, count: ${analysis[0].count})`);

                        // Extract products
                        const products = await this.extractProducts(page, bestSelector, brandName, category);
                        console.log(`   ✓ Extracted ${products.length} products`);

                        // Resolve relative URLs
                        products.forEach(p => {
                            if (p.imageUrl && !p.imageUrl.startsWith('http')) {
                                try { p.imageUrl = new URL(p.imageUrl, currentUrl).href; } catch (e) { }
                            }
                            if (p.productUrl && !p.productUrl.startsWith('http')) {
                                try { p.productUrl = new URL(p.productUrl, currentUrl).href; } catch (e) { }
                            }
                        });

                        allProducts.push(...products);

                        // Try to find pagination
                        const paginationLinks = await page.evaluate(() => {
                            const links = [];
                            const selectors = [
                                'a.page-numbers', '.pagination a', 'a.next', '.pager a',
                                '[class*="pagination"] a', 'a[rel="next"]',
                                '.load-more', 'button[class*="load"]'
                            ];

                            for (const sel of selectors) {
                                document.querySelectorAll(sel).forEach(el => {
                                    const href = el.getAttribute('href');
                                    if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
                                        links.push(href);
                                    }
                                });
                            }

                            return [...new Set(links)];
                        });

                        // Queue pagination
                        for (const pageUrl of paginationLinks.slice(0, 5)) { // Limit pagination
                            const absUrl = pageUrl.startsWith('http') ? pageUrl : new URL(pageUrl, currentUrl).href;
                            if (!visitedUrls.has(absUrl)) {
                                await crawler.addRequests([{
                                    url: absUrl,
                                    userData: { label: 'CATEGORY', category }
                                }]);
                            }
                        }
                    } else {
                        console.log(`   ⚠️ No product containers found on this page`);
                    }
                }
            },

            failedRequestHandler: ({ request, error }) => {
                console.log(`   ⚠️ Failed: ${request.url} - ${error.message}`);
            }
        }, new Configuration({
            storagePath: `./storage/universal_${Date.now()}`,
            purgeOnStart: true
        }));

        await crawler.run([{ url, userData: { label: 'DISCOVERY' } }]);

        // Cleanup temp storage
        try {
            const config = crawler.configuration;
            if (config && config.get('storagePath')) {
                await fs.rm(config.get('storagePath'), { recursive: true, force: true });
            }
        } catch (e) { }

        // Deduplicate
        const seen = new Set();
        const uniqueProducts = [];
        for (const p of allProducts) {
            const key = `${p.model}|${p.imageUrl}`.toLowerCase();
            if (!seen.has(key) && this.isValidProductImage(p.imageUrl)) {
                seen.add(key);
                uniqueProducts.push(p);
            }
        }

        console.log(`\n✅ Universal scraper found ${uniqueProducts.length} unique products`);

        return {
            products: uniqueProducts,
            brandInfo: { name: brandName, logo: brandInfo.logo }
        };
    }

    // ===================== ARCHITONIC SCRAPER =====================
    // (keeping existing implementation)

    async scrapeArchitonic(url, onProgress = null) {
        console.log(`\n🏗️ [Crawlee] Starting Architonic Power Scraper: ${url}`);
        const allProducts = [];
        let brandName = 'Architonic Brand';
        let brandLogo = '';

        const storageId = `architonic_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // Configure Crawlee to use in-memory storage (no filesystem)
        // This prevents ENOENT errors on Railway's ephemeral filesystem
        const config = Configuration.getGlobalConfig();
        config.set('persistStorage', false);

        // Track 403 errors for adaptive delay
        let consecutive403Count = 0;
        let baseDelay = 1000; // Balance between speed and rate limiting

        const crawler = new PlaywrightCrawler({
            // === BALANCED SPEED + ANTI-BLOCK CONFIGURATION ===
            maxConcurrency: 2, // Reduced from 5 to avoid 403 blocks
            minConcurrency: 1,
            maxRequestsPerCrawl: 10000,
            useSessionPool: true, // Enable session pool for cookie persistence
            persistCookiesPerSession: true, // Persist cookies like a real browser
            requestHandlerTimeoutSecs: 120,
            navigationTimeoutSecs: 60,

            // Moderate delay to avoid rate limiting
            sameDomainDelaySecs: 2, // Increased from 1 to avoid 403
            maxRequestRetries: 3, // Increased back to 3 for better recovery

            // Stealth browser settings
            launchContext: {
                launchOptions: {
                    headless: true,
                    args: [
                        '--disable-gpu',
                        '--disable-dev-shm-usage',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-extensions',
                        '--disable-background-networking',
                        '--disable-blink-features=AutomationControlled', // Hide automation
                        '--disable-web-security',
                        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    ]
                }
            },

            async requestHandler({ request, page, enqueueLinks, log }) {
                console.log(`\n📄 [RequestHandler] Processing: ${request.url}`);

                // Speed optimization: Block unnecessary resources
                await page.route('**/*', (route) => {
                    const type = route.request().resourceType();
                    // Block images, fonts, media, stylesheets for speed (we extract image URLs from HTML)
                    if (['image', 'media', 'font', 'stylesheet', 'websocket', 'manifest'].includes(type)) {
                        return route.abort();
                    }
                    return route.continue();
                });

                // Cancellation Check
                if (onProgress && onProgress.isCancelled && onProgress.isCancelled()) {
                    log.info('🛑 Cancellation detected. Aborting Architonic crawl...');
                    await crawler.autoscaledPool.abort();
                    return;
                }

                const { label } = request.userData;
                log.info(`Processing ${request.url} [${label || 'START'}]`);

                if (!label || label === 'START') {
                    try {
                        console.log(`🔍 [START] Analyzing brand landing page...`);

                        // === COLLECTIONS-ONLY STRATEGY ===
                        // Redirect to /collections/ URL if we're on a /products/ or generic brand page
                        const currentUrl = request.url;
                        const isProductsPage = currentUrl.includes('/products/');
                        const isCollectionsPage = currentUrl.includes('/collections/');

                        if (isProductsPage && !isCollectionsPage) {
                            // Redirect from /products/ to /collections/
                            const collectionsUrl = currentUrl.replace('/products/', '/collections/');
                            console.log(`   🔀 Redirecting from /products/ to /collections/: ${collectionsUrl}`);
                            await crawler.addRequests([{ url: collectionsUrl, userData: { label: 'START' } }]);
                            return; // Don't process this page
                        }

                        // If URL doesn't have /collections/, try to find and navigate to it
                        if (!isCollectionsPage) {
                            // Extract brand ID from URL and construct collections URL
                            const brandIdMatch = currentUrl.match(/\/b\/[^/]+\/(\d+)/);
                            if (brandIdMatch) {
                                const brandSlugMatch = currentUrl.match(/\/b\/([^/]+)\//);
                                if (brandSlugMatch) {
                                    const collectionsUrl = `https://www.architonic.com/en/b/${brandSlugMatch[1]}/collections/${brandIdMatch[1]}/`;
                                    console.log(`   🔀 Navigating to Collections tab: ${collectionsUrl}`);
                                    await crawler.addRequests([{ url: collectionsUrl, userData: { label: 'START' } }]);
                                    return;
                                }
                            }
                        }

                        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
                        await page.waitForTimeout(1500); // Reduced from 3000

                        // Extract Brand Name more robustly
                        let foundName = '';
                        console.log(`🔍 [START] Detecting brand name...`);

                        // Try H1 first (e.g., "Collections by True Design")
                        const h1Text = await page.$eval('h1', el => el.innerText).catch(() => '');
                        if (h1Text) {
                            foundName = h1Text.replace(/Collections by/i, '')
                                .replace(/Products by/i, '')
                                .replace(/Collections/i, '')
                                .replace(/Products/i, '')
                                .trim();
                        }

                        // Fallback to breadcrumbs
                        if (!foundName || foundName.length < 2) {
                            foundName = await page.$$eval('.breadcrumb-item, [class*="breadcrumb"] li, .breadcrumbs a', els => {
                                // Usually the brand name is one of the last few items
                                for (let i = els.length - 1; i >= 0; i--) {
                                    const text = els[i].innerText.trim();
                                    if (text && !/home|brands|products|collections/i.test(text)) return text;
                                }
                                return '';
                            }).catch(() => '');
                        }

                        // Final fallback to title
                        if (!foundName || foundName.length < 2) {
                            const title = await page.title();
                            foundName = title.split('|')[0]
                                .replace(/Collections by/i, '')
                                .replace(/Products by/i, '')
                                .replace(/Architonic/i, '')
                                .trim();
                        }

                        brandName = foundName || brandName;
                        if (brandName.toLowerCase() === 'brands') brandName = 'Architonic Brand';

                        if (onProgress) onProgress(20, `Identified Brand: ${brandName}...`, brandName);

                        // === IMPROVED LOGO FETCHING FOR ARCHITONIC ===
                        // Priority 0: og:image meta tag (MOST RELIABLE for Architonic)
                        try {
                            brandLogo = await page.evaluate(() => {
                                // Priority 0: Check og:image meta tag FIRST (Most reliable for Architonic)
                                const ogImage = document.querySelector('meta[property="og:image"]');
                                if (ogImage && ogImage.content && ogImage.content.includes('logo')) {
                                    return ogImage.content;
                                }

                                // Priority 1: Architonic-specific brand link logo
                                // Pattern: <a href="/en/b/brandname/ID/"><img src="...logo.png"/></a>
                                const brandLinks = document.querySelectorAll('a[href*="/b/"]');
                                for (const link of brandLinks) {
                                    const img = link.querySelector('img');
                                    if (img && img.src && img.src.includes('http')) {
                                        const src = img.src.toLowerCase();
                                        const alt = (img.alt || '').toLowerCase();
                                        // Check if it looks like a logo (has 'logo' in URL/alt, or is small/medium sized)
                                        if (src.includes('/logo/') || src.includes('logo') || alt.includes('logo') || alt.includes('manufacturer')) {
                                            return img.src;
                                        }
                                    }
                                }

                                // Priority 2: Look for specific logo patterns in image URLs
                                const logoSelectors = [
                                    'img[alt*="Logo for manufacturer" i]',
                                    'img[alt*="logo" i]',
                                    'img[src*="/logo/"]',
                                    '[class*="brand-header"] img',
                                    '[class*="brand-logo"] img',
                                    '[class*="BrandHeader"] img',
                                    '.brand-info img',
                                    'header img[src*="logo"]'
                                ];

                                for (const selector of logoSelectors) {
                                    const img = document.querySelector(selector);
                                    if (img && img.src && img.src.includes('http')) {
                                        const src = img.src.toLowerCase();
                                        if (!src.includes('placeholder') &&
                                            !src.includes('spinner') &&
                                            !src.includes('loading')) {
                                            return img.src;
                                        }
                                    }
                                }

                                // Priority 3: Fallback - any image with 'logo' in src or alt
                                const allImages = document.querySelectorAll('img');
                                for (const img of allImages) {
                                    const alt = (img.alt || '').toLowerCase();
                                    const src = (img.src || '').toLowerCase();
                                    if ((alt.includes('logo') || src.includes('logo') || src.includes('/logo/')) &&
                                        img.src.includes('http') &&
                                        img.naturalWidth > 20) {
                                        return img.src;
                                    }
                                }

                                return '';
                            });

                            // Clean up WebP parameters for PDF compatibility
                            if (brandLogo && brandLogo.includes('media.architonic.com') && brandLogo.includes('?')) {
                                brandLogo = brandLogo.split('?')[0];
                                console.log(`   🧹 Cleaned logo URL (removed webp params)`);
                            }

                            if (brandLogo) {
                                console.log(`   🖼️ Found brand logo: ${brandLogo.substring(0, 100)}...`);
                            } else {
                                console.log(`   ⚠️ No brand logo found - will use fallback`);
                            }
                        } catch (e) {
                            brandLogo = '';
                            console.log(`   ⚠️ Logo fetch error: ${e.message}`);
                        }

                        console.log(`Found brand: ${brandName}`);

                        console.log(`🔍 [START] Checking for popups and consent banners...`);
                        await page.evaluate(() => {
                            const closeTerms = ['maybe later', 'i accept', 'close', 'continue', 'agree', 'accept all', 'allow all'];
                            const buttons = Array.from(document.querySelectorAll('button, a, span[role="button"]'));
                            buttons.forEach(b => {
                                const text = b.innerText.toLowerCase();
                                if (closeTerms.some(term => text.includes(term))) {
                                    try { b.click(); } catch (e) { }
                                }
                            });
                        });
                        await page.waitForTimeout(1000); // Reduced from 2000

                        console.log(`🔍 [START] Discovery: Extensive scrolling to reveal all items...`);
                        const discoveredSubLinks = new Set();
                        const discoveredProductLinks = new Set();
                        const discoveredTabLinks = new Set();
                        let lastHeight = 0;
                        let stableHeightCount = 0;

                        // ENHANCED: Increased iterations and wait times for thorough category discovery
                        // This ensures all categories (even at the bottom like Education) are found
                        for (let i = 0; i < 500; i++) {
                            const progressVal = Math.min(60, 20 + (i * 0.1));
                            if (onProgress) onProgress(progressVal, `Discovering collections (Scan ${i})...`);

                            // Keyboard scroll is more reliable for infinite scroll triggers
                            try { await page.keyboard.press('End'); } catch (e) { }

                            // Wait between scrolls for lazy loading (slightly longer for reliable loading)
                            await page.waitForTimeout(600);

                            const iterationResults = await page.evaluate(async (currentUrl) => {
                                // Dynamic scroll amount based on page height
                                window.scrollBy(0, 2000); // Increased scroll distance
                                await new Promise(r => setTimeout(r, 400)); // Reduced from 800

                                // 1. Find Load More
                                const elements = Array.from(document.querySelectorAll('button, a, span, div'));
                                const loadMore = elements.find(el => {
                                    const t = el.innerText.toLowerCase();
                                    return (t.includes('load more') || t.includes('show more') || t.includes('más results') || t.includes('produkte laden')) && el.offsetParent !== null;
                                });
                                if (loadMore && typeof loadMore.click === 'function') {
                                    try { loadMore.click(); } catch (e) { }
                                }

                                // 2. Identify links on current viewport state
                                const allLinks = Array.from(document.querySelectorAll('a'));
                                const normalizedCurrent = currentUrl.replace(/\/$/, '');

                                // REMOVED: Generic /products/ tabs cause "Products by Brand" categories
                                // We now SKIP these entirely and only focus on actual collection pages
                                const tabs = []; // Intentionally empty - don't enqueue generic product tabs

                                // === COLLECTIONS-ONLY: Filter to ONLY collection URLs ===
                                const collections = allLinks
                                    .map(el => el.href)
                                    .filter(href => {
                                        if (!href || !href.includes('architonic.com')) return false;
                                        // STRICT: Only allow /collection/ URLs, NEVER /products/
                                        if (href.includes('/products/')) return false;
                                        const normalizedHref = href.replace(/\/$/, '');
                                        const isSamePage = normalizedHref === normalizedCurrent;
                                        const isCollectionLink = href.includes('/collection/');
                                        const isUtility = href.endsWith('/collections') || href.endsWith('/products') || !href.includes('/b/');
                                        return !isSamePage && !href.includes('#') && isCollectionLink && !isUtility;
                                    });

                                // Only collect products that are directly on this page (not from /products/ pages)
                                const products = allLinks
                                    .map(el => el.href)
                                    .filter(href => (href.includes('/p/') || href.includes('/product/')) && href.includes('architonic.com'));

                                const height = document.body.scrollHeight;
                                return { tabs, collections, products, height };
                            }, request.url);

                            iterationResults.tabs.forEach(l => discoveredTabLinks.add(l));
                            iterationResults.collections.forEach(l => discoveredSubLinks.add(l));
                            iterationResults.products.forEach(l => discoveredProductLinks.add(l));


                            // SMART BREAKER: Stop if height doesn't change for 12 consecutive scans
                            // Increased from 5 to 12 to catch lazy-loaded categories like Education
                            if (iterationResults.height === lastHeight) {
                                stableHeightCount++;
                                if (stableHeightCount >= 12) {
                                    console.log(`   ✅ Reached bottom of page (height stable for 12 scans). Found ${discoveredSubLinks.size} collections.`);
                                    break;
                                }
                            } else {
                                stableHeightCount = 0;
                            }
                            lastHeight = iterationResults.height;
                        }
                        await page.evaluate(() => window.scrollTo(0, 0));

                        // === COLLECTIONS-ONLY: Filter out /products/ URLs completely ===
                        const collectionOnlyLinks = [...discoveredSubLinks].filter(url =>
                            !url.includes('/products/') && url.includes('/collection/')
                        );
                        const uniqueProductLinks = [...discoveredProductLinks];

                        console.log(`🔍 [START] Found ${collectionOnlyLinks.length} collection links and ${uniqueProductLinks.length} direct products.`);

                        if (collectionOnlyLinks.length > 0) {
                            await crawler.addRequests(collectionOnlyLinks.map(url => ({
                                url,
                                userData: { label: 'COLLECTION' }
                            })));
                        }

                        // Products found directly on the collections page (rare but possible)  
                        if (uniqueProductLinks.length > 0 && isCollectionsPage) {
                            await crawler.addRequests(uniqueProductLinks.map(url => ({
                                url,
                                userData: { label: 'PRODUCT', _brand: brandName, _coll: 'Featured' }
                            })));
                        }

                        // If this is already a collection page with content, process it
                        if (collectionOnlyLinks.length === 0 && isCollectionsPage) {
                            console.log(`🔍 [START] On collections page, treating as main collection.`);
                            await crawler.addRequests([{ url: request.url, userData: { label: 'COLLECTION', singlePage: true } }]);
                        }
                    } catch (err) {
                        console.error('Error in START handler:', err.message);
                    }

                } else if (label === 'COLLECTION') {
                    await page.waitForLoadState('domcontentloaded').catch(() => { });
                    await page.waitForTimeout(1500); // Reduced from 3000

                    // NEW: Detect pagination (e.g., page 2, 3...)
                    // Some collections like "Table" have explicit pagination at the bottom
                    const paginationLinks = await page.evaluate(() => {
                        const links = [];
                        const selectors = ['.pagination a', 'a.page-numbers', 'a[href*="page="]'];
                        selectors.forEach(sel => {
                            document.querySelectorAll(sel).forEach(el => {
                                if (el.href && !links.includes(el.href)) links.push(el.href);
                            });
                        });
                        return links;
                    });

                    if (paginationLinks.length > 0) {
                        console.log(`   📄 Found ${paginationLinks.length} pagination pages. Enqueueing...`);
                        for (const pLink of paginationLinks) {
                            await crawler.addRequests([{
                                url: pLink,
                                userData: { label: 'COLLECTION', _brand: brandName, _coll: collectionName } // Recursively process
                            }]);
                        }
                    }

                    let collectionName = await page.$eval('h1', el => el.innerText).catch(() => '');

                    // === DETECT AND SKIP GENERIC PRODUCT PAGES ===
                    // "Products by [Brand]" is NOT a real category - it's the generic all-products page
                    const isGenericProductPage = collectionName.toLowerCase().includes('products by') ||
                        request.url.match(/\/products\/\d+\/?$/) ||
                        request.url.match(/\/products\/\d+\/\d+\/?$/); // pagination of products page

                    if (isGenericProductPage) {
                        console.log(`   ⚠️ SKIPPING generic product page (not a real category): ${collectionName}`);
                        // Still find sub-collections from this page, but don't scrape products from it
                        const subCollectionLinks = await page.$$eval('a', (els) => {
                            return els.map(el => el.href).filter(href => {
                                if (!href || !href.includes('architonic.com')) return false;
                                return (href.includes('/collection/') || href.includes('/collections/') || href.includes('/category/')) &&
                                    !href.includes('/p/') && !href.includes('/product/') && !href.endsWith('/collections');
                            });
                        });
                        const uniqueSubCollections = [...new Set(subCollectionLinks)].filter(l => l !== request.url);
                        if (uniqueSubCollections.length > 0) {
                            console.log(`   📂 Found ${uniqueSubCollections.length} sub-collections from generic page. Enqueueing...`);
                            await enqueueLinks({
                                urls: uniqueSubCollections,
                                userData: { label: 'COLLECTION', _brand: brandName }
                            });
                        }
                        return; // Skip processing products from this generic page
                    }

                    // Fix collection name if it contains unwanted patterns
                    if (!collectionName || collectionName.includes('Collections by') || collectionName.includes('Products by')) {
                        try {
                            const parts = request.url.split('/');
                            const idx = parts.indexOf('collection');
                            if (idx !== -1 && parts[idx + 1]) {
                                collectionName = parts[idx + 1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                            }
                        } catch (e) { collectionName = 'Collection'; }
                    }
                    if (!collectionName) collectionName = 'Collection';

                    if (onProgress) {
                        const prog = Math.min(80, 25 + (allProducts.length * 0.5));
                        onProgress(Math.round(prog), `Scanning Gallery: ${collectionName}...`);
                    }

                    // Architonic Infinite Scroll Implementation: REQUIRED even for small collections
                    console.log(`   📜 Scrolling gallery: ${collectionName}...`);
                    await page.evaluate(async () => {
                        let lastCount = 0;
                        let stableCycles = 0;

                        for (let i = 0; i < 50; i++) { // Reduced from 100 iterations
                            window.scrollBy(0, 2500); // Increased scroll distance
                            await new Promise(r => setTimeout(r, 500)); // Reduced from 1000

                            // Robust 'Load More' detection
                            const buttons = Array.from(document.querySelectorAll('button, a, span[role="button"]'));
                            const loadMore = buttons.find(el => {
                                const t = el.innerText.toLowerCase();
                                const isVisible = el.offsetParent !== null;
                                return isVisible && (
                                    t === 'load more' ||
                                    t.includes('show more') ||
                                    t.includes('más results') ||
                                    t.includes('produkte laden')
                                );
                            });

                            if (loadMore) {
                                try {
                                    loadMore.scrollIntoView();
                                    loadMore.click();
                                    await new Promise(r => setTimeout(r, 800)); // Reduced from 1500
                                    stableCycles = 0; // Reset as we triggered a load
                                } catch (e) { }
                            } else {
                                // Check if link count is growing
                                const currentCount = document.querySelectorAll('a[href*="/p/"], a[href*="/product/"]').length;
                                if (currentCount === lastCount) {
                                    stableCycles++;
                                } else {
                                    stableCycles = 0;
                                }
                                lastCount = currentCount;

                                if (stableCycles >= 3) break; // Finished loading
                            }
                        }
                    });

                    // Flexible match for product links: Architonic uses /en/p/, /p/, or /product/
                    const productLinks = await page.$$eval('a', (els) => {
                        return els
                            .map(el => el.href)
                            .filter(href => {
                                if (!href || !href.includes('architonic.com')) return false;
                                // Products usually have /p/ or /product/ followed by a slug-id
                                // We match patterns like /p/name-12345 or /en/p/name-12345
                                const isProduct = /\/p\/[a-z0-9-]+\d+\/?/i.test(href) ||
                                    href.includes('/product/') ||
                                    (href.includes('/en/p/') && !href.includes('/collection/'));
                                return isProduct;
                            });
                    });

                    const uniqueLinks = [...new Set(productLinks)];
                    console.log(`   ✨ Found ${uniqueLinks.length} items in ${collectionName}`);

                    // NEW: Recursive Collection Discovery
                    // If this "Collection" page actually lists OTHER collections (like the main /collections/ page), find them!
                    const subCollectionLinks = await page.$$eval('a', (els) => {
                        return els.map(el => el.href).filter(href => {
                            if (!href || !href.includes('architonic.com')) return false;
                            // Match /collection/ or /collections/ but NOT products
                            return (href.includes('/collection/') || href.includes('/collections/') || href.includes('/category/')) &&
                                !href.includes('/p/') && !href.includes('/product/') && !href.endsWith('/collections');
                        });
                    });
                    const uniqueSubCollections = [...new Set(subCollectionLinks)].filter(l => l !== request.url);

                    if (uniqueSubCollections.length > 0) {
                        console.log(`   📂 Found ${uniqueSubCollections.length} sub-collections. Enqueueing recursively...`);
                        await enqueueLinks({
                            urls: uniqueSubCollections,
                            userData: { label: 'COLLECTION', _brand: brandName }
                        });
                    }

                    if (uniqueLinks.length > 0) {
                        await enqueueLinks({
                            urls: uniqueLinks,
                            userData: { label: 'PRODUCT', _brand: brandName, _coll: collectionName }
                        });
                    }

                } else if (label === 'PRODUCT') {
                    const { _brand, _coll } = request.userData;

                    // Add adaptive delay based on consecutive 403 errors
                    const adaptiveDelay = baseDelay + (consecutive403Count * 1000);
                    if (consecutive403Count > 0) {
                        console.log(`   ⏳ Rate limit protection: waiting ${adaptiveDelay}ms (${consecutive403Count} consecutive 403s)`);
                        await page.waitForTimeout(adaptiveDelay);
                    }

                    await page.waitForLoadState('domcontentloaded');
                    await page.waitForSelector('h1', { timeout: 10000 }).catch(() => { });

                    const name = await page.$eval('h1', el => el.innerText.trim()).catch(() => '');

                    // === 403 ERROR DETECTION ===
                    // Check if we hit a 403 error page (Architonic returns "403 ERROR" in H1)
                    const isBlockedPage = name.toLowerCase().includes('403') ||
                        name.toLowerCase().includes('error') ||
                        name.toLowerCase().includes('forbidden') ||
                        name.toLowerCase().includes('access denied') ||
                        name.toLowerCase().includes('blocked');

                    if (isBlockedPage) {
                        consecutive403Count++;
                        console.log(`   🚫 [403 BLOCKED] Skipping blocked page: ${request.url} (consecutive: ${consecutive403Count})`);

                        // If too many consecutive 403s, pause to let rate limit reset
                        if (consecutive403Count >= 3) {
                            console.log(`   ⏸️ Rate limit detected! Pausing for 15 seconds...`);
                            await page.waitForTimeout(15000);
                            consecutive403Count = 0; // Reset after pause
                        }
                        return; // Skip this product entirely
                    }

                    // Reset consecutive counter on successful page
                    consecutive403Count = 0;

                    // Improved image detection: Prioritize variant-specific images (opacity-100)
                    const img = await page.evaluate(() => {
                        const allImgs = Array.from(document.querySelectorAll('img'));

                        // 1. Target the ACTIVE carousel image (usually has opacity-100 and product ID in URL)
                        const activeVariantImg = allImgs.find(i =>
                            (i.classList.contains('opacity-100') || i.classList.contains('active')) &&
                            i.src.includes('architonic.com') &&
                            !i.src.includes('/family/')
                        );
                        if (activeVariantImg) return activeVariantImg.src;

                        // 2. Look for images with '/product/' in URL (specific variants)
                        const productImg = allImgs.find(i =>
                            i.src.includes('/product/') &&
                            (i.classList.contains('object-contain') || i.width > 200)
                        );
                        if (productImg) return productImg.src;

                        // 3. Fallback to existing selectors
                        const selectors = [
                            '#product-page section img.opacity-100',
                            '.product-gallery__main-image img',
                            '.gallery__image img',
                            'img[itemprop="image"]',
                            '.product-image img',
                            '.main-image img',
                            'main img[src*="/product/"]'
                        ];
                        for (const sel of selectors) {
                            const el = document.querySelector(sel);
                            if (el && el.src && el.src.startsWith('http') && !el.src.includes('/family/')) return el.src;
                        }

                        // 4. Last fallback (avoid /family/ if possible)
                        const anyImg = allImgs.find(i => i.width > 300 && i.src.startsWith('http') && !i.src.includes('/family/'));
                        if (anyImg) return anyImg.src;

                        const emergencyFallback = allImgs.find(i => i.width > 300 && i.src.startsWith('http'));
                        return emergencyFallback ? emergencyFallback.src : '';
                    });

                    if (onProgress && name) {
                        const prog = Math.min(95, 30 + (allProducts.length * 0.4));
                        onProgress(Math.round(prog), `[${allProducts.length + 1}] Harvesting: ${name}...`);
                    }

                    let description = '';
                    try {
                        description = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
                    } catch (e) { }

                    // Try to get variant-specific category (e.g., Office chairs vs Chairs)
                    let subTitle = '';
                    try {
                        subTitle = await page.$eval('h1 + div a span', el => el.innerText.trim()).catch(() => '');
                    } catch (e) { }

                    if (!description || description.length < 50) {
                        try {
                            const details = await page.evaluate(() => {
                                // Extract key attributes if visible
                                const attrElements = Array.from(document.querySelectorAll('div[class*="Attribute"]'));
                                if (attrElements.length > 0) {
                                    return attrElements.map(el => el.innerText.trim()).join(' | ');
                                }

                                const selectors = ['.product-description', '#description', '.details-content', '.about-product', '.font-book.leading-normal'];
                                for (const sel of selectors) {
                                    const el = document.querySelector(sel);
                                    if (el && el.innerText.length > 30) return el.innerText.trim();
                                }
                                return '';
                            });
                            description = details || description;
                        } catch (e) { }
                    }

                    if (subTitle && !description.includes(subTitle)) {
                        description = `${subTitle}. ${description}`;
                    }

                    // Double-check name is valid (not an error page that slipped through)
                    const isValidName = name &&
                        name.length > 2 &&
                        !name.toLowerCase().includes('403') &&
                        !name.toLowerCase().includes('error') &&
                        !name.toLowerCase().includes('forbidden');

                    if (isValidName && (img || name.length > 2)) {
                        let finalImg = img;
                        if (!finalImg || finalImg.includes('placeholder')) {
                            // Use our placeholder
                            finalImg = 'https://via.placeholder.com/400x400?text=No+Image';
                            console.log(`   ⚠️ Handled missing image for ${name}`);
                        }

                        // Ensure robust image detection 
                        // (Same logic as Railway: wait for network idle if needed)

                        // Differentiate variants by appending the ID from the URL (e.g., sokoa-tela-12345 -> Tela #12345)
                        let variantModel = name;
                        try {
                            const urlParts = request.url.split('/').filter(Boolean);
                            const lastPart = urlParts[urlParts.length - 1];
                            const idMatch = lastPart.match(/-(\d+)$/);
                            if (idMatch && idMatch[1]) {
                                variantModel = `${name} #${idMatch[1]}`;
                            }
                        } catch (e) { }

                        allProducts.push({
                            mainCategory: 'Furniture',
                            subCategory: _coll || 'General',
                            family: _brand,
                            model: variantModel,
                            description: description || name,
                            imageUrl: finalImg,
                            productUrl: request.url,
                            price: 0
                        });
                    }
                }
            },
            failedRequestHandler({ request, error, log }) {
                log.error(`Request ${request.url} failed: ${error.message}`);
            },
        }, new Configuration({
            storagePath: `./storage/${storageId}`,
            purgeOnStart: true
        }));

        Configuration.getGlobalConfig().set('purgeOnStart', true);

        await crawler.run([url]);

        if (onProgress) onProgress(98, 'Finalizing harvest database...');

        console.log(`\n✅ Architonic crawl finished. Found ${allProducts.length} products.`);
        if (onProgress) onProgress(100, 'Harvest Complete!');

        return {
            products: allProducts,
            brandInfo: { name: brandName, logo: brandLogo }
        };
    }

    // ===================== MAIN ENTRY POINT =====================

    async scrapeBrand(url, onProgress = null) {
        console.log(`\n🔍 Starting scrape for: ${url}`);

        // --- DEBUGGING SETUP ---
        const fs = await import('fs');
        const path = await import('path');
        const logFile = path.resolve('./scraper-debug.log');
        const log = (msg) => {
            const line = `[${new Date().toISOString()}] ${msg}\n`;
            console.log(msg);
            try { fs.appendFileSync(logFile, line); } catch (e) { }
        };

        log(`\n=== NEW SCRAPE SESSION: ${url} ===`);

        // Global error handlers for this session
        process.on('uncaughtException', (err) => {
            log(`🔥 FATAL UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}`);
        });
        process.on('unhandledRejection', (reason, promise) => {
            log(`🔥 FATAL UNHANDLED REJECTION: ${reason}`);
        });

        // Check if running on Vercel
        const isVercel = process.env.VERCEL === '1';
        if (isVercel) {
            throw new Error('Web scraping is not available in the deployed environment.');
        }

        try {
            // 1. Handle Architonic Special Case
            if (url.includes('architonic.com')) {
                log('👉 Routing to Architonic Scraper...');
                const result = await this.scrapeArchitonic(url, onProgress).catch(err => {
                    log(`❌ scrapeArchitonic FAILED: ${err.message}\n${err.stack}`);
                    throw err;
                });
                log('✅ scrapeArchitonic COMPLETED successfully.');
                return {
                    products: result.products,
                    summary: {
                        totalFound: result.products.length,
                        unique: result.products.length,
                        enriched: 0,
                        failedEnrichment: 0
                    },
                    brandInfo: result.brandInfo
                };
            }

            // 2. Use Universal Scraper for all other sites
            console.log(`\n🌐 Using Universal Intelligent Scraper...`);
            const result = await this.scrapeUniversal(url, onProgress);

            // 3. Enrich descriptions
            console.log(`\n📝 Enriching product descriptions for ${result.products.length} products...`);
            const enrichmentStats = await this.enrichDescriptions(result.products);

            // 4. Deduplicate final results
            const seen = new Set();
            const uniqueProducts = [];
            for (const p of result.products) {
                const key = `${p.model}|${p.productUrl}`.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueProducts.push(p);
                }
            }

            log(`\n✅ Scraped ${uniqueProducts.length} unique products for ${result.brandInfo.name}`);

            return {
                products: uniqueProducts,
                summary: {
                    totalFound: result.products.length,
                    unique: uniqueProducts.length,
                    enriched: enrichmentStats.enriched,
                    failedEnrichment: enrichmentStats.failed.length
                },
                brandInfo: result.brandInfo
            };

        } catch (error) {
            log(`❌ FINAL ERROR CATCH: ${error.message}\n${error.stack}`);
            throw error;
        }
    }

    // ===================== DESCRIPTION ENRICHMENT =====================

    async enrichDescriptions(products) {
        let enriched = 0;
        const failed = [];
        const batchSize = 5;

        console.log(`Processing ${products.length} products in batches of ${batchSize}...`);

        for (let i = 0; i < products.length; i += batchSize) {
            const batch = products.slice(i, i + batchSize);
            const promises = batch.map(async (product) => {
                if (!product.productUrl) return;

                try {
                    const res = await axios.get(product.productUrl, {
                        headers: this.getHeaders(),
                        timeout: 10000
                    });
                    const $ = cheerio.load(res.data);

                    const descSelectors = [
                        // WooCommerce
                        '.woocommerce-product-details__short-description',
                        '.product-short-description',
                        '#tab-description p:first-child',
                        // Generic
                        '.product-description', '.product_description',
                        '.description', '[class*="description"]',
                        '[itemprop="description"]',
                        '.content p:first-child', '.entry-content p:first-child',
                        // Custom sites
                        '.product-info p', '.product-detail p',
                        '.text-content p', 'article p:first-child'
                    ];

                    for (const sel of descSelectors) {
                        const $el = $(sel).first();
                        let desc = '';

                        if ($el.is('ul') || $el.find('ul').length > 0) {
                            const items = [];
                            $el.find('li').each((i, li) => items.push($(li).text().trim()));
                            desc = items.length > 0 ? items.join('. ') : $el.text();
                        } else {
                            desc = $el.text();
                        }

                        desc = desc.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

                        if (desc && desc.length > 15 && desc.length < 800 && desc !== product.model) {
                            product.description = desc;
                            enriched++;
                            break;
                        }
                    }

                    // Fallback: Meta description
                    if (!product.description || product.description === product.model) {
                        let metaDesc = $('meta[name="description"]').attr('content') || '';
                        metaDesc = metaDesc.trim().replace(/\s+/g, ' ');
                        if (metaDesc.length > 15 && metaDesc.length < 500) {
                            product.description = metaDesc;
                            enriched++;
                        }
                    }

                } catch (e) {
                    failed.push(product.model);
                }
            });

            await Promise.all(promises);
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`   Enriched ${enriched}/${products.length} descriptions`);
        return { enriched, failed };
    }
}

export default ScraperService;
