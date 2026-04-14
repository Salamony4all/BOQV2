import fitz  # PyMuPDF
import json
import sys
import os
import traceback

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
            image_list = page.get_images(full=True)
            print(f"DEBUG: Found {len(image_list)} image references on page {page_num}", file=sys.stderr)
            
            for img_info in image_list:
                xref = img_info[0]
                rects = page.get_image_rects(xref)
                
                for rect in rects:
                    cw = rect.x1 - rect.x0
                    ch = rect.y1 - rect.y0
                    
                    if cw < 20 or ch < 20: continue
                    
                    try:
                        base_image = doc.extract_image(xref)
                        image_bytes = base_image["image"]
                        ext = base_image["ext"]
                        
                        img_filename = f"page_{page_num}_native_{xref}_{round(rect.x0)}.{ext}"
                        img_path = os.path.join(output_dir, img_filename)
                        
                        if not os.path.exists(img_path):
                            with open(img_path, "wb") as f:
                                f.write(image_bytes)
                        
                        extracted_images.append({
                            "x": round(rect.x0 * 2), 
                            "y": round(rect.y0 * 2),
                            "w": round(cw * 2),
                            "h": round(ch * 2),
                            "path": img_filename,
                            "is_native": True,
                            "xref": xref
                        })
                    except: continue
            
            # CRITICAL: Sort images top-to-bottom by Y coordinate.
            # PyMuPDF returns images in internal xref order (not visual order).
            # Sorting ensures image[0] = topmost row image, image[1] = second row, etc.
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
