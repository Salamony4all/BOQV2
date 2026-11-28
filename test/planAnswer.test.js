/**
 * Plan analysis — reading a vision model's answer in whatever shape it arrives.
 *
 * The plan prompt asks for { zones, items, planSummary }. On 28 Nov 2026 the live site dropped
 * three answers of about 7,000 characters each as "0 items" because the list of lines was not
 * where the code looked, and then ran out of time on the next model. These checks pin the reader
 * that replaced the single `answer.items` lookup: the lines are found wherever they are, one bad
 * line costs that line only, and an answer with no lines is still reported as having none.
 *
 * Pure functions only: no network, database or AI calls.   Run: node test/planAnswer.test.js
 */
import assert from 'node:assert/strict';
import {
  coercePlanAnswer,
  describePlanAnswer,
  isPlanItemLike,
  salvagePlanItemsFromText,
} from '../server/utils/planAnswer.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  PASS: ${name}`);
}

const chair = { location: 'Lounge', scope: 'Furniture', code: 'CH-01', name: 'Lounge Armchair', description: 'Lounge armchair, fabric, 750 x 800 x 780 mm', qty: 12, unit: 'Nos' };
const table = { location: 'Lounge', scope: 'Furniture', code: 'TB-01', name: 'Coffee Table', description: 'Round coffee table, 600 dia x 450 mm', qty: 6, unit: 'Nos' };
const counter = { location: 'Reception', scope: 'Custom Fabrication', code: 'FAB-01', name: 'Reception Counter', description: 'Curved reception counter, 3600 x 800 x 1100 mm', qty: 1, unit: 'Nos' };
const zone = { name: 'Lounge', areaSqm: 86.5, perimeterLm: 41, floorFinish: 'Carpet Tile', ceilingType: 'Gypsum Board' };

test('1. The object that was asked for is read as it is', () => {
  const { answer, how } = coercePlanAnswer({ zones: [zone], items: [chair, table], planSummary: 'Extraction of 2 items completed.' });
  assert.equal(how, 'object');
  assert.equal(answer.items.length, 2);
  assert.deepEqual(answer.zones, [zone]);
  assert.equal(answer.planSummary, 'Extraction of 2 items completed.');
  // A line with only a name is kept here, as it always was.
  assert.equal(coercePlanAnswer({ items: [{ name: 'Sofa' }, null, 'x', {}] }).answer.items.length, 1);
});

test('2. A list of answers (one per sheet) is merged', () => {
  const { answer, how } = coercePlanAnswer([
    { zones: [zone], items: [chair, table], planSummary: 'Sheet 1' },
    { zones: [], items: [counter] },
  ]);
  assert.equal(how, 'list-of-answers');
  assert.deepEqual(answer.items.map((i) => i.code), ['CH-01', 'TB-01', 'FAB-01']);
  assert.deepEqual(answer.zones, [zone]);
  assert.equal(answer.planSummary, 'Sheet 1');
  // The commonest case: the asked-for object wrapped in a one-element list.
  assert.equal(coercePlanAnswer([{ zones: [zone], items: [chair] }]).answer.items.length, 1);
});

test('3. The bare list of lines is read', () => {
  const { answer, how } = coercePlanAnswer([chair, table, counter]);
  assert.equal(how, 'list-of-items');
  assert.equal(answer.items.length, 3);
  // A list of rooms is not a list of lines.
  assert.equal(coercePlanAnswer([zone, { name: 'Reception', areaSqm: 20 }]).answer.items.length, 0);
});

test('4. A wrapper object or another name for the list is followed', () => {
  assert.equal(coercePlanAnswer({ result: { zones: [zone], items: [chair, table] } }).how, 'nested');
  assert.equal(coercePlanAnswer({ data: { boq: [chair] } }).answer.items.length, 1);
  const other = coercePlanAnswer({ zones: [zone], boqItems: [{ ...chair, qty: undefined, quantity: 12 }] });
  assert.equal(other.how, 'other-list-name');
  assert.equal(other.answer.items[0].qty, 12); // "quantity" is read as qty
  assert.deepEqual(other.answer.zones, [zone]);
  // Lines grouped under their room take the room as their location.
  const grouped = coercePlanAnswer({
    items: [],
    zones: [
      { name: 'Lounge', areaSqm: 86.5, items: [{ name: 'Armchair', qty: 12, unit: 'Nos' }, { ...table, location: 'Lounge North' }] },
      { name: 'Reception', items: [{ description: 'Curved counter', qty: 1, unit: 'Nos' }] },
    ],
  });
  assert.equal(grouped.how, 'nested');
  assert.deepEqual(grouped.answer.items.map((i) => i.location), ['Lounge', 'Lounge North', 'Reception']);
  // Lines keyed by their tag instead of listed.
  const keyed = coercePlanAnswer({ zones: [zone], items: { 'CH-01': { name: 'Armchair', qty: 12, unit: 'Nos' }, 'TB-01': { ...table, code: 'T-1' } } });
  assert.equal(keyed.how, 'lines-keyed-by-tag');
  assert.deepEqual(keyed.answer.items.map((i) => i.code), ['CH-01', 'T-1']);
  assert.deepEqual(keyed.answer.zones, [zone]);
  // Lists nested inside a line (sub-components) are not mistaken for more lines.
  const nestedInItem = coercePlanAnswer({ items: [{ ...counter, components: [{ name: 'Top', unit: 'Nos' }] }] });
  assert.equal(nestedInItem.answer.items.length, 1);
});

test('5. An answer given as a JSON string is opened', () => {
  const { answer } = coercePlanAnswer(JSON.stringify({ zones: [], items: [chair] }));
  assert.equal(answer.items.length, 1);
});

test('6. A syntax slip in one line does not cost the plan', () => {
  // The second line has an unescaped quote (a 24" screen), so the answer does not parse as a whole.
  const raw = `{
  "zones": [${JSON.stringify(zone)}],
  "items": [
    ${JSON.stringify(chair)},
    {"location": "Lounge", "scope": "Furniture", "code": "AV-01", "name": "Screen", "description": "Wall display 24" on arm", "qty": 2, "unit": "Nos"},
    ${JSON.stringify(table)},
    ${JSON.stringify(counter)},
  ],
  "planSummary": "Extraction of 4 items completed."
}`;
  assert.throws(() => JSON.parse(raw));
  // The general-purpose parser falls back to the first list it can balance: the rooms.
  const { answer, how } = coercePlanAnswer([zone], raw);
  assert.equal(how, 'line-by-line');
  assert.deepEqual(answer.items.map((i) => i.code), ['CH-01', 'AV-01', 'TB-01', 'FAB-01']);
  assert.equal(answer.items[1].description, 'Wall display 24" on arm'); // the quote is kept as text
  assert.equal(answer.items[1].qty, 2);
  assert.deepEqual(answer.zones, [zone]);
  // With nothing parsed at all the lines are still found in the text.
  assert.equal(coercePlanAnswer(null, raw).answer.items.length, 4);

  // The same slip right before a comma looks like the end of the text at first.
  const beforeComma = '{"items": [{"name": "Screen", "description": "Display 24", wall mounted", "qty": 2, "unit": "Nos"}, ' + JSON.stringify(chair) + ']}';
  assert.throws(() => JSON.parse(beforeComma));
  const fixed = salvagePlanItemsFromText(beforeComma);
  assert.equal(fixed.length, 2);
  assert.equal(fixed[0].description, 'Display 24", wall mounted');
  assert.equal(fixed[0].qty, 2);

  // A line that cannot be repaired is dropped; the lines around it are kept.
  const broken = '{"items": [' + JSON.stringify(chair) + ', {"name": "Sofa" "qty" 2 "unit": }, ' + JSON.stringify(table) + '], "zones": []}';
  assert.deepEqual(salvagePlanItemsFromText(broken).map((i) => i.code), ['CH-01', 'TB-01']);

  // Braces, brackets, line breaks and escaped quotes inside a text do not end a line early.
  const tricky = '{"items": [{"name": "Planter", "description": "Trough {GRC} [custom]\n2400 mm \\"long\\"", "qty": 3, "unit": "Nos", "ok": true, "rate": 1.5e2}, ' + JSON.stringify(chair) + '], "zones": [';
  const trickyItems = salvagePlanItemsFromText(tricky);
  assert.equal(trickyItems.length, 2);
  assert.equal(trickyItems[0].description, 'Trough {GRC} [custom] 2400 mm "long"');
  assert.deepEqual([trickyItems[0].ok, trickyItems[0].rate], [true, 150]);

  // The lines under a name not seen before, after the rooms, in an answer that does not parse.
  const unknownKey = '{"zones": [' + JSON.stringify(zone) + '], "ffeLines": [' + JSON.stringify(chair) + ', {"name": "Screen", "description": "24" display", "qty": 1, "unit": "Nos"}]}';
  assert.throws(() => JSON.parse(unknownKey));
  assert.equal(salvagePlanItemsFromText(unknownKey).length, 2);
  assert.equal(salvagePlanItemsFromText('{"zones": [' + JSON.stringify(zone) + '], "note": "no lines"').length, 0);

  // The bare list of lines, cut off mid-way (the model ran out of output).
  const cut = '[' + JSON.stringify(chair) + ', ' + JSON.stringify(table) + ', {"name": "Sofa", "descr';
  assert.equal(salvagePlanItemsFromText(cut).length, 2);
});

test('7. An answer with no lines is still an answer with no lines', () => {
  for (const empty of [{ zones: [zone], items: [], planSummary: 'No furniture visible.' }, { zones: [zone] }, [], null, undefined, 'no json here', 42]) {
    const { answer, how } = coercePlanAnswer(empty, typeof empty === 'string' ? empty : '');
    assert.equal(how, 'none');
    assert.deepEqual(answer.items, []);
  }
  assert.deepEqual(coercePlanAnswer({ zones: [zone], items: [] }).answer.zones, [zone]);
  // Strings in place of lines cannot be priced or matched: not lines.
  assert.equal(coercePlanAnswer({ items: ['12 chairs', '6 tables'] }).answer.items.length, 0);
});

test('8. What counts as a BOQ line', () => {
  assert.equal(isPlanItemLike(chair), true);
  assert.equal(isPlanItemLike({ description: 'Task chair', quantity: 4 }), true);
  assert.equal(isPlanItemLike(zone), false); // a room: a name, but nothing a line has
  assert.equal(isPlanItemLike({ qty: 4, unit: 'Nos' }), false); // no text
  assert.equal(isPlanItemLike('chair'), false);
  assert.equal(isPlanItemLike(null), false);
});

test('9. The description of an unreadable answer says where it breaks, briefly', () => {
  const raw = '{"zones": [], "items": [{"name": "Screen", "description": "24" display"}]}';
  const d = describePlanAnswer(null, raw);
  assert.equal(d.chars, raw.length);
  assert.equal(d.shape, 'nothing');
  assert.ok(d.parseError.length > 0);
  assert.ok(d.head.length <= 260 && d.tail.length <= 160);
  const o = describePlanAnswer({ zones: [zone], items: [] }, '{"zones":[],"items":[]}');
  assert.deepEqual([o.shape, o.itemsField, o.parseError], ['object', 'list of 0', '']);
  assert.deepEqual(o.keys, ['zones', 'items']);
  assert.equal(describePlanAnswer([{ a: 1 }], '[{"a":1}]').shape, 'list of 1');
  assert.equal(describePlanAnswer(undefined, undefined).chars, 0);
});

console.log(`\n✅ ${passed}/9 plan answer checks passed`);
if (passed !== 9) process.exit(1);
process.exit(0);
