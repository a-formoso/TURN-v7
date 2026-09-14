---
name: Headless logic verification
description: How to verify app/*.jsx logic in this repo when the UI is auth-gated
---

The app's departments sit behind a sign-in gate whenever cloud auth is configured, so an unauthenticated app screenshot reaches only the landing page. It cannot verify a user's saved film or authenticated workflows.

**How to apply:** verify non-UI logic by running `npm run build`, then loading the transpiled `dist/app/*.js` files into a `vm` sandbox in node with stubs for `window`, `React` (createElement/hooks as no-ops), and `document`. The files are plain global-scope scripts, so they load in dependency order (e.g. spine.js before consumers of `window.turnInfo`) and pure helpers can be called directly against the sample data globals (`PROJECT`, `SCENES` from story-data.js).

**Why:** the production build doubles as a syntax check (Babel parses every app/ file), and the sandbox run exercises real transpiled code instead of a re-implementation.

Isolated rendering of the real component tree with the real stylesheet can still verify responsive geometry without accessing authenticated data, but layout checks must include the actual mounting parent.

**Why:** A landing-page screenshot misses in-app layout failures. A standalone section also misses incorrect placement above its card heading or outside the padded card body. Headless Chromium's window-size argument can clamp narrow windows, silently invalidating a phone-width test.

**How to apply:** Render the real parent card with synthetic inputs and its real stylesheet, not just the changed section or a recreated wrapper. Assert DOM containment and ordering as well as geometry. Explicitly emulate the device viewport and assert the actual innerWidth. Clearly distinguish isolated component checks from a full authenticated walkthrough.

Clipboard browser tests need document focus as well as clipboard permissions.

**Why:** A headless page can remain unfocused after navigation even when a synthetic click succeeds. Its clipboard read then fails with NotAllowedError, falsely suggesting that copying is broken.

**How to apply:** Bring the tested page forward, explicitly emulate focus, and assert document.hasFocus() before testing the real clipboard. Test blocked-clipboard fallbacks separately; do not replace the successful-copy path with a mock.

Browser-control tests must reproduce native event timing, not just dispatch a key name or read a rectangle immediately after scrolling.

**Why:** Native summary activation needs the browser's complete Enter event sequence, and native disclosure notifications are queued. An immediate Escape can precede a listener installed only by that notification. Virtualized cards can also shift between scrolling and the next paint, directing a coordinate click to a different control.

**How to apply:** Focus the actual on-screen target and use complete native keyboard input. Assert hit targets after layout settles before pointer clicks. Keep fast dismissal tests: opening a menu must make its dismissal handling ready immediately, not after a deferred notification.

Lifecycle tests that stub the persistence boundary do not establish storage guarantees.

**Why:** A cancelled UI result and a cancelled database write are different outcomes; a storage upload can also succeed while its database record fails.

**How to apply:** Exercise the real persistence adapter against a recording fake service, inject failures and cancellations across awaits, and inspect stored records and deletion paths as well as the returned status. Never infer live-provider billing or access-policy behavior from these tests.

Also: heuristic checks (keyword/substring matching against free-text fields) must never report a confident "verified/ok" status — reserve "ok" for exact, deterministic matches and report fuzzy matches as a distinct advisory status. A code-review round rejected the first version of the Story Contract climax check for exactly this.

Real UI plus real runtime is still insufficient when fixtures supply fields the app's producer never supplies.

**Why:** A browser test injected a persisted film id into story metadata. It passed the full simulated generation flow while the actual card could not start even its first preview.

**How to apply:** Match the production producer's input shape and separate context sources, not the consumer's desired shape. Include missing-field cases for optional metadata; never manufacture required identifiers merely to make a fixture run.

Asset-copy tests must cover both cold signed URLs and warm browser blob URLs through the real upload adapter, not only newly generated inline images.

**Why:** A loader's display URL is not necessarily a valid upload payload. Inline-only inputs and mocked successful commits hid a source-copy failure before the first paid render.

**How to apply:** Keep the loader, conversion, upload and commit contracts real; substitute only the external transport. Verify exact copied bytes, durable readback, failure details and zero generation when source preparation fails.

Cross-process bridges need a shipped-client handshake test, not just passing
tests for each endpoint.

**Why:** Separately valid relay and renderer tests can miss how a client adopts
its pairing credential, while permissive schema/hash stubs hide incompatible
scene payloads. A real render establishes neither authenticated transport nor
safe acceptance by the browser.

**How to apply:** Exercise pairing through upload using the packaged client and
record only the fake transport boundary. Keep the real validators, signatures,
and lifecycle code; include a cross-language canonicalization corpus.

An HTTP success response and a valid ZIP are not enough to verify a download from an embedded preview.

**Why:** Preview navigation handling can open an archive as an external webpage even when the original link has a download attribute. A subsequent fetch-to-Blob approach passed the isolated browser test but still reported “Failed to fetch” in the user's preview. A successful server response does not establish either browser operation.

**How to apply:** Exercise the actual download control in a browser, including an embedded context with document-link interception. Check the browser-saved filename and bytes, unchanged page location, and error/retry paths. For small installers carried with the page, also force runtime fetch to fail and assert zero download-triggered requests; generate the embedded data from the real package, not a synthetic fixture. Distinguish this simulated embedding check from verification inside the user's actual preview wrapper or Mac browser.
