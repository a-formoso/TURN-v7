---
name: Beat keyframe boundaries
description: Why screenplay beat openings, moving performance, and existing coverage must remain distinct.
---

Use the screenplay's opening situation for a beat's default still, not a montage or the beat's most dramatic later event. Keep the full beat separately as motion/dialogue context.

**Why:** The intended workflow uses a still as the initial condition for video. Automatically breaking a beat into inserts and reactions defeats that workflow; collapsing the same beat's later events into the opening image depicts events before they happen.

**How to apply:** Check default drafting, repairs/backfills, refinement and autonomous production paths together. Extra coverage is a deliberate choice, not something missing-microbeat checks should silently recreate. A long beat may exceed video limits; report that rather than omitting dialogue or silently creating more Art Room shots.

Dramatic participation, visual presence and audible speech are separate facts. Driver/reactor assignments, name mentions, SMS senders and voicemail cues cannot establish a body in a room.

**Why:** A remote participant was incorrectly rendered beside the physically present protagonist when role metadata and text mentions were treated as visual references.

**How to apply:** Bind image references to screenplay presence at the selected frame's time and location. Carry remote speech as remote audio, never as lip-sync for the visible actor; SMS is not spoken dialogue. Preserve uncertainty rather than presenting weak name matching as direct page evidence.

Test cross-room source contracts with the actual shared helper and shipped script order, not only stubbed source reports.

**Why:** Isolated Stage tests once passed while the live helper's remote-delivery labels were interpreted as on-screen speech. A fake source object can hide exactly the mismatch that integration testing needs to detect.

Do not convert saved multi-shot beats during hydration or auto-repair. Explicit conversion must disclose what leaves the active sequence and preserve recovery.

**Why:** Saved coverage can contain rendered/approved work and downstream takes. The change in default shot granularity does not authorize deleting those assets.

Retaining old coverage does not make it a prerequisite for the next beat's opening frame. Default cross-beat continuity follows the primary frame shown on the beat card; alternatives remain deliberate choices.

**Why:** Showing one approved frame per beat while following hidden legacy tails blocked the next beat and misleadingly asked the writer to generate extra images.

**How to apply:** Keep primary selection consistent across cards, dependency checks, reference assembly and visual QC. A saved primary may follow older alternatives in storage order; derive a dependency order without rewriting saved work. Source-unverified is a review state, not proof an image is missing.

Explicit removal of old micro-beat coverage differs from drafting a replacement: an old beat's first shot can be removed too, while a deliberately promoted opening keyframe should remain.

**Why:** The UI can call the first legacy shot the primary merely because of its position. That label does not establish that the writer converted it to the new beat-opening workflow.

**How to apply:** Base reversible cleanup on saved coverage evidence and explicit modern/manual intent, not a shot's position or a displayed badge. Leave uncertain provenance for review; do not generate replacements as a side effect.

Full-scene screenplay images are reading context, not visual compositions or additional cast references.

**Why:** The full scene helps interpret an opening, but its later entrances and remote dialogue can also cause the image model to depict the wrong moment. A screenshot does not weaken the target beat's opening-presence restrictions.

**How to apply:** Keep complete scene text alongside page images, identify the target beat, and preserve opening-frame bindings. For Art Room stills, canonical identity/location images take priority over optional screenplay pages; disclose omissions. Stage video instead requires all pages, as below.

For Stage video, attach actual full-scene screenplay page images for each beat, alongside labeled source text. Keep the selected beat/shot/part as the performance boundary.

**Why:** Text-only delivery was explicitly rejected: the generator must receive the actual screenplay screenshot despite its image-slot cost. This behavior was later explicitly confirmed as working well. The page is reading context, never an opening frame or composition. Sending current source separately is still insufficient if editable direction narrates stale saved shot action.

**How to apply:** Verify actual image payloads, not just thumbnails or prompt text. Required Stage pages consume image slots and must never be silently omitted; block routes that cannot attach them separately. Preserve manual edits with source-drift review. Scene changes refresh reading context without adding another beat's performance. Reject known limits rather than excerpting source.

Stage's screenplay screenshots belong as individual image cards alongside the other reference images, not as thumbnails inside a screenplay disclosure.

**Why:** The user repeatedly rejected a text summary or grouped summary miniatures as a substitute for placing the actual pages in the image-reference strip.

**How to apply:** Keep the source-reading disclosure secondary. Check placement with it closed, and verify each page card opens the exact PNG and retains its actual input tag.

Missing screenplay-version provenance means unknown alignment, not evidence that the screenplay changed.

**Why:** A warning on every older card made missing tracking metadata look like a screenplay error. Silently stamping those cards current would be equally misleading.

**How to apply:** Preserve the unknown status in a quiet source note; reserve changed-source warnings for actual stamped mismatches. Updating the opening description remains an explicit writing-model operation, not an automatic repair triggered by viewing a card.

An explicit single-beat specification replacement needs usable model output; screenplay-backed defaults alone do not establish that a new specification was drafted.

**Why:** Full-scene creation can backfill missing beats, but silently using that fallback for a targeted redraft would replace saved camera/composition choices and report success without a new design.

**How to apply:** Keep bulk-creation fallback separate from explicit replacement. Reject unusable single-beat replies before changing saved shots or archiving alternatives, and show drafting progress only after confirmation.