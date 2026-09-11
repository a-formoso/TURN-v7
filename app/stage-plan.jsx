/* Render planning is derived, not a second screenplay or a mutation of shot canon.
   Seconds are clip budgets; a cut inside a clip can be shorter than the provider's
   four-second minimum. Keep raw requirements visible instead of clamping them. */
(function(root){
  "use strict";
  const SCHEMA="stage-render-plan-v1";
  const text=v=>String(v||"").replace(/\s+/g," ").trim();
  const positive=v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):0;
  const round=v=>Math.round(v*100)/100;
  const hash=value=>{
    const s=JSON.stringify(value);let h=2166136261;
    for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);
    return (h>>>0).toString(36);
  };
  const beatOpening=sh=>!!(sh&&sh.keyframeMode==="beat-opening");
  const sourceFor=(sh,opts)=>{
    opts=opts||{};
    if(opts.scene&&typeof root.shotBeatScreenplay==="function"){
      try{
        const live=root.shotBeatScreenplay(opts.scene,sh&&sh.beatN,{
          drafts:opts.drafts||{},characters:opts.characters||[],beatsMap:opts.beatsMap||{}});
        if(live&&live.hasSource)return live;
      }catch(e){}
    }
    return beatOpening(sh) ? {hasSource:false,missing:true} : null;
  };
  function limits(opts){
    opts=opts||{};
    const modelMax=/2\.0/.test(opts.modelId||"")?15:30;
    return {max:Math.min(modelMax,positive(opts.maxSeconds)||modelMax),
      shots:positive(opts.maxShots)||Infinity,dialogue:positive(opts.maxDialogue)||Infinity};
  }
  function beatActionTiming(source,sh){
    const blocks=(source&&source.blocks||[]).filter(b=>b&&String(b.type||"").toLowerCase()==="action"&&text(b.text));
    const words=blocks.reduce((n,b)=>n+text(b.text).split(/\s+/).filter(Boolean).length,0);
    const authored=blocks.map(b=>positive(b.durationSec||b.duration||b.seconds)).filter(v=>v>0&&v<=120);
    const explicit=authored.length===blocks.length&&authored.length?authored.reduce((n,v)=>n+v,0):0;
    const baseline=Math.max(1.5,blocks.length*1.5,words/3.5);
    const saved=positive(sh&&sh.actionDurationSec);
    return {seconds:Math.max(baseline,explicit,saved),estimated:!explicit&&!saved,blocks:blocks.length,words};
  }
  function unitFor(sh,index,opts){
    const issues=[],p=(opts.panelLines||[]).find(x=>x&&x.shotId===sh.id)||{};
    const source=sourceFor(sh,opts),opening=beatOpening(sh)&&source&&source.hasSource;
    const canon=!opening&&sh.beatPlan&&Array.isArray(sh.beatPlan.micro)?sh.beatPlan.micro:[];
    const declared=Array.isArray(sh.covers)&&sh.covers.length>0;
    const covers=declared?Array.from(new Set(sh.covers.map(Number))):[];
    let micro=[];
    if(declared&&canon.length){
      micro=covers.map(n=>text(canon[n-1])).filter(Boolean);
      if(covers.some(n=>!Number.isInteger(n)||n<1||n>canon.length))
        issues.push({code:"invalid-coverage",blocking:true,shotId:sh.id,message:"This shot points to missing micro-beats. Reconcile its coverage in Shots."});
    }else{
      micro=Array.isArray(p.micro)?p.micro.map(text).filter(Boolean):[];
      if(!micro.length&&typeof root.stageShotMicroTexts==="function")
        micro=(root.stageShotMicroTexts(sh)||[]).map(text).filter(Boolean);
      if(canon.length&&!declared)
        issues.push({code:"inferred-coverage",blocking:false,shotId:sh.id,message:"Micro-beat coverage is inferred, not explicitly mapped. Review this shot's coverage."});
    }
    const action=opening?text(source.openingAction||sh.action):micro.length?micro.join(" → "):text(p.text||sh.action);
    const dialogueLines=opening?(source.dialogue||[]).filter(x=>x&&String(x.text||"").trim()):[];
    const dialogue=opening
      ?dialogueLines.map(x=>String(x.speaker||"the speaker")+": "+String(x.text||"").trim()).join(" ")
      :text(p.dialogue!=null?p.dialogue:sh.dialogue);
    const audio=sh.lineAudio||{};
    const measured=opts.audioMode!=="native"&&dialogue?positive(audio.durationMs)/1000:0;
    if(measured&&audio.text&&text(audio.text)!==dialogue)
      issues.push({code:"stale-audio",blocking:true,shotId:sh.id,message:"Recorded dialogue differs from this shot's current words. Revoice the line or select native dialogue."});
    const speech=dialogue?(measured||Math.max(1,dialogue.split(/\s+/).length/2.4)):0;
    const actionTiming=opening?beatActionTiming(source,sh):null;
    const actionTime=opening
      ? actionTiming.seconds
      : positive(sh.actionDurationSec)||(micro.length?Math.max(2,micro.length*1.6):5);
    // Dialogue and physical business can occur concurrently. Do not add them twice.
    const floor=dialogue?Math.max(speech+0.6,micro.length?Math.min(actionTime,5):0):actionTime;
    const savedDur=positive(sh.dur);
    const explicitShotDur=opening&&actionTiming ? (savedDur>=actionTime ? savedDur : 0) : savedDur;
    const duration=round(Math.max(explicitShotDur||floor,speech?speech+0.6:0,0.5));
    if(beatOpening(sh)&&source&&source.missing)
      issues.push({code:"missing-screenplay-helper",blocking:true,shotId:sh.id,
        message:"The canonical screenplay source helper is unavailable for this beat-opening shot. Load shot-screenplay.js before Stage; do not fall back to stale shot text."});
    if(!action&&!dialogue)
      issues.push({code:"empty-shot",blocking:true,shotId:sh.id,message:"This shot has no action or dialogue to render."});
    return {shotId:sh.id,index,beatN:positive(sh.beatN)||null,covers:opening?[]:covers,micro,action,dialogue,
      beatOpening:opening,beatScript:opening?String(source.text||""):"",sourceScreenplayRev:opening?String(source.sourceRev||""):"",
      dialogueLines,
      duration,estimated:!!(opening&&actionTiming&&actionTiming.estimated)||(!opening&&!positive(sh.dur)&&!measured),audioMeasuredSec:round(measured),
      speaker:(p.speaker&&p.speaker.name)||audio.speaker||"",
      camera:{size:sh.size||"",angle:sh.angle||"",move:sh.move||"",lens:sh.lens||""},issues};
  }
  function stageBuildTimedPlan(shots,opts){
    opts=opts||{};const cap=limits(opts),list=(shots||[]).filter(Boolean);
    const units=list.map((sh,i)=>unitFor(sh,i,opts));
    const issues=units.flatMap(u=>u.issues);
    const sum=round(units.reduce((n,u)=>n+u.duration,0));
    const minimumSec=units.length?Math.max(4,Math.ceil(sum)):0;
    const requested=positive(opts.durationSec);
    if(requested&&requested<minimumSec)
      issues.push({code:"duration-too-short",blocking:true,message:"The selected coverage needs at least "+minimumSec+" seconds. Increase duration or split this clip."});
    const durationSec=Math.max(minimumSec,requested?Math.ceil(requested):0);
    if(durationSec>cap.max){
      const oneBeat=units.some(u=>u&&u.beatOpening);
      issues.push({code:"over-duration",blocking:true,message:oneBeat
        ? "This screenplay beat needs "+durationSec+" seconds; this model allows "+cap.max+". Keep the beat intact: choose a longer-duration model or deliberately revise/revoice the screenplay. Stage will not silently truncate it or create extra shots."
        : "This coverage needs "+durationSec+" seconds; this model allows "+cap.max+". Split at an existing shot boundary, or deliberately divide and revoice a long spoken shot."});
    }
    if(units.length>cap.shots)
      issues.push({code:"shot-budget",blocking:true,message:"This clip has more shots than the selected packing budget."});
    if(units.filter(u=>u.dialogue).length>cap.dialogue)
      issues.push({code:"dialogue-budget",blocking:true,message:"This clip has more dialogue lines than its direct-audio packing budget."});
    let clock=0;
    units.forEach((u,i)=>{
      u.start=round(clock);clock+=u.duration;
      if(i===units.length-1)clock=durationSec;
      u.end=round(clock);u.holdSec=i===units.length-1?round(durationSec-sum):0;
      delete u.issues;
    });
    const signature=hash({schema:SCHEMA,units,durationSec,modelId:opts.modelId||"",audioMode:opts.audioMode||"locked"});
    return {schema:SCHEMA,units,durationSec,minimumSec,estimated:units.some(u=>u.estimated),
      over:durationSec>cap.max,issues,signature};
  }
  function stagePlanClips(shots,opts){
    opts=opts||{};const cap=limits(opts),list=(shots||[]).filter(Boolean);
    const groups=[];let cur=[],start=0,raw=0,dialogue=0;
    const flush=()=>{
      if(!cur.length)return;
      const plan=stageBuildTimedPlan(cur,{...opts,durationSec:undefined});
      groups.push({index:groups.length,start,shots:cur.slice(),dur:plan.durationSec,
        over:plan.over,manual:false,beatN:positive(cur[0].beatN)||null,plan});
      start+=cur.length;cur=[];raw=0;dialogue=0;
    };
    list.forEach(sh=>{
      const u=unitFor(sh,0,opts),beat=positive(sh.beatN),prev=cur[0]&&positive(cur[0].beatN);
      /* New beat-opening shots are already one screenplay beat each. Keep them
         one render unit so a long beat surfaces an honest over-duration blocker;
         legacy multi-shot groups retain their historical packing behavior. */
      const boundary=!beat||!prev||beat!==prev||sh.sceneId!==(cur[0]&&cur[0].sceneId)
        ||(cur.length&&(beatOpening(sh)||beatOpening(cur[0])));
      if(cur.length&&(opts.scope==="shot"||boundary||Math.ceil(raw+u.duration)>cap.max||
          cur.length>=cap.shots||(u.dialogue&&dialogue>=cap.dialogue)))flush();
      cur.push(sh);raw+=u.duration;if(u.dialogue)dialogue++;
      if(opts.scope==="shot"||!beat)flush();
    });
    flush();
    // Part numbering only follows consecutive same-beat groups, not a later repeat.
    for(let i=0;i<groups.length;){
      let end=i+1;
      while(groups[i].beatN&&end<groups.length&&groups[end].beatN===groups[i].beatN&&
          groups[end].shots[0].sceneId===groups[i].shots[0].sceneId)end++;
      for(let j=i;j<end;j++){groups[j].part=j-i+1;groups[j].parts=end-i;}
      i=end;
    }
    return groups;
  }
  function StageRenderPlan({plan,modelLabel,beatN,part,parts,referenceWarnings,onShowShots,onSplit}){
    if(!plan)return null;
    const e=React.createElement,units=plan.units||[];
    const warnings=(plan.issues||[]).concat((referenceWarnings||[]).map(x=>typeof x==="string"?{message:x}:x));
    return e("section",{className:"stage-render-plan","aria-label":"Render package"},
      e("div",{className:"stage-plan-head"},e("strong",null,"Render package"),
        e("span",null,modelLabel||"")),
      e("div",{className:"stage-plan-lineage"},"Screenplay → Beat → Shots → Clip → Take"),
      e("div",{className:"stage-plan-tags"},
        beatN&&e("span",null,"Beat "+beatN),
        parts>1&&e("span",null,"Part "+part+" of "+parts),
        e("span",null,units.length+" shot"+(units.length===1?"":"s")),
        e("span",null,plan.durationSec+"s · "+(plan.estimated?"estimated pacing":"planned timing"))),
      e("div",{className:"stage-plan-scroll"},e("table",{className:"stage-plan-rows"},
        e("caption",{className:"sr-only"},"Selected shot coverage and requested timing"),
        e("thead",null,e("tr",null,e("th",null,"Time"),e("th",null,"Shot / coverage"),e("th",null,"Action and dialogue"))),
        e("tbody",null,units.map(u=>e("tr",{key:u.shotId+":"+u.index},
          e("td",null,u.start+"–"+u.end+"s"),
          e("td",null,"Shot "+(u.index+1),u.beatOpening?e("small",null,"Beat opening"):u.covers.length?e("small",null,"Micro "+u.covers.join(", ")):null),
          e("td",null,(u.beatOpening&&u.beatScript)||u.action||"Dialogue",
            u.dialogue&&e("div",null,(u.speaker?u.speaker+": ":"")+'“'+u.dialogue+'”'))))))),
      e("p",{className:"stage-plan-note"},"One request produces one video take. A beat-opening frame is only the first state; the full screenplay beat (all action and exact dialogue) remains the temporal script. Timing guides the model and never truncates a long beat."),
      warnings.map((w,i)=>e("p",{key:i,className:"stage-plan-issue"+(w.blocking?" blocking":""),role:w.blocking?"alert":"status"},w.message)),
      (onShowShots||onSplit)&&e("div",{className:"stage-plan-actions"},
        onShowShots&&e("button",{type:"button",onClick:onShowShots},"Review source shots"),
        onSplit&&e("button",{type:"button",onClick:onSplit},"Split to fit this model")));
  }
  root.stageBuildTimedPlan=stageBuildTimedPlan;
  root.stagePlanClips=stagePlanClips;
  root.StageRenderPlan=StageRenderPlan;
})(window);