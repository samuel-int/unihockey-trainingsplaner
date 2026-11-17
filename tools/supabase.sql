-- Mannschaftsraum für den Trainingsplaner (Supabase / Postgres)
-- Einmal im SQL-Editor des Supabase-Projekts ausführen. Mehrfaches Ausführen ist unschädlich.
--
-- Prinzip: Pro geteilter Mannschaft gibt es einen Raum (Zeile in "spaces").
-- Die App verschlüsselt den Inhalt auf dem Gerät (AES-GCM); der Schlüssel steht nur im Einladungslink
-- (im #-Teil der Adresse, der nie an einen Server geht). Der Server speichert nur Chiffretext.
-- Zugriff über drei Zugangstoken, gespeichert nur als SHA-256-Hash:
--   o = Besitzer (lesen, schreiben, Zugang erneuern, löschen)
--   w = Co-Trainer (lesen, schreiben)
--   r = nur lesen
-- Die Tabelle ist für die öffentliche Rolle gesperrt; erreichbar ist sie nur über die Funktionen unten.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.spaces (
  id      text primary key check (char_length(id) between 16 and 64),
  data    text not null default '',
  ver     bigint not null default 1,
  o_hash  text not null,
  w_hash  text not null,
  r_hash  text not null,
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
alter table public.spaces enable row level security;
revoke all on table public.spaces from anon, authenticated;

create or replace function public.sp_hash(t text) returns text
language sql immutable set search_path = public, extensions
as $$ select encode(extensions.digest(coalesce(t, ''), 'sha256'), 'hex') $$;

create or replace function public.sp_role(p_id text, p_t text) returns text
language sql stable security definer set search_path = public, extensions
as $$
  select case when s.o_hash = public.sp_hash(p_t) then 'o'
              when s.w_hash = public.sp_hash(p_t) then 'w'
              when s.r_hash = public.sp_hash(p_t) then 'r' end
  from public.spaces s where s.id = p_id
$$;

-- Raum anlegen (Grenzen gegen Missbrauch: Grösse pro Raum, Anzahl Räume insgesamt)
create or replace function public.space_create(p_id text, p_o text, p_w text, p_r text, p_data text)
returns bigint language plpgsql security definer set search_path = public, extensions
as $$
begin
  if char_length(coalesce(p_data, '')) > 3000000 then raise exception 'zu gross'; end if;
  if char_length(coalesce(p_o, '')) < 20 or char_length(coalesce(p_w, '')) < 20 or char_length(coalesce(p_r, '')) < 20 then raise exception 'token zu kurz'; end if;
  if p_o = p_w or p_o = p_r or p_w = p_r then raise exception 'token muessen verschieden sein'; end if;
  if (select count(*) from public.spaces) >= 500 then raise exception 'limit erreicht'; end if;
  if (select count(*) from public.spaces where created > now() - interval '1 day') >= 30 then raise exception 'zu viele neue raeume, spaeter nochmals versuchen'; end if;
  if exists (select 1 from public.spaces where id = p_id) then raise exception 'raum existiert schon'; end if;
  insert into public.spaces(id, data, ver, o_hash, w_hash, r_hash)
  values (p_id, coalesce(p_data, ''), 1, public.sp_hash(p_o), public.sp_hash(p_w), public.sp_hash(p_r));
  return 1;
end $$;

-- Raum lesen: liefert Inhalt, Version und Rolle des Tokens; ohne gültiges Token nichts
create or replace function public.space_get(p_id text, p_t text)
returns table(data text, ver bigint, role text) language plpgsql stable security definer set search_path = public, extensions
as $$
declare r text := public.sp_role(p_id, p_t);
begin
  if r is null then raise exception 'kein zugriff'; end if;
  return query select s.data, s.ver, r from public.spaces s where s.id = p_id;
end $$;

-- Raum schreiben, nur wenn die Version noch stimmt (sonst ok=false und aktuelle Version: neu lesen, zusammenführen, nochmals)
create or replace function public.space_put(p_id text, p_t text, p_data text, p_ver bigint)
returns table(ok boolean, ver bigint) language plpgsql security definer set search_path = public, extensions
as $$
declare r text := public.sp_role(p_id, p_t); n bigint;
begin
  if r is null or r = 'r' then raise exception 'kein schreibrecht'; end if;
  if char_length(coalesce(p_data, '')) > 3000000 then raise exception 'zu gross'; end if;
  update public.spaces s set data = p_data, ver = s.ver + 1, updated = now()
   where s.id = p_id and s.ver = p_ver returning s.ver into n;
  if n is null then return query select false, s.ver from public.spaces s where s.id = p_id;
  else return query select true, n; end if;
end $$;

-- Zugang erneuern (nur Besitzer): neue Token für Co-Trainer und Lesende, neuer Inhalt (mit neuem Schlüssel verschlüsselt).
-- Alte Einladungslinks funktionieren danach nicht mehr.
create or replace function public.space_rekey(p_id text, p_o text, p_w text, p_r text, p_data text)
returns bigint language plpgsql security definer set search_path = public, extensions
as $$
declare n bigint;
begin
  if public.sp_role(p_id, p_o) is distinct from 'o' then raise exception 'nur besitzer'; end if;
  if char_length(coalesce(p_w, '')) < 20 or char_length(coalesce(p_r, '')) < 20 then raise exception 'token zu kurz'; end if;
  if p_w = p_r or p_w = p_o or p_r = p_o then raise exception 'token muessen verschieden sein'; end if;
  if char_length(coalesce(p_data, '')) > 3000000 then raise exception 'zu gross'; end if;
  update public.spaces s set w_hash = public.sp_hash(p_w), r_hash = public.sp_hash(p_r), data = coalesce(p_data, s.data), ver = s.ver + 1, updated = now()
   where s.id = p_id returning s.ver into n;
  return n;
end $$;

-- Raum löschen (nur Besitzer)
create or replace function public.space_delete(p_id text, p_o text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
begin
  if public.sp_role(p_id, p_o) is distinct from 'o' then raise exception 'nur besitzer'; end if;
  delete from public.spaces where id = p_id;
  return true;
end $$;

-- Aufräumen (von Hand im SQL-Editor, bei Bedarf): Räume, die seit über 18 Monaten nicht mehr geschrieben wurden
--   delete from public.spaces where updated < now() - interval '18 months';

revoke all on function public.sp_role(text, text) from public, anon, authenticated;
revoke all on function public.sp_hash(text) from public, anon, authenticated;
grant execute on function public.space_create(text, text, text, text, text) to anon;
grant execute on function public.space_get(text, text) to anon;
grant execute on function public.space_put(text, text, text, bigint) to anon;
grant execute on function public.space_rekey(text, text, text, text, text) to anon;
grant execute on function public.space_delete(text, text) to anon;
