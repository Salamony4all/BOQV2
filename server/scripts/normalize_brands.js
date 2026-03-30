
import fs from 'fs';
import path from 'path';
import { normalizeProducts } from '../utils/normalizer.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRANDS_DIR = path.join(__dirname, '../data/brands');

async function normalize() {
  const files = fs.readdirSync(BRANDS_DIR).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    const filePath = path.join(BRANDS_DIR, file);
    const rawData = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(rawData);
    if (!data.products) continue;
    
    data.products = normalizeProducts(data.products);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Normalized ${file} with new taxonomy`);
  }
}

normalize().catch(console.error);
