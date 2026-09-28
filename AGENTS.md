# Kinolot — project notes (internal codename: TURN)

Story-architecture app for AI filmmakers (value charges, scenes that turn, beats → script). **Kinolot by Infinite
Studio AI**, served at https://kinolot.infinitestudioai.com. The full, current notes are in **CLAUDE.md** — read them.

## 🏷️ Names users see (owner decisions 2026-09-28)
- Product **Kinolot**; company always **Infinite Studio AI**; method **the Infinite Studio AI method**. Nothing user- or
  model-facing may name McKee / Robert McKee / Claude / Anthropic or any AI vendor (`scrubBrand()` / `museScrubReply()` /
  `scrubAnalysis()` in `app/ai.jsx` are the safety nets).
- **TURN is the internal codename only** — never in UI text, errors, exports or what the assistant is told.
  `scripts/test-brand-guard.mjs` enforces it (and "Cinema Machine", MUSE as a name, retired agent names).
- The help assistant is **Frances** (codename MUSE: `app/muse.jsx`, `museSystemPrompt()`, `docs/MUSE Protocol.md`). She only
  answers. Writing actions carry no persona ("Draft", "AI draft", "AI polish").
- Story Editors: Story Doctor, Script Supervisor, Setups & Payoffs, Adaptation, Final Read. Art Room Department Heads include
  the Art Coordinator. Display only: role `writer` → "Co-writer", plan `studio` → "Producer". Stored data is never migrated.

## 📐 Story-building process — follow the skill
When building a story (New Story → spine, Adaptation, or any seed→script flow), follow the canonical
pipeline in **`docs/Story Pipeline.md`**. It is owned by the user — **do not add, remove, reorder, or
change any step without their explicit prior permission.** Propose changes and wait for a yes.

## ⚠️ Keep Frances's product knowledge in sync
Frances (the in-app help assistant, codename MUSE) answers users' how-to / product questions from a **single capability manifest**: the `APP_FEATURES` array in `app/ai.jsx`. It is the source of truth fed into MUSE's system prompt via `appBrief()`.

**Whenever you add, rename, or change a user-facing feature, update `APP_FEATURES` in `app/ai.jsx` in the same change.** If you don't, Frances will give users outdated or confabulated answers. She is also instructed to say "I'm not sure" rather than guess about anything not in that list.

## 🛡️ Frances answer protocol
How Frances is allowed to answer users (scope, confidentiality, tone, refusals, staying in character) is governed by **`docs/MUSE Protocol.md`**. The protocol is enforced in code by `museSystemPrompt()` in `app/ai.jsx` (the system prompt), with `scrubBrand()` and `museFinalAnswer()` as safety nets. **If you change one, change the other** so the doc and the prompt stay in sync. Frances is the floating help assistant (`app/muse.jsx`, voice + chat) — she only answers; she never edits the story.

## Architecture
- `app/story-data.jsx` — sample film (The Matrix) data: SCENES, BEATS, SCREENPLAY, FACTS + CONTINUITY map.
- `app/ai.jsx` — model wiring (drafting, polish, scene authoring, the Frances/MUSE chat, agent helpers: aiSuggestTurn/aiPlantLine/aiTableRead/aiBuildSpine) + `APP_FEATURES`.
- `app/agents.jsx` — bounded-loop agent engine + the Story Editors (Story Doctor, Script Supervisor, Setups & Payoffs, Adaptation, Final Read) and the Art Room's Department Heads. Each works on a working `model` and gates changes behind `propose()`.
- `app/agents-ui.jsx` — Writers' Room modal: agent picker, reasoning trace, approval cards.
- `app/spine.jsx` — value-charge graph + filmstrip + DragScroll pan.
- `app/inspector.jsx` — editable scene/beats/analysis panel.
- `app/script.jsx` — Script view, continuity checker, version history.
- `app/chrome.jsx` — top bar + left rail. `app/app.jsx` — state + composition (scenes, beatsMap, drafts, continuityMap, agent ctx factory).
