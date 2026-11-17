'use strict';
/* Unihockey Trainingsplaner – offline-fähige Web-App ohne Login. Daten liegen lokal im Browser (localStorage). */
const R = window.RTP, G = window.GOALIE, UTPX = (window.UTP || {}).ex || {};
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
// Abgleich «Mannschaftsraum»: Konfiguration aus sync-config.js. Entwickler-Schalter: nur auf localhost/127.0.0.1 mit ?sync=dev (gilt für die Sitzung) wird der lokale Test-Server benutzt.
const SYNCCFG = (() => {
  let c = window.SYNC || {};
  try {
    if (['localhost', '127.0.0.1'].includes(location.hostname)) {
      if (/[?&]sync=dev(&|$)/.test(location.search)) sessionStorage.setItem('unihockey-sync-dev', '1');
      if (sessionStorage.getItem('unihockey-sync-dev') === '1') c = { url: 'http://localhost:5180', key: 'dev-key' };
    }
  } catch (e) { /* ohne sessionStorage: Konfiguration aus sync-config.js */ }
  return { url: String(c.url || '').trim().replace(/\/+$/, ''), key: String(c.key || '').trim() };
})();
const SYNC_ON = !!(SYNCCFG.url && SYNCCFG.key && window.crypto && crypto.subtle);
const SP = { chain: Promise.resolve(), pend: new Map(), st: {}, t: null };   // Abgleich: Reihenfolge der Vorgänge, wartende, Status je Mannschaft, Timer
let saveT;
const flush = () => { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { toast('Speichern fehlgeschlagen'); } };
const save = () => { clearTimeout(saveT); saveT = setTimeout(flush, 200); spDirty(); };
addEventListener('pagehide', flush);

const S = { open: new Set(), pick: null, seed: { team: '', date: '' }, flow: null, done: null, lib: { q: '', kind: '', stage: '', sp: '', limit: 60 }, run: null, form: null, expl: new Set(), tsec: new Set() };

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

// Spielerliste (optional, Datensparsamkeit: nur diese Felder): tm.players = [{ id, first, last, jsnr (nur Ziffern), rn (Rückennummer), role: 'T' Teilnehmer/in | 'L' Leiter/in }].
// Anwesenheit am Training: t.att = { <playerId>: 1 }, t.jsType = 'Training' | 'Wettkampf' | 'Trainingstag' (fehlt = Training). Beides bleibt auf dem Gerät: slim() entfernt t.att beim Teilen, teamMeta() lässt players weg.
const playersOf = tm => Array.isArray(tm && tm.players) ? tm.players : [];
const pName = p => [p.first, p.last].filter(Boolean).join(' ') || 'Ohne Namen';
const cleanPlayer = p => ({ id: String(p.id || uid()), first: String(p.first || '').trim().slice(0, 60), last: String(p.last || '').trim().slice(0, 60), jsnr: String(p.jsnr || '').replace(/\D/g, '').slice(0, 12), rn: String(p.rn ?? '').replace(/\s/g, '').slice(0, 3), role: p.role === 'L' ? 'L' : 'T', ...(+p.u > 0 ? { u: +p.u } : {}) });
const JS_TYPES = ['Training', 'Wettkampf', 'Trainingstag'];
const jsTypeOf = t => JS_TYPES.includes(t.jsType) ? t.jsType : 'Training';
const attOf = t => t.att && typeof t.att === 'object' ? t.att : {};
const attCount = (t, tm) => playersOf(tm).filter(p => attOf(t)[p.id]).length;
const teamMeta = (tm, withPlayers) => { const c = JSON.parse(JSON.stringify(tm)); if (!withPlayers) delete c.players; return c; };
function mergePlayers(tm, list) {   // Spielerliste per Spieler-id zusammenführen
  tm.players = playersOf(tm);
  for (const p0 of list) { if (!p0 || !(p0.first || p0.last)) continue; const p = cleanPlayer(p0), i = tm.players.findIndex(x => x.id === p.id); if (i >= 0) tm.players[i] = p; else tm.players.push(p); }
}
// Mehrfacheingabe: eine Person pro Zeile, «Vorname Name» oder «Name, Vorname», optional J+S-Nummer (5–12 Ziffern) am Zeilenende
function parsePlayers(text) {
  return String(text || '').split(/\r?\n/).map(l => l.replace(/\t/g, ' ').replace(/;/g, ',').trim()).filter(Boolean).map(l => {
    let nr = ''; const m = l.match(/^(.*?)[\s,]+(\d{5,12})$/); if (m) { l = m[1]; nr = m[2]; }
    l = l.replace(/[,\s]+$/, '').trim(); let first, last;
    if (l.includes(',')) { const [a, ...r] = l.split(','); last = a.trim(); first = r.join(' ').trim(); }
    else { const w = l.split(/\s+/); first = w.shift() || ''; last = w.join(' '); }
    return { first, last, jsnr: nr };
  }).filter(p => p.first || p.last);
}
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
      e.params = e.params || []; if (e.params.length < 6 && !e.params.some(p => p.st === st.id && p.whg === it.whg)) e.params.push({ st: st.id, ...it, faktor: se.faktor, ziel: athZiel(b, se.faktor) });
    }
  }
  G.exercises.forEach(x => m.set('g:' + norm(x.name), { ...x, key: 'g:' + norm(x.name), kind: 'goalie', src: 'goalie', stages: new Set(x.stages), sps: new Set([G.cats[x.cat]]), efs: new Set(), uses: new Set() }));
  DB.custom.forEach(x => m.set('c:' + x.id, { ...x, key: 'c:' + x.id, src: 'custom', stages: new Set(x.stages || []), sps: new Set(), efs: new Set(), uses: new Set() }));
  return LIB = [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
const libGet = key => lib().find(e => e.key === key);
const goalieEx = name => lib().find(e => e.kind === 'goalie' && e.name === name);
// Link zur Übung im UTP und deren Text (UTPX = app/data-utp.js, von tools/build-utp.js; Texte © swiss unihockey, Verwendung mit Einverständnis, nicht-kommerziell). Pro Stufe zuerst die Stufen-Adresse, sonst die allgemeine.
// Tolerant: Gross/klein, Bindestriche und Klammerzusätze («Squat (ohne oder leichtes Gewicht)») spielen keine Rolle; zuletzt wird nach dem Titel der UTP-Übung gesucht.
const normT = s => norm(String(s || '').replace(/\([^)]*\)/g, ' '));
let UIDX = null;
function utpIdx() {
  if (UIDX) return UIDX; UIDX = new Map(); const byId = new Map();
  for (const rel of Object.values(R.links || {})) byId.set(rel.split('?')[0], rel);
  for (const [id, ex] of Object.entries(UTPX)) { const rel = byId.get(id), k = normT(ex.t); if (rel && k && !UIDX.has(k)) UIDX.set(k, rel); }
  return UIDX;
}
function utpRel(name, stage) {
  const k = norm(name || ''); if (!k) return ''; const by = (R.linksBy || {})[stage] || {}, all = R.links || {};
  if (by[k] || all[k]) return by[k] || all[k];
  const t = normT(name); return by[t] || all[t] || utpIdx().get(t) || '';
}
function utpUrl(name, stage) { const rel = utpRel(name, stage); return rel ? (R.utpBase || 'https://utp.swissunihockey.ch/guest/exercises/') + rel : ''; }
const utpEx = (name, stage) => UTPX[utpRel(name, stage).split('?')[0]] || null;
const utpBtn = (url, cls = '') => `<a class="btn pri utp ${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Erklärung im UTP ↗</a>`;
// Text einer UTP-Übung: Überschriften, Absätze, Listen (immer über esc, nie rohes HTML)
function utpText(t) {
  let out = '', ul = false;
  for (const ln of String(t).split('\n')) {
    const b = /^\s*(•|\d+\.)\s?(.*)$/.exec(ln), ind = /^\s{2,}/.test(ln);
    if (b) { if (!ul) { out += '<ul>'; ul = true; } out += `<li${ind ? ' class="sub"' : ''}>${esc(b[2])}</li>`; } else { if (ul) { out += '</ul>'; ul = false; } if (ln.trim()) out += `<p>${esc(ln.trim())}</p>`; }
  }
  return out + (ul ? '</ul>' : '');
}
function exBody(ex) {
  const meta = [ex.tg && ex.tg.tt && ex.tg.tt.join(' · '), ex.d && ex.d + ' Min.'].filter(Boolean).join(' · ');
  return (meta ? `<p class="small muted nomargin">${esc(meta)}</p>` : '') + ex.s.map(([h, l, t]) => (h ? `<div class="${l >= 2 ? 'exh2' : 'exh'}">${esc(h)}</div>` : '') + utpText(t)).join('');
}
const exLinks = (url, ex) => `<p class="small nomargin">${ex && ex.v && /^https:\/\//.test(ex.v) ? `<a class="utp" href="${esc(ex.v)}" target="_blank" rel="noopener noreferrer">Video ansehen ↗</a> · ` : ''}<a class="utp" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Im UTP öffnen ↗</a> <span class="muted">(Skizze, Video)</span></p>`;
// Aufklappbare Erklärung; ohne Text im Datenbestand nur der Link
function explain(url, ex, key) {
  if (!url) return '';
  if (!ex) return `<p>${utpBtn(url)}</p>`;
  return `<details class="expl" data-k="${esc(key)}" ${S.expl.has(key) ? 'open' : ''}><summary>Erklärung <span class="small muted">(Beschreibung, Keypoints, Variationen)</span></summary><div class="exb">${exBody(ex)}</div>${exLinks(url, ex)}<p class="small muted nomargin">Quelle: swiss unihockey, Unihockey-Trainingsplaner</p></details>`;
}
const itemEx = (it, t) => { const e = it.lib && libGet(it.lib); return utpEx(e && e.src === 'rtp' ? e.name : it.name, t.stage); };
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

// Athletik als einzelne Übungen: pro Übung der RTP-Session ein eigener Block mit den RTP-Angaben in it.ath = { whg, serien, gewicht, rhythmus, keypoints, faktor, ziel } (alles optional).
// Die Dauer des Athletik-Slots wird auf die Übungen verteilt (ganze Minuten, Summe = Dauer). Alte Trainings mit dem Sammelblock «Athletik: Kraft» (Text in it.desc) bleiben unverändert.
const athPlay = x => /spielerische/i.test((x && x.whg) || '');   // «5 min. spielerische Anwendung» statt Wiederholungen
function athData(x, faktor, ziel) {
  const a = athPlay(x) ? { whg: 'spielerische Anwendung' } : { whg: x.whg, serien: x.serien, gewicht: x.gewicht, rhythmus: x.rhythmus };
  a.keypoints = x.keypoints; a.faktor = faktor || x.faktor; a.ziel = ziel || x.ziel;
  for (const k of Object.keys(a)) if (!a[k]) delete a[k];
  return a;
}
const athZiel = (b, faktor) => { const z = (b.athletik || {}).ziele || []; return (z.find(x => x.faktor && x.faktor === faktor) || z.find(x => !x.faktor) || z[0] || {}).text || ''; };
function athMins(list, total) {   // spielerische Anwendungen behalten ihre eigene Minutenangabe, den Rest teilen sich die übrigen Übungen
  const fixed = list.map(x => athPlay(x) ? +((/(\d+)\s*min/i.exec(x.whg) || [])[1]) || 0 : 0), nFree = fixed.filter(f => !f).length, rest = Math.max(0, total - fixed.reduce((a, f) => a + f, 0));
  let extra = nFree ? rest % nFree : 0; const base = nFree ? Math.floor(rest / nFree) : 0;
  return list.map((_, i) => fixed[i] || base + (extra-- > 0 ? 1 : 0));
}
function athBlocks(b, n, faktor, total, skipPlay) {   // skipPlay: bei Stufen mit eigenem Slot «Athletik Spiel» ist die spielerische Anwendung schon ein eigener Block
  const se = athSession(b, n, faktor), list = se ? se.items.filter(x => x.form && !(skipPlay && athPlay(x))) : []; if (!list.length) return [];
  const mins = athMins(list, total), ziel = athZiel(b, se.faktor);
  return list.map((x, i) => mkItem('athletik', x.form, mins[i], { ath: athData(x, se.faktor, ziel) }));
}
function athHtml(a) {   // RTP-Angaben als kleine Tabelle
  if (!a || typeof a !== 'object') return '';
  const play = /spielerische/i.test(a.whg || ''), rows = [[play ? 'Form' : 'Wiederholungen', a.whg], ['Serien', a.serien], ['Gewicht', a.gewicht], ['Rhythmus', a.rhythmus], ['Keypoints', a.keypoints], ['Entwicklungsfaktor', a.faktor]].filter(r => r[1]);
  if (!rows.length && !a.ziel) return '';
  return `<div class="athbox"><table class="ath"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>${a.ziel ? `<p class="small nomargin"><b>Athletik-Ziel:</b> ${esc(a.ziel)}</p>` : ''}</div>`;
}

// ---------- Swiss Way Warm-up (Poster swiss unihockey, Daten in data-swissway.js) ----------
// Die Beschreibung des Blocks «Swiss Way Warm-up» nennt, welche Übungen heute dran sind. Die Auswahl hängt nur von einer Zahl (Seed) und vom Tag ab (reine Funktion):
// aufeinanderfolgende Trainings bekommen verschiedene Auswahlen, dasselbe Training immer dieselbe. it.sw = { s: Seed } merkt, dass die Beschreibung erzeugt wurde (und mit welchem Seed).
// Vom Trainer geänderte Beschreibungen werden nie automatisch überschrieben: erzeugt wird nur bei leerer Beschreibung ohne it.sw (erstes Öffnen) oder auf Knopfdruck «Andere Auswahl».
const SWD = window.SWISSWAY || null;
const isSw = it => !!it && norm(it.name || '') === 'swiss way warm up';
const mod = (x, n) => ((x % n) + n) % n;
function swissWayPlan(seed, ctx = {}) {
  if (!SWD) return null;
  const [p1, p2, p3] = SWD.parts, s = Math.floor(+seed || 0), pick = (a, i) => a[mod(i, a.length)];
  const i1 = mod(s, p1.basis.length), i2 = mod(s + 1, p1.basis.length);   // Teil 1: zwei Basis rotierend (in Posterreihenfolge) + eine Ergänzung abwechselnd
  const part1 = [p1.basis[Math.min(i1, i2)], p1.basis[Math.max(i1, i2)], pick(p1.erg, s)];
  const skip = mod(s, p2.basis.length), part2 = [...p2.basis.filter((_, i) => i !== skip), pick(p2.erg, s)];   // Teil 2: die 8 Basis, eine weglassen (rotierend) + eine Ergänzung abwechselnd
  const f = norm(ctx.faktor || ''), sp = norm((ctx.sp || '') + ' ' + (ctx.ef || ''));   // Teil 3: zwei Themen passend zum Tag
  const names = /^kraft/.test(f) ? ['Drop Sets Varianten', 'Zweikämpfe'] : /^explosiv/.test(f) ? ['Explosive Sprünge', 'Drop Sets Varianten'] : /^schnell/.test(f) ? ['Beschleunigung', 'Richtungswechsel']
    : /zweikampf|ballgewinn|1 1/.test(sp) ? ['Zweikämpfe', 'Richtungswechsel'] : /umschalt|raum|konter|tempo/.test(sp) ? ['Beschleunigung', 'Richtungswechsel']
    : pick([['Laufschule', 'Richtungswechsel'], ['Beschleunigung', 'Zweikämpfe'], ['Explosive Sprünge', 'Laufschule'], ['Richtungswechsel', 'Drop Sets Varianten']], s);
  return { p1: part1, p2: part2, p3: names.map(n => p3.items.find(x => x.n === n)), hard: pick(SWD.erschweren, s), ath: !!ctx.ath, faktor: ctx.faktor || '' };
}
function swissWayText(pl) {
  if (!pl || !SWD) return '';
  const [p1, p2, p3] = SWD.parts, ln = x => `• ${x.n} – ${x.t} – ${x.d}`;
  return [`TEIL 1 · ${p1.titel} (${p1.min})`, ...pl.p1.map(ln), '', `TEIL 2 · ${p2.titel} (${p2.min})`, ...pl.p2.map(ln), 'Danach bei Bedarf Jogging.', '',
    `TEIL 3 · ${p3.titel} (${p3.min})`, ...pl.p3.map(ln), ...(pl.ath ? [`Optional – im Anschluss folgt der Athletikteil${pl.faktor ? ' (' + pl.faktor + ')' : ''}.`] : []), '', `Heute erschweren: ${pl.hard}.`].join('\n');
}
function rtpSeq(stageId, blockNr, weekNr, idx) {   // fortlaufende Nummer des RTP-Trainings in der Stufe (aufeinanderfolgende Trainings = aufeinanderfolgende Zahlen)
  const st = stageById(stageId), b = st && st.blocks.find(x => x.nr === +blockNr); if (!b) return +idx || 0;
  const bi = st.blocks.indexOf(b); if (!st.slots) return bi * 12 + (+idx || 0);
  return bi * b.weeks.length * st.perWeek + Math.max(0, b.weeks.findIndex(x => x.w === +weekNr)) * st.perWeek + (+idx || 0);
}
function trainingSeq(t) {   // Seed eines Trainings: RTP-Nummer, sonst die Reihenfolge der Trainings der Mannschaft nach Datum, sonst aus der Kennung
  const r = t.rtp; if (rtpBlockOf(t)) return rtpSeq(r.stage, r.block, r.week, r.idx);
  const tid = x => (teamOf(x) || {}).id || '';
  if (t.date) return DB.trainings.filter(x => x !== t && x.date && tid(x) === tid(t) && (x.date < t.date || (x.date === t.date && (x.start || '') < (t.start || '')))).length;
  return [...String(t.id)].reduce((a, c) => a + c.charCodeAt(0), 0);
}
function swCtx(t) {   // was am Tag sonst ansteht: Athletik-Faktor (Kraft/Explosivität/Schnelligkeit) und ob ein Athletikteil folgt
  const aths = t.items.filter(i => i.type === 'athletik');
  const faktor = aths.map(i => (i.ath && i.ath.faktor) || (/^Athletik:\s*(.+)$/.exec(i.name || '') || [])[1] || '').find(Boolean) || '';
  return { faktor, ath: aths.length > 0, sp: t.sp, ef: t.ef };
}
function swFill(it, t, seed) { it.sw = { s: seed ?? trainingSeq(t) }; it.desc = swissWayText(swissWayPlan(it.sw.s, swCtx(t))); }
function swEnsure(t) {   // bestehende Trainings: leere Beschreibung des Swiss-Way-Blocks beim ersten Öffnen erzeugen
  if (!SWD) return; let ch = false;
  for (const it of t.items) if (isSw(it) && !it.desc && !it.sw) { swFill(it, t); ch = true; }
  if (ch) touch(t);
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
    const aSlot = st.slots.find(x => x.label === 'Athletik'), swc = { faktor: aSlot ? tr[aSlot.key] || '' : '', ath: !!(aSlot && tr[aSlot.key]), sp: b.main.sp, ef: b.main.ef }, seq = rtpSeq(stageId, blockNr, weekNr, idx);
    for (const s of st.slots) {
      const v = tr[s.key]; if (!v) continue;
      const type = slotType(s.label), it = mkItem(type, v, s.min);
      if (s.label === 'Athletik') {   // einzelne Übungen statt Sammelblock; ohne RTP-Session bleibt der Sammelblock
        const ab = athBlocks(b, n, v, s.min, st.slots.some(x => /Athletik Spiel/.test(x.label)));
        if (ab.length) { ab.forEach((x, i) => { x.g = i ? { mode: 'team', name: '', text: '' } : gDef(type, b.main.sp, b.main.ef, n); items.push(x); }); continue; }
        it.name = 'Athletik: ' + v;
      }
      else if (isSw(it)) { it.sw = { s: seq }; it.desc = swissWayText(swissWayPlan(seq, swc)); }
      else { const nt = note(norm(v)); it.desc = nt.desc || ''; it.coach = nt.coach || ''; if (nt.goalie) it.gNote = nt.goalie; if (nt.mat) it.mat = nt.mat; }
      it.g = gDef(type, b.main.sp, b.main.ef, n); if (it.gNote) { it.g.text = it.gNote; delete it.gNote; }
      items.push(it);
    }
    return newTraining({ ...base, items, title: `${st.id} · Block ${b.nr} · Woche ${weekNr}${st.perWeek > 1 ? ' · Training ' + (idx + 1) : ''}`, notes: b.regel.length ? 'Regel-Fokus: ' + b.regel.join(', ') : '' });
  }
  const n = idx + 1, se = athSession(b, n);
  const seq = rtpSeq(stageId, blockNr, weekNr, idx), swb = { ...mkItem('warmup', 'Swiss Way Warm-up', 10), g: gDef('warmup') };
  swb.sw = { s: seq }; swb.desc = swissWayText(swissWayPlan(seq, { faktor: se ? se.faktor : '', ath: true, sp: b.main.sp, ef: b.main.ef })); items.push(swb);
  const ab = athBlocks(b, n, '', 15, false);
  if (ab.length) ab.forEach((x, i) => { x.g = i ? { mode: 'team', name: '', text: '' } : gDef('athletik'); items.push(x); });
  else items.push({ ...mkItem('athletik', 'Athletik' + (se ? ': ' + se.faktor : ''), 15), desc: se ? se.items.map(athLine).join('\n') : '', g: gDef('athletik') });
  items.push({ ...mkItem('skills', 'Skills / Goalie-Einschiessen', 10), g: gDef('skills', '', '', n) });
  const gp = (p, min) => p && items.push({ ...mkItem('gp', (p.gp && p.gp.length ? p.gp[(n - 1) % p.gp.length] : 'Good Practice: ' + (p.sp || p.ef)), min), desc: p.gp && p.gp.length ? '' : 'Trainingsform im UTP wählen (Bibliothek → Stufe und Schwerpunkt filtern).', g: gDef('gp', p.sp, p.ef) });
  gp(b.main, 20); gp(b.sec, 15);
  items.push({ ...mkItem('spiel', 'Spielform', b.sec ? 20 : 35), desc: 'Bonuspunkte/Feedback in Bezug auf den Hauptschwerpunkt.', g: gDef('spiel') });
  return newTraining({ ...base, items, title: `${st.id} · Block ${b.nr} (${b.monat || b.phase}) · Training ${n}` });
}
// Eigene Übungen: der Übungstext gehört zur Übung. Im Training steht eine Kopie (damit geteilte Trainings ihn auch ohne die Übung zeigen);
// wird der Text geändert – im Training oder in der Bibliothek –, bekommen ihn alle Trainings mit dieser Übung, auch vergangene.
const customTxt = e => ({ desc: [e.desc, e.leichter && 'Erleichtern: ' + e.leichter, e.schwerer && 'Erschweren: ' + e.schwerer, e.vari && 'Variieren: ' + e.vari].filter(Boolean).join('\n'), coach: [e.coach, e.fragen && 'Fragen: ' + e.fragen].filter(Boolean).join('\n') });
const customOf = it => { const id = it.lib && String(it.lib).startsWith('c:') ? String(it.lib).slice(2) : ''; return (id && DB.custom.find(x => x.id === id)) || (!it.lib && it.name && DB.custom.find(x => x.name && norm(x.name) === norm(it.name))) || null; };
function syncCustom(c) { const x = customTxt(c); let k = 0; c.u = Date.now(); for (const t of DB.trainings) for (const it of t.items) if (customOf(it) === c) { it.desc = x.desc; it.coach = x.coach; t.updated = Date.now(); k++; } LIB = null; save(); return k; }
function itemFromLib(e, t) {
  const type = TYPES[e.kind] ? e.kind : 'gp', it = mkItem(type, e.name, e.min);
  const nt = note(e.key); it.lib = e.key; if (nt.mat || e.mat) it.mat = nt.mat || e.mat;
  if (e.src === 'custom') Object.assign(it, customTxt(e));
  else if (e.kind === 'athletik' && e.params) { const p = e.params.find(x => x.st === t.stage) || e.params[0]; it.ath = athData(p); }
  else if (e.src === 'rtp') { it.desc = nt.desc || ''; it.coach = nt.coach || ''; }
  it.g = e.kind === 'goalie' ? { mode: 'own', name: e.src === 'goalie' ? e.name : '', text: e.src === 'custom' ? e.desc || '' : '' }
    : { mode: 'team', name: '', text: nt.goalie || e.goalie || goalieFocus(type, [...e.sps][0] || t.sp, [...e.efs][0] || t.ef, t.stage) };
  if (isSw(it) && SWD) swFill(it, t);   // Swiss Way Warm-up: Übungen des Tages in die Beschreibung
  return it;
}

// ---------- UI-Helfer ----------
function toast(msg, act, fn) { const el = $('#toast'); el.innerHTML = esc(msg) + (act ? ` <button data-a="toastAct">${esc(act)}</button>` : ''); toast.fn = fn; el.className = act ? 'on act' : 'on'; clearTimeout(toast.t); toast.t = setTimeout(() => el.className = '', act ? 7000 : 2400); }
const teamDot = tm => `<span class="dot" style="background:${esc(tm.color)}"></span>`;
const metaLine = (t, showTeam) => { const tm = teamOf(t); return `${showTeam && (tm || t.team) ? `${tm ? teamDot(tm) : ''}<b>${esc(tm ? tm.name : t.team)}</b> · ` : ''}${[t.date ? fmtDate(t.date) : 'ohne Datum', t.start && `${t.start}–${endTime(t)}`, t.ort, t.sp].filter(Boolean).map(esc).join(' · ')}`; };
const seg = cur => `<div class="seg">${[['/', 'Liste', 'list'], ['/cal', 'Kalender', 'cal'], ['/season', 'Saison', 'season']].map(([h, l, k]) => `<a href="#${h}" class="${cur === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
// Trainings: drei Ansichten derselben Trainings (Liste | Kalender | Saison). Titel, «+ Neu» und der Mannschaftsfilter (S.team, gilt auch für die Saison-Konfiguration) sind überall gleich.
const tFilter = () => { if (S.team && !teamById(S.team)) S.team = ''; return S.team || ''; };
const teamChips = () => { const f = tFilter(); return DB.teams.length ? `<div class="chips"><button class="chip ${f ? '' : 'sel'}" data-a="teamF" data-k="">Alle Mannschaften</button>${DB.teams.map(x => `<button class="chip ${f === x.id ? 'sel' : ''}" data-a="teamF" data-k="${esc(x.id)}">${teamDot(x)}${esc(x.name)}</button>`).join('')}</div>` : ''; };
function trTop(cur, extra = '') {   // Kopf der drei Ansichten; im Neu-Ablauf «Über die Saisonplanung» ohne Umschalter und «+ Neu», dafür mit Ablaufleiste
  const fl = cur === 'season' && S.flow && S.flow.k === 'season';
  return (fl ? head('Trainings', null, '', '', ctxBar()) : head('Trainings', null, `<button class="btn pri" data-a="newT" data-team="${esc(tFilter())}">+ Neu</button>`) + seg(cur)) + extra + teamChips();
}
const grpKey = t => `${t.team || ''}|${t.rtp ? t.rtp.stage + '|' + t.rtp.block : ''}`;
const endTime = t => { if (!t.start) return ''; const [h, m] = t.start.split(':').map(Number), e = h * 60 + m + total(t); return `${String(Math.floor(e / 60) % 24).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`; };
function removeTrainings(list) {
  if (!list.length) return; const ids = new Set(list.map(t => t.id));
  list.forEach(t => spDel('t', (teamOf(t) || {}).id, t.id));
  DB.trainings = DB.trainings.filter(t => !ids.has(t.id)); save();
  toast(`${list.length} Training${list.length > 1 ? 's' : ''} gelöscht`, 'Rückgängig', () => { DB.trainings.push(...list); list.forEach(t => { t.updated = Date.now(); spDel('t', (teamOf(t) || {}).id, t.id, true); }); save(); render(); });
}
function modal(html) { $('#modal').innerHTML = `<div class="backdrop" data-a="close"></div><div class="sheet">${html}</div>`; $('#modal').className = 'on'; }
function closeModal() { $('#modal').className = ''; $('#modal').innerHTML = ''; S.tsh = null; S.join = null; }
const go = h => { if (location.hash === '#' + h) render(); else location.hash = h; };
const chip = (txt, color) => `<span class="chip" ${color ? `style="--c:${color}"` : ''}>${esc(txt)}</span>`;
const opt = (v, label, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(label)}</option>`;
const stageOpts = (sel, all) => (all ? opt('', 'Alle Stufen', sel) : '') + R.stages.map(s => opt(s.id, s.name, sel)).join('');
// Brotkrumen: der Pfad der aktuellen Seite, zentral aus der Route (und dem Zustand S) abgeleitet. Jeder Eintrag: [Name, Adresse (ohne #) oder null, optional Stufe]; der letzte ist die aktuelle Seite.
// Die vorletzte Ebene ist der Weg zurück (früher der «‹ Ziel»-Link in der Kopfzeile). head() setzt die Leiste automatisch; für eine neue Ansicht braucht es hier nur einen Zweig.
const TR = ['Trainings', '/'];
function trailOf() {
  const p = location.hash.slice(1).split('/').filter(Boolean).map(decodeURIComponent), f = S.flow;
  const tPath = t => { const tm = teamOf(t); return [TR, ...(tm ? [[tm.name, '/team/' + tm.id]] : []), [t.date ? 'Training ' + dm(pd(t.date)) : (t.title || 'Training'), '/t/' + t.id]]; };
  if (p[0] === 'cal') return [TR, ['Kalender']];
  if (p[0] === 'season') return f && f.k === 'season' ? [TR, ['Neues Training', '/new'], ['Tag wählen']] : [TR, ['Saison']];
  if (p[0] === 'new') return [TR, ['Neues Training']];
  if (p[0] === 'plan') return [TR, ['Ganzen Block planen']];
  if (p[0] === 'teams') return [['Teams']];
  if (p[0] === 'team') {
    if (p[1] === 'new') return [['Teams', '/teams'], ['Neue Mannschaft']];
    const tm = teamById(p[1]), b = [['Teams', '/teams'], [tm ? tm.name : 'Mannschaft', '/team/' + p[1]]];
    return p[2] === 'edit' ? [...b, ['Bearbeiten']] : b;
  }
  if (p[0] === 't') {
    const t = getT(p[1]); if (!t) return [TR, ['Nicht gefunden']];
    const x = { run: 'Hallenmodus', view: 'Übersicht', att: 'Anwesenheit', end: 'Abschluss' }[p[2]];
    return x ? [...tPath(t), [x]] : tPath(t);
  }
  if (p[0] === 'lib') {
    const pt = S.pick && getT(S.pick), e = p[1] === 'x' ? libGet(p.slice(2).join('/')) : null;
    if (p[1] === 'new') return [['Bibliothek', '/lib'], ['Eigene Übung erstellen']];
    if (p[1] === 'edit') { const c = DB.custom.find(x => x.id === p[2]); return [['Bibliothek', '/lib'], ...(c ? [[c.name || 'Eigene Übung', '/lib/x/' + encodeURIComponent('c:' + c.id)]] : []), ['Bearbeiten']]; }
    if (p[1] === 'x') return pt ? [...tPath(pt), ['Übung hinzufügen', '/lib'], [e ? e.name : 'Übung']] : [['Bibliothek', '/lib'], [e ? e.name : 'Übung']];
    return pt ? [...tPath(pt), ['Übung hinzufügen']] : [['Bibliothek']];
  }
  if (p[0] === 'rtp') {
    const st = stageById(p[1]), b = st && st.blocks.find(x => x.nr === +p[2]);
    if (f && f.k === 'rtp') return [TR, ['Neues Training', '/new'], ['Schritt ' + (b ? 2 : 1) + ' von 2']];
    return b ? [['RTP', '/rtp'], [st.name, '/rtp', st.id], ['Block ' + b.nr]] : [['RTP']];
  }
  if (p[0] === 'more') return [['Mehr']];
  return [TR, ['Liste']];
}
function crumbBar(run) {   // run: Hallenmodus, nur zur Orientierung (ohne Links, damit nichts versehentlich abbricht)
  const tr = trailOf(), last = tr.length - 1;
  return `<nav class="crumbs${run ? ' run' : ''}" aria-label="Brotkrumen">${tr.map(([l, h, st], i) => (i ? '<i aria-hidden="true">›</i>' : '') + (i < last && h && !run ? `<a href="#${esc(h)}"${st ? ` data-a="crumbStage" data-k="${esc(st)}"` : ''}>${esc(l)}</a>` : `<span${i === last ? ' class="cur" aria-current="page"' : ''}>${esc(l)}</span>`)).join('')}</nav>`;
}
// Kopfzeile: Brotkrumen, Titel, optional Untertitel (HTML, selbst escapen), rechts Aktionen, optional Kontextleiste (Ablauf/Auswahl). Der 2. Parameter (früher Zurück-Ziel) wird nicht mehr gebraucht, die Brotkrumen führen zurück.
const head = (title, back, right = '', sub = '', bar = '') => `<header class="top">${crumbBar()}<div class="trow"><div class="ttl"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</div>${bar}</header>`;
// Kontextleiste: laufender Ablauf (Neues Training) oder Auswahlmodus (Übung für ein Training) – immer sichtbar und abbrechbar
function ctxBar(step) {
  const f = S.flow, pt = S.pick && getT(S.pick);
  if (step === 'plan') return `<div class="ctx"><span class="grow"><b>Ganzen Block planen</b><br>Schritt ${arguments[1]} von 3: ${['Mannschaft und Block wählen', 'Starttermin wählen', 'Vorschau prüfen und anlegen'][arguments[1] - 1]}</span><button class="btn sm" data-a="planCancel">Abbrechen</button><div class="steps">${[1, 2, 3].map(i => `<i class="${i <= arguments[1] ? 'on' : ''}"></i>`).join('')}</div></div>`;
  if (step === 'end') return `<div class="ctx"><span class="grow"><b>Training abschliessen</b><br>Schritt ${arguments[1]} von 2: ${['Anwesenheit', 'Reflexion'][arguments[1] - 1]}</span><button class="btn sm" data-a="endLater">Später</button><div class="steps">${[1, 2].map(i => `<i class="${i <= arguments[1] ? 'on' : ''}"></i>`).join('')}</div></div>`;
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
  const today = iso(new Date()), f = tFilter();
  const ts = DB.trainings.filter(t => !f || (teamOf(t) || {}).id === f).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.start || '').localeCompare(b.start || '') || a.title.localeCompare(b.title, 'de', { numeric: true }));
  S.visible = ts.map(t => t.id);
  const inner = t => `<div class="row"><b>${S.sel ? (S.sel.has(t.id) ? '☑ ' : '☐ ') : ''}${esc(t.title || 'Ohne Titel')}</b><span class="muted">${total(t)}′</span></div>
    <div class="muted small">${metaLine(t, true)}</div>${reflTag(t)}
    <div class="bar">${t.items.map(i => `<i style="flex:${+i.min || 1};background:${(TYPES[i.type] || TYPES.sonst)[1]}"></i>`).join('')}</div>`;
  const card = t => { const cls = `card tcard ${t.date && t.date < today ? 'past' : ''} ${S.sel && S.sel.has(t.id) ? 'picked' : ''}`; return S.sel ? `<div class="${cls}" data-a="selT" data-id="${t.id}">${inner(t)}</div>` : `<a class="${cls}" href="#/t/${t.id}">${inner(t)}</a>`; };
  const groups = new Map(); ts.forEach(t => { const k = grpKey(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  const gtitle = g => { const t = g[0]; return [t.team, t.rtp ? `${t.rtp.stage} · Block ${t.rtp.block}${t.sp ? ' · ' + t.sp : ''}` : 'Einzelne Trainings'].filter(Boolean).join(' · '); };
  return trTop('list', doneBar('/')) + (DB.trainings.length ? `
    ${S.sel ? `<div class="card selbar row"><b>${S.sel.size} ausgewählt</b><button class="btn sm" data-a="selAll">Alle</button><button class="btn sm danger" data-a="delSel" ${S.sel.size ? '' : 'disabled'}>Löschen</button><button class="btn sm" data-a="selMode">Fertig</button></div>` : `<div class="row"><span class="small muted grow">${ts.length} Training${ts.length === 1 ? '' : 's'}</span><button class="btn sm" data-a="selMode">Auswählen</button></div>`}
    ${ts.length ? [...groups].map(([k, g]) => `<div class="row ghead"><h2>${esc(gtitle(g))} <span class="muted small">(${g.length})</span></h2><button class="btn sm" data-a="grp" data-k="${esc(k)}" aria-label="Block-Aktionen">⋯ Block</button></div>${g.map(card).join('')}`).join('') : '<p class="muted center">Für diese Mannschaft gibt es noch keine Trainings.</p>'}` : `
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
  const gx = g.mode === 'own' && g.name ? goalieEx(g.name) : null, u = itemUtp(it, t), ux = u && itemEx(it, t), cx = customOf(it);
  return `<div class="card item ${open ? 'open' : ''}" style="--c:${ty[1]}">
    <div class="row"><button class="tog" data-a="tog" data-id="${it.id}" aria-label="Details">${open ? '▾' : '▸'}</button>
      <input class="name" data-b="i:${it.id}:name" value="${esc(it.name)}" placeholder="${esc(ty[0])}">
      <input class="min" type="number" inputmode="numeric" min="0" data-b="i:${it.id}:min" value="${esc(it.min)}" aria-label="Minuten"><span class="muted">′</span></div>
    ${open ? `<div class="body">
      ${athHtml(it.ath)}${ux ? `<div class="expl open"><div class="exb">${exBody(ux)}</div>${exLinks(u, ux)}<p class="small muted nomargin">Quelle: swiss unihockey, Unihockey-Trainingsplaner</p></div>` : explain(u, null, 'e:' + it.id)}
      ${reflHint(reflKey(it))}
      <label>Typ<select data-b="i:${it.id}:type" data-r="1">${Object.entries(TYPES).map(([k, v]) => opt(k, v[0], it.type)).join('')}</select></label>
      ${cx ? `<div class="cxbox"><div class="small muted">Eigene Übung – Änderungen am Text gelten für diese Übung in allen Trainings, auch in vergangenen.</div><label>Beschreibung<textarea data-b="x:${it.id}:desc" rows="4">${esc(cx.desc || '')}</textarea></label><label>Keypoints<textarea data-b="x:${it.id}:coach" rows="2">${esc(cx.coach || '')}</textarea></label><label>Coachingfragen<textarea data-b="x:${it.id}:fragen" rows="2">${esc(cx.fragen || '')}</textarea></label><details ${cx.leichter || cx.schwerer || cx.vari ? 'open' : ''}><summary>Rad der Variation</summary><label>Erleichtern<textarea data-b="x:${it.id}:leichter" rows="2">${esc(cx.leichter || '')}</textarea></label><label>Erschweren<textarea data-b="x:${it.id}:schwerer" rows="2">${esc(cx.schwerer || '')}</textarea></label><label>Variieren<textarea data-b="x:${it.id}:vari" rows="2">${esc(cx.vari || '')}</textarea></label></details></div>` : `<label>${ux ? 'Eigene Notizen zur Übung' : 'Beschreibung / Organisation'}<textarea data-b="i:${it.id}:desc" rows="${ux ? 2 : isSw(it) ? 14 : 3}" placeholder="${ux ? 'Optional: eigene Anpassungen, Feldgrösse, Gruppen …' : 'Ablauf, Feldgrösse, Material …'}">${esc(it.desc)}</textarea></label>${isSw(it) && SWD ? `<div class="row wrap"><button class="btn sm" data-a="swNew" data-id="${it.id}">Andere Auswahl</button><span class="small muted grow">Wählt die Übungen des Tages neu aus und ersetzt die Beschreibung.</span></div>` : ''}`}
      <label>🎒 Material<input data-b="i:${it.id}:mat" value="${esc(itemMatTxt(it, t))}" placeholder="z.B. Hütchen, Bälle, Leibchen (mit Komma trennen)"></label>
      ${cx ? '' : `<label>${ux ? 'Eigene Keypoints / Coachingfragen' : 'Keypoints / Coachingfragen'}<textarea data-b="i:${it.id}:coach" rows="2" placeholder="${ux ? 'Optional: zusätzlich zu den Keypoints oben' : ''}">${esc(it.coach)}</textarea></label>`}
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
  return head('Training', '/', `<a class="btn pri" href="#/t/${t.id}/run">▶ Start</a>`, esc(t.title || 'Ohne Titel')) + doneBar('/t/' + t.id) + reflPrevCard(t) + rtpSummary(t, 'edit') + `<div id="mat">${matCard(t, 'edit')}</div>${attLink(t)}${reflLink(t)}` + `
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

// ---------- Material (Kopfzeile des Trainings) ----------
// Quellen (Vorrang in dieser Reihenfolge): Angabe des Trainers, Merkzettel der Übung, Daten (Goalie/eigene Übung), automatisch aus dem UTP-Text erkannt.
// Quellen: Feld it.mat je Übung (vom Trainer, wird pro Bibliotheks-Übung in DB.notes[key].mat gemerkt und bei neuen Trainings vorbelegt), Material der Goalie-Übungen und eigener Übungen.
const NOMAT = /^(keine?s?|kein material|[-–])$/i;
const matParts = s => String(s || '').split(/[,;\n]+/).map(x => x.trim()).filter(x => x && !NOMAT.test(x));
const matKey = x => norm(x.replace(/^\d+(?:\s*[–-]\s*\d+)?\s*(?:x\s*)?/i, '')).replace(/(en|e|n)$/, '');   // Mengen vorne und Mehrzahl-Endung ignorieren: «10 Bälle» = «Ball», «Tore» = «Tor»
const matNoteKey = it => it.lib || (it.type !== 'athletik' && it.name && libGet(norm(it.name)) ? norm(it.name) : '');
function itemMatTxt(it, t) {   // eigene Angabe hat Vorrang; sonst Merkzettel der Übung bzw. Daten der Übung
  if (it.mat !== undefined) return it.mat;
  const k = matNoteKey(it), e = it.lib && libGet(it.lib);
  return (k && note(k).mat) || (e && e.mat) || ((t && itemEx(it, t)) || {}).m || '';   // zuletzt: aus dem UTP-Text erkannt (build-utp.js)
}
function trainingMat(t) {
  const m = new Map(), add = x => { const k = matKey(x); if (!k) return; const old = m.get(k); if (!old || (/^\d/.test(x) && !/^\d/.test(old))) m.set(k, x); };
  t.items.forEach(it => { matParts(itemMatTxt(it, t)).forEach(add); const g = it.g, x = g && g.mode === 'own' && g.name ? goalieEx(g.name) : null; if (x) matParts(x.mat).forEach(add); });
  return [...m.values()];
}
function matCard(t, mode) {
  const l = trainingMat(t);
  if (!l.length) return mode === 'edit' ? '<p class="small muted matnone">🎒 Material: noch nichts eingetragen – im aufgeklappten Block unter «Material» ergänzen.</p>' : '';
  return `<div class="card matcard"><b>🎒 Material</b> <span class="small">${l.map(esc).join(' · ')}</span></div>`;
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
  ${rtpSummary(t)}${matCard(t)}
  ${t.items.map(it => { const ty = TYPES[it.type] || TYPES.sonst, from = m; m += +it.min || 0; return `<div class="card item" style="--c:${ty[1]}"><div class="row"><b>${esc(it.name || ty[0])}</b><span class="muted nowrap">${from}′–${m}′</span></div>
    <div class="small muted">${esc(ty[0])} · ${esc(it.min)} Min.</div>${athHtml(it.ath)}${explain(itemUtp(it, t), itemEx(it, t), 'v:' + it.id)}${it.desc ? `<p>${nl2br(it.desc)}</p>` : ''}${it.coach ? `<p class="small"><b>Coaching:</b> ${nl2br(it.coach)}</p>` : ''}${goalieHtml(it.g, true)}</div>`; }).join('')}${reflCompact(t)}${reflLink(t)}`;
}

// ---------- Ansicht: Hallenmodus ----------
let wake = null;
const mmss = s => `${s < 0 ? '+' : ''}${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s)) % 60).padStart(2, '0')}`;
function runSet(t, i) { const r = S.run; r.i = Math.max(0, Math.min(t.items.length - 1, i)); r.left = (+t.items[r.i].min || 0) * 60; r.last = Date.now(); r.buzz = false; }
// Stand des Hallenmodus merken: kommt man z. B. vom UTP-Link zurück und die App lädt neu, geht es bei derselben Übung weiter (Timer pausiert).
const RUNKEY = 'unihockey-planer.run';
function runKeep() { const r = S.run; try { if (r) localStorage.setItem(RUNKEY, JSON.stringify({ id: r.id, i: r.i, left: Math.round(r.left), ts: Date.now() })); else localStorage.removeItem(RUNKEY); } catch (e) { /* Speicher nicht verfügbar */ } }
function runLoad(t) { try { const m = JSON.parse(localStorage.getItem(RUNKEY) || 'null'); return m && m.id === t.id && Date.now() - m.ts < 4 * 3600e3 && m.i >= 0 && m.i < t.items.length ? m : null; } catch (e) { return null; } }
addEventListener('pagehide', runKeep); document.addEventListener('visibilitychange', () => { if (document.hidden && S.run) runKeep(); });
function viewRun(t) {
  if (!t.items.length) return head('Hallenmodus', `/t/${t.id}`) + '<p class="muted center">Dieses Training hat noch keine Blöcke.</p>';
  if (!S.run || S.run.id !== t.id) { S.run = { id: t.id, i: 0, on: false }; runSet(t, 0); const m = runLoad(t); if (m) { runSet(t, m.i); S.run.left = m.left; S.run.started = true; } }
  const r = S.run, it = t.items[r.i], ty = TYPES[it.type] || TYPES.sonst, nx = t.items[r.i + 1];
  return `<div class="run" style="--c:${ty[1]}">${crumbBar(true)}<div class="row runtop"><a class="btn sm" href="#/t/${t.id}" data-a="runExit">✕ Beenden</a><span class="grow center">${r.i + 1} / ${t.items.length}</span><span class="muted">${esc(ty[0])}</span></div>
    <div class="dots">${t.items.map((x, i) => `<i data-a="runGo" data-i="${i}" class="${i === r.i ? 'cur' : i < r.i ? 'done' : ''}" style="flex:${+x.min || 1}"></i>`).join('')}</div>
    ${r.i === 0 && !r.started ? reflPrevCard(t) + rtpSummary(t) + matCard(t) + attLink(t) : ''}
    <h1 class="runname">${esc(it.name || ty[0])}</h1>
    <div class="clock ${r.left < 0 ? 'over' : ''}" id="clock">${mmss(r.left)}</div>
    <div class="row center"><button class="btn pri big" data-a="runTog">${r.on ? '❚❚ Pause' : '▶ Start'}</button><button class="btn" data-a="runReset">↺</button></div>
    ${it.ath ? `<div class="card">${athHtml(it.ath)}</div>` : ''}${itemUtp(it, t) ? `<div class="card">${explain(itemUtp(it, t), itemEx(it, t), 'run:' + it.id)}</div>` : ''}${it.desc ? `<div class="card"><p>${nl2br(it.desc)}</p></div>` : ''}${it.coach ? `<div class="card"><b>Coaching</b><p>${nl2br(it.coach)}</p></div>` : ''}
    ${goalieHtml(it.g, true)}
    ${nx ? `<p class="muted center small">Als Nächstes: <b>${esc(nx.name || (TYPES[nx.type] || TYPES.sonst)[0])}</b> (${esc(nx.min)}′)</p>` : '<p class="muted center small">Letzter Block</p>'}
    <div class="row runnav"><button class="btn big" data-a="runGo" data-i="${r.i - 1}" ${r.i ? '' : 'disabled'}>‹ Zurück</button>${nx ? `<button class="btn pri big" data-a="runGo" data-i="${r.i + 1}">Weiter ›</button>` : '<button class="btn pri big runend" data-a="runEnd">Training beenden ✓</button>'}</div></div>`;
}
setInterval(() => {
  const r = S.run; if (!r) return; const now = Date.now();
  if (r.on) { r.left -= (now - r.last) / 1000; if (r.left <= 0 && !r.buzz) { r.buzz = true; navigator.vibrate && navigator.vibrate([300, 150, 300]); } }
  r.last = now; const el = $('#clock'); if (el) { el.textContent = mmss(r.left); el.classList.toggle('over', r.left < 0); }
}, 500);
async function wakeLock(on) { try { if (on && navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); else if (wake) { wake.release(); wake = null; } } catch (e) { /* nicht unterstützt */ } }

// ---------- Ansicht: Bibliothek ----------
const KINDS = [['', 'Alle'], ['gp', 'Good Practice'], ['skills', 'Skills'], ['spiel', 'Spiel'], ['warmup', 'Warm-up'], ['athletik', 'Athletik'], ['goalie', '🧤 Goalie'], ['custom', 'Eigene']];
const EXN = new Map();
function exNorm(e) {   // normalisierter UTP-Text einer Übung (einmal berechnet) für die Suche
  if (e.src !== 'rtp') return '';
  let v = EXN.get(e.key); if (v === undefined) { const x = utpEx(e.name, [...e.stages][0]); v = x ? norm(x.s.map(a => a[2]).join(' ')) : ''; EXN.set(e.key, v); }
  return v;
}
function libFiltered() {
  const f = S.lib, q = norm(f.q);
  return lib().filter(e => (!f.kind || (f.kind === 'custom' ? e.src === 'custom' : e.kind === f.kind)) && (!f.stage || e.stages.has(f.stage) || !e.stages.size) && (!f.sp || e.sps.has(f.sp)) && (!q || norm(e.name).includes(q) || [...e.sps].some(s => norm(s).includes(q)) || (q.length > 2 && exNorm(e).includes(q))));
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
  const ty = TYPES[e.kind] || TYPES.sonst, pt = S.pick && getT(S.pick), nt = note(e.key), lu = e.src === 'rtp' ? utpUrl(e.name, libStage(e)) : '', lx = e.src === 'rtp' ? utpEx(e.name, libStage(e)) : null;
  let body = '';
  if (e.src === 'goalie') body = `<div class="card"><p>${esc(e.desc)}</p><b>Coaching-Punkte</b><ul>${e.coach.map(c => `<li>${esc(c)}</li>`).join('')}</ul>${e.vari ? `<p><b>Variationen:</b> ${esc(e.vari)}</p>` : ''}<p class="small muted">Material: ${esc(e.mat)} · ca. ${e.min} Min. · ${esc(G.cats[e.cat])}</p></div><p class="small muted">${esc(G.note)}</p>`;
  else if (e.src === 'custom') body = `<div class="card">${e.desc ? `<p>${nl2br(e.desc)}</p>` : '<p class="muted">Keine Beschreibung.</p>'}${[['mat', 'Material'], ['coach', 'Keypoints'], ['fragen', 'Coachingfragen'], ['leichter', 'Erleichtern'], ['schwerer', 'Erschweren'], ['vari', 'Variieren']].map(([k, l]) => e[k] ? `<p><b>${l}:</b><br>${nl2br(e[k])}</p>` : '').join('')}${e.goalie ? `<div class="gbox"><b>🧤 Goalie</b><p>${nl2br(e.goalie)}</p></div>` : ''}</div>
    <div class="row"><a class="btn" href="#/lib/edit/${e.id}">Bearbeiten</a><button class="btn danger" data-a="delC" data-id="${e.id}">Löschen</button></div>`;
  else body = `${lu ? (lx ? `<div class="card"><b>Erklärung</b><div class="exb">${exBody(lx)}</div>${exLinks(lu, lx)}<p class="small muted nomargin">Quelle: swiss unihockey, Unihockey-Trainingsplaner</p></div>` : `<div class="card">${utpBtn(lu, 'block')}<p class="small muted nomargin">Offizielle Beschreibung, Skizze und Video bei swiss unihockey. Öffnet in einem neuen Tab; braucht Internet.</p></div>`) : ''}${e.params ? `<div class="card"><b>Vorgaben aus dem RTP</b>${e.params.map(p => `<div class="small muted" style="margin-top:10px">${esc(p.st)}${p.faktor ? ' · ' + esc(p.faktor) : ''}</div>${athHtml(athData(p))}`).join('')}</div>` : ''}${norm(e.name) === 'swiss way warm up' && SWD ? `<div class="card"><b>Auswahl pro Training</b><p class="small">Beim Hinzufügen steht in der Beschreibung, welche Übungen des Swiss Way Warm-ups an diesem Tag dran sind (Teil 1 Sensorik, Teil 2 Bewegungsvorbereitung, Teil 3 Bewegungskontrolle passend zum Athletik-Schwerpunkt). Jedes Training bekommt eine andere Auswahl; im Training gibt es «Andere Auswahl».</p></div>` : ''}
    <div class="card"><label>🎒 Material (wird beim Hinzufügen ins Training übernommen)<input data-b="n:${esc(e.key)}:mat" value="${esc(nt.mat)}" placeholder="z.B. Hütchen, Bälle, Leibchen"></label>
    <label>Eigene Beschreibung / Notizen<textarea data-b="n:${esc(e.key)}:desc" rows="4" placeholder="Ablauf, Skizze in Worten, Erfahrungen …">${esc(nt.desc)}</textarea></label>
    ${e.kind !== 'athletik' ? `<label>🧤 Goalie-Hinweis zu dieser Übung<textarea data-b="n:${esc(e.key)}:goalie" rows="2" placeholder="${esc(goalieFocus(e.kind, [...e.sps][0], [...e.efs][0]))}">${esc(nt.goalie)}</textarea></label>` : ''}
    ${lu ? '<p class="small muted">Deine Notizen werden beim Hinzufügen ins Training übernommen.</p></div>' : `<p class="small muted">Die offizielle Beschreibung mit Skizze/Video findest du im Unihockey-Trainingsplaner (UTP): Bibliothek → nach dem Namen suchen. Deine Notizen werden beim Hinzufügen ins Training übernommen.</p>
    <button class="btn" data-a="utp" data-n="${esc(e.name)}">Name kopieren &amp; UTP öffnen</button></div>`}
    ${e.uses.size ? `<div class="card"><b>Vorkommen im RTP</b>${usesHtml(e)}</div>` : ''}`;
  return head(pt ? 'Übung ansehen' : 'Übung', '/lib', '', pt ? `für: <b>${esc(pt.title)}</b>` : '', ctxBar()) + `<div class="card item" style="--c:${ty[1]}"><h2 class="nomargin">${esc(e.name)}</h2>
    <div class="chips">${chip(ty[0], ty[1])}${[...e.stages].map(s => chip(s)).join('')}${[...(e.faktoren || [])].map(s => chip(s)).join('')}</div>
    ${[...e.sps].length && e.src === 'rtp' ? `<p class="small">Schwerpunkte: ${esc([...e.sps].join(', '))}</p>` : ''}${reflHint(e.key)}</div>${body}
    <button class="btn pri block" data-a="addLib" data-k="${esc(e.key)}">${pt ? `Zu «${esc(pt.title)}» hinzufügen` : 'Zu einem Training hinzufügen'}</button>`;
}
function viewLibForm(id) {
  const c = id ? DB.custom.find(x => x.id === id) : null;
  S.form = c ? { ...c, stages: [...(c.stages || [])] } : { id: null, name: '', kind: 'gp', stages: [DB.stage], min: 15, mat: '', desc: '', coach: '', fragen: '', leichter: '', schwerer: '', vari: '', goalie: '' };
  const f = S.form;
  return head(c ? 'Übung bearbeiten' : 'Eigene Übung erstellen', '/lib', '', c ? esc(c.name) : 'Wird in der Bibliothek gespeichert', ctxBar()) + `<div class="card">
    <label>Name<input data-b="c:name" value="${esc(f.name)}"></label>
    <div class="grid2"><label>Typ<select data-b="c:kind">${Object.entries(TYPES).map(([k, v]) => opt(k, v[0], f.kind)).join('')}</select></label><label>Dauer (Min.)<input type="number" inputmode="numeric" data-b="c:min" value="${esc(f.min)}"></label></div>
    <div class="chips">${R.stages.map(s => `<button class="chip ${f.stages.includes(s.id) ? 'sel' : ''}" data-a="cStage" data-k="${s.id}">${s.id}</button>`).join('')}</div>
    <label>🎒 Material<input data-b="c:mat" value="${esc(f.mat || '')}" placeholder="z.B. Hütchen, Bälle, Leibchen"></label>
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
  return head('Rahmentrainingsplan', null, '', S.flow ? 'Neues Training · Stufe und Block wählen' : 'Stufe wählen, dann Block ansehen', ctxBar('block')) + `<div class="chips">${R.stages.map(s => `<button class="chip ${s.id === st.id ? 'sel' : ''}" data-a="stage" data-k="${s.id}">${s.id}</button>`).join('')}</div>
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
  const trains = `<h2>Trainings</h2><button class="btn pri block" data-a="planOpen" data-s="${st.id}" data-b2="${b.nr}" data-team="${esc((S.flow && S.flow.team) || '')}" data-auto="1">Ganzen Block mit Datum planen</button>${weeks}`;
  const ath = b.athletik ? `<h2>Athletik</h2><div class="card">${b.athletik.ziele.map(z => `<p class="small">${z.faktor ? `<b>${esc(z.faktor)}:</b> ` : '<b>Ziel:</b> '}${esc(z.text)}</p>`).join('')}</div>
    ${b.athletik.sessions.map(s => `<details class="card"><summary><b>${esc(s.faktor)}</b> <span class="muted small">Woche ${esc(s.woche)} · Training ${esc(s.training)}</span></summary>
      ${s.items.map(it => `<div class="slot"><b>${it.form ? `<a href="#/lib/x/${encodeURIComponent(norm(it.form))}">${esc(it.form)}</a>` : 'Übung'}</b><div class="small">${esc([it.whg, it.serien && it.serien + ' Serien', it.gewicht, it.rhythmus].filter(Boolean).join(' · '))}</div>${it.keypoints ? `<div class="small muted">${esc(it.keypoints)}</div>` : ''}</div>`).join('')}</details>`).join('')}` : '';
  return head(`${st.id} · Block ${b.nr}`, '/rtp', '', S.flow ? 'Neues Training · Training wählen' : st.name, ctxBar('train')) + `<p class="muted small center">${esc(b.monat || b.phase)}${b.weeks.length ? ` · Woche ${b.weeks[0].w}–${b.weeks[b.weeks.length - 1].w}` : ''}</p>
    ${S.flow ? trains : ''}${part(b.main, 'Hauptschwerpunkt')}${part(b.sec, 'Nebenschwerpunkt')}
    ${ev.length || b.regel.length ? `<div class="card">${ev.length ? `<b>Termine / Events</b><div class="chips">${ev.map(e => chip(e)).join('')}</div>` : ''}${b.regel.length ? `<p class="small"><b>Regel-Fokus:</b> ${esc(b.regel.join(', '))}</p>` : ''}</div>` : ''}
    ${S.flow ? '' : trains}${ath}`;
}

// ---------- Ansicht: Saison ----------
function seasonCfg() {   // Konfiguration der Mannschaft des gemeinsamen Filters S.team (leer: allgemeine Konfiguration)
  const tm = teamById(S.team); if (!tm) S.team = '';
  return seasonCfgFor(tm);
}
// Saison: beginnt am 1. Mai. Saisonjahr = Jahr dieses 1. Mai; Januar bis April gehören zur Saison des Vorjahres (2026/27 läuft vom 1.5.2026 bis 30.4.2027).
// Ohne Auswahl gilt automatisch die laufende Saison; S.sYear wählt für diese Sitzung eine andere (nicht gespeichert, damit es nie veraltet).
// Ein eigenes Startdatum steht pro Saison in s.starts[Jahr]. s.start wird bei jedem Aufruf neu berechnet; s.startOwn ist die Vorgängerform von s.starts.
const seasonYearOf = d => d.getMonth() >= 4 ? d.getFullYear() : d.getFullYear() - 1;
const seasonYearNow = () => seasonYearOf(new Date());
const seasonYear = () => +S.sYear || seasonYearNow();
const seasonDefault = (y = seasonYear()) => y + '-05-01';
const seasonLabel = y => y + '/' + String(y + 1).slice(2);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function seasonStart(s, y = seasonYear()) {
  if (ISO.test(s.startOwn || '')) { const oy = seasonYearOf(pd(s.startOwn)); s.starts = { [oy]: s.startOwn, ...(s.starts || {}) }; delete s.startOwn; save(); }
  const own = (s.starts || {})[y]; return ISO.test(own || '') ? own : seasonDefault(y);
}
function seasonCfgFor(tm) {
  if (tm && !DB.seasons[tm.id]) DB.seasons[tm.id] = { stage: tm.stage, days: [...(tm.days || [2, 4])], time: tm.time || '', hol: [...(DB.season.hol || [])], start: DB.season.start || '' };
  const s = tm ? DB.seasons[tm.id] : DB.season;
  if (tm) s.days = [...new Set(teamSessions(tm).map(x => x.wd))];   // Trainingstage kommen aus den Einheiten der Mannschaft (alte Felder bleiben als Spiegel)
  s.start = seasonStart(s);
  s.stage = s.stage || DB.stage; s.days = s.days || [2, 4]; s.hol = s.hol || [];
  return s;
}
// Einheiten, an denen die Saison plant: die der Mannschaft, sonst die Tage/Startzeit der allgemeinen Konfiguration
const planSessions = (s, tm) => tm ? teamSessions(tm, true) : [...s.days].sort((a, b) => wdOrd(a) - wdOrd(b)).map(wd => ({ id: 'd' + wd, wd, time: s.time || '', min: 0, ort: '' }));
function seasonWeeks(s = seasonCfg(), tm = teamById(S.team)) {
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
// Saison-Ansicht: dieselben Trainings wie Liste und Kalender, nach Wochen geordnet. Freie Einheiten erscheinen als «+»-Chips (mehrere Einheiten am selben Tag werden getrennt geführt).
function missChips(r, byDate, st) {
  const dates = [...new Set(r.days.map(d => d.date))];
  return dates.map(date => {
    const ds = r.days.filter(d => d.date === date), m = matchDay(byDate[date] || [], ds.map(d => d.sess));
    return ds.map((d, i) => m.hit[i] ? '' : `<button class="chip" data-a="sNew" data-s="${st.id}" data-b2="${r.b.nr}" data-w="${r.w ? r.w.w : 0}" data-i="${d.idx}" data-d="${date}" data-x="${esc(d.sess.id)}">+ ${WD[d.wd]} ${dm(pd(date))}${d.sess.time ? ' · ' + d.sess.time : ''}</button>`).join('');
  }).join('');
}
const wkSort = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.start || '').localeCompare(b.start || '');
function wkLine(t, showTeam) {   // ein Training in der Wochenkarte
  const tm = showTeam && teamOf(t);
  return `<a class="wkt ${t.date && t.date < iso(new Date()) ? 'past' : ''}" href="#/t/${t.id}"><span class="wd">${t.date ? WD[pd(t.date).getDay()] + ' ' + dm(pd(t.date)) : 'ohne Datum'}</span><span class="wt"><b>${tm ? teamDot(tm) : ''}${esc(t.title || 'Ohne Titel')}</b><span class="small muted">${esc([tm && tm.name, t.start && `${t.start}–${endTime(t)}`, t.ort].filter(Boolean).join(' · ') || 'ohne Uhrzeit')}</span></span><span class="muted">${total(t)}′</span></a>`;
}
function viewSeason() {
  const tf = tFilter(), tm = teamById(tf), flow = !!(S.flow && S.flow.k === 'season'), plan = !!tm || !DB.teams.length;   // geplant wird für eine Mannschaft (oder ohne Mannschaften mit der allgemeinen Konfiguration)
  const y = seasonYear(), winFrom = seasonDefault(y), winTo = (y + 1) + '-04-30', today = iso(monday(new Date())), nowChip = chip('diese Woche');
  const all = DB.trainings.filter(t => !tm || (teamOf(t) || {}).id === tm.id), inWin = t => t.date && t.date >= winFrom && t.date <= winTo;
  const byDate = {}, byWeek = {};
  all.forEach(t => { if (!t.date) return; (byDate[t.date] = byDate[t.date] || []).push(t); const k = iso(monday(pd(t.date))); (byWeek[k] = byWeek[k] || []).push(t); });
  const lines = (k, showTeam) => (byWeek[k] || []).sort(wkSort).map(t => wkLine(t, showTeam)).join('');
  const yearSel = `<label>Saison<select data-b="s:year" data-r="1">${[...new Set([seasonYearNow() - 1, seasonYearNow(), seasonYearNow() + 1, seasonYear()])].sort().map(v => opt(String(v), seasonLabel(v) + (v === seasonYearNow() ? ' (aktuell)' : ''), String(seasonYear()))).join('')}</select></label>`;
  const restCard = rest => rest.length ? `<h2>Weitere Trainings (${rest.length})</h2><div class="card">${rest.sort(wkSort).map(t => wkLine(t, !tm)).join('')}</div><p class="small muted">Diese Trainings liegen ausserhalb der Wochen oben oder haben kein Datum.</p>` : '';
  if (!plan) {   // mehrere Mannschaften, keine gewählt: alle Trainings der Saison nach Kalenderwochen, ohne RTP-Beschriftung (die hängt an der Stufe der Mannschaft)
    const keys = [...new Set(all.filter(inWin).map(t => iso(monday(pd(t.date)))))].sort();
    return trTop('season') + `<div class="card"><b>Saison ${seasonLabel(y)}</b> <span class="muted small">· ${all.filter(inWin).length} Trainings</span>${yearSel}<p class="small muted nomargin">Wähle oben eine Mannschaft, um den RTP-Wochenplan mit Ferienwochen zu sehen und zu planen.</p></div>
    ${keys.map(k => `<div class="card week ${k === today ? 'now' : ''}" id="w${k}"><div class="row"><span><b>${dm(pd(k))}–${dm(addDays(pd(k), 6))}</b> ${k === today ? nowChip : ''}</span></div>${lines(k, true)}</div>`).join('') || '<p class="muted center">In dieser Saison gibt es noch keine Trainings.</p>'}
    ${restCard(all.filter(t => !t.date))}`;
  }
  const s = seasonCfg(), st = stageById(s.stage), rows = seasonWeeks(s, tm), rowKeys = new Set(rows.map(r => r.key));
  const rest = all.filter(t => !t.date || (inWin(t) && !rowKeys.has(iso(monday(pd(t.date))))));
  if (!S.spSeen) S.spSeen = {}; if (!s.set && !S.spSeen[tf || '-']) { S.spSeen[tf || '-'] = 1; S.tsec.add('sp'); }   // noch nie eingestellt: Planungsbereich einmal offen zeigen
  const times = tm ? teamSessions(tm).map(x => WD[x.wd] + (x.time ? ' ' + x.time : '')).join(', ') || 'keine Trainingszeit' : s.days.map(d => WD[d]).join(', ');
  const panel = `<details class="card tsec" data-k="sp" ${S.tsec.has('sp') ? 'open' : ''}><summary><b>Saison planen</b> <span class="muted small">${esc(st.name)} · ab ${fmtDate(s.start)} · ${esc(times)}</span></summary>
    <div class="grid2"><label>Stufe<select data-b="s:stage" data-r="1">${stageOpts(s.stage)}</select></label>${yearSel}</div>
    <div class="grid2"><label>Saisonstart${(s.starts || {})[seasonYear()] ? ' (eigenes Datum)' : ' (Vorgabe 1. Mai)'}<input type="date" data-b="s:startOwn" data-r="1" value="${esc(s.start)}"></label>${tm ? '<span></span>' : `<label>Startzeit<input type="time" data-b="s:time" value="${esc(s.time || '')}"></label>`}</div>
    ${tm ? `<div class="small muted">Trainingszeiten von ${esc(tm.name)}</div><p class="nomargin">${teamSessions(tm).map(x => esc(sessSummary(tm, x))).join('<br>') || 'Noch keine Trainingszeit.'}</p><p class="small"><a href="#/team/${tm.id}/edit">Trainingszeiten bearbeiten</a></p>` : `<div class="small muted">Trainingstage</div><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip ${s.days.includes(d) ? 'sel' : ''}" data-a="sDay" data-k="${d}">${WD[d]}</button>`).join('')}</div>`}
    <p class="small muted">Der RTP geht von ${st.perWeek} Training(s) pro Woche à ${st.minutes} Min. aus. Markiere Ferienwochen unten mit «Ferien» – ${st.slots ? 'die RTP-Wochen verschieben sich dann automatisch.' : 'in diesen Wochen werden keine Trainings geplant.'} Freie Einheiten legst du mit «+» an.</p>
    ${flow ? '' : `<button class="btn block" data-a="planOpen" data-team="${esc(tf)}" data-s="${esc(s.stage)}" data-mode="season">Ganzen Block planen</button>`}</details>`;
  return trTop('season') + `<p class="small muted nomargin">Saison ${seasonLabel(y)} · ${all.filter(inWin).length} Trainings${tm ? ' · ' + esc(tm.name) : ''}</p>${panel}
  ${rows.map(r => `<div class="card week ${r.key === today ? 'now' : ''} ${r.hol ? 'hol' : ''}" ${r.b ? `style="--c:${efColor(r.b.main.ef)}"` : ''} id="w${r.key}">
    <div class="row"><span><b>${dm(r.mon)}–${dm(addDays(r.mon, 6))}</b> ${r.key === today ? nowChip : ''}</span><button class="btn sm ${r.hol ? 'pri' : ''}" data-a="sHol" data-k="${r.key}">${r.hol ? 'Ferien ✓' : 'Ferien'}</button></div>
    ${r.hol ? '<div class="small muted">Ferienwoche</div>' : r.b ? `<div class="small"><a href="#/rtp/${st.id}/${r.b.nr}">Block ${r.b.nr}${r.w ? ` · RTP-Woche ${r.w.w}` : ''}</a> · ${esc(r.b.main.sp || r.b.main.ef)}</div>
      ${r.first ? `<button class="btn sm" data-a="sBlock" data-k="${r.b.nr}">Ganzen Block ${r.b.nr} planen</button>` : ''}${r.ev.length ? `<div class="chips">${r.ev.map(e => chip('📌 ' + e)).join('')}</div>` : ''}` : '<div class="small muted">Saisonpause / frei</div>'}
    ${lines(r.key, false)}
    ${!r.hol && r.b ? `<div class="chips">${missChips(r, byDate, st)}</div>` : ''}</div>`).join('')}
  ${restCard(rest)}`;
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
// Vergleich Einheiten pro Woche (Mannschaft bzw. gewählte Tage) mit den RTP-Trainings pro Woche.
// N = Länge des Blocks in RTP-Wochen (Stufen mit Mikroplanung: seine Wochen; sonst die Wochen des Blocks im Saisonplan, sonst 4), M = Anzahl Trainings (sonst 12).
// exact: gleich viele Einheiten wie RTP-Trainings pro Woche – dann ist «Länge» und «Anzahl» dasselbe.
function planFit(P, st, b, tm) {
  const have = tm ? teamSessions(tm, true).length : (P.mode === 'own' ? (P.days || []).length : seasonCfgFor(null).days.length);
  const rtp = st.slots ? Math.max(0, ...b.weeks.map(w => w.trainings.length)) : st.perWeek, info = st.slots ? null : planInfo(P);
  const N = st.slots ? b.weeks.length : (info ? info.rows.length : 4), M = st.slots ? b.weeks.reduce((a, w) => a + w.trainings.length, 0) : 12;
  const exact = have === rtp && (!st.slots || b.weeks.every(w => w.trainings.length === rtp));
  return { have, rtp, N, M, exact, less: have > 0 && have < rtp, more: have > rtp, slots: !!st.slots };
}
const spanWeeks = (a, z) => Math.round((monday(pd(z)) - monday(pd(a))) / 6048e5) + 1;
// Zwei Arten, den Block zu planen (P.keep): 'len' = ursprüngliche Länge behalten (N RTP-Wochen = N×7 Tage ab Starttermin; jeder 7-Tage-Abschnitt k bekommt die Trainings der RTP-Woche k),
// 'cnt' = ursprüngliche Anzahl Trainings behalten (alle Trainings der Reihe nach auf die Einheiten). P.mode: 'own' = Block jetzt planen (ab Starttermin), 'season' = nach Saisonplan.
function planCompute(P) {
  const tm = teamById(P.team), st = stageById(P.stage), b = st && st.blocks.find(x => x.nr === +P.block), c = { tm, st, b, items: [], skipped: [], hol: 0, holSess: 0, range: null, total: 0, noSess: false, dropped: 0, free: 0, fit: null };
  if (!b) return c;
  const cfg = seasonCfgFor(tm), ts = DB.trainings.filter(t => t.date && (!tm || (teamOf(t) || {}).id === tm.id)), day = date => ts.filter(t => t.date === date);
  const list = st.slots ? b.weeks.flatMap(w => w.trainings.map((_, i) => ({ w, idx: i }))) : Array.from({ length: 12 }, (_, i) => ({ w: null, idx: i }));
  c.total = list.length;
  const fit = c.fit = planFit(P, st, b, tm);
  let start = P.start;
  if (P.mode === 'season') {
    const info = planInfo(P); if (!info) return c;
    if (P.keep === 'cnt' && fit.less) start = info.first; else {
    info.rows.forEach(r => [...new Set(r.days.map(d => d.date))].forEach(date => {
      const ds = r.days.filter(d => d.date === date), m = matchDay(day(date), ds.map(d => d.sess));
      ds.forEach((d, i) => m.hit[i] ? c.skipped.push({ date, sess: d.sess }) : c.items.push({ date, sess: d.sess, w: r.w, idx: d.idx }));
    }));
    return c; }
  }
  if (!start) return c;
  const sess = tm ? teamSessions(tm, true) : (P.days || []).map(wd => ({ id: 'd' + wd, wd, time: P.time || '', min: 0, ort: '' }));
  if (!sess.length) { c.noSess = true; return c; }
  const hol = new Set(cfg.hol || []), seen = new Set();
  if (P.mode === 'own' && (P.keep !== 'cnt' || fit.exact)) {   // Länge behalten: N RTP-Wochen = N×7 Tage ab Starttag (eingeschlossen), Abschnitt k (je 7 Tage) bekommt RTP-Woche k; Tage in Ferienwochen entfallen, der Block wird nicht länger
    const from = pd(start); let cnt = 0;
    c.range = { from: start, to: iso(addDays(from, fit.N * 7 - 1)), days: fit.N * 7 };
    for (let k = 0; k < fit.N; k++) {
      const free = [], wk = st.slots ? b.weeks[k] : null;
      for (let o = 0; o < 7; o++) {
        const d = addDays(from, k * 7 + o);
        const ds = sess.filter(x => x.wd === d.getDay()).sort((a, b2) => a.time.localeCompare(b2.time)); if (!ds.length) continue;
        const date = iso(d);
        if (hol.has(iso(monday(d)))) { ds.forEach(se => free.push({ date, sess: se, hol: true })); continue; }
        const m = matchDay(day(date), ds);
        ds.forEach((se, i) => m.hit[i] ? c.skipped.push({ date, sess: se }) : free.push({ date, sess: se }));
      }
      free.forEach((x, i) => {
        if (x.hol) { c.holSess++; return; }
        if (!wk) c.items.push({ date: x.date, sess: x.sess, w: null, idx: cnt++ % 12 }); else if (i < wk.trainings.length) c.items.push({ date: x.date, sess: x.sess, w: wk, idx: i }); else c.free++;
      });
      if (wk && wk.trainings.length > free.length) c.dropped += wk.trainings.length - free.length;
    }
    return c;
  }
  let d = pd(start), q = 0;
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
  if (P.mode === 'own' && !P.start) P.start = iso(new Date());
  if (P.keep !== 'cnt') P.keep = 'len';
  const c = P.block ? planCompute(P) : null, n = !P.block ? 1 : (P.mode === 'own' && !P.start ? 2 : 3);
  const first = c && c.items[0], last = c && c.items[c.items.length - 1], who = tm ? tm.name : 'ohne Mannschaft';
  const fit = c && c.fit, perW = x => x === 1 ? 'einmal' : x === 2 ? 'zweimal' : x + '-mal', wk = x => x + ' Woche' + (x === 1 ? '' : 'n'), pl = (x, e, m) => x + ' ' + (x === 1 ? e : m);
  const sh = fit && fit.less && P.mode === 'season' ? fit : null;
  const keepCard = (k, title, body) => `<button class="card choice ${P.keep === k ? 'sel' : ''}" data-a="planKeep" data-k="${k}"><b>${title}</b><span class="small muted">${body}</span></button>`;
  const lenTitle = f => `Ursprüngliche Länge behalten (${wk(f.N)} = ${f.N * 7} Tage)`, cntTitle = f => `Ursprüngliche Anzahl Trainings behalten (${f.M} Trainings)`;
  const lenBody = (f, own) => own ? `Der Block belegt genau ${f.N * 7} Tage ab dem Starttermin (${wk(f.N)} × 7 Tage, unabhängig vom Wochentag des Starts). ${!f.slots ? 'Jede Einheit wird ein Training mit dem Schwerpunkt des Blocks.' : f.less ? 'Pro Abschnitt von 7 Tagen ' + (f.have === 1 ? 'kommt nur das erste Training der RTP-Woche dran, das zweite fällt' : 'kommen nur die ersten ' + f.have + ' Trainings der RTP-Woche dran, die übrigen fallen') + ' weg.' : 'Pro Abschnitt von 7 Tagen kommen die Trainings der RTP-Woche der Reihe nach auf die Einheiten, ' + (f.have - f.rtp === 1 ? 'die zusätzliche Einheit bleibt' : 'die zusätzlichen Einheiten bleiben') + ' frei.'} Ferienwochen verlängern den Block nicht.`
    : !f.slots ? `Der Block dauert ${wk(f.N)}, jede Einheit wird ein Training mit dem Schwerpunkt des Blocks.`
    : f.less ? `Jede Woche bekommt die Trainings ihrer RTP-Woche. Pro Woche ${f.have === 1 ? 'kommt nur das erste RTP-Training dran, das zweite fällt' : 'kommen nur die ersten ' + f.have + ' RTP-Trainings dran, die übrigen fallen'} weg.`
    : `Jede Woche bekommt die Trainings ihrer RTP-Woche. Die ${f.rtp} RTP-Trainings pro Woche kommen der Reihe nach auf die Einheiten, ${f.have - f.rtp === 1 ? 'die zusätzliche Einheit bleibt' : 'die zusätzlichen Einheiten bleiben'} frei.`;
  const rangeTxt = r => `${fmtDate(r.from)} bis ${fmtDate(r.to)} (${wk(r.days / 7)} = ${r.days} Tage)`;
  const sumOf = x => x.range ? ` <br>→ ${pl(x.items.length, 'Training', 'Trainings')}, ${rangeTxt(x.range)}` : x.items.length ? ` <br>→ ${pl(x.items.length, 'Training', 'Trainings')}, ${fmtDate(x.items[0].date)} bis ${fmtDate(x.items[x.items.length - 1].date)} (${wk(spanWeeks(x.items[0].date, x.items[x.items.length - 1].date))})` : '';
  const shortBox = sh ? `<div class="gbox"><b>${esc(tm ? tm.name + ' trainiert' : 'Du trainierst')} ${perW(sh.have)} pro Woche, der RTP sieht ${sh.rtp} Trainings pro Woche vor.</b>
      <p class="small">Wie willst du den Block planen?</p>
      ${keepCard('len', lenTitle(sh), lenBody(sh))}
      ${keepCard('cnt', cntTitle(sh), `Alle ${sh.M} Trainings kommen der Reihe nach ab dem Saisonplan-Start auf die Einheiten. Der Block dauert etwa ${wk(Math.ceil(sh.M / sh.have))} statt ${wk(sh.N)}, die folgenden Blöcke rücken nach hinten.`)}</div>` : fit && fit.exact && P.mode === 'season' ? `<p class="small"><b>Passt genau:</b> ${wk(fit.N)}, ${fit.M} Trainings.</p>` : '';
  const note = !c || !c.items.length ? '' : P.mode === 'season'
    ? (sh ? (P.keep !== 'cnt' ? `<p class="small warn">${c.total - c.items.length} RTP-Training${c.total - c.items.length === 1 ? '' : 's'} dieses Blocks ${c.total - c.items.length === 1 ? 'fällt' : 'fallen'} weg, weil pro Woche nur ${sh.have} Einheit${sh.have > 1 ? 'en' : ''} zur Verfügung ${sh.have > 1 ? 'stehen' : 'steht'}.</p>`
        : `<p class="small muted">Der Block dauert ${wk(spanWeeks(first.date, last.date))} statt ${wk(sh.N)}, weil pro Woche nur ${sh.have} von ${sh.rtp} RTP-Trainings Platz ${sh.have === 1 ? 'hat' : 'haben'}.</p>`)
        : (c.items.length < c.total ? `<p class="small muted nomargin">Der Block hat ${c.total} Trainings; ${c.total - c.items.length} davon fallen nicht in den Saisonplan oder auf schon belegte Tage.</p>` : ''))
    : !c.range ? (fit.N !== spanWeeks(first.date, last.date) ? `<p class="small muted">Der Block dauert ${wk(spanWeeks(first.date, last.date))} (RTP: ${wk(fit.N)}).</p>` : '')
    : `${c.holSess ? `<p class="small warn">${pl(c.holSess, 'Termin entfällt', 'Termine entfallen')} wegen Ferien (Ferienwoche der Saison-Konfiguration); der Block wird dadurch nicht länger.</p>` : ''}${c.dropped ? `<p class="small warn">${pl(c.dropped, 'RTP-Training', 'RTP-Trainings')} ${c.dropped === 1 ? 'fällt' : 'fallen'} weg, weil in diesen Wochen weniger Einheiten als RTP-Trainings zur Verfügung stehen.</p>` : ''}${c.free ? `<p class="small muted">${pl(c.free, 'Einheit bleibt', 'Einheiten bleiben')} frei, weil der RTP in diesen Wochen weniger Trainings vorsieht.</p>` : ''}`;
  const sessTxt = tm ? teamSessions(tm, true).map(x => esc(sessSummary(tm, x))).join('<br>') || 'Noch keine Trainingszeit' : '';
  let ownBox = '';
  if (P.mode === 'own' && fit) {
    const cl = !fit.exact && planCompute({ ...P, keep: 'len' }), cc = !fit.exact && planCompute({ ...P, keep: 'cnt' });
    ownBox = `<label>Starttermin<input type="date" data-b="p:start" data-r="1" value="${esc(P.start)}"></label>
      ${fit.exact ? `<p class="small"><b>Passt genau:</b> ${wk(fit.N)} = ${fit.N * 7} Tage, ${fit.M} Trainings (${pl(fit.have, 'Einheit', 'Einheiten')} pro Woche).</p>`
        : `<p class="small" style="margin-top:12px"><b>${esc(tm ? tm.name + ' trainiert' : 'Du trainierst')} ${perW(fit.have)} pro Woche, der RTP sieht ${fit.rtp} Trainings pro Woche vor.</b> Wie willst du den Block planen?</p>
        ${keepCard('len', lenTitle(fit), lenBody(fit, true) + sumOf(cl))}
        ${keepCard('cnt', cntTitle(fit), `Alle ${fit.M} Trainings kommen der Reihe nach auf die Einheiten ab dem Starttermin. Der Block dauert dann ${wk(cc.items.length ? spanWeeks(cc.items[0].date, cc.items[cc.items.length - 1].date) : Math.ceil(fit.M / Math.max(1, fit.have)))} statt ${wk(fit.N)}.` + sumOf(cc))}`}
      ${tm ? `<div class="small muted" style="margin-top:10px">Trainingszeiten von ${esc(tm.name)}</div><p class="small nomargin">${sessTxt}</p><p class="small"><a href="#/team/${tm.id}/edit">Trainingszeiten bearbeiten</a></p>`
        : `<div class="small muted" style="margin-top:10px">Trainingstage</div><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip ${P.days.includes(d) ? 'sel' : ''}" data-a="planDay" data-k="${d}">${WD[d]}</button>`).join('')}</div><label>Startzeit<input type="time" data-b="p:time" value="${esc(P.time || '')}"></label>`}`;
  }
  const startCards = P.block ? `<div class="card"><h3 class="nomargin">2 · Start und Länge</h3>
    <button class="card choice ${P.mode === 'own' ? 'sel' : ''}" data-a="planMode" data-k="own"><b>Block jetzt planen</b><span class="small muted">Du wählst den Starttermin (Vorgabe: heute). Die Trainings kommen der Reihe nach auf die Trainingszeiten.</span></button>
    ${ownBox}${P.mode === 'own' || tm ? '' : `<p class="small muted nomargin">Ohne Mannschaft gelten die Trainingstage der allgemeinen Saison-Konfiguration (${gen.days.map(d => WD[d]).join(', ')}).</p>`}
    <button class="card choice ${P.mode === 'season' ? 'sel' : ''}" data-a="planMode" data-k="season" ${info ? '' : 'disabled'}><b>Block nach Saisonplan einplanen</b><span class="small muted">${info ? esc(info.label) + ', ab ' + fmtDate(info.first) : 'Dieser Block liegt nicht im Saisonplan' + (tm ? ' von ' + esc(tm.name) : '') + ' (Saison-Start ' + fmtDate(seasonCfgFor(tm).start) + ').'}</span></button>
    ${shortBox}</div>` : '';
  const prev = c ? `<div class="card item" style="--c:${efColor(c.b.main.ef)}"><h3 class="nomargin">3 · Vorschau</h3>${c.noSess ? '<p class="warn">Keine Trainingszeit vorhanden – lege Trainingstage fest.</p>' : c.items.length ? `<p class="nomargin"><b>${pl(c.items.length, 'Training', 'Trainings')}</b> · ${st.id} · Block ${c.b.nr} (${esc(c.b.main.sp || c.b.main.ef)}) · ${esc(who)}</p><p class="nomargin">${c.range ? rangeTxt(c.range) : `${fmtDate(first.date)} bis ${fmtDate(last.date)} · ${wk(spanWeeks(first.date, last.date))}`}</p>${note}` : '<p class="muted">Keine Trainings zu planen (Datum prüfen).</p>'}
    ${c.skipped.length ? `<p class="small warn">${c.skipped.length} Tag${c.skipped.length > 1 ? 'e sind' : ' ist'} schon mit einem Training belegt und ${c.skipped.length > 1 ? 'werden' : 'wird'} nicht doppelt belegt: ${c.skipped.slice(0, 6).map(x => dm(pd(x.date)) + (x.sess.time ? ' ' + x.sess.time : '')).join(', ')}${c.skipped.length > 6 ? ' …' : ''}${P.mode === 'own' ? (c.range ? ' (diese Termine entfallen, der Block wird nicht länger).' : ' (der Block rückt auf den nächsten freien Termin).') : '.'}</p>` : ''}
    ${c.hol && !c.range ? `<p class="small muted">${c.hol} Ferienwoche${c.hol > 1 ? 'n' : ''} der Saison-Konfiguration ${c.hol > 1 ? 'werden' : 'wird'} übersprungen.</p>` : ''}
    ${c.items.length ? `<details><summary class="small">Alle Termine</summary>${c.items.map(x => `<div class="small">${fmtDate(x.date)}${x.sess.time ? ' · ' + x.sess.time : ''} · ${x.w ? 'Woche ' + x.w.w + ' · ' : ''}Training ${x.idx + 1}</div>`).join('')}</details><button class="btn pri block" data-a="planGo">${pl(c.items.length, 'Training', 'Trainings')} anlegen</button>` : ''}</div>` : '';
  return head('Ganzen Block planen', P.back, '', esc(who), ctxBar('plan', n)) + `<div class="card"><h3 class="nomargin">1 · Mannschaft und Block</h3>
    <label>Mannschaft<select data-b="p:team" data-r="1">${opt('', 'Ohne Mannschaft', P.team)}${DB.teams.map(x => opt(x.id, x.name, P.team)).join('')}</select></label>
    <label>Stufe<select data-b="p:stage" data-r="1">${stageOpts(P.stage)}</select></label>
    <label>Block<select data-b="p:block" data-r="1">${opt('', '– Block wählen –', P.block ? String(P.block) : '')}${st.blocks.map(b => opt(String(b.nr), `Block ${b.nr} · ${b.main.sp || b.main.ef} (${b.monat || b.phase})`, String(P.block))).join('')}</select></label></div>
    ${startCards}${prev}`;
}

// ---------- Ansicht: Kalender ----------
function viewCal() {
  const now = new Date(), todayIso = iso(now), tf = tFilter();
  const c = S.cal || (S.cal = { y: now.getFullYear(), m: now.getMonth(), day: todayIso });
  const byDate = {}; DB.trainings.forEach(t => { if (!t.date) return; const tm = teamOf(t); if (tf && (!tm || tm.id !== tf)) return; (byDate[t.date] = byDate[t.date] || []).push(t); });
  const first = new Date(c.y, c.m, 1), start = monday(first), weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(c.y, c.m + 1, 0).getDate()) / 7);
  const cells = []; for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), k = iso(d), ts = byDate[k] || [], cols = ts.map(t => (teamOf(t) || { color: '#6b7785' }).color);
    cells.push(`<button class="cal-d ${d.getMonth() !== c.m ? 'oth' : ''} ${k === todayIso ? 'today' : ''} ${k === c.day ? 'sel' : ''}" data-a="calDay" data-d="${k}" aria-label="${WDL[d.getDay()]}, ${dm(d)}${ts.length ? ', ' + ts.length + ' Training' + (ts.length > 1 ? 's' : '') : ''}"><span class="n">${d.getDate()}</span><span class="dots">${cols.slice(0, 3).map(col => `<i style="background:${esc(col)}"></i>`).join('')}${cols.length > 3 ? `<b>+${cols.length - 3}</b>` : ''}</span></button>`);
  }
  const day = c.day ? pd(c.day) : null, dts = day ? (byDate[c.day] || []).slice().sort((a, b) => (a.start || '').localeCompare(b.start || '')) : [];
  const card = t => { const tm = teamOf(t); return `<a class="card tcard item" style="--c:${esc(tm ? tm.color : '#6b7785')}" href="#/t/${t.id}"><div class="row"><b>${esc(t.title || 'Ohne Titel')}</b><span class="muted">${total(t)}′</span></div><div class="muted small">${tm ? teamDot(tm) + '<b>' + esc(tm.name) + '</b> · ' : ''}${[t.start && `${t.start}–${endTime(t)}`, t.ort, t.sp].filter(Boolean).map(esc).join(' · ') || 'ohne Uhrzeit'}</div></a>`; };
  return trTop('cal') + `
  <div class="row calnav"><button class="btn" data-a="calNav" data-d="-1" aria-label="Voriger Monat">‹</button><b class="grow center">${MONTHS[c.m]} ${c.y}</b><button class="btn" data-a="calNav" data-d="1" aria-label="Nächster Monat">›</button><button class="btn sm" data-a="calToday">Heute</button></div>
  <div class="cal"><div class="cal-h">${[1, 2, 3, 4, 5, 6, 0].map(d => `<span>${WD[d]}</span>`).join('')}</div><div class="cal-g">${cells.join('')}</div></div>
  ${day ? `<h2>${WDL[day.getDay()]}, ${dm(day)}${day.getFullYear()}</h2>${dts.map(card).join('') || '<p class="muted">An diesem Tag ist kein Training geplant.</p>'}<button class="btn pri block" data-a="newT" data-team="${esc(tf)}" data-date="${c.day}">+ Training an diesem Tag</button>` : '<p class="muted small center">Tippe auf einen Tag, um seine Trainings zu sehen oder eines anzulegen.</p>'}`;
}

// ---------- Ansichten: Mannschaften ----------
const teamInfo = tm => [(stageById(tm.stage) || {}).name].filter(Boolean);
const sessLines = tm => teamSessions(tm).map(x => `<div class="small">${esc(sessSummary(tm, x))}</div>`).join('') || '<div class="small muted">Noch keine Trainingszeit</div>';
function viewTeams() {
  const today = iso(new Date());
  return head('Mannschaften', null, `<a class="btn pri" href="#/team/new">+ Neu</a>`, 'Jede Mannschaft hat ihren eigenen Trainingsplan') + doneBar('/teams') + (DB.teams.length ? DB.teams.map(tm => {
    const ts = teamTrainings(tm), next = ts.filter(t => t.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    return `<a class="card item" style="--c:${esc(tm.color)}" href="#/team/${tm.id}"><div class="row"><b>${esc(tm.name)}${SYNC_ON && spOf(tm.id) ? ' <span title="Mit Co-Trainern abgeglichen">🔄</span>' : ''}</b><span class="muted small">${ts.length} Training${ts.length === 1 ? '' : 's'}</span></div><div class="small muted">${esc(teamInfo(tm).join(' · '))}</div><div class="muted">${sessLines(tm)}</div><div class="small">${next ? 'Nächstes: ' + esc(fmtDate(next.date)) : 'Kein kommendes Training'}</div></a>`;
  }).join('') : `<div class="card empty"><h2>Noch keine Mannschaft</h2><p>Lege deine Mannschaft an (Name, Stufe, Farbe, Ort, Trainingstage). Dann planst du ihre Trainings und die Saison direkt dort und siehst sie im Kalender in ihrer Farbe.</p><p><a class="btn pri" href="#/team/new">Mannschaft anlegen</a></p></div>`);
}
function viewTeam(id) {
  const tm = teamById(id); if (!tm) return head('Mannschaft', '/teams') + '<p class="muted center">Mannschaft nicht gefunden.</p>';
  const today = iso(new Date()), all = teamTrainings(tm).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.start || '').localeCompare(b.start || '')), up = all.filter(t => !t.date || t.date >= today), past = all.filter(t => t.date && t.date < today).reverse();
  const card = t => `<a class="card tcard ${t.date && t.date < today ? 'past' : ''}" href="#/t/${t.id}"><div class="row"><b>${esc(t.title || 'Ohne Titel')}</b><span class="muted">${total(t)}′</span></div><div class="muted small">${metaLine(t, false)}</div>${reflTag(t)}<div class="bar">${t.items.map(i => `<i style="flex:${+i.min || 1};background:${(TYPES[i.type] || TYPES.sonst)[1]}"></i>`).join('')}</div></a>`;
  return head(tm.name, '/teams', `<a class="btn" href="#/team/${tm.id}/edit">Bearbeiten</a>`, esc((stageById(tm.stage) || {}).name || '')) + doneBar('/team/' + tm.id) + `
  <div class="card item" style="--c:${esc(tm.color)}"><div class="small muted">Trainingszeiten (Vorgaben für neue Trainings)</div>${sessLines(tm)}</div>
  <div class="row wrap"><button class="btn pri" data-a="newT" data-team="${tm.id}">+ Training hinzufügen</button><button class="btn" data-a="teamSeason" data-k="${tm.id}">Saison planen</button><button class="btn" data-a="planOpen" data-team="${tm.id}" data-mode="season">Ganzen Block planen</button><button class="btn" data-a="calTeam" data-k="${tm.id}">Kalender</button><button class="btn" data-a="tshOpen" data-k="${tm.id}">Mannschaft teilen</button></div>
  ${spCard(tm)}${playersCard(tm)}${awSection(tm)}${rbCard(tm)}<h2>Kommende Trainings (${up.length})</h2>${up.map(card).join('') || '<p class="muted">Noch nichts geplant. Tippe auf «Training hinzufügen», «Saison planen» oder «Ganzen Block planen».</p>'}
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

// ---------- Spielerliste, Anwesenheit, Export für J+S ----------
const attLink = t => {
  const tm = teamOf(t), pl = playersOf(tm).length;
  return `<a class="card attlink" href="#/t/${t.id}/att"><b>👥 Anwesenheit</b><span class="muted small">${tm ? (pl ? attCount(t, tm) + ' von ' + pl + ' anwesend' : 'Spielerliste anlegen') : 'Mannschaft nötig'}</span><span class="muted">›</span></a>`;
};
const attSum = (t, tm) => `${attCount(t, tm)} von ${playersOf(tm).length} anwesend`;
const attBody = (t, tm, pl) => `
  <div class="row sum"><b id="attn">${attSum(t, tm)}</b><button class="btn sm" data-a="attAll">Alle anwesend</button><button class="btn sm" data-a="attNone">Keine</button></div>
  ${pl.map(p => `<button class="att ${attOf(t)[p.id] ? 'on' : ''}" data-a="attTog" data-id="${esc(p.id)}" aria-pressed="${attOf(t)[p.id] ? 'true' : 'false'}"><span class="box"></span><span class="grow"><b>${esc(pName(p))}</b>${p.rn || p.role === 'L' ? `<br><span class="small muted">${[p.rn && '#' + p.rn, p.role === 'L' && 'Leiter/in'].filter(Boolean).map(esc).join(' · ')}</span>` : ''}</span></button>`).join('')}`;   // Zähler, «Alle anwesend» und Abhak-Liste (auch im Abschluss-Ablauf)
function viewAtt(t) {
  const tm = teamOf(t), pl = playersOf(tm), hd = head('Anwesenheit', '/t/' + t.id, '', esc(t.title || 'Ohne Titel')) + `<div class="muted small">${metaLine(t, true)}</div>`;
  if (!tm) return hd + `<div class="card empty"><p>Dieses Training gehört zu keiner Mannschaft. Wähle im Training eine Mannschaft, dann kannst du ihre Spieler*innen abhaken.</p><p><a class="btn pri" href="#/t/${t.id}">Zum Training</a> <a class="btn" href="#/teams">Mannschaften</a></p></div>`;
  if (!pl.length) return hd + `<div class="card empty"><p>Für «${esc(tm.name)}» gibt es noch keine Spielerliste. Lege sie an, dann kannst du hier pro Training abhaken, wer da war.</p><p><button class="btn pri" data-a="toPlayers" data-k="${esc(tm.id)}">Zur Spielerliste</button></p></div>`;
  return hd + `<div class="card"><label>J+S-Aktivitätstyp<select data-b="t:jsType">${JS_TYPES.map(k => opt(k, k, jsTypeOf(t))).join('')}</select></label><p class="small muted nomargin">Wird beim Export für J+S verwendet. Bei «Wettkampf» und «Trainingstag» bleiben Startzeit und Ort in der Datei leer.</p></div>
  ${attBody(t, tm, pl)}
  <p class="small muted">Die Anwesenheit bleibt auf diesem Gerät und wird beim Teilen des Trainings nicht mitgegeben.</p>`;
}

function playersCard(tm) {
  const l = playersOf(tm);
  return `<details class="card tsec" data-k="pl" ${S.tsec.has('pl') ? 'open' : ''}><summary><b>Spielerliste</b> <span class="muted small">${l.length ? l.length + (l.length === 1 ? ' Person' : ' Personen') : 'noch leer'}</span></summary>
    <p class="small muted">Pro Person nur Name, J+S-Personennummer, Rolle und Rückennummer. Die Liste bleibt auf diesem Gerät und geht beim Teilen eines Trainings nie mit.</p>
    ${l.map(p => `<button class="prow" data-a="plEdit" data-tm="${esc(tm.id)}" data-id="${esc(p.id)}"><span class="pn">${esc(pName(p))}</span><span class="small muted">${[p.rn && '#' + p.rn, p.role === 'L' && 'Leiter/in'].filter(Boolean).map(esc).join(' · ')}</span>${p.jsnr ? `<span class="small muted">${esc(p.jsnr)}</span>` : '<span class="small warn">ohne J+S-Nr.</span>'}<span class="muted">›</span></button>`).join('')}
    ${l.length ? '' : '<p class="small muted">Noch niemand erfasst. Du kannst dich selbst als Leiter/in eintragen.</p>'}
    <div class="row wrap" style="margin-top:10px"><button class="btn" data-a="plAdd" data-tm="${esc(tm.id)}" data-role="T">+ Spieler/in</button><button class="btn" data-a="plAdd" data-tm="${esc(tm.id)}" data-role="L">+ Leiter/in</button><button class="btn" data-a="plBulk" data-tm="${esc(tm.id)}">Mehrere einfügen</button></div></details>`;
}
function playerModal() {
  const f = S.pf;
  modal(`<h2>${f.id ? 'Person bearbeiten' : 'Person hinzufügen'}</h2>
    <div class="grid2"><label>Vorname<input data-b="pl:first" value="${esc(f.first)}" autocomplete="off"></label><label>Name<input data-b="pl:last" value="${esc(f.last)}" autocomplete="off"></label>
    <label>J+S-Personennummer<input inputmode="numeric" data-b="pl:jsnr" value="${esc(f.jsnr)}" placeholder="z.B. 123456789" autocomplete="off"></label><label>Rückennummer (optional)<input inputmode="numeric" data-b="pl:rn" value="${esc(f.rn)}" autocomplete="off"></label></div>
    <label>Rolle<select data-b="pl:role">${opt('T', 'Teilnehmer/in', f.role)}${opt('L', 'Leiter/in', f.role)}</select></label>
    <p class="small muted">Die J+S-Personennummer brauchst du nur für den Export an J+S. Es werden bewusst keine weiteren Personendaten gespeichert (kein Geburtsdatum, keine AHV-Nummer, keine Adresse).</p>
    <div class="row wrap"><button class="btn pri" data-a="plSave">Speichern</button>${f.id ? '<button class="btn danger" data-a="plDel">Entfernen</button>' : ''}<button class="btn" data-a="close">Abbrechen</button></div>`);
}
function bulkModal() {
  const b = S.pb, tm = teamById(b.tm), prev = b.prev;
  modal(`<h2>Mehrere Personen einfügen</h2><p class="small">Eine Person pro Zeile: «Vorname Name» oder «Name, Vorname», optional mit J+S-Personennummer am Zeilenende. Du kannst eine Liste aus Excel oder einem Dokument einfügen.</p>
    <textarea rows="7" data-b="pb:text" placeholder="Anna Muster 123456789&#10;Beispiel, Ben&#10;Chiara Probe" autocomplete="off">${esc(b.text)}</textarea>
    <label class="chk"><input type="checkbox" data-b="pb:leader" ${b.leader ? 'checked' : ''}>Als Leiter/in eintragen</label>
    ${prev ? `<p class="small nomargin"><b>${prev.length} Person${prev.length === 1 ? '' : 'en'} erkannt</b> – prüfe Vor- und Nachname:</p><ul class="small">${prev.slice(0, 40).map(p => `<li>${esc(p.first)} <b>${esc(p.last)}</b>${p.jsnr ? ' · ' + esc(p.jsnr) : ' · <span class="warn">ohne Nr.</span>'}${p.dup ? ' <span class="muted">(schon in der Liste, wird übersprungen)</span>' : ''}</li>`).join('')}${prev.length > 40 ? `<li>… und ${prev.length - 40} weitere</li>` : ''}</ul>` : ''}
    <div class="row wrap"><button class="btn ${prev ? '' : 'pri'}" data-a="pbPrev">Prüfen</button>${prev ? `<button class="btn pri" data-a="pbAdd">${prev.filter(p => !p.dup).length} hinzufügen</button>` : ''}<button class="btn" data-a="close">Abbrechen</button></div>`);
}
const isDupPlayer = (tm, p) => playersOf(tm).some(x => (x.first + ' ' + x.last).trim().toLowerCase() === (p.first + ' ' + p.last).trim().toLowerCase() || (p.jsnr && x.jsnr === p.jsnr));

// Anwesenheit / J+S auf der Mannschaftsseite
function awRange(tm) {
  const s = DB.seasons[tm.id], def = s ? seasonStart(s, seasonYearNow()) : seasonDefault(seasonYearNow());
  if (!S.aw || S.aw.id !== tm.id) S.aw = { id: tm.id, from: '', to: '' };
  return { from: S.aw.from || def, to: S.aw.to || iso(new Date()) };
}
const awTrainings = (tm, r) => teamTrainings(tm).filter(t => t.date && t.date >= r.from && t.date <= r.to).sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
const dmy = s => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
function awSection(tm) {
  const pl = playersOf(tm), r = awRange(tm), ts = awTrainings(tm, r), rec = ts.filter(t => attCount(t, tm) > 0);
  let body;
  if (!pl.length) body = '<p class="small muted">Lege zuerst die Spielerliste an. Dann hakst du in jedem Training ab, wer da war, und siehst hier die Übersicht.</p>';
  else body = `<div class="grid2"><label>Von<input type="date" data-b="aw:from" data-r="1" value="${esc(r.from)}"></label><label>Bis<input type="date" data-b="aw:to" data-r="1" value="${esc(r.to)}"></label></div>
    ${ts.length ? `<div class="tscroll"><table class="aw"><thead><tr><th>Name</th><th>Anwesend</th>${ts.map(t => `<th><a href="#/t/${t.id}/att" aria-label="Anwesenheit ${esc(fmtDate(t.date))}">${dm(pd(t.date))}</a></th>`).join('')}</tr></thead><tbody>
      ${pl.map(p => { const n = rec.filter(t => attOf(t)[p.id]).length; return `<tr><th>${esc(pName(p))}</th><td class="tot">${rec.length ? n + '/' + rec.length + ' · ' + Math.round(100 * n / rec.length) + '%' : '–'}</td>${ts.map(t => attCount(t, tm) ? `<td class="${attOf(t)[p.id] ? 'y' : 'n'}">${attOf(t)[p.id] ? '✓' : '·'}</td>` : '<td class="x">–</td>').join('')}</tr>`; }).join('')}</tbody></table></div>
      <p class="small muted">${ts.length} Training${ts.length === 1 ? '' : 's'} im Zeitraum, bei ${rec.length} ist die Anwesenheit erfasst («–» = nicht erfasst, zählt nicht mit). Tippe auf ein Datum, um die Anwesenheit zu bearbeiten.</p>` : '<p class="small muted">In diesem Zeitraum gibt es keine Trainings dieser Mannschaft.</p>'}
    <div class="col"><button class="btn pri" data-a="awExport" data-tm="${esc(tm.id)}" data-k="awk">AWK für J+S exportieren (CSV)</button><button class="btn" data-a="awExport" data-tm="${esc(tm.id)}" data-k="act">Aktivitäten exportieren (CSV)</button></div>
    <p class="small muted">Für die Abrechnung bei Jugend+Sport (Import in die NDS). Vor dem Download siehst du, was auffällt.</p>`;
  return `<details class="card tsec" data-k="aw" ${S.tsec.has('aw') ? 'open' : ''}><summary><b>Anwesenheit / J+S</b></summary>${body}</details>`;
}

// Export für J+S: CSV nach den Vorlagen von jugendundsport.ch (Datenimport): Semikolon, UTF-8 mit BOM, CRLF, feste Kopfzeile
const JS_AWK = 'PERSONENNUMMER;FUNKTION;DATUM;AKTIVITAETSTYP;ZEIT;DAUER;ORT', JS_ACT = 'AKTIVITAETSTYP;DATUM;ZEIT;DAUER;ORT;FOKUS';
const JS_DUR = { Training: [60, 75, 90, 120, 150, 180, 210, 240, 270, 300], Trainingstag: [240, 300] };
const csvCell = v => { v = String(v ?? '').replace(/[\r\n]+/g, ' ').trim(); return /[;"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const jsMin = t => +t.min || total(t) || 0;   // J+S: geplante Trainingsdauer (Feld «Dauer», Hallenzeit), sonst Summe der Blöcke
function jsExport(tm, kind) {
  const r = awRange(tm), ts = awTrainings(tm, r), pl = playersOf(tm), awk = kind === 'awk', rows = [], issues = [], noNr = new Set(), used = new Set(); let wk = false;
  ts.forEach(t => {
    const type = jsTypeOf(t), min = jsMin(t), lab = `${fmtDate(t.date)} «${t.title || 'Ohne Titel'}»`, tr = type === 'Training';
    if (awk && !attCount(t, tm)) { issues.push(`${lab}: Anwesenheit nicht erfasst – nicht in der Datei.`); return; }
    if (tr) { const miss = [!t.start && 'Startzeit', !t.ort && 'Ort'].filter(Boolean); if (miss.length) { issues.push(`${lab}: ${miss.join(' und ')} fehlt (bei «Training» Pflicht) – nicht in der Datei. Ergänze es im Training und exportiere nochmals.`); return; } }
    if (type === 'Wettkampf') { if (!wk) issues.push('Wettkampf: J+S verlangt je nach Nutzergruppe eine Dauer oder keine. Prüfe das beim Import in der NDS.'); wk = true; }
    else if (!min || !JS_DUR[type].includes(min)) issues.push(`${lab}: Dauer ${min || 'leer'} Min. – J+S akzeptiert je nach Sportart nur bestimmte Werte, z. B. 60, 75, 90. Der Wert steht trotzdem in der Datei.`);
    const zeit = tr ? t.start : '', ort = tr ? t.ort : '', base = [dmy(t.date), type, zeit, min || '', ort];
    if (awk) { pl.forEach(p => { if (!attOf(t)[p.id]) return; if (!p.jsnr) { noNr.add(pName(p)); return; } rows.push([p.jsnr, p.role === 'L' ? 'Leiter/in' : 'Teilnehmer/in', ...base]); used.add(t.id); }); }
    else { rows.push([type, dmy(t.date), zeit, min || '', ort, '']); used.add(t.id); }
  });
  if (noNr.size) issues.unshift(`Ohne J+S-Personennummer, ihre Zeilen fehlen in der Datei: ${[...noNr].join(', ')}.`);
  const text = '﻿' + [awk ? JS_AWK : JS_ACT, ...rows.map(x => x.map(csvCell).join(';'))].join('\r\n') + '\r\n';
  return { kind, rows: rows.length, nt: used.size, issues, text, from: r.from, to: r.to, name: `${awk ? 'awk' : 'aktivitaeten'}_${norm(tm.name).replace(/ /g, '-') || 'mannschaft'}_${r.from}_${r.to}.csv` };
}
function jsModal(tm, kind) {
  const r = S.jsx = jsExport(tm, kind), act = kind === 'act';
  modal(`<h2>${act ? 'Aktivitäten für J+S' : 'Anwesenheitskontrolle (AWK) für J+S'}</h2>
    ${act ? '<div class="warnbox"><b>Achtung:</b> Beim Import von Aktivitäten in der NDS gehen alle bereits im Kurs erfassten Aktivitäten samt Anwesenheiten verloren (Angabe des BASPO). Das BASPO empfiehlt, den Import erst nach Abschluss des Kurses zu machen und nicht parallel in der NDS und anderswo zu verwalten.</div>' : ''}
    <p>${r.rows ? `<b>${r.rows} Zeile${r.rows === 1 ? '' : 'n'}</b> aus ${r.nt} Training${r.nt === 1 ? '' : 's'}, ${dmy(r.from)} bis ${dmy(r.to)}.` : '<b>Für diesen Zeitraum gibt es nichts zu exportieren.</b>'}</p>
    ${r.issues.length ? `<div class="gbox"><b>Das fällt auf</b><ul class="small">${r.issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '<p class="small muted">Beim Prüfen ist nichts aufgefallen.</p>'}
    <p class="small"><b>Reihenfolge in der NDS:</b> zuerst die Personen, dann die Aktivitäten, dann die Anwesenheitskontrolle. Personen und Aktivitäten müssen im Kurs schon erfasst sein. Importiere erst nach Kursende.</p>
    <p class="small muted">Die Datei enthält J+S-Personennummern – gib sie nur an J+S weiter. Ob die NDS sie annimmt, zeigt sich erst beim Import; hier lässt sich das nicht vorab prüfen.</p>
    <div class="row wrap"><button class="btn pri" data-a="awDownload" ${r.rows ? '' : 'disabled'}>Herunterladen</button><button class="btn" data-a="close">Abbrechen</button></div>`);
}

// Mannschaft teilen (Kopie weitergeben, kein Abgleich). Format: { v: 2, k: 'team', t: Trainings, m: [Mannschaft (+ players nur auf Wunsch)], c, n, s: { teamId: Saison-Einstellung } }
const qrSvg = (url, msg) => { try { const q = qrcode(0, 'L'); q.addData(url, 'Byte'); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { return `<p class="small muted">${msg}</p>`; } };
async function buildTeamShare() {
  const o = S.tsh, tm = teamById(o.id); if (!tm) return;
  const today = iso(new Date()), all = teamTrainings(tm), ts = o.which === 'none' ? [] : o.which === 'all' ? all : all.filter(t => !t.date || t.date >= today), c = [], n = {}, seen = new Set();
  ts.forEach(t => t.items.forEach(it => { const cx = customOf(it); if (cx && !seen.has(cx.id)) { seen.add(cx.id); c.push(cx); } for (const k of [it.lib, matNoteKey(it)]) if (k && DB.notes[k]) n[k] = DB.notes[k]; }));
  const data = { v: 2, k: 'team', t: ts.map(slim), m: [teamMeta(tm, o.pl)], c, n };
  if (DB.seasons[tm.id]) data.s = { [tm.id]: JSON.parse(JSON.stringify(DB.seasons[tm.id])) };
  const seq = buildTeamShare.n = (buildTeamShare.n || 0) + 1, url = appUrl() + '#i=' + await pack(data); if (seq !== buildTeamShare.n || !S.tsh) return;
  S.share = { url, t: { title: tm.name }, data, file: `mannschaft-${norm(tm.name).replace(/ /g, '-')}.json`, text: 'Unihockey-Trainingsplaner, Mannschaft: ' + tm.name };
  const up = all.filter(t => !t.date || t.date >= today).length;
  modal(`<h2>«${esc(tm.name)}» teilen</h2><p class="small">Du gibst eine Kopie weiter: Mannschaft (Name, Stufe, Farbe, Trainingszeiten, Saison-Einstellung) und, wenn du willst, ihre Trainings samt den eigenen Übungen und Notizen darin. Anwesenheiten und Spieler-Notizen gehen nie mit. Danach gleicht sich nichts mehr ab; wer etwas ändert, teilt neu.</p>
    <label>Trainings mitgeben<select data-b="tsh:which">${opt('up', `Nur kommende (${up})`, o.which)}${opt('all', `Alle (${all.length})`, o.which)}${opt('none', 'Keine', o.which)}</select></label>
    <label class="chk"><input type="checkbox" data-b="tsh:pl" ${o.pl ? 'checked' : ''}>Spielerliste mitgeben (Namen und J+S-Nummern)</label>
    ${o.pl ? '<p class="small warn">Der Link enthält dann Personendaten, auch von Kindern. Schicke ihn nur direkt an die Person, die ihn braucht – nicht in Gruppenchats und nicht öffentlich.</p>' : ''}
    <div class="qr">${qrSvg(url, 'Für einen QR-Code ist das zu umfangreich – nutze den Link oder die Datei.')}</div>
    <div class="row wrap"><button class="btn pri" data-a="shNative">Teilen …</button><button class="btn" data-a="shCopy">Link kopieren</button><button class="btn" data-a="shFile">Als Datei</button><button class="btn" data-a="close">Schliessen</button></div>`);
}

// ---------- Training abschliessen: Anwesenheit, Reflexion ----------
// Optionales Feld am Training: t.refl = { at (ms, beim Abschliessen gesetzt), goal 0|1|2 (Ziel erreicht: nicht|teilweise|ja), int/conc/lead 1–5, items: { <itemId>: { v: 1|0|-1, why } }, good, change, players: { <playerId>: { k: 'plus'|'foerdern', note } } }.
// t.reflSeen = true: die Karte «Vom letzten Training» wurde weggetippt. «Fertig» ist eine Reflexion mit at > 0; Entwürfe (ohne at) bleiben am Training, zählen aber nirgends.
// Spieler-Notizen (refl.players) sind Personendaten: slim() entfernt sie beim Teilen (wie t.att); sie gehen nur im Mannschaftsraum (ganzes Training, verschlüsselt) und in die eigene Datensicherung mit.
const RF_GOAL = ['Nicht', 'Teilweise', 'Ja'];
const RF_SC = [
  { k: 'int', t: 'Intensität', s: 'Intensität', ends: ['zu tief', 'passend', 'zu hoch'], txt: ['zu tief', 'eher tief', 'passend', 'eher hoch', 'zu hoch'], lo: 'zu tief', mid: 'passend', hi: 'zu hoch' },
  { k: 'conc', t: 'Konzentration / Engagement der Spieler', s: 'Konzentration', ends: ['unkonzentriert', 'mittel', 'voll dabei'], txt: ['unkonzentriert', 'eher schwach', 'mittel', 'gut', 'voll dabei'], lo: 'schwach', mid: 'mittel', hi: 'gut' },
  { k: 'lead', t: 'Eigene Leitung (Erklärungen, Organisation)', s: 'Leitung', ends: ['holprig', 'solide', 'souverän'], txt: ['holprig', 'eher holprig', 'solide', 'gut', 'souverän'], lo: 'holprig', mid: 'solide', hi: 'souverän' }
];
const RF_VOTE = [[1, '👍', 'Gut'], [0, '➖', 'Mittel'], [-1, '👎', 'Schlecht']];
const RF_RECENT = 30 * 864e5;   // «Reflexion offen» nur bei Trainings der letzten 30 Tage
const reflOf = t => t && t.refl && typeof t.refl === 'object' ? t.refl : null;
const reflDone = t => { const r = reflOf(t); return !!(r && +r.at > 0); };
const reflEdit = t => t.refl = reflOf(t) || {};
const reflItem = (t, id) => { const m = (reflOf(t) || {}).items; return m && typeof m === 'object' && m[id] && typeof m[id] === 'object' ? m[id] : {}; };
const reflPast = t => !!t.date && t.date <= iso(new Date());
const reflKey = it => it.lib || norm(it.name || '');   // Bibliotheks-Schlüssel der Übung (Übungen aus dem RTP haben kein it.lib: dort ist es der normierte Name)
function reflFill(t) {   // 5 Bereiche: Ziel, Skalen, Übungen, «Was hat funktioniert», «Was ändere ich»
  const r = reflOf(t) || {};
  return [[0, 1, 2].includes(r.goal), RF_SC.some(s => +r[s.k] > 0), t.items.some(i => [1, 0, -1].includes(reflItem(t, i.id).v)), !!String(r.good || '').trim(), !!String(r.change || '').trim()].filter(Boolean).length;
}
const reflProg = t => { const n = Math.min(5, reflFill(t)); return `<b>${n} von 5 ausgefüllt</b><span class="rfbarw"><i style="width:${n * 20}%"></i></span>`; };
const reflUp = t => { const e = $('#rfprog'); if (e) e.innerHTML = reflProg(t); };
const pk = (on, attrs, label, cls = '') => `<button class="pk ${cls} ${on ? 'sel' : ''}" aria-pressed="${on ? 'true' : 'false'}" ${attrs}>${label}</button>`;
const pkMark = (el, on) => [...el.parentElement.children].forEach(b => { const s = b === el && on; b.classList.toggle('sel', s); b.setAttribute('aria-pressed', s ? 'true' : 'false'); });
// Antwort-Texte, kompakt
const reflScaleTxt = (r, s) => +r[s.k] >= 1 && +r[s.k] <= 5 ? s.txt[+r[s.k] - 1] : '';
// Das Training davor (dieselbe Mannschaft, nächstes Datum davor), nur wenn es eine fertige Reflexion hat
function reflPrev(t) {
  const tm = teamOf(t); if (!tm || !t.date) return null;
  const key = x => (x.date || '') + ' ' + (x.start || ''), before = teamTrainings(tm).filter(x => x !== t && x.date && key(x) < key(t)).sort((a, b) => key(b).localeCompare(key(a)))[0];
  return before && reflDone(before) ? before : null;
}
function reflPrevCard(t) {
  if (t.reflSeen) return '';
  const p = reflPrev(t); if (!p) return '';
  const ch = String(p.refl.change || '').trim(), bad = p.items.filter(i => reflItem(p, i.id).v === -1);
  if (!ch && !bad.length) return '';
  const d = pd(p.date);
  return `<div class="card rfprev"><div class="row"><b class="grow">Vom letzten Training <span class="muted small">${WD[d.getDay()]}, ${dm(d)}</span></b><button class="btn sm" data-a="reflSeen" aria-label="Wegtippen">✕</button></div>
    ${ch ? `<p><b>Ändern:</b> ${esc(ch)}</p>` : ''}${bad.map(i => { const w = String(reflItem(p, i.id).why || '').trim(); return `<p class="small">👎 ${esc(i.name || (TYPES[i.type] || TYPES.sonst)[0])}${w ? ' – ' + esc(w) : ''}</p>`; }).join('')}</div>`;
}
// Hinweis zu einer Übung aus allen Reflexionen (Bibliothek, Editor): «Zuletzt: 👍 2× · 👎 1× (‹Grund›)»
function reflHint(key) {
  if (!key) return '';
  let up = 0, mid = 0, down = 0, why = '', whyAt = -1;
  for (const t of DB.trainings) {
    if (!reflDone(t)) continue;
    for (const it of t.items) {
      if (reflKey(it) !== key) continue; const x = reflItem(t, it.id);
      if (x.v === 1) up++; else if (x.v === 0) mid++; else if (x.v === -1) { down++; const w = String(x.why || '').trim(), at = +t.refl.at || 0; if (w && at >= whyAt) { why = w; whyAt = at; } }
    }
  }
  if (!up && !mid && !down) return '';
  return `<p class="small rfhint">Zuletzt: ${[up && '👍 ' + up + '×', mid && '➖ ' + mid + '×', down && '👎 ' + down + '×'].filter(Boolean).join(' · ')}${why ? ` (‹${esc(why.length > 80 ? why.slice(0, 80) + '…' : why)}›)` : ''}</p>`;
}
// Symbol in Trainingsliste und Mannschaftsseite (tippen: Reflexion öffnen)
function reflTag(t) {
  if (S.sel || !t.date || !t.items.length || !reflPast(t)) return '';
  if (reflDone(t)) return `<div class="rftag ok" role="button" data-a="reflOpen" data-id="${t.id}">✓ Reflexion${[0, 1, 2].includes(t.refl.goal) ? ' · Ziel: ' + RF_GOAL[t.refl.goal] : ''}</div>`;
  if (pd(t.date).getTime() < Date.now() - RF_RECENT) return '';
  return `<div class="rftag" role="button" data-a="reflOpen" data-id="${t.id}">✎ Reflexion offen</div>`;
}
const reflLink = t => !reflPast(t) ? '' : `<a class="card attlink noprint" href="#/t/${t.id}/end/2"><b>✎ Reflexion</b><span class="muted small">${reflDone(t) ? '✓ ausgefüllt' + ([0, 1, 2].includes(t.refl.goal) ? ' · Ziel: ' + RF_GOAL[t.refl.goal] : '') : 'noch offen'}</span><span class="muted">›</span></a>`;
// Kompakte Darstellung (Übersicht, Druck); Spieler-Notizen erscheinen hier bewusst nicht
function reflCompact(t) {
  if (!reflDone(t)) return '';
  const r = t.refl, l = [];
  if ([0, 1, 2].includes(r.goal)) l.push(`<b>Ziel erreicht:</b> ${RF_GOAL[r.goal]}`);
  const sc = RF_SC.filter(s => reflScaleTxt(r, s)).map(s => `${s.s}: ${reflScaleTxt(r, s)}`); if (sc.length) l.push(sc.map(esc).join(' · '));
  const ex = RF_VOTE.map(([v, ic]) => { const n = t.items.filter(i => reflItem(t, i.id).v === v).map(i => { const w = v === -1 ? String(reflItem(t, i.id).why || '').trim() : ''; return esc(i.name || (TYPES[i.type] || TYPES.sonst)[0]) + (w ? ' (' + esc(w) + ')' : ''); }); return n.length ? `${ic} ${n.join(', ')}` : ''; }).filter(Boolean);
  if (ex.length) l.push(ex.join('<br>'));
  if (String(r.good || '').trim()) l.push(`<b>Hat funktioniert:</b> ${nl2br(r.good)}`);
  if (String(r.change || '').trim()) l.push(`<b>Nächstes Mal ändern:</b> ${nl2br(r.change)}`);
  return `<div class="card rfcard"><b>✎ Reflexion</b>${l.map(x => `<p class="small">${x}</p>`).join('')}</div>`;
}
// Anwesenheit (Schritt 1) und Reflexion (Schritt 2); Route /t/<id>/end/1 und /t/<id>/end/2
function viewEnd(t, step) {
  const tm = teamOf(t), pl = playersOf(tm), sub = esc(t.title || 'Ohne Titel');
  if (step === 1) {
    const body = !tm ? '<div class="card empty"><p>Dieses Training gehört zu keiner Mannschaft, darum gibt es keine Anwesenheitsliste.</p></div>'
      : !pl.length ? `<div class="card empty"><p>Für «${esc(tm.name)}» gibt es noch keine Spielerliste. Du kannst sie später bei der Mannschaft anlegen.</p></div>` : `<h2>Wer war da?</h2>${attBody(t, tm, pl)}`;
    return head('Training abschliessen', null, '', sub, ctxBar('end', 1)) + `<div class="muted small">${metaLine(t, true)}</div>${body}<button class="btn pri block" data-a="endNext">Weiter zur Reflexion ›</button>`;
  }
  const r = reflOf(t) || {}, b = rtpBlockOf(t), ziel = String((b && b.main && b.main.ziel) || t.ziel || '').replace(/^können /, ''), sp = (b && b.main && b.main.sp) || t.sp, prev = reflPrev(t);
  const scales = RF_SC.map(s => `<div class="rfs"><div><b>${esc(s.t)}</b> <span class="muted small" id="rfv-${s.k}">${reflScaleTxt(r, s) ? '· ' + esc(reflScaleTxt(r, s)) : ''}</span></div>
    <div class="scale">${[1, 2, 3, 4, 5].map(n => pk(+r[s.k] === n, `data-a="reflScale" data-k="${s.k}" data-v="${n}" aria-label="${esc(s.txt[n - 1])}"`, n, n === 3 ? 'mid' : '')).join('')}</div>
    <div class="scale-l small muted"><span>${esc(s.ends[0])}</span><span>${esc(s.ends[1])}</span><span>${esc(s.ends[2])}</span></div></div>`).join('');
  const rows = t.items.map(it => {
    const x = reflItem(t, it.id), ty = TYPES[it.type] || TYPES.sonst;
    return `<div class="rfx" style="--c:${ty[1]}"><div class="row"><span class="nm">${esc(it.name || ty[0])} <span class="muted small">${esc(it.min)}′</span></span><div class="pick3">${RF_VOTE.map(([v, ic, lab]) => pk(x.v === v, `data-a="reflVote" data-id="${esc(it.id)}" data-v="${v}" aria-label="${lab}"`, ic)).join('')}</div></div>
      <label class="rfwhy" ${x.v === -1 ? '' : 'hidden'}>Warum / was ändern?<textarea data-b="rf:why:${esc(it.id)}" rows="2">${esc(x.why || '')}</textarea></label></div>`;
  }).join('');
  const present = pl.filter(p => attOf(t)[p.id]), plist = present.length ? present : pl, pm = r.players && typeof r.players === 'object' ? r.players : {};
  const players = tm && pl.length ? `<details class="card rfpl" ${S.rfPl ? 'open' : ''}><summary><b>Spieler</b> <span class="muted small">optional – wer fiel auf?</span></summary>
    <p class="small muted">Für Gespräche und Beurteilung. Die Notizen bleiben auf deinem Gerät (und im Mannschaftsraum) und gehen beim Teilen nie mit.</p>
    ${plist.map(p => { const x = pm[p.id] && typeof pm[p.id] === 'object' ? pm[p.id] : {}; return `<div class="rfp"><div class="row"><span class="nm">${esc(pName(p))}</span><div class="pick3 wide">${pk(x.k === 'plus', `data-a="reflPl" data-id="${esc(p.id)}" data-k="plus"`, '⭐ Stark')}${pk(x.k === 'foerdern', `data-a="reflPl" data-id="${esc(p.id)}" data-k="foerdern"`, '🌱 Fördern')}</div></div>
      <label class="rfwhy" ${x.k ? '' : 'hidden'}>Notiz zu ${esc(p.first || pName(p))}<textarea data-b="rf:pn:${esc(p.id)}" rows="2">${esc(x.note || '')}</textarea></label></div>`; }).join('')}</details>` : '';
  return head('Training abschliessen', null, '', sub, ctxBar('end', 2)) + `<div class="muted small">${metaLine(t, true)}</div>
  ${prev && String(prev.refl.change || '').trim() ? `<div class="card rfprev small"><b>Dein Vorsatz vom letzten Mal:</b> ${esc(String(prev.refl.change).trim())}</div>` : ''}
  <div class="card"><h3 class="nomargin">Ziel erreicht?</h3>${ziel || sp ? `<p class="small rfz">${sp ? `<b>${esc(sp)}</b> – ` : ''}${ziel ? 'Die Spieler*innen können ' + esc(ziel) : ''}</p>` : ''}
    <div class="pick3">${RF_GOAL.map((l, i) => pk(r.goal === i, `data-a="reflGoal" data-v="${i}"`, l)).join('')}</div></div>
  <div class="card"><h3 class="nomargin">Wie war das Training?</h3>${scales}</div>
  ${t.items.length ? `<div class="card"><h3 class="nomargin">Übungen</h3><p class="small muted nomargin">Ein Tipp pro Übung. Das taucht bei der Übung wieder auf.</p>${rows}</div>` : ''}
  <div class="card"><label class="nomargin">Was hat funktioniert? (1 Satz)<textarea data-b="rf:good" rows="2" placeholder="z.B. Die Passübung lief flüssig, alle waren aktiv.">${esc(r.good || '')}</textarea></label>
    <label>Was ändere ich nächstes Mal? (1 konkreter Punkt)<textarea data-b="rf:change" rows="2" placeholder="z.B. Station 2 kleiner machen und mehr Pässe verlangen.">${esc(r.change || '')}</textarea></label></div>
  ${players}
  <div class="rfbar"><div class="rfprog" id="rfprog">${reflProg(t)}</div><button class="btn pri" data-a="reflSave">Speichern und abschliessen</button></div>`;
}
// Rückblick auf der Mannschaftsseite: letzte Reflexionen und Häufigkeiten
function rbCard(tm) {
  const ts = teamTrainings(tm).filter(reflDone).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (+b.refl.at || 0) - (+a.refl.at || 0)), last = ts.slice(0, 5), rec = ts.slice(0, 10);
  const freq = s => { const v = rec.map(t => +t.refl[s.k]).filter(n => n >= 1 && n <= 5); if (v.length < 3) return ''; const lo = v.filter(n => n <= 2).length, hi = v.filter(n => n >= 4).length, m = v.length - lo - hi, h = v.length / 2; const w = lo > h ? s.lo : hi > h ? s.hi : m > h ? s.mid : ''; return w ? `${s.s} meist ${w}` : ''; };
  const g = [0, 1, 2].map(i => [i, rec.filter(t => t.refl.goal === i).length]).filter(x => x[1]), fl = [...RF_SC.map(freq), g.length ? 'Ziel erreicht: ' + g.reverse().map(([i, n]) => RF_GOAL[i] + ' ' + n + '×').join(' · ') : ''].filter(Boolean);
  return `<details class="card tsec" data-k="rb" ${S.tsec.has('rb') ? 'open' : ''}><summary><b>Rückblick</b> <span class="muted small">${ts.length ? ts.length + (ts.length === 1 ? ' Reflexion' : ' Reflexionen') : 'noch keine Reflexion'}</span></summary>
    ${ts.length ? `${fl.length ? `<p class="small">${fl.map(esc).join('<br>')}</p>` : ''}${last.map(t => { const d = pd(t.date), r = t.refl, int = reflScaleTxt(r, RF_SC[0]), ch = String(r.change || '').trim(); return `<a class="rbrow" href="#/t/${t.id}/end/2"><span class="small muted">${WD[d.getDay()]}, ${dm(d)}</span> ${[[0, 1, 2].includes(r.goal) && 'Ziel: ' + RF_GOAL[r.goal], int && 'Intensität: ' + int].filter(Boolean).map(esc).join(' · ')}${ch ? `<div class="small">Ändern: ${esc(ch)}</div>` : ''}</a>`; }).join('')}`
      : '<p class="small muted">Nach dem Hallenmodus («Training beenden») oder über «Reflexion» bei einem vergangenen Training. Hier siehst du dann die letzten fünf Rückblicke und was sich wiederholt.</p>'}</details>`;
}

// ---------- Ansicht: Mehr ----------
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (location.hash === '#/more') render(); });
function viewMore() {
  return head('Mehr') + `
  <div class="card"><h2 class="nomargin">Teilen &amp; Sichern</h2><p class="small">Einzelne Trainings teilst du im Training über «Teilen» (Link, QR-Code oder Datei). Hier kannst du alle Daten auf einmal sichern oder auf ein anderes Gerät übertragen.${SYNC_ON ? ' Die Sicherungsdatei enthält dann auch die Zugangsschlüssel zu deinen Mannschaftsräumen – bewahre sie sicher auf und gib sie nicht weiter.' : ''}</p>
    <div class="row wrap"><button class="btn pri" data-a="expAll">Alles exportieren</button><button class="btn" data-a="impFile">Datei importieren</button><button class="btn" data-a="shareApp">App-Link teilen</button></div><input type="file" id="file" accept=".json,application/json" hidden></div>
  <div class="card"><h2 class="nomargin">Als App installieren</h2>${installEvt ? '<p><button class="btn pri" data-a="install">Jetzt installieren</button></p>' : ''}
    <ul class="small"><li><b>Android (Chrome):</b> Menü ⋮ → «App installieren» bzw. «Zum Startbildschirm hinzufügen»</li><li><b>iPhone (Safari):</b> Teilen-Symbol → «Zum Home-Bildschirm»</li></ul><p class="small muted">Nach dem ersten Öffnen funktioniert die App auch ohne Internet (z.B. in der Halle).</p></div>
  <div class="card"><h2 class="nomargin">Teilen und Datenschutz</h2><p class="small">Deine Daten liegen nur auf diesem Gerät, es gibt keinen Server und kein Konto. Wenn du ein Training oder eine Mannschaft teilst, geht eine Kopie weg, die sich danach nicht mehr abgleicht: Wer etwas ändert, muss neu teilen. Spielerlisten, J+S-Nummern, Anwesenheiten und Notizen zu Spielern (aus der Reflexion) gehören zu Kindern und bleiben auf dem Gerät. Sie gehen nur mit, wenn du beim Teilen einer Mannschaft ausdrücklich «Spielerliste mitgeben» wählst (Anwesenheiten und Spieler-Notizen nie), und sie sind in «Alles exportieren» enthalten, deiner eigenen Sicherung. Gib solche Dateien und Links nicht in Gruppenchats.</p>${SYNC_ON ? '<p class="small"><b>Mannschaftsraum:</b> Auf der Mannschaftsseite kannst du eine Mannschaft mit Co-Trainern abgleichen. Die Daten – auch Spielerliste, Anwesenheit und Reflexionen – liegen dann verschlüsselt auf einem Server, der nur Chiffretext sieht. Der Schlüssel steht nur im Einladungslink, nie auf dem Server: Wer den Link hat, hat Zugang zur Mannschaft. Mit «Zugang erneuern» sperrst du alle alten Links aus.</p>' : ''}</div>
  <div class="card"><h2 class="nomargin">Daten</h2><p class="small">${DB.trainings.length} Trainings · ${DB.custom.length} eigene Übungen · ${Object.keys(DB.notes).length} Notizen. Alles ist nur auf diesem Gerät gespeichert.</p><button class="btn danger" data-a="wipe">Alle Daten löschen</button></div>
  <div class="card"><h2 class="nomargin">Über</h2><p class="small">Struktur, Schwerpunkte, Ausbildungsziele, Trainingsformen und Athletik stammen aus den Rahmentrainingsplänen (RTP) von swiss unihockey (Stand ${esc(R.generated)}; U16/U18 «in Arbeit»). Beschreibungen, Skizzen und Videos der Trainingsformen gibt es im <a href="https://utp.swissunihockey.ch" target="_blank" rel="noopener">Unihockey-Trainingsplaner (UTP)</a>.</p><p class="small">Die Texte zu den Trainingsformen (Beschreibung, Keypoints, Coachingfragen, Rad der Variation) stammen aus dem Unihockey-Trainingsplaner (UTP): © swiss unihockey, Verwendung mit Einverständnis, nicht-kommerziell. Skizzen und Videos gibt es im UTP (Link bei jeder Übung).</p><p class="small">${esc(G.note)}</p></div>`;
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
const slim = t => { const c = JSON.parse(JSON.stringify(t)); delete c.att; delete c.reflSeen; if (c.refl && typeof c.refl === 'object') delete c.refl.players; c.items.forEach(i => { for (const k of ['desc', 'coach']) if (!i[k]) delete i[k]; }); return c; };   // Anwesenheit (t.att) und Spieler-Notizen der Reflexion (t.refl.players) bleiben auf dem Gerät
const saveBlob = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const download = (name, obj) => saveBlob(name, new Blob([JSON.stringify(obj)], { type: 'application/json' }));
const appUrl = () => location.origin + location.pathname;
async function shareTraining(t) {
  const tm = teamOf(t), m = tm ? [teamMeta(tm, false)] : [], data = { v: 1, t: [slim(t)], m }, url = appUrl() + '#i=' + await pack(data);
  const qr = qrSvg(url, 'Für einen QR-Code ist dieses Training zu umfangreich – nutze den Link oder die Datei.');
  S.share = { url, t, data, file: `training-${norm(t.title).replace(/ /g, '-')}.json`, text: 'Unihockey-Training: ' + t.title };
  modal(`<h2>«${esc(t.title)}» teilen</h2><p class="small">Die Empfängerin öffnet den Link oder scannt den Code – das Training wird in ihre App importiert. Es findet keine laufende Synchronisation statt; bei Änderungen einfach nochmals teilen.</p>
    <div class="qr">${qr}</div><div class="row wrap"><button class="btn pri" data-a="shNative">Teilen …</button><button class="btn" data-a="shCopy">Link kopieren</button><button class="btn" data-a="shFile">Als Datei</button><button class="btn" data-a="close">Schliessen</button></div>`);
}
function importData(d) {
  if (!d || !Array.isArray(d.t)) { toast('Keine gültigen Trainingsdaten'); return; }
  S.imp = d;
  const dup = d.t.filter(t => getT(t.id)).length, meta = {}; (d.m || []).forEach(m => { if (m && m.id) meta[m.id] = m; });
  const m0 = d.k === 'team' && d.m && d.m[0] && d.m[0].name ? d.m[0] : null;
  if (m0) {   // geteilte Mannschaft
    const byId = teamById(m0.id), byName = byId || teamByName(m0.name), np = Array.isArray(m0.players) ? m0.players.length : 0;
    modal(`<h2>Mannschaft importieren?</h2><p><b>${teamDot({ color: m0.color || '#6b7785' })}${esc(m0.name)}</b> <span class="muted small">${esc((stageById(m0.stage) || {}).name || '')}</span></p>
      <p class="small">${byId ? 'Diese Mannschaft hast du schon. Name, Trainingszeiten und Saison-Einstellung werden aktualisiert.' : byName ? 'Du hast schon eine Mannschaft mit diesem Namen. Ihre Einstellungen bleiben; Trainings und Spielerliste werden dort ergänzt.' : 'Die Mannschaft wird neu angelegt.'}</p>
      <ul class="small"><li>${d.t.length ? `${d.t.length} Training${d.t.length === 1 ? '' : 's'}${dup ? ` (${dup} schon vorhanden – werden durch die importierte Version ersetzt; deine Anwesenheiten dazu bleiben)` : ''}` : 'Keine Trainings'}</li>
      <li>${np ? `<b>Spielerliste enthalten:</b> ${np} Person${np === 1 ? '' : 'en'} (mit Namen und J+S-Nummern)${byName ? ', wird mit deiner Liste zusammengeführt' : ''}` : 'Keine Spielerliste enthalten'}</li>${d.c && d.c.length ? `<li>${d.c.length} eigene Übung${d.c.length === 1 ? '' : 'en'}</li>` : ''}</ul>
      <div class="row"><button class="btn pri" data-a="impOk">Importieren</button><button class="btn" data-a="close">Abbrechen</button></div>`);
    return;
  }
  const newTm = [...new Set(d.t.map(t => String(t.team || (meta[t.teamId] || {}).name || '').trim()).filter(n => n && !teamByName(n)))];
  modal(`<h2>Importieren?</h2><ul>${d.t.slice(0, 12).map(t => `<li>${esc(t.title)}${t.date ? ` <span class="muted small">${fmtDate(t.date)}</span>` : ''}</li>`).join('')}${d.t.length > 12 ? `<li>… und ${d.t.length - 12} weitere</li>` : ''}</ul>
    ${d.c && d.c.length ? `<p class="small">+ ${d.c.length} eigene Übungen und Notizen</p>` : ''}${d.sp && Object.keys(d.sp).length ? `<p class="small">+ Zugang zu ${Object.keys(d.sp).length} Mannschaftsraum${Object.keys(d.sp).length === 1 ? '' : 'räumen'} (aus deiner Sicherung)</p>` : ''}${newTm.length ? `<p class="small">Neue Mannschaft${newTm.length > 1 ? 'en' : ''} wird angelegt: ${newTm.map(n => '«' + esc(n) + '»').join(', ')}</p>` : ''}${dup ? `<p class="small warn">${dup} davon schon vorhanden – wird durch die importierte Version ersetzt.</p>` : ''}
    <div class="row"><button class="btn pri" data-a="impOk">Importieren</button><button class="btn" data-a="close">Abbrechen</button></div>`);
}
function doImport() {
  const d = S.imp; S.imp = null;
  const meta = {}, isTeam = d.k === 'team'; let shared = null;
  (d.m || []).forEach(m => {
    if (!m || !m.id || !m.name) return; meta[m.id] = m;
    let tm = teamById(m.id); const byId = !!tm; if (!tm) tm = teamByName(m.name);
    if (!tm) { tm = mkTeam(m.name, m.stage); Object.assign(tm, { color: m.color || tm.color, ort: m.ort || '', time: m.time || '', days: Array.isArray(m.days) ? m.days : tm.days, min: +m.min || 0, id: m.id }); tm.sessions = Array.isArray(m.sessions) ? m.sessions.map(s => ({ ...s })) : legacySessions(tm); if (isTeam && d.s && d.s[m.id]) DB.seasons[tm.id] = JSON.parse(JSON.stringify(d.s[m.id])); }
    else if (isTeam && byId) {   // schon vorhanden: Name, Stufe, Farbe, Ort, Trainingszeiten und Saison aktualisieren
      if (!DB.teams.some(x => x.id !== tm.id && x.name.trim().toLowerCase() === String(m.name).trim().toLowerCase())) tm.name = m.name;
      Object.assign(tm, { stage: m.stage || tm.stage, color: m.color || tm.color, ort: m.ort || '' }); if (Array.isArray(m.sessions)) tm.sessions = m.sessions.map(s => ({ ...s })); mirrorLegacy(tm);
      if (d.s && d.s[m.id]) DB.seasons[tm.id] = JSON.parse(JSON.stringify(d.s[m.id]));
      teamTrainings(tm).forEach(t => setTeam(t, tm));
    }
    if (Array.isArray(m.players)) mergePlayers(tm, m.players);
    if (isTeam && !shared) shared = tm;
  });
  if (d.s) for (const [id, cfg] of Object.entries(d.s)) if (teamById(id) && !DB.seasons[id] && cfg) DB.seasons[id] = JSON.parse(JSON.stringify(cfg));   // Datensicherung: Saison pro Mannschaft
  spImport(d.sp);
  if (d.season && !DB.season.set) DB.season = JSON.parse(JSON.stringify(d.season));
  for (const t of d.t) {
    if (!t.id || !Array.isArray(t.items)) continue; resolveTeam(t, meta);
    const i = DB.trainings.findIndex(x => x.id === t.id);
    if (i >= 0) { const o = DB.trainings[i]; if (!t.att && o.att) t.att = o.att; if (!t.jsType && o.jsType) t.jsType = o.jsType; if (o.refl && !t.refl) t.refl = o.refl; else if (o.refl && o.refl.players && t.refl && typeof t.refl === 'object' && !t.refl.players) t.refl.players = o.refl.players; if (o.reflSeen && !t.reflSeen) t.reflSeen = o.reflSeen; DB.trainings[i] = t; } else DB.trainings.push(t);   // eigene Anwesenheit bleibt erhalten
  }
  for (const c of d.c || []) { const i = DB.custom.findIndex(x => x.id === c.id); if (i >= 0) DB.custom[i] = c; else DB.custom.push(c); }
  if (d.n) DB.notes = { ...d.n, ...DB.notes };
  LIB = null; flush(); closeModal();
  if (shared) { toast(`«${shared.name}» importiert (${d.t.length} Training${d.t.length === 1 ? '' : 's'})`); go('/team/' + shared.id); return; }
  toast(`${d.t.length} Training(s) importiert`); go(d.t.length === 1 ? `/t/${d.t[0].id}` : '/');
}

// ---------- Mannschaftsraum: Abgleich mit Co-Trainern ----------
// Pro Mannschaft ein Raum auf dem Server (tools/supabase.sql). Der Inhalt wird auf dem Gerät mit AES-GCM verschlüsselt; der Schlüssel steht nur im Einladungslink (#j=Raum.Token.Schlüssel),
// der Server sieht nur Chiffretext. Lokal: DB.spaces[teamId] = { id, t (eigenes Token), k (Schlüssel), role 'o'|'w'|'r', o/w/r (nur Besitzer: Token), ver, last, hash, del: { t: {trainingId: ms}, p: {playerId: ms} } }.
// Raum-Inhalt (Klartext): { v: 1, team (mit players), trainings, season, custom, notes, del }. Zusammenführen: spMerge (rein lokal). Ohne SYNC_ON ist alles unsichtbar.
const SP_BAD = 'Dieser Link ist ungültig oder wurde erneuert – bitte den Haupttrainer um einen neuen Link.';
const SP_PRUNE = 400 * 864e5;   // Löschmarkierungen älter als rund 13 Monate verfallen
const SP_RANK = { r: 1, w: 2, o: 3 };
const SP_ROLE = { o: 'Besitzer', w: 'Co-Trainer', r: 'Nur lesen' };
const spOf = id => (DB.spaces && DB.spaces[id]) || null;
const spIds = () => SYNC_ON ? Object.keys(DB.spaces || {}).filter(id => teamById(id)) : [];
const spClone = x => JSON.parse(JSON.stringify(x));
const spSafe = k => typeof k === 'string' && k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
const spById = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const sj = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(sj).join(',') + ']' : '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + sj(v[k])).join(',') + '}';
const spRnd = n => crypto.getRandomValues(new Uint8Array(n));
const spErrObj = (msg, extra) => Object.assign(new Error(msg), extra);

// Verschlüsselung: 'e1.' + base64url(IV 12 Byte + Chiffretext), AES-GCM 256, neuer IV bei jedem Schreiben
const spKeys = new Map();
async function spKey(k) {
  if (!spKeys.has(k)) { const raw = unb64u(String(k)); if (raw.length !== 32) throw spErrObj('Schlüssel ungültig', { bad: true }); spKeys.set(k, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])); }
  return spKeys.get(k);
}
async function spEnc(k, obj) {
  const iv = spRnd(12), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await spKey(k), new TextEncoder().encode(JSON.stringify(obj)))), all = new Uint8Array(12 + ct.length);
  all.set(iv); all.set(ct, 12); return 'e1.' + b64u(all);
}
async function spDec(k, s) {
  try {
    if (typeof s !== 'string' || !s.startsWith('e1.')) throw 0;
    const all = unb64u(s.slice(3)); if (all.length < 29) throw 0;
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await spKey(k), all.slice(12))));
  } catch (e) { throw spErrObj('Entschlüsseln fehlgeschlagen', { bad: true }); }
}
async function spHash(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join(''); }

// Server (Supabase-RPC). Token und Schlüssel erscheinen nie in Meldungen.
async function spRpc(fn, params) {
  const r = await fetch(SYNCCFG.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SYNCCFG.key, Authorization: 'Bearer ' + SYNCCFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  let j = null; try { j = await r.json(); } catch (e) { /* ohne Antworttext */ }
  if (!r.ok) throw spErrObj(String((j && j.message) || 'HTTP ' + r.status).slice(0, 160), { status: r.status });
  return j;
}
function spErr(e) {
  const m = e && e.message || '';
  if (e && (e.bad || (e.status === 400 && m === 'kein zugriff'))) return { state: 'bad', msg: SP_BAD };
  if (e instanceof TypeError) return { state: 'off', msg: 'Offline – wird abgeglichen, sobald Internet da ist' };
  if (m === 'zu gross') return { state: 'err', msg: 'Fehler: Die Mannschaft ist für den Abgleich zu gross.' };
  if (m === 'kein schreibrecht') return { state: 'err', msg: 'Fehler: Mit diesem Zugang darfst du nur lesen.' };
  if (m === 'limit erreicht') return { state: 'err', msg: 'Fehler: Der Server hat sein Limit erreicht.' };
  if (m === 'nur besitzer') return { state: 'err', msg: 'Fehler: Das darf nur der Haupttrainer.' };
  return { state: 'err', msg: 'Fehler: ' + (m || 'unbekannt') };
}

// Inhalt eines Raums aus dem lokalen Stand (Klartext)
const SP_SEASON = s => { if (!s || typeof s !== 'object') return null; const c = spClone(s); delete c.start; delete c.days; return c; };   // start/days werden lokal neu berechnet
function spContent(tm, sp) {
  const ts = teamTrainings(tm).map(t => ({ ...spClone(t), teamId: tm.id, team: tm.name })), c = [], n = {}, seen = new Set();
  ts.forEach(t => t.items.forEach(it => { const cx = customOf(it); if (cx && !seen.has(cx.id)) { seen.add(cx.id); c.push(spClone(cx)); } for (const k of [it.lib, matNoteKey(it)]) if (k && DB.notes[k]) n[k] = spClone(DB.notes[k]); }));
  const d = (sp && sp.del) || {};
  return { v: 1, team: spClone(tm), trainings: ts, season: SP_SEASON(DB.seasons && DB.seasons[tm.id]), custom: c, notes: n, del: { t: { ...d.t }, p: { ...d.p } } };
}
function spNorm(c) {
  const t = (c && c.team) || {}, d = (c && c.del) || {};
  return { v: 1, team: { ...t, players: [...(Array.isArray(t.players) ? t.players : [])].sort(spById) }, trainings: [...(c.trainings || [])].sort(spById), season: SP_SEASON(c.season), custom: [...(c.custom || [])].sort(spById), notes: c.notes && typeof c.notes === 'object' ? c.notes : {}, del: { t: { ...d.t }, p: { ...d.p } } };
}
const spCanon = c => sj(spNorm(c));

// Zusammenführen (rein lokal). rm = entschlüsselter Server-Inhalt oder null. Gibt zurück, ob sich der lokale Stand geändert hat.
// Trainings, Spieler, Übungen, Merkzettel: der neuere Zeitstempel (updated bzw. u) gewinnt, bei Gleichstand der grössere kanonische Text (damit beide Seiten gleich entscheiden).
// Gelöscht-Markierung (del) gewinnt gegen einen Eintrag mit kleinerem Zeitstempel. Mannschaftseinstellungen und Saison: grösseres tm.u gewinnt. Rolle «nur lesen»: der Server gewinnt immer.
const spWins = (l, r, ul, ur) => ur !== ul ? ur > ul : sj(r) > sj(l);
function spMerge(tm, sp, rm) {
  const ro = sp.role === 'r', now = Date.now(), before = spCanon(spContent(tm, sp)), od = (rm && rm.del) || {}, del = { t: {}, p: {} };
  for (const kind of ['t', 'p']) for (const src of [sp.del && sp.del[kind], od[kind]]) for (const [id, ms] of Object.entries(src || {})) { if (!spSafe(id) || !(+ms > 0) || +ms < now - SP_PRUNE) continue; del[kind][id] = Math.max(del[kind][id] || 0, +ms); }
  sp.del = del;
  if (rm) {
    // Trainings
    const seenT = new Set();
    for (const r0 of Array.isArray(rm.trainings) ? rm.trainings : []) {
      if (!r0 || !spSafe(r0.id) || !Array.isArray(r0.items)) continue; seenT.add(r0.id);
      const r = { ...spClone(r0), teamId: tm.id, team: tm.name }, ur = +r.updated || 0;
      if ((del.t[r.id] || 0) > ur) continue;
      const l = getT(r.id), i = DB.trainings.indexOf(l);
      if (!l) DB.trainings.push(r);
      else if (ro) DB.trainings[i] = r;
      else if ((teamOf(l) || {}).id !== tm.id) del.t[r.id] = Math.max(del.t[r.id] || 0, now);   // liegt hier in einer anderen Mannschaft: im Raum als verschoben markieren
      else if (spWins({ ...l, teamId: tm.id, team: tm.name }, r, +l.updated || 0, ur)) DB.trainings[i] = r;
    }
    DB.trainings = DB.trainings.filter(l => (teamOf(l) || {}).id !== tm.id || ((ro ? seenT.has(l.id) : true) && (del.t[l.id] || 0) <= (+l.updated || 0)));
    // Spieler
    const rp = (rm.team && Array.isArray(rm.team.players)) ? rm.team.players : [];
    if (ro) tm.players = rp.filter(p => p && spSafe(p.id)).map(p => cleanPlayer(p));
    else {
      const list = [...playersOf(tm)];
      for (const r0 of rp) { if (!r0 || !spSafe(r0.id)) continue; const r = cleanPlayer(r0), i = list.findIndex(x => x.id === r.id); if (i < 0) list.push(r); else if (spWins(list[i], r, +list[i].u || 0, +r.u || 0)) list[i] = r; }
      const had = Array.isArray(tm.players); tm.players = list.filter(p => (del.p[p.id] || 0) <= (+p.u || 0)); if (!had && !tm.players.length) delete tm.players;
    }
    // Mannschaftseinstellungen und Saison
    const strip = t => { const c = spClone(t || {}); delete c.players; return c; }, lt = strip(tm), rs = strip(rm.team), lsea = SP_SEASON(DB.seasons && DB.seasons[tm.id]), rsea = SP_SEASON(rm.season);
    if (rs.id === tm.id) {
      const lu = +lt.u || 0, ru = +rs.u || 0, rw = ro || (ru !== lu ? ru > lu : (!!rsea !== !!lsea ? !!rsea : sj([rs, rsea]) > sj([lt, lsea])));
      if (rw) {
        const pl = tm.players; Object.keys(tm).forEach(k => delete tm[k]); Object.assign(tm, rs); if (pl) tm.players = pl;
        if (!DB.seasons) DB.seasons = {};
        if (rsea) DB.seasons[tm.id] = rsea; else if (ro) delete DB.seasons[tm.id];
      }
    }
    // Eigene Übungen und Merkzettel: vereinigen (bei gleichem Eintrag der neuere)
    for (const c of Array.isArray(rm.custom) ? rm.custom : []) { if (!c || !spSafe(c.id)) continue; const i = DB.custom.findIndex(x => x.id === c.id); if (i < 0) DB.custom.push(spClone(c)); else if (ro || spWins(DB.custom[i], c, +DB.custom[i].u || 0, +c.u || 0)) DB.custom[i] = spClone(c); }
    for (const [k, v] of Object.entries(rm.notes && typeof rm.notes === 'object' ? rm.notes : {})) { if (!spSafe(k) || !v || typeof v !== 'object') continue; const l = DB.notes[k]; if (!l || ro || spWins(l, v, +l.u || 0, +v.u || 0)) DB.notes[k] = spClone(v); }
  }
  DB.trainings.forEach(t => { if (t.teamId === tm.id) t.team = tm.name; });
  LIB = null;
  return before !== spCanon(spContent(tm, sp));
}

// Ablauf: Server lesen, entschlüsseln, zusammenführen, bei Unterschied hochladen (Versionskonflikt: neu lesen, bis zu 3 Versuche). Immer nur ein Vorgang gleichzeitig (spLock).
const spLock = fn => { const p = SP.chain.then(fn); SP.chain = p.catch(() => { }); return p; };
function spSync(id) {
  if (SP.pend.has(id)) return SP.pend.get(id);
  const p = spLock(() => { SP.pend.delete(id); return spSyncInner(id); }); SP.pend.set(id, p); return p;
}
async function spSyncInner(id) {
  const sp = spOf(id), tm = teamById(id); if (!sp || !tm) return false;
  const set = (state, msg, changed) => { SP.st[id] = { state, msg }; spPaint(); if (changed) spRender(); };
  if (!navigator.onLine) { const e = spErr(new TypeError()); set(e.state, e.msg); return false; }
  try {
    for (let n = 0; n < 3; n++) {
      const row = (await spRpc('space_get', { p_id: sp.id, p_t: sp.t }))[0]; if (!row) throw spErrObj('kein zugriff', { status: 400 });
      sp.role = row.role;
      const h0 = await spHash(spCanon(spContent(tm, sp)));
      if (n === 0 && row.ver === sp.ver && h0 === sp.hash) { sp.last = new Date().toISOString(); flush(); set('ok'); return true; }   // nichts Neues auf beiden Seiten
      const rm = row.data ? await spDec(sp.k, row.data) : null;
      if (rm && (rm.v !== 1 || !rm.team || rm.team.id !== tm.id)) throw spErrObj('Dieser Raum passt nicht zu dieser Mannschaft oder braucht eine neuere App.');
      const changed = spMerge(tm, sp, rm), mine = spContent(tm, sp), canon = spCanon(mine);
      if (changed) flush();
      if (sp.role === 'r' || (rm && canon === spCanon(rm))) { sp.ver = row.ver; sp.hash = await spHash(canon); sp.last = new Date().toISOString(); flush(); set('ok', '', changed); return true; }
      const put = (await spRpc('space_put', { p_id: sp.id, p_t: sp.t, p_data: await spEnc(sp.k, mine), p_ver: row.ver }))[0];
      if (put && put.ok) { sp.ver = put.ver; sp.hash = await spHash(canon); sp.last = new Date().toISOString(); flush(); set('ok', '', changed); return true; }
    }
    throw spErrObj('Gleichzeitige Änderungen – bitte später nochmals abgleichen');
  } catch (e) { const x = spErr(e); set(x.state, x.msg); return false; }
}
function spAuto() { if (!SYNC_ON) return; for (const id of spIds()) if (!(SP.st[id] && SP.st[id].state === 'bad')) spSync(id); }
function spDirty() { if (!SYNC_ON || !DB.spaces || !Object.keys(DB.spaces).length) return; clearTimeout(SP.t); SP.t = setTimeout(spAuto, 3000); }
function spRender() {   // nach einem Abgleich mit neuen Daten die Ansicht auffrischen – aber nicht mitten in einer Eingabe und nicht im Hallenmodus
  const a = document.activeElement;
  if (location.hash.endsWith('/run') || (a && a.closest && a.closest('#app') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
  render();
}
function spStatus(id) {
  const sp = spOf(id), st = SP.st[id] || {};
  const ago = () => { const m = Math.max(0, Math.round((Date.now() - Date.parse(sp.last)) / 6e4)); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : `vor ${Math.round(m / 1440)} Tg.`; };
  if (st.state === 'run') return 'Gleicht ab …';
  if (st.state === 'bad') return 'Link ungültig oder erneuert – bitte den Haupttrainer um einen neuen Link.';
  if (st.state === 'off' || st.state === 'err') return st.msg + (sp.last ? ` (zuletzt abgeglichen ${ago()})` : '');
  return sp.last ? 'Abgeglichen ' + ago() : 'Noch nicht abgeglichen';
}
function spPaint() { document.querySelectorAll('[data-spst]').forEach(el => { if (spOf(el.dataset.spst)) el.textContent = spStatus(el.dataset.spst); }); }

// Löschmarkierung (für abgeglichene Mannschaften): kind 't' Training, 'p' Spieler; undo = wieder entfernen
function spDel(kind, tmId, ids, undo) {
  const sp = SYNC_ON && tmId && spOf(tmId); if (!sp || sp.role === 'r') return;
  sp.del = sp.del || { t: {}, p: {} }; const d = sp.del[kind] = sp.del[kind] || {};
  for (const id of [].concat(ids)) { if (undo) delete d[id]; else d[id] = Date.now(); }
}

// Mannschaft nur lesen? (Ansicht der Mannschaft, des Trainings oder der Saison)
function roTeam() {
  if (!SYNC_ON || !DB.spaces) return null;
  const p = location.hash.slice(1).split('/').filter(Boolean).map(decodeURIComponent); let tm = null;
  if (p[0] === 't' && !['run', 'view'].includes(p[2])) { const t = getT(p[1]); tm = t && teamOf(t); }
  else if (p[0] === 'team' && p[1] && p[1] !== 'new') tm = teamById(p[1]);
  else if (p[0] === 'season') tm = teamById(S.team);
  const sp = tm && spOf(tm.id); return sp && sp.role === 'r' ? tm : null;
}
const RO_A = new Set(['newT', 'mv', 'delI', 'dupI', 'addI', 'addG', 'pick', 'dupT', 'delT', 'attTog', 'attAll', 'attNone', 'plAdd', 'plEdit', 'plBulk', 'planOpen', 'sBlock', 'sNew', 'sDay', 'sHol', 'swNew', 'saveTeam', 'delTeam', 'mAddS', 'mDelS', 'mColor', 'flow', 'reflGoal', 'reflScale', 'reflVote', 'reflPl', 'reflSave', 'reflSeen']);
function roApply() {
  const tm = roTeam(); if (!tm) return;
  const app = $('#app'); app.querySelectorAll('[data-b]').forEach(e => e.disabled = true); app.querySelectorAll('[data-a]').forEach(e => { if (RO_A.has(e.dataset.a)) e.disabled = true; });
  const h = $('#app header.top'), html = '<div class="card rotop">🔒 Nur lesen – Änderungen macht der Haupttrainer</div>';
  if (h) h.insertAdjacentHTML('afterend', html); else app.insertAdjacentHTML('afterbegin', html);
}

// Oberfläche: Karte auf der Mannschaftsseite
function spCard(tm) {
  if (!SYNC_ON) return '';
  const sp = spOf(tm.id), id = esc(tm.id);
  if (!sp) return `<div class="card spcard"><b>🔄 Mit Co-Trainern abgleichen</b><p class="small">Alle, die deinen Einladungslink haben, sehen dieselben Daten dieser Mannschaft – auch wenn jemand etwas ändert. Die Daten liegen verschlüsselt auf einem Server, der Server sieht keine Namen. Spielerliste, Anwesenheit und Reflexionen (auch Notizen zu Spielern) gehen mit.</p><button class="btn pri" data-a="spSetup" data-k="${id}">Mannschaftsraum einrichten</button></div>`;
  const o = sp.role === 'o';
  return `<div class="card spcard"><div class="row"><b>🔄 Abgleich mit Co-Trainern</b><span class="chip">${esc(SP_ROLE[sp.role] || '')}</span></div><div class="small" data-spst="${id}">${esc(spStatus(tm.id))}</div>
    <div class="row wrap"><button class="btn" data-a="spNow" data-k="${id}">Jetzt abgleichen</button>${o ? `<button class="btn" data-a="spInvite" data-k="${id}" data-r="w">Co-Trainer einladen</button><button class="btn" data-a="spInvite" data-k="${id}" data-r="r">Nur-Lesen-Link</button>` : `<button class="btn" data-a="spLeave" data-k="${id}">Abgleich beenden</button>`}</div>
    ${o ? `<div class="row wrap"><button class="btn" data-a="spRenew" data-k="${id}">Zugang erneuern</button><button class="btn danger" data-a="spDissolve" data-k="${id}">Raum auflösen</button></div>` : ''}</div>`;
}
const spLink = (sp, kind) => appUrl() + '#j=' + [sp.id, sp[kind], sp.k].join('.');
function spInviteModal(id, kind, renewed) {
  const tm = teamById(id), sp = spOf(id), url = spLink(sp, kind), w = kind === 'w';
  S.share = { url, t: { title: tm.name }, data: null, file: '', text: 'Unihockey-Trainingsplaner, Mannschaftsraum: ' + tm.name };
  modal(`<h2>${w ? 'Co-Trainer einladen' : 'Nur-Lesen-Link'}</h2>
    <p class="small">${w ? `Wer diesen Link öffnet, sieht und ändert die Daten von «${esc(tm.name)}» – wie du.` : `Wer diesen Link öffnet, sieht die Daten von «${esc(tm.name)}», kann sie aber nicht ändern.`}</p>
    <div class="warnbox"><b>Wichtig:</b> Der Link ist ein Schlüssel zur Mannschaft, mit Namen von Kindern. Schicke ihn nur einzeln an die Co-Trainer, nicht in Gruppenchats und nicht öffentlich.</div>
    ${renewed ? '<div class="warnbox"><b>Zugang erneuert.</b> Alle bisherigen Links funktionieren nicht mehr. Schicke jetzt allen den neuen Link, auch den Nur-Lesen-Link.</div>' : ''}
    <div class="qr">${qrSvg(url, 'Für einen QR-Code ist der Link zu lang – nutze «Link kopieren».')}</div>
    <div class="row wrap"><button class="btn pri" data-a="shNative">Teilen …</button><button class="btn" data-a="shCopy">Link kopieren</button><button class="btn" data-a="spInvite" data-k="${esc(id)}" data-r="${w ? 'r' : 'w'}">${w ? 'Nur-Lesen-Link' : 'Co-Trainer-Link'}</button><button class="btn" data-a="close">Schliessen</button></div>`);
}
function spInfoModal(title, text) { modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row"><button class="btn pri" data-a="close">Schliessen</button></div>`); }

// Raum einrichten / Beitreten / Zugang erneuern
function spSetup(id) {
  const tm = teamById(id); if (!tm || spOf(id)) return Promise.resolve(false);
  return spLock(async () => {
    const sp = { id: b64u(spRnd(16)), t: '', k: b64u(spRnd(32)), role: 'o', o: b64u(spRnd(24)), w: b64u(spRnd(24)), r: b64u(spRnd(24)), ver: 1, last: '', hash: '', del: { t: {}, p: {} } };
    sp.t = sp.o; const c = spContent(tm, sp);
    await spRpc('space_create', { p_id: sp.id, p_o: sp.o, p_w: sp.w, p_r: sp.r, p_data: await spEnc(sp.k, c) });
    sp.hash = await spHash(spCanon(c)); sp.last = new Date().toISOString(); if (!DB.spaces) DB.spaces = {}; DB.spaces[id] = sp; SP.st[id] = { state: 'ok' }; flush(); return true;
  });
}
async function spJoinOpen(v) {
  if (!SYNC_ON) return spInfoModal('Mannschaftsraum beitreten', 'Abgleich ist in dieser App noch nicht eingerichtet.');
  const [id, t, k] = String(v).split('.');
  if (!id || !t || !k || !/^[\w-]+$/.test(id + t + k)) return spInfoModal('Mannschaftsraum beitreten', SP_BAD);
  try {
    const row = (await spRpc('space_get', { p_id: id, p_t: t }))[0]; if (!row) throw spErrObj('kein zugriff', { status: 400 });
    const rm = await spDec(k, row.data);
    if (!rm || rm.v !== 1 || !rm.team || !spSafe(rm.team.id) || !rm.team.name) throw spErrObj('Raum unlesbar', { bad: true });
    const ex = spOf(rm.team.id), tm = teamById(rm.team.id), nT = (rm.trainings || []).length, nP = (rm.team.players || []).length;
    S.join = { id, t, k, role: row.role, rm };
    let note = '', can = true;
    if (ex && ex.id !== id) { note = 'Diese Mannschaft ist auf diesem Gerät schon mit einem anderen Raum verbunden. Beende dort zuerst den Abgleich.'; can = false; }
    else if (ex && SP_RANK[ex.role] > SP_RANK[row.role]) { note = ex.role === 'o' ? 'Das ist dein eigener Raum – du musst nicht beitreten.' : 'Du hast schon einen Zugang mit mehr Rechten.'; can = false; }
    else if (tm) note = row.role === 'r' ? 'Diese Mannschaft hast du schon. Deine Fassung wird durch den Stand des Haupttrainers ersetzt.' : 'Diese Mannschaft hast du schon. Die Daten werden zusammengeführt.';
    modal(`<h2>Mannschaftsraum beitreten</h2><p><b>${esc(rm.team.name)}</b> <span class="muted small">${esc((stageById(rm.team.stage) || {}).name || '')}</span></p>
      <ul class="small"><li>Deine Rolle: <b>${esc(SP_ROLE[row.role] || '')}</b>${row.role === 'r' ? ' (Änderungen sind gesperrt)' : ''}</li><li>${nT} Training${nT === 1 ? '' : 's'}, ${nP} Person${nP === 1 ? '' : 'en'} in der Spielerliste</li></ul>
      ${note ? `<p class="small ${can ? '' : 'warn'}">${esc(note)}</p>` : ''}<p class="small muted">Die Daten werden auf diesem Gerät gespeichert und bei Änderungen automatisch abgeglichen.</p>
      <div class="row wrap">${can ? '<button class="btn pri" data-a="spJoinOk">Beitreten</button>' : ''}<button class="btn" data-a="close">${can ? 'Abbrechen' : 'Schliessen'}</button></div>`);
  } catch (e) { const x = spErr(e); spInfoModal('Mannschaftsraum beitreten', x.state === 'off' ? 'Keine Verbindung zum Server. Öffne den Link nochmals, wenn du Internet hast.' : x.msg); }
}
async function spJoinDo() {
  const j = S.join; S.join = null; closeModal(); if (!j) return;
  const tid = j.rm.team.id, ex = spOf(tid); let created = null;
  await spLock(async () => {
    let tm = teamById(tid);
    if (!tm) { tm = created = { id: tid, name: '', stage: j.rm.team.stage || DB.stage, color: j.rm.team.color || TEAM_COLORS[0], ort: '', sessions: [], u: -1 }; DB.teams.push(tm); }
    if (!DB.spaces) DB.spaces = {};
    DB.spaces[tid] = { id: j.id, t: j.t, k: j.k, role: j.role, ver: 0, last: '', hash: '', del: ex && ex.id === j.id && ex.del ? ex.del : { t: {}, p: {} } };
    if (j.role === 'o') DB.spaces[tid].o = j.t;
    const ok = await spSyncInner(tid);
    if (!ok && created) { DB.teams = DB.teams.filter(x => x !== created); delete DB.spaces[tid]; flush(); }
    else if (!ok && ex) { DB.spaces[tid] = ex; flush(); }
  });
  if (teamById(tid) && spOf(tid)) { toast('Mannschaftsraum beigetreten'); go('/team/' + tid); } else toast('Beitritt fehlgeschlagen – bitte später nochmals versuchen');
}
function spRenewDo(id) {
  return spLock(async () => {
    const sp = spOf(id), tm = teamById(id); if (!sp || sp.role !== 'o') return false;
    if (!(await spSyncInner(id))) return false;
    const nk = b64u(spRnd(32)), nw = b64u(spRnd(24)), nr = b64u(spRnd(24)), c = spContent(tm, sp);
    const ver = await spRpc('space_rekey', { p_id: sp.id, p_o: sp.o, p_w: nw, p_r: nr, p_data: await spEnc(nk, c) });
    Object.assign(sp, { k: nk, w: nw, r: nr, ver: +ver, hash: await spHash(spCanon(c)), last: new Date().toISOString() }); SP.st[id] = { state: 'ok' }; flush(); return true;
  });
}
const spU = id => { const tm = teamById(id); if (tm) tm.u = Date.now(); };   // Mannschaftseinstellung/Saison geändert (Zeitstempel fürs Zusammenführen)
const SPID = /^[\w-]{16,}$/;
function spImport(sp) {   // Datensicherung: Zugänge zu Mannschaftsräumen wiederherstellen (nur für vorhandene Mannschaften ohne eigenen Zugang)
  for (const [id, v] of Object.entries(sp && typeof sp === 'object' ? sp : {})) {
    if (!spSafe(id) || !teamById(id) || spOf(id) || !v || !SPID.test(v.id) || !SPID.test(v.t) || !SPID.test(v.k) || !SP_RANK[v.role]) continue;
    const e = { id: v.id, t: v.t, k: v.k, role: v.role, ver: 0, last: '', hash: '', del: { t: {}, p: {} } };
    for (const x of ['o', 'w', 'r']) if (SPID.test(v[x])) e[x] = v[x];
    for (const kind of ['t', 'p']) for (const [i, ms] of Object.entries((v.del || {})[kind] || {})) if (spSafe(i) && +ms > 0) e.del[kind][i] = +ms;
    if (!DB.spaces) DB.spaces = {}; DB.spaces[id] = e;
  }
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
  if (h.startsWith('j=')) { const jv = h.slice(2); history.replaceState(null, '', location.pathname + location.search + '#/'); spJoinOpen(jv); return render(); }
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
    if (t) { const tmx = teamOf(t), spx = SYNC_ON && tmx && spOf(tmx.id); if (!(spx && spx.role === 'r')) swEnsure(t); }   // Swiss-Way-Beschreibung erzeugen (nicht bei «Nur lesen»)
    if (!t) html = head('Training', '/') + '<p class="muted center">Training nicht gefunden.</p>';
    else if (p[2] === 'run') { html = viewRun(t); run = true; } else if (p[2] === 'view') html = viewRead(t); else if (p[2] === 'att') html = viewAtt(t); else if (p[2] === 'end') html = viewEnd(t, +p[3] === 2 ? 2 : 1); else html = viewEdit(t);
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
  if (!run && S.run) { S.run = null; runKeep(); wakeLock(false); }
  document.body.classList.toggle('running', run);
  $('#app').innerHTML = html; roApply();
  const cb = $('.crumbs'); if (cb) cb.scrollLeft = cb.scrollWidth;   // Brotkrumen: bei Platzmangel die aktuelle Seite (rechts) sichtbar machen
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
  swNew(el) {   // Swiss Way Warm-up: andere Auswahl der Übungen, mit Rückgängig
    const t = curT(), it = t && t.items.find(x => x.id === el.dataset.id); if (!it) return;
    const old = { desc: it.desc, sw: it.sw }; swFill(it, t, Math.floor(Math.random() * 1e6)); touch(t); render();
    toast('Andere Auswahl erstellt', 'Rückgängig', () => { it.desc = old.desc; if (old.sw) it.sw = old.sw; else delete it.sw; touch(t); render(); });
  },
  crumbStage(el) { DB.stage = el.dataset.k; save(); },   // Brotkrumen «RTP › D-Junioren»: Stufe merken, der Link öffnet die Stufenübersicht
  calNav(el) { const c = S.cal, d = new Date(c.y, c.m + +el.dataset.d, 1); c.y = d.getFullYear(); c.m = d.getMonth(); c.day = ''; render(); },
  calToday() { const n = new Date(); S.cal = { ...(S.cal || {}), y: n.getFullYear(), m: n.getMonth(), day: iso(n) }; render(); },
  calDay(el) { const c = S.cal, d = pd(el.dataset.d); c.day = el.dataset.d; c.y = d.getFullYear(); c.m = d.getMonth(); render(); },
  calTeam(el) { S.team = el.dataset.k; go('/cal'); },   // z. B. «Kalender» auf der Mannschaftsseite
  newT(el) { S.seed = { team: el.dataset.team || '', date: el.dataset.date || '' }; go('/new'); },
  flow(el) { const k = el.dataset.k; if (k === 'blank') return A.blankT(); S.flow = { k, ...S.seed }; const tm = teamById(S.seed.team); if (tm) { if (k === 'rtp') DB.stage = tm.stage; else S.team = tm.id; save(); } go(k === 'rtp' ? '/rtp' : '/season'); },
  flowCancel() { S.flow = null; S.seed = { team: '', date: '' }; go('/'); },
  mColor(el) { S.mf.color = el.dataset.k; document.querySelectorAll('[data-a=mColor]').forEach(b => b.classList.toggle('sel', b === el)); },
  mAddS() {
    const f = S.mf, used = new Set(f.sessions.map(x => x.wd)), last = f.sessions[f.sessions.length - 1] || {}, wd = [2, 4, 5, 1, 3, 6, 0].find(d => !used.has(d));
    f.sessions.push({ id: uid(), wd: wd ?? 2, time: last.time || '', min: last.min || (stageById(f.stage) || {}).minutes || 0, ort: last.ort || '' }); render();
  },
  mDelS(el) { S.mf.sessions = S.mf.sessions.filter(x => x.id !== el.dataset.id); render(); },
  teamSeason(el) { S.team = el.dataset.k; render.seasonScrolled = false; go('/season'); },
  saveTeam() {
    const f = S.mf, name = f.name.trim(); if (!name) return toast('Bitte einen Namen eingeben');
    if (DB.teams.some(x => x.id !== f.id && x.name.trim().toLowerCase() === name.toLowerCase())) return toast('Diese Mannschaft gibt es schon');
    const vals = { name, stage: f.stage, color: f.color, ort: f.ort.trim(), sessions: f.sessions.map(x => ({ id: x.id, wd: +x.wd, time: x.time || '', min: +x.min || 0, ort: String(x.ort || '').trim() })) }; let tm;
    if (f.id) { tm = teamById(f.id); const mine = teamTrainings(tm); Object.assign(tm, vals); mine.forEach(t => setTeam(t, tm)); }
    else { tm = { id: uid(), ...vals }; DB.teams.push(tm); }
    mirrorLegacy(tm); tm.u = Date.now();
    S.mf = null; save(); done(f.id ? `Mannschaft «${name}» gespeichert.` : `Mannschaft «${name}» angelegt – plane jetzt das erste Training.`, `/team/${tm.id}`);
  },
  delTeam(el) {
    const tm = teamById(el.dataset.id), n = teamTrainings(tm).length;
    modal(`<h2>«${esc(tm.name)}» löschen?</h2><p>${n ? `Die Mannschaft hat ${n} Training${n > 1 ? 's' : ''}. Was soll damit geschehen?` : 'Die Mannschaft hat keine Trainings.'}</p>${spOf(tm.id) ? '<p class="small warn">Diese Mannschaft ist mit einem Mannschaftsraum verbunden. Auf diesem Gerät endet der Abgleich' + (spOf(tm.id).role === 'o' ? '; den Raum auf dem Server löschst du vorher mit «Raum auflösen».' : '.') + '</p>' : ''}<div class="col"><button class="btn danger" data-a="delTeamDo" data-id="${tm.id}" data-m="keep">Nur die Mannschaft löschen${n ? ' – Trainings bleiben, ohne Mannschaft' : ''}</button>${n ? `<button class="btn danger" data-a="delTeamDo" data-id="${tm.id}" data-m="all">Mannschaft und ${n} Training${n > 1 ? 's' : ''} löschen</button>` : ''}<button class="btn" data-a="close">Abbrechen</button></div><p class="small muted">Direkt danach kannst du es noch rückgängig machen.</p>`);
  },
  delTeamDo(el) {
    closeModal(); const tm = teamById(el.dataset.id), mine = teamTrainings(tm), prev = mine.map(t => [t, t.team, t.teamId]), cfg = DB.seasons[tm.id], idx = DB.teams.indexOf(tm), all = el.dataset.m === 'all';
    const spx = spOf(tm.id); if (spx) delete DB.spaces[tm.id];
    DB.teams.splice(idx, 1); delete DB.seasons[tm.id];
    if (all) { const ids = new Set(mine.map(t => t.id)); DB.trainings = DB.trainings.filter(t => !ids.has(t.id)); } else mine.forEach(t => setTeam(t, null));
    if (S.team === tm.id) S.team = ''; save(); go('/teams');
    toast(all ? `«${tm.name}» und ${mine.length} Trainings gelöscht` : `«${tm.name}» gelöscht – ${mine.length} Trainings bleiben ohne Mannschaft`, 'Rückgängig', () => { DB.teams.splice(idx, 0, tm); if (cfg) DB.seasons[tm.id] = cfg; if (spx) DB.spaces[tm.id] = spx; if (all) DB.trainings.push(...mine); else prev.forEach(([t, tn, ti]) => { t.team = tn; t.teamId = ti; }); save(); render(); });
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
  dupT() { const t = curT(), c = JSON.parse(JSON.stringify(t)); c.id = uid(); delete c.att; delete c.refl; delete c.reflSeen; c.title += ' (Kopie)'; c.items.forEach(i => i.id = uid()); c.updated = Date.now(); DB.trainings.push(c); save(); toast('Dupliziert'); go(`/t/${c.id}`); },
  delT() { const t = curT(); removeTrainings([t]); go('/'); },
  toastAct() { const fn = toast.fn; toast.fn = null; $('#toast').className = ''; fn && fn(); },
  teamF(el) { S.team = el.dataset.k; render.seasonScrolled = false; render(); },
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
  grpShift(el) { closeModal(); DB.trainings.forEach(t => { if (grpKey(t) === el.dataset.k && t.date) { t.date = iso(addDays(pd(t.date), +el.dataset.d)); t.updated = Date.now(); } }); save(); toast('Verschoben'); render(); },
  sBlock(el) { openPlan({ team: S.team, stage: seasonCfg().stage, block: el.dataset.k, mode: 'season' }); },
  planOpen(el) { const d = el.dataset; let team = d.team || ''; if (!team && d.auto) { const l = DB.teams.filter(x => x.stage === d.s); if (l.length === 1) team = l[0].id; } openPlan({ team, stage: d.s || (teamById(team) || {}).stage || '', block: d.b2, mode: d.mode || (d.b2 ? 'season' : 'own') }); },
  planMode(el) { const P = S.plan; P.mode = el.dataset.k; if (P.mode === 'own' && !P.start) P.start = iso(new Date()); render(); },
  planKeep(el) { S.plan.keep = el.dataset.k; render(); },   // Block planen: 'len' Länge behalten, 'cnt' Anzahl Trainings behalten
  planDay(el) { const P = S.plan, k = +el.dataset.k; P.days = P.days.includes(k) ? P.days.filter(x => x !== k) : [...P.days, k]; render(); },
  planCancel() { const b = S.plan ? S.plan.back : '/'; S.plan = null; go(b); },
  planGo() {
    const P = S.plan, c = planCompute(P); if (!c.items.length) return;
    const made = c.items.map(x => seasonCreate(c.st, c.b, x.w, x.idx, x.date, x.sess, c.tm)), ids = made.map(t => t.id), h = c.tm ? '/team/' + c.tm.id : '/';
    S.plan = null; done(`${made.length} Trainings geplant (${c.st.id} · Block ${c.b.nr}${c.tm ? ' · ' + c.tm.name : ''}), ${fmtDate(c.items[0].date)} bis ${fmtDate(c.items[c.items.length - 1].date)}.`, h, ids);
  },
  doneUndo() {
    const ids = new Set((S.done && S.done.undo) || []), n = DB.trainings.filter(t => ids.has(t.id)).length;
    DB.trainings.filter(t => ids.has(t.id)).forEach(t => spDel('t', (teamOf(t) || {}).id, t.id));
    DB.trainings = DB.trainings.filter(t => !ids.has(t.id)); S.done = null; save(); toast(`${n} Trainings zurückgenommen`); render();
  },
  toPlayers(el) { S.tsec.add('pl'); closeModal(); go('/team/' + el.dataset.k); },
  attTog(el) {
    const t = curT(), id = el.dataset.id; t.att = attOf(t); if (t.att[id]) delete t.att[id]; else t.att[id] = 1;
    touch(t); const on = !!t.att[id]; el.classList.toggle('on', on); el.setAttribute('aria-pressed', on ? 'true' : 'false'); const n = $('#attn'); if (n) n.textContent = attSum(t, teamOf(t));
  },
  attAll() { const t = curT(); t.att = attOf(t); playersOf(teamOf(t)).forEach(p => t.att[p.id] = 1); touch(t); render(); },
  attNone() { const t = curT(), tm = teamOf(t); playersOf(tm).forEach(p => delete attOf(t)[p.id]); touch(t); render(); },
  plAdd(el) { S.pf = { tm: el.dataset.tm, id: '', first: '', last: '', jsnr: '', rn: '', role: el.dataset.role === 'L' ? 'L' : 'T' }; playerModal(); },
  plEdit(el) { const tm = teamById(el.dataset.tm), p = playersOf(tm).find(x => x.id === el.dataset.id); if (!p) return; S.pf = { tm: tm.id, ...p }; playerModal(); },
  plSave() {
    const f = S.pf, tm = teamById(f.tm); if (!tm) return;
    if (!String(f.first).trim() && !String(f.last).trim()) return toast('Bitte einen Namen eingeben');
    const p = cleanPlayer({ ...f, u: Date.now() }); tm.players = playersOf(tm); const i = tm.players.findIndex(x => x.id === p.id);
    if (i >= 0) tm.players[i] = p; else tm.players.push(p);
    S.tsec.add('pl'); save(); closeModal(); render(); toast('Gespeichert');
  },
  plDel() {
    const f = S.pf, tm = teamById(f.tm), i = playersOf(tm).findIndex(x => x.id === f.id); if (i < 0) return;
    const p = tm.players.splice(i, 1)[0]; spDel('p', tm.id, p.id); save(); closeModal(); render();
    toast(`«${pName(p)}» entfernt`, 'Rückgängig', () => { p.u = Date.now(); spDel('p', tm.id, p.id, true); tm.players.splice(Math.min(i, tm.players.length), 0, p); save(); render(); });
  },
  plBulk(el) { S.pb = { tm: el.dataset.tm, text: '', leader: false, prev: null }; bulkModal(); },
  pbPrev() { const b = S.pb, tm = teamById(b.tm); b.prev = parsePlayers(b.text).map(p => ({ ...p, dup: isDupPlayer(tm, p) })); bulkModal(); },
  pbAdd() {
    const b = S.pb, tm = teamById(b.tm), list = parsePlayers(b.text).filter(p => !isDupPlayer(tm, p)); if (!list.length) return toast('Nichts Neues zum Hinzufügen');
    tm.players = playersOf(tm); const added = list.map(p => cleanPlayer({ ...p, role: b.leader ? 'L' : 'T', u: Date.now() })); tm.players.push(...added);
    S.tsec.add('pl'); S.pb = null; save(); closeModal(); render();
    toast(`${added.length} Person${added.length === 1 ? '' : 'en'} hinzugefügt`, 'Rückgängig', () => { const ids = new Set(added.map(p => p.id)); tm.players = tm.players.filter(p => !ids.has(p.id)); ids.forEach(x => spDel('p', tm.id, x)); save(); render(); });
  },
  awExport(el) { jsModal(teamById(el.dataset.tm), el.dataset.k); },
  awDownload() { const r = S.jsx; if (!r || !r.rows) return; saveBlob(r.name, new Blob([r.text], { type: 'text/csv;charset=utf-8' })); toast('Datei heruntergeladen'); },
  tshOpen(el) { S.tsh = { id: el.dataset.k, which: 'up', pl: false }; buildTeamShare(); },
  share() { shareTraining(curT()); },
  print() { print(); },
  shNative() { const { url, t, text } = S.share; if (navigator.share) navigator.share({ title: t.title, text, url }).catch(() => { }); else A.shCopy(); },
  shCopy() { navigator.clipboard.writeText(S.share.url).then(() => toast('Link kopiert'), () => prompt('Link kopieren:', S.share.url)); },
  shFile() { download(S.share.file, S.share.data); },
  shareApp() { const url = appUrl(); if (navigator.share) navigator.share({ title: 'Unihockey Trainingsplaner', url }).catch(() => { }); else navigator.clipboard.writeText(url).then(() => toast('Link kopiert')); },
  expAll() { download(`unihockey-trainings-${iso(new Date())}.json`, { v: 1, t: DB.trainings, c: DB.custom, n: DB.notes, m: DB.teams, s: DB.seasons, season: DB.season, ...(DB.spaces && Object.keys(DB.spaces).length ? { sp: DB.spaces } : {}) }); },
  impFile() { $('#file').click(); },
  impOk: doImport,
  spSetup(el) {
    const id = el.dataset.k; el.disabled = true; toast('Raum wird eingerichtet …');
    spSetup(id).then(ok => { render(); if (ok) spInviteModal(id, 'w'); }).catch(e => { el.disabled = false; const x = spErr(e); toast(x.state === 'off' ? 'Keine Verbindung zum Server – bitte mit Internet nochmals versuchen.' : x.msg); });
  },
  spNow(el) { const id = el.dataset.k; SP.st[id] = { state: 'run' }; spPaint(); spSync(id); },
  spInvite(el) { spInviteModal(el.dataset.k, el.dataset.r === 'r' ? 'r' : 'w'); },
  spJoinOk: spJoinDo,
  spRenew(el) {
    const id = el.dataset.k;
    modal(`<h2>Zugang erneuern?</h2><p>Es gibt dann einen neuen Schlüssel und neue Links. <b>Alle bisherigen Links – auch deine bereits verschickten – funktionieren nicht mehr.</b> Wer weiter abgleichen soll, braucht den neuen Link von dir.</p><p class="small muted">Nutze das, wenn jemand nicht mehr dabei sein soll oder ein Link in falsche Hände geraten ist.</p><div class="col"><button class="btn danger" data-a="spRenewOk" data-k="${esc(id)}">Zugang erneuern</button><button class="btn" data-a="close">Abbrechen</button></div>`);
  },
  spRenewOk(el) {
    const id = el.dataset.k; el.disabled = true;
    spRenewDo(id).then(ok => { render(); if (ok) spInviteModal(id, 'w', true); else { closeModal(); toast((SP.st[id] && SP.st[id].msg) || 'Zugang konnte nicht erneuert werden'); } }).catch(e => { closeModal(); toast(spErr(e).msg); });
  },
  spDissolve(el) {
    const id = el.dataset.k, tm = teamById(id);
    modal(`<h2>Raum auflösen?</h2><p>Der Raum von «${esc(tm.name)}» wird auf dem Server gelöscht. Deine Daten und die Kopien der Co-Trainer bleiben auf den Geräten erhalten, gleichen sich aber nicht mehr ab. Das lässt sich nicht rückgängig machen.</p><div class="col"><button class="btn danger" data-a="spDissolveOk" data-k="${esc(id)}">Raum auflösen</button><button class="btn" data-a="close">Abbrechen</button></div>`);
  },
  spDissolveOk(el) {
    const id = el.dataset.k, sp = spOf(id); el.disabled = true;
    spLock(async () => { try { await spRpc('space_delete', { p_id: sp.id, p_o: sp.o }); } catch (e) { if (!(e.status === 400 && e.message === 'kein zugriff')) throw e; } delete DB.spaces[id]; flush(); })
      .then(() => { closeModal(); render(); toast('Raum aufgelöst – deine Daten bleiben'); }).catch(e => { closeModal(); toast(spErr(e).msg); });
  },
  spLeave(el) {
    const id = el.dataset.k, tm = teamById(id);
    modal(`<h2>Abgleich beenden?</h2><p>«${esc(tm.name)}» bleibt als Kopie auf diesem Gerät, gleicht sich aber nicht mehr mit den anderen ab. Mit dem Einladungslink kannst du später wieder beitreten.</p><div class="col"><button class="btn danger" data-a="spLeaveOk" data-k="${esc(id)}">Abgleich beenden</button><button class="btn" data-a="close">Abbrechen</button></div>`);
  },
  spLeaveOk(el) { delete DB.spaces[el.dataset.k]; flush(); closeModal(); render(); toast('Abgleich beendet – die Kopie bleibt'); },
  install() { installEvt && installEvt.prompt(); installEvt = null; },
  wipe() { if (confirm('Wirklich ALLE Trainings, eigenen Übungen und Notizen auf diesem Gerät löschen?' + (DB.spaces && Object.keys(DB.spaces).length ? ' Auch die Zugänge zu deinen Mannschaftsräumen gehen verloren.' : ''))) { DB = EMPTY(); LIB = null; flush(); render(); } },
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
  saveC() { const f = S.form; if (!f.name.trim()) return toast('Bitte einen Namen eingeben'); f.min = +f.min || 10; if (f.id) { const c = DB.custom.find(x => x.id === f.id); Object.assign(c, f); syncCustom(c); } else { f.id = uid(); f.u = Date.now(); DB.custom.push(f); } LIB = null; save(); toast('Gespeichert'); go(`/lib/x/${encodeURIComponent('c:' + f.id)}`); },
  delC(el) { if (!confirm('Eigene Übung löschen?')) return; DB.custom = DB.custom.filter(x => x.id !== el.dataset.id); LIB = null; save(); go('/lib'); },
  stage(el) { DB.stage = el.dataset.k; save(); render(); },
  fromRtp(el) { const d = el.dataset, t = trainingFromRtp(d.s, +d.b2, +d.w, +d.i, d.d); applyFlow(t); S.flow = null; done(`Training erstellt aus ${d.s} · Block ${d.b2}${+d.w ? ' · Woche ' + d.w : ''} – ${t.items.length} Blöcke${t.team ? ' · ' + t.team : ''}. Jetzt kannst du es anpassen.`, `/t/${t.id}`); },
  sNew(el) { const d = el.dataset, st = stageById(d.s), b = st.blocks.find(x => x.nr === +d.b2), tm = teamById(S.team), sess = planSessions(seasonCfg(), tm).find(x => x.id === d.x), t = seasonCreate(st, b, b.weeks.find(x => x.w === +d.w), +d.i, d.d, sess, tm); applyFlow(t); S.flow = null; done(`Training für ${fmtDate(d.d)} erstellt (${st.id} · Block ${b.nr}). Jetzt kannst du es anpassen.`, `/t/${t.id}`); },
  sDay(el) { const s = seasonCfg(), k = +el.dataset.k; s.days = s.days.includes(k) ? s.days.filter(x => x !== k) : [...s.days, k]; s.set = 1; save(); render(); },
  sHol(el) { const s = seasonCfg(), k = el.dataset.k; s.hol = s.hol.includes(k) ? s.hol.filter(x => x !== k) : [...s.hol, k]; s.set = 1; spU(S.team); save(); render(); },
  runTog() { const r = S.run; r.started = true; r.on = !r.on; r.last = Date.now(); wakeLock(r.on); runKeep(); render(); },
  runReset() { runSet(curT(), S.run.i); render(); },
  runGo(el) { const t = curT(), i = +el.dataset.i; if (i < 0 || i >= t.items.length) return; S.run.started = true; runSet(t, i); runKeep(); render(); scrollTo(0, 0); },
  runExit() { wakeLock(false); S.run = null; runKeep(); },
  runEnd() { const t = curT(); if (!t) return; wakeLock(false); S.run = null; runKeep(); go(`/t/${t.id}/end/${playersOf(teamOf(t)).length ? 1 : 2}`); scrollTo(0, 0); },   // letzte Übung: Training beenden -> Anwesenheit (ohne Spielerliste gleich Reflexion)
  endNext() { const t = curT(); if (!t) return; go(`/t/${t.id}/end/2`); scrollTo(0, 0); },
  endLater() { const t = curT(); go(t ? '/t/' + t.id : '/'); },
  reflOpen(el) { go(`/t/${el.dataset.id}/end/2`); scrollTo(0, 0); },
  reflGoal(el) { const t = curT(), r = reflEdit(t), v = +el.dataset.v; if (r.goal === v) delete r.goal; else r.goal = v; pkMark(el, r.goal === v); touch(t); reflUp(t); },
  reflScale(el) {
    const t = curT(), r = reflEdit(t), k = el.dataset.k, v = +el.dataset.v, s = RF_SC.find(x => x.k === k); if (!s) return;
    if (+r[k] === v) delete r[k]; else r[k] = v; pkMark(el, +r[k] === v); const e = $('#rfv-' + k); if (e) e.textContent = reflScaleTxt(r, s) ? '· ' + reflScaleTxt(r, s) : ''; touch(t); reflUp(t);
  },
  reflVote(el) {
    const t = curT(), id = el.dataset.id, v = +el.dataset.v; if (!spSafe(id)) return; const r = reflEdit(t); r.items = r.items && typeof r.items === 'object' ? r.items : {};
    const x = r.items[id] = r.items[id] && typeof r.items[id] === 'object' ? r.items[id] : {}; if (x.v === v) delete x.v; else x.v = v; pkMark(el, x.v === v);
    const w = el.closest('.rfx').querySelector('.rfwhy'); if (w) w.hidden = x.v !== -1; if (x.v === undefined && !String(x.why || '').trim()) delete r.items[id]; touch(t); reflUp(t);
  },
  reflPl(el) {
    const t = curT(), id = el.dataset.id, k = el.dataset.k === 'plus' ? 'plus' : 'foerdern'; if (!spSafe(id)) return; const r = reflEdit(t); r.players = r.players && typeof r.players === 'object' ? r.players : {};
    const x = r.players[id] = r.players[id] && typeof r.players[id] === 'object' ? r.players[id] : {}; if (x.k === k) delete x.k; else x.k = k; pkMark(el, x.k === k);
    const w = el.closest('.rfp').querySelector('.rfwhy'); if (w) w.hidden = !x.k; if (!x.k && !String(x.note || '').trim()) delete r.players[id]; touch(t);
  },
  reflSave() { const t = curT(), r = reflEdit(t); r.at = Date.now(); touch(t); S.rfPl = false; done('Reflexion gespeichert. Sie erscheint beim nächsten Training und bei den Übungen wieder.', '/t/' + t.id); },
  reflSeen() { const t = curT(); if (!t) return; t.reflSeen = true; touch(t); render(); },
};
document.addEventListener('toggle', ev => { const c = ev.target.classList; if (!c) return; if (c.contains('rtpsum')) S.sumClosed = !ev.target.open; else if (c.contains('rfpl')) S.rfPl = ev.target.open; else if (c.contains('tsec')) ev.target.open ? S.tsec.add(ev.target.dataset.k) : S.tsec.delete(ev.target.dataset.k); else if (c.contains('expl')) ev.target.open ? S.expl.add(ev.target.dataset.k) : S.expl.delete(ev.target.dataset.k); }, true);
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]'); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  if (RO_A.has(el.dataset.a) && roTeam()) { ev.preventDefault(); toast('Nur lesen – Änderungen macht der Haupttrainer'); return; }
  if (el.tagName !== 'A') ev.preventDefault();
  fn(el, ev);
});
function onInput(ev) {
  const el = ev.target.closest('[data-b]'); if (!el) return;
  if (!/^(aw|l|f|tsh):/.test(el.dataset.b) && roTeam()) return;
  const [k, a, b] = el.dataset.b.split(':'), v = el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value;
  const rer = el.dataset.r && ev.type === 'change';
  if (k === 't' && a === 'teamId') { const t = curT(), tm = teamById(v); if (v === '__txt') return; const old = teamOf(t); if (tm) applyTeam(t, tm); else setTeam(t, null); if (old && (!tm || old.id !== tm.id)) spDel('t', old.id, t.id); touch(t); }
  else if (k === 't') { const t = curT(); t[a] = v; touch(t); if (a === 'min') $('#sum').innerHTML = sumHtml(t); }
  else if (k === 'i' || k === 'g') {
    const t = curT(), it = t.items.find(x => x.id === a); if (!it) return;
    if (k === 'g') { it.g[b] = v; if (b === 'mode' && v !== 'own') it.g.name = ''; } else it[b] = v;
    touch(t); if (b === 'min') $('#sum').innerHTML = sumHtml(t);
    if (k === 'i' && (b === 'desc' || b === 'coach')) {   // eigene Notizen/Keypoints bei der Übung merken (nicht bei eigenen Übungen und Athletik: dort ist das Feld der Übungstext selbst)
      const key = matNoteKey(it), e = key && libGet(key); if (e && e.src === 'rtp' && it.type !== 'athletik' && !isSw(it)) { const n = DB.notes[key] = DB.notes[key] || {}; n[b] = v; n.u = Date.now(); if (!n.desc && !n.goalie && !n.mat && !n.coach) delete DB.notes[key]; save(); }
    }
    if (k === 'i' && b === 'mat') {
      if ($('#mat')) $('#mat').innerHTML = matCard(t, 'edit');
      const key = matNoteKey(it); if (key) { const n = DB.notes[key] = DB.notes[key] || {}; n.mat = v; n.u = Date.now(); if (!n.desc && !n.goalie && !n.mat && !n.coach) delete DB.notes[key]; save(); }
    }
  }
  else if (k === 'n') { const key = el.dataset.b.slice(2, el.dataset.b.lastIndexOf(':')), f = el.dataset.b.slice(el.dataset.b.lastIndexOf(':') + 1); (DB.notes[key] = DB.notes[key] || {})[f] = v; DB.notes[key].u = Date.now(); if (!DB.notes[key].desc && !DB.notes[key].goalie && !DB.notes[key].mat && !DB.notes[key].coach) delete DB.notes[key]; save(); }
  else if (k === 'rf') {   // Reflexion: Freitexte, Warum-Feld je Übung, Notiz je Spieler
    const t = curT(); if (!t) return; const r = reflEdit(t), val = String(v).slice(0, 2000);
    if (a === 'good' || a === 'change') r[a] = val;
    else if ((a === 'why' || a === 'pn') && spSafe(b)) { const f = a === 'why' ? 'items' : 'players'; r[f] = r[f] && typeof r[f] === 'object' ? r[f] : {}; const x = r[f][b] = r[f][b] && typeof r[f][b] === 'object' ? r[f][b] : {}; x[a === 'why' ? 'why' : 'note'] = val; }
    touch(t); reflUp(t);
  }
  else if (k === 'c') S.form[a] = v;
  else if (k === 'x') { const t = curT(), it = t && t.items.find(x => x.id === a), c = it && customOf(it); if (c) { c[b] = v; syncCustom(c); } }
  else if (k === 'pl') S.pf[a] = v;
  else if (k === 'pb') S.pb[a] = a === 'leader' ? el.checked : v;
  else if (k === 'aw') S.aw[a] = v;
  else if (k === 'tsh') { S.tsh[a] = a === 'pl' ? el.checked : v; buildTeamShare(); return; }
  else if (k === 'f') { S.seed[a] = v; return; }
  else if (k === 'p') { const P = S.plan; P[a] = a === 'block' ? +v || 0 : v; if (a === 'team') { const tm = teamById(v); P.stage = tm ? seasonCfgFor(tm).stage || tm.stage : P.stage; P.block = 0; } if (a === 'stage') P.block = 0; }
  else if (k === 'm') { const f = S.mf; f[a] = v; if (a === 'stage' && !f.minEdited) f.sessions.forEach(x => x.min = stageById(v).minutes); }
  else if (k === 'ms') { const f = S.mf, x = f.sessions.find(y => y.id === a); if (!x) return; x[b] = b === 'wd' ? +v : v; if (b === 'min') f.minEdited = 1; }
  else if (k === 's' && a === 'year') { S.sYear = +v === seasonYearNow() ? 0 : +v; render.seasonScrolled = false; render(); return; }
  else if (k === 's' && a === 'startOwn') { const s = seasonCfg(), y = seasonYear(); s.starts = s.starts || {}; if (!v || v === seasonDefault(y)) delete s.starts[y]; else s.starts[y] = v; s.set = 1; spU(S.team); render.seasonScrolled = false; save(); }
  else if (k === 's') { const s = seasonCfg(); s[a] = v; s.set = 1; spU(S.team); if (a === 'stage') DB.stage = v; render.seasonScrolled = false; save(); }
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
if (SYNC_ON) {   // Abgleich: beim Start, bei Rückkehr in die App, wenn wieder online, und jede Minute solange die App sichtbar ist
  addEventListener('online', spAuto); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') spAuto(); });
  setInterval(() => { if (document.visibilityState === 'visible') spAuto(); }, 60000); setTimeout(spAuto, 400);
}
// UTP-Links: Verbindung schon beim Berühren des Knopfs aufbauen, damit die Erklärung schneller aufgeht.
document.addEventListener('pointerdown', ev => {
  const a = ev.target.closest && ev.target.closest('a.utp'); if (!a) return;
  const l = document.createElement('link'); l.rel = 'preconnect'; l.href = new URL(a.href).origin; document.head.appendChild(l); setTimeout(() => l.remove(), 15000);
}, { passive: true });
