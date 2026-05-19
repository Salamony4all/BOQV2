console.log('🏁 [Server] Loading dependencies...');
import 'dotenv/config';
import './nodePolyfills.js'; // MUST be before pdfjs — patches DOMMatrix etc. on globalThis
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import fs_sync from 'fs';
import { fileURLToPath } from 'url';
import { extractExcelData } from './fastExtractor.js';
import { CleanupService } from './cleanupService.js';
import {
  uploadToSupabase,
  listSupabaseFiles,
  deleteFromSupabase,
  supabase,
  getSupabaseBrands,
  getSupabaseStats
} from './utils/supabaseStorage.js';
import { syncLocalToSupabase } from './scripts/syncLocalToSupabase.js';
import axios from 'axios';
import https from 'https';
import { ExcelDbManager } from './excelManager.js';
import { convertXlsToXlsx } from './utils/xlsToXlsxConverter.js';
import { brandStorage, kv } from './storageProvider.js';
import { getAiMatch, identifyModel, fetchProductDetails, searchAndEnrichModel, analyzePlan, matchFitoutItem, autoMatchSingleBrand, FREE_GOOGLE_MODELS, PAID_GOOGLE_MODELS, VALID_GOOGLE_MODELS, VALID_OPENROUTER_MODELS, VALID_NVIDIA_MODELS, GOOGLE_MODEL, OPENROUTER_MODEL, NVIDIA_MODEL } from './utils/llmUtils.js';
import { veMatchSimple, veMatchAdvanced, veGetProductDetails, veRouteCategories } from './utils/veMatchUtils.js';
import { veMatchAuto } from './utils/veAutoDetectUtils.js'; // Removed unused veAutoDetectRoute
import { generatePresentationPdf } from './utils/pptxExportService.js';
import { convertEmfToPng } from './utils/emfConverter.js';
import Fuse from 'fuse.js';
import { TAXONOMY } from './utils/normalizer.js';

// ALL heavy PDF/Vision extractors are LAZY to prevent Vercel boot crash
// (pdfProductExtractor uses pdfjs, visionBOQExtractor uses Playwright)
let _pdfProductExtractor = null;
let _parallelBOQExtractor = null;
let _visionBOQExtractor = null;
let _pdfRenderer = null;

async function getPdfProductExtractor() {
  if (!_pdfProductExtractor) {
    _pdfProductExtractor = await import('./pdfProductExtractor.js');
  }
  return _pdfProductExtractor;
}
async function getParallelBOQExtractor() {
  if (!_parallelBOQExtractor) {
    _parallelBOQExtractor = await import('./parallelBOQExtractor.js');
  }
  return _parallelBOQExtractor;
}
async function getVisionBOQExtractor() {
  if (!_visionBOQExtractor) {
    _visionBOQExtractor = await import('./visionBOQExtractor.js');
  }
  return _visionBOQExtractor;
}
async function getPdfRenderer() {
  if (!_pdfRenderer) {
    _pdfRenderer = await import('./utils/pdfRenderer.js');
  }
  return _pdfRenderer;
}

// Scraper imports are LAZY (dynamic) to prevent Vercel serverless boot crash
// Playwright/Crawlee/Puppeteer-core cannot be imported at module level on Vercel
let _ScraperService = null;
let _StructureScraper = null;
let _BrowserlessScraper = null;
let _ScrapingBeeScraper = null;

async function getScraperService() {
  if (!_ScraperService) {
    const m = await import('./scraper.js');
    _ScraperService = m.default;
  }
  return new _ScraperService();
}
async function getStructureScraper() {
  if (!_StructureScraper) {
    const m = await import('./structureScraper.js');
    _StructureScraper = m.default;
  }
  return new _StructureScraper();
}
async function getBrowserlessScraper() {
  if (!_BrowserlessScraper) {
    const m = await import('./browserlessScraper.js');
    _BrowserlessScraper = m.default;
  }
  return new _BrowserlessScraper();
}
async function getScrapingBeeScraper() {
  if (!_ScrapingBeeScraper) {
    const m = await import('./scrapingBeeScraper.js');
    _ScrapingBeeScraper = m.default;
  }
  return new _ScrapingBeeScraper();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 UNHANDLED REJECTION:', reason);
});

const app = express();
const PORT = 3001;
let server;

// Initialize services
const cleanupService = new CleanupService();
const dbManager = new ExcelDbManager();

console.log('✅ [Server] All services initialized.');


// --- Configuration & Tasks ---
const JS_SCRAPER_SERVICE_URL = process.env.JS_SCRAPER_SERVICE_URL;
const tasks = new Map();

// --- Stable Railway Helpers ---
const isJsScraperAvailable = () => !!JS_SCRAPER_SERVICE_URL;

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

async function pollJsScraperTask(taskId, onProgress = null, maxWaitMs = 3600000) {
  const startTime = Date.now();
  const pollInterval = 3000;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 20;
  let lastProgress = 0;

  console.log(`🔄 Starting poll for Railway task: ${taskId} (timeout: ${maxWaitMs / 60000} mins)`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await axios.get(`${JS_SCRAPER_SERVICE_URL}/tasks/${taskId}`, { timeout: 10000 });
      const task = response.data;
      consecutiveErrors = 0;

      if (onProgress && task.progress) {
        onProgress(task.progress, task.stage || 'Processing...', task.brandName);
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
        console.warn(`⚠️ Task ${taskId} not found (404).`);
        throw new Error('Task not found on JS Scraper service');
      }
      consecutiveErrors++;
      console.warn(`⚠️ Poll error (${consecutiveErrors}/${maxConsecutiveErrors}): ${error.message}`);
      if (consecutiveErrors >= maxConsecutiveErrors) throw new Error(`Too many polling errors: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, Math.min(pollInterval * consecutiveErrors, 10000)));
    }
  }
  throw new Error('JS Scraper task timed out in polling loop');
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Path logger
app.use((req, res, next) => {
  if (req.url !== '/api/health') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});

// Static files
const isVercel = process.env.VERCEL === '1';
const uploadsPath = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsPath));

// Serve public directory for temp images and extracted assets
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));
app.use('/temp', express.static(path.join(publicPath, 'temp')));

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
    if (!fs_sync.existsSync(dest)) {
      fs_sync.mkdirSync(dest, { recursive: true });
    }
    cb(null, dest);
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
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg'
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xls|xlsx|pdf|png|jpg|jpeg)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel, PDF, and Image files are allowed.'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

const planUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg'
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(pdf|png|jpg|jpeg)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Image files are allowed.'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

// --- API Endpoints ---

// Health check
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    version: '2.0.2 (Cloud-Ready)',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/health', async (req, res) => {
  const diagnostics = {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: {
      supabase_url: !!process.env.SUPABASE_URL,
      supabase_key: !!process.env.SUPABASE_ANON_KEY,
      kv_url: !!process.env.KV_REST_API_URL,
      node_env: process.env.NODE_ENV
    },
    storage: {
      supabase: !!supabase,
      kv: !!kv
    }
  };

  try {
    const brands = await brandStorage.getAllBrands();
    diagnostics.storage.brands_count = brands.length;
    diagnostics.storage.status = 'healthy';
  } catch (err) {
    diagnostics.storage.status = 'degraded';
    diagnostics.storage.error = err.message;
  }

  res.json(diagnostics);
});

// Serve temporary extracted images
app.get('/api/temp-image/:id', async (req, res) => {
  const { id } = req.params;
  const { tempImageStore } = await getPdfProductExtractor();
  const imageBuffer = tempImageStore.get(id);

  if (!imageBuffer) {
    return res.status(404).send('Image not found');
  }

  res.set('Content-Type', 'image/png');
  res.send(imageBuffer);
});

// Serve lazy extracted images from background processing
app.get('/api/lazy-image/:uploadId/:page/:rowId', async (req, res) => {
  const { uploadId, page, rowId } = req.params;
  const pNum = parseInt(page);
  const rIdx = parseInt(rowId);

  console.log(`🖼️ [Lazy Image] Request for Upload: ${uploadId} | Page: ${page} | Row: ${rowId}`);

  const baseTempDir = isVercel ? '/tmp/extracted_images' : path.join(process.cwd(), 'public', 'temp', 'extracted_images');
  const tempDir = path.join(baseTempDir, uploadId);
  const imgPath = path.join(tempDir, `page_${page}_row_${rowId}.jpg`);
  const metadataPath = path.join(tempDir, 'metadata.json');
  const fullPagePath = path.join(tempDir, `page_${page}_full.png`);

  // 1. Check if it already exists
  try {
    await fs.access(imgPath);
    return res.sendFile(imgPath);
  } catch (e) {
    // Continue to extraction if missing
  }

  try {
    // 2. Check metadata
    if (!fs_sync.existsSync(metadataPath)) {
      throw new Error("Session metadata.json not found");
    }
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));

    // 3. Find row and page info
    const rowInfo = metadata.rows.find(r => r.pageNum === pNum && r.rowIdx === rIdx);
    if (!rowInfo) throw new Error(`Row ${rIdx} on P${pNum} not found in metadata`);

    const pageLayout = metadata.pages.find(p => p.page === pNum);
    if (!pageLayout) throw new Error(`Page ${pNum} layout data missing`);

    // PRIORITY STAGE: Check for Native (Layered) Image Match
    if (pageLayout.nativeImages && pageLayout.nativeImages.length > 0) {

      // Get all rows on this page sorted by rowIdx (visual order)
      const sortedPageRows = metadata.rows
        .filter(r => r.pageNum === pNum)
        .sort((a, b) => a.rowIdx - b.rowIdx);

      // Sort native images top-to-bottom by Y (same as Python now does, but double-ensure)
      const productImages = pageLayout.nativeImages
        .filter(img => img.h >= 30 && img.w >= 30)
        .sort((a, b) => a.y - b.y || a.x - b.x);

      // Find the positional rank of this row among its page peers
      const rowPositionOnPage = sortedPageRows.findIndex(r => r.rowIdx === rIdx);

      // ── Strategy 1: Perfect positional (most reliable) ──────────────────
      if (productImages.length === sortedPageRows.length && rowPositionOnPage !== -1) {
        const matchedImg = productImages[rowPositionOnPage];
        if (matchedImg) {
          console.log(`    💎 [Lazy Image] Positional match P${pNum} R${rIdx} (rank ${rowPositionOnPage}) → ${matchedImg.path}`);
          await fs.copyFile(matchedImg.path, imgPath);
          return res.sendFile(imgPath);
        }
      }

      // ── Strategy 2: Closest-unused Y-center match ────────────────────────
      if (rowPositionOnPage !== -1 && productImages.length > 0) {
        // Build a set of indices already "claimed" by earlier rows
        const claimedIndices = new Set();
        for (let rank = 0; rank < rowPositionOnPage; rank++) {
          // Simple greedy: rank-th row claims rank-th image if within tolerance
          if (rank < productImages.length) claimedIndices.add(rank);
        }

        // Find best unclaimed image for this row
        const normalize = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        const targetSN = normalize(rowInfo.sn);
        const snMatch = pageLayout.textItems.find(item => {
          const normStr = normalize(item.str);
          return normStr === targetSN && normStr.length > 0;
        });
        const anchorY = snMatch ? snMatch.y : null;

        let bestIdx = rowPositionOnPage; // Default to positional
        let bestDist = Infinity;

        for (let i = 0; i < productImages.length; i++) {
          if (claimedIndices.has(i)) continue;
          const img = productImages[i];
          const imgCenterY = img.y + img.h / 2;
          const dist = anchorY !== null
            ? Math.abs(imgCenterY - anchorY)
            : Math.abs(i - rowPositionOnPage) * 200;
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }

        if (bestIdx >= 0 && bestIdx < productImages.length) {
          const overlapImg = productImages[bestIdx];
          console.log(`    💎 [Lazy Image] Y-match P${pNum} R${rIdx} → img[${bestIdx}] dist=${Math.round(bestDist)}: ${overlapImg.path}`);
          await fs.copyFile(overlapImg.path, imgPath);
          return res.sendFile(imgPath);
        }
      }
    }

    // FALLBACK STAGE: Sharp Crop from Full Page
    // 4. On-Demand Render of the full page if missing
    if (!fs_sync.existsSync(fullPagePath)) {
      console.log(`    📸 [Lazy Image] Full page missing, rendering on-demand: ${fullPagePath}`);
      const { renderSinglePageFull } = await getPdfRenderer();
      await renderSinglePageFull(metadata.pdfPath, pNum, fullPagePath);
    }

    // ... rest of the cropping logic ...
    const normalize = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const targetSN = normalize(rowInfo.sn);

    const snMatch = pageLayout.textItems.find(item => {
      const normStr = normalize(item.str);
      const isMatch = normStr === targetSN || (targetSN && normStr.includes(targetSN));
      return isMatch && (item.x === undefined || item.x < 300);
    });

    const descPrefix = normalize(rowInfo.description || '').substring(0, 15);
    const descMatch = !snMatch && descPrefix.length > 3 ? pageLayout.textItems.find(item => {
      return normalize(item.str).includes(descPrefix);
    }) : null;

    let targetY = snMatch ? snMatch.y : (descMatch ? descMatch.y : null);
    if (targetY === null) {
      const pageRows = metadata.rows.filter(r => r.pageNum === pNum).sort((a, b) => a.rowIdx - b.rowIdx);
      const idx = pageRows.findIndex(r => r.rowIdx === rIdx);
      if (idx !== -1) targetY = 400 + (idx * 160);
      else throw new Error("Could not determine crop Y position");
    }

    let dynamicHeight = 160;
    const pageRows = metadata.rows.filter(r => r.pageNum === pNum).sort((a, b) => a.rowIdx - b.rowIdx);
    const currentIdx = pageRows.findIndex(r => r.rowIdx === rIdx);
    if (currentIdx !== -1 && currentIdx < pageRows.length - 1) {
      const nextRow = pageRows[currentIdx + 1];
      const nextSN = normalize(nextRow.sn);
      const nextMatch = pageLayout.textItems.find(it => normalize(it.str) === nextSN && (it.x === undefined || it.x < 300));
      if (nextMatch && nextMatch.y > targetY) {
        dynamicHeight = Math.min(300, (nextMatch.y - targetY) + 30);
      }
    }

    // Sharp has been removed — images are now extracted natively by mupdf in pdfProductExtractor.
    // This lazy-image route only runs in local dev; in that case the PNG was pre-extracted by pdfjs.
    // If the file doesn't exist at this point, serve a 404 instead of crashing.
    console.warn(`    ⚠️ [Lazy Image] Pre-extracted file not found for P${pNum} R${rIdx} — no crop fallback (sharp removed).`);
    return res.status(404).json({ error: 'Image not pre-extracted. Use mupdf path.' });


  } catch (err) {
    console.error(`    ❌ [Lazy Image] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/scraper-config', (req, res) => {
  res.json({
    methods: [
      { id: 'standard', name: 'Standard (Deep Gallery Scan)', description: 'Best for standard e-commerce galleries' },
      { id: 'ai', name: 'Specialized Scraper (Optimized for Architonic)', description: 'Fast, intelligent mapping for complex sites' },
      { id: 'scrapling', name: 'Scrapling Engine (Ultra High Speed)', description: 'Fastest product collection' }
    ],
    engines: [
      { id: 'railway', name: 'Railway Service (Recommended - Stable)', description: 'Cloud-based execution with proxy support' },
      { id: 'local', name: 'Local Instance (Developer / Internal)', description: 'Use your local machine resources' }
    ],
    dashboardUrl: process.env.RAILWAY_DASHBOARD_URL || (JS_SCRAPER_SERVICE_URL ? `${JS_SCRAPER_SERVICE_URL}/dashboard` : 'https://railway.app')
  });
});
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const isPdf = fileName.toLowerCase().endsWith('.pdf') || req.file.mimetype === 'application/pdf';
    const isImage = req.file.mimetype.startsWith('image/') || fileName.toLowerCase().match(/\.(png|jpg|jpeg)$/);
    const sessionId = req.headers['x-session-id'] || 'default';

    const extractionMode = req.headers['x-extraction-mode'] || 'parallel';
    const modelName = req.headers['x-model-name'];

    console.log(`[Upload] Processing: ${fileName} | Mode: ${extractionMode}${modelName ? ` | Model: ${modelName}` : ''}`);

    // Track file for cleanup
    cleanupService.trackFile(sessionId, filePath);

    let extractedData;
    if (isPdf) {
      if (isVercel) {
        console.log(`[Upload] Running in Vercel - Using light extraction (pdfjs)`);
        const { extractProductBoqFromPdf } = await getPdfProductExtractor();
        extractedData = await extractProductBoqFromPdf(filePath, () => { }, modelName);
      } else if (extractionMode === 'parallel') {
        const { extractParallelBOQData } = await getParallelBOQExtractor();
        extractedData = await extractParallelBOQData(filePath, 'application/pdf', () => { }, modelName, (file) => {
          cleanupService.trackFile(sessionId, file);
        }, (folder) => {
          cleanupService.trackFolder(sessionId, folder);
        });
      } else {
        // Legacy vision path
        const { extractVisionBOQData } = await getVisionBOQExtractor();
        extractedData = await extractVisionBOQData(filePath, 'application/pdf', () => { }, modelName, (blob) => {
          cleanupService.trackBlob(sessionId, blob);
        });
      }
    } else if (isImage) {
      // Handle images directly uploaded to BOQ flow
      const { extractVisionBOQData } = await getVisionBOQExtractor();
      extractedData = await extractVisionBOQData(filePath, req.file.mimetype, () => { }, modelName, (blob) => {
        cleanupService.trackBlob(sessionId, blob);
      });
    } else {
      // Extract data from Excel
      extractedData = await extractExcelData(filePath, () => { }, (blob) => {
        cleanupService.trackBlob(sessionId, blob);
      });
    }

    res.json({
      success: true,
      data: extractedData,
      isDirectExtraction: true,
      progress: 100,
      stage: 'Direct Extraction Complete'
    });

  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({
      error: 'Failed to process file',
      details: error.message
    });
  }
});

app.post('/api/extract/vision', planUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const sessionId = req.headers['x-session-id'] || 'default';

    console.log(`[Vision Upload] Processing: ${req.file.originalname}`);

    // Track file for cleanup
    cleanupService.trackFile(sessionId, filePath);

    const modelName = req.headers['x-model-name'];
    const { extractVisionBOQData } = await getVisionBOQExtractor();
    const extractedData = await extractVisionBOQData(filePath, req.file.mimetype, () => { }, modelName, (blob) => {
      cleanupService.trackBlob(sessionId, blob);
    });

    res.json({
      success: true,
      data: extractedData,
      progress: 100,
      stage: 'Complete'
    });

  } catch (error) {
    console.error('Error in vision extraction:', error);
    res.status(500).json({
      error: 'Failed to process file with Vision AI',
      details: error.message
    });
  }
});

// Blob Management API (for Blob Dashboard)
app.get('/api/admin/blobs', async (req, res) => {
  try {
    const blobs = await listSupabaseFiles('assets', 'manual-upload');
    res.json(blobs);
  } catch (error) {
    console.error('❌ [Asset API] List failed:', error.message);
    res.status(500).json({ error: 'Failed to list assets', details: error.message });
  }
});

app.delete('/api/admin/blobs', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const filePath = new URL(url).pathname.split('/').slice(2).join('/');
    await deleteFromSupabase('assets', filePath);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ [Asset API] Delete failed:', error.message);
    res.status(500).json({ error: 'Failed to delete asset', details: error.message });
  }
});

app.get('/api/blobs', async (req, res) => {
  try {
    const folders = ['', 'manual-upload', 'extracted-images', 'temp-uploads'];
    let allBlobs = [];

    for (const folder of folders) {
      try {
        const blobs = await listSupabaseFiles('assets', folder);
        // Filter out actual folders returned as files
        allBlobs = [...allBlobs, ...blobs.filter(b => b.id)];
      } catch (e) {
        console.warn(`⚠️ [Storage API] Could not list folder "${folder}":`, e.message);
      }
    }

    // Sort by created_at desc
    allBlobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, blobs: allBlobs });
  } catch (error) {
    console.error('❌ [Storage API] List failed:', error.message);
    res.status(500).json({ error: 'Failed to list assets', details: error.message });
  }
});

app.post('/api/blobs/delete', async (req, res) => {
  const { url, path: filePath } = req.body;
  if (!url && !filePath) return res.status(400).json({ error: 'URL or path is required' });
  try {
    if (supabase) {
      // Extract path from URL if path is not provided
      const finalPath = filePath || new URL(url).pathname.split('/').slice(2).join('/');
      await deleteFromSupabase('assets', finalPath);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('❌ [Storage API] Delete failed:', error.message);
    res.status(500).json({ error: 'Failed to delete asset', details: error.message });
  }
});

app.post('/api/blobs/upload', planUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fileBuffer = await fs.readFile(req.file.path);
    const fileName = `${Date.now()}-${req.file.originalname}`;
    let result;

    if (supabase) {
      result = await uploadToSupabase('assets', `manual-upload/${fileName}`, fileBuffer, {
        contentType: req.file.mimetype
      });
    }

    // Cleanup local temp file
    try { await fs.unlink(req.file.path); } catch (e) { }

    res.json({ success: true, blob: result });
  } catch (error) {
    console.error('❌ [Storage API] Upload failed:', error.message);
    res.status(500).json({ error: 'Failed to upload asset', details: error.message });
  }
});

// Supabase Storage Helper for Browser
app.get('/api/storage/config', (req, res) => {
  res.json({
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    bucket: 'assets'
  });
});

// Process a file that was already uploaded to Vercel Blob (Big File Processing)
app.post('/api/process-blob', async (req, res) => {
  const { url, sessionId = 'default' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    console.log(`📦 [Process-Blob] Starting extraction for: ${url}`);

    // Download the file from Blob to /tmp for processing
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const tempDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
    await fs.mkdir(tempDir, { recursive: true });

    const fileName = `large_${Date.now()}.xlsx`;
    const filePath = path.join(tempDir, fileName);
    await fs.writeFile(filePath, Buffer.from(response.data));

    // Track for cleanup
    cleanupService.trackFile(sessionId, filePath);

    // Extract (pass callback to track blobs)
    const extractedData = await extractExcelData(filePath, () => { }, (blobUrl) => {
      cleanupService.trackBlob(sessionId, blobUrl);
    });

    // (Optional) Delete the source if it was a transient upload
    if (url.includes('supabase') && url.includes('temp')) {
      // logic to delete if needed
    }

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

// Reset/Cleanup endpoint for app initialization
app.post('/api/reset', async (req, res) => {
  console.log('Resetting application state...');
  await cleanupService.cleanupAll();

  // Re-create uploads directory immediately to ensure readiness
  const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
  const imagesDir = isVercel ? '/tmp/uploads/images' : path.join(__dirname, '../uploads/images');
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(imagesDir, { recursive: true });
  } catch (e) { console.error('Error recreating dirs:', e); }

  res.json({ success: true, message: 'Environment reset complete' });
});

// Explicit session cleanup (e.g. on refresh or close)
app.post('/api/cleanup/session', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });

  console.log(`[Cleanup] Manual cleanup request for session: ${sessionId}`);
  await cleanupService.cleanupSession(sessionId);
  res.json({ success: true, message: `Cleanup initiated for session ${sessionId}` });
});

// Health check fallback for some UI integrations


// Brand Management
app.get('/api/brands', async (req, res) => {
  try {
    const brands = await brandStorage.getAllBrands();
    res.json(brands);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch brands' });
  }
});

app.post('/api/brands', async (req, res) => {
  try {
    const brand = req.body;
    if (!brand.id || !brand.name) return res.status(400).json({ error: 'Invalid brand data' });
    await brandStorage.saveBrand(brand);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save brand' });
  }
});

// Models availability

// Provide the current available model lists for frontend selection
app.get('/api/models/available', (req, res) => {
  res.json({
    google: VALID_GOOGLE_MODELS,
    openrouter: VALID_OPENROUTER_MODELS,
    nvidia: VALID_NVIDIA_MODELS,
    defaults: {
      google: GOOGLE_MODEL,
      openrouter: OPENROUTER_MODEL,
      nvidia: NVIDIA_MODEL
    }
  });
});

/**
 * 💎 AI ENRICHMENT & HARDENING ENDPOINT
 * Triggers online search and saves results permanently to the brand database.
 */
app.post('/api/models/enrich', async (req, res) => {
  const { brandName, modelName, budgetTier = 'mid' } = req.body;

  if (!brandName || !modelName) {
    return res.status(400).json({ error: 'Brand name and Model name are required' });
  }

  console.log(`🌐 [API] Enrichment request for: ${brandName} "${modelName}" (${budgetTier})`);

  try {
    const enrichment = await searchAndEnrichModel(brandName, modelName, budgetTier);

    if (enrichment.status === 'success' && enrichment.product) {
      // PERMANENTLY SAVE TO DATABASE
      const saved = await brandStorage.addProductToBrand(brandName, budgetTier, enrichment.product);

      return res.json({
        status: 'success',
        product: enrichment.product,
        hardened: saved
      });
    }

    res.status(404).json({
      status: 'error',
      message: enrichment.error_message || 'Model details not found online.'
    });
  } catch (err) {
    console.error('❌ [API] Enrichment failed:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.delete('/api/brands/:id', async (req, res) => {
  try {
    await brandStorage.deleteBrand(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete brand' });
  }
});

// Excel Export/Import for Brands
app.get('/api/brands/:id/export', async (req, res) => {
  try {
    const brand = await brandStorage.getBrandById(req.params.id);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    const workbook = await dbManager.exportToExcel(brand);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${brand.name.replace(/\s+/g, '_')}_products.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Export failed: ' + error.message });
  }
});

app.post('/api/brands/:id/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let filePath = req.file.path;
    const isXls = req.file.originalname.toLowerCase().endsWith('.xls');

    if (isXls) {
      console.log('🔄 Converting legacy .xls to .xlsx...');
      try {
        filePath = await convertXlsToXlsx(filePath);
      } catch (convErr) {
        console.error('Conversion failed, trying direct import:', convErr.message);
      }
    }

    const brand = await brandStorage.getBrandById(req.params.id);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    const importedProducts = await dbManager.importFromExcel(filePath);

    // Merge Logic: Preserve existing metadata, only update price
    const existingProducts = brand.products || [];
    const mergedProducts = [...existingProducts];
    let updatedCount = 0;
    let addedCount = 0;

    importedProducts.forEach(newP => {
      if (!newP.model) return;

      const existingIndex = mergedProducts.findIndex(p =>
        p.model && String(p.model).trim().toLowerCase() === String(newP.model).trim().toLowerCase()
      );

      if (existingIndex !== -1) {
        // Update price only, preserve everything else
        mergedProducts[existingIndex].price = newP.price;
        updatedCount++;
      } else {
        // User requested: "excel sheet purpose is only to update the price, nothing else to be changed"
        // So we skip adding new products that are not already in the database
        addedCount++;
      }
    });

    brand.products = mergedProducts;
    brand.updatedAt = new Date();

    console.log(`📊 [Import] Brand "${brand.name}" merge complete. Updated: ${updatedCount}, Skipped (New): ${addedCount}, Total Products: ${mergedProducts.length}`);

    // Ensure brand integrity before saving
    if (!brand.name || !brand.id) {
      console.error('❌ [Import] Aborting save: Brand object lost its identity during processing.');
      return res.status(500).json({ error: 'Data integrity error: Brand identity lost.' });
    }

    const saveSuccess = await brandStorage.saveBrand(brand);
    if (!saveSuccess) {
      throw new Error('Failed to save updated brand data to Supabase/Local storage.');
    }

    // Cleanup temp file
    try { await fs.unlink(req.file.path); } catch (e) { }
    if (isXls && filePath !== req.file.path) {
      try { await fs.unlink(filePath); } catch (e) { }
    }

    res.json({
      success: true,
      count: importedProducts.length,
      updatedCount,
      skippedCount: addedCount,
      brandName: brand.name
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Import failed: ' + error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// FF&E SPECIALIST AI ENDPOINT — 3-Stage Workflow
// ──────────────────────────────────────────────────────────────────────────────
//
//  Stage 1: AI (with web search) → \"Best ONE model for [desc] from [brand]?\"
//  Stage 2: Fuzzy search in local brand DB JSON for that model name
//  Stage 3: If missing or price is 0 → AI fetches full product from web → saves permanently
//
// ──────────────────────────────────────────────────────────────────────────────
function fuzzyFindModel(products, targetModelName, targetCategory = '') {
  if (!products || !Array.isArray(products) || !targetModelName) return null;

  const SYNONYMS = {
    'stool': ['chair', 'seat', 'barstool', 'bench'],
    'chair': ['stool', 'seat', 'armchair', 'sidechair'],
    'desk': ['table', 'workstation', 'bench'],
    'table': ['desk', 'workstation', 'bench'],
    'sofa': ['couch', 'bench', 'ottoman', 'pouf'],
    'cabinet': ['cupboard', 'storage', 'wardrobe']
  };

  const normalize = (s) => String(s || '')
    .toLowerCase()
    .replace(/#\d+/g, '')          // strip Architonic IDs
    .replace(/[^a-z0-9]/g, ' ')   // swap special chars for spaces
    .replace(/\s+/g, ' ')         // collapse spaces
    .trim();

  const target = normalize(targetModelName);
  if (!target) return null;

  // 1. Exact Match Check (High Efficiency)
  const exact = products.find(p => normalize(p.model) === target);
  if (exact) return exact;

  // 2. Fuse.js Implementation
  const options = {
    keys: [
      { name: 'model', weight: 2.0 },
      { name: 'mainCategory', weight: 0.3 },
      { name: 'subCategory', weight: 0.3 },
      { name: 'description', weight: 0.1 }
    ],
    threshold: 0.4, // Strictness: lower is stricter
    includeScore: true,
    ignoreLocation: true,
    findAllMatches: true,
    minMatchCharLength: 2
  };

  const fuse = new Fuse(products, options);
  let results = fuse.search(target);

  // 3. Synonym Expansion (Fallback if no strong match)
  if (results.length === 0 || results[0].score > 0.3) {
    const words = target.split(' ');
    const expandedQuery = words.map(w => {
      const syns = SYNONYMS[w] || [];
      return syns.length ? `${w} ${syns.join(' ')}` : w;
    }).join(' ');

    const synonymResults = fuse.search(expandedQuery);
    if (synonymResults.length > 0) {
      if (results.length === 0 || synonymResults[0].score < results[0].score) {
        results = synonymResults;
      }
    }
  }

  if (results.length === 0) return null;

  // 4. Category Boosting
  if (targetCategory && targetCategory.length > 2) {
    const cat = targetCategory.toLowerCase().trim();
    const catMatches = results.filter(r => {
      const mc = (r.item.mainCategory || '').toLowerCase();
      const sc = (r.item.subCategory || '').toLowerCase();
      return mc.includes(cat) || sc.includes(cat) || cat.includes(mc) || cat.includes(sc);
    });
    if (catMatches.length > 0 && catMatches[0].score < 0.5) {
      return catMatches[0].item;
    }
  }

  // 5. Final Threshold Verification
  const best = results[0];
  return best.score <= 0.45 ? best.item : null;
}


app.post('/api/auto-match-ai', async (req, res) => {
  try {
    const {
      description,
      qty,
      unit,
      tier,
      budgetTier,
      availableBrands = [],
      brand,            // single brand legacy param
      provider = 'google',
      providerModel = null,
      scope = 'Furniture', // Default to furniture
      brandCategoryRules = null // Add this parameter
    } = req.body;

    const finalTier = tier || budgetTier || 'mid';

    // ── SPECIALIZED FITOUT WORKFLOW ─────────────────────────────────────────
    if (scope?.toLowerCase().includes('fitout')) {
      console.log(`\n🏗️ [Fitout Logic] Match: "${description.substring(0, 50)}..." against internal DB...`);

      try {
        // Load the specific fitout database file
        let dbName = `fitout_v2-${finalTier}.json`;
        let dbPath = path.join(__dirname, 'data', 'brands', dbName);

        // Fallback to mid if the specific tier file is missing
        try {
          await fs.access(dbPath);
        } catch {
          dbPath = path.join(__dirname, 'data', 'brands', 'fitout_v2-mid.json');
        }

        const dbRaw = await fs.readFile(dbPath, 'utf-8');
        const dbData = JSON.parse(dbRaw);
        const internalProducts = dbData.products || [];

        // Match using specialized local matcher
        const matchResult = await matchFitoutItem(description, internalProducts, finalTier, provider, providerModel);

        if (matchResult && matchResult.status === 'success' && matchResult.product) {
          console.log(`  ✅ [Fitout Logic] Match found: ${matchResult.product.model} @ AED ${matchResult.product.price}`);
          return res.json({
            status: 'success',
            isFitout: true,
            product: {
              ...matchResult.product,
              brand: 'FitOut V2',
              brandLogo: '',
              imageUrl: matchResult.product.imageUrl || '',
              images: (matchResult.product.images || []).map(img =>
                img.startsWith('http') ? `${req.protocol}://${req.get('host')}/api/image-proxy?url=${encodeURIComponent(img)}` : img
              )
            },
            source: 'internal-fitout-db',
            identifiedModel: matchResult.product.model
          });
        }
      } catch (err) {
        console.error('  ❌ [Fitout Logic] Database error:', err.message);
      }

      // Fallback if no match found in internal DB
      return res.json({
        status: 'no_match',
        isFitout: true,
        message: 'No suitable item found in local Fitout database.'
      });
    }
    // ── END FITOUT WORKFLOW ─────────────────────────────────────────────────

    // Normalize brand candidates: support both array and single string
    const brandCandidates = Array.isArray(availableBrands)
      ? availableBrands
      : brand
        ? [brand]
        : [];

    if (!description) {
      return res.status(400).json({ status: 'error', error_message: 'Missing description' });
    }
    if (brandCandidates.length === 0) {
      return res.status(400).json({ status: 'error', error_message: 'No brands provided' });
    }

    // Build a richer description by appending size/qty context if available.
    const sizeContext = [qty && `Qty: ${qty}`, unit && `Unit: ${unit}`].filter(Boolean).join(', ');
    const enrichedDescription = sizeContext ? `${description} | ${sizeContext}` : description;

    console.log(`\n🤖 [AI AutoFill] "${enrichedDescription.substring(0, 70)}" | Tier: ${finalTier} | Brands: ${brandCandidates.join(', ')} | Provider: ${provider}`);

    // Load all local brands once (for DB lookups)
    const allLocalBrands = await brandStorage.getAllBrands();

    // ── RELAXED TIER SELECTION ──────────────────────────────────────────────────
    // We no longer block brands based on their DB tier, allowing full flexibility.
    const tierIsolatedCandidates = brandCandidates;


    if (tierIsolatedCandidates.length === 0) {
      return res.json({
        status: 'error',
        error_message: `No brands for tier "${finalTier}" were selected. Please switch to the correct tier tab.`
      });
    }

    console.log(`  ✅ [Tier Filter] Allowed brands (${finalTier}): ${tierIsolatedCandidates.join(', ')}`);
    // ── END TIER ISOLATION ─────────────────────────────────────────────────────

    // ── OPTIMIZED BRAND PROCESSING ──────────────────
    console.log(`\n  ⚡ [Optimization] Running parallel identification for ${tierIsolatedCandidates.length} brands...`);

    // 1. Run Identification (Stage 1) for ALL brands in parallel with Natural Taxonomy awareness
    const identificationPromises = tierIsolatedCandidates.map(async (candidateBrand) => {
      try {
        const dbEntry = allLocalBrands.find(b =>
          b.name.toLowerCase().trim() === candidateBrand.toLowerCase().trim()
        );
        const products = dbEntry?.products || [];
        const knownCategories = [...new Set(products.map(p => p.subCategory).filter(Boolean))];
        const modelList = products.map(p => p.model);
        const budgetTier = dbEntry?.budgetTier || 'mid';

        // Add brandCategoryRules at the end of this line
        const identity = await identifyModel(enrichedDescription, candidateBrand, provider, knownCategories, modelList, budgetTier, providerModel, brandCategoryRules);
        return { candidateBrand, identity, knownCategories };
      } catch (err) {
        return { candidateBrand, identity: { status: 'error' }, knownCategories: [] };
      }
    });

    const identificationResults = await Promise.all(identificationPromises);
    const validIdentities = identificationResults.filter(r =>
      r.identity.status === 'success' && r.identity.model && r.identity.model !== 'FAILED'
    );

    if (validIdentities.length === 0) {
      console.warn(`  ℹ️ [AutoFill] No brands matched at Stage 1 for: "${description}"`);
      return res.json({
        status: 'no_match',
        message: `Could not identify a matching product from current candidate brands.`
      });
    }

    // 2. Sequential Processing of Validated Identities (Prioritizing Order)
    for (const { candidateBrand, identity, knownCategories } of validIdentities) {
      const identifiedModel = identity.model.trim();
      const identifiedBrand = identity.brand || candidateBrand;
      const identifiedCategory = identity.mainCategory || '';
      const identifiedSubCategory = identity.subCategory || '';

      console.log(`\n  🎯 [Processing] ${identifiedBrand} → "${identifiedModel}" (Nat. Cat: ${identifiedSubCategory})`);

      // ── STAGE 2: LOCAL DB SEARCH (Zero-Cost Cache) ──
      console.log(`  📂 [Stage 2] Searching verified local DB cache for "${identifiedModel}"...`);
      const brandMatches = allLocalBrands.filter(b =>
        b.name.toLowerCase().trim() === identifiedBrand.toLowerCase().trim()
      );
      const localBrand = brandMatches.find(b => (b.budgetTier || 'mid').toLowerCase() === finalTier.toLowerCase()) || brandMatches[0];

      if (localBrand && localBrand.products?.length > 0) {
        const dbProduct = fuzzyFindModel(localBrand.products, identifiedModel, identifiedCategory);

        if (dbProduct) {
          console.log(`  ✨ [Stage 2] CACHE HIT: "${dbProduct.model}" loaded from local DB.`);
          return res.json({
            status: 'success',
            product: { ...dbProduct, brand: identifiedBrand, brandLogo: localBrand.logo || '' },
            source: 'local-database',
            identifiedModel
          });
        }
        console.log(`  📂 [Stage 2] Miss: No validated local entry for "${identifiedModel}".`);
      }

      // ── STAGE 3: DEEP SEARCH (Web Discovery) ─────
      console.log(`  🌐 [Stage 3] Deep Discovery Engine engaged: searching live web for ${identifiedBrand} ${identifiedModel}...`);
      const webResult = await fetchProductDetails(identifiedBrand, identifiedModel, finalTier, provider, providerModel);

      if (webResult.status === 'success' && webResult.product) {
        const newProduct = {
          ...webResult.product,
          brand: identifiedBrand,
          mainCategory: webResult.product.mainCategory || identifiedCategory || 'Furniture',
          lastUpdated: new Date().toISOString(),
          source: 'AI-Discovery-Engine'
        };

        // Validate imageUrl
        const rawImg = newProduct.imageUrl || '';
        const isValidImage = rawImg.startsWith('https://') && !rawImg.includes('localhost') && /\.(jpg|jpeg|png|webp|svg)(\?|$)/i.test(rawImg);
        if (!isValidImage) {
          newProduct.imageUrl = localBrand?.logo || '';
        }

        // Persist to local DB permanently
        try {
          if (localBrand) {
            console.log(`  💾 [Stage 3] Permanently adding "${newProduct.model}" to ${identifiedBrand}...`);
            await brandStorage.addProductToBrand(identifiedBrand, localBrand.budgetTier || finalTier, newProduct);
          } else {
            console.log(`  💾 [Stage 3] Creating NEW brand "${identifiedBrand}" for permanence...`);
            const newBrand = {
              id: Date.now(),
              name: identifiedBrand,
              logo: '',
              budgetTier: finalTier,
              origin: 'AI-Discovery',
              products: [newProduct],
              createdAt: new Date().toISOString()
            };
            await brandStorage.saveBrand(newBrand);
          }
        } catch (saveErr) {
          console.error(`  ⚠️  [Stage 3] Persistence failed:`, saveErr.message);
        }

        const proxyBase = `${req.protocol}://${req.get('host')}/api/image-proxy?url=`;
        newProduct.imageUrl = `${proxyBase}${encodeURIComponent(newProduct.imageUrl)}`;
        if (newProduct.images && Array.isArray(newProduct.images)) {
          newProduct.images = newProduct.images.map(img => `${proxyBase}${encodeURIComponent(img)}`);
        }

        return res.json({
          status: 'success',
          product: { ...newProduct, brandLogo: localBrand?.logo || '' },
          source: 'ai-discovery-hardened',
          identifiedModel
        });
      }
      console.warn(`  ❌ [Stage 3] Web fetch failed for ${identifiedBrand}.`);
    }

    // All brands exhausted
    console.warn(`  ℹ️ [AutoFill] No match found across all brands for: "${description}"`);
    return res.json({
      status: 'no_match',
      message: `Could not identify a matching product from current candidate brands.`
    });
  } catch (error) {
    console.error('🔥 [AI Endpoint Error]:', error.message, error.stack);
    res.status(500).json({ status: 'error', error_message: error.message });
  }
});

/**
 * 🐝 SWARM MATCHING ENDPOINT
 * Handles batch processing of multiple items for a single brand using parallel agents.
 */
app.post('/api/auto-match-swarm', async (req, res) => {
  try {
    const {
      items, // Array of { description, qty, unit, id }
      brand,
      provider = 'google',
      providerModel = null,
      scope = 'Furniture'
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', error_message: 'Missing or invalid items array' });
    }

    if (!brand) {
      return res.status(400).json({ status: 'error', error_message: 'Missing brand' });
    }

    console.log(`\n🐝 [Swarm Match] Starting swarm for ${items.length} items | Brand: ${brand} | Provider: ${provider}`);

    // Load brand data for context
    const allLocalBrands = await brandStorage.getAllBrands();
    const dbEntry = allLocalBrands.find(b => b.name.toLowerCase().trim() === brand.toLowerCase().trim());
    const products = dbEntry?.products || [];
    const knownCategories = [...new Set(products.map(p => p.subCategory).filter(Boolean))];
    const modelList = products.map(p => p.model);
    const budgetTier = dbEntry?.budgetTier || 'mid';

    // Call the swarm function from llmUtils
    const swarmResult = await autoMatchSingleBrand(
      items,
      brand,
      {
        provider,
        providerModel,
        tier: budgetTier,
        knownCategories,
        modelList
      }
    );

    if (swarmResult.status !== 'success') {
      throw new Error(swarmResult.error_message || 'Swarm matching failed');
    }

    // Map results back to original items and attach product data if found
    const matches = swarmResult.matches || [];
    const finalResults = items.map(item => {
      const match = matches.find(r => r.id === item.id);
      if (match && match.status === 'success' && match.model) {
        // Find full product data from local DB
        const product = fuzzyFindModel(products, match.model, match.mainCategory || '');
        if (product) {
          return {
            originalId: item.id,
            status: 'success',
            product: {
              ...product,
              brand: brand,
              brandLogo: dbEntry?.logo || '',
              images: (product.images || []).map(img =>
                img.startsWith('http') ? `${req.protocol}://${req.get('host')}/api/image-proxy?url=${encodeURIComponent(img)}` : img
              )
            },
            identifiedModel: match.model,
            logic: match.logic
          };
        }
      }
      return { originalId: item.id, status: 'no_match' };
    });

    res.json({ status: 'success', results: finalResults });
  } catch (err) {
    console.error('❌ [Swarm Match] Error:', err);
    res.status(500).json({ status: 'error', error_message: err.message });
  }
});

/**
 * 🐝 MULTI-BRAND SWARM MATCHING ENDPOINT
 * Handles batch processing of multiple items against multiple brands using parallel agents.
 */
app.post('/api/auto-match-multi-swarm', async (req, res) => {
  try {
    const {
      items, // Array of { description, qty, unit, id }
      availableBrands,
      provider = 'google',
      providerModel = null,
      tier = 'mid'
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', error_message: 'Missing or invalid items array' });
    }

    if (!availableBrands || !Array.isArray(availableBrands) || availableBrands.length === 0) {
      return res.status(400).json({ status: 'error', error_message: 'No brands provided' });
    }

    console.log(`\n🐝 [Multi-Swarm Match] Starting swarm for ${items.length} items | Brands: ${availableBrands.join(', ')} | Provider: ${provider}`);

    // Call the multi-brand swarm function from llmUtils
    const swarmResult = await autoMatchMultiBrand(
      items,
      availableBrands,
      {
        provider,
        providerModel,
        tier
      }
    );

    if (swarmResult.status !== 'success') {
      throw new Error(swarmResult.error_message || 'Multi-Swarm matching failed');
    }

    // Map results back to original items and attach product data if found
    const allLocalBrands = await brandStorage.getAllBrands();
    const matches = swarmResult.matches || [];

    const finalResults = items.map(item => {
      const match = matches.find(r => r.id === item.id);
      if (match && match.status === 'success' && match.model) {
        const matchedBrandName = match.brand;
        const dbEntry = allLocalBrands.find(b => b.name.toLowerCase().trim() === matchedBrandName.toLowerCase().trim());
        const products = dbEntry?.products || [];
        const product = products.find(p => p.model.toLowerCase() === match.model.toLowerCase());

        if (product) {
          return {
            originalId: item.id,
            status: 'success',
            product: {
              ...product,
              brand: matchedBrandName,
              brandLogo: dbEntry?.logo || '',
              images: (product.images || []).map(img =>
                img.startsWith('http') ? `${req.protocol}://${req.get('host')}/api/image-proxy?url=${encodeURIComponent(img)}` : img
              )
            },
            identifiedModel: match.model,
            logic: match.logic
          };
        }
      }
      return { originalId: item.id, status: 'no_match' };
    });

    res.json({ status: 'success', results: finalResults });
  } catch (err) {
    console.error('❌ [Multi-Swarm Match] Error:', err);
    res.status(500).json({ status: 'error', error_message: err.message });
  }
});



// ─────────────────────────────────────────────────────────────────────────────
// VALUE ENGINEERED OFFER — Dedicated AI Matching Endpoint
// Bypasses tier isolation; uses the exact VE prompt spec:
//   Option 1 (simple)  : "What is the best Model for [desc] from [brand]?"
//   Option 2 (advanced) : "What is the best Model for [desc] from [category] from [brand]?"
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/ve-route', async (req, res) => {
  try {
    const { items, providerModel } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ status: 'error', error_message: 'Items array is required' });
    }

    const result = await veRouteCategories(items, providerModel);
    res.json({ status: 'success', categoryMap: result });
  } catch (error) {
    console.error('[VE Route Error]:', error.message);
    res.status(500).json({ status: 'error', error_message: error.message });
  }
});

app.post('/api/ve-match', async (req, res) => {
  try {
    const {
      description,
      qty,
      unit,
      brand,          // Required: selected brand name
      category,       // Optional: category label for Option 2 (Advanced)
      providerModel = null
    } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ status: 'error', error_message: 'Missing item description' });
    }
    if (!brand || !brand.trim()) {
      return res.status(400).json({ status: 'error', error_message: 'Missing brand name' });
    }

    // Enrich description with qty/unit context (same as auto-match-ai)
    const sizeContext = [qty && `Qty: ${qty}`, unit && `Unit: ${unit}`].filter(Boolean).join(', ');
    const enrichedDesc = sizeContext ? `${description} | ${sizeContext}` : description;

    // 🏗️ FITOUT BRAND ISOLATION ROUTING
    if (brand && (brand.toLowerCase().trim() === 'fitout v2' || brand.toLowerCase().includes('fitout'))) {
      console.log(`\n🏗️ [VE Fitout Interceptor] Selected brand is fitout! Routing "${description}" to internal Fitout DB...`);
      try {
        const requestedTier = (req.body.tier || req.body.budgetTier || 'mid').toLowerCase().trim();
        let dbName = 'fitout_v2-mid.json';
        if (requestedTier === 'budget' || requestedTier === 'budgetary') {
          dbName = 'fitout_v2-budgetary.json';
        } else if (requestedTier === 'high' || requestedTier === 'premium') {
          dbName = 'fitout_v2-high.json';
        }
        
        const dbPath = path.join(__dirname, 'data', 'brands', dbName);
        console.log(`  🔍 [VE Fitout] Loading local database: ${dbPath}`);
        const dbRaw = await fs.readFile(dbPath, 'utf-8');
        const dbData = JSON.parse(dbRaw);
        const internalProducts = dbData.products || [];

        const matchResult = await matchFitoutItem(enrichedDesc, internalProducts, dbName.replace('fitout_v2-', '').replace('.json', ''), 'google', providerModel);
        if (matchResult && matchResult.status === 'success' && matchResult.product) {
          const p = matchResult.product;
          
          const rawMain = p.mainCategory || p.category || 'Partition Wall';
          const rawSub = p.subCategory || 'full height partition wall';

          const mainCat = Object.keys(TAXONOMY).find(c => c.toLowerCase() === rawMain.toLowerCase()) || 'Partition Wall';
          const subCats = TAXONOMY[mainCat] ? Object.keys(TAXONOMY[mainCat]) : [];
          const subCat = subCats.find(s => s.toLowerCase() === rawSub.toLowerCase()) || (subCats[0] || 'full height partition wall');

          console.log(`  ✨ [VE Fitout Success] Found internal match: "${p.model}" (Normalized Category: ${mainCat} / ${subCat})`);
          
          const proxyBase = `${req.protocol}://${req.get('host')}/api/image-proxy?url=`;
          if (p.imageUrl && p.imageUrl.startsWith('https://') && !p.imageUrl.includes('image-proxy')) {
            p.imageUrl = `${proxyBase}${encodeURIComponent(p.imageUrl)}`;
          }
          if (p.images && Array.isArray(p.images)) {
            p.images = p.images.map(img => img.startsWith('https://') && !img.includes('image-proxy') ? `${proxyBase}${encodeURIComponent(img)}` : img);
          }

          return res.json({
            status: 'success',
            product: {
              ...p,
              brand: 'FitOut V2',
              brandLogo: '',
              mainCategory: mainCat,
              subCategory: subCat
            },
            source: 'local-database',
            identifiedModel: p.model
          });
        } else {
          console.log(`  ⚠️ [VE Fitout] No match returned by matchFitoutItem. Falling back.`);
        }
      } catch (fitoutErr) {
        console.error('  ❌ [VE Fitout Interceptor Error]:', fitoutErr.message);
      }
    }

    // Build catalog hint from local DB (cache-boost — no blocking)
    const allLocalBrands = await brandStorage.getAllBrands();
    const localBrand = allLocalBrands.find(b => b.name.toLowerCase().trim() === brand.toLowerCase().trim());
    const modelList = localBrand?.products?.map(p => p.model).filter(Boolean) || [];

    let identityResult;

    if (category && category.trim()) {
      // ── OPTION 2: Advanced Categorical Scope ─────────────────────────────
      console.log(`\n🔷 [VE Endpoint] Option 2 (Advanced) | Brand: ${brand} | Category: ${category}`);
      identityResult = await veMatchAdvanced(enrichedDesc, brand, category, modelList, providerModel);
    } else {
      // ── OPTION 1: Simple Global Brand Scope ──────────────────────────────
      console.log(`\n🔷 [VE Endpoint] Option 1 (Simple) | Brand: ${brand}`);
      identityResult = await veMatchSimple(enrichedDesc, brand, modelList, providerModel);
    }

    if (identityResult.status !== 'success' || !identityResult.model) {
      return res.json({
        status: 'no_match',
        message: `AI could not identify a model for "${brand}"${category ? ` [${category}]` : ''}.`
      });
    }

    const identifiedModel = identityResult.model.trim();
    const identifiedBrand = identityResult.brand || brand;
    const identifiedCategory = identityResult.mainCategory || category || '';

    console.log(`  🎯 [VE Endpoint] Identified: ${identifiedBrand} → "${identifiedModel}"`);

    // ── STAGE 2: LOCAL DB CACHE LOOKUP (Zero-Cost) ──────────────────────────
    if (localBrand?.products?.length > 0) {
      console.log(`  🔍 [VE Stage 2] Searching for "${identifiedModel}" in local cache (Category Hint: ${identifiedCategory})...`);

      const best = fuzzyFindModel(localBrand.products, identifiedModel, identifiedCategory);

      if (best) {
        console.log(`  ✨ [VE Cache Hit] "${best.model}" loaded from local DB.`);
        return res.json({
          status: 'success',
          product: {
            ...best,
            brand: identifiedBrand,
            brandLogo: localBrand.logo || '',
            mainCategory: best.mainCategory || identifiedCategory
          },
          source: 'local-database',
          identifiedModel
        });
      }
      console.log(`  📂 [VE Stage 2] Miss: No local entry for "${identifiedModel}".`);
    }

    // ── STAGE 3: WEB DISCOVERY (Deep Product Details) ───────────────────────
    console.log(`  🌐 [VE Stage 3] Fetching live details for ${identifiedBrand} ${identifiedModel}...`);
    const detailResult = await veGetProductDetails(identifiedBrand, identifiedModel, providerModel);

    if (detailResult.status === 'success' && detailResult.product) {
      const p = detailResult.product;

      // Validate image URL
      const rawImg = p.imageUrl || '';
      const isValidImage = rawImg.startsWith('https://') && !rawImg.includes('localhost') && /\.(jpg|jpeg|png|webp|svg)(\?|$)/i.test(rawImg);
      if (!isValidImage) {
        p.imageUrl = localBrand?.logo || '';
      }

      // Persist to local DB (optional — non-blocking)
      try {
        const newProduct = {
          ...p,
          brand: identifiedBrand,
          mainCategory: identifiedCategory || 'Furniture',
          lastUpdated: new Date().toISOString(),
          source: 'VE-AI-Discovery'
        };
        if (localBrand) {
          await brandStorage.addProductToBrand(identifiedBrand, localBrand.budgetTier || 'mid', newProduct);
        } else {
          await brandStorage.saveBrand({
            id: Date.now(),
            name: identifiedBrand,
            logo: '',
            budgetTier: 'mid',
            origin: 'VE-Discovery',
            products: [newProduct],
            createdAt: new Date().toISOString()
          });
        }
      } catch (saveErr) {
        console.warn(`  ⚠️  [VE Stage 3] Persistence failed (non-fatal):`, saveErr.message);
      }

      // Proxy image URLs
      const proxyBase = `${req.protocol}://${req.get('host')}/api/image-proxy?url=`;
      if (p.imageUrl) p.imageUrl = `${proxyBase}${encodeURIComponent(p.imageUrl)}`;
      if (p.images && Array.isArray(p.images)) {
        p.images = p.images.map(img => `${proxyBase}${encodeURIComponent(img)}`);
      }

      return res.json({
        status: 'success',
        product: {
          ...p,
          brand: identifiedBrand,
          brandLogo: localBrand?.logo || '',
          mainCategory: identifiedCategory
        },
        source: 've-ai-discovery',
        identifiedModel
      });
    }

    // Stage 3 failed — return identity result without image
    console.warn(`  ⚠️  [VE Stage 3] Detail fetch failed. Returning identity-only result.`);
    return res.json({
      status: 'success',
      product: {
        brand: identifiedBrand,
        model: identifiedModel,
        mainCategory: identifiedCategory,
        imageUrl: localBrand?.logo || '',
        brandLogo: localBrand?.logo || '',
        price: 0,
        description: identityResult.logic || ''
      },
      source: 've-identity-only',
      identifiedModel
    });

  } catch (error) {
    console.error('🔥 [VE Endpoint Error]:', error.message, error.stack);
    res.status(500).json({ status: 'error', error_message: error.message });
  }
});

/**
 * Resolves identified brands to their canonical existing name to prevent duplicate brand files,
 * model-to-brand hallucinations (e.g. "Nova Wood" -> "Narbutas"), and minor spelling variants.
 */
function resolveCanonicalBrand(identifiedBrand, identifiedModel, allLocalBrands) {
  if (!identifiedBrand) return { brand: 'Generic', brandObj: null, isNew: false };

  const idBrandLower = identifiedBrand.toLowerCase().trim();
  const idModelLower = (identifiedModel || '').toLowerCase().trim();

  // 1. Manual mapping rule for models or variants mistaken as brand names
  const manualModelToBrand = {
    'nova wood': 'NARBUTAS',
    'nova': 'NARBUTAS',
    'sedus': 'Sedus Stoll',
    'sedus stoll': 'Sedus Stoll',
    'narbutas': 'NARBUTAS'
  };

  if (manualModelToBrand[idBrandLower]) {
    const canonicalName = manualModelToBrand[idBrandLower];
    const matched = allLocalBrands.find(b => b.name.toLowerCase().trim() === canonicalName.toLowerCase().trim());
    if (matched) {
      console.log(`🎯 [VE Brand Resolver] Mapped variant/model "${identifiedBrand}" to canonical brand "${matched.name}" via manual rules.`);
      return { brand: matched.name, brandObj: matched, isNew: false };
    }
  }

  // 2. Exact match check
  let matched = allLocalBrands.find(b => b.name.toLowerCase().trim() === idBrandLower);
  if (matched) {
    return { brand: matched.name, brandObj: matched, isNew: false };
  }

  // 3. Substring match (e.g., "Sedus" matches "Sedus Stoll")
  matched = allLocalBrands.find(b => {
    const existingLower = b.name.toLowerCase().trim();
    return existingLower.includes(idBrandLower) || idBrandLower.includes(existingLower);
  });
  if (matched) {
    console.log(`🎯 [VE Brand Resolver] Substring match: mapped "${identifiedBrand}" to "${matched.name}".`);
    return { brand: matched.name, brandObj: matched, isNew: false };
  }

  // 4. Reverse Lookup: check if the identified brand is actually a model name inside an existing brand!
  const genericWords = ['desk', 'chair', 'table', 'sofa', 'stool', 'light', 'wood', 'glass', 'metal'];
  if (idBrandLower.length >= 4 && !genericWords.includes(idBrandLower)) {
    for (const b of allLocalBrands) {
      if (b.products && Array.isArray(b.products)) {
        const modelMatch = b.products.some(p => {
          const pModelLower = (p.model || '').toLowerCase().trim();
          return pModelLower.startsWith(idBrandLower) || pModelLower.includes(idBrandLower);
        });
        if (modelMatch) {
          console.log(`🎯 [VE Brand Resolver] Prevented brand creation! Resolved model-as-brand "${identifiedBrand}" to parent brand "${b.name}".`);
          return { brand: b.name, brandObj: b, isNew: false };
        }
      }
    }
  }

  // 5. Completely new brand
  return { brand: identifiedBrand, brandObj: null, isNew: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE ENGINEERED OFFER — Dedicated Auto-Detect API Endpoints
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/ve-match-auto', async (req, res) => {
  try {
    const {
      description,
      qty,
      unit,
      providerModel = null,
      imageUrl = null
    } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ status: 'error', error_message: 'Missing item description' });
    }

    // Enrich description with qty/unit context (same as auto-match-ai)
    const sizeContext = [qty && `Qty: ${qty}`, unit && `Unit: ${unit}`].filter(Boolean).join(', ');
    const enrichedDesc = sizeContext ? `${description} | ${sizeContext}` : description;

    // Fetch image if provided for Multimodal support
    let assets = [];
    if (imageUrl) {
      try {
        console.log(`\n📸 [VE Auto-Detect Endpoint] Fetching image from: ${imageUrl}`);
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(response.data, 'binary').toString('base64');

        // STRICT MIME Type verification for Google AI 400 bad request prevention
        let mimeType = 'image/jpeg'; // Default safe fallback
        const contentType = response.headers['content-type'];
        if (contentType && contentType.startsWith('image/')) {
          mimeType = contentType;
        } else {
          const lowerUrl = imageUrl.toLowerCase();
          if (lowerUrl.includes('.png')) mimeType = 'image/png';
          else if (lowerUrl.includes('.webp')) mimeType = 'image/webp';
          else if (lowerUrl.includes('.gif')) mimeType = 'image/gif';
        }

        assets.push({
          inlineData: {
            data: base64Image,
            mimeType: mimeType
          }
        });
      } catch (imageErr) {
        console.error(`⚠️ [VE Auto-Detect Endpoint] Failed to fetch image: ${imageErr.message}`);
        // Proceed without image if fetch fails
      }
    }

    // Load all local brands to use LATER for caching
    const allLocalBrands = await brandStorage.getAllBrands();

    console.log(`\n🔷 [VE Auto-Detect Endpoint] Model Matching (No Catalog Payload to save tokens & RPM)`);
    const identityResult = await veMatchAuto(enrichedDesc, providerModel, assets);

    if (identityResult.status !== 'success' || !identityResult.model || !identityResult.brand) {
      return res.json({
        status: 'no_match',
        message: `AI could not automatically detect any brand or model from description.`
      });
    }

    const identifiedModel = identityResult.model.trim();
    const identifiedBrand = identityResult.brand.trim();
    const identifiedCategory = identityResult.mainCategory ? identityResult.mainCategory.trim() : '';
    const identifiedSubCategory = identityResult.subCategory ? identityResult.subCategory.trim() : '';

    // Resolve the canonical brand to prevent duplicate brand files, model-to-brand hallucinations, etc.
    const resolvedBrand = resolveCanonicalBrand(identifiedBrand, identifiedModel, allLocalBrands);
    const canonicalBrand = resolvedBrand.brand;
    const localBrand = resolvedBrand.brandObj;

    console.log(`  🎯 [VE Auto-Detect Endpoint] Detected: ${identifiedBrand} (Canonical: ${canonicalBrand}) → "${identifiedModel}" (Category: ${identifiedCategory} / ${identifiedSubCategory})`);

    // 🛑 GENERIC CACHE POISONING BLOCKER
    const isGenericBrand = !canonicalBrand || ['generic', 'not specified', 'unknown'].includes(canonicalBrand.toLowerCase());

    if (isGenericBrand) {
      console.log(`  🛑 [VE Auto-Detect] Intercepted Generic brand. Bypassing local cache and web search.`);
      return res.json({
        status: 'success',
        product: {
          brand: 'Generic',
          model: identifiedModel || 'Custom Specification',
          mainCategory: identifiedCategory || 'Furniture',
          subCategory: identifiedSubCategory || '',
          logic: identityResult.logic || 'Unbranded or custom item.'
        },
        source: 'llm-direct',
        identifiedModel: identifiedModel || 'Custom Specification'
      });
    }

    // 🏗️ FITOUT BRAND ISOLATION FOR AUTO-DETECT
    if (canonicalBrand && (canonicalBrand.toLowerCase().trim() === 'fitout v2' || canonicalBrand.toLowerCase().includes('fitout'))) {
      console.log(`\n🏗️ [VE Auto-Detect Fitout Interceptor] Identified brand is fitout! Routing "${description}" to internal Fitout DB...`);
      try {
        const requestedTier = (req.body.tier || req.body.budgetTier || 'mid').toLowerCase().trim();
        let dbName = 'fitout_v2-mid.json';
        if (requestedTier === 'budget' || requestedTier === 'budgetary') {
          dbName = 'fitout_v2-budgetary.json';
        } else if (requestedTier === 'high' || requestedTier === 'premium') {
          dbName = 'fitout_v2-high.json';
        }
        
        const dbPath = path.join(__dirname, 'data', 'brands', dbName);
        console.log(`  🔍 [VE Auto-Detect Fitout] Loading local database: ${dbPath}`);
        const dbRaw = await fs.readFile(dbPath, 'utf-8');
        const dbData = JSON.parse(dbRaw);
        const internalProducts = dbData.products || [];

        const matchResult = await matchFitoutItem(enrichedDesc, internalProducts, dbName.replace('fitout_v2-', '').replace('.json', ''), 'google', providerModel);
        if (matchResult && matchResult.status === 'success' && matchResult.product) {
          const p = matchResult.product;
          
          const rawMain = p.mainCategory || p.category || 'Partition Wall';
          const rawSub = p.subCategory || 'full height partition wall';

          const mainCat = Object.keys(TAXONOMY).find(c => c.toLowerCase() === rawMain.toLowerCase()) || 'Partition Wall';
          const subCats = TAXONOMY[mainCat] ? Object.keys(TAXONOMY[mainCat]) : [];
          const subCat = subCats.find(s => s.toLowerCase() === rawSub.toLowerCase()) || (subCats[0] || 'full height partition wall');

          console.log(`  ✨ [VE Auto-Detect Fitout Success] Found internal match: "${p.model}" (Normalized Category: ${mainCat} / ${subCat})`);
          
          const proxyBase = `${req.protocol}://${req.get('host')}/api/image-proxy?url=`;
          if (p.imageUrl && p.imageUrl.startsWith('https://') && !p.imageUrl.includes('image-proxy')) {
            p.imageUrl = `${proxyBase}${encodeURIComponent(p.imageUrl)}`;
          }
          if (p.images && Array.isArray(p.images)) {
            p.images = p.images.map(img => img.startsWith('https://') && !img.includes('image-proxy') ? `${proxyBase}${encodeURIComponent(img)}` : img);
          }

          return res.json({
            status: 'success',
            product: {
              ...p,
              brand: 'FitOut V2',
              brandLogo: '',
              mainCategory: mainCat,
              subCategory: subCat
            },
            source: 'local-database',
            identifiedModel: p.model
          });
        }
      } catch (fitoutErr) {
        console.error('  ❌ [VE Auto-Detect Fitout Interceptor Error]:', fitoutErr.message);
      }
    }

    // ── STAGE 2: LOCAL DB CACHE LOOKUP (Zero-Cost) ──────────────────────────
    if (localBrand && localBrand.products && localBrand.products.length > 0) {
      console.log(`  🔍 [VE Auto-Detect Stage 2] Searching for "${identifiedModel}" in local cache (Brand: ${canonicalBrand}, Category Hint: ${identifiedCategory})...`);
      
      // STAGE 2.5: Precise Match using actual models
      const modelList = localBrand.products.map(p => p.model);
      const matchResult = await veMatchSimple(enrichedDesc, canonicalBrand, modelList, providerModel);
      let best = null;

      if (matchResult && matchResult.status === 'success' && matchResult.model) {
        best = localBrand.products.find(p => p.model.toLowerCase() === matchResult.model.toLowerCase());
        if (best) {
            console.log(`  🧠 [VE Auto-Detect Stage 2.5] veMatchSimple accurately selected: "${best.model}"`);
        }
      }

      // Fallback to fuzzyFindModel if veMatchSimple fails or doesn't find a perfect match
      if (!best) {
        best = fuzzyFindModel(localBrand.products, identifiedModel, identifiedCategory);
      }

      if (best) {
        console.log(`  ✨ [VE Auto-Detect Cache Hit] "${best.model}" loaded from local DB.`);
        // Proxy images if necessary
        const proxyBase = `${req.protocol}://${req.get('host')}/api/image-proxy?url=`;
        const p = { ...best };
        if (p.imageUrl && p.imageUrl.startsWith('https://') && !p.imageUrl.includes('image-proxy')) {
          p.imageUrl = `${proxyBase}${encodeURIComponent(p.imageUrl)}`;
        }
        if (p.images && Array.isArray(p.images)) {
          p.images = p.images.map(img => img.startsWith('https://') && !img.includes('image-proxy') ? `${proxyBase}${encodeURIComponent(img)}` : img);
        }

        return res.json({
          status: 'success',
          product: {
            ...p,
            brand: canonicalBrand,
            brandLogo: localBrand.logo || '',
            mainCategory: best.mainCategory || identifiedCategory || 'Furniture',
            subCategory: best.subCategory || identifiedSubCategory || ''
          },
          source: 'local-database',
          identifiedModel
        });
      }
      console.log(`  📂 [VE Auto-Detect Stage 2] Miss: No local entry for "${identifiedModel}".`);
    }

    // ── STAGE 3: WEB DISCOVERY (Deep Product Details) ───────────────────────
    console.log(`  🌐 [VE Auto-Detect Stage 3] Fetching live details for ${canonicalBrand} ${identifiedModel}...`);
    const detailResult = await veGetProductDetails(canonicalBrand, identifiedModel, providerModel);

    if (detailResult.status === 'success' && detailResult.product) {
      const p = detailResult.product;

      // Validate image URL
      const rawImg = p.imageUrl || '';
      const isValidImage = rawImg.startsWith('https://') && !rawImg.includes('localhost') && /\.(jpg|jpeg|png|webp|svg)(\?|$)/i.test(rawImg);
      if (!isValidImage) {
        p.imageUrl = localBrand?.logo || '';
      }

      // Persist to local DB (optional — non-blocking)
      try {
        const newProduct = {
          ...p,
          brand: canonicalBrand,
          mainCategory: p.mainCategory || identifiedCategory || 'Furniture',
          subCategory: p.subCategory || identifiedSubCategory || '',
          lastUpdated: new Date().toISOString(),
          source: 'VE-AI-AutoDetect-Discovery'
        };
        if (localBrand) {
          await brandStorage.addProductToBrand(canonicalBrand, localBrand.budgetTier || 'mid', newProduct);
        } else {
          await brandStorage.saveBrand({
            id: Date.now(),
            name: canonicalBrand,
            logo: '',
            budgetTier: 'mid',
            origin: 'VE-AutoDetect-Discovery',
            products: [newProduct],
            createdAt: new Date().toISOString()
          });
        }
      } catch (saveErr) {
        console.warn(`  ⚠️  [VE Auto-Detect Stage 3] Persistence failed (non-fatal):`, saveErr.message);
      }

      // Proxy image URLs
      const proxyBase = `${req.protocol}://${req.get('host')}/api/image-proxy?url=`;
      if (p.imageUrl) p.imageUrl = `${proxyBase}${encodeURIComponent(p.imageUrl)}`;
      if (p.images && Array.isArray(p.images)) {
        p.images = p.images.map(img => `${proxyBase}${encodeURIComponent(img)}`);
      }

      return res.json({
        status: 'success',
        product: {
          ...p,
          brand: canonicalBrand,
          brandLogo: localBrand?.logo || '',
          mainCategory: p.mainCategory || identifiedCategory || 'Furniture',
          subCategory: p.subCategory || identifiedSubCategory || ''
        },
        source: 've-ai-discovery',
        identifiedModel
      });
    }

    // Stage 3 failed — return identity result without image
    console.warn(`  ⚠️  [VE Auto-Detect Stage 3] Detail fetch failed. Returning identity-only result.`);
    return res.json({
      status: 'success',
      product: {
        brand: canonicalBrand,
        model: identifiedModel,
        mainCategory: identifiedCategory || 'Furniture',
        subCategory: identifiedSubCategory || '',
        imageUrl: localBrand?.logo || '',
        brandLogo: localBrand?.logo || '',
        price: 0,
        description: identityResult.logic || ''
      },
      source: 've-identity-only',
      identifiedModel
    });

  } catch (error) {
    console.error('🔥 [VE Auto-Detect Endpoint Error]:', error.message, error.stack);
    res.status(500).json({
      status: 'error',
      error_message: error.message,
      rawResponse: error.rawResponse || null
    });
  }
});


// --- Scraper Task Management ---
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
    return res.json({ success: true, message: 'Task cancelled' });
  }
  res.status(404).json({ error: 'Task not found' });
});

// --- Railway Cloud Recovery ---
app.get('/api/railway-brands', async (req, res) => {
  if (!JS_SCRAPER_SERVICE_URL) {
    console.warn('⚠️ JS_SCRAPER_SERVICE_URL not set');
    return res.json({ brands: [], warning: 'Service URL not configured' });
  }
  try {
    const url = `${JS_SCRAPER_SERVICE_URL}/brands`;
    console.log(`📡 Proxying fetch to: ${url}`);
    const response = await axios.get(url, { timeout: 10000 });
    res.json(response.data);
  } catch (error) {
    console.error('❌ Failed to fetch from Railway:', error.message);
    res.status(500).json({
      brands: [],
      error: error.message,
      targetUrl: `${JS_SCRAPER_SERVICE_URL}/brands`
    });
  }
});

app.get('/api/railway-brands/:filename', async (req, res) => {
  if (!JS_SCRAPER_SERVICE_URL) return res.status(404).json({ error: 'Cloud service not configured' });
  try {
    const response = await axios.get(`${JS_SCRAPER_SERVICE_URL}/brands/${req.params.filename}`, { timeout: 10000 });
    res.json(response.data);
  } catch (error) {
    res.status(404).json({ error: 'Cloud backup not found' });
  }
});

app.post('/api/railway-brands/import/:filename', async (req, res) => {
  try {
    if (!JS_SCRAPER_SERVICE_URL) throw new Error('Cloud service not configured');
    const filename = req.params.filename;
    console.log(`📥 Restoring from cloud: ${filename}`);
    const response = await axios.get(`${JS_SCRAPER_SERVICE_URL}/brands/${filename}`, { timeout: 15000 });
    const data = response.data;

    const brandName = (data.brandInfo?.name || filename).replace(/_/g, ' ');

    // Check if brand exists to avoid duplicates
    const allBrands = await brandStorage.getAllBrands();
    const existingBrand = allBrands.find(b => b.name.toLowerCase().trim() === brandName.toLowerCase().trim());

    const restoredBrand = {
      id: existingBrand ? existingBrand.id : (data.brandInfo?.id || Date.now()),
      name: brandName,
      logo: data.brandInfo?.logo || existingBrand?.logo || '',
      budgetTier: data.budgetTier || existingBrand?.budgetTier || 'mid',
      origin: 'Cloud-Restore',
      products: data.products || [],
      createdAt: existingBrand?.createdAt || new Date(),
      updatedAt: new Date()
    };

    // If it exists, we merge products (avoiding duplicates by model)
    if (existingBrand && existingBrand.products) {
      const existingModels = new Set(existingBrand.products.map(p => String(p.model).toLowerCase().trim()));
      const newProducts = (data.products || []).filter(p => !existingModels.has(String(p.model).toLowerCase().trim()));
      restoredBrand.products = [...existingBrand.products, ...newProducts];
    }

    await brandStorage.saveBrand(restoredBrand);
    res.json({
      success: true,
      count: restoredBrand.products.length,
      added: restoredBrand.products.length - (existingBrand?.products?.length || 0),
      brandName: restoredBrand.name
    });
  } catch (e) {
    console.error('❌ Cloud Import Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/railway-brands/:filename', async (req, res) => {
  if (!JS_SCRAPER_SERVICE_URL) return res.status(404).json({ error: 'Cloud service not configured' });
  try {
    await axios.delete(`${JS_SCRAPER_SERVICE_URL}/brands/${req.params.filename}`, { timeout: 10000 });
    res.json({ success: true, message: 'Cloud backup deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/railway-brands/sync-to-blob', async (req, res) => {
  if (!JS_SCRAPER_SERVICE_URL) {
    return res.status(500).json({ error: 'Railway service not configured' });
  }

  try {
    const listRes = await axios.get(`${JS_SCRAPER_SERVICE_URL}/brands`, { timeout: 15000 });
    const files = listRes.data.brands || [];
    const results = [];
    let synced = 0;
    let skipped = 0;

    // Load all local/supabase brands once for lookup
    const allBrands = await brandStorage.getAllBrands();

    for (const fileMeta of files) {
      const filename = fileMeta.filename;
      try {
        const response = await axios.get(`${JS_SCRAPER_SERVICE_URL}/brands/${filename}`, { timeout: 20000 });
        const data = response.data;

        const brandName = (data.brandInfo?.name || filename).replace(/_/g, ' ');
        const existingBrand = allBrands.find(b => b.name.toLowerCase().trim() === brandName.toLowerCase().trim());

        const brand = {
          id: existingBrand ? existingBrand.id : (data.brandInfo?.id || Date.now() + Math.floor(Math.random() * 1000)),
          name: brandName,
          logo: data.brandInfo?.logo || existingBrand?.logo || '',
          origin: 'Railway-Volume-Recovery',
          budgetTier: data.budgetTier || existingBrand?.budgetTier || 'mid',
          products: data.products || [],
          sourceUrl: data.sourceUrl || '',
          completedAt: data.completedAt || new Date().toISOString()
        };

        // Merge logic
        if (existingBrand && existingBrand.products) {
          const existingModels = new Set(existingBrand.products.map(p => String(p.model).toLowerCase().trim()));
          const newProducts = (data.products || []).filter(p => !existingModels.has(String(p.model).toLowerCase().trim()));
          brand.products = [...existingBrand.products, ...newProducts];
        }

        const saved = await brandStorage.saveBrand(brand);
        if (saved) {
          synced += 1;
          results.push({ filename, status: 'synced', brand: brand.name });
        } else {
          skipped += 1;
          results.push({ filename, status: 'skipped', error: 'saveBrand returned false' });
        }
      } catch (importErr) {
        results.push({ filename, status: 'failed', error: importErr.message });
      }
    }

    res.json({
      success: true,
      total: files.length,
      synced,
      skipped,
      files: results
    });
  } catch (error) {
    console.error('❌ Railway sync-to-blob failed:', error.message);
    res.status(500).json({ error: 'Railway sync failed', details: error.message });
  }
});

// --- Supabase Management ---
app.get('/api/supabase/stats', async (req, res) => {
  try {
    const stats = await getSupabaseStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/supabase/brands', async (req, res) => {
  try {
    const brands = await getSupabaseBrands();
    res.json({ success: true, brands });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/supabase/sync', async (req, res) => {
  try {
    const result = await syncLocalToSupabase();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Image Proxy with robust error handling
app.get('/api/image-proxy', async (req, res) => {
  let imageUrl = req.query.url;
  try {
    if (!imageUrl) return res.status(400).send('URL required');

    // Support base64 encoded URLs if they don't start with http
    if (!imageUrl.startsWith('http')) {
      try {
        imageUrl = Buffer.from(imageUrl, 'base64').toString('utf-8');
      } catch (e) {
        return res.status(400).send('Invalid URL format');
      }
    }

    const urlObj = new URL(imageUrl);
    const origin = `${urlObj.protocol}//${urlObj.hostname}/`;

    // Create a robust HTTPS agent that can handle some common SSL issues if needed
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false, // Bypass some SSL issues for proxying
      keepAlive: true
    });

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': origin,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    let data = response.data;
    let contentType = response.headers['content-type'] || 'image/jpeg';

    // Handle EMF/WMF conversion on the fly
    if (imageUrl.toLowerCase().match(/\.(emf|wmf)$/) || contentType.includes('image/x-emf') || contentType.includes('image/x-wmf') || contentType.includes('application/x-msmetafile')) {
      console.log(`[Image Proxy] Detected EMF/WMF, attempting on-the-fly conversion for: ${imageUrl.substring(0, 80)}...`);
      let converted = false;
      try {
        const tempDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
        await fs.mkdir(tempDir, { recursive: true });
        const tempInput = path.join(tempDir, `proxy_${Date.now()}_${path.basename(imageUrl)}`);
        await fs.writeFile(tempInput, Buffer.from(data));

        const pngPath = await convertEmfToPng(tempInput);
        if (pngPath) {
          data = await fs.readFile(pngPath);
          contentType = 'image/png';
          converted = true;
          console.log(`[Image Proxy] On-the-fly conversion successful for ${imageUrl.substring(0, 80)}...`);

          // Cleanup
          try { await fs.unlink(tempInput); } catch (e) { }
          try { await fs.unlink(pngPath); } catch (e) { }
        } else {
          // Cleanup temp input
          try { await fs.unlink(tempInput); } catch (e) { }
        }
      } catch (convErr) {
        console.warn(`[Image Proxy] On-the-fly conversion failed: ${convErr.message}`);
      }

      // If conversion failed, serve a proper fallback instead of raw EMF bytes (browsers can't render EMF)
      if (!converted) {
        console.warn(`[Image Proxy] EMF conversion failed — serving placeholder for: ${imageUrl.substring(0, 80)}`);
        try {
          const fallbackUrl = "https://placehold.co/400x300/f1f5f9/475569?text=EMF+Image%0A(Conversion+Pending)";
          const fbRes = await axios.get(fallbackUrl, { responseType: 'arraybuffer', timeout: 5000 });
          res.set('Content-Type', 'image/png');
          res.set('Cache-Control', 'no-cache'); // Don't cache placeholders
          return res.send(fbRes.data);
        } catch (e) {
          // If even the placeholder fails, send a 1x1 transparent PNG
          const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
          res.set('Content-Type', 'image/png');
          return res.send(transparentPng);
        }
      }
    }

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(data);

  } catch (error) {
    const status = error.response?.status || 502;
    const code = error.code || 'UNKNOWN_ERROR';
    const msg = error.response?.statusText || error.message;

    console.warn(`🖼️  [Image Proxy] Warning: ${imageUrl?.substring(0, 80)}... | Status: ${status} | Code: ${code}`);

    // Fallback image source (reliable placeholder)
    const fallbackImage = "https://placehold.co/400x400/f8fafc/64748b?text=Image+Not+Available";

    if (status === 404 || status === 403) {
      try {
        const fbRes = await axios.get(fallbackImage, { responseType: 'arraybuffer' });
        res.set('Content-Type', 'image/png');
        return res.send(fbRes.data);
      } catch (e) {
        return res.status(status).send(msg);
      }
    }
    res.status(502).send(`Gateway Error: ${code} - ${msg}`);
  }
});


// --- Unified Scraper Engine ---
async function handleScrapeRequest(req, res, method = 'standard') {
  const { name, url, origin, budgetTier, scraperSource } = req.body;
  const taskId = `task-${Date.now()}`;

  if (!name || !url) {
    return res.status(400).json({ error: 'Missing brand name or website URL' });
  }

  // Initialize task
  const initialTask = {
    id: taskId,
    status: 'pending',
    progress: 0,
    stage: 'Starting...',
    brandName: name,
    brandUrl: url,
    method,
    startTime: new Date().toISOString()
  };
  tasks.set(taskId, initialTask);

  // Send immediate response so UI can start polling
  res.json({ success: true, taskId });

  // EXECUTION WRAPPER
  const runScraper = async () => {
    try {
      let results = { products: [] };
      const isArchitonic = url.toLowerCase().includes('architonic.com');

      // 🚂 DELEGATION: RAILWAY CLOUD
      // Use Railway if source is railway OR if it's Architonic (which is better handled by specialized cloud scraper)
      if ((scraperSource === 'railway' || isArchitonic) && isJsScraperAvailable()) {
        console.log(`🚂 [DELEGATING] Task ${taskId} (${name}) to Railway Cloud...`);
        const endpointMap = {
          'standard': '/scrape',
          'ai': '/scrape-structure',
          'scrapling': '/scrape'
        };
        // Architonic ALWAYS uses its dedicated endpoint (scraper.js) regardless of method —
        // scrapeArchitonic() has scroll loops + collection discovery the structure scraper lacks.
        const railwayEndpoint = isArchitonic ? '/scrape-architonic' : (endpointMap[method] || '/scrape');

        try {
          const delegation = await callJsScraperService(railwayEndpoint, {
            name, url, origin, budgetTier,
            options: { method }
          });

          if (delegation && delegation.taskId) {
            console.log(`🌐 [RAILWAY] Proxying task: ${delegation.taskId}`);
            const finalResult = await pollJsScraperTask(delegation.taskId, (progress, stage) => {
              tasks.set(taskId, { ...initialTask, status: 'processing', progress, stage });
            });
            results = finalResult;
          } else {
            throw new Error('Railway service failed to return a taskId');
          }
        } catch (delegationErr) {
          console.error(`❌ [DELEGATION FAILED] falling back to local: ${delegationErr.message}`);
          // If NOT explicitly railway, we can try local fallback. 
          // But for now, let's treat it as a hard failure if delegation was expected.
          throw delegationErr;
        }
      }
      // 🏠 EXECUTION: LOCAL ENGINE
      else {
        console.log(`🏠 [LOCAL] Executing task ${taskId} (${name}) on local engine...`);
        const onProgress = (progress, stage) => {
          tasks.set(taskId, { ...initialTask, status: 'processing', progress, stage });
        };

        if (method === 'ai') {
          const sc = await getStructureScraper();
          results = await sc.scrape(url, { onProgress, brandName: name, origin, budgetTier });
        } else if (method === 'scrapling') {
          const sc = await getScraperService();
          results = await sc.scrape(url, { onProgress, brandName: name, origin, budgetTier, useScrapling: true });
        } else {
          const sc = await getScraperService();
          results = await sc.scrape(url, { onProgress, brandName: name, origin, budgetTier });
        }
      }

      // Finalize Brand Entry
      const finalBrand = {
        id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name,
        website: url,
        origin: origin || 'Unknown',
        budgetTier: budgetTier || 'mid',
        products: results.products || [],
        lastScraped: new Date().toISOString()
      };

      await brandStorage.saveBrand(finalBrand);

      tasks.set(taskId, {
        ...initialTask,
        status: 'completed',
        progress: 100,
        stage: 'Finished!',
        brand: finalBrand,
        resultCount: finalBrand.products.length
      });

      console.log(`✅ [SUCCESS] Task ${taskId} finished with ${finalBrand.products.length} items.`);

    } catch (err) {
      console.error(`❌ [TASK FAILED] ${taskId}:`, err);
      tasks.set(taskId, {
        ...initialTask,
        status: 'failed',
        error: err.message,
        stage: 'Error occurred'
      });
    }
  };

  // Start execution in background
  runScraper();
}

app.post('/api/scrape-brand', async (req, res) => handleScrapeRequest(req, res, 'standard'));
app.post('/api/scrape-ai', async (req, res) => handleScrapeRequest(req, res, 'ai'));
app.post('/api/scrape-scrapling', async (req, res) => handleScrapeRequest(req, res, 'scrapling'));

app.post('/api/brands/sync', async (req, res) => {
  try {
    const { brandName, website, syncStrategy, origin, budgetTier } = req.body;
    if (!brandName || !website) {
      return res.status(400).json({ error: 'Missing brand name or website URL' });
    }

    console.log(`📡 [Sync Strategy API] Delegating ${brandName} (${syncStrategy}) to external Python scraper...`);
    const scraperUrl = process.env.PYTHON_SCRAPER_URL || 'https://web-production-38d1f.up.railway.app/api/scrape';

    const response = await fetch(scraperUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: website,
        brand_name: brandName,
        strategy: syncStrategy,
        sync: true
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ [Sync Strategy API] External scraper error: ${response.status} - ${errText}`);
      return res.status(response.status).json({ error: `External scraper error: ${errText}` });
    }

    const results = await response.json();
    console.log(`✅ [Sync Strategy API] Successfully scraped ${results.products?.length || 0} products from external scraper.`);

    const finalBrand = {
      id: brandName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      name: brandName,
      website: website,
      origin: origin || 'Unknown',
      budgetTier: budgetTier || 'mid',
      products: results.products || [],
      logo: results.brandInfo?.logo || '',
      lastScraped: new Date().toISOString()
    };

    await brandStorage.saveBrand(finalBrand);

    res.json({
      success: true,
      brand: finalBrand,
      productCount: finalBrand.products.length,
      brandInfo: results.brandInfo || { name: brandName, logo: '' },
      products: results.products || []
    });

  } catch (error) {
    console.error('🔥 [Sync Strategy API Error]:', error.message);
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      return res.status(504).json({ error: 'Request to external scraper timed out (2 minutes exceeded).' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Batch Fitout Matching
app.post('/api/ai/match-fitout', async (req, res) => {
  try {
    const { items, tier = 'mid' } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array required' });
    }

    console.log(`\n🏗️  [Batch Fitout] Matching ${items.length} items (Tier: ${tier})...`);

    let dbName = `fitout_v2-${tier}.json`;
    let dbPath = path.join(__dirname, 'data', 'brands', dbName);

    try {
      await fs.access(dbPath);
    } catch {
      dbPath = path.join(__dirname, 'data', 'brands', 'fitout_v2-mid.json');
    }

    const dbRaw = await fs.readFile(dbPath, 'utf-8');
    const dbData = JSON.parse(dbRaw);
    const internalProducts = dbData.products || [];

    const results = await Promise.all(items.map(async (item) => {
      try {
        const matchResult = await matchFitoutItem(item.description, internalProducts, tier);
        return {
          originalItem: item,
          match: matchResult.status === 'success' ? matchResult.product : null,
          status: matchResult.status
        };
      } catch (err) {
        return { originalItem: item, match: null, status: 'error', error: err.message };
      }
    }));

    res.json({ success: true, results });
  } catch (error) {
    console.error('🔥 [Batch Fitout Error]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- Plan Analysis ---
app.post('/api/analyze-plan', planUpload.array('files', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const filesData = await Promise.all(req.files.map(async (file) => {
      const fileBuffer = await fs.readFile(file.path);
      return {
        base64Data: fileBuffer.toString('base64'),
        mimeType: file.mimetype,
        originalname: file.originalname,
        path: file.path
      };
    }));

    console.log(`🏗️  Received ${filesData.length} plan(s) for analysis: ${filesData.map(f => f.originalname).join(', ')}`);
    const includeFitout = req.body.includeFitout === 'true';
    const provider = req.body.provider || 'google';
    const providerModel = req.body.providerModel || undefined;
    const result = await analyzePlan(filesData, { includeFitout, provider, providerModel });

    for (const file of req.files) {
      try { await fs.unlink(file.path); } catch (e) { }
    }

    if (result.status === 'success') {
      res.json(result);
    } else {
      res.status(500).json({ error: result.error_message || 'Analysis failed' });
    }
  } catch (error) {
    console.error('🔥 Plan analysis error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ────────────────────────────────────────────────
// Temp-Image Directory Cleanup Helper
// Wipes all session subfolders under public/temp/
// ────────────────────────────────────────────────
const TEMP_IMAGE_DIR = isVercel ? '/tmp/extracted_images' : path.join(process.cwd(), 'public', 'temp', 'extracted_images');

async function cleanTempDir() {
  try {
    await fs.mkdir(TEMP_IMAGE_DIR, { recursive: true }); // ensure it exists first
    const entries = await fs.readdir(TEMP_IMAGE_DIR, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());
    await Promise.all(
      dirs.map(d => fs.rm(path.join(TEMP_IMAGE_DIR, d.name), { recursive: true, force: true }))
    );
    if (dirs.length > 0) {
      console.log(`🧹 [Temp Cleanup] Removed ${dirs.length} session folder(s) from public/temp/extracted_images`);
    }
  } catch (err) {
    console.warn(`⚠️ [Temp Cleanup] Could not clean temp dir: ${err.message}`);
  }
}

// Premium Presentation PDF (PPTX -> PDF Converter)
app.post('/api/generate-pptx-pdf', async (req, res) => {
  try {
    console.log('📄 [Server] Receiving pre-generated PPTX for PDF conversion...');
    const { pptxBase64 } = req.body;

    let pdfPath = null;
    let pptxPath = null;

    if (pptxBase64) {
      console.log('🔄 [Server] Received pre-generated PPTX from client. Converting...');
      const tempDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
      await fs.mkdir(tempDir, { recursive: true }).catch(() => null);

      const pptxFilename = `presentation_upload_${Date.now()}.pptx`;
      pptxPath = path.join(tempDir, pptxFilename);

      const buffer = Buffer.from(pptxBase64, 'base64');
      await fs.writeFile(pptxPath, buffer);

      const { convertPptxToPdf } = await import('./utils/pptxToPdfConverter.js');
      pdfPath = await convertPptxToPdf(pptxPath);
    } else {
      console.log('⚠️ [Server] No pptxBase64 provided. Falling back to backend generation...');
      const { generatePresentationPdf } = await import('./utils/pptxExportService.js');
      const result = await generatePresentationPdf(req.body);
      pdfPath = result.pdfPath;
      pptxPath = result.pptxPath;
    }

    if (pdfPath) {
      console.log('✅ [Server] PDF Generated successfully.');
      res.download(pdfPath, 'presentation_export.pdf');
    } else {
      console.warn('⚠️ [Server] PDF Conversion failed, providing PPTX instead.');
      res.download(pptxPath, 'presentation_export.pptx');
    }
  } catch (err) {
    console.error('❌ [Server] PPTX-PDF Generation/Conversion Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reset & Cleanup

app.post('/api/reset', async (req, res) => {
  try {
    console.log('🧹 [Reset] Full system cleanup requested...');
    await cleanupService.cleanupAll();
    await cleanTempDir();

    // Explicitly clean public/temp folders
    const publicTemp = path.join(process.cwd(), 'public', 'temp');
    const exists = await fs.access(publicTemp).then(() => true).catch(() => false);
    if (exists) {
      const folders = await fs.readdir(publicTemp);
      for (const f of folders) {
        if (f === '.gitkeep') continue;
        await fs.rm(path.join(publicTemp, f), { recursive: true, force: true });
      }
    }

    res.json({ success: true, message: 'System reset complete. All temporary files and cloud sessions cleared.' });
  } catch (err) {
    console.error('❌ [Reset] Cleanup error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cleanup', async (req, res) => {
  const sessionId = req.body.sessionId || 'default';
  const sessionFolder = `temp-uploads/${sessionId}`;
  cleanupService.trackCloudFolder(sessionId, 'assets', sessionFolder);
  await cleanupService.cleanupSession(sessionId);
  res.json({ success: true });
});

// Session-specific cleanup (called by frontend on refresh/close/new session)
app.post('/api/cleanup/session', async (req, res) => {
  const sessionId = req.body?.sessionId || 'default';
  console.log(`[Cleanup] Manual cleanup request for session: ${sessionId}`);

  // Track the standard cloud folders for this session
  cleanupService.trackCloudFolder(sessionId, 'assets', `temp-uploads/${sessionId}`);
  cleanupService.trackCloudFolder(sessionId, 'assets', 'extracted-images');

  // Run session cleanup (deletes tracked blobs + cloud folders)
  await cleanupService.cleanupSession(sessionId);

  // Also do a sweep of orphaned flat files in extracted-images
  if (supabase) {
    try {
      const { data: files } = await supabase.storage.from('assets').list('extracted-images', { limit: 500 });
      if (files && files.length > 0) {
        const filePaths = files.filter(f => f.id).map(f => `extracted-images/${f.name}`);
        if (filePaths.length > 0) {
          await supabase.storage.from('assets').remove(filePaths);
          console.log(`[Cleanup] Purged ${filePaths.length} orphaned files from extracted-images`);
        }
      }
    } catch (err) {
      console.warn('[Cleanup] extracted-images sweep failed:', err.message);
    }
  }

  res.json({ success: true });
});

// Global Error Handler
app.use((error, req, res, next) => {
  console.error('[ServerError]', error);
  res.status(500).json({ error: error.message || 'Internal server error' });
});

if (!isVercel) {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Salamony4all/BOQV2 server actively listening on: http://localhost:${PORT}`);

    // Initial maintenance tasks...
    Promise.all([
      cleanupService.cleanupAll(),
      cleanTempDir()
    ])
      .then(() => console.log('✅ Initial cleanup completed.'))
      .catch(err => console.error('❌ Cleanup failed:', err));
  });

  server.on('error', (err) => {
    console.error('SERVER ERROR:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Please kill the process manually.`);
    }
  });
}

export default app;