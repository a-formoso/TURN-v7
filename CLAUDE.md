# Kinolot — project notes (internal codename: TURN)

**Kinolot** (say *KEE-no-lot*) **by Infinite Studio AI** — a story-architecture app for AI filmmakers (value
charges, scenes that turn, beats → script → Art Room → Stage). Served at **https://kinolot.infinitestudioai.com**;
`cinema.infinitestudioai.com` and the existing Replit hosts stay working as **legacy hosts** wherever hosts are listed.

## 🏷️ Names users see (owner decisions 2026-09-28) — never regress these
- **Product: Kinolot.** Where the company is shown: "Kinolot by Infinite Studio AI". "Cinema Machine" is the old name.
- **Company: always "Infinite Studio AI"** — in UI copy and in everything the models / the assistant are told.
- **Method: "the Infinite Studio AI method".** Nothing user-facing or model-facing may name McKee / Robert McKee /
  Claude / Anthropic or any AI vendor (system-prompt rules + the neutral `scrubBrand()` / `museScrubReply()` /
  `scrubAnalysis()` safety nets in `app/ai.jsx` — they never turn a vendor's name into a claim about the company).
  Story text gets the narrow `scrubBrand()`; the studio's own analysis fields (Story Doctor rationale, re-read,
  fusion note, Final Read, voice check) get `scrubAnalysis()`, which removes every McKee but the film's own words.
- **TURN is the internal codename ONLY** — repo, `TURN.html`, `turn_*` tables, the `turn-assets` bucket,
  `window.TURN_*` globals, storage keys, ids. It must **never** appear to users: no UI string, tooltip, toast,
  confirm, error, admin copy, export file name or assistant fact/instruction. **`scripts/test-brand-guard.mjs`**
  enforces it for the whole app (every user-facing literal, what Frances is told, the HTML pages, the exports) —
  it also fails on "Cinema Machine", MUSE as a name, the retired agent names and "Infinite Studio" without " AI";
  the per-area `scripts/test-rebrand-*.mjs` tests pin each surface's exact copy.
  A new internal literal that must keep an old name goes in its commented ALLOWLIST, never around it. The craft verb
  in MODEL prompts ("each scene must TURN its value") may stay.
- **The assistant is Frances** (internal code name **MUSE**: `app/muse.jsx`, `museSystemPrompt()`, `docs/MUSE Protocol.md`
  keep their names). Frances **only answers** (the help dock + New Story's voice conversation) and never claims to be
  named after anyone. The WRITING actions carry **no persona**: "Draft", "Drafting…", "Rewriting the prose…", versions
  "AI draft" / "AI polish", "Auto — picks per draft".
- **Story Editors** (Writers' Room agents) keep job titles: Story Doctor, Script Supervisor (id `consistency`), Setups &
  Payoffs (id `continuity`), Adaptation, Final Read (id `tableread`). **Department Heads** (Art Room agents): Visual
  Researcher, Casting Director, Props Master, Location Scout, Colorist, Shot Designer, Art Coordinator, Production check.
  One apostrophe style: "Writers' Room" (straight).
- **Display-only renames** (every internal id, role key, plan id and stored value stays): the collaborator role
  `writer` shows as **"Co-writer"**; the plan `studio` shows as **"Producer"**. Stripe metadata (owner
  2026-09-29): products carry `app=kinolot` (pre-rebrand ones `app=cinema-machine`; the webhook accepts both, and
  nothing else) and the Producer product `tier=producer`, which the webhook stores as plan **`studio`** — the id
  turn_credits, image-proxy, blender-bridge and the app gates check. Both rules live in
  `supabase/functions/stripe-webhook/plan-metadata.mjs` (tested by `scripts/test-stripe-metadata.mjs`).
- **Stored data is never migrated:** a label already saved in users' data ("MUSE draft", "TURN prompt compiler", an
  agent's old name in a saved log) is mapped to today's name **where it is displayed** — `window.turnDisplayNames()`
  (agents.jsx: old agent names, "MUSE draft/polish", "TURN prompt compiler"), `promptCompilerLabel()` (artroom.jsx),
  `window.turnPlanDisplayName()` (plans.jsx: `studio` → "Producer"), `teamRoleLabel()` (team.jsx: `writer` →
  "Co-writer") and `serverText()` (admin-storage.jsx: server text that still says TURN). Show saved text through these.
- **Screenplay exports credit the writer, never the company:** Fountain `Author:` and the PDF/HTML title page's
  "written by" show the film's own author if it has one; else, on a film shared WITH the user, the film's owner
  (`window.turnOpenFilmCredit`, set in app.jsx — never the collaborator who exports); else the signed-in user's
  display name / handle (`cloudHandleName()`: a "+tag" is dropped); with no name the credit line is left out.
  A small "Made with Kinolot" tool note is fine; authorship is the user's.

## 📐 Story-building process — follow the skill
When building a story (New Story → spine, Adaptation, or any seed→script flow), follow the canonical
pipeline in **`docs/Story Pipeline.md`**. It is owned by the user — **do not add, remove, reorder, or
change any step without their explicit prior permission.** Propose changes and wait for a yes.

## ⚠️ Keep Frances's product knowledge in sync
Frances (the in-app help assistant, codename MUSE) answers users' how-to / product questions from a **single capability manifest**: the `APP_FEATURES` array in `app/ai.jsx`. It is the source of truth fed into her system prompt via `museBrief()` / `appBrief()` (after `musePublicFeature()` drops vendor, plumbing and billing sentences).

**Whenever you add, rename, or change a user-facing feature, update `APP_FEATURES` in `app/ai.jsx` in the same change.** If you don't, Frances will give users outdated or confabulated answers. She is also instructed to say "I'm not sure" rather than guess about anything not in that list.

## 🛡️ Frances answer protocol
How Frances is allowed to answer users (scope, identity, confidentiality, tone, refusals, staying in character) is governed by **`docs/MUSE Protocol.md`**. The protocol is enforced in code by `museSystemPrompt()` in `app/ai.jsx` (the system prompt) and, for New Story's voice, by the live-voice instructions in `supabase/functions/image-proxy/index.ts`, with `museScrubReply()` (which runs `scrubBrand()`) and `museFinalAnswer()` as safety nets. **If you change one, change the other** so the doc and the prompts stay in sync. Frances is the floating help assistant (`app/muse.jsx`, voice + chat) — she only answers; she never edits the story.

## 🔀 Two working copies — never reason about Replit from branch names
Work happens in **two places**: this local repo and the **Replit workspace**. Either can be ahead.

**Home since 2026-09-27: `github.com/a-formoso/TURN-v6`** (the Mac's `origin`; the old TURN-v5 repo is kept
read-only as the `v5-archive` remote) and the **Replit project TURN-v6**, connected to it. The old Replit project
*TURN-v5* is retired: its remote was also pointed at TURN-v6, so never push from it.

**Before proposing any `reset --hard`, merge, sync-conflict resolution, or "Replit is behind" claim:**

1. **Push from Replit first.** In the Replit *Shell* (not the agent chat), on separate lines — chaining
   with `&&` hides failures, because `git commit` exits non-zero on "nothing to commit" and silently
   skips the push:
   ```
   git status --short && git log --oneline -5
   git push -u origin HEAD
   ```
2. **Then** compare on GitHub: `git fetch origin --prune` and `git rev-list --left-right --count <branch>...origin/main`.

**The `origin/replit*` branches are stale checkpoints and say NOTHING about the workspace's real state.**
On 2026-08-01 they read 200 commits behind while the live Replit workspace was 14 commits *ahead* of
`main`, holding four days of unpushed work (fal price-drift watcher, Stripe grant-failure persistence,
a storage service-role/RLS fix). Acting on the branch names would have destroyed all of it.

**Label every command with the machine it runs on.** `~/.supabase/access-token` and the Supabase CLI
deploy exist only on the Mac; running them in Replit fails with a confusing auth error.

**Deploying `image-proxy` from one machine silently reverts the other's edits to it** — the edge
function is deployed whole from a local file, not merged. Always `git pull` before `supabase functions
deploy`, or you overwrite fixes made elsewhere.

## Architecture
- `app/story-data.jsx` — sample film (The Matrix) data: SCENES, BEATS, SCREENPLAY, FACTS + CONTINUITY map.
- `app/ai.jsx` — model wiring (drafting, polish, scene authoring, the Frances/MUSE chat, agent helpers: aiSuggestTurn/aiPlantLine/aiTableRead/aiBuildSpine) + `APP_FEATURES`.
- `app/agents.jsx` — bounded-loop agent engine + the Story Editors (Story Doctor, Script Supervisor, Setups & Payoffs, Adaptation, Final Read) and the Art Room's Department Heads. Each works on a working `model` and gates changes behind `propose()`.
- `app/agents-ui.jsx` — Writers' Room modal: agent picker, reasoning trace, approval cards.
- `app/spine.jsx` — value-charge graph + filmstrip + DragScroll pan.
- `app/inspector.jsx` — editable scene/beats/analysis panel.
- `app/script.jsx` — Script view, continuity checker, version history.
- `app/chrome.jsx` — top bar + left rail. `app/app.jsx` — state + composition (scenes, beatsMap, drafts, continuityMap, agent ctx factory).
