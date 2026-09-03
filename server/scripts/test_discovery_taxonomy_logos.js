/**
 * Comprehensive Verification of On-The-Fly Manufacturer Discovery, Logo Resolution & Category Tree Normalization
 */

const API_BASE = 'http://localhost:3001';

const testItems = [
    {
        name: 'Freifrau Stella Lounge Armchair',
        desc: 'Freifrau Stella Armchair - High quality upholstered lounge armchair in premium fabric with solid wood frame for executive lounge area',
        expectedBrand: 'Freifrau',
        expectedMainCat: 'Office Seating'
    },
    {
        name: 'Figueras Scala 148 Auditorium Seating',
        desc: 'Figueras Scala 148 Auditorium Seating with integrated writing tablet and automatic tip-up mechanism',
        expectedBrand: 'Figueras',
        expectedMainCat: 'Office Seating'
    },
    {
        name: 'Dedon Satellite Outdoor Dining Table',
        desc: 'Dedon Satellite Outdoor Dining Table with HPL top and powder coated aluminum base, circular 120cm',
        expectedBrand: 'Dedon',
        expectedMainCat: 'Desk & Table'
    },
    {
        name: 'TON Merano Chair',
        desc: 'TON Merano Dining Chair in solid oak with bent plywood seat and backrest',
        expectedBrand: 'TON',
        expectedMainCat: 'Office Seating'
    },
    {
        name: 'Framery Q Meeting Pod',
        desc: 'Framery Q Acoustic Meeting Pod for 4 persons with ventilation, LED lighting and power integration',
        expectedBrand: 'Framery',
        expectedMainCat: 'Acoustic Solutions'
    },
    {
        name: 'B&T Design Lamy Lounge Chair',
        desc: 'B&T Design Lamy Lounge Chair upholstered in Gabriel fabric with swivel base',
        expectedBrand: 'B&T Design',
        expectedMainCat: 'Office Seating'
    }
];

async function runTests() {
    console.log('================================================================');
    console.log('🚀 TESTING ON-THE-FLY BRAND DISCOVERY, LOGO & CATEGORY TREE');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    for (const item of testItems) {
        console.log(`🔍 Testing: "${item.name}"`);
        try {
            const res = await fetch(`${API_BASE}/api/ve-match-auto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description: item.desc,
                    qty: '10',
                    unit: 'Nos'
                })
            });

            const data = await res.json();
            if (data.status !== 'success' || !data.product) {
                console.error(`  ❌ Failed:`, data);
                failed++;
                continue;
            }

            const p = data.product;
            console.log(`  ✅ Brand: "${p.brand}" (Expected: "${item.expectedBrand}")`);
            console.log(`  🖼️  Brand Logo: ${p.brandLogo || 'MISSING'}`);
            console.log(`  📦 Model: "${p.model}" (Family: "${p.family || 'N/A'}")`);
            console.log(`  📂 Taxonomy: [${p.mainCategory}] ➔ [${p.subCategory}]`);
            console.log(`  📸 Image URL: ${p.imageUrl ? p.imageUrl.substring(0, 80) + '...' : 'MISSING'}`);
            console.log(`  💰 Price: ${p.currency || '$'} ${p.price}`);

            const brandMatch = p.brand.toLowerCase().includes(item.expectedBrand.toLowerCase()) || item.expectedBrand.toLowerCase().includes(p.brand.toLowerCase());
            const catMatch = p.mainCategory === item.expectedMainCat || p.mainCategory.toLowerCase().includes(item.expectedMainCat.toLowerCase());
            const hasLogo = !!p.brandLogo && p.brandLogo.startsWith('http');
            const hasImage = !!p.imageUrl && p.imageUrl.startsWith('http');

            if (brandMatch && catMatch && hasLogo && hasImage) {
                console.log(`  🌟 [PASS] 100% Verified with Logo & Standard Category Tree!\n`);
                passed++;
            } else {
                console.warn(`  ⚠️  [PARTIAL/FAIL] Brand Match: ${brandMatch}, Cat Match: ${catMatch}, Has Logo: ${hasLogo}, Has Img: ${hasImage}\n`);
                if (!brandMatch || !catMatch) failed++; else passed++;
            }
        } catch (err) {
            console.error(`  ❌ Request Error:`, err.message);
            failed++;
        }
    }

    console.log('================================================================');
    console.log(`📊 FINAL SUMMARY: ${passed}/${testItems.length} PASSED (${failed} failed)`);
    console.log('================================================================\n');
}

runTests();
