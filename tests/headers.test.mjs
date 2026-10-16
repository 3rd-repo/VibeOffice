// The site's response headers (public/_headers; docs/suite.md, Security): what Cloudflare sends, and what the copies
// Cloudflare doesn't serve send the same way, the service worker's cache (public/common/headers.js) and the local
// server (tools/serve.py). The file uses only what both readers read, no path gets a header from two rules (which
// Cloudflare would join with a comma), its policy is the pages' own with frame-ancestors, and the two readers agree.
//
//   node --test tests/headers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn, execFileSync } from 'node:child_process';
import { HEADER } from '../tools/csp.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = fs.readFileSync(path.join(root, 'public/_headers'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'public/common/headers.js'), 'utf8'), ctx);
const H = ctx.L.headers;
/** the paths the site answers: pages, scripts, the worker, the update check */
const PATHS = ['/', '/index.html', '/quire/', '/ledger/index.html', '/common/core.js', '/sw.js', '/manifest.webmanifest', '/updater/current.json', '/oss-licenses.html'];

/** tools/serve.py's reader: for each path, [[name, value]] */
const python = (text, paths) => JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.argv = ['serve.py']
sys.path.insert(0, ${JSON.stringify(path.join(root, 'tools'))})
import serve
job = json.load(sys.stdin)
rules = serve.header_rules(job['text'])
print(json.dumps([serve.headers_for(rules, p) for p in job['paths']]))`], { input: JSON.stringify({ text, paths }), stdio: ['pipe', 'pipe', 'pipe'] }));
const js = (text, paths) => { const rules = H.parse(text); return paths.map((p) => Object.entries(H.for(rules, p))); };

test('every page and file of the site gets the same headers, each from one rule', () => {
  const rules = H.parse(FILE);
  assert.ok(rules.length <= 100 && FILE.split('\n').every((l) => l.length <= 2000), "within Cloudflare's limits");
  for (const p of PATHS) {
    const from = new Map();
    for (const r of rules) if (r.re.test(p)) for (const [name] of r.set) from.set(name.toLowerCase(), (from.get(name.toLowerCase()) || 0) + 1);
    assert.deepEqual([...from].filter(([, n]) => n > 1), [], `${p}: a header from two rules`);
    const got = H.for(rules, p);
    assert.deepEqual(Object.keys(got), ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy',
      'Permissions-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy', 'X-Frame-Options'], p);
    assert.equal(got['Content-Security-Policy'], HEADER, `${p}: the pages' policy with frame-ancestors`);
    assert.equal(got['X-Frame-Options'], 'DENY');
    assert.equal(got['Cross-Origin-Resource-Policy'], 'same-origin');
  }
});

test('the update check stays readable: no rule sets CORS or a CORP other than same-origin', () => {
  // the desktop app's fetch of /updater/*.json is a CORS request: Cloudflare's own Access-Control-Allow-Origin: *
  // answers it, and CORP applies only to no-cors loads (a picture, a script)
  assert.doesNotMatch(FILE, /Access-Control-/i);
  for (const r of H.parse(FILE)) for (const [name, value] of r.set) if (/^cross-origin-resource-policy$/i.test(name)) assert.equal(value, 'same-origin');
});

test('the service worker\'s reader and the local server\'s agree, on the site\'s file and on every rule of the format', () => {
  assert.deepEqual(js(FILE, PATHS), python(FILE, PATHS));
  const sample = '# a comment\n/*\n  A: 1\n  B: x\n/quire/*\n  A: 2\n  ! B\n/a/:id/b.$x\n  C: y\n';
  const paths = ['/quire/x', '/z', '/a/12/b.$x', '/a/12/bx$x', '/a/1/2/b.$x'];
  const want = [[['A', '1, 2']], [['A', '1'], ['B', 'x']], [['A', '1'], ['B', 'x'], ['C', 'y']], [['A', '1'], ['B', 'x']], [['A', '1'], ['B', 'x']]];
  assert.deepEqual(js(sample, paths), want, 'joined, removed, a placeholder is one segment, . and $ are literal');
  assert.deepEqual(python(sample, paths), want);
  for (const bad of ['https://vibeoffice.work/*\n  A: 1\n', '/a/*/b/*\n  A: 1\n', '  A: 1\n']) {
    assert.throws(() => H.parse(bad), /_headers/, bad);
    assert.throws(() => python(bad, ['/']), /_headers/, bad);
  }
});

test('tools/serve.py sends the headers, and never _headers itself', async () => {
  const port = 8790 + Math.floor(Math.random() * 100);
  const server = spawn('python3', [path.join(root, 'tools/serve.py'), String(port)], { stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50 && !(await fetch(base).then(() => true, () => false)); i++) await new Promise((r) => setTimeout(r, 100));
    for (const p of ['/', '/quire/', '/common/core.js']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
      for (const [name, value] of Object.entries(H.for(H.parse(FILE), p))) assert.equal(res.headers.get(name), value, `${p}: ${name}`);
    }
    assert.equal((await fetch(base + '/_headers')).status, 404);
  } finally { server.kill(); }
});
