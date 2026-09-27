-- ============================================================================
-- TURN: READ-ONLY production probe for supabase/series-production.sql
--
-- Paste the WHOLE file into the Supabase SQL Editor and press Run. It is one
-- SELECT statement, so the editor shows one table. It changes nothing.
-- Run it before series-production.sql (is the database ready, what will the
-- backfill change?) and again after it (are the Show functions installed?).
-- Its STOP rows match the checks series-production.sql makes before it
-- creates anything (section 0 of that file) plus the data problems that make
-- the run fail; either way a stopped run changes nothing.
--
-- It never names a table that might be missing: every data count goes through
-- a catalog check first (to_regclass / to_regprocedure / pg_attribute) and is
-- run only when the table and its columns exist. Missing things show up as rows
-- with status STOP or "n/a". It lists project ids, never emails.
--
-- How to read the "status" column:
--   STOP    do not run series-production.sql until this is fixed
--   REVIEW  the migration will change access or data here; look before running
--   INFO    for the record
--   OK      nothing to do
-- The first row ("Overall") summarises the rest.
-- ============================================================================
with
cat as materialized (
  select
    current_setting('server_version_num')::int                                   as pgver,
    current_setting('server_version')                                            as pgver_txt,
    current_user::text                                                           as who,
    coalesce((select r.rolsuper     from pg_roles r where r.rolname = current_user), false) as is_super,
    coalesce((select r.rolbypassrls from pg_roles r where r.rolname = current_user), false) as is_bypass,
    to_regclass('public.turn_projects')              is not null as has_projects,
    to_regclass('public.turn_generations')           is not null as has_generations,
    to_regclass('public.turn_project_members')       is not null as has_members,
    to_regclass('public.turn_cameos')                is not null as has_cameos,
    to_regclass('auth.users')                        is not null as has_users,
    to_regclass('storage.objects')                   is not null as has_objects,
    to_regclass('storage.buckets')                   is not null as has_buckets,
    to_regclass('public.turn_asset_upload_intents')  is not null as has_intents,
    to_regclass('public.turn_asset_cleanup_queue')   is not null as has_queue,
    to_regclass('public.turn_asset_cleanup_grants')  is not null as has_grants,
    to_regclass('public.turn_credits')               is not null as has_credits,
    to_regprocedure('auth.uid()')                    is not null as has_uid,
    to_regprocedure('auth.role()')                   is not null as has_role,
    to_regprocedure('auth.jwt()')                    is not null as has_jwt,
    to_regprocedure('storage.foldername(text)')      is not null as has_foldername,
    to_regprocedure('public.turn_current_email()')   is not null as has_current_email,
    to_regprocedure('public.turn_storage_project_id(text)') is not null as has_storage_pid,
    to_regprocedure('public.turn_claim_memberships()') is not null as has_invitations,
    to_regnamespace('turn_admin')                    is not null as has_admin_inventory,
    (select pg_get_function_result(p.oid) from pg_proc p
      where p.oid = to_regprocedure('public.turn_role_allowed_sections(text)'))   as sections_result,
    (select p.proargnames::text from pg_proc p
      where p.oid = to_regprocedure('public.turn_can_access_project(uuid, boolean)')) as access_args,
    (select p.proargnames::text from pg_proc p
      where p.oid = to_regprocedure('public.turn_can_write_assets(uuid)'))         as write_args,
    (select pg_get_function_result(p.oid) from pg_proc p
      where p.oid = to_regprocedure('public.turn_shared_film_owners()'))           as owners_result,
    exists (select 1 from pg_trigger t
             where t.tgrelid = to_regclass('public.turn_projects')
               and t.tgname = 'turn_enforce_role_sections' and not t.tgisinternal) as has_enforce_trigger,
    exists (select 1 from pg_trigger t
             where t.tgrelid = to_regclass('public.turn_generations')
               and t.tgname = 'turn_generations_keep_owner' and not t.tgisinternal) as has_keep_owner,
    exists (select 1 from pg_index i
             where i.indrelid = to_regclass('public.turn_project_members')
               and i.indisunique and i.indpred is null and i.indexprs is null
               and i.indnkeyatts = 2
               and (select array_agg(a.attname::text order by a.attname::text)
                      from pg_attribute a
                     where a.attrelid = i.indrelid
                       and a.attnum = any (i.indkey::int2[])) = array['member_email', 'project_id']) as has_member_unique,
    (select string_agg(r, ', ' order by r)
       from unnest(array['anon', 'authenticated', 'service_role']) r
      where not exists (select 1 from pg_roles x where x.rolname = r))              as roles_missing,
    (select string_agg(f, ', ' order by f)
       from unnest(array['gen_random_uuid()', 'hashtextextended(text,bigint)', 'pg_advisory_xact_lock(bigint)']) f
      where to_regprocedure(f) is null)                                             as builtins_missing,
    (select string_agg(e.extname, ', ' order by e.extname) from pg_extension e)     as extensions,
    (select string_agg(pl.policyname || ' [' || pl.cmd || ']', ' | ' order by pl.policyname)
       from pg_policies pl where pl.schemaname = 'storage' and pl.tablename = 'objects') as storage_policies,
    exists (select 1 from pg_policies pl
             where pl.schemaname = 'storage' and pl.tablename = 'objects'
               and pl.policyname = 'turn assets read collab')                       as has_read_collab,
    (select string_agg(pl.policyname || ' [' || pl.cmd || ']', ' | ' order by pl.policyname)
       from pg_policies pl where pl.schemaname = 'public' and pl.tablename = 'turn_cameos') as cameo_policies,
    exists (select 1
              from pg_default_acl d
              cross join lateral aclexplode(d.defaclacl) a
             where d.defaclobjtype = 'f'
               and d.defaclrole = (select r.oid from pg_roles r where r.rolname = current_user)
               and (d.defaclnamespace = 0 or d.defaclnamespace = to_regnamespace('public')::oid)
               and a.grantee in (select r.oid from pg_roles r where r.rolname in ('anon', 'authenticated'))
               and a.privilege_type = 'EXECUTE')                                    as anon_default_exec,
    (select string_agg(f, ', ' order by f)
       from unnest(array[
         'public.turn_convert_project_to_show(uuid,text,jsonb,text)',
         'public.turn_create_show_episode(uuid,jsonb,uuid)',
         'public.turn_delete_show_episode(uuid)',
         'public.turn_delete_show(uuid)']) f
      where to_regprocedure(f) is not null)                                         as rpcs_present,
    exists (select 1 from pg_proc p
             where p.oid in (to_regprocedure('public.turn_delete_show_episode(uuid)'),
                             to_regprocedure('public.turn_delete_show(uuid)'))
               and p.prosrc like '%versions(history)%')                             as rpcs_have_delete_bug,
    (select count(*) from pg_stat_activity s
      where s.state like 'idle in transaction%' and s.pid <> pg_backend_pid())      as idle_in_tx
),
cols as materialized (
  select n.nspname || '.' || c.relname || '.' || a.attname as k
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'auth', 'storage')
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and a.attnum > 0 and not a.attisdropped
),
need(tbl, col) as (
  values
    ('public.turn_projects', 'id'), ('public.turn_projects', 'owner'), ('public.turn_projects', 'title'),
    ('public.turn_projects', 'doc'), ('public.turn_projects', 'created_at'), ('public.turn_projects', 'updated_at'),
    ('public.turn_generations', 'project_id'), ('public.turn_generations', 'owner'), ('public.turn_generations', 'entity_id'),
    ('public.turn_generations', 'storage_path'), ('public.turn_generations', 'meta'), ('public.turn_generations', 'refs'),
    ('public.turn_generations', 'history'),
    ('public.turn_project_members', 'id'), ('public.turn_project_members', 'project_id'), ('public.turn_project_members', 'owner'),
    ('public.turn_project_members', 'member_email'), ('public.turn_project_members', 'member_user'),
    ('public.turn_project_members', 'role'), ('public.turn_project_members', 'status'),
    ('public.turn_project_members', 'created_at'), ('public.turn_project_members', 'updated_at'),
    ('public.turn_cameos', 'project_id'), ('public.turn_cameos', 'owner'), ('public.turn_cameos', 'char_id'),
    ('public.turn_cameos', 'angles'),
    ('auth.users', 'id'), ('auth.users', 'email'),
    ('storage.objects', 'bucket_id'), ('storage.objects', 'name'),
    ('storage.buckets', 'id'),
    ('public.turn_asset_cleanup_grants', 'path')
),
miss as materialized (
  select t.tbl,
         (select string_agg(nd.col, ', ' order by nd.col)
            from need nd
           where nd.tbl = t.tbl
             and not exists (select 1 from cols where cols.k = nd.tbl || '.' || nd.col)) as missing
    from (select distinct tbl from need) t
),
ready as materialized (
  select
    (select missing is null from miss where tbl = 'public.turn_projects')        as projects_ok,
    (select missing        from miss where tbl = 'public.turn_projects')        as projects_missing,
    (select missing is null from miss where tbl = 'public.turn_generations')     as generations_ok,
    (select missing        from miss where tbl = 'public.turn_generations')     as generations_missing,
    (select missing is null from miss where tbl = 'public.turn_project_members') as members_ok,
    (select missing        from miss where tbl = 'public.turn_project_members') as members_missing,
    (select missing is null from miss where tbl = 'public.turn_cameos')          as cameos_ok,
    (select missing        from miss where tbl = 'public.turn_cameos')          as cameos_missing,
    (select missing is null from miss where tbl = 'auth.users')                  as users_ok,
    (select missing is null from miss where tbl = 'storage.objects')             as objects_ok,
    (select missing is null from miss where tbl = 'storage.buckets')             as buckets_ok,
    (select missing is null from miss where tbl = 'public.turn_asset_cleanup_grants') as grants_path_ok,
    (select string_agg(c, ', ' order by c)
       from unnest(array['project_kind', 'show_id', 'episode_no']) c
      where exists (select 1 from cols where cols.k = 'public.turn_projects.' || c)) as series_cols_present
),
-- Each entry runs only when its guard is true, so a missing table is never
-- referenced. query_to_xml runs the (read-only) SELECT and returns one row.
dyn(key, ok, sql) as (
  select 'p', r.projects_ok, $q$
    with p as (
      select id, owner, doc, created_at,
             lower(coalesce(doc ->> 'isShow', 'false')) = 'true' as is_show,
             nullif(btrim(doc ->> 'showId'), '') as raw_show,
             case when btrim(doc ->> 'showId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  then btrim(doc ->> 'showId')::uuid end as show_uuid,
             case when btrim(doc ->> 'episodeNo') ~ '^[1-9][0-9]*$' and length(btrim(doc ->> 'episodeNo')) <= 10
                  then case when btrim(doc ->> 'episodeNo')::numeric <= 2147483647
                            then btrim(doc ->> 'episodeNo')::numeric::int end end as ep_no
        from public.turn_projects
    ),
    s as (select * from p where is_show),
    e as (
      select c.*, sh.id as parent, sh.doc as parent_doc
        from p c join p sh on sh.id = c.show_uuid
       where sh.is_show and not c.is_show and c.ep_no is not null
         and c.id <> sh.id and c.owner = sh.owner
    ),
    src as (   -- same rule as the migration: a recorded sourceEpisodeId (even null) is final;
               -- a Show that never recorded one gets Episode 1, or null when it has no Episode 1
      select distinct on (sh.id) sh.id as show_id, e.id as episode_id, e.ep_no,
             sh.doc ? 'sourceEpisodeId' as recorded
        from s sh join e on e.parent = sh.id
       where (not (sh.doc ? 'sourceEpisodeId') and e.ep_no = 1)
          or e.id::text = lower(btrim(sh.doc ->> 'sourceEpisodeId'))
       order by sh.id, e.id
    ),
    depts(d, t) as (values ('characters', 'array'), ('locations', 'array'), ('props', 'array'),
                           ('lookbook', 'array'), ('lookbookNote', 'string')),
    showdept as (   -- the value the migration adopts for each Show department (Bible first, then Show root)
      select sh.id, dp.d, dp.t,
             case when jsonb_typeof(sh.doc -> 'bible') = 'object' and (sh.doc -> 'bible') ? dp.d then sh.doc -> 'bible' -> dp.d
                  when sh.doc ? dp.d then sh.doc -> dp.d end as v
        from s sh cross join depts dp
    ),
    trashrows as (select id, doc, false as is_ep from s union all select id, doc, true from e),
    tomb as (
      select tr.id, x.value as item
        from trashrows tr
        cross join unnest(array['characters', 'locations', 'props']) k
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(tr.doc -> 'trash' -> k) = 'array' then tr.doc -> 'trash' -> k else '[]'::jsonb end) x
      union all
      select sh.id, x.value
        from s sh
        cross join unnest(array['characters', 'locations', 'props']) k
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(sh.doc -> 'bible' -> 'trash' -> k) = 'array' then sh.doc -> 'bible' -> 'trash' -> k else '[]'::jsonb end) x
    ),
    badtrash as (
      select id from trashrows where doc ? 'trash' and jsonb_typeof(doc -> 'trash') is distinct from 'object'
      union
      select tr.id from trashrows tr cross join unnest(array['characters', 'locations', 'props']) k
       where jsonb_typeof(tr.doc -> 'trash') = 'object' and (tr.doc -> 'trash') ? k
         and jsonb_typeof(tr.doc -> 'trash' -> k) is distinct from 'array'
      union
      select id from e where jsonb_typeof(doc -> 'trash') = 'object' and (doc -> 'trash') ? 'shots'
         and jsonb_typeof(doc -> 'trash' -> 'shots') is distinct from 'array'
      union
      select id from s where jsonb_typeof(doc -> 'bible') = 'object' and (doc -> 'bible') ? 'trash'
         and jsonb_typeof(doc -> 'bible' -> 'trash') is distinct from 'object'
      union
      select id from tomb
       where jsonb_typeof(item) is distinct from 'object' or nullif(btrim(item ->> 'id'), '') is null
          or (item ? 'scenes' and jsonb_typeof(item -> 'scenes') is distinct from 'array')
          or (item ? 'episodeScenes' and jsonb_typeof(item -> 'episodeScenes') is distinct from 'object')
    ),
    badshow as (
      select id from showdept where v is not null and jsonb_typeof(v) is distinct from t
      union
      select sd.id from showdept sd
        cross join lateral jsonb_array_elements(case when jsonb_typeof(sd.v) = 'array' then sd.v else '[]'::jsonb end) x
       where sd.d in ('characters', 'locations', 'props')
         and (jsonb_typeof(x.value) is distinct from 'object' or nullif(btrim(x.value ->> 'id'), '') is null
              or (x.value ? 'scenes' and jsonb_typeof(x.value -> 'scenes') is distinct from 'array'))
    ),
    badep as (
      select e.id from e cross join depts dp
       where e.doc ? dp.d and jsonb_typeof(e.doc -> dp.d) is distinct from dp.t
    ),
    diverge as (
      select sd.id from showdept sd join e on e.parent = sd.id and e.doc ? sd.d
       where sd.v is null
       group by sd.id, sd.d having count(distinct e.doc -> sd.d) > 1
    ),
    epkeys as (
      select sh.id as show_id, m.key
        from s sh
        cross join unnest(array['characters', 'locations', 'props']) k
        cross join lateral (
          select value from jsonb_array_elements(
            case when jsonb_typeof(sh.doc -> 'bible' -> k) = 'array' then sh.doc -> 'bible' -> k else '[]'::jsonb end)
          union all
          select value from jsonb_array_elements(
            case when jsonb_typeof(sh.doc -> 'bible' -> 'trash' -> k) = 'array' then sh.doc -> 'bible' -> 'trash' -> k else '[]'::jsonb end)
        ) item(v)
        cross join unnest(array['episodeScenes', 'episodeLocationMeta']) mname
        cross join lateral jsonb_object_keys(
          case when jsonb_typeof(item.v -> mname) = 'object' then item.v -> mname else '{}'::jsonb end) m(key)
    ),
    lost as (
      select e.id
        from e join showdept sd on sd.id = e.parent and sd.d in ('characters', 'locations', 'props')
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(e.doc -> sd.d) = 'array' then e.doc -> sd.d else '[]'::jsonb end) x
       where jsonb_typeof(sd.v) = 'array'
         and not exists (select 1 from jsonb_array_elements(sd.v) b where b ->> 'id' = x.value ->> 'id')
    ),
    stripped as (
      select id from p
       where not is_show and (doc ? 'showId' or doc ? 'episodeNo' or doc ? 'seriesCreateRequestId')
         and id not in (select id from e)
    ),
    dupep as (select parent from e group by parent, ep_no having count(*) > 1),
    dupreq as (
      select parent from e where nullif(doc ->> 'seriesCreateRequestId', '') is not null
       group by parent, doc ->> 'seriesCreateRequestId' having count(*) > 1
    )
    select
      (select count(*) from p)                                                    as total,
      (select count(distinct owner) from p)                                       as owners,
      (select count(*) from p where doc ?| array['isShow', 'showId', 'episodeNo', 'bible',
                                                 'seriesCreateRequestId', 'sourceEpisodeId']) as marked,
      (select count(*) from s)                                                    as shows,
      (select count(*) from p where raw_show is not null and not is_show)         as epdocs,
      (select count(*) from e)                                                    as linked,
      (select count(*) from stripped)                                             as stripped,
      (select string_agg(id::text, ' ') from (select id from stripped order by id limit 3) z) as strippeds,
      (select count(*) from p where is_show and raw_show is not null)             as both,
      (select string_agg(id::text, ' ') from (select id from p where is_show and raw_show is not null order by id limit 3) z) as boths,
      (select count(*) from dupep)                                                as dupep,
      (select string_agg(parent::text, ' ') from (select distinct parent from dupep order by parent limit 3) z) as dupeps,
      (select count(*) from dupreq)                                               as dupreq,
      (select count(*) from s where doc ? 'bible' and jsonb_typeof(doc -> 'bible') is distinct from 'object') as badbible,
      (select count(*) from badshow)                                              as badshow,
      (select count(*) from badep)                                                as badep,
      (select count(*) from diverge)                                              as diverge,
      (select count(*) from badtrash)                                             as badtrash,
      (select string_agg(id::text, ' ') from (
         select id from s where doc ? 'bible' and jsonb_typeof(doc -> 'bible') is distinct from 'object'
         union select id from badshow union select id from badep union select id from diverge
         union select id from badtrash order by 1 limit 3) z)                     as badshapes,
      (select count(*) from src where not recorded)                               as inferred,
      (select count(*) from s where not (doc ? 'sourceEpisodeId')
          and id not in (select show_id from src)
          and id in (select parent from e))                                       as noep1,
      (select count(*) from s where doc ? 'sourceEpisodeId'
          and id not in (select show_id from src))                                as srcgone,
      (select count(*) from e
        where (doc -> 'project' ->> 'format') is distinct from
              coalesce(nullif(btrim(parent_doc ->> 'format'), ''), 'series'))    as fmt,
      (select count(distinct show_id) from epkeys k
        where not exists (select 1 from e where e.parent = k.show_id and e.id::text = k.key)) as epkeys,
      (select count(distinct id) from lost)                                       as lost
  $q$
  from ready r
  union all
  select 'm', r.projects_ok and r.members_ok, $q$
    with p as (
      select id, owner, doc, created_at,
             lower(coalesce(doc ->> 'isShow', 'false')) = 'true' as is_show,
             nullif(btrim(doc ->> 'showId'), '') as raw_show,
             case when btrim(doc ->> 'showId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  then btrim(doc ->> 'showId')::uuid end as show_uuid,
             case when btrim(doc ->> 'episodeNo') ~ '^[1-9][0-9]*$' and length(btrim(doc ->> 'episodeNo')) <= 10
                  then case when btrim(doc ->> 'episodeNo')::numeric <= 2147483647
                            then btrim(doc ->> 'episodeNo')::numeric::int end end as ep_no
        from public.turn_projects
    ),
    s as (select * from p where is_show),
    e as (
      select c.*, sh.id as parent
        from p c join p sh on sh.id = c.show_uuid
       where sh.is_show and not c.is_show and c.ep_no is not null
         and c.id <> sh.id and c.owner = sh.owner
    ),
    src as (   -- same rule as in the projects query above
      select distinct on (sh.id) sh.id as show_id, e.id as episode_id, sh.created_at as show_created
        from s sh join e on e.parent = sh.id
       where (not (sh.doc ? 'sourceEpisodeId') and e.ep_no = 1)
          or e.id::text = lower(btrim(sh.doc ->> 'sourceEpisodeId'))
       order by sh.id, e.id
    ),
    m as (select * from public.turn_project_members),
    -- Only invitations older than the Show row are the conversion leftover the
    -- migration promotes; a later grant on the source Episode stays Episode-only.
    promoted as (
      select m.id, src.show_id
        from m join src on src.episode_id = m.project_id
       where m.status = 'active' and m.created_at <= src.show_created
    ),
    ranked as (
      select m.id, row_number() over (
               partition by m.project_id, lower(btrim(m.member_email))
               order by m.updated_at desc, (m.status = 'removed') desc, m.created_at desc, m.id desc) as rk
        from m
    )
    select
      (select count(*) from m)                                                    as total,
      (select count(*) from m where status = 'active')                            as active,
      (select count(*) from m where nullif(lower(btrim(member_email)), '') is null) as empty,
      (select count(*) from ranked where rk > 1)                                  as dups,
      (select count(*) from m where member_email is distinct from lower(btrim(member_email))) as noncanon,
      (select count(*) from m where role = 'producer_admin')                     as retired,
      (select count(*) from m where status = 'active'
          and role not in ('view_only', 'writer', 'art_director', 'producer_admin')) as oddroles,
      (select string_agg(distinct role, ' ') from m where status = 'active'
          and role not in ('view_only', 'writer', 'art_director', 'producer_admin')) as oddrolenames,
      (select count(*) from m where status = 'active'
          and (project_id in (select id from s) or project_id in (select id from p where raw_show is not null))) as onseries,
      (select count(*) from promoted)                                             as promote,
      (select string_agg(show_id::text, ' ') from (
         select distinct show_id from promoted order by 1 limit 3) z)            as promoteshows,
      (select count(*) from m join src on src.episode_id = m.project_id
        where m.status = 'active' and m.created_at > src.show_created)           as latesrc,
      (select count(*) from m join e on e.id = m.project_id
        where m.status = 'active'
          and (m.id in (select id from promoted)
               or exists (select 1 from m c where c.project_id = e.parent
                           and (lower(c.member_email) = lower(m.member_email)
                                or (c.member_user is not null and c.member_user = m.member_user))))) as retire
  $q$
  from ready r
  union all
  select 'c', r.projects_ok and r.cameos_ok, $q$
    select (select count(*) from public.turn_cameos) as total,
           (select count(*) from public.turn_cameos c join public.turn_projects p on p.id = c.project_id
             where c.owner <> p.owner) as foreign
  $q$
  from ready r
  union all
  select 'g', r.projects_ok and r.generations_ok, $q$
    select (select count(*) from public.turn_generations) as total,
           (select count(*) from public.turn_generations g join public.turn_projects p on p.id = g.project_id
             where lower(coalesce(p.doc ->> 'isShow', 'false')) = 'true'
                or nullif(btrim(p.doc ->> 'showId'), '') is not null) as onseries
  $q$
  from ready r
  union all
  select 'o', r.objects_ok, $q$
    select count(*) as total from storage.objects where bucket_id = 'turn-assets'
  $q$
  from ready r
  union all
  select 'b', r.buckets_ok, $q$
    select count(*) as n from storage.buckets where id = 'turn-assets'
  $q$
  from ready r
  union all
  select 'k', c.has_grants and r.grants_path_ok, $q$
    select count(*) as total, count(*) filter (where path is null) as gone from public.turn_asset_cleanup_grants
  $q$
  from ready r, cat c
  union all
  select 'k', c.has_grants and not r.grants_path_ok, $q$
    select count(*) as total, count(*) as gone from public.turn_asset_cleanup_grants
  $q$
  from ready r, cat c
  union all
  select 'u', c.has_uid, $q$
    select case when auth.uid() is null then 'yes' else 'no' end as nouid
  $q$
  from cat c
),
raw as materialized (
  select key, case when ok then query_to_xml(sql, false, true, '')::text end as x
    from dyn
),
kv as materialized (
  select raw.key || '.' || m[1] as k, m[2] as v
    from raw
    cross join lateral regexp_matches(coalesce(raw.x, ''), '<([a-z0-9]+)>([^<]*)</\1>', 'g') as m
),
nv as materialized (
  select k, v, case when v ~ '^-?[0-9]{1,18}$' then v::bigint end as n from kv
),
v as materialized (
  select
    max(n) filter (where k = 'p.total')     as p_total,
    max(n) filter (where k = 'p.owners')    as p_owners,
    max(n) filter (where k = 'p.marked')    as p_marked,
    max(n) filter (where k = 'p.shows')     as p_shows,
    max(n) filter (where k = 'p.epdocs')    as p_epdocs,
    max(n) filter (where k = 'p.linked')    as p_linked,
    max(n) filter (where k = 'p.stripped')  as p_stripped,
    max(v) filter (where k = 'p.strippeds') as p_strippeds,
    max(n) filter (where k = 'p.both')      as p_both,
    max(v) filter (where k = 'p.boths')     as p_boths,
    max(n) filter (where k = 'p.dupep')     as p_dupep,
    max(v) filter (where k = 'p.dupeps')    as p_dupeps,
    max(n) filter (where k = 'p.dupreq')    as p_dupreq,
    max(n) filter (where k = 'p.badbible')  as p_badbible,
    max(n) filter (where k = 'p.badshow')   as p_badshow,
    max(n) filter (where k = 'p.badep')     as p_badep,
    max(n) filter (where k = 'p.diverge')   as p_diverge,
    max(n) filter (where k = 'p.badtrash')  as p_badtrash,
    max(v) filter (where k = 'p.badshapes') as p_badshapes,
    max(n) filter (where k = 'p.inferred')  as p_inferred,
    max(n) filter (where k = 'p.noep1')     as p_noep1,
    max(n) filter (where k = 'p.srcgone')   as p_srcgone,
    max(n) filter (where k = 'p.fmt')       as p_fmt,
    max(n) filter (where k = 'p.epkeys')    as p_epkeys,
    max(n) filter (where k = 'p.lost')      as p_lost,
    max(n) filter (where k = 'm.total')     as m_total,
    max(n) filter (where k = 'm.active')    as m_active,
    max(n) filter (where k = 'm.empty')     as m_empty,
    max(n) filter (where k = 'm.dups')      as m_dups,
    max(n) filter (where k = 'm.noncanon')  as m_noncanon,
    max(n) filter (where k = 'm.retired')   as m_retired,
    max(n) filter (where k = 'm.oddroles')  as m_oddroles,
    max(v) filter (where k = 'm.oddrolenames') as m_oddrolenames,
    max(n) filter (where k = 'm.onseries')  as m_onseries,
    max(n) filter (where k = 'm.promote')   as m_promote,
    max(v) filter (where k = 'm.promoteshows') as m_promoteshows,
    max(n) filter (where k = 'm.latesrc')   as m_latesrc,
    max(n) filter (where k = 'm.retire')    as m_retire,
    max(n) filter (where k = 'c.total')     as c_total,
    max(n) filter (where k = 'c.foreign')   as c_foreign,
    max(n) filter (where k = 'g.total')     as g_total,
    max(n) filter (where k = 'g.onseries')  as g_onseries,
    max(n) filter (where k = 'o.total')     as o_total,
    max(n) filter (where k = 'b.n')         as b_n,
    max(n) filter (where k = 'k.total')     as k_total,
    max(n) filter (where k = 'k.gone')      as k_gone,
    max(v) filter (where k = 'u.nouid')     as u_nouid
  from nv
),
rows_ as (
  select r.*
    from cat c cross join ready rd cross join v
    cross join lateral (values
      -- ── Database and session ────────────────────────────────────────────
      (10, 'Database', 'Postgres version',
       case when c.pgver >= 130000 then 'OK' else 'STOP' end,
       c.pgver_txt,
       'The file needs Postgres 13 or newer (gen_random_uuid is built in from 13).'),
      (11, 'Database', 'Running as',
       case when c.is_super or c.is_bypass then 'INFO' else 'REVIEW' end,
       c.who || case when c.is_super then ' (superuser)' when c.is_bypass then ' (bypasses row security)'
                     else ' (row security applies: counts below may be too low)' end,
       'Run series-production.sql as this same default role (postgres) in the SQL Editor.'),
      (12, 'Database', 'No user is being impersonated in this session',
       case when not c.has_uid then 'STOP' when v.u_nouid = 'yes' then 'OK' else 'STOP' end,
       coalesce(v.u_nouid, 'n/a (auth.uid missing)'),
       'Must be "yes". If "no", turn off "impersonate user/role" in the editor first. The data backfill assumes no signed-in user.'),
      (13, 'Database', 'Other sessions idle inside a transaction',
       case when c.idle_in_tx > 0 then 'REVIEW' else 'OK' end,
       c.idle_in_tx::text,
       'The migration locks the projects table and Storage until it commits. Run at a quiet time. If this is not 0, wait or retry later.'),
      -- ── Supabase built-ins ──────────────────────────────────────────────
      (20, 'Supabase built-ins', 'Roles anon, authenticated, service_role',
       case when c.roles_missing is null then 'OK' else 'STOP' end,
       coalesce('missing: ' || c.roles_missing, 'all present'),
       'The file grants to these roles. A missing role makes the run fail (nothing changes).'),
      (21, 'Supabase built-ins', 'auth.users table',
       case when rd.users_ok then 'OK' else 'STOP' end,
       case when c.has_users then coalesce((select 'missing columns: ' || missing from miss where tbl = 'auth.users'), 'present') else 'missing' end,
       'Needed for the new cleanup table''s owner link.'),
      (22, 'Supabase built-ins', 'auth.uid(), auth.role(), auth.jwt()',
       case when c.has_uid and c.has_role then 'OK' else 'STOP' end,
       concat_ws(', ', case when not c.has_uid then 'auth.uid missing' end,
                       case when not c.has_role then 'auth.role missing' end,
                       case when not c.has_jwt then 'auth.jwt missing' end,
                       case when c.has_uid and c.has_role and c.has_jwt then 'all present' end),
       'Every access check uses these.'),
      (23, 'Supabase built-ins', 'storage.objects table and storage.foldername()',
       case when rd.objects_ok and c.has_foldername then 'OK' else 'STOP' end,
       concat_ws(', ', case when not c.has_objects then 'storage.objects missing'
                            when not rd.objects_ok then 'storage.objects columns missing' end,
                       case when not c.has_foldername then 'storage.foldername missing' end,
                       case when rd.objects_ok and c.has_foldername then 'present' end),
       'The file replaces a Storage delete rule and reads file paths.'),
      (24, 'Supabase built-ins', 'Storage bucket turn-assets',
       case when v.b_n > 0 then 'OK' else 'INFO' end,
       case when v.b_n is null then 'n/a' when v.b_n > 0 then 'present' else 'missing' end,
       'Created by storage.sql. Not needed for the run itself, but the app''s images live there.'),
      (25, 'Supabase built-ins', 'Built-in functions gen_random_uuid, hashtextextended, pg_advisory_xact_lock',
       case when c.builtins_missing is null then 'OK' else 'STOP' end,
       coalesce('missing: ' || c.builtins_missing, 'all present'),
       'Used by the upload-reservation and cleanup functions.'),
      (26, 'Supabase built-ins', 'Extensions',
       'INFO',
       coalesce(c.extensions, 'none'),
       'series-production.sql needs no extension (no pgcrypto, pg_cron or pg_net).'),
      -- ── Tables it builds on ─────────────────────────────────────────────
      (30, 'Required tables', 'public.turn_projects (schema.sql)',
       case when rd.projects_ok then 'OK' else 'STOP' end,
       case when not c.has_projects then 'missing' else coalesce('missing columns: ' || rd.projects_missing, 'present') end,
       'The table the migration extends.'),
      (31, 'Required tables', 'public.turn_generations (schema.sql)',
       case when rd.generations_ok then 'OK' else 'STOP' end,
       case when not c.has_generations then 'missing' else coalesce('missing columns: ' || rd.generations_missing, 'present') end,
       'Image records. The file adds a trigger to it.'),
      (32, 'Required tables', 'public.turn_project_members (team-collaboration.sql)',
       case when rd.members_ok then 'OK' else 'STOP' end,
       case when not c.has_members then 'missing' else coalesce('missing columns: ' || rd.members_missing, 'present') end,
       'Without it the run fails at the membership step and changes nothing. Run team-collaboration.sql first.'),
      (33, 'Required tables', 'Unique (project_id, member_email) on turn_project_members',
       case when not c.has_members then 'STOP' when c.has_member_unique then 'OK' else 'STOP' end,
       case when not c.has_members then 'n/a (table missing)' when c.has_member_unique then 'present' else 'missing' end,
       'The file''s "on conflict (project_id, member_email)" needs this. Without it the run fails (nothing changes).'),
      (34, 'Required tables', 'public.turn_cameos (cameos.sql, optional)',
       case when not c.has_cameos then 'INFO' when rd.cameos_ok then 'OK' else 'STOP' end,
       case when not c.has_cameos then 'not installed (the file skips cameo steps)'
            else coalesce('missing columns: ' || rd.cameos_missing, 'present') end,
       'If present, the file tightens its edit/delete rules and adds a trigger on "angles".'),
      -- ── Helper functions from earlier migrations ────────────────────────
      (40, 'Earlier migrations', 'turn_current_email() (team-collaboration.sql)',
       case when c.has_current_email then 'OK' else 'STOP' end,
       case when c.has_current_email then 'present' else 'missing' end,
       'Missing makes the run fail (nothing changes). Run team-collaboration.sql first.'),
      (41, 'Earlier migrations', 'turn_storage_project_id(text) (team-collaboration.sql)',
       case when c.has_storage_pid then 'OK' else 'STOP' end,
       case when c.has_storage_pid then 'present' else 'missing' end,
       'Missing makes the run fail (nothing changes). Run team-collaboration.sql first.'),
      (42, 'Earlier migrations', 'turn_role_allowed_sections(text) (enforce-role-scopes.sql)',
       case when c.sections_result = 'text[]' then 'OK' else 'STOP' end,
       coalesce('present, returns ' || c.sections_result, 'MISSING'),
       'If missing, series-production.sql stops before changing anything (TURN_SERIES_PREREQUISITE). Older copies of the file ran anyway and then every collaborator save failed. Run the current enforce-role-scopes.sql first.'),
      (43, 'Earlier migrations', 'turn_can_access_project(pid, write_access)',
       case when c.access_args is null then 'INFO'
            when c.access_args = '{pid,write_access}' then 'OK' else 'STOP' end,
       coalesce('present, arguments ' || c.access_args, 'not present (will be created)'),
       'The file replaces it. Different argument names would make the run fail (nothing changes).'),
      (44, 'Earlier migrations', 'turn_can_write_assets(pid)',
       case when c.write_args is null then 'REVIEW'
            when c.write_args = '{pid}' then 'OK' else 'STOP' end,
       coalesce('present, arguments ' || c.write_args, 'not present'),
       'The file replaces it. "not present" means enforce-role-scopes.sql (or a recent team-collaboration.sql) was never run.'),
      (45, 'Earlier migrations', 'turn_shared_film_owners() (shared-owners.sql, optional)',
       case when c.owners_result is null then 'INFO'
            when c.owners_result = 'TABLE(project_id uuid, owner_email text)' then 'OK' else 'STOP' end,
       coalesce('present, returns ' || c.owners_result, 'not present (will be created)'),
       'The file replaces it with the same shape. A different shape would make the run fail (nothing changes).'),
      (46, 'Earlier migrations', 'enforce-role-scopes.sql fingerprints',
       case when c.has_keep_owner and c.has_enforce_trigger and c.sections_result is not null then 'OK' else 'REVIEW' end,
       concat_ws(', ',
         'role trigger ' || case when c.has_enforce_trigger then 'present' else 'missing' end,
         'keep-owner trigger ' || case when c.has_keep_owner then 'present' else 'missing' end),
       'All present means enforce-role-scopes.sql has been applied.'),
      (47, 'Earlier migrations', 'Other files seen',
       'INFO',
       concat_ws(', ',
         'invitations.sql ' || case when c.has_invitations then 'yes' else 'no' end,
         'credits.sql ' || case when c.has_credits then 'yes' else 'no' end,
         'admin-inventory.sql ' || case when c.has_admin_inventory then 'yes (re-run it after)' else 'no' end),
       'None of these block the run.'),
      -- ── Security / policies ─────────────────────────────────────────────
      (50, 'Security', 'Storage rules on storage.objects',
       case when c.has_read_collab then 'INFO' else 'REVIEW' end,
       coalesce(c.storage_policies, 'none'),
       'The file replaces the delete rule and the two upload rules (write / update collab, the same text as team-collaboration / enforce-role-scopes; they accept bare-id and readable name--id folders). "turn assets read collab" is expected (team-collaboration / enforce-role-scopes).'),
      (51, 'Security', 'Rules on turn_cameos',
       'INFO',
       coalesce(c.cameo_policies, 'none'),
       'The file replaces the write/update/delete cameo rules.'),
      (52, 'Security', 'New functions are callable by anon/authenticated by default',
       'INFO',
       case when c.anon_default_exec then 'yes' else 'no' end,
       'Supabase''s default. series-production.sql revokes its internal helpers from anon and authenticated by name, so either answer is fine.'),
      (53, 'Security', 'Memberships with an old role (producer_admin, or not view_only/writer/art_director)',
       case when v.m_retired is null then 'INFO' when v.m_retired > 0 then 'STOP'
            when v.m_oddroles > 0 then 'REVIEW' else 'OK' end,
       case when v.m_retired is null then 'n/a'
            else 'producer_admin ' || v.m_retired::text || ', other old roles (active) '
                 || v.m_oddroles::text || coalesce(' (' || v.m_oddrolenames || ')', '') end,
       'series-production.sql stops if any row still holds producer_admin: run migrate-remove-producer-admin.sql first. People with another old role lose write access after the run.'),
      -- ── Already applied? ────────────────────────────────────────────────
      (60, 'Already applied?', 'Series columns on turn_projects',
       case when rd.series_cols_present is null then 'OK' else 'REVIEW' end,
       coalesce('present: ' || rd.series_cols_present, 'not yet (expected)'),
       'Present means series-production.sql has already run here.'),
      (61, 'Already applied?', 'Upload/cleanup tables',
       case when c.has_intents or c.has_queue or c.has_grants then 'REVIEW' else 'OK' end,
       concat_ws(', ',
         'upload_intents ' || case when c.has_intents then 'present' else 'absent' end,
         'cleanup_queue ' || case when c.has_queue then 'present' else 'absent' end,
         'cleanup_grants ' || case when c.has_grants then 'present' else 'absent' end),
       'All absent is expected before the first run.'),
      (62, 'Already applied?', 'Show lifecycle functions',
       case when c.rpcs_present is null then 'OK' when c.rpcs_have_delete_bug then 'REVIEW' else 'INFO' end,
       coalesce(c.rpcs_present || case when c.rpcs_have_delete_bug then ' (installed delete functions have the "history is ambiguous" bug)' else '' end,
                'none yet (expected)'),
       'After a run, these should exist and the delete ones should not contain the bug.'),
      (63, 'Already applied?', 'Old cleanup-grant rows the file would delete',
       case when coalesce(v.k_gone, 0) > 0 then 'REVIEW' else 'OK' end,
       case when not c.has_grants then 'n/a (table absent)' else coalesce(v.k_gone, 0)::text || ' of ' || coalesce(v.k_total, 0)::text end,
       'Only matters if an older copy of that table exists.'),
      -- ── Data the backfill touches ───────────────────────────────────────
      (70, 'Projects', 'Project rows (and distinct owners)',
       'INFO',
       coalesce(v.p_total::text || ' rows, ' || v.p_owners::text || ' owners', 'n/a'),
       'Plain films are not changed by the backfill.'),
      (71, 'Projects', 'Rows carrying any Show/Episode marker in their data',
       case when v.p_marked is null then 'INFO' when v.p_marked = 0 then 'OK' else 'REVIEW' end,
       coalesce(v.p_marked::text, 'n/a'),
       '0 means no legacy Shows or Episodes: every data-related risk below is moot.'),
      (72, 'Projects', 'Legacy Shows (become Shows)',
       'INFO', coalesce(v.p_shows::text, 'n/a'),
       'Their shared Bible is rebuilt and saved with a new revision.'),
      (73, 'Projects', 'Legacy Episodes (rows with a showId)',
       'INFO', coalesce(v.p_epdocs::text, 'n/a'),
       'Of these, the next row shows how many will be linked to their Show.'),
      (74, 'Projects', 'Episodes that will be linked',
       'INFO', coalesce(v.p_linked::text, 'n/a'),
       'Linked Episodes lose their copies of shared cast/locations/props (the Show Bible is kept).'),
      (75, 'Projects', 'Rows that will lose their Show link and stay plain films',
       case when coalesce(v.p_stripped, 0) > 0 then 'REVIEW' else 'OK' end,
       coalesce(v.p_stripped::text || coalesce(' e.g. ' || v.p_strippeds, ''), 'n/a'),
       'Broken links (missing Show, other owner, bad number). Their showId/episodeNo markers are removed for good.'),
      (76, 'Projects', 'Rows that are both a Show and an Episode',
       case when coalesce(v.p_both, 0) > 0 then 'STOP' else 'OK' end,
       coalesce(v.p_both::text || coalesce(' e.g. ' || v.p_boths, ''), 'n/a'),
       'The run fails on these (nothing changes). Repair the row first.'),
      (77, 'Projects', 'Shows with duplicate episode numbers',
       case when coalesce(v.p_dupep, 0) > 0 then 'STOP' else 'OK' end,
       coalesce(v.p_dupep::text || coalesce(' e.g. Show ' || v.p_dupeps, ''), 'n/a'),
       'The run fails on these (nothing changes). Renumber one of the Episodes first.'),
      (78, 'Projects', 'Duplicate Episode creation ids',
       case when coalesce(v.p_dupreq, 0) > 0 then 'STOP' else 'OK' end,
       coalesce(v.p_dupreq::text, 'n/a'),
       'The run fails on these (nothing changes).'),
      (79, 'Projects', 'Malformed Show/Episode data (Bible, departments, restore bins)',
       case when coalesce(v.p_badbible, 0) + coalesce(v.p_badshow, 0) + coalesce(v.p_badep, 0)
                 + coalesce(v.p_diverge, 0) + coalesce(v.p_badtrash, 0) > 0 then 'STOP' else 'OK' end,
       case when v.p_badbible is null then 'n/a'
            else 'bible ' || v.p_badbible || ', show depts ' || v.p_badshow || ', episode depts ' || v.p_badep
                 || ', conflicting copies ' || v.p_diverge || ', restore bins ' || v.p_badtrash
                 || coalesce(' e.g. ' || v.p_badshapes, '') end,
       'The run fails on these (nothing changes). Repair the named rows first.'),
      (80, 'Projects', 'Shows whose source Episode will be guessed',
       'INFO',
       coalesce(v.p_inferred::text || ' guessed (Episode 1), ' || v.p_noep1::text || ' with no Episode 1 (none recorded), '
                || v.p_srcgone::text || ' recorded with no live source Episode', 'n/a'),
       'Only a Show that never recorded a sourceEpisodeId gets a guess, and the guess can only be its Episode 1 (every conversion made the original film Episode 1). It is saved and never repeated; row 95 shows whose access widens. "No Episode 1": Episode 1 was deleted, so no remaining Episode is the conversion leftover; null is recorded and nobody is promoted. "Recorded with no live source Episode": that Episode was deleted (or none existed), so nobody is promoted.'),
      (81, 'Projects', 'Episodes whose format label will change',
       case when coalesce(v.p_fmt, 0) > 0 then 'REVIEW' else 'OK' end,
       coalesce(v.p_fmt::text, 'n/a'),
       'Legacy Shows stored no format, so their Episodes become "series" (e.g. a microdrama becomes TV Series).'),
      (82, 'Projects', 'Show Bibles with Episode keys that do not match a linked Episode',
       case when coalesce(v.p_epkeys, 0) > 0 then 'REVIEW' else 'OK' end,
       coalesce(v.p_epkeys::text, 'n/a'),
       'The run does not stop on these (nor does a re-run) and does not remove the keys. If not 0, a later save of such a Show that still carries a key for an Episode that is not one of its live Episodes may be refused.'),
      (83, 'Projects', 'Episodes holding cast/locations/props that the Show Bible lacks',
       case when coalesce(v.p_lost, 0) > 0 then 'INFO' else 'OK' end,
       coalesce(v.p_lost::text, 'n/a'),
       'Those Episode copies are dropped. Reviewers judged them stale leftovers, not live data.'),
      -- ── Memberships ─────────────────────────────────────────────────────
      (90, 'Memberships', 'Membership rows (active)',
       'INFO',
       coalesce(v.m_total::text || ' (' || v.m_active::text || ' active)', 'n/a'),
       'Collaborator invitations.'),
      (91, 'Memberships', 'Memberships with an empty email',
       case when coalesce(v.m_empty, 0) > 0 then 'STOP' else 'OK' end,
       coalesce(v.m_empty::text, 'n/a'),
       'The run fails on these (nothing changes).'),
      (92, 'Memberships', 'Duplicate spellings of the same email (rows deleted)',
       case when coalesce(v.m_dups, 0) > 0 then 'REVIEW' else 'OK' end,
       coalesce(v.m_dups::text, 'n/a'),
       'The most recently changed spelling is kept, the others are deleted.'),
      (93, 'Memberships', 'Emails with capitals or spaces (will be lower-cased)',
       'INFO', coalesce(v.m_noncanon::text, 'n/a'),
       'Harmless clean-up.'),
      (94, 'Memberships', 'Active memberships on legacy Shows/Episodes',
       case when coalesce(v.m_onseries, 0) > 0 then 'REVIEW' else 'OK' end,
       coalesce(v.m_onseries::text, 'n/a'),
       'Access for these people changes: Show members reach every Episode. Episode members can read the Show Bible.'),
      (95, 'Memberships', 'Episode members promoted to the whole Show',
       case when coalesce(v.m_promote, 0) > 0 then 'REVIEW' else 'OK' end,
       coalesce(v.m_promote::text || coalesce(' (Shows ' || v.m_promoteshows || ')', '')
                || ', ' || v.m_latesrc::text || ' newer grant(s) on a source Episode left Episode-only', 'n/a'),
       'These people gain access to every current and future Episode of that Show. Only invitations older than the Show row (the film''s team at conversion) are promoted; a grant added to the source Episode later stays Episode-only.'),
      (96, 'Memberships', 'Episode-level memberships switched off',
       case when coalesce(v.m_retire, 0) > 0 then 'REVIEW' else 'OK' end,
       coalesce(v.m_retire::text, 'n/a'),
       'Replaced by their Show-level membership (their Show role then applies, which may be weaker).'),
      -- ── Other rows ──────────────────────────────────────────────────────
      (100, 'Other data', 'Image records (on legacy Shows/Episodes)',
       'INFO',
       coalesce(v.g_total::text || ' (' || v.g_onseries::text || ')', 'n/a'),
       'Not changed by the run.'),
      (101, 'Other data', 'Cameos (owned by someone other than the project owner)',
       case when coalesce(v.c_foreign, 0) > 0 then 'REVIEW' else 'INFO' end,
       case when not c.has_cameos then 'n/a (no cameo table)' else coalesce(v.c_total::text || ' (' || v.c_foreign::text || ')', 'n/a') end,
       'After the run, a collaborator who is not an art director can no longer add or edit a cameo on that project. Deleting their own cameo, and its photos while they can still open the project, stays allowed.'),
      (102, 'Other data', 'Files in the turn-assets bucket',
       'INFO', coalesce(v.o_total::text, 'n/a'),
       'Not changed by the run.')
    ) as r(ord, area, item, status, found, meaning)
)
select *
  from (
    select 0 as ord, 'Overall' as area, 'Is this database ready for series-production.sql?' as item,
           case when count(*) filter (where status = 'STOP') > 0 then 'STOP'
                when count(*) filter (where status = 'REVIEW') > 0 then 'REVIEW'
                else 'OK' end as status,
           count(*) filter (where status = 'STOP') || ' STOP, '
             || count(*) filter (where status = 'REVIEW') || ' REVIEW' as found,
           'STOP: fix those rows first (series-production.sql would stop or fail, changing nothing). REVIEW: read those rows. This checks the database only.' as meaning
      from rows_
    union all
    select ord, area, item, status, found, meaning from rows_
  ) out
 order by ord;
