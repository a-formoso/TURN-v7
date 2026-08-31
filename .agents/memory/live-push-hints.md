---
name: Live push is hints, server is truth
description: Rules for the per-film realtime channel (doc-rev / member-removed broadcasts) and the poll fallback.
---

The film's realtime channel carries HINTS, never authority.

**Rules:**
- A broadcast may only trigger a re-check (rev probe, access probe); the server's own answer decides. A forged/lost message must never change state by itself — access ends only on a definitive "zero rows, no error" probe, never on an error (blips must not eject users).
- Doc-save broadcasts don't cover permission changes: membership/role edits bump no doc `_rev`, so they need their OWN announcement or the relaxed poll leaves stale access visible for the safety-probe interval.
- The poll never fully stops: while push is healthy it relaxes (~60s safety probe) to cover clients that don't broadcast; any channel error restores full cadence via `turnPushHealthy`.

**Why:** reviewer FAILed the first round of live sync precisely because removal emitted no event and the healthy-push branch had relaxed the poll — removed collaborators kept an editable UI for up to ~60s.

**How to apply:** any new collaboration state (role changes, new share surfaces, stage media) that doesn't write the doc needs its own hint event + server re-verification on receipt.
