---
name: Screenplay image recovery
description: Why image-reference jobs need a real recovery-storage reservation before spending.
---

Lossless screenplay pages can make job metadata larger than browser recovery storage permits. Keep one exact byte copy and reserve actual writable capacity before submitting, including concurrent launches, ledger slots and provider-returned record overhead.

**Why:** A small-looking thumbnail is a full PNG in JSON. Duplicating it in source, input and settings metadata can exhaust storage after the provider has already accepted a paid job. An in-memory byte estimate misses a full browser store; a reservation sized only from pre-submit fields misses the provider's returned URLs. Truncating a full job ledger loses someone else's recoverable render.

**How to apply:** Test actual storage denial and full-ledger behavior, not only an oversized single image. Fail before spending when reservation is unavailable. If storage unexpectedly fails after submission, warn clearly and keep live polling and settlement; never abandon or resubmit the paid job.

Browser-to-proxy input provenance is not the same as a provider-facing signed URL.

**Why:** The independently deployed proxy may stage identical bytes behind a temporary URL it does not return. Store exact source bytes and honest input-position provenance instead of inventing a final provider URL.