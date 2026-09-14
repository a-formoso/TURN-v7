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
  "context": {"description": "", "architecture": "", "materials": "", "staging": ""},
  "objects": [],
  "shots": [],
  "references": [],
  "assets": [],
  "previews": []
}
```

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
Asset metadata:
`{id,name,kind:"glb",sha256,bytes,modelId,rigged,animated,characterId?}`.
No untrusted file paths, scripts or executable fields. Bounds and strict validation
are defined in the shared JS contract and mirrored in Python.

## HTTP actions

All actions use the existing relay URL and `{action, projectId, ...payload}`.
Browser uses its existing access token; desktop uses the paired device token.
Every action verifies current user/project role; desktop additionally verifies
current device authority. Responses below are envelopes, not bare documents.

- `studio.capabilities` -> `{schema,models,meshModels,available,billingReady,...}`.
  Capability checks never generate or charge. Unsupported/unverified model access
  must not silently switch to another model.
- `studio.workspace.open` (browser): `{location:{id,name,parentLocationId?,
  rootLocationId?,context?},shot?,references?}` -> `{workspace}`. Create if absent,
  preserve existing geometry and shots, add/update context without replacing
  approved geometry. Select this location/shot for the paired desktop.
- `studio.workspace.get`: `{locationId}` -> `{workspace}`.
- `studio.workspace.current`: -> `{workspace,shotId}` or `{workspace:null,shotId:null}`.
- `studio.workspace.save`: `{locationId,baseRevision,mutationId,workspace}` ->
  `{workspace}`. Compare-and-swap; no automatic retry over concurrent edits.
- `studio.assistant.submit`: `{locationId,baseRevision,requestId,modelId,
  mode:"scene"|"animation",prompt,shotId?,snapshot?,imageDataUrl?,acknowledgeCost:true}`
  -> `{task}`. Snapshot must validate and belong to the selected workspace.
- `studio.assistant.get` / `studio.assistant.cancel`: `{taskId}` -> `{task}`.
- `studio.mesh.submit`: `{locationId,requestId,modelId,prompt?,imageDataUrl?,
  referenceId?,name,characterId?,rigged,animated,animationActionId?,acknowledgeCost:true}`
  -> `{task}`. Text/image Meshy endpoints are server allowlisted.
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
- Retain static hosting, existing Supabase project/tables/private bucket. No schema
  or policy changes, receipt cleanup, character-orbit feature or Story Pipeline edits.
- AI credentials stay on the server. Reuse current credit-account enforcement and
  idempotent usage settlement; expired paid authorization fails explicitly.
- Validate GLB magic, length, size, hash, JSON chunks, and reject external resources,
  executable content/drivers before importing into isolated managed collections.
- Render/AI/import work must check cancellation and run/project ownership after
  awaits. Keep provider refusals terminal; do not change references or retry models.