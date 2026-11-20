# BOQFLOW — Codebase Brief & Documentation

## Overview
BOQFLOW is a specialized enterprise web application for processing **Bill of Quantities (BOQ)**, automating project costing, and generating professional proposals. Tailored for the furniture and fit-out industry, it enables users to extract data from Excel/PDF files, match products from a local brand database or via AI, generate multi-budget alternatives, value-engineered (VE) offers, and auto-submit bid estimates directly into etendering portals.

---

## Technology Stack
- **Frontend**: React 19 (Vite 7), CSS Modules, Context API
- **Backend**: Node.js (Express 5), Multer
- **AI**: Google Gemini 2.5/3.5 Flash (`@google/generative-ai`) — primary AI provider, plus OpenRouter & NVIDIA NIM vision/text routing and zero-LLM deterministic matching fallbacks
- **Scraping & Automation (Sidecar & Live Enricher)**: Playwright, Cheerio, Crawlee, Scrapling, Chrome DevTools Protocol (CDP), live official-website sitemap/JSON-LD scraping (`veLiveEnricher.js`), and zero-LLM Google Lens visual matching (`lensJar.js` / `lensHeadless.js`)
- **Data Extraction**: Custom Excel/XLSB streaming extractor (`fastExtractor.js`) via SheetJS + `exceljs` + `adm-zip`, and MuPDF WASM / hybrid PDF table & image extractors (`universalPatternParsersVercel.js`, `pdfProductExtractor.js`)
- **Document Gen**: `exceljs` (Excel), `jspdf` (PDF with Lam-Alif/Bidi Arabic support), `pptxgenjs` (PowerPoint)
- **Storage & Database**: 
  - **Supabase PostgreSQL** (Primary database source of truth)
  - **Supabase Storage** (Asset bucket `'assets'` for drawings, plans, BOQs, and images; replacing Vercel Blob)
  - **Upstash Redis / Vercel KV** (Caching and fast session-key lookups)
  - Local `/server/data/brands/*.json` (Mirror/Fallback replication layer)

---

## Core Architecture

### Backend (`/server`)
| File | Role |
|---|---|
| `server.js` | Main Express app. All API routes (including `/api/ve-match-auto`, `/api/ve-match-lens`, `/api/brands/:id/refresh-official`, `/api/image-proxy`, `/api/process-blob`). Context-scoping middleware. |
| `tenderRoutes.js` | Remote browser portal integration. Sets up Chrome instances, maps pages, and deploys bulk estimation scripts. |
| `llmProxyRoutes.js` | Proxies and validates downstream local or LLM provider requests. |
| `utils/urlSecurity.js` | SSRF protection (`assertSafeExternalUrl`, `safeAxiosGet`, `isPrivateOrReservedIp`) blocking localhost, RFC1918, link-local/metadata IPs, non-HTTP(S) schemes, and unsafe 3xx redirects. |
| `utils/freeModelRouter.js` | Dynamic Live-Catalog Free-Tier Pipeline Model Router & circuit-breaker failover (`matching`, `grounding`, `plan_vision`, `pdf_boq`, `tender_map`, `embeddings`). Syncs live `/v1beta/models` metadata every 30 min (0 generation tokens) and scores models dynamically by capability/version/token-limits/health with tier-isolated cooldowns (`GET /api/models/routing-status`, `POST /api/models/refresh-routing`). |
| `utils/llmUtils.js` | Multi-provider AI integration (Google Gemini, OpenRouter, NVIDIA NIM). Context-scoped API key resolving, dynamic model routing, plan analysis, and single/multi-brand swarm matching. |
| `utils/veMatchUtils.js` | Value Engineering heuristics: simple/advanced matching, detail scraping, and category routing. |
| `utils/veAutoDetectUtils.js` | Specification brand/model extraction, domain specialization, archetype classification, and cross-brand alternative generation. |
| `utils/veCategoryPriority.js` | Archetype bucketing, conflict guards (desks vs screens, single vs 3-seater sofas, boardroom vs folding/round tables, mobile shelving, window treatments), and contract brand priority tiers. |
| `utils/veBrandSpecialties.js` | Domain specialty maps (`BRAND_SPECIALTIES`) and strict cross-category exclusion lists (`DOMAIN_EXCLUSIONS`). |
| `utils/veLiveEnricher.js` | On-the-fly official-website & Architonic SKU enrichment, sitemap/compact-slug discovery, and live brand catalog upgrades. |
| `utils/webSearchUtils.js` | Zero-LLM official manufacturer website origin discovery. |
| `utils/brandLogos.js` | Canonical brand logos & official websites with whole-token matching (prevents short-key false positives). |
| `utils/lensJar.js` & `utils/lensHeadless.js` | Zero-LLM Google Lens visual image search integration powering `POST /api/ve-match-lens`. |
| `utils/supabaseStorage.js` | Abstraction layer for Supabase PostgreSQL database tables and Storage buckets. |
| `storageProvider.js` | Hybrid storage coordinator: orchestrates Supabase DB sync, in-place SKU upgrades, KV caching, and Railway volume replication. |
| `fastExtractor.js` | High-performance Excel/XLSB processor. Extracts rows + uploads embedded images to Supabase storage (with local fallback). |
| `universalPatternParsersVercel.js` | Canonical Vercel-safe MuPDF hybrid PDF table/image parser (`universalPatternParsersVercel.v22.dynamic-header-boq-spec.js` kept as a 2-line re-export shim for legacy tests). |
| `scraper.js` & `structureScraper.js` | Universal & hierarchical brand catalog harvesters (`scrapeBrand`) via Crawlee/Playwright. |
| `cleanupService.js` | Session cleanup and temp file/cloud asset management. |

### Frontend (`/src`)
| File | Role |
|---|---|
| `App.jsx` | Landing page, file upload coordination, custom toggles, and background data flow sync between modals. |
| `components/LandingShowcase.jsx` | Interactive landing showcase with CAD floor-plan scan card, live brand matcher, and direct upload triggers. |
| `components/TenderAutofillModal.jsx` | UI for tender portal autofill. Supports two modes: **Remote** (Railway VNC stream) and **Extension** (direct Chrome Extension bridge). Hosts the live color-coded log console, blueprint controls, and execute triggers. |
| `components/MultiBudgetModal.jsx` | Core AI Autofill UI. 3-tier BOQ comparison view with Furniture Sets multi-component matching and manual online SKU enrichment. |
| `components/ValueEngineeredModal.jsx` | Value Engineered Workflow. Exact-match + cross-brand VE alternatives, Furniture Set decomposition, Recategorize modes, and per-row zero-LLM Visual Lens matching. |
| `components/AutoFillSelectModal.jsx` | Brand selection modal before AI run. Per-tier brand display. |
| `components/PlanAnalyzerModal.jsx` | Architectural floor-plan AI extraction with interactive quantity verification before applying to BOQ. |
| `components/TableViewer.jsx` | Main BOQ table viewer/editor post-extraction with live `tablesWithSummary` totals, Offer PDF/Excel/PPTX/MAS/MIR/WIR/DN export, and unified Action Bar triggers. |
| `components/AddBrandModal.jsx` & `components/BrandManagement.jsx` | Add new brands, harvest catalogs, and manage/recover Railway cloud backups. |
| `components/CostingModal.jsx` | Cost simulation (profit, freight, customs, installation, exchange rate, VAT). |
| `context/CompanyContext.jsx` | White-label company profile (logo, name, AI model selections) synced to backend via `getApiBase()`. |
| `context/ThemeContext.jsx` | Dark/Light theme toggle, stored in localStorage. |
| `utils/apiBase.js` | Configures client API endpoints and hosts the fetch header interceptor. |
| `utils/furnitureSetUtils.js` | Furniture Set type detection, sub-component parsing, parent brand/model inheritance, and lump-sum/exploded rollup calculations. |
| `utils/boqGroupingUtils.js` | Original-Order / Item-wise / Room-wise recategorization and PDF/PPTX section divider rendering. |
| `utils/arabicPdfUtils.js` | Arabic contextual reshaping with Lam-Alif ligatures, LTR-preserving numeric Bidi ordering, and session-cached Almarai TTF loader for `jsPDF`. |

---

## Supabase Storage & Database Persistence

BOQFLOW relies on **Supabase** as its primary persistent storage layer, entirely deprecating Vercel Blob.

### 1. Storage Assets
- All uploaded Excel files, PDF documents, blueprint drawings, and extracted image assets are saved directly to the **Supabase Storage** `'assets'` bucket.
- The backend helper `uploadToSupabase` (in `utils/supabaseStorage.js`) handles uploads using a folder structure, automatically generating public URLs for the client.
- A background `cleanupService` tracks session-level assets (`cleanupService.trackBlob`) and automatically purges temporary uploads upon session termination.

### 2. Database Tables
- **`brands` Table**: Serves as the master source of truth for brand metadata and product catalogs. Schema features:
  - `id`: Unique identifier (string).
  - `name`: Brand name.
  - `products`: JSON array containing catalog listings (`model`, `imageUrl`, `productUrl`, `description`).
  - `source`: Brand origin (e.g. `Local`, `AI-Specialist-Discovery`).
  - `budget_tier`: Isolation level (`budgetary`, `mid`, `high`).
  - `logo`: Public URL to the brand's logo.
- **`portal_blueprints` Table**: Stores mapped page layout blueprints for automated data entry:
  - `domain_name`: Portal URL domain (e.g., `etendering.tenderboard.gov.om`).
  - `blueprint`: JSON schema containing CSS selector paths (`row_selector`, `input_selector`, `requires_click_to_edit`).

### 3. Synchronization & Replication Flow
- When `getAllBrands` is invoked, the `storageProvider` pulls the latest brands from Supabase and merges them with local JSON files as a fallback.
- Modifications made via "Add Brand" or AI Discovery are immediately saved to the Supabase database.
- Redundancy is maintained via Vercel KV cache (`brand:{id}`) and replicated locally/onto Railway persistent volumes to guarantee offline development capability.

---

## Sidecar Scraper Architecture

The BOQ application uses a **sidecar architecture** for web scraping, where the main Express app delegates scraping operations to Railway-hosted microservices.

```
                    ┌─────────────────────────────────────────────────────────────────┐
                    │                      RAILWAY HOSTING                            │
                    │  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
                    │  │  JS Scraper      │  │  Python Scraper  │  │  Browser Node  │ │
                    │  │  Service         │  │  Service         │  │  Service       │ │
                    │  │  ─────────────── │  │  ─────────────── │  │  ───────────── │ │
                    │  │  • Playwright    │  │  • Scrapling     │  │  • Chromium    │ │
                    │  │  • Crawlee       │  │  • FastAPI       │  │  • CDP Engine  │ │
                    │  │  • Architonic    │  │  • Architonic    │  │  • VNC Proxy   │ │
                    │  └────────┬─────────┘  └──────────┬───────┘  └───────┬────────┘ │
                    └───────────┼───────────────────────┼──────────────────┼──────────┘
                                │                       │                  │
                    ┌───────────┴───────────────────────┴──────────────────┴──────────┐
                    │                       VERCEL DEPLOYMENT                         │
                    │  ┌──────────────────────────────────────────────────────────┐   │
                    │  │                      Main BOQ App                        │   │
                    │  │  ─────────────────────────────────────────────────────── │   │
                    │  │  • Next.js / Express Server                              │   │
                    │  │  • UI Dashboard & API Endpoints                          │   │
                    │  │  • Queries Supabase DB & Calls Railway Sidecars          │   │
                    │  └──────────────────────────────────────────────────────────┘   │
                    └─────────────────────────────────────────────────────────────────┘
```

### Why Sidecar Architecture?
1. **Serverless Limits**: Vercel serverless functions have strict execution timeouts (10-60s) and cannot run persistent headful browser instances.
2. **Resource Constraints**: Playwright, Crawlee, Scrapling, and Chromium require extensive memory, swap, and CPU resources.
3. **Execution Reliability**: Dedicated sidecars run as long-standing worker processes with pre-installed browser binaries and anti-bot environments.
4. **Independent Scaling**: Scrapers and automation nodes scale separately based on active estimation demand.

### Services

#### 1. JS Scraper Service (`js-scraper-service/`)
- **Technology**: Node.js + Playwright + Crawlee
- **Endpoints**:
  - `POST /scrape`: Universal intelligent page scraping.
  - `POST /scrape-structure`: Scrapes hierarchical categories and ranges from brand index pages.
  - `POST /scrape-architonic`: Specialized Architonic.com product harvester.
  - `GET /tasks/:id`: Check status of asynchronous scraping jobs.
  - `DELETE /tasks/:id`: Cancels an active scraping task.

#### 2. Python Scraper Service (`python-scraper/`)
- **Technology**: Python + FastAPI + Scrapling
- **Endpoints**:
  - `POST /scrape`: E-commerce / WooCommerce scraper utilizing Scrapling.
  - `POST /scrape-architonic`: Fast python-based Architonic product crawler.
  - `GET /tasks/{id}`: Polls task progress.
  - `DELETE /tasks/{id}`: Cancels task.

#### Fallback Scraper Chain
When a target URL is submitted:
1. **Railway JS Scraper**: Preferred target if `JS_SCRAPER_SERVICE_URL` is set.
2. **Railway Python Scraper**: Alternate target if `PYTHON_SERVICE_URL` is set.
3. **Cloud Scrapers**: ScrapingBee/Browserless external fallbacks if API keys are configured.
4. **Local Scrapers**: Local Playwright running inside Node server (development fallback only).

---

## Remote Browser-Based Auto-Fill Engine (`tenderRoutes.js`)

BOQFLOW features a remote browser automation engine to assist estimators in submitting completed BOQ prices directly into etendering portals (specifically optimized for the Oman Tender Board portal).

### Endpoints and Execution Flow

#### 1. Container Setup (`POST /api/tender/setup`)
- Provisions an isolated Chrome container in the Railway browser service (`browser-node-production.up.railway.app`).
- Returns a secure VNC connection URL (`takeover_url`), which is embedded inside the frontend `TenderAutofillModal` iframe so estimators can view the browser in real time.
- Triggers a background navigation to the portal's target dashboard in the browser container.

#### 2. Layout Mapping (`POST /api/tender/map-platform`)
- Captures a snapshot of the current portal DOM tree via `observe` APIs.
- The raw DOM is cleaned and passed to the globally selected Google AI model.
- The AI extracts CSS selectors matching the portal layout:
  - `row_selector`: Matches individual BOQ data rows.
  - `input_selector`: Identifies the editable Unit Price input inside the row.
  - `requires_click_to_edit`: Boolean indicating if a row click trigger is required.
- The resulting blueprint is saved to the `portal_blueprints` table in Supabase.

#### 3. CDP Bulk Filling (`POST /api/tender/execute-bulk-blueprint`)
- Dispatches a payload of row prices, blueprint selectors, and global fields directly to the Railway browser engine.
- **CDP Engine (Full Speed)**: Executes direct Chrome DevTools Protocol filling on the browser container.
- **Sequential Fallback Loop**: If the native bulk endpoint is unreachable, the backend falls back to an async loop:
  - Iterates through rows: clicks the row (if required), clear-types the value, and waits `100ms`.
  - Telemetry logs (`[1/20] Row Filled`) are fed back in real time.

#### 4. Telemetry Status (`GET /api/tender/status/:session_id`)
- Polls execution telemetry, progress logs, and error traces.
- Sweeps inactive sessions through an in-memory session garbage collector (30m TTL).

---

## Chrome Extension Autofill Engine

An alternative to the Railway remote browser — runs entirely inside the user's local Chrome via a Manifest V3 extension.

| File | Role |
|---|---|
| `extension/manifest.json` | MV3 manifest. Permissions: `tabs`, `scripting`, `activeTab`, `storage`. Host perms cover Vercel + localhost. |
| `extension/content.js` | Bridge script injected into matched pages. Relays `postMessage` ↔ `chrome.runtime` messages. |
| `extension/background.js` | Service worker. Manages portal tab, injects fill scripts, streams logs back. Restores tab IDs from storage on MV3 wake-up. |
| `extension/popup.html/js` | Extension popover mirroring the React modal controls. |
| `public/extension.zip` | Pre-packaged ZIP served as a static Vercel asset for one-click install. |

**Key capabilities:**
- **Unified pipeline** — same AI mapping + bulk fill logic used by both the React modal and the extension popup.
- **Smart Field Finder** — multi-stage search: CSS selector → `<label>` text → `name`/`id`/`placeholder` attribute matching.
- **Live Log Console** — color-coded terminal panel inside the modal replaces the VNC iframe.
- **Persistent State** — `automationTabId` and `reactTabId` saved to `chrome.storage.local`; survives MV3 service-worker sleep cycles.
- **Download via Vercel** — `vercel.json` serves `/extension.zip` with `Content-Type: application/zip` and `Content-Disposition: attachment` headers (bug fixed Jul 2026).

See [`EXTENSION_AUTOFILL_FEATURE_GUIDE.md`](EXTENSION_AUTOFILL_FEATURE_GUIDE.md) for full details and installation steps.

---

## Premium Glassmorphic AI Model Selector

BOQFLOW implements a client-to-server dynamic model propagation flow that replaces traditional static configurations.

```
┌───────────────────────────┐      Fetch Interceptor      ┌───────────────────────────┐
│     AiModelSelector       │ ──────────────────────────> │   Headers Added:          │
│  🤖 Circle Toggle Icon    │                             │   • x-google-api-key      │
│  Glass Popover Populated  │                             │   • x-google-free-key     │
│  from /models/available   │                             │   • x-google-active-tier  │
└───────────────────────────┘                             │   • x-google-model        │
                                                          └─────────────┬─────────────┘
                                                                        │
                                                                        ▼
┌───────────────────────────┐   AsyncLocalStorage Context  ┌───────────────────────────┐
│     llmUtils.js           │ <────────────────────────── │        server.js          │
│  • Reads scoped model     │                             │  • Catches headers        │
│  • Routes Free/Billed Key │                             │  • Runs inside store      │
└───────────────────────────┘                             └───────────────────────────┘
```

### 1. Client-Side Selector UI
- Placed next to the light/dark theme toggle, sharing the same circular `40x40px` shape, border-radius, and shadow presets.
- Displays a robot `🤖` emoji. Styled with high-contrast theme-aware coloring: warm amber in dark mode and deep violet/purple (`#6d28d9`) in light mode.
- Popover utilizes a glassmorphic look:
  - **Light Mode**: High-contrast frosted backdrop (`rgba(255, 255, 255, 0.98)`), dark slate text (`#1e293b`), warm gray hovers (`rgba(0, 0, 0, 0.04)`), and indigo-blue active highlights (`rgba(59, 130, 246, 0.1)`).
  - **Dark Mode**: Slate-800 glass backdrop (`rgba(30, 41, 59, 0.95)`), slate-200 text, and amber highlights.
- Implements **click-outside closing** using a React `useRef` and document listener.

### 2. Global Fetch Interceptor
- Intercepts client-side `fetch` operations in `utils/apiBase.js`.
- Automatically injects user keys and models from `localStorage` into custom headers:
  - `x-google-api-key`
  - `x-google-free-key`
  - `x-google-active-tier`
  - `x-google-model`
- Intercepts native XHR requests in `App.jsx` for file uploads, forwarding the same headers.

### 3. Backend `AsyncLocalStorage` Propagation
- Express middleware in `server.js` captures incoming headers and loads them into a scoped `aiKeyStorage` container.
- All downstream AI helper functions (e.g. `callGoogle`, `callUniversalMultimodalAI`, `analyzePlan`) read context parameters from the store via `aiKeyStorage.getStore()`.
- Automatically inherits the active model name and correct API key (Free vs Billed) without explicit argument threading.

### 4. Dynamic Google API Model Listing
- Endpoint `GET /api/models/available` checks the active key in the request store.
- Queries `https://generativelanguage.googleapis.com/v1beta/models?key=${activeKey}` to fetch support models in real-time.
- If offline or keys are invalid, falls back to standard defaults: `gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-2.5-pro`.

---

## AI Autofill Pipeline — `POST /api/auto-match-ai`

The 3-stage pipeline in `server.js`:

### Stage 1 — Model Identification (AI)
- Calls `identifyModel(enrichedDescription, brandName, tier, provider)` in `llmUtils.js`
- Uses Google Gemini with web search to answer: *"What is the best single model from [Brand] for [description]?"*
- Returns: `{ model: "FORUM", confidence: "high" }`
- `enrichedDescription` = BOQ description + qty/unit context (e.g., `"OFFICE COFFEE TABLE R:30 | Qty: 2 Unit: Nos"`)

### Stage 2 — Local DB Lookup (Fuzzy Match)
- Searches brand JSON in `server/data/brands/` or Supabase database for the identified model name.
- Fuzzy match: normalizes both strings, checks for partial/contains matches.
- If **found** → returns local product data immediately.

### Stage 3 — Web Discovery (Fallback only)
- Triggered only when Stage 2 fails.
- Scrapes Architonic or brand official site for model details.
- Validates discovered product: rejects relative/invalid `imageUrl`, falls back to brand logo.
- **Permanently saves** discovered product to the brand database for future use.

### Tier Isolation
The backend filters `brandCandidates` to only brands whose `budgetTier` in the DB matches the requested `tier` — even if the client sends mixed brands. This prevents cross-tier contamination.

---

## Brand Database Structure

Location: `server/data/brands/*.json` (Mirrored in Supabase `brands` table)

| Tier | Brands |
|---|---|
| **Budgetary** | Ottimo Furniture, Amara |
| **Mid-Range** | NARBUTAS, B&T Design, Fitout V2, Frezza, Ismobil, LAS, Nurus, Ofifran, RIM, Sokoa |
| **High-End / Premium** | Arper, Teknion ME |

Each brand JSON has the structure:
```json
{
  "name": "NARBUTAS",
  "budgetTier": "mid",
  "logo": "https://...",
  "categories": [
    {
      "name": "Task Chairs",
      "subCategories": [
        {
          "name": "Ergonomic Chairs",
          "families": [
            {
              "name": "Choice Series",
              "products": [
                {
                  "model": "Choice",
                  "description": "...",
                  "imageUrl": "https://...",
                  "productUrl": "https://..."
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## MultiBudgetModal — Key State & Flow

### State
```js
const [tierData, setTierData] = useState({ budgetary: null, mid: null, high: null });
const tierDataRef = useRef(tierData); // always-fresh ref for async functions
useEffect(() => { tierDataRef.current = tierData; }, [tierData]);
```
Each tier value is: `{ rows: [...], mode: 'boq' | 'new' }`

### Row Structure
```js
{
  id, description, qty, unit, rate, amount,  // BOQ fields
  selectedBrand, selectedMainCat, selectedSubCat, selectedFamily, selectedModel,
  selectedModelUrl, brandDesc, brandImage, brandLogo,
  aiStatus: null | 'processing' | 'success' | 'error' | 'skipped',
  aiError, aiResult
}
```

### AI Autofill Flow (`executeAutoFillAI`)
1. Group `selectedBrands` by their `budgetTier` → `brandsByTier`
2. Build `tierRows` from `tierDataRef.current` (avoids stale closure)
3. **Row-first sequential loop**: for each row index i:
   - Skip if `isHeader(description)` → mark `aiStatus: 'skipped'` in all tiers
   - Mark all tiers as `aiStatus: 'processing'`
   - `await Promise.all(tierKeys.map(...))` → fires AI for each tier simultaneously
   - Each tier: `fetch /api/auto-match-ai` with `AbortController` 30s timeout
   - Updates `tierRows[k][i]` with result, calls `setTierData` live
4. After all rows: `setAiBatchResult({ success, error, newlyAdded })`

---

## Cross-Modal Background Data Sync

A major UX improvement implemented in `App.jsx`:
- **Problem**: Users previously had to wait for extraction to finish before opening modals.
- **Solution**: The extraction pipeline now runs in the background. If a modal (Multi-Budget or VE) is already open when the server returns the extracted data, `App.jsx` passes the updated `originalTables` directly into the modal's props, updating the UI without requiring a reload.

---

## isHeader() Detection Logic

Only two conditions trigger header detection:
1. Exact match against column keyword labels: `description`, `description and area`, `qty`, `unit`, `rate`, `price`, `total`, etc.
2. Regex prefix: `/^(group|type|section|category|list)\s+of\s/i`

> ⚠️ Do NOT add `head` back to the regex — `HEAD OF CHAIR`, `HEAD OF DESK`, `HEAD OF GUEST CHAIR` are **real furniture products** for the department head, not section labels.  
> Do NOT reinstate the "ALL-CAPS + short + no digits" heuristic — it falsely skips real BOQ rows like `STAFF CHAIR`, `DIRECTOR CHAIR`, `GENERAL MEETING ROOM CHAIR`.

---

## Deployment & Local Dev Setup

### 1. Railway Services (Sidecars)

#### Deploy JS Scraper Service
```bash
cd js-scraper-service
railway login
railway init
railway up
```

#### Deploy Python Scraper Service
```bash
cd python-scraper
railway login  
railway init
railway up
```

#### Deploy Browser Node Container (CDP filling engine)
Deploy the Chromium container image (e.g. browser-node) to Railway, exposing port `8000` (or `6080` for VNC web access).

### 2. Main App (Vercel / Production)
Set the following environment variables in your deployment dashboard:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
JS_SCRAPER_SERVICE_URL=https://your-js-scraper.railway.app
PYTHON_SERVICE_URL=https://your-python-scraper.railway.app
AUTO_BROWSER_URL=https://your-browser-node.railway.app
```

### 3. Local Development Run
To run all services simultaneously in development:
```bash
# Terminal 1: JS Scraper Service
cd js-scraper-service && npm install && npm run dev

# Terminal 2: Python Scraper Service
cd python-scraper && pip install -r requirements.txt && uvicorn main:app --reload --port 8000

# Terminal 3: Main App Express Backend & React Frontend
npm run dev:all
```
Ensure your local `.env` has target mappings pointing to the appropriate development ports:
```
JS_SCRAPER_SERVICE_URL=http://localhost:3002
PYTHON_SERVICE_URL=http://localhost:8000
AUTO_BROWSER_URL=http://localhost:8080
```

---

## Comprehensive App Review

### Score: 8.5 / 10

> [!TIP]
> This is a **genuinely impressive** enterprise tool. The level of depth — AI-powered matching, multi-tier budgeting, brand management, plan analysis — puts it well beyond a typical side project. It feels like a product that solves a real industry pain point.

### 📸 Walkthrough

![Full app walkthrough recording](C:/Users/Mohamad60025/.gemini/antigravity/brain/859d5a19-e546-453d-bce0-2a134145ba44/walkthrough_recording.webp)

````carousel
![Landing page — dark mode hero section with bold typography and interior design imagery](C:/Users/Mohamad60025/.gemini/antigravity/brain/859d5a19-e546-453d-bce0-2a134145ba44/landing_dark.png)
<!-- slide -->
![Multi-Budget Offers workspace — dark mode with action toolbar, budget tier tabs, and export options](C:/Users/Mohamad60025/.gemini/antigravity/brain/859d5a19-e546-453d-bce0-2a134145ba44/workspace_dark.png)
<!-- slide -->
![BOQ workspace in light mode — clean table layout with brand selection dropdowns](C:/Users/Mohamad60025/.gemini/antigravity/brain/859d5a19-e546-453d-bce0-2a134145ba44/workspace_light.png)
````

### ✅ What's Great

| Area | Score | Details |
|------|-------|---------|
| **Concept & Value Prop** | ⭐⭐⭐⭐⭐ | Solves a real, painful problem — manual BOQ estimation is slow and error-prone. AI-powered matching + multi-tier budgeting is a killer combo. |
| **Feature Depth** | ⭐⭐⭐⭐⭐ | Upload BOQ, Generate from BOQ, Upload Plan, Create New, Consolidate, Add Brand, AI Furniture, AI Fitout — this is a full-suite tool. |
| **Dark Mode** | ⭐⭐⭐⭐½ | The dark theme is premium-feeling. The navy/charcoal base with gold and purple accents works beautifully. |
| **Action Toolbar** | ⭐⭐⭐⭐⭐ | The icon-based action bar (Upload, Generate, Plan, Create, Consolidate, Add Brand, AI Furniture, AI Fitout) is intuitive and well-organized. |
| **Budget Tier System** | ⭐⭐⭐⭐½ | The Budgetary / Mid-Range / High-End tabs with a Comparison View is a genuinely smart UX pattern for this domain. |
| **Export Options** | ⭐⭐⭐⭐ | Offer PDF, Offer Excel, Presentation, PDF, MAS — comprehensive output formats for a professional workflow. |
| **AI Integration** | ⭐⭐⭐⭐⭐ | Multi-provider AI (Google, OpenRouter, NVIDIA) with tiered model selection is sophisticated and flexible. |

### ⚠️ Areas for Improvement

#### 1. Landing Page — Could Be More Dynamic (7/10)
The hero section is clean but a bit static. Consider:
- A subtle **parallax scroll** or **floating animation** on the interior image
- **Animated counters** for the "10x Faster" / "100% Accuracy" stats
- A **live demo button** or **video walkthrough** to hook new users

#### 2. Light Mode Polish (7/10)
Dark mode is clearly the "primary" skin. Light mode works but feels slightly washed out in places:
- The action toolbar icons lose some visual punch
- The table headers could use slightly more contrast
- Consider a warmer white (`#FAFAF8`) instead of pure white for the background

#### 3. Empty States (6.5/10)
The "No table data yet" empty state is functional but could be more engaging:
- Add an **illustration or icon** (like a clipboard or spreadsheet graphic)
- The faded "BOQ" watermark text is a nice touch — consider making it more intentional with a subtle animation

#### 4. Mobile Responsiveness (Unknown)
The complex table layout will be challenging on mobile. For a tool like this, mobile might not be the primary use case, but tablet support would be valuable for on-site estimators.

#### 5. Onboarding / First-Time UX (7/10)
A new user might feel overwhelmed by the 8 action buttons. Consider:
- A **guided tour** (tooltips or a stepper) for first-time users
- **Grouping** actions into primary (Upload, Create) and secondary (Consolidate, AI tools)
- A **quick-start wizard** that asks "Do you have an existing BOQ or are you starting fresh?"

#### 6. Brand Management UX
The System Configuration modal handles a lot. For the Brands section specifically:
- Export/Import/Delete buttons in a tight row could benefit from **icon-only buttons with tooltips** to reduce visual clutter when there are many brands

### 🔧 Technical Architecture Observations

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Backend (Express + Supabase)** | ⭐⭐⭐⭐ | Solid. The hybrid storage (Supabase + local fallback + KV cache) is robust for a Vercel deployment. |
| **AI Pipeline** | ⭐⭐⭐⭐⭐ | Multi-provider, multi-tier model support with parallel brand matching is production-grade. |
| **State Management** | ⭐⭐⭐½ | Works, but the app has grown complex enough that a more structured state layer (Context or Zustand) would help. Props are being threaded deeply in some places. |
| **Error Handling** | ⭐⭐⭐⭐ | Good use of try/catch and user-facing alerts. The extraction pipeline has proper timeout and cancellation. |
| **Cloud Storage** | ⭐⭐⭐⭐ | Just fixed the cleanup issues — now properly handles session lifecycle and orphaned assets. |

### 💡 Feature Ideas (If You Want to Push It Further)
1. **Collaboration** — Multi-user support with project sharing (Supabase auth + RLS per user)
2. **Version History** — Track BOQ revisions over time with diff views
3. **Client Portal** — A read-only shareable link for clients to review offers
4. **Analytics Dashboard** — Show insights like "most used brands," "average project cost," "time saved per project"
5. **Template Library** — Pre-built BOQ templates for common project types (office fitout, retail, hospitality)

---

## Session History

### Nov 20, 2026 — Deep Audit Bug Fixes, Security Hardening & Codebase Cleanup
- **Dynamic Live-Catalog Free-Tier Pipeline Router (`server/utils/freeModelRouter.js`)**:
  - Instead of hardcoding model lists, syncs Google's live `GET /v1beta/models` metadata every 30 minutes (and whenever `/api/models/available` or `POST /api/models/refresh-routing` is called — zero generation quota consumed) and dynamically classifies & scores every available model by family (`gemini` / `gemma`), tier (`flash-lite` / `flash` / `gemma-moe` / `pro` / `flagship`), parsed version number, token limits (`inputTokenLimit` / `outputTokenLimit`), deprecation status, and live runtime latency/health.
  - Automatically adapts when Google launches new models (e.g. `gemini-3.9-flash-lite`, `gemini-4-flash`, `gemma-5-*`, `gemini-embedding-3`) or retires old ones, while filtering out specialized non-BOQ media models and paid-only tiers on Free Tier.
  - Applies strictly when Free Tier is active (`activeTier === 'free'`, no `:billed` override) with tier-isolated circuit-breaker cooldowns (`free:` vs `billed:`) and dual-mode daily-RPD benching (`GenerateRequestsPerDay`); Billed Tier always honors the user's selected paid model first.
  - Dynamic pipeline priorities on Free Tier: **`matching`** (newest 3.x+ `flash-lite` → `flash` → `gemma-moe` → `2.x` backup → local deterministic fallback, saving scarce 20-RPD 2.x buckets), **`grounding`** (`2.x` free-search-capable `flash` → `flash-lite` → automatic ungrounded rescue), **`plan_vision`** / **`pdf_boq`** / **`tender_map`** (`1M`/`65K` `flash` → `flash-lite` → `gemma-moe`), and **`embeddings`** (highest `inputTokenLimit` + newest stable `embedContent` model).
- **P0 Security Hardening**:
  - Removed hardcoded `freeimage.host` API key upload fallback in `server/fastExtractor.js` (prevents client BOQ image leakage to third-party public hosts; cleanly falls back to local storage).
  - Created `server/utils/urlSecurity.js` (`assertSafeExternalUrl`, `safeAxiosGet`, `isPrivateOrReservedIp`) and enforced SSRF + safe redirect validation on both `/api/image-proxy` and `/api/process-blob` (blocking localhost, RFC1918, link-local/cloud metadata `169.254.169.254`, IPv6 loopback/ULA, and non-HTTP(S) schemes with HTTP `403`). Re-enabled TLS certificate verification by default on `/api/image-proxy` (`rejectUnauthorized: true`, opt-in override only via `ALLOW_INSECURE_IMAGE_PROXY=1`).
  - Verified `server/data/ai-settings.json` is excluded from git tracking via `.gitignore`.
- **P0 Runtime Crash Fixes**:
  - Declared `DOCLING_SERVICE_URL` in `server/server.js` (unblocking Docling extraction & `/docling/assets/:jobId/:filename`).
  - Defined `AUTO_MATCH_MULTI_ROUTER_SYSTEM` & `AUTO_MATCH_MULTI_AGENT_SYSTEM` and replaced undeclared `NVIDIA_API_KEY` / `OPENROUTER_API_KEY` references in `server/utils/llmUtils.js` with `resolveKey(...) || process.env.*`.
  - Implemented missing `handleManualEnrich(row, index, tierKey)` in `src/components/MultiBudgetModal.jsx` wired to `POST /api/models/enrich`.
  - Hoisted `mupdf` and `doc` declarations in `server/pdfProductExtractor.js` so the Vercel non-Google vision path renders pages without `ReferenceError`.
  - Moved `let collectionName` above `paginationLinks` enqueueing in `server/scraper.js` to eliminate TDZ `ReferenceError`.
- **P1 Logic, Matching & Export Fixes**:
  - Wired `tablesWithSummary` into `renderTableList`, `handleDownloadPDF`, and `handleDownloadExcel` in `src/components/TableViewer.jsx` so inline edits stay reflected in summaries and exports.
  - Fixed Offer PDF cover page banner geometry in `src/components/TableViewer.jsx` (extended header banner to `Y=108` so white `COMMERCIAL OFFER` title, subtitle, and date badge render cleanly inside the dark banner above document metadata).
  - Fixed `src/components/PlanAnalyzerModal.jsx` so manual quantity edits in the verification table are applied when clicking `"Apply to Project BOQ"` rather than discarded by premature auto-apply.
  - Replaced hardcoded `:3001` URL construction in `src/context/CompanyContext.jsx` with `getApiBase()`.
  - Added `e.stopPropagation()` to `handleDragOver`, `handleDragLeave`, and `handleDrop` in `src/components/ActionCard.jsx` to prevent plan drops from bubbling to `window`'s BOQ uploader.
  - Fixed local scraper calls (`sc.scrape(...)` → `sc.scrapeBrand(...)`) and removed duplicate shadowing `POST /api/reset` & `POST /api/cleanup/session` routes in `server/server.js`.
  - Fixed double-escaped `cleanQty` regex (`/[\d.]+/`) and dynamic NVIDIA model validation in `server/utils/llmUtils.js`.
  - Restored `BRAND_SPECIALTIES.customLandscapeAndTerrazzo` (previously overwritten inside `DOMAIN_EXCLUSIONS`) in `server/utils/veBrandSpecialties.js`.
  - Hardened `getCanonicalBrandLogo` in `server/utils/brandLogos.js` with whole-token matching to prevent 3-letter brand keys (`las`, `rim`, `ton`, `emu`, `hay`) from falsely matching unrelated words.
  - Fixed `scrape_url(url, brand_name=None)` signature in `python-scraper/scraper.py` so `scrape_italian` and `scrape_firecrawl` no longer raise `TypeError`.
  - Upgraded `src/utils/arabicPdfUtils.js`: removed redundant segmentation pass, added Lam-Alif (`لا`, `لأ`, `لإ`, `لآ`) ligature reshaping, preserved LTR numeric runs (`1200`, `160x80`, `2026`) inside RTL sentences, and added session-level caching for `Almarai-Regular.ttf`.
- **P2 Cleanup & UI Accessibility**:
  - Deduplicated `server/universalPatternParsersVercel.v22.dynamic-header-boq-spec.js` into a 2-line re-export shim of `universalPatternParsersVercel.js` and pointed `server/server.js` directly to the canonical module.
  - Removed verified zero-reference orphaned files (`src/App.css`, `src/utils/arabicFont.js`, `src/components/BrandSyncPanel.jsx`, `src/styles/PdfModelSelectionModal.module.css`, `server/utils/imageUtils.js`).
  - Repaired `src/components/TenderAutofillModal.jsx` log colorizer (`log.includes('')` → semantic error/warn/success/fill patterns) and restored accessible button labels/icons in `src/components/CompanySettings.jsx` and `src/components/BrandManagement.jsx`.

### Nov 19–20, 2026 — Furniture Sets, Archetype Matching Precision, Official-Site Live Refresh & Visual Lens
- **Multi-Component Furniture Sets**: Added `src/utils/furnitureSetUtils.js` and full multi-component set expansion, matching, and Lump-Sum / Exploded export modes across both `ValueEngineeredModal.jsx` and `MultiBudgetModal.jsx`, including parent brand/model hint inheritance (`buildSetComponentMatchQuery`) for on-the-fly manufacturer exact matching.
- **Archetype & Taxonomy Precision**: Hardened `server/utils/veCategoryPriority.js`, `server/server.js`, and `server/embeddingService.js` to eliminate cross-archetype mismatches (Electric Curtains/Roller Blinds → `FitOut V2 / Window Treatments`, Mobile Filing Racks → `heavyDutyAndMobileFiling`, Boardroom/Meeting vs Folding vs Round tables, L-Shape Desks vs Acoustic Screens, Visitor/Cantilever vs Task Chairs, Single-Seater vs 3-Seater Sofas, and Tuntex Carpet Tiles taxonomy).
- **Official Website Live Refresh & Broken Image Healing**: Added `server/utils/veLiveEnricher.js`, `server/utils/webSearchUtils.js`, `POST /api/brands/:id/refresh-official`, compact-slug sitemap matching (e.g. `Flip Top` ↔ `/fliptop/`), in-place catalog product upgrades in `storageProvider.js`, and dead `img.architonic.com` URL filtering/healing.
- **Zero-LLM Google Lens Matching**: Added `POST /api/ve-match-lens` (backed by `lensJar.js` / `lensHeadless.js`) and per-row `Lens` matching button in `ValueEngineeredModal.jsx`.

### Nov 18, 2026 — Neutral White-Label Branding & Full Codebase Audit
- **Removed Default Company Logo**: Removed hardcoded `alshaya-color.png` / `alshaya-white.png` imports from `src/context/CompanyContext.jsx` and set `DEFAULT_PROFILE.logo` to `null` so the app presents neutrally out-of-the-box (`BOQ FLOW` or user's configured `companyName`) until a company uploads its own branding.
- **Legacy `localStorage` Sanitization**: Added automatic `isLegacyDefaultLogo` detection and cleanup on hydration in `CompanyContext.jsx` to strip cached Alshaya logos from existing browser sessions while preserving saved AI keys and settings.
- **Neutralized UI & Export Fallbacks**: Removed hardcoded `https://alshayaenterprises.com` and `www.alshaya.com` fallbacks from `src/components/TableViewer.jsx`, `server/utils/pptxExportService.js`, and `src/components/CompanySettings.jsx`, and removed literal `'LOGO'` text placeholders in `src/components/MultiBudgetModal.jsx` PPTX slide generation.
- **Deep File-by-File Audit**: Cataloged P0/P1/P2 bugs, security findings, and tech debt across frontend, backend, scrapers, extension, and sidecars into the backlog below.

### Jul 3, 2026 — Chrome Extension Autofill & Vercel ZIP Fix
- **Chrome Extension**: Built full MV3 extension (`content.js`, `background.js`, `popup.js`) enabling direct client-side portal filling without a remote Railway browser container.
- **Vercel Compatibility**: Updated `extension/manifest.json` host permissions to cover `boqv-2.vercel.app`. Extension API calls dynamically resolve to the deployed Vercel backend.
- **Extension Icon**: Uses `public/favicon.png` as the extension icon (all sizes).
- **ZIP Download Bug Fix**: `vercel.json` was missing `zip` from the static file extension regex — requests to `/extension.zip` fell through to the SPA `index.html` catch-all. Fixed by adding an explicit `/extension.zip` route with `Content-Disposition: attachment` response headers.
- **GitHub Auth**: Remote URL updated with PAT for unattended pushes.

### Jun 5, 2026 — Header Popover & Scraper Integration
- **Premium Model Selector**: Replaced native HTML select boxes with custom glassmorphic `<AiModelSelector>` components triggered by circular buttons matching theme controls. Optimized popover legibility in light mode (`rgba(255,255,255,0.98)`).
- **Tender Fill Engine**: Refactored [tenderRoutes.js](server/tenderRoutes.js) to dynamically resolve the mapping model using `aiKeyStorage` and output live model name telemetry logs.
- **Plan Analyzer Repair**: Resolved a backend ReferenceError in `analyzePlan()` by properly declaring and reading `reqGoogleModel` from context.

### Apr 23, 2026 — UI Unification & Background Flow
- **UI Unification**: Standardized the **AI Value Engineer** and **Multi Budget Offer** buttons in `TableViewer.jsx` with a consistent, premium gradient and shadow system.
- **Background Data Sync**: Refactored `App.jsx`, `MultiBudgetModal.jsx`, and `ValueEngineeredModal.jsx` to support real-time data flow. Extracted data now populates active modals automatically.
- **VE Workflow Refinement**: Completed the core logic for the Value Engineered Modal, including strategy selection (Simple vs. Advanced) and brand-to-category mapping.

### Apr 14, 2026 — Branding Standardization & Hygiene
- **Default Profile**: Set Alshaya Enterprises as the hardcoded default in `CompanyContext`.
- **Asset Integration**: Integrated high-res logos and verified dimensions (1561x865).
- **Dynamic Documents**: Decoupled `TableViewer` exports from hardcoded branding; now uses Context API.
- **Git Hygiene**: Updated `.gitignore` to protect scratch/temp files and source logos.
- **Automatic Setup**: Initialized default profile with `setupComplete: true` to streamline landing flow.

### Apr 3, 2026 — AI Autofill Hardening
- Rewrote `executeAutoFillAI` to row-first sequential loop with tier-parallel execution.
- Added 30s AbortController timeout per fetch.
- Fixed `isHeader()` false positives (ALL-CAPS rule removed).
- Added `qty`/`unit` size context to AI enriched description.
- Added `tierDataRef` for async state safety.
- Unified progress counter (`aiProgress.current/total`).
- Backend image URL validation with logo fallback for discovered products.

### Mar 14–15, 2026 — AI Pipeline Foundation
- Built 3-stage AI pipeline (Identify → Local DB → Discover).
- Added Gemini integration via `llmUtils.js`.
- Implemented permanent discovery persistence to brand JSON files.
- Added tier isolation backend filtering.

---

## Known Issues / Next Agent Notes

> [!NOTE]
> **Optional Embedding Pre-Warm (`server/embeddingService.js`)**: `ensureBrandCatalogEmbeddings` is intentionally kept opt-in / non-blocking so local zero-LLM token/archetype matching continues seamlessly even when a user's Google AI key hits quota (`429`). When vector search is desired and embedding quota is active, trigger `ensureBrandCatalogEmbeddings(brand)` on demand or via background warm-up.

> [!NOTE]
> **CSS lint warnings**: `scrollbar-width`, `scrollbar-color` in `MultiBudgetModal.module.css` and `AutoFillSelectModal.module.css` — non-breaking, cosmetic.

> [!TIP]
> **Secrets Hygiene**: `server/data/ai-settings.json` is excluded from git via `.gitignore` for local dev convenience; in production deployments always provide provider keys via environment variables or request headers.

---

## Nov 2026 Deep Codebase Audit — Resolution Status

All P0, P1, and P2 issues identified in the Nov 18, 2026 audit have been verified and resolved as of **Nov 20, 2026**:

| Priority | Item | Status |
|---|---|---|
| **P0 Security** | `server/data/ai-settings.json` git tracking | Verified gitignored (`git ls-files` clean) |
| **P0 Security** | Hardcoded `freeimage.host` key in `server/fastExtractor.js` | **Fixed** — removed third-party upload fallback |
| **P0 Security** | SSRF & `rejectUnauthorized: false` in `/api/image-proxy` & `/api/process-blob` | **Fixed** — added `server/utils/urlSecurity.js` + strict default TLS |
| **P0 Crash** | Missing `autoMatchMultiBrand` / `veRouteCategories` / `veMatchSimple` imports in `server.js` | **Fixed** (`2d15622`, verified) |
| **P0 Crash** | Undeclared `DOCLING_SERVICE_URL` in `server/server.js` | **Fixed** |
| **P0 Crash** | Undeclared `prodText` in `server/utils/veAutoDetectUtils.js` | **Fixed** (`2d15622`, verified) |
| **P0 Crash** | Undefined swarm prompts & `NVIDIA_API_KEY` / `OPENROUTER_API_KEY` in `server/utils/llmUtils.js` | **Fixed** |
| **P0 Crash** | Undefined `handleManualEnrich` in `src/components/MultiBudgetModal.jsx` | **Fixed** |
| **P0 Crash** | Out-of-scope `doc`/`mupdf` in `server/pdfProductExtractor.js` | **Fixed** |
| **P0 Crash** | `collectionName` TDZ error in `server/scraper.js` | **Fixed** |
| **P1 Logic** | `tablesWithSummary` unused & invisible PDF Cover Page title in `src/components/TableViewer.jsx` | **Fixed** |
| **P1 Logic** | Premature auto-apply discarding edits in `src/components/PlanAnalyzerModal.jsx` | **Fixed** |
| **P1 Logic** | Hardcoded `:3001` port in `src/context/CompanyContext.jsx` | **Fixed** (uses `getApiBase()`) |
| **P1 Logic** | Missing `e.stopPropagation()` on drag/drop in `src/components/ActionCard.jsx` | **Fixed** |
| **P1 Logic** | Missing `await` on `getFormattedAlternatives` in `server/server.js` | **Verified Fixed** (all 6 call sites awaited) |
| **P1 Logic** | `sc.scrape(...)` vs `sc.scrapeBrand(...)` & duplicate `/api/reset`, `/api/cleanup/session` routes | **Fixed** |
| **P1 Logic** | `VALID_NVIDIA_MODELS` empty check & double-escaped `cleanQty` regex in `llmUtils.js` | **Fixed** |
| **P1 Logic** | `customLandscapeAndTerrazzo` overwritten in `server/utils/veBrandSpecialties.js` | **Fixed** |
| **P1 Logic** | 3-letter substring logo collisions in `server/utils/brandLogos.js` | **Fixed** (whole-token matcher) |
| **P1 Logic** | 2-arg `scrape_url(url, brand_name)` `TypeError` in `python-scraper/scraper.py` | **Fixed** |
| **P1 Logic** | Arabic PDF reshaper dead loop, reversed digits, missing Lam-Alif, uncached CDN font | **Fixed** |
| **P1 Logic** | `handleRetryRow` in `MultiBudgetModal.jsx` & `NARBUTAS Forum` coffee vs meeting routing | **Verified Resolved** |
| **P2 Cleanup** | Duplicate 99KB `universalPatternParsersVercel.v22` copy | **Fixed** (2-line re-export shim) |
| **P2 Cleanup** | Confirmed zero-reference dead files (`App.css`, `arabicFont.js`, `BrandSyncPanel.jsx`, `PdfModelSelectionModal.module.css`, `imageUtils.js`) | **Removed** (kept actively imported `ValueEngineeredModal.module.css`, `browserlessScraper.js`, `scrapingBeeScraper.js`) |
| **P2 Cleanup** | Broken `log.includes('')` colorizer & stripped button icons (`TenderAutofillModal`, `CompanySettings`, `BrandManagement`) | **Fixed** |
