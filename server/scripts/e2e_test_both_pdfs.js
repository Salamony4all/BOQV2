import 'dotenv/config';
import axios from 'axios';
import { brandStorage } from '../storageProvider.js';
import { veMatchAuto } from '../utils/veAutoDetectUtils.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

const DHOFAR_SAMPLE_ITEMS = [
  {
    code: 'DHOFAR-01',
    desc: 'L-SHAPE EXECUTIVE DESK WITH ATTACHED RETURN SIDE AND 3-DRAWER MOBILE PEDESTAL (2000X1800X750MM), LOCAL-UAE',
    qty: 2,
    unit: 'No.'
  },
  {
    code: 'DHOFAR-02',
    desc: 'EXECUTIVE HIGH BACK MESH CHAIR WITH ADJUSTABLE LUMBAR SUPPORT, 3D ARMRESTS, AND SYNCHRO MECHANISM (RACER), FAR EAST',
    qty: 2,
    unit: 'No.'
  },
  {
    code: 'DHOFAR-03',
    desc: 'CANTILEVER VISITOR CHAIR WITH CHROME FRAME AND BLACK FABRIC CUSHION (WIND), FAR EAST',
    qty: 6,
    unit: 'No.'
  },
  {
    code: 'DHOFAR-04',
    desc: 'HIGH STORAGE FILING CABINET (2000X900X450MM) WITH 4 ADJUSTABLE SHELVES AND LOCKABLE WOODEN DOORS, LOCAL-UAE',
    qty: 4,
    unit: 'No.'
  },
  {
    code: 'DHOFAR-05',
    desc: '2-SEATER RECEPTION WAITING SOFA WITH SOLID WOOD FRAME AND HIGH DENSITY FOAM (ROMA), FAR EAST',
    qty: 2,
    unit: 'No.'
  },
  {
    code: 'DHOFAR-06',
    desc: '3-SEATER LOUNGE SOFA UPHOLSTERED IN HEAVY DUTY COMMERCIAL FABRIC (ROMA), FAR EAST',
    qty: 1,
    unit: 'No.'
  },
  {
    code: 'DHOFAR-07',
    desc: 'MOBILE FLIP TOP FOLDING TRAINING DESK WITH LOCKABLE CASTORS (1400X600MM) (APP), LOCAL-UAE',
    qty: 12,
    unit: 'No.'
  },
  {
    code: 'DHOFAR-08',
    desc: 'RECTANGULAR CONFERENCE MEETING TABLE (3200X1200X750MM) WITH INTEGRATED WIRE MANAGEMENT BOX, LOCAL-UAE',
    qty: 1,
    unit: 'No.'
  },
  {
    code: 'DHOFAR-09',
    desc: 'MODERN CURVED RECEPTION COUNTER WITH MARBLE FINISH FRONT PANEL AND BUILT-IN WORKTOP, LOCAL-UAE',
    qty: 1,
    unit: 'No.'
  },
  {
    code: 'DHOFAR-10',
    desc: 'LOW COFFEE TABLE WITH TEMPERED GLASS TOP AND BLACK METAL LEGS (1000X600X450MM), LOCAL-UAE',
    qty: 2,
    unit: 'No.'
  }
];

const SCHEDULE_SPECIFIED_ITEMS = [
  {
    code: 'SCH-01',
    desc: 'Freifrau Stella Armchair - High quality upholstered lounge chair with wooden base, specified for executive lounge (www.freifrau.com)',
    qty: 4,
    unit: 'No.'
  },
  {
    code: 'SCH-02',
    desc: 'Figueras Scala 148 Auditorium Seating with integrated foldaway writing tablet (www.figueras.com)',
    qty: 60,
    unit: 'No.'
  },
  {
    code: 'SCH-03',
    desc: 'Dedon Satellite Outdoor Dining Table with HPL top and powder coated aluminum base (www.dedon.de)',
    qty: 6,
    unit: 'No.'
  },
  {
    code: 'SCH-04',
    desc: 'Emu Carousel Dining Armchair with rope backrest and aluminium frame (www.emu.it)',
    qty: 16,
    unit: 'No.'
  },
  {
    code: 'SCH-05',
    desc: 'Moodie / Moonako Acoustic Phone Booth Solo with integrated ventilation and power module (https://moodie.ae/phone-booths)',
    qty: 2,
    unit: 'No.'
  },
  {
    code: 'SCH-06',
    desc: 'B&T Design Lamy Lounge Chair upholstered in Gabriel fabric with swivel cross base (www.bt.design)',
    qty: 4,
    unit: 'No.'
  }
];

async function runE2ETests() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🧪 STARTING END-TO-END AUTO-MATCHING VERIFICATION TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Load all local brands
  const allBrands = await brandStorage.getAllBrands();
  console.log(`📦 Loaded ${allBrands.length} active manufacturer catalogs.`);
  console.log(`   Catalogs: ${allBrands.map(b => b.name).join(', ')}\n`);

  // PART 1: DHOFAR.PDF (Unbranded / Origin-Tagged / Model-Word BOQ)
  console.log('───────────────────────────────────────────────────────────────────────');
  console.log('📋 PART 1: DHOFAR.PDF (UNBRANDED / PREFERRED CATALOG MATCHING)');
  console.log('───────────────────────────────────────────────────────────────────────');

  let dhofarPass = 0;
  for (const item of DHOFAR_SAMPLE_ITEMS) {
    console.log(`\n🔹 Testing [${item.code}]: "${item.desc.slice(0, 75)}..."`);
    try {
      const enrichedDesc = `${item.desc} | Qty: ${item.qty}, Unit: ${item.unit}`;
      const availableBrandNames = allBrands.filter(b => b.name && !b.name.toLowerCase().includes('fitout')).map(b => b.name);
      
      const res = await axios.post(`${BASE_URL}/api/ve-match-auto`, {
        description: item.desc,
        qty: item.qty,
        unit: item.unit
      });

      if (res.data && res.data.status === 'success' && res.data.product) {
        const p = res.data.product;
        const brandLower = String(p.brand || '').toLowerCase().trim();
        const fakeBrands = ['roma', 'wind', 'app', 'racer', 'terminal', 'generic', 'unknown'];
        const isFake = fakeBrands.includes(brandLower);

        console.log(`   ✅ Matched Brand: "${p.brand}" | Model: "${p.model}"`);
        console.log(`   🏷️  Category: ${p.mainCategory} / ${p.subCategory}`);
        console.log(`   💰 Price: ${p.price} ${p.currency || 'USD'} | Source: ${res.data.source}`);
        console.log(`   🖼️  Image: ${p.imageUrl ? (p.imageUrl.slice(0, 70) + '...') : '❌ MISSING'}`);

        if (isFake) {
          console.error(`   ❌ FAILED: Returned fake brand "${p.brand}"!`);
        } else if (!p.model || p.model === 'FAILED') {
          console.error(`   ❌ FAILED: No valid model SKU returned!`);
        } else {
          dhofarPass++;
        }
      } else {
        console.error(`   ❌ NO MATCH:`, res.data);
      }
    } catch (err) {
      console.error(`   ❌ API Error:`, err.message);
    }
  }

  console.log(`\n📊 DHOFAR.PDF Results: ${dhofarPass}/${DHOFAR_SAMPLE_ITEMS.length} Passed.`);

  // PART 2: 02. SCHEDULE OF LOOSE FURNITURE.PDF (Specified / Contract Brands)
  console.log('\n───────────────────────────────────────────────────────────────────────');
  console.log('📋 PART 2: SPECIFIED SCHEDULE (CONTRACT MANUFACTURERS & WEB DISCOVERY)');
  console.log('───────────────────────────────────────────────────────────────────────');

  let schedPass = 0;
  for (const item of SCHEDULE_SPECIFIED_ITEMS) {
    console.log(`\n🔹 Testing [${item.code}]: "${item.desc.slice(0, 75)}..."`);
    try {
      const res = await axios.post(`${BASE_URL}/api/ve-match-auto`, {
        description: item.desc,
        qty: item.qty,
        unit: item.unit
      });

      if (res.data && res.data.status === 'success' && res.data.product) {
        const p = res.data.product;
        console.log(`   ✅ Matched Brand: "${p.brand}" | Model: "${p.model}"`);
        console.log(`   🏷️  Category: ${p.mainCategory} / ${p.subCategory}`);
        console.log(`   💰 Price: ${p.price} ${p.currency || 'USD'} | Source: ${res.data.source}`);
        console.log(`   🌐 URL: ${p.websiteUrl || p.productUrl || 'N/A'}`);
        console.log(`   🖼️  Image: ${p.imageUrl ? (p.imageUrl.slice(0, 70) + '...') : '❌ MISSING'}`);

        if (p.brand && p.model && p.model !== 'FAILED') {
          schedPass++;
        }
      } else {
        console.error(`   ❌ NO MATCH:`, res.data);
      }
    } catch (err) {
      console.error(`   ❌ API Error:`, err.message);
    }
  }

  console.log(`\n📊 SPECIFIED SCHEDULE Results: ${schedPass}/${SCHEDULE_SPECIFIED_ITEMS.length} Passed.`);
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(`🏁 TOTAL VERIFICATION SUMMARY: ${dhofarPass + schedPass}/${DHOFAR_SAMPLE_ITEMS.length + SCHEDULE_SPECIFIED_ITEMS.length} Passed`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');
}

runE2ETests();
