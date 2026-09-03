import 'dotenv/config';
import { brandStorage } from '../storageProvider.js';
import { veMatchSimple } from '../utils/veMatchUtils.js';
import { findSemanticMatches } from '../embeddingService.js';

async function testUnifiedBT() {
  const allBrands = await brandStorage.getAllBrands();
  const bt = allBrands.find(b => b.name === 'B&T Design');
  console.log('Testing B&T Design catalog matching...');

  const desc2Seater = '2-SEATER RECEPTION WAITING SOFA WITH SOLID WOOD FRAME AND HIGH DENSITY FOAM (ROMA), FAR EAST | Qty: 2, Unit: No.';
  const desc3Seater = '3-SEATER LOUNGE SOFA UPHOLSTERED IN HEAVY DUTY COMMERCIAL FABRIC (ROMA), FAR EAST | Qty: 1, Unit: No.';

  const modelList = bt.products.map(p => p.model).filter(Boolean);

  const match2 = await veMatchSimple(desc2Seater, bt.name, modelList);
  console.log('2-Seater Match in B&T:', match2);

  const match3 = await veMatchSimple(desc3Seater, bt.name, modelList);
  console.log('3-Seater Match in B&T:', match3);
}

testUnifiedBT();
