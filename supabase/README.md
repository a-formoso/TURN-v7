# TURN × Supabase — setup

This wires TURN's Art Room to **Supabase Storage** (image binaries) + **Postgres**
(projects, metadata, version history), with **Supabase Auth** for sign-in. It
replaces the browser-only (IndexedDB/localStorage) storage so 4K generations,
cross-device access, and multiple projects all work.

## What you run (once)

1. **SQL Editor → run `schema.sql`** — creates the `turn_projects` and
   `turn_generations` tables (in the `public` schema, `turn_`-prefixed), with RLS
   and triggers.
2. **SQL Editor → run `storage.sql`** — creates the private `turn-assets` bucket
   and per-user access policies.
3. **SQL Editor → run `team-collaboration.sql`** — creates project membership
   rows and upgrades project / generation / storage RLS from owner-only to
   owner-or-collaborator access.
   > **Team sharing relaunched (owner 2026-10-03).** The rules (Director and up, 5 / 10 people a
   > film, 3 Co-writers, 20 invites a day, 14-day invites, the Stage editor, the owner pays within
   > each person's budget) live in **`team-relaunch.sql`**, which runs LAST (below). Its switch,
   > `turn_app_config` key `team_sharing` (`{"on": true}`), turns new invites off in one place.
   Then run `invitations.sql` — adds `turn_claim_memberships()`, which links
   invitations to the invitee's account on their first sign-in. (`team-relaunch.sql`
   replaces it with the confirmed-email, 14-day version; a database that never ran
   `invitations.sql` — production — doesn't need it. Once `team-relaunch.sql` is
   installed, this file and the three Team files around it refuse to run.)
   Then run `shared-owners.sql` — lets the home wall's "Shared with me" cards
   say who shared each film (without it, cards just say "Shared with you").
   Then run `enforce-role-scopes.sql` — makes the DATABASE enforce the
   Writer / Art-director section limits (until then they're app-side only):
   a trigger rejects any doc change outside the collaborator's role, blocks
   ownership transfer by non-owners, restricts generated-image records and
   their storage files to the film's owner / Art director (everyone still
   reads them), and keeps a generation record attributed to whoever first
   created it. Idempotent — safe to re-run.
   Finally run **`series-production.sql`** — normalizes Show/Episode links,
   makes Show membership and department roles inherit safely to Episodes,
   preserves access to the Show Bible for legacy episode-level invitations,
   and installs transactional RPCs for converting a film into a Show, creating
   uniquely numbered Episodes, and deleting one Episode or a whole Show.
   Lifecycle deletion also installs one-hour, owner-only, DELETE-only grants
   for each exact image/cameo object key—not a project prefix—and a durable
   exact-path queue for uploads abandoned between Storage and their database
   record. Run this file after `enforce-role-scopes.sql`.

   **Before running it on a live project**, paste
   **`series-production-probe.sql`** into the SQL Editor and run it. It is one
   read-only SELECT (it changes nothing) that shows, row by row, whether the
   database is ready and what the migration would change (legacy Shows and
   Episodes, promoted memberships, format labels). Fix every `STOP` row and
   read every `REVIEW` row first. Running it again afterwards should list the
   Show lifecycle functions as present with no bug note.

   `series-production.sql` checks its prerequisites before creating anything.
   If something is missing (for example `turn_role_allowed_sections`, which
   comes from `enforce-role-scopes.sql`), or members still hold the retired
   `producer_admin` role, it stops with a `TURN_SERIES_PREREQUISITE` message
   naming the file to run first, and nothing changes. The whole file is one
   transaction and is safe to re-run.

   **`series-production.sql` must always be the LAST of these files to run.**
   Re-running any file below silently puts back an older, non-Show-aware rule
   (Show members lose access to Episodes, or Episode-only rules come back),
   and nothing reports it. After re-running any of them, re-run
   `series-production.sql`:
   - `migrate-remove-producer-admin.sql` — replaces `turn_can_access_project`
     with the direct-membership-only version.
   - `shared-owners.sql` — replaces `turn_shared_film_owners` with the
     direct-membership-only version (Show members lose the "shared by" name).
   - `team-collaboration.sql` — replaces `turn_can_access_project`,
     `turn_can_write_assets`, the role trigger and the Storage delete rule.
   - `enforce-role-scopes.sql` — replaces `turn_can_write_assets`, the role
     trigger and the Storage delete rule.
   - `storage.sql` — adds back the owner-only Storage rules (see the warning at
     the top of that file: it is a one-time bootstrap). Re-running
     `series-production.sql` removes only the old owner-only delete rule, so
     after a `storage.sql` re-run, run `enforce-role-scopes.sql` (which drops
     all four owner-only rules) and then `series-production.sql`.
   - `cameos.sql` — puts back the owner-only Cameo add/edit rules, which do not
     check the project.

   **Once `team-relaunch.sql` is installed** (Team review, 2026-10-09):
   `team-collaboration.sql`, `invitations.sql`, `shared-owners.sql` and
   `enforce-role-scopes.sql` refuse to run (`TURN_TEAM_SUPERSEDED`, nothing
   changes) — each would silently undo Team sharing's rules (the member-wide
   read policy that showed every member's address, email-only access) — and
   `migrate-remove-producer-admin.sql` only migrates leftover rows (its CHECK and
   access helper belong to `team-relaunch.sql`). There, after a `storage.sql`
   re-run, run `storage-readable-folders.sql` (it removes the owner-only rules),
   then `series-production.sql`, then `team-relaunch.sql`.

   `storage-readable-folders.sql` (below) runs after `series-production.sql`
   but needs no re-run after any of these files: the current
   `team-collaboration.sql`, `enforce-role-scopes.sql` and
   `series-production.sql` carry the same storage key helpers and upload
   rules, and none of them touches what only it creates. A copy of one of
   those three files from before 2026-09-27, however, puts back the id-only
   `turn_storage_project_id`, upload rule or upload reservation, and files
   stored under readable folders become unreadable for everyone (new uploads
   quietly fall back to bare-id folders, so nothing reports an error). Re-run
   the current `series-production.sql` (or `storage-readable-folders.sql`,
   which also removes the owner-only rules of a `storage.sql` re-run) to
   repair it. **To check, read-only, at any time:** run `admin-inventory.sql`
   (or only its RESULT part) — row 126, "Readable storage folders: access
   helpers and rules are current", must read `ok`; otherwise it names what
   is out of date. (The readable-folders file's own RESULT cannot show this:
   running that file re-installs everything first, so it always reads `ok`.)
   Frozen pre-2026-09-27 copies of these three files live in
   `scripts/fixtures/pre-readable-folders/` as `*.DO-NOT-RUN.txt` test
   fixtures; they stop at their first line if run. Never paste them.

   Not implemented yet: the scheduled service-role worker that drains the
   cleanup queue (`turn_claim_asset_cleanup_batch` /
   `turn_complete_asset_cleanup`). By owner decision (2026-09-27) draining
   stays manual: once the `admin-storage` Edge Function is deployed (see
   **Admin Storage page** below), the admin drains the queue on demand with
   **Run cleanup now**. Until then, and between those clicks,
   nothing removes a queued upload's bytes. A deleted Show's, Episode's or
   plain film's files: since `team-relaunch.sql` (2026-10-10, owner —
   Show/Episode delete files) Storage's read rule (`turn assets read collab`)
   also passes the owner's exact-path, one-hour cleanup grant, so the owner's
   app removes them right after the delete (a plain film's through
   `turn_film_delete_cleanup`). Before that (and still for an uploader's
   uncommitted upload, a file no row names, a file a surviving project still
   named at the delete, or a delete from an older app build) the files stay:
   once the project row is gone the read rule hides them from every signed-in
   user. `admin-inventory.sql` lists them
   as `queued-for-cleanup` or `orphan: project deleted`; the Admin Storage
   page's **Review & delete** removes a deleted project's safe files by exact
   path (until that function is deployed, remove them from the Storage
   dashboard or with the service key).

   On its first run the file records each legacy Show's source Episode
   (`sourceEpisodeId`): its Episode 1, or none if Episode 1 was already
   deleted. Only that Episode's invitations that are older than the Show row
   (the film's team at conversion) become Show-wide; every other Episode-only
   invitation stays Episode-only, on the first run and on every re-run.

   Then run **`storage-readable-folders.sql`** — new Storage keys get
   readable top folders, name first and the full id last
   (`admin--b2444e18-…/pine-soot--d4432e3f-…/character/…`). Only the id in
   each folder is ever checked, and old `{user id}/{project id}/…` keys keep
   working forever. Account handles come from the email's local part and
   project names from the first real title; both are stored once and never
   follow a rename. The file checks its prerequisites and stops with a
   `TURN_STORAGE_READABLE_PREREQUISITE` message (changing nothing) if an
   earlier file is missing; it is one transaction and safe to re-run. Its
   RESULT rows 10–90 must read `ok`. Afterwards re-run `admin-inventory.sql`,
   then deploy the Edge Functions, then publish the app; each step works
   without the next. **Never roll it back once a readable key exists**
   (RESULT row 100 counts them): to stop new readable keys, use the kill
   switches in its header (revoke `turn_storage_folders` /
   `turn_storage_folders_for`, or `readableStorageKeys: false` in
   `app/supabase-config.js`). Read **Readable storage folders: rollout,
   rollback and checks** below before deploying the functions or the app.

   Finally run **`team-relaunch.sql`** (needs `credits.sql` and `app-config.sql`
   too) — Team sharing's rules: access by account (a linked invite follows the
   account; an unlinked one only the confirmed address, for 14 days), the Stage
   editor role, the member guard (the switch, the owner's plan, the caps, the
   daily limit; refusals read `TURN_TEAM:<code>`), collaborators read-only when
   the owner's plan lapses, a private member list, Leave film, and the owner-pays
   budget functions `image-proxy` and `blender-bridge` call. One transaction, safe
   to re-run (also over an earlier copy of it); it stops with
   `TURN_TEAM_PREREQUISITE` (changing nothing) if an earlier file is missing.
   **It must run again after any re-run of `series-production.sql`**, which puts
   back older access helpers (`turn_effective_project_roles`,
   `turn_can_access_project`, `turn_can_write_assets`, the role trigger,
   `turn_shared_film_owners`). The older Team files can no longer be re-run after
   it (see above). Tested offline by `scripts/test-team-relaunch-db.mjs`.
   *Team review (2026-10-09):* one shared check for invites, role changes and
   renewals (caps under advisory locks; the people cap only when a new place
   opens); people invited to a Show count in each Episode's caps; a re-invite of
   someone removed is a fresh invite; turning a shared film into a Show copies
   its team as it is; a Stage editor writes only the Stage's take rows
   (`clip-…`), not the Art Room's images or files; the switch OFF makes every
   collaborator read-only and `turn_film_payer` answers `paused` (the server
   refuses the call); `turn_hold_credits_for_film` gained `p_kind` and re-checks
   everything from the membership row; and **private presence**: Realtime
   Authorization policies on `realtime.messages` ("turn film channels receive" /
   "turn film channels send") let only people who can open a film use its
   `film:<id>` and `doc:<id>` channels (the block is skipped where Realtime isn't
   installed). Deploy order: this SQL first, then `image-proxy` (it knows
   `paused` and `p_kind`), then the app (it joins the channels as private).
   *Stage editor review (2026-10-09):* a Stage row is checked by its whole shape
   (a take record `clip-…` holds no file, refs, history or cleanup list; a voiced
   line `aud-…` keeps its file under the writer's own `<uid>/<film>/stage-audio/`),
   and every collaborator's cleanup list may name only paths the row already
   held, their own folder's or ones they may delete themselves
   (`TURN_TEAM:stage_slot` / `cleanup_path`) — so nobody can make the owner's
   app delete the Art Room's files; writing needs a CLAIMED invite (an unclaimed
   one reads only; `turn_film_payer`'s `not_member` is now refused by the
   server); a Stage editor saves only the Stage's fields of a shot and
   `project.stage`, and every refused save is an error
   (`TURN_TEAM:stage_scope` / `role_paused` / `paused` / `owner_plan`), never a
   silent zero-row save; images need the Art director, `voice_design` too;
   nobody but the maker or the owner removes a take (`TURN_TEAM:take_owner`);
   a Stage editor uploads, replaces and deletes their own voiced-line files under
   `<uid>/<film>/stage-audio/` (Storage rules "turn assets stage audio write /
   update / delete");
   Stage rows a collaborator creates belong to the film's owner (existing ones
   are moved over once); holds carry `take` and the owner's app collects renders
   that finished after the team changed (`turn_film_pending_takes`,
   `turn_film_mark_takes_collected`); a blender-bridge re-hold
   (`<ref>:rehold…`) of a film hold skips the team checks; `turn_team_spend`
   returns `removed`, `member_email`, `project_id` too. Deploy order: this SQL,
   then `image-proxy` and `blender-bridge`, then the app.
4. **SQL Editor → run `cameos.sql`** — creates the `turn_cameos` table (RLS).
   If you enable Cameos, re-run `series-production.sql` once afterward so its
   project-scoped Cameo add/edit rules are installed too (deleting a Cameo
   stays the right of the person who captured it, and so does deleting its
   photos while they can still open the project).
5. **Authentication → Providers** — enable whichever sign-in you chose
   (Email magic-link and/or Google OAuth).
6. Paste your **Project URL** and **anon public key** into `app/supabase-config.js`.
   The anon key is safe in client code — RLS is what protects the data.

   (No "Exposed schemas" step is needed — the tables live in `public`, which is
   exposed by default.)

**Fresh install, in order:** `schema.sql`, `storage.sql`, `team-collaboration.sql`,
`invitations.sql`, `shared-owners.sql`, `enforce-role-scopes.sql`, `cameos.sql`,
`series-production.sql`, `storage-readable-folders.sql`, then `credits.sql` /
`app-config.sql` / `styles.sql` as used, `team-relaunch.sql` (after `credits.sql` and
`app-config.sql`), `admin-inventory.sql`,
`admin-storage.sql` (see **Admin Storage page** below), and
`frances-daily-limit.sql` (see **Frances's daily question limit** below; it
depends on nothing but Supabase Auth, so it can run at any point). `voices.sql` (whose voice
each designed or cloned character voice is, the consent for a real person's voice, and the films it may
speak in — 2026-10-11) needs only `schema.sql` and `team-collaboration.sql`, so it can run at any point
after them; run it BEFORE deploying an `image-proxy` that reads it (the proxy refuses voice ops it can't
check). Offline test: `node scripts/test-voice-registry-db.mjs`. Today's `credits.sql`
already carries billing v2 and the tax records of `tax-compliance.sql` (see **Tax &
compliance records** below); run `billing-housekeeping-cron.sql` right after it (required),
and `billing-switch.sql` once, on the credit switch day (see **Billing v2** below). Offline test of the
readable-folders step: `node scripts/test-storage-readable-folders.mjs` (the SQL), plus
`test-storage-keys.mjs` (the one key parser, JS = SQL), `test-storage-folders-client.mjs`
(the app's folders, fallbacks and one-shot legacy retry) and
`test-storage-service-paths.mjs` (image-proxy staging, the Blender relay PNG and Studio
previews).

### Readable storage folders: rollout, rollback and checks

- **Before the functions and the app go live (owner decision O1, approved 2026-09-27).** Readable
  keys carry the account handle (the email's local part, e.g. `john-smith` for
  john.smith@acme.com) and the project's first real title. Every signed URL shows
  its object key, so these names reach whoever gets such a URL: collaborators, people
  a URL is shared with, and the AI providers (fal.ai and others) that image-proxy
  hands staged inputs to (`{handle}--{uid}/stage-tmp/…`), in their request logs.
  `privacy.html` now says so ("Where your data lives", the owner-approved sentence of
  2026-09-27); keep that sentence in place before deploying `image-proxy` /
  `blender-bridge` and publishing the app. The SQL can go in on its own first
  (nothing writes a readable key until the functions and the app do). Names are
  frozen: a title typed by mistake (a client's or a person's name) stays in every
  later key of that project; only an admin can change `turn_projects.storage_slug`
  by hand (new uploads only; stored keys keep their names).
- **Checking later (read-only):** `admin-inventory.sql` RESULT row 126 (see the
  re-run rules above). The app also logs one console warning,
  `[TURN storage] … refused the readable folder names`, when it falls back.
- **SQL rollback:** never, once a readable key exists (see above).
- **Edge Function rollback:** never deploy `blender-bridge` or `image-proxy` from a
  checkout without the readable-folders change once the new versions have run (a
  stale Mac branch, a workflow worktree, an old Replit copy — the "deploying from one
  machine reverts the other's edits" hazard). The old `blender-bridge` answers
  500 "Blender result is unavailable." for every shot that finished under a readable
  key, until it is re-rendered, and never removes a replaced readable shot PNG (a
  service file: no cleanup tool deletes it either). The old `image-proxy` refuses
  readable `stage:` refs still in flight (up to 2 hours) and its sweep never lists
  `{handle}--{uid}/stage-tmp`, so those temporary files stay. To stop new readable
  keys, revoke `turn_storage_folders_for` from `service_role` instead; that breaks
  nothing already stored.
- **App rollback:** prefer the server kill switch (revoke `turn_storage_folders` from
  `authenticated`: clients write bare-id keys within 5 minutes) over a Replit
  deployment rollback. An app build from before this change still reads, signs and
  deletes readable files one by one, but deleting a Show or an Episode treats every
  readable key as unsafe and skips it (the deletion reports skipped / incomplete
  cleanup). Once the project rows are gone nobody can read or delete those files
  from the app; `admin-inventory.sql` lists them as `orphan: project deleted`, and an
  admin removes them by exact path (Admin Storage page, or the Storage dashboard or
  the service key while that page is not deployed). The same happens with browser
  tabs left open from before the publish until they reload.
- **What a folder name proves:** nothing about ownership. A readable folder's first
  eight characters are never all hex digits (a legacy `{user id}` folder's always
  are), and no label can hold a uuid, a uuid without hyphens or an 8-digit group of
  one, so a readable folder cannot pass for someone else's legacy folder. But the
  label is whatever the uploader's client wrote on its own id; owners come from the
  ids in the `turn_admin` views.

## Architecture

- **Storage adapter layer** — all image reads/writes go through one interface with
  two backends: `local` (current IndexedDB) and `supabase`. The app code is
  unchanged; only the backend swaps based on auth state. Local stays as an offline
  cache; Supabase is the source of truth when signed in.
- **Images** are uploaded as real image **files** (not base64 in a DB column) to
  `turn-assets/{uploader}/{project}/{folder}/{entity}[/states/{stateId}|/{sub}]/{timestamp}-{role}[-v{N}]-{shortId}.{ext}`
  (folder ∈ character|prop|location|shot|storyboard|lookbook|cameo|other; an appearance
  state nests inside its character; role ∈ sheet|ref-*|cameo-angle; the optional `v{N}`
  is a non-authoritative version-at-birth hint; `{ext}` is the real file type). Files
  made before 2026-09-26 keep their older names (`asset/`, `locunit/`, storyboards under
  `character/`, `{role}-…-{timestamp}` names) and keep working.
  The first two segments are the uploader and the project — the storage policies
  check exactly those two. Keys written before 2026-09-27 use the bare ids; once
  `storage-readable-folders.sql` has run and the app and functions that use it are
  deployed, new keys use readable folders, name first and the full id last
  (`{account handle}--{user id}/{project name}--{project id}/…`; the service areas
  too: `{account}/stage-tmp/…`, `{account}/studio-previews/{project}/…`). The rules
  read only the id. The names are fixed once (the account handle, from the email's
  local part, when it is first assigned; the project name at its first real title,
  `untitled` until then) and never follow a rename or an email change, so renaming a
  project or character never orphans or moves a file. One parser reads both forms:
  `app/storage-keys.js` (the same grammar as `turn_storage_segment_id`), which
  `scripts/build-dist.mjs` copies byte-for-byte into the `image-proxy`,
  `blender-bridge` and `admin-storage` functions. The app asks `turn_storage_folders`
  for its two folders before an upload and writes a legacy key whenever the answer is
  missing or wrong (cached 5 minutes); the functions ask `turn_storage_folders_for`
  and fall back the same way.
- **Reading the tree as an admin:** the Supabase Storage browser shows only folder
  names: bare ids for older keys and, for readable keys, a name its owner's account
  was given — readable, but never proof of who owns a file (any signed-in user may
  put any valid name on their own id; a readable folder can only never look like a
  bare-id one, since its first eight characters are never all hex digits). Run `admin-inventory.sql`
  once in the SQL Editor, then query the read-only
  `turn_admin` views (Storage by project / by user, Film detail, Orphans) to see owner
  emails, film titles and item names. They parse both folder forms by id;
  `turn_admin.files` also shows `account_label` / `project_label` and flags, in
  `label_note`, a label that differs from the stored account handle or project name
  (`users.storage_handle`, `projects.storage_slug`). Never delete a whole user folder: it also holds
  that user's uploads to other people's films. The **Admin Storage page** (below) shows
  the same views in the app, once its Edge Function is deployed.
- **Metadata, reference lists, and version history** live in `turn.generations`.
- **Projects** scope every asset; switching projects loads that film's doc + assets.

## Why a private bucket

Generated sheets are your creative work, so the bucket is private and the app
fetches short-lived **signed URLs**. If you'd rather trade privacy for simplicity
(public bucket, permanent URLs), that's a one-line change.

## Real invitations (`invite-collaborator` Edge Function)

> **Team relaunch (owner 2026-10-03).** Hardened before its first deploy (the memo's Option B
> list): the link always points at `https://kinolot.infinitestudioai.com/?invite=<film id>` (never
> a host from the browser); the answer is the same whether or not the address has an account; the
> switch and the owner's plan are checked again; one email per invite per 10 minutes and 40 a day
> per owner. The logic is `core.mjs` (tested by `scripts/test-invite-collaborator.mjs`).

Adding a collaborator in the Team window writes the membership row (the database's guard in
`team-relaunch.sql` checks the plan, the caps and the 20-a-day rule) and then asks this function
to SEND the email through the auth mailer (ZeptoMail SMTP on production): a new address gets the
"Invite user" email (its account is pre-created, but not linked to the film — the invitee's own
confirmed sign-in claims it), an existing account gets the magic-link sign-in email. Either link
lands on `/?invite=<projectId>`, the app's welcome page.

**Set it up (once, from the Mac, after `git pull`):**

1. `team-relaunch.sql` has run (it replaces `invitations.sql`).
2. `npx -y supabase@2.117.0 functions deploy invite-collaborator --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt`
   (the function does its own sign-in + owner check and answers the CORS preflight itself).
3. **Authentication → URL Configuration → Redirect URLs** must hold
   `https://kinolot.infinitestudioai.com/**` (it does). No other host is ever used.
4. The "Invite user" and "Magic link" templates are Kinolot-branded (set 2026-10-02); the
   invite template can use `{{ .Data.invited_by }}` and `{{ .Data.invited_project }}`.

If the function isn't deployed, the Team window still adds the person and says plainly that the
email wasn't sent; they find the film when they sign in with that address.

## Admin Storage page (`admin-storage` Edge Function)

**Status (2026-09-28): the first version of the function was deployed on
2026-09-27 and the first version of `admin-storage.sql` was run on production on
2026-09-28. "Clear old temp files" needs both again: run the current SQL file
once (step 5), then redeploy the function.**

The platform admin's Storage page (account chip → **Storage · admin**) reads the
whole `turn-assets` bucket through the `turn_admin` views and deletes files
**server-side**, through `supabase/functions/admin-storage/`:

- **Browse** every account, project and folder with owner emails, titles and
  sizes, and one project's files. Needs only `admin-inventory.sql`.
- **Review & delete**, for DELETED projects only. The server plans the delete
  from `turn_admin.files` (only what the views mark safe; never a live
  project's files, never anything referenced, uploading, queued or
  server-owned), the admin reviews the plan, and the server removes the exact
  paths through the Storage API, 200 at a time, rechecking every batch. Each
  file is recorded in `turn_admin_ops` before and after every Storage call, so
  an interrupted run can be resumed from **History**.
- **Run cleanup now** drains the upload cleanup queue on demand. Anything still
  referenced is kept, and an upload abandoned less than 24 h ago in a live
  project waits.
- **Clear old temp files** (Cleanup tab, manual only, 2026-09-28) removes the
  media `image-proxy` staged under `{account}/stage-tmp/` more than 24 hours
  ago (database clock); the app never reads one again after about 3 hours. Same
  guarantees as Review & delete: the server plans from its own query, the admin
  confirms, every file is rechecked just before its batch, and every removal is
  recorded. One clear at a time; an interrupted one must be resumed from
  **History** before a new one can start.

The browser never names a file. The function checks the session first (live
sign-in, the allowlisted admin email, confirmed, not anonymous) and only then
opens a database connection, as `postgres` over the auto-injected
`SUPABASE_DB_URL`. `image-proxy` is not involved.

**Set it up (once). Steps 1 and 5 change production and need the owner's go-ahead:**

1. *(Mac, after `git pull`)* Deploy the new function (JWT verification ON, like
   `pricing-watch`):
   `npx -y supabase@latest functions deploy admin-storage --project-ref vubenblfdzginlqiglzw --use-api`
   If the browser's `OPTIONS` preflight is ever refused with 401, redeploy with
   `--no-verify-jwt`; the function enforces sign-in itself either way.
2. *(Recommended, Mac)* Pin the admin account. Get its uid in the SQL Editor
   (`select user_id from turn_admin.users where email = 'admin@infinitestudioai.com'`),
   then `npx -y supabase@latest secrets set ADMIN_USER_IDS=<uid> --project-ref vubenblfdzginlqiglzw`.
3. *(Dashboard)* Authentication → Providers → Email: **Confirm email** ON and
   **Secure email change** ON. Every email-based admin gate relies on both.
4. Open the page as the admin. No setup warning should show, and `status`
   should report `db.user = postgres`, 6 of 6 views, and a reader that sees
   every row. Browsing works from here.
5. *(SQL Editor)* To turn deleting on, paste **`admin-storage.sql`** → Run →
   rows 10–40 read `ok` (row 15, "Temp-file clearing allowed", is the
   2026-09-28 addition; a database that ran the first version needs this re-run
   once, and the page says so until then). It creates only the private audit schema
   `turn_admin_ops` (no functions, triggers, policies or grants; never exposed
   in the Data API). Remove it with `drop schema turn_admin_ops cascade;`.
6. **First real delete:** one small deleted project. Check that removed equals
   planned, that `select * from turn_admin.orphans where project_id = '<id>'`
   returns nothing, and that History reads Done. Only then delete in bulk.

**Optional secrets** (Mac, `npx -y supabase@latest secrets set …`):
- `ADMIN_USER_IDS`: step 2.
- `ADMIN_STORAGE_DB_URL`: only if the page reports that the database can't be
  reached or can't see every row. Use the Supavisor **session** pooler URI for
  user `postgres`; it overrides `SUPABASE_DB_URL`.
- `ADMIN_STORAGE_CRON_SECRET`: leave it **unset**. Draining stays a manual
  click (owner decision, 2026-09-27); no pg_cron schedule is installed, and
  without this secret the function serves signed-in admins only.

Deleted projects keep no tombstone (owner decision, 2026-09-27), so the page
names them "Deleted project · <short id>" with their uploaders' emails. The page
is an operator tool and is deliberately not listed in MUSE's `APP_FEATURES`.
Offline tests: `node scripts/test-admin-storage.mjs` (the real function core
against the real SQL on PGlite) and `node scripts/test-admin-storage-ui.mjs`
(the page itself, `app/admin-storage.jsx`, against a fake function).

## Manage plan (`billing-portal` Edge Function)

Owner request 2026-09-30. The Stripe dashboard's Customer Portal activation page
would not save, so the portal is set up through the API instead: signed-in
subscribers get a **Manage plan** button in the account menu (under *Change
plan*) that opens a portal session to update their card, see invoices and
cancel at the end of the billing period. Plan switching is **off** in that
portal (the webhook doesn't handle `customer.subscription.updated` yet), and
so is changing the billing email; *Change plan* still opens the plans window.

- The function reads the caller from their JWT only (never from the body), looks
  up `turn_credits.stripe_customer_id` with the service role (none → `409
  no_subscription`), and reuses the active portal configuration whose metadata
  is `app=kinolot` — creating it on the first call. No SQL, no new secret
  (`STRIPE_SECRET_KEY` is already set for `stripe-webhook`), no dashboard step.
- The portal's way back is the caller's Origin when it is one of the app's hosts
  (kinolot.infinitestudioai.com, cinema.infinitestudioai.com, kinolot.replit.app,
  localhost), else `https://kinolot.infinitestudioai.com/`.
- *(Mac, owner approval)* Deploy with JWT verification **on** (no
  `--no-verify-jwt`):
  `npx -y supabase@latest functions deploy billing-portal --project-ref vubenblfdzginlqiglzw --use-api`
  Until it is deployed the button shows "Plan management isn't available right
  now. Try again in a moment."

Offline test: `node scripts/test-billing-portal.mjs` (the function core against
fake Stripe / Supabase adapters, and the account-menu button).

## Billing v2 (`billing-v2.sql`, `billing-switch.sql`)

**Status (2026-10-01): run on production on 2026-10-01 (day 0, steps 1–5 below); the
switch (step 6) has not run.** `billing-v2.sql` is run once more for partial refunds,
right before `tax-compliance.sql` (see **Tax & compliance records** below).
The owner's step-by-step rollout (day 0, switch day, the notice email, rollback) is
`docs/Billing Rollout Runbook.md`; the proposed Terms / privacy wording is
`docs/Billing Terms Proposal.md`.
Owner decisions 2026-09-30: Option A (1 credit = $0.01 of provider cost; new
subscribers get Writer 600 / Director 1,600 / Producer 5,000 a month at unchanged
prices), packs in their own 12-month balance, a 50-credit trial, 30 days' notice
for current subscribers (their balances x3 on the switch day and their old allowance
in the new units — 2,400 / 7,200 / 27,000 — for renewals until 30 days after it).

### What each file does

| File | Run it | What it does |
|---|---|---|
| `credits.sql` | fresh installs only | The base tables plus every billing v2 definition and the tax records. Ends in exactly the state of an existing database after `billing-v2.sql` and `tax-compliance.sql` (the shared blocks between the `>>> KINOLOT BILLING V2 DEFINITIONS >>>` and `>>> KINOLOT TAX COMPLIANCE DEFINITIONS >>>` markers are byte-identical in the files; the tests fail if they drift). |
| `billing-v2.sql` | **existing databases (production), once now** | Plan and pack balances, holds, once-only Stripe grants, refunds, disputes, failed payments, cancellations, the trial. Backward compatible: today's app, `image-proxy`, `stripe-webhook` and Blender Studio keep working unchanged. First run only: the **carry-over** — for each subscriber anything above today's allowance (800 / 2,400 / 9,000) moves to a 12-month lot; an account without a plan keeps its whole balance as a 12-month lot; nobody's total changes. One transaction, safe to re-run; its RESULT rows must all read `ok`. |
| `billing-housekeeping-cron.sql` | **once, on day 0, right after `billing-v2.sql` (required)** | Four pg_cron jobs. Every 10 minutes: `turn_release_stale_holds(30)` gives back the holds of a worker that was killed before its own release ran; and the **reconciliation** — pg_net posts `{"op":"reconcile_holds"}` to `image-proxy` and to `blender-bridge`, which ask the provider about video / 3D jobs nobody polled for an hour (a closed tab): finished → charged as the poll would have, failed or unknown → refunded, still running → asked again next time. A provider-tied hold is settled at the held amount only as a last resort, after 30 days. Daily: `turn_expire_lots()`. Enables `pg_net`; safe to re-run (jobs are unscheduled by name and scheduled again); its RESULT lists pg_net and the four jobs. |
| `billing-switch.sql` | **once, on the switch day** | Every balance x3 (plan credits, lots, open holds, plan grants), grandfathering for 30 days (`pro` = Director), trial on, `turn_credit_regime()` answers $0.01. Refuses with a FAIL row, changing nothing, until the `server_video_billing` marker (day-0 deploys) exists **and** `image-proxy` has taken at least one credit hold after it (proof the new code is live, not just that the marker line ran); raises (nothing committed) unless every total is exactly x3. A marker row makes any re-run a no-op (its RESULT then says "already switched … changed nothing"). Stops, changing nothing, if `billing-v2.sql` hasn't run. RESULT after the commit. |
| `tax-compliance.sql` | **existing databases, once, after `billing-v2.sql` is run again** | The sales ledger for the Admin panel's tax figures, the checkout consent, the tax summary. See **Tax & compliance records** below. |
| `billing-switch-undo.sql` | **only to take back a mistaken switch**, soon after it | The exact inverse of the switch: trials granted since then taken back, every balance / 3 (rounded up when something was spent since), grandfathering cleared, the switch marker deleted. Refuses when the switch has not run. See "Rollback" below. |

After `billing-v2.sql`, never paste a copy of `credits.sql` from before 2026-09-30,
nor `spend-idempotency-migration.sql` again (both put back single-balance spend
functions; the balance trigger would still keep the numbers adding up, but the
frozen check on spending would be gone). `lock-credit-functions.sql` and
`studio-credit-settlement-migration.sql` are harmless to re-run.

### Order (owner steps)

The full runbook with the notice email is kept by the owner; the order is:

1. *(SQL Editor, as postgres)* Run **`billing-v2.sql`**. Every RESULT row must read
   `ok`. Today's app, `image-proxy`, `stripe-webhook` and Blender keep working.
2. *(SQL Editor)* Run **`billing-housekeeping-cron.sql`** — **required**, not optional:
   from step 4 on every paid call holds its credits first, and a worker killed before its
   own release (a time or memory limit, a redeploy) would otherwise leave them spent. Every
   10 minutes it releases holds with no provider job that are older than 30 minutes, and it
   asks `image-proxy` and `blender-bridge` to **reconcile** their open provider jobs (POST
   `{"op":"reconcile_holds"}` through pg_net, no key needed): in plain words, a render whose
   tab was closed is charged only if it really finished, and refunded if it failed. Daily it
   zeroes expired packs. Every RESULT row (pg_net and the four jobs) must read `ok`. Until
   step 4 the two calls just get a refusal from the old functions (harmless).
3. *(Stripe dashboard)* Billing settings: Smart Retries on, cancel after the final retry,
   failed-payment emails on; plan links: cards and wallets only. Create the three new
   pack products (`app=kinolot`, `kind=credit_pack`, `pack_credits` 250 / 1000 / 3000 at
   $10 / $35 / $99) and their payment links, **deactivated** until the switch day, and put
   the links into `app/plans.jsx` `CREDIT_PACKS` (the new packs don't appear in the app
   until the switch). Do **not** add the new webhook events yet (step 4). The old pack links
   (300 / 1,200 / 4,000) stay on sale until the switch day.
4. *(Mac, after `git pull`, with the owner's go-ahead)*
   - **a.** Deploy `stripe-webhook` (`--no-verify-jwt`) **first**;
   - **b.** *then (Stripe dashboard)* webhook endpoint → add the events `invoice.payment_failed`,
      `customer.subscription.updated`, `charge.refunded`, `charge.dispute.created`,
      `charge.dispute.closed`, `checkout.session.async_payment_succeeded` (keep
      `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`: nine
      in all). The old webhook answers 200 to event types it doesn't know, so an event
      added before the new webhook is live would be acknowledged and dropped;
   - **c.** *(SQL Editor)* immediately before deploying `image-proxy`, mark browser spends as
      retired:
      `insert into public.turn_billing_state(key, value) values ('server_video_billing', jsonb_build_object('at', now())) on conflict (key) do nothing;`
      (from then on `turn_spend_credit` changes nothing, so a tab still running the old app
      is never charged twice for a render; in the minute before the deploy lands, the old
      proxy's renders cost nothing — an owner cost, never a user's). If more than a day
      passes between this line and the `image-proxy` deploy (a failed deploy retried later,
      say), set the marker again immediately before the deploy — both lines together:
      `delete from public.turn_billing_state where key = 'server_video_billing';` then the
      insert above. The new `image-proxy` still collects renders started on the old one
      for 48 hours after the marker's time, so that window must start at the deploy; the
      switch (step 6) then needs a hold taken after the new marker;
   - **d.** then deploy `image-proxy` and `blender-bridge` **together**, one straight after
      the other, from the same `git pull` (both `--no-verify-jwt`), and `billing-portal` if it
      isn't deployed yet. `image-proxy` and `blender-bridge` follow `turn_credit_regime()`:
      $0.03 a credit now, $0.01 from the switch, with no redeploy. The server keeps accepting
      the old Frances model id from tabs that are still open, so nothing has to be removed
      later. If every paid call is refused with "Credits can't be checked right now",
      `billing-v2.sql` hasn't run on this database: go back to step 1. A video submit refused
      with `hold_attach_failed` means the render couldn't be tied to its credits: the render
      was stopped and its credits returned, so try again. If it repeats, check the
      `image-proxy` logs for both lines: `[billing] attach … failed` (the database didn't
      answer) and `[billing] attach … refused` (it answered no — `mismatch`: that job id is
      already on another hold; `unknown`: the database has no such hold).
5. *(Replit)* Pull, then Publish the app straight after step 4 (its cost chips, plan
   cards and trial copy follow `turn_credit_regime()` too). For this release the server
   goes first, minutes before the app (unlike the "app first" note under Frances's daily
   limit below): with the marker set, an old tab is never double-charged and only shows
   some refusals as bare codes for those minutes, while the new app on the old server
   would get free video renders and metered Frances questions. The old pack links stay
   on sale (their lots are tripled by the switch like every other balance). Check, signed
   in: the Plans window shows 800 / 2,400 / 9,000 and the three current packs (300 / 1,200 /
   4,000) with Buy buttons; the new packs don't appear until the switch.
6. **Switch day (30 days after the notice):** (a) in Stripe, a few minutes **before**
   the switch: deactivate the three old pack links (300 / 1,200 / 4,000), then check the
   webhook endpoint's event deliveries show nothing pending or failed (every old pack paid
   for is then credited in the old units, and tripled by the switch). A late old-pack grant
   that still arrives after the switch is tripled too: `stripe-webhook` passes it with
   `legacy_unit` and the database decides the x3 (`turn_add_pack_once`) under the account
   lock, together with the lot, so one granted while the switch runs is never missed. The
   order above stays as belt and braces; (b) run
   **`billing-switch.sql`** (RESULT all `ok`; it refuses with a FAIL row if the step 4c
   marker is missing or `image-proxy` has taken no hold since it); (c) right after, in
   Stripe: set the plan products' `plan_credits` to 600 / 1,600 / 5,000 and activate the
   three new pack links. Running (b) after (c) would let a renewal in between grant 600
   old-unit credits; new pack links active before (b) sell credits that (b) then triples.
   The unit changes by itself, with no redeploy: the functions within about 30 seconds,
   open tabs of the app within about 5 minutes (sooner when someone returns to a tab after
   a minute away, at once on a reload).
7. Send the 30 days' notice on the day of steps 1–5. It must say that, from the switch
   day on, a cancelled plan's unused monthly credits end with the plan (until then they
   stay usable, as the published Terms say).
8. Plan switching in the billing portal only after steps 1–4 (the webhook handles
   `customer.subscription.updated`; an upgrade adds the allowance difference for the part
   of the month still to run, as Stripe prorates it); then set
   `PORTAL_PLAN_SWITCHING = true` in `app/plans.jsx`. Turning on Stripe's "limit customers
   to one subscription" is recommended too (a second subscription on another customer is
   refused by the database and recorded as `subscription_conflict`).

### Rollback

- **The switch ran by mistake** (for example before the notice): run
  **`billing-switch-undo.sql`** in the SQL Editor as soon as possible (RESULT all `ok`; it
  says "exact" when nothing was spent since, otherwise how many numbers it rounded up in
  the users' favour). Then *(Mac, after `git pull`)* redeploy `image-proxy` and
  `blender-bridge`: a warm instance keeps the unit it read for its whole life and would go
  on pricing at $0.01 against balances that are no longer tripled. In Stripe put
  `plan_credits` back to 800 / 2,400 / 9,000 and deactivate the new pack links (the old
  ones back on if they were turned off). Open tabs follow `turn_credit_regime()` within
  about 5 minutes (sooner on returning to a tab after a minute, at once on a reload).
- **Rolling back the day-0 code:** the app and `image-proxy` go back **together** (the
  new app on the old proxy gets free video and metered Frances questions; the old app on
  the new proxy is fine for minutes only), and then delete the marker
  `delete from public.turn_billing_state where key = 'server_video_billing';` so the old
  app's browser spend charges video again. **After the switch** the old code must not run
  on tripled balances (it prices at a fixed $0.03 and lets trial accounts render video):
  run `billing-switch-undo.sql` first, or ship a hotfix instead of a rollback. A few
  minutes after the old `image-proxy` is live, give back the holds the new code left
  open (the old code never settles or releases them):
  `select public.turn_release_hold(ref) from public.turn_credit_holds where status = 'held';`
  (if `blender-bridge` stays on the new code, add `and ref not like 'studio:%'`). The
  database (`billing-v2.sql`) stays: every old caller keeps working on it. Never restore a
  whole-database backup for a billing rollback: it also takes back every user's work and
  every Stripe grant since.

### How the balance works

- `turn_credits.remaining` is the **total** = `plan_remaining` + unexpired
  `turn_credit_lots`. A trigger (`turn_credits_ledger_sync`) keeps it so; any direct
  change of `remaining` (Blender's settle function, a hand edit) is spread plan credits
  first, then lots. To change a balance by hand, use `turn_grant_credits(email, n)`
  (positive: a 12-month lot; negative: takes credits away) or edit `plan_remaining`.
- **Spending:** plan credits first, then lots, the soonest-expiring first. Never below 0.
- **Renewal** resets plan credits only; lots are never touched. **Cancellation** of the
  stored subscription ends the plan; before the switch day its plan credits stay usable
  (today's Terms), from the switch day on they end with it; lots keep their expiry.
  **Upgrade** adds the allowance difference scaled by the part of the paid period still
  to run (rounded up; with no renewal date known, the next renewal gives the new
  allowance). A paid subscription that would replace an account's **different, still
  active** subscription on **another** Stripe customer grants nothing and is recorded in
  `turn_grant_failures` (`subscription_conflict`) — the owner checks it (a real second
  subscription: cancel the old one or clear `stripe_sub_id`, delete that event id from
  `turn_stripe_events`, then resend the event from Stripe; otherwise refund it).
- **Refund** (full): the unspent credits of the pack lot / plan grant tied to that
  payment are removed (plan credits held by a running job included: they are taken out
  of the hold's sources, so they come back neither when the job is released nor when it
  settles).
  **Partial refund** (a 14-day cancellation's unused part, say): the same share of that
  payment's credits, rounded up, never more than is still unused (credits held by a running
  job count as unused: that part is taken out of the hold's sources, so a release or a settle
  never gives it back, while a settle still keeps the job's real cost) and never more than the
  payment granted in all; the next partial refund
  takes its own share, a full refund takes what is left. **Dispute** open: `frozen` —
  spending, usage and holds refuse (`CREDITS_FROZEN` / code `frozen`); credits stay
  visible. Dispute closed, won or lost: `stripe-webhook` lifts the hold that dispute placed
  (`turn_dispute_hold`, `tax-compliance.sql`; the account stays frozen while another dispute
  or an earlier hold is still listed); a lost dispute also removes that payment's unused
  credits. **Failed renewal:**
  `payment_status = 'past_due'`; credits stay usable, the next paid invoice sets it back.
- **Holds:** the server takes the estimated credits before a job (video, voice, long
  writing) and settles (keeps the real cost, never more than held) or releases them;
  the part given back returns to the lot it came from (not to a refunded lot, and plan
  credits only within the same plan period). Each settle / release writes one
  `turn_usage_events` row (`kind 'hold'`, `task` = the hold's reason). A hold for a
  provider job carries the provider's job id (`provider_ref`, attached right after the
  submit), so the poll finds it. If nobody polls (the tab was closed), the reconciliation
  every 10 minutes asks the provider: finished → settled as the poll would have, failed or
  unknown → released. Only a hold the provider never answers for is settled at the held
  amount, after 30 days. A hold with no provider job is released after 30 minutes.
- **Renders priced by length (Motion Control, Edit Video):** an edit or a Motion Control
  render holds about the source video's length plus a margin (its length x 1.1 plus 1
  second, never more than the longest length allowed) — the motion video for Motion
  Control, the source video for an edit (its input and output seconds, as the price
  counts them). The reference videos a render is given are counted by their length the
  same way. Every place the app takes a video from is held by its length: a data URL, a
  device upload, a video in the film's own storage and a file on the provider's media
  CDN — the film's storage and device uploads through the server's own copy (see
  "Snapshots" below). A file it can't read (a fragmented, damaged or compressed-header
  video, or one stored anywhere else) holds the longest length, as before. The charge
  still comes from the finished
  video's real length, never above the hold. A finished video longer than its hold
  covered is charged only the hold (you pay the rest), and `image-proxy` logs
  `[billing] length_mismatch <ref> held=<n> output_s=<s>` and records it for you as a
  `turn_grant_failures` row with reason `length_mismatch` (query under "Read-only
  checks"). One now and then is a margin that was too small; many, or many from one
  account, are worth a look: those files may claim a shorter length than they have.
- **Snapshots (why, where, cleanup):** a video in the film's storage, or a device upload,
  could be replaced by its owner after `image-proxy` read its length, and the provider
  would then render a longer video than the one billed. So at submit `image-proxy` copies
  such a video, with the service role, to
  `_internal/video-snapshots/<time>-<hold id>-<n>.<ext>` (the hold id is the render's hold,
  `video:<hold id>`) — a folder no signed-in user can write, replace, move a file onto,
  delete or list (the Storage rules only ever open folders that name the user's own id or
  a film they work on, and `_internal` is neither). It reads the copy's length and gives
  the provider a 24-hour link to the copy, never to the original. A data URL's bytes are
  uploaded there the same way; a file on the provider's CDN can't change after the read,
  so it is read directly. If a copy fails, that video counts as unread: the longest
  length. The copies are deleted when the render's hold is settled or released, by the
  app's poll or by the 10-minute reconciliation; the reconciliation also removes, as a
  best effort, any copy older than 2 days that was left behind (a failed delete, which
  `image-proxy` logs as `[billing] snapshot cleanup failed`). The admin views list them
  with the other `_internal` service files, which are never offered for deletion. No SQL
  to run. Offline test:
  `node scripts/test-storage-billing-snapshots.mjs` (every Storage rule set production
  can have: today's, after `storage-readable-folders.sql`, after a `storage.sql` re-run, a
  fresh install).
- **Speech-to-text (New Story's spoken interview):** a recording is charged by its real
  length, which `image-proxy` reads from the file itself (WebM, Ogg, MP4 / MOV or WAV)
  before it holds anything. The hold and the charge are that length — never the time of
  the last spoken word, so silence counts and a recording with no words in it is still
  charged. A longer length reported by the provider is logged
  (`[billing] stt_length_mismatch`), never charged above the hold. A recording it can't read,
  or one longer than 6 minutes, is refused with a plain sentence and nothing is held (the
  app itself stops a spoken answer at 5 minutes); the app then quietly switches to the
  browser's own speech recognition (free). Only the speech-to-text models the app uses
  are accepted.
- **Image prompts:** an image prompt longer than 40,000 characters is refused on every
  image route before anything is held (the app's longest prompts are well under it), so a
  long prompt can't use input the flat image price doesn't cover.
- **Trial:** 50 credits once per account after email confirmation, one per mailbox
  (lower-case, "+tag" and Gmail dots ignored; only a SHA-256 key of it is stored),
  granted on the first balance read or spend; never for an account that has paid (a
  plan or a pack). Starts on the switch day. Subscribing replaces the trial credits
  with the allowance. What a trial account may generate is enforced by `image-proxy`.
- **Grandfathering:** while `legacy_until` is in the future, a renewal gives at least
  the old allowance in the new units (2,400 / 7,200 / 27,000; the legacy `pro` plan counts
  as Director; an upgrade inside the window adds the old difference, pro rata). After it,
  the Option A allowance.

### The functions (contract) and who may call them

| Function | Caller | Returns / does |
|---|---|---|
| `turn_credit_balance()` | signed-in user | `remaining, plan` (first, as before), `plan_remaining, pack_remaining, next_pack_expiry, payment_status, frozen, trial`, then `plan_allowance` (this period's allowance, for low-balance notices), and last `held` (credits set aside by the account's open holds). Creates the row, zeroes expired packs, grants the trial when due. |
| `turn_spend_credit(cost, event_id)` | signed-in user | today's browser spend: plan then packs, clamps at 0, once per event id, refuses when frozen; a no-op once `turn_billing_state` has the `server_video_billing` marker (step 4c). |
| `turn_record_usage_event(…)` | signed-in user | today's image-proxy spend + ledger (`INSUFFICIENT_CREDITS` as before). |
| `turn_credit_regime()` | anyone | `switched, switched_at, usd_per_credit` (0.03 before the switch, 0.01 after), `trial_credits` (0 / 50), `legacy_until`. |
| `turn_hold_credits(uid, amount, ref, reason)` | service role | jsonb `{ok, held, remaining, code?}` — atomic, idempotent per ref; codes `insufficient`, `frozen` (also `ref_conflict`, `released`). |
| `turn_settle_hold(ref, actual)` | service role | jsonb `{ok, status, held, kept, released, given_back, remaining}` — keeps min(actual, held); a repeat reports the first outcome; after a release: `{ok:false, code:'released'}`. |
| `turn_release_hold(ref)` | service role | jsonb — gives everything back; no-op (`duplicate: true`) if already settled or released. |
| `turn_hold_attach(ref, provider_ref)` | service role | jsonb `{ok, code?, status?}` — attaches the provider's job id (fal request id, mesh job id) to a hold once; the same value again is ok; a different value, or one already on another hold: `code 'mismatch'`; unknown ref: `code 'unknown'`. |
| `turn_hold_lookup(provider_ref)` | service role | jsonb `{found, ref, owner, held, status, kept, created_at, reason}` — the hold a provider job belongs to (`{found:false}` when none). |
| `turn_open_provider_holds(older_than_minutes default 60, max_rows default 50, ref_prefix default null)` | service role | table `(ref, owner, provider_ref, held, reason, created_at)` — open holds with a `provider_ref` older than N minutes, oldest first, at most `max_rows` (1–500); `ref_prefix` (`'video:'`, `'studio:'`) lets each function list only its own. What the reconciliation (`{"op":"reconcile_holds"}`) works through. |
| `turn_claim_housekeeping(job, every_seconds)` | service role | boolean — an atomic throttle: `true` when this caller may run the job now (its last run is older than `every_seconds`) and the run is recorded (`turn_billing_state` key `housekeeping:<job>`); `false` otherwise. The reconciliation uses `'<function>_reconcile'`, 240. |
| `turn_set_plan_once(event_id, uid, new_tier, monthly_credits, sub_id, customer_id, renews)` | service role | int total — once per event id / key; renewal resets plan credits only; honours grandfathering; sets `payment_status` active. A subscription conflicting with the account's stored, still-active one on another customer grants nothing (`turn_grant_failures` `subscription_conflict`; the event's result says `skipped`). |
| `turn_adjust_plan_once(event_id, uid, new_tier, add_credits, sub_id)` | service role | int total — immediate upgrade, once; adds the difference for the part of the period still to run (rounded up; none when no renewal date is known); a different stored subscription is refused and recorded in `turn_grant_failures` (`subscription_mismatch`). |
| `turn_add_pack_once(event_id, uid, amount, charge_id, legacy_unit default false)` | service role | int total — a 12-month pack lot, once. `legacy_unit = true`: the amount is in the old unit (the 300 / 1,200 / 4,000 packs): granted as sold before the switch, x3 from the switch on — decided after the account lock, together with the lot (the event's result records `legacy_unit` and `x3`). The 4-argument call still works and never multiplies. |
| `turn_revoke_charge_once(event_id, charge_id, refund_fraction default 1)` | service role | int credits removed — once per event; matches lots and plan grants whose charge id **or** grant key equals `charge_id` (pass the charge id for packs, the grant key such as `invoice:in_…` for a plan payment); a plan grant is taken from the plan credits left, then from the plan part of holds still open in its period. `refund_fraction` (0 < f ≤ 1; the two-argument call = 1 = a full refund, as before, which closes the lot / grant): a partial refund removes `ceil(f × granted)` of each lot / grant (f × granted rounded to 6 decimals first), capped at what it still has unused (a lot's remaining, then its part of open holds) and at the amount less earlier refunds; the lot / grant stays open. A null or out-of-range fraction is refused (22023) before the event is claimed. The event's result records `fraction`. |
| `turn_set_payment_status(uid, status)` | service role | `'active'` or `'past_due'`. |
| `turn_set_frozen(uid, frozen, reason)` | service role | freeze / unfreeze (disputes); the reason is kept. |
| `turn_end_plan_for_sub(uid, sub_id)` | service role | boolean — ends the plan only when `sub_id` is the stored subscription; keeps its plan credits before the switch day, ends them from the switch day on. |
| `turn_release_stale_holds(minutes default 30)`, `turn_expire_lots()` | service role | housekeeping, scheduled by `billing-housekeeping-cron.sql` (step 2): releases holds without a provider job older than `minutes`; leaves a hold with a `provider_ref` to the reconciliation, and only as a last resort settles one still open after 30 days at the held amount. |
| `turn_set_plan`, `turn_add_pack`, `turn_apply_pack_once`, `turn_end_plan`, `turn_grant_credits` | service role / SQL editor | today's functions, same signatures, new balances (`turn_end_plan` still keeps credits). |
| `turn_frances_consume(p_user, p_limit)` | service role | unchanged (`frances-daily-limit.sql`); `image-proxy` now passes the per-plan cap: 5 a day with no plan / trial / cancelled, 15 Writer, 30 Director, 50 Producer; admins are not counted. |

Every function above is SECURITY DEFINER with a pinned `search_path`; EXECUTE is
revoked from public, anon and authenticated and granted only as listed (the service
functions also refuse any non-service JWT inside, as a second lock). The `turn__*`
helpers are callable by no API role. Users can read their own `turn_credits` row,
usage rows and pack lots; nobody writes billing tables through the API.

**Read-only checks:** `select * from public.turn_credit_regime();` ·
`select key, at, value from public.turn_billing_state;` (the carry-over and switch
markers with their totals) · open holds older than an hour (a provider job's poll
may still be running; the housekeeping job handles the rest):
`select ref, owner, held, provider_ref, created_at from public.turn_credit_holds where status = 'held' and created_at < now() - interval '1 hour';`
· the housekeeping jobs: `select jobname, schedule, active from cron.job where jobname like 'kinolot-%';`
· what the reconcile calls answered (`{ok, checked, settled, released, left}`): `select status_code, content, created from net._http_response order by created desc limit 10;`
· when each reconciliation last ran: `select key, at, value from public.turn_billing_state where key like 'housekeeping:%';`
· conflicts for the owner: `select * from public.turn_grant_failures where reason = 'subscription_conflict' order by created_at desc;`
· renders that came back longer than their hold: `select created_at, uid, event_id as hold_ref, details from public.turn_grant_failures where reason = 'length_mismatch' order by created_at desc;`
(`details`: the credits held, the output's seconds and what it really cost; the same cases are in the dashboard's Edge Functions → `image-proxy` → Logs: search `length_mismatch`)
· in the same `image-proxy` logs: `snapshot copy failed` / `snapshot upload failed` mean a render's video couldn't be copied, so it was held and billed at the longest length (many in a row point to Storage, not to users); `stt_length_mismatch` means the provider reported a longer recording than the file declared (charged at the file's length, never more)
· the snapshot copies of renders still running (see "Snapshots"; one older than 2 days is a leftover the reconciliation removes): `select name, created_at from storage.objects where bucket_id = 'turn-assets' and starts_with(name, '_internal/video-snapshots/') order by created_at;`
· what the webhook applied: `select id, action, uid, result, processed_at from public.turn_stripe_events order by processed_at desc limit 50;`
Reports over `turn_usage_events` that span the switch mix units: split them at the
switch marker's date.

Offline test: `node scripts/test-billing-db.mjs` (PGlite: production = `credits.sql`
at commit 1aaf9ad, then the files, every contract function, legacy callers,
privileges, holds and provider jobs, expiry, refunds, trial, the switch and its undo,
the housekeeping schedule and the reconcile calls on pg_cron / pg_net stand-ins, the
reconciliation's functions, fresh-install equivalence). To run only some sections, set
`TEST_SECTIONS` to their letters (listed at the top of the file), e.g.
`TEST_SECTIONS=J node scripts/test-billing-db.mjs`; unset, everything runs.

## Tax & compliance records (`tax-compliance.sql`)

**Status (2026-10-01): written and tested offline; NOT run on production.**
Owner decisions 2026-10-01: prices stay in US dollars; the Admin panel warns when a tax
registration is due (the owner lives and works in the UK and advertises to UK, EU and US
users); every buyer gets a 14-day right to cancel, the unused part back (the law requires it
for UK and EU consumers; the Terms give it to everyone); since 2026-10-02 there is no consent
step: a note sits behind an ⓘ next to every plan's and pack's name (and under the chosen plan in
the sign-up window) and the click is the request to start straight away; a partial refund
removes the same share of credits; a closed dispute lifts its own hold.
The owner's steps, with the Stripe settings and what to do about tax, are in
`docs/Billing Rollout Runbook.md`, section (9).

### What it adds

- **`turn_sales_ledger`** — one row per successful payment on the Stripe account and one
  negative row per refund, written by `stripe-webhook` only (`turn_record_sale_once`, once
  per source key: `invoice:<id>`, `checkout:<id>`, `refund:<refund id>`). It covers **every
  product on the account** (the other products sold there belong to the same business, so
  they count toward the same VAT turnover): `app` is `kinolot` or `other`, `kind` is `plan`,
  `pack`, `other` or `refund`. `country` is the billing country (ISO-3166 alpha-2), `region`
  the US state, `country_source` where the webhook found it (the invoice's customer address,
  the checkout's customer details, the customer, the charge's billing details, the card).
  No names, emails or card details. No foreign key to the account: tax records outlive a
  deleted account (UK: generally kept six years).
- **`turn_checkout_consents`** — the request to start straight away (the 14-day right to
  cancel) the app records when a plan or pack purchase button is clicked, right before the
  payment page opens (`turn_record_checkout_consent`; the note "Starts straight away. Cancel
  within 14 days and you get back the part you haven't used." sits behind an ⓘ next to each
  plan's and pack's name, which the button points at with `aria-describedby`, and under the
  chosen plan in the sign-up window),
  as `v3-2026-10-02-click`; the post-sign-up auto-checkout (no click) as `v3-2026-10-02-auto`.
  If the call fails (this file not run yet), the checkout still opens; the payment link asks
  for nothing extra (owner decision 2026-10-02), so this is the only record.
- **`turn_admin_tax_summary(usd_to_gbp default 0.80)`** — the Admin panel's "Tax &
  compliance" figures, for the admin (`admin@infinitestudioai.com`, the signed-in JWT's
  email, as `admin-storage` and `image-proxy` decide) or the SQL Editor; everyone else is
  refused (42501), the anon key cannot call it at all.
- **Partial refunds** — `turn_revoke_charge_once(event_id, charge_id, refund_fraction
  default 1)` (in `billing-v2.sql`, see **Billing v2** above): a partial refund removes the
  same share of that payment's credits (credits held by a running job count as unused: they
  are taken out of the hold). That is why `billing-v2.sql` runs once more first. Only a
  SUCCEEDED refund counts: a pending one (bank transfers, some wallets) removes nothing and
  writes no ledger row until Stripe's `charge.refund.updated` says it succeeded; a refund that
  fails afterwards is recorded in `turn_grant_failures` (`refund_failed_review`). For a plan
  invoice paid partly from the customer's Stripe balance, the share is of the invoice total.
- **`turn_dispute_hold(uid, dispute_id, open, part)`** — the webhook's ONE call that adds or
  removes a dispute's part of an account hold, under the account lock: two disputes handled at
  the same moment never lose each other's part, a closing dispute lifts the hold only when
  nothing else holds the account (an earlier hold or another open dispute keeps it), and a
  held account that this dispute didn't hold is left alone (`dispute_closed_review`). Without
  this file the webhook falls back to the old two-step update (`DISPUTE_HOLD_FALLBACK`).
- **The thresholds live in ONE place:** `turn__tax_thresholds()` in this file (and its copy
  in `credits.sql`), with the date they were last checked (2026-10-01): UK GBP 90,000 of UK
  sales in any rolling 12 months (warn at 75 % and 90 %, over at 100 %); EU from the first
  sale (a UK business selling digital services to EU consumers registers for the non-Union
  OSS scheme first); US USD 100,000 or 200 sales a year per state (a conservative common
  test; warn at 80 %). The summary returns them, so the app never hard-codes them. When a
  rule changes, edit that one function, set `checked`, and re-run the file. These are
  warnings, not tax advice: check with an accountant.

### Order (owner steps)

1. *(SQL Editor, as postgres)* run **`billing-v2.sql`** again — safe to re-run (functions
   and grants are put back, the carry-over never happens twice); every RESULT row `ok`. It
   adds the optional `refund_fraction`; the two-argument call keeps working.
2. Run **`tax-compliance.sql`**. Its 10 RESULT rows must read `ok`; row 80 ("Partial
   refunds") says FAIL until step 1 has run. It stops, changing nothing, if `billing-v2.sql`
   never ran. One transaction, safe to re-run, never touches data.
3. *(Mac, after `git pull`, with the owner's go-ahead)* deploy `stripe-webhook`
   (`--no-verify-jwt`). From then on it records every payment and refund; on a database
   without this file it logs the missing function and carries on (the event never fails).
   *(Stripe dashboard, right after)* webhook endpoint → add the event
   **`charge.refund.updated`** (ten in all): it applies a refund that was pending when
   `charge.refunded` came, once it succeeds.
4. *(Replit)* Pull, then Publish: the 14-day note behind the ⓘ next to every plan's and pack's
   name (the click on a purchase button is recorded) and the Admin panel's "Tax & compliance" panel.

Fresh installs: `credits.sql` carries the same definitions (the block between the
`>>> KINOLOT TAX COMPLIANCE DEFINITIONS >>>` markers is byte-identical in both files).

### The functions (contract) and who may call them

| Function | Caller | Returns / does |
|---|---|---|
| `turn_record_sale_once(source_key, app, owner, kind, amount_cents, currency, country, region, country_source, occurred_at, stripe_ids)` | service role | boolean — `true` when this call recorded it, `false` when that source key already was (nothing changes). Currency lower-case, country upper-case (anything that isn't two letters is stored as no country, its raw value kept in `stripe_ids.country_raw`), a refund always negative; a negative amount for anything else, an unknown kind, a missing key / app / currency is refused (22023). No `occurred_at` = now. |
| `turn_record_checkout_consent(sku, consent_version)` | signed-in user | void — stores the caller's own consent (`owner = auth.uid()`; no user = refused). `sku` names the purchase as the app sends it (`plan-writer`, `plan-director`, `plan-studio`, `pack-250`, `pack-1000`, `pack-3000`; `credits-300` / `credits-1200` / `credits-4000` for the old packs), `consent_version` the wording shown (`v3-2026-10-02-click` since 2026-10-02: no step, the click on a purchase button next to the note "Starts straight away. Cancel within 14 days and you get back the part you haven't used."; `v3-2026-10-02-auto` when the plan picked before sign-up opens its payment page by itself once the account is ready — no click at that moment: the same note sat under the chosen plan in the sign-in window and is shown in a notice for about 4.5 s before the page moves; before it `v2-2026-10-01`, the "Before you pay" checkbox "…I understand I lose my right to cancel for credits I use, and if I cancel within 14 days I only get back the part I haven't used."; `v1-2026-10-01` was never published). More than 200 in a day from one account are not stored (no error). |
| `turn_dispute_hold(uid, dispute_id, open, part default null)` | service role | jsonb `{action, frozen, frozen_reason}` — under the account lock: `open = true` adds this dispute's part to `frozen_reason` (parts separated by ` \| `; once; an earlier hold is kept, one without a reason as "earlier hold (no reason given)") → `frozen`; `open = false` removes it: nothing left → unfrozen, reason = `part` → `lifted`; other holds left → `kept`; held but not by this dispute → `review` (nothing changes); not held → `lifted`. A non-Stripe dispute id is refused (22023), an unknown account 23503. |
| `turn_admin_tax_summary(usd_to_gbp default 0.80)` | signed-in user, the admin only inside | jsonb `{as_of, usd_to_gbp, thresholds {uk_gbp, us_usd, us_tx, checked, uk_watch_pct, uk_near_pct, us_near_pct}, window_from, uk {usd_12m, gbp_12m_est, pct, status ok·watch·near·over, sales_12m, gbp_30d_est, unknown_gbp_est, pct_with_unknown}, eu {sales_12m, usd_12m, first_sale_at, status watch·over, by_country [{country, sales, usd}]}, us {sales_12m, usd_12m, by_state [{state, sales, usd, pct_usd, pct_tx, status ok·near·over}]}, rest {sales_12m, usd_12m, by_country}, unknown {sales, usd}, by_app [{app, usd_12m}], other_currencies [{currency, sales, amount_minor}], ledger {rows, first_sale_at, recording_since}}`. The window is the last 12 months up to now; refunds net off the amounts, never the sales count; USD and GBP are converted with `usd_to_gbp` (GBP per USD, a conservative high rate; 0 < rate ≤ 10); other currencies are listed, not converted. UK = GB and the Isle of Man; EU = the 27 states (Greece is `GR`) and Monaco; `first_sale_at` is the first EU sale ever (OSS applies from it). Only totals: no account ids, emails or Stripe ids. |

`turn__tax_thresholds()`, `turn__tax_is_uk(text)`, `turn__tax_is_eu(text)`,
`turn__tax_is_admin()` and `turn__tax_window(timestamptz, numeric)` are helpers no API role
can call. Both tables have row-level security on and no grants: nobody reads or writes
them through the API (not even the admin, who reads the summary).

**Read-only checks (SQL Editor):** `select public.turn_admin_tax_summary();` (or
`(0.82)` for another rate) · `select app, kind, currency, count(*), sum(amount_cents) from public.turn_sales_ledger group by 1, 2, 3 order by 1, 2, 3;`
· payments with no country (turn on billing-address collection on that link):
`select source_key, app, occurred_at from public.turn_sales_ledger where country is null order by occurred_at desc;`
· consents: `select sku, consent_version, count(*) from public.turn_checkout_consents group by 1, 2;`
(one buyer's: `… where owner = '<user id>' and sku = 'pack-1000'`)

**Payments from before the ledger** (the other products' sales of the last 12 months, or
income from outside Stripe, all count toward the UK figure) can be added by hand in the SQL
Editor, once each:
`select public.turn_record_sale_once('manual:<unique name>', 'other', null, 'other', <amount in cents or pence>, 'gbp', 'GB', null, 'manual', '<date>', '{}');`

Offline test: `node scripts/test-tax-compliance-db.mjs` (PGlite: production as it is today,
then the `billing-v2.sql` re-run and this file; privileges, recording, the summary's buckets
and statuses at their exact thresholds, the consent, the dispute holds, partial refunds of
packs and plans — released or settled jobs included —, fresh-install equivalence, these docs).

## Frances's daily question limit (`frances-daily-limit.sql`)

**Status (2026-09-29): the SQL was run on production by the owner on
2026-09-29 (every RESULT row ok). The `image-proxy` change that uses it is not
deployed yet: publish the new app first, then deploy (see "Deploy order" below).**

Owner decision (2026-09-28): chatting with Frances stays free, up to **50
questions per person per UTC day**, so nobody can use her as a free general AI.
**Caps by plan (owner decision 2026-09-30, billing fixes):** 5 questions a day for
no plan / a trial / a cancelled or frozen account, 15 Writer, 30 Director, 50
Producer; admins exempt. `image-proxy` passes the caller's cap
(`billing-policy.mjs` `FRANCES_PLAN_LIMITS`) and the `FRANCES_DAILY_LIMIT` secret is
a ceiling over every plan. No SQL change: `turn_frances_consume` already takes the
limit as an argument.
For each free Frances question (only after `muse-billing.mjs` has accepted it as
hers) `image-proxy` asks `turn_frances_consume` for one of today's slots through
its service-role client. With none left it answers HTTP 429
`{ error: "frances_daily_limit", message, limit, used, resets_at }`, calls no model, and
the chat shows Frances's calm reply ("That’s today’s 50 free questions — I’ll be
back after midnight UTC (in about 5 hours)."), not an error. Admins are never
counted. The count starts again at midnight UTC; rows older than 35 days are
tidied away as people ask.

**Voice counts too** (owner decision 2026-09-29). Each New Story voice session
(`image-proxy` task `"live"`) takes one of the same daily slots, through the same
limiter and `turn_frances_consume`, after the request is validated and before any
session is created: one slot per session, however long it lasts. A session that
then fails to open is not given back, as with a question, so each "Try live again"
after a failed start (the audio connection blocked, a provider outage, the 15-second
startup timer) uses another slot; Frances's facts tell users so. Giving the slot back
would need a small service-role decrement function in `frances-daily-limit.sql`,
which means another production run: an owner decision, not done. Past the limit it
answers the same HTTP 429 `frances_daily_limit` and opens no session; New Story
shows "That’s today’s 50 free questions with Frances — voice included. She’ll be
back after midnight UTC (in about 5 hours). You can use the typed interview in
the meantime." A burst gets 429 `frances_busy` and "One conversation at a time,
please — try again in a moment." Admins are exempt and it fails open, exactly as
for questions. The typed New Story interview is not counted. No SQL change is
needed.

**Deploy order: the app first, then `image-proxy`.** An app still loading the older
`app/livevoice.js` shows the bare code (`frances_daily_limit` or `frances_busy`) in
New Story's error box instead of these lines, and the older `app/ai.jsx` shows a
technical "Couldn't reach Frances" error in the chat instead of Frances's reply. So
first ship the app with new cache keys in `TURN.html` for `app/livevoice.js?v=`
(also add the new key to the regex in `scripts/test-gpt-live.mjs`) and
`app/ai.jsx?v=` (it shares its key with `app/script.jsx`; add the new key to the
`LATER` lists in `scripts/test-round1-integration.mjs`, `scripts/test-screen-time.mjs`
and `scripts/test-art-tab-locks.mjs`), and only then deploy `image-proxy`. A new app
talking to the old proxy behaves exactly as before, so this order is safe.

**Bursts are refused, not served.** The function waits at most 1 second for a
person's day row (`lock_timeout`). Only that person's own calls hold it, and the
app sends one question at a time, so a call still waiting after 1 second is one
of a burst of parallel calls: it counts nothing and the proxy answers HTTP 429
`{ error: "frances_busy", message }` with no model call; the chat shows "One
question at a time, please — ask me again in a moment."

**It fails open.** Until this file is run, or whenever the call fails or takes
longer than 8 seconds (far above a normal answer and the 1-second busy wait, so
only an outage gets there), Frances answers anyway and the function logs the problem
once per instance ("Frances daily limit not enforced (missing: …)" in the
function's logs). The older 24-hour allowance in `muse-billing.mjs` still
applies meanwhile. So the SQL and the deploy can go in either order; the limit
is on once both are live. (The file ends by telling the Data API to reload its
schema. If the logs still say `missing` after the SQL has run, run
`notify pgrst, 'reload schema';` in the SQL Editor once.)

**Set it up (once):**

1. *(SQL Editor, as postgres)* paste **`frances-daily-limit.sql`** → Run. It
   needs only Supabase Auth, is one transaction (a failed run changes nothing)
   and is safe to re-run (counts are kept; the function, its grants and the
   table's lock-down are put back). Rows 10–50 of the RESULT table must read
   `ok`; row 60 counts today's questions. It creates the table
   `public.turn_frances_usage` (row-level security on, no policies, no access for
   anon / authenticated) and the function `public.turn_frances_consume(uuid, integer)`
   (security definer, refuses anyone but service_role; EXECUTE for service_role only).
2. *(Mac, after `git pull` — deploying `image-proxy` from one machine overwrites
   the other's edits to it)*
   `npx supabase functions deploy image-proxy --no-verify-jwt`
   — only once the app with the new `app/livevoice.js` and `app/ai.jsx` cache keys
   is live (see **Deploy order** above).
3. *(Optional, Mac)* A different ceiling:
   `npx supabase secrets set FRANCES_DAILY_LIMIT=<whole number 1–100000>`.
   Unset, or anything else, means 50. Since 2026-09-30 it is a ceiling over the
   plan caps (set it to 10 and nobody gets more than 10). No SQL change is needed to
   move it, and the limit reply names whatever limit the server sends. **But
   Frances's own facts name the number too:** in the same change, update the Frances
   entry in `APP_FEATURES` (app/ai.jsx: the caps by plan and the example reply),
   `FRANCES_DAILY_LIMIT` and `FRANCES_PLAN_LIMITS` in app/ai.jsx, then bump
   `app/ai.jsx?v=` in `TURN.html`. Otherwise Frances keeps telling people the old number. (To change
   the default itself, also change `FRANCES_DAILY_LIMIT_DEFAULT` in
   `functions/image-proxy/frances-limit.mjs` and redeploy; the offline test checks
   that these numbers agree.)

**Check** *(SQL Editor)*: `select * from public.turn_frances_usage where day = (now() at time zone 'UTC')::date order by questions desc;`
Give one person a fresh day: `delete from public.turn_frances_usage where user_id = '<uid>' and day = (now() at time zone 'UTC')::date;`

**Remove:** `drop function if exists public.turn_frances_consume(uuid, integer); drop table if exists public.turn_frances_usage;`
(the proxy then fails open again: no daily limit).

Offline test: `node scripts/test-frances-limit.mjs` (the SQL on PGlite, the
proxy's real `index.ts` against it, the decision helper, and the chat's reply);
`node scripts/test-frances-voice-limit.mjs` (the voice session's slot, refusal,
admin exemption, fail-open and busy answer on the real `index.ts`, and New Story's
calm lines).

## Optional: server-side image proxy (`image-proxy` Edge Function)

OpenAI's **GPT Image** can't be called from a browser at all (OpenAI blocks
cross-origin requests). And while Google's **Nano Banana** *can* run in the browser,
you may not want its key sitting there either. So TURN routes generation through an
Edge Function that holds each provider's key as a **server secret** and calls the API
server-side (the "wrapper company" approach). With the proxy on, **both** image
providers run server-side and no provider key lives in the browser.

The same function also serves a **`text` task** — the model behind MUSE, spec
drafting, and the Writers' Room agents (`window.claude.complete`) — plus the
authenticated **`live` task** that exchanges a browser WebRTC offer for MUSE's
GPT-Live session. It calls providers server-side with the same secrets, so neither
writing nor live voice exposes the service key in the browser.

**Deploy it (once):**

1. `npx supabase login` (no global install needed — runs from npx. `brew install
   supabase/tap/supabase` also works; `npm i -g supabase` is NOT supported and fails
   on default macOS npm perms.)
2. `npx supabase link --project-ref vubenblfdzginlqiglzw`
3. Set both provider secrets:
   - `npx supabase secrets set OPENAI_API_KEY=sk-...` (org-verified for GPT Image)
   - `npx supabase secrets set GOOGLE_API_KEY=...` (your Google AI Studio key)
4. `npx supabase functions deploy image-proxy --no-verify-jwt`
   (`--no-verify-jwt` is required: the function does its **own** sign-in check and
   answers the CORS preflight itself. With the platform's default JWT gate on, the
   browser's unauthenticated `OPTIONS` preflight is rejected with 401 and every call
   fails. Sign-in is still enforced — by the function, not the gateway.)
5. In `app/supabase-config.js` set **`imageProxy: true`**.

Redeploy this function whenever its task routes or image-quality capability
schema change; the unauthenticated `OPTIONS` response is the browser's safe
capability handshake, so an image-quality update is not live until this
function is redeployed. If New Story's **Talk it
through** reports `No prompt supplied`, the browser is reaching an older deployment
that predates the `live` task; repeat step 4 and reload TURN from localhost or HTTPS.

Once deployed, all generation runs through the proxy for signed-in users: **GPT
Image 2** appears as a model option, and **Nano Banana** is routed server-side too,
so no provider key sits in the browser. While `imageProxy` is `false`, GPT Image is
hidden and Nano Banana runs in-browser with your local Google key.
Add more providers by branching on `provider` inside the function and giving it the
matching secret.
