---
name: Revocation-sticky asset policies
description: Storage/generation RLS must authorize by CURRENT membership, never by folder or row ownership alone.
---

**Rule:** Every read/delete policy on shared-film assets (storage objects, generation rows) must require CURRENT project authorization (`turn_can_access_project` / `turn_can_write_assets`). Never keep a standalone "own folder" (`foldername[1] = auth.uid()`) or "row owner" (`owner = auth.uid()`) disjunct for project-scoped assets.

**Why:** A removed or demoted art director otherwise keeps reading and deleting the files they uploaded while they had access — revocation wouldn't stick. Caught by architect review; the "own folder" branch felt harmless because writes are pinned there, but it's an authorization path that survives membership changes.

**How to apply:** When adding any new asset table or storage path convention, authorize via the membership helpers keyed on the project id embedded in the path (`turn_storage_project_id`; every path is `<uid>/<projectId>/<assetType>/...`, parser returns null → fail closed). Cross-folder cleanup (regeneration rolling off history under another member's folder) is already covered by the capability helper — no ownership exception needed.

Related facts:
- Asset writes are ART-department capability: film owner or active `art_director` only (`turn_can_write_assets`); writers/view-only keep read. Generation-row attribution is immutable (`turn_generations_keep_owner` coerces owner on update — the client upsert always sends its own uid).
- Stage cloud persistence (`cloudCommitVideo`/`cloudCommitAudio`) is an UNDEFINED extension hook today; if it's ever built, the asset policies need a stage-capable branch or writers can't persist stage media.
- Server role-scope rejections are tagged `TURN_ROLE_SCOPE` in the error message; the client must treat them as PERMANENT (surface + reload), never feed the retry-with-backoff loop, and only claim "saved" after the recovery reload actually lands.
