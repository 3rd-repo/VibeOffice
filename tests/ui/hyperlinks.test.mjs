// A document's hyperlink is never opened by the suite: Ctrl+click and Open Hyperlink (Quire, Ledger) and a click in
// the slide show (Lectern) show its address with a warning and Copy (L.ui.linkDialog), whatever the address, a
// javascript: one too; nothing runs and no window opens. Links within the document still go where they point.
//
//   node --test --test-concurrency=1 tests/ui/hyperlinks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, pause } from '../lib/input.mjs';

const BAD = "javascript:document.title='ran'";
/** the address the dialog shows (null: no dialog), and whether the javascript: link ran */
const dialog = async (t) => JSON.parse(await t.evaluate(`JSON.stringify({ url: document.querySelector('.dlg .link-url')?.value ?? null,
  ran: document.title === 'ran' })`));
const pages = async (t) => (await t.send('Target.getTargets')).targetInfos.filter((x) => x.type === 'page').length;

test('Quire: Ctrl+click and Open Hyperlink show the address to copy, never open it', async () => {
  const t = await open('quire', { look: 'classic' });
  try {
    await t.evaluate(`L.app.openFile(new File([${JSON.stringify(`[Web](https://example.com/) and [Bad](${BAD})\n`)}], 'links.md'))`);
    await pause(800);
    const before = await pages(t);
    const at = (text) => t.evaluate(`(() => { const e = [...document.querySelectorAll('[data-link]')].find((x) => x.textContent.includes(${JSON.stringify(text)}));
      const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await t.click(await at('Bad'), { ctrl: true });
    assert.deepEqual(await dialog(t), { url: BAD, ran: false }, 'Ctrl+click: the address as written, not run');
    await t.click(await t.el('.dlg .dlg-foot .btn.primary'));
    assert.equal(await t.evaluate(`document.querySelector('.dlg .link-copied').textContent`), 'Copied.', 'Copy keeps the dialog and says so');
    await t.key('Escape'); await pause(200);
    assert.equal((await dialog(t)).url, null, 'Escape closes it');
    await t.click(await at('Web'), { button: 'right' }); await pause(200);
    await t.click(await t.evaluate(`(() => { const e = [...document.querySelectorAll('.m-item')].find((x) => /Open Hyperlink/.test(x.textContent));
      const b = e.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; })()`));
    assert.deepEqual(await dialog(t), { url: 'https://example.com/', ran: false }, 'Open Hyperlink');
    await t.key('Escape'); await pause(200);
    assert.equal(await pages(t), before, 'no window or tab opened');
    t.clean();
  } finally { await t.close(); }
});

test('Ledger: Open Hyperlink shows a web, mail or file address to copy; a reference in the workbook still goes there', async () => {
  const t = await open('ledger', { look: 'classic' });
  try {
    for (const target of [BAD, 'mailto:someone@example.com', 'C:\\Reports\\Q3.xlsx']) {
      await t.evaluate(`L.app.followLink({ target: ${JSON.stringify(target)} })`); await pause(200);
      assert.deepEqual(await dialog(t), { url: target, ran: false }, target);
      await t.key('Escape'); await pause(200);
    }
    await t.evaluate(`L.app.followLink({ location: 'C5' })`); await pause(200);
    assert.equal((await dialog(t)).url, null, 'a reference in the workbook: no dialog');
    t.clean();
  } finally { await t.close(); }
});

test('Lectern: a link clicked in the slide show shows its address over the show, which goes on', async () => {
  const t = await open('lectern', { look: 'classic' });
  try {
    await t.evaluate(`(async () => { const E = L.ed, M = L.model; if (L.te.active()) L.te.end(); E.goto(0);
      const slide = L.pres.slides[0], b = M.newTextBox(L.pres, slide, 100, 100, 500, 80, true); b.id = 'linkBox';
      b.tx.ps = [{ lvl: 0, pp: {}, rs: [{ t: 'A linked box.' }] }]; b.link = { url: ${JSON.stringify(BAD)} };
      slide.shapes = [b]; E.sel = []; E.render(); L.show.start({}); await new Promise((r) => setTimeout(r, 800)); })()`);
    await t.click(await t.el('.has-link'));
    assert.deepEqual(await dialog(t), { url: BAD, ran: false }, 'the click reaches the link (the ink layer let it through)');
    assert.equal(await t.evaluate(`!document.fullscreenElement || document.fullscreenElement.contains(document.querySelector('.dlg'))`), true,
      'in full screen, the dialog is inside it');
    await t.click(await t.el('.dlg .dlg-foot .btn:not(.primary)'));
    assert.equal((await dialog(t)).url, null, 'Close closes the dialog');
    assert.deepEqual(JSON.parse(await t.evaluate(`JSON.stringify({ active: L.show.active, link: !!document.querySelector('.show .has-link') })`)),
      { active: true, link: true }, 'and the show stays on the slide: the click was the dialog\'s');
    await t.click(await t.el('.has-link'), { button: 'right' }); await pause(200);
    assert.equal(await t.evaluate(`!!document.querySelector('.menu') && (!document.fullscreenElement || document.fullscreenElement.contains(document.querySelector('.menu')))`),
      true, 'the show\'s menu shows, in full screen too');
    await t.key('Escape'); await pause(200);
    // in full screen the browser keeps Escape to leave it; out of it, the show hands the keys to the dialog
    await t.evaluate('document.exitFullscreen().catch(() => {})'); await pause(400);
    await t.click(await t.el('.has-link'));
    await t.key('Escape'); await pause(300);
    assert.equal((await dialog(t)).url, null, 'Escape closes the dialog');
    assert.equal(await t.evaluate('L.show.active'), true, 'and not the show');
    await t.key('Escape'); await pause(500);
    t.clean();
  } finally { await t.close(); }
});
