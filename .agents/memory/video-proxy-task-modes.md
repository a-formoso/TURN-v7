---
name: Video proxy task modes and staged device media
description: Why Seedance task modes ride body.videoTask, why device video is staged by signed upload (stage: refs), and how Kling motion-control tiers/orientation were inferred.
---
# Video proxy task modes and staged device media

- **`body.task` is the proxy's OP selector** (`"video"`, `"capabilities"`, `"stage-upload"`, …). A provider-side task (Seedance `reference|editing|extension`) must ride a separate field (`videoTask`); reusing `task` silently reroutes the request.
  **Why:** the op switch predates provider task modes.
- **Large device media never rides the Edge Function body.** Supabase Edge Functions cap memory/CPU; a 200MB video data URL cannot fit. The browser asks the proxy for a one-shot signed upload slot inside `<uid>/stage-tmp/`, PUTs directly to storage, and submits a `stage:<path>` reference that only the proxy resolves (1h signed read URL) after verifying the stored object (exists, kind/MIME, size, name timestamp within TTL; invalid objects are removed on the spot).
  **How to apply:** any new "upload from device" input for a paid job follows the same path; capability handshake must advertise `staging.signedUpload && scheme==="stage:"` or the browser stays on `PENDING_SERVER`.
- **Capability handshakes re-ask only while the answer is unknown.** A transient failure at mount must not pin a tab to "pending"; known results are cached, unknown ones dropped so the effect can retry.
- **Kling 3.0 Motion Control:** fal documents no resolution; "720p · Standard / 1080p · Pro" is an inferred label, not a provider fact. Scene control OFF = `character_orientation:"video"` (motion video up to 30s, background follows the video); ON = `"image"` (≤10s). Output length follows the motion video; there is no seed. Motion control takes no screenplay reference — videogen refuses one rather than recording provenance the provider never saw.
- **Input length is a billing fact, never a default.** fal bills input seconds (×0.6 token price with video inputs) and sizes editing/motion output by the source; the Stage measures every take pick (`vidMediaFacts`) and shows NO price / blocks Generate until measured. Recorded take `durationSec` is the requested length, not the file's.
- **Paid handlers re-check the clip and console after every preparation await** (`assertSameClip`): same-scene clip switches are caught by a clip-id ref; scene navigation unmounts the console, so an "open" ref set in an effect is checked too.
- **Composer state must be declared before eager cost/choice consts** in the Stage component (TDZ otherwise — the file is one huge component).
- **Known gap (pre-existing):** the proxy's video op has no server-side credit reservation; spend is settled client-side once per job. Any future move of billing into the proxy should cover extend/edit/motion too.
