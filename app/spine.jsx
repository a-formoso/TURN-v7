/* spine.jsx — value-charge chart + act labels + scene tiles */

/* shared turn logic — used by canvas, inspector, Audit and the agents.
   The RULE lives in the project's narrative FRAMEWORK (app/frameworks.jsx);
   three-act's registry entry is this classic rule, frozen. Signature unchanged
   so every call site keeps working; the inline body is the safety fallback. */
function turnInfo(sc){
  if(typeof fwAuditOf==="function"){ try{ return fwAuditOf().rule(sc); }catch(e){} }
  const t = (typeof chargeTurn==="function") ? chargeTurn(sc.openCharge, sc.closeCharge)
    : { turned: Math.sign(sc.openCharge)*Math.sign(sc.closeCharge) < 0, progression:false };
  const exempt = sc.kind === "resolution";
  return { turned:t.turned, progression:t.progression, flagged: !t.turned && !t.progression && !exempt, exempt };
}
/* one badge for a scene's turn status, everywhere it's shown: turns / progresses (same
   side, no reversal) / settles (a structural beat allowed to settle) / no turn.
   turnBadgeOf is what the badge says: one source for the badge and for the scene
   card's spoken name (2026-09-28). */
function turnBadgeOf(scene){
  const ti = turnInfo(scene), aud = (typeof fwAuditOf==="function" && fwAuditOf()) || {};
  if(ti.flagged) return { cls:"no", icon:"alert", word:aud.flagBadge||"No turn" };
  if(ti.progression) return { cls:"prog", icon:"arrowSmall", word:aud.progBadge||"Progresses",
    title:"Intensifies on the same side instead of reversing" };
  const reversed = (typeof chargeTurn==="function") ? chargeTurn(scene.openCharge, scene.closeCharge).turned : ti.turned;
  if(ti.exempt && !reversed) return { cls:"settle", icon:"check", word:"Settles",
    title:"This structural beat may settle rather than turn" };
  return { cls:"ok", icon:"check", word:aud.okBadge||"Turns" };
}
function TurnBadge({ scene }){
  const b = turnBadgeOf(scene), h = React.createElement;
  return h("span",{className:"turn-badge "+b.cls,...(b.title?{title:b.title}:null)},h(Icon[b.icon],{s:10}),b.word);
}
window.TurnBadge = TurnBadge;
window.turnBadgeOf = turnBadgeOf;
function chargeClass(v){ return v > 0 ? "pos" : v < 0 ? "neg" : "zero"; }
function chargeStr(v){ return v > 0 ? `+${v}` : `${v}`; }
window.turnInfo = turnInfo;
window.chargeClass = chargeClass;
window.chargeStr = chargeStr;

/* which side of the controlling idea a scene argues — explicit override on the
   scene (scene.argues) or derived from its closing charge: a positive close
   asserts the idea, a negative close asserts the counter-idea. */
function themeArgues(sc){
  if(sc.argues==="idea"||sc.argues==="counter"||sc.argues==="neither")
    return { side:sc.argues, explicit:true };
  const c = Math.sign(sc.closeCharge);
  return { side: c>0?"idea":c<0?"counter":"neither", explicit:false };
}
window.themeArgues = themeArgues;

/* ---- runtime estimation — 1 screenplay page ≈ 55 lines ≈ 60 seconds ----
   Drafted scenes are estimated from their actual blocks (action wraps ~12 words
   a line, dialogue ~7 in its narrow column); undrafted scenes fall back to a
   rough figure and are marked approx (~).
   `budget` (optional, sceneBudgetFor() in formats.jsx — docs/Story Pipeline.md step 5): it
   measures SCREEN TIME against the format's budget, so
   - a scene heading or a transition counts nothing (neither plays on screen — and a 30 s
     Commercial's 7.5 s scene can't spend 2 s of it on its slugline);
   - a documentary's planned testimony note ("EXPECTED TESTIMONY: …") counts the seconds the
     recorded testimony will play (budget.testimonySec), not the two lines the note takes;
   - an undrafted scene is assumed to play its screen-time budget, and a drafted scene's
     20 s floor never rises above the budget (a floor never makes a short scene look long);
   - a drafted scene also reports `lines` and the unfloored seconds `raw` (the redraft's
     "never longer" ceiling compares those).
   Without a budget the figures are as before (beats × 35 s, 45–240 s; 90 s; 20 s floor). */
const _TESTIMONY_NOTE_RE = /\bEXPECTED TESTIMONY\b/g;
function sceneRuntime(scene, draft, beats, budget){
  const blocks = draft && draft.blocks;
  const hasBudget = !!(budget && budget.sec > 0);
  if(blocks && blocks.length){
    let lines = 0, extraSec = 0;
    const bite = hasBudget ? (Number(budget.testimonySec)||0) : 0;
    blocks.forEach(b=>{
      const text = String((b && b.text)||"");
      const w = text.trim().split(/\s+/).filter(Boolean).length;
      if(b.type==="scene") lines += hasBudget ? 0 : 2;
      else if(b.type==="action"){
        // each testimony note plays as its testimony; the rest of the paragraph still counts
        const notes = bite ? (text.match(_TESTIMONY_NOTE_RE)||[]).length : 0;
        const rw = notes ? text.replace(/\bEXPECTED TESTIMONY\b[^.!?…]*[.!?…]*/g, " ").trim().split(/\s+/).filter(Boolean).length : w;
        if(rw || !notes) lines += Math.ceil(rw/12)+1;
        extraSec += notes*bite;
      }
      else if(b.type==="char") lines += 2;
      else if(b.type==="paren") lines += 1;
      else if(b.type==="dia") lines += Math.ceil(w/7);
      else lines += hasBudget && b.type==="trans" ? 0 : 2; // transitions and anything else
    });
    const raw = Math.round(lines/55*60 + extraSec);
    if(!hasBudget) return { sec: Math.max(20, raw), approx:false };
    const floor = Math.max(1, Math.min(20, Math.floor(budget.sec)));
    return { sec: Math.max(floor, raw), approx:false, raw, lines: lines + Math.round(extraSec/60*55) };
  }
  if(hasBudget) return { sec: Math.max(1, Math.round(budget.sec)), approx:true, fromBudget:true };
  const rows = (beats && beats.rows) ? beats.rows.length : 0;
  if(rows) return { sec: Math.min(240, Math.max(45, rows*35)), approx:true };
  return { sec: 90, approx:true };
}
function fmtClock(sec){ const m = Math.floor(sec/60), s = Math.round(sec%60); return m+":"+String(s).padStart(2,"0"); }
/* a total or an act's length: seconds under two minutes (a 30 s spot reads "30 s", not
   "1 min" or "0 min"), whole minutes above */
function fmtRuntime(sec){ const s = Math.max(0, Number(sec)||0); return s < 120 ? Math.round(s)+" s" : Math.round(s/60)+" min"; }
window.sceneRuntime = sceneRuntime;
window.fmtClock = fmtClock;
window.fmtRuntime = fmtRuntime;

/* Milestone-kind labels. The CANONICAL vocabulary lives in the project's
   narrative framework (frameworks.jsx `kinds`); this Proxy keeps every existing
   `KIND_LABEL[kind]` lookup working while routing through it (three-act maps to
   exactly these classic labels). */
const KIND_LABEL_3ACT = {
  incite:"Inciting Incident", "act-climax":"Act Climax", midpoint:"Mid-Act Climax",
  crisis:"Crisis", "story-climax":"Story Climax", resolution:"Resolution",
};
const KIND_LABEL = new Proxy(KIND_LABEL_3ACT, {
  get:(base, k)=> (typeof fwKindLabel==="function") ? (fwKindLabel(k) ?? base[k]) : base[k],
});

function ChargeChip({ value, label }){
  return React.createElement("span",{className:`chip ${chargeClass(value)}`},
    label && React.createElement("span",{style:{opacity:.7,fontWeight:500}},label),
    chargeStr(value));
}
window.ChargeChip = ChargeChip;

/* ---- character throughline (the "follow this character" lens) ----
   Derived ONLY from data the spine already owns (scenes + beatsMap), so it can
   never drift from the story: drives = scene.driver; appears = named as the
   beats' driver/reactor or in the summary; arc turns = the charge of consecutive
   DRIVEN scenes reverses sign (the same turn rule as turnInfo — chargeTurn). */
function charSolidColor(c){
  const m = /#[0-9a-fA-F]{3,8}/.exec((c && c.color) || "");
  return m ? m[0] : "#8d8a84";
}
function characterThroughline(char, scenes, beatsMap){
  const first = (((char && char.name) || "").trim().toLowerCase().split(/\s+/)[0]) || "";
  // 2026-09-28 (Round 1): the first name must appear as a WHOLE word ("Al" is not in "also",
  // "Jo" not in "join"); letters of any alphabet count as word letters, so "Zoë" and
  // "Zoë's" match while "Zoëlle" doesn't.
  const esc = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let named = null;
  try{ named = first ? new RegExp("(^|[^\\p{L}\\p{N}_])"+esc+"(?![\\p{L}\\p{N}_])", "u") : null; }
  catch(e){ named = first ? new RegExp("(^|[^a-z0-9_])"+esc+"(?![a-z0-9_])") : null; }
  const driven = scenes.filter(s => s.driver === char.id);
  const involvedIds = new Set(driven.map(s => s.id));
  scenes.forEach(s => {
    if(involvedIds.has(s.id)) return;
    const b = (beatsMap && beatsMap[s.id]) || {};
    const hay = [b.driverLabel, b.reactorLabel, s.summary].filter(Boolean).join(" ").toLowerCase();
    if(named && named.test(hay)) involvedIds.add(s.id);
  });
  // 2026-09-28 (Round 1): count every act the story's structure has (a four-act shape such as
  // Kishōtenketsu has an Act IV), plus any act a driven scene sits in beyond it.
  const actNos = ((typeof fwActNos==="function") ? fwActNos() : null) || [1, 2, 3];
  const acts = Array.from(new Set(actNos.concat(driven.map(s => Number(s.act)).filter(a => a > 0)))).sort((a, b) => a - b);
  const turnIds = new Set(); const turnsByAct = {};
  acts.forEach(a => { turnsByAct[a] = 0; });
  driven.forEach((s, i) => {
    const prev = i ? driven[i-1].closeCharge : s.openCharge;
    const turned = (typeof chargeTurn==="function") ? chargeTurn(prev, s.closeCharge).turned
      : Math.sign(prev)*Math.sign(s.closeCharge) < 0;
    if(turned){ turnIds.add(s.id); turnsByAct[s.act] = (turnsByAct[s.act]||0) + 1; }
  });
  // verdict — names the classic failure: a character who turns early then coasts
  const total = turnIds.size;
  let verdict, flat = false;
  if(!driven.length){ verdict = "Drives no scenes yet — set them as a scene’s driver and their arc appears here."; flat = true; }
  else if(!total){ verdict = "Arc is flat — none of their driven scenes move their value."; flat = true; }
  else {
    const lastTurnIdx = driven.reduce((acc, s, i) => turnIds.has(s.id) ? i : acc, -1);
    const coastAfter = driven.length - 1 - lastTurnIdx;
    const roman = (a)=> ["I","II","III","IV","V","VI"][a-1] || String(a);
    if(turnsByAct[1] >= 2 && acts.every(a => a === 1 || !turnsByAct[a])){
      verdict = `All the movement is in Act I (×${turnsByAct[1]}) — the arc coasts from there.`; flat = true;
    } else if(coastAfter >= 3){
      verdict = `Turns ${total}×, then coasts — the last ${coastAfter} scenes they drive don’t move them.`; flat = true;
    } else {
      verdict = `Arc turns ${total}× · ` + acts.map((a, i) => (i ? "" : "Act ") + roman(a) + " ×" + turnsByAct[a]).join(" · ") + ".";
    }
  }
  return { driven, involvedIds, turnIds, turnsByAct, verdict, flat };
}
window.characterThroughline = characterThroughline;
window.charSolidColor = charSolidColor;

/* chip-per-character strip above the spine graph — click to follow / unfollow */
function FollowStrip({ characters, scenes, beatsMap, followId, onFollow }){
  if(!characters || !characters.length) return null;
  const cur = followId ? characters.find(c => c.id === followId) : null;
  const tl = cur ? characterThroughline(cur, scenes, beatsMap) : null;
  return React.createElement("div",{className:"follow-strip"},
    React.createElement("div",{className:"follow-row"},
      React.createElement("span",{className:"eyebrow",
        style:{marginRight:2,display:"inline-flex",alignItems:"center",gap:5}},
        React.createElement(Icon.user,{s:12}),"Follow"),
      characters.map(c => {
        const on = followId === c.id;
        const driven = scenes.filter(s => s.driver === c.id).length;
        return React.createElement("button",{key:c.id,
          className:"follow-chip"+(on?" on":""),
          style: on ? {borderColor:charSolidColor(c)} : null,
          title: on ? "Stop following" : `Follow ${c.name} across the spine`,
          onClick:()=>onFollow(on ? null : c.id)},
          React.createElement("span",{className:"follow-av",style:{background:c.color}}),
          // chips show first names only; the tooltip keeps the full name
          React.createElement("span",{className:"follow-name"},String(c.name||"").trim().split(/\s+/)[0]),
          React.createElement("span",{className:"follow-n"},driven));
      })),
    cur && React.createElement("div",{className:"follow-insight"+(tl.flat?" warn":"")},
      tl.flat ? React.createElement(Icon.alert,{s:12}) : React.createElement(Icon.check,{s:12}),
      React.createElement("span",null,tl.verdict),
      React.createElement("span",{className:"follow-key"},
        React.createElement("span",{className:"follow-key-dot",style:{borderColor:charSolidColor(cur)}}),"drives",
        React.createElement("span",{className:"follow-key-dot dash",style:{borderColor:charSolidColor(cur)}}),"arc turns")));
}
window.FollowStrip = FollowStrip;

/* catmull-rom smoothing shared by the base spine and the follow overlay */
function smoothD(pts){
  if(pts.length < 2) return pts.map((p,i)=>`${i?"L":"M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for(let i=0;i<pts.length-1;i++){
    const p0 = pts[i-1]||pts[i], p1 = pts[i], p2 = pts[i+1], p3 = pts[i+2]||p2;
    const c1x = p1.x + (p2.x - p0.x)/6, c1y = p1.y + (p2.y - p0.y)/6;
    const c2x = p2.x - (p3.x - p1.x)/6, c2y = p2.y - (p3.y - p1.y)/6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/* the scene card's screen-time tooltip. LONG FOR THIS FORMAT (docs/Story Pipeline.md step 5):
   a drafted scene past 1.5× its budget (sceneLengthCheck in formats.jsx) — a free warning;
   nothing is rewritten automatically. */
function runtimeTip(r){
  if(!r) return "";
  const b = r.budget;
  const of = (b && typeof budgetPhrase==="function") ? " ("+budgetPhrase(b)+")" : "";
  if(r.long && b) return "Long for this format \u2014 about "+fmtClock(r.sec)+" against a budget of about "+fmtClock(b.sec)+of+
    ". Nothing is rewritten automatically: trim it in the Script view, or reshape the beats and Redraft script from beats.";
  if(r.approx) return "Estimated screen time (rough \u2014 "+(r.fromBudget ? "this format\u2019s budget per scene" : "from beats")+", not yet drafted)";
  return "Estimated screen time (from the draft, \u22481 page/min)"+(b ? " \u2014 budget about "+fmtClock(b.sec)+of : "");
}
window.runtimeTip = runtimeTip;

/* SpineCanvas — the value spine in the homepage style (owner 2026-10-16, "Kinolot Rooms in the Homepage
   Style"): a flat bone chart that fits the canvas (a long film keeps a minimum width per scene and the
   chart pans sideways), the act labels inside it, an ink line through amber (positive) and blue
   (negative) closing charges — and under it the scenes as tiles in a grid: number, title, the charge
   line, a red mark when a scene doesn't turn, the runtime. Every function of the old filmstrip stays:
   select, drag to reorder, keyboard, fold an act (its label in the chart, or its tile), the follow
   lens, the structural peaks, the out-of-date and long-for-this-format marks, Add scene. */
const SPINE_MIN_COL = 34, SPINE_FOLD_W = 30, SPINE_CHART_H = 276, SPINE_PAD_X = 14, SPINE_TOP = 58, SPINE_BOT = 24;
function SpineCanvas({ scenes, selId, onSelect, onReorder, onAddScene, follow, runtimes, readOnly, staleIds }){
  // minutes per act, for the act labels' pacing readout
  const actMin = (act)=>{
    if(!runtimes) return null;
    const sec = scenes.filter(s=>s.act===act).reduce((a,s)=> a + ((runtimes[s.id]||{}).sec||0), 0);
    return sec ? fmtRuntime(sec) : null;
  };
  const [dragIdx, setDragIdx] = React.useState(null);
  const [overIdx, setOverIdx] = React.useState(null);
  // per-act fold state (persisted) — fold an act to a narrow band to focus the arc
  const [collapsed, setCollapsed] = React.useState(()=>{ try{ return JSON.parse(localStorage.getItem("turn_spine_collapsed")||"{}")||{}; }catch(e){ return {}; } });
  React.useEffect(()=>{ try{ localStorage.setItem("turn_spine_collapsed", JSON.stringify(collapsed)); }catch(e){} },[collapsed]);
  const toggle = (act)=> setCollapsed(c=>({...c,[act]:!c[act]}));
  // the chart fits the width it's given (measured), never narrower than SPINE_MIN_COL a scene
  const [boxW, setBoxW] = React.useState(0);
  const boxRef = React.useRef(null);
  React.useEffect(()=>{
    const el = boxRef.current; if(!el || typeof ResizeObserver!=="function") return undefined;
    const ro = new ResizeObserver(()=>{ const w = Math.floor(el.clientWidth||0); setBoxW(x=> x===w ? x : w); });
    ro.observe(el); return ()=>ro.disconnect();
  },[]);
  const roman = (a)=> ["I","II","III","IV"][a-1] || String(a);
  // act names come from the project's narrative framework (Three-Act: Setup /
  // Complication / Resolution; Kishōtenketsu: Ki / Shō / Ten / Ketsu)
  const actName = (a)=> (typeof fwActName==="function") ? fwActName(a) : (({1:"Setup",2:"Complication",3:"Resolution"})[a] || ("Act "+a));
  // 2026-09-28 (Round 1): the act labels and scene tiles take keyboard focus and act on Enter /
  // Space, and carry a spoken name (screen readers).
  const keyActivate = (fn)=> (e)=>{
    if(e.target!==e.currentTarget) return;
    if(e.key==="Enter" || e.key===" "){ e.preventDefault(); fn(); }
  };
  // a scene tile's spoken name: what the tile shows (the grip, pips and marks are visual only)
  const sceneCardLabel = (s, stale, rt)=> "Scene "+s.no+(s.title?": "+s.title:"")+
    ", "+chargeStr(s.openCharge)+" to "+chargeStr(s.closeCharge)+", "+turnBadgeOf(s).word+
    (stale ? ", script out of date" : "")+
    (rt ? ", "+(rt.long ? fmtClock(rt.sec)+", long for this format" : (rt.approx?"about ":"")+fmtClock(rt.sec)) : "");
  const actBandA11y = (act, isCollapsed, figures)=>({ role:"button", tabIndex:0, "aria-expanded":!isCollapsed,
    "aria-label":(isCollapsed?"Expand":"Collapse")+" Act "+roman(act)+" — "+actName(act)+(figures?", "+figures:""),
    onKeyDown:keyActivate(()=>toggle(act)) });

  // group scenes into consecutive acts, then flatten to COLUMNS — a column is either one
  // scene, or (for a folded act) one narrow band. The act labels, the line and the hit
  // targets all lay out from this column model so they stay aligned.
  const actGroups = [];
  scenes.forEach((s, i) => { const last = actGroups[actGroups.length - 1];
    if (!last || last.act !== s.act) actGroups.push({ act:s.act, items:[{s,i}] }); else last.items.push({s,i}); });
  const columns = [];
  actGroups.forEach(g => { if(collapsed[g.act]) columns.push({ kind:"act", act:g.act, count:g.items.length });
    else g.items.forEach(it => columns.push({ kind:"scene", s:it.s, i:it.i })); });
  const nScene = columns.filter(c=>c.kind==="scene").length, nFold = columns.length - nScene;
  const room = Math.max(0, (boxW||0) - 2 - SPINE_PAD_X*2 - nFold*SPINE_FOLD_W);   // 2: the chart's border
  const colW = nScene ? Math.max(SPINE_MIN_COL, Math.floor(room / nScene) || SPINE_MIN_COL) : SPINE_MIN_COL;
  const wOf = (c)=> c.kind==="scene" ? colW : SPINE_FOLD_W;
  const lefts = []; let _cur = SPINE_PAD_X;
  columns.forEach((c,ci)=>{ lefts[ci] = _cur; _cur += wOf(c); });
  const totalW = Math.max(_cur + SPINE_PAD_X, (boxW||0) - 2);
  const centerOf = (ci)=> lefts[ci] + wOf(columns[ci])/2;
  const H = SPINE_CHART_H;
  const yFor = (charge)=> SPINE_TOP + ((3 - charge) / 6) * (H - SPINE_BOT - SPINE_TOP);   // +3 → top, −3 → bottom

  // one label per act, with its x-extent across the columns
  const ruler = [];
  columns.forEach((c,ci)=>{ const act = c.kind==="act" ? c.act : c.s.act; const last = ruler[ruler.length-1];
    if(!last || last.act!==act) ruler.push({ act, firstCi:ci, lastCi:ci, collapsed:c.kind==="act", count:c.kind==="act"?c.count:1 });
    else { last.lastCi = ci; last.count += 1; } });
  const bandL = (r)=> lefts[r.firstCi], bandW = (r)=> (lefts[r.lastCi] + wOf(columns[r.lastCi])) - lefts[r.firstCi];

  // the line through the VISIBLE scenes (folded acts are skipped)
  const pts = [];
  columns.forEach((c,ci)=>{ if(c.kind==="scene") pts.push({ x:centerOf(ci), y:yFor(c.s.closeCharge), s:c.s, i:c.i, ci }); });
  // follow lens — the followed character's own arc through the scenes they DRIVE
  const fpts = follow ? pts.filter(p => follow.drivenIds.has(p.s.id)) : [];
  const fInvolved = (s)=> !follow || follow.involvedIds.has(s.id);
  const chargeCls = (v)=> v>0 ? "pos" : v<0 ? "neg" : "zero";
  // the framework's structural peaks get the big marker (every framework, not just three-act)
  const _peaks = (typeof frameworkOf==="function" && frameworkOf(window.turnProject).peakKinds) || ["incite","story-climax","act-climax","midpoint","crisis"];
  const roomy = colW >= 70;   // secondary plot labels only when the columns have room for them

  return React.createElement("div",{className:"spine-wrap spine-hs",ref:boxRef},
    // ---- the chart (grab to pan a long film sideways) ----
    React.createElement(DragScroll,{className:"spine-chart"},
      React.createElement("div",{className:"spine-chart-in",style:{width:totalW,height:H}},
        // act labels — click (or Enter / Space) to fold or unfold the act
        React.createElement("div",{className:"act-ruler"},
          ruler.map(r => {
            if(r.collapsed) return React.createElement("div",{key:r.act,className:"act-band collapsed",
              style:{left:bandL(r),width:SPINE_FOLD_W,height:H},
              onClick:()=>toggle(r.act),title:`Expand Act ${roman(r.act)}`,
              ...actBandA11y(r.act, true, r.count+" scene"+(r.count!==1?"s":""))},
              React.createElement("span",{className:"no"},`ACT ${roman(r.act)} · ${r.count}`));
            const pct = Math.round((r.count / scenes.length) * 100);
            const mins = actMin(r.act);
            return React.createElement("div",{key:r.act,className:"act-band",style:{left:bandL(r),width:bandW(r)},
              onClick:()=>toggle(r.act),title:`Fold Act ${roman(r.act)}`,
              ...actBandA11y(r.act, false, (mins!=null ? "about "+mins+", " : "")+pct+"% of the scenes")},
              React.createElement("span",{className:"no"},`ACT ${roman(r.act)}`),
              React.createElement("span",{className:"nm"},actName(r.act)),
              mins!=null && React.createElement("span",{className:"act-min",
                title:`Act ${roman(r.act)} estimated screen time (≈1 page/min)`},`≈${mins}`),
              React.createElement("span",{className:"pct"},`${pct}%`),
              React.createElement("span",{className:"act-fold-ic","aria-hidden":"true"},React.createElement(Icon.chevL,{s:11})));
          })),
        React.createElement("svg",{className:"graph-svg",width:totalW,height:H,viewBox:`0 0 ${totalW} ${H}`,role:"img",
          // a summary for screen readers: how each scene's value charge moves (2026-10-09)
          "aria-label":"Value-charge graph: "+(scenes||[]).slice(0,40).map(sc=>"Scene "+sc.no+((sc.openCharge!=null&&sc.closeCharge!=null)?(" "+chargeStr(sc.openCharge)+" to "+chargeStr(sc.closeCharge)):"")).join(", ")},
          // the charge fill clips at the zero line: amber above, blue below (2026-10-16 polish)
          React.createElement("defs",null,
            React.createElement("clipPath",{id:"spClipPos"},React.createElement("rect",{x:0,y:0,width:totalW,height:yFor(0)})),
            React.createElement("clipPath",{id:"spClipNeg"},React.createElement("rect",{x:0,y:yFor(0),width:totalW,height:H-yFor(0)}))),
          // every other act sits on a faint shade, so the acts read as blocks
          ruler.filter((r,k)=>!r.collapsed && k%2===1).map(r=>React.createElement("rect",{key:"sh"+r.act,className:"sp-act-shade",
            x:bandL(r),y:0,width:bandW(r),height:H})),
          // the zero line, and faint lines at ±3, with their values at the left edge
          React.createElement("line",{className:"sp-zero",x1:SPINE_PAD_X/2,y1:yFor(0),x2:totalW-SPINE_PAD_X/2,y2:yFor(0)}),
          [3,-3].map(g=>React.createElement("line",{key:"g"+g,className:"sp-grid",x1:SPINE_PAD_X/2,y1:yFor(g),x2:totalW-SPINE_PAD_X/2,y2:yFor(g)})),
          [[3,"+3"],[0,"0"],[-3,"\u22123"]].map(([g,t])=>React.createElement("text",{key:"yl"+g,className:"sp-ylab",
            x:4,y:yFor(g)-4,"aria-hidden":"true"},t)),
          // act dividers (before each act except the first)
          ruler.slice(1).map(r => React.createElement("line",{key:"ad"+r.act,className:"sp-act",
            x1:bandL(r),y1:6,x2:bandL(r),y2:H-4})),
          // folded acts — a quiet band, click to unfold
          ruler.filter(r=>r.collapsed).map(r => React.createElement("rect",{key:"cb"+r.act,className:"sp-fold",
            x:bandL(r)+3,y:6,width:SPINE_FOLD_W-6,height:H-12,rx:6,onClick:()=>toggle(r.act)})),
          // the soft charge fill between the line and zero (hidden while following a character)
          pts.length>=2 && !follow && (()=>{ const d = smoothD(pts)+` L${pts[pts.length-1].x} ${yFor(0)} L${pts[0].x} ${yFor(0)} Z`;
            return React.createElement("g",{pointerEvents:"none"},
              React.createElement("path",{className:"sp-area pos",d,clipPath:"url(#spClipPos)"}),
              React.createElement("path",{className:"sp-area neg",d,clipPath:"url(#spClipNeg)"})); })(),
          // a guide down the selected scene's column, so the point and its tile below connect
          pts.filter(p=>p.s.id===selId).map(p=>React.createElement("line",{key:"guide",className:"sp-guide",
            x1:p.x,y1:SPINE_TOP-14,x2:p.x,y2:H-6})),
          // the spine line (recedes while following, so the character's arc reads on top)
          pts.length>=2 && React.createElement("path",{className:"spine-line",d:smoothD(pts),fill:"none",
            strokeLinejoin:"round",strokeLinecap:"round",pointerEvents:"none",opacity:follow?.3:1}),
          // follow overlay — the character's own arc through their driven scenes
          follow && fpts.length>=2 && React.createElement("path",{d:smoothD(fpts),fill:"none",
            stroke:follow.color,strokeWidth:2.4,strokeLinejoin:"round",strokeLinecap:"round",pointerEvents:"none",opacity:.95}),
          // markers (decorative — clicks land on the hit columns below)
          pts.map(p => {
            const { flagged, progression } = turnInfo(p.s);
            const sel = p.s.id === selId;
            const big = _peaks.includes(p.s.kind);
            const r0 = big ? 6 : 4.5;
            const fDrives = follow && follow.drivenIds.has(p.s.id);
            const fTurn = follow && follow.turnIds.has(p.s.id);
            return React.createElement("g",{key:"m"+p.i,pointerEvents:"none",opacity:fInvolved(p.s)?1:.22},
              sel && React.createElement("circle",{className:"sp-sel",cx:p.x,cy:p.y,r:big?13:11}),
              // follow lens: solid ring = they drive this scene; dashed ring = their arc turns here
              fDrives && React.createElement("circle",{cx:p.x,cy:p.y,r:big?10.5:8.5,fill:"none",
                stroke:follow.color,strokeWidth:1.5,opacity:.9}),
              fTurn && React.createElement("circle",{cx:p.x,cy:p.y,r:big?15:13,fill:"none",
                stroke:follow.color,strokeWidth:1.5,strokeDasharray:"3 3",opacity:.75}),
              big && React.createElement("circle",{className:"sp-peak "+chargeCls(p.s.closeCharge),cx:p.x,cy:p.y,r:9.5}),
              React.createElement("circle",{className:"spine-node "+chargeCls(p.s.closeCharge),cx:p.x,cy:p.y,r:r0}),
              flagged && React.createElement("circle",{className:"sp-flag",cx:p.x,cy:p.y,r:r0+1.5}),
              // progression: intensified on the same side instead of reversing
              progression && React.createElement("circle",{className:"sp-prog",cx:p.x,cy:p.y,r:r0+1.5}));
          }),
          // the structural peaks' names (caps) + secondary plot labels (when the columns have room)
          pts.map(p => {
            const main = KIND_LABEL[p.s.kind];
            const label = main || (roomy ? p.s.plot : "");
            if(!label) return null;
            const above = p.s.closeCharge >= 0;
            // kept inside the chart: a label that would run past an edge is anchored to it instead
            const half = String(label).length*2.9 + 2, lo = SPINE_PAD_X/2, hi = totalW - SPINE_PAD_X/2;
            const anchor = p.x - half < lo ? "start" : p.x + half > hi ? "end" : "middle";
            const x = anchor==="start" ? Math.max(lo, p.x - 10) : anchor==="end" ? Math.min(hi, p.x + 10) : p.x;
            return React.createElement("text",{key:"t"+p.i,className:"sp-kind"+(main?" main":""),x,
              y: above ? Math.max(SPINE_TOP-14, p.y-16) : Math.min(H-8, p.y+23), textAnchor:anchor,pointerEvents:"none"},label);
          }),
          // hit columns — full-height transparent click targets, one per visible scene
          pts.map(p => React.createElement("rect",{key:"hit"+p.i,className:"sp-hit",
            x:lefts[p.ci], y:0, width:colW, height:H, "data-sel":p.s.id===selId?"1":undefined, onClick:()=>onSelect(p.s.id)},
            React.createElement("title",null,"Scene "+String(p.s.no).padStart(2,"0")+(p.s.title?" · "+p.s.title:"")))))),
    ),

    // ---- the scene tiles ----
    React.createElement("div",{className:"filmstrip spine-tiles"},
      actGroups.map(g => {
        // a folded act → one tile that unfolds it (mirrors its band in the chart)
        if(collapsed[g.act]) return React.createElement("div",{key:"acol"+g.act,className:"spine-act-strip stile-fold",
          onClick:()=>toggle(g.act),title:`Expand Act ${roman(g.act)}`,role:"button",tabIndex:0,"aria-label":`Expand Act ${roman(g.act)}`,
          onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); toggle(g.act); } }},
          React.createElement("span",{className:"stile-no"},"ACT "+roman(g.act)),
          React.createElement("span",{className:"stile-title"},actName(g.act)),
          React.createElement("span",{className:"stile-fold-n"},g.items.length+" scene"+(g.items.length!==1?"s":"")+" · unfold"));
        return g.items.map(({s, i:ci}) => {
          const ti = turnInfo(s), { flagged } = ti;
          const sel = s.id === selId;
          const fDrives = follow && follow.drivenIds.has(s.id);
          const stale = !!(staleIds && staleIds.has(s.id));
          const rt = runtimes && runtimes[s.id];
          return React.createElement("div",{key:s.id,
            draggable:!readOnly,
            onDragStart:(e)=>{ if(readOnly){ e.preventDefault(); return; } setDragIdx(ci); e.dataTransfer.effectAllowed="move"; },
            onDragOver:(e)=>{ if(readOnly) return; e.preventDefault(); if(overIdx!==ci) setOverIdx(ci); },
            onDragEnd:()=>{ setDragIdx(null); setOverIdx(null); },
            onDrop:(e)=>{ if(readOnly) return; e.preventDefault(); if(dragIdx!=null && dragIdx!==ci) onReorder(dragIdx, ci); setDragIdx(null); setOverIdx(null); },
            className:`scard stile ${sel?"sel":""} ${flagged?"flagged":""} ${s.kind==="incite"?"incite":""} `+
                      `${["story-climax","act-climax","midpoint"].includes(s.kind)?"climax":""} `+
                      `${dragIdx===ci?"dragging":""} ${overIdx===ci&&dragIdx!=null&&dragIdx!==ci?"dragover":""} `+
                      `${follow && !fInvolved(s) ? "dim":""}`,
            style: fDrives ? {boxShadow:`inset 0 2px 0 ${follow.color}`} : undefined,
            onClick:()=>onSelect(s.id),
            role:"button", tabIndex:0, onKeyDown:keyActivate(()=>onSelect(s.id)),
            "aria-current":sel?"true":undefined,
            "aria-label":sceneCardLabel(s, stale, rt)},
            React.createElement("div",{className:"scard-top stile-top"},
              React.createElement("span",{className:"scard-no stile-no"},String(s.no).padStart(2,"0")),
              React.createElement("div",{className:"scard-conf",title:`Conflict source: ${["Inner","Personal","Extra-personal"][s.conf-1]||s.conf}`},
                [1,2,3].map(k=>React.createElement("span",{key:k,className:`conf-pip ${k<=s.conf?"on":""}`}))),
              // a red mark when the scene doesn't turn; a violet one when it progresses
              flagged && React.createElement("span",{className:"stile-mark no",title:turnBadgeOf(s).word},React.createElement(Icon.alert,{s:11})),
              !flagged && ti.progression && React.createElement("span",{className:"stile-mark prog",title:"Progresses — intensifies on the same side instead of reversing"},
                React.createElement(Icon.arrowSmall,{s:11})),
              stale && React.createElement("span",{className:"scard-stale",
                title:"Script out of date — the card changed after the draft. Redraft it from the Script view or the Scene tab."},
                React.createElement(Icon.history,{s:11})),
              !readOnly && React.createElement("span",{className:"scard-grip",title:"Drag to reorder"},React.createElement(Icon.grip,{s:12}))),
            React.createElement("div",{className:"scard-title stile-title"},s.title),
            React.createElement("div",{className:"stile-foot"},
              React.createElement("span",{className:"stile-charge"},
                React.createElement("span",{className:chargeClass(s.openCharge)},chargeStr(s.openCharge).replace("-","−")),
                React.createElement("span",{className:"stile-arrow","aria-hidden":"true"},"→"),
                React.createElement("span",{className:chargeClass(s.closeCharge)},chargeStr(s.closeCharge).replace("-","−"))),
              // LONG FOR THIS FORMAT: amber with a warning mark; the tooltip names both lengths
              rt && React.createElement("span",{
                className:"scard-rt"+(rt.long?" hot":""),
                "data-long":rt.long?"1":undefined,
                "aria-label": rt.long ? fmtClock(rt.sec)+", long for this format" : undefined,
                title: runtimeTip(rt)},
                rt.long && React.createElement(Icon.alert,{s:9}),
                (rt.approx?"~":"")+fmtClock(rt.sec))));
        });
      }),
      onAddScene && React.createElement("button",{type:"button",className:"spine-add stile-add",disabled:readOnly,
        onClick:()=>onAddScene(scenes.length?scenes[scenes.length-1].id:null)},
        React.createElement(Icon.plus,{s:16}),"Add scene")),
  );
}
window.SpineCanvas = SpineCanvas;
window.KIND_LABEL = KIND_LABEL;

/* DragScroll — grab-to-pan horizontal scroller for desktop mouse.
   Touch uses native momentum scrolling (overflow-x). Excludes scene cards
   so their HTML5 drag-reorder still works. Suppresses the click that ends a pan. */
function DragScroll({ className, style, children }){
  const ref = React.useRef(null);
  const st = React.useRef({down:false,startX:0,startLeft:0,moved:false});
  const EXCLUDE = ".scard, .spine-add, .tree-scene, select, input, textarea, button";

  const onDown = (e)=>{
    const el = ref.current; if(!el) return;
    st.current.moved = false;                        // reset at the start of ANY interaction
    if(e.pointerType==="touch") return;             // let native touch-scroll handle mobile
    if(e.button!==undefined && e.button!==0) return; // primary button only
    if(e.target.closest && e.target.closest(EXCLUDE)) return; // don't hijack cards/controls
    st.current = {down:true,startX:e.clientX,startLeft:el.scrollLeft,moved:false};
    el.classList.add("grabbing");
  };
  const onMove = (e)=>{
    const el = ref.current; if(!el || !st.current.down) return;
    const dx = e.clientX - st.current.startX;
    if(Math.abs(dx) > 4) st.current.moved = true;
    el.scrollLeft = st.current.startLeft - dx;
  };
  const onUp = ()=>{
    const el = ref.current; if(el) el.classList.remove("grabbing");
    st.current.down = false;
  };
  const onClickCapture = (e)=>{
    if(st.current.moved){ e.stopPropagation(); e.preventDefault(); st.current.moved = false; }
  };
  React.useEffect(()=>{
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return ()=>{ window.removeEventListener("pointermove",onMove);
      window.removeEventListener("pointerup",onUp); window.removeEventListener("pointercancel",onUp); };
  },[]);
  return React.createElement("div",{ref,className,style,onPointerDown:onDown,onClickCapture},children);
}
window.DragScroll = DragScroll;
