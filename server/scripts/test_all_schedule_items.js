import * as mupdf from 'mupdf';
import fs from 'fs';

async function testAllScheduleItems() {
    console.log('📖 Scanning 02. SCHEDULE OF LOOSE FURNITURE.pdf...');
    const doc = mupdf.Document.openDocument(fs.readFileSync('PDF/02. SCHEDULE OF LOOSE FURNITURE.pdf'), 'application/pdf');
    const totalPages = doc.countPages();
    
    // Extract items page by page
    const items = [];
    for (let p = 0; p < totalPages; p++) {
        const page = doc.loadPage(p);
        const json = JSON.parse(page.toStructuredText().asJSON());
        const blocks = json.blocks.filter(b => b.type === 'text');
        const text = blocks.map(b => b.lines.map(l => l.text).join(' ')).join('\n');
        
        // Find LF codes on this page
        const lfMatches = [...new Set(text.match(/LF-\d+/g) || [])];
        if (lfMatches.length === 0) continue;
        
        // For each LF code on this page, extract its surrounding block
        for (const code of lfMatches) {
            // Find lines related to this code
            const lines = text.split('\n');
            const relevantLines = [];
            let capturing = false;
            for (const line of lines) {
                if (line.includes(code)) {
                    capturing = true;
                } else if (capturing && /LF-\d+/.test(line)) {
                    break;
                }
                if (capturing) {
                    relevantLines.push(line);
                }
            }
            const desc = relevantLines.length > 0 ? relevantLines.join(' | ') : text;
            items.push({
                page: p + 1,
                code,
                desc: `${code} | ${desc.slice(0, 300)}`
            });
        }
    }
    
    console.log(`🔍 Found ${items.length} loose furniture specification items across ${totalPages} pages.\n`);
    console.log('Testing each against http://localhost:3001/api/ve-match-auto...\n');
    
    const report = [];
    for (const item of items) {
        try {
            const res = await fetch('http://localhost:3001/api/ve-match-auto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: item.desc })
            });
            const data = await res.json();
            const p = data.product || {};
            report.push({
                page: item.page,
                code: item.code,
                status: data.status,
                brand: p.brand || 'NONE',
                model: p.model || 'NONE',
                category: `${p.mainCategory || ''} > ${p.subCategory || ''}`,
                hasImage: !!p.imageUrl,
                url: p.websiteUrl || 'NONE'
            });
        } catch (e) {
            report.push({
                page: item.page,
                code: item.code,
                status: 'ERROR: ' + e.message,
                brand: 'ERROR',
                model: 'ERROR'
            });
        }
    }
    
    console.table(report);
    
    const unbranded = report.filter(r => r.brand === 'NONE' || r.brand === 'ERROR' || r.brand.toLowerCase().includes('generic'));
    console.log(`\n📊 Summary: ${report.length - unbranded.length}/${report.length} items matched.`);
    if (unbranded.length > 0) {
        console.log('⚠️ Items that need attention:');
        console.log(unbranded);
    }
}

testAllScheduleItems().catch(console.error);
