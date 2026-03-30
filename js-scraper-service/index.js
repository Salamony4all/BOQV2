/**
 * JS Scraper Microservice for Railway
 * 
 * This standalone service hosts all the JavaScript scrapers:
 * - ScraperService (Universal + Architonic)
 * - StructureScraper (Hierarchical Category Harvester)
 * 
 * Designed to be called from the main Vercel app as a sidecar.
 * 
 * PERSISTENT STORAGE: Completed scrapes are saved to /data volume
 * so they survive restarts and can be retrieved later.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ScraperService from './scraper.js';
import StructureScraper from './structureScraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

// Persistent storage directory (Railway volume mount point)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const BRANDS_DIR = path.join(DATA_DIR, 'brands');

// Initialize scrapers
const scraperService = new ScraperService();
const structureScraper = new StructureScraper();

// Middleware
app.use(cors());
app.use(express.json());

// Task tracking for async operations (in-memory, for progress tracking)
const tasks = new Map();

// ===================== PERSISTENT STORAGE =====================

// Ensure data directories exist on startup
async function initStorage() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(BRANDS_DIR, { recursive: true });
        console.log(`📁 Persistent storage initialized at ${DATA_DIR}`);
    } catch (e) {
        console.error('Failed to initialize storage:', e.message);
    }
}

// Save a completed brand to persistent storage
async function saveBrandToStorage(brandName, brandData) {
    try {
        const safeName = brandName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const filename = `${safeName}_${Date.now()}.json`;
        const filepath = path.join(BRANDS_DIR, filename);

        await fs.writeFile(filepath, JSON.stringify(brandData, null, 2));
        console.log(`💾 Brand saved to persistent storage: ${filepath}`);
        return filepath;
    } catch (e) {
        console.error('Failed to save brand:', e.message);
        return null;
    }
}

// Load all saved brands from storage
async function loadSavedBrands() {
    try {
        const files = await fs.readdir(BRANDS_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        const brands = await Promise.all(jsonFiles.map(async (filename) => {
            try {
                const filepath = path.join(BRANDS_DIR, filename);
                const content = await fs.readFile(filepath, 'utf-8');
                const data = JSON.parse(content);
                return { filename, ...data };
            } catch (e) {
                console.warn(`Failed to parse ${filename}:`, e.message);
                return null;
            }
        }));

        return brands.filter(b => b !== null);
    } catch (e) {
        console.error('Failed to load brands:', e.message);
        return [];
    }
}

// Initialize storage on module load
initStorage();

// ===================== HEALTH CHECK =====================
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'js-scraper-service',
        timestamp: new Date().toISOString(),
        scrapers: ['universal', 'architonic', 'structure'],
        storageDir: DATA_DIR
    });
});

// ===================== SAVED BRANDS ENDPOINTS =====================
// List all saved brands (for recovery after UI disconnect)
app.get('/brands', async (req, res) => {
    try {
        const brands = await loadSavedBrands();
        res.json({
            success: true,
            count: brands.length,
            brands: brands.map(b => ({
                filename: b.filename,
                name: b.brandInfo?.name || b.brandName || 'Unknown',
                productCount: b.productCount || b.products?.length || 0,
                completedAt: b.completedAt,
                logo: b.brandInfo?.logo || ''
            }))
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get a specific saved brand's full data
app.get('/brands/:filename', async (req, res) => {
    try {
        const filepath = path.join(BRANDS_DIR, req.params.filename);
        const content = await fs.readFile(filepath, 'utf-8');
        res.json(JSON.parse(content));
    } catch (e) {
        res.status(404).json({ error: 'Brand file not found' });
    }
});

// Delete a saved brand file
app.delete('/brands/:filename', async (req, res) => {
    try {
        const filepath = path.join(BRANDS_DIR, req.params.filename);
        await fs.unlink(filepath);
        res.json({ success: true, message: 'Brand deleted' });
    } catch (e) {
        res.status(404).json({ error: 'Brand file not found' });
    }
});

// ===================== TASK STATUS =====================
app.get('/tasks/:id', (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
});

// Cancel a task
app.delete('/tasks/:id', (req, res) => {
    const taskId = req.params.id;
    const task = tasks.get(taskId);
    if (task) {
        tasks.set(taskId, { ...task, status: 'cancelled', stage: 'Cancelled by user' });
        console.log(`🛑 Task ${taskId} cancelled.`);
        return res.json({ success: true, message: 'Task cancelled' });
    }
    res.status(404).json({ error: 'Task not found' });
});

// ===================== UNIVERSAL SCRAPER =====================
app.post('/scrape', async (req, res) => {
    try {
        const { url, name, sync = false } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        console.log(`\n🌐 [JS Scraper Service] Received scrape request for: ${url}`);

        // Synchronous mode - wait for result (for simple/fast scrapes)
        if (sync) {
            console.log('   Running in SYNC mode...');
            const result = await scraperService.scrapeBrand(url);
            return res.json({
                success: true,
                products: result.products || [],
                brandInfo: result.brandInfo || { name: name || 'Unknown', logo: '' },
                productCount: (result.products || []).length
            });
        }

        // Async mode - return task ID immediately
        const taskId = `js_scrape_${Date.now()}`;
        const initialStage = url.includes('architonic.com')
            ? 'Initializing Architonic crawler...'
            : 'Initializing universal scraper...';

        tasks.set(taskId, {
            id: taskId,
            status: 'processing',
            progress: 10,
            stage: initialStage,
            brandName: name || 'Detecting...',
            startedAt: new Date().toISOString()
        });

        // Run scraping in background
        (async () => {
            try {
                const progressCallback = (progress, stage, detectedName = null) => {
                    const currentTask = tasks.get(taskId);
                    if (!currentTask || currentTask.status === 'cancelled') return;
                    tasks.set(taskId, {
                        ...currentTask,
                        progress,
                        stage,
                        brandName: detectedName || currentTask.brandName
                    });
                };
                progressCallback.isCancelled = () => tasks.get(taskId)?.status === 'cancelled';

                const result = await scraperService.scrapeBrand(url, progressCallback, { 
                    storageDir: BRANDS_DIR,
                    onPartialData: async (partial) => {
                        const currentTask = tasks.get(taskId);
                        if (!currentTask || currentTask.status === 'cancelled') return;
                        
                        // Update in-memory task with partial results
                        tasks.set(taskId, {
                            ...currentTask,
                            products: partial.products,
                            productCount: partial.count,
                            brandName: partial.brand || currentTask.brandName,
                            stage: `Saving partial data (${partial.count} items)...`
                        });
                    }
                });

                const products = result.products || [];
                const brandName = name || result.brandInfo?.name || 'Unknown Brand';
                const brandLogo = result.brandInfo?.logo || '';

                // Prepare completed task data
                const completedData = {
                    id: taskId,
                    status: 'completed',
                    progress: 100,
                    stage: 'Complete!',
                    products,
                    brandInfo: { name: brandName, logo: brandLogo },
                    productCount: products.length,
                    completedAt: new Date().toISOString(),
                    sourceUrl: url
                };

                tasks.set(taskId, completedData);

                // PERSIST: Save to file even if frontend disconnects
                await saveBrandToStorage(brandName, completedData);

                console.log(`✅ Task ${taskId} completed with ${products.length} products (SAVED TO DISK)`);

            } catch (error) {
                console.error(`❌ Task ${taskId} failed:`, error.message);
                tasks.set(taskId, {
                    id: taskId,
                    status: 'failed',
                    error: error.message,
                    failedAt: new Date().toISOString()
                });
            }
        })();

        res.json({
            success: true,
            message: 'Scraping started in background',
            taskId
        });

    } catch (error) {
        console.error('Scrape endpoint error:', error);
        res.status(500).json({ error: 'Scraping failed', details: error.message });
    }
});

// ===================== STRUCTURE SCRAPER =====================
app.post('/scrape-structure', async (req, res) => {
    try {
        const { url, name, sync = false } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        console.log(`\n🏗️ [JS Scraper Service] Structure scrape request for: ${url}`);

        // Sync mode
        if (sync) {
            console.log('   Running in SYNC mode...');
            const result = await structureScraper.scrapeBrand(url, name);
            return res.json({
                success: true,
                products: result.products || [],
                brandInfo: result.brandInfo || { name: name || 'Unknown', logo: '' },
                productCount: (result.products || []).length
            });
        }

        // Async mode
        const taskId = `structure_${Date.now()}`;
        tasks.set(taskId, {
            id: taskId,
            status: 'processing',
            progress: 10,
            stage: 'Initializing structure harvester...',
            brandName: name || 'Detecting...',
            startedAt: new Date().toISOString()
        });

        // Run in background
        (async () => {
            try {
                const progressCallback = (progress, stage, detectedName = null) => {
                    const currentTask = tasks.get(taskId);
                    if (!currentTask || currentTask.status === 'cancelled') return;
                    tasks.set(taskId, {
                        ...currentTask,
                        progress,
                        stage,
                        brandName: detectedName || currentTask.brandName
                    });
                };
                progressCallback.isCancelled = () => tasks.get(taskId)?.status === 'cancelled';

                const result = await structureScraper.scrapeBrand(url, name, progressCallback);

                const products = result.products || [];
                const brandName = name || result.brandInfo?.name || 'Unknown Brand';

                // Prepare completed task data
                const completedData = {
                    id: taskId,
                    status: 'completed',
                    progress: 100,
                    stage: 'Harvest Complete!',
                    products,
                    brandInfo: result.brandInfo,
                    productCount: products.length,
                    completedAt: new Date().toISOString(),
                    sourceUrl: url
                };

                tasks.set(taskId, completedData);

                // PERSIST: Save to file even if frontend disconnects
                await saveBrandToStorage(brandName, completedData);

                console.log(`✅ Structure task ${taskId} completed with ${products.length} products (SAVED TO DISK)`);

            } catch (error) {
                console.error(`❌ Structure task ${taskId} failed:`, error.message);
                tasks.set(taskId, {
                    id: taskId,
                    status: 'failed',
                    error: error.message,
                    failedAt: new Date().toISOString()
                });
            }
        })();

        res.json({
            success: true,
            message: 'Structure scraping started in background',
            taskId
        });

    } catch (error) {
        console.error('Structure scrape endpoint error:', error);
        res.status(500).json({ error: 'Structure scraping failed', details: error.message });
    }
});

// ===================== ARCHITONIC SPECIFIC =====================
app.post('/scrape-architonic', async (req, res) => {
    try {
        const { url, name, sync = false } = req.body;

        if (!url || !url.includes('architonic.com')) {
            return res.status(400).json({ error: 'Valid Architonic URL is required' });
        }

        console.log(`\n🏛️ [JS Scraper Service] Architonic scrape request for: ${url}`);

        // Sync mode
        if (sync) {
            const result = await scraperService.scrapeArchitonic(url);
            return res.json({
                success: true,
                products: result.products || [],
                brandInfo: result.brandInfo || { name: name || 'Unknown', logo: '' },
                productCount: (result.products || []).length
            });
        }

        // Async mode
        const taskId = `architonic_${Date.now()}`;
        tasks.set(taskId, {
            id: taskId,
            status: 'processing',
            progress: 10,
            stage: 'Crawling Architonic collection...',
            brandName: name || 'Detecting...',
            startedAt: new Date().toISOString()
        });

        // Run in background
        (async () => {
            try {
                const progressCallback = (progress, stage, detectedName = null) => {
                    const currentTask = tasks.get(taskId);
                    if (!currentTask || currentTask.status === 'cancelled') return;
                    tasks.set(taskId, {
                        ...currentTask,
                        progress,
                        stage,
                        brandName: detectedName || currentTask.brandName
                    });
                };
                progressCallback.isCancelled = () => tasks.get(taskId)?.status === 'cancelled';

                const result = await scraperService.scrapeArchitonic(url, progressCallback);

                const products = result.products || [];
                const brandName = name || result.brandInfo?.name || 'Architonic Brand';

                // Prepare completed task data
                const completedData = {
                    id: taskId,
                    status: 'completed',
                    progress: 100,
                    stage: 'Architonic Harvest Complete!',
                    products,
                    brandInfo: result.brandInfo,
                    productCount: products.length,
                    completedAt: new Date().toISOString(),
                    sourceUrl: url
                };

                tasks.set(taskId, completedData);

                // PERSIST: Save to file even if frontend disconnects
                await saveBrandToStorage(brandName, completedData);

                console.log(`✅ Architonic task ${taskId} completed with ${products.length} products (SAVED TO DISK)`);

            } catch (error) {
                console.error(`❌ Architonic task ${taskId} failed:`, error.message);
                tasks.set(taskId, {
                    id: taskId,
                    status: 'failed',
                    error: error.message,
                    failedAt: new Date().toISOString()
                });
            }
        })();

        res.json({
            success: true,
            message: 'Architonic scraping started in background',
            taskId
        });

    } catch (error) {
        console.error('Architonic scrape endpoint error:', error);
        res.status(500).json({ error: 'Architonic scraping failed', details: error.message });
    }
});



// ===================== IMAGE PROXY =====================
// This endpoint allows Vercel to delegate image fetching to Railway
// because Architonic blocks Vercel's AWS IP addresses
app.get('/image-proxy', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).send('URL is required');

        // URL decoding happens automatically by Express, but handle base64 if needed
        let targetUrl = url;
        if (!targetUrl.startsWith('http')) {
            try {
                targetUrl = Buffer.from(targetUrl, 'base64').toString('utf-8');
            } catch (e) { }
        }

        if (!targetUrl.startsWith('http')) {
            return res.status(400).send('Invalid URL protocol');
        }

        console.log(`🖼️ [Image Proxy] Fetching: ${targetUrl}`);

        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.architonic.com/'
            }
        });

        res.set('Content-Type', response.headers['content-type']);
        res.set('Cache-Control', 'public, max-age=31536000');
        res.set('Access-Control-Allow-Origin', '*');
        res.send(response.data);

    } catch (error) {
        console.error(`❌ Image proxy failed for ${req.query.url}:`, error.message);
        res.status(502).send('Error fetching image');
    }
});


// ===================== VOLUME MANAGER UI =====================

// Serve a simple dashboard to manage persistent files
app.get('/dashboard', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Railway Volume Manager</title>
            <style>
                body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #1a1a1a; color: #fff; }
                h1 { border-bottom: 1px solid #333; padding-bottom: 10px; }
                .card { background: #2a2a2a; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                .file-list { list-style: none; padding: 0; }
                .file-item { display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid #333; align-items: center; }
                .file-item:last-child { border-bottom: none; }
                .btn { padding: 5px 10px; border-radius: 4px; text-decoration: none; cursor: pointer; border: none; font-size: 14px; }
                .btn-download { background: #3b82f6; color: white; }
                .btn-delete { background: #ef4444; color: white; margin-left: 10px; }
                .btn-refresh { background: #10b981; color: white; margin-bottom: 10px; display: inline-block; }
                .drop-zone { border: 2px dashed #444; padding: 40px; text-align: center; border-radius: 8px; margin-bottom: 20px; transition: 0.2s; }
                .drop-zone.hover { border-color: #3b82f6; background: #222; }
                pre { background: #111; padding: 10px; overflow: auto; max-height: 200px; font-size: 12px; }
                .timestamp { color: #888; font-size: 12px; margin-left: 10px; }
            </style>
        </head>
        <body>
            <h1>📦 persistent-storage/brands</h1>
            
            <div class="card">
                <h3>📤 Upload Recovery File</h3>
                <div class="drop-zone" id="dropZone">
                    Drag & Drop JSON files here or click to upload
                    <input type="file" id="fileInput" style="display: none" accept=".json">
                </div>
            </div>

            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center">
                    <h3>📂 Saved Files</h3>
                    <a href="#" onclick="loadFiles(); return false;" class="btn btn-refresh">🔄 Refresh</a>
                </div>
                <div id="loading">Loading...</div>
                <ul class="file-list" id="fileList"></ul>
            </div>

            <script>
                async function loadFiles() {
                    const el = document.getElementById('fileList');
                    const loading = document.getElementById('loading');
                    loading.style.display = 'block';
                    el.innerHTML = '';

                    try {
                        const res = await fetch('/brands');
                        const data = await res.json();
                        loading.style.display = 'none';

                        if (data.brands.length === 0) {
                            el.innerHTML = '<li style="padding:20px; text-align:center; color:#666">No saved brands found</li>';
                            return;
                        }

                        data.brands.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

                        data.brands.forEach(file => {
                            const li = document.createElement('li');
                            li.className = 'file-item';
                            const date = new Date(file.completedAt).toLocaleString();
                            li.innerHTML = \`
                                <div>
                                    <strong>\${file.name}</strong> 
                                    <span class="timestamp">(\${file.productCount} products)</span>
                                    <br>
                                    <small style="color:#666">\${file.filename}</small>
                                    <span class="timestamp">\${date}</span>
                                </div>
                                <div>
                                    <a href="/brands/\${file.filename}" target="_blank" class="btn btn-download">⬇️ JSON</a>
                                    <button onclick="deleteFile('\${file.filename}')" class="btn btn-delete">🗑️</button>
                                </div>
                            \`;
                            el.appendChild(li);
                        });
                    } catch (e) {
                        loading.innerText = 'Error loading files: ' + e.message;
                    }
                }

                async function deleteFile(filename) {
                    if(!confirm('Delete ' + filename + '?')) return;
                    await fetch('/brands/' + filename, { method: 'DELETE' });
                    loadFiles();
                }

                // File Upload Logic
                const dropZone = document.getElementById('dropZone');
                const fileInput = document.getElementById('fileInput');

                dropZone.onclick = () => fileInput.click();
                
                dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('hover'); };
                dropZone.ondragleave = () => dropZone.classList.remove('hover');
                
                dropZone.ondrop = (e) => {
                    e.preventDefault();
                    dropZone.classList.remove('hover');
                    handleFiles(e.dataTransfer.files);
                };

                fileInput.onchange = (e) => handleFiles(e.target.files);

                async function handleFiles(files) {
                    if(files.length === 0) return;
                    const file = files[0];
                    const text = await file.text();
                    
                    try {
                        JSON.parse(text); // Validate JSON
                        
                        const res = await fetch('/brands/upload', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-Filename': file.name },
                            body: text
                        });
                        
                        if(res.ok) {
                            alert('Uploaded successfully!');
                            loadFiles();
                        } else {
                            alert('Upload failed');
                        }
                    } catch (e) {
                        alert('Invalid JSON file');
                    }
                }

                loadFiles();
            </script>
        </body>
        </html>
    `);
});

// Upload endpoint for the dashboard
app.post('/brands/upload', express.text({ limit: '50mb' }), async (req, res) => {
    try {
        const content = req.body;
        const inputFilename = req.get('X-Filename') || `upload_${Date.now()}.json`;
        // Basic validation
        JSON.parse(content);

        const filepath = path.join(BRANDS_DIR, inputFilename);
        await fs.writeFile(filepath, content);
        console.log(`📥 Manually uploaded file: ${filepath}`);

        res.json({ success: true, filename: inputFilename });
    } catch (e) {
        res.status(400).json({ error: 'Invalid JSON or upload failed' });
    }
});


// ===================== START SERVER =====================
app.listen(PORT, () => {
    console.log(`\n🚀 JS Scraper Service running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`🌐 Universal scrape: POST /scrape`);
    console.log(`🏗️ Structure scrape: POST /scrape-structure`);
    console.log(`🏛️ Architonic scrape: POST /scrape-architonic`);
});
