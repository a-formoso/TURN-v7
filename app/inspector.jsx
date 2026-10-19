/* inspector.jsx — right panel: EDITABLE scene detail, charge editor, turn verdict, beats, analysis */

const KIND_OPTS_3ACT = [["normal","Scene"],["incite","Inciting Incident"],["act-climax","Act Climax"],
  ["midpoint","Mid-Act Climax"],["crisis","Crisis"],["story-climax","Story Climax"],["resolution","Resolution"]];
/* the kind dropdown lists the FRAMEWORK's milestones (frameworks.jsx kindOpts);
   a scene whose stored kind isn't in the list keeps it via an extra option. */
function kindOptsNow(){
  return (typeof fwKindOpts==="function" && fwKindOpts()) || KIND_OPTS_3ACT;
}

/* inline editable text — local state so the cursor never jumps */
function EditText({ value, onCommit, className, placeholder, multiline, autoFocus, readOnly }){
  const [v,setV] = React.useState(value==null?"":value);
  // A collaborator can be downgraded while focused in a field. Entering read-only
  // mode discards that unsaved local buffer immediately instead of leaving text on
  // screen that the mutation boundary will (correctly) refuse to persist.
  React.useEffect(()=>{ setV(value==null?"":value); },[value,readOnly]);
  const commit = ()=>{ if(!readOnly && v!==(value==null?"":value)) onCommit(v); };
  const Tag = multiline ? "textarea" : "input";
  // auto-grow a textarea to fit its content so the full text is always visible
  const ref = React.useRef(null);
  const fit = React.useCallback(()=>{
    const el = ref.current; if(!el || !multiline) return;
    el.style.height = "auto"; el.style.height = el.scrollHeight + "px";
  },[multiline]);
  React.useLayoutEffect(()=>{ fit(); },[v, multiline, fit]);
  return React.createElement(Tag,{ ref, className:"edit-in "+(className||""), value:v, placeholder, autoFocus:readOnly?false:autoFocus,
    readOnly:!!readOnly, "aria-readonly":readOnly?"true":undefined,
    onChange:e=>{ if(readOnly) return; setV(e.target.value); if(multiline) fit(); }, onBlur:commit,
    onKeyDown:e=>{ if(!multiline && e.key==="Enter") e.target.blur(); },
    rows: multiline?2:undefined });
}

/* split a comma/semicolon/middot/newline list into trimmed items, but never
   inside a parenthetical clause (so "key (unknown purpose, possessive)" stays one
   item instead of splitting on the inner comma into a "possessive)" fragment) */
function splitListItems(value){
  let s = String(value==null?"":value);
  const stash = [];
  s = s.replace(/\([^()]*\)/g, m=>{ stash.push(m); return "\u0000"+(stash.length-1)+"\u0000"; });
  // semicolons / bullets / lines separate items when present — then commas stay inside an item
  // (the same rule as props.jsx splitPropItems, 2026-10-05)
  const strong = /[;\u00b7\u2022\n]/.test(s);
  return s
    .split(strong ? /\s*(?:;|\u00b7|\u2022|\n)\s*/ : /\s*(?:,|;|\u00b7|\u2022|\n)\s*/)
    .map(p=> p.replace(/\u0000(\d+)\u0000/g, (_,i)=> stash[+i]||"") )
    .map(p=>p.replace(/^(?:and|then|&)\s+/i,""))
    .map(p=>p.replace(/\.+$/,"").trim())
    .filter(Boolean)
    .reduce((acc,x)=> (typeof _mergeDanglingFragment==="function") ? _mergeDanglingFragment(acc,x) : (acc.push(x),acc), []);
}

/* write a list back: "; " when any item has its own comma (so it reads back as ONE item),
   otherwise the usual ", " */
function joinListItems(items){
  const list = (items||[]).map(x=>String(x||"").trim()).filter(Boolean);
  return list.join(list.some(x=>x.indexOf(",")>=0) ? "; " : ", ");
}
window.joinListItems = joinListItems;

/* The character `role` string packs up to three things the model emits together:
   FUNCTION [ \u00b7 ARCHETYPE ] [ \u2014 IDENTITY ]  (e.g. "Antagonist \u00b7 ideology \u2014 a far-right
   podcaster"). parseRole splits them; composeRole puts them back so `role` stays a
   single backing string everything else (prompts, left rail, MUSE) keeps using. */
function parseRole(roleStr){
  roleStr = String(roleStr||"").trim();
  const dashIdx = roleStr.search(/[\u2014\u2013]|--/);          // em / en dash, or "--"
  let head = roleStr, identity = "";
  if(dashIdx>=0){ head = roleStr.slice(0,dashIdx).trim(); identity = roleStr.slice(dashIdx).replace(/^[\u2014\u2013\-\s]+/,"").trim(); }
  let role = head, archetype = "";
  const dotIdx = head.indexOf("\u00b7");                        // middle dot separates fn \u00b7 archetype
  if(dotIdx>=0){ role = head.slice(0,dotIdx).trim(); archetype = head.slice(dotIdx+1).trim(); }
  return { role, archetype, identity };
}
function composeRole(parts){
  parts = parts || {};
  let s = String(parts.role||"").trim();
  const a = String(parts.archetype||"").trim();
  const i = String(parts.identity||"").trim();
  if(a) s += " \u00b7 " + a;
  if(i) s += " \u2014 " + i;
  return s;
}
/* capitalise just the first letter, leaving the rest untouched ("a Somali-British
   nurse" -> "A Somali-British nurse"). Used for display of the identity line. */
function capFirst(s){ s = String(s||""); return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }

/* EditableItemList — renders a list value (comma-separated under the hood) as a
   column of INDIVIDUALLY editable bullet rows. Each row is its own auto-growing
   field (edit in place, commit on blur) with a remove button; an "Add item" row
   appends a new bullet. The value stays a comma-joined string so prop-seeding and
   scene-mapping keep working unchanged. */
function EditableItemList({ value, placeholder, onCommit, onItemRemoved, onItemRenamed, ownerName }){
  const [items,setItems] = React.useState(()=>splitListItems(value));
  // only re-sync from the outside when the external value actually changed
  // (e.g. an AI re-draft) — never clobber mid-edit from our own commits
  const lastStr = React.useRef(joinListItems(splitListItems(value)));
  React.useEffect(()=>{
    const ext = String(value==null?"":value);
    if(ext !== lastStr.current){ const next=splitListItems(ext); setItems(next); lastStr.current = joinListItems(next); }
  },[value]);
  const commit = (next)=>{
    const joined = joinListItems(next);
    lastStr.current = joined;
    onCommit(joined);
  };
  const setAt = (i,val)=>{
    const old = (items[i]||"").trim(); const nu = String(val||"").trim();
    const next=items.slice(); next[i]=val; setItems(next); commit(next);
    // editing an existing item = a RENAME → keep the matching prop card in sync
    // (skip the add case where there was no previous text)
    if(onItemRenamed && old && nu && old!==nu) onItemRenamed(old, nu);
  };
  const removeAt = async (i)=>{
    const itemText = (items[i]||"").trim();
    // When this list is wired to the Props tab, deleting a bullet also deletes the
    // matching prop card + its sheet — so confirm first (only for real, typed items).
    if(onItemRemoved && itemText){
      const ok = await window.appConfirm({
        title: "Remove \u201c"+itemText+"\u201d"+(ownerName?(" from "+ownerName):"")+"?",
        body: "This also moves its prop card (with any generated reference sheet) to the Props tab's Recently Deleted, where it can be restored.",
        confirmLabel: "Remove", danger: true,
      });
      if(!ok) return;
    }
    const next=items.slice(); next.splice(i,1); setItems(next); commit(next);
    if(onItemRemoved && itemText) onItemRemoved(itemText);
  };
  const add = ()=>{ setItems(its=>[...its, ""]); };   // local-only until typed; empty is filtered on commit

  return React.createElement("div",{className:"eil"},
    items.length>0 && React.createElement("ul",{className:"eil-list"},
      items.map((it,i)=>React.createElement("li",{className:"eil-row",key:i},
        React.createElement("span",{className:"eil-dot"}),
        React.createElement(EditText,{value:it,placeholder:"Item\u2026",multiline:true,onCommit:val=>setAt(i,val)}),
        // keyboard reachable (2026-09-28): it used to be skipped by Tab (tabIndex -1)
        React.createElement("button",{type:"button",className:"eil-del",title:"Remove item",
            "aria-label":"Remove item"+((it||"").trim()?" \u201c"+(it||"").trim().slice(0,60)+"\u201d":""),onClick:()=>removeAt(i)},
          React.createElement(Icon.x,{s:12}))))),
    React.createElement("button",{className:"eil-add",onClick:add},
      React.createElement(Icon.plus,{s:12}), items.length?"Add item":(placeholder||"Add item")));
}

/* the −/+ charge stepper. `label` names what it steps ("opening value") for the buttons'
   spoken names and tooltips (2026-09-28: they were icon-only). */
function Stepper({ value, onChange, readOnly, label }){
  const what = label || "charge";
  return React.createElement("div",{className:"stepper",role:"group","aria-label":what.charAt(0).toUpperCase()+what.slice(1)},
    React.createElement("button",{type:"button",className:"step-btn",disabled:readOnly,onClick:()=>onChange(Math.max(-3,value-1)),
        "aria-label":"Lower the "+what,title:"Lower the "+what},
      React.createElement(Icon.minus,{s:14})),
    React.createElement("div",{className:`step-val ${chargeClass(value)}`},chargeStr(value)),
    React.createElement("button",{type:"button",className:"step-btn",disabled:readOnly,onClick:()=>onChange(Math.min(3,value+1)),
        "aria-label":"Raise the "+what,title:"Raise the "+what},
      React.createElement(Icon.plus,{s:14})));
}

function ChargeEditor({ scene, onCharge, onUpdate, readOnly, unnamedValues, onNameAllValues, namingValues }){
  // ONE VALUE AT STAKE: the scene's axis (Love ↔ Hate); the opening and closing words
  // follow the charges. A scene without an axis keeps its two legacy free words, and
  // the axis fields offer a guess taken from them.
  const axis = (typeof sceneValueAxis==="function") ? sceneValueAxis(scene) : null;
  const guess = (!axis && typeof guessValueAxis==="function") ? guessValueAxis(scene) : null;
  const setPole = (k,v)=>{
    const cur = axis || { pos:(guess&&guess.pos)||"", neg:(guess&&guess.neg)||"" };
    onUpdate(scene.id,{ value:{ ...cur, [k]:String(v||"").trim() } });
  };
  /* the word in each card NAMES the value's side its charge is on (owner 2026-10-19: the "+ Love <-> - Hate" row is
     gone): a + charge's word is the positive side, a - charge's the negative side, and the other card follows when it
     stands on the same side; a neutral charge shows both sides (or, with no value named yet, its own free word) */
  const word = (field, charge)=>{
    const c = Number(charge)||0;
    if(c===0) return axis
      ? React.createElement("div",{className:"charge-name derived",title:"A neutral charge stands between the two sides"},valueWordFor(axis, 0)||"\u2014")
      : React.createElement(EditText,{value:scene[field],className:"charge-name",readOnly,onCommit:v=>onUpdate(scene.id,{[field]:v})});
    const key = c>0 ? "pos" : "neg";
    return React.createElement(EditText,{value:axis ? (axis[key]||"") : (scene[field]||""),className:"charge-name",readOnly,
      placeholder:(guess&&guess[key]) || (c>0 ? "e.g. Love" : "e.g. Hate"),
      title:"Names the value's "+(c>0?"positive (+)":"negative (\u2212)")+" side \u2014 a card on the same side follows",
      onCommit:v=>setPole(key, v)});
  };
  return React.createElement("div",{className:"charge-wrap"},
    React.createElement("div",{className:"value-axis",title:"The one value this scene is about. It opens and closes on this axis; the charges say which side it stands on."},
      !axis && React.createElement("div",{className:"va-hint"},"Name the one value this scene turns in the cards below \u2014 the word on a + charge names its positive side, the word on a \u2212 charge its negative side."),
      !axis && onNameAllValues && unnamedValues>1 && React.createElement("button",{className:"char-draft-btn va-name-all",disabled:readOnly||namingValues,
          onClick:onNameAllValues,title:"Fill every scene's value at stake: the poles their own words give are used as-is, and only the missing ones are written (one writing call). Scripts aren't changed."},
        React.createElement(Icon.sparkles,{s:12}), namingValues ? "Naming values\u2026" : ("Name every scene's value ("+unnamedValues+")"))),
    React.createElement("div",{className:"charge-grid"},
      React.createElement("div",{className:"charge-cell"},
        React.createElement("div",{className:"lab"},"Opens"),
        word("openValue", scene.openCharge),
        React.createElement(Stepper,{value:scene.openCharge,readOnly,label:"opening value",onChange:v=>onCharge("openCharge",v)})),
      React.createElement("div",{className:"charge-arrow"},React.createElement(Icon.arrowR,{s:16})),
      React.createElement("div",{className:"charge-cell"},
        React.createElement("div",{className:"lab"},"Closes"),
        word("closeValue", scene.closeCharge),
        React.createElement(Stepper,{value:scene.closeCharge,readOnly,label:"closing value",onChange:v=>onCharge("closeCharge",v)}))));
}

/* STORY NOTES on an IMPORTED script (owner 2026-10-18, docs/Script Import Plan.md): the writer's script was read as
   written, so what the method would flag is a dismissable NOTE, never a verdict to "recharge it or cut it"; the read's
   own observations and the fields it had to guess ("Check: closing charge") sit beside it. The film can turn notes off. */
const READ_UNSURE_WORD = { title:"title", summary:"summary", act:"act", openValue:"opening value", openCharge:"opening charge",
  closeValue:"closing value", closeCharge:"closing charge", kind:"kind", driver:"driver", objective:"objective",
  turningPoint:"turning point", beats:"beats", valueAtStake:"value at stake", conf:"conflict source" };
function ReadNotes({ scene, project, onUpdate, readOnly }){
  if(!scene || !scene.imported || scene.unread) return null;
  if(project && project.storyNotesOff) return null;
  const notes = (scene.readNotes||[]).filter(Boolean);
  const unsure = (scene.readUnsure||[]).map(k=>READ_UNSURE_WORD[k]||null).filter(Boolean);
  if(!notes.length && !unsure.length) return null;
  const drop = (i)=> onUpdate && onUpdate(scene.id,{ readNotes:notes.filter((_,k)=>k!==i) });
  return React.createElement("div",{className:"read-notes",role:"note"},
    React.createElement("div",{className:"read-notes-head"},React.createElement(Icon.info||Icon.alert,{s:12}),"Story notes · read from your script"),
    notes.map((n,i)=>React.createElement("div",{key:i,className:"read-note"},
      React.createElement("span",null,n),
      !readOnly && React.createElement("button",{type:"button",className:"read-note-x",title:"Dismiss this note","aria-label":"Dismiss this note",onClick:()=>drop(i)},
        React.createElement(Icon.x,{s:12})))),
    unsure.length>0 && React.createElement("div",{className:"read-unsure"},"Check: "+unsure.join(", ")+" — the read had to guess",
      !readOnly && React.createElement("button",{type:"button",className:"read-note-x",title:"Looks right","aria-label":"Looks right",onClick:()=>onUpdate&&onUpdate(scene.id,{readUnsure:[]})},
        React.createElement(Icon.check||Icon.x,{s:12}))));
}
function Verdict({ scene }){
  // an imported script's turn is read, not judged: the read's Story notes say it (ReadNotes)
  if(scene && scene.imported) return null;
  const ti = turnInfo(scene), { flagged } = ti;
  // titles + flag icon come from the project's narrative framework (frameworks.jsx);
  // the detail lines stay charge-factual.
  const aud = (typeof fwAuditOf==="function") ? fwAuditOf() : null;
  const move = `${scene.openValue} (${chargeStr(scene.openCharge)}) \u2192 ${scene.closeValue} (${chargeStr(scene.closeCharge)}). `;
  if(flagged) return React.createElement("div",{className:"verdict no"},
    React.createElement("span",{className:"verdict-icn"},React.createElement(Icon[(aud&&aud.flagIcon)||"scissors"]||Icon.scissors,{s:18})),
    React.createElement("div",null,
      React.createElement("div",{className:"verdict-t"},(aud&&aud.flagTitle)||"This scene doesn't turn"),
      React.createElement("div",{className:"verdict-d"},
        `Moves ${chargeStr(scene.openCharge)} \u2192 ${chargeStr(scene.closeCharge)} without reversing. `,
        (aud&&aud.flagDetail) || "If a scene doesn't turn a value, it's exposition \u2014 recharge it or cut it.")));
  if(ti.progression) return React.createElement("div",{className:"verdict prog"},
    React.createElement("span",{className:"verdict-icn"},React.createElement(Icon.arrowR,{s:18})),
    React.createElement("div",null,
      React.createElement("div",{className:"verdict-t"},(aud&&aud.progTitle)||"This scene progresses"),
      React.createElement("div",{className:"verdict-d"}, move,
        (aud&&aud.progDetail) || "The value intensifies on the same side instead of reversing. That's fine inside a run of scenes; at a structural peak, make it flip.")));
  if(ti.exempt && !(typeof chargeTurn==="function" ? chargeTurn(scene.openCharge, scene.closeCharge).turned : ti.turned))
    return React.createElement("div",{className:"verdict ok"},
      React.createElement("span",{className:"verdict-icn"},React.createElement(Icon.check,{s:18})),
      React.createElement("div",null,
        React.createElement("div",{className:"verdict-t"},"This beat settles"),
        React.createElement("div",{className:"verdict-d"}, move, "Its place in the structure lets it settle rather than reverse.")));
  return React.createElement("div",{className:"verdict ok"},
    React.createElement("span",{className:"verdict-icn"},React.createElement(Icon.check,{s:18})),
    React.createElement("div",null,
      React.createElement("div",{className:"verdict-t"},(aud&&aud.okTitle)||"This scene turns"),
      React.createElement("div",{className:"verdict-d"}, move,
        "A value-charged condition reverses \u2014 the scene earns its place.")));
}

function BeatEditor({ scene, beats, onBeats, focusBeat, draft, characters, project, readOnly:readOnlyIn }){
  const [deriving, setDeriving] = React.useState(false);
  // a new scene never inherits the last one's "Reading the script…" (2026-10-09)
  React.useEffect(()=>{ setDeriving(false); }, [scene && scene.id]);
  // the fields wait while the map is being read from the script — the result would overwrite edits made meanwhile
  const readOnly = !!readOnlyIn || deriving;
  const hasScript = !!(draft && ((draft.blocks && draft.blocks.length) || (Array.isArray(draft) && draft.length)));
  /* A FAILED READ IS SAID (2026-10-09, owner — Writers' Room review): the error used to be swallowed —
     Rebuild did nothing, and Create quietly started a blank map after a paid call */
  const toast = (m, k, o)=>{ if(typeof window.appToast==="function") window.appToast(m, k, o); };
  const deriveFromScript = async ()=>{
    if(!hasScript) return { error:"This scene has no screenplay to read yet." };
    if(!(typeof window.aiBeatsFromScript==="function" && typeof aiAvailable==="function" && aiAvailable()))
      return { error:"The writing service isn't available right now \u2014 sign in, or try again in a moment." };
    try{ const m = await window.aiBeatsFromScript(scene, draft, characters, project);
      return (m && m.rows && m.rows.length) ? { map:m } : { error:"The script didn't give a usable beat map \u2014 try again." }; }
    catch(e){ return { error:"Couldn't read the script into beats ("+String((e&&e.message)||"the writing service failed")+") \u2014 try again." }; }
  };
  // THE FILM A BEAT MAP BELONGS TO (2026-09-28): captured before the await, and passed on so a
  // map that comes back after a film switch is dropped (app.jsx setBeatsFor) — scene ids repeat
  // across films, so film A's Sc 4 map must never land on film B's Sc 4.
  const filmToken = ()=> (typeof window.turnFilmToken==="function") ? window.turnFilmToken() : undefined;
  // empty-state button: derive from the script if it exists, else drop a blank skeleton.
  const createMap = async ()=>{
    if(readOnly || deriving) return;
    const tok = filmToken();
    if(hasScript){ setDeriving(true); const r = await deriveFromScript(); setDeriving(false);
      if(r.map){ onBeats(scene.id, r.map, tok); return; }
      toast(r.error+" A blank beat map was started instead.","error"); }
    onBeats(scene.id, { driverLabel:"DRIVER", reactorLabel:"REACTOR", desire:"", obstacle:"", result:"", turnAt:0,
      rows:[{n:1,drive:{a:"Action",d:""},react:{a:"Reaction",d:""}}] }, tok);
  };
  // in-editor button: (re)build the beats from the script WITHOUT clobbering on failure;
  // confirms first if the current map already has the user's content.
  const rebuildFromScript = async (blank)=>{
    if(readOnly || deriving) return;
    const tok = filmToken();   // before the question too: the map is built from THIS film's script
    if(!blank && typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Rebuild the beat map from the script?",
        body:"This replaces the current beats with ones derived from this scene's screenplay.",
        confirmLabel:"Rebuild", cancelLabel:"Cancel", danger:true });
      if(!ok) return;
    }
    const prior = beats;   // the map it replaces, for Undo
    setDeriving(true); const r = await deriveFromScript(); setDeriving(false);
    if(!r.map){ toast(r.error+" Your beats are unchanged.","error"); return; }
    onBeats(scene.id, r.map, tok);
    if(prior && !blank) toast("Beat map rebuilt from the script.","ok",{ action:{ label:"Undo", onClick:()=>onBeats(scene.id, prior, tok) } });
  };
  const id = scene.id;
  beats = (typeof withBeatIdentity==="function") ? withBeatIdentity(beats,id) : beats;
  // UNDO for beat deletion — the deleted row (with its position and the turn marker)
  // is held until the user restores it, deletes another, or switches scenes. Before
  // this, a mis-click destroyed the beat with no way back (auto-save had already
  // written the deletion to the cloud within a second).
  const [lastDeleted, setLastDeleted] = React.useState(null);   // {row, index, turnBeatId}
  React.useEffect(()=>{ setLastDeleted(null); },[id]);
  // reveal the beat the user clicked in the Script gutter — scroll it into view + flag it
  const rowRefs = React.useRef({});
  React.useEffect(()=>{
    if(focusBeat==null) return;
    const el = rowRefs.current[focusBeat];
    if(el && el.scrollIntoView) el.scrollIntoView({ block:"nearest", behavior:"smooth" });
  },[focusBeat, id]);
  if(!beats) return React.createElement("div",{className:"empty",style:{minHeight:150}},
    React.createElement(Icon.grid,{s:30}),
    React.createElement("div",{className:"empty-t"},"No beat map yet"),
    React.createElement("div",{className:"empty-d"}, hasScript
      ? "This scene is already written \u2014 build its beat map FROM the script (the action / reaction subtext of each beat)."
      : "Break this scene into beats \u2014 the action / reaction exchanges that carry its subtext."),
    React.createElement("button",{className:"flag-btn primary",style:{marginTop:4},disabled:readOnly||deriving,onClick:createMap,
      title:readOnlyIn?"View-only access":(hasScript ? "Read this scene's screenplay and build its beat map (writing credits)" : undefined)},
      deriving ? "Reading the script\u2026" : (hasScript ? "Create beat map from script" : "Create beat map")));

  const commit = (next)=>{ if(!readOnly) onBeats(id,next); };
  const renumber = (rows)=>rows.map((r,k)=>({...r,n:k+1}));
  const setField = (patch)=>commit({...beats,...patch});
  const setCell = (i,side,field,val)=>commit({...beats, rows:beats.rows.map((r,j)=>
    j===i ? {...r,[side]:{...r[side],[field]:val}} : r)});
  const addBeat = ()=>commit({...beats, rows:[...beats.rows,
    {id:"beat-"+id+"-"+Date.now().toString(36),n:beats.rows.length+1, drive:{a:"Action",d:""}, react:{a:"Reaction",d:""}}]});
  const delBeat = (i)=>{
    setLastDeleted({ row: beats.rows[i], index: i, turnBeatId: beats.turnBeatId||"" });
    const rows=renumber(beats.rows.filter((_,j)=>j!==i));
    const turnBeatId=beats.rows[i].id===beats.turnBeatId?"":beats.turnBeatId;
    commit(withBeatIdentity({...beats, rows, turnBeatId},id)); };
  const undoDelete = ()=>{ if(!lastDeleted) return;
    const rows = beats.rows.slice();
    rows.splice(Math.min(lastDeleted.index, rows.length), 0, lastDeleted.row);
    commit(withBeatIdentity({...beats, rows:renumber(rows), turnBeatId:lastDeleted.turnBeatId},id));
    setLastDeleted(null); };
  const moveBeat = (i,dir)=>{ const j=i+dir; if(j<0||j>=beats.rows.length) return;
    const rows=beats.rows.slice(); const [m]=rows.splice(i,1); rows.splice(j,0,m);
    commit(withBeatIdentity({...beats, rows:renumber(rows)},id)); };
  const toggleTurn = (row)=>commit(withBeatIdentity({...beats,
    turnBeatId:beats.turnBeatId===row.id?"":row.id},id));
  // per-beat VALUE CHARGE stays a DATA layer only (r.charge, -3..+3): the AI sets it
  // when authoring beats and the Shot Designer reads the shifts — the manual ± selector
  // was removed by product decision 2026-07-19 (auto-set, consumed silently; UI noise).

  // a beat map can be a bare skeleton (one empty row, no desire/obstacle) — detect it so
  // the "Build from script" button reads right and skips the overwrite confirm.
  const blankMap = (beats.rows||[]).length<=1
    && !(beats.rows||[]).some(r=>((r.drive&&r.drive.d)||"").trim() || ((r.react&&r.react.d)||"").trim())
    && !((beats.desire||"").trim()) && !((beats.obstacle||"").trim()) && !((beats.result||"").trim());
  return React.createElement("div",null,
    // restore chip — appears right after a delete, until restored / next delete / scene switch
    lastDeleted && React.createElement("button",{className:"beat-build-btn beat-undo-btn",disabled:readOnly,
      onClick:undoDelete,
      title:"Put the beat you just deleted back in its place — with the scene's turn marker as it was"},
      React.createElement(Icon.undo,{s:12}),
      "Undo — restore deleted beat "+(lastDeleted.index+1)),
    hasScript && React.createElement("button",{className:"beat-build-btn primary",disabled:readOnly||deriving,
      onClick:()=>rebuildFromScript(blankMap),
      title:"Read this scene's screenplay and build the beat / subtext map from it (writing credits)"},
      React.createElement(Icon.sparkles,{s:12}),
      deriving ? "Reading the script…" : (blankMap ? "Build from script" : "Rebuild from script")),
    // ("Redraft script from beats" lives in the SCRIPT view's toolbar only —
    // the duplicate button here was removed by product decision 2026-07-13.)
    // provenance: which engine drafted this beat map (stamped as beats.by; hand-built
    // or pre-stamp maps have none). Hand-edits keep it — they refine, not re-author.
    (beats.by && beats.by.model) && React.createElement("div",{className:"beat-by-line",
      title:"Beat map drafted by "+beats.by.model+(beats.by.at?(" — "+new Date(beats.by.at).toLocaleString()):"")},
      React.createElement(Icon.sparkles,{s:12}),
      "Drafted by "+beats.by.model+(beats.by.at?(" · "+new Date(beats.by.at).toLocaleDateString(undefined,{month:"short",day:"numeric"})):"")),
    React.createElement("div",{className:"beat-labels"},
      React.createElement("div",{className:"cell"},
        React.createElement("div",{className:"obj-lab",style:{marginBottom:3}},"Driver"),
        React.createElement(EditText,{value:beats.driverLabel,readOnly,onCommit:v=>setField({driverLabel:v})})),
      React.createElement("div",{className:"cell"},
        React.createElement("div",{className:"obj-lab",style:{marginBottom:3}},"Reactor"),
        React.createElement(EditText,{value:beats.reactorLabel,readOnly,onCommit:v=>setField({reactorLabel:v})}))),
    React.createElement("div",{style:{marginBottom:10}},
      React.createElement("div",{className:"obj-lab",style:{marginBottom:3}},"Desire"),
      React.createElement(EditText,{value:beats.desire,readOnly,multiline:true,placeholder:"What the driver wants\u2026",onCommit:v=>setField({desire:v})}),
      React.createElement("div",{className:"obj-lab",style:{margin:"8px 0 3px"}},"Antagonism"),
      React.createElement(EditText,{value:beats.obstacle,readOnly,multiline:true,placeholder:"What blocks it\u2026",onCommit:v=>setField({obstacle:v})}),
      React.createElement("div",{className:"obj-lab",style:{margin:"8px 0 3px"}},"Result"),
      React.createElement(EditText,{value:beats.result||"",readOnly,multiline:true,placeholder:"What is resolved by the end of the scene\u2026",onCommit:v=>setField({result:v})})),

    beats.rows.map((r,i)=>
      React.createElement("div",{key:r.id, ref:(el)=>{ rowRefs.current[r.n]=el; },
        className:`beat-edit ${r.id===beats.turnBeatId?"turn":""} ${r.n===focusBeat?"focus":""}`},
        React.createElement("div",{className:"beat-edit-head"},
          React.createElement("span",{className:"bn"},r.n),
          React.createElement("button",{className:"beat-turn-btn",disabled:readOnly,onClick:()=>toggleTurn(r)},
            React.createElement(Icon.bolt,{s:10}), r.id===beats.turnBeatId?"Turning point":"Mark turn"),
          React.createElement("div",{className:"beat-edit-tools"},
            // spoken names + tooltips (2026-09-28: these were icon-only)
            React.createElement("button",{type:"button",className:"bx",disabled:readOnly||i===0,onClick:()=>moveBeat(i,-1),
              "aria-label":"Move beat "+r.n+" up",title:"Move beat up"},React.createElement(Icon.chevU,{s:14})),
            React.createElement("button",{type:"button",className:"bx",disabled:readOnly||i===beats.rows.length-1,onClick:()=>moveBeat(i,1),
              "aria-label":"Move beat "+r.n+" down",title:"Move beat down"},React.createElement(Icon.chevD,{s:14})),
            React.createElement("button",{type:"button",className:"bx",disabled:readOnly,onClick:()=>delBeat(i),
              "aria-label":"Delete beat "+r.n,title:"Delete beat"},React.createElement(Icon.x,{s:14})))),
        React.createElement("div",{className:"beat-edit-cols"},
          React.createElement("div",{className:"beat-edit-col"},
            React.createElement("div",{className:"clab"},beats.driverLabel||"Action"),
            React.createElement(EditText,{value:r.drive.a,readOnly,className:"bt-act",placeholder:"action",onCommit:v=>setCell(i,"drive","a",v)}),
            React.createElement(EditText,{value:r.drive.d,readOnly,className:"bt-beh",multiline:true,placeholder:"behaviour\u2026",onCommit:v=>setCell(i,"drive","d",v)})),
          React.createElement("div",{className:"beat-edit-col"},
            React.createElement("div",{className:"clab"},beats.reactorLabel||"Reaction"),
            React.createElement(EditText,{value:r.react.a,readOnly,className:"bt-act",placeholder:"reaction",onCommit:v=>setCell(i,"react","a",v)}),
            React.createElement(EditText,{value:r.react.d,readOnly,className:"bt-beh",multiline:true,placeholder:"behaviour\u2026",onCommit:v=>setCell(i,"react","d",v)})))) ),

    React.createElement("button",{className:"add-beat",disabled:readOnly,onClick:addBeat},
      React.createElement(Icon.plus,{s:14}),"Add beat"));
}

/* the beat marked as the turning point (Beats tab → Mark turn), as a sentence */
function turningBeatText(beats){
  const rows = (beats && beats.rows) || [];
  if(!rows.length) return "";
  const r = rows.find(x=>x && beats.turnBeatId && x.id===beats.turnBeatId) || (beats.turnAt ? rows[beats.turnAt-1] : null);
  if(!r) return "";
  const n = rows.indexOf(r)+1;
  const bit = (side)=> side && (side.d || side.a) ? String(side.d || side.a).replace(/\.$/,"") : "";
  return "Beat "+n+": "+[bit(r.drive), bit(r.react)].filter(Boolean).join(" \u2014 ")+".";
}

const ANALYSIS = (scene, beats) => [
  { lab:"Conflict", txt: React.createElement(React.Fragment,null,
      "Driver wants ", React.createElement("em",null,(scene.objective||"\u2014").replace(/^To /,"to ")),
      beats&&beats.obstacle ? React.createElement(React.Fragment,null,". Blocked by ",React.createElement("em",null,beats.obstacle.replace(/\.$/,""))) : ".") },
  { lab:"Opening Value", txt: React.createElement(React.Fragment,null,
      React.createElement("em",null,`${scene.openValue} (${chargeStr(scene.openCharge)})`)," \u2014 the charge at the door.") },
  { lab:"Beats", txt: beats
      ? `${beats.rows.length} action/reaction beats map the subtext beneath the dialogue.`
      : "Not yet broken into beats." },
  { lab:"Closing Value", txt: React.createElement(React.Fragment,null,
      React.createElement("em",null,`${scene.closeValue} (${chargeStr(scene.closeCharge)})`),
      (()=>{ const ti = turnInfo(scene), aud = (typeof fwAuditOf==="function") ? fwAuditOf() : {};
        const t = (typeof chargeTurn==="function") ? chargeTurn(scene.openCharge, scene.closeCharge) : ti;
        if(t.turned) return aud.analysisTurned || " \u2014 the value has reversed. The scene turns.";
        if(t.progression) return aud.analysisProg || " \u2014 intensified on the same side. A progression, not a turn.";
        if(ti.exempt) return " \u2014 settles, as its place in the structure allows.";
        return aud.analysisFlat || " \u2014 unchanged. Flat exposition."; })()) },
  { lab:"Turning Point", txt: turningBeatText(beats) || scene.turningPoint || "Mark the beat where the gap opens (Beats tab \u2192 Mark turn)." },
];

function Inspector({ scene, beats, draft, onCharge, onUpdate, characters, scenes, onAddScene, onDeleteScene, onMove, onBeats, stale, onRedraft,
                     unnamedValues, onNameAllValues, namingValues,
                     sceneIndex, sceneCount, onCollapse, project, tab:tabProp, onTab, focusBeat, readOnly }){
  // tab is controllable by the parent (e.g. the Script gutter opens the Beats tab);
  // falls back to local state when no controller is wired.
  const [tabState, setTabState] = React.useState("scene");
  const tab = tabProp || tabState;
  const setTab = onTab || setTabState;
  // driver options derive from the actual cast (plus the current value if it's an orphan)
  const driverOpts = (()=>{
    const list = (characters||[]).map(c=>[c.id, c.name]);
    if(scene && scene.driver && !list.some(o=>o[0]===scene.driver))
      list.push([scene.driver, scene.driver.charAt(0).toUpperCase()+scene.driver.slice(1)]);
    // no fallback to sample names — an empty cast means no driver options yet (add
    // cast first), never the Matrix sample's characters.
    return list;
  })();
  if(!scene) return React.createElement("div",{className:"inspector"},
    React.createElement("div",{style:{display:"flex",justifyContent:"flex-end",padding:"10px 12px 0"}},
      React.createElement("button",{className:"panel-collapse",onClick:onCollapse,title:"Collapse inspector"},
        React.createElement(Icon.chevR,{s:14}))),
    React.createElement("div",{className:"empty"},
      React.createElement(Icon.film,{s:34}),
      React.createElement("div",{className:"empty-t"},"No scene"),
      React.createElement("div",{className:"empty-d"},"Select a scene, or add one from the spine.")));

  const tabsBar = React.createElement("div",{className:"insp-tabs"},
    [["scene","Scene"],["beats","Beats"],["analysis","Analysis"]].map(([id,lab])=>
      React.createElement("button",{key:id,className:`insp-tab ${tab===id?"on":""}`,onClick:()=>setTab(id)},lab)),
    React.createElement("button",{className:"panel-collapse",onClick:onCollapse,title:"Collapse inspector",
      style:{marginLeft:"auto",alignSelf:"center",marginBottom:6}},React.createElement(Icon.chevR,{s:14})));

  return React.createElement("div",{className:"inspector"},
    tabsBar,
    React.createElement("div",{className:"insp-scroll"},
      tab==="scene" && React.createElement(React.Fragment,null,
        React.createElement("div",{className:"insp-eyebrow"},
          React.createElement("span",{className:"insp-scene-no"},String(scene.no).padStart(2,"0")),
          React.createElement("select",{className:"insp-select",value:scene.kind,disabled:readOnly,
            onChange:e=>onUpdate(scene.id,{kind:e.target.value})},
            (()=>{ const opts=kindOptsNow();
              const extra = opts.some(([v])=>v===scene.kind) ? [] : [[scene.kind, (typeof fwKindLabel==="function"&&fwKindLabel(scene.kind))||scene.kind]];
              return opts.concat(extra).map(([v,l])=>React.createElement("option",{key:v,value:v},l)); })())),
        React.createElement(EditText,{value:scene.title,readOnly,className:"insp-title",onCommit:v=>onUpdate(scene.id,{title:v})}),
        React.createElement(EditText,{value:scene.loc,readOnly,className:"loc",onCommit:v=>onUpdate(scene.id,{loc:v})}),
        React.createElement("div",{style:{height:8}}),
        React.createElement(EditText,{value:scene.summary,readOnly,className:"summary",multiline:true,onCommit:v=>onUpdate(scene.id,{summary:v})}),

        React.createElement("div",{className:"insp-block",style:{marginTop:16}},
          React.createElement("div",{className:"insp-block-head"},
            // one heading per block (owner 2026-10-19: no "Value Charge" over "Value at stake", no "Drive" over "Driver")
            React.createElement("span",{className:"eyebrow"},React.createElement(Icon.graph,{s:12}),"Value at stake")),
          React.createElement(ChargeEditor,{scene,onCharge,onUpdate,readOnly,unnamedValues,onNameAllValues,namingValues}),
          React.createElement("div",{style:{height:12}}),
          React.createElement(Verdict,{scene}),
          React.createElement(ReadNotes,{scene,project,onUpdate,readOnly}),
          // NEEDS REDRAFT — the card changed after this scene's script was written
          (stale && stale.length) ? React.createElement("div",{className:"insp-stale",role:"status"},
            React.createElement("span",null,React.createElement("b",null,"Script out of date: "),"changed since the draft \u2014 ",stale.join(", "),"."),
            onRedraft && React.createElement("button",{className:"char-draft-btn",disabled:readOnly,onClick:()=>onRedraft(scene)},
              React.createElement(Icon.sparkles,{s:12}),"Redraft script")) : null),

        // which side of the controlling idea this scene argues — auto-derived from the
        // closing charge (positive asserts the idea), overridable per scene
        (()=>{
          const cur = (typeof themeArgues==="function") ? themeArgues(scene)
            : {side: Math.sign(scene.closeCharge)>0?"idea":Math.sign(scene.closeCharge)<0?"counter":"neither", explicit:!!scene.argues};
          const ci = project && project.controllingIdea;
          const ideaT = (ci && ci.value) ? ci.value : "the story's idea";
          return React.createElement("div",{className:"insp-block"},
            React.createElement("div",{className:"insp-block-head"},
              React.createElement("span",{className:"eyebrow"},React.createElement(Icon.mask,{s:12}),"Argues · controlling idea"),
              !cur.explicit && React.createElement("span",{className:"argues-auto"},"auto")),
            React.createElement("div",{className:"argues-seg"},
              [["idea","Idea"],["counter","Counter-idea"],["neither","Neither"]].map(([v,l])=>
                React.createElement("button",{key:v,disabled:readOnly,
                  className:"argues-btn"+(cur.side===v?" on":""),
                  title: v==="idea" ? ("This scene asserts: "+ideaT)
                       : v==="counter" ? "This scene asserts the opposite — the counter-idea wins the moment"
                       : "This scene sits outside the argument",
                  // clicking the active explicit choice returns the scene to auto
                  onClick:()=>onUpdate(scene.id,{argues:(cur.side===v && cur.explicit) ? "" : v})},
                  l))),
            React.createElement("div",{className:"argues-hint"},
              cur.explicit
                ? "Set by you — click it again to go back to auto."
                : "Derived from the closing charge — a positive close asserts the idea. Click to override."));
        })(),

        React.createElement("div",{className:"insp-block"},
          React.createElement("div",{className:"insp-block-head"},
            React.createElement("span",{className:"eyebrow"},React.createElement(Icon.target,{s:12}),"Driver")),
          React.createElement("div",{className:"obj-row"},
            React.createElement("span",{className:"obj-icn"},React.createElement(Icon.user,{s:14})),
            React.createElement("div",{style:{flex:1}},
              React.createElement("select",{className:"insp-select",value:scene.driver,disabled:readOnly,"aria-label":"Driver",
                onChange:e=>onUpdate(scene.id,{driver:e.target.value})},
                driverOpts.map(([v,l])=>React.createElement("option",{key:v,value:v},l))),
              React.createElement("div",{style:{height:8}}),
              React.createElement(EditText,{value:scene.objective,readOnly,multiline:true,
                placeholder:"What the driver pursues in this scene\u2026",
                onCommit:v=>onUpdate(scene.id,{objective:v})})))),

        // CONFLICT: where the antagonism comes from (Source) and how it's conducted on the page (Style)
        React.createElement("div",{className:"insp-block"},
          React.createElement("div",{className:"insp-block-head"},
            React.createElement("span",{className:"eyebrow"},React.createElement(Icon.layers,{s:12}),"Conflict")),
          React.createElement("div",{className:"obj-row"},
            React.createElement("span",{className:"obj-icn"},React.createElement(Icon.layers,{s:14})),
            React.createElement("div",null,
              React.createElement("div",{className:"obj-lab",style:{marginBottom:5},
                title:"Where this scene's antagonism comes from: inner (the driver against their own mind), personal (family, friends, lovers) or extra-personal (institutions, society, the physical world). Set deliberately, it steers the next draft."},
                "Source \u00b7 ",["Inner","Personal","Extra-personal"][scene.conf-1]),
              React.createElement("div",{className:"conf-edit"},
                [1,2,3].map(i=>React.createElement("button",{key:i,className:`pip ${i<=scene.conf?"on":""}`,disabled:readOnly,
                  title:["Inner","Personal","Extra-personal"][i-1],
                  onClick:()=>onUpdate(scene.id,{conf:i, confAuthored:true})}))))),
          // conflict MODE — how the antagonism is conducted on the page (a dialogue
          // grammar). Auto = the drafter silently picks the fittest mode; locking one
          // binds every drafting/polish pass to it.
          React.createElement("div",{className:"obj-row"},
            React.createElement("span",{className:"obj-icn"},React.createElement(Icon.mask,{s:14})),
            // minWidth:0 lets the column shrink to the panel; without it the long option
            // labels size the select wider than the panel, under the scrollbar
            React.createElement("div",{style:{flex:1,minWidth:0}},
              React.createElement("div",{className:"obj-lab",style:{marginBottom:4},
                title:"How the antagonism is conducted on the page \u2014 the scene's dialogue grammar. Auto picks one per draft; a pick binds every draft of this scene."},"Style"),
              // an unrecognized stored value (legacy/import) displays — and behaves — as Auto
              React.createElement("select",{className:"insp-select insp-select-full",disabled:readOnly,
                value:((window.CONFLICT_MODES||[]).some(m=>m.id===scene.conflictMode) ? scene.conflictMode : ""),
                onChange:e=>onUpdate(scene.id,{conflictMode:e.target.value})},
                [React.createElement("option",{key:"",value:""},"Auto \u2014 picks per draft")].concat(
                  (window.CONFLICT_MODES||[]).map(m=>React.createElement("option",{key:m.id,value:m.id,title:m.def},
                    m.label+" \u2014 "+m.def.split("\u2014")[0].trim())))),
              React.createElement("div",{className:"argues-hint",style:{marginTop:5}},
                (scene.conflictMode && (window.CONFLICT_MODES||[]).some(m=>m.id===scene.conflictMode))
                  ? ((window.CONFLICT_MODES||[]).find(m=>m.id===scene.conflictMode).def)
                  : "How the antagonism is conducted \u2014 open combat, veiled courtesy, inner war\u2026 Locked here, every draft writes in it.")))),

        (typeof SceneContinuity==="function") && React.createElement(SceneContinuity,{scene,scenes,characters}),

        React.createElement("div",{className:"insp-actions"},
          React.createElement("button",{className:"ia-btn",disabled:readOnly||sceneIndex<=0,onClick:()=>onMove(scene.id,-1)},
            React.createElement(Icon.chevU,{s:14}),"Up"),
          React.createElement("button",{className:"ia-btn",disabled:readOnly||sceneIndex>=sceneCount-1,onClick:()=>onMove(scene.id,1)},
            React.createElement(Icon.chevD,{s:14}),"Down"),
          React.createElement("button",{className:"ia-btn",disabled:readOnly,onClick:()=>onAddScene(scene.id)},
            React.createElement(Icon.plus,{s:14}),"Add after"),
          // a film keeps at least one scene: the only scene's Delete says why instead of doing nothing (2026-10-09)
          React.createElement("button",{className:"ia-btn danger",disabled:readOnly||sceneCount<=1,
            title:sceneCount<=1 ? "A film keeps at least one scene \u2014 add another before deleting this one" : "Delete this scene (you can undo it)",
            onClick:()=>onDeleteScene(scene.id)},
            React.createElement(Icon.x,{s:14}),"Delete"))),

      tab==="beats" && React.createElement("div",{style:{paddingTop:2}},
        React.createElement("div",{className:"insp-eyebrow",style:{marginBottom:10}},
          React.createElement("span",{className:"insp-scene-no"},String(scene.no).padStart(2,"0")),
          React.createElement("span",{className:"eyebrow"},"Beat / Subtext map \u2014 "+(readOnly?"view only":"editable"))),
        React.createElement(BeatEditor,{scene,beats,onBeats,focusBeat,draft,characters,project,readOnly})),

      tab==="analysis" && React.createElement("div",{style:{paddingTop:2}},
        React.createElement("div",{className:"divider"},
          React.createElement("span",{className:"eyebrow"},"5-Step Scene Analysis"),
          React.createElement("span",{className:"ln"})),
        React.createElement("div",{className:"steps"},
          ANALYSIS(scene,beats).map((s,i)=>
            React.createElement("div",{key:i,className:"step-item"},
              React.createElement("div",{className:"step-num"},i+1),
              React.createElement("div",{className:"step-body"},
                React.createElement("div",{className:"step-lab"},s.lab),
                React.createElement("div",{className:"step-txt"},s.txt))))))),
  );
}
window.Inspector = Inspector;
