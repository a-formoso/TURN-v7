/* scene-plan.js — THE SCENE PLAN (owner 2026-11-22: "a system for scene creation or shot creation ... tackle scenes
   beat by beat"; "yes, go with it, end frames per beat"; then: the tracked things "could be turned into props for that
   scene ... we need these props listed in the props tab ... assign them to each character ... and ... to their
   particular scenes ... How do we ensure this happens for every project?").

   A few short writing passes (the staging from the whole scene, then the shots a few beats at a time: no single call
   may run past the ~150 s the server waits) read the whole scene, then every beat, and answer with:
     blocking     where each person stands in each beat, in the set's own terms
     the line     which side the camera keeps to
     things       every prop, what people wear and each door, beat by beat (the THINGS TRACKER)
     camera idea  how the camera follows the value turn
     shots        one per screenplay moment, each with how it STARTS, how it ENDS and how it hands off

   This file is the part with no engine in it (pure, plain JS, also run by scripts/test-scene-plan.mjs):
     sets         the sets of a scene, from its sluglines (an EXT heading inside the scene is another set)
     normalize    a model's answer made safe (unknown ids dropped, the app's own camera words, one shot per moment)
     shotRows     the plan's shots as the rows the existing shot draft takes (a beat's first shot = its opening shot)
     applyToShots the start and end states written on the scene's saved shots
     checks       what does not join up, in plain words
     thingProp / thingCard / ownerItems   a tracked thing as a prop card, tied to its scene and its character
   Stage 1 only: nothing here makes or changes an image. */
(function(root){
  "use strict";
  const SIZES=["EWS","WS","FS","MWS","MS","MCU","CU","ECU","INSERT"];
  const ANGLES=["eye","high","low","top","dutch","ots","pov"];
  const MOVES=["static","pan","tilt","push","pull","track","handheld","crane","steadi"];
  const LENSES=[14,24,35,50,85,135,200];
  const HANDOFFS=["cut","match","time-cut"];
  const KINDS=["prop","wardrobe","set"];

  const text=(v,max)=>{ const s=String(v==null?"":v).replace(/\s+/g," ").trim(); return max&&s.length>max ? s.slice(0,max).replace(/\s+\S*$/,"") : s; };
  const norm=v=>String(v==null?"":v).toLowerCase().replace(/[‘’']/g,"").replace(/[^a-z0-9]+/g," ").trim();
  const slug=v=>norm(v).replace(/ /g,"-").slice(0,40);
  const uniq=a=>Array.from(new Set(a));
  const arr=v=>Array.isArray(v)?v:[];
  const obj=v=>(v&&typeof v==="object"&&!Array.isArray(v))?v:{};
  const STOP=new Set(["the","a","an","of","in","on","at","by","to","with","and","his","her","their","its","near","next","beside","is","it","still","now"]);
  const words=v=>norm(v).split(" ").filter(w=>w&&!STOP.has(w));
  // words that say a state: "back door shut" and "back door open" share two words of three and are not the same
  const STATE=new Set(["open","opened","ajar","shut","closed","locked","unlocked","off","lit","unlit","full","empty","raised","lowered","up","down",
    "broken","intact","wet","dry","drawn","standing","sitting","seated","kneeling","lying","inside","outside"]);
  // two short descriptions say the same thing: the same words, or one holds the other's
  function sameText(a,b){
    const A=words(a), B=words(b);
    if(!A.length||!B.length) return true;
    const sa=new Set(A), sb=new Set(B);
    if(A.some(w=>STATE.has(w)&&!sb.has(w))&&B.some(w=>STATE.has(w)&&!sa.has(w))) return false;
    const hit=A.filter(w=>sb.has(w)).length;
    if(hit===sa.size||hit===sb.size) return true;
    return hit/(sa.size+sb.size-hit)>=0.5;
  }

  /* ---- the app's own camera words ------------------------------------------------ */
  function sizeId(v){
    const u=String(v||"").toUpperCase().trim();
    if(SIZES.indexOf(u)>=0) return u;
    const s=norm(v);
    if(!s) return "";
    if(/insert/.test(s)) return "INSERT";
    if(/extreme (close|cu)|\becu\b|\bxcu\b/.test(s)) return "ECU";
    if(/extreme (wide|long)|\bews\b|\bxws\b|establishing/.test(s)) return "EWS";
    if(/medium close|\bmcu\b/.test(s)) return "MCU";
    if(/medium (wide|long|full)|\bmws\b|\bmls\b|cowboy/.test(s)) return "MWS";
    if(/close/.test(s)) return "CU";
    if(/\bfull\b/.test(s)) return "FS";
    if(/wide|long shot|\bls\b|master/.test(s)) return "WS";
    if(/medium|mid|two shot|\b2 shot\b/.test(s)) return "MS";
    return "";
  }
  function angleId(v){
    const l=String(v||"").toLowerCase().trim();
    if(ANGLES.indexOf(l)>=0) return l;
    const s=norm(v);
    if(!s) return "";
    if(/over the shoulder|over shoulder|\bots\b/.test(s)) return "ots";
    if(/point of view|\bpov\b/.test(s)) return "pov";
    if(/overhead|top down|birds? eye|\btop\b/.test(s)) return "top";
    if(/dutch|canted/.test(s)) return "dutch";
    if(/\bhigh\b/.test(s)) return "high";
    if(/\blow\b|worms? eye/.test(s)) return "low";
    if(/eye|level|neutral|straight/.test(s)) return "eye";
    return "";
  }
  function moveId(v){
    const l=String(v||"").toLowerCase().trim();
    if(MOVES.indexOf(l)>=0) return l;
    const s=norm(v);
    if(!s) return "";
    if(/steadi|gimbal|follow/.test(s)) return "steadi";
    if(/hand ?held/.test(s)) return "handheld";
    if(/crane|jib|boom/.test(s)) return "crane";
    if(/push|dolly in|track in|creep in|zoom in/.test(s)) return "push";
    if(/pull|dolly out|track out|zoom out/.test(s)) return "pull";
    if(/track|dolly|truck|lateral/.test(s)) return "track";
    if(/\bpan\b|whip/.test(s)) return "pan";
    if(/tilt/.test(s)) return "tilt";
    if(/static|locked|still|fixed|tripod|none/.test(s)) return "static";
    return "";
  }
  function lensId(v){
    const n=Number((String(v==null?"":v).match(/\d{2,3}/)||[])[0]);
    if(!Number.isFinite(n)||n<=0) return "";
    return String(LENSES.reduce((best,x)=>Math.abs(x-n)<Math.abs(best-n)?x:best,LENSES[0]));
  }
  function handoffType(v){
    const s=norm(v);
    if(/time/.test(s)) return "time-cut";
    if(/match/.test(s)) return "match";
    return "cut";
  }

  /* ---- THE SETS OF A SCENE --------------------------------------------------------
     The scene's own slugline is its first set. Each slugline written inside the scene is a set too (an EXT heading
     in a scene filed INT is another location). The same heading met again is the same set.
     opts: {locations, sceneLocation (the scene's own card), parseSlugline, timeOf} */
  function parseHeading(raw,opts){
    const s=text(raw);
    if(!s) return null;
    if(opts&&typeof opts.parseSlugline==="function"){ try{ const p=opts.parseSlugline(s); if(p&&p.place) return {intExt:String(p.intExt||"").toUpperCase(),place:text(p.place),time:text(p.time)}; }catch(e){} }
    let t=s.replace(/^\s*\d+[.)]?\s+/,""), intExt="";
    const m=t.match(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?)\s*/i);
    if(m){ intExt=m[1].toUpperCase().replace(/\./g,"").replace("I/E","INT/EXT"); t=t.slice(m[0].length); }
    let time="";
    // the time of day is what follows the LAST separator ("HOUSE - KITCHEN - NIGHT" is the kitchen, at night)
    const tm=t.match(/^(.*)(?:\u00b7|\u2014|\u2013|,|\s-\s)\s*([A-Za-z][A-Za-z' ]{1,24})\s*$/);
    if(tm&&/\b(night|day|dawn|dusk|morning|evening|afternoon|continuous|later|sunset|sunrise|midnight|noon|twilight)\b/i.test(tm[2])){ time=text(tm[2]); t=tm[1]; }
    t=t.replace(/[·—–,\-\s]+$/,"").trim();
    return t ? {intExt,place:t,time} : null;
  }
  function sideOf(intExt){ const s=String(intExt||"").toUpperCase(); return s==="INT"||s==="EXT" ? s : (s ? "BOTH" : ""); }
  function locationFor(place,sceneId,locations){
    const p=norm(place); if(!p) return null;
    const list=arr(locations).filter(l=>l&&l.id);
    const names=l=>[l.name].concat(arr(l.aliases),arr(l.alsoNames)).map(norm).filter(Boolean);
    const here=l=>arr(l.scenes).indexOf(sceneId)>=0;
    const pick=c=>c.length ? (c.filter(here)[0]||c[0]) : null;
    const exact=pick(list.filter(l=>names(l).indexOf(p)>=0));
    if(exact) return exact;
    // "FATHER'S HOUSE - KITCHEN" names the room last: the card whose name ends the heading is the nearest one (the room),
    // then the card whose name opens it (the place); the longest name of each
    const longest=test=>{ const c=list.filter(l=>names(l).some(n=>n.length>=4&&test(n))).sort((a,b)=>norm(b.name).length-norm(a.name).length);
      return pick(c.filter(l=>norm(l.name).length===norm((c[0]||{}).name).length)); };
    return longest(n=>p.endsWith(" "+n)) || longest(n=>p.startsWith(n+" "));
  }
  function sets(scene,draft,opts){
    opts=opts||{};
    if(!scene) return [];
    const blocks=Array.isArray(draft)?draft:arr(draft&&draft.blocks);
    const out=[]; let cur=null, lastBeat=0;
    const open=(heading)=>{
      const h=text(heading); if(!h) return cur;
      const parsed=parseHeading(h,opts)||{intExt:"",place:h,time:""};
      const key=norm(parsed.intExt+" "+parsed.place+" "+parsed.time);
      let set=out.find(x=>x._key===key);
      if(!set){
        const loc=locationFor(parsed.place,scene.id,opts.locations);
        let time=parsed.time;
        if(time&&typeof opts.timeOf==="function"){ try{ time=opts.timeOf(time)||time; }catch(e){} }
        set={id:"set"+(out.length+1),heading:h,place:parsed.place,side:sideOf(parsed.intExt),time,
          locationId:loc?String(loc.id):"",locationName:loc?text(loc.name):"",beats:[],_key:key};
        out.push(set);
      }
      cur=set; return set;
    };
    if(text(scene.loc)) open(scene.loc);
    blocks.forEach(b=>{
      if(!b) return;
      const n=Number(b.beat); if(Number.isFinite(n)&&n>0) lastBeat=n;
      if(String(b.type||"").toLowerCase()==="scene"){ open(b.text); return; }
      if(!text(b.text)) return;
      if(!cur) open(scene.loc||"THE SCENE");
      if(cur&&lastBeat&&cur.beats.indexOf(lastBeat)<0) cur.beats.push(lastBeat);
    });
    // a heading nothing plays under (the scene's own slugline, worded another way on the page) is not a set
    const used=out.some(s=>s.beats.length) ? out.filter(s=>s.beats.length) : out;
    return used.map((s,i)=>{
      const {_key,...rest}=s;
      // the scene's first set is the scene's own location card when its heading names none
      const loc=i===0&&!rest.locationId&&opts.sceneLocation&&opts.sceneLocation.id ? opts.sceneLocation : null;
      return {...rest,id:"set"+(i+1),beats:rest.beats.slice().sort((a,b)=>a-b),
        ...(loc?{locationId:String(loc.id),locationName:text(loc.name)}:{})};
    });
  }
  // the sets a beat plays in (most beats: one)
  function beatSets(setList,beat){ return arr(setList).filter(s=>arr(s.beats).indexOf(Number(beat))>=0); }

  /* ---- THE BRIEF (free): the Writers' Room facts of the scene, in two or three lines -------- */
  function chargeMark(c){ const n=Number(c); return n>0?"+":n<0?"−":"0"; }
  function brief(scene,bm,names){
    scene=scene||{}; bm=bm||{}; names=names||{};
    const out=[];
    if(text(scene.summary)) out.push(text(scene.summary,400));
    const turn=[scene.openValue?text(scene.openValue)+" ("+chargeMark(scene.openCharge)+")":"",
      scene.closeValue?text(scene.closeValue)+" ("+chargeMark(scene.closeCharge)+")":""].filter(Boolean).join(" → ");
    if(turn) out.push("Turn: "+turn+(text(names.turn)?". "+text(names.turn,240):""));
    const driver=text(names.driver||bm.driverLabel), reactor=text(names.reactor||bm.reactorLabel);
    const who=[driver?(driver+(text(scene.objective)?" wants: "+text(scene.objective,200).replace(/\.$/,""):"")):"",
      reactor?(reactor+(text(bm.obstacle)?" stands in the way: "+text(bm.obstacle,200).replace(/\.$/,""):"")):""].filter(Boolean).join(". ");
    if(who) out.push(who+".");
    return out;
  }

  /* ---- NORMALISE A MODEL'S ANSWER ---------------------------------------------------
     ctx: {beats:[n…], moments:{n:k}, cast:[{id,name}], sets:[{id,beats}], props:[{id,name,aliases,ownerId}],
           lines:[{beat,text}] (the scene's spoken lines, word for word)} */
  function resolver(list,keys){
    const items=arr(list).filter(x=>x&&x.id);
    const count={};
    items.forEach(x=>uniq(norm(x.name).split(" ").filter(w=>w.length>=3)).forEach(w=>{ count[w]=(count[w]||0)+1; }));
    return token=>{
      const t=norm(token); if(!t) return null;
      return items.find(x=>norm(x.id)===t) || items.find(x=>norm(x.name)===t)
        || items.find(x=>arr(keys&&keys(x)).map(norm).indexOf(t)>=0)
        // a first name or a family name, when only one person carries it
        || items.find(x=>norm(x.name).split(" ").some(w=>w===t&&count[w]===1)) || null;
    };
  }
  function snapLine(said,lines,beat){
    let s=String(said==null?"":said).replace(/\s+/g," ").trim();
    if(!s) return "";
    s=s.replace(/^[A-Z][A-Z .'’()\-]{1,34}:\s*/,"").replace(/^["“]|["”]$/g,"").trim();
    const toks=t=>norm(t).split(" ").filter(w=>w.length>2);
    const mine=new Set(toks(s)); if(!mine.size) return "";
    const score=l=>{ const lt=toks(l.text); if(!lt.length) return 0;
      return lt.filter(w=>mine.has(w)).length/Math.max(lt.length,mine.size)+(Number(l.beat)===Number(beat)?0.05:0); };
    let best=null, top=0;
    arr(lines).forEach(l=>{ if(!l||!text(l.text)) return; const sc=score(l); if(sc>top){ top=sc; best=l; } });
    // never a paraphrase: a line the screenplay does not hold is not kept
    return best&&top>=0.35 ? text(best.text) : "";
  }
  /* A STATE, BY IDS (2026-11-22, after the first real plan: 12 of 14 "fix" rows were false alarms, because where a
     person stood and where a thing was were free text, compared word for word: "at the key hooks, facing Pike" against
     "hall by the key hooks"). A person's `where` is a MARK id; a thing's place is exactly one of heldBy (a character),
     at (a mark, or a fixed object or opening of the set), worn (a character) or in (another thing), with a free-text
     `state` beside it ("sealed", "on, heating"); a door is {id, open}. Free text is kept only where nothing is
     compared for a "fix": pose, state, note.
     R: {who, thing, mark(token)→id|"", spot(token)→mark or fixed id|"", door(token)→id|""} */
  const PLACE_KEYS=["heldBy","worn","in","at"];
  function truthy(v){ if(typeof v==="boolean") return v; const t=norm(v); return /^(open|opened|ajar|true|yes|1)$/.test(t) ? true : /^(shut|closed|locked|false|no|0)$/.test(t) ? false : null; }
  function normState(raw,R,report){
    const src=obj(raw), people={}, things={};
    const P=src.people;
    const each=(Array.isArray(P) ? P.map(x=>[x&&(x.id||x.name||x.who),x]) : Object.keys(obj(P)).map(k=>[k,P[k]]));
    each.forEach(([k,v])=>{
      const c=R.who(k); if(!c){ if(text(k)) report.people++; return; }
      const o=typeof v==="string" ? {where:v} : obj(v);
      const holding=[];
      arr(typeof o.holding==="string" ? [o.holding] : o.holding).forEach(h=>{
        const t=R.thing(h); if(t){ if(holding.indexOf(t.key)<0) holding.push(t.key); } else if(text(h)) report.untracked.push(text(h,60)); });
      const asked=text(o.where||o.at||o.mark), where=asked ? R.mark(asked) : "";
      if(asked&&!where) report.marks.push(text(asked,60));
      people[c.id]={where,pose:text(o.pose||o.posture,120),holding};
    });
    const T=src.things;
    (Array.isArray(T) ? T.map(x=>[x&&(x.key||x.name),x]) : Object.keys(obj(T)).map(k=>[k,T[k]])).forEach(([k,v])=>{
      const t=R.thing(k); if(!t){ if(text(k)) report.untracked.push(text(k,60)); return; }
      const o=typeof v==="string" ? {state:v} : obj(v);
      const out={};
      const holder=R.who(o.heldBy||o.holder), wearer=R.who(o.worn||o.wornBy), box=R.thing(o.in||o.inside), spot=text(o.at||o.on) ? R.spot(o.at||o.on) : "";
      if(holder) out.heldBy=holder.id;
      else if(wearer) out.worn=wearer.id;
      else if(box&&box.key!==t.key) out.in=box.key;
      else if(spot) out.at=spot;
      else if(text(o.heldBy||o.holder||o.worn||o.wornBy||o.in||o.inside||o.at||o.on)) report.places.push(t.name);
      const st=text(o.state||o.note,120); if(st) out.state=st;
      if(Object.keys(out).length) things[t.key]=out;
    });
    // what a person holds and where the thing is are one fact, said once each way
    Object.keys(people).forEach(id=>people[id].holding.forEach(k=>{ things[k]={heldBy:id,...(things[k]&&things[k].state?{state:things[k].state}:{})}; }));
    Object.keys(things).forEach(k=>{ const id=things[k].heldBy; if(id&&people[id]&&people[id].holding.indexOf(k)<0) people[id].holding.push(k); });
    const D=src.doors, doors=[];
    (Array.isArray(D) ? D.map(x=>typeof x==="string" ? [x,null] : [x&&(x.id||x.name||x.door),x&&(x.open!=null?x.open:x.state)]) : Object.keys(obj(D)).map(k=>[k,D[k]])).forEach(([k,v])=>{
      const id=text(k) ? R.door(k) : "", open=truthy(v);
      if(!id||open==null){ if(text(k)) report.doors.push(text(k,60)); return; }
      if(!doors.some(d=>d.id===id)) doors.push({id,open});
    });
    return {people,things,doors};
  }
  // a state copied whole (the saved shots never share one with the plan); a plan made before marks keeps its own shape
  const copyState=s=>{ const o=obj(s); return JSON.parse(JSON.stringify({people:obj(o.people),things:obj(o.things),doors:o.doors==null?[]:o.doors})); };
  const placeOfThing=v=>{ const o=obj(v), k=PLACE_KEYS.find(x=>o[x]); return k ? {kind:k,id:String(o[k])} : null; };

  function normalize(raw,ctx){
    ctx=ctx||{}; raw=obj(raw);
    const beats=uniq(arr(ctx.beats).map(Number).filter(n=>Number.isFinite(n)&&n>0)).sort((a,b)=>a-b);
    const inRange=n=>beats.indexOf(Number(n))>=0;
    const momentsOf=n=>Math.max(1,Math.round(Number(obj(ctx.moments)[n]))||1);
    const setList=arr(ctx.sets);
    const who=resolver(ctx.cast);
    const propOf=resolver(ctx.props,p=>p.aliases);
    const report={people:0,things:0,shots:0,untracked:[],merged:0,marks:[],places:[],doors:[]};
    // what stands in each set already (the floor plan's fixed objects and openings): a thing may be AT one, a door IS one
    const fixed=[]; arr(ctx.fixed).forEach(f=>{ const id=text(f&&f.id,64); if(id&&!fixed.some(x=>x.id===id)) fixed.push({id,name:text(f.name,80)||id,set:String(f.set||""),kind:f.kind==="opening"?"opening":"object"}); });
    const fixedOf=token=>{ const t=norm(token); if(!t) return null; return fixed.find(x=>norm(x.id)===t)||fixed.find(x=>norm(x.name)===t)||null; };
    // THE MARKS: the named standing places of each set, given by the plan; an id used everywhere a person or a thing is placed
    const marks=[], markIds=new Set();
    arr(raw.marks).slice(0,60).forEach((m,i)=>{
      m=obj(m);
      const set=setList.find(x=>x.id===String(m.set||""))||setList.find(x=>norm(x.heading)===norm(m.set)||norm(x.place)===norm(m.set))||(setList.length===1?setList[0]:null);
      let name=text(m.name||m.near,80); if(!name){ report.marks.push(text(m.id,60)||"mark "+(i+1)); return; }
      if(!/^(at|by|in|on|near|beside|behind|under|over|outside|inside|before|between|against|across|along|from|off|up|down|just|halfway|facing|opposite|next|through|within)\b/i.test(name)) name="at "+name;
      let id=slug(m.id||name)||"mark-"+(i+1);
      if(fixed.some(x=>norm(x.id)===norm(id))) id="m-"+id;
      if(markIds.has(id)){ let n=2; while(markIds.has(id+"-"+n)) n++; id=id+"-"+n; }
      markIds.add(id);
      const xy=(set&&set.hasPlan&&Array.isArray(m.xy)&&m.xy.length===2&&m.xy.every(n=>typeof n==="number"&&Number.isFinite(n)&&Math.abs(n)<=500)) ? [Math.round(m.xy[0]*100)/100,Math.round(m.xy[1]*100)/100] : null;
      marks.push({id,set:set?set.id:"",name,near:text(m.near,120),...(xy?{xy}:{}),_raw:norm(m.id)});
    });
    const markOf=token=>{ const t=norm(token); if(!t) return ""; const m=marks.find(x=>x.id===slug(token))||marks.find(x=>x._raw&&x._raw===t)||marks.find(x=>norm(x.name)===t||norm(x.name).replace(/^(at|by|in|on) /,"")===t); return m?m.id:""; };

    // the things tracker
    const things=[], seenKey=new Set();
    arr(raw.things).slice(0,60).forEach(t=>{
      t=obj(t);
      const name=text(t.name,80); if(!name){ report.things++; return; }
      let key=slug(t.key||name)||slug(name); if(!key){ report.things++; return; }
      if(seenKey.has(key)){ let i=2; while(seenKey.has(key+"-"+i)) i++; key=key+"-"+i; }
      seenKey.add(key);
      const kind=KINDS.indexOf(String(t.kind||"").toLowerCase())>=0 ? String(t.kind).toLowerCase() : "prop";
      const carrier=who(t.carriedBy||t.carrier||t.owner);
      const card=t.propId ? arr(ctx.props).find(p=>p&&String(p.id)===String(t.propId)) : null;
      const seenBeat=new Set();
      const tb=arr(t.beats).map(b=>typeof b==="number"?{n:b,state:""}:obj(b))
        .map(b=>({n:Number(b.n!=null?b.n:b.beat),state:text(b.state,160)}))
        .filter(b=>inRange(b.n)&&!seenBeat.has(b.n)&&seenBeat.add(b.n)).sort((a,b)=>a.n-b.n);
      things.push({key,name,kind,carriedBy:carrier?carrier.id:"",propId:card?String(card.id):"",beats:tb,why:text(t.why||t.note,220),_raw:norm(t.key)});
    });
    things.forEach(t=>{ if(!t.propId&&t.kind==="prop"){ const m=thingProp(t,ctx.props); if(m) t.propId=String(m.id); } });
    const thing=token=>{ const t=norm(token); if(!t) return null;
      return things.find(x=>x.key===slug(token)) || things.find(x=>x._raw&&x._raw===t) || things.find(x=>norm(x.name)===t) || null; };

    const doorOf=token=>{ const f=fixedOf(token); if(f) return f.id; const t=thing(token); return t&&t.kind==="set" ? t.key : ""; };
    // where a thing is AT: a fixed object's own id first (the app gave it), then a mark, then a fixed object by its name
    const spotOf=token=>{ const f=fixed.find(x=>norm(x.id)===norm(token)); return f ? f.id : (markOf(token)||((fixedOf(token)||{}).id||"")); };
    const R={who,thing,mark:markOf,spot:spotOf,door:doorOf};
    // blocking, one row a beat
    const blocking=[], seenBlock=new Set();
    arr(raw.blocking).forEach(b=>{
      b=obj(b); const n=Number(b.beat);
      if(!inRange(n)||seenBlock.has(n)) return;
      seenBlock.add(n);
      const people=[];
      arr(b.people).forEach(p=>{ p=obj(p); const c=who(p.id||p.name);
        if(!c){ report.people++; return; }
        const asked=text(p.where||p.at||p.mark), where=asked ? markOf(asked) : "";
        if(asked&&!where) report.marks.push(text(asked,60));
        if(!people.some(x=>x.id===c.id)) people.push({id:c.id,where,facing:text(p.facing,120),...(text(p.pose||p.note)?{pose:text(p.pose||p.note,120)}:{})}); });
      blocking.push({beat:n,people,note:text(b.note,240)});
    });
    blocking.sort((a,b)=>a.beat-b.beat);

    const L=obj(raw.line);
    const line={axis:text(L.axis,200),cameraSide:text(L.cameraSide||L.side,160),note:text(L.note,240)};

    // the shots: one per screenplay moment
    const byBeat={};
    arr(raw.shots).forEach((s,i)=>{
      s=obj(s); const n=Number(s.beat);
      if(!inRange(n)){ report.shots++; return; }
      const rep={people:0,untracked:[],marks:report.marks,places:report.places,doors:report.doors};
      const setsHere=beatSets(setList,n);
      const set=setList.find(x=>x.id===String(s.set||"")) || setList.find(x=>norm(x.heading)===norm(s.set)||norm(x.place)===norm(s.set)) || null;
      const subjects=[]; arr(s.subjects).forEach(t=>{ const c=who(t); if(c){ if(subjects.indexOf(c.id)<0) subjects.push(c.id); } else if(text(t)) report.people++; });
      const props=[]; arr(s.props).forEach(t=>{ const x=thing(t); if(x){ if(props.indexOf(x.key)<0) props.push(x.key); } else if(text(t)) rep.untracked.push(text(t,60)); });
      const start=normState(s.start,R,rep), end=normState(s.end,R,rep);
      report.people+=rep.people;
      const side=norm(s.cameraSide||s.lineSide);
      const H=obj(s.handoff);
      (byBeat[n]=byBeat[n]||[]).push({i,beat:n,moment:Math.round(Number(s.moment))||0,
        purpose:text(s.purpose,160),size:sizeId(s.size)||"MS",angle:angleId(s.angle)||"eye",lens:lensId(s.lens)||"50",move:moveId(s.move||s.movement)||"static",
        cameraPosition:text(s.cameraPosition||s.camera,240),composition:text(s.composition,240),
        set:set?set.id:(setsHere[0]?setsHere[0].id:(setList[0]?setList[0].id:"")),setGiven:!!set,
        subjects,props,untracked:uniq(rep.untracked),action:text(s.action,300),dialogue:snapLine(s.dialogue,ctx.lines,n),
        start,end,handoff:{type:handoffType(typeof s.handoff==="string"?s.handoff:H.type),note:text(H.note,200)},
        cameraSide:/\b(other|cross\w*|opposite)\b/.test(side)?"other":/\b(on line|on the line|neutral)\b/.test(side)?"on-line":"same",
        crossNote:text(s.crossNote||s.lineNote,200)});
    });
    const shots=[], missingBeats=[], filled=[];
    let prev=null;
    beats.forEach(n=>{
      const k=momentsOf(n), mine=(byBeat[n]||[]).slice().sort((a,b)=>a.i-b.i);
      if(!mine.length) missingBeats.push(n);
      const slots=[]; for(let m=1;m<=k;m++) slots.push([]);
      const loose=[];
      mine.forEach(s=>{ if(s.moment>=1&&s.moment<=k) slots[s.moment-1].push(s); else if(s.moment>k) slots[k-1].push(s); else loose.push(s); });
      // shots that name no moment take the empty moments in order; what is left joins the last moment
      slots.forEach(slot=>{ if(!slot.length&&loose.length) slot.push(loose.shift()); });
      loose.forEach(s=>slots[k-1].push(s));
      slots.forEach((slot,ix)=>{
        const m=ix+1;
        let sh;
        if(slot.length){
          slot.sort((a,b)=>a.i-b.i);
          const first=slot[0], last=slot[slot.length-1];
          // several shots for one moment: the moment keeps the first one's camera and ends where the last one ends
          if(slot.length>1) report.merged+=slot.length-1;
          const {i,setGiven,...rest}=first;
          sh={...rest,moment:m,of:k,end:last.end,handoff:last.handoff,
            props:uniq(slot.flatMap(x=>x.props)),untracked:uniq(slot.flatMap(x=>x.untracked))};
        }else{
          const carry=prev ? copyState(prev.end) : {people:{},things:{},doors:[]};
          const setsHere=beatSets(setList,n);
          // in another set nobody stands on the last set's marks (what they hold, they still hold)
          if(prev&&setsHere[0]&&prev.set&&setsHere[0].id!==prev.set&&!(prev.beat===n)) Object.keys(carry.people).forEach(id=>{ carry.people[id].where=""; });
          sh={beat:n,moment:m,of:k,purpose:"",size:"MS",angle:"eye",lens:"50",move:"static",cameraPosition:"",composition:"",
            set:(prev&&prev.beat===n?prev.set:"")||(setsHere[0]?setsHere[0].id:(setList[0]?setList[0].id:"")),
            subjects:[],props:[],untracked:[],action:"",dialogue:"",start:carry,end:copyState(carry),
            handoff:{type:"cut",note:""},cameraSide:"same",crossNote:"",filled:true};
          filled.push({beat:n,moment:m});
        }
        shots.push(sh); prev=sh;
      });
    });
    things.forEach(t=>{ delete t._raw; }); marks.forEach(m=>{ delete m._raw; });
    return {plan:{v:2,marks,fixed,blocking,line,things,cameraIdea:text(raw.cameraIdea||raw.camera,600),shots},
      missingBeats,filled,dropped:{people:report.people,things:report.things,shots:report.shots,merged:report.merged,
        marks:uniq(report.marks),places:uniq(report.places),doors:uniq(report.doors)}};
  }

  /* ---- THE PLAN'S SHOTS AS THE SHOT DRAFT'S ROWS ------------------------------------
     A beat's first shot is the beat's opening shot; its later shots are the beat's moments, in order (the same
     momentSpecs the shot draft writes, so beatMomentShots makes or refreshes their cards). */
  function shotRows(plan,opts){
    opts=opts||{};
    const missing=new Set(arr(opts.missingBeats).map(Number));
    const byBeat={};
    arr(plan&&plan.shots).forEach(s=>{ (byBeat[s.beat]=byBeat[s.beat]||[]).push(s); });
    const comp=s=>text([s.composition,s.cameraPosition&&!s.composition?("Camera: "+s.cameraPosition):""].filter(Boolean).join(" "),240);
    return Object.keys(byBeat).map(Number).sort((a,b)=>a-b).map(n=>{
      const list=byBeat[n].slice().sort((a,b)=>a.moment-b.moment), first=list[0];
      const set=arr(opts.sets).find(x=>x&&x.id===first.set);
      return {beat:n,...(set&&set.locationId?{locationId:set.locationId}:{}),fromModel:!missing.has(n),size:first.size,angle:first.angle,move:first.move,lens:first.lens,
        composition:comp(first),purpose:first.purpose,subjects:first.subjects.slice(),props:[],action:first.action,dialogue:first.dialogue,
        locationSide:"AUTO",covers:[],priority:true,planned:true,cameraPosition:first.cameraPosition,
        startState:copyState(first.start),endState:copyState(first.end),handoff:{type:first.handoff.type,note:first.handoff.note},
        momentSpecs:list.slice(1).map(s=>({moment:s.moment,size:s.size,angle:s.angle,move:s.move,lens:s.lens,composition:comp(s),purpose:s.purpose}))};
    });
  }

  /* ---- THE STATES ON THE SCENE'S SAVED SHOTS ----------------------------------------
     Each saved opening or moment shot takes the plan shot of its beat and moment. A beat kept as one shot (joined by
     hand) starts where its first moment starts and ends where its last one ends.
     opts: {sets, propIdOf(thingKey)→prop id or "", propKind(id)} → {shots, patched} */
  function isKeyShot(sh){ return !!sh&&(sh.keyframeMode==="beat-opening"||sh.keyframeMode==="moment"); }
  function momentOf(sh){ const n=Number(sh&&sh.moment&&sh.moment.n); return Number.isFinite(n)&&n>0 ? n : 1; }
  function applyToShots(sceneShots,plan,opts){
    opts=opts||{};
    const setList=arr(opts.sets), propIdOf=typeof opts.propIdOf==="function"?opts.propIdOf:()=>"";
    const planShots=arr(plan&&plan.shots);
    let patched=0;
    const list=arr(sceneShots);
    const out=list.map(sh=>{
      if(!isKeyShot(sh)) return sh;
      const beat=Number(sh.beatN), m=momentOf(sh);
      const inBeat=planShots.filter(p=>Number(p.beat)===beat).sort((a,b)=>a.moment-b.moment);
      if(!inBeat.length) return sh;
      const saved=list.filter(x=>isKeyShot(x)&&Number(x.beatN)===beat).map(momentOf).sort((a,b)=>a-b);
      const nextSaved=saved.find(x=>x>m);
      const mine=inBeat.filter(p=>p.moment>=m&&(nextSaved==null||p.moment<nextSaved));
      const first=mine[0]||inBeat.find(p=>p.moment===m); if(!first) return sh;
      const last=mine[mine.length-1]||first;
      const set=setList.find(s=>s.id===first.set)||null;
      const keys=uniq(mine.flatMap(p=>arr(p.props)));
      const planProps=uniq(keys.map(propIdOf).filter(Boolean)).filter(id=>typeof opts.propKind!=="function"||opts.propKind(id)!=="worn");
      const was=arr(sh.planPropIds);
      const refs=uniq(arr(sh.referencePropIds).filter(id=>was.indexOf(id)<0).concat(planProps));
      patched++;
      const next={...sh,planned:true,cameraPosition:first.cameraPosition||"",startState:copyState(first.start),endState:copyState(last.end),
        handoff:{type:last.handoff&&last.handoff.type||"cut",note:last.handoff&&last.handoff.note||""},
        planSet:first.set||"",planThings:keys,planUntracked:uniq(mine.flatMap(p=>arr(p.untracked))),
        lineSide:mine.some(p=>p.cameraSide==="other")?"other":first.cameraSide||"same",lineNote:(mine.find(p=>p.crossNote)||{}).crossNote||"",
        planPropIds:planProps};
      if(first.purpose) next.purpose=first.purpose;
      if(first.filled) next.planFilled=true; else delete next.planFilled;
      /* WHO IS IN FRAME is the plan's own answer for this shot (2026-11-22: the street wide listed four people, the
         insert of the empty key hook listed Pike), never the beat's whole cast. An empty list is an answer too: an
         insert, an empty street. A shot the plan did not write (a plain one put in its place) keeps the screenplay's. */
      if(first.filled){ delete next.subjectsByPlan; }
      else{ const who=arr(first.subjects).slice();
        next.subjects=who; next.subjectsByPlan=true; next.referenceCharactersSet=true; next.referenceCharactersAuto=true; next.referenceCharacterIds=who.slice(); }
      if(set&&set.locationId) next.locationId=set.locationId;
      if(refs.length||Array.isArray(sh.referencePropIds)) next.referencePropIds=refs;
      if(planProps.length) next.props=uniq(arr(sh.props).concat(planProps));
      return next;
    });
    return {shots:out,patched};
  }
  // a shot drafted again without a plan no longer says how it starts and ends (the old words would be about another shot)
  const PLAN_FIELDS=["planned","cameraPosition","startState","endState","handoff","planSet","planThings","planUntracked","lineSide","lineNote","planFilled","planPropIds","subjectsByPlan"];
  function unplan(sh){
    if(!sh||!sh.planned) return sh;
    const next={...sh}; PLAN_FIELDS.forEach(k=>{ delete next[k]; });
    return next;
  }
  // a card was made for a tracked thing: the planned shots that show the thing take its sheet
  function linkPropToShots(sceneShots,thingKey,propId){
    let linked=0;
    const shots=arr(sceneShots).map(sh=>{
      if(!sh||!sh.planned||arr(sh.planThings).indexOf(thingKey)<0||!propId) return sh;
      if(arr(sh.referencePropIds).indexOf(propId)>=0&&arr(sh.planPropIds).indexOf(propId)>=0) return sh;
      linked++;
      return {...sh,referencePropIds:uniq(arr(sh.referencePropIds).concat([propId])),planPropIds:uniq(arr(sh.planPropIds).concat([propId]))};
    });
    return {shots,linked};
  }

  /* ---- A STATE IN WORDS --------------------------------------------------------------
     Marks, fixed objects, people and things are named, never shown as ids.
     names: {char(id), thing(key), mark(id), fixed(id)}; namesOf(plan, cast) makes them from a saved plan */
  function namesOf(plan,cast){
    const P=obj(plan), people=arr(cast);
    const find=(list,key,id)=>arr(list).find(x=>x&&String(x[key])===String(id));
    return {char:id=>text((find(people,"id",id)||{}).name),thing:k=>text((find(P.things,"key",k)||{}).name),
      mark:id=>text((find(P.marks,"id",id)||{}).name),fixed:id=>text((find(P.fixed,"id",id)||{}).name)};
  }
  const theName=n=>/^(the|a|an|his|her|their|my|your|our)\b/i.test(n)||/[’']s$/.test(String(n).split(" ")[0]||"") ? n : "the "+n;
  function wordsFor(names){
    names=names||{};
    const ask=(f,id)=>text(typeof names[f]==="function"&&names[f](id));
    const cn=id=>ask("char",id)||String(id);
    const tn=k=>ask("thing",k)||String(k).replace(/-/g," ");
    // where a mark id stands for a place: its name ("by the hall shelf"); a fixed object: "at the kettle"; a plan made
    // before marks has the words themselves there
    // a fixed object's name as it reads in a sentence ("Front door" → "the front door"; "Liaqat's chair" stays)
    const plain=n=>{ const t=text(n); return /^[A-Z][a-z]/.test(t)&&!/^\S+[’']s\b/.test(t) ? t.charAt(0).toLowerCase()+t.slice(1) : t; };
    const spot=id=>{ const m=ask("mark",id); if(m) return m; const f=ask("fixed",id); return f ? "at "+theName(plain(f)) : String(id||""); };
    const place=v=>{ const p=placeOfThing(v); if(!p) return "";
      return p.kind==="heldBy" ? "in "+cn(p.id)+"’s hand" : p.kind==="worn" ? "worn by "+cn(p.id) : p.kind==="in" ? "in "+theName(tn(p.id)) : spot(p.id); };
    const door=d=>theName(plain(ask("fixed",d.id)||tn(d.id)))+" "+(d.open?"open":"shut");
    return {cn,tn,spot,place,door};
  }
  function stateText(state,names){
    const W=wordsFor(names), s=obj(state), parts=[];
    Object.keys(obj(s.people)).forEach(id=>{
      const p=obj(s.people[id]);
      const bits=[p.where?W.spot(p.where):"",p.pose,arr(p.holding).length?"holding "+arr(p.holding).map(k=>theName(W.tn(k))).join(" and "):""].filter(Boolean);
      parts.push(W.cn(id)+(bits.length?" "+bits.join(", "):""));
    });
    Object.keys(obj(s.things)).forEach(k=>{
      const v=s.things[k];
      if(typeof v==="string"){ parts.push(W.tn(k).replace(/^\w/,c=>c.toUpperCase())+": "+v); return; }
      if(obj(v).heldBy&&obj(s.people)[v.heldBy]&&!v.state) return;   // said with the person who holds it
      const line=[W.place(v),text(obj(v).state)].filter(Boolean).join(", ");
      if(line) parts.push(W.tn(k).replace(/^\w/,c=>c.toUpperCase())+": "+line);
    });
    if(Array.isArray(s.doors)){ if(s.doors.length) parts.push("Doors: "+s.doors.map(W.door).join(", ")); }
    else if(text(s.doors)) parts.push("Doors: "+text(s.doors));
    return parts.map(x=>x.replace(/\.$/,"")).join(". ")+(parts.length?".":"");
  }
  function handoffText(h){
    const t=h&&h.type||"cut", note=text(h&&h.note);
    const lab=t==="time-cut"?"Time cut":t==="match"?"Match cut":"Cut";
    return lab+(note?": "+note:"");
  }

  /* ---- THE CHECKS (free) ----------------------------------------------------------------
     shots: the scene's saved shots (startState / endState …) or the plan's own (start / end …), in any order.
     ctx: {beats:[n…], sets, cast:[{id,name}], props:[cards]} → [{level:"fix"|"note", kind, shot, beat, text}] */
  function view(sh,i){
    const saved=sh&&(sh.beatN!=null||sh.startState||sh.endState);
    return {ref:sh&&sh.id!=null?sh.id:i,beat:Number(saved?sh.beatN:sh.beat),moment:saved?momentOf(sh):Number(sh.moment)||1,order:Number(sh&&sh.order)||0,
      start:obj(saved?sh.startState:sh.start),end:obj(saved?sh.endState:sh.end),handoff:obj(sh.handoff),
      set:String((saved?sh.planSet:sh.set)||""),locationId:String(sh.locationId||""),subjects:arr(sh.subjects),
      things:arr(saved?sh.planThings:sh.props),untracked:arr(saved?sh.planUntracked:sh.untracked),
      cameraSide:(saved?sh.lineSide:sh.cameraSide)||"same",crossNote:text(saved?sh.lineNote:sh.crossNote),filled:!!(saved?sh.planFilled:sh.filled)};
  }
  // a plan made before marks: where a thing is, from its free text
  function placeOf(state,key,cn){
    const people=obj(state.people);
    const holder=Object.keys(people).find(id=>arr(people[id].holding).indexOf(key)>=0);
    if(holder) return {holder,text:"in "+cn(holder)+"’s hand"};
    const s=text(obj(state.things)[key]);
    return s ? {holder:"",text:s} : null;
  }
  // has this plan marks? (an older one compares free text, and its rows are notes, never a "fix")
  function exact(plan){ return !!(plan&&Array.isArray(plan.marks)&&plan.marks.length); }
  const OLD_PLAN_NOTE="This plan was made before marks, so how its shots join up is compared by their words and may be wrong. Plan again to get exact checks.";
  function checks(plan,shots,ctx){
    ctx=ctx||{}; plan=obj(plan);
    const out=[];
    const setList=arr(ctx.sets), cast=arr(ctx.cast), things=arr(plan.things);
    const byId=exact(plan);
    const W=wordsFor(namesOf(plan,cast)), cn=W.cn, tn=W.tn;
    const the=theName;
    // every opening and moment shot of the scene, in order (their numbers are the cards' order); the ones the plan
    // wrote carry states, a shot drafted after the plan does not
    const all=arr(shots).filter(sh=>sh&&(sh.beatN==null||isKeyShot(sh))).map((sh,i)=>({...view(sh,i),planned:!!(sh.planned||sh.start||sh.startState)}))
      .filter(v=>Number.isFinite(v.beat)).sort((a,b)=>a.beat-b.beat||a.moment-b.moment||a.order-b.order);
    const list=all.filter(v=>v.planned);
    const no=v=>all.indexOf(v)+1;
    const add=(level,kind,v,msg,beat)=>out.push({level,kind,shot:v?v.ref:null,beat:beat!=null?beat:(v?v.beat:null),text:msg});

    // every beat has a shot; a moment the plan left out says so
    arr(ctx.beats).map(Number).forEach(n=>{ if(!all.some(v=>v.beat===n)) add("fix","beat",null,"Beat "+n+" has no shot.",n); });
    all.forEach(v=>{ if(!v.planned) add("note","beat",v,"Shot "+no(v)+" (beat "+v.beat+") was drafted after this plan, so how it starts and ends is not checked. Plan again to include it."); });
    list.forEach(v=>{ if(v.filled) add("fix","beat",v,"Shot "+no(v)+" (beat "+v.beat+(v.moment>1?", moment "+v.moment:"")+") was not planned: it is a plain shot that keeps the shot before it. Plan again, or set it by hand."); });

    // a shot ends where the next one starts, across beats too
    let compared=0;
    for(let i=0;i<all.length-1;i++){
      const a=all[i], b=all[i+1], A=no(a), B=no(b);
      if(!a.planned||!b.planned) continue;
      if((a.handoff.type||"cut")==="time-cut"){
        if(!text(a.handoff.note)) add("fix","handoff",a,"Shot "+A+" ends on a time cut that does not say what changed.");
        continue;
      }
      compared++;
      if(byId){
        // BY IDS: another mark, another holder or place, a door the other way is a fix; a change of words only is a note
        Object.keys(obj(a.end.people)).forEach(id=>{
          const pa=obj(a.end.people[id]), pb=obj(b.start.people)[id];
          if(!pb||!pa.where||!pb.where||pa.where===pb.where) return;
          add("fix","continuity",b,"Shot "+A+" ends with "+cn(id)+" "+W.spot(pa.where)+"; shot "+B+" starts with "+cn(id)+" "+W.spot(pb.where)+".");
        });
        Object.keys(obj(a.end.things)).forEach(k=>{
          const va=obj(a.end.things[k]), vb=obj(b.start.things)[k]; if(!vb) return;
          const pa=placeOfThing(va), pb=placeOfThing(vb);
          if(pa&&pb&&(pa.kind!==pb.kind||pa.id!==pb.id)){
            add("fix","continuity",b,"Shot "+A+" ends with "+the(tn(k))+" "+W.place(va)+"; shot "+B+" starts with it "+W.place(vb)+"."); return; }
          if(text(va.state)&&text(obj(vb).state)&&!sameText(va.state,vb.state))
            add("note","continuity",b,"Shot "+A+" ends with "+the(tn(k))+" "+text(va.state)+"; shot "+B+" starts with it "+text(vb.state)+".");
        });
        arr(a.end.doors).forEach(d=>{
          const e=arr(b.start.doors).find(x=>x&&x.id===d.id);
          if(e&&!!e.open!==!!d.open) add("fix","continuity",b,"Shot "+A+" ends with "+W.door(d)+"; shot "+B+" starts with it "+(e.open?"open":"shut")+".");
        });
        continue;
      }
      // a plan made before marks: the words are compared, and what differs is a note
      uniq(a.things.concat(b.things,Object.keys(obj(a.end.things)),Object.keys(obj(b.start.things)),
        Object.keys(obj(a.end.people)).flatMap(id=>arr(a.end.people[id].holding)),Object.keys(obj(b.start.people)).flatMap(id=>arr(b.start.people[id].holding)))).forEach(k=>{
        const pa=placeOf(a.end,k,cn), pb=placeOf(b.start,k,cn);
        if(!pa||!pb) return;
        const same=pa.holder||pb.holder ? pa.holder===pb.holder : sameText(pa.text,pb.text);
        if(!same) add("note","continuity",b,"Shot "+A+" ends with "+the(tn(k))+" "+pa.text+"; shot "+B+" starts with it "+pb.text+".");
      });
      Object.keys(obj(a.end.people)).forEach(id=>{
        const pa=a.end.people[id], pb=obj(b.start.people)[id];
        if(!pb||!text(pa.where)||!text(pb.where)||sameText(pa.where,pb.where)) return;
        add("note","continuity",b,"Shot "+A+" ends with "+cn(id)+" "+text(pa.where)+"; shot "+B+" starts with "+cn(id)+" "+text(pb.where)+".");
      });
      if(typeof a.end.doors==="string"&&typeof b.start.doors==="string"&&text(a.end.doors)&&text(b.start.doors)&&!sameText(a.end.doors,b.start.doors))
        add("note","continuity",b,"Shot "+A+" ends with the doors like this: "+text(a.end.doors)+". Shot "+B+" starts with: "+text(b.start.doors)+".");
    }
    if(!byId&&compared&&out.some(c=>c.kind==="continuity")) out.unshift({level:"note",kind:"old-plan",shot:null,beat:null,text:OLD_PLAN_NOTE});

    // the right set for each shot
    const noCard=new Set();
    list.forEach(v=>{
      const set=setList.find(s=>s.id===v.set)||null, here=beatSets(setList,v.beat);
      if(!setList.length) return;
      if(!set){ add("fix","set",v,"Shot "+no(v)+" names no set of this scene."); return; }
      if(here.length&&here.indexOf(set)<0)
        add("fix","set",v,"Shot "+no(v)+" is set at "+set.heading+", but beat "+v.beat+" plays at "+here.map(s=>s.heading).join(" and ")+".");
      const other=setList.find(s=>s!==set&&s.locationId&&s.locationId===v.locationId&&s.locationId!==set.locationId);
      if(other&&set.side!==other.side)
        add("fix","set",v,"Shot "+no(v)+" plays at "+set.heading+", but it points at the location card of "+other.heading+": another location.");
      if(!set.locationId&&!noCard.has(set.id)){ noCard.add(set.id); add("note","set",v,set.heading+" has no location card yet, so its shots have no location image to follow."); }
    });

    // a person the plan put in a place that is not one of its marks stands nowhere: said, so it is not a silent gap
    if(byId) list.forEach(v=>{
      if(v.filled) return;
      const lost=uniq([v.start,v.end].flatMap(st=>Object.keys(obj(st.people)).filter(id=>!obj(st.people[id]).where)));
      if(lost.length) add("note","marks",v,"Shot "+no(v)+" does not say which mark "+lost.map(cn).join(" and ")+" "+(lost.length===1?"is":"are")+" on.");
    });
    // a person stands on a mark of the shot's own set
    if(byId) list.forEach(v=>{
      const set=setList.find(x=>x.id===v.set); if(!set) return;
      const seen=new Set();
      [v.start,v.end].forEach(st=>Object.keys(obj(st.people)).forEach(id=>{
        const m=arr(plan.marks).find(x=>x.id===obj(st.people[id]).where);
        if(!m||!m.set||m.set===set.id||seen.has(id+m.id)) return;
        seen.add(id+m.id);
        const other=setList.find(x=>x.id===m.set);
        add("fix","set",v,"Shot "+no(v)+" is set at "+set.heading+", but it puts "+cn(id)+" "+m.name+(other?", a mark of "+other.heading:"")+".");
      }));
    });

    // only people in frame are listed, and each one is placed
    list.forEach(v=>{
      const row=arr(plan.blocking).find(b=>Number(b.beat)===v.beat);
      const placed=new Set(arr(row&&row.people).map(p=>p.id));
      v.subjects.forEach(id=>{ if(!placed.has(id)) add("fix","people",v,"Shot "+no(v)+" shows "+cn(id)+", but the blocking for beat "+v.beat+" does not place "+cn(id)+"."); });
      const seen=new Set();
      [v.start,v.end].forEach(st=>Object.keys(obj(st.people)).forEach(id=>{
        const held=arr(st.people[id].holding);
        if(!held.length||v.subjects.indexOf(id)>=0||seen.has(id)) return;
        seen.add(id);
        add("fix","people",v,"Shot "+no(v)+" has "+cn(id)+" holding "+held.map(k=>the(tn(k))).join(" and ")+", but "+cn(id)+" is not listed in frame.");
      }));
    });

    // the line
    list.forEach(v=>{ if(v.cameraSide==="other"&&!v.crossNote) add("fix","line",v,"Shot "+no(v)+" crosses the line and does not say why."); });

    // every thing a shot shows is tracked, and every tracked prop has a card
    list.forEach(v=>{ uniq(v.untracked).forEach(name=>add("fix","things",v,"Shot "+no(v)+" shows "+the(name)+", which is not in the things tracker.")); });
    const noProp=things.filter(t=>t.kind==="prop"&&!thingProp(t,ctx.props));
    if(noProp.length) add("fix","props",null,noProp.length+" thing"+(noProp.length===1?"":"s")+" in this scene "+(noProp.length===1?"has":"have")+" no prop card: "+noProp.map(t=>t.name).join(", ")+".");
    return out;
  }

  /* ---- THINGS → PROPS --------------------------------------------------------------- */
  const bare=v=>norm(v).replace(/^(the|a|an) /,"");
  // the card a tracked thing already is: by its id, else by a careful match of names
  function thingProp(thing,props){
    const list=arr(props).filter(p=>p&&p.id);
    if(!thing) return null;
    if(thing.propId){ const p=list.find(x=>String(x.id)===String(thing.propId)); if(p) return p; }
    const name=bare(thing.name); if(!name) return null;
    const namesOf=p=>[p.name].concat(arr(p.aliases)).map(bare).filter(Boolean);
    const exact=list.find(p=>namesOf(p).indexOf(name)>=0);
    if(exact) return exact;
    const sig=v=>uniq(words(v).filter(w=>w.length>=3&&!/^\d+$/.test(w)));
    const mine=sig(name); if(!mine.length) return null;
    const hits=list.filter(p=>namesOf(p).some(n=>{ const theirs=sig(n); if(!theirs.length) return false;
      const shared=mine.filter(w=>theirs.indexOf(w)>=0).length;
      // two words or more in common, and the shorter name wholly inside the longer
      if(shared>=2&&(shared===mine.length||shared===theirs.length)) return true;
      // one word ("mug"): only the card of the person who carries it
      return mine.length===1&&shared===1&&!!thing.carriedBy&&p.ownerId===thing.carriedBy&&theirs[theirs.length-1]===mine[0]; }));
    return hits.length===1 ? hits[0] : null;
  }
  // a tracked thing as a new prop card: an ordinary card, kept, in its scene, carried by its character
  function thingCard(thing,scene,owner,opts){
    opts=opts||{};
    const name=text(thing&&thing.name,80).replace(/^\w/,c=>c.toUpperCase());
    if(!name||!scene) return null;
    const stamp=opts.stamp||Date.now().toString(36);
    const states=arr(thing.beats).filter(b=>b&&b.state).map(b=>"Beat "+b.n+": "+b.state);
    const detail=text([thing.why,states.length?("In scene "+(scene.no!=null?scene.no:"")+": "+states.join("; ")):""].filter(Boolean).join(" ").replace(/\s+\./g,"."),600);
    return {id:"prop-plan-"+(slug(name)||"thing")+"-"+stamp,name,kind:"carried",kindSet:true,
      ownerId:owner?String(owner.id):"",ownerName:owner?text(owner.name):"",
      form:"",material:"",detail,renderStyle:"",negativePrompt:"",scenes:[scene.id],
      origin:{kind:"scene-plan",sceneId:scene.id,sceneNo:scene.no!=null?scene.no:"",thingKey:thing.key||"",
        characterId:owner?String(owner.id):"",characterName:owner?text(owner.name):""},
      keptAsProp:true,proposalAccepted:true,proposalAcceptedAt:opts.now||new Date().toISOString(),inventoryGroup:"story"};
  }
  // "From the scene plan · Sc 05"
  function originLabel(prop){
    const o=prop&&prop.origin&&typeof prop.origin==="object"?prop.origin:null;
    if(!o||o.kind!=="scene-plan") return "";
    return "From the scene plan"+(o.sceneNo!==""&&o.sceneNo!=null?" · Sc "+String(o.sceneNo).padStart(2,"0"):"");
  }
  /* the character's carried list with the item in it (the same list the character card's Props & accessories reads:
     an item there that names a card is tied to that card). opts: {split, join}; null when it is already there. */
  function ownerItems(listText,name,opts){
    opts=opts||{};
    // as the app's own list rule: a semicolon or a new line separates items when there is one, and then a comma stays inside an item
    const split=typeof opts.split==="function"?opts.split:(v=>{ const t=String(v||""); return t.split(/[;\n]/.test(t)?/\s*[;\n]\s*/:/\s*,\s*/).map(x=>x.trim()).filter(Boolean); });
    const join=typeof opts.join==="function"?opts.join:(a=>a.join(a.some(x=>x.indexOf(",")>=0)?"; ":", "));
    const items=split(listText).filter(x=>!/^(none|n\/?a|nothing)$/i.test(String(x).trim()));
    const want=slug(name);
    if(!want||items.some(x=>slug(x)===want)) return null;
    return join(items.concat([text(name)]));
  }

  /* ---- WORDS THE APP SAYS -------------------------------------------------------------- */
  // how long the writing pass usually takes: it grows with the beats
  /* THE SHOTS ARE WRITTEN A FEW BEATS AT A TIME (2026-11-22): whole beats while a group stays within `max` moments; a
     beat longer than that is cut into runs of `max`. Each group is one short writing call. A unit is {n, from, to}:
     a beat and its moments, counted from 0. */
  const SHOT_GROUP_MOMENTS=6;
  function shotGroups(beatNos,momentCount,max){
    max=Math.max(1,Math.round(Number(max))||SHOT_GROUP_MOMENTS);
    const out=[]; let cur=[],n=0;
    const flush=()=>{ if(cur.length){ out.push(cur); cur=[]; n=0; } };
    (Array.isArray(beatNos)?beatNos:[]).forEach(b=>{
      const c=Math.max(1,Math.round(Number((momentCount||{})[b]))||1);
      if(c>max){ flush(); for(let f=0;f<c;f+=max) out.push([{n:b,from:f,to:Math.min(c,f+max)-1,part:true}]); return; }
      if(n+c>max) flush();
      cur.push({n:b,from:0,to:c-1}); n+=c;
    });
    flush(); return out;
  }
  // "beat 3", "beats 1 and 2", "beats 1 to 3", "beat 4, moments 7 to 12"
  function groupLabel(units){
    units=Array.isArray(units)?units:[];
    if(!units.length) return "";
    if(units.length===1){ const u=units[0]; return "beat "+u.n+(u.part ? ", moments "+(u.from+1)+" to "+(u.to+1) : ""); }
    const a=units[0].n,z=units[units.length-1].n;
    return units.length===2 ? "beats "+a+" and "+z : "beats "+a+" to "+z;
  }
  /* how long a plan takes, for the progress line: the staging, then each group of shots. Before the groups are known
     (calls not given), about one group for every two beats. */
  function estimateSeconds(beatCount,calls){
    const beats=Math.max(1,Math.round(Number(beatCount))||1);
    const groups=Number(calls)>1 ? Math.round(Number(calls))-1 : Math.max(1,Math.ceil(beats/2));
    return Math.min(1200,80+70*groups+50);   // the staging, each group of shots, then the cameras
  }
  /* ---- THE CAMERAS, IN NUMBERS (2026-11-22, owner: "lock in the cameras considering the composition for the
     shot" before any image engine) ----
     One more short writing pass gives each planned shot a camera on the floor plan: where it stands, how high, what
     it looks at, its lens, and who or what each person faces. This reads that answer safely: a camera for a shot the
     scene does not have, or without two numbers for its place, is dropped; ids are the cast's, the tracked things',
     the fixed objects', the openings' or the marks'. The app then checks every camera against the set in 3D
     (shot-previs.js planCamera). ctx: {keys:["beat.moment"], cast, ids:[thing keys, fixed ids, mark ids]}
     → {cameras:{"beat.moment":{at:[x,y], height?, aim:[ids], lens?, faces:{cast id → id}, why}}, dropped, missing:[keys]} */
  function cameraKey(beat,moment){ const b=Number(beat), m=Math.round(Number(moment)); return (Number.isFinite(b)&&b>0?b:0)+"."+(Number.isFinite(m)&&m>0?m:1); }
  const shotCameraKey=sh=>cameraKey(sh&&sh.beatN,momentOf(sh));
  function normalizeCameras(raw,ctx){
    ctx=ctx||{};
    const keys=uniq(arr(ctx.keys).map(String)), who=resolver(ctx.cast), ids=new Set(arr(ctx.ids).map(String));
    const r2=n=>Math.round(n*100)/100;
    const idOf=t=>{ const s=String(t==null?"":t).trim(); if(!s) return ""; if(ids.has(s)) return s; const p=who(s); if(p) return p.id; return ids.has(slug(s))?slug(s):""; };
    const out={}; let dropped=0;
    arr(obj(raw).cameras).slice(0,200).forEach(c=>{
      c=obj(c);
      const key=cameraKey(c.beat,c.moment), at=arr(c.at);
      if(keys.indexOf(key)<0||out[key]||at.length!==2||!at.every(n=>typeof n==="number"&&Number.isFinite(n)&&Math.abs(n)<=500)){ dropped++; return; }
      const h=Number(c.height), lens=Number(String(c.lens==null?"":c.lens).replace(/[^\d.]/g,""));
      const aim=uniq(arr(typeof c.aim==="string"?[c.aim]:c.aim).map(idOf).filter(Boolean)).slice(0,6);
      const faces={};
      Object.keys(obj(c.faces)).forEach(k=>{ const p=who(k); if(!p) return; const said=String(c.faces[k]==null?"":c.faces[k]).trim();
        const t=/^(the )?(camera|lens)$/i.test(said)?"camera":idOf(said); if(t&&t!==p.id) faces[p.id]=t; });
      out[key]={at:[r2(at[0]),r2(at[1])],...(h>=0.1&&h<=4?{height:r2(h)}:{}),aim,...(lens>=10&&lens<=300?{lens:Math.round(lens)}:{}),faces,why:text(c.why||c.note,200)};
    });
    return {cameras:out,dropped,missing:keys.filter(k=>!out[k])};
  }
  /* ---- A CAMERA SET BY HAND (owner 2026-11-24, the Previs look brief, step 5: "I move the camera until I like
     the view ... Use this angle in a shot ... That shot now holds my angle") ----
     An angle chosen in a location's camera tool is written into the plan's camera list under the shot's own key, like
     any other camera, with: hand:true, pose (where it stands, the direction it looks and its lens, exactly as chosen),
     from (the location and the saved angle it came from) and planned (the camera the plan had for that shot before,
     which "Return to the planned camera" brings back). at / height / lens are kept too, so everything that reads a
     plan camera goes on reading one. A hand-set camera keeps its direction and is never moved (shot-previs.js
     planCamera); "Place the cameras" and a plan written again leave it alone (keepHandCameras). */
  const isHandCamera=c=>!!(c&&c.hand===true&&c.pose&&arr(c.pose.position).length===3&&arr(c.pose.position).every(n=>typeof n==="number"&&Number.isFinite(n)));
  function handCamera(pose,o){
    o=o||{};
    const p=obj(pose), at=arr(p.position).map(Number), yaw=Number(p.yaw), pitch=Number(p.pitch), lens=Number(p.lensMm);
    if(at.length!==3||![...at,yaw,pitch,lens].every(Number.isFinite)||at.some(n=>Math.abs(n)>500)) return null;
    const r=(n,d)=>{ const f=Math.pow(10,d); return Math.round(n*f)/f; }, floor=Number(o.floorZ)||0, from=obj(o.from);
    // the camera the plan had before: never another hand-set one (an angle replaced by an angle returns to the plan's)
    const before=o.planned&&isHandCamera(o.planned)?obj(o.planned.planned):obj(o.planned), had=Object.keys(before).length>0;
    return {at:[r(at[0],2),r(at[1],2)],height:r(Math.max(0.1,Math.min(4,at[2]-floor)),2),aim:[],lens:Math.max(8,Math.min(200,Math.round(lens))),
      // who faces whom stays as the plan had it: an angle moves the camera, not the people
      faces:{...obj(before.faces)},why:"Set by hand.",hand:true,
      pose:{position:at.map(n=>r(n,3)),yaw:r(((yaw%360)+360)%360,2),pitch:r(Math.max(-89,Math.min(89,pitch)),2),lensMm:Math.max(8,Math.min(200,Math.round(lens)))},
      from:{locationId:text(from.locationId,80),locationName:text(from.locationName,120),angleId:text(from.angleId,80),angleName:text(from.angleName,100)},
      setAt:text(o.at,40)||new Date().toISOString(),...(had?{planned:before}:{})};
  }
  // the plan with this shot's camera set by hand (key = shotCameraKey(shot))
  function setHandCamera(plan,key,cam){
    if(!plan||!key||!isHandCamera(cam)) return plan;
    return {...plan,cameras:{...obj(plan.cameras),[String(key)]:cam}};
  }
  // "Return to the planned camera": the camera the plan had before comes back; with none, the app finds one again
  function returnPlannedCamera(plan,key){
    const cams={...obj(plan&&plan.cameras)}, cur=cams[String(key)];
    if(!plan||!isHandCamera(cur)) return plan;
    if(cur.planned&&Object.keys(cur.planned).length) cams[String(key)]=cur.planned; else delete cams[String(key)];
    return {...plan,cameras:cams};
  }
  /* Cameras placed again (or a plan written again): every hand-set camera of a shot the scene still has stays as it
     is, and the camera just placed for that shot becomes the one it would return to. keys = the shots the scene has
     now (none given = keep them all). */
  function keepHandCameras(old,fresh,keys){
    const out={...obj(fresh)}, has=Array.isArray(keys)?keys.map(String):null;
    Object.keys(obj(old)).forEach(k=>{ const c=old[k]; if(!isHandCamera(c)||(has&&has.indexOf(k)<0)) return;
      const placed=obj(fresh)[k];
      out[k]=placed&&!isHandCamera(placed)?{...c,planned:placed}:c; });
    return out;
  }
  const handCameraCount=plan=>Object.values(obj(plan&&plan.cameras)).filter(isHandCamera).length;

  function camerasConfirmText(o){
    o=o||{};
    const no=String(o.sceneNo==null?"":o.sceneNo).padStart(2,"0");
    return {title:"Place the cameras of Scene "+no+" (writing credits)?",
      body:"One short writing pass"+(o.engine?" on "+o.engine:"")+" gives each planned shot a camera on the floor plan: where it stands, how high, what it looks at and its lens. The app then checks each one against the set in 3D and moves any that cannot stand there. No shot is changed and no image is made."
        +(o.again?" It replaces the cameras this scene has now"+(o.hand>0?", except the "+(o.hand===1?"one angle":o.hand+" angles")+" you set yourself: "+(o.hand===1?"it stays as it is":"they stay as they are"):"")+".":""),
      confirmLabel:"Place the cameras",cancelLabel:"Cancel"};
  }

  function confirmText(o){
    o=o||{};
    const no=String(o.sceneNo==null?"":o.sceneNo).padStart(2,"0");
    const body="Reads the whole scene, then every beat, and writes: where each person stands, the side the camera keeps to, a tracker of every prop, what people wear and each door, and the shots, each with how it starts and how it ends."
      +" A few short writing passes"+(o.engine?" on "+o.engine:"")+" (the staging, then the shots a few beats at a time, then each shot's camera on the floor plan); no image is made."
      +(o.hasShots ? " It replaces this scene's drafted shots as Re-draft does: each beat's opening shot keeps its ID and its images, changed frames need making again, and extra shots move to Recently deleted, where you can restore them."+(o.replaces||"") : "");
    return {title:(o.again?"Plan Scene "+no+" again":"Plan Scene "+no)+" (writing credits)?",body,
      confirmLabel:o.again?"Plan again":"Plan this scene",cancelLabel:"Cancel"};
  }

  const api={SIZES,ANGLES,MOVES,HANDOFFS,sizeId,angleId,moveId,lensId,handoffType,sets,beatSets,brief,normalize,shotRows,applyToShots,
    linkPropToShots,unplan,PLAN_FIELDS,stateText,namesOf,wordsFor,exact,OLD_PLAN_NOTE,handoffText,checks,thingProp,thingCard,originLabel,ownerItems,estimateSeconds,shotGroups,groupLabel,SHOT_GROUP_MOMENTS,confirmText,sameText,snapLine,parseHeading,
    isKeyShot,momentOf,cameraKey,shotCameraKey,normalizeCameras,camerasConfirmText,
    isHandCamera,handCamera,setHandCamera,returnPlannedCamera,keepHandCameras,handCameraCount};
  root.ScenePlan=api;
  root.scenePlanChecks=checks;
})(typeof window!=="undefined"?window:globalThis);
