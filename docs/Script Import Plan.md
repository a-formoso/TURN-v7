# Bring your own script — plan

Status (2026-10-18): **approved by the owner** ("yes to all, except 3 (use Gemini 4)"). **Phase 1 is built** and is
visible to the admin account only until the read (phase 2) lands, so users never meet a half-built feature.
**Phase 2 (the read) is built** (2026-10-18), still admin only until the ways in (phase 3) go public: app/script-read.js
reads each scene (card + beats that group the existing lines; words never change), then the cast and the brief; the app
asks with the price, shows progress with Stop, offers "Read my script / Read the rest" in a Writers' Room strip, shows
dismissable Story notes in the Scene panel (and a film-wide Hide), and keeps each scene's imported words the first time
it is rewritten, for **Restore the import**.

**Phase 3 (the ways in) is built and PUBLIC** (2026-10-18): New Story's "I have a script" on every account; "Import a
screenplay" on an empty Writers' Room; "Import a script" in Home's top bar; a script file dropped on the Writers' Room or
Home; the landing room cards' "Start with your script" / "Start from an idea" carried through sign-up; the What next panel
after a read; Frances's "Import a screenplay" entry; the Terms and Privacy lines (dated 18 October 2026). An import is
always its own film, never an episode of the open Show. **Phase 4 (import a new draft) is built and public** (2026-10-18): "Import a new draft" in the Film ⋯ menu and the
Writers' Room import bar; each scene matched by its scene number, heading and words (`ScriptImport.matchDraft`), shown as
unchanged / revised / new / moved / not in the new draft (with "also changed in Kinolot" when the studio had rewritten it)
before anything changes; revised scenes take the new words through version history and are marked unread; new scenes and
speaking parts join; the scenes the draft lacks are kept and marked "Not in draft" (or removed); one whole-film Undo;
the read is offered for what changed. Tests: `scripts/test-script-import-draft.mjs`.
**Phase 5 (PDF, Word and scans) is built and public** (2026-10-18): `app/script-import-pages.js`. A PDF with text is read
on the device through pdf.js (self-hosted, `app/vendor/pdfjs/v4.10.38/`, loaded only when a PDF is opened) and a Word
file (.docx) through the zip reader; the LAYOUT READER learns the file's own indents (action, dialogue, parenthetical,
character), places each line by indent and capitals, joins wrapped lines and lifts off the furniture (page numbers, the
running header, (MORE), the carried (CONT'D), revision asterisks, margin scene numbers, OMITTED); a line it had to guess is
marked "Check". Word reads a screenplay template's styles first, else the indents, else Fountain's rules. A SCANNED PDF is
read page by page from its page images by the reading engine (the existing vision call, held and settled per page;
priced first, stoppable, labelled a transcription). An old .doc is refused in plain words. Tests:
`scripts/test-script-import-pages.mjs`, `scripts/test-script-import-pdf-browser.mjs` (a PDF Chrome prints, read back).
**Phase 6 (Shows and adaptations) is built and public** (2026-10-18). INTO A SHOW: `ScriptImport.episodeInfo` spots an
episode (a cold open or teaser, act breaks, an episode number, "Series" on the title page, 1x03 / S01E03 / Pilot) and the
preview's "Where it goes" offers its own film or an episode of a Show (one of yours, or a new Show it starts as Episode
1); several episode files at once get one window (the episodes in order, the Show, the cast across them). The app runs it
step by step through its own series steps (Episode 1 → the automatic conversion; `createEpisode` → fill → save for each
other), every episode's people matched by name into the Show's one cast (`turnSeries.mergeAdaptationCast`); act markers
before the first heading are section notes. ADAPT INTO A NEW FILM: the Story Editors' "Adapt into a new film…" (format,
structure, retell / a rewrite pass in the method, a note) mints a new film and runs the story build from a brief made from
the original (`app/adapt-film.js`); the original never changes. Tests: `scripts/test-script-import-series.mjs`. All six
phases are built.


**Short scripts and other shapes (owner's question, 2026-10-18):** a one-page script imports as one or two scenes and
is read as it is; the length only SUGGESTS a format (it can be changed), and for an imported film the format's scene
counts are guidance, never a request to add or cut scenes. A story built differently is read in the structure that
fits it best, and where it doesn't do what the method expects, that is a dismissable note. Prose — no scene headings
and no character cues (a short story, a treatment, a synopsis) — is recognised in the preview, which offers to **use it
as the idea in New Story** (the studio writes the screenplay) or to import it as it is.

Decisions: (1) import is **Entry B** in `docs/Story Pipeline.md`; (2) the read is charged as normal writing (held
and settled per scene); a trial account previews and fixes for free and reads on the default light engine up to
its credits; (3) the default reading engine is **Gemini 4 Argon**; (4) Story notes are shown by default as
dismissable notes, with a switch to turn them off for the film; (5) the rights checkbox reads "I wrote this script or
have the rights to use it."; a Terms line about uploaded scripts goes live with the public launch (phase 3);
(6) the landing room cards say "Start with your script" / "Start from an idea" (phase 3).

## Why

The landing page says "Start with the Art Room" and "Start with the Stage", but today every film begins in New
Story with an idea. Someone who already has a screenplay has no way in. They sign up, land on an empty Writers' Room,
and find the Art Room and the Stage locked ("Needs a story").

Writers with finished scripts are some of our best customers: they want to design and shoot, not rewrite. This plan
adds a second way into the pipeline. **Import a screenplay, keep every word, and let the studio read it into the
spine, beats and cast**, so the Art Room and the Stage work on it exactly as on a story built in the app.

## The principle: read, don't rewrite

- The imported text **is** the screenplay, word for word. The read never changes a line. This rule is enforced in
  code and tested: the text in the app must match the file's text exactly.
- What the studio adds is a **reading** of the script: scene cards, value charges, beats, the cast and a logline.
  These are notes about the script, and every one of them can be edited.
- Changing the story is a separate choice the writer makes later, from the Story Editors. Any adaptation becomes
  a **new film** beside the original, so the original script is never overwritten.

---

## The experience, step by step

### 1. Ways in (one flow wherever you start)

- **New Story** gets a fourth card beside Logline / "What if…" / Talk it through: **"I have a script"**.
- **Landing page:** "Start with the Art Room" and "Start with the Stage" first ask *"Do you have a script?"*:
  - **Yes** → sign up, then Import.
  - **Not yet** → sign up, then New Story, and the film opens in the room they chose once the story is built.
- **Home:** "New Project" offers the same choice.
- **An empty film's Writers' Room:** "Start your story" gets a second button, **Import a screenplay**.
- **Drag and drop:** a script file dropped anywhere on the Writers' Room or Home starts the import.
- **Paste:** a text box for scripts that live in Google Docs or email.

### 2. Upload and read the file (free, instant, in the browser)

- **Formats:**
  - First version: **Fountain** (.fountain, .spmd), **Final Draft** (.fdx), **Highland** (.highland), **plain
    text** and **paste**. Their structure is explicit, so they're read exactly.
  - Second version: **PDF** with a text layer, and **Word** (.docx). A PDF loses its structure, so the parser
    rebuilds it from indentation and capitals and marks anything it isn't sure of. A **scanned PDF** (no text) is
    read with the model's vision, paid and clearly labelled.
- **Recognised from the file:**
  - the title page (title, "Written by", draft date);
  - scene headings, action, character cues, dialogue and parentheticals;
  - transitions, dual dialogue, (V.O.) / (O.S.) / (CONT'D), INTERCUT, MONTAGE and scene numbers;
  - omitted scenes and revision marks.
- **Nothing is sent to a model yet.** This step costs nothing, and the file stays in the browser until the writer
  confirms.

### 3. Preview and fix (free)

One window, laid out like the rest of the app, showing what was found before anything is charged:

- **The count:** 42 scenes · 108 pages · ~1 h 52 min · 23 speaking characters, plus a suggested **format** from
  the length (feature, short, micro short, a TV episode…).
- **Scene list:** each scene's heading and first line. You can **merge** or **split** scenes, for example a
  sequence that should be one unit, or a long scene with two sluglines.
- **Characters:** the names found, with likely duplicates grouped for one-click merging ("BOB", "ROBERT",
  "BOB (V.O.)"), plus the option to mark a voice that's only heard.
- **Warnings, in plain words:** "3 lines couldn't be placed: check them", "No scene headings found: split by
  page or by blank lines?", "This looks like a TV episode: import it into a Show?".
- **Choose the structure to read it with:** Three-Act Turns, Hero's Journey or Kishōtenketsu. We suggest one and
  say why ("the midpoint reversal at page 55 reads as Three-Act"). The structure decides the acts and the names of
  the big turns.
- **Rights:** a checkbox: "I wrote this script or have the rights to use it." The wording is for the owner and
  legal to approve.
- **The price before the read:** "Reading 42 scenes ≈ N credits on Opus 5.5 (≈ M on Gemini 3.8 Flash)", with the
  engine choice. The film itself is created when the writer presses **Read my script**, as New Story only creates
  a film when the story launches.

### 4. The read (paid, scene by scene, can be stopped and resumed)

- **One call per scene,** each with a short summary of the film so far (so charges and drivers stay consistent).
  The film is read in story order, and a final pass writes the film-level fields.
- **Per scene:**
  - title, summary, act;
  - value at stake, opening and closing value with their charges, and whether it turns or progresses;
  - driver, objective, turning point and plot label (inciting incident, act climax…);
  - **beats**, made by grouping the scene's existing lines and tagging each block with its beat number; the driver
    and reactor rows describe what happens in those lines.
- **Per character:** role, description, want and need, and voice notes, from what the script shows and says.
- **For the film:** logline, synopsis, premise and controlling idea, genre and setting. These are saved as the
  film's **Story brief**, as New Story would save them.
- **What you see while it runs:** the studio progress card ("Reading scene 12 of 42", Stop, the running time).
  The spine **fills in live**, so the writer watches the film appear.
- **Stop and failures:** a stopped or failed read keeps what was read. **Read the rest** continues later, and is
  only charged for the scenes still to read.
- **Billing:** the same server holds as every writing call. Never charged above the hold, and nothing charged for a
  scene that failed.

### 5. Review (free)

- **The summary card:** "Your script is in. 42 scenes read · 6 notes to look at".
- **Notes, not verdicts.** Where the reading is unsure, or the script does something the method would flag (a scene
  that doesn't turn, two scenes in a row on the same charge, a long act), it's shown as a **Story note** you can
  dismiss. You can turn notes off for the whole film.
- **"Check" marks** on anything the read guessed with low confidence, so the writer knows where to look.
- **Undo:** "Restore the import" brings back the script exactly as uploaded, at any time. It's saved as the first
  version in every scene's history, labelled "Imported — <file name>".

### 6. What next (free)

The review ends with three plain choices:

- **Design the film → the Art Room.** Production check reads the script into the cast sheets, props and locations.
  Department Heads draft the lookbook. "Design all shots" plans the coverage.
- **Shoot it → the Stage.** We say honestly that this needs shots and frames first, and offer to run those steps
  in order.
- **Get notes → the Story Editors.** Story Doctor, Setups & Payoffs, Final Read. Every change asks first.

### 7. Keep working in your own writing app (re-import)

Writers will keep revising in Final Draft or Highland. **Import a new draft** into the same film:

- Scenes are matched by heading and content. Each one is shown as unchanged, revised, new, moved or removed,
  before anything is applied.
- A revised scene replaces its text as a redraft does. Its previous text stays in version history.
- Only revised and new scenes are read again (charged per scene).
- Everything downstream is flagged, never redone on its own. This uses what we built on 2026-10-18: frames say the
  screenplay changed, voiced lines need re-voicing, props find their passages, plates say "Script changed", and
  takes say "Needs review".
- **Round trip:** the Fountain / FDX / PDF exports already exist, so a writer can export, edit and re-import.

### 8. Series

- **Import into a Show:** a script that looks like an episode (cold open, act breaks, or a "Series" field on the
  title page) can go into a Show. Several episode files can be imported at once.
- **The show's shared bible** is built from all of them: the cast, locations and props shared across episodes.

### 9. Adaptation (optional, later, always a new film)

From the Story Editors, **"Adapt into a new film"**:

- to another format (feature → micro-drama, pilot → short);
- in the Infinite Studio AI method, as a rewrite pass;
- or into another structure.

It writes a **new film** beside the original. The imported script is never overwritten.

---

## Small things that make it feel right

- The **author** from the title page becomes the film's author, so exports credit the writer (the existing
  export-credit rule).
- **Scene numbers** from the file are kept, so a production can talk about "scene 37" and mean the same scene.
- **Page count and runtime** use the script's real pages (≈ 1 page a minute), shown on the spine as for any film.
- **Dual dialogue, intercuts and montages** keep their formatting in the Script view and the exports.
- **Notes the writer left** in the file, such as [[notes]] in Fountain or ScriptNotes in FDX, are kept as scene
  notes and never read as dialogue.
- **No surprise charges:** parse, preview, fix, review and next steps are free. Only the read and re-reads cost
  credits, and each one shows its price first.
- **Trial accounts** (50 credits) can import, preview and fix everything for free, then read on the light engine
  (Gemini 3.8 Flash) up to what their credits allow. The rest is offered as "Read the rest". The exact rule is the
  owner's call.
- **Frances knows the whole flow.** Her feature list (`APP_FEATURES`) gets the new entry.

## How it fits the app (for the build)

- **The screenplay text:** the parser writes the existing format, `drafts[sceneId].blocks = [{ beat, type, text }]`,
  with the types the app already uses (scene / action / char / dia / paren / trans). Every downstream room already
  reads this shape, so the Art Room, Shots, Storyboards, Breakdown and the Stage need no special case.
- **The read fills in:**
  - each scene's card (`scenes[]`: act, title, summary, values and charges, kind / plot, driver, objective,
    turning point);
  - the beats (`beatsMap[sceneId]`: driver and reactor labels, desire, obstacle, `turnAt`, `rows`);
  - the cast (`characters[]`);
  - the film's fields (`project`: format, framework, premise / logline, synopsis brief, genre, setting).
- **The read is a new model task** with its own prompt, written in the method's terms and never naming a vendor.
  Its reply goes through the same safety nets (`scrubAnalysis`) as the Story Doctor's.
- **Parsers** are plain browser modules (`app/script-import.js`), tested on real files, including awkward ones such
  as dual dialogue, INTERCUT, MONTAGE, (MORE)/(CONT'D) page breaks and revision asterisks.
- **Storage:** the original file is kept as a film asset, so "Restore the import" and re-import diffs always have
  the source.
- **Tests:**
  - the words in the app equal the words in the file;
  - the parsers, per format;
  - the read's holds and settles;
  - re-import matching;
  - the review's notes;
  - the brand guard.

## Phases

1. **Parse + preview + fix** (free): Fountain, FDX, Highland, text and paste. New Story's "I have a script" card.
2. **The read + review:** scene-by-scene, resumable, live spine, Story notes, Restore the import.
3. **The ways in and the next steps:** the landing's "Do you have a script?", Home, the empty Writers' Room,
   drag and drop, and the "What next" panel.
4. **Re-import a revised draft:** the scene matching and the downstream flags.
5. **PDF and Word,** then scanned PDFs (vision, paid).
6. **Series import, and "Adapt into a new film".**

Phases 1–3 make "Start with the Art Room" true. 4–6 make it a tool writers keep using.

## Decisions for the owner

1. **Story Pipeline.** `docs/Story Pipeline.md` is yours and its steps can't change without your yes. Import
   would be added as **Entry B — Import a screenplay**, a second way in, beside the existing Step 0 (Seed). It
   joins the pipeline at Step 4 (the Spine), with the screenplay already written. No existing step changes.
2. **Price of the read:** charged as normal writing (held and settled per scene)? And the trial rule above?
3. **Default reading engine:** ~~Opus 5.5 or Gemini 3.8 Flash~~ → **Gemini 4 Argon** (owner).
4. **Story notes on imported scripts:** shown by default, or collected in a notes panel the writer opens?
5. **Rights checkbox wording**, and whether the Terms need a line about uploaded scripts.
6. **Landing page wording** for the room cards ("Start with your script" / "Start from an idea").
