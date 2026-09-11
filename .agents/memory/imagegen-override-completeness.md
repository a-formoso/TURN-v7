---
name: Image-gen prompt overrides
description: User-edited prompts must survive all builders and later attachment-driven rewrites.
---
An explicit user-edited prompt must remain authoritative throughout prompt construction: fresh, seeded and simple builders, plus any later rewrite after reference images are resolved.

**Why:** The initial Stage override missed the simple recovery path. Later, an inherited attachment-driven rebuild replaced an edited prompt even when all three initial builders were covered. Either error spends credits on an automatic prompt rather than the user's requested prompt.

**How to apply:** When wrapping shared generation options, inspect every assignment to the final provider prompt, including callbacks inherited through object spreads. Route each through the same edited-versus-derived decision, and test the exact prompt received by the provider after attachments resolve—not just individual builder return values.

An explicit reference choice is part of the same input contract, including during simplified retries. Optional-reference recovery must not swallow a required-reference error and proceed with a paid text-only image.

**Why:** The shared image runner historically tolerated attachment failures and omitted attachments in simple mode. That is acceptable only for optional inputs, not a director-selected location/state.

**How to apply:** Verify the actual provider boundary, including edit and simple paths, rejects unavailable required references before spending. Keep an explicitly chosen master/design sheet distinct from an automatic full-frame location fallback; choosing one never authorizes silent cropping or substitution.

Narrowing location picker options to the current scene must not erase an older explicit selection or mark an existing asset as deleted.

**Why:** The scene-only request restricts new choices, not saved image or render intent. The earlier picker allowed references across scenes.

**How to apply:** Filter new options by canonical scene links; keep saved outside-scene choices separately labeled and removable. Continue resolving their exact saved IDs until the editor changes them.
