/* agents-ui.jsx — the Story Editors panel (a modal in the Writers' Room; the Art Room's
   Department Heads open in it one at a time).
   Drives a chosen agent's bounded loop, renders the live reasoning trace,
   and gates every change behind an Approve / Reject proposal card. */

function AgentIcon({ name, s=18 }){
  const map = { stethoscope:Icon.target, link:Icon.layers, flask:Icon.flask, film:Icon.film, board:Icon.board, palette:Icon.palette, userScan:Icon.userScan, box:Icon.box, globe:Icon.globe, robot:Icon.robot, image:Icon.image, clapper:Icon.clapper, clipboard:Icon.clipboard||Icon.eye, check:Icon.check };
  const Ic = map[name] || Icon.sparkles;
  return React.createElement(Ic,{s});
}

const STEP_ICON = { plan:Icon.target, act:Icon.sparkles, observe:Icon.eye, ok:Icon.check,
  flag:Icon.alert, done:Icon.check, report:Icon.film };

/* URLs inside error/trace text (e.g. a provider's billing link) render as
   clickable links that open in a new tab. */
function _linkifyText(text){
  return String(text||"").split(/(https?:\/\/[^\s)"']*[^\s)"'.,;:!?])/g).map((part,i)=>
    /^https?:\/\//.test(part)
      ? React.createElement("a",{key:i,href:part,target:"_blank",rel:"noopener noreferrer"},part)
      : part);
}
window.turnLinkifyReact = _linkifyText;
function TraceStep({ step }){
  const Ic = STEP_ICON[step.k] || Icon.sparkles;
  return React.createElement("div",{className:"ag-step k-"+step.k},
    React.createElement("span",{className:"ag-step-ic"},React.createElement(Ic,{s:14})),
    React.createElement("div",{className:"ag-step-t"}, _linkifyText(step.t),
      step.report && React.createElement(TableReadReport,{rep:step.report}),
      step.voiceReport && React.createElement(VoiceCheckReport,{rep:step.voiceReport})));
}

/* per-character voice distinctiveness: fingerprints + the swappable lines */
function VoiceCheckReport({ rep }){
  const fps = rep.fingerprints||[], swaps = rep.swappable||[];
  return React.createElement("div",{className:"tr-report"},
    rep.verdict && React.createElement("div",{className:"tr-block"},
      React.createElement("div",{className:"tr-lab"},"Voice separation"),
      React.createElement("div",{className:"tr-txt"},rep.verdict)),
    fps.length>0 && React.createElement("div",{className:"tr-block"},
      React.createElement("div",{className:"tr-lab"},"Voice fingerprints"),
      fps.map((f,i)=>React.createElement("div",{key:i,className:"vc-fp"},
        React.createElement("span",{className:"vc-fp-name"},f.name),
        React.createElement("span",{className:"vc-fp-voice"},f.voice)))),
    React.createElement("div",{className:"tr-notes"},
      React.createElement("div",{className:"tr-lab"},"Swappable lines"+(swaps.length?(" · "+swaps.length):"")),
      swaps.length===0
        ? React.createElement("div",{className:"tr-txt"},"None — every line could only belong to its speaker.")
        : swaps.map((x,i)=>React.createElement("div",{key:i,className:"tr-note",...noteKeys(()=> x.scene && window.__turnJump && window.__turnJump(x.scene), x.scene),
            onClick:()=> x.scene && window.__turnJump && window.__turnJump(x.scene)},
            x.scene!=null && React.createElement("span",{className:"tr-note-sc"},"Sc "+x.scene),
            React.createElement("span",{className:"tr-note-tx"},
              React.createElement("b",null,(x.speaker||"?")+": "),"“"+x.line+"”",
              x.couldBe && React.createElement("em",{className:"vc-could"}," — could be "+x.couldBe+"."),
              x.why ? " "+x.why : "")))));
}

/* a note that opens its scene is reachable from the keyboard (2026-10-09) */
function noteKeys(go, scene){
  if(scene==null) return {};
  return { role:"button", tabIndex:0, "aria-label":"Open Scene "+scene,
    onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } } };
}
function TableReadReport({ rep, onJump }){
  return React.createElement("div",{className:"tr-report"},
    [["Pacing",rep.pacing],["Tone",rep.tone],["Voice",rep.voice],
     ["Visual writing",rep.visual],["Sound",rep.sound],["Page rhythm",rep.rhythm],
     ["Action ↔ dialogue",rep.causality],["Thematic payoff",rep.theme]].map(([k,v])=> v &&
      React.createElement("div",{key:k,className:"tr-block"},
        React.createElement("div",{className:"tr-lab"},k),
        React.createElement("div",{className:"tr-txt"},v))),
    rep.notes && rep.notes.length>0 && React.createElement("div",{className:"tr-notes"},
      React.createElement("div",{className:"tr-lab"},"Notes"),
      rep.notes.map((n,i)=>
        React.createElement("div",{key:i,className:"tr-note",...noteKeys(()=> n.scene && window.__turnJump && window.__turnJump(n.scene), n.scene),
          onClick:()=> n.scene && window.__turnJump && window.__turnJump(n.scene)},
          n.scene!=null && React.createElement("span",{className:"tr-note-sc"},"Sc "+n.scene),
          React.createElement("span",{className:"tr-note-tx"},n.issue,
            n.lens && React.createElement("em",{className:"tr-note-lens"}," · "+n.lens),
            n.fixAt==="design" && React.createElement("em",{className:"vc-could"},
              " \u2014 scene-design problem: rewording won't fix it; go back to the beats and the turn."))))));
}

/* rich proposal body for the Colorist agent: palette swatch bars + film stock + a
   per-scene colour strip with the per-scene rationale. */
function ColoristProposal({ proposal }){
  const p = proposal||{};
  const presets = p.presets||[];
  const byId = {}; presets.forEach(pr=>{ byId[pr.id]=pr; });
  const scenes = scenesInStoryOrder(p.scenes);
  const ss = p.sceneStyles||{};
  const why = (p.rationale && p.rationale.scenes) || {};
  const stock = (window.FILM_STOCKS||[]).find(f=>f.id===p.filmStock);
  const pad = (n)=>String(n).padStart(2,"0");
  const grad = (pr)=>{ const pal=(pr&&pr.palette)||[]; return pal.length>=3
    ? ("linear-gradient(135deg,"+pal[0]+" 0%,"+pal[1]+" 55%,"+pal[2]+" 100%)") : (pal[0]||"#555"); };
  return React.createElement("div",{className:"ag-color"},
    React.createElement("div",{className:"ag-color-presets"},
      presets.map(pr=> React.createElement("div",{className:"ag-color-preset",key:pr.id},
        React.createElement("div",{className:"ag-color-pname"}, pr.name),
        React.createElement("div",{className:"ag-color-bar"},
          (pr.palette||[]).slice(0,3).map((c,i)=>React.createElement("span",{key:i,style:{flex:[60,30,10][i]||10,background:c},title:c}))),
        pr.grade && React.createElement("div",{className:"ag-color-grade"}, pr.grade)))),
    (p.keptManual||[]).length>0 && React.createElement("div",{className:"ag-color-stock"},
      React.createElement("b",null,"Kept \u2014 "), (p.keptManual.length)+" scene"+(p.keptManual.length!==1?"s":"")+" you set by hand (\u270b) keep their look."),
    stock && stock.id!=="none" && React.createElement("div",{className:"ag-color-stock"},
      React.createElement("b",null,"Film stock — "), stock.name),
    scenes.length>0 && React.createElement("div",{className:"ag-color-strip"},
      scenes.map(s=>{ const pr=byId[ss[s.id]]; const kept=(p.keptManual||[]).indexOf(s.id)>=0;
        // a scene set by hand keeps its look (2026-10-03) — shown as kept, not as the proposal's pick
        return React.createElement("span",{key:s.id,className:"ag-color-cell"+(pr&&!kept?"":" none")+(kept?" kept":""),style:pr&&!kept?{background:grad(pr)}:undefined,
          title:"Sc "+pad(s.no)+" · "+(s.title||"")+(kept?" — keeps the look you set by hand":(pr?(" — "+pr.name):" — unassigned"))+(!kept&&why[s.id]?("\n"+why[s.id]):"")}, kept?"\u270b":pad(s.no)); })),
    Object.keys(why).length>0 && React.createElement("div",{className:"ag-color-whys"},
      scenes.filter(s=>why[s.id] && (p.keptManual||[]).indexOf(s.id)<0).map(s=>{ const pr=byId[ss[s.id]];
        return React.createElement("div",{key:s.id,className:"ag-color-why"},
          React.createElement("span",{className:"ag-color-why-sw",style:{background:grad(pr)}}),
          React.createElement("span",{className:"ag-color-why-no"}, pad(s.no)),
          React.createElement("span",{className:"ag-color-why-tx"}, why[s.id])); })));
}

function ProposalCard({ card, onApprove, onReject }){
  return React.createElement("div",{className:"ag-prop"+(card.danger?" danger":"")},
    React.createElement("div",{className:"ag-prop-h"},
      React.createElement(Icon.sparkles,{s:14}),
      React.createElement("span",{className:"ag-prop-title"},card.title),
      React.createElement("span",{className:"ag-prop-tag"},"Needs approval")),
    card.reason && React.createElement("div",{className:"ag-prop-reason"},card.reason),
    card.colorProposal && React.createElement(ColoristProposal,{proposal:card.colorProposal}),
    (card.before||card.after) && React.createElement("div",{className:"ag-diff"},
      React.createElement("div",{className:"ag-diff-row before"},
        React.createElement("span",{className:"ag-diff-lab"},"Now"),
        React.createElement("span",{className:"ag-diff-v"},card.before)),
      React.createElement("div",{className:"ag-diff-row after"},
        React.createElement("span",{className:"ag-diff-lab"},"Proposed"),
        React.createElement("span",{className:"ag-diff-v"},card.after))),
    card.list && React.createElement("div",{className:"ag-prop-list"},
      card.list.map((x,i)=>React.createElement("div",{key:i,className:"ag-prop-li"},x))),
    card.rationale && React.createElement("div",{className:"ag-prop-rat"},
      React.createElement(Icon.sparkles,{s:12}),card.rationale),
    React.createElement("div",{className:"ag-prop-act"},
      React.createElement("button",{className:"ag-btn ghost",onClick:onReject},"Reject"),
      React.createElement("button",{className:"ag-btn primary",onClick:onApprove},
        card.danger?"Replace project":"Approve & apply")));
}

const LOGLINE_EXAMPLES = [
  "A lighthouse keeper discovers the fog is erasing the town's memories \u2014 including her own.",
  "A grave-shift vending-machine restocker realizes one machine is dispensing objects from people's futures.",
  "Two estranged sisters must spend one last night in their flooding childhood home before it's demolished.",
  "A retired stunt double is hired to impersonate a dictator who may already be dead.",
  "A child's imaginary friend keeps showing up at her father's crime scenes.",
];

function IdeaHelper({ onPick }){
  const [open, setOpen] = React.useState(false);
  const [sparking, setSparking] = React.useState(false);
  const live = typeof aiAvailable==="function" && aiAvailable();
  const spark = async ()=>{
    if(sparking) return; setSparking(true);
    try{ const l = (typeof aiSparkLogline==="function") ? await aiSparkLogline() : null;
      if(l) onPick(l);
      else onPick(LOGLINE_EXAMPLES[Math.floor(Math.random()*LOGLINE_EXAMPLES.length)]);
    }catch(e){ onPick(LOGLINE_EXAMPLES[Math.floor(Math.random()*LOGLINE_EXAMPLES.length)]); }
    setSparking(false);
  };
  return React.createElement("div",{className:"idea-helper"},
    React.createElement("div",{className:"idea-bar"},
      React.createElement("span",{className:"idea-hint"},"Not sure where to start?"),
      live && React.createElement("button",{className:"idea-spark",onClick:spark,disabled:sparking},
        React.createElement(Icon.sparkles,{s:12}), sparking?"Sparking\u2026":"Spark an idea"),
      React.createElement("button",{className:"idea-toggle",onClick:()=>setOpen(o=>!o)},
        open?"Hide examples":"Show examples")),
    open && React.createElement("div",{className:"idea-list"},
      LOGLINE_EXAMPLES.map((ex,i)=>
        React.createElement("button",{key:i,className:"idea-ex",onClick:()=>onPick(ex)},
          React.createElement("span",{className:"idea-ex-q"},"\u201c"),ex))),
    React.createElement("div",{className:"idea-tip"},
      React.createElement(Icon.sparkles,{s:12}),
      "A good logline names ",React.createElement("b",null,"who"),", what they ",React.createElement("b",null,"want"),
      ", and what ",React.createElement("b",null,"stands in the way"),"."));
}

/* SAVED REPORTS — a read-only agent's last report, kept per film, so a Table-Read
   (a real multi-call model run) isn't lost the moment the panel closes. Only the
   report + closing line are kept, never the step-by-step trace. ONE store for all
   films with a global size budget: over budget, the films with the oldest reports
   are evicted first — which is also how reports of deleted films age out. */
const AGENT_REPORTS_LS_KEY = "turn.agentReports";
// the same film key the app's Undo uses (a signed-out user's new story is a new film, not "local" again — 2026-10-09)
function agentReportProjectId(){ return (typeof window.turnFilmToken==="function" && window.turnFilmToken()) || window.__turnCurrentProjectId || "local"; }
function loadAgentReportsAll(){
  try{ return JSON.parse(localStorage.getItem(AGENT_REPORTS_LS_KEY)||"{}") || {}; }catch(e){ return {}; }
}
function loadAgentReport(agentId){
  const perFilm = loadAgentReportsAll()[agentReportProjectId()];
  return (perFilm && perFilm[agentId]) || null;
}
function saveAgentReport(projectId, agentId, steps){
  try{
    const all = loadAgentReportsAll();
    (all[projectId] = all[projectId] || {})[agentId] = { ts: Date.now(), steps };
    let s = JSON.stringify(all);
    const newest = (pr)=> Math.max(0, ...Object.values(all[pr]||{}).map(r=>r.ts||0));
    while(s.length > 300000){
      const others = Object.keys(all).filter(p=>p!==projectId);
      if(others.length){ others.sort((a,b)=>newest(a)-newest(b)); delete all[others[0]]; }
      else{
        // this film's own reports blew the budget — drop its oldest agent report
        const ags = Object.keys(all[projectId]).sort((a,b)=>(all[projectId][a].ts||0)-(all[projectId][b].ts||0));
        if(ags.length<=1) return;   // a single report over the whole budget: skip saving it
        delete all[projectId][ags[0]];
      }
      s = JSON.stringify(all);
    }
    localStorage.setItem(AGENT_REPORTS_LS_KEY, s);
  }catch(e){ /* storage full or blocked — the live trace still showed everything */ }
}

function AgentRunner({ agent, ctxFactory, onClose, onView, onBack, initialInput, autoStart, runOnOpen, single, viewLabel, introExtra, force, onRunningChange }){
  const [trace, setTrace] = React.useState([]);
  // last saved report for THIS agent on THIS film (read-only agents only)
  const [saved] = React.useState(()=> agent.kind==="report" ? loadAgentReport(agent.id) : null);
  const [pending, setPending] = React.useState(null);   // proposal card awaiting decision
  const [status, setStatus] = React.useState("idle");   // idle|running|waiting|done
  const [input, setInput] = React.useState(initialInput||"");
  const resolver = React.useRef(null);
  const cancelled = React.useRef(false);
  // each run's own id: "Run again" after Stop starts a NEW run and must never revive the
  // stopped one (both used to read one shared flag, which start() resets to false)
  const runIdRef = React.useRef(0);
  const bodyRef = React.useRef(null);
  const inputRef = React.useRef(initialInput||"");
  React.useEffect(()=>{ inputRef.current = input; },[input]);

  // follows the newest step only while you're reading the bottom (2026-10-09 — it jumped on every step)
  const nearBottomRef = React.useRef(true);
  const onBodyScroll = ()=>{ const el = bodyRef.current; if(el) nearBottomRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 80; };
  React.useEffect(()=>{ if(bodyRef.current && (nearBottomRef.current || pending)) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; },[trace,pending]);
  // a new approval card takes the keyboard focus, so it's announced and reachable
  const cardRef = React.useRef(null);
  React.useEffect(()=>{ if(pending && cardRef.current){ try{ cardRef.current.focus(); }catch(e){} } },[pending]);
  const spendRef = React.useRef(null);   // the meter when the run started — Stop says what the run used so far
  React.useEffect(()=>()=>{ cancelled.current = true; if(resolver.current) resolver.current(false); },[]);
  // while this panel is open, ERROR toasts land HERE (bottom of the modal, links
  // clickable) instead of as a detached corner toast
  const [errNotes, setErrNotes] = React.useState([]);
  React.useEffect(()=>{
    const prev = window.turnErrorSink;
    window.turnErrorSink = (msg)=>{ setErrNotes(es=> es[es.length-1]===msg ? es : [...es, msg].slice(-3)); return true; };
    return ()=>{ window.turnErrorSink = prev; };
  },[]);
  // auto-run ONLY when launched with a prepared brief (New Story / Rebuild → the
  // Adaptation build): the model picker sat on the screen that prepared it. Every
  // other launch (all the Art Room tab buttons) opens READY — model picker live,
  // run starts on the user's press (user ruling 2026-07-16: never start a text
  // generation without the chance to switch engines first).
  React.useEffect(()=>{ if(autoStart && agent.needsInput && (initialInput||"").trim()){ const t=setTimeout(()=>start(),60); return ()=>clearTimeout(t); } },[]);
  // runOnOpen: the screen that opened this panel already named the writing model and had its
  // own Run button (Run pre-production's cost preview) — one press, not two (2026-09-26)
  React.useEffect(()=>{ if(runOnOpen){ const t=setTimeout(()=>start(),60); return ()=>clearTimeout(t); } },[]);

  // EVERY agent shows the model it will run on in its header (read-only): the one
  // writing-model control is the floating Writing dock. The run is pinned to what the
  // header shows, and the label follows a change made in the dock.
  const isArt = agent.room === "art";
  const _MODELS = window.WRITING_MODELS || [];
  const _task = isArt ? "specs" : "story";
  const [_mid0, setMid0] = React.useState(()=> (typeof window.getWritingModelId==="function") ? window.getWritingModelId(isArt?"specs":"story") : "");
  const _rec = (window.recommendedWritingModelId && window.recommendedWritingModelId(_task)) || "";
  React.useEffect(()=>{
    const h = ()=>{ if(typeof window.getWritingModelId==="function") setMid0(window.getWritingModelId(isArt?"specs":"story")); };
    window.addEventListener("turn-writing-model-changed", h);
    return ()=>window.removeEventListener("turn-writing-model-changed", h);
  },[isArt]);
  const _mid = _mid0 || "claude-opus-5-5";
  const _midLabel = ((_MODELS.find(m=>m.id===_mid)||{}).label) || "the default writing engine";   // never a raw id
  // what a run uses, said BEFORE it starts (2026-10-09, owner — Writers' Room review): free, or up to N writing calls
  const costLine = agent.maxCalls===0 ? "It makes no writing calls \u2014 running it is free."
    : (agent.maxCalls>0 ? "Running it uses "+((typeof window.turnWritingCallsText==="function") ? window.turnWritingCallsText(agent.maxCalls, isArt?"specs":"story").replace(/^about /,"up to ") : ("up to "+agent.maxCalls+" writing calls"))
        +" (writing credits; each is charged for what it uses) \u2014 what it used shows when it finishes."
      : "Running it uses writing credits; what it used shows when it finishes.");
  const start = async ()=>{
    const myRun = ++runIdRef.current;
    cancelled.current = false;
    setTrace([]); setPending(null); setStatus("running");
    const runLog = [];   // synchronous copy of the trace — state updates are async
    const reportProjectId = agentReportProjectId();   // the film this run BELONGS to — captured now, not at save time
    // PIN THE RUN to exactly what the header shows. Each LIVE run holds its own pin (2026-09-28):
    // a stopped run still winding down used to restore the pin it had captured — the NEWER run's
    // model — after that run ended, so the pin outlived every run and later Drafts, Redrafts and
    // spec calls ignored the Writing dock until reload. Now the newest live run's pin wins, and
    // when no run is live there is no pin at all: the dock decides again.
    const pins = window.__turnWritingPins = window.__turnWritingPins || [];
    const myPin = { model:_mid };
    pins.push(myPin);
    window.__forceWritingModel = _mid;
    // how many runs of each agent are live, app-wide (the Series auto-conversion waits for a
    // New Story build). A COUNT, not a flag: a stopped run still winding down must never
    // clear the mark of a newer run of the same agent.
    const runs = window.__turnAgentRunCount = window.__turnAgentRunCount || {};
    runs[agent.id] = (runs[agent.id]||0) + 1;
    try{ window.dispatchEvent(new CustomEvent("turn-agent-running",{ detail:{ id:agent.id, running:true } })); }catch(e){}
    let ctx = null, spend0 = null;
    try{
    ctx = ctxFactory({
      input: inputRef.current,
      agentName: agent.name,
      force: force,   // false | true | "draft" (re-draft specs but skip image generation)
      emit:(step)=>{ if(runIdRef.current!==myRun) return; runLog.push(step); setTrace(tr=>[...tr, step]); },
      // a card that comes back after Stop (or a film switch) is never shown — it used to reopen the
      // stopped run and leave it on "Working…" (2026-10-09)
      propose:(card)=> (runIdRef.current!==myRun || cancelled.current) ? Promise.resolve(false) : new Promise(res=>{ setPending(card); setStatus("waiting");
        resolver.current = (val)=>{ resolver.current=null; setPending(null); setStatus("running"); res(val); }; }),
      cancelled:()=>cancelled.current || runIdRef.current!==myRun,
    });
    // meter snapshot — the delta shows what THIS run cost in writing-model use
    spend0 = (typeof window.turnTextSpend==="function") ? window.turnTextSpend() : null;
    spendRef.current = spend0;
    // the writing layer skips its cut-off retry once this run is stopped, and tells the trace when it retries
    window.__turnAgentRunCancelled = ()=> cancelled.current || runIdRef.current!==myRun;
    const onRetry = ()=>{ if(runIdRef.current===myRun && !cancelled.current)
      setTrace(tr=>[...tr,{k:"observe",t:"A reply was cut off, so it asked once more with more room (one more writing call)."}]); };
    const canListen = typeof window.addEventListener==="function";
    if(canListen) window.addEventListener("turn-writing-retry", onRetry);
    try{ await agent.run(ctx); } finally { if(canListen) window.removeEventListener("turn-writing-retry", onRetry); }
    }
    // a plain sentence, the technical detail for admins only (2026-10-09 — the raw exception was shown)
    catch(e){ if(runIdRef.current===myRun) setTrace(tr=>[...tr,{k:"flag",t:"Something went wrong and the run stopped \u2014 nothing more was changed. Try running it again."
      +(window.turnIsAdmin ? " [admin: "+String((e&&e.message)||e)+"]" : "")}]); }
    finally{
      if(runIdRef.current===myRun) window.__turnAgentRunCancelled = undefined;
      const at = pins.indexOf(myPin); if(at>=0) pins.splice(at,1);
      window.__forceWritingModel = pins.length ? pins[pins.length-1].model : undefined;
      runs[agent.id] = Math.max(0, (runs[agent.id]||1) - 1);
      try{ window.dispatchEvent(new CustomEvent("turn-agent-running",{ detail:{ id:agent.id, running:false } })); }catch(e){}
    }
    if(runIdRef.current!==myRun) return;   // superseded by "Run again": its tail never touches the new run's panel
    if(spend0 && typeof window.turnTextSpend==="function"){
      const s1 = window.turnTextSpend();
      const calls = s1.calls - spend0.calls;
      if(calls>0){ const cr = Math.round((s1.credits - spend0.credits)*100)/100;
        setTrace(tr=>[...tr,{k:"observe",t:"This run used "+calls+" writing-model call"+(calls===1?"":"s")+" · ≈"+cr+" credit"+(cr===1?"":"s")+" (estimate — see your account menu for the running total)."}]); }
      else setTrace(tr=>[...tr,{k:"observe",t:"This run made no writing-model calls — it cost nothing."}]);
    }
    // a film switch mid-run cancels the run silently at its next check — say so,
    // and never save a report from it (partial, and it belongs to the other film)
    const swapped = !!ctx && typeof ctx.switchedFilms==="function" && ctx.switchedFilms();
    if(swapped) setTrace(tr=>[...tr,{k:"flag",t:"You switched films, so this run stopped \u2014 nothing was changed or saved. Reopen the film it started in to run it there."}]);
    if(!cancelled.current) setStatus("done");
    // keep a read-only agent's report for next time the panel opens
    if(agent.kind==="report" && !cancelled.current && !swapped){
      const keep = runLog.filter(s=> s && (s.k==="report" || s.k==="done"));
      if(keep.some(s=>s.k==="report")) saveAgentReport(reportProjectId, agent.id, keep);
    }
  };

  const decide = (val)=>{ if(resolver.current) resolver.current(val); };

  const running = status==="running" || status==="waiting";
  // the panel asks before a close would silently stop a running build (2026-09-28)
  React.useEffect(()=>{ if(onRunningChange) onRunningChange(status==="running"); },[status]);
  React.useEffect(()=>()=>{ if(onRunningChange) onRunningChange(false); },[]);

  return React.createElement("div",{className:"ag-runner"},
    React.createElement("div",{className:"ag-runner-head"},
      React.createElement("button",{className:"ag-x",onClick:onBack,title:single?"Close":"All Story Editors","aria-label":single?"Close":"All Story Editors"},React.createElement(Icon.chevL,{s:16})),
      React.createElement("span",{className:"ag-runner-ic"},React.createElement(AgentIcon,{name:agent.icon,s:16})),
      React.createElement("div",{className:"ag-runner-t"},
        // the umbrella (Story Editors / Department Heads), then the job title — no persona:
        // the help assistant only answers, the editors do the work (owner, 2026-09-28)
        React.createElement("div",{className:"ag-runner-name"},
          React.createElement("span",{className:"ag-runner-muse"},
            ((typeof window.turnAgentUmbrella==="function") ? window.turnAgentUmbrella(agent) : "Story Editors")+" \u00b7 "),agent.name),
        React.createElement("div",{className:"ag-runner-sub"},
          status==="idle"?"Ready":status==="done"?"Finished":status==="waiting"?"Awaiting your approval":"Working\u2026")),
      // model picker sits at the header's right edge — the SAME spot as the New Story
      // window's picker, so the badge doesn't jump around between steps of one flow
      React.createElement("span",{className:"ag-runner-model",
          title:"The writing model this agent runs on"+(_mid===_rec?" (recommended for this work)":"")+". Change it in the Writing dock on the right edge, between runs."},
          _midLabel + (_mid===_rec ? " \u00b7 recommended" : "")),
      React.createElement("button",{className:"ag-x",onClick:onClose,title:"Close","aria-label":"Close"},React.createElement(Icon.x,{s:16}))),

    agent.needsInput && status==="idle" && React.createElement("div",{className:"ag-input-wrap"},
      React.createElement("div",{className:"ag-input-lab"},agent.inputLabel),
      React.createElement("textarea",{className:"ag-input",placeholder:agent.inputPlaceholder,value:input,
        onChange:e=>setInput(e.target.value),rows:3}),
      agent.ideaStarters && React.createElement(IdeaHelper,{onPick:setInput})),

    React.createElement("div",{className:"ag-body",ref:bodyRef,onScroll:onBodyScroll,"aria-live":"polite","aria-relevant":"additions"},
      status==="idle" && React.createElement("div",{className:"ag-intro"},
        React.createElement("p",null,agent.blurb),
        introExtra,
        React.createElement("div",{className:"ag-intro-note"},
          React.createElement(Icon.eye,{s:14}),
          agent.autonomous?"Runs on its own \u2014 you'll see each step as it works. Press Stop anytime. "+costLine:
          agent.kind==="report"?"Read-only \u2014 it reports, it won't change anything. "+costLine:
          "Every change is shown for your approval before it's applied \u2014 nothing is applied without your OK. "+costLine)),
      status==="idle" && saved && React.createElement(React.Fragment,null,
        React.createElement("div",{className:"ag-intro-note"},
          React.createElement(Icon.eye,{s:14}),
          "Last report \u2014 "+new Date(saved.ts).toLocaleString()+". Run again below for a fresh read."),
        // a kept report shows today's names (a report saved before a rename says the old ones)
        (saved.steps||[]).map((s,i)=>React.createElement(TraceStep,{key:"sv"+i,
          step:(s && typeof s.t==="string" && typeof window.turnDisplayNames==="function") ? { ...s, t:window.turnDisplayNames(s.t) } : s}))),
      trace.map((s,i)=>React.createElement(TraceStep,{key:i,step:s})),
      running && !pending && React.createElement("div",{className:"ag-thinking"},
        React.createElement("span",{className:"ai-typing"},React.createElement("i",null),React.createElement("i",null),React.createElement("i",null))),
      pending && React.createElement("div",{ref:cardRef,tabIndex:-1,role:"group","aria-label":"Needs your approval",style:{outline:"none"}},
        React.createElement(ProposalCard,{card:pending,
          onApprove:()=>decide(true),onReject:()=>decide(false)}))),

    errNotes.length>0 && React.createElement("div",{className:"ag-errbar",role:"alert"},
      React.createElement("span",{className:"ag-errbar-ic"},"⚠"),
      React.createElement("div",{className:"ag-errbar-msgs"},
        errNotes.map((m,i)=>React.createElement("div",{key:i,className:"ag-errbar-msg"}, _linkifyText(m)))),
      React.createElement("button",{className:"ag-errbar-x",onClick:()=>setErrNotes([]),title:"Dismiss","aria-label":"Dismiss"},"✕")),

    React.createElement("div",{className:"ag-runner-foot"},
      status==="idle" && React.createElement("button",{className:"ag-run",onClick:start},
        React.createElement(Icon.sparkles,{s:16}),"Run "+agent.name),
      running && React.createElement("button",{className:"ag-run stop",
        onClick:()=>{ cancelled.current=true; if(resolver.current) resolver.current(false); setStatus("done");
          // what the run used so far, said on Stop (a call already sent still finishes, and is charged)
          let used = "";
          try{ const s0 = spendRef.current, s1 = (typeof window.turnTextSpend==="function") ? window.turnTextSpend() : null;
            const n = s0 && s1 ? s1.calls - s0.calls : 0;
            if(n>0){ const cr = Math.round((s1.credits - s0.credits)*100)/100; used = " So far it used "+n+" writing call"+(n!==1?"s":"")+" \u00b7 \u2248"+cr+" credit"+(cr===1?"":"s")+"."; } }catch(e){}
          setTrace(tr=>[...tr,{k:"flag",t:"Stopped by you."+used+" A writing call already on its way still finishes (and is charged); nothing more is changed."}]); }},
        React.createElement(Icon.x,{s:16}),"Stop"),
      status==="done" && React.createElement(React.Fragment,null,
        React.createElement("button",{className:"ag-run ghost",onClick: single?onClose:onBack}, single?"Close":"\u2190 All Story Editors"),
        React.createElement("button",{className:"ag-run ghost",onClick:start},
          React.createElement(Icon.sparkles,{s:16}),"Run again"),
        onView && React.createElement("button",{className:"ag-run",onClick:()=>onView("spine")},
          viewLabel||"View story",React.createElement(Icon.chevR,{s:16})))));
}

function AgentsPanel({ onClose, onView, ctxFactory, aiOn, undoCount, undoLabel, onUndo, issues, initialAgentId, initialInput, autoStart, runOnOpen, single, viewLabel, introExtra, force, unwritten, unwrittenStandIns, finishInput }){
  const agents = window.AGENTS || [];
  const dn = (t)=> (typeof window.turnDisplayNames==="function") ? window.turnDisplayNames(t) : t;
  const [active, setActive] = React.useState(()=> initialAgentId ? (agents.find(a=>a.id===initialAgentId)||null) : null);
  const [auto, setAuto] = React.useState(!!autoStart);
  /* CLOSING A RUNNING BUILD (2026-09-28): the X, a click on the dark backdrop or "All Story Editors"
     unmounts the runner, and that stops the run. For the story build (a long, paid run) that
     used to happen silently on one stray click — now it asks first. */
  const runningRef = React.useRef(false);
  const leaveOk = async ()=>{
    const building = active && active.kind==="build" && active.room!=="art";
    // only the build asks (an earlier review's decision: closing any other editor closes at once)
    if(!(runningRef.current && building) || typeof window.appConfirm!=="function") return true;
    return !!(await window.appConfirm({ title:"Stop building this film?",
      body:"Closing this window stops the build now. Every scene already written is kept. To finish just the unwritten scenes later, open Story Editors and choose Finish writing this film.",
      confirmLabel:"Stop the build", cancelLabel:"Keep building", danger:true, safeDefault:true }));
  };
  const close = async ()=>{ if(await leaveOk()) onClose(); };
  /* FINISH WRITING THIS FILM (docs/Story Pipeline.md step 7 — "offers to finish just the unwritten
     scenes on the next run"; made reachable 2026-09-28): once the build window is closed, the
     build agent is hidden from the grid, so this row opens Adaptation on THIS film, READY (never
     auto-started), with the film's own brief. Its first proposal is "Finish writing this film first?". */
  const [finishLaunch, setFinishLaunch] = React.useState(null);
  const unwrittenN = Math.max(0, Number(unwritten)||0), standInN = Math.min(unwrittenN, Math.max(0, Number(unwrittenStandIns)||0));
  const openFinish = ()=>{ const a = agents.find(x=>x.id==="adapt"); if(!a) return;
    setFinishLaunch({ input:String(finishInput||"") }); setAuto(false); setActive(a); };
  const finishing = !!(finishLaunch && active && active.id==="adapt");
  const finishNote = finishing && React.createElement("div",{className:"ag-intro-note"},
    React.createElement(Icon.sparkles,{s:14}),
    "This film has "+unwrittenN+" unwritten scene"+(unwrittenN!==1?"s":"")+(standInN ? " ("+standInN+" of them "+(standInN===1?"a rough stand-in":"rough stand-ins")+")" : "")+
    ". Press Run Adaptation: it first offers to write just "+(unwrittenN===1?"that one":"those")+" \u2014 every scene already written stays untouched. Decline only if you want to rebuild the whole film from the logline above.");
  const iss = issues || {};
  const turnN = iss.doctor||0, contN = iss.continuity||0;
  const issueParts = [];
  // the Doctor's count is its full audit: say which part is scenes that don't turn and
  // which part is its other structural notes, never call them all "don't turn"
  // ISSUES (red: a scene that doesn't turn, a soft peak, a late inciting incident, a
  // continuity gap) vs NOTES (neutral: optional rhythm advice, severity 0)
  const noTurnN = Math.min(turnN, (iss.doctorNoTurn==null ? turnN : iss.doctorNoTurn)||0);
  const notesN = Math.min(turnN - noTurnN, Math.max(0, Number(iss.doctorNotes)||0));
  const structN = turnN - noTurnN - notesN;
  const issuesN = noTurnN + structN + contN;
  if(noTurnN) issueParts.push(noTurnN+(noTurnN>1?" scenes that don\u2019t turn":" scene that doesn\u2019t turn"));
  if(structN) issueParts.push(structN+" structural issue"+(structN>1?"s":""));
  const notesTx = notesN+" rhythm note"+(notesN>1?"s":"");
  if(contN) issueParts.push(contN+(contN>1?" continuity gaps":" continuity gap"));
  const doctorBadge = (a)=> a.id!=="doctor" ? null
    : (noTurnN+structN)>0 ? { n:noTurnN+structN, cls:"", word:"issue" } : notesN>0 ? { n:notesN, cls:" note", word:"note" } : null;
  // a real dialog: named, Escape closes it (asking first when a run is live), focus moves into it (2026-10-09)
  const panelRef = React.useRef(null);
  React.useEffect(()=>{ const back = document.activeElement;
    try{ panelRef.current && panelRef.current.focus(); }catch(e){}
    const onKey = (e)=>{ if(e.key==="Escape" && !document.querySelector(".appconfirm-overlay, .appconfirm")){ e.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey);
    return ()=>{ window.removeEventListener("keydown", onKey); try{ back && back.focus && back.focus(); }catch(e){} }; },[]);
  return React.createElement("div",{className:"ag-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) close(); }},
    React.createElement("div",{className:"ag-panel",ref:panelRef,tabIndex:-1,role:"dialog","aria-modal":"true","aria-label":"Story Editors",style:{outline:"none"}},
      active
        ? React.createElement(AgentRunner,{agent:active,ctxFactory,onClose:close,onView,single,viewLabel,
            introExtra: finishing ? finishNote : introExtra,
            onRunningChange:(v)=>{ runningRef.current = !!v; },
            force: active.id===initialAgentId ? force : false,
            onBack: single ? close : async ()=>{ if(!(await leaveOk())) return; setAuto(false); setFinishLaunch(null); setActive(null); },
            initialInput: finishing ? finishLaunch.input : (active.id===initialAgentId ? initialInput : ""),
            autoStart: !finishing && auto && active.id===initialAgentId,
            runOnOpen: !!runOnOpen && active.id===initialAgentId && !finishing})
        : React.createElement(React.Fragment,null,
            React.createElement("div",{className:"ag-head"},
              React.createElement("div",{className:"ag-head-t"},
                React.createElement("span",{className:"ag-orb"}),
                React.createElement("div",null,
                  React.createElement("div",{className:"ag-title"},"Story Editors"),
                  React.createElement("div",{className:"ag-sub"},"They read your whole story and suggest what to fix \u2014 nothing changes without your OK"))),
              React.createElement("button",{className:"ag-x",onClick:close,title:"Close","aria-label":"Close"},React.createElement(Icon.x,{s:16}))),
            issuesN>0
              ? React.createElement("div",{className:"ag-issues-row"},
                  React.createElement("span",{className:"ag-issues-badge"},issuesN),
                  React.createElement("span",{className:"ag-issues-tx"},
                    React.createElement("b",null,"That \u201c"+issuesN+"\u201d is your story health \u2014 "),
                    issueParts.join(" \u00b7 "),(notesN?" (plus "+notesTx+")":""),". ",
                    "Open ",((noTurnN+structN)?"Story Doctor":"Setups & Payoffs")," below to fix ",(issuesN>1?"them":"it"),"."))
              : notesN>0
              ? React.createElement("div",{className:"ag-issues-row notes"},
                  React.createElement("span",{className:"ag-issues-badge note"},notesN),
                  React.createElement("span",{className:"ag-issues-tx"},
                    React.createElement("b",null,"No structural or continuity issues. "),
                    "The Story Doctor has "+notesTx+" \u2014 optional craft advice, worth a look. Open Story Doctor below to review "+(notesN>1?"them":"it")+"."))
              : React.createElement("div",{className:"ag-issues-row clean"},
                  React.createElement("span",{className:"ag-issues-badge ok"},React.createElement(Icon.check,{s:12})),
                  React.createElement("span",{className:"ag-issues-tx"},"No open structural or continuity issues \u2014 your spine is sound.")),
            unwrittenN>0 && aiOn && React.createElement("div",{className:"ag-undo-row ag-finish-row"},
              React.createElement(Icon.flask,{s:14}),
              React.createElement("span",{className:"ag-undo-tx"},
                unwrittenN+" scene"+(unwrittenN!==1?"s aren\u2019t":" isn\u2019t")+" written yet"+(standInN ? " ("+standInN+" "+(standInN===1?"is a rough stand-in":"are rough stand-ins")+")" : "")+
                " \u2014 Adaptation can write just "+(unwrittenN===1?"that one":"those")+", leaving everything already written untouched."),
              React.createElement("button",{className:"ag-undo-btn",onClick:openFinish},"Finish writing this film")),
            undoCount>0 && React.createElement("div",{className:"ag-undo-row"},
              React.createElement(Icon.undo,{s:14}),
              React.createElement("span",{className:"ag-undo-tx"},
                undoCount>1 ? (undoCount+" runs can be undone \u2014 last was "+dn(undoLabel)) : (dn(undoLabel)+" made changes you can undo")),
              React.createElement("button",{className:"ag-undo-btn",onClick:onUndo},"Undo last")),
            !aiOn && React.createElement("div",{className:"ag-warn"},
              React.createElement(Icon.alert,{s:14}),"The writing model isn't available right now \u2014 the Story Editors use their built-in checks where they can, but anything that writes is limited."),
            React.createElement("div",{className:"ag-grid"},
              // creation lives in "New Story" now — hide the build agent (Adaptation)
              // from the picker, but keep it in the registry so New Story can drive it.
              // Art Room agents (the Production check included) launch from the Art Room.
              agents.filter(a=>a.kind!=="build" && a.room!=="art").map(a=>{
                const n = a.id==="doctor" ? 0 : (iss[a.id]||0);
                const db = doctorBadge(a);
                return React.createElement("button",{key:a.id,className:"ag-card",onClick:()=>setActive(a)},
                  React.createElement("div",{className:"ag-card-top"},
                    React.createElement("span",{className:"ag-card-ic"},React.createElement(AgentIcon,{name:a.icon,s:18})),
                    React.createElement("div",{className:"ag-card-tags"},
                      n>0 && React.createElement("span",{className:"ag-card-count"},n+(n>1?" issues":" issue")),
                      db && React.createElement("span",{className:"ag-card-count"+db.cls},db.n+" "+db.word+(db.n>1?"s":"")),
                      React.createElement("span",{className:"ag-card-kind k-"+a.kind},
                        a.kind==="fix"?"Fixes":a.kind==="build"?"Builds":"Reports"))),
                  React.createElement("div",{className:"ag-card-name"},a.name),
                  React.createElement("div",{className:"ag-card-blurb"},a.blurb),
                  React.createElement("div",{className:"ag-card-go"},"Open ",React.createElement(Icon.arrowR,{s:14})));
              })))));
}
window.AgentsPanel = AgentsPanel;
