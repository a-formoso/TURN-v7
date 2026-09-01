---
name: Background commits need the start-time epoch
description: Non-interactive generation pipelines must scope their asset commit to the film epoch captured at request start, and treat a stale refusal as a quiet discard.
---

**Rule:** any non-interactive generate→commit flow must capture the film epoch BEFORE the request starts, pass it into the asset commit, and CHECK the result — a stale refusal is a quiet discard: no done event (same-id cards in the newly opened film must not adopt the image), cancel event if a spinner was announced, no failure toast into the film the user is looking at now.

**Why:** entity ids repeat across films, and the commit layer resolves scope at COMMIT time unless given an epoch. A pre-start gate check is worthless for this — the dangerous window is DURING the generation. And passing the epoch is only half the rule: ignoring the refusal and firing the done event anyway re-creates the corruption at the event layer.

**How to apply:** whenever adding an automatic/background image pipeline that bypasses the interactive hook (bootstraps, auto re-bakes, on-demand builders).

**Refinement (Sep 2026):** entry-time epoch validation in the commit primitive is not enough — every internal await (image-dimension decode, the cloud write itself, local history reads) is a window where the film can switch. Re-check the epoch after each await; capture scope+uid at the validated moment and never re-resolve them; on post-write staleness leave the session caches untouched (they belong to the new film) and return stale. Also: a commit returning tier:"error" means NOTHING persisted — callers must treat it as a failed operation (no unlock, no done-event), never as success.
