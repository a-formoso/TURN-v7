/* agents-ui.jsx — the Agents panel (a modal "Writers' Room").
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
    React.createElement("span",{className:"ag-step-ic"},React.createElement(Ic,{s:13})),
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
        : swaps.map((x,i)=>React.createElement("div",{key:i,className:"tr-note",
            onClick:()=> x.scene && window.__turnJump && window.__turnJump(x.scene)},
            x.scene!=null && React.createElement("span",{className:"tr-note-sc"},"Sc "+x.scene),
            React.createElement("span",{className:"tr-note-tx"},
              React.createElement("b",null,(x.speaker||"?")+": "),"“"+x.line+"”",
              x.couldBe && React.createElement("em",{className:"vc-could"}," — could be "+x.couldBe+"."),
              x.why ? " "+x.why : "")))));
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
        React.createElement("div",{key:i,className:"tr-note",
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
    stock && stock.id!=="none" && React.createElement("div",{className:"ag-color-stock"},
      React.createElement("b",null,"Film stock — "), stock.name),
    scenes.length>0 && React.createElement("div",{className:"ag-color-strip"},
      scenes.map(s=>{ const pr=byId[ss[s.id]];
        return React.createElement("span",{key:s.id,className:"ag-color-cell"+(pr?"":" none"),style:pr?{background:grad(pr)}:undefined,
          title:"Sc "+pad(s.no)+" · "+(s.title||"")+(pr?(" — "+pr.name):" — unassigned")+(why[s.id]?("\n"+why[s.id]):"")}, pad(s.no)); })),
    Object.keys(why).length>0 && React.createElement("div",{className:"ag-color-whys"},
      scenes.filter(s=>why[s.id]).map(s=>{ const pr=byId[ss[s.id]];
        return React.createElement("div",{key:s.id,className:"ag-color-why"},
          React.createElement("span",{className:"ag-color-why-sw",style:{background:grad(pr)}}),
          React.createElement("span",{className:"ag-color-why-no"}, pad(s.no)),
          React.createElement("span",{className:"ag-color-why-tx"}, why[s.id])); })));
}

function ProposalCard({ card, onApprove, onReject }){
  return React.createElement("div",{className:"ag-prop"+(card.danger?" danger":"")},
    React.createElement("div",{className:"ag-prop-h"},
      React.createElement(Icon.sparkles,{s:13}),
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
      React.createElement(Icon.sparkles,{s:11}),card.rationale),
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
      React.createElement(Icon.sparkles,{s:11}),
      "A good logline names ",React.createElement("b",null,"who"),", what they ",React.createElement("b",null,"want"),
      ", and what ",React.createElement("b",null,"stands in the way"),"."));
}

/* SAVED REPORTS — a read-only agent's last report, kept per film, so a Table-Read
   (a real multi-call model run) isn't lost the moment the panel closes. Only the
   report + closing line are kept, never the step-by-step trace. ONE store for all
   films with a global size budget: over budget, the films with the oldest reports
   are evicted first — which is also how reports of deleted films age out. */
const AGENT_REPORTS_LS_KEY = "turn.agentReports";
function agentReportProjectId(){ return window.__turnCurrentProjectId || "local"; }
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

function AgentRunner({ agent, ctxFactory, onClose, onView, onBack, initialInput, autoStart, runOnOpen, single, viewLabel, introExtra, force }){
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

  React.useEffect(()=>{ if(bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; },[trace,pending]);
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
  const _midLabel = ((_MODELS.find(m=>m.id===_mid)||{}).label) || _mid;
  const start = async ()=>{
    const myRun = ++runIdRef.current;
    cancelled.current = false;
    setTrace([]); setPending(null); setStatus("running");
    const runLog = [];   // synchronous copy of the trace — state updates are async
    const reportProjectId = agentReportProjectId();   // the film this run BELONGS to — captured now, not at save time
    const prevForce = window.__forceWritingModel;
    window.__forceWritingModel = _mid;   // pin the run to exactly what the header shows
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
      propose:(card)=> runIdRef.current!==myRun ? Promise.resolve(false) : new Promise(res=>{ setPending(card); setStatus("waiting");
        resolver.current = (val)=>{ resolver.current=null; setPending(null); setStatus("running"); res(val); }; }),
      cancelled:()=>cancelled.current || runIdRef.current!==myRun,
    });
    // meter snapshot — the delta shows what THIS run cost in writing-model use
    spend0 = (typeof window.turnTextSpend==="function") ? window.turnTextSpend() : null;
    await agent.run(ctx);
    }
    catch(e){ if(runIdRef.current===myRun) setTrace(tr=>[...tr,{k:"flag",t:"The agent hit an error and stopped: "+(e.message||e)}]); }
    finally{
      window.__forceWritingModel = prevForce;
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

  return React.createElement("div",{className:"ag-runner"},
    React.createElement("div",{className:"ag-runner-head"},
      React.createElement("button",{className:"ag-x",onClick:onBack,title:"All agents"},React.createElement(Icon.chevL,{s:16})),
      React.createElement("span",{className:"ag-runner-ic"},React.createElement(AgentIcon,{name:agent.icon,s:16})),
      React.createElement("div",{className:"ag-runner-t"},
        // same fiction as the studio progress pop-ups: MUSE wearing this department's hat
        React.createElement("div",{className:"ag-runner-name"},
          React.createElement("span",{className:"ag-runner-muse"},"MUSE \u00b7 "),agent.name),
        React.createElement("div",{className:"ag-runner-sub"},
          status==="idle"?"Ready":status==="done"?"Finished":status==="waiting"?"Awaiting your approval":"Working\u2026")),
      // model picker sits at the header's right edge — the SAME spot as the New Story
      // window's picker, so the badge doesn't jump around between steps of one flow
      React.createElement("span",{className:"ag-runner-model",
          title:"The writing model this agent runs on"+(_mid===_rec?" (recommended for this work)":"")+". Change it in the Writing dock on the right edge, between runs."},
          _midLabel + (_mid===_rec ? " \u00b7 recommended" : "")),
      React.createElement("button",{className:"ag-x",onClick:onClose,title:"Close"},React.createElement(Icon.x,{s:16}))),

    agent.needsInput && status==="idle" && React.createElement("div",{className:"ag-input-wrap"},
      React.createElement("div",{className:"ag-input-lab"},agent.inputLabel),
      React.createElement("textarea",{className:"ag-input",placeholder:agent.inputPlaceholder,value:input,
        onChange:e=>setInput(e.target.value),rows:3}),
      agent.ideaStarters && React.createElement(IdeaHelper,{onPick:setInput})),

    React.createElement("div",{className:"ag-body",ref:bodyRef},
      status==="idle" && React.createElement("div",{className:"ag-intro"},
        React.createElement("p",null,agent.blurb),
        introExtra,
        React.createElement("div",{className:"ag-intro-note"},
          React.createElement(Icon.eye,{s:13}),
          agent.autonomous?"Runs on its own \u2014 you'll see each step as it works. Press Stop anytime.":
          agent.kind==="report"?"Read-only \u2014 it reports, it won't change anything.":
          "Every change is shown for your approval before it's applied. Nothing happens without your OK.")),
      status==="idle" && saved && React.createElement(React.Fragment,null,
        React.createElement("div",{className:"ag-intro-note"},
          React.createElement(Icon.eye,{s:13}),
          "Last report \u2014 "+new Date(saved.ts).toLocaleString()+". Run again below for a fresh read."),
        (saved.steps||[]).map((s,i)=>React.createElement(TraceStep,{key:"sv"+i,step:s}))),
      trace.map((s,i)=>React.createElement(TraceStep,{key:i,step:s})),
      running && !pending && React.createElement("div",{className:"ag-thinking"},
        React.createElement("span",{className:"ai-typing"},React.createElement("i",null),React.createElement("i",null),React.createElement("i",null))),
      pending && React.createElement(ProposalCard,{card:pending,
        onApprove:()=>decide(true),onReject:()=>decide(false)})),

    errNotes.length>0 && React.createElement("div",{className:"ag-errbar",role:"alert"},
      React.createElement("span",{className:"ag-errbar-ic"},"⚠"),
      React.createElement("div",{className:"ag-errbar-msgs"},
        errNotes.map((m,i)=>React.createElement("div",{key:i,className:"ag-errbar-msg"}, _linkifyText(m)))),
      React.createElement("button",{className:"ag-errbar-x",onClick:()=>setErrNotes([]),title:"Dismiss"},"✕")),

    React.createElement("div",{className:"ag-runner-foot"},
      status==="idle" && React.createElement("button",{className:"ag-run",onClick:start},
        React.createElement(Icon.sparkles,{s:15}),"Run "+agent.name),
      running && React.createElement("button",{className:"ag-run stop",
        onClick:()=>{ cancelled.current=true; if(resolver.current) resolver.current(false); setStatus("done");
          setTrace(tr=>[...tr,{k:"flag",t:"Stopped by you."}]); }},
        React.createElement(Icon.x,{s:15}),"Stop"),
      status==="done" && React.createElement(React.Fragment,null,
        React.createElement("button",{className:"ag-run ghost",onClick: single?onClose:onBack}, single?"Close":"\u2190 All agents"),
        React.createElement("button",{className:"ag-run ghost",onClick:start},
          React.createElement(Icon.sparkles,{s:15}),"Run again"),
        onView && React.createElement("button",{className:"ag-run",onClick:()=>onView("spine")},
          viewLabel||"View story",React.createElement(Icon.chevR,{s:15})))));
}

function AgentsPanel({ onClose, onView, ctxFactory, aiOn, undoCount, undoLabel, onUndo, issues, initialAgentId, initialInput, autoStart, runOnOpen, single, viewLabel, introExtra, force }){
  const agents = window.AGENTS || [];
  const [active, setActive] = React.useState(()=> initialAgentId ? (agents.find(a=>a.id===initialAgentId)||null) : null);
  const [auto, setAuto] = React.useState(!!autoStart);
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
  return React.createElement("div",{className:"ag-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"ag-panel"},
      active
        ? React.createElement(AgentRunner,{agent:active,ctxFactory,onClose,onView,single,viewLabel,introExtra,
            force: active.id===initialAgentId ? force : false,
            onBack: single ? onClose : ()=>{ setAuto(false); setActive(null); },
            initialInput: active.id===initialAgentId ? initialInput : "",
            autoStart: auto && active.id===initialAgentId,
            runOnOpen: !!runOnOpen && active.id===initialAgentId})
        : React.createElement(React.Fragment,null,
            React.createElement("div",{className:"ag-head"},
              React.createElement("div",{className:"ag-head-t"},
                React.createElement("span",{className:"ag-orb"}),
                React.createElement("div",null,
                  React.createElement("div",{className:"ag-title"},"Agents"),
                  React.createElement("div",{className:"ag-sub"},"AI agents that refine your whole story"))),
              React.createElement("button",{className:"ag-x",onClick:onClose},React.createElement(Icon.x,{s:17}))),
            issuesN>0
              ? React.createElement("div",{className:"ag-issues-row"},
                  React.createElement("span",{className:"ag-issues-badge"},issuesN),
                  React.createElement("span",{className:"ag-issues-tx"},
                    React.createElement("b",null,"That \u201c"+issuesN+"\u201d is your story health \u2014 "),
                    issueParts.join(" \u00b7 "),(notesN?" (plus "+notesTx+")":""),". ",
                    "Open ",((noTurnN+structN)?"Story Doctor":"Continuity Repair")," below to fix ",(issuesN>1?"them":"it"),"."))
              : notesN>0
              ? React.createElement("div",{className:"ag-issues-row notes"},
                  React.createElement("span",{className:"ag-issues-badge note"},notesN),
                  React.createElement("span",{className:"ag-issues-tx"},
                    React.createElement("b",null,"No structural or continuity issues. "),
                    "The Story Doctor has "+notesTx+" \u2014 optional craft advice, worth a look. Open Story Doctor below to review "+(notesN>1?"them":"it")+"."))
              : React.createElement("div",{className:"ag-issues-row clean"},
                  React.createElement("span",{className:"ag-issues-badge ok"},React.createElement(Icon.check,{s:12})),
                  React.createElement("span",{className:"ag-issues-tx"},"No open structural or continuity issues \u2014 your spine is sound.")),
            undoCount>0 && React.createElement("div",{className:"ag-undo-row"},
              React.createElement(Icon.undo,{s:14}),
              React.createElement("span",{className:"ag-undo-tx"},
                undoCount>1 ? (undoCount+" agent runs can be undone \u2014 last was "+undoLabel) : (undoLabel+" made changes you can undo")),
              React.createElement("button",{className:"ag-undo-btn",onClick:onUndo},"Undo last")),
            !aiOn && React.createElement("div",{className:"ag-warn"},
              React.createElement(Icon.alert,{s:13}),"The model isn't available right now \u2014 agents will use deterministic fallbacks where they can, but generative steps are limited."),
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
                  React.createElement("div",{className:"ag-card-go"},"Open ",React.createElement(Icon.arrowR,{s:13})));
              })))));
}
window.AgentsPanel = AgentsPanel;
