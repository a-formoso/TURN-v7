/* ============================================================
   contract.jsx — the STORY CONTRACT (Infinite Studio method)
   Two axes of change, declared up front on the project:
     · OUTER PLOT (plot of fortune) — what changes in the WORLD.
       Names the external value pair the Spine's vertical axis
       tracks (e.g. Crime → Justice / Injustice).
     · INNER ARC (plot of character) — what changes INSIDE the
       protagonist (e.g. Redemption → corruption → integrity).
     · DOMINANCE — which change the Story Climax must pay off.
       This is the checkable promise: the Contract panel and the
       Story Doctor both verify the climax against it.
   Stored as project.contract = { outer, inner, dominant } and
   persisted with the project doc. Everything is OPTIONAL — an
   undeclared contract changes nothing anywhere in the app.
   ============================================================ */

const PLOTS_OF_FORTUNE = [
  { id:"action",  label:"Action",  axis:{pos:"Life",     neg:"Death"},
    blurb:"Survival against overwhelming force.",
    demands:"A hero of will \u2014 clarity of desire matters more than psychological depth.",
    keywords:["life","death","survival","alive","dead","escape","rescue","doom"] },
  { id:"crime",   label:"Crime",   axis:{pos:"Justice",  neg:"Injustice"},
    blurb:"A wrong is done; someone must answer for it.",
    demands:"A protagonist whose METHOD of pursuit reveals who they are.",
    keywords:["justice","injustice","guilt","guilty","innocent","law","punish","caught","truth"] },
  { id:"love",    label:"Love",    axis:{pos:"Love",     neg:"Hate"},
    blurb:"Two people move toward or away from each other.",
    demands:"Two full inner lives \u2014 the real obstacle must live inside them too.",
    keywords:["love","hate","union","together","apart","heart","devotion","betrayal"] },
  { id:"war",     label:"War",     axis:{pos:"Victory",  neg:"Defeat"},
    blurb:"A collective struggle where the cost is counted in people.",
    demands:"A protagonist who carries the war's moral weight personally.",
    keywords:["victory","defeat","win","won","lost","triumph","surrender","conquest"] },
  { id:"society", label:"Society", axis:{pos:"Power",    neg:"Powerlessness"},
    blurb:"One person against the institution.",
    demands:"A protagonist the institution can tempt as well as crush.",
    keywords:["power","powerless","freedom","control","revolt","oppression","authority","liberation"] },
  { id:"horror",  label:"Horror",  axis:{pos:"Survival", neg:"Damnation"},
    blurb:"The monstrous invades the ordinary.",
    demands:"A protagonist whose fear has a personal root the monster finds.",
    keywords:["survival","damnation","doomed","saved","monster","dead","alive","escape"] },
];
window.PLOTS_OF_FORTUNE = PLOTS_OF_FORTUNE;

const PLOTS_OF_CHARACTER = [
  { id:"redemption",      label:"Redemption",      axis:{pos:"Integrity", neg:"Corruption"},
    arc:"corruption \u2192 integrity",
    blurb:"A compromised person fights back to their own humanity.",
    demands:"Deep moral history and a costly, proving final choice.",
    keywords:["integrity","corruption","redemption","honor","conscience","atonement","worth","forgiveness"] },
  { id:"degeneration",    label:"Degeneration",    axis:{pos:"Integrity", neg:"Corruption"},
    arc:"integrity \u2192 corruption",
    blurb:"A decent person is unmade by what they want.",
    demands:"A genuine virtue to lose, and a temptation the audience feels.",
    keywords:["integrity","corruption","ruin","fall","decay","compromise","soul"] },
  { id:"education",       label:"Education",       axis:{pos:"Insight",   neg:"Naivet\u00e9"},
    arc:"naivet\u00e9 \u2192 insight",
    blurb:"Experience teaches what innocence couldn't know.",
    demands:"A believable blind spot, and a world that charges tuition for the lesson.",
    keywords:["insight","truth","understanding","awakening","belief","wisdom","naivete","naivet\u00e9","illusion","doubt","clarity","seeing"] },
  { id:"disillusionment", label:"Disillusionment", axis:{pos:"Belief",    neg:"Disillusion"},
    arc:"belief \u2192 bitter clarity",
    blurb:"A sustaining faith is stripped away.",
    demands:"A worldview worth believing in \u2014 the fall only lands if the faith was real.",
    keywords:["belief","faith","illusion","disillusion","truth","betrayal","cynicism","innocence"] },
  { id:"evolution",       label:"Evolution",       axis:{pos:"Fuller self", neg:"Lesser self"},
    arc:"lesser self \u2192 fuller self",
    blurb:"A person grows into more than they were.",
    demands:"A concrete lack at the start \u2014 growth must be visible, not asserted.",
    keywords:["growth","becoming","wholeness","courage","maturity","fuller","strength"] },
  { id:"devolution",      label:"Devolution",      axis:{pos:"Fuller self", neg:"Lesser self"},
    arc:"fuller self \u2192 lesser self",
    blurb:"A person shrinks under pressure into less than they were.",
    demands:"Real stature to lose, and pressure the audience believes would break them.",
    keywords:["decay","diminished","cowardice","regression","lesser","broken","shrinking"] },
];
window.PLOTS_OF_CHARACTER = PLOTS_OF_CHARACTER;

/* normalized read — resolves ids to registry entries; tolerates missing/legacy data */
function contractOf(project){
  const P = project || window.turnProject || {};
  const c = (P && P.contract) || {};
  const outerDef = PLOTS_OF_FORTUNE.find(p=>p.id===c.outer) || null;
  const innerDef = PLOTS_OF_CHARACTER.find(p=>p.id===c.inner) || null;
  const dominant = (c.dominant==="outer" && outerDef) ? "outer"
                 : (c.dominant==="inner" && innerDef) ? "inner" : null;
  return { outer:outerDef?c.outer:null, inner:innerDef?c.inner:null, dominant, outerDef, innerDef };
}
window.contractOf = contractOf;

/* the external value pair the Spine graph's vertical axis tracks (outer plot's axis) */
function contractAxis(project){
  const c = contractOf(project);
  return c.outerDef ? c.outerDef.axis : null;
}
window.contractAxis = contractAxis;

/* prompt block — rides in storyContext() so every drafter writes toward the contract */
function contractBrief(project){
  const c = contractOf(project);
  if(!c.outerDef && !c.innerDef) return "";
  let s = "Story contract:";
  if(c.outerDef) s += ` outer plot ${c.outerDef.label} \u2014 the external value at stake is ${c.outerDef.axis.pos}/${c.outerDef.axis.neg}`;
  if(c.innerDef) s += `${c.outerDef?" \u00b7":""} inner arc ${c.innerDef.label} \u2014 the protagonist moves ${c.innerDef.arc}`;
  if(c.dominant){
    const dom = c.dominant==="inner" ? c.innerDef : c.outerDef;
    s += ` \u00b7 ${c.dominant==="inner"?"INNER-led":"OUTER-led"}: the story climax must resolve ${dom.axis.pos}/${dom.axis.neg} above all.`;
  }
  return s + "\n";
}
window.contractBrief = contractBrief;

/* the checkable promise — does the Story Climax pay off the declared dominant value?
   statuses: unset · undominant · no-turn · untracked · ok */
function contractClimaxCheck(project, scenes){
  const c = contractOf(project);
  if(!c.outerDef && !c.innerDef) return { status:"unset" };
  if(!scenes || !scenes.length) return { status:"unset" };
  if(!c.dominant) return { status:"undominant",
    msg:"No dominant plot declared \u2014 choose Outer-led or Inner-led so the climax has a value to pay off." };
  const dom = c.dominant==="inner" ? c.innerDef : c.outerDef;
  const climax = [...scenes].reverse().find(s=>s && s.kind==="story-climax") || scenes[scenes.length-1];
  let flagged = false;
  if(typeof window.turnInfo==="function"){ try{ flagged = !!(window.turnInfo(climax)||{}).flagged; }catch(e){} }
  if(flagged) return { status:"no-turn", sceneId:climax.id,
    msg:`Scene ${climax.no} (\u201c${climax.title}\u201d) is the climax but doesn't turn \u2014 the declared ${c.dominant} value (${dom.axis.pos} / ${dom.axis.neg}) must move decisively there.` };
  // strict = the climax values NAME the dominant axis (verifiable payoff);
  // loose  = they only use words related to it (keywords) — reported honestly as
  //          "related but unverified", never as a pass.
  const text = (String(climax.openValue||"")+" "+String(climax.closeValue||"")).toLowerCase();
  const axisWords = (dom.axis.pos+" "+dom.axis.neg).toLowerCase().split(/[^a-z\u00e9]+/).filter(w=>w.length>2);
  const strict = axisWords.some(w=>text.indexOf(w)!==-1);
  const loose = !strict && (dom.keywords||[]).some(w=>text.indexOf(String(w).toLowerCase())!==-1);
  if(!strict && !loose) return { status:"untracked", sceneId:climax.id,
    msg:`The climax (Scene ${climax.no}) turns, but its values (\u201c${climax.openValue} \u2192 ${climax.closeValue}\u201d) don't visibly resolve the declared ${c.dominant} value \u2014 ${dom.axis.pos} / ${dom.axis.neg}. Re-value the climax on that axis, or reconsider which plot leads.` };
  if(!strict) return { status:"loose", sceneId:climax.id,
    msg:`The climax (Scene ${climax.no}) turns and its values (\u201c${climax.openValue} \u2192 ${climax.closeValue}\u201d) read as related to the dominant value (${dom.axis.pos} / ${dom.axis.neg}) \u2014 but they don't name it, so the payoff can't be verified. Name the axis in the climax values to make the contract checkable.` };
  return { status:"ok", sceneId:climax.id,
    msg:`The climax (Scene ${climax.no}) turns and names the declared dominant value (${dom.axis.pos} / ${dom.axis.neg}).` };
}
window.contractClimaxCheck = contractClimaxCheck;

/* ---- left-rail panel (rendered inside chrome.jsx's Story Contract RailSection) ---- */
function ContractSection({ project, scenes, onContract, readOnly }){
  const c = contractOf(project);
  const raw = (project && project.contract) || {};
  // any edit makes the contract the writer's own — the "suggested" badge drops
  const set = (patch)=>{ if(!readOnly && onContract) onContract({ ...patch, suggested:false }); };
  const chips = (defs, key, selId)=> React.createElement("div",{className:"contract-chips"},
    defs.map(d=> React.createElement("button",{key:d.id,
      className:"contract-chip"+(selId===d.id?" sel":""),
      disabled:!!readOnly, title:d.blurb+"\n\nDemands: "+d.demands,
      onClick:()=>set({ [key]: selId===d.id ? null : d.id,
        // clearing a plot clears a dominance that pointed at it
        ...(selId===d.id && c.dominant===(key==="outer"?"outer":"inner") ? {dominant:null} : {}) })},
      d.label)));
  const verdict = contractClimaxCheck(project, scenes);
  const verdictCls = verdict.status==="ok" ? "ok" : "warn";
  // .obj-lab uppercases; keep the explanation after the dash in lowercase
  const lab = (main, sub)=> React.createElement("div",{className:"obj-lab",style:{marginBottom:4}},
    main, sub && React.createElement("span",{style:{textTransform:"none"}}," \u2014 "+sub));
  return React.createElement("div",{className:"contract-wrap"},
    raw.suggested && (c.outerDef||c.innerDef) && React.createElement("div",{className:"contract-note"},
      "Suggested from your story brief \u2014 confirm by leaving it, or change any pick to make it yours."),
    React.createElement("div",null,
      lab("Outer plot","what changes in the world"),
      chips(PLOTS_OF_FORTUNE,"outer",c.outer),
      c.outerDef && React.createElement("div",{className:"contract-axis"},
        "Spine tracks: "+c.outerDef.axis.pos+" / "+c.outerDef.axis.neg)),
    React.createElement("div",null,
      lab("Inner arc","what changes in the protagonist"),
      chips(PLOTS_OF_CHARACTER,"inner",c.inner),
      c.innerDef && React.createElement("div",{className:"contract-axis"},"Arc: "+c.innerDef.arc),
      c.innerDef && React.createElement("div",{className:"contract-note"},c.innerDef.demands)),
    (c.outerDef||c.innerDef) && React.createElement("div",null,
      React.createElement("div",{className:"obj-lab",style:{marginBottom:4}},"Which change does the climax pay off?"),
      React.createElement("div",{className:"contract-chips"},
        React.createElement("button",{className:"contract-chip"+(c.dominant==="outer"?" sel":""),
          disabled:!!readOnly||!c.outerDef, title:c.outerDef?("The climax must resolve "+c.outerDef.axis.pos+" / "+c.outerDef.axis.neg):"Pick an outer plot first",
          onClick:()=>set({dominant:c.dominant==="outer"?null:"outer"})},"Outer-led"),
        React.createElement("button",{className:"contract-chip"+(c.dominant==="inner"?" sel":""),
          disabled:!!readOnly||!c.innerDef, title:c.innerDef?("The climax must complete "+c.innerDef.arc):"Pick an inner arc first",
          onClick:()=>set({dominant:c.dominant==="inner"?null:"inner"})},"Inner-led"))),
    verdict.status!=="unset" && verdict.msg && React.createElement("div",{className:"contract-verdict "+verdictCls},
      React.createElement("span",{className:"dot"}),
      React.createElement("span",null,verdict.msg)));
}
window.ContractSection = ContractSection;
