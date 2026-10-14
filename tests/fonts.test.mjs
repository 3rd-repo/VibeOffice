// East Asian fonts (docs/i18n.md, Fonts): the names Japanese, Korean and Chinese Office write are the fonts every table
// knows by their English names, a run draws its East Asian characters from its East Asian font, and Ledger sizes rows
// for a Japanese or Korean Excel's default font:  node --test tests/fonts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../public/common/core.js');
require('../public/ledger/js/model.js');
const L = globalThis.L;

test('localized names are the English fonts', () => {
  assert.equal(L.fontKey('ＭＳ 明朝'), 'ms mincho');
  assert.equal(L.fontKey('맑은 고딕'), 'malgun gothic');
  assert.equal(L.fontKey('宋体'), 'simsun');
  assert.equal(L.fontKey('Times New Roman'), 'times new roman');
  assert.ok(L.fontIsEA('游ゴシック') && L.fontIsEA('Batang') && !L.fontIsEA('Century'));
});

test('a run\'s letters come from its Latin font, its East Asian characters from its East Asian font', () => {
  const stack = L.fontStack('Century', 'ＭＳ 明朝');
  assert.ok(stack.startsWith('"Century",'), stack);
  assert.ok(stack.indexOf('"ＭＳ 明朝"') > stack.indexOf('"Century"'), 'the East Asian font after the Latin one');
  assert.ok(stack.includes('"MS Mincho"') && stack.endsWith(',serif'), stack);
  assert.equal(stack.match(/,serif/g).length, 1, 'one generic family, at the end');
  assert.equal(L.fontStack('Arial', 'Arial'), L.fontStack('Arial'), 'the same font once');
  assert.equal(L.fontStack('Arial', 'Wingdings'), L.fontStack('Arial'), 'not a font for East Asian text');
});

test('East Asian text is told from Latin text', () => {
  for (const s of ['日本語', 'ひらがな', 'カタカナ', '한국어', '中文', '（全角）']) assert.ok(L.hasEAText(s), s);
  for (const s of ['English', 'Français', 'Größe', '', null]) assert.ok(!L.hasEAText(s), String(s));
});

test('Ledger: the rows of a Japanese or Korean Excel\'s default font', () => {
  assert.equal(L.model.fontRowPt({ name: 'ＭＳ Ｐゴシック', sz: 11 }), 13.5);
  assert.equal(L.model.fontRowPt({ name: '游ゴシック', sz: 11 }), 18.75);
  assert.equal(L.model.fontRowPt({ name: '맑은 고딕', sz: 11 }), 16.5);
  assert.equal(L.model.fontRowPt({ name: 'Calibri', sz: 11 }), 15, 'Latin fonts as before');
});
