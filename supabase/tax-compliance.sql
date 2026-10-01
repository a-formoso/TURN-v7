-- ============================================================================
-- Kinolot — tax & compliance records (supabase/tax-compliance.sql)
-- Owner decisions 2026-10-01 ("decide for me", "warn me via the Admin panel when
-- I have to register for VAT", "keep the prices in dollars"). Written 2026-10-01.
-- NOT run on production yet.
--
-- WHAT IT ADDS
--   turn_sales_ledger        one row per successful payment on the Stripe account
--                            (ALL products: Kinolot and the other products sold on
--                            the same account count toward the same business's VAT
--                            turnover, so each row says its app: 'kinolot' or
--                            'other'), and one NEGATIVE row per refund. Written only
--                            by the stripe-webhook (service role) through
--                            turn_record_sale_once, once per source key
--                            ('invoice:<id>', 'checkout:<id>', 'refund:<id>').
--                            Country = the customer's billing country (ISO-3166
--                            alpha-2), region = the US state; country_source says
--                            where the webhook found it. No names, emails or card
--                            details. Kept as long as tax law requires (in the UK
--                            generally six years), so it is NOT tied to the account
--                            (deleting an account leaves its sales rows).
--   turn_checkout_consents   the "Start now" consent a signed-in user gives before
--                            each checkout (the 14-day right to cancel: they ask for
--                            the service to start at once and get back only the part
--                            not used if they cancel within 14 days). Written by the
--                            app through turn_record_checkout_consent; the Stripe
--                            payment link's terms acceptance is the second record.
--   turn_admin_tax_summary   the Admin panel's "Tax & compliance" figures: UK sales
--                            for the last 12 months in GBP against the UK VAT
--                            registration threshold, EU sales (a UK business owes EU
--                            VAT from the first sale to an EU consumer), US sales per
--                            state against a conservative economic-nexus test, and
--                            payments with no country. Admin only.
--   turn_dispute_hold        (D4) the stripe-webhook's ONE call that adds or removes a
--                            dispute's part of an account hold under the account lock,
--                            so disputes handled at the same moment never lose each
--                            other's part (service role only).
--   The thresholds live in ONE place: turn__tax_thresholds() below, with the date
--   they were last checked. They are rules of thumb for a warning, not tax advice:
--   check with an accountant.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste this WHOLE file -> Run,
--   as postgres, AFTER supabase/billing-v2.sql. On production, run billing-v2.sql
--   once more first (safe to re-run; it adds the partial-refund argument the
--   webhook now passes): this file's RESULT says FAIL until it has. One
--   transaction: a failed run changes nothing. Safe to re-run: tables are created
--   only when missing, functions and grants are put back exactly as below, data is
--   never touched. The editor then shows the RESULT table: every row must read 'ok'.
--   Fresh installs get the same definitions from supabase/credits.sql (the block
--   between the KINOLOT TAX COMPLIANCE markers is byte-identical in both files;
--   scripts/test-tax-compliance-db.mjs checks).
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
    raise exception 'Kinolot tax records: missing roles % (run this on the Supabase database). Nothing was changed.', missing;
  end if;
  if to_regclass('auth.users') is null or to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null then
    raise exception 'Kinolot tax records: Supabase Auth (auth.users, auth.uid(), auth.jwt()) is missing. Nothing was changed.';
  end if;
  if to_regprocedure('public.turn__service_only(text)') is null or to_regclass('public.turn_billing_state') is null then
    raise exception 'Kinolot tax records: run supabase/billing-v2.sql first (turn__service_only or turn_billing_state is missing). Nothing was changed.';
  end if;
end;
$preflight$;

-- >>> KINOLOT TAX COMPLIANCE DEFINITIONS >>>
-- This block is byte-identical in supabase/credits.sql and supabase/tax-compliance.sql
-- (scripts/test-tax-compliance-db.mjs fails if they drift). Every statement is safe to re-run.
-- It needs the billing v2 helpers (turn__service_only), defined above it in credits.sql.

-- ── 1. tables ───────────────────────────────────────────────────────────────
-- no foreign key to auth.users on purpose: sales and consent records outlive a
-- deleted account (tax and legal records), and the other products' buyers have no
-- Kinolot account at all
create table if not exists public.turn_sales_ledger (
  id             bigserial primary key,
  source_key     text not null unique check (length(source_key) between 1 and 200),
  app            text not null check (app ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  owner          uuid,
  kind           text not null check (kind in ('plan', 'pack', 'other', 'refund')),
  amount_cents   bigint not null,
  currency       text not null check (currency ~ '^[a-z]{3}$'),
  country        text check (country ~ '^[A-Z]{2}$'),
  region         text check (length(region) between 1 and 64),
  country_source text check (length(country_source) between 1 and 64),
  occurred_at    timestamptz not null,
  stripe_ids     jsonb not null default '{}'::jsonb,
  recorded_at    timestamptz not null default now(),
  -- refunds are negative, everything else zero or more
  constraint turn_sales_ledger_sign_check check (case when kind = 'refund' then amount_cents <= 0 else amount_cents >= 0 end)
);
alter table public.turn_sales_ledger enable row level security;
create index if not exists turn_sales_ledger_occurred_idx on public.turn_sales_ledger(occurred_at);
create index if not exists turn_sales_ledger_country_idx on public.turn_sales_ledger(country, occurred_at);
comment on table public.turn_sales_ledger is
  'Kinolot: every successful payment (and refund, negative) on the Stripe account, all products, for the tax thresholds (turn_admin_tax_summary). Written by stripe-webhook via turn_record_sale_once. Keep for as long as tax law requires (UK: generally six years).';

create table if not exists public.turn_checkout_consents (
  id              bigserial primary key,
  owner           uuid not null,
  sku             text not null check (length(sku) between 1 and 120),
  consent_version text not null check (length(consent_version) between 1 and 80),
  created_at      timestamptz not null default now()
);
alter table public.turn_checkout_consents enable row level security;
create index if not exists turn_checkout_consents_owner_idx on public.turn_checkout_consents(owner, created_at desc);
comment on table public.turn_checkout_consents is
  'Kinolot: the "Start now" consent before a checkout (14-day right to cancel: the unused part only). Written by turn_record_checkout_consent.';

-- ── 2. helpers (no API role; they run inside the functions below) ───────────
-- THE thresholds, in one place. Last checked 2026-10-01 (when updating, re-check GOV.UK,
-- the EU's OSS guidance and each US state's revenue site, then set 'checked'):
--   UK  VAT registration: GBP 90,000 of UK taxable turnover in any rolling 12 months
--       (since 1 April 2024), or expected in the next 30 days alone. Digital services
--       sold to consumers outside the UK are generally outside the scope of UK VAT,
--       so only UK customers count here (the Isle of Man is in the UK VAT area).
--   EU  a business established outside the EU owes EU VAT on digital services to EU
--       consumers from the FIRST sale (no threshold): register for the non-Union OSS
--       scheme in one EU country before the first EU sale.
--   US  economic nexus differs by state: commonly USD 100,000 of sales or 200
--       transactions a year; some states are higher, some count sales only, and some
--       don't tax digital services at all. The figures below are the conservative
--       common test.
-- Warnings: UK at 75 % (watch), 90 % (near), 100 % (over); US at 80 % (near), 100 %.
create or replace function public.turn__tax_thresholds()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'uk_gbp', 90000, 'uk_watch_pct', 75, 'uk_near_pct', 90,
    'us_usd', 100000, 'us_tx', 200, 'us_near_pct', 80,
    'checked', '2026-10-01')
$$;

-- the 27 EU member states as Stripe writes them (Greece is GR); Monaco is in the
-- French VAT area
create or replace function public.turn__tax_is_eu(p_country text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(p_country, '') in ('AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
                                     'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'MC')
$$;

-- the UK VAT area: Great Britain and Northern Ireland (GB) and the Isle of Man (IM)
create or replace function public.turn__tax_is_uk(p_country text)
returns boolean
language sql immutable
set search_path = ''
as $$ select coalesce(p_country, '') in ('GB', 'IM') $$;

-- the admin: the same account admin-storage, image-proxy and the app treat as admin
-- (the signed-in JWT's email; Supabase Auth's "Confirm email" and "Secure email
-- change" must stay on, as for every email-based admin gate). No JWT at all = a
-- direct database session (the SQL editor), which may read its own database.
create or replace function public.turn__tax_is_admin()
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v_claims text := nullif(pg_catalog.current_setting('request.jwt.claims', true), '');
  v_role   text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_jwt    jsonb;
begin
  if v_claims is null and v_role is null
     and nullif(pg_catalog.current_setting('request.jwt.claim.email', true), '') is null then
    return true;
  end if;
  v_jwt := auth.jwt();
  return lower(coalesce(v_jwt ->> 'email', '')) = 'admin@infinitestudioai.com'
         and coalesce(v_role, v_jwt ->> 'role', '') = 'authenticated';
end $$;

-- the ledger rows of the window (occurred after p_from), each with its value in USD
-- and in GBP at p_rate (GBP per USD); other currencies have no USD / GBP value
-- (null: left out of every sum) and keep their amount in Stripe's smallest unit
create or replace function public.turn__tax_window(p_from timestamptz, p_rate numeric)
returns table (country text, region text, app text, currency text, occurred_at timestamptz,
               is_sale boolean, usd numeric, gbp numeric, minor bigint)
language sql stable
set search_path = ''
as $$
  select s.country, s.region, s.app, s.currency, s.occurred_at,
         s.kind <> 'refund' and s.amount_cents > 0,
         case s.currency when 'usd' then s.amount_cents / 100.0 when 'gbp' then s.amount_cents / 100.0 / p_rate end,
         case s.currency when 'usd' then s.amount_cents / 100.0 * p_rate when 'gbp' then s.amount_cents / 100.0 end,
         s.amount_cents
    from public.turn_sales_ledger s
   where s.occurred_at > p_from
$$;

-- ── 3. the server's function: record one payment or refund, once ───────────
-- turn_record_sale_once(source_key, app, owner, kind, amount_cents, currency,
--   country, region, country_source, occurred_at, stripe_ids) -> true when this call
-- recorded it, false when that source key was already recorded (nothing changes).
-- Normalised: currency lower-case, country upper-case (anything that isn't two
-- letters is stored as no country, its raw value kept in stripe_ids.country_raw),
-- region upper-case, a refund's amount always negative; a negative amount for
-- anything else, an unknown kind or a missing key / app / currency is refused (22023).
create or replace function public.turn_record_sale_once(source_key text, app text, owner uuid, kind text,
                                                        amount_cents bigint, currency text, country text,
                                                        region text, country_source text,
                                                        occurred_at timestamptz, stripe_ids jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_key     text := nullif(trim(coalesce(turn_record_sale_once.source_key, '')), '');
  v_app     text := lower(trim(coalesce(turn_record_sale_once.app, '')));
  v_kind    text := lower(trim(coalesce(turn_record_sale_once.kind, '')));
  v_amount  bigint := turn_record_sale_once.amount_cents;
  v_cur     text := lower(trim(coalesce(turn_record_sale_once.currency, '')));
  v_country text := upper(trim(coalesce(turn_record_sale_once.country, '')));
  v_region  text := nullif(left(upper(trim(coalesce(turn_record_sale_once.region, ''))), 64), '');
  v_source  text := nullif(left(trim(coalesce(turn_record_sale_once.country_source, '')), 64), '');
  v_ids     jsonb := turn_record_sale_once.stripe_ids;
  v_n       integer;
begin
  perform public.turn__service_only('turn_record_sale_once');
  if v_key is null or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'KINOLOT_TAX: turn_record_sale_once needs a source_key (1 to 200 characters)';
  end if;
  if v_app !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then
    raise exception using errcode = '22023', message = 'KINOLOT_TAX: app must be a short name such as kinolot or other';
  end if;
  if v_kind not in ('plan', 'pack', 'other', 'refund') then
    raise exception using errcode = '22023', message = 'KINOLOT_TAX: kind must be plan, pack, other or refund';
  end if;
  if v_amount is null then
    raise exception using errcode = '22023', message = 'KINOLOT_TAX: amount_cents is required';
  end if;
  if v_kind = 'refund' then
    v_amount := -abs(v_amount);
  elsif v_amount < 0 then
    raise exception using errcode = '22023', message = 'KINOLOT_TAX: only a refund has a negative amount';
  end if;
  if v_cur !~ '^[a-z]{3}$' then
    raise exception using errcode = '22023', message = 'KINOLOT_TAX: currency must be a three-letter code';
  end if;
  v_ids := case when v_ids is null or jsonb_typeof(v_ids) = 'null' then '{}'::jsonb
                when jsonb_typeof(v_ids) = 'object' then v_ids
                else jsonb_build_object('value', v_ids) end;
  if v_country = '' then
    v_country := null;
  elsif v_country !~ '^[A-Z]{2}$' then
    v_ids := v_ids || jsonb_build_object('country_raw', left(turn_record_sale_once.country, 64));
    v_country := null;
  end if;
  insert into public.turn_sales_ledger(source_key, app, owner, kind, amount_cents, currency, country, region,
                                       country_source, occurred_at, stripe_ids)
    values (v_key, v_app, turn_record_sale_once.owner, v_kind, v_amount, v_cur, v_country, v_region,
            v_source, coalesce(turn_record_sale_once.occurred_at, pg_catalog.now()), v_ids)
    on conflict (source_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- ── 4. the app's function: record the "Start now" consent before a checkout ──
-- turn_record_checkout_consent(sku, consent_version): the signed-in caller only
-- (owner = auth.uid(); the anon key is refused). sku names what is being bought
-- (the app sends 'plan-writer', 'plan-director', 'plan-studio', 'pack-250',
-- 'pack-1000', 'pack-3000'; 'credits-300' / 'credits-1200' / 'credits-4000' for the old
-- packs), consent_version the exact wording shown. More
-- than 200 in a day from one account are not stored (nobody checks out that often;
-- the payment link's terms acceptance still records every real checkout).
create or replace function public.turn_record_checkout_consent(sku text, consent_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid     uuid := auth.uid();
  v_sku     text := trim(coalesce(turn_record_checkout_consent.sku, ''));
  v_version text := trim(coalesce(turn_record_checkout_consent.consent_version, ''));
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'KINOLOT_CONSENT: sign in first';
  end if;
  if length(v_sku) not between 1 and 120 or v_sku ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'KINOLOT_CONSENT: sku must be 1 to 120 printable characters';
  end if;
  if length(v_version) not between 1 and 80 or v_version ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'KINOLOT_CONSENT: consent_version must be 1 to 80 printable characters';
  end if;
  if (select count(*) from public.turn_checkout_consents c
       where c.owner = v_uid and c.created_at > pg_catalog.now() - interval '1 day') >= 200 then
    return;
  end if;
  insert into public.turn_checkout_consents(owner, sku, consent_version) values (v_uid, v_sku, v_version);
end $$;

-- ── 4b. the server's function: one dispute's account hold (D4) ──────────────
-- turn_dispute_hold(uid, dispute_id, open, part default null) -> jsonb
-- {action, frozen, frozen_reason}. The account's frozen_reason lists every hold,
-- separated by ' | ' ; a dispute's part names it ('dispute <id> ...'). The read and
-- the write happen under the account lock (turn__lock), in ONE call: Stripe delivers
-- events in parallel, and two disputes handled at the same moment must never lose
-- one another's part (the hold would then lift while a dispute is still open).
--   open = true   adds this dispute's part (once: a resend changes nothing) next to
--                 any hold already there ('earlier hold (no reason given)' for a hold
--                 without a reason) -> action 'frozen'
--   open = false  removes this dispute's part: nothing left -> the account is
--                 unfrozen, frozen_reason = part (e.g. 'dispute dp_1 won') -> 'lifted';
--                 other holds left -> stays frozen with just those -> 'kept'; held, but
--                 not by this dispute -> nothing changes -> 'review'; not held ->
--                 'lifted' (nothing to lift).
-- A dispute id is Stripe's (letters, digits, underscores); anything else is refused
-- (22023). An unknown account is refused like every billing write (23503).
create or replace function public.turn_dispute_hold(uid uuid, dispute_id text, open boolean, part text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid   uuid := turn_dispute_hold.uid;
  v_id    text := trim(coalesce(turn_dispute_hold.dispute_id, ''));
  v_part  text := nullif(left(trim(coalesce(turn_dispute_hold.part, '')), 300), '');
  v_row   public.turn_credits;
  v_old   text;
  v_re    text;
  v_parts text[];
  v_rest  text[];
  v_new   text;
begin
  perform public.turn__service_only('turn_dispute_hold');
  if v_uid is null or turn_dispute_hold.open is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_dispute_hold needs uid and open';
  end if;
  if v_id !~ '^[A-Za-z0-9_]{1,100}$' then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_dispute_hold needs a Stripe dispute id';
  end if;
  -- the separator stays unambiguous inside a part
  v_part := replace(coalesce(v_part, 'dispute ' || v_id), ' | ', ' / ');
  v_re := '(^|[^A-Za-z0-9_])dispute ' || v_id || '([^A-Za-z0-9_]|$)';
  v_row := public.turn__lock(v_uid);
  v_old := case when v_row.frozen then nullif(trim(coalesce(v_row.frozen_reason, '')), '') end;
  if turn_dispute_hold.open then
    if not coalesce(v_row.frozen, false) then
      v_new := v_part;
    elsif v_old ~ v_re then
      v_new := v_old;
    else
      v_new := coalesce(v_old, 'earlier hold (no reason given)') || ' | ' || v_part;
    end if;
    update public.turn_credits c
       set frozen = true, frozen_reason = v_new,
           frozen_at = case when c.frozen then coalesce(c.frozen_at, pg_catalog.now()) else pg_catalog.now() end
     where c.owner = v_uid;
    return jsonb_build_object('action', 'frozen', 'frozen', true, 'frozen_reason', v_new);
  end if;
  if not coalesce(v_row.frozen, false) then
    update public.turn_credits c set frozen = false, frozen_reason = v_part, frozen_at = null where c.owner = v_uid;
    return jsonb_build_object('action', 'lifted', 'frozen', false, 'frozen_reason', v_part);
  end if;
  select coalesce(array_agg(p order by o), array[]::text[]) into v_parts
    from (select trim(x) as p, o from unnest(string_to_array(coalesce(v_old, ''), ' | ')) with ordinality as t(x, o)) s
   where s.p <> '';
  select coalesce(array_agg(p order by o), array[]::text[]) into v_rest
    from unnest(v_parts) with ordinality as t(p, o)
   where t.p !~ v_re;
  if cardinality(v_parts) > 0 and cardinality(v_rest) = 0 then
    update public.turn_credits c set frozen = false, frozen_reason = v_part, frozen_at = null where c.owner = v_uid;
    return jsonb_build_object('action', 'lifted', 'frozen', false, 'frozen_reason', v_part);
  end if;
  if cardinality(v_rest) = cardinality(v_parts) then
    return jsonb_build_object('action', 'review', 'frozen', true, 'frozen_reason', v_old);
  end if;
  v_new := array_to_string(v_rest, ' | ');
  update public.turn_credits c set frozen_reason = v_new where c.owner = v_uid;
  return jsonb_build_object('action', 'kept', 'frozen', true, 'frozen_reason', v_new);
end $$;

-- ── 5. the Admin panel's figures ────────────────────────────────────────────
-- turn_admin_tax_summary(usd_to_gbp default 0.80): the admin only (or the SQL
-- editor). usd_to_gbp = GBP per USD, a CONSERVATIVE (high) rate the admin can change
-- in the panel, so the UK figure errs on the early side. The window is the last 12
-- months up to now (rolling); refunds net off the amounts; "sales" counts payments
-- above zero (refunds never add a transaction). Amounts in USD and GBP are converted
-- with the rate; payments in any other currency are listed under other_currencies
-- (in Stripe's smallest unit) and left out of the totals. Only totals: no account
-- ids, names or emails.
--   {as_of, usd_to_gbp, thresholds, window_from,
--    uk: {usd_12m, gbp_12m_est, pct, status ok|watch|near|over, sales_12m, gbp_30d_est,
--         unknown_gbp_est, pct_with_unknown},
--    eu: {sales_12m, usd_12m, first_sale_at (the first EU sale ever), status watch|over,
--         by_country: [{country, sales, usd}]},
--    us: {sales_12m, usd_12m, by_state: [{state, sales, usd, pct_usd, pct_tx, status ok|near|over}]},
--    rest: {sales_12m, usd_12m, by_country: [{country, sales, usd}]},   (every other country)
--    unknown: {sales, usd}, by_app: [{app, usd_12m}],
--    other_currencies: [{currency, sales, amount_minor}],
--    ledger: {rows, first_sale_at, recording_since}}
create or replace function public.turn_admin_tax_summary(usd_to_gbp numeric default 0.80)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_rate  numeric := coalesce(turn_admin_tax_summary.usd_to_gbp, 0.80);
  v_t     jsonb := public.turn__tax_thresholds();
  v_now   timestamptz := pg_catalog.now();
  v_from  timestamptz := pg_catalog.now() - interval '12 months';
  v_uk    jsonb;
  v_eu    jsonb;
  v_us    jsonb;
  v_rest  jsonb;
  v_unk   jsonb;
  v_apps  jsonb;
  v_other jsonb;
  v_led   jsonb;
  v_ukgbp numeric;
  v_unkgbp numeric;
  v_pct   numeric;
  v_pctu  numeric;
begin
  if not public.turn__tax_is_admin() then
    raise exception using errcode = '42501', message = 'KINOLOT_TAX: the tax summary is for the admin only';
  end if;
  if v_rate = 'NaN'::numeric or v_rate <= 0 or v_rate > 10 then
    raise exception using errcode = '22023', message = 'KINOLOT_TAX: usd_to_gbp must be above 0 and at most 10 (GBP per USD)';
  end if;


  -- UK (GB + IM) against the VAT registration threshold, in GBP
  select coalesce(sum(w.gbp), 0) into v_ukgbp from public.turn__tax_window(v_from, v_rate) w where public.turn__tax_is_uk(w.country);
  select coalesce(sum(w.gbp), 0) into v_unkgbp from public.turn__tax_window(v_from, v_rate) w where w.country is null;
  v_pct := round(v_ukgbp / (v_t ->> 'uk_gbp')::numeric * 100, 1);
  v_pctu := round((v_ukgbp + greatest(v_unkgbp, 0)) / (v_t ->> 'uk_gbp')::numeric * 100, 1);
  select jsonb_build_object(
           'usd_12m', round(coalesce(sum(w.usd), 0), 2),
           'gbp_12m_est', round(v_ukgbp, 2),
           'pct', v_pct,
           'status', case when v_pct >= 100 then 'over'
                          when v_pct >= (v_t ->> 'uk_near_pct')::numeric then 'near'
                          when v_pct >= (v_t ->> 'uk_watch_pct')::numeric then 'watch'
                          else 'ok' end,
           'sales_12m', count(*) filter (where w.is_sale),
           'gbp_30d_est', round(coalesce(sum(w.gbp) filter (where w.occurred_at > v_now - interval '30 days'), 0), 2),
           'unknown_gbp_est', round(v_unkgbp, 2),
           'pct_with_unknown', v_pctu)
    into v_uk
    from public.turn__tax_window(v_from, v_rate) w where public.turn__tax_is_uk(w.country);

  -- EU: VAT from the first sale (non-Union OSS)
  select jsonb_build_object(
           'sales_12m', count(*) filter (where w.is_sale),
           'usd_12m', round(coalesce(sum(w.usd), 0), 2),
           'first_sale_at', (select min(s.occurred_at) from public.turn_sales_ledger s
                              where public.turn__tax_is_eu(s.country) and s.kind <> 'refund' and s.amount_cents > 0),
           'status', case when exists (select 1 from public.turn_sales_ledger s
                                        where public.turn__tax_is_eu(s.country) and s.kind <> 'refund' and s.amount_cents > 0)
                          then 'over' else 'watch' end,
           'by_country', coalesce((select jsonb_agg(jsonb_build_object('country', x.country, 'sales', x.sales, 'usd', x.usd)
                                                    order by x.usd desc, x.country)
                                     from (select w2.country, count(*) filter (where w2.is_sale) as sales,
                                                  round(coalesce(sum(w2.usd), 0), 2) as usd
                                             from public.turn__tax_window(v_from, v_rate) w2 where public.turn__tax_is_eu(w2.country)
                                            group by w2.country) x), '[]'::jsonb))
    into v_eu
    from public.turn__tax_window(v_from, v_rate) w where public.turn__tax_is_eu(w.country);

  -- US: per state against the conservative economic-nexus test
  select jsonb_build_object(
           'sales_12m', count(*) filter (where w.is_sale),
           'usd_12m', round(coalesce(sum(w.usd), 0), 2),
           'by_state', coalesce((select jsonb_agg(jsonb_build_object('state', x.state, 'sales', x.sales, 'usd', x.usd,
                                                                     'pct_usd', x.pct_usd, 'pct_tx', x.pct_tx,
                                                                     'status', case when greatest(x.pct_usd, x.pct_tx) >= 100 then 'over'
                                                                                    when greatest(x.pct_usd, x.pct_tx) >= (v_t ->> 'us_near_pct')::numeric then 'near'
                                                                                    else 'ok' end)
                                                  order by greatest(x.pct_usd, x.pct_tx) desc, x.state nulls last)
                                   from (select y.state, y.sales, y.usd,
                                                round(y.usd / (v_t ->> 'us_usd')::numeric * 100, 1) as pct_usd,
                                                round(y.sales / (v_t ->> 'us_tx')::numeric * 100, 1) as pct_tx
                                           from (select w2.region as state, count(*) filter (where w2.is_sale) as sales,
                                                        round(coalesce(sum(w2.usd), 0), 2) as usd
                                                   from public.turn__tax_window(v_from, v_rate) w2 where w2.country = 'US'
                                                  group by w2.region) y) x), '[]'::jsonb))
    into v_us
    from public.turn__tax_window(v_from, v_rate) w where w.country = 'US';

  -- every other known country (other countries have their own rules for foreign sellers)
  select jsonb_build_object(
           'sales_12m', count(*) filter (where w.is_sale),
           'usd_12m', round(coalesce(sum(w.usd), 0), 2),
           'by_country', coalesce((select jsonb_agg(jsonb_build_object('country', x.country, 'sales', x.sales, 'usd', x.usd)
                                                    order by x.usd desc, x.country)
                                     from (select w2.country, count(*) filter (where w2.is_sale) as sales,
                                                  round(coalesce(sum(w2.usd), 0), 2) as usd
                                             from public.turn__tax_window(v_from, v_rate) w2
                                            where w2.country is not null and w2.country <> 'US'
                                              and not public.turn__tax_is_uk(w2.country) and not public.turn__tax_is_eu(w2.country)
                                            group by w2.country) x), '[]'::jsonb))
    into v_rest
    from public.turn__tax_window(v_from, v_rate) w
   where w.country is not null and w.country <> 'US' and not public.turn__tax_is_uk(w.country) and not public.turn__tax_is_eu(w.country);

  -- no country: turn on billing-address collection
  select jsonb_build_object('sales', count(*) filter (where w.is_sale), 'usd', round(coalesce(sum(w.usd), 0), 2))
    into v_unk
    from public.turn__tax_window(v_from, v_rate) w where w.country is null;

  select coalesce(jsonb_agg(jsonb_build_object('app', x.app, 'usd_12m', x.usd) order by x.app), '[]'::jsonb)
    into v_apps
    from (select w.app, round(coalesce(sum(w.usd), 0), 2) as usd from public.turn__tax_window(v_from, v_rate) w group by w.app) x;

  select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'sales', x.sales, 'amount_minor', x.minor)
                            order by x.currency), '[]'::jsonb)
    into v_other
    from (select w.currency, count(*) filter (where w.is_sale) as sales, sum(w.minor) as minor
            from public.turn__tax_window(v_from, v_rate) w where w.currency not in ('usd', 'gbp') group by w.currency) x;

  select jsonb_build_object('rows', count(*),
                            'first_sale_at', min(s.occurred_at),
                            'recording_since', min(s.recorded_at))
    into v_led
    from public.turn_sales_ledger s;

  return jsonb_build_object(
    'as_of', v_now,
    'usd_to_gbp', v_rate,
    'thresholds', v_t,
    'window_from', v_from,
    'uk', v_uk, 'eu', v_eu, 'us', v_us, 'rest', v_rest, 'unknown', v_unk,
    'by_app', v_apps, 'other_currencies', v_other, 'ledger', v_led);
end $$;

-- ── 6. privileges ───────────────────────────────────────────────────────────
-- Supabase grants every new table, sequence and function to anon and authenticated
-- DIRECTLY, so each API role is named.
revoke all on table public.turn_sales_ledger, public.turn_checkout_consents from public, anon, authenticated;
revoke all on sequence public.turn_sales_ledger_id_seq, public.turn_checkout_consents_id_seq from public, anon, authenticated;
revoke all on function public.turn_record_sale_once(text, text, uuid, text, bigint, text, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.turn_record_sale_once(text, text, uuid, text, bigint, text, text, text, text, timestamptz, jsonb)
  to service_role;
revoke all on function public.turn_dispute_hold(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.turn_dispute_hold(uuid, text, boolean, text) to service_role;
revoke all on function public.turn_record_checkout_consent(text, text) from public, anon;
grant execute on function public.turn_record_checkout_consent(text, text) to authenticated;
revoke all on function public.turn_admin_tax_summary(numeric) from public, anon;
grant execute on function public.turn_admin_tax_summary(numeric) to authenticated;
revoke all on function public.turn__tax_thresholds() from public, anon, authenticated, service_role;
revoke all on function public.turn__tax_is_eu(text) from public, anon, authenticated, service_role;
revoke all on function public.turn__tax_is_uk(text) from public, anon, authenticated, service_role;
revoke all on function public.turn__tax_is_admin() from public, anon, authenticated, service_role;
revoke all on function public.turn__tax_window(timestamptz, numeric) from public, anon, authenticated, service_role;

-- let the Data API see the new functions now
notify pgrst, 'reload schema';
-- <<< KINOLOT TAX COMPLIANCE DEFINITIONS <<<

commit;

-- ── RESULT — the table the SQL Editor shows after Run ───────────────────────
with fns(sig, kind) as (values
    ('public.turn_record_sale_once(text, text, uuid, text, bigint, text, text, text, text, timestamptz, jsonb)', 'service'),
    ('public.turn_dispute_hold(uuid, text, boolean, text)', 'service'),
    ('public.turn_record_checkout_consent(text, text)', 'browser'),
    ('public.turn_admin_tax_summary(numeric)', 'browser'),
    ('public.turn__tax_thresholds()', 'internal'),
    ('public.turn__tax_is_eu(text)', 'internal'),
    ('public.turn__tax_is_uk(text)', 'internal'),
    ('public.turn__tax_is_admin()', 'internal'),
    ('public.turn__tax_window(timestamptz, numeric)', 'internal')),
  priv as (
    select x.sig, x.kind, p.oid is not null as present,
           coalesce(p.prosecdef, false) as definer,
           coalesce(exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%'), false) as pinned,
           p.oid is not null and has_function_privilege('public', p.oid, 'EXECUTE') as pub,
           p.oid is not null and has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           p.oid is not null and has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
           p.oid is not null and has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
      from fns x left join pg_catalog.pg_proc p on p.oid = to_regprocedure(x.sig)),
  tabs(t) as (values ('public.turn_sales_ledger'), ('public.turn_checkout_consents')),
  led as (select count(*) as n, min(s.recorded_at) as since,
                 count(*) filter (where s.app = 'kinolot') as kinolot from public.turn_sales_ledger s)
select r.item, r.status, r.detail
  from (
    select 10 as ord, 'Sales ledger and consent tables, row-level security on' as item,
           case when (select count(*) from tabs t join pg_catalog.pg_class k on k.oid = to_regclass(t.t) where k.relrowsecurity) = 2
                then 'ok' else 'FAIL — re-run the whole file' end as status,
           'turn_sales_ledger (every payment and refund on the Stripe account), turn_checkout_consents (the "Start now" consent)' as detail
    union all
    select 20, 'Every function present',
           case when (select count(*) from priv where not present) = 0
                then 'ok' else 'FAIL — missing: ' || (select string_agg(sig, ', ') from priv where not present) end,
           'turn_record_sale_once, turn_dispute_hold, turn_record_checkout_consent, turn_admin_tax_summary and their helpers'
    union all
    select 30, 'Owner-rights functions pin search_path',
           case when (select count(*) from priv where kind <> 'internal' and (not definer or not pinned)) = 0
                 and (select count(*) from priv where kind = 'internal' and (definer or not pinned)) = 0
                then 'ok' else 'FAIL — re-run the whole file' end,
           'security definer with a pinned search_path; helpers run with the caller''s rights'
    union all
    select 40, 'Recording a sale: service role only',
           case when (select count(*) from priv where kind = 'service' and (pub or anon or authed or not svc)) = 0
                then 'ok' else 'FAIL — re-run the whole file' end,
           'turn_record_sale_once and turn_dispute_hold are called by stripe-webhook only'
    union all
    select 50, 'Consent and the tax summary: signed-in users only (never the anon key)',
           case when (select count(*) from priv where kind = 'browser' and (pub or anon or not authed)) = 0
                then 'ok' else 'FAIL — re-run the whole file' end,
           'turn_record_checkout_consent (the caller''s own consent); turn_admin_tax_summary refuses everyone but the admin inside'
    union all
    select 60, 'Helpers: no API role',
           case when (select count(*) from priv where kind = 'internal' and (pub or anon or authed or svc)) = 0
                then 'ok' else 'FAIL — re-run the whole file' end,
           'turn__tax_* are reachable only from inside the functions above'
    union all
    select 70, 'Tables: no reads or writes through the API',
           case when not exists (select 1 from tabs t, unnest(array['anon', 'authenticated']) rl
                                  where has_table_privilege(rl, to_regclass(t.t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'))
                then 'ok' else 'FAIL — re-run the whole file' end,
           'nobody reads the ledger or the consents except through the functions'
    union all
    select 80, 'Partial refunds (billing-v2.sql re-run)',
           case when to_regprocedure('public.turn_revoke_charge_once(text, text, numeric)') is not null
                 and to_regprocedure('public.turn_revoke_charge_once(text, text)') is null
                then 'ok' else 'FAIL — run supabase/billing-v2.sql again (safe), then this file again' end,
           'turn_revoke_charge_once(event_id, charge_id, refund_fraction default 1): a partial refund removes the same share of that payment''s credits'
    union all
    select 90, 'Sales recorded so far',
           'ok',
           case when (select n from led) = 0
                then 'none yet: stripe-webhook records every payment and refund once it is deployed'
                else (select n from led)::text || ' rows (' || (select kinolot from led)::text || ' Kinolot) since '
                     || to_char((select since from led), 'YYYY-MM-DD') end
    union all
    select 100, 'Tax thresholds',
           'ok',
           'UK GBP ' || to_char((public.turn__tax_thresholds() ->> 'uk_gbp')::numeric, 'FM999,999') || ' in any 12 months; EU from the first sale; US USD '
           || to_char((public.turn__tax_thresholds() ->> 'us_usd')::numeric, 'FM999,999') || ' or ' || (public.turn__tax_thresholds() ->> 'us_tx')
           || ' sales a state (conservative); last checked ' || (public.turn__tax_thresholds() ->> 'checked') || '. Check with an accountant.'
  ) r
 order by r.ord;
