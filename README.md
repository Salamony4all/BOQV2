# BOQFLOW

**Intelligent BOQ Extraction, Multi-Budget Costing & AI Procurement Engine**

---

## What is BOQFLOW?

BOQFLOW automates the Bill of Quantities (BOQ) workflow for furniture and fit-out projects. It extracts BOQ data from Excel/PDF files, intelligently matches products from a local brand database using a 3-stage AI pipeline, and generates professional multi-budget proposals (Budgetary / Mid-Range / High-End).

---

## Quick Start

```bash
# Install dependencies
npm install

# Start both servers (backend :3001 + frontend :5173)
npm run dev:all

# OR start separately:
node server/server.js       # backend
npm run dev                 # frontend (Vite)
```

Open: `http://localhost:5173`

---

## Environment Variables (`.env`)

```env
GEMINI_API_KEY=your_google_gemini_key
SCRAPINGBEE_API_KEY=your_scrapingbee_key   # optional, for Amara Art scraping
JS_SCRAPER_SERVICE_URL=https://your-railway-url  # optional Railway sidecar
```

---

## Key Features

### 📄 BOQ Processing
- Upload Excel or PDF → automatic row + image extraction
- Manual BOQ creation via product browser

### 🤖 AI Auto-Fill (3-Stage Pipeline)
1. **Stage 1 — Identify**: Gemini AI with web search finds the best model name for a BOQ description
2. **Stage 2 — Local DB Lookup**: Fuzzy-matches identified model against local brand JSON files
3. **Stage 3 — Discover**: Falls back to Architonic/brand website scraping; saves discovered products permanently to DB

### 💰 Multi-Budget Comparison
- Simultaneously generates Budgetary, Mid-Range, and High-End alternatives
- AI processes rows in order (top-to-bottom), all 3 tiers per row in parallel
- Comparison View shows all 3 tiers side-by-side

### 📤 Export
- PDF Offer, Excel Sheet, PowerPoint Presentation
- MAS (Material Approval Sheet) format

---

## Project Structure

```
BOQ - v2/
├── server/
│   ├── server.js              # Express API + AI pipeline
│   ├── utils/
│   │   └── llmUtils.js        # Gemini AI calls
│   ├── data/
│   │   └── brands/            # Brand JSON databases (17 files)
│   └── storageProvider.js     # Local / Vercel storage abstraction
├── src/
│   ├── components/
│   │   ├── MultiBudgetModal.jsx     # Core AI Autofill + 3-tier comparison
│   │   ├── AutoFillSelectModal.jsx  # Brand selection before AI run
│   │   ├── TableViewer.jsx          # BOQ table viewer/editor
│   │   ├── AddBrandModal.jsx        # Add brand to local DB
│   │   └── CostingModal.jsx         # Cost simulation
│   ├── context/
│   │   ├── CompanyContext.js        # Company profile (logo, name)
│   │   └── ThemeContext.jsx         # Dark/Light theme
│   └── utils/
│       └── apiBase.js               # API URL resolver
├── CODEBASE_BRIEF.md          # Detailed technical reference for AI agents
├── walkthrough.md             # Session change log
└── task.md                    # Current TODO list
```

---

## Brand Tiers

| Tier | Brands |
|---|---|
| 💰 Budgetary | Ottimo Furniture, Amara |
| ⭐ Mid-Range | NARBUTAS, B&T Design, Frezza, LAS, Nurus, Sokoa, + more |
| 💎 High-End | Arper, Teknion ME |

---

## For AI Agents

- Read `CODEBASE_BRIEF.md` first — it contains the full architecture, pipeline details, and known issues
- Read `walkthrough.md` for latest session changes
- Read `task.md` for current TODO list
- **Never reinstate the ALL-CAPS isHeader heuristic** — it falsely skips real BOQ rows
- The AI pipeline endpoint is `POST /api/auto-match-ai` in `server.js`
- Brand JSONs live in `server/data/brands/` — each discovered product is permanently saved here
