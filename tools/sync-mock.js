// Lokaler Nachbau der Supabase-Funktionen aus tools/supabase.sql und tools/supabase-verein.sql (nur zum Testen des Abgleichs).
//   node tools/sync-mock.js                              ->   http://localhost:5180   (apikey: dev-key)
//   node tools/sync-mock.js --setup-code TESTCODE123     ->   setzt den Einmal-Code zum Einrichten des Admins (nur solange noch kein Admin existiert)
// Gleiche Logik wie im SQL: SHA-256 der Token, Raumrollen o/w/r, Vereinsrollen A/F (club_role, sp_role2), Versionsprüfung bei space_put,
// Grössenlimit, Fehler als HTTP 400 mit {message}. Daten im Speicher und in tools/.sync-mock.json (Format {spaces, club, members, club_members}).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 5180, KEY = 'dev-key', FILE = path.join(__dirname, '.sync-mock.json');
let spaces = {}, club = { setup_hash: null, admin_hash: null, func_hash: null, pub_admin: null, pub_func: null }, members = {}, clubMembers = {};
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (j && j.spaces) { spaces = j.spaces; club = Object.assign(club, j.club || {}); members = j.members || {}; clubMembers = j.club_members || {}; } else spaces = j || {};   // altes Format: nur die Räume
} catch (e) { /* leer starten */ }
const persist = () => { try { fs.writeFileSync(FILE, JSON.stringify({ spaces, club, members, club_members: clubMembers })); } catch (e) { console.error('Speichern fehlgeschlagen'); } };
const hash = t => crypto.createHash('sha256').update(String(t ?? ''), 'utf8').digest('hex');
const len = s => [...String(s ?? '')].length;
const now = () => new Date().toISOString();
class PgError extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }
const fail = m => { throw new PgError(m); };
const ai = process.argv.indexOf('--setup-code');
if (ai > 0 && process.argv[ai + 1]) { if (club.admin_hash) console.log('Verein ist schon eingerichtet: --setup-code ohne Wirkung'); else { club.setup_hash = hash(process.argv[ai + 1]); persist(); console.log('Einmal-Code gesetzt'); } }

// Rollen (wie sp_role, club_role, sp_role2 im SQL)
const role = (id, t) => { const s = spaces[id]; if (!s) return null; const h = hash(t); return s.o_hash === h ? 'o' : s.w_hash === h ? 'w' : s.r_hash === h ? 'r' : null; };
const clubRole = t => { const h = hash(t); return club.admin_hash && club.admin_hash === h ? 'A' : club.func_hash && club.func_hash === h ? 'F' : null; };
const role2 = (id, t) => role(id, t) || (spaces[id] ? clubRole(t) : null);
const need = (p, names) => { for (const n of names) if (!(n in p)) throw new PgError('Could not find the function with parameters ' + names.join(', '), 404); };
const byLast = (a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0) || (a.last_seen < b.last_seen ? 1 : a.last_seen > b.last_seen ? -1 : 0);
const FN = {
  // ---------- Verein ----------
  club_get(p) { return [{ ready: !!club.admin_hash, pub_admin: club.pub_admin, pub_func: club.pub_func }]; },
  club_setup(p) {
    need(p, ['p_code', 'p_admin', 'p_pub_admin']);
    if (len(p.p_admin) < 20 || len(p.p_pub_admin) < 20) fail('ungueltig');
    if (club.admin_hash || !club.setup_hash || club.setup_hash !== hash(p.p_code)) fail('code ungueltig oder verein schon eingerichtet');
    club.admin_hash = hash(p.p_admin); club.pub_admin = p.p_pub_admin; club.setup_hash = null; persist(); return true;
  },
  club_admin_rotate(p) {
    need(p, ['p_admin', 'p_new_admin', 'p_pub_admin']);
    if (clubRole(p.p_admin) !== 'A') fail('nur admin');
    if (len(p.p_new_admin) < 20 || len(p.p_pub_admin) < 20) fail('ungueltig');
    club.admin_hash = hash(p.p_new_admin); club.pub_admin = p.p_pub_admin; persist(); return true;
  },
  club_func_set(p) {
    need(p, ['p_admin', 'p_func', 'p_pub_func']);
    if (clubRole(p.p_admin) !== 'A') fail('nur admin');
    if (len(p.p_func) < 20 || len(p.p_pub_func) < 20) fail('ungueltig');
    club.func_hash = hash(p.p_func); club.pub_func = p.p_pub_func;
    for (const [d, m] of Object.entries(clubMembers)) if (m.role === 'F') delete clubMembers[d];
    persist(); return true;
  },
  club_ping(p) {
    need(p, ['p_t', 'p_dev', 'p_name_enc']);
    const r = clubRole(p.p_t); if (!r) fail('kein zugriff');
    if (len(p.p_name_enc) > 4000) fail('zu gross');
    if (len(p.p_dev) < 8 || len(p.p_dev) > 64) throw new PgError('new row for relation "club_members" violates check constraint "club_members_dev_check"');
    clubMembers[p.p_dev] = { dev: p.p_dev, name_enc: p.p_name_enc ?? '', role: r, last_seen: now() }; persist(); return true;
  },
  club_members_list(p) {
    need(p, ['p_admin']);
    if (clubRole(p.p_admin) !== 'A') fail('nur admin');
    return Object.values(clubMembers).sort(byLast);
  },
  club_member_remove(p) {
    need(p, ['p_admin', 'p_dev']);
    if (clubRole(p.p_admin) !== 'A') fail('nur admin');
    delete clubMembers[p.p_dev]; persist(); return true;
  },
  // ---------- Räume ----------
  space_create(p) {
    need(p, ['p_id', 'p_o', 'p_w', 'p_r', 'p_data']);
    if (len(p.p_data) > 3000000) fail('zu gross');
    if (len(p.p_o) < 20 || len(p.p_w) < 20 || len(p.p_r) < 20) fail('token zu kurz');
    if (p.p_o === p.p_w || p.p_o === p.p_r || p.p_w === p.p_r) fail('token muessen verschieden sein');
    if (Object.keys(spaces).length >= 500) fail('limit erreicht');
    if (Object.values(spaces).filter(s => Date.parse(s.created) > Date.now() - 864e5).length >= 30) fail('zu viele neue raeume, spaeter nochmals versuchen');
    if (typeof p.p_id !== 'string' || len(p.p_id) < 16 || len(p.p_id) > 64) throw new PgError('new row for relation "spaces" violates check constraint "spaces_id_check"');
    if (spaces[p.p_id]) fail('raum existiert schon');
    spaces[p.p_id] = { data: p.p_data ?? '', ver: 1, o_hash: hash(p.p_o), w_hash: hash(p.p_w), r_hash: hash(p.p_r), wa: p.p_wa ?? null, wf: p.p_wf ?? null, created: now(), updated: now() };
    persist(); return 1;
  },
  space_get(p) {
    need(p, ['p_id', 'p_t']);
    const r = role2(p.p_id, p.p_t); if (!r) fail('kein zugriff');
    const s = spaces[p.p_id]; return [{ data: s.data, ver: s.ver, role: r }];
  },
  space_put(p) {
    need(p, ['p_id', 'p_t', 'p_data', 'p_ver']);
    const r = role2(p.p_id, p.p_t); if (!r || !['o', 'w', 'A'].includes(r)) fail('kein schreibrecht');
    if (len(p.p_data) > 3000000) fail('zu gross');
    const s = spaces[p.p_id];
    if (s.ver === Number(p.p_ver)) { s.data = p.p_data; s.ver += 1; s.updated = now(); persist(); return [{ ok: true, ver: s.ver }]; }
    return [{ ok: false, ver: s.ver }];
  },
  space_rekey(p) {
    need(p, ['p_id', 'p_o', 'p_w', 'p_r', 'p_data']);
    const r = role2(p.p_id, p.p_o); if (!r || !['o', 'A'].includes(r)) fail('nur besitzer oder admin');
    if (len(p.p_w) < 20 || len(p.p_r) < 20) fail('token zu kurz');
    if (p.p_w === p.p_r || p.p_w === p.p_o || p.p_r === p.p_o) fail('token muessen verschieden sein');
    if (len(p.p_data) > 3000000) fail('zu gross');
    const s = spaces[p.p_id]; s.w_hash = hash(p.p_w); s.r_hash = hash(p.p_r); if (p.p_data != null) s.data = p.p_data;
    if (p.p_wa != null) s.wa = p.p_wa; if (p.p_wf != null) s.wf = p.p_wf;
    s.ver += 1; s.updated = now();
    for (const [k, m] of Object.entries(members)) if (m.space_id === p.p_id && (m.role === 'w' || m.role === 'r')) delete members[k];
    persist(); return s.ver;
  },
  space_setwrap(p) {
    need(p, ['p_id', 'p_t', 'p_wa', 'p_wf']);
    const r = role2(p.p_id, p.p_t); if (!r || !['o', 'A'].includes(r)) fail('nur besitzer oder admin');
    const s = spaces[p.p_id]; if (p.p_wa != null) s.wa = p.p_wa; if (p.p_wf != null) s.wf = p.p_wf; persist(); return true;
  },
  space_delete(p) {
    need(p, ['p_id', 'p_o']);
    const r = role2(p.p_id, p.p_o); if (!r || !['o', 'A'].includes(r)) fail('nur besitzer oder admin');
    delete spaces[p.p_id]; for (const [k, m] of Object.entries(members)) if (m.space_id === p.p_id) delete members[k];   // on delete cascade
    persist(); return true;
  },
  space_list(p) {
    need(p, ['p_t']);
    const r = clubRole(p.p_t); if (!r) fail('kein zugriff');
    return Object.entries(spaces).map(([id, s]) => ({ id, wrap: r === 'A' ? s.wa : s.wf, ver: s.ver, updated: s.updated, created: s.created })).sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
  },
  // ---------- Personen in Räumen ----------
  member_ping(p) {
    need(p, ['p_id', 'p_t', 'p_dev', 'p_name_enc']);
    const r = role2(p.p_id, p.p_t); if (!r) fail('kein zugriff');
    if (len(p.p_name_enc) > 4000) fail('zu gross');
    if (len(p.p_dev) < 8 || len(p.p_dev) > 64) throw new PgError('new row for relation "members" violates check constraint "members_dev_check"');
    const k = p.p_id + '|' + p.p_dev;
    if (!members[k] && Object.values(members).filter(m => m.space_id === p.p_id).length >= 100) fail('zu viele personen');
    members[k] = { space_id: p.p_id, dev: p.p_dev, name_enc: p.p_name_enc ?? '', role: r, last_seen: now() }; persist(); return r;
  },
  member_list(p) {
    need(p, ['p_id', 'p_t']);
    if (!role2(p.p_id, p.p_t)) fail('kein zugriff');
    return Object.values(members).filter(m => m.space_id === p.p_id).map(m => ({ dev: m.dev, name_enc: m.name_enc, role: m.role, last_seen: m.last_seen })).sort(byLast);
  },
  member_remove(p) {
    need(p, ['p_id', 'p_t', 'p_dev']);
    const r = role2(p.p_id, p.p_t); if (!r || !['o', 'A'].includes(r)) fail('nur besitzer oder admin');
    delete members[p.p_id + '|' + p.p_dev]; persist(); return true;
  },
};
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, prefer', 'Access-Control-Max-Age': '600' };
const send = (res, code, obj) => { res.writeHead(code, { ...CORS, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(req.url.split('?')[0]);
  if (req.method !== 'POST' || !m) return send(res, 404, { message: 'Not found' });
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (req.headers.apikey !== KEY || (bearer && bearer !== KEY)) return send(res, 401, { message: 'Invalid API key' });
  let body = ''; req.on('data', c => { body += c; if (body.length > 8e6) req.destroy(); });
  req.on('end', () => {
    let p; try { p = JSON.parse(body || '{}'); } catch (e) { return send(res, 400, { message: 'Invalid JSON' }); }
    const f = FN[m[1]]; if (!f) return send(res, 404, { message: 'Could not find the function public.' + m[1] });
    try { send(res, 200, f(p || {})); } catch (e) { if (e instanceof PgError) send(res, e.status, { message: e.message }); else { console.error(e); send(res, 500, { message: 'Serverfehler' }); } }
  });
}).listen(PORT, () => console.log(`Sync-Mock läuft auf http://localhost:${PORT} (apikey: ${KEY})`));
