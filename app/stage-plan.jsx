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
  /* THE BEAT IN SCREENPLAY ORDER (owner 2026-10-25, option A: "a dialogue can appear 2, 4, 5 seconds into the
     video — how do we know where, and how long the clip should be?"). The page says where: each action paragraph
     and each line, in order. An action paragraph runs its authored seconds, else about 3.5 words a second (at least
     1.5 s); a spoken line runs its recorded length (Locked voice, the same words), else about 2.4 words a second (at
     least 1 s); a line opens 0.6 s in when nothing comes before it, 0.3 s after an action, 0.8 s after another line,
     and the clip keeps 0.6 s of air after a closing line. Written messages are read on screen (about 3 words a
     second). The total is the beat's length; each moment's start is where it falls in the clip. Estimates, not
     promises: the model paces the take, and the Takes tab hears where the speech really landed.
     FIT TO THE ENGINE (owner 2026-10-25): a beat longer than the engine's limit (15 s Seedance 2.0, 30 s 2.5) has
     its ESTIMATED action paced faster, evenly, down to 1.5 s a paragraph, until it fits; lines, written messages,
     authored seconds and the order never change. A beat that can't fit even then keeps that fastest pace and is
     still blocked (over-duration) — trim it or use the longer engine. */
  const BEAT_AIR={lead:0.6,afterAction:0.3,betweenLines:0.8,tail:0.6},MIN_ACTION_ENGINE=1.5;
  const words=v=>text(v).split(/\s+/).filter(Boolean).length;
  function beatTimeline(source,sh,opts){
    opts=opts||{};
    const blocks=(source&&source.blocks)||[],rows=(source&&source.dialogue)||[];
    const audio=(sh&&sh.lineAudio)||{};
    const isText=d=>typeof root.stageDeliveryIsText==="function"?!!root.stageDeliveryIsText(d):/^(text|sms|message)$/i.test(String(d||""));
    const blockAt=b=>b&&b.evidence&&Number.isInteger(b.evidence.blockIndex)?b.evidence.blockIndex:null;
    const segments=[];let t=0,prev="",estimated=false;
    blocks.forEach(b=>{
      const type=String(b&&b.type||"").toLowerCase(),body=text(b&&b.text),at=blockAt(b);
      if(!body)return;
      if(type==="action"){
        const authored=positive(b.durationSec||b.duration||b.seconds);
        const sec=authored&&authored<=120?authored:Math.max(1.5,words(body)/3.5);
        if(!(authored&&authored<=120))estimated=true;
        if(prev==="line")t+=BEAT_AIR.afterAction;
        segments.push({kind:"action",start:round(t),end:round(t+sec),text:body,blockIndex:at,flex:!(authored&&authored<=120),sec});
        t+=sec;prev="action";return;
      }
      if(type!=="dia")return;
      const row=rows.find(r=>r&&r.evidence&&at!==null&&r.evidence.blockIndex===at)||{text:body,speaker:"",delivery:"in-room"};
      if(isText(row.delivery)){
        const sec=Math.max(1.5,words(row.text)/3);estimated=true;
        if(prev==="line")t+=BEAT_AIR.afterAction;
        segments.push({kind:"text",start:round(t),end:round(t+sec),text:text(row.text),speaker:row.speaker||"",blockIndex:at});
        t+=sec;prev="action";return;
      }
      const recorded=opts.audioMode!=="native"&&positive(audio.durationMs)&&text(audio.text)===text(row.text)
        ?positive(audio.durationMs)/1000:0;
      const sec=recorded||Math.max(1,words(row.text)/2.4);
      if(!recorded)estimated=true;
      t+=prev===""?BEAT_AIR.lead:prev==="line"?BEAT_AIR.betweenLines:BEAT_AIR.afterAction;
      segments.push({kind:"line",start:round(t),end:round(t+sec),text:text(row.text),speaker:row.speaker||"",
        speakerId:row.speakerId||"",delivery:row.delivery||"in-room",blockIndex:at,recorded:!!recorded});
      t+=sec;prev="line";
    });
    if(prev==="line")t+=BEAT_AIR.tail;
    const pageSec=round(t);
    const cap=positive(opts.fitSec);
    // a length the user chose may pace the action harder than the engine fit does (0.5 s a paragraph, not 1.5)
    const MIN_ACTION=opts.userFit?0.5:MIN_ACTION_ENGINE;
    let fitted=false;
    if(cap&&t>cap){
      const flex=segments.filter(x=>x.kind==="action"&&x.flex);
      const fixed=t-flex.reduce((n,x)=>n+x.sec,0);
      // an even pace for every estimated paragraph, none below 1.5 s (a few passes settle the clamped ones)
      let room=cap-fixed;
      let free=flex.slice();
      for(let pass=0;pass<4&&free.length;pass++){
        const k=room/free.reduce((n,x)=>n+x.sec,0);
        const low=free.filter(x=>x.sec*k<MIN_ACTION);
        if(!low.length){ free.forEach(x=>{x.fit=x.sec*k;}); break; }
        low.forEach(x=>{x.fit=MIN_ACTION;room-=MIN_ACTION;});
        free=free.filter(x=>low.indexOf(x)<0);
        if(room<=0){ free.forEach(x=>{x.fit=MIN_ACTION;}); break; }
      }
      flex.forEach(x=>{ if(!(x.fit>0))x.fit=MIN_ACTION; });
      // lay the moments out again at the new pace
      let clock=0,last="";
      segments.forEach(x=>{
        const len=x.kind==="action"&&x.flex?x.fit:(x.end-x.start);
        if(x.kind==="line")clock+=last===""?BEAT_AIR.lead:last==="line"?BEAT_AIR.betweenLines:BEAT_AIR.afterAction;
        else if(last==="line")clock+=BEAT_AIR.afterAction;
        x.start=round(clock);x.end=round(clock+len);clock+=len;last=x.kind==="line"?"line":"action";
      });
      if(last==="line")clock+=BEAT_AIR.tail;
      t=clock;fitted=true;
    }
    segments.forEach(x=>{delete x.flex;delete x.sec;delete x.fit;});
    return {segments,total:round(t),pageSec,fitted,estimated};
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
        issues.push({code:"invalid-coverage",blocking:true,shotId:sh.id,message:"This shot points to micro-beats that no longer exist. Check which moments it covers in Shots."});
    }else{
      micro=Array.isArray(p.micro)?p.micro.map(text).filter(Boolean):[];
      if(!micro.length&&typeof root.stageShotMicroTexts==="function")
        micro=(root.stageShotMicroTexts(sh)||[]).map(text).filter(Boolean);
      if(canon.length&&!declared)
        issues.push({code:"inferred-coverage",blocking:false,shotId:sh.id,message:"Which micro-beats this shot covers is inferred, not mapped. Check it in Shots."});
    }
    // a beat-level panel's text is the WHOLE authored beat (shared by every cut);
    // a cut without coverage rows times against its own staging line, never that
    const action=opening?text(source.openingAction||sh.action):micro.length?micro.join(" → ")
      :p.beatLevel?text(p.staging||sh.action):text(p.text||sh.action);
    const dialogueLines=opening?(source.dialogue||[]).filter(x=>x&&String(x.text||"").trim()):[];
    const dialogue=opening
      ?dialogueLines.map(x=>String(x.speaker||"the speaker")+": "+String(x.text||"").trim()).join(" ")
      :text(p.dialogue!=null?p.dialogue:sh.dialogue);
    const audio=sh.lineAudio||{};
    const measured=opts.audioMode!=="native"&&dialogue?positive(audio.durationMs)/1000:0;
    // a beat-opening shot's dialogue reads "SPEAKER: words" for every line of the beat — its recording is one of
    // those lines, so it matches when one line has its words (2026-10-25: it was compared with the whole string)
    const audioMatches=opening?dialogueLines.some(x=>text(x.text)===text(audio.text)):text(audio.text)===dialogue;
    if(measured&&audio.text&&!audioMatches)
      issues.push({code:"stale-audio",blocking:true,shotId:sh.id,message:"Recorded dialogue differs from this shot's current words. Revoice the line or select native dialogue."});
    const speech=dialogue&&!opening?(measured||Math.max(1,dialogue.split(/\s+/).length/2.4)):0;
    const actionTiming=opening?beatActionTiming(source,sh):null;
    // a whole screenplay beat: its action and its lines in page order, one after another (beatTimeline)
    // fitted to the engine's limit, or to this unit's share of a shorter length the user chose (opts.fitTo)
    const fitTo=positive(opts.fitTo);
    const timeline=opening?beatTimeline(source,sh,{...opts,fitSec:fitTo?Math.min(limits(opts).max,fitTo):limits(opts).max,userFit:!!fitTo}):null;
    const actionTime=opening
      ? Math.max(timeline.fitted?positive(sh.actionDurationSec):actionTiming.seconds,timeline.total)
      : positive(sh.actionDurationSec)||(micro.length?Math.max(2,micro.length*1.6):5);
    // A cut's own micro-beat business can play under its line. Do not add them twice.
    const floor=opening?actionTime:dialogue?Math.max(speech+0.6,micro.length?Math.min(actionTime,5):0):actionTime;
    const savedDur=positive(sh.dur);
    const explicitShotDur=opening&&actionTiming ? (savedDur>=actionTime ? savedDur : 0) : savedDur;
    const duration=round(Math.max(explicitShotDur||floor,speech?speech+0.6:0,0.5));
    if(beatOpening(sh)&&source&&source.missing)
      issues.push({code:"missing-screenplay-helper",blocking:true,shotId:sh.id,
        message:"This beat's screenplay couldn't be read, so it isn't rendered from older shot text. Reload the app and try again."});
    if(!action&&!dialogue)
      issues.push({code:"empty-shot",blocking:true,shotId:sh.id,message:"This shot has no action or dialogue to render."});
    return {shotId:sh.id,index,beatN:positive(sh.beatN)||null,covers:opening?[]:covers,micro,action,dialogue,
      beatOpening:opening,beatScript:opening?String(source.text||""):"",sourceScreenplayRev:opening?String(source.sourceRev||""):"",
      dialogueLines,
      duration,speechSec:round(speech),estimated:opening?!!(timeline&&timeline.estimated&&!positive(sh.actionDurationSec)):(!positive(sh.dur)&&!measured),audioMeasuredSec:round(measured),
      segments:opening&&timeline?timeline.segments:[],pageSec:opening&&timeline?timeline.pageSec:0,paced:!!(opening&&timeline&&timeline.fitted),
      speaker:(p.speaker&&p.speaker.name)||audio.speaker||"",
      camera:{size:sh.size||"",angle:sh.angle||"",move:sh.move||"",lens:sh.lens||""},issues};
  }
  function stageBuildTimedPlan(shots,opts){
    opts=opts||{};const cap=limits(opts),list=(shots||[]).filter(Boolean);
    let units=list.map((sh,i)=>unitFor(sh,i,opts));
    const requested=positive(opts.durationSec);
    /* ANY LENGTH (2026-10-26, owner: "give me the option to set any duration I want for a clip"): a length shorter than
       the plan re-plans each beat to its share of it — the estimated action paced faster (down to 0.5 s a paragraph),
       the lines and any seconds written on the page untouched. Only a length that can't hold them is refused. */
    let paced=false;
    const planned=round(units.reduce((n,u)=>n+u.duration,0));
    // an older cut (not a whole beat) takes its share too, never under its line and a breath (or half a second)
    if(requested && requested<Math.max(4,Math.ceil(planned)) && planned>0){
      units=list.map((sh,i)=>{
        const u=units[i],share=Math.max(0.5,requested*u.duration/planned);
        if(u.beatOpening)return unitFor(sh,i,{...opts,fitTo:share});
        const keep=u.speechSec?round(u.speechSec+0.6):0.5;
        return {...u,duration:round(Math.min(u.duration,Math.max(share,keep))),paced:true};
      });
      paced=true;
    }
    const issues=units.flatMap(u=>u.issues);
    const sum=round(units.reduce((n,u)=>n+u.duration,0));
    const minimumSec=units.length?Math.max(4,Math.ceil(sum)):0;
    if(requested&&requested<minimumSec)
      issues.push({code:"duration-too-short",blocking:true,message:paced
        ? "This clip needs at least "+minimumSec+" seconds even with its action paced as fast as it goes \u2014 its lines keep their length. Choose "+minimumSec+"s or longer."
        : "The selected shots need at least "+minimumSec+" seconds. Increase duration or split this clip."});
    else if(paced&&requested<Math.ceil(planned))
      issues.push({code:"paced-to-duration",blocking:false,message:"Shorter than its planned "+Math.ceil(planned)+"s: the action is paced faster to fit "+requested+"s; the lines keep their length."});
    const durationSec=Math.max(minimumSec,requested?Math.ceil(requested):0);
    if(durationSec>cap.max){
      const oneBeat=units.some(u=>u&&u.beatOpening);
      issues.push({code:"over-duration",blocking:true,message:oneBeat
        ? "This screenplay beat needs "+durationSec+" seconds; this model allows "+cap.max+". Keep the beat intact: choose a longer-duration model or deliberately revise/revoice the screenplay. Stage will not silently truncate it or create extra shots."
        : "These shots need "+durationSec+" seconds; this model allows "+cap.max+". Split at an existing shot boundary, or deliberately divide and revoice a long spoken shot."});
    }
    if(units.length>cap.shots)
      issues.push({code:"shot-budget",blocking:true,message:"This clip has more shots than one render can hold \u2014 use Split to fit."});
    if(units.filter(u=>u.dialogue).length>cap.dialogue)
      issues.push({code:"dialogue-budget",blocking:true,message:"This clip has more dialogue lines than one render can carry \u2014 use Split to fit."});
    let clock=0;
    units.forEach((u,i)=>{
      u.start=round(clock);clock+=u.duration;
      if(i===units.length-1)clock=durationSec;
      u.end=round(clock);u.holdSec=i===units.length-1?round(durationSec-sum):0;
      delete u.issues;
    });
    const signature=hash({schema:SCHEMA,units,durationSec,modelId:opts.modelId||"",audioMode:opts.audioMode||"locked"});
    return {schema:SCHEMA,units,durationSec,minimumSec,plannedSec:Math.max(4,Math.ceil(planned)),paced,estimated:units.some(u=>u.estimated),
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
        e("caption",{className:"sr-only"},"Selected shots and requested timing"),
        e("thead",null,e("tr",null,e("th",null,"Time"),e("th",null,"Shot"),e("th",null,"Action and dialogue"))),
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
  root.stageBeatTimeline=beatTimeline;
  root.stagePlanClips=stagePlanClips;
  root.StageRenderPlan=StageRenderPlan;
})(window);