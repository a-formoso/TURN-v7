---
name: Headless logic verification
description: How to verify app/*.jsx logic in this repo when the UI is auth-gated
---

The app's departments sit behind a sign-in gate whenever cloud auth is configured, so an unauthenticated app screenshot reaches only the landing page. It cannot verify a user's saved film or authenticated workflows.

**How to apply:** verify non-UI logic by running `npm run build`, then loading the transpiled `dist/app/*.js` files into a `vm` sandbox in node with stubs for `window`, `React` (createElement/hooks as no-ops), and `document`. The files are plain global-scope scripts, so they load in dependency order (e.g. spine.js before consumers of `window.turnInfo`) and pure helpers can be called directly against the sample data globals (`PROJECT`, `SCENES` from story-data.js).

**Why:** the production build doubles as a syntax check (Babel parses every app/ file), and the sandbox run exercises real transpiled code instead of a re-implementation.

Isolated rendering of the real component tree with the real stylesheet can still verify responsive geometry without accessing authenticated data.

**Why:** A landing-page screenshot misses in-app layout failures. Headless Chromium's window-size argument can also clamp narrow windows, silently invalidating a phone-width test.

**How to apply:** Use synthetic component inputs, explicitly emulate the device viewport, and assert the actual innerWidth before interpreting geometry. Clearly distinguish isolated component checks from a full authenticated walkthrough.

Lifecycle tests that stub the persistence boundary do not establish storage guarantees.

**Why:** A cancelled UI result and a cancelled database write are different outcomes; a storage upload can also succeed while its database record fails.

**How to apply:** Exercise the real persistence adapter against a recording fake service, inject failures and cancellations across awaits, and inspect stored records and deletion paths as well as the returned status. Never infer live-provider billing or access-policy behavior from these tests.

Also: heuristic checks (keyword/substring matching against free-text fields) must never report a confident "verified/ok" status — reserve "ok" for exact, deterministic matches and report fuzzy matches as a distinct advisory status. A code-review round rejected the first version of the Story Contract climax check for exactly this.
