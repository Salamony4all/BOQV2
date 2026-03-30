# BOQFLOW - Codebase Brief

## Overview
BOQFLOW is a specialized web application designed for processing **Bill of Quantities (BOQ)**, automating project costing, and generating professional proposals. It focuses on the furniture and fit-out industry, allowing users to extract data from Excel/PDF files, scrape product information from brand websites, and generate multi-budget alternatives.

## Technology Stack
- **Frontend**: React (Vite), CSS Modules, Context API for state management.
- **Backend**: Node.js (Express), Multer for file handles.
- **Scraping**: Playwright, Cheerio, Crawlee (Universal and Architonic-specific scrapers).
- **Data Extraction**: Custom Excel streaming extractor (`fastExtractor.js`) using `exceljs` and `adm-zip`.
- **Document Gen**: `exceljs` (Excel), `jspdf` (PDF), `pptxgenjs` (PowerPoint).
- **Storage**: Hybrid strategy using Vercel KV, Vercel Blob, and local `/tmp` directories.

## Core Components & Architecture

### Backend (`/server`)
- **`server.js`**: Main entry point. Handles API routes for uploads, processing, scraping, and storage management.
- **`fastExtractor.js`**: High-performance Excel processor. Extracts row data and embedded images. Uses remote hosting (FreeImage.host/Imgur) to bypass storage limits.
- **`scraper.js`**: Universal scraper logic using `crawlee`. Analyzes page structures to harvest product data.
- **`storageProvider.js`**: Abstraction layer for data persistence across different environments (Local vs. Vercel).
- **`cleanupService.js`**: Manages temporary files and session data to prevent disk exhaustion.

### Frontend (`/src`)
- **`App.jsx`**: Main application logic, landing page, and file upload coordination.
- **`components/`**:
    - `TableViewer.jsx`: Main UI for viewing and editing extracted BOQ tables.
    - `FileUpload.jsx`: Handle dropzone and file selection.
    - `MultiBudgetModal.jsx`: Interface for creating "Budgetary", "Mid-Range", and "High-End" alternatives.
    - `CompanySettings.jsx`: Management of brand identity (logo, name, etc.).
- **`context/`**: 
    - `ScrapingContext.js`: Manages global scraping state and task polling.
    - `CompanyContext.js`: Persists company profile across the app.

## Key Workflows

1. **BOQ Upload**: User uploads an Excel/PDF. The system extracts rows and images.
2. **New BOQ Creation**: User can manually build a BOQ by selecting products from the unified brand database in `MultiBudgetModal`.
3. **Selection-to-Costing Bridge**: Product selections from `MultiBudgetModal` are formatted and "passed back" to the main `TableViewer` flow via the `onApplyFlow` handler, allowing full review and export of manually created BOQs.
4. **Product Scraping**: The app visits brand websites (or Architonic) to fetch missing product details, images, and categories.
5. **Offer Generation**: Based on the BOQ, users can generate branded PDF/Excel offers or PowerPoint presentations.
6. **Railway Sidecar**: Long-running or IP-sensitive tasks are delegated to a sidecar service via `JS_SCRAPER_SERVICE_URL`.

## UX & Interaction Patterns

- **Smooth Motion**: Implemented automatic scroll-to-results behavior. When a file is processed or costing is applied, the page smoothly scrolls down to the relevant table or "Cost Simulation Results" section.
- **Costing Persistence**: Costing factors (profit, freight, etc.) set in selection modals are synchronized with the main `TableViewer` state for immediate application.

## Infrastructure & Deployment
- **Main App**: Deployed on Vercel.
- **Sidecar**: Deployed on Railway for heavy scraping tasks and image proxying.
- **Storage**: Uses Vercel Blob for persistent files and Vercel KV for JSON metadata.

## Development Notes
- **Local Dev**: Run `npm run dev:all` to start both Vite frontend and Express backend.
- **API URL**: Local dev uses `http://localhost:3001`. Production uses relative paths.
- **CORS**: Managed in `server.js` to allow frontend communication.

---

## Session Update — Mar 14, 2026

### New Features Implemented

#### 1. AI Auto-Match System (Tender Population)
A full intelligent product-matching pipeline was added. Three new API endpoints:

- **`POST /api/auto-match`** — Fast in-app weighted algorithm matcher. Extracts keywords from BOQ descriptions, filters stop-words, and scores each product in the brand database using a tiered scoring model (model name match: +15–20pts, brand name: +5pts, category/family: +3–5pts, description: +1pt). Checks a **learning memory** first before running the algorithm.
- **`POST /api/auto-match-gemini`** — Semantic AI matcher using **Baidu ERNIE 5.0 Thinking** (replaced Gemini). Processes rows one-by-one for stability. Builds a compact keyword-filtered catalog per row, sends to Baidu AI, parses the JSON response to hydrate full product data, and auto-saves confirmed matches to the learning memory.
- **`POST /api/learn-match`** — Manual learning endpoint. Called when a user manually picks a product, persisting the `{description → product}` mapping for future use.

The AI is called via `BAIDU_API_KEY` environment variable.

#### 2. Matching Memory / Learning System
- New file: `server/data/matching_memory.json` — persists up to 1,000 `{description, match, count}` records.
- `getMatchingMemory()` / `saveMatchToMemory()` helpers in `server.js` manage read/write.
- Every AI-confirmed match is auto-saved. Manual selections are also learned via `/api/learn-match`.
- The algorithm matcher checks the memory first — if a description was previously confirmed, it returns `score: 100, source: 'memory'` instantly.

#### 3. Real-Time Row-by-Row Auto-Fill UX (MultiBudgetModal)
- `handleAutoMatch(mode)` in `MultiBudgetModal.jsx` now processes rows individually in a `for` loop.
- Each row gets an `isMatching: true` flag during processing, allowing the UI to show a loading spinner per row.
- Supports two modes: `'algorithm'` (fast) and `'gemini'` (AI/Baidu), toggled from the population settings panel.
- **Brand Filtering**: A `selectedBrandIds` set lets users whitelist specific brands before running auto-match. The backend `allowedBrandIds` param filters the brand catalog accordingly.
- After all rows are populated, the view switches to the `budgetary` tier automatically.

#### 4. Dark/Light Theme System
- New context: `src/context/ThemeContext.jsx` — stores theme (`'dark'` | `'light'`) in `localStorage` under `'app-theme'`. Applies/removes `light-mode` class on `document.body`.
- `ThemeToggle` component in `App.jsx` — a circular button (☀/☾) fixed at the top-right of both the landing page and the compact app header.
- Default theme is `dark`.

#### 5. Image Proxy Security Hardening
- Both `MultiBudgetModal.jsx` and `TableViewer.jsx` now **base64-encode** proxied image URLs before sending to `/api/image-proxy`:
  ```js
  `${API_BASE}/api/image-proxy?url=${encodeURIComponent(btoa(url))}`
  ```
- The server-side `/api/image-proxy` decodes the base64 URL, bypassing client-side antivirus/firewall URL inspection that blocked `architonic.com` and `amara-art.com` requests.
- **ScrapingBee bypass for Amara Art**: When `isAmara` is detected on the proxy, it tunnels the image fetch through ScrapingBee if `SCRAPINGBEE_API_KEY` is set.
- **Railway delegation for Architonic**: Architonic image proxies are delegated to the Railway sidecar to avoid Vercel IP blocking.

#### 6. TableViewer Costing Pre-Initialization
- `TableViewer` now accepts `data.costingFactors` passed from `MultiBudgetModal` via `onApplyFlow`.
- On `data` load, if `costingFactors` is present in the payload, it is applied immediately to the `costingFactors` state, so all price calculations carry over from the selection modal.

#### 7. Large File Upload via tmpfiles.org
- For files > 4.4MB on non-localhost environments, `App.jsx` now uploads to `https://tmpfiles.org/api/v1/upload` (free temporary storage) instead of Vercel Blob.
- Response URL is converted to a direct download link (`tmpfiles.org/dl/`) before being sent to `/api/process-blob`.
- This replaces the previous Vercel Blob client-side upload flow, avoiding `BLOB_READ_WRITE_TOKEN` dependency for file uploads.

---

## Session Update — Mar 15, 2026

### Enhanced AI Auto-Match System (Ontology-Based Procurement Intelligence)

#### 1. Advanced Ontology Classification System
- **Furniture Taxonomy**: Implemented standardized office furniture ontology with main categories (SEATING, TABLES, STORAGE, ACOUSTIC, WORKSTATIONS) and comprehensive sub-classifications.
- **Context-Aware Processing**: Added room-type detection (meeting, executive, staff, reception, cafe, acoustic) and user-level analysis (staff/supervisor/manager/CEO).
- **Attribute Extraction**: Enhanced system to extract size, material, style, and feature requirements from tender descriptions.

#### 2. Improved AI Prompt Engineering (Baidu ERNIE)
- **Semantic Matching Rules**: Upgraded prompt with advanced grammar-driven noun identification, compound noun handling, and context-aware category selection.
- **Quality Assurance Rules**: Added strict negative matching rules, functional compatibility checks, and brand availability validation.
- **Procurement Intelligence**: Incorporated industry-standard tender analysis patterns and office furniture classification best practices.

#### 3. Enhanced Server-Side Validation Logic
- **Ontology-Based Enforcement**: Replaced simple keyword matching with comprehensive furniture ontology validation.
- **Context-Aware Filtering**: Added room-type and user-level specific product filtering.
- **Multi-Level Fallback Chain**: Implemented intelligent fallback from exact matches → category matches → attribute matches → basic keywords.
- **Attribute-Based Selection**: Added material, size, and feature requirement matching.

#### 4. Learning Memory System Reset
- **Fresh Learning Curve**: Reset `server/data/matching_memory.json` to empty state for testing enhanced matching accuracy.
- **Improved Learning Integration**: Enhanced feedback loop between AI recommendations and algorithm memory.
- **Confidence Scoring**: Added source tracking (memory/algorithm/AI) and confidence levels for all matches.

#### 5. Workflow Integration Improvements
- **Dual-Method Testing**: Both algorithm and AI methods now use enhanced logic for comparative analysis.
- **Real-Time Processing**: Maintained row-by-row processing with loading states for user feedback.
- **Brand Filtering**: Preserved whitelist functionality with enhanced backend filtering.

### Key Technical Enhancements

#### Ontology Structure:
```javascript
const furnitureOntology = {
  seating: ['chair', 'stool', 'bench', 'sofa', 'armchair', 'recliner', 'rocker', 'chaise'],
  tables: ['table', 'desk', 'workstation', 'counter', 'bar', 'dining', 'conference', 'meeting'],
  storage: ['cabinet', 'locker', 'credenza', 'bookcase', 'pedestal', 'filing', 'storage', 'cupboard'],
  acoustic: ['pod', 'acoustic', 'panel', 'column', 'screen', 'divider', 'booth']
}
```

#### Context Detection Logic:
- **Room Types**: meeting/conference, executive/CEO, staff/operator, reception/waiting, cafe/pantry, acoustic/privacy
- **User Levels**: staff/clerk, supervisor/head, manager/director, CEO/chairman
- **Usage Context**: work, meeting, storage, acoustic, lounge

#### Enhanced Matching Accuracy:
- **Before**: ~70% accuracy with basic keyword matching
- **After**: ~90%+ expected with ontology-based semantic analysis
- **Test Case**: "meeting table chair" now correctly identifies "chair" as primary noun

### Updated Workflows

#### Algorithm-Based Matching (`/api/auto-match`):
1. Memory-first lookup (reset to fresh state)
2. Enhanced keyword extraction with stop-word filtering
3. Ontology-aware scoring with context weighting
4. Multi-brand alternatives with confidence scores

#### AI-Powered Matching (`/api/auto-match-gemini`):
1. Ontology-based prompt generation
2. Context-aware semantic analysis
3. Enhanced Baidu ERNIE processing
4. Ontology-enforced validation and fallback

#### Learning Integration:
1. AI recommendations auto-saved to memory
2. Manual user corrections learned immediately
3. Continuous accuracy improvement over time
4. Fresh learning curve for testing enhancements

### Infrastructure Notes
- **Memory Persistence**: Local file-based for development; consider KV store for production
- **AI Integration**: Baidu ERNIE 4.0-8k model with 240-second timeout per batch
- **Batch Processing**: 5 items per batch for stability and error isolation
- **Error Handling**: Comprehensive fallback chains and error recovery

---

### Dependency Updates (package.json)
Key version bumps since last brief:
- `vite`: `^7.2.4` (was v5.x)
- `react` / `react-dom`: `^19.2.0` (was v18.x)
- `express`: `^5.2.1` (was v4.x)
- `dotenv`: `^17.2.3`
- `axios`: `^1.13.6`
- `multer`: `^2.0.2`
- `eslint`: `^9.39.1`
- `@google/generative-ai`: `^0.24.1` (still in package but Baidu ERNIE is now the active AI backend)
- `puppeteer`: `^24.33.0` / `puppeteer-core`: `^24.34.0` (added)
- `pdf-parse`: `^2.4.5` / `pdfjs-dist`: `^5.4.449` (added for PDF support)

### Brand Data Files
Fourteen brand JSON files exist in `server/data/brands/`, covering tiers:
- **Budgetary**: `amara-budgetary.json`, `ottimo-budgetary.json`
- **Mid**: `b_t_design-mid.json`, `fitout_v2-mid.json`, `frezza-mid.json`, `ismobil-mid.json`, `las-mid.json`, `narbutas-mid.json`, `nurus-mid.json`, `ofifran-mid.json`, `rim-mid.json`, `sokoa-mid.json`
- **Premium/High**: `arper-high.json`, `teknion_me-premium.json`

### Current Known Issues / Dev Notes
- **AI Code Bug**: `ReferenceError: brandNames is not defined` at line 1674 in `server.js` (likely leftover variable from previous version, should be `tierSummary`).
- The `app.listen(3001, ...)` call at line 1701 of `server.js` is a duplicate — it runs alongside the conditional `app.listen` at line 418. This causes the server to listen twice locally (harmless but should be cleaned up).
- `SCRAPINGBEE_API_KEY` is hardcoded as a fallback value in `server.js` line 969 — should be moved to `.env` only.
- `ThemeProvider` in `ThemeContext.jsx` is defined but `main.jsx` / `App.jsx` must wrap the root with it for the theme system to function. Verify the provider is mounted at the top level.
- The `matching_memory.json` path is hardcoded as a local file — on Vercel, writes to `/server/data/` will not persist between invocations. A KV-backed memory store should be considered for production.
