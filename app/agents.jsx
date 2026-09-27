/* agents.jsx — bounded-loop AI agents for Cinema Machine.
   Each agent is an async function run(ctx) that:
     • works on ctx.model — a live working copy { scenes, beats, continuity, drafts }
     • emits reasoning steps via ctx.emit({k, t})   (k = plan|act|observe|flag|ok|done)
     • proposes changes via  await ctx.propose({...}) -> true(approved)|false(rejected)
       (on approval the agent mutates ctx.model then calls ctx.sync())
   Loops are BOUNDED (hard step caps) with deterministic fallbacks, so an
   unparseable model response degrades gracefully instead of hanging.

   ctx = {
     model, sync(), emit(step), propose(card)->Promise<bool>,
     project, facts, cancelled()->bool,
     ai: { available, suggestTurn, plantLine, tableRead, buildSpine, authorScene, draftScene }
   }
*/

/* ---- shared spine analysis (deterministic) ---- */
/* derive the major plot-point kinds from position in the FRAMEWORK's structure:
   three-act gets the classic labels (Inciting Incident, Act Climax, Midpoint,
   Crisis, Story Climax, Resolution); Kishōtenketsu gets its movements (Planting,
   Deepening, The Twist, Recontextualization, Reconciliation). */
/* the stages the spine DECLARED (scene._stage). Keeps the LONGEST run of real stages of
   this framework in canonical order (a stray, out-of-order tag is dropped instead of
   poisoning the tags after it), each stage once unless the framework lets it repeat, and
   only when that run covers the must-have stages; otherwise null = positional fallback */
function acceptDeclaredStages(fw, scenes){
  const sp = fw && fw.spine;
  if(!sp || !Array.isArray(sp.stages)) return null;
  const order = sp.stages, repeat = sp.stageRepeat || [];
  const tagged = [];
  scenes.forEach((s,i)=>{ const k = String((s && s._stage) || "").toLowerCase().trim(), at = order.indexOf(k);
    if(at>=0) tagged.push({ i, k, at }); });
  if(!tagged.length) return null;
  const follows = (a,b)=> b.at>a.at || (b.at===a.at && repeat.includes(b.k));
  // score = [stages kept, must-have stages kept]: the longest run wins, and between equally
  // long runs the one holding the must-have stages (a stray Elixir loses to the Ordeal)
  const must = sp.stageMust || [];
  const better = (p,q)=> p[0]>q[0] || (p[0]===q[0] && p[1]>q[1]);
  const score = tagged.map(t=>[1, must.includes(t.k)?1:0]), prev = tagged.map(()=>-1);
  for(let x=0; x<tagged.length; x++) for(let y=0; y<x; y++){
    if(!follows(tagged[y],tagged[x])) continue;
    const cand = [score[y][0]+1, score[y][1]+(must.includes(tagged[x].k)?1:0)];
    if(better(cand, score[x])){ score[x]=cand; prev[x]=y; }
  }
  let end = 0; score.forEach((sc,x)=>{ if(better(sc, score[end])) end = x; });
  const out = scenes.map(()=>null), used = new Set();
  for(let x=end; x>=0; x=prev[x]){ out[tagged[x].i] = tagged[x].k; used.add(tagged[x].k); }
  return must.every(k=>used.has(k)) ? out : null;
}
function assignPlotPoints(scenes){
  // a model/writer-declared Inciting Incident survives the mechanical re-assignment —
  // the Doctor's placement audit then checks a REAL declaration, not this function's
  // positional guess (three-act only; other frameworks keep their own grammar)
  const declaredIncite = scenes.findIndex(s=>s.kind==="incite");
  const fwD = (typeof frameworkOf==="function") ? frameworkOf(window.turnProject) : null;
  const declared = acceptDeclaredStages(fwD, scenes);
  scenes.forEach(s=>{ s.kind = "normal"; s.plot = ""; });
  const idxByAct = (act)=> scenes.map((s,i)=>s.act===act?i:-1).filter(i=>i>=0);
  const set = (i,k)=>{ if(i>=0 && i<scenes.length) scenes[i].kind = k; };
  const fw = (typeof frameworkOf==="function") ? frameworkOf(window.turnProject) : null;
  if(fw && fw.id==="herosjourney"){
    // 4 scenes or fewer: the minimum journey, stage by stage (frameworks.jsx), matching
    // exactly what the spine prompt asked for
    const mini = (typeof heroMiniStages==="function") ? heroMiniStages(scenes.length) : null;
    if(mini || declared){
      // a tiny journey uses its fixed table; otherwise the stages the spine declared
      scenes.forEach((s,i)=>{ const k = mini ? (mini[i] && mini[i][0]) : declared[i]; if(k) s.kind = k; });
      scenes.forEach(s=>{ if(s.kind!=="normal") return; s.plot = s.act===1 ? "Departure" : s.act===2 ? "Trials" : "Return"; });
      return scenes;
    }
    const h1=idxByAct(1), h2=idxByAct(2), h3=idxByAct(3);
    const used = new Set();
    const mark = (i,k)=>{ if(i>=0 && !used.has(i)){ set(i,k); used.add(i); } };
    if(h1.length){
      mark(h1[0],"ordinary-world");
      if(h1.length>=2) mark(h1[h1.length-1],"threshold");
      // the scenes between the ordinary world and the threshold carry the call, the
      // refusal and the mentor, in story order and end-aligned; when there's no room
      // for all three the mentor outranks the refusal (it used to be dropped whenever
      // the Departure had fewer than six scenes)
      const between = h1.slice(1, -1);
      const stages = between.length>=3 ? ["call","refusal","mentor"] : between.length===2 ? ["call","mentor"] : between.length===1 ? ["call"] : [];
      const slots = between.slice(between.length - stages.length);
      stages.forEach((k,j)=>mark(slots[j],k));
    }
    if(h2.length){
      const mid = h2[Math.floor((h2.length-1)/2)];
      mark(mid,"ordeal");
      if(h2.length>=2) mark(h2[h2.length-1],"road-back");
      if(h2.length>=3) mark(h2[0],"tests");
      const mi = h2.indexOf(mid);
      if(mi>0) mark(h2[mi-1],"approach");
      if(mi>=0 && mi<h2.length-1) mark(h2[mi+1],"reward");
    }
    if(h3.length===1) mark(h3[0],"resurrection");
    else if(h3.length>=2){ mark(h3[h3.length-1],"elixir"); mark(h3[h3.length-2],"resurrection"); }
    scenes.forEach(s=>{ if(s.kind!=="normal") return;
      s.plot = s.act===1 ? "Departure" : s.act===2 ? "Trials" : "Return"; });
    return scenes;
  }
  if(fw && fw.id==="storycircle"){
    const c1=idxByAct(1), c2=idxByAct(2), c3=idxByAct(3), c4=idxByAct(4);
    if(c1.length){ set(c1[0],"you"); if(c1.length>=2) set(c1[c1.length-1],"need"); }
    if(c2.length){ set(c2[0],"go"); if(c2.length>=2) set(c2[c2.length-1],"search"); }
    if(c3.length===1) set(c3[0],"take");
    else if(c3.length>=2){ set(c3[0],"find"); set(c3[c3.length-1],"take"); }
    if(c4.length){ if(c4.length>=2) set(c4[0],"return"); set(c4[c4.length-1],"change"); }
    scenes.forEach(s=>{ if(s.kind!=="normal") return;
      s.plot = s.act===1 ? "Comfort" : s.act===2 ? "Searching" : s.act===3 ? "The Price" : "Coming Home"; });
    return scenes;
  }
  if(fw && fw.id==="kishotenketsu"){
    const k1=idxByAct(1), k2=idxByAct(2), k3=idxByAct(3), k4=idxByAct(4);
    if(declared){ declared.forEach((k,i)=>{ if(k) set(i,k); }); }
    else{
      if(k1.length) set(k1[0],"plant");
      if(k2.length) set(k2[k2.length-1],"deepen");
      if(k3.length){ set(k3[0],"ten"); k3.slice(1).forEach(i=>set(i,"re-read")); }
      if(k4.length) set(k4[k4.length-1],"ketsu");
    }
    scenes.forEach(s=>{ if(s.kind!=="normal") return;
      s.plot = s.act===1 ? "Planting" : s.act===2 ? "Deepening" : s.act===3 ? "Re-reading" : "Settling"; });
    return scenes;
  }
  const a1 = idxByAct(1), a2 = idxByAct(2), a3 = idxByAct(3);
  let inciteIdx=declaredIncite, midIdx=-1;
  if(inciteIdx>=0) set(inciteIdx,"incite");
  // Act I: inciting incident (a declared one wins; else positional mid/late) + act climax (end)
  if(a1.length){
    const climax1 = a1[a1.length-1];
    if(inciteIdx<0){
      const incite = a1.length>=2 ? a1[Math.max(0, Math.ceil(a1.length/2)-1)] : -1;
      if(incite>=0 && incite!==climax1){ set(incite,"incite"); inciteIdx=incite; }
    }
    if(climax1!==inciteIdx) set(climax1, (a1.length>=2 || inciteIdx>=0) ? "act-climax" : "incite");
  }
  // Act II: midpoint (middle) + act climax (end)
  if(a2.length){
    const climax2 = a2[a2.length-1];
    const mid = a2.length>=3 ? a2[Math.floor((a2.length-1)/2)] : -1;
    if(mid>=0 && mid!==climax2){ set(mid,"midpoint"); midIdx=mid; }
    set(climax2,"act-climax");
  }
  // Act III: crisis, story climax, resolution
  if(a3.length===1){ set(a3[0],"story-climax"); }
  else if(a3.length===2){ set(a3[0],"story-climax"); set(a3[1],"resolution"); }
  else if(a3.length>=3){
    set(a3[a3.length-3],"crisis");
    set(a3[a3.length-2],"story-climax");
    set(a3[a3.length-1],"resolution");
  }
  // HOOK + PINCH POINTS (added 2026-09-25 by owner): scene 1 hooks when it has no
  // other structural job; with a full second act (10+ scenes) a pinch point sits
  // between the Act I climax and the midpoint, and another between the midpoint and
  // the Act II climax — the antagonistic force showing its power
  if(scenes.length && scenes[0].kind==="normal") set(0,"hook");
  if(scenes.length>=10 && a2.length && midIdx>=0){
    const endI = a1.length ? a1[a1.length-1] : -1, endII = a2[a2.length-1];
    const between = (lo,hi)=>{
      const open = scenes.map((_,i)=>i).filter(i=>i>lo && i<hi && scenes[i].kind==="normal");
      return open.length ? open[Math.floor((open.length-1)/2)] : -1;
    };
    set(between(endI, midIdx),"pinch");
    set(between(midIdx, endII),"pinch");
  }
  // secondary Title-Case labels for the remaining (non-major) scenes
  scenes.forEach((s,i)=>{
    if(s.kind!=="normal") return;
    if(s.act===1){
      s.plot = (inciteIdx>=0 && i<inciteIdx) ? "Exposition" : "Rising Action";
    } else if(s.act===2){
      if(midIdx<0) s.plot = "Rising Action";
      else if(i<midIdx) s.plot = "Rising Action";
      else if(i===midIdx+1) s.plot = "Reversal";
      else s.plot = "Complication";
    } else {
      const a3 = idxByAct(3);
      s.plot = (i===a3[0]) ? "Low Point" : "Falling Action";
    }
  });
  return scenes;
}
window.assignPlotPoints = assignPlotPoints;

/* the audit rule is the FRAMEWORK's (frameworks.jsx via window.turnInfo) — no
   second copy of the three-act arithmetic here; inline body = safety fallback */
function sd_turnInfo(s){
  if(typeof window.turnInfo==="function"){ try{ return window.turnInfo(s); }catch(e){} }
  const t = (typeof chargeTurn==="function") ? chargeTurn(s.openCharge, s.closeCharge)
    : { turned: Math.sign(s.openCharge)*Math.sign(s.closeCharge) < 0, progression:false };
  const exempt = s.kind==="resolution";
  return { turned:t.turned, progression:t.progression, flagged: !t.turned && !t.progression && !exempt };
}
function auditSpine(scenes){
  const issues = [];
  // 1) scenes that don't turn (highest priority)
  const _kisho = (typeof frameworkOf==="function") && frameworkOf(window.turnProject).id==="kishotenketsu";
  scenes.forEach(s=>{ if(sd_turnInfo(s).flagged)
    issues.push({ kind:"noturn", sceneId:s.id, sceneNo:s.no, sev:2,
      msg: _kisho
        ? '"'+s.title+'" sits flat ('+chargeStr(s.openCharge)+" \u2192 "+chargeStr(s.closeCharge)+") \u2014 it neither plants, deepens, nor shifts the pattern. It's inert."
        : '"'+s.title+'" moves '+chargeStr(s.openCharge)+" \u2192 "+chargeStr(s.closeCharge)+" without reversing its value \u2014 it doesn't turn." }); });
  // 2) flat peaks — framework-specific. Three-act: a big-beat scene that lands
  // soft. Kishōtenketsu: only the TEN must land hard — a soft ten can't re-read
  // anything (ki/shō scenes are ALLOWED to be quiet).
  if(_kisho){
    scenes.forEach(s=>{
      const isTen = s.kind==="ten" || (Number(s.act)===3 && ["crisis","story-climax"].includes(s.kind));
      const t = (typeof chargeTurn==="function") ? chargeTurn(s.openCharge, s.closeCharge) : { turned:false, progression:false };
      // a flat ten is already a "noturn"; a ten that only intensifies is a soft peak
      if(isTen && t.progression)
        issues.push({ kind:"weakpeak", sceneId:s.id, sceneNo:s.no, sev:1,
          msg:'"'+s.title+'" is the TEN but only intensifies ('+chargeStr(s.openCharge)+" \u2192 "+chargeStr(s.closeCharge)+"). The twist must reverse the pattern hard enough to make the audience re-read everything before it." });
    });
  } else {
    const bigKinds = (typeof fwAuditOf==="function" && fwAuditOf().bigKinds) || ["midpoint","story-climax","act-climax","crisis"];
    scenes.forEach(s=>{
      const big = bigKinds.includes(s.kind);
      if(!big) return;
      const ti = sd_turnInfo(s);
      // a structural peak must REVERSE its value: intensifying on the same side is a
      // progression — fine inside a run, not at a peak
      if(ti.progression)
        issues.push({ kind:"weakpeak", sceneId:s.id, sceneNo:s.no, sev:1,
          msg:'"'+s.title+'" is a '+(KIND_LABEL[s.kind]||s.kind)+" but only progresses ("+chargeStr(s.openCharge)+" \u2192 "+chargeStr(s.closeCharge)+") \u2014 it intensifies on the same side. A peak must reverse its value." });
      else if(Math.abs(s.closeCharge)<2 && !ti.flagged)
        issues.push({ kind:"weakpeak", sceneId:s.id, sceneNo:s.no, sev:1,
          msg:'"'+s.title+'" is a '+(KIND_LABEL[s.kind]||s.kind)+" but lands soft (close "+chargeStr(s.closeCharge)+"). A peak should hit \u00b13." });
    });
  }
  // 3) PEAK RHYTHM (three-act family) — consecutive big beats landing on the SAME
  //    side halve each other (the law of diminishing returns); climaxes alternate +/−.
  if(!_kisho){
    const peakKinds = (typeof fwAuditOf==="function" && fwAuditOf().bigKinds) || ["midpoint","story-climax","act-climax","crisis"];
    const peaks = scenes.filter(s=>peakKinds.includes(s.kind));
    for(let i=1;i<peaks.length;i++){
      const a=peaks[i-1], b=peaks[i];
      if(Math.sign(a.closeCharge)!==0 && Math.sign(a.closeCharge)===Math.sign(b.closeCharge)){
        issues.push({ kind:"peakrhythm", sceneId:b.id, sceneNo:b.no, sev:0,
          msg:'"'+a.title+'" and "'+b.title+'" both land '+(Math.sign(b.closeCharge)>0?"positive":"negative")
            +" ("+chargeStr(a.closeCharge)+", "+chargeStr(b.closeCharge)+") \u2014 consecutive climaxes on the same side halve each other. Alternate the charge." });
        break; // one report per pass, like monotony
      }
    }
  }
  // 4) INCITING INCIDENT discipline (three-act only) — it strikes ONSCREEN inside
  //    the first quarter; late (or unmarked) and the story idles before the quest starts.
  {
    const _fwId = (typeof frameworkOf==="function") ? frameworkOf(window.turnProject).id : "threeact";
    if(_fwId==="threeact" && scenes.length>=8){
      const iIdx = scenes.findIndex(s=>s.kind==="incite");
      if(iIdx<0){
        issues.push({ kind:"noincite", sceneId:"__noincite", sceneNo:scenes[0].no, sev:0,
          msg:"No scene is marked as the Inciting Incident \u2014 the event that radically upsets the protagonist's life-balance and launches the quest. It belongs onscreen inside the first quarter." });
      } else if(iIdx/scenes.length > 0.28){
        const s=scenes[iIdx];
        issues.push({ kind:"lateincite", sceneId:s.id, sceneNo:s.no, sev:1,
          msg:'"'+s.title+'" is the Inciting Incident but arrives at scene '+s.no+" of "+scenes.length+" \u2014 past the first quarter. The life-upsetting event must strike early enough to launch the quest and promise the climax." });
      }
    }
  }
  // 5) monotony — 3+ consecutive scenes closing on the same sign with little movement
  for(let i=0;i<scenes.length-2;i++){
    const run = [scenes[i],scenes[i+1],scenes[i+2]];
    const sign = Math.sign(run[0].closeCharge);
    if(sign!==0 && run.every(s=>Math.sign(s.closeCharge)===sign)){
      const spread = Math.max.apply(null,run.map(s=>s.closeCharge)) - Math.min.apply(null,run.map(s=>s.closeCharge));
      if(spread<=1){ issues.push({ kind:"monotony", sceneId:run[1].id, sceneNo:run[1].no, sev:0,
        msg:"Scenes "+run[0].no+"\u2013"+run[2].no+" all END on the "+(sign>0?"positive":"negative")+" side at about the same level ("+run.map(s=>chargeStr(s.closeCharge)).join(", ")+") \u2014 three landings in a row on one note flatten the rhythm." });
        break; }
    }
  }
  // 6) one-sided argument \u2014 4+ consecutive scenes arguing the SAME side of the
  //    controlling idea (explicit scene.argues, or derived from the closing charge
  //    via themeArgues). A story argues both sides; a one-sided stretch is a sermon.
  {
    let run = [];
    const flag = ()=>{
      if(run.length<4) return false;
      const side = themeArgues(run[0]).side;
      const mid = run[Math.floor(run.length/2)];
      issues.push({ kind:"themerun", sceneId:mid.id, sceneNo:mid.no, sev:0, side,
        runFrom:run[0].no, runTo:run[run.length-1].no,
        msg:"Scenes "+run[0].no+"\u2013"+run[run.length-1].no+" all argue the "
          +(side==="idea"?"idea":"counter-idea")+" \u2014 "+run.length
          +" scenes with no answer from the other side. The argument flattens into a sermon." });
      return true;
    };
    for(const s of scenes){
      const side = themeArgues(s).side;
      if(side==="neither"){ if(flag()) break; run = []; continue; }
      if(run.length && themeArgues(run[0]).side!==side){ if(flag()) break; run = []; }
      run.push(s);
    }
    if(!issues.some(i=>i.kind==="themerun")) flag();
  }
  // 7) CONFLICT PROGRESSION (three-act family; approved 2026-09-25 by owner) — acts
  //    escalate by KIND, not volume: a later act must reach a level of conflict the
  //    first act never touched — WIDER (institutions, society, the physical world) or
  //    DEEPER (the protagonist's war with themselves). Reads only deliberately set
  //    levels (the story build sets one per scene; the Conflict source pips mark a
  //    manual one), and needs most scenes to carry one before it judges.
  if(!_kisho){
    const LV = { 1:"inner", 2:"personal", 3:"extra-personal" };
    const authored = scenes.filter(s=>s.confAuthored && LV[Number(s.conf)]);
    const acts = [...new Set(scenes.map(s=>Number(s.act)||1))].sort((a,b)=>a-b);
    if(scenes.length>=6 && acts.length>=2 && authored.length>=Math.ceil(scenes.length*0.6)){
      const levelsIn = (act)=> new Set(authored.filter(s=>(Number(s.act)||1)===act).map(s=>Number(s.conf)));
      const first = levelsIn(acts[0]);
      const later = new Set(acts.slice(1).flatMap(a=>[...levelsIn(a)]));
      if(first.size && ![...later].some(l=>!first.has(l))){
        // re-level the final act's first structural peak (the crisis or its equivalent):
        // DEEPER first — a bounded world escalates inward — then wider
        const bigK = (typeof fwAuditOf==="function" && fwAuditOf().bigKinds) || ["midpoint","story-climax","act-climax","crisis"];
        const inLast = scenes.filter(s=>(Number(s.act)||1)===acts[acts.length-1]);
        const target = inLast.find(s=>bigK.includes(s.kind)) || inLast[0];
        const to = [1,3,2].find(l=>!first.has(l));
        if(target && to) issues.push({ kind:"flatconflict", sceneId:target.id, sceneNo:target.no, sev:0,
          fromLevel:Number(target.conf)||2, toLevel:to, levels:[...first].sort().map(l=>LV[l]),
          msg:"Every act fights on the same level of conflict ("+[...first].sort().map(l=>LV[l]).join(" and ")+") \u2014 the conflict grows only in volume, never in kind. A later act must reach "
            +(to===1 ? "DEEPER, into the protagonist's war with themselves (inner)"
              : to===3 ? "WIDER, into institutions, society or the physical world (extra-personal)"
              : "the personal level \u2014 family, friends, lovers")+"." });
      }
    }
  }
  issues.sort((a,b)=>b.sev-a.sev);
  return issues;
}

/* =========================================================
   AGENT 1 — STORY DOCTOR
   audit -> fix weakest link -> apply -> re-audit -> repeat
   ========================================================= */
async function agentStoryDoctor(ctx){
  const MAX_FIXES = 5;
  const skip = new Set();
  const _fwDoc = (typeof frameworkOf==="function") ? frameworkOf(window.turnProject) : null;
  ctx.emit({k:"plan", t:"Scanning all "+ctx.model.scenes.length+" scenes for the weakest structural link \u2014 "
    +((_fwDoc && _fwDoc.id!=="threeact" && _fwDoc.doctorCriteria) ? _fwDoc.doctorCriteria
      : "scenes that don't turn, soft peaks, same-side climaxes, a late inciting incident, flat runs, one-sided stretches of the controlling idea's argument, and conflict that never escalates in kind")+"."});
  // Story Contract — the declared dominant value is a checkable promise on the climax.
  // Read the project from the agent's captured context (not the window global, which
  // can be stale mid-run); initial status here, enforcement after the fix loop below.
  const _ccProject = ()=> ctx.project || (ctx.model && ctx.model.project) || window.turnProject;
  const _ccRun = ()=> (typeof contractClimaxCheck==="function") ? contractClimaxCheck(_ccProject(), ctx.model.scenes) : null;
  {
    const _cc = _ccRun();
    if(_cc && ["no-turn","untracked","loose","undominant"].includes(_cc.status))
      ctx.emit({k:"flag", t:"Contract check: "+_cc.msg});
    else if(_cc && _cc.status==="ok") ctx.emit({k:"ok", t:"Contract check: "+_cc.msg});
  }
  let fixes = 0;
  for(let iter=0; iter<MAX_FIXES; iter++){
    if(ctx.cancelled()) return;
    const issues = auditSpine(ctx.model.scenes).filter(i=>!skip.has(i.sceneId));
    if(!issues.length){ ctx.emit({k:"ok", t:"Re-audit complete \u2014 every remaining scene turns and the rhythm holds. The spine is sound."}); break; }
    ctx.emit({k:"observe", t:issues.length+" issue"+(issues.length>1?"s":"")+" found. Weakest link: Scene "+issues[0].sceneNo+" \u2014 "+issues[0].msg});
    const issue = issues[0];

    // Inciting-incident findings are about PLACEMENT, not charge — report and move on.
    if(issue.kind==="noincite" || issue.kind==="lateincite"){
      ctx.emit({k:"flag", t:(issue.kind==="noincite"
        ? "Mark the Inciting Incident in the Inspector \u2014 brainstorm it as the BEST or WORST possible thing that could happen to the protagonist, and let it strike inside the first quarter."
        : "Scene "+issue.sceneNo+" should strike earlier \u2014 move it into the first quarter on the board, or let an earlier scene carry the life-upsetting event.")});
      skip.add(issue.sceneId); continue;
    }

    const idx = ctx.model.scenes.findIndex(s=>s.id===issue.sceneId);
    const scene = ctx.model.scenes[idx];
    const prev = idx>0 ? ctx.model.scenes[idx-1] : null;

    // Kishōtenketsu: quiet ki/shō scenes are never forced to "turn" — the Doctor
    // reports the inert scene and leaves the re-charge to the writer.
    if(_fwDoc && _fwDoc.id==="kishotenketsu" && issue.kind==="noturn" && Number(scene.act)<3){
      ctx.emit({k:"flag", t:"Scene "+scene.no+" is inert — but ki/shō scenes aren't forced to turn in kishōtenketsu. Give it something to plant or deepen; noting it for your pass, not re-charging it."});
      skip.add(scene.id); continue;
    }

    let fix = null;
    if(issue.kind==="noturn" || issue.kind==="weakpeak"){
      ctx.emit({k:"act", t:"Asking the model for a sharper closing value on Scene "+scene.no+"\u2026"});
      const sug = ctx.ai.available ? await ctx.ai.suggestTurn(scene, prev) : null;
      if(sug){ fix = { closeValue:sug.closeValue, closeCharge:sug.closeCharge, rationale:sug.rationale }; }
      else { // deterministic fallback
        const cc = scene.openCharge>=0 ? Math.max(-3,scene.openCharge-3) : Math.min(3,scene.openCharge+3);
        fix = { closeValue:scene.closeValue, closeCharge:cc, rationale:"Reverse the closing charge so the scene's value flips." };
      }
    } else if(issue.kind==="themerun"){
      // one-sided argument — flip the middle scene of the run to argue the other side
      const opp = issue.side==="idea" ? "counter" : "idea";
      const cc = opp==="idea" ? Math.max(2, Math.abs(scene.closeCharge)) : Math.min(-2, -Math.abs(scene.closeCharge));
      fix = { closeValue:scene.closeValue, closeCharge:cc,
        // an explicit override must flip too, or the re-charge wouldn't change the argument
        argues: themeArgues(scene).explicit ? opp : undefined,
        rationale:"Scenes "+issue.runFrom+"\u2013"+issue.runTo+" argue only the "
          +(issue.side==="idea"?"idea":"counter-idea")
          +". Flip this one so the other side answers back \u2014 the controlling idea stays an argument, not a sermon." };
    } else if(issue.kind==="peakrhythm"){
      // same-side consecutive climaxes — flip the second peak so each one hits fresh
      const cc = -Math.sign(scene.closeCharge)*Math.max(2, Math.abs(scene.closeCharge));
      fix = { closeValue:scene.closeValue, closeCharge:cc,
        rationale:"Alternate the charge \u2014 two climaxes landing on the same side halve each other's impact; flip this one so each peak hits fresh." };
    } else if(issue.kind==="flatconflict"){
      // escalate by kind: re-level this scene; its next draft sources the antagonism there
      fix = { conf:issue.toLevel, rationale:"Acts escalate by kind, not volume. Moving Scene "+scene.no+"'s conflict "
        +(issue.toLevel===1 ? "inward \u2014 the protagonist against their own mind \u2014" : issue.toLevel===3 ? "outward \u2014 against institutions, society or the physical world \u2014" : "to the personal level")
        +" gives the final act a new kind of pressure. The level steers the next draft of this scene (Draft with MUSE or Redraft script from beats); the current script isn't rewritten." };
    } else { // monotony — nudge the middle scene to break the run
      const cc = -Math.sign(scene.closeCharge)*2;
      fix = { closeValue:scene.closeValue, closeCharge:cc, rationale:"Push this scene to the opposite pole to break the flat run and restore contrast." };
    }

    const sideLabel = (s)=> s==="idea" ? "the idea" : s==="counter" ? "the counter-idea" : "neither side";
    const levelLabel = (l)=> ({1:"Inner",2:"Personal",3:"Extra-personal"})[l] || "Personal";
    const ok = await ctx.propose(issue.kind==="flatconflict" ? {
      title:"Escalate the conflict in Scene "+scene.no+" \u2014 "+scene.title,
      reason:issue.msg,
      rationale:fix.rationale,
      before:"Conflict source: "+levelLabel(issue.fromLevel),
      after:"Conflict source: "+levelLabel(fix.conf),
    } : {
      title:"Re-charge Scene "+scene.no+" \u2014 "+scene.title,
      reason:issue.msg,
      rationale:fix.rationale,
      before: issue.kind==="themerun"
        ? "Argues "+sideLabel(themeArgues(scene).side)+" \u00b7 closes "+scene.closeValue+" ("+chargeStr(scene.closeCharge)+")"
        : scene.openValue+" ("+chargeStr(scene.openCharge)+") \u2192 "+scene.closeValue+" ("+chargeStr(scene.closeCharge)+")",
      after: issue.kind==="themerun"
        ? "Argues "+sideLabel(issue.side==="idea"?"counter":"idea")+" \u00b7 closes "+fix.closeValue+" ("+chargeStr(fix.closeCharge)+")"
        : scene.openValue+" ("+chargeStr(scene.openCharge)+") \u2192 "+fix.closeValue+" ("+chargeStr(fix.closeCharge)+")",
    });
    if(ctx.cancelled()) return;
    if(ok && issue.kind==="flatconflict"){
      ctx.model.scenes[idx] = {...scene, conf:fix.conf, confAuthored:true};
      ctx.sync();
      fixes++;
      ctx.emit({k:"ok", t:"Applied. Scene "+scene.no+" now fights at the "+levelLabel(fix.conf).toLowerCase()+" level \u2014 redraft it to feel the change. Re-auditing\u2026"});
    } else if(ok){
      const _sync = (typeof withValueWords==="function") ? withValueWords : (x=>x);
      ctx.model.scenes[idx] = _sync({...scene, closeValue:fix.closeValue, closeCharge:fix.closeCharge,
        ...(fix.argues!==undefined ? {argues:fix.argues} : {})});
      ctx.sync();
      fixes++;
      ctx.emit({k:"ok", t:"Applied. Scene "+scene.no+" now turns "+chargeStr(scene.openCharge)+" \u2192 "+chargeStr(fix.closeCharge)+". Re-auditing\u2026"});
    } else {
      ctx.emit({k:"flag", t:"Skipped Scene "+scene.no+". Moving on."});
      skip.add(scene.id);
    }
  }
  // Story Contract ENFORCEMENT — re-check the promise after the fix loop. A climax
  // that doesn't turn was already handled above (noturn issues re-charge it); what's
  // left is a climax whose values don't NAME the dominant axis. Propose the re-value
  // (approval-gated, like every Doctor fix), then verify and report the final status.
  if(!ctx.cancelled()){
    let cc = _ccRun();
    if(cc && (cc.status==="untracked" || cc.status==="loose") && cc.sceneId){
      const cIdx = ctx.model.scenes.findIndex(s=>s.id===cc.sceneId);
      const csc = ctx.model.scenes[cIdx];
      const con = (typeof contractOf==="function") ? contractOf(_ccProject()) : null;
      const dom = con && (con.dominant==="inner" ? con.innerDef : con.outerDef);
      if(csc && dom){
        // the climax's VALUE AT STAKE becomes the contract's dominant axis; its words then
        // follow its charges (withValueWords)
        const axis = { pos:dom.axis.pos, neg:dom.axis.neg };
        const _vw = (c)=> (typeof valueWordFor==="function") ? valueWordFor(axis, c) : (c>=0 ? axis.pos : axis.neg);
        const ov = _vw(csc.openCharge), cv = _vw(csc.closeCharge);
        const okc = await ctx.propose({
          title:"Re-value the climax onto the contract's dominant axis",
          reason:cc.msg,
          rationale:"Name the promised value in the climax itself \u2014 "+ov+" \u2192 "+cv+" \u2014 so the payoff is checkable, not implied.",
          before: csc.openValue+" ("+chargeStr(csc.openCharge)+") \u2192 "+csc.closeValue+" ("+chargeStr(csc.closeCharge)+")",
          after:  ov+" ("+chargeStr(csc.openCharge)+") \u2192 "+cv+" ("+chargeStr(csc.closeCharge)+")",
        });
        if(ctx.cancelled()) return;
        if(okc){
          ctx.model.scenes[cIdx] = {...csc, value:axis, openValue:ov, closeValue:cv};
          ctx.sync(); fixes++;
          cc = _ccRun();
        }
      }
    }
    if(cc && cc.status && cc.status!=="unset"){
      if(cc.status==="ok") ctx.emit({k:"ok", t:"Contract verified \u2014 "+cc.msg});
      else ctx.emit({k:"flag", t:"Contract unresolved \u2014 "+cc.msg});
    }
  }

  // Kishōtenketsu's real audit is semantic — put the re-read question to the model
  // and report prose findings (docs/Frameworks Plan.md, Phase 3).
  if(_fwDoc && _fwDoc.id==="kishotenketsu" && ctx.ai.available && typeof window.aiTenReRead==="function" && !ctx.cancelled()){
    ctx.emit({k:"act", t:"Re-reading the story with the ten in mind — what recontextualizes, and what doesn't?"});
    let rr=null; try{ rr = await window.aiTenReRead(ctx.model.scenes); }catch(e){}
    if(ctx.cancelled()) return;
    if(rr){
      if(rr.verdict) ctx.emit({k:"observe", t:rr.verdict});
      (rr.hits||[]).forEach(h=>ctx.emit({k:"ok", t:"Scene "+h.scene+" re-reads — "+h.how}));
      (rr.misses||[]).forEach(m=>ctx.emit({k:"flag", t:"Scene "+m.scene+" doesn't re-read — "+m.why}));
      if(!(rr.misses||[]).length) ctx.emit({k:"ok", t:"The ten earns its re-read — every scene before it means something new."});
    } else {
      ctx.emit({k:"flag", t:"Couldn't put the re-read question to the model — run the Doctor again when the engine is reachable."});
    }
  }
  // Character–Plot FUSION CHECK — every turning point is caused by a character's
  // CHOICE or by OUTSIDE FORCES. Fine writing fuses them: when one side dominates,
  // the story is either a puppet show (all external) or a vacuum (all choice).
  if(ctx.ai.available && typeof window.aiFusionCheck==="function" && !ctx.cancelled() && ctx.model.scenes.length>=6){
    ctx.emit({k:"act", t:"Fusion check \u2014 is each turning point caused by the character's choice, or by outside forces?"});
    let fc=null; try{ fc = await window.aiFusionCheck(ctx.model.scenes); }catch(e){}
    if(ctx.cancelled()) return;
    if(fc){
      const vals = Object.values(fc.causes);
      const nChoice = vals.filter(c=>c==="choice").length, nExt = vals.length-nChoice;
      const domN = Math.max(nChoice, nExt);
      if(vals.length>=4 && domN/vals.length>=0.8){
        ctx.emit({k:"flag", t:"Fusion check: "+domN+" of "+vals.length+" turns are driven by "
          +(nChoice>=nExt
            ? "the characters' choices \u2014 nothing pushes back from outside. Let external events force inner change."
            : "outside forces \u2014 the cast is being carried by the plot. Give the turns back to their choices: inner desires should cause external events.")
          +(fc.note?(" "+fc.note):"")});
      } else {
        ctx.emit({k:"ok", t:"Fusion check: choice-driven "+nChoice+" \u00b7 outside-forces "+nExt+" \u2014 "
          +(fc.note||"external events cause inner change and inner desires cause external events; the two stay fused.")});
      }
    } else {
      ctx.emit({k:"flag", t:"Couldn't run the fusion check \u2014 run the Doctor again when the engine is reachable."});
    }
  }
  ctx.emit({k:"done", t: fixes? ("Story Doctor applied "+fixes+" fix"+(fixes>1?"es":"")+". Open the Spine to see the reshaped charge graph.") : "No changes applied."});
}

/* =========================================================
   AGENT 2 — CONTINUITY REPAIR
   run check -> for each flag, plant setup / add payoff -> re-check
   ========================================================= */
async function agentContinuityRepair(ctx){
  const MAX = 5;
  ctx.emit({k:"plan", t:"Running the continuity check across the spine, then repairing each break \u2014 planting missing setups and paying off dangling threads."});
  // the check needs this film's setups/payoffs mapped: build the ledger first when it's
  // missing, or when the script changed since it was built
  const P0 = ctx.model.project || {};
  const L0 = P0.continuityLedger;
  // a hand-made map without a ledger (the bundled sample) is used as it is
  const legacyMap = !L0 && Object.keys(ctx.facts||{}).length>0;
  const stale = !legacyMap && (!L0 || !P0.continuityFacts || (typeof window.continuityLedgerSig==="function"
    && L0.sig !== window.continuityLedgerSig(ctx.model.scenes, ctx.model.drafts)));
  if(stale && ctx.ai.continuityLedger){
    if(!ctx.ai.available){ ctx.emit({k:"flag", t:"This film's setups and payoffs aren't mapped yet, and the writing model isn't available to map them."}); ctx.emit({k:"done", t:"Nothing to check yet."}); return; }
    if(L0) ctx.emit({k:"observe", t:"The script changed since the continuity ledger was built \u2014 rebuilding it first."});
    await buildContinuityLedgerStep(ctx);
    if(ctx.cancelled()) return;
    if(!(ctx.model.project||{}).continuityFacts){ ctx.emit({k:"done", t:"Continuity repair stopped \u2014 nothing was changed."}); return; }
  }
  let planted = 0;   // lines written into scene cards (their scripts then need a redraft)
  for(let iter=0; iter<MAX; iter++){
    if(ctx.cancelled()) return;
    const report = continuityReport(ctx.model.scenes, ctx.model.continuity, ctx.facts);
    if(!report.conflicts.length){ ctx.emit({k:"ok", t:"Continuity check clean \u2014 every reference is set up before use and every setup pays off."}); break; }
    ctx.emit({k:"observe", t:report.conflicts.length+" continuity issue"+(report.conflicts.length>1?"s":"")+" remaining. Repairing: "+report.conflicts[0].msg});
    const c = report.conflicts[0];
    const factLabel = c.label || c.fact;
    const scenes = ctx.model.scenes;

    let targetIdx, mode, applyFn, beforeT, afterT;
    if(c.kind==="unestablished" || c.kind==="premature"){
      // plant the setup in an earlier scene (just before its first reference)
      const refIdx = scenes.findIndex(s=>s.id===c.sceneId);
      targetIdx = Math.max(0, refIdx-1);
      mode = "setup";
      beforeT = "Scene "+scenes[refIdx].no+" references \u201c"+factLabel+"\u201d with no earlier setup.";
      afterT  = "Plant \u201c"+factLabel+"\u201d in Scene "+scenes[targetIdx].no+" so the payoff lands.";
    } else { // dangling — add a payoff later
      const setIdx = scenes.findIndex(s=>s.id===c.sceneId);
      targetIdx = Math.min(scenes.length-1, setIdx+1);
      mode = "payoff";
      beforeT = "Scene "+scenes[setIdx].no+" sets up \u201c"+factLabel+"\u201d but nothing pays it off.";
      afterT  = "Pay off \u201c"+factLabel+"\u201d in Scene "+scenes[targetIdx].no+".";
    }
    const target = scenes[targetIdx];
    ctx.emit({k:"act", t:"Drafting a "+mode+" line for \u201c"+factLabel+"\u201d in Scene "+target.no+"\u2026"});
    const line = ctx.ai.available ? await ctx.ai.plantLine(target, factLabel, mode) : null;

    const ok = await ctx.propose({
      title:(mode==="setup"?"Plant setup":"Add payoff")+" in Scene "+target.no+" \u2014 "+target.title,
      reason:beforeT,
      rationale:afterT,
      before: target.summary,
      after: (line ? (target.summary+"  "+line) : (target.summary+"  ["+(mode==="setup"?"Setup":"Payoff")+": "+factLabel+"]")),
    });
    if(ctx.cancelled()) return;
    if(ok){
      // update continuity map so the re-check actually clears
      const cont = {...ctx.model.continuity};
      const entry = {...(cont[target.id]||{establishes:[],references:[]})};
      const key = (c.fact);
      if(mode==="setup"){ entry.establishes = [...(entry.establishes||[]), key]; }
      else { entry.references = [...(entry.references||[]), key]; }
      cont[target.id] = entry;
      ctx.model.continuity = cont;
      // also reflect the planted line in the scene summary
      if(line){ const sidx = ctx.model.scenes.findIndex(s=>s.id===target.id);
        ctx.model.scenes[sidx] = {...target, summary: target.summary+"  "+line}; planted++; }
      ctx.sync();
      ctx.emit({k:"ok", t:"Applied to Scene "+target.no+". Re-running the continuity check\u2026"});
    } else {
      ctx.emit({k:"flag", t:"Skipped. Stopping continuity repair to avoid looping on a declined fix."});
      break;
    }
  }
  ctx.emit({k:"done", t: planted
    ? "Continuity repair finished. Its "+planted+" line"+(planted!==1?"s":"")+" went into the scene cards \u2014 those scenes are now marked \u201cneeds redraft\u201d in the Script view, so the planted setups and payoffs reach the screenplay with one click."
    : "Continuity repair finished. Open the Script view's continuity check to confirm."});
}

/* =========================================================
   AGENT 3 — ADAPTATION  (logline -> whole spine)
   ========================================================= */
/* Write beats + screenplay for the given scene indices, sequentially, threading
   continuity. HONEST ACCOUNTING: every scene that fails — or silently falls back to
   a rough auto-draft because the model call failed — is tracked and reported by
   number, never swallowed. All model calls go through ctx.ai.* so they're pinned to
   THIS run's film, never whatever film happens to be open now. */
/* short, cancellation-aware breather between retries — transient provider hiccups
   (throttle, timeout) usually clear in moments. Every caller re-checks ctx.cancelled()
   immediately after, so Stop stays honest through a pause. */
function scenePause(ms){ return new Promise(r=>setTimeout(r, ms)); }
/* WHY a scene ended as a rough structural stand-in, from the drafter's typed failure
   (ai.jsx screenplayFailure): the screenplay format check vs a model / service error vs
   the user's own plan credits \u2014 they used to read identically ("the model call
   failed"). The studio's PROVIDER account running dry is internal: safeError masks it
   as "briefly unavailable (ref CM-11)" for everyone but admins, so only admins are told
   it is about credits. Admins also get the technical reason; no vendor or model is ever
   named. */
function standInWhy(f, retried){
  const plain = (x)=> (typeof window.screenplayIssuePlain==="function") ? window.screenplayIssuePlain(x) : "a format problem";
  const ref = (f && f.ref) ? " (ref "+f.ref+")" : "";
  let base, next = "open it and redraft";
  if(!f) base = retried ? "the model call kept failing" : "the model call failed";
  else if(f.kind==="invalid"){
    const p = Array.from(new Set((f.issues||[]).map(plain)));
    base = "the model\u2019s screenplay "+(retried ? "kept failing" : "failed")+" the format check ("+(p[0]||"a format problem")+(p.length>1 ? ", and "+(p.length-1)+" more" : "")+")";
  }
  else if(f.kind==="credits"){
    if(window.turnIsAdmin){ base = "the writing provider\u2019s account ran out of credits"; next = "top it up, then open it and redraft"; }
    else { base = "the writing service was briefly unavailable"+ref; next = "open it and redraft in a moment"; }
  }
  else if(f.kind==="plan"){ base = "your account ran out of plan credits for writing"; next = "choose a plan or add credits, then open it and redraft"; }
  else if(f.kind==="signin"){ base = "you were signed out of the writing service"; next = "sign in, then open it and redraft"; }
  else if(f.kind==="truncated") base = "the model\u2019s reply "+(retried ? "kept getting" : "was")+" cut off";
  else if(f.kind==="unreadable" || f.kind==="empty") base = "the model\u2019s reply "+(retried ? "kept coming back" : "came back")+" "+(f.kind==="empty" ? "empty" : "unreadable");
  else base = (retried ? "the model call kept failing" : "the model call failed")+ref;
  const admin = (f && window.turnIsAdmin && typeof window.screenplayFailureTechnical==="function") ? " [admin: "+window.screenplayFailureTechnical(f)+"]" : "";
  return base+", so a rough structural draft stands in \u2014 "+next+admin;
}
window.standInWhy = standInWhy;

/* a rough stand-in draft (script.jsx isStandInDraft — Story Pipeline step 7), with the same rule
   inline when script.jsx isn't loaded */
function standInDraft(d){
  return (typeof window.isStandInDraft==="function") ? window.isStandInDraft(d)
    : !!(d && (d.blocks||[]).length && (d.standIn===true || (d.auto===true && !d.ai && !d.by)));
}
async function writeScenesSeq(ctx, indices){
  let written = 0; let failures = [];
  const stopRes = ()=>{
    const swapped = typeof ctx.switchedFilms==="function" && ctx.switchedFilms();
    ctx.emit({k:"flag", t: swapped
      ? "You switched films, so this run stopped safely \u2014 nothing was written into the film now open. Reopen the film it started in and run Adaptation again: it offers to finish just the unwritten scenes."
      : "Stopped \u2014 "+written+" of "+indices.length+" scenes written this run. Run Adaptation again: it offers to FINISH just the unwritten scenes; nothing already written is redone."});
    return { written, failures, stopped:true };
  };

  /* One full attempt at scene index i. `draftTries` bounds the model draft calls
     THIS attempt makes (the deterministic rough draft is only accepted once they're
     spent). Returns:
       null                                — real screenplay + beat map in place
       {cancelled:true}                    — Stop pressed / film switched mid-attempt
       {idx,no,title,wrote:true, beatsOnly:true} — draft is real but the beat map never generated
       {idx,no,title,wrote,why}            — draft failed (wrote=true means a rough
                                             stand-in was committed so the film isn't blank) */
  const attemptScene = async (i, draftTries, repairBeatsOnly, priorFailure)=>{
    let scn = ctx.model.scenes[i], beats = ctx.model.beats[scn.id];
    const prev = i>0 ? ctx.model.scenes[i-1] : null;
    // the rough stand-in this scene ALREADY has (a finish run, or this run's own retry): an
    // attempt that fails again keeps it — the user may have edited it (the mark survives
    // edits) — instead of replacing it with a fresh stand-in built from the same cards
    const heldStandIn = (()=>{ const d = ctx.model.drafts[scn.id]; return standInDraft(d) ? d : null; })();
    const fail = (wrote, why, failure)=>({ idx:i, no:scn.no, title:scn.title, wrote, why, failure:failure||null });
    try{
      if(!(beats && (beats.rows||[]).length)){
        // author the beat map; retry once with a breather if the model hiccups — a scene
        // must never end up with a screenplay but no beat map (the cause of "No beat map
        // yet" on a written scene). Both tries can fail only on a hard model error.
        for(let attempt=0; attempt<2 && !beats; attempt++){
          if(attempt){ await scenePause(800); if(ctx.cancelled()) return {cancelled:true}; }
          const authored = await ctx.ai.authorScene(scn, prev);
          if(authored && authored.beats && (authored.beats.rows||[]).length){
            scn = {...scn, ...authored.patch}; beats = authored.beats;
            ctx.model.scenes[i] = scn; ctx.model.beats[scn.id] = authored.beats;
          }
        }
      }
      if(ctx.cancelled()) return {cancelled:true};
      if(repairBeatsOnly){
        // the screenplay from the main pass is already REAL — only the beat map needed
        // another go. Never re-draft here: a retry must never replace a good script
        // with a rough stand-in.
        ctx.sync();
        return (beats && (beats.rows||[]).length) ? null : { idx:i, no:scn.no, title:scn.title, wrote:true, beatsOnly:true };
      }
      // the drafter falls back to a deterministic rough draft when the model call fails —
      // that's a stand-in, not a screenplay, so a failed call is RETRIED here (with a
      // breather) before the stand-in is accepted. With no model reachable the rough
      // draft IS the product, so a single try is correct then.
      const canRetry = !!(ctx.ai.draftScene && ctx.ai.available);
      const tries = canRetry ? Math.max(1, draftTries) : 1;
      // lastFailure: WHY the previous attempt fell back (the drafter's res.failure). A
      // format rejection rides into the next attempt's prompt, so a retry is never the
      // identical request, and the final stand-in message says what actually went wrong.
      let res = null, standIn = false, lastFailure = priorFailure || null;
      for(let t=0; t<tries; t++){
        if(t){
          ctx.emit({k:"act", t:"Sc "+scn.no+" \u201c"+scn.title+"\u201d didn't take \u2014 trying again\u2026"});
          await scenePause(900); if(ctx.cancelled()) return {cancelled:true};
        }
        let out = null;
        try{ out = ctx.ai.draftScene ? await ctx.ai.draftScene(scn, beats, prev, lastFailure ? { retry:lastFailure } : undefined) : null; }
        catch(e){ if(t===tries-1) throw e; out = null; lastFailure = { kind:"service", issues:[], technical:String((e&&e.message)||e||"") }; }
        // Stop pressed (or film switched) WHILE that draft was in flight — commit
        // nothing more; the count in the stop message stays truthful
        if(ctx.cancelled()) return {cancelled:true};
        if(out && !(out.auto && ctx.ai.available)){ res = out; standIn = false; break; }
        if(out){ res = out; standIn = true; lastFailure = out.failure || lastFailure; }   // keep the newest stand-in while retrying
      }
      // the draft remembers the card it was written from (the "needs redraft" marker); a
      // failed attempt on a scene that already had a stand-in leaves that stand-in as it is
      if(res && !(standIn && heldStandIn)) ctx.model.drafts[scn.id] = (typeof window.sceneCardSnap==="function")
        ? { ...res, cardSnap:window.sceneCardSnap(scn, ctx.model.characters, beats) } : res;
      ctx.sync();
      if(!res) return fail(false, "the model returned no usable screenplay");
      if(standIn) return fail(true, standInWhy(lastFailure, false), lastFailure);
      if(!(beats && (beats.rows||[]).length)) return { idx:i, no:scn.no, title:scn.title, wrote:true, beatsOnly:true };
      return null;
    }catch(e){
      // Stop pressed while the failing call was in flight — this is a STOP, not a
      // scene failure; report it as such so the run never ends with completion copy
      if(ctx.cancelled()) return {cancelled:true};
      return fail(false, String((e&&e.message)||e||"unknown error"));
    }
  };

  // ---- main pass ----
  const retryQueue = [];
  for(let k=0;k<indices.length;k++){
    if(ctx.cancelled()) return stopRes();
    const i = indices[k];
    const s = ctx.model.scenes[i];
    ctx.emit({k:"act", t:"Writing Sc "+s.no+" \u201c"+s.title+"\u201d \u2014 "+(k+1)+" of "+indices.length+"\u2026"});
    const f = await attemptScene(i, 2);
    if(f && f.cancelled) return stopRes();
    if(!f){ written++; continue; }
    // `written` counts real screenplays only: a rough stand-in is not a written scene (Story
    // Pipeline step 7 — no cheerful count); a real script still missing its beat map is one
    if(f.beatsOnly) written++;
    retryQueue.push(f);
    if(!f.beatsOnly) failures.push(f);
  }

  // cancellation during the LAST scene's attempt surfaces as an ordinary failure
  // record — catch it here so the run ends as a truthful STOP, never as completion
  if(ctx.cancelled()) return stopRes();

  // a written scene whose beat map never generated, with repair attempts spent, is an
  // OUTSTANDING failure — it must reach the final accounting (via reportSceneFailures
  // and the callers' counts), never quietly pass as "beats and screenplay in place"
  const beatsOnlyFail = (f, retried)=>({ ...f, why:"the scene was written, but its beat map didn't generate"+(retried?" even after an automatic retry":"")+" \u2014 open it and 'Create beat map'" });

  // ---- automatic retry round: the agent re-attempts every scene that didn't fully
  // take (failed/stand-in drafts AND missing beat maps) ITSELF — bounded to one
  // round — instead of ending the run with "run Adaptation again to retry" ----
  if(retryQueue.length && ctx.ai.available){
    ctx.emit({k:"act", t:retryQueue.length+" scene"+(retryQueue.length===1?"":"s")+" didn't fully take \u2014 retrying "+(retryQueue.length===1?"it":"them")+" automatically\u2026"});
    const still = [];
    for(let k=0;k<retryQueue.length;k++){
      if(ctx.cancelled()) return stopRes();
      const f = retryQueue[k];
      ctx.emit({k:"act", t:"Retrying Sc "+f.no+" \u201c"+f.title+"\u201d \u2014 "+(k+1)+" of "+retryQueue.length+"\u2026"});
      await scenePause(900);
      if(ctx.cancelled()) return stopRes();
      const g = await attemptScene(f.idx, 1, !!f.beatsOnly, f.failure);
      if(g && g.cancelled) return stopRes();
      const hadScript = !!f.beatsOnly;               // a stand-in is not a script (see above)
      const hasScript = !g || !!g.beatsOnly;
      if(!hadScript && hasScript) written++;
      if(!g){ ctx.emit({k:"ok", t:"Sc "+f.no+" \u201c"+f.title+"\u201d came good on the retry."}); continue; }
      if(g.beatsOnly){ still.push(beatsOnlyFail(g, true)); continue; }   // screenplay is real; the beat map is still missing — that's outstanding work
      still.push({ ...g, why: g.wrote
        ? standInWhy(g.failure, true)
        : (g.why==="the model returned no usable screenplay" ? "the model returned no usable screenplay, even on the automatic retry" : g.why) });
    }
    failures = still;
  } else {
    failures = failures.concat(retryQueue.filter(f=>f.beatsOnly).map(f=>beatsOnlyFail(f, false)));
  }
  return { written, failures, stopped:false };
}
window.writeScenesSeq = writeScenesSeq;
function reportSceneFailures(ctx, r){
  if(!r.failures.length) return;
  r.failures.slice(0,6).forEach(f=> ctx.emit({k:"flag", t:"Sc "+f.no+" \u201c"+f.title+"\u201d: "+f.why+"."}));
  if(r.failures.length>6) ctx.emit({k:"flag", t:"\u2026and "+(r.failures.length-6)+" more scenes failed the same way."});
}

/* CONTINUITY LEDGER at the end of a build (approved 2026-09-25, owner-delegated): map what
   each written scene sets up and what later scenes rely on, so the continuity check,
   Continuity Repair and the Story Editors count work the moment a story exists. One
   writing call; never fatal — a failure leaves the film buildable, marked "not mapped". */
async function buildContinuityLedgerStep(ctx){
  if(ctx.cancelled() || !ctx.ai.available || !ctx.ai.continuityLedger) return;
  const written = (ctx.model.scenes||[]).some(s=>{ const d=ctx.model.drafts[s.id]; return d && (d.blocks||[]).length; });
  if(!written) return;
  ctx.emit({k:"act", t:"Mapping continuity \u2014 what each scene sets up and what later scenes rely on\u2026"});
  try{
    const L = await ctx.ai.continuityLedger();
    if(ctx.cancelled()) return;
    ctx.model.continuity = L.map;
    ctx.model.project = { ...ctx.model.project, continuityFacts:L.facts, continuityLedger:L.ledger };
    ctx.facts = L.facts;
    ctx.sync();
    const n = Object.keys(L.facts).length;
    const issues = (typeof continuityReport==="function") ? continuityReport(ctx.model.scenes, L.map, L.facts).conflicts.length : 0;
    ctx.emit({k:"ok", t:"Continuity mapped \u2014 "+n+" story fact"+(n!==1?"s":"")+" tracked"+(issues?(", "+issues+" setup/payoff issue"+(issues!==1?"s":"")+" for Continuity Repair."):", every setup pays off.")});
  }catch(e){
    ctx.emit({k:"flag", t:"Couldn't map continuity this time ("+((e&&e.message)||e)+"). The film is fine \u2014 build the ledger later from the Script view's Continuity report."});
  }
}

async function agentAdaptation(ctx){
  const brief = (ctx.input||"").trim();
  if(!ctx.ai.available){ ctx.emit({k:"flag", t:"The model isn't available, so a full spine can't be generated here."}); ctx.emit({k:"done",t:"Aborted."}); return; }
  // FINISH WHAT EXISTS: a stopped or partly failed build leaves scenes without a
  // screenplay. Offer to write JUST those before proposing a full rebuild — a rebuild
  // regenerates everything and replaces work the user already approved.
  // A ROUGH STAND-IN is unwritten too (Story Pipeline step 7, owner-approved 2026-09-27):
  // its text is the beat cards, not a screenplay, so it is offered for finishing — the run
  // log's "run again, it offers to finish just the unwritten scenes" covers it. It is
  // written from the beat cards it ALREADY has (writeScenesSeq authors beats only for a
  // scene with none), and the stand-in it replaces stays on the agent Undo.
  const have = ctx.model.scenes||[];
  const isStandIn = standInDraft;
  const unwritten = have.map((s,i)=>i).filter(i=>{ const d = ctx.model.drafts[have[i].id]; return !(d && (d.blocks||[]).length) || isStandIn(d); });
  if(have.length && unwritten.length){
    const standIns = unwritten.filter(i=>isStandIn(ctx.model.drafts[have[i].id])).length;
    const blank = unwritten.length - standIns;
    const what = !standIns
      ? unwritten.length+" of "+have.length+" scenes have no screenplay yet."
      : !blank
      ? standIns+" of "+have.length+" scenes "+(standIns===1?"is":"are")+" still a rough stand-in built from the beat cards \u2014 not written yet."
      : unwritten.length+" of "+have.length+" scenes aren\u2019t written yet: "+blank+" "+(blank===1?"has":"have")+" no screenplay and "+standIns+" "+(standIns===1?"is a rough stand-in":"are rough stand-ins")+" built from the beat cards.";
    const finish = await ctx.propose({
      title:"Finish writing this film first?",
      reason: what+" Approve to write beats + script for JUST those scenes"+(standIns ? " (a stand-in is written from the beat cards it already has; Undo agent changes brings it back)" : "")+" \u2014 everything already written stays untouched. Decline to rebuild the whole film from your logline instead.",
      rationale:"The fastest, cheapest path: nothing regenerates, nothing you approved is replaced.",
      list: unwritten.map(i=>"Sc "+have[i].no+" \u00b7 "+have[i].title+(isStandIn(ctx.model.drafts[have[i].id]) ? " (rough stand-in)" : "")),
    });
    if(ctx.cancelled()) return;
    if(finish){
      const r = await writeScenesSeq(ctx, unwritten);
      if(r.stopped) return;
      ctx.sync();
      reportSceneFailures(ctx, r);
      await buildContinuityLedgerStep(ctx);
      // r.written counts only scenes that now have a real screenplay: a stand-in that failed
      // again is not "finished"
      ctx.emit({k:"done", t: r.failures.length
        ? ((r.written ? "Finished "+r.written+" scene"+(r.written===1?"":"s")+" \u2014 " : "No scene was finished this time \u2014 ")+r.failures.length+" still failed even after automatic retries (listed above). Run again later to retry just those.")
        : ("All "+have.length+" scenes now have beats and screenplay. Open the Script view to read the film.")});
      return;
    }
    ctx.emit({k:"observe", t:"Understood \u2014 rebuilding the whole film from the logline instead."});
  }
  if(!brief){ ctx.emit({k:"flag", t:"No logline provided. Type a logline or synopsis above and run again."}); ctx.emit({k:"done",t:"Nothing to build."}); return; }
  const _fwA = (typeof frameworkOf==="function") ? frameworkOf(window.turnProject) : null;
  const _kishoA = !!(_fwA && _fwA.id==="kishotenketsu");
  const _heroA = !!(_fwA && _fwA.id==="herosjourney");
  ctx.emit({k:"plan", t: _kishoA
    ? "Designing a complete kish\u014dtenketsu spine from your logline \u2014 four movements (ki \u00b7 sh\u014d \u00b7 ten \u00b7 ketsu), with a value charge tracing each scene's movement."
    : _heroA
    ? "Designing a complete Hero's Journey spine from your logline \u2014 departure, initiation and return, each scene placed on its stage with a value charge that turns."
    : "Designing a complete three-act spine from your logline \u2014 scenes, acts, and a value charge for each that turns."});
  ctx.emit({k:"act", t:"Generating the scene breakdown\u2026"});
  const spine = await ctx.ai.buildSpine(brief);
  if(ctx.cancelled()) return;
  if(!spine){ ctx.emit({k:"flag", t:"The model didn't return a usable spine. Try a more concrete logline."}); ctx.emit({k:"done",t:"Aborted."}); return; }
  const turns = spine.scenes.filter(s=> (typeof chargeTurn==="function") ? chargeTurn(s.openCharge, s.closeCharge).turned : Math.sign(s.openCharge)*Math.sign(s.closeCharge)<0).length;
  const _actsN = _fwA ? Object.keys(_fwA.acts).length : 3;
  const _isNew = !(ctx.model.scenes||[]).length;   // a fresh project has nothing to replace
  ctx.emit({k:"observe", t:'"'+spine.title+'" \u2014 '+spine.scenes.length+" scenes across "+_actsN+" "+(_kishoA?"movements":"acts")+", "+turns+" of them "+(_kishoA?"moving":"turning")+". Review below before it "+(_isNew?"becomes your project.":"replaces the current project.")});

  const ok = await ctx.propose({
    title:(_isNew?"Create the project \u201c":"Replace the project with \u201c")+spine.title+"\u201d",
    reason:_isNew
      ? "This builds the whole spine from your logline, then writes every scene's beats and screenplay."
      : "This rebuilds the entire spine from your logline, then writes every scene's beats and screenplay. Your current scenes, beats and drafts will be cleared.",
    rationale:spine.scenes.length+" new scenes \u00b7 "+turns+(_kishoA?" move cleanly":" turn cleanly")+" \u00b7 beats + script written automatically",
    list: spine.scenes.map((s,i)=>String(i+1).padStart(2,"0")+" \u00b7 Act "+(["I","II","III","IV"][s.act-1]||s.act)+" \u00b7 "+s.title+"  ("+chargeStr(s.openCharge)+"\u2192"+chargeStr(s.closeCharge)+")"),
    danger:!_isNew,
  });
  if(ctx.cancelled()) return;
  if(!ok){ ctx.emit({k:"flag", t:"Kept the existing project. Nothing changed."}); ctx.emit({k:"done",t:"Cancelled."}); return; }

  ctx.emit({k:"act", t:"Building the story world \u2014 premise, controlling idea, setting and cast\u2026"});
  let world = null;
  try{ world = ctx.ai.buildStoryWorld ? await ctx.ai.buildStoryWorld(brief, spine) : null; }catch(e){}

  const newScenes = spine.scenes.map((s,i)=>({
    id:"g"+Date.now().toString(36)+i, no:i+1, act:s.act, seq:"",
    title:s.title, loc:s.loc, summary:s.summary, driver:s.driver,
    openValue:s.openValue, openCharge:s.openCharge, closeValue:s.closeValue, closeCharge:s.closeCharge,
    ...(s.value ? { value:s.value } : {}),
    conf:s.conf||2, ...(s.confAuthored ? { confAuthored:true } : {}),
    kind:(s.kind==="incite"?"incite":"normal"), objective:"",
    _stage:s.stage||"",   // the stage the spine declared (read once by assignPlotPoints)
  }));
  assignPlotPoints(newScenes);
  newScenes.forEach(s=>{ delete s._stage; });
  // card sequence label = the secondary plot function (major beats carry their own badge)
  newScenes.forEach(s=>{ s.seq = s.plot || ""; });
  ctx.model.scenes = newScenes;
  ctx.model.beats = {};
  ctx.model.drafts = {};
  ctx.model.continuity = {};

  // rebuild the whole left panel: project title/premise/idea/setting + cast keyed to drivers
  const base = ctx.project || {};
  ctx.model.project = {
    ...base,
    title: spine.title || base.title,
    format: base.format || "film",   // the registry id, never a label
    // like the Center of Good: a completed world build decides the genre, so an old
    // story's genre never leaks into a new one; only a failed build inherits
    genre: world ? (world.genre || "") : (base.genre || ""),
    // the continuity map was reset above; the old story's facts/ledger go with it
    continuityFacts: undefined, continuityLedger: undefined,
    // the synopsis paragraphs belong to the brief they were written for: a run from a
    // different (typed) brief must not inherit another story's synopsis
    synopsis: (base.synopsis && String(base.sourceBrief||"").trim()===brief) ? base.synopsis : undefined,
    // the saved brief is the one THIS build ran from (a typed-brief run used to keep the
    // previous story's, which the synopsis fallback would then read)
    ...(String(base.sourceBrief||"").trim()===brief ? {} : { sourceBrief:brief, sourceBriefAt:new Date().toISOString() }),
    premise: (world && world.premise) || base.premise,
    controllingIdea: (world && world.controllingIdea) || base.controllingIdea,
    // the empathy anchor (Center of Good) arrives with the story world. A COMPLETED
    // world build is authoritative: if it declared no anchor, the old story's anchor
    // must NOT leak into the new one — only a failed build inherits.
    centerOfGood: world ? world.centerOfGood : base.centerOfGood,
    setting: (world && world.setting) || base.setting,
  };

  // STORY CONTRACT suggestion — infer outer plot / inner arc / dominance from the
  // brief and pre-fill the panel, marked "suggested" (the writer confirms or changes
  // it in the left rail). A contract the writer declared BY HAND is never overwritten;
  // a previous auto-suggestion is re-derived since this is a new story.
  const _handDeclared = base.contract && (base.contract.outer||base.contract.inner) && !base.contract.suggested;
  if(!_handDeclared && typeof window.aiSuggestContract==="function" && !ctx.cancelled()){
    ctx.emit({k:"act", t:"Reading the brief for the story's contract \u2014 outer plot, inner arc, and which change the climax pays off\u2026"});
    let sug = null; try{ sug = await window.aiSuggestContract(brief, ctx.model.project); }catch(e){}
    if(ctx.cancelled()) return;
    if(sug){
      ctx.model.project = { ...ctx.model.project, contract:{ ...sug, suggested:true } };
      const _oDef = sug.outer && (window.PLOTS_OF_FORTUNE||[]).find(p=>p.id===sug.outer);
      const _iDef = sug.inner && (window.PLOTS_OF_CHARACTER||[]).find(p=>p.id===sug.inner);
      ctx.emit({k:"ok", t:"Suggested a Story Contract: "
        +[_oDef && (_oDef.label+" ("+_oDef.axis.pos+"/"+_oDef.axis.neg+")"), _iDef && (_iDef.label+" ("+_iDef.arc+")")].filter(Boolean).join(" \u00b7 ")
        +(sug.dominant ? " \u00b7 "+(sug.dominant==="inner"?"Inner-led":"Outer-led") : "")
        +". Pre-filled in the Story Contract panel \u2014 confirm or change it there."});
    } else {
      ctx.emit({k:"flag", t:"Couldn't infer a Story Contract from the brief \u2014 declare it yourself in the left rail's Story Contract panel."});
    }
  }

  // ---- reconcile cast identities with the actual scene drivers so counts are right ----
  const palette = ["linear-gradient(135deg,#c97b45,#5e3a1d)","linear-gradient(135deg,#3f7d86,#16323a)",
    "linear-gradient(135deg,#7a6cae,#2a2440)","linear-gradient(135deg,#5a6470,#23282f)",
    "linear-gradient(135deg,#4a8c6a,#1d3a2a)","linear-gradient(135deg,#9a5a6e,#3a2230)"];
  const norm = (s)=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const nameWords = (s)=>String(s||"").toLowerCase().split(/[^a-z]+/).filter(w=>w.length>2);
  const titleCase = (s)=>String(s||"").replace(/[_-]+/g," ").replace(/\b\w/g,m=>m.toUpperCase());

  let cast = ((world && world.cast) || []).map((c,i)=>({
    id: norm(c.id) || norm(c.name) || ("char"+i),
    name: c.name || titleCase(c.id) || ("Character "+(i+1)),
    role: c.role || "", color: palette[i%palette.length],
    conscious:"", unconscious:"", arc:"", look:"", wardrobe:"", props:"",
    // the world build's voice identity block (accent / pitch / pace / quirks) seeds
    // voice casting — keep it, never rebuild the member without it
    ...(c.voice && typeof c.voice==="object" ? { voice:{...c.voice} } : {}),
  }));
  // dedup: the model sometimes splits one person into multiple entries (e.g. an
  // "expanded" later-act version). Merge cast members with the same name into one.
  (()=>{
    const byName = {}; const kept = []; const remap = {};
    cast.forEach(c=>{
      const key = norm(c.name);
      const prev = byName[key];
      if(prev){
        remap[c.id] = prev.id;
        // prefer the protagonist/lead role and keep the richer (longer) role text
        const lead = (r)=>/protagon|lead|hero/i.test(r||"");
        if(lead(c.role) && !lead(prev.role)) prev.role = c.role;
        else if((c.role||"").length > (prev.role||"").length && !lead(prev.role)) prev.role = c.role;
        // a split entry may carry the voice details the kept one lacks
        if(c.voice){ const pv = prev.voice || {};
          const merged = {...c.voice, ...Object.fromEntries(Object.entries(pv).filter(([,v])=>String(v||"").trim()))};
          prev.voice = merged; }
      } else { byName[key] = c; kept.push(c); }
    });
    if(kept.length !== cast.length){
      newScenes.forEach(s=>{ if(remap[s.driver]) s.driver = remap[s.driver]; });
      cast = kept;
    }
  })();
  // remap each scene's driver onto a matching cast id (by id, then by name word)
  const matchTo = (driver)=>{
    const dn = norm(driver); if(!dn) return null;
    let m = cast.find(c=>c.id===dn);
    if(m) return m;
    return cast.find(c=> nameWords(c.name).some(w=> norm(w)===dn || dn.includes(norm(w)) || norm(w).includes(dn))) || null;
  };
  newScenes.forEach(s=>{ const m=matchTo(s.driver); if(m) s.driver = m.id; });
  // orphan drivers = scene driver ids with no cast member
  const castIds = new Set(cast.map(c=>c.id));
  const orphanCounts = {};
  newScenes.forEach(s=>{ if(!castIds.has(s.driver)) orphanCounts[s.driver]=(orphanCounts[s.driver]||0)+1; });
  let orphans = Object.keys(orphanCounts).sort((a,b)=>orphanCounts[b]-orphanCounts[a]);
  // a protagonist must drive scenes: if they'd be empty but unowned scenes exist, give them the biggest group
  const countOf = (id)=> newScenes.filter(s=>s.driver===id).length;
  const prot = cast.find(c=>/protagon|lead|hero/i.test(c.role)) || cast[0];
  if(prot && countOf(prot.id)===0 && orphans.length){
    const give = orphans.shift();
    newScenes.forEach(s=>{ if(s.driver===give) s.driver = prot.id; });
  }
  // remaining orphan drivers: a generic ROLE word (antagonist, mentor, ally…) should
  // fold into the existing cast member who holds that role — never become a literal
  // character named "Antagonist". Only a name-like id earns its own supporting member.
  const ROLE_WORDS = {
    antagonist:/antagon|villain|nemesis|rival|opponent/i,
    protagonist:/protagon|lead|hero|main/i,
    mentor:/mentor|guide|teacher/i,
    ally:/ally|sidekick|friend|partner/i,
    love:/love|romance|partner/i,
    foil:/foil/i,
  };
  const isRoleWord = (id)=> Object.keys(ROLE_WORDS).some(k=> id===k || id.startsWith(k));
  orphans.forEach(d=>{
    const dn = norm(d);
    // try to fold a role-word orphan into a cast member whose ROLE matches
    if(isRoleWord(dn)){
      const key = Object.keys(ROLE_WORDS).find(k=> dn===k || dn.startsWith(k));
      const host = cast.find(c=> ROLE_WORDS[key].test(c.role)) || cast.find(c=>/protagon|lead|hero/i.test(c.role)) || cast[0];
      if(host){ newScenes.forEach(s=>{ if(s.driver===d) s.driver = host.id; }); return; }
    }
    // genuine unnamed character → its own supporting member (kept, but not role-named)
    cast.push({ id:d, name:titleCase(d), role:"Supporting",
      color:palette[cast.length%palette.length], conscious:"",unconscious:"",arc:"",look:"",wardrobe:"",props:"" });
  });
  // fallback: no cast at all -> synthesize from the drivers themselves
  if(!cast.length){
    [...new Set(newScenes.map(s=>s.driver))].forEach((d,i)=>cast.push({ id:d, name:titleCase(d),
      role:i===0?"Protagonist":"Supporting", color:palette[i%palette.length],
      conscious:"",unconscious:"",arc:"",look:"",wardrobe:"",props:"" }));
  }
  // safety net: if a cast member's NAME is just a role word ("Antagonist"), fold it
  // into the real role-holder when one exists — a function is not a character name.
  (()=>{
    const bare = (nm)=>{ const n=norm(nm); return Object.keys(ROLE_WORDS).find(k=> n===k || n==="the"+k); };
    const drop = [];
    cast.forEach(c=>{
      const key = bare(c.name);
      if(!key) return;
      const host = cast.find(o=> o!==c && ROLE_WORDS[key].test(o.role));
      if(host){ newScenes.forEach(s=>{ if(s.driver===c.id) s.driver = host.id; }); drop.push(c.id); }
      else if(!c.role){ c.role = titleCase(key); }   // lone role-named member: at least label its role
    });
    if(drop.length) cast = cast.filter(c=> drop.indexOf(c.id)<0);
  })();
  ctx.model.characters = cast;
  // Art Room sheet fields get their deterministic placeholders only (scale class, height,
  // negative prompt, a key/shadow/climax swatch from the avatar colour — the same defaults the
  // sheet falls back to anyway). This is NOT the cast's look: no Body, wardrobe or sheet prompt
  // is drafted here — that waits for the Lookbook, in the Art Room (docs/Story Pipeline.md).
  if(typeof window.charVisualDefaults==="function"){
    cast.forEach(c=>{ Object.assign(c, window.charVisualDefaults(c)); });
  }
  ctx.sync();
  ctx.emit({k:"ok", t:"Built "+newScenes.length+" scenes"+(world?", plus the premise, controlling idea, setting and cast":"")+". Now writing each scene \u2014 beats first, then the screenplay \u2014 threading continuity scene to scene."});

  // ---- PSYCHOLOGY BEFORE THE BEATS (approved 2026-09-25 by owner): want, contradicting
  // need, arc by act and Voice DNA for the principal cast, designed from the synopsis and
  // the spine — so every scene is written FROM who these people are ----
  if(ctx.cancelled()) return;
  if(ctx.ai.available && typeof window.aiCastPsychology==="function" && ctx.model.characters && ctx.model.characters.length){
    ctx.emit({k:"act", t:"Designing the cast's inner life before writing \u2014 want, contradicting need, arc by act and dialogue fingerprint\u2026"});
    try{
      const psych = await window.aiCastPsychology(ctx.model.characters, ctx.model.scenes, ctx.model.project, {
        scenes:ctx.model.scenes, drafts:{}, cast:ctx.model.characters, mode:"before"
      });
      if(ctx.cancelled()) return;
      if(psych){ ctx.model.characters = ctx.model.characters.map(c=> psych[c.id] ? {...c, ...psych[c.id]} : c);
        ctx.sync(); ctx.emit({k:"ok", t:"The principal cast has a want, a need that pulls against it, an arc by act and a dialogue fingerprint \u2014 the scenes are written from them."}); }
    }catch(e){ ctx.emit({k:"flag", t:"Couldn't design the cast's inner life first ("+((e&&e.message)||e)+"); the scenes will be written without it and the check after the script fills it in."}); }
  }

  // ---- seamlessly author beats + script for every scene (no manual Auto-draft needed) ----
  const r = await writeScenesSeq(ctx, ctx.model.scenes.map((_,i)=>i));
  if(r.stopped) return;
  ctx.sync();
  reportSceneFailures(ctx, r);
  ctx.emit({k:"ok", t:"Wrote "+r.written+" of "+ctx.model.scenes.length+" scenes"+
    (r.failures.length ? " \u2014 "+r.failures.length+" didn't take even after automatic retries (flagged above); run Adaptation again later to retry just those." : " \u2014 beats and screenplay are in place.")});

  // ---- CHECK THE PSYCHOLOGY AGAINST THE SCRIPT: true character is what choices under
  // pressure reveal — keep what the scenes bear out, revise what they contradict.
  // docs/Story Pipeline.md build order: … the psychology check against the script, THEN the
  // continuity ledger (below). The two are independent — the check never edits the script text
  // the ledger reads (only the drafts' card snapshots, which the ledger signature ignores). ----
  if(ctx.cancelled()) return;
  if(ctx.ai.available && typeof window.aiCastPsychology==="function" && ctx.model.characters && ctx.model.characters.length){
    const designed = ctx.model.characters.some(c=>String(c.conscious||"").trim());
    ctx.emit({k:"act", t: designed
      ? "Checking the cast's psychology against the choices the script shows\u2026"
      : "Drafting the cast's inner life and Voice DNA from the script \u2014 want, contradicting need, dimensions, arc and dialogue behaviour\u2026"});
    try{
      const psych = await window.aiCastPsychology(ctx.model.characters, ctx.model.scenes, ctx.model.project, {
        scenes:ctx.model.scenes, drafts:ctx.model.drafts, cast:ctx.model.characters, ...(designed ? { mode:"reconcile" } : {})
      });
      if(ctx.cancelled()) return;
      if(psych){
        const keyOf = (c)=> String(c && c.id!=null ? c.id : "");
        const nameKey = (c)=> String(c && c.name || "").toLowerCase().replace(/[^a-z0-9]+/g,"");
        // IN AN EPISODE OF AN EXISTING SHOW (docs/Story Pipeline.md step 3) the check may refine
        // only the characters THIS build introduced: one the Show already had when the build
        // started is left exactly as it is — not even an empty field is filled, since any change
        // to it would move the "drafted from" stamps of another episode's scenes
        const canon = (c)=> typeof ctx.castCanon==="function" && !!ctx.castCanon(c);
        const before = ctx.model.characters.slice();
        const revisions = [];
        ctx.model.characters = ctx.model.characters.map(c=>{
          const p = psych[c.id]; if(!p) return c;
          // an explicit copy, never object-rest destructuring: in the page every Babel-compiled
          // file shares ONE global helper list, so rest-destructuring outside app.jsx strips the
          // wrong keys (the "_revised" note used to be saved on every character)
          const fields = { ...p }; delete fields._revised;
          const held = canon(c);
          if(p._revised) revisions.push({ id:keyOf(c), name:c.name, nk:nameKey(c), note:p._revised, fields, held });
          return held ? c : {...c, ...fields};
        });
        // COMMIT FIRST, so the stamps below read the cast actually saved (an Episode's save
        // reconciles against the live Show cast — docs/Story Pipeline.md step 3).
        ctx.sync();
        // THEN stamp every draft from the cast ACTUALLY saved, and commit again: the script is
        // canon here, so the build's own check never marks its scenes "needs redraft"
        if(typeof window.sceneCardSnap==="function") ctx.model.scenes.forEach(sc=>{
          const d = ctx.model.drafts[sc.id];
          if(d && (d.blocks||[]).length) ctx.model.drafts[sc.id] = { ...d, cardSnap:window.sceneCardSnap(sc, ctx.model.characters, ctx.model.beats[sc.id]) };
        });
        ctx.sync();
        // HONEST LOG: a revision counts only when it landed in the saved cast; one the Show's
        // canon kept out is said so, never counted as revised
        const sameVal = (a,b)=> JSON.stringify(a===undefined ? null : a)===JSON.stringify(b===undefined ? null : b);
        const find = (list, r)=> list.find(c=>c && keyOf(c)===r.id) || list.find(c=>c && r.nk && nameKey(c)===r.nk) || null;
        const landed = [], kept = [];
        revisions.forEach(r=>{
          const was = find(before, r) || {};
          const changed = Object.keys(r.fields).filter(k=> !sameVal(r.fields[k], was[k]));
          if(!changed.length) return;                                   // nothing to apply
          if(r.held){ kept.push(r); return; }                           // Show canon: never applied
          const now = find(ctx.model.characters, r);
          const took = now ? changed.filter(k=> sameVal(now[k], r.fields[k])) : [];
          if(took.length===changed.length) landed.push(r); else kept.push(r);
        });
        // (the reason names what is true in every case: the character was in the Show's cast
        // when this build started — an earlier episode's, or an earlier build of this one)
        if(designed){
          landed.forEach(r=>ctx.emit({k:"observe", t:"Revised from the script \u2014 "+r.name+": "+r.note}));
          kept.forEach(r=>ctx.emit({k:"observe", t:"Kept as Show canon \u2014 "+r.name+" was already in the Show\u2019s cast when this build started, so the check\u2019s revision was not applied: in an Episode the check refines only the characters the build introduces, since changing an existing character could silently change another episode\u2019s scripts. The check suggested: "+r.note}));
        }
        const keptLine = kept.length ? kept.length+" character"+(kept.length!==1?"s":"")+" kept as Show canon (already in the Show\u2019s cast when this build started)." : "";
        ctx.emit({k:"ok", t: designed
          ? (landed.length ? "Psychology checked \u2014 "+landed.length+" character"+(landed.length!==1?"s":"")+" revised to match the choices on the page."+(keptLine ? " "+keptLine : "")
            : kept.length ? "Psychology checked \u2014 no revision applied: "+keptLine
            : "Psychology checked \u2014 the script bears out every character.")
          : "The principal cast now has a want, need, arc and dialogue fingerprint \u2014 visible in the Cast panel."});
      } else if(designed) ctx.emit({k:"ok", t:"Psychology checked \u2014 the script bears out every character."});
    }catch(e){ /* the psychology designed before the script stands */ }
  }

  // ---- map setups and payoffs so continuity is checkable from the start: the LAST step ----
  await buildContinuityLedgerStep(ctx);

  // ---- THE BUILD STOPS HERE (2026-09-27, owner-approved — docs/Story Pipeline.md): it does NOT
  // draft the cast's visual look (wardrobe, palette, sheet prompts). The Lookbook steers every
  // costume, so the look is drafted in the Art Room once the Lookbook has one (the silent cast
  // auto-draft / Characters' Draft all) — drafting it here, before any Lookbook existed, meant the
  // Characters tab was flagged "Lookbook changed — re-draft" and the cast was drafted twice. ----
  if(ctx.cancelled()) return;
  ctx.emit({k:"done", t: r.failures.length
    ? ('\u201c'+spine.title+'\u201d is built \u2014 '+r.written+" of "+ctx.model.scenes.length+" scenes written, "+r.failures.length+" flagged above. Run Adaptation again to finish just those.")
    : ('\u201c'+spine.title+'\u201d is fully written. Open the Script view to read it, or the Spine to see the charge graph. Pre-production starts in the Art Room with the Lookbook \u2014 the cast\u2019s look is designed from it.')});
}

/* =========================================================
   AGENT 4 — TABLE-READ  (whole-script critique, read-only)
   ========================================================= */
async function agentTableRead(ctx){
  const drafted = ctx.model.scenes.filter(s=>ctx.model.drafts[s.id]).length;
  if(!drafted){ ctx.emit({k:"flag", t:"No scenes are drafted yet. Draft some scenes (or Auto-draft all), then run the Final Read."}); ctx.emit({k:"done",t:"Nothing to read."}); return; }
  if(!ctx.ai.available){ ctx.emit({k:"flag", t:"The model isn't available, so the Final Read can't run here."}); ctx.emit({k:"done",t:"Aborted."}); return; }
  ctx.emit({k:"plan", t:"Reading all "+drafted+" drafted scenes end-to-end as actor, director, editor and sound designer \u2014 checking page rhythm, visual writing, action/dialogue causality, voice and thematic payoff."});
  ctx.emit({k:"act", t:"Performing the final read\u2026"});
  const rep = await ctx.ai.tableRead(ctx.model.scenes, ctx.model.drafts);
  if(ctx.cancelled()) return;
  if(!rep){ ctx.emit({k:"flag", t:"The model didn't return a usable report. Try again."}); ctx.emit({k:"done",t:"Aborted."}); return; }
  if(rep.unavailable==="coverage"){
    ctx.emit({k:"flag",t:rep.message||"This screenplay is too large for one complete-film read."});
    ctx.emit({k:"done",t:"Final Read stopped without making claims about an incomplete script."});
    return;
  }
  // deterministic monologue-fallacy pass — a long unbroken speech is a fact, not an
  // opinion, so it's flagged without the model and merged into the same notes list.
  // Deterministic findings are ALWAYS kept (never suppressed by fuzzy-matching the
  // model's free-text notes — a real run must never be dropped by a phrasing guess);
  // each carries flaw:"monologue" so any structured consumer can dedupe cleanly.
  const mono = (typeof window.dialogueMonologues==="function")
    ? window.dialogueMonologues(ctx.model.scenes, ctx.model.drafts) : [];
  mono.forEach(m=>{
    rep.notes = rep.notes||[];
    rep.notes.push({ scene:m.scene, fixAt:"lines", flaw:"monologue",
      issue:"Monologue \u2014 "+m.speaker+" speaks "+m.words+" words unbroken (\u201c"+m.excerpt+"\u201d). Interlace it with action and reaction \u2014 no speech should run this long without the scene pushing back." });
  });
  ctx.emit({k:"report", t:"Final Read complete.", report:rep});
  // voice distinctiveness pass — the sharpest note a real table-read produces:
  // lines that could swap speakers without anyone noticing
  ctx.emit({k:"act", t:"Re-reading the dialogue per character — checking every voice is distinct enough that no line could swap speakers…"});
  const vc = ctx.ai.voiceCheck ? await ctx.ai.voiceCheck(ctx.model.scenes, ctx.model.drafts) : null;
  if(ctx.cancelled()) return;
  if(vc && !vc.unavailable){
    ctx.emit({k:"report", t:"Voice check complete.", voiceReport:vc});
    const n = (vc.swappable||[]).length;
    ctx.emit({k:"done", t:rep.notes.length+" note"+(rep.notes.length!==1?"s":"")+" flagged"
      +(n ? (" + "+n+" swappable line"+(n!==1?"s":"")) : " — and every voice reads distinct")
      +". Click a note to jump to its scene."});
  } else {
    // say WHICH kind of unavailable this was — an outage must never masquerade as
    // "your script doesn't have enough dialogue"
    const why = vc && vc.unavailable;
    const exactSwaps = (vc && vc.swappable) || [];
    if(exactSwaps.length) ctx.emit({k:"report", t:"Voice check (verbatim repeats only).", voiceReport:{ verdict:"", fingerprints:[], swappable:exactSwaps }});
    ctx.emit({k:"flag", t: why==="fewSpeakers"
      ? "Voice check skipped — it needs at least two characters with spoken lines."
      : why==="noModel"
      ? "Voice check skipped — the writing model isn't available right now; the Final Read notes above still stand."
      : "Voice check FAILED — the model's answer couldn't be read. Your dialogue is fine to check; run the Final Read again to retry the voice pass."});
    ctx.emit({k:"done", t:rep.notes.length+" specific notes flagged. Click a note to jump to that scene."});
  }
}

/* =========================================================
   SCRIPT READ  (the first half of the Art Room's Production check — the 1st-AD pass,
   formerly the Writers' Room "Script Breakdown" agent; merged 2026-09-26, owner-approved)
   Reads every WRITTEN scene's beats + screenplay, tags each beat's characters (anatomy /
   features / appearance states + the pronoun the script uses). Two jobs: (1) ENRICH the
   cast sheets with script-only details; (2) the bible↔script DRIFT CHECK — flag where the
   script's pronouns contradict a character's canonical pronouns, with a reconcile proposal
   (catches the Lumi gender case). Props are NOT re-tagged here, and the beat lint runs
   once, in the Production check's second half.
   ========================================================= */
function breakdownPronounEvidence(character, scene, draft, cast){
  const ctx={ scenes:scene?[scene]:[], drafts:scene&&scene.id?{[scene.id]:draft}: {}, cast:cast||[] };
  try{
    if(typeof window.turnIdentityReport==="function"){
      const report=window.turnIdentityReport(character,ctx)||{};
      const issue=Array.isArray(report.issues)&&report.issues.find(i=>i&&i.source==="screenplay"&&i.quote);
      if(report.status==="conflict")
        return { pronouns:"", quote:(issue&&issue.quote)||"", conflict:true };
      if(report.scriptPronouns){
        const local=typeof window.screenplayPronounEvidence==="function"
          ? window.screenplayPronounEvidence(character,ctx) : null;
        return { pronouns:report.scriptPronouns, quote:local&&local.pronouns===report.scriptPronouns ? local.quote : "" };
      }
      return { pronouns:"", quote:"" };
    }
    if(typeof window.screenplayPronounEvidence==="function")
      return window.screenplayPronounEvidence(character,ctx)||{pronouns:"",quote:""};
  }catch(e){}
  return {pronouns:"",quote:""};
}
/* one emotion, one key: the breakdown labels freely, so "rage" and "anger" used to split a
   character's tally (and a near-synonym could push a real signature out of the top 3) */
const _EMOTION_SYNONYMS = { rage:"anger", fury:"anger", furious:"anger", angry:"anger", irritation:"anger",
  sorrow:"grief", sadness:"grief", sad:"grief", mourning:"grief", heartbreak:"grief",
  terror:"fear", dread:"fear", afraid:"fear", scared:"fear", panic:"fear", anxiety:"fear",
  happiness:"joy", happy:"joy", delight:"joy", elation:"joy",
  shame:"guilt", remorse:"guilt", resolve:"determination", resolute:"determination" };
function _emotionKey(label){
  // the breakdown keeps "/" on purpose ("grief/anger"): normalise each side, never fuse them
  return String(label||"").toLowerCase().split("/").map(part=>{
    const k = part.replace(/[^a-z ]/g,"").replace(/\s+/g," ").trim();
    return _EMOTION_SYNONYMS[k] || k;
  }).filter(Boolean).join("/");
}
/* Returns { drift, reconciled, enriched, exprSet, propScenes }, or nothing when the run
   was stopped. Emits no "done" line: the Production check closes the run. Every card is
   tagged writes:"art" (they change the cast sheets). */
async function productionScriptRead(ctx){
  const scenes = scenesInStoryOrder(ctx.model.scenes);
  const written = scenes.filter(s=> ctx.model.drafts[s.id]);
  const pronOf = (g)=> g==="he"?"he/him":g==="she"?"she/her":g==="they"?"they/them":"";
  const charByName = {}; (ctx.model.characters||[]).forEach(c=>{ if(c.name) charByName[c.name.toLowerCase()]=c; });
  const findChar = (nm)=>{ const low=(nm||"").toLowerCase();
    return charByName[low] || (ctx.model.characters||[]).find(x=>{ const xn=(x.name||"").toLowerCase(); return xn && (xn.includes(low)||low.includes(xn)); }); };
  let drift=0, reconciled=0, enriched=0, propScenes=0;
  // the reviewed Props inventory (read-only): listed per scene for the record
  const inventoryProps = ((ctx.bible && ctx.bible.props) || []).filter(p=> p && p.name);
  const scriptPronounsByChar = {};
  const emoTally = {};   // charId → { emotion: count } — the character's emotions across the story
  for(const s of written){
    if(ctx.cancelled()) return;
    ctx.emit({k:"act", t:"Reading Sc "+s.no+" “"+s.title+"”…"});
    let bd=null; try{ bd = await window.aiScriptBreakdown(s, ctx.model.beats[s.id], ctx.model.drafts[s.id], ctx.model.characters); }catch(e){}
    if(!bd){ ctx.emit({k:"flag", t:"Sc "+s.no+": couldn't read this scene — skipping it."}); continue; }
    const sceneProps = inventoryProps.filter(p=> Array.isArray(p.scenes) && p.scenes.indexOf(s.id)>=0);
    bd.characters.forEach(c=>{ const bits=[]; if(c.features.length) bits.push(c.features.length+" feature"+(c.features.length>1?"s":"")); if(c.states.length) bits.push(c.states.length+" state"+(c.states.length>1?"s":""));
      ctx.emit({k:"observe", t:"Sc "+s.no+" · "+c.name+(bits.length?(" — "+bits.join(", ")):"")+(c.gender_used!=="unclear"?(" · script says “"+c.gender_used+"”"):"")}); });
    if(sceneProps.length){ propScenes++; ctx.emit({k:"observe", t:"Sc "+s.no+" props (from the Props inventory): "+sceneProps.map(p=>p.name+(p.ownerName?(" ("+p.ownerName+")"):"")).join(", ")}); }
    for(const c of bd.characters){
      if(ctx.cancelled()) return;
      const ch = findChar(c.name); if(!ch) continue;
      // tally the emotion this scene shows for the character (aggregated into their 3 signature expressions after the pass)
      if(c.emotion){ const em=_emotionKey(c.emotion); if(em) (emoTally[ch.id]=emoTally[ch.id]||{})[em]=(emoTally[ch.id][em]||0)+1; }
      // (1) DRIFT CHECK — validate the model's per-scene gender tag against an
      // exact screenplay quote first. A breakdown label alone is not identity
      // evidence: accepting it here used to let contradictory scenes flip the
      // sheet one approval at a time.
      const evidence = breakdownPronounEvidence(ch, s, ctx.model.drafts[s.id], ctx.model.characters);
      const modelScriptPron = pronOf(c.gender_used);
      if(modelScriptPron && evidence.pronouns && modelScriptPron!==evidence.pronouns){
        ctx.emit({k:"flag", t:"Sc "+s.no+" "+ch.name+" — breakdown tagged “"+c.gender_used+"”, but the exact screenplay evidence says "+evidence.pronouns+": “"+(evidence.quote||"source unavailable")+"”; no cast pronoun was changed."});
        continue;
      }
      if(modelScriptPron && modelScriptPron!=="they/them" &&
         (!evidence.pronouns || evidence.pronouns!==modelScriptPron)){
        ctx.emit({k:"flag", t:"Sc "+s.no+" "+ch.name+" — breakdown tagged “"+c.gender_used+"”, but the screenplay has no matching exact identity evidence (or says "+(evidence.pronouns||"nothing")+")"+(evidence.quote?": “"+evidence.quote+"”":"")+"; no cast pronoun was changed."});
        continue;
      }
      const scriptPron = evidence.pronouns || (modelScriptPron==="they/them" ? modelScriptPron : "");
      const canonPron = (typeof window.charPronouns==="function") ? window.charPronouns(ch) : "";
      const priorScriptPron = scriptPronounsByChar[ch.id];
      if(scriptPron && priorScriptPron && priorScriptPron.pronouns!==scriptPron){
        drift++;
        ctx.emit({k:"flag", t:"Pronoun conflict — "+ch.name+" is tagged "+priorScriptPron.pronouns+" in an earlier screenplay source but "+scriptPron+" in Sc "+s.no+". Exact evidence: earlier “"+(priorScriptPron.quote||"source unavailable")+"”; Sc "+s.no+" “"+(evidence.quote||"source unavailable")+"”. No canonical sheet change was proposed until the writer resolves the script conflict."});
        continue;
      }
      if(scriptPron && !priorScriptPron) scriptPronounsByChar[ch.id]={ pronouns:scriptPron, quote:evidence.quote||"", scene:s.no };
      if(scriptPron==="they/them"){
        // house rule: singular they never becomes canon — the SCRIPT is what needs fixing.
        // Under an explicitly gendered sheet the script pass (second half of this check)
        // offers the rewrite; a sheet that really says they/them is right as written.
        const explicit = String(ch.pronouns||"").toLowerCase().trim();
        if(explicit==="they/them"){ /* sheet and script agree */ }
        else if(_CONS_GENDER[explicit]) ctx.emit({k:"observe", t:"Sc "+s.no+" calls "+ch.name+" \u201cthey\u201d \u2014 the script pass below offers the rewrite to "+explicit+" wherever the subject is clear (house rule: explicit pronouns only)."});
        else ctx.emit({k:"flag", t:"Sc "+s.no+" calls "+ch.name+" \u201cthey\u201d, but their sheet has no pronouns set"+(canonPron?" (the description suggests "+canonPron+")":"")+" \u2014 set them in the Cast panel, then run the Production check again so its script pass can rewrite the scene (house rule: explicit pronouns only)."});
      } else if(scriptPron && canonPron && scriptPron!==canonPron){
        drift++;
        const ok = await ctx.propose({ writes:"art",
          title:"Gender drift — "+ch.name,
          reason:"Sc "+s.no+" has exact screenplay evidence for "+ch.name+" as “"+scriptPron+"”: “"+(evidence.quote||"source unavailable")+"”. The cast sheet's pronouns are "+canonPron+".",
          rationale:"Approve only if the quoted screenplay evidence is the intended canon, setting "+ch.name+"'s sheet to "+scriptPron+". Reject to keep "+canonPron+" and fix the script; this pass never silently trusts a model tag.",
          before:"Sheet: "+canonPron, after:"Sheet: "+scriptPron+" · source: "+(evidence.quote||"unavailable") });
        if(ctx.cancelled()) return;
        if(ok){ const i=ctx.model.characters.findIndex(x=>x.id===ch.id);
          if(i>=0){ ctx.model.characters[i]={...ctx.model.characters[i], pronouns:scriptPron,
              pronounProvenance:"user", pronounSource:"user",
              identityProvenance:{ ...(ctx.model.characters[i].identityProvenance||{}), pronouns:"user" }};
            charByName[(ch.name||"").toLowerCase()]=ctx.model.characters[i]; ctx.sync(); reconciled++; ctx.emit({k:"ok", t:ch.name+" → "+scriptPron}); } }
      } else if(scriptPron && !canonPron){
        // canon UNSET: the script committed to a gender but the sheet carries none, so
        // neither the generation prompts nor the drift check above had anything to
        // enforce (the Odette case: script said "he" for a woman whose sheet was blank).
        // Settle the sheet NOW so every future generation is anchored.
        drift++;
        const ok = await ctx.propose({ writes:"art",
          title:"Pronouns unset — "+ch.name,
           reason:"Sc "+s.no+" has exact screenplay evidence for "+ch.name+" as “"+scriptPron+"”: “"+(evidence.quote||"source unavailable")+"”, but the cast sheet has NO pronouns set — the generators had nothing to enforce.",
           rationale:"Approve explicit screenplay adoption only if the quoted source is correct, setting "+ch.name+"'s canonical pronouns to "+scriptPron+". If the script is wrong, reject, set the right pronouns in the Cast panel and correct the scene's pronouns in the Script view.",
           before:"Sheet: unset", after:"Sheet: "+scriptPron+" · source: "+(evidence.quote||"unavailable") });
        if(ctx.cancelled()) return;
        if(ok){ const i=ctx.model.characters.findIndex(x=>x.id===ch.id);
          if(i>=0){ ctx.model.characters[i]={...ctx.model.characters[i], pronouns:scriptPron,
              pronounProvenance:"user", pronounSource:"user",
              identityProvenance:{ ...(ctx.model.characters[i].identityProvenance||{}), pronouns:"user" }};
            charByName[(ch.name||"").toLowerCase()]=ctx.model.characters[i]; ctx.sync(); reconciled++; ctx.emit({k:"ok", t:ch.name+" → "+scriptPron}); } }
        else ctx.emit({k:"flag", t:ch.name+": pronouns still unset — set them in the Cast panel (and correct the script's pronouns in the Script view if they're the wrong ones)."});
      }
      // (1b) SCALE DRIFT — the script implies a scale class that contradicts the sheet's
      const SCALE_MAP = { human:"A", critter:"B", giant:"C", microscopic:"D" };
      const SCALE_LAB = { A:"Human scale", B:"Small / critter", C:"Massive / giant", D:"Microscopic / sub-insect" };
      const scriptCls = SCALE_MAP[c.scale_used];
      const canonCls = (typeof window.scaleClassOf==="function") ? window.scaleClassOf(ch) : "A";
      if(scriptCls && scriptCls!==canonCls){
        drift++;
        const ok = await ctx.propose({ writes:"art",
          title:"Scale drift — "+ch.name,
          reason:"Sc "+s.no+" reads "+ch.name+" as “"+c.scale_used+"” scale, but the sheet is "+(SCALE_LAB[canonCls]||canonCls)+".",
          rationale:"Approve to set "+ch.name+"'s scale class to "+(SCALE_LAB[scriptCls]||scriptCls)+" — it drives the height sheet's ruler and how the world is rendered from their POV in shots.",
          before:"Sheet: "+(SCALE_LAB[canonCls]||canonCls), after:"Sheet: "+(SCALE_LAB[scriptCls]||scriptCls) });
        if(ctx.cancelled()) return;
        if(ok){ const i=ctx.model.characters.findIndex(x=>x.id===ch.id);
          if(i>=0){ ctx.model.characters[i]={...ctx.model.characters[i], scaleClass:scriptCls}; charByName[(ch.name||"").toLowerCase()]=ctx.model.characters[i]; ctx.sync(); reconciled++; ctx.emit({k:"ok", t:ch.name+" → "+(SCALE_LAB[scriptCls]||scriptCls)}); } }
      }
      // (2) ENRICH — features the scene reveals that aren't on the sheet yet
      const existing = ((ch.coreBody||"")+" "+(ch.physique?Object.values(ch.physique).join(" "):"")).toLowerCase();
      const newFeats = c.features.filter(f=> f && !existing.includes(f.toLowerCase().slice(0,16)));
      for(const f of newFeats){
        if(ctx.cancelled()) return;
        const ok = await ctx.propose({ writes:"art",
          title:"Add to "+ch.name+"'s sheet",
          reason:"Sc "+s.no+" reveals a detail not on "+ch.name+"'s sheet: “"+f+"”.",
          rationale:"Approve to append it to the character's physical description so every sheet and shot includes it.",
          before:(ch.coreBody||"(no body description)").slice(0,90), after:f });
        if(ctx.cancelled()) return;
        if(ok){ const i=ctx.model.characters.findIndex(x=>x.id===ch.id);
          if(i>=0){ const cur=ctx.model.characters[i]; const cb=(cur.coreBody||"").trim();
            ctx.model.characters[i]={...cur, coreBody:(cb+(cb?" ":"")+f.replace(/\.$/,"")+".").trim()};
            charByName[(ch.name||"").toLowerCase()]=ctx.model.characters[i]; ctx.sync(); enriched++; ctx.emit({k:"ok", t:"Added “"+f+"” to "+ch.name}); } }
      }
      // (2b) VOICE ENRICH — audible voice details the script states that aren't on the
      // character's voice block yet. An accent-shaped cue fills voice.accent (the field
      // voice casting reads first); anything else lands in voice.quirks.
      const vb = ch.voice || {};
      const voiceExisting = [vb.accent, vb.pitch, vb.pace, vb.quirks].filter(Boolean).join(" ").toLowerCase();
      const newCues = (c.voice_cues||[]).filter(q=> q && !voiceExisting.includes(q.toLowerCase().slice(0,16)));
      for(const q of newCues){
        if(ctx.cancelled()) return;
        const isAccent = /\baccent|dialect\b/i.test(q);
        const field = isAccent ? "accent" : "quirks";
        const cur = ch.voice || {};
        if(isAccent && cur.accent) continue;   // an authored accent wins over a script cue
        const ok = await ctx.propose({ writes:"art",
          title:"Voice — "+ch.name,
          reason:"Sc "+s.no+" states how "+ch.name+" SOUNDS: “"+q+"”.",
          rationale:"Approve to record it on "+ch.name+"'s voice block ("+field+") — voice casting builds its description from these fields, so the locked voice matches the script.",
          before:(voiceExisting||"(no voice block yet)").slice(0,90), after:q });
        if(ctx.cancelled()) return;
        if(ok){ const i=ctx.model.characters.findIndex(x=>x.id===ch.id);
          if(i>=0){ const cc=ctx.model.characters[i]; const cv={...(cc.voice||{})};
            if(isAccent) cv.accent = q;
            else cv.quirks = ((cv.quirks||"")+(cv.quirks?"; ":"")+q).slice(0,160);
            ctx.model.characters[i]={...cc, voice:cv};
            charByName[(ch.name||"").toLowerCase()]=ctx.model.characters[i]; ctx.sync(); enriched++; ctx.emit({k:"ok", t:ch.name+" voice · "+q}); } }
      }
    }
  }
  // SIGNATURE EXPRESSIONS — each character's 3 most-prevalent emotions across the story.
  // ONE approval card for the whole cast (they used to be written without asking);
  // unchanged characters are left out. They reach the models as TEXT — the Shot Designer's
  // performance register — never as pixels on the (deliberately neutral) character sheet.
  const exprChanges = [];
  Object.keys(emoTally).forEach(cid=>{
    const top = Object.entries(emoTally[cid]).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]);
    const ch = ctx.model.characters.find(x=>x.id===cid);
    if(!ch || !top.length) return;
    const cur = Array.isArray(ch.expressions) ? ch.expressions : [];
    if(cur.join("|").toLowerCase()===top.join("|").toLowerCase()) return;
    exprChanges.push({ id:cid, name:ch.name, before:cur, after:top });
  });
  let exprSet=0;
  if(exprChanges.length){
    if(ctx.cancelled()) return;
    const ok = await ctx.propose({ writes:"art",
      title:"Signature expressions — "+exprChanges.length+" character"+(exprChanges.length===1?"":"s"),
      reason:"Across the script, these are the emotions each character shows most often.",
      rationale:"Approve to store each character's three most frequent emotions from the script as their signature expressions. The Shot Designer uses them as film-level acting context when it drafts each shot's composition. Nothing is re-rendered; the character sheet stays neutral.",
      before:exprChanges.map(c=>c.name+": "+(c.before.length?c.before.join(", "):"none yet")).join("\n"),
      after:exprChanges.map(c=>c.name+": "+c.after.join(", ")).join("\n") });
    if(ctx.cancelled()) return;
    if(ok){
      exprChanges.forEach(c=>{ const i=ctx.model.characters.findIndex(x=>x.id===c.id);
        if(i>=0){ ctx.model.characters[i]={...ctx.model.characters[i], expressions:c.after}; exprSet++; } });
      if(exprSet){ ctx.sync(); ctx.emit({k:"ok", t:"Signature expressions set for "+exprSet+" character"+(exprSet!==1?"s":"")+"."}); }
    }
  }
  return { drift, reconciled, enriched, exprSet, propScenes };
}

/* =========================================================
   AGENT 6 — CINEMATOGRAPHER / COLORIST  (Art Room ▸ Style Bible, gated)
   The visual counterpart to the Writers' Room: reads the spine + the user's visual
   references, designs a bespoke colour-grade system (palette + film stock) WITH a stated
   rationale, color-scripts every scene along the value-charge spine, and proposes the whole
   system for approval (swatches + per-scene assignments + the "why"). Applies on accept.
   Reads ctx.art.designStyles / applyStyles — never touches ctx.model.
   ========================================================= */
async function agentColorist(ctx){
  const art = ctx.art;
  if(!ctx.ai || !ctx.ai.available){
    ctx.emit({k:"flag", t:"The writing model isn't available right now — the Colorist needs it to design the palette."});
    ctx.emit({k:"done", t:"Aborted."}); return;
  }
  if(!art || typeof art.designStyles!=="function" || !(art.scenesLite||[]).length){
    ctx.emit({k:"flag", t:"No scenes to colour yet — build the spine first, then run the Colorist."});
    ctx.emit({k:"done", t:"Nothing to grade."}); return;
  }
  ctx.emit({k:"plan", t:"Designing this film's colour system — a bespoke palette + film stock from the story and your references — then color-scripting every scene along the value-charge spine."});
  ctx.emit({k:"act", t:"Reading the spine + visual references, designing the looks…"});
  let res = null;
  try{ res = await art.designStyles(); }catch(e){}
  if(ctx.cancelled()) return;
  if(!res || !(res.presets||[]).length){
    ctx.emit({k:"flag", t:"The model didn't return a usable palette. Try again."});
    ctx.emit({k:"done", t:"Aborted."}); return;
  }
  const nP = res.presets.length, nS = Object.keys(res.sceneStyles||{}).length;
  const stock = (window.FILM_STOCKS||[]).find(f=>f.id===res.filmStock);
  ctx.emit({k:"observe", t:nP+" bespoke look"+(nP!==1?"s":"")+(stock&&stock.id!=="none"?(" · "+stock.name):"")+" · "+nS+" scene"+(nS!==1?"s":"")+" color-scripted"+((res.rationale&&res.rationale.palette)?(" — "+res.rationale.palette):"")});

  const ok = await ctx.propose({
    title:"Apply this colour system",
    reason:"Replaces the current looks with a bespoke palette and color-scripts every scene.",
    rationale: (res.rationale && res.rationale.palette) || "",
    colorProposal:{ presets:res.presets, sceneStyles:res.sceneStyles, filmStock:res.filmStock, rationale:res.rationale, scenes:art.scenesLite },
  });
  if(ctx.cancelled()) return;
  if(ok){
    art.applyStyles(res);
    if(ctx.art.markApplied) ctx.art.markApplied("colorist");
    ctx.emit({k:"ok", t:"Applied — "+nP+" look"+(nP!==1?"s":"")+", color-scripted "+nS+" scene"+(nS!==1?"s":"")+". Fine-tune any scene in the film-strip."});
  }else{
    ctx.emit({k:"flag", t:"Kept your current looks — nothing changed."});
  }
  ctx.emit({k:"done", t:"Colour pass complete."});
}

/* =========================================================
   AGENT 7 — SHOT DESIGNER  (Art Room ▸ Shot List, gated)
   The cinematographer's COVERAGE pass: audits each scene's shot list — does it establish
   wide, tighten through the middle, and LAND the turn on its most expressive size, with an
   anchor set? — and for the weakest scene proposes the coverage (per-beat size/angle/lens/
   move + the anchor) for approval. Mirrors Story Doctor's audit loop. Does NOT render: it
   locks the shot list, then hands off to "Generate all shots" (which already renders
   anchor-first). Reads ctx.art.coverage — never touches ctx.model.
   ========================================================= */
const _TIGHT_SIZES = new Set(["MCU","CU","ECU","INSERT"]);
/* the framework's word for what coverage must land on ("the turn" / "the re-read");
   null for three-act so the classic copy stays byte-identical */
function fwTurnWord(){
  try{
    const fw = (typeof frameworkOf==="function") ? frameworkOf(window.turnProject) : null;
    if(fw && fw.id!=="threeact" && fw.beatVocab && fw.beatVocab.turnLabel) return fw.beatVocab.turnLabel;
  }catch(e){}
  return null;
}

/* find weak / missing coverage, scene by scene (mirrors auditSpine) */
function auditCoverage(scenes, shots, beatsMap){
  const issues=[];
  const byScene={}; (shots||[]).forEach(s=>{ (byScene[s.sceneId]=byScene[s.sceneId]||[]).push(s); });
  (scenes||[]).forEach(s=>{
    const bm=(beatsMap||{})[s.id]||{}; const beats=(bm.rows||[]); const ss=byScene[s.id]||[];
    const t='"'+(s.title||("Scene "+s.no))+'"';
    if(!ss.length){ issues.push({kind:"nocoverage",sceneId:s.id,sceneNo:s.no,sev:3,msg:t+" has no shots yet — it needs coverage."}); return; }
    if(beats.length && ss.length < beats.length){ issues.push({kind:"nocoverage",sceneId:s.id,sceneNo:s.no,sev:3,msg:t+" has "+ss.length+" shot"+(ss.length!==1?"s":"")+" for "+beats.length+" beats — coverage is thin."}); return; }
    const turnAt = bm.turnAt;
    if(turnAt){ const ts=ss.find(x=>x.beatN===turnAt); if(ts && !_TIGHT_SIZES.has(ts.size)){ issues.push({kind:"weakturn",sceneId:s.id,sceneNo:s.no,sev:2,msg:t+" doesn't land "+(fwTurnWord()||"its turn")+" — the turning beat is a "+ts.size+", not a tight push-in (MCU/CU/ECU)."}); return; } }
    if(ss.length>=3){ const sizes=new Set(ss.map(x=>x.size)); if(sizes.size===1){ issues.push({kind:"flatsizes",sceneId:s.id,sceneNo:s.no,sev:1,msg:t+" is all "+[...sizes][0]+" — no size progression from wide to tight."}); return; } }
  });
  issues.sort((a,b)=>b.sev-a.sev);
  return issues;
}

async function agentShotDesigner(ctx){
  const cov = ctx.art && ctx.art.coverage;
  if(!cov || typeof cov.audit!=="function"){
    ctx.emit({k:"flag", t:"No shot data available — build the spine and beats first, then break the scenes into shots."});
    ctx.emit({k:"done", t:"Aborted."}); return;
  }
  // every scene can be designed in one run (at most once each), so a 40-scene feature or a
  // 24-scene episode is fully covered — it used to stop silently after 12 fixes
  const MAX=Math.max(12, (Number(cov.sceneCount)||0)+1), skip=new Set();
  // Run pre-production auto-approves, so there it never re-plans a scene whose shots you
  // approved or locked; the Shot Designer run on its own still asks, scene by scene
  const protectedScene = (sid)=> !!ctx.autoApprove && cov.shotsOf(sid).some(s=>s && (s.approved || s.locked));
  let protectedN=0, capped=false;
  ctx.emit({k:"plan", t:"Auditing coverage scene by scene — does each scene establish wide, tighten through the middle, and LAND "+(fwTurnWord()||"its turn")+" on its most expressive size?"});
  let fixes=0;
  for(let iter=0;iter<MAX;iter++){
    if(ctx.cancelled()) return;
    const issues = cov.audit().filter(i=>!skip.has(i.sceneId));
    if(!issues.length){ const all = cov.audit();
      ctx.emit({k:"ok", t: all.length ? "Re-audit complete for every scene it could work on."
        : "Re-audit complete — every scene establishes, tightens and lands "+(fwTurnWord()||"its turn")+". Coverage holds."}); break; }
    if(iter===MAX-1){ capped=true; }
    const issue=issues[0]; const scene=cov.sceneById(issue.sceneId);
    if(protectedScene(issue.sceneId)){
      protectedN++; skip.add(issue.sceneId);
      ctx.emit({k:"observe", t:"Scene "+issue.sceneNo+" has approved or locked shots — left as it is. To re-plan it, use Re-draft on that scene in the Shots tab."});
      continue;
    }
    ctx.emit({k:"observe", t:issues.length+" coverage issue"+(issues.length>1?"s":"")+" — weakest link: Scene "+issue.sceneNo+" — "+issue.msg});
    const turnAt = cov.turnAtOf(issue.sceneId);
    if(!ctx.ai || !ctx.ai.available){ ctx.emit({k:"flag", t:"The model isn't available to design coverage — skipping Scene "+issue.sceneNo+"."}); skip.add(issue.sceneId); continue; }
    ctx.emit({k:"act", t:"Designing coverage for Scene "+issue.sceneNo+" — establishing, tightening, landing "+(fwTurnWord()||"the turn")+"…"});
    let made=null; try{ made = await cov.draftCoverage(scene); }catch(e){}
    if(ctx.cancelled()) return;
    if(!made || !made.length){ ctx.emit({k:"flag", t:"Couldn't design coverage for Scene "+issue.sceneNo+". Moving on."}); skip.add(issue.sceneId); continue; }
    // guarantee the turn LANDS tight: if the model left the turning beat wide, push it to a CU
    // push-in (also what resolves the weakturn audit so the loop converges, never re-proposes).
    if(turnAt){ const ti = made.findIndex(s=>s.beatN===turnAt);
      if(ti>=0 && !_TIGHT_SIZES.has(made[ti].size)){ made[ti] = {...made[ti], size:"CU", move:(made[ti].move==="static"?"push":made[ti].move) }; } }
    const anchorId = cov.pickAnchor(made);
    const fix = { shots:made, anchorId, list: cov.grammarList(made, anchorId, turnAt),
      rationale:"Coverage that establishes wide, tightens through the middle, and lands "+(fwTurnWord()||"the turn")+" on its most expressive size." };
    const curCount = cov.shotsOf(issue.sceneId).length;
    const ok = await ctx.propose({
      title:"Shot coverage — Scene "+issue.sceneNo+" “"+((scene&&scene.title)||"Untitled")+"”",
      reason:issue.msg + (curCount?(" Each beat's current shot keeps its ID and frames (an image may need re-rendering if its shot changes); any extra shots on a re-planned beat move to Shots Trash, where you can restore them."):""),
      rationale:fix.rationale,
      list:fix.list,
    });
    if(ctx.cancelled()) return;
    if(ok){
      cov.applyCoverage(issue.sceneId, fix.shots, fix.anchorId);
      fixes++; skip.add(issue.sceneId);   // one design per scene per run — the loop always ends
      ctx.emit({k:"ok", t:"Applied to Scene "+issue.sceneNo+". Re-auditing…"});
    } else {
      ctx.emit({k:"flag", t:"Skipped Scene "+issue.sceneNo+"."});
      skip.add(issue.sceneId);
    }
  }
  // say what is left instead of stopping quietly
  const left = cov.audit().filter(i=>skip.has(i.sceneId) || capped);
  const leftScenes = new Set(left.map(i=>i.sceneId)).size;
  ctx.emit({k:"done", t:(fixes ? ("Designed coverage for "+fixes+" scene"+(fixes!==1?"s":"")+". Render the frames from the Shots tab (Generate all shots, or Render Scene in order).") : "No coverage changes applied.")
    + (protectedN ? (" "+protectedN+" scene"+(protectedN!==1?"s":"")+" with approved or locked shots "+(protectedN!==1?"were":"was")+" left as "+(protectedN!==1?"they are":"it is")+".") : "")
    + (leftScenes ? (" "+leftScenes+" scene"+(leftScenes!==1?"s":"")+" still "+(leftScenes!==1?"have":"has")+" coverage notes"+(capped?" — run the Shot Designer again to continue":"")+".") : "") });
}

/* =========================================================
   AGENT 8 — CASTING DIRECTOR  (Art Room ▸ Characters, autonomous)
   Designs the whole cast in dependency order: per character it (1) drafts the visual spec
   from the script, (2) suggests appearance states, (3) generates the master sheet (pulling
   in already-generated prop sheets + any cameo face-lock), then (4) generates each
   appearance-state variant identity-locked off the master. Runs on its own (no approval);
   cancellable via Stop; idempotent (fills only what's missing). Reads ctx.art.cast — never
   touches ctx.model.
   ========================================================= */
async function agentCastingDirector(ctx){
  const cast = ctx.art && ctx.art.cast;
  if(!cast || !cast.list || !cast.list.length){
    ctx.emit({k:"flag", t:"No cast yet — build the spine first, then run the Casting Director."});
    ctx.emit({k:"done", t:"Nothing to cast."}); return;
  }
  const N = cast.list.length;
  ctx.emit({k:"plan", t: ctx.draftOnly
    ? "Re-drafting the cast from the updated Lookbook — for each of the "+N+" character"+(N!==1?"s":"")+": re-draft the look and appearance states. Specs only — every master sheet and variant stays untouched."
    : "Designing the cast — for each of the "+N+" character"+(N!==1?"s":"")+": draft the look, find their appearance changes, generate the master sheet (with prop + cameo references), then each state variant."});
  let specs=0, sheets=0, variants=0;
  for(const ch of cast.list){
    if(ctx.cancelled()){ ctx.emit({k:"flag", t:"Stopped — "+sheets+" sheet"+(sheets!==1?"s":"")+" generated."}); return; }
    let c = ch;
    ctx.emit({k:"act", t:"Casting "+(c.name||"a character")+"…"});

    // 1) draft the visual spec (force = re-draft even if already drafted, applying the Lookbook)
    const redraftSpecs = ctx.force || ctx.draftOnly;
    if((redraftSpecs || !cast.isDrafted(c)) && ctx.ai && ctx.ai.available){
      ctx.emit({k:"act", t:(redraftSpecs?"Re-drafting ":"Drafting ")+(c.name||"the character")+"'s look from the script…"});
      try{ const patch = await cast.draftSpec(c); if(patch){ c = {...c, ...patch}; specs++; } }catch(e){}
    }
    if(ctx.cancelled()) return;
    if(!cast.isDrafted(c)){ ctx.emit({k:"flag", t:(c.name||"This character")+" has no spec yet (add a look in the Characters tab) — skipping."}); continue; }

    // 2) suggest appearance states if none
    if(!(c.states && c.states.length) && ctx.ai && ctx.ai.available){
      ctx.emit({k:"act", t:"Finding "+(c.name||"the character")+"'s appearance changes…"});
      try{ const sts = await cast.suggestStates(c); if(sts && sts.length){ c = {...c, states:sts}; } }catch(e){}
    }
    if(ctx.cancelled()) return;

    // draft-only ("Re-draft only" on the Lookbook-stale banner): spec updated — leave this
    // character's master sheet and variants untouched.
    if(ctx.draftOnly) continue;

    // 3) generate the master sheet (force = regenerate even if one exists)
    let baseUrl = ctx.force ? "" : await cast.imageOf(c.id);
    if(!baseUrl){
      ctx.emit({k:"act", t:"Generating "+(c.name||"the character")+"'s master sheet…"});
      try{ baseUrl = await cast.generateMaster(c); sheets++;
        ctx.emit({k:"ok", t:(c.name||"Character")+" — master sheet generated."}); }
      catch(e){ ctx.emit({k:"flag", t:"Couldn't generate "+(c.name||"the character")+"'s sheet: "+((e&&e.message)||e)+". Moving on."}); continue; }
    }
    if(ctx.cancelled()) return;

    // 4) generate each appearance-state variant (identity-locked off the master)
    for(const st of (c.states||[])){
      if(ctx.cancelled()){ ctx.emit({k:"flag", t:"Stopped — "+sheets+" sheets, "+variants+" variants."}); return; }
      const sid = c.id+":"+st.id;
      const have = ctx.force ? "" : await cast.imageOf(sid);
      if(have) continue;
      ctx.emit({k:"act", t:"Generating "+(c.name||"the character")+" — “"+(st.label||"variant")+"”…"});
      try{ await cast.generateState(c, st, baseUrl); variants++;
        ctx.emit({k:"ok", t:(c.name||"Character")+" — “"+(st.label||"variant")+"” generated."}); }
      catch(e){ ctx.emit({k:"flag", t:"Couldn't generate "+(c.name||"the character")+" — “"+(st.label||"variant")+"”: "+((e&&e.message)||e)+"."}); }
    }
  }
  if(ctx.art.markApplied && (ctx.force||specs||sheets||variants)) ctx.art.markApplied("characters");
  ctx.emit({k:"done", t: ctx.draftOnly
    ? "Cast re-drafted — "+specs+" spec"+(specs!==1?"s":"")+" updated from the Lookbook. Sheets left untouched — regenerate them from the Characters tab when ready."
    : "Cast designed — "+specs+" spec"+(specs!==1?"s":"")+" drafted, "+sheets+" master sheet"+(sheets!==1?"s":"")+", "+variants+" appearance variant"+(variants!==1?"s":"")+". Review and tweak any in the Characters tab."});
}

/* =========================================================
   WEAR PROPS (the Coordinator's "step 3", Art Room) — after the cast is generated and
   the props (which reference the cast) are made, RE-GENERATE each character's master so
   it wears its exact finalized worn-prop sheets (generateMaster already attaches them).
   Only touches characters that (a) already have a master and (b) have ≥1 worn prop WITH a
   sheet; any already-generated appearance-state variant is refreshed off the new master so
   they don't drift. Closes the loop: character → prop (refs character) → character wears prop.
   ========================================================= */
async function agentWearProps(ctx){
  const cast = ctx.art && ctx.art.cast;
  if(!cast || !cast.list || !cast.list.length){ ctx.emit({k:"done", t:"No cast to dress."}); return; }
  const targets = [];
  for(const c of cast.list){
    if(ctx.cancelled()) return;
    const hasMaster = cast.imageOf ? await cast.imageOf(c.id) : null;
    if(!hasMaster) continue;   // never generated — leave it for the Casting Director
    const worn = cast.wornPropsWithSheets ? await cast.wornPropsWithSheets(c) : [];
    if(worn.length) targets.push({ c, worn });
  }
  if(!targets.length){ ctx.emit({k:"ok", t:"No characters have newly-generated worn props to wear."}); ctx.emit({k:"done", t:"Cast already wears its props."}); return; }
  ctx.emit({k:"plan", t:"Dressing "+targets.length+" character"+(targets.length!==1?"s":"")+" in their finalized worn props — re-generating each master so it wears the exact prop sheet"+(targets.length!==1?"s":"")+", then refreshing any appearance variant off the new master."});
  let done=0;
  for(const { c, worn } of targets){
    if(ctx.cancelled()){ ctx.emit({k:"flag", t:"Stopped — "+done+" dressed."}); return; }
    ctx.emit({k:"act", t:"Dressing "+(c.name||"a character")+" in "+worn.length+" worn prop"+(worn.length!==1?"s":"")+" ("+worn.map(p=>p.name).join(", ").slice(0,80)+")…"});
    try{
      // Updating a continuity master must be an edit of the approved character,
      // not a fresh casting pass that happens to share the same text prompt.
      const masterUrl = await cast.generateMaster(c,{deriveFromCurrent:true});
      // refresh ONLY appearance states that already exist, off the new master
      for(const st of (c.states||[])){
        if(ctx.cancelled()) return;
        const existing = cast.imageOf ? await cast.imageOf(c.id+":"+st.id) : null;
        if(existing){ try{ await cast.generateState(c, st, masterUrl); }catch(e){} }
      }
      done++;
      ctx.emit({k:"ok", t:(c.name||"Character")+" now wears its exact prop"+(worn.length!==1?"s":"")+"."});
    }catch(e){ ctx.emit({k:"flag", t:"Couldn't dress "+(c.name||"the character")+": "+((e&&e.message)||e)+". Moving on."}); }
  }
  ctx.emit({k:"done", t:"Dressed "+done+" character"+(done!==1?"s":"")+" in their finalized worn props."});
}
window.agentWearProps = agentWearProps;

async function agentPropsMaster(ctx){
  const pm = ctx.art && ctx.art.propmaster;
  if(!pm){
    ctx.emit({k:"flag", t:"Props workspace unavailable."});
    ctx.emit({k:"done", t:"Nothing to do."}); return;
  }
  ctx.emit({k:"plan", t: ctx.draftOnly
    ? "Re-drafting existing prop specifications from the updated Lookbook. Specs only — generated sheets stay untouched."
    : "Drafting and generating the current prop inventory. Screenplay discoveries require review in Props → Extract screenplay props; this pass never silently adds or merges them."});

  // 1) character-brief design proposals (screenplay props come from the review flow)
  ctx.emit({k:"act", t:"Synchronizing character-brief design proposals…"});
  let castN=0;
  try{ castN = pm.deriveCast(); }catch(e){}
  if(ctx.cancelled()) return;
  ctx.emit({k:"observe", t:"Added "+castN+" character-brief proposal(s). Use Props → Extract screenplay props to review script-established objects and link them to this inventory."});
  if(ctx.cancelled()) return;

  // 2) draft prop specs (force = re-draft ALL, applying the current Lookbook)
  const redraftSpecs = ctx.force || ctx.draftOnly;
  ctx.emit({k:"act", t:redraftSpecs?"Re-drafting every prop spec from the story…":"Drafting prop specs from the story…"});
  let drafted=0;
  try{ drafted = await pm.draftSpecs(redraftSpecs); }
  catch(e){ ctx.emit({k:"flag", t:"Spec drafting hit an error: "+((e&&e.message)||e)}); }
  ctx.emit({k:"observe", t:drafted?("Drafted "+drafted+" spec"+(drafted!==1?"s":"")+"."):"Specs already complete."});
  if(ctx.cancelled()) return;

  // Similar names are not object identity: no automatic dedup. Only an explicit user
  // merge on the Props tab may remove a card.

  // draft-only ("Re-draft only" on the Lookbook-stale banner): the specs now carry the
  // updated Lookbook — stop before generation so every existing sheet stays untouched.
  if(ctx.draftOnly){
    if(ctx.art.markApplied) ctx.art.markApplied("props");
    ctx.emit({k:"done", t:"Props re-drafted — "+castN+" brief proposal"+(castN!==1?"s":"")+", "+drafted+" spec"+(drafted!==1?"s":"")+" updated from the Lookbook. Sheets left untouched — regenerate them from the Props tab when ready."});
    return;
  }

  // 3) generate sheets (force = regenerate ALL drafted props that need their own image)
  let todo=[];
  try{ todo = await pm.toGenerate(ctx.force); }catch(e){}
  if(!todo.length){
    if(ctx.art.markApplied && (ctx.force||drafted)) ctx.art.markApplied("props");
    ctx.emit({k:"done", t:"Props ready — "+castN+" brief proposal"+(castN!==1?"s":"")+", "+drafted+" drafted; every drafted prop that needs its own image already has one."}); return;
  }
  ctx.emit({k:"act", t:"Generating "+todo.length+" prop sheet"+(todo.length!==1?"s":"")+"…"});
  let sheets=0;
  for(const p of todo){
    if(ctx.cancelled()){ ctx.emit({k:"flag", t:"Stopped — "+sheets+" sheet"+(sheets!==1?"s":"")+" generated."}); return; }
    ctx.emit({k:"act", t:"Generating "+(p.name||"a prop")+"'s sheet…"});
    try{ await pm.generateSheet(p); sheets++;
      ctx.emit({k:"ok", t:(p.name||"Prop")+" — sheet generated."}); }
    catch(e){ ctx.emit({k:"flag", t:"Couldn't generate "+(p.name||"the prop")+"'s sheet: "+((e&&e.message)||e)+". Moving on."}); }
  }
  if(ctx.art.markApplied && (ctx.force||drafted||sheets)) ctx.art.markApplied("props");
  ctx.emit({k:"done", t:"Props mastered — "+castN+" brief proposal"+(castN!==1?"s":"")+", "+drafted+" drafted, "+sheets+" sheet"+(sheets!==1?"s":"")+" generated. Worn props that changed show on their owner's sheet as a wardrobe update."});
}

async function agentLocationScout(ctx){
  const ls = ctx.art && ctx.art.locscout;
  if(!ls){
    ctx.emit({k:"flag", t:"Locations workspace unavailable."});
    ctx.emit({k:"done", t:"Nothing to do."}); return;
  }
  ctx.emit({k:"plan", t: ctx.draftOnly
    ? "Re-drafting the locations from the updated Lookbook — pull any new places, re-draft each spec + depth-grid staging. Specs only — every generated plate stays untouched."
    : "Scouting the film's locations — pull every place from the sluglines, draft each one's staging + depth-grid spec, generate the plate, and add the time-of-day variants the script needs. Plus a coverage check: any scene whose slugline location has no card yet."});

  // 1) pull locations from the sluglines (and refresh existing scene lists / times)
  ctx.emit({k:"act", t:"Reading the sluglines for locations…"});
  let added=0;
  try{ added = ls.pull(); }catch(e){}
  ctx.emit({k:"observe", t:added?("Pulled "+added+" new location"+(added!==1?"s":"")+" from the script."):"Locations already pulled — refreshed their scene lists."});
  if(ctx.cancelled()) return;

  // 2) coverage check
  let gaps=[];
  try{ gaps = ls.coverage(); }catch(e){}
  if(gaps.length){
    ctx.emit({k:"flag", t:"Coverage — "+gaps.length+" scene"+(gaps.length!==1?"s":"")+" with no location card: "+
      gaps.slice(0,6).map(g=>"Sc "+String(g.no||"?")+(g.place?(" ("+g.place+")"):"")).join(", ")+(gaps.length>6?"…":"")+
      ". Their sluglines may be malformed — add a card by hand if needed."});
  } else {
    ctx.emit({k:"ok", t:"Coverage clean — every scene's slugline location has a card."});
  }
  if(ctx.cancelled()) return;

  // 3) draft the spec (force = re-draft ALL, applying the current Lookbook)
  const redraftSpecs = ctx.force || ctx.draftOnly;
  ctx.emit({k:"act", t:redraftSpecs?"Re-drafting every location spec from the script…":"Drafting location specs from the script…"});
  let specs=0;
  try{ specs = await ls.draftSpecs(redraftSpecs); }
  catch(e){ ctx.emit({k:"flag", t:"Spec drafting hit an error: "+((e&&e.message)||e)}); }
  ctx.emit({k:"observe", t:specs?("Drafted "+specs+" spec"+(specs!==1?"s":"")+"."):"Specs already complete."});
  if(ctx.cancelled()) return;

  // 4) design the depth-grid staging
  ctx.emit({k:"act", t:"Designing the depth-grid staging…"});
  let staged=0;
  try{ staged = await ls.draftStaging(); }catch(e){}
  if(staged) ctx.emit({k:"observe", t:"Staged "+staged+" location"+(staged!==1?"s":"")+"."});
  if(ctx.cancelled()) return;

  // 5) add the time-of-day variants the script calls for (a place seen at >1 time)
  let vars=0;
  try{ vars = ls.addVariants(); }catch(e){}
  if(vars) ctx.emit({k:"ok", t:"Added "+vars+" time-of-day variant"+(vars!==1?"s":"")+" for places the script shows at more than one time."});
  if(ctx.cancelled()) return;

  // draft-only ("Re-draft only" on the Lookbook-stale banner): the specs + staging now
  // carry the updated Lookbook — stop before generation so every plate stays untouched.
  if(ctx.draftOnly){
    if(ctx.art.markApplied) ctx.art.markApplied("locations");
    ctx.emit({k:"done", t:"Locations re-drafted — "+specs+" spec"+(specs!==1?"s":"")+" updated from the Lookbook"+(staged?(", "+staged+" staged"):"")+". Plates left untouched — regenerate them from the Locations tab when ready."});
    return;
  }

  // 6) generate plates, then variants (force = regenerate ALL)
  let plates=[], variants=[];
  try{ plates = await ls.toGeneratePlates(ctx.force); }catch(e){}
  try{ variants = await ls.toGenerateVariants(ctx.force); }catch(e){}
  if(!plates.length && !variants.length){
    if(ctx.art.markApplied && (ctx.force||specs)) ctx.art.markApplied("locations");
    ctx.emit({k:"done", t:"Locations ready — "+added+" pulled, "+specs+" drafted; every plate is already generated."}); return;
  }
  ctx.emit({k:"act", t:"Generating "+plates.length+" plate"+(plates.length!==1?"s":"")+(variants.length?(" + "+variants.length+" variant"+(variants.length!==1?"s":"")):"")+"…"});
  let madeP=0, madeV=0;
  for(const l of (typeof locationGenerationOrder==="function"?locationGenerationOrder(plates):plates)){
    if(ctx.cancelled()){ ctx.emit({k:"flag", t:"Stopped — "+madeP+" plate"+(madeP!==1?"s":"")+", "+madeV+" variant"+(madeV!==1?"s":"")+" generated."}); return; }
    ctx.emit({k:"act", t:"Generating "+(l.name||"a location")+"'s plate…"});
    try{ if(await ls.generatePlate(l)===false)throw new Error("Generation did not complete; the existing plate is unchanged.");
      madeP++; ctx.emit({k:"ok", t:(l.name||"Location")+" — plate generated."}); }
    catch(e){ ctx.emit({k:"flag", t:"Couldn't generate "+(l.name||"the location")+"'s plate: "+((e&&e.message)||e)+". Moving on."}); }
  }
  for(const pair of variants){
    if(ctx.cancelled()){ ctx.emit({k:"flag", t:"Stopped — "+madeP+" plates, "+madeV+" variants generated."}); return; }
    const l=pair.l, v=pair.v;
    ctx.emit({k:"act", t:"Generating "+(l.name||"a location")+" — "+(v.time||"variant")+"…"});
    try{ if(await ls.generateVariant(l, v)===false)throw new Error("Generation did not complete; the existing plate is unchanged.");
      madeV++; ctx.emit({k:"ok", t:(l.name||"Location")+" — "+(v.time||"variant")+" generated."}); }
    catch(e){ ctx.emit({k:"flag", t:"Couldn't generate "+(l.name||"the location")+" — "+(v.time||"variant")+": "+((e&&e.message)||e)+"."}); }
  }
  if(ctx.art.markApplied && (ctx.force||specs||madeP||madeV)) ctx.art.markApplied("locations");
  ctx.emit({k:"done", t:"Locations scouted — "+added+" pulled, "+specs+" drafted, "+madeP+" plate"+(madeP!==1?"s":"")+" + "+madeV+" variant"+(madeV!==1?"s":"")+" generated. Tweak any in the Locations tab."});
}

async function agentVisualResearcher(ctx){
  const lb = ctx.art && ctx.art.lookbook;
  if(!lb){
    ctx.emit({k:"flag", t:"Lookbook workspace unavailable."});
    ctx.emit({k:"done", t:"Nothing to do."}); return;
  }
  if(!ctx.ai || !ctx.ai.available){
    ctx.emit({k:"flag", t:"The writing model isn't available — the Visual Researcher needs it to research the look."});
    ctx.emit({k:"done", t:"Aborted."}); return;
  }
  ctx.emit({k:"plan", t:"Researching the film's visual language — writing the look statement, gathering/deduping reference touchstones across every department (palette, lighting, lens, texture, plus wardrobe for the cast and production design for props & sets), and proposing the film's RENDER STYLE from the story (approval-gated — a yes sets every character/prop/location style dropdown in one pass). Use “Generate all frames” afterwards when you want to render mood frames."});

  // 0) REPAIR — a lookbook that outgrew its 8-touchstone brief (the pre-guard
  // growth bug stacked +8 cards per re-run). Approval-gated: keeps every hand-added
  // card, every rendered frame and one reference per category; proposes dropping
  // the excess so users never prune the wall by hand.
  if(typeof lb.trimPlan==="function" && typeof lb.applyTrim==="function"){
    let plan=null;
    try{ plan = await lb.trimPlan(); }catch(e){}
    if(plan && plan.drop && plan.drop.length){
      ctx.emit({k:"observe", t:"This lookbook holds "+(plan.keep.length+plan.drop.length)+" references — far past its 8-touchstone brief (an earlier bug let every re-run add more). "+plan.drop.length+" are excess: agent-added, no rendered frame, category already covered."});
      const ok = await ctx.propose({
        title:"Trim the lookbook back to its brief",
        reason:"The brief is 8 touchstones covering the categories; the excess cards only multiply “missing frame” counts and generation costs.",
        rationale:"Keeps every hand-added reference, every card with a rendered mood frame, and one reference per category ("+plan.keep.length+" stay). Removes "+plan.drop.length+" excess unrendered card"+(plan.drop.length!==1?"s":"")+": "+plan.drop.slice(0,8).map(c=>c.source).join(", ")+(plan.drop.length>8?"…":"")+".",
        before: (plan.keep.length+plan.drop.length)+" reference cards",
        after: plan.keep.length+" reference cards — the brief, nothing more",
      });
      if(ctx.cancelled()) return;
      if(ok){ const n = lb.applyTrim(plan); ctx.emit({k:"ok", t:"Trimmed "+n+" excess reference"+(n!==1?"s":"")+" — the lookbook is back to its brief."}); }
      else ctx.emit({k:"flag", t:"Trim declined — every card stays."});
    }
  }
  if(ctx.cancelled()) return;

  // DUPLICATION GUARD — completed research is never re-run: the look statement stands
  // and every category already holds a noted touchstone, so a re-run would only spend a
  // writing call re-proposing the same wall (and re-offer the render style the user has
  // already settled). This also covers every "Run pre-production" re-run, which chains
  // this agent first. To research from scratch, clear the look statement first.
  if(typeof lb.researched==="function" && lb.researched()){
    let todo=[]; try{ todo = await lb.toGenerate(); }catch(e){}
    ctx.emit({k:"observe", t:"This lookbook is already researched — the look statement is written and every category holds a noted touchstone. Skipping re-research so nothing duplicates."});
    ctx.emit({k:"done", t:"Visual research already complete — nothing re-run."
      +(todo.length?(" “Generate all frames” will render "+todo.length+" missing mood frame"+(todo.length!==1?"s":"")+"."):" Every mood frame is rendered.")
      +" To research the look from scratch, clear the look statement in the Lookbook and run again."});
    return;
  }

  // 1) research: statement + reference entries, written through to the Colorist
  ctx.emit({k:"act", t:"Reading the story, writing the look statement, gathering references…"});
  let res;
  try{ res = await lb.research(); }
  catch(e){ ctx.emit({k:"flag", t:"Research hit an error: "+((e&&e.message)||e)}); }
  if(res && res.statement) ctx.emit({k:"observe", t:"Look statement — "+res.statement.slice(0,150)});
  ctx.emit({k:"observe", t:(res&&res.added ? ("Gathered "+res.added+" reference"+(res.added!==1?"s":"")) : "References already gathered")+" — the colour system (the Color tab) reads these directly when it designs the palette."});
  if(ctx.cancelled()) return;

  // 2) RENDER STYLE — the researcher also proposes the film's MEDIUM (one unified pick
  // from the shared style registry, grounded in the story). Approval-gated: a yes sets
  // the style dropdown on every character, prop and location in one pass; per-card
  // dropdowns stay available as the override afterwards.
  if(res && res.renderStyle && res.renderStyle.key && typeof lb.applyRenderStyle==="function"){
    const rs = res.renderStyle;
    const before = (typeof lb.currentStyleLabel==="function") ? lb.currentStyleLabel() : "current per-card picks";
    ctx.emit({k:"observe", t:"Render style proposal — “"+rs.label+"”: "+(rs.why||"grounded in the story's tone and world.")});
    const ok = await ctx.propose({
      title:"Render style — "+rs.label,
      reason:"One unified visual MEDIUM for the whole film, proposed from the story (a different axis from palette/grade — the Colorist still grades every scene on top of it).",
      rationale: rs.why || "Grounded in the story's tone and world.",
      before: "Style dropdowns now: "+before,
      after: "Every character, prop and location set to “"+rs.label+"” — sheets, plates and shot frames all speak this language; any card's dropdown can still override it.",
    });
    if(ctx.cancelled()) return;
    if(ok){
      const n = lb.applyRenderStyle(rs.key) || {};
      ctx.emit({k:"ok", t:"Render style “"+rs.label+"” applied — "+(n.characters||0)+" character"+((n.characters||0)!==1?"s":"")+", "+(n.props||0)+" prop"+((n.props||0)!==1?"s":"")+", "+(n.locations||0)+" location"+((n.locations||0)!==1?"s":"")+". Regenerate sheets and plates to see it."});
    } else {
      ctx.emit({k:"flag", t:"Render style proposal declined — every style dropdown stays as it is."});
    }
  }

  let todo=[];
  try{ todo = await lb.toGenerate(); }catch(e){}
  ctx.emit({k:"done", t:"Lookbook researched — "+((res&&res.added)||0)+" new reference"+((res&&res.added)===1?"":"s")+" added. "+(todo.length?("Generate all frames will render "+todo.length+" missing mood frame"+(todo.length!==1?"s":"")+"."):"Every mood frame is already rendered.")});
}

async function agentDepartmentCoordinator(ctx){
  // The meta-agent: chains seven steps in dependency order — Lookbook, Characters, Props,
  // Wear props, Locations, Colour, Shot coverage — hands-off: every proposal is approved
  // automatically (autoApprove), except that the Shot Designer leaves scenes with approved
  // or locked shots alone. It renders NO shot frames and composes NO storyboard.
  const steps = [
    ["Lookbook",   agentVisualResearcher],
    ["Characters", agentCastingDirector],
    ["Props",      agentPropsMaster],
    ["Wear props", agentWearProps],
    ["Locations",  agentLocationScout],
    ["Colour",     agentColorist],
    ["Shots",      agentShotDesigner],
  ];
  ctx.emit({k:"plan", t:"Running the whole pre-production pipeline in dependency order — the lookbook first (it steers the look), then the CAST, then the PROPS (each worn/owned prop references its owner's sheet so it matches that character), then DRESSING the cast in their finalized worn props, then locations, then the colour system, then shot coverage. It runs end to end WITHOUT stopping — the colour and shot-coverage steps are applied automatically, no approval needed. Press Stop anytime."});
  // each sub-agent emits its own k:"done" when its stage finishes — relabel those to k:"ok"
  // so each stage reads as one completed step and only THIS coordinator emits the final done.
  // propose() is auto-approved so the two gated steps (Colour, Shots) apply without pausing.
  const subCtx = Object.assign({}, ctx, {
    emit:(e)=> ctx.emit((e && e.k==="done") ? Object.assign({}, e, {k:"ok"}) : e),
    propose:()=> Promise.resolve(true),
    autoApprove:true,   // steps that would change your approved work hold back (Shot Designer)
  });
  let n=0;
  for(const step of steps){
    if(ctx.cancelled()){ ctx.emit({k:"flag", t:"Stopped — completed "+n+" of "+steps.length+" steps."}); return; }
    n++;
    ctx.emit({k:"act", t:"▸ Step "+n+"/"+steps.length+" — "+step[0]+"…"});
    try{ await step[1](subCtx); }
    catch(e){ ctx.emit({k:"flag", t:step[0]+" step hit an error: "+((e&&e.message)||e)+". Continuing with the next."}); }
  }
  if(ctx.cancelled()){ ctx.emit({k:"flag", t:"Stopped — completed "+n+" of "+steps.length+" steps."}); return; }
  ctx.emit({k:"done", t:"Pre-production complete — lookbook, cast, props, wardrobe, locations, colour and shot coverage, built in order. Shot frames and storyboards aren't rendered by this run: render the frames from the Shots tab (Generate all shots, or Render Scene in order), then compose the boards in Storyboards."});
}


/* ---- Consistency Check — the scene-progression auditor. Rule-based and FREE
   (no model calls): the script/beats are canon, so every downstream layer —
   prop cards, the location bible, staging, render styles, pronouns — is diffed
   against them. Unambiguous repairs become approval cards; judgement calls are
   flagged for the writer. Since 2026-09-26 it runs in two scopes: the story checks
   are the Writers' Room's Consistency Check, the production checks are the second
   half of the Art Room's Production check (see agentProductionCheck). ---- */

const _consEsc = (s)=> String(s||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const _consCap = (s)=> s.charAt(0).toUpperCase()+s.slice(1);
/* verb agreement for they→he/she rewrites: present-tense verbs gain -s; past
   tense (regular -ed + common irregulars) passes through. Every rewrite is
   approval-gated with before/after shown, so a rare miss is rejectable. */
const _CONS_PAST = new Set(("went ran sat stood fell rose came left took drew held kept knelt lay said saw sank spoke froze crept slid swung threw clung dug hid shrank bent leant meant wept swept caught fought brought thought bought stole broke chose wore tore bore drove strode struck stuck sprang spun flung hung found ground wound bound heard made had did got gave put set let cut shut hit split spread burst cast felt dealt met led fed fled bled sped read").split(" "));
function _consConj(v){
  const w = v.toLowerCase();
  if(w==="are") return "is"; if(w==="were") return "was"; if(w==="have") return "has";
  if(w==="do") return "does"; if(w==="don't") return "doesn't"; if(w==="aren't") return "isn't";
  if(/ed$/.test(w) || _CONS_PAST.has(w)) return v;
  if(/(s|x|z|ch|sh)$/.test(w)) return v+"es";
  if(/[^aeiou]y$/.test(w)) return v.replace(/y$/,"ies");
  return v+"s";
}
const _CONS_GENDER = { "he/him":{subj:"he",obj:"him",poss:"his",self:"himself"},
                       "she/her":{subj:"she",obj:"her",poss:"her",self:"herself"} };
function _consRewriteSentence(s, g){
  let t = s;
  t = t.replace(/\bThey\b\s+([A-Za-z']+)/g, (m,v)=> _consCap(g.subj)+" "+_consConj(v));
  t = t.replace(/\bthey\b\s+([A-Za-z']+)/g, (m,v)=> g.subj+" "+_consConj(v));
  t = t.replace(/\bTheir\b/g, _consCap(g.poss)).replace(/\btheir\b/g, g.poss);
  t = t.replace(/\bthemselves\b/g, g.self).replace(/\bThemselves\b/g, _consCap(g.self));
  t = t.replace(/\bthem\b/g, g.obj).replace(/\bThem\b/g, _consCap(g.obj));
  return t;
}
/* rewrite one action block: track the running subject (the last sentence that
   named exactly ONE cast member); they/them under a gendered subject is
   rewritten, under a genuinely-they/them character it's left alone, with no
   resolvable subject it's flagged. */
function _consFixBlockPronouns(text, cast){
  const sentences = String(text||"").split(/(?<=[.!?…])\s+/);
  let subject = null, changed = false, ambiguous = 0;
  const out = sentences.map(s=>{
    const named = cast.filter(c=> new RegExp("\\b"+_consEsc(c.name)+"(?:'s)?\\b","i").test(s));
    if(named.length===1) subject = named[0];
    else if(named.length>1) subject = null;
    if(!/\b(they|them|their|theirs|themselves)\b/i.test(s)) return s;
    if(/\b(both|two of them|all of them)\b/i.test(s)) return s;
    if(!subject){ ambiguous++; return s; }
    if(!subject.g) return s;                       // character IS they/them — correct as written
    changed = true;
    return _consRewriteSentence(s, subject.g);
  });
  return { text: out.join(" "), changed, ambiguous };
}
const _CONS_CARRY = /\b(cups?|cupped|holds?|held|lifts?|lifted|carries|carried|cradles?|cradled|grips?|gripped|clutch(?:es)?|clutched|draws?|drew|pockets?|pocketed|clasps?|clasped|raises?|raised|snatch(?:es)?|snatched|grabs?|grabbed)\b/i;
const _CONS_FIXTURE = /\b(strung|hung|hangs?|hanging|mounted|nailed|bolted|anchored|staked|planted|stands|built into|embedded|fixed to)\b/i;
const _consWords = (name)=> String(name||"").toLowerCase().split(/[^a-z0-9-]+/).filter(w=>w.length>3);
function _consMentions(text, prop){
  const t = String(text||"").toLowerCase();
  const head = (typeof propHeadNoun==="function" ? propHeadNoun(prop.name) : "");
  return (head && t.indexOf(head)>=0) || _consWords(prop.name).some(w=> t.indexOf(w)>=0);
}
const _consTruncated = (v)=> { const t=String(v||"").trim(); return t.length>=180 && /[A-Za-z]$/.test(t) && !/(etc|vs|no)\.$/.test(t); };

/* optimal-string-alignment distance (Levenshtein + adjacent transposition) —
   tiny strings only; powers the cast-name spelling lint ("Plamer"→"Palmer"=1). */
function _consOSA(a,b){
  const m=a.length,n=b.length; if(Math.abs(m-n)>2) return 9;
  const d=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);
  for(let j=0;j<=n;j++) d[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++){
    const c = a[i-1]===b[j-1]?0:1;
    d[i][j]=Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+c);
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]) d[i][j]=Math.min(d[i][j], d[i-2][j-2]+1);
  }
  return d[m][n];
}
async function agentConsistency(ctx, opts){
  // SCOPE (2026-09-26, owner-approved): "story" is the Writers' Room Consistency Check —
  // cast-name spelling, beat tags, time-of-day jumps, app vocabulary on the page and the
  // cast's argument. "production" is the second half of the Art Room's Production check —
  // unslugged spaces, they/them lines, props, locations, render styles, wardrobe, shots
  // and the beat lint. No scope runs every check (tests). noDone: the caller closes the run.
  opts = opts || {};
  const story = opts.scope!=="production", prod = opts.scope!=="story";
  const MAX_CARDS = 12;
  const bible = ctx.bible || { props:[], locations:[], shots:[], patchProp:()=>{}, patchLocation:()=>{} };
  const cast = ctx.model.characters.map(c=>({ id:c.id, name:c.name, styleKey:c.renderStyleKey||"",
    g:_CONS_GENDER[String(c.pronouns||"").toLowerCase().trim()]||null, pronouns:c.pronouns||"" }));
  const drafted = scenesInStoryOrder(ctx.model.scenes)
    .filter(s=> ctx.model.drafts[s.id] && (ctx.model.drafts[s.id].blocks||[]).length);
  const nSc = drafted.length+" drafted scene"+(drafted.length===1?"":"s");
  ctx.emit({k:"plan", t: !prod
    ? "Auditing "+nSc+" for story consistency — cast-name spelling, beat tags, time-of-day jumps, app vocabulary on the page and the cast's argument. No model calls, so this pass is free."
    : !story
    ? "Holding "+nSc+" to the script — unslugged spaces, they/them lines, props, locations, render styles, wardrobe and shots. No model calls, so this pass is free."
    : "Auditing "+nSc+" — the script and beats are canon; props, locations, staging, styles and pronouns are diffed against them. No model calls, so this pass is free."});
  if(!drafted.length){ if(!opts.noDone) ctx.emit({k:"done", t:"No drafted scenes to audit yet — write or draft a scene first."}); return { fixes:0, flags:0, cards:0 }; }
  let cards = 0, flags = 0, fixes = 0;

  /* 0.4 — TIME-OF-DAY CONTINUITY: consecutive scenes whose sluglines hard-flip the
     clock (DAY→NIGHT or back) with no time-passage cue in either scene read as a
     continuity error on screen — professional scripts either signal the jump
     ("LATER", "the next morning") or keep the clock. Conservative: only DAY-class ↔
     NIGHT-class flips are flagged, and any passage cue in either scene's slugline,
     summary or script clears it. Flag-only (a judgement call, never auto-fixed). */
  if(story) (function(){
    const cls = (loc)=>{ const m=String(loc||"").toUpperCase();
      if(/\b(NIGHT|EVENING|DUSK|MIDNIGHT)\b/.test(m)) return "NIGHT";
      if(/\b(DAY|MORNING|DAWN|NOON|AFTERNOON)\b/.test(m)) return "DAY";
      return null; };
    const cue = /\b(later|earlier|next (morning|day|night|evening)|that (night|evening|morning|afternoon)|hours?|dawn|sunset|sunrise|nightfall|midnight|the following|by (night|day|morning|evening)|after dark|days? (pass|later)|weeks? (pass|later)|months? (pass|later)|meanwhile|same time|continuous)\b/i;
    let n=0;
    for(let i=1; i<drafted.length && n<5; i++){
      const a=drafted[i-1], b=drafted[i];
      const ca=cls(a.loc), cb=cls(b.loc);
      if(!ca || !cb || ca===cb) continue;
      const textA=((ctx.model.drafts[a.id]||{}).blocks||[]).map(x=>x.text).join(" ").slice(-400);
      const textB=((ctx.model.drafts[b.id]||{}).blocks||[]).map(x=>x.text).join(" ").slice(0,600);
      const hay=[a.loc,b.loc,a.summary||"",b.summary||"",textA,textB].join(" · ");
      if(cue.test(hay)) continue;
      n++; flags++;
      ctx.emit({k:"flag", t:"Sc "+a.no+" ("+ca+") → Sc "+b.no+" ("+cb+"): the clock hard-flips with no time-passage cue in either scene. Signal the jump (“LATER”, “the next morning” in the slugline or action) or align the sluglines’ time of day."});
    }
  })();

  for(const scene of drafted){
    if(ctx.cancelled()) return;
    // LIVE SCENE (fixed 2026-09-26): every approved fix lands on the CURRENT draft and the
    // next check reads it again. Each fix used to rebuild from the scene's original text,
    // so approving several in one scene kept only the last (the beat re-map even reverted
    // typo fixes) and a slugline insert shifted the lines the pronoun fix then edited.
    let draft = ctx.model.drafts[scene.id];
    let blocks = draft.blocks||[];
    let scriptText = blocks.map(b=>b.text).join(" ");
    const refresh = ()=>{ draft = ctx.model.drafts[scene.id] || draft; blocks = draft.blocks||[]; scriptText = blocks.map(b=>b.text).join(" "); };
    const sceneProps = bible.props.filter(p=> Array.isArray(p.scenes) && p.scenes.indexOf(scene.id)>=0);
    const loc = (typeof locationForScene==="function") ? locationForScene(bible.locations, scene.id) : null;
    const sceneShots = bible.shots.filter(sh=> sh.sceneId===scene.id);
    const rosterIds = (typeof sceneRoster==="function") ? sceneRoster(scene, ctx.model.characters, ctx.model.drafts, sceneShots) : [];
    const sceneIssues = [];

    /* 0.2 — CAST-NAME SPELLING: hand edits misspell names ("Winson", "PLAMER"),
       and a misspelled name silently breaks scene-roster detection, identity
       references and renders. A capitalized token that NEAR-matches one cast
       name part (edit distance 1, or 2 for 7+ letters, same first letter) and
       exactly matches NO cast/prop/location word is almost certainly a typo —
       one approval fixes every occurrence in the scene's script AND beats.
       Deterministic, no model calls. */
    if(story && cards < MAX_CARDS){
      const bmSp = ctx.model.beats[scene.id] || {};
      const beatText = [bmSp.desire,bmSp.obstacle,bmSp.driverLabel,bmSp.reactorLabel]
        .concat((bmSp.rows||[]).reduce((a,r)=>a.concat([r.drive&&r.drive.a,r.drive&&r.drive.d,r.react&&r.react.a,r.react&&r.react.d]),[]))
        .filter(Boolean).join(" ");
      const hay = scriptText+" "+beatText;
      const legit = new Set();
      const addParts=(nm)=>String(nm||"").split(/[^A-Za-z']+/).forEach(w=>{ if(w) legit.add(w.toLowerCase()); });
      cast.forEach(c=>addParts(c.name));
      bible.props.forEach(pp=>addParts(pp.name));
      bible.locations.forEach(l=>addParts(l.name));
      addParts(scene.loc); addParts(scene.title);
      const nameParts=[]; cast.forEach(c=>String(c.name||"").split(/[^A-Za-z']+/).forEach(w=>{ if(w.length>=4) nameParts.push({ part:w, name:c.name }); }));
      // common capitalized-at-sentence-start words that sit one letter from many
      // names — never propose these ("Water" is not a typo of WALTER)
      const STOP=new Set(("water,walter,there,their,then,than,them,they,when,where,what,while,which,would,could,should,about,after,before,"+
        "again,against,under,over,other,every,never,going,being,doing,having,taking,making,coming,leaving,looking,turning,morning,"+
        "night,light,right,street,shop,door,counter,first,last,still,while,white,black,brown,green,grey,gray,stone,house,hands,"+
        "watch,watches,words,world,thing,things,place,front,behind,beside,inside,outside,through,across,around,toward,towards").split(","));
      const seenTok=new Set(); const typos=[];
      (hay.match(/\b[A-Za-z][A-Za-z']{3,}\b/g)||[]).forEach(tok=>{
        const low=tok.toLowerCase();
        if(seenTok.has(low)) return; seenTok.add(low);
        if(legit.has(low) || STOP.has(low)) return;
        for(const pd of nameParts){
          const pl=pd.part.toLowerCase();
          if(pl[0]!==low[0]) continue;
          const dist=_consOSA(low,pl);
          if(dist>0 && dist<=(pl.length>=7?2:1)){ typos.push({ tok, part:pd.part, name:pd.name }); break; }
        }
      });
      for(const t of typos.slice(0,3)){
        if(ctx.cancelled()) return;
        if(cards>=MAX_CARDS) break;
        cards++;
        const rx = new RegExp("\\b"+t.tok.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","g");
        const rep = (t.tok===t.tok.toUpperCase()) ? t.part.toUpperCase() : t.part;
        const count=(hay.match(rx)||[]).length;
        const ok = await ctx.propose({ title:"Sc "+scene.no+" \u2014 \u201c"+t.tok+"\u201d looks like a misspelling of "+t.name.toUpperCase(),
          reason:"\u201c"+t.tok+"\u201d appears "+count+"\u00d7 in this scene's script/beats but exactly matches no cast, prop or location name \u2014 a letter away from "+t.name.toUpperCase()+". A misspelled name breaks roster detection, identity references and renders.",
          rationale:"Approve to replace every \u201c"+t.tok+"\u201d in Sc "+scene.no+"'s script and beats with \u201c"+rep+"\u201d. Reject if it's intentional (a nickname or different person) \u2014 then add them properly in the Writers' Room instead.",
          before:t.tok+" \u00d7"+count, after:rep });
        if(ctx.cancelled()) return;
        if(ok){
          const fix=(x)=> typeof x==="string" ? x.replace(rx,rep) : x;
          refresh();
          ctx.model.drafts[scene.id] = { ...draft, blocks: blocks.map(b=>({ ...b, text:fix(b.text) })) };
          const nb = ctx.model.beats[scene.id];
          if(nb){ ctx.model.beats[scene.id] = { ...nb, desire:fix(nb.desire), obstacle:fix(nb.obstacle),
            driverLabel:fix(nb.driverLabel), reactorLabel:fix(nb.reactorLabel),
            rows:(nb.rows||[]).map(r=>({ ...r,
              drive:{ ...(r.drive||{}), a:fix(r.drive&&r.drive.a), d:fix(r.drive&&r.drive.d) },
              react:{ ...(r.react||{}), a:fix(r.react&&r.react.a), d:fix(r.react&&r.react.d) } })) }; }
          ctx.sync(); fixes++; refresh();
          ctx.emit({k:"ok", t:"Sc "+scene.no+": \u201c"+t.tok+"\u201d \u2192 \u201c"+rep+"\u201d \u2014 "+count+" occurrence"+(count===1?"":"s")+" fixed."});
        }
      }
    }

    /* 0 — BEAT MAPPING: the drafting model sometimes tags script blocks by POSITION
       (one beat per block, tail unmapped) instead of content. Shots, storyboards and
       dialogue-speaker lookups all read the script through these tags, so drift here
       skews everything downstream. Free, deterministic re-alignment (realignBlockBeats)
       — content match, story order preserved, script text untouched. */
    refresh();
    const bmEntry = ctx.model.beats[scene.id] || {};
    if(story && typeof window.realignBlockBeats==="function" && (bmEntry.rows||[]).length && blocks.length && cards<MAX_CARDS){
      const fixed = window.realignBlockBeats(blocks, bmEntry);
      const moved = fixed.reduce((a,b,i)=> a + ((blocks[i] && Number(blocks[i].beat)!==Number(b.beat)) ? 1 : 0), 0);
      if(moved >= 2){
        cards++;
        const ok = await ctx.propose({ title:"Sc "+scene.no+" — script blocks mis-mapped to beats",
          reason: moved+" of "+blocks.length+" script blocks carry the wrong beat number, so shot cards, storyboards and dialogue-speaker lookups read the wrong script excerpt for their beat.",
          rationale:"Re-maps every block to the beat whose drive/reaction it actually dramatizes (content match, story order preserved). The script text itself is untouched — only the margin mapping changes.",
          before:"beat tags: "+blocks.map(b=> b.beat==null ? "—" : b.beat).join(" · "),
          after:"beat tags: "+fixed.map(b=>b.beat).join(" · ") });
        if(ctx.cancelled()) return;
        if(ok){ ctx.model.drafts[scene.id] = { ...draft, blocks:fixed }; ctx.sync(); fixes++; refresh();
          ctx.emit({k:"ok", t:"Sc "+scene.no+": beat mapping re-aligned — "+moved+" block"+(moved===1?"":"s")+" re-tagged."}); }
      }
    }

    /* 0.5 — IMPLIED SPACE NEVER SLUGGED. A scene often plays partly inside a space the
       page never slugs ("Behind the booth glass, ODESSA…"). That space is a real set with
       its own walls, light and geography, but because locations DERIVE FROM SLUGLINES it
       gets no card, no plate and no coverage — it is invisible to the whole Art Room.
       The fix belongs in the screenplay, not in a parallel art record: slug it, and the
       existing derive → draft → plate → shots chain picks it up with no new plumbing.
       Deterministic (this tier makes no model calls); one card per scene. */
    if(prod && cards < MAX_CARDS && typeof window.findImpliedSpaces==="function"){
      refresh();
      let implied = [];
      try{ implied = window.findImpliedSpaces(scene, blocks) || []; }catch(e){ implied = []; }
      // don't propose a space that already has its own location card
      implied = implied.filter(sp=>{
        const n = String(sp.name||"").toUpperCase();
        return !(bible.locations||[]).some(l=> String(l.name||"").toUpperCase()===n);
      });
      if(implied.length){
        cards++;
        const lines = implied.map(sp=> window.impliedSpaceSlugline(sp)+"   ← from: \u201c"+sp.evidence+"\u201d");
        const ok = await ctx.propose({ writes:"script",
          title:"Scene "+scene.no+" \u2014 slug the space"+(implied.length>1?"s":"")+" the action plays inside",
          reason:implied.length+" enclosed space"+(implied.length===1?" is":"s are")+" played in but never slugged, so "+(implied.length===1?"it gets":"they get")+" no location card, no plate and no shot coverage.",
          rationale:"Locations are derived from sluglines, so an unslugged space is invisible to the Art Room. Adding the heading is how the screenplay says \u201cwe cut inside here\u201d \u2014 and it makes the set designable. Time of day is inherited from the scene heading; nothing else in the page changes.",
          before:implied.map(sp=>sp.evidence).join("\n\n"),
          after:lines.join("\n\n") });
        if(ctx.cancelled()) return;
        if(ok){
          // insert each heading BEFORE the first block that plays inside that space.
          // Walk high index → low so earlier insertions don't shift later targets.
          const nb = blocks.slice();
          implied.slice().sort((a,b)=>b.atIndex-a.atIndex).forEach(sp=>{
            const at = Math.max(0, Math.min(nb.length, sp.atIndex));
            nb.splice(at, 0, { beat:(nb[at]&&nb[at].beat)||1, type:"scene", text:window.impliedSpaceSlugline(sp) });
          });
          ctx.model.drafts[scene.id] = {...draft, blocks:nb, edited:true};
          ctx.sync(); fixes++; refresh();   // the insert was never synced, so it was lost unless a later fix committed it
          ctx.emit({k:"ok", t:"Scene "+scene.no+" \u2014 slugged "+implied.map(sp=>sp.name).join(", ")+". Run \u201cDesign all locations\u201d to build the new set."});
        } else sceneIssues.push("implied space left unslugged");
      }
    }

    /* 1 — PRONOUNS: they/them action lines under a gendered character starve the
       image & video models of usable info. */
    refresh();
    let pronounBlocks = [], ambiguous = 0;
    if(prod) blocks.forEach((b,i)=>{
      if(b.type!=="action") return;
      const r = _consFixBlockPronouns(b.text, cast);
      ambiguous += r.ambiguous;
      if(r.changed) pronounBlocks.push({ i, before:b.text, after:r.text });
    });
    if(pronounBlocks.length && cards<MAX_CARDS){
      cards++;
      const ok = await ctx.propose({ writes:"script",
        title:"Scene "+scene.no+" — use the cast's real pronouns",
        reason:pronounBlocks.length+" action line"+(pronounBlocks.length===1?"":"s")+" say they/them for a character whose sheet is gendered — ambiguous for the image and video models.",
        rationale:"Rewritten from the cast bible ("+cast.filter(c=>c.g).map(c=>c.name+" "+c.pronouns).join(", ")+"). Characters whose pronouns really are they/them are left untouched.",
        before:pronounBlocks.map(p=>p.before).join("\n\n"),
        after:pronounBlocks.map(p=>p.after).join("\n\n") });
      if(ok){
        const nb = blocks.map((b,i)=>{ const p = pronounBlocks.find(x=>x.i===i); return p ? {...b, text:p.after} : b; });
        ctx.model.drafts[scene.id] = {...draft, blocks:nb, edited:true};
        ctx.sync(); fixes++; refresh();
        ctx.emit({k:"ok", t:"Scene "+scene.no+": pronouns now match the cast bible."});
      }
    }
    refresh();   // the read-only checks below see the script as fixed
    if(ambiguous){ flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · "+ambiguous+" sentence"+(ambiguous===1?"":"s")+" use they/them with no clear subject — name who acts so the shot prompts stay unambiguous."}); }

    if(ctx.cancelled()) return;

    if(prod){
    /* 2 — PROP TYPE vs the script's verbs: cupped/lifted/carried by someone ⇒ a
       carried prop with that owner; strung/mounted/planted ⇒ set dressing. */
    for(const p of sceneProps){
      if(ctx.cancelled()) return;
      const sentences = scriptText.split(/(?<=[.!?…])\s+/).filter(s=> _consMentions(s,p));
      if(!sentences.length){
        flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · \""+p.name+"\" is mapped to this scene but the script never names it — stale mapping, or the script lost it."});
        continue;
      }
      let carrier = null, fixture = false;
      // the carry verb must act ON THIS PROP (verb directly before its noun) — a shared
      // sentence isn't evidence ("Morwen lifts the flower toward the lantern" must never
      // flag the LANTERN as carried)
      const heads = [(typeof propHeadNoun==="function" ? propHeadNoun(p.name) : ""), ..._consWords(p.name)].filter(Boolean);
      const carryOnProp = new RegExp(_CONS_CARRY.source.replace(/^\\b|\\b$/g,"")+"\\s+(?:\\w+\\s+){0,3}?(?:"+heads.map(_consEsc).join("|")+")","i");
      sentences.forEach(s=>{
        if(carryOnProp.test(s)){ const who = cast.find(c=> new RegExp("\\b"+_consEsc(c.name)+"\\b","i").test(s)); if(who) carrier = carrier||who; }
        if(_CONS_FIXTURE.test(s)) fixture = true;
      });
      if(carrier && fixture){ flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · \""+p.name+"\": the script shows it both handled and fixed in place — decide its home yourself."}); }
      else if(carrier && (p.kind!=="carried" || p.ownerId!==carrier.id) && cards<MAX_CARDS){
        cards++;
        const ok = await ctx.propose({ writes:"art",
          title:"Scene "+scene.no+" — \""+p.name+"\" is carried by "+carrier.name,
          reason:"The script shows "+carrier.name+" handling it (“"+sentences.find(s=>_CONS_CARRY.test(s)).trim().slice(0,110)+"”) but the card says "+(p.kind==="dressing"?"set dressing":(p.kind||"carried")+(p.ownerName?" · "+p.ownerName:" · unassigned"))+".",
          rationale:"An object a character handles is a prop with an owner — never part of the location. Its sheet will reference "+carrier.name+"'s look.",
          before:(p.kind==="dressing"?"Set dressing":_consCap(p.kind||"carried"))+(p.ownerName?" · "+p.ownerName:p.kind==="dressing"?"":" · unassigned"),
          after:"Carried · "+carrier.name });
        if(ok){ bible.patchProp(p.id, { kind:"carried", kindSet:true, ownerId:carrier.id, ownerName:carrier.name, locationId:"" }); fixes++;
          ctx.emit({k:"ok", t:"\""+p.name+"\" → carried · "+carrier.name+"."}); }
      }
      else if(!carrier && fixture && p.kind!=="dressing" && cards<MAX_CARDS){
        cards++;
        const ok = await ctx.propose({ writes:"art",
          title:"Scene "+scene.no+" — \""+p.name+"\" is part of the set",
          reason:"The script shows it fixed in place, but the card says "+(p.kind||"carried")+(p.ownerName?" · "+p.ownerName:"")+".",
          rationale:"Fixtures render into the location plate and inherit its style — they don't need a hand or an owner.",
          before:_consCap(p.kind||"carried")+(p.ownerName?" · "+p.ownerName:""),
          after:"Set dressing"+(loc?(" · fixture of "+loc.name):"") });
        if(ok){ bible.patchProp(p.id, { kind:"dressing", kindSet:true, ownerId:"", ownerName:"", locationId:(loc&&loc.id)||"" }); fixes++;
          ctx.emit({k:"ok", t:"\""+p.name+"\" → set dressing"+(loc?(" at "+loc.name):"")+"."}); }
      }
      /* dressing prop with no home, in a scene that resolves to one location */
      if(p.kind==="dressing" && !p.locationId && loc && cards<MAX_CARDS){
        cards++;
        const ok = await ctx.propose({ writes:"art",
          title:"\""+p.name+"\" — pin its location",
          reason:"It's set dressing with no place to live, so it can't bake into any plate.",
          rationale:"Scene "+scene.no+" resolves to "+loc.name+" — the obvious home.",
          before:"Set dressing · no location", after:"Set dressing · fixture of "+loc.name });
        if(ok){ bible.patchProp(p.id, { locationId:loc.id }); fixes++; ctx.emit({k:"ok", t:"\""+p.name+"\" pinned to "+loc.name+"."}); }
      }
      /* owner not in the scene */
      if((p.kind==="carried"||p.kind==="worn") && p.ownerId && rosterIds.length && rosterIds.indexOf(p.ownerId)<0){
        flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · \""+p.name+"\" belongs to "+(p.ownerName||"someone")+", who isn't in this scene — check who actually has it here."});
      }
    }

    /* 3 — HANDHELD PROP BAKED INTO THE LOCATION: the giant-Moonpetal bug. */
    if(loc){
      const held = sceneProps.filter(p=> p.kind==="carried"||p.kind==="worn");
      const stg = (typeof stagingOf==="function") ? stagingOf(loc) : (loc.staging||{});
      const fields = [["architecture",loc.architecture],["materials",loc.materials],["lighting",loc.lighting],["significance",loc.significance],
        ["staging · background center",stg.bg&&stg.bg.center],["staging · background left",stg.bg&&stg.bg.left],["staging · background right",stg.bg&&stg.bg.right],
        ["staging · midground left",stg.mid&&stg.mid.left],["staging · midground right",stg.mid&&stg.mid.right]];
      held.forEach(p=>{
        const hits = fields.filter(([lab,v])=> v && _consMentions(v,p));
        if(hits.length){ flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · "+loc.name+"'s "+hits.map(h=>h[0]).join(", ")+" mention"+(hits.length===1?"s":"")+" \""+p.name+"\" — but the script shows it "+(p.kind==="worn"?"worn":"in a character's hands")+". Re-draft the location (the drafter now knows the rule) or edit the field so the prop isn't baked into the set at the wrong scale."}); }
      });
      /* truncated bible fields */
      [["architecture",loc.architecture],["materials",loc.materials],["lighting",loc.lighting],["significance",loc.significance]].forEach(([lab,v])=>{
        if(_consTruncated(v)){ flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · "+loc.name+"'s "+lab+" ends mid-sentence (“…"+String(v).trim().slice(-40)+"”) — an old draft cap cut it off; re-draft or finish the line."}); }
      });
    } else {
      flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · no location card resolves to this scene — check its slugline (the Locations tab builds its cards from sluglines)."});
    }

    /* 4 — RENDER-STYLE agreement: one film, one language. */
    const styled = []
      .concat(loc?[{kind:"loc", id:loc.id, name:loc.name, key:loc.renderStyleKey||""}]:[])
      .concat(rosterIds.map(id=>{ const c=cast.find(x=>x.id===id); return c&&{kind:"char", id:c.id, name:c.name, key:c.styleKey}; }).filter(Boolean))
      .concat(sceneProps.filter(p=>p.kind!=="worn").map(p=>({kind:"prop", id:p.id, name:p.name, key:p.renderStyleKey||""})))
      .filter(e=>e.key);
    const tally = {}; styled.forEach(e=>{ tally[e.key]=(tally[e.key]||0)+1; });
    const majority = Object.keys(tally).sort((a,b)=>tally[b]-tally[a])[0];
    const odd = styled.filter(e=>e.key!==majority);
    if(majority && odd.length && cards<MAX_CARDS){
      cards++;
      const lab = (k)=>{ const o=(window.CHAR_RENDER_STYLE_OPTIONS||[]).find(x=>x.key===k); return o?o.label.replace(/^[🔒🌐]\s*/,""):k; };
      const ok = await ctx.propose({ writes:"art",
        title:"Scene "+scene.no+" — "+odd.length+" card"+(odd.length===1?"":"s")+" speak a different render style",
        reason:"Most of this scene renders as \""+lab(majority)+"\", but "+odd.map(e=>e.name).join(", ")+" "+(odd.length===1?"is":"are")+" set to something else — frames will clash.",
        rationale:"Align the odd ones to the scene's majority. Pick a different style anytime from any card's dropdown.",
        before:odd.map(e=>e.name+" · "+lab(e.key)).join("\n"),
        after:odd.map(e=>e.name+" · "+lab(majority)).join("\n") });
      if(ok){
        odd.forEach(e=>{
          const styleText = (typeof window.renderStyleText==="function") ? window.renderStyleText(e.kind==="loc"?"loc":e.kind==="prop"?"prop":"char", majority) : "";
          if(e.kind==="prop") bible.patchProp(e.id, { renderStyleKey:majority, renderStyle:styleText });
          else if(e.kind==="loc") bible.patchLocation(e.id, { renderStyleKey:majority, renderStyle:styleText });
          else { const ch = ctx.model.characters.find(c=>c.id===e.id); if(ch){ ch.renderStyleKey=majority; ch.renderStyle=styleText; } }
        });
        if(odd.some(e=>e.kind==="char")) ctx.sync();
        fixes++; ctx.emit({k:"ok", t:"Scene "+scene.no+" now renders in one style."});
      }
    }

    /* 4b — WARDROBE DRIFT: a garment the script puts ON a character ("slides the
       knife back into his apron pocket") that the sheet's wardrobe doesn't carry —
       the sheet then renders the scene's continuity home missing. Deterministic:
       possessive + garment lexicon, attributed to the nearest PRECEDING cast name
       whose gender matches the possessive (the explicit-pronoun house rule makes
       that reliable). Approval appends the garment to the wardrobe field(s);
       regenerating the sheet stays the user's call (credits). */
    {
      const GARMENT_RX = /\b(his|her)\s+(?:[a-z][a-z-]*\s+){0,2}?(apron|hood|scarf|glove|gloves|mittens?|cap|hat|beanie|coat|overcoat|jacket|vest|waistcoat|boots|helmet|uniform|veil|cardigan|jumper|sweater|hoodie|overalls?|robe|cloak|gown|belt|sash|shawl|balaclava)\b/gi;
      // name forms per cast member: full name + tokens UNIQUE to them (a shared
      // family name must never claim the garment — the surname-safe rule)
      const _tok = (n)=>String(n||"").toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>=3);
      const _tokCount = {}; cast.forEach(c=> Array.from(new Set(_tok(c.name))).forEach(w=>{ _tokCount[w]=(_tokCount[w]||0)+1; }));
      const _forms = (c)=>{ const full=String(c.name||"").toLowerCase().trim();
        return Array.from(new Set([full, ..._tok(full).filter(w=>_tokCount[w]===1)])).filter(Boolean); };
      const lowText = scriptText.toLowerCase();
      const seenWd = new Set();
      let m2;
      GARMENT_RX.lastIndex = 0;
      while((m2 = GARMENT_RX.exec(scriptText))){
        const wantG = m2[1].toLowerCase()==="his" ? "m" : "f";
        const garment = m2[2].toLowerCase();
        // nearest preceding cast name with the matching gender
        let best = null;
        cast.forEach(c=>{
          if(!c.g || c.g!==wantG) return;
          _forms(c).forEach(nm=>{
            let from = 0, at = -1;
            while(true){ const i = lowText.indexOf(nm, from); if(i<0 || i>=m2.index) break; at = i; from = i+1; }
            if(at>=0 && (!best || at>best.at)) best = { at, c };
          });
        });
        if(!best) continue;
        const ch = ctx.model.characters.find(x=>x.id===best.c.id);
        if(!ch) continue;
        const stem = garment.replace(/s$/,"");
        const key = ch.id+"#"+stem;
        if(seenWd.has(key)) continue; seenWd.add(key);
        const have = ((ch.wardrobe||"")+" "+(ch.wardrobeMask||"")+" "+(ch.accessories||"")+" "+(ch.look||"")).toLowerCase();
        if(have.indexOf(stem)>=0) continue;
        if(cards>=MAX_CARDS) break;
        cards++;
        const excerpt = scriptText.slice(Math.max(0,m2.index-60), m2.index+m2[0].length+20).trim();
        const ok = await ctx.propose({ writes:"art",
          title:"Wardrobe drift — "+ch.name+" has no "+stem,
          reason:"Sc "+scene.no+" puts a "+stem+" on "+ch.name+" (\u201c\u2026"+excerpt.slice(0,110)+"\u2026\u201d) but their sheet's wardrobe doesn't carry one — the sheet renders the script's continuity home missing.",
          rationale:"Approve to append \u201ca worn "+stem+"\u201d to "+ch.name+"'s wardrobe so every future sheet and shot includes it. Regenerate the sheet when ready (not done automatically — it spends credits). Reject if the "+stem+" is scene-specific — then add it as an APPEARANCE STATE on the card instead.",
          before:(ch.wardrobeMask||ch.wardrobe||"(no wardrobe yet)").slice(0,90),
          after:"+ a worn "+stem });
        if(ctx.cancelled()) return;
        if(ok){
          const add = ", a worn "+stem;
          const i = ctx.model.characters.findIndex(x=>x.id===ch.id);
          if(i>=0){
            const cur = ctx.model.characters[i];
            const patch = {};
            if((cur.wardrobe||"").trim()) patch.wardrobe = cur.wardrobe.replace(/\.?\s*$/,"") + add;
            else patch.wardrobe = "a worn "+stem;
            if((cur.wardrobeMask||"").trim()) patch.wardrobeMask = cur.wardrobeMask.replace(/\.?\s*$/,"") + add;
            ctx.model.characters[i] = { ...cur, ...patch };
            ctx.sync(); fixes++;
            ctx.emit({k:"ok", t:ch.name+"'s wardrobe now carries the "+stem+" — regenerate their sheet to see it."});
          }
        }
      }
    }

    }   // end of the production-only checks 2, 3, 4 and 4b

    /* 4c — DEVELOPMENT-METADATA LEAK: app vocabulary that belongs in the beat map,
       not on the page — charge notation, beat numbers, turn flags. The screenplay
       must read clean to someone who never saw the app. Report-only. */
    if(story){
      const LEAK_RX = [
        [/\((?:[+\u2212\-]\d)\)/, "value-charge notation like \u201c(+2)\u201d"],
        [/\bbeat\s+\d+\b/i, "a beat number (\u201cbeat 3\u201d)"],
        [/\bturning point\b/i, "the app term \u201cturning point\u201d"],
        [/\bcontrolling idea\b/i, "the app term \u201ccontrolling idea\u201d"],
        [/\bvalue charge\b/i, "the app term \u201cvalue charge\u201d"],
      ];
      LEAK_RX.forEach(rx=>{
        const m = scriptText.match(rx[0]);
        if(m){ flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" \u00b7 the script contains "+rx[1]+" (\u201c\u2026"+scriptText.slice(Math.max(0,m.index-30), m.index+m[0].length+20).trim()+"\u2026\u201d) \u2014 development metadata never appears on the page; rewrite the line so the meaning is rendered as behavior."}); }
      });
    }

    /* 5 — SHOTS vs the script: the scene-3 stale-coverage bug. A shot's subjects come
       from who its action text names, so coverage drafted against an OLD script can
       silently drop a character, keep dead dialogue, or dress the wrong body. */
    if(prod && sceneShots.length){
      const subj = new Set(); sceneShots.forEach(sh=>(sh.subjects||[]).forEach(x=>subj.add(x)));
      const speakers = new Set(blocks.filter(b=>b.type==="char").map(b=>String(b.text||"").trim().toUpperCase().replace(/\s*\(.*\)$/,"")));
      rosterIds.forEach(id=>{
        if(subj.has(id)) return;
        const ch = cast.find(x=>x.id===id); if(!ch) return;
        const speaks = speakers.has(String(ch.name||"").toUpperCase());
        flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · "+ch.name+" is in this scene"+(speaks?" — with DIALOGUE —":"")+" but appears in none of its "+sceneShots.length+" shots. The coverage likely predates the script; re-draft this scene's shots."});
      });
      const _norm = (s)=> String(s||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
      const scriptDia = blocks.filter(b=>b.type==="dia").map(b=>_norm(b.text));
      const stale = sceneShots.filter(sh=>{ const d=_norm(sh.dialogue); if(!d || d.length<8) return false;
        return !scriptDia.some(x=> x.includes(d) || d.includes(x)); });
      if(stale.length){ flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · "+stale.length+" of "+sceneShots.length+" shots carry dialogue that isn't in the current script (e.g. “"+String(stale[0].dialogue||"").slice(0,60)+"”) — the shot list predates the script; re-draft the scene's coverage."}); }
      bible.props.filter(p=>p.kind==="worn" && p.ownerId).forEach(p=>{
        const hits = sceneShots.filter(sh=> _consMentions(String(sh.action||"")+" "+String(sh.composition||""), p) && (sh.subjects||[]).indexOf(p.ownerId)<0);
        if(hits.length){ flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · "+hits.length+" shot"+(hits.length===1?"":"s")+" describe \""+p.name+"\" without its owner "+(p.ownerName||"its owner")+" in frame — the item may be rendered on the wrong character; re-draft or edit those shots."}); }
        // a CLOSE-UP featuring a worn item, with no macro sheet generated: the frame
        // will invent the item's design at magnification (the owner sheet's few pixels
        // can't hold it). Report-only — generating spends credits, so it's the user's call.
        const tight = sceneShots.filter(sh=> /^(CU|MCU|ECU|INSERT)$/i.test(String(sh.size||""))
          && _consMentions(String(sh.action||"")+" "+String(sh.composition||""), p));
        if(tight.length){
          let hasSheet=false; try{ hasSheet = !!(typeof nbGetImage==="function" && nbGetImage(p.id)); }catch(e){}
          if(!hasSheet){ flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · a close-up features \""+p.name+"\" but it has no macro sheet — at CU size the frame will re-invent its design. Generate one on its prop card (built against "+(p.ownerName||"its owner")+"'s sheet) so tight shots lock the item."}); }
        }
      });
    }

    /* 6 — beat-level lint (the existing checker) */
    if(prod && typeof beatContinuityLint==="function" && ctx.model.beats[scene.id]){
      const rosterChars = ctx.model.characters.filter(c=> rosterIds.indexOf(c.id)>=0);
      (beatContinuityLint(scene, ctx.model.beats[scene.id], sceneProps, rosterChars)||[]).forEach(f=>{
        flags++; ctx.emit({k:"flag", t:"Sc "+scene.no+" · beats · "+f.msg});
      });
    }

    if(!sceneIssues.length && !pronounBlocks.length) ctx.emit({k:"observe", t:"Scene "+scene.no+" — checked."});
  }

  /* CAST ARGUMENT MAP — every scene-driving character should embody a HUMAN TRUTH
     (a distinct stance on the controlling idea); a cast where only the lead argues
     something produces swappable dialogue and function-only characters. Free check
     on the authored fields; "Draft with MUSE" (Cast panel) fills them. */
  if(story){
    const _cast = ctx.model.characters||[];
    const _drivers = new Set((ctx.model.scenes||[]).map(s=>s.driver).filter(Boolean));
    const significant = _cast.filter(c=> _drivers.has(c.id));
    const missing = significant.filter(c=> !String(c.humanTruth||"").trim());
    if(missing.length){ flags++; ctx.emit({k:"flag",
      t: missing.length+" scene-driving character"+(missing.length===1?"":"s")+" ("+missing.slice(0,4).map(c=>c.name).join(", ")+(missing.length>4?"\u2026":"")+") "+(missing.length===1?"carries":"carry")+" no HUMAN TRUTH \u2014 each significant character should embody a distinct stance on the controlling idea (Cast panel \u25b8 Human truth; \u201cDraft with MUSE\u201d writes it)."}); }
    const stanced = _cast.filter(c=> String(c.humanTruth||"").trim() && c.argues);
    const sides = new Set(stanced.map(c=>c.argues));
    if(stanced.length>=3 && sides.size===1){ flags++; ctx.emit({k:"flag",
      t:"Every stanced character argues the SAME side of the controlling idea (\u201c"+[...sides][0]+"\u201d) \u2014 a unanimous jury makes no argument. Give at least one character the opposing stance, or one that complicates both."}); }
  }

  /* prop spec truncation + missing sizes — film-wide, one summary flag each */
  if(prod){
    const cut = bible.props.filter(p=> _consTruncated(p.form)||_consTruncated(p.material));
    if(cut.length){ flags++; ctx.emit({k:"flag", t:cut.length+" prop spec"+(cut.length===1?"":"s")+" end mid-sentence ("+cut.slice(0,4).map(p=>p.name).join(", ")+(cut.length>4?"…":"")+") — re-draft the card or finish the line."}); }
    const sizeless = bible.props.filter(p=> p.kind!=="worn" && !String(p.size||"").trim());
    if(sizeless.length){ flags++; ctx.emit({k:"flag", t:sizeless.length+" prop"+(sizeless.length===1?" has":"s have")+" no physical size — the scale system can't hold them steady across shots. \"Design all props\" drafts real dimensions in one pass."}); }
  }

  if(cards>=MAX_CARDS) ctx.emit({k:"flag", t:"Stopped at "+MAX_CARDS+" proposals this run — run this check again after applying to pick up the rest."});
  if(!opts.noDone) ctx.emit({k:"done", t:"Audit complete — "+fixes+" fix"+(fixes===1?"":"es")+" applied, "+flags+" thing"+(flags===1?"":"s")+" flagged for your judgement."+(fixes||flags?"":" Every layer agrees with the script.")});
  return { fixes, flags, cards };
}


/* ---- Production check (Art Room) — owner-approved 2026-09-26: the old Writers' Room
   "Script Breakdown" and the production half of the Consistency Check, merged into one
   pass. First it reads the script INTO the cast sheets (pronouns, scale, physical details,
   voice, signature expressions — model calls), then it holds every Art Room layer to the
   script and rewrites what the script owes the sheets (they/them lines, unslugged spaces
   — free). Sheet-from-script runs first, so the script pass reads the settled sheets.
   ROLE-AWARE: every card says what it writes ("script" or "art"); when this collaborator's
   role can't save that area, the card is noted in the trace instead of shown. ---- */
async function agentProductionCheck(ctx){
  const drafted = scenesInStoryOrder(ctx.model.scenes)
    .filter(s=> ctx.model.drafts[s.id] && (ctx.model.drafts[s.id].blocks||[]).length);
  if(!drafted.length){ ctx.emit({k:"done", t:"No scenes are written yet — build the script first, then run the Production check."}); return; }
  const can = ctx.can || {};
  const allowed = (area)=> typeof can[area]!=="function" || !!can[area]();
  const pctx = Object.assign({}, ctx, { propose: async (card)=>{
    if(card && card.writes && !allowed(card.writes)){
      ctx.emit({k:"flag", t:card.title+" — "+(card.writes==="script"
        ? "your role can't change the script, so this is noted, not applied. A Writer or the film's owner can apply it."
        : "your role can't change the Art Room, so this is noted, not applied. An Art director or the film's owner can apply it.")});
      return false;
    }
    return ctx.propose(card);
  }});
  const aiOn = !!(ctx.ai && ctx.ai.available);
  ctx.emit({k:"plan", t:"Checking "+drafted.length+" written scene"+(drafted.length===1?"":"s")+" for production: "
    +(aiOn ? "first reading the script into the cast sheets (pronouns, scale, physical details, voice, signature expressions), then " : "")
    +"holding props, locations, render styles, wardrobe and shots to the script. Every change asks for your approval."});
  let read = null;
  if(aiOn){ read = await productionScriptRead(pctx); if(ctx.cancelled() || !read) return; }
  else ctx.emit({k:"flag", t:"The writing model isn't available, so the script read (pronouns, scale, physical details, voice, expressions) was skipped. The free checks below still run."});
  const cons = await agentConsistency(pctx, { scope:"production", noDone:true });
  if(ctx.cancelled() || !cons) return;
  const castFixes = read ? read.reconciled + read.enriched + (read.exprSet?1:0) : 0;
  const fixes = castFixes + cons.fixes;
  const mapped = ((ctx.bible && ctx.bible.props) || []).some(p=> p && Array.isArray(p.scenes) && p.scenes.length);
  ctx.emit({k:"done", t:"Production check complete — "+fixes+" fix"+(fixes===1?"":"es")+" applied"
    +(castFixes ? " ("+castFixes+" to the cast sheets)" : "")+", "+cons.flags+" thing"+(cons.flags===1?"":"s")+" flagged for your judgement."
    +(read && read.drift ? " "+read.drift+" pronoun or scale difference"+(read.drift===1?"":"s")+" between the script and the cast came up." : "")
    +(mapped ? "" : " No props are mapped to scenes yet — run Props → Extract screenplay props so this check can catch props that drop out.")});
}

const AGENTS = [
  { id:"doctor", name:"Story Doctor", icon:"stethoscope", kind:"fix",
    blurb:"Scans the spine for the weakest link \u2014 scenes that don't turn, soft peaks, flat runs \u2014 and proposes a fix for each, re-auditing until the spine holds.",
    run:agentStoryDoctor },
  { id:"consistency", name:"Consistency Check", icon:"check", kind:"fix",
    blurb:"The script and beats are canon \u2014 this free, rule-based pass audits every drafted scene's story layer: cast names misspelled in the script or beats, script blocks tagged to the wrong beat, clocks that hard-flip between day and night with no time cue, app vocabulary leaking onto the page (charge notation, beat numbers) and scene-driving characters with no human truth. No model calls; unambiguous repairs come back as one-click approval cards. The production checks (props, locations, styles, wardrobe, shots, they/them lines) live in the Art Room's Production check.",
    run:(ctx)=>agentConsistency(ctx, { scope:"story" }) },
  { id:"continuity", name:"Continuity Repair", icon:"link", kind:"fix",
    blurb:"Runs the continuity check, then plants missing setups and pays off dangling threads \u2014 re-checking after each repair until it's clean.",
    run:agentContinuityRepair },
  { id:"adapt", name:"Adaptation", icon:"flask", kind:"build", needsInput:true, ideaStarters:true,
    inputLabel:"Logline or synopsis", inputPlaceholder:"e.g. A lighthouse keeper discovers the fog is erasing the town's memories \u2014 including her own.",
    blurb:"Give it a logline and it architects the whole spine in your chosen framework \u2014 scenes, charges, beats, and screenplay, all written automatically. Blank page \u2192 finished draft.",
    run:agentAdaptation },
  { id:"tableread", name:"Final Read", icon:"film", kind:"report",
    blurb:"Reads the finished screenplay as actor, director, editor and sound designer \u2014 reporting visual writing, sound, page rhythm, action/dialogue causality, voice, pacing and thematic payoff across the whole film.",
    run:agentTableRead },
  { id:"production", name:"Production check", icon:"clipboard", kind:"fix", room:"art",
    blurb:"The 1st-AD pass before you render: reads every written scene into the cast sheets (pronouns, scale, physical details, voice, signature expressions), then holds props, locations, render styles, wardrobe and shots to the script \u2014 and offers to rewrite they/them lines to the cast's real pronouns and to slug the spaces the action plays inside. Every change is an approval card. The script read uses the writing model; the checks after it are free.",
    run:agentProductionCheck },
  { id:"colorist", name:"Colorist", icon:"palette", kind:"build", room:"art",
    blurb:"Designs your film's colour system \u2014 a bespoke palette + film stock from the story and your visual references \u2014 then color-scripts every scene along the value-charge spine and shows you why, for your approval.",
    run:agentColorist },
  { id:"shotdesigner", name:"Shot Designer", icon:"film", kind:"build", room:"art",
    blurb:"Audits your coverage scene by scene \u2014 does each scene establish wide, tighten, and land its turn on its most expressive size? \u2014 and proposes the shots to fix it, for your approval. Then hand off to \u2018Generate all shots\u2019.",
    run:agentShotDesigner },
  { id:"casting", name:"Casting Director", icon:"userScan", kind:"build", room:"art", autonomous:true,
    blurb:"Designs your whole cast on its own \u2014 drafts each character's look, finds their appearance changes, then generates the master sheet (with prop + cameo references) and every state variant. Runs autonomously; press Stop anytime.",
    run:agentCastingDirector },
  { id:"propsmaster", name:"Props Master", icon:"box", kind:"build", room:"art", autonomous:true,
    blurb:"Adds the worn/carried items listed in the cast's character briefs as proposals, drafts every prop's spec, and generates the reference images for the props that need their own (text-only objects are described in shots instead), each owned prop referencing its owner's character sheet so it matches that character's look (runs after the cast). It never adds or merges screenplay props \u2014 use Props \u2192 Extract screenplay props for that. Runs autonomously; press Stop anytime.",
    run:agentPropsMaster },
  { id:"researcher", name:"Visual Researcher", icon:"image", kind:"build", room:"art", autonomous:true,
    blurb:"Builds the film's lookbook brief — writes the visual statement, gathers/dedupes reference touchstones (palette, lighting, lens, texture), and proposes the film's RENDER STYLE from the story (your approval sets every character/prop/location style dropdown in one pass). Use Generate all frames afterwards to render the mood frames. The colour system (the Color tab) reads these references when it designs the palette.",
    run:agentVisualResearcher },
  { id:"locscout", name:"Location Scout", icon:"globe", kind:"build", room:"art", autonomous:true,
    blurb:"Scouts your film's locations on its own \u2014 pulls every place from the sluglines, drafts each one's staging + depth-grid spec, generates the plate, and adds the time-of-day variants the script calls for. Also flags any scene whose slugline location has no card yet. Runs autonomously; press Stop anytime.",
    run:agentLocationScout },
  { id:"coordinator", name:"Art Department Coordinator", icon:"robot", kind:"build", room:"art", autonomous:true,
    blurb:"Runs your pre-production in the right order, on its own \u2014 the lookbook, the cast, the props (worn ones reference their owner's sheet), the cast dressed in those props, the locations, the colour system and shot coverage. One click, no stops: its proposals are applied automatically, but scenes whose shots you approved or locked are left alone. It doesn't render shot frames or storyboards \u2014 do those from the Shots and Storyboards tabs. Press Stop anytime.",
    run:agentDepartmentCoordinator },
];
window.AGENTS = AGENTS;
window.auditSpine = auditSpine;
window.auditCoverage = auditCoverage;
