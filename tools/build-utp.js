// Erzeugt app/data-utp.js (window.UTP) aus den Gast-Seiten der Übungen im Unihockey-Trainingsplaner (UTP) von swiss unihockey.
//   node tools/build-utp.js            alle Übungen holen (nur die Adressen aus RTP.links/linksBy), Zwischenstand in tools/.utp-cache.json
//   node tools/build-utp.js --limit 3  nur die ersten 3 noch fehlenden (zum Testen)
//   node tools/build-utp.js --offline  nichts abrufen, data-utp.js nur aus dem Cache neu schreiben (z. B. nach Änderung der Materialliste)
// Texte © swiss unihockey; Verwendung mit Einverständnis, nicht-kommerziell. Es werden keine Bilder/Videos geladen und keine Personendaten gespeichert.
// Ablauf wie die Gast-Seite selbst: Seite laden (Cookie + CSRF-Token), dann POST api/model/query mit dem Secret aus der Adresse.
const fs = require('fs'), path = require('path');
global.window = {}; require('../app/data-rtp.js');
const R = window.RTP, BASE = R.utpBase.replace(/guest\/exercises\/$/, '');
const CACHE = path.join(__dirname, '.utp-cache.json'), OUT = path.join(__dirname, '..', 'app', 'data-utp.js');
const arg = n => process.argv.includes(n), limit = arg('--limit') ? +process.argv[process.argv.indexOf('--limit') + 1] : Infinity, PAUSE = 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Umwandlung slate -> reiner Text ----------
const clean = s => String(s).replace(/[ ​]/g, ' ').replace(/[ \t]+/g, ' ');
const inline = n => n.text !== undefined ? n.text : (n.children || []).map(inline).join('');
function blockLines(n, out, ind = '') {
  if (n.type === 'ul' || n.type === 'ol') {
    (n.children || []).forEach((li, i) => {
      const own = (li.children || []).filter(c => c.type !== 'ul' && c.type !== 'ol').map(inline).join('');
      out.push(ind + (n.type === 'ol' ? `${i + 1}. ` : '• ') + clean(own).trim());
      (li.children || []).filter(c => c.type === 'ul' || c.type === 'ol').forEach(c => blockLines(c, out, ind + '  '));
    });
  } else { const t = clean(inline(n)).trim(); if (t) out.push(ind + t); }
}
const slateLines = nodes => { const out = []; (nodes || []).forEach(n => blockLines(n, out)); return out.filter(l => l.trim() && l.trim() !== '•'); };
const asObj = c => typeof c === 'string' ? JSON.parse(c) : c;

function convert(e) {   // Antwort der API -> kompakter Eintrag (nur Inhalt, keine Personendaten)
  const secs = []; let cur = null, video = '';
  const push = (el) => {
    const m = String(el.modelName || '').split('\\').pop();
    if (m === 'Heading') { const c = asObj(el.content); cur = { h: clean(slateLines(c.slate).join(' ')).trim(), l: +el.level || 1, t: [] }; secs.push(cur); }
    else if (m === 'Text') { if (!cur) { cur = { h: '', l: 0, t: [] }; secs.push(cur); } cur.t.push(...slateLines(asObj(el.content).slate)); }
    else if (m === 'HighlightedElement') asObj(el.content).forEach(push);
    else if (m === 'IFrame') { if (/youtu|vimeo/.test(el.url || '') && !video) video = el.url; }
  };
  (e.content || []).forEach(push);
  const tg = {}, put = (k, v) => { (tg[k] = tg[k] || []).push(v); };
  for (const t of e.tags || []) { const [k, ...r] = t.split('__'); const v = r.join(' › '); if (k === 'Stufe') put('st', v); else if (k === 'Schwerpunkt') put('sp', v); else if (k === 'Trainingsteil') put('tt', v); else if (k === 'Entwicklungsfaktoren') put('ef', v); }
  const o = { t: e.title || '', s: secs.filter(s => s.h || s.t.length).map(s => [s.h, s.l, s.t.join('\n')]) };
  if (+e.duration) o.d = +e.duration; if (Object.keys(tg).length) o.tg = tg; if (video) o.v = video;
  return o;
}

// ---------- Material erkennen (Wortliste; lieber zu wenig als Falsches) ----------
const L = '(?<![a-zäöüß])', E = '(?![a-zäöüß])', W = (...w) => new RegExp(L + '(?:' + w.join('|') + ')' + E);
const MAT = [   // Reihenfolge = Anzeigereihenfolge. Aus den häufigsten Substantiven der echten Texte gewählt; Tätigkeiten und Ortsangaben (Torschuss, Bande, Wand, Stock) bewusst nicht.
  ['Bälle', W('ball', 'bälle', 'bällen', 'balles', 'unihockeyball', 'unihockeybälle')], ['Tore', /(?<![a-zäöüß])(?:tor|tore|toren)(?![a-zäöüß])(?!\s+(?:erzielt|erzielen|zählen|zählt|gezählt|geschossen|fallen|gewinnt))/], ['Minitore', /minitor/],
  ['Hütchen', /hütchen|pylone/], ['Markierungen', /markierung|malstab|malstäbe|kegel/], ['Leibchen', /leibchen/], ['Reifen', W('reifen')],
  ['Matten', /(?<![a-zäöüß])matten?(?![a-zäöüß])|gymnastikmatte|turnmatte/], ['Langbank', /langbank|langbänke/], ['Schwedenkasten', /schwedenkast|kastenelement|sprungkasten/],
  ['Seile', W('seil', 'seile', 'seilen', 'springseil', 'springseile')], ['Medizinball', /medizinball|medizinbälle/], ['Hanteln', /hantel/],
  ['Widerstandsband', /resistance.?band|widerstandsband|theraband|gummiband/], ['Tennis-/Softbälle', /tennisball|tennisbälle|softball|softbälle/],
  ['Koordinationsleiter', /koordinationsleiter|laufleiter/], ['Sprossenwand', /sprossenwand/],
];
function detectMat(o) {
  const txt = o.s.filter(x => x[0] !== 'Coachingfragen').map(x => x[2]).join(' ').toLowerCase();
  return MAT.filter(([, re]) => re.test(txt)).map(x => x[0]).join(', ');
}

// ---------- Abruf ----------
async function session(id, secret) {
  const pr = await fetch(`${BASE}guest/exercises/${id}?secret=${secret}`, { signal: AbortSignal.timeout(20000) });
  const cookie = (pr.headers.getSetCookie ? pr.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  const csrf = ((await pr.text()).match(/"X-CSRF-TOKEN":"([^"]+)"/) || [])[1];
  if (!csrf) throw new Error('kein CSRF-Token');
  return { cookie, csrf };
}
async function fetchOne(id, secret, ses) {
  const r = await fetch(`${BASE}api/model/query`, { method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': ses.csrf, Authorization: 'Bearer ' + secret, Cookie: ses.cookie },
    body: JSON.stringify({ where: { modelName: 'App\\Models\\Exercise', id }, relations: { content: '**' } }) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const e = ((await r.json()).data || [])[0]; if (!e) throw new Error('leer');
  return convert(e);   // owner/uploader o. Ä. werden nie übernommen
}

(async () => {
  const all = new Map(), add = rel => { const [id, q] = String(rel).split('?secret='); if (id && q && !all.has(id)) all.set(id, q); };
  Object.values(R.links || {}).forEach(add); Object.values(R.linksBy || {}).forEach(o => Object.values(o).forEach(add));
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { /* neu */ }
  const todo = [...all].filter(([id]) => !cache[id]).slice(0, arg('--offline') ? 0 : limit);
  console.log(`${all.size} Übungen, ${Object.keys(cache).length} im Cache, ${todo.length} werden geholt`);
  let ses = null, err = 0, n = 0; const errs = [];
  for (const [id, secret] of todo) {
    try {
      if (!ses) ses = await session(id, secret);
      let o; try { o = await fetchOne(id, secret, ses); } catch (e) { if (/419|403/.test(e.message)) { ses = await session(id, secret); o = await fetchOne(id, secret, ses); } else throw e; }
      cache[id] = o;
    } catch (e) { err++; errs.push(`${id}: ${e.message}`); }
    if (++n % 20 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); console.log(`${n}/${todo.length}`); }
    await sleep(PAUSE);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  const ex = {}; let withMat = 0;
  for (const [id] of all) { const o = cache[id]; if (!o) continue; const mat = detectMat(o); if (mat) { o.m = mat; withMat++; } ex[id] = o; }
  const js = '// Erzeugt von tools/build-utp.js – nicht von Hand ändern. Übungstexte © swiss unihockey (Unihockey-Trainingsplaner), Verwendung mit Einverständnis, nicht-kommerziell.\nwindow.UTP = ' + JSON.stringify({ generated: new Date().toISOString().slice(0, 10), ex }) + ';\n';
  fs.writeFileSync(OUT, js);
  console.log(`data-utp.js: ${Object.keys(ex).length} Übungen, ${withMat} mit erkanntem Material, ${(js.length / 1024).toFixed(0)} KB; Fehler: ${err}`); errs.slice(0, 10).forEach(x => console.log('  ' + x));
})().catch(e => { console.error(e); process.exit(1); });
