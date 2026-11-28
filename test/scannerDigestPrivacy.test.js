/**
 * Market Scanner — what the open /api/scanner endpoints may send to a browser.
 *
 * The scanner API has no login, so anything it returns is readable by every visitor of the
 * deployed site. These checks pin the two places where private values are stored next to
 * public ones: the digest settings (webhook address, e-mail) and archived digest rows
 * (the address a digest was mailed to).
 *
 * Pure functions only: no database, network or AI calls.   Run: node test/scannerDigestPrivacy.test.js
 */
import assert from 'node:assert/strict';
import {
  toPublicDigestConfig,
  mergeDigestConfig,
  toPublicDigestRow,
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

const SAVED = {
  enabled: true,
  auto_enrich: true,
  email: 'owner@example.test',
  min_score: 60,
  schedule_time: '08:00',
  timezone: 'Asia/Muscat',
  webhook_url: 'https://hooks.example.test/services/T000/B000/secret-token',
};

await test('1. Public digest settings never carry the webhook address or the stored e-mail', () => {
  const pub = toPublicDigestConfig(SAVED);
  assert.equal(pub.webhook_url, '');
  assert.equal(pub.webhook_set, true);
  assert.equal(pub.webhook_host, 'hooks.example.test');
  const sent = JSON.stringify(pub);
  assert.ok(!sent.includes('secret-token'), 'webhook path leaked');
  assert.ok(!sent.includes('owner@example.test'), 'e-mail leaked');
  assert.deepEqual(
    Object.keys(pub).sort(),
    ['auto_enrich_top', 'enabled', 'schedule_note', 'webhook_host', 'webhook_set', 'webhook_url'],
  );
});

await test('2. Public digest settings report "no webhook" for empty, missing or unreadable values', () => {
  for (const cfg of [{}, undefined, null, { webhook_url: '' }, { webhook_url: '   ' }]) {
    const pub = toPublicDigestConfig(cfg);
    assert.equal(pub.webhook_set, false);
    assert.equal(pub.webhook_host, '');
    assert.equal(pub.enabled, true);
  }
  const odd = toPublicDigestConfig({ webhook_url: 'not a url' });
  assert.equal(odd.webhook_set, true);
  assert.equal(odd.webhook_host, '');
  assert.equal(odd.webhook_url, '');
});

await test('3. Saving with the webhook field left empty keeps the saved address and the other saved keys', () => {
  // This is what the screen posts after loading the public settings: webhook_url is always ''.
  const merged = mergeDigestConfig(SAVED, { ...toPublicDigestConfig(SAVED), enabled: false });
  assert.equal(merged.webhook_url, SAVED.webhook_url);
  assert.equal(merged.enabled, false);
  assert.equal(merged.email, SAVED.email);
  assert.equal(merged.schedule_time, '08:00');
  assert.equal(merged.min_score, 60);
  // Display-only fields from the public view are not written back as settings of their own.
  assert.equal(toPublicDigestConfig(merged).webhook_host, 'hooks.example.test');
});

await test('4. A newly typed address replaces the saved one', () => {
  const merged = mergeDigestConfig(SAVED, { webhook_url: '  https://discord.example.test/api/webhooks/1/abc  ' });
  assert.equal(merged.webhook_url, 'https://discord.example.test/api/webhooks/1/abc');
  assert.equal(mergeDigestConfig({}, { webhook_url: 'http://localhost:9999/hook' }).webhook_url, 'http://localhost:9999/hook');
});

await test('5. clear_webhook removes the saved address even if the field still holds text', () => {
  assert.equal(mergeDigestConfig(SAVED, { webhook_url: '', clear_webhook: true }).webhook_url, '');
  assert.equal(mergeDigestConfig(SAVED, { webhook_url: 'https://x.example.test/h', clear_webhook: true }).webhook_url, '');
  // Only a real boolean true clears: a stray string must not wipe the setting.
  assert.equal(mergeDigestConfig(SAVED, { clear_webhook: 'true' }).webhook_url, SAVED.webhook_url);
});

await test('6. An address that is not http(s) is refused with status 400', () => {
  for (const bad of ['hooks.example.test/services/x', 'javascript:alert(1)', 'ftp://example.test/x', 'https://exa mple.test/x']) {
    assert.throws(
      () => mergeDigestConfig(SAVED, { webhook_url: bad }),
      (err) => err.status === 400 && /https:\/\//.test(err.message),
      `accepted: ${bad}`,
    );
  }
});

await test('7. First save on an empty store produces the default settings shape', () => {
  const merged = mergeDigestConfig(undefined, {});
  assert.deepEqual(merged, {
    enabled: true,
    auto_enrich_top: true,
    webhook_url: '',
    schedule_note: 'On-demand & 12h observer',
  });
  assert.equal(mergeDigestConfig({}, { auto_enrich_top: false }).auto_enrich_top, false);
});

await test('8. Archived digest rows hide the mailed-to address but keep channel labels and content', () => {
  const mailed = toPublicDigestRow({ id: 4, title: 'Top 10', recipient: 'owner@example.test', summary_text: '# Top 10', dispatched: true });
  assert.equal(mailed.recipient, 'Email');
  assert.equal(mailed.digest_md, '# Top 10');
  assert.equal(mailed.dispatched, true);
  assert.ok(!JSON.stringify(mailed).includes('owner@example.test'));
  assert.equal(toPublicDigestRow({ recipient: 'Webhook' }).recipient, 'Webhook');
  assert.equal(toPublicDigestRow({ recipient: 'BOQ Flow Dashboard' }).recipient, 'BOQ Flow Dashboard');
  assert.equal(toPublicDigestRow({}).recipient, '');
  assert.equal(toPublicDigestRow({}).digest_md, '');
});

console.log(`\n✅ ${passed}/8 scanner digest privacy checks passed`);
if (passed !== 8) process.exit(1);
process.exit(0);
