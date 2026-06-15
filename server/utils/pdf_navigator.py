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

def extract_pdf_data(pdf_path, output_dir, mode="native"):
    """
    mode: 'native' (default) - extracts selectable assets only
          'full' - renders specific page full scan (used for fallback)
    """
    try:
        doc = fitz.open(pdf_path)
        os.makedirs(output_dir, exist_ok=True)
        
        results = []
        
        # If we are in 'full' mode, we might only be rendering ONE page
        # but the current CLI args don't support it yet. 
        # I'll keep it simple: 'native' mode extracts assets + text.
        
        total_pages = min(len(doc), 40)
        
        for p_idx in range(total_pages):
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
            
            raw_items = []
            image_list = page.get_images(full=True)
            for img_info in image_list:
                xref = img_info[0]
                img_rects = page.get_image_rects(xref)
                if img_rects:
                    for r in img_rects:
                        if (r.x1 - r.x0) >= 2 and (r.y1 - r.y0) >= 2:
                            raw_items.append({
                                "rect": r,
                                "xref": xref
                            })
                            
            # Merge contiguous image slices (e.g. split CAD drawing strips)
            merged_items = merge_contiguous_rects(raw_items)
            
            # Filter final bounding boxes to keep only size-appropriate items
            final_items = [item for item in merged_items if (item["rect"].x1 - item["rect"].x0) >= 20 and (item["rect"].y1 - item["rect"].y0) >= 20]
            print(f"DEBUG: Found {len(image_list)} raw image refs, merged into {len(final_items)} final rects on page {page_num}", file=sys.stderr)
            
            for idx, item in enumerate(final_items):
                rect = item["rect"]
                xrefs = item["xrefs"]
                cw = rect.x1 - rect.x0
                ch = rect.y1 - rect.y0
                
                extracted_any = False
                for xref in xrefs:
                    try:
                        base_image = doc.extract_image(xref)
                        if base_image:
                            image_bytes = base_image["image"]
                            ext = base_image["ext"]
                            img_filename = f"page_{page_num}_native_{idx}_{xref}_{round(rect.x0)}.{ext}"
                            img_path = os.path.join(output_dir, img_filename)
                            with open(img_path, "wb") as fh:
                                fh.write(image_bytes)
                            
                            extracted_images.append({
                                "x": round(rect.x0 * 2), 
                                "y": round(rect.y0 * 2),
                                "w": round(cw * 2),
                                "h": round(ch * 2),
                                "path": img_filename,
                                "is_native": True,
                                "xref": xref
                            })
                            extracted_any = True
                    except Exception as native_err:
                        print(f"DEBUG: Native extract failed for xref {xref} on page {page_num}: {native_err}", file=sys.stderr)
                
                # Fallback: if native extraction failed or extracted no images, crop from page layout
                if not extracted_any:
                    try:
                        pix = page.get_pixmap(clip=rect, matrix=fitz.Matrix(2, 2))
                        img_filename = f"page_{page_num}_native_{idx}_{round(rect.x0)}.jpg"
                        img_path = os.path.join(output_dir, img_filename)
                        pix.save(img_path)
                        extracted_images.append({
                            "x": round(rect.x0 * 2), 
                            "y": round(rect.y0 * 2),
                            "w": round(cw * 2),
                            "h": round(ch * 2),
                            "path": img_filename,
                            "is_native": True,
                            "xref": 99000 + idx
                        })
                    except Exception as crop_err:
                        print(f"DEBUG: Crop failed for merged item {idx} on page {page_num}: {crop_err}", file=sys.stderr)
            
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
            
        print(json.dumps({"success": True, "data": results}))
        
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
        # Usage: python pdf_navigator.py <pdf> <output_dir>
        extract_pdf_data(sys.argv[1], sys.argv[2])
