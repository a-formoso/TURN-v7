/* Default Stage direction. Source/coverage resolution stays in Stage's shared
   readers; this formatter never writes canon, invents coverage or calls a model. */
(function(root){
  "use strict";
  const text=v=>typeof v==="string"?v.trim():"";
  const unique=xs=>Array.from(new Set(xs.filter(Boolean)));
  const index=row=>Number.isInteger(row&&row.evidence&&row.evidence.blockIndex)
    ?row.evidence.blockIndex:null;
  const speaker=row=>text(row&&row.speaker&&row.speaker.name)||text(row&&row.speaker)||"the speaker";
  const sameLine=(a,b)=>{
    const ai=index(a),bi=index(b);
    if(ai!==null&&bi!==null)return ai===bi
      &&String(a.evidence.sceneId||"")===String(b.evidence.sceneId||"")
      &&String(a.evidence.beatN||"")===String(b.evidence.beatN||"");
    return text(a&&a.text)===text(b&&b.text)&&speaker(a)===speaker(b)
      &&text(a&&a.delivery)===text(b&&b.delivery);
  };
  const section=(name,lines)=>{const body=lines.filter(Boolean);return body.length?name+"\n"+body.join("\n"):"";};
  /* FIELD OF VIEW (2026-10-26, owner — "add the compass, field-of-view and size lines"): a lens in millimetres also
     said as the width it sees on a full-frame (36 mm) sensor, " (about 54° across)"; nothing when no mm is written */
  const lensWidth=(v)=>{
    const m=/(\d{1,3}(?:\.\d)?)\s*mm\b/i.exec(String(v||"")), f=m?Number(m[1]):0;
    if(!(f>=8&&f<=800)||/°/.test(String(v||"")))return "";
    return " (about "+Math.round(2*Math.atan(36/(2*f))*180/Math.PI)+"° across)";
  };
  const seconds=v=>{
    const n=Math.round((Number(v)||0)*10)/10;
    return String(n);
  };
  const fallbackPlan=(list,duration)=>{
    const raw=list.map(sh=>Math.max(.5,Number(sh&&sh.dur)||2));
    const sum=raw.reduce((n,v)=>n+v,0);
    const total=Math.max(Number(duration)||0,sum);
    let clock=0;
    return {durationSec:total,units:list.map((sh,i)=>{
      const start=clock;
      const own=raw[i];
      clock+=own;
      const last=i===list.length-1;
      const end=last?total:clock;
      return {shotId:sh.id,start,end,holdSec:last?Math.max(0,total-sum):0};
    })};
  };

  /* The acting layer (2026-10-24): what each in-frame character wants, what stands in
     the way and how they play it (the beat map's duel), living faces, the AI tells
     this shot is prone to, and the shot's own "must not happen" notes. Shared by the
     default brief and the named grammars. */
  function seedanceActingNotes(d,list,opts){
    opts=opts||{}; d=d||{}; list=(list||[]).filter(Boolean);
    const cast=(d.cast||[]).filter(c=>c&&text(c.name));
    const label=(sh,i)=>(list.length===1?"SHOT ":"CUT ")+(i+1);
    const acting=(d.acting||[]).filter(a=>a&&text(a.name)&&cast.some(c=>c.id===a.id)).map(a=>{
      const tactics=(a.tactics||[]).filter(t=>t&&text(t.text));
      return [a.name+(a.role==="driver"?" (drives the scene)":a.role==="reactor"?" (pushes back)":""),
        text(a.goal)?"Goal: "+text(a.goal):"",
        text(a.obstacle)?"Obstacle: "+text(a.obstacle):"",
        tactics.length?"Tactic: "+tactics.map(t=>(tactics.length>1?"beat "+t.beatN+" ":"")+text(t.text)).join("; "):""
      ].filter(Boolean).join(" · ");
    });
    const words=[].concat((d.panelLines||[]).map(p=>[p.text,p.staging,p.sheet].join(" ")),
      list.map(sh=>[sh.action,sh.vidText].join(" "))).join(" ");
    const many=cast.length>1;
    const crowd=/\b(crowd|crowds|extras|passers?-?by|onlookers|patrons|commuters|pedestrians|bystanders|audience|congregation|mourners|guests|diners|shoppers)\b/i.test(words);
    const hands=(d.props||[]).length>0||/\b(hands?|grips?|grabs?|holds?|holding|picks? up|fingers?|reaches|hands over|passes)\b/i.test(words);
    const speaking=(d.panelLines||[]).some(p=>text(p.dialogue)&&!/^(vo|voice-over|off-?screen|phone|text|sms|message|voicemail|radio|intercom)$/i.test(text(p.dialogueDelivery)));
    const faces=cast.length?cast.map(c=>c.name).join(", ")+": living faces — natural blinks, small eye movements, focus that lands on what they look at, breath moving chest and shoulders, micro-expressions that change between lines. Never a frozen stare or a mask-still face.":"";
    const tells=[
      "No doll eyes, frozen pupils, waxy or plastic skin, flat shadowless fill light, or looping, repeated motion.",
      many?"Every face stays its own person: faces never blend, swap or drift toward each other between cuts.":"",
      crowd?"Background people stay few (six or fewer), soft, out of focus and partly in shadow; no cloned or melting faces.":"",
      hands?"Hands have five fingers and a real grip that presses into what they hold; nothing passes through a hand.":"",
      speaking?"Mouths shape the actual words; teeth and tongue stay stable.":""
    ];
    const negative=list.map((sh,i)=>{
      const v=text(sh.mustNot).replace(/\s+/g," ");
      return v?(list.length===1?v:label(sh,i)+": "+v):"";
    });
    return {
      acting:section("CHARACTER ACTING — play the want, never a mood",acting),
      faces,
      tells:section("AVOID AI TELLS",tells),
      negative:section("NEGATIVE — must not happen",negative)
    };
  }
  root.seedanceActingNotes=seedanceActingNotes;

  /* VOICE LOCK (2026-10-24): the written voice of each character whose line the video
     model voices itself (no recorded line attached), word for word in every clip. */
  const voiceKey=v=>text(v).toLowerCase().replace(/\((?:v\.?o\.?|o\.?s\.?|o\.?c\.?|cont'?d)\)/g,"")
    .replace(/[^a-z0-9]+/g," ").trim();
  // the character a dialogue row belongs to: its speaker id, else its name (a first name matches too)
  const byRow=(list,row)=>{
    const id=text(row&&row.speakerId)||text(row&&row.speaker&&row.speaker.id), key=voiceKey(speaker(row)), first=key.split(" ")[0];
    return (list||[]).find(x=>id&&x.id===id)||(list||[]).find(x=>voiceKey(x.name)===key)
      ||(first.length>2?(list||[]).find(x=>voiceKey(x.name).split(" ")[0]===first):null)||null;
  };
  function seedanceVoiceLock(d,rows){
    const voices=((d&&d.voices)||[]).filter(v=>v&&text(v.name)&&text(v.text)),seen=[],out=[];
    (rows||[]).forEach(row=>{
      const v=byRow(voices,row);
      if(!v||seen.includes(v.id))return;
      seen.push(v.id); out.push(v.name+": "+text(v.text)+".");
    });
    return section("VOICE LOCK — the same voice in every shot",out);
  }
  root.seedanceVoiceLock=seedanceVoiceLock;
  /* SPOKEN LANGUAGE (2026-10-24, from the Anerneq study): a line in another or an invented
     language is pronounced as English when it's written in Latin letters. A character set to
     "Cyrillic letters" has their lines (the ones the video model voices) spelled by sound in
     Cyrillic, which keeps English pronunciation out; the letters are never shown. */
  const CYR_DI=[["shch","щ"],["sch","ш"],["sh","ш"],["ch","ч"],["zh","ж"],["kh","х"],["ts","ц"],["ya","я"],["yu","ю"],["yo","ё"],["ng","нг"],["th","т"]];
  const CYR_ONE={a:"а",b:"б",c:"к",d:"д",e:"е",f:"ф",g:"г",h:"х",i:"и",j:"й",k:"к",l:"л",m:"м",n:"н",o:"о",p:"п",q:"қ",r:"р",s:"с",t:"т",u:"у",v:"в",w:"в",x:"кс",y:"ы",z:"з"};
  function stageCyrillicSound(v){
    const src=String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    let out="";
    for(let i=0;i<src.length;){
      const rest=src.slice(i).toLowerCase();
      const di=CYR_DI.find(([a])=>rest.startsWith(a));
      const take=di?di[0].length:1, low=di?di[1]:CYR_ONE[rest[0]];
      if(low===undefined){ out+=src[i]; i++; continue; }
      const upper=src[i]!==src[i].toLowerCase();
      out+=upper?low.charAt(0).toUpperCase()+low.slice(1):low;
      i+=take;
    }
    return out;
  }
  root.stageCyrillicSound=stageCyrillicSound;
  // a line's spoken form + its language note, for a speaker with a language set
  const spokenForm=(d,row)=>{
    const lang=byRow(((d&&d.languages)||[]).filter(x=>x&&text(x.name)),row);
    if(!lang)return null;
    const cyr=lang.script==="cyrillic";
    return {words:cyr?stageCyrillicSound(text(row.text)):text(row.text),
      note:"spoken in "+(text(lang.language)||"their own language")+", never with English pronunciation"
        +(cyr?"; the Cyrillic letters spell how it sounds and are never shown":"")};
  };
  function seedanceLanguageSection(d,rows){
    const out=[];
    (rows||[]).forEach(row=>{
      const f=spokenForm(d,row); if(!f||!f.words)return;
      const line=speaker(row)+": “"+f.words+"” — "+f.note+".";
      if(!out.includes(line))out.push(line);
    });
    return section("SPOKEN LANGUAGE",out);
  }
  root.seedanceLanguageSection=seedanceLanguageSection;
  /* HERO PROPS (2026-10-24): the few objects the film turns on, described in full every time */
  function seedanceHeroProps(d){
    return section("HERO PROPS — the same object in every shot",((d&&d.props)||[])
      .filter(p=>p&&p.hero&&text(p.name)&&text(p.heroText))
      .map(p=>p.name+": "+text(p.heroText)+". Its design, colour, size and markings never change."));
  }
  root.seedanceHeroProps=seedanceHeroProps;
  const captureSection=d=>section("LENS AND CAPTURE — the same in every shot",[text(d&&d.capture)]);
  root.seedanceCaptureSection=captureSection;

  /* SCENE TYPES (2026-10-24, from the Anerneq study): six direction templates that cover
     most shots. Auto picks one from the clip's own words and shot sizes (or none); the
     Stage's Director panel can pick one or turn it off for a clip. */
  const SCENE_TYPES=[
    {id:"quiet",label:"Quiet scene",lines:[
      "The drama is in small changes. Hold the frame; the camera moves only as authored and never drifts or pushes in to add energy.",
      "Let silences play at full length. The performance lives in the eyes, breath and hands; no added gestures, pacing or business to fill the time.",
      "Sound is near-silent room tone with the small sounds of the space and of the people in it."]},
    {id:"violence",label:"Violence off frame",lines:[
      "Violence stays out of frame or hidden: show the build-up, the reaction and the aftermath, never the contact itself.",
      "The camera stays on a face, a hand or the space; the impact is carried by sound, a flinch, a shadow or an object reacting.",
      "No blood spray, close-up wounds or weapon contact on screen. Bodies keep their weight; nothing is choreographed or stylised like an action film."]},
    {id:"altered",label:"Altered state",lines:[
      "The world is seen through a mind that is not steady. Everything stays photographic and physically real; the strangeness comes from timing, framing and what is held too long, not from effects.",
      "Show only the distortions the script describes; no morphing, warping, glitches, colour flashes or fantasy imagery.",
      "Sound narrows to what the character hears: breath and one or two sounds of the space."]},
    {id:"crowd",label:"Crowd",lines:[
      "The people the scene is about stay sharp and readable; the crowd is texture around them.",
      "Few people near the camera; those behind are soft, out of focus and partly in shadow. Each moves with their own purpose and pace: no synchronised or looping movement, no cloned faces.",
      "The main characters keep their faces, wardrobe and positions when people pass in front of them."]},
    {id:"hidden",label:"Hidden action",lines:[
      "What the script keeps from the audience stays hidden: framed out, behind something, in darkness or with the character's back to camera.",
      "Show only what the authored action shows; never complete the hidden action on screen or add an explanatory insert.",
      "Hold on what can be seen: the approach, a reaction, the sound."]},
    {id:"wide",label:"Extreme wide",lines:[
      "The place is the subject. People are small in frame; their faces need no detail and are not turned to camera.",
      "The camera is locked or moves very slowly; the horizon stays level and the scale real. Distance, haze and atmosphere carry the depth.",
      "Movement in frame is slow and readable at this size; nothing pops or snaps."]}
  ];
  root.STAGE_SCENE_TYPES=SCENE_TYPES.map(t=>({id:t.id,label:t.label,lines:t.lines.slice()}));
  function seedanceSceneTypeAuto(d,list){
    d=d||{}; list=(list||[]).filter(Boolean);
    const words=[].concat((d.panelLines||[]).map(p=>[p.text,p.staging,p.sheet,p.script].join(" ")),
      list.map(sh=>[sh.action,sh.vidText].join(" "))).join(" ");
    /* a ticket punch is not a fight (owner's live run 2026-10-25: "punches tickets" tagged the car-deck beat as
       violence): punching tickets, cards, a clock, keys or a code, and the punch as a tool or a drink, are set aside */
    const fight=words.replace(/\b(?:ticket|hole|paper|card|fruit|rum) punch(?:es)?\b|\bpunch ?lines?\b|\bpunch(?:es|ed|ing)? (?:in|out)\b|\bpunch(?:es|ed|ing)? (?:(?:the|a|an|his|her|their|its|another|each|every|one|two|three|more|some) )?(?:tickets?|holes?|cards?|time ?cards?|clocks?|keys?|codes?|numbers?|digits?|buttons?|keypad|passes|stubs?|passports?)\b/gi," ");
    if(/\b(punch(?:es|ed|ing)?|stab(?:s|bed|bing)?|strangl\w*|slash(?:es|ed)?|gunshots?|gunfire|shoots? (?:him|her|them|at)|beats? (?:him|her|them)|murders?|attacks? (?:him|her|them)|attacked|brawl|fistfight|bleeding|blood)\b/i.test(fight))return "violence";
    if(/\b(we (?:don'?t|do not|never) see|out of (?:sight|view)|hidden from (?:view|us)|unseen)\b/i.test(words))return "hidden";
    if(/\b(hallucinat\w*|delirious|delirium|feverish|nightmare|dreaming|in a dream|drugged|madness|losing (?:his|her|their) mind)\b/i.test(words))return "altered";
    const sizes=list.map(sh=>String(sh.size||"").toUpperCase());
    if(sizes.length&&sizes.every(z=>z==="EWS"))return "wide";
    if(/\b(crowd|crowds|extras|passers?-?by|onlookers|patrons|commuters|pedestrians|bystanders|audience|congregation|mourners|guests|diners|shoppers)\b/i.test(words))return "crowd";
    const still=list.every(sh=>/^(|auto|static|locked|none)$/i.test(String(sh.move||"").trim()));
    if(list.length&&still&&!/\b(runs?|running|sprints?|chases?|races?|leaps?|jumps?|falls?|crashes?|explodes?|fights?)\b/i.test(words))return "quiet";
    return "";
  }
  root.seedanceSceneTypeAuto=seedanceSceneTypeAuto;
  /* opts.sceneType: "auto" (default), "none", or a type id */
  function seedanceSceneTypeSection(d,list,opts){
    const pick=text(opts&&opts.sceneType)||"auto";
    if(pick==="none")return "";
    const id=pick==="auto"?seedanceSceneTypeAuto(d,list):pick;
    const t=SCENE_TYPES.find(x=>x.id===id);
    return t?section("SCENE TYPE — "+t.label,t.lines):"";
  }
  root.seedanceSceneTypeSection=seedanceSceneTypeSection;

  function seedanceDirectorBrief(clip,shots,activeShot,audioRefsOn,audioIncluded,refs,opts){
    opts=opts||{}; refs=refs||{};
    const d=clip&&clip.data||{},scene=clip&&clip.scene||{};
    const list=(shots&&shots.length?shots:d.shots||[]).filter(Boolean);
    const beats=unique(list.map(sh=>Number(sh.beatN)>0?Number(sh.beatN):null));
    const panels=d.panelLines||[],scripts=d.beatScripts||{};
    const openingFrame=sh=>!!sh&&(sh.keyframeMode==="beat-opening"||sh.keyframeMode==="moment");
    const opening=list.some(openingFrame);
    // a moment of a split beat performs its own moment's screenplay (2026-11-01)
    const scriptOf=sh=>(d.shotScripts&&d.shotScripts[sh.id])||scripts[sh.beatN];
    const continuous=list.length===1;
    const suppliedPlan=opts.renderPlan&&Array.isArray(opts.renderPlan.units)?opts.renderPlan:null;
    const duration=Number(opts.durationSec)||Number(suppliedPlan&&suppliedPlan.durationSec)||Number(d.dur)||0;
    const limit=Number(opts.maxSeconds)||0;
    const timedPlan=suppliedPlan||fallbackPlan(list,duration);
    const timedByShot=new Map((timedPlan.units||[]).map((u,i)=>[String(u.shotId||((list[i]||{}).id)||i),u]));
    // one shared fact reads once, even when every shot of the clip reports it
    if(d.screenplayDirectionIssues&&d.screenplayDirectionIssues.some(x=>x.blocking))
      return "BLOCKED: "+unique(d.screenplayDirectionIssues.filter(x=>x.blocking).map(x=>text(x.message))).join(" ");
    if(list.some(sh=>openingFrame(sh)
      &&(!scriptOf(sh)||!scriptOf(sh).hasSource||!text(scriptOf(sh).text))))
      return "BLOCKED: canonical screenplay source is unavailable for this beat-opening shot.";
    if(limit>0&&duration>limit)
      return "BLOCKED: selected coverage requires "+duration+"s, exceeding the "+limit+"s model limit. Do not omit action, shorten dialogue or invent a split.";
    const units=list.map((sh,i)=>{
      const p=panels.find(p=>p.shotId===sh.id)||{};
      const source=scriptOf(sh)||{};
      const canonicalOpening=openingFrame(sh);
      const blocks=canonicalOpening?(source.blocks||[]):(p.actionBlocks||[]);
      const actions=blocks.filter(b=>/^(action|trans)$/i.test(b.type||"")&&text(b.text));
      const localDialogue=canonicalOpening?(source.dialogue||[]):(p.dialogueLines||[]);
      return {sh,p,source,i,actions,localDialogue};
    });
    // Source readers already constrain these rows to the selected shot/part.
    // Keep distinct utterances, even when a character repeats identical words.
    const dialogue=[];
    beats.forEach(beat=>{
      const local=units.filter(u=>Number(u.sh.beatN)===beat);
      const rows=Array.isArray(d.beatDialogues&&d.beatDialogues[beat])
        ?d.beatDialogues[beat]:local.flatMap(u=>u.localDialogue.length?u.localDialogue
          :text(u.p.dialogue)?[{speaker:u.p.speaker,text:u.p.dialogue,delivery:u.p.dialogueDelivery,
              parenthetical:u.p.dialogueParenthetical}]:[]);
      const ordered=rows.map((row,ordinal)=>({row,ordinal})).sort((a,b)=>
        index(a.row)!==null&&index(b.row)!==null?index(a.row)-index(b.row):a.ordinal-b.ordinal);
      ordered.forEach(({row})=>{
        if(!text(row.text))return;
        if(index(row)!==null&&dialogue.some(x=>x.beat===beat&&sameLine(x.row,row)))return;
        const candidates=local.filter(u=>u.localDialogue.some(r=>sameLine(r,row))
          ||(!u.localDialogue.length&&text(u.p.dialogue)===text(row.text)&&speaker(u.p)===speaker(row)));
        const pi=row.evidence&&row.evidence.parentheticalBlockIndex;
        const parenthetical=text(row.parenthetical)||(Number.isInteger(pi)
          ?text(((scripts[beat]&&scripts[beat].blocks)||[]).find(b=>index(b)===pi)?.text):"");
        dialogue.push({row,beat,parenthetical,label:"D"+(dialogue.length+1),unit:candidates.length===1?candidates[0]:null});
      });
    });
    const assets=Array.isArray(refs.assets)?refs.assets:[];
    const token=a=>typeof stageAssetMention==="function"?stageAssetMention(a):"";
    const name=(id)=>text((d.sourceCharacters||d.cast||[]).find(c=>c.id===id)?.name);
    const first=units[0],source=first&&first.source||{};
    const firstOpening=!!(first&&openingFrame(first.sh));
    const openingNames=(source.openingCharacterIds||[]).map(name).filter(Boolean);
    const laterNames=(source.physicalCharacterIds||[]).filter(id=>!(source.openingCharacterIds||[]).includes(id)).map(name).filter(Boolean);
    const startAsset=assets.find(a=>a.key==="frame")
      ||assets.find(a=>a.key==="shotframe:"+(first&&first.sh.id));
    const screenplayAssets=assets.filter(a=>a.kind!=="text"&&a.referenceKind==="screenplay");
    const refsLines=assets.filter(a=>a.kind!=="text"&&a.referenceKind!=="screenplay").map(a=>{
      const role=typeof stageAssetRole==="function"?stageAssetRole(a,refs):"";
      const assigned=(a.requiredByShots||[]).map(id=>list.findIndex(sh=>sh.id===id)+1).filter(n=>n>0);
      return role+(role&&assigned.length?" Assigned to Shot "+assigned.join(", ")+".":"");
    }).filter(Boolean);
    if(screenplayAssets.length){
      const tags=screenplayAssets.map(token).filter(Boolean);
      const pages=screenplayAssets.map(a=>Number(a.page)).filter(n=>n>0).sort((a,b)=>a-b);
      refsLines.push(tags.join(", ")+" are screenplay page image"
        +(tags.length===1?"":"s")+(pages.length?" "+pages.join(", "):"")
        +". Read them only as writing context for the selected coverage; never photograph or animate the pages, text, highlights or borders, or use them as framing or identity references.");
    }
    if(!refsLines.length){
      (d.cast||[]).forEach(c=>{
        const tag=typeof refs.character==="function"?refs.character(c):"";
        if(tag)refsLines.push(tag+" — "+c.name+"; identity and wardrobe only, not reference background or pose.");
      });
      (d.props||[]).forEach(p=>{
        const tag=typeof refs.prop==="function"?refs.prop(p):"";
        if(tag)refsLines.push(tag+" — "+p.name+"; prop design only, not custody or backdrop.");
      });
      const location=typeof refs.setting==="function"?refs.setting(d.loc||d.setting):"";
      if(location)refsLines.push(location+" — location geography and materials, not reference framing.");
    }
    const part=clip&&clip.g&&clip.g.parts>1?" · Part "+clip.g.part+" of "+clip.g.parts:"";
    const contract=section("BEAT CONTRACT",[
      [text(scene.title)||text(scene.name)||(scene.no!=null?"Scene "+scene.no:"")
          ||text(source.sceneHeading)||text(d.setting)||text(scene.loc),
        beats.length?"Beat "+beats.join(", ")+part:"Selected shot coverage",
        duration>0?"Duration: "+duration+"s":""].filter(Boolean).join(" · "),
      "Perform only the selected coverage in order. Full-scene screenplay text and page images are reading context, not permission to perform other beats or omitted parts.",
      "Keep every assigned action, line and pause; never compress recorded speech or add a resolution to fill the duration."
    ]);
    const openingState=section("SCENE AND OPENING STATE",[
      text(source.sceneHeading)||text(d.setting)||text(scene.loc),
      startAsset?"Opening frame: "+token(startAsset)+". Use its composition as the initial state only.":"",
      firstOpening&&source.openingAction?"Opening source: "+source.openingAction:"",
      firstOpening&&openingNames.length?"Opening physical cast: "+openingNames.join(", ")+".":"",
      firstOpening&&laterNames.length?"Later physical participants: "+laterNames.join(", ")+". Enter only at the authored moment; do not place them in the opening image.":"",
      "Follow authored entrances, exits, geography and prop placement. A selected identity reference does not itself place that character in the scene; remote participants remain offscreen."
    ]);
    const marker=x=>"["+x.label+" — "+speaker(x.row)+"]";
    const ordered=events=>{
      if(events.every(e=>e.at!==null))events.sort((a,b)=>a.at-b.at||a.ordinal-b.ordinal);
      return events;
    };
    /*
     * Beat-level coverage: the clip renders a complete beat whose cuts cannot be
     * mapped one-to-one onto the authored action blocks (their stored coverage
     * plan is a paraphrase with a different row count). The authored beat is
     * printed ONCE per beat as the sole performance source, with every dialogue
     * marker in screenplay order; each cut then carries its own coverage rows
     * (navigation, never screenplay text), staging, framing and design notes.
     */
    const isBeatLevel=u=>!!(u.p&&u.p.beatLevel&&Array.isArray(u.p.beatActionBlocks)&&u.p.beatActionBlocks.length);
    const beatBlocks=unique(units.filter(isBeatLevel).map(u=>Number(u.sh.beatN))).map(beat=>{
      const u=units.find(x=>isBeatLevel(x)&&Number(x.sh.beatN)===beat);
      const blocks=u.p.beatActionBlocks.filter(b=>/^(action|trans)$/i.test(b.type||"")&&text(b.text));
      const rows=dialogue.filter(x=>x.beat===beat);
      const events=ordered(blocks.map((b,j)=>({at:index(b),ordinal:j,value:text(b.text)}))
        .concat(rows.map((x,j)=>({at:index(x.row),ordinal:blocks.length+j,value:marker(x)}))));
      const cuts=units.filter(x=>Number(x.sh.beatN)===beat).map(x=>x.i+1);
      return ["BEAT "+beat+" · AUTHORED ACTION — perform every line below, in order, across Cut"
          +(cuts.length===1?" ":"s ")+cuts.join(", ")
          +". Each cut's Coverage line is its Shots-tab plan note (navigation only); this block is the only performance source."]
        .concat(events.map(e=>e.value)).join("\n");
    });
    const normal=v=>text(v).replace(/\s+/g," ").toLowerCase();
    /* WHEN EACH MOMENT HAPPENS (owner 2026-10-25, option A): a beat-opening shot's plan times its action paragraphs
       and lines in screenplay order (stage-plan.jsx beatTimeline); each one is printed with its window in the clip */
    const timedAt=(u,b)=>{
      const timing=timedByShot.get(String(u.sh.id)),at=index(b);
      const seg=timing&&Array.isArray(timing.segments)&&at!==null?timing.segments.find(x=>x&&x.blockIndex===at):null;
      if(!seg)return "";
      const base=Number(timing.start)||0;
      return seconds(base+Number(seg.start))+"\u2013"+seconds(base+Number(seg.end))+"s \u00b7 ";
    };
    const anyTimed=units.some(u=>{const t=timedByShot.get(String(u.sh.id));return !!(t&&Array.isArray(t.segments)&&t.segments.length);});
    const actionRows=units.map(u=>{
      const ownDialogue=dialogue.filter(x=>x.unit===u);
      const beatLevel=isBeatLevel(u);
      const events=ordered(u.actions.map((b,j)=>({at:index(b),ordinal:j,value:timedAt(u,b)+b.text}))
        .concat(ownDialogue.map((x,j)=>({at:index(x.row),ordinal:u.actions.length+j,value:timedAt(u,x.row)+marker(x)}))));
      const coverage=(u.p.coverage||[]).map(text).filter(Boolean);
      const staging=text(u.p.staging);
      // the storyboard staging line is authored Shots-tab design; print it when it
      // adds to the authored blocks rather than repeating one of them verbatim
      const stagingAdds=staging&&!u.actions.some(b=>normal(b.text)===normal(staging));
      let action=u.actions.length?events.map(e=>e.value).join("\n")
        :beatLevel?[
            coverage.length
              ?"Coverage: "+coverage.join(" → ")
              :"Coverage: no Shots-tab plan note — continue the authored action above in order across the cuts.",
            ownDialogue.map(marker).join(" ")
          ].filter(Boolean).join("\n")
        :[text(u.p.text)||text(u.p.script)||text(u.sh.vidText)||text(u.sh.action),
            ownDialogue.map(marker).join(" ")].filter(Boolean).join("\n");
      // Label only authored values. Vocabulary helpers otherwise supply default
      // lenses/framing for missing fields, which are not canonical shot choices.
      const camera=[["size",root.shotSizeOf],["angle",root.shotAngleOf],
        ["move",root.shotMoveOf],["lens",root.shotLensOf]].map(([key,lookup])=>{
          const raw=text(u.sh[key]);
          if(!raw||raw==="auto")return "";
          const shown=typeof lookup==="function"?text((lookup(raw)||{}).label)||raw:raw;
          return key==="lens"?shown+lensWidth(raw+" "+shown):shown;
        }).filter(Boolean).join(" · ");
      // the rest of the Shots-tab card, labelled with the Art Room's own vocabulary
      const cameraSettings=text(u.p.cameraSettings)
        ||(typeof root.shotCameraSettingsClause==="function"
          ?text(root.shotCameraSettingsClause(u.sh)).replace(/^Advanced camera settings\s*—\s*/i,""):"");
      /* THE SHOT'S LAYOUT (owner 2026-11-24, the Previs look brief, step 6: "The prompt says, for each shot, which
         reference is its layout and which figure is which person"): when this shot's clay drawing is among the
         references, its line names it, says who each figure is and what each red box is, and gives the camera the
         drawing was made through. One lens is said, never two: the layout's own, when the card wrote another. */
      const layout=assets.find(a=>a&&a.kind==="image"&&a.key==="previs-layout:"+u.sh.id);
      const layoutLens=layout&&Number(layout.layoutLensMm)>0?Number(layout.layoutLensMm):0;
      const cardLens=(/(\d{1,3}(?:\.\d)?)/.exec(text(u.sh.lens))||[])[1];
      const cameraShown=layoutLens&&cardLens&&Math.abs(Number(cardLens)-layoutLens)>=1
        ?camera.split(" · ").filter(part=>!/\d\s*mm\b/i.test(part)).join(" · "):camera;
      const layoutLine=layout&&token(layout)?"Layout: "+token(layout)+" is this shot as it starts."
        +((layout.layoutLegend||[]).length?" "+layout.layoutLegend.map(text).filter(Boolean).join(" "):""):"";
      const layoutCamera=layout&&text(layout.layoutCamera)?"Camera in the set (as the layout was drawn): "+text(layout.layoutCamera)
        +(layout.layoutSource==="hand"?"; an angle set by hand":"")+".":"";
      const timing=timedByShot.get(String(u.sh.id));
      const window=timing?(" · "+seconds(timing.start)+"–"+seconds(timing.end)+"s"):"";
      return [(continuous?"SHOT ":"CUT ")+(u.i+1)+window+" · Beat "+(u.sh.beatN||"unassigned"),
        action,
        (beatLevel||(u.actions.length&&stagingAdds))&&staging?"Staging: "+staging:"",
        !continuous&&u.i>0?"Carry-over: preserve prior positions, screen direction, gaze targets, relative scale and prop state; nothing resets or teleports.":"",
        cameraShown?"Camera: "+cameraShown:"",
        layoutCamera,
        layoutLine,
        u.p.geometry&&text(u.p.geometry.text)?"Geometry anchor (from "+(text(u.p.geometry.source)||"Blender")+"): "+text(u.p.geometry.text)+".":"",
        text(u.p.composition)?"Composition: "+u.p.composition:"",
        text(u.p.purpose)?"Intent: "+u.p.purpose:"",
        text(u.p.directives)?"Director's notes (binding): "+u.p.directives:"",
        cameraSettings?"Advanced camera settings: "+cameraSettings:""].filter(Boolean).join("\n");
    });
    const holdUnit=(timedPlan.units||[]).find(u=>Number(u.holdSec)>0);
    const holdStart=holdUnit?Math.max(Number(holdUnit.start)||0,(Number(holdUnit.end)||0)-Number(holdUnit.holdSec||0)):0;
    const action=section("ACTION AND CAMERA PLAN",[
      continuous?"One continuous shot. No invented cuts, inserts, montage or extra keyframes."
        :"Use the following authored shot sequence. Cut only between its listed setups; do not invent additional coverage.",
      opening&&!continuous?"Each beat-opening unit is continuous within its own authored shot; no inserts or montage inside it.":"",
      anyTimed?"The seconds before each moment are when it happens in this clip, from the screenplay's order. Let each action take its time and start each line at its moment \u2014 never speak a line early to fill the opening.":"",
      ...beatBlocks,
      ...actionRows,
      holdUnit?"FINAL HOLD · "+seconds(holdStart)+"–"+seconds(holdUnit.end)+"s — sustain the resulting pose, gaze, prop state and diegetic ambience; do not invent new action.":"",
      dialogue.some(x=>!x.unit)?"Unassigned clip-level dialogue follows the screenplay's action/line order; do not invent shot or audio associations for it.":""
    ]);
    const notes=seedanceActingNotes(d,list,opts);
    /* STAGING THAT READS (2026-10-27, owner): the fixes a viral short drama's makers kept making to Seedance takes — a move
       that skips its middle, long silent walks and pauses, a reaction turned away from camera, a face shown before its
       entrance has built. The entrance line only when this clip's action has someone entering. */
    const actionText=units.map(u=>u.actions.map(b=>text(b.text)).join(" ")+" "+text(u.p.staging)+" "+text(u.sh.action)).join(" ");
    const entering=/\b(enters|enter|walks in|comes in|steps in|strides in|bursts in|arrives|appears in the door(?:way)?|comes through the door)\b/i.test(actionText);
    const performance=section("PERFORMANCE",[
      "Play objectives through observable behavior, never generic emotion labels. Preserve authored pauses and changes through gaze, posture, breath, tempo and hand activity; keep eyes naturally alive without adding unrequested business.",
      "Play every move through, from where it starts to where it ends as written (rising from a chair, leaving a table, crossing the floor): nobody arrives somewhere without the move that takes them there.",
      "No dead air: movement continues into and through the lines unless the screenplay holds someone still; no long silent walks or frozen pauses the screenplay doesn't ask for. Authored pauses stay.",
      "While one character speaks, keep the listener's face readable to camera so the reaction plays; never turn a reaction away unless the screenplay hides it.",
      entering?"An entrance builds before the face is seen: the approach first (footsteps, the door, a back or a shadow), then the face on the turn or the first line.":"",
      notes.faces,
      ...unique(dialogue.map(x=>x.parenthetical
        ?x.label+" · "+speaker(x.row)+": "+x.parenthetical:""))
    ]);
    // A preset is authored production direction. The builder's generic lighting
    // fallback is not a measured or screenplay-derived lighting condition.
    const lighting=section("LIGHTING AND PHYSICAL CONTINUITY",[
      text(opts.lightingOverride)||(d.preset&&text(d.preset.lighting)),
      // the whole look (grade, palette, lens, texture, film stock — 2026-10-05) when the clip carries it
      typeof d.lookText==="string" ? text(d.lookText)
        : (d.preset?[text(d.preset.name),text(d.preset.grade)].filter(Boolean).join(" — "):""),
      "Lighting and physical changes follow the authored events. Preserve object design through motion, pickups and handovers; a reference image is not a requirement to keep an object in the same hands.",
      "Bodies, cloth and props obey gravity, contact, mass, inertia, weight transfer and follow-through. No floating feet, rubbery motion or frictionless movement."
    ]);
    /* VOICE LOCK lists only the characters the model voices itself (no recording on the line): a recorded line's
       sound is the recording's (owner 2026-10-27: a written voice beside it wasn't wanted). */
    const nativeVoices=[];
    const audio=section("DIALOGUE AND SOUND",[
      ...dialogue.map(x=>{
        const row=x.row,delivery=text(row.delivery)||"onscreen";
        const isText=typeof stageDeliveryIsText==="function"&&stageDeliveryIsText(delivery);
        const remote=typeof stageDeliveryIsRemote==="function"&&stageDeliveryIsRemote(delivery);
        const u=x.unit;
        const audioTag=audioRefsOn!==false&&u&&typeof refs.audioForShot==="function"
          &&(!Array.isArray(audioIncluded)||audioIncluded.includes(u.sh.id))
          &&(text(u.sh.lineAudio&&u.sh.lineAudio.text)||text(u.p.dialogue))===text(row.text)
          ?refs.audioForShot(u.sh.id):"";
        if(!isText&&!audioTag)nativeVoices.push(row);
        const own=!isText&&!audioTag?spokenForm(d,row):null;
        return x.label+" · "+speaker(row)+" ["+[delivery,text(row.channel)].filter(Boolean).join(" · ")+"]: “"+(own?own.words:row.text)+"”"
          +(own?" — "+own.note:"")
          +(isText?" — written/message content only; do not speak it or animate lips. Show it only where the screenplay calls for diegetic text."
            :remote?" — offscreen voice only; never add a body, face or lip-sync."
            :" — exact spoken words; lip-sync only when this speaker is visible.")
          +(!isText&&audioTag?(" Use "+audioTag+" as "+speaker(row)+"'s authoritative exact-line voice performance defined in ACTIVE REFERENCES; follow its recorded words, vocal identity and timing."):"");
      }),
      "Preserve the source order and exact words of every assigned line, including repetitions. Dialogue markers above are directions, never visible text.",
      "Build sound from visible physical causes and the authored environment: dialogue, ambience, foley and impacts only when present. NO background music, NO score. NO subtitles, captions, panel borders or burned-in text overlays."
    ]);
    const ending=section("ENDING AND CONTINUITY LOCKS",[
      "End at the final authored action in this selected coverage. Retain the resulting positions, visibility and prop states for the next beat or part; do not reset, replay earlier action or invent an ending.",
      "Preserve assigned identity, appearance and wardrobe references. Do not inherit studio backgrounds, reference-sheet layouts or extra cast. Screenplay pages are never opening frames or compositions.",
      "Preserve canonical body and object scale plus relative size between subjects; do not normalize different subjects to the same height or proportions.",
      "Do not add unprovided technical measurements or change the approved project look."
    ]);
    /* SET COMPASS and TRUE SIZES (2026-10-26, owner): what lies on each side of the set, and the real size of each
       person and prop — so the set never turns and nobody changes size between shots (stageSetCompass / d.sizes) */
    const compass=d.compass&&Array.isArray(d.compass.lines)&&d.compass.lines.length>=2?section("SET COMPASS",[
      "Fixed geography: the set never turns, flips or mirrors between shots; only the camera moves."
        +(text(d.compass.frame)?" "+(/^north\b/i.test(text(d.compass.frame))?"":"North: ")+text(d.compass.frame).replace(/\.$/,"")+".":""),
      ...d.compass.lines.map(l=>text(l)+".")]):"";
    /* HOW THEY COMPARE (2026-10-28, true sizes — a firefly beside a frog, a giant beside a house): with their sizes in
       millimetres, the prompt says how many times bigger each is than the next smaller one, and the largest against
       the smallest — a video model keeps a ratio better than two measurements */
    const sized=(Array.isArray(d.sizes)?d.sizes:[]).filter(z=>z&&Number(z.mm)>0).slice().sort((a,b)=>b.mm-a.mm);
    const times=(r)=>r>=10?String(Math.round(r)):String(Math.round(r*10)/10);
    const compareLines=[];
    for(let i=0;i<sized.length-1&&compareLines.length<4;i++){ const a=sized[i], b=sized[i+1], r=a.mm/b.mm;
      if(r>=1.5) compareLines.push(text(a.name)+" is about "+times(r)+"\u00d7 the size of "+text(b.name)+"."); }
    if(sized.length>=3){ const a=sized[0], b=sized[sized.length-1], r=a.mm/b.mm;
      if(r>=3) compareLines.push(text(a.name)+" is about "+times(r)+"\u00d7 the size of "+text(b.name)+": keep that difference in every framing."); }
    const sizes=Array.isArray(d.sizes)&&d.sizes.length?section("TRUE SIZES",[
      "Keep these real sizes, and the differences between them, in every shot; never scale a person or object to fit the frame.",
      ...d.sizes.slice(0,16).map(z=>text(z.name)+": "+text(z.text)+"."),
      ...compareLines]):"";
    // POINT OF VIEW AND SCALE (2026-10-28, scale plan step 2): whose eyes the camera has, its optics, and the physics at
    // the sizes in the clip — only when the clip isn't all human-sized
    const scalePov=text(d.scalePov)?section("POINT OF VIEW AND SCALE",[text(d.scalePov)]):"";
    return [contract,section("ACTIVE REFERENCES",refsLines),sizes,scalePov,openingState,compass,action,seedanceSceneTypeSection(d,list,opts),notes.acting,performance,lighting,seedanceHeroProps(d),captureSection(d),audio,seedanceVoiceLock(d,nativeVoices),notes.tells,ending,notes.negative].filter(Boolean).join("\n\n");
  }
  root.seedanceDirectorBrief=seedanceDirectorBrief;
})(typeof window!=="undefined"?window:globalThis);
