---
name: VM sandbox timers
description: Timer and stubbing quirks when testing dist builds in node vm suites.
---

**Rules for the node vm test sandboxes (scripts/test-*.mjs):**
- Sandbox `setTimeout` must keep sub-1000ms timers REF'd — unref-everything makes node exit with "unsettled top-level await". Timers ≥1000ms should be unref'd so module-load timers (4s/6s flush passes) neither hold node open nor fire mid-test.
- Sandbox `setInterval` should be a no-op (patrol loops would otherwise run forever).
- Stub cloud.jsx's client by setting `window._sbClient` directly; `_turnCreditShape` accepts `{credits:N}` rows.
- Poll stubs route by `statusUrl` via a `pollResponses` map with a gated default.

**Why:** these took multiple failed runs to discover; they apply to any future suite that loads dist builds with module-scope timers.
