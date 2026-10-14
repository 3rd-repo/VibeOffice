// Quire's lines against another application's PDF of the same document (tools/wordlines.py): each page's body as rows,
// the characters at one height (tops within 1pt) left to right, matched by their last 16 non-blank characters
// (FNV-1a, as tools/wordlines.py writes them). ROWS runs in the page (t.evaluate(ROWS)) and returns the same shape as
// the reference: { pages: [[[hash, chars, top, bottom, text], …], …] } in points from the top of the page.
// match() pairs the rows of the two in document order (longest common subsequence), so rows only one side has (text
// in floating boxes, headers drawn into the body, lines that wrap differently) are left out.

export const ROWS = `(() => {
  const LY = L.layout, z = LY.scale(), pt = 72 / 96, skip = /^[\\s\\u200b\\ufeff\\u00ad]$/u;
  const fnv = (s) => { let h = 0x811c9dc5; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 0x01000193) >>> 0; return h; };
  const pages = [];
  for (const pg of LY.pages) {
    const pr = pg.el.getBoundingClientRect(), chars = [];
    const w = document.createTreeWalker(pg.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const e = n.parentElement;
      if (!e || e.closest('.format-marks, .hbrk, .fcode, .ms') || !e.getClientRects().length) continue;
      let i = 0;
      for (const c of n.data) {
        const at = i; i += c.length;
        const k = c.normalize('NFKC');
        if (skip.test(c) || !k.trim()) continue;
        const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + c.length);
        const b = r.getClientRects()[0];
        if (!b || (!b.width && !b.height)) continue;
        chars.push({ k, x: (b.left - pr.left) / z * pt, top: (b.top - pr.top) / z * pt, bottom: (b.bottom - pr.top) / z * pt });
      }
    }
    chars.sort((a, b) => a.top - b.top || a.x - b.x);
    const rows = [];
    for (const c of chars) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(r.top - c.top) <= 1) { r.chars.push(c); r.bottom = Math.max(r.bottom, c.bottom); }
      else rows.push({ top: c.top, bottom: c.bottom, chars: [c] });
    }
    pages.push(rows.map((r) => {
      const text = r.chars.sort((a, b) => a.x - b.x).map((c) => c.k).join('');
      return [fnv([...text].slice(-16).join('')), [...text].length, Math.round(r.top * 100) / 100, Math.round(r.bottom * 100) / 100, text];
    }));
  }
  return { pages };
})()`;

/** pairs of rows the reference and Quire have in common, in document order: { ref: [page, row], got: [page, row],
    dy: Quire's top minus the reference's (points) } */
export function match(ref, got) {
  const flat = (doc) => doc.pages.flatMap((rows, p) => rows.map((r, i) => ({ p, i, h: r[0], n: r[1], top: r[2], tall: r[3] - r[2] })));
  const a = flat(ref), b = flat(got);
  const same = (x, y) => x.h === y.h && x.n === y.n;
  const L = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = same(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (same(a[i], b[j])) { pairs.push({ ref: [a[i].p, a[i].i], got: [b[j].p, b[j].i], dy: Math.round((b[j].top - a[i].top) * 100) / 100, tall: [a[i].tall, b[j].tall] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** for each reference page: the Quire page its first matched row is on, and the steps: how much farther from the
    reference a row is than the row just above it, for rows that follow each other on both sides (nothing unmatched
    between them) and are as tall on both sides (the same font metrics, so their tops compare): a line that is too tall
    or too short shows as a step at the row below it */
export function pagesAndSteps(ref, pairs) {
  return ref.pages.map((rows, p) => {
    const mine = pairs.filter((x) => x.ref[0] === p);
    const steps = [];
    for (let k = 1; k < mine.length; k++) {
      const a = mine[k - 1], b = mine[k];
      if (b.ref[1] !== a.ref[1] + 1 || b.got[0] !== a.got[0] || b.got[1] !== a.got[1] + 1) continue;
      if ([a, b].some((x) => Math.abs(x.tall[0] - x.tall[1]) > 1)) continue;
      steps.push({ row: b.ref[1], step: Math.round((b.dy - a.dy) * 100) / 100 });
    }
    return { page: p + 1, rows: rows.length, matched: mine.length, startsOn: mine.length ? mine[0].got[0] + 1 : null, steps };
  });
}
