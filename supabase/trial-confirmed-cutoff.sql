-- ============================================================================
-- The free trial only for accounts created after email confirmation was switched on
-- (owner 2026-10-03). Before 2026-10-02 ~17:45 UTC Supabase confirmed every address the moment it
-- signed up (mailer_autoconfirm), so those accounts' "confirmed" proves nothing — none of them gets
-- the 50-credit trial. Accounts created after the cutoff still need a confirmed email, as before.
--
-- Same function as in billing-v2.sql / credits.sql (kept identical); safe to re-run.
-- Run in the Supabase SQL Editor (or the Management API) after billing-v2.sql.
-- ============================================================================

create or replace function public.turn__maybe_trial(p_uid uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_amount    integer := public.turn__trial_amount();
  v_row       public.turn_credits;
  v_email     text;
  v_confirmed timestamptz;
  v_created   timestamptz;
  v_key       text;
begin
  if v_amount <= 0 then return false; end if;
  select * into v_row from public.turn_credits c where c.owner = p_uid;
  if not found or v_row.trial_granted_at is not null or v_row.paid_since is not null
     or v_row.stripe_customer_id is not null or public.turn__paid_tier(v_row.plan) then
    return false;
  end if;
  select u.email, u.email_confirmed_at, u.created_at into v_email, v_confirmed, v_created from auth.users u where u.id = p_uid;
  if v_confirmed is null then return false; end if;
  -- (owner 2026-10-03) only accounts created after email confirmation was switched on
  -- (2026-10-02, about 17:45 UTC): before it every address counted as confirmed the moment it
  -- signed up, so an older account's "confirmed" proves nothing
  if v_created < timestamptz '2026-10-02 18:00:00+00' then return false; end if;
  v_key := public.turn__email_key(v_email);
  if v_key is not null and exists (select 1 from public.turn_credits c
                                    where c.trial_email_key = v_key and c.owner <> p_uid) then
    return false;
  end if;
  begin
    update public.turn_credits c
       set plan_remaining = c.plan_remaining + v_amount,
           plan_allowance = v_amount,
           trial_granted_at = pg_catalog.now(),
           trial_email_key = v_key,
           ledger_sync = true
     where c.owner = p_uid;
  exception when unique_violation then
    return false;   -- another account on the same mailbox got it at this very moment
  end;
  insert into public.turn_plan_grants(owner, kind, tier, amount, period_start)
    values (p_uid, 'trial', 'none', v_amount, v_row.plan_period_start);
  return true;
end $$;
