import 'dotenv/config';
import { brandStorage } from '../storageProvider.js';

async function checkBT() {
  const allBrands = await brandStorage.getAllBrands();
  const bt = allBrands.find(b => b.name.toLowerCase().includes('b&t') || b.name.toLowerCase().includes('b_t'));
  console.log('B&T Brand Name:', bt?.name, 'Total Products:', bt?.products?.length);
  const sofas = bt.products.filter(p => {
    const text = `${p.model} ${p.mainCategory} ${p.subCategory} ${p.description}`.toLowerCase();
    return text.includes('sofa') || text.includes('lounge') || text.includes('chair') || text.includes('seating');
  });
  console.log(`Found ${sofas.length} seating/sofa/lounge products in B&T Design.`);
  console.log('Sample models:', sofas.slice(0, 15).map(p => p.model));
}

checkBT();
