# Blender Studio extension contract

Implementation coordination contract. Legacy preview version 1 and all existing
pairing/job actions stay unchanged. The extension is separately advertised as
`extensions.sceneWorkspace: 1`, schema `cm-studio-v1`.

## Identity and document

A workspace is one reusable location/place set within one existing film.
`locationId` and optional `parentLocationId`/`rootLocationId` are existing canon
IDs, never names. Child places have separate workspaces with explicit containment.
Opening another shot in a set must not recreate its environment.

```json
{
  "schema": "cm-studio-v1",
  "projectId": "film-uuid",
  "locationId": "location-id",
  "name": "Reception",
  "parentLocationId": null,
  "rootLocationId": "location-id",
  "revision": 0,
  "context": {
    "description": "",
    "architecture": "",
    "materials": "",
    "staging": "",
    "productionPlan": "{\"schema\":\"cm-location-plan-v1\",...}"
  },
  "objects": [],
  "shots": [],
  "references": [{"entityId":"location-id","label":"Reception","kind":"location","version":"2026-09-24T10:00:00.000Z"}],
  "assets": [],
  "previews": []
}
```

`context.productionPlan` is an optional JSON string (maximum 16,000 printable
characters) containing the Locations UI's versioned production handoff. Version
`cm-location-plan-v1` keeps its compatibility field names: `canonicalSet` is the
UI's **The Space**, `screenplaySpaces` contains **Slugline Units**, and
`appearanceStates` contains **Time-of-Day Variants**; the remaining layers are
`requiredSpacePlates`, `coverageViews` and `sceneSetups`. These serialized names
must not be renamed when the UI terminology changes.
The optional `sharedSetLayout` field (`cm-spatial-layout-v1`) carries the common
parent-owned physical plan: `ownerId`, `targetSpace`, review `status`, a named
orientation `frame`, stable `anchors` (ID, space, name, relational placement,
basis and panel evidence), `sightlines`, `unresolved`, `corrections` and source
asset/version. This contract takes precedence over camera-relative staging for
object placement. It contains no fabricated metric coordinates. Unreviewed plans,
conflicts and missing dimensions must be surfaced before claiming an exact build.
Size compaction preserves the shared layout; it must not silently discard it and
proceed with unrelated camera-grid prose. Older geometry is not moved on import.
Older workspaces without this field remain valid. The relay updates context when
the location is opened but never replaces managed geometry, shots or approved
assets. Consumers must ignore unknown production-plan fields for forward
compatibility. Descriptive camera bookmarks are guidance, not measured transforms;
creating or changing a Blender camera still requires an explicit bounded proposal
and Apply.

Managed object:
`{id,name,kind,position:[x,y,z],rotation:[x,y,z],scale:[x,y,z],color:[r,g,b],
characterId?,assetId?,lightEnergy?}`. Kinds: box, sphere, cylinder, plane, actor,
mesh, light. Coordinates in metres; rotation Euler radians. IDs are stable.

Shot:
`{id,sceneId,name,camera:{position,target,focalLength,sensorWidth},
objects:[],tracks:[],frameStart:1,frameEnd:120,fps:24}`.
Shot objects use the same managed-object shape, isolated from reusable environment.
Track:
`{objectId,property:"position"|"rotation"|"scale",keyframes:[{frame,value:[x,y,z]}]}`.
Imported animated GLBs retain their rigs/actions; tracks add editable root motion.
The built-in actor is explicitly a blocking stand-in, not reconstructed likeness.

Reference metadata:
`{entityId,label,kind:"location"|"character"|"prop",version?}`.
Store reference identity/provenance, never device-origin source pixels.
Workspace access requires a version-pinned generated reference for its own
canonical `locationId`. Upload-only, missing, stale or unavailable source images
cannot unlock Studio. Parent artwork alone does not unlock an ungenerated room.
Asset metadata:
`{id,name,kind:"glb",sha256,bytes,modelId,rigged,animated,characterId?}`.
No untrusted file paths, scripts or executable fields. Bounds and strict validation
are defined in the shared JS contract and mirrored in Python.

## HTTP actions

All actions use the existing relay URL and `{action, projectId, ...payload}`.
Browser uses its existing access token; desktop uses the paired device token.
Every action verifies current user/project role; desktop additionally verifies
current device authority. Responses below are envelopes, not bare documents.

- `studio.capabilities` -> `{schema,sourcePolicy,models,meshModels,available,billingReady,...}`.
  Image-derived clients require `sourcePolicy: "generated-project-image-v1"`.
  Capability checks never generate or charge. Unsupported/unverified model access
  must not silently switch to another model.
- `studio.workspace.open` (browser): `{location:{id,name,parentLocationId?,
  rootLocationId?,context?},shot?,references}` -> `{workspace}`. Create if absent,
  preserve existing geometry and shots, add/update context without replacing
  approved geometry. Select this location/shot for the paired desktop.
- `studio.workspace.get`: `{locationId}` -> `{workspace}`.
- `studio.workspace.current`: -> `{workspace,shotId}` or `{workspace:null,shotId:null}`.
- `studio.workspace.save`: `{locationId,baseRevision,mutationId,workspace}` ->
  `{workspace}`. Compare-and-swap; no automatic retry over concurrent edits.
- `studio.assistant.submit`: `{locationId,baseRevision,requestId,modelId,
  mode:"scene"|"animation",prompt,shotId?,snapshot?,referenceId,acknowledgeCost:true}`
  -> `{task}`. Snapshot must validate and belong to the current workspace revision;
  its reference authority and production context come from the saved workspace.
  Scene mode requires `referenceId === locationId`. The relay validates and loads
  the generated image; raw `imageDataUrl` and prompt-only requests are rejected.
- `studio.assistant.get` / `studio.assistant.cancel`: `{taskId}` -> `{task}`.
- `studio.mesh.submit`: `{locationId,requestId,modelId,prompt?,
  referenceId,name,characterId?,rigged,animated,animationActionId?,acknowledgeCost:true}`
  -> `{task}`. Only the image-to-3D Meshy endpoint is allowlisted. The source must
  be a version-pinned generated project reference authorized in this workspace.
- `studio.mesh.get` / `studio.mesh.cancel`: `{taskId}` -> `{task}`.
- `studio.asset.get`: `{locationId,assetId}` -> `{asset,base64}`.
  Only authenticated, server-retained GLB bytes, never client-provided fetch URLs.
- `studio.reference.get`: `{locationId,entityId}` -> `{entityId,dataUrl}`.
  Only authorized generated project assets attached to this workspace.
- `studio.preview.publish`: `{locationId,shotId?,baseRevision,requestId,
  pngBase64,actualCamera}` -> `{preview}`. Separate auxiliary image, never finished art.
- `studio.preview.get`: `{locationId,previewId}` -> `{preview,pngBase64}`.

Tasks:
`{id,type,status:"queued"|"running"|"completed"|"failed"|"cancelled",modelId,
locationId,baseRevision?,message?,proposal?,asset?,error?}`.
No provider secrets or provider polling URLs in responses. Ambiguous submission
is reconciled by request ID, never automatically resubmitted/charged.

Assistant proposal:
`{summary,ops:[...]}`. Operations are bounded typed edits, never generated code.
`{op:"upsert_object",scope:"set"|"shot",shotId?,object:...}`,
`{op:"remove_object",scope:"set"|"shot",shotId?,objectId}`,
`{op:"set_camera",shotId,camera:...}`,
`{op:"set_tracks",shotId,tracks:[...],frameStart,frameEnd,fps}`.
Always show a proposal for explicit Apply; desktop applies to managed data only.
Local unsaved edits must survive server revision conflicts.

## Ownership / security

- Backend worker owns server extension, provider module, shared JS contract
  `app/blender-studio-contract.js`, and server tests; mirrors the contract beside
  the edge function. Notify all implementers before changing this interface.
- Native worker owns Blender package and native tests.
- Browser worker owns `app/blender-studio.js`, UI/CSS, Locations/Shots insertion,
  entry/build script ordering, feature manifest, and browser tests.
- Main owns coordination, documentation, package rebuilding, final integration,
  interoperability verification and publishing decisions.
- Retain static hosting, existing Supabase project/tables/private bucket. The
  separately approved Studio credit-settlement function is the only additive
  database change. No table/policy changes, receipt cleanup, character-orbit
  feature or Story Pipeline edits.
- AI credentials stay on the server. Reuse current credit-account enforcement and
  idempotent usage settlement; expired paid authorization fails explicitly.
- Studio settlement uses the service-role-only atomic function, not the legacy
  browser spend RPC. Its all-NULL invocation is a non-spending readiness probe.
  Private server-minted spend IDs remain sealed and survive settlement retries.
- A validated provider result is retained before deduction. A
  `settlement_pending` task can be retrieved/retried by its authorized launcher
  without a new provider submission. Proposal/asset payloads remain private until
  the task is completed and its credit deduction is settled.
- Validate GLB magic, length, size, hash, JSON chunks, and reject external resources,
  executable content/drivers before importing into isolated managed collections.
- Render/AI/import work must check cancellation and run/project ownership after
  awaits. Keep provider refusals terminal; do not change references or retry models.
