// Lectern with real mouse and keyboard input (tests/lib/input.mjs). A test named after an audit item (P1…) checks
// what PowerPoint does there and stays `todo` until the item is fixed (todos/UI_MOUSE_LOGIC_IMPROVE.md, Audit,
// Lectern); taking the mark off is part of the fix. Each test has its own tab, so a failure leaves nothing behind.
// The deck is built through the model (setup); everything the user does is real input.
//
//   node --test --test-concurrency=1 tests/ui/lectern.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, pause } from '../lib/input.mjs';

/** a tab on Lectern for one test */
async function lectern(fn) {
  const u = await open('lectern');
  try { await fn(u); } finally { await u.close(); }
}

/** a deck of `slides` slides (notes S1, S2, … name them) whose first slide holds `shapes`, JS using
    box(id, x, y, text, bold), rect(id, x, y, w, h, text) and table(id, x, y) (3×3, cells "r0c0"…); slide 1 shown */
const setup = (u, shapes, slides = 1) => u.evaluate(`(async () => {
  const E = L.ed, M = L.model, T = L.txt;
  while (L.pres.slides.length < ${slides}) L.ui.exec('newSlide');
  L.pres.slides.forEach((s, i) => { s.notes = 'S' + (i + 1); });
  if (L.te.active()) L.te.end();
  E.goto(0);
  const slide = L.pres.slides[0];
  const box = (id, x, y, text, b) => { const s = M.newTextBox(L.pres, slide, x, y, 500, 40, true); s.id = id; s.tx.ps = [{ lvl: 0, pp: {}, rs: [{ t: text, b: !!b }] }]; return s; };
  const rect = (id, x, y, w, h, text) => { const s = M.newShape(L.pres, slide, 'rect', x, y, w, h); s.id = id; if (text) s.tx = T.body([T.para(text, { algn: 'ctr' })], { anchor: 'ctr' }); return s; };
  const table = (id, x, y) => { const t = M.newTable(L.pres, slide, 3, 3, x, y, 600); t.id = id; t.tbl.rows.forEach((r, ri) => r.cells.forEach((c, ci) => { c.tx.ps = [T.para('r' + ri + 'c' + ci)]; })); return t; };
  slide.shapes = [${shapes}];
  E.sel = []; E.render(); L.panes.left.render();
  await new Promise((r) => setTimeout(r, 400));
})()`);

/** screen point just inside character n of a shape's text */
const at = (u, id, n) => u.evaluate(`(() => { const w = document.createTreeWalker(L.ed.elOf('${id}'), NodeFilter.SHOW_TEXT); let k = ${n}, t;
  while ((t = w.nextNode())) { if (!t.data.replace(/\\u200b/g, '').length) continue; if (k <= t.length) { const r = document.createRange(); r.setStart(t, k); r.collapse(true); const b = r.getClientRects()[0] || r.getBoundingClientRect(); return { x: b.left + 1, y: b.top + b.height / 2 }; } k -= t.length; } return null; })()`);
/** a shape's box on screen: centre x, y and edges l, t, r, b */
const shapeBox = (u, id) => u.evaluate(`(() => { const r = L.ed.elOf('${id}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
/** screen point of a slide point (pt) */
const slidePt = (u, x, y) => u.evaluate(`(() => { const r = L.ed.host.getBoundingClientRect(); return { x: r.left + ${x} * L.ed.scale, y: r.top + ${y} * L.ed.scale }; })()`);
const thumb = (u, i) => u.el(`.th[data-i="${i}"] .th-frame`);
/** a little right of the centre of a table cell (inside its text's line, past the text) */
const cell = (u, id, r, c) => u.evaluate(`(() => { const td = L.ed.elOf('${id}').querySelector('td[data-r="${r}"][data-c="${c}"]'); const b = td.getBoundingClientRect(); return { x: b.left + b.width / 2 + 10, y: b.top + b.height / 2 }; })()`);
/** what is edited (a shape id or null) and what is selected */
const state = (u) => u.evaluate(`({ editing: L.te.state ? L.te.state.id : null, sel: L.ed.sel.slice() })`);
const order = (u) => u.evaluate(`L.pres.slides.map((s) => s.notes).join(',')`);
const text = (u, id) => u.evaluate(`L.ed.shape('${id}') ? L.txt.paraText(L.ed.shape('${id}').tx.ps[0]) : null`);
const geo = (u, id) => u.evaluate(`(s => s && [s.x, s.y, s.w, s.h].map((v) => Math.round(v)))(L.ed.shape('${id}'))`);
const count = (u) => u.evaluate(`L.ed.slide().shapes.length`);
/** AutoShapes ▸ Lines ▸ tool on the Drawing toolbar */
async function lineTool(u, label) { await u.click(await u.el('[data-as]')); await u.pick('Lines', label); }
/** edit boxA ("Alpha beta gamma delta epsilon") with "beta" selected */
async function editBeta(u) {
  await u.click(await at(u, 'boxA', 3));
  await u.drag(await at(u, 'boxA', 6), await at(u, 'boxA', 10));
  assert.deepEqual(await u.evaluate('String(window.getSelection())'), 'beta', 'setup: "beta" selected');
}
const BOXES = `box('boxA', 60, 300, 'Alpha beta gamma delta epsilon', true), box('boxB', 60, 380, 'Second box with other words')`;
const RECT = `rect('rectR', 200, 150, 120, 80)`;
const OK_TEXT = 'Alpha Q gamma delta epsilon';

/* ---------- Phase 1: data loss and wrong edits ---------- */

test('P1 After a thumbnail click, a click on a shape takes the keyboard: Delete deletes the shape', () => lectern(async (u) => {
  await setup(u, RECT, 2);
  await u.click(await thumb(u, 0));
  await u.click(await shapeBox(u, 'rectR'));
  assert.deepEqual((await state(u)).sel, ['rectR'], 'setup: the rectangle is selected');
  await u.key('Delete');
  assert.equal(await order(u), 'S1,S2', 'no slide is deleted');
  assert.equal(await count(u), 0, 'the rectangle is deleted');
  u.clean();
}));

for (const [id, cmd, prop, value] of [['P2a', 'bold', 'b', true], ['P2b', 'alignCenter', 'algn', 'ctr']]) {
  test(`${id} ${cmd === 'bold' ? 'Bold' : 'Center'} on a dragged range of table cells formats those cells only`, () => lectern(async (u) => {
    await setup(u, `table('tbl', 100, 150)`);
    await u.click(await cell(u, 'tbl', 0, 0));
    await u.drag(await cell(u, 'tbl', 0, 0), await cell(u, 'tbl', 1, 1), 10);
    await u.click(await u.button(cmd));
    const got = await u.evaluate(`L.ed.shape('tbl').tbl.rows.map((r) => r.cells.map((c) => { const p = c.tx.ps[0]; return ${prop === 'b' ? '!!(p.rs[0] && p.rs[0].b)' : "(p.pp && p.pp.algn) || null"}; }))`);
    const off = prop === 'b' ? false : null;
    assert.deepEqual(got, [[value, value, off], [value, value, off], [off, off, off]], 'the four selected cells, not the rest');
    u.clean();
  }));
}

test('a range of table cells stays selected after formatting: a second command formats the same cells', () => lectern(async (u) => {
  await setup(u, `table('tbl', 100, 150)`);
  await u.click(await cell(u, 'tbl', 0, 0));
  await u.drag(await cell(u, 'tbl', 0, 0), await cell(u, 'tbl', 1, 1), 10);
  await u.click(await u.button('bold'));
  await u.click(await u.button('italic'));
  const got = await u.evaluate(`L.ed.shape('tbl').tbl.rows.map((r) => r.cells.map((c) => { const x = c.tx.ps[0].rs[0] || {}; return (x.b ? 'B' : '-') + (x.i ? 'I' : '-'); }))`);
  assert.deepEqual(got, [['BI', 'BI', '--'], ['BI', 'BI', '--'], ['--', '--', '--']]);
  u.clean();
}));

/* ---------- Phase 2: one drag lifecycle ---------- */

test('P5a Esc during a move cancels it: the shape stays where it was', () => lectern(async (u) => {
  await setup(u, RECT);
  const c = await shapeBox(u, 'rectR');
  await u.press(c); await u.glide(c, { x: c.x + 80, y: c.y + 40 }, 6);
  await u.esc();
  await u.glide({ x: c.x + 80, y: c.y + 40 }, { x: c.x + 100, y: c.y + 50 }, 2); await u.release({ x: c.x + 100, y: c.y + 50 });
  assert.deepEqual(await geo(u, 'rectR'), [200, 150, 120, 80], 'not moved');
  u.clean();
}));

test('P5b Esc during a resize cancels it: the shape keeps its size', () => lectern(async (u) => {
  await setup(u, RECT);
  const c = await shapeBox(u, 'rectR');
  await u.click(c);
  const corner = { x: c.r, y: c.b };   // the bottom-right sizing handle
  await u.press(corner); await u.glide(corner, { x: corner.x + 60, y: corner.y + 50 }, 6);
  await u.esc();
  await u.glide({ x: corner.x + 60, y: corner.y + 50 }, { x: corner.x + 70, y: corner.y + 60 }, 2); await u.release({ x: corner.x + 70, y: corner.y + 60 });
  assert.deepEqual(await geo(u, 'rectR'), [200, 150, 120, 80], 'not resized');
  u.clean();
}));

test('P5c Esc while dragging out a rectangle draws nothing', () => lectern(async (u) => {
  await setup(u, RECT);
  await u.click(await u.button('drawRect'));
  const a = await slidePt(u, 500, 100), b = await slidePt(u, 650, 200);
  await u.press(a); await u.glide(a, b, 6);
  await u.esc();
  await u.glide(b, { x: b.x + 10, y: b.y + 10 }, 2); await u.release({ x: b.x + 10, y: b.y + 10 });
  assert.equal(await count(u), 1, 'no rectangle added');
  assert.equal(await u.evaluate(`L.ed.scroller.classList.contains('drawing')`), false, 'Esc also ends the tool');
  u.clean();
}));

test('Ctrl+Z in the middle of a resize undoes the resize, not the move before it; Ctrl+Y brings back nothing uncommitted', () => lectern(async (u) => {
  await setup(u, RECT);
  const c = await shapeBox(u, 'rectR');
  await u.drag(c, { x: c.x + 40, y: c.y }, 6);
  const moved = await geo(u, 'rectR');
  await u.click(await shapeBox(u, 'rectR'));
  const se = await u.el('.ed-overlay [data-h="se"]'), to = { x: se.x + 60, y: se.y + 40 };
  await u.press(se); await u.glide(se, to, 6);
  await u.key('z', { ctrl: true });
  await u.release(to);
  assert.deepEqual(await geo(u, 'rectR'), moved, 'the shape is as it was moved: the resize is undone, the move kept');
  await u.key('y', { ctrl: true });
  assert.deepEqual(await geo(u, 'rectR'), moved, 'nothing to redo');
  u.clean();
}));

test('P5d Esc during a scribble draws nothing, without an error', () => lectern(async (u) => {
  await setup(u, RECT);
  await lineTool(u, 'Scribble');
  const a = await slidePt(u, 400, 300), b = await slidePt(u, 520, 380);
  await u.press(a); await u.glide(a, b, 8);
  await u.esc();
  await u.glide(b, { x: b.x + 20, y: b.y - 30 }, 3); await u.release({ x: b.x + 20, y: b.y - 30 });
  assert.deepEqual(u.errors, [], 'no TypeError when the button is let go');
  assert.equal(await count(u), 1, 'no scribble added');
  u.clean();
}));

test('P5e Esc while dragging a thumbnail cancels the reorder', () => lectern(async (u) => {
  await setup(u, '', 3);
  const a = await thumb(u, 0), c = await thumb(u, 2);
  await u.press(a); await u.glide(a, { x: a.x, y: c.b + 10 }, 10);
  await u.esc();
  await u.glide({ x: a.x, y: c.b + 10 }, { x: a.x, y: c.b + 14 }, 2); await u.release({ x: a.x, y: c.b + 14 });
  assert.equal(await order(u), 'S1,S2,S3', 'the slides keep their order');
  u.clean();
}));

test('P5f A right-click during a move cancels it, as Esc does, and opens no menu', () => lectern(async (u) => {
  await setup(u, RECT);
  const c = await shapeBox(u, 'rectR'), b = { x: c.x + 70, y: c.y + 50 };
  await u.press(c); await u.glide(c, b, 6);
  await u.mouse('mousePressed', b, { button: 'right' }); await pause(60);
  await u.mouse('mouseReleased', b, { button: 'right' }); await pause(100);
  await u.glide(b, { x: b.x + 20, y: b.y + 20 }, 3); await u.release({ x: b.x + 20, y: b.y + 20 });
  assert.deepEqual(await geo(u, 'rectR'), [200, 150, 120, 80], 'not moved');
  assert.equal(await u.evaluate('L.ui.menuOpen()'), false, 'and opens no menu');
  u.clean();
}));

test('P10 Another drawing tool abandons an unfinished freeform: the next freeform has only its own points', () => lectern(async (u) => {
  await setup(u, '');
  await lineTool(u, 'Freeform');
  await u.click(await slidePt(u, 100, 100));
  await u.click(await slidePt(u, 200, 150));
  await u.click(await u.button('drawRect'));
  assert.equal(await u.evaluate(`document.querySelectorAll('.ed-overlay .draw-ghost').length`), 0, 'the unfinished freeform is gone from the slide');
  await u.drag(await slidePt(u, 600, 100), await slidePt(u, 700, 180));
  await lineTool(u, 'Freeform');
  await u.click(await slidePt(u, 100, 350));
  await u.click(await slidePt(u, 200, 420));
  await u.dblclick(await slidePt(u, 300, 380));
  const spans = await u.evaluate(`L.ed.slide().shapes.filter((s) => s.geom === 'custom').map((s) => [Math.round(s.y), Math.round(s.y + s.h)])`);
  assert.ok(spans.length >= 1, 'a freeform was drawn');
  for (const [top, bottom] of spans) assert.ok(bottom <= 160 || top >= 345, `a freeform spans y ${top}–${bottom}: it joins the abandoned points to the new ones`);
  u.clean();
}));

test('P14 A move whose release is lost (let go in another tab) does not follow the pointer afterwards', () => lectern(async (u) => {
  await setup(u, RECT);
  const c = await shapeBox(u, 'rectR'), b = { x: c.x + 70, y: c.y + 40 };
  await u.press(c); await u.glide(c, b, 6);
  await u.releaseInOtherTab();
  const before = await shapeBox(u, 'rectR');
  await u.glide(b, { x: b.x + 200, y: b.y + 120 }, 6);   // no button held
  const after = await shapeBox(u, 'rectR');
  assert.deepEqual([after.l, after.t], [before.l, before.t], 'the shape stays put while the pointer only hovers');
  u.clean();
}));

/* ---------- Phase 3: the keyboard back to the document ---------- */

for (const [id, how, show] of [
  ['P7a', 'Format ▸ Font…, Cancel', async (u) => { await u.menu('Format', 'Font'); return 'cancel'; }],
  ['P7b', 'Format ▸ Font…, Esc', async (u) => { await u.menu('Format', 'Font'); return 'esc'; }],
  ['P7c', 'the context menu\'s Font…, Cancel', async (u) => { await u.rightClick(await at(u, 'boxA', 8)); await u.pick('Font'); return 'cancel'; }],
  ['P7d', 'the Hyperlink button, Cancel', async (u) => { await u.click(await u.button('hyperlink')); return 'cancel'; }],
]) {
  test(`${id} After ${how}, the text selection is kept and typing replaces it`, { todo: 'Phase 3' }, () => lectern(async (u) => {
    await setup(u, BOXES);
    await editBeta(u);
    const close = await show(u);
    await pause(300);
    assert.equal(await u.evaluate('L.ui.dialogOpen()'), true, 'setup: the dialog is open');
    if (close === 'esc') await u.esc();
    else await u.click(await u.evaluate(`(() => { const b = [...document.querySelectorAll('.dlg .dlg-foot .btn')].find((b) => /cancel/i.test(b.textContent)); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
    await u.type('Q');
    assert.equal(await text(u, 'boxA'), OK_TEXT, 'typing replaces "beta"');
    u.clean();
  }));
}

/* ---------- Phase 4: one owner per piece of state ---------- */

test('P3 Editing text, a click on the current slide\'s thumbnail ends the edit: Delete then deletes the slide', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, BOXES, 2);
  await editBeta(u);
  await u.click(await thumb(u, 0));
  assert.equal((await state(u)).editing, null, 'text editing ended');
  await u.key('Delete');
  assert.equal(await order(u), 'S2', 'the slide is deleted');
  u.clean();
}));

test('P4a In the Slides pane, Delete twice deletes two slides', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, '', 4);
  await u.click(await thumb(u, 0));
  await u.key('Delete');
  assert.equal(await order(u), 'S2,S3,S4', 'setup: the first Delete');
  await u.key('Delete');
  assert.equal(await order(u), 'S3,S4', 'the second Delete deletes the next slide');
  u.clean();
}));

test('P4b After dragging a thumbnail to another place, Delete deletes the moved slide', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, '', 3);
  const a = await thumb(u, 0), c = await thumb(u, 2);
  await u.drag(a, { x: a.x, y: c.b + 10 }, 10);
  assert.equal(await order(u), 'S2,S3,S1', 'setup: the slide moved');
  await u.key('Delete');
  assert.equal(await order(u), 'S2,S3', 'the moved slide is deleted');
  u.clean();
}));

test('P6a Shift+click on a text box adds it to the selection, without editing it', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, BOXES);
  await u.click(await at(u, 'boxA', 3));
  await u.esc();
  assert.deepEqual(await state(u), { editing: null, sel: ['boxA'] }, 'setup: boxA selected as an object');
  await u.click(await at(u, 'boxB', 8), { shift: true });
  assert.deepEqual(await state(u), { editing: null, sel: ['boxA', 'boxB'] }, 'both boxes selected');
  u.clean();
}));

test('P6b Ctrl+click on a text box adds it to the selection, without editing it', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, `${BOXES}, ${RECT}`);
  await u.click(await shapeBox(u, 'rectR'));
  assert.deepEqual(await state(u), { editing: null, sel: ['rectR'] }, 'setup: the rectangle selected');
  await u.click(await at(u, 'boxB', 8), { ctrl: true });
  assert.deepEqual(await state(u), { editing: null, sel: ['rectR', 'boxB'] }, 'both selected');
  u.clean();
}));

test('P8 Dragging across the cells of a table selects cells; the table does not move', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, `table('tbl', 100, 150)`);
  await u.drag(await cell(u, 'tbl', 0, 0), await cell(u, 'tbl', 1, 2), 10);
  assert.deepEqual((await geo(u, 'tbl')).slice(0, 2), [100, 150], 'the table stays where it was');
  u.clean();
}));

test('P9 A click into one cell clears the highlight of a selected range of cells', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, `table('tbl', 100, 150)`);
  const highlights = () => u.evaluate(`document.querySelectorAll('.cell-sel').length`);
  await u.click(await cell(u, 'tbl', 0, 0));
  await u.drag(await cell(u, 'tbl', 0, 0), await cell(u, 'tbl', 1, 1), 10);
  assert.equal(await highlights(), 1, 'setup: the range is highlighted');
  await u.click(await cell(u, 'tbl', 2, 2));
  assert.equal(await highlights(), 0, 'no range highlighted');
  u.clean();
}));

test('P11 Editing text, a click on the hatched border selects the box as an object: Delete deletes it', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, BOXES);
  await u.click(await at(u, 'boxA', 3));
  const ring = await u.el('.edit-ring');
  await u.click({ x: ring.l + (ring.r - ring.l) * 0.3, y: ring.t + 1.5 });
  assert.deepEqual(await state(u), { editing: null, sel: ['boxA'] }, 'the box selected, its text not edited');
  await u.key('Delete');
  assert.equal(await text(u, 'boxA'), null, 'the box is deleted');
  u.clean();
}));

/** zoom to 200 % with the Zoom box, then drag the slide area's vertical scroll bar down */
async function zoomAndScroll(u) {
  await u.click(await u.el('#tb-zoom'));
  await u.type('200'); await u.key('Enter');
  const sb = await u.evaluate(`(() => { const s = L.ed.scroller, r = s.getBoundingClientRect(); return { x: r.right - (s.offsetWidth - s.clientWidth) / 2, y: r.top + 40 }; })()`);
  return async () => {
    await u.press(sb); await u.glide(sb, { x: sb.x, y: sb.y + 120 }, 8); await u.release({ x: sb.x, y: sb.y + 120 });
    assert.ok(await u.evaluate('L.ed.scroller.scrollTop') > 0, 'setup: the slide area scrolled');
  };
}

test('P12a Dragging the scroll bar keeps the selection', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, `rect('rectR', 30, 30, 100, 60)`);
  const scroll = await zoomAndScroll(u);
  await u.click(await shapeBox(u, 'rectR'));
  assert.deepEqual((await state(u)).sel, ['rectR'], 'setup: the rectangle is selected');
  await scroll();
  assert.deepEqual(await state(u), { editing: null, sel: ['rectR'] }, 'still selected');
  u.clean();
}));

test('P12b Dragging the scroll bar keeps text editing', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, `box('boxA', 30, 30, 'Alpha beta gamma delta epsilon')`);
  const scroll = await zoomAndScroll(u);
  await u.click(await at(u, 'boxA', 3));
  assert.equal((await state(u)).editing, 'boxA', 'setup: editing');
  await scroll();
  assert.equal((await state(u)).editing, 'boxA', 'still editing');
  u.clean();
}));

test('P13 A double-click on a word in an unselected AutoShape selects the word', { todo: 'Phase 4' }, () => lectern(async (u) => {
  await setup(u, `rect('rectT', 80, 120, 420, 100, 'Alpha beta gamma delta')`);
  await u.dblclick(await at(u, 'rectT', 8));
  assert.equal((await state(u)).editing, 'rectT', 'its text is edited');
  assert.equal(await u.evaluate('String(window.getSelection())'), 'beta', 'the word is selected');
  u.clean();
}));
