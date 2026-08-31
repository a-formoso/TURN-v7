---
name: Headless logic verification
description: How to verify app/*.jsx logic in this repo when the UI is auth-gated
---

The app's departments sit behind a sign-in gate whenever cloud auth is configured, so screenshots can only reach the landing page — UI-level verification of in-app features is not possible headlessly.

**How to apply:** verify non-UI logic by running `npm run build`, then loading the transpiled `dist/app/*.js` files into a `vm` sandbox in node with stubs for `window`, `React` (createElement/hooks as no-ops), and `document`. The files are plain global-scope scripts, so they load in dependency order (e.g. spine.js before consumers of `window.turnInfo`) and pure helpers can be called directly against the sample data globals (`PROJECT`, `SCENES` from story-data.js).

**Why:** the production build doubles as a syntax check (Babel parses every app/ file), and the sandbox run exercises real transpiled code instead of a re-implementation.

Also: heuristic checks (keyword/substring matching against free-text fields) must never report a confident "verified/ok" status — reserve "ok" for exact, deterministic matches and report fuzzy matches as a distinct advisory status. A code-review round rejected the first version of the Story Contract climax check for exactly this.
