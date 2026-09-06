---
name: Background commits need the start-time epoch
description: Non-interactive generation pipelines must scope their asset commit to the film epoch captured at request start, and treat a stale refusal as a quiet discard.
---

**Rule:** any non-interactive generate→commit flow must capture the film epoch BEFORE the request starts, pass it into the asset commit, and CHECK the result — a stale refusal is a quiet discard: no done event (same-id cards in the newly opened film must not adopt the image), cancel event if a spinner was announced, no failure toast into the film the user is looking at now.

**Why:** entity ids repeat across films, and the commit layer resolves scope at COMMIT time unless given an epoch. A pre-start gate check is worthless for this — the dangerous window is DURING the generation. And passing the epoch is only half the rule: ignoring the refusal and firing the done event anyway re-creates the corruption at the event layer.

**How to apply:** whenever adding an automatic/background image pipeline that bypasses the interactive hook (bootstraps, auto re-bakes, on-demand builders).

**Refinement (Sep 2026):** entry-time epoch validation in the commit primitive is not enough — every internal await (image-dimension decode, the cloud write itself, local history reads) is a window where the film can switch. Re-check the epoch after each await; capture scope+uid at the validated moment and never re-resolve them; on post-write staleness leave the session caches untouched (they belong to the new film) and return stale. Also: a commit returning tier:"error" means NOTHING persisted — callers must treat it as a failed operation (no unlock, no done-event), never as success.

**Every commit entry point needs the epoch (Sep 2026):** it's not just AI generations — ANY path that awaits before committing an asset (file uploads/imports read + decode, sheet composes) must capture the film epoch before its FIRST await and pass it to the commit, or a film switch mid-wait writes under the same entity id into the wrong film. When adding a new commit call, grep the existing ones: a call without the epoch arg is almost certainly a bug, not a simpler case. Cancellation is the sibling concern: pass a live cancelled-predicate into persistence. Never interpret a post-write cancellation as proof that nothing was saved.

**Rule:** Stop must either safely compensate a completed write or explicitly report that cancellation could not be confirmed. UI suppression is not storage cancellation. Successful durable saving and failed cleanup are separate outcomes.

**Why:** A network mutation can succeed despite a failed response; restoring an old row after its history files were trimmed can also corrupt that history. Cancellation must not erase a collaborator's intervening approval or edits.

**How to apply:** Compare the complete prior row when mutating or compensating. Preserve uncertain writes until verified. Keep cleanup work durably tracked and discoverable even after its card is deleted; do not classify cleanup failure as an unsaved image or trigger another paid generation.
