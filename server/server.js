
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { extractExcelData } from './fastExtractor.js';
import { CleanupService } from './cleanupService.js';
import { put, del } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import axios from 'axios';
import ScraperService from './scraper.js';
import StructureScraper from './structureScraper.js';
import BrowserlessScraper from './browserlessScraper.js';
import ScrapingBeeScraper from './scrapingBeeScraper.js';
import { ExcelDbManager } from './excelManager.js';
import { brandStorage } from './storageProvider.js';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 UNHANDLED REJECTION:', reason);
});
process.on('exit', (code) => {
  console.log(`👋 Process exiting with code: ${code}`);
});

const app = express();
const PORT = 3001;

// Initialize cleanup service
const cleanupService = new CleanupService();

// Check Blob Storage availability
const blobStoreAvailable = !!process.env.BLOB_READ_WRITE_TOKEN;
console.log(`📦 Blob Storage Available: ${blobStoreAvailable}`);

// Railway Sidecar Service URL (for image proxy delegation)
const JS_SCRAPER_SERVICE_URL = process.env.JS_SCRAPER_SERVICE_URL;

// CORS configuration
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Path logger for Vercel debugging
app.use((req, res, next) => {
  console.log(`[PathLog] ${req.method} ${req.url} (Path: ${req.path})`);
  next();
});

// Serve static files from uploads directory
const isVercel = process.env.VERCEL === '1';
const uploadsPath = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsPath));

// Multer configuration for file upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const isVercel = process.env.VERCEL === '1';
    const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
    try {
      await fs.mkdir(uploadsDir, { recursive: true });
    } catch (error) {
      console.error('Error creating uploads directory:', error);
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .xls and .xlsx files are allowed.'));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Upload and extract endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const sessionId = req.headers['x-session-id'] || 'default';

    // Track file for cleanup
    cleanupService.trackFile(sessionId, filePath);

    // Extract data from Excel (pass callback to track blobs)
    const extractedData = await extractExcelData(filePath, () => { }, (url) => {
      cleanupService.trackBlob(sessionId, url);
    });

    // Send final result
    res.json({
      success: true,
      data: extractedData,
      progress: 100,
      stage: 'Complete'
    });

  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({
      error: 'Failed to process Excel file',
      details: error.message
    });
  }
});

// Large File Support: Token generation for direct browser upload to Vercel Blob
// Support both /api/upload/... and /upload/... paths for Vercel compatibility
const blobTokenHandler = async (req, res) => {
  console.log('[BlobToken] Generating token for:', req.body.pathname || 'unknown');
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token && isVercel) {
      console.error('CRITICAL: BLOB_READ_WRITE_TOKEN is missing!');
      return res.status(500).json({ error: 'Blob storage token not found in Environment Variables' });
    }

    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      token: token,
      onBeforeGenerateToken: async (pathname) => {
        return {
          allowedContentTypes: [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/octet-stream'
          ],
          tokenPayload: JSON.stringify({ userId: 'anonymous' }),
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('[BlobToken] Upload successful:', blob.url);
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    console.error('[BlobToken] Error:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

app.post('/api/upload/blob-token', blobTokenHandler);
app.post('/upload/blob-token', blobTokenHandler); // Fallback for stripped prefix

// Process a file that was already uploaded to Vercel Blob
app.post('/api/process-blob', async (req, res) => {
  const { url, sessionId = 'default' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    // Download the file from Blob to /tmp for processing
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const isVercel = process.env.VERCEL === '1';
    const tempDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
    await fs.mkdir(tempDir, { recursive: true });

    const fileName = `large_${Date.now()}.xlsx`;
    const filePath = path.join(tempDir, fileName);
    await fs.writeFile(filePath, Buffer.from(response.data));

    // Track for cleanup
    cleanupService.trackFile(sessionId, filePath);

    // Extract (pass callback to track blobs)
    const extractedData = await extractExcelData(filePath, () => { }, (url) => {
      cleanupService.trackBlob(sessionId, url);
    });

    // (Optional) Delete the blob after processing to save space
    try { await del(url); } catch (e) { console.error('Failed to delete blob:', e.message); }

    res.json({
      success: true,
      data: extractedData,
      progress: 100,
      stage: 'Complete'
    });
  } catch (error) {
    console.error('Blob processing error:', error);
    res.status(500).json({ error: 'Failed to process blob file', details: error.message });
  }
});

// Debug endpoint to check storage configuration
app.get('/api/debug-storage', async (req, res) => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const isVercel = process.env.VERCEL === '1';

  const status = {
    env: isVercel ? 'Vercel' : 'Local',
    tokenPresent: !!token,
    tokenPrefix: token ? token.substring(0, 10) + '...' : 'none',
    timestamp: new Date().toISOString()
  };

  try {
    if (token) {
      // Try a simple put to verify
      const testBlob = await put('debug/test.txt', 'test', { access: 'public' });
      status.canWrite = true;
      status.testUrl = testBlob.url;
      // Cleanup
      await del(testBlob.url);
    }
  } catch (err) {
    status.canWrite = false;
    status.writeError = err.message;
  }

  res.json(status);
});

// Cleanup endpoint
app.post('/api/cleanup', async (req, res) => {
  const sessionId = req.body.sessionId || 'default';
  await cleanupService.cleanupSession(sessionId);
  res.json({ success: true });
});

// Image proxy endpoint - fetches external images and returns raw binary
// This supports both browser display (<img> tags) and canvas loading (exports)
app.get('/api/image-proxy', async (req, res) => {
  try {
    let imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send('URL parameter required');
    }

    // Decode if base64 (standard for this app's frontend)
    if (!imageUrl.startsWith('http')) {
      try {
        imageUrl = Buffer.from(imageUrl, 'base64').toString('utf-8');
        if (!imageUrl.startsWith('http')) throw new Error('Invalid decoded URL');
      } catch (e) {
        console.error('Proxy URL decode failed:', e.message);
        return res.status(400).send('Invalid URL format');
      }
    }

    let buffer;
    let contentType;

    // Delegate Architonic images to Railway (bypasses Vercel IP blocking)
    if (imageUrl.includes('architonic.com') && JS_SCRAPER_SERVICE_URL) {
      try {
        const railwayProxyUrl = `${JS_SCRAPER_SERVICE_URL}/image-proxy?url=${encodeURIComponent(imageUrl)}`;
        const response = await axios.get(railwayProxyUrl, {
          responseType: 'arraybuffer',
          timeout: 20000
        });
        buffer = response.data;
        contentType = response.headers['content-type'] || 'image/jpeg';
      } catch (railwayError) {
        console.warn(`[Proxy] Railway delegation failed: ${railwayError.message}. Falling back to local.`);
        // Fall through to direct fetch
      }
    }

    // Direct fetch if not Architonic or Railway failed
    if (!buffer) {
      const isAmara = imageUrl.includes('amara-art.com');
      // Check if we need to tunnel via ScrapingBee (Firewall Bypass for Amara)
      if (isAmara && process.env.SCRAPINGBEE_API_KEY) {
        const apiKey = process.env.SCRAPINGBEE_API_KEY;
        const sbUrl = `https://app.scrapingbee.com/api/v1?api_key=${apiKey}&url=${encodeURIComponent(imageUrl)}&render_js=false&block_ads=true`;
        const sbRes = await axios.get(sbUrl, { responseType: 'arraybuffer' });
        buffer = sbRes.data;
        contentType = sbRes.headers['content-type'] || 'image/jpeg';
      } else {
        // Standard Direct Fetch
        const response = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': new URL(imageUrl).origin
          }
        });
        buffer = response.data;
        contentType = response.headers['content-type'] || 'image/jpeg';
      }
    }

    // Return RAW binary image (works for <img> tags AND canvas loading)
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=31536000');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(buffer);

  } catch (error) {
    console.error('Image proxy error:', error.message);
    res.status(502).send('Failed to fetch image');
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Get Scraper Service URL for UI links (Dashboard)
app.get('/api/scraper-config', (req, res) => {
  res.json({
    url: JS_SCRAPER_SERVICE_URL || null,
    dashboardUrl: JS_SCRAPER_SERVICE_URL ? `${JS_SCRAPER_SERVICE_URL}/dashboard` : null
  });
});

// Debug endpoint
app.get('/api/debug', async (req, res) => {
  try {
    const isVercel = process.env.VERCEL === '1';
    const hasKV = !!(process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);

    const debugInfo = {
      isVercel,
      hasKV,
      cwd: process.cwd(),
      dirname: __dirname,
      envKeys: Object.keys(process.env).filter(k => k.includes('URL') || k.includes('TOKEN') || k.includes('KV') || k.includes('STORAGE')),
      pathsChecked: [
        path.join(process.cwd(), 'server/data/brands'),
        path.join(__dirname, 'data/brands'),
        path.join(__dirname, 'server/data/brands'),
        '/var/task/server/data/brands'
      ]
    };

    const pathResults = {};
    for (const p of debugInfo.pathsChecked) {
      try {
        const exists = await fs.access(p).then(() => true).catch(() => false);
        if (exists) {
          const files = await fs.readdir(p);
          pathResults[p] = { exists: true, files: files.filter(f => f.endsWith('.json')) };
        } else {
          pathResults[p] = { exists: false };
        }
      } catch (e) {
        pathResults[p] = { error: e.message };
      }
    }

    res.json({ debugInfo, pathResults });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    error: error.message || 'Internal server error'
  });
});

// Cleanup on server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await cleanupService.cleanupAll();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down server...');
  await cleanupService.cleanupAll();
  process.exit(0);
});

// Reset/Cleanup endpoint for app initialization
app.post('/api/reset', async (req, res) => {
  console.log('Resetting application state...');
  await cleanupService.cleanupAll();
  // Re-create uploads directory immediately to ensure readiness
  const isVercel = process.env.VERCEL === '1';
  const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
  const imagesDir = isVercel ? '/tmp/uploads/images' : path.join(__dirname, '../uploads/images');
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(imagesDir, { recursive: true });
  } catch (e) { console.error('Error recreating dirs:', e); }
  res.json({ success: true, message: 'Environment reset complete' });
});

if (process.env.NODE_ENV !== 'production' || process.env.VITE_DEV_SERVER) {
  const server = app.listen(PORT, async () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Upload endpoint: http://localhost:${PORT}/api/upload`);

    // Clean up on startup
    await cleanupService.cleanupAll();
  });
}

// Brand persistence is now handled by brandStorage provider
// Initialized in separate module

const brandDiskStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const isVercel = process.env.VERCEL === '1';
    const brandsDir = isVercel ? '/tmp/uploads/brands' : path.join(__dirname, '../uploads/brands');
    try {
      await fs.mkdir(brandsDir, { recursive: true });
    } catch (error) {
      console.error('Error creating brands directory:', error);
    }
    cb(null, brandsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const brandUpload = multer({
  storage: brandDiskStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

app.get('/api/brands', async (req, res) => {
  try {
    const brands = await brandStorage.getAllBrands();
    res.json(brands);
  } catch (error) {
    console.error("Failed to fetch brands:", error);
    res.status(500).json({ error: 'Failed to fetch brands' });
  }
});

app.delete('/api/brands/:id', async (req, res) => {
  try {
    const brandId = req.params.id;
    await brandStorage.deleteBrand(brandId);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting brand:", error);
    res.status(500).json({ error: 'Failed to delete brand' });
  }
});


const scraperService = new ScraperService();
const structureScraper = new StructureScraper();
const browserlessScraper = new BrowserlessScraper();
const scrapingBeeScraper = new ScrapingBeeScraper();
const dbManager = new ExcelDbManager();

// --- Railway Sidecar Services ---
// JS_SCRAPER_SERVICE_URL is defined at the top of file for image proxy
const PYTHON_SCRAPER_SERVICE_URL = process.env.PYTHON_SERVICE_URL; // Already exists for Python scraper

// Helper to check if JS scraper sidecar is available
const isJsScraperAvailable = () => !!JS_SCRAPER_SERVICE_URL;
const isPythonScraperAvailable = () => !!PYTHON_SCRAPER_SERVICE_URL;

// Helper to call Railway JS scraper service
async function callJsScraperService(endpoint, payload, timeout = 300000) {
  if (!JS_SCRAPER_SERVICE_URL) {
    throw new Error('JS_SCRAPER_SERVICE_URL not configured');
  }
  const url = `${JS_SCRAPER_SERVICE_URL}${endpoint}`;
  console.log(`🌐 Calling JS Scraper Service: ${url}`);

  const response = await axios.post(url, payload, {
    timeout,
    headers: { 'Content-Type': 'application/json' }
  });
  return response.data;
}

// Helper to poll task status from Railway service
// ENHANCED: Increased timeout to 60 minutes for very large brand collections (300+ products)
async function pollJsScraperTask(taskId, onProgress = null, maxWaitMs = 3600000) {
  const startTime = Date.now();
  const pollInterval = 3000; // 3 seconds
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 20; // Allow more retries
  let lastProgress = 0;

  console.log(`🔄 Starting poll for Railway task: ${taskId} (timeout: ${maxWaitMs / 60000} mins)`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Short timeout for the poll request itself to prevent hanging
      const response = await axios.get(`${JS_SCRAPER_SERVICE_URL}/tasks/${taskId}`, { timeout: 10000 });
      const task = response.data;

      // Reset error counter
      consecutiveErrors = 0;

      if (onProgress && task.progress) {
        onProgress(task.progress, task.stage || 'Processing...', task.brandName);

        // Log progress occasionally
        if (Math.abs(task.progress - lastProgress) >= 5 || task.status === 'completed') {
          console.log(`   📊 Task ${taskId}: ${task.progress}% - ${task.stage} (Status: ${task.status})`);
          lastProgress = task.progress;
        }
      }

      if (task.status === 'completed') {
        console.log(`✅ Task ${taskId} COMPLETED with ${task.productCount || 0} products`);
        return task;
      } else if (task.status === 'failed') {
        throw new Error(task.error || 'JS Scraper task failed');
      } else if (task.status === 'cancelled') {
        throw new Error('Task was cancelled');
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error) {
      if (error.response?.status === 404) {
        // If task disappeared from Railway but we thought it was running, it might have finished or crashed
        console.warn(`⚠️ Task ${taskId} not found (404). It may have been cleared or service restarted.`);
        throw new Error('Task not found on JS Scraper service');
      }

      // Network error - increment counter and retry
      consecutiveErrors++;
      console.warn(`⚠️ Poll error (${consecutiveErrors}/${maxConsecutiveErrors}): ${error.message}`);

      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(`Too many consecutive polling errors: ${error.message}`);
      }

      const backoffMs = Math.min(pollInterval * consecutiveErrors, 10000);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  console.error(`❌ Task ${taskId} timed out locally after ${maxWaitMs / 60000} minutes`);
  throw new Error('JS Scraper task timed out in polling loop');
}

// --- Task Manager for Background Scraping ---
const tasks = new Map();

app.get('/api/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const taskId = req.params.id;
  const task = tasks.get(taskId);
  if (task) {
    tasks.set(taskId, { ...task, status: 'cancelled', stage: 'Cancelled by user' });
    console.log(`🛑 Task ${taskId} cancelled by user.`);
    return res.json({ success: true, message: 'Task cancelled' });
  }
  res.status(404).json({ error: 'Task not found' });
});

// --- Proxy Endpoints for Persistent Storage (Sidecar) ---
app.get('/api/railway-brands', async (req, res) => {
  if (!JS_SCRAPER_SERVICE_URL) {
    // console.warn('⚠️ JS_SCRAPER_SERVICE_URL not configured, cannot list saved brands');
    return res.json({ brands: [] });
  }
  try {
    const response = await axios.get(`${JS_SCRAPER_SERVICE_URL}/brands`, { timeout: 5000 });
    res.json(response.data);
  } catch (error) {
    console.warn('Failed to fetch brands from sidecar:', error.message);
    res.json({ brands: [] });
  }
});

app.get('/api/railway-brands/:filename', async (req, res) => {
  if (!JS_SCRAPER_SERVICE_URL) return res.status(404).json({ error: 'Sidecar not configured' });
  try {
    const response = await axios.get(`${JS_SCRAPER_SERVICE_URL}/brands/${req.params.filename}`, { timeout: 10000 });
    res.json(response.data);
  } catch (error) {
    res.status(404).json({ error: 'Brand not found on sidecar' });
  }
});

app.delete('/api/railway-brands/:filename', async (req, res) => {
  if (!JS_SCRAPER_SERVICE_URL) return res.status(404).json({ error: 'Sidecar not configured' });
  try {
    await axios.delete(`${JS_SCRAPER_SERVICE_URL}/brands/${req.params.filename}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete from sidecar:', error.message);
    res.status(500).json({ error: 'Failed to delete from sidecar' });
  }
});

// Import endpoint: Restore a brand from Railway Backup to Local DB
app.post('/api/railway-brands/import/:filename', async (req, res) => {
  try {
    if (!JS_SCRAPER_SERVICE_URL) throw new Error('Sidecar not configured');

    // 1. Fetch from Railway
    const filename = req.params.filename;
    console.log(`📥 Importing brand from railway: ${filename}`);
    const response = await axios.get(`${JS_SCRAPER_SERVICE_URL}/brands/${filename}`, { timeout: 15000 });
    const data = response.data; // { brandInfo: { name, logo }, products: [], ... }

    // 2. Format for Local Storage
    const id = Date.now();
    const newBrand = {
      id,
      name: (data.brandInfo?.name || filename).replace(/_/g, ' '),
      logo: data.brandInfo?.logo || '',
      budgetTier: 'mid', // Default
      origin: 'Imported',
      products: data.products || [],
      createdAt: new Date(),
      scrapedWith: 'Railway-Cloud-Restore'
    };

    // 3. Save to Local DB
    await brandStorage.saveBrand(newBrand);

    res.json({ success: true, count: newBrand.products.length, brandName: newBrand.name });
  } catch (e) {
    console.error('Import failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// --- Scraping Endpoint ---
app.post('/api/scrape-brand', async (req, res) => {
  try {
    const { url } = req.body;

    // Extract brand name from URL if not provided
    let name = req.body.name;
    if (!name) {
      const urlObj = new URL(url);
      name = urlObj.hostname.replace('www.', '').split('.')[0].toUpperCase();
    }

    // Set defaults for optional fields
    const origin = req.body.origin || 'UNKNOWN';
    const budgetTier = req.body.budgetTier || 'mid';

    // Determine Scraper Source
    const scraperSource = req.body.scraperSource;
    const forceLocal = scraperSource === 'local' || (process.env.USE_LOCAL_SCRAPER === 'true' && scraperSource !== 'railway');

    // Cloud Scraper Flags
    const useScrapingBee = !!process.env.SCRAPINGBEE_API_KEY;
    const useBrowserless = !!process.env.BROWSERLESS_API_KEY;

    // PRIORITY 1: Local Scraper
    if (forceLocal) {
      console.log(`🏠 [scrape-brand] Using LOCAL scraper (Reason: ${scraperSource === 'local' ? 'User Selection' : 'Env Override'})`);
      // Fall through to local logic below...
    }
    // PRIORITY 2: Use Railway JS Scraper Service if available
    else if (JS_SCRAPER_SERVICE_URL) {
      console.log('🚂 [scrape-brand] Delegating to Railway JS Scraper Service');
      try {
        const jsScraperAvailable = await isJsScraperAvailable();
        if (jsScraperAvailable) {
          const isArchitonic = url.toLowerCase().includes('architonic.com');
          const scraperEndpoint = isArchitonic ? '/scrape-architonic' : '/scrape';

          const taskResult = await callJsScraperService(scraperEndpoint, { url, name, sync: false });

          if (taskResult.taskId) {
            const taskId = `railway_brand_${taskResult.taskId}`;
            tasks.set(taskId, {
              id: taskId,
              status: 'processing',
              progress: 10,
              stage: `Railway: ${isArchitonic ? 'Architonic' : 'Universal'} scraper started...`,
              brandName: name,
              railwayTaskId: taskResult.taskId
            });

            // Poll Railway task in background
            (async () => {
              try {
                const result = await pollJsScraperTask(taskResult.taskId, (progress, stage) => {
                  const currentTask = tasks.get(taskId);
                  if (currentTask) {
                    tasks.set(taskId, { ...currentTask, progress, stage: `Railway: ${stage}` });
                  }
                });

                const products = result.products || [];
                const brandNameFound = name || result.brandInfo?.name || 'Unknown Brand';
                const brandLogo = result.brandInfo?.logo || '';

                const id = Date.now();
                const newBrand = {
                  id,
                  name: brandNameFound,
                  url,
                  origin,
                  budgetTier,
                  logo: brandLogo,
                  products,
                  createdAt: new Date(),
                };

                // Use centralized storage provider (handles KV, Blob, and Local)
                try {
                  await brandStorage.saveBrand(newBrand);
                  console.log(`✅ Saved brand ${brandNameFound} (${products.length} products) to storage`);
                } catch (e) {
                  console.error('Storage save error:', e);
                }

                tasks.set(taskId, {
                  ...tasks.get(taskId),
                  status: 'completed',
                  progress: 100,
                  stage: 'Complete!',
                  brand: newBrand,
                  productCount: products.length,
                  brandName: brandNameFound
                });
              } catch (err) {
                console.error('Railway task polling failed:', err);
                tasks.set(taskId, {
                  ...tasks.get(taskId),
                  status: 'failed',
                  error: err.message
                });
              }
            })();

            return res.json({ success: true, taskId, message: 'Railway scraping started' });
          }
        }
      } catch (railwayError) {
        console.warn('Railway service unavailable, falling back:', railwayError.message);
      }
    }

    // PRIORITY 2: Check cloud scrapers: prefer ScrapingBee (has anti-bot), then Browserless

    // Start scraping in background
    const taskId = `scrape_${Date.now()}`;
    tasks.set(taskId, { id: taskId, status: 'processing', progress: 10, stage: 'Starting harvest...', brandName: name });

    // Run in background
    (async () => {
      console.log(`🧵 [Background Task] Starting scraper execution for ${taskId}...`);
      try {
        // Choose scraper: ScrapingBee (anti-bot) > Browserless > Local
        let scraper, scraperName;
        if (forceLocal) {
          scraper = scraperService;
          scraperName = 'Local (Forced)';
        } else if (useScrapingBee) {
          scraper = scrapingBeeScraper;
          scraperName = 'ScrapingBee';
        } else if (useBrowserless) {
          scraper = browserlessScraper;
          scraperName = 'Browserless';
        } else {
          scraper = scraperService;
          scraperName = 'Local';
        }

        console.log(`🔄 Using ${scraperName} scraper for ${url}`);
        const result = await scraper.scrapeBrand(url, (progress, message) => {
          // Relay progress to task manager
          const currentTask = tasks.get(taskId);
          if (currentTask && currentTask.status !== 'cancelled') {
            tasks.set(taskId, { ...currentTask, progress, stage: message });
          }
        });

        console.log(`✅ [Background Task] Scrape completed: ${result?.products?.length} products`);
        const products = result.products || [];
        const brandLogo = result.brandInfo?.logo || '';

        const id = Date.now();
        const brandName = result.brandInfo?.name || name;
        const newBrand = {
          id,
          name: brandName,
          url,
          origin,
          budgetTier,
          logo: brandLogo,
          products,
          createdAt: new Date()
        };

        // Use centralized storage provider
        try {
          await brandStorage.saveBrand(newBrand);
          console.log(`💾 Brand saved to storage: ${brandName}`);
        } catch (e) {
          console.error('Storage save error:', e);
        }

        tasks.set(taskId, {
          id: taskId,
          status: 'completed',
          progress: 100,
          stage: 'Complete!',
          brand: newBrand,
          productCount: products.length,
          brandName: brandName
        });
      } catch (err) {
        console.error(`💥 [Background Task] FAILED: ${err.message}\n${err.stack}`);
        tasks.set(taskId, { id: taskId, status: 'failed', error: err.message, brandName: name });
      }
    })();

    res.json({
      success: true,
      message: useBrowserless ? 'Cloud scraping started (Browserless).' : 'Scraping started in background.',
      taskId: taskId
    });

  } catch (error) {
    console.error('Scraping failed:', error);
    res.status(500).json({ error: 'Scraping failed', details: error.message });
  }
});

// --- AI-Powered Scraping Endpoint (Universal) ---
app.post('/api/scrape-ai', async (req, res) => {
  try {
    const { url, name, budgetTier = 'mid', origin = 'UNKNOWN', maxProducts = 10000 } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // PRIORITY 1: Use Railway JS Scraper Service if available
    if (JS_SCRAPER_SERVICE_URL) {
      console.log('🚂 [scrape-ai] Delegating to Railway JS Scraper Service');
      try {
        const jsScraperAvailable = await isJsScraperAvailable();
        if (jsScraperAvailable) {
          // Determine which endpoint to use
          const isArchitonic = url.toLowerCase().includes('architonic.com');
          const scraperEndpoint = isArchitonic ? '/scrape-architonic' : '/scrape';

          // Start task on Railway
          const taskResult = await callJsScraperService(scraperEndpoint, { url, name, sync: false });

          if (taskResult.taskId) {
            // Create local task to track Railway task
            const taskId = `railway_${taskResult.taskId}`;
            tasks.set(taskId, {
              id: taskId,
              status: 'processing',
              progress: 10,
              stage: `Railway: ${isArchitonic ? 'Architonic' : 'Universal'} scraper started...`,
              brandName: name || 'Detecting...',
              railwayTaskId: taskResult.taskId
            });

            // Poll Railway task in background
            (async () => {
              try {
                const result = await pollJsScraperTask(taskResult.taskId, (progress, stage) => {
                  const currentTask = tasks.get(taskId);
                  if (currentTask) {
                    tasks.set(taskId, { ...currentTask, progress, stage: `Railway: ${stage}` });
                  }
                });

                const products = result.products || [];
                const brandNameFound = name || result.brandInfo?.name || 'Unknown Brand';
                const brandLogo = result.brandInfo?.logo || '';

                const id = Date.now();
                const newBrand = {
                  id,
                  name: brandNameFound,
                  url,
                  origin,
                  budgetTier,
                  logo: brandLogo,
                  products,
                  createdAt: new Date(),
                };

                // Use centralized storage provider
                try {
                  await brandStorage.saveBrand(newBrand);
                  console.log(`✅ Saved AI-scraped brand ${brandNameFound} to storage`);
                } catch (e) {
                  console.error('Storage save error:', e);
                }

                tasks.set(taskId, {
                  ...tasks.get(taskId),
                  status: 'completed',
                  progress: 100,
                  stage: 'Complete!',
                  brand: newBrand,
                  productCount: products.length,
                  brandName: brandNameFound
                });
              } catch (err) {
                console.error('Railway task polling failed:', err);
                tasks.set(taskId, {
                  ...tasks.get(taskId),
                  status: 'failed',
                  error: err.message
                });
              }
            })();

            return res.json({ success: true, taskId, message: 'Railway scraping started' });
          }
        }
      } catch (railwayError) {
        console.warn('Railway service unavailable, falling back:', railwayError.message);
      }
    }

    // PRIORITY 2: Check cloud scrapers (ScrapingBee / Browserless)
    const isAmara = url.includes('amara-art.com');

    // Force ScrapingBee for Amara (Firewall Bypass)
    let useScrapingBee = (isVercel || isAmara) && scrapingBeeScraper.isConfigured();

    if (isAmara) {
      console.log('🚨 [scrape-ai] DETECTED AMARA ART - FORCING CLOUD SCRAPER BYPASS 🚨');
      if (!scrapingBeeScraper.isConfigured()) {
        // Inject key if missing
        process.env.SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '7XP4G1NCU7PG5TDR4Q8INNW9D4ZOLCUPUEHKTPM6PZEHKY1BR9JWZL2K5ZUZYHF1DFSQMY50L0AI6SPV';
        scrapingBeeScraper.isConfigured();
        useScrapingBee = true;
      }
    }

    const useBrowserless = (isVercel || (!useScrapingBee)) && browserlessScraper.isConfigured() && !useScrapingBee;

    if (isVercel && !useScrapingBee && !useBrowserless && !JS_SCRAPER_SERVICE_URL) {
      return res.status(503).json({
        error: 'Scraping Unavailable - No Scraper Configured',
        details: 'Cloud scraping requires BROWSERLESS_API_KEY, SCRAPINGBEE_API_KEY, or JS_SCRAPER_SERVICE_URL. Please add one to your Vercel environment variables.',
        isVercelLimitation: true
      });
    }


    // Start background task
    const taskId = `ai_scrape_${Date.now()}`;
    const initialStage = url.includes('architonic.com') ? 'Detecting Architonic Collection...' : 'Initializing hierarchy harvest...';
    tasks.set(taskId, { id: taskId, status: 'processing', progress: 10, stage: initialStage, brandName: name || 'Detecting...' });

    // Run in background
    (async () => {
      try {
        let result;

        // Progress callback
        const progressCallback = (progress, stage, detectedName = null) => {
          const currentTask = tasks.get(taskId);
          if (!currentTask) return;
          tasks.set(taskId, {
            ...currentTask,
            progress,
            stage,
            brandName: detectedName || currentTask.brandName
          });
        };
        progressCallback.isCancelled = () => tasks.get(taskId)?.status === 'cancelled';

        if (useScrapingBee) {
          // Use ScrapingBee (supports Amara via internal logic)
          tasks.set(taskId, { ...tasks.get(taskId), stage: 'Using cloud scraper (ScrapingBee)...' });
          result = await scrapingBeeScraper.scrapeBrand(url, progressCallback);
        } else if (useBrowserless) {
          // Use Browserless cloud scraper on Vercel
          tasks.set(taskId, { ...tasks.get(taskId), stage: 'Using cloud browser (Browserless)...' });
          result = await browserlessScraper.scrapeBrand(url, progressCallback);
        } else if (url.includes('architonic.com')) {
          // Use specialized Architonic scraper locally
          tasks.set(taskId, { ...tasks.get(taskId), stage: 'Crawling Architonic Collection...' });
          result = await scraperService.scrapeBrand(url, progressCallback);
          tasks.set(taskId, { ...tasks.get(taskId), progress: 80, stage: 'Finalizing Architonic data...' });
        } else {
          // Use Universal Structure Scraper locally
          result = await structureScraper.scrapeBrand(url, name, progressCallback);
        }

        const products = result.products || [];
        const brandNameFound = name || result.brandInfo?.name || 'Unknown Brand';
        const brandLogo = result.brandInfo?.logo || '';

        const id = Date.now();
        const newBrand = {
          id: id,
          name: brandNameFound,
          url,
          origin,
          budgetTier,
          logo: brandLogo,
          products,
          createdAt: new Date(),
          scrapedWith: useBrowserless ? 'Browserless-Cloud' : (url.includes('architonic.com') ? 'Architonic-Specialized' : 'Structure-Harvest')
        };

        await brandStorage.saveBrand(newBrand);
        tasks.set(taskId, {
          id: taskId,
          status: 'completed',
          progress: 100,
          stage: 'Harvest Complete!',
          brand: newBrand,
          productCount: products.length
        });
      } catch (error) {
        console.error('Background Scrape failed:', error);
        tasks.set(taskId, { id: taskId, status: 'failed', error: error.message });
      }
    })();

    res.json({
      success: true,
      message: useBrowserless ? 'Cloud scraping started (Browserless).' : 'Background hierarchical harvest started.',
      taskId
    });

  } catch (error) {
    console.error('AI Scraping failed:', error);
    res.status(500).json({ error: 'AI Scraping failed', details: error.message });
  }
});

// --- Railway JS Scraper Sidecar Endpoint (RECOMMENDED for Vercel) ---
app.post('/api/scrape-railway', async (req, res) => {
  try {
    const { url, name, budgetTier = 'mid', origin = 'UNKNOWN', scraper = 'auto' } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Check if Railway JS scraper service is configured
    if (!isJsScraperAvailable()) {
      // Fallback: Try Python scraper if available
      if (isPythonScraperAvailable()) {
        console.log('⚠️ JS Scraper not configured, falling back to Python scraper...');
        // Redirect to scrapling endpoint logic
        return res.redirect(307, '/api/scrape-scrapling');
      }

      return res.status(503).json({
        error: 'Scraping Service Unavailable',
        details: 'Neither JS_SCRAPER_SERVICE_URL nor PYTHON_SERVICE_URL is configured. Please add one to your environment variables.',
        configRequired: ['JS_SCRAPER_SERVICE_URL', 'PYTHON_SERVICE_URL']
      });
    }

    console.log(`\n🚂 [Railway Sidecar] Delegating scrape to JS service: ${url}`);
    console.log(`   Scraper mode: ${scraper}`);

    // Create local task for tracking
    const taskId = `railway_${Date.now()}`;
    const isArchitonic = url.includes('architonic.com');
    const initialStage = isArchitonic ? 'Delegating to Railway (Architonic)...' : 'Delegating to Railway JS scraper...';

    tasks.set(taskId, {
      id: taskId,
      status: 'processing',
      progress: 5,
      stage: initialStage,
      brandName: name || 'Detecting...',
      delegatedTo: 'Railway JS Scraper'
    });

    // Run in background
    (async () => {
      try {
        // Determine which endpoint to call based on scraper type
        let endpoint = '/scrape';
        if (scraper === 'structure') {
          endpoint = '/scrape-structure';
        } else if (scraper === 'architonic' || isArchitonic) {
          endpoint = '/scrape-architonic';
        }

        // Start the scrape on Railway (async mode)
        const startResult = await callJsScraperService(endpoint, { url, name, sync: false });

        if (!startResult.taskId) {
          throw new Error('Railway service did not return a taskId');
        }

        const railwayTaskId = startResult.taskId;
        console.log(`   Railway task started: ${railwayTaskId}`);
        tasks.set(taskId, { ...tasks.get(taskId), railwayTaskId, progress: 10, stage: 'Railway task started...' });

        // Poll for completion
        const progressCallback = (progress, stage, detectedName) => {
          const currentTask = tasks.get(taskId);
          if (!currentTask || currentTask.status === 'cancelled') return;
          tasks.set(taskId, {
            ...currentTask,
            progress,
            stage,
            brandName: detectedName || currentTask.brandName
          });
        };

        const completedTask = await pollJsScraperTask(railwayTaskId, progressCallback);

        // Process completed result
        const products = completedTask.products || [];
        const brandNameFound = name || completedTask.brandInfo?.name || 'Unknown Brand';
        const brandLogo = completedTask.brandInfo?.logo || '';

        const id = Date.now();
        const newBrand = {
          id,
          name: brandNameFound,
          url,
          origin,
          budgetTier,
          logo: brandLogo,
          products,
          createdAt: new Date(),
          scrapedWith: `Railway-JS-${scraper === 'structure' ? 'Structure' : (isArchitonic ? 'Architonic' : 'Universal')}`
        };

        await brandStorage.saveBrand(newBrand);

        tasks.set(taskId, {
          id: taskId,
          status: 'completed',
          progress: 100,
          stage: 'Railway Harvest Complete!',
          brand: newBrand,
          productCount: products.length
        });

        console.log(`✅ Railway task ${taskId} completed: ${products.length} products`);

      } catch (error) {
        console.error(`❌ Railway scrape failed:`, error.message);
        tasks.set(taskId, {
          id: taskId,
          status: 'failed',
          error: error.message
        });
      }
    })();

    res.json({
      success: true,
      message: 'Scraping delegated to Railway JS service',
      taskId,
      service: 'railway-js-scraper'
    });

  } catch (error) {
    console.error('Railway scrape endpoint error:', error);
    res.status(500).json({ error: 'Railway scraping failed', details: error.message });
  }
});

// --- Scrapling Endpoint ---
app.post('/api/scrape-scrapling', async (req, res) => {
  try {
    const { url, name, budgetTier = 'mid', origin = 'UNKNOWN' } = req.body;

    // Check if we have an external Python Service configured (Railway/Render)
    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL;

    // If no external service AND running on Vercel, block it.
    if (!pythonServiceUrl && process.env.VERCEL === '1') {
      return res.status(503).json({
        error: 'Feature Unavailable on Cloud',
        details: 'Scrapling requires a local env or a separate Python microservice. Please configure PYTHON_SERVICE_URL or run locally.'
      });
    }

    if (!url) return res.status(400).json({ error: 'URL is required' });

    const taskId = `scrapling_${Date.now()}`;
    tasks.set(taskId, { id: taskId, status: 'processing', progress: 10, stage: 'Starting Scrapling engine...', brandName: name || 'Detecting...' });

    // Run in background
    (async () => {
      try {
        if (pythonServiceUrl) {
          // --- Mode A: Call External Python Service ---
          console.log(`[Scrapling] Delegating to external service: ${pythonServiceUrl}`);
          const serviceRes = await axios.post(`${pythonServiceUrl}/scrape`, { url });
          const result = serviceRes.data;

          // Process Result (Shared Logic)
          const products = result.products || [];
          const brandNameFound = name || result.brandInfo?.name || 'Unknown Brand';
          const brandLogo = result.brandInfo?.logo || '';

          const id = Date.now();
          const newBrand = {
            id,
            name: brandNameFound,
            url,
            origin,
            budgetTier,
            logo: brandLogo,
            products,
            createdAt: new Date(),
            scrapedWith: 'Scrapling-microservice'
          };

          await brandStorage.saveBrand(newBrand);
          tasks.set(taskId, {
            id: taskId,
            status: 'completed',
            progress: 100,
            stage: 'Harvest Complete!',
            brand: newBrand,
            productCount: products.length
          });

        } else {
          // --- Mode B: Spawn Local Process ---
          console.log(`[Scrapling] Starting local python process for ${url}`);
          const scriptPath = path.join(__dirname, 'scrapling_script.py');
          // continue with spawn...

          const pythonProcess = spawn('python', [scriptPath, url]);

          let stdoutData = '';
          let stderrData = '';

          pythonProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
          });

          pythonProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
            console.error(`[Scrapling Stderr]: ${data}`);
          });

          pythonProcess.on('close', async (code) => {
            if (code !== 0) {
              console.error(`[Scrapling] Process exited with code ${code}`);
              tasks.set(taskId, { id: taskId, status: 'failed', error: `Python script failed with code ${code}. Stderr: ${stderrData}` });
              return;
            }

            try {
              // Parse JSON output
              // Basic cleanup if logs leaked to stdout
              const lastLine = stdoutData.trim().split('\n').pop();
              const result = JSON.parse(lastLine);

              if (result.error) {
                throw new Error(result.error);
              }

              const products = result.products || [];
              const brandNameFound = name || result.brandInfo?.name || 'Unknown Brand';
              const brandLogo = result.brandInfo?.logo || '';

              const id = Date.now();
              const newBrand = {
                id,
                name: brandNameFound,
                url,
                origin,
                budgetTier,
                logo: brandLogo,
                products,
                createdAt: new Date(),
                scrapedWith: 'Scrapling-Python'
              };

              await brandStorage.saveBrand(newBrand);
              tasks.set(taskId, {
                id: taskId,
                status: 'completed',
                progress: 100,
                stage: 'Harvest Complete!',
                brand: newBrand,
                productCount: products.length
              });

            } catch (e) {
              console.error('[Scrapling] Parse error:', e);
              tasks.set(taskId, { id: taskId, status: 'failed', error: 'Failed to parse Scrapling output: ' + e.message });
            }
          });

        }
      } catch (error) {
        console.error('Background Scrapling failed:', error);
        tasks.set(taskId, { id: taskId, status: 'failed', error: error.message });
      }
    })();

    res.json({
      success: true,
      message: 'Scrapling started.',
      taskId
    });

  } catch (error) {
    console.error('Scrapling API failed:', error);
    res.status(500).json({ error: 'Scrapling failed', details: error.message });
  }
});

// --- DB Management Endpoints ---
app.get('/api/brands/:id/export', async (req, res) => {
  try {
    const brandId = req.params.id;
    const brand = await brandStorage.getBrandById(brandId);

    if (!brand) {
      return res.status(404).send('Brand not found');
    }

    const workbook = await dbManager.exportToExcel(brand);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${brand.name.replace(/\s+/g, '_')}_products.xlsx`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Export failed:', error);
    res.status(500).send('Export failed');
  }
});

app.post('/api/brands/:id/import', upload.single('file'), async (req, res) => {
  try {
    const brandId = req.params.id;
    const brand = await brandStorage.getBrandById(brandId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const products = await dbManager.importFromExcel(req.file.path);

    brand.products = products; // Update products
    const saved = await brandStorage.saveBrand(brand);
    if (!saved) {
      throw new Error('Failed to save brand data to persistent storage (KV/File).');
    }

    // Clean up uploaded file
    try { await fs.unlink(req.file.path); } catch (e) { }

    res.json({ success: true, count: products.length });

  } catch (error) {
    console.error('Import failed:', error);
    res.status(500).json({ error: 'Import failed', details: error.message });
  }
});

export default app;

// Start server locally
app.listen(3001, () => {
  console.log('🚀 Server running on http://localhost:3001');
});
