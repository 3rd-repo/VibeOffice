// New documents in the UI's language (docs/i18n.md, Defaults; public/common/locales.js): each app opened blank with
// ?lang=xx saves what that language's Office makes: the page, line grid, fonts and languages of a document, the font
// and paper of a workbook, the text language and East Asian font of a presentation. English keeps the apps' own.
//   node --test tests/locales.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServer, openPage } from '../tools/ooxml/cdp.mjs';

const stop = await ensureServer();
after(() => stop && stop());

/** the parts of the blank document app saves with the UI in lang */
async function saved(app, lang, write, parts) {
  const page = await openPage(app, { lang, persistence: false, automated: true });
  try {
    return await page.evaluate(`(async () => {
      for (let i = 0; i < 100 && !(L.app && ${write.split('(')[0].replace(/^await /, '')}); i++) await new Promise((r) => setTimeout(r, 100));
      const blob = await ${write};
      const zip = await L.zip.read(await blob.arrayBuffer());
      const out = {};
      for (const p of ${JSON.stringify(parts)}) out[p] = zip.get(p) ? await zip.get(p).text() : '';
      return out;
    })()`);
  } finally { await page.close(); }
}
const quire = (lang) => saved('quire', lang, 'L.docx.write(L.D.doc)', ['word/document.xml', 'word/styles.xml', 'word/settings.xml', 'word/theme/theme1.xml']);
const ledger = (lang) => saved('ledger', lang, 'L.xlsxWrite.write(L.app.books[L.app.cur].wb)', ['xl/styles.xml', 'xl/worksheets/sheet1.xml']);
const lectern = (lang) => saved('lectern', lang, 'L.pptx.write(L.pres)', ['ppt/presentation.xml', 'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml']);

for (const [lang, font, pitch, size, tab, charset, row, script] of [
  ['zh-CN', '宋体', 312, 21, 420, 134, 13.5, 'Hans'],
  ['zh-Hant', '新細明體', 360, 24, 480, 136, 14.25, 'Hant'],
]) test('Chinese defaults survive saving in all three apps: ' + lang, async () => {
  const q = await quire(lang), w = q['word/styles.xml'], set = q['word/settings.xml'];
  assert.match(q['word/document.xml'], /<w:pgSz w:w="11906" w:h="16838"/);
  assert.ok(q['word/document.xml'].includes('w:linePitch="' + pitch + '"'));
  assert.ok(w.includes('w:eastAsia="' + font + '"'));
  assert.ok(w.includes('<w:sz w:val="' + size + '"/>'));
  assert.ok(set.includes('<w:defaultTabStop w:val="' + tab + '"/>'));
  assert.ok(set.includes('w:eastAsia="' + lang + '"'));
  const x = await ledger(lang);
  assert.ok(x['xl/styles.xml'].includes('<name val="' + font + '"/>'));
  assert.ok(x['xl/styles.xml'].includes('<charset val="' + charset + '"/>'));
  assert.ok(x['xl/worksheets/sheet1.xml'].includes('defaultRowHeight="' + row + '"'));
  assert.match(x['xl/worksheets/sheet1.xml'], /<pageSetup [^>]*paperSize="9"/);
  const p = await lectern(lang);
  assert.ok(p['ppt/presentation.xml'].includes('lang="' + lang + '"'));
  assert.ok(p['ppt/theme/theme1.xml'].includes('script="' + script + '" typeface="' + font + '"'));
});

test('Quire, Japanese: A4, Office\'s margins, an 18pt line grid, Century with ＭＳ 明朝 10.5pt, punctuation compressed', async () => {
  const x = await quire('ja');
  const doc = x['word/document.xml'], st = x['word/styles.xml'], set = x['word/settings.xml'];
  assert.match(doc, /<w:pgSz w:w="11906" w:h="16838"/);
  assert.match(doc, /<w:pgMar w:top="1985" w:right="1701" w:bottom="1701" w:left="1701" w:header="851" w:footer="992"/);
  assert.match(doc, /<w:docGrid w:type="lines" w:linePitch="360"/);
  const dd = st.match(/<w:docDefaults>.*?<\/w:docDefaults>/s)[0];
  assert.match(dd, /<w:rFonts w:ascii="Century" w:hAnsi="Century" w:eastAsia="ＭＳ 明朝"/);
  assert.match(dd, /<w:sz w:val="21"\/>/);
  assert.match(dd, /<w:lang w:val="en-US" w:eastAsia="ja-JP"\/>/);
  const normal = st.match(/<w:style [^>]*w:styleId="Normal".*?<\/w:style>/s)[0];
  assert.match(normal, /<w:widowControl w:val="(0|false)"\/>/);
  assert.match(normal, /<w:jc w:val="both"\/>/);
  assert.match(set, /<w:defaultTabStop w:val="840"\/>/);
  assert.match(set, /<w:characterSpacingControl w:val="compressPunctuation"\/>/);
  assert.match(set, /<w:themeFontLang w:val="en-US" w:eastAsia="ja-JP"\/>/);
  assert.match(x['word/theme/theme1.xml'], /<a:minorFont>.*<a:font script="Jpan" typeface="ＭＳ 明朝"\/>.*<\/a:minorFont>/s);
});

test('Quire, French and German: A4, 2.5 cm margins (German 2 cm at the bottom), the text\'s language', async () => {
  const fr = await quire('fr'), de = await quire('de');
  assert.match(fr['word/document.xml'], /<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708"/);
  assert.match(de['word/document.xml'], /<w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708"/);
  assert.match(fr['word/styles.xml'], /<w:docDefaults>.*<w:lang w:val="fr-FR"\/>.*<\/w:docDefaults>/s);
  assert.match(de['word/settings.xml'], /<w:themeFontLang w:val="de-DE"\/>/);
  assert.doesNotMatch(fr['word/document.xml'], /<w:docGrid w:type/);
});

test('Quire, English: the app\'s own Letter page, no grid', async () => {
  const x = await quire('en');
  assert.match(x['word/document.xml'], /<w:pgSz w:w="12240" w:h="15840"/);
  assert.doesNotMatch(x['word/document.xml'], /<w:docGrid w:type/);
  assert.match(x['word/settings.xml'], /<w:themeFontLang w:val="en-US"\/>/);
  assert.match(x['word/settings.xml'], /<w:characterSpacingControl w:val="doNotCompress"\/>/);
});

test('Ledger, Japanese and Korean: their Excel\'s default font on A4', async () => {
  const ja = await ledger('ja'), ko = await ledger('ko');
  assert.match(ja['xl/styles.xml'], /<fonts[^>]*>\s*<font>.*?<name val="ＭＳ Ｐゴシック"\/>.*?<charset val="128"\/>/s);
  assert.match(ja['xl/styles.xml'], /<fonts[^>]*>\s*<font>\s*<sz val="11"\/>/s);
  assert.match(ko['xl/styles.xml'], /<fonts[^>]*>\s*<font>.*?<name val="맑은 고딕"\/>.*?<charset val="129"\/>/s);
  assert.match(ja['xl/worksheets/sheet1.xml'], /<pageSetup [^>]*paperSize="9"/);
  assert.match(ja['xl/worksheets/sheet1.xml'], /<sheetFormatPr [^>]*defaultRowHeight="13.5"/);
});

test('Lectern, Japanese: text in Japanese, the theme\'s Japanese font', async () => {
  const x = await lectern('ja');
  assert.match(x['ppt/presentation.xml'], /<p:defaultTextStyle><a:defPPr><a:defRPr lang="ja-JP"\/>/);
  assert.match(x['ppt/theme/theme1.xml'], /<a:minorFont>.*<a:font script="Jpan" typeface="ＭＳ Ｐゴシック"\/>.*<\/a:minorFont>/s);
  const en = await lectern('en');
  assert.match(en['ppt/presentation.xml'], /<a:defRPr lang="en-US"\/>/);
  assert.doesNotMatch(en['ppt/theme/theme1.xml'], /script="Jpan"/);
});
