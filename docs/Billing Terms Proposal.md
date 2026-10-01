
## Payments, plan changes, refunds and chargebacks (from the Stripe webhook work, 2026-09-30)

Proposed for terms.html, "Plans and credits" (not applied: the page is locked by its fingerprint test).
Each item says what the new webhook does, so the Terms match the app. Have a lawyer check them, together with
the UK 14-day cancellation right and the renewal cooling-off period (report risk #17).

1. **Upgrading.** Add: "If you move to a bigger plan, the change is immediate: Stripe charges the difference for
   the rest of the month, and we add the difference in monthly credits straight away. Your renewal date stays the same."
2. **Downgrading.** Add: "If you move to a smaller plan, the change takes effect at your next renewal. Until then
   you keep your current plan and credits."
3. **Failed payments.** Add: "If a renewal payment fails, Stripe retries it and emails you a link to update your card.
   Your credits don't refill until the payment goes through. If every retry fails, the subscription ends."
4. **Refunds.** Replace the sentence "If something went wrong on our side, email us — we're reasonable." with:
   "If we refund a payment in full, the credits that payment added and that you haven't used yet are removed.
   If something went wrong on our side, email us — we're reasonable."
5. **Chargebacks.** Add: "If you dispute a payment with your bank, your account is paused while the dispute is open.
   If the dispute is decided in your favour, the unused credits from that payment are removed and the account stays
   paused until we've spoken with you. If it is decided in our favour, the account is unpaused."
6. **Cancelling.** The current line "your plan stays active until the end of the paid period and any remaining
   credits stay usable" needs to match whatever the owner and builder 1 decide for plan credits after a plan
   ends (the report recommends: plan credits end with the paid period; pack credits keep their 12-month expiry).

## Packs, the free trial, the new allowances and cancelling (from the app work, builder 4, 2026-09-30)

Proposed for terms.html "Plans and credits" and privacy.html (not applied: both pages are locked by their
fingerprint test). Each item says what the app now shows, so the legal pages match it. Lawyer check as above.

7. **Plan credits vs pack credits.** Replace "Credits refresh to your plan's allowance at each billing cycle and
   don't roll over unless the app says otherwise." with: "Your plan's monthly credits refresh to your plan's
   allowance at each renewal and don't roll over. Credit packs are separate: pack credits last 12 months from
   purchase and are never reset when your plan renews. We use your plan's monthly credits first, then pack
   credits, oldest first."
8. **Who can buy packs.** Add: "Any signed-in account can buy a credit pack. Without a paid plan, credits can be
   used for writing and draft images only."
9. **Free trial.** Add: "New accounts get 50 free credits once, after confirming their email address. Trial
   credits can be used for writing and draft images only, and have no cash value." (Superseded by item 32,
   which matches the app's current wording.)
10. **How credits are charged.** Add to the first bullet: "When a generation starts we set aside its credits;
    if it fails, they are returned."
11. **Cancelling.** Replace "You can cancel any time; your plan stays active until the end of the paid period and
    any remaining credits stay usable." with: "You can cancel any time from Manage plan in your account menu;
    your plan stays active until the end of the paid period. After that, your plan's monthly credits end and any
    pack credits stay usable until they expire." (Matches the report's recommendation; confirm with builder 1's
    final behaviour for plan credits after a plan ends.) privacy.html:131 ("You can cancel your subscription at any
    time; your remaining credits stay usable.") needs the same change.
12. **The Option A change itself (notice to current subscribers, 30 days).** The existing line "Prices and
    allowances may change; changes apply from your next billing cycle, and we'll tell you first." already covers
    it. Suggested notice text for the email/in-app message (owner to send 30 days before the switch):
    "On <switch date> Kinolot's credits change: every action will cost about three times as many credits, and on
    that day we multiply your balance by three, so nothing you have loses value. For renewals until <switch date
    + 30 days> you keep your current allowance in the new units (Writer 2,400, Director 7,200, Producer 27,000);
    after that your plan's monthly allowance becomes Writer 600, Director 1,600, Producer 5,000. Prices don't
    change. Credit packs now last 12 months and are never reset at renewal."

## What the database does (from the database work, builder 1, 2026-09-30)

Confirms items 6 and 11 and adds what they don't cover. Not applied (terms.html and privacy.html are
locked by their fingerprint tests). Lawyer check as above.

13. **Plan credits after a plan ends: confirmed.** When the subscription ends, the plan's monthly credits end
    (turn_end_plan_for_sub sets them to 0); pack credits keep their 12-month expiry. Items 6 and 11 can use the
    wording in item 11 as written.
14. **Balances that exist today (one-time carry-over, when billing-v2.sql runs).** Today one balance mixes plan
    and pack credits. On that day: for each subscriber, credits above the plan's monthly allowance become pack
    credits that last 12 months from that day; an account without a plan keeps its whole balance as pack credits
    that last 12 months from that day. Nobody's total changes, but credits that never expired before now expire
    after 12 months. Suggested line for the 30-day notice: "Credits you already have above your monthly
    allowance (or all your credits, if you have no plan) become pack credits: they last 12 months from
    <billing-v2 date> and are never reset at renewal."
15. **Free trial, once per person.** Add to item 9: "One free trial per person: accounts that share an email
    mailbox (for example the same address with a '+' tag) get it once. Accounts that have paid for a plan or a
    pack don't get it. When you subscribe, your plan's monthly credits replace any trial credits left."
    privacy.html, "What we store": add "a one-way fingerprint of your email address, used only so each person
    gets the free trial once; it is deleted with your account."
16. **Goodwill credits.** Credits we add by hand (support, promotions) are pack credits: they last 12 months
    and are never reset at renewal. Add to the credits section: "Credits we give you (for example after a
    problem) last 12 months."
17. **Paused accounts (disputes).** While an account is paused, its credits stay visible but can't be spent
    (matches item 5).

## What the generation server now charges and allows (from the server work, builder 3, 2026-09-30)

Not applied (terms.html is locked by its fingerprint test). Adds what items 1-17 don't cover. Lawyer check as above.

18. **How a charge works (extends item 10).** Replace item 10's sentence with: "When a generation starts we set
    aside the most it can cost. When it finishes we keep what it actually cost and return the rest; if it fails,
    all of it is returned. A video that takes longer than six hours is stopped and its credits are returned."
19. **Voice uses credits.** The Terms list voices as part of the service, and the app now charges for them. Add to
    the first bullet: "Voice lines, transcription, voice design and voice cloning use credits too."
20. **What each plan includes.** Suggested new bullet (matches what the server enforces): "Writer includes
    writing on every engine and key art up to 2K. Director adds the Art Room (every image engine up to 4K,
    character voices and 3D). Producer adds the Stage (video). Without a plan, credits (a free trial or a credit
    pack) cover writing on the default engines and draft images only."
21. **Frances, the help assistant.** "Creating an account is free and lets you look around" stays true. Suggested
    addition: "Frances, the in-app help assistant, is free to use up to a daily number of questions that depends
    on your plan (5 without a plan, 15 on Writer, 30 on Director, 50 on Producer)."
22. **Price shown vs price charged.** Suggested addition to the first bullet: "If a render would cost noticeably
    more than the price the app showed, it doesn't start and we ask you to check the settings." (Server rule:
    a video whose price is more than 10% + 2 credits above the Stage's quote is refused, never charged.)

## Timing, as built (from the integration, 2026-09-30)

Not applied (terms.html and privacy.html are locked by their fingerprint tests). Lawyer check as above.

23. **Two dates, not one.** The fixes go live on the day the owner deploys them (the "billing v2 day"); the
    credit change goes live on the switch day, at least 30 days later. On the billing v2 day: pack credits get their
    own 12-month balance (item 14's carry-over happens then), generations set aside their credits (item 18), voice
    starts using credits (item 19), what each plan includes is enforced (item 20) and Frances's daily limit by plan
    applies (item 21). On the switch day: 1 credit becomes $0.01 of provider cost, every balance is multiplied by 3,
    the grandfathered allowances start (item 12), the free trial starts (items 9 and 15: "from <switch date>, new
    accounts get 50 free credits…") and the packs go on sale (item 8). Items 9 and 12 need the real dates filled in.
24. **Packs before the switch.** Until the switch day the packs are not on sale (the app shows "Coming soon").
    If the Terms list the pack prices, say they apply from <switch date>.
25. **Grandfathered subscribers are told in the app.** For 30 days after the switch the Plans window shows a current
    subscriber "Your monthly allowance stays <old allowance x3> credits until <date>; renewals after that give <new
    allowance>." Item 12's notice text matches it.

## After the review (database repair, 2026-09-30)

Not applied (terms.html and privacy.html are locked by their fingerprint tests). These items replace or refine
earlier ones so the pages match what the database now does. Lawyer check as above.

26. **Cancelling: two dates (replaces the timing in items 6, 11 and 13).** Until the switch day, cancelling keeps
    today's rule: the plan ends at the end of the paid period and the remaining credits stay usable. The current
    lines in terms.html ("any remaining credits stay usable") and privacy.html:131 ("your remaining credits stay
    usable") are therefore correct on day 0 and must stay until then. From the switch day, the database ends a
    cancelled plan's unused monthly credits with the plan (pack credits keep their expiry). Put item 11's wording
    live on the switch day, not before, with the date: "From <switch date>: you can cancel any time from Manage plan
    in your account menu; your plan stays active until the end of the paid period. After that, your plan's monthly
    credits end and any pack credits stay usable until they expire." privacy.html:131 gets the same change on the
    same day. The 30-day notice (item 31) announces it.
27. **Upgrading (replaces item 1).** "If you move to a bigger plan, the change is immediate: Stripe charges the
    difference for the rest of the current billing period, and we add the difference in monthly credits for the
    same share of the period (for example, a third of it with ten days of a thirty-day period left). Your renewal
    date stays the same, and your next renewal gives the bigger plan's full allowance."
28. **Refunds (adds to item 4).** "…the credits that payment added and that you haven't used yet are removed,
    including credits set aside for a generation that is still running."
29. **A second subscription.** Suggested addition: "If a new subscription is paid for an account that already has
    an active subscription under a different billing account, we don't apply it automatically: we check it with
    you first, and refund it if it was a mistake."
30. **Timing and packs (refines items 23 and 24).** The cancelling change (item 26) happens on the switch day, not
    on the billing v2 day. The current credit packs stay on sale at their current prices until the switch day
    (the switch multiplies their credits by three like every other balance), and the new packs (250 / 1,000 /
    3,000) go on sale that day. If the Terms list pack prices, give both with their dates.
31. **The 30-day notice (adds to item 12).** Add: "Until <switch date>, if you cancel, your credits stay usable,
    as today. From <switch date>, when a plan ends, its unused monthly credits end with it. Pack credits always
    stay usable until they expire." (The owner runbook's step 7 carries the full text.)

## Round 2 (database repair, 2026-09-30)

Not applied (terms.html and privacy.html are locked by their fingerprint tests). Lawyer check as above.

32. **Free trial: the app's wording (replaces the wording in item 9; item 15 still applies).** The app now says:
    "New accounts get 50 free credits after confirming their email — enough to try the Writers' Room on the
    lighter writing engine (a logline, a synopsis, the spine and its first scenes), plus draft images." Suggested
    Terms line, from <switch date>: "New accounts get 50 free credits once, after confirming their email address —
    enough to try the Writers' Room on the lighter writing engine (a logline, a synopsis, the spine and its first
    scenes), plus draft images. Trial credits have no cash value." Keep "enough to try": what 50 credits cover
    depends on the engine and the length of each answer.
33. **A render is charged only if it finishes (adds to items 10 and 18).** Suggested addition to the first bullet:
    "A video or 3D render is charged only if it finishes. If it fails, is cancelled, or never starts, the credits
    set aside for it are returned in full — also when you closed the app before it finished." (How it works: the
    server checks every 10 minutes on renders nobody collected, charges the finished ones exactly as the app
    would have, and refunds the failed ones.) For the lawyer: if the provider never answers at all, the credits
    set aside are kept after 30 days as a last resort. Decide whether the Terms should say so, for example: "If
    we can't confirm a render's outcome within 30 days, its credits are not returned."
