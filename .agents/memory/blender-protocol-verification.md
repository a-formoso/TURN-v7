---
name: Blender protocol verification
description: Why isolated browser, relay and desktop tests can all pass while the installed add-on fails.
---

Exercise the packaged desktop runtime against actual relay responses; independently handwritten endpoint fixtures do not establish interoperability.

**Why:** The desktop integration fixture put a render lease in the response envelope while the actual relay put it inside the job. Both isolated test suites passed, but the first real render failed after pairing succeeded. The installed desktop and the service ship independently, so fixing only the newest source add-on can leave the user's installed copy broken.

**How to apply:** Preserve compatible response fields for installed add-ons when possible. Verify claim parsing through the runtime, scene validation, completion/PNG/camera acceptance, failure and cancellation—not merely the HTTP client's ability to parse JSON. Make tests use the real relay serializer.

Keep browser-driven timeout settlement separate from wire-format fixes; it requires completion-recovery semantics, not just setting an expired job to failed.

**Why:** A completion intent receipt can exist before its result is fully published. Blindly marking the job failed conflicts with that immutable receipt; treating the receipt as a delivered PNG is also unsafe. A quick timeout transition was deliberately excluded from the compatibility repair.

**How to apply:** Design one terminal winner and interrupted-publication recovery before changing timeout ownership. Never delete authority receipts or automatically retry a render to get around the conflict.