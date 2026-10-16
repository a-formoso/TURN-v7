/* app.jsx — compose Kinolot (codename TURN): state, views, tweaks */

const { PROJECT, CHARACTERS, SCENES, BEATS, SCREENPLAY, CONTINUITY, FACTS } = window.TURN_DATA;

/* Is this ledger's plan a REAL, paid subscription? Kinolot has NO free tier,
   so "", "none" (cancelled) AND "free" (the generic Get-started signup default) are
   all NOT active plans — only Writer/Director/Studio count. Every plan-gate check
   funnels through here so the app can't disagree with itself about what "on a plan"
   means (a new account's ledger comes back plan:"free", which must still be gated). */
window.turnIsPaidPlan = function(plan){
  const p = String(plan||"").toLowerCase().trim();
  // "trial" (the 50-credit free trial, 2026-09-30) is not a paid plan either
  return !!p && p!=="none" && p!=="free" && p!=="trial";
};

/* ORDER-INSENSITIVE JSON — the collaboration baseline compares section snapshots as
   JSON text, but Postgres (jsonb) rewrites object key order when it stores the doc.
   Plain JSON.stringify therefore never matches what comes back even when the DATA is
   identical, which made the "adopt collaborator changes" guard misfire on this
   window's own saves (phantom "Picked up changes a collaborator just made" toasts —
   and, worse, adopting a stale cloud copy over fresh local edits mid-agent-run).
   Every baseline write and comparison must go through this canonical form. */
function stableJson(v){
  if(v===null || typeof v!=="object") return JSON.stringify(v);
  // JSON rules for values JSON can't hold: null in arrays (holes included — map()
  // skipped them and emitted "[,1]", which JSON.parse rejects), dropped from objects.
  const skip = x=> x===undefined || typeof x==="function" || typeof x==="symbol";
  if(Array.isArray(v)) return "["+Array.from(v, x=> skip(x) ? "null" : stableJson(x)).join(",")+"]";
  const ks = Object.keys(v).filter(k=>!skip(v[k])).sort();
  return "{"+ks.map(k=>JSON.stringify(k)+":"+stableJson(v[k])).join(",")+"}";
}

/* ---- persistence: keep the user's edited story across refreshes ---- */
const STORY_KEY = "turn-story-v1";
function loadStory(){
  try{ const raw = localStorage.getItem(STORY_KEY); if(!raw) return null;
    const o = JSON.parse(raw); return (o && Array.isArray(o.scenes) && o.scenes.length) ? o : null;
  }catch(e){ return null; }
}
function clearStory(){ try{ localStorage.removeItem(STORY_KEY); }catch(e){} }

/* ---- navigation persistence (device-local, separate from the story doc) ----
   We keep the last room/view/artView in their own localStorage key so a refresh
   lands the user exactly where they were. It's read synchronously in the initial
   useState below — before first paint — and applyDoc never re-applies room, so
   cloud hydration can't flip it afterwards (that flip was the old Art Room flash). */
const NAV_KEY = "turn-nav-v1";
function loadNav(){ try{ return JSON.parse(localStorage.getItem(NAV_KEY)||"null")||{}; }catch(e){ return {}; } }
/* ART ROOM TAB PER FILM (2026-09-27, owner-approved). The Art Room tab used to be one device-wide
   value, so a brand-new film opened on whatever tab another film was left on (the owner saw Shots).
   NAV_KEY now also carries artViewByProject — { [projectId]: { v:tab, n:recency } }, capped to the
   NAV_ARTVIEW_CAP most recently used films. A film never opened in the Art Room starts on the
   Lookbook; returning to a film (switch, Home, a new Episode, New Story, reload) restores ITS last
   tab. nav.artView stays the last tab on screen, used only while no film is open (signed-out local
   mode, the moments before a film loads). The Writers' Room view memory is unchanged. */
const NAV_ARTVIEW_CAP = 50;
// Voices is no longer a tab — it lives on the character card
// a stale or unknown tab id opens the Lookbook (2026-10-09 — it showed "still loading… Reload" forever)
function turnNavArtTab(v){ const s0 = String(v||"").trim(); const s = s0==="voices" ? "characters" : s0;
  const known = (typeof window!=="undefined" && Array.isArray(window.ART_TABS)) ? window.ART_TABS.map(t=>t && t.id) : null;
  return (s && known && known.length && known.indexOf(s)<0) ? "lookbook" : s; }
function turnNavCapArtViews(map, cap){
  const lim = Math.max(1, Number(cap)||NAV_ARTVIEW_CAP);
  const keys = Object.keys(map||{});
  if(keys.length<=lim) return map;
  const out = {};
  keys.sort((a,b)=>(Number(map[b].n)||0)-(Number(map[a].n)||0)).slice(0,lim).forEach(k=>{ out[k]=map[k]; });
  return out;
}
// sanitize whatever NAV_KEY held (missing on devices that predate per-film memory → {})
function turnNavArtViewMap(raw, cap){
  const out = {};
  if(!raw || typeof raw!=="object" || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(k=>{
    const e = raw[k], v = turnNavArtTab(e && typeof e==="object" ? e.v : e);
    if(k && v) out[k] = { v, n:Number(e && e.n)||0 };
  });
  return turnNavCapArtViews(out, cap);
}
// the tab a film opens on: its own remembered tab, or the Lookbook for a film never opened in the Art Room
function turnNavArtViewFor(map, key){
  const e = key && map ? map[String(key)] : null;
  return (e && turnNavArtTab(e.v)) || "lookbook";
}
// remember `tab` for film `key` as its most recent entry (the same object back when nothing changes).
// `now` (App passes Date.now()) makes the recency a wall-clock stamp, so two open windows can tell
// whose entry for a film is newer when they merge (turnNavMergeArtViews); it never goes backwards.
function turnNavRememberArtView(map, key, tab, cap, now){
  const k = String(key||""), v = turnNavArtTab(tab), m = map || {};
  if(!k || !v) return m;
  const top = Object.keys(m).reduce((a,x)=>Math.max(a, Number(m[x] && m[x].n)||0), 0);
  const cur = m[k];
  if(cur && cur.v===v && (Number(cur.n)||0)===top) return m;
  return turnNavCapArtViews({ ...m, [k]:{ v, n:Math.max(top+1, Number(now)||0) } }, cap);
}
/* TWO WINDOWS: each window holds its own copy of the map, so a plain write would erase the films
   another window remembered since this one loaded. Merge per film instead — the newer stamp wins, a
   tie keeps this window's (`local`) entry — then cap. Returns `local` itself when the stored map adds
   nothing newer (no re-render, no loop). */
function turnNavMergeArtViews(stored, local, cap){
  const s = stored || {}, l = local || {};
  let out = null;
  Object.keys(s).forEach(k=>{
    const a = s[k], b = l[k];
    if(!a || (b && (Number(b.n)||0) >= (Number(a.n)||0))) return;
    if(!out) out = { ...l };
    out[k] = a;
  });
  return out ? turnNavCapArtViews(out, cap) : l;
}
/* LOOKBOOK FIRST (2026-09-27, owner-approved — docs/Story Pipeline.md step 9): one pure decision for
   the silent cast auto-draft (the effect lives in App). "start" = draft the undrafted cast now;
   "latch" = everyone already has a spec (set visualsSeeded); "wait" = not now — the effect re-checks
   whenever an input changes (tab, Lookbook, cast, an agent run starting or ending, a film switch).
   canWrite: the draft writes `characters` + `visualsSeeded`, so it runs only for someone whose saves
   keep both (owner / Art director, never while the film is loading). A Writer or View-only collaborator
   can open the Art Room, but autosave rolls those sections back for them — a latch there looped
   latch → rollback → latch, and a start spent their credits on a draft that was thrown away.
   latched: a latch is written once per film per session, so nothing can ever loop on it. */
function turnAgentRunsActive(runs){
  return !!runs && typeof runs==="object" && Object.keys(runs).some(k=>(Number(runs[k])||0)>0);
}
function turnCastAutoDraftStep(s){
  s = s || {};
  if(!s.canWrite) return "wait";                                    // role can't save the cast (or film loading)
  if(s.visualsSeeded || s.hydrating) return "wait";
  if(s.room!=="art") return "wait";
  const cast = Array.isArray(s.characters) ? s.characters : [];
  if(!cast.length) return "wait";                                   // wait for hydration
  const hasLook = (typeof window.lookbookHasLook==="function") && window.lookbookHasLook(s.lookbook, s.lookbookNote);
  if(!hasLook) return "wait";                                       // no Lookbook yet → nothing silent
  if(s.artView==="lookbook") return "wait";                         // still curating the look
  if(turnAgentRunsActive(s.agentRuns)) return "wait";               // e.g. Run pre-production drafts the cast itself
  if(s.draftingAll) return "wait";                                  // a Draft all is already running
  const drafted = (typeof s.drafted==="function") ? s.drafted : (()=>true);
  if(!cast.some(c=>!drafted(c))) return s.latched ? "wait" : "latch";
  // NO SILENT SPENDING (2026-10-03, owner): the cast is drafted only when the user asks (Draft
  // all / Design the cast). The old silent pass is kept behind window.TURN_CAST_AUTO_DRAFT===true.
  if(s.autoDraft===false) return "wait";
  if(s.tried) return "wait";                                        // once per film per session
  return "start";
}
/* The reverse gate: while a Draft all (manual or the silent auto-draft) is drafting the cast, an
   agent that drafts the cast — Run pre-production, Design the cast, a Characters re-draft from the
   Lookbook — would work from a snapshot of the SAME undrafted characters and pay to draft them twice.
   Say so and let the user start it once the specs land (a few seconds, not a lock). */
function turnCastDraftingBlocksAgent(draftingAll, what){
  if(!draftingAll) return false;
  if(typeof window.appToast==="function") window.appToast((what||"That")+" can start as soon as the cast's specs "
    +"finish drafting — starting it now would draft the same characters twice.","info");
  return true;
}
function turnFirstStoryScene(scenes){
  const ordered = (typeof scenesInStoryOrder==="function")
    ? scenesInStoryOrder(scenes) : (Array.isArray(scenes)?scenes:[]);
  return ordered[0] || null;
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "grade": "Teal & Orange",
  "density": "regular",
  "display": "Grotesk",
  "grain": false,
  "premium": false
}/*EDITMODE-END*/;

/* darken/saturate an oklch color for legibility on light surfaces */
function shadeOklch(str, dL, dC){
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(str);
  if(!m) return str;
  const L = Math.max(0, Math.min(1, parseFloat(m[1]) + (dL||0)));
  const C = Math.max(0, parseFloat(m[2]) + (dC||0));
  return "oklch("+L.toFixed(3)+" "+C.toFixed(3)+" "+m[3]+")";
}

const GRADES = {
  "Teal & Orange": { pos:"oklch(0.78 0.15 62)", posH:"62", neg:"oklch(0.72 0.10 232)", negH:"232" },
  "Amber & Indigo":{ pos:"oklch(0.80 0.15 85)", posH:"85", neg:"oklch(0.62 0.14 280)", negH:"280" },
  "Ember & Ice":   { pos:"oklch(0.68 0.18 35)", posH:"35", neg:"oklch(0.74 0.09 210)", negH:"210" },
};

function StudioProgressOverlay({ title, detail, progress, role, onStop, stopping }){
  const pct = progress==null ? null : Math.max(0, Math.min(100, Math.round(progress)));
  // THE RUNNING TIME (window family, owner 2026-10-16): "1:42 so far" from the fifth second, so a long draft
  // never looks frozen. One component kept on window, so a re-render (a progress tick) never restarts it; it is
  // hidden from screen readers — the live region would otherwise announce the card every second.
  const G = (typeof window!=="undefined") ? window : globalThis;
  const Elapsed = G.__turnProgressElapsed || (G.__turnProgressElapsed = function ProgressElapsed(){
    const [t0] = React.useState(()=>Date.now());
    const [now, setNow] = React.useState(t0);
    React.useEffect(()=>{ const id = setInterval(()=>setNow(Date.now()), 1000); return ()=>clearInterval(id); },[]);
    const s = Math.max(0, Math.floor((now - t0)/1000));
    if(s < 5) return null;
    return React.createElement("span",{className:"studio-progress-time","aria-hidden":"true"},
      Math.floor(s/60)+":"+String(s%60).padStart(2,"0")+" so far");
  });
  return React.createElement("div",{className:"redraft-overlay studio-progress-overlay",
    role:"status","aria-live":"polite","aria-atomic":"true","aria-label":title},
    React.createElement("div",{className:"redraft-card studio-progress-card"},
      React.createElement("div",{className:"studio-progress-head"},
        React.createElement("span",{className:"orb"}),
        // the eyebrow names the department doing the work (its job title), the title the work —
        // no persona: the help assistant, Frances, only answers (owner, 2026-09-28)
        role && React.createElement("div",{className:"redraft-role"},role),),
      React.createElement("div",{className:"redraft-t"},title),
      detail && React.createElement("div",{className:"redraft-d"},detail),
      pct!=null && React.createElement("div",{className:"studio-progress-bar",role:"progressbar",
        "aria-label":"Progress","aria-valuemin":0,"aria-valuemax":100,"aria-valuenow":pct},
        React.createElement("i",{style:{width:pct+"%"}})),
      // a long batch (Auto-draft all) can be stopped between scenes (2026-09-28)
      onStop ? React.createElement("div",{className:"studio-progress-foot"},
        React.createElement(Elapsed,null),
        React.createElement("button",{type:"button",className:"appconfirm-btn ghost",
          disabled:!!stopping, onClick:onStop},
          stopping ? "Stopping\u2026" : "Stop"))
        : React.createElement(Elapsed,null)));
}

/* ---- alternate view: Turn Audit table ---- */
function TurnAudit({ scenes, selId, onSelect }){
  // the framework's own audit line and act names (the Board's columns use the same names)
  const fwT = (typeof frameworkOf==="function") ? frameworkOf(window.turnProject) : null;
  const ROMAN_T = ["I","II","III","IV"];
  const actLabel = (a)=> "Act "+(ROMAN_T[a-1]||a)+" \u00b7 "+((fwT&&fwT.acts&&fwT.acts[a])||("Act "+a));
  const tableTitle = (fwT && fwT.audit && fwT.audit.tableTitle) || "Turn audit · every scene turns";
  return React.createElement(DragScroll,{className:"canvas-scroll",style:{padding:"18px 28px 40px"}},
    React.createElement("div",{style:{maxWidth:880,margin:"0 auto"}},
      React.createElement("div",{className:"divider"},
        React.createElement("span",{className:"eyebrow"},tableTitle),
        React.createElement("span",{className:"ln"})),
      // the table keeps its desktop column widths and scrolls SIDEWAYS inside its
      // own container on narrow screens (minWidth stops the columns crushing)
      React.createElement("div",{className:"audit-tablewrap"},
        React.createElement("div",{style:{border:"1px solid var(--line)",borderRadius:"var(--r-l)",overflow:"hidden",minWidth:620}},
          React.createElement("div",{style:{display:"grid",gridTemplateColumns:"44px 1fr 120px 150px 110px",
            background:"var(--bg-2)",borderBottom:"1px solid var(--line)"}},
            ["#","Scene","Charge","Value shift","Verdict"].map((h,i)=>
              React.createElement("div",{key:i,style:{padding:"10px 14px",fontFamily:"var(--f-mono)",
                fontSize:9,letterSpacing:".1em",textTransform:"uppercase",color:"var(--txt-2)",
                borderLeft:i?"1px solid var(--line)":"none"}},h))),
          scenes.map(s=>{
            return React.createElement("div",{key:s.id,onClick:()=>onSelect(s.id),
              style:{display:"grid",gridTemplateColumns:"44px 1fr 120px 150px 110px",cursor:"pointer",
                borderBottom:"1px solid var(--line)",background:s.id===selId?"var(--bg-3)":"transparent",
                alignItems:"center"}},
              React.createElement("div",{style:{padding:"12px 14px",fontFamily:"var(--f-mono)",fontSize:11,color:"var(--txt-3)",fontWeight:700}},String(s.no).padStart(2,"0")),
              React.createElement("div",{style:{padding:"12px 14px",borderLeft:"1px solid var(--line)"}},
                React.createElement("div",{style:{fontFamily:"var(--f-display)",fontSize:13,color:"var(--txt-0)",fontWeight:500}},s.title),
                React.createElement("div",{style:{fontFamily:"var(--f-mono)",fontSize:9.5,color:"var(--txt-3)",marginTop:2}},
                  actLabel(s.act)+(s.seq?" · "+s.seq:""),KIND_LABEL[s.kind]?(" · "+KIND_LABEL[s.kind]):"")),
              React.createElement("div",{style:{padding:"12px 14px",borderLeft:"1px solid var(--line)",display:"flex",alignItems:"center",gap:6}},
                React.createElement(ChargeChip,{value:s.openCharge}),
                React.createElement("span",{style:{color:"var(--txt-3)",display:"flex"}},React.createElement(Icon.arrowSmall,{s:12})),
                React.createElement(ChargeChip,{value:s.closeCharge})),
              React.createElement("div",{style:{padding:"12px 14px",borderLeft:"1px solid var(--line)",fontSize:11.5,color:"var(--txt-1)"}},
                `${s.openValue} \u2192 ${s.closeValue}`),
              React.createElement("div",{style:{padding:"12px 14px",borderLeft:"1px solid var(--line)"}},
                React.createElement(TurnBadge,{scene:s})));
          }))),
      React.createElement("div",{className:"audit-mobile-list"},
        scenes.map(s=>{
          return React.createElement("button",{key:s.id,type:"button",className:"audit-mobile-card"+(s.id===selId?" sel":""),
            onClick:()=>onSelect(s.id)},
            React.createElement("div",{className:"audit-mobile-top"},
              React.createElement("span",{className:"audit-mobile-no"},String(s.no).padStart(2,"0")),
              React.createElement(TurnBadge,{scene:s})),
            React.createElement("div",{className:"audit-mobile-title"},s.title),
            React.createElement("div",{className:"audit-mobile-meta"},
              actLabel(s.act)+(s.seq?" · "+s.seq:""),KIND_LABEL[s.kind]?(" · "+KIND_LABEL[s.kind]):""),
            React.createElement("div",{className:"audit-mobile-charge"},
              React.createElement(ChargeChip,{value:s.openCharge}),
              React.createElement("span",{className:"audit-mobile-arrow"},React.createElement(Icon.arrowSmall,{s:12})),
              React.createElement(ChargeChip,{value:s.closeCharge})),
            React.createElement("div",{className:"audit-mobile-shift"},`${s.openValue} \u2192 ${s.closeValue}`));
        }))));
}

/* ---- alternate view: Board (acts as columns) ---- */
function Board({ scenes, selId, onSelect }){
  // act columns come from the FRAMEWORK (three-act → 3 columns, Kishōtenketsu → 4)
  const fwB = (typeof frameworkOf==="function") ? frameworkOf(window.turnProject) : null;
  const actNos = fwB ? Object.keys(fwB.acts).map(Number) : [1,2,3];
  const acts=actNos.map(a=>({act:a,scenes:scenes.filter(s=>s.act===a)}));
  const ROMAN=["I","II","III","IV"];
  const titles={}; actNos.forEach(a=>{ titles[a]="Act "+(ROMAN[a-1]||a)+" · "+((fwB&&fwB.acts[a])||["Setup","Complication","Resolution"][a-1]||("Act "+a)); });
  // per-act fold state (persisted) — collapse an act column to a narrow strip to
  // focus on the act you're working in.
  const [collapsed,setCollapsed]=React.useState(()=>{ try{ return JSON.parse(localStorage.getItem("turn_board_collapsed")||"{}")||{}; }catch(e){ return {}; } });
  React.useEffect(()=>{ try{ localStorage.setItem("turn_board_collapsed",JSON.stringify(collapsed)); }catch(e){} },[collapsed]);
  const toggle=(act)=> setCollapsed(c=>({...c,[act]:!c[act]}));
  // keyboard: a clickable card or strip answers Enter and Space like a button (2026-09-28)
  const keyActivate=(fn)=>(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); fn(); } };
  return React.createElement(DragScroll,{className:"canvas-scroll board-pan",style:{padding:"18px 22px 40px"}},
    React.createElement("div",{style:{display:"flex",gap:14,minWidth:"max-content"}},
      acts.map(a=>{
        const roman=["I","II","III","IV"][a.act-1]||String(a.act);
        // collapsed → a slim, clickable vertical strip
        if(collapsed[a.act]) return React.createElement("div",{key:a.act,className:"board-act-strip",
          role:"button",tabIndex:0,"aria-label":`Expand ${titles[a.act]}`,onKeyDown:keyActivate(()=>toggle(a.act)),
          onClick:()=>toggle(a.act),title:`Expand ${titles[a.act]}`,
          style:{width:46,flex:"0 0 46px",alignSelf:"flex-start",cursor:"pointer",
            display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"10px 0",
            border:"1px solid var(--line)",borderRadius:"var(--r-m)",background:"var(--bg-1)"}},
          React.createElement(Icon.chevR,{s:14}),
          React.createElement("span",{className:"tree-act-no"},roman),
          React.createElement("span",{style:{writingMode:"vertical-rl",fontFamily:"var(--f-display)",fontSize:12,
            fontWeight:500,color:"var(--txt-2)",letterSpacing:".02em"}},titles[a.act].split("· ")[1]),
          React.createElement("span",{style:{fontFamily:"var(--f-mono)",fontSize:10,color:"var(--txt-3)"}},a.scenes.length));
        return React.createElement("div",{key:a.act,style:{width:300,flex:"0 0 300px"}},
          React.createElement("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"0 2px"}},
            React.createElement("button",{className:"board-act-fold",onClick:()=>toggle(a.act),
              title:`Collapse ${titles[a.act]}`,
              style:{display:"flex",border:0,background:"transparent",cursor:"pointer",color:"var(--txt-2)",padding:2}},
              React.createElement(Icon.chevD,{s:14})),
            React.createElement("span",{className:"tree-act-no"},roman),
            React.createElement("span",{style:{fontFamily:"var(--f-display)",fontSize:13,fontWeight:500}},titles[a.act].split("· ")[1]),
            React.createElement("span",{style:{fontFamily:"var(--f-mono)",fontSize:10,color:"var(--txt-3)",marginLeft:"auto"}},a.scenes.length)),
          React.createElement("div",{style:{display:"flex",flexDirection:"column",gap:8}},
            a.scenes.map(s=>{
              const {flagged}=turnInfo(s);
              return React.createElement("div",{key:s.id,onClick:()=>onSelect(s.id),
                role:"button",tabIndex:0,"aria-pressed":s.id===selId,"aria-label":"Scene "+s.no+(s.title?": "+s.title:""),
                onKeyDown:keyActivate(()=>onSelect(s.id)),
                className:`scard ${s.id===selId?"sel":""}`,
                style:{width:"auto",borderRadius:"var(--r-m)",border:"1px solid var(--line)",borderTop:"1px solid var(--line)"}},
                React.createElement("div",{className:"scard-top"},
                  React.createElement("span",{className:"scard-no"},String(s.no).padStart(2,"0")),
                  KIND_LABEL[s.kind]&&React.createElement("span",{className:"eyebrow",style:{fontSize:8.5}},KIND_LABEL[s.kind]),
                  React.createElement("div",{className:"scard-conf",style:{marginLeft:"auto"}},
                    [1,2,3].map(i=>React.createElement("span",{key:i,className:`conf-pip ${i<=s.conf?"on":""}`})))),
                React.createElement("div",{className:"scard-title"},s.title),
                React.createElement("div",{style:{fontSize:11,color:"var(--txt-2)",lineHeight:1.4,
                  display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}},s.summary),
                React.createElement("div",{className:"scard-charge"},
                  React.createElement(ChargeChip,{value:s.openCharge}),
                  React.createElement("span",{className:"chip-arrow"},React.createElement(Icon.arrowSmall,{s:12})),
                  React.createElement(ChargeChip,{value:s.closeCharge}),
                  flagged&&React.createElement("span",{className:"tree-flag",style:{marginLeft:"auto"}},React.createElement(Icon.alert,{s:14})),
                  !flagged&&turnInfo(s).progression&&React.createElement("span",{className:"tree-flag prog",style:{marginLeft:"auto"},title:"Progresses \u2014 intensifies on the same side instead of reversing"},React.createElement(Icon.arrowSmall,{s:14}))));
            })));})));
}

/* viewport mode — drives responsive layout (mobile drawers vs desktop columns) */
function useViewport(){
  const get = ()=> typeof window==="undefined" ? "desktop"
    : window.innerWidth < 700 ? "mobile" : window.innerWidth < 1100 ? "tablet" : "desktop";
  const [vp, setVp] = React.useState(get);
  React.useEffect(()=>{
    let raf;
    const onR = ()=>{ cancelAnimationFrame(raf); raf = requestAnimationFrame(()=>setVp(get())); };
    window.addEventListener("resize", onR);
    return ()=>{ window.removeEventListener("resize", onR); cancelAnimationFrame(raf); };
  },[]);
  return vp;
}

/* ============================================================================
   THE FILM BIBLE — one canonical JSON the whole studio reads from.

   This is a DETERMINISTIC PROJECTION of the live story state, never a second
   AI-authored copy: a generated parallel doc would itself drift and contradict
   the data it's meant to guard. Instead it RESOLVES the continuity graph from
   the single source of truth (the project doc) — props (worn/carried) tied to
   their owning characters, characters tied to the scenes they appear in, set
   dressing tied to its location — so every department reads the same relations
   and the AI can't go off-brand or contradict itself across tabs. Exposed on
   window for the Admin JSON viewer and any external/Stage consumer. ---------- */
function buildFilmBible(doc){
  doc = doc || {};
  const project = doc.project || {};
  const scenes = doc.scenes || [];
  const characters = doc.characters || [];
  const props = doc.props || [];
  const locations = doc.locations || [];
  const drafts = doc.drafts || {};
  const lookbook = doc.lookbook || [];
  const ordered = scenesInStoryOrder(scenes);
  const noOf = {}; ordered.forEach(s=>{ noOf[s.id]=s.no; });
  const charById = {}; characters.forEach(c=>{ charById[c.id]=c; });
  const undef = (x)=>{ const v=(x==null?"":String(x)).trim(); return v||undefined; };
  const appears = (typeof scenesWhereCharacterAppears==="function") ? scenesWhereCharacterAppears : (()=>[]);
  const locForScene = (sid)=> (typeof locationForScene==="function") ? locationForScene(locations, sid) : null;
  const sb = (typeof styleBibleOf==="function") ? styleBibleOf(project) : {};

  // ---- resolve the edges once ----
  const scenesOfChar = {};                 // charId -> [sceneNo], by story order
  characters.forEach(c=>{ scenesOfChar[c.id] = appears(c.id, c.name, ordered, drafts).map(id=>noOf[id]).filter(n=>n!=null); });
  const shotsOfScene = {}; (doc.shots||[]).forEach(sh=>{ (shotsOfScene[sh.sceneId]=shotsOfScene[sh.sceneId]||[]).push(sh); });
  // ONE authoritative roster — sceneRoster (honours a hand-authored scene.cast, else the
  // union of driver + script presence + every shot's in-frame cast). The same function the
  // rest of the pipeline reads, so the bible can't disagree with what the shots reference.
  const charsInScene = (s)=> (typeof sceneRoster==="function")
    ? sceneRoster(s, characters, drafts, shotsOfScene[s.id]||[])
    : (s.driver && charById[s.driver] ? [s.driver] : []);
  const sceneNosOfProp = (p)=> (Array.isArray(p.scenes)?p.scenes:[]).map(id=>noOf[id]).filter(n=>n!=null);
  const envPropsOfLoc = (l)=> props.filter(p=> !p.ownerId && !p.ownerName && (p.kind||"carried")!=="worn"
    && (p.locationId ? p.locationId===l.id
        : (Array.isArray(p.scenes) && p.scenes.length
            && Array.from(new Set(p.scenes.map(sid=>{const m=locForScene(sid);return m?m.id:"";}).filter(Boolean))).join()===l.id)))
    .map(p=>p.name);

  return {
    film: {
      title: undef(project.title), genre: undef(project.genre), logline: undef(project.logline||project.premise),
      controlling_idea: (project.controllingIdea && Object.keys(project.controllingIdea).length) ? project.controllingIdea : undefined,
      setting: project.setting || undefined,
      format: undef(project.format), framework: undef(project.framework),
    },
    look: {
      visual_statement: undef(doc.lookbookNote),
      film_stock: undef(sb.filmStock && sb.filmStock!=="none" ? sb.filmStock : ""),
      references: undef((sb.refs||"")),
      palette_presets: (sb.presets||[]).map(p=>({ id:p.id, name:p.name, palette:p.palette })),
      lookbook: (typeof lookbookLive==="function" ? lookbookLive(lookbook) : lookbook).filter(c=>(c.note||"").trim()).map(c=>({ source:c.source, category:c.category, note:c.note })),
    },
    characters: characters.map(c=>({
      id: c.id, name: c.name, role: undef(c.role),
      wants: undef(c.conscious), fear: undef(c.unconscious), arc: undef(c.arc),
      physique: (c.physique && Object.keys(c.physique).length) ? c.physique : undefined,
      distinguishing_features: undef(typeof window.charScriptFeatures==="function" ? window.charScriptFeatures(c) : c.scriptFeatures),
      wardrobe: undef(c.wardrobeMask||c.wardrobe),
      worn: undef(c.accessories), carried: undef(c.props),
      appears_in_scenes: scenesOfChar[c.id],
      appearance_states: (c.states||[]).map(s=>s.label).filter(Boolean),
      sheet_id: c.id,
    })),
    props: props.map(p=>{
      const identity=(typeof propIdentityOf==="function")?propIdentityOf(p):{};
      const o = { id:p.id, name:p.name, default_binding:(p.bindingMode||p.kind||"carried") };
      if(p.ownerName||p.ownerId){ o.owner_origin = p.ownerName || (charById[p.ownerId]||{}).name || p.ownerId; }
      else { const L = p.locationId ? locations.find(x=>x.id===p.locationId) : null; if(L) o.fixture_of_location = L.name; }
      o.custodian=undef(p.custodianName||((charById[p.custodianId]||{}).name));
      o.design_association=undef(identity.associationName||identity.associationId);
      o.default_placement=undef(p.placement||((locations.find(x=>x.id===(p.placementLocationId||p.locationId))||{}).name));
      o.continuity_events=(p.continuityEvents||[]).map(e=>({type:e.type,scene:e.sceneId,beat:e.beatId||e.beatN,
        micro_beat:e.microBeatId||e.microBeatN,shot:e.shotId,holder:e.holderName||e.toCharacterName,
        placement:e.placement||e.note,condition:e.condition}));
      o.form = undef(p.form); o.material = undef(p.material);
      // a worn prop with no stored map is present wherever its owner is — resolve it here
      // so the bible is complete even for props seeded before worn-mapping existed.
      let sc = sceneNosOfProp(p);
      if(!sc.length && (p.kind||"carried")==="worn" && (p.ownerId||p.ownerName)){
        const oc = charById[p.ownerId]; sc = appears(p.ownerId, (oc&&oc.name)||p.ownerName, ordered, drafts).map(id=>noOf[id]).filter(n=>n!=null);
      }
      o.scenes = sc; o.sheet_id = p.id;
      return o;
    }),
    locations: locations.map(l=>({
      id: l.id, name: l.name, int_ext: l.intExt||"INT",
      scope:l.scope||"atomic", continuity_root:l.parentKey||l.continuityRootKey||l.key,
      parent_location:l.parentKey?((locations.find(x=>x&&x.key===l.parentKey)||{}).name||l.parentKey):undefined,
      times: l.times || undefined,
      architecture:undef(l.architecture), materials:undef(l.materials),
      permanent_lighting_interfaces:undef(l.lighting), permanent_dressing:undef(l.permanentDressing),
      spatial_topology:undef(l.topology), continuity_anchors:undef(l.continuityAnchors),
      scenes: ordered.filter(s=>{ const m=locForScene(s.id); return m&&m.id===l.id; }).map(s=>s.no),
      environment_props: (()=>{ const e=envPropsOfLoc(l); return e.length?e:undefined; })(),
      sheet_id: l.id,
    })),
    scenes: ordered.map(s=>{
      const loc = locForScene(s.id);
      const preset = (typeof scenePreset==="function") ? scenePreset(project, s.id) : null;
      return {
        no: s.no, id: s.id, title: undef(s.title), slug: undef(s.loc),
        value_charge: (typeof s.charge==="number") ? s.charge : undefined,
        driver: s.driver ? ((charById[s.driver]||{}).name || s.driver) : undefined,
        characters: charsInScene(s).map(id=>(charById[id]||{}).name||id),
        cast_authored: (Array.isArray(s.cast) && s.cast.length) ? true : undefined,
        props: props.filter(p=>{ const rs=(typeof propStateAt==="function")?propStateAt(p,s.id,null,null,null,doc):null;
          return rs ? rs.active : (Array.isArray(p.scenes)&&p.scenes.indexOf(s.id)>=0); }).map(p=>p.name),
        location: loc ? loc.name : undefined,
        preset: preset ? preset.name : undefined,
        summary: undef(s.summary),
      };
    }),
  };
}
window.buildFilmBible = buildFilmBible;

/* HOME WALL ELIGIBILITY — the dashboard shows once the user has >=2 films OR
   any film shared with them (the wall is where a share is explained: owner +
   role). One shared predicate so the render gate and onHome can never drift. */
window.turnHomeWallEligible = function(rows){
  const f = (rows||[]).filter(p=>!((window.turnSeries&&typeof window.turnSeries.isShowDoc==="function")
    ? window.turnSeries.isShowDoc(p)
    : p&&(String(p.project_kind||"").toLowerCase()==="show"||String(p.isShow).toLowerCase()==="true")));
  return f.length >= 2 || f.some(p=>p.isShared);
};

function App(){
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const saved = React.useRef(loadStory()).current;
  const isShowProject = p=>(window.turnSeries&&typeof window.turnSeries.isShowDoc==="function")
    ? window.turnSeries.isShowDoc(p)
    : !!(p&&(String(p.project_kind||"").toLowerCase()==="show"||String(p.isShow).toLowerCase()==="true"));
  const nav = React.useRef(loadNav()).current;   // device-local last room/view/artView
  // Clean canvas for everyone: with no saved local story, start EMPTY (not the Matrix
  // sample). A real saved story is still restored. The Matrix lives only in a user's
  // own saved/cloud projects + the seed (story-data.jsx, used by tests/sample).
  const [scenes, setScenes] = React.useState(()=> (saved && saved.scenes) || []);
  const [characters, setCharacters] = React.useState(()=>{
    const loaded = (saved && saved.characters) || [];
    const pruned = typeof window.turnPruneAccidentalManualCast==="function"
      ? window.turnPruneAccidentalManualCast(loaded, saved||{}) : loaded;
    // the psychology check's stray "_revised" note never stays on a loaded cast (cast-policy.js)
    return typeof window.turnStripStrayRevised==="function" ? window.turnStripStrayRevised(pruned) : pruned;
  });
  const [props, setProps] = React.useState(()=> (saved && saved.props) || []);
  const [locations, setLocations] = React.useState(()=> (saved && saved.locations) || []);
  // slugline-unit OVERLAYS (key + appearance/notes/images only) — the unit skeletons
  // themselves derive live from the script (see sluglineUnits below); never persisted.
  const [slugUnitsOv, setSlugUnitsOv] = React.useState(()=> (saved && saved.sluglineUnits) || []);
  const updateSlugUnitOverlay = (key, patch)=> setSlugUnitsOv(ov=>
    (typeof upsertSluglineUnitOverlay==="function") ? upsertSluglineUnitOverlay(ov, key, patch) : ov);
  // explicit delete (orphan units) — removes the stored overlay record entirely
  const removeSlugUnitOverlay = (key)=> setSlugUnitsOv(ov=> (ov||[]).filter(o=>o && o.key!==key));
  const [lookbook, setLookbook] = React.useState(()=> (saved && saved.lookbook) || []);
  const [lookbookNote, setLookbookNote] = React.useState(()=> (saved && saved.lookbookNote) || "");
  // per-department: the lookbook brief in effect the last time that dept was fully drafted (for staleness)
  const [lookbookApplied, setLookbookApplied] = React.useState(()=> (saved && saved.lookbookApplied) || {});
  const [shots, setShots] = React.useState(()=> (saved && saved.shots) || []);
  const shotsRef = React.useRef(shots); shotsRef.current = shots;   // the live list, for callbacks that run later (Undo)
  const [project, setProject] = React.useState(()=> (saved && saved.project) || ({ title:"Untitled film", genre:"", logline:"", controllingIdea:{} }));
  // Live world snapshot for lifecycle operations that await a save/confirmation.
  // Reading the ref after the await avoids converting an older render's Bible.
  const seriesSnapshotRef = React.useRef(null);
  // Story Contract (outer plot · inner arc · dominance) — patch helper for the rail panel
  // story edits check the Writers' Room right themselves, not only the UI (2026-10-09)
  const updateContract = (patch)=>{ if(!canMutateWritersRoom()) return; setProject(p=>({ ...p, contract:{ ...((p&&p.contract)||{}), ...patch } })); };
  const updateGenre = (genre)=>{ if(!canMutateWritersRoom()) return; setProject(p=>({ ...p, genre:String(genre||"").trim() })); };
  // story-level inputs edited in the left rail (premise, controlling idea, Center of
  // Good, setting, synopsis by act) — a patch object, or a function of the project
  const updateProjectFields = (patch)=>{
    if(!canMutateWritersRoom()) return;
    setProject(p=>({ ...p, ...(typeof patch==="function" ? patch(p) : patch) }));
  };
  // project augmented with the Lookbook references routed to one department, so each drafter's
  // prompt honours only its relevant references (see lookbookBriefFor / _lookbookBlock).
  const lbProject = (dept)=> ({ ...project, _lookbookBrief:(typeof lookbookBriefFor==="function" ? lookbookBriefFor(dept, lookbook, lookbookNote) : "") });
  // record that a department now reflects the current Lookbook (clears its "stale" flag)
  // the department's Lookbook brief for drafters outside App state (a carried prop drafted by a Shots render)
  React.useEffect(()=>{ window.turnLookbookBriefFor = (dept)=> (typeof lookbookBriefFor==="function" ? lookbookBriefFor(dept, lookbook, lookbookNote) : ""); },[lookbook, lookbookNote]);
  const markApplied = (dept)=> setLookbookApplied(m=> ({ ...m, [dept]:(typeof lookbookBriefFor==="function" ? lookbookBriefFor(dept, lookbook, lookbookNote) : "") }));
  const [selId, setSelId] = React.useState(()=> (saved && saved.selId) || null);
  const [selChar, setSelChar] = React.useState(null);
  // "follow this character" lens on the Spine view — session-only (not persisted)
  const [followChar, setFollowChar] = React.useState(null);
  // Restore the room the user last had open (Writers' or Art) from the device-local
  // NAV_KEY — read synchronously so it's correct on first paint. applyDoc never
  // re-applies room, so cloud hydration can't flip it (that flip was the old flash).
  const [room, setRoom] = React.useState(()=> nav.room || "writers");
  // The Art Room TAB is remembered PER FILM (see turnNavArtViewMap) and derived further down, once
  // the open film's id is known: artViewByProject holds each film's last tab; artViewNoFilm is the
  // tab shown while no film is open (signed-out local mode, the moments before a film loads).
  const [artViewByProject, setArtViewByProject] = React.useState(()=> turnNavArtViewMap(nav.artViewByProject));
  const [artViewNoFilm, setArtViewNoFilm] = React.useState(()=> turnNavArtTab(nav.artView || (saved && saved.artView)) || "lookbook");
  // once-per-story guard so auto-seeding the Props tab from the cast doesn't
  // re-add props the user has deliberately deleted.
  const [propsSeeded, setPropsSeeded] = React.useState(()=> !!(saved && saved.propsSeeded));
  const [locsSeeded, setLocsSeeded] = React.useState(()=> !!(saved && saved.locsSeeded));
  // once-per-story guard so the cast is auto-drafted once (after the Lookbook has a look —
  // see "LOOKBOOK FIRST" below), not re-drafted on every visit, plus the set of character ids
  // currently being drafted so each card can show its own inline "Drafting…" status.
  const [visualsSeeded, setVisualsSeeded] = React.useState(()=> !!(saved && saved.visualsSeeded));
  // RECENTLY DELETED (restore bin): deleting a character/prop/location/shot moves the full
  // object here (with its scenes + spec + generated sheet kept) so it can be restored.
  const _emptyTrash = ()=>({ characters:[], props:[], locations:[], shots:[] });
  const [trash, setTrash] = React.useState(()=> (saved && saved.trash) || _emptyTrash());
  const trashRef = React.useRef(trash); trashRef.current=trash;
  seriesSnapshotRef.current = {project,characters,locations,props,lookbook,lookbookNote,trash};
  const [draftingVisualIds, setDraftingVisualIds] = React.useState([]);
  const draftingVisualIdsRef = React.useRef([]); draftingVisualIdsRef.current = draftingVisualIds;
  const [draftingVisualId, setDraftingVisualId] = React.useState(null);
  // the former Audit tab ("beats") is now the Board's Table layout
  const _initialView = nav.view || (saved && saved.view) || "spine";
  const [view, setView] = React.useState(()=> _initialView==="beats" ? "board" : _initialView);
  const [boardMode, setBoardModeState] = React.useState(()=>{
    if(_initialView==="beats") return "table";
    try{ return localStorage.getItem("turn_board_mode")==="table" ? "table" : "columns"; }catch(e){ return "columns"; }
  });
  const setBoardMode = (m)=>{ setBoardModeState(m); try{ localStorage.setItem("turn_board_mode", m); }catch(e){} };
  const vp = useViewport();
  // both side panels use the SAME mechanics: in-layout (a persistent collapsed strip when
  // closed, pushes the canvas when open) on tablet + desktop; an overlay drawer only on
  // mobile. Previously the rail drawered on tablet too — it overlaid the hero and vanished
  // when closed, unlike the inspector.
  const railDrawer = vp === "mobile";
  const inspDrawer = vp === "mobile";
  const [railOpen, setRailOpen] = React.useState(()=> typeof window==="undefined" || window.innerWidth>=1100);
  const [inspOpen, setInspOpen] = React.useState(()=> typeof window==="undefined" || window.innerWidth>=700);
  // Project hydration and New Story completion are asynchronous. Keep the current
  // Inspector state available to those paths without letting an old render decide
  // whether a newly loaded film needs its default scene.
  const inspOpenRef = React.useRef(inspOpen); inspOpenRef.current = inspOpen;
  const [inspTab, setInspTab] = React.useState("scene");   // controlled Inspector tab (Scene / Beats / Analysis)
  const [focusBeat, setFocusBeat] = React.useState(null);  // beat # to reveal in the Beats editor (set from the Script gutter)
  // A story must never leave an already-open Inspector pointing at nothing. This
  // also catches the moment a New Story agent first publishes its asynchronously
  // built scenes. A valid user selection is left alone except at that deliberate
  // empty-story -> first-scene boundary, where Scene 1 is the required default.
  const hadScenesRef = React.useRef(scenes.length>0);
  React.useEffect(()=>{
    const hadScenes = hadScenesRef.current;
    hadScenesRef.current = scenes.length>0;
    if(!inspOpen || !scenes.length) return;
    const justGainedFirstScene = !hadScenes;
    if(!justGainedFirstScene && scenes.some(s=>s && s.id===selId)) return;
    const first = turnFirstStoryScene(scenes);
    if(!first) return;
    setSelId(first.id); setSelChar(null); setFocusBeat(null); setRailOpen(false);
  },[inspOpen, scenes, selId]);
  // when crossing a breakpoint, snap panels to a sane default for that size
  const lastVp = React.useRef(vp);
  React.useEffect(()=>{
    if(lastVp.current === vp){ return; }
    if(vp==="desktop"){ setRailOpen(true); setInspOpen(true); }
    else if(vp==="tablet"){ setRailOpen(false); setInspOpen(true); }
    else { setRailOpen(false); setInspOpen(false); }
    lastVp.current = vp;
  },[vp]);
  // on mobile, only one overlay at a time — and on a TABLET only one side panel at a time too
  // (2026-09-28): the two 380px panels side by side left the Spine/Script canvas a few pixels wide
  const excl = ()=> vp==="mobile" || vp==="tablet";
  const toggleRail = ()=> setRailOpen(o=>{ const n=!o; if(n && excl()){ setInspOpen(false); } return n; });
  const toggleInsp = ()=> setInspOpen(o=>{ const n=!o; if(n && excl()){ setRailOpen(false); } return n; });
  const openRail = ()=>{ setRailOpen(true); if(excl()) setInspOpen(false); };
  const openInsp = ()=>{ setInspOpen(true); if(excl()) setRailOpen(false); };
  const [drafts, setDrafts] = React.useState(()=> (saved && saved.drafts) || ({}));
  const [drafting, setDrafting] = React.useState(null);
  const [beatsMap, setBeatsMap] = React.useState(()=> (saved && saved.beatsMap) || ({}));
  const [history, setHistory] = React.useState(()=> (saved && saved.history) || {});   // {sceneId:{back:[ver...], fwd:[ver...]}}
  const [continuityMap, setContinuityMap] = React.useState(()=> (saved && saved.continuityMap) || {});
  const [agentsOpen, setAgentsOpen] = React.useState(false);
  const [coloristOpen, setColoristOpen] = React.useState(false);   // Cinematographer / Colorist (Art Room)
  const coloristRedoManualRef = React.useRef(false);   // "Also redo the scenes I picked by hand" for this run
  const [shotDesignerOpen, setShotDesignerOpen] = React.useState(false);   // Shot Designer (Art Room)
  const [productionOpen, setProductionOpen] = React.useState(false);   // Production check (Art Room)
  const [castingOpen, setCastingOpen] = React.useState(false);   // Casting Director (Art Room)
  const [propsMasterOpen, setPropsMasterOpen] = React.useState(false);   // Props Master (Art Room)
  const [locScoutOpen, setLocScoutOpen] = React.useState(false);   // Location Scout (Art Room)
  // when an agent is opened via the Lookbook "Re-draft & regenerate" action, run it in force mode
  const [castingForce, setCastingForce] = React.useState(false);   // false | true | "draft" | {only:[ids]|null, variants}
  const [castConfirm, setCastConfirm] = React.useState(null);      // Design the cast's preview: {sceneId, sceneNo, sceneIds} | null
  const [propsMasterForce, setPropsMasterForce] = React.useState(false);
  const [locScoutForce, setLocScoutForce] = React.useState(false);
  // ---- Lookbook staleness: which Art Room tabs are out of date vs the current Lookbook ----
  // Memoized so it only recomputes when a real input changes — the App re-renders on
  // every keystroke/autosave across the studio, and this needn't recompute each time.
  const staleTabs = React.useMemo(()=>{
    // LOCATIONS gate on cards EXISTING (not fully drafted): master location cards are
    // pulled from screenplay headings long before they're drafted, so requiring a full draft
    // meant the "Lookbook changed" banner couldn't appear until the first Draft & Generate.
    // Counting present cards lets it appear the moment the Lookbook diverges from what was
    // last applied — there's something to apply it to. (Characters/props stay on the
    // drafted gate: the cast AUTO-drafts once the Lookbook has a look (LOOKBOOK FIRST), and gating on
    // mere existence would pop a false banner right after that silent draft; both are usually drafted
    // via their batch anyway, so the strict gate rarely bites there.)
    const lbContentFlags = {
      characters: (characters||[]).some(c=> (typeof charVisualsDrafted==="function") ? charVisualsDrafted(c) : !!(c&&c.id)),
      props: (props||[]).some(p=> (typeof propVisualsDrafted==="function") ? propVisualsDrafted(p) : false),
      locations: (locations||[]).some(l=> l && l.id),
      colorist: !!(project && project.styleBible && project.styleBible.sceneStyles && Object.keys(project.styleBible.sceneStyles).length),
      shots: (shots||[]).length>0,
    };
    // the cards each department DRAFTED (a location only pulled from a slugline isn't one)
    const lbCards = {
      characters:(characters||[]).filter(c=>c && (typeof charVisualsDrafted==="function" ? charVisualsDrafted(c) : true)),
      props:(props||[]).filter(p=>p && (typeof propVisualsDrafted==="function" ? propVisualsDrafted(p) : false)),
      locations:(locations||[]).filter(l=>l && (typeof locVisualsDrafted==="function" ? locVisualsDrafted(l) : false)),
    };
    const staleDepts = (typeof lookbookStaleDepts==="function") ? lookbookStaleDepts(lookbook, lookbookNote, lookbookApplied, lbContentFlags, lbCards) : {};
    const t = {};
    if(staleDepts.characters) t.characters = true;
    if(staleDepts.props) t.props = true;
    if(staleDepts.locations) t.locations = true;
    if(staleDepts.colorist) t.stylebible = true;
    if(staleDepts.shots) t.shots = true;
    return t;
  },[lookbook, lookbookNote, lookbookApplied, characters, props, locations, shots, project]);
  // ---- Art Room TAB LOCKS: the tabs unlock in pipeline order (2026-09-27, owner-approved —
  // docs/Story Pipeline.md step 9). One pure decision (app/art-tab-locks.js) shared by the tab bar,
  // the phone ⋮ menu and the Art Room's lock card. A series episode's state already holds the Show
  // Bible's shared cast / props / locations / Lookbook, so it unlocks from those. A tab that already
  // has content is never locked; a locked tab stays visible and its click shows the lock card.
  // No story yet → no locks: the whole Art Room is gated behind the onboarding then (emptyCanvas).
  // `trash` rides along: a tab's "Recently deleted" bin is content (its restore lives in the tab).
  const artTabLocksOf = (s)=> ((s.scenes||[]).length && typeof window.turnArtTabLocks==="function")
    ? window.turnArtTabLocks(s) : {};
  const artLockInputs = { project, characters, props, locations, shots, trash, lookbook, lookbookNote, scenes };
  const artLockInputsRef = React.useRef(artLockInputs); artLockInputsRef.current = artLockInputs;
  // Some content is an IMAGE the doc doesn't hold: a character sheet in the image cache (the cloud
  // URL cache fills after the first paint) or a reference image dropped on a Lookbook card (it lives
  // in the <image-slot> store, not in `lookbook`). Re-check the locks when those land, and re-render
  // only when the answer actually changes.
  const [artLockTick, setArtLockTick] = React.useState(0);
  const artTabLocks = React.useMemo(()=> artTabLocksOf(artLockInputs),
    [project, characters, props, locations, shots, trash, lookbook, lookbookNote, scenes, artLockTick]);
  const artTabLocksRef = React.useRef(artTabLocks); artTabLocksRef.current = artTabLocks;
  React.useEffect(()=>{
    const sig = (r)=> JSON.stringify(Object.keys(r||{}).map(k=>[k, !!r[k].locked, r[k].waitingFor||""]));
    const recheck = ()=>{
      try{ if(sig(artTabLocksOf(artLockInputsRef.current))!==sig(artTabLocksRef.current)) setArtLockTick(t=>t+1); }catch(e){}
    };
    const evs = ["nb-prefetched","nb-gen-done","image-slot-change"];
    evs.forEach(ev=>window.addEventListener(ev, recheck));
    return ()=>evs.forEach(ev=>window.removeEventListener(ev, recheck));
  },[]);
  const artTabLocked = (tab)=> !!(artTabLocks && artTabLocks[tab] && artTabLocks[tab].locked);
  // re-draft one department from the updated Lookbook (confirm first; agent runs in force
  // mode). mode "full" (default) also regenerates the sheets; mode "draft" re-drafts the
  // specs only and leaves every generated image untouched — regenerate later, when ready.
  const applyLookbook = async (dept, mode)=>{
    if(!canMutateSharedFilm()) return;   // (2026-10-08) every banner action changes the film
    if(mode==="review"){
      const label = ({ shots:"Shots", characters:"Characters", props:"Props", locations:"Locations", colorist:"Color" })[dept] || dept;
      let ok = true;
      if(typeof window.appConfirm==="function") ok = await window.appConfirm({
        title:"Mark "+label+" reviewed?",
        body:"This records that you reviewed the existing work against the current Lookbook. It does not regenerate, replace, or delete any output.",
        confirmLabel:"Mark reviewed"
      });
      if(ok) markApplied(dept);
      return;
    }
    // (Shots has no apply action: its new and re-drafted shots follow the Lookbook, and the Shot
    //  Designer only re-plans scenes whose coverage has issues — so its banner offers "Mark reviewed")
    if(dept==="shots") return;
    // Color's action is Light the film again: a PROPOSAL (nothing changes until you approve it), and the
    // scenes you set by hand keep their look — the generic "overwrites… regenerates its sheets" was wrong here
    if(dept==="colorist"){
      let ok = true;
      if(typeof window.appConfirm==="function") ok = await window.appConfirm({
        title:"Light the film again from the updated Lookbook?",
        body:"The Colorist designs a new palette and film stock and color-scripts the scenes, then shows it to you to approve. Approving replaces this film's looks, including any you edited; scenes you set by hand (\u270b) keep theirs. Writing credits only, no images (a little more when it looks at your reference stills).",
        confirmLabel:"Light the film" });
      if(!ok) return;
      coloristRedoManualRef.current = false; setColoristOpen(true);
      return;
    }
    const draftOnly = mode==="draft";
    const label = { characters:"Characters", props:"Props", locations:"Locations" }[dept] || dept;
    if(dept==="characters" && turnCastDraftingBlocksAgent(draftingAllVisualsRef.current, "Re-drafting Characters")) return;
    // WHAT IT WILL COST, UP FRONT (owner 2026-10-06 — Lookbook review): the re-draft is writing credits for
    // every drafted card; "& regenerate" also re-renders their images (an upper bound — text-only props skip)
    const draftedN = dept==="characters" ? (characters||[]).filter(c=>typeof charVisualsDrafted==="function" ? charVisualsDrafted(c) : true).length
      : dept==="props" ? (props||[]).filter(p=>typeof propVisualsDrafted==="function" ? propVisualsDrafted(p) : true).length
      : (locations||[]).filter(l=>typeof locVisualsDrafted==="function" ? locVisualsDrafted(l) : true).length;
    // Locations also regenerates each place's environment states (2026-10-08 — the price left them out)
    const stateN = dept==="locations" && typeof locationAppearanceStates==="function"
      ? (locations||[]).filter(l=>typeof locVisualsDrafted==="function" ? locVisualsDrafted(l) : true)
          .reduce((n,l)=>{ try{ return n + (locationAppearanceStates(l, sluglineUnits||[])||[]).length; }catch(e){ return n; } }, 0) : 0;
    const imgN = draftedN + stateN;
    const imgPrice = (!draftOnly && imgN && typeof window.nbImageCostText==="function") ? window.nbImageCostText(imgN) : "";
    const costLine = " Cost: writing credits for "+draftedN+" spec"+(draftedN===1?"":"s")
      +(draftOnly ? "." : (imgPrice ? ", plus up to "+imgN+" image"+(imgN===1?"":"s")+(stateN ? " ("+stateN+" of them environment states)" : "")+" (about "+imgPrice+" credit"+(imgPrice==="1"?"":"s")+")." : ", plus the images."));
    let ok = true;
    if(typeof window.appConfirm==="function"){
      ok = await window.appConfirm(draftOnly
        ? { title:"Re-draft "+label+" specs?",
            body:"This re-drafts every spec in "+label+" from the updated Lookbook — overwriting the current specs, including any manual edits — but leaves all generated images untouched. Regenerate them whenever you're ready.",
            note:costLine.trim(), confirmLabel:"Re-draft only", danger:true }
        : { title:"Re-draft & regenerate "+label+"?",
            body:"This re-drafts every spec in "+label+" from the updated Lookbook and regenerates its sheets. It overwrites the current specs, including any manual edits (a render style you picked is kept).",
            note:costLine.trim(), confirmLabel:"Re-draft & regenerate", danger:true });
    }
    if(!ok) return;
    const f = draftOnly ? "draft" : true;
    if(dept==="characters" && turnCastDraftingBlocksAgent(draftingAllVisualsRef.current, "Re-drafting Characters")) return;
    if(dept==="characters"){ setCastingForce(f); setCastingOpen(true); }
    else if(dept==="props"){ setPropsMasterForce(f); setPropsMasterOpen(true); }
    else if(dept==="locations"){ setLocScoutForce(f); setLocScoutOpen(true); }
  };
  const [researchOpen, setResearchOpen] = React.useState(false);   // Visual Researcher (Lookbook)
  const lookbookFreshRef = React.useRef(false);   // "Research from scratch" pending — read (once) by the next research
  const [coordOpen, setCoordOpen] = React.useState(false);   // Art Coordinator (meta-agent)
  const [coordConfirm, setCoordConfirm] = React.useState(false);  // cost/scope preview gate before it runs
  const [newStoryOpen, setNewStoryOpen] = React.useState(false);

  // ---- cloud auth (Supabase) ----
  const [session, setSession] = React.useState(null);
  const [authOpen, setAuthOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState("signin");   // which tab the auth modal opens on
  const [authReady, setAuthReady] = React.useState(false);    // has the initial session check resolved?
  const openAuth = (mode, opts)=>{
    if(!(opts && opts.keepPlanIntent)){
      try{ localStorage.removeItem("turn-intended-plan"); localStorage.removeItem("turn-intended-plan-at"); localStorage.removeItem("turn-stage-waitlist-intent"); }catch(e){}
      setIntendedPlan(null);
    }
    setAuthMode(mode==="signup"?"signup":"signin"); setAuthOpen(true);
  };

  // Intended plan from the landing pricing CTAs. Persisted to localStorage so checkout /
  // onboarding can read which tier the visitor chose AFTER they sign up:
  //   window.turnIntendedPlan()  -> "free" | "pro" | "studio" | null
  //   window.turnClearIntendedPlan()  (call once checkout has consumed it)
  const [intendedPlan, setIntendedPlan] = React.useState(()=>{ try{ return localStorage.getItem("turn-intended-plan")||null; }catch(e){ return null; } });
  const startWithPlan = (plan)=>{
    // carry the tier the visitor chose on the landing pricing cards through signup:
    // writer/director/studio (a real plan) or "free" for the generic Get-started CTA.
    const valid = (window.CINEMA_PLANS||[]).some(p=>String(p.tier).toLowerCase()===String(plan).toLowerCase());
    const p = valid ? String(plan).toLowerCase() : "free";
    try{ localStorage.setItem("turn-intended-plan", p); localStorage.setItem("turn-intended-plan-at", String(Date.now())); }catch(e){}
    setIntendedPlan(p); openAuth("signup", { keepPlanIntent:true });
  };
  // the sign-up window's plan dropdown (auth-ui.jsx): the new pick replaces the saved one and
  // restarts its clock — a fresh choice, read by cloudSignUp and the checkout after sign-up
  const changeIntendedPlan = (plan)=>{
    const p = String(plan||"").toLowerCase();
    // "free" = No plan yet (no checkout after sign-up) — the same value the generic Get started uses
    if(p!=="free" && !(window.CINEMA_PLANS||[]).some(x=>String(x.tier).toLowerCase()===p)) return;
    try{ localStorage.setItem("turn-intended-plan", p); localStorage.setItem("turn-intended-plan-at", String(Date.now())); }catch(e){}
    setIntendedPlan(p);
  };
  React.useEffect(()=>{
    window.turnIntendedPlan = ()=>{ try{ return localStorage.getItem("turn-intended-plan")||null; }catch(e){ return null; } };
    window.turnClearIntendedPlan = ()=>{ try{ localStorage.removeItem("turn-intended-plan"); localStorage.removeItem("turn-intended-plan-at"); }catch(e){} setIntendedPlan(null); };
  },[]);
  // WELCOME MOMENT — Stripe's after-payment redirect returns the buyer to
  // /?welcome=1 (set on each payment link's after-payment URL). Show the
  // "your plan is live" card once, and strip the param so a refresh doesn't re-show.
  const [welcomeOpen, setWelcomeOpen] = React.useState(()=>{
    try{ return new URLSearchParams(window.location.search).has("welcome"); }catch(e){ return false; }
  });
  // which plan the after-payment URL says was bought (/?welcome=1&plan=<tier>), if any
  const [welcomePlan] = React.useState(()=>{
    try{
      let p = String(new URLSearchParams(window.location.search).get("plan")||"").toLowerCase().trim();
      if(p==="producer") p = "studio";   // the Producer plan's tier id is "studio"
      return ["writer","director","studio"].indexOf(p)>=0 ? p : "";
    }catch(e){ return ""; }
  });
  const [creditPackOpen, setCreditPackOpen] = React.useState(()=>{
    try{
      const qs = new URLSearchParams(window.location.search);
      return qs.has("credits") || qs.has("credit_pack");
    }catch(e){ return false; }
  });
  React.useEffect(()=>{
    if(!welcomeOpen && !creditPackOpen) return;
    try{ const u = new URL(window.location.href); u.searchParams.delete("welcome"); u.searchParams.delete("plan"); u.searchParams.delete("credits"); u.searchParams.delete("credit_pack");
      window.history.replaceState({}, "", u.pathname + (u.searchParams.toString()?("?"+u.searchParams.toString()):"") + u.hash); }catch(e){}
  },[]);
  /* INVITE ACCEPTANCE LANDING — /?invite=<projectId> is where every invitation
     email lands (set as the redirect by the invite-collaborator function). The
     id is captured once, stripped from the URL, and drives the welcome surface
     after sign-in. Team is paused (owner decision 2026-10-02): no invitation emails go
     out, so this is unreachable in practice; kept for the relaunch. It only names a film
     already shared with this account and opens it — it never adds, changes or removes a
     member (team.jsx InviteWelcome; test-team-paused.mjs). */
  const [inviteLanding, setInviteLanding] = React.useState(()=>{
    try{ return new URLSearchParams(window.location.search).get("invite") || null; }catch(e){ return null; }
  });
  // films newly LINKED to this account this sign-in (rpc claim); null = not run yet
  const [inviteClaims, setInviteClaims] = React.useState(null);
  React.useEffect(()=>{
    if(!inviteLanding) return;
    try{ const u = new URL(window.location.href); u.searchParams.delete("invite");
      window.history.replaceState({}, "", u.pathname + (u.searchParams.toString()?("?"+u.searchParams.toString()):"") + u.hash); }catch(e){}
    // An EXPIRED/used invite link arrives as #error_description=... (Supabase auth
    // redirect). Surface it — otherwise the visitor sees a plain landing page and
    // no clue their link died.
    try{
      const h = new URLSearchParams(String(window.location.hash||"").replace(/^#/,""));
      const desc = h.get("error_description");
      if(desc && typeof window.appToast==="function")
        window.appToast("That sign-in link didn't work: "+desc.replace(/\+/g," ")+". Please sign in with your email and password.","error");
      if(desc){ window.history.replaceState({}, "", window.location.pathname + window.location.search); }
    }catch(e){}
  },[]);
  // PLAN-LESS SIGNUP / TEAM ONBOARDING — generic auth should land in the app.
  // Locked room/action gates can still ask for a plan exactly when the user needs one.
  React.useEffect(()=>{
    if(!(session && session.user)) return;
    if(intendedPlan!=="free") return;
    if(!creditBalance) return;                         // wait for the ledger to load
    try{ localStorage.removeItem("turn-intended-plan"); localStorage.removeItem("turn-intended-plan-at"); localStorage.removeItem("turn-stage-waitlist-intent"); }catch(e){}
    setIntendedPlan(null);                             // fires once, then never again
  },[session, intendedPlan, creditBalance]);
  // load the admin's plan-card copy overrides (global, public-read) so the plan cards
  // and landing pricing show the edited copy for everyone, including signed-out visitors.
  React.useEffect(()=>{
    (async()=>{ try{
      if(typeof window.cloudGetAppConfig!=="function") return;
      const ov = await window.cloudGetAppConfig("plans-copy");
      if(ov && typeof window.turnApplyPlanCopy==="function") window.turnApplyPlanCopy(ov);
    }catch(e){} })();
    // pricing overrides (admin-applied fal price updates) load the same way —
    // globally, for everyone — so credit costs derive from the CURRENT numbers.
    (async()=>{ try{
      if(typeof window.turnPricingWatchLoadOverrides==="function") await window.turnPricingWatchLoadOverrides();
    }catch(e){} })();
    // THE LIVE CREDIT UNIT (billing fixes, 2026-09-30): $0.03 a credit until the owner runs
    // billing-switch.sql, $0.01 after — read for everyone (signed out too), and again when the
    // tab comes back after a while, so a tab left open across the switch re-quotes on its own.
    // REPAIR 2026-09-30: a read that fails (a network error, not a missing function) is retried after
    // 30 seconds, up to 3 times — until a read lands, the trial line, the packs and the plan cards'
    // numbers stay hidden (app/plans.jsx creditRegimeKnown) — and an open tab looks again every 5
    // minutes while visible, and on coming back to the front after a minute, so it follows the switch
    // within about 5 minutes (at once on a reload).
    let regimeAt = 0, regimeRetries = 0, regimeRetryT = 0, regimeGone = false;
    const loadRegime = (minGapMs)=>{
      if(regimeGone || typeof window.cloudLoadCreditRegime!=="function") return;
      if(Date.now() - regimeAt < (minGapMs==null ? 60*1000 : minGapMs)) return;
      regimeAt = Date.now();
      Promise.resolve().then(()=>window.cloudLoadCreditRegime()).then(r=>{
        if(r){ regimeRetries = 0; return; }
        if(regimeGone || regimeRetries >= 3) return;
        regimeRetries++; clearTimeout(regimeRetryT);
        regimeRetryT = setTimeout(()=>loadRegime(0), 30*1000);
      }).catch(()=>{});
    };
    loadRegime(0);
    const onRegimeFocus = ()=>{ try{ if(document.visibilityState!=="hidden") loadRegime(); }catch(e){} };
    window.addEventListener("focus", onRegimeFocus);
    document.addEventListener("visibilitychange", onRegimeFocus);
    const regimeTick = setInterval(()=>{ try{ if(document.visibilityState!=="hidden") loadRegime(4*60*1000); }catch(e){} }, 5*60*1000);
    // a server "price changed" refusal can mean the unit just switched: read it again now
    const onRefusal = (e)=>{ if(e && e.detail && e.detail.code==="price_changed"){ loadRegime(0); } };
    window.addEventListener("turn-credits-changed", onRefusal);
    return ()=>{
      regimeGone = true; clearTimeout(regimeRetryT); clearInterval(regimeTick);
      window.removeEventListener("focus", onRegimeFocus);
      document.removeEventListener("visibilitychange", onRegimeFocus);
      window.removeEventListener("turn-credits-changed", onRefusal);
    };
  },[]);
  React.useEffect(()=>{
    if(!(typeof cloudConfigured==="function" && cloudConfigured())){ setAuthReady(true); return; }
    let alive = true;
    let unsub = ()=>{};
    // Subscribe first. If getSession is waiting behind a stale browser auth lock,
    // the INITIAL_SESSION / TOKEN_REFRESHED event can still restore the session.
    unsub = cloudOnAuth((s)=>{ if(alive) setSession(s); });
    (async()=>{
      try{
        const s=await cloudGetSession();
        if(alive && s) setSession(s);
      }catch(e){}
      if(alive) setAuthReady(true);   // landing/app gate waits for this so signed-in users never flash the landing
    })();
    return ()=>{ alive=false; try{ unsub(); }catch(e){} };
  },[]);
  const signOut = async ()=>{
    if(currentProjectId && !(await flushPendingProjectSave(currentProjectId))){
      if(typeof window.appToast==="function") window.appToast(
        "Your latest changes have not saved yet. You’ll stay signed in so they aren’t lost.","error");
      return false;
    }
    try{ await cloudSignOut(); }catch(e){}
    setSession(null);
    return true;
  };

  // ---- cloud projects + doc sync ----
  const [projects, setProjects] = React.useState([]);
  const [homeOpen, setHomeOpen] = React.useState(false);   // Home / Dashboard overlay (only shown at >=2 films)
  const homeOpenRef = React.useRef(false); homeOpenRef.current = homeOpen;
  const [currentProjectId, setCurrentProjectId] = React.useState(null);
  const [cloudConnectionState,setCloudConnectionState] = React.useState("connecting"); // connecting | retrying | connected | idle
  const [projectLoading, setProjectLoading] = React.useState(false);
  const projectLoadingRef = React.useRef(false); projectLoadingRef.current=projectLoading;
  // LIVE mirror of the open film's id. Long async work (agent runs, scene drafting,
  // image generation) captures the id it started under and compares it against this
  // before writing results into state — the film switcher stays live throughout, and a
  // result that lands after a switch belongs to a film that is no longer open.
  const projIdRef = React.useRef(null); projIdRef.current = currentProjectId;
  try{ window.turnOpenFilmId = currentProjectId; }catch(e){}   // for work that must land on the film it started in (Color's stills)
  const cloudMode = !!(session && currentProjectId);
  /* ART ROOM TAB PER FILM — derived, never synced by an effect: the tab on screen is always THIS
     film's remembered tab (the Lookbook for a film never opened in the Art Room), so a switch can
     never paint — or record — another film's tab on the new one. */
  const artViewKey = currentProjectId ? String(currentProjectId) : "";
  const artViewKeyRef = React.useRef(artViewKey); artViewKeyRef.current = artViewKey;
  const artView = artViewKey ? turnNavArtViewFor(artViewByProject, artViewKey) : artViewNoFilm;
  // record a tab for a SPECIFIC film (the film just created, before React has re-rendered onto it).
  // Merged with NAV_KEY first, so this choice is stamped newer than anything another open window
  // saved — the user's latest pick always wins, whatever the windows' clocks and counters say.
  const setArtViewFor = (key, tab)=>{
    const v = turnNavArtTab(tab); if(!v) return;
    if(key) setArtViewByProject(m=> turnNavRememberArtView(
      turnNavMergeArtViews(turnNavArtViewMap(loadNav().artViewByProject), m), key, v, undefined, Date.now()));
    setArtViewNoFilm(v);
  };
  const setArtView = (tab)=> setArtViewFor(artViewKeyRef.current, typeof tab==="function" ? tab(artView) : tab);
  // opening a film first picks up any newer tab another open window saved for it (NAV_KEY), then
  // bumps the film's recency so the cap forgets the films opened longest ago. A layout effect, so a
  // tab restored from the other window lands before paint (no flash of the Lookbook).
  React.useLayoutEffect(()=>{
    if(!artViewKey) return;
    setArtViewByProject(m=>{
      const next = turnNavMergeArtViews(turnNavArtViewMap(loadNav().artViewByProject), m);
      return next[artViewKey] ? turnNavRememberArtView(next, artViewKey, next[artViewKey].v, undefined, Date.now()) : next;
    });
  },[artViewKey]);
  /* WHICH FILM a long cast draft belongs to: the cloud film's id, or the signed-out "local" slot plus
     its generation (a signed-out New Story bumps localStoryGenRef — the slot is reused). The silent
     auto-draft keys its once-guard on it, and draftAllVisuals drops a result that lands after a switch. */
  const localStoryGenRef = React.useRef(0);
  const castDraftFilmKey = ()=> projIdRef.current ? "film:"+projIdRef.current : "local:"+localStoryGenRef.current;
  // FILM TOKEN for async work (2026-09-28): capture window.turnFilmToken() before an await, then pass
  // it to onEditScene / onBeats (commitVersion / setBeatsFor drop a stale one) or check
  // window.turnSameFilm(token) — a Redraft, script.jsx "Write this beat", the Inspector's beat maps.
  // Scene ids repeat across films, so a late result must land only in the film it was asked for.
  window.turnFilmToken = castDraftFilmKey;
  window.turnSameFilm = (tok)=> tok===castDraftFilmKey();
  /* SHARE ROLE on the open film. Room access and room mutability are deliberately
     separate: an Art director may inspect the Writers' Room, but only Writer/owner
     roles may change its story sections. The section helper is also the autosave
     allow-list, keeping visible controls and durable writes on one permission model. */
  /* THE FILM'S MEDIUM (2026-10-03): the dominant render style picked across its cast, props and
     locations — the Lookbook's mood frames are rendered in it (lookbook.jsx lookbookFilmMedium) */
  const filmRenderStyle = React.useMemo(()=>{
    const tally = {};
    [...(characters||[]), ...(props||[]), ...(locations||[])].forEach(e=>{ const k = e && e.renderStyleKey; if(k) tally[k]=(tally[k]||0)+1; });
    const top = Object.keys(tally).sort((a,b)=>tally[b]-tally[a])[0] || null;
    if(!top || top==="photoreal" || top==="surprise") return null;
    const block = (window.CHAR_RENDER_STYLES||{})[top];
    const medium = block && block.rendering;
    if(!medium) return null;
    const label = String(((typeof window.renderStylePromptName==="function") && window.renderStylePromptName(top)) || (window.RENDER_STYLE_LABELS||{})[top] || top).replace(/^[🔒🌐]\s*/,"");
    return { key:top, label, medium };
  },[characters, props, locations]);
  window.turnFilmRenderStyle = filmRenderStyle;
  const _projRow = (projects||[]).find(p=>p.id===currentProjectId) || null;
  /* A SHARED FILM STAYS SHARED WHEN IT DROPS OFF THE LIST (2026-10-09, owner — Team review): a refreshed
     project list without the open film (you were removed while the tab was in the background) made it
     look like your own — every room writable, the save-time role check skipped, and "Access ended"
     never shown. A film once seen as shared stays shared, and read-only, until the server says. */
  const sharedSeenRef = React.useRef({});
  if(_projRow && _projRow.isShared) sharedSeenRef.current[currentProjectId] = { title:_projRow.title || "" };
  else if(_projRow) delete sharedSeenRef.current[currentProjectId];
  const sharedOffList = !_projRow && !!currentProjectId && !!sharedSeenRef.current[currentProjectId];
  const isSharedFilm = !!(_projRow && _projRow.isShared) || sharedOffList;
  const sharedTitleRef = React.useRef("");
  sharedTitleRef.current = (_projRow && _projRow.title) || (sharedSeenRef.current[currentProjectId] || {}).title || "";
  const shareRole = (_projRow && _projRow.shareRole) || (_projRow && _projRow.isOwner ? "owner" : "") || (sharedOffList ? "view_only" : "");
  const [filmOwnerTier, setFilmOwnerTier] = React.useState(null);
  const _sharedFilmId = isSharedFilm ? currentProjectId : null;
  // re-read on the same timer and hints as the role (2026-10-09 — read once per film, a lapse or an
  // upgrade by the owner only showed after reopening the film)
  const ownerTierReloadRef = React.useRef(null);
  const filmOwnerTierSeenRef = React.useRef(false);
  React.useEffect(()=>{
    let live = true;
    // the writing default ("Auto") and every free-tier lock follow the owner's plan on a shared film
    const noteTier = ()=>{ if(typeof window.turnNoteWritingDefault==="function"){ try{ window.turnNoteWritingDefault(); }catch(e){} } };
    setFilmOwnerTier(null); window.turnFilmOwnerTier = null; noteTier(); ownerTierReloadRef.current = null;
    if(!_sharedFilmId || typeof window.cloudFilmOwnerTier!=="function") return;
    let retry = null;
    const load = ()=> window.cloudFilmOwnerTier(_sharedFilmId).then(t=>{ if(!live) return;
      // a failed read (undefined) keeps the tier we had; the first one tries again shortly (2026-10-09)
      if(t===undefined){ if(!filmOwnerTierSeenRef.current){ clearTimeout(retry); retry = setTimeout(()=>{ if(live) load(); }, 15000); } return; }
      if(filmOwnerTierSeenRef.current && window.turnFilmOwnerTier===(t || null)) return;   // unchanged
      filmOwnerTierSeenRef.current = true;
      setFilmOwnerTier(t); window.turnFilmOwnerTier = t || null; noteTier();
      try{ window.dispatchEvent(new CustomEvent("nb-settings-changed")); }catch(e){} }).catch(()=>{});
    filmOwnerTierSeenRef.current = false;
    ownerTierReloadRef.current = load;
    load();
    return ()=>{ live = false; clearTimeout(retry); ownerTierReloadRef.current = null; };
  },[_sharedFilmId]);
  const ownerPlanLapsed = !!_sharedFilmId && filmOwnerTier==="none";
  // sharing switched off: a film shared WITH you is read-only (nobody is charged)
  // (the switch as cloudLoadTeamSharing last read it — false once read as off; the admin is never paused)
  const sharingPaused = isSharedFilm && window.turnTeamSharing===false && !window.turnIsAdmin;
  /* YOUR ROLE CHANGED while the film is open (the owner changed it in the Team window): say so, with
     what the new role covers, so the rooms switching to read-only (or back) is never a surprise */
  const roleSeenRef = React.useRef({ pid:null, role:null });
  React.useEffect(()=>{
    const prev = roleSeenRef.current;
    const shared = !!(_projRow && _projRow.isShared);
    roleSeenRef.current = { pid:currentProjectId, role:shared ? shareRole : null };
    if(!shared || prev.pid!==currentProjectId || !prev.role || !shareRole || prev.role===shareRole) return;
    if(typeof window.appToast!=="function") return;
    const label = typeof window.teamRoleLabel==="function" ? window.teamRoleLabel(shareRole) : shareRole;
    const what = shareRole==="view_only" ? "You can read the film; changes aren't saved."
      : (typeof window.teamRoleScopeNote==="function" ? window.teamRoleScopeNote(shareRole) : "");
    window.appToast("Your role on \u201c"+((_projRow && _projRow.title) || "this film")+"\u201d is now "+label+". "+what, "info");
  },[currentProjectId, shareRole, _projRow && _projRow.isShared]);
  // what a collaborator may WRITE: their role — or nothing while the owner's plan has lapsed, while
  // sharing is switched off, or while the film has dropped off your list (until the server says)
  /* THE STAGE EDITOR ROLE NEEDS A PRODUCER FILM (2026-10-09, owner — Stage editor review): after the owner moves
     to Director the database saves nothing for it, and the app kept sending (a "version conflict"). The role is
     paused here too — what's left of the person's roles still works; nothing left = View-only. */
  const stageRolePaused = isSharedFilm && filmOwnerTier==="director" && String(shareRole||"").split("+").includes("stage_editor");
  const _rolesNow = stageRolePaused ? String(shareRole).split("+").filter(r=>r!=="stage_editor").join("+") : shareRole;
  const writeRole = (ownerPlanLapsed || sharingPaused || sharedOffList) ? "view_only" : (_rolesNow || "view_only");
  const readOnlyShare = writeRole === "view_only";
  /* why this shared film is read-only, in one sentence (the notices and the banner use it — 2026-10-09: while
     sharing was paused they said "Your Stage editor role covers the Stage…") */
  const sharedReadOnlyWhy = ownerPlanLapsed ? "This film is read-only for now: its owner's plan doesn't include shared work, so changes aren't saved."
    : sharingPaused ? "Team sharing is paused right now: this film is read-only for collaborators, and nothing is charged."
    : sharedOffList ? "Checking your access to this film \u2014 changes wait until it's confirmed."
    : stageRolePaused && writeRole==="view_only" ? "Your Stage editor role is paused on this film: its owner's plan doesn't include the Stage right now, so changes aren't saved."
    : "";
  // the role paused on a Director film: said once per film (renders already running still finish and land in the film)
  const stagePausedToldRef = React.useRef("");
  React.useEffect(()=>{
    if(!stageRolePaused || stagePausedToldRef.current===currentProjectId) return;
    stagePausedToldRef.current = currentProjectId;
    if(typeof window.appToast==="function") window.appToast("Your Stage editor role is paused on \u201c"+(sharedTitleRef.current||"this film")
      +"\u201d: its owner's plan doesn't include the Stage right now. Renders that were already running still finish and land in the film.","info");
  },[stageRolePaused, currentProjectId]);
  // the four roles, alone or combined ("writer+art_director", 2026-10-03); anything else fails closed
  const unknownSharedRole = !!(isSharedFilm
    && !(typeof window.teamRoleKnown==="function" ? window.teamRoleKnown(shareRole)
      : ["view_only","writer","art_director","stage_editor"].includes(shareRole)));
  // THE SCREENPLAY CREDIT on a shared film (owner, 2026-09-28: authorship is the writer's): the
  // film's OWNER, by their handle — never the collaborator who presses Export; no owner name known,
  // no credit line. export.jsx screenplayWriter() reads it; null on the user's own film.
  window.turnOpenFilmCredit = (_projRow && _projRow.isShared)
    ? { shared:true, owner:(typeof cloudHandleName==="function" ? cloudHandleName(_projRow.ownerEmail) : "") }
    : sharedOffList ? { shared:true, owner:"" }   // off the list: no owner name known, no credit line
    : null;
  const _sharedCanWriteRoom = id=>!isSharedFilm
    || (typeof window.teamCanWriteRoom==="function" && window.teamCanWriteRoom(writeRole,id));
  const writersRoomReadOnly = !_sharedCanWriteRoom("writers");
  // the open film is a blank canvas (see turnFilmIsBlank in auth-ui.jsx): no badges on its chip
  const currentFilmBlank = !!_projRow && typeof window.turnFilmIsBlank==="function" && window.turnFilmIsBlank(_projRow)
    && !scenes.length && !(characters||[]).length;
  const artRoomReadOnly = !_sharedCanWriteRoom("art");
  // SHOTS are saved by the Art Room AND the Stage (a Stage editor voices lines into them): their handlers
  // check the role's right to save shots, whichever room is open (2026-10-09, owner — Shots review: the
  // check followed the open room, so an art-only collaborator's "Design all shots" failed in the Writers' Room)
  const shotsReadOnly = isSharedFilm && !(typeof window.teamCanWriteSection==="function" && window.teamCanWriteSection(writeRole, "shots"));
  const writersRoomBlocked = projectLoading || writersRoomReadOnly;
  // the Production check edits the script AND the Art Room: open to anyone who can save either
  const productionCheckBlocked = projectLoading || (writersRoomReadOnly && artRoomReadOnly);
  const stageReadOnly = isSharedFilm && !_sharedCanWriteRoom("stage");
  const roomReadOnly = projectLoading || (room==="writers" ? writersRoomReadOnly
    : room==="art" ? artRoomReadOnly : room==="stage" ? stageReadOnly : readOnlyShare);
  /* LIVE refs fence async results whose collaborator role changes while model work
     is in flight. A role change may happen without remounting the running agent. */
  const readOnlyShareRef = React.useRef(false);
  readOnlyShareRef.current = readOnlyShare;
  const roomReadOnlyRef = React.useRef(false);
  roomReadOnlyRef.current = roomReadOnly;
  const writersRoomReadOnlyRef = React.useRef(false);
  writersRoomReadOnlyRef.current = writersRoomBlocked;
  const artRoomReadOnlyRef = React.useRef(false);
  artRoomReadOnlyRef.current = projectLoading || artRoomReadOnly;
  const characterBibleWritableRef = React.useRef(true);
  characterBibleWritableRef.current = !isSharedFilm
    || (typeof window.teamCanWriteSection==="function"
      && window.teamCanWriteSection(writeRole,"characters"));
  // the silent cast auto-draft writes `characters` + `visualsSeeded` — only for a role whose saves keep
  // BOTH (the same allow-list autosave enforces), and never while the film is still loading
  const _sharedCanWriteSection = k=>!isSharedFilm
    || (typeof window.teamCanWriteSection==="function" && window.teamCanWriteSection(writeRole,k));
  const castAutoDraftWritable = !projectLoading && !artRoomReadOnly
    && _sharedCanWriteSection("characters") && _sharedCanWriteSection("visualsSeeded");
  const readOnlyNoticeRef = React.useRef(0);
  const _mutationNotice = roomId=>{
    const now = Date.now();
    if(now-(readOnlyNoticeRef.current||0)>2500){
      readOnlyNoticeRef.current = now;
      if(typeof window.appToast==="function"){
        const note=sharedReadOnlyWhy || ((typeof window.teamRoleScopeNote==="function")?window.teamRoleScopeNote(writeRole):"");
        window.appToast(note || (roomId==="writers"
          ? "This role can read the Writers' Room but cannot change story or script."
          : roomId==="characters" ? "This role can read the cast but cannot change it."
          : "This role cannot change the Art Room."),"error");
      }
    }
    return false;
  };
  const _projectLoadingNotice=()=>{
    const now=Date.now();
    if(now-(readOnlyNoticeRef.current||0)>2500){
      readOnlyNoticeRef.current=now;
      if(typeof window.appToast==="function") window.appToast(
        "The selected project is still loading. Editing will resume when its saved state is ready.","info");
    }
    return false;
  };
  const canMutateWritersRoom = ()=> projectLoadingRef.current ? _projectLoadingNotice()
    : writersRoomReadOnlyRef.current ? _mutationNotice("writers") : true;
  const canMutateSharedFilm = ()=> projectLoadingRef.current ? _projectLoadingNotice()
    : roomReadOnlyRef.current ? _mutationNotice(room) : true;
  /* THE CAST IS ITS OWN SECTION (2026-10-09, owner — Writers' Room review): a Co-writer could edit a cast
     card in the Writers' Room (or start a paid character draft) and the save then rolled it back — the
     room was writable, the `characters` section wasn't. Cast edits follow the section. */
  const canMutateCharacters = ()=> !canMutateSharedFilm() ? false
    : characterBibleWritableRef.current ? true : _mutationNotice("characters");
  const shotsReadOnlyRef = React.useRef(false); shotsReadOnlyRef.current = shotsReadOnly;
  const canMutateShots = ()=> projectLoadingRef.current ? _projectLoadingNotice()
    : shotsReadOnlyRef.current ? _mutationNotice("art") : true;
  /* A STAGE EDITOR SAVES THE STAGE'S PART OF A SHOT ONLY (2026-10-09, owner — Stage editor review, decision F):
     takes are separate; on a shot, which line it speaks, its voicing, its timing and the Stage's own overrides.
     Designing, adding, splitting, deleting shots and their frames stay with the owner and the Art director
     (the database refuses the rest: supabase/team-relaunch.sql, TURN_TEAM:stage_scope). */
  // (the database's list: team-relaunch.sql turn__stage_shot_fields; specRev / specHash are derived by updateShot)
  const STAGE_SHOT_FIELDS = ["lineAudio","dur","dialogue","dialogueLines","screenplayDialogueIndex","screenplayDialogueIndexes","vidText","stageCharacterReferenceOverrides"];
  const shotsStageOnly = isSharedFilm && !shotsReadOnly && String(writeRole||"").split("+").indexOf("art_director")<0
    && String(writeRole||"").split("+").indexOf("stage_editor")>=0;
  const shotsStageOnlyRef = React.useRef(false); shotsStageOnlyRef.current = shotsStageOnly;
  const _stageScopeNotice = ()=>{ const now = Date.now();
    if(now-(readOnlyNoticeRef.current||0)>2500){ readOnlyNoticeRef.current = now;
      if(typeof window.appToast==="function") window.appToast("A Stage editor saves the Stage's takes, dialogue and voicing \u2014 the film's owner or Art director designs, adds and splits shots.","info"); }
    return false; };
  const canDesignShots = ()=> !canMutateShots() ? false : shotsStageOnlyRef.current ? _stageScopeNotice() : true;
  try{ window.turnCanMutateShots = ()=> !projectLoadingRef.current && !shotsReadOnlyRef.current && !shotsStageOnlyRef.current; }catch(e){}
  try{ window.turnArtRoomWritable = ()=> !artRoomReadOnlyRef.current; }catch(e){}   // the Stage's "Open in Shots" (2026-10-09)   // a silent check for shared code (Storyboards' panel edit)
  // a role that can't change the Art Room closes the Colorist and pre-production panels (2026-10-08 — they
  // stayed open and could still apply after a role change)
  // a role that can no longer change the Art Room closes every Art Room run and its previews (2026-10-09: the
  // previews and the other Department Heads stayed open)
  React.useEffect(()=>{ if(artRoomReadOnly){ setColoristOpen(false); setCoordOpen(false); coloristRedoManualRef.current = false;
    setCoordConfirm(false); setCastConfirm(null); setCastingOpen(false); setPropsMasterOpen(false); setLocScoutOpen(false);
    setResearchOpen(false); setShotDesignerOpen(false); } },[artRoomReadOnly]);
  React.useEffect(()=>{
    if(!writersRoomBlocked) return;
    setAgentsOpen(false); setAgentLaunch(null); setNewStoryOpen(false);
  },[writersRoomBlocked]);
  /* PRESENCE — who else has this film open. Joins a Realtime channel per film and leaves
     on switch/sign-out. Purely additive: if Realtime isn't enabled the list stays empty
     and nothing renders, so this can never break the app for a solo user. */
  const [presence, setPresence] = React.useState([]);
  React.useEffect(()=>{
    setPresence([]);
    if(!cloudMode || !currentProjectId || typeof window.cloudJoinPresence!=="function") return;
    const email = (typeof cloudUserEmail==="function") ? cloudUserEmail(session) : "";
    // a display name and the account id (to spot your own other window) — never the email (2026-10-03);
    // the account's chosen name first, as the exports use it (2026-10-09)
    const name = (typeof cloudUserDisplayName==="function" ? cloudUserDisplayName(session) : "")
      || (typeof cloudHandleName==="function" ? cloudHandleName(email) : "") || (email||"").split("@")[0].split("+")[0];
    const off = window.cloudJoinPresence(currentProjectId,
      { uid:(session && session.user && session.user.id) || "", name, role:unknownSharedRole?"role_unavailable":(shareRole||"owner"), at:Date.now() },
      (people)=> setPresence(people||[]));
    return ()=>{ try{ off && off(); }catch(e){} };
  },[cloudMode, currentProjectId, session && session.user && session.user.id, shareRole]);

  /* LIVE REFRESH — pick up collaborators' changes as they land.
     PUSH FIRST: a collaborator's successful save broadcasts its new _rev on the
     film's Realtime channel (see cloudJoinPresence), so their change appears here
     within a second or two. The 12s _rev poll stays as the SILENT FALLBACK for
     when Realtime is unavailable — and relaxes to a slow safety probe (~60s)
     while push is healthy, which also covers a save from an older client that
     doesn't broadcast. Cost discipline: only a tiny _rev scalar is ever polled
     (never the doc), only when someone else is actually here (presence) or the
     film is shared with you, and never while you have unsaved edits or a load in
     flight — so it can't fight your typing, and a solo writer polls nothing.
     ACCESS ENDED: for a shared film, a probe that errors is double-checked — a
     definitive "zero rows, no error" means the owner removed you (or deleted the
     film), and you get told plainly instead of watching every save silently fail. */
  React.useEffect(()=>{
    if(!cloudMode || !currentProjectId || typeof window.cloudDocRev!=="function") return;
    const others = (presence||[]).filter(p=>!p.isSelf).length;
    const collaborative = others>0 || isSharedFilm;
    if(!collaborative) return;
    let alive = true, busy = false, ticks = 0, ended = false, pushTimer = null;
    const accessEnded = async ()=>{
      if(ended || !alive) return; ended = true;
      const title = sharedTitleRef.current || "this film";
      try{
        // one button: both used to reload (2026-10-09)
        if(typeof window.appConfirm==="function")
          await window.appConfirm({ title:"Access ended",
            body:"\u201c"+title+"\u201d is no longer shared with you \u2014 your access was removed or the film was deleted. You'll go back to your own films.",
            confirmLabel:"Back to my films", hideCancel:true });
        else if(typeof window.appToast==="function")
          window.appToast("Your access to \""+title+"\" has ended.","error");
      }catch(e){}
      // a clean reboot lands on the user's own films (or first-film creation) via
      // the normal boot path — much safer than hand-rolled partial state surgery
      try{ window.location.reload(); }catch(e){}
    };
    /* TEXT BEING TYPED IS NEVER OVERWRITTEN (2026-10-09, owner — Writers' Room review): a field still being
       typed in (not yet saved — it doesn't count as an edit until it's committed) was replaced by a
       collaborator's change, and the typing lost. A newer version waits until the field is left. */
    const editingNow = ()=>{ try{ const el = document.activeElement;
      return !!(el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName))); }catch(e){ return false; } };
    const checkRemote = async ()=>{
      if(!alive || busy || ended) return;
      if(dirtyRef.current || hydratingRef.current || editingNow()) return;   // never fight local edits
      busy = true;
      try{
        const rev = await window.cloudDocRev(currentProjectId);
        if(alive && rev==null && isSharedFilm && typeof window.cloudCheckAccess==="function"){
          // null is ambiguous (transient error OR revoked access) — ask explicitly,
          // and only ever act on a definitive "gone"
          if((await window.cloudCheckAccess(currentProjectId))==="gone"){ busy = false; return accessEnded(); }
        }
        const seen = (typeof window.cloudSeenRev==="function") ? window.cloudSeenRev(currentProjectId) : 0;
        if(alive && rev && rev > seen && !dirtyRef.current && !hydratingRef.current && !editingNow()){
          const row = await cloudLoadProject(currentProjectId);
          if(alive && row && row.doc && !dirtyRef.current && !hydratingRef.current){
            if(typeof window.cloudNoteDocRev==="function") window.cloudNoteDocRev(currentProjectId, row.doc);
            _adoptTheirs(row.doc, []);   // nothing of ours is pending, so adopt freely
          }
        }
      }catch(e){}
      busy = false;
    };
    /* THE ROLE ON A SHARED FILM (2026-10-03): the owner's role change is announced over the film's
       realtime channel, but a missed broadcast left the old role in force here (an Art director
       turned Co-writer kept an editable Art Room until a reload). So the role is also re-read about
       once a minute and whenever the tab comes back to the front. */
    let roleAt = 0;
    const refreshRole = async (minGapMs)=>{
      if(!alive || ended || !isSharedFilm || typeof window.cloudListProjects!=="function") return;
      if(Date.now() - roleAt < minGapMs) return;
      roleAt = Date.now();
      try{ const list = await window.cloudListProjects(); if(alive && list) setProjects(list); }catch(e){}
      try{ ownerTierReloadRef.current && ownerTierReloadRef.current(); }catch(e){}
    };
    // the open film dropped off the refreshed list: ask the server, and end the session only on its "gone"
    if(sharedOffList && typeof window.cloudCheckAccess==="function"){
      window.cloudCheckAccess(currentProjectId).then(s=>{ if(alive && s==="gone") accessEnded(); }).catch(()=>{});
    }
    const onRoleFocus = ()=>{ try{ if(document.visibilityState!=="hidden") refreshRole(15000); }catch(e){} };
    window.addEventListener("focus", onRoleFocus);
    document.addEventListener("visibilitychange", onRoleFocus);
    const tick = ()=>{
      ticks++;
      if((ticks % 5) === 0) refreshRole(50000);
      // push healthy → broadcasts wake us instantly; keep only the slow safety probe
      if(window.turnPushHealthy && (ticks % 5) !== 0) return;
      checkRemote();
    };
    const onPush = (e)=>{
      if(!alive || !e || !e.detail || e.detail.projectId!==currentProjectId) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(checkRemote, 250);   // coalesce a burst of section saves
    };
    // membership changed on this film — a hint, never an order: only the SERVER's
    // own "gone" (zero rows, no error) can end the session; everyone else no-ops
    const onMemberRemoved = (e)=>{
      if(!alive || ended || !e || !e.detail || e.detail.projectId!==currentProjectId) return;
      if(!isSharedFilm) return;               // owners can't be removed
      if(typeof window.cloudCheckAccess!=="function") return;
      window.cloudCheckAccess(currentProjectId).then(async s=>{
        if(!alive) return;
        if(s==="gone"){ accessEnded(); return; }
        // The same server-authenticated hint also announces role changes. Pull
        // the compact project list so a demotion to View only disables editing
        // immediately instead of waiting for a rejected autosave or reload.
        if(s==="ok" && typeof window.cloudListProjects==="function"){
          const list=await window.cloudListProjects();
          if(alive && list) setProjects(list);
        }
        if(s==="ok"){ try{ ownerTierReloadRef.current && ownerTierReloadRef.current(); }catch(e){} }
      }).catch(()=>{});
    };
    window.addEventListener("turn-doc-push", onPush);
    window.addEventListener("turn-member-removed", onMemberRemoved);
    const iv = setInterval(tick, 12000);
    return ()=>{ alive = false; clearInterval(iv); clearTimeout(pushTimer);
      window.removeEventListener("focus", onRoleFocus);
      document.removeEventListener("visibilitychange", onRoleFocus);
      window.removeEventListener("turn-doc-push", onPush);
      window.removeEventListener("turn-member-removed", onMemberRemoved); };
  },[cloudMode, currentProjectId, presence.length, isSharedFilm, sharedOffList]);
  /* YOUR BUDGET ON A SHARED FILM (2026-10-09, owner — Team review, §6): at 80% of this month's budget, and
     when it's used up, the collaborator is told once (per film, per month, per level). Read from the
     database after a generation lands (throttled), whatever made it — writing, images, video, voice or 3D.
     The owner sees the same flags in the Team window. */
  // on a film shared WITH you the owner pays: the Stage's price labels read this, and your budget below
  // (2026-10-09, Stage editor review — the Stage checked your own balance and sent you to Plans)
  window.turnFilmPaidByOwner = ()=> isSharedFilm;
  React.useEffect(()=>{
    window.turnFilmBudget = null;
    if(!cloudMode || !currentProjectId || !isSharedFilm || typeof window.cloudTeamSpend!=="function") return;
    let alive = true, at = 0, timer = null;
    const pid = currentProjectId;
    const check = async ()=>{
      if(!alive || Date.now()-at < 20000) return; at = Date.now();
      let rows = [];
      try{ rows = await window.cloudTeamSpend(pid); }catch(e){ return; }
      // a collaborator reads only their own row: what the Stage shows as "your budget left"
      const own = (rows||[]).find(r=>r && !r.removed) || null;
      if(alive && own) window.turnFilmBudget = { limit:own.budget==null ? null : Number(own.budget), spent:Number(own.spent)||0 };
      const mine = (rows||[]).find(r=>r && r.budget!=null && Number(r.budget)>0);
      if(!alive || !mine) return;
      const spent = Number(mine.spent)||0, budget = Number(mine.budget)||0;
      const level = spent>=budget ? 100 : spent>=0.8*budget ? 80 : 0;
      if(!level) return;
      const d = new Date(), key = "turn_team_budget_note:"+pid+":"+d.getUTCFullYear()+"-"+(d.getUTCMonth()+1);
      let seen = 0; try{ seen = Number(localStorage.getItem(key))||0; }catch(e){}
      if(seen>=level) return;
      try{ localStorage.setItem(key, String(level)); }catch(e){}
      const fmt = n=> Math.max(0, Math.floor(n)).toLocaleString("en-US");
      const reset = typeof window.teamBudgetResetText==="function" ? " (it "+window.teamBudgetResetText()+")" : "";
      if(typeof window.appToast==="function") window.appToast(level===100
        ? "You've used this month's credit budget on \u201c"+(sharedTitleRef.current||"this film")+"\u201d ("+fmt(spent)+" of "+fmt(budget)+")"+reset+". The film's owner can raise it."
        : "You've used 80% of this month's credit budget on \u201c"+(sharedTitleRef.current||"this film")+"\u201d ("+fmt(spent)+" of "+fmt(budget)+")"+reset+".", level===100 ? "error" : "info");
    };
    const soon = ()=>{ clearTimeout(timer); timer = setTimeout(check, 1500); };
    const evs = ["turn-credits-changed","vid-done","nb-gen-done","vg-audio-done"];
    evs.forEach(n=>window.addEventListener(n, soon));
    check();
    return ()=>{ alive = false; clearTimeout(timer); evs.forEach(n=>window.removeEventListener(n, soon)); window.turnFilmBudget = null; };
  },[cloudMode, currentProjectId, isSharedFilm]);
  // ADMIN — demo upkeep account. The Matrix sample story (and "Reset to sample story")
  // is admin-only: every other user (and signed-out local mode) never sees Matrix data.
  const isAdmin = (((typeof cloudUserEmail==="function" && cloudUserEmail(session))||"").toLowerCase()==="admin@infinitestudioai.com");
  /* THE OWNER'S BELL (team.jsx TeamNotifications): who joined your films; a click opens the film */
  const teamNotifySlot = (variant)=> (cloudMode && session && (teamSharing || isAdmin) && window.TeamNotifications)
    ? React.createElement(window.TeamNotifications,{ key:"notify-"+variant, variant, enabled:true,
        onOpenFilm: async (id)=>{ const fid = openableFilmId(id); if(!fid){ setHomeOpen(true); return; }
          setHomeOpen(false); if(fid!==currentProjectId) await switchProject(fid); } })
    : null;
  /* TEAM'S SWITCH (turn_app_config "team_sharing", owner 2026-10-03): read at boot and when the
     tab comes back to the front; off → the Team button shows "Soon" (team.jsx) and, on a film shared
     WITH you, the film is read-only (owner 2026-10-09, Team review: off means nobody is charged and
     collaborators can only read; the owner can still remove people and you can still leave) */
  const [teamSharing, setTeamSharing] = React.useState(!!window.turnTeamSharing);
  React.useEffect(()=>{
    if(typeof window.cloudLoadTeamSharing!=="function") return;
    let at = 0;
    const load = ()=>{ if(Date.now()-at < 60*1000) return; at = Date.now();
      window.cloudLoadTeamSharing().then(on=>setTeamSharing(!!on)).catch(()=>{}); };
    load();
    const onFocus = ()=>{ try{ if(document.visibilityState!=="hidden") load(); }catch(e){} };
    window.addEventListener("focus", onFocus);
    return ()=>window.removeEventListener("focus", onFocus);
  },[session && session.user && session.user.id]);

  /* TEAM (owner 2026-10-03): a shared film's rooms follow its OWNER's plan — turn_film_owner_tier:
     "studio" (Producer: every room) | "director" (Writers' Room + Art Room) | "none" (the owner's
     plan lapsed or a payment failed: the film is read-only, nothing is deleted) | "" (the server
     can't say: the older role-only rooms) | null (not read yet). */
  // expose for leaf components that have no session prop (e.g. the Art Room key bar)
  React.useEffect(()=>{ window.turnIsAdmin = isAdmin;
    // admin-only fal price-drift check (throttled inside; shows a card on drift)
    if(isAdmin && typeof window.turnPricingWatchStart==="function") window.turnPricingWatchStart();
  },[isAdmin]);
  // expose the signed-in user's email so leaf components can scope per-user data
  // (locked render styles live in localStorage keyed by this email). Empty in local/signed-out mode.
  const userEmail = ((typeof cloudUserEmail==="function" && cloudUserEmail(session))||"").toLowerCase();
  React.useEffect(()=>{ window.turnUserEmail = userEmail;
    // the Supabase uid rides into Stripe as client_reference_id (see plans.jsx)
    window.turnUserId = (session && session.user && session.user.id) || null;
    // the WRITER a screenplay export credits when the film names no author of its own (owner,
    // 2026-09-28: authorship is the user's, never the company's) — display name, else the account
    // handle; empty when signed out, and the export then omits the credit line
    window.turnUserDisplayName = (typeof cloudUserDisplayName==="function") ? cloudUserDisplayName(session) : "";
    if(typeof window.turnRefreshLockedStyles==="function") window.turnRefreshLockedStyles(); },[userEmail, session]);
  const [creditBalance, setCreditBalance] = React.useState(null);
  /* TRIAL WELCOME (owner request 2026-10-02): once per account, when its signed-in balance first
     shows the free trial — the credits arrive with the first balance read after the email is
     confirmed. Not while a plan's checkout is about to open (that person is buying a plan), and
     never over the plan / pack welcome or an invite landing. Seen = the account's metadata, plus
     this browser's copy so a failed metadata write doesn't bring it back here. */
  const [trialWelcomeOpen, setTrialWelcomeOpen] = React.useState(false);
  const trialWelcomeKey = (s)=> "turn-trial-welcome-"+String((s && s.user && s.user.id) || "");
  const trialWelcomeSeen = (s)=>{
    if(typeof window.cloudTrialWelcomeSeen==="function" && window.cloudTrialWelcomeSeen(s)) return true;
    try{ return localStorage.getItem(trialWelcomeKey(s))==="1"; }catch(e){ return false; }
  };
  const closeTrialWelcome = ()=>{
    setTrialWelcomeOpen(false);
    try{ localStorage.setItem(trialWelcomeKey(session), "1"); }catch(e){}
    if(typeof window.cloudMarkTrialWelcomeSeen==="function") window.cloudMarkTrialWelcomeSeen();
  };
  React.useEffect(()=>{
    if(trialWelcomeOpen || !session || !creditBalance || !creditBalance.trial || window.turnIsAdmin) return;
    if(!(Number(creditBalance.remaining)>0)) return;
    if(welcomeOpen || creditPackOpen || inviteLanding) return;
    // a plan picked before sign-up still opens its checkout (this browser's copy: 20 minutes; the
    // account's: 48 hours — the same windows as plans.jsx pickIntendedPlan)
    const acct = (typeof window.cloudAccountIntendedPlan==="function") ? window.cloudAccountIntendedPlan(session) : null;
    const waiting = (typeof window.turnIntendedPlanWaiting==="function" && window.turnIntendedPlanWaiting())
      || !!(acct && acct.at>0 && (Date.now()-acct.at) < 48*3600*1000);
    if(waiting || trialWelcomeSeen(session)) return;
    setTrialWelcomeOpen(true);
  },[session, creditBalance, welcomeOpen, creditPackOpen, inviteLanding]);
  const refreshCreditBalance = React.useCallback(async ()=>{
    if(typeof cloudGetCreditBalance!=="function"){ setCreditBalance(null); return null; }
    try{
      const b = await cloudGetCreditBalance();
      setCreditBalance(b || null);
      window.turnCreditBalance = b || null;
      // price chips re-read when the plan is known (a trial's draft engine, a Writer's 2K) — 2026-10-09
      try{ window.dispatchEvent(new CustomEvent("nb-settings-changed")); }catch(e){}
      // a free-tier account's writing default is the lighter engine (app/ai.jsx): pickers on "Auto"
      // follow once the ledger says which tier this is
      if(typeof window.turnNoteWritingDefault==="function"){ try{ window.turnNoteWritingDefault(); }catch(e){} }
      return b || null;
    }catch(e){ setCreditBalance(null); window.turnCreditBalance = null; return null; }
  },[]);
  React.useEffect(()=>{ refreshCreditBalance(); },[userEmail, refreshCreditBalance]);
  React.useEffect(()=>{
    const h = ()=>refreshCreditBalance();
    window.addEventListener("turn-credits-changed", h);
    window.addEventListener("vid-done", h);
    window.addEventListener("nb-gen-done", h);
    window.addEventListener("vg-audio-done", h);
    return ()=>{
      window.removeEventListener("turn-credits-changed", h);
      window.removeEventListener("vid-done", h);
      window.removeEventListener("nb-gen-done", h);
      window.removeEventListener("vg-audio-done", h);
    };
  },[refreshCreditBalance]);
  // CONTINUITY from the landing pricing → checkout: if the visitor picked a paid plan
  // before signing up, open that plan's Stripe checkout automatically once they're in.
  // The choice lives in this browser (20 minutes) AND on the account (user metadata saved
  // at sign-up, 48 hours — app/cloud.jsx), so it survives email confirmation that takes a
  // while or happens in another browser (billing fixes, 2026-09-30). It waits for the
  // ledger so an account that is ALREADY on a paid plan (paid in the other browser) is
  // never sent to a second checkout, and it is consumed (both copies cleared) on first use.
  const [intentWaitOver, setIntentWaitOver] = React.useState(false);
  const intentDoneRef = React.useRef("");   // the uid whose intent was already acted on (once per sign-in)
  React.useEffect(()=>{
    setIntentWaitOver(false);
    if(!(session && session.user && session.user.id)) return;
    const t = setTimeout(()=>setIntentWaitOver(true), 8000);   // a ledger that never loads can't strand the buyer
    return ()=>clearTimeout(t);
  },[session && session.user && session.user.id]);
  React.useEffect(()=>{
    if(!(session && session.user && session.user.id)) return;
    if(intentDoneRef.current===session.user.id) return;
    const pick = (typeof window.turnPickIntendedPlan==="function") ? window.turnPickIntendedPlan : null;
    if(!pick) return;
    let localAt = 0;
    try{ localAt = Number(localStorage.getItem("turn-intended-plan-at")||0); }catch(e){}
    const account = (typeof window.cloudAccountIntendedPlan==="function") ? window.cloudAccountIntendedPlan(session) : null;
    const decision = pick({ local:intendedPlan, localAt, account, now:Date.now(),
      balance:creditBalance, balanceReady:!!creditBalance || intentWaitOver, isAdmin:!!window.turnIsAdmin });
    if(decision.action==="wait" || decision.action==="none") return;
    // consume BOTH copies before navigating, so a reload or another device can't reopen it
    intentDoneRef.current = session.user.id;
    try{ localStorage.removeItem("turn-intended-plan"); localStorage.removeItem("turn-intended-plan-at"); }catch(e){}
    if(intendedPlan && intendedPlan!=="free") setIntendedPlan(null);
    if(account && typeof window.cloudClearAccountIntendedPlan==="function"){ try{ window.cloudClearAccountIntendedPlan(); }catch(e){} }
    if(decision.action!=="checkout") return;
    const planObj = (window.CINEMA_PLANS||[]).find(p=>String(p.tier).toLowerCase()===decision.plan);
    // sameTab: this fires from an effect (no user gesture) — window.open would be
    // popup-blocked; navigating this tab to Stripe is never blocked, and the
    // after-payment redirect brings the buyer straight back into the app.
    if(planObj && typeof window.turnStartCheckout==="function") setTimeout(()=>window.turnStartCheckout(planObj, { sameTab:true }), 350);
  },[session, intendedPlan, creditBalance, intentWaitOver]);
  // LIVE balance: refetch whenever the window regains focus, and STREAM the user's
  // turn_credits row from Supabase realtime — a grant from the SQL editor (or a
  // spend on another device) updates the readout with no reload. Realtime needs
  // the table in the publication (see supabase/credits.sql); the focus refresh is
  // the fallback when it isn't.
  React.useEffect(()=>{
    const onFocus = ()=>{ if(document.visibilityState!=="hidden") refreshCreditBalance(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    let channel = null, sbRef = null;
    try{
      const sb = (typeof window.sbClient==="function") ? window.sbClient() : null;
      const uid = session && session.user && session.user.id;
      if(sb && sb.channel && uid){
        sbRef = sb;
        channel = sb.channel("turn-credits-"+uid)
          .on("postgres_changes", { event:"*", schema:"public", table:"turn_credits", filter:"owner=eq."+uid },
            ()=>refreshCreditBalance())
          .subscribe();
      }
    }catch(e){}
    return ()=>{
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      try{ if(channel && sbRef) sbRef.removeChannel(channel); }catch(e){}
    };
  },[session && session.user && session.user.id, refreshCreditBalance]);
  // expose the current project for format-aware helpers with no project param
  // (e.g. the scene drafter reads formatOf(window.turnProject).screenplayBrief)
  React.useEffect(()=>{ window.turnProject = project; },[project]);
  // live cast on a global so the scene drafter can read each character's canonical
  // pronouns (castPronounBlock) — the root-cause fix for bible<->script gender drift.
  React.useEffect(()=>{
    window.turnCast = characters;
    window.turnIdentityContext = { cast:characters, characters, scenes, drafts };
  },[characters, scenes, drafts]);
  /* SLUGLINE UNITS — the atomic filmable location units ((place, side, TOD bucket)),
     derived fresh from the script and reconciled with the user's persisted overlays
     (appearance state / notes / images). Read-only consumers (Art Room UI, prompt
     builders) take this list; edits go through updateSlugUnitOverlay. */
  /* SAME PLACE, TWO NAMES (owner-approved 2026-10-14, "go ahead with all of it"): the owner's answers on the location
     cards (merged names, "Part of", "Keep separate" — locations.jsx locationPlaceDecisions) are read by every
     derivation of places, rooms and units. Set here, on every render, from the live cards and Recently deleted — on a
     Show those are the Show's shared cards, so a decision holds in every episode. */
  const placeDecisions = React.useMemo(()=> (typeof locationPlaceDecisions==="function")
    ? locationPlaceDecisions(locations, trash && trash.locations) : null, [locations, trash && trash.locations]);
  if(typeof setLocationPlaceDecisions==="function") setLocationPlaceDecisions(placeDecisions);
  const placeDecisionsSig = (placeDecisions && placeDecisions.sig) || "";
  const sluglineUnits = React.useMemo(()=>
    (typeof deriveSluglineUnits==="function" && typeof reconcileSluglineUnits==="function")
      ? reconcileSluglineUnits(deriveSluglineUnits(scenes, drafts), slugUnitsOv) : [],
    [scenes, drafts, slugUnitsOv, placeDecisionsSig]);
  // the CONTINUITY GRAPH, exposed for prompt builders that have no props/scenes/locations
  // params (e.g. the location plate folds in the environment props it owns — locations.jsx)
  React.useEffect(()=>{ window.turnContinuity = { props, scenes, locations, characters, drafts, beatsMap, shots, sluglineUnits }; },[props, scenes, locations, characters, drafts, beatsMap, shots, sluglineUnits]);
  React.useEffect(()=>{
    window.turnAttachPropReference = (propId, ref)=>{
      if(!propId || !ref || !ref.url) return false;
      setProps(ps=>ps.map(p=>{
        if(!p || p.id!==propId) return p;
        const refs = Array.isArray(p.referenceImages) ? p.referenceImages : [];
        const next = [{ ...ref }, ...refs.filter(r=>r
          && r.id!==ref.id
          && r.url!==ref.url
          && (!ref.sourceEntityId || r.sourceEntityId!==ref.sourceEntityId))].slice(0,8);
        return { ...p, referenceImages: next };
      }));
      return true;
    };
    window.turnCreatePropFromReference = (ref, seed)=>{
      if(!ref || !ref.url) return null;
      seed = seed || {};
      const name = String(seed.name||ref.note||"New prop").trim() || "New prop";
      const slug = (typeof window.propSlug==="function") ? window.propSlug(name)
        : name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40);
      const id = "prop-ref-"+(slug||"item")+"-"+Date.now().toString(36);
      const card = { id, name, kind:seed.kind||"carried", ownerId:seed.ownerId||"", ownerName:seed.ownerName||"",
        form: seed.form||("Derived from selected visual reference: "+(ref.sourceName||"Art Room sheet")),
        detail: seed.detail||("Created from a selected item reference so its design belongs to the existing film world."),
        referenceImages:[{ ...ref, id:ref.id||("pref-"+Date.now().toString(36)) }],
        // (owner 2026-10-12) a crop of a GENERATED image is a design choice, not the screenplay and not
        // a hand-made card: it carries a design origin and the "Not in screenplay" badge (a carried one
        // waits under Proposed until the user keeps it or the screenplay names it)
        origin:{ kind:"design", from:"art-room-image", sourceName:String(ref.sourceName||"") } };
      setProps(ps=>[card, ...ps]);
      return card;
    };
    window.turnRemovePropReference = (propId, refId)=>{
      if(!propId || !refId) return false;
      setProps(ps=>ps.map(p=> p && p.id===propId
        ? { ...p, referenceImages:(Array.isArray(p.referenceImages)?p.referenceImages:[]).filter(r=>r
            && r.id!==refId && r.sourceEntityId!==refId && r.url!==refId) }
        : p));
      return true;
    };
    return ()=>{ delete window.turnAttachPropReference; delete window.turnCreatePropFromReference; delete window.turnRemovePropReference; };
  },[]);
  const hydratingRef = React.useRef(false);
  const lastSentRef = React.useRef({});   // per-section save baseline (seeded by applyDoc)
  /* AUTOSAVE COORDINATOR. Project changes are allowed to ask the newest pending
     snapshot to save immediately, while one promise chain keeps cloud responses in
     submission order. The generation token prevents an older response from marking
     newer edits saved (or adopting cloud state over them). These refs live above the
     project loader because switching is itself part of the durability boundary. */
  const saveTimer = React.useRef(null);
  const saveQueueRef = React.useRef(Promise.resolve(true));
  const pendingSaveRef = React.useRef(null);
  const saveGenerationRef = React.useRef(0);
  const dirtyRef = React.useRef(false);
  // bumped when a hydration pass finishes — lets effects that are gated on
  // hydratingRef (auto-seed) re-run once the doc has settled, even if the user
  // is already sitting on the tab (e.g. reloaded straight into Locations).
  const [hydrationTick, setHydrationTick] = React.useState(0);

  /* A clean canvas — what every NEW registered user (and every "New Story" before its story launches) starts
     from. No sample data: empty spine, cast, props, etc. The Matrix sample lives only
     in the seed (story-data.jsx) and in projects already saved to a user's account. */
  const emptyDoc = ()=>({ scenes:[], characters:[], props:[], locations:[], sluglineUnits:[], lookbook:[], lookbookNote:"", lookbookApplied:{}, shots:[],
    project:{ title:"Untitled film", genre:"", logline:"", controllingIdea:{} },
    drafts:{}, beatsMap:{}, history:{}, continuityMap:{},
    selId:null, room:"writers", view:"spine", artView:"lookbook", propsSeeded:false, locsSeeded:false, visualsSeeded:false,
    trash:{ characters:[], props:[], locations:[], shots:[] }, blank:true });
  /* The Matrix sample as a full project doc — used ONLY to seed the admin
     account's first project (the demo lives in the admin account by default). */
  const sampleDoc = ()=>({ scenes:SCENES, characters:CHARACTERS, props:(window.PROPS_SEED||[]), locations:[], sluglineUnits:[], lookbook:[], lookbookNote:"", lookbookApplied:{}, shots:[],
    project:PROJECT, drafts:SCREENPLAY, beatsMap:BEATS, history:{}, continuityMap:CONTINUITY||{},
    selId:"s4", propsSeeded:false, locsSeeded:false, visualsSeeded:false });
  // `stale` (optional): a superseded load must NOT clear hydratingRef when its 500ms
  // settle fires — the newer load owns hydration by then, and clearing it early would
  // reopen the very save window this guards.
  const applyDoc = (d, stale, onSettled)=>{
    d = d || {};
    hydratingRef.current = true;
    // honor an explicitly-empty project (clean canvas). A missing/legacy field only
    // falls back to The Matrix sample for the ADMIN account (demo upkeep) — every
    // other user gets an empty field instead: the sample is admin-only.
    const _scenesIn = Array.isArray(d.scenes)?d.scenes:(isAdmin?SCENES:[]);
    setScenes(_scenesIn);
    const loadedCharacters = d.characters||(isAdmin?CHARACTERS:[]);
    const prunedCharacters = typeof window.turnPruneAccidentalManualCast==="function"
      ? window.turnPruneAccidentalManualCast(loadedCharacters, { ...d, characters:loadedCharacters })
      : loadedCharacters;
    // films and the Show Bible cast (an Episode hydrates it here) both drop the stray
    // "_revised" note in memory. The section baseline below is taken WITHOUT it too, so
    // opening a project never counts as a cast change (no save on open, and no false
    // "your role can't save the cast" rollback for a Writer); the stored copy loses the
    // note with the next real cast save, which sends the clean cast
    setCharacters(typeof window.turnStripStrayRevised==="function"
      ? window.turnStripStrayRevised(prunedCharacters) : prunedCharacters);
    setProps(d.props||(isAdmin?(window.PROPS_SEED||[]):[]));
    setLocations(d.locations||[]);
    setSlugUnitsOv(Array.isArray(d.sluglineUnits)?d.sluglineUnits:[]);
    setLookbook(d.lookbook||[]);
    setLookbookNote(d.lookbookNote||"");
    setLookbookApplied(d.lookbookApplied||{});
    setShots(d.shots||[]);
    setProject(d.project||(isAdmin?PROJECT:{ title:"Untitled film", genre:"", logline:"", controllingIdea:{} }));
    setDrafts(d.drafts||(isAdmin?SCREENPLAY:{}));
    const loadedBeats=d.beatsMap||(isAdmin?BEATS:{});
    setBeatsMap((typeof withBeatMapIdentity==="function")?withBeatMapIdentity(loadedBeats):loadedBeats);
    setHistory(d.history||{});
    setContinuityMap(d.continuityMap||(isAdmin?(CONTINUITY||{}):{}));
    // An open Inspector always enters a loaded film on Scene 1 and the Story rail
    // yields the workspace to it. When the Inspector is closed, keep restoring the
    // user's last valid scene so opening the panel later does not erase navigation.
    const _firstScene = turnFirstStoryScene(_scenesIn);
    if(inspOpenRef.current && _firstScene){
      setSelId(_firstScene.id); setSelChar(null); setFocusBeat(null); setRailOpen(false);
    } else {
      const _navSel = nav && nav.selId;
      const _navSelOk = _navSel && _scenesIn.some(sc=>sc && sc.id===_navSel);
      setSelId(_navSelOk ? _navSel : (d.selId||(isAdmin?"s4":null)));
    }
    // Navigation (room / view / artView) is device-local UI state owned by NAV_KEY
    // and restored synchronously in useState above (the Art Room tab per film, keyed
    // by the project id — see turnNavArtViewMap). Intentionally do NOT re-apply
    // any of it from the hydrated doc — that re-application is what produced the
    // Art Room flash (and would fight the user's restored place) on load.
    setPropsSeeded(!!d.propsSeeded);
    setLocsSeeded(!!d.locsSeeded);
    setVisualsSeeded(!!d.visualsSeeded);
    setTrash(d.trash && typeof d.trash==="object"
      ? { characters:d.trash.characters||[], props:d.trash.props||[], locations:d.trash.locations||[], shots:d.trash.shots||[] }
      : _emptyTrash());
    /* seed the per-section baseline from the doc we just loaded. Without this the first
       save after opening a film would treat EVERY section as locally changed and write the
       lot — flattening anything a collaborator changed in the meantime, which is exactly
       the whole-doc behaviour we're replacing. */
    try{
      const base = {};
      ["scenes","characters","props","locations","sluglineUnits","lookbook","lookbookNote","lookbookApplied","shots",
       "project","drafts","beatsMap","history","continuityMap","trash","selId",
       "propsSeeded","locsSeeded","visualsSeeded"].forEach(k=>{
        if(d[k]===undefined) return;
        // the stray "_revised" strip above is a load-time cleanup, not an edit: the baseline
        // leaves it out as well (the accidental-cast prune still reads as a change, as before)
        base[k] = stableJson(k==="characters" && Array.isArray(d[k]) && typeof window.turnStripStrayRevised==="function"
          ? window.turnStripStrayRevised(d[k]) : d[k]);
      });
      lastSentRef.current = base;
    }catch(e){ lastSentRef.current = {}; }
    setTimeout(()=>{
      if(typeof stale==="function" && stale()) return;   // a newer load owns hydration now
      hydratingRef.current = false;
      if(typeof onSettled==="function") onSettled();
      setHydrationTick(t=>t+1);
    }, 500);
  };
  // SERIES (Phase 3): the show's BIBLE is itself a project row ({isShow, bible});
  // episodes are normal rows whose doc carries {showId, episodeNo}. On load, an
  // episode merges the bible's shared departments (cast/locations/props/lookbook)
  // into state, and the asset layer routes those entities' sheets to the show scope.
  const [currentShowId, setCurrentShowId] = React.useState(null);
  const [currentEpisodeNo, setCurrentEpisodeNo] = React.useState(null);
  const showIdRef = React.useRef(null); showIdRef.current = currentShowId;
  const [seriesBusy, setSeriesBusy] = React.useState("");
  const seriesBusyRef = React.useRef("");
  const autoSeriesAttemptRef = React.useRef({});
  // One pending Episode-create intent per app window. Only an ambiguous response
  // keeps this UUID for the user's explicit retry; another Show/tab/action starts
  // with a fresh UUID and can never inherit a stale browser-global request key.
  const episodeCreateRetryRef = React.useRef(null);
  const projectCreateRetryRef = React.useRef(null);
  // While a project is being split into Episode 1 + Show Bible, no save that
  // captured the old standalone scope may cross that server-side boundary.
  const seriesBoundaryRef = React.useRef(null);
  const bibleEntityIds = (bible)=> {
    bible=bible||{};
    const sharedTrash=(bible&&bible.trash)||{};
    return [].concat(
      (bible.characters||[]).map(c=>c.id), (bible.locations||[]).map(l=>l.id),
      (bible.props||[]).map(p=>p.id), (bible.lookbook||[]).map(r=>r.id),
      (sharedTrash.characters||[]).map(c=>c.id), (sharedTrash.locations||[]).map(l=>l.id),
      (sharedTrash.props||[]).map(p=>p.id)).filter((id,i,all)=>id&&all.indexOf(id)===i);
  };
  /* Shared cards keep one scene-membership slice per episode. The working `scenes`
     field remains the open episode's slice so every existing Art Room component can
     stay episode-local; episodeScenes is the durable, collision-safe Show index. */
  const withEpisodeSceneRefs = (entity, nextIds, sceneList)=>{
    const wanted=Array.isArray(nextIds)?nextIds:[];
    if(!currentShowId || !currentProjectId) return {...entity,scenes:wanted};
    const merged=(window.turnSeries&&typeof window.turnSeries.mergeEpisodeSceneRefs==="function")
      ? window.turnSeries.mergeEpisodeSceneRefs(entity,wanted,currentProjectId)
      : null;
    return merged&&typeof merged==="object"&&!Array.isArray(merged)
      ? merged
      : {...entity,scenes:wanted,episodeScenes:{...((entity&&entity.episodeScenes)||{}),[currentProjectId]:wanted}};
  };
  /* A shared location's screenplay-derived usage is Episode-owned in exactly the
     same way as its scene ids. Keep the current Episode materialized in the flat
     fields consumed by Location Scout, while retaining every sibling slice in
     episodeLocationMeta for the Show-Bible save boundary. */
  const withEpisodeLocationMeta = (entity, derived)=>{
    const source={...(derived||{})};
    const scoped=withEpisodeSceneRefs(entity,source.scenes,scenes);
    if(!currentShowId || !currentProjectId) return {...scoped,
      times:Array.isArray(source.times)?source.times:(scoped.times||[]),
      areas:Array.isArray(source.areas)?source.areas:(scoped.areas||[]),
      intExt:source.intExt!==undefined?source.intExt:scoped.intExt,
      scope:source.scope!==undefined?source.scope:scoped.scope,
      parentKey:source.parentKey!==undefined?source.parentKey:scoped.parentKey,
      continuityRootKey:source.continuityRootKey!==undefined?source.continuityRootKey:scoped.continuityRootKey};
    const merged=(window.turnSeries&&typeof window.turnSeries.mergeEpisodeLocationMeta==="function")
      ? window.turnSeries.mergeEpisodeLocationMeta(scoped,source,currentProjectId) : null;
    return merged&&typeof merged==="object"&&!Array.isArray(merged)
      ? merged
      : {...scoped,times:source.times||[],areas:source.areas||[],intExt:source.intExt||"",
          scope:source.scope||"",parentKey:source.parentKey||"",
          continuityRootKey:source.continuityRootKey||"",
          episodeLocationMeta:{...((scoped&&scoped.episodeLocationMeta)||{}),
          [currentProjectId]:{times:source.times||[],areas:source.areas||[],intExt:source.intExt||"",
            scope:source.scope||"",parentKey:source.parentKey||"",
            continuityRootKey:source.continuityRootKey||""}}};
  };
  /* Opening a film is ASYNC and interruptible, which used to corrupt docs two ways:
     (1) setCurrentProjectId landed BEFORE the series-bible fetch resolved, so for the
         length of that fetch the NEW film's id was paired with the PREVIOUS film's story
         while hydratingRef was still false — a save debounce firing in that window wrote
         the old story into the new film's doc. Fix: raise hydratingRef for the WHOLE
         load (every early-return clears it again), not just from applyDoc onward.
     (2) two loads could overlap (double-click in the film switcher) and the SLOWER one
         won the state while the faster one had set currentProjectId — id and story from
         different films, and the next autosave wrote one into the other. Fix: a
         monotonic sequence; a superseded load abandons without touching state. */
  const loadSeqRef = React.useRef(0);
  /* Save the currently rendered project before its state can be replaced. A request
     may finish while another edit creates a newer snapshot, so follow the moving
     pending pointer until the latest generation is durable (bounded defensively). */
  const flushPendingProjectSave = async (projectId)=>{
    const ownerId=projectId||projIdRef.current;
    if(!ownerId || !dirtyRef.current) return true;
    for(let pass=0; pass<4 && dirtyRef.current; pass++){
      const pending=pendingSaveRef.current;
      if(!pending || String(pending.projectId||"")!==String(ownerId)
        || typeof pending.request!=="function") return false;
      let ok=false;
      try{ ok=!!(await pending.request()); }catch(e){ ok=false; }
      if(String(projIdRef.current||"")!==String(ownerId)) return false;
      if(ok && !dirtyRef.current) return true;
      // A newer render may have replaced pendingSaveRef while the prior write was
      // in flight. Loop once more so that newer snapshot is included too.
      if(!pendingSaveRef.current || pendingSaveRef.current.generation===pending.generation) return false;
    }
    return !dirtyRef.current;
  };
  /* SERIES PAIRED-SAVE JOURNAL. Episode story sections and Show-Bible sections
     live in two rows, so the browser cannot commit them atomically. Before a save
     touches BOTH rows, persist the exact idempotent patches locally. A crash after
     either row commits leaves this small outbox entry behind; opening that same
     Episode replays both patches against fresh revisions and clears the entry only
     after both are confirmed. The journal is deliberately bounded and fail-closed:
     if it cannot be written, neither cloud write starts. */
  const SERIES_PAIR_OUTBOX_PREFIX="turn-series-pair-v1:";
  const SERIES_PAIR_OUTBOX_MAX_ENTRIES=12;
  const SERIES_PAIR_OUTBOX_MAX_ENTRY_CHARS=1750000;
  const SERIES_PAIR_OUTBOX_MAX_TOTAL_CHARS=3500000;
  const _seriesOutboxOwner=()=>String(
    ((typeof cloudUserId==="function")&&cloudUserId(session))
      ||(session&&session.user&&session.user.id)||"");
  const _seriesOutboxRows=(episodeId,showId)=>{
    const owner=_seriesOutboxOwner(), rows=[];
    if(!owner) return rows;
    try{
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);
        if(!key||!key.startsWith(SERIES_PAIR_OUTBOX_PREFIX)) continue;
        let entry=null;
        try{ entry=JSON.parse(localStorage.getItem(key)||"null"); }catch(e){}
        if(!entry||entry.version!==1) continue;
        if(String(entry.ownerId||"")!==owner) continue;
        if(episodeId&&String(entry.episodeId||"")!==String(episodeId)) continue;
        if(showId&&String(entry.showId||"")!==String(showId)) continue;
        rows.push({key,entry});
      }
    }catch(e){ return []; }
    rows.sort((a,b)=>(Number(a.entry.at)||0)-(Number(b.entry.at)||0)
      ||String(a.entry.id||"").localeCompare(String(b.entry.id||"")));
    return rows;
  };
  const _seriesOutboxPut=(payload)=>{
    const ownerId=_seriesOutboxOwner();
    if(!ownerId) return null;
    try{
      const mine=_seriesOutboxRows();
      if(mine.length>=SERIES_PAIR_OUTBOX_MAX_ENTRIES) return null;
      const id=(window.crypto&&typeof window.crypto.randomUUID==="function")
        ? window.crypto.randomUUID()
        : Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);
      const entry={version:1,id,ownerId,at:Date.now(),...payload};
      const raw=JSON.stringify(entry);
      const used=mine.reduce((n,row)=>{
        try{ return n+String(localStorage.getItem(row.key)||"").length; }catch(e){ return n; }
      },0);
      if(raw.length>SERIES_PAIR_OUTBOX_MAX_ENTRY_CHARS
        ||used+raw.length>SERIES_PAIR_OUTBOX_MAX_TOTAL_CHARS) return null;
      const key=SERIES_PAIR_OUTBOX_PREFIX+ownerId+":"+id;
      localStorage.setItem(key,raw);
      // Verify the write: quota/privacy modes may fail without a useful exception.
      if(localStorage.getItem(key)!==raw){ try{ localStorage.removeItem(key); }catch(e){} return null; }
      return key;
    }catch(e){ return null; }
  };
  const _seriesOutboxClear=(key)=>{ try{ if(key) localStorage.removeItem(key); }catch(e){} };
  const _replaySeriesPairOutbox=async(episodeId,showId)=>{
    const rows=_seriesOutboxRows(episodeId,showId);
    const attempted=rows.length>0;
    let replayed=false,lastBible=null,lastBiblePatch={};
    for(const row of rows){
      const item=row.entry||{};
      let ep={ok:true,noop:true}, bibleResult={ok:true,noop:true};
      try{
        if(item.episodePatch&&Object.keys(item.episodePatch).length)
          ep=await cloudSaveSections(episodeId,item.episodePatch,
            {baseline:item.episodeBaseline||{}});
        if(ep&&ep.ok&&item.biblePatch&&Object.keys(item.biblePatch).length)
          bibleResult=await cloudSaveBibleSections(showId,item.biblePatch,{
            episodeId,baseline:item.bibleBaseline||{}});
      }catch(e){
        return {ok:false,attempted,replayed,lastBible,message:(e&&e.message)||"The interrupted Series save could not be reconciled yet."};
      }
      if(!(ep&&ep.ok&&bibleResult&&bibleResult.ok)){
        const failed=!(ep&&ep.ok)?ep:bibleResult;
        return {ok:false,attempted,replayed,lastBible,conflict:!!(failed&&failed.conflict),
          message:(failed&&failed.message)||"The interrupted Series save could not be reconciled yet."};
      }
      // Both writes are confirmed (including idempotent no-ops); only now may the
      // durable recovery record disappear.
      _seriesOutboxClear(row.key);
      if(bibleResult.bible){
        lastBible=bibleResult.bible;
        Object.keys(item.biblePatch||{}).forEach(k=>{ lastBiblePatch[k]=item.biblePatch[k]; });
      }
      replayed=true;
    }
    return {ok:true,attempted,replayed,lastBible,lastBiblePatch};
  };
  const loadProjectIntoState = async (id, opts)=>{
    const fromId=projIdRef.current;
    if(!(opts&&opts.discardPending) && fromId && String(id)!==String(fromId)){
      const flushed=await flushPendingProjectSave(fromId);
      if(!flushed){
        if(typeof window.appToast==="function") window.appToast(
          "This film still has unsaved changes. It will stay open until they are saved.","error");
        return false;
      }
    }
    if(fromId && String(id)!==String(fromId)) episodeCreateRetryRef.current=null;
    if(opts&&opts.discardPending){
      // The caller has explicitly chosen a server-authoritative replacement (for
      // example after deletion or a conflict). Invalidate any completion already
      // on the wire so its failure cannot retry or repaint the UI.
      ++saveGenerationRef.current;
      pendingSaveRef.current=null;
      dirtyRef.current=false;
      clearTimeout(saveTimer.current);
    }
    const seq = ++loadSeqRef.current;
    const stale = ()=> loadSeqRef.current !== seq;
    hydratingRef.current = true;
    projectLoadingRef.current=true;
    setProjectLoading(true);
    // release the save-block ONLY if we still own the load; if a newer load superseded
    // us it owns hydration now and will clear it when it finishes.
    const release = ()=>{ if(!stale()){
      hydratingRef.current = false;
      projectLoadingRef.current=false;
      setProjectLoading(false);
    } };
    const settle = ()=>{ if(!stale()){
      projectLoadingRef.current=false;
      setProjectLoading(false);
    } };
    const row = await cloudLoadProject(id);
    if(!row || stale()){ release(); return false; }   // false = this call did NOT land server truth
    let d = row.doc || {};
    let showRow = null, bible = null, readyDoc = d;
    if(d.showId){
      showRow = await cloudLoadProject(d.showId);
      if(stale()){ release(); return false; }
      if(showRow){
        const repaired=await _replaySeriesPairOutbox(id,d.showId);
        if(stale()){ release(); return false; }
        if(repaired.attempted){
          // Re-read both rows after replay so the UI hydrates the reconciled truth,
          // not the pre-recovery snapshots fetched immediately above.
          const refreshedEpisode=await cloudLoadProject(id);
          const refreshedShow=await cloudLoadProject(d.showId);
          if(stale()){ release(); return false; }
          if(refreshedEpisode) d=refreshedEpisode.doc||d;
          if(refreshedShow) showRow=refreshedShow;
        }
        if(!repaired.ok && typeof window.appToast==="function")
          window.appToast("An interrupted Episode + Show Bible save is still pending — "+repaired.message,"error");
      }
      readyDoc = (window.turnSeries && typeof window.turnSeries.hydrateEpisode==="function")
        ? window.turnSeries.hydrateEpisode(d, showRow&&showRow.doc, id)
        : null;
      /* Never turn an unavailable Show Bible into five empty departments. That
         looked like a successful load and the next autosave permanently replaced
         the shared world with emptiness. Leave the previous film intact instead. */
      if(!showRow || !readyDoc){
        release();
        if(typeof window.appToast==="function") window.appToast(
          "Couldn’t open this episode because its Show Bible is unavailable. Your previous project is still open.","error");
        return false;
      }
      bible = (window.turnSeries && typeof window.turnSeries.sharedBible==="function")
        ? window.turnSeries.sharedBible((showRow.doc&&showRow.doc.bible)||{})
        : ((showRow.doc&&showRow.doc.bible)||{});
    }
    if(typeof window.cloudNoteDocRev==="function"){
      window.cloudNoteDocRev(id, d);
      if(showRow) window.cloudNoteDocRev(d.showId, showRow.doc);
    }
    const uid = (typeof cloudUserId==="function") ? cloudUserId(session) : null;
    if(typeof nbUseCloud==="function") nbUseCloud(id, uid);   // re-scope the image cache to this film
    if(typeof window.vgResetAll==="function") window.vgResetAll();   // and clear voice/video caches
    if(typeof window.vidResetAll==="function") window.vidResetAll();
    setCurrentProjectId(id);
    setCloudConnectionState("connected");
    bibleRebaseRef.current=null;
    if(d.showId){
      setCurrentShowId(d.showId);
      setCurrentEpisodeNo(d.episodeNo || null);
      if(typeof nbUseShared==="function") nbUseShared(d.showId, bibleEntityIds(bible));
      bibleSavedRef.current = stableJson(bible);
      applyDoc(readyDoc, stale, settle);
    } else {
      setCurrentShowId(null); setCurrentEpisodeNo(null);
      bibleSavedRef.current = null;
      if(typeof nbUseShared==="function") nbUseShared(null);
      applyDoc(readyDoc, stale, settle);
    }
    // Pull this episode's take records only after the episode + Show Bible have
    // committed as one coherent scope. A fast switch is still dropped by the
    // video store's own project/epoch guard.
    if(typeof window.vidCloudHydrate==="function")
      setTimeout(()=>{ try{ window.vidCloudHydrate().then(()=>{
        if(typeof window.videoProxyReady==="function" && window.videoProxyReady()
          && typeof window.vidRecoverPending==="function") window.vidRecoverPending();
        /* RENDERS THAT FINISHED WHILE YOU WERE AWAY (2026-10-09, owner — Stage editor review, decision D): a
           collaborator's render paid by you lands in the film even if they were removed, sharing paused or
           the plan changed before it finished — the server keeps it, and your app adds it here (owner only). */
        if(typeof window.vidCollectPendingTakes==="function")
          Promise.resolve(window.vidCollectPendingTakes(id)).then(n=>{
            if(n>0 && typeof window.appToast==="function") window.appToast(n+" render"+(n!==1?"s":"")+" finished while you were away "+(n!==1?"were":"was")+" added to the film.","success");
          }).catch(()=>{});
      }); }catch(e){} }, 0);
    /* A conversion may have completed while copying legacy Episode 1 sheets was
       interrupted. Owners resume that idempotent promotion on the next load;
       collaborators never try to copy somebody else's Storage paths. */
    const showDoc=showRow&&showRow.doc;
    const migration=showDoc&&showDoc.assetMigration;
    const migrationFrom=(migration&&migration.from)||(showDoc&&showDoc.sourceEpisodeId);
    if(showRow && showRow.owner===uid && migrationFrom
      && (!migration || migration.status!=="complete")
      && typeof window.cloudPromoteProjectAssets==="function"){
      window.__turnSeriesMigrations=window.__turnSeriesMigrations||{};
      if(!window.__turnSeriesMigrations[showRow.id]){
        window.__turnSeriesMigrations[showRow.id]=(async()=>{
          const result=await window.cloudPromoteProjectAssets(migrationFrom,showRow.id,bibleEntityIds(bible||{}));
          const marker={from:migrationFrom,status:(result&&result.ok)?"complete":"pending",
            at:new Date().toISOString(),moved:Number(result&&result.moved)||0,
            ...((result&&result.message)?{lastError:result.message}:{})};
          if(typeof window.cloudSaveSections==="function") await window.cloudSaveSections(showRow.id,{assetMigration:marker});
          if(result&&result.ok && projIdRef.current===id){
            if(typeof nbUseShared==="function") nbUseShared(showRow.id,bibleEntityIds(bible||{}));
            if(typeof window.nbPrefetchAll==="function") window.nbPrefetchAll();
          }
          return result;
        })().finally(()=>{ delete window.__turnSeriesMigrations[showRow.id]; });
      }
    }
    // A project with no story can't live in the (locked) Art Room — applyDoc
    // deliberately never re-applies the room, so creating or switching to a blank
    // project while in the Art Room would otherwise strand the user there. Force the
    // Writers' Room so a new story always begins on the spine. (Only ever pulls TOWARD
    // writers — never flashes into art — so it doesn't reintroduce the load-flash bug.)
    if(!((readyDoc.scenes||[]).length)){ setRoom("writers"); setView("spine"); }
    return true;   // this call hydrated the film from server truth
  };
  /* on sign-in: load the user's projects (creating a first one if needed) and open
     the most recent. On sign-out: drop cloud mode and fall back to local storage. */
  /* Bootstrap the project list ONCE per sign-in. `session` changes on every auth
     event (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED…), and the create-if-empty
     below is async — without this guard, several concurrent runs each see an empty
     list and each create a "My film", spawning duplicate empty projects. The ref
     resets on sign-out so the next sign-in bootstraps again. */
  const bootRef = React.useRef(false);
  const bootLoadWarnedRef = React.useRef(false);
  const bootRetryDelayRef = React.useRef(1500);
  const [bootRetryTick,setBootRetryTick] = React.useState(0);
  // Depend on the STABLE user id, not the session object: Supabase fires several auth
  // events on sign-in (INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED), each a NEW session
  // object. If the effect keyed on `session`, a later event would re-run it and cancel the
  // in-flight bootstrap (alive=false) while bootRef blocked the new run — so the project
  // never loaded and the app sat on "Connecting". Keying on the uid runs it once per sign-in.
  const bootUserId = session ? (((typeof cloudUserId==="function") && cloudUserId(session)) || "signed-in") : null;
  React.useEffect(()=>{
    if(!(typeof cloudConfigured==="function" && cloudConfigured())) return;
    if(!bootUserId){
      bootRef.current=false; bootLoadWarnedRef.current=false; bootRetryDelayRef.current=1500;
      setCloudConnectionState("idle"); setProjects([]); setCurrentProjectId(null);
      if(typeof nbUseLocal==="function") nbUseLocal();
      return;
    }
    if(bootRef.current) return;            // already bootstrapped this sign-in
    bootRef.current = true;
    setCloudConnectionState(bootRetryTick ? "retrying" : "connecting");
    let alive = true;
    let retryTimer=null;
    const retryBoot=(message,showWall)=>{
      if(!alive) return;
      bootRef.current=false;
      setCloudConnectionState("retrying");
      if(showWall) setHomeOpen(true);
      if(!bootLoadWarnedRef.current && typeof window.appToast==="function"){
        bootLoadWarnedRef.current=true;
        window.appToast(message||"Lost the cloud connection. Your open work stays on screen while we reconnect.","info");
      }
      const delay=bootRetryDelayRef.current;
      bootRetryDelayRef.current=Math.min(delay*2,15000);
      retryTimer=setTimeout(()=>{ if(alive) setBootRetryTick(t=>t+1); },delay);
    };
    (async()=>{
      let list = await cloudListProjects();
      // null is a bounded request failure, not an empty account. Release the boot
      // latch before retrying so one hung/failed read can never leave the account
      // chip permanently on Connecting.
      if(list===null){
        try{ const sb=(typeof sbClient==="function")&&sbClient(); if(sb) Promise.resolve(sb.auth.refreshSession()).catch(()=>{}); }catch(e){}
        retryBoot("Lost the cloud connection. Your open work stays on screen while we reconnect.",false);
        return;
      }
      if(!alive) return;
      bootRetryDelayRef.current=1500;
      // Read the session FRESH here — during sign-in the captured `isAdmin`
      // can lag a render behind the session this bootstrap is running for.
      const s = (typeof cloudGetSession==="function") ? await cloudGetSession() : null;
      const adminBoot = (((typeof cloudUserEmail==="function" && cloudUserEmail(s))||"").toLowerCase()==="admin@infinitestudioai.com");
      // LEGACY CLEANUP: before the demo was admin-gated, every new account was
      // seeded with The Matrix. Remove the UNMODIFIED demo from non-admin accounts
      // (same premise + scene count + first scene as the seed); anything the user
      // actually edited is left alone.
      if(!adminBoot){
        for(const row of list.filter(r=>/^the matrix$/i.test(r.title||""))){
          try{
            const full = await cloudLoadProject(row.id);
            const d = (full && full.doc) || {};
            const pr = d.project || {};
            const sc = Array.isArray(d.scenes) ? d.scenes : [];
            const pristine = pr.premise===PROJECT.premise && sc.length===SCENES.length
              && sc[0] && SCENES[0] && sc[0].title===SCENES[0].title;
            if(pristine){ await cloudDeleteProject(row.id); list = list.filter(x=>x.id!==row.id); }
          }catch(e){}
        }
      }
      if(!list.length){
        // admin's first project IS the Matrix demo; everyone else starts clean.
        const created = adminBoot
          ? await cloudCreateProject("The Matrix", sampleDoc())
          : await cloudCreateProject("Untitled film", emptyDoc());
        if(created) list = [created];
      }
      if(!alive) return;
      setProjects(list);
      // never auto-open a SHOW (bible) row — open the most recent episode/film
      const openable = list.filter(p=>!isShowProject(p));
      let opened=false;
      for(const row of openable){
        if(await loadProjectIntoState(row.id)){ opened=true; break; }
        if(!alive) return;
      }
      if(!opened){
        /* A transient Episode/Show read must not latch boot forever on an empty
           "Connecting" surface. Keep the project wall reachable and retry the
           authoritative load without manufacturing another project row. */
        retryBoot(openable.length
          ? "Your projects loaded, but none opened yet. We\u2019ll retry automatically."
          : "Your first film hasn't opened yet. We\u2019ll retry automatically.",true);
        return;
      }
      bootLoadWarnedRef.current=false;
      setCloudConnectionState("connected");
      // a studio whose EVERY film is a share (invitee with no own work yet)
      // boots onto the home wall, where the share is explained (owner + role),
      // instead of being dropped wordlessly into someone else's Writers' Room.
      // Skip when an invite landing is about to present its own welcome surface.
      if(alive && openable.length && openable.every(p=>p.isShared) && !inviteLanding)
        setHomeOpen(true);
    })().catch(()=>{
      retryBoot("We hit a connection problem while opening your films. Your work stays on screen and we\u2019ll retry automatically.",false);
    });
    return ()=>{ alive=false; if(retryTimer) clearTimeout(retryTimer); };
  },[bootUserId,bootRetryTick]);

  React.useEffect(()=>{
    if(!bootUserId) return;
    const reconnect=()=>{
      if(projIdRef.current) return;
      bootRef.current=false;
      bootRetryDelayRef.current=1500;
      setCloudConnectionState("retrying");
      setBootRetryTick(t=>t+1);
    };
    window.addEventListener("online",reconnect);
    return ()=>window.removeEventListener("online",reconnect);
  },[bootUserId]);

  const switchProject = async (id)=>{
    if(id===currentProjectId) return true;
    return !!(await loadProjectIntoState(id));
  };
  // a Show opens on its first episode (a Show row is a container, never opened as a film) — the invite
  // card did this; the owner's bell opened the Show itself (2026-10-09, Team review)
  const openableFilmId = (id)=>{
    const row = (projects||[]).find(p=>p && p.id===id);
    if(!row || !isShowProject(row)) return id;
    const first = (projects||[]).filter(p=>String(p.showId||"")===String(row.id))
      .sort((a,b)=>(Number(a.episodeNo)||0)-(Number(b.episodeNo)||0))[0];
    return first ? first.id : null;
  };
  /* CLAIM INVITATIONS once per sign-in: links membership rows addressed to my
     verified email onto my account id (turn_claim_memberships), so access stops
     depending on the email string. Returns only NEWLY linked films — announce
     those so a first sign-in after an invite never needs stumbling. Runs in
     parallel with the project bootstrap: RLS already matches by email, so the
     film is in the list either way; the claim is for durable linking + the notice. */
  const claimRef = React.useRef(null);
  React.useEffect(()=>{
    if(!bootUserId){ claimRef.current=null; setInviteClaims(null); return; }
    if(claimRef.current===bootUserId) return;
    claimRef.current = bootUserId;
    (async()=>{
      const rows = (typeof cloudClaimInvites==="function") ? await cloudClaimInvites() : [];
      setInviteClaims(rows||[]);
      // toast the films that were shared while we weren't looking — except the one
      // the invite-landing surface is about to present full-screen
      const news = (rows||[]).filter(r=>r && r.project_id!==inviteLanding);
      if(news.length && typeof window.appToast==="function"){
        if(news.length===1){
          // the owner's NAME, never their email address (2026-10-09, Team review)
          const byName = news[0].invited_by ? ((typeof window.teamInviterName==="function") ? window.teamInviterName(news[0].invited_by) : "") : "";
          const by = byName ? (" by "+byName) : "";
          window.appToast("\u201C"+(news[0].title||"A film")+"\u201D was shared with you"+by+".","success");
        } else {
          window.appToast(news.length+" films were shared with you \u2014 they're in your project list.","success");
        }
      }
    })();
  },[bootUserId]);
  /* arriving on an invite link while signed out: open the sign-in modal right away
     (the invitation's account may already exist; new invite-created accounts arrive
     already signed in via the email link, so they never see this) */
  const inviteAuthRef = React.useRef(false);
  React.useEffect(()=>{
    if(!inviteLanding || !authReady || session || inviteAuthRef.current) return;
    inviteAuthRef.current = true;
    openAuth("signin");
  },[inviteLanding, authReady, !!session]);
  const createProject = async (title, opts)=>{
    opts={...(opts||{})};
    const createTitle=title||"Untitled film";
    const implicitIntent=!opts.requestId;
    const pendingIntent=projectCreateRetryRef.current;
    if(implicitIntent && pendingIntent && pendingIntent.title===createTitle)
      opts.requestId=pendingIntent.requestId;
    const launchScope=opts.launchScope||{
      projectId:projIdRef.current,
      loadSeq:loadSeqRef.current,
      homeOpen:homeOpenRef.current,
    };
    const ownerId=projIdRef.current;
    if(ownerId && !(await flushPendingProjectSave(ownerId))){
      if(typeof window.appToast==="function") window.appToast(
        "Save the current film before creating another one.","error");
      return null;
    }
    const created = await cloudCreateProject(createTitle, emptyDoc(),opts);
    if(!created){
      if(implicitIntent && window.cloudLastCreateRequestId)
        projectCreateRetryRef.current={title:createTitle,requestId:window.cloudLastCreateRequestId};
      return null;   // callers MUST treat null as "no film was minted"
    }
    if(implicitIntent) projectCreateRetryRef.current=null;
    setProjects(ps=>[created, ...ps.filter(p=>p.id!==created.id)]);
    const launchStillActive=String(projIdRef.current||"")===String(launchScope.projectId||"")
      && loadSeqRef.current===Number(launchScope.loadSeq)
      && homeOpenRef.current===!!launchScope.homeOpen;
    if(!launchStillActive) return {ok:true,created:true,id:created.id,opened:false,superseded:true,
      message:"The new film was created and added to the project list. Your current screen was left unchanged."};
    const openingSeq=loadSeqRef.current;
    let opened=await loadProjectIntoState(created.id);
    /* A committed row deserves one read retry, using the SAME id. Only retry if
       the failed load is still the latest navigation initiated here; a user who
       opened Home or another project must never be pulled back by this result. */
    const firstLoadStillOurs=!opened
      && loadSeqRef.current===openingSeq+1
      && String(projIdRef.current||"")===String(launchScope.projectId||"")
      && homeOpenRef.current===!!launchScope.homeOpen;
    if(firstLoadStillOurs) opened=await loadProjectIntoState(created.id);
    if(!opened){
      const ownAttempts=firstLoadStillOurs?2:1;
      const superseded=loadSeqRef.current!==openingSeq+ownAttempts
        || (projIdRef.current && String(projIdRef.current)!==String(launchScope.projectId||""))
        || homeOpenRef.current!==!!launchScope.homeOpen;
      if(superseded) return {ok:true,created:true,id:created.id,opened:false,superseded:true,
        message:"The new film was created and added to the project list. Your current screen was left unchanged."};
      return {ok:false,created:true,id:created.id,
        message:"The new film was saved, but it couldn\u2019t be opened yet. Retrying is safe and won\u2019t create a duplicate."};
    }
    // a fresh film opens the Art Room on the Lookbook (front of the pipeline). Keyed to the NEW film:
    // React hasn't re-rendered onto it yet, so a plain setArtView would re-tab the film we just left.
    setArtViewFor(created.id, "lookbook");
    return created.id;
  };
  /* Dashboard: mint an AI poster for a film from its title + logline and persist it
     onto doc.cover, so the Recent Projects cards show real key art. Routes through the
     same image proxy as the rest of the studio (no key in the browser). Returns the
     data URL (and stamps it into the projects list) so callers can show it immediately. */
  /* Resolve a film's LEAD cast portrait URLs to use as poster reference images.
     Loads from the cloud by film id, so it works for ANY recent film on the
     dashboard (not just the one currently open).
     Returns { ok, urls }:
       ok:false  → couldn't read the film's cast (auth/network blip). The caller
                   must NOT paint a poster this round (no spend); it retries on
                   the next dashboard open instead of baking in wrong art.
       ok:true, urls:[]  → the film genuinely has no cast portraits → paint a
                   character-free poster (never invent people).
     For a SHOW EPISODE the shared cast lives in the show's bible (keyed by
     doc.showId), and its portrait sheets are stored under the show id — so we
     read the bible and load assets from the show scope (falling back to the
     episode scope for any legacy per-episode sheets). Capped to a few leads for
     a coherent poster and sane cost. */
  const _posterCanonFor = async (proj)=>{
    const NONE = { ok:true, cast:[], world:null, prop:null, style:null };
    if(!proj || !proj.id || typeof window.cloudLoadProject!=="function") return NONE;
    let row;
    try{ row = await window.cloudLoadProject(proj.id); }catch(e){ return { ok:false }; }
    if(!row) return { ok:false };   // read failed — don't persist a wrong poster
    const doc = row.doc || {};
    const pickList = (k)=> (Array.isArray(doc[k]) && doc[k])
      || (doc.bible && Array.isArray(doc.bible[k]) && doc.bible[k]) || [];
    let chars = pickList("characters"), locs = pickList("locations"), props = pickList("props");
    let scopeId = proj.id;
    if(doc.showId){   // episode → pull the shared world from the show's bible
      let showRow;
      try{ showRow = await window.cloudLoadProject(doc.showId); }catch(e){ return { ok:false }; }
      if(!showRow) return { ok:false };   // couldn't reach the show bible — retry later
      const bible = (showRow.doc && showRow.doc.bible) || {};
      if(!window.turnSeries || typeof window.turnSeries.isShowDoc!=="function"
        || typeof window.turnSeries.validBibleShape!=="function"
        || !window.turnSeries.isShowDoc(showRow)
        || !window.turnSeries.validBibleShape(bible)) return { ok:false };
      /* Every shared department is authoritative independently. A character-free
         Show may still have canonical locations and props; using the Episode row
         merely because bible.characters is empty loses those references and can
         paint an invented world. */
      chars = Array.isArray(bible.characters) ? bible.characters : [];
      locs = Array.isArray(bible.locations) ? bible.locations : [];
      props = Array.isArray(bible.props) ? bible.props : [];
      scopeId = doc.showId;
    }
    // The film's OWN medium: the dominant picked render style across its entities —
    // an animated film must get an animated one-sheet, not a photoreal one.
    const tally = {};
    [...chars, ...props, ...locs].forEach(e=>{ const k = e && e.renderStyleKey; if(k) tally[k]=(tally[k]||0)+1; });
    const topKey = Object.keys(tally).sort((a,b)=>tally[b]-tally[a])[0] || null;
    let style = null;
    if(topKey && topKey!=="photoreal"){
      const block = (window.CHAR_RENDER_STYLES||{})[topKey];
      const medium = block && block.rendering;
      if(medium) style = { label:String(((typeof window.renderStylePromptName==="function") && window.renderStylePromptName(topKey)) || (window.RENDER_STYLE_LABELS||{})[topKey] || topKey).replace(/^[🔒🌐]\s*/,""), medium };
    }
    // one asset read covers everything: lead cast (identity-critical) + the first
    // few locations/props (world grounding — the poster must show THIS film's
    // world and objects, never invented ones)
    const castIds = chars.slice(0,3).map(c=>c && c.id).filter(Boolean);
    const locIds  = locs.slice(0,4).map(l=>l && l.id).filter(Boolean);
    const propIds = props.slice(0,4).map(p=>p && p.id).filter(Boolean);
    const ids = [...castIds, ...locIds, ...propIds];
    if(!ids.length) return { ...NONE, style };
    let byId;
    try{ byId = (typeof window.cloudAssetLoadMany==="function") ? (await window.cloudAssetLoadMany(scopeId, ids, true) || {}) : {}; }
    catch(e){ return { ok:false }; }
    if(scopeId!==proj.id){   // legacy fallback: some sheets may sit under the episode id
      const missing = ids.filter(id=> !(byId[id] && byId[id].url));
      if(missing.length){ try{ const ep = await window.cloudAssetLoadMany(proj.id, missing) || {}; byId = { ...ep, ...byId }; }catch(e){} }
    }
    const urlOf = (id)=> (byId[id] && byId[id].url) || "";
    const cast = castIds.map(urlOf).filter(Boolean);
    const identityCast = chars.filter(c=>c && castIds.includes(c.id) && urlOf(c.id));
    const identityContext = { cast:chars, scenes:doc.scenes||[], drafts:doc.drafts||{},
      characterIds:identityCast.map(c=>c.id) };
    if(typeof window.turnAssertCharacterIdentity==="function")
      identityCast.forEach(c=>window.turnAssertCharacterIdentity(c,identityContext));
    identityCast.forEach(c=>{
      const asset=byId[c.id], meta=(asset&&asset.meta)||{};
      const saved=(meta.identitySnapshot&&meta.identitySnapshot.pronouns)||meta.canonicalPronouns;
      if(meta.identityStale || (saved && c.pronouns && saved!==c.pronouns))
        throw new Error("Regenerate "+c.name+"'s character sheet before using it in the poster: its identity has changed.");
    });
    const firstWithArt = (list)=>{ for(const e of list.slice(0,4)){ const u = e && e.id && urlOf(e.id); if(u) return { url:u, name:(e.name||e.title||"").trim() }; } return null; };
    return { ok:true, cast, identityCast, identityContext, world:firstWithArt(locs), prop:firstWithArt(props), style };
  };
  /* THE POSTER LOOK — a recipe built from the classic one-sheet archetypes
     (Bass's single bold symbol; the Struzan painted montage; the lone figure
     dwarfed by a vast world à la Dune/Gravity/Lawrence; the Exorcist-style
     silhouette against one light source; the charged two-lead confrontation;
     the big-face portrait with the world ghosted into it; the uncanny frozen
     tableau). Each film gets ONE archetype (stable hash of its id, filtered to
     what its cast size supports) plus a palette and a light treatment — so
     posters are cinematic AND different film to film. Regenerate rotates to a
     different look, so a re-roll is a new concept, not the same image again. */
  const _posterLook = (proj, castN, vary)=>{
    const A = {
      symbol:     "THE ICONIC SYMBOL — distill the film into one bold symbolic image: a single object or motif from the story, monumental and graphic against a near-empty field. No figures.",
      vast:       "THE LONE FIGURE IN A VAST WORLD — the protagonist small in the frame, dwarfed by the enormous world around them; scale, weather and atmosphere carry the drama.",
      face:       "THE BIG FACE — an extreme close portrait of the protagonist filling the frame, eyes carrying the story; imagery of the film's world ghosted faintly into the shadows of the portrait.",
      silhouette: "THE SILHOUETTE — the protagonist as a dark shape against a single blazing light source (a doorway, a sky, a beam); identity read through outline and wardrobe.",
      back:       "THE THRESHOLD — the protagonist seen from behind, facing into the world or conflict that waits for them; we stand where they stand.",
      duel:       "THE CONFRONTATION — the two leads opposed across the frame, faces lit differently, charged negative space between them.",
      montage:    "THE PAINTED MONTAGE — a classic hand-painted cascade: the lead large and luminous, the others layered smaller around them on a sweeping diagonal, edges dissolving into the world.",
      tableau:    "THE FROZEN MOMENT — one arresting, uncanny moment from the story staged wide like a still from a dream; something is quietly wrong.",
    };
    const pool = castN===0 ? ["symbol","vast","tableau"]
      : castN===1 ? ["vast","face","silhouette","back"]
      : castN===2 ? ["duel","vast","silhouette","tableau"]
      : ["montage","tableau","vast"];
    const PALETTES = [
      "burnt orange against deep teal",
      "near-monochrome slate with a single crimson accent",
      "sodium-vapour amber night",
      "bleached bone-white and ink black",
      "wet neon — magenta and cyan on black rain",
      "golden-hour haze, long shadows",
      "cold moonlit blue broken by one warm lamplight",
      "storm green-grey with pale skin tones",
    ];
    const LIGHTS = [
      "one hard rim-light from behind, everything else falling to black",
      "a single overhead shaft of light through darkness",
      "low-key chiaroscuro, half the frame swallowed by shadow",
      "backlit through smoke or dust, god-rays",
      "practical glow — neon, fire or a lone bulb as the only source",
      "vast soft dusk light, the sky doing the work",
    ];
    const s = String(proj.id || proj.title || "poster");
    let hsh = 0; for(let i=0;i<s.length;i++) hsh = ((hsh*31) + s.charCodeAt(i)) >>> 0;
    let ai = hsh % pool.length, pi = (hsh>>>3) % PALETTES.length, li = (hsh>>>6) % LIGHTS.length;
    if(vary){   // a re-roll must LOOK different: step to another concept + treatment
      ai = (ai + 1 + Math.floor(Math.random()*Math.max(1, pool.length-1))) % pool.length;
      pi = (pi + 1 + Math.floor(Math.random()*(PALETTES.length-1))) % PALETTES.length;
      li = (li + 1 + Math.floor(Math.random()*(LIGHTS.length-1))) % LIGHTS.length;
    }
    return { concept:A[pool[ai]], usesCast: pool[ai]!=="symbol", palette:PALETTES[pi], light:LIGHTS[li] };
  };
  const generatePoster = async (proj, opts)=>{
    if(!proj || !proj.id) return "";
    // REGENERATE keeps the outgoing poster as one-deep history (doc.coverPrev)
    // so the Home card's Restore can bring it back.
    const keepPrev = (opts && opts.keepPrev) ? (proj.cover || "") : undefined;
    // In-flight dedupe (keyed by film id, app-level so it survives the dashboard
    // unmounting/remounting): if a poster for this film is ALREADY being painted,
    // hand back the SAME promise instead of launching a second, duplicate spend.
    const inflight = (window.__posterInflight = window.__posterInflight || {});
    if(inflight[proj.id]) return inflight[proj.id];
    const run = (async ()=>{
      /* If rendering succeeded but the small cover patch failed, reuse those
         exact bytes on retry. Never spend on a second image merely because a
         network/RLS race prevented the first one's metadata from committing. */
      const pendingSaves=(window.__posterSavePending=window.__posterSavePending||{});
      const pending=pendingSaves[proj.id];
      if(pending){
        const saved=typeof window.cloudSaveCover==="function"
          ? await window.cloudSaveCover(proj.id,pending.url,pending.keepPrev) : null;
        if(!(saved&&saved.ok)) throw new Error("The poster is ready but still couldn't be saved. Try again to retry the same image — no new generation will run.");
        delete pendingSaves[proj.id];
        setProjects(ps=>ps.map(p=>p.id===proj.id?{...p,cover:pending.url,
          ...(pending.keepPrev!==undefined?{coverPrev:pending.keepPrev}:{})}:p));
        return pending.url;
      }
      const title = proj.title || "Untitled film";
      const logline = ((proj && proj.logline) || "").trim();
      // THE POSTER RECIPE — every poster is grounded in the film's own canon,
      // loaded from the cloud (works for any recent film, not just the open one):
      //   1. CAST     lead character portrait sheets ride as refs — the poster
      //               shows THESE people, never invented faces.
      //   2. WORLD    the primary location plate rides as a ref — the setting is
      //               THIS film's world, never an invented backdrop.
      //   3. PROP     a signature object may feature, faithful to its sheet.
      //   4. MEDIUM   the film's dominant render style (Pixar, ukiyo-e, …) sets
      //               the poster's medium — an animated film gets an animated
      //               one-sheet; photoreal films get a live-action one-sheet.
      // Identity-critical reads FAIL CLOSED (skip this round, no spend, retry on
      // the next dashboard open) so a wrong poster is never baked in.
      const canon = await _posterCanonFor(proj);
      if(!canon.ok) return "";
      const look = _posterLook(proj, canon.cast.length, !!(opts && opts.keepPrev));
      const castUsed = look.usesCast ? canon.cast : [];
      const refs = [];
      let prompt = "Theatrical one-sheet movie poster key art for “"+title+"”. "+
        (logline ? logline+" " : "")+
        "\nCONCEPT — "+look.concept+
        "\nPALETTE & LIGHT: "+look.palette+"; "+look.light+". ";
      if(castUsed.length){
        castUsed.forEach(u=>refs.push(u));
        prompt += "\nCAST: reference image"+(castUsed.length>1?("s 1-"+castUsed.length):" 1")+
          " show"+(castUsed.length>1?"":"s")+" this film's ACTUAL cast — the poster's figure"+
          (castUsed.length>1?"s":"")+" must be exactly these people: wherever a face is visible it is "+
          "faithful to the reference (likeness and wardrobe), and where the concept hides the face the "+
          "build, hair and wardrobe still match. Never invent, add or substitute people. ";
      }else{
        prompt += "\nNO PEOPLE: do not invent or depict any characters — carry the poster on object, "+
          "setting, atmosphere and iconography alone. ";
      }
      if(canon.world){
        refs.push(canon.world.url);
        prompt += "\nWORLD: reference image "+refs.length+" is the film's real primary location"+
          (canon.world.name?(" (“"+canon.world.name+"”)"):"")+" — the poster's setting is THIS world: its "+
          "architecture, landscape, era and weather. Do not invent a different setting. ";
      }
      if(canon.prop){
        refs.push(canon.prop.url);
        prompt += "\nOBJECT: reference image "+refs.length+" is "+
          (canon.prop.name?("“"+canon.prop.name+"”, "):"")+"a signature object from the film — feature it "+
          "only if it serves the concept, faithful to the reference. ";
      }
      prompt += canon.style
        ? "\nMEDIUM: render in the film's own medium — "+canon.style.medium+" ("+canon.style.label+" style); "+
          "the references define the exact look of the people and places. "
        : "\nMEDIUM: photographic live-action one-sheet, shot like a $100M campaign. ";
      prompt += "\nCRAFT: one single striking image, not a collage of floating heads; layered depth "+
        "(foreground element, subject, atmospheric background); bold negative space held clear at the top "+
        "where a title would sit — but render absolutely NO text, NO title, NO lettering, NO logos. "+
        "Dramatic camera angle (low, high or telephoto compression), never a flat eye-level frontal lineup "+
        "of people looking into the camera. Vertical theatrical framing.";
      // Paint dashboard posters with GPT Image 2.5 Sunburst (server-side via the proxy) at
      // HIGH quality / 2K — key art is a hero surface, not a thumbnail (2026-10-11, owner — image engines:
      // it was GPT Image 2, removed). Fall back to the default model only if that id isn't available.
      const genOpts = { aspectRatio:"9:16", quality:"high", imageSize:"2K" };
      if(canon.identityCast && canon.identityCast.length){
        Object.assign(genOpts,{identityLive:false, identityCast:canon.identityCast,
          identityCharacterIds:canon.identityCast.map(c=>c.id), identityContext:canon.identityContext});
        if(typeof window.turnIdentityPrompt==="function") prompt += "\n"+window.turnIdentityPrompt(canon.identityCast);
      }
      if((window.NB_MODELS||[]).some(m=>m.id==="gpt-image-2.5-sunburst")) genOpts.model = "gpt-image-2.5-sunburst";
      if(refs.length) genOpts.extraImages = refs;
      let url = await window.nbGenerate(prompt, { ...genOpts, projectId:proj.id, assetId:"cover", assetPurpose:"poster" });
      if(!url) throw new Error("The poster came back empty — try again.");
      // keep enough pixels for the full-screen viewer (1080-wide, ~2x the card)
      if(typeof window.downscaleRef==="function"){ try{ url = await window.downscaleRef(url, 1080, 0.85); }catch(e){} }
      const saved=typeof window.cloudSaveCover==="function"
        ? await window.cloudSaveCover(proj.id,url,keepPrev) : null;
      if(!(saved&&saved.ok)){
        pendingSaves[proj.id]={url,keepPrev};
        throw new Error("The poster was generated but couldn't be saved. Try again to save this same image — no new poster is generated or charged.");
      }
      setProjects(ps=>ps.map(p=>p.id===proj.id?{ ...p, cover:url, ...(keepPrev!==undefined?{coverPrev:keepPrev}:{}) }:p));
      return url;
    })();
    inflight[proj.id] = run;
    try{ return await run; }
    finally{ delete inflight[proj.id]; }
  };
  /* Home card "Restore": swap the film's poster with its one-deep history. */
  const restorePoster = async (proj)=>{
    if(!proj || !proj.id || !proj.coverPrev || typeof window.cloudSwapCover!=="function") return;
    const r = await window.cloudSwapCover(proj.id);
    if(r) setProjects(ps=>ps.map(p=>p.id===proj.id?{ ...p, cover:r.cover, coverPrev:r.coverPrev }:p));
    else if(typeof window.appToast==="function") window.appToast("Couldn't restore the previous poster.","error");
  };
  /* SERIES: turn the CURRENT project into episode 1 of a new show — its
     departments become the show's shared bible. (Sheets generated before the
     conversion stay readable via the asset layer's episode-scope fallback.) */
  const makeShow = async (opts)=>{
    const automatic=!!(opts&&opts.automatic);
    if(!cloudMode || currentShowId || !currentProjectId || seriesBusyRef.current) return false;
    if(!automatic){
      const ok = await window.appConfirm({ title:"Turn this into a show?",
        body:"“"+(project.title||"Untitled")+"” becomes Episode 1. Its cast, locations, props and lookbook become one shared Show Bible; scenes, script and shots remain episode-specific.",
        confirmLabel:"Create show and Episode 1" });
      if(!ok) return false;
    }
    const ownerProjectId=currentProjectId;
    const busy="make-show:"+ownerProjectId;
    if(String(projIdRef.current||"")!==String(ownerProjectId)
      || showIdRef.current || seriesBusyRef.current) return false;
    seriesBusyRef.current=busy; setSeriesBusy(busy);
    try{
      /* Automatic conversion is launched from an effect before later effects in
         the same commit have necessarily installed their 700ms save snapshot.
         Yield one task, then flush both pending and already-running work before
         crossing the standalone → Episode 1/Show Bible storage boundary. */
      await new Promise(resolve=>setTimeout(resolve,0));
      if(!(await flushPendingProjectSave(ownerProjectId))
        || String(projIdRef.current||"")!==String(ownerProjectId)
        || showIdRef.current) return false;
      seriesBoundaryRef.current={projectId:ownerProjectId,generation:saveGenerationRef.current};
      const live=seriesSnapshotRef.current||{};
      const liveProject=live.project||project;
      const bibleBase=(window.turnSeries&&window.turnSeries.sharedBible)
        ? window.turnSeries.sharedBible({characters:live.characters||[],locations:live.locations||[],
            props:live.props||[],lookbook:live.lookbook||[],lookbookNote:live.lookbookNote||"",
            trash:live.trash||_emptyTrash()})
        : {characters:live.characters||[],locations:live.locations||[],props:live.props||[],
            lookbook:live.lookbook||[],lookbookNote:live.lookbookNote||"",
            trash:{characters:(live.trash&&live.trash.characters)||[],
              locations:(live.trash&&live.trash.locations)||[],props:(live.trash&&live.trash.props)||[]}};
      const bible=(window.turnSeries&&typeof window.turnSeries.prepareBibleForEpisode==="function")
        ? window.turnSeries.prepareBibleForEpisode(bibleBase,ownerProjectId) : bibleBase;
      /* A normal film explicitly converted into a Show becomes `series`, while a
         registered Show-capable format keeps its own canonical id (future limited,
         anthology, vertical-series formats must not be flattened to `series`). */
      const registeredFormat=(window.FORMATS||[]).find(f=>f&&f.id===String(liveProject&&liveProject.format))
        || ((typeof formatOf==="function")?formatOf(liveProject):null);
      const seriesFormatId=String((registeredFormat&&registeredFormat.needsShow&&registeredFormat.id)||"series");
      const episodeProject={...liveProject,format:seriesFormatId};
      const result=(typeof window.cloudConvertProjectToShow==="function")
        ? await window.cloudConvertProjectToShow(ownerProjectId,(liveProject.title||"Untitled")+" — Show",bible,episodeProject)
        : {ok:false,message:"Series support is not loaded."};
      if(!(result&&result.ok&&result.show)){
        if(typeof window.appToast==="function") window.appToast((result&&result.message)||"The show could not be created.","error");
        return false;
      }
      const show=result.show, showMeta={...show,project_kind:"show",show_id:null,episode_no:null,
        isShow:"true",showId:null,episodeNo:null,fmt:seriesFormatId};
      const episodeDoc=(result.episode&&result.episode.doc)||{};
      const episodeMeta={project_kind:"episode",show_id:show.id,episode_no:1,
        isShow:false,showId:show.id,episodeNo:"1",fmt:seriesFormatId,
        ...(episodeDoc.cover?{cover:episodeDoc.cover}:{}),...(episodeDoc.coverPrev?{coverPrev:episodeDoc.coverPrev}:{})};
      setProjects(ps=>{
        const withoutShow=ps.filter(p=>p.id!==show.id);
        return [showMeta,...withoutShow.map(p=>p.id===ownerProjectId?{...p,...episodeMeta}:p)];
      });
      const stillOpen=String(projIdRef.current||"")===String(ownerProjectId);
      if(stillOpen){
        const conversionGeneration=seriesBoundaryRef.current&&seriesBoundaryRef.current.generation;
        setProject(p=>({...p,format:seriesFormatId}));
        // Keep the per-episode reference index in working state immediately; a reload is
        // not required before the next Bible edit can preserve Episode 1's bindings.
        // If the user edited while the RPC was running, leave their newer live values
        // intact; the first series-aware autosave will prepare/persist those instead.
        if(conversionGeneration===saveGenerationRef.current){
          setCharacters(bible.characters); setLocations(bible.locations); setProps(bible.props);
        }
        setCurrentShowId(show.id); setCurrentEpisodeNo(1);
        bibleSavedRef.current=stableJson(bible);
        bibleRebaseRef.current=null;
        if(typeof nbUseShared==="function") nbUseShared(show.id,bibleEntityIds(bible));
      }

      let migration={ok:true,moved:0};
      if(typeof window.cloudPromoteProjectAssets==="function")
        migration=await window.cloudPromoteProjectAssets(ownerProjectId,show.id,bibleEntityIds(bible));
      const marker={from:ownerProjectId,status:(migration&&migration.ok)?"complete":"pending",
        at:new Date().toISOString(),moved:Number(migration&&migration.moved)||0,
        ...((migration&&migration.message)?{lastError:migration.message}:{})};
      if(typeof window.cloudSaveSections==="function") await window.cloudSaveSections(show.id,{assetMigration:marker});
      if(migration&&migration.ok){
        if(String(projIdRef.current||"")===String(ownerProjectId)){
          if(typeof nbUseShared==="function") nbUseShared(show.id,bibleEntityIds(bible));
          if(typeof window.nbPrefetchAll==="function") window.nbPrefetchAll();
        }
        if(typeof window.appToast==="function") window.appToast("Show created. This film is Episode 1 and its Bible is shared.","success");
      }else if(typeof window.appToast==="function"){
        window.appToast("Show created safely. Some existing sheets are still moving into the shared Bible and will retry next time it opens.","info");
      }
      return true;
    } finally {
      if(seriesBoundaryRef.current
        && String(seriesBoundaryRef.current.projectId||"")===String(ownerProjectId)) seriesBoundaryRef.current=null;
      seriesBusyRef.current=""; setSeriesBusy("");
      // A standalone save blocked by the boundary gets a fresh, series-aware
      // snapshot after failure or success; it must never retry its old payload.
      if(dirtyRef.current && String(projIdRef.current||"")===String(ownerProjectId))
        setRetryTick(t=>t+1);
    }
  };
  /* a new EPISODE of a show: an empty story that shares the show's bible */
  const createEpisode = async (showId)=>{
    if(!cloudMode || !showId || seriesBusyRef.current) return false;
    /* Capture the launch boundary BEFORE waiting on the old Episode's save. A
       collaborator can switch films while that flush is in flight; the eventual
       create may still commit, but it must never hijack the newer screen. */
    const launchProjectId=projIdRef.current;
    const launchLoadSeq=loadSeqRef.current;
    const launchHomeOpen=homeOpenRef.current;
    const ownerId=launchProjectId;
    if(ownerId && !(await flushPendingProjectSave(ownerId))) return false;
    if(seriesBusyRef.current) return false;
    /* Creating the row may outlive the screen that launched it. Keep the durable
       result in the project list, but never let a late RPC response pull somebody
       back from Home or a film they deliberately opened meanwhile. */
    const busy="new-episode:"+showId;
    seriesBusyRef.current=busy; setSeriesBusy(busy);
    try{
      const priorIntent=episodeCreateRetryRef.current;
      const requestId=priorIntent&&String(priorIntent.showId)===String(showId)
        ? priorIntent.requestId : "";
      if(priorIntent && String(priorIntent.showId)!==String(showId))
        episodeCreateRetryRef.current=null;
      const result=(typeof window.cloudCreateShowEpisode==="function")
        ? await window.cloudCreateShowEpisode(showId,emptyDoc(),requestId?{requestId}:undefined)
        : {ok:false,message:"Series support is not loaded."};
      if(!(result&&result.ok&&result.episode)){
        episodeCreateRetryRef.current=(result&&result.retrySafe&&result.requestId)
          ? {showId:String(showId),requestId:result.requestId} : null;
        if(typeof window.appToast==="function") window.appToast((result&&result.message)||"The episode could not be created.","error");
        return false;
      }
      episodeCreateRetryRef.current=null;
      const no=Number(result.episodeNo)||Number(result.episode.doc&&result.episode.doc.episodeNo)||1;
      const created={...result.episode,showId,episodeNo:String(no),fmt:String((result.episode.doc&&result.episode.doc.project&&result.episode.doc.project.format)||"series")};
      setProjects(ps=>[created,...ps.filter(p=>p.id!==created.id)]);
      const launchScopeStillOpen=String(projIdRef.current||"")===String(launchProjectId||"")
        && loadSeqRef.current===launchLoadSeq
        && homeOpenRef.current===launchHomeOpen;
      if(!launchScopeStillOpen){
        if(typeof window.appToast==="function") window.appToast(
          "Episode "+String(no).padStart(2,"0")+" was created and added to the Show. Your current screen was left unchanged.","success");
        return true;
      }
      const opened=await loadProjectIntoState(created.id);
      if(typeof window.appToast==="function") window.appToast(opened
        ? "Episode "+String(no).padStart(2,"0")+" created from the shared Show Bible."
        : "Episode "+String(no).padStart(2,"0")+" was created and added to the Show, but couldn't be opened yet. Select it from Films & TV Shows to retry.",
        opened?"success":"info");
      /* Creation committed even when its first read failed. Returning false made
         the switcher invite a second click, which minted the next E-number. */
      return true;
    } finally {
      seriesBusyRef.current=""; setSeriesBusy("");
    }
  };
  const renameProject = async (id, title)=>{
    if(seriesBusyRef.current) return false;
    const busy="rename:"+id;
    seriesBusyRef.current=busy; setSeriesBusy(busy);
    try{
      const r=await cloudRenameProject(id,title);
      if(!(r&&r.ok)){
        if(typeof window.appToast==="function") window.appToast((r&&r.message)||"The project could not be renamed.","error");
        return false;
      }
      setProjects(ps=>ps.map(p=>p.id===id?{...p,title:r.title||title}:p));
      return true;
    } finally { seriesBusyRef.current=""; setSeriesBusy(""); }
  };
  const _invalidateDeletedProjectScope=()=>{
    ++loadSeqRef.current;
    ++saveGenerationRef.current;
    pendingSaveRef.current=null;
    dirtyRef.current=false;
    clearTimeout(saveTimer.current);
    hydratingRef.current=true;
    projectLoadingRef.current=true;
    setProjectLoading(true);
    projIdRef.current=null; showIdRef.current=null;
    setCurrentProjectId(null); setCurrentShowId(null); setCurrentEpisodeNo(null);
    bibleSavedRef.current=null; bibleRebaseRef.current=null;
    if(typeof nbUseShared==="function") nbUseShared(null);
  };
  const _openAfterCommittedDeletion=async (remaining, preferred, label)=>{
    const ordered=[];
    [...(preferred||[]),...(remaining||[])].forEach(row=>{
      if(row&&!isShowProject(row)&&!ordered.some(x=>x.id===row.id)) ordered.push(row);
    });
    // open a real film next; a blank canvas only when none is left — and reuse one that
    // already exists before creating another (they are never listed, so they'd pile up)
    const _blank=(r)=> typeof window.turnFilmIsBlank==="function" && window.turnFilmIsBlank(r);
    ordered.sort((a,b)=> (_blank(a)?1:0)-(_blank(b)?1:0));
    for(const row of ordered){
      if(await loadProjectIntoState(row.id,{discardPending:true})) return true;
    }
    const created=await cloudCreateProject("Untitled film",emptyDoc());
    if(created){
      setProjects(ps=>[created,...ps.filter(p=>p.id!==created.id)]);
      if(await loadProjectIntoState(created.id,{discardPending:true})) return true;
    }
    /* The delete is already durable. Leave no deleted Episode id behind for a
       later autosave to resurrect inside the Show Bible; make the stale surface
       inert and recover from authoritative cloud state. */
    hydratingRef.current=true; projectLoadingRef.current=true; setProjectLoading(true);
    if(typeof window.appToast==="function") window.appToast(
      (label||"The project")+" was deleted safely, but the next project didn't load. Refreshing from cloud state…","info");
    setTimeout(()=>{ try{ window.location.reload(); }catch(e){} },500);
    return false;
  };
  const deleteShow = async (showId, episodeIds)=>{
    if(!showId || seriesBusyRef.current) return false;
    const episodes=(projects||[]).filter(p=>String(p.showId||"")===String(showId));
    const ids=Array.isArray(episodeIds)&&episodeIds.length?episodeIds:episodes.map(p=>p.id);
    const show=(projects||[]).find(p=>p.id===showId);
    const ok=await window.appConfirm({title:"Delete this entire show?",
      body:"“"+((show&&show.title)||"This show")+"”, every Episode belonging to it (including one created in another tab), its shared Bible and shared reference assets will be permanently deleted. This can’t be undone.",
      confirmLabel:"Delete show and all episodes",danger:true});
    if(!ok) return false;
    const busy="delete-show:"+showId;
    seriesBusyRef.current=busy; setSeriesBusy(busy);
    try{
      const r=(typeof window.cloudDeleteShow==="function")?await window.cloudDeleteShow(showId):{ok:false,message:"Series support is not loaded."};
      if(!(r&&r.ok)){
        if(typeof window.appToast==="function") window.appToast((r&&r.message)||"The show could not be deleted.","error");
        return false;
      }
      _seriesOutboxRows(null,showId).forEach(row=>_seriesOutboxClear(row.key));
      /* The RPC deletes the whole family, including an Episode created in another
         tab after this switcher's list was rendered. Filter by relationship, not
         only by the stale ids supplied by the confirmation surface. */
      const remaining=(projectsRef.current||projects).filter(p=>p.id!==showId
        && String(p.showId||"")!==String(showId));
      setProjects(remaining);
      let replacementReady=true;
      if(currentShowId===showId || currentProjectId===showId || ids.includes(currentProjectId)){
        _invalidateDeletedProjectScope();
        const openable=remaining.filter(p=>!isShowProject(p));
        replacementReady=await _openAfterCommittedDeletion(remaining,openable,"The Show");
      }
      if(replacementReady && typeof window.appToast==="function") window.appToast(
        r.cleanupWarning ? ("Show deleted. "+r.cleanupWarning) : "Show deleted.",
        r.cleanupWarning ? "info" : "success");
      return true;
    } finally { seriesBusyRef.current=""; setSeriesBusy(""); }
  };
  const deleteProject = async (id)=>{
    if(seriesBusyRef.current) return false;
    const target=(projectsRef.current||projects).find(p=>p.id===id);
    let deleteAsEpisode=false;
    if(target&&target.showId){
      const allRows=projectsRef.current||projects;
      const showExists=allRows.some(p=>String(p.id)===String(target.showId)&&isShowProject(p));
      deleteAsEpisode=showExists;
    }
    const busy="delete:"+id;
    seriesBusyRef.current=busy; setSeriesBusy(busy);
    try{
      let r=deleteAsEpisode
        ? (typeof window.cloudDeleteShowEpisode==="function"
            ? await window.cloudDeleteShowEpisode(id)
            : {ok:false,message:"Series support is not loaded. No Episode was deleted."})
        : await cloudDeleteProject(id);
      if(deleteAsEpisode && r&&r.finalEpisode){
        /* Never infer "final Episode" from the switcher's cached rows. Ask the
           server first, then refresh the family before offering the broader Show
           deletion. If another tab created a sibling meanwhile, retry the exact
           Episode operation instead of deleting that new work. */
        const fresh=(typeof window.cloudListProjects==="function")?await window.cloudListProjects():null;
        if(!fresh){
          if(typeof window.appToast==="function") window.appToast(
            "We couldn't refresh the Show before deciding whether this is its final Episode. Nothing was deleted; try again.","error");
          return false;
        }
        setProjects(fresh);
        const liveTarget=fresh.find(p=>String(p.id)===String(id));
        const liveSiblings=fresh.filter(p=>String(p.showId||"")===String(target.showId));
        if(liveTarget && liveSiblings.length>1){
          r=await window.cloudDeleteShowEpisode(id);
        }else{
          const liveShow=fresh.find(p=>String(p.id)===String(target.showId)&&isShowProject(p));
          if(!liveTarget||!liveShow){
            if(typeof window.appToast==="function") window.appToast(
              "We couldn't verify the final Episode and its Show. Nothing was deleted; refresh Films & TV Shows and try again.","error");
            return false;
          }
          seriesBusyRef.current=""; setSeriesBusy("");
          return await deleteShow(target.showId,liveSiblings.map(p=>p.id));
        }
      }
      if(!(r&&r.ok)){
        if(typeof window.appToast==="function") window.appToast((r&&r.message)||"The project could not be deleted.","error");
        return false;
      }
      const all=projectsRef.current||projects;
      if(deleteAsEpisode&&target&&target.showId)
        _seriesOutboxRows(id,target.showId).forEach(row=>_seriesOutboxClear(row.key));
      const remaining=all.filter(p=>p.id!==id);
      setProjects(remaining);
      if(id===currentProjectId){
        const siblings=(target&&target.showId)?remaining.filter(p=>String(p.showId||"")===String(target.showId)):[];
        const openable=siblings.concat(remaining.filter(p=>!isShowProject(p)&&siblings.indexOf(p)<0));
        _invalidateDeletedProjectScope();
        await _openAfterCommittedDeletion(remaining,openable,deleteAsEpisode?"The Episode":"The film");
      }
      if(r.cleanupWarning && typeof window.appToast==="function")
        window.appToast("Episode deleted. "+r.cleanupWarning,"info");
      return true;
    } finally { seriesBusyRef.current=""; setSeriesBusy(""); }
  };

  /* Series is not merely a badge: once its first story exists, establish the
     Show container and Episode 1 automatically. This does not insert or reorder
     any story-building step; it makes the selected format's storage model true.
     It WAITS while the New Story build (the Adaptation agent) is still writing: converting
     mid-run swapped the cast for the Show Bible under the running agent (2026-09-26). */
  const [agentRunTick, setAgentRunTick] = React.useState(0);
  React.useEffect(()=>{
    const h = ()=> setAgentRunTick(t=>t+1);
    window.addEventListener("turn-agent-running", h);
    return ()=> window.removeEventListener("turn-agent-running", h);
  },[]);
  React.useEffect(()=>{
    const fmt=(typeof formatOf==="function")?formatOf(project):null;
    const row=(projects||[]).find(p=>p.id===currentProjectId);
    const eligible=!!(cloudMode&&currentProjectId&&!currentShowId&&scenes.length
      &&fmt&&fmt.needsShow&&row&&!row.isShared);
    if(!eligible){
      // Leaving Series eligibility (format changed, story cleared, or conversion
      // succeeded) deliberately re-arms a later explicit eligibility transition.
      if(currentProjectId&&(!scenes.length||currentShowId||(fmt&&!fmt.needsShow)))
        delete autoSeriesAttemptRef.current[String(currentProjectId)];
      return;
    }
    if(seriesBusyRef.current) return;
    if(((window.__turnAgentRunCount||{}).adapt||0)>0) return;   // re-checked when the build ends (agentRunTick)
    const attemptKey=String(project&&project.format||fmt.id)+":"+String(scenes.length);
    const projectKey=String(currentProjectId);
    // seriesBusy flips during every attempt. Without this eligibility fence, a
    // missing migration or offline response cleared busy and immediately launched
    // the same automatic conversion again forever. A materially new story shape
    // (format/scene-count transition) may try once more; manual conversion remains
    // freely retryable from the switcher.
    if(autoSeriesAttemptRef.current[projectKey]===attemptKey) return;
    autoSeriesAttemptRef.current[projectKey]=attemptKey;
    makeShow({automatic:true});
  },[cloudMode,currentProjectId,currentShowId,scenes.length,project&&project.format,projects.length,seriesBusy,agentRunTick]);
  const [agentLaunch, setAgentLaunch] = React.useState(null);   // {id, input} to auto-run an agent
  /* Existing-film identity resolution can hand the user to the Production check: its
     script read proposes pronouns from exact screenplay evidence, and its script pass
     rewrites they/them lines to the profile's pronouns. The Character panel and the Art
     Room share this event so neither has to reach into the other room's React state.
     It opens READY (never auto-runs), like every Art Room agent. */
  React.useEffect(()=>{
    const openProduction=()=>{
      if(productionCheckBlocked) return;
      setProductionOpen(true);
    };
    window.turnOpenProductionCheck=openProduction;
    window.addEventListener("turn-open-production-check",openProduction);
    return ()=>{
      window.removeEventListener("turn-open-production-check",openProduction);
      if(window.turnOpenProductionCheck===openProduction) delete window.turnOpenProductionCheck;
    };
  },[productionCheckBlocked]);

  // persist navigation (room/view/artView + each film's Art Room tab) to the device-local key on every change.
  // Each film's tab is MERGED with what NAV_KEY holds now, so a second open window never erases the
  // tabs this one doesn't know about (newer stamp wins per film — see turnNavMergeArtViews).
  React.useEffect(()=>{
    try{
      const merged = turnNavMergeArtViews(turnNavArtViewMap(loadNav().artViewByProject), artViewByProject);
      localStorage.setItem(NAV_KEY, JSON.stringify({ room, view, artView, selId, artViewByProject:merged }));
    }catch(e){}
  },[room, view, artView, selId, artViewByProject]);

  // MULTI-WINDOW CONFLICT: the save fence (cloud.jsx) refused to overwrite a
  // newer revision written by another window. Neither version may be discarded
  // implicitly: keep this window's edit visible/unsaved, then require an explicit
  // confirmation before replacing it with server truth.
  /* last shared-bible payload this window wrote to the SHOW row. Every episode save used
     to blind-overwrite that row, so two windows on two DIFFERENT episodes of one show each
     clobbered the other's show write, conflict-looped, and the recovery reload discarded
     whatever the user had typed since. Skipping an unchanged bible write breaks the loop. */
  /* COLLABORATION — per-section saves. `lastSentRef` holds a JSON snapshot of every
     top-level doc section as this window last successfully wrote (or adopted) it, so each
     save can send ONLY what actually changed here. Two collaborators editing different
     parts of a film then never overwrite each other; before this, every save was a
     full-doc overwrite and whoever saved second had their work discarded by the conflict
     reload. Per-user VIEW state (room/view/artView) is deliberately excluded — it isn't
     shared, and writing it would make one person's navigation churn everyone's saves. */
  const roleNoticeRef = React.useRef(0);   // throttle the "your role doesn't cover that" notice
  const bibleSavedRef = React.useRef(null);
  // When save N finishes after save N+1 has already been captured, N's merged
  // Bible is the new server ancestor but cannot be adopted into live React state.
  // Carry that exact truth + N's local checkpoint into the serialized successor,
  // which rebases before it writes. This prevents an omitted collaborator entity
  // from being mistaken for a deletion by the queued snapshot.
  const bibleRebaseRef = React.useRef(null);
  const _conflictBusy = React.useRef(false);
  const roleScopeBusyRef = React.useRef(0);
  /* SERVER ROLE-SCOPE REJECTION — the database itself now enforces the section
     limits (enforce-role-scopes.sql): a save touching sections outside this
     collaborator's role comes back tagged roleScope. That verdict is PERMANENT
     for the payload — retry-with-backoff would loop forever on the same
     rejection. Normally unreachable (the autosave already drops out-of-scope
     sections client-side); it fires when the owner changed or revoked the role
     mid-session, or a modified client tried to sneak sections past the UI.
     Surface the server's real reason once, then reload the film so local state
     re-syncs to what the server actually holds (same recovery as a conflict). */
  const _docRoleScope = (r)=>{
    const now = Date.now();
    if(now - (roleScopeBusyRef.current||0) < 5000) return;
    roleScopeBusyRef.current = now;
    setSaveState("saving");   // honest while we re-sync; resolved below by the reload result
    if(typeof window.appToast==="function")
      window.appToast((r&&r.localDenied ? "This local change is outside your role \u2014 " : "The server declined this save \u2014 ")
        + ((r && r.message) || "your role does not cover those sections.")
        + " Your access may have changed; reloading the film.","error");
    // the refusal usually means the ROLE changed (2026-10-03): re-read it too, or every later edit
    // is refused again under the old one
    if(typeof window.cloudListProjects==="function")
      Promise.resolve(window.cloudListProjects()).then(list=>{ if(list) setProjects(list); }).catch(()=>{});
    Promise.resolve(loadProjectIntoState(currentProjectId)).then((loaded)=>{
      saveFailsRef.current = 0;   // permanent rejection — never feed the retry loop
      if(loaded){ dirtyRef.current = false; setSaveState("saved"); }   // now genuinely in sync
      else setSaveState("failed");   // reload failed (access revoked?) — do NOT claim sync
    }).catch(()=>setSaveState("failed"));
  };
  const _docConflictCheck = (r)=>{
    if(r && r.roleScope){ _docRoleScope(r); return; }
    if(!r || !r.conflict) return;
    /* 2026-09-27 (Pine Soot): mark Not saved BEFORE the one-dialog guard. performSave
       already showed "saving"; a repeat conflict while the dialog was open used to
       return here first and leave the chip on SAVING under the dialog. Stale
       generations never reach this point (_docSaveResult filters them). */
    dirtyRef.current = true;
    setSaveState("failed");
    if(_conflictBusy.current) return;
    _conflictBusy.current = true;
    const conflictedProjectId=currentProjectId;
    const conflictedShowId=showIdRef.current;
    /* Say what actually conflicted. A merge conflict carries its reason and the
       overlapping keys; only the bare lost-fence result (4 tries, no detail) is
       reported as "Another window saved this film first". The merges report
       internal keys ("project.controllingIdea", Show Bible "c1.name",
       "c2 (delete conflicted)", "trash.characters.c3"); writers see the setting
       or the entity's name instead, and the raw keys go to the console. */
    const conflictKeys=(Array.isArray(r.conflicts)?r.conflicts:[]).map(String).filter(Boolean);
    if(conflictKeys.length){ try{ console.info("[TURN] save conflict:",conflictKeys.join(", ")); }catch(e){} }
    const _words=s=>{
      const t=String(s||"").replace(/([a-z0-9])([A-Z])/g,"$1 $2").replace(/[_-]+/g," ").trim().toLowerCase();
      return t?t.charAt(0).toUpperCase()+t.slice(1):"";
    };
    const _fieldNames={controllingIdea:"Controlling idea",contract:"Story contract",centerOfGood:"Center of good",
      styleBible:"Style bible",continuityFacts:"Continuity facts",continuityLedger:"Continuity ledger",
      beatsMap:"Beats",drafts:"Script drafts",continuityMap:"Continuity map",sluglineUnits:"Slugline units",
      lookbookApplied:"Applied lookbook",framework:"Structure",trash:"Recently deleted"};
    const _field=k=>_fieldNames[k]||_words(k);
    const _entityName=id=>{
      const bin=(trashRef&&trashRef.current)||{};
      const pools=[["character",characters],["location",locations],["prop",props],
        ["character",bin.characters],["location",bin.locations],["prop",bin.props]];
      for(const [kind,list] of pools){
        const hit=(Array.isArray(list)?list:[]).find(x=>x&&x.id!=null&&String(x.id)===String(id));
        if(hit) return String(hit.name||hit.title||hit.label||_words(kind))+" ("+kind+")";
      }
      return null;
    };
    const _why={"delete conflicted":"deleted here but changed elsewhere","deleted remotely":"deleted elsewhere but changed here",
      "missing merge baseline":"no reliable saved copy to compare"};
    const conflictLabel=raw=>{
      const key=String(raw); let m;
      if((m=/^project\.(.+)$/.exec(key))) return "Project settings: "+_field(m[1]);
      if(/^project \(/.test(key)) return "Project settings (no reliable saved copy to compare)";
      if(key==="invalid department shape") return "A Show Bible department (no reliable saved copy to compare)";
      if((m=/^trash\.(characters|locations|props)\.(.+)$/.exec(key))) return "Recently deleted: "+conflictLabel(m[2]);
      if((m=/^(.+?) \((delete conflicted|deleted remotely|missing merge baseline)\)$/.exec(key))){
        const who=_entityName(m[1]);
        return (who||_words(m[1]))+": "+_why[m[2]];
      }
      if((m=/^(.+?) \((invalid[^)]*)\)$/.exec(key))) return _field(m[1])+" (no reliable saved copy to compare)";
      if((m=/^([^.\s]+)\.(.+)$/.exec(key))){
        const who=_entityName(m[1]);
        if(who){
          const f=m[2];
          const what=/^episodeScenes\./.test(f)?"scene links in this Episode"
            :/^episodeLocationMeta\./.test(f)?"location details in this Episode":_field(f).toLowerCase();
          return who+": "+what;
        }
      }
      if(/^[A-Za-z]+$/.test(key)) return _field(key);   // a whole section or Bible department
      return key;
    };
    const conflictItems=conflictKeys.slice(0,8).map(conflictLabel);
    if(conflictKeys.length>conflictItems.length)
      conflictItems.push("\u2026and "+(conflictKeys.length-conflictItems.length)+" more");
    const conflictLead=(r.message||conflictKeys.length)
      ? String(r.message||"These settings changed in another window.")
      : "Another window saved this film first.";
    const conflictBody=conflictLead+" Your local edit is still visible and has NOT been saved. Load the cloud version now? This will replace the unsaved edit in this window.";
    const decide=(typeof window.appConfirm==="function")
      ? window.appConfirm({
          title:"Cloud version changed",
          body:conflictBody,
          items:conflictItems.length?conflictItems:undefined,
          note:"Choose Keep my edits to leave this window untouched while you copy or review the local work.",
          confirmLabel:"Load cloud version",cancelLabel:"Keep my edits",danger:true,
          /* Autosave opens this unprompted, often mid-typing: focus Keep my edits
             and never map a stray Enter/Space to the destructive choice. */
          safeDefault:true
        })
      : Promise.resolve(false);
    Promise.resolve(decide).then(async replaceLocal=>{
      if(String(projIdRef.current||"")!==String(conflictedProjectId||"")) return;
      if(!replaceLocal){
        if(typeof window.appToast==="function")
          window.appToast("Your local edit is still on screen and marked Not saved. No cloud data was replaced.","error");
        return;
      }
      // The user explicitly chose server truth. Retire a paired-save recovery
      // journal too; replaying it during this load would silently reapply the
      // very local patch they just chose to replace.
      _seriesOutboxRows(conflictedProjectId,conflictedShowId)
        .forEach(row=>_seriesOutboxClear(row.key));
      bibleRebaseRef.current=null;
      setSaveState("saving");
      const loaded=await loadProjectIntoState(conflictedProjectId,{discardPending:true});
      if(loaded){
        saveFailsRef.current=0;
        dirtyRef.current=false;
        setSaveState("saved");
      }else{
        dirtyRef.current=true;
        setSaveState("failed");
        if(typeof window.appToast==="function")
          window.appToast("The cloud version could not be loaded. Your local edit remains on screen and is still not saved.","error");
      }
    }).catch(()=>{
      dirtyRef.current=true;
      setSaveState("failed");
    }).finally(()=>{ setTimeout(()=>{ _conflictBusy.current=false; },1500); });
  };
  // persist the editable story so a browser refresh / reopen keeps the user's work
  const projectsRef = React.useRef(projects); projectsRef.current = projects;   // latest rows, for save-time meta
  /* SAVE HEALTH. A cloudSaveDoc failure that is NOT a conflict (network blip, expired
     token, RLS hiccup) used to be dropped on the floor: no retry, no indicator. If no
     further edit happened to re-trigger the debounce, that work simply never landed and
     the account chip still said "Synced". Now: unsaved edits are tracked, non-conflict
     failures retry with backoff, and the chip reports the truth. */
  const [saveState, setSaveState] = React.useState("saved");   // saved | saving | retrying | failed
  const [retryTick, setRetryTick] = React.useState(0);
  const saveFailsRef = React.useRef(0);
  /* adopt the sections OTHER people changed. Only ever applied to sections THIS window
     did not touch in the same save, so it can never stomp on what the user is typing;
     lastSentRef is updated in step so the adoption doesn't look like a local edit and
     bounce straight back out as another write. */
  const _adoptTheirs = (cloudDoc, mineKeys, mergedProject, mergedShots)=>{
    let adopted = 0;
    // `shots` is merged shot by shot on save (2026-10-09): what came back may hold another person's shot changes
    if(mineKeys.indexOf("shots")>=0 && Array.isArray(mergedShots)){
      const merged = stableJson(mergedShots);
      if(merged !== lastSentRef.current.shots){
        lastSentRef.current.shots = merged;
        try{ setShots(mergedShots); adopted++; }catch(e){}
      }
    }
    /* `project` is three-way merged on the server, so a save that sent it can
       come back holding keys ANOTHER window changed (e.g. setting.location).
       The loop below skips sections this window wrote, and _docRevSeen already
       jumped to the merged revision, so without this the other window's value
       stayed invisible here until some third write. Callers invoke this only for
       the newest save generation, so the merged value can't stomp a newer edit. */
    if(mineKeys.indexOf("project")>=0 && mergedProject && typeof mergedProject==="object" && !Array.isArray(mergedProject)){
      const merged = stableJson(mergedProject);
      if(merged !== lastSentRef.current.project){
        lastSentRef.current.project = merged;
        try{ setProject(mergedProject); adopted++; }catch(e){}
      }
    }
    if(!cloudDoc){
      if(adopted && typeof window.appToast==="function")
        window.appToast("Picked up changes a collaborator just made.","info");
      return;
    }
    const setters = { scenes:setScenes, characters:setCharacters, props:setProps, locations:setLocations,
      sluglineUnits:setSlugUnitsOv,
      lookbook:setLookbook, lookbookNote:setLookbookNote, lookbookApplied:setLookbookApplied, shots:setShots,
      project:setProject, drafts:setDrafts, beatsMap:setBeatsMap, history:setHistory,
      continuityMap:setContinuityMap, trash:setTrash };
    Object.keys(setters).forEach(k=>{
      if(mineKeys.indexOf(k)>=0) return;                    // this window just wrote it
      if(cloudDoc[k]===undefined) return;
      const theirs = stableJson(cloudDoc[k]);
      if(theirs === lastSentRef.current[k]) return;          // unchanged since we last saw it
      lastSentRef.current[k] = theirs;
      try{ setters[k](cloudDoc[k]); adopted++; }catch(e){}
    });
    if(adopted && typeof window.appToast==="function")
      window.appToast("Picked up changes a collaborator just made.","info");
  };
  const _adoptBibleTheirs = (cloudBible, mineKeys)=>{
    if(!cloudBible) return;
    const setters={characters:setCharacters,locations:setLocations,props:setProps,
      lookbook:setLookbook,lookbookNote:setLookbookNote,trash:setTrash};
    let adopted=0;
    Object.keys(setters).forEach(k=>{
      if(mineKeys.indexOf(k)>=0 || cloudBible[k]===undefined) return;
      /* The React API intentionally exposes one restore bin. For a Show, merge
         the incoming shared tombstones with this Episode's shot tombstones at
         the adoption boundary; never let a Bible push erase local shot recovery. */
      const value=k==="trash"
        ? ((window.turnSeries&&typeof window.turnSeries.combineTrash==="function")
            ? window.turnSeries.combineTrash(cloudBible.trash,trashRef.current)
            : {...(cloudBible.trash||{}),shots:(trashRef.current&&trashRef.current.shots)||[]})
        : cloudBible[k];
      const theirs=stableJson(value);
      if(theirs===lastSentRef.current[k]) return;
      lastSentRef.current[k]=theirs;
      try{ setters[k](value); adopted++; }catch(e){}
    });
    if(adopted && typeof window.appToast==="function")
      window.appToast("Picked up Show Bible changes from another episode.","info");
  };
  /* A Show Bible has its own revision/channel: collaborators may be editing shared
     canon while working in different episodes. Subscribe to that row separately and
     materialize only this episode's scene slices when a newer Bible arrives. */
  React.useEffect(()=>{
    if(!cloudMode||!currentShowId||!currentProjectId||typeof window.cloudDocRev!=="function") return;
    let alive=true,busy=false,pushTimer=null;
    const unsubscribe=(typeof window.cloudSubscribeDoc==="function")
      ? window.cloudSubscribeDoc(currentShowId) : ()=>{};
    const refresh=async()=>{
      if(!alive||busy||dirtyRef.current||hydratingRef.current) return;
      busy=true;
      try{
        const rev=await window.cloudDocRev(currentShowId);
        const seen=(typeof window.cloudSeenRev==="function")?window.cloudSeenRev(currentShowId):0;
        if(alive&&rev!=null&&rev>seen){
          const row=await cloudLoadProject(currentShowId);
          const doc=row&&row.doc;
          if(alive&&doc&&(window.turnSeries&&window.turnSeries.isShowDoc(doc))
            &&!dirtyRef.current&&!hydratingRef.current){
            const raw=(window.turnSeries&&window.turnSeries.sharedBible)
              ? window.turnSeries.sharedBible(doc.bible||{}) : (doc.bible||{});
            const scoped=(window.turnSeries&&window.turnSeries.bibleForEpisode)
              ? window.turnSeries.bibleForEpisode(raw,currentProjectId,doc.sourceEpisodeId,currentEpisodeNo) : raw;
            if(typeof window.cloudNoteDocRev==="function") window.cloudNoteDocRev(currentShowId,doc);
            _adoptBibleTheirs(scoped,[]);
            bibleSavedRef.current=stableJson(raw);
            if(typeof nbUseShared==="function") nbUseShared(currentShowId,bibleEntityIds(raw));
            if(typeof window.nbPrefetchAll==="function") window.nbPrefetchAll();
          }
        }
      }catch(e){}
      busy=false;
    };
    const onPush=e=>{
      if(!e||!e.detail||String(e.detail.projectId)!==String(currentShowId)) return;
      clearTimeout(pushTimer); pushTimer=setTimeout(refresh,250);
    };
    const onShowMemberRemoved=e=>{
      if(!e||!e.detail||String(e.detail.projectId)!==String(currentShowId)) return;
      // The existing episode access guard owns the user-facing recovery flow.
      // Bridge this Show-level hint onto the open episode, where that guard will
      // re-check RLS before doing anything (a broadcast alone is never trusted).
      try{ window.dispatchEvent(new CustomEvent("turn-member-removed",{
        detail:{projectId:currentProjectId,showId:currentShowId}
      })); }catch(err){}
    };
    window.addEventListener("turn-doc-push",onPush);
    window.addEventListener("turn-member-removed",onShowMemberRemoved);
    const poll=setInterval(refresh,12000);
    return ()=>{ alive=false; clearTimeout(pushTimer); clearInterval(poll);
      window.removeEventListener("turn-doc-push",onPush);
      window.removeEventListener("turn-member-removed",onShowMemberRemoved);
      try{ unsubscribe(); }catch(e){} };
  },[cloudMode,currentShowId,currentProjectId,currentEpisodeNo]);
  const _saveScopeActive = (ctx)=> String(projIdRef.current||"")===String((ctx&&ctx.projectId)||"")
    && String(showIdRef.current||"")===String((ctx&&ctx.showId)||"");
  const _saveGenerationLatest = (ctx)=> !!ctx && ctx.generation===saveGenerationRef.current;
  const _docSaveResult = (r, ctx)=>{
    // A response belongs only to the project/storage scope and snapshot that sent
    // it. Older completions may have reached durable storage, but they may never
    // clear a newer dirty flag, reload another film, or change its save indicator.
    if(!_saveScopeActive(ctx) || !_saveGenerationLatest(ctx)) return !!(r&&r.ok);
    _docConflictCheck(r);
    if(r && r.conflict) return false;        // explicit conflict dialog owns reconciliation
    if(r && r.roleScope) return false;       // _docRoleScope owns recovery
    if(r && r.ok){ saveFailsRef.current = 0; dirtyRef.current = false; setSaveState("saved"); return true; }
    const n = ++saveFailsRef.current;
    if(n <= 3){ setSaveState("retrying"); setTimeout(()=>setRetryTick(t=>t+1), n*2500); }
    else{
      setSaveState("failed");
      // A save the server declined with no newer version (RLS / trigger) is not a
      // conflict; once the retries are spent, say why instead of a silent Not saved.
      if(n===4 && r && r.rejected && typeof window.appToast==="function")
        window.appToast(String(r.message||"The server did not accept this save."),"error");
    }
    return false;
  };
  React.useEffect(()=>{
    const generation=++saveGenerationRef.current;
    const ctx={projectId:currentProjectId,showId:currentShowId,generation};
    // Never reinterpret a hydration render as a successful save. It invalidates
    // older completions, keeps a real dirty flag intact, and hydrationTick below
    // installs a fresh snapshot once the loaded document has settled.
    if(hydratingRef.current){ pendingSaveRef.current=null; return; }
    dirtyRef.current = true;
    const doc = { scenes, characters, props, locations, sluglineUnits: slugUnitsOv, lookbook, lookbookNote, lookbookApplied, shots, project, drafts, beatsMap, history, continuityMap, selId, room, view, artView, propsSeeded, locsSeeded, visualsSeeded, trash };
    let launched=null;
    let timerId=null;
    const performSave=async()=>{
      // A deleted/superseded project intentionally abandons this snapshot. Its
      // completion must not touch the new project's baselines or React state.
      if(!_saveScopeActive(ctx)) return true;
      // Let an in-progress hydration settle, but never write a partial document.
      for(let wait=0; hydratingRef.current && _saveScopeActive(ctx) && wait<24; wait++)
        await new Promise(resolve=>setTimeout(resolve,50));
      if(!_saveScopeActive(ctx)) return true;
      if(hydratingRef.current) return false;
      // Conversion has crossed (or is about to cross) the server's standalone →
      // episode/Bible boundary. A closure captured before it must wait for the
      // series-aware render instead of writing shared departments back to Episode 1.
      const boundary=seriesBoundaryRef.current;
      if(boundary && String(boundary.projectId||"")===String(ctx.projectId||"") && !ctx.showId) return false;
      if(!cloudMode){
        try{
          localStorage.setItem(STORY_KEY,JSON.stringify(doc));
          return _docSaveResult({ok:true},ctx);
        }catch(e){ return _docSaveResult({ok:false,message:(e&&e.message)||"Local save failed."},ctx); }
      }
      if(typeof cloudSaveSections!=="function") return _docSaveResult({ok:false,message:"Cloud saving is unavailable."},ctx);
      let _seriesRebasedBible=null,_seriesServerBible=null,_consumedBibleRebase=null;
      if(ctx.showId){
        const storedBibleSnapshot=()=>{
          if(_seriesRebasedBible) return _seriesRebasedBible;
          const currentBible={characters:doc.characters,locations:doc.locations,
            props:doc.props,lookbook:doc.lookbook,lookbookNote:doc.lookbookNote,
            trash:(window.turnSeries&&typeof window.turnSeries.sharedTrash==="function")
              ? window.turnSeries.sharedTrash(doc.trash) : {characters:(doc.trash&&doc.trash.characters)||[],locations:(doc.trash&&doc.trash.locations)||[],props:(doc.trash&&doc.trash.props)||[]}};
          return (window.turnSeries&&typeof window.turnSeries.prepareBibleForEpisode==="function")
            ? window.turnSeries.prepareBibleForEpisode(currentBible,ctx.projectId) : currentBible;
        };
        const applyBibleRebase=(latest,checkpoint,message)=>{
          const rebased=(typeof window.seriesRebaseBibleAfterReplay==="function")
            ? window.seriesRebaseBibleAfterReplay(latest,storedBibleSnapshot(),checkpoint,ctx.projectId)
            : {ok:false,conflicts:["recovery rebase unavailable"]};
          if(!rebased.ok) return _docSaveResult({ok:false,conflict:true,conflicts:rebased.conflicts,
            message:message||"The Show Bible changed while a save was being reconciled. Reload before resolving the overlapping edits."},ctx);
          _seriesRebasedBible=rebased.bible;
          _seriesServerBible=latest;
          bibleSavedRef.current=stableJson(latest);
          return true;
        };
        const queued=bibleRebaseRef.current;
        if(queued&&String(queued.projectId||"")===String(ctx.projectId)
          &&String(queued.showId||"")===String(ctx.showId)){
          const applied=applyBibleRebase(queued.latest,queued.checkpoint,
            "The Show Bible changed while a queued save was being reconciled. Reload before resolving the overlapping edits.");
          if(applied!==true) return applied;
          _consumedBibleRebase=queued;
        }
        // Drain any crash-recovery pair for this exact Episode/Show before taking
        // a newer snapshot to the server. Replaying in timestamp order preserves
        // the user's save order; a conflict keeps the journal for the next load.
        const repaired=await _replaySeriesPairOutbox(ctx.projectId,ctx.showId);
        if(!_saveScopeActive(ctx)) return true;
        if(!repaired.ok) return _docSaveResult({ok:false,conflict:!!repaired.conflict,
          message:repaired.message||"An interrupted Series save is still pending."},ctx);
        if(repaired.lastBible){
          let priorBible={};
          try{ priorBible=JSON.parse(bibleSavedRef.current||"{}"); }catch(e){}
          // A journal patch is the last local checkpoint that the recovery just
          // confirmed. Use it as the ancestor for touched departments; the prior
          // acknowledged Bible remains the ancestor everywhere else.
          const checkpoint={...priorBible,...(repaired.lastBiblePatch||{})};
          const applied=applyBibleRebase(repaired.lastBible,checkpoint,
            "The Show Bible changed while an interrupted save was recovering. Reload before reconciling the overlapping edits.");
          if(applied!==true) return applied;
        }
      }
      if(_saveGenerationLatest(ctx)) setSaveState("saving");

      // The whole-doc overwrite would otherwise wipe Home-wall metadata that is
      // not represented in story state. Carry it into this scoped snapshot.
      const meta=(projectsRef.current||[]).find(p=>String(p.id)===String(ctx.projectId))||{};
      const keep={};
      /* the poster and the Home order are the OWNER's film card (2026-10-03): a collaborator's save
         never carries them — no role covers them, and they aren't in the loaded baseline, so on any
         film with a poster every collaborator save read as "outside your role" and reloaded */
      if(!meta.isShared){
        if(meta.cover) keep.cover=meta.cover;
        if(meta.coverPrev) keep.coverPrev=meta.coverPrev;
        if(meta.ord!=null) keep.homeOrder=Number(meta.ord);
      }
      const _sectionsNow={...doc,...keep};
      const _changed={};
      Object.keys(_sectionsNow).forEach(k=>{
        if(k==="room"||k==="view"||k==="artView"||k==="selId") return;
        if(stableJson(_sectionsNow[k])!==lastSentRef.current[k]) _changed[k]=_sectionsNow[k];
      });
      /* ROLE SCOPING — a denied local section is never merely dropped from the request.
         Restore its last accepted value immediately; otherwise the UI keeps showing a
         phantom edit while the no-op request reports “Saved”. The rollback render gets
         its own save generation, so this generation stays unsettled until React has
         reconciled the accepted baseline. */
      let _deniedLocal=false;
      if(typeof window.teamCanWriteSection==="function" && isSharedFilm && shareRole!=="owner"){
        const denied=Object.keys(_changed).filter(k=>!window.teamCanWriteSection(writeRole,k));
        if(denied.length){
          const setters={scenes:setScenes,characters:setCharacters,props:setProps,locations:setLocations,
            sluglineUnits:setSlugUnitsOv,lookbook:setLookbook,lookbookNote:setLookbookNote,
            lookbookApplied:setLookbookApplied,shots:setShots,project:setProject,drafts:setDrafts,
            beatsMap:setBeatsMap,history:setHistory,continuityMap:setContinuityMap,trash:setTrash,
            propsSeeded:setPropsSeeded,locsSeeded:setLocsSeeded,visualsSeeded:setVisualsSeeded};
          let restored=true;
          denied.forEach(k=>{
            delete _changed[k];
            const prior=lastSentRef.current[k], setter=setters[k];
            if(prior===undefined || typeof setter!=="function"){ restored=false; return; }
            try{ setter(JSON.parse(prior)); }catch(e){ restored=false; }
          });
          if(!restored){
            _docRoleScope({roleScope:true,localDenied:true,
              message:"your role does not cover those sections."});
            return false;
          }
          _deniedLocal=true;
          if(_saveGenerationLatest(ctx)) setSaveState("saving");
          const now=Date.now();
          if(_saveScopeActive(ctx) && now-(roleNoticeRef.current||0)>60000){
            roleNoticeRef.current=now;
            const note=sharedReadOnlyWhy || ((typeof window.teamRoleScopeNote==="function")?window.teamRoleScopeNote(writeRole):"");
            if(typeof window.appToast==="function"&&note) window.appToast(note,"error");
          }
        }
      }
      const _mineKeys=Object.keys(_changed);
      const _rememberSent=()=>_mineKeys.forEach(k=>{ lastSentRef.current[k]=stableJson(_sectionsNow[k]); });
      const _sectionSaveOpts=(sections,fullRecoveryBaseline)=>{
        const baseline={};
        Object.keys(sections||{}).forEach(k=>{
          if(k!=="project"&&!fullRecoveryBaseline) return;
          if(lastSentRef.current[k]===undefined) return;
          try{ baseline[k]=JSON.parse(lastSentRef.current[k]); }catch(e){}
        });
        /* SHOTS MERGE PER SHOT (2026-10-09, owner — Stage editor review): the Art director and the Stage editor both
           save `shots`, and a stale save overwrote the other's approvals or voicing. The last shots this window
           saw from the cloud go along as `shotsBase`, so cloudSaveSections merges shot by shot. */
        let shotsBase;
        if(!fullRecoveryBaseline && sections && Object.prototype.hasOwnProperty.call(sections,"shots") && lastSentRef.current.shots!==undefined){
          try{ const b=JSON.parse(lastSentRef.current.shots); if(Array.isArray(b)) shotsBase=b; }catch(e){}
        }
        const out={};
        if(Object.keys(baseline).length) out.baseline=baseline;
        if(shotsBase) out.shotsBase=shotsBase;
        return Object.keys(out).length?out:undefined;
      };
      const _episodeSectionSaveOpts=(sections,fullRecoveryBaseline)=>{
        const opts=_sectionSaveOpts(sections,fullRecoveryBaseline);
        if(opts&&opts.baseline&&Object.prototype.hasOwnProperty.call(opts.baseline,"trash"))
          opts.baseline.trash=(window.turnSeries&&typeof window.turnSeries.episodeTrash==="function")
            ? window.turnSeries.episodeTrash(opts.baseline.trash)
            : {shots:(opts.baseline.trash&&opts.baseline.trash.shots)||[]};
        return opts;
      };
      const _finishSuccess=async ()=>{
        if(_deniedLocal){
          if(_saveScopeActive(ctx)&&_saveGenerationLatest(ctx)){
            dirtyRef.current=true;
            setSaveState("saving");
          }
          // Yield one task so React can install the rollback generation. A project
          // switch flushing this request can then follow that newer pending save
          // instead of mistaking this denied snapshot for the final generation.
          await new Promise(resolve=>setTimeout(resolve,0));
          return false;
        }
        return _docSaveResult({ok:true},ctx);
      };

      try{
        if(ctx.showId){
          const sharedKeys=(window.turnSeries&&window.turnSeries.SHARED_KEYS)
            ? window.turnSeries.SHARED_KEYS : ["characters","locations","props","lookbook","lookbookNote","trash"];
          const _epChanged={..._changed}; sharedKeys.forEach(k=>{ delete _epChanged[k]; });
          /* `trash` is split across persistence domains: character/prop/location
             tombstones live in the Show Bible, while shot tombstones stay with
             this Episode. Preserve the existing combined React shape only in UI. */
          if(Object.prototype.hasOwnProperty.call(_changed,"trash")){
            const episodeNow=(window.turnSeries&&typeof window.turnSeries.episodeTrash==="function")
              ? window.turnSeries.episodeTrash(trash) : {shots:(trash&&trash.shots)||[]};
            let acceptedTrash={};
            try{ acceptedTrash=JSON.parse(lastSentRef.current.trash||"{}"); }catch(e){}
            const episodeAccepted=(window.turnSeries&&typeof window.turnSeries.episodeTrash==="function")
              ? window.turnSeries.episodeTrash(acceptedTrash) : {shots:(acceptedTrash&&acceptedTrash.shots)||[]};
            if(stableJson(episodeNow)!==stableJson(episodeAccepted)) _epChanged.trash=episodeNow;
          }
          const _bibleKeys=sharedKeys.filter(k=>Object.prototype.hasOwnProperty.call(_changed,k)
            ||(_seriesRebasedBible&&stableJson(_seriesRebasedBible[k])!==stableJson((_seriesServerBible||{})[k])));
          const _bibleCurrent={characters,locations,props,lookbook,lookbookNote,
            trash:(window.turnSeries&&typeof window.turnSeries.sharedTrash==="function")
              ? window.turnSeries.sharedTrash(trash) : {characters:(trash&&trash.characters)||[],locations:(trash&&trash.locations)||[],props:(trash&&trash.props)||[]}};
          const _bibleStored=_seriesRebasedBible||((window.turnSeries&&typeof window.turnSeries.prepareBibleForEpisode==="function")
            ? window.turnSeries.prepareBibleForEpisode(_bibleCurrent,ctx.projectId) : _bibleCurrent);
          const _biblePatch={}; _bibleKeys.forEach(k=>{ _biblePatch[k]=_bibleStored[k]; });
          let _bibleBaseline={};
          try{ _bibleBaseline=JSON.parse(bibleSavedRef.current||"{}"); }catch(e){}
          const _bibleBaselinePatch={}; _bibleKeys.forEach(k=>{ _bibleBaselinePatch[k]=_bibleBaseline[k]; });
          const jobs=[];
          if(Object.keys(_epChanged).length){
            _epChanged.showId=ctx.showId; _epChanged.episodeNo=currentEpisodeNo;
          }
          const _writeEpisode=Object.keys(_epChanged).length>0;
          /* Decide from the departments this save actually touches. Comparing the
             entire prepared Bible can turn an Episode-only shot-bin edit into an
             unrelated Show write merely because another department was normalized
             in memory. */
          const _writeBible=_bibleKeys.length>0
            && stableJson(_biblePatch)!==stableJson(_bibleBaselinePatch);
          let _pairJournalKey=null;
          if(_writeEpisode&&_writeBible){
            _pairJournalKey=_seriesOutboxPut({episodeId:ctx.projectId,showId:ctx.showId,
              episodePatch:_epChanged,episodeBaseline:_episodeSectionSaveOpts(_epChanged,true)?.baseline||{},
              biblePatch:_biblePatch,bibleBaseline:_bibleBaselinePatch});
            if(!_pairJournalKey) return _docSaveResult({ok:false,
              message:"We couldn’t create the local safety journal for this Episode + Show Bible save. No cloud changes were sent; keep this tab open and try again."},ctx);
          }
          if(_writeEpisode)
            jobs.push({kind:"episode",run:()=>cloudSaveSections(ctx.projectId,_epChanged,_episodeSectionSaveOpts(_epChanged))});
          if(_writeBible){
            jobs.push({kind:"bible",run:()=>cloudSaveBibleSections(ctx.showId,_biblePatch,
              {episodeId:ctx.projectId,baseline:_bibleBaseline})});
          }
          if(!jobs.length){
            if(_saveScopeActive(ctx)) _rememberSent();
            if(_seriesRebasedBible&&_saveGenerationLatest(ctx)){
              const scoped=(window.turnSeries&&typeof window.turnSeries.bibleForEpisode==="function")
                ? window.turnSeries.bibleForEpisode(_seriesRebasedBible,ctx.projectId,null,currentEpisodeNo)
                : _seriesRebasedBible;
              _adoptBibleTheirs(scoped,[]);
              if(bibleRebaseRef.current===_consumedBibleRebase) bibleRebaseRef.current=null;
            }
            return _finishSuccess();
          }
          /* Keep the journaled pair ordered: persist Episode-owned story first,
             then update the shared Bible. This narrows the partial-write window,
             avoids sending a canon update after an Episode save was rejected,
             and matches the recovery contract described to MUSE. */
          const results=[];
          for(const job of jobs){
            const r=await job.run();
            results.push({kind:job.kind,r});
            if(!(r&&r.ok)) return _docSaveResult(r,ctx);
          }
          if(_pairJournalKey) _seriesOutboxClear(_pairJournalKey);
          if(!_saveScopeActive(ctx)) return true;
          _rememberSent();
          const ep=results.find(x=>x.kind==="episode");
          const bs=results.find(x=>x.kind==="bible");
          // Only the newest snapshot may adopt collaborator changes into live state.
          // A successful Bible save is a SERVER-SIDE THREE-WAY MERGE, so its result
          // is authoritative even for departments this window just edited. Skipping
          // those departments would leave a collaborator's same-department addition
          // invisible here; on the next edit, its absence could then be interpreted
          // as an explicit deletion against the newly advanced Bible baseline.
          if(_saveGenerationLatest(ctx) && ep) _adoptTheirs(ep.r.doc,_mineKeys,ep.r.project,ep.r.shots);
          if(bs){
            const merged=bs.r.bible||_bibleStored;
            if(_saveGenerationLatest(ctx)){
              const scoped=(window.turnSeries&&typeof window.turnSeries.bibleForEpisode==="function")
                ? window.turnSeries.bibleForEpisode(merged,ctx.projectId,bs.r.doc&&bs.r.doc.sourceEpisodeId,currentEpisodeNo)
                : merged;
              // Align both live state and lastSentRef with the merged server truth,
              // including the departments represented in _bibleKeys.
              _adoptBibleTheirs(scoped,[]);
              bibleRebaseRef.current=null;
            }else{
              // A newer React generation already exists, so adopting would stomp
              // that edit. Hand the successor both the merged server truth and
              // this generation's exact local checkpoint for a safe three-way rebase.
              bibleRebaseRef.current={projectId:ctx.projectId,showId:ctx.showId,
                latest:merged,checkpoint:_bibleStored};
            }
            bibleSavedRef.current=stableJson(merged);
          }else if(_seriesRebasedBible&&_saveGenerationLatest(ctx)){
            // Recovery may have completed the Bible write while this generation
            // only needed to persist Episode-owned sections. Still adopt the
            // rebased server truth so live state and lastSentRef advance together.
            const scoped=(window.turnSeries&&typeof window.turnSeries.bibleForEpisode==="function")
              ? window.turnSeries.bibleForEpisode(_seriesRebasedBible,ctx.projectId,null,currentEpisodeNo)
              : _seriesRebasedBible;
            _adoptBibleTheirs(scoped,[]);
            if(bibleRebaseRef.current===_consumedBibleRebase) bibleRebaseRef.current=null;
          }
          return _finishSuccess();
        }
        if(!_mineKeys.length) return _finishSuccess();
        const result=await cloudSaveSections(ctx.projectId,_changed,_sectionSaveOpts(_changed));
        if(result&&result.ok&&_saveScopeActive(ctx)){
          _rememberSent();
          if(_saveGenerationLatest(ctx)) _adoptTheirs(result.doc,_mineKeys,result.project,result.shots);
        }
        return result&&result.ok ? _finishSuccess() : _docSaveResult(result,ctx);
      }catch(e){
        return _docSaveResult({ok:false,message:(e&&e.message)||"Save failed."},ctx);
      }
    };
    const request=()=>{
      if(launched) return launched;
      if(timerId!=null) clearTimeout(timerId);
      // Continue the chain after a failed predecessor: the newer snapshot still
      // deserves its own attempt and always executes after the older response.
      launched=saveQueueRef.current.catch(()=>false).then(performSave).catch(()=>false);
      saveQueueRef.current=launched.catch(()=>false);
      return launched;
    };
    pendingSaveRef.current={...ctx,request};
    timerId=setTimeout(()=>{ request(); },cloudMode?700:250);
    saveTimer.current=timerId;
    return ()=>{ if(timerId!=null) clearTimeout(timerId); };
  },[scenes, characters, props, locations, slugUnitsOv, lookbook, lookbookNote, lookbookApplied, shots, project, drafts, beatsMap, history, continuityMap, selId, room, view, artView, propsSeeded, locsSeeded, visualsSeeded, trash, cloudMode, currentProjectId, currentShowId, currentEpisodeNo, retryTick, readOnlyShare, hydrationTick]);

  /* UNLOAD GUARD — saves are debounced (700ms) and can be mid-flight or retrying, so
     closing the tab at the wrong moment silently dropped the last edits with no warning.
     Only prompts when something is genuinely unwritten; a settled window closes clean. */
  React.useEffect(()=>{
    const h = (e)=>{
      if(!dirtyRef.current && saveState!=="saving" && saveState!=="retrying" && saveState!=="failed") return;
      e.preventDefault(); e.returnValue = "";      // browsers show their own generic wording
      return "";
    };
    window.addEventListener("beforeunload", h);
    return ()=>window.removeEventListener("beforeunload", h);
  },[saveState, readOnlyShare]);

  /* THE COLORIST'S REFERENCES, ONE RULE (2026-10-02): the field's text while the user hasn't
     taken it over is the Lookbook's colorist brief; once they edit it, their text. The
     write-through below fills the field with it, and the Colorist reads it through the SAME
     helper (art.references / art.designStyles) — so a Colorist step that runs right after a
     Lookbook change (the Art Coordinator) reads the new brief even before the write-through's
     render lands, and never anything the field won't show. */
  const colorRefsFor = (sb, lb, note)=>{
    const brief = (typeof lookbookBriefFor==="function") ? lookbookBriefFor("colorist", lb, note).replace(/^Overall look: /,"") : "";
    const manual = (typeof mergeLookbookIntoRefs==="function") ? mergeLookbookIntoRefs((sb&&sb.refs)||"", "") : ((sb&&sb.refs)||"");
    const owned = !!manual.trim() && manual !== ((sb&&sb.lookbookSynced)||"");
    return { refs: owned ? manual : brief, brief, owned };
  };
  /* Write-through: the Presets (Colorist) "Visual references" field auto-fills from the
     Lookbook — the colorist brief goes INTO the editable field itself (no labels/markers),
     re-syncing on every lookbook change (research, card edits, statement edits, clear),
     for as long as the user hasn't taken the field over: styleBible.lookbookSynced remembers
     the last auto-fill, and once refs differs from it (the user edited), syncs stop and the
     user's text wins. WYSIWYG — whatever the field shows is exactly what the Colorist reads.
     Legacy docs (an in-field "[Lookbook references]" marker block, or the interim separate
     lookbookRefs field) are folded into this shape here. hydrationTick re-runs the pass
     once after a doc settles (migration). */
  React.useEffect(()=>{
    if(hydratingRef.current) return;
    if(artRoomReadOnlyRef.current) return;   // (2026-10-08) a role that can't change the Art Room never rewrites the colour system
    if(typeof lookbookBriefFor!=="function") return;
    setProject(p=>{
      const sb = (p.styleBible)||{};
      const { refs:next, brief } = colorRefsFor(sb, lookbook, lookbookNote);
      if((sb.refs||"")===next && (sb.lookbookSynced||"")===brief && sb.lookbookRefs===undefined) return p;
      const out = { ...sb, refs:next, lookbookSynced:brief };
      delete out.lookbookRefs;   // interim field from the previous sync design
      return { ...p, styleBible:out };
    });
  },[lookbook, lookbookNote, hydrationTick]);

  /* No story yet → the studio has nothing to work on: rooms beyond the Writers'
     Room stay locked, and story-dependent actions explain what to do instead. */
  const requireStory = async (what)=>{
    if(scenes.length) return true;
    const ok = await window.appConfirm({ title:"Create a story first",
      body:what+" works on your story — and there isn't one yet. Bring an idea and Kinolot builds the story with you, scene by scene.",
      confirmLabel:"New Story", cancelLabel:"Not now" });
    if(ok) startNewStory();
    return false;
  };
  // PLAN GATE — no free tier: a signed-in user needs an active plan (or purchased
  // credits) before creating a story. Admin and local/dev (balance not loaded yet)
  // bypass; the server-side credit check is the real enforcement, this is the
  // friendly nudge to the plans modal.
  const planActive = ()=>{
    if(window.turnIsAdmin) return true;
    const b = window.turnCreditBalance;
    if(!b){
      // Ledger not loaded yet. A SIGNED-IN cloud user must NOT slip through the gate
      // (a fresh no-plan account showed the ledger a beat late and was let straight in
      // to generate) — kick a refresh and treat them as gated until it lands. Only a
      // truly anonymous / offline dev session gets the friendly bypass.
      if(session && session.user){ try{ refreshCreditBalance && refreshCreditBalance(); }catch(e){} return false; }
      return true;
    }
    return window.turnIsPaidPlan(b.plan) || (Number(b.credits)||0) > 0 || (Number(b.remaining)||0) > 0;
  };
  const currentRoomEntitlements = ()=>{
    if(window.turnIsAdmin) return { writers_room:true, art_room:true, stage:true };
    if(isSharedFilm){
      // the OWNER's plan decides which rooms the film has; every role may look into them, and
      // writes follow the role (roomReadOnly). Not read yet → wait (roomGateReady).
      if(filmOwnerTier===null) return null;
      if(filmOwnerTier==="studio") return { writers_room:true, art_room:true, stage:true, shared:true };
      if(filmOwnerTier==="director") return { writers_room:true, art_room:true, stage:false, shared:true };
      // the owner's plan lapsed: every room stays open to READ (writeRole is View-only) — §5, owner
      // 2026-10-09 (Team review): the rooms closed, against "you keep read-only access, nothing is lost"
      if(filmOwnerTier==="none") return { writers_room:true, art_room:true, stage:true, shared:true };
      // the server can't say (before team-relaunch.sql): the older role-only rooms
      if(shareRole==="view_only") return { writers_room:true, art_room:true, stage:true, shared:true };
      if(String(shareRole).split("+").includes("art_director")) return { writers_room:true, art_room:true, stage:false, shared:true };
      return { writers_room:true, art_room:false, stage:false, shared:true };
    }
    const b = window.turnCreditBalance;
    if(!b && session && session.user) return null;
    if(typeof window.turnRoomEntitlements==="function") return window.turnRoomEntitlements(b);
    return { writers_room:true, art_room:true, stage:true };
  };
  const roomGateReady = ()=>{
    if(window.turnIsAdmin) return true;
    if(isSharedFilm) return filmOwnerTier!==null;
    if(!(session && session.user)) return true;
    return !!window.turnCreditBalance;
  };
  const canAccessRoom = (id)=>{
    if(id==="writers") return true;
    const e = currentRoomEntitlements();
    if(!e) return false;
    if(id==="art") return !!e.art_room;
    if(id==="stage") return !!e.stage;
    return false;
  };
  const requirePlan = (what)=>{
    // The plans modal itself carries the "choose a plan" message, so no toast —
    // the bottom popup was redundant noise on top of the modal.
    if(typeof window.turnOpenPlans==="function") window.turnOpenPlans();
  };
  const requireRoomEntitlement = (id)=>{
    if(isSharedFilm){
      if(typeof window.appToast==="function"){
        const what = id==="art" ? "the Art Room" : "the Stage";
        window.appToast(ownerPlanLapsed
          ? `This film is read-only right now: its owner's plan doesn't include shared work, so ${what} is closed.`
          : `This film's plan doesn't include ${what}.`, "info");
      }
      return;
    }
    const plan = (typeof window.turnRoomRequiredPlan==="function") ? window.turnRoomRequiredPlan(id) : "the right";
    if(typeof window.appToast==="function"){
      window.appToast(`${id==="art"?"The Art Room":"The Stage"} requires the ${plan} plan.`, "info");
    }
    requirePlan("open "+(id==="art"?"the Art Room":id==="stage"?"the Stage":"this room"));
  };
  // returns whether the room opened (a hand-off sets the tab and the scene only when it did — 2026-10-09)
  const guardedSetRoom = (id)=>{
    const sharedProject = isSharedFilm;
    if(id!=="writers" && !sharedProject && !planActive()){ requirePlan("open "+(id==="art"?"the Art Room":id==="stage"?"the Stage":"this room")); return false; }
    if(id!=="writers" && !canAccessRoom(id)){ requireRoomEntitlement(id); return false; }
    if(id!=="writers" && !scenes.length){ requireStory(id==="stage" ? "The Stage" : "The Art Room"); return false; }
    setRoom(id);
    return true;
  };
  React.useEffect(()=>{
    if(room==="writers") return;
    if(!roomGateReady()) return;
    if(canAccessRoom(room)) return;
    const plan = (typeof window.turnRoomRequiredPlan==="function") ? window.turnRoomRequiredPlan(room) : "the right";
    setRoom("writers"); setView("spine");
    if(typeof window.appToast==="function"){
      window.appToast(isSharedFilm
        ? (ownerPlanLapsed ? `This film is read-only right now: its owner's plan doesn't include shared work.`
          : `This film's plan doesn't include ${room==="art"?"the Art Room":"the Stage"}.`)
        : `${room==="art"?"The Art Room":"The Stage"} requires the ${plan} plan.`, "info");
    }
  },[room, creditBalance, session, isAdmin, shareRole, currentProjectId, projectLoading, filmOwnerTier]);

  const resetStory = ()=>{
    if(!isAdmin) return;   // the Matrix sample is admin-only — belt & braces behind the hidden menu item
    clearStory();
    setScenes(SCENES); setCharacters(CHARACTERS); setProps((window.PROPS_SEED||[])); setLocations([]); setShots([]); setProject(PROJECT); setDrafts(SCREENPLAY);
    setBeatsMap((typeof withBeatMapIdentity==="function")?withBeatMapIdentity(BEATS):BEATS);
    setHistory({}); setContinuityMap(CONTINUITY||{}); setSelId("s4"); setSelChar(null); setPropsSeeded(false); setLocsSeeded(false); setVisualsSeeded(false);
  };

  // "New Story" — NON-destructive and LAZY (2026-07-04). Clicking it only opens the
  // intake modal over whatever the user is doing; NO film is created until the story
  // actually LAUNCHES (logline → synopsis reviewed → build). It used to mint a blank
  // film eagerly on click, so every aborted/closed intake stranded an untitled film
  // on the wall — and every extra click stranded another. The blank film is now
  // created inside onLaunch, and only when the CURRENT film already holds a story
  // (an empty canvas is reused, never duplicated). Deleting a film remains the
  // project switcher's deliberate per-film Delete.
  const startNewStory = ()=>{ if(!canMutateWritersRoom()) return; if(!planActive()){ requirePlan("start a story"); return; } setNewStoryOpen(true); };

  // ---- character handlers ----
  const updateCharacter = (id,patch)=>{
    if(!canMutateCharacters()) return;
    const revision=Date.now().toString(36);
    const prior=(characters||[]).find(c=>c.id===id)||null;
    const touchesVoice=Object.prototype.hasOwnProperty.call(patch,"voiceLock");
    if(touchesVoice&&prior){
      const before=prior.voiceLock||null,after=patch.voiceLock||null;
      const sig=lock=>(typeof window.vgVoiceLockSignature==="function")
        ? window.vgVoiceLockSignature(lock) : JSON.stringify(lock||null);
      const changed=sig(before)!==sig(after)
        || String((before&&before.revision)||"")!==String((after&&after.revision)||"");
      if(changed) setShots(ss=>ss.map(sh=>{
        const la=sh&&sh.lineAudio;
        if(!la)return sh;
        const belongs=String(la.speakerId||"")===String(id)
          || (!!before&&String(la.voiceId||"")===String(before.voiceId||""));
        return belongs ? {...sh,lineAudio:{...la,stale:true,staleReason:after
          ? "The character's canonical voice changed; revoice this line before rendering."
          : "The character's canonical voice was removed; lock a voice and revoice this line.",staleAt:new Date().toISOString()}} : sh;
      }));
    }
    const merge=c=>{
      if(c.id!==id) return c;
      const identityChanged=Object.prototype.hasOwnProperty.call(patch,"pronouns")
        && String(patch.pronouns||"").trim()!==String(c.pronouns||"").trim();
      return {...c,...patch,...(identityChanged?{identityRevision:revision}:{})};
    };
    // Coordinator chains draftSpec → generateMaster before React's passive
    // effect runs. Publish the accepted edit now so media checks see the repaired
    // specification, not the superseded text. React remains the persisted state.
    const live=window.turnIdentityContext;
    if(live && Array.isArray(live.cast)){
      const next=live.cast.map(merge);
      window.turnIdentityContext={...live,cast:next,characters:next};
      window.turnCast=next;
    }
    setCharacters(cs=>cs.map(merge));
  };
  const characterMediaOptions = (c)=>({
    identityLive:true, identityEpoch:typeof nbEpoch==="function"?nbEpoch():null,
    identityCharacter:c, identityCharacterIds:[c.id], identityCast:characters,
    identityContext:{characterIds:[c.id],cast:characters,scenes,drafts},
  });
  // SOFT DELETE: move the full character into the restore bin (its scenes are scene-side
  // and untouched, so restoring the same id re-links them). The generated sheet is KEPT
  // (no nbClearAsset) so a restore brings the art back too; it's purged only on "Delete
  // forever". A new trash entry stamps when it was deleted.
  const _trashStamp = (obj)=> ({ ...obj, _deletedAt:new Date().toISOString() });
  const deleteCharacter = (id)=>{
    if(!canMutateSharedFilm()) return;
    const c = (characters||[]).find(x=>x.id===id); if(!c) return;
    setCharacters(cs=>cs.filter(x=>x.id!==id));
    setTrash(t=>({ ...t, characters:[ _trashStamp(c), ...(t.characters||[]).filter(x=>x.id!==id) ] }));
  };
  const restoreCharacter = (id)=>{
    if(!canMutateSharedFilm()) return;
    const item = (trash.characters||[]).find(x=>x.id===id); if(!item) return;
    // a live card with the same id: say so and keep the binned copy (it used to vanish silently — 2026-10-09)
    if((characters||[]).some(c=>c && c.id===id)){
      if(typeof window.appToast==="function") window.appToast("\u201c"+(item.name||"This character")+"\u201d is already in the cast, so the copy in Recently deleted stays there.","info");
      return;
    }
    const { _deletedAt, ...clean } = item;
    setCharacters(cs=> cs.some(c=>c.id===id) ? cs : [...cs, clean]);
    setTrash(t=>({ ...t, characters:(t.characters||[]).filter(x=>x.id!==id) }));
  };
  const purgeCharacter = async (id)=>{
    if(!canMutateSharedFilm()) return;
    const item = (trash.characters||[]).find(x=>x.id===id);
    if(!item) return;
    const film0 = projIdRef.current;
    /* NEVER A LIVE CHARACTER'S FILES (2026-10-09, owner — Art Room review): a character back in the cast with the same
       id (an Undo restored the cast, not the bin) lost its sheets, likeness photos and voice to "Delete forever".
       With a live twin only the binned copy goes; its files stay with the live card. */
    const live = (characters||[]).some(c=>c && c.id===id);
    try{
      if(!live){
        if(typeof nbClearAsset==="function"){
          // (2026-10-06) the scale sheet too — it used to stay behind
          const ids = [id, ...(item.states||[]).map(st=>id+":"+st.id), "charscale-"+id];
          for(const assetId of ids) await nbClearAsset(assetId);
        }
        // …and the likeness photos (on this device and the cloud copy), and the voice file
        if(typeof nbClearCameo==="function"){ try{ await nbClearCameo(id); }catch(e){} }
        if(typeof window.vgClearAudio==="function" && typeof window.vgVoiceMasterAssetId==="function"){ try{ await window.vgClearAudio(window.vgVoiceMasterAssetId(id)); }catch(e){} }
      }
      // the film it was deleted from, still open (a switch during the deletes must not touch the next film)
      if(projIdRef.current!==film0) return;
      // its props no longer name a deleted owner (unless the character is live again)
      if(!live) setProps(ps=>ps.map(p=> p && p.ownerId===id ? { ...p, ownerId:null } : p));
      setTrash(t=>({ ...t, characters:(t.characters||[]).filter(x=>x.id!==id) }));
    }catch(e){ if(window.appToast) window.appToast("Couldn't permanently delete this character's files. It stays in Recently deleted so you can try again.","error"); }
  };
  const [charDrafting, setCharDrafting] = React.useState(null);
  const draftCharacter = async (ch)=>{
    if(!canMutateCharacters() || charDrafting) return;
    const epoch=typeof nbEpoch==="function"?nbEpoch():null;
    const startingPronouns=ch.pronouns;
    setCharDrafting(ch.id);
    const driven = scenes.filter(s=>s.driver===ch.id);
    try{
      const res = (typeof aiDraftCharacter==="function") ? await aiDraftCharacter(ch, driven, project, { scenes, drafts }) : null;
      const current=(window.turnCast||[]).find(c=>c.id===ch.id);
      if(res && canMutateSharedFilm() && current && current.pronouns===startingPronouns
        && (epoch===null || (typeof nbEpoch==="function" && nbEpoch()===epoch))) updateCharacter(ch.id, res);
    }catch(e){ if(typeof window.appToast==="function") window.appToast(String(e&&e.message||"Character draft failed."),"error"); }
    setCharDrafting(null);
  };
  const selectScene = (id)=>{ setSelId(id); setSelChar(null); setFocusBeat(null);
    // surface the selected scene's details — expand a collapsed inspector.
    // Panel modes only: on mobile the inspector is a full overlay drawer, and
    // auto-opening it would hijack the canvas on every browsing tap.
    if(!inspDrawer) openInsp();
  };
  const selectSceneBrowse = (id)=>{ setSelId(id); setSelChar(null); setFocusBeat(null); };
  // Art Room provenance links return to the exact screenplay source. Mentions from
  // extractors may carry a stable scene id, scene number, beat number and/or block
  // index; resolve in that order and highlight after the Script view has mounted.
  const openArtSource = (mention)=>{
    const m = mention || {};
    const ptr = (typeof artRoomSourcePointer==="function") ? artRoomSourcePointer(m) : m;
    const nested = (m.scene && typeof m.scene==="object") ? m.scene : {};
    const source = (m.source && typeof m.source==="object") ? m.source : {};
    const sid = ptr.sceneId || m.sceneId || m.scene_id || source.sceneId || nested.id
      || (Array.isArray(m.sceneIds) ? m.sceneIds[0] : "")
      || (typeof m.scene==="string" ? m.scene : "");
    const no = Number(ptr.sceneNo || m.sceneNo || m.scene_no || nested.no);
    const title = String(ptr.title || m.title || m.sceneTitle || nested.title || "").trim().toLowerCase();
    const scene = scenes.find(s=>s.id===sid)
      || (Number.isFinite(no) ? scenes.find(s=>Number(s.no)===no) : null)
      || (title ? scenes.find(s=>String(s.title||"").trim().toLowerCase()===title) : null);
    if(!scene){ if(window.appToast) window.appToast("That screenplay source scene is no longer available.","error"); return; }
    const beat = Number(ptr.beat || m.beatN || m.beat || m.beatNo || source.beatN);
    const block = Number(ptr.blockIndex);
    setSelId(scene.id); setSelChar(null); setRoom("writers"); setView("script");
    if(Number.isFinite(beat) && beat>0) setFocusBeat(beat);
    let tries=0;
    const reveal=()=>{
      let el = Number.isFinite(block)
        ? document.querySelector('[data-sp-block-index="'+block+'"]') : null;
      if(!el && Number.isFinite(beat) && beat>0){
        const nums = Array.from(document.querySelectorAll(".sp-seg .sp-gut .bnum"));
        const num = nums.find(n=>String(n.textContent||"").trim()===String(beat));
        el = num && num.closest(".sp-seg");
      }
      if(el){
        el.scrollIntoView({behavior:"smooth",block:"center"});
        el.classList.remove("spb-check-flash"); void el.offsetWidth; el.classList.add("spb-check-flash");
        setTimeout(()=>el.classList.remove("spb-check-flash"),2200);
        return;
      }
      if(tries++<40) requestAnimationFrame(reveal);
    };
    requestAnimationFrame(reveal);
  };
  // canvas views (Spine / Audit / Board): tapping a scene MEANS "show me its
  // details", so on mobile this variant ALSO opens the inspector drawer
  // (user ruling 2026-07-19 — the Script view keeps the non-hijacking selectScene).
  const selectSceneDetail = (id)=>{ selectScene(id); if(inspDrawer) setInspOpen(true); };

  // Art Room: draft a character's visual layer (look/wardrobe/props) from the script
  // per-card character drafts run CONCURRENTLY (reuse the drafting-ids set the cards
  // already reflect), so several "Draft details" / "Draft & Generate" can run at once.
  /* THE SCREENPLAY FACT SHEET (owner-approved 2026-10-12 — Character fidelity, step 2): read what the screenplay states
     about these characters (ai.jsx aiCastScriptFacts — writing calls, the whole list at once) and save it on each card
     (artroom.jsx charFactsReadPatch: the facts, the screenplay signature they were read from, and the marks they add to
     Distinguishing features). FILM-FENCED like Draft all. Returns { id: patch } for the characters read, or null.
     o.quiet: no success toast (a draft flow carries on); o.silent: no toasts at all; o.throwErrors: an error is thrown. */
  const [readingFactIds, setReadingFactIds] = React.useState([]);
  const readingFactIdsRef = React.useRef([]); readingFactIdsRef.current = readingFactIds;
  const readCharacterFacts = async (list, o)=>{
    o = o || {};
    if(!canMutateCharacters() || typeof window.aiCastScriptFacts!=="function" || typeof window.charFactsReadPatch!=="function") return null;
    const targets = (list||[]).filter(c=>c && c.id && readingFactIdsRef.current.indexOf(c.id)<0);
    if(!targets.length) return null;
    const ids = targets.map(c=>c.id);
    const filmAtStart = castDraftFilmKey();
    const curDrafts = draftsRef.current || drafts, curScenes = scenes;
    setReadingFactIds(x=>[...x, ...ids.filter(id=>x.indexOf(id)<0)]);
    readingFactIdsRef.current = [...readingFactIdsRef.current, ...ids];
    const say = (t, kind)=>{ if(!o.silent && typeof window.appToast==="function") window.appToast(t, kind); };
    let out = null;
    try{
      const r = await window.aiCastScriptFacts(targets, curScenes, curDrafts, { isCancelled:o.isCancelled });
      if(!r || castDraftFilmKey()!==filmAtStart) return null;
      out = {};
      let n = 0;
      targets.forEach(t=>{
        const c = ((charactersRef.current||characters)||[]).find(x=>x && x.id===t.id) || t;
        const facts = r.byId[t.id] || [];
        n += facts.length;
        const patch = window.charFactsReadPatch(c, facts, { sig:window.charScriptSig(c, curScenes, curDrafts), partial:r.failures.length>0, by:r.by });
        updateCharacter(t.id, patch);
        out[t.id] = patch;
      });
      if(r.failures.length) say("The script was read, but some scenes couldn't be ("+r.failures[0]+") \u2014 read it again to fill the gaps.","info");
      else if(!o.quiet) say("Script read \u2014 "+n+" fact"+(n!==1?"s":"")+" for "+(targets.length===1 ? (targets[0].name||"the character") : targets.length+" characters")+(r.rejected ? " ("+r.rejected+" without a matching quote were left out)" : "")+".","success");
    }catch(e){
      say("Couldn't read the script: "+(((window.turnSafeError||((x)=>x))((e && e.message)||"the read failed"))||"the read failed")+(o.quiet ? " \u2014 drafting from the script excerpt instead." : ""),"info");
      if(o.throwErrors) throw e;
    }finally{
      setReadingFactIds(x=>x.filter(id=>ids.indexOf(id)<0));
      readingFactIdsRef.current = readingFactIdsRef.current.filter(id=>ids.indexOf(id)<0);
    }
    return out;
  };
  // a draft reads the script first for anyone with no fact sheet, or one the screenplay changed since (step 2)
  const _needsFactRead = (c)=>{
    try{ return typeof window.charFactsState==="function" && window.charFactsState(c, scenes, draftsRef.current||drafts).needsRead; }catch(e){ return false; }
  };
  const draftCharacterVisuals = async (ch)=>{
    if(draftingVisualIdsRef.current.indexOf(ch.id)>=0) return;   // this character already drafting
    setDraftingVisualIds(ids=> ids.indexOf(ch.id)>=0 ? ids : [...ids, ch.id]);
    const driven = scenes.filter(s=>s.driver===ch.id);
    try{
      // (2026-10-12, Character fidelity step 2) the fact sheet first, when it's missing or out of date
      if(_needsFactRead(ch)){ const fp = await readCharacterFacts([ch], { quiet:true }); if(fp && fp[ch.id]) ch = { ...ch, ...fp[ch.id] }; }
      const res = (typeof aiCharacterVisuals==="function") ? await aiCharacterVisuals(ch, driven, lbProject("characters"), { scenes, drafts }) : null;
      // (2026-10-12, Character fidelity) a re-draft rewrites coreBody: an older card's script details appended to it
      // move to the distinguishing-features field first (a card that has the field keeps it — the draft never sets it)
      const _legacyFeats = (res && typeof ch.scriptFeatures!=="string" && typeof window.charLegacyBodySplit==="function")
        ? window.charLegacyBodySplit(ch).tail : "";
      if(res){ updateCharacter(ch.id, _legacyFeats ? { ...res, scriptFeatures:_legacyFeats } : res);
        // (the card records the Lookbook it was drafted from — lookbookBrief — so a first per-card
        //  draft raises no false banner, and the rest of the cast isn't marked up to date — 2026-10-06)
        }
    }catch(e){}
    setDraftingVisualIds(ids=> ids.filter(x=>x!==ch.id));
  };
  // Generate a character's MASTER sheet headlessly (used to guarantee a prop's owner has a
  // sheet BEFORE the prop is generated, so the prop matches the character — mirrors the
  // Casting Director's generateMaster: combined prompt + worn-prop refs + cameo + model).
  const _imgOf = async (id)=>{ let u=(typeof nbGetImage==="function")?nbGetImage(id):"";
    if(!u && typeof nbLoadImage==="function"){ try{ u=await nbLoadImage(id); }catch(e){} } return u||""; };
  const generateCharMaster = async (c)=>{
    if(!c || typeof window.nbGenerate!=="function" || typeof window.nbCommit!=="function") return "";
    const identityOptions=characterMediaOptions(c);
    if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(identityOptions,"owner-sheet-start");
    let prompt = (typeof combinedImagePrompt==="function") ? combinedImagePrompt(c, project, props) : (c.name||"character reference sheet");
    const refs=[], wornAttach=[];
    for(const p of (props||[]).filter(p=>p.ownerId===c.id && p.kind!=="carried")){ const u=await _imgOf(p.id); if(u){ refs.push(u); wornAttach.push({ url:u, note:p.name||"Worn prop" }); } }
    /* LIKENESS (2026-10-10, owner — Likeness review): the card's ONE RULE (artroom.jsx turnLikenessSheetRequest) —
       face first, worn items after, numbered; the face left out of the text spec; meta.cameo / cameoAt / mode */
    const lk = (typeof window.turnLikenessSheetRequest==="function")
      ? await window.turnLikenessSheetRequest({ character:c, project, props, worn:wornAttach }) : null;
    let extra = refs, referenceImage = "", likenessMeta = {};
    if(lk && lk.usable){ prompt = lk.prompt; referenceImage = lk.referenceImage; extra = lk.extraImages; likenessMeta = lk.meta; }
    else {
      if(refs.length) prompt += " The additional prop reference image(s) show items this character wears/carries — match them EXACTLY.";
      if(lk && lk.unavailable) likenessMeta = { likenessSkipped:true };
      if(!lk){   // an older build without the shared helper: today's behaviour
        let cameo=[]; if(typeof nbGetCameoAngles==="function"){ try{ cameo=nbGetCameoAngles(c.id)||[]; }catch(e){} }
        if(!cameo.length && typeof nbLoadCameoAngles==="function"){ try{ cameo=await nbLoadCameoAngles(c.id)||[]; }catch(e){} }
        if(cameo.length){ prompt += " Keep the FACE, bone structure and skin tone identical to the locked-likeness reference; only wardrobe and condition change."; extra=[...refs, ...cameo]; }
      }
    }
    const gpt2 = (window.NB_MODELS||[]).find(m=>/gpt-image/i.test(m.id));
    const m0 = (typeof nbGetMeta==="function")?nbGetMeta(c.id):null;
    // the CURRENT picker leads — reusing the prior sheet's recorded model silently
    // ignored the user's model switch (and kept billing against the old provider)
    const model = ((typeof nbGetModel==="function")&&nbGetModel()) || (m0&&m0.modelId) || (gpt2&&gpt2.id) || undefined;
    const gopts = { ...identityOptions, aspectRatio:"16:9", ...(model?{model}:{}), ...(referenceImage?{referenceImage}:{}), ...(extra.length?{extraImages:extra}:{}),
      ...((lk && lk.usable) ? { referencesNumbered:true } : {}) };
    let url; try{ url=await window.nbGenerate(prompt, { ...gopts, assetId:c.id }); }
    catch(e){ if(/no image/i.test(String((e&&e.message)||e))) url=await window.nbGenerate(prompt, { ...gopts, assetId:c.id }); else throw e; }
    if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(gopts,"owner-sheet-commit");
    const meta = { modelId:model, aspect:"16:9", iso:new Date().toISOString(), prompt, agent:"Prop owner pre-gen",
      identitySnapshot:typeof window.nbIdentitySnapshot==="function"?window.nbIdentitySnapshot(c):null,
      writingSources:(typeof window.nbWritingSourcesFor==="function")?window.nbWritingSourcesFor(c):[],
      promptCompiler:"Kinolot prompt compiler", ...likenessMeta };
    const kind = (typeof slotAssetKind==="function") ? slotAssetKind("charref-"+c.id) : "character";
    const saved=await window.nbCommit(c.id, url, meta, [], kind, identityOptions.identityEpoch);
    if(saved && saved.tier==="stale") return "";
    try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id:c.id, url } })); }catch(e){}
    return url;
  };
  // Guarantee a prop is "created with its character's sheet": if the owner has no generated
  // sheet yet, draft its spec (if needed) and generate its master FIRST, so the prop's own
  // generation can reference it. No-op for ownerless props or owners already sheeted.
  const ensureOwnerSheet = async (prop)=>{
    if(!prop || !prop.ownerId) return;
    const c = (characters||[]).find(x=>x.id===prop.ownerId);
    if(!c) return;
    if(await _imgOf(c.id)) return;                       // owner already has a sheet
    let cc = c;
    if(typeof window.charVisualsDrafted==="function" && !window.charVisualsDrafted(cc) && typeof aiCharacterVisuals==="function"){
      try{ const patch = await aiCharacterVisuals(cc, scenes.filter(s=>s.driver===cc.id), lbProject("characters"), { scenes, drafts });
        if(patch){ updateCharacter(cc.id, patch); cc = { ...cc, ...patch }; } }catch(e){}
    }
    try{ await generateCharMaster(cc); }
    catch(e){ if(typeof window.appToast==="function") window.appToast("Couldn't generate "+(c.name||"the owner")+"'s sheet first: "+((e&&e.message)||"error"),"error"); }
  };
  const [draftingAllVisuals, setDraftingAllVisuals] = React.useState(false);
  const draftingAllVisualsRef = React.useRef(false); draftingAllVisualsRef.current = draftingAllVisuals;   // live, for async handlers
  // "Draft all characters" — fills the spec ONLY for characters that haven't been
  // drafted yet (identity, wardrobe, props & accessories, look dev), then suggests
  // continuity states for them. NON-DESTRUCTIVE by design: already-drafted or
  // hand-edited characters are never overwritten, so this is safe to auto-run.
  // FILM-FENCED: the model call takes a while and the film switcher stays live, so the film it started
  // in is captured and every write (merge, states, markApplied) is dropped if another film is open by
  // then — character ids are name slugs that repeat across films, so an unfenced merge would overwrite
  // a same-named character's spec in the new film. A dropped result reports false (nothing landed here).
  const draftAllVisuals = async ()=>{
    if(draftingAllVisuals || !(typeof aiCastVisualBible==="function")) return false;
    const drafted = (typeof window.charVisualsDrafted==="function") ? window.charVisualsDrafted : (()=>true);
    const targets = characters.filter(c=> !drafted(c));
    if(!targets.length) return true;            // nothing to do — that's a success
    const filmAtStart = castDraftFilmKey();
    const sameFilm = ()=> castDraftFilmKey()===filmAtStart;
    const targetIds = targets.map(c=>c.id);
    setDraftingVisualIds(targetIds);
    setDraftingAllVisuals(true);
    let landed = false;                          // did any spec actually land?
    try{
      // (2026-10-12, Character fidelity step 2) read the script first for the targets with no fact sheet (or an out-of-date
      // one) — one batch for all of them — so each look is drafted from what the screenplay states
      let drafting = targets;
      const toRead = (typeof _needsFactRead==="function") ? targets.filter(_needsFactRead) : [];
      if(toRead.length){
        const fp = await readCharacterFacts(toRead, { quiet:true });
        if(!sameFilm()) throw new Error("film switched");
        if(fp) drafting = targets.map(c=> fp[c.id] ? { ...c, ...fp[c.id] } : c);
      }
      const map = await aiCastVisualBible(drafting, scenes, lbProject("characters"), { scenes, drafts });
      if(!sameFilm()) throw new Error("film switched");
      // merge ONLY the targeted (undrafted) characters — never touch the rest. Re-checked at apply
      // time: a card that got a spec while the model was out (a hand edit, or an agent's draft) keeps it.
      if(map){
        const allow = new Set(targetIds);
        landed = targetIds.some(id=>map[id]);
        setCharacters(cs=>cs.map(c=> (allow.has(c.id) && map[c.id] && !drafted(c)) ? {...c, ...map[c.id]} : c));
      }
      // continuity (if applicable): add suggested appearance states, dedup by label, never remove
      if(typeof aiSuggestStates==="function"){
        const results = await Promise.all(targets.map(async c=>{
          const driven = scenes.filter(s=>s.driver===c.id);
          // (2026-10-12, Character fidelity step 3) every scene the character is in, not only the ones they drive —
          // a character in no scene still gets no call
          const appears = (typeof scenesWhereCharacterAppears==="function") ? scenesWhereCharacterAppears(c.id, c.name, scenes, drafts) : driven.map(s=>s.id);
          if(!driven.length && !appears.length) return { id:c.id, states:null };
          try{ return { id:c.id, states: await aiSuggestStates(c, driven, project, { scenes, drafts }) }; }
          catch(e){ return { id:c.id, states:null }; }
        }));
        const add = {}; results.forEach(r=>{ if(r.states && r.states.length) add[r.id]=r.states; });
        if(Object.keys(add).length && sameFilm()){
          setCharacters(cs=>cs.map(c=>{
            const sug = add[c.id]; if(!sug) return c;
            const existing = c.states || [];
            const have = new Set(existing.map(s=>(s.label||"").trim().toLowerCase()));
            const adds = sug.filter(s=>!have.has((s.label||"").trim().toLowerCase()));
            return adds.length ? {...c, states:[...existing, ...adds]} : c;
          }));
        }
      }
      // (each drafted card records its own Lookbook; nothing is marked when the model returned nothing — 2026-10-06)
    }catch(e){}
    setDraftingAllVisuals(false);
    setDraftingVisualIds([]);
    return landed && sameFilm();
  };

  // ---- Art Room: LOOKBOOK (References) ----
  // every Lookbook card change checks the role itself, not only the room's inert (2026-10-09, owner — Art Room review)
  const updateLookbookCard = (id,patch)=> canMutateSharedFilm() && setLookbook(ls=>ls.map(c=>{
    if(c.id!==id) return c;
    const next={...c,...patch};
    if(c.autoNamed && !Object.prototype.hasOwnProperty.call(patch,"source")
      && (Object.prototype.hasOwnProperty.call(patch,"category") || Object.prototype.hasOwnProperty.call(patch,"note"))){
      next.source = (typeof window.lookbookDefaultName==="function")
        ? window.lookbookDefaultName(next) : ((next.category||"Visual")+" study");
    }
    return next;
  }));
  // create ONE owned prop card from a character-card item bullet that never got a
  // card derived (e.g. a character added after "Design all props" ran) — same shape
  // derivePropsFromCast builds, so the linked-prop row claims it by exact name.
  const createOwnedProp = (charId, itemText, sourceKind)=>{
    const ch = characters.find(x=>x.id===charId); if(!ch) return null;
    const item = String(itemText||"").trim(); if(!item) return null;
    const kind = ((typeof classifyPropKind==="function") && classifyPropKind(item)) || sourceKind || "carried";
    const slug = (typeof window.propSlug==="function") ? window.propSlug(item)
      : item.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,40);
    const card = { id:"prop-"+(ch.id||"x")+"-"+kind+"-"+slug+"-"+Date.now().toString(36),
      name:item, kind, ownerId:ch.id, ownerName:ch.name||"", fromCast:true,
      origin:(typeof artRoomPropOrigin==="function") ? artRoomPropOrigin(kind,"character")
        : {kind:(kind==="worn"||kind==="accessory")?"costume":"props"} };
    setProps(ps=> ps.some(x=>x.id===card.id) ? ps : [...ps, card]);
    return card;
  };
  const addLookbookCard = ()=>{
    if(!canMutateSharedFilm()) return null;
    const id = "look-"+Date.now().toString(36);
    setLookbook(ls=>[...ls, { id, source:"Palette study", category:"Palette", note:"", negativePrompt:"", manual:true, autoNamed:true }]);
    return id;
  };
  /* RECENTLY DELETED (2026-10-03): a deleted reference keeps its card and mood frame, marked
     deletedAt (lookbook.jsx lookbookLive), until you restore it or delete it forever */
  const deleteLookbookCard = (id)=>{
    if(!canMutateSharedFilm()) return;
    setLookbook(ls=>ls.map(c=>c.id===id ? { ...c, deletedAt:new Date().toISOString() } : c));
  };
  const restoreLookbookCard = (id)=>{
    if(!canMutateSharedFilm()) return;
    setLookbook(ls=>ls.map(c=>{ if(c.id!==id) return c; const { deletedAt, ...live } = c; return live; }));
  };
  /* RESEARCH FROM SCRATCH (2026-10-03): a new statement and new references — the hand-added cards
     stay; the researched ones move to Recently deleted (with their frames) before the run */
  const researchLookbookFresh = async ()=>{
    if(!canMutateSharedFilm()) return;
    if(researchOpen) return;
    const ok = !window.appConfirm || await window.appConfirm({
      title:"Research the look from scratch?",
      body:"The Visual Researcher writes a new visual statement and new references (one writing call). Your hand-added cards stay; the researched ones move to Recently deleted with their mood frames, so you can restore any of them.",
      confirmLabel:"Research from scratch", cancelLabel:"Cancel" });
    if(!ok) return;
    // REPLACED ONLY ON SUCCESS (owner 2026-10-06 — Lookbook review): the old statement and cards stay until
    // the new ones arrive — closing the panel or a failed run used to leave an emptied Lookbook
    lookbookFreshRef.current = true;
    setResearchOpen(true);
  };
  const purgeLookbookCard = async (id)=>{
    if(!canMutateSharedFilm()) return;
    const film0 = projIdRef.current;
    // a live card with the same id keeps its mood frame — only the binned copy goes
    const liveTwin = (lookbook||[]).some(c=>c && c.id===id && !c.deletedAt);
    // a failed delete says so and keeps the card in Recently deleted, so it can be retried (2026-10-06)
    try{ if(!liveTwin && typeof nbClearAsset==="function") await nbClearAsset(id); }
    catch(e){ if(typeof window.appToast==="function") window.appToast("Couldn't delete that mood frame just now \u2014 it stays in Recently deleted; try again in a moment.","error"); return; }
    if(projIdRef.current!==film0) return;   // never touches the film opened meanwhile
    setLookbook(ls=>ls.filter(c=>!(c.id===id && c.deletedAt)));
  };
  /* SUGGEST A NOTE (2026-10-03): one writing call drafts a card's "what to borrow" note from the
     story — and its touchstone when you added the card by hand and haven't named one */
  const [suggestingLookbookId, setSuggestingLookbookId] = React.useState(null);
  const suggestLookbookNote = async (id)=>{
    if(!canMutateSharedFilm()) return;
    const card = (lookbook||[]).find(c=>c.id===id);
    if(!card || typeof window.aiSuggestLookbookNote!=="function") return;
    setSuggestingLookbookId(id);
    try{
      const r = await window.aiSuggestLookbookNote(card, scenes, project, lookbookNote, (typeof lookbookLive==="function" ? lookbookLive(lookbook) : lookbook));
      if(!r || !r.note){ if(typeof window.appToast==="function") window.appToast("Couldn't suggest a note just now — try again in a moment.","error"); return; }
      const patch = { note:r.note, ...(r.writingProvenance ? { writingProvenance:r.writingProvenance } : {}) };
      if(card.autoNamed && r.source) Object.assign(patch, { source:r.source, autoNamed:false });
      setLookbook(ls=>ls.map(c=>c.id===id ? { ...c, ...patch } : c));
    } finally { setSuggestingLookbookId(null); }
  };
  // ---- Art Room: PROPS ----
  const updateProp = (id,patch)=>{
    if(!canMutateSharedFilm()) return;   // edit rights (2026-10-08) — background fixes on the tab no-op for viewers too
    // RENAME SYNC (prop card → character): renaming a prop in the Props tab also renames
    // the matching worn/carried bullet on its owner's character card, so the two never drift.
    if(patch && Object.prototype.hasOwnProperty.call(patch,"name")){
      const prev = (props||[]).find(p=>p.id===id);
      if(prev && prev.ownerId && String(prev.name||"").trim() !== String(patch.name||"").trim()){
        syncCharBulletRename(prev.ownerId, prev.name, patch.name);
      }
    }
    setProps(ps=>ps.map(p=>p.id===id?{...p,...patch}:p));
  };
  const [draftingPropId, setDraftingPropId] = React.useState(null);
  // per-card prop drafts run CONCURRENTLY (mirrors characters/locations)
  const [draftingPropIds, setDraftingPropIds] = React.useState([]);
  const draftingPropIdsRef = React.useRef([]); draftingPropIdsRef.current = draftingPropIds;
  const [draftingAllProps, setDraftingAllProps] = React.useState(false);
  // "No props in this story" (2026-09-27, owner-approved — docs/Story Pipeline.md step 9): with no
  // props at all, this explicit mark is what unlocks the Locations tab (see app/art-tab-locks.js).
  // It lives on `project` (saved per film / episode, merged key by key, writable by the owner and
  // the Art director) and only an Art Room-writing role can set or clear it. Stored as a boolean,
  // never deleted, so the key-wise project merge carries an Undo like any other change.
  const setNoPropsConfirmed = (on)=>{
    if(!canMutateSharedFilm()) return;
    setProject(p=> (!!(p && p.noPropsConfirmed)===!!on) ? p : ({ ...p, noPropsConfirmed:!!on }));
  };
  const addProp = ()=>{
    if(!canMutateSharedFilm()) return;
    const id = "prop-"+Date.now().toString(36);
    setProps(ps=>[...ps, { id, name:"New prop", kind:"carried", ownerId:"", ownerName:"",
      form:"", material:"", detail:"", renderStyle:"", negativePrompt:"", manual:true,
      origin:(typeof artRoomPropOrigin==="function") ? artRoomPropOrigin("carried","manual") : {kind:"manual"} }]);
  };
  const importScreenplayProps = (decisions)=>{
    if(!canMutateSharedFilm()) return;
    const next=window.PropScreenplay.accept(propsRef.current,decisions,draftsRef.current);
    setProps(next.map(p=>Array.isArray(p.scenes)?withEpisodeSceneRefs(p,p.scenes,scenesRef.current):p));
  };
  const deleteProp = (id)=>{
    if(!canMutateSharedFilm()) return;
    const p = (props||[]).find(x=>x.id===id); if(!p) return;
    setProps(ps=>ps.filter(x=>x.id!==id));
    setTrash(t=>({ ...t, props:[ _trashStamp(p), ...(t.props||[]).filter(x=>x.id!==id) ] }));
  };
  const restoreProp = (id)=>{
    if(!canMutateSharedFilm()) return;
    const item = (trash.props||[]).find(x=>x.id===id); if(!item) return;
    // a live card with the same id is already on the board — say so (it used to do nothing, silently)
    if((props||[]).some(p=>p.id===id)){
      if(typeof window.appToast==="function") window.appToast("\u201c"+(item.name||"This prop")+"\u201d is already on the board, so the copy in Recently deleted stays there.","info");
      return;
    }
    const { _deletedAt, ...clean } = item;
    setProps(ps=> ps.some(p=>p.id===id) ? ps : [...ps, clean]);
    setTrash(t=>({ ...t, props:(t.props||[]).filter(x=>x.id!==id) }));
  };
  const purgeProp = async (id)=>{
    if(!canMutateSharedFilm()) return;
    const item = (trash.props||[]).find(x=>x.id===id);
    if(!item) return;
    try{
      // never the sheet of a LIVE card with the same id (2026-10-08) — only the binned copy's own images,
      // including the state variants its story events point to (they used to stay behind)
      const live = (props||[]).some(p=>p && p.id===id);
      if(typeof nbClearAsset==="function" && !live){
        // ...but never a variant a LIVE card's story events still point to (a merge copies them over)
        const usedLive = new Set((props||[]).flatMap(p=> (p && Array.isArray(p.continuityEvents) ? p.continuityEvents : []).map(ev=>ev && ev.referenceAssetId).filter(Boolean)));
        const ids = Array.from(new Set([id, ...(item.states||[]).map(st=>id+":"+st.id),
          ...((item.continuityEvents||[]).map(ev=>ev && ev.referenceAssetId).filter(Boolean))])).filter(x=> x===id || !usedLive.has(x));
        for(const assetId of ids) await nbClearAsset(assetId);
      }
      setTrash(t=>({ ...t, props:(t.props||[]).filter(x=>x.id!==id) }));
    }catch(e){ if(window.appToast) window.appToast("Couldn't permanently delete this prop's assets. It stays in Recently deleted so you can try again.","error"); }
  };
  // merge a set of duplicate prop cards (same owner + same object) into ONE: keep the
  // richest card (most scenes, then one with a generated sheet, then longest name),
  // union the scene coverage, backfill any empty spec fields from the others, and
  // delete the rest. Non-destructive to the survivor's own image/spec.
  const mergeProps = async (ids, survivorId)=>{
    if(!canMutateSharedFilm()) return;
    const set = (props||[]).filter(p=> ids.indexOf(p.id)>=0);
    if(set.length<2) return;
    const hasImg = (id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false;
    const score = (p)=> ((p.scenes||[]).length*100) + (hasImg(p.id)?40:0) + Math.min((p.name||"").length,30);
    // the user can pick which card survives (its art + spec win); otherwise keep the richest.
    const survivor = (survivorId && set.find(p=>p.id===survivorId)) || set.slice().sort((a,b)=> score(b)-score(a))[0];
    const others = set.filter(p=>p.id!==survivor.id);
    // union scenes (only if scene-mapping has happened on any of them)
    const anyScenes = set.some(p=>p.scenes!==undefined);
    const scenesU = anyScenes ? Array.from(new Set(set.flatMap(p=>p.scenes||[]))) : survivor.scenes;
    // backfill empty spec fields from the others
    const patch = { };
    if(currentShowId && currentProjectId && window.turnSeries
      && typeof window.turnSeries.mergeEntitySceneRefs==="function")
      Object.assign(patch,window.turnSeries.mergeEntitySceneRefs(set,survivor,currentProjectId));
    else if(anyScenes) patch.scenes = scenesU;
    ["form","material","detail","renderStyle","contentNotes","contentVersion","identityNote","provenance","signatureFeature","size"].forEach(f=>{
      if(!String(survivor[f]||"").trim()){ const donor = others.find(o=>String(o[f]||"").trim()); if(donor) patch[f]=donor[f]; }
    });
    /* MERGE KEEPS EVERYTHING (owner 2026-10-08 — Props review): it asks first; the other cards' story
       events, screenplay sources, other names and reference images join the survivor; the other cards go
       to Recently deleted WITH their sheets (it used to delete those for good, at once, without asking);
       and shots that picked one of them by hand now point at the survivor. */
    if(typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Merge "+set.length+" cards into \u201c"+(survivor.name||"this prop")+"\u201d?",
        body:"Its sheet and spec stay; the other card"+(others.length!==1?"s'":"'s")+" story events, screenplay sources, other names and reference images join it, and "
          +(others.length!==1?"those cards move":"that card moves")+" to Recently deleted with "+(others.length!==1?"their":"its")+" sheet"+(others.length!==1?"s":"")+" (restore from there).",
        confirmLabel:"Merge", cancelLabel:"Cancel" });
      if(!ok) return;
    }
    const cat = (k)=>{ const all = [].concat(survivor[k]||[], ...others.map(o=>o[k]||[])); return all.length ? all : undefined; };
    const evs = cat("continuityEvents"); if(evs){ const seenEv = new Set(); patch.continuityEvents = evs.filter(e=>{ const k = e&&e.id; if(!k) return true; if(seenEv.has(k)) return false; seenEv.add(k); return true; }); }
    const srcs = cat("screenplaySources"); if(srcs) patch.screenplaySources = srcs;
    const refsImg = cat("referenceImages"); if(refsImg) patch.referenceImages = refsImg;
    const names = Array.from(new Set([].concat(survivor.aliases||[], ...others.map(o=>[...(o.aliases||[]), o.name||""]))
      .map(x=>String(x||"").trim()).filter(x=>x && x.toLowerCase()!==String(survivor.name||"").trim().toLowerCase())));
    if(names.length) patch.aliases = names;
    const otherIds = others.map(o=>o.id);
    setProps(ps=>ps.map(p=> p.id===survivor.id ? {...p, ...patch} : p).filter(p=> p.id===survivor.id || ids.indexOf(p.id)<0));
    const at = new Date().toISOString();
    setTrash(t=>({ ...t, props:[ ...others.map(o=>({ ...o, _deletedAt:at, mergedInto:survivor.id })), ...(t.props||[]).filter(x=>otherIds.indexOf(x.id)<0) ] }));
    const swap = (list)=> Array.isArray(list) ? Array.from(new Set(list.map(x=> otherIds.indexOf(x)>=0 ? survivor.id : x))) : list;
    setShots(ss=>(ss||[]).map(sh=>{
      if(!sh) return sh;
      const hit = (arr)=> Array.isArray(arr) && arr.some(x=>otherIds.indexOf(x)>=0);
      if(!hit(sh.referencePropIds) && !hit(sh.refOff) && !hit(sh.props)) return sh;
      return { ...sh, referencePropIds:swap(sh.referencePropIds), refOff:swap(sh.refOff), props:swap(sh.props) };
    }));
  };
  // prop card + its generated sheet from the Props tab (the card confirms first).
  // Match on owner + normalised name so it stays in sync with prop-seeding.
  const removeOwnedProp = (charId, itemText)=>{
    const norm = s=> String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40);
    const target = norm(itemText);
    if(!charId || !target) return;
    // SOFT (2026-10-03): the prop cards go to the Props tab's Recently Deleted with their sheets
    // (restorable; "Delete forever" there clears the images) — it used to clear them for good.
    const victims = (props||[]).filter(p=> p.ownerId===charId && norm(p.name)===target);
    if(!victims.length) return;
    const ids = new Set(victims.map(p=>p.id));
    setProps(ps=> ps.filter(p=>!ids.has(p.id)));
    setTrash(t=>({ ...t, props:[ ...victims.map(_trashStamp), ...(t.props||[]).filter(x=>!ids.has(x.id)) ] }));
  };
  const _normPropName = s=> String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40);
  // SELF-HEAL worn↔carried (user ruling 2026-07-14: users never fix this by hand):
  // any SAVED card carrying a misfiled carried object (a bag, a phone, documents
  // filed under worn accessories) is normalised automatically the moment the cast
  // is in state — the item moves to the carried list AND its linked prop card
  // flips kind to "carried", so nothing wrong ever reaches a render. Deterministic
  // and idempotent: after one pass nothing matches, so the effect goes quiet.
  React.useEffect(()=>{
    if(hydratingRef.current || !characters.length) return;
    if(typeof window.turnReclassifyWornCarried!=="function") return;
    const patches = [];
    characters.forEach(c=>{
      const r = window.turnReclassifyWornCarried(c.accessories, c.props);
      if(r.changed) patches.push({ id:c.id, acc:r.acc, props:r.props, moved:r.moved });
    });
    if(!patches.length) return;
    setCharacters(cs=>cs.map(c=>{ const p=patches.find(x=>x.id===c.id);
      return p ? { ...c, accessories:p.acc, props:p.props } : c; }));
    setProps(ps=>ps.map(pr=>{
      if(pr.kind!=="worn") return pr;
      const p = patches.find(x=>x.id===pr.ownerId); if(!p) return pr;
      const prn = _normPropName(pr.name);
      const hit = p.moved.some(m=>{ const mn=_normPropName(m);
        return mn===prn || mn.includes(prn) || prn.includes(mn); });
      return hit ? { ...pr, kind:"carried" } : pr;
    }));
    if(typeof window.appToast==="function")
      window.appToast(patches.length+" character card"+(patches.length>1?"s":"")+" tidied automatically — carried objects (bags, phones, documents) moved off the worn list; their prop cards are now carried-type, listed under Proposed until the screenplay names them or you keep them.","info");
  },[characters, hydrationTick]);
  // COMMA-SPLIT REPAIR (2026-10-05, owner): the old splitter cut items at every comma, so "a steel
  // wristwatch with a cracked, heat-fogged crystal" became two cast-derived prop cards. With the
  // fixed splitter, a character's item that the OLD split cut into pieces gets ONE card again: the
  // first piece's card is renamed to the whole item (its id, spec and sheet kept), and a leftover
  // piece's card goes to Recently Deleted — only if it has no image (one with an image is left for
  // the user, as an orphan the card offers to remove). Idempotent: once repaired nothing matches.
  React.useEffect(()=>{
    // silent gates (never a "read-only" notice from a background repair): loading, or a role that can't save
    if(hydratingRef.current || projectLoadingRef.current || !castAutoDraftWritable || !characters.length || !(props||[]).length) return;
    if(typeof splitPropItems!=="function") return;
    const norm = (x)=> String(x||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    const renames = {}, gone = [];
    characters.forEach(c=>{
      ["accessories","props"].forEach(field=>{
        const text = c[field]; if(!text || /^none$/i.test(String(text).trim())) return;
        const now = splitPropItems(text), was = splitPropItems(text, { legacyComma:true });
        if(now.length>=was.length) return;
        now.forEach(item=>{
          const whole = norm(item);
          const pieces = was.filter(o=> norm(o) && whole.indexOf(norm(o))>=0);
          if(pieces.length<2) return;
          const cards = pieces.map(o=> (props||[]).find(pr=> pr && pr.ownerId===c.id && pr.fromCast && norm(pr.name)===norm(o)) || null);
          const keep = cards.find(Boolean); if(!keep) return;
          if(norm(keep.name)!==whole) renames[keep.id] = item.replace(/^\w/, m=>m.toUpperCase());
          cards.forEach(pr=>{ if(pr && pr!==keep && !(typeof nbGetImage==="function" && nbGetImage(pr.id))) gone.push(pr); });
        });
      });
    });
    const n = Object.keys(renames).length + gone.length;
    if(!n) return;
    const goneIds = new Set(gone.map(x=>x.id));
    setProps(ps=> ps.filter(x=>!goneIds.has(x.id)).map(x=> renames[x.id] ? { ...x, name:renames[x.id] } : x));
    if(gone.length) setTrash(t=>({ ...t, props:[ ...gone.map(_trashStamp), ...(t.props||[]).filter(x=>!goneIds.has(x.id)) ] }));
    if(typeof window.appToast==="function") window.appToast("Repaired "+Object.keys(renames).length+" prop card"+(Object.keys(renames).length===1?"":"s")
      +" that "+(Object.keys(renames).length===1?"was":"were")+" split at a comma"+(gone.length ? " \u2014 "+gone.length+" leftover piece"+(gone.length===1?"":"s")+" moved to Props \u203a Recently Deleted" : "")+".","info");
  },[characters, props, hydrationTick, castAutoDraftWritable]);
  // RENAME SYNC (character bullet → prop card): editing a worn/carried item on a
  // character card renames the matching prop card (keeping its sheet), the mirror of
  // removeOwnedProp. Match on owner + normalised name, same as seeding/removal.
  const renameOwnedProp = (charId, oldText, newText)=>{
    const from = _normPropName(oldText), to = String(newText||"").trim();
    if(!charId || !from || !to) return;
    setProps(ps=>ps.map(p=> (p.ownerId===charId && _normPropName(p.name)===from && p.name!==to) ? {...p, name:to} : p));
  };
  // RENAME SYNC (prop card → character bullet): replace the matching worn/carried item
  // in the owner's accessories/props text, preserving every other item.
  const syncCharBulletRename = (charId, oldName, newName)=>{
    const from = _normPropName(oldName), to = String(newName||"").trim();
    if(!charId || !from || !to) return;
    const replaceIn = (text)=>{
      const items = (typeof splitListItems==="function") ? splitListItems(text) : String(text||"").split(/\s*,\s*/).filter(Boolean);
      let changed=false;
      const next = items.map(it=>{ if(_normPropName(it)===from && it.trim()!==to){ changed=true; return to; } return it; });
      return changed ? ((typeof joinListItems==="function") ? joinListItems(next) : next.join(", ")) : null;
    };
    setCharacters(cs=>cs.map(c=>{
      if(c.id!==charId) return c;
      const a = replaceIn(c.accessories), pr = replaceIn(c.props);
      if(a==null && pr==null) return c;
      return { ...c, ...(a!=null?{accessories:a}:{}), ...(pr!=null?{props:pr}:{}) };
    }));
  };
  /* a DRAFT never overwrites a deliberately PICKED render style: when a card has an
     explicit renderStyleKey (incl. a locked Surprise style), the drafted look-dev
     text is dropped from the patch — otherwise re-drafting a Pixar prop would quietly
     reset its style text to the drafter's photoreal-ish suggestion. */
  const keepPickedStyle = (entity, patch)=>{
    if(!patch || !entity || !entity.renderStyleKey) return patch;
    const rest = { ...patch }; delete rest.renderStyle; return rest;
  };
  const draftPropVisuals = async (pr)=>{
    if(!canMutateSharedFilm() || !(typeof aiPropVisuals==="function")) return;
    if(draftingPropIdsRef.current.indexOf(pr.id)>=0) return;   // this prop already drafting
    setDraftingPropIds(ids=> ids.indexOf(pr.id)>=0 ? ids : [...ids, pr.id]);
    try{
      const res = await aiPropVisuals(pr, characters, lbProject("props"));
      if(res){ updateProp(pr.id, keepPickedStyle(pr, res)); }   // (the card records its own Lookbook — 2026-10-06)
    }catch(e){}
    setDraftingPropIds(ids=> ids.filter(x=>x!==pr.id));
  };
  // "Draft all props" — the full props pipeline in one click:
  //   0) (2026-10-12, owner) the Props tab first runs Extract screenplay props, for review (props.jsx draftAllFlow)
  //   1) SYNC any missing cards from the cast (worn cards; carried items as PROPOSALS, dedup by owner+name)
  //   2) DRAFT every card's spec (form/material/significance/look dev) from the script — never a
  //      proposal (a carried object the screenplay doesn't name: PropScreenplay.isProposal)
  //   3) MAP every card to the scenes it appears in (reviewed sources, worn -> owner
  //      presence, anything the screenplay hasn't established -> scenes whose text
  //      names it; deterministic, no model call)
  // ONLY WHAT'S MISSING (2026-10-03, owner — Props review): Draft all specifications drafts the cards
  // with no spec yet — it used to rewrite EVERY card, hand edits included, and pay again for each.
  // "Redraft all…" (mode "redraft") asks first, then redrafts every card. A failure is said out loud.
  const draftAllProps = async (mode)=>{
    if(!canMutateSharedFilm() || draftingAllProps) return;
    const redraft = mode==="redraft";
    const _isProposal = (p)=> !!(window.PropScreenplay && window.PropScreenplay.isProposal && window.PropScreenplay.isProposal(p));
    if(redraft){
      const n = (props||[]).filter(p=>!_isProposal(p)).length;
      const ok = typeof window.appConfirm!=="function" || await window.appConfirm({
        title:"Redraft all "+n+" prop specification"+(n!==1?"s":"")+"?",
        body:"Every prop's design is written again from the script and the cast \u2014 replacing the current specs, including your edits. Images are left as they are. This uses writing credits for every card.",
        confirmLabel:"Redraft all", danger:true });
      if(!ok) return;
    }
    setDraftingAllProps(true);
    try{
      // 1) sync from cast
      let working = props;
      if(typeof propsFromCast==="function"){
        const derived = propsFromCast(characters, [...(props||[]), ...((trash&&trash.props)||[])], scenes, drafts);   // (never one in Recently deleted)
        if(derived.length){ working = [...props, ...derived]; setProps(working); setPropsSeeded(true); }
      }
      // 2) draft specs
      const toDraft = (redraft ? working
        : working.filter(p=> !(typeof propVisualsDrafted==="function" ? propVisualsDrafted(p) : (String(p.form||"").trim() && String(p.material||"").trim()))))
        .filter(p=>!_isProposal(p));
      if(typeof aiDesignPropBible==="function" && toDraft.length){
        const map = await aiDesignPropBible(toDraft, characters, lbProject("props"));
        if(!map) throw new Error("no specs came back");
        if(map){ working = working.map(p=> map[p.id] ? {...p, ...keepPickedStyle(p, map[p.id])} : p);
          setProps(ps=>ps.map(p=> map[p.id] ? {...p, ...keepPickedStyle(p, map[p.id])} : p)); }
      }
      // 3) map scenes
      if(typeof propSceneMap==="function" && working.length){
        const smap = await propSceneMap(working, scenes, drafts, characters);
        const lexical = (p)=> !Array.isArray(p.screenplaySources) && (p.kind||"carried")!=="worn";
        if(smap) setProps(ps=>ps.map(p=> smap[p.id]
          ? withEpisodeSceneRefs(lexical(p) ? {...p, sceneMapBasis:"lexical"} : p, smap[p.id], scenes) : p));
      }
      // (each drafted card records its own Lookbook; the department isn't marked — 2026-10-06)
    }catch(e){
      if(typeof window.appToast==="function") window.appToast("Couldn't draft the prop specifications ("+((e&&e.message)||"error")+"). Nothing was overwritten \u2014 try again.","error");
    }
    setDraftingAllProps(false);
  };
  // Pull standalone prop cards out of the cast's existing "Props & accessories"
  // fields (worn -> kind "worn", carried -> kind "carried"). Dedups against
  // what's already in the tab, so it's safe to call repeatedly.
  const seedPropsFromCast = React.useCallback(()=>{
    if(typeof propsFromCast!=="function") return;
    const derived = propsFromCast(characters, [...(props||[]), ...((trash&&trash.props)||[])], scenes, drafts);
    setPropsSeeded(true);
    if(derived.length) setProps(ps=>[...ps, ...derived]);
  },[characters, props, trash]);
  // auto-seed once per story: when you first open the Art Room with an empty
  // Props tab while the cast already carries items, fill it from them. Never behind a LOCKED
  // Props tab (it shows only its lock card): seeding there would add cards the user never saw,
  // and a tab with content is never locked, so the lock would vanish on its own.
  React.useEffect(()=>{
    if(propsSeeded || hydratingRef.current) return;
    if(room!=="art" || artView!=="props") return;
    if(artTabLocked("props")) return;
    if(props.length) { setPropsSeeded(true); return; }   // user already has props -> don't auto-pull
    if(typeof castHasProps==="function" && castHasProps(characters)) seedPropsFromCast();
  },[room, artView, propsSeeded, props.length, characters, seedPropsFromCast, hydrationTick, artTabLocks]);

  /* MAKE WHAT THIS SCENE NEEDS (2026-10-03, owner — Shots review): the missing reference images a
     scene's frames attach, made in dependency order — location plates (a parent first), then room &
     time plates, then character sheets (a look that isn't written yet is drafted first; a variant
     after its master), then prop sheets (they reference their owner). The Shots scene strip lists
     them and shows the price; anything that can't be made here is named and left to its tab. */
  // (2026-10-09, owner — Breakdown review) THE ART ROOM'S RIGHT, whichever room calls it (a Stage editor could
  // pay for plates and sheets it couldn't save); ONE RUN AT A TIME across the Shots tab, the Breakdown and the
  // Stage; the role is checked again before each image; the result says what really happened
  /* (2026-10-09, owner — Breakdown review) PLAN ONCE, ASK ONCE, RUN THAT PLAN. The plan is built before the
     question — what already exists (storage, not the list's cache), each image's reference count (GPT Image
     charges about a credit a reference), one look per character, the rooms whose layout is reviewed, the owners
     present — the question prices exactly that plan, and the run makes exactly those steps:
       · a look is drafted ONCE per character and reused by its variant; an empty draft is a failed step, never a
         generic sheet (the same for a prop's design);
       · a master that couldn't be made is never made again by its variant: the variant says it needs that sheet;
       · a billing or role refusal stops the run ("Stopped — …"), other errors go on with the next step;
       · a retry (a "no image" answer asked once more) is said in the result — a refused image isn't charged
         (image-proxy releases the hold), its second try is;
       · a film switch stops it after every await, and nothing is sent or written after one;
       · another window making the same scene is told so (a lock with a heartbeat);
       · on a film shared with you the question says the owner pays, within your monthly budget.
     Items the plan can't make are not priced, and are named — in the question and in the result: a carried prop
     with no owner or one the screenplay doesn't establish (owner decision C, as the Props tab's batch), a room
     without a reviewed layout, a place whose location card is gone. */
  const sceneNeedsBusyRef = React.useRef(false);   // one run at a time, every tab
  const sceneNeedsAskingRef = React.useRef(false); // its question (and the plan before it) is open
  /* ONE MAKE PROGRESS FOR THE WHOLE APP: {sceneId, sceneNo, scope, i, total, label, filmId, filmTitle} while a run
     makes images (null otherwise) — the Breakdown, Shots and the Stage show the running state from it, whichever
     of them started the run. Read it with window.turnSceneNeedsProgress(); "turn-scene-needs-progress" says when
     it changes (detail = the same object). */
  const sceneNeedsProgressRef = React.useRef(null);
  const setSceneNeedsProgress = (p)=>{
    sceneNeedsProgressRef.current = p ? { ...p } : null;
    try{ window.dispatchEvent(new CustomEvent("turn-scene-needs-progress",{ detail:sceneNeedsProgressRef.current ? { ...sceneNeedsProgressRef.current } : null })); }catch(e){}
  };
  window.turnSceneNeedsProgress = ()=> sceneNeedsProgressRef.current ? { ...sceneNeedsProgressRef.current } : null;
  // ANOTHER WINDOW (2026-10-09): a lock per film + scene, with a heartbeat — a window closed mid-run frees it after 20 s
  const SCENE_NEEDS_LOCK_MS = 20000;
  const sceneNeedsLockKey = (filmId, sceneKey)=> "turn_scene_needs_lock:"+String(filmId||"local")+":"+String(sceneKey==null?"":sceneKey);
  const sceneNeedsWindowId = ()=> (window.__turnWindowId = window.__turnWindowId || (Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10)));
  const sceneNeedsLockHeld = (key)=>{ try{ const v = JSON.parse(localStorage.getItem(key)||"null");
    return !!(v && v.owner!==sceneNeedsWindowId() && Date.now()-Number(v.at||0) < SCENE_NEEDS_LOCK_MS); }catch(e){ return false; } };
  const sceneNeedsLockTake = (key)=>{ try{ localStorage.setItem(key, JSON.stringify({ owner:sceneNeedsWindowId(), at:Date.now() })); }catch(e){} };
  const sceneNeedsLockFree = (key)=>{ try{ const v = JSON.parse(localStorage.getItem(key)||"null");
    if(v && v.owner===sceneNeedsWindowId()) localStorage.removeItem(key); }catch(e){} };
  // A REFUSAL STOPS THE RUN (owner decision F): every billing or role answer (app/plans.jsx turnBillingError codes —
  // insufficient, no_plan, budget_reached, owner_insufficient, owner_plan, film_role, film_access, team_paused,
  // account_frozen…); a bad request or an engine the server doesn't allow isn't one, so the next step still runs
  const SCENE_NEEDS_GO_ON = ["model_not_allowed","bad_request"];
  const sceneNeedsRefusal = (e, seen)=>{
    const code = String((e && e.billing) || (seen && seen.code) || "").toLowerCase().trim();
    if(!code || SCENE_NEEDS_GO_ON.indexOf(code)>=0) return null;
    const known = (typeof window.turnBillingError==="function") ? window.turnBillingError({ code }, 0) : null;
    const msg = (e && e.billing && e.message) || (known && known.message) || "This couldn't be charged right now.";
    return { code, message:String(msg).trim() };
  };
  /* WHAT THE PLAN CAN'T MAKE, AND WHY ("" = it can) — the plan and the Stage's count (turnSceneNeedsImageCount)
     share it, so the button, its price chip and the question agree */
  const sceneNeedsWhyNot = (n, L)=>{
    const id = String(n.id);
    if(n.kind==="location"){
      const reviewed = (l)=>{ try{ if(typeof requireLocationSpatialPlan==="function") requireLocationSpatialPlan(l); return true; }catch(e){ return false; } };
      if(/^locunit-/.test(id)){
        const u = L.units.find(x=> typeof sluglineUnitImageId==="function" && sluglineUnitImageId(x.key)===id);
        const owner = u && L.locByKey(u.subspaceKey||u.locationKey||"");
        if(!u || !owner) return "needs its location card \u2014 the place it belongs to is gone (Locations)";
        if(!reviewed(owner)) return "needs "+(owner.name||"its location")+"'s set layout reviewed (Locations)";
        return "";
      }
      const l = L.locById(id);
      if(!l) return "its location card is gone (Locations)";
      if(l.parentKey && typeof locationParentOf==="function" && !locationParentOf(l, L.locList)) return "needs its parent location restored (Locations)";
      if(!reviewed(l)) return "needs its set layout reviewed (Locations)";
      return "";
    }
    if(n.kind==="character"){
      const [cid, sid] = id.split(":");
      const c = L.chars.find(x=>x && x.id===cid);
      if(!c) return "isn't in the cast any more (Characters)";
      if(sid && !(c.states||[]).some(x=>x && x.id===sid)) return "its appearance state is gone (Characters)";
      return "";
    }
    if(n.kind==="prop"){
      const p = L.props.find(x=>x && x.id===(n.baseId||n.id));
      if(!p) return "its prop card is gone (Props)";
      if((p.kind||"carried")==="carried" && !p.ownerId) return "needs an owner (Props)";
      const PS = window.PropScreenplay;
      if(PS && typeof PS.isProposal==="function" && PS.isProposal(p)) return "is a proposal the screenplay doesn't name (Props)";
      if(PS && typeof PS.notInScreenplay==="function" && L.extracted && (p.kind||"carried")!=="worn" && !p.proposalAccepted && PS.notInScreenplay(p)) return "isn't in the screenplay (Props)";
      return "";
    }
    return "can't be made here";
  };
  const sceneNeedsLookup = ()=>{
    const C = window.turnContinuity || {};
    const live = (ref, v)=> (ref && Array.isArray(ref.current) && ref.current.length) ? ref.current : (v||[]);
    const locs = live(typeof locationsRef!=="undefined" ? locationsRef : null, locations);
    const chars = live(typeof charactersRef!=="undefined" ? charactersRef : null, characters);
    const prs = live(typeof propsRef!=="undefined" ? propsRef : null, props);
    return { units:C.sluglineUnits||[], locList:locs, chars, props:prs,
      locById:(id)=> locs.find(l=>l && l.id===id) || null,
      locByKey:(k)=> locs.find(l=>l && String(l.key||"")===String(k||"")) || null,
      extracted: prs.some(p=> p && (p.screenplaySources||[]).length) };
  };
  // the number of images a run of these needs makes, as the question will count it (the storage check aside)
  window.turnSceneNeedsImageCount = (needs)=>{
    const L = sceneNeedsLookup();
    const ok = (needs||[]).filter(n=> n && n.makeable!==false && !sceneNeedsWhyNot(n, L));
    return (typeof window.sceneNeedsImageCount==="function") ? window.sceneNeedsImageCount(ok) : ok.length;
  };
  const makeSceneNeeds = async (scene, needs, onProgress, opts)=>{
    const o = opts || {};
    if(!Array.isArray(needs) || !needs.length) return { status:"nothing" };
    if(projectLoadingRef.current){ _projectLoadingNotice(); return { status:"refused" }; }
    if(artRoomReadOnlyRef.current){ _mutationNotice("art"); return { status:"refused" }; }
    const toast = (m, k)=>{ if(typeof window.appToast==="function") window.appToast(m, k); };
    if(sceneNeedsBusyRef.current){ toast("Another scene is making its images \u2014 one at a time.","info"); return { status:"busy" }; }
    if(sceneNeedsAskingRef.current) return { status:"busy" };   // its question is already open
    const _film = ()=> String((typeof projIdRef!=="undefined" && projIdRef && projIdRef.current) || "");
    const film0 = _film();
    const filmTitle0 = ((typeof projectsRef!=="undefined" && projectsRef && (projectsRef.current||[]).find(p=>p && p.id===film0)) || {}).title
      || (project && project.title) || "";
    const sceneKey = scene && (scene.id!=null ? scene.id : scene.no);
    const lockKey = sceneNeedsLockKey(film0, sceneKey);
    if(sceneNeedsLockHeld(lockKey)){ toast("This scene's needs are already being made in another window.","info"); return { status:"busy" }; }
    const isClip = o.scope==="clip";
    const tag = isClip ? "This clip" : "Scene "+String((scene&&scene.no)||"").padStart(2,"0");
    const epoch0 = (typeof nbEpoch==="function") ? nbEpoch() : null;
    // a film switch, a new asset scope or a role that lost the Art Room: the run stops, nothing more is sent or written
    const stale = ()=> (typeof nbEpoch==="function" ? nbEpoch() : null)!==epoch0 || !!artRoomReadOnlyRef.current || _film()!==film0;
    const retried = [];   // images that needed a second (paid) try — said in the result
    let cur = null;       // the step running now
    const emit = (m)=>{ if(m && m.k==="observe" && /once more/i.test(String(m.t||"")) && cur) retried.push(cur.label); };
    const mk = (artAgentCtxFactoryRef && artAgentCtxFactoryRef.current) || artAgentCtxFactory;
    const ctx0 = mk({ input:"", emit, propose:null, agentName:"Scene needs", force:false, cancelled:stale });
    const cast = ctx0 && ctx0.art && ctx0.art.cast;
    // the run's film-guarded setters (artAgentCtxFactory's inFilm: refused after a film switch or a lost role)
    const W = (ctx0 && ctx0.art && ctx0.art.writes) || {};
    const save = (name, fn)=>{ if(!stale() && typeof W[name]==="function") W[name](fn); };
    const L = sceneNeedsLookup();
    if(ctx0 && ctx0.art && ctx0.art.locscout && Array.isArray(ctx0.art.locscout.list) && ctx0.art.locscout.list.length){
      const ls = ctx0.art.locscout.list; L.locList = ls;
      L.locById = (id)=> ls.find(l=>l && l.id===id) || (locations||[]).find(l=>l && l.id===id) || null;
      L.locByKey = (k)=> ls.find(l=>l && String(l.key||"")===String(k||"")) || (locations||[]).find(l=>l && String(l.key||"")===String(k||"")) || null;
    }
    const has = async (id)=> !!(await _imgOf(id));
    // the likeness photos each character sheet sends (the ONE RULE, 2026-10-10 — Likeness review): the photos that
    // really go — none when the likeness can't be used here (a shared film), which the question then says
    const lkUnavailable = [];
    const cameoCount = async (cid)=>{
      if(typeof window.turnLoadLikeness==="function"){
        let lk = null; try{ lk = await window.turnLoadLikeness(cid); }catch(e){ lk = null; }
        if(lk && lk.unavailable){ const ch = (L.chars||[]).find(x=>x && x.id===cid) || null;
          const t = (typeof window.turnLikenessUnavailableText==="function") ? window.turnLikenessUnavailableText(cid, ch && ch.name) : "";
          if(t && lkUnavailable.indexOf(t)<0) lkUnavailable.push(t); }
        return (lk && lk.usable) ? lk.angles.length : 0;
      }
      let a = [];
      if(typeof nbGetCameoAngles==="function"){ try{ a = nbGetCameoAngles(cid)||[]; }catch(e){} }
      if(!a.length && typeof nbLoadCameoAngles==="function"){ try{ a = (await nbLoadCameoAngles(cid))||[]; }catch(e){} }
      return a.length; };
    const fail = (why)=>({ fail:why }), skip = (why)=>({ skip:why });

    // ---- THE PLAN ----
    sceneNeedsAskingRef.current = true;
    const steps = [], blocked = [], already = [];
    const planned = new Set();   // ids this run makes
    const writing = { looks:0, specs:0, views:0 };
    try{
      const needNo = (n, why)=> blocked.push((n.label||n.name||n.id)+" \u2014 "+why);
      // location plates, a parent first
      const locNeeds = needs.filter(n=>n.kind==="location" && !/^locunit-/.test(String(n.id)));
      const masters = [];
      locNeeds.forEach(n=>{ const why = sceneNeedsWhyNot(n, L); if(why) needNo(n, why); else masters.push(L.locById(n.id)); });
      const ordered = (typeof locationGenerationOrder==="function") ? locationGenerationOrder(masters) : masters;
      for(const l of ordered){
        const label = l.name||"Location";
        if(await has(l.id)){ already.push(label); continue; }
        const parent = (typeof locationParentOf==="function") ? locationParentOf(l, L.locList) : null;
        if(parent && !planned.has(parent.id) && !(await has(parent.id))){ needNo({ label }, "needs "+(parent.name||"its parent location")+"'s plate first (Locations)"); continue; }
        const rc = (typeof window.locationPlateRefCount==="function") ? window.locationPlateRefCount(l) : { n:6, exact:false };
        const view = !(typeof stagingHasContent==="function" ? stagingHasContent(l) : true);
        if(view) writing.views++;
        planned.add(l.id);
        steps.push({ id:l.id, kind:"location", label, refs:rc.n, refsExact:rc.exact, run:async ()=>{
          if(await has(l.id)) return "exists";   // made meanwhile (another tab): never paid for twice
          if(stale()) return "stopped";
          const ok = await window.generateLocationPlate(l, project, { draftStaging:true, cancelled:stale,
            onRetry:()=>retried.push(label),
            // the view composition is saved to the film it was written for, or not at all
            onStaged:(id, st)=>{ save("setLocations", ls=>ls.map(x=>x.id===id ? { ...x, staging:st } : x)); } });
          if(stale()) return "stopped";
          return ok ? "made" : fail("the plate couldn't be made"); } });
      }
      // room & time plates, after their location's plate
      for(const n of needs.filter(n=>n.kind==="location" && /^locunit-/.test(String(n.id)))){
        const why = sceneNeedsWhyNot(n, L); if(why){ needNo(n, why); continue; }
        const u = L.units.find(x=> sluglineUnitImageId(x.key)===n.id);
        const owner = L.locByKey(u.subspaceKey||u.locationKey||"");
        const label = (u.name||owner.name||"Room")+(u.time?" \u00b7 "+u.time:"");
        if(await has(n.id)){ already.push(label); continue; }
        if(!planned.has(owner.id) && !(await has(owner.id))){ needNo({ label }, "needs "+(owner.name||"its location")+"'s plate first (Locations)"); continue; }
        // the room's parent found by the stored card's parentKey (it has no parentLocation) — 2026-10-14, headless paths
        const rootId = ((typeof locationParentOf==="function" ? locationParentOf(owner, L.locList) : null) || {}).id;
        const rootPlate = rootId ? (planned.has(rootId) || await has(rootId)) : undefined;
        const rc = (typeof window.sluglineUnitPlateRefCount==="function") ? window.sluglineUnitPlateRefCount(owner, u, { rootPlate }) : { n:6, exact:false };
        planned.add(n.id);
        steps.push({ id:n.id, kind:"location", label, refs:rc.n, refsExact:rc.exact, run:async ()=>{
          if(await has(n.id)) return "exists";
          if(stale()) return "stopped";
          const ok = await window.generateSluglineUnitPlate(owner, u, project, { cancelled:stale, onRetry:()=>retried.push(label) });
          if(stale()) return "stopped";
          return ok ? "made" : fail("the plate couldn't be made"); } });
      }
      // character sheets: one look per character, a master before its variants
      const byChar = {}, charOrder = [];
      needs.filter(n=>n.kind==="character").forEach(n=>{
        const why = sceneNeedsWhyNot(n, L); if(why){ needNo(n, why); return; }
        const [cid, sid] = String(n.id).split(":");
        if(!byChar[cid]){ byChar[cid] = { c:L.chars.find(x=>x && x.id===cid), master:null, variants:[] }; charOrder.push(cid); }
        if(sid) byChar[cid].variants.push({ sid, label:n.label||n.id }); else byChar[cid].master = n.label||n.id;
      });
      const drafted = {}, lookFailed = {}, masterUrl = {}, masterFailed = {};
      const needLook = {};
      const STOP = {};
      // the look, drafted ONCE per character in this run and reused by every step after it (bug 1)
      const lookOf = async (cid)=>{
        if(drafted[cid]) return drafted[cid];
        if(lookFailed[cid]) return null;   // never a second paid draft
        let c = sceneNeedsLookup().chars.find(x=>x && x.id===cid) || (byChar[cid] && byChar[cid].c);
        if(!c) return null;
        if(needLook[cid]){
          let patch = null;
          try{ patch = await cast.draftSpec(c); }catch(e){ lookFailed[cid] = true; throw e; }
          if(stale()) return STOP;
          if(!patch){ lookFailed[cid] = true; return null; }   // an empty draft is a failed step, never a generic sheet
          c = { ...c, ...patch };
        }
        drafted[cid] = c; return c;
      };
      const variantSteps = [];
      for(const cid of charOrder){
        const e = byChar[cid], c = e.c, name = c.name||"the character";
        const masterHas = await has(cid);
        const vars = [];
        for(const v of e.variants){ if(await has(cid+":"+v.sid)) already.push(v.label); else vars.push(v); }
        if(e.master && masterHas) already.push(e.master);
        const masterNeeded = !masterHas && (!!e.master || vars.length>0);
        if(!masterNeeded && !vars.length) continue;
        needLook[cid] = typeof window.charVisualsDrafted==="function" && !window.charVisualsDrafted(c);
        if(needLook[cid]) writing.looks++;
        const cameos = await cameoCount(cid);
        if(masterNeeded){
          const excluded = new Set(Array.isArray(c.wornReferenceExclusions)?c.wornReferenceExclusions:[]);
          let worn = 0;
          for(const p of L.props.filter(p=>p && p.ownerId===cid && p.kind!=="carried" && !excluded.has(p.id))) if(await has(p.id)) worn++;
          planned.add(cid);
          const label = e.master || name;
          steps.push({ id:cid, kind:"character", label, refs:worn+cameos, refsExact:true, run:async ()=>{
            if(!cast) throw new Error("character tools unavailable");
            if(await has(cid)) return "exists";
            if(stale()) return "stopped";
            const ch = await lookOf(cid);
            if(ch===STOP || stale()) return "stopped";
            if(!ch){ masterFailed[cid] = true; return fail("couldn't draft the look"); }
            let url = "";
            try{ url = await cast.generateMaster(ch); }catch(err){ masterFailed[cid] = true; throw err; }
            if(url) masterUrl[cid] = url;
            if(stale()) return url ? "made" : "stopped";
            if(!url){ masterFailed[cid] = true; return fail("the sheet couldn't be made"); }
            return "made"; } });
        }
        vars.forEach(v=>{ planned.add(cid+":"+v.sid);
          variantSteps.push({ id:cid+":"+v.sid, kind:"character", label:v.label, refs:1+cameos, refsExact:true, run:async ()=>{
            if(!cast) throw new Error("character tools unavailable");
            if(await has(cid+":"+v.sid)) return "exists";
            // (owner decision E) a master that couldn't be made is never made again here
            if(masterFailed[cid]) return skip("needs "+name+"'s sheet, which couldn't be made");
            if(lookFailed[cid]) return skip("needs "+name+"'s look, which couldn't be drafted");
            if(stale()) return "stopped";
            const ch = await lookOf(cid);
            if(ch===STOP || stale()) return "stopped";
            if(!ch) return fail("couldn't draft the look");
            const st = (ch.states||[]).find(x=>x && x.id===v.sid);
            if(!st) return fail("its appearance state is gone");
            const base = masterUrl[cid] || await _imgOf(cid);
            if(stale()) return "stopped";
            if(!base) return skip("needs "+name+"'s sheet first");   // the plan didn't make it, so it isn't made here
            const url = await cast.generateState(ch, st, base);
            if(stale()) return url ? "made" : "stopped";
            return url ? "made" : fail("the sheet couldn't be made"); } }); });
      }
      variantSteps.forEach(s=>steps.push(s));
      // prop sheets, after their owners (owner decision C: ownerless carried props and props the screenplay
      // doesn't establish are left to the Props tab, as its batch does)
      const seenProps = new Set();
      for(const n of needs.filter(n=>n.kind==="prop")){
        const why = sceneNeedsWhyNot(n, L); if(why){ needNo(n, why); continue; }
        const p0 = L.props.find(x=>x && x.id===(n.baseId||n.id));
        if(seenProps.has(p0.id)) continue; seenProps.add(p0.id);
        const label = p0.name||"Prop";
        if(await has(p0.id)){ already.push(label); continue; }
        const design = !(String(p0.form||"").trim() && String(p0.material||"").trim()) && typeof aiPropVisuals==="function";
        if(design) writing.specs++;
        const ownerSheet = !!p0.ownerId && (planned.has(p0.ownerId) || await has(p0.ownerId));
        const ownerName = (L.chars.find(c=>c && c.id===p0.ownerId)||{}).name || p0.ownerName || "its owner";
        planned.add(p0.id);
        steps.push({ id:p0.id, kind:"prop", label, refs:ownerSheet?1:0, refsExact:true, run:async ()=>{
          if(await has(p0.id)) return "exists";   // made already (the list may have read a cold cache)
          if(p0.ownerId && masterFailed[p0.ownerId]) return skip("needs "+ownerName+"'s sheet, which couldn't be made");
          if(stale()) return "stopped";
          let p = sceneNeedsLookup().props.find(x=>x && x.id===p0.id) || p0;
          if(design){
            const patch = await aiPropVisuals(p, sceneNeedsLookup().chars, lbProject("props"));
            if(stale()) return "stopped";
            if(!patch) return fail("couldn't design the prop");   // an empty design is a failed step, never a generic sheet
            const kept = keepPickedStyle(p, patch); p = { ...p, ...kept };
            save("setProps", ps=>ps.map(x=>x.id===p.id ? { ...x, ...kept } : x));
          }
          let err = "";
          const ok = await window.generatePropSheet(p, lbProject("props"), { cancelled:stale,
            onRetry:()=>retried.push(label), onError:(m)=>{ err = String(m||""); } });
          if(stale()) return ok ? "made" : "stopped";
          return ok ? "made" : fail(err || "the sheet couldn't be made"); } });
      }
    }catch(e){ sceneNeedsAskingRef.current = false; throw e; }   // (the question below keeps it until it is answered)
    const where = o.from==="breakdown" ? "from the Breakdown" : "here";
    const blockedNote = blocked.length ? " Not made "+where+": "+blocked.join("; ")+"." : "";
    if(!steps.length){
      sceneNeedsAskingRef.current = false;
      toast(blocked.length
        ? (o.from==="breakdown" ? "Nothing here can be made from the Breakdown" : "None of these can be made here")
          +" \u2014 "+blocked.join("; ")+". Open its tab (Locations, Characters or Props) to make it."
        : tag+" already has what it needs \u2014 "+already.length+" already there.", "info");
      return { status:"nothing", made:0, already:already.length, failed:0, blocked:blocked.length };
    }
    // ---- THE QUESTION: that plan, at that price ----
    const total = steps.length;
    const each = (refs)=> (typeof window.nbImageCostText==="function") ? Number(window.nbImageCostText(1, { refs })) || 0 : 0;
    let credits = 0, priced = typeof window.nbImageCostText==="function", upTo = false;
    steps.forEach(s=>{ const c = each(s.refs); if(!c) priced = false; credits += c;
      if(!s.refsExact && c!==each(0)) upTo = true; });   // a count only known as a maximum
    if(typeof window.appConfirm==="function"){
      const price = priced && credits ? (upTo ? " \u2014 up to " : " \u2014 about ")+credits+" credit"+(credits===1?"":"s") : "";
      const shared = !!(typeof window.turnFilmPaidByOwner==="function" && window.turnFilmPaidByOwner());
      const B = window.turnFilmBudget;
      const left = (shared && B && B.limit!=null) ? Math.max(0, Math.floor(Number(B.limit)-(Number(B.spent)||0))) : null;
      const payer = shared ? " from the film owner's credits, within your monthly budget on this film"
        +(left!=null ? " ("+left.toLocaleString("en-US")+" left this month)" : "") : "";
      const w = [writing.looks && (writing.looks+" character look"+(writing.looks!==1?"s":"")),
        writing.specs && (writing.specs+" prop design"+(writing.specs!==1?"s":"")),
        writing.views && (writing.views+" view composition"+(writing.views!==1?"s":""))].filter(Boolean);
      let ok = false;
      try{ ok = await window.appConfirm({ title: isClip ? "Make what this clip needs?" : "Make what "+tag+" needs?",
        body: total+" reference image"+(total!==1?"s":"")+price+payer
          +(w.length ? ", plus writing credits to draft "+w.join(", ")+" first" : "")+"."
          +(already.length ? " "+already.length+" already there "+(already.length===1?"is":"are")+" skipped." : "")
          +" An image that comes back empty is asked once more \u2014 only that second try is charged.",
        items:steps.map(x=>x.label), note: ([blocked.length ? "Not made "+where+": "+blocked.join("; ")+"." : "", lkUnavailable.join(" ")]
          .filter(Boolean).join(" ")) || undefined,
        confirmLabel:"Make "+total, cancelLabel:"Cancel" }); }
      finally { sceneNeedsAskingRef.current = false; }
      if(!ok) return { status:"cancelled" };
    }
    sceneNeedsAskingRef.current = false;
    // the answer may come after a switch, a lost role, or another window starting the same scene
    if(stale()){ toast(tag+": nothing was made \u2014 the film or your role changed before it started.","info"); return { status:"stopped", made:0 }; }
    if(sceneNeedsBusyRef.current){ toast("Another scene is making its images \u2014 one at a time.","info"); return { status:"busy" }; }
    if(sceneNeedsLockHeld(lockKey)){ toast("This scene's needs are already being made in another window.","info"); return { status:"busy" }; }
    // ---- THE RUN: exactly those steps ----
    sceneNeedsBusyRef.current = true;
    sceneNeedsLockTake(lockKey);
    const beat = (typeof setInterval==="function") ? setInterval(()=>sceneNeedsLockTake(lockKey), 5000) : null;
    let seenRefusal = null;
    const onCredits = (e)=>{ const d = e && e.detail; if(d && d.reason==="billing-refusal" && d.code && !seenRefusal) seenRefusal = { code:String(d.code) }; };
    try{ if(typeof window.addEventListener==="function") window.addEventListener("turn-credits-changed", onCredits); }catch(e){}
    const made = [], failed = [], notMade = [];
    let existed = 0, stopped = false, refusal = null, ranTo = 0;
    const progress = { sceneId:scene && scene.id, sceneNo:scene && scene.no, scope:isClip ? "clip" : "scene", filmId:film0, filmTitle:filmTitle0 };
    try{
      setSceneNeedsProgress({ ...progress, i:0, total, label:"" });
      if(onProgress) onProgress(0, total, "");   // busy only once you've said yes
      for(let i=0;i<steps.length;i++){
        if(stale()){ stopped = true; break; }
        cur = steps[i]; ranTo = i+1;
        setSceneNeedsProgress({ ...progress, i:i+1, total, label:cur.label });
        if(onProgress) onProgress(i+1, total, cur.label);
        let r;
        try{ r = await cur.run(); }
        catch(e){
          refusal = sceneNeedsRefusal(e, seenRefusal);
          r = refusal ? fail(refusal.message) : fail((e&&e.message)||"error");
        }
        if(!refusal && seenRefusal) refusal = sceneNeedsRefusal(null, seenRefusal);   // a refusal the generator kept to itself
        if(r==="made") made.push(cur.label);
        else if(r==="exists") existed++;
        else if(r && r.skip){ notMade.push(cur.label); failed.push(cur.label+" \u2014 "+r.skip); }
        else if(r && r.fail){ notMade.push(cur.label); if(!refusal) failed.push(cur.label+" \u2014 "+r.fail); }
        else if(r!=="stopped"){ notMade.push(cur.label); failed.push(cur.label+" \u2014 couldn't be made"); }
        if(refusal) break;
        if(r==="stopped" || stale()){ if(r==="stopped") notMade.push(cur.label); stopped = true; break; }
      }
    } finally {
      sceneNeedsBusyRef.current = false;
      if(beat) clearInterval(beat);
      sceneNeedsLockFree(lockKey);
      try{ if(typeof window.removeEventListener==="function") window.removeEventListener("turn-credits-changed", onCredits); }catch(e){}
      setSceneNeedsProgress(null);
    }
    steps.slice(ranTo).forEach(s=>notMade.push(s.label));
    // the film it was made for, when another one is open now
    const filmTag = (_film()!==film0) ? "\u201c"+(filmTitle0||"The other film")+"\u201d \u2014 " : "";
    const retryNote = retried.length ? " "+retried.length+" image"+(retried.length!==1?"s":"")+" needed a second try." : "";
    const list = (a)=> a.length ? a.join(", ") : "nothing";
    if(refusal){
      const sentence = /[.!?]$/.test(refusal.message) ? refusal.message.slice(0,-1) : refusal.message;
      toast(filmTag+tag+": stopped \u2014 "+sentence+". Made: "+list(made)+"; not made: "+list(notMade)+"."+retryNote+blockedNote, "error");
    } else if(stopped){
      toast(filmTag+tag+": stopped \u2014 "+made.length+" of "+total+" made"+(failed.length?", "+failed.length+" couldn't be":"")+"; not made: "+list(notMade)+"."+retryNote+blockedNote, "error");
    } else if(failed.length){
      toast(filmTag+tag+": "+failed.length+" of "+total+" couldn't be made: "+failed.join("; ")+"."+(made.length?" Made: "+list(made)+".":"")+retryNote+blockedNote, "error");
    } else {
      toast(filmTag+(blocked.length
        ? tag+": "+made.length+" reference image"+(made.length!==1?"s":"")+" made"+(existed?", "+existed+" already there":"")+"."
        : tag+" has what it needs \u2014 "+made.length+" reference image"+(made.length!==1?"s":"")+" made"+(existed?", "+existed+" already there":"")+".")
        +retryNote+blockedNote, "info");
    }
    return { status: refusal ? "refused" : stopped ? "stopped" : failed.length ? "partial" : "done",
      made:made.length, already:existed+already.length, failed:failed.length, blocked:blocked.length,
      retried:retried.length, refusal: refusal ? refusal.code : null };
  };
  const wornBuildRef = React.useRef(null);   // the card's "Make N worn-item sheets" (the build below, on demand)
  /* INITIAL CHARACTER -> WORN PROP BOOTSTRAP
     The first committed identity sheet is the best visual seed for accessories that
     belong on that character. Build those prop sheets in the background immediately,
     then let the existing dependency snapshot mark the character master out of date.
     Carried props are deliberately excluded: they bind at the shot where they appear.
     TAB LOCKS: this is the ONE auto-fill that may add prop cards while the Props tab is still
     locked (the other cast members lack a written spec) — Characters come before Props, so the
     owner's committed sheet is exactly the reference these worn props need. Its cards are Props
     content, so Props then opens (a tab with content is never locked — docs/Story Pipeline.md
     step 9); APP_FEATURES says so, so MUSE can explain an early-open Props tab. */
  // NO SILENT SPENDING (2026-10-03, owner — Props review): the background build is OFF unless
  // window.TURN_WORN_PROP_AUTO===true. The character card's "Make N worn-item sheets" button runs the
  // same build on demand (wornBuildRef), with no automatic master re-bake — the card's "Update sheet
  // with new wardrobe" stays the user's choice.
  React.useEffect(()=>{
    window.__turnWornPropBootstrap = window.__turnWornPropBootstrap || {};
    const onCharacterSheetDone = async (e, manual)=>{
      if(!manual && window.TURN_WORN_PROP_AUTO!==true) return;
      const charId = e && e.detail && e.detail.id;
      const character = (characters||[]).find(c=>c && c.id===charId);
      if(!character || !canMutateSharedFilm()) return;
      // nb-gen-done also announces clears/restores. Start only after a real identity
      // image has committed, never from an empty completion event.
      const identityUrl = (e && e.detail && e.detail.url) || await _imgOf(charId);
      if(!identityUrl) return;
      const prior = character.wornPropBootstrap || {};
      if((!manual && prior.status==="complete") || window.__turnWornPropBootstrap[charId]) return;
      // A persisted running flag from an interrupted browser session may retry later.
      if(prior.status==="running" && prior.startedAt
        && Date.now()-new Date(prior.startedAt).getTime()<30*60*1000) return;

      const derived = (typeof propsFromCast==="function")
        ? propsFromCast(characters, [...(props||[]), ...((trash&&trash.props)||[])], scenes, drafts)
          .filter(p=>p && p.ownerId===charId && p.kind==="worn") : [];
      const worn = [...(props||[]).filter(p=>p && p.ownerId===charId && p.kind==="worn"), ...derived]
        .filter((p,i,all)=>all.findIndex(x=>x.id===p.id)===i);
      const startedAt = new Date().toISOString();
      const setBootstrap = (patch)=>setCharacters(cs=>cs.map(c=>c.id===charId
        ? { ...c, wornPropBootstrap:{ ...(c.wornPropBootstrap||{}), ...patch } } : c));

      window.__turnWornPropBootstrap[charId] = true;
      if(derived.length){
        setProps(ps=>{
          const have = new Set(ps.map(p=>p.id));
          return [...ps, ...derived.filter(p=>!have.has(p.id))];
        });
        setPropsSeeded(true);
      }
      setBootstrap({ status:"running", startedAt, completedAt:"", total:worn.length,
        done:0, failedNames:[], source:"initial-character-sheet" });

      if(!worn.length){
        setBootstrap({ status:"complete", completedAt:new Date().toISOString(), total:0, done:0, failedNames:[] });
        delete window.__turnWornPropBootstrap[charId];
        return;
      }

      if(typeof window.appToast==="function") window.appToast(
        "Building "+worn.length+" worn prop reference"+(worn.length===1?"":"s")+" for "+(character.name||"this character")+" in the background.","info");
      // for the hands-free re-bake gate: the sheet identity + film scope AT BATCH START —
      // if either changes while props build, we must not auto-regenerate over the user's work
      let sheetIso0 = "";
      try{ if(typeof nbLoadDetailsAsset==="function"){ const d0=await nbLoadDetailsAsset(charId); sheetIso0=(d0&&d0.meta&&d0.meta.iso)||""; } }catch(e){}
      const epoch0 = (typeof nbEpoch==="function") ? nbEpoch() : null;
      let done=0, built=0, draftedAny=false;
      const failed=[];
      for(const original of worn){
        try{
          if(window.__nbGenInflight && window.__nbGenInflight[original.id]) throw new Error("Already generating");
          if(await _imgOf(original.id)){ done++; setBootstrap({done}); continue; }
          let prop = original;
          const drafted = !!(String(prop.form||"").trim() && String(prop.material||"").trim());
          if(!drafted){
            const visualPatch = (typeof aiPropVisuals==="function")
              ? await aiPropVisuals(prop, characters, lbProject("props")) : null;
            if(!visualPatch) throw new Error("Could not derive the prop specification");
            const keptPatch = keepPickedStyle(prop, visualPatch);
            prop = { ...prop, ...keptPatch };
            draftedAny = true;
            setProps(ps=>ps.map(p=>p.id===prop.id ? { ...p, ...keptPatch } : p));
          }
          if(typeof window.generatePropSheet!=="function") throw new Error("Prop generator unavailable");
          const ok = await window.generatePropSheet(prop, lbProject("props"));
          if(!ok) throw new Error("Prop generation did not complete");
          done++; built++;
          setBootstrap({done});
        }catch(err){ failed.push(original.name||"Worn prop"); }
      }
      // (each drafted card records its own Lookbook — 2026-10-06)
      setBootstrap({ status:failed.length?"attention":"complete", completedAt:new Date().toISOString(),
        total:worn.length, done, failedNames:failed });

      /* HANDS-FREE WARDROBE — a CLEAN batch (every item newly built, sheet untouched
         meanwhile, nothing else generating, same film) re-bakes the master ONCE so it
         actually wears the new props, no manual step. Anything less falls back to the
         character card's one-tap "Update sheet with new wardrobe" action. */
      let sheetIsoNow = sheetIso0;
      try{ if(typeof nbLoadDetailsAsset==="function"){ const d1=await nbLoadDetailsAsset(charId); sheetIsoNow=(d1&&d1.meta&&d1.meta.iso)||""; } }catch(e){}
      const gate = (typeof wornRebakeGate==="function") ? wornRebakeGate({
        total:worn.length, done, failed:failed.length, newlyBuilt:built,
        inflight: !!(window.__nbGenInflight && window.__nbGenInflight[charId]),
        sheetIsoStart:sheetIso0, sheetIsoNow,
        epochStart:epoch0, epochNow:(typeof nbEpoch==="function")?nbEpoch():null,
        canMutate: canMutateSharedFilm(),
      }) : { ok:false, reason:"no-gate" };
      if(gate.ok && !manual){
        if(typeof window.appToast==="function") window.appToast(
          "Worn prop references are ready for "+(character.name||"this character")+" \u2014 updating the master sheet to wear them now.","info");
        /* LOOP PREVENTION: hold the in-memory bootstrap flag through the re-bake so its
           own nb-gen-done cannot restart this pipeline (the persisted status:"complete"
           is the second, durable guard). Register in the shared gen registry with a run
           token + announce the start so a mounted character card shows the spinner and
           a stray click can't start a second generation. */
        if(!window.__nbGenInflight) window.__nbGenInflight = {};
        window.__nbGenRunSeq = (window.__nbGenRunSeq||0)+1;
        const _run = window.__nbGenRunSeq;
        window.__nbGenInflight[charId] = _run;
        try{ window.dispatchEvent(new CustomEvent("nb-gen-start",{ detail:{ id:charId } })); }catch(e){}
        try{
          // go through the LATEST render's factory — this handler's own closure predates
          // the props merged during the batch (see artAgentCtxFactoryRef note)
          const _mkCtx = (artAgentCtxFactoryRef && artAgentCtxFactoryRef.current) || artAgentCtxFactory;
          const agentCtx = _mkCtx({ input:"", emit:()=>{},
            propose:null, agentName:"Wardrobe", force:false,
            // a film switch cancels this background run (the commit is ALSO epoch-guarded)
            cancelled: ()=>(((typeof nbEpoch==="function")?nbEpoch():null)!==epoch0) });
          await agentCtx.art.cast.generateMaster(character, { deriveFromCurrent:true });
        }catch(err){
          try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id:charId } })); }catch(e){}
          // a stale-scope discard (film switched mid-render) is a clean drop — don't
          // toast a scary failure into the film the user is looking at NOW
          if(!/stale scope/i.test(String((err&&err.message)||"")) && typeof window.appToast==="function") window.appToast(
            "Couldn't update "+(character.name||"the character")+"'s sheet automatically \u2014 use \u201cUpdate sheet with new wardrobe\u201d on the character card.","error");
        } finally {
          // ownership re-check after the awaits: a Stop or newer run may own the slot now
          if(window.__nbGenInflight && window.__nbGenInflight[charId]===_run) delete window.__nbGenInflight[charId];
          delete window.__turnWornPropBootstrap[charId];
        }
        return;
      }
      delete window.__turnWornPropBootstrap[charId];
      // stay quiet when nothing changed (every sheet pre-existed and none failed)
      if((built || failed.length) && typeof window.appToast==="function") window.appToast(
        failed.length
          ? (done+" of "+worn.length+" worn prop references were built. The remaining item"+(failed.length===1?" needs":"s need")+" attention.")
          : ("Worn prop references are ready for "+(character.name||"this character")+". Tap \u201cUpdate sheet with new wardrobe\u201d on the character card to lock them in."),
        failed.length?"error":"info");
    };
    // the on-demand carried-prop builder (shot renders) drafts specs OUTSIDE App state —
    // it hands the patch back on this event so the prop card shows what was decided
    const onPropDrafted = (e)=>{
      const d = e && e.detail;
      if(!d || !d.id || !d.patch || !canMutateSharedFilm()) return;
      setProps(ps=>ps.map(p=>p.id===d.id ? { ...p, ...keepPickedStyle(p, d.patch) } : p));
      // (the card records its own Lookbook — a Shots-side draft no longer marks every prop — 2026-10-06)
    };
    wornBuildRef.current = (charId)=> onCharacterSheetDone({ detail:{ id:charId } }, true);
    window.addEventListener("nb-gen-done",onCharacterSheetDone);
    window.addEventListener("nb-prop-drafted",onPropDrafted);
    return ()=>{ window.removeEventListener("nb-gen-done",onCharacterSheetDone);
      window.removeEventListener("nb-prop-drafted",onPropDrafted); };
  },[characters, props, scenes, drafts, project, lookbook, lookbookNote]);

  // SWITCHED OFF 2026-10-03 (owner: no silent spending — a user who wants one scene shouldn't pay to
  // draft the whole cast): this runs only with window.TURN_CAST_AUTO_DRAFT===true; otherwise it just
  // latches visualsSeeded once everyone has a spec. The rules below are kept for that switch.
  // auto-draft the cast once per story — LOOKBOOK FIRST (2026-09-27, owner-approved; docs/Story
  // Pipeline.md step 9). The Lookbook steers the wardrobe, so the silent draft waits until the
  // Lookbook has a look (a visual statement or at least one reference card) and then fires the first
  // time an Art Room tab OTHER than the Lookbook is open — never while the user is still curating it.
  // With the tab locks (app/art-tab-locks.js) that tab is normally Characters: the same look unlocks
  // it, and the tabs after it wait for the cast's specs this draft writes (a remembered later tab
  // shows its lock card, and the draft still runs there). The story build no longer drafts the
  // cast's look (docs/Story Pipeline.md, 2026-09-27), so a New Story film's cast is drafted here too.
  // (It used to run on the first Art Room visit even with an empty Lookbook, so Characters was later
  // flagged "Lookbook changed — re-draft" and the cast was drafted twice.) It never runs while any
  // agent is running (Run pre-production drafts the cast itself; agentRunTick re-checks when runs
  // end), fills only characters with no spec, and never overwrites drafted/edited cards. With no
  // Lookbook nothing is drafted silently: the Characters tab hints, and its Draft all still works.
  // The once-guard is per FILM (a second film opened this session auto-drafts too) and latches only
  // when an attempt actually STARTS — a visit gated out by the rules above never burns it. Only a role
  // that can save the cast runs it (castAutoDraftWritable); a latch is written once per film per
  // session; and a draft still in flight when the user switches films lands nowhere (draftAllVisuals
  // drops it) and re-arms the film it belonged to, instead of latching the film now open.
  const _autoDraftTried = React.useRef({});          // { [film key]: true } — a draft STARTED for this film this session
  const _autoDraftLatched = React.useRef({});        // { [film key]: true } — visualsSeeded latched for it this session
  const _autoDraftKey = castDraftFilmKey();
  React.useEffect(()=>{
    const key = _autoDraftKey;
    const step = turnCastAutoDraftStep({ canWrite:castAutoDraftWritable, room, artView, visualsSeeded,
      hydrating:hydratingRef.current, characters, lookbook, lookbookNote, agentRuns:window.__turnAgentRunCount,
      draftingAll:draftingAllVisuals, tried:!!_autoDraftTried.current[key], latched:!!_autoDraftLatched.current[key],
      drafted:window.charVisualsDrafted, autoDraft:window.TURN_CAST_AUTO_DRAFT===true });
    if(step==="latch"){ _autoDraftLatched.current[key] = true; setVisualsSeeded(true); return; }   // everyone already has a spec
    if(step!=="start") return;
    _autoDraftTried.current[key] = true;
    // latch the per-story flag ONLY when specs actually landed — a failed attempt
    // (model unreachable, cast mid-hydration after a rebuild) used to latch forever
    // and strand the user on a wall of manual draft buttons
    Promise.resolve(draftAllVisuals()).then((ok)=>{
      if(castDraftFilmKey()!==key){ delete _autoDraftTried.current[key]; return; }   // switched films mid-draft
      if(ok){ _autoDraftLatched.current[key] = true; setVisualsSeeded(true); }
    });
  },[castAutoDraftWritable, room, artView, visualsSeeded, characters, lookbook, lookbookNote, agentRunTick, draftingAllVisuals, _autoDraftKey, hydrationTick]);
  /* Deterministic scene remapping (reviewed sources, wearer presence, and the lexical
     map of objects the screenplay hasn't established). Never performs paid extraction
     or removes cards. Missing screenplay evidence is reviewed in the Props tab. */
  const propsRef = React.useRef([]); propsRef.current = props;
  const charactersRef = React.useRef([]); charactersRef.current = characters;
  const tagBusyRef = React.useRef(false);
  tagBusyRef.current = !!draftingAllProps;
  const autoRetagRef = React.useRef(false);
  React.useEffect(()=>{
    if(readOnlyShare) return;
    if(typeof propSceneMap!=="function") return;
    const t = setTimeout(async ()=>{
      if(hydratingRef.current || tagBusyRef.current || autoRetagRef.current) return;
      const pinned = (propsRef.current||[]).filter(p=> p && Array.isArray(p.scenes)
        && (Array.isArray(p.screenplaySources)||p.kind==="worn"||p.sceneMapBasis==="lexical"));
      if(!pinned.length) return;
      autoRetagRef.current = true;
      const base = {}; pinned.forEach(p=>{ base[p.id] = p.scenes.join("|"); });   // mid-flight change detector
      // EPOCH gate — the screenplay/scene set identity at send time. If either
      // moves during the await (another edit, undo, scene delete — which also
      // schedules a FRESH debounced pass), this result is stale: applying it
      // could trash a prop the newer script still uses. Abort instead; the
      // newer pass reconciles.
      const draftsEpoch = draftsRef.current, scenesEpoch = scenesRef.current;
      try{
        const map = await propSceneMap(pinned, scenesRef.current, draftsRef.current, charactersRef.current);
        if(!map) return;
        // revalidate at APPLY time: script moved, or Draft all specifications
        // started while we awaited — either way this pass must not land.
        if(draftsRef.current!==draftsEpoch || scenesRef.current!==scenesEpoch) return;
        if(tagBusyRef.current || hydratingRef.current) return;
        setProps(ps=>{
          const fresh = (p)=> p && Array.isArray(p.scenes) && (p.id in map) && p.scenes.join("|")===base[p.id];
          const nextOf = (p)=> Array.isArray(map[p.id]) ? map[p.id] : [];
          // Missing evidence is not permission to delete an asset. Preserve cards,
          // images and events even when a scene is removed or a match goes stale.
          const keep = ps;
          return keep.map(p=>{
            if(!fresh(p)) return p;
            const next = nextOf(p);
            return (next.join("|")===p.scenes.join("|")) ? p : withEpisodeSceneRefs(p,next,scenesEpoch);
          });
        });
      }catch(e){}
      finally{ autoRetagRef.current = false; }
    }, 2500);
    return ()=> clearTimeout(t);
  },[drafts, scenes, currentShowId, currentProjectId]);

  // ---- Art Room: LOCATIONS ----
  // edit rights (2026-10-08, owner — Locations review): the cards' own background syncs (times, coverage)
  // call this too, so a role that can't change the Art Room no-ops SILENTLY here; explicit actions below
  // say why through canMutateSharedFilm()
  const updateLocation = (id,patch)=>{ if(artRoomReadOnlyRef.current) return; setLocations(ls=>ls.map(l=>l.id===id?{...l,...patch}:l)); };
  // per-card location drafts run CONCURRENTLY — a set of ids currently drafting, so you
  // can fire "Draft & Generate" on several locations at once (not one-at-a-time).
  const [draftingLocIds, setDraftingLocIds] = React.useState([]);
  const draftingLocIdsRef = React.useRef([]); draftingLocIdsRef.current = draftingLocIds;
  const [draftingAllLocs, setDraftingAllLocs] = React.useState(false);
  const deleteLocation = (id)=>{
    if(!canMutateSharedFilm()) return;
    const l = (locations||[]).find(x=>x.id===id); if(!l) return;
    setLocations(ls=>ls.filter(x=>x.id!==id));
    setTrash(t=>({ ...t, locations:[ _trashStamp(l), ...(t.locations||[]).filter(x=>x.id!==id) ] }));
  };
  const restoreLocation = (id)=>{
    if(!canMutateSharedFilm()) return;
    const item = (trash.locations||[]).find(x=>x.id===id); if(!item) return;
    // a live card with the same id or the same place is already on the board (2026-10-08): say so and keep
    // the binned copy — it used to drop it silently (same id) or add a second card for one place (same key)
    const clash = (locations||[]).find(l=> l && (l.id===id || (item.key && l.key===item.key)));
    if(clash){
      if(typeof window.appToast==="function") window.appToast(item.mergedInto && clash.id===item.mergedInto
        ? "\u201c"+(item.name||"This location")+"\u201d was merged into \u201c"+(clash.name||"another card")+"\u201d, so the copy in Recently deleted stays there."
        : "\u201c"+(clash.name||item.name||"This location")+"\u201d is already on the board, so the copy in Recently deleted stays there.","info");
      return;
    }
    const { _deletedAt, _trashReason, mergedInto, mergedIntoName, ...clean } = item;
    // a merged-away card brought back is its own place again: the card it was merged into stops reading its name
    setLocations(ls=> ls.some(l=>l.id===id) ? ls
      : [...((typeof locationUnmergeRestored==="function") ? locationUnmergeRestored(ls, item) : ls), clean]);
    setTrash(t=>({ ...t, locations:(t.locations||[]).filter(x=>x.id!==id) }));
  };
  /* SAME PLACE, TWO NAMES (owner-approved 2026-10-14, "go ahead with all of it"; Story Pipeline "Locations"): the
     merge is ONE confirmed action, for a role that saves the Art Room (the owner, an Art director). One card stays
     (the one with the shared layout and plate, locations.jsx locationMergePlan) and takes the name the screenplay's
     headings use; the other card goes to Recently deleted with its plate (and copies of its plates become earlier
     versions of the kept card's plate, 2026-10-14); the scene cards that disagree with their own
     screenplay are corrected when the role can also save the screenplay (with the screenplay's card snapshot, so they
     never read "needs redraft"); shots that picked the other card's plate by hand use the kept one. Nothing is
     generated or charged. On a Show the cards are shared, so the merge holds in every episode (the confirm says so). */
  const mergeLocations = async (aId, bId, opts)=>{
    if(!canMutateSharedFilm()) return;
    if(typeof locationMergePlan!=="function" || typeof locationMergeApply!=="function") return;
    opts = opts || {};
    const hasPlate = (id)=> typeof nbGetImage==="function" && !!nbGetImage(id);
    const film0 = projIdRef.current;
    let plan = locationMergePlan(locations, scenes, drafts, aId, bId, { nameFrom:opts.nameFrom, hasPlate });
    if(!plan) return;
    const canFixScenes = !writersRoomReadOnlyRef.current;
    if(typeof window.appConfirm==="function"){
      // the "Same place as…" path offers the other name too: the confirm says what that button does differently
      const altPlan = !opts.detected ? locationMergePlan(locations, scenes, drafts, aId, bId, { nameFrom:plan.altNameFromId, hasPlate }) : null;
      const ok = await window.appConfirm(locationMergeConfirmText(plan, { canFixScenes, show:!!currentShowId, offerOtherName:!opts.detected, altPlan }));
      if(!ok || projIdRef.current!==film0) return;
      // read again from the live cards (an edit may have landed while the confirm was open); the name picked stays
      plan = locationMergePlan(locationsRef.current, scenesRef.current, draftsRef.current, aId, bId,
        { nameFrom:ok==="alt" ? plan.altNameFromId : plan.nameFromId, hasPlate });
      if(!plan) return;
    }
    if(!canMutateSharedFilm()) return;   // the role changed while the confirm was open
    const mergeSceneRefs = (currentShowId && currentProjectId && window.turnSeries && typeof window.turnSeries.mergeEntitySceneRefs==="function")
      ? (set, survivor)=> window.turnSeries.mergeEntitySceneRefs(set, survivor, currentProjectId) : null;
    const res = locationMergeApply(locationsRef.current, plan, { mergeSceneRefs });
    if(!res) return;
    setLocations(cur=>{ const r = locationMergeApply(cur, plan, { mergeSceneRefs }); return r ? r.locations : cur; });
    setTrash(t=>({ ...t, locations:[ _trashStamp(res.gone), ...(t.locations||[]).filter(x=>x.id!==res.gone.id) ] }));
    if(typeof locationMergeShots==="function" && !shotsReadOnlyRef.current) setShots(ss=>locationMergeShots(ss, plan.goneId, plan.keeperId));
    // props linked to the merged-away card (a fixture's location, its placement, its story events) follow it
    if(typeof locationMergeProps==="function") setProps(ps=>locationMergeProps(ps, plan.goneId, plan.keeperId));
    const fixing = canFixScenes && !writersRoomReadOnlyRef.current && plan.sceneFixes.length && typeof locationMergeScenes==="function";
    if(fixing){
      setScenes(ss=>locationMergeScenes(ss, {}, plan).scenes);
      setDrafts(d=>locationMergeScenes([], d, plan).drafts);
    }
    if(typeof window.appToast==="function") window.appToast("Merged into \u201c"+plan.name+"\u201d"
      +(fixing ? " \u2014 scene "+plan.sceneFixes.map(f=>f.no).join(", ")+"\u2019s card"+(plan.sceneFixes.length!==1?"s":"")+" corrected" : "")
      +". \u201c"+plan.goneName+"\u201d\u2019s card is in Recently deleted.","info");
    /* (2026-10-14) THE MERGED-AWAY CARD'S PLATES ARE NOT LOST TO RECENTLY DELETED: copies of its plate, extra-space and
       environment-state plates go onto the kept card as earlier versions of its plate (locations.jsx
       locationMergeCarryIds; imagegen.jsx nbCarryVersionsInto) \u2014 its current plate is never replaced, the originals
       stay with the card in Recently deleted, the confirm said so. Free: nothing is generated or charged. */
    const carry = (plan.carry||[]).map(c=>({ id:c.id, cardId:c.cardId, name:c.name, what:c.what, label:c.label }));
    if(carry.length && typeof nbCarryVersionsInto==="function"){
      const film1 = projIdRef.current;
      // one plate or several: the ones known to have an image (the confirm said which), else every id carried
      const many = ((plan.carry||[]).filter(c=>c && c.hasImage).length || carry.length)!==1;
      const carryFailText = ()=> "Couldn\u2019t copy \u201c"+plan.goneName+"\u201d\u2019s plate"+(many ? "s" : "")+" onto \u201c"+plan.name+"\u201d. "
        +(many ? "The originals are" : "The original is")+" still with \u201c"+plan.goneName+"\u201d\u2019s card in Recently deleted.";
      Promise.resolve(nbCarryVersionsInto(plan.keeperId, carry)).then(r=>{
        if(!r || projIdRef.current!==film1 || typeof window.appToast!=="function") return;
        if(r.error==="asset scope changed") return;   // another film opened meanwhile: nothing was written
        /* fixed words only (2026-10-14 review): a storage or database error's own text never reaches the toast */
        const gone = "\u201c"+plan.goneName+"\u201d\u2019s", keptName = "\u201c"+plan.name+"\u201d";
        const carried = Number(r.carried)||0;
        const lost = (r.failed||[]).length>0 || r.ok===false;
        const originals = (many ? " The originals are" : " The original is")+" still with "+gone+" card in Recently deleted.";
        if(r.persisted==="unknown") window.appToast("Couldn\u2019t confirm that "+gone+(many ? " plates were" : " plate was")+" copied onto "+keptName
          +" \u2014 look in its \u22ef \u203a Details \u203a Earlier versions."+originals,"error");
        else if(lost && carried) window.appToast(carried+" of "+gone+" plates "+(carried!==1 ? "are now earlier versions" : "is now an earlier version")
          +" of "+keptName+"\u2019s plate (\u22ef \u203a Details \u203a Earlier versions); the others couldn\u2019t be copied."+originals,"error");
        else if(lost) window.appToast(carryFailText(),"error");
        else if(carried) window.appToast(gone+" plate"+(carried!==1 ? "s are now earlier versions" : " is now an earlier version")
          +" of "+keptName+"\u2019s plate (\u22ef \u203a Details \u203a Earlier versions).","info");
      }).catch(()=>{ if(projIdRef.current===film1 && typeof window.appToast==="function") window.appToast(carryFailText(),"error"); });
    }
  };
  /* "Part of" (kind "part": aId is the part, bId the place) and "Keep separate" (kind "separate") \u2014 the owner's answer
     to "These look like one place"; stored on the cards (locations.jsx locationPlaceDecisionApply). Keeping a place and
     its part separate makes the part a location of its own, so it asks first. Nothing is generated or charged. */
  const decideLocationPlace = async (aId, bId, kind)=>{
    if(!canMutateSharedFilm()) return;
    if(typeof locationPlaceDecisionApply!=="function") return;
    const a = (locations||[]).find(l=>l && l.id===aId), b = (locations||[]).find(l=>l && l.id===bId);
    if(!a || !b) return;
    if(kind==="separate" && typeof window.appConfirm==="function"){
      const part = String(a.parentKey||"")===String(b.key||"") ? a : String(b.parentKey||"")===String(a.key||"") ? b : null;
      const whole = part ? (part===a ? b : a) : null;
      const ok = await window.appConfirm({ title:"Keep \u201c"+(a.name||"this place")+"\u201d and \u201c"+(b.name||"that place")+"\u201d as two places?",
        body:(part ? "\u201c"+(part.name||"It")+"\u201d stops being a part of \u201c"+(whole.name||"the other")+"\u201d and becomes a location of its own: it needs its own shared layout (Spatial Layout & Staging) before its next plate. " : "")
          +"Both cards, their plates and layouts stay as they are, and they won't be suggested as one place again"
          +(currentShowId ? " \u2014 in every episode of the Show" : "")+". Nothing is generated or charged.",
        confirmLabel:"Keep separate", cancelLabel:"Cancel" });
      if(!ok) return;
      if(!canMutateSharedFilm()) return;
    }
    setLocations(cur=> locationPlaceDecisionApply(cur, aId, bId, kind) || cur);
  };
  const purgeLocation = async (id)=>{
    if(!canMutateSharedFilm()) return;
    const item = (trash.locations||[]).find(x=>x.id===id);
    if(!item) return;
    const itemKey = String(item.key||item.id);
    // rooms still on the board that hang off this place can't make new plates without it — ask first
    // (a merged-away card has no rooms of its own: they belong to the card it was merged into — 2026-10-14)
    const liveKids = item.mergedInto ? [] : (locations||[]).filter(l=> l && l.key!==item.key && (l.parentKey===item.key || l.continuityRootKey===item.key));
    if(liveKids.length && typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Delete \u201c"+(item.name||"this location")+"\u201d forever?",
        body:liveKids.length+" room"+(liveKids.length!==1?"s":"")+" on the board belong"+(liveKids.length===1?"s":"")+" to it ("+liveKids.slice(0,4).map(l=>l.name||"Room").join(", ")+(liveKids.length>4?"\u2026":"")
          +"). Their plates stay, but they can't make new ones until this place is back.",
        confirmLabel:"Delete forever", cancelLabel:"Cancel", danger:true });
      if(!ok) return;
    }
    try{
      if(typeof nbClearAsset==="function"){
        const ids = [id,
          ...(item.variants||[]).map(v=>id+"-"+v.id),
          ...(item.coverageSheets||[]).map(v=>id+"-"+v.id)];
        // Slugline-unit plates are descendants of their location even though their stable IDs key from
        // the screenplay heading. A unit belongs to the ROOM it is in (subspaceKey), not to the room's
        // parent (locationKey is the continuity root) — 2026-10-08: purging a parent used to wipe its live
        // rooms' plates, and purging a room left its own behind.
        (sluglineUnits||[]).forEach(u=>{
          if(u && String(u.subspaceKey||u.locationKey||"")===itemKey && typeof sluglineUnitImageId==="function")
            ids.push(sluglineUnitImageId(u.key));
        });
        // never an image a LIVE card uses: its own id, or a room & time plate of a live room
        const live = (locations||[]).some(l=>l && l.id===id);
        const liveUnitIds = new Set((sluglineUnits||[]).filter(u=> u && typeof sluglineUnitImageId==="function"
          && (locations||[]).some(l=> l && String(l.key||"")===String(u.subspaceKey||u.locationKey||""))).map(u=>sluglineUnitImageId(u.key)));
        for(const assetId of Array.from(new Set(ids))){
          if(live && (assetId===id || String(assetId).indexOf(id+"-")===0)) continue;
          if(liveUnitIds.has(assetId)) continue;
          await nbClearAsset(assetId);
        }
      }
      setTrash(t=>({ ...t, locations:(t.locations||[]).filter(x=>x.id!==id) }));
      // still in the screenplay → the place comes back as a fresh, empty card (the sync derives it)
      // (never for a card merged into another — its place lives on in the card it was merged into, 2026-10-14)
      if(item.key && !item.mergedInto && !(locations||[]).some(l=>l && l.key===item.key)
        && typeof deriveLocations==="function" && deriveLocations(scenes, [], drafts).some(f=>f.key===item.key)
        && typeof window.appToast==="function")
        window.appToast("\u201c"+(item.name||"This location")+"\u201d is still in the screenplay, so it comes back as an empty card.","info");
    }catch(e){ if(window.appToast) window.appToast("Couldn't permanently delete this location's descendant assets. It stays in Recently deleted so you can try again.","error"); }
  };
  const draftLocationVisuals = async (l)=>{
    if(!(typeof aiLocationVisuals==="function")) return;
    if(!canMutateSharedFilm()) return;
    if(draftingLocIdsRef.current.indexOf(l.id)>=0) return;   // this location already drafting
    // a card that already has a spec: ask first — it replaces the text, edits included (2026-10-08)
    if(typeof locVisualsDrafted==="function" && locVisualsDrafted(l) && typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Draft \u201c"+(l.name||"this location")+"\u201d again?",
        body:"Its specification is written again from the screenplay, replacing the current text \u2014 your edits included. Its plate stays as it is. This uses writing credits.",
        confirmLabel:"Draft again", cancelLabel:"Cancel" });
      if(!ok) return;
    }
    setDraftingLocIds(ids=> ids.indexOf(l.id)>=0 ? ids : [...ids, l.id]);
    const film0 = projIdRef.current;   // ids repeat across films: a draft lands only on the film it started in
    try{
      const fields = await aiLocationVisuals(l, scenes, lbProject("locations"));
      if(fields && projIdRef.current===film0){ setLocations(ls=>ls.map(x=>x.id===l.id?{...x, ...keepPickedStyle(x, fields)}:x)); }   // (records its own Lookbook)
    }catch(e){ if(typeof window.appToast==="function") window.appToast("Couldn't draft \u201c"+(l.name||"this location")+"\u201d ("+((e&&e.message)||"error")+"). Nothing was overwritten.","error"); }
    setDraftingLocIds(ids=> ids.filter(x=>x!==l.id));
  };
  // "Draft all locations" — the full locations pipeline in one click:
  //   1) PULL missing master places from screenplay scene headings (+ refresh scene lists)
  //      and let each card derive implied INT/EXT side coverage from scene body text
  //   2) DRAFT every card's spec (The space + Significance + Look dev) from the script
  //   3) STAGE each location's depth grid off the freshly-designed space
  // Replaces the old separate "Pull from script" button.
  // ONLY WHAT'S MISSING (2026-10-03, owner — Locations review): "Design N locations" drafts the
  // specs that don't exist yet and the layouts (depth grids) of revisited places that have none — it
  // used to rewrite every spec and grid, hand edits included, and pay again for each. "Redesign all…"
  // (mode "redraft") asks first, then redoes everything. A failure is said out loud.
  const draftAllLocations = async (mode)=>{
    if(draftingAllLocs || !(typeof aiDesignLocationBible==="function")) return;
    if(!canMutateSharedFilm()) return;
    const film0 = projIdRef.current;
    const redraft = mode==="redraft";
    if(redraft){
      const n = (locations||[]).length;
      const ok = typeof window.appConfirm!=="function" || await window.appConfirm({
        title:"Redesign all "+n+" location"+(n!==1?"s":"")+"?",
        body:"Every location's spec, and the layout of every place used in two or more scenes, is written again from the screenplay \u2014 replacing the current ones, including your edits. Plates are left as they are. This uses writing credits for every location.",
        confirmLabel:"Redesign all", danger:true });
      if(!ok) return;
    }
    setDraftingAllLocs(true);
    try{
      // 1) pull missing + refresh scene lists on existing
      let working = locations;
      if(typeof deriveLocations==="function"){
        const derived = deriveLocations(scenes, [...(locations||[]), ...((trash&&trash.locations)||[])], drafts);   // places not yet present — never one in Recently deleted
        const fresh = deriveLocations(scenes, [], drafts);            // all, to refresh scene chips
        working = locations.map(l=>{ const m=fresh.find(f=>f.key===l.key);
          return m?withEpisodeLocationMeta(l,{...m,
            times:[...new Set([...(l.times||[]),...(m.times||[])])],
            areas:[...new Set([...(l.areas||[]),...(m.areas||[])])]}) : l; });
        if(derived.length) working = [...working, ...derived.map(l=>withEpisodeLocationMeta(l,l))];
        setLocsSeeded(true);
        if(derived.length || working.length) setLocations(working);
      }
      if(!working.length){ setDraftingAllLocs(false); return; }
      // 2) draft specs — only the locations with none yet, unless redesigning
      const isDrafted = (l)=> (typeof locVisualsDrafted==="function") ? locVisualsDrafted(l) : false;
      const specTargets = redraft ? working : working.filter(l=>!isDrafted(l));
      const map = specTargets.length ? await aiDesignLocationBible(specTargets, scenes, lbProject("locations")) : {};
      if(specTargets.length && !map) throw new Error("no specs came back");
      if(projIdRef.current!==film0) throw new Error("you switched films, so nothing was written");
      const merged = working.map(l=> (map && map[l.id]) ? {...l, ...keepPickedStyle(l, map[l.id])} : l);
      if(map) setLocations(ls=>ls.map(l=> map[l.id] ? {...l, ...keepPickedStyle(l, map[l.id])} : l));
      // 3) depth-grid staging — only for places the film revisits (2+ scenes), where
      // cross-scene geometric continuity pays off; single-scene locations skip it and
      // render fine from prose (a card's "Draft staging" button stages one on demand).
      if(typeof aiDraftStaging==="function"){
        const staged = (l)=> (typeof stagingHasContent==="function") ? stagingHasContent(l) : !!l.staging;
        const wantStage = merged.filter(l=>(l.scenes||[]).length>=2 && (redraft || !staged(l)));
        // THE LAYOUT FIRST (2026-10-12, owner — Locations review): a composition is drafted only where the shared
        // layout is ready — never paid for while the layout it follows is missing or unconfirmed; the others are named
        const layoutReady = (l)=>{ try{ if(typeof requireLocationSpatialPlan==="function") requireLocationSpatialPlan(l); return true; }catch(e){ return false; } };
        const stageTargets = wantStage.filter(layoutReady);
        const waitingLayout = wantStage.filter(l=>!layoutReady(l)).map(l=>l.name||"a location");
        if(waitingLayout.length && typeof window.appToast==="function"){
          const shown = waitingLayout.slice(0,4).join(", ")+(waitingLayout.length>4?" and "+(waitingLayout.length-4)+" more":"");
          window.appToast("View composition not drafted for "+shown+" \u2014 confirm "+(waitingLayout.length!==1?"their":"its")+" shared layout in Spatial Layout & Staging first, then draft it from the card.");
        }
        const stages = await Promise.all(stageTargets.map(async l=>{
          try{ return { id:l.id, staging: await aiDraftStaging(l, scenes, project) }; }
          catch(e){ return { id:l.id, staging:null }; }
        }));
        const sMap = {}; stages.forEach(x=>{ if(x.staging) sMap[x.id]=x.staging; });
        if(Object.keys(sMap).length && projIdRef.current===film0) setLocations(ls=>ls.map(l=> sMap[l.id] ? {...l, staging:sMap[l.id]} : l));
      }
      // (each drafted card records its own Lookbook — 2026-10-06)
    }catch(e){
      if(typeof window.appToast==="function") window.appToast("Couldn't design the locations ("+((e&&e.message)||"error")+"). Nothing was overwritten \u2014 try again.","error");
    }
    setDraftingAllLocs(false);
  };
  // draft a location's depth-grid staging from the script
  const [draftingStageId, setDraftingStageId] = React.useState(null);
  const draftLocationStaging = async (l)=>{
    if(draftingStageId || !(typeof aiDraftStaging==="function")) return;
    if(!canMutateSharedFilm()) return;
    // a view composition already written: ask first — it replaces the camera views, edits included (2026-10-08)
    if(typeof stagingHasContent==="function" && stagingHasContent(l) && typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Draft the view composition again?",
        body:"\u201c"+(l.name||"This location")+"\u201d\u2019s camera views are written again from the screenplay, replacing the current ones \u2014 your edits included. This uses writing credits.",
        confirmLabel:"Draft again", cancelLabel:"Cancel" });
      if(!ok) return;
    }
    /* THE LAYOUT FIRST, EDITS KEPT, FAILURES SAID (2026-10-12, owner — Locations review): it waits while the shared
       layout is drafting / waiting to be confirmed / not ready (the button says why); a grid edited while the draft
       ran is never overwritten without asking; a failed draft is said in plain words. */
    const block = (typeof locationStagingDraftBlock==="function") ? locationStagingDraftBlock(l) : "";
    if(block){ if(typeof window.appToast==="function") window.appToast(block); return; }
    const liveLoc = ()=> (locationsRef.current || []).find(x=>x.id===l.id) || null;   // (declared below; read at run time)
    const basisOf = (x)=> (typeof locationStagingBasis==="function") ? locationStagingBasis(x) : JSON.stringify((x&&x.staging)||null);
    const basis = basisOf(liveLoc() || l);
    const name = l.name || "this location";
    setDraftingStageId(l.id);
    const film0 = projIdRef.current;
    try{
      const staging = await aiDraftStaging(l, scenes, project, { throwErrors:true });
      if(!staging || projIdRef.current!==film0) return;
      const now = liveLoc();
      if(!now) return;   // removed meanwhile
      if(basisOf(now)!==basis){
        // edited while it ran: the edits stay unless the user picks the draft
        const take = typeof window.appConfirm==="function" && await window.appConfirm({ title:"Use the new view composition?",
          body:"\u201c"+name+"\u201d\u2019s view composition was edited while the new one was being drafted. Keep your edits, or replace them with the new draft?",
          confirmLabel:"Use the new draft", cancelLabel:"Keep my edits" });
        if(!take){
          if(typeof window.appConfirm!=="function" && typeof window.appToast==="function")
            window.appToast("\u201c"+name+"\u201d\u2019s view composition was edited while the new one was being drafted \u2014 your edits were kept and the draft wasn't applied.");
          return;
        }
        if(projIdRef.current!==film0) return;
      }
      setLocations(ls=>ls.map(x=>x.id===l.id?{...x, staging}:x));
    }catch(e){
      if(projIdRef.current===film0 && typeof window.appToast==="function"){
        const why = (typeof window.agentErrText==="function") ? window.agentErrText(e) : "an unexpected error";
        window.appToast("Couldn't draft \u201c"+name+"\u201d\u2019s view composition ("+why+"). Nothing was changed \u2014 try again.","error");
      }
    }finally{ setDraftingStageId(null); }
  };
  /* SUB-SPACE CLEANUP — when the screenplay folds a sub-structure place ("INT.
     INTAKE BOOTH - NIGHT") under its complex's master card (deriveSubspaceFold),
     a standalone card an earlier derivation created for it is stale. Remove it
     ONLY when it holds nothing the user made (no drafted fields, no variants or
     coverage sheets, no generated plate) — anything with content stays, assets
     preserved. Removed cards go to trash like a manual delete, so the fold is
     recoverable. */
  /* FOLD DISPOSAL — fully async and image-safe. EVERY folded fromScript card
     folds away (user-confirmed rule, 2026-07-29): drafted text, variants and
     coverage sheets park with the card in trash (recoverable), and when the
     card has a master plate it is first COPIED onto its slugline unit's plate
     slot inside the parent card. Image presence is resolved ASYNC — sync caches
     can be cold in cloud mode AND in local mode (large sheets live in
     IndexedDB, not the sync mirror) — because a false "empty" would either
     skip the plate transfer or clobber a unit plate. Nothing regenerates; a
     failed plate transfer keeps the card (its plate stays visible). */
  const urlToDataUrl = async (url)=>{
    if(!url) return "";
    if(/^data:/.test(url)) return url;
    try{
      const blob = await (await fetch(url)).blob();
      return await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(String(fr.result||"")); fr.onerror=()=>rej(fr.error); fr.readAsDataURL(blob); });
    }catch(e){ return ""; }
  };
  const locationsRef = React.useRef([]); locationsRef.current = locations;
  const scenesRef = React.useRef([]); scenesRef.current = scenes;
  const draftsRef = React.useRef({}); draftsRef.current = drafts;
  const foldStaleRef = React.useRef(false);
  const foldStaleLocations = async (ls)=>{
    if(foldStaleRef.current) return;
    if(typeof deriveSubspaceFold!=="function" || typeof deriveSluglineUnits!=="function") return;
    if(typeof nbCommit!=="function" || typeof sluglineUnitImageId!=="function") return;
    // Capture film scope before the first await. Location/unit ids repeat across
    // projects, so an old fold must never commit after the user switches films.
    const foldEpoch=(typeof nbEpoch==="function")?nbEpoch():null;
    const fold = deriveSubspaceFold(scenes, drafts);
    const cands = (ls||[]).filter(l=> l && l.fromScript && fold[l.key]);
    if(!cands.length) return;
    const units = deriveSluglineUnits(scenes, drafts);
    const placeKeyOf = (place)=>{
      const head = String(place||"").split(/[·—,]/)[0];
      const slug = (typeof locSlug==="function") ? locSlug(head)
        : head.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
      return slug.split("-").slice(0,4).join("-");
    };
    foldStaleRef.current = true;
    const toTrash = [], movedIds = {};
    try{
      for(const l of cands){
        try{
          let url = (typeof nbRemoteImageUrl==="function") ? (await nbRemoteImageUrl(l.id)) : "";
          if(!url && typeof nbLoadImage==="function") url = await nbLoadImage(l.id);
          if(!url){ toTrash.push(l); continue; }                     // truly content-free
          // Plate-only → copy onto a unit ONLY when the destination is
          // unambiguous. A location can have NIGHT, DAWN, INT and EXT units;
          // choosing the first one silently assigns the same legacy plate to an
          // arbitrary time/side. Preserve the old card and pixels instead.
          const matchingUnits = units.filter(x=> placeKeyOf(x.place)===l.key);
          if(matchingUnits.length!==1) continue;
          const u = matchingUnits[0];
          const unitImgId = sluglineUnitImageId(u.key);
          const existing = (typeof nbLoadImage==="function") ? await nbLoadImage(unitImgId) : "";
          if(existing) continue;                          // never clobber an existing unit plate
          const dataUrl = await urlToDataUrl(url);        // cloudCommit accepts data: URLs only
          if(!dataUrl) continue;
          const det = (typeof nbLoadDetailsAsset==="function") ? await nbLoadDetailsAsset(l.id, url) : { meta:null };
          // Everything above awaited network/storage. Re-derive from LIVE refs:
          // the script may now contain another side/time unit, and the expected
          // sole destination may have changed.
          const liveUnits = deriveSluglineUnits(scenesRef.current, draftsRef.current);
          const liveMatches = liveUnits.filter(x=>placeKeyOf(x.place)===l.key);
          if(liveMatches.length!==1 || liveMatches[0].key!==u.key) continue;
          // Claim the normal generation registry for this exact target so a user
          // click cannot start a render between our final empty check and commit.
          if(!window.__nbGenInflight) window.__nbGenInflight={};
          if(window.__nbGenInflight[unitImgId]) continue;
          const migrationRun={id:unitImgId,kind:"legacy-location-fold",startedAt:Date.now()};
          window.__nbGenInflight[unitImgId]=migrationRun;
          // A cancelled older run may leave a sticky flag after surrendering the
          // registry. This new owner starts clean; a subsequent Cancel sets it
          // true again and migrationLive immediately fails.
          window.__nbGenCancel=window.__nbGenCancel||{};
          window.__nbGenCancel[unitImgId]=false;
          const migrationLive=()=> !(window.__nbGenCancel&&window.__nbGenCancel[unitImgId])
            && !!(window.__nbGenInflight&&window.__nbGenInflight[unitImgId]===migrationRun)
            && (foldEpoch==null || typeof nbEpoch!=="function" || nbEpoch()===foldEpoch);
          let r=null;
          try{
            const existingNow=(typeof nbLoadImage==="function")?await nbLoadImage(unitImgId):"";
            if(existingNow || !migrationLive()) continue;
            // Revalidate cardinality once more after the final storage await.
            const commitUnits=deriveSluglineUnits(scenesRef.current,draftsRef.current);
            const commitMatches=commitUnits.filter(x=>placeKeyOf(x.place)===l.key);
            if(commitMatches.length!==1 || commitMatches[0].key!==u.key) continue;
            r = await nbCommit(unitImgId, dataUrl, (det&&det.meta)||null, [], "locunit",foldEpoch,migrationLive);
            if(!migrationLive()) r=null;
          } finally {
            if(window.__nbGenInflight[unitImgId]===migrationRun) delete window.__nbGenInflight[unitImgId];
            if(window.__nbGenCancel&&window.__nbGenCancel[unitImgId]===false) delete window.__nbGenCancel[unitImgId];
          }
          if(!r || r.tier==="error" || r.tier==="stale" || !r.url) continue;
          try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{detail:{id:unitImgId,url:r.url}})); }catch(e){}
          toTrash.push(l); movedIds[l.id] = true;
        }catch(e){ /* keep the card on any failure */ }
      }
    } finally { foldStaleRef.current = false; }
    if(!toTrash.length) return;
    // REVALIDATE against current state — the card may have been deleted, and a
    // script edit during the awaits above may have changed the fold map itself;
    // only remove cards that are still present AND still folded right now
    // (drafted content no longer blocks the fold — it parks in trash with the
    // card, recoverable).
    const curNow = locationsRef.current || [];
    const foldNow = deriveSubspaceFold(scenesRef.current, draftsRef.current);
    const finalTrash = toTrash.filter(t=>{
      if(!foldNow[t.key]) return false;                    // un-folded by a script edit mid-run
      const now = curNow.find(x=>x && x.id===t.id);
      return !!now && now.key===t.key;
    });
    if(!finalTrash.length) return;
    setTrash(t=>({ ...t, locations:[ ...finalTrash.map(x=>({ ..._trashStamp(x), _trashReason:"fold" })), ...(t.locations||[]) ] }));
    setLocations(cur=>cur.filter(x=> x && !finalTrash.some(y=>y.id===x.id)));
    try{ if(window.appToast){
      const moved = finalTrash.filter(t=>movedIds[t.id]).map(t=>t.name);
      const folded = finalTrash.filter(t=>!movedIds[t.id]).map(t=>t.name);
      const parts = [];
      if(moved.length) parts.push(moved.join(", ")+" (plate moved onto its slugline unit)");
      if(folded.length) parts.push(folded.join(", "));
      window.appToast("Folded "+parts.join(" and ")+" into its parent location — card"+(finalTrash.length>1?"s are":" is")+" in Recently deleted (recoverable)");
    } }catch(e){}
  };
  // derive master locations from screenplay scene headings; coverage sheets handle
  // implied sub-locations/sides described inside the scene body
  const pullLocationsFromScript = React.useCallback(()=>{
    if(typeof deriveLocations!=="function") return;
    if(artRoomReadOnlyRef.current) return;   // (also run by the auto-seed below — silent)
    const derived = deriveLocations(scenes, [...(locations||[]), ...((trash&&trash.locations)||[])], drafts);   // never one in Recently deleted
    setLocsSeeded(true);
    if(derived.length) setLocations(ls=>[...ls, ...derived.map(l=>withEpisodeLocationMeta(l,l))]);
    // also refresh the scene lists on existing locations as the script grows
    else if(locations.length){
      const fresh = deriveLocations(scenes, [], drafts);
      setLocations(ls=>ls.map(l=>{ const m=fresh.find(f=>f.key===l.key); return m?withEpisodeLocationMeta(l,{...m,
        times:[...new Set([...(l.times||[]),...(m.times||[])])],
        areas:[...new Set([...(l.areas||[]),...(m.areas||[])])]}) : l; }));
    }
  },[scenes, locations, drafts, trash, currentShowId, currentProjectId]);
  // auto-seed once per story: first time the Locations tab opens empty, derive them — never behind
  // a LOCKED Locations tab (same reason as the Props seed above)
  React.useEffect(()=>{
    if(locsSeeded || hydratingRef.current) return;
    if(artRoomReadOnlyRef.current) return;
    if(room!=="art" || artView!=="locations") return;
    if(artTabLocked("locations")) return;
    if(locations.length){ setLocsSeeded(true); return; }
    if(typeof scriptHasLocations==="function" && scriptHasLocations(scenes)) pullLocationsFromScript();
  },[room, artView, locsSeeded, locations.length, scenes, pullLocationsFromScript, hydrationTick, artTabLocks]);
  // LOCATION HIERARCHY SYNC — grouping now establishes inheritance instead of
  // disposing of child cards. Restore a previously folded child from recoverable
  // Trash when possible; otherwise derive the missing child with its stable ID.
  // Existing specs, plates, staging and histories remain on their original records.
  React.useEffect(()=>{
    if(hydratingRef.current || !scenes.length || !locations.length) return;
    if(artRoomReadOnlyRef.current) return;   // a role that can't change the Art Room never rewrites it
    if(typeof deriveLocations!=="function") return;
    const fresh=deriveLocations(scenes,[],drafts);
    if(!fresh.length) return;
    const freshByKey={}; fresh.forEach(x=>{ if(x&&x.key) freshByKey[x.key]=x; });
    const currentKeys=new Set((locations||[]).map(x=>x&&x.key).filter(Boolean));
    // ONLY A CARD THE FOLD PUT AWAY comes back on its own (2026-10-08, owner — Locations review): this used
    // to restore EVERY binned card whose heading was still in the script, so deleting one undid itself on
    // the next render. A card the user deleted stays in Recently deleted, and isn't derived again either.
    const restore=(trash.locations||[]).filter(x=>x&&x._trashReason==="fold"&&freshByKey[x.key]&&!currentKeys.has(x.key));
    const restoreKeys=new Set(restore.map(x=>x.key));
    const binnedKeys=new Set((trash.locations||[]).map(x=>x&&x.key).filter(Boolean));
    const missing=fresh.filter(x=>!currentKeys.has(x.key)&&!restoreKeys.has(x.key)&&!binnedKeys.has(x.key));
    let changed=!!(restore.length||missing.length);
    const next=(locations||[]).map(l=>{
      const f=l&&freshByKey[l.key]; if(!f) return l;
      let synced=withEpisodeLocationMeta(l,f);
      // a Screenplay sides pick you made stands (2026-10-08 — the sync used to put the derived side back)
      if(l.intExtLocked) synced={...synced,intExt:l.intExt};
      const fields=["scope","parentKey","continuityRootKey","scenes","episodeScenes","times","areas","intExt","episodeLocationMeta"];
      const same=fields.every(k=>JSON.stringify(l[k])===JSON.stringify(synced[k]));
      if(same) return l; changed=true; return synced;
    });
    restore.forEach(item=>{ const {_deletedAt,_trashReason,...clean}=item, f=freshByKey[item.key];
      // restored authored/generated fields win over the empty derived shell
      const restored={...clean,...f,...clean};
      next.push(withEpisodeLocationMeta(restored,f)); });
    missing.forEach(item=>next.push(withEpisodeLocationMeta(item,item)));
    if(changed) setLocations(next);
    if(restore.length) setTrash(t=>({...t,locations:(t.locations||[]).filter(x=>!restoreKeys.has(x&&x.key))}));
  },[locations, scenes, drafts, trash.locations, currentShowId, currentProjectId]);
  // read the whole film, design a BESPOKE per-film palette and color-script it
  // along the value-charge spine (see aiAssignSceneStyles).
  // merge an aiAssignSceneStyles result into project.styleBible — the Colorist agent's
  // apply step (on approval).
  // HAND-PICKED SCENES ARE KEPT (2026-10-03, owner — Color review): a scene whose look the user
  // chose in the film-strip (styleBible.sceneStylesManual) keeps it — and its look stays in the
  // set — unless the user ticked "Also redo the scenes I picked by hand" (coloristRedoManualRef).
  // The Colorist's per-scene reasons are stored (styleBible.sceneWhy) so the strip can show them.
  // opts.redoManual: the choice made when the RUN STARTED (2026-10-08 — it was read at apply time, so a
  // pre-production run could pick up a Colorist panel's "Also redo" and redo your hand-picked scenes)
  const applyStyleResult = (res, seed, opts)=>{
    if(!res) return;
    if(artRoomReadOnlyRef.current) return;   // the role changed while the run worked
    const redoManual = (opts && opts.redoManual!==undefined) ? !!opts.redoManual : !!coloristRedoManualRef.current;
    const liveScenes = new Set((scenesRef.current||scenes||[]).map(x=>x && x.id));
    setProject(p=>{
      const sb = (p.styleBible)||{};
      const before = (typeof styleBibleOf==="function") ? styleBibleOf(p) : { presets:sb.presets||[], sceneStyles:sb.sceneStyles||{} };
      const manualMap = redoManual ? {} : (sb.sceneStylesManual||{});
      const manualScenes = Object.keys(manualMap).filter(sid=> manualMap[sid] && (sb.sceneStyles||{})[sid]);
      // A bespoke per-film palette REPLACES the generic starter set (deduped by id)
      // so each film looks unique; fall back to the existing/seed presets if none.
      let bespoke = (res.presets&&res.presets.length) ? res.presets : null;
      let resScenes = { ...(res.sceneStyles||{}) };
      // YOUR LOOK STAYS YOURS (2026-10-08): a new look that reuses the id of a look a hand-picked scene uses,
      // with different content, is renamed — it used to take that id, so your scene got the model's look
      const keepIds0 = new Set(manualScenes.map(sid=>sb.sceneStyles[sid]));
      if(bespoke && keepIds0.size){
        const beforeById = {}; (before.presets||[]).forEach(x=>{ if(x && x.id) beforeById[x.id]=x; });
        const taken = new Set([...(before.presets||[]).map(x=>x && x.id), ...bespoke.map(x=>x && x.id)]);
        const sameLook = (a,b)=> JSON.stringify({...a, edited:undefined})===JSON.stringify({...b, edited:undefined});
        bespoke = bespoke.map(x=>{
          if(!x || !keepIds0.has(x.id) || !beforeById[x.id] || sameLook(x, beforeById[x.id])) return x;
          let n = 2, nid = x.id+"-"+n; while(taken.has(nid)){ n++; nid = x.id+"-"+n; } taken.add(nid);
          Object.keys(resScenes).forEach(sid=>{ if(resScenes[sid]===x.id && manualScenes.indexOf(sid)<0) resScenes[sid]=nid; });
          return { ...x, id:nid };
        });
      }
      // never a look for a scene deleted while the run worked
      if(liveScenes.size) Object.keys(resScenes).forEach(sid=>{ if(!liveScenes.has(sid)) delete resScenes[sid]; });
      let presets, sceneStyles;
      if(bespoke){
        const byId = {}; bespoke.forEach(p=>{ byId[p.id]=p; });
        presets = Object.values(byId);
        // drop any prior assignment whose preset no longer exists, then overlay the color-script.
        const validIds = new Set(presets.map(p=>p.id));
        const kept = {}; Object.entries(sb.sceneStyles||{}).forEach(([sid,pid])=>{ if(validIds.has(pid)) kept[sid]=pid; });
        sceneStyles = {...kept, ...resScenes};
      } else {
        presets = (sb.presets&&sb.presets.length) ? sb.presets : (seed||sb.presets||[]);
        sceneStyles = {...(sb.sceneStyles||{}), ...resScenes};
      }
      // keep each hand-picked scene's look, and that look itself if the new set dropped it
      const keepIds = new Set(manualScenes.map(sid=>sb.sceneStyles[sid]));
      const have = new Set(presets.map(x=>x.id));
      (before.presets||[]).forEach(x=>{ if(keepIds.has(x.id) && !have.has(x.id)){ presets = [...presets, x]; have.add(x.id); } });
      const sceneStylesManual = {};
      manualScenes.forEach(sid=>{ sceneStyles[sid] = sb.sceneStyles[sid]; sceneStylesManual[sid] = true; });
      const why = (res.rationale && res.rationale.scenes) || {};
      const sceneWhy = {};
      Object.entries(sceneStyles).forEach(([sid])=>{
        if(manualScenes.indexOf(sid)>=0) return;   // a hand-picked scene has no Colorist reason
        if(why[sid]) sceneWhy[sid] = String(why[sid]).slice(0,400);
      });
      // the model also picks the film stock; preserve other styleBible fields (refs etc.).
      // a film stock you picked is kept unless this run redoes your picks (2026-10-08)
      const keepStock = !!sb.filmStockManual && !redoManual;
      const filmStock = keepStock ? (sb.filmStock || "none") : (res.filmStock || sb.filmStock || "none");
      return {...p, styleBible:{ ...sb, presets, sceneStyles, filmStock, filmStockManual: keepStock, sceneStylesManual, sceneWhy,
        paletteWhy: (res.rationale && res.rationale.palette) ? String(res.rationale.palette).slice(0,600) : (sb.paletteWhy||""),
        ...(res.writingProvenance?{writingProvenance:{...res.writingProvenance}}:{}) }};
    });
  };
  // the user's free-text visual references that steer bespoke palette design
  // EDIT RIGHTS ON EVERY COLOUR CHANGE (2026-10-08, owner — Color review): the colour system is saved with the
  // film's settings, which a Co-writer or Stage editor may also save — so every handler checks the role here.
  // CLEARING the field puts the Lookbook's colour notes back (the auto-fill resumes) — it used to stay empty
  // while the Colorist quietly read the Lookbook brief anyway
  const setStyleRefs = (refs)=>{ if(!canMutateSharedFilm()) return;
    const txt = String(refs||"");
    if(!txt.trim()){
      const brief = (typeof lookbookBriefFor==="function") ? lookbookBriefFor("colorist", lookbook, lookbookNote).replace(/^Overall look: /,"") : "";
      setProject(p=>({ ...p, styleBible:{ ...((p.styleBible)||{}), refs:brief, lookbookSynced:brief } })); return; }
    setProject(p=>({ ...p, styleBible:{ ...((p.styleBible)||{}), refs:txt } })); };
  /* COLOR'S BANNER WHEN THE REFERENCES ARE YOURS (owner 2026-10-06 — Lookbook review): once you've written
     the Visual references field, Light the film reads YOUR text, so it can't apply a Lookbook change —
     the banner offers to put the Lookbook's colour notes back (the sync resumes) or to keep yours */
  const useLookbookColorRefs = ()=>{ if(!canMutateSharedFilm()) return;
    const brief = (typeof lookbookBriefFor==="function") ? lookbookBriefFor("colorist", lookbook, lookbookNote).replace(/^Overall look: /,"") : "";
    setProject(p=>({ ...p, styleBible:{ ...((p.styleBible)||{}), refs:brief, lookbookSynced:brief } })); };
  const keepOwnColorRefs = ()=>{ if(!canMutateSharedFilm()) return; markApplied("colorist"); };
  // uploaded reference images (palette sampled client-side); capped to keep state light
  // film0: the film open when the upload started — stills read while you switched films never land in the new one
  const addStyleRefImages = (imgs, film0)=>{ if(!canMutateSharedFilm()) return;
    if(film0!==undefined && String(film0||"")!==String(projIdRef.current||"")) return;
    setProject(p=>{ const sb=(p.styleBible)||{};
      return { ...p, styleBible:{ ...sb, refImages:[...(sb.refImages||[]), ...(imgs||[])].slice(0,8) } }; }); };
  // removing a still can be undone (its kept 384px copy lives only here)
  const removeStyleRefImage = (id)=>{ if(!canMutateSharedFilm()) return;
    const sb0 = (project && project.styleBible) || {};
    const at = (sb0.refImages||[]).findIndex(r=>r && r.id===id); const gone = at>=0 ? sb0.refImages[at] : null;
    const film0 = projIdRef.current;
    setProject(p=>{ const sb=(p.styleBible)||{};
      return { ...p, styleBible:{ ...sb, refImages:(sb.refImages||[]).filter(r=>r.id!==id) } }; });
    if(gone && typeof window.appToast==="function") window.appToast("Reference still removed.","info",{ action:{ label:"Undo", onClick:()=>{
      if(String(film0||"")!==String(projIdRef.current||"") || artRoomReadOnlyRef.current) return;
      setProject(p=>{ const sb=(p.styleBible)||{}; const list=(sb.refImages||[]).filter(r=>r && r.id!==gone.id);
        list.splice(Math.min(at, list.length), 0, gone);
        return { ...p, styleBible:{ ...sb, refImages:list.slice(0,8) } }; }); } } }); };
  // manual per-scene look (presetId null = unassign) — marked as set by hand, so Light the film keeps it
  const setScenePreset = (sceneId, presetId)=> canMutateSharedFilm() && setProject(p=>{
    const sb = (p.styleBible)||{};
    const sceneStyles = {...(sb.sceneStyles||{})};
    const sceneStylesManual = {...(sb.sceneStylesManual||{})};
    const sceneWhy = {...(sb.sceneWhy||{})};
    delete sceneWhy[sceneId];   // the Colorist's reason no longer applies
    if(presetId){ sceneStyles[sceneId] = presetId; sceneStylesManual[sceneId] = true; }
    else { delete sceneStyles[sceneId]; delete sceneStylesManual[sceneId]; }
    return {...p, styleBible:{ ...sb, sceneStyles, sceneStylesManual, sceneWhy }};
  });
  // the film stock (FILM_STOCKS id; "none" = clean digital) — added to every shot prompt
  // a stock you pick is yours: Light the film keeps it unless you ask it to redo your picks (2026-10-08)
  const setFilmStock = (id)=> canMutateSharedFilm() && setProject(p=>({ ...p, styleBible:{ ...((p.styleBible)||{}), filmStock:String(id||"none"), filmStockManual:true } }));
  // EDITABLE LOOKS: the shown set (the starter examples until the film is lit) becomes the film's own
  // on the first edit; deleting a look unassigns the scenes that used it
  const updateStylePreset = (id, patch)=> canMutateSharedFilm() && setProject(p=>{
    const sb = (p.styleBible)||{};
    const cur = (typeof styleBibleOf==="function") ? styleBibleOf(p).presets : (sb.presets||[]);
    return { ...p, styleBible:{ ...sb, presets:cur.map(x=> x.id===id ? { ...x, ...patch, edited:true } : x) } };
  });
  // deleting a look can be undone: the look, and the scenes (with their marks and reasons) that used it
  const deleteStylePreset = (id)=>{ if(!canMutateSharedFilm()) return;
    const sb0 = (project && project.styleBible) || {};
    const cur0 = (typeof styleBibleOf==="function") ? styleBibleOf(project||{}).presets : (sb0.presets||[]);
    const at = cur0.findIndex(x=>x && x.id===id), look = at>=0 ? cur0[at] : null;
    const scenesOf = Object.keys(sb0.sceneStyles||{}).filter(sid=> sb0.sceneStyles[sid]===id);
    const marks = {}, whys = {}; scenesOf.forEach(sid=>{ if((sb0.sceneStylesManual||{})[sid]) marks[sid]=true; if((sb0.sceneWhy||{})[sid]) whys[sid]=sb0.sceneWhy[sid]; });
    const film0 = projIdRef.current;
    setProject(p=>{
      const sb = (p.styleBible)||{};
      const cur = (typeof styleBibleOf==="function") ? styleBibleOf(p).presets : (sb.presets||[]);
      const sceneStyles = {}, sceneStylesManual = {...(sb.sceneStylesManual||{})}, sceneWhy = {...(sb.sceneWhy||{})};
      Object.entries(sb.sceneStyles||{}).forEach(([sid,pid])=>{
        if(pid===id){ delete sceneStylesManual[sid]; delete sceneWhy[sid]; } else sceneStyles[sid]=pid; });
      return { ...p, styleBible:{ ...sb, presets:cur.filter(x=>x.id!==id), sceneStyles, sceneStylesManual, sceneWhy } };
    });
    if(look && typeof window.appToast==="function") window.appToast("\u201c"+(look.name||"Look")+"\u201d deleted"+(scenesOf.length?" \u2014 "+scenesOf.length+" scene"+(scenesOf.length!==1?"s":"")+" no longer use it":"")+".","info",{ action:{ label:"Undo", onClick:()=>{
      if(String(film0||"")!==String(projIdRef.current||"") || artRoomReadOnlyRef.current) return;
      setProject(p=>{ const sb=(p.styleBible)||{};
        const cur = (typeof styleBibleOf==="function") ? styleBibleOf(p).presets : (sb.presets||[]);
        if(cur.some(x=>x && x.id===look.id)) return p;
        const presets = cur.slice(); presets.splice(Math.min(at, presets.length), 0, look);
        const sceneStyles = {...(sb.sceneStyles||{})}; scenesOf.forEach(sid=>{ if(!sceneStyles[sid]) sceneStyles[sid]=look.id; });
        return { ...p, styleBible:{ ...sb, presets, sceneStyles,
          sceneStylesManual:{...(sb.sceneStylesManual||{}), ...marks}, sceneWhy:{...(sb.sceneWhy||{}), ...whys} } }; }); } } }); };

  // ---- Art Room: SHOT LIST ----
  // Default: one screenplay opening keyframe per beat. Saved alternatives are
  // preserved until an explicit conversion archives them in restorable Trash.
  // opts.migration: a tidy-up that doesn't change what the frame was made from (it keeps the revision, so
  // approved frames stay current) and stays SILENT for a role that can't save shots (2026-10-09)
  const updateShot = (id,patch,opts)=>{
    const migration = !!(opts && opts.migration);
    if(migration ? (projectLoadingRef.current || shotsReadOnlyRef.current || shotsStageOnlyRef.current) : !canMutateShots()) return;
    if(!migration && shotsStageOnlyRef.current && Object.keys(patch||{}).some(k=>STAGE_SHOT_FIELDS.indexOf(k)<0)){ _stageScopeNotice(); return; }
    setShots(ss=>ss.map(s=>{
    if(s.id!==id) return s;
    const next={...s,...patch};
    const before=(typeof shotSpecFingerprint==="function")?shotSpecFingerprint(s):"";
    const after=(typeof shotSpecFingerprint==="function")?shotSpecFingerprint(next):"";
    next.specRev=(typeof shotSpecRevision==="function")?shotSpecRevision(s):(Math.max(1,Number(s.specRev)||1));
    if(before!==after && !migration) next.specRev++;
    next.specHash=after;
    return next;
    }));
  };
  try{ window.turnUpdateShot = updateShot; }catch(e){}   // for shared frame code outside the card (an upload's approval)
  // deleting a shot can be undone right away (it also sits in Recently deleted)
  const deleteShot = (id)=>{
    if(!canDesignShots()) return;
    const sh = (shots||[]).find(x=>x.id===id); if(!sh) return;
    setShots(ss=>ss.filter(s=>s.id!==id));
    setTrash(t=>({ ...t, shots:[ _trashStamp(sh), ...(t.shots||[]).filter(x=>x.id!==id) ] }));
    const film0 = projIdRef.current;
    if(typeof window.appToast==="function") window.appToast("Shot deleted \u2014 it's in Recently deleted.","info",{ action:{ label:"Undo", onClick:()=>{
      if(String(film0||"")!==String(projIdRef.current||"")) return; restoreShot(id); } } });
  };
  const restoreShot = (id)=>{
    if(!canDesignShots()) return;
    const item = (trashRef.current.shots||[]).find(x=>x.id===id); if(!item) return;
    // a live shot with the same id is already there: say so and keep the binned copy (2026-10-09 — it was
    // dropped silently); a shot whose scene is gone can't come back on its own
    if((shotsRef.current||shots||[]).some(s=>s && s.id===id)){
      if(typeof window.appToast==="function") window.appToast("That shot is already in the scene, so the copy in Recently deleted stays there.","info"); return; }
    if(item.sceneId && !(scenesRef.current||scenes||[]).some(sc=>sc && sc.id===item.sceneId)){
      if(typeof window.appToast==="function") window.appToast("Its scene was deleted \u2014 restore the scene first (Undo on the scene), then the shot.","info"); return; }
    const { _deletedAt, ...clean } = item;
    setShots(ss=> ss.some(s=>s.id===id) ? ss : [...ss, clean].sort((a,b)=>
      String(a.sceneId||"").localeCompare(String(b.sceneId||"")) ||
      ((Number(a.beatN)||0)-(Number(b.beatN)||0)) ||
      ((Number(a.order)||0)-(Number(b.order)||0))));
    setTrash(t=>({ ...t, shots:(t.shots||[]).filter(x=>x.id!==id) }));
  };
  const purgeShot = async (id)=>{
    if(!canDesignShots()) return;
    const item = (trash.shots||[]).find(x=>x.id===id);
    if(!item) return;
    try{
      // never the frame of a LIVE shot with the same id (2026-10-09 — an Art Room undo can bring a binned shot back)
      const live = (shotsRef.current||shots||[]).some(s=>s && s.id===id);
      if(!live && typeof nbClearAsset==="function") await nbClearAsset(id);
      setTrash(t=>({ ...t, shots:(t.shots||[]).filter(x=>x.id!==id) }));
    }catch(e){ if(window.appToast) window.appToast("Couldn't permanently delete this shot's asset. It stays in Recently deleted so you can try again.","error"); }
  };

  // ── Phase 2: line audio = the cut clock ──────────────────────────────────────
  // Render a shot's dialogue through its speaker's LOCKED voice; the MEASURED
  // duration becomes the shot's `dur`, which re-clocks the Stage automatically
  // (shotDur prefers dur → sceneSequences / cut-rhythm / runtime all re-partition).
  // (the film-wide "Voice all lines" batch was never shown anywhere — removed 2026-10-09, Stage review;
  // a clip is voiced from its own "Voice clip now")
  const resolveLineSpeaker = (shot)=>{
    const scene = scenes.find(s=>s.id===shot.sceneId);
    if(!scene) throw new Error("This line has no scene, so its speaker can\u2019t be verified.");
    const norm=v=>String(v||"").toLowerCase().replace(/\(cont'?d\)/ig,"").replace(/[^a-z0-9]+/g," ").trim();
    const exactCharacter=(id,name)=>{
      if(id){ const c=(characters||[]).find(x=>String(x.id)===String(id)); if(c)return c; }
      const n=norm(name),hits=(characters||[]).filter(c=>norm(c&&c.name)===n);
      return hits.length===1?hits[0]:null;
    };
    const saved=Array.isArray(shot.dialogueLines)?shot.dialogueLines.filter(r=>r&&String(r.text||"").trim()):[];
    if(saved.length>1) throw new Error("This shot owns more than one spoken line. Assign one screenplay line per shot before voicing.");
    if(saved.length===1){
      const c=exactCharacter(saved[0].speakerId,saved[0].speaker);
      if(c)return {character:c,line:saved[0],text:String(saved[0].text||"").trim()};
      throw new Error("The assigned screenplay speaker no longer matches a character. Reassign this line before voicing.");
    }
    const lines=(typeof stageBeatDialogueLines==="function")
      ? stageBeatDialogueLines(scene,drafts,shot.beatN) : [];
    const index=Number(shot.screenplayDialogueIndex);
    let row=Number.isInteger(index)&&index>=0 ? lines[index] : null;
    if(!row){
      const text=norm(shot.dialogue),matches=(lines||[]).filter(x=>norm(x&&x.text)===text);
      if(matches.length===1)row=matches[0];
      else if(matches.length>1)throw new Error("This dialogue occurs more than once. Assign its exact screenplay occurrence before voicing.");
    }
    if(row){
      const c=exactCharacter(row.speakerId,row.speaker);
      if(c)return {character:c,line:row,text:String(row.text||"").replace(/\s+/g," ").trim()};
    }
    throw new Error("We can\u2019t verify who speaks this line. Assign it from the screenplay before voicing; visual cast is never used to guess a voice.");
  };
  const voiceOneLine = async (shot)=>{
    if(!String(shot.dialogue||"").trim()) return { skipped:true };
    const resolved = resolveLineSpeaker(shot);
    // VOICE THE LINE THE SPEAKER CAME FROM (2026-10-02): a shot tied to a screenplay occurrence
    // by index used to take the speaker from the CURRENT line but speak its OLD saved words —
    // after a script edit, someone else's words in this voice, paid for and instantly stale on
    // the Stage (which checks the audio against the live line). The words are the resolved
    // line's own, and the shot's saved line follows them so Shots, Stage and Mix agree.
    const text = String((resolved&&resolved.text)||shot.dialogue||"").trim();
    if(!text) return { skipped:true };
    const spk = resolved&&resolved.character;
    const performance = resolved&&resolved.line||{};
    if(!spk || !spk.voiceLock || !spk.voiceLock.voiceId)
      throw new Error("No locked voice for "+((spk&&spk.name)||"the speaker")+" — lock one on their character card: The Art Room → Characters tab → the Voice button.");
    const voiceMasterAssetId=(typeof window.vgVoiceMasterAssetId==="function")?window.vgVoiceMasterAssetId(spk.id):("voice-master-"+spk.id);
    const voiceMasterFileName=(typeof window.vgVoiceMasterFileName==="function")?window.vgVoiceMasterFileName(spk.name):((spk.name||"Character").replace(/[^A-Za-z0-9]+/g,"_")+"_voice.mp3");
    const r = await window.elGenerate(shot.id, text, { voiceId:spk.voiceLock.voiceId, settings:spk.voiceLock.defaults,
      ...characterMediaOptions(spk),
      voiceLock:spk.voiceLock,projectId:currentProjectId||"local",
      assetRole:"dialogue_line",characterId:spk.id,characterName:spk.name||"Character",
      modelId:(typeof window.vgDeliveryModelOf==="function") ? window.vgDeliveryModelOf(spk.voiceLock) : (spk.voiceLock.modelId||window.VG_TTS_MODEL) });
    const durSec = Math.max(0.6, Math.round(((r.durationMs||0)/1000 + 0.4)*10)/10);   // measured + lead/tail pad
    updateShot(shot.id, { dur:durSec, ...(text!==String(shot.dialogue||"").trim() ? { dialogue:text } : {}), lineAudio:{ durationMs:r.durationMs||0, voiceId:spk.voiceLock.voiceId,
      voiceName:spk.voiceLock.voiceName||"",voiceRevision:spk.voiceLock.revision||"",
      voiceSignature:r.voiceSignature||spk.voiceLock.fingerprint||"",
      speakerId:spk.id, speaker:spk.name, text,parenthetical:performance.parenthetical||"",
      delivery:performance.delivery||"onscreen",modelId:r.modelId||spk.voiceLock.modelId||"",
      settings:r.settings||spk.voiceLock.defaults||{},provider:r.provider||"",backend:r.backend||"",
      outputFormat:r.outputFormat||"",projectId:currentProjectId||"local",renderedAt:r.renderedAt||new Date().toISOString(),
      hash:r.hash||"",voiceMasterAssetId,voiceMasterFileName,stale:false } });
    return { ok:true, durSec, cached:r.cached };
  };
  // the right to save the line's audio is checked BEFORE the paid voice call (2026-10-09)
  const voiceLine = async (shot)=>{
    if(!canMutateShots()) return;
    try{ const r = await voiceOneLine(shot); if(r && r.ok && !r.cached && typeof window.appToast==="function") window.appToast("Voiced — "+r.durSec+"s","success"); }
    catch(e){ if(typeof window.appToast==="function") window.appToast(String((e&&e.message)||"Voice render failed."),"error"); }
  };
  const addShot = (sceneId, beatN, seed)=>{
    if(!canDesignShots()) return;
    const loc = (typeof locationForScene==="function") ? locationForScene(locations, sceneId) : null;
    const sc = scenes.find(s=>s.id===sceneId);
    const peers = shots.filter(s=>s.sceneId===sceneId);
    const id = "shot-"+sceneId+"-m"+Date.now().toString(36);
    // with a beatN: a SUB-SHOT — joins that beat's coverage right after its last
    // shot in the chain (fractional order keeps sceneShotsOrdered stable).
    // Without: legacy behaviour — a new beat at the end of the scene.
    const inBeat = Number(beatN)>0 ? peers.filter(x=>x.beatN===beatN) : [];
    const bN = Number(beatN)>0 ? Number(beatN) : (peers.length+1);
    const order = inBeat.length ? (Math.max(...inBeat.map(x=>x.order||0)) + 0.01)
      : (Number(beatN)>0 ? (bN-1) : peers.length);
    // seed (optional): pre-fill from an UNCOVERED micro-beat — the action text is
    // that discrete action and covers slots the shot into its checklist row.
    const explicitCharacters=!!(seed&&seed.referenceCharactersSet);
    const referenceCharacterIds=explicitCharacters&&Array.isArray(seed.referenceCharacterIds)
      ? seed.referenceCharacterIds.filter(Boolean) : [];
    const inheritedPlan=inBeat.map(x=>x.beatPlan).find(Boolean);
    setShots(ss=>[...ss, { id, sceneId, beatN:bN, order,
      size:"MS", angle:"eye", move:"static", lens:"50", composition:"",
      subjects:explicitCharacters?referenceCharacterIds:((sc&&sc.driver)?[sc.driver]:[]), locationId:loc?loc.id:"", props:[],
      action:(seed&&seed.action)||"", covers:(seed&&Array.isArray(seed.covers))?seed.covers:[],
      beatPlan:inheritedPlan||undefined,
      referenceLocationsSet:!!(seed&&seed.referenceLocationsSet),
      referenceLocationIds:(seed&&Array.isArray(seed.referenceLocationIds))?seed.referenceLocationIds.filter(Boolean):[],
      referenceCharactersSet:explicitCharacters,
      referenceCharacterIds,
      dialogue:"", negativePrompt:"", manual:true, specRev:1,
      specHash:"" }].map(s=>({...s,specHash:(typeof shotSpecFingerprint==="function")?shotSpecFingerprint(s):""})));
  };
  const completeDraftedShotCoverage = (scene, list)=>{
    const bm = (beatsMap||{})[scene.id] || {};
    const rows = typeof window.shotScreenplayBeatRows==="function"
      ? window.shotScreenplayBeatRows(scene,{drafts,beatsMap})
      : (Array.isArray(bm.rows) ? bm.rows : []);
    if(!rows.length) return [];
    const fallback=typeof deriveShotsHeuristic==="function"
      ? deriveShotsHeuristic(scene,beatsMap,locations,props,characters,drafts) : [];
    return rows.map((row,i)=>{
      const n=Number(row.n)||i+1;
      const source=typeof window.shotBeatScreenplay==="function"
        ? window.shotBeatScreenplay(scene,n,{drafts,characters,beatsMap}) : null;
      if(!source || !source.hasSource) throw new Error("Write the screenplay for scene "+scene.no+", beat "+n+" before designing its opening keyframe.");
      const sh=(list||[]).find(x=>Number(x.beatN)===n)||fallback.find(x=>Number(x.beatN)===n);
      if(!sh) throw new Error("No screenplay-grounded opening keyframe was returned for beat "+n+".");
      return {...sh,order:i,keyframeMode:"beat-opening",covers:[],beatPlan:null,
        sourceScreenplayRev:source.sourceRev,beatScript:source.text,
        remoteCharacterIds:source.remoteCharacterIds||[]};
    });
  };
  // Never inject, collapse or delete saved coverage during hydration. Conversion
  // is an explicit action; the old primary keeps its ID and extras remain restorable.
  const shotsLiveRef=React.useRef(shots); shotsLiveRef.current=shots;
  const keyframeBusyRef=React.useRef(new Set());
  const microCleanupBusyRef=React.useRef(false);
  // Explicit, current-film cleanup only. Assets stay on their IDs so existing
  // media/take histories and the normal Shots Trash restore path remain intact.
  const removeMicroBeatShots=async ()=>{
    if(microCleanupBusyRef.current || !canMutateSharedFilm()) return;
    if(typeof window.legacyMicroBeatShotCleanup!=="function"){
      if(window.appToast) window.appToast("Shot cleanup is unavailable. Nothing was removed.","error");
      return;
    }
    const before=shotsLiveRef.current;
    const plan=window.legacyMicroBeatShotCleanup(before);
    if(!plan.removable.length){
      if(window.appToast) window.appToast(plan.uncertain.length
        ? "No shots could be safely identified for removal. "+plan.uncertain.length+" older shot(s) have unclear provenance and were left untouched."
        : "No old micro-beat shots remain. Nothing was changed.","info");
      return;
    }
    const projectId=projIdRef.current;
    const epoch=typeof nbEpoch==="function"?nbEpoch():null;
    const signature=JSON.stringify(before);
    const assertCurrent=()=>{
      if(!canMutateSharedFilm()) throw new Error("You no longer have permission to change this film. Nothing was removed.");
      if(projIdRef.current!==projectId || (epoch!==null&&(typeof nbEpoch!=="function"||nbEpoch()!==epoch))
        || JSON.stringify(shotsLiveRef.current)!==signature)
        throw new Error("The film or shot list changed while cleanup was open. Nothing was removed; review the current list and try again.");
      if(keyframeBusyRef.current.size || shotsLiveRef.current.some(sh=>
        (window.__nbGenInflight&&window.__nbGenInflight[sh.id])
        || (window.__nbShotPhase&&window.__nbShotPhase[sh.id])))
        throw new Error("Finish or stop shot drafting and generation before removing old coverage. Nothing was removed.");
    };
    microCleanupBusyRef.current=true;
    try{
      assertCurrent();
      const affected=new Set(plan.removable.map(sh=>sh.sceneId));
      const previews=plan.removable.slice(0,6).map(sh=>{
        const sc=scenesRef.current.find(s=>s.id===sh.sceneId);
        return "Scene "+(sc?sc.no:sh.sceneId)+" · Beat "+(sh.beatN||"—")+" · "+(sh.size||"Shot")
          +(sh.action?" — "+String(sh.action).replace(/\s+/g," ").slice(0,90):"");
      });
      const body="Move "+plan.removable.length+" identified micro-beat shot(s) across "+affected.size+" scene(s) in this film to Recently deleted in Shots?"
        +" This includes an old primary shot if it still has its original micro-beat mapping. New beat-opening keyframes and manually added shots are kept."
        +" Removed shots stop being active continuity references. Images, version histories and takes are preserved and can be recovered by restoring the shots."
        +" Some beats may be left without a shot. No replacement specifications or images will be generated, and no credits will be spent."
        +(plan.uncertain.length?" "+plan.uncertain.length+" shot(s) with unclear provenance will be left untouched.":"")
        +"\n\n"+previews.join("\n")+(plan.removable.length>previews.length?"\n…and "+(plan.removable.length-previews.length)+" more.":"");
      // Without a confirmation surface, fail closed rather than remove on click.
      if(typeof window.appConfirm!=="function") throw new Error("Cleanup needs a confirmation dialog. Nothing was removed.");
      const confirmed=await window.appConfirm({title:"Remove old micro-beat shots?",body,
        confirmLabel:"Move to Recently deleted",cancelLabel:"Cancel",danger:true});
      if(!confirmed) return;
      assertCurrent();
      const ids=new Set(plan.removable.map(sh=>sh.id));
      const archived=plan.removable.map(_trashStamp);
      const remaining=shotsLiveRef.current.filter(sh=>!ids.has(sh.id));
      setTrash(t=>({...t,shots:[...archived,...(t.shots||[]).filter(sh=>!ids.has(sh.id))]}));
      shotsLiveRef.current=remaining;
      setShots(remaining);
      if(window.appToast) window.appToast(archived.length+" micro-beat shot(s) moved to Recently deleted. Images and takes were kept; no replacements were generated.","ok");
    }catch(e){
      if(window.appToast) window.appToast(String((e&&e.message)||"Cleanup failed. Nothing was removed."),"error");
    }finally{ microCleanupBusyRef.current=false; }
  };
  const shotReferenceDeleteBusyRef=React.useRef(false);
  const [deletingShotReference,setDeletingShotReference]=React.useState(false);
  const deleteShotReference=async (shotId,reference)=>{
    if(shotReferenceDeleteBusyRef.current) return;
    const say=(text,type)=>{ if(window.appToast) window.appToast(text,type); };
    if(!canMutateSharedFilm()){ say("You do not have permission to delete this film's images.","error"); return; }
    const before=shotsLiveRef.current;
    const shot=before.find(s=>s.id===shotId);
    const source=reference&&before.find(s=>s.id===reference.id);
    if(!shot || !source || shot.sceneId!==source.sceneId || typeof window.seedShotOf!=="function"){
      say("The selected reference could not be identified. Nothing was deleted.","error"); return;
    }
    const sceneShots=before.filter(s=>s.sceneId===shot.sceneId);
    const candidate=window.seedShotOf({...shot,anchor:false},sceneShots);
    if(!candidate || candidate.id!==source.id || !reference.iso){
      say("This thumbnail's exact saved image version could not be verified. Nothing was deleted.","error"); return;
    }
    const projectId=projIdRef.current, epoch=typeof nbEpoch==="function"?nbEpoch():null;
    let signature=JSON.stringify(before), detached=false;
    const assertCurrent=()=>{
      if(!canMutateSharedFilm()) throw new Error("Image deletion stopped because your permission changed.");
      if(projIdRef.current!==projectId || (epoch!==null&&nbEpoch()!==epoch))
        throw new Error("Image deletion stopped because the open film changed.");
      if(JSON.stringify(shotsLiveRef.current)!==signature)
        throw new Error("The shot list changed. Review the current reference before deleting it.");
      if(keyframeBusyRef.current.size || shotsLiveRef.current.some(s=>
        (window.__nbGenInflight&&window.__nbGenInflight[s.id])
        || (window.__nbShotPhase&&window.__nbShotPhase[s.id])))
        throw new Error("Finish or stop shot drafting and rendering before deleting a reference image.");
    };
    shotReferenceDeleteBusyRef.current=true;
    try{
      assertCurrent();
      if(typeof window.nbPrepareImageDeletion!=="function" || typeof window.nbPurgeImageVersion!=="function")
        throw new Error("Exact image deletion is unavailable. Nothing was deleted.");
      const target=await window.nbPrepareImageDeletion(source.id);
      assertCurrent();
      if(!target || target.id!==source.id || target.iso!==reference.iso
        || (reference.version!=null&&String(target.version)!==String(reference.version)))
        throw new Error("The saved image changed since this thumbnail loaded. Nothing was deleted; review the new version first.");
      if(target.pending && target.retryable===false){
        say(target.warning||target.cleanupWarning
          ||"Some retained reference copies have insufficient version information to identify them safely. Repeating deletion cannot resolve that uncertainty.","error");
        return;
      }
      const dependents=new Set(sceneShots.filter(s=>{
        const seed=window.seedShotOf(s,sceneShots);
        return seed&&seed.id===source.id;
      }).map(s=>s.id));
      dependents.add(shot.id);
      const scene=scenesRef.current.find(s=>s.id===source.sceneId);
      const label="Scene "+(scene&&scene.no!=null?String(scene.no).padStart(2,"0"):source.sceneId)
        +" · Beat "+source.beatN+(target.version!=null?" · image v"+target.version:"");
      if(typeof window.appConfirm!=="function") throw new Error("Image deletion needs a confirmation dialog. Nothing was deleted.");
      const confirmed=await window.appConfirm({title:target.pending?"Finish deleting this reference image?":"Permanently delete this reference image?",
        body:label+(target.pending
          ? ". This retries the unfinished permanent deletion of the previously selected image and its identifiable saved reference copies. It does not select a different image or a newer version."
          : ". This deletes the exact image shown, plus identifiable saved reference copies of it, from this film's image storage. It cannot be restored from Recently deleted.")
          +" The "+dependents.size+" shot(s) that use it directly will stop using a previous-frame reference and use their selected location, character and prop references instead."
          +" Other image versions, written specifications and video takes are kept. Older versions will NOT automatically replace this image. No new images are generated.",
        confirmLabel:target.pending?"Retry image deletion":"Delete image permanently",cancelLabel:"Cancel",danger:true});
      if(!confirmed) return;
      assertCurrent();
      // Detach first so partial storage cleanup can never silently reattach the
      // unwanted image. A failed purge is reported separately and remains retryable.
      const next=shotsLiveRef.current.map(s=>dependents.has(s.id)?{...s,anchor:true}:s);
      shotsLiveRef.current=next; signature=JSON.stringify(next); setShots(next); detached=true;
      setDeletingShotReference(true);
      const result=await window.nbPurgeImageVersion(target,{cancelled:()=>{
        try{ assertCurrent(); return false; }catch(e){ return true; }
      }});
      assertCurrent();
      if(!result || !result.ok) throw new Error((result&&result.error)||"Permanent deletion could not be confirmed.");
      const after=shotsLiveRef.current.map(s=>s.id===source.id?{...s,locked:false,sourceOverride:null}:s);
      shotsLiveRef.current=after; setShots(after);
      if(result.cleanupWarning){
        say("Reference removed from generation, but permanent storage cleanup is not complete: "+result.cleanupWarning
          +" See the reference strip for the remaining cleanup status.","error");
      }else{
        say("The selected image and its identified saved reference copies were permanently deleted. Other versions and takes were kept. No replacement image was generated.","ok");
      }
    }catch(e){
      say((detached?"The previous-frame reference was excluded. ":"")+String((e&&e.message)||"Image deletion failed.")
        +(detached?" Permanent deletion was not confirmed. The original delete action or pending-cleanup control can retry it.":""),"error");
    }finally{
      shotReferenceDeleteBusyRef.current=false;
      setDeletingShotReference(false);
    }
  };
  const keyframeInputsRef=React.useRef(null);
  keyframeInputsRef.current={scenes,beatsMap,locations,props,project};
  const keyframeScope=(scene,beatN)=>{
    const projectId=projIdRef.current;
    const epoch=typeof nbEpoch==="function"?nbEpoch():null;
    const screenplay=draftsRef.current[scene.id];
    const cast=charactersRef.current;
    const select=ss=>(ss||[]).filter(sh=>sh.sceneId===scene.id && (beatN==null || Number(sh.beatN)===Number(beatN)));
    const signature=JSON.stringify(select(shotsLiveRef.current));
    const inputSignature=()=>{
      const live=keyframeInputsRef.current;
      return JSON.stringify({scene:live.scenes.find(s=>s.id===scene.id),
        screenplay:draftsRef.current[scene.id],cast:charactersRef.current,
        beats:live.beatsMap[scene.id],locations:live.locations,props:live.props,project:live.project});
    };
    const signedInputs=inputSignature();
    return ()=>{
      if(!canDesignShots()) throw new Error("You no longer have permission to change this film's shots.");
      if(shotReferenceDeleteBusyRef.current) throw new Error("Wait for reference image deletion to finish before drafting a specification.");
      if(projIdRef.current!==projectId
        || (epoch!==null && (typeof nbEpoch!=="function" || nbEpoch()!==epoch))
        || draftsRef.current[scene.id]!==screenplay || charactersRef.current!==cast
        || !scenesRef.current.some(s=>s.id===scene.id)
        || inputSignature()!==signedInputs
        || JSON.stringify(select(shotsLiveRef.current))!==signature)
        throw new Error("The film, screenplay, beats, production references or shots changed while this keyframe was being drafted. Nothing was replaced; try again with the current version.");
      if(shotsLiveRef.current.some(sh=>sh.sceneId===scene.id &&
        ((window.__nbGenInflight&&window.__nbGenInflight[sh.id])
          || (window.__nbShotPhase&&window.__nbShotPhase[sh.id]))))
        throw new Error("Finish or stop this scene's frame generation before drafting a specification. Nothing was replaced.");
    };
  };
  const commitBeatKeyframes=(made,assertCurrent)=>{
    assertCurrent();
    const merged=window.mergeBeatKeyframes(shotsLiveRef.current,made);
    if(merged.archived.length) setTrash(t=>({...t,shots:[
      ...merged.archived.map(_trashStamp),
      ...(t.shots||[]).filter(sh=>!merged.archived.some(a=>a.id===sh.id))
    ]}));
    shotsLiveRef.current=merged.shots;
    setShots(merged.shots);
    return merged;
  };
  const [splittingBeat, setSplittingBeat] = React.useState(null);
  const [refiningBeat, setRefiningBeat] = React.useState(null);
  // Explicit screenplay → opening-keyframe conversion; media stays on its ID.
  const refineBeatFromScreenplay = async (scene, beatN)=>{
    const key=scene&&scene.id+"#"+beatN;
    if(!scene) return;
    if(!canMutateSharedFilm()){
      if(window.appToast) window.appToast("You do not have permission to draft this film's shot specifications.","error");
      return;
    }
    if(keyframeBusyRef.current.size){
      if(window.appToast) window.appToast("A shot specification is already being drafted. Wait for it to finish before starting another.","info");
      return;
    }
    keyframeBusyRef.current.add(scene.id);
    try{
      const source=typeof window.shotBeatScreenplay==="function"
        ? window.shotBeatScreenplay(scene,beatN,{drafts,characters,beatsMap}) : null;
      if(!source || !source.hasSource) throw new Error("Write this beat's screenplay before drafting its opening keyframe.");
      const existing=shotsLiveRef.current.filter(x=>x.sceneId===scene.id&&Number(x.beatN)===Number(beatN))
        .sort((a,b)=>(a.order||0)-(b.order||0));
      const assertCurrent=keyframeScope(scene,beatN);
      assertCurrent();
      if(existing.length){
        const body="Draft the specification for one opening keyframe from this beat's screenplay. The primary shot keeps its ID and image history; its previous frame may need regeneration."
          +(existing.length>1?" The "+(existing.length-1)+" additional shot(s) move to Recently deleted in Shots, where you can restore them.":"")
          +" No images or takes are deleted. Writing-model credits only; frame generation is separate.";
        const body2=body+redraftReplaces(existing);
        const ok=typeof window.appConfirm==="function"
          ? await window.appConfirm({title:"Draft Beat "+beatN+"'s specification again (writing credits)?",body:body2,confirmLabel:"Draft specification",cancelLabel:"Cancel"})
          : window.confirm(body2);
        if(!ok) return;
        assertCurrent();
      }
      if(typeof aiDraftShots!=="function") throw new Error("Shot specification drafting is unavailable. Nothing was changed.");
      // Confirmation is not model work: show the shared progress dialog only
      // after approval, while the writing request is actually in progress.
      setRefiningBeat(key);
      const raw=await aiDraftShots(scene,beatsMap,drafts,locations,props,characters,lbProject("shots"),{beatN,refine:true});
      assertCurrent();
      const row=Array.isArray(raw)&&raw.find(r=>r&&Number(r.beat)===Number(beatN));
      if(!row) throw new Error("No opening keyframe was returned. Nothing was changed.");
      const order=existing.length?existing[0].order:Number(beatN)-1;
      const next={...normalizeShot({...row,keyframeMode:"beat-opening",covers:[],beatPlan:null},scene,order,locations,props,characters,beatsMap,drafts),
        order,sourceScreenplayRev:source.sourceRev,beatScript:source.text};
      const result=commitBeatKeyframes([next],assertCurrent);
      if(window.appToast) window.appToast("Specification ready for Beat "+beatN+". "+(result.archived.length?"Additional shots were kept in Recently deleted. ":"")+"No image was generated. Generate the frame when you're ready.","ok");
    }catch(e){ if(window.appToast) window.appToast(String((e&&e.message)||"Opening-keyframe draft failed."),"error"); }
    finally{ keyframeBusyRef.current.delete(scene.id); setRefiningBeat(null); }
  };
  const splitBeatCoverage = refineBeatFromScreenplay;
  // Derive scene keyframes. Explicit replacement archives alternatives, never media.
  // Returns a STRUCTURED OUTCOME ({status:"designed"|"fallback"|"failed", sceneId, label,
  // error?}) — review finding: a thrown provider error used to vanish silently, leaving
  // the scene shotless with no explanation. Callers surface failures truthfully.
  // VERBATIM ENFORCEMENT (the script is canon): models paraphrase scripted lines no matter the instruction —
  // snap each shot's dialogue to the closest line in the scene's screenplay when they clearly match. Exact
  // lines matter downstream: the Stage voices and clocks clips with them. (Shared by the Shots re-draft and
  // the Shot Designer since 2026-10-09 — the agent's path used to skip it.)
  const snapShotDialogue = (scene, made)=>{
    const D = draftsRef.current||drafts;
    const _dlines = ((D[scene.id]&&D[scene.id].blocks)||[])
      .filter(b=>b.type==="dia").map(b=>String(b.text||"").replace(/\s+/g," ").trim()).filter(Boolean);
    if(!_dlines.length) return made;
    const _toks=(t)=>String(t||"").toLowerCase().replace(/[^a-z0-9' ]/g," ").split(/\s+/).filter(w=>w.length>2);
    (made||[]).forEach(sh=>{
      if(!sh.dialogue) return;
      // strip a leading speaker cue ("OLIVIA:", "REECE (O.S.):") and curly
      // quotes — the field holds ONLY the spoken words (the Stage voices it)
      sh.dialogue = String(sh.dialogue).replace(/^[A-Z][A-Z .''()\-]{1,34}:\s*/,"").replace(/^["\u201c]|["\u201d]$/g,"").trim();
      const st=new Set(_toks(sh.dialogue)); if(!st.size) return;
      let best=null, bestScore=0;
      _dlines.forEach(l=>{ const lt=_toks(l); if(!lt.length) return;
        const overlap=lt.filter(w=>st.has(w)).length/Math.max(lt.length,st.size);
        if(overlap>bestScore){ bestScore=overlap; best=l; } });
      if(best && bestScore>=0.35) sh.dialogue=best;
    });
    return made;
  };
  // only beats the model ANSWERED replace saved work; an unanswered beat that already has a shot keeps it
  const keepUnansweredBeats = (scene, raw, made)=>{
    const leftAlone = [];
    if(!Array.isArray(raw)) return { made, leftAlone };
    const answered = new Set(raw.filter(r=>r && r.fromModel!==false).map(r=>Number(r.beat)));
    const live = shotsLiveRef.current.filter(sh=>sh && sh.sceneId===scene.id);
    const kept = (made||[]).filter(sh=>{ const n = Number(sh.beatN);
      if(answered.has(n) || !live.some(x=>Number(x.beatN)===n)) return true;
      if(leftAlone.indexOf(n)<0) leftAlone.push(n); return false; });
    return { made:kept, leftAlone:leftAlone.sort((a,b)=>a-b) };
  };
  const draftOneSceneShots = async (scene, replace)=>{
    const label = "Scene "+String(scene.no||"").padStart(2,"0")+(scene.title?(" \u2014 "+scene.title):"");
    if(keyframeBusyRef.current.has(scene.id)) return {status:"failed",sceneId:scene.id,label,error:"This scene already has a keyframe draft running."};
    if(!replace && shotsLiveRef.current.some(sh=>sh.sceneId===scene.id)) return {status:"skipped",sceneId:scene.id,label};
    const assertCurrent=keyframeScope(scene);
    keyframeBusyRef.current.add(scene.id);
    try{
    assertCurrent();
    let made = null; let usedFallback = false; let raw = null;
    if(typeof aiDraftShots==="function"){
      // the CURRENT inputs (2026-10-09): a film run drafts later scenes after earlier ones finish, and the
      // closure's copies were the ones from when the run started
      const L = keyframeInputsRef.current || {};
      try{ raw = await aiDraftShots(scene, L.beatsMap||beatsMap, draftsRef.current||drafts, L.locations||locations, L.props||props, charactersRef.current||characters, lbProject("shots")); }
      catch(e){
        // a THROWN failure (provider/network/key) is reported as a failure — the heuristic
        // stopgap only stands in for a response that arrived but wasn't usable
        return { status:"failed", sceneId:scene.id, label, error:String((e&&e.message)||"Shot design failed.") };
      }
      assertCurrent();
      if(raw && raw.length && typeof normalizeShot==="function"){
        { const L2 = keyframeInputsRef.current || {};
          made = raw.map((r,i)=>normalizeShot(r, scene, i, L2.locations||locations, L2.props||props, charactersRef.current||characters, L2.beatsMap||beatsMap)); }
        // VERBATIM ENFORCEMENT (the script is canon): models paraphrase scripted
        // lines no matter the instruction — snap each shot's dialogue to the
        // closest line in the scene's screenplay when they clearly match. Exact
        // lines matter downstream: the Stage voices and clocks clips with them.
        snapShotDialogue(scene, made);
        made = completeDraftedShotCoverage(scene, made);
      }
    }
    if(!made && typeof deriveShotsHeuristic==="function"){
      // the AI RESPONDED but returned nothing parseable — the one-shot-per-beat
      // layout below is a STOPGAP, never a silent substitute for real coverage
      // (callers toast/summarize the fallback; a thrown error never lands here)
      made = deriveShotsHeuristic(scene, beatsMap, locations, props, characters, drafts);
      usedFallback = true;
    }
    if(!made || !made.length) return { status:"failed", sceneId:scene.id, label, error:"Write the scene's beat-tagged screenplay before drafting its opening keyframes." };
    made=completeDraftedShotCoverage(scene,made);
    // A BEAT THE MODEL DIDN'T ANSWER KEEPS ITS SHOT (2026-10-09, owner — Shots review): only beats it answered
    // replace saved work; an unanswered beat with no shot yet is filled, and the beats left alone are named
    let leftAlone = [];
    if(!usedFallback){ const k = keepUnansweredBeats(scene, raw, made); made = k.made; leftAlone = k.leftAlone; }
    if(made.length) commitBeatKeyframes(made,assertCurrent);
    return { status:usedFallback?"fallback":"designed", sceneId:scene.id, label, leftAlone };
    }catch(e){ return {status:"failed",sceneId:scene.id,label,error:String(e&&e.message||e)}; }
    finally{ keyframeBusyRef.current.delete(scene.id); }
  };
  // WHAT A RE-DRAFT REPLACES, said up front (2026-10-09, owner — Shots review): approvals on changed beats,
  // Actions written by hand, hand-picked characters
  const redraftReplaces = (list)=>{
    const L = list||[], n = (f)=> L.filter(f).length;
    const approved = n(x=>x && (x.locked||x.approved)), byHand = n(x=>x && x.actionByHand), picks = n(x=>x && x.referenceCharactersSet);
    const bits = [];
    if(approved) bits.push(approved+" approved frame"+(approved!==1?"s":"")+" (unapproved where the shot changes)");
    if(byHand) bits.push(byHand+" Action"+(byHand!==1?"s":"")+" you wrote by hand");
    if(picks) bits.push(picks+" hand-picked character choice"+(picks!==1?"s":""));
    return bits.length ? " It replaces "+bits.join(", ")+"." : "";
  };
  const [draftingSceneShots, setDraftingSceneShots] = React.useState(null);
  // ASK FIRST, THEN SHOW THE CARD (2026-10-16): the busy card used to go up before the re-draft question, and
  // the question opened behind it — the card stayed up for ever with nothing running. A second click while
  // the question is open does nothing.
  const sceneShotsAskingRef = React.useRef(false);
  const draftSceneShots = async (scene)=>{
    if(draftingSceneShots || sceneShotsAskingRef.current) return;
    let out = null;
    try{
      const assertCurrent=keyframeScope(scene);
      if(shotsLiveRef.current.some(sh=>sh.sceneId===scene.id)){
        const body="Draft one opening keyframe per screenplay beat. Each primary keeps its shot ID and image history. Additional shots move to Recently deleted in Shots and can be restored. No images or takes are deleted; changed frames need regeneration. Writing-model credits only.";
        const live=shotsLiveRef.current.filter(sh=>sh && sh.sceneId===scene.id);
        const body2=body+redraftReplaces(live);
        sceneShotsAskingRef.current = true;
        let ok = false;
        try{
          ok=typeof window.appConfirm==="function"
            ? await window.appConfirm({title:"Re-draft Scene "+String(scene.no||"").padStart(2,"0")+"'s keyframes (writing credits)?",body:body2,confirmLabel:"Re-draft keyframes",cancelLabel:"Cancel"})
            : window.confirm(body2);
        }finally{ sceneShotsAskingRef.current = false; }
        if(!ok) return;
        assertCurrent();
      }
      setDraftingSceneShots(scene.id);
      out = await draftOneSceneShots(scene, true);
    }
    catch(e){ out = { status:"failed", error:String((e&&e.message)||"Shot design failed.") }; }
    setDraftingSceneShots(null);
    // say what happened — a failed draft must never look like a quiet no-op
    if(out && typeof window.appToast==="function"){
      if(out.status==="failed") window.appToast("Keyframe design failed for this scene \u2014 "+(out.error||"unknown error"),"error");
      else if(out.status==="fallback") window.appToast("The answer couldn't be read, so this scene got simple keyframes from its screenplay. Re-draft to try again.","error");
      else if(out.status==="designed") window.appToast((out.leftAlone && out.leftAlone.length
          ? "Opening keyframes updated \u2014 except Beat"+(out.leftAlone.length!==1?"s ":" ")+out.leftAlone.join(", ")+": the answer stopped before "+(out.leftAlone.length!==1?"them":"it")+", so "+(out.leftAlone.length!==1?"they keep their":"it keeps its")+" shot. Re-draft to try again."
          : "Opening keyframes updated.")+" Previous images are retained; additional shots are restorable in Recently deleted.", out.leftAlone && out.leftAlone.length ? "info" : "success");
    }
  };
  const [draftingAllShots, setDraftingAllShots] = React.useState(false);
  const draftAllShots = async ()=>{
    if(draftingAllShots) return;
    if(!canDesignShots()) return;
    const ordered0 = scenesInStoryOrder(scenes);
    const have0 = new Set(shots.map(s=>s.sceneId));
    const todo0 = ordered0.filter(s=>!have0.has(s.id));
    if(!todo0.length){ if(typeof window.appToast==="function") window.appToast("Every scene already has its keyframes \u2014 re-draft a scene from its own header.","info"); return; }
    // ASKS FIRST, WITH WHAT IT SPENDS (2026-10-09, owner — Shots review): one writing call per scene
    if(typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Draft keyframes for "+todo0.length+" scene"+(todo0.length!==1?"s":"")+" (writing credits)?",
        body:"One writing call per scene that has no shots yet \u2014 "+todo0.length+" call"+(todo0.length!==1?"s":"")+", three at a time. Scenes that already have shots are left as they are. No images are made.",
        items:todo0.slice(0,12).map(sc=>"Scene "+String(sc.no||"").padStart(2,"0")+(sc.title?" \u00b7 "+sc.title:"")),
        confirmLabel:"Draft "+todo0.length, cancelLabel:"Cancel" });
      if(!ok) return;
    }
    setDraftingAllShots(true);
    const results = [];
    const epoch=typeof nbEpoch==="function"?nbEpoch():null;
    try{
      const ordered = scenesInStoryOrder(scenesRef.current||scenes);
      const have = new Set((shotsLiveRef.current||shots).map(s=>s.sceneId));
      const todo = ordered.filter(s=>!have.has(s.id));   // non-destructive: skip scenes already broken down
      for(let i=0;i<todo.length;i+=3){
        if(epoch!==null && (typeof nbEpoch!=="function" || nbEpoch()!==epoch)) break;
        const batch = await Promise.all(todo.slice(i,i+3).map(sc=>
          draftOneSceneShots(sc, false).catch(e=>({ status:"failed", sceneId:sc.id,
            label:"Scene "+String(sc.no||"").padStart(2,"0")+(sc.title?(" \u2014 "+sc.title):""),
            error:String((e&&e.message)||"Shot design failed.") }))));
        results.push(...batch.filter(Boolean));
      }
    }catch(e){}
    setDraftingAllShots(false);
    // HONEST COMPLETION SUMMARY (review finding): name the scenes that failed and how to
    // retry. Failed scenes still have no shots, so 'Design all shots' again retries JUST them.
    if(results.length && typeof window.appToast==="function"){
      const failed = results.filter(r=>r.status==="failed");
      const fb = results.filter(r=>r.status==="fallback").length;
      if(failed.length){
        const names = failed.slice(0,3).map(r=>r.label).join(", ");
        window.appToast("Shot design finished, but "+failed.length+" scene"+(failed.length>1?"s":"")+" failed: "
          +names+(failed.length>3?", \u2026":"")+". Those scenes have no shots yet \u2014 click 'Design all shots' again to retry just them."
          +(fb?(" "+fb+" scene"+(fb>1?"s":"")+" got simple keyframes from the screenplay because the answer couldn't be read \u2014 re-draft those to try again."):""),"error");
      } else if(fb){
        window.appToast("All scenes drafted, but "+fb+" scene"+(fb>1?"s":"")+" got simple keyframes from the screenplay because the answer couldn't be read \u2014 re-draft those to try again.","error");
      } else {
        window.appToast("Keyframes drafted \u2014 "+results.length+" scene"+(results.length>1?"s":"")+" now "+(results.length>1?"have":"has")+" one opening keyframe per beat.","success");
      }
    }
  };

  // Art Room: suggest a character's appearance states (continuity variants) from the script
  const [suggestingStatesId, setSuggestingStatesId] = React.useState(null);
  const suggestCharacterStates = async (ch)=>{
    if(!canMutateSharedFilm() || suggestingStatesId || !(typeof aiSuggestStates==="function")) return;
    setSuggestingStatesId(ch.id);
    const driven = scenes.filter(s=>s.driver===ch.id);
    try{
      const suggested = await aiSuggestStates(ch, driven, project, { scenes, drafts:draftsRef.current||drafts });
      if(suggested && suggested.length){
        setCharacters(cs=>cs.map(c=>{
          if(c.id!==ch.id) return c;
          const existing = c.states || [];
          const have = new Set(existing.map(s=>(s.label||"").trim().toLowerCase()));
          const adds = suggested.filter(s=>!have.has((s.label||"").trim().toLowerCase()));
          return { ...c, states: [...existing, ...adds] };
        }));
      }
    }catch(e){}
    setSuggestingStatesId(null);
  };

  // ---- appearance: dark / light / system ----
  const [theme, setThemeState] = React.useState(()=>{ try{ return localStorage.getItem("turn-theme")||"light"; }catch(e){ return "light"; } });
  const [sysDark, setSysDark] = React.useState(()=> !window.matchMedia || window.matchMedia("(prefers-color-scheme: dark)").matches);
  React.useEffect(()=>{
    if(!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = ()=> setSysDark(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return ()=> mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on);
  },[]);
  const effectiveTheme = theme==="system" ? (sysDark?"dark":"light") : theme;
  const setTheme = (m)=>{ setThemeState(m); try{ localStorage.setItem("turn-theme", m); }catch(e){} };
  React.useEffect(()=>{ document.documentElement.dataset.theme = effectiveTheme; },[effectiveTheme]);

  // large screens keep rail sections open; laptops/tablets/mobile fold them by default
  const [wide, setWide] = React.useState(()=> typeof window==="undefined" || window.innerWidth>=1500);
  React.useEffect(()=>{
    const on = ()=> setWide(window.innerWidth>=1500);
    window.addEventListener("resize", on);
    return ()=> window.removeEventListener("resize", on);
  },[]);

  // when a scene is selected, center it horizontally in the spine/board so the user
  // sees what they just picked (e.g. clicking a scene in the left sidebar)
  React.useEffect(()=>{
    // the spine (homepage style, 2026-10-16): its chart pans sideways inside its own panel and the
    // tiles wrap, so bring the scene's point into the chart's view and its tile into the page's
    if(view==="spine"){
      const timer = setTimeout(()=>{
        const chart = document.querySelector(".spine-chart"), hit = chart && chart.querySelector('.sp-hit[data-sel="1"]');
        if(chart && hit){ const hr = hit.getBoundingClientRect(), kr = chart.getBoundingClientRect();
          if(hr.left < kr.left + 4 || hr.right > kr.right - 4)
            chart.scrollTo({ left: chart.scrollLeft + (hr.left + hr.width/2) - (kr.left + kr.width/2), behavior:"smooth" }); }
        const tile = document.querySelector(".canvas-scroll.spine-pan .stile.sel");
        if(tile && tile.scrollIntoView) tile.scrollIntoView({ block:"nearest", behavior:"smooth" });
      }, 60);
      return ()=> clearTimeout(timer);
    }
    const sel = view==="board" ? ".canvas-scroll.board-pan" : null;
    if(!sel) return;
    const cont = document.querySelector(sel);
    if(!cont) return;
    const timer = setTimeout(()=>{
      const card = cont.querySelector(".scard.sel");
      if(!card) return;
      const cr = card.getBoundingClientRect();
      const kr = cont.getBoundingClientRect();
      if(cr.left >= kr.left + 4 && cr.right <= kr.right - 4) return; // already fully visible
      const delta = (cr.left + cr.width/2) - (kr.left + kr.width/2);
      cont.scrollTo({ left: cont.scrollLeft + delta, behavior:"smooth" });
    }, 60);
    return ()=> clearTimeout(timer);
  },[selId, view]);
  const [agentUndo, setAgentUndo] = React.useState([]);   // stack of pre-run snapshots
  const agentUndoRef = React.useRef(agentUndo); agentUndoRef.current = agentUndo;
  // a film switch drops the other film's agent-undo snapshots: they can never be applied here
  // (2026-09-28 — Undo after a switch used to write film A's story over film B)
  React.useEffect(()=>{
    const k = castDraftFilmKey();
    setAgentUndo(st=> st.some(x=>!x || x.filmKey!==k) ? st.filter(x=>x && x.filmKey===k) : st);
  },[currentProjectId]);
  const draftingRef = React.useRef(false);
  // Scene-id counter. SEEDED FROM THE LOADED SCENES, not a fixed 1000: a bare counter
  // restarts every page load, so session 2's first "+ Add scene" re-issued s1001 and
  // collided with session 1's — two scenes sharing one id share drafts/beats/history,
  // and editing or deleting either hits both.
  const uidRef = React.useRef(1000);
  const newId = ()=>{
    const maxSeen = (scenes||[]).reduce((m,s)=>{
      const hit = String((s&&s.id)||"").match(/^s(\d+)$/);
      const n = hit ? Number(hit[1]) : NaN;
      return Number.isFinite(n) && n>m ? n : m;
    }, uidRef.current);
    uidRef.current = maxSeen + 1;
    return "s"+uidRef.current;
  };
  const renum = (arr)=>arr.map((s,i)=>({...s,no:i+1}));
  // human label describing a draft's provenance
  const labelOf = (v)=> !v ? null : v.edited ? "Manual edit" : v.polished ? "AI polish" : (v.ai ? "AI draft" : (v.auto ? "Structural draft" : "Original draft"));

  // SCRIPT SUBTITLE — static explainer (the provenance badge that used to render here
  // was removed by request; engine/version info still lives in the Undo/Redo tooltips).
  const scriptSubtitle = ()=> "Subtext (beats) becomes text (screenplay)";
  // replace a scene's draft, pushing the old version onto its history stack
  // undo depth per scene. CAPPED (like the image layer's 12 versions): every entry is a
  // full screenplay draft and `history` rides in the saved doc, so an uncapped stack grew
  // the doc on every commit — in local mode it eventually blew the localStorage quota and
  // (because that write is a bare try/catch) saves then failed silently forever.
  const HISTORY_MAX = 12;
  /* commitVersion(id, next, filmToken?) — filmToken (window.turnFilmToken(), captured BEFORE an
     await) makes a late result land only in the film it was asked for (2026-09-28): scene ids
     repeat across films, so a result for film A's Sc 4 must never replace film B's. */
  const commitVersion = (id, next, filmToken)=>{
    if(filmToken!==undefined && filmToken!==castDraftFilmKey()) return false;
    if(!canMutateWritersRoom()) return false;
    const prev = drafts[id];
    // a manual edit or a written beat keeps the card snapshot of the draft it edits
    if(next && !next.cardSnap && prev && prev.cardSnap) next = { ...next, cardSnap:prev.cardSnap };
    /* THE CAP NEVER EATS WHAT UNDO PROMISED (2026-09-28). Every single-line manual edit is a
       version too, so a normal editing pass used to push out the draft a Redraft had promised
       "Undo restores it". Over the cap, the oldest IN-BETWEEN manual step goes first (a manual
       edit that was itself followed by another manual edit); a version that preceded a Redraft,
       a written beat or any AI draft — and the last manual state before one — is dropped only
       when nothing else can be, oldest first, as before. */
    const trim = (back)=>{
      const out = back.slice(), manual = (v)=> !!(v && v.edited);
      while(out.length > HISTORY_MAX){
        let drop = 0;
        for(let i=0;i<out.length;i++){ if(manual(out[i]) && manual(i+1<out.length ? out[i+1] : next)){ drop = i; break; } }
        out.splice(drop, 1);
      }
      return out;
    };
    if(prev) setHistory(h=>{ const e=h[id]||{back:[],fwd:[]};
      return {...h,[id]:{ back:trim([...e.back, prev]), fwd:[] }}; });
    setDrafts(d=>({...d,[id]:next}));
    return true;
  };
  const revertVersion = (id)=>{
    if(!canMutateWritersRoom()) return;
    const e = history[id]; if(!e||!e.back.length) return;
    const prev = e.back[e.back.length-1];
    const cur = drafts[id];
    setHistory(h=>({...h,[id]:{ back:e.back.slice(0,-1), fwd:[cur,...e.fwd] }}));
    setDrafts(d=>({...d,[id]:prev}));
  };
  const redoVersion = (id)=>{
    if(!canMutateWritersRoom()) return;
    const e = history[id]; if(!e||!e.fwd.length) return;
    const nextV = e.fwd[0];
    const cur = drafts[id];
    setHistory(h=>({...h,[id]:{ back:[...e.back,cur], fwd:e.fwd.slice(1) }}));
    setDrafts(d=>({...d,[id]:nextV}));
  };

  // RETRY MEMORY: the newest format rejection per FILM + scene id (scene ids repeat
  // across films — one film's rejected line must never ride into another's prompt). The
  // next Redraft of that scene hands it to the model (aiPolishScene opts.retry →
  // screenplayRetryNote), so "press Redraft again" is never the identical request; a
  // success clears it.
  const polishRetryRef = React.useRef({});
  const rememberRejection = (id, f)=>{
    if(id==null) return;
    const k = String(currentProjectId||"")+"::"+id;
    // a format rejection, or a redraft discarded for running longer than the current script
    if(f && (f.kind==="invalid" || f.kind==="long")) polishRetryRef.current[k] = f; else delete polishRetryRef.current[k];
  };
  /* NEEDS REDRAFT: every written draft carries the snapshot of the card it was
     written from (sceneCardSnap); a card that has changed since marks the script as
     out of date, with one-click Redraft (redraftScene) or Keep this draft. */
  const stampDraft = (res, scn, b)=> (res && typeof window.sceneCardSnap==="function")
    ? { ...res, cardSnap: window.sceneCardSnap(scn, characters, b || beatsMap[scn.id]) } : res;
  /* ONE DRAFT AT A TIME, NEVER STUCK (2026-10-09, owner — Writers' Room review): a second paid Draft could
     start from the keyboard behind the overlay, a failure left the overlay up, and a draft that landed
     meanwhile was overwritten. Its Stop ends it after the scene's beats (before the screenplay call). */
  const draftOne = async (s)=>{
    if(!canMutateWritersRoom() || drafts[s.id] || draftingRef.current) return;
    const run = { stop:false, one:true };
    draftingRef.current = run;
    let res = null, scn = s, beats = beatsMap[s.id], landed = false;
    try{
    const ordered=scenesInStoryOrder(scenes);
    const i = ordered.findIndex(x=>x.id===s.id);
    const prev=i>0?ordered[i-1]:null;
    // Stop is offered only while there's a second call to save (the beats are written first)
    setDrafting({ i:i<0?0:i, total:ordered.length, one:true, canStop:!beats && typeof aiAuthorScene==="function" });
    // a beats-less scene: author the whole scene (summary, charge, beats) first
    // the film this draft belongs to — a scene written after the user switches films
    // must not land in the new one (scene ids repeat across films)
    const owner = currentProjectId;
    if(!beats && typeof aiAuthorScene==="function" && aiAvailable()){
      const authored = await aiAuthorScene(s, prev, characters, project, { keepCard:true });
      if(owner !== projIdRef.current || !canMutateWritersRoom()) return;
      if(authored){
        scn = {...s, ...authored.patch}; beats = authored.beats;
        setScenes(ss=>ss.map(x=>x.id===s.id?{...x,...authored.patch}:x));
        setBeatsFor(s.id, authored.beats);
      }
      if(run.stop){ if(typeof window.appToast==="function") window.appToast("Stopped \u2014 Scene "+s.no+"'s beats are kept; its screenplay wasn't written.","info"); return; }
    }
    res = await aiDraftScene(scn, beats, prev, project);
    if(owner !== projIdRef.current || !canMutateWritersRoom()) return;
    // a draft that landed meanwhile (another tab, a collaborator) isn't overwritten: this one is committed as a new
    // version, so the other stays in the scene's history (Undo restores it)
    if((draftsRef.current||{})[s.id]){ commitVersion(s.id, stampDraft(res, scn, beats)); landed = true; }
    else setDrafts(d=>({...d,[s.id]:stampDraft(res, scn, beats)}));
    }catch(e){
      if(typeof window.appToast==="function") window.appToast("Scene "+s.no+" couldn't be drafted ("+String((e&&e.message)||"the writing service failed")+") \u2014 try again.","error");
      return;
    } finally { draftingRef.current = false; setDrafting(null); }
    if(landed) return;
    // a rough structural stand-in landed instead of the model's prose \u2014 say why, never silently
    const failure = res && res.auto && res.failure;
    if(failure){
      rememberRejection(s.id, failure);   // the Redraft it points to is told what was rejected
      if(typeof window.appToast==="function" && typeof window.screenplayFailureMessage==="function")
        window.appToast(window.screenplayFailureMessage("draft", s.no, failure,
          { kept:"A rough structural draft from its beats stands in.", retryLabel:"press Redraft script from beats", carries:true }), "error", { force:true });
    }
  };
  const draftAll = async ()=>{
    if(!canMutateWritersRoom() || draftingRef.current) return;
    /* AUTO-DRAFT ALL ASKS FIRST (2026-10-09, owner — Writers' Room review): one click started a paid call
       per undrafted scene (two for a scene without beats) with no word */
    { const todo = scenesInStoryOrder(scenes).filter(x=>!drafts[x.id]);
      if(!todo.length) return;
      const calls = todo.reduce((t,x)=>t+(beatsMap[x.id] ? 1 : 2), 0);
      if(typeof window.appConfirm==="function"){
        const ok = await window.appConfirm({ title:"Draft "+todo.length+" scene"+(todo.length!==1?"s":"")+"?",
          body:"Writes the screenplay of every scene that isn't drafted yet, in story order"
            +(todo.some(x=>!beatsMap[x.id]) ? " (a scene without beats gets its beats written first)" : "")+" \u2014 "
            +((typeof window.turnWritingCallsText==="function") ? window.turnWritingCallsText(calls, "story") : (calls+" writing calls"))
            +" (writing credits; each call is charged for what it uses). Stop ends the run after the scene being written.",
          confirmLabel:"Draft "+todo.length+" scene"+(todo.length!==1?"s":"") });
        if(!ok || !canMutateWritersRoom() || draftingRef.current) return;
      } }
    // the run's own record (truthy = a run is live): .stop is set by the progress overlay's Stop
    const run = { stop:false };
    draftingRef.current = run;
    // One canonical, mutable story-order snapshot for the whole run. When authoring
    // fills a blank scene, patch this working sequence before drafting its successor
    // so continuity never reads the stale render-closure scene.
    const working = scenesInStoryOrder(scenes).map(s=>({...s}));
    const tot = working.length;
    const have = {...drafts};
    const owner = currentProjectId;   // abort the whole run if the user switches films
    const standIns = [];              // { no, failure } \u2014 rough stand-ins, reported at the end
    // STOP ON A FAILURE RETRYING CAN'T FIX (2026-09-28, agents.jsx failureNeedsAction): out of
    // plan credits, signed out, the provider account dry. Every later scene would fail the same
    // way and become a rough stand-in (which then counts as drafted, so "Auto-draft all" would
    // vanish). The run stops there instead: everything written is kept, that scene and the
    // rest are left UNDRAFTED — so "Auto-draft all" picks them up later — and it says why once.
    const aiAtStart = (typeof aiAvailable==="function") && aiAvailable();
    const needsAction = (f)=> !!(aiAtStart && f && (typeof window.turnFailureNeedsAction==="function"
      ? window.turnFailureNeedsAction(f) : (f.kind==="plan" || f.kind==="signin" || f.kind==="credits")));
    // …and the same service failure on two scenes in a row (2026-09-28, agents.jsx
    // repeatedServiceFailure): the first keeps its rough stand-in, the second and the rest stay undrafted
    let prevFail = null;
    const repeatedFail = (f)=> !!(aiAtStart && typeof window.turnRepeatedServiceFailure==="function" && window.turnRepeatedServiceFailure(prevFail, f));
    let halted = null, stoppedAt = null, drafted = 0;
    try{
      for(let i=0;i<tot;i++){
        if(owner !== projIdRef.current || writersRoomReadOnlyRef.current) break;
        const s = working[i], prev=i>0?working[i-1]:null;
        if(run.stop && !have[s.id]){ stoppedAt = s; break; }
        setDrafting({ i, total:tot, ...(run.stop ? { stopping:true } : {}) });
        if(have[s.id]) continue;
        let scn = s, beats = beatsMap[s.id];
        if(!beats && typeof aiAuthorScene==="function" && aiAvailable()){
          const authored = await aiAuthorScene(s, prev, characters, project, { keepCard:true });
          if(owner !== projIdRef.current || writersRoomReadOnlyRef.current) break;
          if(authored){
            scn = {...s, ...authored.patch}; working[i]=scn; beats = authored.beats;
            setScenes(ss=>ss.map(x=>x.id===s.id?{...x,...authored.patch}:x));
            setBeatsFor(s.id, authored.beats);
          }
          if(run.stop){ stoppedAt = s; break; }   // Stop while its beats were written: they're kept
        }
        const raw = await aiDraftScene(scn, beats, prev, project);
        if(owner !== projIdRef.current || writersRoomReadOnlyRef.current) break;
        if(raw && raw.auto && needsAction(raw.failure)){ halted = { no:s.no, failure:raw.failure }; break; }
        if(raw && raw.auto && repeatedFail(raw.failure)){ halted = { no:s.no, failure:raw.failure, repeated:true }; break; }
        prevFail = (raw && raw.auto && raw.failure) || null;
        if(raw && raw.auto && raw.failure){ standIns.push({ no:s.no, failure:raw.failure }); rememberRejection(s.id, raw.failure); }
        const res = stampDraft(raw, scn, beats);
        have[s.id] = res; drafted++;
        setDrafts(d=>({...d,[s.id]:res}));
      }
      setDrafting({ i:tot, total:tot });
      setTimeout(()=>setDrafting(null), 320);
    } finally {
      draftingRef.current = false;
      // scenes that got a rough stand-in instead of the model's prose are named, EACH with its
      // own reason (a format rejection and a service error are different problems)
      if(standIns.length && typeof window.appToast==="function" && typeof window.screenplayBatchFailureMessage==="function")
        window.appToast(window.screenplayBatchFailureMessage(
          (standIns.length!==1 ? standIns.length+" scenes" : "Scene "+standIns[0].no)+" got a rough structural draft instead \u2014 ", standIns,
          { next:"Open "+(standIns.length!==1?"each":"it")+" and press Redraft script from beats", carries:true }), "error", { force:true });
      const left = working.filter(x=>!have[x.id]).length;
      if(halted && typeof window.appToast==="function"){
        const why = (typeof window.screenplayFailureReason==="function") ? window.screenplayFailureReason(halted.failure) : "the writing service can\u2019t be reached";
        const next = (typeof window.screenplayFailureAdvice==="function") ? window.screenplayFailureAdvice(halted.failure, "press Auto-draft all to finish them") : "Press Auto-draft all to finish them.";
        window.appToast("Auto-draft all stopped at Scene "+halted.no+" \u2014 "+why+(halted.repeated
          ? ", for the second scene in a row, so the other scenes would most likely fail the same way. "
          : ", so the other scenes would fail the same way. ")+
          (drafted ? drafted+" scene"+(drafted!==1?"s were":" was")+" drafted and kept; " : "")+
          left+" scene"+(left!==1?"s are":" is")+" left undrafted (no rough stand-ins). "+next, "error", { force:true });
      } else if(stoppedAt && typeof window.appToast==="function"){
        window.appToast("Auto-draft all stopped"+(drafted ? " \u2014 "+drafted+" scene"+(drafted!==1?"s were":" was")+" drafted and kept" : "")+". "+
          left+" scene"+(left!==1?"s are":" is")+" still undrafted \u2014 press Auto-draft all to continue.", "info");
      }
    }
  };
  // the drafting overlay's Stop: the run ends after the scene it is writing now (that scene is kept)
  const stopDraftAll = ()=>{
    const run = draftingRef.current;
    if(run && typeof run==="object" && !run.stop){ run.stop = true; setDrafting(d=> d ? { ...d, stopping:true } : d); }
  };
  // polish: regenerate one scene's prose as genuinely new final text (beats locked)
  const [polishBusy, setPolishBusy] = React.useState(null);
  // NEVER SILENT (2026-09-27 incident): a redraft the model returns but the screenplay
  // check rejects \u2014 or a model error \u2014 used to end with the page unchanged and no
  // message. Every failure now says why, in plain words, with what to try (admins also
  // get the technical reason); opts.quiet leaves the message to a batch caller, which
  // reads lastPolishFailureRef.
  const lastPolishFailureRef = React.useRef(null);
  const polishScene = async (s, beatsForScene, opts)=>{
    if(!canMutateWritersRoom()) return false;
    // the film this redraft belongs to (2026-09-28): a reply that comes back after a film switch
    // is dropped — scene ids repeat across films (the same film token the Script view's and the
    // Inspector's late writers use)
    const filmTok = (typeof window.turnFilmToken==="function") ? window.turnFilmToken() : undefined;
    setPolishBusy({ no:s && s.no });
    const ordered=scenesInStoryOrder(scenes);
    const i = ordered.findIndex(x=>x.id===s.id);
    const prev=i>0?ordered[i-1]:null;
    const report = {};
    let failure = null;
    try{
      const structural = autoDraftScene(s, beatsForScene, prev);
      // the current draft and the film's scenes ride along for the SCREEN TIME budget: a
      // redraft never makes the scene longer (Story Pipeline step 5) — aiPolishScene discards
      // a reply that runs longer than the current script
      const res = await aiPolishScene(s, beatsForScene, structural.blocks, prev, project, report,
        { retry:polishRetryRef.current[String(currentProjectId||"")+"::"+s.id] || null, current:drafts[s.id] || null, scenes });
      if(res && filmTok!==undefined && !window.turnSameFilm(filmTok)){
        // (quiet: "Redraft N out-of-date" says it once, for the whole batch)
        if(!(opts && opts.quiet) && typeof window.appToast==="function") window.appToast("You switched films while Scene "+(s && s.no)+" was being redrafted, so the new draft was not applied. Reopen that film and redraft it there.","info");
        return false;
      }
      if(res && canMutateWritersRoom()){ lastPolishFailureRef.current = null; rememberRejection(s.id, null); return commitVersion(s.id, stampDraft(res, s, beatsForScene), filmTok); }
      if(res) return false;          // the film became read-only mid-call: it says so itself
      failure = report.failure || { kind:"service", issues:[], details:[], technical:"no reply" };
      return false;
    }catch(e){
      failure = { kind:"service", issues:[], details:[], technical:String((e&&e.message)||e||"unknown error") };
      return false;
    }finally{
      setPolishBusy(null);
      if(failure){
        lastPolishFailureRef.current = failure;
        if(failure.kind==="invalid" || failure.kind==="long") rememberRejection(s && s.id, failure);
        if(!(opts && opts.quiet) && typeof window.appToast==="function" && typeof window.screenplayFailureMessage==="function")
          window.appToast(window.screenplayFailureMessage("redraft", s && s.no, failure,
            { kept:"Your current draft is unchanged.", retryLabel:"press Redraft again", carries:true }), "error", { force:true });
      }
    }
  };
  /* REDRAFT one scene's script from its CURRENT card and beats (the "needs redraft"
     marker's action, and "Redraft script from beats"): confirm, re-derive the prose,
     commit a VERSION so Undo restores the previous draft. */
  const redraftScene = async (scn, b, opts)=>{
    if(!scn || !canMutateWritersRoom()) return false;
    const confirmIt = !(opts && opts.confirm===false);
    if(confirmIt && typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Redraft Scene "+scn.no+"\u2019s script?",
        body:"The screenplay is rewritten from the scene\u2019s CURRENT card and beat cards (writing credits). The current draft stays in version history \u2014 Undo restores it.",
        confirmLabel:"Redraft script" });
      if(!ok) return false;
    }
    // polishScene explains its own failure (unless quiet); this only confirms success
    const done = await polishScene(scn, b || beatsMap[scn.id], { quiet:!!(opts && opts.quiet) });
    if(done && typeof window.appToast==="function" && !(opts && opts.quiet))
      window.appToast("Scene "+scn.no+" redrafted \u2014 Undo restores the previous draft.","ok");
    return done;
  };

  const sel = scenes.find(s=>s.id===selId) || null;
  const beats = sel ? beatsMap[sel.id] : null;

  // NEEDS REDRAFT — scenes whose card changed after their script was written
  const staleMap = React.useMemo(()=>{
    const out = {};
    if(typeof window.sceneCardSnap!=="function" || typeof window.cardChanges!=="function") return out;
    scenes.forEach(s=>{
      const d = drafts[s.id];
      if(!d || !d.cardSnap || !(d.blocks||[]).length) return;
      const ch = window.cardChanges(d.cardSnap, window.sceneCardSnap(s, characters, beatsMap[s.id]));
      if(ch.length) out[s.id] = ch;
    });
    return out;
  },[scenes, drafts, characters, beatsMap]);
  // drafts written before snapshots existed take today's card as their baseline (once)
  React.useEffect(()=>{
    // silent guard: an automatic baseline must never raise the loading / read-only notices
    if(hydratingRef.current || projectLoadingRef.current || writersRoomReadOnlyRef.current
      || typeof window.sceneCardSnap!=="function") return;
    const missing = scenes.filter(s=>{ const d = drafts[s.id]; return d && (d.blocks||[]).length && !d.cardSnap; });
    if(!missing.length) return;
    setDrafts(d=>{ const n = {...d};
      missing.forEach(s=>{ if(n[s.id] && !n[s.id].cardSnap) n[s.id] = { ...n[s.id], cardSnap:window.sceneCardSnap(s, characters, beatsMap[s.id]) }; });
      return n; });
  },[drafts, scenes, currentProjectId]);
  // "Keep this draft": the script is fine as written — adopt the current card as its baseline
  const keepDraft = (id)=>{
    const s = scenes.find(x=>x.id===id);
    if(!s || !canMutateWritersRoom() || typeof window.sceneCardSnap!=="function") return;
    setDrafts(d=> d[id] ? { ...d, [id]:{ ...d[id], cardSnap:window.sceneCardSnap(s, characters, beatsMap[id]) } } : d);
  };
  // null | {i,total,no,run,stopping} — `run` is the batch's own record: the progress card's Stop
  // sets run.stop, read between scenes (2026-09-28)
  const [redraftingAll, setRedraftingAll] = React.useState(null);
  const redraftAllStale = async ()=>{
    if(redraftingAll || !canMutateWritersRoom()) return;
    const todo = scenesInStoryOrder(scenes).filter(s=>staleMap[s.id]);
    if(!todo.length) return;
    if(typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Redraft "+todo.length+" out-of-date scene"+(todo.length!==1?"s":"")+"?",
        body:"Each script is rewritten from its scene\u2019s CURRENT card and beats, one after another (writing credits). Every previous draft stays in version history \u2014 Undo restores it, scene by scene.",
        confirmLabel:"Redraft "+todo.length });
      if(!ok) return;
    }
    const owner = currentProjectId;
    let done = 0;
    const failed = [];   // { no, failure } \u2014 so the summary says WHY, not a guess
    // STOP BETWEEN SCENES (2026-09-28): the batch's progress card (studioProgress) shows "i of N"
    // and a Stop; the scene being redrafted when it is pressed finishes (and is kept), the rest
    // stay marked out of date
    const run = { stop:false };
    let stopped = false;
    /* STOP ON A FAILURE RETRYING CAN'T FIX, and on the same service failure twice in a row
       (2026-09-28, the rule Auto-draft all and the story build follow — agents.jsx
       failureNeedsAction / repeatedServiceFailure): every later scene would fail the same way,
       so the batch stops there; what was redrafted is kept, the rest stay marked, said once. */
    const aiAtStart = (typeof aiAvailable==="function") && aiAvailable();
    let prevFail = null, halted = null;
    try{
      for(let i=0;i<todo.length;i++){
        if(owner!==projIdRef.current || !canMutateWritersRoom()) break;
        if(run.stop){ stopped = true; break; }
        setRedraftingAll({ i:i+1, total:todo.length, no:todo[i].no, run });
        lastPolishFailureRef.current = null;
        if(await redraftScene(todo[i], beatsMap[todo[i].id], { confirm:false, quiet:true })){ done++; prevFail = null; }
        else {
          const f = lastPolishFailureRef.current;
          failed.push({ no:todo[i].no, failure:f });
          if(aiAtStart && f && owner===projIdRef.current){
            if(typeof window.turnFailureNeedsAction==="function" && window.turnFailureNeedsAction(f)){ halted = { no:todo[i].no, failure:f }; break; }
            if(typeof window.turnRepeatedServiceFailure==="function" && window.turnRepeatedServiceFailure(prevFail, f)){ halted = { no:todo[i].no, failure:f, repeated:true }; break; }
          }
          prevFail = f || null;
        }
      }
      if(!halted && run.stop && done+failed.length<todo.length) stopped = true;
    } finally { setRedraftingAll(null); }
    // a film switch stopped the batch (2026-09-28): say that once — the scene in flight was not
    // applied in either film — instead of listing it as a failure with a borrowed reason
    if(owner!==projIdRef.current){
      if(typeof window.appToast==="function") window.appToast("You switched films, so Redraft out-of-date stopped: "+done+" of "+todo.length+" scene"+(todo.length!==1?"s were":" was")+
        " redrafted in that film, and the rest are still marked out of date there — reopen it to redraft them.","info");
      return;
    }
    if(halted && typeof window.appToast==="function"){
      const why = (typeof window.screenplayFailureReason==="function") ? window.screenplayFailureReason(halted.failure) : "the writing service can\u2019t be reached";
      const next = (typeof window.screenplayFailureAdvice==="function") ? window.screenplayFailureAdvice(halted.failure, "press Redraft out-of-date to continue") : "Press Redraft out-of-date to continue.";
      const left = todo.length - done;
      window.appToast("Redraft out-of-date stopped at Scene "+halted.no+" \u2014 "+why+(halted.repeated
        ? ", for the second scene in a row, so the other scenes would most likely fail the same way. "
        : ", so the other scenes would fail the same way. ")+
        (done ? done+" scene"+(done!==1?"s were":" was")+" redrafted and kept; " : "")+
        left+" scene"+(left!==1?"s are":" is")+" still marked out of date and unchanged. "+next, "error", { force:true });
      return;
    }
    if(stopped && typeof window.appToast==="function"){
      const left = todo.length - done - failed.length;
      const stopHead = "Redraft out-of-date stopped: "+done+" of "+todo.length+" scene"+(todo.length!==1?"s":"")+" redrafted \u2014 "+
        left+" "+(left===1?"is":"are")+" still marked out of date and unchanged. ";
      window.appToast(failed.length && typeof window.screenplayBatchFailureMessage==="function"
        ? window.screenplayBatchFailureMessage(stopHead, failed, { next:"Redraft them again", carries:true, nullReason:"the film became read-only, so it was left as is", nullShort:"read-only" })
        : stopHead+"Press Redraft out-of-date to continue.", failed.length ? "error" : "info", failed.length ? { force:true } : undefined);
      return;
    }
    // every failed scene with ITS OWN reason; one that stopped because the film became
    // read-only mid-run has no failure and says so, rather than borrowing another's
    const head = "Redrafted "+done+" of "+todo.length+" scenes \u2014 the rest are still marked and unchanged. ";
    if(typeof window.appToast==="function") window.appToast(done===todo.length
      ? ("Redrafted "+done+" scene"+(done!==1?"s":"")+" from their current cards \u2014 Undo restores any of them.")
      : (failed.length && typeof window.screenplayBatchFailureMessage==="function"
          ? window.screenplayBatchFailureMessage(head, failed, { next:"Redraft them again", carries:true, nullReason:"the film became read-only, so it was left as is", nullShort:"read-only" })
          : head+"Redraft them again to retry."),
      done===todo.length?"ok":"error", done===todo.length ? undefined : { force:true });
  };

  // the batch's progress card Stop: the scene being redrafted now finishes, the rest stay marked
  const stopRedraftAll = ()=>{
    const r = redraftingAll && redraftingAll.run;
    if(r && !r.stop){ r.stop = true; setRedraftingAll(x=> x ? { ...x, stopping:true } : x); }
  };

  // NAME EVERY SCENE'S VALUE — older films get a value at stake per scene: the poles
  // their own words give are used as-is; the writing model supplies only the missing ones
  const unnamedValueCount = (typeof sceneValueAxis==="function") ? scenes.filter(s=>!sceneValueAxis(s)).length : 0;
  const [namingValues, setNamingValues] = React.useState(false);
  const nameAllValues = async ()=>{
    if(namingValues || !canMutateWritersRoom() || typeof guessValueAxis!=="function") return;
    const todo = scenesInStoryOrder(scenes).filter(s=>!sceneValueAxis(s));
    if(!todo.length) return;
    const items = todo.map(s=>{ const g = guessValueAxis(s) || { pos:"", neg:"" };
      return { id:s.id, no:s.no, title:s.title, summary:s.summary, openValue:s.openValue, openCharge:s.openCharge,
        closeValue:s.closeValue, closeCharge:s.closeCharge, pos:g.pos||"", neg:g.neg||"" }; });
    const complete = items.filter(it=>it.pos && it.neg && it.pos.toLowerCase()!==it.neg.toLowerCase());
    const needAI = items.filter(it=>complete.indexOf(it)<0);
    const live = typeof aiAvailable==="function" && aiAvailable();
    if(typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Name the value at stake for "+todo.length+" scene"+(todo.length!==1?"s":"")+"?",
        body:(complete.length ? complete.length+" come"+(complete.length===1?"s":"")+" straight from the scene\u2019s own words. " : "")+
          (needAI.length ? (live ? needAI.length+" need"+(needAI.length===1?"s":"")+" a missing pole written (one writing call). " : needAI.length+" can\u2019t be completed until a writing model is available. ") : "")+
          "Each scene\u2019s opening and closing words then follow its charges. The scripts aren\u2019t changed and the scenes aren\u2019t marked for a redraft.",
        confirmLabel:"Name values" });
      if(!ok) return;
    }
    const owner = currentProjectId;
    setNamingValues(true);
    let fromAI = {};
    try{ if(needAI.length && live) fromAI = await window.aiNameSceneValues(needAI, project) || {}; }catch(e){ fromAI = {}; }
    finally{ setNamingValues(false); }
    if(owner!==projIdRef.current || !canMutateWritersRoom()) return;
    const axes = {}; complete.forEach(it=>{ axes[it.id] = { pos:it.pos, neg:it.neg }; }); Object.assign(axes, fromAI);
    const ids = Object.keys(axes);
    if(!ids.length){ if(typeof window.appToast==="function") window.appToast("No values could be named \u2014 the writing model may be unreachable.","error"); return; }
    setScenes(ss=>ss.map(s=> axes[s.id] ? withValueWords({ ...s, value:axes[s.id] }) : s));
    // a relabel, not a story change: carry the new value into each draft's card snapshot
    setDrafts(d=>{ const n = {...d};
      ids.forEach(id=>{ const dr = n[id], sc = scenes.find(x=>x.id===id);
        if(!dr || !dr.cardSnap || !sc) return;
        const named = withValueWords({ ...sc, value:axes[id] });
        n[id] = { ...dr, cardSnap:{ ...dr.cardSnap, value:axes[id].pos+" / "+axes[id].neg, words:(named.openValue||"")+" \u2192 "+(named.closeValue||"") } };
      });
      return n; });
    const left = todo.length - ids.length;
    if(typeof window.appToast==="function") window.appToast("Named the value at stake for "+ids.length+" scene"+(ids.length!==1?"s":"")+
      (left ? (" \u2014 "+left+" still need one (name them in the Scene tab).") : "."), left?"info":"ok");
  };

  // CONTINUITY FACTS — each film's own (built by the continuity ledger). The bundled
  // sample's facts apply only to the sample's own continuity map.
  const storyFacts = React.useMemo(()=>{
    if(project && project.continuityFacts) return project.continuityFacts;
    const used = Object.values(continuityMap||{}).flatMap(c=>[...((c&&c.establishes)||[]),...((c&&c.references)||[])]);
    return (used.length && used.every(k=>FACTS[k])) ? FACTS : {};
  },[project && project.continuityFacts, continuityMap]);
  const ledgerInfo = (project && project.continuityLedger) || null;
  const ledgerStale = !!(ledgerInfo && typeof window.continuityLedgerSig==="function"
    && ledgerInfo.sig !== window.continuityLedgerSig(scenes, drafts));
  const [ledgerBusy, setLedgerBusy] = React.useState(false);
  const buildContinuityLedger = async ()=>{
    if(ledgerBusy || !canMutateWritersRoom() || typeof window.aiContinuityLedger!=="function") return;
    const owner = currentProjectId;
    setLedgerBusy(true);
    try{
      const L = await window.aiContinuityLedger(scenes, beatsMap, drafts, project);
      if(owner!==projIdRef.current || !canMutateWritersRoom()) return;
      setContinuityMap(L.map);
      setProject(p=>({ ...p, continuityFacts:L.facts, continuityLedger:L.ledger }));
      if(typeof window.appToast==="function") window.appToast("Continuity ledger built \u2014 "+Object.keys(L.facts).length+" story facts tracked across "+scenes.length+" scenes.","success");
    }catch(e){
      if(typeof window.appToast==="function") window.appToast(String((e&&e.message)||"The continuity ledger couldn't be built."),"error");
    }finally{ setLedgerBusy(false); }
  };

  // story-health issues that drive the Story Editors panel's per-agent counts. The
  // Doctor's count is its OWN audit (no-turn, soft peaks, same-side climaxes, flat runs,
  // one-sided argument, inciting placement), so "your spine is sound" can't show while
  // the Doctor would still find something.
  // The banner names what was found: scenes that don't turn are counted apart from the
  // Doctor's other findings (soft peaks, same-side climaxes, flat runs...).
  const doctorAudit = React.useMemo(()=>{
    const noTurn = ()=> scenes.filter(s=>turnInfo(s).flagged).length;
    try{
      if(typeof window.auditSpine!=="function"){ const n = noTurn(); return { total:n, noTurn:n, notes:0 }; }
      const list = window.auditSpine(scenesInStoryOrder(scenes));
      // ISSUES vs NOTES (approved 2026-09-26 by owner): severity 0 findings (same-side
      // climaxes, flat rhythm, one-sided runs...) are optional craft notes, not problems
      return { total:list.length, noTurn:list.filter(i=>i.kind==="noturn").length, notes:list.filter(i=>!(Number(i.sev)>0)).length };
    }catch(e){ const n = noTurn(); return { total:n, noTurn:n, notes:0 }; }
  },[scenes, project && project.framework]);
  const doctorIssues = doctorAudit.total;
  const contIssues = (typeof window.continuityReport==="function")
    ? window.continuityReport(scenes, continuityMap, storyFacts).conflicts.length : 0;
  const agentIssues = { doctor: doctorIssues, doctorNoTurn: doctorAudit.noTurn, doctorNotes: doctorAudit.notes, continuity: contIssues };

  // estimated screen time per scene (≈1 page/min) — drives the spine's pacing readout.
  // SCREEN TIME PER SCENE (docs/Story Pipeline.md step 5, owner-approved 2026-09-27): each
  // scene's budget is the format's runtime ÷ the scene count (sceneBudgetFor, formats.jsx);
  // a drafted scene past 1.5× it is "long for this format" (sceneLengthCheck) — a free
  // warning on its card and in the Script view, nothing rewritten. It replaces the old
  // film-average heat, which never lit when every scene ran equally long.
  const sceneBudget = (typeof sceneBudgetFor==="function") ? sceneBudgetFor(project, scenes.length) : null;
  const runtimeMap = {}; let runtimeTotal = 0;
  if(typeof sceneRuntime==="function") scenes.forEach(s=>{
    const r = sceneRuntime(s, drafts[s.id], beatsMap[s.id], sceneBudget);
    const chk = (typeof sceneLengthCheck==="function") ? sceneLengthCheck(r, sceneBudget) : { long:false };
    runtimeMap[s.id] = { ...r, budget:sceneBudget, long:!!chk.long, ratio:chk.ratio||0 };
    runtimeTotal += r.sec;
  });

  // ---- editing handlers (scenes + beats) ----
  const [recastBusy, setRecastBusy] = React.useState(null);   // {no, name} while a driver recast runs
  /* DRIVER CHANGED → the labels sync instantly, but the scene's summary, desire
     and beat TEXTS still describe the old driver (prose can't follow a dropdown).
     Offer to RECAST the scene's subtext for the new driver; the screenplay is
     then rebuilt with "Redraft script from beats" so nothing rewrites unseen. */
  const _offerDriverRecast = async (sceneId, oldId, newId)=>{
    if(!canMutateWritersRoom()) return;
    const owner = currentProjectId;   // the film this recast belongs to
    const scn = scenes.find(s=>s.id===sceneId); if(!scn) return;
    const b = beatsMap[sceneId];
    if(!b || !b.rows || !b.rows.length) return;
    if(typeof window.aiRecastDriver!=="function" || !(typeof aiAvailable==="function" && aiAvailable())) return;
    const nameOf = (cid)=>(((characters||[]).find(c=>c.id===cid)||{}).name || String(cid||"").toUpperCase());
    const OLD = nameOf(oldId), NEW = nameOf(newId);
    const ok = await window.appConfirm({ title:"Recast the scene for "+NEW+"?",
      body:"The driver changed ("+OLD+" \u2192 "+NEW+"), but Scene "+scn.no+"\u2019s summary, desire and beat texts still describe "+OLD+" doing the driving. Rewrite the subtext so "+NEW+" drives (one writing call, writing credits)? You review the beats, then \u2018Redraft script from beats\u2019 rebuilds the screenplay.",
      confirmLabel:"Recast for "+NEW, cancelLabel:"Keep the text as is" });
    // rights again after the question, before the paid call (2026-10-09)
    if(!ok || owner !== projIdRef.current || !canMutateWritersRoom()) return;
    setRecastBusy({ no:scn.no, name:NEW });
    const report = {};
    try{
      const res = await window.aiRecastDriver(scn, b, characters, newId, oldId, project, report);
      // a recast that comes back after a film switch belongs to the other film (2026-09-28)
      if(owner !== projIdRef.current){ setRecastBusy(null); return; }
      if(res && canMutateWritersRoom()){
        updateScene(sceneId, { ...(res.summary?{summary:res.summary}:{}), ...(res.objective?{objective:res.objective}:{}) });
        setBeatsMap(m=>{ const cur=m[sceneId]||b; return { ...m, [sceneId]:{ ...cur, driverLabel:NEW,
          desire:res.desire||cur.desire, obstacle:res.obstacle||cur.obstacle, result:res.result||cur.result, rows:res.rows||cur.rows } }; });
        if(typeof window.appToast==="function")
          window.appToast("Scene "+scn.no+" recast for "+NEW+" \u2014 review the beats, then \u2018Redraft script from beats\u2019 to rebuild the screenplay.","ok");
      } else if(!res && typeof window.appToast==="function"){
        // WHY, never a guess (a reply with the wrong number of beats is a failure too:
        // nothing is applied, so the card never ends up half-recast)
        const f = report.failure || null;
        window.appToast(typeof window.screenplayFailureMessage==="function"
          ? window.screenplayFailureMessage("recast", scn.no, f, { kept:"Nothing was changed.", retryLabel:"set the driver back and forth to retry" })
          : "Couldn\u2019t recast Scene "+scn.no+" \u2014 nothing was changed.", "error", { force:true });
      }
    }catch(e){ if(typeof window.appToast==="function") window.appToast("Couldn\u2019t recast Scene "+scn.no+" \u2014 something went wrong, so nothing was changed.","error", { force:true }); }
    setRecastBusy(null);
  };
  const updateScene = (id,patch)=>{
    if(!canMutateWritersRoom()) return;
    const before = patch.driver ? ((scenes.find(s=>s.id===id)||{}).driver) : null;
    // a scene with a value at stake keeps its opening/closing words on that axis
    const sync = (typeof withValueWords==="function") ? withValueWords : (x=>x);
    setScenes(ss=>ss.map(s=>s.id===id?sync({...s,...patch}):s));
    // the Beats tab's DRIVER label is a stored string — changing the scene's
    // driver used to leave it (and the beat-card name columns) showing the old
    // character, which read as "my edit did nothing". Keep it in step.
    if(patch.driver){
      const nm = ((characters||[]).find(c=>c.id===patch.driver)||{}).name;
      if(nm) setBeatsMap(m=>{ const b=m[id]; return b ? { ...m, [id]:{ ...b, driverLabel:nm } } : m; });
      // and offer the content recast (fire-and-forget; confirm-gated, spends one text call)
      if(before && before!==patch.driver) _offerDriverRecast(id, before, patch.driver);
    }
  };
  const onCharge = (field,val)=>updateScene(selId,{[field]:val});
  const addScene = (afterId)=>{
    if(!canMutateWritersRoom()) return;
    const id = newId();
    setScenes(ss=>{
      const i = afterId!=null ? ss.findIndex(s=>s.id===afterId) : ss.length-1;
      const ref = ss[i] || { act:1, seq:"New" };
      // default the driver to the current story's protagonist (or first cast member),
      // never a hardcoded sample-story character
      const protag = characters.find(c=>/protagon|lead|hero/i.test(c.role||"")) || characters[0];
      const defDriver = (ref && ref.driver) || (protag && protag.id) || "lead";
      const ns = { id, act:ref.act||1, seq:ref.seq||"New", no:0, title:"New Scene",
        loc:"INT. NEW LOCATION \u00b7 DAY", summary:"A new scene \u2014 describe what happens here.",
        openValue:"Value", openCharge:0, closeValue:"Value", closeCharge:1,
        conf:1, kind:"normal", driver:defDriver, objective:"" };
      const out = ss.slice(); out.splice((i<0?ss.length-1:i)+1, 0, ns); return renum(out);
    });
    setSelId(id);
  };
  // the last deleted scene with everything that went with it, so "Undo" can restore it
  // exactly (single level, tied to the film it was deleted from)
  /* SEVERAL DELETES CAN BE UNDONE (2026-10-09, owner — Writers' Room review): one slot meant deleting a
     second scene lost the first (its card, beat map, screenplay and versions) for good. The last five
     deleted scenes of this film can be brought back, newest first. */
  const [deletedScenes, setDeletedScenes] = React.useState([]);
  const deletedScene = deletedScenes.find(d=>d && d.owner===currentProjectId) || null;
  const setDeletedScene = (d)=>setDeletedScenes(list=> d ? [d].concat(list.filter(x=>x && x.scene && x.scene.id!==d.scene.id)).slice(0,5)
    : list.slice(1));
  const liveStoryRef = React.useRef({}); liveStoryRef.current = { beatsMap, history, continuityMap };
  const deleteScene = async (id)=>{
    if(!canMutateWritersRoom()) return;
    if(scenes.length<=1){ if(typeof window.appToast==="function") window.appToast("A film keeps at least one scene \u2014 add another scene before deleting this one.","info"); return; }
    if(scenes.findIndex(s=>s.id===id)<0) return;
    const gone0 = scenes.find(s=>s.id===id);
    const hasWork = !!(drafts[id] || (beatsMap[id] && (beatsMap[id].rows||[]).length));
    const shotCount = artRoomReadOnlyRef.current ? 0 : (shots||[]).filter(sh=>sh && sh.sceneId===id).length;
    if(typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({
        title:"Delete Scene "+gone0.no+(gone0.title?(" \u201c"+gone0.title+"\u201d"):"")+"?",
        body:"This removes the scene card"+(hasWork?", its beat map, screenplay draft and version history":"")
          +(shotCount?(hasWork?", and its ":" and its ")+shotCount+" shot"+(shotCount===1?"":"s")+" in the Art Room":"")+". You can undo it right after.",
        confirmLabel:"Delete scene", danger:true });
      if(!ok || !canMutateWritersRoom()) return;
    }
    /* everything below reads the film AS IT IS NOW (2026-10-09): the list captured before the question
       was written back, undoing whatever changed while it was open (a collaborator's edit, a batch) */
    const liveScenes = scenesRef.current || scenes;
    const i = liveScenes.findIndex(s=>s.id===id);
    const remaining = liveScenes.filter(s=>s.id!==id);
    if(i<0 || !remaining.length) return;
    const gone = liveScenes[i];
    const live = liveStoryRef.current || {};
    const drafts0 = draftsRef.current || drafts, beatsMap0 = live.beatsMap || beatsMap, history0 = live.history || history, cont0 = live.continuityMap || continuityMap;
    // THE ART ROOM FOLLOWS THE SCENE (2026-10-02): its shots, its Color preset and the scene's
    // place in props' and locations' scene lists used to stay behind — orphan shots kept the
    // Shots tab "stale" and in the saved film, and the Stage silently skipped them. Only when
    // this account may write the Art Room: a Co-writer's save of art sections is refused by
    // the server's role scopes (enforce-role-scopes.sql), so theirs keeps them as before.
    const artWritable = !artRoomReadOnlyRef.current;
    const goneShots = artWritable ? (shotsRef.current||shots||[]).filter(sh=>sh && sh.sceneId===id) : [];
    const sb = (project && project.styleBible) || {};
    const goneStyle = sb.sceneStyles && Object.prototype.hasOwnProperty.call(sb.sceneStyles, id) ? sb.sceneStyles[id] : undefined;
    const inScenes = x=> x && Array.isArray(x.scenes) && x.scenes.indexOf(id)>=0;
    const propRefs = artWritable ? (props||[]).filter(inScenes).map(p=>({ id:p.id, at:p.scenes.indexOf(id) })) : [];
    const locRefs = artWritable ? (locations||[]).filter(inScenes).map(l=>({ id:l.id, at:l.scenes.indexOf(id) })) : [];
    setDeletedScene({ owner:currentProjectId, index:i, scene:gone, beats:beatsMap0[id], draft:drafts0[id],
      history:history0[id], continuity:cont0 && cont0[id],
      shots:goneShots, style:goneStyle, styleManual:!!(sb.sceneStylesManual||{})[id], styleWhy:(sb.sceneWhy||{})[id], propRefs, locRefs });
    const nxt = remaining[Math.min(i, remaining.length-1)];
    setScenes(ss=>renum(ss.filter(s=>s.id!==id)));
    setBeatsMap(m=>{ const n={...m}; delete n[id]; return n; });
    setDrafts(d=>{ const n={...d}; delete n[id]; return n; });
    // drop the scene's version history and continuity entry too — left behind they bloat
    // the saved doc forever, and a later scene that reuses the id would inherit a dead
    // scene's undo stack (pressing Undo on a new blank scene restored someone else's text)
    setHistory(h=>{ if(!h[id]) return h; const n={...h}; delete n[id]; return n; });
    setContinuityMap(c=>{ if(!c || !c[id]) return c; const n={...c}; delete n[id]; return n; });
    if(goneShots.length) setShots(ss=>ss.filter(sh=>!(sh && sh.sceneId===id)));
    // ...and into Recently deleted (2026-10-09, owner — Shots review): the one-slot Undo was their only way
    // back, so a second scene deletion lost the first scene's shots for good (their frames stayed in storage)
    if(goneShots.length){ const goneIds = new Set(goneShots.map(sh=>sh.id));
      setTrash(t=>({ ...t, shots:[ ...goneShots.map(sh=>({ ..._trashStamp(sh), deletedWithScene:id })), ...(t.shots||[]).filter(x=>!(x && goneIds.has(x.id))) ] })); }
    // the scene's look, its hand-pick mark and its Colorist reason all go (2026-10-08 — the mark and the
    // reason used to stay in the saved film forever); Undo puts all three back
    if(goneStyle!==undefined) setProject(p=>{
      const b=(p&&p.styleBible)||{}; if(!b.sceneStyles || !(id in b.sceneStyles)) return p;
      const sceneStyles={...b.sceneStyles}; delete sceneStyles[id];
      const out={...b, sceneStyles};
      if(b.sceneStylesManual && id in b.sceneStylesManual){ out.sceneStylesManual={...b.sceneStylesManual}; delete out.sceneStylesManual[id]; }
      if(b.sceneWhy && id in b.sceneWhy){ out.sceneWhy={...b.sceneWhy}; delete out.sceneWhy[id]; }
      return {...p, styleBible:out};
    });
    const dropScene = list=>list.map(x=> inScenes(x) ? {...x, scenes:x.scenes.filter(v=>v!==id)} : x);
    if(propRefs.length) setProps(dropScene);
    if(locRefs.length) setLocations(dropScene);
    setSelId(nxt ? nxt.id : null);
  };
  const undoDeleteScene = ()=>{
    const d = deletedScene;
    setDeletedScenes(list=>list.filter(x=>x!==d));
    if(!d || d.owner!==currentProjectId || !canMutateWritersRoom()) return;
    const id = d.scene.id;
    setScenes(ss=>{
      if(ss.some(s=>s.id===id)) return ss;
      const out = ss.slice(); out.splice(Math.min(d.index, out.length), 0, d.scene); return renum(out);
    });
    if(d.beats) setBeatsMap(m=> m[id] ? m : {...m,[id]:d.beats});
    if(d.draft) setDrafts(x=> x[id] ? x : {...x,[id]:d.draft});
    if(d.history) setHistory(h=> h[id] ? h : {...h,[id]:d.history});
    if(d.continuity) setContinuityMap(c=> (c && c[id]) ? c : {...(c||{}),[id]:d.continuity});
    if(d.shots && d.shots.length) setShots(ss=>{
      const have=new Set(ss.map(sh=>sh&&sh.id));
      const back=d.shots.filter(sh=>!have.has(sh.id));
      return back.length ? ss.concat(back) : ss;
    });
    if(d.shots && d.shots.length){ const backIds = new Set(d.shots.map(sh=>sh.id));
      setTrash(t=>({ ...t, shots:(t.shots||[]).filter(x=>!(x && backIds.has(x.id))) })); }
    if(d.style!==undefined) setProject(p=>{
      const b=(p&&p.styleBible)||{}; if(b.sceneStyles && id in b.sceneStyles) return p;
      return {...p, styleBible:{...b, sceneStyles:{...(b.sceneStyles||{}), [id]:d.style},
        ...(d.styleManual ? { sceneStylesManual:{...(b.sceneStylesManual||{}), [id]:true} } : {}),
        ...(d.styleWhy ? { sceneWhy:{...(b.sceneWhy||{}), [id]:d.styleWhy} } : {})}};
    });
    const putBack = refs=>list=>list.map(x=>{
      const r=refs.find(v=>v.id===x.id);
      if(!r || !Array.isArray(x.scenes) || x.scenes.indexOf(id)>=0) return x;
      const sc=x.scenes.slice(); sc.splice(Math.min(r.at, sc.length), 0, id); return {...x, scenes:sc};
    });
    if(d.propRefs && d.propRefs.length) setProps(putBack(d.propRefs));
    if(d.locRefs && d.locRefs.length) setLocations(putBack(d.locRefs));
    setSelId(id);
  };
  const reorderScenes = (fromIdx,toIdx)=>{
    if(!canMutateWritersRoom()) return;
    setScenes(ss=>{
      if(toIdx<0||toIdx>=ss.length||fromIdx===toIdx||fromIdx<0) return ss;
      const out=ss.slice(); const [m]=out.splice(fromIdx,1); out.splice(toIdx,0,m);
      // THE ACT FOLLOWS THE POSITION (2026-09-28): a scene moved across an act boundary used to
      // keep its old act (the spine ruler read "ACT I | ACT II | ACT I", the Board filed it in the
      // wrong column, and the writer was prompted with the old act). The moved scene takes an act
      // its new neighbours allow — its own when it still fits between them, else the nearer
      // one's — so acts stay in story order; no other scene's act changes. (addScene copies the
      // neighbour's act the same way.)
      const actOf = (x)=>{ const a = Number(x && x.act); return Number.isFinite(a) && a>0 ? a : null; };
      const lo = actOf(out[toIdx-1]), hi = actOf(out[toIdx+1]), mine = actOf(m);
      let act = mine;
      if(lo!=null && hi!=null && lo>hi) act = lo;                 // neighbours already out of order: join the scene before
      else{
        if(lo!=null && (act==null || act<lo)) act = lo;
        if(hi!=null && (act==null || act>hi)) act = hi;
      }
      if(act!=null && act!==mine) out[toIdx] = { ...m, act };
      return renum(out);
    });
  };
  const moveScene = (id,dir)=>{ const i=scenes.findIndex(s=>s.id===id); reorderScenes(i,i+dir); };
  // setBeatsFor(sceneId, next, filmToken?) — as commitVersion: a beat map built after an await
  // (Inspector "Create beat map" / "Rebuild from script") lands only in the film it was asked for
  const setBeatsFor = (sceneId,next,filmToken)=>{
    if(filmToken!==undefined && filmToken!==castDraftFilmKey()) return;
    if(!canMutateWritersRoom()) return;
    const identified=(typeof withBeatIdentity==="function")?withBeatIdentity(next,sceneId):next;
    setBeatsMap(m=>({...m,[sceneId]:identified}));
  };

  // ---- AGENTS: build a fresh working model + a sync() that pushes it to app state ----
  React.useEffect(()=>{ window.__turnJump = (no)=>{ const s = scenes.find(x=>x.no===no); if(s){ setSelId(s.id); setView("script"); setAgentsOpen(false); } }; },[scenes]);
  // LIVE app state, readable at agent-sync time. The factory's closures hold
  // run-START values by design (that's the agent's working snapshot); this ref is
  // how sync() sees what the film looks like NOW — to snapshot the true pre-commit
  // state for Undo, and to detect edits made while the agent ran.
  /* The open film's list row carries LIVE facts (the list is not re-fetched on switch), so a
     film that gained a scene or a cast member is never mistaken for a blank canvas — in
     the switcher or on Home — and a blank one reads as "No project yet". */
  React.useEffect(()=>{
    if(!currentProjectId || projectLoading) return;
    const hasScenes = scenes.length ? "1" : null, hasChars = (characters||[]).length ? "1" : null;
    const logline = String((project&&project.logline)||"");
    setProjects(ps=>{ let changed=false;
      const next=(ps||[]).map(p=>{
        if(!p || p.id!==currentProjectId) return p;
        if(!!p.hasScenes===!!hasScenes && !!p.hasChars===!!hasChars && String(p.logline||"")===logline) return p;
        changed=true; return { ...p, hasScenes, hasChars, logline };
      });
      return changed ? next : ps; });
  },[currentProjectId, projectLoading, scenes.length>0, (characters||[]).length>0, project&&project.logline]);
  const agentLiveRef = React.useRef(null);
  agentLiveRef.current = { scenes, characters, project, beats: beatsMap, drafts, continuity: continuityMap };
  window.__turnCurrentProjectId = currentProjectId;
  // WHICH FILM an agent-undo snapshot belongs to (2026-09-28): the same key long cast drafts use —
  // the cloud film's id, or the signed-out slot plus its generation (New Story reuses that slot)
  const agentFilmKey = ()=> (typeof castDraftFilmKey==="function") ? castDraftFilmKey() : String(projIdRef.current||"");
  // one Art Room undo step: the art-side state as it is now (shared by the Department Heads and the Production check)
  const artSnapOf = (label)=>{
    const L = artUndoLiveRef.current; if(!L) return null;
    const items = (a)=> (Array.isArray(a) ? a : []).map(x=> (x && typeof x==="object") ? { ...x } : x);
    const sb = L.project && L.project.styleBible;
    return { filmKey: agentFilmKey(), label, at: Date.now(),
      characters: items(L.characters), props: items(L.props), locations: items(L.locations),
      lookbook: items(L.lookbook), lookbookNote: L.lookbookNote || "", lookbookApplied: { ...(L.lookbookApplied||{}) },
      shots: items(L.shots), propsSeeded: L.propsSeeded, locsSeeded: L.locsSeeded,
      styleBible: sb ? JSON.parse(JSON.stringify(sb)) : undefined, hadStyleBible: !!sb };
  };
  const agentCtxFactory = ({ input, emit, propose, cancelled, agentName, scope })=>{
    // scope "production" = the Art Room's Production check: it edits the script AND the
    // Art Room, so it runs for anyone who can save either — each card is gated on the
    // area it writes (ctx.can), and an Art director's commits carry the cast only.
    const production = scope==="production";
    // deep snapshot of the LIVE story state (not the run-start closure), committed
    // to the undo stack when the agent applies its first change — so edits made
    // between run start and first commit are recoverable too.
    // AGENT UNDO IS TIED TO ITS FILM (2026-09-28): each snapshot records the film it was taken
    // in (filmKey — the cloud film's id, or the signed-out slot and its generation) and shares
    // this run's write record, so Undo is never offered or applied in another film, and it can
    // tell whether the film has changed since the run wrote it: runWrite.changed() is true when
    // the live film is none of the states this run wrote (writtenSigs, below).
    const runWrite = { changed:()=> !writtenSigs.has(sigOf(shapeOf(agentLiveRef.current))) };
    const snapshot = ()=>{ const L = agentLiveRef.current; return {
      label: agentName || "Agent", ts: Date.now(), filmKey: agentFilmKey(), runWrite,
      scenes: L.scenes.map(s=>({...s})),
      characters: L.characters.map(c=>({...c})),
      project: {...L.project},
      beats: {...L.beats},
      drafts: {...L.drafts},
      continuity: Object.fromEntries(Object.entries(L.continuity).map(([k,v])=>[k,{
        establishes:[...(v.establishes||[])], references:[...(v.references||[])] }])),
    };};
    let committed = false;
    // EDIT DETECTION: a cheap signature over the story state. Every state this run
    // has itself written is remembered; at sync time, a live state whose signature
    // is NOT one of ours means the user (or a collaborator) edited mid-run — their
    // state gets its own undo snapshot before being replaced, and they're told.
    // STABLE: key order never counts (a save's echo comes back from jsonb reordered), and a
    // character's scene links (scenes / episodeScenes) are left out — they are derived per
    // Episode, and a Show Bible save re-derives them, so this window's own save echo must
    // never read as someone else's edit (nor push an extra undo snapshot).
    const sigOf = (st)=>{ const j = stableJson(st); let h=5381;
      for(let i=0;i<j.length;i++){ h=((h<<5)+h+j.charCodeAt(i))|0; } return h+":"+j.length; };
    const castForSig = (list)=> Array.isArray(list) ? list.map(c=>{
      if(!c || typeof c!=="object") return c;
      const o = { ...c }; delete o.scenes; delete o.episodeScenes; return o; }) : list;
    const shapeOf = (src)=>({ scenes:src.scenes, characters:castForSig(src.characters), project:src.project,
      beats:src.beats, drafts:src.drafts, continuity:src.continuity });
    let warnedMidRunEdit = false;
    let warnedRestrictedCast = false;
    const model = {
      scenes: scenes.map(s=>({...s})),
      characters: characters.map(c=>({...c})),
      project: {...project},
      beats: Object.fromEntries(Object.entries(beatsMap).map(([k,v])=>[k, v])),
      drafts: {...drafts},
      continuity: Object.fromEntries(Object.entries(continuityMap).map(([k,v])=>[k,{
        establishes:[...(v.establishes||[])], references:[...(v.references||[])] }])),
    };
    // the film this run belongs to — captured when the agent starts
    const ownerProjectId = currentProjectId;
    /* THE PRODUCTION CHECK'S ART-SIDE CHANGES (2026-10-09, owner — Art Room review): only in the film it started in,
       only while the role may change that section, and one Art Room undo step for the run (they had none) */
    const _prodArtOk = (section)=> String(ownerProjectId||"")===String(projIdRef.current||"") && !artRoomReadOnlyRef.current
      && (!isSharedFilm || (typeof window.teamCanWriteSection==="function" && window.teamCanWriteSection(writeRole, section)));
    let _prodSnap = null;
    const _prodArtSnap = ()=>{ if(_prodSnap) return; _prodSnap = artSnapOf(agentName || "Production check"); if(_prodSnap){ const snap = _prodSnap; setArtUndo(st=> [...st, snap].slice(-8)); } };
    // every state signature this run has written (seeded with the run-start state);
    // a live state outside this set = someone edited while the agent ran
    const writtenSigs = new Set([sigOf(shapeOf(model))]);
    // the cast as last committed, by id — an art-only commit writes just the fields this
    // run changed since then, so a collaborator's mid-run cast edit is never overwritten
    const castBase = {}; model.characters.forEach(c=>{ castBase[c.id]=c; });
    // EPISODE CAST (docs/Story Pipeline.md step 3, "In an Episode of an existing Show"):
    // the Show's cast when this run started is canon; the people THIS run appends are
    // its own, so later commits (the psychology check) may still refine them
    const runStartCastIds = new Set(model.characters.map(c=>String(c&&c.id!=null?c.id:"")).filter(Boolean));
    const runIntroducedCastIds = new Set();
    // the cast exactly as this run last committed it, by id (plain copies): a later Episode
    // commit changes only the fields the run itself changed since (mergeAdaptationCast's
    // options.base) — a collaborator's mid-run edit to anything else survives, and a mid-run
    // rename stays the same person instead of becoming a duplicate
    let castCommitted = null;
    // React refreshes agentLiveRef only on a LATER render: two commits in one synchronous
    // stretch (the psychology check's commit, then its re-stamp) would both read the render
    // from before the first. liveAtCommit is the render the last commit read, castAtCommit the
    // cast it set — with no render since, that cast IS the live one, and a state already
    // checked for mid-run edits is never checked (or snapshotted onto Undo) twice
    let liveAtCommit = null, castAtCommit = null;
    const sync = ()=>{
      // the Production check run by an Art director commits the cast only (see below)
      const artOnly = production && writersRoomReadOnlyRef.current && !artRoomReadOnlyRef.current;
      if(writersRoomReadOnlyRef.current){
        if(!artOnly){
          try{ emit && emit({k:"flag", t:"Your role cannot change the Writers' Room, so these proposed changes were NOT applied."}); }catch(e){}
          return false;   // (2026-10-09) the agent then never says "Applied"
        }
      }
      // WRONG-FILM GUARD: an agent run takes minutes and the film switcher stays live.
      // Unguarded, a run that finished after a switch wrote its captured scenes, drafts,
      // beats, characters and project straight into whatever film was now open — and the
      // undo snapshot belonged to the ORIGINAL film, so pressing Undo compounded it.
      if(ownerProjectId !== projIdRef.current){
        try{ emit && emit({k:"flag", t:"You switched films while this ran, so its changes were NOT applied — they belong to the film it started in. Reopen that film and run it again."}); }catch(e){}
        return false;
      }
      // ART-ONLY COMMIT (the Production check run by an Art director): their approved cards
      // only ever change the cast sheets (script cards are noted, not shown), so only the
      // cast is written — the story state they can't save is left exactly as it is.
      if(artOnly){
        const patches = {};
        (model.characters||[]).forEach(c=>{
          const was = castBase[c.id]; if(!was || was===c) return;
          const p = {}; Object.keys(c).forEach(k=>{ if(c[k]!==was[k]) p[k]=c[k]; });
          if(Object.keys(p).length) patches[c.id] = p;
          castBase[c.id] = c;
        });
        if(Object.keys(patches).length){ _prodArtSnap(); setCharacters(cs=>cs.map(c=> patches[c.id] ? {...c, ...patches[c.id]} : c)); }
        return true;
      }
      // MID-RUN EDIT GUARD: if the film changed under the run (an edit of the user's
      // or a collaborator's), snapshot THAT state onto the undo stack before this
      // commit replaces it, and say so once — never silently discard newer work.
      // (Only a render this run hasn't already checked: see liveAtCommit above.)
      const liveNow = agentLiveRef.current;
      const freshRender = !liveAtCommit || liveNow !== liveAtCommit;
      if(freshRender && !writtenSigs.has(sigOf(shapeOf(liveNow)))){
        if(committed){ const snap = snapshot(); setAgentUndo(st=>[...st, snap].slice(-8)); }
        if(!warnedMidRunEdit){ warnedMidRunEdit = true;
          try{ emit && emit({k:"flag", t:"The film was edited while this agent ran, and this update replaced those newer edits. They're safe: Undo agent changes restores the film exactly as it was just before."}); }catch(e){}
        }
      }
      if(!committed){ committed = true; const snap = snapshot(); setAgentUndo(st=>[...st, snap].slice(-8)); }
      /* A New Story inside an episode discovers episode cast; it must not replace
         the Show's established cast. Reconcile by stable id/name, keep canonical
         facts, append genuinely new people, and remap scene drivers to retained
         canonical ids before anything reaches React or autosave. */
      if(currentShowId && agentName==="Adaptation" && model.characters
        && window.turnSeries && typeof window.turnSeries.mergeAdaptationCast==="function"){
        const allowNewCast=!!characterBibleWritableRef.current;
        const liveCast=(!freshRender && castAtCommit) ? castAtCommit
          : ((liveNow&&liveNow.characters)||characters);
        const reconciled=window.turnSeries.mergeAdaptationCast(liveCast,
          model.characters,model.scenes,{allowNew:allowNewCast,revisable:Array.from(runIntroducedCastIds),base:castCommitted});
        (reconciled.addedIds||[]).forEach(id=>{
          const k=String(id==null?"":id); if(k && !runStartCastIds.has(k)) runIntroducedCastIds.add(k); });
        model.characters=reconciled.characters;
        model.scenes=reconciled.scenes;
        castCommitted={};
        model.characters.forEach(c=>{ if(c && c.id!=null) castCommitted[String(c.id)]=JSON.parse(JSON.stringify(c)); });
        if(!allowNewCast && reconciled.blockedNames&&reconciled.blockedNames.length&&!warnedRestrictedCast){
          warnedRestrictedCast=true;
          try{ emit&&emit({k:"flag",t:"Your Co-writer role can shape this Episode but cannot change the Show cast. New cast candidates were not added; scene character links were kept within the existing Show canon. Ask the owner or Art director to add any genuinely new character."}); }catch(e){}
        }
      }
      setScenes(model.scenes.map(s=>({...s})));
      if(model.characters) setCharacters(model.characters.map(c=>({...c})));
      if(model.project){
        /* a new story identity (e.g. Adaptation) makes the old props irrelevant —
           clear them so sample-story props never bleed into a freshly built film */
        if(model.project.title && project && model.project.title !== project.title){
          // In a series those are canonical Show assets, not leftovers from this
          // episode. New episode story generation may add to them later but never
          // clears the existing shared departments.
          if(!currentShowId){ setProps([]); setPropsSeeded(false); setVisualsSeeded(false); }
          // keep the cloud ROW title in step with the film's new title, so the
          // switcher doesn't keep saying "Untitled film" after a build
          if(cloudMode && currentProjectId){
            renameProject(currentProjectId, model.project.title);
          }
        }
        setProject({...model.project});
      }
      const beatsW = (typeof withBeatMapIdentity==="function")?withBeatMapIdentity(model.beats):{...model.beats};
      setBeatsMap(beatsW);
      setDrafts({...model.drafts});
      setContinuityMap(Object.fromEntries(Object.entries(model.continuity).map(([k,v])=>[k,{...v}])));
      // remember exactly what was written (with the beat identities as stored), so the
      // next sync doesn't mistake this run's own commit for an external edit
      writtenSigs.add(sigOf(shapeOf({ scenes:model.scenes, characters:model.characters, project:model.project,
        beats:beatsW, drafts:model.drafts, continuity:model.continuity })));
      liveAtCommit = liveNow;
      castAtCommit = model.characters ? model.characters.map(c=>({...c})) : null;
      return true;
    };
    return { model, sync, input, emit, propose,
      // EPISODE CANON (docs/Story Pipeline.md step 3, "In an Episode of an existing Show"): true
      // for a character the Show already had when this build started (or when the Writer can't
      // change the Show cast at all) — the psychology check leaves it exactly as it is
      castCanon: (c)=> !!(currentShowId && agentName==="Adaptation" && c && c.id!=null
        && (!characterBibleWritableRef.current || !runIntroducedCastIds.has(String(c.id)))),
      // a film switch cancels the RUN, not just the commit — otherwise an agent keeps
      // burning model calls (and reading the newly opened film's globals) for minutes
      // after the guard has already decided its result can never be applied
      cancelled: ()=> cancelled() || ownerProjectId !== projIdRef.current || (production ? (writersRoomReadOnlyRef.current && artRoomReadOnlyRef.current) : writersRoomReadOnlyRef.current),
      switchedFilms: ()=> ownerProjectId !== projIdRef.current,
      roleLost: ()=> scope==="production" ? (!!writersRoomReadOnlyRef.current && !!artRoomReadOnlyRef.current) : !!writersRoomReadOnlyRef.current,
      // live write access per area — the Production check notes (not shows) a card whose
      // area this role can't save
      can:{ script:()=> !writersRoomReadOnlyRef.current, art:()=> !artRoomReadOnlyRef.current },
      project, facts:storyFacts,
      // read-only copies of the Art-Room bibles + gated patchers, for agents that
      // cross-check the script against props/locations (the Production check). Patches
      // apply immediately — call them only AFTER a propose() card is approved.
      bible:{
        props: props.map(p=>({...p})),
        locations: locations.map(l=>({...l})),
        shots: (shots||[]).map(s=>({...s})),
        /* (2026-10-09, owner — Art Room review) the film it started in, the role NOW, and an undo step: an
           approval after a film switch patched the newly open film, and art-side changes had no undo.
           Each returns whether it applied. */
        patchProp:(id,patch)=>{ if(!_prodArtOk("props")) return false; _prodArtSnap(); setProps(ps=>ps.map(p=>p.id===id?{...p,...patch}:p)); return true; },
        patchLocation:(id,patch)=>{ if(!_prodArtOk("locations")) return false; _prodArtSnap(); setLocations(ls=>ls.map(l=>l.id===id?{...l,...patch}:l)); return true; },
      },
      ai:{ available: (typeof aiAvailable==="function" && aiAvailable()),
        suggestTurn:(s,p,r)=>window.aiSuggestTurn(s,p,model.project,r),
        plantLine:(s,f,m)=>window.aiPlantLine(s,f,m),
        continuityLedger:()=>window.aiContinuityLedger(model.scenes, model.beats, model.drafts, model.project),
        tableRead:(sc,dr)=>window.aiTableRead(sc,dr,model.project),
        voiceCheck:(sc,dr)=>window.aiVoiceCheck(sc,dr),
        buildSpine:(b)=>window.aiBuildSpine(b, (project&&project.format)||"film", (project&&project.framework)||"threeact"),
        // the research reservoir belongs to the brief it was gathered for (a typed brief has none)
        buildStoryWorld:(b,sp)=>window.aiBuildStoryWorld(b,sp,(project&&project.format)||"film",
          (project && project.research && String(project.sourceBrief||"").trim()===String(b||"").trim()) ? project.research : null),
        authorScene:(s,p)=>window.aiAuthorScene(s,p,model.characters,model.project,{scenes:model.scenes}),
        beatsFromScript:(s,d)=>window.aiBeatsFromScript(s,d,model.characters,model.project),
        draftScene:(s,b,p,o)=>window.aiDraftScene(s,b,p,model.project,model.characters,model.scenes,o),
      } };
  };

  const artAgentCtxFactory = ({ input, emit, propose, cancelled, agentName, force, owner, run:runIn })=>{
    // WRONG-FILM GUARD (2026-10-02): the film this run belongs to — captured when it starts (a
    // refreshed context keeps its run's film). An Art Room run takes minutes and the film switcher
    // stays live: after a switch, the run stops (cancelled), and every state write still in
    // flight is refused — it would land in whichever film is open now. Images were already
    // guarded by their asset scope (nbEpoch).
    const ownerProjectId = owner!==undefined ? owner : currentProjectId;
    const switchedFilms = ()=> String(ownerProjectId||"") !== String(projIdRef.current||"");
    // "Also redo the scenes I picked by hand" is the Colorist panel's choice for ITS run only (2026-10-08)
    const _redoManual0 = agentName==="Colorist" && !!coloristRedoManualRef.current;
    let _switchFlagged = false;
    // UNDO FOR ART ROOM AGENTS (2026-10-02): one run = one undo step (a refreshed Coordinator
    // context shares its run), snapshotted just before the run's FIRST write. Only runs started
    // from an agent panel (they bring a propose function) — background work (the wardrobe
    // bootstrap, the badge count) records none.
    const run = runIn || { snap:null };
    const takeArtSnap = ()=>{
      if(run.snap || typeof propose!=="function") return;
      const snap = artSnapOf(agentName || "An Art Room agent"); if(!snap) return;
      run.snap = snap;
      setArtUndo(st=> [...st, snap].slice(-8));
    };
    /* A ROLE THAT CAN'T CHANGE THE ART ROOM ANY MORE WRITES NOTHING (2026-10-09, owner — Art Room review): writes
       landing after a paid model call only checked for a film switch — a role changed to view-only meanwhile
       still wrote its result. Said once per run. */
    let _roleFlagged = false;
    const roleLost = ()=> !!artRoomReadOnlyRef.current;
    const inFilm = (fn)=> (...args)=>{
      if(switchedFilms()){
        if(!_switchFlagged){ _switchFlagged = true;
          try{ emit && emit({k:"flag", t:"You switched films while this ran, so it stopped \u2014 nothing more was written to either film. Reopen the film it started in and run it again."}); }catch(e){} }
        return undefined;
      }
      if(roleLost()){
        if(!_roleFlagged){ _roleFlagged = true;
          try{ emit && emit({k:"flag", t:"Your role can no longer change the Art Room, so this run stopped \u2014 nothing more was written."}); }catch(e){} }
        return undefined;
      }
      takeArtSnap();
      return fn(...args);
    };
    const _w = {
      setProps:inFilm(setProps), setPropsSeeded:inFilm(setPropsSeeded), setLocations:inFilm(setLocations),
      setLocsSeeded:inFilm(setLocsSeeded), setLookbook:inFilm(setLookbook), setLookbookNote:inFilm(setLookbookNote),
      setCharacters:inFilm(setCharacters), updateCharacter:inFilm(updateCharacter), commitBeatKeyframes:inFilm(commitBeatKeyframes),
      applyStyleResult:inFilm(applyStyleResult), markApplied:inFilm(markApplied),
    };
    const ordered = scenesInStoryOrder(scenes);
    const charById = {}; characters.forEach(c=>{ charById[c.id]=c; });
    const propById = {}; props.forEach(p=>{ propById[p.id]=p; });
    const shotsByScene = {};
    (shots||[]).forEach(s=>{ (shotsByScene[s.sceneId]=shotsByScene[s.sceneId]||[]).push(s); });
    Object.values(shotsByScene).forEach(arr=>arr.sort((a,b)=>(a.order||0)-(b.order||0) || (a.beatN||0)-(b.beatN||0)));
    const ctxFor = (scene)=>({ scene, scenes:ordered,
      location:(typeof locationForScene==="function")?locationForScene(locations,scene.id):null,
      charById, propById, project });

    // ---- Shot Designer (Shot List agent) — coverage audit/design on a per-run WORKING
    // copy of shots (like Story Doctor's ctx.model); each approval also pushes to real state.
    let _workShots = (shots||[]).map(s=>({...s}));
    const _coverageChecks = {};   // sceneId → the current-state check signed before its coverage was drafted
    const _WIDE = new Set(["EWS","WS","FS","MWS"]);
    const _shotsOf = (sid)=> _workShots.filter(s=>s.sceneId===sid).slice().sort((a,b)=>(a.order||0)-(b.order||0)||(a.beatN||0)-(b.beatN||0));
    const coverage = {
      sceneCount: ordered.length,
      audit: ()=> (typeof auditCoverage==="function") ? auditCoverage(ordered, _workShots, beatsMap) : [],
      sceneById: (id)=> ordered.find(s=>s.id===id),
      shotsOf: _shotsOf,
      pickAnchor: (arr)=>{ const w=(arr||[]).find(s=>_WIDE.has(s.size)); return ((w||(arr||[])[0])||{}).id; },
      grammarList: (arr, anchorId, turnAt)=> (arr||[]).map((s,i)=> (i+1)+". "+((typeof shotGrammarLabel==="function")?shotGrammarLabel(s):s.size)
        + (i===0?"  ◆ chain head":"") + ((turnAt&&s.beatN===turnAt)?"  ← lands the turn":"")),
      turnAtOf: (sid)=> ((beatsMap||{})[sid]||{}).turnAt,
      // (2026-10-09, owner — Shots review) the Shot Designer gets the Shots tab's own guarantees: the scene is
      // signed before the model call and checked again when the coverage is applied (edits made while the
      // proposal waited are never overwritten), it counts as the scene's running draft, the dialogue is
      // snapped to the screenplay's lines, and beats the model didn't answer keep their shots
      draftCoverage: async (scene)=>{ if(typeof aiDraftShots!=="function" || typeof normalizeShot!=="function") return null;
        if(keyframeBusyRef.current.has(scene.id)) throw new Error("this scene already has a keyframe draft running");
        const check = keyframeScope(scene);
        keyframeBusyRef.current.add(scene.id);
        try{
          const L = keyframeInputsRef.current || {};
          const raw = await aiDraftShots(scene, L.beatsMap||beatsMap, draftsRef.current||drafts, L.locations||locations, L.props||props, charactersRef.current||characters, lbProject("shots"));
          if(!raw || !raw.length) return null;
          check();
          let made = completeDraftedShotCoverage(scene, raw.map((r,i)=>normalizeShot(r, scene, i, L.locations||locations, L.props||props, charactersRef.current||characters, L.beatsMap||beatsMap)));
          snapShotDialogue(scene, made);
          made = keepUnansweredBeats(scene, raw, made).made;
          _coverageChecks[scene.id] = check;
          return made;
        } finally { keyframeBusyRef.current.delete(scene.id); } },
      applyCoverage: (sceneId, newShots, anchorId)=>{
        // chain model: the head is the FIRST shot in order, so coverage shots carry no
        // explicit .anchor (that flag now means a manual fresh-start / chain break).
        const fresh = (newShots||[]).filter(s=>s && s.sceneId===sceneId).map(s=>({...s, anchor:false}));
        // SAFE MERGE (fixed 2026-09-26) — the Shots tab's own Re-draft path: each beat's
        // current shot keeps its ID, frames and take history (un-approved only if its spec
        // changed), extra shots on a re-planned beat move to Shots Trash where they can be
        // restored, and shots on beats the new plan doesn't cover stay. It used to replace
        // the scene's shots outright — hand-made shots and alternatives vanished with no
        // Trash entry and rendered frames lost their link.
        if(typeof window.mergeBeatKeyframes==="function"){
          const merged = _w.commitBeatKeyframes(fresh, _coverageChecks[sceneId] || (()=>{}));
          _workShots = window.mergeBeatKeyframes(_workShots, fresh).shots;
          return merged;
        }
        // (merge helper missing: never destroy — leave the scene's shots as they are)
        return null; },
    };

    // ---- Casting Director (Characters agent) — draft spec, suggest states, and headless
    // generation of master sheets + appearance-state variants. Mutates `characters` state via
    // updateCharacter; commits images to the asset store + dispatches nb-gen-done (nbCommit won't).
    const _grabImg = async (id)=>{ let u=(typeof nbGetImage==="function")?nbGetImage(id):"";
      if(!u && typeof nbLoadImage==="function"){ try{ u=await nbLoadImage(id); }catch(e){} } return u; };
    const _cameoOf = async (cid)=>{ let a=[]; if(typeof nbGetCameoAngles==="function"){ try{ a=nbGetCameoAngles(cid)||[]; }catch(e){} }
      if(!a.length && typeof nbLoadCameoAngles==="function"){ try{ a=await nbLoadCameoAngles(cid)||[]; }catch(e){} } return a||[]; };
    /* LIKENESS (2026-10-10, owner — Likeness review): the Casting Director's sheets follow the card's ONE RULE
       (artroom.jsx turnLikenessSheetRequest): the front angle first, the other angles, then the master, then the
       worn-item sheets, a numbered image map, the face left out of the text spec, and meta.cameo / cameoAt / mode /
       privateRefs — so the card no longer says "regenerate to apply" after a likeness sheet. A likeness this person
       can't use here is said in the trace (Design the cast's preview said it before the run). */
    const _likenessReq = async (c, o)=> (typeof window.turnLikenessSheetRequest==="function")
      ? window.turnLikenessSheetRequest({ character:c, project, props, ...(o||{}) }) : null;
    const _likenessSkipped = (c, req)=>{
      if(!(req && req.unavailable)) return {};
      const t = (typeof window.turnLikenessUnavailableText==="function") ? window.turnLikenessUnavailableText(c.id, c.name) : "";
      try{ if(t) emit && emit({k:"observe", t}); }catch(_e){}
      return { likenessSkipped:true };
    };
    // Use the SAME image model the master sheet was made with (from its meta) so a variant matches
    // it; else prefer GPT Image (best identity-lock + what the cast masters use, and it avoids the
    // Google models' "no image" safety refusals on injury/blood states); else the current model.
    const _gpt2m = (window.NB_MODELS||[]).find(m=>/gpt-image/i.test(m.id));
    const _modelFor = (c)=>{ const m=(typeof nbGetMeta==="function")?nbGetMeta(c.id):null;
      // current picker first — never silently revert to the model that made the original
      return ((typeof nbGetModel==="function")&&nbGetModel()) || (m&&m.modelId) || (_gpt2m&&_gpt2m.id) || undefined; };
    const _genCharImage = async (slotId, prompt, opts)=>{
      const { commitRefs=[], metaExtra=null, ...generateOpts } = opts||{};
      const gopts = { aspectRatio:"16:9", ...generateOpts };
      // asset scope at request start: entity ids repeat across films, so a commit that
      // lands after the user opened ANOTHER film must be dropped, not written there
      const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;
      let url;
      /* STOP MEANS NO NEW IMAGE (2026-10-09, owner — Art Room review): the last check came before an await, so a
         sheet could still be started after Stop; the "no image" retry was a silent second paid call. Now the
         request is refused at the last moment before it's sent, and a retry is said in the trace. An image
         already on its way finishes, is charged and is kept. */
      const beforeSubmit = ()=>{ if(cancelled && cancelled()) throw new Error("Stopped \u2014 no new image was started."); };
      try{ url = await window.nbGenerate(prompt, { ...gopts, assetId:slotId, beforeSubmit }); }
      catch(e){ if(/no image/i.test(String((e&&e.message)||e)) && !(cancelled && cancelled())){
          try{ emit && emit({k:"observe", t:"The image service returned no image, so it asked once more (one more image)."}); }catch(_e){}
          url = await window.nbGenerate(prompt, { ...gopts, assetId:slotId, beforeSubmit }); } else throw e; }
      let priorVersion = 0;
      if(typeof nbLoadDetailsAsset==="function"){
        try{ const d=await nbLoadDetailsAsset(slotId); priorVersion=Number(d&&d.meta&&d.meta.version)||0; }catch(e){}
      }
      if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(gopts,"coordinator-sheet-commit");
      const meta = { modelId: gopts.model || ((typeof nbGetModel==="function")?nbGetModel():undefined), aspect:"16:9",
        iso:new Date().toISOString(), prompt, agent:"Casting Director", version:priorVersion+1,
        identitySnapshot:typeof window.nbIdentitySnapshot==="function"?window.nbIdentitySnapshot(gopts.identityCharacter):null,
        ...(metaExtra||{}) };
      const kind = (typeof slotAssetKind==="function") ? slotAssetKind("charref-"+slotId) : "character";
      const _r = await window.nbCommit(slotId, url, meta, commitRefs, kind, _ep);
      // refused stale-scope write: the result belongs to a film that is no longer open.
      // No nb-gen-done — a card in the NEW film with the same id must not adopt it.
      if(_r && _r.tier==="stale") throw new Error("Discarded \u2014 the film changed while this sheet rendered (stale scope)");
      try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id:slotId, url } })); }catch(e){}
      return url;
    };
    const cast = {
      list: (characters||[]).slice(),
      isDrafted: (c)=> (typeof charVisualsDrafted==="function") ? charVisualsDrafted(c) : true,
      imageOf: async (id)=> _grabImg(id),
      draftSpec: async (c)=>{ if(typeof aiCharacterVisuals!=="function") return null;
        const patch = await aiCharacterVisuals(c, scenes.filter(s=>s.driver===c.id), lbProject("characters"), { scenes, drafts });
        if(patch){ _w.updateCharacter(c.id, patch); } return patch; },   // (the card records its own Lookbook)
      /* CHARACTER FIDELITY (owner-approved 2026-10-12): step 2 — the fact sheet is read first for the looks it drafts
         (needsFacts: none yet, or the screenplay changed since); step 4 — the optional Script check of a new master */
      needsFacts: (c)=>{ try{ return typeof window.charFactsState==="function" && window.charFactsState(c, scenes, drafts).needsRead; }catch(e){ return false; } },
      factCalls: (list)=> (typeof window.charFactCallCount==="function") ? window.charFactCallCount(scenes, drafts, list) : 0,
      readFacts: async (list)=> readCharacterFacts(list, { silent:true, throwErrors:true }),
      fidelityCheck: async (c, url)=>{
        if(!url || typeof window.aiCharacterFidelityCheck!=="function" || typeof window.charFidelityFacts!=="function") return null;
        const lk = (typeof window.charLikenessGivesFace==="function") ? window.charLikenessGivesFace(c) : false;
        const facts = window.charFidelityFacts(c, { drafts, likeness:lk });
        if(!facts.length) return null;
        return window.aiCharacterFidelityCheck({ name:c.name, url, facts,
          spec:(typeof window.charQaSpecFields==="function") ? window.charQaSpecFields(c, { likeness:lk }) : {} });
      },
      suggestStates: async (c)=>{ if(typeof aiSuggestStates!=="function") return null;
        const raw = await aiSuggestStates(c, scenes.filter(s=>s.driver===c.id), project, { scenes, drafts });
        if(!raw || !raw.length) return null;
        const existing = c.states||[]; const have=new Set(existing.map(s=>(s.label||"").trim().toLowerCase()));
        const adds = raw.filter(s=>!have.has((s.label||"").trim().toLowerCase()))
          .map((s,i)=> s.id ? s : {...s, id:"st-"+Date.now().toString(36)+"-"+i});
        const merged = adds.length ? [...existing, ...adds] : existing;
        if(adds.length) _w.updateCharacter(c.id, { states: merged });
        return merged; },
      generateMaster: async (c, generateOpts)=>{
        generateOpts = generateOpts||{};
        const identityOptions=characterMediaOptions(c);
        if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(identityOptions,"coordinator-master-start");
        let prompt = (typeof combinedImagePrompt==="function") ? combinedImagePrompt(c, project, props) : "";
        const excluded = new Set(Array.isArray(c.wornReferenceExclusions)?c.wornReferenceExclusions:[]);
        const worn = (props||[]).filter(p=>p.ownerId===c.id && p.kind!=="carried");
        const refs=[]; const commitRefs=[]; const wornAttach=[];
        for(const p of worn.filter(p=>!excluded.has(p.id))){ const u=await _grabImg(p.id); if(u){
          refs.push(u); wornAttach.push({ url:u, note:p.name||"Worn prop" });
          commitRefs.push({kind:"prop",label:p.name||"Worn prop",url:u,refId:p.id});
        } }
        let referenceImage="";
        if(generateOpts.deriveFromCurrent){ referenceImage=await _grabImg(c.id);
          if(referenceImage){
            if(typeof window.nbAssertIdentityAssetFresh==="function") window.nbAssertIdentityAssetFresh(c.id,c);
            commitRefs.unshift({kind:"base",label:"Previous master character sheet",url:referenceImage,refId:c.id});
          }
        }
        const lk = await _likenessReq(c, { master:referenceImage||"", deriveFromCurrent:!!referenceImage, worn:wornAttach });
        let extra=refs, likenessMeta=_likenessSkipped(c, lk);
        if(lk && lk.usable){
          // the ONE RULE: face first, the current master (an update), worn items — numbered in the prompt
          prompt = lk.prompt; referenceImage = lk.referenceImage; extra = lk.extraImages; likenessMeta = lk.meta;
        } else {
          if(!lk){   // an older build without the shared helper: today's behaviour
            const cameo = await _cameoOf(c.id);
            if(cameo.length){ extra = [...refs, ...cameo]; prompt += " Keep the FACE, bone structure and skin tone identical to the locked-likeness reference; only wardrobe and condition change."; }
          }
          if(refs.length) prompt += " The additional prop reference image(s) are APPROVED worn-prop designs. Lock their exact shape, material, colour, wear and scale onto the character. Worn items without an attached image remain governed by the textual specification.";
          if(referenceImage) prompt = "Update this existing master character sheet. Preserve the EXACT same identity, face, hair, skin tone, age, build, body proportions, panel layout, framing and render style from the base sheet. Apply the current production specification and approved worn-prop designs without re-casting the character. "+prompt;
        }
        const usedIds=new Set(commitRefs.filter(r=>r.kind==="prop").map(r=>r.refId));
        const wornReferences = typeof window.loadWornReferenceSnapshot==="function"
          ? await window.loadWornReferenceSnapshot(c,worn,usedIds) : [];
        const visual=wornReferences.filter(r=>r.mode==="visual").length;
        return _genCharImage(c.id, prompt, { ...identityOptions, model:_modelFor(c),
          ...(referenceImage?{referenceImage}:{}), ...(extra.length?{ extraImages:extra }:{}),
          ...((lk && lk.usable) ? { referencesNumbered:true } : {}),
          commitRefs, metaExtra:{ specPrompt:(typeof combinedImagePrompt==="function") ? combinedImagePrompt(c, project, props) : prompt,
            writingSources:(typeof window.nbWritingSourcesFor==="function")?window.nbWritingSourcesFor(c):[],
            promptCompiler:"Kinolot prompt compiler",
            wornSig:(typeof window.wornPropsSig==="function")?window.wornPropsSig(worn,c.id):"",
            wornReferences, wornRefSummary:{total:wornReferences.length,visual,text:wornReferences.length-visual},
            propRefs:refs.length, ...likenessMeta } }); },
      generateState: async (c, st, baseUrl)=>{
        const identityOptions=characterMediaOptions(c);
        if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(identityOptions,"coordinator-state-start");
        if(baseUrl && typeof window.nbAssertIdentityAssetFresh==="function") window.nbAssertIdentityAssetFresh(c.id,c);
        const base = (typeof combinedImagePrompt==="function") ? combinedImagePrompt(c, project, props) : "";
        let prompt = base + " APPEARANCE STATE — "+(st.label||"variant")+": "+(st.change||"")
          + ". Render the character in THIS changed state consistently across every panel, keeping the EXACT same face, hair, skin tone and body as the reference; only the described change differs.";
        const stateEntity={...c,appearanceState:st};
        const opts = { ...identityOptions, model:_modelFor(c), metaExtra:{
          writingSources:(typeof window.nbWritingSourcesFor==="function")?window.nbWritingSourcesFor(stateEntity):[],
          promptCompiler:"Kinolot prompt compiler" } };
        // the ONE RULE (owner — Likeness review): face first, then the master; a variant with no master is a
        // proper sheet FROM the face — never "edit this sheet" with a face photo
        const lk = await _likenessReq(c, { state:st, master:baseUrl||"" });
        if(lk && lk.usable){
          prompt = lk.prompt; opts.referenceImage = lk.referenceImage; opts.referencesNumbered = true;
          if(lk.extraImages.length) opts.extraImages = lk.extraImages;
          Object.assign(opts.metaExtra, lk.meta, baseUrl ? { baseMasterIso:(((typeof nbGetMeta==="function") && nbGetMeta(c.id))||{}).iso||"" } : {});
        } else {
          if(baseUrl) opts.referenceImage = baseUrl;
          Object.assign(opts.metaExtra, _likenessSkipped(c, lk));
          if(!lk){ const cameo = await _cameoOf(c.id); if(cameo.length) opts.extraImages = cameo; }   // an older build: today's behaviour
        }
        return _genCharImage(c.id+":"+st.id, prompt, opts); },
      // worn props of this character that ALREADY have a generated sheet — the trigger for
      // the Coordinator's "wear props" pass (re-generate the master so it wears them exactly).
      wornPropsWithSheets: async (c)=>{
        const excluded=new Set(Array.isArray(c.wornReferenceExclusions)?c.wornReferenceExclusions:[]);
        const worn = (props||[]).filter(p=>p && p.ownerId===c.id && p.kind!=="carried");
        const out=[]; for(const p of worn){ const u=await _grabImg(p.id); if(u&&!excluded.has(p.id)) out.push(p); }
        if(typeof window.loadWornReferenceSnapshot!=="function" || typeof window.compareWornReferenceSnapshots!=="function") return out;
        // (2026-10-08) no worn sheet left: the master may still WEAR one that was deleted — compare anyway,
        // so "Update sheet with new wardrobe" shows (it used to stop here and the master kept the item)
        if(!out.length){
          let meta0=null; try{ const d=await nbLoadDetailsAsset(c.id); meta0=d&&d.meta; }catch(e){}
          const had=(meta0&&meta0.wornReferences)||[];
          if(!had.length) return [];
          const reasons0=window.compareWornReferenceSnapshots(had, await window.loadWornReferenceSnapshot(c,worn));
          return reasons0.length ? (worn.length ? worn : [{ id:"__removed-worn-item", name:"a removed worn item" }]) : [];
        }
        let meta=null; try{ const d=await nbLoadDetailsAsset(c.id); meta=d&&d.meta; }catch(e){}
        const current=await window.loadWornReferenceSnapshot(c,worn);
        const reasons=window.compareWornReferenceSnapshots(meta&&meta.wornReferences||[],current);
        return reasons.length ? out : [];
      },
    };

    // ---- Props Master surface (Props tab agent): brief proposals → draft → generate ----
    // Works on a per-run copy of the props so each step sees the prior step's result
    // (React state is async); every step also persists via setProps so the live tab updates.
    let _propWork = (props||[]).slice();
    const _propDrafted = (p)=> (typeof propVisualsDrafted==="function") ? propVisualsDrafted(p)
      : !!((p.form||"").trim() && (p.material||"").trim());
    const _PS = ()=> window.PropScreenplay || null;
    const propmaster = {
      // (2026-10-12, owner) EXTRACT FIRST: has the screenplay already been read for props on this film?
      extracted: ()=> _propWork.some(p=> p && (p.screenplaySources||[]).length),
      canExtract: ()=> typeof window.aiExtractScreenplayProps==="function" && (scenes||[]).length>0
        && !!(typeof aiAvailable!=="function" || aiAvailable()),
      // the extraction PROPOSES (a writing call per screenplay section); nothing is added here
      extract: async (isCancelled)=>{
        const r = await window.aiExtractScreenplayProps(scenes, draftsRef.current||drafts, characters,
          locations||[], _propWork, null, isCancelled);
        return r || null;
      },
      // apply the reviewed proposals with their default choices (what "Apply" does on the Props tab):
      // a PATCH onto the live list — new objects added, linked ones updated — never a snapshot
      applyExtraction: (candidates)=>{
        const PS = _PS(); if(!PS) return { added:0, linked:0 };
        const live = draftsRef.current||drafts;
        const chosen = (candidates||[]).filter(c=>c && c.target!=="skip");
        if(!chosen.length) return { added:0, linked:0 };
        const next = PS.accept(_propWork, chosen, live);   // throws when the screenplay changed meanwhile
        const before = new Set(_propWork.map(p=>p.id));
        const withScenes = (p)=> Array.isArray(p.scenes) ? withEpisodeSceneRefs(p, p.scenes, scenesRef.current||scenes) : p;
        const changed = {}; next.forEach(p=>{ if(before.has(p.id) && _propWork.find(x=>x.id===p.id)!==p) changed[p.id]=withScenes(p); });
        const added = next.filter(p=>!before.has(p.id)).map(withScenes);
        _propWork = next.map(p=> changed[p.id] || added.find(a=>a.id===p.id) || p);
        // a linked card is re-linked on its LIVE copy, so an edit made while the run read the screenplay stays
        _w.setProps(ps=>{ const have = new Set(ps.map(p=>p.id));
          const relink = (p)=>{ try{ return withScenes(PS.accept([p], chosen.filter(d=>d.target===p.id), live)[0]); }catch(e){ return p; } };
          return [...ps.map(p=> changed[p.id] ? relink(p) : p), ...added.filter(a=>!have.has(a.id))]; });
        return { added:added.length, linked:Object.keys(changed).length };
      },
      // pull the cast's own worn/carried items in (dedup handled by propsFromCast; carried = proposals)
      deriveCast: ()=>{
        if(typeof propsFromCast!=="function") return 0;
        const add = propsFromCast(characters, [..._propWork, ...((trash&&trash.props)||[])], scenes, drafts);
        if(add.length){ _propWork = [..._propWork, ...add]; _w.setProps(ps=>[...ps, ...add]); _w.setPropsSeeded(true); }
        return add.length;
      },
      // draft form/material/detail/renderStyle for every undrafted prop
      draftSpecs: async (force)=>{
        if(typeof aiDesignPropBible!=="function") return 0;
        // never a proposal — a carried object the screenplay doesn't name (2026-10-12, owner)
        const PSd = _PS();
        const todo = _propWork.filter(p=>(force || !_propDrafted(p)) && !(PSd && PSd.isProposal && PSd.isProposal(p)));
        if(!todo.length) return 0;
        const map = await aiDesignPropBible(todo, characters, lbProject("props"));
        if(!map) throw new Error("no specs came back");   // said out loud — it read "Specs already complete" (2026-10-09)
        // a render style you PICKED survives a forced re-draft, as in the Props tab's own Draft (2026-10-06)
        const patch = (ps)=> ps.map(p=> map[p.id] ? {...p, ...keepPickedStyle(p, map[p.id])} : p);
        _propWork = patch(_propWork); _w.setProps(patch);
        return Object.keys(map).length;
      },
      // drafted props that still need a sheet (text-only objects are described in shots instead)
      toGenerate: async (force)=>{
        const out=[];
        const drafts0=(window.turnContinuity||{}).drafts||drafts;
        // (2026-10-08) a NEW sheet follows the Props tab's batch rules: no optional worn macro sheet, no
        // world-generic ownerless carried prop, nothing the extracted screenplay didn't establish, no
        // text-only object, no unusable name. A sheet that already exists is kept current on a forced run.
        const PS = window.PropScreenplay;
        const extracted = _propWork.some(p=> p && (p.screenplaySources||[]).length);
        for(const p of _propWork){
          if(!_propDrafted(p)) continue;
          // a proposal is never paid for, not even to refresh a sheet it already has (2026-10-12, owner)
          if(PS && PS.isProposal && PS.isProposal(p)) continue;
          const has = await _grabImg(p.id);
          if(!force && has) continue;
          if(!has){
            if(p.kind==="worn") continue;
            if((p.kind||"carried")==="carried" && !p.ownerId) continue;
            if(PS && PS.sheetTier(p,drafts0).tier==="text") continue;
            if(PS && PS.batchSkip(p, extracted)) continue;   // the batch's rule; a proposal on ANY film (2026-10-12)
            if(PS && PS.nameIssue && PS.nameIssue(p.name)) continue;
          }
          out.push(p);
        }
        return out;
      },
      generateSheet: async (p)=>{
        if(typeof window.generatePropSheet!=="function") throw new Error("prop generator unavailable");
        return window.generatePropSheet(p, project);
      },
    };

    // ---- Location Scout surface (Locations tab agent): pull → coverage → spec → staging → variants → generate ----
    let _locWork = (locations||[]).slice();
    let stagingFailed = [];   // places whose staging couldn't be drafted in the last pass
    let stagingWaiting = [];  // places whose staging waits for their shared layout (2026-10-12)
    const _locDrafted = (l)=> (typeof locVisualsDrafted==="function") ? locVisualsDrafted(l)
      : !!((l.architecture||"").trim() && (l.lighting||"").trim());
    const locscout = {
      stagingFailed: ()=> stagingFailed.slice(),
      stagingWaiting: ()=> stagingWaiting.slice(),
      // pull master places from screenplay headings (new cards), and refresh scene lists / times on existing
      pull: ()=>{
        if(typeof deriveLocations!=="function") return 0;
        const derived = deriveLocations(scenes, [..._locWork, ...(((trashRef.current||trash)&&(trashRef.current||trash).locations)||[])], drafts);   // new only — never one in Recently deleted
        const fresh = deriveLocations(scenes, [], drafts);                  // all, to refresh scene lists/times/areas
        // a PATCH, not a snapshot (2026-10-08): edits made while the run works are kept
        const patch = (ls)=>{ let next = ls.map(l=>{ const m=fresh.find(f=>f.key===l.key);
            return m ? withEpisodeLocationMeta(l,{...m,
              times:[...new Set([...(l.times||[]),...(m.times||[])])],
              areas:[...new Set([...(l.areas||[]),...(m.areas||[])])]}) : l; });
          const have = new Set(next.map(l=>l && l.id));
          derived.forEach(l=>{ if(!have.has(l.id)) next.push(withEpisodeLocationMeta(l,l)); });
          return next; };
        _locWork = patch(_locWork); _w.setLocations(patch); _w.setLocsSeeded(true);
        return derived.length;
      },
      coverage: ()=> (typeof locationCoverage==="function") ? locationCoverage(scenes, _locWork) : [],
      draftSpecs: async (force)=>{
        if(typeof aiDesignLocationBible!=="function") return 0;
        const todo = _locWork.filter(l=>force || !_locDrafted(l));
        if(!todo.length) return 0;
        const map = await aiDesignLocationBible(todo, scenes, lbProject("locations"));
        if(!map) throw new Error("no specs came back");   // said out loud — it used to read "Specs already complete"
        const patch = (ls)=> ls.map(l=> map[l.id] ? {...l, ...keepPickedStyle(l, map[l.id])} : l);
        _locWork = patch(_locWork); _w.setLocations(patch);
        return Object.keys(map).length;
      },
      draftStaging: async ()=>{
        if(typeof aiDraftStaging!=="function") return 0;
        // Depth grids earn their model call on locations the film REVISITS (2+ scenes),
        // where cross-scene geometric continuity matters. Single-scene places generate
        // fine from their prose spec; skip them here (the card's "Draft staging" button
        // still stages any one location on demand).
        // the layout first (2026-10-12): never pays for a composition whose shared layout isn't ready — named instead
        const layoutReady = (l)=>{ try{ if(typeof requireLocationSpatialPlan==="function") requireLocationSpatialPlan(l); return true; }catch(e){ return false; } };
        const want = _locWork.filter(l=>_locDrafted(l) && !l.staging && (l.scenes||[]).length>=2);
        stagingWaiting = want.filter(l=>!layoutReady(l)).map(l=>l.name||"a location");
        const todo = want.filter(layoutReady);
        if(!todo.length) return 0;
        const res = await Promise.all(todo.map(async l=>{ try{ return {id:l.id, staging: await aiDraftStaging(l, scenes, project)}; }catch(e){ return {id:l.id, staging:null, err:e}; } }));
        // the places whose staging couldn't be drafted are named by the agent (2026-10-09 — they were dropped silently)
        stagingFailed = res.filter(x=>!x.staging).map(x=>((_locWork.find(l=>l.id===x.id)||{}).name)||"a location");
        const sMap={}; res.forEach(x=>{ if(x.staging) sMap[x.id]=x.staging; });
        if(!Object.keys(sMap).length) return 0;
        const patch = (ls)=> ls.map(l=> sMap[l.id] ? {...l, staging:sMap[l.id]} : l);
        _locWork = patch(_locWork); _w.setLocations(patch);
        return Object.keys(sMap).length;
      },
      // add a variant for each extra time-of-day a place appears at (times[0] is the base plate)
      addVariants: ()=>{
        let added=0;
        const stamp = Date.now().toString(36);
        // decide the additions once, from the run's copy; apply them to the LIVE list as a patch (2026-10-08 —
        // it used to write the run's whole copy back, over edits made while specs were drafting)
        const addsById = {};
        _locWork.forEach(l=>{
          const times = (typeof deriveLocationTimes==="function") ? deriveLocationTimes(l, scenes) : (l.times||[]);
          if(times.length<2) return;
          const have = new Set((l.variants||[]).map(v=>v.time));
          const need = times.slice(1).filter(t=>!have.has(t));
          if(!need.length) return;
          addsById[l.id] = need.map((t,i)=>({ id:"v"+stamp+"-"+(added+i)+"-"+t.toLowerCase().replace(/[^a-z0-9]/g,""), time:t }));
          added += addsById[l.id].length;
        });
        const patch = (ls)=> ls.map(l=>{ const adds = l && addsById[l.id]; if(!adds) return l;
          const have = new Set((l.variants||[]).map(v=>v.time));
          const fresh = adds.filter(v=>!have.has(v.time));
          return fresh.length ? {...l, variants:[...(l.variants||[]), ...fresh]} : l; });
        _locWork = patch(_locWork); if(added) _w.setLocations(patch);
        return added;
      },
      // THE TAB'S RULES (2026-10-08, owner — Locations review): a plate waits while its shared layout isn't
      // reviewed, and a room's plate needs its parent's plate (one that exists, or one this run makes)
      toGeneratePlates: async (force)=>{
        const live = (window.turnContinuity && window.turnContinuity.locations) || _locWork;
        const ready = (l)=>{ try{ if(typeof requireLocationSpatialPlan==="function") requireLocationSpatialPlan(l); return true; }catch(e){ return false; } };
        const cand=[];
        for(const l of _locWork){ if(!_locDrafted(l) || !ready(l)) continue; if(!force && await _grabImg(l.id)) continue; cand.push(l); }
        const ordered = (typeof locationGenerationOrder==="function") ? locationGenerationOrder(cand) : cand;
        const out=[], made=new Set();
        for(const l of ordered){
          const par = (typeof locationParentOf==="function") ? locationParentOf(l, live) : null;
          if(par && !made.has(par.id) && !(await _grabImg(par.id))) continue;
          out.push(l); made.add(l.id);
        }
        return out;
      },
      waitingPlates: ()=> _locWork.filter(l=>{ if(!_locDrafted(l)) return false;
        try{ if(typeof requireLocationSpatialPlan==="function") requireLocationSpatialPlan(l); return false; }catch(e){ return true; } }).length,
      toGenerateVariants: async (force, plates)=>{
        const out=[];
        const willHave = new Set((plates||[]).map(l=>l && l.id));
        for(const l of _locWork){ if(!_locDrafted(l)) continue;
          if(!willHave.has(l.id) && !(await _grabImg(l.id))) continue;   // a state needs its location's plate
          /* Screenplay Sluglines and Appearance States are projections of one
             place/side/time record. Include screenplay-derived rows here too,
             so the Location Scout generates the shared state asset itself
             instead of only legacy location.variants records. */
          const states = (typeof locationAppearanceStates==="function")
            ? locationAppearanceStates(l,sluglineUnits||[]) : (l.variants||[]);
          for(const v of states){
            const assetId = (typeof locationAppearanceStateAssetId==="function")
              ? locationAppearanceStateAssetId(l,v,sluglineUnits||[]) : l.id+"-"+v.id;
            if(!force && await _grabImg(assetId)) continue;
            out.push({l, v});
          } }
        return out;
      },
      generatePlate: async (l)=>{ if(typeof window.generateLocationPlate!=="function") throw new Error("plate generator unavailable"); return window.generateLocationPlate(l, project); },
      generateVariant: async (l, v)=>{ if(typeof window.generateLocationVariant!=="function") throw new Error("variant generator unavailable"); return window.generateLocationVariant(l, v, project); },
    };

    // ---- Visual Researcher surface (Lookbook tab agent): research-only.
    // Frame rendering is the explicit "Generate missing frames" button in the Lookbook.
    let _lbWork = (typeof dedupeLookbookCards==="function") ? dedupeLookbookCards(lookbook||[]) : (lookbook||[]).slice();
    const lookbookSurface = {
      // TRUE when the visual research is already DONE: the look statement is written and
      // every touchstone category holds a noted reference. The agent checks this FIRST —
      // a re-run would only spend a writing call re-proposing the wall that's already up.
      researched: ()=>{
        if(lookbookFreshRef.current) return false;   // from scratch: always research
        if(!(lookbookNote||"").trim()) return false;
        const covered = new Set(_lbWork.filter(c=>(c.note||"").trim()).map(c=>c.category||"Palette"));
        return (window.LOOKBOOK_CATEGORIES||[]).every(cat=>covered.has(cat));
      },
      // write the visual statement + reference touchstones, then write them through to the
      // Colorist's references (project.styleBible.refs) so the look propagates downstream.
      research: async ()=>{
        if(typeof window.aiResearchLookbook!=="function") return { statement:"", added:0 };
        // pass the existing cards so a re-run targets the GAPS (missing categories)
        // instead of re-proposing the same six photographic touchstones
        const fresh = !!lookbookFreshRef.current; lookbookFreshRef.current = false;
        // from scratch: only YOUR cards stay in view; the researched ones are replaced if this succeeds
        const mine = (c)=> !!(c && (c.manual || c.autoNamed));
        const base = fresh ? _lbWork.filter(mine) : _lbWork;
        const r = await window.aiResearchLookbook(scenes, project, base, { fresh });
        // an empty answer is a failure on any run (2026-10-09 — a gap-filling run called it a success)
        if(!r || (!r.statement && !(r.refs||[]).length)) return { statement:"", added:0, failed:true };
        if(fresh){
          // the swap: the researched cards move to Recently deleted (with their frames), the new statement goes in
          const at = new Date().toISOString();
          _w.setLookbook(ls=>ls.map(c=> (c && !c.deletedAt && !mine(c)) ? { ...c, deletedAt:at } : c));
          _lbWork = base;
          if(r.statement) _w.setLookbookNote(r.statement);
        }
        // keep an existing statement — a gap-filling re-run shouldn't rewrite the north star
        else if(r.statement && !(lookbookNote||"").trim()) _w.setLookbookNote(r.statement);
        const slug = (s)=> String(s||"").toLowerCase().replace(/\([^)]*\)/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
        // the same touchstone for the same category is the same card (lookbook.jsx lookbookCardKey)
        const keyOf = (e)=> (typeof lookbookSourceKey==="function") ? (lookbookSourceKey(e)+"|"+String((e&&e.category)||"Palette")) : slug(e&&e.source);
        const seen = new Set(_lbWork.map(c=>keyOf(c)));
        let cards = [];
        (r.refs||[]).forEach((e,i)=>{
          const key = keyOf(e);
          if(!e.source || !key || seen.has(key)) return;
          seen.add(key);
          // a fresh id every run — a reused id took over a deleted card (lost from the bin, its old frame inherited)
          cards.push({ id:"look-"+slug(e.source).slice(0,24)+"-"+i+"-"+Date.now().toString(36), source:e.source, category:e.category||"Palette", note:e.note||"", negativePrompt:"",
            ...(r.writingProvenance?{writingProvenance:{...r.writingProvenance}}:{}) });
        });
        // GROWTH GUARD — the brief is 8 touchstones covering the categories. A re-run
        // may only FILL GAPS (one card per still-missing category), never grow the
        // wall, whatever the model returns (bug 2026-07-16: re-runs stacked 48 cards).
        const _noted = _lbWork.filter(c=>(c.note||"").trim());
        if(fresh) cards = cards.slice(0, 8);   // from scratch: the full brief, never more
        else if(_noted.length){
          const covered = new Set(_noted.map(c=>c.category));
          cards = cards.filter(c=>{ if(covered.has(c.category)) return false; covered.add(c.category); return true; });
        }
        // every write keeps the Recently deleted cards (lookbook.jsx lookbookKeepDeleted)
        const keepBin = (all, live)=> (typeof lookbookKeepDeleted==="function") ? lookbookKeepDeleted(all, live) : live;
        if(cards.length){
          _lbWork = (typeof dedupeLookbookCards==="function") ? dedupeLookbookCards([..._lbWork, ...cards]) : [..._lbWork, ...cards];
          _w.setLookbook(ls=> keepBin(ls, (typeof dedupeLookbookCards==="function") ? dedupeLookbookCards([...ls, ...cards]) : [...ls, ...cards]));
        } else if(typeof dedupeLookbookCards==="function" && _lbWork.length !== ((typeof lookbookLive==="function" ? lookbookLive(lookbook) : lookbook)||[]).length){
          _w.setLookbook(ls=> keepBin(ls, _lbWork));
        }
        // the Colorist's references follow from here: the write-through fills the Color tab's
        // field from the Lookbook, and art.references / designStyles read the same rule
        // (colorRefsFor) — so the next step sees this research even before that render lands
        return { statement:r.statement||"", added:cards.length, renderStyle:r.renderStyle||null };
      },
      // the current dominant style label (for the proposal card's "before" line)
      currentStyleLabel: ()=>{
        const tally = {};
        [...(characters||[]), ...(props||[]), ...(locations||[])].forEach(e=>{ const k=e&&e.renderStyleKey; if(k) tally[k]=(tally[k]||0)+1; });
        const keys = Object.keys(tally);
        if(!keys.length) return "defaults (photoreal)";
        const top = keys.sort((a,b)=>tally[b]-tally[a]);
        const lab = (k)=> String((window.RENDER_STYLE_LABELS||{})[k]||k).replace(/^[🔒🌐]\s*/,"");
        return top.length===1 ? lab(top[0]) : ("mixed — mostly "+lab(top[0]));
      },
      // APPROVED render-style proposal → set the style dropdown on EVERY character,
      // prop and location in one pass (the same write shapes the per-card pickers use);
      // per-card dropdowns remain the override afterwards.
      /* opts.onlyUnset (Run pre-production, 2026-10-09 — owner, Art Room review): applied automatically, the film's
         style fills only the cards with no style yet; a style already set on a card stays (it used to reset every
         dropdown, including ones picked by hand). Approved on its own card, it sets every card, as the card says. */
      applyRenderStyle: (key, opts)=>{
        const onlyUnset = !!(opts && opts.onlyUnset);
        const take = (x)=> !onlyUnset || !(x && x.renderStyleKey);
        const locText = (typeof window.renderStyleText==="function") ? window.renderStyleText("loc", key) : "";
        const propText = (typeof window.renderStyleText==="function") ? window.renderStyleText("prop", key) : "";
        const n = { characters:(characters||[]).filter(take).length, props:(props||[]).filter(take).length, locations:(locations||[]).filter(take).length,
          kept:onlyUnset ? [characters,props,locations].reduce((t,a)=>t+(a||[]).filter(x=>!take(x)).length,0) : 0 };
        _w.setCharacters(cs=>cs.map(c=> take(c) ? ({ ...c, renderStyleKey:key }) : c));
        _w.setProps(ps=>ps.map(p=> take(p) ? ({ ...p, renderStyleKey:key, ...(propText?{renderStyle:propText}:{}) }) : p));
        _w.setLocations(ls=>ls.map(l=> take(l) ? ({ ...l, renderStyleKey:key, ...(locText?{renderStyle:locText}:{}) }) : l));
        return n;
      },
      toGenerate: async ()=>{
        const out=[];
        const work = (typeof dedupeLookbookCards==="function") ? dedupeLookbookCards(_lbWork) : _lbWork;
        for(const c of work){ if(!lookbookCardDrafted(c)) continue; if(await _grabImg(c.id)) continue; out.push(c); }
        return out;
      },
      // repair plan for a lookbook that outgrew its brief (the pre-guard bug):
      // KEEP every hand-added card, every card with a rendered frame, and one noted
      // card per category; everything else (agent-added, unrendered, category already
      // covered) is excess. Applied ONLY behind the agent's approval card.
      trimPlan: async ()=>{
        const work = (typeof dedupeLookbookCards==="function") ? dedupeLookbookCards(_lbWork) : _lbWork.slice();
        const keepIds = new Set(), covered = new Set(), drop = [];
        for(const c of work){
          const rendered = !!(await _grabImg(c.id));
          if(c.manual || rendered){ keepIds.add(c.id); if((c.note||"").trim()) covered.add(c.category); }
        }
        work.forEach(c=>{
          if(keepIds.has(c.id)) return;
          if((c.note||"").trim() && !covered.has(c.category)){ covered.add(c.category); keepIds.add(c.id); return; }
          drop.push(c);
        });
        return { keep: work.filter(c=>keepIds.has(c.id)), drop };
      },
      applyTrim: (plan)=>{
        const dropIds = new Set(((plan&&plan.drop)||[]).map(c=>c.id));
        if(!dropIds.size) return 0;
        _lbWork = _lbWork.filter(c=>!dropIds.has(c.id));
        _w.setLookbook(ls=> ls.filter(c=>!dropIds.has(c.id) || c.deletedAt));
        (plan.drop||[]).forEach(c=>{ try{ if(typeof nbClearAsset==="function") nbClearAsset(c.id); }catch(e){} });
        return dropIds.size;
      },
      generateFrame: async (c)=>{ if(typeof window.generateLookbookFrame!=="function") throw new Error("frame generator unavailable"); return window.generateLookbookFrame(c, project); },
    };

    const draftOnly = force==="draft";
    const forceImages = force===true;
    // Design the cast's preview scope (CastConfirm): only these characters / no variants
    const castScope = (force && typeof force==="object") ? force : null;
    const ctxArgs = { input, emit, propose, cancelled, agentName, force, owner:ownerProjectId, run };
    return { input, emit, propose, project, force: forceImages,
      // a run stops if the role can no longer change the Art Room, too (2026-10-09)
      cancelled: ()=> cancelled() || switchedFilms() || !!artRoomReadOnlyRef.current,
      switchedFilms, roleLost,
      // A FRESH CONTEXT for the next step of a multi-step run (2026-10-02): this context's reads
      // (the Lookbook brief, the cast list, the props, the Colorist's references) are the film as
      // it was when it was built. The Art Coordinator asks for a new one before each step, once
      // the previous step's writes are committed, so every step works from the film as it is now.
      refresh: async ()=>{
        if(switchedFilms()) return null;
        await artNextCommit();
        const mk = artAgentCtxFactoryRef.current || artAgentCtxFactory;
        return switchedFilms() ? null : mk(ctxArgs);
      },
      // "Re-draft only": re-draft every spec from the Lookbook but leave generated images alone
      draftOnly,
      castOnly: castScope && Array.isArray(castScope.only) ? castScope.only.slice() : null,
      castVariants: !(castScope && castScope.variants===false),
      // the optional Script check of each new master sheet (Design the cast's preview, 2026-10-12)
      castFidelity: !!(castScope && castScope.fidelity),
      ai:{ available: (typeof aiAvailable==="function" && aiAvailable()) },
      art:{
        coverage,
        cast,
        propmaster,
        locscout,
        // the run's film-guarded setters (inFilm): "Make what this scene needs" saves a drafted design or view
        // composition through these, so nothing lands in another film or after the role is lost (2026-10-09)
        writes:_w,
        lookbook: lookbookSurface,
        // Color follows the Lookbook only while its references field isn't your own text: approving a
        // palette lit from YOUR text doesn't mean the Lookbook change was applied (2026-10-06)
        markApplied: (dept)=>{ if(dept==="colorist" && typeof colorRefsFor==="function"
            && colorRefsFor((project&&project.styleBible)||{}, lookbook, lookbookNote).owned) return;
          _w.markApplied(dept); },
        // ---- Cinematographer / Colorist tools (Style Bible agent) ----
        scenesLite: ordered.map(s=>({ id:s.id, no:s.no, title:s.title })),
        // the Colorist's references = the Presets refs field, worked out by the same rule the
        // write-through fills it with (colorRefsFor) — WYSIWYG, and current even before the
        // write-through's render lands
        references: ()=>{ const sb=(typeof styleBibleOf==="function")?styleBibleOf(project):{};
          return { refs:String(colorRefsFor(sb, lookbook, lookbookNote).refs||"").trim(), refImages:sb.refImages||[] }; },
        designStyles: async ()=>{ const sb=(typeof styleBibleOf==="function")?styleBibleOf(project):{};
          const seed=(sb.presets&&sb.presets.length)?sb.presets:(window.STYLE_PRESETS_DEFAULT||[]);
          const refs=colorRefsFor(sb, lookbook, lookbookNote).refs;
          return window.aiAssignSceneStyles(scenes, seed, drafts, { ...project, styleBible:{ ...((project&&project.styleBible)||{}), refs } }); },
        applyStyles: (res)=> _w.applyStyleResult(res, null, { redoManual:_redoManual0 }),
        // what this run keeps: your film stock (unless it redoes your picks)
        keepsFilmStock: ()=>{ const sb=(project&&project.styleBible)||{}; return !_redoManual0 && !!sb.filmStockManual ? (sb.filmStock||"none") : ""; },
        // scene ids the user picked by hand — kept by applyStyles unless the run redoes them
        manualScenes: ()=>{ const sb=(project&&project.styleBible)||{}; if(_redoManual0) return [];
          const m=sb.sceneStylesManual||{}; return Object.keys(m).filter(sid=>m[sid] && (sb.sceneStyles||{})[sid]); },
      } };
  };
  // LATEST-RENDER handle for long-lived async work (the wardrobe bootstrap): an event
  // handler that survives re-renders would otherwise call a factory whose props/characters
  // closure predates the setProps merges made DURING the batch — the re-bake would then
  // rebuild the worn list from a stale (possibly empty) props array and miss the very
  // wardrobe it just generated. The ref always points at the current render's factory.
  const artAgentCtxFactoryRef = React.useRef(null);
  artAgentCtxFactoryRef.current = artAgentCtxFactory;
  // NEXT COMMIT (2026-10-02) — what an Art context's refresh() waits for: resolves once React has
  // committed the updates queued so far (a forced render guarantees one); the 1 s fallback keeps
  // a run moving if the window is hidden and rendering is paused
  const artCommitWaitersRef = React.useRef([]);
  const [, setArtCommitTick] = React.useState(0);
  React.useEffect(()=>{ const w = artCommitWaitersRef.current.splice(0); w.forEach(f=>{ try{ f(); }catch(e){} }); });
  const artNextCommit = ()=> new Promise(res=>{
    let done=false; const fin=()=>{ if(!done){ done=true; res(); } };
    artCommitWaitersRef.current.push(fin); setArtCommitTick(t=>t+1); setTimeout(fin, 1000);
  });
  // ART UNDO (2026-10-02): the Art Room's own undo stack — what an agent run changed in the
  // Art Room's specs (the cast, props, locations, Lookbook, colour system and shot list), one
  // step per run. Sheets and frames a run rendered aren't part of it: each keeps its earlier
  // versions in its own history. Like the Writers' stack, a film switch drops other films' steps.
  const artUndoLiveRef = React.useRef(null);
  artUndoLiveRef.current = { characters, props, locations, lookbook, lookbookNote, lookbookApplied, shots, project, propsSeeded, locsSeeded };
  const [artUndo, setArtUndo] = React.useState([]);
  const artUndoRef = React.useRef(artUndo); artUndoRef.current = artUndo;
  React.useEffect(()=>{
    const k = agentFilmKey();
    setArtUndo(st=> st.some(x=>!x || x.filmKey!==k) ? st.filter(x=>x && x.filmKey===k) : st);
  },[currentProjectId]);
  const artUndoHere = artUndo.filter(x=>x && x.filmKey===agentFilmKey());
  const artUndoAskingRef = React.useRef(false);
  const undoLastArtAgent = async ()=>{
    if(artUndoAskingRef.current || artRoomReadOnlyRef.current) return;
    const k = agentFilmKey();
    const top = ()=>{ const st = (artUndoRef.current||[]).filter(x=>x && x.filmKey===k); return st[st.length-1] || null; };
    const snap = top(); if(!snap) return;
    const who = (typeof window.turnDisplayNames==="function") ? window.turnDisplayNames(snap.label) : snap.label;
    if(typeof window.appConfirm==="function"){
      artUndoAskingRef.current = true;
      let ok = false;
      try{ ok = await window.appConfirm({ title:"Undo "+who+"\u2019s changes?",
        body:"This puts the Art Room back the way it was just before "+who+" ran: the characters, props, locations, Lookbook, colour system and shot list. Anything changed in those since then goes too. Sheets and frames it rendered stay \u2014 each keeps its earlier versions in its history.",
        confirmLabel:"Undo changes", cancelLabel:"Keep everything", danger:true, safeDefault:true }); }
      finally{ artUndoAskingRef.current = false; }
      // the film, the stack or the role may have moved while the question was open
      if(!ok || top()!==snap || agentFilmKey()!==k || artRoomReadOnlyRef.current) return;
    }
    setCharacters(snap.characters.map(c=>({ ...c })));
    setProps(snap.props.map(x=>({ ...x })));
    setLocations(snap.locations.map(x=>({ ...x })));
    setLookbook(snap.lookbook.map(x=>({ ...x })));
    setLookbookNote(snap.lookbookNote);
    setLookbookApplied({ ...snap.lookbookApplied });
    setShots(snap.shots.map(x=>({ ...x })));
    // shots it brings back leave Recently deleted (2026-10-09 — they were live AND binned, and "Delete
    // forever" on the binned copy wiped the live shot's frame)
    { const back = new Set(snap.shots.map(x=>x && x.id)); setTrash(t=>({ ...t, shots:(t.shots||[]).filter(x=>!(x && back.has(x.id))) })); }
    if(snap.propsSeeded!==undefined) setPropsSeeded(snap.propsSeeded);
    if(snap.locsSeeded!==undefined) setLocsSeeded(snap.locsSeeded);
    setProject(p=>{ const n = { ...p };
      if(snap.hadStyleBible) n.styleBible = JSON.parse(JSON.stringify(snap.styleBible)); else delete n.styleBible;
      return n; });
    setArtUndo(st=> st.filter(x=>x!==snap));
  };
  const artUndoProps = { undoCount:artUndoHere.length,
    undoLabel:artUndoHere.length ? artUndoHere[artUndoHere.length-1].label : null, onUndo:undoLastArtAgent };

  // ---- WARDROBE-ATTENTION DOT (Characters tab) ----
  // A yellow dot on the Characters tab when something in there is waiting on the user:
  // a background worn-prop batch ended with failures, or a master sheet is out of sync
  // with newly built worn-prop sheets (the one-tap "Update sheet with new wardrobe"
  // action is sitting on the card). A nudge, never a roadblock — updating is optional.
  const [wardrobeAttn, setWardrobeAttn] = React.useState(false);
  const [wardrobeCount, setWardrobeCount] = React.useState(0);   // sheets waiting to wear new props
  const [wardrobeIds, setWardrobeIds] = React.useState([]);      // …and which: their card shows "Update sheet with new wardrobe"
  const [wardrobeTick, setWardrobeTick] = React.useState(0);
  React.useEffect(()=>{
    const bump = ()=>setWardrobeTick(t=>t+1);
    window.addEventListener("nb-gen-done",bump);
    window.addEventListener("nb-gen-cancel",bump);
    return ()=>{ window.removeEventListener("nb-gen-done",bump); window.removeEventListener("nb-gen-cancel",bump); };
  },[]);
  React.useEffect(()=>{
    let live = true;
    // sync signal — a worn-prop batch finished with failures (the card explains itself)
    const bootAttn = (characters||[]).some(c=>c && c.wornPropBootstrap && c.wornPropBootstrap.status==="attention");
    if(bootAttn) setWardrobeAttn(true);
    // async signal — debounced: this loads sheet meta per character and generations land
    // in bursts. Reuses the SAME staleness audit the card banner and the Coordinator use
    // (wornPropsWithSheets), via the latest render's factory, and COUNTS every character
    // whose master must be re-rendered to wear its props (Run pre-production's estimate).
    const t = setTimeout(async ()=>{
      try{
        const mk = artAgentCtxFactoryRef.current;
        if(!mk){ if(live){ setWardrobeAttn(bootAttn); setWardrobeCount(0); setWardrobeIds([]); } return; }
        const cast = mk({ input:"", emit:()=>{}, propose:null, cancelled:()=>!live, agentName:"Badge", force:false }).art.cast;
        let n = 0; const ids = [];
        for(const c of (characters||[])){
          if(!live) return;
          // only characters whose master EXISTS — the update action lives on that sheet
          // (async loader: the sync cache is cold right after a reload/film switch)
          let master = (typeof nbGetImage==="function") ? nbGetImage(c.id) : "";
          if(!master && typeof nbLoadImage==="function"){ try{ master = await nbLoadImage(c.id); }catch(e){} }
          if(!master) continue;
          const stale = await cast.wornPropsWithSheets(c);
          if(stale && stale.length){ n++; ids.push(c.id); }
        }
        if(live){ setWardrobeAttn(bootAttn || n>0); setWardrobeCount(n); setWardrobeIds(ids); }
      }catch(e){ if(live) setWardrobeAttn(bootAttn); }
    }, 500);
    return ()=>{ live=false; clearTimeout(t); };
  },[characters, props, wardrobeTick]);

  // restore the most recent pre-run snapshot OF THE OPEN FILM (2026-09-28: a snapshot from
  // another film is never offered, never applied)
  const agentUndoHere = agentUndo.filter(x=>x && x.filmKey===agentFilmKey());
  const agentUndoTop = ()=>{ const k = agentFilmKey();
    const st = (agentUndoRef.current||[]).filter(x=>x && x.filmKey===k); return st[st.length-1] || null; };
  const agentUndoAskingRef = React.useRef(false);
  // an agent's name as users see it today (a label recorded under an older name is renamed)
  const agentLabel = (l)=> (typeof window.turnDisplayNames==="function") ? window.turnDisplayNames(l) : l;
  const undoLastAgent = async ()=>{
    if(agentUndoAskingRef.current || !canMutateWritersRoom()) return;
    const snap = agentUndoTop(); if(!snap) return;
    // CHANGED SINCE THE RUN? (2026-09-28) Undo restores the WHOLE film to before the run. When
    // the film has moved on since the run's last write (a redraft, beat edits, a cast change),
    // those later changes go too — so it asks first and says so. Unchanged: undo at once.
    const moved = !!(snap.runWrite && typeof snap.runWrite.changed==="function" && snap.runWrite.changed());
    if(moved && typeof window.appConfirm==="function"){
      agentUndoAskingRef.current = true;
      let ok = false;
      const who = agentLabel(snap.label);
      try{ ok = await window.appConfirm({ title:"Undo "+who+"\u2019s changes?",
        body:"The film has changed since "+who+" made its changes. Undo puts the whole film back the way it was just before "+who+" ran, so everything changed after it \u2014 script edits, redrafts, beat and cast changes \u2014 will be lost too.",
        confirmLabel:"Undo anyway", cancelLabel:"Keep everything", danger:true, safeDefault:true }); }
      finally{ agentUndoAskingRef.current = false; }
      // the film, the stack or the role may have moved while the question was open
      if(!ok || agentUndoTop()!==snap || !canMutateWritersRoom()) return;
    }
    setScenes(snap.scenes.map(s=>({...s})));
    if(snap.characters) setCharacters(snap.characters.map(c=>({...c})));
    if(snap.project) setProject({...snap.project});
    setBeatsMap((typeof withBeatMapIdentity==="function")?withBeatMapIdentity(snap.beats):{...snap.beats});
    setDrafts({...snap.drafts});
    setContinuityMap(Object.fromEntries(Object.entries(snap.continuity).map(([k,v])=>[k,{...v}])));
    const ids = new Set(snap.scenes.map(s=>s.id));
    if(!ids.has(selId)) setSelId(snap.scenes[0] ? snap.scenes[0].id : null);
    setAgentUndo(st=> st.filter(x=>x!==snap));
  };

  // apply grade vars (re-shaded for light mode). The DEFAULT grade and display type are owned by
  // app/styles.css (:root + html[data-theme="light"]) — one accent family in CSS, never written
  // from JS (consistency pass 2026-09-29). Only the edit-mode Tweaks panel's alternative grades /
  // serif display override them inline; choosing the defaults again clears the overrides.
  React.useEffect(()=>{
    const r = document.documentElement.style;
    const GRADE_VARS = ["--pos","--neg","--pos-soft","--neg-soft","--pos-line","--neg-line"];
    const isDefault = !GRADES[t.grade] || t.grade==="Teal & Orange";
    if(isDefault) GRADE_VARS.forEach(v=>r.removeProperty(v));
    else {
      const g = GRADES[t.grade];
      const light = effectiveTheme === "light";
      const pos = light ? shadeOklch(g.pos, -0.16, 0.012) : g.pos;
      const neg = light ? shadeOklch(g.neg, -0.18, 0.012) : g.neg;
      r.setProperty("--pos", pos);
      r.setProperty("--neg", neg);
      r.setProperty("--pos-soft", pos.replace(")", light?" / .14)":" / .16)"));
      r.setProperty("--neg-soft", neg.replace(")", light?" / .14)":" / .16)"));
      r.setProperty("--pos-line", pos.replace(")", light?" / .42)":" / .5)"));
      r.setProperty("--neg-line", neg.replace(")", light?" / .42)":" / .5)"));
    }
    r.removeProperty("--brand");
    if(t.display==="Serif") r.setProperty("--f-display", '"Spectral",serif');
    else r.removeProperty("--f-display");
  },[t.grade,t.display,effectiveTheme]);

  const densClass = t.density==="compact"?"dens-compact":t.density==="comfy"?"dens-comfy":"";
  const premiumClass = t.premium ? "premium" : "";

  /* shared clean-canvas onboarding — used by the empty Writers' Room spine AND the
     hard-gated Art Room (the Art Room is downstream of the story — cast, props and
     locations are derived from it — so it stays blocked until a story exists). */
  /* the ONE empty-state pattern (the Art Room's .art-soon: an icon tile, a Spectral title, a 13px
     line, a standard lg primary) — consistency pass 2026-09-29 */
  const emptyCanvas = ()=> React.createElement("div",{className:"empty-canvas"},
    React.createElement("div",{className:"empty-canvas-card"},
      React.createElement("div",{className:"art-soon-ic","aria-hidden":"true"},React.createElement(Icon.spine||Icon.pen,{s:30})),
      React.createElement("div",{className:"empty-canvas-title"},"Start your story"),
      React.createElement("div",{className:"empty-canvas-sub"},"Your canvas is clean. Describe an idea and Kinolot builds the value-charge spine, scene by scene — then characters, props, script and shots all follow from it."),
      React.createElement("button",{className:"empty-canvas-btn",onClick:startNewStory},React.createElement(Icon.plus,{s:14}),"New Story")));
  const sceneByBusyShot = draftingSceneShots ? scenes.find(s=>s.id===draftingSceneShots) : null;
  const draftSceneNow = drafting ? scenes[Math.min(drafting.i||0, Math.max(0, scenes.length-1))] : null;
  const draftSceneNo = draftSceneNow && draftSceneNow.no!=null ? String(draftSceneNow.no).padStart(2,"0") : "";
  const busyShotSceneNo = sceneByBusyShot && sceneByBusyShot.no!=null ? String(sceneByBusyShot.no).padStart(2,"0") : "";
  const refiningBeatParts = refiningBeat ? String(refiningBeat).split("#") : [];
  const refiningBeatScene = refiningBeatParts.length ? scenes.find(s=>String(s.id)===refiningBeatParts[0]) : null;
  const refiningBeatNo = refiningBeatParts.length>1 ? refiningBeatParts[1] : "";
  const refiningBeatSceneNo = refiningBeatScene&&refiningBeatScene.no!=null ? String(refiningBeatScene.no).padStart(2,"0") : "";
  const draftingProgress = drafting && (drafting.total||scenes.length)
    ? ((Number(drafting.i||0) + (drafting.one ? 0.35 : 1)) / Math.max(1, Number(drafting.total||scenes.length))) * 100
    : null;
  /* ONE fiction across every busy overlay: each tab is a department profession — the
     overlay names the department doing the work (role, a job title) and the work being
     done (title). Roles match the agent roster (Casting Director, Props
     Master, Location Scout, Colorist, Shot Designer) so the agent panels and these
     pop-ups tell the same story. */
  const studioProgress =
    // "Redraft N out-of-date" (2026-09-28): the batch's own card — where it is, and a Stop —
    // in place of the single-scene card below, which said only "Redrafting Scene X"
    redraftingAll ? {
      role:"Screenwriter",
      title:"Redrafting "+redraftingAll.i+" of "+redraftingAll.total+" out-of-date scenes",
      detail:redraftingAll.stopping
        ? "Stopping after Scene "+redraftingAll.no+" \u2014 it is kept, and the rest stay marked out of date."
        : "Scene "+redraftingAll.no+": rebuilding its screenplay from the current card and beats. Every previous draft stays in version history (Undo restores it).",
      progress:((Number(redraftingAll.i)-1+0.5)/Math.max(1, Number(redraftingAll.total)))*100,
      onStop:stopRedraftAll, stopping:!!redraftingAll.stopping
    } :
    polishBusy ? {
      role:"Screenwriter",
      title:"Redrafting Scene "+(polishBusy.no!=null?polishBusy.no:""),
      detail:"Rebuilding the screenplay from the current beats — about a minute. The previous draft stays in version history (Undo restores it)."
    } :
    recastBusy ? {
      role:"Screenwriter",
      title:"Recasting Scene "+recastBusy.no+" for "+recastBusy.name,
      detail:"Rewriting the scene's summary, desire and beats so "+recastBusy.name+" drives — about half a minute."
    } :
    (room==="writers" && drafting) ? {
      role:"Screenwriter",
      title:drafting.one
        ? "Drafting Scene "+draftSceneNo
        : "Drafting the screenplay",
      detail:drafting.one
        ? (drafting.stopping ? "Stopping once the scene's beats are written \u2014 its screenplay won't be written."
          : "Writing Scene "+draftSceneNo+" from its beats while preserving continuity.")
        : drafting.stopping
        ? "Stopping after the scene being written now \u2014 it is kept, and the rest stay undrafted for Auto-draft all."
        : "Threading continuity scene by scene — "+Math.min(Number(drafting.i||0)+1, Number(drafting.total||scenes.length))+" of "+Number(drafting.total||scenes.length)+".",
      progress:draftingProgress,
      ...((drafting.one && !drafting.canStop) ? {} : { onStop:stopDraftAll, stopping:!!drafting.stopping })
    } :
    (room==="art" && draftingAllVisuals) ? {
      role:"Casting Director",
      title:"Designing character specs",
      detail:"Building wardrobe, body, continuity states and visual rules from the screenplay."
    } :
    (room==="art" && draftingAllProps) ? {
      role:"Props Master",
      title:"Designing prop specs",
      detail:"Pulling items from the cast and script, then mapping them to the scenes where they appear."
    } :
    (room==="art" && draftingAllLocs) ? {
      role:"Location Scout",
      title:"Scouting location specs",
      detail:"Deriving places from the screenplay, drafting set geography and staging reusable depth grids."
    } :
    (room==="art" && deletingShotReference) ? {
      role:"Shot Designer",
      title:"Deleting the selected reference image",
      detail:"Removing this exact saved image and its identifiable reference copies. Other versions and video takes are kept; no replacement is generated."
    } :
    (room==="art" && refiningBeat) ? {
      role:"Shot Designer",
      title:"Drafting specification · Beat "+refiningBeatNo+" · Scene "+refiningBeatSceneNo,
      detail:"Reading this beat's screenplay and composing one opening keyframe. Existing images and takes are preserved. This drafts the specification only; it does not generate an image."
    } :
    (room==="art" && draftingSceneShots) ? {
      role:"Shot Designer",
      title:"Designing shots for Scene "+busyShotSceneNo,
      detail:"Drafting one opening-keyframe specification per screenplay beat. Existing images and takes are preserved; frame generation is separate."
    } :
    (room==="art" && draftingAllShots) ? {
      role:"Shot Designer",
      title:"Drafting shot specifications",
      detail:"Drafting one opening keyframe per screenplay beat for scenes without shots, in story order. Existing shot lists are kept; no images are generated."
    } :
    (room==="art" && draftingStageId) ? {
      role:"Location Scout",
      title:"Drafting location staging",
      detail:"Turning the location into a practical depth grid for consistent camera blocking."
    } : null;
  // ── Signed-out gate: show the commercial landing page instead of the app. The
  //    departments (spine, Writers' Room, Art Room, Agents) are never exposed until
  //    sign-in. Only when cloud auth is configured; local-only mode runs the app as before.
  const authGate = (typeof cloudConfigured==="function" && cloudConfigured());
  // While the initial session check is in flight, show a minimal splash — never flash the
  // landing at a user who turns out to be signed in.
  /* (hooks: above every early return below) the opening screen's quiet way out (owner 2026-10-03: no Retry button or connection chip on it):
     only when opening takes longer than 20 s does "Try again · Sign out" appear */
  const splashOpen = !!(authGate && session && !currentProjectId);
  const [splashSlow, setSplashSlow] = React.useState(false);
  React.useEffect(()=>{
    if(!splashOpen){ setSplashSlow(false); return; }
    const t = setTimeout(()=>setSplashSlow(true), 20000);
    return ()=>clearTimeout(t);
  },[splashOpen]);
  // the opening spine (owner 2026-10-03): a value wave drawing itself in the hero's two charge
  // colours (amber rising, teal falling) — on both opening screens
  const splashSpine = ()=> React.createElement("svg",{className:"lp-splash-spine",viewBox:"0 0 120 28",width:120,height:28,"aria-hidden":"true"},
    React.createElement("defs",null,
      React.createElement("linearGradient",{id:"lpSplashG",x1:"0",y1:"0",x2:"1",y2:"0"},
        React.createElement("stop",{offset:"0",stopColor:"#F29A43"}),
        React.createElement("stop",{offset:"0.5",stopColor:"#5DB0D8"}),
        React.createElement("stop",{offset:"1",stopColor:"#F29A43"}))),
    React.createElement("path",{className:"lp-splash-track",d:"M2 14 C14 2 26 2 38 14 S62 26 74 14 S98 2 118 14"}),
    React.createElement("path",{className:"lp-splash-wave",d:"M2 14 C14 2 26 2 38 14 S62 26 74 14 S98 2 118 14",stroke:"url(#lpSplashG)"}));
  if(authGate && !authReady){
    return React.createElement("div",{className:"lp-splash",role:"status","aria-live":"polite"},
      React.createElement("span",{className:"lp-logo"},(typeof BrandMark==="function") && React.createElement(BrandMark,null),"Kinolot"),
      splashSpine());
  }
  if(authGate && !session && typeof Landing!=="undefined"){
    return React.createElement(React.Fragment,null,
      window.ConfirmHost && React.createElement(window.ConfirmHost,null),
        React.createElement(Landing,{ onStart:startWithPlan, onSignIn:()=>openAuth("signin") }),
      authOpen && React.createElement(AuthModal,{ initialMode:authMode, plan:intendedPlan, light:true, onPlanChange:changeIntendedPlan,
        onClose:()=>setAuthOpen(false), onAuthed:(s)=>{ if(s) setSession(s); } }),
      (typeof MuseDock!=="undefined") && React.createElement(MuseDock,{
      scenes:[], selScene:null, project:null, signedIn:false, aiOn:false, onSignIn:()=>openAuth("signup") }));
  }
  // A signed-in session without an authoritative cloud project is a lightweight
  // recovery state, not permission to mount the last local workspace. Mounting a
  // large stale Stage/Art Room here can start hundreds of reference loaders and
  // starve the very timers that reconnect it. Keep the main thread quiet until a
  // project lands; the in-memory/local safety copy remains untouched.
  if(authGate && session && !currentProjectId){
    const reconnecting=cloudConnectionState==="retrying";
    const retry=()=>{ bootRef.current=false; bootRetryDelayRef.current=1500;
      setCloudConnectionState("retrying"); setBootRetryTick(t=>t+1); setSplashSlow(false); };
    // OPENING (owner 2026-10-03): the mark, a story spine drawing itself in the hero's two charge
    // colours (amber rising, teal falling), and one line of status — nothing else unless it's slow
    return React.createElement("div",{className:"lp-splash",role:"status","aria-live":"polite"},
      React.createElement("span",{className:"lp-logo"},(typeof BrandMark==="function") && React.createElement(BrandMark,null),"Kinolot"),
      splashSpine(),
      React.createElement("div",{className:"acct-status"},reconnecting
        ? "Reconnecting to your films…"
        : "Opening your films…"),
      splashSlow && React.createElement("div",{className:"lp-splash-slow"},
        "Taking longer than usual \u00b7 ",
        React.createElement("button",{type:"button",className:"lp-splash-link",onClick:retry},"Try again"),
        " \u00b7 ",
        React.createElement("button",{type:"button",className:"lp-splash-link",onClick:signOut},"Sign out")));
  }

  /* New Story has two distinct launch targets while a Show episode is open:
     - blank current Episode: build into it, so the Show-owned format is locked;
     - populated Episode: mint an unrelated project, so format choice stays free.
     Capture that distinction in one value and use it for BOTH the visible intake
     and the launch boundary. Looking only at currentShowId over-constrained the
     second path and could silently seed a second Show with the old Show's format. */
  const newStoryBuildsCurrentEpisode=!!(currentShowId && !scenes.length);
  const newStoryShowRow=newStoryBuildsCurrentEpisode
    ? (projects||[]).find(p=>String(p.id)===String(currentShowId)) : null;
  const newStoryFormatEntry=newStoryBuildsCurrentEpisode
    ? ((window.FORMATS||[]).find(f=>f&&f.id===String(project&&project.format))
      || ((typeof formatOf==="function")?formatOf(project):null))
    : null;
  const newStoryEpisodeFormat=newStoryFormatEntry&&newStoryFormatEntry.id
    ? String(newStoryFormatEntry.id) : (newStoryBuildsCurrentEpisode?"series":undefined);

  return React.createElement("div",{className:`app hs room-${room} vp-${vp} ${densClass} ${premiumClass}`+(roomReadOnly?" is-readonly":"")},
    window.ConfirmHost && React.createElement(window.ConfirmHost,null),
    /* VIEW-ONLY BANNER — say it UP FRONT. RLS rejects this user's writes, so without a
       standing notice they could work for an hour and only discover it from a failed save. */
    readOnlyShare && React.createElement("div",{className:"readonly-banner",role:"status"},
      React.createElement(Icon.eye||Icon.warn,{s:14}),
      React.createElement("span",null,
        React.createElement("b",null,(ownerPlanLapsed || sharingPaused || sharedOffList || stageRolePaused) ? "Read-only for now — " : "View-only access — "),
        ownerPlanLapsed
          ? "this film's owner's plan doesn't include shared work right now, so editing and generating are paused. Nothing is lost: it all comes back when their plan does."
          : sharingPaused ? "team sharing is paused right now, so collaborators can read this film but not change it, and nothing is charged. You can still leave it from the Team window."
          : sharedOffList ? "checking your access to this film. Changes wait until it's confirmed."
          : stageRolePaused ? "your Stage editor role is paused: this film's owner's plan doesn't include the Stage right now. Nothing is lost."
          : "you can navigate, inspect, export and play this film. Editing and AI-write actions are disabled. Only the film's owner can change your role.")),
    unknownSharedRole && React.createElement("div",{className:"readonly-banner",role:"status"},
      React.createElement(Icon.warn||Icon.eye,{s:14}),
      React.createElement("span",null,
        React.createElement("b",null,"Role unavailable — "),
        "We couldn\u2019t verify a current collaborator role for this shared project. It is read-only and changes or AI actions will not save. Ask the film's owner to check your role in the Team window.")),
    // the room your role doesn't cover is read-only — named by your role(s), one or several (2026-10-03)
    !readOnlyShare && !unknownSharedRole && _projRow && _projRow.isShared && room==="writers" && writersRoomReadOnly && React.createElement("div",{className:"readonly-banner",role:"status"},
      React.createElement(Icon.eye||Icon.warn,{s:14}),
      React.createElement("span",null,
        React.createElement("b",null,"Writers' Room is read-only for your role ("+(typeof window.teamRoleLabel==="function" ? window.teamRoleLabel(shareRole) : shareRole)+") — "),
        "you can read the story and script here; the film's owner or a Co-writer changes them.")),
    !readOnlyShare && !unknownSharedRole && _projRow && _projRow.isShared && room==="art" && artRoomReadOnly && React.createElement("div",{className:"readonly-banner",role:"status"},
      React.createElement(Icon.eye||Icon.warn,{s:14}),
      React.createElement("span",null,
        React.createElement("b",null,"Art Room is read-only for your role ("+(typeof window.teamRoleLabel==="function" ? window.teamRoleLabel(shareRole) : shareRole)+") — "),
        "you can look through the shared Bible and pre-production work here; the film's owner or an Art director changes them.")),
    !readOnlyShare && !unknownSharedRole && _projRow && _projRow.isShared && room==="stage" && stageReadOnly && React.createElement("div",{className:"readonly-banner",role:"status"},
      React.createElement(Icon.eye||Icon.warn,{s:14}),
      React.createElement("span",null,
        React.createElement("b",null,"The Stage is read-only for your role ("+(typeof window.teamRoleLabel==="function" ? window.teamRoleLabel(shareRole) : shareRole)+") — "),
        "you can watch the takes and the timeline, and export the film or download a take, here; the film's Stage editor or owner makes changes.")),
    // BILLING NOTICES (2026-09-30): "Payment failed — update your card" while past_due,
    // "Account on hold" while frozen, and the 20% / 5% low-balance notices (app/plans.jsx)
    session && !isAdmin && creditBalance && window.BillingNotices && React.createElement(window.BillingNotices,{ balance:creditBalance }),
    // the post-checkout welcome card (/?welcome=1): live-updates as the webhook's
    // grant streams into the balance; its CTA goes straight to New Story. When the
    // payment link's after-payment URL names the plan (/?welcome=1&plan=director) it
    // stays "activating" until THAT plan lands — an upgrade no longer flashes the old one.
    trialWelcomeOpen && session && !welcomeOpen && window.WelcomeTrialCard && React.createElement(window.WelcomeTrialCard,{
      credits: creditBalance && creditBalance.remaining,
      onNewStory: ()=>{ closeTrialWelcome(); startNewStory(); },
      onClose: closeTrialWelcome }),
    welcomeOpen && session && window.WelcomePlanCard && React.createElement(window.WelcomePlanCard,{
      plan: (creditBalance && creditBalance.plan) || welcomePlan,
      credits: creditBalance && (creditBalance.planRemaining!=null ? creditBalance.planRemaining : creditBalance.remaining),
      activating: !(creditBalance && window.turnIsPaidPlan(creditBalance.plan)
        && (!welcomePlan || String(creditBalance.plan).toLowerCase()===welcomePlan)),
      onNewStory: ()=>{ setWelcomeOpen(false); startNewStory(); },
      onClose: ()=>setWelcomeOpen(false) }),
    creditPackOpen && session && window.WelcomeCreditPackCard && React.createElement(window.WelcomeCreditPackCard,{
      credits: creditBalance && creditBalance.remaining,
      balance: creditBalance,
      activating: !creditBalance,
      onClose: ()=>setCreditPackOpen(false) }),
    // invite acceptance landing (/?invite=<id>): waits for the claim RPC AND the
    // project list, so it can name the film — or say honestly that the invitation
    // is no longer active for this account
    (function(){
      if(!(inviteLanding && session && inviteClaims!==null && (projects||[]).length && window.InviteWelcome)) return null;
      const film = (projects||[]).find(p=>p.id===inviteLanding) || null;
      const claim = (inviteClaims||[]).find(r=>r && r.project_id===inviteLanding) || null;
      const um = (session.user && session.user.user_metadata) || {};
      return React.createElement(window.InviteWelcome,{
        film,
        // invite-created accounts have no claim row (the Edge Function linked them
        // pre-sign-in) — teamInviteInviter falls back to the invite's metadata
        invitedBy: (typeof window.teamInviteInviter==="function")
          ? window.teamInviteInviter(claim, um, film)
          : (claim && claim.invited_by),
        sessionEmail: (typeof cloudUserEmail==="function") ? cloudUserEmail(session) : "",
        canSetPassword: !!(um.turn_invited && !um.turn_password_set),
        onOpen: async ()=>{
          const id=film ? openableFilmId(film.id) : null;
          setInviteLanding(null); setHomeOpen(false);
          if(id) await switchProject(id); else setHomeOpen(true);
        },
        onClose: ()=>setInviteLanding(null) });
    })(),
    // Home = the dashboard, once the user has >=2 films OR any film shared with
    // them (the wall is where a share is explained — owner + role). Below that,
    // opening Home routes straight into the Writers' Room (see onHome).
    homeOpen && cloudMode
      && window.turnHomeWallEligible(projects)
      && typeof window.HomeDashboard!=="undefined"
      && React.createElement(window.HomeDashboard,{
          projects, currentId:currentProjectId, room,
          onOpen: async (id)=>{ setHomeOpen(false); await switchProject(id); },
          // LAZY like everywhere else: "New Project" opens the New Story intake —
          // the film is only minted when a story actually LAUNCHES. The old eager
          // createProject() stranded an Untitled film (and its auto-painted poster)
          // every time someone clicked in and changed their mind.
          onCreate: ()=>{ setHomeOpen(false); setRoom("writers"); setView("spine"); startNewStory(); },
          onGeneratePoster: generatePoster,
          onRegenPoster: (p)=>generatePoster(p, { keepPrev:true }),
          onRestorePoster: restorePoster,
          /* NO BLANK FILM FROM A ROOM BUTTON (2026-10-09, owner — Home review): with no film open, a pipeline step
             created an "Untitled film" (the stranding "New Project" was fixed to avoid). It opens your most recent
             film now, or the New Story window when you have none. */
          onGoRoom: async (rid)=>{
            if(!currentProjectId){
              const recentFilm = (projects||[]).find(p=>p && !p.isShared && !(window.turnSeries && typeof window.turnSeries.isShowDoc==="function" && window.turnSeries.isShowDoc(p))
                && !(typeof window.turnFilmIsBlank==="function" && window.turnFilmIsBlank(p)));
              if(!recentFilm){ setHomeOpen(false); setRoom("writers"); setView("spine"); startNewStory(); return; }
              setHomeOpen(false); await switchProject(recentFilm.id);
            } else setHomeOpen(false);
            if(rid==="writers") setView("spine"); guardedSetRoom(rid); },
          onClose: ()=>setHomeOpen(false),
          accountSlot: React.createElement(AccountChip,{ session, cloudActive:cloudMode, connectionState:cloudConnectionState, saveState, shareRole,roleUnavailable:unknownSharedRole,
            onSignIn:()=>setAuthOpen(true), onSignOut:signOut }),
          // the billing banners, on Home too (Home is a fixed overlay above the studio's own copy)
          noticesSlot: (session && !isAdmin && creditBalance && window.BillingNotices) ? React.createElement(window.BillingNotices,{ balance:creditBalance }) : null,
          notifySlot: teamNotifySlot("home") }),
    t.grain && React.createElement("div",{style:{position:"fixed",inset:0,pointerEvents:"none",zIndex:50,
      opacity:.025,mixBlendMode:"overlay",
      backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"}}),

    // "Reset to sample story" is an ADMIN-ONLY tool (demo upkeep): only the admin
    // account ever sees it — every other user (and signed-out local mode) gets no reset.
    // The Stage gets the same shared TopBar as every other room (brand, project switcher,
    // room switcher, theme toggle, etc.) — only its own sub-view tabs (ViewNav) are skipped,
    // since the Stage is a single full-width assembly view.
    React.createElement(TopBar,{view,setView,room,setRoom:guardedSetRoom,artView,setArtView,project,scenes,drafts,
      artTabLocks,hiddenArtTabs:(typeof tabHidden==="function") ? Object.fromEntries((window.ART_TABS||[]).map(t=>[t.id, tabHidden(project, t.id)])) : null,
      onReset: isAdmin ? resetStory : null,
      onNewStory:startNewStory,
      // Brief modal's "Rebuild as a new film" — the brief is the story's true
      // source, so recovery-by-regeneration runs the SAME Adaptation build into a
      // brand-new film (a fresh telling; the current film is never overwritten).
      onRebuildFromBrief: async ()=>{
        if(!canMutateWritersRoom()) return;
        const brief = String(project.sourceBrief||"").trim();
        if(!brief){ if(window.appToast) window.appToast("This story has no saved brief to rebuild from.","info"); return; }
        if(!planActive()){ requirePlan("rebuild a story"); return; }
        const ok = await window.appConfirm({ title:"Rebuild as a new film?",
          body:"Runs the full story build again from this brief into a BRAND-NEW film \u2014 spine, cast and script freshly generated (a new telling, not a copy; results differ run to run). \u201c"+(project.title||"Untitled")+"\u201d and all its art stay exactly as they are. This spends build credits.",
          confirmLabel:"Build the new film" });
        if(!ok) return;
        // a retired framework (Story Circle) rebuilds as the default: the new film is a new
        // story, and its act-shaped synopsis paragraphs don't carry over to another shape
        const _fwKeep = (typeof window.choosableFrameworkId==="function" && project.framework)
          ? window.choosableFrameworkId(project.framework) : project.framework;
        const _fwSame = _fwKeep===project.framework;
        const keep = { format:project.format, framework:_fwKeep, logline:(project.logline||"").trim(),
          ...(project.research ? { research:JSON.parse(JSON.stringify(project.research)) } : {}),
          ...(project.synopsis && _fwSame ? { synopsis:project.synopsis } : {}) };
        if(cloudMode && typeof createProject==="function"){
          const requestId=typeof window.cloudCreateRequestId==="function"
            ? window.cloudCreateRequestId()
            : (window.crypto&&typeof window.crypto.randomUUID==="function"?window.crypto.randomUUID():"");
          const launchScope={projectId:projIdRef.current,loadSeq:loadSeqRef.current,homeOpen:homeOpenRef.current};
          const createOpts={...(requestId?{requestId}:{}),launchScope};
          let minted=await createProject(undefined,createOpts);
          let committed=!!(minted&&minted.created);
          if(!minted){
            minted=await createProject(undefined,createOpts);
            committed=committed||!!(minted&&minted.created);
          }
          if(minted&&minted.superseded){
            if(typeof window.appToast==="function") window.appToast(
              minted.message||"The new film was created. Your current screen was left unchanged.","info");
            return;
          }
          if(typeof minted!=="string"){
            const why=String(window.cloudLastCreateError||"").trim();
            if(typeof window.appToast==="function") window.appToast(
              (committed?"The new film was saved but couldn\u2019t be opened yet":"Couldn\u2019t create the new film")+
              (why?" \u2014 "+why:"")+". The current film was not rebuilt or replaced.","error");
            return;
          }
        } else { localStoryGenRef.current++; applyDoc(emptyDoc()); setArtView("lookbook"); }
        setRoom("writers"); setView("spine");
        setProject(p=>({ ...p, ...(keep.format?{format:keep.format}:{}), ...(keep.framework?{framework:keep.framework}:{}),
          logline:keep.logline || p.logline, ...(keep.synopsis ? { synopsis:keep.synopsis } : {}),
          ...(keep.research ? { research:keep.research } : {}),
          sourceBrief:brief, sourceBriefAt:new Date().toISOString() }));
        setAgentLaunch({id:"adapt", input:brief}); setAgentsOpen(true);
      },
      onHome: cloudMode ? (()=>{
        // Home opens the dashboard for an established studio (>=2 films) — OR
        // whenever ANY film is shared with this account, so the wall's "Shared
        // with me" section is always reachable (someone whose only film is a
        // share must not be locked out of the one place that explains it).
        // A 0/1-owned-film studio with no shares lands in the Writers' Room.
        (async()=>{
          if(window.turnHomeWallEligible(projects)){
            // already eligible on the in-memory list: open instantly, refresh
            // behind the wall (same list reload the Team panel's onChanged uses)
            setHomeOpen(true);
            if(typeof cloudListProjects==="function"){ const list = await cloudListProjects(); if(list) setProjects(list); }
            return;
          }
          // the STALE list says "no wall" — but a share may have been granted
          // since the last load, so re-fetch BEFORE routing away; the freshly
          // returned list makes the decision (a fetch failure keeps the old one)
          let rows = projects;
          if(typeof cloudListProjects==="function"){ const list = await cloudListProjects(); if(list){ setProjects(list); rows = list; } }
          if(window.turnHomeWallEligible(rows)){ setHomeOpen(true); return; }
          if(!currentProjectId){ await createProject(); }
          setHomeOpen(false); setView("spine"); guardedSetRoom("writers");
        })();
      }) : null,
      // ADMIN ONLY: inspect the whole continuity JSON (the Film Bible) the studio reads from
      onViewBible: isAdmin ? (()=> buildFilmBible({ project, scenes, characters, props, locations, shots, drafts, beatsMap, lookbook, lookbookNote })) : null,
      onManageStyles: (userEmail || null),   // every signed-in user manages their own styles (admin also gets the global tier inside)
      // a film "has a render style" once the look is established — a colorist style bible,
      // or any character/prop/location carrying a picked renderStyleKey. Gates the Styles
      // button in the Writers' Room (nothing to manage before a style exists).
      hasFilmStyle: !!(
        (project && project.styleBible && project.styleBible.sceneStyles && Object.keys(project.styleBible.sceneStyles).length) ||
        (characters||[]).some(c=>c && c.renderStyleKey) ||
        (props||[]).some(p=>p && p.renderStyleKey) ||
        (locations||[]).some(l=>l && l.renderStyleKey)
      ),
      theme,onTheme:setTheme,
      authSlot: React.createElement(AccountChip,{ session, cloudActive: cloudMode, connectionState:cloudConnectionState, saveState, shareRole,roleUnavailable:unknownSharedRole,
        onSignIn:()=>setAuthOpen(true), onSignOut:signOut }),
      projectSlot: cloudMode ? React.createElement(ProjectSwitcher,{ projects, currentId:currentProjectId,
        // no format / framework badge on a blank canvas: nothing has been chosen yet
        formatLabel:(typeof formatOf==="function" && !currentFilmBlank) ? formatOf(project).label : null,
        // the structure shows on EVERY film beside its format, Three-Act too (owner 2026-10-16: one rule for all films)
        frameworkLabel:(typeof frameworkOf==="function" && !currentFilmBlank) ? frameworkOf(project).badge : null,
        onSwitch:switchProject, onCreate:createProject, onRename:renameProject, onDelete:deleteProject,
        // the switcher's "New Story" opens the New Story window (like Home's New Project) — the film is
        // created when a story launches, so no blank "Untitled film" rows pile up
        onNewStory:()=>{ setRoom("writers"); setView("spine"); startNewStory(); },
        onNewEpisode:createEpisode, onMakeShow:makeShow, onDeleteShow:deleteShow, seriesBusy,
        canMakeShow: !currentShowId && scenes.length>0 && !(((projects||[]).find(p=>p.id===currentProjectId)||{}).isShared) }) : null,
      notifySlot: teamNotifySlot("studio"),
      presenceSlot: (cloudMode && window.PresenceDots)
        ? React.createElement(window.PresenceDots,{ people:presence }) : null,
      teamSlot: cloudMode && window.TeamButton ? React.createElement(window.TeamButton,{
        // A series is shared once at Show scope. The database migration makes
        // that role apply to every existing and future episode.
        // TEAM (relaunched 2026-10-03): open for everyone while the switch is on; switched off,
        // the button shows a "Soon" chip that opens nothing (team.jsx) — except for the admin.
        isAdmin, sharing:teamSharing,
        projectId:currentShowId||currentProjectId,
        projectTitle:((projects||[]).find(p=>p.id===(currentShowId||currentProjectId))||{}).title || project.title,
        projectMeta:(projects||[]).find(p=>p.id===(currentShowId||currentProjectId)) || null,
        series:!!currentShowId,
        onChanged:async (what)=>{
          // you left the film: a clean reboot lands on your own films (as "Access ended" does)
          if(what && what.left){ setTimeout(()=>{ try{ window.location.reload(); }catch(e){} }, 900); return; }
          if(typeof cloudListProjects==="function"){
            const list = await cloudListProjects();
            if(list) setProjects(list);
          }
        }
      }) : null,
      roomEntitlements: currentRoomEntitlements(),
      railOpen,inspOpen,
      onToggleRail:toggleRail,
      onToggleInsp:toggleInsp}),

    // the room's view tabs, moved out of the top bar to a full-width bar beneath it
    // the Writers' Room's page heading (homepage style, 2026-10-16): eyebrow, the view's title, the
    // film's size, the Spine / Board / Script tabs, Draft scene and Story Editors
    room==="writers" && React.createElement(WritersHeader,{view,setView,project,scenes,runtimeTotal,
      sub: view==="spine" ? "The emotional charge of every scene, end to end"
        : view==="script" ? scriptSubtitle()
        : (boardMode==="table" ? "Every scene's turn in one table — "+((((typeof fwAuditOf==="function")&&fwAuditOf().subline)||"If a scene doesn't turn, cut it"))
          : "Every scene, grouped by act"),
      scene: scenes.length ? sel : null, sceneDrafted: !!(sel && drafts[sel.id]), drafting: !!drafting,
      onDraftScene: ()=>{ if(!sel) return;
        if(drafts[sel.id]){ setView("script"); return; }
        if(!canMutateWritersRoom()) return;
        setView("script"); draftOne(sel); },
      readOnly:writersRoomBlocked,
      railOpen,inspOpen,onToggleRail:toggleRail,onToggleInsp:toggleInsp,
      onAgents:async ()=>{ if(!canMutateWritersRoom()) return; if(await requireStory("Story Editors")) setAgentsOpen(true); }}),
    room==="art" && React.createElement(ViewNav,{room,view,setView,artView,setArtView,staleTabs,
      attnTabs:{ characters: wardrobeAttn },tabLocks:artTabLocks,
      readOnly:roomReadOnly,
      hiddenTabs:(typeof tabHidden==="function") ? Object.fromEntries((window.ART_TABS||[]).map(t=>[t.id, tabHidden(project, t.id)])) : null,
      railOpen,inspOpen,onToggleRail:toggleRail,onToggleInsp:toggleInsp,
      onCoordinate:async ()=>{
        if(artRoomReadOnlyRef.current){ _mutationNotice("art"); return; }
        if(turnCastDraftingBlocksAgent(draftingAllVisualsRef.current, "Run pre-production")) return;
        if(await requireStory("Art Coordinator")) setCoordConfirm(true); },
      onProductionCheck:async ()=>{ if(productionCheckBlocked) return; if(await requireStory("The Production check")) setProductionOpen(true); },
      productionReadOnly:productionCheckBlocked,
      onAgents:async ()=>{ if(!canMutateWritersRoom()) return; if(await requireStory("Story Editors")) setAgentsOpen(true); }}),

    authOpen && React.createElement(AuthModal,{ initialMode:authMode, plan:intendedPlan, onPlanChange:changeIntendedPlan,
      onClose:()=>setAuthOpen(false),
      onAuthed:(s)=>{ if(s) setSession(s); }}),

    React.createElement("div",{className:"body"},
      room==="stage"
        ? (scenes.length===0
          ? React.createElement("div",{className:"canvas"}, emptyCanvas())
            : React.createElement(window.StageView,{key:(cloudMode?currentProjectId:"local"),
                project,scenes,shots,characters,locations,props,beatsMap,drafts,
                creditBalance,
                readOnly:roomReadOnly,
                // voicing is paid and writes the shots: never from a view-only Stage (2026-10-09)
                onVoiceLine:roomReadOnly?null:voiceLine,
                onMakeSceneNeeds:artRoomReadOnly?null:makeSceneNeeds,   // it makes Art Room images (2026-10-09)
                onUpdateShot:updateShot,
                // the Stage's model, clip scope and visual source belong to the FILM (2026-10-02)
                onStageSettings:(patch)=>{ if(!canMutateSharedFilm()) return;
                  setProject(p=>({ ...p, stage:{ ...((p&&p.stage)||{}), ...patch } })); },
                onStageNav:(tab, sceneId)=>{
                  // the Stage's own tabs open in the Stage (2026-10-09 — "timeline" used to leave for the
                  // Writers' Room script, and "audio" / "versions" didn't switch the tab)
                  const stageTab = { timeline:"timeline", audio:"audio", versions:"versions", shoot:"stage" }[tab];
                  if(stageTab){ guardedSetRoom("stage");
                    setTimeout(()=>{ try{ window.dispatchEvent(new CustomEvent("turn-stage-view",{ detail:{ view:stageTab } })); }catch(e){} }, 0); return; }
                  // a scene hand-off opens Shots on it (the Breakdown's turnFocusArtScene)
                  if(tab==="shots"){ if(!guardedSetRoom("art")) return;
                    if(sceneId && typeof window.turnFocusArtScene==="function") window.turnFocusArtScene("shots", sceneId);
                    setArtView("shots"); return; }
                  if(tab==="assets"){ if(guardedSetRoom("art")) setArtView("lookbook"); return; }
                  guardedSetRoom("stage");
                }}))
      : room==="art"
        ? (scenes.length===0
          // hard gate: the Art Room is downstream of the story, so with no scenes
          // show the onboarding instead of empty (and partly broken) tabs.
          ? React.createElement("div",{className:"canvas"}, emptyCanvas())
          : React.createElement(ArtRoom,{key:(cloudMode?currentProjectId:"local"),artView,setArtView,project,projectLoading,characters,scenes,props,drafts,trash,
            readOnly:roomReadOnly,canReview:!roomReadOnly,onSourceClick:openArtSource,tabLocks:artTabLocks,
            noPropsConfirmed:!!(project && project.noPropsConfirmed),onSetNoProps:roomReadOnly?null:setNoPropsConfirmed,
            onRestoreChar:restoreCharacter,onPurgeChar:purgeCharacter,onRestoreProp:restoreProp,onPurgeProp:purgeProp,
            onRestoreLoc:restoreLocation,onPurgeLoc:purgeLocation,onRestoreShot:restoreShot,onPurgeShot:purgeShot,onEnsureOwner:ensureOwnerSheet,
            onColorist:(refs, opts)=>{ if(!canMutateSharedFilm()) return; if(typeof refs==="string") setStyleRefs(refs.trim());
              coloristRedoManualRef.current = !!(opts && opts.redoManual); setColoristOpen(true); },
            // "Design the cast" opens its preview first (what it makes + the price, 2026-10-03)
            // a role that can't change the Art Room is told, and nothing opens (2026-10-09)
            onCast:(opts)=>{ if(artRoomReadOnlyRef.current){ _mutationNotice("art"); return; } if(!turnCastDraftingBlocksAgent(draftingAllVisualsRef.current, "Design the cast")) setCastConfirm(opts||{}); },
            onResearch:()=>{ if(artRoomReadOnlyRef.current){ _mutationNotice("art"); return; } setResearchOpen(true); },
            onResearchFresh:roomReadOnly ? null : researchLookbookFresh,
            lookbook,lookbookNote,onUpdateLookbook:updateLookbookCard,onAddLookbook:addLookbookCard,
            onDeleteLookbook:deleteLookbookCard,onSetLookbookNote:setLookbookNote,
            onRestoreLookbook:restoreLookbookCard,onPurgeLookbook:purgeLookbookCard,
            onSuggestLookbookNote:roomReadOnly ? null : suggestLookbookNote,suggestingLookbookId,
            staleTabs,onApplyLookbook:applyLookbook,onReviewLookbook:(dept)=>applyLookbook(dept,"review"),
            onUpdateChar:updateCharacter,onDraftVisuals:draftCharacterVisuals,onDraftAllVisuals:draftAllVisuals,
            // "Read the script" on the Characters tab (every character) and on a card (2026-10-12, Character fidelity)
            onReadCharacterScript:(ids)=>{ if(artRoomReadOnlyRef.current){ _mutationNotice("art"); return; }
              readCharacterFacts(Array.isArray(ids) ? (characters||[]).filter(c=>c && ids.indexOf(c.id)>=0) : (characters||[])); },
            readingFactIds,
            draftingVisualId,draftingAllVisuals,draftingVisualIds,onDeleteCharacter:deleteCharacter,
            onSuggestStates:suggestCharacterStates,suggestingStatesId,onRemoveOwnedItem:removeOwnedProp,
            onBuildWornProps:(c)=>{ if(c && wornBuildRef.current) wornBuildRef.current(c.id); },onRenameOwnedItem:renameOwnedProp,
            onUpdateProp:updateProp,onDraftProp:draftPropVisuals,onDraftAllProps:draftAllProps,onCreateOwnedProp:createOwnedProp,
            onAddProp:addProp,onImportProps:importScreenplayProps,onDeleteProp:deleteProp,draftingPropId,draftingPropIds,draftingAllProps,onMergeProps:mergeProps,
            castHasProps:(typeof castHasProps==="function" && castHasProps(characters)),
            locations,onUpdateLocation:updateLocation,onDraftLocation:draftLocationVisuals,onDraftAllLocs:draftAllLocations,
            onDeleteLocation:deleteLocation,draftingLocIds,draftingAllLocs,
            onMergeLocations:mergeLocations,onLocationPlaceDecision:decideLocationPlace,
            scriptHasLocs:(typeof scriptHasLocations==="function" && scriptHasLocations(scenes)),
            sluglineUnits,onUpdateUnit:updateSlugUnitOverlay,onRemoveUnit:removeSlugUnitOverlay,
            onSetStyleRefs:setStyleRefs,onSetScenePreset:setScenePreset,onSetFilmStock:setFilmStock,
            colorRefsOwned:!!(typeof colorRefsFor==="function" && colorRefsFor((project&&project.styleBible)||{}, lookbook, lookbookNote).owned),
            onUseLookbookColorRefs:useLookbookColorRefs,onKeepColorRefs:keepOwnColorRefs,
            onUpdatePreset:updateStylePreset,onDeletePreset:deleteStylePreset,
            onAddStyleRefImages:addStyleRefImages,onRemoveStyleRefImage:removeStyleRefImage,
            onDraftStaging:draftLocationStaging,draftingStageId,
            shots,beatsMap,onUpdateShot:updateShot,onAddShot:addShot,onDeleteShot:deleteShot,onSplitBeat:splitBeatCoverage,splittingBeat,
            onRefineBeat:refineBeatFromScreenplay,refiningBeat,onRemoveMicroBeatShots:removeMicroBeatShots,onMakeSceneNeeds:makeSceneNeeds,
            onOpenStage:()=>guardedSetRoom("stage"), wardrobeIds,
            onDeleteShotReference:deleteShotReference,
            onDraftSceneShots:draftSceneShots,draftingSceneShots,onDraftAllShots:draftAllShots,draftingAllShots}))
        : React.createElement(React.Fragment,null,
      // scrim behind any open overlay drawer
      ((railDrawer&&railOpen)||(inspDrawer&&inspOpen)) && React.createElement("div",{className:"scrim",
        onClick:()=>{ setRailOpen(false); setInspOpen(false); }}),

      scenes.length>0 && (railDrawer
        ? (railOpen && React.createElement(LeftRail,{project,characters,scenes,selChar,
            onSelectChar:(id)=>{ setSelChar(id); setInspOpen(true); setRailOpen(false); },
            onContract:updateContract,onGenre:updateGenre,onProject:updateProjectFields,
            onCollapse:()=>setRailOpen(false),compact:!wide,readOnly:writersRoomBlocked}))
        : (railOpen
          ? React.createElement(LeftRail,{project,characters,scenes,selChar,
              onSelectChar:(id)=>{ setSelChar(id); openInsp(); },
              onContract:updateContract,onGenre:updateGenre,onProject:updateProjectFields,
              onCollapse:()=>setRailOpen(false),compact:!wide,readOnly:writersRoomBlocked})
          : React.createElement(CollapsedStrip,{side:"left",label:"Story",icon:Icon.panelLeft,
              onExpand:openRail,flagCount:scenes.filter(s=>turnInfo(s).flagged).length}))),

      React.createElement("div",{className:"canvas"},
        // the view's tools row (the title moved to the page heading, WritersHeader): the spine's Follow
        // chips and legend, the board's Columns / Table switch with its count. The script has its own toolbar.
        view!=="script" && scenes.length>0 && React.createElement("div",{className:"canvas-head canvas-tools"},
          view==="spine" && characters.length>0 && React.createElement(FollowStrip,{
            characters,scenes,beatsMap,followId:followChar,onFollow:setFollowChar}),
          view==="board" && React.createElement("div",{className:"canvas-sub"},
            (()=>{ const nActs = new Set(scenes.map(s=>s.act)).size;
              return scenes.length+" scene"+(scenes.length!==1?"s":"")+" across "+nActs+" act"+(nActs!==1?"s":""); })()),
          view==="board" && React.createElement("div",{className:"board-mode",role:"group","aria-label":"Board layout"},
            [["columns","Columns"],["table","Table"]].map(([m,lab])=>React.createElement("button",{key:m,type:"button",
              className:"board-mode-btn"+(boardMode===m?" on":""),"aria-pressed":boardMode===m,onClick:()=>setBoardMode(m),
              title:m==="table"?"Every scene's turn in one table (the former Audit)":"Scenes grouped by act"},lab))),
          view==="spine" && React.createElement("div",{className:"legend"},
            runtimeTotal>0 && React.createElement("div",{className:"legend-item",
              title:"Estimated total runtime, ≈1 page/min (drafted scenes from their script; undrafted ones at this format’s budget per scene)"+
                (sceneBudget ? " — this "+sceneBudget.label+" is meant to run about "+sceneBudget.runtimeText : "")},
              React.createElement(Icon.clock,{s:12}),
              "≈ "+((typeof fmtRuntime==="function") ? fmtRuntime(runtimeTotal) : Math.round(runtimeTotal/60)+" min")),
            React.createElement("div",{className:"legend-item"},
              React.createElement("span",{className:"legend-swatch",style:{background:"var(--pos)"}}),"Positive"),
            React.createElement("div",{className:"legend-item"},
              React.createElement("span",{className:"legend-swatch",style:{background:"var(--neg)"}}),"Negative"),
            React.createElement("div",{className:"legend-item",title:"Intensifies on the same side instead of reversing"},
              React.createElement("span",{className:"legend-swatch",style:{background:"var(--prog)"}}),"Progresses"),
            React.createElement("div",{className:"legend-item"},
              React.createElement("span",{className:"legend-swatch",style:{background:"var(--alert)"}}),"No turn"))),

        view==="spine" && scenes.length>0 && React.createElement(DragScroll,{className:"canvas-scroll spine-pan"},
          React.createElement(SpineCanvas,{scenes,selId,onSelect:selectSceneDetail,staleIds:new Set(Object.keys(staleMap)),
            onReorder:reorderScenes,onAddScene:addScene,runtimes:runtimeMap,readOnly:writersRoomBlocked,
            follow:(()=>{ if(!followChar) return null;
              const c = characters.find(x=>x.id===followChar); if(!c) return null;
              const tl = characterThroughline(c, scenes, beatsMap);
              return { char:c, color:charSolidColor(c), drivenIds:new Set(tl.driven.map(s=>s.id)),
                involvedIds:tl.involvedIds, turnIds:tl.turnIds }; })()})),
        view==="spine" && scenes.length>0 && React.createElement("div",{className:"scroll-fade"}),
        // clean-canvas onboarding: a new/empty project has no scenes yet (shown for
        // ANY view so the data-assuming spine/audit/board/script never render empty).
        scenes.length===0 && emptyCanvas(),
        view==="board" && boardMode==="table" && scenes.length>0 && React.createElement(TurnAudit,{scenes,selId,onSelect:selectSceneDetail}),
        view==="board" && boardMode!=="table" && scenes.length>0 && React.createElement(Board,{scenes,selId,onSelect:selectSceneDetail}),
        view==="script" && scenes.length>0 && React.createElement(ScriptView,{scene:sel,beats,
          drafts, scenes, onSelectScene:selectSceneBrowse, onPolish:polishScene,
          onDraftOne:draftOne, onDraftAll:draftAll, drafting, total:scenes.length,
          history: sel ? (history[sel.id]||{back:[],fwd:[]}) : {back:[],fwd:[]},
          labelOf, onRevert:revertVersion, onRedo:redoVersion, onEditScene:commitVersion, continuityMap, project,readOnly:writersRoomBlocked,
          facts:storyFacts, ledgerInfo, ledgerStale, ledgerBusy, onBuildLedger:buildContinuityLedger,
          staleChanges: sel ? staleMap[sel.id] : null, staleCount:Object.keys(staleMap).length,
          onRedraftStale:(scn)=>redraftScene(scn, beatsMap[scn.id]), onKeepDraft:keepDraft,
          onRedraftAll:redraftAllStale, redraftingAll, redraftBusy:polishBusy,
          // "Write this beat" lands in the scene's LATEST script and only in the film it was
          // asked for (2026-09-28): the app's live drafts and film key, read after the await
          getDraft:(id)=>draftsRef.current[id], filmKey:castDraftFilmKey,
          // click a beat in the Script gutter → reveal it in the Inspector's Beats tab
          onBeatFocus:(n)=>{ setSelChar(null); setInspTab("beats"); setFocusBeat(n);
            if(!inspDrawer) openInsp(); }}),

        // Floating Writers' Room (Agents) launcher — the agents refine an existing
        // story, so it only appears once a story exists (scenes > 0).
        ),

      scenes.length>0 && (()=>{
        const charObj = selChar ? characters.find(c=>c.id===selChar) : null;
        const inspectorEl = charObj
          ? React.createElement(CharacterPanel,{character:charObj, scenes, drafts, cast:characters,
              onUpdate:updateCharacter, onDraft:draftCharacter, drafting:charDrafting===charObj.id,readOnly:writersRoomBlocked || !characterBibleWritableRef.current,
              onJumpScene:(id)=>selectScene(id), onClose:()=>setSelChar(null),
              onCollapse:()=>setInspOpen(false),
              onFollow:(id)=>{ setFollowChar(id); setView("spine");
                if(inspDrawer) setInspOpen(false); }})
          : React.createElement(Inspector,{scene:sel,beats,draft:(sel?drafts[sel.id]:null),onCharge,onUpdate:updateScene,characters,scenes,
              onAddScene:addScene,onDeleteScene:deleteScene,onMove:moveScene,onBeats:setBeatsFor,
              stale: sel ? staleMap[sel.id] : null, onRedraft:(scn)=>redraftScene(scn, beatsMap[scn.id]),
              unnamedValues:unnamedValueCount, onNameAllValues:nameAllValues, namingValues,
              sceneIndex:scenes.findIndex(s=>s.id===selId),sceneCount:scenes.length,
              onCollapse:()=>setInspOpen(false),project,
              tab:inspTab,onTab:setInspTab,focusBeat,readOnly:writersRoomBlocked});
        return inspDrawer
          ? (inspOpen && inspectorEl)
          : (inspOpen
            ? inspectorEl
            : React.createElement(CollapsedStrip,{side:"right",label:"Inspector",icon:Icon.panelRight,
                onExpand:openInsp}));
      })())),

    // Agents — Writers' Room modal
    agentsOpen && !writersRoomBlocked && React.createElement(AgentsPanel,{
      onClose:()=>{ setAgentsOpen(false); setAgentLaunch(null); },
      onView:(v)=>{ setRoom("writers"); if(v==="beats"){ setView("board"); setBoardMode("table"); } else setView(v||"spine"); setAgentsOpen(false); setAgentLaunch(null); },
      ctxFactory:agentCtxFactory,
      initialAgentId: agentLaunch && agentLaunch.id,
      initialInput: agentLaunch && agentLaunch.input,
      autoStart: !!agentLaunch,
      undoCount:agentUndoHere.length,
      undoLabel:agentUndoHere.length?agentUndoHere[agentUndoHere.length-1].label:null,
      onUndo:undoLastAgent,
      // Finish incomplete scenes, including a real screenplay whose beat map is missing.
      ...(()=>{ const standIn = (d)=> typeof window.isStandInDraft==="function" ? window.isStandInDraft(d) : false;
        let n = 0, st = 0, bm = 0;
        scenes.forEach(s=>{ const d = drafts[s.id];
          if(!(d && (d.blocks||[]).length)) n++; else if(standIn(d)){ n++; st++; }
          else if(!(beatsMap[s.id] && (beatsMap[s.id].rows||[]).length)){ n++; bm++; } });
        return { unwritten:n, unwrittenStandIns:st, unwrittenBeatMaps:bm, finishInput:String((project && (project.sourceBrief || project.logline)) || "") }; })(),
      issues:agentIssues,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),


    // Cinematographer / Colorist — gated agent (proposes the colour system for approval);
    // its idle screen shows the current visual references so you can add taste before it runs.
    coloristOpen && !artRoomReadOnly && React.createElement(AgentsPanel,{
      initialAgentId:"colorist", single:true, viewLabel:"View Color",
      ctxFactory:artAgentCtxFactory,
      // the "redo hand-picked scenes" choice belongs to this one run (Run pre-production keeps them)
      onClose:()=>{ coloristRedoManualRef.current = false; setColoristOpen(false); },
      onView:()=>{ coloristRedoManualRef.current = false; setArtView("stylebible"); setColoristOpen(false); },
      issues:{}, ...artUndoProps,
      aiOn: (typeof aiAvailable==="function" && aiAvailable()),
      introExtra: (()=>{ const sb=(typeof styleBibleOf==="function")?styleBibleOf(project):{};
        // what the run will READ (colorRefsFor — the Lookbook's notes when the field is empty), and what it costs
        const refs=String(colorRefsFor(sb, lookbook, lookbookNote).refs||"").trim(); const imgs=sb.refImages||[];
        const viewN = imgs.filter(r=>r && r.view).length;
        const cost = React.createElement("div",{className:"ag-intro-note ag-coloref-cost"}, React.createElement(Icon.sparkles,{s:12}),
          "Cost: one writing call"+(viewN ? ", which looks at your "+viewN+" reference still"+(viewN!==1?"s":"")+" (a vision call \u2014 a little more)" : "")
          +", spent when you press Run. Nothing is applied until you approve it.");
        if(!refs && !imgs.length) return React.createElement(React.Fragment,null, React.createElement("div",{className:"ag-coloref empty"},
          React.createElement(Icon.image,{s:14}), "No visual references yet \u2014 research the look in the Lookbook tab, or add films, photographers or reference stills on the Color tab's Visual references bar, to steer the palette."), cost);
        return React.createElement(React.Fragment,null, cost, React.createElement("div",{className:"ag-coloref"},
          React.createElement("div",{className:"ag-coloref-lab"}, React.createElement(Icon.sparkles,{s:12}), "Designing from your references"),
          refs && React.createElement("div",{className:"ag-coloref-txt"}, refs),
          imgs.length>0 && React.createElement("div",{className:"ag-coloref-imgs"},
            imgs.map(ri=> React.createElement("div",{key:ri.id,className:"ag-coloref-img"},
              React.createElement("img",{src:ri.thumb,alt:""}),
              React.createElement("div",{className:"ag-coloref-sw",role:"img","aria-label":"Sampled colours: "+(ri.colors||[]).slice(0,5).join(", ")},
                (ri.colors||[]).slice(0,5).map((c,i)=>React.createElement("span",{key:i,title:c,style:{background:c}})))))))); })()}),

    // Shot Designer — gated coverage agent (proposes per-scene coverage for approval),
    // launched from the Shot List header; hands off rendering to "Generate all shots".
    shotDesignerOpen && !artRoomReadOnly && React.createElement(AgentsPanel,{
      initialAgentId:"shotdesigner", autoStart:true, single:true, viewLabel:"View Shots",
      ctxFactory:artAgentCtxFactory,
      onClose:()=>setShotDesignerOpen(false),
      onView:()=>{ setArtView("shots"); setShotDesignerOpen(false); },
      issues:{}, ...artUndoProps,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Production check — the 1st-AD pass (script read → cast sheets, then every Art Room
    // layer held to the script), launched from the Art Room view bar. Gated per card; the
    // ctx knows which areas this role can save.
    productionOpen && !productionCheckBlocked && React.createElement(AgentsPanel,{
      initialAgentId:"production", single:true,
      ctxFactory:(args)=>agentCtxFactory({ ...args, scope:"production" }),
      onClose:()=>setProductionOpen(false),
      // its Art Room changes (cast sheets, props, locations) can be undone like any Department Head's (2026-10-09)
      issues:{}, ...artUndoProps,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Casting Director — autonomous cast-design agent, launched from the Characters header.
    castingOpen && !artRoomReadOnly && React.createElement(AgentsPanel,{
      initialAgentId:"casting", autoStart:true, single:true, viewLabel:"View Characters", force:castingForce,
      // from Design the cast's preview the run starts at once (its button was the go-ahead)
      runOnOpen: !!(castingForce && typeof castingForce==="object"),
      ctxFactory:artAgentCtxFactory,
      onClose:()=>{ setCastingOpen(false); setCastingForce(false); },
      onView:()=>{ setArtView("characters"); setCastingOpen(false); setCastingForce(false); },
      issues:{}, ...artUndoProps,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),


    // Props Master — autonomous props agent (proposals → draft → generate), launched from
    // the Props header; in Run pre-production it runs after the cast, so each worn or
    // owned prop can reference its owner's sheet (then the Wardrobe step re-renders them).
    propsMasterOpen && !artRoomReadOnly && React.createElement(AgentsPanel,{
      initialAgentId:"propsmaster", autoStart:true, single:true, viewLabel:"View Props", force:propsMasterForce,
      ctxFactory:artAgentCtxFactory,
      onClose:()=>{ setPropsMasterOpen(false); setPropsMasterForce(false); },
      onView:()=>{ setArtView("props"); setPropsMasterOpen(false); setPropsMasterForce(false); },
      issues:{}, ...artUndoProps,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Production Designer / Location Scout — autonomous locations agent (pull → spec → staging
    // → variants → generate, + coverage check), launched from the Locations header.
    locScoutOpen && !artRoomReadOnly && React.createElement(AgentsPanel,{
      initialAgentId:"locscout", autoStart:true, single:true, viewLabel:"View Locations", force:locScoutForce,
      ctxFactory:artAgentCtxFactory,
      onClose:()=>{ setLocScoutOpen(false); setLocScoutForce(false); },
      onView:()=>{ setArtView("locations"); setLocScoutOpen(false); setLocScoutForce(false); },
      issues:{}, ...artUndoProps,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Visual Researcher — autonomous lookbook agent (research the look + render mood frames),
    // launched from the Lookbook header. Writes references through to the Colorist (Presets).
    researchOpen && !artRoomReadOnly && React.createElement(AgentsPanel,{
      initialAgentId:"researcher", autoStart:true, single:true, viewLabel:"View Lookbook",
      ctxFactory:artAgentCtxFactory,
      onClose:()=>setResearchOpen(false),
      onView:()=>{ setArtView("lookbook"); setResearchOpen(false); },
      issues:{}, ...artUndoProps,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Art Coordinator (id "coordinator") — the meta-agent that runs the pre-production pipeline in
    // dependency order (lookbook → cast → props → wardrobe → locations → colour → shot
    // coverage), launched from the Art Room's "Run pre-production" button in the view bar.
    // It renders no shot frames and composes no storyboard — those stay in their tabs.
    // #2 — cost/scope preview before the Coordinator spends. It names the writing model, and
    // its Run button starts the run (the panel opens running — no second Run press).
    castConfirm && window.CastConfirm && React.createElement(window.CastConfirm,{
      characters, props, scenes, drafts, sceneId:castConfirm.sceneId, sceneNo:castConfirm.sceneNo, sceneIds:castConfirm.sceneIds,
      // the preview's one-click pronoun fix (2026-10-10): the same patch the card's Pronouns selector writes
      onSetPronouns:(id,p)=>updateCharacter(id,{ pronouns:p, pronounProvenance:"user",
        identityProvenance:{ ...(((characters||[]).find(x=>x && x.id===id)||{}).identityProvenance||{}), pronouns:"user" } }),
      onCancel:()=>setCastConfirm(null),
      onConfirm:(scope)=>{ setCastConfirm(null);
        if(artRoomReadOnlyRef.current){ _mutationNotice("art"); return; }
        if(turnCastDraftingBlocksAgent(draftingAllVisualsRef.current, "Design the cast")) return;
        setCastingForce({ only:(scope&&scope.only)||null, variants:!(scope && scope.variants===false), fidelity:!!(scope && scope.fidelity) });
        setCastingOpen(true); }}),
    coordConfirm && window.CoordConfirm && React.createElement(window.CoordConfirm,{
      project, characters, props, locations, shots, scenes, drafts, wardrobeCount,
      onCancel:()=>setCoordConfirm(false),
      onConfirm:()=>{ setCoordConfirm(false);
        if(artRoomReadOnlyRef.current){ _mutationNotice("art"); return; }
        if(turnCastDraftingBlocksAgent(draftingAllVisualsRef.current, "Run pre-production")) return;
        setCoordOpen(true); }}),
    coordOpen && !artRoomReadOnly && React.createElement(AgentsPanel,{
      initialAgentId:"coordinator", autoStart:true, runOnOpen:true, single:true, viewLabel:"View Shots",
      ctxFactory:artAgentCtxFactory,
      onClose:()=>setCoordOpen(false),
      onView:()=>{ setArtView("shots"); setCoordOpen(false); },
      issues:{}, ...artUndoProps,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),


    // New Story intake — many seed types in, one logline out, then launch Adaptation
    newStoryOpen && React.createElement(NewStoryIntake,{
      onClose:()=>setNewStoryOpen(false),
      aiOn: (typeof aiAvailable==="function" && aiAvailable()),
      initialFormat:newStoryBuildsCurrentEpisode?newStoryEpisodeFormat:undefined,
      formatLocked:newStoryBuildsCurrentEpisode,
      formatOwnerLabel:(newStoryShowRow&&newStoryShowRow.title)||"this Show",
      onLaunch:async (logline, synopsis, formatId, frameworkId)=>{
        if(!canMutateWritersRoom()) return;
        // HARD GATE: building a story runs the paid engine. Every intake path funnels
        // through onLaunch, so this is the real enforcement point — a no-plan account is
        // stopped here and sent to the plans modal, instead of consuming a build and
        // hitting a cryptic provider-funds error (CM-11) part-way through.
        if(!planActive()){ setNewStoryOpen(false); requirePlan("build a story"); return; }
        setNewStoryOpen(false);
        // LAZY film creation: the blank film is minted only NOW that a story is really
        // being built — and only when the current film already holds one (an empty
        // canvas is reused instead of duplicated). Aborted intakes create nothing.
        if(scenes.length){
          if(cloudMode && typeof createProject==="function"){
            // HARD STOP on a failed mint: without this, a network blip here would
            // silently aim the build at the OPEN film — surfacing a destructive
            // "Replace project" card where the user expected a fresh "Create".
            // One automatic retry absorbs transient blips; a second failure
            // surfaces the REAL reason (expired session, server error, network).
            const requestId=typeof window.cloudCreateRequestId==="function"
              ? window.cloudCreateRequestId()
              : (window.crypto&&typeof window.crypto.randomUUID==="function"?window.crypto.randomUUID():"");
            const launchScope={projectId:projIdRef.current,loadSeq:loadSeqRef.current,homeOpen:homeOpenRef.current};
            const createOpts={...(requestId?{requestId}:{}),launchScope};
            let minted = await createProject(undefined,createOpts);
            let committed=!!(minted&&minted.created);
            if(!minted){
              minted = await createProject(undefined,createOpts);
              committed=committed||!!(minted&&minted.created);
            }
            if(minted&&minted.superseded){
              if(typeof window.appToast==="function") window.appToast(
                minted.message||"The new film was created. Your current screen was left unchanged.","info");
              return;
            }
            if(typeof minted!=="string"){
              const why = String(window.cloudLastCreateError||"").trim();
              if(typeof window.appToast==="function")
                window.appToast((committed?"The new film was saved but couldn\u2019t be opened yet":"Couldn\u2019t create the new film")+
                  (why?" \u2014 "+why:"")+". No story was built and your current film is untouched.", "error");
              return;
            }
          }
          else { localStoryGenRef.current++; applyDoc(emptyDoc()); setArtView("lookbook"); }
        }
        // A new story always starts in the Writers' Room on the spine — the story is
        // built first; pre-production (the Art Room) comes after. Without this, launching
        // New Story from the Art Room would leave the user staring at empty art tabs.
        setRoom("writers"); setView("spine");
        // Step 0 (pipeline): the chosen FORMAT and FRAMEWORK land on the project;
        // the spine builder, rooms and audit read them via formatOf/frameworkOf
        const brief = (typeof composeStoryBrief==="function") ? composeStoryBrief(logline, synopsis) : logline;
        // persist the logline + the composed brief (synopsis + research) so the user can
        // review later EXACTLY what the spine, beats and cast were built from — and see
        // where anything deviated. Saved at build time; never overwritten by later edits.
        // Episode format is Show-owned. The intake locks its control visibly, and
        // this boundary also rejects a stale/mutated callback value defensively.
        const effectiveFormatId=newStoryBuildsCurrentEpisode ? newStoryEpisodeFormat : formatId;
        setProject(p=>({ ...p,
          ...(effectiveFormatId?{format:effectiveFormatId}:{}), ...(frameworkId?{framework:frameworkId}:{}),
          logline: (logline||"").trim() || p.logline,
          // the synopsis paragraphs in the framework's shape — each scene prompt reads its
          // act's paragraph (synopsisParasOf); the brief text alone is clipped at 4000 chars
          ...((synopsis && synopsis.synopsis && Array.isArray(synopsis.synopsis.paras))
            ? { synopsis:{ paras:synopsis.synopsis.paras.filter(pg=>pg && String(pg.text||"").trim())
                .map(pg=>({ key:pg.key||"", label:pg.label||"", text:String(pg.text).trim() })) } } : {}),
          // THE RESEARCH RESERVOIR (2026-10-02): the Three Pillars are kept with the film — the world
          // build and the cast's inner life read them (ai.jsx researchReservoir) — with the pages a
          // web-grounded Fact pillar used. A build without research clears the last story's.
          research: (typeof researchToKeep==="function") ? researchToKeep(synopsis && synopsis.research) : undefined,
          sourceBrief: brief, sourceBriefAt: new Date().toISOString() }));
        setAgentLaunch({id:"adapt", input:brief}); setAgentsOpen(true); }}),

    // MUSE — Frances (the codename stays MUSE in code), the floating help assistant, available in
    // every room; it only answers (the Story Editors and Department Heads do the work).
    // Signed-in: full Claude-powered chat over your story. Signed-out: a curated teaser
    // (a few hand-written tastes + a sign-up nudge), so visitors get a feel without the
    // full studio. signedIn flips the mode; onSignIn opens the auth modal.
    (typeof MuseDock!=="undefined") && React.createElement(MuseDock,{
      scenes, selScene:sel, project, signedIn: !!session, onSignIn:()=>setAuthOpen(true),
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),
    // the floating WRITING-engine dock (mirror of the Art Room's image dock) —
    // wherever text models run: the Writers' Room and the Art Room
    (room==="writers"||room==="art") && scenes.length>0 && (typeof window.WritingDock==="function")
      && React.createElement(window.WritingDock, { task: room==="art" ? "specs" : "story" }),

    // Undo affordance — persists whether the Writers' Room is open or closed.
    // Suppressed for Adaptation (full build-from-scratch): the toast is easy to miss
    // beneath the result modal, and the in-room "Undo last" still covers it.
    studioProgress && React.createElement(StudioProgressOverlay, studioProgress),
    // scene delete undo — the same affordance, tied to the film the scene came from
    !writersRoomBlocked && deletedScene && deletedScene.owner===currentProjectId && React.createElement("div",{className:"agent-undo scene-undo"+((agentUndoHere.length>0 && agentUndoHere[agentUndoHere.length-1].label!=="Adaptation")?" stacked":"")},
      React.createElement("span",{className:"au-ic"},React.createElement(Icon.undo,{s:16})),
      React.createElement("div",{className:"au-text"},
        React.createElement("div",{className:"au-t"},"Scene "+deletedScene.scene.no+" deleted"),
        React.createElement("div",{className:"au-s"},"Restore it with its beats and draft"
          +(()=>{ const more = deletedScenes.filter(x=>x && x.owner===currentProjectId).length-1; return more>0 ? " \u00b7 "+more+" more deleted scene"+(more!==1?"s":"")+" can be brought back after it" : ""; })())),
      React.createElement("button",{className:"au-btn",onClick:undoDeleteScene},
        React.createElement(Icon.undo,{s:14}),"Undo"),
      React.createElement("button",{className:"au-x",title:"Dismiss","aria-label":"Dismiss",onClick:()=>setDeletedScenes(list=>list.filter(x=>x!==deletedScene))},
        React.createElement(Icon.x,{s:14}))),
    !writersRoomBlocked && agentUndoHere.length>0 && agentUndoHere[agentUndoHere.length-1].label!=="Adaptation" && React.createElement("div",{className:"agent-undo"},
      React.createElement("span",{className:"au-ic"},React.createElement(Icon.undo,{s:16})),
      React.createElement("div",{className:"au-text"},
        React.createElement("div",{className:"au-t"},agentLabel(agentUndoHere[agentUndoHere.length-1].label)+" changed your story"),
        React.createElement("div",{className:"au-s"},
          agentUndoHere.length>1 ? (agentUndoHere.length+" runs can be undone") : "One click to revert it")),
      React.createElement("button",{className:"au-btn",onClick:undoLastAgent},
        React.createElement(Icon.undo,{s:14}),"Undo"),
      React.createElement("button",{className:"au-x",title:"Keep changes","aria-label":"Keep changes",onClick:()=>setAgentUndo([])},
        React.createElement(Icon.x,{s:14}))),

    // ART UNDO chip (2026-10-02): in the Art Room, after an Art Room agent changed its specs
    room==="art" && !artRoomReadOnly && artUndoHere.length>0 && React.createElement("div",{className:"agent-undo art-undo"+((!writersRoomBlocked && agentUndoHere.length>0 && agentUndoHere[agentUndoHere.length-1].label!=="Adaptation")?" stacked":"")},
      React.createElement("span",{className:"au-ic"},React.createElement(Icon.undo,{s:16})),
      React.createElement("div",{className:"au-text"},
        React.createElement("div",{className:"au-t"},agentLabel(artUndoHere[artUndoHere.length-1].label)+" changed the Art Room"),
        React.createElement("div",{className:"au-s"},
          artUndoHere.length>1 ? (artUndoHere.length+" runs can be undone") : "One click to revert it")),
      React.createElement("button",{className:"au-btn",onClick:undoLastArtAgent},
        React.createElement(Icon.undo,{s:14}),"Undo"),
      React.createElement("button",{className:"au-x",title:"Keep changes","aria-label":"Keep changes",onClick:()=>setArtUndo(st=>st.filter(x=>!(x && x.filmKey===agentFilmKey())))},
        React.createElement(Icon.x,{s:14}))),

    // Tweaks panel
    React.createElement(TweaksPanel,null,
      React.createElement(TweakSection,{label:"Cinematic grade"}),
      React.createElement(TweakToggle,{label:"Premium polish",value:t.premium,onChange:v=>setTweak("premium",v)}),
      React.createElement(TweakColor,{label:"Charge palette",value:GRADES[t.grade].pos,
        options:Object.values(GRADES).map(g=>g.pos),
        onChange:(v)=>{const k=Object.keys(GRADES).find(k=>GRADES[k].pos===v);setTweak("grade",k);}}),
      React.createElement(TweakRadio,{label:"Grade",value:t.grade,
        options:Object.keys(GRADES),onChange:v=>setTweak("grade",v)}),
      React.createElement(TweakToggle,{label:"Film grain",value:t.grain,onChange:v=>setTweak("grain",v)}),
      React.createElement(TweakSection,{label:"Workspace"}),
      React.createElement(TweakRadio,{label:"Density",value:t.density,
        options:["compact","regular","comfy"],onChange:v=>setTweak("density",v)}),
      React.createElement(TweakRadio,{label:"Display type",value:t.display,
        options:["Grotesk","Serif"],onChange:v=>setTweak("display",v)}),
    ),
  );
}

/* CRASH BOUNDARY — before this, ONE render exception unmounted the whole tree and left a
   white screen with no way back. Worse: if the cause was a bad record in the open film,
   reloading re-loaded it and crashed again, so the film became effectively unopenable.
   This catches the error, says what happened, and offers two escapes — a plain reload and
   a reload that clears the device-local view state (NAV_KEY), so a crash tied to one tab
   doesn't reopen straight onto it. Note the honest limit: React runs effect cleanups while
   unwinding, which cancels the 700ms save debounce, so the last unsaved moment can be
   lost — the copy says so rather than promising nothing was. */
class AppCrash extends React.Component {
  constructor(p){ super(p); this.state = { err:null }; }
  static getDerivedStateFromError(err){ return { err }; }
  componentDidCatch(err, info){ try{ console.error("Kinolot — render crash:", err, info); }catch(e){} }
  render(){
    if(!this.state.err) return this.props.children;
    const e = this.state.err;
    const msg = String((e && (e.stack || e.message)) || e);
    const reload = ()=>{ try{ window.location.reload(); }catch(x){} };
    return React.createElement("div",{className:"crash-wrap"},
      React.createElement("div",{className:"crash-card"},
        React.createElement("div",{className:"crash-t"},"Something broke on screen"),
        React.createElement("div",{className:"crash-d"},
          "This is a display error, not a lost film — your work saves continuously, though the last few seconds of edits may not have been written. Reload to get back in."),
        React.createElement("div",{className:"crash-acts"},
          React.createElement("button",{className:"crash-btn primary",onClick:reload},"Reload"),
          React.createElement("button",{className:"crash-btn",
            title:"Reload starting on the default view — use this if the same screen keeps breaking",
            onClick:()=>{ try{ localStorage.removeItem(NAV_KEY); }catch(x){} reload(); }},
            "Reload on a fresh view"),
          React.createElement("button",{className:"crash-btn",
            title:"Copy the technical detail so it can be reported",
            onClick:()=>{ try{ navigator.clipboard.writeText(msg); }catch(x){} }},"Copy error")),
        React.createElement("details",{className:"crash-det"},
          React.createElement("summary",null,"Technical detail"),
          React.createElement("pre",{className:"crash-pre"},msg))));
  }
}
ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(AppCrash,null,React.createElement(App)));
