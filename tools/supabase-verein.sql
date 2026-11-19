-- Verein und Rollen für den Trainingsplaner (Ergänzung zu tools/supabase.sql; danach im SQL-Editor ausführen).
-- Mehrfaches Ausführen ist unschädlich.
--
-- Rollen
--   A  Admin       (genau eine Person; Admin-Token): liest und schreibt alle Räume, erneuert und löscht sie, sieht alle Personen
--   F  Funktionär  (Funktionärs-Token, von Admin verteilt): liest alle Räume, ändert nichts
--   o  Trainer     (Besitzer eines Raums): wie bisher
--   w  Assistenz   (Co-Trainer eines Raums): lesen und schreiben, Raum nicht löschen
--   r  Nur lesen   (bleibt technisch erhalten)
-- Verschlüsselung bleibt Ende-zu-Ende: Jeder Raumschlüssel wird zusätzlich mit dem öffentlichen Schlüssel des Admins (wa)
-- und der Funktionäre (wf) verpackt. Die privaten Schlüssel liegen nur auf den Geräten. Der Server sieht keine Klartexte.
-- Namen der Personen liegen verschlüsselt: in Räumen mit dem Raumschlüssel, vereinsweit (Admin, Funktionäre) für den Admin.

-- ---------- Tabellen ----------
create table if not exists public.club (
  id         int primary key default 1 check (id = 1),
  setup_hash text,            -- Einmal-Code zum Einrichten des Admins (nach Gebrauch leer)
  admin_hash text,
  func_hash  text,
  pub_admin  text,            -- öffentlicher Schlüssel Admin (JWK als Text)
  pub_func   text,            -- öffentlicher Schlüssel Funktionäre (JWK als Text)
  updated    timestamptz not null default now()
);
insert into public.club(id) values (1) on conflict (id) do nothing;
alter table public.club enable row level security;
revoke all on table public.club from anon, authenticated;

alter table public.spaces add column if not exists wa text;   -- Raumschlüssel, verpackt für den Admin
alter table public.spaces add column if not exists wf text;   -- Raumschlüssel, verpackt für die Funktionäre

create table if not exists public.members (
  space_id  text not null references public.spaces(id) on delete cascade,
  dev       text not null check (char_length(dev) between 8 and 64),
  name_enc  text not null default '',   -- Name, verschlüsselt mit dem Raumschlüssel
  role      text not null,              -- vom Server aus dem Token bestimmt: o, w, r, A, F
  last_seen timestamptz not null default now(),
  primary key (space_id, dev)
);
alter table public.members enable row level security;
revoke all on table public.members from anon, authenticated;

create table if not exists public.club_members (
  dev       text primary key check (char_length(dev) between 8 and 64),
  name_enc  text not null default '',   -- Name, verschlüsselt für den Admin
  role      text not null,              -- A oder F
  last_seen timestamptz not null default now()
);
alter table public.club_members enable row level security;
revoke all on table public.club_members from anon, authenticated;

-- ---------- Rollen bestimmen ----------
-- Vereinsrolle eines Tokens: 'A', 'F' oder null
create or replace function public.club_role(p_t text) returns text
language sql stable security definer set search_path = public, extensions
as $$
  select case when c.admin_hash is not null and c.admin_hash = public.sp_hash(p_t) then 'A'
              when c.func_hash  is not null and c.func_hash  = public.sp_hash(p_t) then 'F' end
  from public.club c where c.id = 1
$$;
-- Rolle in einem Raum: Raumrolle (o, w, r) oder Vereinsrolle (A, F), sofern der Raum existiert
create or replace function public.sp_role2(p_id text, p_t text) returns text
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(public.sp_role(p_id, p_t), case when exists (select 1 from public.spaces where id = p_id) then public.club_role(p_t) end)
$$;

-- ---------- Verein ----------
-- Öffentlich: ist der Verein eingerichtet, und die öffentlichen Schlüssel zum Verpacken neuer Räume
create or replace function public.club_get()
returns table(ready boolean, pub_admin text, pub_func text) language sql stable security definer set search_path = public, extensions
as $$ select c.admin_hash is not null, c.pub_admin, c.pub_func from public.club c where c.id = 1 $$;

-- Admin einrichten: nur mit dem Einmal-Code, nur solange noch kein Admin existiert
create or replace function public.club_setup(p_code text, p_admin text, p_pub_admin text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
begin
  if char_length(coalesce(p_admin, '')) < 20 or char_length(coalesce(p_pub_admin, '')) < 20 then raise exception 'ungueltig'; end if;
  update public.club c set admin_hash = public.sp_hash(p_admin), pub_admin = p_pub_admin, setup_hash = null, updated = now()
   where c.id = 1 and c.admin_hash is null and c.setup_hash is not null and c.setup_hash = public.sp_hash(p_code);
  if not found then raise exception 'code ungueltig oder verein schon eingerichtet'; end if;
  return true;
end $$;

-- Admin-Schlüssel wechseln (z. B. nach Verlust eines Geräts mit Sicherung): nur mit dem bisherigen Admin-Token
create or replace function public.club_admin_rotate(p_admin text, p_new_admin text, p_pub_admin text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
begin
  if public.club_role(p_admin) is distinct from 'A' then raise exception 'nur admin'; end if;
  if char_length(coalesce(p_new_admin, '')) < 20 or char_length(coalesce(p_pub_admin, '')) < 20 then raise exception 'ungueltig'; end if;
  update public.club set admin_hash = public.sp_hash(p_new_admin), pub_admin = p_pub_admin, updated = now() where id = 1;
  return true;
end $$;

-- Funktionärs-Zugang setzen oder erneuern (nur Admin). Danach muss der Admin in allen Räumen wf neu setzen (space_setwrap).
create or replace function public.club_func_set(p_admin text, p_func text, p_pub_func text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
begin
  if public.club_role(p_admin) is distinct from 'A' then raise exception 'nur admin'; end if;
  if char_length(coalesce(p_func, '')) < 20 or char_length(coalesce(p_pub_func, '')) < 20 then raise exception 'ungueltig'; end if;
  update public.club set func_hash = public.sp_hash(p_func), pub_func = p_pub_func, updated = now() where id = 1;
  delete from public.club_members where role = 'F';
  return true;
end $$;

-- Admin und Funktionäre melden sich vereinsweit mit Namen (verschlüsselt für den Admin)
create or replace function public.club_ping(p_t text, p_dev text, p_name_enc text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare r text := public.club_role(p_t);
begin
  if r is null then raise exception 'kein zugriff'; end if;
  if char_length(coalesce(p_name_enc, '')) > 4000 then raise exception 'zu gross'; end if;
  insert into public.club_members(dev, name_enc, role, last_seen) values (p_dev, coalesce(p_name_enc, ''), r, now())
  on conflict (dev) do update set name_enc = excluded.name_enc, role = excluded.role, last_seen = now();
  return true;
end $$;

create or replace function public.club_members_list(p_admin text)
returns table(dev text, name_enc text, role text, last_seen timestamptz) language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if public.club_role(p_admin) is distinct from 'A' then raise exception 'nur admin'; end if;
  return query select m.dev, m.name_enc, m.role, m.last_seen from public.club_members m order by m.role, m.last_seen desc;
end $$;

create or replace function public.club_member_remove(p_admin text, p_dev text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
begin
  if public.club_role(p_admin) is distinct from 'A' then raise exception 'nur admin'; end if;
  delete from public.club_members where dev = p_dev;
  return true;
end $$;

-- ---------- Räume (ersetzt die Versionen aus supabase.sql) ----------
create or replace function public.space_create(p_id text, p_o text, p_w text, p_r text, p_data text, p_wa text default null, p_wf text default null)
returns bigint language plpgsql security definer set search_path = public, extensions
as $$
begin
  if char_length(coalesce(p_data, '')) > 3000000 then raise exception 'zu gross'; end if;
  if char_length(coalesce(p_o, '')) < 20 or char_length(coalesce(p_w, '')) < 20 or char_length(coalesce(p_r, '')) < 20 then raise exception 'token zu kurz'; end if;
  if p_o = p_w or p_o = p_r or p_w = p_r then raise exception 'token muessen verschieden sein'; end if;
  if (select count(*) from public.spaces) >= 500 then raise exception 'limit erreicht'; end if;
  if (select count(*) from public.spaces where created > now() - interval '1 day') >= 30 then raise exception 'zu viele neue raeume, spaeter nochmals versuchen'; end if;
  if exists (select 1 from public.spaces where id = p_id) then raise exception 'raum existiert schon'; end if;
  insert into public.spaces(id, data, ver, o_hash, w_hash, r_hash, wa, wf)
  values (p_id, coalesce(p_data, ''), 1, public.sp_hash(p_o), public.sp_hash(p_w), public.sp_hash(p_r), p_wa, p_wf);
  return 1;
end $$;
drop function if exists public.space_create(text, text, text, text, text);

create or replace function public.space_get(p_id text, p_t text)
returns table(data text, ver bigint, role text) language plpgsql stable security definer set search_path = public, extensions
as $$
declare r text := public.sp_role2(p_id, p_t);
begin
  if r is null then raise exception 'kein zugriff'; end if;
  return query select s.data, s.ver, r from public.spaces s where s.id = p_id;
end $$;

create or replace function public.space_put(p_id text, p_t text, p_data text, p_ver bigint)
returns table(ok boolean, ver bigint) language plpgsql security definer set search_path = public, extensions
as $$
declare r text := public.sp_role2(p_id, p_t); n bigint;
begin
  if r is null or r not in ('o', 'w', 'A') then raise exception 'kein schreibrecht'; end if;
  if char_length(coalesce(p_data, '')) > 3000000 then raise exception 'zu gross'; end if;
  update public.spaces s set data = p_data, ver = s.ver + 1, updated = now()
   where s.id = p_id and s.ver = p_ver returning s.ver into n;
  if n is null then return query select false, s.ver from public.spaces s where s.id = p_id;
  else return query select true, n; end if;
end $$;

-- Zugang erneuern: Besitzer oder Admin. Neue Token für Assistenz und Lesende, neuer Inhalt und neue Verpackungen (neuer Schlüssel).
create or replace function public.space_rekey(p_id text, p_o text, p_w text, p_r text, p_data text, p_wa text default null, p_wf text default null)
returns bigint language plpgsql security definer set search_path = public, extensions
as $$
declare n bigint; r text := public.sp_role2(p_id, p_o);
begin
  if r is null or r not in ('o', 'A') then raise exception 'nur besitzer oder admin'; end if;
  if char_length(coalesce(p_w, '')) < 20 or char_length(coalesce(p_r, '')) < 20 then raise exception 'token zu kurz'; end if;
  if p_w = p_r or p_w = p_o or p_r = p_o then raise exception 'token muessen verschieden sein'; end if;
  if char_length(coalesce(p_data, '')) > 3000000 then raise exception 'zu gross'; end if;
  update public.spaces s set w_hash = public.sp_hash(p_w), r_hash = public.sp_hash(p_r), data = coalesce(p_data, s.data),
         wa = coalesce(p_wa, s.wa), wf = coalesce(p_wf, s.wf), ver = s.ver + 1, updated = now()
   where s.id = p_id returning s.ver into n;
  delete from public.members m where m.space_id = p_id and m.role in ('w', 'r');
  return n;
end $$;
drop function if exists public.space_rekey(text, text, text, text, text);

-- Verpackungen nachtragen (z. B. Raum vor dem Einrichten des Vereins angelegt, oder neuer Funktionärs-Schlüssel): Besitzer oder Admin
create or replace function public.space_setwrap(p_id text, p_t text, p_wa text, p_wf text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare r text := public.sp_role2(p_id, p_t);
begin
  if r is null or r not in ('o', 'A') then raise exception 'nur besitzer oder admin'; end if;
  update public.spaces set wa = coalesce(p_wa, wa), wf = coalesce(p_wf, wf) where id = p_id;
  return true;
end $$;

create or replace function public.space_delete(p_id text, p_o text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare r text := public.sp_role2(p_id, p_o);
begin
  if r is null or r not in ('o', 'A') then raise exception 'nur besitzer oder admin'; end if;
  delete from public.spaces where id = p_id;
  return true;
end $$;

-- Alle Räume für Admin (mit wa) oder Funktionäre (mit wf); Inhalt danach über space_get
create or replace function public.space_list(p_t text)
returns table(id text, wrap text, ver bigint, updated timestamptz, created timestamptz) language plpgsql stable security definer set search_path = public, extensions
as $$
declare r text := public.club_role(p_t);
begin
  if r is null then raise exception 'kein zugriff'; end if;
  return query select s.id, case when r = 'A' then s.wa else s.wf end, s.ver, s.updated, s.created from public.spaces s order by s.created;
end $$;

-- ---------- Personen in Räumen ----------
-- Jedes Gerät meldet sich beim Abgleich mit Namen (verschlüsselt mit dem Raumschlüssel); die Rolle bestimmt der Server aus dem Token
create or replace function public.member_ping(p_id text, p_t text, p_dev text, p_name_enc text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare r text := public.sp_role2(p_id, p_t);
begin
  if r is null then raise exception 'kein zugriff'; end if;
  if char_length(coalesce(p_name_enc, '')) > 4000 then raise exception 'zu gross'; end if;
  if (select count(*) from public.members where space_id = p_id) >= 100 and not exists (select 1 from public.members where space_id = p_id and dev = p_dev) then raise exception 'zu viele personen'; end if;
  insert into public.members(space_id, dev, name_enc, role, last_seen) values (p_id, p_dev, coalesce(p_name_enc, ''), r, now())
  on conflict (space_id, dev) do update set name_enc = excluded.name_enc, role = excluded.role, last_seen = now();
  return r;
end $$;

create or replace function public.member_list(p_id text, p_t text)
returns table(dev text, name_enc text, role text, last_seen timestamptz) language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if public.sp_role2(p_id, p_t) is null then raise exception 'kein zugriff'; end if;
  return query select m.dev, m.name_enc, m.role, m.last_seen from public.members m where m.space_id = p_id order by m.role, m.last_seen desc;
end $$;

-- Person aus der Liste entfernen (Besitzer oder Admin). Den Zugang sperrt erst "Zugang erneuern".
create or replace function public.member_remove(p_id text, p_t text, p_dev text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare r text := public.sp_role2(p_id, p_t);
begin
  if r is null or r not in ('o', 'A') then raise exception 'nur besitzer oder admin'; end if;
  delete from public.members where space_id = p_id and dev = p_dev;
  return true;
end $$;

-- ---------- Rechte ----------
revoke all on function public.club_role(text) from public, anon, authenticated;
revoke all on function public.sp_role2(text, text) from public, anon, authenticated;
grant execute on function public.club_get() to anon;
grant execute on function public.club_setup(text, text, text) to anon;
grant execute on function public.club_admin_rotate(text, text, text) to anon;
grant execute on function public.club_func_set(text, text, text) to anon;
grant execute on function public.club_ping(text, text, text) to anon;
grant execute on function public.club_members_list(text) to anon;
grant execute on function public.club_member_remove(text, text) to anon;
grant execute on function public.space_create(text, text, text, text, text, text, text) to anon;
grant execute on function public.space_get(text, text) to anon;
grant execute on function public.space_put(text, text, text, bigint) to anon;
grant execute on function public.space_rekey(text, text, text, text, text, text, text) to anon;
grant execute on function public.space_setwrap(text, text, text, text) to anon;
grant execute on function public.space_delete(text, text) to anon;
grant execute on function public.space_list(text) to anon;
grant execute on function public.member_ping(text, text, text, text) to anon;
grant execute on function public.member_list(text, text) to anon;
grant execute on function public.member_remove(text, text, text) to anon;

-- Einmal-Code für das Einrichten des Admins setzen (Wert NICHT in dieser Datei speichern):
--   update public.club set setup_hash = public.sp_hash('<code>') where id = 1 and admin_hash is null;
