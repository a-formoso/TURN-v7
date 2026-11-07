# Detailed cloud set integration — 7 November 2026

The user approved connecting the successful cloud authoring and real image-engine
trials to the existing location controls. Keep the five sections; no initial
generated image or local installation is required. No saved film measurements,
camera choices or location artwork are changed by this implementation.

## Implemented

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

1. Verify a scoped authenticated app job against real private Supabase storage,
   including the scene file, images, signed reads and access denial.
2. Generate a draft through the actual controls and let the user review it before
   artwork adoption. Keep current approved artwork until that action. Check
   working-file cleanup, recovery and coexistence with legacy jobs.

At the current checkpoint the reviewed worker is published and both new server
switches are true. There were no queued/running jobs when they were enabled.
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
