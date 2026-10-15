// Issue #20: a Word 2010 (compat 14) report had two blank pages in Quire that Word doesn't make, and its centred tables,
// wider than the text, hung off the right edge of the page. Word keeps the paragraph mark of a page break that ends a
// section's last paragraph on the page of the break, and an empty paragraph holding only a section break, after a page
// break, at the foot of that page, when the next section starts on a new page anyway; a centred table wider than its
// column overhangs both margins evenly, a right-aligned one the left margin (public/quire/js/layout.js). The documents
// are built here; the rules were checked against the page counts Word stored in the corpus (tools/quire-pages.mjs):
//   node --test tests/from-issues/20/pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServer, openPage } from '../../../tools/ooxml/cdp.mjs';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const SECT = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
const p = (text, extra = '', pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}${extra}</w:p>`;
const BR = '<w:r><w:br w:type="page"/></w:r>';
const table = (jc) => `<w:tbl><w:tblPr><w:tblW w:w="11000" w:type="dxa"/><w:jc w:val="${jc}"/><w:tblLayout w:type="fixed"/></w:tblPr>`
  + '<w:tblGrid><w:gridCol w:w="5500"/><w:gridCol w:w="5500"/></w:tblGrid><w:tr>'
  + ['A', 'B'].map((t) => `<w:tc><w:tcPr><w:tcW w:w="5500" w:type="dxa"/></w:tcPr>${p(t)}</w:tc>`).join('') + '</w:tr></w:tbl>';
/** the parts of a .docx: its body and the Word version it was saved in (compatibilityMode) */
const docx = (body, compat) => [
  { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>' },
  { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
  { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>' },
  { name: 'word/settings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${W}><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${compat}"/></w:compat></w:settings>` },
  { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}${SECT}</w:body></w:document>` },
];
const sectPara = (extra = '', pPr = '') => p('', extra, pPr + SECT);

const CASES = {
  // the issue's first blank page: the paragraph holding the section break is only a page break
  breakInSectionPara: { body: p('Section one') + sectPara(BR) + p('Section two'), compat: 14 },
  // its second: the page break ends the paragraph of text, an empty paragraph after it holds the section break
  emptySectionParaAfterBreak: { body: p('Report Date', BR) + sectPara() + p('Appendix'), compat: 14 },
  emptySectionParaAfterBreak12: { body: p('Report Date', BR) + sectPara() + p('Appendix'), compat: 12 },
  // what Word keeps (the corpus): that paragraph with "page break before" of its own, and in a Word 2007 document,
  // the paragraph mark of a page break that ends the document, have a page each
  emptySectionParaPbb: { body: p('Thanks', BR) + sectPara('', '<w:pageBreakBefore/>') + p('Contents'), compat: 12 },
  breakEndsDocument12: { body: p('Last page') + p('', BR), compat: 12 },
  centredTable: { body: table('center'), compat: 14 },
  rightTable: { body: table('right'), compat: 14 },
};

test('Issue 20: no blank page at a section break after a page break; wide tables overhang the margins as in Word', async () => {
  const stop = await ensureServer();
  const page = await openPage('quire', { persistence: false, automated: true });
  try {
    const got = await page.evaluate(`(async () => {
      VO.opened = () => {}; L.layout.view = 'print'; L.layout.setZoom(1);
      const out = {};
      for (const [name, c] of Object.entries(${JSON.stringify(Object.fromEntries(Object.entries(CASES).map(([k, c]) => [k, docx(c.body, c.compat)])))})) {
        const { doc } = await L.docx.read(await (await L.zip.write(c, 'application/zip')).arrayBuffer());
        L.app.loadDoc(doc, name, { saved: true });
        await document.fonts.ready; L.layout.render(); await new Promise((r) => setTimeout(r, 200));
        const z = L.layout.scale(), pt = 72 / 96, pg = L.layout.pages[0], o = pg.el.getBoundingClientRect(), t = pg.body.querySelector('table');
        out[name] = { pages: L.layout.pages.map((x) => x.body.innerText.replace(/[\\s\\u200b]+/g, ' ').trim()),
          table: t && [(t.getBoundingClientRect().left - o.left) / z * pt, (t.getBoundingClientRect().right - o.left) / z * pt] };
      }
      return out;
    })()`);
    assert.deepEqual(got.breakInSectionPara.pages, ['Section one', 'Section two']);
    assert.deepEqual(got.emptySectionParaAfterBreak.pages, ['Report Date', 'Appendix']);
    assert.deepEqual(got.emptySectionParaAfterBreak12.pages, ['Report Date', 'Appendix']);
    assert.deepEqual(got.emptySectionParaPbb.pages, ['Thanks', '', 'Contents']);
    assert.deepEqual(got.breakEndsDocument12.pages, ['Last page', '']);
    // 550pt wide in a 451.3pt column (A4, 1in margins): 49.35pt over each margin centred, all 98.7pt over the left one right-aligned
    const near = (a, b) => Math.abs(a - b) < 0.5;
    assert.ok(near(got.centredTable.table[0], 72 - 49.35) && near(got.centredTable.table[1], 523.3 + 49.35), String(got.centredTable.table));
    assert.ok(near(got.rightTable.table[0], 72 - 98.7) && near(got.rightTable.table[1], 523.3), String(got.rightTable.table));
  } finally { await page.close(); stop(); }
});
