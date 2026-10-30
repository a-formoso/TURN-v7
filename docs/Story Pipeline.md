# SKILL — The Kinolot Story Pipeline

> **Ownership & governance.** This document is owned by the project manager (the user).
> It is the canonical, step-by-step process the assistant follows when building a story in Kinolot.
> **The assistant MUST NOT add, remove, reorder, or change any step without the user's explicit
> prior permission.** Propose changes; wait for a yes. The user may edit this file freely at any time.
>
> Branding rule (inherited from CLAUDE.md): everything here is **the Infinite Studio AI method**.
> Never name McKee / Robert McKee / Claude / Anthropic in any user-facing or Frances-facing output.

---

## Purpose
A single, repeatable spine for turning a raw idea into a fully-written, structurally-sound short
film — so every story starts from the user's *own* seed and grows its own world, instead of
inheriting sample-story names/characters. (Starting from the bundled sample is for demo only;
real authoring should always begin at Step 1.)

---

## The pipeline

### Entry B — Import a screenplay  *(added 2026-10-18 by owner approval — "yes to all"; plan: `docs/Script Import Plan.md`)*
A second way in, beside Step 0, for a writer who already has a finished screenplay. It does not change any step
below: an imported film joins the pipeline at **Step 4 (the Spine)** with its screenplay already written.
- **Read, don't rewrite.** The imported text IS the film's screenplay, word for word (formatting marks are not
  words; notes and boneyard text are kept aside as notes). Nothing in this entry rewrites a line.
- **Free first:** the file is read in the browser (Fountain, Final Draft, Highland, plain text, paste) into
  scenes at each heading; the writer previews and fixes it (title, author, format, the structure to read it
  with, merge / split scenes, merge duplicate characters as aliases — cues are never renamed) and confirms they
  have the rights to the script. Only then is the film created, with a scene card per heading marked unread.
- **The read** (phase 2) fills each scene card, its beats (grouping the existing lines), the cast and the
  film's brief from the script, scene by scene, priced first and charged as writing; the default reading engine
  is **Gemini 4 Argon** (a trial account reads on the default light engine). Where the method would flag a scene
  (no turn, a repeated charge), it is a dismissable **Story note**, never a rewrite.
- **Changing the story stays the writer's choice:** the Story Editors (Step 7) advise and ask first; an
  adaptation into another format or structure is always a **new film**, the import untouched.

### 0. Seed  *(reordered before Format 2026-07-11 by owner approval — a creator arrives with an idea, not a container; the studio listens first, then recommends the shape)*
The user provides a seed: a logline, a premise, or a rough idea. Nothing is assumed beyond it.
- *(approved 2026-07-04; repositioned 2026-07-11)* Developing the seed **recommends the format +
  framework** for the story — the recommendation arrives **pre-selected on the Shape step that
  follows**, with a one-line rationale; it applies only to knobs the writer hasn't explicitly
  picked, and an explicit pick on the Shape step always wins. The "Shaped for this story" banner
  on the logline step remains as the receipt, with a Change link back to Shape.
- *(approved 2026-07-04)* A **logline seed is always offered verbatim** as the first, pre-selected
  candidate ("yours — untouched"); the sharpened variants are optional, never the default.
- *(approved 2026-10-02 by owner)* **Logline check** — the same call checks the writer's own logline for
  one protagonist, a want and an obstacle. When one is missing, a gentle note under the candidates names
  what's missing and points to the sharpened versions. It only advises and never blocks: the writer can
  still build from their own words.

### 1. Shape — Format & Framework  *(was Step 0; reordered after Seed 2026-07-11 by owner approval. Format added 2026-06-11; framework added 2026-06-11 by owner-delegated decision; Hero's Journey + Story Circle added 2026-06-12 by owner approval; Story Circle retired 2026-09-25 by owner)*
Now a **confirmation step**: the seed's recommendation arrives pre-selected with its rationale,
and the user confirms or overrides. The choices themselves are unchanged — **what we are making**:
feature film · TV series · short film · micro short · micro-drama · music video · documentary ·
commercial (the registry in `app/formats.jsx`, shown in three groups — long form, short form, non-fiction &
brand; lineup revised 2026-09-25 by owner: Feature Film, TV Series and Music Video added, Film renamed Short
Film, Short renamed Micro Short; every format works with every framework; default **Short Film**, the classic 16) — and **how it should be told**: the narrative FRAMEWORK (the registry in
`app/frameworks.jsx`; default **Three-Act Turns**, the classic method; alternatives:
**Kishōtenketsu**, four movements where the *ten* recontextualizes rather than clashes;
**Hero's Journey**, the twelve-stage mythic round across Departure/Initiation/Return (plus two
optional stages from the original seventeen — Belly of the Whale and Rescue from Without —
added 2026-09-25 by owner, chosen by hand, never assigned by position). Hero's Journey added
2026-06-12 with owner approval. **Story Circle** (eight steps over four act bands, added
2026-06-12) was **retired 2026-09-25 by owner**: it is no longer offered or recommended for a
new story; a film already built on it keeps its four act bands, and rebuilding one as a new
film uses Three-Act Turns). The format
sets the spine's **target scene count and runtime**, the screenplay emphasis, and downstream
room/Stage defaults; the framework sets the **act bands, the audit question, and the build/doctor
criteria**. Both change the *size and telling* of what's built — never the steps below.

### 2. Research → Synopsis  *(the new, defining step; amended 2026-06-12 by owner approval: framework-shaped synopsis, seed pass-through, format-aware research)*
Before any structure is built, expand the seed into a synopsis using the
**Three Pillars of Research** (the Infinite Studio AI research method). The assistant may **search the
web** to gather real, grounding material for the Fact pillar. Owner-approved rules:
- **The writer's original seed rides along** into research and synopsis as canon — its names,
  details and questions survive even when the chosen logline compressed them away.
- **The research lenses are format-aware** (registry `researchBrief`): a commercial researches the
  product, audience and category codes; a documentary researches the real subject, access and
  verifiability; a micro-drama researches the scroll-stopping hook. Films keep the classic lenses.
- **The synopsis takes the FRAMEWORK's shape** (registry `synopsis.paras`): three-act keeps the
  classic three paragraphs below verbatim; Kishōtenketsu writes Ki / Shō / Ten / Ketsu;
  Hero's Journey writes Departure / Initiation / Return.
- *(approved 2026-10-02 by owner)* **Every principal is researched**: the Fact lenses (role · what
  happens · how it feels · frustrating · lovely) run for each main character the logline or seed names
  (up to four, the protagonist first), not just the protagonist.
- *(approved 2026-10-02 by owner)* **Research and synopsis are two moments**: the research is shown
  first, on its own **Research** step, where the writer can edit any field or **steer** it ("go deeper
  on the officer") and research again. The synopsis is then written **from that edited research**; the
  synopsis step has **Rewrite synopsis from research**, and says when the research has changed since
  the synopsis was written.

- **Memory** — inward: honest, universal emotional truths the seed touches (family, betrayal, joy).
- **Imagination** — living the characters' hours and days in the mind until scenes feel like déjà vu;
  surfacing hidden connections.
- **Fact** — outward: real historical, social, technical or place detail (web research allowed/encouraged)
  so the world is specific and cliché-proof.

Output the synopsis in the framework's shape — for THREE-ACT, this exact classic shape:

```
SYNOPSIS: [Title]

The Setup
[Paragraph 1 — the world, the protagonist, the inciting situation]

The Confrontation / Complication
[Paragraph 2 — escalating conflict, the midpoint turn, mounting stakes]

The Resolution
[Paragraph 3 — crisis, climax, the irreversible final change]
```

The synopsis is the source of truth the rest of the build derives from — including **unique,
setting-appropriate character names** (never role-words like "Antagonist", never recycled sample names).

> **Author preparation — write from within** *(approved 2026-08-31 by owner)*: the author's
> reservoir **is** this step — the Three Pillars above are the combined research model (memory /
> personal, imagination / living the hours, fact / grounded), so no separate "Phase 0" surface
> exists. What was added is the **write-from-within stance** on every pass that invents
> behaviour: before writing what a character does or says, take their place in the
> circumstances — *"if I were this person, with this desire, under this pressure, what would I
> do?"* — and write what is found there, never behaviour observed from a distance (outside-in
> observation produces clichés; improvising from within produces the honest, surprising,
> in-character move). It rides in the house style (drafting · polish · write-missing-beat), in
> beat authoring (paired with the five steps — the "if" is how the driver feels the desire and
> senses the antagonism before choosing the tactic), and in the anti-stock rule (character
> invention: the world build, per-character drafting, the cast-psychology pass).
> *Documentary is exempt by design:* the stance binds **fictional** characters only — a
> documentary's real subjects get no invented inner life, motives, actions or words; every
> invention pass instead carries a grounding rule (derive everything from research, observed
> action and attributable sources; where the record is silent, claim less rather than imagining
> more), and the documentary format's screenplay rules now govern the polish and
> write-missing-beat passes too, not just first drafts. Cuts: the
> technique ships unattributed (no source names on the page or in prompts), and no new
> author-prep step or UI — the research stage already is the reservoir.

### 3. Build the spine to the format's target, in the framework's grammar  *(amended 2026-06-11; framework clause by owner-delegated decision)*
From the synopsis, build a full spine at the **format's target scene count** (Short Film = the
classic 16, Feature Film = 40, TV Series episode = 24), using the **framework's act grammar** (Three-Act keeps today's exact build
language; Kishōtenketsu builds four movements where the *ten* is a recontextualization,
never a conflict escalation; Hero's Journey builds the mythic round where every trial
costs): the **scenes**, then the **premise**, **controlling idea**,
**setting**, and **cast**, then the **cast's inner life** (want, contradicting need, arc by act,
Voice DNA), then **beats + screenplay** for every scene — threading continuity scene to
scene — then the **psychology check** against the script, then the **continuity ledger**. The build
stops there *(2026-09-27, owner-approved)*: it does **not** draft the cast's visual look (wardrobe,
palette, sheet prompts) — that is drafted in the Art Room once the Lookbook has a look (step 9).

> **Any format with any framework** *(approved 2026-09-25 by owner)*: the synopsis and the spine are
> always told **what is being made**, whatever the framework — the framework shapes the order of the
> turns, the format decides what each scene can hold (a documentary never invents events or words for
> real people; a commercial lands its product promise; a music video follows the song's sections). A
> Hero's Journey of **4 scenes or fewer** builds the minimum journey — Ordinary World → Crossing the
> Threshold → The Ordeal → Return with the Elixir (3 scenes: Threshold → Ordeal → Elixir).

> **One cast, real stages** *(approved 2026-09-25 by owner)*: the spine's two halves are no longer
> written in parallel — the second is written after the first and handed it, so every person keeps
> one name and role and no title repeats. Hero's Journey and Kishōtenketsu scenes carry the stage the
> story actually gives them: the spine declares each scene's stage and the build keeps the longest
> in-order run, falling back to position only when the key stages are missing.

> **Psychology before the script** *(approved 2026-09-25 by owner)*: the principal cast's
> desire complex is designed **before any beat is written** — from the synopsis and the scenes
> each character will drive — so the scenes are written *from* it: every scene prompt carries
> the driver's want, the need that contradicts it (the "unsayable" the turning beat releases)
> and where their arc stands in that act (**arc by act**, one line per act, editable in the
> Cast panel), plus the protagonist's through-line. After the script is written, a **check
> pass** keeps each field the scenes bear out and revises only what the characters' actual
> choices under pressure contradict — true character is still revealed by choices. Voice DNA
> therefore exists for the first drafts.
>
> **In an Episode of an existing Show** *(2026-09-27, owner-approved)*: the check pass may refine
> only the characters **that episode introduced** in that build. Characters that already existed in
> the Show (an earlier episode's cast) keep their canon — a revision there would silently change
> another episode's scripts. Every scene's "drafted from" stamp follows the cast that was **actually
> saved**, so the build's own check never marks its scenes **needs redraft**.

> **Structural role in every scene prompt** *(approved 2026-09-25 by owner)*: the scene writer
> is told where the scene sits and what its structural beat must **do** — act and position
> ("scene 8 of 16"), the act's job (the framework's synopsis guide for that movement), the
> beat's job from the framework registry (e.g. the Mid-Act Climax reveals the true nature of the
> conflict and turns the protagonist from reacting to acting), and a pacing note from the nested
> hierarchy: peaks hit harder than anything before them, the approach tightens, the scene after
> a major peak breathes. The prompt also carries the premise, the setting, the synopsis
> paragraph for the scene's act, a locked Argues side, and a deliberately set conflict source
> (inner · personal · extra-personal — the spine build now sets one per scene). It also carries
> the **reactor's inner life** *(added 2026-09-25 by owner)* — want, need and arc stage for the
> act, for the reactor named in the beat map — so the other side of the duel is a person too.

> **Story world discipline** *(approved 2026-08-31 by owner)*: two rules on the world pass.
> **Question, never message** — the premise is drafted as an *open question* the story explores
> ("What would happen if…?"), never a thesis it proves; a brief that arrives as a message is
> converted into the question underneath it, and the controlling idea is framed as *provisional*
> — a hypothesis the finished story tests. Working backward from a fixed message creates
> mouthpieces, not characters (the human-truth jury and the Final Read's mouthpiece flag police
> the same failure downstream). *Commercial is exempt by design:* a spot is promise-led — the
> brand promise stays intact as the brief's contract, and the open question lives only inside
> its dramatic wrapper. **Creative limitation** — the build prefers the *smallest,
> strictly knowable world* that can hold the conflict: a bounded location named concretely (a
> night-shift minicab office, not "London"), a limited cast, a specific set of trades, objects
> and rules; the setting's **conflict** dimension is the *level* of conflict (inner, personal,
> institutional, environmental). The limitation reaches dialogue: **Voice DNA vocabulary is
> drawn from the world's own lexicon** — its trades, objects, rooms and rituals — so the cast
> shares one small world's language while staying distinct in how each speaker uses it. The
> rest of this source phase was already built and is recorded here for coverage: premise as
> question, setting in four dimensions (period · duration · location · conflict), plots of
> fortune/character with their depth demands (the Story Contract), and controlling idea =
> value + cause with idealistic/pessimistic/ironic polarity, provisional and revisable.

> **Cast voice block** *(approved 2026-07-02)*: every cast member is generated with a **voice
> identity block** — `voice: { accent, pitch, pace, quirks }` — the same way physique and wardrobe
> are captured for the face. The **accent is named as sound** (e.g. "noticeable Turkish accent,
> London inflections"), consistent with the character's identity, the setting and the period — never
> bare ethnicity or biography (voice models don't infer accent from backstory). The **Production
> check** (Art Room; formerly the Writers' Room's Script Breakdown — merged 2026-09-26, owner-approved)
> later enriches this block from voice details the screenplay actually states (approval-gated, like
> feature enrichment), and **Voice Design** builds its casting description from these fields before
> any heuristic.

> **Cast true size** *(approved 2026-10-28 by owner — "go ahead with step 1" of the scale plan)*: every cast
> member is generated with their **true size, with its unit** — how tall, or how long for a creature that isn't
> upright ("175 cm tall", "15 mm long", "40 m tall", "200 µm across") — consistent with what they are and with the
> rest of the cast. It is saved on the card as the character's **Size** (set by the story; the writer can change it),
> and the character's scale (human, critter, giant, microscopic) is worked out from it. A size without a unit is left
> unset, never guessed. The Art Room's look drafting keeps a size the card already has.

> **Cast pronouns** *(approved 2026-10-11 by owner)*: every cast member is generated with their
> **pronouns** — he/him or she/her, consistent with their identity; they/them only for a character
> the story itself makes non-binary (a documentary's real subject: the ones that person uses) —
> saved on the card as set by the story, so every scene is written from them and the Art Room can
> make their images (it makes none for a character without pronouns). The writer can change them on
> the card. At the end of the build, a character still without pronouns (a supporting member made
> for a scene's unnamed driver) takes the **one** set the finished screenplay uses for them — the
> same screenplay evidence as the Art Room's one-click fix, no model call — and anyone still unset
> is named in the build's summary. In an Episode, a character the Show already had is never changed
> (its canon), only named.

> **Cast ages** *(approved 2026-10-12 by owner)*: the same cast step also gives every cast member an
> **age range** — e.g. "60s", "early 30s", "about 12" — consistent with their identity (a documentary's
> real subject: the age the record gives), saved on the card as set by the story. The scene writer
> takes ages as canon from the cast list, so each screenplay introduction carries a deliberate age, not
> an invented one; the Art Room's script reading then reads those ages back as script facts. The writer
> can change the age in the Cast panel. At the end of the build, a character still without one (a
> supporting member made for a scene's unnamed driver) takes the age its first screenplay introduction
> gives — "NAME (70s)" — with no model call. In an Episode, a character the Show already had is never
> changed (its canon).

> **Character architecture** *(approved 2026-08-31 by owner)*: every major character is built in
> **two layers** — characterization is only the *mask* (job, manner, surface traits); **true
> character is revealed only by choices under pressure**, so the inner life always derives from
> what the scenes show them **do**, never from the mask. Each character carries a **desire
> complex**: a conscious want plus an unconscious need that genuinely **contradicts** it — the
> pull-against is the scene-generating engine, not a restatement. **Motivation discipline:** never
> a lazy trauma-excuse; keep asking *why* until the want is a live, present-tense hunger the story
> can dramatize. **Dimensions = contradictions**: 2–4 consistent "trait / counter-trait" pairs
> visible in behaviour, the **protagonist carrying the most** in the cast (a Cast-panel field,
> drafted by the build and by "Draft"). The **protagonist's arc is pinned to the Story
> Contract's declared inner arc**, so the cast document and the contract never drift. The cast is
> designed **as a system**: *Human truth* + *Argues* give every member a distinct stance on the
> controlling idea (never a unanimous jury), and **Voice DNA** (vocabulary, syntax under stress,
> metaphor sources) feeds dialogue drafting. Optional depth for the protagonist only: the four
> selves (core / personal / social / hidden), one line each. Psychometric trait labels are
> deliberately omitted — traits fall out of contradictions and choices.

> **Cast design** *(approved 2026-08-31 by owner)*: the cast is designed as a **solar system**
> around the protagonist — Center (protagonist) · **first circle** (help / hinder / define) ·
> **second circle** (functional support) · **third circle** (setting texture). Orbits are
> inferred from role + scenes driven (manual override on the Cast panel) and act as a **depth
> budget**: Center and first circle get the full character architecture; second circle gets a
> want, an arc and a human truth; third-circle texture stays a name with a function — depth
> where the story looks, silhouettes where it doesn't. **Design by counterpoint**: every
> supporting character exists to contrast, contradict or illuminate a **specific dimension of
> the protagonist** (foils are dimension-revealers) — each carries a one-line *Counterpoint*
> naming the contradiction they pressure. **Empathy engineering**: sympathy (likability) is
> optional; **empathy is absolute**. Every story declares a **Center of Good** — the film-level
> anchor where the audience's identification lives, shown on the Premise card and protected in
> every scene draft; it can live *inside* a dark protagonist (the one loyalty they never
> betray), even with monsters. The symbolic-spectrum check survives only as silent
> **anti-stereotype rules** applied wherever characters are invented (an off-center trait per
> character, plausible motivations for implausible acts, strictly in-character logic) — never
> a field to fill.

### 4. Structural core — the Spine
Every story is a sequence of scenes, each carrying a **value charge** (opening → closing, e.g. +2 → −1).
The **Spine view** plots that charge across all scenes so the rhythm of the whole arc is visible.
Each scene must **turn** its value: the charge **reverses sign** (+ → − or − → +; from a neutral 0,
only a decisive ±2 or more counts). Moving 2+ on the **same side** (+1 → +3) is a **progression** —
shown in violet, fine inside a run of scenes, weak at a structural peak (the Doctor flags a peak
that only progresses). Anything smaller is flat. The **continuity / turn check** flags scenes
that don't turn, and setups/payoffs that are missing or out of order.

> **The turn and the value at stake** *(approved 2026-09-25 by owner, superseding "sign or by
> ≥2")*: each scene names **one value at stake** — an axis such as Love ↔ Hate — and opens and
> closes on it; the opening and closing words follow the charges, so they can no longer drift
> apart. The spine build and beat authoring produce the axis; older scenes keep their two free
> words until the writer sets it (the Inspector offers a guess from them). Framework exemptions
> are unchanged: a Resolution, Elixir, Changed or Ketsu may settle; Kishōtenketsu Ki/Shō scenes
> only need movement; the Ten must reverse. Older films can fill every missing axis at once
> (**Name every scene's value**, added 2026-09-25 by owner): the poles a scene's own words give
> are kept, the model names only the missing ones, and no script is touched.

> **Continuity ledger** *(added 2026-09-25 by owner-delegated decision)*: once every scene is
> written — and again when a partly written film is finished — the build maps the film's
> continuity in one writing call: the story facts the audience carries from scene to scene
> (information, secrets, promises, threats, objects that matter, abilities, rules,
> relationships), the scene that sets each one up, and the later scenes that rely on it. This
> ledger is what the continuity check and Setups & Payoffs read. It never blocks the build: a
> failure leaves the film marked "not mapped" (build it later from the Script view's Continuity
> report), and script edits mark it stale until it is rebuilt.

> **Conflict escalates by kind** *(added 2026-09-25 by owner)*: every scene carries a conflict
> source — inner, personal or extra-personal — set by the spine build (or by the writer on the
> Conflict source pips). The Story Doctor flags a story whose later acts never reach a source the
> first act didn't already use (the conflict grows only in volume), and proposes re-levelling the
> final act's first peak — deeper (inner) first, since a bounded world escalates inward, else
> wider (extra-personal). It judges only deliberately set sources, and skips Kishōtenketsu, where
> conflict is optional. A re-levelled scene is written at its new level on its next draft.

> **Hook and pinch points** *(added 2026-09-25 by owner)*: in Three-Act Turns, scene 1 is the
> **Hook** (open in motion on a question the audience needs answered) unless it is already the
> Inciting Incident; stories with a full second act (10+ scenes) get two **Pinch Points** — the
> antagonistic force showing its power and what is at stake — midway between the Act I climax and
> the Mid-Act Climax, and midway between the Mid-Act Climax and the Act II climax (scenes 6 and
> 10 of 16). Shorter formats keep only the Hook.

> **Structural design** *(approved 2026-08-31 by owner)*: the story is a **nested hierarchy of
> turns** — beats → scenes → acts → Story Climax; every level turns a value, each level hits
> harder than the last, and **only the Story Climax is irreversible**. Three-act grammar rules
> (kishōtenketsu keeps its own): the **Inciting Incident** strikes *onscreen* inside the first
> quarter — brainstormed as the best or worst possible thing that could happen to the
> protagonist — radically upsets their life-balance, launches the quest, and makes a **promise
> the Story Climax must pay off** (the Doctor flags a late or unmarked one, as placement
> guidance only). **Peak rhythm**: consecutive climaxes must alternate charge (+/−) — same-side
> peaks halve each other under the law of diminishing returns; the Doctor proposes flipping the
> second. **Progression**: acts escalate by *kind*, not volume — wider socially, deeper
> personally, or the particular growing toward the universal. Scenes off the main quest must
> contradict, resonate with, or complicate it. The **character–plot fusion check** classifies
> every turning point's primary cause — the character's *choice* vs *outside forces*; fine
> writing fuses them (external events cause inner change, inner desires cause external events),
> so a spine where ≥80% of turns sit on one side is flagged as a puppet show or a vacuum.
> Deliberately **not** adopted: a "sequences" bookkeeping tier between scenes and acts, and a
> subplot data model — the craft lives as build rules and audits, not new fields.

### 5. Writing each scene (the nested layers)
A scene is built from **beats** — an action/reaction subtext map (editable: add, reorder, delete,
mark the turning beat). The **screenplay prose** is generated *from* those beats. The Script view
shows the screenplay with a left gutter indicating which beat each block expands.

> **Screen time per scene** *(2026-09-27, owner-approved — delivers the runtime Step 1 promises)*:
> each scene is written to a screen-time budget — the format's runtime divided by its scene count —
> and the beat map is sized to it: **2–3 beats** per scene for Commercial, Micro-drama and Music
> Video, **3–4** for Micro Short, **4–6** for every other format. Format runtimes used: Commercial
> **30 s**, Micro-drama 1–3 min per episode, Micro Short under 5 min, Music Video **4 min**,
> Short Film 10–20 min, TV episode ~30 min, Documentary **10 min**, Feature Film **100 min**. The
> spine, beat and scene prompts all state the budget, and a redraft never makes a scene longer. A
> scene that still runs long gets a **free warning** on its card and in the Script view — nothing
> is rewritten automatically, so no credits are spent on it.
>
> **Page forms the check accepts** *(2026-09-27, owner-approved)*: standard screenplay devices —
> on-screen text, inserts, supers, readouts, records and recorded voices — are action, not
> dialogue, and a mid-speech **(beat)** is standard form. A documentary writes an interviewer's
> questions as **INTERVIEWER (O.S.)** and planned testimony as **EXPECTED TESTIMONY: <subject> on
> <topic>** in action, never as invented lines for a real person.

> **Scene engineering** *(approved 2026-08-31 by owner)*: dialogue is **step five, never step
> one** — behavior runs desire → sense of antagonism → choice of action → action → expression;
> in Kinolot this is structural (prose is generated *from* the beat map), and beat authoring now
> treats each beat's action as a **chosen tactic under antagonism**, with **escalation** — each
> beat must top the previous, no repeated tactics. Scene conflict is framed as **duelling active
> infinitives** ("to claim her love" vs. "to block him"), keeping desire and obstacle active,
> never descriptive. Every scene has a **conflict mode** — the dialogue grammar naming *how* the
> antagonism is conducted: **balanced** (equals in open verbal combat), **asymmetric** (unequal
> power — the weaker side fights obliquely), **indirect** (polite surface hides veiled warfare),
> **comic** (blind obsessions collide), **reflexive** (a character at war with their own mind),
> **minimal** (sparse words, rich subtext). The drafter picks the mode silently per pass, or the
> writer locks one in the Inspector's **Conflict style** select; the mode is never named on the page. Deliberately **not**
> adopted: the five-step worksheet as form fields (the steps are already live machinery — value
> charges, the turn check, the turning-beat marker) and named film models for the modes (the
> behavioral definitions do the work without inviting echoes of existing films).

> **The dialogue pass** *(approved 2026-08-31 by owner)*: now, and only now, the words — flowing
> outward from everything above. Every line carries **three concentric spheres**: the **said**
> (surface words), the **unsaid** (deliberately withheld thoughts a reader can decode — this
> leaks through the whole scene) and the **unsayable** (the subconscious drive the character
> cannot admit — it erupts **only at the turning beat**, never before). **Exposition as
> ammunition** — facts reach the page only as weapons deployed in conflict, never volunteered to
> inform the audience. **The trialogue** — head-on conflict is routed through a *third thing* on
> the page (an object, a task, a topic) so the truth stays in subtext; it is also the standing
> fix for on-the-nose lines and raw shouting matches. **Line design** — suspense sentences (core
> word held to the end, for tension) vs. cumulative (core first, conversational); the core word
> timed for the cue; a pause or wordless gesture as the ultimate economy. The conflict rules
> bind *dramatic* dialogue only — documentary testimony and narration, VO beds, archive and
> required commercial copy exist to inform, and are exempt. The **Final Read**
> audits a named flaw checklist — empty talk, on-the-nose, author's mouthpiece, melodrama,
> monologue, duelogue collapse — and applies the **paraphrasing test** to every note: if
> rewording wouldn't fix it, the note is marked a *scene-design* problem (back to the beats and
> the turn, not the thesaurus). The **monologue check is deterministic and free**: any single
> speaker's unbroken run over 60 spoken words is flagged without a model call. Deliberately
> **not** adopted: named film models for the trialogue (originality policy), the six-dialogue-tasks
> per-line worksheet (the tasks already live in Voice DNA, beat escalation and this diagnostic),
> and the "golden thread" as engine content (it recaps what the pipeline enforces structurally).

### 6. Drafting controls
- **Draft** — drafts the one selected scene (authors beats first if it has none, then writes the script).
- **Auto-draft all** — drafts every still-undrafted scene in order, threading continuity.
- **Polish / Re-polish** — rewrites drafted prose to final quality while keeping beats locked.
- **Version history** — every draft and polish is kept; Revert / Redo move between versions.

### 7. Working across the whole story — the Story Editors (Writers' Room agents)
**Story Doctor** (finds the weakest structural link, proposes a fix, re-audits), **Setups & Payoffs**,
**Adaptation** (full build-from-source), **Final Read**. Each proposes changes the user approves,
with one-click Undo.

> **Runs you can trust** *(approved 2026-08-31 by owner)*: an agent run is pinned to the film it
> started in — switching films mid-run stops it cleanly instead of writing into (or reading from)
> the wrong film. Edits made *while* an agent runs are never silently lost: the run notices, keeps
> those newer edits on the Undo stack, and says so. Adaptation reports every scene it could **not**
> write (by number, with the reason) instead of a cheerful partial count, and offers to **finish
> just the unwritten scenes** on the next run rather than rebuilding everything — including any
> scene left as a **rough stand-in** *(2026-09-27, owner-approved)*: a stand-in is built from the
> beat cards when the writer's draft is rejected, is marked as such in the Script view (the Script
> check does not show it as clean), and keeps that mark until the AI writes the scene. The Final Read's
> voice pass distinguishes "your script has too little dialogue" from "the model was unavailable /
> failed — run again". Read-only reports (Final Read) are **kept per film** and shown when the
> panel reopens, so a full report is never lost by closing the window.

> **Needs redraft** *(added 2026-09-25 by owner)*: every written scene remembers the card it was
> drafted from. When the card later changes in a way that steers the draft — value at stake,
> charges, conflict source or style, Argues, beat type, driver, objective, summary, slugline, or
> the driver's or reactor's psychology — the scene is marked **needs redraft** until the writer
> redrafts it from the current card or keeps the draft as it is. Agent fixes (a Doctor
> re-level, a Setups & Payoffs planted line) mark their scenes the same way, so an approved
> change always reaches the page.

### 8. Frances
The in-app co-writer answers how-to / product questions and helps draft, all framed in the
Infinite Studio AI method vocabulary (values, charges, beats, turns).

### 9. Pre-production — the Art Room (visual pipeline)
Once the script exists, the **Art Room** turns it into a visual reference package (separate from the
Writers' Room). Tabs, left-to-right: **Lookbook → Characters → Props → Locations → Color → Shots → Storyboards →
Breakdown**, plus **Production check** *(tab list refreshed 2026-09-27, owner-approved: Voices now live on each
character card, "Style Bible" is the Color tab, "Shot List" is the Shots tab)*.
Each entity gets a canonical, reusable reference so every generated image stays consistent.

> **The Lookbook comes first** *(2026-09-27, owner-approved)*: the Lookbook steers every department
> downstream — its Wardrobe references shape each character's costume, Production design shapes props and
> locations, Palette / Lighting shape the colour grade, Lens / Composition shape the shots. A department
> drafted before the Lookbook exists is later flagged "Lookbook changed — re-draft" and drafted twice, so
> the order is **Lookbook → Characters → Props → Wear props → Locations → Color → Shots → Storyboards**.
>
> **Every tab is open** *(2026-10-03, owner: "unlock the tabs, I don't want users to feel obligated to
> waste credit generating props and characters that they don't want to generate yet (e.g. when a user just
> wants to generate one scene)")*. The order above is the **recommended** one, not a gate: any tab can be
> opened at any time, nothing is generated by opening one, and a department drafted before the Lookbook is
> still flagged "Lookbook changed — re-draft". The unlock rules below (2026-09-27) are kept in
> `app/art-tab-locks.js` but switched off (`window.TURN_ART_TAB_LOCKS`); they apply only if turned back on.
>
> *Switched off 2026-10-03 —* **The tabs unlock in that order** *(2026-09-27, owner-approved)*. Every tab stays visible; a locked
> tab shows what it is waiting for and a button to the step that unlocks it:
> - **Lookbook** — always open.
> - **Characters** — once the Lookbook has a look (a visual statement, or a reference card with a note,
>   a named touchstone or an image).
> - **Props** — once every character has a written spec (generated sheets are not required).
> - **Locations** — once every prop has a written spec, or the user marks **No props in this story**.
> - **Color** — once every location has a written spec.
> - **Shots** — once the Color tab has a look (the colour system / film stock).
> - **Storyboards** — once shot coverage exists.
> - **Breakdown**, **Production check** and **Blender Studio** are always open (they read the script,
>   not the visual steps).
>
> A step with nothing to do unlocks the next one by itself (e.g. no props, once confirmed). Anything
> already built stays reachable: a tab that already has content is never locked. **Run pre-production**
> is unchanged and fills the steps in this order. A TV Series episode unlocks from the Show's shared
> cast, props, locations and Lookbook.

> **Characters come before Props** *(2026-06-15)*: a worn/owned prop must look like it belongs to its
> character, so the **character is generated first** and each prop is then generated **referencing its
> owner's character sheet** (matching their style, materials, palette and wear). A prop generated in
> isolation comes out generic — not part of that character's world. After the props exist, re-generating
> a character makes its master ingest the finalized worn-prop sheets so it wears the exact prop.

- **Voices** *(approved 2026-06-13; they live on each character's card — see Step 10)* — each speaking
  character gets a **locked voice** the way Cameo locks a face. A voice is **designed from the
  character's own bible** (age, identity, archetype, drive — and the cast **voice block**:
  accent / pitch / pace / quirks *(added 2026-07-02)*), **picked from a library**, or **cloned from
  a real voice sample** (consent-gated, exactly like a cameo). Locking writes a canonical `voiceId` so
  the same character sounds identical in every line. Nothing is drafted silently *(corrected 2026-09-27,
  owner-approved — the app never auto-drafted voices)*: on each character's card the user designs a voice
  from their bible, picks one from the library or clones a consented sample, auditions it and locks it.

- **"Draft all" batch drafters are consistent across tabs.** Each tab's primary action fills every
  card's full written spec from the script in one pass — the same fields the per-card "Draft details"
  writes, and exactly what the **Master reference prompt** is built from:
  - **Draft all specifications** (Props) → Story & ownership, Physical design, Generation prompt.
    *(approved 2026-10-29 by owner — "go ahead with all six, update the pipeline doc"; this replaces the
    2026-10-12 note that character briefs add worn cards and carried proposals)* **What is a prop.** A film
    crew's script breakdown sends every object to one of four places: **costume** (anything worn — watches,
    badges, rings, uniforms; drawn on the character's sheet from its wardrobe and accessories text), **set
    dressing** (sits in the place and nobody uses it — part of the location), **background props** (ordinary
    things handled once — the shot describes them in words) and **hero props** (the few objects the story
    depends on). Only hero props become prop cards.
    **How film crews sort objects** *(owner 2026-10-30 — "ensure this is applied for props and adopted in the UI";
    the owner's words, shown on the Props tab — open while it is empty — and at the top of the review, which files
    what isn't a prop under the other three places, each with "Make it a prop")*: when a crew breaks down a
    script, every object it names goes to one of four places —
    - *Costume:* anything worn (watches, badges, rings, uniforms). The costume department handles it, not props.
    - *Set dressing:* objects that sit in the room and nobody uses. The set decorator handles them as part of
      the location.
    - *Background props:* ordinary things handled once, like a cup of coffee or a pen. They're bought, not
      designed, and nobody tracks them.
    - *Hero props:* the few objects the story depends on. These get designed, made carefully, often in copies,
      and tracked scene by scene.
    1. **Only the screenplay creates props.** Character briefs no longer make cards (worn or carried), and the
       "Proposed — not in the screenplay" group is gone. "Attach item to prop…" attaches a crop to an existing
       story prop only.
    2. **The tests** *(tightened 2026-10-30 by owner — "yes, tighten the rules and update the pipeline doc")*.
       An object the screenplay names is a story prop when it **returns** (seen in two or more scenes), or — when
       it is in one scene only — it passes **both** of the others: something that **matters happens** to it (it
       changes hands, is taken, hidden, found, lost, stolen, broken or destroyed) **and** the **story turns** on it
       (a setup/payoff, part of a scene's turn, or dialogue about it). Using something once — eating it,
       punching it, opening or raising it, putting it down, pocketing it — is not something that matters
       happening to it. **Part of the place** (a door, ramp, chain, locker, curtain, railing) is set dressing and
       never a prop, whatever happens to it; **marks** (footprints, stains) aren't objects. The read reports
       what happens and the turn with exact passages; the app, not the model, applies the tests. Anything else
       stays words in the shot — no card, nothing to pay for.
    3. **Each card says why** ("Why it's a prop: Returns in scenes 2, 3 and 6 · changes hands in 6"). In the
       review, the objects that didn't pass are listed collapsed under "Not props — left to the shot", each
       with "Make it a prop".
    4. **One object, one card.** The read follows an object across the whole film; when it can't tell whether
       two passages are the same object, the review asks once ("Is the letter in scene 6 the one from scene
       2?" — Yes, the same / No, a different one) instead of making two cards — and only when the answer matters
       (one of them is a prop, or the two together would be; never for set dressing or costume nobody uses).
    5. **A worn item can still be a story prop** when the screenplay makes it matter — something that matters
       happens to it (a jacket handed to someone who needs it, a wedding band taken off) and it returns or the
       story turns on it. Being worn in many scenes is costume continuity, not a reason.
    6. **Nothing is deleted on its own.** Existing cards that fail the tests (costume, write-up guesses,
       objects named once) show under **Not story props** with the reason and "Keep as a story prop"; one
       button moves them all to Recently deleted, where they can be restored. Stored cards are never migrated.
    A card made by hand, or kept, is a story prop by the user's choice. Draft all specifications, Generate all
    images, the Props Master and Run pre-production draft and generate **story props only**.
    **Extract screenplay props is the first Props step** *(2026-10-12, still in force)*: when the film's
    screenplay hasn't been read for props yet, Draft all specifications first offers to extract (writing
    credits; the review opens and drafting continues once it is applied or discarded), and the Props Master
    and the Art Coordinator's Props step read the screenplay first and propose the story props through their
    approval card (Run pre-production approves it automatically, as it does its other steps). Drafting then
    maps every prop to its scenes: reviewed passages give exact scenes, worn items follow their owner's
    on-screen presence, and other cards map only to scenes whose action names them by their **exact** name.
    Mapping uses no model call and refreshes by itself after a script change. The character look drafter
    lists carried items only when the screenplay text it is given names them; it invents wardrobe and worn
    accessories only.
    **Generate all images** then skips objects marked **Text only** (seen once and never handled), which
    shots describe in words instead of attaching an image.
  - **Draft all characters** → Identity, Wardrobe, Props & accessories, Continuity (appearance states,
    where the script shows the look change), Look dev.
    *(approved 2026-10-12 by owner — Character fidelity, "go ahead with all of it, in that order")* **The script
    is read first**: every character look (Draft all, a card's Draft & generate, Design the cast / the Casting
    Director, Run pre-production) is drafted from that character's **screenplay fact sheet** — what the script
    states about them (age, heritage only if stated, build, height, hair, distinguishing marks, injuries and
    wardrobe by scene), each fact with its verbatim quote, extracted (never invented) by **Read the script**
    (writing credits) and read first for anyone not read yet or whose screenplay changed since. The facts
    outrank everything else; what the script doesn't say is designed. Rows the script states ask before they
    change and keep the writer's choice. A **Script check** next to the QA check compares a sheet with the
    facts (optional in Design the cast), and a look drafted from an older screenplay shows **Script changed —
    re-read and re-draft** (nothing is redone or spent on its own). *Switched off 2026-10-03 (owner, Characters review:
    nothing is drafted or generated on its own — the user presses **Draft all**, the draft stage's main
    button, or **Design the cast**, whose preview shows the scope and price first; the silent pass below is
    kept behind `window.TURN_CAST_AUTO_DRAFT` and runs only if that is turned on) —* **The cast is auto-drafted once, silently, once
    the Lookbook has something in it** (a visual statement or at least one reference) — the first time any
    Art Room tab other than the Lookbook is opened after that *(2026-09-27, owner-approved: it used to run on
    the first Art Room visit even with no Lookbook, so the wardrobe was drafted twice)*. It never runs while
    an agent (e.g. **Run pre-production**) is working, only for characters that have no spec yet, and never
    overwrites drafted or hand-edited ones — so the user normally skips this step entirely. With no Lookbook,
    nothing is drafted silently: the Characters tab's **Draft all** button drafts the cast on demand. Each
    undrafted card shows a quiet inline "Drafting from script…" status while it runs. The manual
    "Draft" button only appears when some character still lacks a spec (e.g. one added by hand, or if
    auto-draft didn't finish); once the whole cast is drafted it disappears. This makes the intended
    order: **Lookbook → Characters → Generate all → Props → Draft all → Generate all → (re-generate
    Characters)** — the look first, then characters BEFORE props so each worn/owned prop can be generated referencing its owner's character sheet
    (so it matches them); then, with the props made, re-generating a character makes its master wear the
    exact finalized prop. The Art Coordinator's **Run pre-production** does this automatically: Lookbook →
    Characters → Props → **Wear props** (re-generates each affected master and refreshes any existing
    appearance variant off it) → Locations → Color → Shots (coverage); shot frames and Storyboards are then
    made from their own tabs.
  - **Draft all locations** → The space, Significance, Staging · Depth Grid, Look dev. (Locations also runs
    the full locations pipeline here: it first pulls any missing places in from the script's sluglines and
    refreshes existing scene chips, then drafts the specs, then stages each depth grid — so there's no
    separate "Pull from script" button.)
  Time-of-day variants are **not** part of "Draft all locations": they're optional, user-curated alternate
  plates (a Night/Day/weather version you choose to add), not a spec field that feeds the master prompt —
  so they stay a manual, additive choice. None of the batch drafters generate images; they only write the
  spec (the spec-first gate then unlocks generation).
- **"Generate all" batch image generation.** Next to each tab's "Draft all" is a **"Generate all
  props / characters / locations"** button that renders the reference sheet/plate for every **drafted**
  card in turn (one at a time, with a progress count and a Cancel). Undrafted/hand-added cards with no
  spec are skipped (nothing to build a good image from). If some cards already have a sheet you get a
  choice — **Generate N missing** or **Regenerate all** — so you never silently overwrite finished art.
  The same engine powers the per-scene **"Generate all in Scene X"** action; only one batch runs at a time.

- **Locations** are derived from the script's sluglines. *(Shared-head parents, approved 2026-10-26 by owner:)*
  spaces the screenplay only ever names as **"PLACE – ROOM"** (MARMORICA – CAR DECK, MARMORICA – UPPER DECK…) are
  rooms of one place: a new film's first derivation makes a **parent card** for that place and nests every
  "PLACE – …" / "PLACE …" space under it; an existing film is never regrouped on its own — the Locations tab
  **suggests** it (Group under PLACE / Keep separate). The parent holds the shared identity, one layout with one
  north and the 2×2 plate each room's plates are made from. Each location gets a multi-angle **coverage plate**
  and time-of-day variants. **Spec before render:** every location first gets a written **design spec**
  — *architecture, materials, lighting, significance, render style* (the AI "Draft" / "Draft all" pass
  writes these from the script). Those five fields ARE the plate prompt, so the spec must exist
  **before** a plate is generated. For locations **derived from the script**, one click does both —
  "Draft & Generate" auto-drafts the spec from the linked scenes, then renders. For **hand-added**
  locations (no script source to draft from), generation is **gated**: the "Regenerate plate" button
  stays disabled with a hint, and the spec fold opens by default, until the spec is written. This
  script-vs-manual rule is shared across **Props, Characters and Locations** — derived entities keep
  one-click Draft & Generate; hand-added ones must be described first.
  **Same place, two names (approved 2026-10-14 by owner).** When a scene's card slugline names a different
  place than the first heading of that scene's own screenplay, and one name is the other plus more words, and
  the card's name plays in no scene the screenplay's name doesn't (Glass Hours scene 13: card "EXT. FONDAMENTA",
  screenplay "EXT. FONDAMENTA DEI VETRAI"), both cards say "These look like one place" — a suggestion only, never
  applied on its own — with **Merge** (one confirmed action, for the owner or an Art director: one card stays,
  with its shared layout and plate, named as the screenplay's headings name it; the place's name on the scene
  card's slugline is corrected to the screenplay's words, the rest of that slugline kept; shots and props that
  pointed at the other card point at the kept one; the other card goes to Recently deleted, and copies of its plates —
  its plate, extra-space and environment-state plates — become earlier versions of the kept card's plate, never its current
  one; an Art director's merge leaves the scene card's slugline as it is, since an Art director can't edit scenes — the
  merged place still reads correctly, and the owner's merge corrects it), **Part of** (the place and its
  part stay as derived) or **Keep separate** (two places, never folded by name). Any card also has **Same place
  as…** for a pair nothing points at. The decision is stored on the cards and every derivation from the
  sluglines reads it, so a merged-away name never comes back as a card; on a Show it holds in every episode.
- **Style Bible grade is NOT baked into location plates.** A location can span scenes with different
  looks, so its coverage plate renders **grade-neutral**; the card shows only an informational chip of
  which preset(s) its scenes use. The 60/30/10 Style Bible grade is a per-scene property applied
  **downstream at the shot**, never on the location plate. Style is assigned in the **Style Bible** tab.
- **Depth-Grid Staging (per location).** Each location owns a **3×3 depth grid** — Background /
  Midground / Foreground × Left / Center / Right — plus **Floor**, **Scale Class** and **Camera/Lens**.
  Named landmark roles: **Wall A** (centre-background primary landmark), **Wall B / Wall C** (left/right
  midground framing elements), foreground veils (**L1 / R1**), and the midground centre reserved for the
  **Subject**. **Cells are optional** — an empty cell means open space, so linear or open locations are
  never forced into a box. **Draft staging** fills the grid from the script; when the grid has content it
  feeds the plate prompt as spatially-explicit depth language (so images get true fg/mid/bg separation).
  The grid is the **canonical landmark layer a location owns**; Shots inherit and vary it.
- **Shot List (the convergence tab).** One beat → one **opening keyframe**, represented directly by a standalone
  image-generation sheet card, like Characters, Props, Locations and Lookbook—not an editor nested inside another Beat card.
  **"Draft all shots"** uses beat boundaries and the actual screenplay to frame the beat's starting situation, giving each
  shot a **size · angle · move · lens**, the subject(s)/prop(s) in frame, an action line, an editable
  **composition** note and any dialogue. Shots are **grouped by scene** (per-scene Re-draft / Add shot / Generate
  scene); "Draft all shots" is **non-destructive** (only breaks down scenes that have none yet).
  Text senders, callers, voicemail/voice-over speakers and merely mentioned people are not automatically
  on-screen characters. Cards distinguish visual presence from remote participation and expose the screenplay source.
  Full-scene screenplay text and screenplay-page images supply background context, with the target beat identified.
  These are reading references, not visual compositions or extra cast to copy; the target beat's opening frame remains
  authoritative. Visual identity/location references retain priority, and omitted screenplay pages are disclosed.
  **"Update from screenplay"** keeps the primary shot's ID and image history; after confirmation, additional
  coverage moves to restorable Shots Trash without deleting images or takes. The full beat remains available
  to Stage as motion/dialogue context; it is not compressed into the still or expanded into automatic microbeat shots.
  Each frame is
  generated by composing five layers into one image: the scene's **Style Bible grade** (where the 60/30/10 grade
  is finally applied), the **location plate + depth-grid framing scoped to the shot size**, and the **character
  and prop sheets** passed as reference images for cross-shot continuity. **"Generate all shots"** batch-renders
  every frame (one at a time, skip/regenerate). **"Export shot list"** opens a printable AD-style table (Save as
  PDF). The Storyboard tab lays these frames out in sequence next.

### 10. The Stage — performance & assembly  *(audio-first; approved 2026-06-13. Assembly shell built; voice + video render are the next phases)*
Storyboard lays out the still frames in sequence; the **Stage** turns each into a moving shot.
**Audio leads:** each shot's `dialogue` is rendered through the speaking character's **locked voice**;
the line's **duration sets the clip length and the cut point**. The shot's **frame** (already produced
in Shot List) plus the **line audio** are handed to the video model, which **lip-syncs the performance
to the audio**. Multi-character shots attach **one reference audio per speaker**, bound to the right
face. The sequence of line durations becomes the **edit timeline** — cuts fall on line boundaries;
lines longer than one clip are split at a sentence/beat boundary. Built audio-first per
`docs/Voice & Lip-Sync (Seedance) Plan.md`.

---

## Implementation status (keep this honest)
- Steps **3–8** exist in code today (Adaptation agent, Spine, beats→script, drafting controls, Writers' Room, Frances).
- Step **2 (Research → Synopsis)** is **now built** (`aiResearchSynopsis` in `app/ai.jsx`, the synopsis-review
  step in `app/newstory.jsx`, threaded into the spine build via `composeStoryBrief`). The New Story flow is
  now: seed → loglines → **research → synopsis (review/edit)** → spine. The Fact pillar (period, place, the
  protagonist's role through four lenses: what happens / how it feels / frustrating / lovely) **searches the web**
  on writing engines that can (Claude Opus 5 / 5.5, Sonnet 5 / 5.5 — `image-proxy` `webSearch`, held and billed per
  search) and shows the pages it used; on other engines it is labelled "From general knowledge — not checked against
  the web" *(2026-10-02, owner-approved)*. The whole research is **saved with the film** (`project.research`) and
  read by the story-world build and the cast's inner-life pass before the script (`researchReservoir`)
  *(2026-10-02, owner-approved)*. Research and synopsis are separate calls — `aiResearch` (every principal's
  lenses in `fact.roles`, an optional steer) and `aiSynopsisFromResearch` — on their own **Research** and
  **Synopsis** steps; the logline check rides in `aiSeedToLoglines` *(2026-10-02, owner-approved)*.
- `APP_FEATURES` in `app/ai.jsx` has been updated so Frances can describe the stage.
- Step **10 (The Stage)**: the **audio-first assembly shell** is built (`app/stage.jsx`, room unlocked) —
  it lays the clip partition + shot frames + dialogue on the cut timeline, timed by ESTIMATED line
  durations. The **Voices** tab (Step 9) and the real voice/video render (ElevenLabs → Seedance) are the
  next phases (keys/endpoint in hand).

---

## Change log
- *(2026-10-18 — Entry B added by owner approval)* — **Import a screenplay**: a second way in for a finished script, read into the pipeline word for word and joining at Step 4; no existing step changed (`docs/Script Import Plan.md`).
- *(created)* — initial pipeline codified from the manager's 8-step spec + the Three Pillars of Research.
- *(Step 2 shipped)* — Research → Synopsis built into the New Story flow: 3-pillar research + editable
  three-paragraph synopsis, reviewed before the spine builds, then threaded into spine/world/cast generation.
- *(Step 10 added; Voices tab approved)* — The Stage (audio-first performance & assembly) and a
  planned Voices tab in Step 9, per `Voice & Lip-Sync (Seedance) Plan.md`, with the user's explicit
  approval of the §2 wording. The Stage assembly shell shipped (`app/stage.jsx`); voice/video phases next.
- *(Step 9 added)* — Pre-production / Art Room documented, including per-location **Depth-Grid Staging**
  (3×3 + Floor + Scale Class + Camera, optional cells, AI "Draft staging", feeds the plate prompt). Added
  with the user's explicit permission; the grid lives on Locations now and Shots will inherit it later.
- *(2026-06-15 — Characters before Props)* — Art Room reordered so **Characters precede Props** (tab
  order + default tab + Coordinator). Each worn/owned prop is now generated **referencing its owner's
  character sheet** so it matches that character (a prop made in isolation came out generic). The
  Coordinator gained a **"Wear props"** pass after Props that re-generates each affected character's
  master so it wears the finalized worn-prop sheets (refreshing any existing appearance variant).
  Done with the user's explicit permission.
