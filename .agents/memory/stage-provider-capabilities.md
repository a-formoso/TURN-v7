---
name: Stage provider capability handshake
description: Keep newly supported paid video options gated until the independently hosted proxy confirms support.
---

Treat provider documentation, browser capabilities, and deployed proxy capabilities as three distinct facts. A browser update must not assume the remote proxy was updated with it.

**Why:** the existing proxy silently limited Seedance 2.5 resolution after fal expanded support; the browser also retained an older direct-audio limit. Enabling options from documentation alone could charge for a request another layer downgrades or truncates.

**How to apply:** use the non-spending capability handshake before enabling newly expanded settings; keep established lower settings usable on an older proxy. Never probe capabilities with a render submission. Preserve explicit saved model choices, and never reinterpret old take metadata using the new default.

Provider price listings are baseline estimates, not universal job quotes: video inputs can change the multiplier and add input-duration billing. Verify current official pricing before expanding resolution or tier choices.