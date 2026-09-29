-- ============================================================================
-- Kinolot — Frances's daily question limit (supabase/frances-daily-limit.sql)
-- Owner decision 2026-09-28. Written 2026-09-29; run on production by the owner 2026-09-29 (every RESULT row ok).
--
-- PURPOSE
--   Chatting with Frances, the in-app help assistant, stays free: up to 50
--   questions per person per day (UTC), so nobody can use her as a free
--   general AI. The image-proxy Edge Function asks this file's function for a
--   slot before every free Frances question; with none left it answers 429
--   "frances_daily_limit" and calls no model, and the app shows a calm reply
--   from Frances saying when she'll be back.
--
-- WHAT IT CREATES
--   public.turn_frances_usage   one row per account per UTC day: how many free
--                               questions were asked. Row-level security ON with
--                               NO policies, and no grants to anon, authenticated
--                               or public: only the function below (and postgres)
--                               read or write it. Rows go with their account
--                               (on delete cascade).
--   public.turn_frances_consume(p_user uuid, p_limit integer) returns jsonb
--                               {allowed, used, limit, resets_at} (plus busy: true
--                               on a busy refusal, below): takes one slot if one is
--                               left today. SECURITY DEFINER with a pinned (empty)
--                               search_path and a 1 s lock_timeout; it refuses
--                               unless the caller is service_role (the image-proxy
--                               function's service-role client), and EXECUTE is
--                               granted to service_role only.
--
-- HOW IT COUNTS
--   day = the UTC date; resets_at = the next UTC midnight ("YYYY-MM-DDT00:00:00Z").
--   One INSERT ... ON CONFLICT DO UPDATE ... WHERE questions < p_limit takes the
--   slot: Postgres locks the day's row, so two questions sent together can never
--   both take the 50th slot, and a refused question changes nothing.
--   BUSY: only one person's own calls ever wait for their row, and the app sends
--   one question at a time. So a call still waiting after 1 s (lock_timeout,
--   SQLSTATE 55P03) is one of a burst of that person's parallel calls: it is
--   refused with busy: true and counts nothing; image-proxy answers 429
--   "frances_busy" with no model call. (Without this, a big enough burst could
--   queue past image-proxy's 8 s wait, which fails open, and be served.) The first
--   question of a person's day also deletes usage rows older than 35 days (never
--   blocking the question if that tidy-up fails).
--
-- THE LIMIT ITSELF
--   lives in the image-proxy secret FRANCES_DAILY_LIMIT (default 50); nothing
--   here needs to change to move it (but Frances's own facts in app/ai.jsx name
--   the number too: see supabase/README.md). Admins are never counted.
--
-- BEFORE THIS FILE IS RUN (or if the call ever fails)
--   image-proxy FAILS OPEN: Frances answers every question and the function logs
--   the problem once per instance (a missing function, an error, or no answer
--   within 8 s). The older safeguard still applies meanwhile:
--   past 200 free Frances calls in any 24 hours, replies are metered like writing
--   (supabase/functions/image-proxy/muse-billing.mjs).
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste this WHOLE file -> Run,
--   as postgres (the SQL Editor's role). It needs only Supabase Auth; no other
--   file has to run first. The whole file is one transaction: a stopped or
--   failed run changes nothing. Safe to re-run at any time: the table and index
--   are created only when missing, counts are kept, and the function, its
--   grants and the table's lock-down are put back exactly as below.
--   The editor then shows a small table (item / status / detail): rows 10-50
--   must read 'ok'; row 60 counts today's questions.
--
-- HOW TO REMOVE IT
--   drop function if exists public.turn_frances_consume(uuid, integer);
--   drop table if exists public.turn_frances_usage;
--   (image-proxy then fails open again: no daily limit on Frances.)
-- ============================================================================
begin;

do $preflight$
declare
  missing text;
begin
  select string_agg(r, ', ' order by r) into missing
    from unnest(array['anon', 'authenticated', 'service_role']) r
   where not exists (select 1 from pg_catalog.pg_roles x where x.rolname = r);
  if missing is not null then
    raise exception 'Frances daily limit: missing roles % (run this on the Supabase database). Nothing was created.', missing;
  end if;
  if to_regclass('auth.users') is null or to_regprocedure('auth.role()') is null then
    raise exception 'Frances daily limit: Supabase Auth (auth.users, auth.role()) is missing. Nothing was created.';
  end if;
end;
$preflight$;

-- ── the day's counts ────────────────────────────────────────────────────────
create table if not exists public.turn_frances_usage (
  user_id   uuid    not null references auth.users(id) on delete cascade,
  day       date    not null,
  questions integer not null default 0 check (questions >= 0),
  primary key (user_id, day)
);
comment on table public.turn_frances_usage is
  'Kinolot: free Frances questions per account per UTC day (frances-daily-limit.sql). Written only by turn_frances_consume(); no API access.';
-- the tidy-up of old days reads by day
create index if not exists turn_frances_usage_day_idx on public.turn_frances_usage (day);

-- row-level security ON with no policies: nothing reaches a row through the API
alter table public.turn_frances_usage enable row level security;
do $policies$
declare
  p record;
begin
  for p in select pol.polname from pg_catalog.pg_policy pol
            where pol.polrelid = 'public.turn_frances_usage'::regclass
  loop
    execute format('drop policy %I on public.turn_frances_usage', p.polname);
  end loop;
end;
$policies$;
-- after creating: Supabase's default privileges grant new tables to anon and
-- authenticated directly, so "from public" alone would not be enough
revoke all on table public.turn_frances_usage from public, anon, authenticated;

-- ── take one question slot ──────────────────────────────────────────────────
create or replace function public.turn_frances_consume(p_user uuid, p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
declare
  v_day     date := (pg_catalog.now() at time zone 'UTC')::date;
  v_used    integer;
  v_allowed boolean;
  v_busy    boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'TURN_FRANCES_LIMIT: service role required';
  end if;
  if p_user is null then
    raise exception using errcode = '22023', message = 'TURN_FRANCES_LIMIT: a user is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception using errcode = '22023', message = 'TURN_FRANCES_LIMIT: the limit must be between 1 and 100000';
  end if;

  -- ONE statement takes the slot. A conflicting row is locked and re-checked
  -- against its latest count, so parallel calls queue and the WHERE lets through
  -- only those still under the limit; a refused call updates nothing.
  begin
    insert into public.turn_frances_usage as u (user_id, day, questions)
    values (p_user, v_day, 1)
    on conflict (user_id, day) do update
       set questions = u.questions + 1
     where u.questions < p_limit
    returning u.questions into v_used;
    v_allowed := found;
  exception when lock_not_available then
    -- still waiting for this person's row after lock_timeout (1 s): only their
    -- own calls hold it, so this is one of a burst of their parallel calls.
    -- Refuse it as busy; the insert is rolled back, so nothing is counted.
    v_allowed := false;
    v_busy    := true;
  end;

  if not v_allowed then
    select u.questions into v_used
      from public.turn_frances_usage u
     where u.user_id = p_user and u.day = v_day;
  elsif v_used = 1 then
    -- first question of this person's day: tidy up days older than 35 days.
    -- Housekeeping only; a failure here never costs the question its answer.
    begin
      delete from public.turn_frances_usage u where u.day < v_day - 35;
    exception when others then
      null;
    end;
  end if;

  return pg_catalog.jsonb_build_object(
    'allowed',   v_allowed,
    'used',      coalesce(v_used, 0),
    'limit',     p_limit,
    'resets_at', pg_catalog.to_char((v_day + 1)::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    || case when v_busy then pg_catalog.jsonb_build_object('busy', true) else '{}'::jsonb end;
end;
$$;
comment on function public.turn_frances_consume(uuid, integer) is
  'Kinolot: take one free Frances question slot for today (UTC) if one is left; returns {allowed, used, limit, resets_at}. service_role only (image-proxy).';

revoke all on function public.turn_frances_consume(uuid, integer) from public, anon, authenticated;
grant execute on function public.turn_frances_consume(uuid, integer) to service_role;

-- let the Data API see the new function now (Supabase usually reloads on DDL by itself; until it
-- does, image-proxy would find no function and keep failing open)
notify pgrst, 'reload schema';

commit;

-- ── RESULT — the table the SQL Editor shows after Run ───────────────────────
select r.item, r.status, r.detail
  from (
    select 10 as ord, 'Usage table' as item,
           case when (select count(*) from pg_catalog.pg_attribute a
                       where a.attrelid = to_regclass('public.turn_frances_usage')
                         and a.attname in ('user_id', 'day', 'questions') and a.attnum > 0 and not a.attisdropped) = 3
                 and exists (select 1 from pg_catalog.pg_constraint k
                              where k.conrelid = to_regclass('public.turn_frances_usage') and k.contype = 'p'
                                and pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (user_id, day)')
                then 'ok' else 'FAIL — re-run the whole file' end as status,
           'public.turn_frances_usage: one row per account per UTC day' as detail
    union all
    select 15, 'Rows go with their account',
           case when exists (select 1 from pg_catalog.pg_constraint k
                              where k.conrelid = to_regclass('public.turn_frances_usage') and k.contype = 'f'
                                and k.confrelid = to_regclass('auth.users') and k.confdeltype = 'c')
                then 'ok' else 'FAIL — re-run the whole file' end,
           'user_id references auth.users on delete cascade'
    union all
    select 20, 'Row-level security on, no policies',
           case when coalesce((select c.relrowsecurity from pg_catalog.pg_class c
                                where c.oid = to_regclass('public.turn_frances_usage')), false)
                 and not exists (select 1 from pg_catalog.pg_policy p
                                  where p.polrelid = to_regclass('public.turn_frances_usage'))
                then 'ok' else 'FAIL — re-run the whole file' end,
           'nothing reaches a row through the API'
    union all
    select 30, 'No API access to the table',
           case when not has_table_privilege('anon', to_regclass('public.turn_frances_usage'),
                       'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                 and not has_table_privilege('authenticated', to_regclass('public.turn_frances_usage'),
                       'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                then 'ok' else 'FAIL — an API role still has access; re-run the whole file' end,
           'no privilege for anon, authenticated or public'
    union all
    select 40, 'Daily-limit function',
           case when exists (select 1 from pg_catalog.pg_proc p
                              where p.oid = to_regprocedure('public.turn_frances_consume(uuid, integer)')
                                and p.prosecdef
                                and p.prorettype = 'jsonb'::regtype
                                and exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
                                             where cfg like 'search_path=%')
                                and exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
                                             where cfg like 'lock_timeout=%'))
                then 'ok' else 'FAIL — re-run the whole file' end,
           'turn_frances_consume(uuid, integer): security definer, pinned search_path, 1 s lock_timeout, service role only inside'
    union all
    select 50, 'Only the service role can call it',
           case when has_function_privilege('service_role', to_regprocedure('public.turn_frances_consume(uuid, integer)'), 'EXECUTE')
                 and not has_function_privilege('anon', to_regprocedure('public.turn_frances_consume(uuid, integer)'), 'EXECUTE')
                 and not has_function_privilege('authenticated', to_regprocedure('public.turn_frances_consume(uuid, integer)'), 'EXECUTE')
                then 'ok' else 'FAIL — re-run the whole file' end,
           'EXECUTE for service_role only (image-proxy)'
    union all
    select 60, 'Questions asked today (UTC)',
           (select 'accounts: ' || count(*) || ' · questions: ' || coalesce(sum(u.questions), 0)
              from public.turn_frances_usage u
             where u.day = (now() at time zone 'UTC')::date),
           'the limit is the image-proxy secret FRANCES_DAILY_LIMIT (default 50)'
  ) r
 order by r.ord;
