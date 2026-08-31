---
name: Spine scene-kind markers
description: assignPlotPoints wipes and reassigns all scene kinds positionally — audits or features that depend on a kind must plumb a declared marker through the build path.
---

**Rule:** `assignPlotPoints` (agents.jsx) starts by resetting every scene's `kind` to
"normal" and then reassigns milestones by POSITION. Any audit or feature that treats a
scene kind as meaningful (e.g. the inciting-incident placement audit) is vacuous on the
build path unless the kind arrives as a real declaration that `assignPlotPoints`
explicitly preserves.

**Why:** A code review caught the inciting-incident audit auditing its own positional
guess — the spine builder never returned an incite marker, so a "late inciting incident"
could never fire on a freshly built story. The fix threaded a model-declared `"incite":N`
through spineBatch → aiBuildSpine (stamped pre-sort for object identity) → the adaptation's
newScenes construction → a `declaredIncite` carve-out in assignPlotPoints.

**How to apply:** Before auditing any scene `kind`, trace where that kind is set on the
BUILD path (not just the hand-edit path). If it's assigned mechanically, either make the
builder declare it and preserve the declaration, or accept the audit only catches
hand-edited spines and say so. AI-classification passes (e.g. the fusion check) must also
validate returned scene numbers against the real scene set and require coverage before
computing ratios — models hallucinate scene numbers.
