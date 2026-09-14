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

**Rule:** Idempotency and sufficient-funds enforcement are separate guarantees. A preflight balance read followed by a debit that clamps to zero is not atomic credit authorization.

**Why:** Distinct simultaneous requests can both pass preflight and be reported successful while collecting fewer credits than their combined cost. Existing event-id dedupe prevents duplicate charges for one event, not underpayment across different events.

**How to apply:** New paid entry points require an atomic sufficient-balance/idempotent settlement boundary and must fail closed until it is available. Do not auto-apply a database-function change when the user has prohibited schema changes; ask for that narrowly scoped approval. Keep provider refusal uncharged and preserve durable request ownership before external work.

**Rule:** A valid duplicate must still succeed after the original request used the last credits; check its receipt after acquiring the account lock, before checking available funds.

**Why:** An early receipt lookup can miss a concurrent uncommitted winner. Testing funds after waiting for that winner then incorrectly rejects the duplicate rather than acknowledging the already-recorded charge.

**How to apply:** Test simultaneous duplicate events with a balance that funds only one deduction, not only sequential retries. A fake CAS failure must advance stored revision to represent a genuine concurrent write.

**Rule:** A server-only spender sharing a ledger with a client-callable legacy spender needs private server-minted event IDs, not IDs predictable from browser request IDs.

**Why:** Restricting the new RPC does not prevent a client from pre-seeding a predictable receipt through the old RPC.

**How to apply:** Persist an unguessable event ID before external work, omit it from public task data, and compare both owner and cost when accepting a duplicate receipt.

**Rule:** Recovery of paid generated files requires a durable output checkpoint before debit: retained bytes plus their verified integrity metadata, not only an upstream URL.

**Why:** Provider URLs expire. Treating a transient staged-file read as absence and falling back upstream can turn a recoverable paid result into a permanent provider failure.

**How to apply:** Persist the stage marker before settling. Once it exists, use only the retained file; missing, transient, or corrupt reads remain explicit recovery states. Test lost debit responses together with expired upstream output and a transient stage read.
