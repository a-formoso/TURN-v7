/* frameworks.jsx — the NARRATIVE FRAMEWORK registry: how the story is told.
   Single source of truth for everything framework-aware (docs/Frameworks Plan.md).
   The spine's primitive — a charge per scene — is framework-neutral; a framework
   defines the layer above it: the act bands, the audit rule & verdict language,
   the spine-builder grammar and the Story Doctor's criteria. "The Infinite Studio AI
   method" is the umbrella; frameworks are interchangeable lenses inside it.
   Orthogonal to FORMAT (formats.jsx): any format × any framework.

   The turn rule is shared (chargeTurn, below): a turn is a sign reversal; a same-side
   move of 2+ is a progression (owner decision 2026-09-25, superseding the former
   "sign or |Δ| ≥ 2" rule). */

/* THE TURN (approved 2026-09-25 by owner): a scene TURNS when its value changes
   charge — positive to negative or negative to positive (from a neutral 0, only a
   decisive ±2 or more counts). Moving 2+ on the SAME side (+1 → +3) is a PROGRESSION:
   the value intensifies without reversing — fine inside a run of scenes, weak at a
   structural peak. Anything smaller is flat. Every framework rule, the Doctor, the
   builders and the exports classify with this one function. */
function chargeTurn(openCharge, closeCharge){
  const o = Number(openCharge)||0, c = Number(closeCharge)||0;
  const so = Math.sign(o), sc = Math.sign(c), delta = Math.abs(c - o);
  const turned = (so!==0 && sc!==0 && so!==sc) || (so===0 && Math.abs(c)>=2);
  const progression = !turned && delta>=2;
  return { turned, progression, delta };
}
window.chargeTurn = chargeTurn;
/* the classic rule, with a framework's exempt kinds */
function classicTurnRule(exemptKinds){
  return (sc)=>{
    const t = chargeTurn(sc.openCharge, sc.closeCharge);
    const exempt = exemptKinds.indexOf(sc.kind)>=0;
    return { turned:t.turned, progression:t.progression, flagged:!t.turned && !t.progression && !exempt, exempt,
      status: exempt ? "exempt" : t.turned ? "turn" : t.progression ? "progression" : "flat" };
  };
}
/* ONE VALUE AT STAKE (approved 2026-09-25 by owner): a scene names one value axis —
   scene.value = {pos:"Love", neg:"Hate"} — and opens and closes on it. The opening and
   closing WORDS follow the charges (the positive pole for a positive charge, the
   negative pole for a negative one), so they can no longer drift apart. Scenes without
   an axis keep their legacy free words. */
function sceneValueAxis(sc){
  const v = sc && sc.value;
  if(!v || typeof v!=="object") return null;
  const pos = String(v.pos||"").trim(), neg = String(v.neg||"").trim();
  return (pos || neg) ? { pos, neg } : null;
}
function valueWordFor(axis, charge){
  if(!axis) return "";
  const c = Number(charge)||0;
  if(c>0) return axis.pos || axis.neg;
  if(c<0) return axis.neg || axis.pos;
  return (axis.pos && axis.neg) ? axis.pos+" / "+axis.neg : (axis.pos || axis.neg);
}
function withValueWords(sc){
  const axis = sceneValueAxis(sc);
  return axis ? { ...sc, openValue:valueWordFor(axis, sc.openCharge), closeValue:valueWordFor(axis, sc.closeCharge) } : sc;
}
/* a best guess at a legacy scene's axis from its two free words: when the charges sit
   on opposite sides, the positively charged word is the positive pole */
function guessValueAxis(sc){
  if(!sc) return null;
  const clean = (w)=>{ w = String(w||"").trim(); return /^value$/i.test(w) ? "" : w; };
  const o = Number(sc.openCharge)||0, c = Number(sc.closeCharge)||0, ow = clean(sc.openValue), cw = clean(sc.closeValue);
  if(o>0 && c<0) return { pos:ow, neg:cw };
  if(o<0 && c>0) return { pos:cw, neg:ow };
  if(c>0 || (c===0 && o>0)) return { pos:(c>0?cw:ow), neg:"" };
  if(c<0 || (c===0 && o<0)) return { pos:"", neg:(c<0?cw:ow) };
  return { pos:ow||cw, neg:"" };
}
window.sceneValueAxis = sceneValueAxis; window.valueWordFor = valueWordFor;
window.withValueWords = withValueWords; window.guessValueAxis = guessValueAxis;

const PROGRESSION_COPY = { progTitle:"This scene progresses", progBadge:"Progresses",
  progDetail:"The value intensifies on the same side instead of reversing. That's fine inside a run of scenes; at a structural peak, make it flip.",
  analysisProg:" — intensified on the same side. A progression, not a turn." };

/* HERO'S JOURNEY IN 4 SCENES OR FEWER (approved 2026-09-25 by owner): the twelve stages
   can't all fit, and the positional map used to leave a commercial with no call, no
   threshold and no elixir. The minimum journey keeps a departure, the ordeal and a
   return that settles. One table feeds the spine prompt AND the stage labels. */
const HERO_MINI_STAGES = {
  4:[["ordinary-world",1,"the ORDINARY WORLD — who the hero is before anything changes"],
     ["threshold",1,"CROSSING THE THRESHOLD — the hero commits and leaves the familiar behind"],
     ["ordeal",2,"the ORDEAL — the trial at the journey's heart, a brush with death or loss that forces a rebirth"],
     ["elixir",3,"the RETURN WITH THE ELIXIR — the hero comes home changed, carrying what the journey bought; this last scene may settle instead of reversing"]],
  3:[["threshold",1,"CROSSING THE THRESHOLD — the hero leaves the familiar behind"],
     ["ordeal",2,"the ORDEAL — the trial at the journey's heart, a brush with death or loss that forces a rebirth"],
     ["elixir",3,"the RETURN WITH THE ELIXIR — the hero comes home changed; this last scene may settle instead of reversing"]],
  2:[["ordeal",2,"the ORDEAL — the trial at the journey's heart"],
     ["elixir",3,"the RETURN WITH THE ELIXIR — the hero comes home changed; this last scene may settle"]],
  1:[["elixir",3,"the RETURN WITH THE ELIXIR — the hero comes home changed"]] };
function heroMiniStages(total){ return HERO_MINI_STAGES[Number(total)] || null; }
function heroMiniRange(from, to, total){
  const st = heroMiniStages(total) || [];
  const bits = [];
  for(let n=from; n<=to; n++){ const x = st[n-1]; if(x) bits.push("scene "+n+" is "+x[2]+" (act "+x[1]+")"); }
  return "scenes "+from+(to>from?"–"+to:"")+" of this "+total+"-scene journey, one stage each: "+bits.join("; ");
}
window.heroMiniStages = heroMiniStages;

const FRAMEWORKS = [
  { id:"threeact", label:"Three-Act Turns", badge:"Three-Act", icon:"graph",
    blurb:"Conflict-driven. Every scene turns a value.",
    acts:{ 1:"Setup", 2:"Complication", 3:"Resolution" },
    kinds:{ hook:"Hook", incite:"Inciting Incident", "act-climax":"Act Climax", pinch:"Pinch Point",
            midpoint:"Mid-Act Climax", crisis:"Crisis", "story-climax":"Story Climax", resolution:"Resolution" },
    // the Inspector's kind dropdown (Hook + Pinch Point added 2026-09-25 by owner)
    kindOpts:[["normal","Scene"],["hook","Hook"],["incite","Inciting Incident"],["act-climax","Act Climax"],
      ["pinch","Pinch Point"],["midpoint","Mid-Act Climax"],["crisis","Crisis"],["story-climax","Story Climax"],["resolution","Resolution"]],
    /* each structural beat's JOB — rides into the scene writer's prompt (unattributed craft) */
    jobs:{
      hook:"open in motion and plant a question the audience needs answered; intrigue before explanation, no throat-clearing exposition.",
      incite:"an onscreen event that radically upsets the balance of the protagonist's life and launches the quest; it promises the confrontation the Story Climax must pay off.",
      "act-climax":"a major reversal that closes the act and changes the protagonist's situation beyond return; it must hit harder than any scene before it.",
      pinch:"the antagonistic force shows its power and what is at stake; a reminder of the danger that raises the pressure toward the next turn.",
      midpoint:"the true nature of the conflict is revealed; the protagonist stops reacting and starts acting on the new truth.",
      crisis:"the protagonist faces the ultimate dilemma under maximum pressure: irreconcilable goods or the lesser of two evils; the choice reveals who they truly are.",
      "story-climax":"the decisive, irreversible action that settles the central conflict and pays off the inciting incident's promise; the change it causes is absolute.",
      resolution:"the aftermath: show the new normal the climax created; brief and resonant, no new conflict." },
    peakKinds:["incite","act-climax","midpoint","crisis","story-climax"],
    audit:{
      rule:classicTurnRule(["resolution"]),
      ...PROGRESSION_COPY,
      okTitle:"This scene turns", flagTitle:"This scene doesn't turn",
      okBadge:"Turns", flagBadge:"No turn",
      subline:"If a scene doesn't turn, cut it", flagIcon:"scissors",
      tableTitle:"Turn audit · every scene turns; the Resolution may settle",
      flagDetail:"If a scene doesn't turn a value, it's exposition — recharge it or cut it.",
      analysisTurned:" — the value has reversed. The scene turns.",
      analysisFlat:" — unchanged. Flat exposition.",
      // the big-beat kinds whose peaks the Doctor checks for softness
      bigKinds:["midpoint","story-climax","act-climax","crisis"] },
    doctorCriteria:"flag scenes that open and close on the same charge; strengthen weak act climaxes",
    beatVocab:{ turnLabel:"the turn" },
    /* research-stage synopsis shape (pipeline Step 2) — TODAY'S three paragraphs, frozen */
    synopsis:{ shapeName:"classic design shape", paras:[
      { key:"setup",         label:"The Setup",                       guide:"the world, the protagonist and the inciting situation." },
      { key:"confrontation", label:"The Confrontation / Complication", guide:"escalating conflict, the midpoint turn, mounting stakes and cost." },
      { key:"resolution",    label:"The Resolution",                  guide:"crisis, climax, and the irreversible final change." } ] } },

  { id:"kishotenketsu", label:"Kishōtenketsu", badge:"Kishōtenketsu", icon:"layers",
    blurb:"Four movements. The twist recontextualizes — no clash required.",
    acts:{ 1:"Ki — Introduction", 2:"Shō — Development", 3:"Ten — Twist", 4:"Ketsu — Reconciliation" },
    kinds:{ plant:"Planting", deepen:"Deepening", ten:"The Twist",
            "re-read":"Recontextualization", ketsu:"Reconciliation",
            // legacy three-act kinds still label sensibly if they appear
            incite:"Planting", "act-climax":"Deepening", midpoint:"Deepening",
            crisis:"The Twist", "story-climax":"Recontextualization", resolution:"Reconciliation" },
    kindOpts:[["normal","Scene"],["plant","Planting"],["deepen","Deepening"],["ten","The Twist"],
      ["re-read","Recontextualization"],["ketsu","Reconciliation"]],
    jobs:{
      plant:"plant the world, a person or a charged image without forcing conflict; establish, don't argue.",
      deepen:"develop what was planted and let it accumulate meaning; drift, don't clash.",
      ten:"the twist: one recontextualizing revelation or shift of perspective that makes everything before it read differently; not a fight, not an escalation.",
      "re-read":"let the new understanding reframe what came before; show earlier images in their new light.",
      ketsu:"reconcile the pattern with the twist; settle into calm and resonance, not victory." },
    peakKinds:["ten"],
    audit:{
      /* Deterministic layer only (the semantic "does the ten re-read everything?"
         question belongs to the Story Doctor — Plan Phase 3). Band-aware:
         ki/shō (acts 1–2) pass unless INERT (zero movement on a flat charge);
         the TEN (act 3) must break the pattern with a sign reversal (a same-side jump
         of 2+ is a progression — softer); ketsu (act 4) is exempt, like three-act's
         resolution. */
      rule:(sc)=>{
        const act = Number(sc.act)||1;
        const delta = Math.abs((sc.closeCharge||0) - (sc.openCharge||0));
        if(act>=4 || sc.kind==="ketsu" || sc.kind==="resolution") return { turned:true, flagged:false, exempt:true, status:"exempt" };
        if(act===3){ const t = chargeTurn(sc.openCharge, sc.closeCharge);
          return { turned:t.turned, progression:t.progression, flagged:!t.turned && !t.progression, exempt:false,
            status: t.turned ? "turn" : t.progression ? "progression" : "flat" }; }
        const inert = delta===0 && Math.abs(sc.closeCharge||0)<=0;
        return { turned:!inert, flagged:inert, exempt:false, status: inert ? "flat" : "turn" };
      },
      progTitle:"The twist only intensifies", progBadge:"Progresses",
      progDetail:"The ten should break the pattern with a reversal; this one intensifies on the same side.",
      analysisProg:" — intensified, not reversed. The ten should break the pattern.",
      okTitle:"This scene carries its movement", flagTitle:"This scene is inert",
      okBadge:"Moves", flagBadge:"Inert",
      subline:"Ki plants · Shō deepens · Ten re-reads everything · Ketsu reconciles",
      tableTitle:"Movement audit · Ki and Shō move, the Ten reverses, the Ketsu may settle",
      flagIcon:"alert",
      flagDetail:"A ki/shō scene must plant or deepen something; the ten must break the pattern. Give it movement — or fold it into its neighbour.",
      analysisTurned:" — the movement lands. The scene carries its weight in the pattern.",
      analysisFlat:" — inert. It neither plants, deepens, nor shifts — fold it into a neighbour or give it something to plant." },
    doctorCriteria:"the ten must make the reader re-read every scene before it — audit it as a question, not arithmetic; flag shō scenes that repeat instead of deepen; the ketsu must reconcile, not defeat",
    beatVocab:{ turnLabel:"the re-read" },
    /* spine-builder grammar (Phase 2): two batched calls — ki+shō, then ten+ketsu.
       The ten is a RECONTEXTUALIZATION; the prompts forbid conflict-escalation. */
    spine:{
      intro:(total)=>"You are a story architect designing the "+total+"-scene spine of a KISHŌTENKETSU story with the Infinite Studio AI method — four movements: KI (introduction), SHŌ (development), TEN (twist/recontextualization), KETSU (reconciliation). Conflict is OPTIONAL; the engine is curiosity and the re-read, never a battle. ",
      firstRange:(firstN,total)=>"scenes 1–"+firstN+": the KI (plant the world, people and charged images — establish without forcing conflict) and the SHŌ (develop and deepen what was planted; let it breathe and accumulate meaning)",
      secondRange:(firstN,total)=>"scenes "+(firstN+1)+"–"+total+": the TEN (the twist — ONE recontextualizing revelation or perspective shift that makes the audience RE-READ everything before it; NOT a fight, NOT an escalation) and the KETSU (the reconciliation — settle the new understanding; calm and resonance, not victory)",
      sceneRule:"Every scene MOVES: ki scenes plant a charged image or question; shō scenes deepen it (charges may drift, not clash); the ten scene SHIFTS the pattern hard (a charge sign reversal); ketsu scenes settle. ",
      closer:"Continue naturally; the ten recontextualizes, the ketsu reconciles. ",
      actSpec:"a=act 1-4 (1=ki, 2=shō, 3=ten, 4=ketsu)",
      // DECLARED STAGES (approved 2026-09-25 by owner): the spine tags each scene with the
      // stage it actually plays; assignPlotPoints trusts valid tags over positional guesses
      stages:["plant","deepen","ten","re-read","ketsu"], stageRepeat:["re-read"], stageMust:["ten"] },
    authorBrief:"FRAMEWORK: Kishōtenketsu — beats PRESENT and DEEPEN rather than clash; a scene's movement is a shift in understanding or pattern, not a conflict won or lost; the value charges trace mood and meaning, not victory.",
    synopsis:{ shapeName:"kishōtenketsu's four movements — conflict is optional; the engine is curiosity and the re-read", paras:[
      { key:"ki",    label:"Ki — Introduction",     guide:"the world, people and charged images, planted without forcing conflict." },
      { key:"sho",   label:"Shō — Development",     guide:"what was planted deepens and accumulates meaning; let it breathe." },
      { key:"ten",   label:"Ten — The Twist",       guide:"ONE recontextualizing revelation or perspective shift that makes everything before it re-read — not a fight, not an escalation." },
      { key:"ketsu", label:"Ketsu — Reconciliation", guide:"the new understanding settles; calm and resonance, not victory." } ] } },

  /* Hero's Journey — the mythic round (approved by owner, 2026-06-12). A
     three-act SKIN: the turn rule is the classic one; what changes is the act
     names (Departure / Initiation / Return), the twelve stage milestones and
     the builder's grammar. */
  { id:"herosjourney", label:"Hero's Journey", badge:"Hero's Journey", icon:"target",
    blurb:"Twelve mythic stages. The hero leaves, transforms, returns.",
    acts:{ 1:"Departure", 2:"Initiation", 3:"Return" },
    kinds:{ "ordinary-world":"Ordinary World", call:"Call to Adventure", refusal:"Refusal of the Call",
            mentor:"Meeting the Mentor", threshold:"Crossing the Threshold", belly:"Belly of the Whale",
            tests:"Tests, Allies, Enemies",
            approach:"Approach to the Inmost Cave", ordeal:"The Ordeal", reward:"The Reward",
            "road-back":"The Road Back", rescue:"Rescue from Without", resurrection:"Resurrection", elixir:"Return with the Elixir",
            // legacy three-act kinds still label sensibly if they appear
            incite:"Call to Adventure", "act-climax":"Crossing the Threshold", midpoint:"The Ordeal",
            crisis:"The Road Back", "story-climax":"Resurrection", resolution:"Return with the Elixir" },
    kindOpts:[["normal","Scene"],["ordinary-world","Ordinary World"],["call","Call to Adventure"],
      ["refusal","Refusal of the Call"],["mentor","Meeting the Mentor"],["threshold","Crossing the Threshold"],
      ["belly","Belly of the Whale"],
      ["tests","Tests, Allies, Enemies"],["approach","Approach to the Inmost Cave"],["ordeal","The Ordeal"],
      ["reward","The Reward"],["road-back","The Road Back"],["rescue","Rescue from Without"],["resurrection","Resurrection"],
      ["elixir","Return with the Elixir"]],
    // Belly of the Whale + Rescue from Without: optional stages from the original
    // seventeen (added 2026-09-25 by owner) — dropdown only, never assigned by position
    jobs:{
      "ordinary-world":"the hero's everyday life, its limits and the flaw the journey will test, so the change ahead can be measured.",
      call:"a disruption breaks the ordinary world's balance and offers a mission only this hero can take.",
      refusal:"the hero hesitates or refuses; fear, duty or doubt shows what the journey will cost and raises the stakes.",
      mentor:"a guide gives the hero what they need to go on: knowledge, a tool, or the push of belief.",
      threshold:"the point of no return: the hero commits and crosses into the unfamiliar world; the old life can't be recovered.",
      belly:"just past the threshold, the hero's first brush with death or annihilation; the old self begins to dissolve.",
      tests:"the hero learns the new world's rules, gains allies and meets enemies; at least one test is failed.",
      approach:"the hero prepares for the central confrontation and closes in on the place of greatest danger.",
      ordeal:"the central crisis: everything goes wrong, a brush with death, failure or loss that forces a symbolic death and rebirth.",
      reward:"having survived the ordeal, the hero seizes the prize (knowledge, an object, a reconciliation), but the journey is not over.",
      "road-back":"the consequences of taking the prize pursue the hero; the escape or recommitment toward home begins.",
      rescue:"at the edge of defeat the hero is saved by an ally or an outside force; proof they cannot finish alone.",
      resurrection:"the final, hardest test, where the hero must use everything learned; a last death-and-rebirth that proves the change.",
      elixir:"the hero returns changed, bringing something that heals or transforms their world; the circle closes." },
    peakKinds:["threshold","ordeal","road-back","resurrection"],
    audit:{
      // the classic turn rule — the journey is conflict-driven; the elixir is exempt
      rule:classicTurnRule(["elixir","resolution"]),
      ...PROGRESSION_COPY,
      okTitle:"This scene turns", flagTitle:"This scene doesn't turn",
      okBadge:"Turns", flagBadge:"No turn",
      subline:"Depart · Initiate · Return — every stage turns",
      tableTitle:"Turn audit · every stage turns; the Return with the Elixir may settle",
      flagIcon:"scissors",
      flagDetail:"If a scene doesn't turn a value, it's exposition — recharge it or cut it.",
      analysisTurned:" — the value has reversed. The scene turns.",
      analysisFlat:" — unchanged. Flat exposition.",
      bigKinds:["threshold","ordeal","road-back","resurrection"] },
    doctorCriteria:"the ordeal must cost something real; the resurrection must prove the change the journey bought; flag a refusal that doesn't raise the stakes",
    beatVocab:{ turnLabel:"the turn" },
    spine:{
      intro:(total)=>"You are a story architect designing the "+total+"-scene spine of a HERO'S JOURNEY story with the Infinite Studio AI method — the mythic round in three phases: DEPARTURE (the hero leaves the ordinary world), INITIATION (trials, the ordeal at the journey's heart, the reward), RETURN (the road back, resurrection, the elixir brought home). ",
      // a spine of 4 scenes or fewer (a commercial) gets the MINIMUM journey, stage by
      // stage (heroMiniStages below) — the same stages assignPlotPoints labels
      firstRange:(firstN,total)=> heroMiniStages(total) ? heroMiniRange(1, firstN, total)
        : "scenes 1–"+firstN+": the DEPARTURE (ordinary world, the call to adventure, a refusal, meeting the mentor, crossing the threshold) and the opening trials of the INITIATION (tests, allies and enemies; approaching the inmost cave)",
      secondRange:(firstN,total)=> heroMiniStages(total) ? heroMiniRange(firstN+1, total, total)
        : "scenes "+(firstN+1)+"–"+total+": the heart of the INITIATION (the ORDEAL — a death-and-rebirth at the journey's center — then the reward and the road back) and the RETURN (the RESURRECTION — the final, hardest test, proving the change — and the return with the elixir)",
      sceneRule:"Each scene must TURN its value: the closing charge has the opposite sign of the opening charge. Alternate positive/negative for rhythm. Frame beats as stages of the journey — calls, thresholds, ordeals, transformation — and make every trial COST something. ",
      closer:(total)=> heroMiniStages(total) ? "Continue naturally; the last scene brings the hero home changed, carrying what the journey bought. "
        : "Continue naturally; the resurrection is the hardest test, and the elixir shows what the journey bought. ",
      actSpec:"a=act 1-3 (1=departure, 2=initiation, 3=return)",
      // DECLARED STAGES (approved 2026-09-25 by owner) — Belly of the Whale and Rescue from
      // Without stay hand-picked only, so they are not offered to the model
      stages:["ordinary-world","call","refusal","mentor","threshold","tests","approach","ordeal","reward","road-back","resurrection","elixir"],
      stageMust:["threshold","ordeal"] },
    authorBrief:"FRAMEWORK: Hero's Journey — beats are stages of the mythic round: calls, refusals, thresholds, ordeals, resurrection; the value charges trace the descent and the return, and what each trial costs.",
    synopsis:{ shapeName:"the mythic round in three phases", paras:[
      { key:"departure",  label:"The Departure",  guide:"the ordinary world, the call to adventure, a refusal, the mentor, and crossing the threshold." },
      { key:"initiation", label:"The Initiation", guide:"tests, allies and enemies; the approach to the inmost cave; the ORDEAL at the journey's heart and what it costs; the reward and the road back." },
      { key:"return",     label:"The Return",     guide:"the resurrection — the final, hardest test, proving the change — and the return with the elixir." } ] } },

  /* Story Circle — eight steps around the wheel (approved by owner, 2026-06-12;
     RETIRED 2026-09-25 by owner). No longer offered for new stories: it is left out of
     the New Story picker, the shape recommendation and every framework list. The entry
     stays only so a film already built on it keeps its four act bands and labels. */
  { id:"storycircle", retired:true, label:"Story Circle", badge:"Story Circle", icon:"history",
    blurb:"Eight steps. Descend for what you need, pay, come back changed.",
    acts:{ 1:"You & Need", 2:"Go & Search", 3:"Find & Take", 4:"Return & Change" },
    kinds:{ you:"Comfort Zone", need:"The Need", go:"Crossing Over", search:"The Search",
            find:"The Find", take:"The Price", "return":"The Road Home", change:"Changed",
            // legacy three-act kinds still label sensibly if they appear
            incite:"The Need", "act-climax":"Crossing Over", midpoint:"The Find",
            crisis:"The Price", "story-climax":"The Road Home", resolution:"Changed" },
    kindOpts:[["normal","Scene"],["you","Comfort Zone"],["need","The Need"],["go","Crossing Over"],
      ["search","The Search"],["find","The Find"],["take","The Price"],["return","The Road Home"],
      ["change","Changed"]],
    jobs:{
      you:"the character in their comfort zone: who they are before anything happens.",
      need:"a want disturbs the comfort; something they lack and now pursue.",
      go:"they cross into an unfamiliar situation where the rules change.",
      search:"they adapt to the unfamiliar world and struggle with its rules.",
      find:"they get what they wanted, or find what they truly need.",
      take:"they pay a heavy price for what they found; the gain costs something real.",
      "return":"they head back toward the familiar world, carrying what the price taught them.",
      change:"back where they began, visibly changed: master of both worlds." },
    peakKinds:["go","find","take","return"],
    audit:{
      // the classic turn rule — the circle runs on want and cost; "changed" is exempt
      rule:classicTurnRule(["change","resolution"]),
      ...PROGRESSION_COPY,
      okTitle:"This scene turns", flagTitle:"This scene doesn't turn",
      okBadge:"Turns", flagBadge:"No turn",
      subline:"You · Need · Go · Search · Find · Take · Return · Change",
      tableTitle:"Turn audit · every step turns; Changed may settle",
      flagIcon:"scissors",
      flagDetail:"If a scene doesn't turn a value, it's exposition — recharge it or cut it.",
      analysisTurned:" — the value has reversed. The scene turns.",
      analysisFlat:" — unchanged. Flat exposition.",
      bigKinds:["go","find","take","return"] },
    doctorCriteria:"the take must exact a real price for the find; the change must be measurable against scene one's comfort; flag a search that doesn't adapt",
    beatVocab:{ turnLabel:"the turn" },
    spine:{
      intro:(total)=>"You are a story architect designing the "+total+"-scene spine of a STORY CIRCLE story with the Infinite Studio AI method — eight steps around the wheel: a character in a zone of COMFORT (you) WANTS something (need), enters an UNFAMILIAR situation (go), ADAPTS to it (search), GETS what they wanted (find), PAYS a heavy price for it (take), RETURNS to the familiar (return), having CHANGED (change). The top of the circle is order; the bottom is chaos. ",
      firstRange:(firstN,total)=>"scenes 1–"+firstN+": the top of the circle — YOU and NEED (act 1: establish the comfort zone and the want that disturbs it) then GO and SEARCH (act 2: crossing into the unfamiliar and adapting to its rules, road-of-trials style)",
      secondRange:(firstN,total)=>"scenes "+(firstN+1)+"–"+total+": the bottom of the circle and home — FIND and TAKE (act 3: getting what they wanted and paying its true, heavy price) then RETURN and CHANGE (act 4: coming back to the familiar world changed, master of both)",
      sceneRule:"Each scene must TURN its value: the closing charge has the opposite sign of the opening charge. Alternate positive/negative for rhythm. The descent into the unfamiliar always costs — every gain in the bottom half carries a price. ",
      closer:"Continue naturally; the take exacts the price, the return proves the change. ",
      actSpec:"a=act 1-4 (1=you/need, 2=go/search, 3=find/take, 4=return/change)" },
    authorBrief:"FRAMEWORK: Story Circle — beats descend into the unfamiliar and climb back out: need, search, find, take, return, change; every gain carries a price and the value charges trace what it costs.",
    synopsis:{ shapeName:"the story circle — a descent for what they need and a return at a price", paras:[
      { key:"comfort", label:"You & Need",      guide:"the comfort zone, who they are in it, and the want that disturbs it." },
      { key:"descent", label:"Go & Search",     guide:"crossing into the unfamiliar and adapting to its rules." },
      { key:"price",   label:"Find & Take",     guide:"getting what they wanted and paying its true, heavy price." },
      { key:"home",    label:"Return & Change", guide:"coming home to the familiar world changed, master of both." } ] } },
];
window.FRAMEWORKS = FRAMEWORKS;
/* the frameworks a writer can choose for a new story (retired ones only keep old films working) */
function frameworkChoices(){ return FRAMEWORKS.filter(f=>!f.retired); }
/* a framework id a NEW story may use: a retired or unknown id falls back to the default */
function choosableFrameworkId(id){ return frameworkChoices().some(f=>f.id===id) ? id : FRAMEWORKS[0].id; }
window.frameworkChoices = frameworkChoices; window.choosableFrameworkId = choosableFrameworkId;

/* normalize project.framework (registry id, anything else, or nothing) to a
   registry entry. Default: threeact — every existing project keeps its behavior. */
function frameworkOf(project){
  const raw = ((project && project.framework) || "").toString().toLowerCase();
  return FRAMEWORKS.find(f=>f.id===raw) || FRAMEWORKS[0];
}
window.frameworkOf = frameworkOf;

/* helpers — the only way other files read framework behavior. Both read the
   CURRENT project via window.turnProject (set by app.jsx), so call sites that
   have no project param (turnInfo, KIND_LABEL lookups) keep their signatures. */
function fwAuditOf(){ return frameworkOf(window.turnProject).audit; }
function fwActName(act){ return frameworkOf(window.turnProject).acts[act] || ("Act "+act); }
function fwKindLabel(kind){ return frameworkOf(window.turnProject).kinds[kind]; }
function fwKindOpts(){ return frameworkOf(window.turnProject).kindOpts; }
function fwActNos(){ return Object.keys(frameworkOf(window.turnProject).acts).map(Number); }
window.fwAuditOf = fwAuditOf; window.fwActName = fwActName; window.fwKindLabel = fwKindLabel;
window.fwKindOpts = fwKindOpts; window.fwActNos = fwActNos;

/* STRUCTURAL ROLE (approved 2026-09-25 by owner) — tells the scene writer where this
   scene sits and what its structural beat must DO: act and position, the act's job
   (the framework's synopsis guide for that movement), the beat's job, and a pacing
   note from the nested hierarchy (peaks hit hardest; the approach tightens; the
   aftermath breathes). Plain text for the prompt; "" when the scene has no place yet. */
function fwStructuralRole(scene, scenes, project){
  if(!scene) return "";
  const fw = frameworkOf(project || window.turnProject);
  const list = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(scenes||[]) : (scenes||[]).slice();
  const i = list.findIndex(s=>s && s.id===scene.id), total = list.length;
  const act = Number(scene.act)||0;
  const lines = [];
  const where = [act ? ("Act "+act+(fw.acts[act] ? " \u2014 "+fw.acts[act] : "")) : "",
    (i>=0 && total) ? ("scene "+(i+1)+" of "+total+" (~"+Math.round(((i+0.5)/total)*100)+"% through the story)") : ""].filter(Boolean).join(", ");
  if(where) lines.push("STRUCTURAL ROLE: "+where+".");
  const para = act && fw.synopsis && fw.synopsis.paras ? fw.synopsis.paras[act-1] : null;
  if(para && para.guide) lines.push("This movement's job: "+para.guide);
  const kind = scene.kind && scene.kind!=="normal" ? scene.kind : "";
  const label = kind ? fw.kinds[kind] : "";
  const job = kind && fw.jobs ? fw.jobs[kind] : "";
  if(label) lines.push("This scene is the "+label.toUpperCase()+(job ? ": "+job : "."));
  else if(scene.plot) lines.push("Its place in the movement: "+scene.plot+".");
  const peaks = fw.peakKinds || (fw.audit && fw.audit.bigKinds) || [];
  const isPeak = (s)=> !!(s && peaks.indexOf(s.kind)>=0);
  if(isPeak(scene)) lines.push("PACING: a structural peak \u2014 it must hit harder than anything before it; make its turn decisive.");
  else if(i>=0 && isPeak(list[i+1])) lines.push("PACING: the next scene is a structural peak \u2014 tighten and compress; shorter exchanges, rising tempo.");
  else if(i>0 && isPeak(list[i-1])) lines.push("PACING: this scene follows a major peak \u2014 give the audience room to breathe before the next climb.");
  return lines.length ? lines.join("\n")+"\n" : "";
}
window.fwStructuralRole = fwStructuralRole;
