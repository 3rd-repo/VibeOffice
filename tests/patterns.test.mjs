// Preset pattern fills (public/common/geometry.js, PATTERNS), one table for Lectern and Quire, as PowerPoint draws them:
// tests/patterns.powerpoint.json was read from PowerPoint's PDF of the deck tools/patterns/deck.mjs makes
// (tools/patterns/read-pdf.py):  node --test tests/patterns.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
globalThis.window = globalThis;
require('../public/common/core.js');
require('../public/common/geometry.js');
const G = globalThis.L.geom;
const powerpoint = JSON.parse(fs.readFileSync(path.join(root, 'tests/patterns.powerpoint.json'), 'utf8'));

test('the 54 presets, each the tile PowerPoint draws', () => {
  assert.equal(Object.keys(powerpoint).length, 54);
  assert.deepEqual(G.PATTERNS, powerpoint);
});

test('light lines are closer together than the plain ones, as in PowerPoint', () => {
  const lines = (rows) => rows.filter((r) => r === 0xFF).length;
  assert.equal(lines(G.PATTERNS.horz), 1);
  assert.equal(lines(G.PATTERNS.ltHorz), 2);
  assert.deepEqual(G.PATTERNS.cross, G.PATTERNS.lgGrid);
});

test('Lectern and Quire keep no table of their own', () => {
  for (const f of ['public/lectern/js/render.js', 'public/quire/js/drawing.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(src, /L\.geom\.PATTERNS/, f);
    assert.doesNotMatch(src, /pct50:\s*\[/, f);
  }
});

test('patternPath: one unit square per set bit', () => {
  assert.equal(G.patternPath([0x80, 0, 0, 0, 0, 0, 0, 0x01]), 'M0,0h1v1h-1zM7,7h1v1h-1z');
});
