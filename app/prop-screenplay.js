/* Screenplay prop proposals. No model result mutates the inventory: validate exact
   source passages, then let the user choose new object / existing object / skip. */
(function(root){
  const norm = v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const uniq = xs=>Array.from(new Set(xs));
  const physical = new Set(["visible","handled","worn"]);
  const action = b=>! /^(scene|heading|slug|char|character|cue|dialogue|dialog|parenthetical|transition)$/i.test(String(b&&b.type||""));
  /* WHERE A REVIEWED PASSAGE IS NOW (2026-10-18, owner — "Redraft script from beats" review): a passage is
     checked in its saved block first, then anywhere in the same scene's current draft. A redraft that adds or
     removes a line renumbers the blocks, and an unchanged passage used to fail — the prop then quietly lost its
     scenes and continuity events. Spacing and curly quotes don't count as changes; the words must still be there. */
  const flat=v=>String(v||"").replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\s+/g," ").trim();
  function locate(e,drafts){
    if(!e || !e.quote) return 0;
    const q=flat(e.quote); if(!q) return 0;
    const bs=(((drafts||{})[e.sceneId]||{}).blocks||[]);
    const at=Number(e.block)-1;
    if(bs[at] && flat(bs[at].text).includes(q)) return at+1;
    for(let i=0;i<bs.length;i++) if(flat(bs[i]&&bs[i].text).includes(q)) return i+1;
    return 0;
  }
  function sourceValid(e,drafts){ return locate(e,drafts)>0; }
  // the passages still in the screenplay, each at the block it sits in NOW
  function sources(p,drafts){ return (p.screenplaySources||[]).map(e=>{ const b=locate(e,drafts);
    return !b ? null : (b===Number(e.block) ? e : { ...e, block:b }); }).filter(Boolean); }
  function scenesFor(p,drafts){ return uniq(sources(p,drafts).filter(e=>physical.has(e.presence)).map(e=>e.sceneId)); }
  function characterScenes(ownerId,ownerName,scenes,drafts,characters){
    const others=(characters||[]).filter(c=>c.id!==ownerId).flatMap(c=>norm(c.name).split(" "));
    let tokens=norm(ownerName).split(" ").filter(t=>t.length>1&&!others.includes(t));
    if(!tokens.length)tokens=[norm(ownerName)];
    const names=text=>tokens.some(t=>t&&(" "+norm(text)+" ").includes(" "+t+" "));
    return (scenes||[]).filter(s=>{
      const bs=(((drafts||{})[s.id]||{}).blocks||[]);
      const cues=bs.filter(b=>/^(char|character|cue)$/i.test(b.type||"")&&names(b.text));
      if(cues.length)return cues.some(b=>! /\b(V\.?\s*O\.?|O\.?\s*S\.?|VOICE\s*OVER|OFF\s*SCREEN)\b/i.test(b.text||""));
      return bs.some(b=>action(b)&&names(b.text));
    }).map(s=>s.id);
  }
  function group(p){
    // a carried object nobody established is shown as a proposal, whatever group it was saved in
    // (display only — stored cards are never moved or migrated)
    if(isProposal(p)) return "proposed";
    if(p.inventoryGroup && p.inventoryGroup!=="proposed") return p.inventoryGroup;
    if((p.screenplaySources||[]).length || p.manual || p.proposalAccepted) return "story";
    const k=root.classifyPropKind?root.classifyPropKind(p.name):"";
    return (k||p.kind)==="worn" ? "accessories" : "story";
  }
  function nameIssue(name){
    const n=String(name||"").trim();
    return !n || /(?:…|\.\.\.)$/.test(n) || /^(plain|laminated|small|large|black|white|silver|gold|new prop)$/i.test(n)
      ? "Incomplete object name — identify the object before designing it." : "";
  }
  // Not established by the screenplay: never reviewed against it and not a hand-added
  // object. Brief-derived and legacy department proposals land here until extraction
  // links evidence. Saved-but-stale sources are a different state ("Source changed").
  function notInScreenplay(p){
    const o=p&&p.origin&&typeof p.origin==="object"?p.origin:null;
    return !!p && !p.manual && !(o&&o.kind==="manual") && !(p.screenplaySources||[]).length;
  }
  /* CARRIED PROPS COME FROM THE STORY (owner 2026-10-12): a CARRIED object the screenplay hasn't
     established (no reviewed passage), that wasn't added by hand and that the user hasn't chosen to
     keep, is a PROPOSAL — shown in its own group "Proposed — not in the screenplay", never a story
     prop. It stops being one when Extract screenplay props links a passage to it (then it's a story
     prop with its evidence) or when the user keeps it (acceptPatch — their explicit choice; the card
     keeps its design origin and its "Not in screenplay" badge). Worn items from the character design
     and set dressing are never proposals. */
  function isProposal(p){
    return !!p && (p.kind||"carried")==="carried" && !p.proposalAccepted && notInScreenplay(p);
  }
  function acceptPatch(now){
    return {proposalAccepted:true,proposalAcceptedAt:now||new Date().toISOString(),inventoryGroup:"story"};
  }
  /* What a BATCH or an AGENT may not pay for (images or writing): a proposal, on any film; and, once
     the screenplay has been read (extracted = some card has reviewed evidence), any other object it
     didn't establish — except worn items from the character design and cards the user keeps
     (hand-added or accepted). A single card's own buttons still work: that is the user's choice. */
  function batchSkip(p,extracted){
    if(!p) return true;
    if(isProposal(p)) return true;
    return !!extracted && (p.kind||"carried")!=="worn" && !p.proposalAccepted && notInScreenplay(p);
  }
  // Whether an object earns its own reference image. "text" objects are described in
  // shot prompts instead, so batch generation and shot renders don't spend image
  // credits on them. Only reviewed evidence can demote an object; without evidence
  // (hand-added, brief-only, stale sources) it keeps its own image as before.
  function sheetTier(p,drafts){
    if(p&&(p.sheetTier==="own"||p.sheetTier==="text")) return {tier:p.sheetTier,auto:false,reason:"Set on this card"};
    const src=sources(p||{},drafts).filter(e=>physical.has(e.presence));
    const saved=(p&&p.screenplaySources)||[];
    if(!saved.length) return {tier:"own",auto:true,reason:(p&&p.manual)?"Added by hand":"No reviewed screenplay evidence to judge from"};
    if(!src.length && !sources(p,drafts).length) return {tier:"own",auto:true,reason:"Screenplay evidence needs review"};
    const sc=uniq(src.map(e=>e.sceneId));
    if(src.some(e=>e.presence==="handled")) return {tier:"own",auto:true,reason:"Handled on screen"};
    if(sc.length>1) return {tier:"own",auto:true,reason:"Seen in "+sc.length+" scenes"};
    if(((p&&p.continuityEvents)||[]).length) return {tier:"own",auto:true,reason:"Has story events"};
    if(String((p&&p.contentNotes)||"").trim()) return {tier:"own",auto:true,reason:"Has readable content"};
    return {tier:"text",auto:true,reason:sc.length?"Seen once, never handled":"Only mentioned"};
  }
  function sourceKey(e){ return [e.sceneId,e.block,e.quote,e.presence].join("|"); }
  function mergeBy(xs,ys,key){const seen=new Set(xs.map(key));return xs.concat(ys.filter(x=>{const k=key(x);if(seen.has(k))return false;seen.add(k);return true;}));}
  function chunks(scene,drafts){
    const out=[]; let part=[], size=0;
    (((drafts||{})[scene.id]||{}).blocks||[]).forEach((b,i)=>{
      const text=String(b.text||"");
      // Long blocks are split, never discarded; quotes retain their original block.
      for(let at=0;at<text.length;at+=10000){
        const row={block:i+1,type:b.type||"action",beat:b.beat||b.beatId||null,text:text.slice(at,at+10000)};
        if(size+row.text.length>14000 && part.length){out.push(part);part=[];size=0;}
        part.push(row);size+=row.text.length;
      }
    });
    if(part.length) out.push(part); return out;
  }
  function normalizeResult(raw,scene,drafts,characters,locations){
    let rejected=0;
    const evidence=items=>(Array.isArray(items)?items:[]).flatMap(e=>{
      const b=(((drafts||{})[scene.id]||{}).blocks||[])[Number(e.block)-1];
      const source={sceneId:scene.id,sceneNo:scene.no,block:Number(e.block),beat:b&&(b.beat||b.beatId)||null,
        quote:String(e.quote||""),presence:physical.has(e.presence)?e.presence:"mentioned"};
      if(!sourceValid(source,drafts)){rejected++;return [];}
      // Dialogue alone cannot establish a visible asset. Preserve it as a mention.
      if(!action(b)) source.presence="mentioned";
      return [source];
    });
    const candidates=(Array.isArray(raw.props)?raw.props:[]).flatMap(p=>{
      const es=evidence(p.sources), name=String(p.name||"").trim();
      // A cast member (person, animal, creature) is never a prop, whatever the model says.
      if(!name || nameIssue(name) || !es.length || (characters||[]).some(c=>norm(c.name)&&norm(c.name)===norm(name))){rejected++;return [];}
      const owner=(characters||[]).find(c=>c.id===p.ownerId);
      const loc=(locations||[]).find(l=>l.id===p.locationId);
      const events=(Array.isArray(p.events)?p.events:[]).flatMap(e=>{
        const src=es.find(s=>s.block===Number(e.block)&&s.quote===e.quote&&physical.has(s.presence));
        if(!src || !["acquired","handed_over","placed","removed","updated","damaged","destroyed","consumed","recovered"].includes(e.type))return [];
        const holder=(characters||[]).find(c=>c.id===e.holderId), place=(locations||[]).find(l=>l.id===e.locationId);
        if(["acquired","handed_over","recovered"].includes(e.type)&&!holder)return [];
        if(e.type==="placed"&&!place)return [];
        return [{type:e.type,sceneId:scene.id,beatId:src.beat||"",holderId:holder?holder.id:"",holderName:holder?holder.name:"",
          locationId:place?place.id:"",condition:String(e.condition||""),note:String(e.note||src.quote),source:src,
          ...(e.type==="updated"&&e.contentNotes?{contentNotes:String(e.contentNotes)}:{}),...(e.type==="updated"&&e.contentVersion?{contentVersion:String(e.contentVersion)}:{})}];
      });
      return [{name,aliases:uniq((Array.isArray(p.aliases)?p.aliases:[]).filter(x=>typeof x==="string"&&x.trim())),
        suggestedId:String(p.sameAs||""),identityNote:String(p.identityNote||""),
        kind:["worn","carried","dressing"].includes(p.kind)?p.kind:"carried",
        inventoryGroup:p.group==="accessories"?"accessories":"story",ownerId:owner?owner.id:"",ownerName:owner?owner.name:"",
        locationId:loc?loc.id:"",screenplaySources:es,continuityEvents:events,
        contentNotes:String(p.contentNotes||""),warnings:(Array.isArray(p.warnings)?p.warnings:[]).map(String)}];
    });
    return {candidates,rejected};
  }
  function accept(existing,decisions,drafts){
    // Validate all decisions before applying anything (including deleted targets).
    const selected=decisions.filter(d=>d.target!=="skip");
    selected.forEach(d=>{
      if(nameIssue(d.name))throw new Error(nameIssue(d.name));
      if(!d.screenplaySources.length || d.screenplaySources.some(e=>!sourceValid(e,drafts)))throw new Error("The screenplay changed. Extract again before applying these proposals.");
      if(d.target!=="new"&&!existing.some(p=>p.id===d.target))throw new Error("A selected existing prop is no longer available. Choose another object.");
    });
    let out=existing.slice();
    selected.forEach((d,i)=>{
      const old=d.target==="new"?null:out.find(p=>p.id===d.target);
      const id=old?old.id:"prop-script-"+Date.now().toString(36)+"-"+i+"-"+Math.random().toString(36).slice(2,8);
      const priorSources=old&&old.screenplaySources||[];
      // a passage the screenplay still has is the SAME passage wherever it moved (2026-10-18): kept at its block now,
      // and replaced by the fresh extraction's copy of it, never doubled
      const samePassage=e=>[e.sceneId,flat(e.quote),e.presence].join("|");
      const kept=priorSources.map(s=>{ const b=locate(s,drafts); return b ? (b===Number(s.block) ? s : {...s,block:b}) : null; }).filter(Boolean)
        .filter(s=>!d.screenplaySources.some(f=>samePassage(f)===samePassage(s)));
      const es=mergeBy(kept,d.screenplaySources,sourceKey);
      const history=mergeBy(old&&old.screenplaySourceHistory||[],priorSources.filter(s=>!sourceValid(s,drafts)),sourceKey);
      const events=mergeBy(old&&old.continuityEvents||[],d.includeEvents?d.continuityEvents.map((e,n)=>({...e,id:"pe-"+id+"-"+Date.now().toString(36)+"-"+n})):[],e=>e.source?sourceKey(e.source)+"|"+e.type:e.id);
      const base=old||{id,name:d.name,kind:d.kind,kindSet:true,inventoryGroup:d.inventoryGroup,ownerId:d.ownerId,ownerName:d.ownerName,
        locationId:d.locationId,form:"",material:"",detail:"",size:"",sizeBasis:"estimated",origin:{kind:"screenplay"}};
      const next={...base,aliases:uniq([...(base.aliases||[]),...d.aliases,...(old&&norm(old.name)!==norm(d.name)?[d.name]:[])]),
        screenplaySources:es,screenplaySourceHistory:history,scenes:uniq(es.filter(e=>physical.has(e.presence)&&sourceValid(e,drafts)).map(e=>e.sceneId)),
        continuityEvents:events,contentNotes:base.contentNotes||d.contentNotes,identityNote:base.identityNote||d.identityNote,
        extractionWarnings:uniq([...(base.extractionWarnings||[]),...d.warnings]),screenplayReviewed:true,
        // a proposal the screenplay turns out to name becomes a story prop in the reviewed group
        ...(old&&isProposal(old)?{inventoryGroup:d.inventoryGroup==="accessories"?"accessories":"story"}:{})};
      if(old) out=out.map(p=>p.id===id?next:p); else out.push(next);
    });
    return out;
  }
  root.PropScreenplay={sourceValid,locate,sources,scenesFor,characterScenes,group,nameIssue,notInScreenplay,isProposal,acceptPatch,batchSkip,sheetTier,sourceKey,mergeBy,chunks,normalizeResult,accept,physical};
})(window);
