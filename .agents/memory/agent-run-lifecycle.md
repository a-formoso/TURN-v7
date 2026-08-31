---
name: Agent run lifecycle & ownership
description: Rules for long agent runs — cancellation, ownership, mid-run edits, persistence keys.
---

Long agent runs (minutes, many awaits) need four disciplines beyond a start-of-loop cancel check:

1. **Ownership is part of cancellation.** A run belongs to the film/project it started in. Guarding only the *commit* is not enough — the run keeps burning model calls and reading the newly-opened project's globals. Fold `ownerProjectId !== current` into `ctx.cancelled()` itself, and expose a separate `switchedFilms()` so stop messages can say what happened.
2. **Re-check cancellation after EVERY await, before any mutation/sync/persist.** A guard before an awaited call still commits its result if Stop lands while the call is in flight. Review round caught this twice.
3. **Detect mid-run external edits by signature, not assumption.** Keep a Set of signatures of every state the run itself wrote (seeded with run-start state); at commit time, a live state outside the set = someone edited mid-run → snapshot the live state to the undo stack first and warn once. Sign the exact objects written (post-transform), or idempotency mismatches cause false positives.
4. **Capture persistence keys at run START, not save time.** Saving "per current project" at completion attributes a run's output to whatever project is open then. Same for any global-keyed localStorage: use one store with a global size budget + oldest-first eviction so deleted projects age out without hooking deletion paths.

**Why:** Writers' Room audit (2026-08-31) found all of these live: adaptation writing into the wrong film after a switch, approved proposals silently overwriting mid-run user edits, and reports saved under the wrong film.

**How to apply:** any new agent, background loop, or run-scoped persistence in this app — and check `vm` quirk: deleting a property on the outer vm context object does NOT remove a global set inside the vm; assign `undefined` instead in headless tests.
