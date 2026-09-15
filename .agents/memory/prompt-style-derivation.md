---
name: Explicit style vs auto derivation
description: Stage video prompts — how explicit user style picks must bypass the auto director-brief chain, and how prompt scope follows the model.
---

Rule: any user-facing "style/structure" pick for a derived prompt must carry an explicit flag through the builder that BYPASSES every auto-derivation branch. A fallback `||` chain after an always-non-empty auto builder is dead code — the named recipe ids on the Stage were inoperative for months this way.

**Why:** `seedanceMicroBeatDirectorPrompt` always returns text, so `auto || recipe` never reached the recipe; on 2.5 a wholeScene override also ignored the id. Discovered 2026-09-02 while wiring the Prompt-style menu.

**How to apply:** pass `opts.explicitStyle` into `seedanceRecipePrompt`; explicit routes to the named grammar, auto keeps the researched briefs. Two more traps that survived review:
- Prompt scope and timing follow the selected clip plan and model budget, so both are real dependencies of effects rebuilding an untouched prompt. Neither model implies whole-scene coverage.
- An explicit pick intentionally overwrites a hand-edited box (`promptEditedRef` cleared): the click is the request; Reset-to-script remains the way back.

**Scope ruling (user, 2026-09-02):** a Seedance 2.5 clip is ONE BEAT rendered as a sequence of shots (the Art Room micro-beat plan continued) — never the whole scene; whole-scene packing/prompting is retired (dormant branches only). A user-facing Clip scope choice also allows one clip per shot on either model. When packing per beat, only positive finite beat numbers may group shots — unassigned/zero beatN falls back to per-shot, or old projects without beat mapping silently recreate whole-scene clips.

**Packing decision:** fit each model's time budget at existing shot boundaries, preserving all selected coverage. Never shrink recorded speech or silently write a render's timing back to Art Room canon. An individually overlong shot needs an explicit authoring/revoice decision.

**Why:** automatic chopping would claim an audio-to-micro-beat alignment the project does not possess. Keeping derived clip timing separate also avoids overwriting the director's Art Room decisions.

Keep render grouping separate from camera coverage, and keep exceptional grouping choices out of the main prompt bar.

**Why:** A multi-cut example does not establish that a beat needs multiple separate renders, nor authorize changing continuous-shot defaults. The user wanted the routine Fit beat button removed, but removing the historical grouping route would hide older take groups.

**How to apply:** Preserve grouping preferences and old-take access in secondary settings. Evaluate a new prompt template separately; copying its numbered cuts must not invent or persist new Art Room shots.

Prefer a structured, source-backed default director's brief over copying a detailed example's scene facts or fixed cut count.

**Why:** On 2026-09-15 the user approved this recommendation after reviewing a scene-specific multi-cut example. Its useful structure should generalize; its pirate setting, photorealism, four cuts and numerical precision should not.

**How to apply:** Use canonical selected coverage, actual attachment roles, authored camera choices and approved look. Omit unknown facts. A prop inventory resolved at a shot's start is not proof of its ending owner after an authored handover.

Dialogue identity is an authored occurrence, not just its words.

**Why:** Repeated identical lines can have different speakers, delivery and assigned audio. Merging by text can silently exchange a visible line with a remote voice or message even when all words survive.

**How to apply:** Match canonical evidence first. Use text fallback only when unambiguous; explicit occurrence indices may disambiguate repeated words without selecting other occurrences.
