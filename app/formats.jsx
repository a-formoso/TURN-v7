/* formats.jsx — the FORMAT registry: what we're making.
   Single source of truth for everything format-aware (docs/Formats Plan.md).
   Formats change the SIZE and DRESSING of what the studio builds — target scene
   count & runtime, screenplay emphasis, aspect & Stage defaults, room copy —
   never the pipeline itself (Development → Pre-production → Production → Post
   holds for all). Nothing elsewhere may check format ids inline; it reads this
   registry through the helpers at the bottom.

   Per-entry fields used by Phase 2:
   - stage:{ clipMax, aspect }  — the Stage's per-clip budget (seconds) and the
     format's native frame (drives headless shot generation, storyboard panels
     and prompt wording; the interactive engine dock stays user-controlled).
   - screenplayBrief — one line merged into the scene drafter's prompt
     ("full" formats omit it; "light"/"interview" formats reshape the page).
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
    blurb:"90+ minutes · a 40-scene spine with room for a B-story.",
    spineBrief:"a feature film — a full-length dramatic arc: the A-story drives the spine while a B-story (usually a relationship) turns alongside it and crosses the A-story at the act breaks; give each act room to escalate",
    stage:{ clipMax:15, aspect:"16:9" } },

  { id:"short",       label:"Micro Short", icon:"clapper", scenes:[6,10],  sceneTarget:8,  runtimeMin:5,  aspect:"16:9",
    screenplay:"full", group:"short", order:4,
    blurb:"Under 5 minutes · one idea, one turn.",
    spineBrief:"a short — one central idea, one decisive turn, a few minutes of screen time; keep the spine lean",
    stage:{ clipMax:15, aspect:"16:9" } },

  { id:"commercial",  label:"Commercial",  icon:"bolt",    scenes:[3,5],   sceneTarget:4,  runtimeMin:1,  aspect:"16:9",
    researchBrief:"FORMAT: COMMERCIAL — the 'protagonist' lens is the PRODUCT and the customer: research the product or brand promise at the story's center, the audience it must move and what they actually care about, and the category's visual & verbal codes (what every ad in this category does, so this one can break it).",
    screenplay:"light", group:"nonfiction", order:8,
    blurb:"30–60 seconds · a product story.",
    spineBrief:"a 30–60 second commercial — every scene sells one beat of the product story; end on the promise",
    screenplayBrief:"THIS IS A COMMERCIAL SCRIPT, not feature scene-work: write tight action blocks, VO lines and on-screen SUPERs; every line earns its second; land the product promise and end-card in the final beat",
    coverageBrief:"commercial coverage: few shots, each one a poster — hero the product, keep cuts fast and clean",
    stage:{ clipMax:15, aspect:"16:9" },
    rooms:{
      props:{ title:"Product & Props", tip:"The hero product and everything around it. The product's reference sheet is the most important asset in the project — every shot must match it exactly." },
      characters:{ title:"Talent (Casting)", tip:"The faces of the spot. Each gets a canonical reference sheet so they look identical in every frame." } } },

  { id:"microdrama",  label:"Micro-drama", icon:"user",    scenes:[6,8],   sceneTarget:7,  runtimeMin:2,  aspect:"9:16",
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

  { id:"documentary", label:"Documentary", icon:"globe",   scenes:[10,14], sceneTarget:12, runtimeMin:10, aspect:"16:9",
    researchBrief:"FORMAT: DOCUMENTARY — the subject is REAL: research the actual world honestly (the type, the milieu, the era), what ACCESS to it would look like for a crew, and what is verifiable versus invented; never fabricate facts about real, named people.",
    screenplay:"interview", group:"nonfiction", order:7,
    blurb:"Real subjects · a found structure.",
    spineBrief:"a documentary — real subjects and places; scenes are sequences of testimony, observation and archive, structured to turn like drama; never invent events, motives or words for real people",
    screenplayBrief:"THIS IS A DOCUMENTARY: scenes are written as interview questions + expected testimony beats, narration beds, and observational action — no invented dialogue in subjects' mouths; mark ARCHIVE where found footage carries the beat",
    coverageBrief:"documentary coverage: interview setups, observational handheld, archive inserts and cutaways — honest, not staged",
    stage:{ clipMax:15, aspect:"16:9" },
    rooms:{
      characters:{ title:"Subjects (Casting)", tip:"The real people on camera. Each subject gets a reference sheet so their look stays consistent across interview setups and observational scenes." },
      props:{ title:"Artifacts & Archive", tip:"The objects, documents and archive materials the camera returns to — each gets a reference sheet so it reads identically in every cutaway." } } },

  { id:"musicvideo",  label:"Music Video", icon:"music",   scenes:[6,10],  sceneTarget:8,  runtimeMin:4,  aspect:"16:9",
    researchBrief:"FORMAT: MUSIC VIDEO — research the song's world: the artist's persona and visual history, the genre's video codes, and the images the lyrics and sound suggest without illustrating them literally.",
    screenplay:"light", group:"short", order:6,
    blurb:"3–5 minutes · a story cut to a song.",
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
