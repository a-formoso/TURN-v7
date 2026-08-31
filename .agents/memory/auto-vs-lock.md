---
name: Auto vs writer lock
description: Per-scene "auto" settings must never be silently persisted by a generative pass; writer locks must reach every prose entry point.
---

**Rule:** When a scene/story setting has an "Auto — MUSE picks per pass" state and a
writer-locked state, no generative pass may (a) persist its own pick for an Auto scene
(that silently hardens Auto into a lock) or (b) overwrite a valid writer lock. And a
locked setting must be injected into EVERY prose-writing entry point — full draft,
polish, beat authoring, and targeted gap-fills like "write missing beat" — not just the
main drafter.

**Why:** Code review caught scene authoring persisting the model's conflict-mode pick
(turning Auto into a lock) and the missing-beat writer skipping the mode brief entirely.
The same shape appeared earlier with Story Contracts (model suggestions carry
`suggested:true`; hand-declared ones are never overwritten).

**How to apply:** For any new per-scene craft setting: respect an existing valid value in
prompts, never write it back from a generative pass unless the feature is explicitly a
suggestion (then flag it), grep for ALL functions that produce screenplay blocks and
inject the brief in each, and normalize unknown stored values to Auto in the UI select.
