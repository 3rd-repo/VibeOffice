/* Open source licenses (oss-licenses.html, written by tools/oss-licenses.py): a file of its own, not inline in the
   page (the pages' Content-Security-Policy). */
/* a license is filled in when its entry is opened: from this page's texts (each kept once), or from its own file */
const TEXTS = JSON.parse(document.getElementById('texts').textContent);
for (const d of document.querySelectorAll('details')) {
  d.addEventListener('toggle', async () => {
    const pre = d.querySelector('pre');
    if (!d.open || pre.textContent) return;
    if (d.dataset.texts) { pre.textContent = d.dataset.texts.split(' ').map((k) => TEXTS[k]).join('\n\n' + '-'.repeat(60) + '\n\n'); return; }
    try {
      const res = await fetch(d.dataset.src);
      pre.textContent = res.ok ? await res.text() : 'See ' + d.dataset.src + '.';
    } catch (e) { pre.textContent = 'See ' + d.dataset.src + '.'; }
  });
}
