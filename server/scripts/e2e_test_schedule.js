import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as mupdf from 'mupdf';

const BASE_URL = 'http://localhost:3001';

async function extractItemsFromSchedulePdf(filePath, maxPages = 15) {
    console.log(`\n📄 FAST EXTRACTING: ${path.basename(filePath)} (Scanning first ${maxPages} pages)...`);
    const data = fs.readFileSync(filePath);
    const doc = mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf');
    const pageCount = Math.min(doc.countPages(), maxPages);
    
    const items = [];

    for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i);
        const text = page.toStructuredText().asText();
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

        for (const line of lines) {
            // Check if line looks like a furniture spec with brands or models
            if (line.length > 15 && !/^(page|project|drawing|client|schedule|specifications|date|revision|issue)/i.test(line)) {
                if (/chair|table|desk|sofa|stool|credenza|storage|armchair|cabinet|booth|acoustic|workstation|herman|vitra|haworth|arper|andreu|sedus|pedrali|narbutas|nurus|las|ofifran/i.test(line)) {
                    items.push({
                        sn: items.length + 1,
                        page: i + 1,
                        description: line
                    });
                }
            }
        }
    }

    console.log(`✅ Extracted ${items.length} relevant furniture line items from ${pageCount} pages of SCHEDULE PDF.`);
    return items;
}

async function testAutoMatch(items, count = 8) {
    console.log(`\n🔍 TESTING AUTO-MATCH ON ${Math.min(items.length, count)} EXTRACTED ITEMS (Known Brands & New Brands)...`);
    const results = [];

    for (let i = 0; i < Math.min(items.length, count); i++) {
        const item = items[i];
        console.log(`\n--- [Item ${item.sn} (P.${item.page})] "${item.description.substring(0, 70)}..." ---`);

        try {
            const start = Date.now();
            const res = await axios.post(`${BASE_URL}/api/ve-match-auto`, {
                description: item.description,
                rowId: item.sn
            }, { timeout: 35000 });

            const duration = ((Date.now() - start) / 1000).toFixed(1);
            const p = res.data?.product;

            if (p) {
                const proxyBase = 'http://localhost:3001/api/image-proxy?url=';
                const hasImg = !!p.imageUrl;
                console.log(`  ⏱️  Time: ${duration}s | Status: ${res.data.status} | Source: ${res.data.source || 'auto'}`);
                console.log(`  🏢 BRAND: "${p.brand}"`);
                console.log(`  🗂️  MAIN CAT: "${p.mainCategory || 'N/A'}" | SUB CAT: "${p.subCategory || 'N/A'}"`);
                console.log(`  🏷️  MODEL: "${p.model}"`);
                console.log(`  💰 PRICE: ${p.price} ${p.currency || 'USD'}`);
                console.log(`  🖼️  IMAGE: ${p.imageUrl ? p.imageUrl.substring(0, 80) + '...' : 'NONE'}`);

                results.push({
                    sn: item.sn,
                    page: item.page,
                    spec: item.description.substring(0, 45),
                    brand: p.brand,
                    mainCat: p.mainCategory || 'N/A',
                    subCat: p.subCategory || 'N/A',
                    model: p.model,
                    hasImage: hasImg ? '✅' : '❌'
                });
            } else {
                console.log(`  ⚠️ No match returned:`, res.data);
            }
        } catch (err) {
            console.error(`  ❌ Error matching item ${item.sn}:`, err.response?.data || err.message);
        }
    }

    return results;
}

async function run() {
    const schedulePath = path.resolve('PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf');
    const items = await extractItemsFromSchedulePdf(schedulePath, 20);
    const results = await testAutoMatch(items, 8);

    console.log(`\n📊 E2E SUMMARY FOR 02. SCHEDULE OF LOOSE FURNITURE.pdf:`);
    console.table(results.map(r => ({
        SN: r.sn,
        PAGE: r.page,
        SPEC: r.spec,
        BRAND: r.brand,
        CATEGORY: `${r.mainCat} > ${r.subCat}`,
        MODEL: r.model?.substring(0, 30),
        IMG: r.hasImage
    })));
}

run().catch(console.error);
