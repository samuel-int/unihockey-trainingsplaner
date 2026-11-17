// Lokaler Nachbau der Supabase-Funktionen aus tools/supabase.sql (nur zum Testen des Abgleichs).
//   node tools/sync-mock.js   ->   http://localhost:5180   (apikey: dev-key)
// Gleiche Logik wie im SQL: SHA-256 der Token, Rollen o/w/r, Versionsprüfung bei space_put,
// Grössenlimit, Fehler als HTTP 400 mit {message}. Daten im Speicher und in tools/.sync-mock.json.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 5180, KEY = 'dev-key', FILE = path.join(__dirname, '.sync-mock.json');
let spaces = {};
try { spaces = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* leer starten */ }
const persist = () => { try { fs.writeFileSync(FILE, JSON.stringify(spaces)); } catch (e) { console.error('Speichern fehlgeschlagen'); } };
const hash = t => crypto.createHash('sha256').update(String(t ?? ''), 'utf8').digest('hex');
const len = s => [...String(s ?? '')].length;
class PgError extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }
const fail = m => { throw new PgError(m); };
const role = (id, t) => { const s = spaces[id]; if (!s) return null; const h = hash(t); return s.o_hash === h ? 'o' : s.w_hash === h ? 'w' : s.r_hash === h ? 'r' : null; };
const need = (p, names) => { for (const n of names) if (!(n in p)) throw new PgError('Could not find the function with parameters ' + names.join(', '), 404); };
const FN = {
  space_create(p) {
    need(p, ['p_id', 'p_o', 'p_w', 'p_r', 'p_data']);
    if (len(p.p_data) > 3000000) fail('zu gross');
    if (len(p.p_o) < 20 || len(p.p_w) < 20 || len(p.p_r) < 20) fail('token zu kurz');
    if (Object.keys(spaces).length >= 500) fail('limit erreicht');
    if (typeof p.p_id !== 'string' || len(p.p_id) < 16 || len(p.p_id) > 64) throw new PgError('new row for relation "spaces" violates check constraint "spaces_id_check"');
    if (spaces[p.p_id]) throw new PgError('duplicate key value violates unique constraint "spaces_pkey"', 409);
    spaces[p.p_id] = { data: p.p_data ?? '', ver: 1, o_hash: hash(p.p_o), w_hash: hash(p.p_w), r_hash: hash(p.p_r), created: new Date().toISOString(), updated: new Date().toISOString() };
    persist(); return 1;
  },
  space_get(p) {
    need(p, ['p_id', 'p_t']);
    const r = role(p.p_id, p.p_t); if (!r) fail('kein zugriff');
    const s = spaces[p.p_id]; return [{ data: s.data, ver: s.ver, role: r }];
  },
  space_put(p) {
    need(p, ['p_id', 'p_t', 'p_data', 'p_ver']);
    const r = role(p.p_id, p.p_t); if (!r || r === 'r') fail('kein schreibrecht');
    if (len(p.p_data) > 3000000) fail('zu gross');
    const s = spaces[p.p_id];
    if (s.ver === Number(p.p_ver)) { s.data = p.p_data; s.ver += 1; s.updated = new Date().toISOString(); persist(); return [{ ok: true, ver: s.ver }]; }
    return [{ ok: false, ver: s.ver }];
  },
  space_rekey(p) {
    need(p, ['p_id', 'p_o', 'p_w', 'p_r', 'p_data']);
    if (role(p.p_id, p.p_o) !== 'o') fail('nur besitzer');
    if (len(p.p_w) < 20 || len(p.p_r) < 20) fail('token zu kurz');
    const s = spaces[p.p_id]; s.w_hash = hash(p.p_w); s.r_hash = hash(p.p_r); if (p.p_data != null) s.data = p.p_data; s.ver += 1; s.updated = new Date().toISOString();
    persist(); return s.ver;
  },
  space_delete(p) {
    need(p, ['p_id', 'p_o']);
    if (role(p.p_id, p.p_o) !== 'o') fail('nur besitzer');
    delete spaces[p.p_id]; persist(); return true;
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
