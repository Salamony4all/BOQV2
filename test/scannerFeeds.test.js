/**
 * Market Scanner — leads from publisher feeds, and how a scan is saved.
 *
 * News leads used to come only through Google News, whose links are redirects a server cannot
 * read past, so the 12-hour observer had nothing to read for them. Trade publications publish
 * feeds that carry the article's own address. These checks pin how such a feed item becomes a
 * lead, that one story is one lead whichever feed delivered it, that the article's address is
 * never replaced by a redirect, and that saving a scan no longer loses batches or overwrites
 * what a scan cannot know (a later stage, the client, notes, pins, the AI brief).
 *
 * Pure functions only: no database, network or AI calls.   Run: node test/scannerFeeds.test.js
 */
import assert from 'node:assert/strict';
import {
  classifyScopesAndFitout,
  detectLeadCountry,
  headlineKey,
  isNewsLead,
  leadFromFeedItem,
  mergeScanFindings,
  parseFeedItems,
  readLeadFromPage,
  stageFromHeadline,
} from '../server/utils/marketScannerEngine.js';
import {
  cleanArticleUrl,
  isArticleUrl,
  isFeedRedirectLink,
  pickSourceLink,
  siteOfHost,
} from '../server/utils/sourceLinkResolver.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  PASS: ${name}`);
}

const REDIRECT = 'https://news.google.com/rss/articles/CBMiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?oc=5';
const ARTICLE = 'https://www.constructionweekonline.com/projects-tenders/nakheel-awards-villas-contract';
const FEED = { name: 'Construction Week', url: 'https://www.constructionweekonline.com/feed' };
const scopes = (text) => classifyScopesAndFitout(text, { fallbackToFitouts: false }).scopes;

test('1. Scope words count only as whole words', () => {
  // "ffe" is inside offer, coffee and buffer; "tiles" inside textiles; "fit out" inside "benefit outcomes".
  for (const headline of [
    'Turkish Airlines offers Cairo-Istanbul return fares from $240',
    'Lebanon fears a maritime buffer zone in southern waters',
    'Black Coffee to play at the Abu Dhabi Grand Prix',
    'Oman textiles exports rise 12 per cent',
    'Wellness programmes benefit outcomes for staff, study finds',
  ]) assert.deepEqual(scopes(headline), [], headline);
  assert.deepEqual(scopes('Hotel FF&E package tender issued'), ['furniture']);
  assert.deepEqual(scopes('Loose furniture and FFE for 120 rooms'), ['furniture']);
  assert.deepEqual(scopes('Interior fit-outs for three office floors'), ['fitouts']);
  assert.deepEqual(scopes('Supply of porcelain tiles and sanitaryware'), ['sanitary_tiles']);
  assert.ok(scopes('Carpeting and curtains for the new terminal').includes('furniture'));
  assert.ok(scopes('تأثيث مبنى الوزارة').includes('furniture')); // Arabic hints are unchanged
});

test('2. A feed is read as plain headline, link and summary', () => {
  const rss = `<?xml version="1.0"?><rss><channel><title>Feed</title><link>https://example.com</link>
    <item><title><![CDATA[Nakheel awards $381m contract for 176 villas on Palm Jebel Ali]]></title>
      <link>${ARTICLE}</link>
      <pubDate>Thu, 26 Nov 2026 08:23:35 +0000</pubDate>
      <description><![CDATA[<p>Dubai developer <b>Nakheel</b> has awarded a contract&nbsp;to Ginco &amp; partners.</p>]]></description></item>
    <item><title>Omantel&amp;#039;s new campus opens in Muscat</title><link>https://example.com/a2</link><description>Short.</description></item>
    <item><title>Third</title><link>https://example.com/a3</link></item></channel></rss>`;
  const items = parseFeedItems(rss, 2);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: 'Nakheel awards $381m contract for 176 villas on Palm Jebel Ali',
    link: ARTICLE,
    description: 'Dubai developer Nakheel has awarded a contract to Ginco & partners.',
    published: 'Thu, 26 Nov 2026 08:23:35 +0000',
  });
  assert.equal(items[1].title, "Omantel's new campus opens in Muscat");
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Tower tops out in Doha</title><link href="https://example.qa/tower"/><updated>2026-11-20T10:00:00Z</updated><summary>Lusail tower.</summary></entry></feed>';
  assert.deepEqual(parseFeedItems(atom), [{ title: 'Tower tops out in Doha', link: 'https://example.qa/tower', description: 'Lusail tower.', published: '2026-11-20T10:00:00Z' }]);
  assert.deepEqual(parseFeedItems('<html><body>Access denied</body></html>'), []);
  assert.deepEqual(parseFeedItems(''), []);
});

test('3. A project headline with a real address and a tracked country is a lead', () => {
  const lead = leadFromFeedItem({
    title: 'Nakheel awards $381m contract for 176 villas on Palm Jebel Ali',
    link: `${ARTICLE}?utm_source=rss&utm_medium=feed`,
    description: 'Dubai developer Nakheel has awarded a construction contract for 176 beachfront villas.',
  }, FEED);
  assert.ok(lead);
  assert.equal(lead.source_url, ARTICLE); // the article itself, without tracking parameters
  assert.equal(lead.source_name, 'Construction Week');
  assert.deepEqual([lead.country, lead.city, lead.stage], ['UAE', 'Dubai', 'award']);
  assert.match(lead.ext_id, /^feed:ae_[0-9a-f]{14}$/);
  assert.equal(lead.is_news, false);
  assert.ok(lead.summary.startsWith('[Construction Week] Dubai developer'));
  assert.ok(lead.score >= 70);
  assert.ok(isNewsLead(lead));
});

test('4. What is not a lead', () => {
  const item = (title, description = 'The project in Dubai will open next year.', link = ARTICLE) => leadFromFeedItem({ title, link, description }, FEED);
  assert.ok(item('The Hoxton to open its first Abu Dhabi hotel and debut branded residences'));
  // no tracked country
  assert.equal(item('Tivoli to open its first hotel in Lisbon', 'The Portuguese capital gets a new hotel.'), null);
  // people, prizes, opinion, jobs, statistics
  assert.equal(item('Pieter Liebenberg appointed GM of Radisson Hotel Riyadh Airport'), null);
  assert.equal(item('Emirates Palace appoints Mirsat Yilmaz as chef de cuisine at its Abu Dhabi hotel'), null);
  assert.equal(item('Rotana named Hotel Brand of the Year at Arabian Business Industry Awards 2026'), null);
  assert.equal(item('Luxury is felt, not seen: What this year’s UAE hotel refurbishments teach'), null);
  assert.equal(item('Hotel careers in Saudi: the latest job opportunities'), null);
  assert.equal(item('Marriott’s branded residential portfolio reaches 115 properties in Dubai'), null);
  // not a building, or nothing happening to one
  assert.equal(item('Dubai air taxis move closer to launch'), null);
  assert.equal(item('Dubai hotel occupancy at 82 per cent', 'Rates were steady.'), null);
  // energy and infrastructure are filtered as before
  assert.equal(item('Contract awarded for wastewater treatment plant near Dubai hotel district'), null);
  // only a redirect, or no usable address: the lead could not be read, so it is not taken from here
  assert.equal(item('Nakheel awards contract for 176 villas in Dubai', 'Contract awarded.', REDIRECT), null);
  assert.equal(item('Nakheel awards contract for 176 villas in Dubai', 'Contract awarded.', 'javascript:alert(1)'), null);
  assert.equal(item('Nakheel awards contract for 176 villas in Dubai', 'Contract awarded.', 'http://127.0.0.1/admin'), null);
  assert.equal(leadFromFeedItem({}, FEED), null);
  // a feed that stopped publishing keeps serving old items: history, not leads
  const now = Date.parse('2026-11-28T12:00:00Z');
  const dated = (published) => leadFromFeedItem({ title: 'New hotel to open in Muscat', link: ARTICLE, description: 'Oman.', published }, FEED, { now });
  assert.equal(dated('Wed, 04 Sep 2024 09:00:00 +0000'), null);
  assert.ok(dated('Tue, 10 Nov 2026 09:00:00 +0000'));
  assert.ok(dated('')); // undated items are kept
  assert.ok(dated('not a date'));
});

test('5. The country a headline is about', () => {
  assert.equal(detectLeadCountry('Minor Hotels to make Bahrain debut with two beachfront resorts'), 'BH');
  assert.equal(detectLeadCountry('UCC Red Sea & Azhar secure contract for Aman Hegra Resort in AlUla'), 'SA');
  assert.equal(detectLeadCountry('Korra Energi secures $14M contract for Moxy Cairo Downtown Hotel'), 'EG');
  // the headline outweighs the summary
  assert.equal(detectLeadCountry('New mall opens in Doha', 'The developer is based in Dubai. Dubai is also getting one.'), 'QA');
  // a single place in the summary places a headline that names none
  assert.equal(detectLeadCountry('Developer unveils 97 villas', 'The gated project in Dubai has a school.'), 'AE');
  // names that are ordinary words elsewhere do not place a headline
  assert.equal(detectLeadCountry('Adam Smith to design new tower', 'The architect Adam Smith.'), '');
  assert.equal(detectLeadCountry('Tivoli opens a hotel in Lisbon'), '');
  // a national paper's own country, when the item names no other
  assert.equal(detectLeadCountry('Hutchison Ports to invest in expansion', '', 'OM'), 'OM');
  assert.equal(detectLeadCountry('New hotel planned in Riyadh', '', 'OM'), 'SA');
});

test('6. The stage a headline states', () => {
  const cases = [
    ['Nakheel awards Ginco $381 million for 176 Palm Jebel Ali villas', 'award'],
    ['Korra Energi secures $14M contract for Moxy Cairo Downtown Hotel', 'award'],
    ['MERED appoints main contractor for Riviera Residences', 'award'],
    ['Nakheel breaks ground on Jamaa Al Anwar mosque', 'construction'],
    ['The Hoxton to open its first Abu Dhabi hotel', 'construction'],
    ['Armani Hotels targets 2030 opening for first hotel in Egypt', 'construction'],
    ['Al Marjan Island Hotel reaches 51% construction completion', 'construction'],
    ['Lusail tower is 92 per cent complete', 'completion'],
    ['Egis finishes project and construction for Boubyan Bank headquarters', 'completion'],
    ['Flow opens new residential development in Riyadh', 'handover'],
    ['JSWD to design RIYMAR Towers', 'design'],
    ['Oman issues tender for new hospital in Sohar', 'tender'],
    ['Meraas unveils 97 villas at Nad Al Sheba Gardens', 'concept'],
  ];
  for (const [headline, stage] of cases) assert.equal(stageFromHeadline(headline), stage, headline);
  // a prize night is not a contract award
  assert.equal(stageFromHeadline('Hotelier Awards 2026 shortlist revealed'), 'concept');
  // with nothing in the headline, a statement in the summary places the project
  assert.equal(stageFromHeadline('Sohar gets a new mall', 'The main contract was awarded to a local builder.'), 'award');
});

test('7. One story has one key, whichever feed delivered it', () => {
  const key = headlineKey('Nakheel awards $381m contract for 176 villas on Palm Jebel Ali');
  assert.equal(headlineKey('Nakheel awards $381m contract for 176 villas on Palm Jebel Ali - Construction Week Online'), key);
  assert.equal(headlineKey('Nakheel Awards $381M Contract for 176 Villas on Palm Jebel Ali | Zawya'), key);
  assert.equal(headlineKey('Nakheel awards “$381m” contract for 176 villas on Palm Jebel Ali — megaproject.com'), key);
  assert.notEqual(headlineKey('Nakheel awards $381m contract for 176 villas on Palm Jumeirah'), key);
  // a dash inside a headline is not a publisher
  assert.notEqual(headlineKey('Tower B - Phase 2 contract awarded'), headlineKey('Tower B'));
  assert.equal(headlineKey(''), '');
});

const tbFinding = {
  ext_id: 'tb:abc123', name: 'توريد أثاث مكتبي — وزارة الصحة', en_name: 'Office furniture supply', country: 'Oman', city: 'Muscat', lat: 23.5, lon: 58.4,
  location_name: 'Muscat, Muscat', scopes: ['furniture'], top_scope: 'furniture', stage: 'tender', client: 'Ministry of Health', summary: 'Bid closing 2026-12-20',
  source_name: 'Oman Tender Board', source_url: 'https://etendering.tenderboard.gov.om/product/publicDash?viewFlag=NewTenders', score: 88, status: 'active', is_news: false,
  enrichment: { reference_no: '123/2026', deadline: '2026-12-20', fee_omr: '25' },
};
const googleFinding = {
  ext_id: 'bnc:ae_1111', name: 'Nakheel awards $381m contract for 176 villas on Palm Jebel Ali', en_name: 'Nakheel awards $381m contract for 176 villas on Palm Jebel Ali', country: 'UAE', city: 'Dubai', lat: 25.2, lon: 55.3,
  location_name: 'Dubai, UAE', scopes: ['fitouts'], top_scope: 'fitouts', stage: 'award', est_value_omr: 146.7, value_note: '$381m', summary: '[GCC Regional Intelligence] Nakheel awards…',
  source_name: 'BNC Network', source_url: REDIRECT, score: 70, status: 'active', is_news: false,
};
const publisherFinding = { ...googleFinding, ext_id: 'feed:ae_2222', source_name: 'Construction Week', source_url: ARTICLE, summary: '[Construction Week] Dubai developer Nakheel…' };

test('8. Every row of a scan has the same fields', () => {
  const { rows, inserted, updated } = mergeScanFindings([tbFinding, googleFinding], [], '2026-11-28T16:00:00.000Z');
  assert.deepEqual([rows.length, inserted, updated], [2, 2, 0]);
  const fields = rows.map((r) => Object.keys(r).sort().join(','));
  assert.equal(fields[0], fields[1]);
  for (const row of rows) {
    // the columns that may not be empty in the table
    assert.equal(typeof row.enrichment, 'object');
    assert.ok(row.enrichment !== null && !Array.isArray(row.enrichment));
    assert.ok(Array.isArray(row.scopes));
    for (const col of ['ext_id', 'name', 'country', 'stage', 'status']) assert.equal(typeof row[col], 'string');
    assert.equal(typeof row.score, 'number');
    assert.equal(typeof row.is_news, 'boolean');
    assert.equal(row.last_seen, '2026-11-28T16:00:00.000Z');
  }
  // what one source does not have is empty, not missing
  assert.equal(rows[1].client, null);
  assert.equal(rows[0].est_value_omr, null);
  assert.deepEqual(rows[1].enrichment, {});
});

test('9. A scan does not overwrite what it cannot know', () => {
  const stored = {
    id: 7, ext_id: 'tb:abc123', name: tbFinding.name, en_name: 'Supply of office furniture for the Ministry of Health headquarters', country: 'Oman',
    stage: 'award', status: 'closed', is_news: false, source_name: 'Oman Tender Board', source_url: tbFinding.source_url,
    client: 'Ministry of Health (DG of Projects)', est_value_omr: 85000, value_note: 'estimate from site visit',
    enrichment: { reference_no: '123/2026', deadline: '2026-12-10', notes: 'Met the buyer on site', pinned: true, priority: 'high', ai_brief: 'Good fit for task seating.' },
  };
  const { rows, inserted, updated, existingIds } = mergeScanFindings([{ ...tbFinding, est_value_omr: 100 }], [stored], '2026-11-28T16:00:00.000Z');
  assert.deepEqual([inserted, updated, existingIds.has('tb:abc123')], [0, 1, true]);
  const row = rows[0];
  assert.equal(row.stage, 'award'); // the portal still lists it as a tender; a stage never goes back
  assert.equal(row.status, 'closed'); // and a closed lead is not revived
  assert.equal(row.client, 'Ministry of Health (DG of Projects)');
  assert.equal(row.est_value_omr, 85000);
  assert.equal(row.value_note, 'estimate from site visit');
  assert.equal(row.en_name, stored.en_name); // the longer English title of an Arabic tender is an earlier translation
  // the portal's own facts are refreshed, everything else in the notes is kept
  assert.deepEqual(row.enrichment, { reference_no: '123/2026', deadline: '2026-12-20', notes: 'Met the buyer on site', pinned: true, priority: 'high', ai_brief: 'Good fit for task seating.', fee_omr: '25' });
  // a later stage from the source does move the lead forward
  assert.equal(mergeScanFindings([{ ...tbFinding, stage: 'award' }], [{ ...stored, stage: 'tender' }]).rows[0].stage, 'award');
  // a lead the user put on hold stays on hold
  assert.equal(mergeScanFindings([tbFinding], [{ ...stored, stage: 'hold' }]).rows[0].stage, 'hold');
});

test('10. One lead per story, and the article’s own address wins', () => {
  // Both sources in one scan: one lead, with the publisher's address, whichever came first.
  for (const order of [[publisherFinding, googleFinding], [googleFinding, publisherFinding]]) {
    const { rows, inserted } = mergeScanFindings(order, []);
    assert.deepEqual([rows.length, inserted], [1, 1]);
    assert.deepEqual([rows[0].source_url, rows[0].source_name], [ARTICLE, 'Construction Week']);
  }
  // A stored lead that only has the redirect gets the address when a publisher's feed brings the story.
  const storedGoogle = { ...googleFinding, id: 41, name: `${googleFinding.name} - Construction Week Online`, enrichment: { notes: 'call Monday' } };
  const upgrade = mergeScanFindings([publisherFinding], [storedGoogle]);
  assert.deepEqual([upgrade.rows.length, upgrade.inserted, upgrade.updated, upgrade.linksUpgraded], [1, 0, 1, 1]);
  assert.equal(upgrade.rows[0].ext_id, 'bnc:ae_1111'); // the stored lead is updated, no second one is added
  assert.equal(upgrade.rows[0].source_url, ARTICLE);
  assert.deepEqual(upgrade.rows[0].enrichment, { notes: 'call Monday' });
  // Afterwards the aggregator brings the story again: the address and its publisher stay.
  const storedPublisher = { ...publisherFinding, id: 42 };
  const again = mergeScanFindings([{ ...googleFinding, ext_id: 'bnc:ae_3333', name: `${googleFinding.name} - Zawya` }], [storedPublisher]);
  assert.deepEqual([again.rows.length, again.inserted, again.linksUpgraded], [1, 0, 0]);
  assert.deepEqual([again.rows[0].ext_id, again.rows[0].source_url, again.rows[0].source_name], ['feed:ae_2222', ARTICLE, 'Construction Week']);
  // The same headline in another country is another story.
  assert.equal(mergeScanFindings([{ ...publisherFinding, country: 'Qatar' }], [storedGoogle]).inserted, 1);
  // An item kept in the news tab is not turned into a lead by a feed.
  const newsItem = { ...googleFinding, id: 43, ext_id: 'web:abc', is_news: true };
  const beside = mergeScanFindings([publisherFinding], [newsItem]);
  assert.deepEqual([beside.inserted, beside.rows[0].ext_id], [1, 'feed:ae_2222']);
  // Odd input is skipped.
  assert.deepEqual(mergeScanFindings([null, {}, { ext_id: 'x' }], null).rows, []);
});

test('11. Article addresses and feed redirects', () => {
  assert.equal(isFeedRedirectLink(REDIRECT), true);
  assert.equal(isFeedRedirectLink('https://news.google.com/rss/search?q=oman'), false);
  assert.equal(isFeedRedirectLink(ARTICLE), false);
  assert.equal(isArticleUrl(ARTICLE), true);
  for (const bad of [REDIRECT, '', 'ftp://example.com/a', 'https://localhost/a', 'http://192.168.1.10/a', 'https://user:pw@example.com/a', 'not a url']) assert.equal(isArticleUrl(bad), false, bad);
  assert.equal(pickSourceLink(ARTICLE, REDIRECT), ARTICLE); // never back to a redirect
  assert.equal(pickSourceLink(REDIRECT, ARTICLE), ARTICLE);
  assert.equal(pickSourceLink(REDIRECT, REDIRECT), REDIRECT);
  assert.equal(pickSourceLink(ARTICLE, 'https://example.com/updated'), 'https://example.com/updated'); // a portal may move a page
  assert.equal(pickSourceLink(ARTICLE, ''), ARTICLE);
  assert.equal(cleanArticleUrl(`${ARTICLE}?utm_source=x&id=5&fbclid=y`), `${ARTICLE}?id=5`);
  assert.equal(cleanArticleUrl('https://example.com/a?page=2#top'), 'https://example.com/a?page=2#top');
  assert.equal(siteOfHost('www.constructionweekonline.com'), 'constructionweekonline.com');
  assert.equal(siteOfHost('etendering.tenderboard.gov.om'), 'tenderboard.gov.om');
  assert.equal(siteOfHost('news.example.co.uk'), 'example.co.uk');
});

test('12. A publisher’s own addresses are not a news lead’s contacts', () => {
  const lead = { ext_id: 'feed:ae_2222', name: 'Nakheel awards contract for 176 villas on Palm Jebel Ali', en_name: 'Nakheel awards contract for 176 villas on Palm Jebel Ali', stage: 'concept' };
  const page = 'Home News Projects Nakheel awards contract for 176 villas on Palm Jebel Ali. The contract was awarded to Ginco. Enquiries: projects@ginco.ae or tenders@nakheel.com. Tips for the newsroom: editor@constructionweekonline.com';
  const seen = readLeadFromPage(lead, page, { pageUrl: ARTICLE });
  assert.equal(seen.mentioned, true);
  assert.equal(seen.stage, 'award');
  assert.deepEqual(seen.contacts.map((c) => c.email).sort(), ['projects@ginco.ae', 'tenders@nakheel.com']);
  // A tender portal's own address next to its tender is that tender's contact.
  const tender = { ext_id: 'tb:abc123', name: 'Construction of Additional Classrooms at Al Noor School in Sohar', stage: 'tender' };
  const portal = 'Construction of Additional Classrooms at Al Noor School in Sohar. Clarifications: bids@tenderboard.gov.om';
  assert.deepEqual(readLeadFromPage(tender, portal, { pageUrl: 'https://etendering.tenderboard.gov.om/product/publicDash' }).contacts.map((c) => c.email), ['bids@tenderboard.gov.om']);
  assert.equal(isNewsLead(tender), false);
  assert.equal(isNewsLead({ ext_id: 'bnc:om_1' }), true);
  // Without a page address nothing is filtered (as before).
  assert.equal(readLeadFromPage(lead, page).contacts.length, 3);
});

console.log(`\n✅ ${passed}/12 scanner feed checks passed`);
if (passed !== 12) process.exit(1);
process.exit(0);
