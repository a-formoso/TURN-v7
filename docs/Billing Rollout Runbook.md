# Kinolot billing fixes: owner runbook

Written 2026-09-30 for the owner, revised 2026-10-01 after five review rounds.

**Status (2026-10-02): the credit switch is DONE.** Day 0 ran on 2026-10-01; `billing-switch.sql` ran on 2026-10-02 (11 accounts, 3,508 → 10,524 credits; current subscribers keep their old allowance until 2026-10-31); the new packs (250 / 1,000 / 3,000) are on sale and the old ones are off; the Terms and Privacy dated 2 October 2026 (trader: Alexandre Formoso, sole trader) are live with the "updated Terms" banner for 30 days. Left: the plan products' descriptions in Stripe (600 / 1,600 / 5,000), re-saving the plan-card lines in the Plans window as admin, and step 9's tax items before the first EU sale. Step 7 (the notice) was not needed: the only subscriber was the owner's own test subscription.

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
npx -y supabase@2.117.0 functions deploy stripe-webhook --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
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
npx -y supabase@2.117.0 functions deploy image-proxy --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
npx -y supabase@2.117.0 functions deploy blender-bridge --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
npx -y supabase@2.117.0 functions deploy billing-portal --project-ref vubenblfdzginlqiglzw --use-api   # only if Manage plan isn't deployed yet (JWT verification stays ON)
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

## (6) Switch day

**Before you start:** the updated `terms.html` / `privacy.html` (branch `switch-day-terms`, see step 8) are approved, dated, have `<legal name>` and `<business address>` filled in, and `<EU representative>` filled in or its sentence deleted (section 9, step 9), and are merged into `main` (they go live in item 5 below, the same day), and at least one non-admin account has made a paid request since the day-0 deploy (admins take no holds; the switch refuses without one).

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
4. **No deploy needed:**
   - the functions switch to 1 credit = $0.01 within about 30 seconds;
   - open tabs of the app switch within about 5 minutes, sooner when someone comes back to a tab after a minute away, and at once on a reload;
   - the Plans window then shows 600 / 1,600 / 5,000, the trial line and the new packs;
   - current subscribers see "Your monthly allowance stays … until <date>".
5. **Replit: Pull, then Publish** — this puts the updated Terms and Privacy pages live, matching the new rules.

**Check:**
- `select * from public.turn_credit_regime();` shows `switched = true`, `usd_per_credit = 0.01`, `trial_credits = 50`;
- after a reload, a 10-second 720p video shows 304 credits.

**If the order is wrong:**
- **Stripe `plan_credits` changed before `billing-switch.sql`:** a renewal in between grants 600 old credits, a third of what it should be.
- **New pack links activated before it:** those packs are tripled.
- **Old pack links still on when the switch runs:** a pack bought in the last minutes may be granted after the switch. The database triples such a late old-pack grant as a safety net (the webhook marks it `legacy_unit`), but turn the links off first as in 1.
- **`billing-switch.sql` never runs:** everything stays at the old value, and the notice would be wrong.
- **Run by mistake** (for example before the notice): see **Rollback** below.

## (7) The 30-day notice — not needed (owner, 2026-10-01)

The only Stripe subscriber is the owner's own test subscription, so no notice is sent. The text below is kept for a future price change with real subscribers.


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

**Drafted 2026-10-01 on the branch `switch-day-terms`** (not on `main`: Replit publishes `main` as it is, and these pages describe the rules from the switch day). They were built from `docs/Billing Terms Proposal.md` and checked against the code. They describe the plans (600 / 1,600 / 5,000), the packs and their 12-month balance, the trial, holds and settles, failed payments, refunds, disputes and Frances's limits; Privacy adds the trial's email fingerprint and the billing records kept.

**On the switch day (Mac):** set "Last updated" on both pages to the switch date, written like `14 November 2026`, merge the branch into `main` and push; then Replit Pull + Publish (step 6, item 5). Fill in `<legal name>` and `<business address>` on both pages first, and `<EU representative>` in `privacy.html` or delete that sentence (section 9, step 9). Then turn on the "We've updated our Terms and Privacy Policy" banner: in `app/plans.jsx` set `const TERMS_UPDATED_AT = "2026-11-14";` to the switch date written as YYYY-MM-DD (not "14 November 2026"), change `app/plans.jsx`'s `?v=` key in `TURN.html`, and Replit Pull + Publish. Check with `LEGAL_SWITCH_DAY=1 node scripts/test-rebrand-shell.mjs` (every placeholder still left, the date included, fails there).

**Your decisions (2026-10-01), now in the draft:**
- **Closing an account** for a reason other than a breach of the terms refunds unused paid time only, **not** unused pack credits (your answer: no).
- **A plan change you make by hand in Stripe** charges the proration at once ("always invoice"), as the upgrade wording promises (decided for you: it matches the extra credits the webhook adds when the upgrade is paid). How: section 9, step 5.
- **Prices stay in US dollars** and "include any VAT or sales tax we have to charge where you live". When you register for a tax, Stripe Tax carves it out of the same price (section 9, step 7).
- **14-day right to cancel**, for every buyer (the law requires it for UK and EU consumers; the Terms give it to everyone): within 14 days of buying a plan or a pack, the customer can cancel and get back the unused part of that purchase, in proportion. **No extra step at checkout** (your decision, 2026-10-02: no tick box in the app and no terms box on the payment page): one short line, "Starts straight away. Cancel within 14 days and you get back the part you haven't used." with a link to the Terms, sits behind a small ⓘ button next to each plan's and pack's name in the Plans window and on the homepage's plan cards (it opens on hover, keyboard focus or a tap; each purchase button points at it for screen readers with `aria-describedby`), and as a line under the chosen plan in the sign-up window. Choosing the plan or pack is the request to start straight away, and the app records that click (`turn_record_checkout_consent`, version `v3-2026-10-02-click`). The customer can cancel in any clear way (the email, or the cancellation form in the Terms). A renewal is not a new purchase.
- **Who we are:** both pages name the business, with the placeholders `<legal name>` and `<business address>` for you to fill before the switch (section 9, step 9). Privacy also names your EU representative for data protection (`<EU representative>`) and has a short "International transfers" paragraph.
- **Changes to these terms:** at least 30 days' notice in the app or by email before a change to a paid plan's price or allowance; other changes are shown in the app when they apply (the "We've updated our Terms and Privacy Policy" banner, 30 days from the app's `TERMS_UPDATED_AT`, set on the switch day).
- **Privacy:** a short "Why we use your data" (contract; legitimate interests, including stopping repeat free trials with the email fingerprint, and security; legal obligation, including tax records kept as long as tax law requires, in the UK generally six years and for EU VAT records ten years; consent where we ask for it).

**Still worth a lawyer's look before you sell widely** (none of this blocks the switch):
- the UK subscription-contract rules of the DMCC Act (check whether they are in force when you sell; they add reminder notices before renewals, an easy way to leave and a cooling-off period on renewals, and Manage plan already cancels online);
- **closing an account for no breach without refunding unused pack credits** (your "no"): this kind of term is on the Consumer Rights Act 2015 "grey list" (Schedule 2, Part 1, paragraph 7: the trader keeping sums paid for services not yet supplied when the trader ends the contract), and the EU Unfair Terms Directive has the same item, so a court could find it unfair and refuse to enforce it against a consumer. The alternative you declined is to refund unused pack credits on a no-fault closure;
- whether Kinolot's output is a **service or digital content** for the 14-day right, and whether the note is enough without a tick box (your decision, 2026-10-02) now that, on the plan and pack cards, it sits behind an ⓘ next to the name and shows only when opened (owner request 2026-10-02; the sign-up window still shows it as a line under the chosen plan): for digital content the UK rule (CCR 2013 regs 36-37) asks for the buyer's express consent to start and their acknowledgement that the right to cancel is lost, or a buyer who cancels within 14 days may owe nothing for the credits they used; the Terms' "unused part back" relies on that. Also the **confirmation on a durable medium** (CCR 2013 reg 16): Stripe's receipt carries neither the cancellation information nor the request to start straight away;
- **the EU "withdrawal button"** (Directive (EU) 2023/2673, new Article 11a of the Consumer Rights Directive, applying since 19 June 2026): EU consumers buying through a website must get a clearly labelled "cancel the contract here" function, in two steps, available for the whole 14 days, with an acknowledgement sent to them. Kinolot offers email and the cancellation form only: have the in-app function built **before the first EU sale** (the admin checklist has it);
- **EU GDPR representative** (GDPR Article 27): a UK business offering its service to people in the EU must appoint one in the EU and name it in the Privacy Policy (the `<EU representative>` placeholder), and the "International transfers" wording;
- whether a **business address service** is acceptable as the "geographical address at which the trader is established" (CCR 2013 Sch 2; Electronic Commerce Regulations 2002 reg 6) — a PO box is not;
- what your **other products on the same Stripe account** are: if any is a live or human-delivered service or goods, its sales abroad can count toward the UK VAT threshold (the panel assumes digital services);
- credit expiry (12-month packs, plan credits ending with the plan: kept, and said before every purchase); the 10% + 2-credit video tolerance; keeping a render's credits when its outcome is never confirmed in 30 days; the account hold during a dispute (lifted automatically when that dispute closes, won or lost, unless another dispute or an earlier hold is still open).

## (9) Tax and compliance, before the first real sale

Owner decisions 2026-10-01: keep the prices in dollars; warn me in the Admin panel when I have to register for VAT; I live and work in the UK and advertise to UK, EU and US users; decide the rest. None of this blocks the switch while you are the only subscriber, but do steps 1 to 9 before the first sale to anyone else. The tax rules below are the usual ones, checked on 2026-10-01; they are not tax advice, so check with an accountant before you register anywhere.

**1. SQL Editor (browser):**
- paste and run `supabase/billing-v2.sql` again. It is safe to run again (the carry-over never happens twice) and adds partial refunds (`refund_fraction`). All RESULT rows `ok`;
- then paste and run `supabase/tax-compliance.sql`. All 10 RESULT rows must read `ok`. Row 80 says FAIL if the billing-v2.sql re-run is missing: run `billing-v2.sql` again first, then this file again.

It creates the sales ledger (every payment and refund on the Stripe account, Kinolot and your other products alike, with the customer's country), the record of each purchase click (the request to start straight away), the figures for the Admin panel and the one-step dispute hold the webhook uses (`turn_dispute_hold`).

**2. Mac (`git pull` first, with your go-ahead):** deploy the webhook:

```
npx -y supabase@2.117.0 functions deploy stripe-webhook --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
```

From then on it records every payment and refund in the ledger, removes the same share of credits on a partial refund, and lifts the account hold a dispute placed when that dispute closes (won or lost; a lost one still removes that payment's unused credits; another open dispute keeps the account on hold). It also puts the account's email on the Stripe customer after a paid checkout (the billing email, below).
- **Stripe key:** if the `STRIPE_SECRET_KEY` secret in Supabase is a restricted key (starts `rk_`), give it **Customers: Write** (Developers → API keys → the key → Edit). Without it every email fix logs `EMAIL_SYNC … result=failed step=update`; the payment and its credits are not affected. A standard secret key (`sk_live_…`) needs nothing.
- **The customer who already paid with Apple Pay:** either change that customer's email by hand in Stripe (Customers → the customer → Edit), or, once this deploy is done, resend that checkout's `checkout.session.completed` event (Developers → Webhooks → the Kinolot endpoint → Event deliveries → the event → Resend). The resend adds no credits a second time and then sets the account's email on the customer (`EMAIL_SYNC … result=updated`). Do it soon after the deploy: a resend also sets the account's payment status back to active.

**Then, Stripe dashboard (browser):** Developers → Webhooks → the Kinolot endpoint (live mode) → Select events → add **`charge.refund.updated`** (ten events in all). A refund that is still pending (bank transfers, some wallets) removes nothing and isn't in the ledger until this event says it succeeded; a refund that fails is recorded for you (`refund_failed_review` in `turn_grant_failures`).

**3. Replit: Pull, then Publish.** The app then shows the 14-day note behind the ⓘ next to every plan's and pack's name, and under the chosen plan in the sign-up window (no confirm step: the click opens the payment page and is recorded) and the Admin panel's **Tax & compliance** panel. The note's "Terms" link goes to `/terms.html#cancel`, which lands on the "Your right to cancel" section once the new Terms are live (the switch day); until then it opens the current Terms, which say nothing about cancelling, so the note also reads "To cancel, email kinolot-billing@infinitestudioai.com". That extra part goes away by itself when you set `TERMS_UPDATED_AT` on the switch day (section 9, step 9). The plan picked before sign-up opens its payment page by itself after the account is ready: the note is under the chosen plan in the sign-in window (also in "Sign in", while that plan is waiting) and in a notice shown for about 4.5 seconds before the page moves; that purchase is recorded as `v3-2026-10-02-auto`.

**The billing email (your decision, 2026-10-02).** Every payment link the app opens carries the account's id and the account's email (`prefilled_email`), so the payment page starts with the email the account signs in with. A wallet such as Apple Pay can still hand Stripe its own email: once the new `stripe-webhook` is deployed (step 2), a paid Kinolot checkout whose Stripe customer has a different email gets the account's email instead, when the account's email is confirmed (logged as `EMAIL_SYNC`). Credits never depended on it: they go to the account by its id. A customer who paid before that deploy keeps the wallet's email on the Stripe customer until you change it there by hand or resend that checkout's event (step 2).

**4. Stripe: every Kinolot payment link** (the three plans and every pack, live and test). Settings → Business → Public details should list the Terms URL (`https://kinolot.infinitestudioai.com/terms.html`). Then, on each link (Payment Links → the link → Edit):
- **Collect customers' addresses → Billing addresses only (required).** Stripe then always has the customer's country: the Admin panel needs it, and so does Stripe Tax later. Payments with no country show up in the panel's "No country" box.
- **Don't turn on "Require customers to accept your terms of service"** (your decision, 2026-10-02: no extra step at checkout). If it is already on for a link, turn it off. The app's note (behind the ⓘ next to every plan's and pack's name, and under the chosen plan in the sign-up window) covers the 14-day right.
- If a setting can't be changed on an existing link, make a new link with the same price and metadata, and paste it into `app/plans.jsx` (or send it to Claude), then deactivate the old one.

**5. Stripe: a plan change you make by hand uses "always invoice".** Customers → the customer → the subscription → **Update subscription** → change the price. In the proration options keep prorations on and choose to **charge (invoice) the proration now**, not "on the next invoice" and not "no proration". The customer pays the difference at once, and the webhook adds the extra monthly credits for the part of the month still to run when that payment arrives, as the upgrade wording says. (Manage plan's own plan switching, when it is turned on later, uses the same setting: `proration_behavior: always_invoice`.)

**6. A 14-day cancellation** (any clear message within 14 days of buying a plan or a pack: usually an email to kinolot-billing@infinitestudioai.com, or the Terms' cancellation form; it doesn't have to come from the account's address — match it to the purchase by the details given; a renewal is not a new purchase):
1. Find the unused part. A pack: `select amount, remaining from public.turn_credit_lots where charge_ref = '<the charge id, ch_…>';`. A plan: the account's `plan_remaining` against the month's allowance (`select plan_remaining, plan_allowance from public.turn_credits where owner = '<user id>';`).
2. Refund that share of the payment in Stripe (payment → Refund → partial): the price × unused ÷ granted, rounded down to the cent. **Do it within 14 days of the customer's message**; a Stripe refund goes back to the same card or payment method, as the law asks. The webhook removes the same share of that purchase's credits (rounded up, never more than is unused).
3. For a plan, then cancel the subscription immediately with **no further refund** (the refund is already done). Its remaining plan credits end with it.

**7. Tax: when to register, and how.**
- **EU (now, before the first EU sale):** a UK business selling digital services to consumers in the EU owes EU VAT from the first sale, with no threshold. Register for the **non-Union OSS** scheme in one EU country of your choice (one registration and one quarterly return cover all 27), before the first EU consumer pays. The panel's EU box turns red, with the count and the amount, as soon as an EU sale exists. (The alternative is to stop selling to the EU until you register.) Once registered: keep the EU sales records for **ten years** from the end of the year of each sale, available electronically, with **two pieces of evidence that agree** on each customer's country (for example the billing address and the card's country, or the IP address); Stripe Tax collects them. Before the first EU sale also: the online withdrawal function and an EU GDPR representative (section 8).
- **UK:** register for VAT when your UK taxable turnover goes over **£90,000** in any rolling 12 months (register within 30 days of the end of the month it went over), or as soon as you expect it to go over £90,000 in the next 30 days alone. Sales of digital services to consumers outside the UK generally don't count toward it. This assumes every product is a digital service delivered automatically: sales abroad of live or human-delivered services (calls, coaching, events) or of goods can still count, so check with an accountant what your other products are. Your other products on the same Stripe account count, and so does income from outside Stripe (add it to the ledger by hand: README, "Tax & compliance records"). The panel warns at 75% and 90% and goes red at 100%.
- **US:** sales tax is per state. Many states use $100,000 of sales or 200 transactions a year as their "economic nexus" test; some are higher, some count sales only, and some don't tax digital services at all. The panel shows each state against $100,000 / 200 and warns at 80%: check that state's own rule then.
- **When you register anywhere:** turn on **Stripe Tax** (Settings → Tax), add the registration, set each Kinolot price's tax behaviour to **inclusive** (the dollar price stays what it is; the tax is carved out of it) and the product tax code for digital services, and turn on automatic tax on the payment links. Billing addresses are already required (step 4). Keep the sales records for as long as tax law requires (in the UK generally six years; EU sales under OSS ten years from the end of the year of the sale); the ledger keeps them even when an account is deleted.

**8. The Admin panel's Tax & compliance panel** (signed in as admin@infinitestudioai.com, next to Admin Storage):
- **UK:** your UK sales of the last 12 months in pounds, against £90,000. Dollars are converted at the rate in the panel (default 0.80 £ per $, set high on purpose so the warning comes early; change it if the pound moves a lot). Also the last 30 days (for the forward look) and the sales with no country, which might be UK.
- **EU:** the action item until the first EU sale, then red with the count and amount per country.
- **US:** each state's 12-month sales and number of payments, against $100,000 / 200.
- **No country:** payments Stripe had no country for (a link without billing-address collection).
- The panel counts from the day the webhook started recording (step 2). If your other products sold anything in the last 12 months before that, add those sales by hand (README, "Tax & compliance records"). The thresholds have one home, in the database (`turn__tax_thresholds()` in `supabase/tax-compliance.sql`), with the warning levels and the date they were last checked; the panel's wording and meter follow them.

**9. Before the switch: fill in who you are** on the `switch-day-terms` branch, in both `terms.html` ("Who we are", and the cancellation form) and `privacy.html` (who is responsible for your data), inside the `data-fill` spans, the same on both pages:
- `<legal name>`: your full name if you are a sole trader (just the name: the page already says "Infinite Studio AI is the trading name of …"), or the company's registered name and number if it is a limited company (for example "Example Ltd (registered in England and Wales, company number 01234567)");
- `<business address>`: the geographical address where the business is established (for a company, its registered office). Ask the lawyer whether a business address service is acceptable; a PO box is not;
- `<EU representative>` (`privacy.html` only): the name and address of your EU representative for data protection. If you won't offer the service in the EU yet, delete that sentence instead, and appoint one before you advertise there.

`LEGAL_SWITCH_DAY=1 node scripts/test-rebrand-shell.mjs` fails while any placeholder is left. Once VAT-registered, add your VAT number to "Who we are". On the switch day, also turn on the Terms banner: in `app/plans.jsx` set `const TERMS_UPDATED_AT = "2026-11-14";` (the switch date as YYYY-MM-DD), change `app/plans.jsx`'s `?v=` key in `TURN.html`, then Replit Pull + Publish; signed-in users see "We've updated our Terms and Privacy Policy" for 30 days. The same setting drops "To cancel, email …" from the note by every purchase button, since the Terms' "Your right to cancel" section is then live.

## Rollback

**The switch ran by mistake** (for example on day 0, before the notice):
1. **SQL Editor, as soon as possible:** paste and run `supabase/billing-switch-undo.sql`. All 6 RESULT rows must read `ok`.
   - It is the exact inverse of the switch when run soon after: every balance is divided by 3 again (plan credits, packs, open holds, plan payments), the grandfathering is cleared and the switch marker is removed.
   - Free trials granted since the switch are taken back. Those accounts get the trial again on the real switch day.
   - If something was spent in the new units since the switch, it rounds up in the users' favour. The second RESULT row says "exact" or how many numbers were rounded.
   - It refuses, changing nothing, if the switch hasn't run.
2. **Mac, straight after (`git pull` first):**

   ```
   npx -y supabase@2.117.0 functions deploy image-proxy --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
   npx -y supabase@2.117.0 functions deploy blender-bridge --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt
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
