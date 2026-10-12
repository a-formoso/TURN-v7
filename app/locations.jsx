/* locations.jsx — The Art Room ▸ Locations tab (data layer).
   Locations are DERIVED from the screenplay. Continuity-bearing places anchor master
   cards; room-level headings remain slugline units beneath a screenplay-evidenced
   enclosing place. Implied sides/thresholds in the screenplay body become coverage
   sheets with full screenplay-page snapshots as image references. Mirrors the Props
   flow: derive → draft → generate. This file
   owns scene-heading parsing / derivation / defaults + deterministic plate prompts;
   the React tab lives in locations-ui.jsx. */

/* a scene's turning point as text — the beat marked as the turn (scene-order.js) */
function _locTurn(sc){
  return (typeof sceneTurnText==="function") ? sceneTurnText(sc) : String((sc && sc.turningPoint) || "");
}
function locSlug(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48); }

function titleCaseTime(t){ t=String(t||"").trim(); return t ? t.replace(/\b\w/g,c=>c.toUpperCase()) : ""; }

/* canonical time-of-day buckets (Continuous/Later are NOT times — excluded) */
const TIME_OF_DAY = ["Dawn","Morning","Day","Afternoon","Dusk","Evening","Night"];
window.TIME_OF_DAY = TIME_OF_DAY;
/* map a worded time / synonym to a canonical bucket ("" if not a real time of day) */
function normalizeTOD(w){
  w = String(w||"").toLowerCase().trim();
  if(/sunrise|dawn|daybreak/.test(w)) return "Dawn";
  if(/morning/.test(w)) return "Morning";
  if(/noon|midday|daytime|^day$/.test(w)) return "Day";
  if(/afternoon/.test(w)) return "Afternoon";
  if(/dusk|sunset|twilight|golden hour|magic hour/.test(w)) return "Dusk";
  if(/evening/.test(w)) return "Evening";
  if(/night|midnight|nighttime/.test(w)) return "Night";
  return "";   // continuous / later / moments later / unknown → not a time of day
}
/* map a clock time string ("18:06", "6 pm", "07:30 am") to a time-of-day bucket.
   NOTE: clock time alone can't determine dusk/dawn reliably (season + latitude),
   so we only emit broad, defensible buckets here — Dawn/Morning/Day/Evening/Night.
   Dusk/Afternoon are reserved for sluglines that say so in words. */
function clockToTimeOfDay(str){
  const m = String(str).match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
  if(!m) return "";
  let h = parseInt(m[1],10); const ap = (m[3]||"").toLowerCase();
  if(ap==="pm" && h<12) h+=12; if(ap==="am" && h===12) h=0;
  if(h<0||h>23) return "";
  if(h>=5 && h<7) return "Dawn";
  if(h>=7 && h<11) return "Morning";
  if(h>=11 && h<17) return "Day";
  if(h>=17 && h<21) return "Evening";
  return "Night";
}
window.normalizeTOD = normalizeTOD; window.clockToTimeOfDay = clockToTimeOfDay;
/* Derive ALL real times-of-day for a location, accurately, FROM THE SCRIPT ONLY.
   Source of truth = each scene's slugline trailing tag ("· NIGHT" / "· DAY"),
   read via parseSlugline so we never pick up a time-word buried in a PLACE name.
   Also honours a clock time baked into a slugline or the location name.
   Scene SUMMARIES are deliberately NOT used — they are prose ("by day a programmer,
   by night the hacker…") and produce false times. Returns the distinct buckets in
   canonical day order; [] when no scene states a real time (Continuous / Loading
   Program / Later / unknown), which correctly shows as "time unset". */
function deriveLocationTimes(l, scenes){
  const set = new Set();
  // a clock time embedded in the location name itself (e.g. "… - 18:06")
  const nameClock = String((l&&l.name)||"").match(/\b(\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i);
  if(nameClock){ const t = clockToTimeOfDay(nameClock[1]); if(t) set.add(t); }
  for(const sid of ((l&&l.scenes)||[])){
    const s = (scenes||[]).find(x=>x.id===sid);
    if(!s) continue;
    const parsed = parseSlugline(s.loc);
    if(!parsed) continue;
    let t = parsed.time ? normalizeTOD(parsed.time) : "";   // worded tag → bucket ("" for Continuous etc.)
    if(!t){                                                  // no worded time → maybe a clock time in the slug tail
      const c = String(s.loc||"").match(/\b(\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i);
      if(c) t = clockToTimeOfDay(c[1]);
    }
    if(t) set.add(t);
  }
  return TIME_OF_DAY.filter(t=>set.has(t));   // canonical order: never "Night / Day"
}
window.deriveLocationTimes = deriveLocationTimes;


/* normalise a place into a canonical display name: title-case-ish but keep short
   ALL-CAPS acronyms (FBI, CIA); collapse whitespace. Common short words (the, of,
   a, o') are lower/title-cased normally, not treated as acronyms. */
const LOC_LOWER_WORDS = /^(the|of|a|an|and|to|in|on|at|by|o'|de|la|le)$/i;
function tidyPlace(p){
  return String(p||"").trim().replace(/\s+/g," ")
    .split(" ").map((w,i)=>{
      if(LOC_LOWER_WORDS.test(w)) return i===0 ? (w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()) : w.toLowerCase();
      // genuine short acronym (all caps, no lowercase, ≤3) -> keep as-is
      if(/^[A-Z0-9'’.\-]+$/.test(w) && w.length<=3 && /[A-Z]/.test(w)) return w;
      return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase();
    }).join(" ");
}

/* Parse one slugline into { intExt, place, time }.
   "INT. HEART O' THE CITY HOTEL · NIGHT" -> {intExt:"INT", place:"Heart o' the City Hotel", time:"Night"} */
function parseSlugline(raw){
  let s = String(raw||"").trim();
  if(!s) return null;
  s = s.replace(/^\s*\d+[\.\)]?\s+/,"");                 // strip a leading scene number
  let intExt = "";
  const m = s.match(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?)\s*/i);
  if(m){ intExt = m[1].toUpperCase().replace(/\./g,"").replace(/I\/E/,"INT/EXT"); s = s.slice(m[0].length); }
  // time of day: trailing segment after the LAST separator, if it reads like a time
  let time = "";
  const tm = s.match(/[\u00b7\u2014,\-]\s*([A-Za-z][A-Za-z'\s]{1,22})\s*$/);
  if(tm && /\b(night|day|dawn|dusk|morning|evening|afternoon|continuous|later|moments?\s+later|sunset|sunrise|magic\s+hour|golden\s+hour|loading\s+program)\b/i.test(tm[1])){
    time = tm[1].trim(); s = s.slice(0, tm.index).trim();
  }
  let place = s.replace(/[\u00b7\u2014,\-\s]+$/,"").trim();
  if(!place) return null;
  return { intExt, place, time: titleCaseTime(time) };
}

/* split a compound slugline place into its segments: "APARTMENT / NIGHTCLUB" -> two */
function splitCompoundPlace(place){
  return String(place||"").split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);
}

/* A screenplay can move between rooms without opening a formal secondary
   slugline. Filmmakers still need those named, filmable spaces as shot/location
   units. Recognise only two strong forms so ordinary prose such as "he looks
   toward the kitchen" cannot move the camera by accident:
   - a standalone room marker at the start of an action block: "THE KITCHEN."
   - the first establishing action beneath a heading ending in a room identity:
     "A dead man's living room." */
const SCREENPLAY_INLINE_SPACES = [
  "living room","sitting room","dining room","breakfast room","laundry room","utility room",
  "kitchen","bedroom","bathroom","washroom","hallway","corridor","foyer","entryway",
  "pantry","basement","cellar","attic","nursery","den","study","mudroom","sunroom"
];
function screenplayInlineSpaceName(text, allowEstablishing){
  const raw=String(text||"").replace(/\s+/g," ").trim();
  if(!raw) return "";
  const first=((raw.match(/^([^.!?]{1,180})[.!?](?:\s|$)/)||[])[1]||"").trim();
  if(!first) return "";
  const normal=s=>String(s||"").toLowerCase().replace(/^the\s+/,"").replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
  const exact=normal(first);
  const direct=SCREENPLAY_INLINE_SPACES.find(name=>exact===name);
  if(direct) return tidyPlace(direct);
  if(!allowEstablishing || !/^(?:a|an|the)\b/i.test(first)) return "";
  const low=String(first).toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
  const ending=SCREENPLAY_INLINE_SPACES.slice().sort((a,b)=>b.length-a.length)
    .find(name=>low===name||low.endsWith(" "+name));
  return ending ? tidyPlace(ending) : "";
}
function screenplayInlineSpaceHeading(text,currentHeading,allowEstablishing){
  const name=screenplayInlineSpaceName(text,allowEstablishing);
  if(!name) return "";
  const parent=parseSlugline(currentHeading)||{};
  return (parent.intExt||"INT")+". "+name+(parent.time?(" - "+parent.time):"");
}
window.screenplayInlineSpaceName=screenplayInlineSpaceName;
window.screenplayInlineSpaceHeading=screenplayInlineSpaceHeading;

/* Collect every slugged place record + entry from screenplay headings — shared
   by deriveLocations (master cards) and deriveSubspaceFold (sub-space grouping).
   A scene's own slugline is read PLUS any secondary (mid-scene) sluglines the
   draft carries — a chase that cuts INT. HALL → EXT. ROOF names real places.
   INTERCUT lines are skipped (they reference already-slugged places, they don't
   introduce one). */
function collectSluggedPlaces(scenes, drafts){
  const recOrder = []; const recByKey = {}; const entries = [];
  (scenes||[]).forEach(sc=>{
    if(!sc) return;
    const slugTexts = [sc.loc];
    const dBlocks = drafts && drafts[sc.id] && drafts[sc.id].blocks;
    if(Array.isArray(dBlocks)){
      let activeHeading=String(sc.loc||""), actionSinceHeading=0;
      dBlocks.forEach(b=>{
        if(b && b.type==="scene" && b.text && !/^\s*INTERCUT\b/i.test(b.text)){
          activeHeading=String(b.text); actionSinceHeading=0;
          if(String(b.text).trim().toUpperCase()!==String(sc.loc||"").trim().toUpperCase()) slugTexts.push(b.text);
          return;
        }
        if(!b || b.type!=="action") return;
        const inline=screenplayInlineSpaceHeading(b.text,activeHeading||sc.loc,actionSinceHeading===0);
        actionSinceHeading++;
        if(inline && String(inline).trim().toUpperCase()!==String(activeHeading||"").trim().toUpperCase()){
          slugTexts.push(inline); activeHeading=inline;
        }
      });
    }
    slugTexts.forEach(slugText=>{
      const parsed = parseSlugline(slugText);
      if(!parsed) return;
      const places = splitCompoundPlace(parsed.place);
      const primary = tidyPlace(places[0]);
      const key = locSlug(primary.split(/[\u00b7\u2014,]/)[0]).split("-").slice(0,4).join("-");
      if(!key) return;
      if(!recByKey[key]){ recByKey[key] = { key, name:primary.split(/[\u00b7\u2014]/)[0].trim(), scenes:[] }; recOrder.push(key); }
      const R = recByKey[key];
      if(sc.id && R.scenes.indexOf(sc.id)<0) R.scenes.push(sc.id);
      entries.push({ key, sc, parsed, places, primary });
    });
  });
  return { recOrder, recByKey, entries };
}

/* SUB-SPACE FOLD — "INT. INTAKE BOOTH - NIGHT" inside a scene that also visits
   "EXT. INTAKE YARD - NIGHT": the booth is a sub-structure of the yard complex,
   not a master location of its own. A slugged place folds under a parent place
   when its name carries a sub-structure noun (booth, kiosk, gatehouse, office,
   cabin…), shares its FIRST name token with the parent (same named complex),
   and never appears in a scene the parent doesn't. Generic rooms fold only when the
   screenplay identifies one unique enclosing continuity place; vehicles never fold
   merely by name (a police car is not the police station). The sub-place keeps its
   own slugline unit and stable unit key; only master-card grouping moves. */
const SUBSPACE_TAIL = /\b(?:booth|kiosk|gatehouse|cabin|hut|shed|stall|office|annex|porch|garage|workshop)\b/i;
const CONTAINER_CHILD_TAIL = /\b(?:booth|kiosk|gatehouse|cabin|hut|shed|stall|office|annex|porch|garage|workshop)\s*$/i;
/* Generic rooms are filmable spaces, but they are not automatically continuity-
   bearing places. When the screenplay itself identifies their enclosing site, fold
   them under that site's master while keeping each slugline as its own unit. This is
   deliberately evidence-gated: "Kitchen" only folds when its scenes actually say
   house/home/apartment/etc., and a tie between possible parents stays separate. */
const GENERIC_ROOM_SUBSPACE = /^(?:the\s+)?(?:kitchen|living room|sitting room|dining room|breakfast room|bedroom|bathroom|washroom|hallway|corridor|foyer|entryway|pantry|laundry room|utility room|basement|cellar|attic|nursery|den|study|mudroom|sunroom)(?:\s+\d+)?$/i;
const CONTINUITY_CONTAINER_KINDS = [
  { parent:/\b(?:house|home|residence|cottage|bungalow|farmhouse|mansion|manor|villa|apartment|flat|condo)\b/i,
    evidence:/\b(?:house|home|residence|cottage|bungalow|farmhouse|mansion|manor|villa|apartment|flat|condo)\b/i,
    words:["house","home","residence","cottage","bungalow","farmhouse","mansion","manor","villa","apartment","flat","condo"] },
  { parent:/\b(?:hotel|motel|inn|hostel)\b/i, evidence:/\b(?:hotel|motel|inn|hostel)\b/i,
    words:["hotel","motel","inn","hostel"] },
  { parent:/\b(?:hospital|clinic|medical center)\b/i, evidence:/\b(?:hospital|clinic|medical center)\b/i,
    words:["hospital","clinic","medical center"] },
  { parent:/\b(?:school|college|university|academy|campus)\b/i, evidence:/\b(?:school|college|university|academy|campus)\b/i,
    words:["school","college","university","academy","campus"] },
  { parent:/\b(?:station|precinct|courthouse|government building|office building|headquarters|factory|warehouse)\b/i,
    evidence:/\b(?:station|precinct|courthouse|government building|office building|headquarters|factory|warehouse)\b/i,
    words:["station","precinct","courthouse","government building","office building","headquarters","factory","warehouse"] }
];
function locationFoldEvidence(sub, scenes, drafts){
  const bits=[];
  (sub&&sub.scenes||[]).forEach(sid=>{
    const sc=(scenes||[]).find(s=>s&&s.id===sid); if(!sc) return;
    [sc.title,sc.summary,sc.objective,_locTurn(sc)].forEach(x=>{ if(x) bits.push(x); });
    locationScreenplayBlocks(sc,drafts).forEach(b=>{ if(b&&b.text) bits.push(b.text); });
  });
  return bits.join(" ").toLowerCase().replace(/[’']s\b/g,"").replace(/[^a-z0-9]+/g," ");
}
function semanticRoomParent(sub, recs, scenes, drafts){
  if(!sub || !GENERIC_ROOM_SUBSPACE.test(String(sub.name||"").trim())) return null;
  const evidence=locationFoldEvidence(sub, scenes, drafts);
  if(!evidence) return null;
  const stop=new Set(["the","a","an","of","at","and","house","home","residence","cottage","bungalow","farmhouse","mansion","manor","villa","apartment","flat","condo","hotel","motel","inn","hostel","hospital","clinic","medical","center","school","college","university","academy","campus","station","precinct","courthouse","government","building","office","headquarters","factory","warehouse"]);
  const scored=(recs||[]).filter(p=>p&&p.key!==sub.key
    &&!GENERIC_ROOM_SUBSPACE.test(String(p.name||"").trim())
    // A card such as Funeral Home Office is itself a filmable subspace, not an
    // enclosing site candidate for an unrelated Kitchen or Living Room.
    &&!CONTAINER_CHILD_TAIL.test(String(p.name||"").trim())).map(parent=>{
    const kind=CONTINUITY_CONTAINER_KINDS.find(k=>k.parent.test(String(parent.name||"")));
    if(!kind) return null;
    let score=kind.evidence.test(evidence)?5:0;
    // Prefer the container noun the screenplay actually uses. This keeps a HOUSE
    // from tying with an unrelated Funeral HOME merely because both are residential
    // words in the same broad category.
    const parentLow=String(parent.name||"").toLowerCase();
    const exactKind=(kind.words||[]).find(w=>new RegExp("\\b"+w.replace(/ /g,"\\s+")+"\\b").test(parentLow));
    if(exactKind && new RegExp("\\b"+exactKind.replace(/ /g,"\\s+")+"\\b").test(evidence)) score+=3;
    const tokens=String(parent.name||"").toLowerCase().replace(/[’']s\b/g,"").split(/[^a-z0-9]+/)
      .filter(w=>w.length>=4&&!stop.has(w));
    tokens.forEach(w=>{ if(new RegExp("\\b"+w+"\\b").test(evidence)) score+=3; });
    if((parent.scenes||[]).some(sid=>(sub.scenes||[]).indexOf(sid)>=0)) score+=1;
    return score>=5?{parent,score}:null;
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
  return scored.length && (!scored[1] || scored[0].score>scored[1].score) ? scored[0].parent : null;
}
function foldSubspaceKeys(recs, scenes, drafts){
  const headTok = (n)=> String(n||"").trim().split(/\s+/)[0].toLowerCase();
  const low = (n)=> String(n||"").trim().toLowerCase();
  /* RULE B — PREFIX CONTAINMENT: "PARENT - AREA" / "PARENT AREA" names an area OF
     the parent by construction ("E-waste Canals - Flooded Junction" ⊂ "E-waste
     Canals"). The name itself declares containment, so no scene-subset or lexicon
     is required; a trailing name boundary is, so "Yardbird" never folds under "Yard". */
  const startsArea = (subN, parN)=>{
    if(!parN || subN===parN || subN.indexOf(parN)!==0) return false;
    const rest = subN.slice(parN.length);
    return /^\s*[-\u00b7\u2014,]/.test(rest) || /^\s/.test(rest);
  };
  const out = {};
  (recs||[]).forEach(sub=>{
    if(!sub || !sub.key) return;
    // RULE A — SUB-STRUCTURE NOUN + shared first token + scene containment
    // ("Intake Booth" only ever plays inside scenes that also visit "Intake Yard").
    if(SUBSPACE_TAIL.test(sub.name)){
      const tok = headTok(sub.name);
      if(tok){
        const parents = (recs||[]).filter(p=> p && p.key!==sub.key
          && !SUBSPACE_TAIL.test(p.name)
          && headTok(p.name)===tok
          && sub.scenes.every(sid=> p.scenes.indexOf(sid)>=0));
        if(parents.length){
          parents.sort((a,b)=> b.scenes.length - a.scenes.length);   // the most-visited sibling is the complex's master
          out[sub.key] = parents[0].key;
          return;
        }
      }
    }
    // RULE B — longest matching prefix parent wins; chains ("A - B - C" under
    // "A - B" under "A") resolve transitively when the fold is applied.
    const prefixes = (recs||[]).filter(p=> p && p.key!==sub.key && startsArea(low(sub.name), low(p.name)));
    if(prefixes.length){
      prefixes.sort((a,b)=> String(b.name||"").length - String(a.name||"").length);
      out[sub.key] = prefixes[0].key;
      return;
    }
    // RULE C — screenplay-evidenced room containment: KITCHEN / LIVING ROOM
    // remain distinct slugline units but share the enclosing HOUSE master.
    const semantic = semanticRoomParent(sub, recs, scenes, drafts);
    if(semantic) out[sub.key] = semantic.key;
  });
  return out;
}
/* chase a fold chain to its ultimate master, with a cycle guard */
function resolveFoldKey(fold, key){
  const seen = {}; let cur = key;
  while(fold[cur] && !seen[cur]){ seen[cur] = true; cur = fold[cur]; }
  return cur;
}
function deriveSubspaceFold(scenes, drafts){
  const c = collectSluggedPlaces(scenesInStoryOrder(scenes), drafts);
  const fold = foldSubspaceKeys(c.recOrder.map(k=>c.recByKey[k]), scenes, drafts);
  const resolved = {};
  Object.keys(fold).forEach(k=>{ resolved[k] = resolveFoldKey(fold, k); });
  return resolved;
}
window.deriveSubspaceFold = deriveSubspaceFold;

/* Derive canonical master locations from screenplay scene headings.
   Groups scenes by a normalised key on the PRIMARY place so "NEBUCHADNEZZAR · CORE"
   and "NEBUCHADNEZZAR · TRAINING" land under one "Nebuchadnezzar" (areas recorded).
   A room-level secondary heading becomes a slugline unit under a unique enclosing
   place when the screenplay supplies that relationship; ambiguous rooms stay as
   separate masters. Implied sides and threshold spaces inside action prose are
   handled by coverage sheets on the relevant master card. Named sub-structures
   (booth, kiosk…) likewise fold under their complex's master. Returns new objects only
   (deduped against `existing`). */
function deriveLocations(scenes, existing, drafts){
  scenes = scenesInStoryOrder(scenes);
  const have = existing || [];
  const seen = new Set(have.map(l=>l.key || locSlug(l.name)));
  const c = collectSluggedPlaces(scenes, drafts);
  const fold = foldSubspaceKeys(c.recOrder.map(k=>c.recByKey[k]), scenes, drafts);
  const order = []; const byKey = {};
  const ensure = (key,rootKey)=>{
    if(byKey[key]) return byKey[key];
    const rec = c.recByKey[key] || c.recByKey[rootKey] || {};
    const isChild = key!==rootKey;
    byKey[key] = {
      key, name:rec.name || key.replace(/-/g," ").replace(/\b\w/g,x=>x.toUpperCase()),
      intExt:"", times:new Set(), areas:new Set(), scenes:[],
      scope:"atomic", parentKey:isChild?rootKey:"", continuityRootKey:rootKey,
    };
    order.push(key);
    return byKey[key];
  };
  const addEntry = (L,e,asRoot)=>{
    if(e.parsed.time) L.times.add(e.parsed.time);
    const areaTail=e.primary.split(/\u00b7/).slice(1).join(" \u00b7 ").trim();
    if(areaTail) L.areas.add(areaTail);
    e.places.slice(1).forEach(p=>L.areas.add(tidyPlace(p)));
    if(e.sc.id && L.scenes.indexOf(e.sc.id)<0) L.scenes.push(e.sc.id);
    if(e.parsed.intExt){
      if(!L.intExt) L.intExt=e.parsed.intExt;
      else if(e.parsed.intExt!==L.intExt) L.intExt="INT/EXT";
    }
    if(asRoot && e.key!==L.key)
      L.areas.add((c.recByKey[e.key]&&c.recByKey[e.key].name)||e.primary.split(/[\u00b7\u2014]/)[0].trim());
  };
  c.entries.forEach(e=>{
    const rootKey=resolveFoldKey(fold,e.key);
    const root=ensure(rootKey,rootKey);
    if(e.key!==rootKey) root.scope="compound";
    addEntry(root,e,true);
    if(e.key!==rootKey) addEntry(ensure(e.key,rootKey),e,false);
  });
  const out=[];
  order.forEach((key,orderIndex)=>{
    if(seen.has(key)) return;
    const L=byKey[key];
    out.push({
      id:"loc-"+key+"-"+orderIndex,
      key,name:L.name,intExt:L.intExt||"INT",
      // times in the SAME buckets and order the card keeps (deriveLocationTimes): Continuous / Later are
      // no time at all — the sync and the card used to overwrite each other's lists (2026-10-08)
      times:deriveLocationTimes({ name:L.name, scenes:L.scenes }, scenes),areas:[...L.areas],scenes:L.scenes,
      scope:L.scope,parentKey:L.parentKey,continuityRootKey:L.continuityRootKey,
      architecture:"",materials:"",lighting:"",permanentDressing:"",
      topology:"",continuityAnchors:"",anchorsLocked:true,significance:"",
      provenance:{},renderStyle:"",negativePrompt:"",variants:[],fromScript:true,
    });
  });
  return out;
}
window.deriveLocations = deriveLocations;
window.parseSlugline = parseSlugline;
window.locSlug = locSlug;

/* LOCATION IDENTITY GRAPH ---------------------------------------------------
   Root invariants flow into a child workspace by reference. They are never copied
   into the child record, so changing the root cannot leave three stale duplicates.
   Resolution precedence for prompts is: root invariant -> child fact ->
   Slugline Unit / Time-of-Day Variant. */
function locationKeyOf(l){
  return String((l&&l.key)||((typeof locSlug==="function")?locSlug(l&&l.name).split("-").slice(0,4).join("-"):"")||"");
}
function locationParentOf(l,locations){
  if(!l) return null;
  const list=locations||((window.turnContinuity||{}).locations)||[];
  const key=String(l.parentKey||"");
  return (key&&list.find(x=>x&&x.id!==l.id&&locationKeyOf(x)===key))
    || (l.parentLocation&&l.parentLocation.id!==l.id&&
      (list.find(x=>x&&x.id===l.parentLocation.id)||l.parentLocation)) || null;
}
/* Shared style is resolved live, never copied into room records. An explicit
   room-style pick can opt out without deleting the room's saved style text. */
function locationRenderStyleSource(l,locations){
  let current=l||{};
  const seen=new Set();
  while(current&&!current.renderStyleIndependent&&!seen.has(current.id||current)){
    seen.add(current.id||current);
    const parent=locationParentOf(current,locations);
    if(!parent||seen.has(parent.id||parent)) break;
    current=parent;
  }
  return current;
}
function locationRenderEntity(l){
  const source=locationRenderStyleSource(l);
  return {...l,renderStyleKey:source.renderStyleKey,surpriseRender:source.surpriseRender};
}
function locationParentReference(l,url){
  const parent=locationParentOf(l);
  if(!parent) return null;
  return {url:url||"",kind:"location",ready:!!url,required:true,
    refId:parent.id,label:parent.name||"Parent location",
    note:(parent.name||"Parent location")+" master plate — binding visual continuity. "
      +"Read ALL panels together, including partial views through doorways. If this room is visible in the parent plate, reproduce that exact room: openings, proportions, finishes, fixed fixtures AND baseline furniture positions. "
      +"A wider view adds evidence; it must not relocate objects seen in a doorway glimpse. Follow the reviewed shared set layout; screen-left/right can change with camera orientation, room relationships cannot. "
      +"Otherwise extend the same architectural era, material palette, construction details and scale into this subspace. "
      +"Preserve this room's own layout and function; never copy sibling-room furniture or the parent's multi-room framing. "
      +"Time of day, active lights and weather may change only for the requested state."};
}
async function locationParentReferences(l){
  const parent=locationParentOf(l);
  if(!parent){
    if(l&&l.parentKey){ const e=new Error("Restore the parent location before generating this subspace.");e.requiredReference=true;throw e; }
    return [];
  }
  const reference=locationParentReference(l,"");
  let url=typeof nbGetImage==="function"?nbGetImage(parent.id):"";
  if(!url&&typeof nbLoadImage==="function"){
    try{url=await nbLoadImage(parent.id);}catch(e){e.requiredReference=true;throw e;}
  }
  if(!url){ const e=new Error("Generate or restore "+(parent.name||"the parent location")+"'s plate first — this subspace needs it as a visual reference.");e.requiredReference=true;throw e; }
  return [{...reference,url,ready:true}];
}
async function locationStateReferences(l){
  let url=typeof nbGetImage==="function"?nbGetImage(l.id):"";
  if(!url&&typeof nbLoadImage==="function")url=await nbLoadImage(l.id);
  if(!url){const e=new Error("Generate or restore "+(l.name||"the location")+"'s plate before its environment states.");e.requiredReference=true;throw e;}
  return [{url,refId:l.id,kind:"location",required:true,ready:true,label:l.name,
    note:(l.name||"Location")+" master plate — preserve this exact room, geometry, materials, openings and fixed fixtures; change only the requested environment state."},
    ...await locationParentReferences(l)];
}
function locationReferenceInstructions(refs){
  return refs.length?" REFERENCE IMAGES (binding): "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")+".":"";
}
function locationGenerationOrder(locations){
  const list=(locations||[]).filter(Boolean),out=[],seen=new Set();
  const visit=l=>{if(seen.has(l.id))return;seen.add(l.id);
    const parent=locationParentOf(l,list);
    if(parent&&list.some(x=>x.id===parent.id))visit(parent);
    out.push(l);
  };
  list.forEach(visit);return out;
}
window.locationRenderStyleSource=locationRenderStyleSource;
window.locationRenderEntity=locationRenderEntity;
window.locationParentReference=locationParentReference;
window.locationParentReferences=locationParentReferences;
window.locationStateReferences=locationStateReferences;
window.locationGenerationOrder=locationGenerationOrder;

/* A room-space contract, shared by the entire location family. The depth grid
   remains camera-relative; it must never silently become a second floor plan. */
function locationSpatialOwner(l,locations){
  const list=locations||((window.turnContinuity||{}).locations)||[];
  let current=l||{},seen=new Set();
  while(current&&!seen.has(current.id)){
    seen.add(current.id);
    const parent=locationParentOf(current,list);
    if(!parent||seen.has(parent.id))break;
    current=parent;
  }
  return current;
}
function normalizeLocationSpatialPlan(value){
  const p=value&&typeof value==="object"?value:{};
  const text=(v,n)=>typeof v==="string"?v.slice(0,n):"";
  const ids=new Set();
  const anchors=(Array.isArray(p.anchors)?p.anchors:[]).filter(a=>a&&typeof a==="object").slice(0,24).map((a,i)=>{
    let id=text(a.id,64).trim().replace(/[^a-zA-Z0-9_-]/g,"-")||"anchor-"+(i+1);
    while(ids.has(id))id+="-"+(i+1);
    ids.add(id);
    return {id,space:text(a.space,80),name:text(a.name,80),placement:text(a.placement,320),
      evidence:text(a.evidence,160),basis:/^(observed|script|design)$/.test(a.basis)?a.basis:"design"};
  });
  return {schema:"cm-spatial-layout-v1",frame:text(p.frame,400),anchors,
    sightlines:text(p.sightlines,1000),unresolved:text(p.unresolved,1000),
    status:p.status==="reviewed"?"reviewed":"draft",
    source:{assetId:text(p.source&&p.source.assetId,160),iso:text(p.source&&p.source.iso,160)}};
}
function locationSpatialSource(owner){
  const meta=typeof nbGetMeta==="function"?nbGetMeta(owner.id):null;
  return {assetId:owner.id,iso:String(meta&&meta.iso||"")};
}
/* known=false: neither the plate nor its details have loaded on this device yet (a cold cache after a
   reload, cloud before prefetch) — "unknown", never "the parent plate changed"; planSig: the reviewed
   layout the current plate was made from (2026-10-08). Kept apart from the source stamp, which is stored
   and compared as {assetId, iso}. */
function locationSpatialSourceInfo(owner){
  const meta=typeof nbGetMeta==="function"?nbGetMeta(owner.id):null;
  const img=typeof nbGetImage==="function"?nbGetImage(owner.id):"";
  return {known:!!(meta||img),planSig:String(meta&&meta.spatialPlanSig||"")};
}
/* WHICH LAYOUT A PLATE WAS MADE FROM (2026-10-08, owner — Locations review): the reviewed layout's content,
   without its source stamp. A plate generated from the reviewed layout records it (meta.spatialPlanSig), so
   making the parent plate no longer sends that same layout back for review — the rooms under it can follow
   in the same run. A plate made any other way (an edit, an upload, an older plate) still asks for review. */
function locationSpatialPlanSig(plan){
  const p={...normalizeLocationSpatialPlan(plan)}; delete p.source; delete p.reviewedAt; delete p.reviewedBy;
  const str=JSON.stringify(p); let h=5381; for(let i=0;i<str.length;i++) h=((h<<5)+h+str.charCodeAt(i))|0;
  return "sp1:"+(h>>>0).toString(36)+":"+str.length;
}
/* the sig to record on a plate about to be made for l — only when l OWNS the layout and it is ready */
function locationSpatialPlanSigFor(l){
  try{ const st=requireLocationSpatialPlan(l); return st.owner.id===l.id ? locationSpatialPlanSig(st.plan) : ""; }catch(e){ return ""; }
}
function locationSpatialPlanState(l,locations){
  const owner=locationSpatialOwner(l,locations),plan=normalizeLocationSpatialPlan(owner.spatialPlan);
  const source=locationSpatialSource(owner);
  const tooLarge=JSON.stringify(plan).length>12000;
  const complete=!tooLarge&&!!plan.frame.trim()&&plan.anchors.length>0&&plan.anchors.every(a=>a.space.trim()&&a.name.trim()&&a.placement.trim());
  const info=locationSpatialSourceInfo(owner);
  const builtFromThis=!!(info.planSig && info.planSig===locationSpatialPlanSig(plan));
  const stale=plan.source.assetId!==source.assetId||(info.known && plan.source.iso!==source.iso && !builtFromThis);
  const ready=complete&&plan.status==="reviewed"&&!stale;
  return {owner,plan,source,complete,stale,ready,
    reason:tooLarge?"Shorten the shared set layout to 12,000 characters so it reaches image generation and Blender intact."
      :!complete?"Prepare the shared set layout in Spatial Layout & Staging first."
      :plan.status!=="reviewed"?"Review the shared set layout before rendering."
      :stale?"The parent plate changed. Check it against the shared set layout and review the layout again.":""};
}
function requireLocationSpatialPlan(l){
  const owner=locationSpatialOwner(l);
  const live=(((window.turnContinuity||{}).locations)||[]).find(x=>x.id===owner.id)||owner;
  const state=locationSpatialPlanState(live);
  if(!state.ready){const e=new Error(state.reason+" ("+(state.owner.name||"Location")+")");e.requiredReference=true;throw e;}
  return state;
}
/* VIEW COMPOSITION FOLLOWS THE SHARED LAYOUT (2026-10-12, owner — "go ahead with all of it"). A composition is
   drafted from the layout, so "Draft view composition" waits while that layout is being drafted or a drafted one
   waits to be confirmed (registered here by every open layout editor, per owner, per editor instance), and while
   the layout isn't ready (the plate's own reason). Each drafted composition records the layout it was drafted
   from (staging.layoutSig); a later change to that layout is said on the composition — never a block. */
const _locLayoutDraftPending={};
function setLocationLayoutDraftPending(ownerId,token,on){
  const id=String(ownerId||""); if(!id||!token)return;
  const set=_locLayoutDraftPending[id]||(_locLayoutDraftPending[id]=new Set());
  const had=set.has(token);
  if(on)set.add(token);else set.delete(token);
  if(!set.size)delete _locLayoutDraftPending[id];
  if(had!==!!on){try{window.dispatchEvent(new CustomEvent("loc-layout-draft-pending",{detail:id}));}catch(e){}}
}
function locationLayoutDraftPending(ownerId){
  const set=_locLayoutDraftPending[String(ownerId||"")];
  return !!(set&&set.size);
}
const LOCATION_STAGING_LAYOUT_WAIT="Waiting for the shared layout — confirm it first.";
/* "" when "Draft view composition" may run for l; otherwise the reason it waits */
function locationStagingDraftBlock(l){
  if(!l)return "";
  const owner=locationSpatialOwner(l);
  if(locationLayoutDraftPending(owner.id))return LOCATION_STAGING_LAYOUT_WAIT;
  try{requireLocationSpatialPlan(l);return "";}catch(e){return String(e&&e.message||"Review the shared set layout before rendering.");}
}
/* the layout a composition drafted NOW is drafted from (the live owner's layout, as the prompt reads it) */
function locationStagingLayoutSig(l){
  try{
    const owner=locationSpatialOwner(l);
    const live=(((window.turnContinuity||{}).locations)||[]).find(x=>x.id===owner.id)||owner;
    return locationSpatialPlanSig(live.spatialPlan);
  }catch(e){return "";}
}
/* true when l's composition was drafted from a layout that has changed since (an unstamped one says nothing) */
function locationStagingLayoutChanged(l){
  const sig=String((l&&l.staging&&l.staging.layoutSig)||"");
  if(!sig||(typeof stagingHasContent==="function"&&!stagingHasContent(l)))return false;
  const now=locationStagingLayoutSig(l);
  return !!now&&now!==sig;
}
/* what a composition looked like, for "did someone edit it while the draft ran?" (content only) */
function locationStagingBasis(l){
  return JSON.stringify(typeof stagingOf==="function"?stagingOf(l||{}):((l&&l.staging)||{}));
}
function locationSpatialContract(l,locations){
  const owner=locationSpatialOwner(l,locations);
  const live=(locations||((window.turnContinuity||{}).locations)||[]).find(x=>x.id===owner.id)||owner;
  const state=locationSpatialPlanState(live,locations);
  return {schema:"cm-spatial-layout-v1",ownerId:state.owner.id,ownerName:state.owner.name,
    targetSpace:l.name,status:state.ready?"reviewed":state.stale&&state.plan.status==="reviewed"?"needs-review":"draft",
    frame:state.plan.frame,anchors:state.plan.anchors,sightlines:state.plan.sightlines,
    unresolved:state.plan.unresolved,source:state.plan.source,
    corrections:String(state.owner.spatialNotes||"").slice(0,2000),
    rules:"One physical set, not one layout per image. Stable anchor IDs identify the SAME objects in every panel and subspace. Placements are relative to the named room frame, NOT screen-left/right. Move only cameras; never mirror rooms, swap walls, move furniture or change doorway/window adjacency to fit a view. Reconcile direct room views with every doorway glimpse of that room. Camera depth grids describe projections of this plan and cannot override it. Unknown or occluded geometry is not measured evidence; retain uncertainty and request dimensions before exact Blender construction."};
}
function locationSpatialPrompt(l){
  return " SHARED SET LAYOUT (binding physical relationships, all panels): "+JSON.stringify(locationSpatialContract(l))+". ";
}
async function locationSpatialReferences(l){
  const state=requireLocationSpatialPlan(l);
  if(!state.source.iso && !state.plan.source.iso)return [];   // no plate behind the layout (yet)
  let url=typeof nbGetImage==="function"?nbGetImage(state.owner.id):"";
  if(!url&&typeof nbLoadImage==="function"){
    try{url=await nbLoadImage(state.owner.id);}catch(e){e.requiredReference=true;throw e;}
  }
  const current=requireLocationSpatialPlan(l);
  if(!url||JSON.stringify(current.plan)!==JSON.stringify(state.plan)){
    const e=new Error("The reviewed layout reference is unavailable or changed while loading. Review the shared layout and try again.");
    e.requiredReference=true;throw e;
  }
  return [{url,kind:"location",refId:state.owner.id,required:true,ready:true,label:state.owner.name,
    note:(state.owner.name||"Parent set")+" — source plate for the reviewed shared set layout. Cross-read ALL panels and doorway glimpses. Keep the same anchor IDs, furniture placements and sightlines; move only the cameras. Layout corrections override drift in this older image."}];
}
function mergeLocationReferences(...groups){
  const out=[];
  groups.flat().filter(Boolean).forEach(ref=>{
    const prior=out.find(r=>r.refId===ref.refId);
    if(prior)prior.note=[prior.note,ref.note].filter(Boolean).join(" ");
    else out.push({...ref});
  });return out;
}
window.locationSpatialOwner=locationSpatialOwner;
window.normalizeLocationSpatialPlan=normalizeLocationSpatialPlan;
window.locationSpatialSource=locationSpatialSource;
window.locationSpatialPlanState=locationSpatialPlanState;
window.locationSpatialPlanSig=locationSpatialPlanSig;
window.locationSpatialPlanSigFor=locationSpatialPlanSigFor;
window.requireLocationSpatialPlan=requireLocationSpatialPlan;
window.setLocationLayoutDraftPending=setLocationLayoutDraftPending;
window.locationLayoutDraftPending=locationLayoutDraftPending;
window.LOCATION_STAGING_LAYOUT_WAIT=LOCATION_STAGING_LAYOUT_WAIT;
window.locationStagingDraftBlock=locationStagingDraftBlock;
window.locationStagingLayoutSig=locationStagingLayoutSig;
window.locationStagingLayoutChanged=locationStagingLayoutChanged;
window.locationStagingBasis=locationStagingBasis;
window.locationSpatialContract=locationSpatialContract;
window.locationSpatialPrompt=locationSpatialPrompt;
window.locationSpatialReferences=locationSpatialReferences;
window.mergeLocationReferences=mergeLocationReferences;
function locationChildrenOf(l,locations){
  const key=locationKeyOf(l);
  return key ? (locations||[]).filter(x=>x&&x!==l&&String(x.parentKey||"")===key) : [];
}
function locationScopeOf(l,locations){
  if(l&&l.parentKey) return "atomic";
  if(l&&/^(atomic|compound)$/.test(String(l.scope||""))) return l.scope;
  return locationChildrenOf(l,locations||((window.turnContinuity||{}).locations)||[]).length ? "compound" : "atomic";
}
function locationEffectiveSide(l,units,coverageSheets,children){
  const sides=[];
  const add=(v)=>{ const s=String(v||"").toUpperCase();
    if(/INT/.test(s)) sides.push("INT"); if(/EXT/.test(s)) sides.push("EXT"); };
  add(l&&l.intExt);
  (units||[]).forEach(u=>add(u&&u.intExt));
  (coverageSheets||[]).forEach(v=>add(v&&v.role));
  (children||[]).forEach(c=>add(c&&c.intExt));
  const set=new Set(sides);
  return set.has("INT")&&set.has("EXT") ? "INT/EXT" : (set.has("EXT")?"EXT":"INT");
}
function locationIdentityLayers(l,locations){
  const list=locations||((window.turnContinuity||{}).locations)||[];
  const parent=locationParentOf(l,list);
  const fields=(x)=>x?{
    architecture:String(x.architecture||"").trim()||undefined,
    materials:String(x.materials||"").trim()||undefined,
    permanent_lighting_interfaces:String(x.lighting||"").trim()||undefined,
    permanent_dressing:String(x.permanentDressing||"").trim()||undefined,
    spatial_topology:String(x.topology||"").trim()||undefined,
    continuity_anchors:String(x.continuityAnchors||"").trim()?{
      status:x.anchorsLocked===false?"editable":"LOCKED / binding",
      rules:String(x.continuityAnchors||"").trim(),
    }:undefined,
    provenance:(x.provenance&&Object.keys(x.provenance).length)?x.provenance:undefined,
  }:undefined;
  return {
    scope:locationScopeOf(l,list),
    shared_set_layout:locationSpatialContract(l,list),
    continuity_root:parent?{ id:parent.id,name:parent.name,invariants:fields(parent) }:undefined,
    child_space:parent?{ id:l.id,name:l.name,specific_identity:fields(l) }:undefined,
    visual_continuity:parent?{
      rule:"Match the exact subspace already visible in the parent plate. Extend shared materials, construction details, architectural era and scale only where the parent does not show it. Child-specific layout does not replace shared anchors; never transplant sibling-room furnishings.",
      render_style_source:(locationRenderStyleSource(l,list)||l).name,
      state_rule:"Keep architecture fixed. Lighting, weather and temporary dressing may vary only in the requested unit/state.",
    }:undefined,
    place_identity:parent?undefined:fields(l),
    precedence:parent
      ? "continuity-root invariants -> child-space facts -> Slugline Unit/Time-of-Day Variant"
      : "place invariants -> Slugline Unit/Time-of-Day Variant",
  };
}
window.locationKeyOf=locationKeyOf;
window.locationParentOf=locationParentOf;
window.locationChildrenOf=locationChildrenOf;
window.locationScopeOf=locationScopeOf;
window.locationEffectiveSide=locationEffectiveSide;
window.locationIdentityLayers=locationIdentityLayers;

/* Derive SLUGLINE UNITS — the atomic filmable unit of a location: one
   (place, INT/EXT side, time-of-day bucket) triple, e.g. "Intake Yard · EXT · Night".
   A master location card groups everything at one PLACE (deriveLocations above);
   a slugline unit splits that place by side and light, because coverage for
   EXT·NIGHT is not coverage for INT·DAWN.
   Rules (agreed design):
   - recurring sluglines of the same triple — even twice inside one scene — share
     ONE unit; story progression ("dawn and raining", "racks now stripped") lives
     in a stored appearance-state overlay on the unit, NOT in derivation.
   - every non-INTERCUT scene-heading block opens a unit context; the blocks that
     follow belong to it until the next heading (INTERCUT / O.S. lines reference
     another space but don't move the camera — they keep the previous unit).
   - a heading with no real time of day (CONTINUOUS / SAME / LATER / untagged)
     inherits the bucket of the context it follows (else the scene's own slug time).
   Pure + deterministic: returns skeleton descriptors in first-appearance order.
   User edits / Time-of-Day Variant / generated images reconcile ON TOP by unit key. */
function deriveSluglineUnits(scenes, drafts){
  scenes = scenesInStoryOrder(scenes);
  const order = []; const byKey = {};
  /* character-name exclusion set for dressing candidates — screenplay convention
     capitalizes cast names in action prose, so every char cue (plus its
     individual words) is vetoed from the ALL-CAPS object extractor. */
  const charNames = {};
  (scenes||[]).forEach(sc=>{
    locationScreenplayBlocks(sc, drafts).forEach(b=>{
      if(b && b.type==="char" && b.text){
        const nm = String(b.text).replace(/\([^)]*\)/g," ").replace(/\s+/g," ").trim();
        if(!nm) return;
        charNames[nm.toLowerCase()] = true;
        nm.split(/ +/).forEach(w=>{ if(w.length>2) charNames[w.toLowerCase()] = true; });
      }
    });
  });
  const clockBucket = (txt)=>{
    const c = String(txt||"").match(/\b(\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i);
    return c ? clockToTimeOfDay(c[1]) : "";
  };
  const fmtBlocks = (blks)=> blks.map(b=>{
    const t = String(b&&b.text||"").replace(/\s+/g," ").trim(); if(!t) return "";
    if(b.type==="scene") return t.toUpperCase();
    if(b.type==="char") return "\n"+t.toUpperCase();
    if(b.type==="dia") return "  "+t;
    if(b.type==="paren") return "  ("+t.replace(/^\(|\)$/g,"")+")";
    return t;
  }).filter(Boolean).join("\n");
  const stripNum = (t)=> String(t||"").replace(/^\s*\d+[\.\)]?\s+/,"");
  (scenes||[]).forEach(sc=>{
    if(!sc) return;
    const blocks = locationScreenplayBlocks(sc, drafts);
    if(!blocks.length) return;
    // the scene's own slugline is the fallback context for leading non-heading
    // blocks and for headings that omit side/time.
    const prim = parseSlugline(sc.loc) || { intExt:"", place:"", time:"" };
    let lastBucket = (prim.time && normalizeTOD(prim.time)) || clockBucket(sc.loc) || "";
    let lastSide = prim.intExt || "";
    let cur = null, curOcc = null;
    const closeOcc = (idx)=>{ if(curOcc && curOcc.end==null) curOcc.end = idx; };
    /* Open a unit context for a heading. The unit keys on the FULL normalized place
       (area tails included — "Nebuchadnezzar · Core" and "· Training" are distinct
       filmable spaces); locationKey is the head-only master-card key deriveLocations
       uses, so units still group under the same master card. */
    const open = (slugText, idx, sourceKind)=>{
      const parsed = parseSlugline(slugText);
      if(!parsed) return;
      const primary = tidyPlace(splitCompoundPlace(parsed.place)[0]||"");
      if(!primary) return;
      const side = parsed.intExt || lastSide || "INT";
      const bucket = (parsed.time && normalizeTOD(parsed.time)) || clockBucket(slugText) || lastBucket;
      lastSide = side; if(bucket) lastBucket = bucket;
      const head = primary.split(/[\u00b7\u2014,]/)[0].trim();
      const key = locSlug(primary) + "|" + side + "|" + (bucket||"untimed");
      if(!byKey[key]){
        byKey[key] = {
          key, name: primary, place: primary,
          intExt: side, time: bucket || "",
          locationKey: locSlug(head).split("-").slice(0,4).join("-"),
          subspaceKey: locSlug(head).split("-").slice(0,4).join("-"),
          continuityRootKey: locSlug(head).split("-").slice(0,4).join("-"),
          scenes: [], sceneNos: [], sluglines: [], occurrences: [], scriptText: "",
          dressingDerived: [], sourceKinds:[],
        };
        order.push(key);
      }
      cur = byKey[key];
      const occurrenceOrdinal=cur.occurrences.filter(o=>String(o&&o.sceneId||"")===String(sc.id||"")).length+1;
      curOcc = { sceneId: sc.id, sceneNo: sc.no, slug: String(slugText||"").trim(),
        sourceKind:sourceKind||"slugline", occurrenceOrdinal, start: idx, end: null };
      cur.occurrences.push(curOcc);
      if(cur.scenes.indexOf(sc.id)<0) cur.scenes.push(sc.id);
      if(sc.no!=null && cur.sceneNos.indexOf(sc.no)<0) cur.sceneNos.push(sc.no);
      const raw = String(slugText||"").trim();
      if(raw && cur.sluglines.indexOf(raw)<0) cur.sluglines.push(raw);
      if(sourceKind && cur.sourceKinds.indexOf(sourceKind)<0) cur.sourceKinds.push(sourceKind);
    };
    let sawHeading = false, actionSinceHeading=0;
    blocks.forEach((b, idx)=>{
      /* EVERY heading line is a HARD boundary — even one that fails to parse.
         Closing the previous occurrence and opening nothing means its blocks own
         nothing until the next parseable heading, rather than silently bleeding
         into the previous unit. INTERCUT is tested after number-stripping so a
         numbered "12 INTERCUT WITH:" can't slip past the guard. */
      if(b && b.type==="scene" && b.text && !/^\s*INTERCUT\b/i.test(stripNum(b.text))){
        sawHeading = true;
        closeOcc(idx); cur = null; curOcc = null;
        open(b.text, idx,"slugline"); actionSinceHeading=0;
      } else if(!sawHeading && !cur){
        // leading prose before any heading (a draft with no heading blocks):
        // it still belongs SOMEWHERE — anchor it to the scene's own slugline.
        if(sc.loc){ open(sc.loc, 0,"slugline"); sawHeading = true; actionSinceHeading=0; }
      }
      if(b && b.type==="action"){
        const currentHeading=cur&&cur.sluglines&&cur.sluglines.length
          ?cur.sluglines[cur.sluglines.length-1]:sc.loc;
        const firstActionInSpace=actionSinceHeading===0;
        const inline=screenplayInlineSpaceHeading(b.text,currentHeading,firstActionInSpace);
        actionSinceHeading++;
        if(inline){
          const parsedInline=parseSlugline(inline);
          const inlineKey=parsedInline&&locSlug(parsedInline.place);
          const currentKey=cur&&locSlug(cur.place);
          if(inlineKey && inlineKey!==currentKey){
            closeOcc(idx); cur=null; curOcc=null;
            open(inline,idx,firstActionInSpace?"derived-establishing-action":"derived-inline-room-cue");
          }
        }
      }
    });
    closeOcc(blocks.length);
  });
  /* SUB-SPACE FOLD — a unit's own identity (place × side × bucket, and its stable
     overlay key) never changes, but its master-card grouping follows the complex
     it belongs to: the Intake Booth unit renders INSIDE the Intake Yard card
     instead of a booth card of its own. */
  const placeRecs = {};
  order.forEach(k=>{ const u = byKey[k];
    const pk = locSlug(u.place.split(/[\u00b7\u2014,]/)[0]).split("-").slice(0,4).join("-");
    if(!placeRecs[pk]) placeRecs[pk] = { key:pk, name:String(u.place).split(/[\u00b7\u2014]/)[0].trim(), scenes:[] };
    u.scenes.forEach(sid=>{ if(placeRecs[pk].scenes.indexOf(sid)<0) placeRecs[pk].scenes.push(sid); }); });
  const unitFold = foldSubspaceKeys(Object.values(placeRecs), scenes, drafts);
  order.forEach(k=>{ const u = byKey[k];
    const pk = locSlug(u.place.split(/[\u00b7\u2014,]/)[0]).split("-").slice(0,4).join("-");
    u.subspaceKey = pk;
    u.continuityRootKey = unitFold[pk] ? resolveFoldKey(unitFold,pk) : pk;
    u.locationKey = u.continuityRootKey; });
  order.forEach(k=>{
    const u = byKey[k];
    let txt = "", act = "";
    u.occurrences.forEach(occ=>{
      const sc = (scenes||[]).find(s=>s.id===occ.sceneId);
      const blocks = locationScreenplayBlocks(sc, drafts);
      const slice = blocks.slice(occ.start, occ.end==null ? blocks.length : occ.end);
      const piece = fmtBlocks(slice);
      occ.scriptText = piece.length>1400 ? piece.slice(0,1400).replace(/\s+\S*$/,"")+" …" : piece;
      if(piece) txt += (txt ? "\n\n" : "") + piece;
      // dressing candidates come from ACTION prose only — never dialogue/cues
      slice.forEach(b=>{ if(b && b.type==="action"){
        const t = String(b.text||"").replace(/\s+/g," ").trim();
        if(t) act += (act?" ":"")+t; } });
    });
    // generous but capped: this text rides image-gen prompts, not the saved doc
    u.scriptText = txt.length>3600 ? txt.slice(0,3600).replace(/\s+\S*$/,"")+" …" : txt;
    u.dressingDerived = deriveUnitDressing(act, charNames);
  });
  return order.map(k=>byKey[k]);
}
window.deriveSluglineUnits = deriveSluglineUnits;

/* RECONCILIATION — derived skeletons (fresh from the script) + persisted OVERLAYS
   (user data: Time-of-Day Variant, notes, generated image refs). The doc only ever
   stores the overlay array (key + user fields) — never skeleton fields — so script
   edits refresh the skeleton without orphaning user data, and the doc stays small.
   Merge rule: derived skeleton fields win; overlay fields ride on top.
   An overlay whose key is no longer derived (its slugline was edited away) comes
   back flagged orphan:true — its assets are PRESERVED until the user explicitly
   deletes the record (deleting a scene must never silently destroy paid images). */
function reconcileSluglineUnits(derived, overlays){
  const ov = {};
  (Array.isArray(overlays)?overlays:[]).forEach(o=>{ if(o && o.key) ov[o.key]=o; });
  const used = {};
  const merged = (Array.isArray(derived)?derived:[]).map(u=>{
    const o = ov[u.key] || null;
    if(o) used[o.key] = true;
    return {
      ...u,
      appearance: (o && o.appearance) || "",
      notes: (o && o.notes) || "",
      dressing: Array.isArray(o && o.dressing) ? o.dressing.slice() : [],
      setups: reconcileSceneSetupRecords(u.key,u.occurrences,o&&o.setups),
      images: Array.isArray(o && o.images) ? o.images : [],
      updatedAt: (o && o.updatedAt) || null,
    };
  });
  // orphans: rebuild a display-minimal skeleton from the key parts ("place|side|bucket").
  // Parse from the RIGHT so a corrupt/legacy key with extra "|" still yields a sane
  // side+bucket and keeps everything before them as the place.
  Object.keys(ov).sort().forEach(k=>{
    if(used[k]) return;
    const o = ov[k];
    const parts = String(k).split("|");
    const placeSlug = parts.length>2 ? parts.slice(0,-2).join("|") : (parts[0]||"");
    const name = placeSlug.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
    const side = parts.length>2 ? parts[parts.length-2] : "";
    const bucket = parts.length>2 ? parts[parts.length-1] : "";
    merged.push({
      key:k, name: name||k, place: name||k,
      intExt: side, time: (bucket && bucket!=="untimed") ? bucket : "",
      locationKey: placeSlug.split("-").slice(0,4).join("-"),
      subspaceKey: placeSlug.split("-").slice(0,4).join("-"),
      continuityRootKey: placeSlug.split("-").slice(0,4).join("-"),
      scenes: [], sceneNos: [], sluglines: [], occurrences: [], scriptText: "",
      appearance: o.appearance||"", notes: o.notes||"",
      dressing: Array.isArray(o.dressing) ? o.dressing.slice() : [],
      setups: reconcileSceneSetupRecords(k,[],o.setups),
      dressingDerived: [],
      images: Array.isArray(o.images) ? o.images : [], updatedAt: o.updatedAt||null,
      orphan: true,
    });
  });
  return merged;
}
window.reconcileSluglineUnits = reconcileSluglineUnits;

/* Upsert one overlay record by unit key. `patch` carries OVERLAY fields only
   (appearance / notes / images …) — never skeleton fields, which stay derived.
   A record emptied of every overlay field is dropped from the array, so a cleared
   appearance note doesn't leave dead weight in the doc. */
function upsertSluglineUnitOverlay(overlays, key, patch){
  const list = (Array.isArray(overlays)?overlays:[]).slice();
  const i = list.findIndex(o=>o && o.key===key);
  const next = { ...(i>=0?list[i]:{ key }), ...(patch||{}), key, updatedAt: Date.now() };
  // write-time normalization: trim, collapse whitespace, dedupe case-insensitively,
  // cap — so rapid clicks or legacy casing/spacing can never persist duplicates
  if(Array.isArray(next.dressing)){
    const seen = {}; const norm = [];
    next.dressing.forEach(x=>{ const v = String(x||"").replace(/\s+/g," ").trim();
      const k = v.toLowerCase(); if(v && !seen[k]){ seen[k]=true; norm.push(v); } });
    next.dressing = norm.slice(0,24);
  }
  if(Array.isArray(next.setups)){
    next.setups = next.setups.map(s=>{
      const seen={}, temporaryDressing=[];
      (Array.isArray(s&&s.temporaryDressing)?s.temporaryDressing:[]).forEach(x=>{
        const v=String(x||"").replace(/\s+/g," ").trim(), k=v.toLowerCase();
        if(v&&!seen[k]){seen[k]=true;temporaryDressing.push(v);}
      });
      return {...(s||{}),temporaryDressing:temporaryDressing.slice(0,24)};
    }).filter(s=>s&&s.id&&(
      s.temporaryDressing.length||String(s.blocking||"").trim()||String(s.handledProps||"").trim()
      ||String(s.objectStates||"").trim()||String(s.notes||"").trim()
    )).slice(0,64);
  }
  const empty = !String(next.appearance||"").trim() && !String(next.notes||"").trim()
    && !(Array.isArray(next.dressing) && next.dressing.length)
    && !(Array.isArray(next.setups) && next.setups.length)
    && !(Array.isArray(next.images) && next.images.length);
  if(empty){ if(i>=0) list.splice(i,1); return list; }
  if(i>=0) list[i]=next; else list.push(next);
  return list;
}
window.upsertSluglineUnitOverlay = upsertSluglineUnitOverlay;

/* stable, collision-safe image id for a slugline unit: readable slug prefix +
   short djb2 hash of the FULL key, so distinct keys that sanitize to the same
   slug (INT/EXT, separators, hyphens) never share an image slot/history. */
function sluglineUnitImageId(key){
  const slug = String(key||"").replace(/[^a-z0-9-]+/gi,"-").slice(0,48);
  let h = 5381; const s = String(key||"");
  for(let i=0;i<s.length;i++){ h = ((h<<5)+h+s.charCodeAt(i))>>>0; }
  return "locunit-"+slug+"-"+h.toString(36);
}
window.sluglineUnitImageId = sluglineUnitImageId;

/* Scene Setup identity follows screenplay occurrence ORDER inside one
   Slugline Unit + scene, never the mutable block offset. Inserting prose
   before an occurrence therefore cannot detach its saved setup. */
function screenplayOccurrenceKey(unitKey,occ,index,occurrences){
  const sceneId=String(occ&&occ.sceneId||"scene");
  let ordinal=Number(occ&&occ.occurrenceOrdinal);
  if(!(ordinal>0)){
    const list=Array.isArray(occurrences)?occurrences:[];
    const stop=Math.max(0,Number(index)||0);
    ordinal=1;
    for(let i=0;i<Math.min(stop,list.length);i++){
      if(String(list[i]&&list[i].sceneId||"scene")===sceneId) ordinal++;
    }
  }
  return String(unitKey||"space")+"@"+sceneId+"#"+ordinal;
}
/* Upgrade block-offset-era setup IDs in memory. Exact durable IDs win; older
   records then pair by sceneId (or their old `unit@scene:start` prefix) in
   occurrence order. Records that no longer have a screenplay occurrence stay
   visible as orphans, so no authored production work is silently discarded. */
function reconcileSceneSetupRecords(unitKey,occurrences,saved){
  const occs=Array.isArray(occurrences)?occurrences:[];
  const rows=(Array.isArray(saved)?saved:[]).filter(Boolean).map(x=>({...x}));
  const used=new Set(), out=[];
  occs.forEach((occ,index)=>{
    const id=screenplayOccurrenceKey(unitKey,occ,index,occs);
    let at=rows.findIndex((x,i)=>!used.has(i)&&String(x.id||"")===id);
    const sceneId=String(occ&&occ.sceneId||"");
    if(at<0){
      const legacyPrefix=String(unitKey||"space")+"@"+sceneId+":";
      at=rows.findIndex((x,i)=>!used.has(i)&&sceneId&&String(x.id||"").startsWith(legacyPrefix));
    }
    if(at<0) at=rows.findIndex((x,i)=>!used.has(i)&&sceneId&&String(x.sceneId||"")===sceneId);
    if(at<0) return;
    used.add(at);
    const storedId=String(rows[at].id||"");
    const originalStorageId=String(rows[at].storageId||storedId);
    const next={...rows[at],id,sceneId:occ.sceneId,sceneNo:occ.sceneNo,
      storageId:originalStorageId&&originalStorageId!==id?originalStorageId:undefined};
    delete next.orphan;
    out.push(next);
  });
  rows.forEach((x,index)=>{
    if(used.has(index)) return;
    out.push({...x,id:String(x.id||(
      String(unitKey||"space")+"@"+String(x.sceneId||"missing")+"#orphan-"+(index+1)
    )),orphan:true});
  });
  return out;
}
window.screenplayOccurrenceKey=screenplayOccurrenceKey;
window.reconcileSceneSetupRecords=reconcileSceneSetupRecords;

/* TIME-OF-DAY-VARIANT ASSET IDENTITY --------------------------------------
   Slugline Units own every addressed place/side/time unit. Time-of-Day
   Variants are narrower: they show only a genuine change from that space's first
   screenplay state (Night -> Dawn, weather, damage, temporary dressing, etc.)
   plus deliberately added manual states. When such a change corresponds to a
   Slugline Unit, both surfaces still share its durable asset id/history. */
function locationVariantSluglineUnit(l, v, units){
  const list = Array.isArray(units) ? units : (((window.turnContinuity||{}).sluglineUnits)||[]);
  const lkey = locationKeyOf(l);
  const candidates = list.filter(u=>u && !u.orphan
    && String(u.subspaceKey||u.locationKey||"")===lkey);
  const explicit = String(v&&v.unitKey||"");
  if(explicit){
    const hit = candidates.find(u=>String(u.key||"")===explicit);
    return hit||null;
  }
  // A deliberately authored Time-of-Day Variant is a distinct environment asset
  // unless the author explicitly binds it to a Slugline Unit. Matching only
  // by time/side would otherwise make two cards overwrite one image history.
  if(v&&v.manualState) return null;
  const time = normalizeTOD(v&&v.time) || titleCaseTime(v&&v.time);
  const side = String(v&&v.intExt||"").toUpperCase();
  const matches = candidates.filter(u=>{
    const ut = normalizeTOD(u.time) || titleCaseTime(u.time);
    return ut===time && (!side || String(u.intExt||"").toUpperCase()===side);
  });
  return matches.length===1 ? matches[0] : null;
}
function locationAppearanceStates(l, units){
  const list = Array.isArray(units) ? units : [];
  const lkey = locationKeyOf(l);
  const stateUnits = list.filter(u=>u && !u.orphan
    && String(u.subspaceKey||u.locationKey||"")===lkey);
  const variants = Array.isArray(l&&l.variants) ? l.variants : [];
  const used = new Set();
  const baseline=stateUnits[0]||null;
  // INT/EXT is geography, not an appearance change. A side change therefore
  // stays in Slugline Units; only time/environment deltas project here.
  const signature=u=>normalizeTOD(u&&u.time)||titleCaseTime(u&&u.time);
  const baselineSignature=signature(baseline);
  const rows = [];
  stateUnits.forEach((u,unitIndex)=>{
    // An explicit unitKey is an intentional binding, even for a manually added
    // state. Manual states without it remain separate assets (see resolver).
    let legacyIndex = variants.findIndex((v,i)=>!used.has(i)
      && String(v&&v.unitKey||"")===String(u.key||""));
    if(legacyIndex<0){
      const ut = normalizeTOD(u.time) || titleCaseTime(u.time);
      const hits=[];
      variants.forEach((v,i)=>{
        if(used.has(i)||v.manualState) return;
        const vt=normalizeTOD(v&&v.time)||titleCaseTime(v&&v.time);
        const side=String(v&&v.intExt||"").toUpperCase();
        if(vt===ut && (!side || side===String(u.intExt||"").toUpperCase())) hits.push(i);
      });
      if(hits.length===1) legacyIndex=hits[0];
    }
    const legacy = legacyIndex>=0 ? variants[legacyIndex] : null;
    if(legacyIndex>=0) used.add(legacyIndex);
    // Legacy unit notes and dressing describe the occurrence, so they migrate
    // to its first Scene Setup. Only an explicit environment description (or a
    // genuine time change below) creates a Time-of-Day Variant.
    const explicitChange=!!(String(u.appearance||"").trim()
      ||String(legacy&&legacy.state||"").trim());
    const changedUnit=unitIndex>0 && signature(u)!==baselineSignature;
    if(!explicitChange&&!changedUnit) return;
    rows.push({
      ...(legacy||{}),
      id:(legacy&&legacy.id)||("unit-state-"+sluglineUnitImageId(u.key).slice(-12)),
      unitKey:u.key,
      intExt:u.intExt,
      time:u.time,
      state:String(u.appearance||"").trim() || String(legacy&&legacy.state||""),
      linkedUnit:u,
      screenplayDerived:true,
    });
  });
  variants.forEach((v,i)=>{ if(!used.has(i)) rows.push({...v,linkedUnit:null,screenplayDerived:false}); });
  return rows;
}
function locationAppearanceStateAssetId(l, v, units){
  const u = (v&&v.linkedUnit) || locationVariantSluglineUnit(l,v,units);
  return u ? sluglineUnitImageId(u.key) : String((l&&l.id)||"location")+"-"+String((v&&v.id)||"state");
}
window.locationVariantSluglineUnit = locationVariantSluglineUnit;
window.locationAppearanceStates = locationAppearanceStates;
window.locationAppearanceStateAssetId = locationAppearanceStateAssetId;

/* LOCATION PRODUCTION LAYERS ----------------------------------------------
   These helpers keep the Art Room and Blender handoff on the same vocabulary.
   They are projections over the existing records, so older films and every
   generated plate keep their stable IDs and history. */
function screenplaySpaceSourceMeta(u){
  const kinds=new Set((u&&u.sourceKinds)||[]);
  const authored=kinds.has("slugline");
  const establishing=kinds.has("derived-establishing-action");
  const inline=kinds.has("derived-inline-room-cue");
  const legacy=kinds.has("inline-space");
  let label="Authored slugline",kind="authored";
  if(authored&&(establishing||inline||legacy)){label="Authored + derived";kind="mixed";}
  else if(establishing){label="Derived from establishing action";kind="derived-establishing";}
  else if(inline){label="Derived from inline room cue";kind="derived-inline";}
  else if(legacy){label="Derived from screenplay action";kind="derived-action";}
  return {kind,label,sourceKinds:Array.from(kinds)};
}
function locationSceneSetups(l,units){
  const lkey=locationKeyOf(l), rows=[];
  (Array.isArray(units)?units:[]).filter(u=>u&&String(u.subspaceKey||u.locationKey||"")===lkey)
    .forEach(u=>{
      const occurrences=Array.isArray(u.occurrences)&&u.occurrences.length?u.occurrences:[];
      const saved=reconcileSceneSetupRecords(u.key,occurrences,u.setups);
      occurrences.forEach((occ,index)=>{
        const id=screenplayOccurrenceKey(u.key,occ,index,occurrences);
        const setup=saved.find(x=>x&&x.id===id)||{};
        const sceneId=String(occ&&occ.sceneId||"");
        const occurrenceOrdinal=occurrences.slice(0,index+1)
          .filter(x=>String(x&&x.sceneId||"")===sceneId).length;
        const occurrenceCount=occurrences
          .filter(x=>String(x&&x.sceneId||"")===sceneId).length;
        // Old unit-level notes/dressing are surfaced on the first occurrence so
        // upgrading never hides a user's work. New edits are occurrence-scoped.
        const legacy=index===0&&!saved.some(x=>x&&!x.orphan);
        rows.push({
          id,unitKey:u.key,sceneId:occ.sceneId,sceneNo:occ.sceneNo,
          occurrenceOrdinal,occurrenceCount,
          spaceName:u.name||l&&l.name||"Location",intExt:u.intExt||"",time:u.time||"",
          sourceSlug:occ.slug||"",sourceKind:occ.sourceKind||"slugline",
          screenplayExcerpt:occ.scriptText||"",storageId:setup.storageId||setup.id||id,
          temporaryDressing:Array.isArray(setup.temporaryDressing)?setup.temporaryDressing.slice()
            :(legacy&&Array.isArray(u.dressing)?u.dressing.slice():[]),
          blocking:String(setup.blocking||""),handledProps:String(setup.handledProps||""),
          objectStates:String(setup.objectStates||""),notes:String(setup.notes||(legacy?u.notes:"")||""),
        });
      });
      saved.filter(x=>x&&x.orphan).forEach((setup,index)=>{
        rows.push({
          ...setup,id:setup.id,unitKey:u.key,sceneId:setup.sceneId||"",sceneNo:setup.sceneNo,
          spaceName:u.name||l&&l.name||"Location",intExt:u.intExt||"",time:u.time||"",
          sourceSlug:String(setup.sourceSlug||""),sourceKind:String(setup.sourceKind||"orphaned-setup"),
          screenplayExcerpt:String(setup.screenplayExcerpt||""),
          temporaryDressing:Array.isArray(setup.temporaryDressing)?setup.temporaryDressing.slice():[],
          blocking:String(setup.blocking||""),handledProps:String(setup.handledProps||""),
          objectStates:String(setup.objectStates||""),notes:String(setup.notes||""),orphan:true,
          orphanOrder:index+1,
        });
      });
    });
  return rows;
}
function locationCoverageViews(l){
  const stored=Array.isArray(l&&l.coverageViews)?l.coverageViews.filter(Boolean):[];
  if(!stored.length){
    const sig=l&&l.staging&&l.staging.layoutSig;
    const staging={...stagingOf(l||{}),...(sig?{layoutSig:String(sig)}:{})};
    return [{id:"principal",name:staging.viewLabel||((l&&l.name)||"Location")+" principal view",
      purpose:"Reusable establishing view",cameraPosition:"",target:"",visibleAnchors:"",
      lens:staging.lens||"",staging,legacy:true}];
  }
  return stored.map((v,index)=>{
    const raw=v.staging||(index===0&&l&&l.staging)||{};
    const staging=stagingOf({name:(l&&l.name)||"Location",staging:raw});
    const name=String(v.name||staging.viewLabel||("Coverage view "+(index+1)));
    return {...v,id:String(v.id||("view-"+(index+1))),name,
      purpose:String(v.purpose||""),cameraPosition:String(v.cameraPosition||""),
      target:String(v.target||""),visibleAnchors:String(v.visibleAnchors||""),
      lens:String(v.lens||staging.lens||""),
      // the layout it was drafted from survives grid edits (2026-10-12)
      staging:{...staging,viewLabel:name,lens:String(v.lens||staging.lens||""),...(raw.layoutSig?{layoutSig:String(raw.layoutSig)}:{})},legacy:false};
  });
}
function locationProductionPlan(l,units){
  const lkey=locationKeyOf(l);
  const spaces=(Array.isArray(units)?units:[]).filter(u=>u&&!u.orphan&&
    String(u.subspaceKey||u.locationKey||"")===lkey);
  const states=locationAppearanceStates(l,spaces);
  const bounded=(value,max)=>String(value||"").slice(0,max||1600);
  const canon=(value)=>({
    architecture:bounded(value&&value.architecture),materials:bounded(value&&value.materials),
    permanentLighting:bounded(value&&value.lighting),permanentDressing:bounded(value&&value.permanentDressing),
    topology:bounded(value&&value.topology),continuityAnchors:bounded(value&&value.continuityAnchors),
  });
  const parent=locationParentOf(l);
  return {
    schema:"cm-location-plan-v1",
    sharedSetLayout:locationSpatialContract(l),
    canonicalSet:canon(l),
    continuityRoot:parent?{id:parent.id||null,key:parent.key||null,name:bounded(parent.name,240),
      canonicalSet:canon(parent)}:undefined,
    screenplaySpaces:spaces.map(u=>({key:u.key,assetId:sluglineUnitImageId(u.key),name:u.name,intExt:u.intExt,time:u.time,
      source:screenplaySpaceSourceMeta(u),scenes:(u.sceneNos||[]).slice(),occurrences:(u.occurrences||[]).map((o,i)=>({
        id:screenplayOccurrenceKey(u.key,o,i,u.occurrences),sceneId:o.sceneId,sceneNo:o.sceneNo,
        sourceKind:o.sourceKind||"slugline",sourceSlug:String(o.slug||"").slice(0,240),
        screenplayExcerpt:String(o.scriptText||"").slice(0,720)}))})),
    appearanceStates:states.map(v=>({id:v.id,assetId:locationAppearanceStateAssetId(l,v,spaces),
      unitKey:v.unitKey||null,time:v.time||"",state:v.state||"",
      scenes:(v.linkedUnit&&v.linkedUnit.sceneNos||[]).slice()})),
    requiredSpacePlates:(Array.isArray(l&&l.coverageSheets)?l.coverageSheets:[]).map(v=>({
      id:v.id,assetId:String(l&&l.id||"location")+"-"+String(v.id||"plate"),name:v.name,
      role:v.role||"",scenes:(v.sceneNos||[]).slice(),summary:v.summary||""})),
    coverageViews:locationCoverageViews(l).map(v=>({id:v.id,name:v.name,purpose:v.purpose,
      cameraPosition:v.cameraPosition,target:v.target,visibleAnchors:v.visibleAnchors,lens:v.lens,staging:v.staging})),
    sceneSetups:locationSceneSetups(l,spaces).map(s=>({id:s.id,unitKey:s.unitKey,sceneId:s.sceneId,
      sceneNo:s.sceneNo,occurrenceOrdinal:s.occurrenceOrdinal,occurrenceCount:s.occurrenceCount,
      spaceName:s.spaceName,sourceKind:s.sourceKind,
      sourceSlug:String(s.sourceSlug||"").slice(0,240),screenplayExcerpt:String(s.screenplayExcerpt||"").slice(0,720),
      temporaryDressing:s.temporaryDressing,blocking:s.blocking,handledProps:s.handledProps,
      objectStates:s.objectStates,notes:s.notes,orphan:!!s.orphan})),
  };
}
window.screenplaySpaceSourceMeta=screenplaySpaceSourceMeta;
window.locationSceneSetups=locationSceneSetups;
window.locationCoverageViews=locationCoverageViews;
window.locationProductionPlan=locationProductionPlan;

/* LOCATION ASSET LINEAGE — derived plates stay pinned, but remember the exact
   upstream master/coverage versions they used so a later regeneration can mark
   them out of date without deleting approved pixels. ISO changes on every commit. */
function locationAssetDependencySnapshot(parentId, dependencyIds, kind, metaOf){
  const get = typeof metaOf==="function" ? metaOf
    : (id)=> (typeof nbGetMeta==="function" ? nbGetMeta(id) : null);
  const parent = get(parentId)||{};
  const upstream = (dependencyIds||[]).map(id=>{ const m=get(id)||{}; return m.iso ? {id,iso:m.iso} : null; }).filter(Boolean);
  return {
    locationDependencyKind:kind||"derived",
    locationParentId:parentId,
    locationParentIso:parent.iso||undefined,
    locationUpstream:upstream.length?upstream:undefined
  };
}
window.locationAssetDependencySnapshot = locationAssetDependencySnapshot;
function locationAssetDependencyChanges(meta, parentId, dependencyIds, metaOf){
  if(!meta) return [];
  const get = typeof metaOf==="function" ? metaOf
    : (id)=> (typeof nbGetMeta==="function" ? nbGetMeta(id) : null);
  const changed=[];
  const parentNow=get(parentId)||{};
  // No current ISO means there is no version evidence to compare. Once the
  // master is newly generated it gains an ISO, and legacy derived assets with
  // no recorded parent immediately become (correctly conservative) stale.
  if(parentNow.iso && meta.locationParentIso!==parentNow.iso)
    changed.push({id:parentId,kind:"parent"});
  const recorded={};
  (Array.isArray(meta.locationUpstream)?meta.locationUpstream:[]).forEach(r=>{ if(r&&r.id) recorded[r.id]=r.iso||""; });
  (dependencyIds||[]).forEach(id=>{ const now=get(id)||{};
    if(now.iso && recorded[id]!==now.iso) changed.push({id,kind:"upstream"}); });
  return changed;
}
window.locationAssetDependencyChanges = locationAssetDependencyChanges;
/* (2026-10-08, owner — Locations review) A PLATE MADE FROM A PARENT SAYS WHEN THE PARENT CHANGED: a room &
   time, state or extra-space plate (and a room's own plate) records the parent plate it was made from;
   "Parent plate changed" shows when that plate was regenerated since. Only a plate that RECORDED its
   parent is judged (older plates never flag at once), and only once the parent's details have loaded. */
function locationRootIds(l){
  try{ const owner = locationSpatialOwner(l); return (owner && owner.id && owner.id!==l.id) ? [owner.id] : []; }catch(e){ return []; }
}
function locationDerivedPlateChanged(meta, metaOf){
  if(!meta) return false;
  const get = typeof metaOf==="function" ? metaOf : (id)=> (typeof nbGetMeta==="function" ? nbGetMeta(id) : null);
  if(meta.locationParentId && meta.locationParentIso){
    const now = get(meta.locationParentId);
    if(now && now.iso && now.iso!==meta.locationParentIso) return true;
  }
  return (Array.isArray(meta.locationUpstream) ? meta.locationUpstream : []).some(r=>{
    if(!r || !r.id || !r.iso) return false;
    const now = get(r.id); return !!(now && now.iso && now.iso!==r.iso); });
}
/* the written spec a master plate is made from — recorded as meta.locSpecSig; "Description changed" shows
   when the card's text has changed since (only plates that recorded it) */
function locationSpecSig(l){
  const f = ["name","intExt","architecture","materials","lighting","permanentDressing","topology","continuityAnchors","significance","renderStyle","renderStyleKey","negativePrompt"];
  const str = f.map(k=>String((l&&l[k])||"").replace(/\s+/g," ").trim()).join("~");
  let h = 5381; for(let i=0;i<str.length;i++) h = ((h<<5)+h+str.charCodeAt(i))|0;
  return "ls1:"+(h>>>0).toString(36)+":"+str.length;
}
function locationSpecChanged(meta, l){
  return !!(meta && meta.locSpecSig && l && meta.locSpecSig!==locationSpecSig(l));
}
window.locationRootIds = locationRootIds;
window.locationDerivedPlateChanged = locationDerivedPlateChanged;
window.locationSpecSig = locationSpecSig;
window.locationSpecChanged = locationSpecChanged;

/* Master-plate spec identity is distinct from the exact model request:
   screenplay-reference instructions are appended at runtime and must not make a
   just-generated plate stale. Keep meta.prompt verbatim for provenance while
   storing/comparing this canonical written-spec prompt separately. */
function locationCanonicalSpecPrompt(mode, sentPrompt, currentSpecPrompt, priorMeta){
  const current=String(currentSpecPrompt||"");
  if(mode==="edit"){
    const prior=(priorMeta&&priorMeta.specPrompt)||(priorMeta&&priorMeta.prompt);
    return String(prior||current);
  }
  if(mode==="final"){
    const sent=String(sentPrompt||"");
    const marker=" REFERENCE IMAGES are attached:";
    const at=sent.indexOf(marker);
    return (at>=0?sent.slice(0,at):sent)||current;
  }
  // Photo/base/simple modes use a purpose-specific request prompt but still
  // represent the location spec currently visible on the card.
  return current;
}
window.locationCanonicalSpecPrompt = locationCanonicalSpecPrompt;
function locationSpecPromptStale(meta,currentSpecPrompt){
  if(!meta) return false;
  const stored=String(meta.specPrompt||meta.prompt||"");
  const current=String(currentSpecPrompt||"");
  if(!stored||!current||stored===current) return false;
  // Backward compatibility for plates generated before specPrompt existed:
  // their prompt is the canonical prompt followed by this known runtime suffix.
  return stored.indexOf(current+" REFERENCE IMAGES are attached:")!==0;
}
window.locationSpecPromptStale = locationSpecPromptStale;

/* SET-DRESSING candidates — deterministic extraction from the unit's OWN action
   prose (never dialogue, never sluglines): screenplay-convention ALL-CAPS object
   mentions plus a curated lexicon of physical set-dressing nouns. Pure derivation
   (skeleton-only): suggestions refresh with the script; the user's curated
   `dressing` list reconciles on top and is what prompts bind. */
const DRESS_LEXICON = ["rack","booth","desk","chair","table","bench","stool","lamp","sign","signage","poster","notice","monitor","screen","tv","television","phone","paper","file","folder","clipboard","cot","bunk","locker","shelf","shelves","cabinet","drawer","crate","box","barrel","drum","bin","dumpster","cart","trolley","truck","van","car","bus","forklift","scaffold","ladder","stair","stairs","railing","fence","gate","chain","wire","cable","pipe","vent","fan","speaker","camera","mirror","curtain","blind","blinds","rug","carpet","mattress","pillow","blanket","tarp","puddle","graffiti","rust","moss","vines","ivy","stain","helmet","vest","radio","key","keys","mug","bottle","can","ashtray","cigarette","candle","clock","calendar","flag","banner","whiteboard","chalkboard","bulletin","urn","kettle","fridge","stove","sink","toilet","shower","towel","bucket","mop","broom","hose","extinguisher","generator","cone","cones","barrier","barricade","turnstile","door","window","awning","billboard","neon","chandelier","bookshelf","book","books","magazine","newspaper","envelope","suitcase","backpack","duffel","umbrella","coat","jacket","boots","gloves","rope","toolbox","wrench","hammer","plank","plywood","sandbag","pallet","pallets"];
const DRESS_CAPS_STOP = new Set(["INT","EXT","EST","DAY","NIGHT","MORNING","EVENING","DAWN","DUSK","NOON","MIDNIGHT","LATER","CONTINUOUS","SAME","MOMENTS","AFTERNOON","TWILIGHT","OS","VO","OC","CU","INTERCUT","CUT","ANGLE","POV","CLOSE","WIDE","SUPER","TITLE","TITLES","END","FADE","IN","OUT","ON","OFF","BACK","TO","THE","AND","THEN","NEXT","OK","OKAY","SCENE","FLASHBACK","MONTAGE","SERIES","EVENTS","PRELAP","SMASH","MATCH","DISSOLVE","WIPE","INSERT","BEAT","NOTE","NOTES","OF"]);
function deriveUnitDressing(actionText, exclude){
  // ON-SCREEN WORDS are not set dressing: a readout or insert ("STATUS: REQUEST DENIED.",
  // "OPERATOR: CARROW, N.") is CAPS by convention and used to crowd the 12 slots with
  // "Request Denied", "Operator", a character's surname… (script.jsx strips the label and
  // the words it shows; spoken or direction labels are left alone)
  const text = (typeof window.screenplayStripScreenText==="function")
    ? window.screenplayStripScreenText(String(actionText||"")) : String(actionText||"");
  if(!text.trim()) return [];
  const out = []; const seen = {};
  const push = (raw)=>{
    const v = String(raw||"").replace(/\s+/g," ").trim().replace(/^[,;:.()\[\]"']+|[,;:.()\[\]"']+$/g,"");
    if(v.length<3 || v.length>40) return;
    const k = v.toLowerCase();
    if(seen[k]) return;
    seen[k] = true; out.push(v);
  };
  // 1) screenplay-convention ALL-CAPS object mentions ("the RACKS shudder") —
  //    but never character names: the same convention capitalizes cast names in
  //    action, so `exclude` (char cues from the scene blocks) vetoes them.
  const capsRe = /\b[A-Z][A-Z0-9'&-]{1,}(?: +[A-Z0-9'&-]{2,}){0,2}\b/g;
  let m; while((m = capsRe.exec(text))){
    const words = m[0].trim().split(/ +/);
    const meaningful = words.filter(w=>!DRESS_CAPS_STOP.has(w.replace(/[.,;:]/g,"")));
    if(!meaningful.length) continue;
    if(exclude){
      if(exclude[m[0].trim().toLowerCase()]) continue;
      if(meaningful.every(w=>exclude[w.replace(/[.,;:]/g,"").toLowerCase()])) continue;
    }
    push(m[0].toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()));
  }
  // 2) lexicon nouns in sentence-case prose ("rain pools around the intake racks")
  const lexRe = new RegExp("\\b("+DRESS_LEXICON.join("|")+")s?\\b","gi");
  while((m = lexRe.exec(text))) push(m[0]);
  return out.slice(0,12);
}
window.deriveUnitDressing = deriveUnitDressing;

function locationSceneText(scene, drafts){
  const bits = [scene&&scene.loc, scene&&scene.title, scene&&scene.summary, scene&&scene.objective, (scene&&_locTurn(scene))];
  const d = drafts && scene && drafts[scene.id];
  if(d && Array.isArray(d.blocks)) d.blocks.forEach(b=>{ if(b && b.text) bits.push(b.text); });
  return bits.filter(Boolean).join(" ").replace(/\s+/g," ").trim();
}
function locationSceneScriptText(scene, drafts){
  if(!scene) return "";
  const d = drafts && drafts[scene.id];
  if(d && Array.isArray(d.blocks) && d.blocks.length){
    return d.blocks.map(b=>{
      const t = String(b&&b.text||"").replace(/\s+/g," ").trim(); if(!t) return "";
      if(b.type==="scene") return t.toUpperCase();
      if(b.type==="char") return "\n"+t.toUpperCase();
      if(b.type==="dia") return "  "+t;
      if(b.type==="paren") return "  ("+t.replace(/^\(|\)$/g,"")+")";
      return t;
    }).filter(Boolean).join("\n");
  }
  return [scene.loc, scene.summary, scene.objective, _locTurn(scene)].filter(Boolean).join("\n");
}
function locationScriptExcerpt(scene, drafts, index, radius){
  const txt = locationSceneScriptText(scene, drafts).replace(/\s+/g," ").trim();
  if(!txt) return "";
  const r = radius || 420;
  const at = Math.max(0, Math.min(Number(index)||0, txt.length));
  const start = Math.max(0, at-r);
  const end = Math.min(txt.length, at+r);
  return (start>0?"... ":"") + txt.slice(start,end).trim() + (end<txt.length?" ...":"");
}
function locationScreenplayContext(l, scenes, drafts, limit){
  const locScenes = (Array.isArray(l&&l.scenes) && l.scenes.length)
    ? (scenes||[]).filter(s=>l.scenes.indexOf(s.id)>=0)
    : (scenes||[]);
  const chunks = locScenes.map(s=>locationSceneScriptText(s, drafts)).filter(Boolean);
  const text = chunks.join("\n\n").replace(/\n{3,}/g,"\n\n").trim();
  const max = limit || 2600;
  return text.length>max ? text.slice(0,max).replace(/\s+\S*$/,"").trim()+" ..." : text;
}
window.locationSceneScriptText = locationSceneScriptText;
window.locationScreenplayContext = locationScreenplayContext;
function locationSceneForCoverageSheet(l, sheet, scenes){
  const nos = Array.isArray(sheet&&sheet.sceneNos) ? sheet.sceneNos.map(Number).filter(Number.isFinite) : [];
  const list = scenes||[];
  if(nos.length){
    const byNo = list.find(s=>nos.indexOf(Number(s.no))>=0);
    if(byNo) return byNo;
  }
  const sid = l && Array.isArray(l.scenes) && l.scenes[0];
  return list.find(s=>s.id===sid) || list[0] || null;
}
function locationScreenplayBlocks(scene, drafts){
  if(!scene) return [];
  const d = drafts && drafts[scene.id];
  if(d && Array.isArray(d.blocks) && d.blocks.length) return d.blocks.map(b=>({ ...b }));
  const out = [];
  if(scene.loc) out.push({ type:"scene", text:scene.loc });
  if(scene.summary) out.push({ type:"action", text:scene.summary });
  if(scene.objective) out.push({ type:"action", text:scene.objective });
  if(_locTurn(scene)) out.push({ type:"action", text:_locTurn(scene) });
  return out;
}
function locationScreenplayReferenceImages(l, sheet, scenes, drafts, options){
  const renderOpts = options || {};
  if(typeof document==="undefined") return [];
  const selectedSceneId = renderOpts.sceneId != null ? renderOpts.sceneId : renderOpts.selectedSceneId;
  const scene = renderOpts.scene || ((selectedSceneId != null)
    ? (scenes||[]).find(s=>s && String(s.id)===String(selectedSceneId)) : null)
    || locationSceneForCoverageSheet(l, sheet, scenes);
  const blocks = locationScreenplayBlocks(scene, drafts);
  if(!blocks.length) return [];
  const W = 1000, H = 1294, padX = 78, padTop = 62, padBottom = 64, lineH = 20;
  const font = "15px Courier New, monospace";
  const boldFont = "700 15px Courier New, monospace";
  const targetBeatValue = renderOpts.targetBeat == null ? renderOpts.highlightBeat : renderOpts.targetBeat;
  const targetBeat = targetBeatValue == null ? null : Number(targetBeatValue);
  const lineUnits = (b)=>{
    const type = String(b&&b.type||"action");
    const text = String(b&&b.text||"").replace(/\s+/g," ").trim();
    if(!text) return [];
    const target = targetBeat != null && Number.isFinite(targetBeat)
      && Number(b&&b.beat)===targetBeat;
    const cfg = type==="char" ? { x:378, w:220, bold:true, upper:true, before:12, after:0 }
      : type==="dia" ? { x:250, w:390, before:0, after:10 }
      : type==="paren" ? { x:305, w:310, before:0, after:0 }
      : type==="trans" ? { x:650, w:230, upper:true, before:10, after:10 }
      : type==="scene" ? { x:padX, w:760, bold:true, upper:true, before:8, after:12 }
      : { x:padX, w:760, before:8, after:12 };
    const sample = document.createElement("canvas").getContext("2d");
    sample.font = cfg.bold ? boldFont : font;
    const words = (cfg.upper ? text.toUpperCase() : text).split(/\s+/);
    const lines = []; let line = "";
    words.forEach(w=>{
      const t = line ? line+" "+w : w;
      if(sample.measureText(t).width > cfg.w && line){ lines.push(line); line = w; }
      else line = t;
    });
    if(line) lines.push(line);
    return [{ blank:cfg.before }, ...lines.map(s=>({ text:s, ...cfg, target })), { blank:cfg.after }];
  };
  const units = [];
  const slug = blocks.find(b=>b.type==="scene");
  if(slug && !String(slug.text||"").match(/^\s*\d+\s+/) && scene && scene.no!=null)
    units.push(...lineUnits({ type:"scene", text:String(scene.no)+"  "+slug.text }));
  blocks.forEach(b=>{ if(slug && b===slug) return; units.push(...lineUnits(b)); });
  const pages = [];
  let page = [], y = padTop;
  const pushPage = ()=>{ if(page.length){ pages.push(page); page = []; y = padTop; } };
  units.forEach(u=>{
    const h = u.blank!=null ? Number(u.blank)||0 : lineH;
    if(y + h > H - padBottom){ pushPage(); }
    page.push(u); y += h;
  });
  pushPage();
  const sceneNo = scene&&scene.no!=null ? scene.no : "";
  const contextLabel = renderOpts.contextLabel || renderOpts.label;
  const title = (contextLabel ? String(contextLabel)+" — " : "")
    +"SCENE "+sceneNo+" - "+(((scene&&scene.title)||((l&&l.name)||"LOCATION"))).toUpperCase();
  const pageLimit = renderOpts.pageLimit == null ? 6
    : Math.max(0,Number(renderOpts.pageLimit)||0);
  const imgs = pages.slice(0,pageLimit).map((items,pi)=>{
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d"); if(!ctx) return "";
    ctx.fillStyle = "#f4f0e6"; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#151515"; ctx.font = boldFont;
    ctx.fillText(title.slice(0,86), padX, 42);
    ctx.fillText(String(pi+1), W-padX-8, 42);
    if(targetBeat != null && Number.isFinite(targetBeat)){
      ctx.fillStyle = "#76621f"; ctx.font = "700 11px Courier New, monospace";
      ctx.fillText(String(renderOpts.targetLabel||"TARGET BEAT OPENING")+" — BEAT "+targetBeat, padX, 57);
    }
    let cy = padTop;
    items.forEach(u=>{
      if(u.blank!=null){ cy += Number(u.blank)||0; return; }
      if(u.target){
        ctx.fillStyle = "#ead58b";
        ctx.fillRect(padX-16, cy-lineH+3, W-padX*2+16, lineH+4);
      }
      ctx.font = u.bold ? boldFont : font;
      ctx.fillStyle = "#151515";
      ctx.fillText(u.text, u.x, cy);
      cy += lineH;
    });
    ctx.fillStyle = "#8a8177"; ctx.font = "12px Courier New, monospace";
    ctx.fillText((contextLabel ? String(contextLabel)+" — " : "")
      +"FULL SCENE SCREENPLAY SNAPSHOT - WRITERS' ROOM TEXT", padX, H-34);
    ctx.fillText("PAGE "+(pi+1)+" OF "+pages.length, W-padX-92, H-34);
    try{ return canvas.toDataURL("image/png"); }catch(e){ return ""; }
  }).filter(Boolean);
  if(renderOpts.returnMeta) return {
    images:imgs, pageCount:pages.length, renderedPageCount:imgs.length,
    omittedPages:Math.max(0,pages.length-imgs.length), targetBeat,
    sceneId:scene&&scene.id||"", pageLimit
  };
  return imgs;
}
function locationScreenplayReferenceImage(l, sheet, scenes, drafts){
  const imgs = locationScreenplayReferenceImages(l, sheet, scenes, drafts);
  return imgs[0] || "";
}
window.locationSceneForCoverageSheet = locationSceneForCoverageSheet;
window.locationScreenplayReferenceImages = locationScreenplayReferenceImages;
window.locationScreenplayReferenceImage = locationScreenplayReferenceImage;
function locationMasterPanelPlan(l, scenes, drafts){
  const sheets = (typeof deriveLocationCoverageSheets==="function") ? deriveLocationCoverageSheets(l, scenes||[], drafts||{}) : [];
  /* Slugline units supersede legacy side coverage sheets, so sheets alone can no
     longer tell us whether the master location spans INT + EXT. Read the current
     screenplay units too: they are the source of truth for explicitly slugged
     spaces and preserve the scene-specific TOD separately from this neutral master. */
  const units = (typeof deriveSluglineUnits==="function")
    ? deriveSluglineUnits(scenes||[], drafts||{}).filter(u=>u && String(u.locationKey||"")===String(l.key||""))
    : [];
  const roles = sheets.map(s=>String(s.role||"").toUpperCase())
    .concat(units.map(u=>String(u.intExt||"").toUpperCase()));
  const mixed = roles.indexOf("INT")>=0 && roles.indexOf("EXT")>=0;
  if(!mixed) return null;
  const ordered = units.length ? units : sheets;
  const firstRole = String((ordered[0]&&(ordered[0].intExt||ordered[0].role))||"EXT").toUpperCase();
  const extName = (units.find(u=>String(u.intExt).toUpperCase()==="EXT")
    || sheets.find(s=>String(s.role).toUpperCase()==="EXT")||{}).name || ((l&&l.name)||"Location")+" Exterior";
  const intName = (units.find(u=>String(u.intExt).toUpperCase()==="INT")
    || sheets.find(s=>String(s.role).toUpperCase()==="INT")||{}).name || ((l&&l.name)||"Location")+" Interior";
  const threshold = "the visible threshold/sightline relationship between "+extName+" and "+intName+" — windows, glass, doors, booth walls, openings, approach path and eyeline geometry must line up";
  if(firstRole==="INT") return {
    layout: "exactly 4 views in a 2x2 grid, planned from the screenplay's first playable space",
    top_left: "INTERIOR establishing view of "+intName+" because the action starts inside — show the empty working room, floor, walls, openings and usable blocking space",
    top_right: "INTERIOR key action station from the screenplay — desk/terminal/counter/work surface or the practical area where the first business plays",
    bottom_left: "EXTERIOR context of "+extName+" seen from the connected approach or through the relevant opening, matching the interior's sightlines",
    bottom_right: "THRESHOLD CONNECTION view: "+threshold,
    rule: "the four panels are one coherent real location with matched scale, materials, light direction and geography; no actors, no action, no text",
  };
  return {
    layout: "exactly 4 views in a 2x2 grid, planned from the screenplay's first playable space",
    top_left: "EXTERIOR wide establishing view of "+extName+" because the scene opens outside — show the whole playable geography, approach, ground plane and permanent major landmarks in neutral continuity conditions",
    top_right: "EXTERIOR-to-INTERIOR relationship view: "+threshold,
    bottom_left: "INTERIOR establishing view of "+intName+" — the empty room/subspace the script later plays inside, with working surfaces and openings",
    bottom_right: "key close/detail from the screenplay that proves the location can stage the action: terminal, desk, counter, rack, window/glass, doorway or other named functional feature",
    rule: "the four panels are one coherent real location with matched scale, materials, light direction and geography; no actors, no action, no text",
  };
}
window.locationMasterPanelPlan = locationMasterPanelPlan;
function _locSheetId(role, name){
  const k = locSlug(name).split("-").slice(0,4).join("-") || role.toLowerCase();
  return "cov-"+role.toLowerCase()+"-"+k;
}
function _locSideCueIndex(text, role){
  const s = String(text||"");
  const re = role==="INT"
    ? /\b(inside|interior|within|booth|room|office|building|kiosk|cab|cabin|car|vehicle|lobby|hall|shop|store|terminal|control room|desk|counter|console|lamp)\b/i
    : /\b(outside|exterior|facade|front|street|yard|parking|rain|pavement|road|approach|rack|racks)\b/i;
  const i = s.search(re);
  return i>=0 ? i : 999999;
}
function deriveLocationCoverageSheets(l, scenes, drafts, allLocations, units){
  if(!l) return [];
  /* Child spaces already have a canonical child plate plus one shared plate per
     screenplay/Time-of-Day Variant. They must not derive a second Coverage View —
     especially a misleading "Kitchen Exterior" that is really the enclosing
     house facade. Cross-subspace geography and exterior context belong to the
     continuity root. Implied, unslugged spaces may still become Coverage Views
     on that root below. */
  if(l.parentKey) return [];
  /* A sub-space sheet is a STAND-IN for a space the screenplay never slugged. Once that
     space earns a real slugline it gets its own location card, plate and coverage — and
     deriving a sheet for it too would mean designing the same booth twice, from two
     records that can drift apart. Skip any sub-space that is now a location. */
  const _allLocs = Array.isArray(allLocations) ? allLocations
    : (((window.turnContinuity||{}).locations) || []);
  const _units = units || ((window.turnContinuity||{}).sluglineUnits) || [];
  const _isRealLocation = (nm)=>{
    const n = String(nm||"").trim().toLowerCase();
    if(!n) return false;
    return _allLocs.some(x=> x && x.id!==l.id && String(x.name||"").trim().toLowerCase()===n)
      /* a slugged child space has its own inherited workspace and unit, so a
         stand-in coverage sheet must not be derived for it as well. */
      || _units.some(u=> u && !u.orphan && String(u.place||u.name||"").trim().toLowerCase()===n);
  };
  const clean = (s,n)=>{ const x=String(s||"").replace(/\s+/g," ").trim();
    return (typeof clipWords==="function") ? clipWords(x,n||180) : x.slice(0,n||180); };
  const locScenes = (Array.isArray(l.scenes) && l.scenes.length)
    ? (scenes||[]).filter(s=>l.scenes.indexOf(s.id)>=0)
    : (scenes||[]);
  const sceneTexts = locScenes.map((s,i)=>{
    const script = locationSceneScriptText(s, drafts);
    const bodyScan = locationScreenplayBlocks(s, drafts).filter(b=>b&&b.type!=="scene").map(b=>b.text).join(" ").replace(/\s+/g," ").trim();
    const prose = locationSceneText(s, drafts);
    return { scene:s, i, text:prose, script, bodyScan, scan:script || prose };
  });
  const text = sceneTexts.map(s=>s.scan).join(" ").replace(/\s+/g," ").trim();
  if(!text) return [];
  const baseName = l.name || "Location";
  const out = [];
  const add = (role, name, summary, triggers, order, scene, scriptExcerpt)=>{
    const id = _locSheetId(role, name);
    const sceneNo = scene && scene.no;
    const existing = out.find(v=>v.id===id);
    if(existing){
      if(Number(order)<Number(existing.order||999999)) existing.order = order;
      if(scriptExcerpt && !existing.scriptExcerpt) existing.scriptExcerpt = clean(scriptExcerpt,720);
      if(sceneNo!=null && existing.sceneNos.indexOf(sceneNo)<0) existing.sceneNos.push(sceneNo);
      return;
    }
    out.push({ id, role, name:clean(name,64), summary:clean(summary,260), order:Number(order)||0,
      sceneNos: sceneNo!=null ? [sceneNo] : [],
      scriptExcerpt: clean(scriptExcerpt,720),
      triggerWords:Array.from(new Set((triggers||[]).map(x=>String(x||"").toLowerCase()).filter(Boolean))).slice(0,10),
      fromScript:true });
  };
  const intExt = String(l.intExt||"").toUpperCase();
  const mentionsSubspace = /\b(?:inside|within|in)\s+(?:the\s+|a\s+|an\s+)?[A-Za-z0-9'’ -]{2,44}?\b(?:booth|room|office|building|kiosk|cab|cabin|car|vehicle|lobby|hall|shop|store|terminal|control room|desk|counter)\b/i.test(text)
    || (/\bbooth\b/i.test(text) && /\b(?:glass|window|terminal|desk|counter|keyboard|monitor|console|lamp)\b/i.test(text));
  const mixedSides = intExt==="INT/EXT" || (/(^|\/)INT(\/|$)/.test(intExt) && /(^|\/)EXT(\/|$)/.test(intExt)) || mentionsSubspace;
  sceneTexts.forEach(entry=>{
    const s = entry.scene;
    const baseOrder = entry.i * 100000;
    const parsed = parseSlugline(s&&s.loc);
    const sceneRole = String(parsed&&parsed.intExt||intExt).toUpperCase();
    const body = entry.bodyScan || entry.scan || "";
    const firstInt = _locSideCueIndex(body, "INT");
    const firstExt = _locSideCueIndex(body, "EXT");
    const cueOrder = (role)=>{
      const own = role==="INT" ? firstInt : firstExt;
      const other = role==="INT" ? firstExt : firstInt;
      if(own<999999) return baseOrder + own + 1;
      // A slugline side still needs a sheet, but if the first playable action cues
      // the opposite side, let that opposite side lead the list.
      if(other<999999) return baseOrder + other + 2;
      return baseOrder + (role==="EXT" ? 0 : 1);
    };
    /* UNITS TAKE PRECEDENCE: a slugline unit already covers this master+side as a
       real SLUGGED space (with its own time bucket and Time-of-Day Variant) — deriving
       an INT/EXT side sheet for it too would design the same side twice from two
       records that can drift apart. Sheets remain for IMPLIED, unslugged spaces. */
    const _unitCovers = (role)=> _units.some(x=> x && !x.orphan
      && (l.parentKey ? String(x.subspaceKey||"")===String(l.key||"") : String(x.locationKey||"")===String(l.key||""))
      && String(x.intExt||"").toUpperCase()===role);
    if(mixedSides && /EXT/.test(sceneRole) && !_unitCovers("EXT")){
      add("EXT", baseName+" Exterior",
        "Exterior side required by the screenplay: render the empty outside of "+baseName+" with its approach, openings, weather, ground plane and sightline toward any interior side named by the scene.",
        ["outside","exterior","facade","front","street","yard","rain","window","glass"],
        cueOrder("EXT"), s, locationScriptExcerpt(s, drafts, firstExt<999999?firstExt:0));
    }
    if(mixedSides && /INT/.test(sceneRole) && !_unitCovers("INT")){
      add("INT", baseName+" Interior",
        "Interior side required by the screenplay: render the empty inside of "+baseName+" with the working areas, fixtures, openings and sightlines the scene plays through.",
        ["inside","interior","room","booth","window","glass","terminal","desk","counter"],
        cueOrder("INT"), s, locationScriptExcerpt(s, drafts, firstInt<999999?firstInt:0));
    }
    const insideM = entry.scan.match(/\b(?:inside|within|in)\s+(?:the\s+|a\s+|an\s+)?([A-Za-z0-9'’ -]{2,44}?\b(?:booth|room|office|building|kiosk|cab|cabin|car|vehicle|lobby|hall|shop|store|terminal|control room|desk|counter))\b/i);
    const throughGlass = /\b(?:through|behind|inside|beyond)\s+(?:the\s+)?(?:glass|window|windshield|door|booth glass)\b/i.test(entry.scan);
    const boothish = /\bbooth\b/i.test(entry.scan);
    const terminalish = /\bterminal|desk|counter|keyboard|monitor|console|lamp\b/i.test(entry.scan);
    if((/EXT/.test(sceneRole) || /EXT/.test(intExt)) && (insideM || (boothish && (throughGlass || terminalish)))){
      const hitIndex = insideM ? insideM.index : Math.max(0, entry.scan.search(/\bbooth\b/i));
      /* the capture's {2,44} minimum pulls the ARTICLE in with the noun ("inside the
         booth" captures "the booth"), which produced sheets named "Intake The Booth" —
         wrong on the card, and it stopped the real-location check below from matching. */
      const sub = (insideM ? tidyPlace(insideM[1]) : (boothish ? "Booth" : "Interior"))
        .replace(/^(?:The|A|An)\s+/i, "").trim();
      const name = /intake/i.test(baseName) && !/intake/i.test(sub) ? ("Intake "+sub) : sub;
      // it has its own card now — don't design it twice (gate ONLY this add: a `return`
      // here would also skip the exterior-cue sheet later in this same iteration)
      if(!_isRealLocation(name)) add("INT", name+" Interior",
        "Interior coverage required by the screenplay even if the prose only names the space: action plays inside "+name+" while the parent scene is staged from "+baseName+". Infer the empty interior from the screenplay page, the parent exterior, working surfaces, glass/window relationship, controls and sightline to the exterior.",
        ["inside","interior","booth","glass","window","terminal","desk","counter","console"],
        baseOrder + hitIndex + 1, s, locationScriptExcerpt(s, drafts, hitIndex));
    }
    const exteriorCueIdx = entry.scan.search(/\b(?:outside|exterior|facade|front|street|yard|parking|through\s+(?:the\s+)?window|through\s+(?:the\s+)?glass)\b/i);
    /* unit precedence applies here too: a slugged EXT unit already covers this
       master's exterior — the cue (often just the place name echoed inside the
       scene's own slugline) must not duplicate it as a stand-in sheet. */
    if(/INT/.test(sceneRole) && exteriorCueIdx>=0 && !_unitCovers("EXT")){
      add("EXT", baseName+" Exterior",
        "Exterior coverage required by the screenplay: the scene looks out from the interior or cuts to the outside of this place. Render the empty exterior/facade, approach, openings and sightline back toward the interior.",
        ["outside","exterior","facade","front","street","yard","window","glass"],
        baseOrder + exteriorCueIdx + 1, s, locationScriptExcerpt(s, drafts, exteriorCueIdx));
    }
  });
  return out.sort((a,b)=>(Number(a.order||0)-Number(b.order||0)) || String(a.name).localeCompare(String(b.name)));
}
window.locationSceneText = locationSceneText;
window.deriveLocationCoverageSheets = deriveLocationCoverageSheets;

/* IMPLIED ENCLOSED SPACES — the shared detector.
   A scene often plays partly inside a space the page never slugs ("Behind the booth
   glass, ODESSA…", "Inside the booth, Odessa kills the lamp"). That space is a real set
   — its own walls, light and geography — but because locations DERIVE FROM SLUGLINES it
   gets no card, no plate and no coverage. The fix belongs in the screenplay: slug it.
   Deterministic on purpose — the Script Supervisor that consumes this is the FREE tier
   and makes no model calls — and shared so the Writers' Room and the Art Room can never
   disagree about what counts as an implied space.
   Returns [{ name, role, time, evidence, atIndex, noun }], atIndex = the FIRST block that
   plays inside, i.e. where the slugline belongs. Spaces already slugged are excluded. */
const IMPLIED_SPACE_NOUNS = ("booth|cab|cabin|car|van|truck|trailer|container|cockpit|control room|kiosk|cell|closet|"+
  "vault|elevator|lift|wheelhouse|confessional|airlock|hayloft|shed|tent|garage|basement|attic|kitchen|bathroom|"+
  "stairwell|corridor|tunnel|cage|pen|stall|pod|capsule|carriage|compartment|galley|berth|office|room|hall|lobby|"+
  "shop|store|booth window|ticket window|guard house|guardhouse|cupboard|pantry|cellar");
function findImpliedSpaces(scene, blocks){
  const out = [];
  if(!scene || !Array.isArray(blocks) || !blocks.length) return out;
  const parent = (typeof parseSlugline==="function") ? parseSlugline(scene.loc) : { place:String(scene.loc||""), time:"", intExt:"INT" };
  const parentPlace = String((parent&&parent.place)||"").toUpperCase();
  const time = (parent && parent.time) || "";
  // every place ALREADY slugged in this scene (parent + any secondary slugline)
  const slugged = new Set([parentPlace]);
  blocks.forEach(b=>{ if(b && b.type==="scene" && b.text){
    const p = (typeof parseSlugline==="function") ? parseSlugline(b.text) : null;
    if(p && p.place) slugged.add(String(p.place).toUpperCase());
  }});
  const NOUN = IMPLIED_SPACE_NOUNS;
  const reInside = new RegExp("\\b(?:inside|within)\\s+(?:the\\s+|a\\s+|an\\s+)?([a-z0-9'\u2019 -]{0,26}?\\b(?:"+NOUN+"))\\b","i");
  const reBehind = new RegExp("\\bbehind\\s+the\\s+([a-z0-9'\u2019 -]{0,26}?\\b(?:"+NOUN+"))\\s+(?:glass|window|screen|door|counter)\\b","i");
  const seen = new Set();
  blocks.forEach((b, i)=>{
    if(!b || b.type!=="action" || !b.text) return;
    const t = String(b.text);
    const m = reInside.exec(t) || reBehind.exec(t);
    if(!m) return;
    let noun = String(m[1]||"").replace(/\s+/g," ").trim();
    if(!noun) return;
    // a BARE generic noun ("booth") reads better qualified by its parent place
    // ("INTAKE BOOTH") — but never double it up when the modifier is already there
    let name = noun.toUpperCase();
    const bare = noun.split(/\s+/).length===1;
    const parentHead = parentPlace.split(/\s+/)[0] || "";
    if(bare && parentHead && name.indexOf(parentHead)<0 && parentHead.length>2) name = parentHead+" "+name;
    if(slugged.has(name) || seen.has(name)) return;
    seen.add(name);
    out.push({ name, role:"INT", time, noun,
      evidence: t.replace(/\s+/g," ").trim().slice(0,180), atIndex:i });
  });
  return out;
}
function impliedSpaceSlugline(sp){
  return "INT. "+String((sp&&sp.name)||"INTERIOR").toUpperCase()+((sp&&sp.time)?(" - "+String(sp.time).toUpperCase()):"");
}
window.IMPLIED_SPACE_NOUNS = IMPLIED_SPACE_NOUNS;
window.findImpliedSpaces = findImpliedSpaces;
window.impliedSpaceSlugline = impliedSpaceSlugline;

/* true when the screenplay has any parseable scene-heading anchor we can pull into
   the tab. Implied side spaces still hang off those anchors as coverage sheets. */
function scriptHasLocations(scenes){ return (scenes||[]).some(s=> !!parseSlugline(s.loc)); }
window.scriptHasLocations = scriptHasLocations;

function locVisualDefaults(l){
  const livingNeg = (typeof locationCharacterNegative==="function") ? locationCharacterNegative(null, l) : "people, characters, animals, creatures, wildlife, insects";
  const styleSource=locationRenderStyleSource(l);
  return {
    renderStyle: styleSource.renderStyle
      || ((typeof window.renderStyleText==="function") ? window.renderStyleText("loc", styleSource.renderStyleKey) : "")
      || "photoreal cinematic establishing photography, wide lens, natural depth, sharp focus",
    negativePrompt: (l && l.negativePrompt) || (livingNeg+", watermark, logo, distorted perspective, warped architecture, low resolution, blurry, cgi look, fisheye"),
  };
}
window.locVisualDefaults = locVisualDefaults;

const LOCATION_AMBIENT_SPECIES = [
  { key:"moth", label:"moths", aliases:["moth","moths"], charRe:/\b(moth|lepidopteran)\b/i },
  { key:"firefly", label:"fireflies", aliases:["firefly","fireflies","glowworm","glowworms"], charRe:/\b(firefly|lampyrid|glowworm)\b/i },
  { key:"frog", label:"frogs", aliases:["frog","frogs","toad","toads"], charRe:/\b(frog|toad|anuran)\b/i },
  { key:"spider", label:"spiders", aliases:["spider","spiders","arachnid","arachnids"], charRe:/\b(spider|arachnid)\b/i },
  { key:"beetle", label:"beetles", aliases:["beetle","beetles"], charRe:/\b(beetle|coleopteran)\b/i },
  { key:"bird", label:"birds", aliases:["bird","birds"], charRe:/\b(bird|avian)\b/i },
];
function locationAmbientSpecies(l){
  const clean = (x)=>String(x||"").replace(/\s+/g," ").trim();
  const text = [l&&l.name, l&&l.architecture, l&&l.materials, l&&l.lighting, l&&l.significance].map(clean).join(" ").toLowerCase();
  if(!text) return [];
  const groupish = /\b(swarm|colony|hive|nest|roost|flock|school|shoal|cloud|cluster|congregation|migration|mass|horde|rookery)\b/i.test(text);
  return LOCATION_AMBIENT_SPECIES.filter(sp=>{
    const hit = sp.aliases.some(a=>new RegExp("\\b"+a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","i").test(text));
    const inName = sp.aliases.some(a=>new RegExp("\\b"+a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","i").test(String(l&&l.name||"")));
    return hit && (groupish || inName);
  });
}
function ambientSpeciesCharacterGuidance(species){
  const C = window.turnContinuity || {};
  const chars = (C.characters||[]).filter(c=>{
    const blob = [c&&c.name,c&&c.role,c&&c.ethnicity,c&&c.build,c&&c.hair,c&&c.skin,c&&c.eyes,c&&c.texture,c&&c.materialTexture,c&&c.look].filter(Boolean).join(" ");
    return species.charRe.test(blob);
  }).slice(0,3);
  if(!chars.length) return "";
  return chars.map(c=>{
    const scale = (typeof canonicalScaleLabel==="function") ? canonicalScaleLabel(c) : (c.name||"related character");
    const cues0 = [c.skin,c.hair,c.eyes,c.materialTexture,c.texture,c.build].filter(Boolean).join("; ").replace(/\s+/g," ");
    const cues = (typeof clipWords==="function") ? clipWords(cues0, 220) : cues0.slice(0,220);
    return "Broad species canon may echo "+(c.name||"the related character")+" ("+scale+(cues?("; "+cues):"")+
      "), but anonymous background "+species.label+" must NOT copy that named character's exact face, costume, pendant, unique markings, pose or hero silhouette.";
  }).join(" ");
}
function ambientSpeciesSourceCharacters(species){
  const C = window.turnContinuity || {};
  return (C.characters||[]).filter(c=>{
    const blob = [
      c&&c.name, c&&c.role, c&&c.ethnicity, c&&c.build, c&&c.hair,
      c&&c.skin, c&&c.eyes, c&&c.texture, c&&c.materialTexture,
      c&&c.look, c&&c.rationale, c&&c.scaleClass
    ].filter(Boolean).join(" ");
    return species.charRe.test(blob);
  }).slice(0,3);
}
function speciesCanonCue(c){
  const clean = (x,n)=>{ const s=String(x||"").replace(/\s+/g," ").trim();
    return (typeof clipWords==="function") ? clipWords(s, n||160) : s.slice(0,n||160); };
  const scale = (typeof canonicalScaleLabel==="function") ? canonicalScaleLabel(c) : clean(c&&c.scaleClass,80);
  const height = (typeof scaleMeasurementOf==="function") ? scaleMeasurementOf(c) : clean(c&&c.height,40);
  const traits = [
    c&&c.ethnicity ? ("taxonomy/world read: "+clean(c.ethnicity,120)) : "",
    c&&c.build ? ("body language: "+clean(c.build,160)) : "",
    c&&c.skin ? ("surface/palette: "+clean(c.skin,160)) : "",
    c&&c.hair ? ("antennae/hair/crest: "+clean(c.hair,140)) : "",
    c&&c.eyes ? ("eye/glow family: "+clean(c.eyes,120)) : "",
    c&&c.materialTexture ? ("material texture: "+clean(c.materialTexture,160)) : "",
    c&&c.texture ? ("texture: "+clean(c.texture,160)) : "",
  ].filter(Boolean);
  return {
    source_character: clean(c&&c.name,80) || "related character",
    source_scale: [scale, height].filter(Boolean).join(" · ") || undefined,
    broad_species_traits: traits.length ? traits.join("; ") : undefined,
  };
}
function locationSpeciesCanon(l){
  return locationAmbientSpecies(l).map(species=>{
    const sources = ambientSpeciesSourceCharacters(species).map(speciesCanonCue);
    return {
      species: species.label,
      source: sources.length ? sources : "no matching named character found; use only the location's own species wording",
      allowed_use: "anonymous background population / environmental extras only",
      may_echo: "broad taxonomy, scale class, size logic, palette family, wing/skin/fur/chitin/material language, and non-unique glow behaviour",
      must_vary: "individuals should differ in pose, markings, proportions and grouping so they read as a population, not copies",
      never_copy: "no named-character face, no unique costume/accessory/pendant, no exact markings, no hero silhouette, no foreground performance, no character portrait",
      staging: "keep the species as set dressing at environmental scale unless a later shot explicitly introduces the named character from its own character sheet",
    };
  }).filter(Boolean);
}
function locationSpeciesCanonText(l){
  const canon = locationSpeciesCanon(l);
  if(!canon.length) return "";
  return "AMBIENT SPECIES CANON: "+canon.map(c=>{
    const src = Array.isArray(c.source)
      ? c.source.map(s=>[s.source_character, s.source_scale, s.broad_species_traits].filter(Boolean).join(" — ")).join(" | ")
      : c.source;
    return c.species+": "+src+". "+c.allowed_use+". May echo "+c.may_echo+". Must vary: "+c.must_vary+". Never copy: "+c.never_copy+".";
  }).join(" ");
}
function locationNoCharactersRules(project, l){
  const C = window.turnContinuity || {};
  const names = (C.characters||[]).map(c=>String(c&&c.name||"").trim()).filter(Boolean).slice(0,12);
  const named = names.length ? (" Do not depict any cast member by name: "+names.join(", ")+".") : "";
  const ambient = locationAmbientSpecies(l);
  const ambientRule = ambient.length
    ? "Anonymous ambient "+ambient.map(s=>s.label).join(" / ")+" may appear ONLY because this location explicitly calls for them: treat them as environmental extras/set dressing at the location's scale, repeated small background forms or silhouettes, never hero figures. Follow the ambient_species_canon / AMBIENT SPECIES CANON block when present. "+ambient.map(ambientSpeciesCharacterGuidance).filter(Boolean).join(" ")
    : "No animals, no creatures, no wildlife, no insects, no frogs, no fireflies, no moths, no visible living bodies.";
  return [
    "EMPTY SET ONLY: this is a location reference plate, not a story shot.",
    "No people, no named characters, no actors, no cast members, no readable character faces, no expressive eyes, no hero bodies, no foreground character silhouettes.",
    ambientRule,
    "Bioluminescence is allowed as environmental glow, reflections, haze or light traces; if ambient species are allowed, their glow must stay anonymous and environmental, not character-identifying.",
    "Show traces of habitation only as empty environmental set dressing, tracks, scale cues, surfaces, props or light; the actual characters will be added later from character sheets during shot generation."+named
  ];
}
function locationCharacterNegative(project, l){
  const C = window.turnContinuity || {};
  const names = (C.characters||[]).map(c=>String(c&&c.name||"").trim()).filter(Boolean);
  const ambient = locationAmbientSpecies(l);
  const allowed = new Set(ambient.flatMap(s=>s.aliases.map(a=>a.toLowerCase())));
  const genericLiving = ambient.length ? [] : ["animals","creatures","wildlife","insects"];
  const speciesTerms = ["moths","moth","fireflies","firefly","flies","bugs","frogs","frog","toads","toad","birds","bird","spiders","spider","beetles","beetle"].filter(x=>!allowed.has(x));
  const base = ["people","characters","actors","cast","crowds","faces","eyes","bodies","foreground silhouettes","hero creature","character portrait"].concat(genericLiving, speciesTerms);
  return Array.from(new Set(base.concat(names))).join(", ");
}
window.locationNoCharactersRules = locationNoCharactersRules;
window.locationCharacterNegative = locationCharacterNegative;
window.locationAmbientSpecies = locationAmbientSpecies;
window.locationSpeciesCanon = locationSpeciesCanon;
window.locationSpeciesCanonText = locationSpeciesCanonText;

/* Render-style text per key — location cards use the SAME dropdown options as the cast
   (window.CHAR_RENDER_STYLE_OPTIONS, incl. "Surprise me ✨"); picking a concrete key
   writes this place-tuned recipe into l.renderStyle, which the plate builder feeds into
   render.style. "surprise" is AI-invented per location (aiSurpriseStyleText). */
const LOC_RENDER_TEXT = {
  photoreal: "photoreal cinematic establishing photography, wide lens, natural depth, sharp focus, realistic light",
  graphicNovelNoir: "high-contrast black-and-white graphic-novel environment, bold ink shadows and screentone midtones, hard single-source noir light, deep pooled blacks, strictly monochrome",
  ukiyoe: "ukiyo-e woodblock landscape print, flat mineral-pigment colour planes, calligraphic keyblock outlines, bokashi sky gradation, washi paper texture, Edo-period palette, no Western light-and-shadow modelling",
  paperCutout: "layered paper cut-out environment, flat scissor-cut paper shapes stacked in shallow physical depth layers, real drop shadows between layers, visible paper grain, handmade collage charm",
  photorealNatural: "natural-history macro habitat photography, real biological scale cues, believable tiny-world anatomy context, skin/fur/scales/chitin-compatible environment detail, moisture, realistic light, minimal stylization",
  photorealCreature: "cinematic photoreal creature-film environment, practical/VFX set realism, believable creature-shop material world, realistic depth, controlled live-action lighting",
  photorealOrnamental: "photoreal ornamental creature-world environment, couture/ceremonial/jewelry-like production design, iridescent and armor-like materials, premium cinematic studio realism",
  render3d:  "stylized 3D environment render, cinematic lighting, physically-based materials, atmospheric depth",
  anime:     "anime background art, painterly cel-shaded environment, clean linework, soft gradient skies, no photoreal texture",
  flat:      "flat vector landscape, bold geometric shapes, minimal flat shading, limited palette, no photoreal texture",
  horror:    "low-key cinematic horror cinematography of the place, hard cold side light, deep atmospheric blacks, fog and haze, colour left neutral (the scene's look grades it)",
  ghibli:    "soft hand-painted Studio Ghibli-style 2D background, fine warm linework, gentle painterly cel shading, warm earthy naturalistic palette, nostalgic light",
  animated3d:"polished animated-feature 3D environment render, soft warm global illumination, appealing clean PBR materials, idealized finish, no noise",
  pixar:     "Pixar-style animated-feature 3D environment, soft warm global illumination, appealing rounded stylized forms, clean tactile PBR materials, 'every frame a painting' warmth, idealized charming finish, no noise",
  storyboardconcept:"clean storyboard / production concept environment, expressive linework, clear cinematic staging, restrained color wash, readable layout and mood",
  texturedcomic:"textured contemporary comic-art environment, bold ink contours, etched hatching, limited palette, dramatic graphic light, visible grain",
  gtaLoadingScreen:"open-world crime-game loading-screen poster environment, semi-realistic architecture with bold black ink outlines, hard cel-shaded light and shadow, saturated high-contrast colour that follows this plate's own time of day, glossy poster finish, no text or logos",
  whimsicalwatercolor:"whimsical watercolor and fine-ink environment, transparent washes, paper grain, delicate hand-drawn line, soft storybook charm",
  stopmotion:"photograph of a real handmade miniature stop-motion set, felt/wood/clay at tiny scale, soft practical studio light, faint tilt-shift miniature depth",
  claymation:"photograph of a real plasticine claymation miniature set, rounded clay forms with tool marks, soft practical light, faint tilt-shift miniature depth",
  adv1960s:  "1960s painted commercial illustration of the place, airbrushed gouache, vintage halftone print texture, mid-century mustard/avocado/teal palette",
  gaganime:  "1990s gag-anime 2D cartoon background, thick bold black outlines, flat high-saturation colors, simple graphic shapes, sticker-like finish",
  pixelart:  "retro 16/32-bit pixel-art environment, hard square pixels, no anti-aliasing, limited indexed palette, dithered skies and shadows, crisp pixel grid",
};
Object.assign(LOC_RENDER_TEXT, {
  modernAnime:"modern cinematic anime background art, clean sharp linework, polished cel shadows, vibrant contemporary colour and dramatic sky/light",
  digitalAnime:"polished digital anime environment illustration, smooth refined rendering, luminous colour, clean linework, atmospheric finish",
  roughSketchAnime:"rough sketch anime environment concept, visible pencil/ink strokes, flat colour, light hatching, immediate layout energy",
  painterlyAnime:"painterly anime environment, delicate line, soft blended brushwork, dreamy atmospheric colour wash",
  cartoon3d:"stylized 3D cartoon environment render, bold readable forms, clean animated-feature lighting, rounded appeal",
  textured3dCartoon:"textured 3D cartoon environment, felt/clay/fabric/fuzzy tactile surfaces, soft studio/miniature lighting",
  stylizedCartoon:"stylized cartoon environment illustration, bold outlines, flat colour areas, theatrical graphic shape design",
  grittyDigital:"gritty digital illustration environment, expressive linework, harsh light, textured shadows, moody high contrast",
  softPainterly:"soft painterly environment illustration, visible brushstrokes, blended colour, warm handmade atmosphere",
  realisticDigitalDrawing:"realistic digital drawing environment, believable light, detailed surface texture, illustrated not photographic",
  flatDesign:"flat design environment illustration, simplified geometric shapes, bold colour, minimal shading",
  minimalistLine:"minimalist line-art environment, sparse elegant contour, warm paper, abundant negative space, one small accent colour",
  vintageChildrensBook:"vintage children’s book environment illustration, loose ink outline, limited spot colour, aged paper print texture",
  tactileMixedMedia:"tactile mixed-media environment, handmade fabric/felt/paper/paint/sculpted miniature set, photographed craft",
  texturedPaperSculpture:"textured paper sculpture environment, folded layered paper, visible fibres, photographed tabletop diorama",
  texturedPaperIllustration:"textured paper illustration environment, collage layers, stippled print grain, cut-paper edges",
  tropicalArtNouveau:"tropical Art Nouveau environment, flowing organic lines, lush botanical motifs, flat ornamental colour",
});
window.LOC_RENDER_TEXT = LOC_RENDER_TEXT;

function locVisualsDrafted(l){ return !!((l.architecture||"").trim() && (l.lighting||"").trim()); }
window.locVisualsDrafted = locVisualsDrafted;

/* ---- DEPTH-GRID STAGING ----------------------------------------------------
   A location's canonical staging: a 3×3 depth grid (rows BG/MID/FG × cols L/C/R)
   plus Floor, Scale Class and Camera/Lens. Each cell is OPTIONAL — an empty cell
   means "open space" (so linear/open locations aren't forced into a box). Named
   landmark roles, per your spec:
     bg.center = Wall A (primary backdrop landmark)
     mid.left  = Wall B (primary framing element)
     mid.right = Wall C (secondary framing element)
     mid.center= the SUBJECT position (where a character stands) — usually left blank
     fg.left/fg.right = L1 / R1 foreground veils; fg.center = camera (implicit)
   Shots will later inherit this and vary it. */
function emptyStaging(){
  return { viewLabel:"", scaleClass:"", lens:"",
    bg:{ left:"", center:"", right:"" },
    mid:{ left:"", center:"", right:"" },
    fg:{ left:"", right:"" },
    floor:"" };
}
window.emptyStaging = emptyStaging;
function stagingOf(l){
  const s = (l && l.staging) || {};
  const e = emptyStaging();
  return { viewLabel:s.viewLabel||((l&&l.name)?((l.name||"")+" principal view"):""), scaleClass:s.scaleClass||"", lens:s.lens||"",
    bg:{...e.bg, ...(s.bg||{})}, mid:{...e.mid, ...(s.mid||{})}, fg:{...e.fg, ...(s.fg||{})},
    floor:s.floor||"" };
}
window.stagingOf = stagingOf;
/* true when the staging has at least one filled cell (worth showing / prompting) */
function stagingHasContent(l){
  const s = stagingOf(l);
  return !!(s.scaleClass||s.lens||s.floor||s.bg.left||s.bg.center||s.bg.right
    ||s.mid.left||s.mid.center||s.mid.right||s.fg.left||s.fg.right);
}
window.stagingHasContent = stagingHasContent;



/* every DISTINCT Style Bible preset the location's scenes use, in scene order.
   Informational only: a location can span scenes with different grades, so we show
   them all rather than collapsing to one. The reference plate itself stays
   grade-neutral — the grade is applied downstream at the shot. */
function locScenePresets(l, project){
  if(typeof scenePreset!=="function") return [];
  const out = []; const seen = new Set();
  for(const sid of (l.scenes||[])){ const p = scenePreset(project, sid); if(p && !seen.has(p.id)){ seen.add(p.id); out.push(p); } }
  return out;
}
window.locScenePresets = locScenePresets;

/* The effective SCALE CLASS of a location's WORLD is derived from the characters who
   DRIVE the scenes set here (a critter film's drivers are all Class B, so the place
   renders at critter scale). This is intentionally automatic: a stale project-wide
   override from an older save must not silently change newly generated locations. */
function locationScaleClass(l, project){
  if(typeof scaleClassOf!=="function") return "A";
  const C = window.turnContinuity || {};
  const chars = C.characters || [], scenes = C.scenes || [];
  if(!chars.length || !scenes.length) return "A";
  const byId = {}; chars.forEach(c=>{ if(c&&c.id) byId[c.id]=c; });
  const sids = Array.isArray(l && l.scenes) ? l.scenes : [];
  const counts = { A:0, B:0, C:0, D:0 };
  sids.forEach(sid=>{ const sc=scenes.find(s=>s.id===sid); const drv=sc&&sc.driver&&byId[sc.driver]; if(drv) counts[scaleClassOf(drv)]++; });
  const nonA = [["B",counts.B],["C",counts.C],["D",counts.D]].filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  return nonA.length ? nonA[0][0] : "A";
}
window.locationScaleClass = locationScaleClass;

/* deterministic LOCATION coverage plate — full view of the place from several
   angles on one grid, so any shot set here matches geometry, materials & light.
   The plate stays grade-neutral (each shot applies its scene's look); `opts.time` specialises a variant. */
function buildLocationRefPrompt(l, project, opts){
  opts = opts || {};
  const P = project || (window.TURN_DATA||{}).PROJECT || {};
  const _C0 = window.turnContinuity || {};
  const v = locVisualDefaults(l);
  const arch = (l.architecture||"").replace(/\.$/,"").trim();
  const materials = (l.materials||"").replace(/\.$/,"").trim();
  const lighting = (l.lighting||"").replace(/\.$/,"").trim();
  const significance = (l.significance||"").replace(/\.$/,"").trim();
  const period = P.setting && P.setting.period ? P.setting.period.split(/[\u2014,]/)[0].trim() : "";
  const tone = [P.genre, period].filter(Boolean).join(", ");
  const locKey=locationKeyOf(l);
  const relevantUnits=(_C0.sluglineUnits||[]).filter(u=>u&&!u.orphan&&
    (String(u.subspaceKey||u.locationKey||"")===locKey || (!l.parentKey&&String(u.locationKey||"")===locKey)));
  const intExt=locationEffectiveSide(l,relevantUnits,l.coverageSheets||[],locationChildrenOf(l,_C0.locations||[]));
  const identityLayers=locationIdentityLayers(l,_C0.locations||[]);
  /* The parent plate is canonical geography across the whole film. Never inherit
     the first scene's TOD: NIGHT/rain and DAWN are Time-of-Day Variants on their
     respective Slugline Unit plates, not properties of the master space. */
  const time = opts.time || "";

  /* JSON environment spec (the director's template as a key:value spec, 2026-06):
     EXACTLY 4 views in a 2\u00d72 grid \u2014 wide establishing front, high-angle three-quarter
     overview, two close-ups of the key stations \u2014 no text baked in. The depth grid's
     landmarks fill `fixtures`; ownerless set dressing LINKED to this location (the
     fixture-of relationship: explicit locationId, or every mapped scene resolves here)
     renders as `environment_props`, so abandoned objects & furniture live in the plate.
     Owned or multi-location objects are NEVER baked in \u2014 they travel with people.
     Stays GRADE-NEUTRAL: the scene's Style Bible grade applies downstream at the shot. */
  const st = stagingOf(l);
  const clean = (x)=>String(x||"").replace(/\.$/,"").trim();
  const fixtures = [];
  if(clean(st.bg.center)) fixtures.push({ what: clean(st.bg.center), position: "center background \u2014 the primary landmark" });
    if(clean(st.mid.left))  fixtures.push({ what: clean(st.mid.left),  position: "screen-left in the principal camera view only; not a room-space coordinate" });
    if(clean(st.mid.right)) fixtures.push({ what: clean(st.mid.right), position: "screen-right in the principal camera view only; not a room-space coordinate" });
  if(clean(st.fg.left))   fixtures.push({ what: clean(st.fg.left),   position: "near foreground left" });
  if(clean(st.fg.right))  fixtures.push({ what: clean(st.fg.right),  position: "near foreground right" });
  const mainStation = clean(st.bg.center) || "the space's primary, most story-relevant feature";
  const secondStation = clean(st.mid.left) || clean(st.mid.right) || clean(st.fg.left) || clean(st.fg.right) || "a signature material detail of the space";
  const screenplayContext = (typeof locationScreenplayContext==="function") ? locationScreenplayContext(l, _C0.scenes||[], _C0.drafts||{}, 2600) : "";
  const panelPlan = (typeof locationMasterPanelPlan==="function") ? locationMasterPanelPlan(l, _C0.scenes||[], _C0.drafts||{}) : null;
  const envProps = locationEnvironmentProps(l).map(p=>({
    name: p.name,
    description: [clean(p.form), clean(p.material)].filter(Boolean).join("; ") || undefined,
    // real-world measurement — the plate must render the object at its true physical
    // size relative to the space (the shot scale system reuses the same number)
    physical_size: clean(p.size) || undefined,
  }));
  /* THE SCRIPT USES THIS SPACE FOR — functional AFFORDANCES aggregated across every
     scene the script sets here (user ruling 2026-07-18): the plate must provide the
     working positions and clearances the beats rely on (a till position on the
     counter, queue room to the door, an operable shutter) WITHOUT staging any
     action, people, or ephemeral state — the plate stays canonical for the whole
     film. Deterministic: a lexicon scan over this location's scenes' summaries and
     script text, plus a capacity ceiling from cast presence. */
  const _AFFORD = [
    [/\btill\b|cash register/i, "a working service counter with a clear till position"],
    [/\bqueue|queuing|queueing\b/i, "open queueing room between the service point and the entrance"],
    [/\bshutter/i, "the entrance's roller shutter readable from inside the space"],
    [/\bdoor(way)?\b|entrance/i, "an unobstructed entrance / doorway sightline"],
    [/\bwindow/i, "windows that read from inside the space"],
    [/\bshel(f|ves)/i, "stocked shelving runs with aisle clearance"],
    [/\bstairs?\b/i, "a stair connection"],
    [/\bphone box|telephone|payphone\b/i, "a phone position"],
    [/\bcounter\b/i, "a service counter with working room behind it"],
  ];
  const _C = window.turnContinuity || {};
  const _locScenes = (Array.isArray(l.scenes) && l.scenes.length && Array.isArray(_C.scenes))
    ? _C.scenes.filter(sc=> l.scenes.indexOf(sc.id)>=0) : [];
  let _affordances = [], _capacity = 0;
  if(_locScenes.length){
    const _txt = _locScenes.map(sc=> [sc.summary, sc.objective, _locTurn(sc),
      (typeof sceneScriptText==="function" && _C.drafts) ? sceneScriptText(sc.id, _C.drafts) : ""
    ].filter(Boolean).join(" ")).join(" ");
    _AFFORD.forEach(af=>{ if(af[0].test(_txt) && _affordances.indexOf(af[1])<0) _affordances.push(af[1]); });
    _affordances = _affordances.slice(0,5);
    if(_C.drafts && Array.isArray(_C.characters) && typeof scenesWhereCharacterAppears==="function"){
      _locScenes.forEach(sc=>{ let n=0;
        _C.characters.forEach(ch=>{ try{ if(scenesWhereCharacterAppears(ch.id, ch.name, [sc], _C.drafts).length) n++; }catch(e){} });
        if(n>_capacity) _capacity=n; });
    }
  }
  const speciesCanon = (typeof locationSpeciesCanon==="function") ? locationSpeciesCanon(l) : [];
  const emptySetRules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, l) : ["no people","no characters","no animals"];
  const spec = {
    task: "professional environment reference sheet \u2014 ONE single real space rendered from 4 angles",
    location: {
      name: l.name||"Location",
      scope: identityLayers.scope,
      type: intExt==="INT/EXT" ? "interior + exterior continuity" : (intExt==="EXT" ? "exterior" : "interior"),
      identity_layers: identityLayers,
      space: arch || undefined,
      walls_surfaces_palette: materials || undefined,
      floor_ground_plane: clean(st.floor) || undefined,
      permanent_lighting_interfaces: lighting || undefined,
      permanent_dressing: clean(l.permanentDressing) || undefined,
      spatial_topology: clean(l.topology) || undefined,
      continuity_anchors: clean(l.continuityAnchors) ? {
        status:l.anchorsLocked===false?"editable":"LOCKED / binding",
        rules:clean(l.continuityAnchors),
      }:undefined,
      time_of_day: time ? time.toLowerCase() : undefined,
      scale: clean(st.scaleClass) || undefined,
      reads_as: significance || undefined,
      script_requirements: (_affordances.length || _capacity>1) ? {
        note: "aggregated from every scene the script sets here — the space must AFFORD these working positions and clearances (present or clearly implied) while staging NO action, NO people and NO temporary state",
        affordances: _affordances.length ? _affordances : undefined,
        capacity: _capacity>1 ? ("the space must comfortably hold up to "+_capacity+" people at once when scenes play") : undefined,
      } : undefined,
      screenplay_context: screenplayContext || undefined,
      screenplay_reference_contract: {
        purpose: "all attached screenplay pages jointly describe permanent geography, architecture, fixtures, sightlines and action affordances for this ONE location",
        not_a_panel_map: "do NOT assign one screenplay page or one scene to each quadrant; the four quadrants are four camera views chosen by the views plan below",
        continuity_rule: "aggregate only features that must persist across scenes; do NOT bake scene-specific time of day, active practical-light state, weather, temporary dressing, damage or story progression into this neutral master plate",
        unit_examples: "NIGHT/rain and DAWN belong in Slugline Units or Time-of-Day Variants when the screenplay calls for them",
      },
      tone: tone || undefined,
    },
    fixtures: fixtures.length ? fixtures : undefined,
    fixture_projection_rule:"These depth-grid fixtures describe ONLY the principal camera view. The shared set layout takes precedence over this legacy composition. Other panels project the same fixed objects from new cameras; do not restage or duplicate them.",
    environment_props: envProps.length ? envProps : undefined,
    ambient_species_canon: speciesCanon.length ? speciesCanon : undefined,
    views: {
      ...(panelPlan || {
        layout: "exactly 4 views in a 2x2 grid",
        top_left: "wide establishing front shot at eye level with symmetrical centered composition",
        top_right: "high-angle three-quarter overview shot from an elevated corner perspective looking down into the space showing depth and spatial layout",
        bottom_left: "close-up of "+mainStation,
        bottom_right: "close-up of "+secondStation,
        rule: "each view a distinctly different camera angle and composition \u2014 the SAME identical space, consistent architecture, scale, materials and light across all views",
      }),
    },
    render: {
      style: v.renderStyle.replace(/\.$/,""),
      /* quality rules must AGREE with the picked style: pushing "photorealistic /
         hyper realistic" under a stylized style (cartoon, anime, Pixar…) contradicts
         the style line and the model resolves toward photoreal — the plate then drags
         every downstream shot off-style. Photoreal wording only for photoreal-family
         picks; style-faithful quality rules otherwise. */
      rules: emptySetRules.concat(
        ["no text, no labels, no typography, no captions, no watermarks"],
        /^(photoreal|horror)/.test(String(locationRenderStyleSource(l).renderStyleKey||"photoreal"))
          ? ["photorealistic commercial photography","8k ultra detailed","consistent lighting across all views","clean layout","hyper realistic"]
          : ["render every view strictly in the ONE render style named above — do not drift into any other style",
             "high-resolution, clean crisp detail in that style","consistent lighting and style across all views","clean layout"]),
    },
  };
  // WORLD SCALE — when this place is inhabited by a non-human-scale cast (critter / giant),
  // render the SPACE ITSELF at that scale (gigantism / miniaturization), so a bug's-world
  // location doesn't default to a human-scale room. Inert (Class A) for ordinary films.
  const _wcls = (typeof locationScaleClass==="function") ? locationScaleClass(l, P) : "A";
  const _wclause = (typeof worldScaleClause==="function") ? worldScaleClause(_wcls) : "";
  if(_wclause) spec.world_scale = _wclause;
  return "Render this environment reference sheet EXACTLY as specified by this JSON spec (continuity fields are binding):\n"+JSON.stringify(spec, null, 1);
}
window.buildLocationRefPrompt = buildLocationRefPrompt;

/* the set dressing a location OWNS (the fixture-of relationship): ownerless, not worn,
   and either explicitly linked (p.locationId) or every mapped scene resolves to this
   location. Objects whose scenes span locations are mobile (someone moves them) and
   are excluded \u2014 they belong at the shot, not baked into the set. */
function locationEnvironmentProps(l){
  const C = window.turnContinuity || {};
  const props = C.props||[], locations = C.locations||[];
  const charNames = (C.characters||[]).map(c=>String(c&&c.name||"").trim().toLowerCase()).filter(Boolean);
  const allowedSpecies = new Set((typeof locationAmbientSpecies==="function" ? locationAmbientSpecies(l) : []).flatMap(s=>s.aliases.map(a=>a.toLowerCase())));
  const livingRe = /\b(character|cast|person|people|animal|creature|wildlife|insect|bug|fly|firefly|frog|toad|bird|moth|beetle|spider|mouse|rat|face|eye|body|silhouette)\b/i;
  const locIdOf = (sid)=>{ const m=(typeof locationForScene==="function")?locationForScene(locations, sid):null; return m?m.id:""; };
  return props.filter(p=>{
    const locationScenes=(C.scenes||[]).filter(s=>{ const loc=(typeof locationForScene==="function")?locationForScene(locations,s.id):null; return loc&&loc.id===l.id; });
    if(typeof propStateAt==="function" && Array.isArray(p.continuityEvents) && p.continuityEvents.length){
      const placed=locationScenes.some(s=>{ const st=propStateAt(p,s.id,null,null,null,C); return st&&st.active&&st.placement&&st.placement.locationId===l.id; });
      if(placed) return true;
    }
    if(p.ownerId || p.ownerName) return false;
    if((p.kind||"carried")==="worn") return false;
    const blob = [p.name,p.form,p.material,p.detail].filter(Boolean).join(" ");
    if(livingRe.test(blob)){
      const lowBlob = blob.toLowerCase();
      const allowedHit = Array.from(allowedSpecies).some(a=>new RegExp("\\b"+a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","i").test(lowBlob));
      if(!allowedHit) return false;
    }
    const low = String(p.name||"").toLowerCase();
    if(low && charNames.some(n=>n && (low===n || low.includes(n)))) return false;
    if(p.locationId) return p.locationId===l.id;
    const sc = Array.isArray(p.scenes) ? p.scenes : [];
    if(!sc.length) return false;
    const ids = Array.from(new Set(sc.map(locIdOf).filter(Boolean)));
    return ids.length===1 && ids[0]===l.id;
  }).slice(0,6);
}
window.locationEnvironmentProps = locationEnvironmentProps;

function combinedLocationPrompt(l, project, opts){
  const master = buildLocationRefPrompt(l, project, opts);
  const extra = (typeof locationCharacterNegative==="function") ? locationCharacterNegative(project, l) : "";
  const neg = [l.negativePrompt || locVisualDefaults(l).negativePrompt || "", extra].filter(Boolean).join(", ").trim();
  return neg ? (master + " AVOID: " + neg.replace(/\.$/,"") + ".") : master;
}
window.combinedLocationPrompt = combinedLocationPrompt;

/* single establishing variant (used for time-of-day / style variant plates) */
function buildLocationVariantPrompt(l, project, opts){
  opts = opts || {};
  const v = locVisualDefaults(l);
  const lighting = (l.lighting||"").replace(/\.$/,"").trim();
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, l).join(" ") : "empty of people and characters.";
  const speciesCanon = (typeof locationSpeciesCanonText==="function") ? locationSpeciesCanonText(l) : "";
  let s = "Establishing shot \u2014 "+(l.name||"Location")+" ("+(l.intExt||"INT")+")";
  s += opts.time ? (", "+opts.time) : "";
  s += ". ";
  s += (l.architecture ? (l.architecture.replace(/\.$/,"")+". ") : "");
  s += lighting ? ("Permanent lighting interfaces: "+lighting+". ") : "";
  s += opts.state ? ("TIME-OF-DAY VARIANT (binding): "+String(opts.state).replace(/\.$/,"")+". ") : "";
  const layers=locationIdentityLayers(l);
  s += locationSpatialPrompt(l);
  if(layers.continuity_root) s += "This child space inherits the continuity-root identity: "+JSON.stringify(layers.continuity_root)+". ";
  // grade-neutral, like the master plate — the scene grade is applied at the shot.
  s += "RENDER STYLE: "+v.renderStyle.replace(/\.$/,"")+". ";
  if(speciesCanon) s += speciesCanon+" ";
  s += "Single wide cinematic frame, the same space and architecture. "+rules+" Sharp focus, faithful to the specified render style.";
  const extra = (typeof locationCharacterNegative==="function") ? locationCharacterNegative(project, l) : "";
  const neg = [l.negativePrompt||v.negativePrompt||"", extra].filter(Boolean).join(", ").trim();
  return neg ? (s+" AVOID: "+neg.replace(/\.$/,"")+".") : s;
}
window.buildLocationVariantPrompt = buildLocationVariantPrompt;

function buildLocationCoveragePrompt(l, sheet, project){
  sheet = sheet || {};
  const v = locVisualDefaults(l);
  const role = String(sheet.role||"INT").toUpperCase();
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, l).join(" ") : "empty of people and characters.";
  const speciesCanon = (typeof locationSpeciesCanonText==="function") ? locationSpeciesCanonText(l) : "";
  const clean = (x)=>String(x||"").replace(/\s+/g," ").trim().replace(/\.$/,"");
  const parent = clean(l&&l.name) || "the parent location";
  const name = clean(sheet.name) || (parent+" "+role);
  const summary = clean(sheet.summary);
  const spec = {
    task: "single full-frame location coverage sheet derived from the screenplay",
    coverage: {
      role: role==="EXT" ? "exterior side" : "interior side",
      name,
      parent_location: parent+" ("+(l.intExt||"INT")+")",
      screenplay_basis: summary || undefined,
      screenplay_excerpt: clean(sheet.scriptExcerpt) || undefined,
      screenplay_order: sheet.order!=null ? Number(sheet.order) : undefined,
      scenes: Array.isArray(sheet.sceneNos) && sheet.sceneNos.length ? sheet.sceneNos : undefined,
      rule: "render ONLY the space the screenplay needs for shots; no actors, no story action, no temporary performance moment",
    },
    relationship_to_parent: role==="INT"
      ? "This is the inside/subspace of the parent location; preserve any glass, doorway, booth, window or threshold relationship back to the exterior when the script states it."
      : "This is the outside/facade/context of the parent location; preserve entrances, windows, thresholds and approach geometry that connect to the interior when the script states it.",
    environment_spec: {
      identity_layers: locationIdentityLayers(l),
      architecture: clean(l.architecture) || undefined,
      materials: clean(l.materials) || undefined,
      permanent_lighting_interfaces: clean(l.lighting) || undefined,
      permanent_dressing: clean(l.permanentDressing) || undefined,
      spatial_topology: clean(l.topology) || undefined,
      continuity_anchors: clean(l.continuityAnchors)?{status:l.anchorsLocked===false?"editable":"LOCKED / binding",rules:clean(l.continuityAnchors)}:undefined,
      dramatic_use: clean(l.significance) || undefined,
    },
    ambient_species_canon: speciesCanon || undefined,
    render: {
      style: clean(v.renderStyle),
      format: "ONE "+((typeof nbGetAspect==="function" && nbGetAspect()) || "16:9")+" cinematic environment reference image, not a grid, not a storyboard panel",
      rules: [rules, "empty set only", "if the screenplay names a subspace without fully describing it, infer the missing architecture from the attached screenplay-page reference plus the parent location reference while staying conservative", "no text, no labels, no typography, no captions, no watermarks", "consistent with the parent location's materials, scale and light"],
    },
  };
  const neg = [l.negativePrompt || v.negativePrompt || "", (typeof locationCharacterNegative==="function") ? locationCharacterNegative(project, l) : ""].filter(Boolean).join(", ").trim();
  return "Render this screenplay-derived location coverage sheet EXACTLY as specified by this JSON spec:\n"
    + JSON.stringify(spec, null, 1)
    + (neg ? ("\nAVOID: "+neg.replace(/\.$/,"")+".") : "");
}
window.buildLocationCoveragePrompt = buildLocationCoveragePrompt;

/* SLUGLINE UNIT plate prompt — one (place, side, time-of-day) coverage plate.
   Mirrors buildLocationCoveragePrompt but keys the spec to the unit: the time
   bucket and the user's TIME-OF-DAY VARIANT ("dawn and raining") are first-class,
   binding spec fields, and the screenplay basis is ONLY this unit's owned blocks
   (yard-at-night coverage never reads booth prose). */
function buildSluglineUnitPrompt(l, u, project){
  u = u || {};
  const v = locVisualDefaults(l);
  const role = String(u.intExt||"INT").toUpperCase();
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, l).join(" ") : "empty of people and characters.";
  const speciesCanon = (typeof locationSpeciesCanonText==="function") ? locationSpeciesCanonText(l) : "";
  const clean = (x)=>String(x||"").replace(/\s+/g," ").trim().replace(/\.$/,"");
  const parent = clean(l&&l.name) || "the parent location";
  const name = clean(u.name) || (parent+" "+role);
  const spec = {
    task: "single full-frame location coverage plate for one slugline unit (place + side + time of day)",
    coverage: {
      role: role==="EXT" ? "exterior side" : "interior side",
      name,
      parent_location: parent+" ("+(l.intExt||"INT")+")",
      time_of_day: clean(u.time) || undefined,
      appearance_state: clean(u.appearance) || undefined,
      // the user's curated list wins; derived script candidates are the fallback
      state_dressing: (Array.isArray(u.dressing) && u.dressing.length ? u.dressing
        : (Array.isArray(u.dressingDerived) && u.dressingDerived.length ? u.dressingDerived : undefined)),
      sluglines: Array.isArray(u.sluglines) && u.sluglines.length ? u.sluglines : undefined,
      screenplay_excerpt: clean(String(u.scriptText||"").slice(0,720)) || undefined,
      scenes: Array.isArray(u.sceneNos) && u.sceneNos.length ? u.sceneNos : undefined,
      rule: "render ONLY the space the screenplay needs for shots; no actors, no story action, no temporary performance moment",
    },
    relationship_to_parent: role==="INT"
      ? "This is the inside/subspace of the parent location; preserve any glass, doorway, booth, window or threshold relationship back to the exterior when the script states it."
      : "This is the outside/facade/context of the parent location; preserve entrances, windows, thresholds and approach geometry that connect to the interior when the script states it.",
    environment_spec: {
      identity_layers: locationIdentityLayers(l),
      architecture: clean(l.architecture) || undefined,
      materials: clean(l.materials) || undefined,
      permanent_lighting_interfaces: clean(l.lighting) || undefined,
      permanent_dressing: clean(l.permanentDressing) || undefined,
      spatial_topology: clean(l.topology) || undefined,
      continuity_anchors: clean(l.continuityAnchors)?{status:l.anchorsLocked===false?"editable":"LOCKED / binding",rules:clean(l.continuityAnchors)}:undefined,
      dramatic_use: clean(l.significance) || undefined,
    },
    ambient_species_canon: speciesCanon || undefined,
    render: {
      style: clean(v.renderStyle),
      format: "ONE "+((typeof nbGetAspect==="function" && nbGetAspect()) || "16:9")+" cinematic environment reference image, not a grid, not a storyboard panel",
      rules: [rules, "empty set only", "the TIME OF DAY, TIME-OF-DAY VARIANT and STATE DRESSING list are binding — light, sky and weather must match the first two, and every listed temporary dressing item must be present in the space", "LOCKED continuity anchors and spatial topology are binding; Narrative Significance is soft interpretive guidance only", "no text, no labels, no typography, no captions, no watermarks", "consistent with the continuity root's invariants and this child space's specific identity"],
    },
  };
  const neg = [l.negativePrompt || v.negativePrompt || "", (typeof locationCharacterNegative==="function") ? locationCharacterNegative(project, l) : ""].filter(Boolean).join(", ").trim();
  return "Render this slugline-unit location coverage plate EXACTLY as specified by this JSON spec:\n"
    + JSON.stringify(spec, null, 1)
    + (neg ? ("\nAVOID: "+neg.replace(/\.$/,"")+".") : "");
}
window.buildSluglineUnitPrompt = buildSluglineUnitPrompt;

/* simplified fallback — fewer words, less likely to trip a content filter */
/* the simplified retry (after a "no image" answer). frame (2026-10-08): a single-frame plate — a room & time,
   an environment state, an extra space — keeps ITS framing, time and state (it used to fall back to a
   multi-angle sheet and drop the time: a night/rain room could save as a neutral sheet) */
function buildSimpleLocationPrompt(l, frame){
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(null, l).join(" ") : "empty of people and characters";
  const speciesCanon = (typeof locationSpeciesCanonText==="function") ? locationSpeciesCanonText(l) : "";
  // retry keeps the location's PICKED render style — never silently photoreal
  const styleLine = String(locVisualDefaults(l).renderStyle||"").split(/[;,]/)[0].trim();
  const parts = [
    "Location reference \u2014 "+(l.name||"place")+" ("+(l.intExt||"INT")+")",
    (l.architecture||"").replace(/\.$/,"").trim(),
    (l.lighting?"permanent lighting interfaces: "+String(l.lighting).replace(/\.$/,"").trim():""),
    (l.continuityAnchors?"binding continuity anchors: "+String(l.continuityAnchors).replace(/\.$/,"").trim():""),
    (l.topology?"spatial topology: "+String(l.topology).replace(/\.$/,"").trim():""),
    locationSpatialPrompt(l),
    speciesCanon,
    frame
      ? ("ONE wide establishing frame"+(frame.name?(" of "+String(frame.name).trim()):"")+(frame.side?(" ("+frame.side+")"):"")
          +(frame.time?(", at "+String(frame.time).trim()):"")+(frame.state?(", "+String(frame.state).replace(/\.$/,"").trim()):"")
          +" \u2014 a single image, not a grid, no text, labels or captions")
      : "exactly 4 views of the same space in a 2x2 grid \u2014 establishing wide, reverse angle, a side view and a detail \u2014 no text, labels or captions",
    rules+", "+(styleLine||"photoreal")+", sharp focus"
  ].filter(Boolean);
  const neg = (typeof locationCharacterNegative==="function") ? locationCharacterNegative(null, l) : "";
  return parts.join(". ")+"."+(neg?(" AVOID: "+neg+"."):"");
}
window.buildSimpleLocationPrompt = buildSimpleLocationPrompt;

/* image-to-image from a dropped reference photo of a real place */
function buildLocationFromPhotoPrompt(l, project){
  const v = locVisualDefaults(l);
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, l).join(" ") : "empty of people and characters.";
  const speciesCanon = (typeof locationSpeciesCanonText==="function") ? locationSpeciesCanonText(l) : "";
  let s = "Master location reference plate \u2014 "+(l.name||"Location")+". ";
  s += "BASE SPACE: reproduce EXACTLY the place shown in the dropped reference photo of the real place \u2014 its architecture, ";
  s += "proportions, materials, colour and light. Do not redesign or restyle it. ";
  s += locationSpatialPrompt(l);
  s += (l.significance ? ("NARRATIVE SIGNIFICANCE (interpretive): "+l.significance.replace(/\.$/,"")+". ") : "");
  s += "RENDER STYLE: "+v.renderStyle.replace(/\.$/,"")+". ";
  if(speciesCanon) s += speciesCanon+" ";
  // (2026-10-08) the same 2x2 four-view plate as every other master plate — it used to ask for a 3x2 grid
  // with printed captions, so photo-made plates broke Edit a panel and the panel crops
  s += "Compose it as exactly 4 views of that same space in a 2x2 grid divided by thin clean lines: "
     + "top-left a wide establishing view; top-right a high overview; bottom-left and bottom-right two closer views of its key features and materials. "
     + "No text, no labels, no captions, no numbers. Any other attached images are parent, layout or screenplay references, not the place to copy. "
     + "Consistent architecture and light across all panels. "+rules+" Sharp focus, faithful to the specified render style.";
  return s;
}
window.buildLocationFromPhotoPrompt = buildLocationFromPhotoPrompt;

/* ---- Headless location generation (for the Location Scout agent) ----
   Mirrors generatePropSheet: build the prompt, generate (retry a simplified prompt on a
   "no image" safety refusal), commit to the location's slot, and dispatch nb-gen-done so
   the live card adopts it. The base plate commits to l.id ("locref-"+l.id); a time-of-day
   variant commits to l.id+"-"+v.id ("locvar-"+l.id+"-"+v.id). ---- */
function _nbLocRunSnapshot(entity){
  /* Read settings once, before the provider call.  Location generation is
     headless, so there is no component closure to freeze the user's intent for
     us; a late metadata getter would otherwise report a later picker change. */
  const model = (typeof nbGetModel==="function") ? nbGetModel() : "";
  const isGpt = typeof window.isGptImageModel==="function"
    ? window.isGptImageModel(model) : /^gpt-image/i.test(String(model||""));
  const quality = isGpt && typeof window.nbGetOaiQuality==="function"
    ? window.nbGetOaiQuality(model) : undefined;
  const styleEntity=typeof locationRenderEntity==="function"?locationRenderEntity(entity):entity;
  return { model, quality, renderStyleKey:styleEntity&&styleEntity.renderStyleKey,
    renderStyleLabel:typeof renderStyleLabelForEntity==="function"?renderStyleLabelForEntity(styleEntity):undefined };
}
function _nbLocMeta(prompt, entity, runSnapshot){
  const snap = runSnapshot || {};
  const model = snap.model || "";
  const aspect = (typeof nbGetAspect==="function") ? nbGetAspect() : "16:9";
  // the size really rendered (Seedream 5 Pro renders a 4K pick at 2K — 2026-10-11)
  const _res = (typeof nbGetRes==="function") ? nbGetRes() : "2K";
  const size = (typeof window.nbModelRes==="function") ? window.nbModelRes(model, _res) : _res;
  const now = new Date();
  const mEntry = (window.NB_MODELS||[]).find(m=>m.id===model) || {};
  return { modelLabel:mEntry.label||"Image model", modelId:model, aspect, size,
     renderStyleKey:snap.renderStyleKey,renderStyleLabel:snap.renderStyleLabel,
     // Keep the exact requested intent, including 2.5 "default"; never infer
     // provider-high from an omitted request after the render finishes.
     quality: snap.quality,
     qualityModel: model,
     requestedModel: model,
    date: now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
    time: now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
    iso: now.toISOString(), prompt, mode:"final", version:1,
    writingSources:(typeof window.nbWritingSourcesFor==="function")?window.nbWritingSourcesFor(entity):[],
    promptCompiler:"Kinolot prompt compiler" };
}
/* SET DRESSING — painted INTO the plate by an EDIT, never attached as reference
   sheets at generation. (Reference sheets at generation time had no anchor image
   yet, so their studio look bled into the plate's lighting and palette; an edit
   pass keeps the finished plate as the style anchor and only installs the object.)
   Dressing props are spec-only cards: locDressingProps lists a location's fixtures,
   locDressingEditText turns one prop's spec into a ready plate-edit instruction. */
function locDressingProps(l){
  if(!l) return [];
  const props = ((window.turnContinuity||{}).props)||[];
  const homeId = (p)=>{
    if(p.locationId) return p.locationId;
    const home = (typeof propHomeLocation==="function") ? propHomeLocation(p) : null;
    return (home && home.id) || "";
  };
  return props.filter(p=>{
    if(!p) return false;
    if(typeof propStateAt==="function" && Array.isArray(p.continuityEvents) && p.continuityEvents.length){
      const C=window.turnContinuity||{};
      const here=(C.scenes||[]).some(s=>{ const loc=(typeof locationForScene==="function")?locationForScene(C.locations||[],s.id):null;
        if(!loc||loc.id!==l.id) return false;
        const st=propStateAt(p,s.id,null,null,null,C); return st&&st.active&&st.placement&&st.placement.locationId===l.id; });
      if(here) return true;
    }
    return p.kind==="dressing" && homeId(p)===l.id;
  });
}
window.locDressingProps = locDressingProps;
function locDressingEditText(p){
  const spec = [p.form, p.material, p.detail].map(x=>String(x||"").trim().replace(/\.$/,"")).filter(Boolean).join("; ");
  const size = String(p.size||"").trim();
  return "Add the set-dressing fixture \""+(p.name||"object")+"\" into the space: "
    +(spec||"as specified on its prop card")
    +(size?(" — physical size about "+size.replace(/\.$/,"")):"")
    +". Place it ONCE, where the staging spec positions it, at true physical scale — never repeat or tile it."
    +" Match the plate's EXISTING lighting, palette and render style exactly; change nothing else in the space.";
}
window.locDressingEditText = locDressingEditText;
function _nbLocRunStart(id){
  if(!window.__nbGenInflight) window.__nbGenInflight = {};
  if(!window.__nbGenCancel) window.__nbGenCancel = {};
  /* Refuse an active owner at entry.  A stopped run leaves a false marker
     briefly, so a replacement may claim it; a truthy token belongs to a
     live run and must never be clobbered. */
  if(window.__nbGenInflight[id]) return null;
  window.__nbGenRunSeq = (window.__nbGenRunSeq||0)+1;
  const token = window.__nbGenRunSeq;
  window.__nbGenInflight[id] = token;
  window.__nbGenCancel[id] = false;
  return token;
}
function _nbLocOwns(id, token){
  return !!(window.__nbGenInflight && window.__nbGenInflight[id]===token);
}
function _nbLocStale(id, token, epoch){
  return !_nbLocOwns(id,token)
    || !!(window.__nbGenCancel && window.__nbGenCancel[id])
    || (typeof nbEpoch==="function" && nbEpoch()!==epoch);
}
function _nbLocCancelEvent(id, token){
  if(!_nbLocOwns(id,token)) return;
  try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id } })); }catch(e){}
}
function _nbLocCleanup(id, token){
  if(!_nbLocOwns(id,token)) return;
  delete window.__nbGenInflight[id];
  if(window.__nbGenCancel) delete window.__nbGenCancel[id];
}
/* the screenplay pages a location plate reads for its geography — the card and the headless runs attach
   the SAME pages (2026-10-08: the one-scene run used to attach none) — [{url, kind:"script", refId, label, note}] */
function locationScriptPageRefs(l, scenes, drafts, max){
  const C = window.turnContinuity || {};
  const all = scenes || C.scenes || [];
  const out = [], cap = (max==null ? 6 : Math.max(0, max));
  if(!cap) return out;
  const order = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder : (x=>x||[]);
  const list = (Array.isArray(l.scenes) && l.scenes.length)
    ? order(all.filter(s=>l.scenes.indexOf(s.id)>=0)) : order(all);
  for(const sc of list){
    const imgs = (typeof locationScreenplayReferenceImages==="function")
      ? locationScreenplayReferenceImages(l, { name:l.name, sceneNos:[sc.no] }, all, drafts||C.drafts||{}) : [];
    imgs.forEach((url,i)=>{ if(out.length<cap) out.push({ url, kind:"script", ready:true, required:false,
      refId:"script-main-"+l.id+"-"+(sc.no||sc.id)+"-"+i,
      label:"Scene "+String(sc.no||"?").padStart(2,"0")+" p"+(i+1),
      note:"full-scene screenplay page "+(i+1)+" for Scene "+(sc.no||"?")+" \u2014 use this to design the location's 2x2 geography from what is actually filmed; do not render page text or borders" }); });
    if(out.length>=cap) break;
  }
  return out;
}
window.locationScriptPageRefs = locationScriptPageRefs;
/* opts (2026-10-08, owner — Locations review): the one-scene run and "Make what this scene needs" now make
   the SAME plate the card does — draftStaging writes the view composition first when the place has none
   (onStaged saves it), and the screenplay pages ride along as references. */
async function generateLocationPlate(l, project, opts){
  const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;   // asset scope at generation start
  if(typeof nbGenerate!=="function" || typeof nbCommit!=="function") return false;
  const o = opts || {};
  /* A CALLER'S STOP (2026-10-09, owner — Breakdown review): "Make what this scene needs" passes its own check
     (a film switch, a role that lost the Art Room) — nothing is sent or written once it says stop; a retry
     with the simpler prompt is a second paid image, so the caller is told (onRetry) */
  const _stale = (id, tok, ep)=> _nbLocStale(id, tok, ep) || !!(typeof o.cancelled==="function" && o.cancelled());
  // THE LAYOUT FIRST (2026-10-12): a plate its layout would refuse is refused before any composition is written —
  // nobody pays for a view composition whose plate never comes (the same reason the plate itself gives)
  if(o.draftStaging && typeof requireLocationSpatialPlan==="function") requireLocationSpatialPlan(l);
  if(o.draftStaging && typeof stagingHasContent==="function" && !stagingHasContent(l)
    && typeof aiDraftStaging==="function" && typeof aiAvailable==="function" && aiAvailable()){
    try{ const st = await aiDraftStaging(l, (window.turnContinuity||{}).scenes||[], project);
      // (2026-10-09) a switch while the composition was written: nothing is saved, nothing is sent
      if((typeof nbEpoch==="function" && nbEpoch()!==_ep) || (typeof o.cancelled==="function" && o.cancelled())) return false;
      if(st){ l = { ...l, staging:st }; if(typeof o.onStaged==="function") o.onStaged(l.id, st); } }catch(e){}   // fail-open: prose only
    if(typeof nbEpoch==="function" && nbEpoch()!==_ep) return false;
    if(typeof o.cancelled==="function" && o.cancelled()) return false;
  }
  const runSnapshot = _nbLocRunSnapshot(l);
  // no set-dressing refs here — the clean plate anchors the look; fixtures are
  // painted in afterwards via the Edit panel's Set-dressing buttons
  let prompt = (typeof combinedLocationPrompt==="function") ? combinedLocationPrompt(l, project, {}) : (l.name||"location reference");
  const gopts = {};
  if(runSnapshot.model) gopts.model = runSnapshot.model;
  if(runSnapshot.quality!=null) gopts.quality = runSnapshot.quality;
  const _runToken = _nbLocRunStart(l.id);
  if(!_runToken) return false;
  try{
    const parentRefs=await locationParentReferences(l);
    if(_stale(l.id,_runToken,_ep)){_nbLocCancelEvent(l.id,_runToken);return false;}
    let refs=mergeLocationReferences(parentRefs,await locationSpatialReferences(l));
    if(o.scriptRefs!==false){
      const pages=locationScriptPageRefs(l, null, null, 6).filter(r=>r.url);
      refs=[...refs, ...pages.map(r=>({url:r.url,kind:"script",refId:r.refId,note:r.note}))].slice(0,6);
    }
    const parent=locationParentOf(l);
    const lineage=parent?locationAssetDependencySnapshot(parent.id,[],"subspace"):{};
    const planSig=(typeof locationSpatialPlanSigFor==="function")?locationSpatialPlanSigFor(l):"";   // the reviewed layout this plate is made from
    if(planSig) lineage.spatialPlanSig=planSig;
    if(typeof locationSpecSig==="function") lineage.locSpecSig=locationSpecSig(l);
    let referenceText=locationReferenceInstructions(refs);
    if(refs.some(r=>r.kind==="script")) referenceText+=" Read screenplay pages together as evidence for permanent geography \u2014 NOT a quadrant map: "
      +"do not make one panel per page or per scene, and never copy screenplay typography, page borders, text or captions.";
    prompt+=referenceText;
    if(refs.length)gopts.extraImages=refs.map(r=>r.url);
    if(_stale(l.id,_runToken,_ep)){_nbLocCancelEvent(l.id,_runToken);return false;}
    if(runSnapshot.quality && typeof window.nbRequireImageQuality==="function"){
      try{ await window.nbRequireImageQuality(runSnapshot.model, runSnapshot.quality); }
      catch(e){ if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; } throw e; }
    }
    /* Capability validation may await an OPTIONS response while the director
       switches films or stops this headless run.  Never spend after that await
       against a stale asset scope/ownership marker. */
    if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
    let url;
    try{
      url = await nbGenerate(prompt, { ...gopts, assetId:l.id });
      if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
    }catch(e){
      if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
      if(/no image/i.test((e&&e.message)||"") && typeof buildSimpleLocationPrompt==="function"){
        if(typeof o.onRetry==="function"){ try{ o.onRetry(); }catch(_e){} }   // a second paid image — the caller says so
        try{ prompt=buildSimpleLocationPrompt(l)+referenceText;url = await nbGenerate(prompt, { ...gopts, assetId:l.id }); }
        catch(fallbackError){
          if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
          throw fallbackError;
        }
        if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
      }else throw e;
    }
    let saved;
    try{
      saved = await nbCommit(l.id, url, {..._nbLocMeta(prompt,l,runSnapshot),...lineage}, refs, "location", _ep,
        ()=>_stale(l.id,_runToken,_ep));
    }catch(e){
      if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
      throw e;
    }
    if(_stale(l.id,_runToken,_ep) || (saved&&/^(cancelled|stale)$/.test(saved.tier||""))){
      _nbLocCancelEvent(l.id,_runToken); return false;
    }
    if(!saved || saved.tier==="error") return false;
    try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id:l.id, url } })); }catch(e){}
    return true;
  } finally { _nbLocCleanup(l.id,_runToken); }
}
window.generateLocationPlate = generateLocationPlate;

async function generateLocationVariant(l, v, project){
  const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;   // asset scope at generation start
  if(typeof nbGenerate!=="function" || typeof nbCommit!=="function") return false;
  const runSnapshot = _nbLocRunSnapshot(l);
  const units = ((window.turnContinuity||{}).sluglineUnits)||[];
  const unit = (typeof locationVariantSluglineUnit==="function") ? locationVariantSluglineUnit(l,v,units) : null;
  const id = (typeof locationAppearanceStateAssetId==="function")
    ? locationAppearanceStateAssetId(l,{...v,linkedUnit:unit},units)
    : l.id+"-"+v.id;
  let prompt = unit && typeof buildSluglineUnitPrompt==="function"
    ? buildSluglineUnitPrompt(l,{...unit,appearance:v.state||unit.appearance||""},project)
    : ((typeof buildLocationVariantPrompt==="function") ? buildLocationVariantPrompt(l, project, { time:v.time, state:v.state }) : (l.name||"location reference"));
  const gopts = {};
  if(runSnapshot.model) gopts.model = runSnapshot.model;
  if(runSnapshot.quality!=null) gopts.quality = runSnapshot.quality;
  const _runToken = _nbLocRunStart(id);
  if(!_runToken) return false;
  try{
    const stateRefs=await locationStateReferences(l);
    if(_nbLocStale(id,_runToken,_ep)){_nbLocCancelEvent(id,_runToken,_ep);return false;}
    const refs=mergeLocationReferences(stateRefs,await locationSpatialReferences(l));
    const lineage=locationAssetDependencySnapshot(l.id,refs.slice(1).map(r=>r.refId).concat((typeof locationRootIds==="function")?locationRootIds(l):[]),unit?"slugline-unit":"continuity-state");
    const referenceText=locationReferenceInstructions(refs);
    prompt+=referenceText;
    gopts.extraImages=refs.map(r=>r.url);
    if(_nbLocStale(id,_runToken,_ep)){_nbLocCancelEvent(id,_runToken);return false;}
    if(runSnapshot.quality && typeof window.nbRequireImageQuality==="function"){
      try{ await window.nbRequireImageQuality(runSnapshot.model, runSnapshot.quality); }
      catch(e){ if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; } throw e; }
    }
    if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    let url;
    try{
      url = await nbGenerate(prompt, { ...gopts, assetId:id });
      if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    }catch(e){
      if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
      if(/no image/i.test((e&&e.message)||"") && typeof buildSimpleLocationPrompt==="function"){
        try{ prompt=buildSimpleLocationPrompt(l,{ name:(unit&&unit.name)||l.name, side:unit&&unit.intExt, time:v&&v.time, state:v&&v.state })+referenceText;url = await nbGenerate(prompt, { ...gopts, assetId:id }); }
        catch(fallbackError){
          if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
          throw fallbackError;
        }
        if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
      }else throw e;
    }
    let saved;
    try{
      saved = await nbCommit(id, url, Object.assign(_nbLocMeta(prompt,unit?{...l,appearanceState:unit}:l,runSnapshot),lineage), refs, "location", _ep,
        ()=>_nbLocStale(id,_runToken,_ep));
    }catch(e){
      if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
      throw e;
    }
    if(_nbLocStale(id,_runToken,_ep) || (saved&&/^(cancelled|stale)$/.test(saved.tier||""))){
      _nbLocCancelEvent(id,_runToken); return false;
    }
    if(!saved || saved.tier==="error") return false;
    try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, url } })); }catch(e){}
    return true;
  } finally { _nbLocCleanup(id,_runToken); }
}
window.generateLocationVariant = generateLocationVariant;

/* A ROOM / TIME PLATE (Slugline Unit) made without its card being on screen — for "Generate N
   missing in Scene NN" (2026-10-03, owner — Locations review). The same references and prompt as
   the card's own Generate: the owning location's plate (required), its parent's plate when it is a
   room, the scene's screenplay pages, and the reviewed spatial references. */
async function generateSluglineUnitPlate(l, u, project, opts){
  const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;
  if(typeof nbGenerate!=="function" || typeof nbCommit!=="function" || typeof sluglineUnitImageId!=="function") return false;
  if(!l || !u || !u.key || u.orphan) return false;
  // a caller's stop and its retry notice, as generateLocationPlate (2026-10-09, owner — Breakdown review)
  const o = opts || {};
  const _stale = (sid, tok, ep)=> _nbLocStale(sid, tok, ep) || !!(typeof o.cancelled==="function" && o.cancelled());
  const id = sluglineUnitImageId(u.key);
  const runSnapshot = _nbLocRunSnapshot(l);
  const C = window.turnContinuity || {};
  let prompt = (typeof buildSluglineUnitPrompt==="function") ? buildSluglineUnitPrompt(l, u, project) : (u.name||l.name||"location");
  const gopts = {};
  if(runSnapshot.model) gopts.model = runSnapshot.model;
  if(runSnapshot.quality!=null) gopts.quality = runSnapshot.quality;
  const grab = async (rid)=>{ let x=(typeof nbGetImage==="function")?nbGetImage(rid):"";
    if(!x && typeof nbLoadImage==="function"){ try{ x=await nbLoadImage(rid); }catch(e){} } return x||""; };
  const _runToken = _nbLocRunStart(id);
  if(!_runToken) return false;
  try{
    requireLocationSpatialPlan(l);
    const own = await grab(l.id);
    if(!own) throw new Error("Generate "+(l.name||"the location")+"'s plate first — this room needs it as a reference.");
    const role = String(u.intExt||"INT").toUpperCase();
    const pseudo = sluglineUnitPseudoSheet(id, u, role);
    const scriptImgs = (typeof locationScreenplayReferenceImages==="function")
      ? locationScreenplayReferenceImages(l, pseudo, C.scenes||[], C.drafts||{}) : [];
    const base = scriptImgs.map((url,i)=>({ url, kind:"script", refId:"script-"+id+"-"+i,
      note:"screenplay page "+(i+1)+" for "+(u.name||"this Slugline Unit")+" — use it to infer what the script implies, but do not render any text from it" }));
    base.push({ url:own, kind:"location", refId:l.id,
      note:(l.name||"parent location")+" child/master plate — preserve this exact subspace geometry, materials and scale" });
    if(l.parentLocation){ const root = locationParentReference(l, await grab(l.parentLocation.id)); if(root && root.url) base.push(root); }
    if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    const refs = mergeLocationReferences(base, await locationSpatialReferences(l));
    const lineage = locationAssetDependencySnapshot(l.id,(typeof locationRootIds==="function")?locationRootIds(l):[],"slugline-unit");
    const referenceText = locationReferenceInstructions(refs)
      +" The screenplay page snapshots are context only: never copy their typography, page border, text, captions or layout.";
    prompt += referenceText;
    gopts.extraImages = refs.map(r=>r.url);
    if(runSnapshot.quality && typeof window.nbRequireImageQuality==="function"){
      try{ await window.nbRequireImageQuality(runSnapshot.model, runSnapshot.quality); }
      catch(e){ if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; } throw e; }
    }
    if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    let url;
    try{ url = await nbGenerate(prompt, { ...gopts, assetId:id }); }
    catch(e){
      if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
      // the same simplified retry the card uses, keeping this plate's room, side, time and state (2026-10-08)
      if(!(/no image/i.test((e&&e.message)||"") && typeof buildSimpleLocationPrompt==="function")) throw e;
      if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
      if(typeof o.onRetry==="function"){ try{ o.onRetry(); }catch(_e){} }   // a second paid image — the caller says so
      prompt = buildSimpleLocationPrompt(l,{ name:u.name||l.name, side:u.intExt, time:u.time, state:u.appearance||u.environment||"" })+referenceText;
      url = await nbGenerate(prompt, { ...gopts, assetId:id });
    }
    if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    const saved = await nbCommit(id, url, Object.assign(_nbLocMeta(prompt,{...l,appearanceState:u},runSnapshot),lineage), refs, "location", _ep,
      ()=>_stale(id,_runToken,_ep));
    if(_stale(id,_runToken,_ep) || (saved&&/^(cancelled|stale)$/.test(saved.tier||""))){ _nbLocCancelEvent(id,_runToken); return false; }
    if(!saved || saved.tier==="error") return false;
    try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, url } })); }catch(e){}
    return true;
  } finally { _nbLocCleanup(id,_runToken); }
}
window.generateSluglineUnitPlate = generateSluglineUnitPlate;
/* the screenplay "sheet" a room & time plate reads its pages from — one definition for the plate and its count */
function sluglineUnitPseudoSheet(id, u, role){
  return { id, name:u.name, role:role||String(u.intExt||"INT").toUpperCase(), sceneNos:(u.sceneNos||[]).filter(n=>n!=null),
    scriptExcerpt:String(u.scriptText||"").slice(0,720), summary:"Slugline Unit: "+(u.sluglines||[]).join(" · ") };
}
/* HOW MANY REFERENCE IMAGES A PLATE ATTACHES (2026-10-09, owner — Breakdown review): GPT Image charges about one
   credit a reference (billing-pricing.mjs GPT_IMAGE_REFERENCE_USD), so "Make what this scene needs" prices each
   plate with the references the generator above will attach — the parent's plate, the reviewed layout's plate
   (one image when it is the same plate) and the screenplay pages, at most 6. { n, exact }: exact false = n is
   the most it can be. */
function locationPlateRefCount(l){
  const ids = new Set();
  try{ const parent = locationParentOf(l); if(parent) ids.add(parent.id); }catch(e){}
  try{ const st = requireLocationSpatialPlan(l); if(st.source.iso || st.plan.source.iso) ids.add(st.owner.id); }
  catch(e){ return { n:6, exact:false }; }
  let pages = 0;
  try{ pages = locationScriptPageRefs(l, null, null, 6).filter(r=>r.url).length; }catch(e){ return { n:6, exact:false }; }
  return { n:Math.min(6, ids.size+pages), exact:true };
}
/* a room & time plate: its screenplay pages, its location's plate, the root's plate when it has one
   (opts.rootPlate: false = the root has none, so it isn't attached) and the reviewed layout's plate */
function sluglineUnitPlateRefCount(l, u, opts){
  const o = opts || {};
  const C = window.turnContinuity || {};
  let pages = 0, exact = true;
  try{ const id = sluglineUnitImageId(u.key);
    pages = locationScreenplayReferenceImages(l, sluglineUnitPseudoSheet(id, u), C.scenes||[], C.drafts||{}).length; }
  catch(e){ exact = false; }
  const ids = new Set([l.id]);
  if(l.parentLocation && l.parentLocation.id && o.rootPlate!==false){ ids.add(l.parentLocation.id); if(o.rootPlate!==true) exact = false; }
  try{ const st = requireLocationSpatialPlan(l); if(st.source.iso || st.plan.source.iso) ids.add(st.owner.id); }catch(e){}
  return { n:pages+ids.size, exact };
}
window.locationPlateRefCount = locationPlateRefCount;
window.sluglineUnitPlateRefCount = sluglineUnitPlateRefCount;

/* coverage audit — scenes whose heading names a place that isn't linked to any Location
   card yet (e.g. an unparseable or brand-new heading). After a pull every parseable scene
   heading is covered, so this surfaces the genuine gaps. */
function locationCoverage(scenes, locations){
  const covered = new Set();
  (locations||[]).forEach(l=> (l.scenes||[]).forEach(id=> covered.add(id)));
  const out = [];
  (scenes||[]).forEach(s=>{
    if(!s || !(s.loc||"").trim()) return;     // no scene heading → not a master location-bearing scene
    if(covered.has(s.id)) return;
    const p = (typeof parseSlugline==="function") ? parseSlugline(s.loc) : null;
    out.push({ id:s.id, no:s.no, title:s.title||"", slug:(s.loc||"").trim(), place:(p&&p.place)||"" });
  });
  return out;
}
window.locationCoverage = locationCoverage;
