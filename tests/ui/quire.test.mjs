// Quire with real mouse and keyboard input (tests/lib/input.mjs). A test named after an audit item (Q1…) checks what
// Word does there and stays `todo` until the item is fixed (todos/UI_MOUSE_LOGIC_IMPROVE.md); the rest must pass.
//
//   node --test --test-concurrency=1 tests/ui/*.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { open, pause } from '../lib/input.mjs';

let t;
before(async () => { t = await open('quire'); });
after(async () => { await t?.close(); });

/** screen point just inside the character at offset o of block b of the body */
const at = (b, o) => t.evaluate(`(() => { const p = L.D.doc.main.blocks[${b}], m = L.layout.posToDom(L.D.pos(p, ${o})), r = document.createRange();
  r.setStart(m.node, m.offset); r.collapse(true); const box = r.getClientRects()[0] || r.getBoundingClientRect(); return { x: box.left + 1, y: box.top + box.height / 2 }; })()`);
/** [text, has prop] for each run of block b */
const runs = (b, prop) => t.evaluate(`L.D.doc.main.blocks[${b}].runs.map((r) => [r.text, !!(r.rPr && r.rPr.${prop})])`);
/** a new document of plain paragraphs (strings) or runs ([[text, rPr], …]); the caret at the start, no brush on */
const load = (paras) => t.evaluate(`(async () => {
  const { D } = L, d = D.newDoc();
  d.main.blocks = ${JSON.stringify(paras)}.map((p) => D.para(typeof p === 'string' ? [D.text(p)] : p.map(([s, r]) => D.text(s, r || {}))));
  L.app.loadDoc(d, 'UI test');
  L.ui.brushOn?.()?.stop(); /* no brush left on (older code has no brushes: nothing to do) */
  await new Promise((r) => setTimeout(r, 500));
  const p = d.main.blocks[0]; L.ed.setSel(D.pos(p, 0)); L.ed.focus();
})()`);
const TEXT = [[['Source', { b: true }], [' plain target words follow here']], 'Second paragraph of ordinary text for clicking',
  'Third paragraph with more words to paint'];

test('the highlighter marks the whole drag, as one undo step', async () => {
  await load(TEXT);
  await t.evaluate(`L.app.applyHighlight('yellow')`);
  const undo0 = await t.evaluate('L.D.histState().undo.length');
  await t.drag(await at(0, 7), await at(0, 25));
  assert.deepEqual(await runs(0, 'hl'), [['Source', false], [' ', false], ['plain target words', true], [' follow here', false]]);
  assert.equal(await t.evaluate('L.D.histState().undo.length') - undo0, 1, 'one undo step');
  await t.esc();
  assert.equal(await t.painting(), false, 'Esc puts the highlighter down');
});

for (const leave of ['a click into text', 'Esc']) {
  test(`a drawn shape's handles go after ${leave}, and a click selects it again`, async () => {
    const handles = () => t.evaluate(`({ handles: document.querySelectorAll('.obj-handles').length, outlined: document.querySelectorAll('.sel-obj').length, selected: !!L.ed.objSel })`);
    await load(TEXT);
    await t.evaluate(`L.ui.exec('drawRect')`);
    const corner = await at(1, 10);
    await t.drag({ x: corner.x + 300, y: corner.y + 40 }, { x: corner.x + 400, y: corner.y + 120 }, 4);
    assert.deepEqual(await handles(), { handles: 1, outlined: 1, selected: true }, 'the drawn shape is selected');
    if (leave === 'Esc') await t.esc(); else await t.click(await at(1, 5));
    assert.deepEqual(await handles(), { handles: 0, outlined: 0, selected: false }, 'no handles');
    await t.click({ x: corner.x + 350, y: corner.y + 80 });
    assert.deepEqual(await handles(), { handles: 1, outlined: 1, selected: true }, 'selected again');
  });
}

/* ---------- the audit (todos/UI_MOUSE_LOGIC_IMPROVE.md, Audit › Quire): one test per item, each in a tab of its own,
   so a failing one leaves no dialog, menu or focus behind ---------- */

/** fn(u) in a new Quire tab on a document made by `build` (page code; D, and d the new document, in scope; it may
    await), the caret at the start; then no browser errors */
async function inQuire(build, fn, opts) {
  const u = await open('quire', opts);
  try {
    await u.evaluate(`(async () => {
      const { D } = L, d = D.newDoc();
      ${build}
      L.app.loadDoc(d, 'UI test');
      await new Promise((r) => setTimeout(r, 600));
      const p = D.firstPara(d.main.blocks); L.ed.setSel(D.pos(p, 0)); L.ed.focus();
    })()`);
    await fn(u);
    u.clean();
  } finally { await u.close(); }
}
/* documents (page code for inQuire) */
const PARAS = (list) => `d.main.blocks = ${JSON.stringify(list)}.map((s) => D.para([D.text(s)]));`;
/** a floating rectangle in front of the text, on page 1, anchored at the start of block b */
const SHAPE = (b) => `{ const it = L.drawing.newShape('rect', 90, 60); L.drawing.setWrap(it, 'none'); it.name = 'Rectangle 1';
  it.float.posH = { rel: 'page', off: 330 }; it.float.posV = { rel: 'page', off: 200 }; d.main.blocks[${b}].runs.unshift(it); }`;
/** an inline picture (100 × 60 pt) at offset o of block b */
const PICTURE = (b, o) => `{ const c = document.createElement('canvas'); c.width = 133; c.height = 80; const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 133, 80);
  const id = L.media.add(await new Promise((r) => c.toBlob(r, 'image/png')), 'pic.png'); const p = d.main.blocks[${b}], s = p.runs[0].text;
  p.runs = [D.text(s.slice(0, ${o})), D.item('img', { media: id, w: 100, h: 60, name: 'pic.png', alt: '' }), D.text(s.slice(${o}))]; }`;
/** a 2 × 2 table, "cell 00 text" …, inserted as block b */
const TABLE = (b) => `{ const tb = D.simpleTable(2, 2, 432); tb.rows.forEach((r, i) => r.cells.forEach((c, j) => { c.blocks = [D.para([D.text('cell ' + i + j + ' text')])]; }));
  d.main.blocks.splice(${b}, 0, tb); }`;
const HEADER = `d.hf.h1 = { kind: 'hdr', id: 'h1', blocks: [D.para([D.text('Header text')], { style: 'Header' })] }; d.sect.refs = { hdr: { default: 'h1' }, ftr: {} };`;
/* what the user sees */
/** screen point just inside the character at offset o of paragraph p (page code; B is the body's blocks) */
const pointIn = (u, p, o) => u.evaluate(`(() => { const B = L.D.doc.main.blocks, m = L.layout.posToDom(L.D.pos(${p}, ${o})), r = document.createRange();
  r.setStart(m.node, m.offset); r.collapse(true); const box = r.getClientRects()[0] || r.getBoundingClientRect(); return { x: box.left + 1, y: box.top + box.height / 2 }; })()`);
const atB = (u, b, o) => pointIn(u, `B[${b}]`, o);
/** a point in the left margin (the selection bar) beside the line at offset o of block b */
const margin = async (u, b, o) => { const p = await atB(u, b, o); return { x: p.x - 30, y: p.y }; };
/** the body: paragraph texts, a table as rows of cell texts */
const body = (u) => u.evaluate(`L.D.doc.main.blocks.map((b) => b.t === 'tbl' ? b.rows.map((r) => r.cells.map((c) => c.blocks.map((x) => L.D.ptext(x)).join('/'))) : L.D.ptext(b))`);
/** the text the selection covers (paragraphs joined by \n), what typing replaces */
const selected = (u) => u.evaluate(`(() => { const s = L.ed.sel; if (!s) return ''; const [a, b] = L.D.order(L.D.doc, s.a, s.f);
  return L.D.parasBetween(L.D.doc, a.p, b.p).map((p) => L.D.ptext(p, p === a.p ? a.o : 0, p === b.p ? b.o : L.D.plen(p))).join('\\n'); })()`);
/** the body block the selection ends in */
const selBlock = (u) => u.evaluate('L.D.doc.main.blocks.indexOf(L.ed.sel.f.p)');
/** the text highlighted in the page */
const highlighted = (u) => u.evaluate('String(getSelection())');
const undoSteps = (u) => u.evaluate('L.D.histState().undo.length');
const shapes = (u) => u.evaluate(`document.querySelectorAll('#pages .flt').length`);
const editingHeader = (u) => u.evaluate(`L.layout.root.classList.contains('hfmode')`);
const near = (a, b) => Math.abs(a.l - b.l) < 1 && Math.abs(a.t - b.t) < 1 && Math.abs(a.r - b.r) < 1 && Math.abs(a.b - b.b) < 1;
const FIND = ['Alpha beta gamma.', 'Second beta paragraph.', 'Third beta paragraph.'];
test('Q1 Find Next keeps the keyboard in the Find box: a second Enter finds the next match and never edits the text', { todo: 'Phase 1' }, () => inQuire(PARAS(FIND), async (u) => {
  await u.key('f', { ctrl: true }); await pause(300);
  await u.type('beta');
  await u.key('Enter'); await u.key('Enter');
  assert.deepEqual(await body(u), FIND, 'the document is unchanged');
  assert.equal(await u.focused(), 'fr-find', 'the Find box has the keyboard');
  assert.deepEqual([await selBlock(u), await selected(u)], [1, 'beta'], 'the second "beta" is selected');
  await u.esc();
}));

const SHAPE_DOC = ['First paragraph of ordinary text for clicking.', 'Second paragraph of ordinary text.', 'Third paragraph.'];
test('Q2 Enter or Tab on a selected floating shape keeps the shape and leaves the text alone', { todo: 'Phase 1' }, () => inQuire(PARAS(SHAPE_DOC) + SHAPE(1), async (u) => {
  for (const k of ['Enter', 'Tab']) {
    await u.click(await atB(u, 0, 5));
    await u.click(await u.el('#pages .flt'));
    await u.key(k);
    assert.equal(await shapes(u), 1, `the shape is still there after ${k}`);
    assert.deepEqual(await body(u), SHAPE_DOC, `${k} puts no paragraph or tab into the text`);
  }
}));

const PLACEHOLDER = `d.main.blocks = [D.para([D.text('Dear '), D.item('fb', { fid: 'f1', instr: ' MACROBUTTON  DoFieldClick [Click here and type name] ' }), D.item('fs', { fid: 'f1' }),
  D.text('[Click here and type name]'), D.item('fe', { fid: 'f1' }), D.text(', thank you for the long letter you sent.')]), D.para([D.text('Second paragraph.')])];`;
test('Q3 a drag that starts inside a template placeholder selects from there, and never moves the placeholder', { todo: 'Phase 1' }, () => inQuire(PLACEHOLDER, async (u) => {
  const before = await body(u), undo0 = await undoSteps(u);
  await u.click(await atB(u, 1, 3));
  await u.drag(await atB(u, 0, 15), await atB(u, 0, 45));   // from "[Click he|re" to "thank you fo|r"
  assert.deepEqual(await body(u), before, 'the text is where it was');
  assert.equal(await undoSteps(u), undo0, 'nothing to undo');
  assert.match(await selected(u), /, thank you/, 'the selection runs from the placeholder to where the mouse was let go');
}));

const DND = ['Alpha beta gamma delta.', 'Second paragraph of ordinary text.', 'Third paragraph.'];
test('Q4 after a text drag dropped outside the document, text dragged in from the font box is inserted and nothing else moves', { todo: 'Phase 5' }, () => inQuire(PARAS(DND), async (u) => {
  await u.drag(await atB(u, 0, 6), await atB(u, 0, 10), 4);         // select "beta"
  await u.drag(await atB(u, 0, 7), await u.el('#statusbar'), 10);   // drop it on the status bar: nothing happens
  assert.equal((await body(u))[0], DND[0], 'a drop outside the document changes nothing');
  const box = await u.el('#tb-font');
  await u.click(box);                                               // the font's name is selected in its box
  const name = await u.evaluate(`document.querySelector('#tb-font').value`);
  await u.drag(box, await atB(u, 2, 6), 12);                        // and dragged into "Third |paragraph."
  const text = await body(u);
  assert.equal(text[0], DND[0], '"beta" stays where it is');
  assert.ok(name && text[2].includes(name), `the name "${name}" is in the third paragraph: "${text[2]}"`);
}));

test('Q5 a word moved forward in its paragraph: typing next goes at the moved word', { todo: 'Phase 5' }, () => inQuire(PARAS(['Alpha beta gamma delta epsilon zeta eta theta.', 'Second paragraph.']), async (u) => {
  await u.drag(await atB(u, 0, 6), await atB(u, 0, 11), 4);    // "beta "
  await u.drag(await atB(u, 0, 7), await atB(u, 0, 23), 10);   // dropped before "epsilon"
  assert.equal((await body(u))[0], 'Alpha gamma delta beta epsilon zeta eta theta.', 'moved');
  await u.type('X');
  /* Word selects the moved text, so X replaces it; X just after it would do too */
  assert.match((await body(u))[0], /^Alpha gamma delta (beta )?Xepsilon zeta eta theta\.$/);
}));

const FOCUS = ['First paragraph of text.', 'Second paragraph of ordinary text.', 'Third paragraph.'];
const FOCUS_Z = ['First paragraph of text.', 'Second Z of ordinary text.', 'Third paragraph.'];
for (const [id, close, how] of [['Q6a', 'Escape', 'Esc'], ['Q6b', 'Enter', 'Enter (OK)']]) {
  test(`${id} the Font dialog (Ctrl+D) closed with ${how}: the selection is kept and typing replaces it`, { todo: 'Phase 3' }, () => inQuire(PARAS(FOCUS), async (u) => {
    await u.drag(await atB(u, 1, 7), await atB(u, 1, 16), 6);   // "paragraph"
    await u.key('d', { ctrl: true }); await pause(300);
    assert.ok(await u.el('.dlg'), 'the Font dialog is open');
    await u.key(close); await pause(200);
    await u.type('Z');
    assert.deepEqual(await body(u), FOCUS_Z);
  }));
}
test('Q6c View ▸ Ruler chosen with the mouse: typing still goes to the document, replacing the selection', { todo: 'Phase 3' }, () => inQuire(PARAS(FOCUS), async (u) => {
  await u.drag(await atB(u, 1, 7), await atB(u, 1, 16), 6);
  try {
    await u.menu('View', 'Ruler');
    await u.type('Z');
    assert.deepEqual(await body(u), FOCUS_Z);
  } finally {   // the ruler setting is kept for the profile: put it back
    await u.evaluate(`if (!L.app.opts.ruler) { L.app.opts.ruler = true; L.app.saveOpts(); L.app.updateRulers(); }`);
  }
}, { look: 'classic' }));
test('Q6d Format ▸ Paragraph… from the menu bar, closed with Esc: typing replaces the selection', { todo: 'Phase 3' }, () => inQuire(PARAS(FOCUS), async (u) => {
  await u.drag(await atB(u, 1, 7), await atB(u, 1, 16), 6);
  await u.menu('Format', 'Paragraph');
  assert.ok(await u.el('.dlg'), 'the Paragraph dialog is open');
  await u.esc(); await pause(200);
  await u.type('Z');
  assert.deepEqual(await body(u), FOCUS_Z);
}, { look: 'classic' }));

const SHORT = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} with some words.`);
const LONG = Array.from({ length: 70 }, (_, i) => `Paragraph ${i} with some words.`);
/** page i's header (client px) */
const hdrBox = (u, i) => u.evaluate(`(() => { const r = document.querySelectorAll('#pages .pg')[${i}].querySelector('.pg-hdr').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, y: r.top + r.height / 2 }; })()`);
/** scroll page i to the top of the window, as the scroll bar would */
const toPage = (u, i) => u.evaluate(`(async () => { document.querySelectorAll('#pages .pg')[${i}].scrollIntoView({ block: 'start' }); await new Promise((r) => setTimeout(r, 300)); })()`);
/** the body block the text of page i starts with */
const firstOnPage = (u, i) => u.evaluate(`L.D.doc.main.blocks.indexOf(L.D.byId(L.D.doc, +document.querySelectorAll('#pages .pg')[${i}].querySelector('.pg-body .p').dataset.pid))`);

test('Q7 while the header is edited, a click on the dimmed body text leaves the body alone (Enter, Delete, Backspace, letters)', { todo: 'Phase 4' }, () => inQuire(PARAS(SHORT) + HEADER, async (u) => {
  const h = await hdrBox(u, 0);
  await u.dblclick({ x: h.r - 40, y: h.y });
  assert.ok(await editingHeader(u), 'editing the header');
  await u.click(await atB(u, 3, 4));
  for (const k of ['Enter', 'Delete', 'Backspace']) await u.key(k);
  await u.type('Q');
  assert.deepEqual(await body(u), SHORT, 'the body is not edited');
}));

test('Q8a a double-click on page 2\'s header opens it there: the view stays on page 2, the caret where double-clicked', { todo: 'Phase 4' }, () => inQuire(PARAS(LONG) + HEADER, async (u) => {
  await toPage(u, 1);
  const h = await hdrBox(u, 1);
  await u.dblclick({ x: h.r - 40, y: h.y });   // to the right of "Header text"
  assert.ok(await editingHeader(u), 'editing the header');
  const sc = await u.el('#scroller'), h2 = await hdrBox(u, 1);
  assert.ok(h2.t >= sc.t && h2.b <= sc.b, `page 2's header is still on screen (at ${Math.round(h2.t)}, the window ${Math.round(sc.t)}–${Math.round(sc.b)})`);
  await u.type('H');
  assert.equal(await u.evaluate(`L.D.ptext(L.D.doc.hf.h1.blocks[0])`), 'Header textH', 'typing goes where the double-click was');
}));
test('Q8b Esc closes the header and the caret is back where it was in the body', { todo: 'Phase 4' }, () => inQuire(PARAS(LONG) + HEADER, async (u) => {
  await toPage(u, 1);
  const n = (await firstOnPage(u, 1)) + 3;
  await u.click(await atB(u, n, 4));
  const h = await hdrBox(u, 1);
  await u.dblclick({ x: h.r - 40, y: h.y });
  assert.ok(await editingHeader(u), 'editing the header');
  await u.esc();
  assert.equal(await editingHeader(u), false, 'Esc closes the header');
  await u.type('Z');
  assert.equal((await body(u))[n], `ParaZgraph ${n} with some words.`);
}));
test('Q8c a double-click on the body closes the header, with the caret where double-clicked', { todo: 'Phase 4' }, () => inQuire(PARAS(SHORT) + HEADER, async (u) => {
  const h = await hdrBox(u, 0);
  await u.dblclick({ x: h.r - 40, y: h.y });
  assert.ok(await editingHeader(u), 'editing the header');
  const line = await atB(u, 3, 0), pageBody = await u.el('#pages .pg .pg-body');
  await u.dblclick({ x: pageBody.r - 30, y: line.y });   // to the right of "Paragraph 3 with some words."
  assert.equal(await editingHeader(u), false, 'the header is closed');
  await u.type('Z');
  assert.equal((await body(u))[3], 'Paragraph 3 with some words.Z');
}));
test('Q8d a double-click in the top margin opens the (empty) header for editing', { todo: 'Phase 4' }, () => inQuire(PARAS(SHORT), async (u) => {
  const m = await u.evaluate(`(() => { const p = document.querySelector('#pages .pg'), pr = p.getBoundingClientRect(), b = p.querySelector('.pg-body').getBoundingClientRect(); return { x: b.left + 100, y: (pr.top + b.top) / 2 }; })()`);
  await u.dblclick(m);
  assert.ok(await editingHeader(u), 'editing the header');
  await u.type('H');
  assert.match(await u.evaluate(`document.querySelector('#pages .pg .pg-hdr').textContent`), /H/, 'the typed text is in the header');
  assert.deepEqual(await body(u), SHORT, 'the body is not edited');
}));

test('Q9 a right-click in a table cell, the caret outside the table: the first menu already has the table commands', { todo: 'Phase 4' }, () => inQuire(PARAS(['First paragraph of text.', 'Second paragraph.']) + TABLE(1), async (u) => {
  await u.click(await atB(u, 0, 3));
  await u.rightClick(await pointIn(u, 'B[1].rows[0].cells[0].blocks[0]', 3));
  assert.ok((await u.menuItems()).includes('Table Properties...'), `the menu: ${(await u.menuItems()).join(', ')}`);
  await u.esc();
}));

const PIC = ['First paragraph of text.', 'Picture here and text after it.', 'Third paragraph with words.'];
test('Q10 a right-click on a picture, selected or not, selects it (handles shown) and offers Picture…', { todo: 'Phase 4' }, () => inQuire(PARAS(PIC) + PICTURE(1, 5), async (u) => {
  const handles = () => u.evaluate(`document.querySelectorAll('.obj-handles').length`);
  const pic = await u.el('#pages .img');
  await u.click(pic);
  assert.equal(await handles(), 1, 'a click selects the picture');
  await u.rightClick(pic);
  assert.equal(await handles(), 1, 'a selected picture keeps its handles');
  assert.ok((await u.menuItems()).includes('Picture...'), 'the menu has Picture...');
  await u.esc();
  await u.click(await atB(u, 0, 3));
  await u.rightClick(pic);
  assert.equal(await handles(), 1, 'an unselected picture is selected by the right-click');
  assert.ok((await u.menuItems()).includes('Picture...'), 'the menu has Picture...');
  await u.esc();
}));

test('Q11 Ctrl+click selects the sentence clicked, so typing replaces it', { todo: 'Phase 4' }, () => inQuire(PARAS(['First sentence here. Second sentence follows. Third one ends it.', 'Another paragraph.']), async (u) => {
  await u.click(await atB(u, 0, 3));
  await u.click(await atB(u, 0, 50), { ctrl: true });   // in "Third one ends it."
  await u.type('X');
  assert.equal((await body(u))[0], 'First sentence here. Second sentence follows. X');
}));

const ALPHA = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.';
const SELBAR = [`${ALPHA} ${ALPHA} ${ALPHA}`, 'Second paragraph here. It has two sentences.', 'Third paragraph text.'];
test('Q12a a drag down the selection bar selects whole lines, down to the line at the pointer', { todo: 'Phase 5' }, () => inQuire(PARAS(SELBAR), async (u) => {
  await u.drag(await margin(u, 0, 0), await margin(u, 1, 0), 10);
  const s = await selected(u);
  assert.ok(s.startsWith('Alpha beta') && s.includes('It has two sentences.'), `selected: "${s.slice(0, 30)}…${s.slice(-30)}"`);
}));
test('Q12b Shift+click in the selection bar extends the selection to that line', { todo: 'Phase 5' }, () => inQuire(PARAS(SELBAR), async (u) => {
  await u.click(await atB(u, 2, 5));
  await u.click(await margin(u, 0, 0), { shift: true });
  const s = await selected(u);
  assert.ok(s.startsWith('Alpha beta') && s.includes('Second paragraph here') && s.endsWith('Third'), `selected: "${s.slice(0, 30)}…${s.slice(-30)}"`);
}));
test('Q12c a triple-click in the selection bar selects the whole document', { todo: 'Phase 5' }, () => inQuire(PARAS(SELBAR), async (u) => {
  await u.clicks(await margin(u, 1, 0), 3);
  const s = await selected(u);
  assert.ok(s.startsWith('Alpha beta') && s.includes('Third paragraph text.'), `selected: "${s.slice(0, 30)}…${s.slice(-30)}"`);
}));

test('Q13 a click that doesn\'t move on an indent marker, a tab stop or the rotate handle changes nothing', { todo: 'Phase 2' },
  () => inQuire(PARAS(SHAPE_DOC) + `d.main.blocks[0].pPr = { ind: { l: 25, fl: 0 }, tabs: [{ pos: 100, al: 'left' }] };` + SHAPE(1), async (u) => {
    await u.click(await atB(u, 0, 5));
    const pPr = () => u.evaluate(`JSON.stringify(L.D.doc.main.blocks[0].pPr)`);
    const before = await pPr(), undo0 = await undoSteps(u);
    await u.click(await u.el('.rmark.ind-left'));
    await u.click(await u.el('.rmark.tabstop'));
    assert.equal(await pPr(), before, 'the indent and the tab stop are where they were');
    assert.equal(await undoSteps(u), undo0, 'nothing to undo after the ruler clicks');
    await u.click(await u.el('#pages .flt'));
    await u.click(await u.el('.obj-handles .oh-rot'));
    assert.equal(await undoSteps(u), undo0, 'nothing to undo after the rotate handle click');
  }));

test('Q14a Esc while a shape is being drawn (button still down) cancels it: nothing is inserted', { todo: 'Phase 2' }, () => inQuire(PARAS(SHAPE_DOC), async (u) => {
  await u.click(await u.button('drawRect'));
  const a = await atB(u, 1, 10), from = { x: a.x + 300, y: a.y + 40 }, to = { x: a.x + 400, y: a.y + 120 };
  await u.press(from); await u.glide(from, to, 5);
  await u.esc();
  await u.release(to);
  assert.equal(await shapes(u), 0, 'no shape');
  assert.equal(await u.evaluate(`document.querySelectorAll('.draw-ghost').length`), 0, 'no outline left');
}, { look: 'classic' }));
test('Q14b Esc while a shape is being moved cancels the move', { todo: 'Phase 2' }, () => inQuire(PARAS(SHAPE_DOC) + SHAPE(1), async (u) => {
  const b0 = await u.el('#pages .flt > *'), to = { x: b0.x + 80, y: b0.y + 60 }, undo0 = await undoSteps(u);
  await u.press(b0); await u.glide(b0, to, 6);
  await u.esc();
  await u.release(to);
  assert.ok(near(await u.el('#pages .flt > *'), b0), 'the shape is where it was');
  assert.equal(await undoSteps(u), undo0, 'nothing to undo');
}));
test('Q14c Esc while a picture is being resized cancels the resize', { todo: 'Phase 2' }, () => inQuire(PARAS(PIC) + PICTURE(1, 5), async (u) => {
  await u.click(await u.el('#pages .img'));
  const p0 = await u.el('#pages .img'), h = await u.el('.obj-handles .oh-se'), to = { x: h.x + 40, y: h.y + 30 };
  await u.press(h); await u.glide(h, to, 6);
  await u.esc();
  await u.release(to);
  const p1 = await u.el('#pages .img');
  assert.deepEqual([Math.round(p1.r - p1.l), Math.round(p1.b - p1.t)], [Math.round(p0.r - p0.l), Math.round(p0.b - p0.t)], 'the picture keeps its size');
}));

test('Q15 a click on a floating shape ends the text selection: no text stays highlighted', { todo: 'Phase 4' }, () => inQuire(PARAS(SHAPE_DOC) + SHAPE(1), async (u) => {
  await u.drag(await atB(u, 0, 6), await atB(u, 0, 15), 6);
  assert.equal(await highlighted(u), 'paragraph', 'the word is selected');
  await u.click(await u.el('#pages .flt'));
  assert.ok(!(await highlighted(u)).includes('paragraph'), 'the word is no longer highlighted');
}));

test('Q16 a drag from a table cell down into the text selects whole rows, and Delete removes them', { todo: 'Phase 5' }, () => inQuire(PARAS(['First paragraph of text.', 'Second paragraph.', 'Third paragraph after the table.']) + TABLE(1), async (u) => {
  await u.drag(await pointIn(u, 'B[1].rows[0].cells[0].blocks[0]', 2), await atB(u, 3, 5), 8);
  assert.equal(await u.evaluate(`document.querySelectorAll('#pages td.csel').length`), 4, 'every cell is highlighted');
  await u.key('Delete');
  const text = await body(u);
  assert.ok(!text.some(Array.isArray), 'the table is gone');
  assert.equal(text[0], 'First paragraph of text.');
}));

test('Q17a with "Drag-and-drop text editing" off, a drag from selected text selects instead of moving', { todo: 'Phase 5' }, () => inQuire(PARAS(DND) + 'L.app.opts.dragDrop = false;', async (u) => {
  await u.drag(await atB(u, 0, 6), await atB(u, 0, 10), 4);    // "beta"
  await u.drag(await atB(u, 0, 7), await atB(u, 2, 6), 10);    // from inside it to "Third |paragraph."
  assert.deepEqual(await body(u), DND, 'nothing moves');
  assert.ok((await selected(u)).endsWith('Third '), 'a new selection, to where the mouse was let go');
}));
test('Q17b an inline picture dragged to another place in the text moves there', { todo: 'Phase 5' }, () => inQuire(PARAS(PIC) + PICTURE(1, 5), async (u) => {
  const pic = await u.el('#pages .img');
  await u.click(pic);
  await u.drag(pic, await atB(u, 2, 6), 10);
  assert.equal(await u.evaluate(`L.D.doc.main.blocks.findIndex((b) => b.runs.some((r) => r.t === 'img'))`), 2, 'the picture is in the third paragraph');
}));
test('Q17c a right-click during a shape move cancels the move, and no menu opens', { todo: 'Phase 2' }, () => inQuire(PARAS(SHAPE_DOC) + SHAPE(1), async (u) => {
  const b0 = await u.el('#pages .flt > *'), to = { x: b0.x + 80, y: b0.y + 60 }, undo0 = await undoSteps(u);
  await u.press(b0); await u.glide(b0, to, 6);
  await u.press(to, { button: 'right' }); await u.release(to, { button: 'right' });
  await u.release(to);
  assert.equal(await u.evaluate(`document.querySelectorAll('.menu').length`), 0, 'no menu');
  assert.ok(near(await u.el('#pages .flt > *'), b0), 'the shape is where it was');
  assert.equal(await undoSteps(u), undo0, 'nothing to undo');
}));

test('no browser errors, no external requests', () => t.clean());
