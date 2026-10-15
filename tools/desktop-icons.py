#!/usr/bin/env python3
"""Regenerate the desktop app's icons (needs librsvg2-bin and ImageMagick): each app's document icon for Windows
from its SVG, and the macOS app icon (desktop/icons/icon.icns) from public/icons/icon.svg."""
from pathlib import Path
import re
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def render(svg, size):
    """svg (text) as a size × size PNG. librsvg keeps the 16-unit SVGs' strokes at the right scale; ImageMagick's
    internal SVG renderer can lose the white letter/screen strokes when enlarging these icons."""
    return subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size)], input=svg.encode(),
                          capture_output=True, check=True).stdout


for app in ("quire", "ledger", "lectern"):
    source = (ROOT / "public" / app / "js/app.js").read_text()
    match = re.search(r"L\.icons\.app = function \(size\) \{.*?return `(.*?)`;", source, re.S)
    if not match:
        raise SystemExit(f"Cannot find {app}'s application icon")
    svg = match[1].replace("${sz}", "256").replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')
    subprocess.run([
        "convert", "png:-", "-define", "icon:auto-resize=256,128,64,48,32,24,16",
        str(ROOT / "desktop/icons" / f"{app}.ico"),
    ], input=render(svg, 256), check=True)
    print(f"desktop/icons/{app}.ico")

# macOS: the icon on Apple's grid, its rounded square 824 of 1024 units wide and centred (the web icon's square is 464
# of 512), each size drawn from the SVG. ICNS is a list of (type, PNG) entries: 16 to 512 points at 1x and 2x, the
# 1024 px one (ic10) being what the App Store asks for.
web = (ROOT / "public/icons/icon.svg").read_text()
head, body = web.split("</defs>", 1)
body = body.rsplit("</svg>", 1)[0]
mac = f'{head}</defs>\n<g transform="translate(256 256) scale({412 / 464:.4f}) translate(-256 -256)">{body}</g>\n</svg>\n'
ICNS = [("icp4", 16), ("ic11", 32), ("icp5", 32), ("ic12", 64), ("ic07", 128), ("ic13", 256), ("ic08", 256),
        ("ic14", 512), ("ic09", 512), ("ic10", 1024)]
pngs = {size: render(mac, size) for size in {s for _, s in ICNS}}
entries = b"".join(kind.encode() + struct.pack(">I", 8 + len(pngs[size])) + pngs[size] for kind, size in ICNS)
(ROOT / "desktop/icons/icon.icns").write_bytes(b"icns" + struct.pack(">I", 8 + len(entries)) + entries)
print("desktop/icons/icon.icns")
