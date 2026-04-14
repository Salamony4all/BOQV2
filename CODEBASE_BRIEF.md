# BOQFLOW — Codebase Brief

## Overview
BOQFLOW is a specialized web application for processing **Bill of Quantities (BOQ)**, automating project costing, and generating professional proposals. Focused on the furniture and fit-out industry — users extract data from Excel/PDF files, match products from a local brand database or via AI, and generate multi-budget alternatives.

---

## Technology Stack
- **Frontend**: React 19 (Vite 7), CSS Modules, Context API
- **Backend**: Node.js (Express 5), Multer
- **AI**: Google Gemini 2.5 Flash (`@google/generative-ai`) — primary AI provider
- **Scraping**: Playwright, Cheerio, Crawlee (Universal + Architonic scrapers)
- **Data Extraction**: Custom Excel streaming extractor (`fastExtractor.js`) via `exceljs` + `adm-zip`
- **Document Gen**: `exceljs` (Excel), `jspdf` (PDF), `pptxgenjs` (PowerPoint)
- **Storage**: Local `/server/data/brands/*.json` (primary), Vercel KV + Blob (production)

---

## Core Architecture

### Backend (`/server`)
| File | Role |
|---|---|
| `server.js` | Main Express app. All API routes. AI autofill pipeline (Stage 1 → 2 → 3). |
| `utils/llmUtils.js` | Gemini AI integration. `identifyModel()` (Stage 1) and `discoverProduct()` (Stage 3 fallback). |
| `storageProvider.js` | Abstraction layer: local fs vs Vercel Blob/KV. |
| `fastExtractor.js` | High-performance Excel processor. Extracts rows + embedded images. |
| `scraper.js` | Universal scraper via Crawlee. Architonic + brand site harvesting. |
| `cleanupService.js` | Session cleanup and temp file management. |

### Frontend (`/src`)
| File | Role |
|---|---|
| `App.jsx` | Landing page, file upload coordination, routing. |
| `components/MultiBudgetModal.jsx` | **Core AI Autofill UI**. 3-tier BOQ comparison. AI AUTO-FILL engine. |
| `components/AutoFillSelectModal.jsx` | Brand selection modal before AI run. Per-tier brand display. |
| `components/TableViewer.jsx` | Main BOQ table viewer/editor post-extraction. |
| `components/AddBrandModal.jsx` | Add new brand to local DB. |
| `components/CostingModal.jsx` | Cost simulation (profit, freight, VAT). |
| `context/CompanyContext.js` | Company profile (logo, name) persisted across app. |
| `context/ThemeContext.jsx` | Dark/Light theme toggle, stored in localStorage. |
| `utils/apiBase.js` | Returns correct API base URL for local vs production. |

---

## AI Autofill Pipeline — `POST /api/auto-match-ai`

The 3-stage pipeline in `server.js`:

### Stage 1 — Model Identification (AI)
- Calls `identifyModel(enrichedDescription, brandName, tier, provider)` in `llmUtils.js`
- Uses Google Gemini with web search to answer: *"What is the best single model from [Brand] for [description]?"*
- Returns: `{ model: "FORUM", confidence: "high" }`
- `enrichedDescription` = BOQ description + qty/unit context (e.g., `"OFFICE COFFEE TABLE R:30 | Qty: 2 Unit: Nos"`)

### Stage 2 — Local DB Lookup (Fuzzy Match)
- Searches brand JSON in `server/data/brands/` for the identified model name
- Fuzzy match: normalizes both strings, checks for partial/contains matches
- If **found** → returns local product data immediately ✅

### Stage 3 — Web Discovery (Fallback only)
- Triggered only when Stage 2 fails
- Scrapes Architonic or brand official site for model details
- Validates discovered product: rejects relative/invalid `imageUrl`, falls back to brand logo
- **Permanently saves** discovered product to the brand JSON file for future use

### Tier Isolation
The backend filters `brandCandidates` to only brands whose `budgetTier` in the DB matches the requested `tier` — even if the client sends mixed brands. This prevents cross-tier contamination.

---

## Brand Database Structure

Location: `server/data/brands/*.json`

17 JSON files currently (as of 2026-04-03):

| Tier | Brands |
|---|---|
| **Budgetary** | Ottimo Furniture, Amara |
| **Mid-Range** | NARBUTAS, B&T Design, Fitout V2, Frezza, Ismobil, LAS, Nurus, Ofifran, RIM, Sokoa |
| **High-End / Premium** | Arper, Teknion ME |

Each brand JSON has structure:
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

## isHeader() Detection Logic

Only two conditions trigger header detection:
1. Exact match against column keyword labels: `description`, `description and area`, `qty`, `unit`, `rate`, `price`, `total`, etc.
2. Regex prefix: `/^(group|type|section|category|list)\s+of\s/i`

> ⚠️ Do NOT add `head` back to the regex — `HEAD OF CHAIR`, `HEAD OF DESK`, `HEAD OF GUEST CHAIR` are **real furniture products** for the department head, not section labels.  
> Do NOT reinstate the "ALL-CAPS + short + no digits" heuristic — it falsely skips real BOQ rows like `STAFF CHAIR`, `DIRECTOR CHAIR`, `GENERAL MEETING ROOM CHAIR`.

---

## Infrastructure & Dev Setup

- **Local Dev**: `npm run dev:all` OR start backend (`node server/server.js`) and frontend (`npm run dev`) separately
- **Backend Port**: `3001`
- **Frontend Port**: `5173`
- **API Base**: `getApiBase()` in `utils/apiBase.js` returns `http://localhost:3001` locally, relative path on Vercel
- **AI Key**: `GEMINI_API_KEY` in `.env` (Google Gemini provider)
- **Image Proxy**: `GET /api/image-proxy?url=<base64-encoded-url>` — proxies Architonic/Amara images with base64 encoding to bypass client-side security inspection

---

## Session History

### Apr 14, 2026 — Branding Standardization & Hygiene
- **Default Profile**: Set Alshaya Enterprises as the hardcoded default in `CompanyContext`.
- **Asset Integration**: Integrated high-res logos and verified dimensions (1561x865).
- **Dynamic Documents**: Decoupled `TableViewer` exports from hardcoded branding; now uses Context API.
- **Git Hygiene**: Updated `.gitignore` to protect scratch/temp files and source logos.
- **Automatic Setup**: Initialized default profile with `setupComplete: true` to streamline landing flow.

### Apr 3, 2026 — AI Autofill Hardening
- Rewrote `executeAutoFillAI` to row-first sequential loop with tier-parallel execution
- Added 30s AbortController timeout per fetch (prevents frozen state)
- Fixed `isHeader()` false positives (ALL-CAPS rule removed)
- Added `qty`/`unit` size context to AI enriched description
- Added `tierDataRef` for async state safety
- Unified progress counter (`aiProgress.current/total`)
- Backend image URL validation with logo fallback for discovered products

### Mar 14–15, 2026 — AI Pipeline Foundation
- Built 3-stage AI pipeline (Identify → Local DB → Discover)
- Added Gemini integration via `llmUtils.js`
- Implemented permanent discovery persistence to brand JSON files
- Added tier isolation backend filtering

### Earlier — Core App
- BOQ Excel extraction, multi-budget modal, Architonic scraper, PDF/PPTX export
- Dark/Light theme, image proxy security

---

## Known Issues / Next Agent Notes

> [!WARNING]
> **Coffee Table → Meeting Table**: NARBUTAS "Forum" series is labeled "Meeting Tables" in DB even though it serves coffee-table use. Size context now sent to AI (`R:30`) but the DB category itself needs a `Lounge Tables` subcategory added for proper routing.

> [!NOTE]
> **Retry button** (`handleRetryRow`) only resets `aiStatus` but doesn't re-trigger AI. Needs to call a single-row version of `executeAutoFillAI`.

> [!NOTE]
> **CSS lint warnings**: `scrollbar-width`, `scrollbar-color` in `MultiBudgetModal.module.css` and `AutoFillSelectModal.module.css` — non-breaking, cosmetic.
