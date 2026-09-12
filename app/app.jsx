/* app.jsx — compose Cinema Machine: state, views, tweaks */

const { PROJECT, CHARACTERS, SCENES, BEATS, SCREENPLAY, CONTINUITY, FACTS } = window.TURN_DATA;

/* Is this ledger's plan a REAL, paid subscription? Cinema Machine has NO free tier,
   so "", "none" (cancelled) AND "free" (the generic Get-started signup default) are
   all NOT active plans — only Writer/Director/Studio count. Every plan-gate check
   funnels through here so the app can't disagree with itself about what "on a plan"
   means (a new account's ledger comes back plan:"free", which must still be gated). */
window.turnIsPaidPlan = function(plan){
  const p = String(plan||"").toLowerCase().trim();
  return !!p && p!=="none" && p!=="free";
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
  if(Array.isArray(v)) return "["+v.map(x=> x===undefined ? "null" : stableJson(x)).join(",")+"]";
  const ks = Object.keys(v).filter(k=>v[k]!==undefined).sort();
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
function turnFirstStoryScene(scenes){
  const ordered = (typeof scenesInStoryOrder==="function")
    ? scenesInStoryOrder(scenes) : (Array.isArray(scenes)?scenes:[]);
  return ordered[0] || null;
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "grade": "Teal & Orange",
  "framework": true,
  "density": "regular",
  "display": "Grotesk",
  "grain": true,
  "premium": true
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

function StudioProgressOverlay({ title, detail, progress, role }){
  const pct = progress==null ? null : Math.max(0, Math.min(100, Math.round(progress)));
  return React.createElement("div",{className:"redraft-overlay studio-progress-overlay",
    role:"status","aria-live":"polite","aria-atomic":"true","aria-label":title},
    React.createElement("div",{className:"redraft-card studio-progress-card"},
      React.createElement("span",{className:"orb"}),
      // ONE consistent fiction across every tab: MUSE is the studio's AI, wearing the
      // department hat that owns this tab — the eyebrow names the hat, the title the work.
      role && React.createElement("div",{className:"redraft-role"},"MUSE \u00b7 "+role),
      React.createElement("div",{className:"redraft-t"},title),
      detail && React.createElement("div",{className:"redraft-d"},detail),
      pct!=null && React.createElement("div",{className:"studio-progress-bar",role:"progressbar",
        "aria-label":"Progress","aria-valuemin":0,"aria-valuemax":100,"aria-valuenow":pct},
        React.createElement("i",{style:{width:pct+"%"}}))));
}

/* ---- alternate view: Turn Audit table ---- */
function TurnAudit({ scenes, selId, onSelect }){
  return React.createElement(DragScroll,{className:"canvas-scroll",style:{padding:"18px 28px 40px"}},
    React.createElement("div",{style:{maxWidth:880,margin:"0 auto"}},
      React.createElement("div",{className:"divider"},
        React.createElement("span",{className:"eyebrow"},"Turn Audit · every scene must turn"),
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
            const { flagged } = turnInfo(s);
            return React.createElement("div",{key:s.id,onClick:()=>onSelect(s.id),
              style:{display:"grid",gridTemplateColumns:"44px 1fr 120px 150px 110px",cursor:"pointer",
                borderBottom:"1px solid var(--line)",background:s.id===selId?"var(--bg-3)":"transparent",
                alignItems:"center"}},
              React.createElement("div",{style:{padding:"12px 14px",fontFamily:"var(--f-mono)",fontSize:11,color:"var(--txt-3)",fontWeight:700}},String(s.no).padStart(2,"0")),
              React.createElement("div",{style:{padding:"12px 14px",borderLeft:"1px solid var(--line)"}},
                React.createElement("div",{style:{fontFamily:"var(--f-display)",fontSize:13,color:"var(--txt-0)",fontWeight:500}},s.title),
                React.createElement("div",{style:{fontFamily:"var(--f-mono)",fontSize:9.5,color:"var(--txt-3)",marginTop:2}},
                  `Act ${["I","II","III","IV"][s.act-1]||s.act} · ${s.seq}`,KIND_LABEL[s.kind]?(" · "+KIND_LABEL[s.kind]):"")),
              React.createElement("div",{style:{padding:"12px 14px",borderLeft:"1px solid var(--line)",display:"flex",alignItems:"center",gap:6}},
                React.createElement(ChargeChip,{value:s.openCharge}),
                React.createElement("span",{style:{color:"var(--txt-3)",display:"flex"}},React.createElement(Icon.arrowSmall,{s:11})),
                React.createElement(ChargeChip,{value:s.closeCharge})),
              React.createElement("div",{style:{padding:"12px 14px",borderLeft:"1px solid var(--line)",fontSize:11.5,color:"var(--txt-1)"}},
                `${s.openValue} \u2192 ${s.closeValue}`),
              React.createElement("div",{style:{padding:"12px 14px",borderLeft:"1px solid var(--line)"}},
                flagged
                  ? React.createElement("span",{className:"turn-badge no"},React.createElement(Icon.alert,{s:10}),
                      (typeof fwAuditOf==="function" && fwAuditOf().flagBadge)||"No turn")
                  : React.createElement("span",{className:"turn-badge ok"},React.createElement(Icon.check,{s:10}),
                      (typeof fwAuditOf==="function" && fwAuditOf().okBadge)||"Turns")));
          }))),
      React.createElement("div",{className:"audit-mobile-list"},
        scenes.map(s=>{
          const { flagged } = turnInfo(s);
          return React.createElement("button",{key:s.id,type:"button",className:"audit-mobile-card"+(s.id===selId?" sel":""),
            onClick:()=>onSelect(s.id)},
            React.createElement("div",{className:"audit-mobile-top"},
              React.createElement("span",{className:"audit-mobile-no"},String(s.no).padStart(2,"0")),
              flagged
                ? React.createElement("span",{className:"turn-badge no"},React.createElement(Icon.alert,{s:10}),
                    (typeof fwAuditOf==="function" && fwAuditOf().flagBadge)||"No turn")
                : React.createElement("span",{className:"turn-badge ok"},React.createElement(Icon.check,{s:10}),
                    (typeof fwAuditOf==="function" && fwAuditOf().okBadge)||"Turns")),
            React.createElement("div",{className:"audit-mobile-title"},s.title),
            React.createElement("div",{className:"audit-mobile-meta"},
              `Act ${["I","II","III","IV"][s.act-1]||s.act} · ${s.seq}`,KIND_LABEL[s.kind]?(" · "+KIND_LABEL[s.kind]):""),
            React.createElement("div",{className:"audit-mobile-charge"},
              React.createElement(ChargeChip,{value:s.openCharge}),
              React.createElement("span",{className:"audit-mobile-arrow"},React.createElement(Icon.arrowSmall,{s:11})),
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
  return React.createElement(DragScroll,{className:"canvas-scroll board-pan",style:{padding:"18px 22px 40px"}},
    React.createElement("div",{style:{display:"flex",gap:14,minWidth:"max-content"}},
      acts.map(a=>{
        const roman=["I","II","III","IV"][a.act-1]||String(a.act);
        // collapsed → a slim, clickable vertical strip
        if(collapsed[a.act]) return React.createElement("div",{key:a.act,className:"board-act-strip",
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
              React.createElement(Icon.chevD,{s:13})),
            React.createElement("span",{className:"tree-act-no"},roman),
            React.createElement("span",{style:{fontFamily:"var(--f-display)",fontSize:13,fontWeight:500}},titles[a.act].split("· ")[1]),
            React.createElement("span",{style:{fontFamily:"var(--f-mono)",fontSize:10,color:"var(--txt-3)",marginLeft:"auto"}},a.scenes.length)),
          React.createElement("div",{style:{display:"flex",flexDirection:"column",gap:8}},
            a.scenes.map(s=>{
              const {flagged}=turnInfo(s);
              return React.createElement("div",{key:s.id,onClick:()=>onSelect(s.id),
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
                  React.createElement("span",{className:"chip-arrow"},React.createElement(Icon.arrowSmall,{s:11})),
                  React.createElement(ChargeChip,{value:s.closeCharge}),
                  flagged&&React.createElement("span",{className:"tree-flag",style:{marginLeft:"auto"}},React.createElement(Icon.alert,{s:13}))));
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
      format: undef(project.formatId), framework: undef(project.frameworkId),
    },
    look: {
      visual_statement: undef(doc.lookbookNote),
      film_stock: undef(sb.filmStock && sb.filmStock!=="none" ? sb.filmStock : ""),
      references: undef((sb.refs||"")),
      palette_presets: (sb.presets||[]).map(p=>({ id:p.id, name:p.name, palette:p.palette })),
      lookbook: lookbook.filter(c=>(c.note||"").trim()).map(c=>({ source:c.source, category:c.category, note:c.note })),
    },
    characters: characters.map(c=>({
      id: c.id, name: c.name, role: undef(c.role),
      wants: undef(c.conscious), fear: undef(c.unconscious), arc: undef(c.arc),
      physique: (c.physique && Object.keys(c.physique).length) ? c.physique : undefined,
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
    return typeof window.turnPruneAccidentalManualCast==="function"
      ? window.turnPruneAccidentalManualCast(loaded, saved||{}) : loaded;
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
  const [project, setProject] = React.useState(()=> (saved && saved.project) || ({ title:"Untitled film", genre:"", logline:"", controllingIdea:{} }));
  // Live world snapshot for lifecycle operations that await a save/confirmation.
  // Reading the ref after the await avoids converting an older render's Bible.
  const seriesSnapshotRef = React.useRef(null);
  // Story Contract (outer plot · inner arc · dominance) — patch helper for the rail panel
  const updateContract = (patch)=> setProject(p=>({ ...p, contract:{ ...((p&&p.contract)||{}), ...patch } }));
  // project augmented with the Lookbook references routed to one department, so each drafter's
  // prompt honours only its relevant references (see lookbookBriefFor / _lookbookBlock).
  const lbProject = (dept)=> ({ ...project, _lookbookBrief:(typeof lookbookBriefFor==="function" ? lookbookBriefFor(dept, lookbook, lookbookNote) : "") });
  // record that a department now reflects the current Lookbook (clears its "stale" flag)
  const markApplied = (dept)=> setLookbookApplied(m=> ({ ...m, [dept]:(typeof lookbookBriefFor==="function" ? lookbookBriefFor(dept, lookbook, lookbookNote) : "") }));
  const [selId, setSelId] = React.useState(()=> (saved && saved.selId) || null);
  const [selChar, setSelChar] = React.useState(null);
  // "follow this character" lens on the Spine view — session-only (not persisted)
  const [followChar, setFollowChar] = React.useState(null);
  // Restore the room the user last had open (Writers' or Art) from the device-local
  // NAV_KEY — read synchronously so it's correct on first paint. applyDoc never
  // re-applies room, so cloud hydration can't flip it (that flip was the old flash).
  const [room, setRoom] = React.useState(()=> nav.room || "writers");
  const [artView, setArtView] = React.useState(()=>{
    // first-ever Art Room visit lands on the LOOKBOOK (the look steers everything
    // downstream); any later visit restores the tab the user last left (nav/doc).
    const v = nav.artView || (saved && saved.artView) || "lookbook";
    return v==="voices" ? "characters" : v;   // Voices is no longer a tab — it lives on the character card
  });
  // once-per-story guard so auto-seeding the Props tab from the cast doesn't
  // re-add props the user has deliberately deleted.
  const [propsSeeded, setPropsSeeded] = React.useState(()=> !!(saved && saved.propsSeeded));
  const [locsSeeded, setLocsSeeded] = React.useState(()=> !!(saved && saved.locsSeeded));
  // once-per-story guard so the cast is auto-drafted the first time the Art Room
  // opens (not re-drafted on every visit), plus the set of character ids currently
  // being drafted so each card can show its own inline "Drafting…" status.
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
  const [view, setView] = React.useState(()=> nav.view || (saved && saved.view) || "spine");
  const vp = useViewport();
  // both side panels use the SAME mechanics: in-layout (a persistent collapsed strip when
  // closed, pushes the canvas when open) on tablet + desktop; an overlay drawer only on
  // mobile. Previously the rail drawered on tablet too — it overlaid the hero and vanished
  // when closed, unlike the inspector.
  const railDrawer = vp === "mobile";
  const inspDrawer = vp === "mobile";
  const [aiOpen, setAiOpen] = React.useState(()=> typeof window!=="undefined" && window.innerWidth>=1100);
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
    else { setRailOpen(false); setInspOpen(false); setAiOpen(false); }
    lastVp.current = vp;
  },[vp]);
  // on mobile, only one overlay at a time
  const excl = ()=> vp==="mobile";
  const toggleRail = ()=> setRailOpen(o=>{ const n=!o; if(n && excl()){ setInspOpen(false); setAiOpen(false); } return n; });
  const toggleInsp = ()=> setInspOpen(o=>{ const n=!o; if(n && excl()){ setRailOpen(false); setAiOpen(false); } return n; });
  const toggleAI   = ()=> setAiOpen(o=>{ const n=!o; if(n && excl()){ setRailOpen(false); setInspOpen(false); } return n; });
  const [drafts, setDrafts] = React.useState(()=> (saved && saved.drafts) || ({}));
  const [drafting, setDrafting] = React.useState(null);
  const [beatsMap, setBeatsMap] = React.useState(()=> (saved && saved.beatsMap) || ({}));
  const [history, setHistory] = React.useState(()=> (saved && saved.history) || {});   // {sceneId:{back:[ver...], fwd:[ver...]}}
  const [continuityMap, setContinuityMap] = React.useState(()=> (saved && saved.continuityMap) || {});
  const [agentsOpen, setAgentsOpen] = React.useState(false);
  const [sceneDirLaunch, setSceneDirLaunch] = React.useState(null); // Scene Director: {sceneId}|{} (whole film)|null
  const [coloristOpen, setColoristOpen] = React.useState(false);   // Cinematographer / Colorist (Art Room)
  const [shotDesignerOpen, setShotDesignerOpen] = React.useState(false);   // Shot Designer (Art Room)
  const [castingOpen, setCastingOpen] = React.useState(false);   // Casting Director (Art Room)
  const [propsMasterOpen, setPropsMasterOpen] = React.useState(false);   // Props Master (Art Room)
  const [locScoutOpen, setLocScoutOpen] = React.useState(false);   // Location Scout (Art Room)
  // when an agent is opened via the Lookbook "Re-draft & regenerate" action, run it in force mode
  const [castingForce, setCastingForce] = React.useState(false);
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
    // drafted gate: the cast AUTO-drafts on Art Room open, and gating on mere existence
    // would pop a false banner right after that silent draft; both are usually drafted
    // via their batch anyway, so the strict gate rarely bites there.)
    const lbContentFlags = {
      characters: (characters||[]).some(c=> (typeof charVisualsDrafted==="function") ? charVisualsDrafted(c) : !!(c&&c.id)),
      props: (props||[]).some(p=> (typeof propVisualsDrafted==="function") ? propVisualsDrafted(p) : false),
      locations: (locations||[]).some(l=> l && l.id),
      colorist: !!(project && project.styleBible && project.styleBible.sceneStyles && Object.keys(project.styleBible.sceneStyles).length),
      shots: (shots||[]).length>0,
      storyboard: (()=>{
        if(typeof nbGetImage!=="function" || typeof sbPageRanges!=="function") return false;
        const byScene={}; (shots||[]).forEach(sh=>{ if(sh&&sh.sceneId) (byScene[sh.sceneId]=byScene[sh.sceneId]||[]).push(sh); });
        return Object.keys(byScene).some(sceneId=>{
          const ordered=byScene[sceneId].slice().sort((a,b)=>(a.order||0)-(b.order||0)||(a.beatN||0)-(b.beatN||0));
          return sbPageRanges(ordered).some((_,i)=>{ try{ return !!nbGetImage("sbsheet-sbpage-"+sceneId+"-2x2-"+i); }catch(e){ return false; } });
        });
      })(),
    };
    const staleDepts = (typeof lookbookStaleDepts==="function") ? lookbookStaleDepts(lookbook, lookbookNote, lookbookApplied, lbContentFlags) : {};
    const t = {};
    if(staleDepts.characters) t.characters = true;
    if(staleDepts.props) t.props = true;
    if(staleDepts.locations) t.locations = true;
    if(staleDepts.colorist) t.stylebible = true;
    if(staleDepts.shots) t.shots = true;
    if(staleDepts.storyboard) t.storyboard = true;
    return t;
  },[lookbook, lookbookNote, lookbookApplied, characters, props, locations, shots, project]);
  // re-draft one department from the updated Lookbook (confirm first; agent runs in force
  // mode). mode "full" (default) also regenerates the sheets; mode "draft" re-drafts the
  // specs only and leaves every generated image untouched — regenerate later, when ready.
  const applyLookbook = async (dept, mode)=>{
    if(mode==="review"){
      const label = dept==="storyboard" ? "storyboards" : dept;
      let ok = true;
      if(typeof window.appConfirm==="function") ok = await window.appConfirm({
        title:"Mark "+label+" reviewed?",
        body:"This records that you reviewed the existing work against the current Lookbook. It does not regenerate, replace, or delete any output.",
        confirmLabel:"Mark reviewed"
      });
      if(ok) markApplied(dept);
      return;
    }
    if(dept==="shots"){
      let ok = true;
      if(typeof window.appConfirm==="function") ok = await window.appConfirm({
        title:"Review shots with the updated Lookbook?",
        body:"Opens the Shot Designer to propose updated coverage from the current Lens, Composition and Lighting brief. Existing shot frames remain untouched unless you explicitly approve and render changes.",
        confirmLabel:"Open Shot Designer"
      });
      if(ok) setShotDesignerOpen(true);
      return;
    }
    const draftOnly = mode==="draft";
    const label = { characters:"Characters", props:"Props", locations:"Locations", colorist:"Styles" }[dept] || dept;
    let ok = true;
    if(typeof window.appConfirm==="function"){
      ok = await window.appConfirm(draftOnly
        ? { title:"Re-draft "+label+" specs?",
            body:"This re-drafts every spec in "+label+" from the updated Lookbook — overwriting the current specs, including any manual edits — but leaves all generated images untouched. Regenerate them whenever you're ready.",
            confirmLabel:"Re-draft only", danger:true }
        : { title:"Re-draft & regenerate "+label+"?",
            body:"This re-drafts every spec in "+label+" from the updated Lookbook and regenerates its sheets. It overwrites the current specs, including any manual edits.",
            confirmLabel:"Re-draft & regenerate", danger:true });
    }
    if(!ok) return;
    const f = draftOnly ? "draft" : true;
    if(dept==="characters"){ setCastingForce(f); setCastingOpen(true); }
    else if(dept==="props"){ setPropsMasterForce(f); setPropsMasterOpen(true); }
    else if(dept==="locations"){ setLocScoutForce(f); setLocScoutOpen(true); }
    else if(dept==="colorist"){ setColoristOpen(true); }
  };
  const [researchOpen, setResearchOpen] = React.useState(false);   // Visual Researcher (Lookbook)
  const [coordOpen, setCoordOpen] = React.useState(false);   // Art Department Coordinator (meta-agent)
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
  const [creditPackOpen, setCreditPackOpen] = React.useState(()=>{
    try{
      const qs = new URLSearchParams(window.location.search);
      return qs.has("credits") || qs.has("credit_pack");
    }catch(e){ return false; }
  });
  React.useEffect(()=>{
    if(!welcomeOpen && !creditPackOpen) return;
    try{ const u = new URL(window.location.href); u.searchParams.delete("welcome"); u.searchParams.delete("credits"); u.searchParams.delete("credit_pack");
      window.history.replaceState({}, "", u.pathname + (u.searchParams.toString()?("?"+u.searchParams.toString()):"") + u.hash); }catch(e){}
  },[]);
  /* INVITE ACCEPTANCE LANDING — /?invite=<projectId> is where every invitation
     email lands (set as the redirect by the invite-collaborator function). The
     id is captured once, stripped from the URL, and drives the welcome surface
     after sign-in. */
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
        window.appToast("That sign-in link didn't work: "+desc.replace(/\+/g," ")+". Ask for a fresh invitation, or sign in with your password.","error");
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
  },[]);
  React.useEffect(()=>{
    if(!(typeof cloudConfigured==="function" && cloudConfigured())){ setAuthReady(true); return; }
    let unsub = ()=>{};
    (async()=>{
      try{ setSession(await cloudGetSession()); }catch(e){}
      setAuthReady(true);   // landing/app gate waits for this so signed-in users never flash the landing
      unsub = cloudOnAuth((s)=>setSession(s));
    })();
    return ()=>{ try{ unsub(); }catch(e){} };
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
  const [projectLoading, setProjectLoading] = React.useState(false);
  const projectLoadingRef = React.useRef(false); projectLoadingRef.current=projectLoading;
  // LIVE mirror of the open film's id. Long async work (agent runs, scene drafting,
  // image generation) captures the id it started under and compares it against this
  // before writing results into state — the film switcher stays live throughout, and a
  // result that lands after a switch belongs to a film that is no longer open.
  const projIdRef = React.useRef(null); projIdRef.current = currentProjectId;
  // Read-only scope marker for asynchronous, film-bound asset tools. The
  // project description itself does not carry the persisted film row's id.
  window.__turnCurrentProjectId = currentProjectId || null;
  const cloudMode = !!(session && currentProjectId);
  /* SHARE ROLE on the open film. Room access and room mutability are deliberately
     separate: an Art director may inspect the Writers' Room, but only Writer/owner
     roles may change its story sections. The section helper is also the autosave
     allow-list, keeping visible controls and durable writes on one permission model. */
  const _projRow = (projects||[]).find(p=>p.id===currentProjectId) || null;
  const shareRole = (_projRow && _projRow.shareRole) || (_projRow && _projRow.isOwner ? "owner" : "");
  const readOnlyShare = shareRole === "view_only";
  const unknownSharedRole = !!(_projRow && _projRow.isShared
    && !["view_only","writer","art_director"].includes(shareRole));
  const _sharedCanWriteRoom = id=>!(_projRow&&_projRow.isShared)
    || (typeof window.teamCanWriteRoom==="function" && window.teamCanWriteRoom(shareRole,id));
  const writersRoomReadOnly = !_sharedCanWriteRoom("writers");
  const artRoomReadOnly = !_sharedCanWriteRoom("art");
  const writersRoomBlocked = projectLoading || writersRoomReadOnly;
  const roomReadOnly = projectLoading || (room==="writers" ? writersRoomReadOnly
    : room==="art" ? artRoomReadOnly : readOnlyShare);
  /* LIVE refs fence async results whose collaborator role changes while model work
     is in flight. A role change may happen without remounting the running agent. */
  const readOnlyShareRef = React.useRef(false);
  readOnlyShareRef.current = readOnlyShare;
  const roomReadOnlyRef = React.useRef(false);
  roomReadOnlyRef.current = roomReadOnly;
  const writersRoomReadOnlyRef = React.useRef(false);
  writersRoomReadOnlyRef.current = writersRoomBlocked;
  const characterBibleWritableRef = React.useRef(true);
  characterBibleWritableRef.current = !(_projRow&&_projRow.isShared)
    || (typeof window.teamCanWriteSection==="function"
      && window.teamCanWriteSection(shareRole,"characters"));
  const readOnlyNoticeRef = React.useRef(0);
  const _mutationNotice = roomId=>{
    const now = Date.now();
    if(now-(readOnlyNoticeRef.current||0)>2500){
      readOnlyNoticeRef.current = now;
      if(typeof window.appToast==="function"){
        const note=(typeof window.teamRoleScopeNote==="function")?window.teamRoleScopeNote(shareRole):"";
        window.appToast(note || (roomId==="writers"
          ? "This role can read the Writers' Room but cannot change story or script."
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
    const off = window.cloudJoinPresence(currentProjectId,
      { email, name:(email||"").split("@")[0], role:unknownSharedRole?"role_unavailable":(shareRole||"owner"), at:Date.now() },
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
    const collaborative = others>0 || !!(_projRow && _projRow.isShared);
    if(!collaborative) return;
    let alive = true, busy = false, ticks = 0, ended = false, pushTimer = null;
    const accessEnded = async ()=>{
      if(ended || !alive) return; ended = true;
      const title = (_projRow && _projRow.title) || "this film";
      try{
        if(typeof window.appConfirm==="function")
          await window.appConfirm({ title:"Access ended",
            body:"\""+title+"\" is no longer shared with you \u2014 the owner removed your access or deleted the film. You'll go back to your own films.",
            confirmLabel:"Back to my films", cancelLabel:"OK" });
        else if(typeof window.appToast==="function")
          window.appToast("Your access to \""+title+"\" has ended.","error");
      }catch(e){}
      // a clean reboot lands on the user's own films (or first-film creation) via
      // the normal boot path — much safer than hand-rolled partial state surgery
      try{ window.location.reload(); }catch(e){}
    };
    const checkRemote = async ()=>{
      if(!alive || busy || ended) return;
      if(dirtyRef.current || hydratingRef.current) return;   // never fight local edits
      busy = true;
      try{
        const rev = await window.cloudDocRev(currentProjectId);
        if(alive && rev==null && _projRow && _projRow.isShared && typeof window.cloudCheckAccess==="function"){
          // null is ambiguous (transient error OR revoked access) — ask explicitly,
          // and only ever act on a definitive "gone"
          if((await window.cloudCheckAccess(currentProjectId))==="gone"){ busy = false; return accessEnded(); }
        }
        const seen = (typeof window.cloudSeenRev==="function") ? window.cloudSeenRev(currentProjectId) : 0;
        if(alive && rev && rev > seen && !dirtyRef.current && !hydratingRef.current){
          const row = await cloudLoadProject(currentProjectId);
          if(alive && row && row.doc && !dirtyRef.current && !hydratingRef.current){
            if(typeof window.cloudNoteDocRev==="function") window.cloudNoteDocRev(currentProjectId, row.doc);
            _adoptTheirs(row.doc, []);   // nothing of ours is pending, so adopt freely
          }
        }
      }catch(e){}
      busy = false;
    };
    const tick = ()=>{
      ticks++;
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
      if(!(_projRow && _projRow.isShared)) return;               // owners can't be removed
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
      }).catch(()=>{});
    };
    window.addEventListener("turn-doc-push", onPush);
    window.addEventListener("turn-member-removed", onMemberRemoved);
    const iv = setInterval(tick, 12000);
    return ()=>{ alive = false; clearInterval(iv); clearTimeout(pushTimer);
      window.removeEventListener("turn-doc-push", onPush);
      window.removeEventListener("turn-member-removed", onMemberRemoved); };
  },[cloudMode, currentProjectId, presence.length, _projRow && _projRow.isShared]);
  // ADMIN — demo upkeep account. The Matrix sample story (and "Reset to sample story")
  // is admin-only: every other user (and signed-out local mode) never sees Matrix data.
  const isAdmin = (((typeof cloudUserEmail==="function" && cloudUserEmail(session))||"").toLowerCase()==="admin@infinitestudioai.com");
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
    if(typeof window.turnRefreshLockedStyles==="function") window.turnRefreshLockedStyles(); },[userEmail, session]);
  // CONTINUITY from the landing pricing → checkout: if the visitor picked a paid plan
  // before signing up, open that plan's Stripe checkout automatically once they're in.
  React.useEffect(()=>{
    if(!(session && session.user && session.user.id)) return;
    const plan = intendedPlan;
    if(!plan || plan==="free") return;
    let fresh = false;
    try{
      const at = Number(localStorage.getItem("turn-intended-plan-at")||0);
      fresh = !!at && (Date.now() - at) < 20*60*1000;
    }catch(e){}
    if(!fresh){
      try{ localStorage.removeItem("turn-intended-plan"); localStorage.removeItem("turn-intended-plan-at"); }catch(e){}
      setIntendedPlan(null);
      return;
    }
    const planObj = (window.CINEMA_PLANS||[]).find(p=>String(p.tier).toLowerCase()===plan);
    try{ localStorage.removeItem("turn-intended-plan"); localStorage.removeItem("turn-intended-plan-at"); }catch(e){}
    setIntendedPlan(null);
    // sameTab: this fires from an effect (no user gesture) — window.open would be
    // popup-blocked; navigating this tab to Stripe is never blocked, and the
    // after-payment redirect brings the buyer straight back into the app.
    if(planObj && typeof window.turnStartCheckout==="function") setTimeout(()=>window.turnStartCheckout(planObj, { sameTab:true }), 350);
  },[session, intendedPlan]);
  const [creditBalance, setCreditBalance] = React.useState(null);
  const refreshCreditBalance = React.useCallback(async ()=>{
    if(typeof cloudGetCreditBalance!=="function"){ setCreditBalance(null); return null; }
    try{
      const b = await cloudGetCreditBalance();
      setCreditBalance(b || null);
      window.turnCreditBalance = b || null;
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
  const sluglineUnits = React.useMemo(()=>
    (typeof deriveSluglineUnits==="function" && typeof reconcileSluglineUnits==="function")
      ? reconcileSluglineUnits(deriveSluglineUnits(scenes, drafts), slugUnitsOv) : [],
    [scenes, drafts, slugUnitsOv]);
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
        manual:true, origin:(typeof artRoomPropOrigin==="function")
          ? artRoomPropOrigin(seed.kind||"carried","design") : {kind:"props"} };
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

  /* A clean canvas — what every NEW registered user (and every "New film") starts
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
    setCharacters(typeof window.turnPruneAccidentalManualCast==="function"
      ? window.turnPruneAccidentalManualCast(loadedCharacters, { ...d, characters:loadedCharacters })
      : loadedCharacters);
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
    // and restored synchronously in useState above. Intentionally do NOT re-apply
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
        if(d[k]!==undefined) base[k] = stableJson(d[k]);
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
  const [bootRetryTick,setBootRetryTick] = React.useState(0);
  // Depend on the STABLE user id, not the session object: Supabase fires several auth
  // events on sign-in (INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED), each a NEW session
  // object. If the effect keyed on `session`, a later event would re-run it and cancel the
  // in-flight bootstrap (alive=false) while bootRef blocked the new run — so the project
  // never loaded and the app sat on "Connecting". Keying on the uid runs it once per sign-in.
  const bootUserId = session ? (((typeof cloudUserId==="function") && cloudUserId(session)) || "signed-in") : null;
  React.useEffect(()=>{
    if(!(typeof cloudConfigured==="function" && cloudConfigured())) return;
    if(!bootUserId){ bootRef.current=false; bootLoadWarnedRef.current=false; setProjects([]); setCurrentProjectId(null); if(typeof nbUseLocal==="function") nbUseLocal(); return; }
    if(bootRef.current) return;            // already bootstrapped this sign-in
    bootRef.current = true;
    let alive = true;
    (async()=>{
      let list = await cloudListProjects();
      // list === null means the REQUEST failed (expired token after the tab slept →
      // 401s), not an empty account. Without this retry the boot used to finish
      // against the failure — bootRef stayed latched, no later auth event re-keys
      // the effect, and the app sat on "Connecting" with an empty canvas until a
      // manual reload. Poke the session refresh and retry with backoff instead.
      for(let wait=3000; list===null && alive; wait=Math.min(wait*2,30000)){
        try{ const sb=(typeof sbClient==="function")&&sbClient(); if(sb) await sb.auth.refreshSession(); }catch(e){}
        await new Promise(r=>setTimeout(r,wait));
        if(!alive) return;
        list = await cloudListProjects();
      }
      if(!alive) return;
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
        setHomeOpen(true);
        bootRef.current=false;
        if(!bootLoadWarnedRef.current && typeof window.appToast==="function"){
          bootLoadWarnedRef.current=true;
          window.appToast(openable.length
            ? "Your projects loaded, but none opened yet. TURN will retry automatically."
            : "Your first film hasn't opened yet. TURN will retry automatically.","info");
        }
        setTimeout(()=>{ if(alive) setBootRetryTick(t=>t+1); },3000);
        return;
      }
      bootLoadWarnedRef.current=false;
      // a studio whose EVERY film is a share (invitee with no own work yet)
      // boots onto the home wall, where the share is explained (owner + role),
      // instead of being dropped wordlessly into someone else's Writers' Room.
      // Skip when an invite landing is about to present its own welcome surface.
      if(alive && openable.length && openable.every(p=>p.isShared) && !inviteLanding)
        setHomeOpen(true);
    })().catch(()=>{});
    return ()=>{ alive=false; };
  },[bootUserId,bootRetryTick]);

  const switchProject = async (id)=>{
    if(id===currentProjectId) return true;
    return !!(await loadProjectIntoState(id));
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
          const by = news[0].invited_by ? (" by "+news[0].invited_by) : "";
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
    setArtView("lookbook");   // a fresh film opens the Art Room on the Lookbook (front of the pipeline)
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
      if(medium) style = { label:String((window.RENDER_STYLE_LABELS||{})[topKey]||topKey).replace(/^[🔒🌐]\s*/,""), medium };
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
      // Paint dashboard posters with GPT Image 2 (server-side via the proxy) at
      // HIGH quality / 2K — key art is a hero surface, not a thumbnail. Fall
      // back to the default model only if that id isn't available (proxy off).
      const genOpts = { aspectRatio:"9:16", quality:"high", imageSize:"2K" };
      if(canon.identityCast && canon.identityCast.length){
        Object.assign(genOpts,{identityLive:false, identityCast:canon.identityCast,
          identityCharacterIds:canon.identityCast.map(c=>c.id), identityContext:canon.identityContext});
        if(typeof window.turnIdentityPrompt==="function") prompt += "\n"+window.turnIdentityPrompt(canon.identityCast);
      }
      if((window.NB_MODELS||[]).some(m=>m.id==="gpt-image-2")) genOpts.model = "gpt-image-2";
      if(refs.length) genOpts.extraImages = refs;
      let url = await window.nbGenerate(prompt, genOpts);
      if(!url) throw new Error("The poster came back empty — try again.");
      // keep enough pixels for the full-screen viewer (1080-wide, ~2x the card)
      if(typeof window.downscaleRef==="function"){ try{ url = await window.downscaleRef(url, 1080, 0.85); }catch(e){} }
      const saved=typeof window.cloudSaveCover==="function"
        ? await window.cloudSaveCover(proj.id,url,keepPrev) : null;
      if(!(saved&&saved.ok)){
        pendingSaves[proj.id]={url,keepPrev};
        throw new Error("The poster was generated but couldn't be saved. Try again to save this same image — TURN won't generate or charge for another one.");
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
        : "Episode "+String(no).padStart(2,"0")+" was created and added to the Show, but couldn't be opened yet. Select it from Films & shows to retry.",
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
            "TURN could not refresh the Show before deciding whether this is its final Episode. Nothing was deleted; try again.","error");
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
              "TURN could not verify the final Episode and its Show. Nothing was deleted; refresh Films & shows and try again.","error");
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
     any story-building step; it makes the selected format's storage model true. */
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
  },[cloudMode,currentProjectId,currentShowId,scenes.length,project&&project.format,projects.length,seriesBusy]);
  const [agentLaunch, setAgentLaunch] = React.useState(null);   // {id, input} to auto-run an agent
  /* Existing-film identity resolution can deliberately hand the writer back to
     the same Consistency Check used elsewhere in the Writers' Room.  The
     Character panel and Art Room share this event so neither has to reach into
     the other room's React state. */
  React.useEffect(()=>{
    const openConsistency=()=>{
      if(writersRoomBlocked) return;
      setRoom("writers"); setView("script");
      setAgentLaunch({id:"consistency"}); setAgentsOpen(true);
    };
    window.turnOpenConsistencyCheck=openConsistency;
    window.addEventListener("turn-open-consistency-check",openConsistency);
    return ()=>{
      window.removeEventListener("turn-open-consistency-check",openConsistency);
      if(window.turnOpenConsistencyCheck===openConsistency) delete window.turnOpenConsistencyCheck;
    };
  },[writersRoomBlocked]);

  // persist navigation (room/view/artView) to the device-local key on every change
  React.useEffect(()=>{
    try{ localStorage.setItem(NAV_KEY, JSON.stringify({ room, view, artView, selId })); }catch(e){}
  },[room, view, artView, selId]);

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
    Promise.resolve(loadProjectIntoState(currentProjectId)).then((loaded)=>{
      saveFailsRef.current = 0;   // permanent rejection — never feed the retry loop
      if(loaded){ dirtyRef.current = false; setSaveState("saved"); }   // now genuinely in sync
      else setSaveState("failed");   // reload failed (access revoked?) — do NOT claim sync
    }).catch(()=>setSaveState("failed"));
  };
  const _docConflictCheck = (r)=>{
    if(r && r.roleScope){ _docRoleScope(r); return; }
    if(!r || !r.conflict || _conflictBusy.current) return;
    _conflictBusy.current = true;
    dirtyRef.current = true;
    setSaveState("failed");
    const conflictedProjectId=currentProjectId;
    const conflictedShowId=showIdRef.current;
    const decide=(typeof window.appConfirm==="function")
      ? window.appConfirm({
          title:"Cloud version changed",
          body:"Another window saved this film first. Your local edit is still visible and has NOT been saved. Load the cloud version now? This will replace the unsaved edit in this window.",
          note:"Choose Keep my edits to leave this window untouched while you copy or review the local work.",
          confirmLabel:"Load cloud version",cancelLabel:"Keep my edits",danger:true
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
  const _adoptTheirs = (cloudDoc, mineKeys)=>{
    if(!cloudDoc) return;
    const setters = { scenes:setScenes, characters:setCharacters, props:setProps, locations:setLocations,
      sluglineUnits:setSlugUnitsOv,
      lookbook:setLookbook, lookbookNote:setLookbookNote, lookbookApplied:setLookbookApplied, shots:setShots,
      project:setProject, drafts:setDrafts, beatsMap:setBeatsMap, history:setHistory,
      continuityMap:setContinuityMap, trash:setTrash };
    let adopted = 0;
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
    else setSaveState("failed");
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
      if(meta.cover) keep.cover=meta.cover;
      if(meta.coverPrev) keep.coverPrev=meta.coverPrev;
      if(meta.ord!=null) keep.homeOrder=Number(meta.ord);
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
      if(typeof window.teamCanWriteSection==="function" && _projRow && _projRow.isShared && shareRole!=="owner"){
        const denied=Object.keys(_changed).filter(k=>!window.teamCanWriteSection(shareRole,k));
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
            const note=(typeof window.teamRoleScopeNote==="function")?window.teamRoleScopeNote(shareRole):"";
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
        return Object.keys(baseline).length?{baseline}:undefined;
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
              message:"TURN couldn’t create the local safety journal for this Episode + Show Bible save. No cloud changes were sent; keep this tab open and try again."},ctx);
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
          if(_saveGenerationLatest(ctx) && ep) _adoptTheirs(ep.r.doc,_mineKeys);
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
          if(_saveGenerationLatest(ctx)) _adoptTheirs(result.doc,_mineKeys);
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
    if(typeof lookbookBriefFor!=="function") return;
    const brief = lookbookBriefFor("colorist", lookbook, lookbookNote).replace(/^Overall look: /,"");
    setProject(p=>{
      const sb = (p.styleBible)||{};
      const manual = (typeof mergeLookbookIntoRefs==="function") ? mergeLookbookIntoRefs(sb.refs||"", "") : (sb.refs||"");
      const owned = !!manual.trim() && manual !== (sb.lookbookSynced||"");
      const next = owned ? manual : brief;
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
      body:what+" works on your story — and there isn't one yet. Bring an idea and Cinema Machine builds the story with you, scene by scene.",
      confirmLabel:"+ New Story", cancelLabel:"Not now" });
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
    if(_projRow && _projRow.isShared){
      if(shareRole==="view_only") return { writers_room:true, art_room:true, stage:true };
      if(shareRole==="art_director") return { writers_room:true, art_room:true, stage:false };
      return { writers_room:true, art_room:false, stage:false };
    }
    const b = window.turnCreditBalance;
    if(!b && session && session.user) return null;
    if(typeof window.turnRoomEntitlements==="function") return window.turnRoomEntitlements(b);
    return { writers_room:true, art_room:true, stage:true };
  };
  const roomGateReady = ()=>{
    if(window.turnIsAdmin) return true;
    if(_projRow && _projRow.isShared) return true;
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
    if(_projRow && _projRow.isShared){
      if(typeof window.appToast==="function"){
        const role = typeof window.teamRoleLabel==="function" ? window.teamRoleLabel(shareRole) : "collaborator";
        window.appToast(`${role} access does not include ${id==="art"?"the Art Room":"the Stage"}.`, "info");
      }
      return;
    }
    const plan = (typeof window.turnRoomRequiredPlan==="function") ? window.turnRoomRequiredPlan(id) : "the right";
    if(typeof window.appToast==="function"){
      window.appToast(`${id==="art"?"The Art Room":"The Stage"} requires the ${plan} plan.`, "info");
    }
    requirePlan("open "+(id==="art"?"the Art Room":id==="stage"?"the Stage":"this room"));
  };
  const guardedSetRoom = (id)=>{
    const sharedProject = !!(_projRow && _projRow.isShared);
    if(id!=="writers" && !sharedProject && !planActive()){ requirePlan("open "+(id==="art"?"the Art Room":id==="stage"?"the Stage":"this room")); return; }
    if(id!=="writers" && !canAccessRoom(id)){ requireRoomEntitlement(id); return; }
    if(id!=="writers" && !scenes.length){ requireStory(id==="stage" ? "The Stage" : "The Art Room"); return; }
    setRoom(id);
  };
  React.useEffect(()=>{
    if(room==="writers") return;
    if(!roomGateReady()) return;
    if(canAccessRoom(room)) return;
    const plan = (typeof window.turnRoomRequiredPlan==="function") ? window.turnRoomRequiredPlan(room) : "the right";
    setRoom("writers"); setView("spine");
    if(typeof window.appToast==="function"){
      window.appToast(`${room==="art"?"The Art Room":"The Stage"} requires the ${plan} plan.`, "info");
    }
  },[room, creditBalance, session, isAdmin, shareRole, currentProjectId, projectLoading]);

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
    if(!canMutateSharedFilm()) return;
    const revision=Date.now().toString(36);
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
    const c = (characters||[]).find(x=>x.id===id); if(!c) return;
    setCharacters(cs=>cs.filter(x=>x.id!==id));
    setTrash(t=>({ ...t, characters:[ _trashStamp(c), ...(t.characters||[]).filter(x=>x.id!==id) ] }));
  };
  const restoreCharacter = (id)=>{
    const item = (trash.characters||[]).find(x=>x.id===id); if(!item) return;
    const { _deletedAt, ...clean } = item;
    setCharacters(cs=> cs.some(c=>c.id===id) ? cs : [...cs, clean]);
    setTrash(t=>({ ...t, characters:(t.characters||[]).filter(x=>x.id!==id) }));
  };
  const purgeCharacter = async (id)=>{
    const item = (trash.characters||[]).find(x=>x.id===id);
    if(!item) return;
    try{
      if(typeof nbClearAsset==="function"){
        const ids = [id, ...(item.states||[]).map(st=>id+":"+st.id)];
        for(const assetId of ids) await nbClearAsset(assetId);
      }
      setTrash(t=>({ ...t, characters:(t.characters||[]).filter(x=>x.id!==id) }));
    }catch(e){ if(window.appToast) window.appToast("Couldn't permanently delete this character's assets. It remains in Trash so you can retry.","error"); }
  };
  const [charDrafting, setCharDrafting] = React.useState(null);
  const draftCharacter = async (ch)=>{
    if(!canMutateSharedFilm() || charDrafting) return;
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
    if(!inspDrawer) setInspOpen(true);
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
  const draftCharacterVisuals = async (ch)=>{
    if(draftingVisualIdsRef.current.indexOf(ch.id)>=0) return;   // this character already drafting
    setDraftingVisualIds(ids=> ids.indexOf(ch.id)>=0 ? ids : [...ids, ch.id]);
    const driven = scenes.filter(s=>s.driver===ch.id);
    try{
      const res = (typeof aiCharacterVisuals==="function") ? await aiCharacterVisuals(ch, driven, lbProject("characters"), { scenes, drafts }) : null;
      if(res){ updateCharacter(ch.id, res);
        // pull-on-draft consumed the CURRENT Lookbook — stamp it applied, exactly
        // like the batch path does, or the very first per-card draft raises a false
        // "Lookbook changed" banner the moment the dept gains content
        markApplied("characters"); }
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
    const refs=[]; for(const p of (props||[]).filter(p=>p.ownerId===c.id && p.kind!=="carried")){ const u=await _imgOf(p.id); if(u) refs.push(u); }
    let cameo=[]; if(typeof nbGetCameoAngles==="function"){ try{ cameo=nbGetCameoAngles(c.id)||[]; }catch(e){} }
    if(!cameo.length && typeof nbLoadCameoAngles==="function"){ try{ cameo=await nbLoadCameoAngles(c.id)||[]; }catch(e){} }
    if(refs.length) prompt += " The additional prop reference image(s) show items this character wears/carries — match them EXACTLY.";
    if(cameo.length) prompt += " Keep the FACE, bone structure and skin tone identical to the locked-likeness reference; only wardrobe and condition change.";
    const extra=[...refs, ...cameo];
    const gpt2 = (window.NB_MODELS||[]).find(m=>/gpt-image/i.test(m.id));
    const m0 = (typeof nbGetMeta==="function")?nbGetMeta(c.id):null;
    // the CURRENT picker leads — reusing the prior sheet's recorded model silently
    // ignored the user's model switch (and kept billing against the old provider)
    const model = ((typeof nbGetModel==="function")&&nbGetModel()) || (m0&&m0.modelId) || (gpt2&&gpt2.id) || undefined;
    const gopts = { ...identityOptions, aspectRatio:"16:9", ...(model?{model}:{}), ...(extra.length?{extraImages:extra}:{}) };
    let url; try{ url=await window.nbGenerate(prompt, gopts); }
    catch(e){ if(/no image/i.test(String((e&&e.message)||e))) url=await window.nbGenerate(prompt, gopts); else throw e; }
    if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(gopts,"owner-sheet-commit");
    const meta = { modelId:model, aspect:"16:9", iso:new Date().toISOString(), prompt, agent:"Prop owner pre-gen",
      identitySnapshot:typeof window.nbIdentitySnapshot==="function"?window.nbIdentitySnapshot(c):null,
      writingSources:(typeof window.nbWritingSourcesFor==="function")?window.nbWritingSourcesFor(c):[],
      promptCompiler:"TURN prompt compiler" };
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
  // "Draft all characters" — fills the spec ONLY for characters that haven't been
  // drafted yet (identity, wardrobe, props & accessories, look dev), then suggests
  // continuity states for them. NON-DESTRUCTIVE by design: already-drafted or
  // hand-edited characters are never overwritten, so this is safe to auto-run.
  const draftAllVisuals = async ()=>{
    if(draftingAllVisuals || !(typeof aiCastVisualBible==="function")) return false;
    const drafted = (typeof window.charVisualsDrafted==="function") ? window.charVisualsDrafted : (()=>true);
    const targets = characters.filter(c=> !drafted(c));
    if(!targets.length) return true;            // nothing to do — that's a success
    const targetIds = targets.map(c=>c.id);
    setDraftingVisualIds(targetIds);
    setDraftingAllVisuals(true);
    let landed = false;                          // did any spec actually land?
    try{
      const map = await aiCastVisualBible(targets, scenes, lbProject("characters"), { scenes, drafts });
      // merge ONLY the targeted (undrafted) characters — never touch the rest
      if(map){
        const allow = new Set(targetIds);
        landed = targetIds.some(id=>map[id]);
        setCharacters(cs=>cs.map(c=> (allow.has(c.id) && map[c.id]) ? {...c, ...map[c.id]} : c));
      }
      // continuity (if applicable): add suggested appearance states, dedup by label, never remove
      if(typeof aiSuggestStates==="function"){
        const results = await Promise.all(targets.map(async c=>{
          const driven = scenes.filter(s=>s.driver===c.id);
          if(!driven.length) return { id:c.id, states:null };
          try{ return { id:c.id, states: await aiSuggestStates(c, driven, project) }; }
          catch(e){ return { id:c.id, states:null }; }
        }));
        const add = {}; results.forEach(r=>{ if(r.states && r.states.length) add[r.id]=r.states; });
        if(Object.keys(add).length){
          setCharacters(cs=>cs.map(c=>{
            const sug = add[c.id]; if(!sug) return c;
            const existing = c.states || [];
            const have = new Set(existing.map(s=>(s.label||"").trim().toLowerCase()));
            const adds = sug.filter(s=>!have.has((s.label||"").trim().toLowerCase()));
            return adds.length ? {...c, states:[...existing, ...adds]} : c;
          }));
        }
      }
      if(targets.length) markApplied("characters");
    }catch(e){}
    setDraftingAllVisuals(false);
    setDraftingVisualIds([]);
    return landed;
  };

  // ---- Art Room: LOOKBOOK (References) ----
  const updateLookbookCard = (id,patch)=>setLookbook(ls=>ls.map(c=>{
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
    const id = "look-"+Date.now().toString(36);
    setLookbook(ls=>[...ls, { id, source:"Palette study", category:"Palette", note:"", negativePrompt:"", manual:true, autoNamed:true }]);
    return id;
  };
  const deleteLookbookCard = (id)=>{
    setLookbook(ls=>ls.filter(c=>c.id!==id));
    try{ if(typeof nbClearAsset==="function") nbClearAsset(id); }catch(e){}
  };
  // Remove the whole Lookbook (references + statement + their mood frames). Art Room state only —
  // never touches the story or any other tab; lookbookApplied is left intact so the tabs that
  // absorbed the lookbook correctly flag as out-of-date (re-draft to purge the influence).
  const clearLookbook = async ()=>{
    const n = (lookbook||[]).length;
    if(!n && !((lookbookNote||"").trim())) return;
    let ok = true;
    if(typeof window.appConfirm==="function"){
      ok = await window.appConfirm({ title:"Clear the whole Lookbook?",
        body:"This removes all references and the visual statement (and their mood frames). It doesn't touch your story or any other tab — but tabs you already drafted will show as out-of-date so you can re-draft to remove what they absorbed.",
        confirmLabel:"Clear lookbook", danger:true });
    }
    if(!ok) return;
    (lookbook||[]).forEach(c=>{ try{ if(typeof nbClearAsset==="function") nbClearAsset(c.id); }catch(e){} });
    setLookbook([]);
    setLookbookNote("");
  };

  // ---- Art Room: PROPS ----
  const updateProp = (id,patch)=>{
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
  const addProp = ()=>{
    const id = "prop-"+Date.now().toString(36);
    setProps(ps=>[...ps, { id, name:"New prop", kind:"carried", ownerId:"", ownerName:"",
      form:"", material:"", detail:"", renderStyle:"", negativePrompt:"", manual:true,
      origin:(typeof artRoomPropOrigin==="function") ? artRoomPropOrigin("carried","manual") : {kind:"manual"} }]);
  };
  const deleteProp = (id)=>{
    const p = (props||[]).find(x=>x.id===id); if(!p) return;
    setProps(ps=>ps.filter(x=>x.id!==id));
    setTrash(t=>({ ...t, props:[ _trashStamp(p), ...(t.props||[]).filter(x=>x.id!==id) ] }));
  };
  const restoreProp = (id)=>{
    const item = (trash.props||[]).find(x=>x.id===id); if(!item) return;
    const { _deletedAt, ...clean } = item;
    setProps(ps=> ps.some(p=>p.id===id) ? ps : [...ps, clean]);
    setTrash(t=>({ ...t, props:(t.props||[]).filter(x=>x.id!==id) }));
  };
  const purgeProp = async (id)=>{
    const item = (trash.props||[]).find(x=>x.id===id);
    if(!item) return;
    try{
      if(typeof nbClearAsset==="function"){
        const ids = [id, ...(item.states||[]).map(st=>id+":"+st.id)];
        for(const assetId of ids) await nbClearAsset(assetId);
      }
      setTrash(t=>({ ...t, props:(t.props||[]).filter(x=>x.id!==id) }));
    }catch(e){ if(window.appToast) window.appToast("Couldn't permanently delete this prop's assets. It remains in Trash so you can retry.","error"); }
  };
  // merge a set of duplicate prop cards (same owner + same object) into ONE: keep the
  // richest card (most scenes, then one with a generated sheet, then longest name),
  // union the scene coverage, backfill any empty spec fields from the others, and
  // delete the rest. Non-destructive to the survivor's own image/spec.
  const mergeProps = (ids, survivorId)=>{
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
    ["form","material","detail","renderStyle"].forEach(f=>{
      if(!String(survivor[f]||"").trim()){ const donor = others.find(o=>String(o[f]||"").trim()); if(donor) patch[f]=donor[f]; }
    });
    setProps(ps=>ps.map(p=> p.id===survivor.id ? {...p, ...patch} : p).filter(p=> p.id===survivor.id || ids.indexOf(p.id)<0));
    others.forEach(o=>{ try{ if(typeof nbClearAsset==="function") nbClearAsset(o.id); }catch(e){} });
  };
  // prop card + its generated sheet from the Props tab (the card confirms first).
  // Match on owner + normalised name so it stays in sync with prop-seeding.
  const removeOwnedProp = (charId, itemText)=>{
    const norm = s=> String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40);
    const target = norm(itemText);
    if(!charId || !target) return;
    setProps(ps=>{
      const victims = ps.filter(p=> p.ownerId===charId && norm(p.name)===target);
      victims.forEach(p=>{ try{ if(typeof nbClearAsset==="function") nbClearAsset(p.id); }catch(e){} });
      return victims.length ? ps.filter(p=>!victims.includes(p)) : ps;
    });
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
      window.appToast(patches.length+" character card"+(patches.length>1?"s":"")+" tidied automatically — carried objects (bags, phones, documents) moved off the worn list; their prop cards are now carried-type.","info");
  },[characters, hydrationTick]);
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
      return changed ? next.join(", ") : null;
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
    if(!(typeof aiPropVisuals==="function")) return;
    if(draftingPropIdsRef.current.indexOf(pr.id)>=0) return;   // this prop already drafting
    setDraftingPropIds(ids=> ids.indexOf(pr.id)>=0 ? ids : [...ids, pr.id]);
    try{
      const res = await aiPropVisuals(pr, characters, lbProject("props"));
      if(res){ updateProp(pr.id, keepPickedStyle(pr, res)); markApplied("props"); }
    }catch(e){}
    setDraftingPropIds(ids=> ids.filter(x=>x!==pr.id));
  };
  // "Draft all props" — the full props pipeline in one click:
  //   1) SYNC any missing cards from the cast (worn/carried, dedup by owner+name)
  //   2) DRAFT every card's spec (form/material/significance/look dev) from the script
  //   3) MAP every card to the scenes it appears in (worn -> owner presence, carried -> AI)
  // Replaces the old separate "Pull from cast" + "Re-map scenes" buttons.
  const draftAllProps = async ()=>{
    if(draftingAllProps) return;
    setDraftingAllProps(true);
    try{
      // 1) sync from cast
      let working = props;
      if(typeof propsFromCast==="function"){
        const derived = propsFromCast(characters, props, scenes, drafts);
        if(derived.length){ working = [...props, ...derived]; setProps(working); setPropsSeeded(true); }
      }
      // 2) draft specs
      if(typeof aiDesignPropBible==="function" && working.length){
        const map = await aiDesignPropBible(working, characters, lbProject("props"));
        if(map){ working = working.map(p=> map[p.id] ? {...p, ...keepPickedStyle(p, map[p.id])} : p);
          setProps(ps=>ps.map(p=> map[p.id] ? {...p, ...keepPickedStyle(p, map[p.id])} : p)); }
      }
      // 3) map scenes
      if(typeof aiPropScenes==="function" && working.length){
        const smap = await aiPropScenes(working, scenes, drafts, characters);
        if(smap) setProps(ps=>ps.map(p=> smap[p.id] ? withEpisodeSceneRefs(p,smap[p.id],scenes) : p));
      }
      if(working.length) markApplied("props");
    }catch(e){}
    setDraftingAllProps(false);
  };
  // Pull standalone prop cards out of the cast's existing "Props & accessories"
  // fields (worn -> kind "worn", carried -> kind "carried"). Dedups against
  // what's already in the tab, so it's safe to call repeatedly.
  const seedPropsFromCast = React.useCallback(()=>{
    if(typeof propsFromCast!=="function") return;
    const derived = propsFromCast(characters, props, scenes, drafts);
    setPropsSeeded(true);
    if(derived.length) setProps(ps=>[...ps, ...derived]);
  },[characters, props]);
  // auto-seed once per story: when you first open the Art Room with an empty
  // Props tab while the cast already carries items, fill it from them.
  React.useEffect(()=>{
    if(propsSeeded || hydratingRef.current) return;
    if(room!=="art" || artView!=="props") return;
    if(props.length) { setPropsSeeded(true); return; }   // user already has props -> don't auto-pull
    if(typeof castHasProps==="function" && castHasProps(characters)) seedPropsFromCast();
  },[room, artView, propsSeeded, props.length, characters, seedPropsFromCast, hydrationTick]);

  /* INITIAL CHARACTER -> WORN PROP BOOTSTRAP
     The first committed identity sheet is the best visual seed for accessories that
     belong on that character. Build those prop sheets in the background immediately,
     then let the existing dependency snapshot mark the character master out of date.
     Carried props are deliberately excluded: they bind at the shot where they appear. */
  React.useEffect(()=>{
    window.__turnWornPropBootstrap = window.__turnWornPropBootstrap || {};
    const onCharacterSheetDone = async (e)=>{
      const charId = e && e.detail && e.detail.id;
      const character = (characters||[]).find(c=>c && c.id===charId);
      if(!character || !canMutateSharedFilm()) return;
      // nb-gen-done also announces clears/restores. Start only after a real identity
      // image has committed, never from an empty completion event.
      const identityUrl = (e && e.detail && e.detail.url) || await _imgOf(charId);
      if(!identityUrl) return;
      const prior = character.wornPropBootstrap || {};
      if(prior.status==="complete" || window.__turnWornPropBootstrap[charId]) return;
      // A persisted running flag from an interrupted browser session may retry later.
      if(prior.status==="running" && prior.startedAt
        && Date.now()-new Date(prior.startedAt).getTime()<30*60*1000) return;

      const derived = (typeof propsFromCast==="function")
        ? propsFromCast(characters, props, scenes, drafts)
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
      if(draftedAny) markApplied("props");
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
      if(gate.ok){
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
      markApplied("props");
    };
    window.addEventListener("nb-gen-done",onCharacterSheetDone);
    window.addEventListener("nb-prop-drafted",onPropDrafted);
    return ()=>{ window.removeEventListener("nb-gen-done",onCharacterSheetDone);
      window.removeEventListener("nb-prop-drafted",onPropDrafted); };
  },[characters, props, scenes, drafts, project, lookbook, lookbookNote]);

  // auto-draft the cast once per story: the FIRST time the Art Room opens (any tab),
  // silently fill the spec for any undrafted character so the user can go straight
  // to Props → generate → Characters → generate without a manual "Draft all" step.
  // Guarded so it only ever attempts once and never overwrites drafted/edited cards.
  const _autoDraftTried = React.useRef(false);   // once per SESSION guard (never loops)
  React.useEffect(()=>{
    if(visualsSeeded || hydratingRef.current) return;
    if(room!=="art") return;
    if(!characters.length) return;                 // wait for hydration
    if(_autoDraftTried.current) return;
    _autoDraftTried.current = true;
    const drafted = (typeof window.charVisualsDrafted==="function") ? window.charVisualsDrafted : (()=>true);
    if(!characters.some(c=>!drafted(c))){ setVisualsSeeded(true); return; }
    // latch the per-story flag ONLY when specs actually landed — a failed attempt
    // (model unreachable, cast mid-hydration after a rebuild) used to latch forever
    // and strand the user on a wall of manual draft buttons
    Promise.resolve(draftAllVisuals()).then((ok)=>{ if(ok) setVisualsSeeded(true); });
  },[room, visualsSeeded, characters, hydrationTick]);
  // map each prop to the scenes it appears in (worn -> owner presence, carried -> AI exact)
  const [taggingScenes, setTaggingScenes] = React.useState(false);
  const tagPropScenes = async ()=>{
    if(taggingScenes || !(typeof aiPropScenes==="function") || !props.length) return;
    setTaggingScenes(true);
    try{
      const map = await aiPropScenes(props, scenes, drafts, characters);
      if(map) setProps(ps=>ps.map(p=> map[p.id] ? withEpisodeSceneRefs(p,map[p.id],scenes) : p));
    }catch(e){}
    setTaggingScenes(false);
  };
  // re-map ONE prop's scenes (without re-drafting its spec) — per-card action
  const [taggingSceneId, setTaggingSceneId] = React.useState(null);
  const tagOnePropScenes = async (p)=>{
    if(taggingSceneId || !p || !(typeof aiPropScenes==="function")) return;
    setTaggingSceneId(p.id);
    try{
      const map = await aiPropScenes([p], scenes, drafts, characters);
      const next = (map && map[p.id]) ? map[p.id] : [];
      setProps(ps=>ps.map(x=> x.id===p.id ? withEpisodeSceneRefs(x,next,scenes) : x));
    }catch(e){}
    setTaggingSceneId(null);
  };

  /* AUTO RE-MAP — a screenplay or scene-list change (edits, polish, undo/redo,
     scene add/delete/reorder, import) silently stales every PINNED
     prop→scene map, and those maps decide what rides into shots and how states
     and custody resolve. Debounced re-derivation of pinned maps ONLY — unmapped
     props derive live (effMap: owner presence / name-matching) and never go
     stale. A prop the re-map EXPLICITLY empties (it HAD appearances, now it has
     none — a scene cut or a removed mention) is park-deleted to trash with a
     toast: recoverable, same rule as the sub-space fold, never hard-deleted.
     Set dressing is exempt from the cull — it belongs to its location, not to
     scene presence. Fail-safes: any mapper failure/no-op leaves every card
     untouched (the AI's parse-failure fallback is owner-presence, never a false
     empty), and a prop whose map changed mid-flight (e.g. a manual Re-map
     during the await) is skipped — the next debounced pass reconciles it. */
  const propsRef = React.useRef([]); propsRef.current = props;
  const charactersRef = React.useRef([]); charactersRef.current = characters;
  const tagBusyRef = React.useRef(false);
  tagBusyRef.current = !!(taggingScenes || taggingSceneId || draftingAllProps);
  const autoRetagRef = React.useRef(false);
  React.useEffect(()=>{
    if(readOnlyShare) return;
    if(typeof aiPropScenes!=="function") return;
    const t = setTimeout(async ()=>{
      if(hydratingRef.current || tagBusyRef.current || autoRetagRef.current) return;
      const pinned = (propsRef.current||[]).filter(p=> p && Array.isArray(p.scenes));
      if(!pinned.length) return;
      autoRetagRef.current = true;
      const base = {}; pinned.forEach(p=>{ base[p.id] = p.scenes.join("|"); });   // mid-flight change detector
      // EPOCH gate — the screenplay/scene set identity at send time. If either
      // moves during the AI await (another edit, undo, scene delete — which also
      // schedules a FRESH debounced pass), this result is stale: applying it
      // could trash a prop the newer script still uses. Abort instead; the
      // newer pass reconciles.
      const draftsEpoch = draftsRef.current, scenesEpoch = scenesRef.current;
      try{
        const map = await aiPropScenes(pinned, scenesRef.current, draftsRef.current, charactersRef.current);
        if(!map) return;
        // revalidate at APPLY time: script moved, or a manual Re-map / Design all
        // props started while we awaited — either way this pass must not land.
        if(draftsRef.current!==draftsEpoch || scenesRef.current!==scenesEpoch) return;
        if(tagBusyRef.current || hydratingRef.current) return;
        const gone = [];
        setProps(ps=>{
          const fresh = (p)=> p && Array.isArray(p.scenes) && (p.id in map) && p.scenes.join("|")===base[p.id];
          const nextOf = (p)=> Array.isArray(map[p.id]) ? map[p.id] : [];
          const keep = ps.filter(p=>{
            if(!fresh(p)) return true;
            const next = nextOf(p);
            // cull only when the empty verdict is well-founded: the prop had
            // appearances, it isn't set dressing (belongs to its location), and
            // it HAS an owner — ownerless carried props get "candidate scenes:
            // none" from the mapper, which biases the AI toward empty, so an
            // empty verdict there is weak evidence and never trashes.
            if(!currentShowId && !next.length && p.scenes.length && (p.kind||"carried")!=="dressing" && (p.ownerId||p.ownerName)){ gone.push(p); return false; }
            return true;
          });
          return keep.map(p=>{
            if(!fresh(p)) return p;
            const next = nextOf(p);
            return (next.join("|")===p.scenes.join("|")) ? p : withEpisodeSceneRefs(p,next,scenesEpoch);
          });
        });
        if(gone.length){
          setTrash(t2=>({ ...t2, props:[ ...gone.map(_trashStamp), ...(t2.props||[]).filter(x=> x && !gone.some(g=>g.id===x.id)) ] }));
          try{ if(window.appToast) window.appToast(
            gone.map(p=>p.name||"Untitled prop").join(", ")+" no longer appear"+(gone.length>1?"":"s")+" in the script — moved to trash (recoverable)","info");
          }catch(e){}
        }
      }catch(e){}
      finally{ autoRetagRef.current = false; }
    }, 2500);
    return ()=> clearTimeout(t);
  },[drafts, scenes, currentShowId, currentProjectId]);

  // ---- Art Room: LOCATIONS ----
  const updateLocation = (id,patch)=>setLocations(ls=>ls.map(l=>l.id===id?{...l,...patch}:l));
  // per-card location drafts run CONCURRENTLY — a set of ids currently drafting, so you
  // can fire "Draft & Generate" on several locations at once (not one-at-a-time).
  const [draftingLocIds, setDraftingLocIds] = React.useState([]);
  const draftingLocIdsRef = React.useRef([]); draftingLocIdsRef.current = draftingLocIds;
  const [draftingAllLocs, setDraftingAllLocs] = React.useState(false);
  const [assigningStyles, setAssigningStyles] = React.useState(false);
  const addLocation = ()=>{
    const id = "loc-"+Date.now().toString(36);
    setLocations(ls=>[...ls, { id, key:id, name:"New location", intExt:"INT", times:[], areas:[], scenes:[],
      scope:"atomic",parentKey:"",continuityRootKey:id,
      architecture:"",materials:"",lighting:"",permanentDressing:"",topology:"",continuityAnchors:"",anchorsLocked:true,
      provenance:{},significance:"",renderStyle:"",negativePrompt:"",variants:[],manual:true }]);
  };
  const deleteLocation = (id)=>{
    const l = (locations||[]).find(x=>x.id===id); if(!l) return;
    setLocations(ls=>ls.filter(x=>x.id!==id));
    setTrash(t=>({ ...t, locations:[ _trashStamp(l), ...(t.locations||[]).filter(x=>x.id!==id) ] }));
  };
  const restoreLocation = (id)=>{
    const item = (trash.locations||[]).find(x=>x.id===id); if(!item) return;
    const { _deletedAt, ...clean } = item;
    setLocations(ls=> ls.some(l=>l.id===id) ? ls : [...ls, clean]);
    setTrash(t=>({ ...t, locations:(t.locations||[]).filter(x=>x.id!==id) }));
  };
  const purgeLocation = async (id)=>{
    const item = (trash.locations||[]).find(x=>x.id===id);
    if(!item) return;
    try{
      if(typeof nbClearAsset==="function"){
        const ids = [id,
          ...(item.variants||[]).map(v=>id+"-"+v.id),
          ...(item.coverageSheets||[]).map(v=>id+"-"+v.id)];
        // Slugline-unit plates are descendants of their master location even though
        // their stable IDs key from the screenplay heading rather than the card ID.
        (sluglineUnits||[]).forEach(u=>{
          if(u && u.locationKey===(item.key||item.id) && typeof sluglineUnitImageId==="function")
            ids.push(sluglineUnitImageId(u.key));
        });
        for(const assetId of Array.from(new Set(ids))) await nbClearAsset(assetId);
      }
      setTrash(t=>({ ...t, locations:(t.locations||[]).filter(x=>x.id!==id) }));
    }catch(e){ if(window.appToast) window.appToast("Couldn't permanently delete this location's descendant assets. It remains in Trash so you can retry.","error"); }
  };
  const draftLocationVisuals = async (l)=>{
    if(!(typeof aiLocationVisuals==="function")) return;
    if(draftingLocIdsRef.current.indexOf(l.id)>=0) return;   // this location already drafting
    setDraftingLocIds(ids=> ids.indexOf(l.id)>=0 ? ids : [...ids, l.id]);
    try{
      const fields = await aiLocationVisuals(l, scenes, lbProject("locations"));
      if(fields){ setLocations(ls=>ls.map(x=>x.id===l.id?{...x, ...keepPickedStyle(x, fields)}:x)); markApplied("locations"); }
    }catch(e){}
    setDraftingLocIds(ids=> ids.filter(x=>x!==l.id));
  };
  // "Draft all locations" — the full locations pipeline in one click:
  //   1) PULL missing master places from screenplay scene headings (+ refresh scene lists)
  //      and let each card derive implied INT/EXT side coverage from scene body text
  //   2) DRAFT every card's spec (The space + Significance + Look dev) from the script
  //   3) STAGE each location's depth grid off the freshly-designed space
  // Replaces the old separate "Pull from script" button.
  const draftAllLocations = async ()=>{
    if(draftingAllLocs || !(typeof aiDesignLocationBible==="function")) return;
    setDraftingAllLocs(true);
    try{
      // 1) pull missing + refresh scene lists on existing
      let working = locations;
      if(typeof deriveLocations==="function"){
        const derived = deriveLocations(scenes, locations, drafts);   // places not yet present (incl. mid-scene slugs)
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
      // 2) draft specs
      const map = await aiDesignLocationBible(working, scenes, lbProject("locations"));
      const merged = working.map(l=> (map && map[l.id]) ? {...l, ...keepPickedStyle(l, map[l.id])} : l);
      if(map) setLocations(ls=>ls.map(l=> map[l.id] ? {...l, ...keepPickedStyle(l, map[l.id])} : l));
      // 3) depth-grid staging — only for places the film revisits (2+ scenes), where
      // cross-scene geometric continuity pays off; single-scene locations skip it and
      // render fine from prose (a card's "Draft staging" button stages one on demand).
      if(typeof aiDraftStaging==="function"){
        const stageTargets = merged.filter(l=>(l.scenes||[]).length>=2);
        const stages = await Promise.all(stageTargets.map(async l=>{
          try{ return { id:l.id, staging: await aiDraftStaging(l, scenes, project) }; }
          catch(e){ return { id:l.id, staging:null }; }
        }));
        const sMap = {}; stages.forEach(x=>{ if(x.staging) sMap[x.id]=x.staging; });
        if(Object.keys(sMap).length) setLocations(ls=>ls.map(l=> sMap[l.id] ? {...l, staging:sMap[l.id]} : l));
      }
      if(working.length) markApplied("locations");
    }catch(e){}
    setDraftingAllLocs(false);
  };
  // draft a location's depth-grid staging from the script
  const [draftingStageId, setDraftingStageId] = React.useState(null);
  const draftLocationStaging = async (l)=>{
    if(draftingStageId || !(typeof aiDraftStaging==="function")) return;
    setDraftingStageId(l.id);
    try{
      const staging = await aiDraftStaging(l, scenes, project);
      if(staging) setLocations(ls=>ls.map(x=>x.id===l.id?{...x, staging}:x));
    }catch(e){}
    setDraftingStageId(null);
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
    setTrash(t=>({ ...t, locations:[ ...finalTrash.map(_trashStamp), ...(t.locations||[]) ] }));
    setLocations(cur=>cur.filter(x=> x && !finalTrash.some(y=>y.id===x.id)));
    try{ if(window.appToast){
      const moved = finalTrash.filter(t=>movedIds[t.id]).map(t=>t.name);
      const folded = finalTrash.filter(t=>!movedIds[t.id]).map(t=>t.name);
      const parts = [];
      if(moved.length) parts.push(moved.join(", ")+" (plate moved onto its slugline unit)");
      if(folded.length) parts.push(folded.join(", "));
      window.appToast("Folded "+parts.join(" and ")+" into its parent location — card"+(finalTrash.length>1?"s are":" is")+" in trash (recoverable)");
    } }catch(e){}
  };
  // derive master locations from screenplay scene headings; coverage sheets handle
  // implied sub-locations/sides described inside the scene body
  const pullLocationsFromScript = React.useCallback(()=>{
    if(typeof deriveLocations!=="function") return;
    const derived = deriveLocations(scenes, locations, drafts);
    setLocsSeeded(true);
    if(derived.length) setLocations(ls=>[...ls, ...derived.map(l=>withEpisodeLocationMeta(l,l))]);
    // also refresh the scene lists on existing locations as the script grows
    else if(locations.length){
      const fresh = deriveLocations(scenes, [], drafts);
      setLocations(ls=>ls.map(l=>{ const m=fresh.find(f=>f.key===l.key); return m?withEpisodeLocationMeta(l,{...m,
        times:[...new Set([...(l.times||[]),...(m.times||[])])],
        areas:[...new Set([...(l.areas||[]),...(m.areas||[])])]}) : l; }));
    }
  },[scenes, locations, drafts, currentShowId, currentProjectId]);
  // auto-seed once per story: first time the Locations tab opens empty, derive them
  React.useEffect(()=>{
    if(locsSeeded || hydratingRef.current) return;
    if(room!=="art" || artView!=="locations") return;
    if(locations.length){ setLocsSeeded(true); return; }
    if(typeof scriptHasLocations==="function" && scriptHasLocations(scenes)) pullLocationsFromScript();
  },[room, artView, locsSeeded, locations.length, scenes, pullLocationsFromScript, hydrationTick]);
  // LOCATION HIERARCHY SYNC — grouping now establishes inheritance instead of
  // disposing of child cards. Restore a previously folded child from recoverable
  // Trash when possible; otherwise derive the missing child with its stable ID.
  // Existing specs, plates, staging and histories remain on their original records.
  React.useEffect(()=>{
    if(hydratingRef.current || !scenes.length || !locations.length) return;
    if(typeof deriveLocations!=="function") return;
    const fresh=deriveLocations(scenes,[],drafts);
    if(!fresh.length) return;
    const freshByKey={}; fresh.forEach(x=>{ if(x&&x.key) freshByKey[x.key]=x; });
    const currentKeys=new Set((locations||[]).map(x=>x&&x.key).filter(Boolean));
    const restore=(trash.locations||[]).filter(x=>x&&freshByKey[x.key]&&!currentKeys.has(x.key));
    const restoreKeys=new Set(restore.map(x=>x.key));
    const missing=fresh.filter(x=>!currentKeys.has(x.key)&&!restoreKeys.has(x.key));
    let changed=!!(restore.length||missing.length);
    const next=(locations||[]).map(l=>{
      const f=l&&freshByKey[l.key]; if(!f) return l;
      const synced=withEpisodeLocationMeta(l,f);
      const fields=["scope","parentKey","continuityRootKey","scenes","episodeScenes","times","areas","intExt","episodeLocationMeta"];
      const same=fields.every(k=>JSON.stringify(l[k])===JSON.stringify(synced[k]));
      if(same) return l; changed=true; return synced;
    });
    restore.forEach(item=>{ const {_deletedAt,...clean}=item, f=freshByKey[item.key];
      // restored authored/generated fields win over the empty derived shell
      const restored={...clean,...f,...clean};
      next.push(withEpisodeLocationMeta(restored,f)); });
    missing.forEach(item=>next.push(withEpisodeLocationMeta(item,item)));
    if(changed) setLocations(next);
    if(restore.length) setTrash(t=>({...t,locations:(t.locations||[]).filter(x=>!restoreKeys.has(x&&x.key))}));
  },[locations, scenes, drafts, trash.locations, currentShowId, currentProjectId]);
  // read the whole film, design a BESPOKE per-film palette and color-script it
  // along the value-charge spine (see aiAssignSceneStyles).
  // merge an aiAssignSceneStyles result into project.styleBible. Shared by the quick
  // "Assign from script" button AND the explainable Colorist agent (on approval).
  const applyStyleResult = (res, seed)=>{
    if(!res) return;
    setProject(p=>{
      const sb = (p.styleBible)||{};
      // A bespoke per-film palette REPLACES the generic starter set (deduped by id)
      // so each film looks unique; fall back to the existing/seed presets if none.
      const bespoke = (res.presets&&res.presets.length) ? res.presets : null;
      let presets, sceneStyles;
      if(bespoke){
        const byId = {}; bespoke.forEach(p=>{ byId[p.id]=p; });
        presets = Object.values(byId);
        // drop any prior assignment whose preset no longer exists, then overlay the color-script.
        const validIds = new Set(presets.map(p=>p.id));
        const kept = {}; Object.entries(sb.sceneStyles||{}).forEach(([sid,pid])=>{ if(validIds.has(pid)) kept[sid]=pid; });
        sceneStyles = {...kept, ...(res.sceneStyles||{})};
      } else {
        presets = (sb.presets&&sb.presets.length) ? sb.presets : (seed||sb.presets||[]);
        sceneStyles = {...(sb.sceneStyles||{}), ...(res.sceneStyles||{})};
      }
      // the model also picks the film stock; preserve other styleBible fields (refs etc.).
      const filmStock = res.filmStock || sb.filmStock || "none";
      return {...p, styleBible:{ ...sb, presets, sceneStyles, filmStock,
        ...(res.writingProvenance?{writingProvenance:{...res.writingProvenance}}:{}) }};
    });
  };
  const assignSceneStyles = async ()=>{
    if(assigningStyles || !(typeof aiAssignSceneStyles==="function")) return;
    setAssigningStyles(true);
    try{
      const sb = (typeof styleBibleOf==="function") ? styleBibleOf(project) : {};
      const seed = (sb.presets&&sb.presets.length) ? sb.presets : (window.STYLE_PRESETS_DEFAULT||[]);
      // the Lookbook's colorist brief is auto-synced into styleBible.lookbookRefs (see the
      // write-through effect); aiAssignSceneStyles reads it alongside the manual refs.
      const res = await aiAssignSceneStyles(scenes, seed, drafts, project);
      applyStyleResult(res, seed);
      if(res) markApplied("colorist");
    }catch(e){}
    setAssigningStyles(false);
  };
  // the user's free-text visual references that steer bespoke palette design
  const setStyleRefs = (refs)=> setProject(p=>({ ...p, styleBible:{ ...((p.styleBible)||{}), refs:String(refs||"") } }));
  // uploaded reference images (palette sampled client-side); capped to keep state light
  const addStyleRefImages = (imgs)=> setProject(p=>{ const sb=(p.styleBible)||{};
    return { ...p, styleBible:{ ...sb, refImages:[...(sb.refImages||[]), ...(imgs||[])].slice(0,8) } }; });
  const removeStyleRefImage = (id)=> setProject(p=>{ const sb=(p.styleBible)||{};
    return { ...p, styleBible:{ ...sb, refImages:(sb.refImages||[]).filter(r=>r.id!==id) } }; });
  // manual per-scene preset override (presetId null = unassign). Note: re-running
  // "Assign from script" re-color-scripts every scene and will overwrite these.
  const setScenePreset = (sceneId, presetId)=> setProject(p=>{
    const sb = (p.styleBible)||{};
    const sceneStyles = {...(sb.sceneStyles||{})};
    if(presetId) sceneStyles[sceneId] = presetId; else delete sceneStyles[sceneId];
    return {...p, styleBible:{ ...sb, sceneStyles }};
  });

  // ---- Art Room: SHOT LIST ----
  // Default: one screenplay opening keyframe per beat. Saved alternatives are
  // preserved until an explicit conversion archives them in restorable Trash.
  const updateShot = (id,patch)=>{
    if(!canMutateSharedFilm()) return;
    setShots(ss=>ss.map(s=>{
    if(s.id!==id) return s;
    const next={...s,...patch};
    const before=(typeof shotSpecFingerprint==="function")?shotSpecFingerprint(s):"";
    const after=(typeof shotSpecFingerprint==="function")?shotSpecFingerprint(next):"";
    next.specRev=(typeof shotSpecRevision==="function")?shotSpecRevision(s):(Math.max(1,Number(s.specRev)||1));
    if(before!==after) next.specRev++;
    next.specHash=after;
    return next;
    }));
  };
  const deleteShot = (id)=>{
    const sh = (shots||[]).find(x=>x.id===id); if(!sh) return;
    setShots(ss=>ss.filter(s=>s.id!==id));
    setTrash(t=>({ ...t, shots:[ _trashStamp(sh), ...(t.shots||[]).filter(x=>x.id!==id) ] }));
  };
  const restoreShot = (id)=>{
    const item = (trash.shots||[]).find(x=>x.id===id); if(!item) return;
    const { _deletedAt, ...clean } = item;
    setShots(ss=> ss.some(s=>s.id===id) ? ss : [...ss, clean].sort((a,b)=>
      String(a.sceneId||"").localeCompare(String(b.sceneId||"")) ||
      ((Number(a.beatN)||0)-(Number(b.beatN)||0)) ||
      ((Number(a.order)||0)-(Number(b.order)||0))));
    setTrash(t=>({ ...t, shots:(t.shots||[]).filter(x=>x.id!==id) }));
  };
  const purgeShot = async (id)=>{
    const item = (trash.shots||[]).find(x=>x.id===id);
    if(!item) return;
    try{
      if(typeof nbClearAsset==="function") await nbClearAsset(id);
      setTrash(t=>({ ...t, shots:(t.shots||[]).filter(x=>x.id!==id) }));
    }catch(e){ if(window.appToast) window.appToast("Couldn't permanently delete this shot's asset. It remains in Trash so you can retry.","error"); }
  };

  // ── Phase 2: line audio = the cut clock ──────────────────────────────────────
  // Render a shot's dialogue through its speaker's LOCKED voice; the MEASURED
  // duration becomes the shot's `dur`, which re-clocks the Stage automatically
  // (shotDur prefers dur → sceneSequences / cut-rhythm / runtime all re-partition).
  const [voicingLines, setVoicingLines] = React.useState(null);   // {done,total} during the batch
  const voicingCancel = React.useRef(false);
  const cancelVoiceAll = ()=>{ voicingCancel.current = true; };
  const resolveLineSpeaker = (shot)=>{
    const scene = scenes.find(s=>s.id===shot.sceneId);
    /* the SCREENPLAY names the speaker (the character cue above the line) — trust it
       before any in-frame heuristic, so a two-hander never renders A's line in B's
       voice. Returned even without a voiceLock: the "lock a voice for X" error must
       name the character who actually speaks. */
    if(scene && typeof stageDialogueSpeaker==="function"){
      try{
        const charById = {}; characters.forEach(c=>{ charById[c.id]=c; });
        const sp = stageDialogueSpeaker(scene, drafts, beatsMap, shot, { characters, charById });
        if(sp && sp.id && charById[sp.id]) return charById[sp.id];
      }catch(e){}
    }
    const ids = (typeof inFrameCast==="function") ? inFrameCast(shot, scene, characters) : (shot.subjects||[]);
    const inFrame = (ids||[]).map(id=>characters.find(c=>c.id===id)).filter(Boolean);
    const hasVoice = (c)=> !!(c && c.voiceLock && c.voiceLock.voiceId);
    return inFrame.find(hasVoice)
        || (scene && characters.find(c=>c.id===scene.driver && hasVoice(c)))
        || inFrame[0] || (scene && characters.find(c=>c.id===scene.driver)) || null;
  };
  const voiceOneLine = async (shot)=>{
    const text = String(shot.dialogue||"").trim();
    if(!text) return { skipped:true };
    const spk = resolveLineSpeaker(shot);
    if(!spk || !spk.voiceLock || !spk.voiceLock.voiceId)
      throw new Error("No locked voice for "+((spk&&spk.name)||"the speaker")+" — lock one on their character card: The Art Room → Characters tab → the Voice button.");
    const r = await window.elGenerate(shot.id, text, { voiceId:spk.voiceLock.voiceId, settings:spk.voiceLock.defaults,
      ...characterMediaOptions(spk),
      modelId:(typeof window.vgDeliveryModelOf==="function") ? window.vgDeliveryModelOf(spk.voiceLock) : (spk.voiceLock.modelId||window.VG_TTS_MODEL) });
    const durSec = Math.max(0.6, Math.round(((r.durationMs||0)/1000 + 0.4)*10)/10);   // measured + lead/tail pad
    updateShot(shot.id, { dur:durSec, lineAudio:{ durationMs:r.durationMs||0, voiceId:spk.voiceLock.voiceId,
      speakerId:spk.id, speaker:spk.name, text,
      hash:(typeof window.vgHash==="function" ? window.vgHash(text, spk.voiceLock.voiceId, spk.voiceLock.defaults) : "") } });
    return { ok:true, durSec, cached:r.cached };
  };
  const voiceLine = async (shot)=>{
    try{ const r = await voiceOneLine(shot); if(r && r.ok && !r.cached && typeof window.appToast==="function") window.appToast("Voiced — "+r.durSec+"s","success"); }
    catch(e){ if(typeof window.appToast==="function") window.appToast(String((e&&e.message)||"Voice render failed."),"error"); }
  };
  const voiceAllLines = async ()=>{
    const lines = shots.filter(s=>String(s.dialogue||"").trim());
    if(!lines.length){ if(typeof window.appToast==="function") window.appToast("No dialogue lines to voice yet."); return; }
    voicingCancel.current=false; setVoicingLines({ done:0, total:lines.length });
    let failed=0;
    for(let i=0;i<lines.length;i++){
      if(voicingCancel.current) break;
      try{ await voiceOneLine(lines[i]); }catch(e){ failed++; }
      setVoicingLines({ done:i+1, total:lines.length });
    }
    setVoicingLines(null);
    if(failed && typeof window.appToast==="function") window.appToast(failed+" line"+(failed>1?"s":"")+" couldn't be voiced — check those characters have a locked voice.","error");
  };
  const addShot = (sceneId, beatN, seed)=>{
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
      const body="Move "+plan.removable.length+" identified micro-beat shot(s) across "+affected.size+" scene(s) in this film to Shots Trash?"
        +" This includes an old primary shot if it still has its original micro-beat mapping. New beat-opening keyframes and manually added shots are kept."
        +" Removed shots stop being active continuity references. Images, version histories and takes are preserved and can be recovered by restoring the shots."
        +" Some beats may be left without a shot. No replacement specifications or images will be generated, and no credits will be spent."
        +(plan.uncertain.length?" "+plan.uncertain.length+" shot(s) with unclear provenance will be left untouched.":"")
        +"\n\n"+previews.join("\n")+(plan.removable.length>previews.length?"\n…and "+(plan.removable.length-previews.length)+" more.":"");
      // Without a confirmation surface, fail closed rather than remove on click.
      if(typeof window.appConfirm!=="function") throw new Error("Cleanup needs a confirmation dialog. Nothing was removed.");
      const confirmed=await window.appConfirm({title:"Remove old micro-beat shots?",body,
        confirmLabel:"Move to Shots Trash",cancelLabel:"Cancel",danger:true});
      if(!confirmed) return;
      assertCurrent();
      const ids=new Set(plan.removable.map(sh=>sh.id));
      const archived=plan.removable.map(_trashStamp);
      const remaining=shotsLiveRef.current.filter(sh=>!ids.has(sh.id));
      setTrash(t=>({...t,shots:[...archived,...(t.shots||[]).filter(sh=>!ids.has(sh.id))]}));
      shotsLiveRef.current=remaining;
      setShots(remaining);
      if(window.appToast) window.appToast(archived.length+" micro-beat shot(s) moved to Shots Trash. Images and takes were kept; no replacements were generated.","ok");
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
          : ". This deletes the exact image shown, plus identifiable saved reference copies of it, from this film's image storage. It cannot be restored from Shots Trash.")
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
      if(!canMutateSharedFilm()) throw new Error("You no longer have permission to change this film.");
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
          +(existing.length>1?" The "+(existing.length-1)+" additional shot(s) move to Shots Trash, where you can restore them.":"")
          +" No images or takes are deleted. Writing-model credits only; frame generation is separate.";
        const ok=typeof window.appConfirm==="function"
          ? await window.appConfirm({title:"Draft specification for Beat "+beatN+"?",body,confirmLabel:"Draft specification",cancelLabel:"Cancel"})
          : window.confirm(body);
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
      if(window.appToast) window.appToast("Specification ready for Beat "+beatN+". "+(result.archived.length?"Additional shots were kept in Shots Trash. ":"")+"No image was generated. Generate the frame when you're ready.","ok");
    }catch(e){ if(window.appToast) window.appToast(String((e&&e.message)||"Opening-keyframe draft failed."),"error"); }
    finally{ keyframeBusyRef.current.delete(scene.id); setRefiningBeat(null); }
  };
  const splitBeatCoverage = refineBeatFromScreenplay;
  // Derive scene keyframes. Explicit replacement archives alternatives, never media.
  // Returns a STRUCTURED OUTCOME ({status:"designed"|"fallback"|"failed", sceneId, label,
  // error?}) — review finding: a thrown provider error used to vanish silently, leaving
  // the scene shotless with no explanation. Callers surface failures truthfully.
  const draftOneSceneShots = async (scene, replace)=>{
    const label = "Scene "+String(scene.no||"").padStart(2,"0")+(scene.title?(" \u2014 "+scene.title):"");
    if(keyframeBusyRef.current.has(scene.id)) return {status:"failed",sceneId:scene.id,label,error:"This scene already has a keyframe draft running."};
    if(!replace && shotsLiveRef.current.some(sh=>sh.sceneId===scene.id)) return {status:"skipped",sceneId:scene.id,label};
    const assertCurrent=keyframeScope(scene);
    keyframeBusyRef.current.add(scene.id);
    try{
    assertCurrent();
    let made = null; let usedFallback = false;
    if(typeof aiDraftShots==="function"){
      let raw = null;
      try{ raw = await aiDraftShots(scene, beatsMap, drafts, locations, props, characters, lbProject("shots")); }
      catch(e){
        // a THROWN failure (provider/network/key) is reported as a failure — the heuristic
        // stopgap only stands in for a response that arrived but wasn't usable
        return { status:"failed", sceneId:scene.id, label, error:String((e&&e.message)||"Shot design failed.") };
      }
      assertCurrent();
      if(raw && raw.length && typeof normalizeShot==="function"){
        made = raw.map((r,i)=>normalizeShot(r, scene, i, locations, props, characters, beatsMap));
        // VERBATIM ENFORCEMENT (the script is canon): models paraphrase scripted
        // lines no matter the instruction — snap each shot's dialogue to the
        // closest line in the scene's screenplay when they clearly match. Exact
        // lines matter downstream: the Stage voices and clocks clips with them.
        const _dlines = ((drafts[scene.id]&&drafts[scene.id].blocks)||[])
          .filter(b=>b.type==="dia").map(b=>String(b.text||"").replace(/\s+/g," ").trim()).filter(Boolean);
        if(_dlines.length){
          const _toks=(t)=>String(t||"").toLowerCase().replace(/[^a-z0-9' ]/g," ").split(/\s+/).filter(w=>w.length>2);
          made.forEach(sh=>{
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
        }
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
    commitBeatKeyframes(made,assertCurrent);
    return { status:usedFallback?"fallback":"designed", sceneId:scene.id, label };
    }catch(e){ return {status:"failed",sceneId:scene.id,label,error:String(e&&e.message||e)}; }
    finally{ keyframeBusyRef.current.delete(scene.id); }
  };
  const [draftingSceneShots, setDraftingSceneShots] = React.useState(null);
  const draftSceneShots = async (scene)=>{
    if(draftingSceneShots) return;
    setDraftingSceneShots(scene.id);
    let out = null;
    try{
      const assertCurrent=keyframeScope(scene);
      if(shotsLiveRef.current.some(sh=>sh.sceneId===scene.id)){
        const body="Draft one opening keyframe per screenplay beat. Each primary keeps its shot ID and image history. Additional shots move to Shots Trash and can be restored. No images or takes are deleted; changed frames need regeneration. Writing-model credits only.";
        const ok=typeof window.appConfirm==="function"
          ? await window.appConfirm({title:"Update this scene's opening keyframes?",body,confirmLabel:"Update keyframes",cancelLabel:"Cancel"})
          : window.confirm(body);
        if(!ok){ setDraftingSceneShots(null); return; }
        assertCurrent();
      }
      out = await draftOneSceneShots(scene, true);
    }
    catch(e){ out = { status:"failed", error:String((e&&e.message)||"Shot design failed.") }; }
    setDraftingSceneShots(null);
    // say what happened — a failed draft must never look like a quiet no-op
    if(out && typeof window.appToast==="function"){
      if(out.status==="failed") window.appToast("Keyframe design failed for this scene \u2014 "+(out.error||"unknown error"),"error");
      else if(out.status==="fallback") window.appToast("The coverage AI returned nothing usable \u2014 laid out simple one-shot-per-beat coverage as a stopgap. Re-draft to try again.","error");
      else if(out.status==="designed") window.appToast("Opening keyframes updated. Previous images are retained; additional shots are restorable in Shots Trash.","success");
    }
  };
  const [draftingAllShots, setDraftingAllShots] = React.useState(false);
  const draftAllShots = async ()=>{
    if(draftingAllShots) return;
    setDraftingAllShots(true);
    const results = [];
    const epoch=typeof nbEpoch==="function"?nbEpoch():null;
    try{
      const ordered = scenesInStoryOrder(scenes);
      const have = new Set(shots.map(s=>s.sceneId));
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
          +(fb?(" "+fb+" scene"+(fb>1?"s":"")+" used stopgap one-shot-per-beat coverage \u2014 re-draft those to try again."):""),"error");
      } else if(fb){
        window.appToast("All scenes designed, but "+fb+" scene"+(fb>1?"s":"")+" used stopgap one-shot-per-beat coverage \u2014 re-draft those to try again.","error");
      } else {
        window.appToast("Shot design complete \u2014 all "+results.length+" scene"+(results.length>1?"s have":" has")+" coverage.","success");
      }
    }
  };

  // Art Room: suggest a character's appearance states (continuity variants) from the script
  const [suggestingStatesId, setSuggestingStatesId] = React.useState(null);
  const suggestCharacterStates = async (ch)=>{
    if(suggestingStatesId || !(typeof aiSuggestStates==="function")) return;
    setSuggestingStatesId(ch.id);
    const driven = scenes.filter(s=>s.driver===ch.id);
    try{
      const suggested = await aiSuggestStates(ch, driven, project);
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
    const sel = view==="spine" ? ".canvas-scroll.spine-pan"
              : view==="board" ? ".canvas-scroll.board-pan" : null;
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
  const labelOf = (v)=> !v ? null : v.edited ? "Manual edit" : v.polished ? "MUSE polish" : (v.ai ? "MUSE draft" : (v.auto ? "Structural draft" : "Original draft"));

  // SCRIPT SUBTITLE — static explainer (the provenance badge that used to render here
  // was removed by request; engine/version info still lives in the Undo/Redo tooltips).
  const scriptSubtitle = ()=> "Subtext (beats) becomes text (screenplay)";
  // replace a scene's draft, pushing the old version onto its history stack
  // undo depth per scene. CAPPED (like the image layer's 12 versions): every entry is a
  // full screenplay draft and `history` rides in the saved doc, so an uncapped stack grew
  // the doc on every commit — in local mode it eventually blew the localStorage quota and
  // (because that write is a bare try/catch) saves then failed silently forever.
  const HISTORY_MAX = 12;
  const commitVersion = (id, next)=>{
    if(!canMutateWritersRoom()) return false;
    const prev = drafts[id];
    if(prev) setHistory(h=>{ const e=h[id]||{back:[],fwd:[]};
      return {...h,[id]:{ back:[...e.back, prev].slice(-HISTORY_MAX), fwd:[] }}; });
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

  const draftOne = async (s)=>{
    if(!canMutateWritersRoom() || drafts[s.id]) return;
    const ordered=scenesInStoryOrder(scenes);
    const i = ordered.findIndex(x=>x.id===s.id);
    const prev=i>0?ordered[i-1]:null;
    setDrafting({ i:i<0?0:i, total:ordered.length, one:true });
    let scn = s, beats = beatsMap[s.id];
    // a beats-less scene: author the whole scene (summary, charge, beats) first
    // the film this draft belongs to — a scene written after the user switches films
    // must not land in the new one (scene ids repeat across films)
    const owner = currentProjectId;
    if(!beats && typeof aiAuthorScene==="function" && aiAvailable()){
      const authored = await aiAuthorScene(s, prev, characters, project);
      if(owner !== projIdRef.current || !canMutateWritersRoom()){ setDrafting(null); return; }
      if(authored){
        scn = {...s, ...authored.patch}; beats = authored.beats;
        setScenes(ss=>ss.map(x=>x.id===s.id?{...x,...authored.patch}:x));
        setBeatsFor(s.id, authored.beats);
      }
    }
    const res = await aiDraftScene(scn, beats, prev, project);
    if(owner !== projIdRef.current || !canMutateWritersRoom()){ setDrafting(null); return; }
    setDrafts(d=>({...d,[s.id]:res}));
    setDrafting(null);
  };
  const draftAll = async ()=>{
    if(!canMutateWritersRoom() || draftingRef.current) return;
    draftingRef.current = true;
    // One canonical, mutable story-order snapshot for the whole run. When authoring
    // fills a blank scene, patch this working sequence before drafting its successor
    // so continuity never reads the stale render-closure scene.
    const working = scenesInStoryOrder(scenes).map(s=>({...s}));
    const tot = working.length;
    const have = {...drafts};
    const owner = currentProjectId;   // abort the whole run if the user switches films
    try{
      for(let i=0;i<tot;i++){
        if(owner !== projIdRef.current || writersRoomReadOnlyRef.current) break;
        const s = working[i], prev=i>0?working[i-1]:null;
        setDrafting({ i, total:tot });
        if(have[s.id]) continue;
        let scn = s, beats = beatsMap[s.id];
        if(!beats && typeof aiAuthorScene==="function" && aiAvailable()){
          const authored = await aiAuthorScene(s, prev, characters, project);
          if(owner !== projIdRef.current || writersRoomReadOnlyRef.current) break;
          if(authored){
            scn = {...s, ...authored.patch}; working[i]=scn; beats = authored.beats;
            setScenes(ss=>ss.map(x=>x.id===s.id?{...x,...authored.patch}:x));
            setBeatsFor(s.id, authored.beats);
          }
        }
        const res = await aiDraftScene(scn, beats, prev, project);
        if(owner !== projIdRef.current || writersRoomReadOnlyRef.current) break;
        have[s.id] = res;
        setDrafts(d=>({...d,[s.id]:res}));
      }
      setDrafting({ i:tot, total:tot });
      setTimeout(()=>setDrafting(null), 320);
    } finally {
      draftingRef.current = false;
    }
  };
  // polish: regenerate one scene's prose as genuinely new final text (beats locked)
  const [polishBusy, setPolishBusy] = React.useState(null);
  const polishScene = async (s, beatsForScene)=>{
    if(!canMutateWritersRoom()) return false;
    setPolishBusy({ no:s && s.no });
    const ordered=scenesInStoryOrder(scenes);
    const i = ordered.findIndex(x=>x.id===s.id);
    const prev=i>0?ordered[i-1]:null;
    try{
      const structural = autoDraftScene(s, beatsForScene, prev);
      const res = await aiPolishScene(s, beatsForScene, structural.blocks, prev, project);
      if(res && canMutateWritersRoom()){ return commitVersion(s.id, res); }
      return false; // fall back to seed prose animation
    }catch(e){
      return false;
    }finally{
      setPolishBusy(null);
    }
  };

  const sel = scenes.find(s=>s.id===selId) || null;
  const beats = sel ? beatsMap[sel.id] : null;

  // story-health issues that drive the Writers' Room badge + per-agent counts
  const turnIssues = scenes.filter(s=>turnInfo(s).flagged).length;
  const contIssues = (typeof window.continuityReport==="function")
    ? window.continuityReport(scenes, continuityMap, FACTS).conflicts.length : 0;
  const agentIssues = { doctor: turnIssues, continuity: contIssues };
  const totalIssues = turnIssues + contIssues;

  // estimated screen time per scene (≈1 page/min) — drives the spine's pacing readout.
  // "hot" marks scenes that run long against the film's average (the heat signal).
  const runtimeMap = {}; let runtimeTotal = 0;
  if(typeof sceneRuntime==="function") scenes.forEach(s=>{
    const r = sceneRuntime(s, drafts[s.id], beatsMap[s.id]);
    runtimeMap[s.id] = r; runtimeTotal += r.sec;
  });
  const rtAvg = scenes.length ? runtimeTotal/scenes.length : 0;
  Object.values(runtimeMap).forEach(r=>{ r.hot = rtAvg>0 && r.sec > rtAvg*1.75; });

  // ---- editing handlers (scenes + beats) ----
  const [recastBusy, setRecastBusy] = React.useState(null);   // {no, name} while a driver recast runs
  /* DRIVER CHANGED → the labels sync instantly, but the scene's summary, desire
     and beat TEXTS still describe the old driver (prose can't follow a dropdown).
     Offer to RECAST the scene's subtext for the new driver; the screenplay is
     then rebuilt with "Redraft script from beats" so nothing rewrites unseen. */
  const _offerDriverRecast = async (sceneId, oldId, newId)=>{
    if(!canMutateWritersRoom()) return;
    const scn = scenes.find(s=>s.id===sceneId); if(!scn) return;
    const b = beatsMap[sceneId];
    if(!b || !b.rows || !b.rows.length) return;
    if(typeof window.aiRecastDriver!=="function" || !(typeof aiAvailable==="function" && aiAvailable())) return;
    const nameOf = (cid)=>(((characters||[]).find(c=>c.id===cid)||{}).name || String(cid||"").toUpperCase());
    const OLD = nameOf(oldId), NEW = nameOf(newId);
    const ok = await window.appConfirm({ title:"Recast the scene for "+NEW+"?",
      body:"The driver changed ("+OLD+" \u2192 "+NEW+"), but Scene "+scn.no+"\u2019s summary, desire and beat texts still describe "+OLD+" doing the driving. Rewrite the subtext so "+NEW+" drives? You review the beats, then \u2018Redraft script from beats\u2019 rebuilds the screenplay.",
      confirmLabel:"Recast for "+NEW, cancelLabel:"Keep the text as is" });
    if(!ok) return;
    setRecastBusy({ no:scn.no, name:NEW });
    try{
      const res = await window.aiRecastDriver(scn, b, characters, newId, oldId, project);
      if(res && canMutateWritersRoom()){
        updateScene(sceneId, { ...(res.summary?{summary:res.summary}:{}), ...(res.objective?{objective:res.objective}:{}) });
        setBeatsMap(m=>{ const cur=m[sceneId]||b; return { ...m, [sceneId]:{ ...cur, driverLabel:NEW,
          desire:res.desire||cur.desire, obstacle:res.obstacle||cur.obstacle, result:res.result||cur.result, rows:res.rows||cur.rows } }; });
        if(typeof window.appToast==="function")
          window.appToast("Scene "+scn.no+" recast for "+NEW+" \u2014 review the beats, then \u2018Redraft script from beats\u2019 to rebuild the screenplay.","ok");
      } else if(typeof window.appToast==="function")
        window.appToast("Couldn\u2019t recast the scene \u2014 the writing model may be unreachable.","error");
    }catch(e){ if(typeof window.appToast==="function") window.appToast("Couldn\u2019t recast: "+((e&&e.message)||"error"),"error"); }
    setRecastBusy(null);
  };
  const updateScene = (id,patch)=>{
    if(!canMutateWritersRoom()) return;
    const before = patch.driver ? ((scenes.find(s=>s.id===id)||{}).driver) : null;
    setScenes(ss=>ss.map(s=>s.id===id?{...s,...patch}:s));
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
        conf:1, kind:"normal", driver:defDriver, objective:"", turningPoint:"" };
      const out = ss.slice(); out.splice((i<0?ss.length-1:i)+1, 0, ns); return renum(out);
    });
    setSelId(id);
  };
  const deleteScene = (id)=>{
    if(!canMutateWritersRoom()) return;
    const i = scenes.findIndex(s=>s.id===id);
    const remaining = scenes.filter(s=>s.id!==id);
    if(!remaining.length) return;
    const nxt = remaining[Math.min(i, remaining.length-1)];
    setScenes(renum(remaining));
    setBeatsMap(m=>{ const n={...m}; delete n[id]; return n; });
    setDrafts(d=>{ const n={...d}; delete n[id]; return n; });
    // drop the scene's version history and continuity entry too — left behind they bloat
    // the saved doc forever, and a later scene that reuses the id would inherit a dead
    // scene's undo stack (pressing Undo on a new blank scene restored someone else's text)
    setHistory(h=>{ if(!h[id]) return h; const n={...h}; delete n[id]; return n; });
    setContinuityMap(c=>{ if(!c || !c[id]) return c; const n={...c}; delete n[id]; return n; });
    setSelId(nxt ? nxt.id : null);
  };
  const reorderScenes = (fromIdx,toIdx)=>{
    if(!canMutateWritersRoom()) return;
    setScenes(ss=>{
      if(toIdx<0||toIdx>=ss.length||fromIdx===toIdx||fromIdx<0) return ss;
      const out=ss.slice(); const [m]=out.splice(fromIdx,1); out.splice(toIdx,0,m); return renum(out);
    });
  };
  const moveScene = (id,dir)=>{ const i=scenes.findIndex(s=>s.id===id); reorderScenes(i,i+dir); };
  const setBeatsFor = (sceneId,next)=>{
    if(!canMutateWritersRoom()) return;
    const identified=(typeof withBeatIdentity==="function")?withBeatIdentity(next,sceneId):next;
    setBeatsMap(m=>({...m,[sceneId]:identified}));
  };

  const onFixScene = (scene)=>{
    const target = scene.openCharge >= 0 ? Math.max(-3, scene.openCharge-2) : Math.min(3, scene.openCharge+2);
    updateScene(scene.id,{closeCharge:target}); setSelId(scene.id);
  };

  // ---- AGENTS: build a fresh working model + a sync() that pushes it to app state ----
  React.useEffect(()=>{ window.__turnJump = (no)=>{ const s = scenes.find(x=>x.no===no); if(s){ setSelId(s.id); setView("script"); setAgentsOpen(false); } }; },[scenes]);
  // LIVE app state, readable at agent-sync time. The factory's closures hold
  // run-START values by design (that's the agent's working snapshot); this ref is
  // how sync() sees what the film looks like NOW — to snapshot the true pre-commit
  // state for Undo, and to detect edits made while the agent ran.
  const agentLiveRef = React.useRef(null);
  agentLiveRef.current = { scenes, characters, project, beats: beatsMap, drafts, continuity: continuityMap };
  window.__turnCurrentProjectId = currentProjectId;
  const agentCtxFactory = ({ input, emit, propose, cancelled, agentName })=>{
    // deep snapshot of the LIVE story state (not the run-start closure), committed
    // to the undo stack when the agent applies its first change — so edits made
    // between run start and first commit are recoverable too.
    const snapshot = ()=>{ const L = agentLiveRef.current; return {
      label: agentName || "Agent", ts: Date.now(),
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
    const sigOf = (st)=>{ const j = JSON.stringify(st); let h=5381;
      for(let i=0;i<j.length;i++){ h=((h<<5)+h+j.charCodeAt(i))|0; } return h+":"+j.length; };
    const shapeOf = (src)=>({ scenes:src.scenes, characters:src.characters, project:src.project,
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
    // every state signature this run has written (seeded with the run-start state);
    // a live state outside this set = someone edited while the agent ran
    const writtenSigs = new Set([sigOf(shapeOf(model))]);
    const sync = ()=>{
      if(writersRoomReadOnlyRef.current){
        try{ emit && emit({k:"flag", t:"Your role cannot change the Writers' Room, so these proposed changes were NOT applied. Ask the owner for Writer access."}); }catch(e){}
        return;
      }
      // WRONG-FILM GUARD: an agent run takes minutes and the film switcher stays live.
      // Unguarded, a run that finished after a switch wrote its captured scenes, drafts,
      // beats, characters and project straight into whatever film was now open — and the
      // undo snapshot belonged to the ORIGINAL film, so pressing Undo compounded it.
      if(ownerProjectId !== projIdRef.current){
        try{ emit && emit({k:"flag", t:"You switched films while this ran, so its changes were NOT applied — they belong to the film it started in. Reopen that film and run it again."}); }catch(e){}
        return;
      }
      // MID-RUN EDIT GUARD: if the film changed under the run (an edit of the user's
      // or a collaborator's), snapshot THAT state onto the undo stack before this
      // commit replaces it, and say so once — never silently discard newer work.
      if(!writtenSigs.has(sigOf(shapeOf(agentLiveRef.current)))){
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
        const reconciled=window.turnSeries.mergeAdaptationCast(
          (agentLiveRef.current&&agentLiveRef.current.characters)||characters,
          model.characters,model.scenes,{allowNew:allowNewCast});
        model.characters=reconciled.characters;
        model.scenes=reconciled.scenes;
        if(!allowNewCast && reconciled.blockedNames&&reconciled.blockedNames.length&&!warnedRestrictedCast){
          warnedRestrictedCast=true;
          try{ emit&&emit({k:"flag",t:"Your Writer role can shape this Episode but cannot change the Show cast. New cast candidates were not added; scene character links were kept within the existing Show canon. Ask the owner or Art director to add any genuinely new character."}); }catch(e){}
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
      writtenSigs.add(sigOf({ scenes:model.scenes, characters:model.characters, project:model.project,
        beats:beatsW, drafts:model.drafts, continuity:model.continuity }));
    };
    return { model, sync, input, emit, propose,
      // a film switch cancels the RUN, not just the commit — otherwise an agent keeps
      // burning model calls (and reading the newly opened film's globals) for minutes
      // after the guard has already decided its result can never be applied
      cancelled: ()=> cancelled() || ownerProjectId !== projIdRef.current || writersRoomReadOnlyRef.current,
      switchedFilms: ()=> ownerProjectId !== projIdRef.current,
      project, facts:FACTS,
      // read-only copies of the Art-Room bibles + gated patchers, for agents that
      // cross-check the script against props/locations (Consistency Check). Patches
      // apply immediately — call them only AFTER a propose() card is approved.
      bible:{
        props: props.map(p=>({...p})),
        locations: locations.map(l=>({...l})),
        shots: (shots||[]).map(s=>({...s})),
        patchProp:(id,patch)=>{ if(!(_projRow&&_projRow.isShared) || (typeof window.teamCanWriteSection==="function"&&window.teamCanWriteSection(shareRole,"props"))) setProps(ps=>ps.map(p=>p.id===id?{...p,...patch}:p)); },
        patchLocation:(id,patch)=>{ if(!(_projRow&&_projRow.isShared) || (typeof window.teamCanWriteSection==="function"&&window.teamCanWriteSection(shareRole,"locations"))) setLocations(ls=>ls.map(l=>l.id===id?{...l,...patch}:l)); },
      },
      ai:{ available: (typeof aiAvailable==="function" && aiAvailable()),
        suggestTurn:(s,p)=>window.aiSuggestTurn(s,p,model.project),
        plantLine:(s,f,m)=>window.aiPlantLine(s,f,m),
        tableRead:(sc,dr)=>window.aiTableRead(sc,dr,model.project),
        voiceCheck:(sc,dr)=>window.aiVoiceCheck(sc,dr),
        buildSpine:(b)=>window.aiBuildSpine(b, (project&&project.format)||"film", (project&&project.framework)||"threeact"),
        buildStoryWorld:(b,sp)=>window.aiBuildStoryWorld(b,sp,(project&&project.format)||"film"),
        authorScene:(s,p)=>window.aiAuthorScene(s,p,model.characters,model.project),
        draftScene:(s,b,p)=>window.aiDraftScene(s,b,p,model.project),
      } };
  };

  // Scene Director — the visual ctx (docs/Scene Director Agent Plan.md §8): the
  // scene groups with their shots + resolution ctx, frame reads, the headless
  // generation primitive, and the vision QC. Scoped to one scene when launched
  // from a scene group's "Direct scene", or the whole film from the header.
  const sceneDirectorCtxFactory = ({ emit, propose, cancelled })=>{
    const ordered = scenesInStoryOrder(scenes);
    const charById = {}; characters.forEach(c=>{ charById[c.id]=c; });
    const propById = {}; props.forEach(p=>{ propById[p.id]=p; });
    const byScene = {}; (shots||[]).forEach(s=>{ (byScene[s.sceneId]=byScene[s.sceneId]||[]).push(s); });
    Object.values(byScene).forEach(a=>a.sort((x,y)=>(x.order||0)-(y.order||0) || (x.beatN||0)-(y.beatN||0)));
    const target = (sceneDirLaunch && sceneDirLaunch.sceneId)
      ? ordered.filter(s=>s.id===sceneDirLaunch.sceneId) : ordered;
    const groups = target.filter(s=>(byScene[s.id]||[]).length).map(scene=>({
      scene, shots:byScene[scene.id],
      ctx:{ scene, location:(typeof locationForScene==="function")?locationForScene(locations,scene.id):null,
        charById, propById, project } }));
    return { emit, propose, cancelled, sync:()=>{},
      ai:{ available: typeof aiAvailable==="function" && aiAvailable() },
      art:{
        scenes: groups,
        frameOf: async (id)=>{ let u=(typeof nbGetImage==="function")?nbGetImage(id):"";
          if(!u && typeof nbLoadImage==="function"){ try{ u=await nbLoadImage(id); }catch(e){} } return u; },
        shotFrame: (sh, sceneShots, sctx, o)=> window.generateShotFrame(sh, sceneShots, sctx, o),
        qc: (sh, frameUrl, anchorUrl)=> window.aiQcShotFrame(sh, frameUrl, anchorUrl),
      } };
  };

  const artAgentCtxFactory = ({ input, emit, propose, cancelled, agentName, force })=>{
    const ordered = scenesInStoryOrder(scenes);
    const charById = {}; characters.forEach(c=>{ charById[c.id]=c; });
    const propById = {}; props.forEach(p=>{ propById[p.id]=p; });
    const shotsByScene = {};
    (shots||[]).forEach(s=>{ (shotsByScene[s.sceneId]=shotsByScene[s.sceneId]||[]).push(s); });
    Object.values(shotsByScene).forEach(arr=>arr.sort((a,b)=>(a.order||0)-(b.order||0) || (a.beatN||0)-(b.beatN||0)));
    const ctxFor = (scene)=>({ scene,
      location:(typeof locationForScene==="function")?locationForScene(locations,scene.id):null,
      charById, propById, project });

    // ---- Shot Designer (Shot List agent) — coverage audit/design on a per-run WORKING
    // copy of shots (like Story Doctor's ctx.model); each approval also pushes to real state.
    let _workShots = (shots||[]).map(s=>({...s}));
    const _WIDE = new Set(["EWS","WS","FS","MWS"]);
    const _shotsOf = (sid)=> _workShots.filter(s=>s.sceneId===sid).slice().sort((a,b)=>(a.order||0)-(b.order||0)||(a.beatN||0)-(b.beatN||0));
    const coverage = {
      audit: ()=> (typeof auditCoverage==="function") ? auditCoverage(ordered, _workShots, beatsMap) : [],
      sceneById: (id)=> ordered.find(s=>s.id===id),
      shotsOf: _shotsOf,
      pickAnchor: (arr)=>{ const w=(arr||[]).find(s=>_WIDE.has(s.size)); return ((w||(arr||[])[0])||{}).id; },
      grammarList: (arr, anchorId, turnAt)=> (arr||[]).map((s,i)=> (i+1)+". "+((typeof shotGrammarLabel==="function")?shotGrammarLabel(s):s.size)
        + (i===0?"  ◆ chain head":"") + ((turnAt&&s.beatN===turnAt)?"  ← lands the turn":"")),
      turnAtOf: (sid)=> ((beatsMap||{})[sid]||{}).turnAt,
      draftCoverage: async (scene)=>{ if(typeof aiDraftShots!=="function" || typeof normalizeShot!=="function") return null;
        const raw = await aiDraftShots(scene, beatsMap, drafts, locations, props, characters, lbProject("shots"));
        if(!raw || !raw.length) return null;
        return completeDraftedShotCoverage(scene, raw.map((r,i)=>normalizeShot(r, scene, i, locations, props, characters, beatsMap))); },
      applyCoverage: (sceneId, newShots, anchorId)=>{
        // chain model: the head is the FIRST shot in order, so coverage shots carry no
        // explicit .anchor (that flag now means a manual fresh-start / chain break).
        const fresh = (newShots||[]).map(s=>({...s, anchor:false}));
        _workShots = _workShots.filter(s=>s.sceneId!==sceneId).concat(fresh);
        setShots(ss=> ss.filter(s=>s.sceneId!==sceneId).concat(fresh.map(s=>({...s})))); },
      setAnchorOnly: (sceneId, anchorId)=>{
        _workShots = _workShots.map(s=> s.sceneId===sceneId ? {...s, anchor:s.id===anchorId} : s);
        setShots(ss=> ss.map(s=> s.sceneId===sceneId ? {...s, anchor:s.id===anchorId} : s)); },
    };

    // ---- Casting Director (Characters agent) — draft spec, suggest states, and headless
    // generation of master sheets + appearance-state variants. Mutates `characters` state via
    // updateCharacter; commits images to the asset store + dispatches nb-gen-done (nbCommit won't).
    const _grabImg = async (id)=>{ let u=(typeof nbGetImage==="function")?nbGetImage(id):"";
      if(!u && typeof nbLoadImage==="function"){ try{ u=await nbLoadImage(id); }catch(e){} } return u; };
    const _cameoOf = async (cid)=>{ let a=[]; if(typeof nbGetCameoAngles==="function"){ try{ a=nbGetCameoAngles(cid)||[]; }catch(e){} }
      if(!a.length && typeof nbLoadCameoAngles==="function"){ try{ a=await nbLoadCameoAngles(cid)||[]; }catch(e){} } return a||[]; };
    // Use the SAME image model the master sheet was made with (from its meta) so a variant matches
    // it; else prefer GPT Image 2 (best identity-lock + what the cast masters use, and it avoids the
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
      try{ url = await window.nbGenerate(prompt, gopts); }
      catch(e){ if(/no image/i.test(String((e&&e.message)||e))){ url = await window.nbGenerate(prompt, gopts); } else throw e; }
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
        if(patch){ updateCharacter(c.id, patch); markApplied("characters"); } return patch; },
      suggestStates: async (c)=>{ if(typeof aiSuggestStates!=="function") return null;
        const raw = await aiSuggestStates(c, scenes.filter(s=>s.driver===c.id), project);
        if(!raw || !raw.length) return null;
        const existing = c.states||[]; const have=new Set(existing.map(s=>(s.label||"").trim().toLowerCase()));
        const adds = raw.filter(s=>!have.has((s.label||"").trim().toLowerCase()))
          .map((s,i)=> s.id ? s : {...s, id:"st-"+Date.now().toString(36)+"-"+i});
        const merged = adds.length ? [...existing, ...adds] : existing;
        if(adds.length) updateCharacter(c.id, { states: merged });
        return merged; },
      generateMaster: async (c, generateOpts)=>{
        generateOpts = generateOpts||{};
        const identityOptions=characterMediaOptions(c);
        if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(identityOptions,"coordinator-master-start");
        let prompt = (typeof combinedImagePrompt==="function") ? combinedImagePrompt(c, project, props) : "";
        const excluded = new Set(Array.isArray(c.wornReferenceExclusions)?c.wornReferenceExclusions:[]);
        const worn = (props||[]).filter(p=>p.ownerId===c.id && p.kind!=="carried");
        const refs=[]; const commitRefs=[];
        for(const p of worn.filter(p=>!excluded.has(p.id))){ const u=await _grabImg(p.id); if(u){
          refs.push(u); commitRefs.push({kind:"prop",label:p.name||"Worn prop",url:u,refId:p.id});
        } }
        const cameo = await _cameoOf(c.id);
        if(refs.length) prompt += " The additional prop reference image(s) are APPROVED worn-prop designs. Lock their exact shape, material, colour, wear and scale onto the character. Worn items without an attached image remain governed by the textual specification.";
        if(cameo.length) prompt += " Keep the FACE, bone structure and skin tone identical to the locked-likeness reference; only wardrobe and condition change.";
        let referenceImage="";
        if(generateOpts.deriveFromCurrent){ referenceImage=await _grabImg(c.id);
          if(referenceImage){
            if(typeof window.nbAssertIdentityAssetFresh==="function") window.nbAssertIdentityAssetFresh(c.id,c);
            prompt = "Update this existing master character sheet. Preserve the EXACT same identity, face, hair, skin tone, age, build, body proportions, panel layout, framing and render style from the base sheet. Apply the current production specification and approved worn-prop designs without re-casting the character. "+prompt;
            commitRefs.unshift({kind:"base",label:"Previous master character sheet",url:referenceImage,refId:c.id});
          }
        }
        const extra=[...refs, ...cameo];
        const usedIds=new Set(commitRefs.filter(r=>r.kind==="prop").map(r=>r.refId));
        const wornReferences = typeof window.loadWornReferenceSnapshot==="function"
          ? await window.loadWornReferenceSnapshot(c,worn,usedIds) : [];
        const visual=wornReferences.filter(r=>r.mode==="visual").length;
        return _genCharImage(c.id, prompt, { ...identityOptions, model:_modelFor(c),
          ...(referenceImage?{referenceImage}:{}), ...(extra.length?{ extraImages:extra }:{}),
          commitRefs, metaExtra:{ specPrompt:(typeof combinedImagePrompt==="function") ? combinedImagePrompt(c, project, props) : prompt,
            writingSources:(typeof window.nbWritingSourcesFor==="function")?window.nbWritingSourcesFor(c):[],
            promptCompiler:"TURN prompt compiler",
            wornSig:(typeof window.wornPropsSig==="function")?window.wornPropsSig(worn,c.id):"",
            wornReferences, wornRefSummary:{total:wornReferences.length,visual,text:wornReferences.length-visual} } }); },
      generateState: async (c, st, baseUrl)=>{
        const identityOptions=characterMediaOptions(c);
        if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(identityOptions,"coordinator-state-start");
        if(baseUrl && typeof window.nbAssertIdentityAssetFresh==="function") window.nbAssertIdentityAssetFresh(c.id,c);
        const base = (typeof combinedImagePrompt==="function") ? combinedImagePrompt(c, project, props) : "";
        const prompt = base + " APPEARANCE STATE — "+(st.label||"variant")+": "+(st.change||"")
          + ". Render the character in THIS changed state consistently across every panel, keeping the EXACT same face, hair, skin tone and body as the reference; only the described change differs.";
        const cameo = await _cameoOf(c.id);
        const stateEntity={...c,appearanceState:st};
        const opts = { ...identityOptions, model:_modelFor(c), metaExtra:{
          writingSources:(typeof window.nbWritingSourcesFor==="function")?window.nbWritingSourcesFor(stateEntity):[],
          promptCompiler:"TURN prompt compiler" } };
        if(baseUrl) opts.referenceImage = baseUrl;
        if(cameo.length) opts.extraImages = cameo;
        return _genCharImage(c.id+":"+st.id, prompt, opts); },
      // worn props of this character that ALREADY have a generated sheet — the trigger for
      // the Coordinator's "wear props" pass (re-generate the master so it wears them exactly).
      wornPropsWithSheets: async (c)=>{
        const excluded=new Set(Array.isArray(c.wornReferenceExclusions)?c.wornReferenceExclusions:[]);
        const worn = (props||[]).filter(p=>p && p.ownerId===c.id && p.kind!=="carried");
        const out=[]; for(const p of worn){ const u=await _grabImg(p.id); if(u&&!excluded.has(p.id)) out.push(p); }
        if(!out.length) return [];
        if(typeof window.loadWornReferenceSnapshot!=="function" || typeof window.compareWornReferenceSnapshots!=="function") return out;
        let meta=null; try{ const d=await nbLoadDetailsAsset(c.id); meta=d&&d.meta; }catch(e){}
        const current=await window.loadWornReferenceSnapshot(c,worn);
        const reasons=window.compareWornReferenceSnapshots(meta&&meta.wornReferences||[],current);
        return reasons.length ? out : [];
      },
    };

    // ---- Props Master surface (Props tab agent): derive → draft → dedup → generate ----
    // Works on a per-run copy of the props so each step sees the prior step's result
    // (React state is async); every step also persists via setProps so the live tab updates.
    let _propWork = (props||[]).slice();
    const _propDrafted = (p)=> (typeof propVisualsDrafted==="function") ? propVisualsDrafted(p)
      : !!((p.form||"").trim() && (p.material||"").trim());
    // merge a duplicate set on BOTH the working copy and the live state (mirrors app-level mergeProps)
    const _mergePropsWork = (ids)=>{
      const set = _propWork.filter(p=> ids.indexOf(p.id)>=0);
      if(set.length<2) return;
      const hasImg = (id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false;
      const score = (p)=> ((p.scenes||[]).length*100) + (hasImg(p.id)?40:0) + Math.min((p.name||"").length,30);
      const survivor = set.slice().sort((a,b)=> score(b)-score(a))[0];
      const others = set.filter(p=>p.id!==survivor.id);
      const anyScenes = set.some(p=>p.scenes!==undefined);
      const patch = {};
      if(anyScenes) patch.scenes = Array.from(new Set(set.flatMap(p=>p.scenes||[])));
      ["form","material","detail","renderStyle"].forEach(f=>{
        if(!String(survivor[f]||"").trim()){ const donor = others.find(o=>String(o[f]||"").trim()); if(donor) patch[f]=donor[f]; }
      });
      const apply = (ps)=> ps.map(p=> p.id===survivor.id ? {...p, ...patch} : p).filter(p=> p.id===survivor.id || ids.indexOf(p.id)<0);
      _propWork = apply(_propWork);
      setProps(apply);
      others.forEach(o=>{ try{ if(typeof nbClearAsset==="function") nbClearAsset(o.id); }catch(e){} });
    };
    const propmaster = {
      // pull the cast's own worn/carried items in (dedup handled by propsFromCast)
      deriveCast: ()=>{
        if(typeof propsFromCast!=="function") return 0;
        const add = propsFromCast(characters, _propWork, scenes, drafts);
        if(add.length){ _propWork = [..._propWork, ...add]; setProps(ps=>[...ps, ...add]); setPropsSeeded(true); }
        return add.length;
      },
      // derive set-dressing objects named in the action (no owner), deduped vs existing by object
      deriveSet: async ()=>{
        if(typeof aiDeriveSetDressing!=="function") return 0;
        const found = await aiDeriveSetDressing(scenes, drafts, project);
        if(!found || !found.length) return 0;
        const headOf = (n)=> (typeof propHeadNoun==="function" ? propHeadNoun(n) : "")
          || ("name:"+String(n||"").toLowerCase().replace(/[^a-z0-9]+/g,"-"));
        const seen = new Set(_propWork.map(p=>headOf(p.name)));   // skip an object the cast (or a prior card) already owns
        const slug = (n)=> (typeof propSlug==="function") ? propSlug(n) : String(n||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40);
        const cards = [];
        // fixture-of link: ownerless set dressing whose scenes ALL resolve to one location
        // belongs to that location (it renders into the location plate); an object whose
        // scenes span locations is mobile — likely hand-carried — so it is NOT pinned.
        const locIdOf = (sid)=>{ const L=(typeof locationForScene==="function")?locationForScene(locations, sid):null; return L?L.id:""; };
        found.forEach((e,i)=>{
          const h = headOf(e.name); if(seen.has(h)) return; seen.add(h);
          const locIds = Array.from(new Set((e.sceneIds||[]).map(locIdOf).filter(Boolean)));
          // these come from the ACTION with no owner: fixture nouns (and anything pinned
          // to one place) are SET DRESSING; only clearly handheld/mobile stays carried
          const kind = (typeof classifyPropKind==="function" && classifyPropKind(e.name, { ownerless:true }))
            || (locIds.length===1 ? "dressing" : "carried");
          cards.push({ id:"prop-set-"+slug(e.name)+"-"+i, name:e.name.replace(/^\w/, m=>m.toUpperCase()),
            kind, ownerId:"", ownerName:"", form:"", material:"", detail:"", renderStyle:"", negativePrompt:"",
            scenes:e.sceneIds||[], fromSet:true, locationId:(locIds.length===1?locIds[0]:""),
            origin:(typeof artRoomPropOrigin==="function") ? artRoomPropOrigin(kind,"screenplay") : {kind:"screenplay"} });
        });
        if(cards.length){ _propWork = [..._propWork, ...cards]; setProps(ps=>[...ps, ...cards]); }
        return cards.length;
      },
      // draft form/material/detail/renderStyle for every undrafted prop
      draftSpecs: async (force)=>{
        if(typeof aiDesignPropBible!=="function") return 0;
        const todo = _propWork.filter(p=>force || !_propDrafted(p));
        if(!todo.length) return 0;
        const map = await aiDesignPropBible(todo, characters, lbProject("props"));
        if(!map) return 0;
        const patch = (ps)=> ps.map(p=> map[p.id] ? {...p, ...map[p.id]} : p);
        _propWork = patch(_propWork); setProps(patch);
        return Object.keys(map).length;
      },
      // merge near-duplicate cards (same owner + same object) into one; returns # removed
      dedup: ()=>{
        if(typeof findDuplicateProps!=="function") return 0;
        const groups = findDuplicateProps(_propWork);
        let merged = 0;
        Object.keys(groups).forEach(k=>{ const ids = groups[k]; if(ids && ids.length>1){ _mergePropsWork(ids); merged += ids.length-1; } });
        return merged;
      },
      // drafted props that still need a sheet
      toGenerate: async (force)=>{
        const out=[];
        for(const p of _propWork){ if(!_propDrafted(p)) continue; if(!force && await _grabImg(p.id)) continue; out.push(p); }
        return out;
      },
      generateSheet: async (p)=>{
        if(typeof window.generatePropSheet!=="function") throw new Error("prop generator unavailable");
        return window.generatePropSheet(p, project);
      },
    };

    // ---- Location Scout surface (Locations tab agent): pull → coverage → spec → staging → variants → generate ----
    let _locWork = (locations||[]).slice();
    const _locDrafted = (l)=> (typeof locVisualsDrafted==="function") ? locVisualsDrafted(l)
      : !!((l.architecture||"").trim() && (l.lighting||"").trim());
    const locscout = {
      // pull master places from screenplay headings (new cards), and refresh scene lists / times on existing
      pull: ()=>{
        if(typeof deriveLocations!=="function") return 0;
        const derived = deriveLocations(scenes, _locWork, drafts);          // new only
        const fresh = deriveLocations(scenes, [], drafts);                  // all, to refresh scene lists/times/areas
        let next = _locWork.map(l=>{ const m=fresh.find(f=>f.key===l.key);
          return m ? withEpisodeLocationMeta(l,{...m,
            times:[...new Set([...(l.times||[]),...(m.times||[])])],
            areas:[...new Set([...(l.areas||[]),...(m.areas||[])])]}) : l; });
        if(derived.length) next = [...next, ...derived.map(l=>withEpisodeLocationMeta(l,l))];
        _locWork = next; setLocations(next); setLocsSeeded(true);
        return derived.length;
      },
      coverage: ()=> (typeof locationCoverage==="function") ? locationCoverage(scenes, _locWork) : [],
      draftSpecs: async (force)=>{
        if(typeof aiDesignLocationBible!=="function") return 0;
        const todo = _locWork.filter(l=>force || !_locDrafted(l));
        if(!todo.length) return 0;
        const map = await aiDesignLocationBible(todo, scenes, lbProject("locations"));
        if(!map) return 0;
        const patch = (ls)=> ls.map(l=> map[l.id] ? {...l, ...map[l.id]} : l);
        _locWork = patch(_locWork); setLocations(patch);
        return Object.keys(map).length;
      },
      draftStaging: async ()=>{
        if(typeof aiDraftStaging!=="function") return 0;
        // Depth grids earn their model call on locations the film REVISITS (2+ scenes),
        // where cross-scene geometric continuity matters. Single-scene places generate
        // fine from their prose spec; skip them here (the card's "Draft staging" button
        // still stages any one location on demand).
        const todo = _locWork.filter(l=>_locDrafted(l) && !l.staging && (l.scenes||[]).length>=2);
        if(!todo.length) return 0;
        const res = await Promise.all(todo.map(async l=>{ try{ return {id:l.id, staging: await aiDraftStaging(l, scenes, project)}; }catch(e){ return {id:l.id, staging:null}; } }));
        const sMap={}; res.forEach(x=>{ if(x.staging) sMap[x.id]=x.staging; });
        if(!Object.keys(sMap).length) return 0;
        const patch = (ls)=> ls.map(l=> sMap[l.id] ? {...l, staging:sMap[l.id]} : l);
        _locWork = patch(_locWork); setLocations(patch);
        return Object.keys(sMap).length;
      },
      // add a variant for each extra time-of-day a place appears at (times[0] is the base plate)
      addVariants: ()=>{
        let added=0;
        const stamp = Date.now().toString(36);
        const patch = (ls)=> ls.map(l=>{
          const times = (typeof deriveLocationTimes==="function") ? deriveLocationTimes(l, scenes) : (l.times||[]);
          if(times.length<2) return l;
          const have = new Set((l.variants||[]).map(v=>v.time));
          const need = times.slice(1).filter(t=>!have.has(t));
          if(!need.length) return l;
          const adds = need.map((t,i)=>({ id:"v"+stamp+"-"+(added+i)+"-"+t.toLowerCase().replace(/[^a-z0-9]/g,""), time:t }));
          added += adds.length;
          return {...l, variants:[...(l.variants||[]), ...adds]};
        });
        const next = patch(_locWork); _locWork = next; if(added) setLocations(next);
        return added;
      },
      toGeneratePlates: async (force)=>{
        const out=[];
        for(const l of _locWork){ if(!_locDrafted(l)) continue; if(!force && await _grabImg(l.id)) continue; out.push(l); }
        return out;
      },
      toGenerateVariants: async (force)=>{
        const out=[];
        for(const l of _locWork){ if(!_locDrafted(l)) continue;
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
    // Frame rendering is the explicit "Generate all frames" button in the Lookbook.
    let _lbWork = (typeof dedupeLookbookCards==="function") ? dedupeLookbookCards(lookbook||[]) : (lookbook||[]).slice();
    const lookbookSurface = {
      // TRUE when the visual research is already DONE: the look statement is written and
      // every touchstone category holds a noted reference. The agent checks this FIRST —
      // a re-run would only spend a writing call re-proposing the wall that's already up.
      researched: ()=>{
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
        const r = await window.aiResearchLookbook(scenes, project, _lbWork);
        if(!r) return { statement:"", added:0 };
        // keep an existing statement — a gap-filling re-run shouldn't rewrite the north star
        if(r.statement && !(lookbookNote||"").trim()) setLookbookNote(r.statement);
        const slug = (s)=> String(s||"").toLowerCase().replace(/\([^)]*\)/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
        const keyOf = (e)=> (typeof lookbookSourceKey==="function") ? lookbookSourceKey(e) : slug(e&&e.source);
        const seen = new Set(_lbWork.map(c=>keyOf(c)));
        let cards = [];
        (r.refs||[]).forEach((e,i)=>{
          const key = keyOf(e);
          if(!e.source || !key || seen.has(key)) return;
          seen.add(key);
          cards.push({ id:"look-"+slug(e.source).slice(0,24)+"-"+i, source:e.source, category:e.category||"Palette", note:e.note||"", negativePrompt:"",
            ...(r.writingProvenance?{writingProvenance:{...r.writingProvenance}}:{}) });
        });
        // GROWTH GUARD — the brief is 8 touchstones covering the categories. A re-run
        // may only FILL GAPS (one card per still-missing category), never grow the
        // wall, whatever the model returns (bug 2026-07-16: re-runs stacked 48 cards).
        const _noted = _lbWork.filter(c=>(c.note||"").trim());
        if(_noted.length){
          const covered = new Set(_noted.map(c=>c.category));
          cards = cards.filter(c=>{ if(covered.has(c.category)) return false; covered.add(c.category); return true; });
        }
        if(cards.length){
          _lbWork = (typeof dedupeLookbookCards==="function") ? dedupeLookbookCards([..._lbWork, ...cards]) : [..._lbWork, ...cards];
          setLookbook(ls=> (typeof dedupeLookbookCards==="function") ? dedupeLookbookCards([...ls, ...cards]) : [...ls, ...cards]);
        } else if(typeof dedupeLookbookCards==="function" && _lbWork.length !== (lookbook||[]).length){
          setLookbook(_lbWork);
        }
        // No write-through: the Colorist reads the lookbook LIVE (see art.designStyles), so the
        // references propagate downstream without mutating the Styles tab's persisted data.
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
      applyRenderStyle: (key)=>{
        const locText = (typeof window.renderStyleText==="function") ? window.renderStyleText("loc", key) : "";
        const propText = (typeof window.renderStyleText==="function") ? window.renderStyleText("prop", key) : "";
        setCharacters(cs=>cs.map(c=>({ ...c, renderStyleKey:key })));
        setProps(ps=>ps.map(p=>({ ...p, renderStyleKey:key, ...(propText?{renderStyle:propText}:{}) })));
        setLocations(ls=>ls.map(l=>({ ...l, renderStyleKey:key, ...(locText?{renderStyle:locText}:{}) })));
        return { characters:(characters||[]).length, props:(props||[]).length, locations:(locations||[]).length };
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
        setLookbook(ls=> ls.filter(c=>!dropIds.has(c.id)));
        (plan.drop||[]).forEach(c=>{ try{ if(typeof nbClearAsset==="function") nbClearAsset(c.id); }catch(e){} });
        return dropIds.size;
      },
      generateFrame: async (c)=>{ if(typeof window.generateLookbookFrame!=="function") throw new Error("frame generator unavailable"); return window.generateLookbookFrame(c, project); },
    };

    const draftOnly = force==="draft";
    const forceImages = force===true;
    return { input, emit, propose, cancelled, project, force: forceImages,
      // "Re-draft only": re-draft every spec from the Lookbook but leave generated images alone
      draftOnly,
      ai:{ available: (typeof aiAvailable==="function" && aiAvailable()) },
      art:{
        coverage,
        cast,
        propmaster,
        locscout,
        lookbook: lookbookSurface,
        markApplied: (dept)=> markApplied(dept),
        // ---- Cinematographer / Colorist tools (Style Bible agent) ----
        scenesLite: ordered.map(s=>({ id:s.id, no:s.no, title:s.title })),
        // the Colorist's references = the Presets refs field, which the write-through effect
        // keeps auto-filled from the Lookbook until the user takes it over — WYSIWYG: the
        // field is exactly what the Colorist reads.
        references: ()=>{ const sb=(typeof styleBibleOf==="function")?styleBibleOf(project):{};
          return { refs:(sb.refs||"").trim(), refImages:sb.refImages||[] }; },
        designStyles: async ()=>{ const sb=(typeof styleBibleOf==="function")?styleBibleOf(project):{};
          const seed=(sb.presets&&sb.presets.length)?sb.presets:(window.STYLE_PRESETS_DEFAULT||[]);
          return window.aiAssignSceneStyles(scenes, seed, drafts, project); },
        applyStyles: (res)=> applyStyleResult(res),
      } };
  };
  // LATEST-RENDER handle for long-lived async work (the wardrobe bootstrap): an event
  // handler that survives re-renders would otherwise call a factory whose props/characters
  // closure predates the setProps merges made DURING the batch — the re-bake would then
  // rebuild the worn list from a stale (possibly empty) props array and miss the very
  // wardrobe it just generated. The ref always points at the current render's factory.
  const artAgentCtxFactoryRef = React.useRef(null);
  artAgentCtxFactoryRef.current = artAgentCtxFactory;

  // ---- WARDROBE-ATTENTION DOT (Characters tab) ----
  // A yellow dot on the Characters tab when something in there is waiting on the user:
  // a background worn-prop batch ended with failures, or a master sheet is out of sync
  // with newly built worn-prop sheets (the one-tap "Update sheet with new wardrobe"
  // action is sitting on the card). A nudge, never a roadblock — updating is optional.
  const [wardrobeAttn, setWardrobeAttn] = React.useState(false);
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
    if((characters||[]).some(c=>c && c.wornPropBootstrap && c.wornPropBootstrap.status==="attention")){
      setWardrobeAttn(true); return;
    }
    // async signal — debounced: this loads sheet meta per character and generations land
    // in bursts. Reuses the SAME staleness audit the card banner and the Coordinator use
    // (wornPropsWithSheets), via the latest render's factory.
    const t = setTimeout(async ()=>{
      try{
        const mk = artAgentCtxFactoryRef.current;
        if(!mk){ if(live) setWardrobeAttn(false); return; }
        const cast = mk({ input:"", emit:()=>{}, propose:null, cancelled:()=>!live, agentName:"Badge", force:false }).art.cast;
        for(const c of (characters||[])){
          if(!live) return;
          // only characters whose master EXISTS — the update action lives on that sheet
          // (async loader: the sync cache is cold right after a reload/film switch)
          let master = (typeof nbGetImage==="function") ? nbGetImage(c.id) : "";
          if(!master && typeof nbLoadImage==="function"){ try{ master = await nbLoadImage(c.id); }catch(e){} }
          if(!master) continue;
          const stale = await cast.wornPropsWithSheets(c);
          if(stale && stale.length){ if(live) setWardrobeAttn(true); return; }
        }
        if(live) setWardrobeAttn(false);
      }catch(e){ if(live) setWardrobeAttn(false); }
    }, 500);
    return ()=>{ live=false; clearTimeout(t); };
  },[characters, props, wardrobeTick]);

  // restore the most recent pre-run snapshot
  const undoLastAgent = ()=>{
    if(!canMutateWritersRoom()) return;
    setAgentUndo(st=>{
      if(!st.length) return st;
      const snap = st[st.length-1];
      setScenes(snap.scenes.map(s=>({...s})));
      if(snap.characters) setCharacters(snap.characters.map(c=>({...c})));
      if(snap.project) setProject({...snap.project});
      setBeatsMap((typeof withBeatMapIdentity==="function")?withBeatMapIdentity(snap.beats):{...snap.beats});
      setDrafts({...snap.drafts});
      setContinuityMap(Object.fromEntries(Object.entries(snap.continuity).map(([k,v])=>[k,{...v}])));
      const ids = new Set(snap.scenes.map(s=>s.id));
      if(!ids.has(selId)) setSelId(snap.scenes[0] ? snap.scenes[0].id : null);
      return st.slice(0,-1);
    });
  };

  // apply grade vars (re-shaded for light mode)
  React.useEffect(()=>{
    const g = GRADES[t.grade] || GRADES["Teal & Orange"];
    const light = effectiveTheme === "light";
    const pos = light ? shadeOklch(g.pos, -0.16, 0.012) : g.pos;
    const neg = light ? shadeOklch(g.neg, -0.18, 0.012) : g.neg;
    const r = document.documentElement.style;
    r.setProperty("--pos", pos);
    r.setProperty("--neg", neg);
    r.setProperty("--pos-soft", pos.replace(")", light?" / .14)":" / .16)"));
    r.setProperty("--neg-soft", neg.replace(")", light?" / .14)":" / .16)"));
    r.setProperty("--pos-line", pos.replace(")", light?" / .42)":" / .5)"));
    r.setProperty("--neg-line", neg.replace(")", light?" / .42)":" / .5)"));
    r.setProperty("--brand", pos);
    r.setProperty("--f-display", t.display==="Serif" ? '"Spectral",serif' : '"Space Grotesk",sans-serif');
  },[t.grade,t.display,effectiveTheme]);

  const densClass = t.density==="compact"?"dens-compact":t.density==="comfy"?"dens-comfy":"";
  const premiumClass = t.premium ? "premium" : "";

  /* shared clean-canvas onboarding — used by the empty Writers' Room spine AND the
     hard-gated Art Room (the Art Room is downstream of the story — cast, props and
     locations are derived from it — so it stays blocked until a story exists). */
  const emptyCanvas = ()=> React.createElement("div",{className:"empty-canvas"},
    React.createElement("div",{className:"empty-canvas-card"},
      React.createElement("div",{className:"empty-canvas-title"},"Start your film"),
      React.createElement("div",{className:"empty-canvas-sub"},"Your canvas is clean. Describe an idea and Cinema Machine builds the value-charge spine, scene by scene — then characters, props, script and shots all follow from it."),
      React.createElement("button",{className:"empty-canvas-btn",onClick:startNewStory},"+ New Story")));
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
  /* ONE fiction across every busy overlay: MUSE is the studio's AI, and each tab is a
     department profession — the overlay names the hat MUSE is wearing (role) and the
     work being done (title). Roles match the agent roster (Casting Director, Props
     Master, Location Scout, Colorist, Shot Designer) so the agent panels and these
     pop-ups tell the same story. */
  const studioProgress =
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
        ? "Writing Scene "+draftSceneNo+" from its beats while preserving continuity."
        : "Threading continuity scene by scene — "+Math.min(Number(drafting.i||0)+1, Number(drafting.total||scenes.length))+" of "+Number(drafting.total||scenes.length)+".",
      progress:draftingProgress
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
    (room==="art" && assigningStyles) ? {
      role:"Colorist",
      title:"Assigning scene styles",
      detail:"Reading the film and color-scripting every scene from the current visual bible."
    } :
    (room==="art" && taggingScenes) ? {
      role:"Props Master",
      title:"Mapping props to scenes",
      detail:"Checking where each prop appears so downstream shots attach the right references."
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
  if(authGate && !authReady){
    return React.createElement("div",{className:"lp-splash"},
      React.createElement("span",{className:"lp-logo"},"Cinema Machine"),
      React.createElement("span",{className:"lp-splash-dot"}));
  }
  if(authGate && !session && typeof Landing!=="undefined"){
    return React.createElement(React.Fragment,null,
      window.ConfirmHost && React.createElement(window.ConfirmHost,null),
        React.createElement(Landing,{ onStart:startWithPlan, onSignIn:()=>openAuth("signin") }),
      authOpen && React.createElement(AuthModal,{ initialMode:authMode, plan:intendedPlan, light:true,
        onClose:()=>setAuthOpen(false), onAuthed:(s)=>{ if(s) setSession(s); } }),
      (typeof MuseDock!=="undefined") && React.createElement(MuseDock,{
      scenes:[], selScene:null, project:null, signedIn:false, aiOn:false, onSignIn:()=>openAuth("signup") }));
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

  return React.createElement("div",{className:`app vp-${vp} ${densClass} ${premiumClass}`+(roomReadOnly?" is-readonly":"")},
    window.ConfirmHost && React.createElement(window.ConfirmHost,null),
    /* VIEW-ONLY BANNER — say it UP FRONT. RLS rejects this user's writes, so without a
       standing notice they could work for an hour and only discover it from a failed save. */
    readOnlyShare && React.createElement("div",{className:"readonly-banner",role:"status"},
      React.createElement(Icon.eye||Icon.warn,{s:13}),
      React.createElement("span",null,
        React.createElement("b",null,"View-only access — "),
        "you can navigate, inspect, export and play this film. Editing and AI-write actions are disabled. Ask the owner for Writer access to edit it.")),
    unknownSharedRole && React.createElement("div",{className:"readonly-banner",role:"status"},
      React.createElement(Icon.warn||Icon.eye,{s:13}),
      React.createElement("span",null,
        React.createElement("b",null,"Role unavailable — "),
        "TURN could not verify a current collaborator role for this shared project. It is read-only and changes or AI actions will not save. Ask the owner to reassign View-only, Writer or Art director access.")),
    !readOnlyShare && !unknownSharedRole && room==="writers" && shareRole==="art_director" && writersRoomReadOnly && React.createElement("div",{className:"readonly-banner",role:"status"},
      React.createElement(Icon.eye||Icon.warn,{s:13}),
      React.createElement("span",null,
        React.createElement("b",null,"Writers' Room is read-only for Art directors — "),
        "you can inspect the story and script here, then return to the Art Room to change the Show Bible and pre-production work.")),
    !readOnlyShare && !unknownSharedRole && room==="art" && shareRole==="writer" && artRoomReadOnly && React.createElement("div",{className:"readonly-banner",role:"status"},
      React.createElement(Icon.eye||Icon.warn,{s:13}),
      React.createElement("span",null,
        React.createElement("b",null,"Art Room is read-only for Writers — "),
        "you can inspect the shared Bible and pre-production work here, then return to the Writers' Room to change story, beats and script.")),
    // the post-checkout welcome card (/?welcome=1): live-updates as the webhook's
    // grant streams into the balance; its CTA goes straight to New Story
    welcomeOpen && session && window.WelcomePlanCard && React.createElement(window.WelcomePlanCard,{
      plan: creditBalance && creditBalance.plan,
      credits: creditBalance && creditBalance.remaining,
      activating: !(creditBalance && window.turnIsPaidPlan(creditBalance.plan)),
      onNewStory: ()=>{ setWelcomeOpen(false); startNewStory(); },
      onClose: ()=>setWelcomeOpen(false) }),
    creditPackOpen && session && window.WelcomeCreditPackCard && React.createElement(window.WelcomeCreditPackCard,{
      credits: creditBalance && creditBalance.remaining,
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
          let id=film&&film.id;
          if(film&&isShowProject(film)){
            const first=(projects||[]).filter(p=>String(p.showId||"")===String(film.id))
              .sort((a,b)=>(Number(a.episodeNo)||0)-(Number(b.episodeNo)||0))[0];
            id=first&&first.id;
          }
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
          onGoRoom: async (rid)=>{ if(!currentProjectId){ await createProject(); } setHomeOpen(false); if(rid==="writers") setView("spine"); guardedSetRoom(rid); },
          onClose: ()=>setHomeOpen(false),
          accountSlot: React.createElement(AccountChip,{ session, cloudActive:cloudMode, saveState, shareRole,roleUnavailable:unknownSharedRole,
            onSignIn:()=>setAuthOpen(true), onSignOut:signOut }) }),
    t.grain && React.createElement("div",{style:{position:"fixed",inset:0,pointerEvents:"none",zIndex:50,
      opacity:.025,mixBlendMode:"overlay",
      backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"}}),

    // "Reset to sample story" is an ADMIN-ONLY tool (demo upkeep): only the admin
    // account ever sees it — every other user (and signed-out local mode) gets no reset.
    // The Stage gets the same shared TopBar as every other room (brand, project switcher,
    // room switcher, theme toggle, etc.) — only its own sub-view tabs (ViewNav) are skipped,
    // since the Stage is a single full-width assembly view.
    React.createElement(TopBar,{view,setView,room,setRoom:guardedSetRoom,artView,setArtView,project,scenes,drafts,
      onReset: isAdmin ? resetStory : null,
      onToggleAI:toggleAI,
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
        const keep = { format:project.format, framework:project.framework, logline:(project.logline||"").trim() };
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
        } else { applyDoc(emptyDoc()); setArtView("lookbook"); }
        setRoom("writers"); setView("spine");
        setProject(p=>({ ...p, ...(keep.format?{format:keep.format}:{}), ...(keep.framework?{framework:keep.framework}:{}),
          logline:keep.logline || p.logline, sourceBrief:brief, sourceBriefAt:new Date().toISOString() }));
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
      authSlot: React.createElement(AccountChip,{ session, cloudActive: cloudMode, saveState, shareRole,roleUnavailable:unknownSharedRole,
        onSignIn:()=>setAuthOpen(true), onSignOut:signOut }),
      projectSlot: cloudMode ? React.createElement(ProjectSwitcher,{ projects, currentId:currentProjectId,
        formatLabel:(typeof formatOf==="function") ? formatOf(project).label : null,
        // framework badge only when it differs from the default — three-act is the baseline
        frameworkLabel:(typeof frameworkOf==="function" && frameworkOf(project).id!=="threeact") ? frameworkOf(project).badge : null,
        onSwitch:switchProject, onCreate:createProject, onRename:renameProject, onDelete:deleteProject,
        onNewEpisode:createEpisode, onMakeShow:makeShow, onDeleteShow:deleteShow, seriesBusy,
        canMakeShow: !currentShowId && scenes.length>0 && !(((projects||[]).find(p=>p.id===currentProjectId)||{}).isShared) }) : null,
      presenceSlot: (cloudMode && window.PresenceDots)
        ? React.createElement(window.PresenceDots,{ people:presence }) : null,
      teamSlot: cloudMode && window.TeamButton ? React.createElement(window.TeamButton,{
        // A series is shared once at Show scope. The database migration makes
        // that role apply to every existing and future episode.
        projectId:currentShowId||currentProjectId,
        projectTitle:((projects||[]).find(p=>p.id===(currentShowId||currentProjectId))||{}).title || project.title,
        projectMeta:(projects||[]).find(p=>p.id===(currentShowId||currentProjectId)) || null,
        series:!!currentShowId,
        onChanged:async ()=>{
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
    room!=="stage" && React.createElement(ViewNav,{room,view,setView,artView,setArtView,staleTabs,
      attnTabs:{ characters: wardrobeAttn },
      readOnly:roomReadOnly,
      hiddenTabs:(typeof tabHidden==="function") ? Object.fromEntries((window.ART_TABS||[]).map(t=>[t.id, tabHidden(project, t.id)])) : null,
      railOpen,inspOpen,onToggleRail:toggleRail,onToggleInsp:toggleInsp,
      onCoordinate:async ()=>{ if(await requireStory("Art Department Coordinator")) setCoordConfirm(true); },
      onAgents:async ()=>{ if(!canMutateWritersRoom()) return; if(await requireStory("Story Editors")) setAgentsOpen(true); }}),

    authOpen && React.createElement(AuthModal,{ initialMode:authMode, plan:intendedPlan,
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
                onVoiceAll:voiceAllLines,voicingLines,onCancelVoiceAll:cancelVoiceAll,
                onVoiceLine:voiceLine,
                onUpdateShot:updateShot,
                onStageNav:(tab)=>{
                  if(tab==="timeline"){ setRoom("writers"); setView("script"); return; }
                  if(tab==="shots"){ setArtView("shots"); guardedSetRoom("art"); return; }
                  if(tab==="assets"){ setArtView("lookbook"); guardedSetRoom("art"); return; }
                  if(tab==="audio"){ guardedSetRoom("stage"); return; }
                  if(tab==="versions"){ guardedSetRoom("stage"); return; }
                  guardedSetRoom("stage");
                }}))
      : room==="art"
        ? (scenes.length===0
          // hard gate: the Art Room is downstream of the story, so with no scenes
          // show the onboarding instead of empty (and partly broken) tabs.
          ? React.createElement("div",{className:"canvas"}, emptyCanvas())
          : React.createElement(ArtRoom,{key:(cloudMode?currentProjectId:"local"),artView,setArtView,project,characters,scenes,props,drafts,trash,
            readOnly:roomReadOnly,canReview:!roomReadOnly,onSourceClick:openArtSource,
            onRestoreChar:restoreCharacter,onPurgeChar:purgeCharacter,onRestoreProp:restoreProp,onPurgeProp:purgeProp,
            onRestoreLoc:restoreLocation,onPurgeLoc:purgeLocation,onRestoreShot:restoreShot,onPurgeShot:purgeShot,onEnsureOwner:ensureOwnerSheet,
            onDirectScene:(sceneId)=>setSceneDirLaunch({ sceneId: sceneId||null }),
            onColorist:(refs)=>{ if(typeof refs==="string") setStyleRefs(refs.trim()); setColoristOpen(true); },
            onShoot:()=>setShotDesignerOpen(true),
            onCast:()=>setCastingOpen(true),
            onPropsMaster:()=>setPropsMasterOpen(true),
            onScout:()=>setLocScoutOpen(true),
            onResearch:()=>setResearchOpen(true),
            lookbook,lookbookNote,onUpdateLookbook:updateLookbookCard,onAddLookbook:addLookbookCard,
            onDeleteLookbook:deleteLookbookCard,onSetLookbookNote:setLookbookNote,onClearLookbook:clearLookbook,
            staleTabs,onApplyLookbook:applyLookbook,onReviewLookbook:(dept)=>applyLookbook(dept,"review"),
            onUpdateChar:updateCharacter,onDraftVisuals:draftCharacterVisuals,onDraftAllVisuals:draftAllVisuals,
            draftingVisualId,draftingAllVisuals,draftingVisualIds,onDeleteCharacter:deleteCharacter,
            onSuggestStates:suggestCharacterStates,suggestingStatesId,onRemoveOwnedItem:removeOwnedProp,onRenameOwnedItem:renameOwnedProp,
            onUpdateProp:updateProp,onDraftProp:draftPropVisuals,onDraftAllProps:draftAllProps,onCreateOwnedProp:createOwnedProp,
            onAddProp:addProp,onDeleteProp:deleteProp,draftingPropId,draftingPropIds,draftingAllProps,onMergeProps:mergeProps,
            onSeedFromCast:seedPropsFromCast,castHasProps:(typeof castHasProps==="function" && castHasProps(characters)),
            scenes,onTagScenes:tagPropScenes,taggingScenes,onTagOne:tagOnePropScenes,taggingSceneId,
            locations,onUpdateLocation:updateLocation,onDraftLocation:draftLocationVisuals,onDraftAllLocs:draftAllLocations,
            onAddLocation:addLocation,onDeleteLocation:deleteLocation,draftingLocIds,draftingAllLocs,
            onPullFromScript:pullLocationsFromScript,scriptHasLocs:(typeof scriptHasLocations==="function" && scriptHasLocations(scenes)),
            sluglineUnits,onUpdateUnit:updateSlugUnitOverlay,onRemoveUnit:removeSlugUnitOverlay,
            onAssignStyles:assignSceneStyles,assigningStyles,onSetStyleRefs:setStyleRefs,onSetScenePreset:setScenePreset,
            onAddStyleRefImages:addStyleRefImages,onRemoveStyleRefImage:removeStyleRefImage,
            onDraftStaging:draftLocationStaging,draftingStageId,
            shots,beatsMap,onUpdateShot:updateShot,onAddShot:addShot,onDeleteShot:deleteShot,onSplitBeat:splitBeatCoverage,splittingBeat,
            onRefineBeat:refineBeatFromScreenplay,refiningBeat,onRemoveMicroBeatShots:removeMicroBeatShots,
            onDeleteShotReference:deleteShotReference,
            onDraftSceneShots:draftSceneShots,draftingSceneShots,onDraftAllShots:draftAllShots,draftingAllShots}))
        : React.createElement(React.Fragment,null,
      // scrim behind any open overlay drawer
      ((railDrawer&&railOpen)||(inspDrawer&&inspOpen)) && React.createElement("div",{className:"scrim",
        onClick:()=>{ setRailOpen(false); setInspOpen(false); }}),

      scenes.length>0 && (railDrawer
        ? (railOpen && React.createElement(LeftRail,{project,characters,scenes,selChar,
            onSelectChar:(id)=>{ setSelChar(id); setInspOpen(true); setRailOpen(false); },
            onContract:updateContract,
            showFramework:t.framework,onCollapse:()=>setRailOpen(false),compact:!wide,readOnly:writersRoomBlocked}))
        : (railOpen
          ? React.createElement(LeftRail,{project,characters,scenes,selChar,
              onSelectChar:(id)=>{ setSelChar(id); setInspOpen(true); },
              onContract:updateContract,
              showFramework:t.framework,onCollapse:()=>setRailOpen(false),compact:!wide,readOnly:writersRoomBlocked})
          : React.createElement(CollapsedStrip,{side:"left",label:"Story",icon:Icon.panelLeft,
              onExpand:()=>setRailOpen(true),flagCount:scenes.filter(s=>turnInfo(s).flagged).length}))),

      React.createElement("div",{className:"canvas"},
        React.createElement("div",{className:"canvas-head"},
          React.createElement("div",{className:"canvas-head-copy"},
            React.createElement("div",{className:"canvas-title"},
              view==="spine"?"Value-Charge Spine":view==="beats"?"Turn Audit":view==="script"?"Screenplay Draft":"Story Board"),
            React.createElement("div",{className:"canvas-sub"},
              view==="spine"?"The emotional charge of every scene, end to end":
              view==="beats"?(((typeof fwAuditOf==="function")&&fwAuditOf().subline)||"If a scene doesn't turn, cut it"):
              view==="script"?scriptSubtitle():"16 scenes across 3 acts")),
          view==="spine" && React.createElement("div",{className:"legend"},
            runtimeTotal>0 && React.createElement("div",{className:"legend-item",
              title:"Estimated total runtime, ≈1 page/min (drafted scenes from their script; undrafted roughly from beats)"},
              React.createElement(Icon.clock,{s:11}),
              "≈ "+Math.round(runtimeTotal/60)+" min"),
            React.createElement("div",{className:"legend-item"},
              React.createElement("span",{className:"legend-swatch",style:{background:"var(--pos)"}}),"POS"),
            React.createElement("div",{className:"legend-item"},
              React.createElement("span",{className:"legend-swatch",style:{background:"var(--neg)"}}),"NEG"),
            React.createElement("div",{className:"legend-item"},
              React.createElement("span",{className:"legend-swatch",style:{background:"var(--alert)"}}),"No turn"))),

        view==="spine" && scenes.length>0 && characters.length>0 && React.createElement(FollowStrip,{
          characters,scenes,beatsMap,followId:followChar,onFollow:setFollowChar}),
        view==="spine" && scenes.length>0 && React.createElement(DragScroll,{className:"canvas-scroll spine-pan"},
          React.createElement(SpineCanvas,{scenes,selId,onSelect:selectSceneDetail,showFramework:t.framework,
            onReorder:reorderScenes,onAddScene:addScene,runtimes:runtimeMap,readOnly:writersRoomBlocked,
            valueAxis:(typeof contractAxis==="function")?contractAxis(project):null,
            follow:(()=>{ if(!followChar) return null;
              const c = characters.find(x=>x.id===followChar); if(!c) return null;
              const tl = characterThroughline(c, scenes, beatsMap);
              return { char:c, color:charSolidColor(c), drivenIds:new Set(tl.driven.map(s=>s.id)),
                involvedIds:tl.involvedIds, turnIds:tl.turnIds }; })()})),
        view==="spine" && scenes.length>0 && React.createElement("div",{className:"scroll-fade"}),
        // clean-canvas onboarding: a new/empty project has no scenes yet (shown for
        // ANY view so the data-assuming spine/audit/board/script never render empty).
        scenes.length===0 && emptyCanvas(),
        view==="beats" && scenes.length>0 && React.createElement(TurnAudit,{scenes,selId,onSelect:selectSceneDetail}),
        view==="board" && scenes.length>0 && React.createElement(Board,{scenes,selId,onSelect:selectSceneDetail}),
        view==="script" && scenes.length>0 && React.createElement(ScriptView,{scene:sel,beats,
          drafts, scenes, onSelectScene:selectSceneBrowse, onPolish:polishScene,
          onDraftOne:draftOne, onDraftAll:draftAll, drafting, total:scenes.length,
          history: sel ? (history[sel.id]||{back:[],fwd:[]}) : {back:[],fwd:[]},
          labelOf, onRevert:revertVersion, onRedo:redoVersion, onEditScene:commitVersion, continuityMap, project,readOnly:writersRoomBlocked,
          // click a beat in the Script gutter → reveal it in the Inspector's Beats tab
          onBeatFocus:(n)=>{ setSelChar(null); setInspTab("beats"); setFocusBeat(n);
            if(!inspDrawer) setInspOpen(true); }}),

        // Floating Writers' Room (Agents) launcher — the agents refine an existing
        // story, so it only appears once a story exists (scenes > 0).
        ),

      scenes.length>0 && (()=>{
        const charObj = selChar ? characters.find(c=>c.id===selChar) : null;
        const inspectorEl = charObj
          ? React.createElement(CharacterPanel,{character:charObj, scenes, drafts, cast:characters,
              onUpdate:updateCharacter, onDraft:draftCharacter, drafting:charDrafting===charObj.id,readOnly:writersRoomBlocked,
              onJumpScene:(id)=>selectScene(id), onClose:()=>setSelChar(null),
              onCollapse:()=>setInspOpen(false),
              onFollow:(id)=>{ setFollowChar(id); setView("spine");
                if(inspDrawer) setInspOpen(false); }})
          : React.createElement(Inspector,{scene:sel,beats,draft:(sel?drafts[sel.id]:null),onCharge,onUpdate:updateScene,characters,scenes,
              onAddScene:addScene,onDeleteScene:deleteScene,onMove:moveScene,onBeats:setBeatsFor,
              // "Redraft script from beats" (Beats tab): the reverse of Rebuild-from-script.
              // polishScene re-derives the prose from the CURRENT beat cards and commits a
              // VERSION, so Undo restores the previous draft.
              onRedraftScript: async (scn, b)=>{
                const ok = await window.appConfirm({ title:"Redraft the script from beats?",
                  body:"Scene "+scn.no+"\u2019s screenplay is rewritten from the CURRENT beat cards \u2014 reshape the beats first, then rebuild. The current draft stays in version history (Undo restores it).",
                  confirmLabel:"Redraft from beats" });
                if(!ok) return false;
                const done = await polishScene(scn, b);
                if(typeof window.appToast==="function"){
                  if(done) window.appToast("Scene "+scn.no+" redrafted from its beats \u2014 Undo restores the previous draft.","ok");
                  else window.appToast("Couldn\u2019t redraft \u2014 the writing model may be unreachable.","error");
                }
                return done;
              },
              sceneIndex:scenes.findIndex(s=>s.id===selId),sceneCount:scenes.length,
              onCollapse:()=>setInspOpen(false),project,
              tab:inspTab,onTab:setInspTab,focusBeat,readOnly:writersRoomBlocked});
        return inspDrawer
          ? (inspOpen && inspectorEl)
          : (inspOpen
            ? inspectorEl
            : React.createElement(CollapsedStrip,{side:"right",label:"Inspector",icon:Icon.panelRight,
                onExpand:()=>setInspOpen(true)}));
      })())),

    // Agents — Writers' Room modal
    agentsOpen && !writersRoomBlocked && React.createElement(AgentsPanel,{
      onClose:()=>{ setAgentsOpen(false); setAgentLaunch(null); },
      onView:(v)=>{ setRoom("writers"); setView(v||"spine"); setAgentsOpen(false); setAgentLaunch(null); },
      ctxFactory:agentCtxFactory,
      initialAgentId: agentLaunch && agentLaunch.id,
      initialInput: agentLaunch && agentLaunch.input,
      autoStart: !!agentLaunch,
      undoCount:agentUndo.length,
      undoLabel:agentUndo.length?agentUndo[agentUndo.length-1].label:null,
      onUndo:undoLastAgent,
      issues:agentIssues,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Scene Director — gated per scene (plan card before each scene's spend); takes a
    // shot list to a consistent frame set: anchor → derive → vision QC → bounded repair.
    sceneDirLaunch && React.createElement(AgentsPanel,{
      initialAgentId:"scenedirector", autoStart:true, single:true, viewLabel:"View Shot List",
      ctxFactory:sceneDirectorCtxFactory,
      onClose:()=>setSceneDirLaunch(null),
      onView:()=>{ setArtView("shots"); setSceneDirLaunch(null); },
      issues:{}, undoCount:0,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Cinematographer / Colorist — gated agent (proposes the colour system for approval);
    // its idle screen shows the current visual references so you can add taste before it runs.
    coloristOpen && React.createElement(AgentsPanel,{
      initialAgentId:"colorist", single:true, viewLabel:"View Styles",
      ctxFactory:artAgentCtxFactory,
      onClose:()=>setColoristOpen(false),
      onView:()=>{ setArtView("stylebible"); setColoristOpen(false); },
      issues:{}, undoCount:0,
      aiOn: (typeof aiAvailable==="function" && aiAvailable()),
      introExtra: (()=>{ const sb=(typeof styleBibleOf==="function")?styleBibleOf(project):{};
        const refs=(sb.refs||"").trim(); const imgs=sb.refImages||[];
        if(!refs && !imgs.length) return React.createElement("div",{className:"ag-coloref empty"},
          React.createElement(Icon.image,{s:13}), "No visual references yet — research the look in the Lookbook tab, or add films, photographers or reference images here, to steer the palette.");
        return React.createElement("div",{className:"ag-coloref"},
          React.createElement("div",{className:"ag-coloref-lab"}, React.createElement(Icon.sparkles,{s:12}), "Designing from your references"),
          refs && React.createElement("div",{className:"ag-coloref-txt"}, refs),
          imgs.length>0 && React.createElement("div",{className:"ag-coloref-imgs"},
            imgs.map(ri=> React.createElement("div",{key:ri.id,className:"ag-coloref-img"},
              React.createElement("img",{src:ri.thumb,alt:""}),
              React.createElement("div",{className:"ag-coloref-sw"}, (ri.colors||[]).slice(0,5).map((c,i)=>React.createElement("span",{key:i,style:{background:c}}))))))); })()}),

    // Shot Designer — gated coverage agent (proposes per-scene coverage for approval),
    // launched from the Shot List header; hands off rendering to "Generate all shots".
    shotDesignerOpen && React.createElement(AgentsPanel,{
      initialAgentId:"shotdesigner", autoStart:true, single:true, viewLabel:"View Shots",
      ctxFactory:artAgentCtxFactory,
      onClose:()=>setShotDesignerOpen(false),
      onView:()=>{ setArtView("shots"); setShotDesignerOpen(false); },
      issues:{}, undoCount:0,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Casting Director — autonomous cast-design agent, launched from the Characters header.
    castingOpen && React.createElement(AgentsPanel,{
      initialAgentId:"casting", autoStart:true, single:true, viewLabel:"View Characters", force:castingForce,
      ctxFactory:artAgentCtxFactory,
      onClose:()=>{ setCastingOpen(false); setCastingForce(false); },
      onView:()=>{ setArtView("characters"); setCastingOpen(false); setCastingForce(false); },
      issues:{}, undoCount:0,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),


    // Props Master — autonomous props agent (derive → draft → dedup → generate),
    // launched from the Props header; runs before the cast so the references exist.
    propsMasterOpen && React.createElement(AgentsPanel,{
      initialAgentId:"propsmaster", autoStart:true, single:true, viewLabel:"View Props", force:propsMasterForce,
      ctxFactory:artAgentCtxFactory,
      onClose:()=>{ setPropsMasterOpen(false); setPropsMasterForce(false); },
      onView:()=>{ setArtView("props"); setPropsMasterOpen(false); setPropsMasterForce(false); },
      issues:{}, undoCount:0,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Production Designer / Location Scout — autonomous locations agent (pull → spec → staging
    // → variants → generate, + coverage check), launched from the Locations header.
    locScoutOpen && React.createElement(AgentsPanel,{
      initialAgentId:"locscout", autoStart:true, single:true, viewLabel:"View Locations", force:locScoutForce,
      ctxFactory:artAgentCtxFactory,
      onClose:()=>{ setLocScoutOpen(false); setLocScoutForce(false); },
      onView:()=>{ setArtView("locations"); setLocScoutOpen(false); setLocScoutForce(false); },
      issues:{}, undoCount:0,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Visual Researcher — autonomous lookbook agent (research the look + render mood frames),
    // launched from the Lookbook header. Writes references through to the Colorist (Presets).
    researchOpen && React.createElement(AgentsPanel,{
      initialAgentId:"researcher", autoStart:true, single:true, viewLabel:"View Lookbook",
      ctxFactory:artAgentCtxFactory,
      onClose:()=>setResearchOpen(false),
      onView:()=>{ setArtView("lookbook"); setResearchOpen(false); },
      issues:{}, undoCount:0,
      aiOn: (typeof aiAvailable==="function" && aiAvailable())}),

    // Art Department Coordinator — the meta-agent that runs the whole pre-production
    // pipeline in dependency order (props → cast → locations → colour → shots → storyboard),
    // launched from the Art Room's "Run pre-production" button in the view bar.
    // #2 — cost/scope preview before the Coordinator spends: confirm, then launch
    coordConfirm && window.CoordConfirm && React.createElement(window.CoordConfirm,{
      project, characters, props, locations, shots, scenes,
      onCancel:()=>setCoordConfirm(false),
      onConfirm:()=>{ setCoordConfirm(false); setCoordOpen(true); }}),
    coordOpen && React.createElement(AgentsPanel,{
      initialAgentId:"coordinator", autoStart:true, single:true, viewLabel:"View Storyboards",
      ctxFactory:artAgentCtxFactory,
      onClose:()=>setCoordOpen(false),
      onView:()=>{ setArtView("storyboard"); setCoordOpen(false); },
      issues:{}, undoCount:0,
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
          else { applyDoc(emptyDoc()); setArtView("lookbook"); }
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
          sourceBrief: brief, sourceBriefAt: new Date().toISOString() }));
        setAgentLaunch({id:"adapt", input:brief}); setAgentsOpen(true); }}),

    // MUSE — the floating help assistant, available in every room (separate from Agents).
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
    !writersRoomBlocked && agentUndo.length>0 && agentUndo[agentUndo.length-1].label!=="Adaptation" && React.createElement("div",{className:"agent-undo"},
      React.createElement("span",{className:"au-ic"},React.createElement(Icon.undo,{s:15})),
      React.createElement("div",{className:"au-text"},
        React.createElement("div",{className:"au-t"},agentUndo[agentUndo.length-1].label+" changed your story"),
        React.createElement("div",{className:"au-s"},
          agentUndo.length>1 ? (agentUndo.length+" agent runs can be undone") : "One click to revert it")),
      React.createElement("button",{className:"au-btn",onClick:undoLastAgent},
        React.createElement(Icon.undo,{s:13}),"Undo"),
      React.createElement("button",{className:"au-x",title:"Keep changes",onClick:()=>setAgentUndo([])},
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
      React.createElement(TweakToggle,{label:"Show story framework",value:t.framework,onChange:v=>setTweak("framework",v)}),
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
  componentDidCatch(err, info){ try{ console.error("Cinema Machine — render crash:", err, info); }catch(e){} }
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
