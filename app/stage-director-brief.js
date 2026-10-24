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
  function seedanceVoiceLock(d,rows){
    const voices=((d&&d.voices)||[]).filter(v=>v&&text(v.name)&&text(v.text)),seen=[],out=[];
    (rows||[]).forEach(row=>{
      const id=text(row&&row.speakerId)||text(row&&row.speaker&&row.speaker.id), key=voiceKey(speaker(row)), first=key.split(" ")[0];
      const v=voices.find(x=>id&&x.id===id)||voices.find(x=>voiceKey(x.name)===key)
        ||(first.length>2?voices.find(x=>voiceKey(x.name).split(" ")[0]===first):null);
      if(!v||seen.includes(v.id))return;
      seen.push(v.id); out.push(v.name+": "+text(v.text)+".");
    });
    return section("VOICE LOCK — the same voice in every shot",out);
  }
  root.seedanceVoiceLock=seedanceVoiceLock;
  const captureSection=d=>section("LENS AND CAPTURE — the same in every shot",[text(d&&d.capture)]);
  root.seedanceCaptureSection=captureSection;

  function seedanceDirectorBrief(clip,shots,activeShot,audioRefsOn,audioIncluded,refs,opts){
    opts=opts||{}; refs=refs||{};
    const d=clip&&clip.data||{},scene=clip&&clip.scene||{};
    const list=(shots&&shots.length?shots:d.shots||[]).filter(Boolean);
    const beats=unique(list.map(sh=>Number(sh.beatN)>0?Number(sh.beatN):null));
    const panels=d.panelLines||[],scripts=d.beatScripts||{};
    const opening=list.some(sh=>sh.keyframeMode==="beat-opening");
    const continuous=list.length===1;
    const suppliedPlan=opts.renderPlan&&Array.isArray(opts.renderPlan.units)?opts.renderPlan:null;
    const duration=Number(opts.durationSec)||Number(suppliedPlan&&suppliedPlan.durationSec)||Number(d.dur)||0;
    const limit=Number(opts.maxSeconds)||0;
    const timedPlan=suppliedPlan||fallbackPlan(list,duration);
    const timedByShot=new Map((timedPlan.units||[]).map((u,i)=>[String(u.shotId||((list[i]||{}).id)||i),u]));
    // one shared fact reads once, even when every shot of the clip reports it
    if(d.screenplayDirectionIssues&&d.screenplayDirectionIssues.some(x=>x.blocking))
      return "BLOCKED: "+unique(d.screenplayDirectionIssues.filter(x=>x.blocking).map(x=>text(x.message))).join(" ");
    if(list.some(sh=>sh.keyframeMode==="beat-opening"
      &&(!scripts[sh.beatN]||!scripts[sh.beatN].hasSource||!text(scripts[sh.beatN].text))))
      return "BLOCKED: canonical screenplay source is unavailable for this beat-opening shot.";
    if(limit>0&&duration>limit)
      return "BLOCKED: selected coverage requires "+duration+"s, exceeding the "+limit+"s model limit. Do not omit action, shorten dialogue or invent a split.";
    const units=list.map((sh,i)=>{
      const p=panels.find(p=>p.shotId===sh.id)||{};
      const source=scripts[sh.beatN]||{};
      const canonicalOpening=sh.keyframeMode==="beat-opening";
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
    const firstOpening=!!(first&&first.sh.keyframeMode==="beat-opening");
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
    const actionRows=units.map(u=>{
      const ownDialogue=dialogue.filter(x=>x.unit===u);
      const beatLevel=isBeatLevel(u);
      const events=ordered(u.actions.map((b,j)=>({at:index(b),ordinal:j,value:b.text}))
        .concat(ownDialogue.map((x,j)=>({at:index(x.row),ordinal:u.actions.length+j,value:marker(x)}))));
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
          return typeof lookup==="function"?text((lookup(raw)||{}).label)||raw:raw;
        }).filter(Boolean).join(" · ");
      // the rest of the Shots-tab card, labelled with the Art Room's own vocabulary
      const cameraSettings=text(u.p.cameraSettings)
        ||(typeof root.shotCameraSettingsClause==="function"
          ?text(root.shotCameraSettingsClause(u.sh)).replace(/^Advanced camera settings\s*—\s*/i,""):"");
      const timing=timedByShot.get(String(u.sh.id));
      const window=timing?(" · "+seconds(timing.start)+"–"+seconds(timing.end)+"s"):"";
      return [(continuous?"SHOT ":"CUT ")+(u.i+1)+window+" · Beat "+(u.sh.beatN||"unassigned"),
        action,
        (beatLevel||(u.actions.length&&stagingAdds))&&staging?"Staging: "+staging:"",
        !continuous&&u.i>0?"Carry-over: preserve prior positions, screen direction, gaze targets, relative scale and prop state; nothing resets or teleports.":"",
        camera?"Camera: "+camera:"",
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
      ...beatBlocks,
      ...actionRows,
      holdUnit?"FINAL HOLD · "+seconds(holdStart)+"–"+seconds(holdUnit.end)+"s — sustain the resulting pose, gaze, prop state and diegetic ambience; do not invent new action.":"",
      dialogue.some(x=>!x.unit)?"Unassigned clip-level dialogue follows the screenplay's action/line order; do not invent shot or audio associations for it.":""
    ]);
    const notes=seedanceActingNotes(d,list,opts);
    const performance=section("PERFORMANCE",[
      "Play objectives through observable behavior, never generic emotion labels. Preserve authored pauses and changes through gaze, posture, breath, tempo and hand activity; keep eyes naturally alive without adding unrequested business.",
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
        return x.label+" · "+speaker(row)+" ["+[delivery,text(row.channel)].filter(Boolean).join(" · ")+"]: “"+row.text+"”"
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
    return [contract,section("ACTIVE REFERENCES",refsLines),openingState,action,notes.acting,performance,lighting,captureSection(d),audio,seedanceVoiceLock(d,nativeVoices),notes.tells,ending,notes.negative].filter(Boolean).join("\n\n");
  }
  root.seedanceDirectorBrief=seedanceDirectorBrief;
})(typeof window!=="undefined"?window:globalThis);
