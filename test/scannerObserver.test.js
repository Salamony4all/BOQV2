/**
 * Market Scanner — what the 12-hour observer may take from a lead's source page.
 *
 * The observer fetches each lead's source link and used to read the whole page: any page with the
 * word "opened" moved the lead to Handover, and any 8-digit run became a "Project Office Line".
 * On a tender portal every page has both, so open tenders were marked handed over and the portal's
 * own numbers were attached to each of them. These checks pin the rule that replaced it: only the
 * passages that name the lead count, a stage moves only on a statement, and a number is a phone
 * only with a country code or after a phone word.
 *
 * Pure functions only: no database, network or AI calls.   Run: node test/scannerObserver.test.js
 */
import assert from 'node:assert/strict';
import {
  detectStage,
  detectStageEvidence,
  leadPassagesInPage,
  readLeadFromPage,
} from '../server/utils/marketScannerEngine.js';

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  PASS: ${name}`);
    });
}

const LEAD = {
  id: 1,
  name: 'Construction of Additional Classrooms at Al Noor School in Sohar',
  en_name: 'Construction of Additional Classrooms at Al Noor School in Sohar',
  stage: 'tender',
};

// A tender portal page that is a shell around a list: menus, dates, counters, a help desk line.
// It never names the lead.
const PORTAL_SHELL = [
  'Home | New Tenders | Floated Tenders | Tenders Opened | Awarded Tenders | Completed Tenders | Help',
  'Tender No 100776 Bid closing date 20261215 Bid opening date 2026 1128 Fee 25.000',
  'Design and build of roads, construction of schools, supply of furniture and maintenance works.',
  'Portal operational hours 07:30 to 14:30. Reference 14012345 Ticket 71234567. Visitors today 20251130',
].join(' ');

const ARTICLE = [
  'Education projects update. The Ministry has announced progress on several school schemes this week.',
  'Construction of Additional Classrooms at Al Noor School in Sohar: the contract was awarded to Example Contracting LLC',
  'after bids were opened last month. The works will be completed in 2028.',
  'For enquiries Tel: 2412 3456 or +968 9123 4567, projects@example-contracting.test.',
].join(' ');

await test('1. A portal page that never names the lead changes nothing (the old whole-page reading said Handover)', () => {
  // What the single-word detector makes of this page: the reason open tenders were marked handed over.
  assert.equal(detectStage(PORTAL_SHELL), 'handover');
  const seen = readLeadFromPage(LEAD, PORTAL_SHELL);
  assert.deepEqual(seen, { mentioned: false, stage: null, contacts: [] });
});

await test('2. A page about the lead that states an award moves a tender to Awarded and yields its contacts', () => {
  const seen = readLeadFromPage(LEAD, ARTICLE);
  assert.equal(seen.mentioned, true);
  assert.equal(seen.stage, 'award');
  const phones = seen.contacts.filter((c) => c.phone).map((c) => c.contact_key).sort();
  assert.deepEqual(phones, ['ph:24123456', 'ph:96891234567']);
  assert.deepEqual(seen.contacts.filter((c) => c.email).map((c) => c.email), ['projects@example-contracting.test']);
  assert.ok(seen.contacts.every((c) => c.source === 'observer'));
});

await test('3. A stage never moves backwards and never moves on plans or routine tender words', () => {
  assert.equal(readLeadFromPage({ ...LEAD, stage: 'construction' }, ARTICLE).stage, null);
  assert.equal(readLeadFromPage({ ...LEAD, stage: 'award' }, ARTICLE).stage, null);
  const routine = `${LEAD.name}. Bids will be opened on 12 January. Completion period 18 months. Award criteria: lowest evaluated bid. Design and build contract for the construction of 12 classrooms.`;
  const seen = readLeadFromPage(LEAD, routine);
  assert.equal(seen.mentioned, true);
  assert.equal(seen.stage, null);
});

await test('4. Stage statements are recognised, single stage words are not', () => {
  const yes = [
    ['The contract was awarded to Example LLC', 'award'],
    ['Example LLC wins the OMR 4 million school contract', 'award'],
    ['Example LLC appointed as main contractor', 'award'],
    ['Construction has started on the site', 'construction'],
    ['The developer broke ground on Sunday', 'construction'],
    ['The tower, now under construction, will have 40 floors', 'construction'],
    ['The hospital is nearing completion', 'completion'],
    ['Works are 85% complete', 'completion'],
    ['The project has been completed ahead of schedule', 'completion'],
    ['The terminal was officially opened by the minister', 'handover'],
    ['The plant was handed over to the operator', 'handover'],
    ['The mall opened its doors to the public', 'handover'],
  ];
  for (const [text, stage] of yes) assert.equal(detectStageEvidence(text), stage, text);
  const no = [
    'Tenders Opened', 'Awarded Tenders', 'Award criteria', 'Bid opening date', 'Completion period: 12 months',
    'To be completed by 2028', 'Construction of a new hospital', 'Design and build', 'Portal operational hours',
    'Completed Tenders', 'The tender was opened for bidding', '',
  ];
  for (const text of no) assert.equal(detectStageEvidence(text), null, text);
  // The latest stated stage wins.
  assert.equal(detectStageEvidence('The contract was awarded in 2024 and the school was officially opened today'), 'handover');
});

await test('5. A longer name is recognised by its distinctive words close together, in another order', () => {
  const page = 'North Al Batinah news. Additional classrooms for Al Noor School, Sohar: construction has started this week and will take a year.';
  const seen = readLeadFromPage(LEAD, page);
  assert.equal(seen.mentioned, true);
  assert.equal(seen.stage, 'construction');
  // Three of the five words spread over a long list do not make a mention.
  const list = `Classrooms for Al Salam School in Nizwa. ${'Other notice. '.repeat(40)} Roads in Sohar. ${'Other notice. '.repeat(40)} Additional parking.`;
  assert.equal(readLeadFromPage(LEAD, list).mentioned, false);
});

await test('6. A short, common name is never enough to tie a page to a lead', () => {
  const generic = { name: 'Supply of Furniture', en_name: 'Supply of Furniture', stage: 'tender' };
  const page = 'Supply of furniture for the new offices: the contract was awarded to Example Trading. Tel: 2412 3456';
  assert.deepEqual(readLeadFromPage(generic, page), { mentioned: false, stage: null, contacts: [] });
  const twoWords = { name: 'Office Furniture Supply', en_name: 'Office Furniture Supply', stage: 'tender' };
  const listPage = 'Tender list: office chairs, furniture for schools, office partitions. Contract awarded to Example Trading.';
  assert.equal(readLeadFromPage(twoWords, listPage).mentioned, false);
});

await test('7. The mention is found wherever it is on a long page, and only its surroundings are read', () => {
  const filler = 'Menu item. '.repeat(1500); // about 16,000 characters before the article
  const far = `${filler} ${ARTICLE} ${filler} The stadium was officially opened yesterday. Tel: 2499 9999`;
  const seen = readLeadFromPage(LEAD, far);
  assert.equal(seen.mentioned, true);
  assert.equal(seen.stage, 'award'); // not the stadium's "officially opened", far from the lead
  assert.ok(!seen.contacts.some((c) => c.contact_key === 'ph:24999999'));
  const passages = leadPassagesInPage(far, LEAD);
  assert.ok(passages.length > 200 && passages.length < 1400, `passage length ${passages.length}`);
});

await test('8. Arabic names are matched too', () => {
  const lead = { name: 'إنشاء مدرسة النور للتعليم الأساسي بولاية صحار', en_name: '', stage: 'construction' };
  const page = 'أخبار المشاريع. إنشاء مدرسة النور للتعليم الأساسي بولاية صحار: the school was handed over to the ministry. هاتف: 2412 3456';
  const seen = readLeadFromPage(lead, page);
  assert.equal(seen.mentioned, true);
  assert.equal(seen.stage, 'handover');
  assert.deepEqual(seen.contacts.map((c) => c.contact_key), ['ph:24123456']);
  assert.equal(readLeadFromPage(lead, 'أخبار المشاريع. مدرسة أخرى في مسقط. Tenders Opened').mentioned, false);
});

await test('9. Numbers are phones only with a country code or after a phone word', () => {
  const around = (tail) => readLeadFromPage(LEAD, `${LEAD.name}. ${tail}`).contacts.map((c) => c.contact_key);
  assert.deepEqual(around('Tender No 14012345, closing 20261215, session 2025 2026, id 100776123456'), []);
  assert.deepEqual(around('Reference 71234567'), []);
  assert.deepEqual(around('Tel 24123456'), ['ph:24123456']);
  assert.deepEqual(around('Phone: 2412-3456'), ['ph:24123456']);
  assert.deepEqual(around('Mobile / WhatsApp: 9123 4567'), ['ph:91234567']);
  assert.deepEqual(around('+968 2412 3456'), ['ph:96824123456']);
  assert.deepEqual(around('Call us on +971 4123 4567 today'), ['ph:97141234567']);
  // At most three phones from one page, each once.
  assert.equal(around('Tel 24123456, Tel 24123456, Tel 24123457, Tel 24123458, Tel 24123459').length, 3);
});

await test('10. Empty and odd input is safe', () => {
  assert.deepEqual(readLeadFromPage({}, ARTICLE), { mentioned: false, stage: null, contacts: [] });
  assert.deepEqual(readLeadFromPage(LEAD, ''), { mentioned: false, stage: null, contacts: [] });
  assert.deepEqual(readLeadFromPage(undefined, undefined), { mentioned: false, stage: null, contacts: [] });
  assert.equal(leadPassagesInPage(null, null), '');
  // A lead with no stage yet is treated as "unknown" and can be placed by a statement.
  assert.equal(readLeadFromPage({ ...LEAD, stage: undefined }, ARTICLE).stage, 'award');
});

console.log(`\n✅ ${passed}/10 scanner observer checks passed`);
if (passed !== 10) process.exit(1);
process.exit(0);
