// Liest die RTP-Excel-Dateien (swiss unihockey) und erzeugt app/data-rtp.js
// Aufruf:  node tools/build-rtp.js
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const SRC = path.join(__dirname, '..');
const OUT = path.join(__dirname, '..', 'app', 'data-rtp.js');

const STAGES = [
  { id: 'F', match: /F-Jun/, name: 'F-Junioren' },
  { id: 'E', match: /E-Jun/, name: 'E-Junioren' },
  { id: 'D', match: /D-Jun/, name: 'D-Junioren' },
  { id: 'U14', match: /U14M/, name: 'U14 Männer / U17 Frauen' },
  { id: 'U16', match: /U16M/, name: 'U16 Männer / U17 Frauen', draft: true },
  { id: 'U18', match: /U18M/, name: 'U18 Männer / U21 Frauen', draft: true },
];

// ---------- minimal zip + xlsx reader ----------
function unzip(file) {
  const b = fs.readFileSync(file), files = {};
  let e = b.length - 22;
  while (b.readUInt32LE(e) !== 0x06054b50) e--;
  let n = b.readUInt16LE(e + 10), p = b.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20);
    const nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32);
    const off = b.readUInt32LE(p + 42), name = b.toString('utf8', p + 46, p + 46 + nl);
    const ds = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    const raw = b.subarray(ds, ds + csize);
    files[name] = () => (method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');
    p += 46 + nl + el + cl;
  }
  return files;
}
const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
const colNum = c => [...c].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const clean = s => (s || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();

function readBook(file) {
  const z = unzip(file);
  const ss = [...z['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const names = [...z['xl/workbook.xml']().matchAll(/<sheet [^>]*name="([^"]*)"/g)].map(m => dec(m[1]));
  return names.map((name, i) => {
    const xml = z[`xl/worksheets/sheet${i + 1}.xml`]();
    const g = {}, lk = {}; let maxR = 0;
    const relXml = z[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`], rels = {};
    if (relXml) for (const m of relXml().matchAll(/<Relationship\b[^>]*>/g)) {
      const id = (m[0].match(/\bId="([^"]*)"/) || [])[1], tg = (m[0].match(/\bTarget="([^"]*)"/) || [])[1];
      if (id && tg && /relationships\/hyperlink"/.test(m[0]) && /TargetMode="External"/.test(m[0])) rels[id] = dec(tg);
    }
    for (const m of xml.matchAll(/<hyperlink\b[^>]*>/g)) {   // ref="K4" oder ref="I4:I5" (Bereich: Verweis gilt für die erste Zelle)
      const id = (m[0].match(/r:id="([^"]*)"/) || [])[1], ref = m[0].match(/\bref="([A-Z]+)(\d+)/);
      if (id && rels[id] && ref) lk[+ref[2] + ':' + colNum(ref[1])] = rels[id];
    }
    for (const r of xml.matchAll(/<row [^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      for (const c of r[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (!c[3]) continue;
        const v = (c[3].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const val = clean(/t="s"/.test(c[2]) ? ss[+v] : (v !== undefined ? dec(v) : ''));
        if (val) { (g[+r[1]] = g[+r[1]] || {})[colNum(c[1])] = val; maxR = Math.max(maxR, +r[1]); }
      }
    }
    // verbundene Zellen: Wert des Ankers in alle Zellen kopieren
    for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)) {
      const c1 = colNum(m[1]), r1 = +m[2], c2 = colNum(m[3]), r2 = +m[4];
      const v = g[r1] && g[r1][c1]; if (!v) continue;
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { (g[r] = g[r] || {})[c] = v; if (lk[r1 + ':' + c1] && !lk[r + ':' + c]) lk[r + ':' + c] = lk[r1 + ':' + c1]; }
      maxR = Math.max(maxR, r2);
    }
    return { name, g, maxR, cell: (r, c) => (g[r] && g[r][typeof c === 'string' ? colNum(c) : c]) || '', link: (r, c) => lk[r + ':' + (typeof c === 'string' ? colNum(c) : c)] || '' };
  });
}

// ---------- Links (Hyperlinks der Zellen) ----------
// Die Namen der Trainingsformen sind in den Excel-Dateien Hyperlinks auf die Übung im UTP. Es wird nur die Adresse gespeichert,
// nie der Inhalt (Beschreibung, Skizze, Video) – der gehört swiss unihockey.
const UTP_BASE = 'https://utp.swissunihockey.ch/guest/exercises/';
const normName = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();   // wie norm() in app.js
const LINKS = {}, SL = {}, STATS = {};   // normName -> Adresse (ohne UTP_BASE); STATS[stufe] = { forms:Set, linked:Set }
let curStage = '';
function reg(name, url) {
  const k = normName(name); if (!k) return;
  const s = STATS[curStage] = STATS[curStage] || { forms: new Set(), linked: new Set(), conflicts: 0 };
  s.forms.add(k);
  if (!url || !url.startsWith(UTP_BASE)) return;
  const rel = url.slice(UTP_BASE.length); s.linked.add(k);
  const sl = SL[curStage] = SL[curStage] || {};   // pro Stufe: erster Link zu diesem Namen
  if (!sl[k]) sl[k] = rel; else if (sl[k] !== rel) s.conflicts++;
  if (!LINKS[k]) LINKS[k] = rel;
}
const blockNr = s => +(String(s).match(/(\d+)/) || [0, 0])[1];
const splitEvents = s => clean(s).split(/[;\n]/).map(x => x.trim()).filter(Boolean);
const one = s => clean(s).replace(/\n/g, ' ');

// ---------- Mikroplanung (F, E, D): eine Zeile = ein Training ----------
function parseMikro(sh) {
  let hr = 1; while (hr < 6 && !/Woche/.test(sh.cell(hr, 'D'))) hr++;
  if (/^Ausbildungsziel/.test(sh.cell(hr + 1, 'G'))) hr++;   // zweizeiliger Kopf (D-Junioren)
  const slots = [], cols = {};
  for (let c = 8; c <= 16; c++) {
    const h = sh.cell(hr, c) || (hr > 1 && sh.cell(hr - 1, c)); if (!h) continue;
    const [label, dur] = sh.cell(hr, c).split('\n').map(x => x.trim());
    if (/Regel/.test(label)) { cols.regel = c; continue; }
    const mins = (dur || '').match(/(\d+)(?:\s*-\s*(\d+))?/);
    slots.push({ key: 's' + c, col: c, label: label.replace(/,$/, ''), min: mins ? +(mins[2] || mins[1]) : 10, dur: one(dur || '') });
  }
  const blocks = []; let cur = null, phase = '', week = 0, last = {};
  for (let r = hr + 1; r <= sh.maxR; r++) {
    const has = slots.some(s => sh.cell(r, s.col)); if (!has) continue;
    phase = sh.cell(r, 'B') || phase;
    const nr = blockNr(sh.cell(r, 'C')) || (cur && cur.nr);
    if (!cur || nr !== cur.nr) {
      cur = { nr, phase, main: { ef: one(sh.cell(r, 'E')), sp: one(sh.cell(r, 'F')), ziel: one(sh.cell(r, 'G')) }, sec: null, events: [], regel: [], weeks: [] };
      blocks.push(cur); last = {};
    }
    week = +sh.cell(r, 'D') || week;
    let w = cur.weeks.find(x => x.w === week); if (!w) cur.weeks.push(w = { w: week, events: [], trainings: [] });
    const t = {};
    for (const s of slots) {
      let v = one(sh.cell(r, s.col));
      if (v && !/Athletik/.test(s.label)) reg(v, sh.link(r, s.col));
      if (!v && /^Warm-up$/i.test(s.label)) v = last[s.key] || '';   // "Swiss Way Warm-up" gilt für den ganzen Block
      if (v) { t[s.key] = v; last[s.key] = v; }
    }
    w.trainings.push(t);
    const rg = cols.regel && one(sh.cell(r, cols.regel)); if (rg && !cur.regel.includes(rg)) cur.regel.push(rg);
  }
  return { slots: slots.map(({ col, ...s }) => s), blocks };
}

// ---------- Makro (F, E, D): Termine pro Woche ----------
function parseMakroWeeks(sh, blocks) {
  let wr = 0, er = 0;
  for (let r = 1; r <= 10; r++) { const b = sh.cell(r, 'B'); if (/^Woche/.test(b)) wr = r; if (/Termine/.test(b)) er = r; }
  const seen = new Set();
  for (let c = 3; c <= 50; c++) {
    const w = +sh.cell(wr, c), ev = one(sh.cell(er, c)); if (!w || !ev || seen.has(ev + w)) continue; seen.add(ev + w);
    for (const b of blocks) { const wk = b.weeks.find(x => x.w === w); if (wk) wk.events.push(ev); }
  }
  let annahme = ''; for (let c = 3; c <= 5; c++) annahme = annahme || sh.cell(2, c) || sh.cell(1, c);
  return one(annahme);
}

// ---------- Meso (U14, U16, U18) ----------
function parseMeso(sh) {
  const hr = 2, col = {}; let n = 0;
  for (let c = 5; c <= 15; c++) {
    const h = sh.cell(hr, c); if (!h) continue;
    if (/^Erscheinungsform/.test(h)) { n++; col['ef' + n] = c; }
    else if (/^Schwerpunkt/.test(h)) col['sp' + n] = c;
    else if (/^Ausbildungsziel/.test(h)) col['zi' + n] = c;
    else if (/^Good Practice/.test(h)) col['gp' + n] = c;
  }
  const blocks = []; let cur = null, phase = '';
  for (let r = hr + 1; r <= sh.maxR; r++) {
    const nr = blockNr(sh.cell(r, 'C')); if (!nr) continue;
    phase = sh.cell(r, 'B') || phase;
    if (!cur || cur.nr !== nr) {
      const mk = i => {
        const ef = one(sh.cell(r, col['ef' + i])), sp = one(sh.cell(r, col['sp' + i])), ziel = one(sh.cell(r, col['zi' + i]));
        if (!ef) return null;
        return ef === sp || /^Frei gew/.test(ef) ? { ef: 'Frei gewählte Inhalte', sp: '', ziel: ef, gp: [] } : { ef, sp, ziel, gp: [] };
      };
      cur = { nr, phase: one(phase), main: mk(1) || { ef: '', sp: '', ziel: '', gp: [] }, sec: mk(2), events: splitEvents(sh.cell(r, 'D')), regel: [], weeks: [] };
      blocks.push(cur);
    }
    for (const i of [1, 2]) {
      const v = col['gp' + i] && one(sh.cell(r, col['gp' + i])), tgt = i === 1 ? cur.main : cur.sec;
      if (v) reg(v, sh.link(r, col['gp' + i]));
      if (v && tgt && !tgt.gp.includes(v)) tgt.gp.push(v);
    }
  }
  return blocks;
}
function parseMakroMonths(sh, blocks) {
  let mr = 0, br = 0;
  for (let r = 1; r <= 8; r++) { const b = sh.cell(r, 'B'); if (/^Monat/.test(b)) mr = r; if (/^Trainingsblock/.test(b)) br = r; }
  for (let c = 3; c <= 20; c++) { const b = blocks.find(x => x.nr === +sh.cell(br, c)); if (b) b.monat = sh.cell(mr, c); }
  return one(sh.cell(1, 'C'));
}

// ---------- Mikro Athletik ----------
function parseAthletik(sh, blocks) {
  let cur = null, sess = null, last = {};
  for (let r = 2; r <= sh.maxR; r++) {
    const d = sh.cell(r, 'D');
    if (/^Ausbildungsziel/.test(d)) {
      cur = blocks.find(b => b.nr === blockNr(sh.cell(r, 'C'))); if (!cur) continue;
      const labels = sh.cell(r, 'F').split('\n'), goals = sh.cell(r, 'G').split('\n');
      const ziele = /:\s*$/.test(labels[0] || '') ? goals.map((t, i) => ({ faktor: (labels[i] || '').replace(':', '').trim(), text: t.trim() })) : [{ faktor: '', text: one(sh.cell(r, 'F')) }];
      cur.athletik = { ziele: ziele.filter(z => z.text), sessions: [] }; sess = null; last = {}; continue;
    }
    if (/^Woche/.test(d) || !cur || !cur.athletik) continue;
    const form = one(sh.cell(r, 'G')), key = one(sh.cell(r, 'L')); if (!form && !key && !sh.cell(r, 'H')) continue;
    if (form) reg(form, sh.link(r, 'G'));
    const w = one(sh.cell(r, 'D')) || last.w, t = one(sh.cell(r, 'E')) || last.t, f = one(sh.cell(r, 'F')) || last.f;
    if (!sess || w !== last.w || t !== last.t || f !== last.f) {
      sess = { woche: w, training: t, nums: (t.match(/\d+/g) || []).map(Number), faktor: f, items: [] }; cur.athletik.sessions.push(sess);
    }
    last = { w, t, f };
    sess.items.push({ form, whg: one(sh.cell(r, 'H')), serien: one(sh.cell(r, 'I')), gewicht: one(sh.cell(r, 'J')), rhythmus: one(sh.cell(r, 'K')), keypoints: key });
  }
}

// ---------- main ----------
const files = fs.readdirSync(SRC).filter(f => /^Rahmentrainingspl.*\.xlsx$/.test(f));
const out = { generated: new Date().toISOString().slice(0, 10), efs: {}, hints: [], stages: [] };
for (const st of STAGES) {
  const f = files.find(x => st.match.test(x)); if (!f) { console.warn('fehlt:', st.id); continue; }
  curStage = st.id;
  const book = readBook(path.join(SRC, f)), find = re => book.find(s => re.test(s.name));
  const stage = { id: st.id, name: st.name, draft: !!st.draft, source: f, notes: [] };
  const info = find(/EF|Einordnung/);
  if (info && !out.hints.length) {
    let sec = '';
    for (let r = 1; r <= info.maxR; r++) {
      const v = info.cell(r, 'B'); if (!v) continue;
      if (/^Technik/.test(v)) { sec = 'teta'; out.efs.teta = []; } else if (/^Athletik/.test(v)) { sec = 'athletik'; out.efs.athletik = []; }
      else if (/^Wichtige Hinweise/.test(v)) sec = 'hints';
      else if (sec === 'hints') out.hints.push(one(v)); else if (sec) out.efs[sec].push(one(v));
    }
  }
  const mikro = find(/Mikro$/), meso = find(/Meso/), makro = find(/Makro/), ath = find(/Athletik/), ged = find(/Ausbildungsgedanken/);
  if (mikro) { const m = parseMikro(mikro); stage.slots = m.slots; stage.blocks = m.blocks; stage.annahme = parseMakroWeeks(makro, stage.blocks); }
  else { stage.slots = null; stage.blocks = parseMeso(meso); stage.annahme = parseMakroMonths(makro, stage.blocks); }
  if (ath) parseAthletik(ath, stage.blocks);
  if (ged) { let t = null; for (let r = 2; r <= ged.maxR; r++) { const v = ged.cell(r, 'A'); if (!v) continue; if (v.length < 40) stage.notes.push(t = { title: v, text: [] }); else if (t) t.text.push(one(v)); } }
  const m = stage.annahme.match(/(\d)\s*Training.*?(\d+(?:[.,]\d)?)\s*(Min|min|h)/);
  stage.perWeek = m ? +m[1] : 2; stage.minutes = m ? (/h/.test(m[3]) ? Math.round(parseFloat(m[2].replace(',', '.')) * 60) : +m[2]) : 90;
  out.stages.push(stage);
  console.log(st.id, stage.blocks.length, 'Blöcke,', stage.blocks.reduce((a, b) => a + b.weeks.reduce((x, w) => x + w.trainings.length, 0), 0), 'Trainings,',
    stage.blocks.filter(b => b.athletik).length, 'Athletikblöcke,', stage.perWeek + 'x' + stage.minutes);
}
out.utpBase = UTP_BASE; out.links = LINKS; out.linksBy = {};   // links: Name -> Adresse; linksBy[stufe]: nur dort, wo die Stufe eine andere Adresse für denselben Namen hat
for (const [id, sl] of Object.entries(SL)) for (const [k, rel] of Object.entries(sl)) if (rel !== LINKS[k]) (out.linksBy[id] = out.linksBy[id] || {})[k] = rel;
console.log('abweichende Links pro Stufe (gleicher Name, andere Übung im UTP):', Object.entries(out.linksBy).map(([id, m]) => id + ' ' + Object.keys(m).length).join(', '));
console.log('Trainingsformen (eindeutige Namen) und Links pro Stufe:');
let tf = new Set(), tl = new Set();
for (const [id, s] of Object.entries(STATS)) { s.forms.forEach(x => tf.add(x)); s.linked.forEach(x => tl.add(x)); console.log(' ', id, s.forms.size, 'Formen,', s.linked.size, 'mit Link,', s.forms.size - s.linked.size, 'ohne,', s.conflicts, 'Namen mit mehreren Links innerhalb der Stufe'); }
console.log('  alle Stufen zusammen:', tf.size, 'Formen,', tl.size, 'mit Link');
// ---------- Bereinigung der Daten (die Excel-Originale bleiben unverändert) ----------
// Die Excel-Dateien kommen vom Verband und würden beim nächsten Update überschrieben. Darum stehen Korrekturen hier, nicht in den Dateien,
// und werden bei jedem Bauen angewendet.

// 1) Schwerpunkte (sp), Erscheinungsformen (ef) und Tippfehler in Ausbildungszielen vereinheitlichen.
// Links steht die Schreibweise in den Excel-Dateien, rechts die einheitliche. Gewählt wurde die häufigste bzw. sprachlich sauberste.
// Die Tabelle wird als RTP.spAlias / RTP.efAlias mitgeliefert: app.js benutzt sie, um gespeicherte Trainings, eigene Übungen und
// Merkzettel mit alter Schreibweise beim Laden anzupassen. Nur hier pflegen, nicht doppelt in app.js.
const SP_ALIAS = {
  '1. Gedanke Nachsetzen': '1. Gedanke nachsetzen',          // wie «1. Gedanke vorwärts»
  'Forechecking / Pressing': 'Forechecking und Pressing',      // «und» statt Schrägstrich (2 : 1)
  'Freilaufen, Anbieten': 'Freilaufen und Anbieten',           // «und» statt Komma (2 : 1 : 1)
  'Freilaufen, anbieten': 'Freilaufen und Anbieten',
  'Gezogen und Geschlagen schiessen': 'Geschlagen und gezogen schiessen',   // Gross-/Kleinschreibung, Reihenfolge der Mehrheit (2 : 1)
  'steuern und abdrängen': 'Steuern und abdrängen',            // Satzanfang gross
  'Unterzahl-situationen': 'Unterzahlsituationen',             // Tippfehler
  'aus dem Lauf schiessen': 'Aus dem Lauf schiessen',          // Satzanfang gross
  'effizient schiessen': 'Effizient schiessen',
  'unberechenbar schiessen': 'Unberechenbar schiessen',
  'vielseitig schiessen': 'Vielseitig schiessen',
};
const EF_ALIAS = {   // Standardliste = Erscheinungsformen im Info-Blatt der Excel-Dateien (out.efs.teta)
  'Defensive 1:1-Situaitonen bestimmen': 'Defensive 1:1-Situationen bestimmen',   // Tippfehler
  'Gemeinsam und druckvoll Räume schliessen': 'Gemeinsam und druckvoll die Räume schliessen',
  'Gemeinsam wirkungsvoll das Spiel aufbauen': 'Gemeinsam und wirkungsvoll das Spiel aufbauen',
  'Klare Torchancen erarbeiten und Tore erzielen': 'Torchancen erarbeiten und Tore erzielen',
};
// Eindeutige Tippfehler in Ausbildungszielen (Teilstring -> Ersatz)
const ZIEL_FIX = [
  ['gegnersichem', 'gegnerischem'], ['reduziertem gegnerischen Druck', 'reduziertem gegnerischem Druck'],
  ['ohne Gegnerischen Einfluss', 'ohne gegnerischen Einfluss'], ['Frei gewählt Inhalte', 'Frei gewählte Inhalte'],
  ['beid- und einhändige in', 'beid- und einhändig in'],
];
const REPORT = { sp: {}, ef: {}, ziel: {} };
const fixTxt = (kind, v, tbl) => { const n = tbl[v] || v; if (n !== v) { const k = v + ' → ' + n; REPORT[kind][k] = (REPORT[kind][k] || 0) + 1; } return n; };
for (const st of out.stages) for (const b of st.blocks) for (const p of [b.main, b.sec]) if (p) {
  p.sp = fixTxt('sp', p.sp, SP_ALIAS); p.ef = fixTxt('ef', p.ef, EF_ALIAS);
  for (const [x, y] of ZIEL_FIX) if (p.ziel.includes(x)) { REPORT.ziel[x + ' → ' + y] = (REPORT.ziel[x + ' → ' + y] || 0) + 1; p.ziel = p.ziel.split(x).join(y); }
}
out.spAlias = SP_ALIAS; out.efAlias = EF_ALIAS;
console.log('Vereinheitlicht (Anzahl Blöcke):', JSON.stringify(REPORT, null, 1));

// 2) Themen, die in der App nicht erscheinen sollen: Kick-off und Elterninfo, Ausbildungsverantwortliche (AV), Trainingsbesuch AV, SpuSp-Gespräche, Staffmeeting, Vereinsmeeting.
// Gefiltert wird in Ereignissen der Blöcke und Wochen, in den Ausbildungsgedanken und im Glossar.
const DROP = /Kick-off|Elterninfo|Staffmeeting|Vereinsmeeting|SpuSp|Trainingsbesuch|Ausbildungsverantwortliche|\bAV\b/;
let dropped = 0;
for (const st of out.stages) {
  for (const b of st.blocks) {
    const keep = l => l.filter(e => { const d = DROP.test(e); if (d) dropped++; return !d; });
    b.events = keep(b.events); for (const w of b.weeks) w.events = keep(w.events);
  }
  // Satz über die Staffmeetings in den Ausbildungsgedanken (U14) streichen
  const SATZ = ' Die Staffmeetings (siehe Termine/Events) dienen zur laufenden Planung/Übersicht der Schwerpunkte.';
  for (const n of st.notes) n.text = n.text.map(x => x.split(SATZ).join(''));
}
console.log('Ereignisse entfernt:', dropped);

// Glossar «Termine & Abkürzungen»: leer. Die Erklärungen zu Ferien und Saisonpause erscheinen nicht mehr in den Hinweisen zum RTP
// (die Termine in den Wochen bleiben). Das Feld bleibt als leeres Objekt, damit alte Versionen der App nicht brechen.
out.glossary = {};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, '// Automatisch erzeugt aus den Rahmentrainingsplänen (RTP) von swiss unihockey – tools/build-rtp.js\nwindow.RTP = ' + JSON.stringify(out) + ';\n');
console.log('geschrieben:', OUT, Math.round(fs.statSync(OUT).size / 1024) + ' KB');
