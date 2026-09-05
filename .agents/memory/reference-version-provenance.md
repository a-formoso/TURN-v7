---
name: Reference version provenance
description: Truthful version labeling for generated-image reference records and historical Details views
---
Every persisted project reference must record the source asset version used by that generation. Historical image versions must retain and display their own reference arrays rather than inheriting the current generation’s references.

**Why:** A stable entity ID identifies an asset across regenerations, but it does not identify the pixels the model actually saw. Showing only the current asset or current reference list can misstate generation provenance.

**How to apply:** Capture source version and generation time when assembling refs, persist them beside the snapshot and ref ID, carry refs through version history, and anchor Details to the selected generation.

When an exact old snapshot is unavailable and the UI resolves the current project asset as a fallback, preserve both identities and label them explicitly, such as “used v4 · showing current v5.”

**Why:** The original version remains the truthful provenance fact, while the displayed recovery thumbnail may contain newer pixels.

**How to apply:** Never overwrite the recorded used version with the live version or label a live fallback as the historical input. Keep separate used and resolved version fields.