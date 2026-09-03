async function testApi() {
    console.log('Testing /api/ve-match-auto endpoint for LF-008...\n');

    const desc = 'A-8 | LF-008 | Round Chair ( Foldable) Creative Market | No.s | ROUND FOLDABLE CHAIR | Round Foldable Chair with X-shape Legs and Handle to carry. | Dia – 300 x 450 mm ht. | Black Metal & Plastic. All finishes to approval. | Fahmy Furniture / KR Furniture / Al Jassar or similar | 13';

    const res = await fetch('http://localhost:3001/api/ve-match-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            description: desc,
            tier: 'mid'
        })
    });

    const data = await res.json();
    console.log('API Status:', data.status);
    console.log('Source:', data.source);
    console.log('Identified Model:', data.identifiedModel);
    console.log('Product:', data.product?.brand, '-', data.product?.model);
    console.log('Product Category:', data.product?.mainCategory, '->', data.product?.subCategory);
    console.log('Product Image:', data.product?.imageUrl);
    console.log('Alternatives Count:', (data.alternatives || []).length);
    (data.alternatives || []).forEach((a, i) => {
        console.log(`  [${i + 1}] ${a.brand} - ${a.model} (${a.confidenceScore || a.specificationFit}% Fit, USD ${a.price})`);
        console.log(`      Image: ${a.imageUrl}`);
    });
}

testApi().catch(console.error);
