-- ============================================================================
-- TURN — Production-safe Shows / Episodes
-- Run AFTER team-collaboration.sql AND enforce-role-scopes.sql.
-- Idempotent: safe to run again. If either collaboration file is re-run later,
-- re-run this file last because it deliberately replaces their access helpers
-- and role-enforcement trigger with series-aware versions.
--
-- The application keeps showId / episodeNo in `doc` for backward compatibility.
-- This migration adds a normalized, indexed relationship as the database source
-- of truth for new writes, while continuing to recognize valid legacy JSON links.
-- It also supplies the four owner-only lifecycle RPCs used by the app:
--
--   turn_convert_project_to_show  — create Show + attach Episode 1 atomically
--   turn_create_show_episode      — allocate a unique number under a row lock
--   turn_delete_show_episode      — delete one non-final Episode atomically
--   turn_delete_show              — delete the Show and every Episode atomically
--
-- Membership semantics:
--   * a membership on a Show is inherited by every Episode;
--   * a legacy membership directly on one Episode also grants access to its Show
--     Bible, but NOT to sibling Episodes;
--   * owner ids must match across a Show relationship, preventing a forged
--     doc.showId from becoming a cross-owner access path.
-- ============================================================================

begin;

-- ── 1. Normalized series metadata ───────────────────────────────────────────

alter table public.turn_projects
  add column if not exists project_kind text not null default 'film',
  add column if not exists show_id uuid,
  add column if not exists episode_no integer;

alter table public.turn_projects
  alter column project_kind set default 'film';

update public.turn_projects
   set project_kind = 'film'
 where project_kind is null;

alter table public.turn_projects
  alter column project_kind set not null;

comment on column public.turn_projects.project_kind is
  'Normalized lifecycle kind: film, show, or episode. Mirrored from doc series fields by trigger.';
comment on column public.turn_projects.show_id is
  'For episodes, the continuity-bearing Show row. doc.showId remains as a compatibility mirror.';
comment on column public.turn_projects.episode_no is
  'Positive episode number unique within a Show. doc.episodeNo remains as a compatibility mirror.';

-- Small defensive parsers: malformed legacy JSON must never abort an RLS check.
create or replace function public.turn_series_doc_is_show(p_doc jsonb)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_doc ->> 'isShow', 'false')) = 'true';
$$;

create or replace function public.turn_series_try_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if nullif(btrim(p_value), '') is null
     or btrim(p_value) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return btrim(p_value)::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.turn_series_try_positive_int(p_value text)
returns integer
language plpgsql
immutable
as $$
declare
  n numeric;
begin
  if nullif(btrim(p_value), '') is null or btrim(p_value) !~ '^[1-9][0-9]*$' then
    return null;
  end if;
  n := btrim(p_value)::numeric;
  if n > 2147483647 then return null; end if;
  return n::integer;
exception when others then
  return null;
end;
$$;

create or replace function public.turn_series_doc_show_id(p_doc jsonb)
returns uuid
language sql
immutable
as $$
  select public.turn_series_try_uuid(p_doc ->> 'showId');
$$;

create or replace function public.turn_series_doc_episode_no(p_doc jsonb)
returns integer
language sql
immutable
as $$
  select public.turn_series_try_positive_int(p_doc ->> 'episodeNo');
$$;

-- Restore-bin ownership follows the entity, not the screen which deleted it.
-- Shared character/location/prop tombstones are normalized into the Show Bible;
-- an Episode row may retain only its shot tombstones.
create or replace function public.turn_series_shared_trash(p_value jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb := '{}'::jsonb;
  department text;
  candidate jsonb;
  item jsonb;
  scene_slice jsonb;
  location_slice jsonb;
begin
  if p_value is not null and jsonb_typeof(p_value) <> 'object' then
    raise exception using errcode = '22023', message = 'TURN_SERIES: shared trash must be a JSON object';
  end if;
  foreach department in array array['characters','locations','props']
  loop
    candidate := case when coalesce(p_value, '{}'::jsonb) ? department
      then p_value -> department else '[]'::jsonb end;
    if jsonb_typeof(candidate) is distinct from 'array' then
      raise exception using errcode = '22023',
        message = 'TURN_SERIES: shared trash.' || department || ' must be an array';
    end if;
    for item in select value from jsonb_array_elements(candidate)
    loop
      if jsonb_typeof(item) is distinct from 'object'
         or nullif(btrim(item ->> 'id'), '') is null then
        raise exception using errcode = '22023',
          message = 'TURN_SERIES: every shared trash.' || department || ' item requires an id';
      end if;
      if item ? 'scenes' and jsonb_typeof(item -> 'scenes') is distinct from 'array' then
        raise exception using errcode = '22023',
          message = 'TURN_SERIES: shared trash.' || department || ' item scenes must be an array';
      end if;
      if item ? 'episodeScenes' then
        if jsonb_typeof(item -> 'episodeScenes') is distinct from 'object' then
          raise exception using errcode = '22023',
            message = 'TURN_SERIES: shared trash.' || department || ' item episodeScenes must be an object';
        end if;
        for scene_slice in select value from jsonb_each(item -> 'episodeScenes')
        loop
          if jsonb_typeof(scene_slice) is distinct from 'array' then
            raise exception using errcode = '22023',
              message = 'TURN_SERIES: every shared trash episodeScenes value must be an array';
          end if;
        end loop;
      end if;
      if item ? 'episodeLocationMeta' then
        if jsonb_typeof(item -> 'episodeLocationMeta') is distinct from 'object' then
          raise exception using errcode = '22023',
            message = 'TURN_SERIES: shared trash.' || department || ' item episodeLocationMeta must be an object';
        end if;
        for location_slice in select value from jsonb_each(item -> 'episodeLocationMeta')
        loop
          if jsonb_typeof(location_slice) is distinct from 'object'
             or (location_slice ? 'times' and jsonb_typeof(location_slice -> 'times') is distinct from 'array')
             or (location_slice ? 'areas' and jsonb_typeof(location_slice -> 'areas') is distinct from 'array')
             or (location_slice ? 'intExt' and jsonb_typeof(location_slice -> 'intExt') is distinct from 'string')
             or (location_slice ? 'scope' and jsonb_typeof(location_slice -> 'scope') is distinct from 'string')
             or (location_slice ? 'parentKey' and jsonb_typeof(location_slice -> 'parentKey') is distinct from 'string')
             or (location_slice ? 'continuityRootKey' and jsonb_typeof(location_slice -> 'continuityRootKey') is distinct from 'string') then
            raise exception using errcode = '22023',
              message = 'TURN_SERIES: every shared trash episodeLocationMeta value must be a typed object';
          end if;
        end loop;
      end if;
    end loop;
    result := jsonb_set(result, array[department], candidate, true);
  end loop;
  return result;
end;
$$;

create or replace function public.turn_series_entity_list_is_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  item jsonb;
  scene_slice jsonb;
  location_slice jsonb;
begin
  if jsonb_typeof(p_value) is distinct from 'array' then return false; end if;
  for item in select value from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(item) is distinct from 'object'
       or nullif(btrim(item ->> 'id'), '') is null then return false; end if;
    if item ? 'scenes' and jsonb_typeof(item -> 'scenes') is distinct from 'array' then return false; end if;
    if item ? 'episodeScenes' then
      if jsonb_typeof(item -> 'episodeScenes') is distinct from 'object' then return false; end if;
      for scene_slice in select value from jsonb_each(item -> 'episodeScenes')
      loop
        if jsonb_typeof(scene_slice) is distinct from 'array' then return false; end if;
      end loop;
    end if;
    if item ? 'episodeLocationMeta' then
      if jsonb_typeof(item -> 'episodeLocationMeta') is distinct from 'object' then return false; end if;
      for location_slice in select value from jsonb_each(item -> 'episodeLocationMeta')
      loop
        if jsonb_typeof(location_slice) is distinct from 'object'
           or (location_slice ? 'times' and jsonb_typeof(location_slice -> 'times') is distinct from 'array')
           or (location_slice ? 'areas' and jsonb_typeof(location_slice -> 'areas') is distinct from 'array')
           or (location_slice ? 'intExt' and jsonb_typeof(location_slice -> 'intExt') is distinct from 'string')
           or (location_slice ? 'scope' and jsonb_typeof(location_slice -> 'scope') is distinct from 'string')
           or (location_slice ? 'parentKey' and jsonb_typeof(location_slice -> 'parentKey') is distinct from 'string')
           or (location_slice ? 'continuityRootKey' and jsonb_typeof(location_slice -> 'continuityRootKey') is distinct from 'string') then
          return false;
        end if;
      end loop;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.turn_series_episode_trash(p_value jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  shots jsonb;
begin
  if p_value is not null and jsonb_typeof(p_value) <> 'object' then
    raise exception using errcode = '22023', message = 'TURN_SERIES: Episode trash must be a JSON object';
  end if;
  shots := case when coalesce(p_value, '{}'::jsonb) ? 'shots'
    then p_value -> 'shots' else '[]'::jsonb end;
  if jsonb_typeof(shots) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'TURN_SERIES: Episode trash.shots must be an array';
  end if;
  return jsonb_build_object('shots', shots);
end;
$$;

create or replace function public.turn_series_episode_trash_is_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
as $$
begin
  return p_value is null
    or (jsonb_typeof(p_value) = 'object'
        and p_value = public.turn_series_episode_trash(p_value));
exception when others then
  return false;
end;
$$;

create or replace function public.turn_series_merge_shared_trash(p_left jsonb, p_right jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb := public.turn_series_shared_trash(p_left);
  extra jsonb := public.turn_series_shared_trash(p_right);
  department text;
  current_items jsonb;
  item jsonb;
  existing_item jsonb;
  existing_index integer;
  merged_scene_map jsonb;
begin
  foreach department in array array['characters','locations','props']
  loop
    current_items := result -> department;
    for item in select value from jsonb_array_elements(extra -> department)
    loop
      select existing.value, (existing.ord - 1)::integer
        into existing_item, existing_index
        from jsonb_array_elements(current_items) with ordinality existing(value, ord)
       where existing.value ->> 'id' = item ->> 'id'
       limit 1;
      if existing_item is null then
        current_items := current_items || jsonb_build_array(item);
      else
        -- A legacy shared trash copy may appear in more than one Episode. Keep
        -- one recoverable entity and union its episode-scene map by Episode id.
        merged_scene_map := (case when jsonb_typeof(existing_item -> 'episodeScenes') = 'object'
            then existing_item -> 'episodeScenes' else '{}'::jsonb end)
          || (case when jsonb_typeof(item -> 'episodeScenes') = 'object'
            then item -> 'episodeScenes' else '{}'::jsonb end);
        current_items := jsonb_set(
          current_items,
          array[existing_index::text],
          (item || existing_item) || jsonb_build_object('episodeScenes', merged_scene_map),
          false
        );
      end if;
      existing_item := null;
      existing_index := null;
    end loop;
    result := jsonb_set(result, array[department], current_items, true);
  end loop;
  return result;
end;
$$;

create or replace function public.turn_series_prepare_shared_trash(
  p_value jsonb,
  p_episode_id uuid
)
returns jsonb
language plpgsql
immutable
as $$
declare
  source jsonb := public.turn_series_shared_trash(p_value);
  result jsonb := '{}'::jsonb;
  department text;
  prepared jsonb;
  item jsonb;
  scene_map jsonb;
  local_scenes jsonb;
begin
  if p_episode_id is null then return source; end if;
  foreach department in array array['characters','locations','props']
  loop
    prepared := '[]'::jsonb;
    for item in select value from jsonb_array_elements(source -> department)
    loop
      if item ? 'episodeScenes' and jsonb_typeof(item -> 'episodeScenes') <> 'object' then
        raise exception using errcode = '22023',
          message = 'TURN_SERIES: shared trash episodeScenes must be an object';
      end if;
      if item ? 'scenes' and jsonb_typeof(item -> 'scenes') <> 'array' then
        raise exception using errcode = '22023',
          message = 'TURN_SERIES: shared trash scenes must be an array';
      end if;
      scene_map := case when jsonb_typeof(item -> 'episodeScenes') = 'object'
        then item -> 'episodeScenes' else '{}'::jsonb end;
      local_scenes := case when jsonb_typeof(item -> 'scenes') = 'array'
        then item -> 'scenes' else '[]'::jsonb end;
      scene_map := jsonb_set(scene_map, array[p_episode_id::text], local_scenes, true);
      prepared := prepared || jsonb_build_array(
        item || jsonb_build_object('episodeScenes', scene_map)
      );
    end loop;
    result := jsonb_set(result, array[department], prepared, true);
  end loop;
  return result;
end;
$$;

create or replace function public.turn_series_bible_is_valid(p_bible jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  department text;
  normalized_trash jsonb;
begin
  if jsonb_typeof(p_bible) is distinct from 'object'
     or jsonb_typeof(p_bible -> 'characters') is distinct from 'array'
     or jsonb_typeof(p_bible -> 'locations') is distinct from 'array'
     or jsonb_typeof(p_bible -> 'props') is distinct from 'array'
     or jsonb_typeof(p_bible -> 'lookbook') is distinct from 'array'
     or jsonb_typeof(p_bible -> 'lookbookNote') is distinct from 'string'
     or jsonb_typeof(p_bible -> 'trash') is distinct from 'object' then
    return false;
  end if;
  -- The normalizer is also the strict tombstone validator. Equality makes the
  -- stored restore-bin shape canonical (exactly the three Show-owned buckets),
  -- while this wrapper remains fail-closed rather than leaking an exception.
  normalized_trash := public.turn_series_shared_trash(p_bible -> 'trash');
  if normalized_trash is distinct from p_bible -> 'trash' then return false; end if;
  foreach department in array array['characters','locations','props']
  loop
    if not public.turn_series_entity_list_is_valid(p_bible -> department)
       or not public.turn_series_entity_list_is_valid(p_bible -> 'trash' -> department) then
      return false;
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_bible -> department) active
        join jsonb_array_elements(p_bible -> 'trash' -> department) deleted
          on nullif(btrim(active ->> 'id'), '') = nullif(btrim(deleted ->> 'id'), '')
       where nullif(btrim(active ->> 'id'), '') is not null
    ) then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

-- Deleting an Episode must also retire that Episode's namespaced continuity
-- slices from every active and recoverable shared entity. The entity itself and
-- every sibling Episode slice remain unchanged.
create or replace function public.turn_series_prune_episode_from_bible(
  p_bible jsonb,
  p_episode_id uuid
)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb := p_bible;
  department text;
  bucket text;
  source_items jsonb;
  pruned jsonb;
  item jsonb;
  scene_map jsonb;
  scene_union jsonb;
  location_map jsonb;
  location_slice_count integer;
  projected_times jsonb;
  projected_areas jsonb;
  has_int boolean;
  has_ext boolean;
  projected_scope text;
  projected_parent text;
  projected_root text;
begin
  if p_episode_id is null then return result; end if;
  if not public.turn_series_bible_is_valid(result) then
    raise exception using errcode = '22023',
      message = 'TURN_SERIES: cannot prune an invalid Show Bible';
  end if;

  foreach department in array array['characters','locations','props']
  loop
    -- Active entities and recoverable tombstones obey the same projection
    -- contract. Once an entity has an Episode map, its old flat fields are only
    -- compatibility projections; they must never be used as fallback source
    -- data after a slice is removed.
    foreach bucket in array array['active','trash']
    loop
      source_items := case when bucket = 'active'
        then result -> department
        else result -> 'trash' -> department end;
      pruned := '[]'::jsonb;

      for item in select value from jsonb_array_elements(source_items)
      loop
        item := (item #- array['episodeScenes', p_episode_id::text])
                  #- array['episodeLocationMeta', p_episode_id::text];

        if item ? 'episodeScenes' then
          scene_map := item -> 'episodeScenes';
          -- Rebuild the flat scene list solely from surviving namespaced
          -- slices. The map is retained even when empty, making "no slices"
          -- explicit and preventing a legacy flat list from being resurrected.
          select coalesce(
                   jsonb_agg(unique_scene.value
                     order by unique_scene.episode_key, unique_scene.scene_ord),
                   '[]'::jsonb
                 )
            into scene_union
            from (
              select ranked.value, ranked.episode_key, ranked.scene_ord
                from (
                  select scene.value,
                         episode.key as episode_key,
                         scene.ord as scene_ord,
                         row_number() over (
                           partition by scene.value
                           order by episode.key, scene.ord
                         ) as duplicate_rank
                    from jsonb_each(scene_map) episode(key, value)
                    cross join lateral jsonb_array_elements(episode.value)
                      with ordinality scene(value, ord)
                ) ranked
               where ranked.duplicate_rank = 1
            ) unique_scene;
          item := item || jsonb_build_object('scenes', scene_union);
        end if;

        if department = 'locations' and item ? 'episodeLocationMeta' then
          location_map := item -> 'episodeLocationMeta';
          select count(*)::integer
            into location_slice_count
            from jsonb_each(location_map);

          if location_slice_count = 0 then
            -- Every flat location field is Episode-owned once the namespace
            -- exists. Blank the compatibility projection when its final slice
            -- is deleted instead of falling back to stale pre-series values.
            item := item || jsonb_build_object(
              'times', '[]'::jsonb,
              'areas', '[]'::jsonb,
              'intExt', '',
              'scope', '',
              'parentKey', '',
              'continuityRootKey', ''
            );
          else
            select coalesce(
                     jsonb_agg(unique_value.value
                       order by unique_value.episode_key, unique_value.value_ord),
                     '[]'::jsonb
                   )
              into projected_times
              from (
                select ranked.value, ranked.episode_key, ranked.value_ord
                  from (
                    select value_item.value,
                           episode.key as episode_key,
                           value_item.ord as value_ord,
                           row_number() over (
                             partition by value_item.value
                             order by episode.key, value_item.ord
                           ) as duplicate_rank
                      from jsonb_each(location_map) episode(key, value)
                      cross join lateral jsonb_array_elements(
                        coalesce(episode.value -> 'times', '[]'::jsonb)
                      ) with ordinality value_item(value, ord)
                  ) ranked
                 where ranked.duplicate_rank = 1
              ) unique_value;

            select coalesce(
                     jsonb_agg(unique_value.value
                       order by unique_value.episode_key, unique_value.value_ord),
                     '[]'::jsonb
                   )
              into projected_areas
              from (
                select ranked.value, ranked.episode_key, ranked.value_ord
                  from (
                    select value_item.value,
                           episode.key as episode_key,
                           value_item.ord as value_ord,
                           row_number() over (
                             partition by value_item.value
                             order by episode.key, value_item.ord
                           ) as duplicate_rank
                      from jsonb_each(location_map) episode(key, value)
                      cross join lateral jsonb_array_elements(
                        coalesce(episode.value -> 'areas', '[]'::jsonb)
                      ) with ordinality value_item(value, ord)
                  ) ranked
                 where ranked.duplicate_rank = 1
              ) unique_value;

            select coalesce(bool_or(side in ('INT','INT/EXT')), false),
                   coalesce(bool_or(side in ('EXT','INT/EXT')), false)
              into has_int, has_ext
              from (
                select upper(replace(btrim(value ->> 'intExt'), '+', '/')) as side
                  from jsonb_each(location_map)
              ) sides;

            select coalesce(min(nullif(btrim(value ->> 'parentKey'), '')), '')
              into projected_parent
              from jsonb_each(location_map);
            select coalesce(min(nullif(btrim(value ->> 'continuityRootKey'), '')), '')
              into projected_root
              from jsonb_each(location_map);

            if projected_parent <> '' then
              projected_scope := 'atomic';
            elsif exists (
              select 1 from jsonb_each(location_map)
               where lower(btrim(value ->> 'scope')) = 'compound'
            ) then
              projected_scope := 'compound';
            elsif exists (
              select 1 from jsonb_each(location_map)
               where lower(btrim(value ->> 'scope')) = 'atomic'
            ) then
              projected_scope := 'atomic';
            else
              projected_scope := '';
            end if;

            if projected_parent <> '' and exists (
              select 1 from jsonb_each(location_map)
               where nullif(btrim(value ->> 'continuityRootKey'), '') = projected_parent
            ) then
              projected_root := projected_parent;
            elsif projected_root = '' then
              projected_root := projected_parent;
            end if;

            item := item || jsonb_build_object(
              'times', projected_times,
              'areas', projected_areas,
              'intExt', case
                when has_int and has_ext then 'INT/EXT'
                when has_ext then 'EXT'
                when has_int then 'INT'
                else ''
              end,
              'scope', projected_scope,
              'parentKey', projected_parent,
              'continuityRootKey', projected_root
            );
          end if;
        end if;

        pruned := pruned || jsonb_build_array(item);
      end loop;

      if bucket = 'active' then
        result := jsonb_set(result, array[department], pruned, false);
      else
        result := jsonb_set(result, array['trash', department], pruned, false);
      end if;
    end loop;
  end loop;
  return result;
end;
$$;

-- Every ordinary doc insert/save is kept in step with the normalized columns.
-- Existing episodes cannot be silently detached, moved, or renumbered by a
-- partial client write; those are lifecycle operations, not ordinary autosaves.
create or replace function public.turn_sync_project_series_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raw_show_id text;
  desired_show_id uuid;
  desired_episode_no integer;
  desired_is_show boolean;
  parent_owner uuid;
  parent_is_show boolean;
  parent_format text;
  lifecycle_allowed boolean := coalesce(current_setting('turn.series_lifecycle', true), '') = 'true';
begin
  new.doc := coalesce(new.doc, '{}'::jsonb);
  raw_show_id := nullif(btrim(new.doc ->> 'showId'), '');
  desired_show_id := public.turn_series_doc_show_id(new.doc);
  desired_episode_no := public.turn_series_doc_episode_no(new.doc);
  desired_is_show := public.turn_series_doc_is_show(new.doc);

  if desired_is_show and raw_show_id is not null then
    raise exception using
      errcode = '23514',
      message = 'TURN_SERIES: a Show cannot also be an Episode';
  end if;

  if tg_op = 'INSERT' and (desired_is_show or raw_show_id is not null)
     and not lifecycle_allowed then
    raise exception using
      errcode = '23514',
      message = 'TURN_SERIES: creating a Show or Episode requires the series lifecycle operation';
  end if;

  if desired_is_show then
    -- Backfill is allowed when the persisted doc was already a Show before
    -- this migration. A normal film/episode save cannot manufacture a Show in
    -- place and bypass the conversion RPC's Episode 1 + migration guarantees.
    if tg_op = 'UPDATE'
       and old.project_kind <> 'show'
       and not public.turn_series_doc_is_show(old.doc) then
      raise exception using
        errcode = '23514',
        message = 'TURN_SERIES: converting a project into a Show requires the series lifecycle operation';
    end if;
    new.project_kind := 'show';
    new.show_id := null;
    new.episode_no := null;
    -- The one temporary exception is the legacy-Show backfill immediately below;
    -- that transaction constructs and validates its Bible before it commits.
    if not public.turn_series_bible_is_valid(new.doc -> 'bible')
       and not (lifecycle_allowed and tg_op = 'UPDATE'
                and old.project_kind <> 'show'
                and public.turn_series_doc_is_show(old.doc)) then
      raise exception using
        errcode = '22023',
        message = 'TURN_SERIES: a Show requires a complete shared Bible, including shared restore bins';
    end if;

  elsif raw_show_id is not null then
    if tg_op = 'UPDATE' and old.project_kind <> 'episode'
       and not lifecycle_allowed then
      raise exception using
        errcode = '23514',
        message = 'TURN_SERIES: attaching an Episode requires the series lifecycle operation';
    end if;
    if desired_show_id is null then
      raise exception using
        errcode = '22023',
        message = 'TURN_SERIES: doc.showId must be a valid UUID';
    end if;
    if desired_episode_no is null then
      raise exception using
        errcode = '22023',
        message = 'TURN_SERIES: an Episode requires a positive integer doc.episodeNo';
    end if;
    if desired_show_id = new.id then
      raise exception using
        errcode = '23514',
        message = 'TURN_SERIES: a project cannot be its own Show';
    end if;

    select p.owner,
           (p.project_kind = 'show' or public.turn_series_doc_is_show(p.doc)),
           coalesce(nullif(btrim(p.doc ->> 'format'), ''), 'series')
      into parent_owner, parent_is_show, parent_format
      from public.turn_projects p
     where p.id = desired_show_id;

    if not found or not coalesce(parent_is_show, false) then
      raise exception using
        errcode = '23503',
        message = 'TURN_SERIES: doc.showId does not identify a Show';
    end if;
    if parent_owner is distinct from new.owner then
      raise exception using
        errcode = '23514',
        message = 'TURN_SERIES: a Show and its Episodes must have the same owner';
    end if;

    if tg_op = 'UPDATE' and old.project_kind = 'episode' and
       (old.show_id is distinct from desired_show_id
        or old.episode_no is distinct from desired_episode_no) then
      raise exception using
        errcode = '23514',
        message = 'TURN_SERIES: moving or renumbering an Episode requires a series lifecycle operation';
    end if;

    new.project_kind := 'episode';
    new.show_id := desired_show_id;
    new.episode_no := desired_episode_no;
    if not public.turn_series_episode_trash_is_valid(new.doc -> 'trash')
       and not (lifecycle_allowed and tg_op = 'UPDATE' and old.project_kind <> 'episode') then
      raise exception using
        errcode = '22023',
        message = 'TURN_SERIES: shared restore-bin entries belong to the Show Bible; an Episode owns only trash.shots';
    end if;
    -- Format is Show-owned continuity metadata. Canonicalize every Episode write
    -- so a stale/offline client cannot split one Show into conflicting formats.
    new.doc := jsonb_set(
      new.doc,
      '{project}',
      (case when jsonb_typeof(new.doc -> 'project') = 'object'
         then new.doc -> 'project' else '{}'::jsonb end)
        || jsonb_build_object('format', parent_format),
      true
    );

  else
    if tg_op = 'UPDATE' and old.project_kind = 'episode' then
      raise exception using
        errcode = '23514',
        message = 'TURN_SERIES: an Episode cannot be detached from its Show by an ordinary save';
    end if;
    if tg_op = 'UPDATE'
       and (old.project_kind = 'show' or public.turn_series_doc_is_show(old.doc)) then
      raise exception using
        errcode = '23514',
        message = 'TURN_SERIES: a Show cannot be converted back into a film by an ordinary save';
    end if;
    new.project_kind := 'film';
    new.show_id := null;
    new.episode_no := null;
  end if;

  -- Ownership transfer of a live series would split its invariant. TURN does
  -- not currently expose an atomic whole-series transfer, so fail closed.
  if tg_op = 'UPDATE' and new.owner is distinct from old.owner and
     (old.project_kind in ('show', 'episode')
      or new.project_kind in ('show', 'episode')) then
    raise exception using
      errcode = '23514',
      message = 'TURN_SERIES: transfer the complete Show, not one project row';
  end if;

  return new;
end;
$$;

drop trigger if exists turn_sync_project_series_metadata on public.turn_projects;
create trigger turn_sync_project_series_metadata
  before insert or update of doc, owner, project_kind, show_id, episode_no
  on public.turn_projects
  for each row execute function public.turn_sync_project_series_metadata();

-- Normalized Shows and Episodes must pass through their lifecycle RPCs when
-- deleted. Apart from keeping the parent/child invariant intact, the RPCs take
-- a transaction-time inventory of every Storage key before the database rows
-- cascade away. A direct PostgREST delete would otherwise orphan those files.
-- The transaction-local marker cannot be supplied by an ordinary REST delete;
-- it is set only inside the security-definer lifecycle functions below.
create or replace function public.turn_guard_series_project_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed_scope text := nullif(current_setting('turn.series_delete_scope', true), '');
begin
  -- Do not obstruct an auth.users cascade when an account itself is removed.
  if pg_trigger_depth() > 1 then return old; end if;

  if old.project_kind = 'episode'
     and allowed_scope is distinct from old.id::text
     and allowed_scope is distinct from old.show_id::text then
    raise exception using
      errcode = '23514',
      message = 'TURN_SERIES: deleting an Episode requires the series lifecycle operation';
  end if;
  if old.project_kind = 'show'
     and allowed_scope is distinct from old.id::text then
    raise exception using
      errcode = '23514',
      message = 'TURN_SERIES: deleting a Show requires the series lifecycle operation';
  end if;
  return old;
end;
$$;

drop trigger if exists turn_guard_series_project_delete on public.turn_projects;
create trigger turn_guard_series_project_delete
  before delete on public.turn_projects
  for each row execute function public.turn_guard_series_project_delete();

-- Backfill valid legacy Shows first, then their Episodes. Invalid/orphan JSON
-- remains a standalone normalized row rather than being trusted as a relation.
select set_config('turn.series_lifecycle', 'true', true);
update public.turn_projects p
   set project_kind = 'show', show_id = null, episode_no = null
 where public.turn_series_doc_is_show(p.doc);

update public.turn_projects e
   set project_kind = 'episode',
       show_id = s.id,
       episode_no = public.turn_series_doc_episode_no(e.doc)
  from public.turn_projects s
 where not public.turn_series_doc_is_show(e.doc)
   and public.turn_series_doc_show_id(e.doc) = s.id
   and public.turn_series_doc_episode_no(e.doc) is not null
   and e.id <> s.id
   and e.owner = s.owner
   and (s.project_kind = 'show' or public.turn_series_doc_is_show(s.doc));

-- A JSON-only Episode from an older client may contain hydrated copies of the
-- Show-owned departments at its root.  Do not simply remove those copies: first
-- prove that the parent has a usable canonical Bible, recovering any *missing*
-- department from the Show's own legacy root or any linked Episode. Episode
-- copies are considered in stable episode-number/id order and must agree; a
-- disagreement is irreconcilable without user intent and aborts the migration.
-- Explicit values already present in `doc.bible` remain authoritative (including
-- intentionally empty arrays). Malformed values abort the migration instead of
-- silently discarding data. Only after every linked Episode copy has also passed
-- a type check do we remove the duplicate departments from Episode rows.
do $$
declare
  show_row record;
  source_episode_id uuid;
  child_row record;
  bible jsonb;
  candidate jsonb;
  candidate_found boolean;
  department text;
  expected_type text;
  default_value jsonb;
  show_patch jsonb;
  canonical_doc jsonb;
  shared_trash jsonb;
  child_trash jsonb;
begin
  for show_row in
    select s.id, s.doc
      from public.turn_projects s
     where s.project_kind = 'show'
     order by s.id
  loop
    if show_row.doc ? 'bible'
       and jsonb_typeof(show_row.doc -> 'bible') is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = 'TURN_SERIES_MIGRATION: Show ' || show_row.id::text || ' has a malformed Bible';
    end if;

    bible := case
      when jsonb_typeof(show_row.doc -> 'bible') = 'object'
        then show_row.doc -> 'bible'
      else '{}'::jsonb
    end;
    source_episode_id := null;
    select e.id
      into source_episode_id
      from public.turn_projects e
     where e.project_kind = 'episode'
       and e.show_id = show_row.id
     order by
       case
         when e.id = public.turn_series_try_uuid(show_row.doc ->> 'sourceEpisodeId') then 0
         when e.episode_no = 1 then 1
         else 2
       end,
       e.episode_no,
       e.id
     limit 1;

    shared_trash := public.turn_series_shared_trash(bible -> 'trash');
    if show_row.doc ? 'trash' then
      child_trash := case when source_episode_id is not null
        then public.turn_series_prepare_shared_trash(show_row.doc -> 'trash', source_episode_id)
        else public.turn_series_shared_trash(show_row.doc -> 'trash') end;
      shared_trash := public.turn_series_merge_shared_trash(shared_trash, child_trash);
    end if;

    foreach department in array array['characters','locations','props','lookbook','lookbookNote']
    loop
      expected_type := case when department = 'lookbookNote' then 'string' else 'array' end;
      default_value := case when department = 'lookbookNote' then '""'::jsonb else '[]'::jsonb end;

      if bible ? department then
        candidate := bible -> department;
      elsif show_row.doc ? department then
        candidate := show_row.doc -> department;
      else
        candidate := null;
        candidate_found := false;
        -- Do not assume the recorded source Episode is the only surviving copy.
        -- Every linked Episode is inspected deterministically. Identical copies
        -- are safe to adopt; divergent copies stop here so none is erased.
        for child_row in
          select e.id, e.episode_no, e.doc
            from public.turn_projects e
           where e.project_kind = 'episode'
             and e.show_id = show_row.id
             and e.doc ? department
           order by e.episode_no, e.id
        loop
          if jsonb_typeof(child_row.doc -> department) is distinct from expected_type then
            raise exception using
              errcode = '22023',
              message = 'TURN_SERIES_MIGRATION: Episode ' || child_row.id::text
                || ' has malformed duplicate shared department ' || department;
          end if;
          if not candidate_found then
            candidate := child_row.doc -> department;
            candidate_found := true;
          elsif candidate is distinct from (child_row.doc -> department) then
            raise exception using
              errcode = '22023',
              message = 'TURN_SERIES_MIGRATION: Show ' || show_row.id::text
                || ' has irreconcilable Episode copies of shared department ' || department;
          end if;
        end loop;
        if not candidate_found then candidate := default_value; end if;
      end if;

      if jsonb_typeof(candidate) is distinct from expected_type then
        raise exception using
          errcode = '22023',
          message = 'TURN_SERIES_MIGRATION: Show ' || show_row.id::text
            || ' has malformed shared department ' || department;
      end if;
      bible := jsonb_set(bible, array[department], candidate, true);
    end loop;

    -- Validate all duplicate Episode copies before any one of them is stripped.
    -- They need not equal the Show snapshot: the Show Bible is canonical and an
    -- old hydrated copy may legitimately be stale. Their shape must be readable,
    -- however, so malformed legacy data is never erased by this migration.
    for child_row in
      select e.id, e.doc
        from public.turn_projects e
       where e.project_kind = 'episode'
         and e.show_id = show_row.id
       order by e.episode_no, e.id
    loop
      foreach department in array array['characters','locations','props','lookbook','lookbookNote']
      loop
        if child_row.doc ? department then
          expected_type := case when department = 'lookbookNote' then 'string' else 'array' end;
          if jsonb_typeof(child_row.doc -> department) is distinct from expected_type then
            raise exception using
              errcode = '22023',
              message = 'TURN_SERIES_MIGRATION: Episode ' || child_row.id::text
                || ' has malformed duplicate shared department ' || department;
          end if;
        end if;
      end loop;
      -- Before removing Episode-local legacy bins, move their full shared
      -- entities into the Show and bind flat scene ids to the Episode that owned
      -- that old bin. Duplicate ids merge their per-Episode reference maps.
      child_trash := public.turn_series_prepare_shared_trash(child_row.doc -> 'trash', child_row.id);
      shared_trash := public.turn_series_merge_shared_trash(shared_trash, child_trash);
    end loop;

    -- An active canonical entity wins over an obsolete duplicate tombstone.
    foreach department in array array['characters','locations','props']
    loop
      select coalesce(jsonb_agg(t.item order by t.ord), '[]'::jsonb)
        into candidate
        from jsonb_array_elements(shared_trash -> department) with ordinality as t(item, ord)
       where not exists (
         select 1 from jsonb_array_elements(bible -> department) active
          where active ->> 'id' = t.item ->> 'id'
       );
      shared_trash := jsonb_set(shared_trash, array[department], candidate, true);
    end loop;
    bible := jsonb_set(bible, '{trash}', shared_trash, true);

    show_patch := jsonb_build_object(
      'bible', bible,
      'schemaVersion', 3
    );
    if source_episode_id is not null then
      show_patch := show_patch || jsonb_build_object('sourceEpisodeId', source_episode_id::text);
    end if;

    canonical_doc := (coalesce(show_row.doc, '{}'::jsonb)
                        - 'characters' - 'locations' - 'props'
                        - 'lookbook' - 'lookbookNote' - 'trash') || show_patch;
    if (canonical_doc - '_rev') is distinct from (coalesce(show_row.doc, '{}'::jsonb) - '_rev') then
      canonical_doc := canonical_doc || jsonb_build_object(
        '_rev', coalesce(public.turn_series_try_positive_int(show_row.doc ->> '_rev'), 0)::bigint + 1
      );
      update public.turn_projects s
         set doc = canonical_doc
       where s.id = show_row.id;
    end if;
  end loop;

  update public.turn_projects e
     set doc = (coalesce(e.doc, '{}'::jsonb)
                  - 'characters' - 'locations' - 'props'
                  - 'lookbook' - 'lookbookNote' - 'trash')
                || jsonb_build_object(
                  'trash', public.turn_series_episode_trash(e.doc -> 'trash'),
                  '_rev', coalesce(public.turn_series_try_positive_int(e.doc ->> '_rev'), 0)::bigint + 1
                )
   where e.project_kind = 'episode'
     and (e.doc ? 'characters' or e.doc ? 'locations' or e.doc ? 'props'
       or e.doc ? 'lookbook' or e.doc ? 'lookbookNote'
       or not public.turn_series_episode_trash_is_valid(e.doc -> 'trash'));
end;
$$;

-- A legacy row whose parent is malformed, missing, self-referential or owned by
-- somebody else is deliberately retained as a standalone film. Remove only its
-- obsolete relationship markers so both this client and older JSON-only clients
-- can open and save the recovered story instead of repeatedly treating it as an
-- unavailable Episode. Story data and former shared-department copies stay intact.
update public.turn_projects p
   set doc = p.doc - 'showId' - 'episodeNo' - 'seriesCreateRequestId'
 where p.project_kind = 'film'
   and (p.doc ? 'showId' or p.doc ? 'episodeNo' or p.doc ? 'seriesCreateRequestId');
select set_config('turn.series_lifecycle', 'false', true);

-- Duplicate numbers are an existing data-integrity problem and must be repaired
-- explicitly; silently renumbering released episodes would be worse. Raising
-- here rolls this entire migration back and names the affected Show.
do $$
declare
  duplicate_show uuid;
begin
  select p.show_id
    into duplicate_show
    from public.turn_projects p
   where p.project_kind = 'episode'
   group by p.show_id, p.episode_no
  having count(*) > 1
   limit 1;
  if duplicate_show is not null then
    raise exception using
      errcode = '23505',
      message = 'TURN_SERIES_MIGRATION: duplicate episode numbers exist for Show ' || duplicate_show::text;
  end if;
end;
$$;

create index if not exists turn_projects_project_kind_idx
  on public.turn_projects(project_kind);
create index if not exists turn_projects_show_id_idx
  on public.turn_projects(show_id)
  where show_id is not null;
create unique index if not exists turn_projects_show_episode_no_key
  on public.turn_projects(show_id, episode_no)
  where project_kind = 'episode';
create unique index if not exists turn_projects_show_episode_request_key
  on public.turn_projects(show_id, (doc ->> 'seriesCreateRequestId'))
  where project_kind = 'episode'
    and nullif(doc ->> 'seriesCreateRequestId', '') is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.turn_projects'::regclass
       and conname = 'turn_projects_series_shape_check'
  ) then
    alter table public.turn_projects
      add constraint turn_projects_series_shape_check check (
        (project_kind = 'film' and show_id is null and episode_no is null)
        or (project_kind = 'show' and show_id is null and episode_no is null)
        or (project_kind = 'episode' and show_id is not null and episode_no > 0)
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.turn_projects'::regclass
       and conname = 'turn_projects_show_id_fkey'
  ) then
    alter table public.turn_projects
      add constraint turn_projects_show_id_fkey
      foreign key (show_id) references public.turn_projects(id)
      on delete no action deferrable initially deferred not valid;
  end if;
end;
$$;

alter table public.turn_projects
  validate constraint turn_projects_series_shape_check;
alter table public.turn_projects
  validate constraint turn_projects_show_id_fkey;

-- The legacy conversion above must finish before this trigger is installed:
-- during that backfill a Show can temporarily exist before its first Episode is
-- linked. From this point onward every Episode namespace in a Show Bible must
-- identify a live child row of that exact Show. Besides rejecting malformed or
-- cross-Show keys, the KEY SHARE lock closes the delete/save race: a stale Show
-- update either lands before deletion and is subsequently pruned, or observes
-- the committed deletion and is rejected instead of resurrecting its slice.
create or replace function public.turn_validate_show_bible_episode_keys()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  department text;
  map_name text;
  item jsonb;
  episode_key text;
  episode_id uuid;
begin
  if new.project_kind <> 'show' or new.doc is not distinct from old.doc then
    return new;
  end if;

  foreach department in array array['characters','locations','props']
  loop
    for item in
      select active.value
        from jsonb_array_elements(new.doc -> 'bible' -> department) active(value)
      union all
      select deleted.value
        from jsonb_array_elements(new.doc -> 'bible' -> 'trash' -> department) deleted(value)
    loop
      foreach map_name in array array['episodeScenes','episodeLocationMeta']
      loop
        if jsonb_typeof(item -> map_name) = 'object' then
          for episode_key in
            select map_entry.key
              from jsonb_each(item -> map_name) map_entry(key, value)
          loop
            episode_id := public.turn_series_try_uuid(episode_key);
            if episode_id is null then
              raise exception using
                errcode = '23503',
                message = 'TURN_SERIES: ' || map_name || ' key ' || episode_key
                  || ' does not identify a live Episode of this Show';
            end if;

            perform 1
              from public.turn_projects e
             where e.id = episode_id
               and e.project_kind = 'episode'
               and e.show_id = new.id
             for key share;
            if not found then
              raise exception using
                errcode = '23503',
                message = 'TURN_SERIES: ' || map_name || ' key ' || episode_key
                  || ' does not identify a live Episode of this Show';
            end if;
          end loop;
        end if;
      end loop;
    end loop;
  end loop;

  return new;
end;
$$;

drop trigger if exists turn_validate_show_bible_episode_keys on public.turn_projects;
create trigger turn_validate_show_bible_episode_keys
  before update of doc on public.turn_projects
  for each row execute function public.turn_validate_show_bible_episode_keys();

revoke all on function public.turn_validate_show_bible_episode_keys() from public;

-- ── 2. Inherited membership and role lookup ────────────────────────────────

-- Membership identity is an email address, so its uniqueness must use the same
-- case-insensitive comparison as every access check. Older schemas constrained
-- the raw string and could therefore hold Alice@example.com beside
-- alice@example.com. Keep the most recently managed row (a same-time removal
-- wins), remove only its duplicate spellings, and canonicalize all future input.
do $$
declare
  malformed_member uuid;
begin
  select m.id into malformed_member
    from public.turn_project_members m
   where nullif(lower(btrim(m.member_email)), '') is null
   limit 1;
  if malformed_member is not null then
    raise exception using
      errcode = '22023',
      message = 'TURN_SERIES_MIGRATION: membership ' || malformed_member::text
        || ' has an empty email and requires repair';
  end if;
end;
$$;

with ranked as (
  select m.id,
         row_number() over (
           partition by m.project_id, lower(btrim(m.member_email))
           order by m.updated_at desc,
                    (m.status = 'removed') desc,
                    m.created_at desc,
                    m.id desc
         ) as duplicate_rank
    from public.turn_project_members m
)
delete from public.turn_project_members duplicate
 using ranked r
 where duplicate.id = r.id
   and r.duplicate_rank > 1;

update public.turn_project_members m
   set member_email = lower(btrim(m.member_email))
 where m.member_email is distinct from lower(btrim(m.member_email));

create or replace function public.turn_normalize_member_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.member_email := lower(btrim(new.member_email));
  if nullif(new.member_email, '') is null then
    raise exception using errcode = '22023', message = 'TURN_TEAM: member email is required';
  end if;
  return new;
end;
$$;

drop trigger if exists turn_normalize_member_email on public.turn_project_members;
create trigger turn_normalize_member_email
  before insert or update of member_email on public.turn_project_members
  for each row execute function public.turn_normalize_member_email();

create unique index if not exists turn_project_members_project_email_ci_key
  on public.turn_project_members(project_id, lower(member_email));

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.turn_project_members'::regclass
       and conname = 'turn_project_members_email_canonical_check'
  ) then
    alter table public.turn_project_members
      add constraint turn_project_members_email_canonical_check
      check (member_email = lower(btrim(member_email)) and member_email <> '')
      not valid;
  end if;
end;
$$;
alter table public.turn_project_members
  validate constraint turn_project_members_email_canonical_check;

revoke all on function public.turn_normalize_member_email() from public;

-- Old browser conversion created a Show beside Episode 1 but left the original
-- direct invitations active. Because legacy Episode grants project back to the
-- Show Bible, a later removal/demotion on the Show could otherwise be bypassed
-- by that stale row. Promote only each Show's recorded source Episode here: this
-- is the known conversion artifact. Do not blanket-promote other Episode-only
-- grants, which would silently expand their access to every sibling Episode.
insert into public.turn_project_members(
  project_id, owner, member_email, member_user, role, status, created_at, updated_at
)
select s.id, s.owner, m.member_email, m.member_user, m.role, 'active',
       m.created_at, m.updated_at
  from public.turn_projects s
  join public.turn_projects e
    on e.id = public.turn_series_try_uuid(s.doc ->> 'sourceEpisodeId')
   and e.show_id = s.id
   and e.owner = s.owner
  join public.turn_project_members m
    on m.project_id = e.id
   and m.status = 'active'
 where s.project_kind = 'show'
on conflict (project_id, member_email) do nothing;

update public.turn_project_members m
   set status = 'removed', updated_at = now()
  from public.turn_projects e, public.turn_projects s
 where m.project_id = e.id
   and m.status = 'active'
   and s.project_kind = 'show'
   and e.id = public.turn_series_try_uuid(s.doc ->> 'sourceEpisodeId')
   and e.show_id = s.id
   and e.owner = s.owner
   and exists (
     select 1
       from public.turn_project_members canonical
      where canonical.project_id = s.id
        and lower(canonical.member_email) = lower(m.member_email)
   );

-- If a canonical Show membership already exists for any legacy episode grant,
-- it is already the owner's chosen series-wide source of truth. Retiring the
-- duplicate cannot broaden access; it prevents an old stronger/direct role from
-- overriding that canonical active, demoted, or removed state.
update public.turn_project_members legacy
   set status = 'removed', updated_at = now()
  from public.turn_projects episode
 where legacy.project_id = episode.id
   and legacy.status = 'active'
   and episode.project_kind = 'episode'
   and exists (
     select 1
       from public.turn_project_members canonical
      where canonical.project_id = episode.show_id
        and (
          lower(canonical.member_email) = lower(legacy.member_email)
          or (canonical.member_user is not null
              and legacy.member_user = canonical.member_user)
        )
   );

-- Whenever an owner subsequently manages a canonical Show membership, retire
-- any matching active direct Episode grants in that Show. This applies equally
-- to invite, role change, and removal, so a stale legacy row cannot preserve a
-- stronger role or resurrect access. Episode-only grants remain untouched until
-- the owner explicitly manages that person at Show scope.
create or replace function public.turn_retire_legacy_episode_memberships()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_project_id uuid;
  target_email text;
  target_user uuid;
  target_is_show boolean := false;
begin
  target_project_id := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  target_email := case when tg_op = 'DELETE' then old.member_email else new.member_email end;
  target_user := case when tg_op = 'DELETE' then old.member_user else new.member_user end;

  select (p.project_kind = 'show' or public.turn_series_doc_is_show(p.doc))
    into target_is_show
    from public.turn_projects p
   where p.id = target_project_id;
  if not coalesce(target_is_show, false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  update public.turn_project_members legacy
     set status = 'removed', updated_at = now()
    from public.turn_projects episode
   where legacy.project_id = episode.id
     and legacy.status = 'active'
     and episode.show_id = target_project_id
     and (
       lower(legacy.member_email) = lower(target_email)
       or (target_user is not null and legacy.member_user = target_user)
     );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists turn_retire_legacy_episode_memberships on public.turn_project_members;
create trigger turn_retire_legacy_episode_memberships
  after insert or update or delete on public.turn_project_members
  for each row execute function public.turn_retire_legacy_episode_memberships();

revoke all on function public.turn_retire_legacy_episode_memberships() from public;

-- Internal relationship scope for permission checks. For an Episode this is
-- [episode, parent Show]. For a Show it is [show, legacy directly-shared child
-- episodes]. The latter projects old invitations up to the Bible, but because
-- an arbitrary sibling is never in an Episode's scope, it does not leak across.
create or replace function public.turn_series_membership_scope(p_project_id uuid)
returns table(project_id uuid)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with target as (
    select p.id,
           p.owner,
           (p.project_kind = 'show' or public.turn_series_doc_is_show(p.doc)) as is_show,
           coalesce(p.show_id, public.turn_series_doc_show_id(p.doc)) as linked_show_id
      from public.turn_projects p
     where p.id = p_project_id
  )
  select t.id from target t
  union
  select s.id
    from target t
    join public.turn_projects s on s.id = t.linked_show_id
   where not t.is_show
     and s.owner = t.owner
     and (s.project_kind = 'show' or public.turn_series_doc_is_show(s.doc))
  union
  select e.id
    from target t
    join public.turn_projects e
      on coalesce(e.show_id, public.turn_series_doc_show_id(e.doc)) = t.id
   where t.is_show
     and e.id <> t.id
     and e.owner = t.owner
     and not public.turn_series_doc_is_show(e.doc);
$$;

-- All roles that apply to the current user at this target. Keeping the set is
-- important: writer and art_director are different departments, not a simple
-- privilege ladder, so role enforcement unions their allowed sections.
create or replace function public.turn_effective_project_roles(p_project_id uuid)
returns table(role text)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select distinct m.role
    from public.turn_project_members m
    join public.turn_series_membership_scope(p_project_id) scope
      on scope.project_id = m.project_id
   where m.status = 'active'
     and auth.uid() is not null
     and (
       m.member_user = auth.uid()
       or (
         public.turn_current_email() <> ''
         and lower(m.member_email) = public.turn_current_email()
       )
     );
$$;

-- Compact role lookup for clients/diagnostics. Enforcement uses the complete
-- set above; this label prefers asset capability when multiple legacy grants
-- overlap.
create or replace function public.turn_effective_project_role(p_project_id uuid)
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case
    when exists (
      select 1 from public.turn_projects p
       where p.id = p_project_id and p.owner = auth.uid()
    ) then 'owner'
    when exists (
      select 1 from public.turn_effective_project_roles(p_project_id) r
       where r.role = 'art_director'
    ) then 'art_director'
    when exists (
      select 1 from public.turn_effective_project_roles(p_project_id) r
       where r.role = 'writer'
    ) then 'writer'
    when exists (
      select 1 from public.turn_effective_project_roles(p_project_id) r
       where r.role = 'view_only'
    ) then 'view_only'
    else null
  end;
$$;

-- Replaces the helper referenced by project, membership, generation, and
-- storage RLS policies. Existing policies pick up this definition immediately.
create or replace function public.turn_can_access_project(pid uuid, write_access boolean default false)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.turn_projects p
     where p.id = pid and p.owner = auth.uid()
  ) or exists (
    select 1
      from public.turn_effective_project_roles(pid) r
     where not write_access or r.role in ('writer', 'art_director')
  );
$$;

-- Assets remain art-department work, now with the same inherited series scope.
create or replace function public.turn_can_write_assets(pid uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.turn_projects p
     where p.id = pid and p.owner = auth.uid()
  ) or exists (
    select 1
      from public.turn_effective_project_roles(pid) r
     where r.role = 'art_director'
  );
$$;

grant execute on function public.turn_can_access_project(uuid, boolean) to authenticated;
grant execute on function public.turn_can_write_assets(uuid) to authenticated;
grant execute on function public.turn_effective_project_role(uuid) to authenticated;

-- Internal helpers should not expose relationship or membership rows directly.
revoke all on function public.turn_series_membership_scope(uuid) from public;
revoke all on function public.turn_effective_project_roles(uuid) from public;
revoke all on function public.turn_series_doc_is_show(jsonb) from public;
revoke all on function public.turn_series_try_uuid(text) from public;
revoke all on function public.turn_series_try_positive_int(text) from public;
revoke all on function public.turn_series_doc_show_id(jsonb) from public;
revoke all on function public.turn_series_doc_episode_no(jsonb) from public;
revoke all on function public.turn_sync_project_series_metadata() from public;
revoke all on function public.turn_guard_series_project_delete() from public;

-- The collaborative UPDATE policy intentionally admits both writing roles so
-- they can save the doc departments assigned to them. That permission must not
-- become permission to rewrite the row envelope through a hand-authored REST
-- request. In particular, `title` is the Project Switcher's owner-managed name,
-- while the normalized series columns are lifecycle state owned by the RPCs and
-- sync trigger. UPDATE OF is evaluated from the caller's original SET list, so
-- this guard does not object when the normal touch/sync triggers derive
-- `updated_at` or normalized metadata from an otherwise legitimate doc save.
create or replace function public.turn_guard_collaborator_project_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
begin
  -- Service-role migrations and the row owner retain their existing authority.
  if caller is null or old.owner = caller then return new; end if;

  if new.id is distinct from old.id then
    raise exception 'TURN_ROLE_SCOPE: only the owner can change a project row''s identity';
  end if;
  if new.owner is distinct from old.owner then
    raise exception 'TURN_ROLE_SCOPE: only the owner can transfer a film''s ownership';
  end if;
  if new.title is distinct from old.title then
    raise exception 'TURN_ROLE_SCOPE: only the owner can rename a film or Show';
  end if;
  if new.created_at is distinct from old.created_at
     or new.updated_at is distinct from old.updated_at then
    raise exception 'TURN_ROLE_SCOPE: project timestamps are server-managed';
  end if;
  if new.project_kind is distinct from old.project_kind
     or new.show_id is distinct from old.show_id
     or new.episode_no is distinct from old.episode_no then
    raise exception 'TURN_ROLE_SCOPE: series lifecycle metadata is owner-managed';
  end if;

  return new;
end;
$$;

drop trigger if exists turn_guard_collaborator_project_columns on public.turn_projects;
create trigger turn_guard_collaborator_project_columns
  before update of id, owner, title, created_at, updated_at,
                   project_kind, show_id, episode_no
  on public.turn_projects
  for each row execute function public.turn_guard_collaborator_project_columns();

revoke all on function public.turn_guard_collaborator_project_columns() from public;

-- Replaces enforce-role-scopes.sql's trigger function. A Show grant applies to
-- its Episodes, while a legacy child grant applies to the Show Bible only.
create or replace function public.turn_enforce_role_sections()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  allowed text[];
  k text;
begin
  if caller is null then return new; end if;
  if old.owner = caller then return new; end if;

  if new.owner is distinct from old.owner then
    raise exception 'TURN_ROLE_SCOPE: only the owner can transfer a film''s ownership';
  end if;

  select coalesce(array_agg(distinct section_name), array[]::text[])
    into allowed
    from public.turn_effective_project_roles(old.id) r
    cross join lateral unnest(public.turn_role_allowed_sections(r.role))
      as permitted(section_name);

  for k in
    select key from (
      select jsonb_object_keys(coalesce(old.doc, '{}'::jsonb)) as key
      union
      select jsonb_object_keys(coalesce(new.doc, '{}'::jsonb))
    ) keys
  loop
    if k = '_rev' then continue; end if;
    if (old.doc -> k) is distinct from (new.doc -> k)
       and not (k = any(allowed)) then
      raise exception 'TURN_ROLE_SCOPE: your role does not cover the "%" section of this film', k;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists turn_enforce_role_sections on public.turn_projects;
create trigger turn_enforce_role_sections
  before update on public.turn_projects
  for each row
  when (old.doc is distinct from new.doc or old.owner is distinct from new.owner)
  execute function public.turn_enforce_role_sections();

-- Keep owner attribution useful for inherited rows on the Home wall/switcher.
-- Unlike the original direct-membership-only helper, this returns every project
-- the caller can actually read under the series-aware policy.
create or replace function public.turn_shared_film_owners()
returns table(project_id uuid, owner_email text)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select p.id, lower(u.email)::text
    from public.turn_projects p
    join auth.users u on u.id = p.owner
   where p.owner <> auth.uid()
     and public.turn_can_access_project(p.id, false);
$$;

grant execute on function public.turn_shared_film_owners() to authenticated;

-- ── 3. Exact-path Storage cleanup authorization ────────────────────────────

-- Postgres can atomically delete the Show, Episodes, and their generation rows,
-- but Storage objects live outside that transaction. Once the project rows are
-- gone, the ordinary turn_can_write_assets(project_id) policy quite correctly
-- stops authorizing deletes. This table bridges only that narrow post-commit
-- window: the owner-only delete RPC records every exact object key captured in
-- its transaction, and the Storage DELETE policy recognizes only those keys for
-- one hour. A project id by itself is never a cleanup capability. The grant
-- supplies no read, insert, or update access and is removed immediately after
-- successful client cleanup whenever that acknowledgement reaches the server.
create table if not exists public.turn_asset_cleanup_grants (
  path text primary key,
  project_id uuid not null,
  owner uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (char_length(path) between 3 and 1024),
  check (expires_at > created_at)
);

-- Upgrade the earlier project-wide bridge without carrying any broad authority
-- forward. Pending browser cleanup may need to be retried, but retaining a
-- project-prefix grant would violate the exact-key boundary this migration sets.
alter table public.turn_asset_cleanup_grants
  add column if not exists path text;
delete from public.turn_asset_cleanup_grants where path is null;
alter table public.turn_asset_cleanup_grants
  alter column path set not null;
alter table public.turn_asset_cleanup_grants
  drop constraint if exists turn_asset_cleanup_grants_pkey;
create unique index if not exists turn_asset_cleanup_grants_path_key
  on public.turn_asset_cleanup_grants(path);
alter table public.turn_asset_cleanup_grants
  add constraint turn_asset_cleanup_grants_pkey
  primary key using index turn_asset_cleanup_grants_path_key;

alter table public.turn_asset_cleanup_grants enable row level security;
revoke all on table public.turn_asset_cleanup_grants from anon, authenticated;

create index if not exists turn_asset_cleanup_grants_expiry_idx
  on public.turn_asset_cleanup_grants(expires_at);
create index if not exists turn_asset_cleanup_grants_project_idx
  on public.turn_asset_cleanup_grants(project_id, owner);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.turn_asset_cleanup_grants'::regclass
       and conname = 'turn_asset_cleanup_grants_path_check'
  ) then
    alter table public.turn_asset_cleanup_grants
      add constraint turn_asset_cleanup_grants_path_check
      check (char_length(path) between 3 and 1024) not valid;
  end if;
end;
$$;
alter table public.turn_asset_cleanup_grants
  validate constraint turn_asset_cleanup_grants_path_check;

-- Uploads and generation-row commits cannot share one transaction: Storage may
-- accept bytes just before an owner deletes the Episode/Show, causing the later
-- `turn_generations` insert to fail. Register the exact object key *before* its
-- upload so that its uploader can remove only those uncommitted bytes after the
-- project row is gone. `project_id` deliberately has no foreign key; the intent
-- must survive project deletion long enough to authorize that compensation.
create table if not exists public.turn_asset_upload_intents (
  path text primary key,
  project_id uuid not null,
  uploader uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (char_length(path) between 3 and 1024),
  check (expires_at > created_at)
);

alter table public.turn_asset_upload_intents enable row level security;
revoke all on table public.turn_asset_upload_intents from anon, authenticated;

create index if not exists turn_asset_upload_intents_expiry_idx
  on public.turn_asset_upload_intents(expires_at);
create index if not exists turn_asset_upload_intents_uploader_idx
  on public.turn_asset_upload_intents(uploader, expires_at);

-- The cleanup obligation must outlive both the project and, if necessary, the
-- uploader account. Older installations cascaded these rows from auth.users;
-- remove that dependency before introducing the durable queue below.
alter table public.turn_asset_upload_intents
  drop constraint if exists turn_asset_upload_intents_uploader_fkey;

-- An upload intent is a short reservation, but its cleanup obligation cannot
-- expire. Expired or deletion-interrupted intents move here atomically. A
-- service-role worker leases exact keys, removes them through the Storage API,
-- and acknowledges only the matching lease; ordinary users can still retry
-- cleanup for their own exact queued keys. No prefix or bucket listing is ever
-- exposed by this contract.
create table if not exists public.turn_asset_cleanup_queue (
  path text primary key,
  project_id uuid not null,
  uploader uuid not null,
  reason text not null default 'abandoned_upload'
    check (reason in ('abandoned_upload','project_deleted')),
  queued_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  check (char_length(path) between 3 and 1024)
);

alter table public.turn_asset_cleanup_queue enable row level security;
revoke all on table public.turn_asset_cleanup_queue from anon, authenticated;
create index if not exists turn_asset_cleanup_queue_ready_idx
  on public.turn_asset_cleanup_queue(available_at, lease_expires_at);
create index if not exists turn_asset_cleanup_queue_uploader_idx
  on public.turn_asset_cleanup_queue(uploader, project_id);

create or replace function public.turn_queue_expired_asset_uploads()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  queued integer := 0;
begin
  insert into public.turn_asset_cleanup_queue(
    path, project_id, uploader, reason, queued_at, available_at
  )
  select i.path, i.project_id, i.uploader, 'abandoned_upload',
         statement_timestamp(), statement_timestamp()
    from public.turn_asset_upload_intents i
   where i.expires_at <= statement_timestamp()
  on conflict (path) do nothing;
  get diagnostics queued = row_count;

  delete from public.turn_asset_upload_intents i
   where i.expires_at <= statement_timestamp()
     and exists (
       select 1 from public.turn_asset_cleanup_queue q
        where q.path = i.path
          and q.project_id = i.project_id
          and q.uploader = i.uploader
     );
  return queued;
end;
$$;

create or replace function public.turn_queue_project_asset_uploads(
  p_project_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  queued integer := 0;
begin
  if coalesce(cardinality(p_project_ids), 0) = 0 then return 0; end if;
  insert into public.turn_asset_cleanup_queue(
    path, project_id, uploader, reason, queued_at, available_at
  )
  select i.path, i.project_id, i.uploader, 'project_deleted',
         statement_timestamp(),
         greatest(i.expires_at, statement_timestamp() + interval '30 minutes')
    from public.turn_asset_upload_intents i
   where i.project_id = any(p_project_ids)
  on conflict (path) do update
    set available_at = greatest(
          public.turn_asset_cleanup_queue.available_at,
          excluded.available_at
        ),
        reason = 'project_deleted';
  get diagnostics queued = row_count;

  delete from public.turn_asset_upload_intents i
   where i.project_id = any(p_project_ids)
     and exists (
       select 1 from public.turn_asset_cleanup_queue q
        where q.path = i.path
          and q.project_id = i.project_id
          and q.uploader = i.uploader
     );
  return queued;
end;
$$;

-- Begin is the only path which can mint an intent. It requires current Art Room
-- write access and a canonical key whose first two folders are exactly the caller
-- and target project. Outstanding live intents are bounded per account.
drop function if exists public.turn_begin_asset_upload(uuid, text);
create function public.turn_begin_asset_upload(p_project_id uuid, p_path text)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  folders text[];
  deadline timestamptz := statement_timestamp() + interval '30 minutes';
  active_count integer;
  stored_deadline timestamptz;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'TURN_ASSET_UPLOAD: sign in before uploading';
  end if;
  if p_project_id is null or nullif(btrim(p_path), '') is null
     or char_length(p_path) > 1024 then
    raise exception using errcode = '22023', message = 'TURN_ASSET_UPLOAD: project and exact path are required';
  end if;

  folders := storage.foldername(p_path);
  if array_length(folders, 1) < 4
     or folders[1] is distinct from caller::text
     or public.turn_storage_project_id(p_path) is distinct from p_project_id
     or position(chr(92) in p_path) > 0
     or exists (select 1 from unnest(folders) part where part in ('', '.', '..')) then
    raise exception using errcode = '22023', message = 'TURN_ASSET_UPLOAD: path is outside the caller project scope';
  end if;
  if not public.turn_can_write_assets(p_project_id) then
    raise exception using errcode = '42501', message = 'TURN_ASSET_UPLOAD: Art Room write access is required';
  end if;
  -- Serialize this uploader's reservations so concurrent tabs cannot race past
  -- the outstanding-intent cap. The lock is transaction-scoped and namespaced
  -- to this capability; it is released before any Storage upload begins.
  perform pg_advisory_xact_lock(
    hashtextextended('turn_asset_upload:' || caller::text, 0)
  );
  -- Expiry ends the upload reservation, never its cleanup obligation. Promotion
  -- to the durable queue and intent removal happen in one transaction.
  perform public.turn_queue_expired_asset_uploads();

  -- An intent describes bytes that do not exist yet. Without this check, a
  -- malicious collaborator could reserve the name of an already-committed file
  -- immediately before their role is removed and retain a one-path delete token.
  if exists (
    select 1 from storage.objects o
     where o.bucket_id = 'turn-assets'
       and o.name = p_path
  ) or exists (
    select 1 from public.turn_asset_cleanup_queue q
     where q.path = p_path
  ) then
    raise exception using errcode = '23505', message = 'TURN_ASSET_UPLOAD: exact path already exists';
  end if;

  select count(*) into active_count
    from public.turn_asset_upload_intents i
   where i.uploader = caller
     and i.expires_at > statement_timestamp()
     and i.path <> p_path;
  if active_count >= 256 then
    raise exception using errcode = '54000', message = 'TURN_ASSET_UPLOAD: too many unfinished uploads';
  end if;

  -- A reservation is exclusive even to another tab owned by the same caller.
  -- Letting two uploads share one exact-path capability would allow the losing
  -- upload's compensation to delete bytes accepted for the winning upload.
  -- A response lost after this insert is therefore safely non-retriable at the
  -- same path; the client generates a fresh random path for its next attempt.
  insert into public.turn_asset_upload_intents(path, project_id, uploader, created_at, expires_at)
  values (p_path, p_project_id, caller, statement_timestamp(), deadline)
  on conflict (path) do nothing
  returning expires_at into stored_deadline;

  if stored_deadline is null then
    raise exception using errcode = '23505', message = 'TURN_ASSET_UPLOAD: exact path is already reserved';
  end if;
  return stored_deadline;
end;
$$;

-- Finishing is idempotent and can only retire the caller's exact capabilities.
-- The client calls it after a generation/Cameo row is durably confirmed, or
-- after compensating deletion confirms the bytes are gone.
drop function if exists public.turn_finish_asset_upload(text[]);
create function public.turn_finish_asset_upload(p_paths text[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  removed integer := 0;
  removed_now integer := 0;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'TURN_ASSET_UPLOAD: sign in before finishing an upload';
  end if;
  if coalesce(cardinality(p_paths), 0) > 256 then
    raise exception using errcode = '22023', message = 'TURN_ASSET_UPLOAD: too many exact paths';
  end if;

  delete from public.turn_asset_upload_intents i
   where i.uploader = caller
     and i.path = any(coalesce(p_paths, array[]::text[]));
  get diagnostics removed = row_count;
  delete from public.turn_asset_cleanup_queue q
   where q.uploader = caller
     and q.path = any(coalesce(p_paths, array[]::text[]));
  get diagnostics removed_now = row_count;
  removed := removed + removed_now;
  return removed;
end;
$$;

revoke all on function public.turn_begin_asset_upload(uuid, text) from public;
revoke all on function public.turn_finish_asset_upload(text[]) from public;
grant execute on function public.turn_begin_asset_upload(uuid, text) to authenticated;
grant execute on function public.turn_finish_asset_upload(text[]) to authenticated;

-- Retire generation intents in the same Postgres transaction that makes their
-- paths durable. This is the security backstop for a modified or interrupted
-- client which never sends the explicit finish RPC: a committed asset never
-- keeps an upload-intent delete capability.
create or replace function public.turn_finish_generation_upload_intents()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  committed_paths text[] := array[]::text[];
begin
  select coalesce(array_agg(distinct committed.path), array[]::text[])
    into committed_paths
    from (
      select nullif(new.storage_path, '') as path
      union
      select nullif(ref ->> 'storage_path', '')
        from jsonb_array_elements(
          case when jsonb_typeof(new.refs) = 'array' then new.refs else '[]'::jsonb end
        ) ref
      union
      select nullif(history ->> 'storage_path', '')
        from jsonb_array_elements(
          case when jsonb_typeof(new.history) = 'array' then new.history else '[]'::jsonb end
        ) history
      union
      select nullif(ref ->> 'storage_path', '')
        from jsonb_array_elements(
          case when jsonb_typeof(new.history) = 'array' then new.history else '[]'::jsonb end
        ) history
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(history -> 'refs') = 'array'
            then history -> 'refs' else '[]'::jsonb end
        ) ref
    ) committed
   where committed.path is not null;

  delete from public.turn_asset_upload_intents i
   where i.project_id = new.project_id
     and i.uploader = new.owner
     and i.path = any(committed_paths);
  delete from public.turn_asset_cleanup_queue q
   where q.project_id = new.project_id
     and q.uploader = new.owner
     and q.path = any(committed_paths);
  return new;
end;
$$;

drop trigger if exists turn_finish_generation_upload_intents on public.turn_generations;
create trigger turn_finish_generation_upload_intents
  after insert or update of storage_path, refs, history on public.turn_generations
  for each row execute function public.turn_finish_generation_upload_intents();

-- Cameos are optional, so install the same transactional retirement hook only
-- when their table is present. Re-running this migration after cameos.sql adds it.
create or replace function public.turn_finish_cameo_upload_intents()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  committed_paths text[] := array[]::text[];
begin
  select coalesce(array_agg(distinct nullif(angle ->> 'storage_path', '')), array[]::text[])
    into committed_paths
    from jsonb_array_elements(
      case when jsonb_typeof(new.angles) = 'array' then new.angles else '[]'::jsonb end
    ) angle
   where nullif(angle ->> 'storage_path', '') is not null;

  delete from public.turn_asset_upload_intents i
   where i.project_id = new.project_id
     and i.uploader = new.owner
     and i.path = any(committed_paths);
  delete from public.turn_asset_cleanup_queue q
   where q.project_id = new.project_id
     and q.uploader = new.owner
     and q.path = any(committed_paths);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.turn_cameos') is not null then
    execute 'drop trigger if exists turn_finish_cameo_upload_intents on public.turn_cameos';
    execute 'create trigger turn_finish_cameo_upload_intents
      after insert or update of angles on public.turn_cameos
      for each row execute function public.turn_finish_cameo_upload_intents()';
  end if;
end;
$$;

revoke all on function public.turn_finish_generation_upload_intents() from public;
revoke all on function public.turn_finish_cameo_upload_intents() from public;

-- Server-side sweeper contract. A scheduled Edge Function using the service key
-- calls claim, removes each returned exact path through the Storage API, then
-- completes the matching lease. Failed removals are retained and become
-- claimable again; no wildcard or project prefix ever crosses this boundary.
drop function if exists public.turn_claim_asset_cleanup_batch(integer);
create function public.turn_claim_asset_cleanup_batch(p_limit integer default 100)
returns table(
  path text,
  project_id uuid,
  uploader uuid,
  lease_token uuid,
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  take_count integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'TURN_ASSET_CLEANUP: service role required';
  end if;
  perform public.turn_queue_expired_asset_uploads();

  return query
  with candidates as (
    select q.path
      from public.turn_asset_cleanup_queue q
     where q.available_at <= statement_timestamp()
       and (q.lease_expires_at is null or q.lease_expires_at <= statement_timestamp())
     order by q.available_at, q.queued_at, q.path
     for update skip locked
     limit take_count
  ), leased as (
    update public.turn_asset_cleanup_queue q
       set lease_token = gen_random_uuid(),
           lease_expires_at = statement_timestamp() + interval '10 minutes',
           attempts = q.attempts + 1
      from candidates c
     where q.path = c.path
    returning q.path, q.project_id, q.uploader, q.lease_token, q.attempts
  )
  select l.path, l.project_id, l.uploader, l.lease_token, l.attempts
    from leased l
   order by l.path;
end;
$$;

drop function if exists public.turn_complete_asset_cleanup(text, uuid, boolean, text);
create function public.turn_complete_asset_cleanup(
  p_path text,
  p_lease_token uuid,
  p_confirmed_removed boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'TURN_ASSET_CLEANUP: service role required';
  end if;
  if nullif(btrim(p_path), '') is null or p_lease_token is null then
    raise exception using errcode = '22023', message = 'TURN_ASSET_CLEANUP: exact path and lease are required';
  end if;

  if coalesce(p_confirmed_removed, false) then
    delete from public.turn_asset_cleanup_queue q
     where q.path = p_path
       and q.lease_token = p_lease_token;
  else
    update public.turn_asset_cleanup_queue q
       set lease_token = null,
           lease_expires_at = null,
           available_at = statement_timestamp() + interval '5 minutes',
           last_error = left(coalesce(nullif(btrim(p_error), ''), 'Storage cleanup was not confirmed'), 500)
     where q.path = p_path
       and q.lease_token = p_lease_token;
  end if;
  return found;
end;
$$;

revoke all on function public.turn_queue_expired_asset_uploads() from public;
revoke all on function public.turn_queue_project_asset_uploads(uuid[]) from public;
revoke all on function public.turn_claim_asset_cleanup_batch(integer) from public;
revoke all on function public.turn_complete_asset_cleanup(text, uuid, boolean, text) from public;
grant execute on function public.turn_claim_asset_cleanup_batch(integer) to service_role;
grant execute on function public.turn_complete_asset_cleanup(text, uuid, boolean, text) to service_role;

create or replace function public.turn_can_delete_asset_path(path text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with target as (
    select public.turn_storage_project_id($1) as project_id
  )
  select coalesce((
    select t.project_id is not null and (
      public.turn_can_write_assets(t.project_id)
      or exists (
        select 1
          from public.turn_asset_cleanup_grants g
         where g.path = $1
           and g.project_id = t.project_id
           and g.owner = auth.uid()
           and g.expires_at > statement_timestamp()
      )
      or exists (
        select 1
          from public.turn_asset_upload_intents i
         where i.path = $1
           and i.project_id = t.project_id
           and i.uploader = auth.uid()
      )
      or exists (
        select 1
          from public.turn_asset_cleanup_queue q
         where q.path = $1
           and q.project_id = t.project_id
           and q.uploader = auth.uid()
      )
    )
      from target t
  ), false);
$$;

revoke all on function public.turn_can_delete_asset_path(text) from public;
grant execute on function public.turn_can_delete_asset_path(text) to authenticated;

-- Preserve normal live-project authorization, the owner tombstone for a
-- committed lifecycle delete, and the uploader's exact uncommitted-path intent.
-- Neither temporary capability grants Storage read, insert, or update access.
drop policy if exists "turn assets delete own" on storage.objects;
drop policy if exists "turn assets delete collab" on storage.objects;
create policy "turn assets delete collab" on storage.objects for delete
  using (
    bucket_id = 'turn-assets'
    and public.turn_can_delete_asset_path(name)
  );

-- Cameo rows intentionally remain private to the person who captured them.
-- Tighten writes so knowing a project UUID is not enough to attach a cameo to
-- it. The Show-owner lifecycle RPC is the only definer path that reads their
-- angle object keys, solely so deletion can clean those exact objects.
do $$
begin
  if to_regclass('public.turn_cameos') is not null then
    execute 'drop policy if exists "cameos write own" on public.turn_cameos';
    execute 'drop policy if exists "cameos update own" on public.turn_cameos';
    execute 'drop policy if exists "cameos delete own" on public.turn_cameos';
    execute 'create policy "cameos write own" on public.turn_cameos for insert
      with check (auth.uid() = owner and public.turn_can_write_assets(project_id))';
    execute 'create policy "cameos update own" on public.turn_cameos for update
      using (auth.uid() = owner and public.turn_can_write_assets(project_id))
      with check (auth.uid() = owner and public.turn_can_write_assets(project_id))';
    execute 'create policy "cameos delete own" on public.turn_cameos for delete
      using (auth.uid() = owner and public.turn_can_write_assets(project_id))';
  end if;
end;
$$;

-- ── 4. Atomic owner-only lifecycle RPCs ────────────────────────────────────

drop function if exists public.turn_convert_project_to_show(uuid, text, jsonb, text);
create function public.turn_convert_project_to_show(
  p_episode_id uuid,
  p_show_title text,
  p_bible jsonb,
  p_format text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  episode_row public.turn_projects%rowtype;
  show_row public.turn_projects%rowtype;
  existing_show_id uuid;
  show_title text;
  show_format text;
  show_doc jsonb;
  episode_doc jsonb;
  episode_project jsonb;
  episode_rev integer;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'TURN_SERIES: sign in before creating a Show';
  end if;
  if p_episode_id is null then
    raise exception using errcode = '22023', message = 'TURN_SERIES: an Episode 1 project is required';
  end if;
  if p_bible is not null and jsonb_typeof(p_bible) <> 'object' then
    raise exception using errcode = '22023', message = 'TURN_SERIES: p_bible must be a JSON object';
  end if;

  select * into episode_row
    from public.turn_projects p
   where p.id = p_episode_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TURN_SERIES: Episode 1 project was not found';
  end if;
  if episode_row.owner <> caller then
    raise exception using errcode = '42501', message = 'TURN_SERIES: only the project owner can create its Show';
  end if;
  if episode_row.project_kind = 'show' or public.turn_series_doc_is_show(episode_row.doc) then
    raise exception using errcode = '22023', message = 'TURN_SERIES: a Show cannot be converted into another Show';
  end if;

  -- Network-safe retry: if the first call committed but its response was lost,
  -- return the already-created pair rather than creating a second Show.
  existing_show_id := coalesce(
    episode_row.show_id,
    public.turn_series_doc_show_id(episode_row.doc)
  );
  if existing_show_id is not null then
    select * into show_row
      from public.turn_projects s
     where s.id = existing_show_id
       and s.owner = caller
       and (s.project_kind = 'show' or public.turn_series_doc_is_show(s.doc));
    if found and show_row.doc ->> 'sourceEpisodeId' = p_episode_id::text then
      return jsonb_build_object(
        'show', to_jsonb(show_row),
        'episode', to_jsonb(episode_row),
        'idempotent', true
      );
    end if;
    raise exception using errcode = '22023', message = 'TURN_SERIES: this project already belongs to a Show';
  end if;

  show_title := nullif(btrim(p_show_title), '');
  if show_title is null then
    show_title := coalesce(nullif(btrim(episode_row.title), ''), 'Untitled') || ' — Show';
  end if;
  show_format := coalesce(nullif(btrim(p_format), ''), 'series');
  p_bible := jsonb_set(
    coalesce(p_bible, '{}'::jsonb),
    '{trash}',
    public.turn_series_shared_trash(coalesce(p_bible, '{}'::jsonb) -> 'trash'),
    true
  );
  if not public.turn_series_bible_is_valid(p_bible) then
    raise exception using
      errcode = '22023',
      message = 'TURN_SERIES: conversion requires a complete shared Bible, including shared restore bins';
  end if;

  show_doc := jsonb_build_object(
    'isShow', true,
    'format', show_format,
    'lastEpisodeNo', 1,
    'schemaVersion', 3,
    'sourceEpisodeId', p_episode_id::text,
    'assetMigration', jsonb_build_object(
      'from', p_episode_id::text,
      'status', 'pending',
      'at', clock_timestamp()
    ),
    'bible', coalesce(p_bible, '{}'::jsonb),
    '_rev', 1
  );

  perform set_config('turn.series_lifecycle', 'true', true);
  insert into public.turn_projects(owner, title, doc)
  values (caller, show_title, show_doc)
  returning * into show_row;

  -- Converting an already-collaborative film promotes its active invitations to
  -- the Show so future Episodes inherit the same team. The source rows are then
  -- retired in this same transaction: leaving them active would let a later Show
  -- removal/demotion be bypassed through legacy Episode-to-Show inheritance.
  insert into public.turn_project_members(
    project_id, owner, member_email, member_user, role, status, created_at, updated_at
  )
  select show_row.id, caller, m.member_email, m.member_user, m.role, 'active',
         m.created_at, m.updated_at
    from public.turn_project_members m
   where m.project_id = episode_row.id
     and m.status = 'active'
  on conflict (project_id, member_email) do update
    set member_user = excluded.member_user,
        role = excluded.role,
        status = 'active',
        updated_at = now();

  update public.turn_project_members
     set status = 'removed', updated_at = now()
   where project_id = episode_row.id
     and status = 'active';

  episode_project := case
    when jsonb_typeof(episode_row.doc -> 'project') = 'object'
      then episode_row.doc -> 'project'
    else '{}'::jsonb
  end;
  episode_project := episode_project || jsonb_build_object('format', show_format);
  episode_rev := coalesce(
    public.turn_series_try_positive_int(episode_row.doc ->> '_rev'), 0
  );
  episode_doc := (coalesce(episode_row.doc, '{}'::jsonb)
                    - 'isShow' - 'bible' - 'lastEpisodeNo'
                    - 'sourceEpisodeId' - 'assetMigration'
                    - 'characters' - 'locations' - 'props'
                    - 'lookbook' - 'lookbookNote' - 'trash')
    || jsonb_build_object(
      'showId', show_row.id::text,
      'episodeNo', 1,
      'trash', public.turn_series_episode_trash(episode_row.doc -> 'trash'),
      'project', episode_project,
      '_rev', episode_rev + 1
    );

  update public.turn_projects
     set doc = episode_doc
   where id = episode_row.id
  returning * into episode_row;

  return jsonb_build_object(
    'show', to_jsonb(show_row),
    'episode', to_jsonb(episode_row),
    'idempotent', false
  );
end;
$$;

drop function if exists public.turn_create_show_episode(uuid, jsonb);
drop function if exists public.turn_create_show_episode(uuid, jsonb, uuid);
create function public.turn_create_show_episode(
  p_show_id uuid,
  p_episode_doc jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  show_row public.turn_projects%rowtype;
  episode_row public.turn_projects%rowtype;
  seed_doc jsonb;
  episode_doc jsonb;
  episode_project jsonb;
  show_format text;
  base_title text;
  row_title text;
  project_title text;
  next_no integer;
  high_no integer;
  show_rev integer;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'TURN_SERIES: sign in before creating an Episode';
  end if;
  if p_show_id is null then
    raise exception using errcode = '22023', message = 'TURN_SERIES: a Show is required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'TURN_SERIES: an Episode creation request id is required';
  end if;
  if p_episode_doc is not null and jsonb_typeof(p_episode_doc) <> 'object' then
    raise exception using errcode = '22023', message = 'TURN_SERIES: p_episode_doc must be a JSON object';
  end if;

  -- This lock is the episode-number allocator. Concurrent callers serialize on
  -- the Show, so both the counter and insert commit together without duplicates.
  select * into show_row
    from public.turn_projects s
   where s.id = p_show_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TURN_SERIES: Show was not found';
  end if;
  if show_row.owner <> caller then
    raise exception using errcode = '42501', message = 'TURN_SERIES: only the Show owner can create Episodes';
  end if;
  if show_row.project_kind <> 'show' and not public.turn_series_doc_is_show(show_row.doc) then
    raise exception using errcode = '22023', message = 'TURN_SERIES: p_show_id does not identify a Show';
  end if;

  -- The response to a committed request can be lost in transit. A retry with
  -- the same client UUID returns the already-created row and never consumes a
  -- second Episode number. This check happens under the same Show lock as the
  -- allocator, and the partial unique index is a final integrity backstop.
  select * into episode_row
    from public.turn_projects e
   where e.owner = show_row.owner
     and coalesce(e.show_id, public.turn_series_doc_show_id(e.doc)) = show_row.id
     and e.doc ->> 'seriesCreateRequestId' = p_request_id::text
   limit 1;
  if found then
    return jsonb_build_object(
      'show', to_jsonb(show_row),
      'episode', to_jsonb(episode_row),
      'episode_no', coalesce(episode_row.episode_no, public.turn_series_doc_episode_no(episode_row.doc)),
      'idempotent_replay', true
    );
  end if;

  select coalesce(max(coalesce(
           e.episode_no,
           public.turn_series_doc_episode_no(e.doc)
         )), 0)
    into high_no
    from public.turn_projects e
   where e.id <> show_row.id
     and e.owner = show_row.owner
     and coalesce(e.show_id, public.turn_series_doc_show_id(e.doc)) = show_row.id;

  high_no := greatest(
    high_no,
    coalesce(public.turn_series_try_positive_int(show_row.doc ->> 'lastEpisodeNo'), 0)
  );
  if high_no >= 2147483647 then
    raise exception using errcode = '22003', message = 'TURN_SERIES: episode number limit reached';
  end if;
  next_no := high_no + 1;

  seed_doc := coalesce(p_episode_doc, '{}'::jsonb)
    - 'isShow' - 'bible' - 'lastEpisodeNo'
    - 'sourceEpisodeId' - 'assetMigration'
    - 'characters' - 'locations' - 'props'
    - 'lookbook' - 'lookbookNote' - 'trash' - 'seriesCreateRequestId';
  seed_doc := seed_doc || jsonb_build_object(
    'trash', public.turn_series_episode_trash(coalesce(p_episode_doc, '{}'::jsonb) -> 'trash')
  );
  episode_project := case
    when jsonb_typeof(seed_doc -> 'project') = 'object'
      then seed_doc -> 'project'
    else '{}'::jsonb
  end;
  show_format := coalesce(
    nullif(btrim(show_row.doc ->> 'format'), ''),
    nullif(btrim(episode_project ->> 'format'), ''),
    'series'
  );
  base_title := regexp_replace(
    coalesce(nullif(btrim(show_row.title), ''), 'Show'),
    ' +— +Show$', '', 'i'
  );
  if nullif(btrim(base_title), '') is null then base_title := 'Show'; end if;
  row_title := base_title || ' — E' || to_char(next_no, 'FM00');
  project_title := base_title || ' E' || to_char(next_no, 'FM00');
  episode_project := episode_project || jsonb_build_object(
    'title', project_title,
    'format', show_format
  );
  episode_doc := seed_doc || jsonb_build_object(
    'showId', show_row.id::text,
    'episodeNo', next_no,
    'seriesCreateRequestId', p_request_id::text,
    'project', episode_project,
    '_rev', 1
  );

  perform set_config('turn.series_lifecycle', 'true', true);
  show_rev := coalesce(
    public.turn_series_try_positive_int(show_row.doc ->> '_rev'), 0
  );
  update public.turn_projects
     set doc = show_row.doc || jsonb_build_object(
       'lastEpisodeNo', next_no,
       '_rev', show_rev + 1
     )
   where id = show_row.id
  returning * into show_row;

  insert into public.turn_projects(owner, title, doc)
  values (show_row.owner, row_title, episode_doc)
  returning * into episode_row;

  return jsonb_build_object(
    'show', to_jsonb(show_row),
    'episode', to_jsonb(episode_row),
    'episode_no', next_no
  );
end;
$$;

-- Delete one Episode while preserving its Show, shared Bible and siblings.
-- Final-Episode removal deliberately fails closed: the product routes that
-- choice through turn_delete_show so it cannot strand an empty Show by race.
drop function if exists public.turn_delete_show_episode(uuid);
create function public.turn_delete_show_episode(p_episode_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  parent_id uuid;
  show_row public.turn_projects%rowtype;
  episode_row public.turn_projects%rowtype;
  family_count integer := 0;
  family_episode_ids uuid[] := array[]::uuid[];
  family_project_ids uuid[] := array[]::uuid[];
  surviving_project_ids uuid[] := array[]::uuid[];
  generation_storage_paths jsonb := '[]'::jsonb;
  cameo_storage_paths jsonb := '[]'::jsonb;
  protected_storage_paths jsonb := '[]'::jsonb;
  protected_cameo_paths jsonb := '[]'::jsonb;
  authorized_cleanup_paths jsonb := '[]'::jsonb;
  pruned_bible jsonb;
  pruned_show_doc jsonb;
  cleanup_project_ids uuid[] := array[]::uuid[];
  cleanup_expires_at timestamptz := statement_timestamp() + interval '1 hour';
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'TURN_SERIES: sign in before deleting an Episode';
  end if;
  if p_episode_id is null then
    raise exception using errcode = '22023', message = 'TURN_SERIES: an Episode is required';
  end if;

  -- Discover the parent without taking the Episode lock. Every series lifecycle
  -- RPC locks the Show first, which gives conversion/create/show-delete/sibling-
  -- delete one consistent lock order and prevents deadlocks.
  select coalesce(e.show_id, public.turn_series_doc_show_id(e.doc))
    into parent_id
    from public.turn_projects e
   where e.id = p_episode_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'TURN_SERIES: Episode was not found';
  end if;
  if parent_id is null then
    raise exception using errcode = '22023', message = 'TURN_SERIES: p_episode_id does not identify a Show Episode';
  end if;

  select * into show_row
    from public.turn_projects s
   where s.id = parent_id
   for update;

  if not found then
    raise exception using errcode = '23503', message = 'TURN_SERIES: the Episode Show was not found';
  end if;
  if show_row.owner <> caller then
    raise exception using errcode = '42501', message = 'TURN_SERIES: only the Show owner can delete Episodes';
  end if;
  if show_row.project_kind <> 'show' and not public.turn_series_doc_is_show(show_row.doc) then
    raise exception using errcode = '23503', message = 'TURN_SERIES: the Episode parent is not a Show';
  end if;

  select * into episode_row
    from public.turn_projects e
   where e.id = p_episode_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TURN_SERIES: Episode was not found';
  end if;
  if episode_row.owner <> show_row.owner
     or coalesce(episode_row.show_id, public.turn_series_doc_show_id(episode_row.doc)) <> show_row.id
     or (episode_row.project_kind <> 'episode'
         and public.turn_series_doc_show_id(episode_row.doc) is null) then
    raise exception using errcode = '23514', message = 'TURN_SERIES: the Episode has an invalid Show relationship';
  end if;

  -- Lock the complete family in a deterministic order before counting. The Show
  -- lock prevents a new Episode from being allocated while this decision lands.
  perform 1
    from public.turn_projects e
   where e.owner = show_row.owner
     and coalesce(e.show_id, public.turn_series_doc_show_id(e.doc)) = show_row.id
   order by e.id
   for update;

  select coalesce(array_agg(e.id order by e.id), array[]::uuid[]), count(*)::integer
    into family_episode_ids, family_count
    from public.turn_projects e
   where e.owner = show_row.owner
     and coalesce(e.show_id, public.turn_series_doc_show_id(e.doc)) = show_row.id;

  if family_count <= 1 then
    raise exception using
      errcode = '23514',
      message = 'TURN_SERIES: delete the Show to remove its final Episode';
  end if;

  cleanup_project_ids := array[p_episode_id];
  family_project_ids := array_prepend(show_row.id, family_episode_ids);
  surviving_project_ids := array_remove(family_project_ids, p_episode_id);

  pruned_bible := public.turn_series_prune_episode_from_bible(
    show_row.doc -> 'bible', p_episode_id
  );
  if pruned_bible is distinct from show_row.doc -> 'bible' then
    pruned_show_doc := jsonb_set(show_row.doc, '{bible}', pruned_bible, false)
      || jsonb_build_object(
        '_rev', coalesce(public.turn_series_try_positive_int(show_row.doc ->> '_rev'), 0)::bigint + 1
      );
    update public.turn_projects s
       set doc = pruned_show_doc
     where s.id = show_row.id
    returning * into show_row;
  end if;

  -- Freeze all rows capable of gaining or changing an asset key. New inserts
  -- also wait behind the locked project row through their foreign-key check.
  perform 1
    from public.turn_generations g
   where g.project_id = any(family_project_ids)
   order by g.project_id, g.entity_id
   for update;
  if to_regclass('public.turn_cameos') is not null then
    execute $lock_cameos$
      select 1
        from public.turn_cameos c
       where c.project_id = any($1)
       order by c.project_id, c.owner, c.char_id
       for update
    $lock_cameos$ using family_project_ids;
  end if;

  select coalesce(
           jsonb_agg(distinct exact.path)
             filter (where nullif(btrim(exact.path), '') is not null),
           '[]'::jsonb
         )
    into generation_storage_paths
    from (
      select g.storage_path as path
        from public.turn_generations g
       where g.project_id = p_episode_id
      union all
      select ref ->> 'storage_path'
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.refs) = 'array' then g.refs else '[]'::jsonb end
        ) as refs(ref)
       where g.project_id = p_episode_id
      union all
      select history ->> 'storage_path'
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.history) = 'array' then g.history else '[]'::jsonb end
        ) as versions(history)
       where g.project_id = p_episode_id
      union all
      select ref ->> 'storage_path'
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.history) = 'array' then g.history else '[]'::jsonb end
        ) as versions(history)
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(history -> 'refs') = 'array' then history -> 'refs' else '[]'::jsonb end
        ) as refs(ref)
       where g.project_id = p_episode_id
      union all
      select pending.path
        from public.turn_generations g
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(g.meta -> 'cleanupPending') = 'array'
            then g.meta -> 'cleanupPending' else '[]'::jsonb end
        ) as pending(path)
       where g.project_id = p_episode_id
      union all
      select pending.path
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.history) = 'array' then g.history else '[]'::jsonb end
        ) as versions(history)
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(history -> 'meta' -> 'cleanupPending') = 'array'
            then history -> 'meta' -> 'cleanupPending' else '[]'::jsonb end
        ) as pending(path)
       where g.project_id = p_episode_id
    ) exact;

  -- Do not remove an Episode-namespaced object that remains referenced by the
  -- Show or a sibling. This matters for pre-migration shared assets whose rows
  -- were promoted but whose immutable Storage keys still contain Episode 1's id.
  select coalesce(
           jsonb_agg(distinct exact.path)
             filter (where nullif(btrim(exact.path), '') is not null),
           '[]'::jsonb
         )
    into protected_storage_paths
    from (
      select g.storage_path as path
        from public.turn_generations g
       where g.project_id = any(surviving_project_ids)
      union all
      select ref ->> 'storage_path'
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.refs) = 'array' then g.refs else '[]'::jsonb end
        ) as refs(ref)
       where g.project_id = any(surviving_project_ids)
      union all
      select history ->> 'storage_path'
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.history) = 'array' then g.history else '[]'::jsonb end
        ) as versions(history)
       where g.project_id = any(surviving_project_ids)
      union all
      select ref ->> 'storage_path'
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.history) = 'array' then g.history else '[]'::jsonb end
        ) as versions(history)
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(history -> 'refs') = 'array' then history -> 'refs' else '[]'::jsonb end
        ) as refs(ref)
       where g.project_id = any(surviving_project_ids)
      union all
      select pending.path
        from public.turn_generations g
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(g.meta -> 'cleanupPending') = 'array'
            then g.meta -> 'cleanupPending' else '[]'::jsonb end
        ) as pending(path)
       where g.project_id = any(surviving_project_ids)
      union all
      select pending.path
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.history) = 'array' then g.history else '[]'::jsonb end
        ) as versions(history)
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(history -> 'meta' -> 'cleanupPending') = 'array'
            then history -> 'meta' -> 'cleanupPending' else '[]'::jsonb end
        ) as pending(path)
       where g.project_id = any(surviving_project_ids)
    ) exact;

  if to_regclass('public.turn_cameos') is not null then
    execute $cameos$
      select coalesce(
        jsonb_agg(distinct angle ->> 'storage_path')
          filter (where nullif(btrim(angle ->> 'storage_path'), '') is not null),
        '[]'::jsonb
      )
        from public.turn_cameos c
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(c.angles) = 'array' then c.angles else '[]'::jsonb end
        ) as item(angle)
       where c.project_id = $1
    $cameos$ into cameo_storage_paths using p_episode_id;

    execute $protected_cameos$
      select coalesce(
        jsonb_agg(distinct angle ->> 'storage_path')
          filter (where nullif(btrim(angle ->> 'storage_path'), '') is not null),
        '[]'::jsonb
      )
        from public.turn_cameos c
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(c.angles) = 'array' then c.angles else '[]'::jsonb end
        ) as item(angle)
       where c.project_id = any($1)
    $protected_cameos$ into protected_cameo_paths using surviving_project_ids;
    protected_storage_paths := protected_storage_paths || protected_cameo_paths;
  end if;

  -- The database, not the browser, subtracts surviving family references before
  -- minting deletion authority. A protected path may still be returned for UI
  -- explanation, but it can never appear in the exact-path grant table.
  select coalesce(jsonb_agg(distinct candidate.path order by candidate.path), '[]'::jsonb)
    into authorized_cleanup_paths
    from jsonb_array_elements_text(generation_storage_paths || cameo_storage_paths)
      as candidate(path)
   where nullif(btrim(candidate.path), '') is not null
     and public.turn_storage_project_id(candidate.path) = p_episode_id
     and not exists (
       select 1
         from jsonb_array_elements_text(protected_storage_paths) protected(path)
        where protected.path = candidate.path
     );

  delete from public.turn_asset_cleanup_grants
   where expires_at <= statement_timestamp();
  insert into public.turn_asset_cleanup_grants(path, project_id, owner, created_at, expires_at)
  select exact.path, p_episode_id, caller, statement_timestamp(), cleanup_expires_at
    from jsonb_array_elements_text(authorized_cleanup_paths) exact(path)
  on conflict (path) do update
    set project_id = excluded.project_id,
        owner = excluded.owner,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at;

  -- Any upload which has not reached a durable generation/Cameo row survives
  -- project deletion as an exact queue item for uploader retry or service sweep.
  perform public.turn_queue_project_asset_uploads(cleanup_project_ids);

  perform set_config('turn.series_delete_scope', p_episode_id::text, true);
  delete from public.turn_projects p where p.id = p_episode_id;

  return jsonb_build_object(
    'episode_id', p_episode_id::text,
    'show_id', show_row.id::text,
    'episode_no', episode_row.episode_no,
    'remaining_episode_count', family_count - 1,
    'deleted_project_ids', to_jsonb(cleanup_project_ids),
    'generation_storage_paths', generation_storage_paths,
    'cameo_storage_paths', cameo_storage_paths,
    'protected_storage_paths', protected_storage_paths,
    'authorized_cleanup_paths', authorized_cleanup_paths,
    'cleanup_expires_at', cleanup_expires_at
  );
end;
$$;

drop function if exists public.turn_delete_show(uuid);
create function public.turn_delete_show(p_show_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  show_row public.turn_projects%rowtype;
  episode_ids uuid[] := array[]::uuid[];
  cleanup_project_ids uuid[] := array[]::uuid[];
  episode_count integer := 0;
  generation_storage_paths jsonb := '[]'::jsonb;
  cameo_storage_paths jsonb := '[]'::jsonb;
  authorized_cleanup_paths jsonb := '[]'::jsonb;
  cleanup_expires_at timestamptz := statement_timestamp() + interval '1 hour';
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'TURN_SERIES: sign in before deleting a Show';
  end if;
  if p_show_id is null then
    raise exception using errcode = '22023', message = 'TURN_SERIES: a Show is required';
  end if;

  select * into show_row
    from public.turn_projects s
   where s.id = p_show_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TURN_SERIES: Show was not found';
  end if;
  if show_row.owner <> caller then
    raise exception using errcode = '42501', message = 'TURN_SERIES: only the Show owner can delete the Show';
  end if;
  if show_row.project_kind <> 'show' and not public.turn_series_doc_is_show(show_row.doc) then
    raise exception using errcode = '22023', message = 'TURN_SERIES: p_show_id does not identify a Show';
  end if;

  select coalesce(array_agg(e.id), array[]::uuid[]), count(*)::integer
    into episode_ids, episode_count
    from public.turn_projects e
   where e.id <> show_row.id
     and e.owner = show_row.owner
     and coalesce(e.show_id, public.turn_series_doc_show_id(e.doc)) = show_row.id;

  cleanup_project_ids := array_append(episode_ids, p_show_id);

  -- Freeze every database row that can acquire or change a persisted Storage
  -- key before taking the final snapshot. The project locks also serialize new
  -- generation inserts through their foreign-key check; the generation locks
  -- serialize updates to rows that already exist. A writer that committed first
  -- is included below, while one that arrives later resumes only after the
  -- cascade and fails against the now-deleted project instead of orphaning a key.
  perform 1
    from public.turn_projects p
   where p.id = any(cleanup_project_ids)
   order by p.id
   for update;
  perform 1
    from public.turn_generations g
   where g.project_id = any(cleanup_project_ids)
   order by g.project_id, g.entity_id
   for update;
  if to_regclass('public.turn_cameos') is not null then
    execute $lock_cameos$
      select 1
        from public.turn_cameos c
       where c.project_id = any($1)
       order by c.project_id, c.owner, c.char_id
       for update
    $lock_cameos$ using cleanup_project_ids;
  end if;

  -- Supplement the browser's preflight with a transaction-time snapshot. This
  -- closes the narrow race where a collaborator finishes a generation after the
  -- browser inventoried rows but before this owner-only delete RPC gets the Show
  -- lock. Only explicit keys already persisted in generation JSON are returned.
  select coalesce(
           jsonb_agg(distinct exact.path)
             filter (where nullif(btrim(exact.path), '') is not null),
           '[]'::jsonb
         )
    into generation_storage_paths
    from (
      select g.storage_path as path
        from public.turn_generations g
       where g.project_id = any(cleanup_project_ids)
      union all
      select ref ->> 'storage_path'
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.refs) = 'array' then g.refs else '[]'::jsonb end
        ) as refs(ref)
       where g.project_id = any(cleanup_project_ids)
      union all
      select history ->> 'storage_path'
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.history) = 'array' then g.history else '[]'::jsonb end
        ) as versions(history)
       where g.project_id = any(cleanup_project_ids)
      union all
      select ref ->> 'storage_path'
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.history) = 'array' then g.history else '[]'::jsonb end
        ) as versions(history)
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(history -> 'refs') = 'array' then history -> 'refs' else '[]'::jsonb end
        ) as refs(ref)
       where g.project_id = any(cleanup_project_ids)
      union all
      select pending.path
        from public.turn_generations g
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(g.meta -> 'cleanupPending') = 'array'
            then g.meta -> 'cleanupPending' else '[]'::jsonb end
        ) as pending(path)
       where g.project_id = any(cleanup_project_ids)
      union all
      select pending.path
        from public.turn_generations g
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(g.history) = 'array' then g.history else '[]'::jsonb end
        ) as versions(history)
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(history -> 'meta' -> 'cleanupPending') = 'array'
            then history -> 'meta' -> 'cleanupPending' else '[]'::jsonb end
        ) as pending(path)
       where g.project_id = any(cleanup_project_ids)
    ) exact;

  -- turn_cameos is an optional installation and remains capture-owner-private.
  -- The Show owner nevertheless needs its exact object keys before the cascade
  -- deletes those rows. Dynamic SQL keeps this migration valid when the optional
  -- table has never been installed; no cameo metadata leaves this owner-only RPC.
  if to_regclass('public.turn_cameos') is not null then
    execute $cameos$
      select coalesce(
        jsonb_agg(distinct angle ->> 'storage_path')
          filter (where nullif(btrim(angle ->> 'storage_path'), '') is not null),
        '[]'::jsonb
      )
        from public.turn_cameos c
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(c.angles) = 'array' then c.angles else '[]'::jsonb end
        ) as item(angle)
       where c.project_id = any($1)
    $cameos$ into cameo_storage_paths using cleanup_project_ids;
  end if;

  select coalesce(jsonb_agg(distinct candidate.path order by candidate.path), '[]'::jsonb)
    into authorized_cleanup_paths
    from jsonb_array_elements_text(generation_storage_paths || cameo_storage_paths)
      as candidate(path)
   where nullif(btrim(candidate.path), '') is not null
     and public.turn_storage_project_id(candidate.path) = any(cleanup_project_ids);

  -- These exact-key grants and project deletion commit or roll back together.
  -- They expire even if the browser disappears before acknowledging cleanup.
  delete from public.turn_asset_cleanup_grants
   where expires_at <= statement_timestamp();
  insert into public.turn_asset_cleanup_grants(path, project_id, owner, created_at, expires_at)
  select exact.path,
         public.turn_storage_project_id(exact.path),
         caller,
         statement_timestamp(),
         cleanup_expires_at
    from jsonb_array_elements_text(authorized_cleanup_paths) exact(path)
  on conflict (path) do update
    set project_id = excluded.project_id,
        owner = excluded.owner,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at;

  perform public.turn_queue_project_asset_uploads(cleanup_project_ids);

  perform set_config('turn.series_delete_scope', show_row.id::text, true);
  delete from public.turn_projects p
   where p.id = any(episode_ids);
  delete from public.turn_projects p
   where p.id = show_row.id;

  return jsonb_build_object(
    'show_id', p_show_id::text,
    'episode_count', episode_count,
    'deleted_project_ids', to_jsonb(cleanup_project_ids),
    'generation_storage_paths', generation_storage_paths,
    'cameo_storage_paths', cameo_storage_paths,
    'authorized_cleanup_paths', authorized_cleanup_paths,
    'cleanup_expires_at', cleanup_expires_at
  );
end;
$$;

-- Called only after all exact object keys were removed successfully. If this
-- acknowledgement is lost, the one-hour expiry still closes the permission.
drop function if exists public.turn_finish_asset_cleanup(uuid[]);
create function public.turn_finish_asset_cleanup(p_project_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  removed integer := 0;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'TURN_SERIES: sign in before finishing asset cleanup';
  end if;
  if p_project_ids is null or cardinality(p_project_ids) = 0 then return 0; end if;

  delete from public.turn_asset_cleanup_grants g
   where g.owner = caller
     and g.project_id = any(p_project_ids);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.turn_convert_project_to_show(uuid, text, jsonb, text) from public;
revoke all on function public.turn_create_show_episode(uuid, jsonb, uuid) from public;
revoke all on function public.turn_delete_show_episode(uuid) from public;
revoke all on function public.turn_delete_show(uuid) from public;
revoke all on function public.turn_finish_asset_cleanup(uuid[]) from public;
grant execute on function public.turn_convert_project_to_show(uuid, text, jsonb, text) to authenticated;
grant execute on function public.turn_create_show_episode(uuid, jsonb, uuid) to authenticated;
grant execute on function public.turn_delete_show_episode(uuid) to authenticated;
grant execute on function public.turn_delete_show(uuid) to authenticated;
grant execute on function public.turn_finish_asset_cleanup(uuid[]) to authenticated;

commit;
