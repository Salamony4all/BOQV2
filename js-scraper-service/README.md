# JS Scraper Service for BOQ Application

A standalone Node.js microservice that provides web scraping capabilities via REST API.
Designed to be deployed on Railway and called from the main Vercel application.

## Scrapers Included

1. **Universal Scraper** (`/scrape`) - Handles most furniture websites with intelligent product detection
2. **Structure Scraper** (`/scrape-structure`) - Hierarchical category harvester for complex site structures
3. **Architonic Scraper** (`/scrape-architonic`) - Specialized scraper for Architonic.com brand pages

## API Endpoints

### Health Check
```
GET /health
```

### Universal Scrape
```
POST /scrape
Body: { "url": "https://example.com", "name": "Brand Name", "sync": false }
```

### Structure Scrape
```
POST /scrape-structure
Body: { "url": "https://example.com", "name": "Brand Name", "sync": false }
```

### Architonic Scrape
```
POST /scrape-architonic
Body: { "url": "https://architonic.com/...", "name": "Brand Name", "sync": false }
```

### Task Status
```
GET /tasks/:taskId
```

### Cancel Task
```
DELETE /tasks/:taskId
```

## Environment Variables

- `PORT` - Server port (default: 3002, Railway sets this automatically)

## Deployment to Railway

1. Create a new Railway project
2. Connect this folder as a service
3. Railway will auto-detect Node.js and run `npm start`
4. Copy the deployed URL and set it as `JS_SCRAPER_SERVICE_URL` in your Vercel environment

## Local Development

```bash
npm install
npx playwright install chromium
npm run dev
```
