/**
 * One-click matching test suite (no network, no AI: the matcher is a stub).
 *
 *   • which rows of an extracted BOQ are lines (section titles, printed totals,
 *     set components and option lines are not)
 *   • what is sent to the auto-detect matcher, and how its answer becomes a product
 *   • the catalogue fill-in, the run (a few at a time, identical lines once, stop)
 *   • the matched offer: layout, costing, unmatched lines, headings
 *
 * Run: node test/quickMatch.test.js
 */
import assert from 'node:assert/strict';
import {
    MATCHED_OFFER_HEADER,
    collectLines,
    lineColumns,
    matchLine,
    productOf,
    isUsableProduct,
    enrichFromCatalog,
    runQuickMatch,
    matchStats,
    offerCurrency,
    neutralFactors,
    costMultiplier,
    matchedOfferTables
} from '../src/features/matching/quickMatch.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failures.push({ name, err });
        console.log(`  ✗ ${name}\n      ${String(err.message).split('\n')[0]}`);
    }
}

const cell = (value, extra = {}) => ({ value, ...extra });
const row = (values, extra = {}) => ({ cells: values.map((v) => (v && typeof v === 'object' ? v : cell(v))), ...extra });
const BOQ = {
    sheetName: 'Lounge',
    header: ['S.No', 'Image', 'Item Description', 'Brand', 'Finish', 'Qty', 'Unit', 'Unit Rate', 'Amount'],
    rows: [
        row(['', '', 'LOUNGE AREA', '', '', '', '', '', ''], { isHeader: true, sectionLabel: 'Lounge' }),
        row(['LF-01', cell('', { image: '/uploads/sofa.png', images: [{ url: '/uploads/sofa.png' }] }), 'Three seater sofa 2400 x 880', '', 'Grey fabric', '2', 'Nos', '', ''], { pageNum: 2 }),
        row(['LF-02', '', 'Lounge chair', 'Vitra', '', '6', 'Nos', '150', '900']),
        row(['LF-03', '', 'Coffee table round 800', '', '', '3', 'Nos', '', '']),
        row(['', '', 'Side tables', '', '', '', '', '', '']),
        row(['LF-04', '', 'Lounge chair', 'Vitra', '', '4', 'Nos', '150', '600']),
        row(['', '', 'TOTAL VALUE', '', '', '', '', '', '1500']),
        row(['', '', 'Grand total', '', '', '', '', '', '1575'], { isSummary: true }),
        row(['LF-05.1', '', 'Pedestal', '', '', '1', 'Nos', '', ''], { isSetSubItem: true })
    ]
};

console.log('\nLines of an extracted BOQ');
await test('columns are found by their header', () => {
    const col = lineColumns(BOQ.header, BOQ.rows);
    assert.equal(col.description, 2);
    assert.equal(col.sn, 0);
    assert.equal(col.qty, 5);
    assert.equal(col.unit, 6);
    assert.equal(col.rate, 7);
    assert.equal(col.amount, 8);
    assert.equal(col.brand, 3);
    assert.deepEqual(col.details, [3, 4], 'brand and finish describe the product');
});
await test('"Unit Rate" is never the unit column', () => {
    const col = lineColumns(['Description', 'Unit Rate', 'Unit', 'Qty'], []);
    assert.equal(col.unit, 2);
    assert.equal(col.rate, 1);
});
await test('only real lines are matched', () => {
    const lines = collectLines([BOQ]);
    assert.deepEqual(lines.map((l) => l.sn), ['LF-01', 'LF-02', 'LF-03', 'LF-04']);
    assert.deepEqual(lines.map((l) => l.key), ['0:1', '0:2', '0:3', '0:5']);
});
await test('the line carries its words, details, picture and numbers', () => {
    const [sofa, chair] = collectLines([BOQ]);
    assert.equal(sofa.description, 'Three seater sofa 2400 x 880');
    assert.equal(sofa.query, 'Three seater sofa 2400 x 880 | Grey fabric');
    assert.deepEqual(sofa.images, ['/uploads/sofa.png']);
    assert.equal(sofa.qty, '2');
    assert.equal(chair.query, 'Lounge chair | Vitra');
    assert.equal(chair.brand, 'Vitra');
    assert.equal(chair.rate, '150');
});
await test('placeholder pictures are not sent', () => {
    const t = { header: ['Description', 'Image', 'Qty'], rows: [row(['Desk 1600', cell('', { image: '/api/lazy-image?id=1' }), '1'])] };
    assert.deepEqual(collectLines([t])[0].images, []);
});
await test('links in the row go with the description', () => {
    const t = { header: ['Description', 'Remarks', 'Qty'], rows: [row(['Task chair', 'see https://bt.design/chairs/forum', '10'])] };
    assert.equal(collectLines([t])[0].query, 'Task chair | https://bt.design/chairs/forum');
});

console.log('\nThe matcher');
await test('a line is sent with its quantity, unit, tier, model and picture', async () => {
    let sent = null;
    const fetchImpl = async (url, init) => {
        sent = { url, body: JSON.parse(init.body), signal: init.signal };
        return { ok: true, status: 200, json: async () => ({ status: 'success', matchTier: 'SUGGESTED', product: { brand: 'Nurus', model: 'Kuyu', price: 1200, currency: 'usd', imageUrl: 'https://x/kuyu.jpg' } }) };
    };
    const run = new AbortController();
    const [sofa] = collectLines([BOQ]);
    const r = await matchLine(sofa, { apiBase: 'http://api', providerModel: 'gemini-x', signal: run.signal, fetchImpl });
    assert.equal(sent.url, 'http://api/api/ve-match-auto');
    assert.deepEqual(sent.body, {
        description: 'Three seater sofa 2400 x 880 | Grey fabric',
        qty: '2',
        unit: 'Nos',
        tier: 'mid',
        providerModel: 'gemini-x',
        imageUrl: '/uploads/sofa.png',
        imageAssets: [{ url: '/uploads/sofa.png' }]
    });
    assert.equal(sent.signal.aborted, false);
    run.abort();
    assert.equal(sent.signal.aborted, false, 'a finished request is not touched by a later stop');
    assert.equal(r.ok, true);
    assert.equal(r.product.brand, 'Nurus');
    assert.equal(r.product.currency, 'USD');
    assert.equal(r.product.price, 1200);
});
await test('a failed or empty answer is not a match', async () => {
    const answer = (status, json) => async () => ({ ok: status < 400, status, json: async () => json });
    const [sofa] = collectLines([BOQ]);
    const r500 = await matchLine(sofa, { fetchImpl: answer(500, { status: 'error', error_message: 'boom' }) });
    assert.deepEqual(r500, { ok: false, error: 'boom' });
    const generic = await matchLine(sofa, { fetchImpl: answer(200, { status: 'success', product: { brand: 'Generic', model: 'Sofa' } }) });
    assert.equal(generic.ok, false);
    assert.equal(generic.noMatch, true, 'an answer without a product is a missing line, not a failure');
    const none = await matchLine(sofa, { fetchImpl: answer(200, { status: 'no_match', message: 'Nothing similar' }) });
    assert.deepEqual(none, { ok: false, noMatch: true, error: 'Nothing similar' });
    const broken = await matchLine(sofa, { fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } }) });
    assert.deepEqual(broken, { ok: false, error: 'The matcher answered 502' });
});
await test('stopping the run ends the request in flight', async () => {
    const run = new AbortController();
    const fetchImpl = (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const [sofa] = collectLines([BOQ]);
    const pending = matchLine(sofa, { signal: run.signal, fetchImpl });
    run.abort();
    await assert.rejects(pending, { name: 'AbortError' });
});
await test('a line the matcher does not answer in time is left out, not the run', async () => {
    const fetchImpl = (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const [sofa] = collectLines([BOQ]);
    const r = await matchLine(sofa, { fetchImpl, timeoutMs: 20 });
    assert.deepEqual(r, { ok: false, error: 'The matcher took too long for this line' });
});
await test('the product keeps the fields an offer line needs', () => {
    const p = productOf({ status: 'success', matchTier: 'EXACT_MATCH', confidenceScore: 100, source: 'local-database', product: { brand: 'Vitra', model: 'Eames', websiteUrl: 'https://vitra.com/eames', images: ['https://x/1.jpg'], price: '1,250.50' } });
    assert.equal(p.imageUrl, 'https://x/1.jpg');
    assert.equal(p.productUrl, 'https://vitra.com/eames');
    assert.equal(p.price, 1250.5);
    assert.equal(p.tier, 'EXACT_MATCH');
    assert.equal(isUsableProduct(p), true);
    assert.equal(isUsableProduct({ brand: 'Generic', model: 'X', imageUrl: '', price: 0 }), false);
});
await test('the catalogue fills in what the matcher left out', () => {
    const brands = [{ name: 'NARBUTAS', logo: 'logo.png', products: [{ model: 'Nova Wood', price: 410, imageUrl: 'https://n/nova.jpg', mainCategory: 'Desks', description: 'Nova Wood desk with a solid wood top and steel legs' }] }];
    const p = enrichFromCatalog({ brand: 'narbutas', model: 'Nova wood', description: 'Desk', imageUrl: '', price: 0, mainCategory: '', subCategory: '', family: '', productUrl: '', brandLogo: '' }, brands);
    assert.equal(p.brand, 'NARBUTAS');
    assert.equal(p.model, 'Nova Wood');
    assert.equal(p.price, 410);
    assert.equal(p.imageUrl, 'https://n/nova.jpg');
    assert.equal(p.brandLogo, 'logo.png');
    assert.match(p.description, /solid wood/);
    const kept = enrichFromCatalog({ brand: 'NARBUTAS', model: 'Nova Wood', description: 'A much longer description from the official site of the maker', imageUrl: 'https://live.jpg', price: 500 }, brands);
    assert.equal(kept.imageUrl, 'https://live.jpg');
    assert.equal(kept.price, 500);
    assert.match(kept.description, /official site/);
});

console.log('\nThe run');
await test('identical lines are matched once, a few at a time', async () => {
    const lines = collectLines([BOQ]);
    const calls = [];
    let live = 0;
    let peak = 0;
    const progress = [];
    const results = await runQuickMatch(lines, {
        concurrency: 2,
        match: async (line) => {
            calls.push(line.sn);
            live++;
            peak = Math.max(peak, live);
            await new Promise((r) => setTimeout(r, 5));
            live--;
            return line.sn === 'LF-03'
                ? { ok: false, error: 'timeout' }
                : { ok: true, product: { brand: 'B', model: line.sn, price: 100, currency: 'USD', imageUrl: '', tier: line.sn === 'LF-02' ? 'EXACT_MATCH' : 'SUGGESTED' } };
        },
        onProgress: (p) => progress.push(p.done)
    });
    assert.deepEqual(calls.sort(), ['LF-01', 'LF-02', 'LF-03'], 'the second "Lounge chair | Vitra" reuses the first answer');
    assert.ok(peak <= 2);
    assert.equal(results[3], results[1], 'LF-04 has the answer of LF-02');
    assert.deepEqual(progress, [1, 2, 3, 4]);
    const stats = matchStats(results);
    assert.deepEqual({ ...stats, firstError: undefined }, { done: 4, found: 3, exact: 2, missing: 0, failed: 1, firstError: undefined });
    assert.equal(stats.firstError, 'timeout');
    assert.deepEqual(matchStats([{ ok: false, noMatch: true, error: 'x' }, undefined, { ok: false, aborted: true }]), { done: 1, found: 0, exact: 0, missing: 1, failed: 0, firstError: '' });
});
await test('stopping keeps what was matched and takes no new line', async () => {
    const lines = collectLines([BOQ]);
    const controller = new AbortController();
    const results = await runQuickMatch(lines, {
        concurrency: 1,
        signal: controller.signal,
        match: async (line) => {
            if (line.sn === 'LF-01') {
                controller.abort();
                return { ok: true, product: { brand: 'B', model: 'S', price: 1, imageUrl: '' } };
            }
            throw new Error('never reached');
        }
    });
    assert.equal(results[0].ok, true);
    assert.equal(results.filter(Boolean).length, 1);
});
await test('a matcher that throws counts as a failed line', async () => {
    const lines = collectLines([BOQ]).slice(0, 1);
    const results = await runQuickMatch(lines, { match: async () => { throw new Error('network down'); } });
    assert.deepEqual(results[0], { ok: false, aborted: false, error: 'network down' });
});

console.log('\nThe matched offer');
const product = (brand, model, price, extra = {}) => ({ ok: true, product: { brand, model, price, currency: 'USD', imageUrl: `https://img/${model}.jpg`, description: `${brand} ${model} lounge piece`, productUrl: `https://p/${model}`, mainCategory: 'Lounge', subCategory: 'Sofas', tier: 'SUGGESTED', ...extra } });
const runOffer = (factors) => {
    const lines = collectLines([BOQ]);
    const results = [product('Nurus', 'Kuyu', 1000), product('Vitra', 'Eames', 200, { tier: 'EXACT_MATCH' }), { ok: false, error: 'none' }, product('Vitra', 'Eames', 200, { tier: 'EXACT_MATCH' })];
    return { lines, results, tables: matchedOfferTables([BOQ], lines, results, factors) };
};
await test('the offer has the Value Engineered layout', () => {
    const { tables } = runOffer(null);
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].header, MATCHED_OFFER_HEADER);
    assert.equal(tables[0].columnCount, 9);
    assert.equal(tables[0].sheetName, 'Matched Offer');
    assert.ok(tables[0].rows.every((r) => r.cells.length === 9));
});
await test('each matched line shows its product, priced', () => {
    const { tables } = runOffer(null);
    const sofa = tables[0].rows.find((r) => r.cells[0].value === 'LF-01');
    assert.deepEqual(sofa.cells.map((c) => c.value), ['LF-01', '', 'Nurus Kuyu lounge piece', 'Nurus', 'Kuyu', '2', 'Nos', '1000.00', '2000.00']);
    assert.equal(sofa.cells[1].image, 'https://img/Kuyu.jpg');
    assert.equal(sofa.sourceDescription, 'Three seater sofa 2400 x 880');
    assert.equal(sofa.productUrl, 'https://p/Kuyu');
    assert.equal(sofa.selectedMainCat, 'Lounge');
    assert.equal(sofa.pageNum, 2);
});
await test('an unmatched line keeps its words, pictures and rate', () => {
    const { tables } = runOffer(null);
    const table = tables[0].rows.find((r) => r.cells[0].value === 'LF-03');
    assert.deepEqual(table.cells.map((c) => c.value), ['LF-03', '', 'Coffee table round 800', '', '', '3', 'Nos', '', '']);
});
await test('costing factors apply to every price', () => {
    const f = { profit: 10, freight: 5, customs: 5, installation: 0, vat: 5, exchangeRate: 0.385, fromCurrency: 'USD', toCurrency: 'OMR' };
    assert.equal(Math.round(costMultiplier(f) * 1e4) / 1e4, 0.462);
    const { tables } = runOffer(f);
    const sofa = tables[0].rows.find((r) => r.cells[0].value === 'LF-01');
    assert.equal(sofa.cells[7].value, '462.00');
    assert.equal(sofa.cells[8].value, '924.00');
    assert.equal(costMultiplier(neutralFactors('USD')), 1);
});
await test('headings stay, printed totals and set components do not', () => {
    const { tables } = runOffer(null);
    const headings = tables[0].rows.filter((r) => r.isHeader).map((r) => r.cells[2].value);
    assert.deepEqual(headings, ['LOUNGE AREA', 'Side tables']);
    const all = tables[0].rows.map((r) => r.cells[2].value).join('|');
    assert.doesNotMatch(all, /TOTAL VALUE|Grand total|Pedestal/);
    assert.equal(tables[0].rows[0].sectionLabel, 'Lounge');
});
await test('repeated column labels are not headings', () => {
    const t = { header: ['S.No', 'Description', 'Qty'], rows: [row(['S.No', 'Description', 'Qty'], { isHeader: true }), row(['1', 'Desk', '2'])] };
    const lines = collectLines([t]);
    const out = matchedOfferTables([t], lines, [product('A', 'Desk', 10)], null);
    assert.equal(out[0].rows.length, 1);
});
await test('several sheets keep their names', () => {
    const second = { ...BOQ, sheetName: 'Offices' };
    const lines = collectLines([BOQ, second]);
    const out = matchedOfferTables([BOQ, second], lines, lines.map(() => ({ ok: false })), null);
    assert.deepEqual(out.map((t) => t.sheetName), ['Lounge — Matched', 'Offices — Matched']);
});
await test('the offer currency is the one most products are priced in', () => {
    const { results } = runOffer(null);
    assert.equal(offerCurrency(results), 'USD');
    assert.equal(offerCurrency([product('A', 'x', 5, { currency: 'AED' }), product('B', 'y', 5, { currency: 'AED' }), product('C', 'z', 5)]), 'AED');
    assert.equal(offerCurrency([{ ok: false }]), 'USD');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
    for (const f of failures) console.error(`\n✗ ${f.name}\n${f.err.stack}`);
    process.exit(1);
}
