# Kinolot by Infinite Studio AI (internal codename: TURN)

Story-architecture app for AI filmmakers. Build a spine, write scenes that turn, develop beats into a screenplay, design cast and world, storyboard the film.

## Stack

- **Buildless React 18** — no bundler; Babel standalone compiles JSX in-browser
- **Supabase** — auth + cloud storage (anon key in `app/supabase-config.js`); app works offline on localStorage when signed out
- **Static file server** — `node serve.js` on port 5000

## How to run

```
node serve.js
```

The workflow "Start application" runs this on port 5000 and serves the Replit preview.
The browser app is buildless, so `node serve.js` needs no npm packages; the
declared npm dependencies are installed for `npm run build`. Signed-out work
uses local browser storage. Sign-in, cloud sync, and generation require the
existing Supabase project and its server-side services to be available.

The main web address forwards to port 5000. The initial signed-out screen is
the landing page; signed-in screens and cloud/generation services require
separate authenticated verification. Development Babel size notices are
expected for the larger JSX files; `npm run build` precompiles production assets.

## Project layout

- `TURN.html` — entry point; loads all scripts in order
- `app/` — all React components (`.jsx`) and styles
- `app/ai.jsx` — model wiring, the Frances (codename MUSE) help chat, agent helpers, `APP_FEATURES` manifest
- `app/app.jsx` — top-level state and composition
- `app/chrome.jsx` — top bar + left rail
- `app/spine.jsx` — value-charge graph + filmstrip
- `app/contract.jsx` — Story Contract (outer plot · inner arc · dominance) registry + rail panel
- `app/agents.jsx` — bounded-loop agent engine
- `app/story-data.jsx` — sample film data (The Matrix)
- `docs/` — pipeline, protocol, and plan docs
- `serve.js` — static file server
- Blender preview proof: `docs/Blender Bridge.md`; web UI/client in `app/blender-*`,
  relay in `supabase/functions/blender-bridge/`, desktop add-on in `blender/`.
  `npm run build` packages its installable ZIP. The relay uses Supabase; static
  website publishing stays unchanged. Blender is a development-only verification
  dependency, not required by the website or its cloud relay.

## Blender product direction

The intended product goes beyond the original one-shot preview proof: Higgsfield-style
AI-assisted scene building inside Blender, connected to Kinolot's existing
locations/contained places, character references, and shots. The aim is reusable
sets and shot blocking/camera references returned for later Seedance animation,
not isolated throwaway scenes for every shot. See `docs/Blender Studio.md` for the
implemented extension and its boundaries. Provider tests use fake generation
boundaries; development must not spend generation credits without approval.

## Important conventions (see AGENTS.md for full details)

- **Names users see (owner decisions 2026-09-28)**: the product is **Kinolot** ("Kinolot by Infinite Studio AI"), the company is always **Infinite Studio AI**, the method is **the Infinite Studio AI method**, the help assistant is **Frances** (codename MUSE; she only answers), writing actions carry no persona ("Draft", "AI draft"). **TURN is the internal codename only** and must never appear to users; `scripts/test-brand-guard.mjs` enforces it. See CLAUDE.md for the full list.
- **Branding**: never name McKee / Robert McKee / Claude / Anthropic or any AI vendor in Frances's output; `scrubBrand()` / `museScrubReply()` / `scrubAnalysis()` in `ai.jsx` are the safety nets
- **APP_FEATURES** in `ai.jsx` is the source of truth for Frances's product knowledge — update it whenever you add or rename a user-facing feature
- **Story pipeline** in `docs/Story Pipeline.md` is user-owned — do not reorder or change steps without explicit permission
- **Frances protocol** in `docs/MUSE Protocol.md` and `museSystemPrompt()` must stay in sync

## User preferences
