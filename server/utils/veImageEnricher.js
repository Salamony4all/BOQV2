/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Value Engineered Offer — Verified Live Product Image & Media Engine    │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Discovers and verifies real high-resolution product photos directly from
 * manufacturer websites, OpenGraph tags, Architonic CDN, and architectural media.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { searchWebHtml } from './webSearchUtils.js';

const VERIFY_IMAGE_CACHE = new Map(); // url -> { ok, ts }
const VERIFY_CACHE_TTL_MS = 15 * 60 * 1000;

function hasImageMagicBytes(buf) {
    if (!buf || buf.length < 12) return false;
    // JPEG (FF D8 FF), PNG (89 50 4E 47), GIF (47 49 46 38), WEBP (RIFF....WEBP), AVIF/HEIF (....ftyp)
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
    const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
    const isIsoBmff = buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
    return isJpeg || isPng || isGif || isWebp || isIsoBmff;
}

/**
 * Validates if an image URL returns HTTP 200 with real raster image bytes (> 1.5KB)
 * and rejects HTML soft-404s, SVGs, logos, and dead links (cached 15 min).
 */
export async function verifyImageUrl(url, referer = '') {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
    if (/\.svg(\?|$)|\/logo\/|favicon|pixel|avatar|placehold\.co/i.test(url)) return false;

    const cached = VERIFY_IMAGE_CACHE.get(url);
    if (cached && (Date.now() - cached.ts) < VERIFY_CACHE_TTL_MS) {
        return cached.ok;
    }

    const storeCache = (ok) => {
        if (VERIFY_IMAGE_CACHE.size >= 1200) {
            VERIFY_IMAGE_CACHE.delete(VERIFY_IMAGE_CACHE.keys().next().value);
        }
        VERIFY_IMAGE_CACHE.set(url, { ok, ts: Date.now() });
        return ok;
    };

    let refOrigin = '';
    try { refOrigin = new URL(referer || url).origin + '/'; } catch {}
    try {
        const res = await axios.get(url, {
            timeout: 5000,
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                ...(refOrigin ? { 'Referer': refOrigin } : {})
            }
        });
        const contentType = String(res.headers['content-type'] || '').toLowerCase();
        // Reject HTML soft-404s, JSON errors, plain text, or SVG XML even when URL ends in .jpg
        if (/(text\/html|application\/json|text\/plain|application\/xml|image\/svg)/i.test(contentType)) {
            return storeCache(false);
        }
        const buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data || '');
        const len = buf.length;
        const looksLikeImage = contentType.startsWith('image/') || hasImageMagicBytes(buf);
        const ok = (res.status >= 200 && res.status < 400 && looksLikeImage && !contentType.includes('svg') && len > 1500 && (hasImageMagicBytes(buf) || contentType.startsWith('image/')));
        return storeCache(ok);
    } catch (e) {
        return storeCache(false);
    }
}

/**
 * Searches and verifies genuine high-resolution product photos.
 */
export async function fetchLiveProductImage(brand, model, directUrl = '') {
    if (!brand && !model && !directUrl) return '';

    // 1. If direct reference URL is supplied, scrape OpenGraph / Schema / Gallery elements
    if (directUrl && directUrl.startsWith('http')) {
        try {
            const pageRes = await axios.get(directUrl, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                }
            });
            if (pageRes.status === 200 && pageRes.data) {
                const $ = cheerio.load(pageRes.data);
                
                const ogImg = $('meta[property="og:image"]').attr('content') || 
                              $('meta[name="og:image"]').attr('content') ||
                              $('meta[name="twitter:image"]').attr('content') ||
                              $('meta[property="twitter:image"]').attr('content') ||
                              $('link[rel="image_src"]').attr('href');
                
                if (ogImg) {
                    const fullOg = ogImg.startsWith('http') ? ogImg : new URL(ogImg, directUrl).href;
                    if (!fullOg.includes('logo') && !fullOg.includes('icon') && await verifyImageUrl(fullOg, directUrl)) {
                        return fullOg;
                    }
                }

                // Check page image gallery elements
                const candidateImages = [];
                $('.product-cover img, .js-qv-product-cover, img.wp-post-image, .woocommerce-product-gallery__image img, .product-images img, .product-gallery img, .gallery img, img[itemprop="image"], .main-image img, main img, img').each((_, el) => {
                    const src = $(el).attr('data-large_image') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('src');
                    if (src) candidateImages.push(src);
                });

                for (const imgSrc of candidateImages) {
                    const fullSrc = imgSrc.startsWith('http') ? imgSrc : new URL(imgSrc, directUrl).href;
                    if (!fullSrc.includes('logo') && !fullSrc.includes('icon') && !fullSrc.includes('pixel') && !fullSrc.includes('avatar') && await verifyImageUrl(fullSrc, directUrl)) {
                        return fullSrc;
                    }
                }
            }
        } catch (e) {}
    }

    // 2. High-speed Web Image Query via Bing Image index (Architonic / Manufacturer CDN)
    const cleanBrand = (brand || '').replace(/[^a-zA-Z0-9 &]/g, ' ').trim();
    const cleanModel = (model || '').replace(/[^a-zA-Z0-9 -]/g, ' ').trim();
    const altBrand = (brand.toLowerCase() === 'moonako' ? 'Moodie' : (brand.toLowerCase() === 'moodie' ? 'Moonako' : ''));

    const searchQueries = [
        `"${cleanBrand}" "${cleanModel}" furniture product site:architonic.com OR site:archiproducts.com OR site:archello.com`,
        `"${cleanBrand}" "${cleanModel}" official website product photo`,
        `${cleanBrand} ${cleanModel} contract furniture`,
        ...(altBrand ? [`${altBrand} ${cleanModel} furniture`] : [])
    ];

    for (const query of searchQueries) {
        try {
            const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`;
            const res = await axios.get(bingUrl, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                }
            });
            if (res.status === 200 && res.data) {
                const matches = res.data.match(/murl&quot;:&quot;(https?:\\\/\\\/[^&]+)&quot;/g) || 
                                res.data.match(/"murl":"(https?:\/\/[^"]+)"/g) || [];
                for (const match of matches.slice(0, 6)) {
                    let cleanUrl = match.replace(/murl&quot;:&quot;/, '').replace(/&quot;$/, '').replace(/"murl":"/, '').replace(/"$/, '').replace(/\\\//g, '/');
                    if (cleanUrl && !cleanUrl.includes('logo') && !cleanUrl.includes('icon') && !cleanUrl.includes('avatar') && await verifyImageUrl(cleanUrl)) {
                        return cleanUrl;
                    }
                }
            }
        } catch (e) {}
    }

    // 3. Zero-LLM DuckDuckGo HTML fallback -> scrape og:image from Architonic / official product page
    if (cleanBrand && cleanModel) {
        try {
            const ddgHits = await searchWebHtml(`"${cleanBrand}" "${cleanModel}" (site:architonic.com OR site:archiproducts.com OR furniture)`, 4);
            for (const hit of ddgHits) {
                if (!hit?.url || !/^https?:\/\//i.test(hit.url)) continue;
                try {
                    const pageRes = await axios.get(hit.url, {
                        timeout: 5000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                        }
                    });
                    if (pageRes.status === 200 && typeof pageRes.data === 'string') {
                        const $ = cheerio.load(pageRes.data);
                        const ogImg = $('meta[property="og:image"]').attr('content') ||
                                      $('meta[name="og:image"]').attr('content') ||
                                      $('meta[name="twitter:image"]').attr('content') ||
                                      $('meta[property="twitter:image"]').attr('content');
                        if (ogImg) {
                            const fullOg = ogImg.startsWith('http') ? ogImg : new URL(ogImg, hit.url).href;
                            if (!/logo|icon|avatar|favicon|placeholder|\.svg(\?|$)/i.test(fullOg) && await verifyImageUrl(fullOg, hit.url)) {
                                return fullOg;
                            }
                        }
                    }
                } catch { /* try next hit */ }
            }
        } catch { /* ignore */ }
    }

    return '';
}

/**
 * Sanitizes LLM descriptions to remove conversational apologies, user-prompt repetitions, or search preamble.
 */
export function cleanTechnicalDescription(desc, brand = '', model = '') {
    if (!desc || typeof desc !== 'string') {
        return `${brand} ${model} commercial contract specification. Designed for high-traffic commercial and hospitality spaces.`.trim();
    }

    let cleaned = desc
        .replace(/^(The user specified|I was unable to|I cannot fulfill|Specifications for|Due to the lack of|According to the search|As described by|The provided link|While specific dimensions).*?(\. |\n|$)/gim, '')
        .replace(/(However, |Note that |Please note that |The search results also indicate).*?(\. |\n|$)/gim, '')
        .replace(/`{1,3}[a-z]*\n?/gi, '')
        .replace(/[*_#]/g, '')
        .trim();

    if (cleaned.length < 20) {
        return `${brand} ${model} commercial contract specification. High-durability architectural construction with premium finish.`.trim();
    }

    return cleaned;
}
