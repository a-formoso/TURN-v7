# Writers' Room audit — 11 November 2026

Asked for by the owner after **Half Strength** was created with ten scenes that had no beats and no screenplay.
This is a list of findings only. **No Writers' Room code was changed.** Each item says how it was found:
**seen live** (in a test run), **read in code** (by a review pass over the build path; the section A items were
re-checked by hand, the others should be confirmed when each is picked up), or **suspected** (not yet reproduced).

## What was tested

| Test | Result |
|---|---|
| Scene lists for all 24 combinations (8 formats × 3 structures; Story Circle is retired and was not tested), Opus 5.5 | 24 of 24 came back with the right number of scenes, real sluglines, a value for every scene, no placeholder text. 14–123 s each. |
| Full build: Micro Short · Kishōtenketsu · Opus 5.5 | 8 of 8 scenes written (beats + screenplay), about 7 minutes. Kept as "TEST · Micro Short · Kishōtenketsu · Opus 5.5". |
| Full build: Commercial · Three-Act · Opus 5.5 (from a "What if…" idea) | 4 of 4 scenes written, about 4 minutes. Kept as "TEST · Commercial · Three-Act · Opus 5.5". |
| Full build: Short Film · Hero's Journey · Fable 5.2 | 16 of 16 scenes written, about 29 minutes (Fable 5.2 takes about 95 s a scene; Opus 5.5 about 30 s). Kept as "TEST · Short Film · Hero's Journey · Fable 5.2". |
| **Interrupted build**: Micro-drama · Three-Act · Opus 5.5, page reloaded while scene 3 was being written | **Reproduced the Half Strength result.** No warning on leaving; the film reopened marked "Synced" with scenes 1–2 written and scenes 3–7 empty, no notice and nothing offering to continue. Kept as "TEST · Interrupted build · Micro-drama (reloaded in scene 3)" to build the fix against. |
| Code read of the whole build path (New Story → scene list → world → cast → scenes → checks) and of every way a build can stop | See sections A–D. |

So: when a build runs to the end, every scene gets its beats and its screenplay, on every format and structure
tested. The Half Strength problem is not a format or structure that fails to write — it is a build that **stopped
part-way and left no trace**.

## What happened to Half Strength

Read from the saved film: scenes 1–5 were written about 40 seconds apart by Opus 5.5, scene 6 about 22 minutes
later, and scenes 7–16 have only their one-line summary. Nothing in the code limits a build to the first scenes;
the run simply ended. The build log is not saved, so the exact cause cannot be recovered. The interrupted test above
produces the same film: written scenes, then scenes with only a summary, and no sign that anything is missing.
The causes that fit, most likely first:

1. The build stalled on scene 6, then the page was closed, reloaded or the computer slept during scene 7 (A1, A2).
2. The Story Editors window was closed by the app itself mid-build (A3).
3. The build was stopped near scene 6, scene 6 was written later by hand, and "Auto-draft all" then stopped at scene 7 (A7).

---

## A. A build can stop part-way and the film does not say so (the Half Strength problem)

> **Status, 11 November 2026 — item 1 of the suggested order is built** (branch `claude/build-resume-20261111`, not
> published). A1, A2 and A4 are answered, and A3 no longer happens silently:
> - a film the app built that has unwritten scenes shows **"Unfinished · This film isn't fully written"** in the
>   Writers' Room, with **Continue writing** (one press: just the unwritten scenes, no approval card, never a
>   rebuild). It also shows on films built before this, Half Strength included;
> - the build writes its own record onto the film (`project.build`: status, progress, its log), saved with every
>   scene; **What happened** opens the log, which ends on the scene the build was in;
> - reloading or closing the page during a build brings up the browser's "Leave site?" question;
> - the screen is kept awake while a build writes (where the browser supports it, tab visible);
> - the beat map of the scene being written is saved as soon as it exists, so an interruption loses less;
> - when the app itself closes the window mid-build, it says so.
> Still true: the build runs in the browser, so it still stops when the page goes away — it no longer does so
> unseen, and one press continues it.
>
> **A5 and A6 are built too** (same branch): one scene's beat map or screenplay has a 3-minute limit (the app tells
> the server, which stops the provider call there and gives the held credits back; the app itself stops waiting 20 s
> later); a time-out is its own kind of failure; a scene that timed out is not asked again at once (one wait instead
> of up to four); and two scenes in a row stop the build with one message. Worst case for a stalled engine: about
> 6 minutes and a film that says it is unfinished, instead of 25 minutes a scene. The server half
> (`image-proxy`, `timeoutMs`) is written and tested but **not deployed**; until it is, the app's own limit still
> applies. Test: `scripts/test-writing-time-limit.mjs`. A7–A11 are untouched. Code: `app/build-state.js`, `buildRecorder` in
> `app/agents.jsx`; test: `scripts/test-build-resume.mjs`.

> **Status, 12 November 2026 — A7 to A11 are built** (branch `claude/audit-a7-a11-20261112`, not published). Each
> was first confirmed in today's code; line numbers in the table below are the audit's and have moved.
> - **A7.** Stopping at the first scene that cannot be written, and leaving the rest unwritten with no stand-ins, is
>   the owner's rule of 28 September and stays. What was missing is the sign afterwards. Auto-draft all now keeps
>   its own short record on the film (`project.draftRun`: writing / stopped / done, the scene it stopped at, the
>   *kind* of failure, the scenes it had left) and the Writers' Room "Unfinished" notice shows it on any film,
>   hand-written ones included: where it stopped, when and why. On a film the app built, Continue writing is the
>   finish run as before; on any other film it is Auto-draft all again, which asks first. The notice speaks only for
>   the scenes that run left; a scene added later does not bring it back. Leaving the page while a scene is being
>   drafted asks first, and the screen stays awake during the run. The reason is stored as a kind and worded where
>   it is shown, so an admin's wording never reaches a collaborator.
> - **A8.** Confirmed: the Escape key was bound to the window's first `close()`, which still saw "no editor open"
>   after Finish writing was chosen from the list, so a running build closed with no question. It now reads the
>   newest one. Opened from the notice or New Story it already asked.
> - **A9.** The Film menu's count no longer counts a rough stand-in as drafted and names them:
>   "14 of 16 scenes drafted · 2 rough stand-ins".
> - **A10.** Confirmed, and worse than listed: the cut-off answer was asked for a second time with a bigger budget,
>   which the server cut at the same place and charged again; then the scene's screenplay was asked for too. The
>   server now says when it cut an answer because the balance was short (`cutForBalance`), and the app treats that
>   as a credits problem: one message that says so, no second call, and a build or Auto-draft all stops at that
>   scene. The server half is one added field in `image-proxy` and is **not deployed**; until it is, the app
>   behaves as before.
> - **A11.** The line added after a film switch said "nothing was changed or saved", untrue once scenes had been
>   written. It now says nothing was written into the film now open and that what was already written stays in the
>   film the run started in; an editor that has already said so is not repeated.
> - **Seen working** in the app with the cloud switched off and a stand-in writing engine (no account, no paid
>   call): the notice after a stop at scene 9, Continue writing opening Auto-draft all's question, the leave
>   question during the run and not after it, the record ending "done", the Film menu count, and Escape asking
>   during a finish run started from the list. Test: `scripts/test-writers-room-stops.mjs`.
> - **Still true.** On a film the app did not build, a rough stand-in left by Auto-draft all is named in the end
>   message, in the Script view and in the Film menu count, but not in the notice (Auto-draft all does not rewrite
>   stand-ins; Redraft does). A10 cannot be tried on the admin account, which is never held to a balance.

| # | What happens | Found | Where |
|---|---|---|---|
| A1 | **The build runs only inside the open Story Editors window, in the browser.** Closing the tab, reloading, the computer sleeping or the browser discarding the tab ends it. The scene being written at that moment is lost (and already paid for). | **seen live** (reload test) | `app/agents-ui.jsx:251` (closing the panel cancels the run) |
| A2 | **No warning when leaving during a build.** The "unsaved changes" warning only covers unsaved edits, not a running build. | **seen live** (the reload went through with no question) | `app/app.jsx:3722` |
| A3 | **The app can close the window by itself mid-build, silently**: choosing "Load cloud version" in a save conflict, a change of role on a shared film, or a sign-out / failed session refresh. | read in code | `app/app.jsx:1327` |
| A4 | **A half-built film looks like a finished one.** Nothing marks it "build incomplete", nothing offers to continue when it is reopened, and the build log is not kept (only report-type editors save theirs). | **seen live** (the reloaded film shows "Synced" and nothing else) | `app/agents-ui.jsx:367` |
| A5 | **A stalled writing call can hang for over 6 minutes** — the app sets no time limit of its own; it waits for the server's (380 s). | read in code | `app/ai.jsx:241` |
| A6 | **Repeated time-outs never stop the build.** A time-out is not counted as a service failure, so each remaining scene waits its turn, times out and gets a rough stand-in. | read in code | `app/agents.jsx` `repeatedServiceFailure`, `app/ai.jsx` `ERR_CODES` |
| A7 | **"Auto-draft all" (Script view) stops at the first scene it cannot write** (credits, sign-in) and leaves the rest with no beats and no stand-in, with a toast only. | read in code | `app/script.jsx:1417` |
| A8 | **Pressing Escape during "Finish writing this film" skips the "stop?" question.** | read in code | `app/agents-ui.jsx:510` |
| A9 | **The film menu counts rough stand-ins as drafted** ("16 of 16 scenes drafted"), so it cannot be used to spot unwritten scenes. | read in code | `app/chrome.jsx:199` |
| A10 | With a low balance on the non-Claude engines the answer is shortened to fit, which cuts a scene off; the message then blames the engine. | read in code | `image-proxy` output cap |
| A11 | "You switched films… nothing was changed or saved" is shown in cases where scenes had already been written. | read in code | `app/agents.jsx:747` |

**What would fix the class of problem** (to be agreed one by one): mark a film as "being built / N of M written"
when the build starts and clear it at the end; show that state on the film and offer **Continue writing** when it is
opened; warn before leaving during a build; keep the build log with the film; put a time limit on each writing call
and stop the build after two time-outs in a row; never close the window silently. The larger step is running the
build on the server so it does not depend on the browser staying open.

## B. What the writing model is told — quality of what gets written

> **Status, 11 November 2026 — B1 and B2 are built** (branch `claude/build-resume-20261111`, not published). Every
> call that writes a scene (the build, Continue writing, Draft, Auto-draft all, Redraft) is now told the scenes
> before it, how the previous screenplay actually ends, what the next scene covers, and who the earlier screenplays
> already introduced (`sceneThreadBrief` in `app/ai.jsx`); the scene list is asked for one event per scene.
> Checked on the same locksmith story, same format, structure and engine ("TEST · Micro Short · same story after the
> scene fix"): the door opens once (scene 3 ends on the last pin, scene 4 begins with it), each of the four
> characters is introduced exactly once, no scene replays another. Not fixed by this: length (B3 — that film is
> 1,887 words for an under-5-minute format) and B4–B16. Test: `scripts/test-scene-thread.mjs`.
>
> **B3 and C4 are built too** (same branch). The scene writer is given its screen-time share as a count of units
> (one action paragraph or one speech) with the words each has (`sceneShapeFor` in `app/formats.jsx`), and the
> synopsis is sized to the format (1-2 sentences a paragraph for a commercial, 2-3 up to five minutes, else 3-5).
> Measured with the app's own estimate on 29 redrafted scenes of the test films: 98% to 113% of the format's
> length, against 140% to 304% before. A fresh 30-second commercial built end to end runs about 33 seconds (the
> first ran about 91), in the same number of writing calls. The beat matching no longer empties a beat the writer
> wrote (a tight draft was being rejected as "beat left unwritten"). Not changed: the owner-approved rule that a
> scene which still runs long gets a free note and is never rewritten automatically (docs/Story Pipeline.md step 5).
> Test: `scripts/test-scene-length.mjs`.
>
> **Status, 12 November 2026 — B12 and B14 are built** (branch `claude/audit-episodes-20261112`, not published).
> Test: `scripts/test-episode-show-cast.mjs`. Seen on the real engine (six calls, admin account, nothing saved): for
> an invented four-person Show and the seed "What if a night crew is sent to a flat where nobody will say who made
> the call?", the loglines without the Show's cast followed three new leads (Tamsin, Rotimi, Gráinne); with it,
> all three follow the Show's lead with her driver, the controller and the rookie, and the guests have new names.
> The 24-scene list is driven by the Show's four people in 18 scenes, and the world returned them under their own
> ids with their descriptions unchanged, plus five new people.
> - **B12.** Confirmed, and wider than listed: not only the scene list — the loglines, the research, the synopsis
>   and the story world of a new episode were never told who is in the Show (the build's cast merge keeps the
>   Show's people, but it can only match a name that was actually used). All of those calls are now given the
>   Show's cast as canon (`showCanonOf` / `showCanonBlock` in `app/ai.jsx`): names and identities are kept, the
>   Show's protagonist stays the protagonist unless the writer's own words say otherwise, a person not on the list
>   is new and gets a new name. It applies when New Story builds the Show's current, empty episode, and to any
>   Adaptation run inside an episode. New Story's format step and the build's log say so.
>   Not covered: what happened in earlier episodes (only who the people are), and the spoken "Talk it through"
>   conversation itself (the loglines shaped from it are covered).
> - **B14.** A cut-off answer was repaired into readable JSON and used as if whole. Now: a scene-list half that was
>   cut and came back with fewer scenes than asked is asked for again; the story world is asked for once more and
>   the fuller answer kept (the log says so when both were cut, with the number of cast entries); a synopsis
>   paragraph that stops mid-sentence is treated as missing and written again. Research is unchanged (a second
>   web-searching call costs more than the fault is worth). Also: the synopsis repair asked for "3-5 sentences" in
>   every format; it now asks for the format's own size.
> - **D3 is not built — it needs a decision.** See the note under section D.

> **Status, 12 November 2026 — B7, B8, B9, B10 and B13 are built** (branch `claude/audit-long-films-20261112`, not
> published). Each was confirmed in the code first. Test: `scripts/test-long-films.mjs`.
> - **B7.** The brief was cut at 4,000 characters in four places (the composed brief, the scene list, the world,
>   the contract), and what went was the end. One limit now, 12,000: everything the app composes fits. A longer
>   text pasted into Adaptation is still cut there, and the build's log says so first, with the words it stops at.
> - **B8.** The world was written from the first 2,600 characters of the scene list, with no scene numbers. Every
>   scene is now listed, numbered; a very long list shortens each summary instead of dropping scenes.
> - **B9.** The cast stopped at eight and the prompt asked for "3-6 principal characters". With more than six
>   drivers it now asks for one entry per driver (plus at most two others) and keeps them (up to 24).
> - **B10.** A long scene list was cut from the end, and the list was *sorted* by act, so a scene with a wrong or
>   missing act (missing read as act 1) moved to another part of the film. The surplus now comes out at the
>   midpoint (start of the second half, then end of the first; never the declared inciting incident); the order of
>   the scenes is never changed, and act labels are repaired to run forwards. The log says how many scenes went.
> - **B13.** A billing or sign-in failure at the scene list was asked for again and then reported as "didn't come
>   back after two tries, run it again in a moment". It now stops at the first one with the real reason and the
>   right advice. At the world step the build used to go on: it cleared the old project, saved scenes with no
>   premise and a cast of bare names, then stopped at scene 1. It now stops before anything is made or replaced.
>   An ordinary world failure (two unreadable answers) still carries on, as decided on 28 September.
> - **Seen on the real engine** (three calls, admin account): a Feature Film brief gave 40 scenes, acts 10 / 20 / 10,
>   nine drivers. The world call listed all 40 scenes with numbers (the old cut would have stopped at scene 27 —
>   the whole third act unseen) and returned nine full cast entries, one per driver, each with pronouns, age, size
>   and voice (the old cap was eight; one driver first appears in scene 27).
> - **Fixed on the way.** A long setting line was cut inside a word ("…on a tidal east-Scottis"); it is now cut
>   at a word.
> - **Still true.** If credits run out later in a build (the contract or the cast's inner life), those parts are
>   skipped and Continue writing does not redo them. A half whose acts are numbered from 1 again is kept in order
>   but its labels are only levelled, not rebuilt. B11, B12, B14 to B16 are untouched.

> **Status, 12 November 2026 — B5 and B6 are built** (branch `claude/names-20261112`, not published). Code:
> `app/story-names.js`; test: `scripts/test-story-names.mjs`.
> - **B6.** A name becomes an id with its accents folded to the plain letter ("Inês" → `ines`, it was `ins`); a name
>   with no Latin letters gets a short stable id of its own (they were all `lead`). Ids stay plain a–z because they
>   are used in storage keys. The scene list hands the real name on with the id, so the cast is told whose id each
>   one is, and a person made straight from a scene's driver is called "Inês", not "Ins". Cues in capitals find their
>   person in any script. Films saved with the old ids are not changed and still match.
> - **B5.** Wherever a call may have to name someone (logline, synopsis, scene list, cast) the app now gives it the
>   initials to use, drawn at random in the app for every call, plus the names this account's other films on this
>   device already use (remembered when a build makes its cast). A person the writer named keeps that name.
>   The old "naming entropy seed" (a random code the engine was asked to consider) is gone: it did nothing.
> - **Measured live, same eight unnamed loglines, synopsis step.** Before: the eight stories shared Varga (2),
>   Marsh (2), Teodor (2, plus a Teo), and Mara / Maren / Mira, Lena, Elias. After: no principal's name appears
>   twice; the old favourites are gone; every drawn initial was followed. With three earlier names on the "already
>   used" list and the same initials, the engine chose different ones (Nora Kowalski → Nadine Kerr).
> - **Found on the way, and fixed before it shipped.** The first draw included I, O, W, Y and Z. The engine then
>   chose the story's country to suit the letters (a baker's story moved to Istanbul for "Y, K, I, Z"; five leads of
>   eight were Polish). The draw now uses only initials common in most naming traditions, and the call is told the
>   place comes from the story first. After that: Budapest, Cornwall, Pittsburgh (2), Almería, Geneva, Philadelphia,
>   Maine.
> - **Still true.** Each initial has its own favourite (K → Kowalski, N → Nora, P → Paul), so two different writers
>   can still meet the same name; one writer's films will not, on the same device. The engine's taste in *places*
>   (Pittsburgh twice in eight) is untouched: that is the story's setting, not a name, and was not changed.
>   Other name matching outside the build (voices, Breakdown, the Stage) was not checked for non-Latin scripts.

| # | What happens | Found | Where |
|---|---|---|---|
| B1 | **Scenes replay each other's events.** A scene is written knowing only the previous scene's *title and closing value* — not what happened in it — and nothing about what the next scene will cover. In the Micro Short the door is opened three times (scenes 3, 4 and 5); in the Commercial the boy hands over the bottle and shows the twelve stickers in scene 1 and again in scene 2, and the runner's knees buckle at the end of scene 3 and again at the start of scene 4. | **seen live**, both films | `app/ai.jsx:1064` (`storyContext`), `aiAuthorScene`, `aiDraftScene` |
| B2 | **Characters are introduced again and again.** "RAY MALLINDER (late 60s), a man who…" opens scene 1 and scene 2; Priya gets a first-appearance introduction in scene 6 after appearing in scenes 2–4. Same cause as B1. | **seen live** | same |
| B3 | **Scripts run about twice the promised length.** Micro Short ("under 5 minutes", 30 s a scene): 1,605 words, the app's own estimate says ≈ 7 min. Commercial ("30 seconds", 8 s a scene): 337 words, 4 speaking characters, about 2 minutes. Short Film ("10–20 minutes"): 4,621 words, the app says ≈ 21 min. The time budget is in the prompt but is not checked afterwards. | **seen live** | `screenTimeBrief`, `beatCountAsk` in `app/ai.jsx` |
| B4 | **Writing a scene can rename it to a title another scene already has.** Scene 8 was planned as "Without Force", and was saved as "Ten to Six" — the same title as scene 1. In the interrupted test, scene 2 "Bathroom Confession" was saved as "Notice by Publication", the film's own title. During the build the model may rewrite a scene's title, place and summary, and nothing checks for duplicates. | **seen live** | `aiAuthorScene` (returns title / loc / summary) |
| B5 | **The same names keep coming back across unrelated stories.** In 24 scene lists the name "Teodor" appears in 12 and "Odile" in 6; the first two test films both have a "Priya". The rule that bans stock names moved the habit to new ones. | **seen live** | `app/ai.jsx:5036` |
| B6 | **Accented names are broken.** "Inês" became the character id "ins". A name in a non-Latin script would become "lead" for every such character. | **seen live** (accent), suspected (non-Latin) | `app/ai.jsx:4924` |
| B7 | **The brief is cut at 4,000 characters.** A long logline or an imported text can push the end of the synopsis out of what the scene list is built from. The three test briefs were 2,900–3,500 characters, so close to the limit already. | read in code | `app/ai.jsx:5043`, `composeStoryBrief` |
| B8 | **The story world is built from only the first ~2,600 characters of the scene list**, so on a Feature Film the second half is not seen when the cast and premise are written; scene numbers are missing in that text. | read in code | `aiBuildStoryWorld` |
| B9 | The cast is capped at 8 while the prompt asks for one entry per driver; a Feature can have more drivers than that. | read in code | `aiBuildStoryWorld` |
| B10 | If a half of the scene list returns too many scenes, the extra ones are cut from the **end** — the ending is what is lost. A scene with no act is treated as act 1 and moved to the front. | read in code | `app/ai.jsx:5092` |
| B11 | Three-act wording ("antagonist(s) each drive several scenes") is sent to every structure and to 4-scene formats. | read in code | `app/ai.jsx:5030` |
| B12 | A TV episode added to an existing Show is built without the Show's cast or canon, so it can invent a new lead. | read in code | New Story → `aiBuildSpine` |
| B13 | If the scene list, the world or the contract fails because of billing, it is reported as a passing hiccup and retried. | read in code | `agentAdaptation` |
| B15 | A long build on the slower engine multiplies the risk in section A: a Short Film on Fable 5.2 needs the page open and awake for about half an hour (a Feature Film would need well over an hour). | **seen live** | — |
| B16 | Time of day can run backwards between scenes (scene 8 "PRE-DAWN", scenes 9–10 "NIGHT" in the Fable 5.2 film). Fable 5.2 handed scenes on to each other better than Opus 5.5 did (less replaying), but four scenes in a row open on the same description of the same desk. | **seen live** | same as B1 |
| B14 | A cut-off answer is not checked for on the scene list, world, research or synopsis (it is on scenes). | read in code | `app/ai.jsx` |

## C. New Story window

> **Status, 11 November 2026 — C1 and C2 are built** (branch `claude/build-resume-20261111`, not published), with
> D1, D2, D5 and B4 from the other sections. C1: the working title on the Synopsis step is the film's title (the
> build reads `project.workingTitle` for the brief it was typed for). C2: the Logline step says "Your shape: … — your
> own pick. The suggestion was …" once the writer overrides the suggestion. D1: a scene is said to reverse only when
> its charge changes sign. D2: a Kishōtenketsu build's first card lists Ki / Shō / Ten / Ketsu and counts scenes by
> the structure's own rule. D5: the build says "from your synopsis". B4: writing a scene never gives it a title
> another scene has. All confirmed live. C3–C9 are untouched. Test: `scripts/test-writers-room-small-faults.mjs`.

| # | What happens | Found |
|---|---|---|
| C1 | **The working title you type is ignored.** I set "TEST · Micro Short Locksmith"; the film was created as "Without Force", the model's title. | **seen live** |
| C2 | **The "Shaped for this story" note keeps showing the recommendation after you override it.** I chose Three-Act; the next step still said "Shaped for this story: Commercial · Kishōtenketsu". The build did use Three-Act. | **seen live** |
| C3 | **Research on Fable 5.2 is not checked against the web** (web search runs on the Opus and Sonnet engines only), so the same step gives sourced facts on Opus 5.5 and "from general knowledge" on Fable 5.2, with no notice when picking the engine. | **seen live** |
| C4 | The synopsis is the same size for every format: about 1,800 characters for a 30-second commercial, 2,600 for a micro short. This feeds B3. | **seen live** |
| C5 | "Talk it through" uses only the first 1,600 characters of the conversation as the idea. | read in code |
| C6 | The typed interview (used when voice is unavailable) never recommends a format or structure. | read in code |
| C7 | "Regenerate" on the logline step can change the recommended shape without saying so. | read in code |
| C8 | Turning a Micro-drama into a Show silently makes it a TV Series. | read in code |
| C9 | While research is running, "Back" and "Regenerate" stay clickable. | **seen live** |

## D. Structure labels and small wording

> **D3, 12 November 2026 — a decision, not a fix.** The scene list is told how many scenes each act gets, and
> the engine sometimes labels them differently (a one-scene *ten* and a three-scene *ketsu* where 2 / 2 was
> asked). The app could force the labels by position. That would go against the rule approved on 25 September
> ("scenes carry the stage the story actually gives them… falling back to position only when the key stages are
> missing"): a forced split can put the *ten* label on a scene that is not the twist. Since 12 November the
> labels at least always run forwards and never move a scene (B10). Left as it is until the owner chooses.

| # | What happens | Found |
|---|---|---|
| D1 | **A scene that does not change is described as reversing.** Scene 1 of the Kishōtenketsu film reads "Idleness (−2) → Idleness (−2). A value-charged condition reverses — the scene earns its place." | **seen live** |
| D2 | **Kishōtenketsu builds are summarised with three-act words**: "8 scenes across 4 movements, 2 of them moving… 2 move cleanly", which reads as a fault; the approval card lists "Act I–IV" instead of the movement names. | **seen live** |
| D3 | Acts are not spread as the format intends: Micro Short 2/2/1/3 instead of 2/2/2/2; Commercial 2/1/1 instead of 1/2/1; TV Series Kishōtenketsu 5/7/6/6. Hero's Journey lists sometimes put one scene after the final stage. | **seen live** |
| D4 | Short Hero's Journey stories are relabelled from a fixed table, which can shift a stage by one scene; three-act pinch points are one scene off for Documentary (12 scenes); the Kishōtenketsu audit flags its allowed "re-read" scenes as flat. | read in code |
| D5 | The build says "from your logline" when it is built from the synopsis; the Story Contract for a water-bottle commercial came out as "Action (Life/Death)". | **seen live** |
| D6 | Older test films from September ("Test · Commercial · Hero's Journey", "Test · Documentary · Three-Act") are still in the account — not a bug, listed so they are not mistaken for this round. | **seen live** |

## E. Engines (changed in this round, live on the server)

- Fable 5.2 replaces Fable 5; Opus 5.5 stays the default. Fable 5.2 was used end to end for the third test build:
  it works, research on it is not web-checked (C3), and it is about three times slower per scene than Opus 5.5 (B15).
- GPT Image 2.5 removed, 2.6 kept. Seedream 5.5 added beside Seedream 5 Pro at 5 Pro's price until the provider
  publishes one.
- Not changed: Blender Studio's assistant still runs on the older Claude models (it is a separate service).

## Suggested order

1. **A4 + A1/A2** — the film knows it is unfinished, offers "Continue writing", and warns before leaving. This is
   the direct answer to Half Strength.
2. **A5 + A6** — time limit per writing call, stop after two time-outs.
3. **B1 + B2** — give each scene what the previous one actually ended on and what the next one covers.
4. **B3 + C4** — make the length match the format, and check it after writing.
5. **C1, C2, D1, D2** — small, visible, quick.
6. **B4–B6** — titles and names.
7. The rest, in the order above.
