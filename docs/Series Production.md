# Series production contract

TURN models a series as one continuity-bearing **Show** plus independently saved
**Episodes**. This document is the operational contract for that model; it does
not change the story-building steps in `Story Pipeline.md`.

## Data ownership

- A Show is a `turn_projects` row with `project_kind = 'show'`. It owns the title,
  canonical format, team, shared Bible, and shared generated assets.
- An Episode is a `turn_projects` row with `project_kind = 'episode'`, a normalized
  `show_id`, and a positive `episode_no`. It owns its scenes, beats, screenplay,
  shots, storyboards, history, framework, and episode-specific state.
- A malformed or orphaned legacy JSON relation is recovered as a standalone Film.
  Migration removes its stale `showId` / `episodeNo` markers, and clients also let
  normalized `project_kind`, `show_id`, and `episode_no` override legacy JSON so
  the recovered story stays visible, openable, and saveable during a mixed-version
  rollout.
- For a valid legacy Episode, migration validates the parent Show Bible before
  removing hydrated character/location/prop/lookbook copies from the Episode. A
  missing Bible department is recovered from the Show's legacy root or from all
  linked Episodes in stable episode-number/id order. Episode copies must agree;
  malformed or divergent copies abort the transaction rather than choosing one
  and silently erasing the others. Re-running the migration does not keep bumping
  revisions.
- The shared Bible contains characters, locations, props, lookbook references,
  the lookbook note, and the recoverable tombstones for deleted characters,
  locations, and props. Those departments must not be copied into Episode rows.
- An Episode restore bin owns only deleted shots. The application combines that
  shot bin with the Show's shared entity bin in memory so existing Art Room tabs
  keep one restore-bin interface without giving either database row mixed ownership.
- Shared entities keep scene membership in `episodeScenes[episodeId]`. Local scene
  ids such as `s1` are not globally unique and must never be compared across
  Episodes without the Episode id.
- Shared locations keep screenplay-derived usage in
  `episodeLocationMeta[episodeId]`: `times`, `areas`, `intExt`, `scope`,
  `parentKey`, and `continuityRootKey`. The familiar flat fields remain a
  compatibility projection for Show-level readers: times and areas are stable
  unions, INT/EXT and scope widen safely, and hierarchy resolves deterministically.
  Opening an Episode materializes only that Episode's slice for Location Scout;
  it never presents another Episode's usage as local screenplay evidence.

## Required invariants

The database, not only the browser, enforces these rules:

1. A Show cannot also be an Episode.
2. An Episode must have a real Show parent owned by the same account.
3. Episode numbers are unique within a Show and allocated under a database lock.
4. A normal save cannot detach, move, or renumber an Episode, or convert a film
   into a Show outside the lifecycle RPC.
5. The Show owns the format. Episode hydration and persistence use that canonical
   format; an Episode can still choose its own narrative framework.
6. Shared-Bible writes preserve every other Episode's scene-reference slice and
   use a baseline-aware merge so a stale collaborator cannot erase newer entities.
7. An Episode is not displayed until both it and its Show Bible have loaded. A
   missing or unauthorized Show fails closed rather than exposing stale data.
8. The final Episode cannot be deleted independently. That action becomes an
   explicit whole-Show deletion so no empty, inaccessible container is stranded.
9. A Show Bible is accepted only when every required department is explicit and
   correctly typed. Shared entities and tombstones require stable ids, and any
   `scenes` / `episodeScenes` relationship metadata must use arrays. An entity
   cannot be both active and deleted in the same canonical department.
10. Deleted characters, props, and locations are Show-owned regardless of which
    Episode deleted them. Their recovery cannot depend on the originating Episode
    continuing to exist; deleted shots remain exclusively Episode-owned.
11. Deleting an Episode removes that Episode id from `episodeScenes` and
   `episodeLocationMeta` on both active and deleted shared entities, while every
   sibling Episode slice remains intact. Flat scene and location compatibility
   fields are rebuilt solely from those surviving slices; when no slices remain,
   they are explicitly empty rather than retaining evidence from the deleted Episode.
12. Team email identity is canonical lowercase and unique case-insensitively per
    project. A differently cased duplicate cannot retain access after removal.
13. A shared location save may replace only the calling Episode's
    `episodeLocationMeta` slice. Sibling slices come from the freshest Show row,
    and the flat Show-wide projection is rebuilt after every merge; ordinary
    hydration or location derivation must never make those fields last-writer-wins.
14. Every Episode key stored in an active or deleted shared entity must identify
    a live Episode whose `show_id` is that Show. A database trigger validates and
    relationship-locks those rows during the Show update, so an Episode deletion
    and a late Bible save cannot race an orphaned slice back into canon.

## Lifecycle operations

The application uses owner-only, transactional RPCs from
`supabase/series-production.sql`:

- `turn_convert_project_to_show` atomically creates the Show and attaches the
  existing film as Episode 1. A TV Series New Story converts automatically, but only
  once its build (the Adaptation agent) has finished writing — converting mid-run swapped
  the cast for the Show Bible under the running agent (2026-09-26). If the RPC response is lost or incomplete, the
  client reads back and verifies the Episode/Show relationship; it either returns
  that committed pair or keeps an explicit safe-retry state. A retry returns the
  same committed pair.
- `turn_create_show_episode` reserves the next number and creates a blank Episode.
  A client request id makes ambiguous network retries idempotent. That id belongs
  only to the active create intent in the current app window: an ambiguous retry
  reuses it, while another tab or a later unrelated attempt receives a fresh id.
- `turn_delete_show_episode` removes one non-final Episode while preserving its
  Show, siblings, team, Bible, and all shared or still-referenced assets. The
  client always asks this RPC first. If it reports the final Episode, TURN reloads
  the family from the server before offering whole-Show deletion; a stale browser
  count is never authority for deleting the broader Show.
- `turn_delete_show` removes the Show and every Episode as one database operation.

If these RPCs are missing, TURN must stop and report that the series migration is
required. It must not fall back to a sequence of browser-side inserts/patches that
can leave an orphan after a timeout.

## Save and switching rules

- Before switching project, creating an Episode, converting a film, signing out,
  or crossing any Show/Episode boundary, TURN flushes the latest pending snapshot.
- Save responses are scoped to the project and generation that launched them. A
  late response from Episode 1 cannot mark Episode 2 clean or replace its baseline.
- A completed Episode-create request is always added to the Show, but it opens
  automatically only if the launching project/navigation scope is still active.
  A late response cannot pull the user back from Home or another project.
- If an older Bible write finishes after a newer local snapshot already exists,
  TURN carries the merged server Bible and that write's local checkpoint into the
  serialized successor. The successor rebases before writing, so collaborator
  additions survive while a genuine newer local deletion still remains a deletion.
- Episode saves and Show-Bible saves are separate writes. When one edit touches
  both rows, TURN persists the Episode-owned story first and only then sends the
  Show-Bible update. The UI reports the edit durable only after every required
  write succeeds.
- The closed account chip gives `Saving`, `Retrying`, and `Not saved` precedence
  over a Writer or Art director role label. The role remains visible as secondary
  account detail, so collaboration identity never masks save health.
- When one edit touches both rows, TURN first writes a bounded, account-scoped
  recovery journal in browser storage. It replays the idempotent patches before a
  newer save and whenever that Episode opens, and removes the entry only after
  both rows confirm success. If the journal cannot be written, neither cloud
  request starts.
- Concurrent Bible writes use the last durable client baseline for a three-way
  merge. Latest-only entities survive; a local deletion is derived from an entity
  present in the baseline but intentionally absent from the incoming snapshot.
- Shared restore-bin buckets use that same baseline-aware merge. Independent
  deletes and restores from different Episodes compose; two edits to the same
  tombstone stop as a visible conflict. A Show save is launched only when one of
  the touched Bible departments differs from its acknowledged baseline, so an
  Episode-only shot-bin edit does not manufacture an unrelated Show revision.
- Location hierarchy synchronization, screenplay pulls, batch specification runs,
  and agent-driven location pulls all update the active Episode's metadata slice.
  Film-to-Show conversion seeds Episode 1, and hydration scopes it back to the
  Episode before the existing Art Room UI consumes the flat fields. A concurrent
  Episode can therefore discover a different time, side, subspace, or hierarchy
  without erasing either discovery.
- The journal also records baselines for every Episode-owned section in its
  Episode patch. Replaying an already-committed half is idempotent; if another
  collaborator changed the same section afterward, recovery stops with a conflict
  instead of replacing their work with the older journal snapshot.
- The mixed-domain `project` object also uses a baseline-aware shallow three-way
  merge. Non-overlapping keys (for example writer metadata and Art Room
  `styleBible`) compose; divergent edits to the same key stop with a conflict.

Supabase cannot make the Episode row and Show row one cross-row client
transaction. The recovery journal closes the crash window without pretending
conflicting canon can be merged automatically; an overlapping three-way conflict
stays visible in the current window as `Not saved`. TURN never reloads over that
edit automatically. It asks before replacing local state with the cloud version;
canceling keeps the edit on screen for review or copying.

## Shared assets and deletion

Canonical character, prop, location, and lookbook files use the Show's asset
scope. Film-to-Show promotion is idempotent and verifies an existing destination
record before skipping it. After an ambiguous insert response, copied files are
not removed until TURN proves that no committed generation references them.

The same scope applies while an entity is in Recently deleted. Its full tombstone,
generated sheet history, and namespaced scene links remain in the Show Bible and
are visible and restorable from every Episode. Conversion and legacy backfill move
shared tombstones into the Show before reducing each Episode bin to `trash.shots`;
new Episode creation performs the same split. Consequently, deleting the Episode
where a shared entity was first removed does not erase the recovery record. A
restored entity returns to shared canon with the same id, while a deleted shot can
only be recovered from the Episode that owned it.

Every newly uploaded object also gets a server-side upload intent before its
bytes are sent. The intent is bound to the exact object path, uploader, and
project; it requires current Art Room write access, is capped per account, and
its upload-reservation window ends after 30 minutes. Existing object names cannot
be reserved, and an exact path has only one live reservation even across the same
user's tabs. Expiry never discards the cleanup obligation: expired and
project-deletion-interrupted intents move atomically to a durable exact-path
cleanup queue. The queue's worker contract is installed (service-role only:
`turn_claim_asset_cleanup_batch` leases bounded batches, `turn_complete_asset_cleanup`
acknowledges them, failed work returns to the queue), but **the scheduled worker
itself is not implemented yet**, so nothing drains the queue today. Once a
project row is gone, Storage's read rule hides its files from every signed-in
user, so neither the uploader nor the owner's one-hour cleanup grants can remove
them either; `admin-inventory.sql` lists such files as `queued-for-cleanup` or
`orphan: project deleted` for removal from the Storage dashboard. Once a generation or Cameo row is durably confirmed, a
database trigger retires the matching intent or queued obligation in the same
transaction; the client's finish call is an idempotent acknowledgement. This
never restores project-wide access or leaves a delete capability attached to a
committed asset.

Delete RPCs inventory exact generation and Cameo object paths inside the database
transaction. After commit, the owner receives a short-lived, DELETE-only cleanup
grant for those exact keys. For a single-Episode delete, the database itself
subtracts every path still referenced by the Show or a surviving Episode before
writing the grant; client-side filtering is defense in depth, not the security
boundary. Database deletion is reported as successful even if file cleanup is
partial, but the UI must show the cleanup warning honestly so an operator can
retry it.

If a delete response is lost, TURN reads the project row back before changing UI
state or touching Storage. A confirmed-absent row is treated as a committed
database deletion and only the exact preflight manifest is cleaned. Because the
transaction-time manifest was lost with the response, TURN retains the temporary
cleanup grant until expiry and reports that narrow uncertainty; if row absence
cannot be verified, no cleanup is attempted.

## Collaboration

Membership is managed once on the Show and inherited by existing and future
Episodes. A legacy direct Episode invitation may read that Episode plus the Show
Bible, but it does not grant sibling access. Show role changes and removals are
broadcast to an open Episode immediately and remain enforced by RLS.

An unrecognized or missing shared role is never treated as ownership or a valid
department role. Both rooms fail closed to read-only, and the standing banner,
account menu, project card, and presence label report **Role unavailable** until
the owner assigns a current role. Writers may inspect but not change the Art Room;
Art directors may inspect but not change the Writers' Room.

The collaborative project UPDATE policy exists only so writers and art directors
can persist the `doc` departments assigned to their role. A database trigger
separately protects the project-row envelope: non-owners cannot rename the row,
transfer it, change its identity or timestamps, or rewrite `project_kind`,
`show_id`, or `episode_no` through a direct REST request. Normal role-scoped doc
saves remain allowed; lifecycle metadata continues to be derived by the series
RPCs and sync trigger.

## Deployment order

Run the Supabase SQL files in the order documented in `supabase/README.md`, with
`series-production.sql` after the collaboration and role-scope migrations. Before
running it on a live project, run the read-only `series-production-probe.sql` and
clear every `STOP` row. The migration checks its own prerequisites first and stops
with a `TURN_SERIES_PREREQUISITE` message (changing nothing) when one is missing.
`series-production.sql` must always run LAST: re-running
`migrate-remove-producer-admin.sql`, `shared-owners.sql`, `team-collaboration.sql`,
`enforce-role-scopes.sql`, `storage.sql` or `cameos.sql` silently puts back an
older, non-Show-aware rule, so re-run the series migration after any of them
(after `storage.sql`, run `enforce-role-scopes.sql` first). The README has the
per-file details.

The migration is idempotent, but it is still a production database change. Apply
it in a staging project first, run the series regression script, then smoke-test:

1. Convert a populated film and reload Episode 1.
2. Create two Episodes concurrently and confirm distinct E-numbers.
3. Edit one shared character from two Episodes and confirm neither Episode loses
   the other's scene bindings.
4. Invite a collaborator at Show scope and verify access to a newly created Episode.
5. Delete a non-final Episode and confirm the Show, sibling, and shared sheet remain.
6. Delete a character in Episode 1, restore it from Episode 2, delete it again,
   then delete Episode 1; confirm its tombstone and generated sheet remain
   recoverable from Episode 2 while Episode 1's deleted shots do not appear there.
7. Delete a test Show and confirm the Show and its Episodes are gone. Its Storage
   objects stay until the cleanup worker exists (`admin-inventory.sql` lists them
   as `orphan: project deleted`).
8. As an Art director, pause a generation after upload, delete its Episode as the
   owner, then resume it; confirm the row insert fails and that uploader's
   uncommitted object is queued for cleanup (listed as `queued-for-cleanup`).
9. (Once the cleanup worker exists.) Let an upload intent expire without
   committing a generation, run the worker against `turn_claim_asset_cleanup_batch`,
   and confirm the exact key is
   retained on failure and disappears only after Storage removal plus
   `turn_complete_asset_cleanup` acknowledgement.
10. Invite the same address with mixed casing, remove it once, and confirm only
    one canonical membership exists and access is gone from every Episode.
11. Start an Episode + Bible save, reject the Episode half, and confirm no Bible
    write is attempted and the local recovery journal remains available.
12. In one tab request deletion of the apparent final Episode while another tab
    creates a sibling; confirm TURN refreshes the family and deletes only the
    requested Episode rather than escalating to whole-Show deletion.
13. Pause a Bible save while deleting its Episode from another session; confirm
    the relationship trigger rejects the late Episode-keyed slice and no stale
    flat scene or location projection survives.
