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
import { getAiMatch, identifyModel, fetchProductDetails, searchAndEnrichModel, analyzePlan, matchFitoutItem, autoMatchSingleBrand, VALID_OPENROUTER_MODELS, VALID_NVIDIA_MODELS, GOOGLE_MODEL, OPENROUTER_MODEL, NVIDIA_MODEL, aiKeyStorage } from './utils/llmUtils.js';
import { veMatchSimple, veMatchAdvanced, veGetProductDetails, veRouteCategories } from './utils/veMatchUtils.js';
import { veMatchAuto } from './utils/veAutoDetectUtils.js'; // Removed unused veAutoDetectRoute
import { generatePresentationPdf } from './utils/pptxExportService.js';
import { convertEmfToPng } from './utils/emfConverter.js';
import Fuse from 'fuse.js';
import { TAXONOMY } from './utils/normalizer.js';
import tenderRouter from './tenderRoutes.js';
import llmProxyRouter from './llmProxyRoutes.js';

const DOCLING_SERVICE_URL = (process.env.DOCLING_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');

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

// Middleware to propagate request-scoped API keys via AsyncLocalStorage
app.use('/api', (req, res, next) => {
  const store = {
    googleApiKey: req.headers['x-google-api-key'] || '',
    googleFreeKey: req.headers['x-google-free-key'] || '',
    activeTier: req.headers['x-google-active-tier'] || 'free',
    googleModel: req.headers['x-google-model'] || ''
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

app.get('/api/ai/env-keys', (req, res) => {
  res.json({
    googleApiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
    googleFreeKey: process.env.GOOGLE_FREE_KEY || process.env.GEMINI_FREE_KEY || process.env.GEMINI_API_KEY_FREE || ''
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
    const doclingOcr = req.headers['x-docling-ocr'] === '1';

    console.log(`[Upload] Processing: ${fileName} | Mode: ${extractionMode} | OCR: ${doclingOcr}${modelName ? ` | Model: ${modelName}` : ''}`);

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
          throw new Error(`${extractionMode} extraction failed: ${err.message}`);
        }
      } else if (isVercel) {
        console.log(`[Upload] Running in Vercel - Using light extraction (pdfjs)`);
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
      extractedData = await extractVisionBOQData(filePath, req.file.mimetype, () => { }, modelName, (blob) => {
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
app.get('/api/models/available', async (req, res) => {
  const contextStore = aiKeyStorage.getStore() || {};
  const activeKey = (contextStore.activeTier === 'billed' ? contextStore.googleApiKey : contextStore.googleFreeKey)
    || process.env.GOOGLE_FREE_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  let googleModels = [];
  if (activeKey) {
    try {
      const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${activeKey}`, { timeout: 10000 });
      if (response.data && Array.isArray(response.data.models)) {
        googleModels = response.data.models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''));
      }
    } catch (err) {
      console.warn('[Server] Failed to fetch available models from Google API, using default fallbacks:', err.message);
    }
  }

  // If no models were fetched (offline, key invalid, etc.), use a clean fallback
  if (googleModels.length === 0) {
    googleModels = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'];
  }

  res.json({
    google: googleModels,
    openrouter: VALID_OPENROUTER_MODELS,
    nvidia: VALID_NVIDIA_MODELS,
    defaults: {
      google: googleModels[0] || 'gemini-2.0-flash',
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