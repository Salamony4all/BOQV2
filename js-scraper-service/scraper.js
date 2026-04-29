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

// === MEMORY OPTIMIZATION FOR CLOUD (RAILWAY/VERCEL) ===
process.env.CRAWLEE_MEMORY_MB = '2048';
process.env.CRAWLEE_AVAILABLE_MEMORY_RATIO = '0.9';
process.env.CRAWLEE_DISABLE_MEMORY_AUTOSCALING = '1';
process.env.APIFY_DISABLE_PS = '1';
process.env.CRAWLEE_DISABLE_PS = '1';

import axios from 'axios';
import * as cheerio from 'cheerio';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';

class ScraperService {
    constructor() {
        this.config = {
            timeout: 20000,
            maxConcurrency: 3,
            maxRequestsPerCrawl: 500,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        this.initialized = false;
        this.crawlee = null;

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
    }

    /**
     * Lazy-load Crawlee and its dependencies only when needed.
     * This saves memory during server startup and for non-crawlee tasks.
     */
    async ensureInitialized() {
        if (this.initialized) return this.crawlee;

        try {
            // Set Playwright environment variables for Railway stability
            if (process.env.RAILWAY_ENVIRONMENT || process.platform === 'linux') {
                process.env.PLAYWRIGHT_BROWSERS_PATH = '/ms-playwright';
                process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
                console.log('🏛️ Railway detected - using pre-installed Playwright browsers at /ms-playwright');
            }

            const crawlee = await import('crawlee');
            this.crawlee = crawlee;
            this.initialized = true;
            return this.crawlee;
        } catch (error) {
            console.error('❌ Failed to initialize Crawlee:', error);
            throw error;
        }
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

    async analyzePage(page) {
        const analysis = await page.evaluate((containerSelectors, titleSelectors) => {
            const results = [];

            for (const selector of containerSelectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length === 0) continue;

                    let hasTitle = 0;
                    let hasImage = 0;
                    let hasLink = 0;

                    elements.forEach(el => {
                        const titleEl = el.querySelector('h2, h3, h4, .title, .name, [class*="title"], [class*="name"]');
                        if (titleEl && titleEl.textContent.trim().length > 3) hasTitle++;

                        const imgEl = el.querySelector('img');
                        if (imgEl && (imgEl.src || imgEl.dataset.src)) hasImage++;

                        const linkEl = el.querySelector('a[href]');
                        if (linkEl) hasLink++;
                    });

                    if (elements.length >= 2) {
                        let score = (hasTitle / elements.length) * 30 +
                            (hasImage / elements.length) * 40 +
                            (hasLink / elements.length) * 30;

                        const parent = elements[0].parentElement;
                        if (parent) {
                            const style = window.getComputedStyle(parent);
                            if (style.display === 'grid' || style.display === 'flex') {
                                score += 10;
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
                    }
                } catch (e) { }
            }

            results.sort((a, b) => b.score - a.score);
            return results.slice(0, 3);
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
                let title = '';
                for (const sel of titleSelectors) {
                    const titleEl = el.querySelector(sel);
                    if (titleEl) {
                        title = titleEl.textContent?.trim() || titleEl.getAttribute('title') || '';
                        if (title && title.length > 2 && title.length < 200) break;
                    }
                }

                if (!title || seen.has(title.toLowerCase())) return;

                let imageUrl = '';
                const imgEl = el.querySelector('img');
                if (imgEl) {
                    imageUrl = imgEl.getAttribute('src') ||
                        imgEl.getAttribute('data-src') ||
                        imgEl.getAttribute('data-lazy-src') ||
                        imgEl.getAttribute('data-original') || '';

                    const srcset = imgEl.getAttribute('srcset');
                    if (srcset) {
                        const srcsetParts = srcset.split(',').map(s => s.trim().split(' '));
                        if (srcsetParts.length > 0) {
                            imageUrl = srcsetParts[srcsetParts.length - 1][0] || imageUrl;
                        }
                    }
                }

                if (!imageUrl) {
                    const sourceEl = el.querySelector('picture source');
                    if (sourceEl) {
                        imageUrl = sourceEl.getAttribute('srcset')?.split(',')[0]?.trim().split(' ')[0] || '';
                    }
                }

                let productUrl = '';
                const linkEl = el.querySelector('a[href]');
                if (linkEl) {
                    productUrl = linkEl.getAttribute('href') || '';
                }

                if (!imageUrl) return;

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

    async discoverProductPages(page, baseUrl) {
        const links = await page.evaluate((productPatterns) => {
            const found = new Map();

            const navSelectors = [
                'nav a', 'header a', '.menu a', '.navigation a',
                '[class*="menu"] a', '[class*="nav"] a',
                '.mega-menu a', '.dropdown-menu a',
                'a.nav-link', '.nav-item a'
            ];

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

                    const hrefLower = href.toLowerCase();
                    const isProductLink = productPatterns.some(p => hrefLower.includes(p)) ||
                        categoryKeywords.some(k => hrefLower.includes(k) || text.includes(k));

                    if (isProductLink && !found.has(href)) {
                        found.set(href, link.textContent?.trim() || 'Products');
                    }
                });
            }

            return Array.from(found.entries()).map(([url, label]) => ({ url, label }));
        }, this.productUrlPatterns);

        return links.map(link => ({
            url: link.url.startsWith('http') ? link.url : new URL(link.url, baseUrl).href,
            label: link.label
        })).filter(link => {
            const lower = link.url.toLowerCase();
            const exclude = ['contact', 'about', 'blog', 'news', 'career', 'login', 'cart', 'checkout', 'account', 'privacy', 'terms', 'cookie', 'faq', 'support', 'help'];
            return !exclude.some(e => lower.includes(e));
        });
    }

    // ===================== UNIVERSAL SCRAPER =====================

    async scrapeUniversal(url, onProgress = null) {
        const { PlaywrightCrawler, Configuration } = await this.ensureInitialized();
        
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

        const storageId = `universal_${Date.now()}`;
        const crawler = new PlaywrightCrawler({
            maxConcurrency: 1,
            maxRequestsPerCrawl: 150,
            requestHandlerTimeoutSecs: 45,
            navigationTimeoutSecs: 30,
            headless: true,

            launchContext: {
                launchOptions: {
                    headless: true,
                    args: [
                        '--disable-gpu',
                        '--disable-dev-shm-usage',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--single-process',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-extensions',
                        '--memory-pressure-off'
                    ]
                }
            },

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
                const { label, category } = request.userData || {};
                const currentUrl = request.url;

                if (visitedUrls.has(currentUrl)) return;
                visitedUrls.add(currentUrl);

                console.log(`   📄 Visiting: ${currentUrl} [${label || 'DISCOVERY'}]`);
                if (onProgress && label === 'CATEGORY') {
                    const prog = Math.min(85, 30 + (visitedUrls.size * 2));
                    onProgress(Math.round(prog), `Scanning ${category}...`);
                }

                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(1500);

                if (!label || label === 'DISCOVERY') {
                    const productPages = await this.discoverProductPages(page, baseUrl);
                    for (const pg of productPages.slice(0, 20)) {
                        if (!visitedUrls.has(pg.url)) {
                            await crawler.addRequests([{
                                url: pg.url,
                                userData: { label: 'CATEGORY', category: pg.label }
                            }]);
                        }
                    }

                    const analysis = await this.analyzePage(page);
                    if (analysis.length > 0) {
                        const products = await this.extractProducts(page, analysis[0].selector, brandName, 'Homepage');
                        allProducts.push(...products);
                    }

                } else if (label === 'CATEGORY') {
                    const analysis = await this.analyzePage(page);

                    if (analysis.length > 0) {
                        const bestSelector = analysis[0].selector;
                        const products = await this.extractProducts(page, bestSelector, brandName, category);
                        
                        products.forEach(p => {
                            if (p.imageUrl && !p.imageUrl.startsWith('http')) {
                                try { p.imageUrl = new URL(p.imageUrl, currentUrl).href; } catch (e) { }
                            }
                            if (p.productUrl && !p.productUrl.startsWith('http')) {
                                try { p.productUrl = new URL(p.productUrl, currentUrl).href; } catch (e) { }
                            }
                        });

                        allProducts.push(...products);

                        const paginationLinks = await page.evaluate(() => {
                            const links = [];
                            const selectors = ['a.page-numbers', '.pagination a', 'a.next', '.pager a', 'a[rel="next"]'];
                            for (const sel of selectors) {
                                document.querySelectorAll(sel).forEach(el => {
                                    const href = el.getAttribute('href');
                                    if (href && !href.startsWith('#') && !href.startsWith('javascript')) links.push(href);
                                });
                            }
                            return [...new Set(links)];
                        });

                        for (const pageUrl of paginationLinks.slice(0, 5)) {
                            const absUrl = pageUrl.startsWith('http') ? pageUrl : new URL(pageUrl, currentUrl).href;
                            if (!visitedUrls.has(absUrl)) {
                                await crawler.addRequests([{
                                    url: absUrl,
                                    userData: { label: 'CATEGORY', category }
                                }]);
                            }
                        }
                    }
                }
            }
        }, new Configuration({
            storagePath: `./storage/${storageId}`,
            purgeOnStart: true
        }));

        await crawler.run([{ url, userData: { label: 'DISCOVERY' } }]);

        try {
            await fs.rm(path.resolve(`./storage/${storageId}`), { recursive: true, force: true });
        } catch (e) { }

        const seen = new Set();
        const uniqueProducts = [];
        for (const p of allProducts) {
            const key = `${p.model}|${p.imageUrl}`.toLowerCase();
            if (!seen.has(key) && this.isValidProductImage(p.imageUrl)) {
                seen.add(key);
                uniqueProducts.push(p);
            }
        }

        return {
            products: uniqueProducts,
            brandInfo: { name: brandName, logo: brandInfo.logo }
        };
    }

    // ===================== ARCHITONIC SCRAPER =====================

    async scrapeArchitonic(rawUrl, options = {}) {
        const { onProgress = null, onPartialData = null } = typeof options === 'function' ? { onProgress: options } : options;
        const { PlaywrightCrawler, Configuration, ProxyConfiguration, log } = await this.ensureInitialized();

        let url = rawUrl.trim().replace(/\s+/g, '');
        url = url.replace(/architonicc/g, 'architonic');
        url = url.replace(/collec+t?i?o?n?s?/g, (match) => match.startsWith('collec') ? 'collections' : match);
        if (url.includes('architonic.com') && !url.startsWith('http')) {
            url = 'https://' + url.replace(/^\/+/, '');
        }
        
        console.log(`🧹 Input: ${rawUrl}`);
        if (rawUrl !== url) console.log(`✅ Fixed: ${url}`);

        if (process.platform === 'win32') {
            try {
                exec('taskkill /F /IM chrome.exe /T', () => {});
                exec('taskkill /F /IM msedge.exe /T', () => {});
            } catch (e) { }
        }

        console.log(`\n🏗️ Starting Architonic Power Scraper: ${url}`);
        const allProducts = [];
        let brandName = 'Architonic Brand';
        let brandLogo = '';

        if (onProgress) onProgress(15, 'Launching Scraping Engine...');

        const storageId = `architonic_${Date.now()}`;
        const crawler = new PlaywrightCrawler({
            maxConcurrency: 1,
            maxRequestsPerCrawl: 50000,
            useSessionPool: true,
            persistCookiesPerSession: true,
            requestHandlerTimeoutSecs: 900,
            navigationTimeoutSecs: 300,

            proxyConfiguration: process.env.SCRAPINGBEE_API_KEY ? new ProxyConfiguration({
                proxyUrls: [`http://${process.env.SCRAPINGBEE_API_KEY}:@proxy.scrapingbee.com:8080`]
            }) : undefined,

            launchContext: {
                launchOptions: {
                    headless: true,
                    args: [
                        '--disable-gpu',
                        '--disable-dev-shm-usage',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--single-process',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-extensions'
                    ]
                }
            },

            async requestHandler({ request, page, enqueueLinks }) {
                console.log(`\n📄 Processing: ${request.url}`);

                await page.route('**/*', (route) => {
                    const type = route.request().resourceType();
                    if (['media', 'font'].includes(type)) return route.abort();
                    return route.continue();
                });

                const { label } = request.userData;

                if (!label || label === 'START') {
                    try {
                        await page.waitForSelector('h1', { timeout: 30000 });
                        await page.waitForTimeout(3000);

                        let foundName = '';
                        const h1Text = await page.$eval('h1', el => el.innerText).catch(() => '');
                        if (h1Text) {
                            foundName = h1Text.replace(/Collections by/i, '')
                                .replace(/Products by/i, '')
                                .replace(/Collections/i, '')
                                .replace(/Products/i, '')
                                .trim();
                        }

                        if (!foundName || foundName.length < 2) {
                            foundName = await page.$$eval('.breadcrumb-item, .breadcrumbs a', els => {
                                for (let i = els.length - 1; i >= 0; i--) {
                                    const text = els[i].innerText.trim();
                                    if (text && !/home|brands|products|collections/i.test(text)) return text;
                                }
                                return '';
                            }).catch(() => '');
                        }

                        brandName = foundName || brandName;
                        if (onProgress) onProgress(20, `Identified Brand: ${brandName}...`, brandName);

                        try {
                            brandLogo = await page.$eval('.logo img, img[alt*="logo" i]', el => el.src);
                        } catch (e) { }

                        await page.evaluate(() => {
                            const closeTerms = ['maybe later', 'i accept', 'close', 'agree', 'accept all'];
                            const buttons = Array.from(document.querySelectorAll('button, a'));
                            buttons.forEach(b => {
                                if (closeTerms.some(term => b.innerText.toLowerCase().includes(term))) {
                                    try { b.click(); } catch (e) { }
                                }
                            });
                        });
                        await page.waitForTimeout(2000);

                        const discoveredSubLinks = new Set();
                        const discoveredProductLinks = new Set();
                        const discoveredTabLinks = new Set();

                        let lastCount = 0;
                        let stableCycles = 0;
                        for (let i = 0; i < 50; i++) {
                            const progressVal = Math.min(45, 20 + (i * 0.5));
                            if (onProgress) onProgress(progressVal, `Discovering collections (Scan ${i}/50)...`);

                            await page.keyboard.press('End');
                            await page.waitForTimeout(1000);

                            const results = await page.evaluate((currentUrl) => {
                                window.scrollBy(0, 1500);
                                const links = Array.from(document.querySelectorAll('a'));
                                const normCurr = currentUrl.replace(/\/$/, '');

                                const tabs = links.filter(el => {
                                    const text = el.innerText.trim().toLowerCase();
                                    return (text === 'products' || text.includes('all products')) && /\/(products|all-products)\//.test(el.href);
                                }).map(el => el.href);

                                const collections = links.map(el => el.href).filter(href => {
                                    if (!href || !href.includes('architonic.com')) return false;
                                    return (href.includes('/collection/') || href.includes('/collections/') || href.includes('/category/')) && 
                                           href.replace(/\/$/, '') !== normCurr && !href.includes('#');
                                });

                                const products = links.map(el => el.href).filter(href => (href.includes('/p/') || href.includes('/product/')) && href.includes('architonic.com'));
                                return { tabs, collections, products };
                            }, request.url);

                            results.tabs.forEach(l => discoveredTabLinks.add(l));
                            results.collections.forEach(l => discoveredSubLinks.add(l));
                            results.products.forEach(l => discoveredProductLinks.add(l));

                            const currentCount = discoveredTabLinks.size + discoveredSubLinks.size + discoveredProductLinks.size;
                            if (currentCount === lastCount) {
                                if (++stableCycles >= 6) break;
                            } else {
                                stableCycles = 0;
                                lastCount = currentCount;
                            }
                        }

                        const allDiscoveryLinks = [...discoveredTabLinks, ...discoveredSubLinks];
                        if (allDiscoveryLinks.length > 0) {
                            await crawler.addRequests(allDiscoveryLinks.map(url => ({ url, userData: { label: 'COLLECTION' } })));
                        }
                        if (discoveredProductLinks.size > 0) {
                            await crawler.addRequests([...discoveredProductLinks].map(url => ({ url, userData: { label: 'PRODUCT', _brand: brandName, _coll: 'Featured' } })));
                        }
                        if (allDiscoveryLinks.length === 0 && discoveredProductLinks.size === 0) {
                            await crawler.addRequests([{ url: request.url, userData: { label: 'COLLECTION', singlePage: true } }]);
                        }
                    } catch (err) { console.error('Error in START handler:', err.message); }

                } else if (label === 'COLLECTION') {
                    await page.waitForTimeout(3000);
                    let collectionName = await page.$eval('h1', el => el.innerText).catch(() => 'Collection');

                    console.log(`   📜 Scrolling gallery: ${collectionName}...`);
                    await page.evaluate(async () => {
                        let lastCount = 0;
                        let stableCycles = 0;
                        for (let i = 0; i < 100; i++) {
                            window.scrollBy(0, 2000);
                            await new Promise(r => setTimeout(r, 1000));
                            const currentCount = document.querySelectorAll('a[href*="/p/"], a[href*="/product/"]').length;
                            if (currentCount === lastCount) {
                                if (++stableCycles >= 6) break;
                            } else {
                                stableCycles = 0;
                                lastCount = currentCount;
                            }
                        }
                    });

                    const productLinks = await page.$$eval('a', els => els.map(el => el.href).filter(href => /\/p\/[a-z0-9-]+\d+\/?/i.test(href) || href.includes('/product/')));
                    const uniqueLinks = [...new Set(productLinks)];
                    
                    if (uniqueLinks.length > 0) {
                        await enqueueLinks({ urls: uniqueLinks, userData: { label: 'PRODUCT', _brand: brandName, _coll: collectionName } });
                    }

                } else if (label === 'PRODUCT') {
                    const { _brand, _coll } = request.userData;
                    await page.waitForSelector('h1', { timeout: 10000 }).catch(() => { });
                    const name = await page.$eval('h1', el => el.innerText.trim()).catch(() => '');

                    let categoryHierarchy = await page.$$eval('.breadcrumb-item, .breadcrumbs a', els => els.map(el => el.innerText.trim()).filter(t => t && !/home|brands/i.test(t))).catch(() => []);
                    let resolvedMainCat = 'Furniture';
                    let resolvedSubCat = _coll || 'General';

                    if (categoryHierarchy.length >= 2) {
                        resolvedSubCat = categoryHierarchy[categoryHierarchy.length - 2];
                        resolvedMainCat = categoryHierarchy[categoryHierarchy.length - 3] || categoryHierarchy[0];
                    }

                    const img = await page.evaluate(() => {
                        const activeImg = document.querySelector('img.opacity-100, img.active');
                        if (activeImg && activeImg.src.includes('architonic.com') && !activeImg.src.includes('/family/')) return activeImg.src;
                        const productImg = Array.from(document.querySelectorAll('img')).find(i => i.src.includes('/product/') && i.width > 200);
                        return productImg ? productImg.src : (document.querySelector('img[itemprop="image"]')?.src || '');
                    });

                    if (onProgress && name) {
                        onProgress(Math.min(95, 30 + (allProducts.length * 0.4)), `[${allProducts.length + 1}] Harvesting: ${name}...`);
                    }

                    let description = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
                    if (name && (img || name.length > 2)) {
                        allProducts.push({
                            mainCategory: resolvedMainCat,
                            subCategory: resolvedSubCat,
                            family: _brand,
                            model: name, // Clean name without #ID for AI matching
                            description: description || name,
                            imageUrl: img || 'https://via.placeholder.com/400x400?text=No+Image',
                            productUrl: request.url,
                            price: 0
                        });

                        if (onPartialData && (allProducts.length % 10 === 0)) {
                            await onPartialData({ products: [...allProducts], brandInfo: { name: brandName, logo: brandLogo } });
                        }
                    }
                }
            }
        }, new Configuration({
            storagePath: `./storage/${storageId}`,
            purgeOnStart: true
        }));

        await crawler.run([url]);
        try {
            await fs.rm(path.resolve(`./storage/${storageId}`), { recursive: true, force: true });
        } catch (e) { }

        return { products: allProducts, brandInfo: { name: brandName, logo: brandLogo } };
    }

    async scrapeBrand(url, onProgress = null) {
        if (process.env.VERCEL === '1') throw new Error('Web scraping is not available in the deployed environment.');

        try {
            if (url.includes('architonic.com')) {
                const result = await this.scrapeArchitonic(url, onProgress);
                return {
                    products: result.products,
                    summary: { totalFound: result.products.length, unique: result.products.length, enriched: 0, failedEnrichment: 0 },
                    brandInfo: result.brandInfo
                };
            }

            const result = await this.scrapeUniversal(url, onProgress);
            const enrichmentStats = await this.enrichDescriptions(result.products);

            const seen = new Set();
            const uniqueProducts = result.products.filter(p => {
                const key = `${p.model}|${p.productUrl}`.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            return {
                products: uniqueProducts,
                summary: { totalFound: result.products.length, unique: uniqueProducts.length, enriched: enrichmentStats.enriched, failedEnrichment: enrichmentStats.failed.length },
                brandInfo: result.brandInfo
            };
        } catch (error) {
            console.error('Final scrape error:', error);
            throw error;
        }
    }

    async enrichDescriptions(products) {
        let enriched = 0;
        const failed = [];
        for (let i = 0; i < products.length; i += 5) {
            const batch = products.slice(i, i + 5);
            await Promise.all(batch.map(async (product) => {
                if (!product.productUrl) return;
                try {
                    const res = await axios.get(product.productUrl, { headers: this.getHeaders(), timeout: 10000 });
                    const $ = cheerio.load(res.data);
                    const descSelectors = ['.woocommerce-product-details__short-description', '.product-description', '#tab-description', 'meta[name="description"]'];
                    for (const sel of descSelectors) {
                        let desc = sel.startsWith('meta') ? $(sel).attr('content') : $(sel).first().text();
                        desc = desc?.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
                        if (desc && desc.length > 15 && desc !== product.model) {
                            product.description = desc;
                            enriched++;
                            break;
                        }
                    }
                } catch (e) { failed.push(product.model); }
            }));
            await new Promise(r => setTimeout(r, 200));
        }
        return { enriched, failed };
    }
}

export default ScraperService;
