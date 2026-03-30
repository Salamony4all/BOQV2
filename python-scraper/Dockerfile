FROM python:3.11-slim-bookworm

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    unzip \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir playwright

# Install browser binaries and dependencies
# 1. Playwright Chromium
RUN playwright install chromium
RUN playwright install-deps chromium

# 2. Camoufox: Fetch binary. (Required for Scrapling import)
RUN python -m camoufox fetch

COPY . .

# Expose port (railway sets PORT env var)
# CMD uses the $PORT env var if uvicorn supports it in shell form
CMD sh -c "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"
