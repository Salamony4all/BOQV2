/**
 * One-time cleanup script: strips "#ID" suffix from all model names in the v2 brand database.
 * Example: "Wind #3742891" → "Wind"
 * Run: node scripts/fix-model-names.mjs
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandsDir = path.resolve(__dirname, '../server/data/brands');

async function fixModelNames() {
  const files = await fs.readdir(brandsDir);
  let totalFixed = 0;
  let totalProducts = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(brandsDir, file);
    let data;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      data = JSON.parse(raw);
    } catch (e) {
      console.warn(`⚠️  Could not parse ${file}: ${e.message}`);
      continue;
    }

    if (!Array.isArray(data.products)) continue;

    let fileFixed = 0;
    data.products = data.products.map(p => {
      if (p.model && /\s#\d+$/.test(p.model)) {
        const cleaned = p.model.replace(/\s#\d+$/, '').trim();
        fileFixed++;
        return { ...p, model: cleaned };
      }
      return p;
    });

    if (fileFixed > 0) {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`✅ ${file}: fixed ${fileFixed} model names`);
      totalFixed += fileFixed;
    }
    totalProducts += data.products.length;
  }

  console.log(`\n🎉 Done! Fixed ${totalFixed} model names across ${files.length} brand files (${totalProducts} total products).`);
}

fixModelNames().catch(console.error);
