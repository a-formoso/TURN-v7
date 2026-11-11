# Location consistency: feasibility evidence

This is an offline experiment, **not a shipped feature or a claim of universal reliability**.
It does not call image models, submit cloud builds, edit saved films, change billing or alter the running local pages.

## What the existing implementation establishes

The detailed kitchen and corrected school bus demonstrate that one fixed numerical scene can be built and rendered from several saved cameras, then styled. They do not establish complete natural-language interpretation for arbitrary locations. The builders currently recognise a finite collection of object types and several location-specific assemblies.

The saved spatial plan normaliser retains at most 24 anchors. These are useful story landmarks, not a complete object inventory. A 30-seat classroom cannot safely be represented by adding 30 ordinary anchors to the current plan: six will be dropped. A single anchor called “classroom seating” also cannot establish individual seat geometry or quantity. The bus has its own repeat expansion, but that mechanism is not shared with other locations.

## Shared inventory prototype

`inventory.mjs` expands explicitly measured furniture templates into independently declared quantities and row/column placements. It uses the real existing furniture assemblies, not an image reconstruction or new per-room modelling code. It retains the saved template, cameras, lights and unrelated geometry, and never invents persisted story anchors for background units.

The independent inspector compares emitted parts and placement with requirements plus the original template. A missing part, changed placement, extra repeated object or unintended camera/light/environment edit fails inspection. Counts are not inferred by counting mesh pieces or reading their display names. Unknown templates represented by a single solid block cannot pass as detailed furniture. Existing renderer object and payload limits are enforced; excess complexity is refused rather than silently truncated.

Run from the repository root:

```sh
node experiments/location-quality/check-feasibility.mjs /tmp/kinolot-location-quality-proof-20261109
```

The current matrix passes 49 checks using actual scene construction and preview meshes:

| Synthetic fixture | Explicit repeated requirement | Completed units | Scene objects |
|---|---|---|---|
| Classroom | Chairs | 30 | 186 |
| Cafe | Tables | 12 | 66 |
| Dormitory | Beds | 8 | 78 |
| Changing room | Wardrobes | 10 | 96 |
| Dining room | Chairs, including rotated copies | 8 | 54 |

These are **single-furniture-family test fixtures**, not fully dressed, visually approved classrooms, cafes or other completed locations. They establish shared count/part/placement integrity and deterministic reconstruction. They do not prove that the layouts are attractive, that every room object was specified, or that final renders and styling meet the brief. The known anchor-cap regression, invalid counts/spacing, unsupported solid-block templates and renderer capacity refusal are tested as well.

## Required implementation before broad reliability can be claimed

1. **Complete structured requirements.** Produce a versioned inventory separate from story anchors, with stable object identities, counts, dimensions, orientations, explicit repeated arrangements, required clearances and unresolved requirements. Extract it from the whole brief, not only continuity landmarks. Compare back to the brief so omissions are detectable. Distinguish user measurements from proposed design. Do not silently alter existing films or treat inferred measurements as confirmed.
2. **Reusable construction and declared coverage.** Reuse object assemblies and explicit arrangements across locations. Record which requirements have real geometry, which are approximated, and which remain unsupported. Add missing object families or a bounded cloud asset-authoring route; duplicating a box does not make an unsupported object correct. Maintain deliberate object/complexity budgets without dropping inventory.
3. **One scene for preview and build.** Resolve the full inventory into the versioned scene before suggesting cameras, and use that same scene revision for browser preview, visibility checks and cloud authoring. Camera changes must leave geometry unchanged. Edits must invalidate older proposals and renders. Background inventory needs addressable subjects for camera coverage, without fabricated saved anchors.
4. **Spatial and camera checks.** Verify floor/ceiling boundaries, relationships, collisions, required paths and camera clearance against the actual assembled geometry. Distinguish intentional contact/containment from collisions. Grade distinct wide/detail coverage and target visibility, rather than treating four finite camera records as four useful shots. The current prototype deliberately does not claim these checks.
5. **Actual output checks.** Use object-ID/depth passes to verify expected visible subjects and coverage after rendering; inspect image readability and lighting separately. Compare styled output against the same build for object placement, structural features and appearance drift. Image-only judgement cannot establish hidden inventory. Repairs must be bounded, must not change confirmed inputs silently, and must not cause unapproved paid retries.
6. **A held-out evaluation collection.** Add varied interior, vehicle and exterior fixtures with independently authored requirements, including unfamiliar arrangements, tight spaces, unusual shapes and unsupported objects. Test missing objects, wrong counts, clipping, blocked views, dark output and styling drift. Publish capability and failure rates, not an “all locations” promise inferred from a few passing examples.

## Feasibility conclusion

Consistent numerical inventory and repeatable fixed geometry are achievable: the shared prototype demonstrates those properties beyond the kitchen and bus, within current renderer limits. Reliable automatic interpretation, full construction coverage, good camera composition, final lighting and styling fidelity remain separate unproven requirements. A service that reliably flags or refuses unsupported requirements is achievable sooner than one that successfully builds every conceivable location. Neither should be presented as the other.

## Automatic first-delivered views: geometric search experiment

The owner's requirement is a useful **first delivered result**, with camera selection and any internal adjustment completed automatically before the final render. Manually repairing each location does not satisfy it. An internal process can try several inexpensive candidate views while remaining one action for the user. It must not silently change a confirmed layout, overwrite deliberately locked cameras, or submit additional paid attempts.

`auto-coverage.mjs` explores camera stations inside the actual footprint, rejects stations within the assembled parts' bounds, evaluates complementary wide coverage, and checks distinct detail subjects using actual mesh-ray visibility. It ignores the existing scene's camera angles as search seeds. The output is explicitly marked `readyForFinalRender: false`: geometric visibility alone cannot establish useful subjects or complete geometry.

```sh
node experiments/location-quality/check-auto-coverage.mjs
```

The same algorithm was also exercised read-only on the owner's saved gym, bus and kitchen scenes, with no per-location camera-coordinate overrides. It found geometrically visible alternatives. However, its unconstrained detail selection chose the kitchen's counter runs instead of its sink/fridge combination, and the gym's coach table instead of a more representative fixture. **That is a product-quality failure despite successful visibility.** These proposals have not been saved, submitted to the cloud, integrated or published.

The production architecture therefore needs a semantic shot-intent stage, grounded in the complete inventory, location brief and relevant scene context, followed by geometric fitting and final-image verification. It should identify subjects and coverage goals, not invent unverified camera coordinates. Reuse existing description/staging context where sufficient; any additional model call needs normal pricing, scope checks and a bounded cost policy. Missing subjects, contradictions and unsupported geometry must be handled before claiming a final result. Semantic intent, actual construction, framing, visibility, lighting and styled fidelity must be evaluated together on held-out locations. A hand-tuned gym demonstration is not evidence that this automatic path works.

## 11 November: the camera half is now in the app (branch `claude/auto-cameras-20261111`)

`app/camera-coverage.js` replaces this folder's `auto-coverage.mjs` experiment with one planner and one check for every
location (see "Automatic camera coverage and the camera check" in `docs/Cloud Set Integration.md`). `harness.mjs` loads
the app's real floor-plan and set-building code in Node; `quick-view.mjs` draws a fast diagnostic picture of four
cameras from the same ray queries, to judge framing in seconds before a real render. The inventory experiment
(`inventory.mjs`) is unchanged: complete construction is the next step and is not solved by better cameras.
