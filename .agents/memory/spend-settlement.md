---
name: Spend settlement
description: How video render credit charges are recorded — job-riding spend records, event-id dedupe, and the SQL prerequisite.
---

**Rule:** a render's charge rides the job itself, never a post-hoc UI call. The spend record (cost, reason, launcher uid, ONE event id) is created at submit, persisted with the pending job, and settled at COMPLETED by whichever path delivers — live poll or crash-recovery — before any discard/stale branching (a rendered render is charged even if the user cleared mid-flight).

**Why:** post-hoc spends in the UI handler meant crash-recovered renders were never billed, and a signed-in-user change mid-render charged the wrong account. Duplicate settlement paths (live + recovery racing across tabs) need the shared event id to charge once.

**How to apply:**
- Any new paid generation path must pass `spend:{cost, reason, uid}` captured at the moment the user launches, and let the completion path settle it.
- `cloudSpendCreditReliable(cost, reason, uid, eventId)` — uid pins the launcher; same eventId is skipped if already queued; the queue is NEVER truncated (loud toast past 500), and an in-memory mirror keeps entries retrying when localStorage writes fail.
- Server-side dedupe (turn_spend_events + two-arg turn_spend_credit) only exists after `supabase/spend-idempotency-migration.sql` runs; the client falls back to the legacy one-arg RPC on pre-migration DBs (detected via "schema cache" error text). Architect verdict: treat the migration as a release prerequisite, not optional hardening.
- Flush holds foreign-uid entries and flushes nothing signed-out; cross-tab flush is guarded by `navigator.locks("turn_spend_flush")` where available.

**Rule:** a transport error without an HTTP status does not prove a paid request never reached the provider. Credit-settlement deduplication is not provider-job deduplication.

**Why:** a long image batch can otherwise automatically submit the same frame twice after a lost response, even when it has a durable pending-frame record.

**How to apply:** suppress ambiguous automatic retries unless the provider submission itself has a working idempotency key. Record uncertain in-flight work before submitting, and require an explicit, possible-extra-charge acknowledgement before retrying it.
