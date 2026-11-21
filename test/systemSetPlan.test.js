/**
 * System Set Plan & Matcher Test Suite
 *
 * Covers the furniture "set" concept end to end without any network / AI access:
 *   • which BOQ rows become ACTIVE sets (all workstations, L-shape desks, groups of folding tables)
 *   • which rows stay a SINGLE item with a SET OPTION below them
 *     (conference / meeting table → "set of N folding tables")
 *   • component quantities per row unit, row-level helpers (activate / revert / costing / tier copies)
 *   • the same-manufacturer system matcher (tags, cluster sizes, included components, junk filter)
 *
 * Run: node test/systemSetPlan.test.js
 */
import assert from 'node:assert/strict';
import {
    resolveRowSetPlan,
    detectFurnitureSetType,
    isDynamicSystemSetDescription,
    parseSetComponentsFromDescription,
    planFoldingTableModules,
    applySetPlanToRow,
    refreshRowSetPlan,
    describeSetOption,
    summarizeSetOption,
    withSetOptionItems,
    activateSetOption,
    revertSetToSingle,
    dismissSetOption,
    changeRowSetType,
    applyCostingToRowAlternates,
    reidRowSetState,
    hasActiveSet,
    hasSingleAlternative,
    describeSetItemPrice,
    convertRowToSet
} from '../src/utils/furnitureSetUtils.js';
import { matchWorkstationSet, isJunkCatalogEntry, getSeatsPerUnit, toProxiedImageUrl } from '../server/utils/workstationSetMatcher.js';

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
const plan = (description, unit = 'Nos', qty = 1) => resolveRowSetPlan(description, unit, { qty });
const roles = (items) => items.map(it => `${it.qty}×${it.componentRole || it.label}`);
const comps = (description, type, unit = 'Nos', qty = 1) => parseSetComponentsFromDescription(description, type, 'r', { unit, qty });

console.log('\nSet plan — active sets');
await test('every workstation headline is a workstation set', () => {
    for (const d of [
        'Linear Back-to-Back Workstation 1400 x 700 x 750 mm per position',
        'Staff workstation 1600x800',
        '30 OPEN OFFICE WORKSTATIONS - Modular workstations including desks, partitions, and cable management systems',
        'Bench desk 1400x800 back-to-back with screen',
        'Cluster of 4 L-shape workstations with screens'
    ]) assert.equal(plan(d).activeType, 'workstation_set', d);
});
await test('accessories and IT hardware are never workstation sets', () => {
    for (const d of ['Workstation task chair', 'Workstation screen divider 1400mm', 'Pedestal for workstation', 'Desktop Workstation PC Intel Core i7 32GB', 'Office desk 1400x700']) {
        assert.deepEqual(plan(d), { activeType: null, optionType: null }, d);
    }
});
await test('L-shape desks and desks with side returns are L-shape desk sets', () => {
    for (const d of ['L-Shaped Executive Desk 1800 x 1800 mm with side return', 'Manager desk with side return 1600x800', 'Executive desks, side returns, credenzas, and storage units']) {
        assert.equal(plan(d).activeType, 'l_shape_desk_set', d);
    }
    assert.equal(plan('Reception desk L-shaped 3000mm').activeType, null);
});
await test('groups of folding / training tables are folding sets', () => {
    assert.equal(plan('Training room tables set for 24 pax', 'LS').activeType, 'folding_meeting_set');
    assert.equal(plan('Set of 6 folding tables for multipurpose room', 'Set').activeType, 'folding_meeting_set');
    assert.equal(plan('Conference table composed of 4 flip-top tables 1400x700').activeType, 'folding_meeting_set');
});
await test('a conference table with chairs / credenza is a meeting set', () => {
    assert.equal(plan('Conference table for 12 persons with 12 leather chairs and credenza').activeType, 'meeting_set');
    assert.equal(plan('Conference table 4000x1400, chairs not included').activeType, null);
});

console.log('\nSet plan — single item + set option');
await test('conference / meeting tables stay single and get the folding-set option', () => {
    for (const d of [
        'Multi-purpose conference meeting table for 12 persons, reconfigurable, with power and data',
        '12-Pax Rectangular/Boat Boardroom Conference Table with ~4200 x 1400 x 750 mm, cable management/power box',
        'MEETING ROOM -12 PAX: Meeting tables with integrated power/data access',
        'Conference table 3600x1200 with flip-top power box',
        'Multi purpose conference meeting',
        'Folding conference table for 12 persons'
    ]) assert.deepEqual(plan(d), { activeType: null, optionType: 'folding_meeting_set' }, d);
    assert.equal(detectFurnitureSetType('Conference table 3600x1200 for 10 persons with cable management', 'Nos'), null);
    assert.equal(isDynamicSystemSetDescription('Conference table 3600x1200 for 10 persons with power box', 'Nos'), null);
});
await test('small, round and single folding tables get no option', () => {
    for (const d of ['Meeting table round 1200 dia', 'Meeting table for 4 persons 1200x1200', 'Folding training table 1600x700 on castors', 'Flip-top nesting table', 'Coffee table round 600', 'Dining table 1800x900']) {
        assert.deepEqual(plan(d), { activeType: null, optionType: null }, d);
    }
});
await test('rows counted table by table are not turned into sets', () => {
    assert.deepEqual(plan('Training tables 1400x700 foldable for 20 persons', 'Nos', 10), { activeType: null, optionType: null });
    assert.deepEqual(plan('Multi purpose hall folding tables', 'Nos', 40), { activeType: null, optionType: null });
    assert.deepEqual(plan('Meeting tables for 20 persons', 'Nos', 5), { activeType: null, optionType: null });
    assert.equal(plan('Training tables 1400x700 foldable for 20 persons', 'Nos', 1).activeType, 'folding_meeting_set');
});

console.log('\nComponents & quantities');
await test('per-position back-to-back rows price ONE position, sharing the central screen and tray', () => {
    const items = comps('Linear Back-to-Back Workstation 1400 x 700 x 750 mm per position, desk-mounted fabric screen, cable tray, power & data box, 3-drawer mobile pedestal', 'workstation_set', 'Nos', 30);
    assert.deepEqual(roles(items), ['1×workstation_desk', '0.5×screen', '0.5×cable_management', '1×power_box', '1×pedestal']);
});
await test('plain count-unit workstations are one position per unit', () => {
    assert.equal(comps('Staff workstation 1600x800', 'workstation_set')[0].qty, '1');
});
await test('explicit clusters and cluster footprints scale every component', () => {
    assert.deepEqual(roles(comps('6-pax bench workstation cluster 1200x600 with acoustic screen', 'workstation_set')), ['6×workstation_desk', '3×screen']);
    const footprint = comps('Back to back workstation cluster 2800 x 1400 mm with central screen and cable tray', 'workstation_set');
    assert.deepEqual(roles(footprint), ['4×workstation_desk', '2×screen', '2×cable_management']);
    assert.match(footprint[0].label, /1400 × 700 mm/);
    assert.equal(comps('Workstation for 4 persons with screens', 'workstation_set', 'Set')[0].qty, '4');
    assert.equal(comps('Workstations for 8 persons with screens', 'workstation_set', 'Nos', 8)[0].qty, '1');
});
await test('L-shape workstations carry their side return', () => {
    assert.deepEqual(roles(comps('L-shape workstation desk 1600x1400 with pedestal', 'workstation_set')), ['1×workstation_desk', '1×side_return', '1×pedestal']);
});
await test('folding tables are planned from the table footprint, then from capacity', () => {
    assert.equal(planFoldingTableModules('Conference table 4200 x 1400 mm for 12 persons').tableQty, 6);
    assert.equal(planFoldingTableModules('Conference table 3600x1200 for 10 persons').tableQty, 4);
    assert.equal(planFoldingTableModules('Conference table for 16 persons').tableQty, 8);
    assert.equal(planFoldingTableModules('Set of 6 folding tables').tableQty, 6);
    assert.equal(planFoldingTableModules('Multi purpose table').tableQty, 4);
});
await test('explicit quantity lists win over the dynamic parser; spec bullets do not', () => {
    const listed = comps('Workstation system\n* Desk 1400x700 - 4 Nos\n* Mobile pedestal - 4 Nos\n* Screen 1400 - 2 Nos', 'workstation_set', 'Set');
    assert.deepEqual(listed.map(i => `${i.qty}×${i.label}`), ['4×Desk 1400x700', '4×Mobile pedestal', '2×Screen 1400']);
    const spec = comps('Linear workstation 1400x700\n* Top: 25 mm MFC desk top\n* Pedestal: 3 drawers\n* Screen: fabric', 'workstation_set');
    assert.deepEqual(roles(spec), ['1×workstation_desk', '1×screen', '1×pedestal']);
});

console.log('\nRow helpers');
const conferenceRow = () => applySetPlanToRow({ id: 101, sn: 1, description: 'Conference table 4200 x 1400 mm for 12 persons with power and data', qty: '2', unit: 'Nos', rate: '', amount: '' });
const matchedConferenceRow = () => {
    let row = { ...conferenceRow(), selectedBrand: 'NARBUTAS', selectedModel: 'NOVA Conference', brandImage: 'single.jpg', brandDesc: 'Nova conference table', rate: '1500.00', basePrice: 1500, amount: '3000.00', aiStatus: 'success' };
    row = withSetOptionItems(row, row.setOption.items.map(it => (it.componentRole === 'folding_table'
        ? { ...it, selectedBrand: 'NARBUTAS', selectedModel: 'FLIPTOP', brandImage: 'flip.jpg', rate: '487.00', basePrice: 487, aiStatus: 'success' }
        : { ...it, selectedBrand: 'NARBUTAS', selectedModel: 'Power box', rate: '0.00', basePrice: 0, aiStatus: 'success' })));
    return row;
};
await test('a single conference row carries the option below it', () => {
    const row = conferenceRow();
    assert.equal(row.setType, 'single');
    assert.equal(describeSetOption(row.setOption), 'Set of 6 folding tables');
    assert.deepEqual(roles(row.setOption.items), ['6×folding_table', '3×power_box']);
    assert.equal(hasActiveSet(row), false);
});
await test('the option is priced per set and for the row quantity', () => {
    const sum = summarizeSetOption(matchedConferenceRow().setOption, '2');
    assert.equal(sum.ratePerSet, 6 * 487);
    assert.equal(sum.amount, 6 * 487 * 2);
    assert.equal(sum.matchedCount, 2);
    assert.equal(sum.status, 'success');
});
await test('"use this set" / "use single item" switch without losing either match', () => {
    const single = matchedConferenceRow();
    const asSet = activateSetOption(single);
    assert.equal(asSet.setType, 'folding_meeting_set');
    assert.equal(asSet.setOption, null);
    assert.equal(asSet.rate, (6 * 487).toFixed(2));
    assert.equal(asSet.amount, (6 * 487 * 2).toFixed(2));
    assert.ok(hasSingleAlternative(asSet));
    const back = revertSetToSingle(asSet);
    assert.equal(back.setType, 'single');
    assert.equal(back.selectedModel, 'NOVA Conference');
    assert.equal(back.rate, '1500.00');
    assert.equal(back.amount, '3000.00');
    assert.equal(summarizeSetOption(back.setOption, back.qty).ratePerSet, 6 * 487);
    assert.equal(refreshRowSetPlan(back), back);
    assert.equal(dismissSetOption(back).setOption, null);
});
await test('a workstation set can be switched to a single item and back', () => {
    const ws = applySetPlanToRow({ id: 5, description: 'Linear back-to-back workstation 1400x700 per position with screen and pedestal', qty: '30', unit: 'Nos' });
    assert.equal(ws.setType, 'workstation_set');
    const single = changeRowSetType(ws, 'single');
    assert.equal(single.setType, 'single');
    assert.equal(single.setOption.type, 'workstation_set');
    assert.equal(refreshRowSetPlan(single), single, 'explicit single choice is respected');
    assert.equal(changeRowSetType(single, 'workstation_set').setItems.length, ws.setItems.length);
});
await test('descriptions typed after loading are planned right before matching', () => {
    const typed = refreshRowSetPlan({ id: 9, description: 'Executive L-shaped desk with side return', qty: '3', unit: 'Nos', setType: 'single', setItems: [], rate: '250', amount: '750' });
    assert.equal(typed.setType, 'l_shape_desk_set');
    assert.equal(typed.rate, '250');
    const option = refreshRowSetPlan({ id: 10, description: 'Multi-purpose conference meeting table', qty: '1', unit: 'Nos', setType: 'single', setItems: [] });
    assert.equal(option.setOption.type, 'folding_meeting_set');
    const edited = refreshRowSetPlan({ ...option, description: 'Multi-purpose conference meeting table for 16 persons' });
    assert.equal(describeSetOption(edited.setOption), 'Set of 8 folding tables');
});
await test('costing reaches the inactive alternates; tier copies get their own ids', () => {
    const single = matchedConferenceRow();
    assert.equal(applyCostingToRowAlternates(single, 2).setOption.items[0].rate, '974.00');
    assert.equal(applyCostingToRowAlternates(activateSetOption(single), 2).singleAlt.rate, '3000.00');
    const copy = reidRowSetState(single, 100101);
    assert.equal(copy.id, 100101);
    assert.equal(copy.setOption.items[0].id, '100101_opt_0');
});
await test('generic lump-sum sets and plain items are unchanged', () => {
    const lounge = applySetPlanToRow({ id: 1, description: 'VIP LOUNGE - FURNITURE SET\n* Three Seater Sofa - 2 Nos\n* Armchair - 4 Nos', unit: 'LS', qty: 1 });
    assert.equal(lounge.setType, 'seating_set');
    assert.equal(lounge.setItems.length, 2);
    const chair = applySetPlanToRow({ id: 2, description: 'Ergonomic task chair', unit: 'Nos', qty: 10 });
    assert.equal(chair.setType, 'single');
    assert.equal(chair.setOption, null);
});

console.log('\nSystem set matcher');
const img = (n) => `https://cdn.example.com/${n}.jpg`;
const CATALOG = [
    {
        name: 'Alpha Desking', budgetTier: 'mid', products: [
            { model: 'Line Bench Desk', mainCategory: 'Desk & Table', subCategory: 'Workstations', imageUrl: img('bench'), price: 300, setRoles: ['workstation_desk'] },
            { model: 'Line Desk Screen', mainCategory: 'Accessories', subCategory: 'Desk Screens', imageUrl: img('screen'), price: 60, setRoles: ['screen'] },
            { model: 'Line Mobile Pedestal', mainCategory: 'Storage', subCategory: 'Pedestals', imageUrl: img('ped'), price: 90 },
            { model: 'Line Executive Desk with Side Return', mainCategory: 'Desk & Table', subCategory: 'Executive Desks', imageUrl: img('exec'), price: 900, setRoles: ['executive_desk'], includesRoles: ['side_return'] },
            { model: 'Flip Fold Conference Table', mainCategory: 'Desk & Table', subCategory: 'Folding & Multi-Purpose Conference Tables', imageUrl: img('flip'), price: 400, setRoles: ['folding_table'] },
            { model: 'Board Conference Table', mainCategory: 'Desk & Table', subCategory: 'Conference Tables', imageUrl: img('board'), price: 2000 },
            { model: 'DESKING SYSTEMS', mainCategory: 'DESKING SYSTEMS', subCategory: 'DESKING SYSTEMS', imageUrl: img('nav') },
            { model: 'Previous', mainCategory: 'PRODUCTS', subCategory: 'Furniture', productUrl: 'javascript:void(0)' },
            { model: 'Six Fold Desk', mainCategory: 'Furniture', subCategory: 'Desks And Workstations', imageUrl: img('six') }
        ]
    },
    {
        name: 'Budget Works', budgetTier: 'budgetary', products: [
            { model: 'Cluster of 4 Face to Face White Leg', mainCategory: 'Desks', subCategory: 'Workstation', imageUrl: img('c4') },
            { model: '2 Pax Single line With Metal Pedestal', mainCategory: 'Desks', subCategory: 'Workstation', imageUrl: img('p2') },
            { model: 'Rectangular Desk White Leg', mainCategory: 'Desks', subCategory: 'Workstation', imageUrl: img('rect') },
            { model: 'L Shape Executive Desk', mainCategory: 'Desks', subCategory: 'Desks', imageUrl: img('lexec') },
            { model: 'Wooden Leg Meeting Table', mainCategory: 'Desks', subCategory: 'Meeting Table', imageUrl: img('meet') }
        ]
    }
];
const match = (description, type, { unit = 'Nos', qty = 1, brands = null, option = false, preferredBrand = '' } = {}) => {
    const components = option
        ? applySetPlanToRow({ id: 1, description, unit, qty }).setOption.items
        : parseSetComponentsFromDescription(description, type, 'r', { unit, qty });
    return matchWorkstationSet({ parentDescription: description, components, isAuto: true, availableBrands: brands, allLocalBrands: CATALOG, preferredBrand });
};
const models = (res) => res.components.map(c => (c.status === 'success' ? `${c.product.componentRole}=${c.product.model}${c.product.includedInSystem ? ' (incl)' : ''}` : `${c.componentRole}=✗`));

await test('catalog hygiene helpers', () => {
    assert.equal(isJunkCatalogEntry(CATALOG[0].products[6]), true, 'category navigation entry');
    assert.equal(isJunkCatalogEntry(CATALOG[0].products[7]), true, 'pager link');
    assert.equal(isJunkCatalogEntry(CATALOG[0].products[0]), false);
    assert.equal(isJunkCatalogEntry({ model: 'Elliot Meeting Table', excludeFromSets: true }), true);
    assert.equal(getSeatsPerUnit({ model: 'Cluster of 4 Face to Face White Leg' }), 4);
    assert.equal(getSeatsPerUnit({ model: '2 Pax Single line' }), 2);
    assert.equal(getSeatsPerUnit({ model: 'Line Bench Desk' }), 1);
});
await test('a workstation is resolved as one same-manufacturer system', async () => {
    const res = await match('Linear back-to-back workstation 1400x700 per position with screen, cable tray and pedestal', 'workstation_set', { brands: ['Alpha Desking'] });
    assert.equal(res.anchorBrand, 'Alpha Desking');
    assert.deepEqual(models(res), [
        'workstation_desk=Line Bench Desk',
        'screen=Line Desk Screen',
        'cable_management=Line Bench Desk — Under-Desk Cable Management Tray — shared by 2 facing positions (incl)',
        'pedestal=Line Mobile Pedestal'
    ]);
    assert.equal(res.components[2].product.price, 0, 'included hardware is never priced twice');
});
await test('cluster products cover several positions; desk clusters are never used as pedestals', async () => {
    const res = await match('4-pax back-to-back workstation cluster with pedestals', 'workstation_set', { brands: ['Budget Works'] });
    assert.equal(res.components[0].product.model, 'Cluster of 4 Face to Face White Leg');
    assert.equal(res.components[0].product.suggestedQty, 1);
    assert.equal(res.components[1].status, 'no_match');
    const single = await match('Staff workstation 1600x800 per position', 'workstation_set', { brands: ['Budget Works'] });
    assert.equal(single.components[0].product.model, 'Rectangular Desk White Leg');
});
await test('the side return is part of an L-shape / tagged executive desk', async () => {
    const tagged = await match('Executive L-shaped desk with side return', 'l_shape_desk_set', { brands: ['Alpha Desking'] });
    assert.deepEqual(models(tagged), ['executive_desk=Line Executive Desk with Side Return', 'side_return=Line Executive Desk with Side Return — Desk Side Return Extension Unit (incl)']);
    const named = await match('Executive L-shaped desk with side return', 'l_shape_desk_set', { brands: ['Budget Works'] });
    assert.equal(named.components[0].product.model, 'L Shape Executive Desk');
    assert.equal(named.components[1].product.includedInSystem, true);
});
await test('the folding option only uses real folding tables and prefers the single item\'s brand', async () => {
    const res = await match('Conference table 4200 x 1400 mm for 12 persons', null, { option: true, preferredBrand: 'Alpha Desking' });
    assert.equal(res.anchorBrand, 'Alpha Desking');
    assert.equal(res.components[0].product.model, 'Flip Fold Conference Table', '"Six Fold Desk" and fixed tables are not folding tables');
    const none = await match('Conference table 4200 x 1400 mm for 12 persons', null, { option: true, brands: ['Budget Works'] });
    assert.equal(none.components[0].status, 'no_match', 'a fixed meeting table is never offered as a folding table');
});
await test('fixed conference tables do not get flip-top products', async () => {
    const res = await match('Conference table for 12 persons with 12 chairs', 'meeting_set', { brands: ['Alpha Desking'] });
    assert.equal(res.components[0].product.model, 'Board Conference Table');
});
await test('product images are routed through the image proxy exactly once', async () => {
    const raw = 'https://cdn.example.com/a b.jpg';
    const proxied = 'http://localhost:3001/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa%20b.jpg';
    assert.equal(toProxiedImageUrl(raw, 'http://localhost:3001/api/image-proxy?url='), proxied, 'getProxyBase() form');
    assert.equal(toProxiedImageUrl(raw, 'http://localhost:3001'), proxied, 'bare origin form');
    assert.equal(toProxiedImageUrl(proxied, 'http://localhost:3001/api/image-proxy?url='), proxied, 'never wrapped twice');
    assert.equal(toProxiedImageUrl('/temp/a.png', 'http://localhost:3001/api/image-proxy?url='), '/temp/a.png');
    assert.equal(toProxiedImageUrl(raw, ''), raw);
    const components = parseSetComponentsFromDescription('Staff workstation 1400x700 per position', 'workstation_set', 'r', { unit: 'Nos', qty: 1 });
    const res = await matchWorkstationSet({
        parentDescription: 'Staff workstation 1400x700 per position', components, isAuto: true, availableBrands: ['Alpha Desking'],
        allLocalBrands: CATALOG, proxyBaseUrl: 'http://localhost:3001/api/image-proxy?url='
    });
    const url = res.components[0].product.imageUrl;
    assert.equal(url.split('/api/image-proxy').length - 1, 1, url);
});
await test('the manual "Set" action starts from the row itself, not a guessed template', () => {
    const chair = { id: 6, description: 'Visitor chair with armrest, fabric upholstery', unit: 'Nos', qty: '24', setType: 'single', setItems: [],
        selectedBrand: 'Sedus', selectedModel: 'se:joy', rate: '120.00', basePrice: 120, amount: '2880.00', aiStatus: 'success' };
    const set = convertRowToSet(chair);
    assert.equal(set.setType, 'custom_set', 'a body word like "fabric" never turns a chair into a sofa set');
    assert.equal(set.setItems.length, 2);
    assert.equal(set.setItems[0].label, 'Visitor chair with armrest, fabric upholstery');
    assert.equal(set.setItems[0].selectedModel, 'se:joy', 'the current match moves into the first component');
    assert.equal(set.setItems[1].selectedModel, '');
    assert.equal(set.singleAlt.selectedModel, 'se:joy', 'and stays available as the single-item option');
    const lounge = convertRowToSet({ id: 7, description: 'VIP lounge seating set, sofa and armchairs', unit: 'Set', qty: '1', setType: 'single', setItems: [] });
    assert.equal(lounge.setType, 'seating_set', 'a headline that names a set still gets its template');
    const meeting = applySetPlanToRow({ id: 8, description: 'Conference table for 12 persons, 4200x1400', unit: 'No', qty: '1' });
    assert.equal(convertRowToSet(meeting).setType, 'folding_meeting_set', 'an existing set option is promoted as is');
});
await test('an unpriced component is never shown as "Included"', () => {
    const tables = { componentRole: 'folding_table', qty: '6', rate: '487.00', selectedBrand: 'Alpha', selectedModel: 'Flip' };
    const powerNoPrice = { componentRole: 'power_box', qty: '3', rate: '0.00', selectedBrand: 'Alpha', selectedModel: 'Socket Block', aiResult: { product: { model: 'Socket Block' } } };
    const trayIncluded = { componentRole: 'cable_management', qty: '3', rate: '0.00', selectedBrand: 'Alpha', selectedModel: 'Flip — Cable Tray', aiResult: { product: { includedInSystem: true } } };
    const unmatched = { componentRole: 'chair', qty: '12', rate: '' };
    assert.equal(describeSetItemPrice(tables), '487.00');
    assert.equal(describeSetItemPrice(powerNoPrice), 'No price');
    assert.equal(describeSetItemPrice(trayIncluded), 'Included');
    assert.equal(describeSetItemPrice(unmatched), '—');
    const summary = summarizeSetOption({ type: 'folding_meeting_set', items: [tables, powerNoPrice, trayIncluded, unmatched] }, 2);
    assert.equal(summary.ratePerSet, 2922);
    assert.equal(summary.amount, 5844);
    assert.equal(summary.matchedCount, 3);
    assert.equal(summary.unpricedCount, 1, 'only the matched SKU without a price');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
    for (const f of failures) console.error(`\n✗ ${f.name}\n${f.err.stack}`);
    process.exit(1);
}
