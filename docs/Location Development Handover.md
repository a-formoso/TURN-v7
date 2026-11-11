# Location workflow development handover

Prepared for continuation in Claude Code, 11 November 2026.

## The owner's actual requirement

Deliver a useful first result across different locations. A user presses the button; the application determines what the location needs to show, constructs a complete set, selects useful camera coverage, resolves avoidable obstructions internally, and delivers a coherent four-view result. The user should not need technical camera knowledge or repeated paid rebuilds to discover basic construction mistakes.

**Do not continue by manually fixing each location or writing a bespoke camera arrangement for every room.** The owner explicitly rejected that approach after the gym demonstration. They also rejected reporting large test counts as evidence of product quality. The acceptance evidence is the actual resulting images, their completeness, framing and consistency with the brief. Numerical checks support that evidence but cannot replace it.

The owner is concerned that an open-ended development cycle and subscription costs are delaying their business launch. Be direct about what works, what has not been demonstrated, and whether an approach actually improves first-delivered results. Do not promise perfect output for every imaginable brief.

## Repository and preserved work

Read `AGENTS.md` and the full `CLAUDE.md` first. This handover supplements them; it does not replace project policy. Product branding is Kinolot by Infinite Studio AI; TURN is only an internal codename. Feature changes must update `APP_FEATURES` in `app/ai.jsx`. The Story Pipeline is owner-controlled and is not being changed by this work.

Remote: `https://github.com/a-formoso/TURN-v7.git`.

| Checkout | Branch | Last implementation/documentation checkpoint before this handover |
|---|---|---|
| `/Users/macbookpro/Desktop/TURN-v7` | `codex/restore-cloud-set-controls` | `1edec5a6` |
| `/private/tmp/kinolot-location-release-20261108` | `codex/location-cloud-release-20261108` | `a776627d6164442a5ce252b949ffcae9a3e25424` |
| `/private/tmp/kinolot-location-quality-20261109` | `codex/location-quality-foundation-20261109` | `b21054a4df8193d50c480ee436e4f320df188acf` |

The experimental branch is pushed to origin. It descends from the root checkout's documentation checkpoint, **not from the production-config release branch**. Its application configuration therefore has detailed cloud builds off, just like the root checkout. Do not merge branches blindly or accidentally disable the production renderer.

Fresh fetch on 11 November confirmed `origin/main` and the release branch at `a776627d`. The root checkout contains two pre-existing, unstaged edits that were deliberately excluded from every commit and isolated worktree:

- `app/beat-keyframe-merge.js`
- `app/character-identity.js`

Preserve those edits. Do not stage, reset, overwrite or assume ownership of them. Continue in the existing clean experimental worktree where appropriate; if it has disappeared, recover its pushed branch in another isolated worktree. This handover is internal documentation and is not another product release.

## Published state versus product readiness

The location/cloud UI was successfully published on 8 November at `https://kinolot.infinitestudioai.com` from `a776627d`. Replit deployment: `6a41d512-d74d-4786-8fe6-c14c6dce06e2`.

Publication and technical execution are established. **General automatic location quality is not established.** Earlier statements that the feature was complete referred to one successful development flow and overstated broader readiness. The corrected kitchen and bus are successful examples, not proof of reliability for arbitrary locations.

Recorded public verification checked all 107 local HTML assets, bus3 runtime modules, release5 configuration, enabled detailed cloud builds, and absence of browser Babel compilation. Generated add-on archive contents were checked by their uncompressed source files because compression bytes differed across build runtimes. This verification is historical evidence from publication; do not present it as a fresh live functional test.

Evidence file on this Mac:

`/Users/macbookpro/Desktop/Kinolot Blender Tests/Cloud MCP Okafor kitchen test-nkjrstq2/backend-review/public-location-release-verification.json`

Permanent private scene/render saving and access boundaries were verified. **Production temporary-file deletion on the Replit worker remains independently unverified.** Successful upload and tested cleanup code do not prove deletion in production. Old trial/review folders intentionally fall outside normal job cleanup. Do not claim that no generated files remain on Replit.

## What is implemented and published

The Locations path remains: describe → review floor plan → choose cameras → cloud Build the set → Style it → explicitly adopt location artwork. It does not require an existing image to build a location.

- Versioned detailed scene contract, cloud worker route, private editable Blender scene storage and four views with colour/ID/depth passes.
- Browser 3D camera preview from numerical scene data. This is a lightweight browser reconstruction, **not the already-built cloud Blender file**. Camera changes leave geometry fixed; materials/lighting can differ from final Blender output.
- Improved suggested coverage, clickable camera markers, proposed-view thumbnails, clearer camera editor selection, labelled targets/lenses, and direct floor-plan review actions for blocked suggestions.
- Optional Step Three image-model idea grids, stored separately from approved artwork. They do not directly build or modify Blender geometry.
- Experimental image-to-camera matching: landmark fitting plus approximate subject/framing fitting. A successful fit saves all four cameras and opens Step Four; it does not automatically submit a paid build. Failed, stale or access-invalid results leave saved cameras unchanged. One real bus-image matching attempt succeeded after a saved-precision fix. This is approximate composition transfer, not guaranteed calibrated reconstruction.
- Step Five inline Cancel during style generation. Cancellation before provider submission prevents it; after submission, late results are discarded without saving a draft, but provider billing may still occur. Saving itself is not cancellable.
- Style drafts are separate from canonical artwork. Adoption is explicit, with history retained.
- Layout refinements: `Suggest 4 cameras` label, adjacent preview button when appropriate, consistent button heights/padding, Enlarge ideas beside Match, routine help moved to tooltips, longer comparison label accommodated without squeezing text.
- Finite procedural construction support: kitchen parts, common furniture, sports nets, paired parcel shelves, measured repeated bus seating and bus construction detail.

Build price remains **15 credits**, following the current billing regime. The owner's earlier 30-credit suggestion and possible plan-price increase were left on hold; they were not applied. Do not silently change billing or add hidden paid retries/model calls.

## Why the examples diverged

### Kitchen

The kitchen benefited from detailed construction rules and repeated visual inspection: counter joins and cut-outs, sink basin/tap, cabinet fronts/backing, fridge, table/chairs and fixture details. Dark cabinet gaps were corrected in the builder. The owner regards this as the desired visual standard.

The kitchen's full development workflow completed: cloud build, private save, style draft and explicit artwork adoption. Cloud job: `51f53ea5-04a6-4212-8d8a-6736f6422012`. This worked through the real app controls.

### Bus

The original bus builder represented only three named story benches although the written brief specified twelve rows per side. A paired shelf's overall envelope became a solid slab across the cabin, blocking light. Styling could not repair missing geometry.

The published correction expands the explicitly measured row pattern to 24 bench units, splits clearly described side shelves into two boards inside their overall envelope, and supplies proposed driver/roof/window/light construction detail. It retains named anchor identities and measurements. The successful expanded cloud job was `0db44296-0e97-4ff5-af00-2dd26306836b`: 306 objects, twelve image passes, editable scene, private access checks, settled 15-credit charge. The owner then generated a style draft whose metadata was verified against that exact scene revision. It remained a draft when last checked; it was not automatically adopted.

Separately, the owner explicitly approved swapping only the bus floor-vent size from `[0.05,9.2,0.15]` to `[9.2,0.05,0.15]`. That isolated saved-data change was backed up, fenced against concurrent updates, applied, and verified to preserve cameras, artwork and all other content. Do not apply the older, superseded saved shelf-anchor repair proposal.

### Gym: diagnostic only, then rejected direction

The actual saved gym builds a filled court rectangle, solid bleacher block, unsupported table/rail proxies and only backboards for the basketball fixtures. Its two detail views were obstructed. An initial spoken claim that both wide cameras faced walls was wrong: the local baseline render shows that the wide views do see the room. That assessment was corrected during the conversation.

A manual local proposal added court outlines, tiered seating, rims/netting, table legs, proposed trusses/lights and changed cameras. It was rendered locally with Blender, with no paid image generation or cloud job, and no saved-film changes. The owner then clarified that manual per-location correction is not the requested solution. **Do not resume that path or portray its rendered candidate as an automatic app result.** Its proposed tier/fixture counts and rail orientation are not confirmed saved measurements. It has not been integrated, styled or published.

Private diagnostic artifacts:

`/Users/macbookpro/Desktop/Kinolot Blender Tests/Location quality review-20261109/`

Includes `saved-locations.json`, `gym-location.json`, baseline/proposed scenes, `gym-before/grid_material.png`, `gym-proposed/grid_material.png`, diagnostic scripts, and `gym-visual-review.json`. These contain private film data and belong outside Git.

## The current experimental branch

Read `experiments/location-quality/README.md` in `codex/location-quality-foundation-20261109`. It records both positive evidence and failures.

### Complete inventory experiment

`inventory.mjs` plus `check-feasibility.mjs` demonstrate explicit measured replication of existing furniture assemblies and inspection against independent quantity/part/placement requirements. Synthetic single-family fixtures cover chairs, tables, beds and wardrobes. They do not represent complete, visually approved rooms, natural-language extraction, collision-free layouts or styled outputs.

Important structural discovery: `normalizeLocationSpatialPlan()` currently retains at most **24 anchors**. These are story landmarks, not a full inventory. Merely asking a model to emit more anchors will silently lose some of them. The bus has a special repeat expansion, but there is no shared persisted full-inventory model yet.

### Automatic geometry/coverage experiment

`auto-coverage.mjs` plus `check-auto-coverage.mjs` search camera stations using the assembled meshes, reject physically occupied stations, look for complementary wide views and distinct visible details, and preserve the original set. They do not depend on copying existing camera angles.

The same search was exercised on the actual saved gym, bus and kitchen without per-location camera-coordinate overrides. It found geometrically visible alternatives, **but chose inappropriate detail subjects in some cases**: kitchen counter runs rather than the desired sink/fridge pair; the gym coach table rather than a more representative fixture. Clear visibility alone is not semantic shot quality.

The output explicitly carries `readyForFinalRender: false` and `semanticIntentValidated: false`. It is not connected to the product, has made no paid calls and has not edited saved cameras. Do not remove those limitations merely to make a test pass. Object bounds and sparse ray samples are conservative approximations, not exhaustive collision or composition proofs.

To reproduce the offline experiments from that worktree:

```sh
node experiments/location-quality/check-feasibility.mjs
node experiments/location-quality/check-auto-coverage.mjs
```

The existing bus, furniture, shelf and camera-preview regression suites also passed when the inventory experiment was introduced. Report their relevance, not their combined count, to the owner.

## The next substantive development task

Build and validate a **shared automatic scene-and-shot planning process** before claiming the first-result requirement is met:

1. Interpret the whole brief into a complete, versioned inventory separate from story anchors, including required counts, relationships, measured/proposed dimensions and unresolved requirements.
2. Construct that inventory using reusable object/arrangement rules or a bounded cloud authoring path. Unsupported objects must not silently become an acceptable final set because a box is numerically valid.
3. Determine four meaningful shot intents from the location, inventory and relevant scene context: what each frame must show and how the four views complement each other. The semantic stage should reference known subjects and desired framing, not invent unverified camera coordinates.
4. Resolve and search camera poses against the exact scene used for preview and cloud authoring. Perform internal candidate selection/refinement before showing the final result. Preserve explicitly locked user choices and confirmed geometry; invalidate stale proposals after edits.
5. Verify final rendered visibility, useful coverage, readability and completeness; then verify styling against that same scene revision. Keep correction attempts bounded and cost-visible. Do not silently submit repeated paid generations.
6. Judge actual first-delivered results on varied existing and held-out locations, without operator camera-coordinate overrides or bespoke repairs. Keep unsupported/ambiguous inputs distinguishable from successful results. A few corrected examples cannot establish universal reliability.

The existing semantic context may help avoid extra paid calls: `aiDraftLocationSpatialPlan()`, `aiDraftStaging()`, `locationStagingStations()` and `locationRequestedViews()` already contain description/staging intent. However, those words are not yet a robust structured subject/coverage contract. Reading them with fragile keyword matching would not establish the requested generality. Any new writing call must use the normal price/hold, scope and access controls.

The owner has authorized work toward this general solution. They have **not** authorized silently changing every saved floor plan, adopting new artwork, increasing prices, or treating internal trials as production success. Do not change or remove the already-published workflow merely because the experiment is incomplete.

## Code map and implementation constraints

- `app/locations.jsx`: spatial-plan normalization, review/signatures, anchors, saved camera poses, family/subspace logic and staging helpers. The 24-anchor limit is near `normalizeLocationSpatialPlan()`.
- `app/locations-ui.jsx`: numbered steps, camera proposal/application flow, map interactions and idea/match controls.
- `app/ai.jsx`: `APP_FEATURES`, AI floor-plan and staging drafting, image-camera read helpers. Keep Frances's feature knowledge accurate.
- `app/blender-render.js`: `buildScene()`, `proposeCameras()`, camera/geometry validation, proposal signatures, cloud job controls. Default proposals mostly reason over saved anchor envelopes, while detail construction occurs later.
- `app/blender-set-kitchen.js`, `app/blender-set-detail.js`: procedural assemblies. The bus expansion depends on explicit counts/pitch; unknown groups remain proxies.
- `app/camera-angle-preview.js`: actual numerical-scene meshes, projection, inspection, software preview. Preview lighting is deliberately neutral and differs from final Blender lighting.
- `app/camera-framing.js`, `app/camera-match.js`: actual-mesh visibility and approximate composition transfer; potential reusable pieces, not a completed automatic director.
- `app/blender-render-contract.js` and `supabase/functions/blender-render/scene-contract.js`: strict versioned data contract. Current limits include 500 objects and a 262144-byte scene payload. Do not silently truncate complete inventories to fit.
- `app/blender-style.js`, `app/blender-style-ui.jsx`: style source binding, drafts, cancellation, comparison and explicit adoption.
- `supabase/functions/blender-render/`: authenticated job/lease/storage lifecycle. Scene-header validation supports the newer Blender file format; a prior compatibility bug was fixed in worker and service.
- `docs/Cloud Set Integration.md`: implementation history and rollout evidence. Read later dated sections as superseding earlier rollout gates; some earlier paragraphs are historical.

Coordinate convention is metres, +Z up, +Y north, +X east. Camera yaw is **clockwise from +Y**, with direction `[sin(yaw), cos(yaw)]`; pitch is positive upward. Do not confuse this with the object's negative-Z facing rotation. A mistaken sign was corrected in the local gym diagnostic. The renderer/browser use a 36 mm sensor convention and exact 16:9 panels.

## Local pages and configuration

Both local servers were started for the owner on 9 November but are **not responding as of this handover check**. A visible old browser tab does not prove a server is running.

| Address | Purpose |
|---|---|
| `http://127.0.0.1:5000/` | Original source development app, served by `node serve.js` in the root checkout; browser JSX compilation. |
| `http://127.0.0.1:5079/TURN.html` | Full compiled Blender test app served by the separate operator review server. |
| `http://127.0.0.1:5079/` | Older kitchen engine-comparison wrapper, not the full app. |

Both full local app pages read the root project, not separate Git branches; compiled assets can lag source. Their CSS was byte-identical when the owner reported a visual mismatch. The precise cause of that mismatch was not established. Do not claim an intentional separate design.

Root `app/supabase-config.js`: `setBuild: true`, **`setBuildMcp: false`**. The test server overrides only its served copy to true. The published release branch has true in production config. Do not mistake the local switch for the live site's setting.

Start the original source server on this Mac:

```sh
cd /Users/macbookpro/Desktop/TURN-v7
node serve.js
```

Start the compiled test/comparison server in a second terminal:

```sh
cd '/Users/macbookpro/Desktop/Kinolot Blender Tests/Cloud MCP Okafor kitchen test-nkjrstq2/engine-review-v2'
KINOLOT_DETAILED_SET_TEST=true KINOLOT_REVIEW_COMPILED_APP=true python3 server.py
```

The test server serves root `dist/index.html` at `/TURN.html` and expects exactly one `setBuildMcp: false` in the source config when its override is enabled. Changing root config to true without updating the override causes a deliberate configuration error. Rebuild `dist` only when appropriate; `npm run build` regenerates the two tracked add-on outputs `app/blender-addon-data.js` and `app/downloads/cinema-machine-blender.zip`. Those are build-owned artifacts, separate from the two protected user edits above.

## Cloud services, safety and release mechanics

Main Replit app: `https://replit.com/@aformoso/TURN-v7`, ID `93b4a4c4-db87-4681-81ad-9148e6e104bc`.

Worker Pilot: `https://replit.com/@aformoso/Kinolot-Blender-Worker-Pilot`, ID `aa3eeb18-41ee-45cb-ad1a-0e9d783a20cc`; endpoint `https://kinolot-blender-worker-pilot.replit.app`. Worker Git remote is **`a-formoso/kinolot-blender`**, not the app remote. The owner repeatedly opened the worker Shell when main was intended, so use explicit repository guards for any sync commands.

Worker review checkout: `/private/tmp/kinolot-worker-review-20261105`, last reviewed worker source `701c0b1`. Cloud uses Blender 5.2.3 LTS; local diagnostic renders used `/Applications/Blender.app/Contents/MacOS/Blender`, version 4.5.12 LTS. Do not describe local diagnostic output as a production/cloud test. End users should not need a local Blender installation.

Supabase project: `vubenblfdzginlqiglzw`. The controlled test film is Half Strength, project `f8b3e711-dfd4-4de2-b9d5-f9318f6031d2`. Relevant locations: `loc-school-gym-0`, `loc-school-bus-1`, `loc-okafor-kitchen-2`. Private review evidence contains full user film data; do not commit it or expose signed URLs/credentials. Existing management access on this Mac was used read-only for diagnosis except the specifically approved, backed-up vent correction. Secret-list values returned by the management API are digests, not usable provider credentials; an earlier direct-provider test failed before image processing because of that distinction and is not evidence that the provider itself was broken.

Follow `CLAUDE.md`'s Replit preservation procedure before any sync. Actual workspace state matters; stale branch names are not evidence. Main's earlier workspace checkpoint was preserved at `codex/pre-location-release-20261108`, and the pre-full-bus update at `codex/pre-full-bus-release-20261108`. The reviewed public release contains the preserved workspace history. Current Replit workspace state has not been re-queried for this handover; fetch/preserve before touching it.

Replit publish tools worked and publication was verified through status plus public assets. Agent update/question requests sometimes returned blank replies and did not actually sync code. Do not treat request acceptance as completed work. Manual guarded Shell sync was the reliable fallback. No automatic public publish is needed merely to continue the experiments.

Local browser automation was disabled by Work settings during earlier testing. That restriction was respected; no user-profile credential extraction or CDP bypass was used. Do not assume fresh browser control without checking the supported tool surface. Local disposable headless review pages were separate from the signed-in browser.

## Practical continuation checkpoint

The cloud execution infrastructure works, and the public release is deployed. The **automatic first-delivered quality requirement is still unfinished**. The clean experimental worktree contains reusable numerical experiments and documented counterexamples; it contains no integrated semantic planner or production quality gate. Continue from that truthful baseline, focusing on meaningful automatic coverage and complete construction, with actual output as the acceptance criterion. Blender Studio expansion remains deferred until the location work reaches the agreed quality standard.
