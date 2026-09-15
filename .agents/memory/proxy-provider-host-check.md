---
name: Provider host checks in the image-proxy
description: The fal key must only be attached to exact fal.run hosts; bare suffix tests leaked it.
---
# Provider host checks

Attach a provider key to an outbound request only when the URL is https AND the hostname is exactly the provider host or a subdomain of it (`hostname === "fal.run" || hostname.endsWith(".fal.run")`). Use the single shared `okFalHost` helper — never a bare `host.endsWith("fal.run")`, which also matches `evilfal.run`.
**Why:** poll/status URLs come from the client body; a look-alike host would receive `Authorization: Key <FAL_KEY>`.
**How to apply:** every new provider whose status/response URLs are echoed back from the client needs the same exact-host check; a source-contract test in `scripts/test-seedance-payload.mjs` extracts and exercises the helper.
