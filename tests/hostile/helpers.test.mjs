// The UI tests' t.clean() (tests/lib/input.mjs, tools/ooxml/cdp.mjs) fails on what the pages' Content-Security-Policy
// refuses, on a window a page opens and on a page of another site in the tab. Chromium reports a refusal only to
// its Log domain, not as a console error, so without the helpers' own listener it would pass unnoticed.
//
//   node --test --test-concurrency=1 tests/hostile/helpers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, pause } from '../lib/input.mjs';

/** t.clean()'s failure after `act` (a script run in a fresh Quire), or null */
async function cleanAfter(act) {
  const t = await open('quire', { look: 'classic' });
  try {
    t.clean();
    await t.evaluate(act); await pause(1000);
    try { t.clean(); return null; } catch (e) { return e.message; }
  } finally { await t.close(); }
}

test('an inline handler the policy refuses', async () => {
  assert.match(await cleanAfter(`document.body.insertAdjacentHTML('beforeend', '<img src="data:," onerror="document.title=1">')`),
    /browser errors[\s\S]*\[CSP\] script-src-attr refused inline/);
});

test('a window the page opens', async () => {
  assert.match(await cleanAfter(`(() => { const w = window.open('about:blank#vo-test', '_blank'); if (w) w.close(); })()`), /windows opened[\s\S]*about:blank#vo-test/);
});

test('a page of another site in the tab', async () => {
  assert.match(await cleanAfter(`setTimeout(() => { location.href = 'http://localhost:8760/quire/?new'; }, 0)`), /navigations to another site/);
});
