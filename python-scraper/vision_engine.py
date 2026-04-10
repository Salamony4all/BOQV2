
import os
import json
import logging
from typing import List, Dict, Any
import cv2
import numpy as np
from PIL import Image
import io
import base64
import re

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try to import required libraries
try:
    import pytesseract
    HAS_TESSERACT = True
    logger.info("✅ Tesseract OCR available")
except ImportError:
    try:
        import easyocr
        HAS_EASYOCR = True
        logger.info("✅ EasyOCR available")
    except ImportError:
        HAS_TESSERACT = False
        HAS_EASYOCR = False
        logger.warning("⚠️ No OCR library available. Install pytesseract or easyocr.")

try:
    import layoutparser as lp
    HAS_LAYOUTPARSER = True
    logger.info("✅ LayoutParser available")
except ImportError:
    HAS_LAYOUTPARSER = False
    logger.warning("⚠️ LayoutParser not available. Install with: pip install layoutparser")

# Try to import ollama
try:
    import ollama
    HAS_OLLAMA = True
except ImportError:
    HAS_OLLAMA = False
    logger.warning("Ollama not installed. JSON generation will be mocked.")

class VisionEngine:
    def __init__(self):
        """
        Initialize the Vision Engine with practical computer vision stack:
        - OpenCV for image processing and contour detection
        - OCR (Tesseract/EasyOCR) for text extraction
        - LayoutParser for document layout analysis
        - Llama 3.2 for BOQ structuring
        """
        logger.info("🚀 Initializing Vision Engine with practical CV stack")

        # Initialize OCR
        if HAS_TESSERACT:
            try:
                # Configure Tesseract path if needed (Windows)
                pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
            except:
                pass
        elif HAS_EASYOCR:
            self.reader = easyocr.Reader(['en'])

        # Initialize LayoutParser if available
        if HAS_LAYOUTPARSER:
            try:
                # Use PubLayNet model for document layout
                self.layout_model = lp.Detectron2LayoutModel(
                    config_path='lp://PubLayNet/mask_rcnn_X_101_32x8d_FPN_3x/config',
                    label_map={1: "Text", 2: "Title", 3: "List", 4: "Table", 5: "Figure"},
                    extra_config=["MODEL.ROI_HEADS.SCORE_THRESH_TEST", 0.5]
                )
            except:
                logger.warning("Could not load LayoutParser model")
                self.layout_model = None
        else:
            self.layout_model = None

        logger.info("✅ Vision Engine initialized with practical stack")

    def process_floorplan(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Process a floor plan image using practical computer vision stack:
        1. Image preprocessing and enhancement
        2. OCR for text extraction (dimensions, labels, room names)
        3. Contour detection for layout elements (walls, doors, windows)
        4. Layout analysis for document structure
        5. Architectural element extraction
        6. BOQ structuring with Llama 3.2
        """
        try:
            # Validate image bytes
            if not image_bytes:
                raise ValueError("Image bytes are empty")
            
            if len(image_bytes) < 100:
                raise ValueError(f"Image data too small ({len(image_bytes)} bytes)")

            # Convert bytes to PIL Image, then to OpenCV format
            # Create BytesIO stream and seek to beginning for safety
            image_stream = io.BytesIO(image_bytes)
            image_stream.seek(0)
            
            try:
                pil_image = Image.open(image_stream)
                pil_image.load()  # Force load to detect issues early
            except Exception as pil_err:
                raise ValueError(f"Failed to open image with PIL: {str(pil_err)}. Image data may be corrupted or unsupported format.")
            
            if pil_image.mode != 'RGB':
                pil_image = pil_image.convert('RGB')

            # Convert to numpy array for OpenCV
            img = np.array(pil_image)
            if img is None or img.size == 0:
                raise ValueError("Image array is empty after conversion")
            
            img_rgb = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

            logger.info(f"📸 Processing floor plan image (size: {img_rgb.shape})...")

            # Step 1: Image preprocessing
            processed_img, gray_img = self._preprocess_image(img_rgb)

            # Step 2: OCR text extraction
            ocr_results = self._extract_text(processed_img)

            # Step 3: Contour detection for architectural elements
            contours_data = self._detect_contours(gray_img)

            # Step 4: Layout analysis (if available)
            layout_data = self._analyze_layout(processed_img) if HAS_LAYOUTPARSER and self.layout_model else []

            # Step 5: Extract architectural elements
            elements = self._extract_architectural_elements(ocr_results, contours_data, layout_data)

            # Step 6: Generate BOQ with Llama 3.2
            boq_data = self._generate_boq_with_llama(elements)

            return {
                "detections": elements,
                "ocr_text": ocr_results,
                "contours": contours_data,
                "layout": layout_data,
                "boq": boq_data,
                "status": "success"
            }

        except Exception as e:
            logger.error(f"❌ Floor plan processing failed: {e}")
            return {"error": f"Processing failed: {str(e)}"}

    def _preprocess_image(self, img):
        """Enhance image for better OCR and contour detection"""
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Noise reduction
        gray = cv2.medianBlur(gray, 3)

        # Contrast enhancement
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        enhanced = clahe.apply(gray)

        # Morphological operations to clean up
        kernel = np.ones((2,2), np.uint8)
        cleaned = cv2.morphologyEx(enhanced, cv2.MORPH_CLOSE, kernel)

        return img, cleaned

    def _extract_text(self, img):
        """Extract text using OCR"""
        results = []

        if HAS_TESSERACT:
            try:
                # Get detailed OCR data
                data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

                for i, text in enumerate(data['text']):
                    if text.strip():  # Only non-empty text
                        results.append({
                            "text": text.strip(),
                            "confidence": float(data['conf'][i]),
                            "bbox": [
                                data['left'][i],
                                data['top'][i],
                                data['width'][i],
                                data['height'][i]
                            ]
                        })
            except Exception as e:
                logger.warning(f"Tesseract OCR failed: {e}")

        elif HAS_EASYOCR:
            try:
                ocr_results = self.reader.readtext(img)
                for (bbox, text, confidence) in ocr_results:
                    results.append({
                        "text": text,
                        "confidence": float(confidence),
                        "bbox": bbox
                    })
            except Exception as e:
                logger.warning(f"EasyOCR failed: {e}")

        logger.info(f"📝 Extracted {len(results)} text elements via OCR")
        return results

    def _detect_contours(self, gray_img):
        """Detect contours for architectural elements"""
        contours_data = []

        # Edge detection
        edges = cv2.Canny(gray_img, 50, 150)

        # Find contours
        contours, hierarchy = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for i, contour in enumerate(contours):
            # Filter small contours
            area = cv2.contourArea(contour)
            if area < 100:  # Skip very small contours
                continue

            # Get bounding rectangle
            x, y, w, h = cv2.boundingRect(contour)

            # Calculate shape properties
            perimeter = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.04 * perimeter, True)
            sides = len(approx)

            # Classify contour type based on shape
            contour_type = self._classify_contour(contour, sides, w, h, area)

            contours_data.append({
                "id": i,
                "type": contour_type,
                "bbox": [x, y, w, h],
                "area": area,
                "perimeter": perimeter,
                "sides": sides
            })

        logger.info(f"🔍 Detected {len(contours_data)} architectural contours")
        return contours_data

    def _classify_contour(self, contour, sides, w, h, area):
        """Classify contour based on shape properties"""
        aspect_ratio = float(w) / h if h > 0 else 0

        # Rectangle-like shapes (doors, windows, furniture)
        if sides >= 4 and 0.3 < aspect_ratio < 3.0:
            if 500 < area < 50000:  # Reasonable size
                if aspect_ratio > 1.5:  # Wider than tall
                    return "window"
                elif aspect_ratio < 0.7:  # Taller than wide
                    return "door"
                else:
                    return "furniture"

        # Line-like shapes (walls)
        elif sides <= 3 and (aspect_ratio > 5 or aspect_ratio < 0.2):
            return "wall"

        # Circular shapes (electrical, plumbing)
        elif sides > 8:
            return "fixture"

        return "unknown"

    def _analyze_layout(self, img):
        """Analyze document layout using LayoutParser"""
        layout_data = []

        try:
            # Convert to RGB for LayoutParser
            rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

            # Detect layout elements
            layout_result = self.layout_model.detect(rgb_img)

            for block in layout_result:
                layout_data.append({
                    "type": block.type,
                    "bbox": block.coordinates,
                    "score": block.score
                })

        except Exception as e:
            logger.warning(f"Layout analysis failed: {e}")

        return layout_data

    def _extract_architectural_elements(self, ocr_results, contours_data, layout_data):
        """Extract meaningful architectural elements from detected features"""
        elements = []

        # Process OCR results for labeled elements
        for ocr_item in ocr_results:
            text = ocr_item["text"].upper()

            # Look for room names
            if any(keyword in text for keyword in ["OFFICE", "ROOM", "AREA", "LOUNGE", "KITCHEN", "BATHROOM"]):
                elements.append({
                    "type": "room",
                    "label": text,
                    "source": "ocr",
                    "bbox": ocr_item["bbox"],
                    "confidence": ocr_item["confidence"]
                })

            # Look for dimensions (e.g., "2.4m", "8'", "1200mm")
            elif re.match(r'\d+(\.\d+)?\s*(m|mm|cm|ft|in|\'|")', text):
                elements.append({
                    "type": "dimension",
                    "label": text,
                    "source": "ocr",
                    "bbox": ocr_item["bbox"],
                    "confidence": ocr_item["confidence"]
                })

            # Look for furniture labels
            elif any(keyword in text for keyword in ["CHAIR", "TABLE", "DESK", "SOFA", "BED", "CABINET"]):
                elements.append({
                    "type": "furniture",
                    "label": text,
                    "source": "ocr",
                    "bbox": ocr_item["bbox"],
                    "confidence": ocr_item["confidence"]
                })

        # Process contours for geometric elements
        for contour in contours_data:
            if contour["type"] != "unknown":
                elements.append({
                    "type": contour["type"],
                    "label": f"{contour['type'].title()} #{contour['id']}",
                    "source": "contour",
                    "bbox": contour["bbox"],
                    "properties": {
                        "area": contour["area"],
                        "sides": contour["sides"]
                    }
                })

        logger.info(f"🏗️ Extracted {len(elements)} architectural elements")
        return elements

    def _generate_boq_with_llama(self, elements: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Generate structured BOQ JSON from extracted architectural elements using Llama 3.2.
        """
        if not elements:
            return {"items": [], "planSummary": "No architectural elements detected."}

        # Group elements by type for better prompting
        element_summary = {}
        for elem in elements:
            elem_type = elem.get("type", "unknown")
            element_summary[elem_type] = element_summary.get(elem_type, 0) + 1

        # Create a descriptive summary for the LLM
        summary_parts = []
        for elem_type, count in element_summary.items():
            if elem_type == "room":
                summary_parts.append(f"{count} labeled rooms/areas")
            elif elem_type == "dimension":
                summary_parts.append(f"{count} dimension labels")
            elif elem_type == "furniture":
                summary_parts.append(f"{count} furniture items")
            elif elem_type in ["door", "window", "wall", "fixture"]:
                summary_parts.append(f"{count} {elem_type}s")
            else:
                summary_parts.append(f"{count} {elem_type} elements")

        summary_text = ", ".join(summary_parts)

        # Extract OCR text for additional context
        ocr_texts = [elem["label"] for elem in elements if elem.get("source") == "ocr"]
        ocr_context = " ".join(ocr_texts[:20])  # Limit to first 20 OCR texts

        system_prompt = """
        You are an Elite Senior Quantity Surveyor (SQS) specializing in architectural floor plan analysis.
        Your task is to convert detected architectural elements and OCR text into a professional BOQ JSON.

        ### ANALYSIS RULES:
        1. **Interpret OCR text**: Use room names, dimensions, and labels to understand the space
        2. **Estimate quantities**: Based on detected elements and architectural standards
        3. **Classify scope**: Furniture vs Fitout (architectural elements)
        4. **Use realistic quantities**: Don't just count detections - estimate based on room size and function
        5. **Include dimensions**: Use detected dimensions or standard architectural sizes

        ### SCOPE CLASSIFICATION:
        - **Furniture**: Desks, chairs, sofas, tables, storage units
        - **Fitout**: Walls, doors, windows, flooring, ceilings, partitions, MEP fixtures

        ### OUTPUT FORMAT:
        {
          "items": [
            {
              "location": "Room name or area",
              "scope": "Furniture" | "Fitout",
              "code": "Descriptive code",
              "description": "Item description with specs",
              "qty": number,
              "unit": "Nos" | "Sqm" | "LnM" | "Each"
            }
          ],
          "planSummary": "Brief analysis of the floor plan and extraction results."
        }
        """

        user_prompt = f"""
        Analyze this floor plan with the following detected elements:
        - Summary: {summary_text}
        - OCR Context: {ocr_context}

        Generate a comprehensive BOQ based on architectural standards and the detected elements.
        """

        if HAS_OLLAMA:
            try:
                logger.info("🦙 Calling local Llama 3.2 for BOQ generation...")
                response = ollama.chat(model='llama3.2', messages=[
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt},
                ])

                content = response['message']['content']
                # Extract JSON from potential markdown markers
                if "```json" in content:
                    content = content.split("```json")[1].split("```")[0]
                elif "```" in content:
                    content = content.split("```")[1].split("```")[0]

                return json.loads(content.strip())
            except Exception as e:
                logger.error(f"Llama 3.2 inference failed: {e}")
                return self._fallback_boq_generation(elements, element_summary)
        else:
            return self._fallback_boq_generation(elements, element_summary)

    def _fallback_boq_generation(self, elements, element_summary):
        """Fallback BOQ generation when LLM is not available"""
        items = []

        # Generate basic BOQ from element counts
        for elem_type, count in element_summary.items():
            if elem_type == "room":
                # Estimate furniture based on rooms
                items.extend([
                    {
                        "location": "Office Areas",
                        "scope": "Furniture",
                        "code": "FRN-001",
                        "description": "Executive Desk with Return",
                        "qty": max(1, count // 2),
                        "unit": "Nos"
                    },
                    {
                        "location": "Office Areas",
                        "scope": "Furniture",
                        "code": "FRN-002",
                        "description": "Ergonomic Office Chair",
                        "qty": max(2, count),
                        "unit": "Nos"
                    }
                ])
            elif elem_type == "door":
                items.append({
                    "location": "General",
                    "scope": "Fitout",
                    "code": "FIT-001",
                    "description": "Interior Door with Frame",
                    "qty": count,
                    "unit": "Nos"
                })
            elif elem_type == "window":
                items.append({
                    "location": "General",
                    "scope": "Fitout",
                    "code": "FIT-002",
                    "description": "Aluminum Window with Glazing",
                    "qty": count,
                    "unit": "Nos"
                })

        return {
            "items": items,
            "planSummary": f"Basic BOQ generated from {len(elements)} detected elements using fallback method."
        }

# Global instance
vision_engine = VisionEngine()
