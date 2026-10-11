-- voices.sql — WHO OWNS A CHARACTER VOICE (2026-10-11, owner — "every user can use their own voice or that of
-- another person"; voice review). Every designed or cloned voice lives in the studio's ONE voice-provider account, so
-- the provider can't tell users apart: this file is the record of whose voice each one is, the consent given for a
-- real person's voice, and the films it may speak in. image-proxy (service role) writes it; nothing else does.
--
--   turn_voices       one row per designed or cloned voice: its owner (the account that holds it — on a shared film,
--                     the film's OWNER, who pays), who made it, for a real voice WHOSE voice it is and the consent
--                     attested (who, when, 18 or over, the wording's version). A deleted voice keeps its row
--                     (deleted_at): the voice provider's terms ask for consent records to be kept for 5 years.
--   turn_voice_films  the films (or Shows) a voice is linked to: anyone on that film may voice lines with it.
--
-- turn_voice_access(voice, user, project) says whether a user may speak with a voice: 'owned' (theirs), 'film' (linked
-- to the film in the request, or its Show, and the user owns it or is an active member), 'deleted', 'unknown' (not a
-- recorded voice: the proxy then allows only the provider's stock voices) or 'denied'.
-- turn_voice_link(voice, user, project) links a voice to a film for a user who owns the voice (or whose film's owner
-- does) and is on that film.
--
-- Safe to run more than once, in any order after schema.sql and team-collaboration.sql (it reads turn_projects and
-- turn_project_members). Tests: scripts/test-voice-registry-db.mjs.

create table if not exists public.turn_voices (
  voice_id     text primary key,
  owner        uuid not null,
  created_by   uuid not null,
  kind         text not null check (kind in ('cloned', 'designed')),
  person_kind  text check (person_kind in ('me', 'someone')),
  person_name  text,
  label        text not null default '',
  consent      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid,
  constraint turn_voices_real_voice_consent check (
    kind <> 'cloned' or (person_kind is not null and (consent ->> 'attestedAt') is not null and (consent ->> 'adult') = 'true'))
);
create index if not exists turn_voices_owner_idx on public.turn_voices(owner) where deleted_at is null;

create table if not exists public.turn_voice_films (
  voice_id    text not null references public.turn_voices(voice_id) on delete cascade,
  project_id  uuid not null references public.turn_projects(id) on delete cascade,
  linked_by   uuid not null,
  linked_at   timestamptz not null default now(),
  primary key (voice_id, project_id)
);
create index if not exists turn_voice_films_project_idx on public.turn_voice_films(project_id);

alter table public.turn_voices enable row level security;
alter table public.turn_voice_films enable row level security;
revoke all on public.turn_voices from anon, authenticated;
revoke all on public.turn_voice_films from anon, authenticated;
grant select on public.turn_voices to authenticated;
grant all on public.turn_voices to service_role;
grant all on public.turn_voice_films to service_role;
drop policy if exists turn_voices_select_own on public.turn_voices;
create policy turn_voices_select_own on public.turn_voices for select to authenticated using (owner = auth.uid());

-- is this user on this film: its owner, or an active, linked member
create or replace function public.turn_voice_user_on_film(p_user uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.turn_projects p where p.id = p_project and p.owner = p_user)
      or exists (select 1 from public.turn_project_members m
                  where m.project_id = p_project and m.member_user = p_user and m.status = 'active');
$$;

create or replace function public.turn_voice_access(p_voice text, p_user uuid, p_project uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v public.turn_voices%rowtype;
  show_id text;
begin
  select * into v from public.turn_voices where voice_id = p_voice;
  if not found then return 'unknown'; end if;
  if v.deleted_at is not null then return 'deleted'; end if;
  if v.owner = p_user then return 'owned'; end if;
  if p_project is null then return 'denied'; end if;
  select p.doc ->> 'showId' into show_id from public.turn_projects p where p.id = p_project;
  if not exists (select 1 from public.turn_voice_films f
                  where f.voice_id = p_voice and (f.project_id = p_project or f.project_id::text = show_id)) then
    return 'denied';
  end if;
  if public.turn_voice_user_on_film(p_user, p_project) then return 'film'; end if;
  return 'denied';
end $$;

create or replace function public.turn_voice_link(p_voice text, p_user uuid, p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v public.turn_voices%rowtype;
  film_owner uuid;
begin
  select * into v from public.turn_voices where voice_id = p_voice;
  if not found then return 'unknown'; end if;
  if v.deleted_at is not null then return 'deleted'; end if;
  select p.owner into film_owner from public.turn_projects p where p.id = p_project;
  if film_owner is null then return 'no_film'; end if;
  if not public.turn_voice_user_on_film(p_user, p_project) then return 'denied'; end if;
  if v.owner <> p_user and v.owner <> film_owner then return 'denied'; end if;
  insert into public.turn_voice_films(voice_id, project_id, linked_by) values (p_voice, p_project, p_user)
    on conflict (voice_id, project_id) do nothing;
  return 'linked';
end $$;

revoke all on function public.turn_voice_user_on_film(uuid, uuid) from public, anon, authenticated;
revoke all on function public.turn_voice_access(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.turn_voice_link(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.turn_voice_user_on_film(uuid, uuid) to service_role;
grant execute on function public.turn_voice_access(text, uuid, uuid) to service_role;
grant execute on function public.turn_voice_link(text, uuid, uuid) to service_role;
