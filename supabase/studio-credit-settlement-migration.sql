-- Blender Studio atomic settlement. Apply only after review.
-- Additive by design: one new function only. It reuses turn_spend_events and
-- does not alter legacy turn_spend_credit, tables, policies, grants, or data.

create or replace function public.turn_studio_settle_credit(
  launcher_uid uuid, credit_cost integer, studio_event_id text)
returns table (remaining integer, plan text, duplicate boolean, ready boolean)
language plpgsql security definer set search_path = '' as $$
declare
  requested_cost integer;
  event_clean text;
  receipt public.turn_spend_events%rowtype;
  balance public.turn_credits%rowtype;
begin
  -- Only the relay edge function holds the service-role key. It derives uid
  -- from authenticated relay context; browsers never receive the random id.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'STUDIO_SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;

  -- Exact all-NULL invocation is the intentionally non-spending availability
  -- probe. Any mixed NULL invocation is invalid, never a partial settlement.
  if launcher_uid is null and credit_cost is null and studio_event_id is null then
    return query select null::integer, null::text, false, true;
    return;
  end if;
  if launcher_uid is null or credit_cost is null or studio_event_id is null
     or credit_cost <= 0 then
    raise exception 'INVALID_STUDIO_SETTLEMENT';
  end if;
  requested_cost := credit_cost;
  event_clean := trim(studio_event_id);
  if event_clean !~ '^studio-[A-Za-z0-9][A-Za-z0-9:_-]{1,240}$' then
    raise exception 'INVALID_STUDIO_SETTLEMENT';
  end if;

  -- Serialize this account before inspecting the receipt. A concurrent replay
  -- must see the winner's receipt even if that winner used the last credits.
  -- Studio neither creates a credit row nor grants starter credits.
  select * into balance from public.turn_credits
    where owner = launcher_uid for update;
  if not found then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  -- Private UUID-backed ids make legacy user-callable event pre-seeding
  -- infeasible, while owner/cost equality still protects a replay/collision.
  select * into receipt from public.turn_spend_events
    where event_id = event_clean for update;
  if found then
    if receipt.owner <> launcher_uid or receipt.cost <> requested_cost then
      raise exception 'STUDIO_EVENT_CONFLICT' using errcode = '23505';
    end if;
    return query select c.remaining, c.plan, true, true
      from public.turn_credits c where c.owner = launcher_uid;
    return;
  end if;

  if balance.remaining < requested_cost then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  begin
    insert into public.turn_spend_events(event_id, owner, cost)
      values (event_clean, launcher_uid, requested_cost);
  exception when unique_violation then
    select * into receipt from public.turn_spend_events
      where event_id = event_clean for update;
    if receipt.owner <> launcher_uid or receipt.cost <> requested_cost then
      raise exception 'STUDIO_EVENT_CONFLICT' using errcode = '23505';
    end if;
    return query select c.remaining, c.plan, true, true
      from public.turn_credits c where c.owner = launcher_uid;
    return;
  end;

  update public.turn_credits as c
    set remaining = c.remaining - requested_cost, updated_at = now()
    where owner = launcher_uid;
  return query select c.remaining, c.plan, false, true
    from public.turn_credits c where c.owner = launcher_uid;
end $$;

revoke all on function public.turn_studio_settle_credit(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.turn_studio_settle_credit(uuid, integer, text) to service_role;