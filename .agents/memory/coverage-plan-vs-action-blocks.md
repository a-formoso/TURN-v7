---
name: Coverage plan rows are not action blocks
description: Why a stored per-shot coverage plan (beatPlan.micro) must never be compared 1:1 with the screenplay's authored action blocks, and how complete vs partial renders differ.
---

**Rule:** a shot's stored coverage plan (`beatPlan.micro`) is an AI paraphrase of the beat, written when the shots were drafted. A row-count mismatch against the live beat's authored action blocks is paraphrase granularity, not evidence that the screenplay changed. Never block on it, and never fuzzy-match paraphrased rows onto authored blocks.

- A COMPLETE beat (the clip contains every shot of the beat) whose plan cannot be mapped 1:1 renders at **beat level**: the authored beat is the sole performance source, printed once in screenplay order; each cut carries its plan row as "Coverage" (navigation only) plus its Shots-tab staging, camera, composition, intent and directives.
- The beat-level decision is made ONCE per beat: if any peer is unmappable, every cut of that beat is beat-level. Deciding per shot lets a mapped peer perform its blocks a second time beside the beat-level block.
- A PARTIAL render (not the whole beat) has no beat-level fallback — it must know which blocks are its own — so it blocks with a message naming the plan-row count vs authored-block count (or out-of-range covers).
- Beat-level cuts are TIMED against their coverage rows, else their own staging line; never against the whole beat per cut (that budgets the beat N times and raises a false over-duration blocker). The timed planner also refuses a beat-level panel's `text` as a per-cut action.
- Identical per-shot blocker messages are printed once in the prompt (BLOCKED lines dedupe).

**Why (Sept 2026):** a real 3-shot beat with a 3-row plan and 6 authored blocks showed an orange "screenplay changed shape" blocker, three "BLOCKED:" lines in the prompt, and a 15 s minimum for a 10 s clip — none of it true.

**How to apply:** any new check that compares stored shot metadata with the live screenplay must first ask whether the metadata was authored (covers, blocks) or paraphrased (plan rows), and must distinguish complete-beat from partial renders.
