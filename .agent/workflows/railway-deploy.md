---
description: How to deploy the Railway scraper sidecar
---

# Railway Scraper Sidecar Deployment

## Important Architecture Note
The scraper sidecar on Railway is **NOT connected to GitHub auto-deploy**. It must be deployed manually after pushing code changes.

## Deployment Steps

1. **Push code changes to GitHub** (js-scraper-service folder)
   ```powershell
   cd c:\Users\Mohamad60025\Desktop\App\BOQ\js-scraper-service
   git add -A
   git commit -m "your commit message"
   git push origin master
   ```

2. **Manually trigger Railway deployment**
   - Go to Railway dashboard: https://railway.app/dashboard
   - Find the js-scraper-service project
   - Click "Deploy" or trigger a manual redeploy

## Service Details
- **Main App**: Vercel (frontend + API routes)
- **Scraper Sidecar**: Railway (Playwright-based scraper service)
- **Communication**: Main app calls Railway scraper API endpoints

## Key Files
- `scraper.js` - Main scraping logic
- `index.js` - Express server with API endpoints
- `structureScraper.js` - Additional scraping utilities

// turbo-all
