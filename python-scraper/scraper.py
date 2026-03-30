import sys
import json
import logging
from urllib.parse import urljoin, urlparse

# Configure logging to console
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

try:
    from scrapling import DynamicFetcher
except ImportError as e:
    logger.error(f"CRITICAL: Failed to import scrapling: {e}")
    import traceback
    logger.error(traceback.format_exc())
    DynamicFetcher = None

# === CONFIGURATION ===
PRODUCT_KEYWORDS = ['product', 'products', 'item', 'shop', 'collection', 'category', 'furniture', 'chair', 'desk', 'table', 'seating']
EXCLUDE_KEYWORDS = ['contact', 'about', 'login', 'cart', 'privacy', 'social', 'news', 'blog', 'terms', 'careers', 'account', 'faq', 'instagram', 'facebook', 'twitter', 'youtube', 'linkedin']
IMAGE_EXCLUDE = ['logo', 'icon', 'arrow', 'chevron', 'placeholder', 'blank', 'loading', 'spinner', 'social', 'banner']


def is_valid_product_image(url):
    """Check if image URL is likely a product image, not UI element."""
    if not url or len(url) < 10:
        return False
    lower = url.lower()
    return not any(term in lower for term in IMAGE_EXCLUDE)


def parse_woocommerce_category_url(url):
    """
    Extract category hierarchy from WooCommerce URL patterns.
    e.g., /product-category/chairs/executive-chairs/ -> ('Chairs', 'Executive Chairs')
    e.g., /chairs/stool/ -> ('Chairs', 'Stool')
    """
    try:
        from urllib.parse import urlparse
        path = urlparse(url).path.strip('/')
        parts = [p for p in path.split('/') if p and p != 'product-category']
        
        if len(parts) >= 2:
            main_cat = parts[0].replace('-', ' ').title()
            sub_cat = parts[-1].replace('-', ' ').title()
            if main_cat != sub_cat:
                return main_cat, sub_cat
        elif len(parts) == 1:
            cat = parts[0].replace('-', ' ').title()
            return cat, cat
    except:
        pass
    return None, None


def create_product(name, image_url, product_url, brand_name, main_category='General', sub_category=None):
    """
    Create a product dict in the format expected by the UI.
    """
    return {
        "mainCategory": main_category,
        "subCategory": sub_category or main_category,
        "family": brand_name,
        "model": name,
        "description": name,
        "imageUrl": image_url,
        "productUrl": product_url,
        "price": 0
    }


def extract_products_from_page(page, base_url, brand_name, main_category='General', sub_category=None):
    """
    Extract products from a page using multiple strategies.
    Mirrors the approach from structureScraper.js.
    """
    products = []
    seen = set()
    
    # === STRATEGY 1: WooCommerce product containers ===
    woo_selectors = [
        'li.product',
        '.products .product',
        '.product-item',
        '.product-card',
        '[class*="product-item"]',
        '[class*="product-card"]'
    ]
    
    for selector in woo_selectors:
        try:
            containers = page.css(selector)
            if containers and len(containers) > 0:
                logger.info(f"Found {len(containers)} containers with selector: {selector}")
                
                for container in containers:
                    try:
                        # Extract title
                        title = None
                        for title_sel in ['h2::text', 'h3::text', '.woocommerce-loop-product__title::text', '.product-title::text', '.title::text', 'a::attr(title)']:
                            title = container.css(title_sel).get()
                            if title and len(title.strip()) > 2:
                                title = title.strip()
                                break
                        
                        if not title:
                            # Try getting text from main link
                            link_text = container.css('a::text').get()
                            if link_text and len(link_text.strip()) > 2:
                                title = link_text.strip()
                        
                        if not title or title.lower() in seen:
                            continue
                        
                        # Extract image
                        img_src = (
                            container.css('img::attr(src)').get() or
                            container.css('img::attr(data-src)').get() or
                            container.css('img::attr(data-lazy-src)').get()
                        )
                        
                        # Check srcset for better quality
                        srcset = container.css('img::attr(srcset)').get()
                        if srcset:
                            # Take the first URL from srcset
                            img_src = srcset.split(',')[0].strip().split(' ')[0] or img_src
                        
                        if not img_src or not is_valid_product_image(img_src):
                            continue
                        
                        # Extract product URL
                        product_url = container.css('a::attr(href)').get()
                        if not product_url:
                            continue
                        
                        full_img = urljoin(base_url, img_src)
                        full_url = urljoin(base_url, product_url)
                        
                        if full_url in seen:
                            continue
                        
                        seen.add(title.lower())
                        seen.add(full_url)
                        
                        products.append(create_product(
                            name=title,
                            image_url=full_img,
                            product_url=full_url,
                            brand_name=brand_name,
                            main_category=main_category,
                            sub_category=sub_category
                        ))
                        
                    except Exception as e:
                        continue
                        
        except Exception as e:
            continue
    
    # === STRATEGY 2: Generic container detection (like structureScraper.js) ===
    if len(products) < 5:
        try:
            # Look for div/li/article that contains both img and link
            containers = page.css('div, li, article, section')
            
            for container in containers:
                try:
                    # Must have image
                    img = container.css('img')
                    if not img:
                        continue
                    
                    # Must have link
                    link = container.css('a[href]')
                    if not link:
                        continue
                    
                    # Check for heading or substantial text
                    heading = container.css('h1, h2, h3, h4, h5, .title, .name')
                    link_text = link.css('::text').get() or ""
                    
                    # Get the name
                    title = None
                    if heading:
                        title = heading.css('::text').get()
                    if not title and len(link_text.strip()) > 5:
                        title = link_text.strip()
                    
                    if not title or len(title) < 3 or title.lower() in seen:
                        continue
                    
                    # Get image
                    img_src = (
                        img.css('::attr(src)').get() or
                        img.css('::attr(data-src)').get()
                    )
                    
                    if not img_src or not is_valid_product_image(img_src):
                        continue
                    
                    # Get URL
                    href = link.css('::attr(href)').get()
                    if not href:
                        continue
                    
                    full_url = urljoin(base_url, href)
                    full_img = urljoin(base_url, img_src)
                    
                    if full_url in seen:
                        continue
                    
                    # Skip if already added
                    if any(p['productUrl'] == full_url for p in products):
                        continue
                    
                    seen.add(title.lower())
                    seen.add(full_url)
                    
                    products.append(create_product(
                        name=title,
                        image_url=full_img,
                        product_url=full_url,
                        brand_name=brand_name,
                        main_category=main_category,
                        sub_category=sub_category
                    ))
                    
                except:
                    continue
                    
        except Exception as e:
            logger.warning(f"Generic extraction error: {e}")
    
    # === STRATEGY 3: JSON-LD Structured Data ===
    try:
        scripts = page.css('script[type="application/ld+json"]::text').getall()
        if not isinstance(scripts, list):
            single = page.css('script[type="application/ld+json"]::text').get()
            scripts = [single] if single else []
        
        for script in scripts:
            try:
                data = json.loads(script)
                items = data.get('@graph', [data]) if isinstance(data, dict) else (data if isinstance(data, list) else [])
                
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    
                    item_type = item.get('@type', '')
                    if isinstance(item_type, list):
                        item_type = item_type[0]
                    
                    if item_type == 'Product':
                        p_name = item.get('name')
                        p_img = item.get('image')
                        if isinstance(p_img, list):
                            p_img = p_img[0]
                        elif isinstance(p_img, dict):
                            p_img = p_img.get('url')
                        
                        p_url = item.get('url') or base_url
                        
                        if p_name and p_img:
                            full_url = urljoin(base_url, p_url)
                            full_img = urljoin(base_url, p_img)
                            
                            if full_url not in seen and p_name.lower() not in seen:
                                products.append(create_product(
                                    name=p_name,
                                    image_url=full_img,
                                    product_url=full_url,
                                    brand_name=brand_name,
                                    main_category=main_category,
                                    sub_category=sub_category
                                ))
                                seen.add(full_url)
                                seen.add(p_name.lower())
                    
                    elif item_type == 'ItemList':
                        for li in item.get('itemListElement', []):
                            if isinstance(li, dict):
                                product = li.get('item')
                                if product and isinstance(product, dict):
                                    p_name = product.get('name')
                                    p_url = product.get('url') or product.get('@id')
                                    p_img = product.get('image')
                                    
                                    if p_name and p_url:
                                        full_url = urljoin(base_url, p_url)
                                        full_img = urljoin(base_url, p_img) if p_img else ""
                                        
                                        if full_url not in seen:
                                            products.append(create_product(
                                                name=p_name,
                                                image_url=full_img,
                                                product_url=full_url,
                                                brand_name=brand_name,
                                                main_category=main_category,
                                                sub_category=sub_category
                                            ))
                                            seen.add(full_url)
            except:
                continue
    except Exception as e:
        logger.warning(f"JSON-LD extraction error: {e}")
    
    return products, seen


def discover_category_pages(page, base_url):
    """
    Find category/collection pages to crawl.
    Detects hierarchical navigation menus (main categories with subcategories).
    Returns list of {url, title, mainCategory, subCategory}
    """
    categories = []
    seen = set()
    
    try:
        # === STRATEGY 1: Detect WooCommerce/WordPress/Elementor menu structure ===
        # Look for nav menus with nested ul/li structure
        menu_selectors = [
            # Elementor Mega Menu (used by Ottimo, Besa theme)
            'ul.elementor-nav-menu > li.level-0',
            'ul.elementor-nav-menu > li.menu-item',
            # Standard WordPress
            'nav ul.menu > li',
            'nav ul.nav-menu > li', 
            '.primary-menu > li',
            '#primary-menu > li',
            '.main-menu > li',
            'header nav > ul > li',
            '.navigation > ul > li',
            'ul.menu > li.menu-item'
        ]
        
        for selector in menu_selectors:
            try:
                menu_items = page.css(selector)
                if not menu_items or len(menu_items) == 0:
                    continue
                
                logger.info(f"Found {len(menu_items)} menu items with selector: {selector}")
                
                for item in menu_items:
                    try:
                        # Get main category link - try multiple patterns
                        main_link = item.css('> a.elementor-item') or item.css('> a') or item.css('a')
                        if not main_link:
                            continue
                        
                        main_href = main_link.css('::attr(href)').get()
                        main_text = main_link.css('::text').get() or ""
                        main_text = main_text.strip()
                        
                        # Skip excluded
                        if not main_text or len(main_text) < 2:
                            continue
                        if any(ex in main_text.lower() for ex in EXCLUDE_KEYWORDS):
                            continue
                        
                        # Check for submenu (dropdown items) - multiple patterns including Elementor
                        submenu_selectors = [
                            # Elementor mega menu patterns
                            'div.dropdown-menu a',
                            'div.dropdown-menu ul.menu-vertical li a',
                            'div.dropdown-menu li a',
                            # Standard WordPress patterns
                            'ul.sub-menu > li > a',
                            'ul.dropdown-menu > li > a',
                            '.sub-menu a',
                            '.dropdown a'
                        ]
                        
                        submenu_items = None
                        for sub_sel in submenu_selectors:
                            submenu_items = item.css(sub_sel)
                            if submenu_items and len(submenu_items) > 0:
                                break
                        
                        if submenu_items and len(submenu_items) > 0:
                            # Has subcategories - add each as separate entry
                            for sub_link in submenu_items:
                                try:
                                    sub_href = sub_link.css('::attr(href)').get()
                                    sub_text = sub_link.css('::text').get() or ""
                                    sub_text = sub_text.strip()
                                    
                                    if not sub_href or sub_href == '#' or not sub_text:
                                        continue
                                    if any(ex in sub_text.lower() for ex in EXCLUDE_KEYWORDS):
                                        continue
                                    
                                    full_url = urljoin(base_url, sub_href)
                                    
                                    if full_url not in seen and full_url != base_url:
                                        seen.add(full_url)
                                        categories.append({
                                            "url": full_url,
                                            "title": sub_text,
                                            "mainCategory": main_text,
                                            "subCategory": sub_text
                                        })
                                except:
                                    continue
                        else:
                            # No submenu - add as main category only
                            if main_href and main_href != '#' and not main_href.startswith('javascript'):
                                full_url = urljoin(base_url, main_href)
                                if full_url not in seen and full_url != base_url:
                                    seen.add(full_url)
                                    categories.append({
                                        "url": full_url,
                                        "title": main_text,
                                        "mainCategory": main_text,
                                        "subCategory": main_text
                                    })
                    except:
                        continue
                        
                # If we found categories with this selector, stop trying others
                if len(categories) > 0:
                    break
                    
            except:
                continue
        
        # === STRATEGY 2: Fallback to flat link discovery ===
        if len(categories) == 0:
            logger.info("No hierarchical menu found, falling back to flat link discovery")
            nav_links = page.css('nav a, header a, .menu a, .navigation a, a')
            
            for link in nav_links:
                try:
                    href = link.css('::attr(href)').get()
                    if not href or href == '#' or href.startswith('javascript'):
                        continue
                    
                    text = link.css('::text').get() or ""
                    text = text.strip()
                    
                    full_url = urljoin(base_url, href)
                    
                    if not full_url.startswith(base_url):
                        continue
                    
                    if full_url in seen or full_url == base_url:
                        continue
                    
                    href_lower = href.lower()
                    text_lower = text.lower()
                    
                    if any(ex in href_lower for ex in EXCLUDE_KEYWORDS):
                        continue
                    
                    is_product_link = any(kw in href_lower or kw in text_lower for kw in PRODUCT_KEYWORDS)
                    
                    if is_product_link and len(text) > 2 and len(text) < 50:
                        seen.add(full_url)
                        categories.append({
                            "url": full_url,
                            "title": text if text else "Products",
                            "mainCategory": text if text else "Products",
                            "subCategory": text if text else "Products"
                        })
                        
                except:
                    continue
                
    except Exception as e:
        logger.warning(f"Category discovery error: {e}")
    
    logger.info(f"Discovered {len(categories)} category pages")
    return categories


def find_pagination(page, base_url):
    """Find pagination links on current page."""
    pagination_urls = []
    seen = set()
    
    try:
        selectors = ['.pagination a', '.pager a', 'a[class*="page"]', 'a[href*="page="]', 'a.next', 'a[rel="next"]']
        
        for sel in selectors:
            try:
                links = page.css(sel)
                for link in links:
                    href = link.css('::attr(href)').get()
                    if href and not href.startswith('#') and not href.startswith('javascript'):
                        full_url = urljoin(base_url, href)
                        if full_url.startswith(base_url) and full_url not in seen:
                            seen.add(full_url)
                            pagination_urls.append(full_url)
            except:
                continue
                
    except Exception as e:
        logger.warning(f"Pagination error: {e}")
    
    return pagination_urls[:10]  # Limit to 10 pages


def scrape_url(url):
    """Main scraping function."""
    try:
        logger.info(f"Starting extraction for {url}")
        
        fetcher = DynamicFetcher(headless=True)
        page = fetcher.fetch(url)
        
        base_url = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        
        # Brand Info
        title = page.css('title::text').get() or "Unknown Brand"
        brand_name = title.split('|')[0].split('-')[0].strip()
        
        # Logo
        logo = ""
        logo_selectors = [
            'header img[src*="logo"]::attr(src)',
            '.logo img::attr(src)',
            '[class*="logo"] img::attr(src)',
            'header img::attr(src)'
        ]
        for sel in logo_selectors:
            src = page.css(sel).get()
            if src:
                logo = urljoin(url, src)
                break
        
        all_products = []
        all_seen = set()
        
        # === PHASE 1: Extract from current page ===
        logger.info("Phase 1: Extracting from main page...")
        products, seen = extract_products_from_page(page, base_url, brand_name, 'Homepage', 'Homepage')
        all_products.extend(products)
        all_seen.update(seen)
        logger.info(f"Found {len(products)} products on main page")
        
        # === PHASE 2: Discover and crawl category pages ===
        categories = discover_category_pages(page, base_url)
        logger.info(f"Phase 2: Discovered {len(categories)} category pages")
        
        # Also try common product page URLs if no categories found
        if len(categories) == 0:
            common_paths = ['/products/', '/product/', '/shop/', '/collection/', '/collections/', '/catalogue/']
            for path in common_paths:
                try:
                    test_url = urljoin(base_url, path)
                    path_name = path.strip('/').title()
                    categories.append({
                        "url": test_url, 
                        "title": path_name,
                        "mainCategory": path_name,
                        "subCategory": path_name
                    })
                except:
                    continue
        
        # Crawl discovered categories (limit to 30 for better coverage)
        for cat in categories[:30]:
            cat_url = cat['url']
            cat_title = cat.get('title', 'Products')
            main_cat = cat.get('mainCategory', cat_title)
            sub_cat = cat.get('subCategory', cat_title)
            
            # Try to extract better category hierarchy from URL
            url_main, url_sub = parse_woocommerce_category_url(cat_url)
            if url_main and url_sub:
                main_cat = url_main
                sub_cat = url_sub
            
            if cat_url in all_seen:
                continue
            all_seen.add(cat_url)
            
            try:
                logger.info(f"Crawling category: {main_cat} > {sub_cat} ({cat_url})")
                cat_page = fetcher.fetch(cat_url)
                
                # === NEW: Discover subcategories within this category page ===
                # Look for links that look like subcategories (e.g., /chairs/executive-chairs/)
                if main_cat == sub_cat:  # Only if no subcategory was detected from menu
                    try:
                        subcats_found = []
                        # Look for product category links on this page
                        subcat_selectors = [
                            '.product-categories a',
                            '.woocommerce-loop-category a',
                            'ul.product-categories a',
                            '.widget_product_categories a',
                            '.category-list a',
                            'aside a[href*="product-category"]',
                            'a[href*="product-category"]'
                        ]
                        
                        for sel in subcat_selectors:
                            subcat_links = cat_page.css(sel)
                            if subcat_links and len(subcat_links) > 0:
                                for sub_link in subcat_links:
                                    try:
                                        sub_href = sub_link.css('::attr(href)').get()
                                        sub_text = sub_link.css('::text').get() or ""
                                        sub_text = sub_text.strip()
                                        
                                        if not sub_href or not sub_text or len(sub_text) < 2:
                                            continue
                                        if any(ex in sub_text.lower() for ex in EXCLUDE_KEYWORDS):
                                            continue
                                        
                                        full_sub_url = urljoin(base_url, sub_href)
                                        
                                        # Must be a child of current category URL
                                        if full_sub_url.startswith(cat_url) or cat_url.split('/')[-2] in full_sub_url:
                                            if full_sub_url not in all_seen and full_sub_url != cat_url:
                                                subcats_found.append({
                                                    "url": full_sub_url,
                                                    "title": sub_text,
                                                    "mainCategory": main_cat,
                                                    "subCategory": sub_text
                                                })
                                    except:
                                        continue
                                break  # Found subcategories with this selector
                        
                        if subcats_found:
                            logger.info(f"Found {len(subcats_found)} subcategories in {main_cat}")
                            # Add to categories list for later crawling
                            categories.extend(subcats_found)
                    except Exception as e:
                        logger.warning(f"Subcategory discovery error: {e}")
                
                products, seen = extract_products_from_page(cat_page, base_url, brand_name, main_cat, sub_cat)
                all_products.extend(products)
                all_seen.update(seen)
                logger.info(f"Found {len(products)} products in {sub_cat}")
                
                # Check for pagination in category
                pagination = find_pagination(cat_page, base_url)
                for pg_url in pagination[:5]:  # Limit pagination depth
                    if pg_url not in all_seen:
                        all_seen.add(pg_url)
                        try:
                            logger.info(f"Following pagination: {pg_url}")
                            pg_page = fetcher.fetch(pg_url)
                            products, seen = extract_products_from_page(pg_page, base_url, brand_name, main_cat, sub_cat)
                            all_products.extend(products)
                            all_seen.update(seen)
                            logger.info(f"Found {len(products)} products on page")
                        except Exception as e:
                            logger.warning(f"Pagination error: {e}")
                            continue
                            
            except Exception as e:
                logger.warning(f"Error crawling category {cat_url}: {e}")
                continue
        
        # === DEDUPLICATE ===
        # === DEDUPLICATE WITH CATEGORY PRIORITY ===
        # Use a dict to store the best version of each product
        unique_map = {}
        
        for p in all_products:
            key = f"{p['productUrl']}".lower() # Use URL as unique key
            
            # Check if image is valid
            if not is_valid_product_image(p.get('imageUrl', '')):
                continue
                
            is_better = False
            if key not in unique_map:
                is_better = True
            else:
                existing = unique_map[key]
                # Priority rules:
                # 1. Prefer specific subcategory over same-as-main (e.g. Chairs > Executive vs Chairs > Chairs)
                existing_is_specific = existing['mainCategory'] != existing['subCategory']
                new_is_specific = p['mainCategory'] != p['subCategory']
                
                # 2. Prefer non-generic categories over "Homepage", "Products", "General"
                generic_cats = ['homepage', 'products', 'general', 'select category']
                existing_is_generic = existing['mainCategory'].lower() in generic_cats
                new_is_generic = p['mainCategory'].lower() in generic_cats
                
                if new_is_specific and not existing_is_specific:
                    is_better = True
                elif not new_is_generic and existing_is_generic:
                    is_better = True
            
            if is_better:
                unique_map[key] = p
                
        unique_products = list(unique_map.values())
        
        logger.info(f"Total unique products: {len(unique_products)}")
        
        result = {
            "products": unique_products,
            "brandInfo": {
                "name": brand_name,
                "logo": logo
            }
        }
        
        return result
        
    except Exception as e:
        logger.error(f"Extraction error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise e
