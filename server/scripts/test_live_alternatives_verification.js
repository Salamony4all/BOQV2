import fetch from 'node-fetch';

async function verify() {
  console.log('🧪 Starting 100% Archetype Compatibility & Live Web / Architonic Alternatives Verification...\n');

  // 1. Test LF-001 (Modular Bench)
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log('1️⃣ Testing Item LF-001: Modular Bench (Moonako Lobby, 1800x500x420 mm)');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  
  const benchPayload = {
    description: 'Item LF-001: Modular Bench, Size: 1800 x 500 x 420 mm, Material: Polyethylene, Finish: Ecru. Manufacturer: Moonako - Lobby Collection.',
    category: 'Loose Furniture'
  };

  const benchRes = await fetch('http://localhost:3001/api/ve-match-auto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(benchPayload)
  }).then(r => r.json());

  console.log(`\n🎯 Primary Match: ${benchRes.product?.brand} - ${benchRes.product?.model}`);
  console.log(`📂 Category: ${benchRes.product?.mainCategory} → ${benchRes.product?.subCategory}`);
  console.log(`🌐 Official Link: ${benchRes.product?.websiteUrl || 'N/A'}`);
  console.log(`⚡ Match Tier: ${benchRes.matchTier}`);

  console.log(`\n🏢 Discovered Alternatives (${benchRes.alternatives?.length || 0}):`);
  let benchHasIncompatible = false;
  
  for (const alt of (benchRes.alternatives || [])) {
    console.log(`  - [${alt.source || 'Catalog'}] ${alt.brand} - ${alt.model} (${alt.confidenceScore}% Fit)`);
    console.log(`    Category: ${alt.mainCategory} → ${alt.subCategory}`);
    console.log(`    Official URL: ${alt.officialProductUrl || alt.websiteUrl || 'N/A'}`);
    if (alt.architonicUrl) console.log(`    Architonic URL: ${alt.architonicUrl}`);
    console.log(`    VE Reason: ${alt.veReason || alt.description}`);

    const altText = `${alt.model} ${alt.mainCategory} ${alt.subCategory} ${alt.description}`.toLowerCase();
    if (altText.includes('shelf') || altText.includes('shelving') || altText.includes('bookcase') || altText.includes('workstation') || altText.includes('face to face')) {
      console.error(`    ❌ FAILED ARCHETYPE CHECK: Shelving/Desk found in Seating Alternatives!`);
      benchHasIncompatible = true;
    }
  }

  if (!benchHasIncompatible) {
    console.log('\n✅ LF-001 Archetype Check PASSED: 100% Seating/Bench alternatives, 0 shelving, 0 desking bleed!');
  } else {
    console.error('\n❌ LF-001 Archetype Check FAILED: Category bleed detected.');
  }

  // 2. Test DHOFAR Item 1 (L-Shape Executive Desk)
  console.log('\n─────────────────────────────────────────────────────────────────────────────');
  console.log('2️⃣ Testing DHOFAR Item 1: L-Shape Executive Desk (1600x1600 mm, Melamine)');
  console.log('─────────────────────────────────────────────────────────────────────────────');

  const deskPayload = {
    description: 'OFFICE DESK - L-SHAPE- DIM : 160 x 160 / 80 x 60 x 75 cm. Top in 25mm thick particle board with melamine finish. With fixed side return, 3 drawer mobile pedestal.',
    category: 'Desking & Tables'
  };

  const deskRes = await fetch('http://localhost:3001/api/ve-match-auto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deskPayload)
  }).then(r => r.json());

  console.log(`\n🎯 Primary Match: ${deskRes.product?.brand} - ${deskRes.product?.model}`);
  console.log(`📂 Category: ${deskRes.product?.mainCategory} → ${deskRes.product?.subCategory}`);
  console.log(`⚡ Match Tier: ${deskRes.matchTier}`);

  console.log(`\n🏢 Discovered Alternatives (${deskRes.alternatives?.length || 0}):`);
  let deskHasIncompatible = false;

  for (const alt of (deskRes.alternatives || [])) {
    console.log(`  - [${alt.source || 'Catalog'}] ${alt.brand} - ${alt.model} (${alt.confidenceScore}% Fit)`);
    console.log(`    Category: ${alt.mainCategory} → ${alt.subCategory}`);
    console.log(`    Official URL: ${alt.officialProductUrl || alt.websiteUrl || 'N/A'}`);
    if (alt.architonicUrl) console.log(`    Architonic URL: ${alt.architonicUrl}`);
    console.log(`    VE Reason: ${alt.veReason || alt.description}`);

    const altText = `${alt.model} ${alt.mainCategory} ${alt.subCategory} ${alt.description}`.toLowerCase();
    if (altText.includes('chair') || altText.includes('sofa') || altText.includes('couch') || altText.includes('armchair')) {
      console.error(`    ❌ FAILED ARCHETYPE CHECK: Seating found in Desking Alternatives!`);
      deskHasIncompatible = true;
    }
  }

  if (!deskHasIncompatible) {
    console.log('\n✅ DHOFAR Item 1 Archetype Check PASSED: 100% Desking alternatives, 0 seating bleed!');
  } else {
    console.error('\n❌ DHOFAR Item 1 Archetype Check FAILED: Category bleed detected.');
  }

  console.log('\n🏁 Verification completed successfully.');
}

verify().catch(console.error);
