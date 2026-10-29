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
  /* WHAT IS A PROP (owner 2026-10-29 — "minimise the props; only what matters to the story"). A script
     breakdown sends every object to one of four places: COSTUME (worn — the costume department; it is drawn on
     its character's sheet), SET DRESSING (sits in the room — part of the location), BACKGROUND PROPS (handled
     once, ordinary — the shot's words) and HERO PROPS (the few the story depends on). Only hero props are cards
     a film designs. An object the screenplay names is one when it passes at least one test:
       returns — seen in two or more scenes; changes — handed over, opened, read, hidden, broken, found…;
       turns — the story turns on it (a setup / payoff, part of a scene's turn, or dialogue about it).
     A card the user made by hand or chose to keep is a story prop by their choice. Nothing stored is migrated:
     an older card that fails is shown under "Not story props" until the user keeps it or moves it out. */
  const ROLES=["hero","costume","dressing","background"];
  const EVENT_WORDS={acquired:"taken",handed_over:"changes hands",placed:"put down",removed:"taken away",updated:"altered",
    damaged:"damaged",destroyed:"destroyed",consumed:"used up",recovered:"recovered"};
  const sceneNoIn=(p,id)=>{ const e=(p.screenplaySources||[]).find(x=>x&&x.sceneId===id); return e&&e.sceneNo!=null?e.sceneNo:null; };
  const numSort=(a,b)=>(Number(a)||0)-(Number(b)||0)||String(a).localeCompare(String(b));
  function significance(p,drafts){
    p=p||{};
    const src=(drafts?sources(p,drafts):(p.screenplaySources||[])).filter(e=>e&&physical.has(e.presence));
    const sceneNos=uniq(src.map(e=>e.sceneNo!=null?e.sceneNo:e.sceneId)).sort(numSort);
    const changes=[];
    const addChange=(what,no)=>{ if(what && !changes.some(c=>c.what===what&&String(c.sceneNo)===String(no))) changes.push({what,sceneNo:no}); };
    (p.continuityEvents||[]).forEach(e=>{ if(e&&EVENT_WORDS[e.type]) addChange(EVENT_WORDS[e.type], (e.source&&e.source.sceneNo!=null)?e.source.sceneNo:sceneNoIn(p,e.sceneId)); });
    (p.storyChanges||[]).forEach(c=>{ if(c) addChange(String(c.what||"").trim(), c.sceneNo); });
    const turn=p.storyTurn&&String(p.storyTurn.reason||"").trim()?p.storyTurn:null;
    const tests={returns:sceneNos.length>=2,changes:changes.length>0,turns:!!turn};
    const reasons=[];
    if(tests.returns) reasons.push("Returns in scenes "+listNos(sceneNos));
    if(tests.changes){
      const byWhat={}; changes.forEach(c=>{ (byWhat[c.what]=byWhat[c.what]||[]).push(c.sceneNo); });
      reasons.push(Object.keys(byWhat).map(w=>{ const nos=byWhat[w].filter(n=>n!=null); return w+(nos.length?" in "+listNos(uniq(nos).sort(numSort)):""); }).join(", "));
    }
    if(tests.turns) reasons.push("the story turns on it: "+String(turn.reason).trim().replace(/\.$/,""));
    return {pass:tests.returns||tests.changes||tests.turns,tests,sceneNos,changes,turn,reasons};
  }
  function listNos(nos){ const a=nos.map(String); return a.length<2?a.join(""):a.slice(0,-1).join(", ")+" and "+a[a.length-1]; }
  // the user's own choice: a card made by hand, or one they kept (older "Keep this prop" included)
  function storyChoice(p){ const o=p&&p.origin&&typeof p.origin==="object"?p.origin:null;
    return !!p && !!(p.manual || (o&&o.kind==="manual") || p.keptAsProp || p.proposalAccepted); }
  function isStoryProp(p,drafts){
    if(!p) return false;
    if(storyChoice(p)) return true;
    if(!(p.screenplaySources||[]).length) return false;
    return significance(p,drafts).pass;
  }
  // why a card is NOT a story prop, in a few words (the card and the Not story props group say it)
  function notPropReason(p,drafts){
    if(!p || isStoryProp(p,drafts)) return "";
    const o=p.origin&&typeof p.origin==="object"?p.origin:{};
    const who=p.ownerName||o.characterName||"";
    if(!(p.screenplaySources||[]).length){
      if((p.kind||"carried")==="worn") return "Costume"+(who?" from "+who+"'s look":"")+" \u2014 drawn on "+(who?who+"'s":"the")+" character sheet; the screenplay doesn't name it";
      if(o.kind==="design") return "Cut from an image \u2014 the screenplay doesn't name it";
      return "A guess"+(who?" from "+who+"'s write-up":"")+" \u2014 the screenplay doesn't name it";
    }
    const sig=significance(p,drafts);
    const role=p.propRole&&ROLES.includes(p.propRole)?p.propRole:((p.kind||"carried")==="worn"?"costume":p.kind==="dressing"?"dressing":"background");
    const where=sig.sceneNos.length?("scene "+listNos(sig.sceneNos)):"the screenplay";
    return ROLE_LABEL[role]+" \u2014 in "+where+" only, and nothing happens to it";
  }
  const ROLE_LABEL={hero:"Named once",costume:"Costume",dressing:"Set dressing",background:"Background prop"};
  /* Display group: "story" or "other" (Not story props). Stored inventoryGroup values ("accessories",
     "proposed") are never migrated — they no longer decide the view. */
  function group(p,drafts){ return isStoryProp(p,drafts) ? "story" : "other"; }
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
  /* (owner 2026-10-29) a PROPOSAL is now any card that isn't a story prop: the name stays for the call sites
     that skip proposals (batches, agents, Draft all) — they skip every object the story doesn't depend on. */
  function isProposal(p){ return !!p && !isStoryProp(p); }
  // keeping a card is the user's explicit choice: it becomes a story prop (its origin is kept)
  function acceptPatch(now){
    return {keptAsProp:true,proposalAccepted:true,proposalAcceptedAt:now||new Date().toISOString(),inventoryGroup:"story"};
  }
  /* What a BATCH or an AGENT may not pay for (images or writing): anything that isn't a story prop. A single
     card's own buttons still work: that is the user's choice. (`extracted` is kept for older callers.) */
  function batchSkip(p,extracted){ return !isStoryProp(p); }
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
      // what happens to it and why the story needs it — each with its own exact passage (2026-10-29); a turn
      // may cite dialogue ("dialogue is about it"), a change must be on screen
      const blocksOf=(((drafts||{})[scene.id]||{}).blocks||[]);
      const cited=(e,onScreen)=>{ if(!e||!e.quote) return null; const b=blocksOf[Number(e.block)-1];
        const src={sceneId:scene.id,block:Number(e.block),quote:String(e.quote)};
        if(!sourceValid(src,drafts) || (onScreen && !action(b))){ rejected++; return null; } return src; };
      const storyChanges=(Array.isArray(p.changes)?p.changes:[]).flatMap(c=>{ const what=String(c&&c.what||"").trim().slice(0,40);
        const src=what&&cited(c,true); return src?[{what,sceneId:scene.id,sceneNo:scene.no,quote:src.quote}]:[]; });
      const t=p.turn&&typeof p.turn==="object"?p.turn:null, tsrc=t&&String(t.reason||"").trim()&&cited(t,false);
      const storyTurn=tsrc?{reason:String(t.reason).trim().slice(0,160),sceneId:scene.id,sceneNo:scene.no,quote:tsrc.quote}:null;
      const role=ROLES.includes(p.role)?p.role:(p.kind==="worn"?"costume":p.kind==="dressing"?"dressing":"hero");
      return [{name,aliases:uniq((Array.isArray(p.aliases)?p.aliases:[]).filter(x=>typeof x==="string"&&x.trim())),
        suggestedId:String(p.sameAs||""),maybeSameAs:String(p.maybeSameAs||""),identityNote:String(p.identityNote||""),
        propRole:role,storyChanges,storyTurn,
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
        // why it is a prop (2026-10-29): what happens to it — the read's events count even when they aren't added
        // as story events — and why the story turns on it; the user's "Make it a prop" is kept as their choice
        storyChanges:mergeBy(base.storyChanges||[],[...(d.storyChanges||[]),...(d.continuityEvents||[]).filter(e=>EVENT_WORDS[e.type])
          .map(e=>({what:EVENT_WORDS[e.type],sceneId:e.sceneId,sceneNo:e.source&&e.source.sceneNo,quote:e.source&&e.source.quote||""}))],c=>[c.what,c.sceneId,c.quote].join("|")),
        ...((base.storyTurn||d.storyTurn)?{storyTurn:base.storyTurn||d.storyTurn}:{}),
        ...(d.propRole&&!base.propRole?{propRole:d.propRole}:{}),
        ...(d.keptAsProp?{keptAsProp:true}:{}),
        ...(old&&old.inventoryGroup==="proposed"?{inventoryGroup:"story"}:{})};
      if(old) out=out.map(p=>p.id===id?next:p); else out.push(next);
    });
    return out;
  }
  /* THE SCREENPLAY READ'S CANDIDATES (2026-10-29). One object, one card: a later passage the read is SURE is
     the same object merges in; one it isn't sure about keeps a question (maybeSameAs) the review asks once.
     Then each candidate is judged as a prop: one that passes is added by default, the rest are listed
     under "Not props" (skipped) with a "Make it a prop" button. */
  function mergeCandidate(prior,p){
    if(!prior.screenplaySources.some(s=>physical.has(s.presence))&&p.screenplaySources.some(s=>physical.has(s.presence))&&prior.target==="skip"&&!prior.notProp)prior.target="new";
    prior.screenplaySources=mergeBy(prior.screenplaySources,p.screenplaySources,sourceKey);
    prior.continuityEvents=mergeBy(prior.continuityEvents,p.continuityEvents,e=>sourceKey(e.source)+"|"+e.type);
    prior.storyChanges=mergeBy(prior.storyChanges||[],p.storyChanges||[],c=>[c.what,c.sceneId,c.quote].join("|"));
    if(!prior.storyTurn&&p.storyTurn)prior.storyTurn=p.storyTurn;
    if(p.propRole==="hero")prior.propRole="hero";
    prior.aliases=uniq([...prior.aliases,...(norm(p.name)!==norm(prior.name)?[p.name]:[]),...p.aliases]);
    prior.warnings=uniq([...prior.warnings,...p.warnings]);
    prior.contentNotes=[prior.contentNotes,p.contentNotes].filter(Boolean).filter((v,n,a)=>a.indexOf(v)===n).join("\n");
    return prior;
  }
  // a candidate seen with the card it links to (its passages and events count together)
  function withTarget(c,existing){
    const old=c.target&&c.target!=="new"&&c.target!=="skip"?(existing||[]).find(x=>x.id===c.target):null;
    return old?{...c,screenplaySources:[...(old.screenplaySources||[]),...c.screenplaySources],continuityEvents:[...(old.continuityEvents||[]),...c.continuityEvents],
      storyChanges:[...(old.storyChanges||[]),...(c.storyChanges||[])],storyTurn:c.storyTurn||old.storyTurn||null}:c;
  }
  function candidateSignificance(c,existing){
    const v=withTarget(c,existing);
    return significance({...v,storyChanges:[...(v.storyChanges||[]),...(v.continuityEvents||[]).filter(e=>EVENT_WORDS[e.type]).map(e=>({what:EVENT_WORDS[e.type],sceneNo:e.source&&e.source.sceneNo}))]});
  }
  // the default choice for every candidate, once all of them are in (also after a "same object" answer)
  function settleCandidates(cands,existing){
    return (cands||[]).map(c=>{
      if(c.keptAsProp) return {...c,notProp:false};
      const seen=c.screenplaySources.some(s=>physical.has(s.presence));
      const linked=c.target&&c.target!=="new"&&c.target!=="skip"?(existing||[]).find(x=>x.id===c.target):null;
      const pass=candidateSignificance(c,existing).pass || !!(linked&&storyChoice(linked));
      if(!seen) return {...c,notProp:false,target:"skip"};
      if(!pass) return {...c,notProp:true,target:"skip",priorTarget:c.target!=="skip"?c.target:(c.priorTarget||"new")};
      return {...c,notProp:false,target:c.target==="skip"?(c.priorTarget||"new"):c.target};
    });
  }
  // "Is the letter in scene 6 the one from scene 2?" — asked with the passages' scene numbers, never the model's words
  function sameQuestion(c,cands,existing){
    const id=c&&c.maybeSameAs; if(!id||c.sameAnswered) return null;
    const other=(cands||[]).find(x=>x.reviewId===id&&x!==c) || (existing||[]).find(x=>x.id===id);
    if(!other) return null;
    const nos=x=>uniq((x.screenplaySources||[]).map(s=>s.sceneNo).filter(n=>n!=null)).sort(numSort);
    const mine=nos(c), theirs=nos(other);
    return {otherId:other.reviewId||other.id,isCard:!other.reviewId,
      text:"Is the "+c.name.replace(/^(the|a|an)\s+/i,"").toLowerCase()+(mine.length?" in scene "+listNos(mine):"")+" the one "+(theirs.length?"from scene "+listNos(theirs):"named “"+other.name+"”")+"?",
      otherName:other.name};
  }
  // the answer: "yes" merges it into the other candidate (or links it to that card); "no" keeps it separate
  function answerSame(cands,reviewId,yes,existing){
    const c=(cands||[]).find(x=>x.reviewId===reviewId); if(!c) return cands;
    if(!yes) return settleCandidates(cands.map(x=>x===c?{...x,sameAnswered:"different"}:x),existing);
    const other=cands.find(x=>x.reviewId===c.maybeSameAs);
    if(other){ const merged=mergeCandidate({...other,screenplaySources:other.screenplaySources.slice(),continuityEvents:other.continuityEvents.slice()},c);
      return settleCandidates(cands.filter(x=>x!==c).map(x=>x===other?merged:x),existing); }
    return settleCandidates(cands.map(x=>x===c?{...x,target:c.maybeSameAs,priorTarget:c.maybeSameAs,sameAnswered:"same"}:x),existing);
  }
  root.PropScreenplay={significance,isStoryProp,storyChoice,notPropReason,ROLES,mergeCandidate,candidateSignificance,settleCandidates,sameQuestion,answerSame,sourceValid,locate,sources,scenesFor,characterScenes,group,nameIssue,notInScreenplay,isProposal,acceptPatch,batchSkip,sheetTier,sourceKey,mergeBy,chunks,normalizeResult,accept,physical};
})(window);
