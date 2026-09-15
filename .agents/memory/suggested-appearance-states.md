---
name: Suggested appearance states are hard Stage requirements
description: MUSE-suggested but never-generated character appearance states block Stage renders; resolve with an explicit per-character bulk "use master" choice, never automatic substitution.
---

**Rule:** a shot that names a character appearance state requires that state's generated sheet. States that MUSE suggested from the script but were never generated (`state.suggested`, no versions) satisfy nothing, so every shot that names them blocks with a required-reference notice. Do not silently fall back to the master image — the user chose a state on purpose. Instead:

- Say plainly that the state was suggested and never generated, and where to generate it (Art Room → Characters → name → Continuity · appearance states).
- Offer an explicit bulk choice per character ("Use master for Shots 1–N") that writes the same per-shot override the per-row "Use master for this shot" button writes; show it only when 2+ shots miss the same state, and put it on the blocker banner only when exactly ONE character is affected (a banner button must resolve the banner, not one character of two).
- Respect read-only shares, in-flight generation, and a missing master (disable with a reason); never write character canon or state data from Stage.

**Why (Sept 2026):** a real beat had three shots naming a suggested, never-generated state; the only path was three separate clicks with no explanation of why the state was "unavailable".

**How to apply:** any new reference kind with a per-shot required-state rule should reuse the choices panel's bulk-group pattern instead of adding an automatic fallback.
