#!/usr/bin/env node
/* Rebrand, builder 2 (owner decisions 2026-09-28) — the Writers' Room, the screenplay export and
   the assistant's face. Runs the REAL files in node:vm where it is cheap to (the help dock, the
   export, the Story Editors panel, the display-name map, the Redraft-out-of-date batch) and reads
   the source where rendering would need the whole app:
     A. The help assistant is Frances (dock, greeting, chips, teaser, New Story voice). She only
        answers, never says she is named after anyone, and the method is "the Infinite Studio AI
        method"; the product is Kinolot.
     B. The WRITING actions carry no persona: "Draft", "Drafting…", "Rewriting the prose…",
        "AI draft" / "AI polish", "Auto — picks per draft"; the busy overlays name the
        department (a job title), never "MUSE ·".
     C. Story Editors keep job titles (Script Supervisor, Setups & Payoffs, Art Coordinator; ids
        unchanged); the panel says "Story Editors", the runner shows the umbrella; a report or an
        Undo label saved under an old name is SHOWN with today's name (stored data untouched).
     D. Screenplay exports credit the WRITER — the film's author, else (on a film shared with the
        exporter) the film's OWNER, else the signed-in user's display name or handle (a "+tag" in the
        email is dropped) — never the company and never a collaborator; with no name, no credit line.
     E. No user-visible TURN, MUSE or Cinema Machine in any string literal of these files, "Infinite
        Studio" is always "Infinite Studio AI", one "Writers' Room" apostrophe; the collaborator
        role "Writer" reads "Co-writer" (the role key stays "writer").
     F. Round-1 leftover: "Redraft N out-of-date" stops on a failure retrying can't fix and on the
        same service failure twice in a row, keeps what was redrafted, and says so once.
   node scripts/test-rebrand-writers.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSync, traverse } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
let checks = 0, failed = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0,8).join("\n    ")); }
};
const noop = ()=>{};
const h = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const textOf = (n)=> n==null || n===false ? "" : (typeof n==="string" || typeof n==="number") ? String(n)
  : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const findAll = (n, pred, out=[])=>{ if(!n || typeof n!=="object") return out; if(Array.isArray(n)){ n.forEach(x=>findAll(x, pred, out)); return out; }
  if(pred(n)) out.push(n); (n.children||[]).forEach(c=>findAll(c, pred, out)); return out; };
// a hooks stub whose useState slots can be pre-seeded (slot index → value)
const hooks = (seed)=>{ let i = 0; const R = new Proxy({ createElement:h, Fragment:"frag",
    useState:(x)=>{ const k = i++; const v = seed && k in seed ? seed[k] : (typeof x==="function" ? x() : x); return [v, noop]; },
    useRef:(x)=>({ current:x }), useEffect:noop, useLayoutEffect:noop, useMemo:(f)=>f(), useCallback:(f)=>f },
  { get:(t,k)=> (k in t) ? t[k] : noop }); return { R, reset:()=>{ i = 0; } }; };
const makeBox = (extra)=>{
  const box = { console:{ ...console, warn:noop, info:noop }, setTimeout, clearTimeout,
    Icon:new Proxy({}, { get:()=>()=>null }), localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
    addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, CustomEvent:class{}, ...(extra||{}) };
  box.window = box; box.globalThis = box;
  vm.createContext(box);
  return box;
};
const MINE = ["app/muse.jsx","app/newstory.jsx","app/livevoice.js","app/script.jsx","app/character.jsx","app/inspector.jsx",
  "app/app.jsx","app/agents.jsx","app/agents-ui.jsx","app/export.jsx","app/cloud.jsx","app/series.js"];

/* every string literal a file holds (what it can show users); dev-console calls excluded */
const literals = (f)=>{
  const ast = parseSync(read(f), { filename:f, babelrc:false, configFile:false, sourceType:"script", parserOpts:{ plugins:["jsx"] } });
  const out = [];
  traverse(ast, {
    "StringLiteral|TemplateElement"(p){
      // dev-console tags ("[TURN] save conflict") are internal, never shown to users
      const call = p.findParent(x=>x.isCallExpression());
      const callee = call && call.node.callee;
      if(callee && callee.type==="MemberExpression" && ((callee.object.name==="console") ||
        (callee.object.type==="MemberExpression" && callee.object.property && callee.object.property.name==="console"))) return;
      out.push({ v:p.isStringLiteral() ? p.node.value : p.node.value.cooked, line:p.node.loc && p.node.loc.start.line });
    } });
  return out;
};
/* ======================= A. Frances ======================= */
const museSrc = read("app/muse.jsx");
const museBox = makeBox();
museBox.React = hooks().R;
vm.runInContext(museSrc, museBox, { filename:"app/muse.jsx" });
const museDock = (signedIn)=>{ const H = hooks({ 0:true }); museBox.React = H.R;   // slot 0 = open
  return museBox.MuseDock({ scenes:[], selScene:null, project:null, aiOn:true, signedIn, onSignIn:noop }); };

await test("A the dock is Frances: greeting, title, bubble, input and the offline note", ()=>{
  for(const signedIn of [true, false]){
    const t = textOf(museDock(signedIn));
    assert.ok(t.includes("Hi, I’m Frances."), t.slice(0,200));
    assert.ok(t.includes("Frances") && !/\bMUSE\b|Cinema Machine|\bTURN\b/.test(t), t);
    assert.ok(t.includes(signedIn ? "Your guide to Kinolot." : "Your story guide inside Kinolot."), t.slice(0,300));
    // she only answers: no "I’ll build your film with you"
    assert.ok(!/I’ll (build|architect|write)/.test(t), t);
  }
  const tree = museDock(true);
  const bubble = findAll(tree, n=>n.props && /muse-bubble/.test(n.props.className||""))[0];
  assert.equal(bubble.props.title, "Close Frances");
  const input = findAll(tree, n=>n.type==="input")[0];
  assert.equal(input.props.placeholder, "Ask Frances anything…");
  assert.ok(museSrc.includes('"Frances needs to be online to answer — check your connection."'));
});
await test("A chips: the Story Editors (not 'the Agents'), the Infinite Studio AI method, Kinolot; straight Writers' apostrophe", ()=>{
  const chips = vm.runInContext("MUSE_CHIPS.concat(VISITOR_CHIPS)", museBox);
  assert.ok(chips.includes("How do the Story Editors work?") && !chips.some(c=>/Agents/.test(c)), chips.join(" | "));
  assert.ok(chips.includes("What is the Writers' Room for?"), chips.join(" | "));
  assert.ok(chips.includes("What’s the Infinite Studio AI method?") && chips.includes("What is Kinolot?"), chips.join(" | "));
});
await test("A the signed-out teaser answers as Frances about Kinolot and the Infinite Studio AI method", ()=>{
  const ans = (q)=> museBox.teaserAnswer(q) || "";
  assert.ok(ans("What is Kinolot?").startsWith("Kinolot is a story-architecture studio for AI filmmakers."));
  assert.ok(ans("What’s the Infinite Studio AI method?").startsWith("The Infinite Studio AI method is the craft Kinolot runs on"));
  assert.ok(ans("What is Cinema Machine?").startsWith("Kinolot is"), "an old name still gets the right answer");
  assert.ok(ans("who are you?").startsWith("I’m Frances, your guide inside Kinolot."));
  assert.ok(ans("hi").startsWith("I’m Frances"));
  const all = vm.runInContext("TEASER_QA.map(x=>x.a).join(' ')", museBox);
  assert.ok(!/MUSE|Cinema Machine|\bTURN\b|Infinite Studio(?! AI)/.test(all), all);
});
await test("A Frances never claims to be named after anyone (no homage in any of these files; no such claim in what they show)", ()=>{
  // the namesake's surname is assembled here so that it is never written out anywhere in the repo
  const namesake = new RegExp("\\b"+["Mar","ion"].join("")+"\\b", "i");
  for(const f of MINE){
    assert.ok(!namesake.test(read(f)), f);
    for(const { v, line } of literals(f)) assert.ok(!/named (after|for)|homage|in honou?r of/i.test(v||""), f+":"+line+" "+v);
  }
});
await test("A the New Story voice conversation is Frances; the transcript hands off as WRITER / FRANCES", ()=>{
  const ns = read("app/newstory.jsx"), lv = read("app/livevoice.js");
  for(const s of ["Connecting to Frances…", "Frances is speaking…", "Frances is listening…", "Hear Frances", "Frances will begin in a moment…",
    "Tell Frances a little about the story before shaping the loglines.", "talk naturally with Frances", "Open Kinolot in Chrome"])
    assert.ok(ns.includes(s), s);
  assert.equal((ns.match(/"FRANCES: "/g)||[]).length, 2, "both interviews label her turns");
  for(const s of ["Sign in to talk with Frances.", "Couldn’t reach Frances: ", "Frances disconnected before the conversation finished."]) assert.ok(lv.includes(s), s);
  new Function(lv);   // still parses as plain browser JS
});
await test("A live voice tells only an admin to redeploy; everyone else gets the typed interview", ()=>{
  const lv = read("app/livevoice.js");
  const box = makeBox({ location:{ hostname:"kinolot.infinitestudioai.com", protocol:"https:" }, navigator:{ mediaDevices:null } });
  vm.runInContext(lv, box, { filename:"app/livevoice.js" });
  const r = box.turnLiveVoiceSupport();
  assert.equal(r.ok, false);
  assert.ok(/Try Chrome or Edge, or use the typed interview/.test(r.reason) && !/TURN/.test(r.reason), r.reason);
  assert.ok(/window\.turnIsAdmin\s*\?\s*"The live-voice backend is out of date\. Deploy the updated image-proxy function/.test(lv));
  assert.ok(/: "The live-voice backend is out of date, so live voice can’t start right now\. You can use the typed interview in the meantime\."/.test(lv));
});

/* ======================= B. writing actions ======================= */
await test("B the writing actions carry no persona", ()=>{
  const sc = read("app/script.jsx"), ch = read("app/character.jsx"), ins = read("app/inspector.jsx"), app = read("app/app.jsx");
  assert.ok(sc.includes('live?"Draft":"Draft this scene"') && !sc.includes("Draft with MUSE"));
  assert.ok(sc.includes("`Drafting Sc.${") && !sc.includes("MUSE is drafting"));
  assert.ok(sc.includes('"Rewriting the prose\\u2026 beats stay locked, only the words change."') && !sc.includes("MUSE is rewriting"));
  assert.ok(ch.includes('drafting?"Drafting\\u2026":"Draft")') && !ch.includes("MUSE"));
  assert.ok(ins.includes('"Auto \\u2014 picks per draft"') && !ins.includes("MUSE picks"));
  assert.ok(app.includes('v.polished ? "AI polish" : (v.ai ? "AI draft"'));
  // the busy overlay's eyebrow is the department's job title alone
  assert.ok(app.includes('role && React.createElement("div",{className:"redraft-role"},role),') && !app.includes('"MUSE \\u00b7 "'));
  // the agent messages that used to say "press Draft with MUSE"
  const ag = read("app/agents.jsx");
  assert.ok(!literals("app/agents.jsx").some(x=>/Draft with MUSE/.test(x.v||"")) && ag.includes("press Draft to fill it in.") && ag.includes("(Draft or Redraft script from beats)"));
});
await test("B version labels are derived from the draft's flags (nothing stored to migrate): AI draft / AI polish", ()=>{
  const app = read("app/app.jsx");
  const line = app.split("\n").find(l=>l.includes("const labelOf = "));
  const labelOf = vm.runInContext("(function(){ "+line.trim()+" return labelOf; })()", makeBox());
  assert.equal(labelOf({ ai:true, by:{ model:"x" } }), "AI draft");
  assert.equal(labelOf({ ai:true, polished:true }), "AI polish");
  assert.equal(labelOf({ edited:true, ai:true }), "Manual edit");
  assert.equal(labelOf({ auto:true }), "Structural draft");
});

/* ======================= C. Story Editors ======================= */
const agSrc = read("app/agents.jsx");
const registry = ()=>{
  const i = agSrc.indexOf("const AGENTS = ["), j = agSrc.indexOf("];", i);
  return agSrc.slice(i, j).split("\n").map(l=>(l.match(/\{ id:"([^"]+)", name:"([^"]+)"/)||[]).slice(1)).filter(x=>x.length);
};
const dnBox = makeBox();
vm.runInContext(agSrc.slice(agSrc.indexOf("const LEGACY_DISPLAY_NAMES"), agSrc.indexOf("const AGENTS = [")), dnBox);
await test("C the registry keeps its ids and shows job titles", ()=>{
  assert.deepEqual(Object.fromEntries(registry()), { doctor:"Story Doctor", consistency:"Script Supervisor", continuity:"Setups & Payoffs",
    adapt:"Adaptation", tableread:"Final Read", production:"Production check", colorist:"Colorist", shotdesigner:"Shot Designer",
    casting:"Casting Director", propsmaster:"Props Master", researcher:"Visual Researcher", locscout:"Location Scout", coordinator:"Art Coordinator" });
  assert.equal(dnBox.turnAgentUmbrella({ room:"art" }), "Department Heads");
  assert.equal(dnBox.turnAgentUmbrella({ id:"doctor" }), "Story Editors");
});
await test("C text saved under an old name is shown with today's name (whole phrases only)", ()=>{
  const dn = dnBox.turnDisplayNames;
  assert.equal(dn("Continuity Repair changed your story"), "Setups & Payoffs changed your story");
  assert.equal(dn("Consistency Check"), "Script Supervisor");
  assert.equal(dn("Art Department Coordinator"), "Art Coordinator");
  assert.equal(dn("Open it in the Cast panel and press Draft with MUSE to fill it in."), "Open it in the Cast panel and press Draft to fill it in.");
  assert.equal(dn("MUSE draft · Kimi K3"), "AI draft · Kimi K3");
  assert.equal(dn("MUSE polish"), "AI polish");
  assert.equal(dn("TURN prompt compiler"), "Kinolot prompt compiler");
  assert.equal(dn("Story Doctor"), "Story Doctor");
  assert.equal(dn("A continuity repair of the Consistency Checker"), "A continuity repair of the Consistency Checker", "no partial-word rewrites");
  assert.equal(dn(null), null); assert.equal(dn(""), "");
});
await test("C the panel says Story Editors; the runner shows the umbrella; a saved report shows today's names", ()=>{
  const ui = read("app/agents-ui.jsx");
  const box = makeBox();
  vm.runInContext(agSrc.slice(agSrc.indexOf("const LEGACY_DISPLAY_NAMES"), agSrc.indexOf("const AGENTS = [")), box);
  box.React = hooks().R;
  vm.runInContext(ui, box, { filename:"app/agents-ui.jsx" });
  // the grid
  box.AGENTS = [{ id:"continuity", name:"Setups & Payoffs", icon:"link", kind:"fix", blurb:"b" }];
  box.React = hooks().R;
  const panel = box.AgentsPanel({ onClose:noop, onView:noop, ctxFactory:noop, aiOn:true, undoCount:2, undoLabel:"Continuity Repair", onUndo:noop, issues:{ continuity:1 } });
  const pt = textOf(panel);
  assert.ok(pt.includes("Story Editors") && !/\bAgents\b/.test(pt), pt.slice(0,300));
  assert.ok(pt.includes("2 runs can be undone — last was Setups & Payoffs"), "an old Undo label is shown renamed: "+pt);
  assert.ok(pt.includes("Open Setups & Payoffs below to fix it."), pt);
  // the runner, with a Final Read report saved before the rename
  const saved = { local:{ tableread:{ ts:1, steps:[{ k:"report", t:"The Consistency Check and Continuity Repair both passed; press Draft with MUSE on Sc 3." }] } } };
  box.localStorage = { getItem:(k)=> k==="turn.agentReports" ? JSON.stringify(saved) : null, setItem:noop, removeItem:noop };
  box.React = hooks().R;
  const runner = box.AgentRunner({ agent:{ id:"tableread", name:"Final Read", icon:"film", kind:"report", blurb:"b" }, ctxFactory:noop, onClose:noop, onBack:noop });
  const eyebrow = findAll(runner, n=>n.props && n.props.className==="ag-runner-muse")[0];
  assert.equal(textOf(eyebrow), "Story Editors · ");
  const steps = findAll(runner, n=>n.props && n.props.step).map(n=>n.props.step.t);
  assert.deepEqual(steps, ["The Script Supervisor and Setups & Payoffs both passed; press Draft on Sc 3."]);
  assert.ok(ui.includes('"\\u2190 All Story Editors"') && !/"[^"]*All agents[^"]*"/.test(ui));
  box.React = hooks().R;
  const art = box.AgentRunner({ agent:{ id:"colorist", name:"Colorist", icon:"palette", kind:"build", room:"art", blurb:"b" }, ctxFactory:noop, onClose:noop, onBack:noop, single:true });
  assert.equal(textOf(findAll(art, n=>n.props && n.props.className==="ag-runner-muse")[0]), "Department Heads · ");
});
await test("C the agent-Undo toast and its question show today's name; ids stay (requireStory label, Adaptation checks)", ()=>{
  const app = read("app/app.jsx");
  assert.ok(app.includes('agentLabel(agentUndoHere[agentUndoHere.length-1].label)+" changed your story"'));
  assert.ok(app.includes("const who = agentLabel(snap.label);"));
  assert.ok(app.includes('requireStory("Art Coordinator")') && app.includes('agentName==="Adaptation"'));
  assert.ok(!/"[^"]*\b(Consistency Check|Continuity Repair|Art Department Coordinator)\b[^"]*"/.test(app));
});

/* ======================= D. export authorship ======================= */
const exBox = makeBox();
vm.runInContext(read("app/export.jsx"), exBox, { filename:"app/export.jsx" });
const P = { title:"Night Shift", genre:"Drama" };
const SC = [{ id:"a", no:1, loc:"INT. DINER - NIGHT", summary:"Mara waits." }];
await test("D Fountain and the PDF title page credit the film's own author first", ()=>{
  exBox.turnUserDisplayName = "Account Name";
  const f = exBox.buildFountain({ ...P, author:"  Mara   Quinn " }, SC, {});
  assert.ok(f.includes("Credit: written by\nAuthor: Mara Quinn\n"), f.slice(0,120));
  const html = exBox.screenplayHTML({ ...P, author:"Mara Quinn" }, SC, {});
  assert.ok(html.includes('<div class="by">written by</div><div class="auth">Mara Quinn</div>'));
});
await test("D …else the signed-in writer's name; never the company", ()=>{
  exBox.turnUserDisplayName = "Jane <Doe>";
  const f = exBox.buildFountain(P, SC, {});
  assert.ok(f.includes("Author: Jane <Doe>"));
  const html = exBox.screenplayHTML(P, SC, {});
  assert.ok(html.includes('<div class="auth">Jane &lt;Doe&gt;</div>'), "escaped");
  for(const out of [f, html]) assert.ok(!/Infinite Studio|∞/.test(out), out.slice(0,300));
});
await test("D with no name at all the credit line is left out (never invented)", ()=>{
  exBox.turnUserDisplayName = "";
  const f = exBox.buildFountain(P, SC, {});
  assert.ok(!/Credit:|Author:/.test(f) && f.startsWith("Title: Night Shift\nDraft date: "), f.slice(0,80));
  const html = exBox.screenplayHTML(P, SC, {});
  assert.ok(!html.includes("written by") && !html.includes('class="auth"'));
  exBox.turnUserDisplayName = undefined;
  assert.equal(exBox.screenplayWriter(P), "");
});
await test("D a film SHARED with the exporter credits its owner — never the View-only reader, Co-writer or Art director", ()=>{
  exBox.turnUserDisplayName = "Bob Smith";
  exBox.turnOpenFilmCredit = { shared:true, owner:"Ana" };
  const f = exBox.buildFountain(P, SC, {}), html = exBox.screenplayHTML(P, SC, {});
  assert.ok(f.includes("Credit: written by\nAuthor: Ana\n") && !f.includes("Bob Smith"), f.slice(0,120));
  assert.ok(html.includes('<div class="auth">Ana</div>') && !html.includes("Bob Smith"));
  exBox.turnOpenFilmCredit = { shared:true, owner:"" };
  assert.equal(exBox.screenplayWriter(P), "", "no owner name known: no credit, and still never the collaborator");
  assert.ok(!/Credit:|Author:/.test(exBox.buildFountain(P, SC, {})));
  assert.equal(exBox.screenplayWriter({ ...P, author:"Mara Quinn" }), "Mara Quinn", "the film's own author still wins");
  exBox.turnOpenFilmCredit = null;
  assert.equal(exBox.screenplayWriter(P), "Bob Smith", "on the user's own film the signed-in writer is credited");
  exBox.turnUserDisplayName = undefined;
  const app = read("app/app.jsx");
  assert.ok(app.includes("window.turnOpenFilmCredit = (_projRow && _projRow.isShared)"), "app.jsx sets it from the open film's row");
});
await test("D the writer's name: display name, else the account handle", ()=>{
  const cl = read("app/cloud.jsx");
  const fnSrc = (name)=>{ const i = cl.indexOf("function "+name+"("); return cl.slice(i, cl.indexOf("\n}\n", i)+2); };
  const nb = makeBox();
  vm.runInContext(fnSrc("cloudHandleName")+"\n"+fnSrc("cloudUserDisplayName"), nb);
  const fn = nb.cloudUserDisplayName;
  assert.equal(fn({ user:{ email:"jane.doe@x.com", user_metadata:{ full_name:"  Jane   Doe " } } }), "Jane Doe");
  assert.equal(fn({ user:{ email:"jane.doe@x.com", user_metadata:{ display_name:"JD" } } }), "JD");
  assert.equal(fn({ user:{ email:"jane.doe_88@x.com", user_metadata:{} } }), "Jane Doe 88");
  assert.equal(fn({ user:{ email:"McKay@x.com" } }), "McKay");
  // a "+tag" sorts mail; it is never part of the name
  assert.equal(fn({ user:{ email:"jane+kinolot@gmail.com" } }), "Jane");
  assert.equal(fn({ user:{ email:"bob.smith+films@x.com" } }), "Bob Smith");
  assert.equal(nb.cloudHandleName("ana@x.com"), "Ana"); assert.equal(nb.cloudHandleName(""), ""); assert.equal(nb.cloudHandleName("+tag@x.com"), "");
  assert.equal(fn(null), ""); assert.equal(fn({ user:{} }), "");
  const app = read("app/app.jsx");
  assert.ok(app.includes('window.turnUserDisplayName = (typeof cloudUserDisplayName==="function") ? cloudUserDisplayName(session) : "";'));
});

/* ======================= E. no leaks in any string these files show ======================= */
await test("E no user-visible TURN, MUSE or Cinema Machine; always 'Infinite Studio AI'; one Writers' apostrophe", ()=>{
  const bad = [];
  for(const f of MINE) for(const { v, line } of literals(f)){
    if(/\bTURN\b|TURN’|\bMUSE\b|Cinema Machine|Infinite Studio(?! AI)|Writers’ Room|Writers’ Room/.test(v||"")) bad.push(f+":"+line+"  "+String(v).slice(0,120));
  }
  assert.deepEqual(bad, []);
});
await test("E the collaborator role reads Co-writer (the key stays 'writer')", ()=>{
  const app = read("app/app.jsx"), ag = read("app/agents.jsx"), cl = read("app/cloud.jsx");
  assert.ok(app.includes("Ask the owner for Co-writer access") && app.includes("View-only, Co-writer or Art director access") && app.includes("Your Co-writer role"));
  assert.ok(ag.includes("A Co-writer or the film's owner can apply it."));
  assert.ok(cl.includes('["view_only","writer","art_director"]'), "role keys unchanged");
  for(const f of MINE) for(const { v, line } of literals(f))
    assert.ok(!/\b(a|for|reassign View-only,|Your) Writer\b/.test(v||""), f+":"+line+" "+v);
});
await test("E the connection and cloud messages speak as 'we', and the prompt compiler is Kinolot's", ()=>{
  const app = read("app/app.jsx"), cl = read("app/cloud.jsx");
  assert.ok(app.includes('"Lost the cloud connection. Your open work stays on screen while we reconnect."'));
  assert.ok(cl.includes("Try Create show again; we'll safely reuse the same Episode 1.") && cl.includes("Try again; we'll safely resume the same request."));
  assert.equal((app.match(/promptCompiler:"Kinolot prompt compiler"/g)||[]).length, 3);
});

/* ======================= F. Redraft out-of-date stops on unfixable / repeated failures ======================= */
const appSrc = read("app/app.jsx");
const fnSrc = (src, name, indent)=>{ indent = indent || "  ";
  const start = src.indexOf("\n"+indent+"const "+name+" = "); assert.ok(start>=0, "found "+name);
  const end = src.indexOf("\n"+indent+"};", start); return src.slice(start+1, end+indent.length+3); };
const agBody = (name)=>{ const i = agSrc.indexOf("function "+name+"("); return agSrc.slice(i, agSrc.indexOf("\n}\n", i)+2); };
const runBatch = async (failures)=>{
  const box = makeBox();
  vm.runInContext(agBody("failureNeedsAction")+agBody("repeatedServiceFailure")+
    "window.turnFailureNeedsAction=failureNeedsAction; window.turnRepeatedServiceFailure=repeatedServiceFailure;", box);
  box.__toasts = []; box.appToast = (m, t)=>box.__toasts.push({ m, t });
  box.appConfirm = async ()=>true;
  box.screenplayFailureReason = (f)=>"reason:"+f.kind+(f.ref?"/"+f.ref:"");
  box.screenplayFailureAdvice = (f, again)=>"Advice, then "+again+".";
  box.screenplayBatchFailureMessage = (head, list)=>head+list.map(x=>"Scene "+x.no).join("; ");
  const scenes = [1,2,3,4,5].map(n=>({ id:"s"+n, no:n }));
  const calls = [];
  const lastPolishFailureRef = { current:null };
  const env = { redraftingAll:null, canMutateWritersRoom:()=>true, scenesInStoryOrder:(x)=>x.slice(), scenes,
    staleMap:Object.fromEntries(scenes.map(s=>[s.id, ["summary"]])), currentProjectId:"p1", projIdRef:{ current:"p1" },
    lastPolishFailureRef, setRedraftingAll:noop, beatsMap:{}, aiAvailable:()=>true,
    redraftScene:async (s)=>{ calls.push(s.no); const f = failures[s.no]; lastPolishFailureRef.current = f || null; return !f; } };
  const names = Object.keys(env);
  const fn = vm.runInContext("(function("+names.join(",")+"){\n"+fnSrc(appSrc, "redraftAllStale")+"\n return redraftAllStale; })", box)(...names.map(n=>env[n]));
  await fn();
  return { calls, toasts:box.__toasts };
};
await test("F out of plan credits: the batch stops at that scene, keeps what it redrafted, says why once", async ()=>{
  const r = await runBatch({ 3:{ kind:"plan" } });
  assert.deepEqual(r.calls, [1,2,3]);
  assert.equal(r.toasts.length, 1);
  assert.equal(r.toasts[0].m, "Redraft out-of-date stopped at Scene 3 — reason:plan, so the other scenes would fail the same way. 2 scenes were redrafted and kept; 3 scenes are still marked out of date and unchanged. Advice, then press Redraft out-of-date to continue.");
  assert.equal(r.toasts[0].t, "error");
});
await test("F the same service failure on two scenes in a row stops it; one blip, or two different ones, does not", async ()=>{
  let r = await runBatch({ 2:{ kind:"service", ref:"CM-14" }, 3:{ kind:"service", ref:"CM-14" } });
  assert.deepEqual(r.calls, [1,2,3]);
  assert.ok(r.toasts[0].m.startsWith("Redraft out-of-date stopped at Scene 3 — reason:service/CM-14, for the second scene in a row"), r.toasts[0].m);
  assert.ok(r.toasts[0].m.includes("1 scene was redrafted and kept; 4 scenes are still marked out of date"), r.toasts[0].m);
  r = await runBatch({ 2:{ kind:"service", ref:"CM-14" }, 4:{ kind:"service", ref:"CM-14" } });
  assert.deepEqual(r.calls, [1,2,3,4,5], "not in a row: the batch runs on");
  r = await runBatch({ 2:{ kind:"service", ref:"CM-13" }, 3:{ kind:"service", ref:"CM-14" } });
  assert.deepEqual(r.calls, [1,2,3,4,5], "two different failures: runs on");
  r = await runBatch({ 2:{ kind:"service", ref:"CM-12" } });
  assert.deepEqual(r.calls, [1,2], "the provider key rejected: stops at once");
  r = await runBatch({ 2:{ kind:"invalid" }, 3:{ kind:"invalid" } });
  assert.deepEqual(r.calls, [1,2,3,4,5], "format rejections are per scene: runs on");
});
await test("F (round 1, re-checked) the batch has its own progress card with 'i of N' and a Stop; the Redraft button has its own strip", ()=>{
  assert.ok(appSrc.includes('title:"Redrafting "+redraftingAll.i+" of "+redraftingAll.total+" out-of-date scenes",') && appSrc.includes("onStop:stopRedraftAll"));
  const sc = read("app/script.jsx");
  assert.ok(sc.includes('redraftAllBtn && React.createElement("div",{className:"st-group r"}, redraftAllBtn),'));
});

console.log((failed ? "FAILED — " : "")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);
