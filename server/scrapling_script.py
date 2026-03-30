import sys
import json
from urllib.parse import urljoin
try:
    from scrapling import DynamicFetcher
except ImportError:
    pass
import logging
import os

# Suppress logs
logging.getLogger().setLevel(logging.CRITICAL)
os.environ['SCRAPLING_LOG_LEVEL'] = 'CRITICAL' # Just in case

def scrape(url):
    try:
        # Use DynamicFetcher as it proved working
        fetcher = DynamicFetcher(headless=True)
        page = fetcher.fetch(url)
        
        # Brand Info
        title = page.css('title::text').get() or "Unknown Brand"
        brand_name = title.split('|')[0].split('-')[0].strip()
        
        # Logo - try to find header logo
        logo = ""
        logo_img = page.css('header img')
        if logo_img:
            src = logo_img.attrib.get('src')
            if src:
                logo = urljoin(url, src)
        
        products = []
        seen_urls = set()
        
        # Simple heuristic: Look for <a> tags that contain <img> and minimal text
        # This matches many e-commerce grids
        links = page.css('a')
        
        for link in links:
            href = link.attrib.get('href')
            if not href or href.startswith('#') or href.startswith('javascript'):
                continue
                
            full_url = urljoin(url, href)
            
            if full_url in seen_urls:
                continue
            
            # Check for image inside
            imgs = link.css('img')
            
            # Check for text (name)
            # Text might be in a span or div inside, Scrapling's element .text gets all text
            text = link.text
            if not text:
                continue
            text = text.strip()
            if len(text) < 3 or len(text) > 200:
                continue
                
            if imgs:
                img_src = imgs[0].attrib.get('src') or imgs[0].attrib.get('data-src')
                if img_src:
                    full_img_src = urljoin(url, img_src)
                    
                    products.append({
                        "name": text,
                        "link": full_url, # Frontend expects 'link' or 'url'? Scraper result usually has 'url' for product?
                        # Existing brands have 'products' array. Let's check structure.
                        # Usually: { name: "", link: "", image: "" }
                        "image": full_img_src
                    })
                    seen_urls.add(full_url)
        
        result = {
            "products": products,
            "brandInfo": {
                "name": brand_name,
                "logo": logo
            }
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        # Print error as JSON so caller can parse it
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        scrape(sys.argv[1])
    else:
        print(json.dumps({"error": "No URL provided"}))
