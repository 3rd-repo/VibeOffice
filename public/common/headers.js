/* VibeOffice — the site's response headers (public/_headers, in Cloudflare Pages' format), read as Cloudflare reads
 * them, for the copies of the site Cloudflare doesn't serve: the service worker's cache (sw.js) and the tests'
 * Node checks (tools/serve.py has the same in Python; tests/headers.test.mjs keeps the two alike).
 * The subset the site uses: a rule is a path (beginning with /, at most one * splat, :name placeholders) and its
 * indented "Name: value" lines; "# …" is a comment. A header that two matching rules set is joined with ", ";
 * "! Name" in a matching rule removes it.
 */
(function (root) {
  'use strict';
  const L = root.L || (root.L = {});

  /** a rule's path as a regular expression over a request's path */
  function pattern(path) {
    if (!path.startsWith('/') || path.split('*').length > 2) throw new Error(`_headers: not a path this site uses: ${path}`);
    const literal = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/]+');
    return new RegExp('^' + path.split('*').map(literal).join('.*') + '$');
  }

  /** the rules of a _headers file: [{ path, re, set: [[name, value]], remove: [lower-case name] }] */
  function parse(text) {
    const rules = [];
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      if (!/^\s/.test(line)) { rules.push({ path: line.trim(), re: pattern(line.trim()), set: [], remove: [] }); continue; }
      const rule = rules[rules.length - 1], m = /^\s+(?:!\s*([\w-]+)|([\w-]+):\s*(.*?))\s*$/.exec(line);
      if (!rule || !m) throw new Error(`_headers: ${line.trim()}`);
      if (m[1]) rule.remove.push(m[1].toLowerCase()); else rule.set.push([m[2], m[3]]);
    }
    return rules;
  }

  /** the headers the rules give a request's path, { Name: value }, by the name the first rule gave it */
  function forPath(rules, path) {
    const out = new Map(), gone = new Set();
    for (const rule of rules) {
      if (!rule.re.test(path)) continue;
      for (const [name, value] of rule.set) {
        const k = name.toLowerCase(), had = out.get(k);
        out.set(k, had ? [had[0], had[1] + ', ' + value] : [name, value]);
      }
      for (const k of rule.remove) gone.add(k);
    }
    return Object.fromEntries([...out].filter(([k]) => !gone.has(k)).map(([, v]) => v));
  }

  L.headers = { parse, for: forPath };
})(typeof window !== 'undefined' ? window : globalThis);
