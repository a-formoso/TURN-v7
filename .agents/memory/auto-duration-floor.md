---
name: Auto duration derives from the validating plan
description: The Stage composer's automatic clip duration must come from the same timed plan that later validates it, and pickers must not offer values that plan would refuse.
---

**Rule:** compute the automatic duration as `max(clip runtime, timed plan minimumSec)` where the plan is built WITHOUT a requested duration; validate explicit overrides against that same plan. Never clamp auto to the model maximum (the over-duration blocker must speak), never offer picker values below the floor (composer chip, slider, Render-settings select all share the floor), and clear the override (store null) whenever a picker lands on the auto value so a later timing change re-follows auto.

**Why (Sept 2026):** auto duration was the summed shot runtime (10 s) while validation used the timed plan (needed 15 s after a mis-timed beat-level fallback), so a fresh clip opened with Generate greyed out and a "needs at least 15 seconds" notice the user could not act on.

**How to apply:** any new duration source (imported video length, model presets, plan changes) must flow through the same floor variable; a floor with two definitions is a blocker the UI can't explain.
