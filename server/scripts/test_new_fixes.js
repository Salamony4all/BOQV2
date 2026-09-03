import fetch from 'node-fetch';

async function testFixes() {
    console.log('🧪 Testing LF-008 and LF-014 matching and links...\n');

    // 1. Test LF-008
    const lf008Desc = "A-8 | LF-008 | Round Chair ( Foldable) Creative Market | No.s | ROUND FOLDABLE CHAIR | Round Foldable Chair with X-shape Legs and Handle to carry. | Dia – 300 x 450 mm ht. | Black Metal & Plastic. All finishes to approval. | Fahmy Furniture / KR Furniture / Al Jassar or similar | 13";
    const res008 = await fetch('http://localhost:3001/api/ve-match-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: lf008Desc })
    });
    const data008 = await res008.json();
    console.log('=== LF-008 Result ===');
    console.log('Matched Brand:', data008.matchedProduct?.brand, 'Model:', data008.matchedProduct?.model);
    console.log('Matched Image:', data008.matchedProduct?.imageUrl);
    console.log('Matched Link:', data008.matchedProduct?.websiteUrl || data008.matchedProduct?.productUrl);
    console.log('Alternatives Count:', data008.alternatives?.length);
    (data008.alternatives || []).forEach((alt, idx) => {
        console.log(`  Alt #${idx + 1}: ${alt.brand} - ${alt.model}`);
        console.log(`    Image: ${alt.imageUrl}`);
        console.log(`    Official Link: ${alt.officialProductUrl || alt.websiteUrl}`);
    });

    // 2. Test LF-014 (Custom Terrazzo Concrete 5000mm Outdoor Bench)
    const lf014Desc = "A-14 | LF-014 | Capsule shapes seating outside. Size: 5000 x 800 x 450 mm ht. Arcade | S.No: A-14 | Product Code: LF-014 | Terrazzo Concrete Outdoor Bench | 5000 x 800 x 450 mm ht. | Terrazzo Concrete Frame & Legs WHITE | Automatic Terrazzo Tiles Factory (ATTF) / Assarain or similar | 1";
    const res014 = await fetch('http://localhost:3001/api/ve-match-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: lf014Desc })
    });
    const data014 = await res014.json();
    console.log('\n=== LF-014 Result ===');
    console.log('Category:', data014.category);
    console.log('Matched Brand:', data014.matchedProduct?.brand, 'Model:', data014.matchedProduct?.model);
    console.log('Matched Source:', data014.matchedProduct?.source || data014.matchType);
}

testFixes();
