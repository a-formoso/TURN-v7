# Props: screenplay evidence and physical identity

Props are physical objects that need continuity because they are handled, read,
exchanged, altered, repeatedly visible or important to the story. Worn, carried and
set dressing are default bindings, not separate identities. General architecture
stays in Locations. Important set objects can link to a location without creating
a second layout.

**Not props:** characters, animals and creatures are cast (a proposal named after a
cast member is rejected). Blood, wounds, dirt and makeup are character appearance.
A vehicle that scenes take place inside is a location; a vehicle is a prop only when
its exterior is seen or used and must stay consistent (set dressing, noted as a
vehicle). A group is one prop only when the text treats it as a unit (a stack of
files); ambient multiples (cars in traffic, bottles on a shelf) belong to the location.

## Extract, review, design

1. **Extract screenplay props** reads every written scene using the writing model.
   Long scenes are split without dropping text. It generates proposals, not images.
2. Review exact source passages, identity, aliases, classification and document
   content. Choose **Add as new object**, link to an existing object, or **Skip**.
   Dialogue-only and off-screen mentions start skipped. Exact source validation
   proves that a quote exists, not that the model interpreted it correctly.
3. Separately opt in to proposed continuity events. Handoffs require a known holder;
   placements require a known location. Timing is grounded in the source beat.
4. **Apply reviewed proposals** adds records or evidence. Linking preserves existing
   names, ownership, specifications and images. It never merges two existing cards.
5. **Draft specification** designs the object's appearance using its source evidence
   and existing design. Unspecified measurements are estimates, not verified geometry.
   Generate images separately when ready.

The review panel reports failed scenes and rejects unverified quotes. Cancellation
stops subsequent model calls; it cannot undo the request already in flight. Review
proposals are temporary until applied. A source changed during review blocks apply.

## Identity and grouping

Same noun is not same object: two phones, three letters and an original/photocopy
must remain distinct unless evidence establishes otherwise. A notebook travelling
between people remains one canonical asset. Re-extraction can link evidence to an
existing card; repeated passages/events are deduplicated.

The default grid shows **Story props**. **Wardrobe & accessories** holds ordinary
wearables; **All objects** includes both. **Not in screenplay** lists cards the
screenplay hasn't established (character-brief proposals and older unlinked cards;
hand-added props are exempt). They carry an amber badge in the card's Screenplay
evidence header until extraction links a passage to them. Brief-only wardrobe is normal. Change the group in Object to promote a
significant accessory. Existing sheets remain intact. Character brief imports are
design proposals, not screenplay facts. Incomplete names are flagged for repair,
never expanded into invented objects.

## Own image or text only

Object → **Reference image** decides whether a non-worn object gets its own image.
**Auto** reads reviewed evidence: handled on screen, seen in two or more scenes,
story events or readable content → own image; seen once and never handled, or only
mentioned → **text only**. Without reviewed evidence (hand-added, brief-only, or
evidence needing review) a card keeps its own image. Text-only objects are skipped by
Generate all images, per-scene generation and Props Master, are never auto-generated
when a shot renders, and appear in shot prompts as a short written description. An
image generated on the card is always attached.

## Scene mapping

Deterministic, no model call: reviewed passages give exact scenes, worn items follow
their owner's on-screen presence, and cards the screenplay hasn't established map to
the scenes whose action text names them (dialogue doesn't count). The Art Room's
Production check doesn't tag props; its checks read the props mapped to each scene.

## Card sections

- **Object:** identity, aliases, owner/custodian, design association, physical spec,
  dimensions with measurement basis, and document/label/screen content.
- **Screenplay evidence:** reviewed passages, source-change warnings and separately
  labelled lexical discovery. Superseded quotes remain in source history.
- **Narrative significance:** what the object means dramatically, not its surface markings.
- **Continuity · story events:** sparse state changes, including Updated events for
  later content/version changes. The state resolver carries these forward. Older
  appearance states and custody handovers convert into events when the card opens.
- **Generation prompt:** style details, compiled prompt and exclusions. No separate
  Look dev fold. Specified writing ON an object is allowed; sheet annotations are not.
  Generated lettering still requires visual checking.

Screenplay changes deterministically refresh reviewed source appearances and
wearable physical-presence estimates; there is no paid background extraction.
Missing matches never remove cards or images. Legacy carried maps refresh on an
explicit draft/remap. Props Master no longer performs hidden extraction or automatic
duplicate merging; use the review workflow for screenplay additions.

Run regressions with `node scripts/test-prop-screenplay.mjs`. An isolated UI fixture
is available via `node scripts/preview-prop-review.mjs`; it does not touch saved projects.
