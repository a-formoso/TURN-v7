---
name: Image-gen registry ownership
description: Rules for the shared per-id generation registries (__nbGenInflight etc.) — gen-id keying, run tokens, re-check after every await
---

The shared image-generation registries (`__nbGenInflight`, `__nbGenCancel`, `__nbGenAbort`) are keyed by the **GEN id** (the `id` passed to `useImageGen`), never by the reference-slot key (`"locref-"+id`, `"charref-"+id`, …).

**Why:** every batch remount-safety guard once checked the slot key — dead code — so a card remounting mid-batch (opening the viewer) re-fired generate on completion: two near-identical versions and double credit spend per sheet. Character state sheets use `c.id+":"+st.id` as gen id; props' owner-prerequisite phase runs under the OWNER's id, so the prop id needs a separate cross-instance lock (`__nbOwnerPhase`).

**How to apply:**
- Any new "is this entity generating?" check must read the registry under the gen id (and any companion phase locks), not the slot id.
- Any async PRE-generate phase (prop owner prerequisite, staging auto-draft) runs while the registry is still empty, so it needs its own cross-instance window lock (`__nbOwnerPhase`, `__nbStagePhase`) held through the phase, AND the batch guard must treat that phase as in-flight. The run announces itself via `nb-gen-start` right after registering — cards mounted during the phase rely on it for their spinner and for the batch's gening true→false advance detection.
- `__nbGenInflight[id]` holds a per-run token, not `true`. After **every** await inside the generate path (pre-generate gate, meta/attachment assembly, the request itself, post-meta), re-check `__nbGenInflight[id]===myToken` before spending, committing, mutating shared registries, or firing events — a Stop or a newer run for the same id may have taken over during the await. Non-owners must vanish silently.
- `nbCommit` returning `tier:"stale"` (film scope moved) must be treated as a cancellation: no state install, no `nb-gen-done` (it would paint into the other film's same-id card and advance its batch); announce `nb-gen-cancel` so remounted spinners clear.
- Local history writes (commit/revert/delete-version/clear) are serialized per asset id via `_nbSerial` — new read-modify-write asset ops must go through it, and a wrapped op must never call another wrapped op on the same id (deadlock).

**Refinement (Sep 2026):** passive pre/post checking of __nbGenInflight is not enough for a secondary writer (e.g. storyboard panel repair) — it must CLAIM the id with its own token before any await and fire nb-gen-start, so batch guards and double-taps see it; release only if still owner; a lost token means a newer run owns the UI events.

**Coalescing coordinator refinement (Sep 2026):** when multiple paths can redraw-and-commit the same derived asset (e.g. a sheet composited from frames), passive gating is not enough — use one module-level single-writer coordinator per asset id that coalesces late requests (boolean `again`), snapshots inputs before each draw, and NEVER commits after detecting invalidation on ANY pass, including after a commit completed (go around again so storage ends on newest inputs). Busy UI gates must still forward requests into the coordinator (fire-and-forget) or late change events are silently lost.

**Cancellation test rule:** exercise Stop A → start B for the same id → resume A, not only Stop A → resume A with an empty registry.

**Why:** truthiness checks passed Stop-only tests but treated a replacement run's marker as ownership, allowing the cancelled run to spend and clear the replacement's entry.

**How to apply:** defer capability/provider/commit awaits and replace ownership while they wait. Assert that the superseded run cannot submit, commit, announce completion, or clear the new token.
