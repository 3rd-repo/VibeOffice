// What search engines and link previews read of the Start Center, the suite's page (docs/suite.md, Search engines):
// robots.txt points at the sitemap, which lists the page; the page describes itself and names its published address;
// its structured data and welcome list the UI's languages as common/lang.js has them.
//
//   node --test tests/seo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, 'public', rel), 'utf8');
const SITE = 'https://vibeoffice.work/';

test('robots.txt names the sitemap, which lists the Start Center', () => {
  assert.match(read('robots.txt'), new RegExp(`^Sitemap: ${SITE}sitemap\\.xml$`, 'm'));
  assert.deepEqual([...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), [SITE]);
});

test('the Start Center describes itself and names its published address', () => {
  const html = read('index.html');
  assert.match(html, /<meta name="description" content="[^"]{60,}">/);
  assert.ok(html.includes(`<link rel="canonical" href="${SITE}">`));
  assert.ok(html.includes(`<meta property="og:url" content="${SITE}">`));
});

test('the Start Center: its structured data and its welcome list the UI languages of common/lang.js', () => {
  const ctx = { window: {} };
  vm.runInNewContext(read('common/lang.js'), ctx);
  const langs = JSON.parse(JSON.stringify(ctx.window.VO.lang.list())).filter((l) => l.id !== 'auto');   // out of the script's realm
  const html = read('index.html');
  const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.deepEqual(data.inLanguage, langs.map((l) => l.id));
  assert.equal(/<p class="langs" translate="no">([^<]*)<\/p>/.exec(html)[1], langs.map((l) => l.name).join(' · '));
});
