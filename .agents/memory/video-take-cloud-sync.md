---
name: Video take cloud sync
description: How Stage video takes persist to the cloud — ledgers, scope guards, and the shared poll lease.
---

**Design:** take records ride the existing `turn_generations` table (entity_id = `clip-…`, storage_path NULL, `meta={kind:"video",video:{...}}`). Every take write — commits, approvals, notes, restores, deletes, clears — must reach the cloud, not just mem/IDB.

**Ledgers (localStorage, per project):**
- `turn_vid_dirty` — failed pushes; flushed before hydrate, dirty ids win over cloud rows.
- `turn_vid_ids` — known clip ids per project, maintained at push time (intended membership even when the push fails). Hydrate sweeps ONLY ledger ids missing from the authoritative cloud answer and not dirty. **Never blind-sweep IDB** — it is shared across films, and local-mode films' takes would be eaten.

**Scope guards:** every queued take mutation captures `vidScope()` at click time and re-checks at execution (`_vidScopeSame`); commits carry scope through to `_vidCommitRaw`, which returns `{skipped:true}` on mismatch (caller keeps the job pending for project-scoped recovery). `vidClear` still cloud-deletes the OLD film's row via captured scope but skips local deletes after a switch.

**Poll lease:** `_vidPollLease` (requestId Set) is claimed in try/finally by BOTH the live generate loop and each recovery pass — load pass, 5-min patrol, and concurrent calls must never double-commit one finished render. The lease is per-tab; cross-tab dedupe is the spend event id + idempotent commit.

**Why:** four architect review rounds found each of these as real money/data-loss paths; the patterns above are the agreed fixes.
