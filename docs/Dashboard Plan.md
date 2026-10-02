# The signed-in app: Dashboard, pages and team sharing (plan, 2 October 2026)

> **Status: plan only — nothing here is built yet.** Owner decisions are marked **(owner)**; my calls are
> marked **(proposed)** and can be overruled. The Team section replaces the "relaunch later" part of
> `docs/Team Decision Memo.md` (its Option B list is folded in below, so that memo stays the history).

## 1) Decisions already made

- **(owner)** Spectral is the headline font for page titles everywhere — the landing page, the Home
  dashboard, the new pages and the three rooms. Hanken Grotesk stays the UI text, Space Mono the small labels.
- **(owner)** The dashboard's sample films are **original** Kinolot films, not *The Matrix* (today's
  built-in sample in `app/story-data.jsx` is someone else's film; putting it on the front page is a
  copyright and trademark risk).
- **(owner)** Assets and Updates tabs are out. The mockups' old "TURN" logo and anything off our current
  visual design (fonts, colours, layout) are ignored.
- **(owner)** Team sharing comes back now, as part of this work: sharing is on **Director and up**; a
  collaborator does **not** need a plan of their own to open the Art Room or the Stage on a shared film;
  guardrails must stop abuse (section 5).
- **(owner)** Collaborators per film: between 3 and 10, with the Writers' Room capped lower (my numbers in
  section 5).

## 2) One look for the whole app (do this first)

Today the signed-out landing page and the Home dashboard use one look (Spectral serif headlines, white paper
`#FCFCFB`, bone cards) and the three rooms another (Space Grotesk headlines, grey canvas `#EBEBE8` / `#F1F1EE`,
dark by default). They already share the amber, Hanken Grotesk and Space Mono.

**Plan:**
- **One token set** in `app/styles.css`: the landing's paper palette becomes the light theme everywhere; the
  app's charcoal becomes the dark theme everywhere; Spectral for page and panel titles; one button, chip, card
  and input style.
- **The rooms stay dense working tools** — only their tokens change, not their layouts.
- **It comes before the new pages,** so they're built on the shared look from day one. Mostly CSS variables;
  each room gets a visual check in both themes.

## 3) The frame every signed-in page shares

- **Left sidebar:** Home, Projects, Templates, Models, People. Account at the bottom (name, plan, credits,
  Manage plan). Collapsible.
- **Top bar:** the film switcher (the current film and its format), the theme toggle, **New Project**.
- **Left out:** Assets, Updates, Docs and Discord (Frances answers help questions in every page).
- **Where people land:** everyone lands on **Home** after signing in. Today's dashboard
  (`app/home-dashboard.jsx`) only appears with 2+ films or a shared film; that gate goes.

## 4) The pages

### Home
- **Main button:** "Continue: *last film*", with that film's next step ("3 scenes to draft", "Shots ready to
  render") — worked out from real work, never a made-up percentage.
- **Pipeline strip:** the room steps (Writers' Room → Art Room → The Stage → Post, "Coming soon"), lit for
  where the current film stands.
- **Recent projects:** your own films; then **Shared with me** (owner's name and your role on each).
- **Sample films (proposed):** 2–3 original films labelled **Sample**, shown until you have 3 films of your
  own, then moved to Templates. A sample opens read-only, with **Make a copy** to edit it.
- **First sign-in:** the trial welcome card (built 2026-10-02) shows once over Home.

### Projects
- Search; filters for stage, format and **Mine / Shared with me**; sort by last updated; grid or list.
- **Stage label and progress** from real work (scenes drafted, shots rendered, clips made).
- **New:** star and archive (archive hides a film without deleting it).
- **Collaborator avatars** on each card once sharing is back.
- **Left out of the mockup:** the made-up progress percentages.

### Templates
- Real starters only: **format × framework** (Short Film, Feature Film, TV Series, Micro Short,
  Micro-drama, Music Video, Documentary, Commercial × Three-Act Turns, Kishōtenketsu, Hero's Journey),
  plus the sample films.
- **Use template** opens New Story with the Shape step already filled in.
- **Left out of the mockup:** "Most popular", "Recently used", collections and invented counts ("48 assets").

### Models (shown as "Engines")
- The real choices per stage: writing (Opus 5.5 and the others in the Writing dock), images, video
  (Seedance 2.0 / 2.5), voice.
- For each: its cost in credits, which plan allows it, and which one **this film** uses (the Stage's choices
  are saved per film since 2026-10-02).
- **Left out of the mockup:** made-up engine names ("Muse", "Frame", "Soundstage", "Worldsmith") and
  "Provider: TURN" — they'd claim we make models we don't; "MUSE" and "TURN" are internal names that never
  reach users. Model names already appear in the app; company names don't.

### People
- **Everyone you work with across your films:** each person's role on each film, whether they've joined,
  their credit budget and use this month (section 6), invite, change role, remove, and **Leave film** for
  films shared with you.
- **Mockup departments map onto roles:** Story = Co-writer, Art = Art director, Production = Stage editor.
- **Second phase:** saved crews (invite a whole group to a film in one click), an activity feed (needs an
  activity log), online status beyond today's per-film presence.

## 5) Team sharing — the rules (proposed numbers)

| | Director plan | Producer plan |
|---|---|---|
| Collaborators per film (pending invites count) | up to **5** | up to **10** |
| Co-writers per film (Writers' Room) | up to **3** | up to **3** |
| Rooms collaborators can open | Writers' Room, Art Room | + The Stage |
| New invites per owner per day | 20 | 20 |

- **Who can share:** an owner on Director or Producer whose payment is in good standing. A trial, Writer,
  frozen or past-due account can't send invites.
- **Rooms follow the owner's plan,** not the collaborator's: on a Director owner's film, nobody gets the Stage.
- **Roles (proposed):** View-only; **Co-writer** (edits the Writers' Room); **Art director** (edits the Art
  Room); **Stage editor** (new: edits the Stage, Producer films only). Every role sees the other rooms
  read-only. This answers the memo's open question "should an Art director get the Stage?" — no, that's the
  Stage editor's job.
- **No re-sharing:** only the owner invites, changes roles or removes people.
- **Invites expire after 14 days;** an account must have confirmed its email to accept (on since 2026-10-02).
- **If the owner drops below Director** (or their payment fails): collaborators keep read-only access, edits
  and generations pause, nothing is deleted; it all resumes when the plan does.

## 6) Who pays: the owner (proposed)

Today, on a shared film, whoever clicks Generate pays from their own credits. That's wrong for a freelancer
working on someone else's film: they may have no plan, or need their credits for their own films.

**New rule: work on a film is paid by the film's owner.** A collaborator's own credits are never touched on
someone else's film; their own films, plan and collaborators stay separate.

**The owner's controls:**
- **A monthly credit budget per collaborator** (proposed default: 200 credits on Director, 500 on Producer;
  the owner can change it per person, from 0 to "no limit").
- The collaborator sees what's left; at 80% the owner and the collaborator are told; at 100% that person's
  generations stop until the owner raises it or the month turns.
- The People page shows each collaborator's spend this month, per film.

**How it works on the server** (the important part — the browser never decides who pays):
- Every paid call already carries the film (`context.projectId`, Art Room fix 10). Today that's attribution
  only; for billing, the server **verifies** it: the caller must be an active member of that film, with a role
  that allows that room. Then the hold is taken from the **owner's** balance and checked against the
  collaborator's budget.
- The owner's plan decides what can run (engines, resolution, video), exactly as if the owner clicked.
- If the film can't be verified, the call is billed as today (to the caller) — never to the owner.
- Holds, settles and releases are unchanged; each usage row records both the payer and who clicked.

## 7) Guardrails against abuse

- **Invites:** Director-and-up only; per-film caps (section 5) with pending invites counted; 20 new invites
  per owner per day; the invite function sends from a **fixed list of our hosts** (never a link from the
  browser), and answers the same whether or not the address has an account. These are the memo's three
  security fixes and must ship before any invite email is sent.
- **Spend:** owner-set budgets per collaborator; the owner's plan limits (engines, 4K, video, parallel
  renders) apply to everyone on the film; holds mean the owner's balance can never go negative.
- **Access:** by account id once linked (not by email address); confirmed email required; private presence
  (today anyone with a film's id can see who's in it).
- **Accounts used to dodge plans:** a free account gets nothing extra by joining a film — it works inside
  the owner's plan and budget. The 50-credit trial stays once per mailbox and needs a confirmed email.
- **Visibility:** the owner sees every generation on their film, who made it and what it cost; removing
  someone ends their access at once (running jobs finish and are billed to the owner as today).

## 8) Order of work and rough size

1. **One look** (section 2) — S/M: 2–3 days.
2. **The frame + Home + Projects** — M: 4–5 days (needs the original sample films written).
3. **Templates + Engines** — S/M: 2–3 days.
4. **Team relaunch** (security fixes, caps, roles incl. Stage editor, rooms by owner's plan, invite flow,
   copy, Terms "Shared films" clause, Privacy fix) — L: about a week, plus your steps (run the missing SQL,
   deploy `invite-collaborator`, the redirect list) and approval of the legal text.
5. **Owner pays + budgets** (section 6) — L: about 1–1.5 weeks; server billing change, so it gets its own
   tests and a live check with two real accounts before it's on.
6. **People page** — M: 2–3 days, on top of 4 and 5.

## 9) Open questions for you

1. The plan numbers in section 5 (5 / 10 collaborators, 3 Co-writers, 20 invites a day)?
2. The new **Stage editor** role, or should the Art director get the Stage on Producer films?
3. Budget defaults (200 / 500 credits a month per collaborator) — or should new collaborators start at 0
   until the owner sets one?
4. Sample films: shall I draft 3 original ones (a short drama, a commercial, a music video) for you to approve?
5. The Terms need a "Shared films" clause and the Privacy page a fix before sharing relaunches — legal review?
