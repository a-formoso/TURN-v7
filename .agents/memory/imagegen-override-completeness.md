---
name: Image-gen prompt overrides
description: User-edited prompts must survive all builders and later attachment-driven rewrites.
---
An explicit user-edited prompt must remain authoritative throughout prompt construction: fresh, seeded and simple builders, plus any later rewrite after reference images are resolved.

**Why:** The initial Stage override missed the simple recovery path. Later, an inherited attachment-driven rebuild replaced an edited prompt even when all three initial builders were covered. Either error spends credits on an automatic prompt rather than the user's requested prompt.

**How to apply:** When wrapping shared generation options, inspect every assignment to the final provider prompt, including callbacks inherited through object spreads. Route each through the same edited-versus-derived decision, and test the exact prompt received by the provider after attachments resolve—not just individual builder return values.
