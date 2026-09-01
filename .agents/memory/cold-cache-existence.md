---
name: Sync asset cache is cold in cloud mode
description: Existence checks that gate credit-spending generation must await the async asset loader; the sync cache is empty right after a reload or film switch.
---

**Rule:** never decide "this asset is missing → generate it" from the synchronous image cache alone. In cloud mode that cache is deliberately empty after a page reload or film switch until the background prefetch completes. Any auto-build/auto-generate decision must confirm absence through the async loader (which waits for an in-flight prefetch) before spending credits. The sync cache is fine as a cheap pre-filter — the async check is the authoritative one, done inside the per-asset lock.

**Why:** a user who acts promptly after a reload would otherwise silently regenerate (and pay for) every "missing" asset that actually exists in storage. This got a task rejected in completion review.

**How to apply:** any pipeline that generates on absence — sheet auto-builders, staging drafts, pre-render checks. Display-only code may keep using the sync cache.
