// VO.host (public/common/suite.js), the pages' side of the desktop app's host interface (docs/desktop.md):
// with the desktop host (tests/desktop/host-stub.js) a file Windows starts us with opens in its app and
// no service worker is registered, the version is the app's and links go to the system; in a browser the
// host is 'web'. The update policies (updater/current.json) and what is new (updater/whatsnew.json); versions
// compare by date (VO.compareVersions).
//
//   node --test tests/desktop/host.test.mjs   (needs Chromium with CDP at 127.0.0.1:9222, as tools/shot.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const shot = (page, steps, ...args) => {
  const out = execFileSync('node', [path.join(root, 'tools/shot.mjs'), page, JSON.stringify(steps), ...args], { encoding: 'utf8' });
  const line = out.split('\n').findLast((l) => l.startsWith('js -> '));   // the last step's result
  assert.ok(line, out);
  return { out, r: JSON.parse(JSON.parse(line.slice(6))) };
};
const state = `return JSON.stringify({ path: location.pathname, title: document.title, kind: VO.host.kind,
  platform: VO.host.platform, version: VO.VERSION, newWindow: sessionStorage.newWindow || '', calls: sessionStorage.hostCalls || '', sw: sessionStorage.swRegister || '' });`;

const stubbed = ['--pre', path.join(root, 'tests/desktop/host-stub.js')];
const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;

test('desktop: a window made for a file opens it, from the native side', () => {
  const { out, r } = shot('ledger/', [{ wait: 2500 }, { js: state }], ...stubbed, '--qs', 'doc&file=Budget.csv');
  assert.equal(r.path, '/ledger/');
  assert.match(r.title, /^Budget\.csv/);
  assert.equal(r.kind, 'desktop');
  assert.equal(r.platform, 'windows');
  assert.match(r.calls, /\/ledger\/:host_document \/ledger\/:host_document_bytes/, 'asked what it holds, then took it');
  assert.equal(r.sw, '', 'no service worker in the desktop app');
  assert.equal(r.version, 'v2026.10.11-abc123', 'the desktop build\'s version');
  assert.match(out, /no errors, no external requests/);
});

test('desktop: Open File in the Start Center asks the system\'s Open dialog, and the file opens in its app', () => {
  const { out, r } = shot('', [{ js: `document.getElementById('open').click(); return '1'`, wait: 2500 },
    { js: `return JSON.stringify({ path: location.pathname, title: document.title, newWindow: sessionStorage.newWindow, dialogs: JSON.parse(sessionStorage.dialogs) })` }],
  ...stubbed, '--qs', 'pick=Notes.md');
  assert.equal(r.path, '/quire/', 'Notes.md went to Quire');
  assert.match(r.newWindow, /\/quire\/\?doc$/, 'in a window of its own, made for it');
  assert.match(r.title, /^Notes/);
  assert.deepEqual(r.dialogs, { title: 'Open', all: 'All files VibeOffice opens', quire: 'Documents', ledger: 'Spreadsheets', lectern: 'Presentations' });
  assert.match(out, /no errors, no external requests/);
});

test('desktop: File > Open in an untouched window opens the file there; in a window with a document, in a new one', () => {
  const where = `return JSON.stringify({ path: location.pathname, title: document.title, newWindow: sessionStorage.newWindow || '' })`;
  const blank = shot('quire/', [{ js: `await L.app.openDialog(); ${wait(1500)} ${where}` }], ...stubbed, '--qs', 'new&pick=Notes.md').r;
  assert.deepEqual(blank, { path: '/quire/', title: 'Notes - Quire', newWindow: '' }, 'the blank document gave way');
  const { r } = shot('quire/', [{ js: `L.app.saved = true; L.app.openDialog(); return '1'`, wait: 2000 }, { js: where }], ...stubbed, '--qs', 'new&pick=Report.txt');
  assert.deepEqual(r, { path: '/quire/', title: 'Report - Quire', newWindow: 'http://127.0.0.1:8760/quire/?doc' }, 'a window of its own');
});

test('desktop: a file dropped on a window with a document opens in a new window, with its bytes', () => {
  const { r } = shot('ledger/', [{ wait: 2000 }, { js: `L.app.openFiles([new File(['x,y\\n1,2\\n'], 'Dropped.csv')]); return '1'`, wait: 2500 },
    { js: `return JSON.stringify({ path: location.pathname, title: document.title, newWindow: sessionStorage.newWindow || '' })` }], ...stubbed, '--qs', 'doc&file=Budget.csv');
  assert.deepEqual(r, { path: '/ledger/', title: 'Dropped.csv - Ledger', newWindow: 'http://127.0.0.1:8760/ledger/?doc' });
});

test('desktop: the Start Center lists Recent Files the native side keeps, and opens an unsaved version', () => {
  const names = `[...document.querySelectorAll('#grid .doc')].map((c) => c.querySelector('.name').textContent + (c.querySelector('.unsaved') ? ' (unsaved)' : '') + (c.querySelector('img') ? ' [preview]' : ''))`;
  const { r } = shot('', [{ wait: 1500 }, { js: `sessionStorage.cards = JSON.stringify(${names}); document.querySelector('#grid .rm').click(); ${wait(300)}
    sessionStorage.after = JSON.stringify(${names}); document.querySelector('#grid .doc .name').click(); return '1'`, wait: 2500 },
  { js: `return JSON.stringify({ cards: JSON.parse(sessionStorage.cards), after: JSON.parse(sessionStorage.after), path: location.pathname, recovered: document.body.textContent.includes('Recovered the unsaved changes') })` }],
  ...stubbed, '--qs', 'recent=Other.csv,Budget.csv*');
  assert.deepEqual(r, { cards: ['Other.csv [preview]', 'Budget.csv (unsaved) [preview]'], after: ['Budget.csv (unsaved) [preview]'], path: '/ledger/', recovered: true },
    '× removed Other.csv; Budget.csv opened at its unsaved version');
});

test('desktop: the close button asks the page, which asks to save its changes', () => {
  const ask = (answer) => `L.D.doc.dirty = true; window.dispatchEvent(new Event('vo-close')); ${wait(400)}
    const box = document.querySelector('.msgbox, dialog[open], .dlg'); const text = box ? box.textContent : '';
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${answer}').click(); ${wait(400)}
    return JSON.stringify({ asked: /save the changes/.test(text), closed: sessionStorage.closed || '' })`;
  assert.deepEqual(shot('quire/', [{ wait: 1500 }, { js: ask('Cancel') }], ...stubbed, '--qs', 'new').r, { asked: true, closed: '' }, 'Cancel keeps it');
  assert.deepEqual(shot('quire/', [{ wait: 1500 }, { js: ask('No') }], ...stubbed, '--qs', 'new').r, { asked: true, closed: '/quire/' }, 'No closes it');
});

test('the stub grants each kind of window the commands the desktop app does (desktop/permissions/, capabilities/)', () => {
  const list = (text) => [...text.matchAll(/["'](host_\w+)["']/g)].map((m) => m[1]).sort();
  const perms = {};
  for (const m of fs.readFileSync(path.join(root, 'desktop/permissions/host.toml'), 'utf8').matchAll(/identifier = "([^"]+)"[\s\S]*?commands\.allow = \[([^\]]*)\]/g)) perms[m[1]] = list(m[2]);
  const caps = {};
  for (const f of fs.readdirSync(path.join(root, 'desktop/capabilities'))) {
    const c = JSON.parse(fs.readFileSync(path.join(root, 'desktop/capabilities', f), 'utf8'));
    caps[c.windows.join(' ')] = c.permissions.flatMap((p) => perms[p]).sort();
  }
  const stub = fs.readFileSync(path.join(root, 'tests/desktop/host-stub.js'), 'utf8');
  const grants = (kind) => list(new RegExp(`\\b${kind}: \\[([^\\]]*)\\]`).exec(stub)[1]);
  assert.deepEqual(caps, { main: grants('start'), 'quire-* ledger-* lectern-*': grants('app') });
});

test('desktop: File > Exit closes an app window', () => {
  const { r } = shot('quire/', [{ js: `await VO.exit(); await new Promise((r) => setTimeout(r, 300));
    return JSON.stringify({ closed: sessionStorage.closed || '', path: location.pathname });` }], ...stubbed);
  assert.deepEqual(r, { closed: '/quire/', path: '/quire/' });
});

test('desktop: About > Open source licenses opens the credits page in a window of its own', () => {
  const { r } = shot('', [{ js: `document.getElementById('about').click(); document.getElementById('osslink').click(); return '1'`, wait: 800 },
    { js: `return JSON.stringify({ newWindow: sessionStorage.newWindow || '', title: document.title })` }],
  ...stubbed);
  assert.match(r.newWindow, /\/oss-licenses\.html$/);
  assert.match(r.title, /^Open source licenses/);
});

test('desktop: a link on the licences page shows its address to copy, and goes nowhere', () => {
  const { r } = shot('oss-licenses.html', [{ js: `document.querySelector('.head a').click(); await new Promise((r) => setTimeout(r, 200));
    const d = document.querySelector('dialog');
    return JSON.stringify({ open: d.open, address: d.querySelector('input').value, href: document.querySelector('.head a').href, path: location.pathname });` }],
  ...stubbed);
  assert.deepEqual(r, { open: true, address: r.href, href: r.href, path: '/oss-licenses.html' });
  assert.match(r.href, /^https:/);
});

test('desktop: a window that can\'t be opened is reported, and the Start Center stays', () => {
  const { r } = shot('', [{ js: `let error = ''; try { await VO.go(location.origin + '/updater/'); } catch (e) { error = String(e); }
    await new Promise((r) => setTimeout(r, 300)); return JSON.stringify({ error, path: location.pathname, newWindow: sessionStorage.newWindow || '' });` }],
  ...stubbed);
  assert.deepEqual(r, { error: "not one of the suite's pages: updater", path: '/', newWindow: '' });
});

const saves = `JSON.parse(sessionStorage.saves || '[]')`;
const click = (label) => `[...document.querySelectorAll('.dlg button, .msgbox button')].find((b) => b.textContent.replace(/\\s+/g, ' ').trim() === '${label}').click();`;
const boxText = `[...document.querySelectorAll('.dlg')].map((d) => d.textContent).join(' ')`;

test('desktop: Save writes the window\'s own file in place, without asking', () => {
  const { r } = shot('quire/', [{ wait: 2500 }, { js: `L.D.doc.dirty = true; const r = await L.app.save();
    return JSON.stringify({ r, saves: ${saves}, chose: sessionStorage.chose || '', dirty: L.D.doc.dirty, title: document.title })` }], ...stubbed, '--qs', 'doc&file=Notes.md');
  assert.deepEqual(r.saves.map((w) => [w.cmd, w.replace, w.head]), [['host_save', false, '# ']], 'one write, Markdown into Notes.md');
  assert.deepEqual({ r: r.r, chose: r.chose, dirty: r.dirty, title: r.title }, { r: 'saved', chose: '', dirty: false, title: 'Notes - Quire' });
});

test('desktop: a document without a file asks where, and the file it is saved as becomes its own', () => {
  const { r } = shot('quire/', [{ js: `sessionStorage.stubSave = 'Letter.docx'; L.D.doc.dirty = true; const first = await L.app.save();
    const title = document.title; L.D.doc.dirty = true; const second = await L.app.save();
    return JSON.stringify({ first, second, title, saves: ${saves}, chose: JSON.parse(sessionStorage.chose) })` }], ...stubbed, '--qs', 'new');
  assert.deepEqual([r.first, r.second, r.title], ['saved', 'saved', 'Letter - Quire']);
  assert.deepEqual(r.saves.map((w) => w.cmd + (w.bound ? ' (bound)' : '')), ['host_write_chosen (bound)', 'host_save'], 'Save As, then Save in place');
  assert.equal(r.chose.purpose, 'saveAs');
  assert.equal(r.chose.type, 'docx');
  assert.equal(r.chose.name, 'Document1');
  assert.equal(r.chose.types.length, 10, 'every type Quire saves');
});

test('desktop: a file another program changed asks first, and Replace It saves over it', () => {
  const { r } = shot('quire/', [{ wait: 2500 }, { js: `L.D.doc.dirty = true; const p = L.app.save(); ${wait(500)} const text = ${boxText};
    ${click('Replace It')} const r = await p; return JSON.stringify({ r, text, saves: ${saves} })` }], ...stubbed, '--qs', 'doc&file=Notes.md&fail=changed');
  assert.match(r.text, /“Notes\.md” was changed by another program after you opened it/);
  assert.deepEqual(r.saves.map((w) => [w.cmd, w.replace]), [['host_save', true]]);
  assert.equal(r.r, 'saved');
});

test('desktop: a PDF export asks where, and leaves the document as it was', () => {
  const { r } = shot('quire/', [{ wait: 2500 }, { js: `sessionStorage.stubSave = 'Notes.pdf'; L.D.doc.dirty = true; await L.app.printPDF();
    return JSON.stringify({ saves: ${saves}, chose: JSON.parse(sessionStorage.chose), dirty: L.D.doc.dirty, title: document.title })` }], ...stubbed, '--qs', 'doc&file=Notes.md');
  assert.deepEqual(r.saves.map((w) => [w.cmd, w.type, w.bound]), [['host_write_chosen', 'pdf', false]]);
  assert.deepEqual([r.chose.purpose, r.chose.types.map((t) => t.id)], ['export', ['pdf']]);
  assert.deepEqual([r.dirty, r.title], [true, 'Notes - Quire'], 'still the Markdown file, with its changes');
});

test('Ledger: Cancel in Save As while closing an untitled workbook keeps it open', () => {
  const { r } = shot('ledger/', [{ wait: 1500 }, { js: `const b = L.app.books[0]; b.dirty = true; const p = L.app.closeWorkbook(); ${wait(400)}
    ${click('Yes')} ${wait(400)} ${click('Cancel')} const r = await p;
    return JSON.stringify({ r, same: L.app.books[0] === b, dirty: b.dirty })` }], '--qs', 'new');
  assert.deepEqual(r, { r: false, same: true, dirty: true });
});

test('desktop: openUrl sends the update page and our GitHub to the system, and nothing else', () => {
  const { r } = shot('', [{ js: `await VO.host.openUrl('https://github.com/tcchen2026/VibeOffice');
    const bad = []; for (const url of ['file:///C:/Windows/notepad.exe', 'https://example.com/', 'mailto:someone@example.com', 'https://vibeoffice.work/'])
      try { await VO.host.openUrl(url); } catch (e) { bad.push(String(e)); }
    return JSON.stringify({ opened: sessionStorage.opened, bad });` }], ...stubbed);
  assert.equal(r.opened, 'https://github.com/tcchen2026/VibeOffice');
  assert.equal(r.bad.length, 4);
  for (const e of r.bad) assert.match(e, /not opened/);
});

const settings = `document.getElementById('settings').click(); await new Promise((r) => setTimeout(r, 400));
  const out = { row: !document.getElementById('scalerow').hidden, hint: !document.getElementById('scaleweb').hidden, value: document.getElementById('uiscale').value };
  if (out.row) { const s = document.getElementById('uiscale'); s.value = '2'; s.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 200)); out.saved = sessionStorage.uiScale;
    let bad = ''; try { await VO.host.setUiScale(9); } catch (e) { bad = String(e); } out.bad = bad; }
  return JSON.stringify(out);`;

test('desktop: Settings sets the UI size', () => {
  const { r } = shot('', [{ js: settings }], ...stubbed);
  assert.deepEqual(r, { row: true, hint: false, value: '1', saved: '2', bad: 'UI scale 9 is outside 0.5..4' });
});

test('web: Settings points to the browser\'s zoom', () => {
  const { r } = shot('', [{ js: settings }]);
  assert.deepEqual(r, { row: false, hint: true, value: '1' });
});

const update = `await new Promise((r) => setTimeout(r, 500));
  const out = { button: !document.getElementById('update').hidden, check: !document.getElementById('updatecheck').hidden,
    dialog: document.getElementById('updatedlg').open };
  if (out.dialog) out.news = [...document.querySelectorAll('#updatenews > *')].map((e) => e.textContent);
  if (out.dialog) { const d = document.getElementById('updatedlg'); d.querySelector('button[value=download]').click(); }
  else if (out.button) document.getElementById('update').click();
  else if (out.check) document.getElementById('updatecheck').click();
  await new Promise((r) => setTimeout(r, 200));
  out.opened = sessionStorage.opened || '';
  localStorage.removeItem('vibeoffice.updateAsked');
  return JSON.stringify(out);`;
const stub = path.join(root, 'tests/desktop/host-stub.js');
const URL_ = 'https://vibeoffice.work/updater/?from_version=v2026.10.11-abc123&current_platform=windows';

test('desktop: up to date, no Update button', () => {
  const { r } = shot('', [{ js: update }], '--pre', stub);
  assert.deepEqual(r, { button: false, check: false, dialog: false, opened: '' });
});

test('desktop: show-update-button shows the button, which opens the updater page', () => {
  const { r } = shot('', [{ js: update }], '--pre', stub, '--qs', 'update=button');
  assert.deepEqual(r, { button: true, check: false, dialog: false, opened: URL_ });
});

test('desktop: show-update-dialog asks with a dialog, with what is new', () => {
  const { r } = shot('', [{ js: update }], '--pre', stub, '--qs', 'update=dialog');
  assert.deepEqual(r, { button: true, check: false, dialog: true, opened: URL_,
    news: ['v2026.10.14-000000', 'Fourteenth.', 'v2026.10.12-000000', 'Twelfth.\nSecond line.'] }, 'what is new since this version, newest first');
});

test('the published updater/current.json: a build from 10-08 gets the button, 10-01 the dialog, today\'s nothing', () => {
  for (const [version, want] of [['v2026.10.08-000000', { button: true, dialog: false }], ['v2026.10.01-000000', { button: true, dialog: true }],
    ['v2026.10.11-32d7b2', { button: false, dialog: false }]]) {
    const { r } = shot('', [{ js: update }], '--pre', stub, '--qs', `version=${version}`);
    assert.deepEqual({ button: r.button, dialog: r.dialog }, want, version);
  }
});

test('desktop: a version over two months old offers to check for updates, when current.json asks nothing or cannot be read', () => {
  for (const policy of ['none', 'offline']) {
    const { r } = shot('', [{ js: update }], '--pre', stub, '--qs', `update=${policy}&version=v2026.08.16-000000`);
    assert.deepEqual(r, { button: false, check: true, dialog: false,
      opened: 'https://vibeoffice.work/updater/?from_version=v2026.08.16-000000&current_platform=windows' }, policy);
  }
  const { r } = shot('', [{ js: update }], '--pre', stub, '--qs', 'update=none&version=v2026.08.17-000000');
  assert.deepEqual(r, { button: false, check: false, dialog: false, opened: '' }, 'a day short of two months');
});

test('desktop: when current.json asks for an update, an old version gets the Update button, not Check for updates', () => {
  const { r } = shot('', [{ js: update }], '--pre', stub, '--qs', 'update=button&version=v2026.07.01-000000');
  assert.deepEqual({ button: r.button, check: r.check, opened: r.opened }, { button: true, check: false,
    opened: 'https://vibeoffice.work/updater/?from_version=v2026.07.01-000000&current_platform=windows' });
});

test('desktop: the Mac App Store edition never checks nor offers to, even when current.json asks for a dialog', () => {
  const { r } = shot('', [{ js: update }], '--pre', stub, '--qs', 'appstore&update=dialog&version=v2026.07.01-000000');
  assert.deepEqual(r, { button: false, check: false, dialog: false, opened: '' });
});

test('web: no update check', () => {
  const { r } = shot('', [{ js: update }]);
  assert.deepEqual(r, { button: false, check: false, dialog: false, opened: '' });
});

test('web and the installed PWA: a copy over two months old offers to check for updates', () => {
  const { r } = shot('', [{ js: update }], '--pre', stub, '--qs', 'web&version=v2026.08.16-000000');
  assert.deepEqual(r, { button: false, check: true, dialog: false,
    opened: 'https://vibeoffice.work/updater/?from_version=v2026.08.16-000000&current_platform=web' });
  assert.deepEqual(shot('', [{ js: update }], '--pre', stub, '--qs', 'web&version=v2026.10.01-000000').r,
    { button: false, check: false, dialog: false, opened: '' }, 'two weeks old');
});

test('a version is outdated two calendar months after its day', () => {
  const { r } = shot('', [{ js: `const o = (v, y, m, d) => VO.isOutdated(v, new Date(y, m - 1, d)); return JSON.stringify([
    o('v2026.08.16-abc123', 2026, 10, 16), o('v2026.08.17-abc123', 2026, 10, 16), o('v2026.12.31-abc123', 2027, 3, 2),
    o('v2026.12.31-abc123', 2027, 3, 3), o('2026.08.8f8494', 2026, 10, 1), o('dev', 2099, 1, 1), VO.isOutdated()]);` }]);
  assert.deepEqual(r, [true, false, false, true, true, false, false], 'a dev build is never outdated');
});

test('versions compare by date alone', () => {
  const { r } = shot('', [{ js: `const c = VO.compareVersions; return JSON.stringify({
    older: c('v2026.10.10-ffffff', 'v2026.10.11-000000'), same: c('v2026.10.11-abc123', 'v2026.10.11-def456'),
    newer: c('v2026.11.01-abc123', 'v2026.10.31-abc123'), year: c('v2027.01.01-abc123', 'v2026.12.31-abc123'),
    legacy: c('2026.10.8f8494', 'v2026.10.01-abc123'), upper: c('V2026.10.11-abc123', 'v2026.10.11-def456'), devNewest: c('dev', 'v2099.12.31-abc123'), devDev: c('dev', 'dev'),
    web: VO.VERSION, label: document.querySelector('.version').parentNode.textContent.includes('Ver.') });` }]);
  assert.deepEqual(r, { older: -1, same: 0, newer: 1, year: 1, legacy: -1, upper: 0, devNewest: 1, devDev: 0, web: 'dev', label: false });
});

test('web: the host is the browser', () => {
  const { out, r } = shot('', [{ js: state }]);
  assert.equal(r.kind, 'web');
  assert.equal(r.platform, 'web');
  assert.equal(r.path, '/');
  assert.match(out, /no errors, no external requests/);
});
