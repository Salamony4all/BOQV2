/**
 * One-time normalization script: applies normalizeProducts() to all existing brand files.
 * This ensures the FFE matcher works immediately without re-scraping.
 * Run: node scripts/normalize-existing-brands.mjs
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandsDir = path.resolve(__dirname, '../server/data/brands');

// --- Inline the normalizer so this script is self-contained ---
// (Mirrors server/utils/normalizer.js TAXONOMY)

const TAXONOMY = {
  'Office Seating': {
    keywords: ['chair', 'seating', 'stool', 'saddle', 'seat', 'operative', 'task chair', 'executive chair', 'office chair', 'mesh chair', 'ergonomic'],
    subCategories: {
      'Task Chair': ['task', 'operative', 'mesh', 'ergonomic', 'work chair', 'office chair'],
      'Executive Chair': ['executive', 'manager', 'director', 'high back', 'leather chair'],
      'Visitor Chair': ['visitor', 'guest', 'side chair', 'meeting chair', 'conference chair'],
      'Stool': ['stool', 'bar stool', 'counter stool', 'saddle'],
    }
  },
  'Lounge & Reception': {
    keywords: ['sofa', 'lounge', 'armchair', 'pouf', 'ottoman', 'bench', 'couch', 'reception chair', 'waiting'],
    subCategories: {
      'Sofa': ['sofa', 'couch', '2-seater', '3-seater', 'two seat', 'three seat'],
      'Lounge Chair': ['lounge chair', 'armchair', 'easy chair', 'relax'],
      'Pouf & Ottoman': ['pouf', 'ottoman', 'footrest'],
      'Bench': ['bench', 'waiting bench'],
    }
  },
  'Desk & Table': {
    keywords: ['desk', 'table', 'workstation', 'worktop', 'work surface', 'benching'],
    subCategories: {
      'Height-Adjustable Desk': ['height adjustable', 'sit-stand', 'standing desk', 'electric desk'],
      'Fixed Desk': ['fixed desk', 'executive desk', 'manager desk', 'single desk', 'l-shape'],
      'Meeting Table': ['meeting table', 'conference table', 'boardroom', 'round table', 'seminar'],
      'Workstation System': ['workstation', 'bench system', 'benching', 'cluster', 'nova', 'open plan'],
    }
  },
  'Storage': {
    keywords: ['cabinet', 'storage', 'drawer', 'pedestal', 'locker', 'filing', 'cupboard', 'sideboard', 'shelving', 'bookcase'],
    subCategories: {
      'Pedestal': ['pedestal', 'mobile pedestal', 'under-desk'],
      'Filing Cabinet': ['filing', 'file cabinet', 'lateral cabinet'],
      'Locker': ['locker', 'personal locker'],
      'Shelving': ['shelving', 'bookcase', 'shelf', 'open storage'],
    }
  },
  'Acoustic Solutions': {
    keywords: ['pod', 'booth', 'acoustic', 'privacy', 'phone booth', 'meeting pod', 'focus pod'],
    subCategories: {
      'Phone Booth': ['phone booth', 'solo pod', '1 person'],
      'Meeting Pod': ['meeting pod', 'group pod', 'collaboration pod'],
    }
  },
  'Partitions & Screens': {
    keywords: ['partition', 'screen', 'panel', 'divider', 'privacy screen'],
    subCategories: {
      'Desk Screen': ['desk screen', 'desktop screen', 'desk divider'],
      'Floor Screen': ['floor screen', 'floor partition', 'room divider'],
    }
  },
};

const RANK_MAP = {
  'budgetary': 1, 'economy': 1, 'entry': 1,
  'mid': 2, 'standard': 2, 'mid-range': 2,
  'premium': 3, 'high': 3, 'high-end': 3, 'luxury': 3,
};

function normalizeProduct(product, brandTier) {
  const text = ((product.model || '') + ' ' + (product.description || '') + ' ' +
    (product.subCategory || product.mainCategory || '')).toLowerCase();

  let bestCategory = 'Furniture';
  let bestSubCategory = 'General';
  let bestScore = 0;

  for (const [category, config] of Object.entries(TAXONOMY)) {
    const catScore = config.keywords.filter(k => text.includes(k)).length;
    if (catScore > bestScore) {
      bestScore = catScore;
      bestCategory = category;

      for (const [sub, subKws] of Object.entries(config.subCategories || {})) {
        if (subKws.some(k => text.includes(k))) {
          bestSubCategory = sub;
          break;
        }
      }
    }
  }

  const tierStr = (brandTier || '').toLowerCase();
  const rank = RANK_MAP[tierStr] || 2;

  return {
    ...product,
    normalization: {
      category: bestCategory,
      subCategory: bestSubCategory,
      rank,
      tags: [],
      source: 'auto-normalized',
    }
  };
}

async function normalizeExistingBrands() {
  const files = await fs.readdir(brandsDir);
  let totalNormalized = 0;

  for (const file of files) {
    if (!file.endsWith('.json') || file.includes('test') && !file.includes('mw')) continue;
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

    // Extract tier from filename: e.g. "arper-high.json" → "high"
    const tierMatch = file.match(/-(budgetary|mid|high|premium|economy)\.json$/);
    const tier = tierMatch ? tierMatch[1] : (data.budgetTier || 'mid');

    // Only normalize products that don't already have normalization
    let normalized = 0;
    data.products = data.products.map(p => {
      if (!p.normalization || !p.normalization.category) {
        normalized++;
        return normalizeProduct(p, tier);
      }
      return p;
    });

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ ${file}: normalized ${normalized} products (tier: ${tier})`);
    totalNormalized += normalized;
  }

  console.log(`\n🎉 Done! Normalized ${totalNormalized} products across brand files.`);
}

normalizeExistingBrands().catch(console.error);
