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
4. **SQL Editor → run `cameos.sql`** — creates the `turn_cameos` table (RLS).
5. **Authentication → Providers** — enable whichever sign-in you chose
   (Email magic-link and/or Google OAuth).
6. Paste your **Project URL** and **anon public key** into `app/supabase-config.js`.
   The anon key is safe in client code — RLS is what protects the data.

   (No "Exposed schemas" step is needed — the tables live in `public`, which is
   exposed by default.)

## Architecture

- **Storage adapter layer** — all image reads/writes go through one interface with
  two backends: `local` (current IndexedDB) and `supabase`. The app code is
  unchanged; only the backend swaps based on auth state. Local stays as an offline
  cache; Supabase is the source of truth when signed in.
- **Images** are uploaded as real PNG **files** (not base64 in a DB column) to
  `turn-assets/{user}/{project}/{assetType}/{entity}/{role}[-v{N}]-{timestamp}-{shortId}.png`
  (assetType ∈ character|prop|location|shot|cameo; role ∈ sheet|ref-*|cameo-angle; the
  optional `v{N}` is a non-authoritative version-at-birth hint on sheets),
  fixing the 4K bloat problem. The first path segment is always the user id — RLS
  pins it to `auth.uid()` — and only stable IDs (never display names) appear in paths,
  so renaming a project or character never orphans its files.
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

## Optional: server-side image proxy (`image-proxy` Edge Function)

OpenAI's **GPT Image** can't be called from a browser at all (OpenAI blocks
cross-origin requests). And while Google's **Nano Banana** *can* run in the browser,
you may not want its key sitting there either. So TURN routes generation through an
Edge Function that holds each provider's key as a **server secret** and calls the API
server-side (the "wrapper company" approach). With the proxy on, **both** image
providers run server-side and no provider key lives in the browser.

The same function also serves a **`text` task** — the model behind MUSE, spec
drafting, and the Writers' Room agents (`window.claude.complete`). It calls Gemini
or OpenAI server-side with the same secrets, so the writing AI is key-free too;
users pick the model (Gemini 3.5 Flash / GPT) from the dropdown in the MUSE header.

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

Once deployed, all generation runs through the proxy for signed-in users: **GPT
Image 2** appears as a model option, and **Nano Banana** is routed server-side too,
so no provider key sits in the browser. While `imageProxy` is `false`, GPT Image is
hidden and Nano Banana runs in-browser with your local Google key.
Add more providers by branching on `provider` inside the function and giving it the
matching secret.
