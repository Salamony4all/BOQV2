
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeProducts } from '../utils/normalizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRANDS_DIR = path.join(__dirname, '../data/brands');
const MASTER_DB_PATH = path.join(__dirname, '../data/product_database.json');

async function syncNormalization() {
  console.log('--- STARTING NORMALIZATION HOSPITAL ---');
  
  const files = fs.readdirSync(BRANDS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} brand files to process.`);

  let allProducts = [];

  for (const file of files) {
    const filePath = path.join(BRANDS_DIR, file);
    console.log(`\nProcessing ${file}...`);
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const products = Array.isArray(data) ? data : (data.products || []);
      
      const brandName = data.name || file.replace('.json', '');
      
      console.log(`  - Local: ${products.length} products`);
      
      // RUN NORMALIZATION
      const normalized = normalizeProducts(products);
      
      // Update the file content
      if (Array.isArray(data)) {
        fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
      } else {
        data.products = normalized;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      }
      
      console.log(`  - SUCCESS: Normalized ${normalized.length} products for ${brandName}`);
      
      // Collect for master update
      allProducts = allProducts.concat(normalized);

    } catch (err) {
      console.error(`  - ERROR processing ${file}:`, err.message);
    }
  }

  // Update Master DB if it exists
  if (fs.existsSync(MASTER_DB_PATH)) {
    console.log('\nUpdating master product database...');
    try {
      fs.writeFileSync(MASTER_DB_PATH, JSON.stringify(allProducts, null, 2));
      console.log('Master DB updated successfully.');
    } catch (err) {
      console.error('Failed to update Master DB:', err.message);
    }
  }

  console.log('\n--- NORMALIZATION HOSPITAL COMPLETE ---');
}

syncNormalization().catch(console.error);
