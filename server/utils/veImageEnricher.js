/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Value Engineered Offer — Verified Live Product Image & Media Engine    │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Discovers and verifies real high-resolution product photos directly from
 * manufacturer websites, OpenGraph tags, Architonic CDN, and architectural media.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Validates if an image URL returns HTTP 200 with an image content-type and meaningful payload (> 2KB).
 */
export async function verifyImageUrl(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
    try {
        const res = await axios.get(url, {
            timeout: 5000,
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });
        const contentType = res.headers['content-type'] || '';
        const len = res.data ? res.data.length : 0;
        return (res.status === 200 && contentType.startsWith('image/') && len > 2000);
    } catch (e) {
        return false;
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
                    if (!fullOg.includes('logo') && !fullOg.includes('icon') && await verifyImageUrl(fullOg)) {
                        return fullOg;
                    }
                }

                // Check page image gallery elements
                const candidateImages = [];
                $('img.wp-post-image, .woocommerce-product-gallery__image img, .product-images img, .product-gallery img, .gallery img, img[itemprop="image"], .main-image img, img').each((_, el) => {
                    const src = $(el).attr('data-large_image') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('src');
                    if (src) candidateImages.push(src);
                });

                for (const imgSrc of candidateImages) {
                    const fullSrc = imgSrc.startsWith('http') ? imgSrc : new URL(imgSrc, directUrl).href;
                    if (!fullSrc.includes('logo') && !fullSrc.includes('icon') && !fullSrc.includes('pixel') && !fullSrc.includes('avatar') && await verifyImageUrl(fullSrc)) {
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
