/* Screenplay evidence for shot opening keyframes.
   This file is deliberately independent of the React surfaces.  Shots, Stage,
   headless generation and tests all need the same answer to two different
   questions:
     - who is mentioned or heard in this beat?
     - who can be photographed in the opening frame?
   A beat map is navigation only.  It is never used as screenplay evidence. */
(function(root){
  "use strict";

  const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const norm = v => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const add = (list, id) => { if(id && list.indexOf(id)<0) list.push(id); };
  const uniq = list => Array.from(new Set((list||[]).filter(Boolean)));

  function charsArray(value){
    return Array.isArray(value) ? value : Object.values(value||{});
  }
  function blocksArray(draft){
    return Array.isArray(draft) ? draft : (draft && Array.isArray(draft.blocks) ? draft.blocks : []);
  }
  function beatOf(block){
    const n=Number(block&&block.beat);
    return Number.isFinite(n) && n>0 ? n : null;
  }
  function blockText(block){ return String(block&&block.text==null ? "" : (block&&block.text||"")); }
  function meaningful(block){ return !!clean(blockText(block)); }
  function isScene(block){ return String(block&&block.type||"").toLowerCase()==="scene"; }

  /* The screenplay paragraph is the exact source, but a paragraph can contain
     several timed events.  The still is the instant before the first transition:
     "MARCUS rehearses. THEN the phone buzzes" must not make the banner the
     opening situation.  This is a boundary detector, not a prose rewriter; when
     no authored transition is present the complete action block is retained. */
  function openingActionOf(value){
    const raw=String(value||"").trim();
    if(!raw) return "";
    const cuts=[];
    const addCut=re=>{ const m=re.exec(raw); if(m&&m.index>0) cuts.push(m.index); };
    const addSentenceCut=re=>{ const m=re.exec(raw); if(m&&m.index>0) cuts.push(m.index+1); };
    addCut(/\s+(?:then|suddenly|a moment later|moments later|later|afterwards?|as soon as|once)\b/i);
    addCut(/[,.;]\s*(?:the\s+)?(?:phone|cell(?:ular)?|mobile)\s+(?:buzz(?:es|ed|ing)?|ring(?:s|ing)?|vibrat(?:es|ed|ing)?|lights?\s+up)\b/i);
    addCut(/[,.;]\s*(?:a\s+)?(?:banner|notification|message|text|voicemail|voice\s+message|alert)\s+(?:reads?|appears?|arrives?|plays?|pops?|flashes?|shows?)\b/i);
    addSentenceCut(/[.!?]\s+(?:[A-Z][A-Za-z'-]{1,30}(?:\s+[A-Z][A-Za-z'-]{1,30})?)\s+(?:enters?|arrives?|walks?\s+in|steps?\s+in|comes?\s+in|appears?)\b/);
    const cut=cuts.length ? Math.min(...cuts) : -1;
    return (cut>0 ? raw.slice(0,cut) : raw).trim();
  }

  function escaped(s){ return String(s||"").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function tokens(value){ return norm(value).split(/\s+/).filter(x=>x.length>=3); }

  /* Name matching is intentionally conservative.  A surname shared by two
     characters is not enough evidence; a full name or an unshared given name is. */
  function namesInText(value, chars){
    const text=" "+norm(value)+" ";
    const all=charsArray(chars).filter(c=>c&&c.id&&clean(c.name));
    const tokenOwners={};
    all.forEach(c=>uniq(tokens(c.name)).forEach(t=>{
      (tokenOwners[t]||(tokenOwners[t]=[])).push(c.id);
    }));
    const out=[];
    all.forEach(c=>{
      const full=norm(c.name), id=norm(c.id);
      if((full && text.indexOf(" "+full+" ")>=0) ||
         (id && text.indexOf(" "+id+" ")>=0)){
        add(out,c.id); return;
      }
      const own=uniq(tokens(c.name)).filter(t=>(tokenOwners[t]||[]).length===1);
      if(own.some(t=>text.indexOf(" "+t+" ")>=0)) add(out,c.id);
    });
    return out;
  }

  function charForCue(value, chars){
    const n=norm(value);
    if(!n) return null;
    const all=charsArray(chars).filter(c=>c&&c.id&&clean(c.name));
    /* Exact full-name matching wins over a shared token. */
    const exact=all.filter(c=>n===norm(c.name)||n===norm(c.id));
    if(exact.length===1) return exact[0];
    const hits=namesInText(value,all);
    return hits.length===1 ? all.find(c=>c.id===hits[0])||null : null;
  }

  function deliveryFor(value){
    const t=String(value||"");
    if(/\b(?:v\.?\s*o\.?|voice[\s-]?over)\b/i.test(t)) return "voice-over";
    if(/\b(?:o\.?\s*s\.?|off[\s-]?screen)\b/i.test(t)) return "off-screen";
    if(/\b(?:text(?:s|ed)?|sms|message(?:s|d)?|banner|notification|alert|email|e-mail)\b/i.test(t))
      return "text";
    if(/\b(?:on[\s-]?phone|phone|telephone|cell|mobile|voicemail|call|radio|intercom)\b/i.test(t))
      return "phone";
    return "in-room";
  }
  function isRemoteMarker(value){
    return deliveryFor(value)!=="in-room" ||
      /\b(?:text(?:s|ed)?|sms|message(?:s|d)?|banner|notification|alert|email|e-mail)\b/i.test(String(value||""));
  }

  /* Return the local context around a named occurrence.  This avoids the
     dangerous blanket rule "phone hides everyone": the person holding a phone
     remains physical while the person at the other end is remote. */
  function nameContext(value, character){
    const raw=String(value||""), name=String(character&&character.name||"");
    if(!raw||!name) return raw;
    let at=raw.toLowerCase().indexOf(name.toLowerCase());
    if(at<0){
      const first=tokens(name)[0];
      at=first ? raw.toLowerCase().indexOf(first) : -1;
    }
    return at<0 ? raw : raw.slice(Math.max(0,at-120),Math.min(raw.length,at+name.length+120));
  }

  function remoteEvidence(value, character){
    const raw=String(value||""), around=nameContext(raw,character);
    if(!around) return false;
    const n=escaped(character&&character.name||"");
    const short=tokens(character&&character.name||"")[0];
    const nr=n+(short&&short!==norm(character&&character.name||"") ? "|"+escaped(short) : "");
    /* A marker attached to THIS name belongs to that speaker.  It must be
       occurrence-local: an O.S. cue for Daniel must not hide Marcus standing
       in the same action paragraph. */
    if(n && new RegExp("\\b(?:"+nr+")\\s*\\(\\s*(?:v\\.?\\s*o\\.?|voice[\\s-]?over|o\\.?\\s*s\\.?|off[\\s-]?screen|on[\\s-]?phone|phone)\\s*\\)","i").test(raw))
      return true;
    if(n && new RegExp("\\b(?:"+nr+")(?:'s|’s)\\s+(?:voice|voicemail|message|text|sms|phone|telephone|radio|intercom)\\b","i").test(raw))
      return true;
    if(n && new RegExp("\\b(?:"+nr+")\\s+(?:speaks?|talks?|answers?)\\s+(?:from\\s+the\\s+other\\s+(?:end|side)|through\\s+(?:the\\s+)?phone|on\\s+the\\s+line|over\\s+(?:the\\s+)?phone)\\b","i").test(raw))
      return true;
    /* A named subject doing something in the room is physical even when a
       nearby clause also says "phone" or "message". */
    if(n && new RegExp("\\b(?:"+nr+")\\s+(?:answers?|picks?\\s+up|holds?|dials?|calls?|speaks?|talks?|stands?|sits?|walks?|enters?|arrives?|waits?|looks?|reads?|types?|rehearses?|opens?|closes?|sets?|grabs?|writes?|listens?|hears?|watches?|freezes?|turns?|moves?|looks?)\\b","i").test(raw))
      return false;
    /* Props, labels, banners and absent people are evidence about a name, not
       evidence of a body.  Headings are never sent here. */
    if(/\b(?:banner|poster|sign|label|name|photo(?:graph)?|portrait|picture|image|badge|screen|display|notification|alert|email|e-mail|text|sms|message|voicemail|empty|absent|away|not\s+(?:here|present)|has(?:n't| not)\s+arrived|did(?:n't| not)\s+(?:arrive|come)|flight|address)\b/i.test(around))
      return true;
    if(/\b(?:other\s+end|other\s+side|through\s+(?:the\s+)?phone|on\s+the\s+line|comes?\s+through|heard\s+through)\b/i.test(around))
      return true;
    if(/\b(?:voice\s+of|spoken\s+by|v\.?\s*o\.?|voice[\s-]?over|o\.?\s*s\.?|off[\s-]?screen)\b/i.test(around))
      return true;
    if(n && new RegExp("\\b(?:on|over)\\s+(?:the\\s+)?phone\\s+(?:with|to)\\s+(?:"+nr+")\\b","i").test(raw))
      return true;
    if(n && new RegExp("\\b(?:call(?:s|ed|ing)?|text(?:s|ed|ing)?|message(?:s|d|ing)?)\\s+(?:"+nr+")\\b","i").test(raw))
      return true;
    /* "DANIEL answers the phone" is physical; "MARCUS calls DANIEL" makes
       Daniel remote.  Do not classify the caller merely because "phone" is
       elsewhere in the sentence. */
    if(n && new RegExp("\\b(?:"+nr+")\\s+(?:is|remains?)\\s+(?:absent|away|elsewhere|off[- ]screen|not\\s+(?:here|present))\\b","i").test(raw))
      return true;
    return false;
  }

  function classifyAction(value, chars){
    const physical=[], remote=[], mentioned=[];
    namesInText(value,chars).forEach(id=>{
      const c=charsArray(chars).find(x=>x&&x.id===id);
      add(mentioned,id);
      if(remoteEvidence(value,c)) add(remote,id);
      else add(physical,id);
    });
    return {physical,remote,mentioned};
  }

  function sourceSelection(scene, beatN, draft){
    const all=blocksArray(draft);
    const n=Number(beatN);
    const tagged=all.map((b,i)=>({b,i,n:beatOf(b)})).filter(x=>x.n!=null);
    const exact=all.map((b,i)=>({b,i})).filter(x=>beatOf(x.b)===n);
    let selected=[];
    if(exact.length){
      selected=exact.map(x=>x.i);
      if(n===1){
        const firstTagged=tagged.length ? tagged[0].i : all.length;
        all.forEach((b,i)=>{
          if(i<firstTagged && meaningful(b) && (isScene(b) || /^(action|trans|char|paren|dia)$/i.test(String(b.type||""))))
            selected.push(i);
        });
      }
    }else if(n===1){
      /* Imported/first-pass drafts often leave the prologue untagged.  It is
         source for beat one only when it is leading; never copy a later block
         into an unrelated beat. */
      const firstTagged=tagged.length ? tagged[0].i : all.length;
      all.forEach((b,i)=>{
        if(i<firstTagged && meaningful(b)) selected.push(i);
      });
    }
    selected=Array.from(new Set(selected)).sort((a,b)=>a-b);
    const sourceEntries=selected.map(i=>({block:all[i],index:i})).filter(x=>meaningful(x.block));
    const sourceBlocks=sourceEntries.map(x=>x.block);
    const hasSource=sourceBlocks.some(b=>!isScene(b));
    const first=selected.length ? selected[0] : -1;
    const slugBefore=all.map((b,i)=>({b,i})).filter(x=>x.i<=first&&isScene(x.b)).pop();
    const heading=slugBefore ? clean(blockText(slugBefore.b)) : clean(scene&&scene.loc);
    return {all,selected,sourceBlocks,sourceEntries,hasSource,first,heading};
  }

  function screenplayBeatRevision(draft, beatN, selection){
    if(typeof root.screenplayBeatRevision==="function" && draft){
      try{
        const rev=String(root.screenplayBeatRevision(draft,beatN)||"");
        if(rev) return rev;
      }catch(e){}
    }
    const rows=(selection&&selection.sourceBlocks||[]).map(b=>({type:b.type||"",text:blockText(b)}));
    const s=JSON.stringify(rows); let h=2166136261;
    for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
    return (h>>>0).toString(36);
  }

  function shotBeatScreenplay(scene, beatN, options){
    /* Only omitted options consult global continuity.  Passing {drafts:{}} is
       an explicit empty context and must not accidentally read a stale window. */
    const opts=arguments.length<3 || options===undefined ? (root.turnContinuity||{}) : (options||{});
    const drafts=opts.drafts||{};
    const draft=scene && drafts ? (drafts[scene.id]||drafts[String(scene.id)]) : null;
    const chars=charsArray(opts.characters);
    const byId={}; chars.forEach(c=>{if(c&&c.id)byId[c.id]=c;});
    const selection=sourceSelection(scene,beatN,draft);
    const all=selection.all, selected=selection.selected, sourceBlocks=selection.sourceBlocks;
    const physical=[],remote=[],mentioned=[],opening=[];
    const openingPhysical=[],openingRemote=[];
    const dialogue=[];
    const classify=(value,intoPhysical,intoRemote,intoMentioned)=>{
      const r=classifyAction(value,chars);
      (r.physical||[]).forEach(id=>add(intoPhysical,id));
      (r.remote||[]).forEach(id=>add(intoRemote,id));
      (r.mentioned||[]).forEach(id=>add(intoMentioned,id));
      return r;
    };
    const classifyMention=(value)=>{
      namesInText(value,chars).forEach(id=>{
        add(mentioned,id);
        if(remoteEvidence(value,byId[id])) add(remote,id);
      });
    };

    const first=selection.first;
    const segmentStart=(()=>{
      if(first<0) return 0;
      let at=0;
      all.forEach((b,i)=>{if(i<=first&&isScene(b))at=i;});
      return at;
    })();
    /* Inheritance is physical continuity within the current slugline only.
       A heading is a hard reset, even when a writer reuses the same beat no. */
    function processBlock(block, index, forOpening){
      const type=String(block&&block.type||"").toLowerCase();
      const raw=blockText(block), t=clean(raw);
      if(!t || type==="scene") return {physical:[],remote:[],mentioned:[]};
      if(type==="action"){
        const r=classify(raw,physical,remote,mentioned);
        if(forOpening){
          r.physical.forEach(id=>add(openingPhysical,id));
          r.remote.forEach(id=>add(openingRemote,id));
        }
        return r;
      }
      if(type==="char"){
        const cue=t.replace(/\s*\([^)]*\)\s*$/,"").trim();
        const c=charForCue(cue,chars), delivery=deliveryFor(raw);
        if(c){
          add(mentioned,c.id);
          if(delivery==="in-room") add(physical,c.id); else add(remote,c.id);
          if(forOpening){ if(delivery==="in-room")add(openingPhysical,c.id); else add(openingRemote,c.id); }
        }
        return {physical:c&&delivery==="in-room"?[c.id]:[],remote:c&&delivery!=="in-room"?[c.id]:[],mentioned:c?[c.id]:[]};
      }
      if(type==="dia"){
        /* Names spoken in a line are mentions, not bodies.  A remote marker in
           the line can still establish remote evidence for the named person. */
        classifyMention(raw);
        return {physical:[],remote:[],mentioned:namesInText(raw,chars)};
      }
      return {physical:[],remote:[],mentioned:[]};
    }

    /* Establish cast before this beat, then establish the whole authored beat.
       Blocks outside the selected beat cannot contribute to a later beat unless
       they are physically carried in the same slugline. */
    let inherited=[];
    if(first>=0){
      for(let i=segmentStart;i<first;i++) processBlock(all[i],i,false);
      inherited=physical.slice();
      selected.forEach(i=>{ if(i>=first) processBlock(all[i],i,false); });
    }
    /* Opening segment is bounded by the next slugline.  Later entrances or
       later dialogue in this beat are valid source, but not first-frame cast. */
    let openingEnd=selected.length ? selected[selected.length-1] : -1;
    if(first>=0){
      for(let i=first+1;i<=openingEnd;i++){ if(isScene(all[i])){openingEnd=i-1;break;} }
    }
    const openingIndexes=selected.filter(i=>i>=first&&i<=openingEnd);
    let openingAction="";
    openingIndexes.some(i=>{
      const b=all[i];
      if(String(b&&b.type||"").toLowerCase()==="action" && clean(blockText(b))){
        openingAction=openingActionOf(blockText(b)); return true;
      }
      return false;
    });
    if(first>=0){
      /* Re-run only the bounded opening segment into opening-local sets. */
      let openingActionSeen=false;
      openingIndexes.forEach(i=>{
        const b=all[i], type=String(b&&b.type||"").toLowerCase(), raw=blockText(b);
        if(!clean(raw)||type==="scene")return;
        if(type==="action"){
          /* Only the first action paragraph is the visual opener.  Later
             paragraphs in the same beat may contain an entrance or a message. */
          if(openingActionSeen)return;
          openingActionSeen=true;
          const r=classifyAction(openingAction,chars);
          r.physical.forEach(id=>add(openingPhysical,id));
          r.remote.forEach(id=>add(openingRemote,id));
        }else if(type==="char" && !openingAction && !openingPhysical.length && !openingRemote.length){
          const c=charForCue(clean(raw).replace(/\s*\([^)]*\)\s*$/,"").trim(),chars);
          const d=deliveryFor(raw);
          if(c){ if(d==="in-room")add(openingPhysical,c.id); else add(openingRemote,c.id); }
        }
      });
    }
    /* A dialogue-first beat has no action to name the opening situation.  The
       first in-room cue is the only safe visual candidate. */
    if(!openingAction){
      const firstCue=openingIndexes.map(i=>all[i]).find(b=>String(b&&b.type||"").toLowerCase()==="char");
      if(firstCue){
        const c=charForCue(clean(blockText(firstCue)).replace(/\s*\([^)]*\)\s*$/,"").trim(),chars);
        if(c&&deliveryFor(blockText(firstCue))==="in-room") add(openingPhysical,c.id);
      }
    }
    inherited.forEach(id=>add(opening,id));
    openingPhysical.forEach(id=>add(opening,id));
    /* Opening remote-only references are never allowed to become visual just
       because the same name was found in a message/banner later in the beat. */
    const openingCharacterIds=uniq(opening).filter(id=>openingRemote.indexOf(id)<0 || openingPhysical.indexOf(id)>=0);

    /* Dialogue is exact source text.  The cue and parenthetical are evidence,
       never a paraphrase or an AI speaker guess. */
    let speaker=null, speakerDelivery="in-room", cueIndex=-1, parenIndex=-1;
    selected.forEach(i=>{
      const b=all[i], type=String(b&&b.type||"").toLowerCase(), raw=blockText(b), t=clean(raw);
      if(!t||type==="scene")return;
      if(type==="char"){
        const cue=t.replace(/\s*\([^)]*\)\s*$/,"").trim();
        speaker=charForCue(cue,chars);
        speakerDelivery=deliveryFor(raw); cueIndex=i; parenIndex=-1;
        return;
      }
      if(type==="paren"){
        const marker=deliveryFor(raw);
        if(marker!=="in-room")speakerDelivery=marker;
        parenIndex=i; return;
      }
      if(type!=="dia")return;
      const text=raw;
      const row={
        speakerId:speaker&&speaker.id||"",
        speaker:speaker&&clean(speaker.name)||(
          cueIndex>=0 ? clean(blockText(all[cueIndex])) : "the speaker"),
        text,
        delivery:speakerDelivery||"in-room",
        evidence:{sceneId:scene&&scene.id||"",beatN:Number(beatN)||0,
          blockIndex:i,cueBlockIndex:cueIndex>=0?cueIndex:null,
          parentheticalBlockIndex:parenIndex>=0?parenIndex:null,sourceText:text}
      };
      // A visibly established actor speaking INTO a phone is the local end of
      // the call, not a disembodied remote participant. V.O./O.S. stay audio-only.
      if(row.delivery==="phone" && speaker && openingCharacterIds.includes(speaker.id)){
        row.channel="phone";
        row.delivery="in-room";
      }
      dialogue.push(row);
      if(speaker){
        add(mentioned,speaker.id);
        if(row.delivery==="in-room")add(physical,speaker.id); else add(remote,speaker.id);
      }
      speakerDelivery="in-room"; parenIndex=-1;
    });

    const outBlocks=(selection.sourceEntries||[]).map(entry=>{
      const b=entry.block, index=entry.index;
      return {...b,evidence:{sceneId:scene&&scene.id||"",beatN:Number(beatN)||0,
        blockIndex:index,sourceText:blockText(b),sourceType:b.type||""}};
    });
    const text=sourceBlocks.map(blockText).join("\n");
    const sourceRev=selection.hasSource ? screenplayBeatRevision(draft,beatN,selection) : "";
    const sceneHeading=selection.heading||"";
    return {
      hasSource:!!selection.hasSource,
      blocks:outBlocks,
      text,
      openingAction,
      openingCharacterIds:uniq(openingCharacterIds),
      physicalCharacterIds:uniq(physical),
      // Channel participation may overlap physical participation (a person can
      // be visible while talking on a phone). This list is remote-only CAST;
      // each dialogue row still carries its own delivery evidence.
      remoteCharacterIds:uniq(remote).filter(id=>!physical.includes(id)&&!openingCharacterIds.includes(id)),
      mentionedCharacterIds:uniq(mentioned),
      sourceRev,
      sceneHeading,
      dialogue
    };
  }

  // Beat cards also work for imported screenplay that has not acquired a beat
  // map yet. Planned rows may provide labels, never substitute page evidence.
  root.shotScreenplayBeatRows=function(scene,options){
    if(!scene) return [];
    const ctx=options||root.turnContinuity||{};
    const bm=(ctx.beatsMap||{})[scene.id]||{};
    const rows=Array.isArray(bm.rows)?bm.rows:[];
    const draft=(ctx.drafts||{})[scene.id];
    const blocks=Array.isArray(draft)?draft:blocksArray(draft);
    const byNumber=new Map();
    rows.forEach((row,i)=>{const n=Number(row&&row.n)||i+1;byNumber.set(n,{...row,n});});
    blocks.forEach(block=>{const n=beatOf(block);if(n&&!byNumber.has(n))byNumber.set(n,{n});});
    if(!byNumber.size&&blocks.some(b=>meaningful(b)&&!isScene(b)))byNumber.set(1,{n:1});
    return Array.from(byNumber.values()).sort((a,b)=>a.n-b.n);
  };
  root.shotBeatScreenplay=shotBeatScreenplay;
  root.shotScreenplayNamesInText=namesInText;
  root.shotScreenplayDelivery=deliveryFor;
})(typeof window!=="undefined" ? window : globalThis);