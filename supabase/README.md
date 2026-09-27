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
   Then run `invitations.sql` — adds `turn_claim_memberships()`, which links
   invitations to the invitee's account on their first sign-in.
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
   nothing removes a queued upload's bytes. The files of a deleted Show or
   Episode stay in Storage too: once the project row is gone, Storage's read
   rule (`turn assets read collab`, which needs the project) hides its files
   from every signed-in user, so neither the uploader's client nor the owner's
   one-hour cleanup grants can delete them. `admin-inventory.sql` lists them
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
`app-config.sql` / `styles.sql` as used, `admin-inventory.sql`, and
`admin-storage.sql` (see **Admin Storage page** below). Offline test of the
readable-folders step: `node scripts/test-storage-readable-folders.mjs` (the SQL), plus
`test-storage-keys.mjs` (the one key parser, JS = SQL), `test-storage-folders-client.mjs`
(the app's folders, fallbacks and one-shot legacy retry) and
`test-storage-service-paths.mjs` (image-proxy staging, the Blender relay PNG and Studio
previews).

### Readable storage folders: rollout, rollback and checks

- **Before the functions and the app go live (owner decision O1, open).** Readable
  keys carry the account handle (the email's local part, e.g. `john-smith` for
  john.smith@acme.com) and the project's first real title. Every signed URL shows
  its object key, so these names reach whoever gets such a URL: collaborators, people
  a URL is shared with, and the AI providers (fal.ai and others) that image-proxy
  hands staged inputs to (`{handle}--{uid}/stage-tmp/…`), in their request logs.
  `privacy.html` ("We send only what the feature needs") does not say so yet. Add the
  sentence the owner approves to `privacy.html` before deploying `image-proxy` /
  `blender-bridge` and publishing the app. Until then the SQL can go in on its own
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

Adding a collaborator in the Team panel writes the membership row AND sends the
actual invitation email through Supabase's **built-in auth mailer** (no
third-party mail provider): new addresses get the "Invite user" email (their
account is pre-created), existing accounts get a magic-link sign-in email.
Either link lands on `/?invite=<projectId>` — the app's acceptance surface.

**Set it up (once):**

1. SQL Editor → run `invitations.sql` (account linking on first sign-in).
2. `npx supabase functions deploy invite-collaborator --no-verify-jwt`
   (same convention as `image-proxy`: the function does its **own** sign-in +
   owner check and answers the CORS preflight itself.)
3. **Authentication → URL Configuration → Redirect URLs** — add every origin
   the app runs on (production domain, and the dev URL while testing). Invite
   links redirect to `<origin>/?invite=...`; unlisted origins silently fall
   back to the Site URL and the landing context is lost.
4. *(Recommended)* **Authentication → Email Templates → "Invite user"** — the
   function passes the film and inviter as template data, so you can write:
   `{{ .Data.invited_by }} invited you to work on “{{ .Data.invited_project }}”`.
   The magic-link template (existing accounts) has no per-invite data; keep its
   copy generic — the in-app landing names the film and inviter.
5. **Heads-up on volume:** Supabase's built-in mailer is rate-limited to a few
   auth emails per hour. Fine for trying the flow; configure custom SMTP
   (Project Settings → Auth → SMTP) before inviting a real team.

If the function isn't deployed yet, the Team panel still adds the collaborator
and says plainly that the email wasn't sent (they can still sign in with that
address and find the film shared).

## Admin Storage page (`admin-storage` Edge Function)

**Status (2026-09-27): built and tested offline; not deployed, and
`admin-storage.sql` has not been run on production.**

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
   rows 10–40 read `ok`. It creates only the private audit schema
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
