# Sidecar Scraper Architecture

## Overview

The BOQ application uses a **sidecar architecture** for web scraping, where the main Vercel app delegates scraping operations to Railway-hosted microservices.

```
                    ┌─────────────────────────────────────────────────┐
                    │                   RAILWAY                        │
                    │  ┌──────────────────┐  ┌──────────────────────┐ │
                    │  │  JS Scraper      │  │  Python Scraper      │ │
                    │  │  Service         │  │  Service             │ │
                    │  │  ─────────────── │  │  ─────────────────── │ │
                    │  │  • Playwright    │  │  • Scrapling         │ │
                    │  │  • Crawlee       │  │  • FastAPI           │ │
                    │  │  • Architonic    │  │  • Architonic (new)  │ │
                    │  │  • Structure     │  │                      │ │
                    │  └────────┬─────────┘  └──────────┬───────────┘ │
                    └───────────┼──────────────────────┼──────────────┘
                                │                      │
                    ┌───────────┴──────────────────────┴──────────────┐
                    │                    VERCEL                        │
                    │  ┌──────────────────────────────────────────┐   │
                    │  │            Main BOQ App                   │   │
                    │  │  ─────────────────────────────────────── │   │
                    │  │  • Next.js / Express                     │   │
                    │  │  • UI + API Routes                       │   │
                    │  │  • Calls Railway scrapers via HTTP       │   │
                    │  └──────────────────────────────────────────┘   │
                    └─────────────────────────────────────────────────┘
```

## Why Sidecar Architecture?

1. **Vercel Limitations**: Serverless functions have memory limits and no persistent browser support
2. **Heavy Dependencies**: Playwright/Chromium require significant resources
3. **Reliability**: Dedicated scraping servers with proper browser support
4. **Scalability**: Can scale scrapers independently from the main app

## Services

### 1. JS Scraper Service (`js-scraper-service/`)

**Technology**: Node.js + Playwright + Crawlee

**Features**:
- Universal intelligent product detection
- Architonic specialized scraper
- Structure/hierarchy harvester
- Async task tracking

**Endpoints**:
- `POST /scrape` - Universal scraping
- `POST /scrape-structure` - Hierarchical category scraping  
- `POST /scrape-architonic` - Architonic.com scraping
- `GET /tasks/:id` - Task status
- `DELETE /tasks/:id` - Cancel task

### 2. Python Scraper Service (`python-scraper/`)

**Technology**: Python + FastAPI + Scrapling

**Features**:
- WooCommerce/e-commerce scraping
- Architonic support (new)
- Anti-detection via Scrapling
- Async task tracking

**Endpoints**:
- `POST /scrape` - Universal scraping
- `POST /scrape-architonic` - Architonic.com scraping
- `GET /tasks/{id}` - Task status
- `DELETE /tasks/{id}` - Cancel task

## Deployment

### Deploy JS Scraper to Railway

```bash
cd js-scraper-service

# Option 1: Railway CLI
railway login
railway init
railway up

# Option 2: GitHub Integration
# Push to GitHub, connect repo to Railway
```

### Deploy Python Scraper to Railway

```bash
cd python-scraper

# Option 1: Railway CLI
railway login  
railway init
railway up

# Option 2: GitHub Integration
# Push to GitHub, connect repo to Railway
```

### Configure Vercel

Add to Vercel Environment Variables:

```
JS_SCRAPER_SERVICE_URL=https://your-js-scraper.railway.app
PYTHON_SERVICE_URL=https://your-python-scraper.railway.app
```

## API Usage from Vercel

The main app exposes unified endpoints that delegate to Railway:

- `POST /api/scrape-railway` - Uses JS scraper service
- `POST /api/scrape-scrapling` - Uses Python scraper service
- `POST /api/scrape-ai` - Auto-selects best scraper

### Example

```javascript
// From frontend
const response = await fetch('/api/scrape-railway', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://example.com',
    name: 'Brand Name',
    scraper: 'auto'  // 'auto', 'universal', 'structure', 'architonic'
  })
});

const { taskId } = await response.json();

// Poll for completion
const pollTask = async () => {
  const task = await fetch(`/api/tasks/${taskId}`).then(r => r.json());
  if (task.status === 'completed') {
    console.log('Products:', task.brand.products.length);
  } else if (task.status === 'failed') {
    console.error('Failed:', task.error);
  } else {
    setTimeout(pollTask, 2000);
  }
};
pollTask();
```

## Fallback Chain

When scraping, the app tries in order:

1. **Railway JS Scraper** (if `JS_SCRAPER_SERVICE_URL` is set)
2. **Railway Python Scraper** (if `PYTHON_SERVICE_URL` is set)
3. **Cloud Scrapers** (ScrapingBee/Browserless if API keys are set)
4. **Local Scrapers** (only in development)

## Development

### Run Both Services Locally

```bash
# Terminal 1: JS Scraper
cd js-scraper-service
npm install && npx playwright install chromium
npm run dev

# Terminal 2: Python Scraper  
cd python-scraper
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 3: Main App
npm run dev
```

Set in `.env.local`:
```
JS_SCRAPER_SERVICE_URL=http://localhost:3002
PYTHON_SERVICE_URL=http://localhost:8000
```
