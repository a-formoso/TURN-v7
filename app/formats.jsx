/* formats.jsx — the FORMAT registry: what we're making.
   Single source of truth for everything format-aware (docs/Formats Plan.md).
   Formats change the SIZE and DRESSING of what the studio builds — target scene
   count & runtime, screenplay emphasis, aspect & Stage defaults, room copy —
   never the pipeline itself (Development → Pre-production → Production → Post
   holds for all). Nothing elsewhere may check format ids inline; it reads this
   registry through the helpers at the bottom.

   - runtimeMin — the format's screen-time target in minutes (a Commercial is 0.5 = 30 s);
     read ONLY through sceneBudgetFor() below, which turns it into each scene's budget.
   - beatRange:[lo,hi] — beats per scene for the beat builder (omitted = 4–6).
   - testimonySec — how long one planned testimony note ("EXPECTED TESTIMONY: …", a
     documentary's page form) plays once recorded: the screen-time estimate counts each note
     at this many seconds, and the writers are told so (omitted = the format has none).

   Per-entry fields used by Phase 2:
   - stage:{ clipMax, aspect }  — the Stage's per-clip budget (seconds) and the
     format's native frame (drives headless shot generation, storyboard panels
     and prompt wording; the interactive engine dock stays user-controlled).
   - screenplayBrief — one line merged into the scene drafter's prompt
     ("full" formats omit it; "light"/"interview" formats reshape the page). A format
     without one is still described to the writers: formatDraftBrief() falls back to
     its spineBrief, so no scene is drafted blind to what it is.
   - coverageBrief — one line merged into the shot-coverage drafter's prompt.
   - rooms:{ tabId:{ title, tip } } — Art Room intro overrides (a documentary's
     "cast" is subjects; a commercial's props are the product). Missing = default.
   - tabs:{ tabId:"hidden" } — removes a tab for this format (capability; used
     sparingly — formats hide almost nothing).
   - group / order — where the New Story Shape step shows it (Long form · Short form ·
     Non-fiction & brand). The ARRAY order is not the display order: `film` stays
     first because formatOf() falls back to it for unknown and legacy values.
   Every format works with every narrative framework (frameworks.jsx). Lineup revised
   2026-09-25 by owner: Feature Film, TV Series (half-hour episodes) and Music Video
   added; Film → "Short Film", Short → "Micro Short". Ids are unchanged. */

const FORMATS = [
  { id:"film",        label:"Short Film",  icon:"video",   scenes:[14,18], sceneTarget:16, runtimeMin:15, aspect:"16:9",
    screenplay:"full", group:"short", order:3,
    blurb:"10–20 minutes · the classic 16-scene method.",
    spineBrief:"a short film of about 10–20 minutes — one complete dramatic arc",
    stage:{ clipMax:15, aspect:"16:9" } },

  { id:"feature",     label:"Feature Film", icon:"film",   scenes:[36,48], sceneTarget:40, runtimeMin:100, aspect:"16:9",
    screenplay:"full", group:"long", order:1,
    blurb:"About 100 minutes · a 40-scene spine with room for a B-story.",
    spineBrief:"a feature film — a full-length dramatic arc: the A-story drives the spine while a B-story (usually a relationship) turns alongside it and crosses the A-story at the act breaks; give each act room to escalate",
    stage:{ clipMax:15, aspect:"16:9" } },

  { id:"short",       label:"Micro Short", icon:"clapper", scenes:[6,10],  sceneTarget:8,  runtimeMin:4,  aspect:"16:9", beatRange:[3,4],
    screenplay:"full", group:"short", order:4,
    blurb:"Under 5 minutes · one idea, one turn.",
    spineBrief:"a short — one central idea, one decisive turn, a few minutes of screen time; keep the spine lean",
    stage:{ clipMax:15, aspect:"16:9" } },

  { id:"commercial",  label:"Commercial",  icon:"bolt",    scenes:[3,5],   sceneTarget:4,  runtimeMin:0.5, aspect:"16:9", beatRange:[2,3],
    researchBrief:"FORMAT: COMMERCIAL — the 'protagonist' lens is the PRODUCT and the customer: research the product or brand promise at the story's center, the audience it must move and what they actually care about, and the category's visual & verbal codes (what every ad in this category does, so this one can break it).",
    screenplay:"light", group:"nonfiction", order:8,
    blurb:"30 seconds · a product story.",
    spineBrief:"a 30-second commercial — every scene sells one beat of the product story; end on the promise",
    screenplayBrief:"THIS IS A COMMERCIAL SCRIPT, not feature scene-work: write tight action blocks, VO lines and on-screen SUPERs; every line earns its second; land the product promise and end-card in the final beat",
    coverageBrief:"commercial coverage: few shots, each one a poster — hero the product, keep cuts fast and clean",
    stage:{ clipMax:15, aspect:"16:9" },
    rooms:{
      props:{ title:"Product & Props", tip:"The hero product and everything around it. The product's reference sheet is the most important asset in the project — every shot must match it exactly." },
      characters:{ title:"Talent (Casting)", tip:"The faces of the spot. Each gets a canonical reference sheet so they look identical in every frame." } } },

  { id:"microdrama",  label:"Micro-drama", icon:"user",    scenes:[6,8],   sceneTarget:7,  runtimeMin:2,  aspect:"9:16", beatRange:[2,3],
    researchBrief:"FORMAT: MICRO-DRAMA — research the attention economy this must live in: a vertical, sound-on, seconds-long scroll; what about THIS premise stops the thumb, and what real-world texture makes the hook feel true rather than baity.",
    screenplay:"full", group:"short", order:5,
    blurb:"Vertical 9:16 episodes · 1–3 minutes, hooked in seconds.",
    spineBrief:"a vertical micro-drama episode — hook inside the first scene, a cliff at the end of every scene, shot for phones",
    coverageBrief:"vertical 9:16 coverage: faces big in frame, singles over wides, compositions that read on a phone",
    stage:{ clipMax:15, aspect:"9:16" } },

  { id:"series",      label:"TV Series",   icon:"monitor", scenes:[20,28], sceneTarget:24, runtimeMin:30, aspect:"16:9",
    screenplay:"full", needsShow:true, group:"long", order:2,
    blurb:"Episodes of one show · about 30 minutes each.",
    spineBrief:"a TV series episode of about half an hour — a complete episode arc with an A-plot and a B-plot, ending on a turn that pulls the audience into the next episode, while planting threads the season pays off",
    stage:{ clipMax:15, aspect:"16:9" } },

  { id:"documentary", label:"Documentary", icon:"globe",   scenes:[10,14], sceneTarget:12, runtimeMin:10, aspect:"16:9", testimonySec:15,
    researchBrief:"FORMAT: DOCUMENTARY — the subject is REAL: research the actual world honestly (the type, the milieu, the era), what ACCESS to it would look like for a crew, and what is verifiable versus invented; never fabricate facts about real, named people.",
    screenplay:"interview", group:"nonfiction", order:7,
    blurb:"About 10 minutes · real subjects, a found structure.",
    spineBrief:"a documentary — real subjects and places; scenes are sequences of testimony, observation and archive, structured to turn like drama; never invent events, motives or words for real people",
    // the page forms (docs/Story Pipeline.md step 5, "Page forms the check accepts", owner-approved
    // 2026-09-27): an interviewer's questions as INTERVIEWER (O.S.), planned testimony as
    // EXPECTED TESTIMONY: <subject> on <topic> in action — never invented lines for a real person
    screenplayBrief:"THIS IS A DOCUMENTARY: scenes are written as interviewer questions, expected testimony, narration beds and observational action — never invented lines for a real person. PAGE FORMS: an interviewer's question is a \"char\" cue INTERVIEWER (O.S.) followed by its \"dia\" (never a question inside action); planned testimony is an \"action\" line EXPECTED TESTIMONY: <subject> on <topic> — a note of what the subject will cover, with no quotes and no words written for them (their testimony is recorded, never scripted); narration is a NARRATOR (V.O.) cue with its \"dia\"; mark ARCHIVE: <what the footage shows> where found footage carries the beat",
    coverageBrief:"documentary coverage: interview setups, observational handheld, archive inserts and cutaways — honest, not staged",
    stage:{ clipMax:15, aspect:"16:9" },
    rooms:{
      characters:{ title:"Subjects (Casting)", tip:"The real people on camera. Each subject gets a reference sheet so their look stays consistent across interview setups and observational scenes." },
      props:{ title:"Artifacts & Archive", tip:"The objects, documents and archive materials the camera returns to — each gets a reference sheet so it reads identically in every cutaway." } } },

  { id:"musicvideo",  label:"Music Video", icon:"music",   scenes:[6,10],  sceneTarget:8,  runtimeMin:4,  aspect:"16:9", beatRange:[2,3],
    researchBrief:"FORMAT: MUSIC VIDEO — research the song's world: the artist's persona and visual history, the genre's video codes, and the images the lyrics and sound suggest without illustrating them literally.",
    screenplay:"light", group:"short", order:6,
    blurb:"About 4 minutes · a story cut to a song.",
    spineBrief:"a narrative music video — the scenes follow the song's sections (intro, verses, choruses, bridge, outro) and the story turns on the music",
    screenplayBrief:"THIS IS A MUSIC VIDEO: write each scene as visual action cut to the song — name the song section it plays over (VERSE 1, CHORUS, BRIDGE...), keep PERFORMANCE beats (the artist to camera) apart from NARRATIVE beats, and give no spoken dialogue unless the story needs a brief exchange before the music starts",
    coverageBrief:"music-video coverage: performance setups plus narrative inserts, cut on the beat; bold, graphic frames",
    stage:{ clipMax:15, aspect:"16:9" },
    rooms:{
      characters:{ title:"Artist & Cast", tip:"The artist and everyone in the story. Each gets a canonical reference sheet so they look identical in every performance and narrative shot." } } },
];
window.FORMATS = FORMATS;
/* the Shape step's groups, in display order */
const FORMAT_GROUPS = [
  { id:"long", label:"Long form" },
  { id:"short", label:"Short form" },
  { id:"nonfiction", label:"Non-fiction & brand" } ];
function formatsForPicker(){
  return FORMAT_GROUPS.map(g=>({ ...g, formats:FORMATS.filter(f=>f.group===g.id).sort((a,b)=>(a.order||99)-(b.order||99)) }))
    .filter(g=>g.formats.length);
}
window.FORMAT_GROUPS = FORMAT_GROUPS; window.formatsForPicker = formatsForPicker;

/* normalize anything stored in project.format (registry id, legacy freeform text
   like "Feature Film", or nothing) to a registry entry. Default: film. */
function formatOf(project){
  const raw = ((project && project.format) || "").toString().toLowerCase().trim();
  // an exact id or an exact LABEL wins ("Feature Film" is the feature format's own label —
  // it used to fall through to the loose match and land on Short Film); loose legacy text
  // still takes the first registry entry it contains (owner, 2026-09-26: old films deleted)
  return FORMATS.find(f=>f.id===raw)
      || FORMATS.find(f=>f.label.toLowerCase()===raw)
      || FORMATS.find(f=>raw.includes(f.id) || raw.includes(f.label.toLowerCase()))
      || FORMATS.find(f=>f.id==="film");
}
window.formatOf = formatOf;

/* ---- Phase 2 helpers — the only way other files read format behavior ---- */
function clipMaxFor(project){ const f=formatOf(project); return (f.stage&&f.stage.clipMax)||15; }
function aspectFor(project){ const f=formatOf(project); return (f.stage&&f.stage.aspect)||"16:9"; }
/* Art Room intro copy for a tab: {title?, tip?} — empty object means "use defaults" */
function roomCopy(project, tabId){ const f=formatOf(project); return (f.rooms&&f.rooms[tabId])||{}; }
/* true when a tab is hidden for this format */
function tabHidden(project, tabId){ const f=formatOf(project); return !!(f.tabs&&f.tabs[tabId]==="hidden"); }
window.clipMaxFor = clipMaxFor; window.aspectFor = aspectFor;
window.roomCopy = roomCopy; window.tabHidden = tabHidden;

/* ---- SCREEN TIME PER SCENE (docs/Story Pipeline.md step 5, owner-approved 2026-09-27) ----
   "Each scene is written to a screen-time budget — the format's runtime divided by its scene
   count — and the beat map is sized to it." This is the ONE place anything reads a format's
   length. The budget is given three ways, shared by the writers and the check:
   - seconds of screen time: runtime ÷ the film's actual scene count;
   - screenplay lines at the SAME rate sceneRuntime() (spine.jsx) estimates with — one page
     ≈ 55 lines ≈ 60 s — so the writer's target and the estimate agree;
   - words, at about 4 per line (the nine 2026-09-27 sample builds measured 4.2–4.9 words per
     estimated line, so a writer who hits the word count lands inside the line budget).
   Beats per scene: 2–3 for Commercial, Micro-drama and Music Video, 3–4 for Micro Short,
   4–6 for every other format (the registry's beatRange). */
const SCREEN_LINES_PER_MIN = 55, SCREEN_WORDS_PER_LINE = 4;
/* a drafted scene past 1.5× its budget is "long for this format" — a free warning, no model
   call, nothing rewritten (the check lives here so the scene card and the Script view agree) */
const LONG_FOR_FORMAT = 1.5;
function _formatEntry(x){ return (x && FORMATS.includes(x)) ? x : formatOf(x); }
/* "30 seconds" / "4 minutes" — how a prompt or the app says a length */
function runtimeText(sec){
  const s = Math.max(0, Number(sec)||0);
  return s < 120 ? Math.round(s)+" seconds" : Math.round(s/60)+" minutes";
}
/* each scene's budget. projectOrFormat: a project (its `format`) or a FORMATS entry;
   sceneCount: the film's scene count (missing/0 = the format's target count). */
function sceneBudgetFor(projectOrFormat, sceneCount){
  const f = _formatEntry(projectOrFormat);
  const runtimeSec = Math.round((Number(f.runtimeMin) > 0 ? Number(f.runtimeMin) : 15) * 60);
  const n = Math.max(1, Math.round(Number(sceneCount)) || f.sceneTarget || 16);
  const sec = runtimeSec / n;
  const beats = (Array.isArray(f.beatRange) && f.beatRange.length===2) ? [f.beatRange[0], f.beatRange[1]] : [4, 6];
  // never fewer lines than the fewest beats can be written in (one short line each, ≈2 lines):
  // a film with far more scenes than its format holds still gets an ask it can meet
  const lines = Math.max(3, beats[0] * 2, Math.round(sec / 60 * SCREEN_LINES_PER_MIN));
  const out = { format:f.id, label:f.label, runtimeSec, runtimeText:runtimeText(runtimeSec), scenes:n,
    sec, lines, words:lines * SCREEN_WORDS_PER_LINE, beats };
  if(Number(f.testimonySec) > 0) out.testimonySec = Number(f.testimonySec);
  return out;
}
/* "30-second" / "2-minute" — the adjective form, for "a ~2-minute Micro-drama" */
function runtimeAdj(sec){
  const s = Math.max(0, Number(sec)||0);
  return s < 120 ? Math.round(s)+"-second" : Math.round(s/60)+"-minute";
}
/* "a ~2-minute Micro-drama in 7 scenes" — where a scene's budget comes from, in words */
function budgetPhrase(budget){
  if(!budget) return "";
  return "a ~"+runtimeAdj(budget.runtimeSec)+" "+budget.label+" in "+budget.scenes+" scene"+(budget.scenes!==1?"s":"");
}
/* one beat's share of a scene's budget (the single-beat writer) — never under 3 lines, the
   least a beat can be written in: a character cue (2 lines) and one short line, or an action
   line of up to two dozen words (a Commercial's VO beat must be possible) */
function beatBudgetFor(budget, beatCount){
  const n = Math.max(1, Math.round(Number(beatCount)) || 1);
  const lines = Math.max(3, Math.round(budget.lines / n));
  return { sec:budget.sec / n, lines, words:lines * SCREEN_WORDS_PER_LINE };
}
/* THE SHAPE THAT FITS (owner 2026-11-11, Writers' Room audit B3). The budget was stated in lines and words, and
   every test film still ran long by the app's own estimate: Commercial 303%, Micro-drama 244%, Micro Short
   185-198%, Short Film 142%. A model does not count lines; it counts THINGS. So the scene writer is also given
   the budget as a number of units — one action paragraph, or one speech (a cue with its line) — at the estimator's
   own cost of about 2.8 lines a unit, with the words that leaves each. Never fewer units than beats (each beat
   needs one). A documentary is left out: its planned testimony is budgeted in seconds, not units. */
const SCREEN_LINES_PER_UNIT = 2.8;
function sceneShapeFor(budget, beatCount){
  if(!budget || !(budget.lines > 0) || budget.testimonySec) return null;
  const n = Math.max(1, Math.round(Number(beatCount)) || (budget.beats && budget.beats[0]) || 1);
  const units = Math.max(n, Math.round(budget.lines / SCREEN_LINES_PER_UNIT));
  const unitWords = Math.max(6, Math.min(24, Math.round(budget.words / units)));
  return { units, beats:n, perBeatLo:Math.max(1, Math.floor(units/n)), perBeatHi:Math.max(1, Math.ceil(units/n)), unitWords, words:budget.words };
}
/* how long a synopsis paragraph is, by what the format can hold (audit C4): a 30-second commercial was
   getting the same three long paragraphs as a short film, and the scenes were then written to match */
function synopsisSentencesFor(projectOrFormat){
  const f = _formatEntry(projectOrFormat);
  const sec = Math.round((Number(f.runtimeMin) > 0 ? Number(f.runtimeMin) : 15) * 60);
  return sec <= 60 ? "1-2" : sec <= 300 ? "2-3" : "3-5";
}
/* the free "long for this format" check: rt is sceneRuntime()'s estimate. Only a DRAFTED
   scene can run long (an undrafted scene's figure is the budget itself). */
function sceneLengthCheck(rt, budget){
  if(!rt || rt.approx || !budget || !(budget.sec > 0) || !(Number(rt.sec) > 0)) return { long:false, ratio:0 };
  const ratio = Number(rt.sec) / budget.sec;
  return { long: ratio > LONG_FOR_FORMAT, ratio, sec:Number(rt.sec), budgetSec:budget.sec, limitSec:budget.sec * LONG_FOR_FORMAT };
}
/* the format described to the scene writers: its screenplay brief, or — for a format that
   has none (Short Film, Feature, Micro Short, Micro-drama, TV) — its spine brief, so no
   scene is drafted without knowing what it is part of */
function formatDraftBrief(projectOrFormat){
  const f = _formatEntry(projectOrFormat);
  if(f.screenplayBrief) return f.screenplayBrief;
  return f.spineBrief ? "this is "+f.spineBrief : "";
}
window.SCREEN_LINES_PER_MIN = SCREEN_LINES_PER_MIN; window.LONG_FOR_FORMAT = LONG_FOR_FORMAT;
window.runtimeText = runtimeText; window.runtimeAdj = runtimeAdj; window.budgetPhrase = budgetPhrase; window.sceneBudgetFor = sceneBudgetFor; window.beatBudgetFor = beatBudgetFor;
window.sceneLengthCheck = sceneLengthCheck; window.formatDraftBrief = formatDraftBrief;
window.sceneShapeFor = sceneShapeFor; window.synopsisSentencesFor = synopsisSentencesFor;
/* WHAT "TURN THIS INTO A SHOW" DOES TO THE FORMAT (2026-11-12, Writers' Room audit C8). Every episode of a Show has
   the Show's format, and a Show's format is a Show format (today: TV Series). So a Micro-drama, a Short Film or
   any other film becomes a TV Series episode when it is turned into a Show — and the question asked before doing
   it never said so. The sentence for that question; "" when the film already has a Show format. The rule itself
   (which format a Show gets) is app.jsx makeShow's and is unchanged. */
function turnShowFormatNote(project){
  const now = _formatEntry(project);
  if(!now || now.needsShow) return "";
  const show = FORMATS.find(f=>f.id==="series");
  if(!show || show.id===now.id) return "";
  const size = "planned as about "+runtimeText(Math.round(Number(show.runtimeMin||0)*60))+" in "+show.sceneTarget+" scenes";
  return "Its format also changes, from "+now.label+" to "+show.label+": every episode of a Show is a "+show.label+" episode ("+size+"). The scenes already written are kept as they are.";
}
window.turnShowFormatNote = turnShowFormatNote;
