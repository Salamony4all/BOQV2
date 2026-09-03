import { generateCrossBrandAlternativesAsync } from '../utils/veAutoDetectUtils.js';
import { brandStorage } from '../storageProvider.js';

async function test() {
  console.log('🧪 Testing 100% Fine-Tuned Specification Alternatives...\n');
  const allBrands = await brandStorage.getAllBrands();

  const testCases = [
    {
      name: 'LF-019 (Auditorium / Theater Seats)',
      desc: 'Theater Seats Theater | No.s | THEATER SEATS | Theatre seats with tip-up set by gravity. Wooden armrests. Accessories: under-seat wooden panel - backrest wooden panel - rows and places numbering. | As per Industry Standards | All finishes & upholstery colors to approval | https://figueras.com/seating/scala-148/ or equivalent',
      cat: 'Office Seating',
      expectedArchetype: 'auditoriumAndTheater'
    },
    {
      name: 'LF-066 (Student Chair / Multi-Purpose Stackable)',
      desc: 'Student Table - 800 x 500 x 750 mm ht. CLASS ROOM-I / III /IV | No.s | STUDENT CHAIR | Multi purpose Chair. Polished Chrome Metal Frame. Polypropylene Seat and Backrest with Floor glides. Light weight and Stackable | As per Industry Standards | Pewter Seat + Backrest. All finishes to approval.',
      cat: 'Office Seating',
      expectedArchetype: 'classroomAndStackable'
    },
    {
      name: 'LF-023 (Lounge Armchair)',
      desc: 'A-23 | LF-023 | Armchair. Size: 800 x 750 x 780 mm ht. Lounge area. High density foam upholstered in contract fabric. | No.s | ARMCHAIR',
      cat: 'Office Seating',
      expectedArchetype: 'softSeating'
    },
    {
      name: 'LF-001 (Modular Bench)',
      desc: 'A-1 | LF-001 | Modular Bench (Moonako Lobby). Size: 1800 x 500 x 420 mm ht. Polyethylene Ecru. | No.s | MODULAR BENCH',
      cat: 'Office Seating',
      expectedArchetype: 'benchesAndPublicSeating'
    },
    {
      name: 'DHOFAR Item 1 (Executive Desk)',
      desc: 'Executive Desk Size: 2200 x 1000 x 750 mm with side return credenza, cable management and modesty panel in Walnut veneer',
      cat: 'Desking',
      expectedArchetype: 'desking'
    }
  ];

  for (const tc of testCases) {
    console.log(`\n======================================================`);
    console.log(`📌 Case: ${tc.name}`);
    console.log(`   Desc: ${tc.desc.slice(0, 80)}...`);

    const alts = await generateCrossBrandAlternativesAsync(null, null, tc.desc, allBrands, tc.cat, 4);
    console.log(`   Returned ${alts.length} Alternatives:`);

    alts.forEach((alt, i) => {
      console.log(`   ${i + 1}. [${alt.brand}] ${alt.model} (${alt.specificationFit || alt.confidenceScore}% Fit)`);
      console.log(`      📁 Category: ${alt.mainCategory} → ${alt.subCategory}`);
      console.log(`      🖼️ Image: ${alt.imageUrl ? alt.imageUrl.slice(0, 60) + '...' : '❌ NONE'}`);
      console.log(`      🔗 Official Link: ${alt.officialProductUrl || alt.websiteUrl || 'NONE'}`);
      console.log(`      🌐 Architonic: ${alt.architonicUrl || 'NONE'}`);
      console.log(`      💡 Reason: ${alt.veReason || alt.description}`);
    });
  }

  console.log('\n✅ All test cases executed successfully!');
}

test().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
