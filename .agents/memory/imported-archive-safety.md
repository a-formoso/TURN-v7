---
name: Imported archive safety
description: Prevent duplicate source archives from becoming public or bloating project delivery.
---

Remove source-import archives after extraction, and use an explicit public-file allowlist when the application server reads from the project root.

**Why:** Import archives, CLI state, uploads, project notes, and package files can contain source or connection metadata. A hidden-file blocklist misses non-hidden sensitive paths, while an archive can also create a large LFS upload.

**How to apply:** During imported-project setup, keep only extracted runnable files, remove archive-specific LFS rules, serve only required app assets, and verify representative project metadata paths are denied.