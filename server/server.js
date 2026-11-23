console.log('🏁 [Server] Loading dependencies...');
import './loadEnv.js';
import './nodePolyfills.js'; // MUST be before pdfjs — patches DOMMatrix etc. on globalThis
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';
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
import { getAiMatch, identifyModel, fetchProductDetails, searchAndEnrichModel, analyzePlan, matchFitoutItem, autoMatchSingleBrand, autoMatchMultiBrand, VALID_OPENROUTER_MODELS, VALID_NVIDIA_MODELS, GOOGLE_MODEL, OPENROUTER_MODEL, NVIDIA_MODEL, aiKeyStorage } from './utils/llmUtils.js';
import { veMatchAuto, vePrescanBrands, detectSpecifiedBrandInText, extractSpecifiedProductDetails, cleanDomainToBrand, isMarketplaceUrl, generateCrossBrandAlternatives, generateCrossBrandAlternativesAsync, isProductIdentityAligned, isGarbageProductDesc } from './utils/veAutoDetectUtils.js';
import { veMatchSimple, veMatchAdvanced, veGetProductDetails, veRouteCategories } from './utils/veMatchUtils.js';
import { generatePresentationPdf } from './utils/pptxExportService.js';
import { convertEmfToPng } from './utils/emfConverter.js';
import Fuse from 'fuse.js';
import { TAXONOMY } from './utils/normalizer.js';
import tenderRouter from './tenderRoutes.js';
import llmProxyRouter from './llmProxyRoutes.js';
import { findSemanticMatches, ensureBrandCatalogEmbeddings } from './embeddingService.js';
import { readSettings, writeSettings, getPublicSettings } from './settings.js';
import { isLensHeadlessAvailable, scrapeLensVisualMatches, isLensWalled } from './utils/lensHeadless.js';
import { searchViaJar, fetchImageBytes, jarStatus } from './utils/lensJar.js';
import { enrichBrandFromOfficialSite } from './utils/brandEnricher.js';
import { enrichBrandFromArchitonic } from './utils/architonicAdapter.js';
import { fetchProductFacts } from './utils/jsonldVerifier.js';
import { VE_CATEGORY_CONFIG, classifyFurnishingCategory, isGenuineContractBrand, findBrandInCatalog, NON_BRAND_MODEL_WORDS, BRAND_ALIASES } from './utils/veCategoryPriority.js';
import { isBedSpecHeadline, expandNumberWords } from './utils/specArchetypes.js';
import { getCanonicalBrandLogo, getCanonicalBrandWebsite, resolveBrandLogo, classifyContractCategory, CONTRACT_BRAND_LOGOS } from './utils/brandLogos.js';
import { matchWorkstationSet } from './utils/workstationSetMatcher.js';
import { fetchLiveProductImage, cleanTechnicalDescription, verifyImageUrl } from './utils/veImageEnricher.js';
import { enrichProductFromLiveWeb } from './utils/veLiveEnricher.js';
import { verifyImagePairing } from './utils/veImageVerification.js';
import { discoverOfficialOriginViaWeb } from './utils/webSearchUtils.js';
import { assertSafeExternalUrl, safeAxiosGet } from './utils/urlSecurity.js';
import {
  getRouterHealthSnapshot,
  ingestLiveGoogleModels,
  ensureLiveCatalogSynced,
  refreshLiveGoogleCatalog
} from './utils/freeModelRouter.js';

// ALL heavy PDF/Vision extractors are LAZY to prevent Vercel boot crash
// (pdfProductExtractor uses pdfjs, visionBOQExtractor uses Playwright)
let _pdfProductExtractor = null;
let _parallelBOQExtractor = null;
let _visionBOQExtractor = null;
let _pdfRenderer = null;
let _wordExtractorService = null;
let _wordExtractorMtimeMs = 0;

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

async function getWordExtractorService() {
  // V12 diagnostic/cache-bust loader: reloads wordExtractorService.js when file mtime changes.
  const extractorPath = path.join(__dirname, 'wordExtractorService.js');
  let mtimeMs = Date.now();

  try {
    mtimeMs = fs_sync.statSync(extractorPath).mtimeMs;
  } catch (err) {
    console.warn(`[WordPdfExtractor] Could not stat extractor file: ${err.message}`);
  }

  if (!_wordExtractorService || _wordExtractorMtimeMs !== mtimeMs) {
    _wordExtractorMtimeMs = mtimeMs;
    _wordExtractorService = await import(`./wordExtractorService.js?v=${mtimeMs}`);
    console.log(`[WordPdfExtractor] Loaded extractor module mtime=${mtimeMs}`);
  }

  return _wordExtractorService;
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

async function extractAndUploadNativePdfImages(filePath, sessionId) {
  const fs = await import('fs');
  const mupdf = await import('mupdf');

  const data = await fs.promises.readFile(filePath);
  const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
  const pageCount = doc.countPages();

  const imagesToUpload = []; // { pageIdx, y, imgY, pngBytes, snAnchors }
  const snImageMap = new Map(); // `${pageIdx}_${sn}` -> supabaseUrl

  for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
    try {
      const page = doc.loadPage(pageIdx);
      let headerY = -1;
      let tableStartY = -1;
      const snAnchors = [];

      // 1. EXTRACT ALL TEXT LINES
      const lines = [];
      page.toStructuredText().walk({
        onLine(bbox, line) {
          lines.push({ bbox, text: line.trim().toLowerCase() });
        }
      });

      // 2. DETECT HEADER
      let maxHits = 0;
      const keywords = ['sl.no', 's.n', 'sr.no', 'no.', 'item', 'description', 'image', 'qty', 'unit', 'total', 'rate', 'price'];
      for (let i = 0; i < lines.length; i++) {
        let hits = 0;
        let currentY = lines[i].bbox[1];
        for (let j = 0; j < lines.length; j++) {
          if (Math.abs(lines[j].bbox[1] - currentY) < 15) {
            for (const k of keywords) {
              if (lines[j].text.includes(k)) hits++;
            }
          }
        }
        if (hits > maxHits) {
          maxHits = hits;
          headerY = currentY;
        }
      }

      // 3. IDENTIFY ALL SN ANCHORS
      for (const line of lines) {
        if (line.bbox[0] < 120) {
          const snMatch = line.text.match(/^\s*(\d+)[.\s-]*$/);
          if (snMatch) {
            const snVal = parseInt(snMatch[1]).toString();
            const midY = (line.bbox[1] + line.bbox[3]) / 2;
            snAnchors.push({ sn: snVal, y: midY });
            if (tableStartY === -1 || line.bbox[1] < tableStartY) {
              tableStartY = line.bbox[1];
            }
          }
        }
      }

      const hardLogoBoundary = tableStartY !== -1 ? tableStartY : (headerY !== -1 ? headerY : 150);

      // 4. COLLECT IMAGES
      page.toStructuredText('preserve-images').walk({
        onImageBlock(bbox, _transform, image) {
          try {
            const w = bbox[2] - bbox[0];
            const h = bbox[3] - bbox[1];
            const imgY = (bbox[1] + bbox[3]) / 2;
            const aspectRatio = w / h;
            if (aspectRatio > 4 || aspectRatio < 0.25) return;
            if (bbox[1] < (hardLogoBoundary - 10)) return;
            if (w < 20 || h < 20) return;

            const pngBytes = image.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false).asPNG();
            if (pngBytes.length < 500) return;

            imagesToUpload.push({
              pageIdx,
              y: bbox[1],
              imgY,
              pngBytes,
              snAnchors
            });
          } catch (err) { }
        }
      });
    } catch (pageErr) {
      console.warn(`[extractAndUploadNativePdfImages] Page ${pageIdx + 1} extraction failed:`, pageErr.message);
    }
  }

  // Upload in parallel
  const pageImagesMap = new Map();

  await Promise.all(imagesToUpload.map(async (img) => {
    try {
      const filename = `mupdf-crops/${sessionId}/${crypto.randomUUID()}.png`;
      if (supabase) {
        const uploadResult = await uploadToSupabase('assets', filename, Buffer.from(img.pngBytes), {
          contentType: 'image/png'
        });
        if (uploadResult && uploadResult.url) {
          const pageNum = img.pageIdx + 1;
          if (!pageImagesMap.has(pageNum)) {
            pageImagesMap.set(pageNum, []);
          }
          pageImagesMap.get(pageNum).push({
            url: uploadResult.url,
            y: img.y
          });

          // Match SN (Spatial Lock)
          let matchedSN = null;
          let bestDist = 120;
          for (const anchor of img.snAnchors) {
            const vDist = Math.abs(anchor.y - img.imgY);
            if (vDist < bestDist) {
              bestDist = vDist;
              matchedSN = anchor.sn;
            }
          }
          if (matchedSN) {
            snImageMap.set(`${img.pageIdx}_${matchedSN}`, uploadResult.url);
          }
        }
      }
    } catch (uploadErr) {
      console.error('[mupdf-upload] Failed upload:', uploadErr.message);
    }
  }));

  // Sort each page's images by Y coordinate
  for (const [pageNum, imgs] of pageImagesMap.entries()) {
    imgs.sort((a, b) => a.y - b.y);
  }

  return { pageImagesMap, snImageMap };
}

async function processTextTablesWithNativeImages(fastapiRes, filePath, uploadId, sessionId, layoutsPromise = null) {
  const fs = await import('fs');
  const { renderPDFWithLayout } = await getPdfRenderer();
  const { _saveAndPairImage } = await getParallelBOQExtractor();

  // Run MuPDF image extraction natively and upload to Supabase
  let mupdfLayout = { pageImagesMap: new Map(), snImageMap: new Map() };
  try {
    console.log(`[processTextTablesWithNativeImages] Running MuPDF image extraction & uploading to Supabase...`);
    mupdfLayout = await extractAndUploadNativePdfImages(filePath, sessionId);
    console.log(`[processTextTablesWithNativeImages] MuPDF complete. Spatial locks count: ${mupdfLayout.snImageMap.size}`);
  } catch (mupdfErr) {
    console.error(`[processTextTablesWithNativeImages] MuPDF extraction failed:`, mupdfErr.message);
  }

  const pageImageCursorMap = new Map();

  const baseTempDir = isVercel ? '/tmp/extracted_images' : path.join(process.cwd(), 'public', 'temp', 'extracted_images');
  const tempDir = path.join(baseTempDir, uploadId);
  await fs.promises.mkdir(tempDir, { recursive: true });

  if (!layoutsPromise) {
    console.log(`[processTextTablesWithNativeImages] Scheduling background layout rendering for ${path.basename(filePath)}...`);
    layoutsPromise = renderPDFWithLayout(filePath).catch(err => {
      console.error('Layout Extraction Failed:', err.message);
      return [];
    });
    activeLayoutPromises.set(uploadId, layoutsPromise);
    layoutsPromise.finally(() => {
      setTimeout(() => {
        activeLayoutPromises.delete(uploadId);
      }, 300000); // 5 minutes cache
    });
  }

  let canonicalHeader = null;
  let imgColIdx = -1;
  const tableRows = [];
  const allRowsArr = [];

  if (fastapiRes && Array.isArray(fastapiRes.tables)) {
    for (const [tableIdx, table] of fastapiRes.tables.entries()) {
      const pageNum = table.page || 1;
      const originalHeader = table.header || [];
      const originalRows = table.rows || [];

      // Determine column indices matching standard keywords for this specific table (for image pairing)
      const indices = {
        sn: -1,
        description: -1,
        qty: -1,
        unit: -1,
        rate: -1,
        amount: -1
      };

      originalHeader.forEach((h, idx) => {
        const term = String(h || '').toLowerCase().trim();
        if (!term) return;

        if (indices.sn === -1 && (term === 'sn' || term === 's.n' || term === 's.n.' || term === 'sl.no' || term === 'sl' || term === 'sr' || term === 'no' || term === 'no.' || term === 'item' || term === 'item no' || term === 'sr.no')) {
          indices.sn = idx;
        } else if (indices.description === -1 && (term.includes('description') || term.includes('desc') || term.includes('disc') || term.includes('product') || term.includes('specification') || term.includes('material') || term.includes('particulars'))) {
          indices.description = idx;
        } else if (indices.qty === -1 && (term === 'qty' || term === 'quantity' || term === 'qnty' || term.startsWith('q\'ty') || term === 'qt')) {
          indices.qty = idx;
        } else if (indices.unit === -1 && (term === 'unit' || term === 'uom' || term === 'measure' || term === 'untit')) {
          indices.unit = idx;
        } else if (indices.rate === -1 && (term.includes('rate') || term.includes('price') || term.includes('unit price') || term.includes('u.rate') || term.includes('unit rate') || term.includes('u. price') || term.includes('u price'))) {
          indices.rate = idx;
        } else if (indices.amount === -1 && (term.includes('amount') || term.includes('total') || term.includes('subtotal') || term.includes('total price') || term.includes('value'))) {
          indices.amount = idx;
        }
      });

      // Fallback for description column if not found
      if (indices.description === -1) {
        let maxAvgLength = -1;
        let bestIdx = -1;
        for (let c = 0; c < originalHeader.length; c++) {
          if (c === indices.sn || c === indices.qty || c === indices.rate || c === indices.amount) continue;
          let totalLength = 0;
          let count = 0;
          originalRows.forEach(r => {
            if (r.cells && r.cells[c]) {
              totalLength += String(r.cells[c].value || '').length;
              count++;
            }
          });
          const avg = count > 0 ? totalLength / count : 0;
          if (avg > maxAvgLength) {
            maxAvgLength = avg;
            bestIdx = c;
          }
        }
        if (bestIdx !== -1) {
          indices.description = bestIdx;
        }
      }

      // Initialize canonicalHeader using the first table
      if (canonicalHeader === null) {
        // Check if header contains an image column
        imgColIdx = originalHeader.findIndex(h => {
          const term = String(h || '').toLowerCase().trim();
          return term.includes('image') || term.includes('photo') || term.includes('picture') || term.includes('img') || term.includes('pic');
        });

        // Check if any row in the whole dataset actually has images in it
        let datasetHasImages = false;
        for (const t of fastapiRes.tables) {
          if (t.rows && t.rows.some(r => r.cells.some(c => (c.images && c.images.length > 0) || c.image))) {
            datasetHasImages = true;
            break;
          }
        }

        canonicalHeader = [...originalHeader];
        if (imgColIdx === -1 && datasetHasImages) {
          // Add "Image" column at index 1 (or after serial number column if it exists)
          let insertIdx = 1;
          if (indices.sn !== -1) insertIdx = indices.sn + 1;
          canonicalHeader.splice(insertIdx, 0, "Image");
          imgColIdx = insertIdx;
          // Adjust indices after insertion
          if (indices.description >= insertIdx) indices.description++;
          if (indices.qty >= insertIdx) indices.qty++;
          if (indices.unit >= insertIdx) indices.unit++;
          if (indices.rate >= insertIdx) indices.rate++;
          if (indices.amount >= insertIdx) indices.amount++;
        }
      }

      // Map columns of this table to the canonical header
      const colIndexMap = [];
      originalHeader.forEach((h, idx) => {
        const norm = (h || '').toLowerCase().trim();
        // Find matching column in canonicalHeader
        let canonicalIdx = canonicalHeader.findIndex(ch => (ch || '').toLowerCase().trim() === norm);
        // If not found by exact match, try matching by indices adjusted for dynamic Image column insertion
        if (canonicalIdx === -1) {
          canonicalIdx = idx;
          if (imgColIdx !== -1 && idx >= imgColIdx) {
            canonicalIdx++;
          }
        }
        colIndexMap.push(canonicalIdx);
      });

      for (let rIdx = 0; rIdx < originalRows.length; rIdx++) {
        const row = originalRows[rIdx];
        if (!row || !row.cells) continue;

        const cells = row.cells;
        // Pad cells to match original header
        while (cells.length < originalHeader.length) {
          cells.push({ value: '' });
        }

        const rawSN = indices.sn !== -1 ? String(cells[indices.sn]?.value || '').trim() : '';
        const rawDesc = indices.description !== -1 ? String(cells[indices.description]?.value || '').trim() : '';
        const rawQty = indices.qty !== -1 ? String(cells[indices.qty]?.value || '').trim() : '';
        const rawUnit = indices.unit !== -1 ? String(cells[indices.unit]?.value || '').trim() : '';
        const rawRate = indices.rate !== -1 ? String(cells[indices.rate]?.value || '').trim() : '';
        const rawAmount = indices.amount !== -1 ? String(cells[indices.amount]?.value || '').trim() : '';

        // Skip completely empty rows
        if (!rawSN && !rawDesc && !rawQty && !rawUnit && !rawRate && !rawAmount) {
          continue;
        }

        // Filter out table headers embedded in the row data
        const headerKeywords = ["sl.no", "description", "qty", "unit", "rate", "total", "amount", "price"];
        const descLower = rawDesc.toLowerCase();
        const matches = headerKeywords.filter(k => descLower.includes(k));
        if (matches.length >= 2 && rawDesc.length < 80) {
          continue;
        }

        const displaySN = rawSN || String(tableRows.length + 1);

        // Helper to parse numeric string cleanly
        const cleanNumber = (val) => {
          if (!val) return '';
          const cleaned = String(val).replace(/[^0-9.]/g, '');
          const parsed = parseFloat(cleaned);
          return isNaN(parsed) ? '' : parsed;
        };

        // Format cells dynamically for the frontend, aligned to canonicalHeader
        const formattedCells = Array(canonicalHeader.length).fill(null).map((_, idx) => {
          if (idx === imgColIdx) {
            const rowPageNum = row.page || pageNum;
            const pageIdx = rowPageNum - 1;

            // Try Spatial SN lock first
            let finalImageUrl = null;
            if (displaySN && mupdfLayout.snImageMap.has(`${pageIdx}_${displaySN}`)) {
              finalImageUrl = mupdfLayout.snImageMap.get(`${pageIdx}_${displaySN}`);
              console.log(`    🔗 [processTextTablesWithNativeImages] Spatial Lock Match: Page ${rowPageNum} SN ${displaySN} -> ${finalImageUrl}`);
            } else {
              // Positional fallback
              const imgs = mupdfLayout.pageImagesMap.get(rowPageNum) || [];
              const cursor = pageImageCursorMap.get(rowPageNum) || 0;
              if (cursor < imgs.length) {
                finalImageUrl = imgs[cursor].url;
                pageImageCursorMap.set(rowPageNum, cursor + 1);
                console.log(`    🔗 [processTextTablesWithNativeImages] Positional Match: Page ${rowPageNum} Row ${displaySN} (rank ${cursor}) -> ${finalImageUrl}`);
              }
            }

            const imageObj = finalImageUrl ? { url: finalImageUrl, sn: displaySN } : null;

            return {
              value: '',
              image: imageObj,
              images: imageObj ? [imageObj] : [],
              isMerged: false
            };
          }
          return { value: '', images: [], isMerged: false };
        });

        cells.forEach((cell, cIdx) => {
          const targetIdx = colIndexMap[cIdx];
          if (targetIdx !== -1 && targetIdx < formattedCells.length) {
            const incomingImages = cell.images || (cell.image ? [cell.image] : []);

            // If this is the image column, and the incoming cell has no images, preserve our lazy image fallback
            if (targetIdx === imgColIdx && incomingImages.length === 0) {
              formattedCells[targetIdx] = {
                value: cell.value !== undefined ? cell.value : '',
                image: formattedCells[targetIdx].image,
                images: formattedCells[targetIdx].images,
                isMerged: !!(cell.colSpan > 1 || cell.rowSpan > 1)
              };
            } else {
              formattedCells[targetIdx] = {
                value: cell.value !== undefined ? cell.value : '',
                images: incomingImages,
                isMerged: !!(cell.colSpan > 1 || cell.rowSpan > 1)
              };
              if (incomingImages.length > 0) {
                formattedCells[targetIdx].image = incomingImages[0];
              }
            }
          }
        });

        // Store metadata row representation for pairing
        const mappedRow = {
          sn: displaySN,
          description: rawDesc,
          qty: cleanNumber(rawQty),
          unit: rawUnit,
          rate: cleanNumber(rawRate),
          amount: cleanNumber(rawAmount),
          pageNum: row.page || pageNum,
          sectionLabel: row.sectionLabel || '',
          rowIdx: tableRows.length, // global index in the combined table
          image: {
            url: `/api/lazy-image/${uploadId}/${row.page || pageNum}/${tableRows.length}`,
            sn: displaySN
          },
          images: []
        };

        allRowsArr.push(mappedRow);

        tableRows.push({
          cells: formattedCells,
          pageNum: row.page || pageNum,
          sectionLabel: row.sectionLabel || '',
          isHeader: false,
          isSummary: false
        });
      }
    }
  }

  if (canonicalHeader === null) {
    canonicalHeader = ["S.N", "Image", "Description", "Qty", "Unit", "Rate", "Amount"];
  }

  // SAVE METADATA (Write immediately, pages layout will be filled by background promise)
  const metadata = {
    uploadId,
    pdfPath: path.resolve(filePath),
    rows: allRowsArr,
    pages: []
  };
  await fs.promises.writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // BACKGROUND POSITION MATCHING (Multi-image support)
  console.log(`[processTextTablesWithNativeImages] Scheduling background image matching for ${uploadId}`);
  setTimeout(async () => {
    try {
      const layouts = await layoutsPromise;
      if (!layouts || layouts.length === 0) {
        console.log(`  ⚠️ [Background] Layouts extraction empty or failed for ${uploadId}. Skipping pairing.`);
        return;
      }

      // Read latest metadata from disk to avoid race conditions
      let currentMeta = metadata;
      if (fs_sync.existsSync(path.join(tempDir, 'metadata.json'))) {
        try {
          currentMeta = JSON.parse(await fs.promises.readFile(path.join(tempDir, 'metadata.json'), 'utf8'));
        } catch (e) {
          console.error('[Background] Failed to read metadata from disk:', e);
        }
      }

      currentMeta.pages = layouts.map(l => ({
        page: l.page,
        textItems: l.textItems,
        nativeImages: l.extractedImages,
        viewport: l.viewport
      }));

      // Write layout pages to metadata immediately so lazy-image can access it
      await fs.promises.writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(currentMeta, null, 2));

      console.log(`  🖼️ [Background] Positional image pairing for ${uploadId}...`);

      for (const layout of layouts) {
        const pageNum = layout.page;
        if (!layout.extractedImages || layout.extractedImages.length === 0) continue;

        const isActualItem = (r) => {
          const hasQty = r.qty !== undefined && r.qty !== null && r.qty !== '';
          const hasRate = r.rate !== undefined && r.rate !== null && r.rate !== '';
          const hasAmount = r.amount !== undefined && r.amount !== null && r.amount !== '';
          return hasQty || hasRate || hasAmount;
        };

        const pageRows = currentMeta.rows
          .filter(r => r.pageNum === pageNum && isActualItem(r))
          .sort((a, b) => a.rowIdx - b.rowIdx);

        if (pageRows.length === 0) continue;

        let headerY = -1;
        const yGroups = {};
        for (const it of layout.textItems || []) {
          const y = Math.round(it.y / 10) * 10;
          if (!yGroups[y]) yGroups[y] = [];
          yGroups[y].push(String(it.str || '').toLowerCase());
        }

        const headerKeywordsForMatch = ['s.n', 'sl.no', 'description', 'qty', 'unit', 'rate', 'total'];
        let maxHits = 0;

        for (const [yStr, words] of Object.entries(yGroups)) {
          let hits = 0;
          const yPos = parseInt(yStr);
          for (const word of words) {
            if (headerKeywordsForMatch.some(k => word.includes(k))) hits++;
          }
          if (hits >= 2 && hits > maxHits) {
            maxHits = hits;
            if (headerY === -1 || yPos < headerY) headerY = yPos;
          }
        }

        const productImages = layout.extractedImages
          .filter(img => {
            const isSizeOk = img.h >= 20 && img.w >= 20;
            const isNotHeader = headerY === -1 || img.y >= (headerY - 10);
            if (isSizeOk && !isNotHeader) console.log(`    🚫 [Background] P${pageNum}: Skipping header image (y=${Math.round(img.y)} < headerY=${Math.round(headerY)})`);
            return isSizeOk && isNotHeader;
          })
          .sort((a, b) => a.y - b.y || a.x - b.x);

        console.log(`    📐 [Background] Page ${pageNum}: ${pageRows.length} rows, ${productImages.length} images (HeaderY: ${Math.round(headerY)})`);

        const textItems = layout.textItems || [];
        const normalize = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

        // 1. Determine anchor Y for each row
        const rowAnchors = pageRows.map(row => {
          const targetSN = normalize(row.sn);

          // Find serial number match on the left side of the page (x < 150) and below table header
          const snMatch = textItems.find(it => {
            const norm = normalize(it.str);
            const isXOk = it.x !== undefined && it.x < 150;
            const isNotHeader = headerY === -1 || it.y >= (headerY - 10);
            return norm === targetSN && norm.length > 0 && isXOk && isNotHeader;
          });

          let descMatch = null;
          // Split description into words and find the first significant word (length > 3)
          const descWords = (row.description || '')
            .split(/\s+/)
            .map(w => normalize(w))
            .filter(w => w.length > 3);

          if (descWords.length > 0) {
            const firstTargetWord = descWords[0];
            // Find a match in textItems below the table header
            descMatch = textItems.find((it, itIdx) => {
              const normStr = normalize(it.str);
              if (normStr !== firstTargetWord) return false;

              const isNotHeader = headerY === -1 || it.y >= (headerY - 10);
              if (!isNotHeader) return false;

              // If there's a second word, verify if it matches one of the next few textItems
              if (descWords.length > 1) {
                const secondTargetWord = descWords[1];
                const limit = Math.min(textItems.length, itIdx + 6);
                for (let nextIdx = itIdx + 1; nextIdx < limit; nextIdx++) {
                  if (normalize(textItems[nextIdx].str) === secondTargetWord) {
                    return true;
                  }
                }
                return false;
              }
              return true;
            });
          }

          let anchorY = null;
          if (snMatch) {
            anchorY = snMatch.y;
          } else if (descMatch) {
            anchorY = descMatch.y;
          }
          return { row, anchorY };
        });

        // Fill in missing anchorY values using interpolation/extrapolation
        for (let i = 0; i < rowAnchors.length; i++) {
          if (rowAnchors[i].anchorY === null) {
            let prevIdx = -1;
            for (let j = i - 1; j >= 0; j--) {
              if (rowAnchors[j].anchorY !== null) { prevIdx = j; break; }
            }
            let nextIdx = -1;
            for (let j = i + 1; j < rowAnchors.length; j++) {
              if (rowAnchors[j].anchorY !== null) { nextIdx = j; break; }
            }

            if (prevIdx !== -1 && nextIdx !== -1) {
              const prevY = rowAnchors[prevIdx].anchorY;
              const nextY = rowAnchors[nextIdx].anchorY;
              rowAnchors[i].anchorY = prevY + (nextY - prevY) * (i - prevIdx) / (nextIdx - prevIdx);
            } else if (prevIdx !== -1) {
              const prevY = rowAnchors[prevIdx].anchorY;
              rowAnchors[i].anchorY = prevY + (i - prevIdx) * 100;
            } else if (nextIdx !== -1) {
              const nextY = rowAnchors[nextIdx].anchorY;
              rowAnchors[i].anchorY = Math.max(0, nextY - (nextIdx - i) * 100);
            } else {
              const startY = headerY !== -1 ? headerY + 50 : 100;
              rowAnchors[i].anchorY = startY + i * 120;
            }
          }
        }

        // 2. Define Y ranges for each row (Physical boundary matching)
        const rowRanges = rowAnchors.map((curr, idx) => {
          const next = rowAnchors[idx + 1];

          const offset = 45;
          let yMin = curr.anchorY - offset;
          if (idx === 0 && headerY !== -1) {
            yMin = Math.min(headerY, yMin);
          }

          let yMax;
          if (next) {
            yMax = next.anchorY - offset;
          } else {
            yMax = curr.anchorY + 600; // allow large range for last row
          }

          // Ensure bounds are valid
          if (yMax < yMin) {
            yMax = yMin + 100;
          }

          return {
            row: curr.row,
            anchorY: curr.anchorY,
            yMin,
            yMax,
            matchedImages: []
          };
        });

        // 3. Match each image to the row whose Y bounds it falls within
        for (let i = 0; i < productImages.length; i++) {
          const img = productImages[i];
          const imgCenterY = img.y + img.h / 2;

          let matchedRowRange = rowRanges.find(r => imgCenterY >= r.yMin && imgCenterY < r.yMax);

          if (!matchedRowRange) {
            let bestRange = null;
            let minDistance = Infinity;
            for (const r of rowRanges) {
              const dist = Math.abs(r.anchorY - imgCenterY);
              if (dist < minDistance) {
                minDistance = dist;
                bestRange = r;
              }
            }
            matchedRowRange = bestRange;
          }

          if (matchedRowRange) {
            matchedRowRange.matchedImages.push(img);
          }
        }

        // 4. Save and pair all matched images to their rows (Supporting multi-images per cell)
        for (const range of rowRanges) {
          const row = range.row;
          if (range.matchedImages.length === 0) continue;

          row.images = [];

          for (let i = 0; i < range.matchedImages.length; i++) {
            const img = range.matchedImages[i];
            const suffix = range.matchedImages.length > 1 ? `_${i}` : '';
            const filename = `page_${pageNum}_row_${row.rowIdx}${suffix}.jpg`;
            const imgLocalPath = path.join(tempDir, filename);

            try {
              if (img.path) {
                await fs.promises.copyFile(img.path, imgLocalPath);
              } else if (img.dataUrl) {
                const base64Data = img.dataUrl.replace(/^data:image\/\w+;base64,/, '');
                await fs.promises.writeFile(imgLocalPath, Buffer.from(base64Data, 'base64'));
              }

              const imgUrl = `/temp/extracted_images/${uploadId}/${filename}`;
              row.images.push({
                url: imgUrl,
                sn: row.sn
              });

              console.log(`    🔗 [Background] Paired multi-image [${i}] SN=${row.sn} (P${pageNum}/R${row.rowIdx}) → ${filename}`);
            } catch (err) {
              console.error(`    ❌ [Background] Failed to save multi-image [${i}] for P${pageNum} R${row.rowIdx}:`, err.message);
            }
          }

          if (row.images.length > 0) {
            row.image = row.images[0];
          }
        }
      }

      currentMeta.isReady = true;
      await fs.promises.writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(currentMeta, null, 2));
      console.log(`  ✅ [Background] Lazy image matching finished and metadata updated for ${uploadId}.`);
    } catch (e) {
      console.error('  ❌ [Background Error] Image matching failed:', e.message, e.stack);
    }
  }, 100);

  return {
    tables: [{
      sheetName: "AI Fast Extraction",
      header: canonicalHeader,
      rows: tableRows,
      columnCount: canonicalHeader.length,
      uploadId,
      engineUsed: fastapiRes.engineUsed || 'docling'
    }],
    totalTables: 1
  };
}

const activeLayoutPromises = new Map();

const app = express();
app.set('trust proxy', true);
const PORT = 3001;
let server;

// Initialize services
const cleanupService = new CleanupService();
const dbManager = new ExcelDbManager();

console.log('✅ [Server] All services initialized.');


// --- Configuration & Tasks ---
const JS_SCRAPER_SERVICE_URL = process.env.JS_SCRAPER_SERVICE_URL;
const DOCLING_SERVICE_URL = process.env.DOCLING_SERVICE_URL || process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
const tasks = new Map();

function getTrustedStorageHosts() {
  const hosts = [];
  for (const raw of [process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.JS_SCRAPER_SERVICE_URL]) {
    if (!raw) continue;
    try {
      hosts.push(new URL(raw).hostname.toLowerCase());
    } catch { }
  }
  return hosts;
}

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
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Middleware to propagate request-scoped API keys & model selection via AsyncLocalStorage
// Priority: request headers (browser) → file store (ai-settings.json) → empty string
app.use('/api', (req, res, next) => {
  const sanitizeKey = (k) => (k || '').replace(/^\[|\]$/g, '').trim();
  const saved = readSettings();
  const store = {
    googleApiKey: sanitizeKey(req.headers['x-google-api-key']) || saved.googleApiKey || '',
    googleFreeKey: sanitizeKey(req.headers['x-google-free-key']) || saved.googleFreeKey || '',
    activeTier: req.headers['x-google-active-tier'] || saved.activeTier || 'free',
    googleModel: req.headers['x-google-model'] || req.headers['x-model-name'] || saved.googleModel || saved.model || '',
    aiProvider: req.headers['x-ai-provider'] || req.headers['x-provider'] || saved.engine || 'google',
    openrouterApiKey: sanitizeKey(req.headers['x-openrouter-key']) || saved.openrouterApiKey || '',
    openrouterModel: req.headers['x-openrouter-model'] || req.headers['x-model-name'] || saved.openrouterModel || '',
    nvidiaApiKey: sanitizeKey(req.headers['x-nvidia-key']) || saved.nvidiaApiKey || '',
    nvidiaModel: req.headers['x-nvidia-model'] || req.headers['x-model-name'] || saved.nvidiaModel || '',
    localUrl: req.headers['x-local-url'] || ''
  };
  aiKeyStorage.run(store, () => {
    next();
  });
});

app.use('/api/tender', tenderRouter);
app.use('/api/llm-proxy', llmProxyRouter);

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
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xls|xlsx|xlsb|pdf|png|jpg|jpeg)$/i)) {
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

    let pageLayout = metadata.pages.find(p => p.page === pNum);
    if (!pageLayout && activeLayoutPromises.has(uploadId)) {
      console.log(`⏳ [Lazy Image] Waiting for active layout extraction for uploadId: ${uploadId}...`);
      await activeLayoutPromises.get(uploadId).catch(() => []);
      if (fs_sync.existsSync(metadataPath)) {
        try {
          const updatedMeta = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
          metadata.pages = updatedMeta.pages;
          metadata.rows = updatedMeta.rows;
        } catch (e) { }
      }
      pageLayout = metadata.pages.find(p => p.page === pNum);
    }

    if (!pageLayout) throw new Error(`Page ${pNum} layout data missing`);

    // PRIORITY STAGE: Check for Native (Layered) Image Match
    if (pageLayout.nativeImages && pageLayout.nativeImages.length > 0) {

      const isActualItem = (r) => {
        const hasQty = r.qty !== undefined && r.qty !== null && r.qty !== '';
        const hasRate = r.rate !== undefined && r.rate !== null && r.rate !== '';
        const hasAmount = r.amount !== undefined && r.amount !== null && r.amount !== '';
        return hasQty || hasRate || hasAmount;
      };

      // Get all rows on this page sorted by rowIdx (visual order)
      const sortedPageRows = metadata.rows
        .filter(r => r.pageNum === pNum && isActualItem(r))
        .sort((a, b) => a.rowIdx - b.rowIdx);

      // Sort native images top-to-bottom by Y (same as Python now does, but double-ensure)
      const productImages = pageLayout.nativeImages
        .filter(img => img.h >= 20 && img.w >= 20)
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

        let computedHeaderY = -1;
        const yGroups = {};
        for (const it of pageLayout.textItems || []) {
          const y = Math.round(it.y / 10) * 10;
          if (!yGroups[y]) yGroups[y] = [];
          yGroups[y].push(String(it.str || '').toLowerCase());
        }
        const headerKeywordsForMatch = ['s.n', 'sl.no', 'description', 'qty', 'unit', 'rate', 'total'];
        let maxHits = 0;
        for (const [yStr, words] of Object.entries(yGroups)) {
          let hits = 0;
          const yPos = parseInt(yStr);
          for (const word of words) {
            if (headerKeywordsForMatch.some(k => word.includes(k))) hits++;
          }
          if (hits >= 2 && hits > maxHits) {
            maxHits = hits;
            if (computedHeaderY === -1 || yPos < computedHeaderY) computedHeaderY = yPos;
          }
        }

        const snMatch = pageLayout.textItems.find(it => {
          const norm = normalize(it.str);
          const isXOk = it.x !== undefined && it.x < 150;
          const isNotHeader = computedHeaderY === -1 || it.y >= (computedHeaderY - 10);
          return norm === targetSN && norm.length > 0 && isXOk && isNotHeader;
        });

        let descMatch = null;
        if (!snMatch) {
          const descWords = (rowInfo.description || '')
            .split(/\s+/)
            .map(w => normalize(w))
            .filter(w => w.length > 3);

          if (descWords.length > 0) {
            const firstTargetWord = descWords[0];
            descMatch = pageLayout.textItems.find((it, itIdx) => {
              const normStr = normalize(it.str);
              if (normStr !== firstTargetWord) return false;

              const isNotHeader = computedHeaderY === -1 || it.y >= (computedHeaderY - 10);
              if (!isNotHeader) return false;

              if (descWords.length > 1) {
                const secondTargetWord = descWords[1];
                const limit = Math.min(pageLayout.textItems.length, itIdx + 6);
                for (let nextIdx = itIdx + 1; nextIdx < limit; nextIdx++) {
                  if (normalize(pageLayout.textItems[nextIdx].str) === secondTargetWord) {
                    return true;
                  }
                }
                return false;
              }
              return true;
            });
          }
        }

        const anchorY = snMatch ? snMatch.y : (descMatch ? descMatch.y : null);

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

    let computedHeaderY = -1;
    const yGroups = {};
    for (const it of pageLayout.textItems || []) {
      const y = Math.round(it.y / 10) * 10;
      if (!yGroups[y]) yGroups[y] = [];
      yGroups[y].push(String(it.str || '').toLowerCase());
    }
    const headerKeywordsForMatch = ['s.n', 'sl.no', 'description', 'qty', 'unit', 'rate', 'total'];
    let maxHits = 0;
    for (const [yStr, words] of Object.entries(yGroups)) {
      let hits = 0;
      const yPos = parseInt(yStr);
      for (const word of words) {
        if (headerKeywordsForMatch.some(k => word.includes(k))) hits++;
      }
      if (hits >= 2 && hits > maxHits) {
        maxHits = hits;
        if (computedHeaderY === -1 || yPos < computedHeaderY) computedHeaderY = yPos;
      }
    }

    const snMatch = pageLayout.textItems.find(it => {
      const norm = normalize(it.str);
      const isXOk = it.x !== undefined && it.x < 150;
      const isNotHeader = computedHeaderY === -1 || it.y >= (computedHeaderY - 10);
      return norm === targetSN && norm.length > 0 && isXOk && isNotHeader;
    });

    let descMatch = null;
    if (!snMatch) {
      const descWords = (rowInfo.description || '')
        .split(/\s+/)
        .map(w => normalize(w))
        .filter(w => w.length > 3);

      if (descWords.length > 0) {
        const firstTargetWord = descWords[0];
        descMatch = pageLayout.textItems.find((it, itIdx) => {
          const normStr = normalize(it.str);
          if (normStr !== firstTargetWord) return false;

          const isNotHeader = computedHeaderY === -1 || it.y >= (computedHeaderY - 10);
          if (!isNotHeader) return false;

          if (descWords.length > 1) {
            const secondTargetWord = descWords[1];
            const limit = Math.min(pageLayout.textItems.length, itIdx + 6);
            for (let nextIdx = itIdx + 1; nextIdx < limit; nextIdx++) {
              if (normalize(pageLayout.textItems[nextIdx].str) === secondTargetWord) {
                return true;
              }
            }
            return false;
          }
          return true;
        });
      }
    }

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

app.get('/api/upload/metadata/:uploadId', async (req, res) => {
  const { uploadId } = req.params;
  const baseTempDir = isVercel ? '/tmp/extracted_images' : path.join(process.cwd(), 'public', 'temp', 'extracted_images');
  const tempDir = path.join(baseTempDir, uploadId);
  const metadataPath = path.join(tempDir, 'metadata.json');

  try {
    if (!fs_sync.existsSync(metadataPath)) {
      return res.status(404).json({ error: 'Metadata not found' });
    }

    const content = await fs.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(content);

    // If activeLayoutPromises has the uploadId, background image extraction is still running
    const isReady = metadata.isReady || !activeLayoutPromises.has(uploadId);

    res.json({
      ...metadata,
      isReady
    });
  } catch (err) {
    console.error(`Error reading metadata for ${uploadId}:`, err);
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

// ─── AI Settings Persistence (browser → file store) ─────────────────────────────
// Browser saves keys here → used by server background tasks & benchmark scripts

app.get('/api/ai/env-keys', (req, res) => {
  // Returns file-backed settings (masked for security)
  res.json(getPublicSettings());
});

app.get('/api/ai/saved-settings', (req, res) => {
  // Returns the full public view of saved settings (keys masked)
  res.json(getPublicSettings());
});

app.post('/api/ai/save-settings', (req, res) => {
  // Browser calls this on every Settings Save to persist keys server-side
  const payload = req.body || {};
  const result = writeSettings(payload);
  if (result.success) {
    res.json({ success: true, message: 'Settings saved to server file store.', savedAt: result.settings.savedAt });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});


app.post('/api/ai/verify-provider-key', async (req, res) => {
  const { provider, apiKey, tier } = req.body;
  const cleanKey = (apiKey || '').replace(/^\[|\]$/g, '').trim();

  if (!cleanKey) {
    return res.status(400).json({ success: false, error: 'API key cannot be empty.' });
  }

  try {
    if (provider === 'google') {
      const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`, { timeout: 10000 });
      const models = (response.data.models || [])
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));
      return res.json({ success: true, models, count: models.length });
    } else if (provider === 'openrouter') {
      // First verify the key is valid via auth/key endpoint
      await axios.get('https://openrouter.ai/api/v1/auth/key', {
        headers: { 'Authorization': `Bearer ${cleanKey}` },
        timeout: 10000
      });
      const response = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${cleanKey}` },
        timeout: 10000
      });
      const allModels = (response.data.data || []).map(m => m.id);
      return res.json({ success: true, models: allModels, count: allModels.length });
    } else if (provider === 'nvidia') {
      const response = await axios.get('https://integrate.api.nvidia.com/v1/models', {
        headers: { 'Authorization': `Bearer ${cleanKey}` },
        timeout: 10000
      });
      const allModels = (response.data.data || []).map(m => m.id);
      return res.json({ success: true, models: allModels, count: allModels.length });
    } else {
      return res.status(400).json({ success: false, error: `Unsupported provider: ${provider}` });
    }
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.response?.data?.detail || err.response?.data?.message || err.message || 'Key verification failed';
    return res.status(400).json({ success: false, error: errMsg });
  }
});
async function executeExtractionPipeline({
  filePath,
  fileName,
  fileMimeType = '',
  sessionId = 'default',
  extractionMode = 'parallel',
  modelName = null,
  doclingOcr = false,
  options = null
}) {
  const isPdf = fileName.toLowerCase().endsWith('.pdf') || fileMimeType === 'application/pdf';
  const isImage = fileMimeType.startsWith('image/') || fileName.toLowerCase().match(/\.(png|jpg|jpeg)$/);

  console.log(`[ExtractionPipeline] Processing: ${fileName} | isPdf: ${isPdf} | Mode: ${extractionMode} | OCR: ${doclingOcr}${modelName ? ` | Model: ${modelName}` : ''}`);

  // Track file for cleanup
  cleanupService.trackFile(sessionId, filePath);

  let extractedData;
  if (isPdf) {
    // ── Shared helper: call FastAPI /extract and extract real error detail ──
    const fastApiExtract = async ({ usePaddleFallback = true, usePaddleOnly = false, pipeline = 'docling' } = {}) => {
      const fs = await import('fs');
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath), { filename: fileName, contentType: 'application/pdf' });
      // Send 1/0 so FastAPI bool Form parsing works reliably
      form.append('use_paddle_fallback', usePaddleFallback ? '1' : '0');
      form.append('use_paddle_only', usePaddleOnly ? '1' : '0');
      form.append('do_ocr', doclingOcr ? '1' : '0');
      form.append('pipeline', pipeline);

      let fastapiRes;
      try {
        fastapiRes = await axios.post(`${DOCLING_SERVICE_URL}/extract`, form, {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 300000
        });
      } catch (axiosErr) {
        // Prefer the FastAPI response detail over the generic axios message
        const detail =
          axiosErr.response?.data?.detail ||
          axiosErr.response?.data?.error ||
          (typeof axiosErr.response?.data === 'string' ? axiosErr.response.data : null) ||
          axiosErr.message ||
          'FastAPI service unavailable';
        console.error('[FastAPI] Request failed:', detail);
        throw new Error(detail);
      }

      if (!fastapiRes.data?.success) {
        throw new Error(fastapiRes.data?.detail || fastapiRes.data?.error || 'FastAPI returned unsuccessful status');
      }
      return fastapiRes.data;
    };

    if (extractionMode === 'wordcom_vercel') {
      console.log(`[Upload] [wordcom_vercel] Starting Vercel-safe MuPDF hybrid extraction...`);
      try {
        const uploadId = crypto.randomUUID();
        const { extractPdfViaWordVercel } = await import('./wordExtractorServiceVercel.js');
        extractedData = await extractPdfViaWordVercel(filePath, (p) => {
          console.log(`[Upload] [wordcom_vercel] progress: ${p}%`);
        });
        if (extractedData && Array.isArray(extractedData.tables)) {
          extractedData.tables = extractedData.tables.map(t => ({
            ...t,
            uploadId,
            engineUsed: t.engineUsed || 'wordcom-vercel-safe'
          }));
        } else {
          throw new Error('Vercel-safe extraction could not extract table candidates.');
        }
      } catch (err) {
        console.error(`[Upload] [wordcom_vercel] Failed: ${err.message}`, err.stack);
        throw new Error(`Word Vercel-safe extraction failed: ${err.message}`);
      }
    } else if (extractionMode === 'wordcom_v22') {
      console.log(`[Upload] [wordcom_v22] Starting dynamic-header extraction...`);
      try {
        const uploadId = crypto.randomUUID();
        const { extractMultiplePdfsV21 } = await import('./universalPatternParsersVercel.js');
        extractedData = await extractMultiplePdfsV21([filePath], (p) => {
          console.log(`[Upload] [wordcom_v22] progress: ${p}%`);
        });
        if (extractedData && Array.isArray(extractedData.tables)) {
          extractedData.tables = extractedData.tables.map(t => ({
            ...t,
            uploadId,
            engineUsed: t.engineUsed || 'wordcom-v22-dynamic-header'
          }));
        } else {
          throw new Error('V22 dynamic-header extraction could not extract table candidates.');
        }
      } catch (err) {
        console.error(`[Upload] [wordcom_v22] Failed: ${err.message}`, err.stack);
        throw new Error(`Word V22 dynamic-header extraction failed: ${err.message}`);
      }
    } else if (extractionMode === 'wordcom') {
      console.log(`[Upload] [wordcom] Starting Word/LibreOffice hybrid extraction...`);
      try {
        const uploadId = crypto.randomUUID();
        const { extractPdfViaWord } = await getWordExtractorService();
        extractedData = await extractPdfViaWord(filePath, (p) => {
          console.log(`[Upload] [wordcom] progress: ${p}%`);
        }, (assets) => {
          if (Array.isArray(assets)) {
            assets.forEach(asset => asset?.url && cleanupService.trackBlob(sessionId, asset.url));
          }
        });
        if (extractedData && Array.isArray(extractedData.tables)) {
          const primaryBeforeMap = extractedData.tables[0];
          const auditBeforeMap = primaryBeforeMap?.serialAudit || primaryBeforeMap?.extractionAudit;

          console.log(
            `[Upload] [wordcom] extractorEngine=${extractedData.engineUsed || 'unknown'} ` +
            `tables=${extractedData.tables.length} ` +
            `rows=${primaryBeforeMap?.rows?.length || 0} ` +
            `cols=${primaryBeforeMap?.header?.length || 0}`
          );
          console.log(`[Upload] [wordcom] primaryTableEngine=${primaryBeforeMap?.engineUsed || 'unknown'}`);
          if (auditBeforeMap) {
            console.log(
              `[Upload] [wordcom] audit missing=${JSON.stringify(auditBeforeMap.missingSerials || [])} ` +
              `duplicates=${JSON.stringify(auditBeforeMap.duplicateSerials || [])} ` +
              `range=${auditBeforeMap.expectedStart || ''}-${auditBeforeMap.expectedEnd || ''}`
            );
          }

          extractedData.tables = extractedData.tables.map(t => ({ ...t, uploadId, engineUsed: t.engineUsed || extractedData.engineUsed || 'wordcom-hybrid' }));
        }
      } catch (err) {
        console.error(`[Upload] [wordcom] Failed: ${err.message}`, err.stack);
        if (isVercel || !process.platform.startsWith('win')) {
          console.warn(`[Upload] Falling back to Vercel-safe MuPDF extractor...`);
          const uploadId = crypto.randomUUID();
          const { extractPdfViaWordVercel } = await import('./wordExtractorServiceVercel.js');
          extractedData = await extractPdfViaWordVercel(filePath, () => { });
          if (extractedData && Array.isArray(extractedData.tables)) {
            extractedData.tables = extractedData.tables.map(t => ({ ...t, uploadId, engineUsed: 'wordcom-vercel-fallback' }));
            return extractedData;
          }
        }
        const safeMsg = (err.message || 'Unknown error').replace(/[A-Z]:\\\\[^\s]*/gi, '[path]').replace(/\/[^\s]*\//g, '[path]/');
        throw new Error(`Word extraction failed: ${safeMsg}`);
      }
    } else if (extractionMode === 'docling' || extractionMode === 'paddle' || extractionMode === 'opendataloader') {
      console.log(`[Upload] [${extractionMode}] Starting simultaneous extraction...`);
      const uploadId = crypto.randomUUID();

      // Start native image rendering in the background immediately (only if not on Vercel)
      let layoutsPromise = Promise.resolve([]);
      if (!isVercel) {
        try {
          const { renderPDFWithLayout } = await getPdfRenderer();
          layoutsPromise = renderPDFWithLayout(filePath).catch(err => {
            console.error('Layout Extraction Failed:', err.message);
            return [];
          });
          activeLayoutPromises.set(uploadId, layoutsPromise);
          layoutsPromise.finally(() => {
            setTimeout(() => {
              activeLayoutPromises.delete(uploadId);
            }, 300000); // 5 minutes cache
          });
        } catch (e) {
          console.error('Could not schedule local PDF layout rendering:', e.message);
        }
      }

      try {
        const fastapiRaw = await fastApiExtract({
          usePaddleFallback: extractionMode === 'paddle',
          usePaddleOnly: extractionMode === 'paddle',
          pipeline: extractionMode
        });
        console.log(`[Upload] [${extractionMode}] FastAPI OK. engineUsed: ${fastapiRaw.engineUsed}`);
        extractedData = await processTextTablesWithNativeImages(fastapiRaw, filePath, uploadId, sessionId, layoutsPromise);
      } catch (err) {
        console.error(`[Upload] [${extractionMode}] Failed: ${err.message}`);
        if (isVercel) {
          console.warn(`[Upload] FastAPI failed on Vercel, attempting Vercel-safe fallback...`);
          const uploadId = crypto.randomUUID();
          const { extractPdfViaWordVercel } = await import('./wordExtractorServiceVercel.js');
          const fallbackData = await extractPdfViaWordVercel(filePath, () => { });
          if (fallbackData && Array.isArray(fallbackData.tables)) {
            fallbackData.tables = fallbackData.tables.map(t => ({ ...t, uploadId, engineUsed: 'vercel-fastapi-fallback' }));
            return fallbackData;
          }
        }
        throw new Error(`${extractionMode} extraction failed: ${err.message}`);
      }
    } else if (isVercel && extractionMode === 'parallel') {
      // AI Vision Extractor selected: call the chosen model first (PDF sent to the model, images
      // captured natively by MuPDF). The native parser is only the fallback if the AI call fails.
      console.log(`[Upload] Running in Vercel - AI Vision extraction with model: ${modelName || 'default'}`);
      try {
        const uploadId = crypto.randomUUID();
        const { extractProductBoqFromPdf } = await getPdfProductExtractor();
        extractedData = await extractProductBoqFromPdf(filePath, () => { }, modelName);
        if (!extractedData || !Array.isArray(extractedData.tables) || extractedData.tables.length === 0) {
          throw new Error('AI extraction returned no tables');
        }
        extractedData.tables = extractedData.tables.map(t => ({ ...t, uploadId: t.uploadId || uploadId, engineUsed: t.engineUsed || `ai-vision (${modelName || 'default model'})` }));
      } catch (aiErr) {
        console.warn(`[Upload] AI Vision extraction failed (${aiErr.message}). Falling back to native MuPDF parser...`);
        const uploadId = crypto.randomUUID();
        const { extractPdfViaWordVercel } = await import('./wordExtractorServiceVercel.js');
        extractedData = await extractPdfViaWordVercel(filePath, () => { });
        if (!extractedData || !Array.isArray(extractedData.tables) || extractedData.tables.length === 0) {
          throw new Error(`AI Vision extraction failed: ${aiErr.message}`);
        }
        extractedData.tables = extractedData.tables.map(t => ({ ...t, uploadId, engineUsed: `native-fallback (AI failed: ${String(aiErr.message).slice(0, 80)})` }));
        extractedData.aiFallbackReason = aiErr.message;
      }
    } else if (isVercel) {
      console.log(`[Upload] Running in Vercel - Using Vercel-safe MuPDF hybrid extraction`);
      try {
        const uploadId = crypto.randomUUID();
        const { extractPdfViaWordVercel } = await import('./wordExtractorServiceVercel.js');
        extractedData = await extractPdfViaWordVercel(filePath, () => { });
        if (extractedData && Array.isArray(extractedData.tables) && extractedData.tables.length > 0) {
          extractedData.tables = extractedData.tables.map(t => ({ ...t, uploadId, engineUsed: 'wordcom-vercel-safe' }));
          return extractedData;
        }
      } catch (e) {
        console.warn('[Upload] wordExtractorServiceVercel failed, falling back to pdfjs:', e.message);
      }
      const { extractProductBoqFromPdf } = await getPdfProductExtractor();
      extractedData = await extractProductBoqFromPdf(filePath, () => { }, modelName);
    } else if (extractionMode === 'parallel') {
      // ── Legacy: try Docling+Paddle auto-fallback, then JS extractor ─────────
      try {
        console.log(`[Upload] [parallel] Attempting FastAPI Docling+Paddle extraction...`);
        const fastapiRaw = await fastApiExtract({ usePaddleFallback: true, usePaddleOnly: false, pipeline: 'docling' });
        console.log(`[Upload] [parallel] FastAPI OK. engineUsed: ${fastapiRaw.engineUsed}`);
        const uploadId = crypto.randomUUID();
        extractedData = await processTextTablesWithNativeImages(fastapiRaw, filePath, uploadId, sessionId);
      } catch (fastapiErr) {
        console.warn(`[Upload] [parallel] FastAPI failed (${fastapiErr.message}). Falling back to JS Parallel Extractor.`);
        const { extractParallelBOQData } = await getParallelBOQExtractor();
        extractedData = await extractParallelBOQData(filePath, 'application/pdf', () => { }, modelName, (file) => {
          cleanupService.trackFile(sessionId, file);
        }, (folder) => {
          cleanupService.trackFolder(sessionId, folder);
        });
      }
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
    extractedData = await extractVisionBOQData(filePath, fileMimeType || 'image/png', () => { }, modelName, (blob) => {
      cleanupService.trackBlob(sessionId, blob);
    });
  } else {
    // Diagnostic check for file presence on disk
    const exists = fs_sync.existsSync(filePath);
    const stats = exists ? fs_sync.statSync(filePath) : null;
    console.log(`[Upload-Diagnostics] Processing Excel file. Path: ${filePath} | Exists: ${exists} | Size: ${stats ? stats.size : 'N/A'} bytes | Vercel: ${isVercel}`);

    if (!exists) {
      throw new Error(`Uploaded Excel file not found on disk at: ${filePath}. Multer might have failed to write it, or directory permissions are restrictive.`);
    }

    // Extract data from Excel
    extractedData = await extractExcelData(filePath, () => { }, (blob) => {
      cleanupService.trackBlob(sessionId, blob);
    });
  }

  return extractedData;
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const sessionId = req.headers['x-session-id'] || 'default';
    const extractionMode = req.headers['x-extraction-mode'] || 'parallel';
    const modelName = req.headers['x-model-name'];
    const doclingOcr = req.headers['x-docling-ocr'] === '1';

    let options = null;
    if (req.body?.options) {
      try {
        options = typeof req.body.options === 'string' ? JSON.parse(req.body.options) : req.body.options;
      } catch (e) { }
    }

    const extractedData = await executeExtractionPipeline({
      filePath,
      fileName,
      fileMimeType: req.file.mimetype,
      sessionId,
      extractionMode,
      modelName,
      doclingOcr,
      options
    });

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

// Process a file that was already uploaded to Supabase / Vercel Blob (Big File Processing)
app.post('/api/process-blob', async (req, res) => {
  const { url, sessionId = 'default', fileName: clientFileName, fileType, pipeline, modelName: bodyModelName, options } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    await assertSafeExternalUrl(url, { allowedHosts: getTrustedStorageHosts() });
    console.log(`📦 [Process-Blob] Starting extraction for: ${url}`);

    // Stream the file directly from Blob to /tmp to avoid double-buffering large files in RAM
    const tempDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
    await fs.mkdir(tempDir, { recursive: true });

    let rawName = clientFileName || '';
    if (!rawName && url) {
      try {
        const parsed = new URL(url);
        rawName = decodeURIComponent(path.basename(parsed.pathname));
      } catch (e) { }
    }

    const safeBaseName = (rawName ? path.basename(rawName, path.extname(rawName)) : `large_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const tempDownloadPath = path.join(tempDir, `${safeBaseName}_${Date.now()}.part`);

    const response = await safeAxiosGet(
      axios,
      url,
      { responseType: 'stream', timeout: 120000 },
      { allowedHosts: getTrustedStorageHosts() }
    );
    await new Promise((resolve, reject) => {
      const writer = fs_sync.createWriteStream(tempDownloadPath);
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });

    const fdHead = await fs.open(tempDownloadPath, 'r');
    const headBuf = Buffer.alloc(8);
    const { bytesRead } = await fdHead.read(headBuf, 0, 8, 0);
    await fdHead.close();

    let ext = path.extname(rawName).toLowerCase();
    if (!ext || ext === '.bin' || ext === '.tmp') {
      if (bytesRead >= 4 && headBuf[0] === 0x25 && headBuf[1] === 0x50 && headBuf[2] === 0x44 && headBuf[3] === 0x46) {
        ext = '.pdf';
      } else if (bytesRead >= 4 && headBuf[0] === 0x50 && headBuf[1] === 0x4B && headBuf[2] === 0x03 && headBuf[3] === 0x04) {
        ext = '.xlsx';
      } else if (bytesRead >= 4 && headBuf[0] === 0xD0 && headBuf[1] === 0xCF && headBuf[2] === 0x11 && headBuf[3] === 0xE0) {
        ext = '.xls';
      } else if (bytesRead >= 4 && headBuf[0] === 0x89 && headBuf[1] === 0x50 && headBuf[2] === 0x4E && headBuf[3] === 0x47) {
        ext = '.png';
      } else if (bytesRead >= 3 && headBuf[0] === 0xFF && headBuf[1] === 0xD8 && headBuf[2] === 0xFF) {
        ext = '.jpg';
      } else {
        ext = rawName.toLowerCase().endsWith('.pdf') ? '.pdf' : '.xlsx';
      }
    }

    if (bytesRead >= 4 && headBuf[0] === 0x25 && headBuf[1] === 0x50 && headBuf[2] === 0x44 && headBuf[3] === 0x46) {
      ext = '.pdf';
    }

    const finalFileName = `${safeBaseName}_${Date.now()}${ext}`;
    const filePath = path.join(tempDir, finalFileName);
    await fs.rename(tempDownloadPath, filePath);

    const extractionMode = req.headers['x-extraction-mode'] || pipeline || 'parallel';
    const modelName = req.headers['x-model-name'] || bodyModelName || null;
    const doclingOcr = req.headers['x-docling-ocr'] === '1' || !!options?.doclingOcr;

    let parsedOptions = options;
    if (typeof parsedOptions === 'string') {
      try { parsedOptions = JSON.parse(parsedOptions); } catch (e) { }
    }

    const extractedData = await executeExtractionPipeline({
      filePath,
      fileName: rawName || finalFileName,
      fileMimeType: fileType || (ext === '.pdf' ? 'application/pdf' : (ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '')),
      sessionId,
      extractionMode,
      modelName,
      doclingOcr,
      options: parsedOptions
    });

    res.json({
      success: true,
      data: extractedData,
      isDirectExtraction: true,
      progress: 100,
      stage: 'Direct Extraction Complete'
    });
  } catch (error) {
    console.error('Blob processing error:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ error: status === 403 ? 'Blocked URL' : 'Failed to process blob file', details: error.message });
  }
});

// Health check fallback for some UI integrations


// Brand Management
app.get('/api/brands', async (req, res) => {
  try {
    const brands = await brandStorage.getAllBrands();
    const enrichedBrands = brands.map(b => {
      if (!b) return b;
      const logo = resolveBrandLogo(b) || b.logo || '';
      return { ...b, logo };
    });
    res.json(enrichedBrands);
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

app.get('/api/brands/:id/taxonomy', async (req, res) => {
  try {
    const brandId = req.params.id;
    const brands = await brandStorage.getAllBrands();
    const brand = brands.find(b => String(b.id) === String(brandId) || (b.name && b.name.toLowerCase().trim() === String(brandId).toLowerCase().trim()));
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    res.json({
      brandId: brand.id,
      brandName: brand.name,
      categoryTree: brand.categoryTree || {},
      categories: brand.categoryList || Object.keys(brand.categoryTree || {}),
      productCount: (brand.products || []).length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch brand taxonomy' });
  }
});

// Models availability

// Provide the current available model lists for frontend selection
app.get('/api/models/available', async (req, res) => {
  const contextStore = aiKeyStorage.getStore() || {};
  const activeKey = (contextStore.activeTier === 'billed' ? contextStore.googleApiKey : contextStore.googleFreeKey)
    || process.env.GOOGLE_FREE_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  let googleModels = [];
  if (activeKey) {
    try {
      const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${activeKey}&pageSize=200`, { timeout: 10000 });
      if (response.data && Array.isArray(response.data.models)) {
        // Feed full live model metadata directly into the dynamic Free-Tier pipeline router
        ingestLiveGoogleModels(response.data.models, 'live_api');
        googleModels = response.data.models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''));
      }
    } catch (err) {
      console.warn('[Server] Failed to fetch available models from Google API, using default fallbacks:', err.message);
    }
  }

  // If no models were fetched (offline, key invalid, etc.), use verified Free-Tier defaults
  if (googleModels.length === 0) {
    googleModels = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3-flash-preview'];
  }

  const dynamicRouting = getRouterHealthSnapshot(aiKeyStorage);
  res.json({
    google: googleModels,
    openrouter: VALID_OPENROUTER_MODELS,
    nvidia: VALID_NVIDIA_MODELS,
    defaults: {
      google: dynamicRouting.activeAssignments.matching?.[0] || googleModels[0] || 'gemini-3.5-flash-lite',
      openrouter: OPENROUTER_MODEL,
      nvidia: NVIDIA_MODEL
    },
    routing: dynamicRouting
  });
});

// Inspect live dynamically-discovered per-pipeline model assignments and active failover cooldowns
app.get('/api/models/routing-status', async (req, res) => {
  const contextStore = aiKeyStorage.getStore() || {};
  const activeKey = (contextStore.activeTier === 'billed' ? contextStore.googleApiKey : contextStore.googleFreeKey)
    || process.env.GOOGLE_FREE_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
  await ensureLiveCatalogSynced(activeKey);
  res.json(getRouterHealthSnapshot(aiKeyStorage));
});

// Force-refresh live Google model catalog on demand (0 generation tokens consumed)
app.post('/api/models/refresh-routing', async (req, res) => {
  const contextStore = aiKeyStorage.getStore() || {};
  const activeKey = (contextStore.activeTier === 'billed' ? contextStore.googleApiKey : contextStore.googleFreeKey)
    || process.env.GOOGLE_FREE_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
  await refreshLiveGoogleCatalog(activeKey, { force: true });
  res.json(getRouterHealthSnapshot(aiKeyStorage));
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
const SCRAPED_CHROME_MODELS = /^(products?|furniture|seating|walls|previous|next|colour chart|color chart|find out more|filter|whistleblowing|privacy policy|contact us|environment|executive systems?|operative systems?|collaborative systems?|collaborative seating|armchairs and sofas|chairs and stools|we make space.*)$/i;

function isScrapedChromeEntry(p, knownModelSet = null) {
  if (!p || !p.model) return true;
  const m = String(p.model).trim();
  const s = String(p.subCategory || '').trim();
  if (SCRAPED_CHROME_MODELS.test(m) || /^(find out more|whistleblowing)$/i.test(s)) return true;
  // Exclude secondary subtitle/designer cards when subCategory itself names another real model (e.g. "Paolo Pampanoni [DIVO]")
  if (knownModelSet && s) {
    const mNorm = m.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sNorm = s.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (sNorm && mNorm !== sNorm && knownModelSet.has(sNorm)) return true;
  }
  return false;
}

function cleanBracketedTagsFromMatchQuery(text = '') {
  const raw = String(text || '').trim();
  const stripped = raw.replace(/^(\s*\[[^\]]{1,45}\]\s*)+/, '').trim();
  return stripped.split(/\s+/).length >= 3 ? stripped : raw;
}

const ARCHETYPE_BUCKETS = new Set([
  'pod', 'windowTreatment', 'fitout', 'screen', 'highStool', 'highTable', 'coffeeTable',
  'foldingTable', 'conferenceTable', 'receptionDesk', 'workstation', 'desking', 'sofa',
  'armchair', 'seating', 'storage', 'bed'
]);

function getArchetypeBucket(text = '', extraProduct = null) {
  const raw = String(text || '');
  // Strip paint/color compounds like "coffee-colored" so finish colors never trigger coffeeTable
  const s = raw.toLowerCase().replace(/\bcoffee[-\s]+(?:colored|coloured|brown|matte|paint|finish)\b/g, 'brown finish');
  const firstLine = !extraProduct ? raw.split(/[\r\n|]+/)[0].trim().toLowerCase() : '';
  const prodDescPrefix = extraProduct ? String(extraProduct.description || '').trim().slice(0, 60).toLowerCase() : '';
  const prodDescFull = extraProduct ? String(extraProduct.description || '').toLowerCase() : '';
  const prodSub = extraProduct ? String(extraProduct.subCategory || '').toLowerCase() : '';
  const prodModel = extraProduct ? String(extraProduct.model || '').toLowerCase() : '';

  const hasPod = !/\b(sofa booth|booth seating|banquette)\b/.test(s)
    && (/\b(acoustic pods?|phone booths?|meeting pods?|work pods?|soundproof booths?|acoustic booths?|silence booths?|silent\s*room|room-in-room|sonus)\b/.test(s)
      || /\b(acoustic\s*pods?|phone\s*booths?|pods?|booths?)\b/.test(prodSub));
  if (hasPod) return 'pod';

  const hasWindowTreatment = /\b(electric\s*curtain|motorized\s*curtain|motorized\s*lift\s*curtain|curtain\s*(?:blackout|sunscreen|roller|track|lift)|roller\s*blinds?|blackout\s*blinds?|sunscreen\s*blinds?|venetian\s*blinds?|vertical\s*blinds?|window\s*blinds?|window\s*curtains?|drapery|sheer\s*curtain)\b/.test(s)
    || /\bwindow\s*treatments?\b/.test(prodSub);
  if (hasWindowTreatment) return 'windowTreatment';

  const hasFitout = /\b(carpet tile|carpet flooring|tufted nylon carpet|prayer room carpet|carpet with underlay|carpet for\b|porcelain tile|ceramic tile|tile flooring|vinyl flooring|marble flooring|stone flooring|gypsum ceiling|false ceiling|mineral fiber ceiling|acoustic ceiling|partition wall|drywall partition|glass partition|swing door|sliding door|skirting|wall cladding|pantry cabinet|pantry sink)\b/.test(s)
    && !/\b(mobile|freestanding|desk screen|privacy screen|conference table|meeting table|task chair|office chair|workstation|credenza|cupboard|bookcase|wardrobe|locker|pedestal)\b/.test(s);
  if (hasFitout) return 'fitout';

  // Beds (bunk / single / hostel beds) never cross-match seating, desks or storage
  if (isBedSpecHeadline(extraProduct ? `${prodModel} ${prodSub}` : (firstLine || s.slice(0, 160)))) return 'bed';

  // Product-level strict opening-sentence overrides (Bistro / Standing / Media Walls / Folding Flip-Top)
  if (extraProduct) {
    if (/^media\s*walls?\./i.test(prodDescPrefix) || /\bmedia\s*conference\s*wall\b/.test(prodModel)) return 'screen';
    if (/^bistro\s*tables?\./i.test(prodDescPrefix) || /\bzoo\s*zoo\b|\bzoozoo\b/.test(prodModel)) return 'coffeeTable';
    if (/^standing\s*tables?\./i.test(prodDescPrefix) || /\bhigh\s*tables?\b/.test(prodSub)) return 'highTable';
    if (/\b(flip[-\s]?top|foldable\s*(?:conference|meeting|training)?\s*(?:table|desk)|folding\s*(?:conference|meeting|training)?\s*(?:table|desk)|tilt[-\s]?top)\b/.test(`${prodModel} ${prodSub} ${prodDescFull}`)
      || (/\b(table|desk)\b/.test(`${prodModel} ${prodSub}`) && /\b(desktop\s+that\s+can\s+be\s+flipped|flip[-\s]?top\s+lock|foldable\s+conference)\b/.test(prodDescFull))) {
      return 'foldingTable';
    }
  }

  // Primary-subject headline overrides for multi-line BOQ specs (avoid footnotes like "refer to desk" or "- modesty panel" overriding the item)
  if (!extraProduct && firstLine) {
    if (/^(high\s+|low\s+|filing\s+)?cabinets?\b|\b(filing\s*racks?|mobile\s*filing|mobile\s*shelving|compactor|shoe\s*rack|coat\s*rack|storage\s*rack|wardrobe|credenza|bookcase|lockers?)\b/.test(firstLine)) {
      return 'storage';
    }
    if (/\b(podium|lectern)\b/.test(firstLine)) return 'desking';
    if (/\b(high\s*table|standing\s*table|bar\s*table|cocktail\s*table)\b/.test(firstLine)) return 'highTable';
    if (/\b(movable|mobile|folding|foldable|flip[-\s]?top|tilt[-\s]?top|nesting)\s+(?:\w+\s+){0,2}(table|desk)s?\b/.test(firstLine)
      && !/\b(chair|chairs|stool|stools)\b/.test(firstLine)) {
      return 'foldingTable';
    }
    if (/\b(office\s*desk|executive\s*desk|manager(?:ial)?\s*desk|l[-\s]?shape(?:d)?\s*desk|single\s*desk|staff\s*desk|workstation|study\s*desk|computer\s*desk|height\s*adjustable\s*desk|sit[-\s]?stand\s*desk)\b/.test(firstLine)
      && !/\b(desk\s*screen|privacy\s*screen|acoustic\s*screen|desk\s*lamp|desk\s*pad|desk\s*mat|desk\s*organizer|cable\s*tray)\b/.test(firstLine)) {
      return 'workstation';
    }
    if (/\b(meeting\s*(?:room\s*)?table|conference\s*table|boardroom\s*table|training\s*table)\b/.test(firstLine)) {
      const hasExplicitWheelOrFoldBody = /\b(flip[-\s]?top|foldable|folding|tilt[-\s]?top|wheels?\s+with|with\s+wheels|castors?|casters?)\b/.test(s)
        && !/\b([89]|[1-9]\d+)\s*[-\s]?(pax|persons?|people|seaters?|seats?)\b|\bboardroom\b/.test(s);
      return hasExplicitWheelOrFoldBody ? 'foldingTable' : 'conferenceTable';
    }
    if (/\b(single\s*seater|1[\s-]?seater|one\s*seater|armchair|lounge\s*chair|club\s*chair|tub\s*chair)\b/.test(firstLine)
      && !/\b(2[\s-]?seater|3[\s-]?seater|two\s*seater|three\s*seater)\b/.test(firstLine)) {
      return 'armchair';
    }
    if (/\b(chair|chairs|stool|stools)\b/.test(firstLine) && !/\b(table|desk|sofa|armchair|lounge\s*chair)\b/.test(firstLine)) {
      if (/\b(high\s*chair|bar\s*stool|counter\s*stool)\b/.test(firstLine)) return 'highStool';
      return 'seating';
    }
  }

  const hasScreenOrAccessory = /\b(acoustic\s*screens?|desk\s*screens?|privacy\s*screens?|divider\s*screens?|room\s*dividers?|modesty\s*panels?|acoustic\s*panels?|baffles?|cable\s*(trays?|management|grommets?|channels?)|wire\s*management|monitor\s*arms?|cpu\s*holders?|power\s*modules?)\b/.test(s)
    || /\b(acoustic\s*screens?|screens?|partitions?|dividers?|accessories|cable\s*management|wire\s*management)\b/.test(prodSub);
  const isStandaloneScreenHeadline = /\b(acoustic\s*screen|desk\s*screen|privacy\s*screen|room\s*divider|divider\s*screen|modesty\s*panel\s*only|cable\s*tray|wire\s*management|monitor\s*arm|power\s*box\s*only)\b/.test(firstLine);
  const isDeskWithAddon = !extraProduct && !isStandaloneScreenHeadline
    && /\b(desk|workstation|table|bench)\b/.test(firstLine || s)
    && /\b(modesty|screen|cable|wire\s*box|panel|power|drawer|pedestal)\b/.test(s);
  if (hasScreenOrAccessory && !isDeskWithAddon) return 'screen';

  const hasHighStool = /^bar\s*stools?\./i.test(prodDescPrefix)
    || /\b(high chair|high chairs|bar stool|bar stools|counter stool|counter stools|bar chair|tall stool)\b/.test(s)
    || /\bhigh\s*chairs?\b/.test(prodSub);
  if (hasHighStool) return 'highStool';

  const hasCoffeeTable = /^coffee\s*tables?\./i.test(prodDescPrefix)
    || (!/\bwith\s+(?:a\s+)?(side|coffee)\s*table\b/.test(s) && /\b(coffee table|coffee tables|side table|center table|occasional table|low table)\b/.test(s))
    || /\b(coffee|low|side)\s*tables?\b/.test(prodSub);
  if (hasCoffeeTable) return 'coffeeTable';

  const hasReception = /^counters?\./i.test(prodDescPrefix)
    || /\b(reception counter|reception desk|reception furniture)\b/.test(s)
    || /\breception\b/.test(prodSub);
  if (hasReception) return 'receptionDesk';

  const hasFoldingTable = !/\b(chair|chairs|stool|stools)\b/.test(s) && (
    /\b(flip[-\s]?top|foldable\s*(?:meeting|conference|training)?\s*(?:table|desk)|folding\s*(?:meeting|conference|training)?\s*(?:table|desk)|movable\s*(?:meeting|conference|training)?\s*table)\b/.test(s)
    || (/\b(training|meeting|conference)\s*table\b/.test(s) && /\b(black\s*wheels|wheels?\s+with|lockable\s*wheels|castors?|casters?)\b/.test(s) && !/\b([89]|[1-9]\d+)\s*[-\s]?(pax|persons?|people|seaters?|seats?)\b|\bboardroom\b/.test(s))
  );
  if (hasFoldingTable) return 'foldingTable';

  const hasConfTable = /\b(conference table|conference tables|meeting table|meeting tables|meeting room table|boardroom table)\b/.test(s)
    || /\b(conference|meeting)\s*tables?\b/.test(prodSub);
  const hasWorkstation = /^desks?\./i.test(prodDescPrefix)
    || /\b(workstation|workstations|bench system|benching|cluster desk|executive desk|executive furniture|manager desk|manager office desk|office desk|rectangular\s+(?:\w+\s+)?desk|study desk|l-shaped desk|desk\s*\d+)\b/.test(s)
    || /\b(desks|benching|workstations|manager tables)\b/.test(prodSub);
  const hasGenericTable = /\b(desk|table|lectern|podium)\b/.test(s);
  const hasStorage = /\b(cabinet|cabinets|locker|lockers|credenza|credenzas|pedestal|pedestals|bookcase|shelving|storage|filing\s*racks?|mobile\s*filing|systemfile|lateral\s*files?|shoe\s*rack)\b/.test(s);
  const hasSofa = /^sofas?\./i.test(prodDescPrefix)
    || (/\b(sofa|sofas|couch|two seater|three seater|2-seater|3-seater|l-shaped modular lounge|modular lounge seating)\b/.test(s)
      && !/\b(armchair|single\s*seater|1[\s-]?seater|one\s*seater|tub chair)\b/.test(s));
  const hasArmchair = /^(armchairs?|poufs?)\./i.test(prodDescPrefix)
    || (/\b(armchair|armchairs|pouf|poufs|ottoman|lounge chair|tub chair|single\s*seater|1[\s-]?seater|one\s*seater)\b/.test(s)
      && !/\b(2[\s-]?seater|3[\s-]?seater|two\s*seater|three\s*seater)\b/.test(s))
    || /\b(armchairs|poufs|lounge chairs|lounges)\b/.test(prodSub);
  const hasChair = /\b(chair|chairs|seating|stool|stools)\b/.test(s);

  if (hasArmchair && (extraProduct || !hasSofa)) return 'armchair';
  if (hasSofa && !hasChair) return 'sofa';
  if (hasConfTable && !hasChair) return 'conferenceTable';
  if (hasWorkstation && !hasChair) return 'workstation';
  if (hasGenericTable && !hasChair) return 'desking';
  if ((hasChair || hasArmchair || hasSofa) && !hasGenericTable && !hasStorage) {
    if (hasArmchair && !hasChair) return 'armchair';
    if (hasSofa) return 'sofa';
    return 'seating';
  }
  if (hasStorage && !hasChair && !hasGenericTable && !hasWorkstation && !hasConfTable) return 'storage';
  return '';
}

function isArchetypeConflict(targetTextOrBucket, product) {
  if (!targetTextOrBucket || !product) return false;
  const targetStr = String(targetTextOrBucket || '').trim();
  const targetBucket = ARCHETYPE_BUCKETS.has(targetStr) ? targetStr : getArchetypeBucket(targetStr);

  // Inspect model + taxonomy + opening descriptor sentence only (avoid downstream "also offers reception/storage" blurbs)
  const descOpening = String(product.description || '').split(/\.\s+/)[0].slice(0, 60);
  const prodDescFull = String(product.description || '').toLowerCase();
  const prodModelLower = String(product.model || '').toLowerCase();
  const prodSubLower = String(product.subCategory || '').toLowerCase();
  const prodText = `${product.model || ''} ${product.mainCategory || ''} ${product.subCategory || ''} ${descOpening}`;
  const candBucket = getArchetypeBucket(prodText, product);

  // Acoustic pods / phone booths must NEVER match non-pod specifications even when targetBucket is broad/empty
  if (candBucket === 'pod' && targetBucket !== 'pod') {
    return true;
  }

  // Window treatments (curtains, roller blinds) must NEVER cross-match furniture (counters, desks, chairs, storage)
  if ((targetBucket === 'windowTreatment' && candBucket !== 'windowTreatment')
    || (candBucket === 'windowTreatment' && targetBucket !== 'windowTreatment')) {
    return true;
  }

  if (!targetBucket) return false;

  // Guard workstations against products whose photo is a storage cabinet
  if (targetBucket === 'workstation' && /storage-cabinet/i.test(String(product.imageUrl || ''))) {
    return true;
  }

  // Large multi-pax conference/boardroom tables must match fixed contract conference/meeting tables,
  // NEVER small round tables, bistro/coffee tables, single flip-top/folding desks, media walls, or plain single desks.
  if (!ARCHETYPE_BUCKETS.has(targetStr) && targetBucket === 'conferenceTable') {
    const tLower = targetStr.toLowerCase();
    const wantsLargeBoardroom = (/\b([89]|[1-9]\d+)\s*[-\s]?(pax|persons?|people|seaters?|seats?)\b|\bw?\s*([3-9]\d{3}|[1-9]\d{4})\s*[x×]|\b(rectangular|boat[-\s]?shaped|boardroom)\b/i.test(tLower))
      && !/\bround\b/i.test(tLower);
    if (wantsLargeBoardroom) {
      const isRoundProd = /\bround\b/i.test(prodModelLower) || /\bround\s+tabletops?\b/i.test(prodDescFull);
      const isFoldingProd = /\b(flip[-\s]?top|foldable|folding|casters?|castors?)\b/i.test(`${prodModelLower} ${prodDescFull}`);
      const isBistroOrCoffeeProd = /\b(bistro\s*tables?|coffee\s*tables?|zoo\s*zoo|zoozoo)\b/i.test(`${prodModelLower} ${prodDescFull}`);
      const isPlainSingleDesk = /^desks?\./i.test(prodDescFull.trim())
        && !/\bconference\s*tables?\b/i.test(prodSubLower)
        && !/\bexecutive\s+furniture\b/i.test(prodDescFull);
      if (isRoundProd || isFoldingProd || isBistroOrCoffeeProd || isPlainSingleDesk) {
        return true;
      }
    }
  }

  // Heavy-duty / mechanical mobile / steel filing systems must NEVER match open decorative room-divider shelving or tiny underdesk pedestals
  if (!ARCHETYPE_BUCKETS.has(targetStr) && targetBucket === 'storage') {
    const tLower = targetStr.toLowerCase();
    const wantsClosedOrMobileFiling = /\b(mechanical\s*mobile\s*filing|mobile\s*filing|mobile\s*shelving|compactor|high[\s-]?density\s*(?:filing|shelving)|filing\s*racks?|arch\s*file|box\s*file|udl\s*load|steel\s*filing|metal\s*filing|lockable\s*filing)\b/i.test(tLower);
    if (wantsClosedOrMobileFiling) {
      const prodCombined = `${prodModelLower} ${prodSubLower} ${prodDescFull}`;
      const isOpenDividerOrUnrelated = /\b(conference\s*walls?|shaping\s+and\s+dividing\s+spaces|room\s*divider|open\s+modular\s+divider|combus|phylo|coat\s*rack|clothes\s*rack|coat\s*hanger|magazine\s*rack|mainframe\s*bracket|easel|planter|personal\s*pedestal|underdesk|desk\s*storage)\b/i.test(prodCombined)
        || (/^pedestals?\./i.test(prodDescFull.trim()) && !/\btall\b/i.test(prodModelLower))
        || (/\bpedestals?\b/i.test(prodSubLower) && !/\btall\b/i.test(prodModelLower));
      if (isOpenDividerOrUnrelated) {
        return true;
      }
    }
  }

  // Visitor / Cantilever / 4-Leg chairs must not match 5-star swivel task/staff chairs
  if (!ARCHETYPE_BUCKETS.has(targetStr) && targetBucket === 'seating') {
    const tLower = targetStr.toLowerCase();
    const wantsVisitorCantilever = /\b(visitor\s*chair|guest\s*chair|cantilever|4[\s-]?leg|sled\s*base)\b/i.test(tLower)
      && !/\b(task\s*chair|swivel|5[\s-]?star|operator\s*chair|ergonomic\s*task)\b/i.test(tLower);
    if (wantsVisitorCantilever) {
      const isSwivelTaskCand = /\b(task\s*chairs?|staff\s*chairs?|operator\s*chairs?|swivel\s*task)\b/i.test(`${prodModelLower} ${prodSubLower} ${prodDescFull.slice(0, 120)}`)
        && !/\b(visitor|guest|cantilever|conference\s*chair|4[\s-]?leg|sled)\b/i.test(`${prodModelLower} ${prodSubLower} ${prodDescFull.slice(0, 140)}`);
      if (isSwivelTaskCand) return true;
    }
  }

  if (!candBucket) return false;
  if (candBucket === targetBucket) return false;

  // Allow compatible subtypes within broad umbrellas while blocking genuine category mismatches
  if (targetBucket === 'desking' && ['workstation', 'conferenceTable', 'receptionDesk'].includes(candBucket)) return false;
  if (candBucket === 'desking' && ['workstation', 'conferenceTable', 'receptionDesk'].includes(targetBucket)) return false;
  if (targetBucket === 'seating' && candBucket === 'armchair') {
    return !/\b(lounge|club|tub|waiting|reception)\b/i.test(targetStr);
  }
  return true;
}

function filterValidFitoutProducts(products = []) {
  if (!Array.isArray(products)) return [];
  const valid = products.filter(p => {
    if (!p || !p.model) return false;
    const price = parseFloat(p.price || 0);
    const desc = String(p.description || '');
    if (price <= 0 && /not publicly available|could not be found|no official product/i.test(desc)) return false;
    return true;
  });
  return valid.length > 0 ? valid : products;
}

const FITOUT_DETERMINISTIC_RULES = [
  { rx: /\b(electric\s*curtain|motorized\s*curtain|window\s*curtain|roller\s*blinds?|blackout\s*blinds?|sunscreen\s*blinds?|venetian\s*blinds?|vertical\s*blinds?|window\s*blinds?|drapery|curtain)\b/i, subRx: /window\s*treatment/i },
  { rx: /\b(prayer\s*room\s*carpet|wall[\s-]?to[\s-]?wall\s*carpet|carpet\s*with\s*underlay|carpet\s*tile|broadloom|carpet)\b/i, subRx: /carpet/i },
  { rx: /\b(marble|stone\s*floor|granite|porcelain|ceramic)\b/i, subRx: /stone\s*floor|wet\s*work/i },
  { rx: /\b(self\s*leveling|screed)\b/i, subRx: /preparation/i },
  { rx: /\b(wood\s*slat|timber\s*ceiling|wood\s*ceiling)\b/i, subRx: /wood\s*ceiling/i },
  { rx: /\b(acoustic\s*ceiling|gypsum\s*ceiling|false\s*ceiling|suspended\s*ceiling|mineral\s*fiber)\b/i, subRx: /acoustic\s*ceiling|ceiling/i },
  { rx: /\b(frosted\s*glass)\b/i, subRx: /specialized\s*glass/i },
  { rx: /\b(glass\s*partition|toughened\s*glass)\b/i, subRx: /glass\s*partition/i },
  { rx: /\b(acoustic\s*partition|acoustic\s*panel)\b/i, subRx: /acoustic\s*partition/i },
  { rx: /\b(gypsum\s*partition|drywall|masonry)\b/i, subRx: /masonry|gypsum/i },
  { rx: /\b(wood\s*cladding|veneer\s*cladding|fluted\s*panel)\b/i, subRx: /wood\s*cladding/i },
  { rx: /\b(metal\s*cladding|stainless\s*steel\s*trim)\b/i, subRx: /metal\s*cladding|finishing/i },
  { rx: /\b(sliding\s*door|swing\s*door|glass\s*door|wooden\s*door)\b/i, subRx: /door/i },
  { rx: /\b(skirting)\b/i, subRx: /skirting/i },
  { rx: /\b(wallpaper)\b/i, subRx: /wallpaper/i },
  { rx: /\b(mirror)\b/i, subRx: /mirror/i },
  { rx: /\b(artwork|art\s*work|painting)\b/i, subRx: /artwork/i },
  { rx: /\b(pantry\s*cabinet|custom\s*cabinet|overhead\s*cabinet|base\s*cabinet)\b/i, subRx: /custom\s*cabinet/i },
  { rx: /\b(whiteboard)\b/i, subRx: /specialized\s*unit/i },
  { rx: /\b(ablution|sink|vanity|sanitary)\b/i, subRx: /plumbing|sanitary/i }
];

function matchFitoutCatalogDeterministic(desc = '', internalProducts = []) {
  if (!desc || !Array.isArray(internalProducts) || internalProducts.length === 0) return null;
  const low = String(desc).toLowerCase();
  const matchedRule = FITOUT_DETERMINISTIC_RULES.find(r => r.rx.test(low));
  const tokens = low.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3);

  let best = null;
  let bestScore = 0;

  for (const p of internalProducts) {
    const sub = String(p.subCategory || '').toLowerCase();
    const text = `${p.model || ''} ${p.mainCategory || ''} ${sub} ${p.description || ''}`.toLowerCase();
    let score = 0;
    if (matchedRule && matchedRule.subRx.test(sub)) {
      score += 100;
    }
    if (/\bwall[\s-]?to[\s-]?wall|underlay|prayer\s*room\b/.test(low) && /\bwall\s*to\s*wall|underlay\b/.test(text)) {
      score += 20;
    }
    for (const t of tokens) {
      if (text.includes(t)) score += 3;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  if (!best || bestScore < 50) return null;
  return {
    status: 'success',
    product: {
      ...best,
      brand: 'FitOut V2',
      matchScore: Math.min(0.95, bestScore / 120),
      logic: `Deterministic FitOut catalog match (${best.subCategory || best.model})`
    }
  };
}

function inferMainCategoryFromSubCategory(subCat = '') {
  if (!subCat) return '';
  const target = String(subCat).toLowerCase().trim();
  for (const [mainKey, subMap] of Object.entries(TAXONOMY)) {
    if (subMap && Object.keys(subMap).some(s => s.toLowerCase().trim() === target)) {
      return mainKey;
    }
  }
  return '';
}

async function resolveFitoutCatalogMatch(req, desc, requestedTier = 'mid', provider = 'google', providerModel = null, { normalizeCategory = true, skipLlm = false } = {}) {
  const tierNorm = String(requestedTier || 'mid').toLowerCase().trim();
  let dbName = 'fitout_v2-mid.json';
  if (tierNorm === 'budget' || tierNorm === 'budgetary') {
    dbName = 'fitout_v2-budgetary.json';
  } else if (tierNorm === 'high' || tierNorm === 'premium') {
    dbName = 'fitout_v2-high.json';
  }

  let dbPath = path.join(__dirname, 'data', 'brands', dbName);
  try {
    await fs.access(dbPath);
  } catch {
    dbPath = path.join(__dirname, 'data', 'brands', 'fitout_v2-mid.json');
  }

  console.log(`  🔍 [VE Fitout] Loading local database: ${dbPath}`);
  const dbRaw = await fs.readFile(dbPath, 'utf-8');
  const dbData = JSON.parse(dbRaw);
  const internalProducts = filterValidFitoutProducts(dbData.products || []);

  const tierLabel = dbName.replace('fitout_v2-', '').replace('.json', '');
  let matchResult = null;
  if (!skipLlm) {
    try {
      matchResult = await matchFitoutItem(desc, internalProducts, tierLabel, provider, providerModel);
    } catch (llmFitoutErr) {
      console.warn(`  ⚡ [VE Fitout Local Fallback] LLM fitout matcher failed (${llmFitoutErr.message}) — falling back to deterministic catalog matcher.`);
    }
  }
  if (!matchResult || matchResult.status !== 'success' || !matchResult.product) {
    matchResult = matchFitoutCatalogDeterministic(desc, internalProducts);
  }
  if (!matchResult || matchResult.status !== 'success' || !matchResult.product) {
    return null;
  }

  const p = { ...matchResult.product };
  let subCat = p.subCategory || 'full height partition wall';
  let mainCat = p.mainCategory || p.category || inferMainCategoryFromSubCategory(subCat) || 'Partitions & Wall Cladding';
  if (normalizeCategory) {
    mainCat = Object.keys(TAXONOMY).find(c => c.toLowerCase() === mainCat.toLowerCase()) || mainCat || 'Partitions & Wall Cladding';
    const subCats = TAXONOMY[mainCat] ? Object.keys(TAXONOMY[mainCat]) : [];
    subCat = subCats.find(s => s.toLowerCase() === subCat.toLowerCase()) || subCat || (subCats[0] || 'full height partition wall');
  }

  if (p.imageUrl) p.imageUrl = toProxiedImageUrl(req, p.imageUrl);
  if (Array.isArray(p.images)) {
    p.images = p.images.map(img => toProxiedImageUrl(req, img));
  }

  console.log(`  ✨ [VE Fitout Success] Found internal match: "${p.model}" (Category: ${mainCat} / ${subCat})`);
  return {
    status: 'success',
    product: {
      ...p,
      brand: 'FitOut V2',
      brandLogo: '',
      mainCategory: mainCat,
      subCategory: subCat
    },
    identifiedModel: p.model
  };
}

function buildCatalogHints(rawProducts = []) {
  const subtitleHints = new Map();
  const knownModelSet = new Set();

  for (const p of rawProducts) {
    if (!p?.model || SCRAPED_CHROME_MODELS.test(String(p.model).trim())) continue;
    if (/^(seating|furniture|desks|office chairs|visitor chairs|conference chairs|task chairs|executive chairs|meeting tables|conference tables|tables|discovery)$/i.test(String(p.subCategory || '').trim())) {
      knownModelSet.add(String(p.model).toLowerCase().replace(/[^a-z0-9]/g, ''));
    }
  }

  for (const p of rawProducts) {
    if (!p?.model || !p?.subCategory) continue;
    const mNorm = String(p.model).toLowerCase().replace(/[^a-z0-9]/g, '');
    const sNorm = String(p.subCategory).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (sNorm && mNorm !== sNorm && knownModelSet.has(sNorm)) {
      const m = String(p.model).trim();
      if (!/^(previous|next|colour chart|color chart|csr .+)$/i.test(m) && !subtitleHints.has(sNorm)) {
        subtitleHints.set(sNorm, m);
      }
    }
  }
  return { knownModelSet, subtitleHints };
}

function deriveProductHint(p, subtitleHints) {
  const modelClean = String(p.model || '').replace(/\s*#\d+\s*$/, '').trim();
  const desc = String(p.description || '').replace(/\s+/g, ' ').trim();
  if (desc && desc.length >= 18 && desc.toLowerCase() !== modelClean.toLowerCase()) {
    return desc.length > 55 ? `${desc.slice(0, 52).trim()}...` : desc;
  }
  const mNorm = modelClean.toLowerCase().replace(/[^a-z0-9]/g, '');
  const subHint = subtitleHints?.get(mNorm) || '';
  let fileHint = '';
  if (p.imageUrl && /^https?:/i.test(p.imageUrl)) {
    try {
      const base = new URL(p.imageUrl).pathname.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
      const cleaned = base.replace(/[-_]+/g, ' ').replace(/\b(thumb|ok|scaled|\d+)\b/gi, '').replace(/\s+/g, ' ').trim();
      if (cleaned && cleaned.toLowerCase() !== mNorm && cleaned.length >= 4) {
        fileHint = cleaned;
      }
    } catch { }
  }
  return [subHint, fileHint].filter(Boolean).join('; ');
}

function scoreCatalogMatchPriority(p, boqTokens, fullText) {
  let score = p.verified ? 2 : 0;
  if (/^discovery$/i.test(String(p.subCategory || '').trim())) score -= 12;
  if (/img\.architonic\.com\/img_pro/i.test(String(p.imageUrl || ''))) score -= 12;
  for (const tok of boqTokens) {
    if (fullText.includes(tok)) score += 3;
  }
  return score;
}

function scopeCatalogProductsForQuery(rawProducts = [], enrichedDescription = '') {
  const { knownModelSet, subtitleHints } = buildCatalogHints(rawProducts);
  let products = rawProducts.filter(p => !isScrapedChromeEntry(p, knownModelSet) && !isArchetypeConflict(enrichedDescription, p));

  const validImaged = products.filter(p =>
    p.imageUrl &&
    !isBadOrLogoUrl(p.imageUrl) &&
    !/img\.architonic\.com\/img_pro/i.test(p.imageUrl) &&
    !/^ai-suggested$/i.test(p.source || '') &&
    p.verified !== false
  );
  if (validImaged.length >= 6) {
    products = validImaged;
  }

  const hintOf = (p) => deriveProductHint(p, subtitleHints);
  const fullTextOf = (p) => `${p.model || ''} ${p.mainCategory || ''} ${p.subCategory || ''} ${p.description || ''} ${hintOf(p)}`.toLowerCase();

  const wantArchetype = getArchetypeBucket(enrichedDescription);
  const wantsIndividualChair = /\bchair\b/i.test(enrichedDescription) && !/\b(bench|sofa|couch|loveseat|booth|pod|stool)\b/i.test(enrichedDescription);
  const wantsDeskOrTable = ['desking', 'workstation', 'conferenceTable', 'coffeeTable', 'receptionDesk'].includes(wantArchetype);

  if (wantArchetype === 'seating') {
    let seatingProds = products.filter(p => /\b(chair|seating|stool|armchair|sofa|pouf|bench|seduta|sedie|poltrona)\b/.test(fullTextOf(p)));
    if (wantsIndividualChair) {
      const chairOnly = seatingProds.filter(p => {
        const txt = fullTextOf(p);
        const isLoungeOrBenchOrStool = /\b(sofa|couch|pouf|ottoman|bench|soft seating|collaborative seating|armchairs and sofas|lounge chair|waiting zone|waiting area|bar stool|high stool|low stool|high chair)\b/.test(txt);
        const isTaskTrainingVisitor = /\b(training|nesting|stacking|visitor|conference|task chair|office chair|executive chair|operative|seduta operativa|chair 4 legs|chairs and stools)\b/.test(txt);
        return !isLoungeOrBenchOrStool || (isTaskTrainingVisitor && !/\b(lounge chair|bar stool|bench)\b/.test(txt));
      });
      if (chairOnly.length >= 2) seatingProds = chairOnly;
    }
    if (seatingProds.length >= 2) products = seatingProds;
  } else if (wantsDeskOrTable) {
    const deskingProds = products.filter(p => {
      const txt = fullTextOf(p);
      const isNonDesk = /\b(seating|chair|stool|armchair|sofa|pouf|phone booth|acoustic booth|reception counter|counters)\b/.test(txt);
      const isDesk = /\b(desk|table|workstation|flip-top|folding|conference table|meeting table)\b/.test(txt);
      return isDesk || !isNonDesk;
    });
    if (deskingProds.length >= 2) products = deskingProds;
  }

  // Rank best matching archetype/keyword candidates first so prompt cap keeps the top candidates without bloating LLM latency
  const boqTokens = [...new Set(
    String(enrichedDescription || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 3 && !/^(the|and|for|with|from|qty|unit|nos|mm|cm)$/.test(t))
  )];
  if (products.length > 100 && boqTokens.length > 0) {
    products = [...products]
      .sort((a, b) => scoreCatalogMatchPriority(b, boqTokens, fullTextOf(b)) - scoreCatalogMatchPriority(a, boqTokens, fullTextOf(a)))
      .slice(0, 120);
  }

  return { products, subtitleHints, hintOf };
}

function fuzzyFindModel(products, targetModelName, targetCategory = '') {
  if (!products || !Array.isArray(products) || !targetModelName) return null;

  const { knownModelSet } = buildCatalogHints(products);
  const cleanProducts = products.filter(p => !isScrapedChromeEntry(p, knownModelSet));
  const pool = cleanProducts.length > 0 ? cleanProducts : products;

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

  const GENERIC_SERIES_WORDS = new Set([
    'chair', 'chairs', 'seating', 'stool', 'stools', 'sofa', 'sofas', 'couch', 'armchair', 'armchairs',
    'desk', 'desks', 'table', 'tables', 'meeting', 'conference', 'coffee', 'side', 'lounge',
    'reception', 'counter', 'counters', 'furniture', 'system', 'systems', 'unit', 'units',
    'cabinet', 'cabinets', 'pedestal', 'pedestals', 'credenza', 'pod', 'booth',
    'cantilever', 'visitor', 'executive', 'manager', 'managerial', 'task', 'staff', 'swivel',
    'mesh', 'high', 'low', 'mid', 'back', 'wooden', 'wood', 'plastic', 'leather', 'fabric',
    'modular', 'curved', 'round', 'rectangular', 'boat', 'shaped', 'single', 'two', 'three',
    'seater', 'pax', 'office', 'open', 'area', 'room', 'cafe', 'dining', 'pantry'
  ]);
  const targetTokens = target.split(' ').filter(Boolean);
  // "4 tier" also reads "four tier" so counted features rank the right variant
  const fuseTarget = normalize(expandNumberWords(targetModelName));
  const numberWordTokens = fuseTarget.split(' ').filter(t => t && !targetTokens.includes(t) && !GENERIC_SERIES_WORDS.has(t));
  const coreSeriesTokens = targetTokens.length <= 6
    ? [...targetTokens.filter(t => !GENERIC_SERIES_WORDS.has(t) && (t.length >= 2 || /^[a-z0-9]$/.test(t))), ...new Set(numberWordTokens)]
    : [];

  const isCompatibleBucket = (p) => !isArchetypeConflict(targetCategory ? `${targetModelName} ${targetCategory}` : targetModelName, p);
  const hasCoreSeriesToken = (p) => {
    if (coreSeriesTokens.length === 0) return true;
    const candTokens = normalize(`${p.model || ''} ${p.family || ''}`).split(' ').filter(Boolean);
    const candJoined = candTokens.join(' ');
    const strongTokens = coreSeriesTokens.filter(t => t.length >= 3);
    const checkList = strongTokens.length > 0 ? strongTokens : coreSeriesTokens;
    return checkList.some(tok => candTokens.includes(tok) || (tok.length >= 4 && candJoined.includes(tok)));
  };

  // 1. Exact Match Check (preferring non-Discovery verified entries with compatible functional archetype)
  const isNonDiscovery = (p) => !/^discovery$/i.test(String(p?.subCategory || '').trim());
  const exactCompatibleHits = pool.filter(p => normalize(p.model) === target && isCompatibleBucket(p));
  if (exactCompatibleHits.length > 0) {
    return exactCompatibleHits.find(isNonDiscovery) || exactCompatibleHits[0];
  }
  const exactAny = pool.find(p => normalize(p.model) === target);
  if (exactAny && isCompatibleBucket(exactAny)) return exactAny;

  // Exact match on stripped core series (e.g. "Boom Sofa" -> "Boom #20327564", excluding generic Discovery stubs)
  if (coreSeriesTokens.length > 0) {
    const corePhrase = coreSeriesTokens.join(' ');
    const coreExact = pool.find(p => normalize(p.model) === corePhrase && isCompatibleBucket(p) && isNonDiscovery(p));
    if (coreExact) return coreExact;
  }

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

  const fuse = new Fuse(pool, options);
  let results = fuse.search(fuseTarget);

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

  const coreOverlapCount = (p) => {
    if (coreSeriesTokens.length === 0) return 0;
    const candTokens = normalize(`${p.model || ''} ${p.family || ''}`).split(' ').filter(Boolean);
    const candJoined = candTokens.join(' ');
    return coreSeriesTokens.filter(tok => candTokens.includes(tok) || (tok.length >= 4 && candJoined.includes(tok))).length;
  };
  const rankFuzzy = (arr) => [...arr].sort((a, b) => {
    const overlapDiff = coreOverlapCount(b.item) - coreOverlapCount(a.item);
    if (overlapDiff !== 0) return overlapDiff;
    const discA = /^discovery$/i.test(String(a.item.subCategory || '').trim()) ? 1 : 0;
    const discB = /^discovery$/i.test(String(b.item.subCategory || '').trim()) ? 1 : 0;
    if (discA !== discB) return discA - discB;
    return a.score - b.score;
  });

  // 4. Category Boosting & Archetype + Core Series Token Safety
  if (targetCategory && targetCategory.length > 2) {
    const cat = targetCategory.toLowerCase().trim();
    const catMatches = rankFuzzy(results.filter(r => {
      const mc = (r.item.mainCategory || '').toLowerCase();
      const sc = (r.item.subCategory || '').toLowerCase();
      return (mc.includes(cat) || sc.includes(cat) || cat.includes(mc) || cat.includes(sc))
        && isCompatibleBucket(r.item)
        && hasCoreSeriesToken(r.item);
    }));
    if (catMatches.length > 0 && catMatches[0].score < 0.5) {
      return catMatches[0].item;
    }
  }

  const compatibleMatches = rankFuzzy(results.filter(r => r.score <= 0.45 && isCompatibleBucket(r.item) && hasCoreSeriesToken(r.item)));
  if (compatibleMatches.length > 0) return compatibleMatches[0].item;

  // 5. Final Threshold Verification (never match wrong series on generic words alone)
  const best = results[0];
  return (best.score <= 0.35 && isCompatibleBucket(best.item) && hasCoreSeriesToken(best.item)) ? best.item : null;
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
        const internalProducts = filterValidFitoutProducts(dbData.products || []);

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
                img && img.startsWith('http') ? toProxiedImageUrl(req, img) : img
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

    // Build a clean matching description (strip leading [Location]/[Code] tags if substantial spec text follows)
    const effectiveMatchDesc = cleanBracketedTagsFromMatchQuery(description);
    const sizeContext = [qty && `Qty: ${qty}`, unit && `Unit: ${unit}`].filter(Boolean).join(', ');
    const enrichedDescription = sizeContext ? `${effectiveMatchDesc} | ${sizeContext}` : effectiveMatchDesc;

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
        const { products, hintOf } = scopeCatalogProductsForQuery(dbEntry?.products || [], enrichedDescription);

        const knownCategories = [...new Set(products.map(p => p.subCategory || p.mainCategory).filter(c => c && !/^(find out more|whistleblowing|products?)$/i.test(c)))];
        const modelList = products.slice(0, 120).map(p => {
          const catTag = [p.mainCategory, p.subCategory].filter(c => c && !/^(products?|find out more|whistleblowing)$/i.test(c)).join(' / ');
          const baseLabel = catTag ? `${p.model} [${catTag}]` : p.model;
          const hint = hintOf(p);
          return hint ? `${baseLabel} — ${hint}` : baseLabel;
        });
        const budgetTier = dbEntry?.budgetTier || 'mid';

        // Add brandCategoryRules at the end of this line
        const identity = await identifyModel(enrichedDescription, candidateBrand, provider, knownCategories, modelList, budgetTier, providerModel, brandCategoryRules);
        if (identity?.model) {
          identity.model = String(identity.model).replace(/\s*\[[^\]]*\]$/, '').trim();
        }
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
        const eligibleStage2 = localBrand.products.filter(p => !isScrapedChromeEntry(p) && !isArchetypeConflict(enrichedDescription, p));
        const dbProduct = fuzzyFindModel(eligibleStage2, identifiedModel, identifiedSubCategory || identifiedCategory);

        if (dbProduct) {
          console.log(`  ✨ [Stage 2] CACHE HIT: "${dbProduct.model}" loaded from local DB.`);
          let cachedImg = dbProduct.imageUrl || (dbProduct.images && dbProduct.images[0]) || '';
          if (cachedImg && !dbProduct.verified && !await verifyImageUrl(cachedImg, dbProduct.websiteUrl || localBrand.websiteUrl || '')) {
            console.warn(`  ⚠️ [Stage 2] Cached unverified image failed live HTTP check: "${cachedImg}". Replacing via live enrichment.`);
            cachedImg = '';
          }

          const liveMerged = await resolveAndMergeLiveProduct({
            req,
            brand: identifiedBrand,
            model: dbProduct.model,
            boqDescription: enrichedDescription,
            directUrl: dbProduct.officialProductUrl || dbProduct.productUrl || dbProduct.websiteUrl || '',
            localBrand,
            categoryHint: dbProduct.mainCategory || identifiedCategory,
            subCategoryHint: dbProduct.subCategory || identifiedSubCategory,
            familyHint: dbProduct.family || '',
            providerModel,
            currentImageUrl: cachedImg,
            currentDescription: dbProduct.description || '',
            currentPrice: dbProduct.price || 0,
            currentCurrency: dbProduct.currency || 'USD',
            persistToCatalog: true,
            requirePrice: false
          });

          return res.json({
            status: 'success',
            product: {
              ...dbProduct,
              brand: identifiedBrand,
              brandLogo: liveMerged.brandLogo || resolveBrandLogo(localBrand),
              imageUrl: liveMerged.imageUrl,
              websiteUrl: liveMerged.websiteUrl,
              productUrl: liveMerged.websiteUrl,
              description: liveMerged.description,
              price: liveMerged.price,
              currency: liveMerged.currency,
              mainCategory: liveMerged.mainCategory,
              subCategory: liveMerged.subCategory,
              family: liveMerged.family
            },
            source: 'local-database',
            identifiedModel: dbProduct.model
          });
        }
        console.log(`  📂 [Stage 2] Miss: No validated local entry for "${identifiedModel}".`);
      }

      // ── STAGE 3: DEEP SEARCH (Web Discovery + Live Official-Site Enricher) ──
      console.log(`  🌐 [Stage 3] Deep Discovery Engine engaged: searching live web for ${identifiedBrand} ${identifiedModel}...`);
      const webResult = await fetchProductDetails(identifiedBrand, identifiedModel, finalTier, provider, providerModel);
      const wp = (webResult.status === 'success' && webResult.product) ? webResult.product : {};

      const liveMerged = await resolveAndMergeLiveProduct({
        req,
        brand: identifiedBrand,
        model: wp.model || identifiedModel,
        boqDescription: enrichedDescription,
        directUrl: (wp.websiteUrl && /^https?:\/\//i.test(wp.websiteUrl)) ? wp.websiteUrl : '',
        localBrand,
        categoryHint: wp.mainCategory || identifiedCategory,
        subCategoryHint: wp.subCategory || identifiedSubCategory,
        familyHint: wp.family || '',
        providerModel,
        currentImageUrl: (wp.imageUrl && wp.imageUrl !== 'FAILED') ? wp.imageUrl : '',
        currentDescription: wp.description || '',
        currentPrice: parseFloat(wp.price) || 0,
        currentCurrency: wp.currency || 'USD',
        persistToCatalog: false,
        requirePrice: false
      });

      if (liveMerged.rawImageUrl || wp.model) {
        const newProduct = {
          ...wp,
          brand: identifiedBrand,
          model: wp.model || identifiedModel,
          family: liveMerged.family,
          mainCategory: liveMerged.mainCategory,
          subCategory: liveMerged.subCategory,
          description: liveMerged.description,
          price: liveMerged.price,
          currency: liveMerged.currency,
          websiteUrl: liveMerged.websiteUrl,
          productUrl: liveMerged.websiteUrl,
          officialProductUrl: liveMerged.websiteUrl,
          imageUrl: liveMerged.rawImageUrl || '',
          verified: Boolean(liveMerged.rawImageUrl),
          lastUpdated: new Date().toISOString(),
          source: 'AI-Discovery-Engine'
        };

        // Only persist newly discovered products to catalog DB if a live verified photo was confirmed
        if (liveMerged.rawImageUrl) {
          try {
            if (localBrand) {
              console.log(`  💾 [Stage 3] Permanently adding "${newProduct.model}" to ${identifiedBrand}...`);
              await brandStorage.addProductToBrand(identifiedBrand, localBrand.budgetTier || finalTier, newProduct);
            } else {
              console.log(`  💾 [Stage 3] Creating NEW brand "${identifiedBrand}" for permanence...`);
              const newBrand = {
                id: Date.now(),
                name: identifiedBrand,
                logo: resolveBrandLogo({ name: identifiedBrand, websiteUrl: newProduct.websiteUrl }, newProduct.websiteUrl),
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
        }

        const responseProduct = {
          ...newProduct,
          imageUrl: liveMerged.imageUrl || '',
          brandLogo: liveMerged.brandLogo || resolveBrandLogo(localBrand || { name: identifiedBrand, websiteUrl: newProduct.websiteUrl })
        };
        if (responseProduct.images && Array.isArray(responseProduct.images)) {
          responseProduct.images = responseProduct.images.map(img => toProxiedImageUrl(req, img)).filter(Boolean);
        }

        return res.json({
          status: 'success',
          product: responseProduct,
          source: 'ai-discovery-hardened',
          identifiedModel: newProduct.model
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
                img && img.startsWith('http') ? toProxiedImageUrl(req, img) : img
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
                img && img.startsWith('http') ? toProxiedImageUrl(req, img) : img
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
// AI SEMANTIC MATCH ASSISTANT (Gemini Embeddings Engine)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/ai/semantic-match', async (req, res) => {
  try {
    const {
      description,
      brand,
      category = null,
      topK = 3
    } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ status: 'error', error_message: 'Description is required' });
    }

    const clientApiKey = req.headers['x-google-api-key'] || req.headers['x-google-free-key'] || null;

    let targetProducts = [];

    if (brand && brand.trim() && brand.toLowerCase() !== 'all') {
      const allBrands = await brandStorage.getAllBrands();
      const targetBrand = allBrands.find(b => b.name && b.name.toLowerCase().trim() === brand.toLowerCase().trim());
      if (targetBrand) {
        targetProducts = (targetBrand.products || []).map(p => ({
          ...p,
          brand: targetBrand.name,
          brandLogo: targetBrand.logo || ''
        }));
      }
    } else {
      // Search across all brands in the catalog
      const allBrands = await brandStorage.getAllBrands();
      allBrands.forEach(b => {
        if (b.products && Array.isArray(b.products)) {
          targetProducts.push(...b.products.map(p => ({
            ...p,
            brand: b.name,
            brandLogo: b.logo || ''
          })));
        }
      });
    }

    if (targetProducts.length === 0) {
      return res.json({
        status: 'no_match',
        message: `No catalog products available for brand "${brand || 'All'}".`,
        matches: []
      });
    }

    const matches = await findSemanticMatches({
      description,
      brandName: brand || 'Catalog',
      products: targetProducts,
      category,
      topK: Math.min(10, Math.max(1, parseInt(topK) || 3)),
      apiKey: clientApiKey
    });

    const proxyBase = getProxyBase(req);
    const formattedMatches = matches.map(m => ({
      ...m,
      imageUrl: m.imageUrl && m.imageUrl.startsWith('https://') && !m.imageUrl.includes('image-proxy')
        ? `${proxyBase}${encodeURIComponent(m.imageUrl)}`
        : m.imageUrl,
      images: (m.images || []).map(img =>
        img && img.startsWith('https://') && !img.includes('image-proxy')
          ? `${proxyBase}${encodeURIComponent(img)}`
          : img
      )
    }));

    return res.json({
      status: 'success',
      description,
      brand: brand || 'All',
      matches: formattedMatches
    });
  } catch (error) {
    console.error('❌ [API Semantic Match Error]:', error);
    res.status(500).json({ status: 'error', error_message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VALUE ENGINEERED OFFER — Dedicated AI Matching Endpoint
// Bypasses tier isolation; uses the exact VE prompt spec:
//   Option 0 (prescan)  : Quick global scan of table to discover contract brands & models
//   Option 1 (simple)   : "What is the best Model for [desc] from [brand]?"
//   Option 2 (advanced) : "What is the best Model for [desc] from [category] from [brand]?"
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/ve-prescan-brands', async (req, res) => {
  try {
    const { items, providerModel, budgetTier = 'mid' } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ status: 'error', error_message: 'Items array is required' });
    }

    console.log(`\n🔍 [VE Pre-Scan] Running global document brand discovery across ${items.length} items...`);
    const prescanResult = await vePrescanBrands(items, providerModel);

    const discoveredBrands = prescanResult.brands || [];
    let provisionedCount = 0;

    // Auto-provision any contract brands not in local database (parallel save + deferred background enrich)
    const allCurrentBrands = await brandStorage.getAllBrands();
    const seenProvisioned = new Set();
    const brandsToSave = [];
    const brandsToQueueEnrich = [];

    for (const dBrand of discoveredBrands) {
      const bName = (dBrand.name || '').trim();
      const bNameLower = bName.toLowerCase();

      // Skip consumer retail marketplaces, local dealers, and suppliers from contract brand database registration
      if (!bName || seenProvisioned.has(bNameLower) || /^(amazon|noon|desertcart|ubuy|marketplace|ikea|homedepot|fahmy|kr furniture|al jassar|gear4music|attf|assarain|acp|automatic terrazzo|generic|unknown|dealer|trader|supplier|distributor)/i.test(bNameLower)) {
        continue;
      }

      const existingBrand = findBrandInCatalog(bName, allCurrentBrands);
      if (!existingBrand) {
        seenProvisioned.add(bNameLower);
        const canonicalSite = dBrand.websiteUrl || getCanonicalBrandWebsite(bName) || '';
        const logoUrl = getCanonicalBrandLogo(bName, canonicalSite);

        const newBrandObj = {
          id: Date.now() + Math.floor(Math.random() * 10000),
          name: bName,
          logo: logoUrl,
          websiteUrl: canonicalSite,
          budgetTier: budgetTier || 'mid',
          origin: 'VE-Prescan-Discovery',
          gatewayVersion: 1,
          registry: {
            name: bName,
            officialDomain: (() => { try { return new URL(canonicalSite || '').hostname; } catch { return ''; } })(),
            budgetTier: budgetTier || 'mid',
            origin: 'VE-Prescan-Discovery'
          },
          discovery: { discoveredAt: new Date().toISOString(), ttlDays: 30, verified: false, quarantine: true },
          products: (dBrand.models || []).map(m => ({
            brand: bName,
            model: m,
            mainCategory: dBrand.categoryHint || 'Furniture',
            subCategory: '',
            imageUrl: '',
            websiteUrl: canonicalSite,
            lastUpdated: new Date().toISOString(),
            source: 'VE-Prescan-Discovery',
            verified: false,
            discoveredAt: new Date().toISOString(),
            ttlDays: 30
          })),
          createdAt: new Date().toISOString()
        };
        brandsToSave.push(newBrandObj);
        brandsToQueueEnrich.push(bName);
      } else {
        const verifiedCount = (existingBrand?.products || []).filter(p => p.verified === true && p.imageUrl).length;
        const hasImageGaps = (existingBrand?.products || []).some(p => !p.imageUrl);
        if (verifiedCount < 3 && hasImageGaps) {
          brandsToQueueEnrich.push(existingBrand.name);
        }
      }
    }

    if (brandsToSave.length > 0) {
      await Promise.all(brandsToSave.map(async (bObj) => {
        await brandStorage.saveBrand(bObj);
        provisionedCount++;
        console.log(`[VE Pre-Scan] Provisioned brand "${bObj.name}" with ${bObj.products?.length || 0} models into database!`);
      }));
    }

    const updatedBrands = provisionedCount > 0 ? await brandStorage.getAllBrands() : allCurrentBrands;
    res.json({
      status: 'success',
      discoveredBrands,
      provisionedCount,
      allBrands: updatedBrands
    });

    if (brandsToQueueEnrich.length > 0) {
      setTimeout(() => {
        for (const enrichName of [...new Set(brandsToQueueEnrich)]) {
          queueBrandEnrich(enrichName);
        }
      }, 1500);
    }
  } catch (error) {
    console.error('❌ [VE Pre-Scan Error]:', error.message);
    res.status(500).json({ status: 'error', error_message: error.message });
  }
});

/**
 * Split glued words for display: "AccessoiresLaterne" -> "Accessoires Laterne",
 * "dala_accessoires" -> "Dala Accessoires". Keeps codes ("LF-001") and
 * all-caps acronyms ("WC") intact.
 */
function cleanModelName(raw) {
  let s = String(raw || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/([a-zäöüß])([A-ZÄÖÜ])/g, '$1 $2');
  s = s.replace(/([A-ZÄÖÜ]{2,})([A-ZÄÖÜ][a-zäöü])/g, '$1 $2');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Enrich one catalog brand by name: crawl its official site, verify live
 * products, merge proven ones (deduped + normalized). Shared by the manual
 * endpoint and the automatic prescan hook below.
 * Vercel note: serverless caps at 60s, so on Vercel we check at most 3 pages
 * and skip the Architonic second source (official site only).
 */
async function enrichBrandByName(brandName, maxPages = 6) {
  const ON_VERCEL = process.env.VERCEL === '1';
  const pages = ON_VERCEL ? Math.min(maxPages, 3) : maxPages;
  const brands = await brandStorage.getAllBrands(true);
  const target = brands.find((b) => String(b.name || '').toLowerCase().trim() === String(brandName).toLowerCase().trim());
  if (!target) return { success: false, error: `brand "${brandName}" not in catalog` };
  // Skip expired/dead and already-rich brands
  if (target.discovery?.expired) return { success: false, error: `brand "${brandName}" expired — skipping` };
  const verifiedCount = (target.products || []).filter((p) => p.verified === true && p.imageUrl).length;
  if (verifiedCount >= 3) return { success: true, brand: target.name, skipped: 'already-rich', verified: verifiedCount, added: 0, checked: 0 };
  const prodUrls = (target.products || []).map((p) => p.websiteUrl || p.officialProductUrl || '').filter(Boolean);
  let domain = (() => {
    try { return new URL(target.websiteUrl || target.url || (target.registry?.officialDomain && `https://${target.registry.officialDomain}`) || prodUrls[0] || '').hostname; }
    catch { return target.registry?.officialDomain || ''; }
  })();
  if (!domain) {
    const discoveredOrigin = await discoverOfficialOriginViaWeb(target.name);
    if (discoveredOrigin) {
      try {
        domain = new URL(discoveredOrigin).hostname;
        target.websiteUrl = discoveredOrigin;
        target.logo = target.logo || getCanonicalBrandLogo(target.name, discoveredOrigin);
        await brandStorage.saveBrand(target);
      } catch { /* ignore */ }
    }
  }
  const found = domain
    ? await enrichBrandFromOfficialSite({ domain, brandName: target.name, maxPages: pages })
    : { ok: false, products: [], checked: 0, sitemap: null };
  let pool = [...(found.products || [])];
  let poolSource = found.sitemap || null;
  // Second source: Architonic brand page whenever the official site yields little or has no sitemap.
  if (!ON_VERCEL && pool.length < 2) {
    try {
      console.log(`[BrandEnrich] "${target.name}": official site gave ${pool.length} verified from ${found.checked || 0} checked, trying Architonic...`);
      const archi = await enrichBrandFromArchitonic({ brandName: target.name, maxPages: pages });
      for (const p of (archi.products || [])) {
        if (!pool.some((q) => String(q.model || '').toLowerCase().trim() === String(p.model || '').toLowerCase().trim())) pool.push(p);
      }
      if (!poolSource && archi.brandPageUrl) poolSource = archi.brandPageUrl;
    } catch (e) { console.log(`[BrandEnrich] Architonic fallback missed (${e.message})`); }
  }
  if (!domain && pool.length === 0) return { success: false, error: `brand "${brandName}" has no website or Architonic listing to enrich from` };
  let added = 0;
  let failed = 0;
  for (const p of pool) {
    try {
      const model = cleanModelName(p.model);
      if (!p.imageUrl) continue;
      const ok = await brandStorage.addProductToBrand(target.name, target.budgetTier || target.budget_tier || 'mid', {
        brand: target.name,
        model,
        family: '',
        mainCategory: p.category || 'Furniture',
        subCategory: '',
        description: p.description || model,
        price: parseFloat(p.price) || 0,
        currency: p.currency || 'USD',
        imageUrl: p.imageUrl || '',
        websiteUrl: p.officialProductUrl || target.websiteUrl || target.url || '',
        officialProductUrl: p.officialProductUrl || '',
        source: p.source || 'brand-enrich',
        verified: true,
        lastUpdated: new Date().toISOString()
      });
      if (ok) added++;
      else failed++;
    } catch (e) {
      failed++;
      console.log(`[BrandEnrich] ${target.name}: product "${p.model}" add failed (${e.message})`);
    }
  }

  // Also backfill existing un-imaged stub products (e.g. VE-Prescan-Discovery)
  const stubProducts = (target.products || []).filter(p => p && (!p.imageUrl || !p.description)).slice(0, ON_VERCEL ? 2 : 5);
  for (const stub of stubProducts) {
    try {
      const liveStub = await enrichProductFromLiveWeb({
        brand: target.name,
        model: stub.model,
        description: stub.description || stub.model,
        directUrl: stub.officialProductUrl || stub.websiteUrl || target.websiteUrl || '',
        localBrand: target,
        categoryHint: stub.mainCategory || ''
      });
      if (liveStub.imageUrl || liveStub.description) {
        const ok = await brandStorage.addProductToBrand(target.name, target.budgetTier || target.budget_tier || 'mid', {
          ...stub,
          description: liveStub.description || stub.description || stub.model,
          imageUrl: liveStub.imageUrl || stub.imageUrl || '',
          price: liveStub.price > 0 ? liveStub.price : (stub.price || 0),
          currency: liveStub.currency || stub.currency || 'USD',
          websiteUrl: liveStub.websiteUrl || stub.websiteUrl || '',
          officialProductUrl: liveStub.websiteUrl || stub.officialProductUrl || '',
          verified: Boolean(liveStub.imageUrl || stub.imageUrl),
          source: liveStub.source || stub.source
        });
        if (ok) added++;
      }
    } catch (stubErr) {
      console.warn(`[BrandEnrich] stub backfill failed for "${stub.model}":`, stubErr.message);
    }
  }
  brandStorage.invalidateCache();
  return {
    success: true, brand: target.name, domain,
    checked: (found.checked || 0), verified: pool.length, added, failed,
    sitemap: poolSource, reason: pool.length ? null : (found.reason || null)
  };
}

// Auto-enrich queue: newly provisioned brands get live products in the
// background, one at a time (polite), never blocking the prescan response.
let enrichQueue = Promise.resolve();
function queueBrandEnrich(brandName) {
  enrichQueue = enrichQueue.then(async () => {
    try {
      console.log(`[AutoEnrich] background enrich for "${brandName}"...`);
      const out = await enrichBrandByName(brandName, 5);
      console.log(`[AutoEnrich] "${brandName}":`, out.success
        ? (out.skipped || `checked ${out.checked}, verified ${out.verified}, added ${out.added}`)
        : `skipped (${out.error})`);
    } catch (e) {
      console.warn(`[AutoEnrich] "${brandName}" failed:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 5000)); // breathing room between brands
  });
}

/**
 * POST /api/maker/verify { url, brand?, model? } — live-check a maker page from
 * the spec (never typed into Lens; Lens would keyword-search the URL string).
 * Fetches the page's product facts and confirms the model/brand actually live
 * there. Always 200; { verified:false + reason } on any doubt. Silent helper
 * for the modal's maker card — never blocks matching.
 */
app.post('/api/maker/verify', async (req, res) => {
  try {
    const { url, brand = '', model = '' } = req.body || {};
    if (!url || !String(url).startsWith('http')) return res.json({ success: false, verified: false, reason: 'bad-url' });
    const facts = await fetchProductFacts(String(url));
    if (!facts.ok) return res.json({ success: true, verified: false, reason: facts.reason || 'fetch-fail' });
    const page = `${facts.product?.model || ''} ${facts.product?.brand || ''} ${facts.product?.category || ''}`.toLowerCase();
    const toks = `${model} ${brand}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const hits = toks.filter((t) => page.includes(t));
    const verified = toks.length > 0 && hits.length > 0;
    return res.json({
      success: true, verified,
      pageModel: facts.product?.model || '', pageBrand: facts.product?.brand || '',
      reason: verified ? null : 'model-not-on-page', via: facts.via || null
    });
  } catch (err) {
    return res.json({ success: false, verified: false, reason: String(err.message || err).slice(0, 80) });
  }
});

/**
 * POST /api/brands/enrich { brandName, maxPages? } — Phase 3 demand-driven enrichment.
 * Takes a quarantined (prescan-discovered) brand, crawls its official site's
 * sitemap for product pages, verifies each via JSON-LD/OG, and merges the
 * proven products into the catalog (model-deduped, taxonomy-normalized).
 * Explicit per-brand call, plus automatic via the prescan hook — never bulk.
 * On Vercel maxPages is clamped to 3 (60s serverless cap).
 */
app.post('/api/brands/enrich', async (req, res) => {
  try {
    const { brandName, maxPages = 6 } = req.body || {};
    if (!brandName || !String(brandName).trim()) {
      return res.status(400).json({ success: false, error: 'brandName required' });
    }
    const out = await enrichBrandByName(brandName, maxPages);
    if (!out.success) return res.status(out.error?.includes('not in catalog') ? 404 : 422).json(out);
    return res.json(out);
  } catch (err) {
    console.error('[BrandEnrich] failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
    const effectiveMatchDesc = cleanBracketedTagsFromMatchQuery(description);
    const enrichedDesc = sizeContext ? `${effectiveMatchDesc} | ${sizeContext}` : effectiveMatchDesc;

    // 🏗️ FITOUT BRAND ISOLATION ROUTING
    if (brand && (brand.toLowerCase().trim() === 'fitout v2' || brand.toLowerCase().includes('fitout'))) {
      console.log(`\n🏗️ [VE Fitout Interceptor] Selected brand is fitout! Routing "${description}" to internal Fitout DB...`);
      try {
        const fitoutRes = await resolveFitoutCatalogMatch(req, enrichedDesc, req.body.tier || req.body.budgetTier || 'mid', 'google', providerModel);
        if (fitoutRes) {
          return res.json({
            ...fitoutRes,
            source: 'local-database'
          });
        }
        console.log(`  ⚠️ [VE Fitout] No match returned by matchFitoutItem. Falling back.`);
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

      let best = fuzzyFindModel(localBrand.products, identifiedModel, identifiedCategory);

      // Semantic Embedding Matcher Fallback for missing/generic models
      if (!best && localBrand.products.length > 0) {
        console.log(`  🧠 [VE Stage 2 Embeddings] Trying Gemini Semantic Vector match for "${enrichedDesc.slice(0, 60)}" in "${brand}"...`);
        try {
          const semanticResults = await findSemanticMatches({
            description: enrichedDesc,
            brandName: brand,
            products: localBrand.products,
            category: identifiedCategory,
            topK: 1,
            apiKey: req.headers['x-google-api-key'] || req.headers['x-google-free-key'] || null
          });
          if (semanticResults && semanticResults.length > 0 && semanticResults[0].confidenceScore >= 50) {
            best = semanticResults[0];
            console.log(`  ✨ [VE Semantic Vector Hit] "${best.model}" matched with confidence ${best.confidenceScore}%`);
          }
        } catch (embErr) {
          console.warn('  ⚠️ [VE Embedding Match Error]:', embErr.message);
        }
      }

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
          identifiedModel: best.model || identifiedModel
        });
      }
      console.log(`  📂 [VE Stage 2] Miss: No local entry for "${identifiedModel}".`);
    }

    // ── STAGE 3: WEB DISCOVERY (Deep Product Details) ───────────────────────
    console.log(`  🌐 [VE Stage 3] Fetching live details for ${identifiedBrand} ${identifiedModel}...`);
    const detailResult = await veGetProductDetails(identifiedBrand, identifiedModel, providerModel);

    if (detailResult.status === 'success' && detailResult.product) {
      const p = detailResult.product;

      // Validate image URL; rescue with live image search and avoid saving logos as product photos
      let rawImg = p.imageUrl || '';
      if (isBadOrLogoUrl(rawImg)) {
        rawImg = await fetchLiveProductImage(identifiedBrand, identifiedModel, p.websiteUrl || '');
        p.imageUrl = rawImg || '';
      }

      // Persist to local DB (optional — non-blocking)
      try {
        const newProduct = {
          ...p,
          brand: identifiedBrand,
          mainCategory: identifiedCategory || 'Furniture',
          verified: Boolean(p.imageUrl),
          lastUpdated: new Date().toISOString(),
          source: 'VE-AI-Discovery'
        };
        if (localBrand) {
          await brandStorage.addProductToBrand(identifiedBrand, localBrand.budgetTier || 'mid', newProduct);
        } else {
          await brandStorage.saveBrand({
            id: Date.now(),
            name: identifiedBrand,
            logo: resolveBrandLogo({ name: identifiedBrand, websiteUrl: p.websiteUrl || '' }, p.websiteUrl || ''),
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
      const proxyBase = getProxyBase(req);
      if (p.imageUrl) p.imageUrl = toProxiedImageUrl(req, p.imageUrl);
      if (p.images && Array.isArray(p.images)) {
        p.images = p.images.map(img => img && img.startsWith('https://') && !img.includes('image-proxy') ? `${proxyBase}${encodeURIComponent(img)}` : img);
      }

      return res.json({
        status: 'success',
        product: {
          ...p,
          brand: identifiedBrand,
          brandLogo: resolveBrandLogo(localBrand || { name: identifiedBrand, websiteUrl: p.websiteUrl }, p.websiteUrl || ''),
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

  // Reject known model words and non-brand keywords from ever being recognized as brand
  if (NON_BRAND_MODEL_WORDS.has(idBrandLower) || NON_BRAND_MODEL_WORDS.has(idModelLower)) {
    return { brand: 'Generic', brandObj: null, isNew: false };
  }

  // 1-3. Dynamic canonical, alias, origin-stripped & catalog quality lookup (shared helper)
  const catalogMatch = findBrandInCatalog(identifiedBrand, allLocalBrands, identifiedModel);
  if (catalogMatch) {
    if (catalogMatch.name.toLowerCase().trim() !== idBrandLower) {
      console.log(`🎯 [VE Brand Resolver] Mapped "${identifiedBrand}" to catalog "${catalogMatch.name}".`);
    }
    return { brand: catalogMatch.name, brandObj: catalogMatch, isNew: false };
  }

  const aliasCanonical = BRAND_ALIASES[idBrandLower] || null;
  if (aliasCanonical) {
    return { brand: aliasCanonical, brandObj: null, isNew: true };
  }

  // 3. Genuine contract manufacturer check
  if (isGenuineContractBrand(identifiedBrand, allLocalBrands)) {
    const canonicalNew = BRAND_ALIASES[idBrandLower] || (identifiedBrand.charAt(0).toUpperCase() + identifiedBrand.slice(1));
    return { brand: canonicalNew, brandObj: null, isNew: true };
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

  return { brand: 'Generic', brandObj: null, isNew: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE ENGINEERED OFFER — Dedicated Auto-Detect API Endpoints
// ─────────────────────────────────────────────────────────────────────────────

function getProxyBase(req) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const host = req?.get?.('host') || req?.headers?.host || '';
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const proto = forwardedProto === 'https'
    ? 'https'
    : ((process.env.VERCEL === '1' || (!isLocalHost && host)) ? 'https' : (req?.protocol || 'http'));
  return host ? `${proto}://${host}/api/image-proxy?url=` : '/api/image-proxy?url=';
}

function toProxiedImageUrl(req, url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.includes('/api/image-proxy')) {
    const qIdx = trimmed.indexOf('/api/image-proxy');
    const host = req?.get?.('host') || req?.headers?.host || '';
    const base = getProxyBase(req).replace(/\/api\/image-proxy\?url=$/, '');
    return host ? `${base}${trimmed.slice(qIdx)}` : trimmed.slice(qIdx);
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return `${getProxyBase(req)}${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

function isBadOrLogoUrl(url) {
  if (!url || typeof url !== 'string') return true;
  return !url.startsWith('http')
    || url.includes('localhost')
    || /img\.architonic\.com/i.test(url)
    || /\/logo\/|\/header\/|logo_|logo\.|favicon|data:image\/svg|\.svg(\?|$)|amazon_logo/i.test(url);
}

const LIVE_WEB_ENRICH_CACHE = new Map();
const LIVE_WEB_ENRICH_INFLIGHT = new Map();

async function resolveAndMergeLiveProduct({
  req,
  brand,
  model,
  boqDescription,
  directUrl = '',
  localBrand = null,
  categoryHint = '',
  subCategoryHint = '',
  familyHint = '',
  providerModel = null,
  currentImageUrl = '',
  currentDescription = '',
  currentPrice = 0,
  currentCurrency = 'USD',
  fallbackBoqImageUrl = '',
  persistToCatalog = false,
  requirePrice = true,
  skipLlm = false,
  preferOfficialRefresh = false,
  currentImageVerified = false
}) {
  const cleanModelLower = String(model || '').replace(/\s*#\d+\s*$/, '').trim().toLowerCase();
  const currentAligned = isProductIdentityAligned(model, '', currentDescription, currentImageUrl || directUrl);
  const safeCurrentDesc = (currentAligned && !isGarbageProductDesc(currentDescription)) ? currentDescription : '';
  let safeCurrentImg = currentAligned ? currentImageUrl : '';
  const safeDirectUrl = currentAligned ? directUrl : '';

  // Never blindly trust unverified LLM/DB image URLs (e.g. hallucinated 404 wp-content paths or soft-404s)
  let hadDeadInputImg = false;
  if (safeCurrentImg && !isBadOrLogoUrl(safeCurrentImg) && !currentImageVerified) {
    const imgAlive = await Promise.race([
      verifyImageUrl(safeCurrentImg, safeDirectUrl),
      new Promise(r => setTimeout(() => r(false), 2600))
    ]);
    if (!imgAlive) {
      console.warn(`  🛡️ [Image Guard] Discarded dead/unverified image URL for "${brand} ${model}": ${safeCurrentImg.slice(0, 95)}`);
      safeCurrentImg = '';
      hadDeadInputImg = true;
    }
  }

  const trimDesc = String(safeCurrentDesc || '').trim();
  const needsDesc = !trimDesc
    || trimDesc.startsWith('Specified Manufacturer:')
    || trimDesc.length < 25
    || trimDesc.toLowerCase() === cleanModelLower;
  const needsImg = isBadOrLogoUrl(safeCurrentImg);
  const catalogProducts = Array.isArray(localBrand?.products) ? localBrand.products : [];
  const pricedCount = catalogProducts.filter(p => parseFloat(p?.price) > 0).length;
  const catalogIsPriced = pricedCount >= 2 || (pricedCount >= 1 && catalogProducts.length <= 10);
  const expectsRetailPrice = requirePrice || catalogIsPriced || isMarketplaceUrl(safeDirectUrl);
  const needsPrice = expectsRetailPrice && !(parseFloat(currentPrice) > 0);
  const needsUrl = !safeDirectUrl || isMarketplaceUrl(safeDirectUrl);

  let live = null;
  if (needsDesc || needsImg || needsPrice || needsUrl || preferOfficialRefresh) {
    const liveKey = `${String(brand || '').toLowerCase().trim()}::${String(model || '').replace(/\s*#\d+\s*$/, '').toLowerCase().trim()}::${preferOfficialRefresh ? 'official' : String(providerModel || '')}`;
    const cachedLive = LIVE_WEB_ENRICH_CACHE.get(liveKey);
    if (cachedLive && (Date.now() - cachedLive.ts) < 15 * 60 * 1000) {
      live = cachedLive.data;
    } else if (LIVE_WEB_ENRICH_INFLIGHT.has(liveKey)) {
      live = await LIVE_WEB_ENRICH_INFLIGHT.get(liveKey).catch(() => null);
    } else {
      // When refreshing an older Architonic entry from the brand's official website, don't pin directUrl to architonic.com
      const enrichDirectUrl = (preferOfficialRefresh && /architonic\.com/i.test(safeDirectUrl)) ? '' : safeDirectUrl;
      const p = enrichProductFromLiveWeb({
        brand,
        model,
        description: boqDescription,
        directUrl: enrichDirectUrl,
        localBrand,
        categoryHint,
        providerModel,
        skipLlm
      }).then(resLive => {
        if (resLive) {
          const liveAligned = isProductIdentityAligned(model, resLive.model, resLive.description, resLive.imageUrl || resLive.websiteUrl);
          if (!liveAligned || isGarbageProductDesc(resLive.description)) {
            console.warn(`  🛡️ [Identity Guard] Rejected mismatched live enrichment "${resLive.model || 'unknown'}" for requested "${brand} ${model}".`);
            return null;
          }
          if (resLive.description || resLive.imageUrl) {
            if (LIVE_WEB_ENRICH_CACHE.size >= 400) {
              LIVE_WEB_ENRICH_CACHE.delete(LIVE_WEB_ENRICH_CACHE.keys().next().value);
            }
            LIVE_WEB_ENRICH_CACHE.set(liveKey, { data: resLive, ts: Date.now() });
          }
        }
        return resLive;
      }).catch(e => {
        console.warn(`  ⚠️ [Live Web Enricher] Warning for "${brand} ${model}":`, e.message);
        return null;
      }).finally(() => {
        LIVE_WEB_ENRICH_INFLIGHT.delete(liveKey);
      });
      LIVE_WEB_ENRICH_INFLIGHT.set(liveKey, p);
      live = await p;
    }
  }

  const liveIsOfficialNonArchi = Boolean(
    live?.websiteUrl
    && !/architonic\.com/i.test(live.websiteUrl)
    && !isMarketplaceUrl(live.websiteUrl)
    && live?.imageUrl
    && !isBadOrLogoUrl(live.imageUrl)
  );

  let resolvedDesc = safeCurrentDesc;
  if (live?.description && live.description.trim().length >= 25 && (needsDesc || (preferOfficialRefresh && liveIsOfficialNonArchi) || !safeCurrentDesc)) {
    const titlePrefix = live.model && !live.description.toLowerCase().includes(live.model.toLowerCase()) ? `${live.model} — ` : '';
    resolvedDesc = `${titlePrefix}${live.description}`;
  } else if (needsDesc) {
    const sourceText = (safeCurrentDesc && !safeCurrentDesc.startsWith('Specified Manufacturer:')) ? safeCurrentDesc : boqDescription;
    resolvedDesc = cleanTechnicalDescription(sourceText, brand, model);
  } else {
    resolvedDesc = cleanTechnicalDescription(safeCurrentDesc, brand, model);
  }

  let rawImg = (preferOfficialRefresh && liveIsOfficialNonArchi)
    ? live.imageUrl
    : (!needsImg ? safeCurrentImg : (live?.imageUrl || fallbackBoqImageUrl || ''));
  if (isBadOrLogoUrl(rawImg)) {
    rawImg = (!needsImg ? safeCurrentImg : fallbackBoqImageUrl) || '';
  }

  const resolvedPrice = (live?.price > 0) ? live.price : (parseFloat(currentPrice) || 0);
  const resolvedCurrency = (live?.price > 0 && live.currency) ? live.currency : (currentCurrency || 'USD');
  const cleanDirect = (safeDirectUrl && !isMarketplaceUrl(safeDirectUrl)) ? safeDirectUrl : '';
  const cleanLiveUrl = (live?.websiteUrl && !isMarketplaceUrl(live.websiteUrl)) ? live.websiteUrl : '';
  const resolvedUrl = (preferOfficialRefresh && liveIsOfficialNonArchi)
    ? cleanLiveUrl
    : ((cleanLiveUrl && cleanLiveUrl.length > cleanDirect.length)
      ? cleanLiveUrl
      : (cleanDirect || cleanLiveUrl || getCanonicalBrandWebsite(brand) || ''));
  const resolvedFamily = (live?.model && live.model.toLowerCase() !== String(model || '').toLowerCase())
    ? live.model
    : (familyHint || String(model || '').split(/[\s\-_]/)[0] || 'Collection');

  const catNorm = classifyContractCategory(
    categoryHint || live?.mainCategory,
    subCategoryHint || live?.subCategory,
    live?.model || model,
    resolvedDesc || boqDescription
  );

  const liveSourceStr = String(live?.source || '');
  const hasRealLiveScrape = Boolean(
    liveSourceStr
    && /(jsonld:|og:|official-site|architonic|web-scrape|grounded)/i.test(liveSourceStr)
    && resolvedUrl
    && !isMarketplaceUrl(resolvedUrl)
    && (rawImg || (live?.description && live.description.length >= 25) || (live?.model && live.websiteUrl && live.websiteUrl.split('/').length >= 4))
  );
  const effectiveModelName = (live?.model && live.model.length >= 2 && live.model.toLowerCase() !== String(brand || '').toLowerCase())
    ? live.model
    : model;

  let persistedBrandObj = localBrand || null;
  if (persistToCatalog && brand && !/^(generic|unknown|local|custom)$/i.test(String(brand).trim()) && !isMarketplaceUrl(resolvedUrl) && (hasRealLiveScrape || (localBrand && rawImg && live?.description))) {
    try {
      let officialOrigin = '';
      try { officialOrigin = new URL(resolvedUrl).origin; } catch { /* ignore */ }
      const productPayload = {
        brand,
        model: effectiveModelName || model,
        sourceModel: model,
        family: resolvedFamily,
        mainCategory: catNorm.mainCategory,
        subCategory: catNorm.subCategory,
        description: resolvedDesc,
        imageUrl: rawImg,
        websiteUrl: resolvedUrl,
        productUrl: resolvedUrl,
        officialProductUrl: resolvedUrl,
        price: resolvedPrice,
        currency: resolvedCurrency,
        verified: Boolean(rawImg || hasRealLiveScrape),
        ...(liveIsOfficialNonArchi ? { officialRefreshedAt: new Date().toISOString(), forceOfficialRefresh: true } : {}),
        ...(hadDeadInputImg && rawImg ? { forceImageUpgrade: true } : {}),
        source: liveSourceStr || 'AI-Specialist-Discovery'
      };

      if (!localBrand) {
        const brandLogoUrl = resolveBrandLogo({ name: brand, websiteUrl: officialOrigin || resolvedUrl }, resolvedUrl);
        const newBrandRecord = {
          id: Date.now() + Math.floor(Math.random() * 10000),
          name: brand,
          logo: brandLogoUrl,
          websiteUrl: officialOrigin || resolvedUrl,
          budgetTier: 'mid',
          origin: 'VE-Live-Scrape-Discovery',
          gatewayVersion: 1,
          registry: {
            name: brand,
            officialDomain: (() => { try { return new URL(officialOrigin || resolvedUrl).hostname; } catch { return ''; } })(),
            budgetTier: 'mid',
            origin: 'VE-Live-Scrape-Discovery'
          },
          discovery: { discoveredAt: new Date().toISOString(), ttlDays: 90, verified: true, quarantine: false },
          products: [productPayload],
          createdAt: new Date().toISOString()
        };
        await brandStorage.saveBrand(newBrandRecord);
        persistedBrandObj = newBrandRecord;
        console.log(`💎 [Live Web Enricher] Auto-created NEW brand "${brand}" (${officialOrigin || resolvedUrl}) & saved scraped model "${productPayload.model}" to Product DB!`);
        setTimeout(() => queueBrandEnrich(brand), 1200);
      } else {
        await brandStorage.addProductToBrand(brand, localBrand.budgetTier || 'mid', productPayload);
        console.log(`💎 [Live Web Enricher] Saved/upgraded scraped model "${productPayload.model}" under "${brand}" in Product DB!`);
      }
    } catch (persistErr) {
      console.warn(`  ⚠️ [Live Web Enricher] Catalog upgrade failed (non-fatal):`, persistErr.message);
    }
  }

  return {
    model: effectiveModelName,
    description: resolvedDesc,
    imageUrl: toProxiedImageUrl(req, rawImg),
    rawImageUrl: rawImg,
    price: resolvedPrice,
    currency: resolvedCurrency,
    websiteUrl: resolvedUrl,
    family: resolvedFamily,
    mainCategory: catNorm.mainCategory,
    subCategory: catNorm.subCategory,
    brandLogo: resolveBrandLogo(persistedBrandObj || { name: brand, websiteUrl: resolvedUrl }, resolvedUrl),
    liveSource: liveSourceStr,
    verifiedLiveScrape: hasRealLiveScrape,
    persistedBrandObj
  };
}

const VE_AUTO_RESULT_CACHE = new Map();
const VE_AUTO_INFLIGHT = new Map();
const VE_AUTO_CACHE_TTL_MS = 15 * 60 * 1000;

app.post('/api/ve-match-auto', async (req, res) => {
  let settleInFlight = () => {};
  try {
    const {
      description,
      qty,
      unit,
      providerModel = null,
      imageUrl = null,
      imageAssets = [],
      rowBoundingBox = null,
      ocrTokens = [],
      includeLiveAlternatives = false
    } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ status: 'error', error_message: 'Missing item description' });
    }

    // Enrich description with qty/unit context (same as auto-match-ai)
    const sizeContext = [qty && `Qty: ${qty}`, unit && `Unit: ${unit}`].filter(Boolean).join(', ');
    const effectiveMatchDesc = cleanBracketedTagsFromMatchQuery(description);
    const enrichedDesc = sizeContext ? `${effectiveMatchDesc} | ${sizeContext}` : effectiveMatchDesc;

    // Deterministic Cache & In-Flight Request Coalescing (identical specs always yield identical matches & avoid duplicate LLM calls)
    const veCacheKey = [
      effectiveMatchDesc.toLowerCase().replace(/\s+/g, ' ').trim(),
      String(providerModel || ''),
      String(imageUrl || ''),
      String(req.body.tier || req.body.budgetTier || ''),
      includeLiveAlternatives === true ? 'liveAlt' : 'localAlt'
    ].join('||');

    const cachedEntry = VE_AUTO_RESULT_CACHE.get(veCacheKey);
    if (cachedEntry && (Date.now() - cachedEntry.ts) < VE_AUTO_CACHE_TTL_MS) {
      console.log(`  ⚡ [VE Auto-Detect Deterministic Cache] Instant hit for "${effectiveMatchDesc.slice(0, 50)}..."`);
      return res.json(cachedEntry.payload);
    }

    if (VE_AUTO_INFLIGHT.has(veCacheKey)) {
      const sharedPayload = await VE_AUTO_INFLIGHT.get(veCacheKey);
      if (sharedPayload) {
        console.log(`  ⚡ [VE Auto-Detect Coalesced Hit] Reused in-flight deterministic match for "${effectiveMatchDesc.slice(0, 50)}..."`);
        return res.json(sharedPayload);
      }
    }

    let resolveInFlight;
    const inFlightPromise = new Promise(resolve => { resolveInFlight = resolve; });
    VE_AUTO_INFLIGHT.set(veCacheKey, inFlightPromise);
    let inFlightSettled = false;
    settleInFlight = (payload) => {
      if (inFlightSettled) return;
      inFlightSettled = true;
      if (payload && payload.status === 'success') {
        if (!payload.llmQuotaFallback) {
          if (VE_AUTO_RESULT_CACHE.size >= 500) {
            VE_AUTO_RESULT_CACHE.delete(VE_AUTO_RESULT_CACHE.keys().next().value);
          }
          VE_AUTO_RESULT_CACHE.set(veCacheKey, { payload, ts: Date.now() });
        }
        resolveInFlight(payload);
      } else {
        resolveInFlight(null);
      }
      VE_AUTO_INFLIGHT.delete(veCacheKey);
    };
    const origResJson = res.json.bind(res);
    res.json = (payload) => {
      settleInFlight(payload);
      return origResJson(payload);
    };

    // Load all local brands
    const allLocalBrands = await brandStorage.getAllBrands();
    const availableBrandNames = allLocalBrands.filter(b => b.name && !b.name.toLowerCase().includes('fitout')).map(b => b.name);

    console.log(`\n🔷 [VE Auto-Detect Endpoint] Model Matching with ${availableBrandNames.length} preferred catalog brands`);

    // Prepare structured image context metadata (never send raw multi-MB binaries)
    const normalizedImageAssets = (imageAssets && imageAssets.length > 0)
      ? imageAssets
      : (imageUrl ? [{ url: imageUrl, ocrText: (ocrTokens || []).join(' ') }] : []);

    const getFormattedAlternatives = async (matchedBrand, matchedModel, catHint) => {
      try {
        const rawAlts = includeLiveAlternatives === true
          ? await generateCrossBrandAlternativesAsync(matchedBrand, matchedModel, enrichedDesc, allLocalBrands, catHint, 4)
          : generateCrossBrandAlternatives(matchedBrand, matchedModel, enrichedDesc, allLocalBrands, catHint, 4);
        const proxyBase = getProxyBase(req);
        return rawAlts.map(alt => ({
          ...alt,
          imageUrl: alt.imageUrl && alt.imageUrl.startsWith('https://') && !alt.imageUrl.includes('image-proxy')
            ? `${proxyBase}${encodeURIComponent(alt.imageUrl)}`
            : alt.imageUrl
        }));
      } catch (e) {
        console.warn('Alternatives generator warning:', e.message);
        return [];
      }
    };

    let llmQuotaExhausted = false;
    let identityResult;
    try {
      identityResult = await veMatchAuto(enrichedDesc, providerModel, normalizedImageAssets, availableBrandNames, allLocalBrands);
    } catch (veAutoErr) {
      const msg = String(veAutoErr?.message || '');
      if (veAutoErr?.allModelsExhausted || /429|503|quota|spending cap|rate-limit|resource_exhausted|high demand|overloaded|unavailable|timed out|timeout|aborted|all google/i.test(msg)) {
        llmQuotaExhausted = true;
        console.warn(`  ⚡ [VE Auto-Detect Local Fallback] LLM unavailable/throttled (${msg.slice(0, 90)}). Falling back deterministically to local Category Priority catalog for "${effectiveMatchDesc.slice(0, 50)}..."`);
        identityResult = { status: 'fallback_local', brand: 'Generic', model: '', mainCategory: '', subCategory: '' };
      } else {
        throw veAutoErr;
      }
    }

    let exactMissRequestedMeta = null;

    if (identityResult && identityResult.matchTier === 'EXACT_MATCH') {
      const imageVerif = verifyImagePairing({
        rowBoundingBox,
        imageAssets: normalizedImageAssets,
        ocrTokens,
        matchedProduct: identityResult.product || identityResult
      });

      const matchedBrandName = identityResult.brand || identityResult.product?.brand || 'Contract Manufacturer';
      const matchedBrandObj = findBrandInCatalog(matchedBrandName, allLocalBrands)
        || allLocalBrands.find(b => b.name && b.name.toLowerCase().trim() === matchedBrandName.toLowerCase().trim());
      const identityModel = identityResult.model || identityResult.product?.model || '';
      const rawSiteUrl = identityResult.websiteUrl || identityResult.productUrl || identityResult.product?.websiteUrl || '';
      const rawImg = identityResult.imageUrl || identityResult.product?.imageUrl || '';
      const boqCropFallback = imageVerif.selectedImage || (normalizedImageAssets[0]?.url) || '';
      const isCatalogBackedExact = Boolean(matchedBrandObj && (
        identityResult.evidence?.matchType === 'DETERMINISTIC_CATALOG_EXACT'
        || rawImg
        || rawSiteUrl
      ));

      const liveMerged = await resolveAndMergeLiveProduct({
        req,
        brand: matchedBrandName,
        model: identityModel,
        boqDescription: enrichedDesc,
        directUrl: rawSiteUrl,
        localBrand: matchedBrandObj,
        categoryHint: identityResult.mainCategory || identityResult.product?.mainCategory || '',
        subCategoryHint: identityResult.subCategory || identityResult.product?.subCategory || '',
        familyHint: identityResult.family || identityResult.product?.family || '',
        providerModel,
        currentImageUrl: rawImg,
        currentDescription: identityResult.description || identityResult.product?.description || '',
        currentPrice: identityResult.price || identityResult.product?.price || 0,
        currentCurrency: identityResult.currency || identityResult.product?.currency || 'USD',
        fallbackBoqImageUrl: boqCropFallback,
        persistToCatalog: Boolean(matchedBrandName && !/^(amazon|noon|desertcart|ubuy|marketplace|ikea|homedepot|generic|unknown|local)$/i.test(matchedBrandName)),
        skipLlm: llmQuotaExhausted
      });

      // Only return EXACT_MATCH if backed by our local DB OR verified live scrape from official site / Architonic!
      // Otherwise fall through to our verified local partner alternatives rather than returning an un-imaged empty stub.
      if (isCatalogBackedExact || liveMerged.verifiedLiveScrape) {
        const resolvedImg = liveMerged.imageUrl || toProxiedImageUrl(req, boqCropFallback) || '';
        const finalExactModel = liveMerged.model || identityModel;
        const alternatives = await getFormattedAlternatives(matchedBrandName, finalExactModel, liveMerged.mainCategory);

        return res.json({
          status: 'success',
          matchTier: 'EXACT_MATCH',
          confidenceScore: identityResult.confidenceScore || 100,
          product: {
            brand: matchedBrandObj?.name || matchedBrandName,
            brandLogo: liveMerged.brandLogo || identityResult.brandLogo || matchedBrandObj?.logo || '',
            model: finalExactModel,
            family: liveMerged.family,
            mainCategory: liveMerged.mainCategory,
            subCategory: liveMerged.subCategory,
            price: liveMerged.price,
            currency: liveMerged.currency,
            imageUrl: resolvedImg,
            websiteUrl: liveMerged.websiteUrl,
            productUrl: liveMerged.websiteUrl,
            supplierReferences: identityResult.supplierReferences || identityResult.product?.supplierReferences || [],
            description: liveMerged.description
          },
          alternatives,
          brandCreated: Boolean(!matchedBrandObj && liveMerged.persistedBrandObj),
          newBrand: liveMerged.persistedBrandObj || matchedBrandObj || null,
          source: isCatalogBackedExact ? 'local-database' : 'live-web-scraped-and-saved',
          evidence: identityResult.evidence || {
            matchType: isCatalogBackedExact ? 'DETERMINISTIC_EXACT_SHORTCIRCUIT' : 'LIVE_WEB_SCRAPED_EXACT',
            matchedTokens: [matchedBrandName, finalExactModel]
          },
          imageVerification: imageVerif
        });
      }

      console.log(`  🔄 [VE Exact-Match Unverified] "${matchedBrandName} - ${identityModel}" not found in local DB, official site, or Architonic. Falling back to verified local partner alternatives...`);
      exactMissRequestedMeta = { requestedBrand: matchedBrandName, requestedModel: identityModel };
    }

    let identifiedModel = (identityResult && identityResult.model) ? identityResult.model.trim() : enrichedDesc;
    let identifiedBrand = (identityResult && identityResult.brand) ? identityResult.brand.trim() : 'Generic';
    const identifiedCategory = (identityResult && identityResult.mainCategory) ? identityResult.mainCategory.trim() : '';
    const identifiedSubCategory = (identityResult && identityResult.subCategory) ? identityResult.subCategory.trim() : '';

    // Deterministic override if specification text or URL explicitly named an authentic manufacturer and model
    const explicitDetails = extractSpecifiedProductDetails(enrichedDesc, allLocalBrands);
    if (explicitDetails && explicitDetails.brand && isGenuineContractBrand(explicitDetails.brand, allLocalBrands)) {
      if (identifiedBrand.toLowerCase() !== explicitDetails.brand.toLowerCase()) {
        console.log(`🎯 [VE Auto-Detect Specified Brand Override] Specification explicitly specified "${explicitDetails.brand}". Overriding initial detection "${identifiedBrand}".`);
        identifiedBrand = explicitDetails.brand;
      }
      if (explicitDetails.url && !identityResult.productUrl) {
        identityResult.productUrl = explicitDetails.url;
      }
      if (explicitDetails.model && (!identifiedModel || identifiedModel.length < 3 ||
        identifiedModel === enrichedDesc || llmQuotaExhausted ||
        identifiedModel.toLowerCase().includes('moonako') ||
        identifiedModel.toLowerCase().includes('moodie') ||
        identifiedModel.toLowerCase().includes('arabesque') ||
        identifiedModel === '06-Moonako' || identifiedModel.includes('moonako-') ||
        NON_BRAND_MODEL_WORDS.has(identifiedModel.toLowerCase()))) {
        console.log(`🎯 [VE Auto-Detect Specified Model Override] Extracted authentic model "${explicitDetails.model}" from specification.`);
        identifiedModel = explicitDetails.model;
      }
    }

    // Resolve the canonical brand to prevent duplicate brand files, model-to-brand hallucinations, etc.
    const resolvedBrand = resolveCanonicalBrand(identifiedBrand, identifiedModel, allLocalBrands);
    const canonicalBrand = resolvedBrand.brand;
    const localBrand = resolvedBrand.brandObj;

    console.log(`  🎯 [VE Auto-Detect Endpoint] Detected: ${identifiedBrand} (Canonical: ${canonicalBrand}) → "${identifiedModel}" (Category: ${identifiedCategory} / ${identifiedSubCategory})`);

    let isGenericBrand = !canonicalBrand || ['generic', 'not specified', 'unknown'].includes(canonicalBrand.toLowerCase());
    let isMarketplace = /^(amazon|noon|desertcart|ubuy|marketplace|ikea|homedepot)/i.test(canonicalBrand);

    // 🛡️ Guard against erroneous Marketplace assignment on Commercial Office Furniture
    const isCommercialFurniture = /(chair|seating|stool|desk|workstation|table|sofa|couch|lounge|cabinet|credenza|storage|filing|pod|booth|boardroom)/i.test(enrichedDesc) ||
      /(office seating|desk & table|storage|soft furniture|commercial)/i.test(identifiedCategory);
    const hasExplicitMarketplaceUrl = /https?:\/\/(www\.)?(amazon|noon|desertcart|ubuy|ikea|homedepot)\./i.test(enrichedDesc);

    if (isMarketplace && isCommercialFurniture && !hasExplicitMarketplaceUrl) {
      console.log(`🛡️ [VE Guard] Intercepted erroneous marketplace match "${canonicalBrand}" for commercial furniture "${identifiedModel}". Re-routing to preferred commercial catalog...`);
      isMarketplace = false;
      isGenericBrand = true;
    }

    const isUnbrandedSpec = /^(local|local-uae|local uae|far east|fareast|custom|unbranded|sample)/i.test(enrichedDesc.trim()) ||
      /\b(local-uae|far east)\b/i.test(enrichedDesc) ||
      NON_BRAND_MODEL_WORDS.has(identifiedBrand.toLowerCase().trim());
    const isGenuine = isGenuineContractBrand(canonicalBrand, allLocalBrands);

    const targetBucket = getArchetypeBucket(enrichedDesc);
    const furnishingCatPrecheck = classifyFurnishingCategory(enrichedDesc);
    const hasExplicitBrandInDesc = canonicalBrand && !isGenericBrand && canonicalBrand.length > 2
      && enrichedDesc.toLowerCase().includes(canonicalBrand.toLowerCase());
    const isFitoutBrandDetected = canonicalBrand && (canonicalBrand.toLowerCase().trim() === 'fitout v2' || canonicalBrand.toLowerCase().includes('fitout'));
    const isUnbrandedArchitecturalFitout = furnishingCatPrecheck === 'fitoutArchitectural' && !hasExplicitBrandInDesc;

    // 🏗️ ARCHITECTURAL FITOUT INTERCEPTOR (Handles both FitOut V2 detections and unbranded Plan Fitout items)
    if (isFitoutBrandDetected || isUnbrandedArchitecturalFitout) {
      console.log(`\n🏗️ [VE Auto-Detect Fitout Interceptor] Routing "${description}" (${isFitoutBrandDetected ? canonicalBrand : furnishingCatPrecheck}) to internal Fitout DB...`);
      try {
        const fitoutRes = await resolveFitoutCatalogMatch(req, enrichedDesc, req.body.tier || req.body.budgetTier || 'mid', 'google', providerModel, { skipLlm: llmQuotaExhausted });
        if (fitoutRes) {
          return res.json({
            ...fitoutRes,
            alternatives: [],
            source: isFitoutBrandDetected ? 'local-database' : 'category-priority-fitout'
          });
        }
      } catch (fitoutErr) {
        console.error('  ❌ [VE Auto-Detect Fitout Interceptor Error]:', fitoutErr.message);
      }
    }

    // Reusable Local Partner Alternative Matcher (used both for unbranded specs AND when a specified brand/model cannot be exact-matched online)
    const resolveLocalPriorityAlternative = async (sourceTag = 'category-priority-match', requestedMeta = null) => {
      const furnishingCat = furnishingCatPrecheck;
      const catConfig = VE_CATEGORY_CONFIG[furnishingCat] || VE_CATEGORY_CONFIG.desking;
      const prioritySequence = catConfig.priorityBrands;

      console.log(`\n🎯 [VE Priority Matcher] ${requestedMeta ? `No verified exact match for "${requestedMeta.requestedBrand} ${requestedMeta.requestedModel}" — falling back to local alternatives.` : 'Specification is unbranded/generic.'} Auto-categorized as "${catConfig.label}" (${furnishingCat}). Priority Sequence: ${prioritySequence.join(' ➔ ')}`);

      let matchedProduct = null;
      let matchedBrandObj = null;

      for (const priorityBrandName of prioritySequence) {
        if (/^fitout\s*v2$/i.test(priorityBrandName)) {
          try {
            const fitoutRes = await resolveFitoutCatalogMatch(req, enrichedDesc, req.body.tier || req.body.budgetTier || 'mid', 'google', providerModel, { skipLlm: llmQuotaExhausted });
            if (fitoutRes) {
              return {
                ...fitoutRes,
                alternatives: [],
                source: requestedMeta ? 've-alternative-fallback-fitout' : 'category-priority-fitout',
                ...(requestedMeta ? { evidence: { matchType: 'ALTERNATIVE_FALLBACK', ...requestedMeta } } : {}),
                ...(llmQuotaExhausted ? { llmQuotaFallback: true } : {})
              };
            }
          } catch (fitoutErr) {
            console.warn('  ⚠️ [VE Priority Fitout Warning]:', fitoutErr.message);
          }
          continue;
        }

        if (/^(amazon|noon)/i.test(priorityBrandName)) {
          if (furnishingCat === 'genericAccessories' && !llmQuotaExhausted) {
            const marketplaceHit = await veGetProductDetails('Amazon', identifiedModel || description, providerModel, null, 'Accessories');
            if (marketplaceHit && marketplaceHit.status === 'success' && marketplaceHit.product) {
              matchedProduct = marketplaceHit.product;
              matchedBrandObj = { name: 'Amazon', logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg' };
              break;
            }
          }
          continue;
        }

        const b = findBrandInCatalog(priorityBrandName, allLocalBrands);
        if (!b || !b.products || b.products.length === 0) continue;

        const PRIORITY_CAT_FALLBACK_BUCKET = {
          desking: 'desking',
          storage: 'storage',
          heavyDutyAndMobileFiling: 'storage',
          steelStorage: 'storage',
          bedsAndAccommodation: 'bed',
          taskSeating: 'seating',
          softSeating: 'sofa',
          classroomAndStackable: 'seating',
          foldingAndPortableSeating: 'seating',
          diningSeating: 'seating',
          outdoorSeating: 'seating',
          auditoriumAndTheater: 'seating',
          auditoriumAndTheatre: 'seating'
        };
        const priorityConflictTarget = getArchetypeBucket(enrichedDesc)
          ? enrichedDesc
          : (PRIORITY_CAT_FALLBACK_BUCKET[furnishingCat] || enrichedDesc);

        const eligibleProducts = b.products.filter(p =>
          !isScrapedChromeEntry(p)
          && !isGarbageProductDesc(p.description)
          && !isArchetypeConflict(priorityConflictTarget, p)
        );
        if (eligibleProducts.length === 0) continue;

        // Collect ranked candidates (preferring live-imaged entries over defunct img.architonic.com stubs)
        const rankedCandidates = [];
        const seenModels = new Set();
        const pushCand = (cand, label) => {
          if (!cand || !cand.model || isArchetypeConflict(priorityConflictTarget, cand)) return;
          const mk = String(cand.model).toLowerCase().trim();
          if (seenModels.has(mk)) return;
          seenModels.add(mk);
          rankedCandidates.push({ cand, label });
        };

        const filterCat = catConfig.label || identifiedCategory || null;
        const fuzzyHit = fuzzyFindModel(eligibleProducts, requestedMeta ? enrichedDesc : (identifiedModel || enrichedDesc), filterCat);
        if (fuzzyHit) pushCand(fuzzyHit, 'Fast Hit');

        try {
          const clientApiKey = req.headers['x-google-api-key'] || req.headers['x-google-free-key'] || null;
          const semanticHits = await findSemanticMatches({
            description: enrichedDesc,
            brandName: b.name,
            products: eligibleProducts,
            category: filterCat,
            topK: 6,
            apiKey: clientApiKey
          });
          for (const sh of (semanticHits || [])) {
            if (sh.exactModelMatch || sh.confidenceScore >= 60) {
              pushCand(sh, `Semantic ${sh.confidenceScore}%`);
            }
          }
        } catch (semErr) {
          console.warn(`  ⚠️ [VE Priority Semantic Warning for ${b.name}]:`, semErr.message);
        }

        const catMatchedProduct = eligibleProducts.find(p => {
          const pCat = (p.mainCategory || p.category || '').toLowerCase();
          const pSub = (p.subCategory || '').toLowerCase();
          const target = (catConfig.label || furnishingCat).toLowerCase();
          return (pCat.includes(target) || pSub.includes(target)) && !isBadOrLogoUrl(p.imageUrl);
        });
        if (catMatchedProduct) pushCand(catMatchedProduct, 'Category Hit');

        // Verify candidate image liveness & auto-upgrade stale Architonic/dead-image entries from the brand's official website
        const brandOfficialSite = getCanonicalBrandWebsite(b.name) || b.websiteUrl || b.registry?.officialDomain || '';
        const hasKnownOfficialSite = Boolean(brandOfficialSite && !/architonic\.com/i.test(brandOfficialSite));

        let fallbackUnimaged = null;
        for (const { cand, label } of rankedCandidates) {
          const catalogRef = b.products.find(p => String(p.model || '').toLowerCase().trim() === String(cand.model || '').toLowerCase().trim()) || cand;
          const rawImg = catalogRef.imageUrl || cand.imageUrl || (cand.images && cand.images[0]) || '';
          const imgOk = Boolean(rawImg) && !isBadOrLogoUrl(rawImg)
            && await Promise.race([verifyImageUrl(rawImg, catalogRef.officialProductUrl || catalogRef.websiteUrl || ''), new Promise(r => setTimeout(() => r(false), 2500))]);

          const isArchitonicEntry = /architonic\.com/i.test(rawImg) || /architonic\.com/i.test(catalogRef.websiteUrl || catalogRef.productUrl || '') || /#\d+\s*$/.test(String(cand.model || ''));
          const needsOfficialRefresh = hasKnownOfficialSite && !catalogRef.officialRefreshedAt && (!imgOk || isArchitonicEntry);

          if (!imgOk || needsOfficialRefresh) {
            const liveMerged = await resolveAndMergeLiveProduct({
              req,
              brand: b.name,
              model: cand.model,
              boqDescription: enrichedDesc,
              directUrl: isArchitonicEntry ? '' : (catalogRef.officialProductUrl || catalogRef.productUrl || catalogRef.websiteUrl || ''),
              localBrand: b,
              categoryHint: cand.mainCategory || catConfig.label,
              subCategoryHint: cand.subCategory || identifiedSubCategory,
              familyHint: cand.family || '',
              providerModel,
              currentImageUrl: imgOk ? rawImg : '',
              currentDescription: cand.description || '',
              currentPrice: cand.price || 0,
              currentCurrency: cand.currency || 'USD',
              persistToCatalog: true,
              skipLlm: llmQuotaExhausted,
              preferOfficialRefresh: needsOfficialRefresh,
              currentImageVerified: imgOk
            });

            if (liveMerged.rawImageUrl && !isBadOrLogoUrl(liveMerged.rawImageUrl)) {
              const upgradedFromOfficial = liveMerged.rawImageUrl !== rawImg;
              console.log(`  ✨ [VE Priority ${label}] Matched "${cand.model}" from Priority Brand "${b.name}"${upgradedFromOfficial ? ` (refreshed live from ${b.name} official site!)` : ''}`);
              // Mark in-memory so subsequent rows in same session don't re-probe official site
              catalogRef.officialRefreshedAt = catalogRef.officialRefreshedAt || new Date().toISOString();
              if (upgradedFromOfficial) {
                catalogRef.imageUrl = liveMerged.rawImageUrl;
                catalogRef.description = liveMerged.description || catalogRef.description;
                catalogRef.websiteUrl = liveMerged.websiteUrl || catalogRef.websiteUrl;
                catalogRef.officialProductUrl = liveMerged.websiteUrl || catalogRef.officialProductUrl;
              }
              const alternatives = await getFormattedAlternatives(b.name, cand.model, liveMerged.mainCategory);
              return {
                status: 'success',
                matchTier: requestedMeta ? 'ALTERNATIVE_MATCH' : 'SUGGESTED',
                product: {
                  ...cand,
                  brand: b.name,
                  brandLogo: liveMerged.brandLogo || b.logo || '',
                  imageUrl: liveMerged.imageUrl,
                  websiteUrl: liveMerged.websiteUrl,
                  productUrl: liveMerged.websiteUrl,
                  price: liveMerged.price,
                  currency: liveMerged.currency,
                  family: liveMerged.family,
                  mainCategory: liveMerged.mainCategory,
                  subCategory: liveMerged.subCategory,
                  description: liveMerged.description
                },
                alternatives,
                source: upgradedFromOfficial ? `${sourceTag}+official-refresh` : sourceTag,
                identifiedModel: cand.model,
                ...(requestedMeta ? { evidence: { matchType: 'ALTERNATIVE_FALLBACK', ...requestedMeta } } : {}),
                ...(llmQuotaExhausted ? { llmQuotaFallback: true } : {})
              };
            }
            // Mark attempted even if official site didn't have this older SKU, and skip to next candidate if dead image
            catalogRef.officialRefreshedAt = catalogRef.officialRefreshedAt || new Date().toISOString();
            if (!imgOk) {
              console.warn(`  ⚠️ [VE Priority Dead Image Skip] "${b.name} - ${cand.model}" image failed verification and could not be rescued; trying next candidate...`);
              if (!fallbackUnimaged) fallbackUnimaged = { cand, brand: b };
              continue;
            }
          }

          if (imgOk) {
            matchedProduct = cand;
            matchedBrandObj = b;
            console.log(`  ✨ [VE Priority ${label}] Matched "${matchedProduct.model}" from Priority Brand "${b.name}"`);
            break;
          }
        }

        if (matchedProduct && matchedBrandObj) break;
        if (!matchedProduct && fallbackUnimaged) {
          matchedProduct = fallbackUnimaged.cand;
          matchedBrandObj = fallbackUnimaged.brand;
          matchedProduct = { ...matchedProduct, _deadImageCleared: true };
        }
      }

      if (!matchedProduct || !matchedBrandObj) return null;

      const rawImg = matchedProduct._deadImageCleared
        ? ''
        : (matchedProduct.imageUrl || (matchedProduct.images && matchedProduct.images[0]) || '');
      const safeImg = (rawImg && !isBadOrLogoUrl(rawImg)) ? toProxiedImageUrl(req, rawImg) : '';
      const alternatives = await getFormattedAlternatives(matchedBrandObj.name, matchedProduct.model, matchedProduct.mainCategory || catConfig.label);

      return {
        status: 'success',
        matchTier: requestedMeta ? 'ALTERNATIVE_MATCH' : 'SUGGESTED',
        product: {
          ...matchedProduct,
          brand: matchedBrandObj.name,
          brandLogo: matchedBrandObj.logo || '',
          imageUrl: safeImg,
          mainCategory: matchedProduct.mainCategory || matchedProduct.category || catConfig.label,
          subCategory: matchedProduct.subCategory || identifiedSubCategory || ''
        },
        alternatives,
        source: sourceTag,
        identifiedModel: matchedProduct.model,
        ...(requestedMeta ? { evidence: { matchType: 'ALTERNATIVE_FALLBACK', ...requestedMeta } } : {}),
        ...(llmQuotaExhausted ? { llmQuotaFallback: true } : {})
      };
    };

    // If Exact-Match Short-Circuit checked local DB + official site + Architonic and found no verifiable page,
    // immediately fall back to our verified local partner alternatives!
    if (exactMissRequestedMeta) {
      const altPayload = await resolveLocalPriorityAlternative('ve-alternative-fallback', exactMissRequestedMeta);
      if (altPayload) {
        return res.json(altPayload);
      }
    }

    // ── CATEGORY-PRIORITY GOVERNANCE FOR UNBRANDED SPECS ──
    // When the BOQ row has NO explicit manufacturer written in the specification, honor the user's
    // VE_CATEGORY_CONFIG preferred brand order (e.g. B&T Design for Soft Seating / Coffee Tables,
    // Pedrali for Dining / Outdoor, Sedus Stoll for Classroom, NARBUTAS for Desking / Task / Storage)
    // instead of letting the LLM drift every category to a single default brand.
    const catCfgPre = VE_CATEGORY_CONFIG[furnishingCatPrecheck] || null;
    let driftedFromCategoryPriority = false;
    if (
      catCfgPre &&
      !explicitDetails?.brand &&
      !hasExplicitBrandInDesc &&
      !hasExplicitMarketplaceUrl &&
      furnishingCatPrecheck !== 'genericAccessories' &&
      furnishingCatPrecheck !== 'fitoutArchitectural'
    ) {
      const availablePreferred = (catCfgPre.priorityBrands || [])
        .filter(name => !/\bstructure\s*test\b/i.test(name))
        .map(name => findBrandInCatalog(name, allLocalBrands))
        .filter(b => b && Array.isArray(b.products) && b.products.length > 0);
      const topPreferredBrand = availablePreferred[0];
      if (topPreferredBrand) {
        const topNameNorm = topPreferredBrand.name.toLowerCase().trim();
        const chosenNorm = String(canonicalBrand || '').toLowerCase().trim();
        if (chosenNorm !== topNameNorm) {
          driftedFromCategoryPriority = true;
          console.log(`  🧭 [VE Category Priority Guard] Unbranded "${catCfgPre.label}" item drifted to "${canonicalBrand || 'none'}"; enforcing preferred partner sequence starting with "${topPreferredBrand.name}".`);
        }
      }
    }

    // ── FALLBACK STRATEGY: IF NO CONTRACT MANUFACTURER IS DETECTED OR SPEC IS EXPLICITLY UNBRANDED ──
    // Auto-categorize into Furnishing Categories & match via User's Priority Brand Sequence
    if (!isGenuine || isGenericBrand || isUnbrandedSpec || driftedFromCategoryPriority) {
      if (hasExplicitMarketplaceUrl) {
        console.log(`🛒 [VE Auto-Detect] Explicit marketplace URL detected in specification. Fetching live product for "${identifiedModel || enrichedDesc}"...`);
        const marketplaceHit = await veGetProductDetails(canonicalBrand || 'Amazon', identifiedModel || enrichedDesc, providerModel, identityResult.productUrl || explicitDetails?.url, 'Accessories');
        if (marketplaceHit && marketplaceHit.status === 'success' && marketplaceHit.product) {
          const p = marketplaceHit.product;
          let liveImg = p.imageUrl || '';
          if (!liveImg || liveImg.includes('localhost')) {
            liveImg = await fetchLiveProductImage(canonicalBrand || 'Amazon', p.model || identifiedModel, explicitDetails?.url || identityResult.productUrl);
          }
          const catNorm = classifyContractCategory('Furniture', 'Storage', p.model || identifiedModel, p.description || enrichedDesc);
          const cleanDesc = cleanTechnicalDescription(p.description || enrichedDesc, canonicalBrand || 'Amazon', p.model || identifiedModel);
          const proxyBase = getProxyBase(req);
          let proxiedImageUrl = liveImg;
          if (proxiedImageUrl && proxiedImageUrl.startsWith('https://') && !proxiedImageUrl.includes('image-proxy')) {
            proxiedImageUrl = `${proxyBase}${encodeURIComponent(proxiedImageUrl)}`;
          }

          return res.json({
            status: 'success',
            product: {
              ...p,
              brand: 'Amazon',
              model: p.model || identifiedModel || 'Mobile Cart',
              mainCategory: catNorm.mainCategory,
              subCategory: catNorm.subCategory,
              imageUrl: proxiedImageUrl,
              brandLogo: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg',
              description: cleanDesc,
              websiteUrl: explicitDetails?.url || identityResult.productUrl || p.websiteUrl || ''
            },
            source: 'amazon-on-the-fly',
            identifiedModel
          });
        }
      }

      const priorityPayload = await resolveLocalPriorityAlternative('category-priority-match', null);
      if (priorityPayload) {
        return res.json(priorityPayload);
      }
    }

    // ── STAGE 2: LOCAL DB CACHE LOOKUP (Instant Zero-Latency) ──────────────────
    if (localBrand && localBrand.products && localBrand.products.length > 0) {
      const stage2Products = localBrand.products.filter(p => !isScrapedChromeEntry(p) && !isArchetypeConflict(enrichedDesc, p));
      console.log(`  🔍 [VE Auto-Detect Stage 2] Searching for "${identifiedModel}" in local cache (Brand: ${canonicalBrand}, Category Hint: ${identifiedCategory}, Eligible: ${stage2Products.length}/${localBrand.products.length})...`);

      // 2.1: Exact Model Match by Name
      const cleanIdModel = String(identifiedModel || '').replace(/\s*#\d+\s*$/, '').toLowerCase().trim();
      const exactHit = stage2Products.find(p => p.model && String(p.model).replace(/\s*#\d+\s*$/, '').toLowerCase().trim() === cleanIdModel);
      let best = exactHit || null;

      // 2.2: High-Confidence Semantic Vector Match (with strict Series Anti-Collapse & Sub-Archetype Guard)
      const STAGE2_STOP_WORDS = new Set(['chair', 'chairs', 'table', 'tables', 'desk', 'desks', 'sofa', 'sofas', 'lounge', 'armchair', 'stool', 'stools', 'bench', 'cabinet', 'storage', 'office', 'meeting', 'conference', 'visitor', 'guest', 'task', 'swivel', 'executive', 'manager', 'staff', 'medium', 'high', 'low', 'back', 'black', 'white', 'grey', 'gray', 'blue', 'red', 'green', 'mesh', 'fabric', 'leather', 'wood', 'metal', 'base', 'star', 'legs', 'castors', 'armrest', 'armrests', 'series', 'model', 'collection', 'furniture', 'system', 'modular', 'with', 'and', 'for', 'the']);
      const idSeriesTokens = cleanIdModel.split(/[\s\-_\/]+/).filter(t => t.length >= 3 && !STAGE2_STOP_WORDS.has(t));
      const descLowerForSub = enrichedDesc.toLowerCase();
      const specWantsVisitor = /\b(visitor\s+chair|guest\s+chair|cantilever|4[\s-]?leg|sled\s+base|star\s+base.*visitor)\b/i.test(descLowerForSub);
      const specWantsTask = /\b(task\s+chair|swivel\s+task|ergonomic.*task|synchro|operator\s+chair|staff\s+chair)\b/i.test(descLowerForSub) && !specWantsVisitor;

      if (!best && stage2Products.length > 0) {
        try {
          const semanticResults = await findSemanticMatches({
            description: enrichedDesc,
            brandName: canonicalBrand,
            products: stage2Products,
            category: identifiedCategory,
            topK: 1
          });
          if (semanticResults && semanticResults.length > 0) {
            const hit = semanticResults[0];
            const isCategoryCompatible = !identifiedCategory || !hit.mainCategory || hit.mainCategory.toLowerCase() === identifiedCategory.toLowerCase() || hit.mainCategory.toLowerCase().includes(identifiedCategory.toLowerCase());
            const subWanted = String(identifiedSubCategory || '').toLowerCase();
            const subHit = String(hit.subCategory || '').toLowerCase();
            const hitModelLower = String(hit.model || '').toLowerCase();
            const isSubMismatch = (subWanted.includes('coffee') && subHit.includes('conference'))
              || (subWanted.includes('conference') && subHit.includes('coffee'))
              || (subWanted.includes('reception') && subHit.includes('conference'))
              || (specWantsVisitor && /\b(task|staff|medium\s+back\s+chair|operator|swivel)\b/i.test(`${hitModelLower} ${subHit}`) && !/\b(visitor|guest|conference|cantilever)\b/i.test(`${hitModelLower} ${subHit}`))
              || (specWantsTask && /\b(visitor|guest|cantilever|dining|cafe)\b/i.test(`${hitModelLower} ${subHit}`) && !/\b(task|swivel|staff)\b/i.test(`${hitModelLower} ${subHit}`));

            // Prevent collapsing distinct specified named models (e.g. "Yukon", "Matel", "Guess") onto an unrelated small-catalog fallback
            const hasSeriesMatch = idSeriesTokens.length === 0 || idSeriesTokens.some(tok => hitModelLower.includes(tok));
            const allowSpecCollapse = !hasExplicitBrandInDesc || hasSeriesMatch || stage2Products.length >= 25;

            if ((hit.exactModelMatch || (hit.confidenceScore >= 78 && allowSpecCollapse)) && isCategoryCompatible && !isSubMismatch && !isArchetypeConflict(enrichedDesc, hit)) {
              best = hit;
              console.log(`  ✨ [VE Auto-Detect Instant Hit] "${best.model}" matched with confidence ${best.confidenceScore}% (${best.exactModelMatch ? 'EXACT MODEL HIT' : 'SPEC MATCH'}) in 1ms`);
            }
          }
        } catch (embErr) {
          console.warn('  ⚠️ [VE Auto-Detect Instant Match Error]:', embErr.message);
        }
      }

      // 2.3: Fallback Fuzzy Lookup only if no distinct named model was missing from a small catalog
      if (!best && stage2Products.length > 5 && (!hasExplicitBrandInDesc || idSeriesTokens.length === 0)) {
        const fuzz = fuzzyFindModel(stage2Products, identifiedModel, identifiedSubCategory || identifiedCategory);
        if (fuzz && !isArchetypeConflict(enrichedDesc, fuzz)) {
          best = fuzz;
        }
      }

      // 2.4: LLM Catalog Disambiguation (only for established multi-product catalogs)
      if (!best && stage2Products.length > 3 && !llmQuotaExhausted) {
        const modelList = stage2Products.map(p => p.model + (p.subCategory || p.mainCategory ? ` [${p.mainCategory} / ${p.subCategory}]` : '')).filter(Boolean);
        const matchResult = await veMatchAdvanced(enrichedDesc, canonicalBrand, identifiedSubCategory || identifiedCategory || 'Commercial Furniture', modelList, providerModel);
        if (matchResult && matchResult.status === 'success' && matchResult.model && matchResult.model !== 'FAILED' && matchResult.model !== 'NO_CATALOG_MATCH') {
          const rawFull = String(matchResult.model).replace(/\s*\[.*\]$/, '').trim().toLowerCase();
          const rawClean = rawFull.replace(/\s*#\d+\s*$/, '').trim();
          const escapeRx = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordRx = rawClean.length >= 2 ? new RegExp(`\\b${escapeRx(rawClean)}\\b`, 'i') : null;
          const desiredSub = String(matchResult.subCategory || identifiedSubCategory || '').toLowerCase();

          let topScore = -Infinity;
          for (const cand of stage2Products) {
            if (!cand?.model || isArchetypeConflict(enrichedDesc, cand)) continue;
            const cFull = String(cand.model).toLowerCase().trim();
            const cClean = cFull.replace(/\s*#\d+\s*$/, '').trim();

            let score = 0;
            if (cFull === rawFull || cClean === rawClean) score = 100;
            else if (wordRx && wordRx.test(cClean)) score = 60;
            else if (cClean.startsWith(rawClean) || rawClean.startsWith(cClean)) score = 35;
            else if (cFull.includes(rawFull) || rawFull.includes(cFull) || cClean.includes(rawClean)) score = 15;
            else continue;

            const cSub = String(cand.subCategory || '').toLowerCase();
            const cMain = String(cand.mainCategory || '').toLowerCase();
            if (desiredSub && (cSub.includes(desiredSub) || desiredSub.includes(cSub))) score += 25;
            else if (identifiedCategory && cMain.includes(identifiedCategory.toLowerCase())) score += 10;
            if (parseFloat(cand.price) > 0) score += 5;

            if (score > topScore || (score === topScore && best && String(cand.model).localeCompare(String(best.model)) < 0)) {
              topScore = score;
              best = cand;
            }
          }
          if (best) {
            console.log(`  🧠 [VE Auto-Detect Stage 2.4] veMatchAdvanced selected: "${best.model}"`);
          }
        }
      }

      if (best && !isArchetypeConflict(enrichedDesc, best) && (best.imageUrl || (stage2Products.length > 5))) {
        console.log(`  ✨ [VE Auto-Detect Cache Hit] "${best.model}" loaded from local DB.`);

        let verifiedStage2Image = best.imageUrl || (best.images && best.images[0]) || '';
        if (verifiedStage2Image) {
          const stage2ImgOk = !isBadOrLogoUrl(verifiedStage2Image)
            && await Promise.race([verifyImageUrl(verifiedStage2Image, best.officialProductUrl || best.websiteUrl || ''), new Promise(r => setTimeout(() => r(false), 2500))]);
          if (!stage2ImgOk) verifiedStage2Image = '';
        }

        const liveMerged = await resolveAndMergeLiveProduct({
          req,
          brand: canonicalBrand,
          model: best.model,
          boqDescription: enrichedDesc,
          directUrl: best.officialProductUrl || best.productUrl || best.websiteUrl || identityResult.productUrl || '',
          localBrand,
          categoryHint: best.mainCategory || identifiedCategory,
          subCategoryHint: best.subCategory || identifiedSubCategory,
          familyHint: best.family || '',
          providerModel,
          currentImageUrl: verifiedStage2Image,
          currentDescription: best.description || '',
          currentPrice: best.price || 0,
          currentCurrency: best.currency || 'USD',
          persistToCatalog: true,
          skipLlm: llmQuotaExhausted
        });

        const alternatives = await getFormattedAlternatives(canonicalBrand, best.model, liveMerged.mainCategory);

        return res.json({
          status: 'success',
          product: {
            ...best,
            brand: canonicalBrand,
            brandLogo: liveMerged.brandLogo || localBrand.logo || '',
            imageUrl: liveMerged.imageUrl,
            websiteUrl: liveMerged.websiteUrl,
            productUrl: liveMerged.websiteUrl,
            price: liveMerged.price,
            currency: liveMerged.currency,
            family: liveMerged.family,
            mainCategory: liveMerged.mainCategory,
            subCategory: liveMerged.subCategory,
            description: liveMerged.description
          },
          alternatives,
          source: 'local-database',
          identifiedModel
        });
      }
      console.log(`  📂 [VE Auto-Detect Stage 2] Miss: No local entry for "${identifiedModel}".`);
    }

    // Reject marketing slogans or non-product names from web discovery
    const SLOGAN_BLACKLIST = /\b(right tools|solutions|welcome|home|featured|contact|about us|cookie|privacy|copyright|all rights reserved|failed|null|undefined|n\/a)\b/i;
    const isSloganOrInvalid = !identifiedModel || identifiedModel.length < 3 || SLOGAN_BLACKLIST.test(identifiedModel) || String(identifiedModel).trim().toUpperCase() === 'FAILED';

    // ── STAGE 3: WEB DISCOVERY (Deep Product Details for genuine manufacturers only) ──
    if (!isSloganOrInvalid && isGenuine && !isGenericBrand && !llmQuotaExhausted) {
      console.log(`  🌐 [VE Auto-Detect Stage 3] Fetching live details for ${canonicalBrand} ${identifiedModel}...`);
      const detailResult = await veGetProductDetails(canonicalBrand, identifiedModel, providerModel, identityResult.productUrl, identifiedCategory);

      if (detailResult.status === 'success' && detailResult.product && detailResult.product.model && !SLOGAN_BLACKLIST.test(detailResult.product.model) && String(detailResult.product.model).trim().toUpperCase() !== 'FAILED') {
        const p = detailResult.product;
        const preferredUrl = (explicitDetails?.url && !isMarketplaceUrl(explicitDetails.url)) ? explicitDetails.url : (p.websiteUrl || identityResult.productUrl || '');

        const liveMerged = await resolveAndMergeLiveProduct({
          req,
          brand: canonicalBrand,
          model: p.model || identifiedModel,
          boqDescription: enrichedDesc,
          directUrl: preferredUrl,
          localBrand,
          categoryHint: p.mainCategory || identifiedCategory,
          subCategoryHint: p.subCategory || identifiedSubCategory,
          familyHint: p.family || '',
          providerModel,
          currentImageUrl: p.imageUrl || '',
          currentDescription: p.description || '',
          currentPrice: parseFloat(p.price) || parseFloat(identityResult.estimatedPrice) || 0,
          currentCurrency: p.currency || 'USD',
          persistToCatalog: Boolean(localBrand && !isMarketplace)
        });

        const newProduct = {
          ...p,
          brand: canonicalBrand,
          model: p.model || identifiedModel,
          family: liveMerged.family,
          mainCategory: liveMerged.mainCategory,
          subCategory: liveMerged.subCategory,
          description: liveMerged.description,
          price: liveMerged.price,
          currency: liveMerged.currency,
          websiteUrl: liveMerged.websiteUrl,
          productUrl: liveMerged.websiteUrl,
          supplierReferences: explicitDetails?.supplierUrls || identityResult.supplierReferences || [],
          lastUpdated: new Date().toISOString(),
          source: 'VE-AI-AutoDetect-Discovery'
        };

        console.log(`  ✨ [VE Auto-Detect Stage 3] Discovered live product "${newProduct.model}" for brand "${canonicalBrand}".`);
        const alternatives = await getFormattedAlternatives(canonicalBrand, newProduct.model, liveMerged.mainCategory);

        return res.json({
          status: 'success',
          product: {
            ...newProduct,
            imageUrl: liveMerged.imageUrl,
            brandLogo: liveMerged.brandLogo || (isMarketplace ? 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg' : '')
          },
          alternatives,
          brandCreated: !localBrand && !isMarketplace,
          newBrand: localBrand,
          source: 've-ai-discovery',
          identifiedModel
        });
      }
    }

    // Stage 3 fallback — attempt live official-site + Architonic scraping & DB persistence;
    // if still unable to exact-match by any means, fall back cleanly to our verified local partner alternatives!
    console.log(`  ✨ [VE Auto-Detect] Attempting on-the-fly official/Architonic scrape for ${canonicalBrand} "${identifiedModel}".`);
    const fallbackUrl = identityResult.productUrl || explicitDetails?.url || '';
    const skipGenericLive = isGenericBrand && llmQuotaExhausted && !fallbackUrl;
    const liveFallback = skipGenericLive
      ? {
          model: identifiedModel,
          family: '',
          mainCategory: identifiedCategory || 'Accessories',
          subCategory: identifiedSubCategory || '',
          imageUrl: toProxiedImageUrl(req, normalizedImageAssets[0]?.url || '') || '',
          rawImageUrl: '',
          brandLogo: '',
          websiteUrl: '',
          price: 0,
          currency: 'USD',
          description: effectiveMatchDesc,
          liveSource: '',
          verifiedLiveScrape: false,
          persistedBrandObj: null
        }
      : await resolveAndMergeLiveProduct({
          req,
          brand: canonicalBrand,
          model: identifiedModel,
          boqDescription: enrichedDesc,
          directUrl: fallbackUrl,
          localBrand,
          categoryHint: identifiedCategory,
          subCategoryHint: identifiedSubCategory,
          familyHint: identityResult.family || '',
          providerModel,
          currentImageUrl: '',
          currentDescription: identityResult.logic || '',
          currentPrice: parseFloat(identityResult.estimatedPrice) || 0,
          currentCurrency: 'USD',
          persistToCatalog: Boolean(!isGenericBrand && !isMarketplace),
          skipLlm: llmQuotaExhausted
        });

    // If a named brand/model could NOT be exact-matched from local DB, official site, OR Architonic,
    // automatically fall back to our verified local partner alternatives (unless it's a decorative generic accessory).
    if (!isGenericBrand && !isMarketplace && !liveFallback.verifiedLiveScrape && furnishingCatPrecheck !== 'genericAccessories') {
      const altFallback = await resolveLocalPriorityAlternative('ve-alternative-fallback', {
        requestedBrand: canonicalBrand,
        requestedModel: identifiedModel
      });
      if (altFallback) {
        return res.json(altFallback);
      }
    }

    const finalScrapedModel = liveFallback.model || identifiedModel;
    const fallbackAlternatives = await getFormattedAlternatives(canonicalBrand, finalScrapedModel, liveFallback.mainCategory);

    return res.json({
      status: 'success',
      matchTier: liveFallback.verifiedLiveScrape ? 'EXACT_MATCH' : 'SUGGESTED',
      product: {
        brand: canonicalBrand,
        model: finalScrapedModel,
        family: liveFallback.family,
        mainCategory: liveFallback.mainCategory || identifiedCategory || 'Furniture',
        subCategory: liveFallback.subCategory || identifiedSubCategory || '',
        imageUrl: liveFallback.imageUrl || '',
        brandLogo: isMarketplace ? 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg' : liveFallback.brandLogo,
        websiteUrl: liveFallback.websiteUrl,
        productUrl: liveFallback.websiteUrl,
        supplierReferences: identityResult.supplierReferences || explicitDetails?.supplierUrls || [],
        price: liveFallback.price,
        currency: liveFallback.currency,
        description: liveFallback.description
      },
      alternatives: fallbackAlternatives,
      brandCreated: Boolean(!localBrand && !isMarketplace && liveFallback.persistedBrandObj),
      newBrand: liveFallback.persistedBrandObj || localBrand || null,
      source: liveFallback.verifiedLiveScrape
        ? 'live-web-scraped-and-saved'
        : (isMarketplace ? 'amazon-on-the-fly' : 've-identity-only'),
      identifiedModel: finalScrapedModel,
      ...(llmQuotaExhausted && !liveFallback.verifiedLiveScrape ? { llmQuotaFallback: true } : {})
    });

  } catch (error) {
    settleInFlight(null);
    console.error('🔥 [VE Auto-Detect Endpoint Error]:', error.message, error.stack);
    res.status(500).json({
      status: 'error',
      error_message: error.message,
      rawResponse: error.rawResponse || null
    });
  } finally {
    settleInFlight(null);
  }
});

// ── On-Demand Live Web & Architonic Alternatives Discovery ──────────────────
app.post('/api/ai/live-alternatives', async (req, res) => {
  try {
    const { description, category, currentBrand, topK } = req.body || {};
    const allLocalBrands = await brandStorage.getAllBrands();
    const alternatives = await generateCrossBrandAlternativesAsync(currentBrand, null, description, allLocalBrands, category, topK || 4);

    const proxyBase = getProxyBase(req);
    const formatted = alternatives.map(alt => ({
      ...alt,
      imageUrl: alt.imageUrl && alt.imageUrl.startsWith('https://') && !alt.imageUrl.includes('image-proxy')
        ? `${proxyBase}${encodeURIComponent(alt.imageUrl)}`
        : alt.imageUrl
    }));

    return res.json({
      status: 'success',
      alternatives: formatted,
      count: formatted.length
    });
  } catch (err) {
    console.error('🔥 Error in /api/ai/live-alternatives:', err);
    return res.status(500).json({ status: 'error', message: err.message });
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

/**
 * POST /api/image/lens-share
 * Reads a local extracted image (relative path like /temp/extracted_images/...)
 * and uploads it to Supabase Storage, returning a short-lived public URL
 * that Google Lens can access from the internet.
 */
app.post('/api/image/lens-share', async (req, res) => {
  try {
    const { imagePath } = req.body;
    if (!imagePath) return res.status(400).json({ success: false, error: 'imagePath required' });

    // Guard: already-public URL (Supabase/CDN) — do NOT re-upload, return as-is.
    // Also unwrap our own /api/image-proxy?url=<inner> so Lens gets the real URL.
    let candidate = typeof imagePath === 'string' ? imagePath : imagePath?.url;
    if (typeof candidate === 'string' && candidate.includes('/api/image-proxy')) {
      try {
        const m = candidate.match(/[?&]url=([^&]+)/);
        if (m) candidate = decodeURIComponent(m[1]);
      } catch { /* keep original */ }
    }
    if (
      typeof candidate === 'string' &&
      candidate.startsWith('http') &&
      !candidate.includes('localhost') &&
      !candidate.includes('127.0.0.1')
    ) {
      return res.json({ success: true, publicUrl: candidate, reused: true });
    }

    // Resolve local file on disk (use unwrapped candidate; fall back to original)
    const localSource = typeof candidate === 'string' ? candidate : imagePath;
    const relativePath = String(localSource).replace(/^\/temp\//, 'public/temp/').replace(/^https?:\/\/[^/]+\/temp\//, 'public/temp/');
    const absolutePath = path.join(process.cwd(), relativePath);

    if (!fs_sync.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, error: `Local image not found: ${relativePath}` });
    }

    // Anon upload path needs no admin client (service-role key may be unset;
    // uploadToSupabase uses the proven anon client + 'assets' bucket like extraction).
    // Build a unique storage key — use timestamp so old files are naturally replaced
    const ext = path.extname(absolutePath) || '.jpg';
    const fileName = `${Date.now()}_${path.basename(absolutePath, ext)}${ext}`;
    const storagePath = `lens-share/${fileName}`;
    const BUCKET = 'assets';

    const fileBuffer = fs_sync.readFileSync(absolutePath);
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    let publicUrl;
    try {
      const uploadResult = await uploadToSupabase(BUCKET, storagePath, fileBuffer, {
        contentType: mimeType,
        cacheControl: '3600' // 1-hour cache — plenty for Lens
      });
      publicUrl = uploadResult?.url;
    } catch (uploadError) {
      console.error('[LensShare] Supabase upload error:', uploadError.message);
      return res.status(500).json({ success: false, error: uploadError.message });
    }
    if (!publicUrl) return res.status(500).json({ success: false, error: 'Failed to get public URL' });

    console.log(`[LensShare] ✅ Uploaded to Supabase: ${publicUrl}`);
    return res.json({ success: true, publicUrl, storagePath });

  } catch (err) {
    console.error('[LensShare] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lens/capabilities — Vercel-safe feature flag.
 * { supported:true } only where a Chrome binary exists (local dev).
 * Serverless answers { supported:false } so clients fall back to the manual link.
 */
app.get('/api/lens/capabilities', async (req, res) => {
  try {
    const caps = await isLensHeadlessAvailable();
    return res.json({ success: true, ...caps, walled: isLensWalled(), jar: jarStatus() });
  } catch (e) {
    return res.json({ success: true, supported: false, reason: 'probe-failed', walled: isLensWalled(), jar: jarStatus() });
  }
});

/**
 * POST /api/lens/scrape { imageUrl, brand?, model? } — server-side Lens.
 * Attempt 1: jar fast path (plain HTTP, works on Vercel — no Chrome needed).
 * Attempt 2: headless browser (local only). 501 where neither is available.
 */
app.post('/api/lens/scrape', async (req, res) => {
  try {
    const { imageUrl, brand, model } = req.body || {};
    if (!imageUrl) return res.status(400).json({ success: false, error: 'imageUrl required' });
    // ── Attempt 1: cookie-jar fast path (serverless-safe) ──
    try {
      const bytes = await fetchImageBytes(imageUrl);
      const fast = await searchViaJar({ imageBytes: bytes });
      if (fast.ok) {
        const visualMatches = (fast.result.matches || []).map((m) => ({
          title: m.title, url: m.url, imageUrl: null, source: m.domain
        }));
        // Brand/model anchoring: rank specified-brand mentions first
        const bt = `${brand || ''} ${model || ''}`.toLowerCase().trim();
        if (bt.length > 2) {
          const toks = bt.split(/[\s&/]+/).filter((t) => t.length > 2);
          visualMatches.sort((a, b) => {
            const sa = toks.reduce((s, t) => s + (((a.title || '').toLowerCase().includes(t)) ? 1 : 0), 0);
            const sb = toks.reduce((s, t) => s + (((b.title || '').toLowerCase().includes(t)) ? 1 : 0), 0);
            return sb - sa;
          });
        }
        console.log(`[LensJar] fast path: ${visualMatches.length} matches, top="${fast.result.top_title || '-'}".`);
        return res.json({
          success: true, supported: true, fastPath: true,
          visualMatches, topMatch: visualMatches[0] || null,
          textQuery: fast.result.top_title || null, textAnchored: false,
          source: 'Google Lens (fast path)'
        });
      }
      console.log(`[LensJar] fast path missed (${fast.reason}); falling back to browser.`);
    } catch (e) {
      console.log(`[LensJar] fast path error (${e.message}); falling back to browser.`);
    }
    // ── Attempt 2: headless browser (local only) ──
    const caps = await isLensHeadlessAvailable();
    if (!caps.supported) {
      return res.status(501).json({ success: false, supported: false, reason: caps.reason });
    }
    const data = await scrapeLensVisualMatches({ imageUrl, brand, model });
    return res.json({ success: true, supported: true, ...data });
  } catch (err) {
    if (err.code === 'WALLED' || String(err.message).includes('lens-headless-walled')) {
      return res.status(429).json({ success: false, walled: true, error: 'Google is rate-limiting automated checks from this network. Use the manual Lens link.' });
    }
    if (err.code === 'UNSUPPORTED' || String(err.message).startsWith('lens-headless-unsupported')) {
      return res.status(501).json({ success: false, supported: false, reason: String(err.message).split(':')[1] || 'unsupported' });
    }
    console.error('[LensHeadless] scrape failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/ve-match-workstation-set
 * Anchor-first dynamic system set matcher (workstations, L-shape desks, folding-table sets,
 * conference-table sets): locks the anchor product and fetches the remaining set components
 * (side returns, screens, modesty panels, cable trays, power boxes, pedestals, monitor arms,
 * chairs) from the same brand & family; hardware without its own SKU is returned as
 * "included in system".
 *   preferredBrand → soft brand preference in auto mode (e.g. the brand of the row's single-table
 *                    match when resolving its "set of folding tables" option)
 *   catalogOnly    → skip AI fallbacks (fast, deterministic catalog matching for set options)
 */
app.post('/api/ve-match-workstation-set', async (req, res) => {
  try {
    const {
      parentDescription = '',
      components = [],
      targetBrand = '',
      preferredBrand = '',
      isAuto = true,
      availableBrands = null,
      providerModel = null,
      catalogOnly = false,
    } = req.body || {};

    if (!parentDescription && (!Array.isArray(components) || components.length === 0)) {
      return res.status(400).json({ status: 'error', error_message: 'Missing workstation description or components' });
    }

    const allLocalBrands = await brandStorage.getAllBrands();
    const proxyBaseUrl = getProxyBase(req);

    const result = await matchWorkstationSet({
      parentDescription,
      components,
      targetBrand,
      preferredBrand,
      isAuto: Boolean(isAuto),
      availableBrands,
      allLocalBrands,
      providerModel,
      veMatchSimple: catalogOnly ? null : veMatchSimple,
      veMatchAuto: catalogOnly ? null : veMatchAuto,
      detectSpecifiedBrandInText,
      resolveBrandLogo,
      proxyBaseUrl,
    });

    return res.json(result);
  } catch (err) {
    console.error('❌ [Workstation Set Match Error]:', err.message);
    return res.status(500).json({ status: 'error', error_message: err.message });
  }
});

/**
 * POST /api/ve-match-lens { imageUrl, description?, brand?, model? }
 * Zero-LLM visual product matching via Google Lens (cookie-jar fast path -> local headless Chrome).
 * Never bypasses CAPTCHAs or bot-walls; returns manualLensUrl if Google rate-limits automation.
 */
app.post('/api/ve-match-lens', async (req, res) => {
  try {
    const { imageUrl, description = '', brand = '', model = '' } = req.body || {};
    if (!imageUrl || typeof imageUrl !== 'string') {
      return res.status(400).json({ status: 'error', error: 'imageUrl is required' });
    }

    // 1. Unwrap local image-proxy URLs and resolve bytes + public URL for Lens
    let candidate = imageUrl.trim();
    if (candidate.includes('/api/image-proxy')) {
      try {
        const m = candidate.match(/[?&]url=([^&]+)/);
        if (m) candidate = decodeURIComponent(m[1]);
      } catch { /* keep candidate */ }
    }

    let imageBytes = null;
    let publicUrl = candidate;
    const isLocalImg = !candidate.startsWith('http') || candidate.includes('localhost') || candidate.includes('127.0.0.1');

    if (isLocalImg) {
      const relativePath = candidate
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/temp\//, 'public/temp/');
      const absolutePath = path.join(process.cwd(), relativePath.replace(/^\/+/, ''));
      if (fs_sync.existsSync(absolutePath)) {
        imageBytes = fs_sync.readFileSync(absolutePath);
        try {
          const ext = path.extname(absolutePath) || '.jpg';
          const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          const storagePath = `lens-share/${Date.now()}_${path.basename(absolutePath, ext)}${ext}`;
          const up = await uploadToSupabase('assets', storagePath, imageBytes, { contentType: mimeType, cacheControl: '3600' });
          if (up?.url) publicUrl = up.url;
        } catch (upErr) {
          console.warn('[VE Lens] Supabase share upload skipped:', upErr.message);
        }
      }
    } else {
      try { imageBytes = await fetchImageBytes(candidate); } catch { /* headless still uses publicUrl */ }
    }

    const manualLensUrl = /^https?:\/\//i.test(publicUrl) && !publicUrl.includes('localhost')
      ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(publicUrl)}`
      : null;

    // 2. Attempt 1: Plain-HTTP cookie-jar fast path (zero browser, zero LLM)
    let visualMatches = [];
    let lensSource = '';
    if (imageBytes) {
      const fast = await searchViaJar({ imageBytes });
      if (fast.ok && Array.isArray(fast.result?.matches) && fast.result.matches.length > 0) {
        visualMatches = fast.result.matches.map(m => ({
          title: m.title,
          url: m.url,
          imageUrl: null,
          source: m.domain
        }));
        lensSource = 'google-lens-jar-fast-path';
      } else {
        console.log(`[VE Lens] Jar fast path missed (${fast.reason || 'empty'}).`);
      }
    }

    // 3. Attempt 2: Local Chrome headless Lens (if not walled and publicUrl is reachable)
    if (visualMatches.length === 0) {
      if (isLensWalled()) {
        return res.status(429).json({
          status: 'walled',
          walled: true,
          manualLensUrl,
          error: 'Google Lens is currently rate-limiting automated requests. Use the manual Lens link.'
        });
      }
      const caps = await isLensHeadlessAvailable();
      if (!caps.supported || !manualLensUrl) {
        return res.status(501).json({
          status: 'unsupported',
          manualLensUrl,
          error: !manualLensUrl ? 'Image must be uploaded to a public URL for server Lens.' : `Headless Lens unavailable (${caps.reason}).`
        });
      }
      try {
        const scraped = await scrapeLensVisualMatches({ imageUrl: publicUrl, brand, model });
        visualMatches = scraped.visualMatches || [];
        lensSource = 'google-lens-headless';
      } catch (err) {
        if (err.code === 'WALLED' || String(err.message).includes('lens-headless-walled')) {
          return res.status(429).json({
            status: 'walled',
            walled: true,
            manualLensUrl,
            error: 'Google Lens showed a bot-check gate. Automated Lens paused — use the manual Lens link.'
          });
        }
        throw err;
      }
    }

    if (visualMatches.length === 0) {
      return res.json({ status: 'no_match', lensMatches: [], manualLensUrl, source: lensSource });
    }

    // 4. Rank visual matches: prefer local contract brands & official non-marketplace product pages
    const allLocalBrands = await brandStorage.getAllBrands();
    const ranked = visualMatches
      .filter(m => m?.url && /^https?:\/\//i.test(m.url))
      .map(m => {
        const domainBrand = cleanDomainToBrand(m.url);
        const catBrand = domainBrand ? findBrandInCatalog(domainBrand.name, allLocalBrands) : null;
        const isMarket = isMarketplaceUrl(m.url) || /pinterest|instagram|facebook|tiktok|youtube|reddit|alibaba|aliexpress|made-in-china/i.test(m.url);
        const isArchi = /architonic\.com\/en\/p\//i.test(m.url);
        let score = 10;
        if (catBrand) score += 30;
        if (isArchi) score += 20;
        if (!isMarket) score += 15;
        else score -= 25;
        if (brand && `${m.title} ${m.source}`.toLowerCase().includes(brand.toLowerCase())) score += 25;
        return { ...m, domainBrand, catBrand, isMarket, score };
      })
      .sort((a, b) => b.score - a.score);

    const bestCard = ranked[0];
    if (!bestCard) {
      return res.json({ status: 'no_match', lensMatches: visualMatches, manualLensUrl, source: lensSource });
    }

    // 5. Scrape verified product facts from the winning Lens URL (zero LLM) & persist to DB
    const facts = await fetchProductFacts(bestCard.url, { timeoutMs: 8500 }).catch(() => ({ ok: false }));
    const scrapedProd = facts?.ok ? facts.product : null;
    const resolvedBrandName = bestCard.catBrand?.name
      || scrapedProd?.brand
      || bestCard.domainBrand?.name
      || (bestCard.source || '').split('.')[0]
      || 'Contract Manufacturer';
    const resolvedModelName = scrapedProd?.model || bestCard.title || model || 'Visual Match';
    const localBrand = findBrandInCatalog(resolvedBrandName, allLocalBrands);

    const liveMerged = await resolveAndMergeLiveProduct({
      req,
      brand: resolvedBrandName,
      model: resolvedModelName,
      boqDescription: description || resolvedModelName,
      directUrl: bestCard.url,
      localBrand,
      categoryHint: scrapedProd?.category || '',
      subCategoryHint: '',
      familyHint: '',
      providerModel: null,
      currentImageUrl: scrapedProd?.imageUrl || bestCard.imageUrl || '',
      currentDescription: scrapedProd?.description || bestCard.title || '',
      currentPrice: scrapedProd?.price || 0,
      currentCurrency: scrapedProd?.currency || 'USD',
      fallbackBoqImageUrl: imageUrl,
      persistToCatalog: Boolean(!bestCard.isMarket && isGenuineContractBrand(resolvedBrandName, allLocalBrands)),
      skipLlm: true
    });

    return res.json({
      status: 'success',
      matchTier: 'VISUAL_LENS_MATCH',
      confidenceScore: 92,
      product: {
        brand: localBrand?.name || resolvedBrandName,
        brandLogo: liveMerged.brandLogo || localBrand?.logo || '',
        model: liveMerged.model || resolvedModelName,
        family: liveMerged.family || '',
        mainCategory: liveMerged.mainCategory || 'Furniture',
        subCategory: liveMerged.subCategory || '',
        price: liveMerged.price || 0,
        currency: liveMerged.currency || 'USD',
        imageUrl: liveMerged.imageUrl || toProxiedImageUrl(req, bestCard.imageUrl || imageUrl) || '',
        websiteUrl: liveMerged.websiteUrl || bestCard.url,
        productUrl: liveMerged.websiteUrl || bestCard.url,
        description: liveMerged.description || bestCard.title || ''
      },
      lensMatches: visualMatches.slice(0, 6),
      manualLensUrl,
      brandCreated: Boolean(!localBrand && liveMerged.persistedBrandObj),
      newBrand: liveMerged.persistedBrandObj || localBrand || null,
      source: lensSource
    });
  } catch (err) {
    console.error('[VE Lens] Match error:', err.message);
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/brands/:id/refresh-official { limit?, onlyBrokenOrArchitonic? }
 * Batch-refreshes a brand's products directly from its official manufacturer website (zero LLM),
 * healing broken 404/ENOTFOUND images and upgrading stale Architonic snapshots with newest official photos & specs.
 */
app.post('/api/brands/:id/refresh-official', async (req, res) => {
  try {
    const brandId = String(req.params.id || '').trim();
    const limit = Math.min(Math.max(parseInt(req.body?.limit || '20', 10) || 20, 1), 60);
    const onlyBrokenOrArchitonic = req.body?.onlyBrokenOrArchitonic !== false;

    const allBrands = await brandStorage.getAllBrands();
    const brandObj = allBrands.find(b => String(b.id) === brandId || String(b.name || '').toLowerCase() === brandId.toLowerCase());
    if (!brandObj) return res.status(404).json({ status: 'error', error: 'Brand not found' });

    const officialSite = getCanonicalBrandWebsite(brandObj.name) || brandObj.websiteUrl || brandObj.registry?.officialDomain || '';
    if (!officialSite || /architonic\.com/i.test(officialSite)) {
      return res.status(400).json({ status: 'error', error: `No official website configured for "${brandObj.name}"` });
    }

    const targets = (brandObj.products || []).filter(p => {
      if (!p || !p.model || isScrapedChromeEntry(p)) return false;
      if (!onlyBrokenOrArchitonic) return true;
      const img = p.imageUrl || '';
      const u = p.officialProductUrl || p.websiteUrl || p.productUrl || '';
      return isBadOrLogoUrl(img) || /architonic\.com/i.test(img) || /architonic\.com/i.test(u) || !p.officialRefreshedAt;
    }).slice(0, limit);

    let upgraded = 0;
    const updatedModels = [];
    for (const p of targets) {
      try {
        const live = await enrichProductFromLiveWeb({
          brand: brandObj.name,
          model: p.model,
          description: p.description || p.model,
          directUrl: '',
          localBrand: brandObj,
          categoryHint: p.mainCategory || p.category || '',
          skipLlm: true
        });
        if (live?.imageUrl && !isBadOrLogoUrl(live.imageUrl) && live.websiteUrl && !/architonic\.com/i.test(live.websiteUrl)) {
          p.imageUrl = live.imageUrl;
          if (live.description && live.description.length >= 25) {
            p.description = `${live.model && !live.description.toLowerCase().includes(live.model.toLowerCase()) ? `${live.model} — ` : ''}${live.description}`;
          }
          p.websiteUrl = live.websiteUrl;
          p.productUrl = live.websiteUrl;
          p.officialProductUrl = live.websiteUrl;
          p.officialRefreshedAt = new Date().toISOString();
          p.verified = true;
          upgraded++;
          updatedModels.push({ model: p.model, officialModel: live.model, url: live.websiteUrl, imageUrl: live.imageUrl });
        }
      } catch { /* skip single item failure */ }
    }

    if (upgraded > 0) {
      brandObj.updatedAt = new Date().toISOString();
      await brandStorage.saveBrand(brandObj);
    }

    return res.json({
      status: 'success',
      brand: brandObj.name,
      officialSite,
      checked: targets.length,
      upgraded,
      updatedModels
    });
  } catch (err) {
    console.error('[Brand Official Refresh] Error:', err.message);
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

// Proxy endpoint for Docling service assets (images)
app.get('/docling/assets/:jobId/:filename', async (req, res) => {
  const { jobId, filename } = req.params;
  const targetUrl = `${DOCLING_SERVICE_URL}/docling/assets/${jobId}/${filename}`;
  try {
    const response = await axios.get(targetUrl, { responseType: 'stream' });
    res.set('Content-Type', response.headers['content-type'] || 'image/png');
    response.data.pipe(res);
  } catch (err) {
    console.error(`Error proxying docling asset ${jobId}/${filename}:`, err.message);
    res.status(404).send('Asset not found');
  }
});


// Image Proxy with robust error handling
app.get('/api/image-proxy', async (req, res) => {
  let imageUrl = req.query.url;
  try {
    if (!imageUrl) return res.status(400).send('URL required');

    // Support base64 encoded URLs if they don't start with http
    if (!imageUrl.startsWith('http') && !imageUrl.startsWith('/api/image-proxy')) {
      try {
        imageUrl = Buffer.from(imageUrl, 'base64').toString('utf-8');
      } catch (e) {
        return res.status(400).send('Invalid URL format');
      }
    }

    // Unwrap accidental nested /api/image-proxy?url=... references (up to 3 hops)
    for (let hop = 0; hop < 3 && typeof imageUrl === 'string' && imageUrl.includes('/api/image-proxy'); hop++) {
      try {
        const parsedProxy = new URL(imageUrl.startsWith('http') ? imageUrl : `https://placeholder.local${imageUrl}`);
        const inner = parsedProxy.searchParams.get('url');
        if (!inner || inner === imageUrl) break;
        imageUrl = inner;
      } catch {
        break;
      }
    }

    const urlObj = await assertSafeExternalUrl(imageUrl, { allowedHosts: getTrustedStorageHosts() });
    const origin = `${urlObj.protocol}//${urlObj.hostname}/`;

    const httpsAgent = new https.Agent({
      rejectUnauthorized: process.env.ALLOW_INSECURE_IMAGE_PROXY !== '1',
      keepAlive: true
    });

    const baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };

    let response;
    try {
      response = await safeAxiosGet(
        axios,
        urlObj.toString(),
        {
          responseType: 'arraybuffer',
          timeout: 15000,
          httpsAgent,
          headers: { ...baseHeaders, 'Referer': origin }
        },
        { allowedHosts: getTrustedStorageHosts() }
      );
    } catch (firstErr) {
      if (firstErr.response?.status === 403) {
        response = await safeAxiosGet(
          axios,
          urlObj.toString(),
          {
            responseType: 'arraybuffer',
            timeout: 15000,
            httpsAgent,
            headers: baseHeaders
          },
          { allowedHosts: getTrustedStorageHosts() }
        );
      } else {
        throw firstErr;
      }
    }

    let data = response.data;
    let contentType = String(response.headers['content-type'] || 'image/jpeg').toLowerCase();

    // Reject HTML/JSON soft-404 pages returned with HTTP 200 by upstream websites
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
    const hasRasterMagic = buf.length >= 12 && (
      (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
      (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
      (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) ||
      (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45) ||
      (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70)
    );
    if (/(text\/html|application\/json)/i.test(contentType) || (/text\/plain/i.test(contentType) && !hasRasterMagic)) {
      console.warn(`🖼️  [Image Proxy] Upstream soft-404 (${contentType}): ${imageUrl?.substring(0, 80)}`);
      return res.status(404).send('Upstream returned non-image content');
    }

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
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(data);

  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 403) {
      console.warn(`🛡️  [Image Proxy] Blocked request (${error.statusCode}): ${error.message}`);
      return res.status(error.statusCode).send(error.message);
    }

    const status = error.response?.status || error.statusCode || 502;
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
          results = await sc.scrapeBrand(url, name, onProgress);
        } else {
          const sc = await getScraperService();
          results = await sc.scrapeBrand(url, onProgress);
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
        logo: results.brandInfo?.logo || results.brand?.logo || results.logo || '',
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
        sync: true,
        js_scraper_url: process.env.JS_SCRAPER_SERVICE_URL
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
    const internalProducts = filterValidFitoutProducts(dbData.products || []);

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

      const cleanBase64 = pptxBase64.replace(/^data:.*?;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
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

    // Re-create uploads directories immediately to ensure readiness
    const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
    const imagesDir = isVercel ? '/tmp/uploads/images' : path.join(__dirname, '../uploads/images');
    try {
      await fs.mkdir(uploadsDir, { recursive: true });
      await fs.mkdir(imagesDir, { recursive: true });
    } catch (e) { console.error('Error recreating dirs:', e); }

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

  // Wipe ALL ephemeral assets folders on refresh (recursive, covers mupdf-crops too)
  await cleanupService.cleanupEphemeralFolders();

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

    // Initial cleanup disabled on startup to prevent page load delays.
    // Cloud operations and file scanning can take 30-60s on large sessions.
    // Use /api/reset endpoint to manually clean up when needed.
    // Promise.all([
    //   cleanupService.cleanupAll(),
    //   cleanTempDir()
    // ])
    //   .then(() => console.log('✅ Initial cleanup completed.'))
    //   .catch(err => console.error('❌ Cleanup failed:', err));
  });

  server.on('error', (err) => {
    console.error('SERVER ERROR:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Please kill the process manually.`);
    }
  });
}

export default app;

// Fire-and-forget wipe of ALL ephemeral assets folders on process boot — covers
// both local startup and Vercel serverless cold starts (incl. mupdf-crops).
// Non-blocking and best-effort (errors are logged, never crash boot).
cleanupService.cleanupEphemeralFolders().catch(err =>
  console.error('[Cleanup] Startup ephemeral-folders wipe failed:', err.message)
);