---
name: Semantic reference binding
description: Keep entity identity and scene appearance separate from human-readable asset labels and frame mentions.
---

Human-readable labels are presentation, not evidence of an asset's identity role. A frame named after a character is still a frame; a master sheet is not the scene's assigned appearance variant. Resolve character references using semantic identity and the selected shot's context, not whichever label happens to contain the character name.

**Why:** shot-frame labels often contain cast names. Name-based lookup could bind an actor mention to a room frame while overlooking the actual appearance reference. Attaching a master with an explicit mention also did not explain why a different, assigned state remained unavailable.

**How to apply:** distinguish master/state/frame labels in reference pickers, preserve explicit frame mentions, and test same-name collisions and multiple appearance states across shots. Do not silently treat an attached master as satisfaction of a different required state. Ensure image-loading dependencies follow appearance assignments, not just character IDs.

An unattached asset's prospective mention number is not its identity. Resolve visible chips only against included assets, and make both insertion and chip swapping attach the chosen asset before treating its tag as valid.

**Why:** several unselected images can legitimately share the next available number, while scene-wide choices append after the automatic package rather than following picker order. Treating prospective numbers as keys or current bindings can display or select the wrong image.

An explicitly requested shot-only master substitution in Stage is a video-input decision, not permission to rewrite the character's scene-wide appearance or regenerate existing stills.

**Why:** the user wanted to use an existing master for one video shot while preserving established Art Room continuity elsewhere. Expanding that choice to frame canon would alter unrelated outputs.

**How to apply:** keep this choice separate from ordinary attachments and mentions, preserve sibling-shot requirements in grouped clips, and allow returning to the scene appearance. Use reference provenance for the video choice rather than changing shared image-source stamps.