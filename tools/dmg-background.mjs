// The DMG window's background (desktop/macos/dmg-settings.py, docs/desktop.md): a light sky, an arrow from the app's
// icon to the Applications link, and Scout under it pointing the same way, drawn by his own rig (GestureRight).
// Sizes and the two icons' places are read from dmg-settings.py. Writes desktop/macos/dmg/background.png and
// background@2x.png; --preview also writes tmp/dmg-preview.png with stand-ins for the icons and their names.
//
//   node tools/dmg-background.mjs [--preview]
//
// Needs the Chromium at CDP 127.0.0.1:9222 (see docs/testing.md); starts tools/serve.py if needed.
import fs from 'fs';
import path from 'path';
import { ensureServer, openPage } from './ooxml/cdp.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const settings = fs.readFileSync(path.join(root, 'desktop/macos/dmg-settings.py'), 'utf8');
const num = (re) => { const m = settings.match(re); if (!m) throw new Error('dmg-settings.py: no ' + re); return m.slice(1).map(Number); };
const [W, H] = num(/window_rect = \(\(\d+, \d+\), \((\d+), (\d+)\)\)/);
const [ICON] = num(/icon_size = (\d+)/);
const APP = num(/'VibeOffice\.app': \((\d+), (\d+)\)/), APPS = num(/'Applications': \((\d+), (\d+)\)/);
const preview = process.argv.includes('--preview');

/** the page script: the picture, W × H, at the top left of the window */
const draw = (o) => `(async () => {
  const { W, H, ICON, APP, APPS, preview } = ${JSON.stringify(o)};
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;overflow:hidden;width:' + W + 'px;height:' + H + 'px';
  document.body.appendChild(host);
  const y = APP[1], x0 = APP[0] + ICON / 2 + 18, x1 = APPS[0] - ICON / 2 - 18, mid = (x0 + x1) / 2;
  /* the arc's end runs from its control point: the head turns with it */
  const head = Math.atan2(34, x1 - mid) * 180 / Math.PI;
  const cloud = (cx, cy, k) => '<g fill="#fff" opacity=".8" filter="url(#soft)" transform="translate(' + cx + ' ' + cy + ') scale(' + k + ')">'
    + '<ellipse cx="0" cy="6" rx="46" ry="11"/><circle cx="-18" cy="-2" r="14"/><circle cx="6" cy="-9" r="19"/><circle cx="27" cy="0" r="12"/></g>';
  host.innerHTML = \`<svg xmlns="http://www.w3.org/2000/svg" width="\${W}" height="\${H}" viewBox="0 0 \${W} \${H}" style="position:absolute;left:0;top:0">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d9e7fa"/><stop offset=".5" stop-color="#f1f5fb"/><stop offset=".85" stop-color="#fbf3e7"/>
      </linearGradient>
      <radialGradient id="sun" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#ffd9a0" stop-opacity=".75"/><stop offset=".45" stop-color="#ffe6c2" stop-opacity=".35"/><stop offset="1" stop-color="#fff0dc" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="arrow" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#7fb0e6"/><stop offset="1" stop-color="#2f6fb3"/>
      </linearGradient>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2"/></filter>
    </defs>
    <rect width="\${W}" height="\${H}" fill="url(#sky)"/>
    <ellipse cx="\${W * .8}" cy="\${H - 70}" rx="\${W * .38}" ry="\${H * .3}" fill="url(#sun)"/>
    \${cloud(W * .13, 62, 1)}\${cloud(W * .55, 38, .7)}\${cloud(W * .88, 84, .85)}
    <path d="M0 \${H - 58} C\${W * .2} \${H - 84} \${W * .42} \${H - 44} \${W * .62} \${H - 60} S\${W * .9} \${H - 76} \${W} \${H - 62} V\${H} H0Z" fill="#f6e7cf" opacity=".7"/>
    <path d="M0 \${H - 34} C\${W * .25} \${H - 50} \${W * .5} \${H - 22} \${W * .75} \${H - 36} S\${W} \${H - 40} \${W} \${H - 40} V\${H} H0Z" fill="#efdcbf" opacity=".6"/>
    <path d="M\${x0} \${y + 4} Q\${mid} \${y - 30} \${x1 - 8} \${y + 1}" fill="none" stroke="url(#arrow)" stroke-width="7" stroke-linecap="round" stroke-dasharray="0.1 15"/>
    <path d="M-24 -15 L0 0 L-24 15" transform="translate(\${x1} \${y + 4}) rotate(\${head})" fill="none" stroke="#2f6fb3" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>\`;
  const size = 180, s = new L.Scout({ mode: 'still', parent: host, size });
  s.el.style.cssText += ';position:absolute;margin:0;left:' + (mid - size * .5) + 'px;top:' + (H - size * 235 / 260 - 22) + 'px';
  s.pose('GestureRight', .92);
  if (preview) {
    const label = (x, text) => '<div style="position:absolute;left:' + (x - 70) + 'px;top:' + (y + ICON / 2 + 4) + 'px;width:140px;text-align:center;font:13px system-ui;color:#000">' + text + '</div>';
    host.insertAdjacentHTML('beforeend', '<img src="/icons/icon-512.png" style="position:absolute;left:' + (APP[0] - ICON / 2) + 'px;top:' + (y - ICON / 2) + 'px;width:' + ICON + 'px">'
      + '<div style="position:absolute;left:' + (APPS[0] - ICON / 2 + 8) + 'px;top:' + (y - ICON / 2 + 18) + 'px;width:' + (ICON - 16) + 'px;height:' + (ICON - 30) + 'px;border-radius:10px;background:linear-gradient(#6cb8f5,#2f8ee6)"></div>'
      + label(APP[0], 'VibeOffice') + label(APPS[0], 'Applications'));
    await new Promise((r) => setTimeout(r, 300));
  }
  return true;
})()`;

const stop = await ensureServer();
const page = await openPage('quire', { automated: true, persistence: false });
try {
  const out = path.join(root, 'desktop/macos/dmg');
  fs.mkdirSync(out, { recursive: true });
  await page.evaluate(draw({ W, H, ICON, APP, APPS, preview }));
  for (const [scale, file] of preview ? [[2, path.join(root, 'tmp/dmg-preview.png')]] : [[1, path.join(out, 'background.png')], [2, path.join(out, 'background@2x.png')]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: scale, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(path.relative(root, file));
  }
  if (page.errors.length) throw new Error(page.errors.join('\n'));
} finally {
  await page.close();
  stop();
}
