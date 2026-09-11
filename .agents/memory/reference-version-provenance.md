---
name: Reference version provenance
description: Reference version identity, truthful historical Details, and safe permanent-image copy cleanup
---
Every persisted project reference must record the source asset version used by that generation. Historical image versions must retain and display their own reference arrays rather than inheriting the current generation’s references.

**Why:** A stable entity ID identifies an asset across regenerations, but it does not identify the pixels the model actually saw. Showing only the current asset or current reference list can misstate generation provenance.

**How to apply:** Capture source version and generation time when assembling refs, persist them beside the snapshot and ref ID, carry refs through version history, and anchor Details to the selected generation.

When an exact old snapshot is unavailable and the UI resolves the current project asset as a fallback, preserve both identities and label them explicitly, such as “used v4 · showing current v5.”

**Why:** The original version remains the truthful provenance fact, while the displayed recovery thumbnail may contain newer pixels.

**How to apply:** Never overwrite the recorded used version with the live version or label a live fallback as the historical input. Keep separate used and resolved version fields.

Permanent removal of one image is not authorization to clear its whole asset history or promote another old image into its place. Deliberately deleted reference evidence must never recover a live or previous image as a fallback.

**Why:** Removing an obsolete continuity image should not quietly reintroduce a different obsolete frame, or erase unrelated versions and video takes. Reference snapshots can also be separate stored copies of the selected pixels.

**How to apply:** Bind deletion to an exact source version, detach its incoming-reference consumers, preserve unrelated history, and purge only provably matching snapshots in the authorized film. Keep explicit deleted provenance.

Cross-row snapshot cleanup must remain resumable after any interrupted write, and incomplete storage deletion needs a reachable retry even after the current thumbnail disappears.

**Why:** Removing a reference pointer before retaining its storage path can orphan a copy permanently; clearing the source image can otherwise remove the only UI control capable of retrying cleanup.

**How to apply:** Preserve exact cleanup paths durably alongside deleted reference evidence, recover them on retries, merge newly discovered copies into the cleanup ledger, and report incomplete cleanup rather than success.

Permanent-deletion receipts belong to the asset's lifetime, not just its current generation. Restoring a retained version or replacing generation metadata must not erase them.

**Why:** Otherwise a routine history restore can erase the only proof that a different version was permanently removed, allowing a late reference-copy commit to reintroduce it.

**How to apply:** Preserve the immutable receipt union through metadata replacements without reviving completed cleanup paths or old current-version stamps. Fence reference copies after their commit as well as before it; an earlier check alone leaves a scan/write race.