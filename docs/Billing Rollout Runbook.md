# Kinolot billing fixes: owner runbook

Written 2026-09-30 for the owner, revised 2026-10-01 after five review rounds. Nothing below has been run, deployed or sent yet. The code is committed and pushed to GitHub (main), so Replit and the Mac deploys get the same code.

Each step says which machine it runs on. Do the steps in this order. Steps 1 to 5 and the notice (step 7) happen on **day 0**. Step 6 is the **switch day**, at least 30 days after the notice.

## What goes live, and when

**Day 0, steps 1 to 5:**
- **Server-side charging.** Every paid call is priced and its credits are held before it runs: writing, images, video, voice and 3D. The server keeps the real cost and refunds a failed job.
- **Edits and Motion Control hold by length.** An edit or a Motion Control render sets aside about the source video's length plus a margin (10% and one second), no longer the longest length allowed. This works wherever the video comes from: a device upload, the film's own storage, a file on the video provider's servers or one sent inline, and reference videos are counted the same way. A file the server can't read (a fragmented, damaged or compressed-header video, or one stored somewhere it doesn't fetch from) still sets aside the longest length. The charge is the finished video's real length, never more than was set aside. See the weekly check for the `length_mismatch` line.
- **Snapshots of the videos a render is billed by.** A video in the film's storage or a device upload could be swapped for a longer one after the server measured it. So the server copies it, at submit, into a folder of its own (`_internal/video-snapshots/` in the `turn-assets` bucket) that no user can change, delete or even list, measures the copy, and gives the video provider the copy. A video sent inline is saved there too; a file already on the video provider's servers can't change, so it isn't copied. If a copy fails, that video sets aside the longest length. Each copy is deleted when its render is charged or refunded; the 10-minute housekeeping also removes, as a best effort, any copy left behind for more than 2 days. Nothing to run for this.
- **Speech-to-text is charged by the recording's real length.** The server reads the length from the recording itself before it sets credits aside, so silence counts and a recording with no words is still charged. A recording it can't read, or one longer than 6 minutes, is refused, and the app quietly switches to the browser's own free speech recognition. The app itself stops a spoken answer at 5 minutes.
- **Image prompts are capped.** An image prompt longer than 40,000 characters is refused before anything is charged. The app's longest prompts are well under that.
- **Housekeeping schedule (required).** Every 10 minutes the database gives back credits held by a job whose worker was killed before it could finish, and asks the video and 3D servers to settle the jobs nobody collected: a render whose tab was closed is charged only if it really finished, and refunded if it failed. Once a day it clears expired pack credits.
- **Plan limits on the server.** Each plan's limits are enforced on the server, and accounts without a plan get writing and draft images only.
- **Price tables fixed.** GPT-5.5, Gemini 3.5 Flash, Kimi, Nano Banana at fal's prices, and Blender's assistant.
- **Separate pack balance.** Pack credits sit in their own 12-month balance.
- **Stripe events handled.** Renewals are granted once per invoice. Refunds, disputes and failed payments are acted on, and cancelling only ends the plan it belongs to. Upgrades add credits for the part of the month still to run. A payment that tries to take over another account's active subscription grants nothing and is recorded for you.
- **Cancelling keeps credits until the switch.** Until the switch day, a cancelled plan's credits stay usable, as the current Terms say.
- **Frances.** Daily limits by plan (5 / 15 / 30 / 50 questions a day). She moves to Opus 5.5 with prompt caching.
- **Old packs stay on sale.** The current packs (300 / 1,200 / 4,000) stay on sale until the switch day.
- **The credit value does not change yet.** Everything is still priced at 1 credit = $0.03. The app, `image-proxy` and `blender-bridge` read the live value from the database (`turn_credit_regime()`).

**Switch day (step 6):**
- **New credit value.** 1 credit = $0.01, so every action costs about 3 times the credits it does now.
- **Balances ×3.** Every balance is multiplied by 3, once.
- **Old allowances kept for 30 days.** Current subscribers keep 2,400 / 7,200 / 27,000 credits a month for their renewals.
- **New allowances.** New subscribers get Writer 600, Director 1,600, Producer 5,000.
- **Trial and new packs start.** The 50-credit free trial begins and the new packs go on sale. The old packs come off sale a few minutes before the switch.
- **Cancelling ends plan credits.** From then on, a cancelled plan's unused monthly credits end with the plan. Pack credits keep their 12-month expiry.
- **No redeploy or republish.** The functions pick up the new value on their own within about 30 seconds. Open tabs of the app pick it up within about 5 minutes: sooner when someone comes back to a tab after a minute away, and at once on a reload.

## (1) Run billing-v2.sql (Supabase SQL Editor, in the browser)

1. Open Supabase Dashboard → SQL Editor → New query.
2. Paste the whole of `supabase/billing-v2.sql` and click Run.
3. All 13 RESULT rows must read `ok`.

The file runs as one transaction, so a failed run changes nothing, and it is safe to run again. Today's app, `image-proxy`, webhook and Blender keep working unchanged.

**One-time carry-over.** Plan credits and pack credits are split into separate balances:
- credits a subscriber has above their monthly allowance (800 / 2,400 / 9,000; the old "pro" plan counts as Director) become a pack balance that lasts 12 months;
- an account without a plan keeps its whole balance as a 12-month pack balance;
- nobody's total changes.

**Check:** `select * from public.turn_credit_regime();` should show `switched = false` and `usd_per_credit = 0.03`.

**If this step runs late, or not at all:**
- the new `stripe-webhook` fails every grant with a 500, and Stripe retries for 3 days;
- the new `image-proxy` refuses every paid call with "Credits can't be checked right now";
- the new app falls back to the old credit value, with no trial and no packs.

**Never, once this has run:** paste an old copy of `credits.sql` (from before 2026-09-30), or run `spend-idempotency-migration.sql` again. Either one puts back the single-balance functions.

## (2) Run billing-housekeeping-cron.sql (SQL Editor) — required

1. SQL Editor → New query → paste the whole of `supabase/billing-housekeeping-cron.sql` → Run.
2. All 5 RESULT rows must read `ok`: `pg_net`, `kinolot-release-stale-holds`, `kinolot-reconcile-video-holds`, `kinolot-reconcile-studio-holds` and `kinolot-expire-lots`. If the `pg_net` row fails, turn it on under Database → Extensions → `pg_net`, then run the file again.

It turns on `pg_net` (it lets the database call a web address) and schedules four pg_cron jobs:

- **Every 10 minutes, stale holds:** a hold with no provider job (writing, images, voice, or a video / 3D job that never started) that is still open after 30 minutes is given back. Its worker was killed (a time or memory limit, a redeploy) before it could settle or release it.
- **Every 10 minutes, the reconciliation:** the database calls `image-proxy` (videos) and `blender-bridge` (3D) with `{"op":"reconcile_holds"}`. Each one asks the provider about the jobs nobody has collected for an hour, for example because the tab was closed:
  - the job **finished**: it is charged exactly as the app would have charged it (a render priced by its length is charged for its real length);
  - the job **failed**, was cancelled, or the provider doesn't know it: its credits are **refunded** in full;
  - the job is **still running**: it is checked again 10 minutes later.

  In plain words: a render whose tab was closed is charged only if it really finished, and refunded if it failed. The calls need no key. They are safe if anyone else makes them, and each server does the work at most once every 4 minutes.
- **Last resort:** a video or 3D hold that is still open after **30 days** (the provider never gave an answer) is settled at the held amount.
- **Daily:** expired pack credits are cleared, so idle accounts' stored totals stay exact.

Until step 4, the two reconcile calls just get a refusal from the old functions. That is harmless.

It is safe to run again: each job is removed by name and scheduled again.

**If this step is skipped:**
- a user whose job's worker is killed loses the whole hold, with no result;
- a render whose tab was closed stays on hold until someone opens it again, and is refunded only then if it failed.

## (3) Stripe dashboard (browser)

**Don't add the new webhook events yet.** They are added in step 4, right after the new webhook is deployed.

1. **Failed payments.** In Settings → Billing → Subscriptions and emails:
   - turn on Smart Retries (the recommended schedule);
   - set "Cancel subscription" after the final retry;
   - turn on failed-payment and expiring-card emails;
   - turn on receipts.
2. **Payment methods on the plan links:** cards and wallets only.
3. **New credit packs.** Create three new one-off products, each with a price and a payment link:

   | Pack | Price | Metadata |
   |---|---|---|
   | 250 credits | $10 | `app=kinolot`, `kind=credit_pack`, `pack_credits=250` |
   | 1,000 credits | $35 | `app=kinolot`, `kind=credit_pack`, `pack_credits=1000` |
   | 3,000 credits | $99 | `app=kinolot`, `kind=credit_pack`, `pack_credits=3000` |

   - Set each link's after-payment URL to `https://kinolot.infinitestudioai.com/?credits=<n>`.
   - Make matching test-mode links too.
   - **Leave the three new live links deactivated until the switch day.**
   - Send the six links to Claude, or paste them into `CREDIT_PACKS` in `app/plans.jsx` (`live:` and `test:`), before step 5. **Done 2026-10-01** (the live links stay deactivated in Stripe until the switch day).
   - The new packs don't appear in the app until the switch, even with the links pasted in.
   - **Leave the three old pack links (300 / 1,200 / 4,000) on sale.** They come off on the switch day (step 6).
4. **Recommended, from the review:**
   - Settings → Checkout and Payment Links → "Limit customers to one subscription". Check first that it doesn't block Academy subscribers who use the same email. (Even without it, the database now refuses a second subscription on another customer for an account that already has one, and records it as `subscription_conflict`.)
   - Statement descriptor "KINOLOT".
   - Optional: set each plan link's after-payment URL to `/?welcome=1&plan=writer|director|studio`. The welcome card then waits for the right plan to arrive.

**If this step goes wrong:**
- **New pack links live before the switch:** a pack bought early is credited as 250 old credits, and step 6 then triples it to 750.

## (4) Deploys (Mac, with your go-ahead), in this exact order

Run `git pull` first. Deploying a function from one machine overwrites edits made to it on the other.

**a. Deploy the webhook first:**

```
cd ~/Desktop/TURN-v6
git pull
npx -y supabase@latest functions deploy stripe-webhook --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
```

**b. Then add the new webhook events (Stripe dashboard, browser).** Go to Developers → Webhooks → the Kinolot endpoint (live mode) → Select events.
- Keep: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`.
- Add: `invoice.payment_failed`, `customer.subscription.updated`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `checkout.session.async_payment_succeeded`.
- That makes nine in all.
- Confirm the webhook's `STRIPE_SECRET_KEY` secret is an `sk_live_…` key. On a mismatch, the new webhook answers 500 and records `mode_mismatch`.

Why this order: the old webhook answers "OK" to event types it doesn't know, so a refund, dispute or failed payment sent to it would be acknowledged and never acted on.

**c. Immediately before deploying `image-proxy`,** run this in the Supabase SQL Editor (browser):

```sql
insert into public.turn_billing_state(key, value)
values ('server_video_billing', jsonb_build_object('at', now()))
on conflict (key) do nothing;
```

From then on, a browser tab still running the old app can't charge a render: its old in-browser spend call changes nothing, because the new server charges. In the minute between this line and the deploy, a render on the old server costs nothing. That's a small cost to you, never a double charge to a user.

**If more than a day passes between this line and the `image-proxy` deploy** (for example the deploy failed and you retry it later), set the marker again immediately before the deploy. Run both lines together:

```sql
delete from public.turn_billing_state where key = 'server_video_billing';
insert into public.turn_billing_state(key, value)
values ('server_video_billing', jsonb_build_object('at', now()));
```

Why: for 48 hours after the marker's time, the new `image-proxy` still collects renders that were started on the old one. That window has to start at the deploy. The switch (step 6) then needs a credit hold taken after the new marker. The new `image-proxy` takes one on the first paid call by any account that isn't an admin (admins take no holds).

**d. Then deploy the rest, straight away.** Deploy `image-proxy` and `blender-bridge` together, one right after the other, from the same `git pull`:

```
npx -y supabase@latest functions deploy image-proxy --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
npx -y supabase@latest functions deploy blender-bridge --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
npx -y supabase@latest functions deploy billing-portal --project-ref vubenblfdzginlqiglzw --use-api   # only if Manage plan isn't deployed yet (JWT verification stays ON)
```

**If every paid call is refused with "Credits can't be checked right now":** `billing-v2.sql` hasn't run on this database. Go back to step 1.

**If a video submit is refused with `hold_attach_failed`:** the render couldn't be tied to its credits, so it was stopped and its credits returned. Try again. If it keeps happening, check the `image-proxy` logs for both lines:
- `[billing] attach … failed`: the database didn't answer;
- `[billing] attach … refused`: the database answered no. `mismatch` means that job id is already on another hold; `unknown` means the database has no such hold.

**Optional:** `npx supabase secrets set VIDEO_HOLD_SECRET=<long random string>`. It signs the video hold tokens; without it, the service-role key is used.

Nothing needs removing later: the new `image-proxy` keeps accepting Frances questions from tabs that still run the old app.

**If the order is wrong:**
- **Before step 1:** see step 1.
- **Events added before the new webhook is deployed:** a refund, dispute or failed payment in that gap is acknowledged and dropped. Resend those events from the Stripe dashboard (Developers → Events → the event → Resend) once the new webhook is live.
- **Marker set long before `image-proxy` is deployed:** until the deploy, video renders cost nothing, because the old server doesn't charge and the browser spend is switched off. If more than a day passes, delete the marker and insert it again immediately before the deploy (see c). Otherwise renders started on the old server just before the deploy can't be collected: the 48-hour window after the marker has already run out, and those users never get their video.
- **Marker set after `image-proxy` is deployed:** a tab still on the old app is charged twice for each render it starts in that gap.
- **Publishing (step 5) long after `image-proxy`:**
  - the old app shows the server's new refusals as plain error text;
  - it still quotes video in the old way.

  Nobody is overcharged once the marker is set. Keep the gap to minutes.

## (5) Replit: Pull, then Publish (browser)

Right after step 4, open the TURN-v6 Replit project:
- Git → Pull.
- Check `git log --oneline -3` matches the Mac.
- Publish.

The new cache keys (`20260930-billing1`) make every browser load the new files.

**Leave the old pack links on sale.** They stay available until the switch day; the switch triples their credits like every other balance.

**Check (signed in):**
- the account menu shows your balance;
- the Plans window shows 800 / 2,400 / 9,000 and the three current packs (300 / 1,200 / 4,000) with Buy buttons. The new packs don't appear until the switch;
- an image's cost chip reads today's price, e.g. Nano Banana 2 at 2K = 4;
- Frances answers.

**Why the server goes first this time:** the README's Frances section says "publish the app first, then deploy `image-proxy`". This release reverses that order, a few minutes apart:
- **Server first, with the marker set:** an old-app tab is never double-charged. For those minutes it only shows some refusals as bare codes, such as `frances_daily_limit`.
- **App first:** on the old server, new-app video renders would be free, and Frances questions would be charged as writing.

**If the app is not published:** the old app keeps working against the new server, but it never shows the new banners, the pack balance or the trial.

## (6) Switch day, at least 30 days after the notice

1. **Stripe, a few minutes before the switch:**
   - **deactivate the three old pack links** (300 / 1,200 / 4,000; ids `8x200l63a2zVfpO9Dlc7u03`, `9B6cN73V28YjfpO02Lc7u04`, `8x200l77e1vR4La7vdc7u05`);
   - then go to Developers → Webhooks → the Kinolot endpoint → Event deliveries. **Nothing may be pending or failed.** Resend any failed delivery and wait until it succeeds.
   - Why: every old pack that was paid for is then already credited in the old units, and the switch triples it with every other balance.
   - Safety net: an old-pack grant that still arrives after the switch is tripled too. The webhook marks it as an old-unit pack (`legacy_unit`), and the database decides the ×3 while it holds the account's lock, together with writing the pack credits. So a grant that lands while the switch is running is never missed. Keep this order anyway, as belt and braces.
2. **SQL Editor:** paste and run `supabase/billing-switch.sql`. All 9 RESULT rows must read `ok`.
   - It multiplies every balance by 3 exactly once: plan credits, packs, open holds and the plan payments a refund is matched against. A second run changes nothing.
   - **It refuses** (a FAIL row saying why, nothing changed) if the `server_video_billing` marker from step 4c is missing, or if `image-proxy` hasn't taken a single credit hold since that marker. Only the new `image-proxy` takes holds, so this proves it is live. The switch must never run with the old `image-proxy`.
   - Inside the transaction it checks that every total is exactly 3 times what it was. If not, it stops with an error and **nothing is committed**. Contact support before trying again.
   - The RESULT table comes after the commit, so it shows what was actually saved.
3. **Stripe, right after:**
   - set the plan products' `plan_credits` metadata to Writer `600`, Director `1600`, Producer `5000`;
   - activate the three new pack payment links.
4. **Nothing to deploy or publish:**
   - the functions switch to 1 credit = $0.01 within about 30 seconds;
   - open tabs of the app switch within about 5 minutes, sooner when someone comes back to a tab after a minute away, and at once on a reload;
   - the Plans window then shows 600 / 1,600 / 5,000, the trial line and the new packs;
   - current subscribers see "Your monthly allowance stays … until <date>".

**Check:**
- `select * from public.turn_credit_regime();` shows `switched = true`, `usd_per_credit = 0.01`, `trial_credits = 50`;
- after a reload, a 10-second 720p video shows 304 credits.

**If the order is wrong:**
- **Stripe `plan_credits` changed before `billing-switch.sql`:** a renewal in between grants 600 old credits, a third of what it should be.
- **New pack links activated before it:** those packs are tripled.
- **Old pack links still on when the switch runs:** a pack bought in the last minutes may be granted after the switch. The database triples such a late old-pack grant as a safety net (the webhook marks it `legacy_unit`), but turn the links off first as in 1.
- **`billing-switch.sql` never runs:** everything stays at the old value, and the notice would be wrong.
- **Run by mistake** (for example before the notice): see **Rollback** below.

## (7) The 30-day notice (send on day 0, after step 5)

Fill in the two dates:
- `<SWITCH DATE>`: at least 30 days away;
- `<SWITCH DATE + 30>`: 30 days after that.

Suggested text (email, and optionally an in-app note):

> **Subject:** Changes to Kinolot credits on <SWITCH DATE>
>
> Hi,
>
> We're changing how Kinolot counts credits, and we want you to hear it from us 30 days ahead.
>
> **What changes on <SWITCH DATE>**
> - Credits get finer: every action will cost about three times as many credits as today. For example, 10 seconds of 720p video goes from 102 to about 304 credits.
> - On that day we multiply your balance by three, so nothing you have loses value.
> - If you already subscribe, your monthly allowance also triples for your renewals until <SWITCH DATE + 30>: Writer 2,400, Director 7,200, Producer 27,000. After that, plans give Writer 600, Director 1,600 and Producer 5,000 credits a month.
> - Plan prices don't change: Writer $19, Director $49, Producer $149.
> - **Cancelling.** Until <SWITCH DATE>, if you cancel, your credits stay usable, as today. From <SWITCH DATE>, when a plan ends, its unused monthly credits end with it. Pack credits always stay usable until they expire.
>
> **What's already new today**
> - **Pack credits are separate.** Credit packs now sit in their own balance, last 12 months, and are never reset when your plan renews. Your plan's monthly credits are always used first.
> - **Your current balance.** Credits you already have above your monthly allowance (or all your credits, if you have no plan) became pack credits today. They last 12 months from today.
> - **How credits are charged.** Every generation now sets aside its credits when it starts and returns them if it fails.
> - **Voice uses credits.** Voice lines, transcription and voice design now use credits.
> - **Upgrading.** If you move to a bigger plan, you get the extra monthly credits for the part of the month that's left, just as you pay for it.
> - **Frances has a daily limit by plan.** Frances, the help assistant, stays free with a daily number of questions: 5 without a plan, 15 on Writer, 30 on Director and 50 on Producer.
> - **Manage plan.** Card, invoices and cancelling are under Manage plan in the account menu.
>
> **From <SWITCH DATE>:** new accounts get 50 free credits after confirming their email, and the new credit packs go on sale: 250 for $10, 1,000 for $35 and 3,000 for $99. Today's packs stay on sale until then.
>
> Questions? Write to kinolot-billing@infinitestudioai.com.
>
> — The Kinolot team, Infinite Studio AI

## (8) Terms and privacy wording (for you and a lawyer)

The proposed wording is in `docs/Billing Terms Proposal.md`, items 1 to 33 (items 26 to 33 replace or refine earlier ones after the reviews: 32 is the trial wording the app now shows, 33 the rule that a render is charged only if it finishes).

`terms.html` and `privacy.html` were **not** edited: a fingerprint test locks them. Items 11, 15 and 26 also change `privacy.html`: the cancelling line, and the email fingerprint used for the one-per-person trial.

The current Terms already match day 0 on cancelling: credits stay usable until the switch day (item 26). The cancelling change, the new allowances and the trial need the new wording live **before the switch day**; the notice (step 7) announces them.

A lawyer should check them with:
- the UK 14-day cancellation right;
- the renewal cooling-off period (the DMCC rules expected from January 2027).

## Rollback

**The switch ran by mistake** (for example on day 0, before the notice):
1. **SQL Editor, as soon as possible:** paste and run `supabase/billing-switch-undo.sql`. All 6 RESULT rows must read `ok`.
   - It is the exact inverse of the switch when run soon after: every balance is divided by 3 again (plan credits, packs, open holds, plan payments), the grandfathering is cleared and the switch marker is removed.
   - Free trials granted since the switch are taken back. Those accounts get the trial again on the real switch day.
   - If something was spent in the new units since the switch, it rounds up in the users' favour. The second RESULT row says "exact" or how many numbers were rounded.
   - It refuses, changing nothing, if the switch hasn't run.
2. **Mac, straight after (`git pull` first):**

   ```
   npx -y supabase@latest functions deploy image-proxy --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
   npx -y supabase@latest functions deploy blender-bridge --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
   ```

   A running instance keeps the credit value it read for its whole life. Without the redeploy it would go on pricing at $0.01 against balances that are no longer tripled.
3. **Stripe:** put the plan products' `plan_credits` back to Writer `800`, Director `2400`, Producer `9000`, deactivate the new pack links, and turn the old pack links back on if they were turned off.
4. Open tabs of the app follow within about 5 minutes (sooner when someone comes back to a tab after a minute away, at once on a reload).

**Rolling back the day-0 code** (the new `image-proxy` or app misbehaves):
- **After the switch day**, the old code must not run on tripled balances: it prices at a fixed $0.03 and lets trial accounts render video. Run `billing-switch-undo.sql` first (see above), or ask for a hotfix instead of a rollback.
- Roll back the app **and** `image-proxy` **together**. The new app on the old proxy gets free video renders and has Frances questions charged as writing.
- Then delete the marker, so the old app's in-browser spend charges video again:

  ```sql
  delete from public.turn_billing_state where key = 'server_video_billing';
  ```

- A few minutes after the old `image-proxy` is live, give back the credits the new code still had on hold. The old code never settles or releases them:

  ```sql
  select public.turn_release_hold(ref) from public.turn_credit_holds where status = 'held';
  ```

  If `blender-bridge` stays on the new code, leave its holds alone: add `and ref not like 'studio:%'` before the semicolon.
- Keep the database as it is: every old caller keeps working on `billing-v2.sql`.
- Don't restore a whole-database backup to undo billing. It also takes back every user's work and every Stripe grant since.

## Later housekeeping

- **Plan switching in Manage plan (Stripe API):** turn it on only after steps 1 to 4, because the webhook now handles `customer.subscription.updated`. It needs:
  - the three plan prices;
  - `proration_behavior: always_invoice`;
  - downgrades at period end.

  An upgrade then adds the extra monthly credits for the part of the month still to run, as Stripe prorates the price. Then set `PORTAL_PLAN_SWITCHING = true` in `app/plans.jsx` and update `APP_FEATURES`.
- **Weekly check (SQL Editor):**

  ```sql
  select reason, count(*) from turn_grant_failures where created_at > now() - interval '7 days' group by 1;
  select jobname, schedule, active from cron.job where jobname like 'kinolot-%';
  select status_code, content, created from net._http_response order by created desc limit 10;
  ```

  - The last line shows what the reconcile calls answered, for example `{"ok":true,"checked":3,"settled":2,"released":1,"left":0}`. Status 200 each time is what you want.

  - A `length_mismatch` row is a render that came back longer than its hold covered. The user was charged only the hold; you paid the rest. The same cases are in the `image-proxy` logs as `[billing] length_mismatch <ref> held=<n> output_s=<s>`: Supabase Dashboard → Edge Functions → `image-proxy` → Logs, search `length_mismatch`. To list them:

    ```sql
    select created_at, uid, event_id as hold_ref, details from public.turn_grant_failures where reason = 'length_mismatch' order by created_at desc;
    ```

    `hold_ref` is the render's hold; `details` shows the credits held, the output's length in seconds and what it really cost. One now and then is a margin that was too small. Many, or many from one account, are worth a look: those files may claim a shorter length than they have.

  - Snapshot copies: the copies of the videos that renders still running are billed by. Any older than 2 days is a leftover that the housekeeping removes on its next runs; if many stay, search the `image-proxy` logs for `snapshot cleanup failed`. To list them:

    ```sql
    select name, created_at from storage.objects where bucket_id = 'turn-assets' and starts_with(name, '_internal/video-snapshots/') order by created_at;
    ```

  - Two more `image-proxy` log lines worth a search: `snapshot copy failed` / `snapshot upload failed` (a render's video couldn't be copied, so it was held and billed at the longest length; many in a row point to Storage, not to users) and `stt_length_mismatch` (the speech service reported a longer recording than the file declared; it was charged at the file's length, never more).

  - A `subscription_conflict` row is a paid subscription that would have replaced an account's other, still-active subscription. Nothing was granted. Check it with the customer:
    - a real second subscription: cancel the old one (or clear the account's `stripe_sub_id`), delete that event id from `turn_stripe_events`, then resend the event from Stripe;
    - otherwise refund it in Stripe.
  - Also check the webhook's logs for `GRANT_FAILURE`, `PLAN_UPGRADE`, `REFUND_REVOKE` and `ACCOUNT_FROZEN`.
