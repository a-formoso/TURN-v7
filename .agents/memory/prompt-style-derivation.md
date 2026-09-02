---
name: Explicit style vs auto derivation
description: Stage video prompts — how explicit user style picks must bypass the auto director-brief chain, and how prompt scope follows the model.
---

Rule: any user-facing "style/structure" pick for a derived prompt must carry an explicit flag through the builder that BYPASSES every auto-derivation branch. A fallback `||` chain after an always-non-empty auto builder is dead code — the named recipe ids on the Stage were inoperative for months this way.

**Why:** `seedanceMicroBeatDirectorPrompt` always returns text, so `auto || recipe` never reached the recipe; on 2.5 a wholeScene override also ignored the id. Discovered 2026-09-02 while wiring the Prompt-style menu.

**How to apply:** pass `opts.explicitStyle` into `seedanceRecipePrompt`; explicit routes to the named grammar, auto keeps the researched briefs. Two more traps that survived review:
- Prompt SCOPE follows the model (2.5 = whole scene, 2.0 = one beat), so `modelId` is a real dependency of any effect that rebuilds an untouched prompt box — omit it and a model switch ships the wrong scope under the right label.
- An explicit pick intentionally overwrites a hand-edited box (`promptEditedRef` cleared): the click is the request; Reset-to-script remains the way back.
