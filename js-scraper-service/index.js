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
                :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #f8fafc; --primary: #3b82f6; --danger: #ef4444; --success: #10b981; }
                body { font-family: 'Inter', -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 20px; background: var(--bg); color: var(--text); line-height: 1.5; }
                header { display: flex; align-items: center; gap: 15px; margin-bottom: 30px; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
                h1 { margin: 0; font-size: 1.5rem; font-weight: 700; background: linear-gradient(to right, #fff, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                .card { background: var(--card); padding: 24px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
                .file-list { list-style: none; padding: 0; margin: 0; }
                .file-item { display: flex; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border); align-items: center; transition: background 0.2s; }
                .file-item:hover { background: rgba(255, 255, 255, 0.02); }
                .file-item:last-child { border-bottom: none; }
                .btn { padding: 8px 16px; border-radius: 6px; text-decoration: none; cursor: pointer; border: none; font-size: 0.875rem; font-weight: 600; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px; }
                .btn:active { transform: translateY(1px); }
                .btn-download { background: var(--primary); color: white; }
                .btn-download:hover { background: #2563eb; box-shadow: 0 0 15px rgba(59, 130, 246, 0.3); }
                .btn-delete { background: rgba(239, 68, 68, 0.1); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.2); margin-left: 10px; }
                .btn-delete:hover { background: var(--danger); color: white; }
                .btn-refresh { background: var(--success); color: white; margin-bottom: 15px; }
                .btn-refresh:hover { background: #059669; box-shadow: 0 0 15px rgba(16, 185, 129, 0.3); }
                .drop-zone { border: 2px dashed var(--border); padding: 40px; text-align: center; border-radius: 12px; margin-bottom: 10px; transition: all 0.3s; cursor: pointer; color: #64748b; background: rgba(255,255,255,0.01); }
                .drop-zone:hover { border-color: var(--primary); background: rgba(59, 130, 246, 0.05); color: var(--text); }
                .timestamp { color: #64748b; font-size: 0.75rem; }
                .file-info { display: flex; flex-direction: column; gap: 4px; }
                .file-name { font-weight: 600; color: #93c5fd; }
                .file-meta { font-size: 0.8rem; color: #94a3b8; }
                #loading { text-align: center; padding: 20px; color: #64748b; }
            </style>
        </head>
        <body>
            <header>
                <div style="font-size: 2rem;">📦</div>
                <h1>persistent-storage/brands</h1>
            </header>
            
            <div class="card">
                <h3 style="margin-top:0">📤 Upload Recovery File</h3>
                <div class="drop-zone" id="dropZone">
                    Drag & Drop JSON files here or <span style="color:var(--primary); text-decoration:underline">browse files</span>
                    <input type="file" id="fileInput" style="display: none" accept=".json">
                </div>
            </div>

            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px">
                    <h3 style="margin:0">📂 Saved Files</h3>
                    <a href="#" onclick="loadFiles(); return false;" class="btn btn-refresh">🔄 Refresh List</a>
                </div>
                <div id="loading">Scanning volume...</div>
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
                                <div class="file-info">
                                    <div class="file-name">\${file.name}</div> 
                                    <div class="file-meta">
                                        <span>\${file.productCount} products</span>
                                        <span style="margin: 0 8px">|</span>
                                        <span>\${date}</span>
                                    </div>
                                    <small style="color:#475569; font-family:monospace; font-size:0.7rem">\${file.filename}</small>
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

// Initial directory check is handled by initStorage() at the top.

// List all brands
app.get('/brands', async (req, res) => {
    try {
        const files = await fs.readdir(BRANDS_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        
        const brands = await Promise.all(jsonFiles.map(async (file) => {
            try {
                const filePath = path.join(BRANDS_DIR, file);
                const stats = await fs.stat(filePath);
                const content = await fs.readFile(filePath, 'utf-8');
                const data = JSON.parse(content);
                
                return {
                    name: data.brandInfo?.name || data.name || file.replace('.json', ''),
                    filename: file,
                    productCount: (data.products || []).length,
                    completedAt: stats.mtime
                };
            } catch (e) {
                return null;
            }
        }));
        
        res.json({ brands: brands.filter(b => b !== null) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to list brands', brands: [] });
    }
});

// Get single brand JSON
app.get('/brands/:filename', async (req, res) => {
    try {
        const filePath = path.join(BRANDS_DIR, req.params.filename);
        const data = await fs.readFile(filePath, 'utf-8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(404).json({ error: 'Brand file not found' });
    }
});

// Delete brand backup
app.delete('/brands/:filename', async (req, res) => {
    try {
        const filePath = path.join(BRANDS_DIR, req.params.filename);
        await fs.unlink(filePath);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete file' });
    }
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
