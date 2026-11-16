'use strict';
/* Unihockey Trainingsplaner – offline-fähige Web-App ohne Login. Daten liegen lokal im Browser (localStorage). */
const R = window.RTP, G = window.GOALIE;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stageById = id => R.stages.find(s => s.id === id);
const nl2br = s => esc(s).replace(/\n/g, '<br>');

// ---------- Speicher ----------
const KEY = 'unihockey-planer.v1';
const EMPTY = () => ({ v: 1, trainings: [], custom: [], notes: {}, season: {}, stage: 'D', teams: [], seasons: {} });
let DB = EMPTY();
try { DB = Object.assign(EMPTY(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* leer starten */ }
let saveT;
const flush = () => { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { toast('Speichern fehlgeschlagen'); } };
const save = () => { clearTimeout(saveT); saveT = setTimeout(flush, 200); };
addEventListener('pagehide', flush);

const S = { open: new Set(), pick: null, seed: { team: '', date: '' }, flow: null, done: null, lib: { q: '', kind: '', stage: '', sp: '', limit: 60 }, run: null, form: null };

// ---------- Typen & Farben ----------
const TYPES = {
  warmup: ['Warm-up / Vielseitigkeit', '#2e9e6b', 10], athletik: ['Athletik', '#8e5bd0', 10], skills: ['Skills / Einschiessen', '#0a8fa8', 10],
  gp: ['Good Practice', '#0a5fb4', 15], spiel: ['Spiel', '#d1495b', 20], goalie: ['Goalie-Übung', '#d9730d', 10], cooldown: ['Cool-Down / Ausklang', '#3f8f8f', 5], sonst: ['Sonstiges', '#6b7785', 10],
};
const slotType = l => /Athletik/.test(l) ? 'athletik' : /Warm-up|Vielseitigkeit/.test(l) ? 'warmup' : /Skills|Einschiessen/.test(l) ? 'skills' : /Good Practice/.test(l) ? 'gp' : /Spiel/.test(l) ? 'spiel' : 'sonst';
const EFC = [[/offensive 1/, '#e0a100'], [/aufbau/, '#2e9e6b'], [/torchance/, '#d1495b'], [/defensive 1/, '#0a5fb4'], [/raume/, '#5b4bc4'], [/ballgewinn/, '#0a8fa8'], [/ballverlust/, '#c2571a']];
const efColor = ef => (EFC.find(([re]) => re.test(norm(ef))) || [0, '#6b7785'])[1];

// ---------- Datum ----------
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => addDays(d, -((d.getDay() + 6) % 7));
const dm = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
const fmtDate = s => { if (!s) return ''; const d = pd(s); return `${WD[d.getDay()]}, ${dm(d)}${d.getFullYear()}`; };

// ---------- Mannschaften ----------
// DB.teams: [{ id, name, stage, color, ort, sessions:[{ id, wd:0-6, time:'HH:MM', min, ort }], days:[0-6], time:'HH:MM', min }]. Trainings behalten den Text t.team (Name) und bekommen zusätzlich t.teamId.
// sessions = die Trainingseinheiten der Woche (jede mit eigenem Wochentag, Start, Dauer, Ort; mehrere am selben Tag möglich); leeres time/min/ort = Vorgabe der Mannschaft/Stufe.
// days/time/min bleiben als Spiegel der Einheiten erhalten (ältere Geräte/Exporte kennen nur sie); fehlen sessions (altes Format), werden sie aus days/time/min/ort abgeleitet.
// DB.seasons[teamId]: Saison-Konfiguration pro Mannschaft (Trainingstage kommen aus den Einheiten der Mannschaft; s.days spiegelt sie); DB.season bleibt die Konfiguration ohne Mannschaft (und die frühere Konfiguration).
const TEAM_COLORS = ['#0a5fb4', '#d1495b', '#2e9e6b', '#e0a100', '#8e5bd0', '#0a8fa8', '#c2571a', '#6b7785'];
const teamById = id => id ? DB.teams.find(x => x.id === id) || null : null;
const teamByName = n => { n = String(n || '').trim().toLowerCase(); return n ? DB.teams.find(x => x.name.trim().toLowerCase() === n) || null : null; };
const teamOf = t => teamById(t.teamId) || teamByName(t.team);
const setTeam = (t, tm) => { t.teamId = tm ? tm.id : ''; t.team = tm ? tm.name : ''; };
const wdOrd = d => (d + 6) % 7;   // Montag zuerst
const legacySessions = (tm, days, time) => (Array.isArray(days) ? days : Array.isArray(tm.days) ? tm.days : [2, 4]).map(wd => ({ id: 'l' + wd, wd: +wd, time: time ?? tm.time ?? '', min: +tm.min || 0, ort: '' }));
// Einheiten der Mannschaft, sortiert (Wochentag ab Montag, dann Startzeit); mit Ort-Rückfall auf die Mannschaft (eff = true)
function teamSessions(tm, eff) {
  const l = (Array.isArray(tm.sessions) ? tm.sessions : legacySessions(tm)).map((s, i) => ({ id: s.id || 'x' + i, wd: +s.wd, time: s.time || '', min: +s.min || 0, ort: String(s.ort || '').trim() })).filter(s => s.wd >= 0 && s.wd <= 6);
  if (eff) l.forEach(s => s.ort = s.ort || tm.ort || '');
  return l.sort((a, b) => wdOrd(a.wd) - wdOrd(b.wd) || a.time.localeCompare(b.time));
}
const sessSummary = (tm, s) => `${WD[s.wd]}${s.time ? ' ' + s.time : ''}${s.min ? ' · ' + s.min + '′' : ''}${(s.ort || tm.ort) ? ' · ' + (s.ort || tm.ort) : ''}`;
function mirrorLegacy(tm) {   // alte Felder (days/time/min) passend zu den Einheiten halten
  const ss = teamSessions(tm); tm.days = [...new Set(ss.map(s => s.wd))]; tm.time = (ss.find(s => s.time) || {}).time || ''; tm.min = (ss.find(s => s.min) || {}).min || 0;
}
// Vorgaben ohne Datum: nur was für alle Einheiten gleich ist (so verhielt sich die einzelne Mannschafts-Startzeit früher)
function teamDefaults(tm) {
  const ss = teamSessions(tm, true), same = k => ss.length && ss.every(s => s[k] === ss[0][k]) ? ss[0][k] : '';
  return { time: ss.length ? same('time') : tm.time || '', ort: same('ort') || tm.ort || '' };
}
// Die Einheit der Mannschaft für ein Datum: passender Wochentag; bei mehreren am selben Tag die erste noch nicht belegte
function matchDay(ts, sess) {   // ts: Trainings der Mannschaft an einem Tag, sess: Einheiten dieses Tages -> { hit: [Training|null je Einheit], extra: übrige Trainings }
  const left = [...ts].sort((a, b) => (a.start || '').localeCompare(b.start || '')), hit = sess.map(() => null);
  sess.forEach((s, i) => { if (!s.time) return; const j = left.findIndex(t => t.start === s.time); if (j >= 0) hit[i] = left.splice(j, 1)[0]; });
  sess.forEach((s, i) => { if (!hit[i] && left.length) hit[i] = left.shift(); });
  return { hit, extra: left };
}
function pickSession(tm, date, self) {
  const wd = pd(date).getDay(), ss = teamSessions(tm, true).filter(s => s.wd === wd); if (!ss.length) return null; if (ss.length === 1) return ss[0];
  const byTime = self && self.start && ss.find(s => s.time === self.start); if (byTime) return byTime;
  const m = matchDay(teamTrainings(tm).filter(t => t.date === date && t !== self), ss), i = m.hit.findIndex(h => !h);
  return ss[i >= 0 ? i : 0];
}
// Mannschaft auf ein Training anwenden: Ort/Start (nur wenn leer) von der Einheit des Datums (oder gegebenen Einheit), sonst von den gemeinsamen Vorgaben; neu = auch die Dauer (t.min) der Einheit
function applyTeam(t, tm, sess, fresh) {
  setTeam(t, tm);
  const s = sess || (t.date ? pickSession(tm, t.date, t) : null), d = teamDefaults(tm), ort = s ? s.ort || tm.ort : d.ort, time = s ? s.time : d.time;
  if (ort && !t.ort) t.ort = ort; if (time && !t.start) t.start = time;
  if (fresh && s && s.min) t.min = s.min;
}
const mkTeam = (name, stage) => { const tm = { id: uid(), name, stage: stage || DB.stage, color: TEAM_COLORS[DB.teams.length % TEAM_COLORS.length], ort: '', days: [2, 4], time: '', min: 0 }; tm.sessions = teamSessions(tm); DB.teams.push(tm); return tm; };
const teamTrainings = tm => DB.trainings.filter(t => { const x = teamOf(t); return x && x.id === tm.id; });
function migrate() {
  if (!Array.isArray(DB.teams)) DB.teams = []; if (!DB.seasons || typeof DB.seasons !== 'object') DB.seasons = {};
  let ch = false;
  if (!DB.teamsInit) {   // einmalig: aus vorhandenen Team-Namen (Trainings, Saison) Mannschaften anlegen
    DB.teamsInit = true; ch = true;
    const names = [...DB.trainings.map(t => t.team), DB.season && DB.season.team].map(x => String(x || '').trim()).filter(Boolean);
    for (const n of names) if (!teamByName(n)) {
      const ts = DB.trainings.filter(t => String(t.team || '').trim().toLowerCase() === n.toLowerCase()), cnt = {};
      ts.forEach(t => cnt[t.stage] = (cnt[t.stage] || 0) + 1);
      const tm = mkTeam(n, Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || (DB.season && DB.season.stage) || DB.stage), o = ts.find(t => t.ort), g = ts.find(t => t.start);
      if (o) tm.ort = o.ort; if (g) tm.time = g.start;
      if (DB.season && String(DB.season.team || '').trim().toLowerCase() === n.toLowerCase()) { tm.days = [...(DB.season.days || [2, 4])]; tm.time = DB.season.time || tm.time; DB.seasons[tm.id] = JSON.parse(JSON.stringify(DB.season)); delete DB.seasons[tm.id].team; }
      delete tm.sessions;   // wird unten aus days/time abgeleitet
    }
  }
  for (const t of DB.trainings) if (t.team && !t.teamId) { const tm = teamByName(t.team); if (tm) { t.teamId = tm.id; ch = true; } }
  for (const tm of DB.teams) if (!Array.isArray(tm.sessions)) {   // Trainingseinheiten pro Wochentag: aus days/time/min (und den Tagen der Saison-Konfiguration, die bisher die Planung bestimmte) ableiten; alte Felder bleiben
    const sc = DB.seasons[tm.id];
    tm.sessions = legacySessions(tm, sc && Array.isArray(sc.days) ? sc.days : tm.days, sc && sc.time ? sc.time : tm.time); ch = true;
  }
  if (ch) flush();
}
function applyFlow(t) {   // Mannschaft/Datum aus dem Neu-Ablauf auf ein frisch erstelltes Training übertragen
  const f = { ...S.seed, ...(S.flow || {}) }, tm = teamById(f.team);
  if (f.date && !t.date) t.date = f.date; if (tm) applyTeam(t, tm, null, true);
  S.seed = { team: '', date: '' }; save(); return tm;
}
function resolveTeam(t, meta) {   // Import: Mannschaft des Trainings auf dem Gerät finden oder neu anlegen
  const nm = String(t.team || (meta[t.teamId] || {}).name || '').trim();
  let tm = teamById(t.teamId) || teamByName(nm);
  if (!tm && nm) { const m = meta[t.teamId] || {}; tm = mkTeam(nm, m.stage || t.stage); if (m.color) tm.color = m.color; if (m.ort) tm.ort = m.ort; if (m.time) tm.time = m.time; if (Array.isArray(m.days)) tm.days = m.days; if (m.min) tm.min = +m.min || 0; tm.sessions = Array.isArray(m.sessions) ? m.sessions : legacySessions(tm); if (m.id && !teamById(m.id)) tm.id = m.id; }
  setTeam(t, tm); return tm;
}
migrate();

// ---------- Bibliothek (aus RTP + Goalie + eigene Übungen) ----------
let LIB = null;
function lib() {
  if (LIB) return LIB;
  const m = new Map();
  const add = (name, kind, st, b, sp, ef, w) => {
    const k = norm(name); if (!k) return null;
    let e = m.get(k);
    if (!e) m.set(k, e = { key: k, name, kind, src: 'rtp', stages: new Set(), sps: new Set(), efs: new Set(), uses: new Set() });
    e.stages.add(st.id); if (sp) e.sps.add(sp); if (ef) e.efs.add(ef);
    if (b) e.uses.add(`${st.id}|${b.nr}|${w || ''}`);
    return e;
  };
  for (const st of R.stages) for (const b of st.blocks) {
    for (const w of b.weeks) for (const t of w.trainings) for (const s of st.slots) {
      if (!t[s.key] || s.label === 'Athletik') continue;   // D-Jun.: Spalte "Athletik" enthält nur den Entwicklungsfaktor
      add(t[s.key], slotType(s.label), st, b, b.main.sp, b.main.ef, w.w);
    }
    for (const p of [b.main, b.sec]) if (p) for (const n of p.gp || []) add(n, 'gp', st, b, p.sp, p.ef);
    if (b.athletik) for (const se of b.athletik.sessions) for (const it of se.items) {
      if (!it.form) continue;
      const e = add(it.form, 'athletik', st, b); if (!e) continue;
      e.faktoren = e.faktoren || new Set(); e.faktoren.add(se.faktor);
      e.params = e.params || []; if (e.params.length < 6 && !e.params.some(p => p.st === st.id && p.whg === it.whg)) e.params.push({ st: st.id, ...it });
    }
  }
  G.exercises.forEach(x => m.set('g:' + norm(x.name), { ...x, key: 'g:' + norm(x.name), kind: 'goalie', src: 'goalie', stages: new Set(x.stages), sps: new Set([G.cats[x.cat]]), efs: new Set(), uses: new Set() }));
  DB.custom.forEach(x => m.set('c:' + x.id, { ...x, key: 'c:' + x.id, src: 'custom', stages: new Set(x.stages || []), sps: new Set(), efs: new Set(), uses: new Set() }));
  return LIB = [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
const libGet = key => lib().find(e => e.key === key);
const goalieEx = name => lib().find(e => e.kind === 'goalie' && e.name === name);
// Link zur Übung im UTP (nur die Adresse aus dem RTP, keine Inhalte). Pro Stufe zuerst die Stufen-Adresse, sonst die allgemeine.
function utpUrl(name, stage) {
  const k = norm(name || ''); if (!k) return '';
  const rel = ((R.linksBy || {})[stage] || {})[k] || (R.links || {})[k];
  return rel ? (R.utpBase || 'https://utp.swissunihockey.ch/guest/exercises/') + rel : '';
}
const utpBtn = (url, cls = '') => `<a class="btn pri utp ${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Erklärung im UTP ↗</a>`;
const itemUtp = (it, t) => { const e = it.lib && libGet(it.lib); return utpUrl(e && e.src === 'rtp' ? e.name : it.name, t.stage); };
const libStage = e => S.lib.stage && e.stages.has(S.lib.stage) ? S.lib.stage : e.stages.has(DB.stage) ? DB.stage : [...e.stages][0];
const note = key => DB.notes[key] || {};

function goalieFocus(type, sp, ef, stage) {
  if ((stage === 'F' || stage === 'E') && type === 'spiel') return 'Goalie-Rotation: nach jedem Tor oder alle 2 Minuten wechseln – alle dürfen ins Tor.';
  if (type === 'warmup' || type === 'athletik' || type === 'spiel') return G.slotFocus[type];
  const s = `${sp || ''} ${ef || ''}`.toLowerCase();
  return (G.focus.find(f => new RegExp(f.m).test(s)) || { t: G.slotFocus.gp }).t;
}
const athLine = it => `• ${it.form || 'Übung'}: ${[it.whg, it.serien && it.serien + ' Serien', it.gewicht, it.rhythmus].filter(Boolean).join(', ')}${it.keypoints ? ' — ' + it.keypoints : ''}`;
function athSession(b, n, faktor) {
  const ss = (b.athletik || {}).sessions || []; if (!ss.length) return null;
  return ss.find(s => s.nums.includes(n) && (!faktor || s.faktor === faktor)) || ss.find(s => s.nums.includes(n)) || ss.find(s => s.faktor === faktor) || ss[(n - 1) % ss.length];
}

// ---------- Trainings ----------
const mkItem = (type, name, min, extra) => ({ id: uid(), type, name: name || '', min: min ?? TYPES[type][2], desc: '', coach: '', g: { mode: 'team', name: '', text: '' }, ...extra });
const getT = id => DB.trainings.find(t => t.id === id);
const total = t => t.items.reduce((a, i) => a + (+i.min || 0), 0);
const touch = t => { t.updated = Date.now(); save(); };
function newTraining(p) {
  const st = stageById(p.stage || DB.stage) || R.stages[2];
  const t = { id: uid(), title: 'Neues Training', date: '', team: '', teamId: '', ort: '', start: '', stage: st.id, min: st.minutes, ef: '', sp: '', ziel: '', sec: '', notes: '', rtp: null, items: [], updated: Date.now(), ...p };
  DB.trainings.push(t); save(); return t;
}
function pickGoalieEx(stage, n) {
  const l = G.exercises.filter(x => x.stages.includes(stage) && x.cat !== 6); return l.length ? l[(n - 1) % l.length].name : '';
}
function trainingFromRtp(stageId, blockNr, weekNr, idx, date) {
  const st = stageById(stageId), b = st.blocks.find(x => x.nr === blockNr), items = [];
  const base = { stage: stageId, date: date || '', ef: b.main.ef, sp: b.main.sp, ziel: b.main.ziel, sec: b.sec ? [b.sec.sp || b.sec.ef, b.sec.ziel].filter(Boolean).join(': ') : '', rtp: { stage: stageId, block: blockNr, week: weekNr, idx } };
  const gDef = (type, sp, ef, n) => type === 'skills' ? { mode: 'own', name: pickGoalieEx(stageId, n), text: '' } : { mode: 'team', name: '', text: goalieFocus(type, sp, ef, stageId) };
  if (st.slots) {
    const w = b.weeks.find(x => x.w === weekNr), tr = w.trainings[idx], n = b.weeks.indexOf(w) * st.perWeek + idx + 1;
    for (const s of st.slots) {
      const v = tr[s.key]; if (!v) continue;
      const type = slotType(s.label), it = mkItem(type, v, s.min);
      if (s.label === 'Athletik') { const se = athSession(b, n, v); it.name = 'Athletik: ' + v; it.desc = se ? se.items.map(athLine).join('\n') : ''; }
      else { const nt = note(norm(v)); it.desc = nt.desc || ''; if (nt.goalie) it.gNote = nt.goalie; }
      it.g = gDef(type, b.main.sp, b.main.ef, n); if (it.gNote) { it.g.text = it.gNote; delete it.gNote; }
      items.push(it);
    }
    return newTraining({ ...base, items, title: `${st.id} · Block ${b.nr} · Woche ${weekNr}${st.perWeek > 1 ? ' · Training ' + (idx + 1) : ''}`, notes: b.regel.length ? 'Regel-Fokus: ' + b.regel.join(', ') : '' });
  }
  const n = idx + 1, se = athSession(b, n);
  items.push({ ...mkItem('warmup', 'Warm-up', 10), g: gDef('warmup') });
  items.push({ ...mkItem('athletik', 'Athletik' + (se ? ': ' + se.faktor : ''), 15), desc: se ? se.items.map(athLine).join('\n') : '', g: gDef('athletik') });
  items.push({ ...mkItem('skills', 'Skills / Goalie-Einschiessen', 10), g: gDef('skills', '', '', n) });
  const gp = (p, min) => p && items.push({ ...mkItem('gp', (p.gp && p.gp.length ? p.gp[(n - 1) % p.gp.length] : 'Good Practice: ' + (p.sp || p.ef)), min), desc: p.gp && p.gp.length ? '' : 'Trainingsform im UTP wählen (Bibliothek → Stufe und Schwerpunkt filtern).', g: gDef('gp', p.sp, p.ef) });
  gp(b.main, 20); gp(b.sec, 15);
  items.push({ ...mkItem('spiel', 'Spielform', b.sec ? 20 : 35), desc: 'Bonuspunkte/Feedback in Bezug auf den Hauptschwerpunkt.', g: gDef('spiel') });
  return newTraining({ ...base, items, title: `${st.id} · Block ${b.nr} (${b.monat || b.phase}) · Training ${n}` });
}
function itemFromLib(e, t) {
  const type = TYPES[e.kind] ? e.kind : 'gp', it = mkItem(type, e.name, e.min);
  const nt = note(e.key); it.lib = e.key;
  if (e.src === 'custom') { it.desc = [e.desc, e.leichter && 'Erleichtern: ' + e.leichter, e.schwerer && 'Erschweren: ' + e.schwerer, e.vari && 'Variieren: ' + e.vari].filter(Boolean).join('\n'); it.coach = [e.coach, e.fragen && 'Fragen: ' + e.fragen].filter(Boolean).join('\n'); }
  else if (e.kind === 'athletik' && e.params) it.desc = athLine(e.params.find(p => p.st === t.stage) || e.params[0]);
  else if (e.src === 'rtp') it.desc = nt.desc || '';
  it.g = e.kind === 'goalie' ? { mode: 'own', name: e.src === 'goalie' ? e.name : '', text: e.src === 'custom' ? e.desc || '' : '' }
    : { mode: 'team', name: '', text: nt.goalie || e.goalie || goalieFocus(type, [...e.sps][0] || t.sp, [...e.efs][0] || t.ef, t.stage) };
  return it;
}

// ---------- UI-Helfer ----------
function toast(msg, act, fn) { const el = $('#toast'); el.innerHTML = esc(msg) + (act ? ` <button data-a="toastAct">${esc(act)}</button>` : ''); toast.fn = fn; el.className = act ? 'on act' : 'on'; clearTimeout(toast.t); toast.t = setTimeout(() => el.className = '', act ? 7000 : 2400); }
const teamDot = tm => `<span class="dot" style="background:${esc(tm.color)}"></span>`;
const metaLine = (t, showTeam) => { const tm = teamOf(t); return `${showTeam && (tm || t.team) ? `${tm ? teamDot(tm) : ''}<b>${esc(tm ? tm.name : t.team)}</b> · ` : ''}${[t.date ? fmtDate(t.date) : 'ohne Datum', t.start && `${t.start}–${endTime(t)}`, t.ort, t.sp].filter(Boolean).map(esc).join(' · ')}`; };
const seg = cur => `<div class="seg">${[['/', 'Liste', 'list'], ['/cal', 'Kalender', 'cal'], ['/season', 'Saison', 'season']].map(([h, l, k]) => `<a href="#${h}" class="${cur === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
const grpKey = t => `${t.team || ''}|${t.rtp ? t.rtp.stage + '|' + t.rtp.block : ''}`;
const endTime = t => { if (!t.start) return ''; const [h, m] = t.start.split(':').map(Number), e = h * 60 + m + total(t); return `${String(Math.floor(e / 60) % 24).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`; };
function removeTrainings(list) {
  if (!list.length) return; const ids = new Set(list.map(t => t.id));
  DB.trainings = DB.trainings.filter(t => !ids.has(t.id)); save();
  toast(`${list.length} Training${list.length > 1 ? 's' : ''} gelöscht`, 'Rückgängig', () => { DB.trainings.push(...list); save(); render(); });
}
function modal(html) { $('#modal').innerHTML = `<div class="backdrop" data-a="close"></div><div class="sheet">${html}</div>`; $('#modal').className = 'on'; }
function closeModal() { $('#modal').className = ''; $('#modal').innerHTML = ''; }
const go = h => { if (location.hash === '#' + h) render(); else location.hash = h; };
const chip = (txt, color) => `<span class="chip" ${color ? `style="--c:${color}"` : ''}>${esc(txt)}</span>`;
const opt = (v, label, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(label)}</option>`;
const stageOpts = (sel, all) => (all ? opt('', 'Alle Stufen', sel) : '') + R.stages.map(s => opt(s.id, s.name, sel)).join('');
const BACKL = h => h === '/' ? 'Trainings' : h === '/lib' ? 'Bibliothek' : h === '/rtp' ? 'RTP' : h === '/season' ? 'Saison' : h === '/teams' ? 'Teams' : /^\/team\//.test(h) ? 'Mannschaft' : h === '/more' ? 'Mehr' : h === '/new' ? 'Neu' : /^\/t\//.test(h) ? 'Training' : /^\/rtp\//.test(h) ? 'Block' : /^\/lib\/x/.test(h) ? 'Übung' : 'Zurück';
// Kopfzeile: Zurück mit Zielname, Titel, optional Untertitel (HTML, selbst escapen), rechts Aktionen, optional Kontextleiste (Ablauf/Auswahl)
const head = (title, back, right = '', sub = '', bar = '') => `<header class="top"><div class="trow">${back ? `<a class="back" href="#${back}" aria-label="Zurück zu ${esc(BACKL(back))}">‹<span>${esc(BACKL(back))}</span></a>` : ''}<div class="ttl"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</div>${bar}</header>`;
// Kontextleiste: laufender Ablauf (Neues Training) oder Auswahlmodus (Übung für ein Training) – immer sichtbar und abbrechbar
function ctxBar(step) {
  const f = S.flow, pt = S.pick && getT(S.pick);
  if (step === 'plan') return `<div class="ctx"><span class="grow"><b>Ganzen Block planen</b><br>Schritt ${arguments[1]} von 3: ${['Mannschaft und Block wählen', 'Starttermin wählen', 'Vorschau prüfen und anlegen'][arguments[1] - 1]}</span><button class="btn sm" data-a="planCancel">Abbrechen</button><div class="steps">${[1, 2, 3].map(i => `<i class="${i <= arguments[1] ? 'on' : ''}"></i>`).join('')}</div></div>`;
  if (pt) return `<div class="ctx"><span class="grow">Übung wählen für <b>${esc(pt.title)}</b></span><button class="btn sm" data-a="pickCancel">Abbrechen</button></div>`;
  if (!f) return '';
  const rtp = f.k === 'rtp', n = step === 'train' ? 2 : 1;
  return `<div class="ctx"><span class="grow"><b>Neues Training${rtp ? ' aus dem RTP' : ' über die Saison'}</b>${flowFor()}<br>${rtp ? `Schritt ${n} von 2: ${n === 1 ? 'Block wählen' : 'Training wählen'}` : 'Tippe bei einem Tag auf «+»'}</span><button class="btn sm" data-a="flowCancel">Abbrechen</button>${rtp ? `<div class="steps"><i class="on"></i><i class="${n === 2 ? 'on' : ''}"></i></div>` : ''}</div>`;
}
const flowFor = () => { const f = { ...S.seed, ...(S.flow || {}) }, tm = teamById(f.team); return (tm ? ` · ${esc(tm.name)}` : '') + (f.date ? ` · ${fmtDate(f.date)}` : ''); };
const doneBar = h => S.done && S.done.h === h ? `<div class="card okbar"><span class="grow">✓ ${esc(S.done.text)}</span>${S.done.undo ? '<button class="btn sm" data-a="doneUndo">Rückgängig</button>' : ''}<button class="btn sm" data-a="doneX" aria-label="Schliessen">✕</button></div>` : '';
function done(text, h, undo) { S.done = { text, h, undo }; go(h); }

// ---------- Ansicht: Trainings ----------
function viewHome() {
  const today = iso(new Date()), teams = DB.teams, f = teamById(S.team) ? S.team : '';
  const ts = DB.trainings.filter(t => !f || (teamOf(t) || {}).id === f).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.start || '').localeCompare(b.start || '') || a.title.localeCompare(b.title, 'de', { numeric: true }));
  S.visible = ts.map(t => t.id);
  const inner = t => `<div class="row"><b>${S.sel ? (S.sel.has(t.id) ? '☑ ' : '☐ ') : ''}${esc(t.title || 'Ohne Titel')}</b><span class="muted">${total(t)}′</span></div>
    <div class="muted small">${metaLine(t, true)}</div>
    <div class="bar">${t.items.map(i => `<i style="flex:${+i.min || 1};background:${(TYPES[i.type] || TYPES.sonst)[1]}"></i>`).join('')}</div>`;
  const card = t => { const cls = `card tcard ${t.date && t.date < today ? 'past' : ''} ${S.sel && S.sel.has(t.id) ? 'picked' : ''}`; return S.sel ? `<div class="${cls}" data-a="selT" data-id="${t.id}">${inner(t)}</div>` : `<a class="${cls}" href="#/t/${t.id}">${inner(t)}</a>`; };
  const groups = new Map(); ts.forEach(t => { const k = grpKey(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  const gtitle = g => { const t = g[0]; return [t.team, t.rtp ? `${t.rtp.stage} · Block ${t.rtp.block}${t.sp ? ' · ' + t.sp : ''}` : 'Einzelne Trainings'].filter(Boolean).join(' · '); };
  return head('Trainings', null, (DB.trainings.length ? `<button class="btn" data-a="selMode">${S.sel ? 'Fertig' : 'Auswählen'}</button>` : '') + `<button class="btn pri" data-a="newT" data-team="${esc(f)}">+ Neu</button>`, '', '') + seg('list') + doneBar('/') + (DB.trainings.length ? `
    ${teams.length ? `<div class="chips"><button class="chip ${f ? '' : 'sel'}" data-a="teamF" data-k="">Alle Mannschaften</button>${teams.map(x => `<button class="chip ${f === x.id ? 'sel' : ''}" data-a="teamF" data-k="${esc(x.id)}">${teamDot(x)}${esc(x.name)}</button>`).join('')}</div>` : ''}
    ${S.sel ? `<div class="card selbar row"><b>${S.sel.size} ausgewählt</b><button class="btn sm" data-a="selAll">Alle</button><button class="btn sm danger" data-a="delSel" ${S.sel.size ? '' : 'disabled'}>Löschen</button></div>` : ''}
    ${[...groups].map(([k, g]) => `<div class="row ghead"><h2>${esc(gtitle(g))} <span class="muted small">(${g.length})</span></h2><button class="btn sm" data-a="grp" data-k="${esc(k)}" aria-label="Block-Aktionen">⋯ Block</button></div>${g.map(card).join('')}`).join('')}` : `
    <div class="card empty"><h2>Willkommen 👋</h2><p>Plane Trainings nach den Rahmentrainingsplänen (RTP) von swiss unihockey – mit eigener Goalie-Spur, Hallenmodus und Saisonplanung. Alles bleibt auf deinem Gerät, ohne Login.</p>
    <p><button class="btn pri" data-a="newT" data-team="">Erstes Training erstellen</button> <a class="btn" href="#/teams">Mannschaft anlegen</a></p><p class="small muted">Du wählst, ob du mit dem RTP, der Saisonplanung oder einem leeren Training startest.</p></div>`);
}

// ---------- Ansicht: Editor ----------
function goalieSummary(g) {
  if (!g) return '';
  if (g.mode === 'none') return 'nicht im Einsatz';
  if (g.mode === 'own') return g.name || 'eigene Übung';
  return 'mit dem Team' + (g.text ? ' – ' + g.text : '');
}
function itemCard(t, it, i) {
  const ty = TYPES[it.type] || TYPES.sonst, open = S.open.has(it.id), g = it.g || (it.g = { mode: 'team', name: '', text: '' });
  const gopts = lib().filter(e => e.kind === 'goalie');
  const gx = g.mode === 'own' && g.name ? goalieEx(g.name) : null, u = itemUtp(it, t);
  return `<div class="card item ${open ? 'open' : ''}" style="--c:${ty[1]}">
    <div class="row"><button class="tog" data-a="tog" data-id="${it.id}" aria-label="Details">${open ? '▾' : '▸'}</button>
      <input class="name" data-b="i:${it.id}:name" value="${esc(it.name)}" placeholder="${esc(ty[0])}">
      <input class="min" type="number" inputmode="numeric" min="0" data-b="i:${it.id}:min" value="${esc(it.min)}" aria-label="Minuten"><span class="muted">′</span></div>
    ${open ? `<div class="body">
      ${u ? `<p>${utpBtn(u)} <span class="small muted">Beschreibung, Skizze und Video bei swiss unihockey</span></p>` : ''}
      <label>Typ<select data-b="i:${it.id}:type" data-r="1">${Object.entries(TYPES).map(([k, v]) => opt(k, v[0], it.type)).join('')}</select></label>
      <label>Beschreibung / Organisation<textarea data-b="i:${it.id}:desc" rows="3" placeholder="Ablauf, Feldgrösse, Material …">${esc(it.desc)}</textarea></label>
      <label>Keypoints / Coachingfragen<textarea data-b="i:${it.id}:coach" rows="2">${esc(it.coach)}</textarea></label>
      <div class="gbox"><b>🧤 Goalie</b>
        <label>Rolle in diesem Block<select data-b="g:${it.id}:mode" data-r="1">${opt('team', 'Mit dem Team (im Tor / macht mit)', g.mode)}${opt('own', 'Eigene Goalie-Übung (parallel)', g.mode)}${opt('none', 'Nicht im Einsatz / Pause', g.mode)}</select></label>
        ${g.mode === 'own' ? `<label>Goalie-Übung<select data-b="g:${it.id}:name" data-r="1">${opt('', '– frei beschreiben –', g.name)}${gopts.map(e => opt(e.name, e.name + (e.stages.has(t.stage) ? '' : ' (andere Stufe)'), g.name)).join('')}</select></label>
          ${gx ? `<p class="small">${esc(gx.desc || '')} <a href="#/lib/x/${encodeURIComponent(gx.key)}">mehr</a></p>${gx.coach && gx.coach.length ? `<details class="small"><summary>Coaching-Punkte &amp; Variationen</summary><ul>${gx.coach.map(c => `<li>${esc(c)}</li>`).join('')}</ul>${gx.vari ? `<p><b>Variationen:</b> ${esc(gx.vari)}</p>` : ''}</details>` : ''}` : ''}` : ''}
        <label>${g.mode === 'own' ? 'Zusätzliche Hinweise' : 'Goalie-Fokus / Aufgabe'}<textarea data-b="g:${it.id}:text" rows="2">${esc(g.text)}</textarea></label></div>
      <div class="row acts"><button class="btn sm" data-a="mv" data-id="${it.id}" data-d="-1" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-a="mv" data-id="${it.id}" data-d="1" ${i < t.items.length - 1 ? '' : 'disabled'}>↓</button>
        <button class="btn sm" data-a="dupI" data-id="${it.id}">Duplizieren</button><span class="grow"></span><button class="btn sm danger" data-a="delI" data-id="${it.id}">Entfernen</button></div>
    </div>` : `<div class="small gline" data-a="tog" data-id="${it.id}">${esc(ty[0])} · 🧤 ${esc(goalieSummary(g))}</div>`}</div>`;
}
const sumHtml = t => { const s = total(t), d = s - (+t.min || 0); return `<b>${s}′</b> von ${esc(t.min)}′ geplant${d ? ` <span class="${d > 0 ? 'warn' : 'muted'}">(${d > 0 ? '+' : ''}${d}′)</span>` : ' ✓'}`; };
function viewEdit(t) {
  S.pick = null;
  return head('Training', '/', `<a class="btn pri" href="#/t/${t.id}/run">▶ Start</a>`, 'Bearbeiten · ' + esc(t.title || 'Ohne Titel')) + doneBar('/t/' + t.id) + rtpSummary(t, 'edit') + `
  <div class="card"><input class="title" data-b="t:title" value="${esc(t.title)}" placeholder="Titel">
    <div class="grid2"><label>Datum<input type="date" data-b="t:date" value="${esc(t.date)}"></label><label>Startzeit${t.start ? ` (bis ${endTime(t)})` : ''}<input type="time" data-b="t:start" data-r="1" value="${esc(t.start)}"></label>
      <label>Mannschaft<select data-b="t:teamId" data-r="1">${opt('', 'Keine Mannschaft', teamOf(t) ? teamOf(t).id : t.team ? '__txt' : '')}${DB.teams.map(x => opt(x.id, x.name, teamOf(t) ? teamOf(t).id : '')).join('')}${!teamOf(t) && t.team ? opt('__txt', t.team + ' (keine Mannschaft)', '__txt') : ''}</select></label><label>Ort<input data-b="t:ort" value="${esc(t.ort)}" placeholder="Halle"></label>
      <label>Dauer (Min.)<input type="number" inputmode="numeric" data-b="t:min" value="${esc(t.min)}"></label></div>
    <details ${t.sp || t.ziel ? '' : 'open'}><summary>${t.sp ? `<span class="dot" style="background:${efColor(t.ef)}"></span>${esc(t.sp)}` : 'Schwerpunkt &amp; Ziel'}</summary>
      <label>Stufe<select data-b="t:stage">${stageOpts(t.stage)}</select></label>
      <label>Erscheinungsform<select data-b="t:ef" data-r="1">${opt('', '–', t.ef)}${[...new Set([...R.efs.teta, t.ef].filter(Boolean))].map(e => opt(e, e, t.ef)).join('')}</select></label>
      <label>Schwerpunkt<input data-b="t:sp" value="${esc(t.sp)}"></label>
      <label>Ausbildungsziel: Die Spieler*innen können …<textarea data-b="t:ziel" rows="3">${esc(t.ziel)}</textarea></label>
      <label>Nebenschwerpunkt<textarea data-b="t:sec" rows="2">${esc(t.sec)}</textarea></label>
      <label>Notizen (Material, Regel-Fokus, Absenzen …)<textarea data-b="t:notes" rows="2">${esc(t.notes)}</textarea></label>
      ${t.rtp ? `<p class="small"><a href="#/rtp/${t.rtp.stage}/${t.rtp.block}">→ RTP-Block ${t.rtp.block} ansehen</a></p>` : ''}</details></div>
  <div class="row sum"><span id="sum">${sumHtml(t)}</span><span class="grow"></span><button class="btn sm" data-a="togAll">${t.items.every(i => S.open.has(i.id)) && t.items.length ? 'Alle zuklappen' : 'Alle aufklappen'}</button></div>
  ${t.items.map((it, i) => itemCard(t, it, i)).join('') || '<p class="muted center">Noch keine Blöcke.</p>'}
  <div class="row wrap"><button class="btn pri" data-a="pick">+ Aus Bibliothek</button><button class="btn" data-a="addI">+ Leerer Block</button><button class="btn gbtn" data-a="addG">+ Goalie-Übung</button></div>
  <div class="row wrap foot"><button class="btn" data-a="share">Teilen</button><a class="btn" href="#/t/${t.id}/view">Übersicht / Drucken</a><button class="btn" data-a="dupT">Duplizieren</button><button class="btn danger" data-a="delT">Löschen</button></div>`;
}

// ---------- RTP-Zusammenfassung (Erscheinungsform, Schwerpunkt, Ausbildungsziel, Regel-Fokus) ----------
// Liest den Block zur Laufzeit aus dem gespeicherten Bezug t.rtp; ohne Bezug oder bei unbekannter Stufe/unbekanntem Block: null (keine Karte).
function rtpBlockOf(t) {
  const r = t && t.rtp; if (!r || typeof r !== 'object') return null;
  const st = stageById(r.stage), b = st && (st.blocks || []).find(x => x.nr === +r.block);
  return b && b.main ? b : null;
}
function rtpSummary(t, mode) {
  const b = rtpBlockOf(t); if (!b) return '';
  const m = b.main, sec = b.sec, regel = [].concat(b.regel || []).filter(Boolean);
  const ziel = m.ziel ? `Die Spieler*innen können ${esc(String(m.ziel).replace(/^können /, ''))}` : '';
  const secTxt = sec && [sec.sp, sec.ef].filter(Boolean).length ? [sec.sp, sec.ef].filter(Boolean).join(' · ') : '';
  const inner = `${m.ef ? `<div class="small muted">Erscheinungsform</div><p class="rs-v">${esc(m.ef)}</p>` : ''}${m.sp ? `<div class="small muted">Schwerpunkt</div><p class="rs-v"><b>${esc(m.sp)}</b></p>` : ''}${ziel ? `<div class="small muted">Ausbildungsziel</div><p class="rs-v">${ziel}</p>` : ''}${regel.length ? `<div class="small muted">Regel-Fokus</div><p class="rs-v">${regel.map(esc).join(', ')}</p>` : ''}${secTxt ? `<p class="small muted rs-sec">Nebenschwerpunkt: ${esc(secTxt)}</p>` : ''}`;
  if (!inner) return '';
  const title = `<span class="dot" style="background:${efColor(m.ef)}"></span>Überblick: ${esc(m.sp || m.ef || 'RTP-Block')}`;
  if (mode === 'edit') return `<details class="card rtpsum" ${S.sumClosed ? '' : 'open'}><summary>${title}</summary>${inner}</details>`;
  return `<div class="card rtpsum"><b class="rs-h"><span class="dot" style="background:${efColor(m.ef)}"></span>Überblick RTP-Block ${esc(b.nr)}</b>${inner}</div>`;
}

// ---------- Ansicht: Übersicht (lesen/drucken) ----------
function goalieHtml(g, full) {
  if (!g) return '';
  const x = g.mode === 'own' && g.name ? goalieEx(g.name) : null;
  const headTxt = g.mode === 'none' ? 'Nicht im Einsatz' : g.mode === 'own' ? (g.name || 'Eigene Übung') : 'Mit dem Team';
  return `<div class="gbox"><b>🧤 ${esc(headTxt)}</b>${x && full ? `<p>${esc(x.desc)}</p><ul>${[].concat(x.coach || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>${x.vari ? `<p class="small"><b>Variationen:</b> ${esc(x.vari)}</p>` : ''}${x.mat ? `<p class="small muted">Material: ${esc(x.mat)}</p>` : ''}` : ''}${g.text ? `<p>${nl2br(g.text)}</p>` : ''}</div>`;
}
function viewRead(t) {
  let m = 0;
  return head('Übersicht', `/t/${t.id}`, `<button class="btn" data-a="print">Drucken</button>`, esc(t.title || 'Ohne Titel')) + `
  <div class="card"><h2 class="nomargin">${esc(t.title)}</h2><p class="muted">${[fmtDate(t.date), t.start && `${t.start}–${endTime(t)}`, t.team, t.ort, (stageById(t.stage) || {}).name, total(t) + ' Min.'].filter(Boolean).map(esc).join(' · ')}</p>
    ${t.sp ? `<p><b>${esc(t.sp)}</b>${t.ef ? ` <span class="muted">(${esc(t.ef)})</span>` : ''}</p>` : ''}${t.ziel ? `<p>Ziel: Die Spieler*innen können ${esc(t.ziel.replace(/^können /, ''))}</p>` : ''}
    ${t.sec ? `<p class="small">Nebenschwerpunkt: ${esc(t.sec)}</p>` : ''}${t.notes ? `<p class="small">${nl2br(t.notes)}</p>` : ''}</div>
  ${rtpSummary(t)}
  ${t.items.map(it => { const ty = TYPES[it.type] || TYPES.sonst, from = m; m += +it.min || 0; return `<div class="card item" style="--c:${ty[1]}"><div class="row"><b>${esc(it.name || ty[0])}</b><span class="muted nowrap">${from}′–${m}′</span></div>
    <div class="small muted">${esc(ty[0])} · ${esc(it.min)} Min.</div>${itemUtp(it, t) ? `<p>${utpBtn(itemUtp(it, t), 'sm')}</p>` : ''}${it.desc ? `<p>${nl2br(it.desc)}</p>` : ''}${it.coach ? `<p class="small"><b>Coaching:</b> ${nl2br(it.coach)}</p>` : ''}${goalieHtml(it.g, true)}</div>`; }).join('')}`;
}

// ---------- Ansicht: Hallenmodus ----------
let wake = null;
const mmss = s => `${s < 0 ? '+' : ''}${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s)) % 60).padStart(2, '0')}`;
function runSet(t, i) { const r = S.run; r.i = Math.max(0, Math.min(t.items.length - 1, i)); r.left = (+t.items[r.i].min || 0) * 60; r.last = Date.now(); r.buzz = false; }
function viewRun(t) {
  if (!t.items.length) return head('Hallenmodus', `/t/${t.id}`) + '<p class="muted center">Dieses Training hat noch keine Blöcke.</p>';
  if (!S.run || S.run.id !== t.id) { S.run = { id: t.id, i: 0, on: false }; runSet(t, 0); }
  const r = S.run, it = t.items[r.i], ty = TYPES[it.type] || TYPES.sonst, nx = t.items[r.i + 1];
  return `<div class="run" style="--c:${ty[1]}"><div class="row runtop"><a class="btn sm" href="#/t/${t.id}" data-a="runExit">✕ Beenden</a><span class="grow center">${r.i + 1} / ${t.items.length}</span><span class="muted">${esc(ty[0])}</span></div>
    <div class="dots">${t.items.map((x, i) => `<i data-a="runGo" data-i="${i}" class="${i === r.i ? 'cur' : i < r.i ? 'done' : ''}" style="flex:${+x.min || 1}"></i>`).join('')}</div>
    ${r.i === 0 && !r.started ? rtpSummary(t) : ''}
    <h1 class="runname">${esc(it.name || ty[0])}</h1>
    <div class="clock ${r.left < 0 ? 'over' : ''}" id="clock">${mmss(r.left)}</div>
    <div class="row center"><button class="btn pri big" data-a="runTog">${r.on ? '❚❚ Pause' : '▶ Start'}</button><button class="btn" data-a="runReset">↺</button></div>
    ${itemUtp(it, t) ? `<div class="card">${utpBtn(itemUtp(it, t), 'block')}<p class="small muted center nomargin">Öffnet im Browser (Internet nötig)</p></div>` : ''}${it.desc ? `<div class="card"><p>${nl2br(it.desc)}</p></div>` : ''}${it.coach ? `<div class="card"><b>Coaching</b><p>${nl2br(it.coach)}</p></div>` : ''}
    ${goalieHtml(it.g, true)}
    ${nx ? `<p class="muted center small">Als Nächstes: <b>${esc(nx.name || (TYPES[nx.type] || TYPES.sonst)[0])}</b> (${esc(nx.min)}′)</p>` : '<p class="muted center small">Letzter Block</p>'}
    <div class="row runnav"><button class="btn big" data-a="runGo" data-i="${r.i - 1}" ${r.i ? '' : 'disabled'}>‹ Zurück</button><button class="btn pri big" data-a="runGo" data-i="${r.i + 1}" ${nx ? '' : 'disabled'}>Weiter ›</button></div></div>`;
}
setInterval(() => {
  const r = S.run; if (!r) return; const now = Date.now();
  if (r.on) { r.left -= (now - r.last) / 1000; if (r.left <= 0 && !r.buzz) { r.buzz = true; navigator.vibrate && navigator.vibrate([300, 150, 300]); } }
  r.last = now; const el = $('#clock'); if (el) { el.textContent = mmss(r.left); el.classList.toggle('over', r.left < 0); }
}, 500);
async function wakeLock(on) { try { if (on && navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); else if (wake) { wake.release(); wake = null; } } catch (e) { /* nicht unterstützt */ } }

// ---------- Ansicht: Bibliothek ----------
const KINDS = [['', 'Alle'], ['gp', 'Good Practice'], ['skills', 'Skills'], ['spiel', 'Spiel'], ['warmup', 'Warm-up'], ['athletik', 'Athletik'], ['goalie', '🧤 Goalie'], ['custom', 'Eigene']];
function libFiltered() {
  const f = S.lib, q = norm(f.q);
  return lib().filter(e => (!f.kind || (f.kind === 'custom' ? e.src === 'custom' : e.kind === f.kind)) && (!f.stage || e.stages.has(f.stage) || !e.stages.size) && (!f.sp || e.sps.has(f.sp)) && (!q || norm(e.name).includes(q) || [...e.sps].some(s => norm(s).includes(q))));
}
function libList() {
  const l = libFiltered(), f = S.lib;
  return `<p class="muted small">${l.length} Übungen</p>` + l.slice(0, f.limit).map(e => { const ty = TYPES[e.kind] || TYPES.sonst; return `<a class="card lcard" style="--c:${ty[1]}" href="#/lib/x/${encodeURIComponent(e.key)}"><b>${esc(e.name)}</b>
    <div class="small muted">${esc(ty[0])}${e.src === 'custom' ? ' · eigene' : ''} · ${[...e.stages].join(', ') || 'alle Stufen'}${e.sps.size ? ' · ' + esc([...e.sps].slice(0, 2).join(', ')) : ''}</div></a>`; }).join('') +
    (l.length > f.limit ? `<button class="btn block" data-a="libMore">Mehr anzeigen</button>` : '');
}
function viewLib() {
  const f = S.lib, pt = S.pick && getT(S.pick);
  const sps = [...new Set(lib().filter(e => (!f.stage || e.stages.has(f.stage)) && (!f.kind || e.kind === f.kind)).flatMap(e => [...e.sps]))].sort((a, b) => a.localeCompare(b, 'de'));
  return head(pt ? 'Übung hinzufügen' : 'Bibliothek', pt ? `/t/${pt.id}` : null, pt ? '' : `<a class="btn" href="#/lib/new">+ Eigene</a>`, pt ? `zu: <b>${esc(pt.title)}</b>` : 'Übungen suchen und ansehen', ctxBar()) + `
  <input type="search" id="q" data-b="l:q" value="${esc(f.q)}" placeholder="Übung suchen …">
  <div class="chips">${KINDS.map(([k, l]) => `<button class="chip ${f.kind === k ? 'sel' : ''}" data-a="libKind" data-k="${k}">${l}</button>`).join('')}</div>
  <div class="grid2"><select data-b="l:stage" data-r="1">${stageOpts(f.stage, true)}</select><select data-b="l:sp" data-r="1">${opt('', 'Alle Schwerpunkte', f.sp)}${sps.map(s => opt(s, s, f.sp)).join('')}</select></div>
  <div id="liblist">${libList()}</div>`;
}
function usesHtml(e) {
  const by = {}; for (const u of e.uses) { const [st, b] = u.split('|'); (by[st] = by[st] || new Set()).add(+b); }
  return Object.entries(by).map(([st, bs]) => `<div class="small">${esc(st)}: ${[...bs].sort((a, b) => a - b).map(b => `<a href="#/rtp/${st}/${b}">Block ${b}</a>`).join(', ')}</div>`).join('');
}
function viewLibItem(e) {
  const ty = TYPES[e.kind] || TYPES.sonst, pt = S.pick && getT(S.pick), nt = note(e.key), lu = e.src === 'rtp' ? utpUrl(e.name, libStage(e)) : '';
  let body = '';
  if (e.src === 'goalie') body = `<div class="card"><p>${esc(e.desc)}</p><b>Coaching-Punkte</b><ul>${e.coach.map(c => `<li>${esc(c)}</li>`).join('')}</ul>${e.vari ? `<p><b>Variationen:</b> ${esc(e.vari)}</p>` : ''}<p class="small muted">Material: ${esc(e.mat)} · ca. ${e.min} Min. · ${esc(G.cats[e.cat])}</p></div><p class="small muted">${esc(G.note)}</p>`;
  else if (e.src === 'custom') body = `<div class="card">${e.desc ? `<p>${nl2br(e.desc)}</p>` : '<p class="muted">Keine Beschreibung.</p>'}${[['coach', 'Keypoints'], ['fragen', 'Coachingfragen'], ['leichter', 'Erleichtern'], ['schwerer', 'Erschweren'], ['vari', 'Variieren']].map(([k, l]) => e[k] ? `<p><b>${l}:</b><br>${nl2br(e[k])}</p>` : '').join('')}${e.goalie ? `<div class="gbox"><b>🧤 Goalie</b><p>${nl2br(e.goalie)}</p></div>` : ''}</div>
    <div class="row"><a class="btn" href="#/lib/edit/${e.id}">Bearbeiten</a><button class="btn danger" data-a="delC" data-id="${e.id}">Löschen</button></div>`;
  else body = `${lu ? `<div class="card">${utpBtn(lu, 'block')}<p class="small muted nomargin">Offizielle Beschreibung, Skizze und Video bei swiss unihockey (Unihockey-Trainingsplaner). Öffnet in einem neuen Tab, ohne Login; braucht Internet.</p></div>` : ''}${e.params ? `<div class="card"><b>Vorgaben aus dem RTP</b>${e.params.map(p => `<p class="small"><b>${esc(p.st)}:</b> ${esc([p.whg, p.serien && p.serien + ' Serien', p.gewicht, p.rhythmus].filter(Boolean).join(' · '))}${p.keypoints ? `<br>Keypoints: ${esc(p.keypoints)}` : ''}</p>`).join('')}</div>` : ''}
    <div class="card"><label>Eigene Beschreibung / Notizen<textarea data-b="n:${esc(e.key)}:desc" rows="4" placeholder="Ablauf, Skizze in Worten, Erfahrungen …">${esc(nt.desc)}</textarea></label>
    ${e.kind !== 'athletik' ? `<label>🧤 Goalie-Hinweis zu dieser Übung<textarea data-b="n:${esc(e.key)}:goalie" rows="2" placeholder="${esc(goalieFocus(e.kind, [...e.sps][0], [...e.efs][0]))}">${esc(nt.goalie)}</textarea></label>` : ''}
    ${lu ? '<p class="small muted">Deine Notizen werden beim Hinzufügen ins Training übernommen.</p></div>' : `<p class="small muted">Die offizielle Beschreibung mit Skizze/Video findest du im Unihockey-Trainingsplaner (UTP): Bibliothek → nach dem Namen suchen. Deine Notizen werden beim Hinzufügen ins Training übernommen.</p>
    <button class="btn" data-a="utp" data-n="${esc(e.name)}">Name kopieren &amp; UTP öffnen</button></div>`}
    ${e.uses.size ? `<div class="card"><b>Vorkommen im RTP</b>${usesHtml(e)}</div>` : ''}`;
  return head(pt ? 'Übung ansehen' : 'Übung', '/lib', '', pt ? `für: <b>${esc(pt.title)}</b>` : 'Bibliothek', ctxBar()) + `<div class="card item" style="--c:${ty[1]}"><h2 class="nomargin">${esc(e.name)}</h2>
    <div class="chips">${chip(ty[0], ty[1])}${[...e.stages].map(s => chip(s)).join('')}${[...(e.faktoren || [])].map(s => chip(s)).join('')}</div>
    ${[...e.sps].length && e.src === 'rtp' ? `<p class="small">Schwerpunkte: ${esc([...e.sps].join(', '))}</p>` : ''}</div>${body}
    <button class="btn pri block" data-a="addLib" data-k="${esc(e.key)}">${pt ? `Zu «${esc(pt.title)}» hinzufügen` : 'Zu einem Training hinzufügen'}</button>`;
}
function viewLibForm(id) {
  const c = id ? DB.custom.find(x => x.id === id) : null;
  S.form = c ? { ...c, stages: [...(c.stages || [])] } : { id: null, name: '', kind: 'gp', stages: [DB.stage], min: 15, desc: '', coach: '', fragen: '', leichter: '', schwerer: '', vari: '', goalie: '' };
  const f = S.form;
  return head(c ? 'Übung bearbeiten' : 'Eigene Übung erstellen', '/lib', '', 'Bibliothek · eigene Übungen', ctxBar()) + `<div class="card">
    <label>Name<input data-b="c:name" value="${esc(f.name)}"></label>
    <div class="grid2"><label>Typ<select data-b="c:kind">${Object.entries(TYPES).map(([k, v]) => opt(k, v[0], f.kind)).join('')}</select></label><label>Dauer (Min.)<input type="number" inputmode="numeric" data-b="c:min" value="${esc(f.min)}"></label></div>
    <div class="chips">${R.stages.map(s => `<button class="chip ${f.stages.includes(s.id) ? 'sel' : ''}" data-a="cStage" data-k="${s.id}">${s.id}</button>`).join('')}</div>
    <label>Beschreibung<textarea data-b="c:desc" rows="5">${esc(f.desc)}</textarea></label>
    <label>Keypoints<textarea data-b="c:coach" rows="2">${esc(f.coach)}</textarea></label>
    <label>Coachingfragen<textarea data-b="c:fragen" rows="2">${esc(f.fragen)}</textarea></label>
    <details><summary>Rad der Variation</summary><label>Erleichtern<textarea data-b="c:leichter" rows="2">${esc(f.leichter)}</textarea></label><label>Erschweren<textarea data-b="c:schwerer" rows="2">${esc(f.schwerer)}</textarea></label><label>Variieren<textarea data-b="c:vari" rows="2">${esc(f.vari)}</textarea></label></details>
    <label>🧤 Goalie-Hinweis<textarea data-b="c:goalie" rows="2">${esc(f.goalie)}</textarea></label>
    <button class="btn pri block" data-a="saveC">Speichern</button></div>`;
}

// ---------- Ansicht: RTP ----------
function viewRtp() {
  const st = stageById(DB.stage) || R.stages[0], gc = G.curriculum[st.id];
  const gbox = `<div class="gbox card"><b>🧤 Goalie-Ausbildung ${esc(st.id)}: ${esc(gc.title)}</b><ul class="small">${gc.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul><p class="small muted">${esc(G.note)}</p></div>`;
  return head('Rahmentrainingsplan', S.flow ? '/new' : null, '', S.flow ? 'Neues Training · Stufe und Block wählen' : 'Stufe wählen, dann Block ansehen', ctxBar('block')) + `<div class="chips">${R.stages.map(s => `<button class="chip ${s.id === st.id ? 'sel' : ''}" data-a="stage" data-k="${s.id}">${s.id}</button>`).join('')}</div>
  <div class="card"><h2 class="nomargin">${esc(st.name)}${st.draft ? ' <span class="chip">Arbeitsstand</span>' : ''}</h2><p class="muted small">${esc(st.annahme)}</p>
    <details><summary>Hinweise zum RTP</summary><ul class="small">${R.hints.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
      ${st.notes.map(n => `<b>${esc(n.title)}</b>${n.text.map(x => `<p class="small">${esc(x)}</p>`).join('')}`).join('')}
      <b>Termine &amp; Abkürzungen</b><ul class="small">${Object.entries(R.glossary).map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('')}</ul></details>
    <details><summary>Farbskala Erscheinungsformen</summary>${R.efs.teta.map(e => `<div class="small"><span class="dot" style="background:${efColor(e)}"></span>${esc(e)}</div>`).join('')}<p class="small muted">Athletik: ${R.efs.athletik.map(esc).join(' · ')}</p></details></div>
  ${S.flow ? '' : gbox}
  <h2>Trainingsblöcke</h2>${st.blocks.map(b => `<a class="card item" style="--c:${efColor(b.main.ef)}" href="#/rtp/${st.id}/${b.nr}"><div class="row"><b>Block ${b.nr} · ${esc(b.main.sp || b.main.ef)}</b><span class="muted small nowrap">${esc(b.monat || b.phase)}</span></div>
    <div class="small muted">${esc(b.main.sp ? b.main.ef : b.main.ziel)}${b.weeks.length ? ` · Woche ${b.weeks[0].w}–${b.weeks[b.weeks.length - 1].w}` : ''}${b.sec && b.sec.sp ? ` · Neben: ${esc(b.sec.sp)}` : ''}</div></a>`).join('')}${S.flow ? gbox : ''}`;
}
function viewBlock(st, b) {
  const part = (p, title) => p ? `<div class="card item" style="--c:${efColor(p.ef)}"><div class="small muted">${title} · ${esc(p.ef)}</div>${p.sp ? `<h2 class="nomargin">${esc(p.sp)}</h2>` : ''}
    <p>${p.sp ? 'Die Spieler*innen können ' : ''}${esc(p.ziel.replace(/^können /, ''))}</p>
    ${p.sp ? `<div class="gbox"><b>🧤 Goalie-Fokus</b><p>${esc(goalieFocus('gp', p.sp, p.ef, st.id))}</p></div>` : ''}
    ${p.gp && p.gp.length ? `<b>Good Practice</b><div class="chips">${p.gp.map(n => `<a class="chip" href="#/lib/x/${encodeURIComponent(norm(n))}">${esc(n)}</a>`).join('')}</div>` : ''}</div>` : '';
  const ev = [...b.events, ...b.weeks.flatMap(w => w.events.map(e => `W${w.w}: ${e}`))];
  const weeks = st.slots ? b.weeks.map(w => `<h3>Woche ${w.w}${w.events.length ? ` <span class="muted small">· ${esc(w.events.join(', '))}</span>` : ''}</h3>${w.trainings.map((t, i) => `<div class="card"><div class="row"><b>Training ${i + 1}</b><button class="btn sm pri" data-a="fromRtp" data-s="${st.id}" data-b2="${b.nr}" data-w="${w.w}" data-i="${i}">Training erstellen</button></div>
      ${st.slots.map(s => t[s.key] ? `<div class="slot"><span class="dot" style="background:${TYPES[slotType(s.label)][1]}"></span><span class="muted small">${esc(s.label)} (${esc(s.dur)})</span><br>${s.label === 'Athletik' ? esc(t[s.key]) : `<a href="#/lib/x/${encodeURIComponent(norm(t[s.key]))}">${esc(t[s.key])}</a>`}</div>` : '').join('')}</div>`).join('')}`).join('')
    : `<div class="card"><b>Training erstellen</b><p class="small muted">Für diese Stufe gibt der RTP Schwerpunkte und Athletik vor, aber keine einzelnen Trainings. Wähle die Trainingsnummer im Block – die App baut eine Vorlage mit passender Athletik-Einheit.</p>
      <div class="chips">${Array.from({ length: 12 }, (_, i) => `<button class="chip" data-a="fromRtp" data-s="${st.id}" data-b2="${b.nr}" data-w="0" data-i="${i}">${i + 1}</button>`).join('')}</div></div>`;
  const trains = `<h2>Trainings</h2><button class="btn pri block" data-a="planOpen" data-s="${st.id}" data-b2="${b.nr}" data-team="${esc((S.flow && S.flow.team) || '')}" data-auto="1">Ganzen Block mit Datum planen</button><button class="btn block" data-a="blockAll" data-s="${st.id}" data-b2="${b.nr}">Ganzen Block ohne Datum übernehmen (${st.slots ? b.weeks.reduce((a, w) => a + w.trainings.length, 0) : 12} Trainings)</button>${weeks}`;
  const ath = b.athletik ? `<h2>Athletik</h2><div class="card">${b.athletik.ziele.map(z => `<p class="small">${z.faktor ? `<b>${esc(z.faktor)}:</b> ` : '<b>Ziel:</b> '}${esc(z.text)}</p>`).join('')}</div>
    ${b.athletik.sessions.map(s => `<details class="card"><summary><b>${esc(s.faktor)}</b> <span class="muted small">Woche ${esc(s.woche)} · Training ${esc(s.training)}</span></summary>
      ${s.items.map(it => `<div class="slot"><b>${it.form ? `<a href="#/lib/x/${encodeURIComponent(norm(it.form))}">${esc(it.form)}</a>` : 'Übung'}</b><div class="small">${esc([it.whg, it.serien && it.serien + ' Serien', it.gewicht, it.rhythmus].filter(Boolean).join(' · '))}</div>${it.keypoints ? `<div class="small muted">${esc(it.keypoints)}</div>` : ''}</div>`).join('')}</details>`).join('')}` : '';
  return head(`${st.id} · Block ${b.nr}`, '/rtp', '', S.flow ? 'Neues Training · Training wählen' : 'Rahmentrainingsplan · Block', ctxBar('train')) + `<p class="muted small center">${esc(b.monat || b.phase)}${b.weeks.length ? ` · Woche ${b.weeks[0].w}–${b.weeks[b.weeks.length - 1].w}` : ''}</p>
    ${S.flow ? trains : ''}${part(b.main, 'Hauptschwerpunkt')}${part(b.sec, 'Nebenschwerpunkt')}
    ${ev.length || b.regel.length ? `<div class="card">${ev.length ? `<b>Termine / Events</b><div class="chips">${ev.map(e => chip(e)).join('')}</div>` : ''}${b.regel.length ? `<p class="small"><b>Regel-Fokus:</b> ${esc(b.regel.join(', '))}</p>` : ''}</div>` : ''}
    ${S.flow ? '' : trains}${ath}`;
}

// ---------- Ansicht: Saison ----------
function seasonCfg() {
  if (S.sTeam === undefined) S.sTeam = (teamByName(DB.season.team) || {}).id || '';
  const tm = teamById(S.sTeam); if (!tm) S.sTeam = '';
  return seasonCfgFor(tm);
}
function seasonCfgFor(tm) {
  if (tm && !DB.seasons[tm.id]) DB.seasons[tm.id] = { stage: tm.stage, days: [...(tm.days || [2, 4])], time: tm.time || '', hol: [...(DB.season.hol || [])], start: DB.season.start || '' };
  const s = tm ? DB.seasons[tm.id] : DB.season;
  if (tm) s.days = [...new Set(teamSessions(tm).map(x => x.wd))];   // Trainingstage kommen aus den Einheiten der Mannschaft (alte Felder bleiben als Spiegel)
  if (!s.start) { const n = new Date(), y = n.getMonth() >= 4 ? n.getFullYear() : n.getFullYear() - 1; let d = new Date(y, 4, 1); while (d.getDay() !== 1) d = addDays(d, 1); s.start = iso(d); }
  s.stage = s.stage || DB.stage; s.days = s.days || [2, 4]; s.hol = s.hol || [];
  return s;
}
// Einheiten, an denen die Saison plant: die der Mannschaft, sonst die Tage/Startzeit der allgemeinen Konfiguration
const planSessions = (s, tm) => tm ? teamSessions(tm, true) : [...s.days].sort((a, b) => wdOrd(a) - wdOrd(b)).map(wd => ({ id: 'd' + wd, wd, time: s.time || '', min: 0, ort: '' }));
function seasonWeeks(s = seasonCfg(), tm = teamById(S.sTeam)) {
  const st = stageById(s.stage), out = [], days = planSessions(s, tm);
  const flat = st.slots ? st.blocks.flatMap(b => b.weeks.map(w => ({ b, w }))) : null;
  let mon = monday(pd(s.start)), k = 0, cnt = {}, lastB = null;
  for (let i = 0; i < 60; i++, mon = addDays(mon, 7)) {
    const key = iso(mon), hol = s.hol.includes(key), row = { key, mon, hol, days: [] };
    if (flat) { if (k >= flat.length) break; if (!hol) { row.b = flat[k].b; row.w = flat[k].w; k++; } }
    else { const mid = addDays(mon, 3); if (i > 8 && mid.getMonth() === 3) break; row.b = st.blocks.find(b => b.monat === MONTHS[mid.getMonth()]); if (!row.b && !hol) row.pause = true; }
    if (!hol && row.b) days.forEach((se, di) => {
      const d = addDays(mon, wdOrd(se.wd)); let idx = di;
      if (!flat) { cnt[row.b.nr] = (cnt[row.b.nr] || 0) + 1; idx = (cnt[row.b.nr] - 1) % 12; }
      row.days.push({ date: iso(d), wd: se.wd, idx, sess: se });
    });
    row.first = !!(row.b && row.b !== lastB && !hol); row.ev = row.w ? row.w.events : (row.first ? row.b.events : []); if (row.b && !hol) lastB = row.b;
    out.push(row);
  }
  return out;
}
// Chips einer Woche: je Einheit entweder das schon geplante Training oder «+» zum Anlegen (mehrere Einheiten am selben Tag werden getrennt geführt)
function dayChips(r, byDate, st) {
  const dates = [...new Set(r.days.map(d => d.date))];
  return dates.map(date => {
    const ds = r.days.filter(d => d.date === date), m = matchDay(byDate[date] || [], ds.map(d => d.sess));
    return ds.map((d, i) => { const lbl = `${WD[d.wd]} ${dm(pd(date))}${d.sess.time ? ' · ' + d.sess.time : ''}`, t = m.hit[i];
      return t ? `<a class="chip sel" href="#/t/${t.id}">${lbl} ✓</a>` : `<button class="chip" data-a="sNew" data-s="${st.id}" data-b2="${r.b.nr}" data-w="${r.w ? r.w.w : 0}" data-i="${d.idx}" data-d="${date}" data-x="${esc(d.sess.id)}">+ ${lbl}</button>`; }).join('') + m.extra.map(t => `<a class="chip sel" href="#/t/${t.id}">${WD[pd(date).getDay()]} ${dm(pd(date))} ✓</a>`).join('');
  }).join('');
}
function viewSeason() {
  const s = seasonCfg(), st = stageById(s.stage), today = iso(monday(new Date())), tm = teamById(S.sTeam);
  const byDate = {}; DB.trainings.forEach(t => { if (t.date && (!tm || (teamOf(t) || {}).id === tm.id)) (byDate[t.date] = byDate[t.date] || []).push(t); });
  return head('Saisonplanung', S.flow ? '/new' : null, '', S.flow ? 'Neues Training · Tag wählen' : tm ? `Wochenplan · ${esc(tm.name)}` : 'Wochenplan nach RTP', ctxBar()) + (S.flow ? '' : seg('season')) + `<details class="card" ${DB.season.set ? '' : 'open'}><summary><b>${esc(st.name)}</b> <span class="muted small">ab ${fmtDate(s.start)} · ${tm ? teamSessions(tm).map(x => WD[x.wd] + (x.time ? ' ' + x.time : '')).join(', ') || 'keine Trainingszeit' : s.days.map(d => WD[d]).join(', ')}</span></summary>
    <div class="grid2"><label>Stufe<select data-b="s:stage" data-r="1">${stageOpts(s.stage)}</select></label><label>Start (RTP-Woche 1)<input type="date" data-b="s:start" data-r="1" value="${esc(s.start)}"></label></div>
    <div class="grid2"><label>Mannschaft<select data-b="s:team" data-r="1">${opt('', 'Ohne Mannschaft', S.sTeam)}${DB.teams.map(x => opt(x.id, x.name, S.sTeam)).join('')}</select></label>${tm ? '' : `<label>Startzeit<input type="time" data-b="s:time" value="${esc(s.time || '')}"></label>`}</div>
    ${tm ? `<div class="small muted">Trainingszeiten von ${esc(tm.name)}</div><p class="nomargin">${teamSessions(tm).map(x => esc(sessSummary(tm, x))).join('<br>') || 'Noch keine Trainingszeit.'}</p><p class="small"><a href="#/team/${tm.id}/edit">Trainingszeiten bearbeiten</a></p>` : `<div class="small muted">Trainingstage</div><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip ${s.days.includes(d) ? 'sel' : ''}" data-a="sDay" data-k="${d}">${WD[d]}</button>`).join('')}</div>`}
    <p class="small muted">Der RTP geht von ${st.perWeek} Training(s) pro Woche à ${st.minutes} Min. aus. Markiere Ferienwochen mit «Ferien» – ${st.slots ? 'die RTP-Wochen verschieben sich dann automatisch.' : 'in diesen Wochen werden keine Trainings geplant.'}</p></details>
  ${S.flow ? '' : `<button class="btn block" data-a="planOpen" data-team="${esc(S.sTeam)}" data-s="${esc(s.stage)}" data-mode="season">Ganzen Block mit eigenem Starttermin planen</button>`}
  ${seasonWeeks().map(r => `<div class="card week ${r.key === today ? 'now' : ''} ${r.hol ? 'hol' : ''}" ${r.b ? `style="--c:${efColor(r.b.main.ef)}"` : ''} id="w${r.key}">
    <div class="row"><span><b>${dm(r.mon)}–${dm(addDays(r.mon, 6))}</b> ${r.key === today ? chip('diese Woche') : ''}</span><button class="btn sm ${r.hol ? 'pri' : ''}" data-a="sHol" data-k="${r.key}">${r.hol ? 'Ferien ✓' : 'Ferien'}</button></div>
    ${r.hol ? '' : r.b ? `<div class="small"><a href="#/rtp/${st.id}/${r.b.nr}">Block ${r.b.nr}${r.w ? ` · RTP-Woche ${r.w.w}` : ''}</a> · ${esc(r.b.main.sp || r.b.main.ef)}</div>
      ${r.first ? `<button class="btn sm" data-a="sBlock" data-k="${r.b.nr}">Ganzen Block ${r.b.nr} planen</button>` : ''}${r.ev.length ? `<div class="chips">${r.ev.map(e => chip('📌 ' + e)).join('')}</div>` : ''}
      <div class="chips">${dayChips(r, byDate, st)}</div>` : '<div class="small muted">Saisonpause / frei</div>'}</div>`).join('')}`;
}

function seasonCreate(st, b, w, idx, date, sess, tm) {   // sess = Einheit, auf die das Training fällt (Startzeit, Ort, Dauer); tm = Mannschaft oder null
  const t = st.slots && !(w && w.trainings[idx]) ? newTraining({ stage: st.id, date, ef: b.main.ef, sp: b.main.sp, ziel: b.main.ziel, rtp: { stage: st.id, block: b.nr, week: w ? w.w : 0, idx }, title: `${st.id} · Block ${b.nr} · Zusatztraining` })
    : trainingFromRtp(st.id, b.nr, w ? w.w : 0, idx, date);
  if (tm) applyTeam(t, tm, sess, true); else if (sess && sess.time) t.start = sess.time; save(); return t;
}

// ---------- Ablauf: Ganzen Block planen ----------
// S.plan = { team, stage, block, mode: 'season' (nach Saisonplan) | 'own' (eigener Start), start, days, time, back }
function openPlan(o) { S.plan = { team: o.team || '', stage: o.stage || '', block: +o.block || 0, mode: o.mode || 'season', start: '', days: null, time: null, back: location.hash.slice(1) || '/' }; go('/plan'); }
function planInfo(P) {   // wo der Saisonplan den Block vorsieht
  const tm = teamById(P.team), st = stageById(P.stage), b = st && st.blocks.find(x => x.nr === +P.block); if (!b) return null;
  const rows = seasonWeeks({ ...seasonCfgFor(tm), stage: st.id }, tm).filter(r => r.b && r.b.nr === b.nr && !r.hol), days = rows.flatMap(r => r.days);
  if (!rows.length || !days.length) return null;
  const ws = rows.map(r => r.w && r.w.w).filter(Boolean);
  return { rows, first: days[0].date, label: ws.length ? `Woche ${Math.min(...ws)}–${Math.max(...ws)}` : b.monat || b.phase || '' };
}
function planCompute(P) {
  const tm = teamById(P.team), st = stageById(P.stage), b = st && st.blocks.find(x => x.nr === +P.block), c = { tm, st, b, items: [], skipped: [], hol: 0, total: 0, noSess: false };
  if (!b) return c;
  const cfg = seasonCfgFor(tm), ts = DB.trainings.filter(t => t.date && (!tm || (teamOf(t) || {}).id === tm.id)), day = date => ts.filter(t => t.date === date);
  const list = st.slots ? b.weeks.flatMap(w => w.trainings.map((_, i) => ({ w, idx: i }))) : Array.from({ length: 12 }, (_, i) => ({ w: null, idx: i }));
  c.total = list.length;
  if (P.mode === 'season') {
    const info = planInfo(P); if (!info) return c;
    info.rows.forEach(r => [...new Set(r.days.map(d => d.date))].forEach(date => {
      const ds = r.days.filter(d => d.date === date), m = matchDay(day(date), ds.map(d => d.sess));
      ds.forEach((d, i) => m.hit[i] ? c.skipped.push({ date, sess: d.sess }) : c.items.push({ date, sess: d.sess, w: r.w, idx: d.idx }));
    }));
    return c;
  }
  if (!P.start) return c;
  const sess = tm ? teamSessions(tm, true) : (P.days || []).map(wd => ({ id: 'd' + wd, wd, time: P.time || '', min: 0, ort: '' }));
  if (!sess.length) { c.noSess = true; return c; }
  const hol = new Set(cfg.hol || []), seen = new Set(); let d = pd(P.start), q = 0;
  for (let n = 0; n < 800 && q < list.length; n++, d = addDays(d, 1)) {
    const mk = iso(monday(d)); if (hol.has(mk)) { seen.add(mk); continue; }
    const ds = sess.filter(x => x.wd === d.getDay()).sort((a, b2) => a.time.localeCompare(b2.time)); if (!ds.length) continue;
    const date = iso(d), m = matchDay(day(date), ds);
    ds.forEach((se, i) => { if (q >= list.length) return; if (m.hit[i]) c.skipped.push({ date, sess: se }); else c.items.push({ date, sess: se, ...list[q++] }); });
  }
  c.hol = seen.size; return c;
}
function viewPlan() {
  const P = S.plan || (S.plan = { team: '', stage: '', block: 0, mode: 'season', start: '', days: null, time: null, back: '/' });
  const tm = teamById(P.team); if (P.team && !tm) P.team = '';
  const gen = seasonCfgFor(null);
  if (!P.stage) P.stage = tm ? seasonCfgFor(tm).stage || tm.stage : gen.stage || DB.stage;
  if (!P.days) { P.days = [...gen.days]; P.time = gen.time || ''; }
  const st = stageById(P.stage) || R.stages[0]; P.stage = st.id;
  if (!st.blocks.some(b => b.nr === +P.block)) P.block = 0;
  const info = P.block ? planInfo(P) : null;
  if (P.block && P.mode === 'season' && !info) P.mode = 'own';
  if (P.mode === 'own' && !P.start) P.start = info ? info.first : iso(new Date());
  const c = P.block ? planCompute(P) : null, n = !P.block ? 1 : (P.mode === 'own' && !P.start ? 2 : 3);
  const first = c && c.items[0], last = c && c.items[c.items.length - 1], who = tm ? tm.name : 'ohne Mannschaft';
  const sessTxt = tm ? teamSessions(tm, true).map(x => esc(sessSummary(tm, x))).join('<br>') || 'Noch keine Trainingszeit' : '';
  const startCards = P.block ? `<div class="card"><h3 class="nomargin">2 · Start</h3>
    <button class="card choice ${P.mode === 'season' ? 'sel' : ''}" data-a="planMode" data-k="season" ${info ? '' : 'disabled'}><b>Nach Saisonplan</b><span class="small muted">${info ? esc(info.label) + ', ab ' + fmtDate(info.first) : 'Dieser Block liegt nicht im Saisonplan' + (tm ? ' von ' + esc(tm.name) : '') + ' (Saison-Start ' + fmtDate(seasonCfgFor(tm).start) + ').'}</span></button>
    <button class="card choice ${P.mode === 'own' ? 'sel' : ''}" data-a="planMode" data-k="own"><b>Eigener Starttermin</b><span class="small muted">Die Trainings kommen der Reihe nach auf die Trainingszeiten, ab dem gewählten Tag.</span></button>
    ${P.mode === 'own' ? `<label>Starttermin<input type="date" data-b="p:start" data-r="1" value="${esc(P.start)}"></label>
      ${tm ? `<div class="small muted" style="margin-top:10px">Trainingszeiten von ${esc(tm.name)}</div><p class="small nomargin">${sessTxt}</p><p class="small"><a href="#/team/${tm.id}/edit">Trainingszeiten bearbeiten</a></p>`
        : `<div class="small muted" style="margin-top:10px">Trainingstage</div><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip ${P.days.includes(d) ? 'sel' : ''}" data-a="planDay" data-k="${d}">${WD[d]}</button>`).join('')}</div><label>Startzeit<input type="time" data-b="p:time" value="${esc(P.time || '')}"></label>`}` : tm ? '' : `<p class="small muted nomargin">Ohne Mannschaft gelten die Trainingstage der allgemeinen Saison-Konfiguration (${gen.days.map(d => WD[d]).join(', ')}).</p>`}</div>` : '';
  const prev = c ? `<div class="card item" style="--c:${efColor(c.b.main.ef)}"><h3 class="nomargin">3 · Vorschau</h3>${c.noSess ? '<p class="warn">Keine Trainingszeit vorhanden – lege Trainingstage fest.</p>' : c.items.length ? `<p class="nomargin"><b>${c.items.length} Training${c.items.length > 1 ? 's' : ''}</b> · ${st.id} · Block ${c.b.nr} (${esc(c.b.main.sp || c.b.main.ef)}) · ${esc(who)}</p><p class="nomargin">${fmtDate(first.date)} bis ${fmtDate(last.date)}</p>${c.items.length < c.total ? `<p class="small muted nomargin">Der Block hat ${c.total} Trainings; ${c.total - c.items.length} davon fallen nicht in den Saisonplan oder auf schon belegte Tage.</p>` : ''}` : '<p class="muted">Keine Trainings zu planen (Datum prüfen).</p>'}
    ${c.skipped.length ? `<p class="small warn">${c.skipped.length} Tag${c.skipped.length > 1 ? 'e sind' : ' ist'} schon mit einem Training belegt und ${c.skipped.length > 1 ? 'werden' : 'wird'} nicht doppelt belegt: ${c.skipped.slice(0, 6).map(x => dm(pd(x.date)) + (x.sess.time ? ' ' + x.sess.time : '')).join(', ')}${c.skipped.length > 6 ? ' …' : ''}${P.mode === 'own' ? ' (der Block rückt auf den nächsten freien Termin).' : '.'}</p>` : ''}
    ${c.hol ? `<p class="small muted">${c.hol} Ferienwoche${c.hol > 1 ? 'n' : ''} der Saison-Konfiguration ${c.hol > 1 ? 'werden' : 'wird'} übersprungen.</p>` : ''}
    ${c.items.length ? `<details><summary class="small">Alle Termine</summary>${c.items.map(x => `<div class="small">${fmtDate(x.date)}${x.sess.time ? ' · ' + x.sess.time : ''} · ${x.w ? 'Woche ' + x.w.w + ' · ' : ''}Training ${x.idx + 1}</div>`).join('')}</details><button class="btn pri block" data-a="planGo">${c.items.length} Training${c.items.length > 1 ? 's' : ''} anlegen</button>` : ''}</div>` : '';
  return head('Ganzen Block planen', P.back, '', esc(who), ctxBar('plan', n)) + `<div class="card"><h3 class="nomargin">1 · Mannschaft und Block</h3>
    <label>Mannschaft<select data-b="p:team" data-r="1">${opt('', 'Ohne Mannschaft', P.team)}${DB.teams.map(x => opt(x.id, x.name, P.team)).join('')}</select></label>
    <label>Stufe<select data-b="p:stage" data-r="1">${stageOpts(P.stage)}</select></label>
    <label>Block<select data-b="p:block" data-r="1">${opt('', '– Block wählen –', P.block ? String(P.block) : '')}${st.blocks.map(b => opt(String(b.nr), `Block ${b.nr} · ${b.main.sp || b.main.ef} (${b.monat || b.phase})`, String(P.block))).join('')}</select></label></div>
    ${startCards}${prev}`;
}

// ---------- Ansicht: Kalender ----------
function viewCal() {
  const now = new Date(), todayIso = iso(now);
  const c = S.cal || (S.cal = { y: now.getFullYear(), m: now.getMonth(), day: todayIso, team: '' });
  if (c.team && !teamById(c.team)) c.team = '';
  const byDate = {}; DB.trainings.forEach(t => { if (!t.date) return; const tm = teamOf(t); if (c.team && (!tm || tm.id !== c.team)) return; (byDate[t.date] = byDate[t.date] || []).push(t); });
  const first = new Date(c.y, c.m, 1), start = monday(first), weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(c.y, c.m + 1, 0).getDate()) / 7);
  const cells = []; for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), k = iso(d), ts = byDate[k] || [], cols = ts.map(t => (teamOf(t) || { color: '#6b7785' }).color);
    cells.push(`<button class="cal-d ${d.getMonth() !== c.m ? 'oth' : ''} ${k === todayIso ? 'today' : ''} ${k === c.day ? 'sel' : ''}" data-a="calDay" data-d="${k}" aria-label="${WDL[d.getDay()]}, ${dm(d)}${ts.length ? ', ' + ts.length + ' Training' + (ts.length > 1 ? 's' : '') : ''}"><span class="n">${d.getDate()}</span><span class="dots">${cols.slice(0, 3).map(col => `<i style="background:${esc(col)}"></i>`).join('')}${cols.length > 3 ? `<b>+${cols.length - 3}</b>` : ''}</span></button>`);
  }
  const day = c.day ? pd(c.day) : null, dts = day ? (byDate[c.day] || []).slice().sort((a, b) => (a.start || '').localeCompare(b.start || '')) : [];
  const card = t => { const tm = teamOf(t); return `<a class="card tcard item" style="--c:${esc(tm ? tm.color : '#6b7785')}" href="#/t/${t.id}"><div class="row"><b>${esc(t.title || 'Ohne Titel')}</b><span class="muted">${total(t)}′</span></div><div class="muted small">${tm ? teamDot(tm) + '<b>' + esc(tm.name) + '</b> · ' : ''}${[t.start && `${t.start}–${endTime(t)}`, t.ort, t.sp].filter(Boolean).map(esc).join(' · ') || 'ohne Uhrzeit'}</div></a>`; };
  return head('Kalender', null, `<button class="btn" data-a="calToday">Heute</button>`, 'Monatsübersicht der Trainings') + seg('cal') + `
  ${DB.teams.length ? `<div class="chips"><button class="chip ${c.team ? '' : 'sel'}" data-a="calTeam" data-k="">Alle Mannschaften</button>${DB.teams.map(x => `<button class="chip ${c.team === x.id ? 'sel' : ''}" data-a="calTeam" data-k="${esc(x.id)}">${teamDot(x)}${esc(x.name)}</button>`).join('')}</div>` : ''}
  <div class="row calnav"><button class="btn" data-a="calNav" data-d="-1" aria-label="Voriger Monat">‹</button><b class="grow center">${MONTHS[c.m]} ${c.y}</b><button class="btn" data-a="calNav" data-d="1" aria-label="Nächster Monat">›</button></div>
  <div class="cal"><div class="cal-h">${[1, 2, 3, 4, 5, 6, 0].map(d => `<span>${WD[d]}</span>`).join('')}</div><div class="cal-g">${cells.join('')}</div></div>
  ${day ? `<h2>${WDL[day.getDay()]}, ${dm(day)}${day.getFullYear()}</h2>${dts.map(card).join('') || '<p class="muted">An diesem Tag ist kein Training geplant.</p>'}<button class="btn pri block" data-a="newT" data-team="${esc(c.team)}" data-date="${c.day}">+ Training an diesem Tag</button>` : '<p class="muted small center">Tippe auf einen Tag, um seine Trainings zu sehen oder eines anzulegen.</p>'}`;
}

// ---------- Ansichten: Mannschaften ----------
const teamInfo = tm => [(stageById(tm.stage) || {}).name].filter(Boolean);
const sessLines = tm => teamSessions(tm).map(x => `<div class="small">${esc(sessSummary(tm, x))}</div>`).join('') || '<div class="small muted">Noch keine Trainingszeit</div>';
function viewTeams() {
  const today = iso(new Date());
  return head('Mannschaften', null, `<a class="btn pri" href="#/team/new">+ Neu</a>`, 'Jede Mannschaft hat ihren eigenen Trainingsplan') + doneBar('/teams') + (DB.teams.length ? DB.teams.map(tm => {
    const ts = teamTrainings(tm), next = ts.filter(t => t.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    return `<a class="card item" style="--c:${esc(tm.color)}" href="#/team/${tm.id}"><div class="row"><b>${esc(tm.name)}</b><span class="muted small">${ts.length} Training${ts.length === 1 ? '' : 's'}</span></div><div class="small muted">${esc(teamInfo(tm).join(' · '))}</div><div class="muted">${sessLines(tm)}</div><div class="small">${next ? 'Nächstes: ' + esc(fmtDate(next.date)) : 'Kein kommendes Training'}</div></a>`;
  }).join('') : `<div class="card empty"><h2>Noch keine Mannschaft</h2><p>Lege deine Mannschaft an (Name, Stufe, Farbe, Ort, Trainingstage). Dann planst du ihre Trainings und die Saison direkt dort und siehst sie im Kalender in ihrer Farbe.</p><p><a class="btn pri" href="#/team/new">Mannschaft anlegen</a></p></div>`);
}
function viewTeam(id) {
  const tm = teamById(id); if (!tm) return head('Mannschaft', '/teams') + '<p class="muted center">Mannschaft nicht gefunden.</p>';
  const today = iso(new Date()), all = teamTrainings(tm).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.start || '').localeCompare(b.start || '')), up = all.filter(t => !t.date || t.date >= today), past = all.filter(t => t.date && t.date < today).reverse();
  const card = t => `<a class="card tcard ${t.date && t.date < today ? 'past' : ''}" href="#/t/${t.id}"><div class="row"><b>${esc(t.title || 'Ohne Titel')}</b><span class="muted">${total(t)}′</span></div><div class="muted small">${metaLine(t, false)}</div><div class="bar">${t.items.map(i => `<i style="flex:${+i.min || 1};background:${(TYPES[i.type] || TYPES.sonst)[1]}"></i>`).join('')}</div></a>`;
  return head(tm.name, '/teams', `<a class="btn" href="#/team/${tm.id}/edit">Bearbeiten</a>`, 'Mannschaft · ' + esc((stageById(tm.stage) || {}).name || '')) + doneBar('/team/' + tm.id) + `
  <div class="card item" style="--c:${esc(tm.color)}"><div class="small muted">Trainingszeiten (Vorgaben für neue Trainings)</div>${sessLines(tm)}</div>
  <div class="row wrap"><button class="btn pri" data-a="newT" data-team="${tm.id}">+ Training hinzufügen</button><button class="btn" data-a="teamSeason" data-k="${tm.id}">Saison planen</button><button class="btn" data-a="planOpen" data-team="${tm.id}" data-mode="season">Ganzen Block planen</button><button class="btn" data-a="calTeam" data-k="${tm.id}">Kalender</button></div>
  <h2>Kommende Trainings (${up.length})</h2>${up.map(card).join('') || '<p class="muted">Noch nichts geplant. Tippe auf «Training hinzufügen», «Saison planen» oder «Ganzen Block planen».</p>'}
  ${past.length ? `<details><summary>Vergangene Trainings (${past.length})</summary>${past.map(card).join('')}</details>` : ''}`;
}
function viewTeamForm(id) {
  const tm = id ? teamById(id) : null;
  if (id && !tm) return head('Mannschaft', '/teams') + '<p class="muted center">Mannschaft nicht gefunden.</p>';
  if (!S.mf || S.mf.key !== (id || 'new')) S.mf = tm ? { ...JSON.parse(JSON.stringify(tm)), sessions: JSON.parse(JSON.stringify(teamSessions(tm))), minEdited: 1, key: id } : { key: 'new', id: null, name: '', stage: DB.stage, color: TEAM_COLORS[DB.teams.length % TEAM_COLORS.length], ort: '', sessions: [{ id: uid(), wd: 2, time: '', min: (stageById(DB.stage) || R.stages[0]).minutes, ort: '' }] };
  const f = S.mf, n = tm ? teamTrainings(tm).length : 0;
  return head(tm ? 'Mannschaft bearbeiten' : 'Neue Mannschaft', tm ? '/team/' + tm.id : '/teams', '', tm ? esc(tm.name) : 'Name, Stufe und Vorgaben festlegen') + `<div class="card">
    <label>Name<input data-b="m:name" value="${esc(f.name)}" placeholder="z.B. D2-Junioren"></label>
    <label>Stufe (RTP)<select data-b="m:stage" data-r="1">${stageOpts(f.stage)}</select></label>
    <div class="small muted" style="margin-top:10px">Farbe</div><div class="chips">${TEAM_COLORS.map(c => `<button class="chip swatch ${f.color === c ? 'sel' : ''}" style="--c:${c};background:${c}" data-a="mColor" data-k="${c}" aria-label="Farbe ${c}"></button>`).join('')}</div>
    <label>Ort / Halle (Standard)<input data-b="m:ort" value="${esc(f.ort)}" placeholder="Halle"></label>
    <div class="small muted" style="margin-top:14px"><b>Trainingszeiten</b> – jede Einheit der Woche mit eigenem Tag, Start, Dauer und Ort</div>
    ${f.sessions.map((x, i) => `<div class="sess"><div class="sgrid"><label>Wochentag<select data-b="ms:${esc(x.id)}:wd">${[1, 2, 3, 4, 5, 6, 0].map(d => opt(String(d), WDL[d], String(x.wd))).join('')}</select></label><label>Start<input type="time" data-b="ms:${esc(x.id)}:time" value="${esc(x.time)}"></label><label>Min.<input type="number" inputmode="numeric" data-b="ms:${esc(x.id)}:min" value="${esc(x.min || '')}" placeholder="${(stageById(f.stage) || {}).minutes || ''}"></label></div>
      <div class="row"><label class="grow">Ort / Halle<input data-b="ms:${esc(x.id)}:ort" value="${esc(x.ort)}" placeholder="${esc(f.ort || 'wie Standard')}"></label><button class="btn sm danger" data-a="mDelS" data-id="${esc(x.id)}" aria-label="Trainingszeit ${i + 1} entfernen">Entfernen</button></div></div>`).join('') || '<p class="small muted">Noch keine Trainingszeit – ohne sie plant die Saison keine Tage.</p>'}
    <button class="btn block" data-a="mAddS">+ Trainingszeit hinzufügen</button>
    <p class="small muted">Diese Zeiten füllen neue Trainings (Datum → passende Einheit: Start, Ort, Dauer) und die Saisonplanung der Mannschaft vor. Zwei Einheiten am selben Tag sind möglich.</p>
    <button class="btn pri block" data-a="saveTeam">Speichern</button>${tm ? `<button class="btn danger block" data-a="delTeam" data-id="${tm.id}">Mannschaft löschen${n ? ` (${n} Trainings)` : ''}</button>` : ''}</div>`;
}

// ---------- Ansicht: Mehr ----------
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (location.hash === '#/more') render(); });
function viewMore() {
  return head('Mehr') + `
  <div class="card"><h2 class="nomargin">Teilen &amp; Sichern</h2><p class="small">Einzelne Trainings teilst du im Training über «Teilen» (Link, QR-Code oder Datei). Hier kannst du alle Daten auf einmal sichern oder auf ein anderes Gerät übertragen.</p>
    <div class="row wrap"><button class="btn pri" data-a="expAll">Alles exportieren</button><button class="btn" data-a="impFile">Datei importieren</button><button class="btn" data-a="shareApp">App-Link teilen</button></div><input type="file" id="file" accept=".json,application/json" hidden></div>
  <div class="card"><h2 class="nomargin">Als App installieren</h2>${installEvt ? '<p><button class="btn pri" data-a="install">Jetzt installieren</button></p>' : ''}
    <ul class="small"><li><b>Android (Chrome):</b> Menü ⋮ → «App installieren» bzw. «Zum Startbildschirm hinzufügen»</li><li><b>iPhone (Safari):</b> Teilen-Symbol → «Zum Home-Bildschirm»</li></ul><p class="small muted">Nach dem ersten Öffnen funktioniert die App auch ohne Internet (z.B. in der Halle).</p></div>
  <div class="card"><h2 class="nomargin">Daten</h2><p class="small">${DB.trainings.length} Trainings · ${DB.custom.length} eigene Übungen · ${Object.keys(DB.notes).length} Notizen. Alles ist nur auf diesem Gerät gespeichert.</p><button class="btn danger" data-a="wipe">Alle Daten löschen</button></div>
  <div class="card"><h2 class="nomargin">Über</h2><p class="small">Struktur, Schwerpunkte, Ausbildungsziele, Trainingsformen und Athletik stammen aus den Rahmentrainingsplänen (RTP) von swiss unihockey (Stand ${esc(R.generated)}; U16/U18 «in Arbeit»). Beschreibungen, Skizzen und Videos der Trainingsformen gibt es im <a href="https://utp.swissunihockey.ch" target="_blank" rel="noopener">Unihockey-Trainingsplaner (UTP)</a>.</p><p class="small">${esc(G.note)}</p></div>`;
}

// ---------- Teilen / Import ----------
const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pack(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (!window.CompressionStream) return 'p' + b64u(bytes);
  const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return 'z' + b64u(new Uint8Array(await new Response(cs).arrayBuffer()));
}
async function unpack(s) {
  let bytes = unb64u(s.slice(1));
  if (s[0] === 'z') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  return JSON.parse(new TextDecoder().decode(bytes));
}
const slim = t => { const c = JSON.parse(JSON.stringify(t)); c.items.forEach(i => { for (const k of ['desc', 'coach']) if (!i[k]) delete i[k]; }); return c; };
const download = (name, obj) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const appUrl = () => location.origin + location.pathname;
async function shareTraining(t) {
  const tm = teamOf(t), m = tm ? [tm] : [], url = appUrl() + '#i=' + await pack({ v: 1, t: [slim(t)], m });
  let qr = '';
  try { const q = qrcode(0, 'L'); q.addData(url, 'Byte'); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { qr = '<p class="small muted">Für einen QR-Code ist dieses Training zu umfangreich – nutze den Link oder die Datei.</p>'; }
  S.share = { url, t, m };
  modal(`<h2>«${esc(t.title)}» teilen</h2><p class="small">Die Empfängerin öffnet den Link oder scannt den Code – das Training wird in ihre App importiert. Es findet keine laufende Synchronisation statt; bei Änderungen einfach nochmals teilen.</p>
    <div class="qr">${qr}</div><div class="row wrap"><button class="btn pri" data-a="shNative">Teilen …</button><button class="btn" data-a="shCopy">Link kopieren</button><button class="btn" data-a="shFile">Als Datei</button><button class="btn" data-a="close">Schliessen</button></div>`);
}
function importData(d) {
  if (!d || !Array.isArray(d.t)) { toast('Keine gültigen Trainingsdaten'); return; }
  S.imp = d;
  const dup = d.t.filter(t => getT(t.id)).length, meta = {}; (d.m || []).forEach(m => { if (m && m.id) meta[m.id] = m; });
  const newTm = [...new Set(d.t.map(t => String(t.team || (meta[t.teamId] || {}).name || '').trim()).filter(n => n && !teamByName(n)))];
  modal(`<h2>Importieren?</h2><ul>${d.t.slice(0, 12).map(t => `<li>${esc(t.title)}${t.date ? ` <span class="muted small">${fmtDate(t.date)}</span>` : ''}</li>`).join('')}${d.t.length > 12 ? `<li>… und ${d.t.length - 12} weitere</li>` : ''}</ul>
    ${d.c && d.c.length ? `<p class="small">+ ${d.c.length} eigene Übungen und Notizen</p>` : ''}${newTm.length ? `<p class="small">Neue Mannschaft${newTm.length > 1 ? 'en' : ''} wird angelegt: ${newTm.map(n => '«' + esc(n) + '»').join(', ')}</p>` : ''}${dup ? `<p class="small warn">${dup} davon schon vorhanden – wird durch die importierte Version ersetzt.</p>` : ''}
    <div class="row"><button class="btn pri" data-a="impOk">Importieren</button><button class="btn" data-a="close">Abbrechen</button></div>`);
}
function doImport() {
  const d = S.imp; S.imp = null;
  const meta = {}; (d.m || []).forEach(m => { if (m && m.id && m.name) { meta[m.id] = m; if (!teamById(m.id) && !teamByName(m.name)) { const n = mkTeam(m.name, m.stage); Object.assign(n, { color: m.color || n.color, ort: m.ort || '', time: m.time || '', days: Array.isArray(m.days) ? m.days : n.days, min: +m.min || 0, id: m.id }); n.sessions = Array.isArray(m.sessions) ? m.sessions.map(s => ({ ...s })) : legacySessions(n); } } });
  for (const t of d.t) { if (!t.id || !Array.isArray(t.items)) continue; resolveTeam(t, meta); const i = DB.trainings.findIndex(x => x.id === t.id); if (i >= 0) DB.trainings[i] = t; else DB.trainings.push(t); }
  for (const c of d.c || []) { const i = DB.custom.findIndex(x => x.id === c.id); if (i >= 0) DB.custom[i] = c; else DB.custom.push(c); }
  if (d.n) DB.notes = { ...d.n, ...DB.notes };
  LIB = null; flush(); closeModal(); toast(`${d.t.length} Training(s) importiert`); go(d.t.length === 1 ? `/t/${d.t[0].id}` : '/');
}

// ---------- Router ----------
const NEWV = () => head('Neues Training', '/', '', 'Für wen und wie möchtest du starten?') + `<div class="card"><div class="grid2"><label>Mannschaft<select data-b="f:team">${opt('', 'Keine', S.seed.team)}${DB.teams.map(x => opt(x.id, x.name, S.seed.team)).join('')}</select></label><label>Datum (optional)<input type="date" data-b="f:date" value="${esc(S.seed.date)}"></label></div><p class="small muted nomargin">${DB.teams.length ? 'Stufe und – passend zum Wochentag des Datums – Startzeit, Dauer und Ort werden von der Mannschaft übernommen.' : 'Du hast noch keine Mannschaft – <a href="#/teams">Mannschaft anlegen</a>.'}</p></div><div class="col">
  <button class="card choice" data-a="flow" data-k="rtp"><b>📋 Aus dem RTP</b><span class="small muted">Du wählst Stufe, Block und Training (2 Schritte). Das Training enthält gleich alle Blöcke des RTP.</span></button>
  <button class="card choice" data-a="flow" data-k="season"><b>📅 Über die Saisonplanung</b><span class="small muted">Du siehst den Wochenplan und legst Trainings direkt auf einen Tag.</span></button>
  <button class="card choice" data-a="flow" data-k="blank"><b>✏️ Leeres Training</b><span class="small muted">Ohne Vorlage: du fügst Blöcke selbst hinzu, auch aus der Bibliothek.</span></button></div>`;
const NAV = [['/', 'Trainings', '📋'], ['/teams', 'Teams', '👥'], ['/lib', 'Bibliothek', '📚'], ['/rtp', 'RTP', '🗺️'], ['/more', 'Mehr', '⋯']];
function render() {
  const h = location.hash.slice(1) || '/';
  if (h.startsWith('i=')) { unpack(h.slice(2)).then(importData).catch(() => toast('Link konnte nicht gelesen werden')); history.replaceState(null, '', location.pathname + '#/'); return render(); }
  const p = h.split('/').filter(Boolean).map(decodeURIComponent);
  let html = '', tab = '/' + (p[0] || ''), run = false;
  if (S.flow && !(S.flow.k === 'rtp' && ['rtp', 'new'].includes(p[0])) && !(S.flow.k === 'season' && ['season', 'new'].includes(p[0]))) S.flow = null;
  if (S.pick && p[0] !== 'lib') S.pick = null;
  if (!S.flow && p[0] !== 'new') S.seed = { team: '', date: '' };
  if (p[0] !== 'team') S.mf = null;
  if (p[0] !== 'plan') S.plan = null;
  if (S.done && S.done.h !== '/' + p.map(encodeURIComponent).join('/')) S.done = null;
  if (!p.length) html = viewHome();
  else if (p[0] === 'new') { html = NEWV(); tab = '/'; }
  else if (p[0] === 'cal') html = viewCal();
  else if (p[0] === 'teams') html = viewTeams();
  else if (p[0] === 'team') html = p[1] === 'new' ? viewTeamForm() : p[2] === 'edit' ? viewTeamForm(p[1]) : viewTeam(p[1]);
  else if (p[0] === 't') {
    const t = getT(p[1]); tab = '/';
    if (!t) html = head('Training', '/') + '<p class="muted center">Training nicht gefunden.</p>';
    else if (p[2] === 'run') { html = viewRun(t); run = true; } else if (p[2] === 'view') html = viewRead(t); else html = viewEdit(t);
  } else if (p[0] === 'lib') {
    if (p[1] === 'new') html = viewLibForm(); else if (p[1] === 'edit') html = viewLibForm(p[2]);
    else if (p[1] === 'x') { const e = libGet(p.slice(2).join('/')); html = e ? viewLibItem(e) : head('Übung', '/lib') + '<p class="muted center">Übung nicht gefunden.</p>'; }
    else html = viewLib();
  } else if (p[0] === 'rtp') {
    const st = stageById(p[1]), b = st && st.blocks.find(x => x.nr === +p[2]);
    html = b ? viewBlock(st, b) : viewRtp();
  } else if (p[0] === 'season') html = viewSeason();
  else if (p[0] === 'plan') { html = viewPlan(); tab = '/' + ((S.plan.back || '/').split('/')[1] || ''); }
  else if (p[0] === 'more') html = viewMore();
  else html = viewHome();
  if (tab === '/season' || tab === '/cal') tab = '/';
  if (tab === '/team') tab = '/teams';
  if (!run && S.run) { S.run = null; wakeLock(false); }
  document.body.classList.toggle('running', run);
  $('#app').innerHTML = html;
  $('#nav').innerHTML = NAV.map(([k, l, i]) => `<a href="#${k}" class="${tab === k ? 'on' : ''}" ${tab === k ? 'aria-current="page"' : ''}><span>${i}</span>${l}</a>`).join('');
  if (render.last !== h.split('/').slice(0, 3).join('/')) scrollTo(0, 0);
  render.last = h.split('/').slice(0, 3).join('/');
  if (p[0] === 'season' && !render.seasonScrolled) { const el = $('.week.now'); if (el) { el.scrollIntoView({ block: 'center' }); render.seasonScrolled = true; } }
}
addEventListener('hashchange', render);

// ---------- Aktionen ----------
const curT = () => getT((location.hash.match(/#\/t\/([^/]+)/) || [])[1]);
const A = {
  close: closeModal,
  calNav(el) { const c = S.cal, d = new Date(c.y, c.m + +el.dataset.d, 1); c.y = d.getFullYear(); c.m = d.getMonth(); c.day = ''; render(); },
  calToday() { const n = new Date(); S.cal = { ...(S.cal || {}), y: n.getFullYear(), m: n.getMonth(), day: iso(n) }; render(); },
  calDay(el) { const c = S.cal, d = pd(el.dataset.d); c.day = el.dataset.d; c.y = d.getFullYear(); c.m = d.getMonth(); render(); },
  calTeam(el) { S.cal = S.cal || {}; if (S.cal.y === undefined) { const n = new Date(); Object.assign(S.cal, { y: n.getFullYear(), m: n.getMonth(), day: iso(n) }); } S.cal.team = el.dataset.k; if (location.hash !== '#/cal') go('/cal'); else render(); },
  newT(el) { S.seed = { team: el.dataset.team || '', date: el.dataset.date || '' }; go('/new'); },
  flow(el) { const k = el.dataset.k; if (k === 'blank') return A.blankT(); S.flow = { k, ...S.seed }; const tm = teamById(S.seed.team); if (tm) { if (k === 'rtp') DB.stage = tm.stage; else S.sTeam = tm.id; save(); } go(k === 'rtp' ? '/rtp' : '/season'); },
  flowCancel() { S.flow = null; S.seed = { team: '', date: '' }; go('/'); },
  mColor(el) { S.mf.color = el.dataset.k; document.querySelectorAll('[data-a=mColor]').forEach(b => b.classList.toggle('sel', b === el)); },
  mAddS() {
    const f = S.mf, used = new Set(f.sessions.map(x => x.wd)), last = f.sessions[f.sessions.length - 1] || {}, wd = [2, 4, 5, 1, 3, 6, 0].find(d => !used.has(d));
    f.sessions.push({ id: uid(), wd: wd ?? 2, time: last.time || '', min: last.min || (stageById(f.stage) || {}).minutes || 0, ort: last.ort || '' }); render();
  },
  mDelS(el) { S.mf.sessions = S.mf.sessions.filter(x => x.id !== el.dataset.id); render(); },
  teamSeason(el) { S.sTeam = el.dataset.k; render.seasonScrolled = false; go('/season'); },
  saveTeam() {
    const f = S.mf, name = f.name.trim(); if (!name) return toast('Bitte einen Namen eingeben');
    if (DB.teams.some(x => x.id !== f.id && x.name.trim().toLowerCase() === name.toLowerCase())) return toast('Diese Mannschaft gibt es schon');
    const vals = { name, stage: f.stage, color: f.color, ort: f.ort.trim(), sessions: f.sessions.map(x => ({ id: x.id, wd: +x.wd, time: x.time || '', min: +x.min || 0, ort: String(x.ort || '').trim() })) }; let tm;
    if (f.id) { tm = teamById(f.id); const mine = teamTrainings(tm); Object.assign(tm, vals); mine.forEach(t => setTeam(t, tm)); }
    else { tm = { id: uid(), ...vals }; DB.teams.push(tm); }
    mirrorLegacy(tm);
    S.mf = null; save(); done(f.id ? `Mannschaft «${name}» gespeichert.` : `Mannschaft «${name}» angelegt – plane jetzt ihr erstes Training.`, `/team/${tm.id}`);
  },
  delTeam(el) {
    const tm = teamById(el.dataset.id), n = teamTrainings(tm).length;
    modal(`<h2>«${esc(tm.name)}» löschen?</h2><p>${n ? `Die Mannschaft hat ${n} Training${n > 1 ? 's' : ''}. Was soll damit geschehen?` : 'Die Mannschaft hat keine Trainings.'}</p><div class="col"><button class="btn danger" data-a="delTeamDo" data-id="${tm.id}" data-m="keep">Nur die Mannschaft löschen${n ? ' – Trainings bleiben, ohne Mannschaft' : ''}</button>${n ? `<button class="btn danger" data-a="delTeamDo" data-id="${tm.id}" data-m="all">Mannschaft und ${n} Training${n > 1 ? 's' : ''} löschen</button>` : ''}<button class="btn" data-a="close">Abbrechen</button></div><p class="small muted">Direkt danach kannst du es noch rückgängig machen.</p>`);
  },
  delTeamDo(el) {
    closeModal(); const tm = teamById(el.dataset.id), mine = teamTrainings(tm), prev = mine.map(t => [t, t.team, t.teamId]), cfg = DB.seasons[tm.id], idx = DB.teams.indexOf(tm), all = el.dataset.m === 'all';
    DB.teams.splice(idx, 1); delete DB.seasons[tm.id];
    if (all) { const ids = new Set(mine.map(t => t.id)); DB.trainings = DB.trainings.filter(t => !ids.has(t.id)); } else mine.forEach(t => setTeam(t, null));
    if (S.team === tm.id) S.team = ''; if (S.sTeam === tm.id) S.sTeam = ''; save(); go('/teams');
    toast(all ? `«${tm.name}» und ${mine.length} Trainings gelöscht` : `«${tm.name}» gelöscht – ${mine.length} Trainings bleiben ohne Mannschaft`, 'Rückgängig', () => { DB.teams.splice(idx, 0, tm); if (cfg) DB.seasons[tm.id] = cfg; if (all) DB.trainings.push(...mine); else prev.forEach(([t, tn, ti]) => { t.team = tn; t.teamId = ti; }); save(); render(); });
  },
  pickCancel() { const id = S.pick; S.pick = null; go(id && getT(id) ? `/t/${id}` : '/'); },
  doneX() { S.done = null; render(); },
  blankT() { const f = { ...S.seed, ...(S.flow || {}) }, tm = teamById(f.team), t = newTraining(tm ? { stage: tm.stage, min: +tm.min || stageById(tm.stage).minutes } : {}); applyFlow(t); S.flow = null; done('Leeres Training angelegt – gib ihm einen Titel und füge Blöcke hinzu.', `/t/${t.id}`); },
  tog(el) { const id = el.dataset.id; S.open.has(id) ? S.open.delete(id) : S.open.add(id); render(); },
  togAll() { const t = curT(), all = t.items.every(i => S.open.has(i.id)); t.items.forEach(i => all ? S.open.delete(i.id) : S.open.add(i.id)); render(); },
  mv(el) { const t = curT(), i = t.items.findIndex(x => x.id === el.dataset.id), j = i + +el.dataset.d; if (j < 0 || j >= t.items.length) return; [t.items[i], t.items[j]] = [t.items[j], t.items[i]]; touch(t); render(); },
  delI(el) { const t = curT(), i = t.items.findIndex(x => x.id === el.dataset.id), it = t.items.splice(i, 1)[0]; touch(t); render(); toast('Block entfernt', 'Rückgängig', () => { t.items.splice(i, 0, it); touch(t); render(); }); },
  dupI(el) { const t = curT(), i = t.items.findIndex(x => x.id === el.dataset.id); t.items.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(t.items[i])), id: uid() }); touch(t); render(); },
  addI() { const t = curT(), it = mkItem('gp', '', 15); it.g.text = goalieFocus('gp', t.sp, t.ef, t.stage); t.items.push(it); S.open.add(it.id); touch(t); render(); },
  addG() { const t = curT(); S.pick = t.id; S.lib.kind = 'goalie'; S.lib.stage = t.stage; S.lib.sp = ''; go('/lib'); },
  pick() { const t = curT(); S.pick = t.id; S.lib.stage = t.stage; if (S.lib.kind === 'goalie') S.lib.kind = ''; go('/lib'); },
  dupT() { const t = curT(), c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.title += ' (Kopie)'; c.items.forEach(i => i.id = uid()); c.updated = Date.now(); DB.trainings.push(c); save(); toast('Dupliziert'); go(`/t/${c.id}`); },
  delT() { const t = curT(); removeTrainings([t]); go('/'); },
  toastAct() { const fn = toast.fn; toast.fn = null; $('#toast').className = ''; fn && fn(); },
  teamF(el) { S.team = el.dataset.k; render(); },
  selMode() { S.sel = S.sel ? null : new Set(); render(); },
  selT(el) { const id = el.dataset.id; S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); render(); },
  selAll() { const all = S.visible.every(id => S.sel.has(id)); S.sel = new Set(all ? [] : S.visible); render(); },
  delSel() { removeTrainings(DB.trainings.filter(t => S.sel.has(t.id))); S.sel = null; render(); },
  grp(el) {
    const k = el.dataset.k, g = DB.trainings.filter(t => grpKey(t) === k), dated = g.some(t => t.date);
    modal(`<h2>${g.length} Training${g.length > 1 ? 's' : ''}</h2><div class="col">${dated ? `<button class="btn" data-a="grpShift" data-k="${esc(k)}" data-d="7">Alle eine Woche später</button><button class="btn" data-a="grpShift" data-k="${esc(k)}" data-d="-7">Alle eine Woche früher</button>` : ''}
      <button class="btn" data-a="grpSel" data-k="${esc(k)}">Alle auswählen</button><button class="btn danger" data-a="grpDel" data-k="${esc(k)}">Ganzen Block löschen</button><button class="btn" data-a="close">Abbrechen</button></div>`);
  },
  grpDel(el) { closeModal(); removeTrainings(DB.trainings.filter(t => grpKey(t) === el.dataset.k)); render(); },
  grpSel(el) { closeModal(); S.sel = new Set(DB.trainings.filter(t => grpKey(t) === el.dataset.k).map(t => t.id)); render(); },
  grpShift(el) { closeModal(); DB.trainings.forEach(t => { if (grpKey(t) === el.dataset.k && t.date) t.date = iso(addDays(pd(t.date), +el.dataset.d)); }); save(); toast('Verschoben'); render(); },
  blockAll(el) {
    const st = stageById(el.dataset.s), b = st.blocks.find(x => x.nr === +el.dataset.b2); let n = 0;
    if (st.slots) b.weeks.forEach(w => w.trainings.forEach((_, i) => { trainingFromRtp(st.id, b.nr, w.w, i); n++; })); else for (let i = 0; i < 12; i++, n++) trainingFromRtp(st.id, b.nr, 0, i);
    S.flow = null; done(`${n} Trainings erstellt (${st.id} · Block ${b.nr}) – hier in der Liste.`, '/');
  },
  sBlock(el) { openPlan({ team: S.sTeam, stage: seasonCfg().stage, block: el.dataset.k, mode: 'season' }); },
  planOpen(el) { const d = el.dataset; let team = d.team || ''; if (!team && d.auto) { const l = DB.teams.filter(x => x.stage === d.s); if (l.length === 1) team = l[0].id; } openPlan({ team, stage: d.s || (teamById(team) || {}).stage || '', block: d.b2, mode: d.mode || (d.b2 ? 'season' : 'own') }); },
  planMode(el) { const P = S.plan; P.mode = el.dataset.k; if (P.mode === 'own' && !P.start) { const i = planInfo(P); P.start = i ? i.first : iso(new Date()); } render(); },
  planDay(el) { const P = S.plan, k = +el.dataset.k; P.days = P.days.includes(k) ? P.days.filter(x => x !== k) : [...P.days, k]; render(); },
  planCancel() { const b = S.plan ? S.plan.back : '/'; S.plan = null; go(b); },
  planGo() {
    const P = S.plan, c = planCompute(P); if (!c.items.length) return;
    const made = c.items.map(x => seasonCreate(c.st, c.b, x.w, x.idx, x.date, x.sess, c.tm)), ids = made.map(t => t.id), h = c.tm ? '/team/' + c.tm.id : '/';
    S.plan = null; done(`${made.length} Trainings geplant (${c.st.id} · Block ${c.b.nr}${c.tm ? ' · ' + c.tm.name : ''}), ${fmtDate(c.items[0].date)} bis ${fmtDate(c.items[c.items.length - 1].date)}.`, h, ids);
  },
  doneUndo() {
    const ids = new Set((S.done && S.done.undo) || []), n = DB.trainings.filter(t => ids.has(t.id)).length;
    DB.trainings = DB.trainings.filter(t => !ids.has(t.id)); S.done = null; save(); toast(`${n} Trainings zurückgenommen`); render();
  },
  share() { shareTraining(curT()); },
  print() { print(); },
  shNative() { const { url, t } = S.share; if (navigator.share) navigator.share({ title: t.title, text: 'Unihockey-Training: ' + t.title, url }).catch(() => { }); else A.shCopy(); },
  shCopy() { navigator.clipboard.writeText(S.share.url).then(() => toast('Link kopiert'), () => prompt('Link kopieren:', S.share.url)); },
  shFile() { download(`training-${norm(S.share.t.title).replace(/ /g, '-')}.json`, { v: 1, t: [S.share.t], m: S.share.m }); },
  shareApp() { const url = appUrl(); if (navigator.share) navigator.share({ title: 'Unihockey Trainingsplaner', url }).catch(() => { }); else navigator.clipboard.writeText(url).then(() => toast('Link kopiert')); },
  expAll() { download(`unihockey-trainings-${iso(new Date())}.json`, { v: 1, t: DB.trainings, c: DB.custom, n: DB.notes, m: DB.teams }); },
  impFile() { $('#file').click(); },
  impOk: doImport,
  install() { installEvt && installEvt.prompt(); installEvt = null; },
  wipe() { if (confirm('Wirklich ALLE Trainings, eigenen Übungen und Notizen auf diesem Gerät löschen?')) { DB = EMPTY(); LIB = null; flush(); render(); } },
  libKind(el) { S.lib.kind = el.dataset.k; S.lib.sp = ''; S.lib.limit = 60; render(); },
  libMore() { S.lib.limit += 100; $('#liblist').innerHTML = libList(); },
  utp(el) { navigator.clipboard && navigator.clipboard.writeText(el.dataset.n).then(() => toast('Name kopiert'), () => { }); open('https://utp.swissunihockey.ch', '_blank', 'noopener'); },
  addLib(el) {
    const e = libGet(el.dataset.k), add = t => { const it = itemFromLib(e, t); t.items.push(it); S.open.add(it.id); touch(t); closeModal(); S.pick = null; done(`«${it.name}» zum Training hinzugefügt (ganz unten, aufgeklappt).`, `/t/${t.id}`); setTimeout(() => { const c = document.querySelector(`[data-id="${it.id}"]`); c && c.scrollIntoView({ block: 'center' }); }, 50); };
    if (el.dataset.t) return add(el.dataset.t === 'new' ? newTraining({}) : getT(el.dataset.t));
    if (S.pick && getT(S.pick)) return add(getT(S.pick));
    const ts = [...DB.trainings].sort((a, b) => b.updated - a.updated).slice(0, 8);
    modal(`<h2>Zu welchem Training?</h2><div class="col">${ts.map(t => `<button class="btn" data-a="addLib" data-k="${esc(e.key)}" data-t="${t.id}">${esc(t.title)}${t.date ? ' · ' + fmtDate(t.date) : ''}</button>`).join('')}<button class="btn pri" data-a="addLib" data-k="${esc(e.key)}" data-t="new">+ Neues Training</button><button class="btn" data-a="close">Abbrechen</button></div>`);
  },
  cStage(el) { const f = S.form, k = el.dataset.k; f.stages = f.stages.includes(k) ? f.stages.filter(x => x !== k) : [...f.stages, k]; el.classList.toggle('sel'); },
  saveC() { const f = S.form; if (!f.name.trim()) return toast('Bitte einen Namen eingeben'); f.min = +f.min || 10; if (f.id) Object.assign(DB.custom.find(x => x.id === f.id), f); else { f.id = uid(); DB.custom.push(f); } LIB = null; save(); toast('Gespeichert'); go(`/lib/x/${encodeURIComponent('c:' + f.id)}`); },
  delC(el) { if (!confirm('Eigene Übung löschen?')) return; DB.custom = DB.custom.filter(x => x.id !== el.dataset.id); LIB = null; save(); go('/lib'); },
  stage(el) { DB.stage = el.dataset.k; save(); render(); },
  fromRtp(el) { const d = el.dataset, t = trainingFromRtp(d.s, +d.b2, +d.w, +d.i, d.d); applyFlow(t); S.flow = null; done(`Training erstellt aus ${d.s} · Block ${d.b2}${+d.w ? ' · Woche ' + d.w : ''} – ${t.items.length} Blöcke${t.team ? ' · ' + t.team : ''}. Jetzt kannst du es anpassen.`, `/t/${t.id}`); },
  sNew(el) { const d = el.dataset, st = stageById(d.s), b = st.blocks.find(x => x.nr === +d.b2), tm = teamById(S.sTeam), sess = planSessions(seasonCfg(), tm).find(x => x.id === d.x), t = seasonCreate(st, b, b.weeks.find(x => x.w === +d.w), +d.i, d.d, sess, tm); applyFlow(t); S.flow = null; done(`Training für ${fmtDate(d.d)} erstellt (${st.id} · Block ${b.nr}). Jetzt kannst du es anpassen.`, `/t/${t.id}`); },
  sDay(el) { const s = seasonCfg(), k = +el.dataset.k; s.days = s.days.includes(k) ? s.days.filter(x => x !== k) : [...s.days, k]; s.set = 1; save(); render(); },
  sHol(el) { const s = seasonCfg(), k = el.dataset.k; s.hol = s.hol.includes(k) ? s.hol.filter(x => x !== k) : [...s.hol, k]; s.set = 1; save(); render(); },
  runTog() { const r = S.run; r.started = true; r.on = !r.on; r.last = Date.now(); wakeLock(r.on); render(); },
  runReset() { runSet(curT(), S.run.i); render(); },
  runGo(el) { const t = curT(), i = +el.dataset.i; if (i < 0 || i >= t.items.length) return; S.run.started = true; runSet(t, i); render(); scrollTo(0, 0); },
  runExit() { wakeLock(false); },
};
document.addEventListener('toggle', ev => { if (ev.target.classList && ev.target.classList.contains('rtpsum')) S.sumClosed = !ev.target.open; }, true);
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]'); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  if (el.tagName !== 'A') ev.preventDefault();
  fn(el, ev);
});
function onInput(ev) {
  const el = ev.target.closest('[data-b]'); if (!el) return;
  const [k, a, b] = el.dataset.b.split(':'), v = el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value;
  const rer = el.dataset.r && ev.type === 'change';
  if (k === 't' && a === 'teamId') { const t = curT(), tm = teamById(v); if (v === '__txt') return; if (tm) applyTeam(t, tm); else setTeam(t, null); touch(t); }
  else if (k === 't') { const t = curT(); t[a] = v; touch(t); if (a === 'min') $('#sum').innerHTML = sumHtml(t); }
  else if (k === 'i' || k === 'g') {
    const t = curT(), it = t.items.find(x => x.id === a); if (!it) return;
    if (k === 'g') { it.g[b] = v; if (b === 'mode' && v !== 'own') it.g.name = ''; } else it[b] = v;
    touch(t); if (b === 'min') $('#sum').innerHTML = sumHtml(t);
  }
  else if (k === 'n') { const key = el.dataset.b.slice(2, el.dataset.b.lastIndexOf(':')), f = el.dataset.b.slice(el.dataset.b.lastIndexOf(':') + 1); (DB.notes[key] = DB.notes[key] || {})[f] = v; if (!DB.notes[key].desc && !DB.notes[key].goalie) delete DB.notes[key]; save(); }
  else if (k === 'c') S.form[a] = v;
  else if (k === 'f') { S.seed[a] = v; return; }
  else if (k === 'p') { const P = S.plan; P[a] = a === 'block' ? +v || 0 : v; if (a === 'team') { const tm = teamById(v); P.stage = tm ? seasonCfgFor(tm).stage || tm.stage : P.stage; P.block = 0; } if (a === 'stage') P.block = 0; }
  else if (k === 'm') { const f = S.mf; f[a] = v; if (a === 'stage' && !f.minEdited) f.sessions.forEach(x => x.min = stageById(v).minutes); }
  else if (k === 'ms') { const f = S.mf, x = f.sessions.find(y => y.id === a); if (!x) return; x[b] = b === 'wd' ? +v : v; if (b === 'min') f.minEdited = 1; }
  else if (k === 's' && a === 'team') { S.sTeam = v; render.seasonScrolled = false; render(); return; }
  else if (k === 's') { const s = seasonCfg(); s[a] = v; s.set = 1; if (a === 'stage') DB.stage = v; render.seasonScrolled = false; save(); }
  else if (k === 'l') { S.lib[a] = v; S.lib.limit = 60; if (a === 'q') { $('#liblist').innerHTML = libList(); return; } if (a === 'stage') S.lib.sp = ''; }
  if (rer) render();
}
document.addEventListener('input', onInput);
document.addEventListener('change', ev => {
  if (ev.target.id === 'file') { const f = ev.target.files[0]; if (f) f.text().then(x => importData(JSON.parse(x))).catch(() => toast('Datei konnte nicht gelesen werden')); ev.target.value = ''; return; }
  if (ev.target.dataset.r) onInput(ev);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
render();
// UTP-Links: Verbindung schon beim Berühren des Knopfs aufbauen, damit die Erklärung schneller aufgeht.
document.addEventListener('pointerdown', ev => {
  const a = ev.target.closest && ev.target.closest('a.utp'); if (!a) return;
  const l = document.createElement('link'); l.rel = 'preconnect'; l.href = new URL(a.href).origin; document.head.appendChild(l); setTimeout(() => l.remove(), 15000);
}, { passive: true });
