---
name: Server-only storage namespaces
description: Preserve the access boundary for internal authority receipts in the existing assets bucket.
---

Internal authority records must remain inaccessible to all ordinary authenticated
roles, including project owners. A private-looking first path segment alone is
not an access boundary.

**Why:** The live Storage read/delete policies resolve project access from the
second folder's UUID; deletion does not require the first folder to equal the
caller. A path like `private/<project UUID>/...` would still be deletable by an
art director. Invalid UUIDs resolve to no project. This matters for anti-replay
receipts: authenticated encryption of client-editable metadata proves integrity,
not freshness, and deleted receipts could revive previously revoked authority.

**How to apply:** Keep the internal namespace's second segment non-UUID and verify
the current policies before changing Storage access or moving these records.
Only server code may manage the receipts. Any future expiry cleanup needs an
explicit argument that replayed old metadata can no longer regain authority.