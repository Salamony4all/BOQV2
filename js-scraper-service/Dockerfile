# Use the official Playwright image as the base
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

# Set environment variables for Playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies (only production)
# We use npm ci for a clean, reproducible install
RUN npm ci --only=production

# Explicitly ensure chromium and its dependencies are installed
# Even though they should be in the base image, this ensures stability
RUN npx playwright install chromium
RUN npx playwright install-deps chromium

# Copy the rest of the application code
COPY . .

# Set environment to production
ENV NODE_ENV=production

# The port the application will listen on
# Railway sets the PORT environment variable automatically
ENV PORT=3002
EXPOSE 3002

# Start the application
CMD ["npm", "start"]
