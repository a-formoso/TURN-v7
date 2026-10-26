# Blender preview proof

This document describes the legacy one-shot preview path. For reusable location
sets, AI-assisted editing and 3D assets, see [Blender Studio](Blender%20Studio.md).

This is an opt-in, provider-independent proof: one location blockout, stand-in
figures and one still camera. It is not character reconstruction, animation,
finished artwork, or the removed character-orbit feature. No paid image/video
provider is called.

## Components and ownership

- `app/blender-contract.js`: shared bounded scene schema, canonical JSON and
  validation. Plain UMD/global `BlenderContract` and Node CommonJS export.
- `app/blender-preview.js`: web client, snapshot construction, scoped loading and
  saving of auxiliary previews.
- `app/blender-preview-ui.jsx` / `.css`: a per-shot opt-in panel.
- `supabase/functions/blender-bridge/`: authenticated stateless HTTP relay,
  using existing Supabase auth/storage and sealed, namespaced metadata records.
- `blender/kinolot_bridge/`: desktop Blender add-on; outbound HTTPS only.
  Build its downloadable ZIP into `app/downloads/`.

Existing film, shot, character and image IDs must not be replaced. Never modify
`docs/Story Pipeline.md`. No database migration or new provider account is needed.

## Scene protocol v1

Coordinates are metres: X right, Y away from the initial camera, Z up.
Layout dimensions are explicit editable assumptions, not measurements inferred
from reference images. Names label primitives; no photos or artwork are sent.

```json
{
  "version": 1,
  "projectId": "film UUID",
  "shotId": "shot-id",
  "sceneId": "scene-id",
  "locationId": "location-id",
  "label": "Shot label",
  "room": {"width": 12, "depth": 12, "height": 4},
  "landmarks": [
    {"id":"bg-center","label":"Door","position":[0,4,1],"scale":[2,0.4,2]}
  ],
  "actors": [
    {"id":"character-id","label":"Stand-in","position":[0,0,0],"height":1.75}
  ],
  "props": [],
  "camera": {
    "position":[0,-6,1.65],"target":[0,0,1.4],
    "focalLength":50,"sensorWidth":36
  },
  "render":{"width":640,"height":360,"samples":16}
}
```

Props have the same structure as landmarks. Limit eight landmarks, four actors,
eight props; camera positions within ±100m; room dimensions 2–50m (height 2–12m);
focal length 8–200mm, sensor 36mm, resolution 128–768 per dimension, 1–32 samples.
Reject unknown executable/URL/path fields, non-finite numbers, excessive strings,
duplicate object IDs, and a camera looking at its own position.

Scene identity uses SHA-256 of recursively key-sorted canonical JSON. The exact
frozen scene must travel with its job and be saved with the resulting preview.
Numbers use JavaScript JSON spelling, including exponent formatting and negative
zero. Python's native `json.dumps(sort_keys=True)` alone is not an equivalent hash
contract; keep the cross-language canonicalization corpus passing.

## HTTP protocol

One Supabase Edge Function `blender-bridge`. GET returns versioned capabilities;
all other calls POST JSON `{action,...}`. Browser calls use its Supabase Bearer
access token. Desktop calls use a one-time pairing code, then an opaque scoped
device token as `Authorization: Device <token>`. Never send the account access token to
Blender. Responses are JSON; errors are `{error,code}` with non-2xx status.

| action | input | result |
| --- | --- | --- |
| `pair.create` | `projectId` | `pairCode,expiresAt` (10 minutes) |
| `connection.get` | `projectId` | `connected,deviceName,expiresAt,lastSeen,job` (current public job or null, for recovery) |
| `connection.disconnect` | `projectId` | `disconnected:true` |
| `device.connect` | `pairCode,deviceName` | `deviceToken,projectId,expiresAt` (1 hour) |
| `job.create` | `projectId,spec,requestId` | `job` |
| `job.get` | `projectId,jobId` | `job` |
| `job.cancel` | `projectId,jobId` | `job` |
| `device.claim` | none | `job:null` or `job` with `leaseToken` |
| `device.complete` | `jobId,leaseToken,pngBase64,actualCamera` | `job` |
| `device.fail` | `jobId,leaseToken,error` | `job` |

Public job: `id,requestId,status,spec,specHash,createdAt,error`; completed jobs additionally
return `pngBase64,actualCamera`. Status is queued/running/completed/failed/cancelled.
`actualCamera` is read back from Blender: `{position,direction,focalLength,
sensorWidth,width,height}`. Validate it against the frozen requested camera.
Use one job at a time per user/project connection. Claim once with a random
lease token; allow 5 minutes to render. Expired/interrupted jobs require an
explicit retry, not an automatic resubmission. Completion is idempotent.

## Security and persistence

The relay verifies real Supabase user authentication and current owner/art-director
asset-write permission, including again for device claim/completion. Viewer/writer
roles cannot launch previews. Every job is bound to its authenticated user/project.
Tokens are high-entropy, short-lived and stored only as hashes.

Use a dedicated `turn_generations` entity namespace per user/project, metadata kind
`image/meta.blenderBridge`, `storage_path:null`. Since ordinary project writers can
edit generation metadata, relay state MUST be authenticated/encrypted by a
server-only key and bound to owner/project/entity using authenticated encryption.
Never trust plaintext metadata as authority. Use compare-and-swap updates, not
blind upsert after awaits. Do not alter unrelated generation rows or policies.

Only validated PNG results go into a private temporary shot-typed path owned by
this bridge job. Do not embed pixel data in metadata rows. Never accept an output
path from either client. Temporary cleanup may touch only bridge-owned paths.
The browser durably saves received pixels with `nbCommit` into the distinct
`blender-preview-<shotId>` slot, kind `shot`, semantic metadata
`blender-preview`, frozen source spec/hash and actual camera. It must check film,
epoch, shot/spec ownership after every await and preserve unsaved pixels on errors.

The add-on never executes supplied Python or shell commands, fetches supplied
asset URLs, deletes existing scenes, or saves over a user's `.blend`. It creates
one separate preview scene per request, restores the active scene after rendering,
and leaves the proof editable in Blender. Network calls run outside Blender's
main thread; all `bpy` work runs through its main-thread timer.

## Verification

No paid provider calls, live project-data writes, schema migrations, or deletion
of existing assets in tests. Test the relay through fake storage/transport with
real auth/state-machine validation; test the actual frontend plus client together;
exercise real Blender rendering if available, clearly distinguishing that from
mocked protocol tests. A shipped desktop add-on still needs installation by the
user before their Blender can be paired.

## Browser client interface

`window.BlenderPreview` provides `scope()` (requires current saved cloud film),
`isCurrent(scope)`, `buildSpec({shot,scene,location,subjects,props},overrides)`,
`canonical(value)`, `hashSpec(spec)`, `request(action,body,scope,guard?)`,
`loadPreview(shotId,scope)`, `savePreview(job,scope,guard?)`, `endpoint()` and
`slotId(shotId)`. The scope is `{projectId,uid,epoch}`. Async methods fail closed
on scope/guard changes; requests do not automatically retry. `loadPreview`
returns null or `{url,meta}`; `savePreview` returns `{url,meta}` only for durable
storage. A save failure may include `previewDataUrl` for explicit download/retry.

`buildSpec` reads actual shot IDs/lens/cameraSettings, location.staging and
explicit in-frame subjects/props. Overrides: `{room:{width,depth,height},
camera:{position,target,focalLength}}`. The UI should offer room dimensions,
camera position/target and lens, show approximate blockout disclosures, and never
send merely mentioned/remote characters as stand-ins. Explicit lens edits use
the real `onUpdate(shot.id,{lens:String(mm),cameraSettings:{...previous,
focalLength:String(mm)}})` path. Existing artwork is untouched.

## Desktop setup and proof checks

In **Art Room → Shots**, expand **Blender preview · rough blockout** below
Advanced cinematography, beneath a shot image (not in the enlarged image viewer).
The panel has three numbered steps:

1. **Download and install, once.** This step is collapsible; folding it leaves
   the connection and render controls available. Choose **Download add-on ZIP**.
   In Blender, open Preferences → Add-ons → the top-right menu → Install from
   Disk, select the ZIP without extracting it, and enable **Kinolot Bridge**.
2. **Connect.** Choose **Pair Blender desktop** to create a temporary code.
   In Blender's 3D view, press N and choose the **Kinolot** side tab.
   Copy the Function URL and Pair code into the matching boxes, tick
   **I approve this project**, then click **Connect** in Blender.
3. **Render.** Review the room, camera and lens settings and choose
   **Render Blender preview**. It remains disabled until connected.

Download is not required for each connection or render. Copy/paste setup is
easiest with Kinolot open in a browser on that computer; the connected
Blender can then be controlled from a phone. Choose a Blender release compatible
with the computer; Intel Macs need the macOS Intel build of Blender 4.5 LTS,
not Blender 5.x.

The build generates both the ZIP and `app/blender-addon-data.js` from the same
bytes. The page loads that small data script before the UI; the download button
decodes it and requests a Blob download synchronously, without fetching a ZIP
URL or navigating the film page. The production build fingerprints the script
URL from its contents. Never hand-edit the generated bundle. If an embedded
browser still blocks saving files, open Kinolot in its own browser tab.

Pairing codes for canonical UUID identities use a compact `u1_` locator: the
owner, project and actor UUIDs occupy 48 binary bytes before base64url encoding.
The random secret is still 32 bytes; the full code is 116 characters. This fits
Blender 4.4/4.5's password editor, which silently clips pasted text at 127
characters even though direct RNA assignment accepts longer values. Legacy
JSON locators remain readable, and non-UUID/case-sensitive identifiers retain
that representation. No installed add-on update is required: it treats codes
and returned device tokens as opaque strings.

`device.claim` returns the lease token both beside `job` (required by the
installed desktop add-on) and inside `job` (retained for relay clients).
Ordinary job/connection polls never return a lease token. An already-claimed
job does not receive its lease again: Stop/cancel it and explicitly start a
fresh render after a protocol failure. Connection and receipt lifecycles remain
unchanged; do not automatically renew, reclaim or retry a render.

Keep Blender open. Check the assumed room size, camera position/target and lens,
then choose **Render Blender preview**. Change the lens and render again. The
image is an auxiliary blockout; finished artwork and existing `.blend` files are
not overwritten. The proof scene stays editable, while the previously active
scene, object, selection and interaction mode are restored.

Local verification commands (no provider calls or live project-data writes):

```
npm run build
node scripts/test-blender-relay.mjs
node scripts/test-blender-addon-relay.mjs
node scripts/test-blender-pairing-codec.mjs
node scripts/test-blender-ui.mjs
node scripts/test-blender-addon.mjs
node scripts/test-blender-addon-canonical.mjs
blender --background --factory-startup --python scripts/test-blender-addon-render.py
blender --background --factory-startup --python scripts/test-blender-addon-integration.py
```

The browser tests use real components and validators with fake transport/storage.
The packaged add-on test exercises its actual pairing/claim/upload client with
recorded HTTP transport. Real headless Blender renders test lens changes and
preservation of an existing scene in Edit mode; these are synthetic test scenes,
not the user's cloud film.

## Relay authority and deployment

Deploy only the `blender-bridge` Edge Function, with `verify_jwt:false`: the
function explicitly validates browser Bearer sessions and its own scoped Device
credentials. It uses the standard Supabase server environment; never copy a
service-role credential into browser code or the downloadable add-on. The web
application remains a static website.

Authenticated encryption does not prevent a project writer replaying older,
valid ciphertext. Immutable HMAC-addressed receipts in the existing private
`turn-assets` bucket therefore enforce consumed pair codes, revoked devices,
one-time claims and terminal job decisions. Their `_internal/blender-bridge/`
namespace is service-only under the checked Storage policies. Receipt
creation is atomic and precedes state publication; errors fail closed.

These small security receipts are intentionally retained in this proof.
Future expiry cleanup must prove that older encrypted records cannot revive
the corresponding authority, and must never touch saved preview artwork or
unrelated assets. No new table, bucket, migration or access-policy change is
required.