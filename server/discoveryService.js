import axios from 'axios';
import * as cheerio from 'cheerio';
import BrowserlessScraper from './browserlessScraper.js';
import { normalizeProducts } from './utils/normalizer.js';
import { callLlm } from './utils/llmUtils.js';

class DiscoveryService {
  constructor() {
    this.scraper = new BrowserlessScraper();
  }

  /**
   * Main entry point for JIT Discovery.
   * Tries Architonic first, then falls back to Brand Official Website via Google.
   */
  async discoverModel(brandName, modelName) {
    if (!brandName || !modelName || modelName === 'null') return null;

    // 1. Try Architonic (Fast & Structured)
    let product = await this.searchArchitonic(brandName, modelName);
    if (product) return product;

    // 2. Fallback to Internet-Wide (Google + LLM Extraction)
    console.log(`🌐 [Discovery] Falling back to Internet-Wide Search for: ${brandName} ${modelName}`);
    product = await this.searchInternetWide(brandName, modelName);
    
    return product;
  }

  async searchArchitonic(brandName, modelName) {
    console.log(`🔍 [Discovery] Searching Architonic for: ${brandName} ${modelName}`);
    const query = encodeURIComponent(`${brandName} ${modelName}`);
    const searchUrl = `https://www.architonic.com/en/all/${query}/0-0-2-1`;

    let browser;
    try {
      browser = await this.scraper.getBrowser();
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(this.scraper.userAgent);

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
      });

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      const topResult = await page.evaluate(() => {
        const card = document.querySelector('[data-at-element="product-card"], .at-product-card');
        if (!card) return null;
        const nameEl = card.querySelector('[data-at-element="product-name"], .at-product-card__name');
        const imgEl = card.querySelector('img.at-image, .at-product-card__image img');
        const linkEl = card.querySelector('a.at-base-link');
        return {
          model: nameEl?.innerText?.trim() || '',
          imageUrl: imgEl?.src || '',
          productUrl: linkEl?.href || '',
          description: card.querySelector('.at-product-card__description')?.innerText?.trim() || ''
        };
      });

      if (topResult?.productUrl) {
        return this.wrapAndNormalize(brandName, topResult);
      }
      return null;
    } catch (e) {
      console.warn(`⚠️ [Discovery] Architonic failed: ${e.message}`);
      return null;
    } finally {
      if (browser) await browser.close();
    }
  }

  async searchInternetWide(brandName, modelName) {
    const query = encodeURIComponent(`${brandName} ${modelName} official website product`);
    const searchUrl = `https://www.google.com/search?q=${query}`;

    let browser;
    try {
      browser = await this.scraper.getBrowser();
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(this.scraper.userAgent);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Get first few organic result links
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('div.g a'))
          .map(a => a.href)
          .filter(href => href && !href.includes('google.com') && !href.includes('youtube.com'))
          .slice(0, 2);
      });

      if (links.length === 0) return null;

      // Try the best link
      const targetUrl = links[0];
      console.log(`🔗 [Discovery] Digging into: ${targetUrl}`);
      
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const pageContent = await page.evaluate(() => {
        // Get text and image candidates
        const text = document.body.innerText.substring(0, 5000); // Sample top 5k chars
        const imgs = Array.from(document.querySelectorAll('img'))
          .map(img => ({ src: img.src, width: img.width, height: img.height }))
          .filter(img => img.width > 200 && img.height > 200)
          .slice(0, 5);
        return { text, imgs };
      });

      // Use AI to extract product details from raw page content
      const extractionPrompt = `
        You are a professional furniture data extractor. Below is the raw text from a product page.
        Extract the following into a JSON object:
        { 
          "model": "String", 
          "description": "String", 
          "imageUrl": "String",
          "isWorkstation": true/false 
        }

        CONTEXT (Brand: ${brandName}, Suggested Model: ${modelName})
        IMAGE CANDIDATES: ${JSON.stringify(pageContent.imgs)}
        PAGE TEXT:
        ${pageContent.text}

        RULES:
        1. If you can't find a clear image or model matching the context, return null.
        2. Set "isWorkstation": true if the text mentions "bench system", "modular workstation", "back-to-back", "pax", or "office cluster".
        3. Prioritize high-quality image URLs from the candidates.
      `;

      const aiResponse = await callLlm(extractionPrompt);
      const cleaned = aiResponse.match(/\{[\s\S]*\}/)?.[0];
      if (!cleaned) return null;

      const extracted = JSON.parse(cleaned);
      if (!extracted.model || extracted.model === 'null') return null;

      extracted.productUrl = targetUrl;
      return this.wrapAndNormalize(brandName, extracted);

    } catch (e) {
      console.error(`❌ [Discovery] Internet search failed for ${brandName}:`, e.message);
      return null;
    } finally {
      if (browser) await browser.close();
    }
  }

  wrapAndNormalize(brandName, data) {
    const rawProduct = {
      mainCategory: 'Furniture',
      subCategory: 'Discovery',
      family: brandName,
      model: data.model,
      description: (data.isWorkstation ? '[WORKSTATION] ' : '') + (data.description || data.model),
      imageUrl: data.imageUrl,
      productUrl: data.productUrl,
      price: 0
    };
    const normalized = normalizeProducts([rawProduct]);
    return normalized[0];
  }
}

export default new DiscoveryService();
