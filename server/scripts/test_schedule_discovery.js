import axios from 'axios';

const testItems = [
  {
    name: 'LF-001 Modular Bench',
    desc: 'LF-001 – MODULAR BENCH. TYPE: Break out Area MODULAR BENCH with MATT METAL LEGS. SIZE: 1800 x 500 x 420 mm ht. FINISH: ASPECT CAMIRA - YOSEMITE Fabric upholstery with Matt METAL LEGS in ANTHRACITE RAL 7016. SUPPLIER: https://www.moodie.com.au/?product=06-moonako-Lobby or equivalent'
  },
  {
    name: 'LF-002 Modular Planter Limone',
    desc: 'LF-002 – MODULAR PLANTER. TYPE: Modular Planter in Fiber Concrete Composite (Limone - Moonako Arabesque Collection). SIZE: 1440 x 1000 x 470 mm ht. SUPPLIER: https://www.moodie.com.au/?product=06-moonako-Lobby or https://www.moonako.fr/en/'
  },
  {
    name: 'LF-018 Foldable Chair Piper',
    desc: 'LF-018 – FOLDABLE CHAIR. TYPE: Foldable lightweight stacking chair with painted steel frame and polypropylene seat and backrest. Creative Market. SUPPLIER: https://www.infabbrica.com/en/foldable-chair-piper.htm'
  },
  {
    name: 'LF-009 Mobile Vendor Cart',
    desc: 'LF-009 – MOBILE VENDOR CART WITH AWNING. TYPE: Mobile food / retail cart with fabric shade canopy, wheels and storage shelves. SIZE: 1600 x 1700 x 2100 mm ht. Creative Market Spill Out. SUPPLIER: https://www.amazon.com/Minglez-Foldable-Business-Lightweight-Cart'
  },
  {
    name: 'LF-012 Capsule Shapes Outdoor Seating',
    desc: 'LF-012 – CAPSULE SHAPE SEAT – OUTDOOR SEATING. TYPE: Capsule shaped modular outdoor bench in molded concrete / composite with smooth terrazzo finish. SIZE: 5000 x 800 x 450 mm ht. Arcade Outdoor. SUPPLIER: https://www.suigeneris.co.uk/modular-seating-tables/halo-modern- or https://www.attfoman.com'
  },
  {
    name: 'LF-034 Curve 3 Seater Sofa',
    desc: 'LF-034 – CURVE 3 SEATER SOFA. TYPE: Break out Area CURVED 3 SEATER SOFA with MATT METAL LEGS. FINISH: ASPECT CAMIRA - YOSEMITE Fabric upholstery with Matt METAL LEGS in ANTHRACITE RAL 7016. SUPPLIER: https://bt.design/zen-sofas.html or equivalent'
  },
  {
    name: 'LF-036 TON Stool',
    desc: 'LF-036 – STOOL. TYPE: Rounded triangular shape, light weight, stackable Stool. STAINED OAK, OILED surface finish. SUPPLIER: https://www.timeoutspace.com/products/ton-p-o-v-stool-set-of-2 TON P.O.V. Stool or equivalent'
  },
  {
    name: 'LF-037 Foldable Chair Magis Pila',
    desc: 'LF-037 – FOLDABLE CHAIR (NO ARMREST). TYPE: Foldable, Stacking Chair. Seat, backrest & legs in ASH BROWN PLYWOOD. SUPPLIER: https://www.magisdesign.com/product/pila/ Pila – Magis SPA - Ronan & Erwan Bouroullec or equivalent'
  },
  {
    name: 'Theater Seats',
    desc: 'Theater Seats Theater: Auditorium tip-up seats with upholstered back and seat, wooden armrest with writing tablet, fixed pedestal mount, acoustic sound dampening. Qty: 168'
  },
  {
    name: 'LF-067 Round Rattan Table Dedon',
    desc: 'LF-067 – ROUND RATTAN TABLE. TYPE: Outdoor DINING TABLE with tabletop of scratch-resistant HPL and base made from frost-proof ceramic. SIZE: Dia 1150 x 730 mm ht. FINISH: Solid Lipari. SUPPLIER: https://www.dedon.de/en-US/Product-Finder/furniture/satellite/dining-table-115 SATELLITE Dining table or equivalent'
  }
];

async function runTest() {
  console.log('Testing 10 complex schedule items with ve-match-auto:\n');
  for (const item of testItems) {
    try {
      const res = await axios.post('http://localhost:3001/api/ve-match-auto', { description: item.desc });
      const p = res.data.product;
      console.log('================================================================');
      console.log('ITEM      :', item.name);
      console.log('SOURCE    :', res.data.source);
      console.log('BRAND     :', p?.brand);
      console.log('MODEL     :', p?.model);
      console.log('CATEGORY  :', p?.mainCategory, '➔', p?.subCategory);
      console.log('IMAGE     :', p?.imageUrl ? p.imageUrl.substring(0, 60) + '...' : '❌ NONE');
    } catch(err) {
      console.error('Error testing:', item.name, err.message);
    }
  }
}

runTest();
