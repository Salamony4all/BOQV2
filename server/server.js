
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
import { ExcelDbManager } from './excelManager.js';
import { brandStorage } from './storageProvider.js';
import { getAiMatch, identifyModel, fetchProductDetails, analyzePlan, matchFitoutItem } from './utils/llmUtils.js';

// Restored Scraper Engine Imports
import ScraperService from './scraper.js';
import StructureScraper from './structureScraper.js';
import BrowserlessScraper from './browserlessScraper.js';
import ScrapingBeeScraper from './scrapingBeeScraper.js';

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

// Initialize services
const cleanupService = new CleanupService();
const dbManager = new ExcelDbManager();

// Restored Scraper Instances
const scraperService = new ScraperService();
const structureScraper = new StructureScraper();
const browserlessScraper = new BrowserlessScraper();
const scrapingBeeScraper = new ScrapingBeeScraper();

// --- Configuration & Tasks ---
const JS_SCRAPER_SERVICE_URL = process.env.JS_SCRAPER_SERVICE_URL;
const tasks = new Map();

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

// Multer configuration
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dest = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
    try {
      await fs.mkdir(dest, { recursive: true });
    } catch (e) {}
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
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xls|xlsx)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xls and .xlsx files are allowed.'));
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

// --- Railway Sidecar & Task Helpers ---
const isJsScraperAvailable = () => !!JS_SCRAPER_SERVICE_URL;

async function callJsScraperService(endpoint, payload, timeout = 300000) {
  if (!JS_SCRAPER_SERVICE_URL) throw new Error('JS_SCRAPER_SERVICE_URL not configured');
  const url = `${JS_SCRAPER_SERVICE_URL}${endpoint}`;
  console.log(`🌐 Calling Railway Service: ${url}`);
  const response = await axios.post(url, payload, { timeout, headers: { 'Content-Type': 'application/json' } });
  return response.data;
}

async function pollJsScraperTask(taskId, onProgress = null, maxWaitMs = 3600000) {
  const startTime = Date.now();
  const pollInterval = 3000;
  let consecutiveErrors = 0;
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await axios.get(`${JS_SCRAPER_SERVICE_URL}/tasks/${taskId}`, { timeout: 10000 });
      const task = response.data;
      consecutiveErrors = 0;
      if (onProgress && task.progress) onProgress(task.progress, task.stage || 'Processing...');
      if (task.status === 'completed') return task;
      if (task.status === 'failed') throw new Error(task.error || 'Railway task failed');
      await new Promise(r => setTimeout(r, pollInterval));
    } catch (error) {
      consecutiveErrors++;
      if (consecutiveErrors >= 10) throw new Error(`Polling failed: ${error.message}`);
      await new Promise(r => setTimeout(r, pollInterval * 2));
    }
  }
  throw new Error('Task timed out');
}

// --- API Endpoints ---

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'OK', version: '2.0.0-classic' }));

// Upload and extract endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const sessionId = req.headers['x-session-id'] || 'default';

    console.log(`[Upload] Processing: ${req.file.originalname} via fastExtractor`);

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

// Vercel Blob Token Handler
app.post('/api/upload/blob-token', async (req, res) => {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      token: token,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
        tokenPayload: JSON.stringify({ userId: 'anonymous' }),
        addRandomSuffix: true,
      })
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

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

app.delete('/api/brands/:id', async (req, res) => {
  try {
    await brandStorage.deleteBrand(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete brand' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// FF&E SPECIALIST AI ENDPOINT — 3-Stage Workflow
// ──────────────────────────────────────────────────────────────────────────────
//
//  Stage 1: AI (with web search) → "Best ONE model for [desc] from [brand]?"
//  Stage 2: Fuzzy search in local brand DB JSON for that model name
//  Stage 3: If missing → AI fetches full product from web → saves permanently to DB
//
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fuzzy model matching: strips catalog ID suffixes (#12345678) and normalizes.
 * Returns the matching product entry or null.
 */
function fuzzyFindModel(products, targetModelName, targetCategory = '') {
    if (!products || !products.length || !targetModelName) return null;

    const normalize = (s) => String(s)
        .toLowerCase()
        .replace(/#\d+/g, '')          // strip Architonic IDs like #20732680
        .replace(/[^a-z0-9\s]/g, ' ')  // strip special chars
        .replace(/\s+/g, ' ')
        .trim();

    const target = normalize(targetModelName);

    // Filter by category if possible to prevent "Chair" description matching a "Desk" product
    let filteredProducts = products;
    if (targetCategory && targetCategory.length > 2) {
        const cat = targetCategory.toLowerCase().trim();
        const matchesCat = products.filter(p => {
            const mc = (p.mainCategory || '').toLowerCase();
            const sc = (p.subCategory || '').toLowerCase();
            return mc.includes(cat) || sc.includes(cat) || cat.includes(mc) || cat.includes(sc);
        });
        if (matchesCat.length > 0) {
            filteredProducts = matchesCat;
        }
    }

    // 1. Exact match after normalization
    let found = filteredProducts.find(p => normalize(p.model) === target);
    if (found) return found;

    // 2. One contains the other
    found = filteredProducts.find(p => {
        const pn = normalize(p.model);
        return pn.includes(target) || target.includes(pn);
    });
    if (found) return found;

    // 3. Word-intersection (>=50% overlap)
    const targetWords = new Set(target.split(' ').filter(w => w.length > 2));
    if (targetWords.size === 0) return null;

    let bestScore = 0;
    let bestMatch = null;
    for (const p of filteredProducts) {
        const pWords = normalize(p.model).split(' ').filter(w => w.length > 2);
        const intersection = pWords.filter(w => targetWords.has(w)).length;
        const score = intersection / Math.max(targetWords.size, pWords.length);
        if (score > bestScore) { bestScore = score; bestMatch = p; }
    }

    return bestScore >= 0.5 ? bestMatch : null;
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
      scope = 'Furniture' // Default to furniture
    } = req.body;

    const finalTier = tier || budgetTier || 'mid';

    // ── SPECIALIZED FITOUT WORKFLOW ─────────────────────────────────────────
    if (scope?.toLowerCase() === 'fitout') {
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

        // Match using Gemini 2.5 Flash
        const matchResult = await matchFitoutItem(description, internalProducts, finalTier);

        if (matchResult && matchResult.status === 'success' && matchResult.product) {
          console.log(`  ✅ [Fitout Logic] Match found: ${matchResult.product.model} @ AED ${matchResult.product.price}`);
          return res.json({
            status: 'success',
            product: {
              ...matchResult.product,
              brand: 'FitOut V2',
              brandLogo: '' // No logo for internal fitout DB
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
    // This helps the AI distinguish e.g. a small coffee table (R:30 = 30cm) from a meeting table.
    const sizeContext = [qty && `Qty: ${qty}`, unit && `Unit: ${unit}`].filter(Boolean).join(', ');
    const enrichedDescription = sizeContext ? `${description} | ${sizeContext}` : description;

    console.log(`\n🤖 [AI AutoFill] "${enrichedDescription.substring(0, 70)}" | Tier: ${finalTier} | Brands: ${brandCandidates.join(', ')} | Provider: ${provider}`);
    // Load all local brands once (for DB lookups)
    const allLocalBrands = await brandStorage.getAllBrands();

    // ── STRICT TIER ISOLATION ──────────────────────────────────────────────────
    // Filter brand candidates to ONLY brands whose DB entry matches finalTier.
    // This prevents cross-tier contamination even if client sends mixed brands.
    const tierIsolatedCandidates = brandCandidates.filter(candidateName => {
      const dbEntry = allLocalBrands.find(b =>
        b.name.toLowerCase().trim() === candidateName.toLowerCase().trim()
      );
      if (!dbEntry) {
        // Brand not in DB yet — allow it (AI will discover it fresh)
        console.log(`  ℹ️  [Tier Filter] "${candidateName}" not in local DB — allowing for discovery.`);
        return true;
      }
      const match = (dbEntry.budgetTier || 'mid').toLowerCase() === finalTier.toLowerCase();
      if (!match) {
        console.warn(`  🚫 [Tier Filter] Blocking "${candidateName}" (DB tier: ${dbEntry.budgetTier}) — not matching requested tier: ${finalTier}`);
      }
      return match;
    });

    if (tierIsolatedCandidates.length === 0) {
      return res.json({
        status: 'error',
        error_message: `No brands for tier "${finalTier}" were selected. Please switch to the correct tier tab.`
      });
    }

    console.log(`  ✅ [Tier Filter] Allowed brands (${finalTier}): ${tierIsolatedCandidates.join(', ')}`);
    // ── END TIER ISOLATION ─────────────────────────────────────────────────────

    // ─────────────────────────────────────────────
    // Try each tier-validated brand candidate in order
    // ─────────────────────────────────────────────
    for (const candidateBrand of tierIsolatedCandidates) {
      // STAGE 1: IDENTIFY MODEL (AI Context)
      // 💡 Abstracted: We use the raw description (no Qty/Unit) to prevent hallucinations.
      console.log(`\n  🔎 [Stage 1] Identification Engine → "${candidateBrand}" best model for: "${description.substring(0, 60)}"...`);
      const identity = await identifyModel(description, candidateBrand, provider);

      if (identity.status !== 'success' || !identity.model || identity.model === 'FAILED') {
        console.warn(`  ⚠️  [Stage 1] Identification failed for ${candidateBrand}. Trying next candidate if available...`);
        continue;
      }

      const identifiedModel = identity.model.trim();
      const identifiedBrand = identity.brand || candidateBrand;
      const identifiedCategory = identity.category || '';
      console.log(`  ✅ [Stage 1] AI Identification complete: ${identifiedBrand} → "${identifiedModel}" [${identifiedCategory}]`);

      // ── STAGE 2: LOCAL DB SEARCH (Zero-Cost Cache) ──
      console.log(`  📂 [Stage 2] Searching verified local DB cache for "${identifiedModel}"...`);
      
      const brandMatches = allLocalBrands.filter(b =>
        b.name.toLowerCase().trim() === identifiedBrand.toLowerCase().trim()
      );

      const localBrand =
        brandMatches.find(b => (b.budgetTier || 'mid').toLowerCase() === finalTier.toLowerCase()) ||
        brandMatches[0];

      if (localBrand && localBrand.products && localBrand.products.length > 0) {
        const dbProduct = fuzzyFindModel(localBrand.products, identifiedModel, identifiedCategory);

        if (dbProduct) {
          console.log(`  ✨ [Stage 2] CACHE HIT: "${dbProduct.model}" loaded instantly.`);
          return res.json({
            status: 'success',
            product: {
              ...dbProduct,
              brand: identifiedBrand,
              brandLogo: localBrand.logo || ''
            },
            source: 'local-database',
            identifiedModel
          });
        }
      }

      // ── STAGE 3: DEEP SEARCH (Web Discovery) ─────
      console.log(`  🌐 [Stage 3] Deep Discovery Engine engaged: searching live web for ${identifiedBrand} ${identifiedModel}...`);
      const webResult = await fetchProductDetails(identifiedBrand, identifiedModel, finalTier, provider);

      if (webResult.status === 'success' && webResult.product) {
        const newProduct = { 
          ...webResult.product, 
          brand: identifiedBrand, 
          mainCategory: webResult.product.mainCategory || identifiedCategory || 'Furniture',
          lastUpdated: new Date().toISOString(), 
          source: 'AI-Discovery-Engine' 
        };

        // Validate imageUrl — must be absolute HTTPS pointing to an image file
        const rawImg = newProduct.imageUrl || '';
        const isValidImage = (
          rawImg.startsWith('https://') &&
          !rawImg.includes('localhost') &&
          /\.(jpg|jpeg|png|webp|svg)(\?|$)/i.test(rawImg)
        );
        if (!isValidImage) {
          console.warn(`  ⚠️  [Stage 3] Invalid imageUrl rejected: "${rawImg.substring(0, 80)}"`);
          newProduct.imageUrl = localBrand?.logo || '';  // fall back to brand logo
        }

        // Persist to local DB permanently
        try {
          if (localBrand) {
            await brandStorage.addProductToBrand(identifiedBrand, localBrand.budgetTier || finalTier, newProduct);
            console.log(`  💾 [Stage 3] Saved "${identifiedModel}" to ${identifiedBrand} DB permanently.`);
          } else {
            console.warn(`  ⚠️  [Stage 3] Cannot persist — brand "${identifiedBrand}" has no local DB entry yet. Creating...`);
            const newBrand = {
              id: Date.now(),
              name: identifiedBrand,
              logo: '',
              budgetTier: localBrand?.budgetTier || finalTier,
              origin: 'AI-Discovery',
              products: [newProduct],
              createdAt: new Date().toISOString()
            };
            await brandStorage.saveBrand(newBrand);
            console.log(`  💾 [Stage 3] Created new brand entry for "${identifiedBrand}" and saved product.`);
          }
        } catch (saveErr) {
          console.error(`  ⚠️  [Stage 3] Persistence failed (non-fatal):`, saveErr.message);
        }

        return res.json({
          status: 'success',
          product: {
            ...newProduct,
            brandLogo: localBrand?.logo || ''
          },
          source: 'ai-discovery-hardened',
          identifiedModel
        });
      }

      console.warn(`  ❌ [Stage 3] Web fetch failed for ${identifiedBrand} ${identifiedModel}: ${webResult.error_message}`);
      // Continue to next brand candidate if this one failed
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
  if (!JS_SCRAPER_SERVICE_URL) return res.json({ brands: [] });
  try {
    const response = await axios.get(`${JS_SCRAPER_SERVICE_URL}/brands`, { timeout: 5000 });
    res.json(response.data);
  } catch (error) {
    res.json({ brands: [] });
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

    const restoredBrand = {
      id: Date.now(),
      name: (data.brandInfo?.name || filename).replace(/_/g, ' '),
      logo: data.brandInfo?.logo || '',
      origin: 'Cloud-Restore',
      products: data.products || [],
      createdAt: new Date(),
    };

    await brandStorage.saveBrand(restoredBrand);
    res.json({ success: true, count: restoredBrand.products.length, brandName: restoredBrand.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Image Proxy
app.get('/api/image-proxy', async (req, res) => {
  try {
    let imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('URL required');
    if (!imageUrl.startsWith('http')) imageUrl = Buffer.from(imageUrl, 'base64').toString('utf-8');

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(response.data);
  } catch (error) {
    res.status(502).send('Image fetch failed');
  }
});

// --- Brand Harvesting Endpoints ---
app.post('/api/scrape-brand', async (req, res) => {
  try {
    const { url, name, origin = 'UNKNOWN', budgetTier = 'mid', scraperSource } = req.body;
    const isArchitonic = url.toLowerCase().includes('architonic.com');
    const forceLocal = scraperSource === 'local';
    
    // Set up task
    const taskId = `scrape_${Date.now()}`;
    tasks.set(taskId, { id: taskId, status: 'processing', progress: 10, stage: 'Starting harvest...', brandName: name || 'Detecting...' });

    // Handle orchestration (Railway vs Local vs Cloud Providers)
    (async () => {
      try {
        let result;
        if (JS_SCRAPER_SERVICE_URL && !forceLocal) {
          const scraperEndpoint = isArchitonic ? '/scrape-architonic' : '/scrape';
          const taskResult = await callJsScraperService(scraperEndpoint, { url, name, sync: false });
          
          tasks.set(taskId, { ...tasks.get(taskId), railwayTaskId: taskResult.taskId });

          const railwayResult = await pollJsScraperTask(taskResult.taskId, (progress, stage) => {
            tasks.set(taskId, { ...tasks.get(taskId), progress, stage: `Railway: ${stage}` });
          });
          result = railwayResult;
        } else {
          // Use local scraper service
          if (isArchitonic) {
             result = await structureScraper.scrape(url, (progress, stage) => {
                tasks.set(taskId, { ...tasks.get(taskId), progress, stage: `Local Architonic: ${stage}` });
             });
          } else {
             result = await scraperService.scrapeBrand(url, (progress, stage) => {
                tasks.set(taskId, { ...tasks.get(taskId), progress, stage });
             });
          }
        }

        const brandNameFound = result.brandInfo?.name || name || 'New Brand';
        const newBrand = {
          id: Date.now(),
          name: brandNameFound,
          url,
          origin,
          budgetTier,
          logo: result.brandInfo?.logo || '',
          products: result.products || [],
          createdAt: new Date(),
        };

        await brandStorage.saveBrand(newBrand);
        tasks.set(taskId, { 
           id: taskId, 
           status: 'completed', 
           progress: 100, 
           stage: 'Complete!', 
           brand: newBrand,
           productCount: newBrand.products.length,
           brandName: brandNameFound
        });
      } catch (err) {
        console.error('Scraping error:', err);
        tasks.set(taskId, { id: taskId, status: 'failed', error: err.message });
      }
    })();

    res.json({ success: true, taskId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scrape-ai', async (req, res) => {
  // AI-Powered Fast Multi-Page Scraper (Architonic optimized)
  try {
     const { url, name, budgetTier = 'mid', origin = 'UNKNOWN' } = req.body;
     const taskId = `ai_scrape_${Date.now()}`;
     tasks.set(taskId, { id: taskId, status: 'processing', progress: 5, stage: 'Initializing AI Engine...', brandName: name });

     (async () => {
       try {
         // This usually delegates to structureScraper or specialized logic
         const result = await structureScraper.scrape(url, (progress, stage) => {
           tasks.set(taskId, { ...tasks.get(taskId), progress, stage });
         });

         const newBrand = {
           id: Date.now(),
           name: result.brandInfo?.name || name,
           url, origin, budgetTier,
           logo: result.brandInfo?.logo || '',
           products: result.products || [],
           createdAt: new Date(),
         };

         await brandStorage.saveBrand(newBrand);
         tasks.set(taskId, { id: taskId, status: 'completed', progress: 100, stage: 'Success!', brand: newBrand });
       } catch (err) {
         tasks.set(taskId, { id: taskId, status: 'failed', error: err.message });
       }
     })();

     res.json({ success: true, taskId });
  } catch (error) {
     res.status(500).json({ error: error.message });
  }
});

app.post('/api/scrape-scrapling', async (req, res) => {
  try {
     const { url, name, budgetTier = 'mid', origin = 'UNKNOWN' } = req.body;
     const taskId = `scrapling_${Date.now()}`;
     tasks.set(taskId, { id: taskId, status: 'processing', progress: 5, stage: 'Waking up Scrapling Engine...', brandName: name });

     (async () => {
       try {
         // Scrapling usually delegates to a python sidecar or a specialized scraper
         // For now we use the browsing scrapers as fallback or delegation
         const result = await browserlessScraper.scrapeBrand(url, (progress, stage) => {
           tasks.set(taskId, { ...tasks.get(taskId), progress, stage: `Scrapling: ${stage}` });
         });

         const newBrand = {
           id: Date.now(),
           name: result.brandInfo?.name || name,
           url, origin, budgetTier,
           logo: result.brandInfo?.logo || '',
           products: result.products || [],
           createdAt: new Date(),
         };

         await brandStorage.saveBrand(newBrand);
         tasks.set(taskId, { id: taskId, status: 'completed', progress: 100, stage: 'Scrapling Success!', brand: newBrand });
       } catch (err) {
         tasks.set(taskId, { id: taskId, status: 'failed', error: err.message });
       }
     })();

     res.json({ success: true, taskId });
  } catch (error) {
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
    
    // Check if includeFitout flag is present (passed from the client)
    const includeFitout = req.body.includeFitout === 'true';

    const result = await analyzePlan(filesData, { includeFitout });

    // Clean up temporary files
    for (const file of req.files) {
      try {
        await fs.unlink(file.path);
      } catch (e) {
        console.warn('Could not delete temp plan file:', e.message);
      }
    }

    if (result.status === 'success') {
      res.json(result);
    } else {
      res.status(500).json({ error: result.error_message || 'Analysis failed' });
    }
  } catch (error) {
    console.error('🔥 Plan analysis error:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      stack: error.stack 
    });
  }
});

// Reset & Cleanup
app.post('/api/reset', async (req, res) => {
  await cleanupService.cleanupAll();
  res.json({ success: true, message: 'System reset complete' });
});

app.post('/api/cleanup', async (req, res) => {
  const sessionId = req.body.sessionId || 'default';
  await cleanupService.cleanupSession(sessionId);
  res.json({ success: true });
});

// Global Error Handler
app.use((error, req, res, next) => {
  console.error('[ServerError]', error);
  res.status(500).json({ error: error.message || 'Internal server error' });
});

console.log('--- Starting BOQFLOW Server ---');
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BOQFLOW Classic Server actively listening on: http://localhost:${PORT}`);
  console.log('--- Triggering Initial Cleanup ---');
  cleanupService.cleanupAll()
    .then(() => console.log('✅ Initial cleanup completed.'))
    .catch(err => console.error('❌ Cleanup failed:', err));
});

server.on('error', (err) => {
  console.error('SERVER ERROR:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please kill the process manually.`);
  }
});

export default server;
