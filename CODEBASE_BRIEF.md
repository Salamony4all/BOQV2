# BOQFLOW — Codebase Brief & Documentation

## Overview
BOQFLOW is a specialized enterprise web application for processing **Bill of Quantities (BOQ)**, automating project costing, and generating professional proposals. Tailored for the furniture and fit-out industry, it enables users to extract data from Excel/PDF files, match products from a local brand database or via AI, generate multi-budget alternatives, value-engineered (VE) offers, and auto-submit bid estimates directly into etendering portals.

---

## Technology Stack
- **Frontend**: React 19 (Vite 7), CSS Modules, Context API
- **Backend**: Node.js (Express 5), Multer
- **AI**: Google Gemini 2.5/3.5 Flash (`@google/generative-ai`) — primary AI provider
- **Scraping & Automation (Sidecar)**: Playwright, Cheerio, Crawlee, Scrapling, Chrome DevTools Protocol (CDP)
- **Data Extraction**: Custom Excel streaming extractor (`fastExtractor.js`) via `exceljs` + `adm-zip`
- **Document Gen**: `exceljs` (Excel), `jspdf` (PDF), `pptxgenjs` (PowerPoint)
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
| `server.js` | Main Express app. All API routes. AI autofill pipeline coordination. Context-scoping middleware. |
| `tenderRoutes.js` | Remote browser portal integration. Sets up Chrome instances, maps pages, and deploys bulk estimation scripts. |
| `llmProxyRoutes.js` | Proxies and validates downstream local or LLM provider requests. |
| `utils/llmUtils.js` | Gemini AI provider integration. Context-scoped API key resolving, model routing, and product mapping. |
| `utils/veMatchUtils.js` | Value Engineering heuristics: simple/advanced matching, detail scraping, and category routing. |
| `utils/supabaseStorage.js` | Abstraction layer for Supabase PostgreSQL database tables and Storage buckets. |
| `storageProvider.js` | Hybrid storage coordinator: orchestrates Supabase DB sync, KV caching, and Railway volume replication. |
| `fastExtractor.js` | High-performance Excel processor. Extracts rows + uploads embedded images to Supabase storage. |
| `scraper.js` | Universal scraper via Crawlee. Architonic + brand site harvesting. |
| `cleanupService.js` | Session cleanup and temp file/cloud asset management. |

### Frontend (`/src`)
| File | Role |
|---|---|
| `App.jsx` | Landing page, file upload coordination, custom toggles, and background data flow sync between modals. |
| `components/TenderAutofillModal.jsx` | UI interface for the remote browser automation session. Hosts the interactive VNC stream, progress list, and execute triggers. |
| `components/MultiBudgetModal.jsx` | Core AI Autofill UI. 3-tier BOQ comparison view. |
| `components/ValueEngineeredModal.jsx` | Value Engineered Workflow. Focused on cost-saving alternatives and brand replacements. |
| `components/AutoFillSelectModal.jsx` | Brand selection modal before AI run. Per-tier brand display. |
| `components/TableViewer.jsx` | Main BOQ table viewer/editor post-extraction. Features unified Action Bar triggers. |
| `components/AddBrandModal.jsx` | Add new brand to local DB. |
| `components/CostingModal.jsx` | Cost simulation (profit, freight, VAT). |
| `context/CompanyContext.jsx` | Company profile (logo, name, AI model selections) persisted across app. |
| `context/ThemeContext.jsx` | Dark/Light theme toggle, stored in localStorage. |
| `utils/apiBase.js` | Configures client API endpoints and hosts the fetch header interceptor. |

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

### Jun 5, 2026 — Header Popover & Scraper Integration
- **Premium Model Selector**: Replaced native HTML select boxes with custom glassmorphic `<AiModelSelector>` components triggered by circular buttons matching theme controls. Optimized popover legibility in light mode (`rgba(255,255,255,0.98)`).
- **Tender Fill Engine**: Refactored [tenderRoutes.js](file:///c:/Users/Mohamad60025/Desktop/App/BOQ%20-%20v2/server/tenderRoutes.js) to dynamically resolve the mapping model using `aiKeyStorage` and output live model name telemetry logs.
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

> [!WARNING]
> **Coffee Table → Meeting Table**: NARBUTAS "Forum" series is labeled "Meeting Tables" in DB even though it serves coffee-table use. Size context now sent to AI (`R:30`) but the DB category itself needs a `Lounge Tables` subcategory added for proper routing.

> [!NOTE]
> **Retry button** (`handleRetryRow`) only resets `aiStatus` but doesn't re-trigger AI. Needs to call a single-row version of `executeAutoFillAI`.

> [!NOTE]
> **CSS lint warnings**: `scrollbar-width`, `scrollbar-color` in `MultiBudgetModal.module.css` and `AutoFillSelectModal.module.css` — non-breaking, cosmetic.
