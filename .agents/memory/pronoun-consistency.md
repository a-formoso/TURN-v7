---
name: Pronoun / gender consistency
description: Why "canon unset" defeats both prompt guidance and drift audits, and the three-layer fix pattern (generation, articulation, audit) for character gender consistency.
---

# Pronoun consistency — the unset-canon trap

Character gender consistency depends on `character.pronouns` (canonical sheet field, Cast-panel editable). `charPronouns()` resolves explicit value → keyword inference (cameoInferGender) → "" (unset).

**The trap:** every safeguard keyed on a NON-EMPTY canonical value. When pronouns were unset and inference neutral, castPronounBlock printed a soft "refer by NAME only" line (models ignore it) and the agents.jsx drift check required `canonPron` non-empty, so a script calling a woman "he" contradicted nothing and was never flagged.

**Why:** a comparison-based audit (`scriptPron !== canonPron`) silently passes when one side is blank. Any "X vs canon" enforcement needs an explicit unset-canon branch, or the blank state is a blind spot.

**How to apply:**
- Generation prompts: unset pronouns = HARD-ERROR wording ("gender undecided: NAME only; writing he/she/they for them is a hard error"), never a soft suggestion.
- Character articulation (aiDraftCharacter / aiCastPsychology): the model returns validated `he/him|she/her` with the story context it already has; merge NEVER overrides an explicit sheet pick. Depth budget excludes orbit-3 characters from the batch pass entirely — don't expect them to get pronouns there.
- Drift audit (agentScriptBreakdown): a script-assigned gender with unset canon triggers a "settle the sheet" proposal; rejection directs the user to the Cast panel + Consistency Check rewrite.
- Regression coverage: scripts/test-cast-pronouns.mjs (vm sandbox, stubbed window.claude.complete, runs the real minified aiCastPsychology — replicated merge logic in test code would not have caught the TDZ bug this suite now guards).
