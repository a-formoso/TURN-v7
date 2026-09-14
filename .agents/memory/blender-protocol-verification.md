---
name: Blender protocol verification
description: Why isolated browser, relay and desktop tests can all pass while the installed add-on fails.
---

Exercise the packaged desktop runtime against actual relay responses; independently handwritten endpoint fixtures do not establish interoperability.

**Why:** The desktop integration fixture put a render lease in the response envelope while the actual relay put it inside the job. Both isolated test suites passed, but the first real render failed after pairing succeeded. The installed desktop and the service ship independently, so fixing only the newest source add-on can leave the user's installed copy broken.

**How to apply:** Preserve compatible response fields for installed add-ons when possible. Verify claim parsing through the runtime, scene validation, completion/PNG/camera acceptance, failure and cancellation—not merely the HTTP client's ability to parse JSON. Make tests use the real relay serializer.

Interoperability fixtures must enter through the same workspace/shot-opening actions as the browser, without manually inserting the state those actions are supposed to create.

**Why:** A fixture that pre-populated a second shot hid a broken location-reuse workflow even while real desktop rendering and transport passed. Auth/provider fakes are useful boundaries; faking application-owned transitions is not equivalent.

**How to apply:** Create/select both shots through the real browser request contract, preserve a manually edited first-shot camera, and verify the packaged desktop can open the newly added shot without resetting existing content.

Keep browser-driven timeout settlement separate from wire-format fixes; it requires completion-recovery semantics, not just setting an expired job to failed.

**Why:** A completion intent receipt can exist before its result is fully published. Blindly marking the job failed conflicts with that immutable receipt; treating the receipt as a delivered PNG is also unsafe. A quick timeout transition was deliberately excluded from the compatibility repair.

**How to apply:** Design one terminal winner and interrupted-publication recovery before changing timeout ownership. Never delete authority receipts or automatically retry a render to get around the conflict.

Treat server pairing registration, desktop response processing and visible Blender status as separate evidence.

**Why:** Successful desktop polling can coexist with a sidebar still displaying Connecting: changing Python runtime state does not request a Blender UI redraw. A stored pairing also survives a lost desktop session until revoked or expired.

**How to apply:** Do not label a browser pairing check as proof of live desktop readiness. Test main-thread redraw and timer recovery separately from HTTPS interoperability; never access Blender UI from a network worker.