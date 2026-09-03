import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const brandsDir = path.join(__dirname, '..', 'data', 'brands');

const CORE_BRANDS = new Set([
  'amara-budgetary.json',
  'arper-high.json',
  'b_t_design-mid.json',
  'dauphin_products__collections_and_more-mid.json',
  'fitout_v2-budgetary.json',
  'fitout_v2-high.json',
  'fitout_v2-mid.json',
  'frezza-mid.json',
  'herman_miller-mid.json',
  'ismobil-mid.json',
  'las-mid.json',
  'mw_structure_test-mid.json',
  'narbutas-mid.json',
  'nurus-mid.json',
  'ofifran-mid.json',
  'ottimo-budgetary.json',
  'ottimo_furniture-budgetary.json',
  'rim-mid.json',
  'sedus_stoll-mid.json',
  'sokoa-mid.json',
  'teknion_me-premium.json',
  'workspace_ae-mid.json'
]);

const files = fs.readdirSync(brandsDir);
let removed = 0;

for (const file of files) {
  if (file.endsWith('.json') && !CORE_BRANDS.has(file)) {
    const fullPath = path.join(brandsDir, file);
    fs.unlinkSync(fullPath);
    console.log(`🗑️ Removed temporary discovered brand file: ${file}`);
    removed++;
  }
}

console.log(`✅ Cleaned up ${removed} temporary brand JSON files. Core brand catalogs are restored to original pristine state.`);
