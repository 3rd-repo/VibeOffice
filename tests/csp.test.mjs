// The pages' Content-Security-Policy (tools/csp.mjs; docs/suite.md, Security): every page, and every source a tool
// builds a page from, carries the one policy before any script, with no inline script, handler or javascript: URL;
// and the policy runs our own script files only.
//
//   node --test tests/csp.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { POLICY, PAGES, SOURCES, problems } from '../tools/csp.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const META = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`;

test('every page and page source carries the policy, and no inline script, handler or javascript: URL', () => {
  for (const file of [...PAGES, ...SOURCES]) assert.deepEqual(problems(fs.readFileSync(path.join(root, file), 'utf8')), [], file);
});

test('scripts: our own files only, no eval', () => {
  assert.equal(/(?:^|; )script-src ([^;]+)/.exec(POLICY)[1], "'self'");
  assert.doesNotMatch(POLICY, /unsafe-eval/);
});

test('the check sees what it guards against', () => {
  const page = (head, body = '') => `<head><meta charset="utf-8">\n${head}</head><body>${body}</body>`;
  assert.deepEqual(problems(page(`${META}<script src="a.js"></script><script type="application/json">{}</script>`)), []);
  assert.deepEqual(problems(page('<script src="a.js"></script>')), ['0 policies']);
  assert.deepEqual(problems(page(META.replace("'self'", "'self' 'unsafe-eval'"))), ['another policy']);
  assert.deepEqual(problems(page(`<script src="look.js"></script>${META}`)), ['a script before the policy']);
  assert.match(problems(page(META + '<script>var x = 1;</script>'))[0], /^an inline script/);
  assert.match(problems(page(META, '<button onclick="go()">'))[0], /^a handler/);
  assert.match(problems(page(META, '<a href="javascript:go()">'))[0], /^a javascript: URL/);
});
