---
name: Provider refusal boundaries
description: Treat content-policy refusals as terminal for a submitted render, not permission to alter references and retry.
---

A provider policy/likeness refusal must end that render attempt. Do not automatically inject declarations, drop references, change models, or launch another paid job. Preserve the provider's actual reason without asserting a false positive or identifying an input culprit that the provider did not identify.

**Why:** nested retry layers created additional render requests and removed character identity references while the user still saw the original package. The generic error classifier also presented unsupported conclusions as facts.

**How to apply:** retain same-job polling/recovery for network interruptions, but keep that separate from new submissions. Reference or prompt changes require deliberate user action and a new reviewed package. A lost submit response is an unknown outcome, not proof that no job or charge occurred.