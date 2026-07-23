import fitz  # PyMuPDF
import json
import sys
import os
import traceback

def merge_contiguous_rects(raw_items, tolerance=5, x_tolerance=3, y_tolerance=3):
    # Each item in raw_items is {"rect": fitz.Rect, "xref": int}
    items = [{"rect": item["rect"], "xrefs": [item["xref"]]} for item in raw_items]
    
    merged = True
    while merged:
        merged = False
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                r1 = items[i]["rect"]
                r2 = items[j]["rect"]
                
                # Bounding box dimensions
                w1, h1 = r1.x1 - r1.x0, r1.y1 - r1.y0
                w2, h2 = r2.x1 - r2.x0, r2.y1 - r2.y0
                
                both_large = (w1 >= 30 and h1 >= 30) and (w2 >= 30 and h2 >= 30)
                
                if both_large:
                    # Only merge large rectangles if they overlap significantly
                    intersect = r1 & r2
                    if intersect:
                        area_int = intersect.width * intersect.height
                        area1 = w1 * h1
                        area2 = w2 * h2
                        if area_int > 0.5 * min(area1, area2):
                            items[i]["rect"] = r1 | r2
                            items[i]["xrefs"].extend(items[j]["xrefs"])
                            items.pop(j)
                            merged = True
                            break
                    continue
                
                # Slices (at least one is small/line): only merge if they are similar in width (x) and contiguous (y)
                # This prevents domino-merging between vertically separated elements!
                x0_similar = abs(r1.x0 - r2.x0) <= x_tolerance
                x1_similar = abs(r1.x1 - r2.x1) <= x_tolerance
                y_contiguous = (
                    abs(r1.y1 - r2.y0) <= y_tolerance or 
                    abs(r2.y1 - r1.y0) <= y_tolerance or
                    r1.intersects(r2)
                )
                
                if x0_similar and x1_similar and y_contiguous:
                    items[i]["rect"] = r1 | r2
                    items[i]["xrefs"].extend(items[j]["xrefs"])
                    items.pop(j)
                    merged = True
                    break
            if merged:
                break
    return items

def extract_pdf_data(pdf_path, output_dir, target_pages=None):
    try:
        doc = fitz.open(pdf_path)
        os.makedirs(output_dir, exist_ok=True)
        
        results = []
        extracted_xrefs = {}
        
        if target_pages:
            pages_list = [int(p) - 1 for p in target_pages if 0 < int(p) <= len(doc)]
        else:
            pages_list = list(range(len(doc)))
            
        for p_idx in pages_list:
            page = doc[p_idx]
            page_num = p_idx + 1
            
            # 1. Get Text Items with coordinates (Always needed for alignment)
            text_items = []
            words = page.get_text("words") 
            for w in words:
                text_items.append({
                    "str": w[4],
                    "x": round(w[0] * 2),
                    "y": round(w[1] * 2),
                    "w": round((w[2] - w[0]) * 2),
                    "h": round((w[3] - w[1]) * 2)
                })
            
            # 2. Extract Native (Selectable) Images
            extracted_images = []
            
            try:
                page_dict = page.get_text("dict")
                blocks = page_dict.get("blocks", [])
                img_blocks = [b for b in blocks if b.get("type") == 1]
                
                for idx, block in enumerate(img_blocks):
                    bbox = block["bbox"]
                    x0, y0, x1, y1 = bbox
                    cw = x1 - x0
                    ch = y1 - y0
                    
                    if cw < 20 or ch < 20:
                        continue
                        
                    image_bytes = block.get("image")
                    ext = block.get("ext", "png")
                    
                    if not image_bytes:
                        continue
                        
                    # Hash first 200 bytes of the image to cache duplicate logos
                    img_hash = hash(image_bytes[:200])
                    
                    if img_hash in extracted_xrefs:
                        img_filename = extracted_xrefs[img_hash]
                    else:
                        img_filename = f"native_{abs(img_hash)}.{ext}"
                        img_path = os.path.join(output_dir, img_filename)
                        if not os.path.exists(img_path):
                            with open(img_path, "wb") as fh:
                                fh.write(image_bytes)
                        extracted_xrefs[img_hash] = img_filename
                        
                    extracted_images.append({
                        "x": round(x0 * 2), 
                        "y": round(y0 * 2),
                        "w": round(cw * 2),
                        "h": round(ch * 2),
                        "path": img_filename,
                        "is_native": True,
                        "xref": 99000 + idx
                    })
            except Exception as dict_err:
                print(f"DEBUG: Dict image extraction failed on page {page_num}: {dict_err}", file=sys.stderr)
            
            # CRITICAL: Sort images top-to-bottom by Y coordinate.
            extracted_images.sort(key=lambda img: (img["y"], img["x"]))

            # 3. ONLY render full page IF explicitly requested (placeholder for future)
            # For now, we omit it to avoid the "full page scan" triggering nodemon
            full_page_img = None
            
            results.append({
                "page": page_num,
                "textItems": text_items,
                "nativeImages": extracted_images,
                "fullPageImage": full_page_img,
                "viewport": {
                    "width": round(page.rect.width * 2),
                    "height": round(page.rect.height * 2)
                }
            })
            
        out_file = os.path.join(output_dir, "layout.json")
        with open(out_file, "w", encoding="utf-8") as fh:
            json.dump({"success": True, "data": results}, fh, ensure_ascii=False)
        print(json.dumps({"success": True, "outputFile": "layout.json"}))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "trace": traceback.format_exc()}))

# New function to render a SINGLE page full scan for Sharp fallback
def render_full_page(pdf_path, page_num, output_path):
    try:
        doc = fitz.open(pdf_path)
        if page_num > len(doc): raise Exception("Page out of range")
        page = doc[page_num - 1]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        pix.save(output_path)
        print(json.dumps({"success": True, "path": output_path}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Insufficient arguments"}))
    elif sys.argv[1] == "--render-page":
        # Usage: python pdf_navigator.py --render-page <pdf> <page_num> <output_path>
        render_full_page(sys.argv[2], int(sys.argv[3]), sys.argv[4])
    else:
        # Usage: python pdf_navigator.py <pdf> <output_dir> [--pages p1,p2,...]
        target_pages = None
        if "--pages" in sys.argv:
            try:
                p_idx = sys.argv.index("--pages")
                if p_idx + 1 < len(sys.argv):
                    target_pages = sys.argv[p_idx + 1].split(",")
            except Exception:
                pass
        extract_pdf_data(sys.argv[1], sys.argv[2], target_pages)
