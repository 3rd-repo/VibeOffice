"""Line heights by what a line holds, as LibreOffice draws them (tests/quire/lines.test.mjs, public/quire/js/portions.js).

  python3 tools/linecases.py make [tests/quire/lines/linecases.docx]   one paragraph per case, between 10pt marker
      paragraphs M0, M1, …, so the distance from one marker to the next is the marker's line plus the case
  python3 tools/linecases.py read linecases.pdf [OUT.json]             after LibreOffice has made the PDF
      (soffice --headless --convert-to pdf): the distance in points from each marker to the next
      (tests/quire/lines/linecases-lo.json)

CASES names each case and whether LibreOffice is believed to draw it as Word does (Word and LibreOffice agree on a
picture alone in its line, a large first run, large spaces and tabs, Shift+Enter lines and exact spacing); only those
are asserted, the rest are measured for the record.
"""
import io, json, re, subprocess, sys, zipfile

W = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
     'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
     'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"')
LONG = 'Small text that runs on for several lines, so that the lines after the first show their own height. ' * 2


def run(t, sz=20, extra=''):
    return f'<w:r><w:rPr>{extra}<w:sz w:val="{sz}"/></w:rPr><w:t xml:space="preserve">{t}</w:t></w:r>'


def tab(sz=20):
    return f'<w:r><w:rPr><w:sz w:val="{sz}"/></w:rPr><w:tab/></w:r>'


def br(sz=20):
    return f'<w:r><w:rPr><w:sz w:val="{sz}"/></w:rPr><w:br/></w:r>'


def para(body, mark=20, spacing='<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>', extra=''):
    return f'<w:p><w:pPr>{extra}{spacing}<w:rPr><w:sz w:val="{mark}"/></w:rPr></w:pPr>{body}</w:p>'


_ids = iter(range(1, 1000))


def pic(w=100, h=50):
    cx, cy, i = round(w * 12700), round(h * 12700), next(_ids)
    return (f'<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>'
            f'<wp:docPr id="{i}" name="Picture {i}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:nvPicPr><pic:cNvPr id="{i}" name="Picture {i}"/><pic:cNvPicPr/></pic:nvPicPr>'
            '<pic:blipFill><a:blip r:embed="rImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
            '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')


def table(cell):
    return ('<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>'
            f'<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>{cell}</w:tc></w:tr></w:tbl>')


EXACT = '<w:spacing w:after="0" w:line="280" w:lineRule="exact"/>'
DOUBLE = '<w:spacing w:after="0" w:line="480" w:lineRule="auto"/>'
NUM = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
CASES = [   # (name, as Word draws it, paragraph XML)
    ('picture alone, 12pt mark', True, para(pic(), 24)),
    ('picture alone, 28pt mark', True, para(pic(), 56)),
    ('small picture alone (8pt), 12pt mark', False, para(pic(10, 8), 24)),
    ('picture with text on its line', True, para(run('text ') + pic() + run(' text'))),
    ('picture alone in a table cell', True, table(para(pic(), 24))),
    ('big first run, then smaller text on more lines', True, para(run('BIG ', 48) + run(LONG))),
    ('big spaces in small text', True, para(run('small text') + run('      ', 56) + run('more small text'))),
    ('big tab in small text', True, para(run('small') + tab(56) + run('text after the tab'))),
    ('only spaces, 28pt, 10pt mark', False, para(run('      ', 56))),
    ('Shift+Enter twice: a line, an empty line, a line', True, para(run('first line') + br() + br() + run('third line'))),
    ('Shift+Enter at the end of the paragraph', True, para(run('a line, then a break') + br())),
    ('big paragraph mark after small text', False, para(run('small text, big mark'), 56)),
    ('exact 14pt, big first run then smaller text', True, para(run('BIG ', 48) + run(LONG), spacing=EXACT)),
    ('double spacing, picture alone', False, para(pic(), 24, spacing=DOUBLE)),
    ('empty numbered paragraph', False, para('', extra=NUM)),
]


def make(out):
    body = para(run('M0')) + ''.join(c[2] + para(run(f'M{i + 1}')) for i, c in enumerate(CASES))
    doc = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}'
           '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" '
           'w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>')
    styles = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {W}><w:docDefaults><w:rPrDefault><w:rPr>'
              '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="20"/></w:rPr>'
              '</w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
              '<w:name w:val="Normal"/></w:style></w:styles>')
    settings = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings {W}><w:compat><w:compatSetting '
                'w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>')
    numbering = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering {W}><w:abstractNum w:abstractNumId="0">'
                 '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>'
                 '<w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr><w:sz w:val="16"/></w:rPr></w:lvl></w:abstractNum>'
                 '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
    drels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             f'<Relationship Id="rS" Type="{R}styles" Target="styles.xml"/><Relationship Id="rT" Type="{R}settings" Target="settings.xml"/>'
             f'<Relationship Id="rN" Type="{R}numbering" Target="numbering.xml"/><Relationship Id="rImg" Type="{R}image" Target="media/p.png"/></Relationships>')
    # a 1x1 blue PNG, so the tool needs no image library
    png = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763'
                        '7090f80f00020101007fb0ee6f0000000049454e44ae426082')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, s in [('[Content_Types].xml', ct), ('_rels/.rels', rels), ('word/document.xml', doc), ('word/styles.xml', styles),
                     ('word/settings.xml', settings), ('word/numbering.xml', numbering), ('word/_rels/document.xml.rels', drels)]:
            z.writestr(n, s)
        z.writestr('word/media/p.png', png)
    print(f'saved {out}: {len(CASES)} cases')


def read(pdf, out=None):
    xml = subprocess.run(['pdftotext', '-bbox-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout
    tops = {}
    for page, body in enumerate(re.findall(r'<page\b.*?</page>', xml, re.S)):
        for y, word in re.findall(r'<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">(M\d+)</word>', body):
            tops[int(word[1:])] = (page, float(y))
    cases = []
    for i, (name, word, _) in enumerate(CASES):
        a, b = tops.get(i), tops.get(i + 1)
        cases.append({'case': name, 'asWord': word, 'pt': round(b[1] - a[1], 2) if a and b and a[0] == b[0] else None})
    text = json.dumps({'pdf': 'LibreOffice', 'cases': cases}, indent=1) + '\n'
    if out:
        open(out, 'w').write(text)
        print(f'saved {out}: {sum(c["pt"] is not None for c in cases)} of {len(cases)} cases measured')
    else:
        print(text, end='')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'make':
        make(sys.argv[2] if len(sys.argv) > 2 else 'tests/quire/lines/linecases.docx')
    elif len(sys.argv) > 2 and sys.argv[1] == 'read':
        read(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    else:
        sys.exit(__doc__)
