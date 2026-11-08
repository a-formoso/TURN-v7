# Detailed cloud set integration — 7 November 2026

The user approved connecting the successful cloud authoring and real image-engine
trials to the existing location controls. Keep the five sections; no initial
generated image or local installation is required. No saved film measurements,
camera choices or location artwork are changed by this implementation.

## Implemented

Camera inspection update, 8 November: disabled camera suggestions explain an
unreviewed or image-mismatched floor plan and link directly to step 2. Existing
cameras alone never disable suggestions. Numbered map circles are objects;
camera cones and their panel buttons open that specific 3D view. Proposed views
open an enlarged read-only preview; saved views open the angle editor with that
camera as its source and matching destination. Both are free and preserve saved
data until an explicit camera-save action. Suggested thumbnails also open
individually, and camera markers support keyboard activation.

The saved-camera editor now uses one primary selection. The selected tile,
dialog title, large view and default Save camera action agree. Choosing a saved
tile loads that camera for editing; selecting the same tile keeps its current
adjustments. Controls are visible by default and Reset restores the saved view.
Replacing another panel is a separate optional choice with an explicit target
on its Save button. Extra-angle loading/saving remains optional. No selection,
slider or reset writes film data; stale, permission and preview-readiness checks
still guard the explicit save action.
Its entry button sits directly below Suggest 4 cameras; the route to Build
the set stays below the camera review content.

Style comparison buttons use content-aware unequal columns so the longer
Compare with Blender label and Compare engines both stay on one line with
consistent padding and standard text size/weight. Exceptionally narrow cards
stack the two full labels rather than wrapping or clipping them.

During Step Five preparation/generation, Cancel appears immediately to the
right of the generating button in the same row. It cancels local use of that
run: pre-submission cancellation prevents the paid request; after submission,
late pixels are discarded without saving or opening review. Existing drafts
and artwork remain intact. The provider may still finish and charge an image
already submitted; the app does not promise a refund or a remote stop. Another
paid attempt stays blocked while that request is active and requires explicit
usage acknowledgement afterward. Cancel disappears when saving starts; a stale
click then reports saving rather than pretending a committed draft was stopped.

Step 3 also offers optional **Need ideas for camera views?** help. It creates a
text-only four-view inspiration image using an explicitly chosen image engine
at its displayed normal image price. Description, appearance and reviewed
floor-plan data guide it; existing images and saved camera poses are excluded.
The separate `camera-ideas-<location>` asset has its own private image/history.
It never replaces canonical artwork, changes a floor plan or camera, invokes a
Blender job, or becomes a reference consumed by the floor-plan/build workflow.
There is no apply/adopt/read-cameras action. Opening help is free; generation is
explicit. A failed save retains pixels for a save-only retry, and uncertain
generation requires acknowledgement before another paid attempt. Existing
scope, permissions and provider billing enforce the normal account boundaries.

Large angle previews now describe the actual centre-ray object/surface with a
short **Looking toward…** label and explicitly identify the lens size. Unknown
surroundings remain labelled unmodelled. Labels follow the previewed pose and
do not imply that an obstructed feature behind that surface is visible.

- Detailed app scenes use `kinolot-cloud-set-v2` / `mcp-procedural-v1`. They carry
  numerical geometry, cameras, bounded edge radii and procedural surface recipes.
  Source limits remain 500 shapes / 128 KiB, with up to 64 shaped soft parts.
- Beds, pillows, tables and cabinets have richer construction. Recognised kitchen
  anchors become hollow basins, cut counters, cabinet fronts and saved fixtures.
  Opening trim follows existing apertures. Dimensions and facing come from the
  saved plan; hardware and construction are proposed design, not measured facts.
- The worker starts a fresh private MCP/Blender session, authors the trusted
  numerical recipe, renders colour/depth/ID passes and verifies source dimensions
  and cameras. No arbitrary Python, URLs or downloadable assets are in the public
  scene contract. No language/image model runs in the worker.
- Compatible claims keep old workers away from detailed jobs, preserve one active
  build globally, and record scene retention when a capable worker claims a job.
  Older workers can still complete their original basic jobs during rollout.
- A detailed build requires the editable scene in private job storage before
  completion. All twelve PNGs and the scene remain scoped to film/job/lease.
- Step Five consumes the verified completed job, includes fitting visibility from
  object-ID passes, saves a separate draft, and retains explicit artwork approval
  and history. Hidden fittings should stay hidden; image-model fidelity still
  requires visual review. Unknown objects can remain simplified.

## Verified locally

- New contract/assembly/queue/storage/visibility checks: 40.
- Style draft, comparison, approval, history and race checks: 130.
- Cloud protocol: 63; release/access/ownership: 40; private scene storage: 55.
- Camera previews, including the new soft geometry: 212.
- Existing furniture/detail checks: 90 and 80; billing release checks: 13.
- Brand checks: 46. Production build completed.
- Worker cleanup and queued-job checks: 12 passed. Confirmed completion removes
  the working run; failed uploads and uncertain receipts preserve recovery files.
  The sweep skips unrelated folders and symlink targets.
- The full worker suite passes 47 tests, with one optional real-Blender
  regression skipped.
- Separate real Blender checks passed for the app-generated bedroom (43 objects)
  and kitchen (144 objects), including all 24 image/grid/raw-depth files per run,
  object bounds, identities and exact camera verification. These were background
  renderer checks, not tests of the new Linux MCP transport.
- A real Python worker client sent the actual Blender scene and twelve rendered
  images over loopback HTTP into the service, real PostgreSQL and private test
  storage. Scene hashes, visibility validation, cross-account denial and safe
  repeated completion passed. This did not contact live Supabase.

## Verified in the cloud

- The fixed bedroom and kitchen trials passed real MCP on Replit. Both real image
  engines also completed the separate kitchen comparison.
- The new app-format kitchen passed through MCP on Replit, including source and
  geometry verification and all camera renders. The operator's run also passed
  eleven worker/queued-job checks. This was an isolated job, not an app submission.
- A real Blender scene and camera PNG were uploaded to private Supabase storage.
  Authenticated and signed downloads matched their source hashes; anonymous and
  public reads were denied. Both temporary test objects were deleted afterward.
  This was an administrative storage component check, not a customer job.
- The additive scene-retention and compatible-claim migrations are installed.
  Privileged claims and scene staging remain unavailable to browser roles.
- The compatible `blender-render` function is deployed and active; an anonymous
  API request is denied.

These results do not prove the complete app submission, worker publication,
private upload and Step Five review path end to end.

## Working-file policy

The upgraded worker uses a temporary work root. After the authenticated service
confirms completion, it removes that run's images, scene and logs. Unconfirmed or
failed runs remain available for recovery; the startup/idle sweep removes owned
runs once they are a day old. Completed folders whose immediate removal failed
are retried by the sweep. Existing isolated trial/review folders are not swept:
archive and verify those separately before explicit cleanup.

## Remaining rollout gates

1. Publish the reviewed scene-header compatibility correction on both the worker
   and service, then re-enable detailed requests for one controlled retry.
2. Verify a scoped authenticated app job against real private Supabase storage,
   including the scene file, images, signed reads and access denial.
3. Generate a draft through the actual controls and let the user review it before
   artwork adoption. Keep current approved artwork until that action. Check
   working-file cleanup, recovery and coexistence with legacy jobs.

The compatibility-corrected worker is published. Both new server switches remain
disabled after the first controlled app job failed, pending the reviewed retry.
There were no queued/running jobs when the original test switches were enabled.
The committed browser `setBuildMcp` remains false; only the loopback development
test server serves an enabled override. The public website frontend has not been
updated. Read `supabase/README.md` for exact order
and rollback precautions. Do not describe this checkpoint as a completed live
rollout or exact photogrammetric reconstruction.

## Publication correction

The main Replit workspace fast-forwarded to the reviewed worker, passed twelve
checks and prepared Blender/MCP successfully. The subsequent republish failed in
promotion: its startup command required `nix-shell`, which is unavailable in the
published runtime. Replit's diagnostic confirmed the existing endpoint remains
available, but did not identify its serving revision. This is not a successful
deployment of the new renderer.

The corrected profile starts Python directly and declares the full graphics
dependencies through the root `replit.nix`. Both preparation and startup reject
missing graphics tools before downloading dependencies or claiming a job.

Replit synchronized the exact reviewed correction, passed its full 49-test suite
(one optional regression skipped), prepared the runtime and passed its MCP
connection check. The corrected republish succeeded. Deployment metadata identifies
the reviewed revision, and published build/runtime logs confirm preparation and
Blender startup without recurring errors during the observed interval. This is
startup evidence, not a completed authenticated app job or proof of continued
worker liveness. The complete Build/Style/private-save test remains outstanding.

## First app job and scene-upload compatibility

The signed-in operator accepted camera suggestions and submitted Okafor Kitchen
through the actual Build control. The cloud worker claimed its detailed scene
(143 objects) on the first attempt. It failed after about five minutes; the
database confirms all 15 held credits were released, with zero retained. The
published console exposed only a generic service error, and the diagnostic
integration could not retrieve that job's retained production files. The original
job's exact exception therefore remains unavailable.

A separate read-only check found a concrete compatibility defect: the worker's
scene uploader and the service accepted only the legacy 12-byte Blender header.
An existing successful Blender 5.2 cloud trial scene uses the modern 17-byte
format-01 header and was rejected by the worker before HTTP with networking
disabled. This reproduces a necessary upload failure for the cloud format,
independently of the unavailable original-job logs. The format is documented in
[Blender's source](https://github.com/blender/blender/blob/main/source/blender/blenloader_core/BLO_core_blend_header.hh).

The reviewed correction accepts both supported headers without rewriting bytes;
it retains the size limit, immutable source binding and access checks. Added
regressions reject unsupported modern formats and preserve legacy compatibility.
Worker failure logs now report controlled stage/type/status metadata without
exception messages or scene contents. New generic build errors preserve the
floor plan/camera wording rather than implying the user's layout caused failure.

The correction is committed on both sides. Replit synchronized the exact reviewed
worker revision, passed the 51-test suite (one optional test skipped), and accepted
the existing cloud scene with a mocked upload and unchanged bytes. The corrected
worker republished successfully; published metadata and fresh startup logs match
that revision. The deployed storage service bundle includes modern-header support.
Both switches remain off while the operator reviews coverage before another paid
app submission. The original scene also rendered all 24 verification files in an
isolated local background diagnostic; that does not prove the failed cloud job's
render stages or a successful private save.

## Default coverage and pre-build 3D review

The user requested the earlier trial's coverage as the Step 3 suggestion default:
wide room view, complementary reverse from the other end at roughly eye level, then two tighter
details of different saved features. For this kitchen the subjects are sink and
fridge; other rooms use their own landmarks. Wide framing favors visible room
landmarks (including openings), not an optical axis fixed on one low object. This
avoids the steep reverse and repeated counter view seen in the first app snapshot.

Suggestions remain deterministic and read-only until Use these cameras. Existing
camera notes and manually saved choices are preserved. Named panel roles and four
free 3D thumbnails show the proposed poses from the saved geometry before saving
or billing. Thumbnails use the existing graphics adapter with software fallback;
materials/lighting are simplified. The separate angle editor remains available.
The overhead map alone is not treated as proof of useful composition.

The floor-plan drafter now explicitly uses local object width/depth before facing
rotation and checks those rotated bounds against the written wall placement. The
saved kitchen's side counter has its dimensions exchanged relative to its written
east-wall run. A correction to local width/depth and a matching camera-preview
study were prepared in isolated files only; the saved plan has not been changed.

### Optional image-to-camera matching (development, experimental)

Step 3 keeps the normal free **Suggest 4 cameras** path. When its row has no proposal or review actions, **Preview & choose camera angles** sits on the right; with proposal actions it appears below. Labels wrap inside equally padded controls on narrow cards. Routine explanations in Cameras and Style preview are available in adjacent information tooltips; prices, errors, job state and acceptance instructions remain visible.

Inside **Need ideas for camera views?**, a current saved ideas grid offers **Match these views to set**. The explicit action quotes one vision writing call using the same engine-selection policy as other image reads. A failed numerical fit can still incur the writing charge; no automatic retry occurs. It generates no new image or Blender render.

The matcher creates labelled reference views from the unchanged numeric set. A vision read returns only recognized landmark identities and panel-local image coordinates. A bounded multi-start numerical fit then estimates camera position, yaw, pitch and focal length on a 36 mm sensor with roll fixed at zero. It requires at least six spread-out, non-coplanar landmarks across two saved features per panel. Unknown IDs, sparse/ambiguous observations, excessive reprojection error, cameras outside the room/inside objects, and matched features hidden by actual preview geometry are refused. Open-sky spaces without a saved ceiling are currently unsupported. Saved-pose normalization is verified before proposing a fit. These checks measure landmark agreement, not exact visual fidelity or a calibrated confidence percentage.

A successful attempt returns four unsaved proposals. Every ideas panel appears directly above its achievable 3D view. **Use these cameras** rechecks film/sign-in/edit access, source-image revision, layout and existing cameras, then writes only `coverageViews` through the existing card update boundary. Discard, a changed source, or a change during asynchronous verification prevents a save. The ordinary Step 4 scene builder reads these saved camera numbers; image pixels never enter its geometry inputs. Canonical artwork and the floor plan remain unchanged.

Validation separates numerical recovery, real preview-mesh visibility, UI/save guards and provider landmark quality. The automated suite uses synthetic known-camera observations and mocked vision responses, including an actual preview-renderer path. It makes no paid model calls. A real generated-image landmark read through the signed-in app remains a required quality trial before treating matching as generally reliable. The interface labels it experimental and does not promise an exact match.
