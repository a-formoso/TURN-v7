---
name: Image-gen prompt overrides
description: Overriding the frame prompt for useImageGen must cover every builder the hook can call
---
The shared image-gen hook has THREE prompt entry points: buildFinal (fresh render), buildFromBase (seeded/chained render), and buildSimple (the automatic "no image" recovery retry). Any surface that substitutes a user-edited prompt must override ALL three.

**Why:** review-caught bug (2026-09-03, Stage Image tab): only buildFinal/buildFromBase were overridden, so a failed render's automatic retry silently re-generated from the derived shot prompt — spending credits on a prompt the user never asked for.

**How to apply:** when wrapping the shared shot-frame config (shotFrameGenOpts) or any useImageGen opts with a conditional prompt substitution, grep the hook for every `opts.build*` call site and route each through the same edited-vs-derived decision.
