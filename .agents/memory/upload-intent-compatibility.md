---
name: Upload intent compatibility
description: Why optional upload-cleanup reservations must not strand paid images on older cloud backends.
---

Treat a confirmed missing upload-cleanup reservation capability separately from denied permission to store an image.

**Why:** The frontend began requiring a newer reservation RPC before uploading, while the connected backend still supported ordinary permission-checked image storage. Paid renders then remained unsaved in the browser. Compatibility is acceptable because Storage RLS still authorizes every upload and deletion; it does not grant additional access.

**How to apply:** Only positive evidence that the exact expected RPC signature is missing can select the legacy upload path. Authentication, authorization, mismatched signatures and network failures must still fail closed. Do not pretend an unreserved upload has an intent. Until the cleanup schema is installed, an upload interrupted by project deletion or access revocation can leave a private orphan the client cannot remove.

An already-open browser tab retains its old save code and its only copy of an unsaved render.

**Why:** Updating workspace scripts does not patch that JavaScript instance, and reloading clears the in-memory recovery queue.

**How to apply:** Protect the image with the existing download action before asking for a reload. Do not promise that a workspace fix saved the held image, or replace save recovery with a paid regeneration.