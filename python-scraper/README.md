# Python Scraper Service for BOQ Application

A standalone Python microservice using FastAPI and Scrapling for web scraping.
Designed to be deployed on Railway as a sidecar to the main Vercel application.

## Features

- **Universal Scraper** - WooCommerce, generic e-commerce, and furniture sites
- **Architonic Scraper** - Specialized scraper for Architonic.com brand pages
- **Async Task Processing** - Background scraping with task polling
- **CORS Support** - Works with cross-origin requests from Vercel

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

### Architonic Scrape
```
POST /scrape-architonic
Body: { "url": "https://architonic.com/...", "name": "Brand Name", "sync": false }
```

### Task Status
```
GET /tasks/{taskId}
```

### Cancel Task
```
DELETE /tasks/{taskId}
```

## Environment Variables

- `PORT` - Server port (default: 8000, Railway sets this automatically)

## Deployment to Railway

1. Create a new Railway project
2. Connect this folder as a service (or use Git)
3. Railway will auto-detect Dockerfile and build
4. Copy the deployed URL and set it as `PYTHON_SERVICE_URL` in your Vercel environment

## Local Development

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install dependencies
pip install -r requirements.txt
pip install playwright
playwright install chromium
python -m camoufox fetch

# Run server
uvicorn main:app --reload --port 8000
```

## Files

- `main.py` - FastAPI application with endpoints
- `scraper.py` - Universal scraper using Scrapling
- `architonic_scraper.py` - Architonic-specific scraper
- `requirements.txt` - Python dependencies
- `Dockerfile` - Container configuration for Railway
