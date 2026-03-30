"""
Architonic Scraper for Python
Specialized scraper for Architonic.com brand pages.

This mirrors the functionality of the JS scraper in scraper.js
"""

import sys
import json
import logging
import re
from urllib.parse import urljoin, urlparse

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

try:
    from scrapling import DynamicFetcher
except ImportError as e:
    logger.error(f"CRITICAL: Failed to import scrapling: {e}")
    DynamicFetcher = None


def extract_brand_name(page, url):
    """Extract brand name from Architonic page."""
    brand_name = "Architonic Brand"
    
    try:
        # Try H1 first
        h1 = page.css('h1::text').get()
        if h1:
            brand_name = h1.replace('Collections by', '').replace('Products by', '').replace('Collections', '').replace('Products', '').strip()
        
        # Fallback to breadcrumbs
        if not brand_name or len(brand_name) < 2:
            breadcrumbs = page.css('.breadcrumb-item::text, [class*="breadcrumb"] li::text, .breadcrumbs a::text').getall()
            for crumb in reversed(breadcrumbs):
                crumb = crumb.strip()
                if crumb and not re.match(r'(home|brands|products|collections)', crumb, re.I):
                    brand_name = crumb
                    break
        
        # Fallback to title
        if not brand_name or len(brand_name) < 2:
            title = page.css('title::text').get() or ''
            brand_name = title.split('|')[0].replace('Architonic', '').strip()
        
        if not brand_name or brand_name.lower() == 'brands':
            brand_name = "Architonic Brand"
            
    except Exception as e:
        logger.warning(f"Brand extraction error: {e}")
    
    return brand_name


def extract_brand_logo(page):
    """Extract brand logo from Architonic page."""
    logo = ""
    try:
        logo_selectors = [
            '.logo img::attr(src)',
            '.brand-logo img::attr(src)',
            'img[alt*="logo" i]::attr(src)'
        ]
        for sel in logo_selectors:
            logo = page.css(sel).get()
            if logo:
                break
    except:
        pass
    return logo or ""


def discover_collection_links(page, base_url):
    """Find collection and product links on Architonic page."""
    collections = set()
    products = set()
    
    try:
        all_links = page.css('a::attr(href)').getall()
        
        for href in all_links:
            if not href or 'architonic.com' not in href:
                continue
            
            # Collection links
            if any(x in href for x in ['/collection/', '/collections/', '/category/', '/product-group/']):
                if not href.endswith('/collections') and not href.endswith('/products'):
                    collections.add(href)
            
            # Direct product links
            if '/p/' in href or '/product/' in href:
                products.add(href)
        
    except Exception as e:
        logger.warning(f"Link discovery error: {e}")
    
    return list(collections), list(products)


def extract_product_from_page(page, url, brand_name, collection_name="Products"):
    """Extract product data from a product detail page."""
    try:
        # Get product name
        name = page.css('h1::text').get() or ''
        name = name.strip()
        if not name:
            return None
        
        # Get product image - multiple strategies
        image_url = ""
        
        # Strategy 1: Active carousel image
        for sel in ['img.opacity-100::attr(src)', 'img.active::attr(src)']:
            img = page.css(sel).get()
            if img and 'architonic.com' in img and '/family/' not in img:
                image_url = img
                break
        
        # Strategy 2: Product image
        if not image_url:
            all_imgs = page.css('img::attr(src)').getall()
            for img in all_imgs:
                if img and '/product/' in img and 'architonic.com' in img:
                    image_url = img
                    break
        
        # Strategy 3: Main image
        if not image_url:
            main_selectors = [
                '.product-gallery__main-image img::attr(src)',
                'img[itemprop="image"]::attr(src)',
                '.product-image img::attr(src)',
                'main img[src*="/product/"]::attr(src)'
            ]
            for sel in main_selectors:
                img = page.css(sel).get()
                if img and img.startswith('http') and '/family/' not in img:
                    image_url = img
                    break
        
        # Strategy 4: Any large image
        if not image_url:
            for img in all_imgs:
                if img and 'architonic.com' in img and 'logo' not in img.lower():
                    image_url = img
                    break
        
        if not image_url:
            return None
        
        # Get description
        description = page.css('meta[name="description"]::attr(content)').get() or ''
        
        # Try attribute elements
        if not description or len(description) < 50:
            attrs = page.css('div[class*="Attribute"]::text').getall()
            if attrs:
                description = ' | '.join([a.strip() for a in attrs if a.strip()])
        
        # Try content selectors
        if not description or len(description) < 50:
            content_selectors = ['.product-description::text', '#description::text', '.details-content::text']
            for sel in content_selectors:
                desc = page.css(sel).get()
                if desc and len(desc) > 30:
                    description = desc.strip()
                    break
        
        if not description:
            description = name
        
        # Extract variant ID from URL
        model = name
        try:
            url_parts = url.rstrip('/').split('/')
            last_part = url_parts[-1]
            id_match = re.search(r'-(\d+)$', last_part)
            if id_match:
                model = f"{name} #{id_match.group(1)}"
        except:
            pass
        
        return {
            "mainCategory": "Furniture",
            "subCategory": collection_name,
            "family": brand_name,
            "model": model,
            "description": description,
            "imageUrl": image_url,
            "productUrl": url,
            "price": 0
        }
        
    except Exception as e:
        logger.warning(f"Product extraction error: {e}")
        return None


def scrape_architonic(url):
    """
    Main Architonic scraping function.
    Crawls brand pages on Architonic to extract product data.
    """
    logger.info(f"Starting Architonic scrape for: {url}")
    
    if DynamicFetcher is None:
        raise RuntimeError("Scrapling DynamicFetcher is not available")
    
    fetcher = DynamicFetcher(headless=True)
    products = []
    seen_urls = set()
    
    try:
        # Load main page
        logger.info("Loading brand page...")
        page = fetcher.fetch(url, wait_time=3)
        
        base_url = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        
        # Extract brand info
        brand_name = extract_brand_name(page, url)
        brand_logo = extract_brand_logo(page)
        logger.info(f"Brand identified: {brand_name}")
        
        # Discover links
        logger.info("Discovering collections and products...")
        collections, direct_products = discover_collection_links(page, base_url)
        logger.info(f"Found {len(collections)} collections and {len(direct_products)} direct products")
        
        # Process direct products from main page first
        for prod_url in direct_products[:50]:  # Limit
            if prod_url in seen_urls:
                continue
            seen_urls.add(prod_url)
            
            try:
                prod_page = fetcher.fetch(prod_url, wait_time=2)
                product = extract_product_from_page(prod_page, prod_url, brand_name, "Featured")
                if product:
                    products.append(product)
                    logger.info(f"  Extracted: {product['model']}")
            except Exception as e:
                logger.warning(f"  Failed to scrape product {prod_url}: {e}")
        
        # Process collections
        for coll_url in collections[:20]:  # Limit to 20 collections
            if coll_url in seen_urls:
                continue
            seen_urls.add(coll_url)
            
            try:
                logger.info(f"Processing collection: {coll_url}")
                coll_page = fetcher.fetch(coll_url, wait_time=3)
                
                # Get collection name
                coll_name = coll_page.css('h1::text').get() or "Collection"
                coll_name = coll_name.strip()
                
                # Find product links in collection
                coll_products = coll_page.css('a::attr(href)').getall()
                prod_urls = [
                    href for href in coll_products 
                    if href and ('/p/' in href or '/product/' in href) and 'architonic.com' in href
                ]
                prod_urls = list(set(prod_urls))[:50]  # Limit per collection
                
                logger.info(f"  Found {len(prod_urls)} products in {coll_name}")
                
                for prod_url in prod_urls:
                    if prod_url in seen_urls:
                        continue
                    seen_urls.add(prod_url)
                    
                    try:
                        prod_page = fetcher.fetch(prod_url, wait_time=2)
                        product = extract_product_from_page(prod_page, prod_url, brand_name, coll_name)
                        if product:
                            products.append(product)
                    except Exception as e:
                        continue
                        
            except Exception as e:
                logger.warning(f"Failed to process collection {coll_url}: {e}")
        
        # Deduplicate
        seen = set()
        unique_products = []
        for p in products:
            key = f"{p['model']}|{p['imageUrl']}".lower()
            if key not in seen:
                seen.add(key)
                unique_products.append(p)
        
        logger.info(f"Architonic scrape complete: {len(unique_products)} unique products")
        
        return {
            "products": unique_products,
            "brandInfo": {
                "name": brand_name,
                "logo": brand_logo
            }
        }
        
    except Exception as e:
        logger.error(f"Architonic scrape failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise e


# CLI support
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python architonic_scraper.py <architonic_url>")
        sys.exit(1)
    
    url = sys.argv[1]
    try:
        result = scrape_architonic(url)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
