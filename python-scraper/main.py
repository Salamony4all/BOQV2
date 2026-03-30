"""
Python Scraper Microservice for BOQ Application
Deployed on Railway as a sidecar to the main Vercel app.

Features:
- Universal WooCommerce/Generic site scraping
- Architonic brand page scraping  
- Background task processing with polling
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
import logging
import os
import asyncio
import uuid
import json
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import scrapers
from scraper import scrape_url

# Try to import Architonic scraper
try:
    from architonic_scraper import scrape_architonic
    HAS_ARCHITONIC = True
except ImportError:
    HAS_ARCHITONIC = False
    logger.warning("Architonic scraper not available")

app = FastAPI(
    title="Python Scraper Service",
    description="Railway-deployed scraper service for BOQ application",
    version="2.0.0"
)

# CORS for cross-origin requests from Vercel
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Task storage
tasks: Dict[str, Dict[str, Any]] = {}

# ===================== MODELS =====================

class ScrapeRequest(BaseModel):
    url: str
    name: Optional[str] = None
    sync: bool = False  # If True, wait for result. If False, return taskId

class TaskResponse(BaseModel):
    id: str
    status: str
    progress: int
    stage: str
    brandName: Optional[str] = None
    products: Optional[list] = None
    brandInfo: Optional[dict] = None
    productCount: Optional[int] = None
    error: Optional[str] = None

# ===================== HEALTH CHECK =====================

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "python-scraper-service",
        "timestamp": datetime.utcnow().isoformat(),
        "features": {
            "universal": True,
            "architonic": HAS_ARCHITONIC
        }
    }

# ===================== TASK MANAGEMENT =====================

@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return tasks[task_id]

@app.delete("/tasks/{task_id}")
def cancel_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    tasks[task_id]["status"] = "cancelled"
    tasks[task_id]["stage"] = "Cancelled by user"
    logger.info(f"Task {task_id} cancelled")
    return {"success": True, "message": "Task cancelled"}

# Persistent storage setup
DATA_DIR = os.getenv("DATA_DIR", "/app/data")
BRANDS_DIR = os.path.join(DATA_DIR, "brands")

# Ensure directories exist
os.makedirs(BRANDS_DIR, exist_ok=True)
logger.info(f"Persistent storage initialized at {DATA_DIR}")

def save_brand_to_storage(brand_name: str, data: dict):
    """Save completed task data to persistent storage"""
    try:
        safe_name = "".join(x for x in brand_name if x.isalnum() or x == "_").lower()
        if not safe_name:
            safe_name = "unknown_brand"
            
        filename = f"{safe_name}_{int(datetime.utcnow().timestamp())}.json"
        filepath = os.path.join(BRANDS_DIR, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            
        logger.info(f"💾 Brand saved to persistent storage: {filepath}")
        return filepath
    except Exception as e:
        logger.error(f"Failed to save brand to storage: {e}")
        return None

def load_saved_brands():
    """Load list of all saved brands"""
    try:
        if not os.path.exists(BRANDS_DIR):
            return []
            
        files = [f for f in os.listdir(BRANDS_DIR) if f.endswith('.json')]
        brands = []
        
        for filename in files:
            try:
                filepath = os.path.join(BRANDS_DIR, filename)
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    brands.append({
                        "filename": filename,
                        "name": data.get("brandInfo", {}).get("name") or data.get("brandName", "Unknown"),
                        "productCount": data.get("productCount", 0),
                        "completedAt": data.get("completedAt"),
                        "logo": data.get("brandInfo", {}).get("logo", "")
                    })
            except Exception:
                continue
                
        return brands
    except Exception as e:
        logger.error(f"Failed to load saved brands: {e}")
        return []

# ===================== PERSISTENT STORAGE ENDPOINTS =====================

@app.get("/brands")
def list_saved_brands():
    """List all saved brands from persistent storage"""
    brands = load_saved_brands()
    return {
        "success": True,
        "count": len(brands),
        "brands": brands
    }

@app.get("/brands/{filename}")
def get_saved_brand(filename: str):
    """Get content of a specific saved brand file"""
    try:
        filepath = os.path.join(BRANDS_DIR, filename)
        if not os.path.exists(filepath):
            raise HTTPException(status_code=404, detail="Brand file not found")
            
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/brands/{filename}")
def delete_saved_brand(filename: str):
    """Delete a saved brand file"""
    try:
        filepath = os.path.join(BRANDS_DIR, filename)
        if os.path.exists(filepath):
            os.remove(filepath)
            return {"success": True, "message": "Brand deleted"}
        raise HTTPException(status_code=404, detail="Brand file not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ===================== SCRAPING ENDPOINTS =====================

def run_scrape_task(task_id: str, url: str, name: Optional[str], scraper_type: str = "universal"):
    """Background task to run scraping"""
    try:
        tasks[task_id]["status"] = "processing"
        tasks[task_id]["progress"] = 20
        tasks[task_id]["stage"] = f"Running {scraper_type} scraper..."
        
        # Check for cancellation
        if tasks[task_id]["status"] == "cancelled":
            return
        
        # Run appropriate scraper
        if scraper_type == "architonic" and HAS_ARCHITONIC:
            result = scrape_architonic(url)
        else:
            result = scrape_url(url)
        
        # Check for cancellation again
        if tasks[task_id]["status"] == "cancelled":
            return
        
        products = result.get("products", [])
        brand_info = result.get("brandInfo", {"name": name or "Unknown", "logo": ""})
        
        completed_data = {
            "id": task_id,
            "status": "completed",
            "progress": 100,
            "stage": "Complete!",
            "products": products,
            "brandInfo": brand_info,
            "productCount": len(products),
            "completedAt": datetime.utcnow().isoformat(),
            "sourceUrl": url
        }
        
        # Update in-memory task
        tasks[task_id].update(completed_data)
        
        # PERSIST: Save to disk
        brand_name_to_save = brand_info.get("name") or name or "Unknown"
        save_brand_to_storage(brand_name_to_save, completed_data)
        
        logger.info(f"Task {task_id} completed: {len(products)} products (SAVED TO DISK)")
        
    except Exception as e:
        logger.error(f"Task {task_id} failed: {e}")
        tasks[task_id].update({
            "status": "failed",
            "error": str(e),
            "failedAt": datetime.utcnow().isoformat()
        })

@app.post("/scrape")
async def scrape_endpoint(req: ScrapeRequest, background_tasks: BackgroundTasks):
    """Universal scraping endpoint"""
    logger.info(f"Received scrape request for: {req.url}")
    
    # Detect if Architonic
    is_architonic = "architonic.com" in req.url.lower()
    scraper_type = "architonic" if is_architonic and HAS_ARCHITONIC else "universal"
    
    # Sync mode - wait for result
    if req.sync:
        try:
            loop = asyncio.get_event_loop()
            if scraper_type == "architonic":
                data = await loop.run_in_executor(None, scrape_architonic, req.url)
            else:
                data = await loop.run_in_executor(None, scrape_url, req.url)
            return {
                "success": True,
                "products": data.get("products", []),
                "brandInfo": data.get("brandInfo", {}),
                "productCount": len(data.get("products", []))
            }
        except Exception as e:
            logger.error(f"Sync scrape failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    # Async mode - create task and return immediately
    task_id = f"py_{scraper_type}_{uuid.uuid4().hex[:8]}"
    tasks[task_id] = {
        "id": task_id,
        "status": "processing",
        "progress": 10,
        "stage": f"Initializing {scraper_type} scraper...",
        "brandName": req.name or "Detecting...",
        "startedAt": datetime.utcnow().isoformat()
    }
    
    # Run in background
    background_tasks.add_task(run_scrape_task, task_id, req.url, req.name, scraper_type)
    
    return {
        "success": True,
        "message": f"{scraper_type.title()} scraping started",
        "taskId": task_id
    }

@app.post("/scrape-architonic")
async def scrape_architonic_endpoint(req: ScrapeRequest, background_tasks: BackgroundTasks):
    """Architonic-specific scraping endpoint"""
    if not HAS_ARCHITONIC:
        raise HTTPException(
            status_code=501, 
            detail="Architonic scraper not available. Use /scrape instead."
        )
    
    if "architonic.com" not in req.url.lower():
        raise HTTPException(status_code=400, detail="URL must be from architonic.com")
    
    logger.info(f"Received Architonic scrape request for: {req.url}")
    
    # Sync mode
    if req.sync:
        try:
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(None, scrape_architonic, req.url)
            return {
                "success": True,
                "products": data.get("products", []),
                "brandInfo": data.get("brandInfo", {}),
                "productCount": len(data.get("products", []))
            }
        except Exception as e:
            logger.error(f"Architonic scrape failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    # Async mode
    task_id = f"py_architonic_{uuid.uuid4().hex[:8]}"
    tasks[task_id] = {
        "id": task_id,
        "status": "processing",
        "progress": 10,
        "stage": "Initializing Architonic crawler...",
        "brandName": req.name or "Detecting...",
        "startedAt": datetime.utcnow().isoformat()
    }
    
    background_tasks.add_task(run_scrape_task, task_id, req.url, req.name, "architonic")
    
    return {
        "success": True,
        "message": "Architonic scraping started",
        "taskId": task_id
    }

# ===================== STARTUP =====================

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    logger.info(f"Starting Python Scraper Service on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
