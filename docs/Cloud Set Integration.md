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
- Worker suite: 46 tests, with one optional real-Blender regression skipped.
- Separate real Blender checks passed for the app-generated bedroom (43 objects)
  and kitchen (144 objects), including all 24 image/grid/raw-depth files per run,
  object bounds, identities and exact camera verification. These were background
  renderer checks, not tests of the new Linux MCP transport.
- A real Python worker client sent the actual Blender scene and twelve rendered
  images over loopback HTTP into the service, real PostgreSQL and private test
  storage. Scene hashes, visibility validation, cross-account denial and safe
  repeated completion passed. This did not contact live Supabase.

The earlier fixed bedroom and kitchen cloud trials passed real MCP on Replit.
Both real image engines also completed the separate kitchen comparison. Those
results do not prove the new app-format queue/worker deployment end to end.

## Remaining rollout gates

1. Run `mcp_job.py --scene benchmark/detailed-kitchen.scene.json` under
   `shell.mcp.nix` in the separate Replit trial checkout. Verify the actual new
   app-format authoring path on Linux and inspect its output.
2. Apply the additive scene-retention and compatible-claim migrations and deploy
   the reviewed edge function. Update the cloud worker with its pinned runtime.
3. Verify a scoped authenticated job against real private Supabase storage,
   including the scene file, images, signed reads and access denial.
4. Enable the server switches and then `setBuildMcp` for the scoped rollout.
   Generate a draft through the actual controls and let the user review it before
   artwork adoption. Keep the current approved artwork until that action.

At this checkpoint `setBuildMcp` is false, no production switches were enabled,
and no Supabase migration or function deployment was performed. The Replit
published worker has not been replaced. Read `supabase/README.md` for exact order
and rollback precautions. Do not describe this checkpoint as a completed live
rollout or exact photogrammetric reconstruction.
