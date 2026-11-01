#!/usr/bin/env node
/* ART ROOM WORK KEEPS RUNNING IN THE BACKGROUND (owner 2026-10-30 — "tasks like 'Reading screenplay…' (Props tab) seem
   to stop running as soon as I change tabs" → "yes, do both": the screenplay read and the image batches).
   A tab with work in progress reports it to window.turnArtJobs; the Art Room keeps that tab mounted (hidden) while
   another tab or room is on screen, so leaving no longer drops the work. Switching films still stops it.
   1  the registry: set / clear / subscribe, no notice when nothing changed
   2  every image batch (Lookbook, Characters, Props, Locations, Shots) reports under its tab
   3  the Props read and its waiting review report; only another film ends the read
   4  the Art Room renders the visible tab plus every tab with work, each in a keyed pane
   5  the app keeps the Art Room mounted (hidden) in another room while work runs
   6  where it shows: a dot on the working tab, a bar in the other rooms with Open
   7  Frances knows
     node scripts/test-art-background-work.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j+b.length); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); } };

const artroom = read("app/artroom.jsx"), props = read("app/props.jsx"), app = read("app/app.jsx"),
  chrome = read("app/chrome.jsx"), ai = read("app/ai.jsx"), css = read("app/styles.css"), html = read("TURN.html");

await test("1 the registry: set, change, clear, subscribe — and quiet when nothing changed", ()=>{
  const src = between(artroom, "(function(){\n  const jobs = {}, subs = new Set();", "})();");
  const window = {}; vm.runInNewContext(src, { window });
  const J = window.turnArtJobs; let n = 0; const off = J.subscribe(()=>n++);
  J.set("props", { label:"Generating images", detail:"1 of 3" });
  assert.deepEqual(JSON.parse(JSON.stringify(J.get())), { props:{ label:"Generating images", detail:"1 of 3" } }); assert.equal(n, 1);
  J.set("props", { label:"Generating images", detail:"1 of 3" }); assert.equal(n, 1, "same job: no notice");
  J.set("props", { label:"Generating images", detail:"2 of 3" }); assert.equal(n, 2);
  J.set("props:read", { label:"Reading the screenplay", detail:"4 / 12" }); assert.equal(Object.keys(J.get()).length, 2);
  J.set("props", null); assert.equal(n, 4); J.set("props", null); assert.equal(n, 4, "clearing nothing: no notice");
  J.set("", { label:"x" }); assert.equal(Object.keys(J.get()).length, 1, "no tab, no job");
  const snap = J.get(); snap.other = 1; assert.equal(J.get().other, undefined, "get() is a copy");
  off(); J.set("shots", { label:"Generating images" }); assert.equal(n, 4, "unsubscribed: no notice");
});

await test("2 every image batch reports its work under its tab while it runs", ()=>{
  assert.match(artroom, /function useBatchGen\(tab\)\{/);
  const hook = between(artroom, "function useBatchGen(tab){", "window.useBatchGen = useBatchGen;");
  assert.match(hook, /useArtJob\(tab, \(activeId \|\| preparing\) \? \{ label:"Generating images", detail:\(activeId && total\) \? Math\.min\(total, total-queue\.length\+1\)\+" of "\+total : "" \} : null\);/);
  for(const [f, tab] of [["app/artroom.jsx","characters"],["app/lookbook.jsx","lookbook"],["app/props.jsx","props"],["app/locations-ui.jsx","locations"],["app/shots-ui.jsx","shots"]])
    assert.ok(read(f).includes('const batch = useBatchGen("'+tab+'");'), f+" names its tab");
  // the Shots chain (Render Scene in order / Generate all shots) steps through the batch one shot at a time — the chain
  // itself counts, so the tab can't drop out between two steps
  assert.ok(read("app/shots-ui.jsx").includes('(window.useArtJob||(()=>{}))("shots:chain", chain ? { label:"Rendering shots in order", detail:(chain.idx+1)+" of "+chain.total } : null);'));
  assert.ok(!/useBatchGen\(\)/.test(artroom+props+read("app/lookbook.jsx")+read("app/locations-ui.jsx")+read("app/shots-ui.jsx")), "no batch without a tab");
  // a tab's job is cleared when the tab goes away (film switch, the work ended)
  const useJob = between(artroom, "function useArtJob(tab, job){", "window.useArtJob = useArtJob;");
  assert.match(useJob, /React\.useEffect\(\(\)=> \(\)=> window\.turnArtJobs\.set\(tab, null\), \[tab\]\);/);
});

await test("3 the Props read and its waiting review keep the tab alive; only another film ends the read", ()=>{
  assert.match(props, /\(window\.useArtJob\|\|\(\(\)=>\{\}\)\)\("props:read", extraction \? \{ label:"Reading the screenplay", detail:extraction\.total \? extraction\.done\+" \/ "\+extraction\.total : "" \}\s*: review \? \{ label:"Props ready to review", detail:"" \} : null\);/);
  assert.ok(props.includes("const scopeKey=JSON.stringify([project&&project.id]);"), "scene edits no longer cancel the read");
  // the unmount still cancels (a film switch remounts the Art Room), and Cancel stays on the tab
  assert.ok(props.includes("React.useEffect(()=>{extractionRun.current++;setReview(null);setExtraction(null);setExtractionError(\"\");return ()=>{extractionRun.current++;};},[scopeKey]);"));
  assert.ok(props.includes('onClick:()=>{extractionRun.current++;pendingDraft.current=null;setExtraction(null);}},"Cancel")'));
});

await test("4 the Art Room renders the visible tab plus every tab with work, each in a keyed pane", ()=>{
  const room = between(artroom, "function ArtRoom({", "window.ArtRoom = ArtRoom;");
  assert.ok(room.includes("readOnly=false, projectLoading=false, hidden=false }){"));
  assert.ok(room.includes("const artJobs = (window.useArtJobs || (()=>({})))();"));
  assert.ok(room.includes("const jobTabs = Array.from(new Set(Object.keys(artJobs).map(k=>k.split(\":\")[0]))).filter(t=> hidden || t!==artView);"));
  assert.ok(room.includes("const panes = [ ...(hidden ? [] : [artView]), ...jobTabs ];"));
  assert.ok(room.includes('panes.map(tab=> React.createElement("div",{key:"pane-"+tab,className:"art-tab-pane","data-art-pane":tab,'));
  assert.ok(room.includes('style:{ display: (!hidden && tab===artView) ? "contents" : "none" }'));
  // a hidden tab keeps its department name out of the shared page heading (ArtDeptTitle portals there)
  assert.ok(room.includes("window.ArtPaneHidden ? React.createElement(window.ArtPaneHidden.Provider,{value:hidden || tab!==artView}, renderTab(tab)) : renderTab(tab)"));
  assert.ok(chrome.includes("const ArtPaneHidden = (typeof React.createContext===\"function\") ? React.createContext(false) : null;") && chrome.includes("const paneHidden = (ArtPaneHidden && typeof React.useContext===\"function\") ? React.useContext(ArtPaneHidden) : false;") && chrome.includes("  if(paneHidden) return null;\n  if(slot && slot.isConnected"));
  // every tab comes from one renderTab(tab); only the tab on screen shows its lock card
  const render = between(room, "const renderTab = (tab)=> (", "const jobTabs");
  assert.ok(render.includes("(tab===artView && lockedView)\n      ? React.createElement(ArtTabLock,{tab:tab,locks:tabLocks,onGo:setArtView})"));
  for(const t of ["lookbook","characters","props","locations","stylebible","shots","storyboard","breakdown"]) assert.ok(render.includes('tab==="'+t+'"'), t);
  assert.ok(!/[^t]artView==="(lookbook|characters|props|locations|shots)"\s*&&\s*\w+\s*\n\s*\?/.test(render), "no tab picked by artView inside renderTab");
  // hidden (another room): nothing shows, no engine dock or Blender Studio, nothing preloaded
  assert.ok(room.includes('style:hidden ? { display:"none" } : undefined, "aria-hidden":hidden ? "true" : undefined,'));
  assert.ok(room.includes("!hidden && React.createElement(NbDock,null),"));
  assert.ok(room.includes("!hidden && window.BlenderStudioHost&&React.createElement(window.BlenderStudioHost"));
  assert.ok(room.includes('if(hidden || typeof nbPreloadFor!=="function") return;'));
});

await test("4b the pane plan: the same keyed pane survives a tab or room switch", ()=>{
  const plan = (artView, hidden, jobs)=>{
    const jobTabs = Array.from(new Set(Object.keys(jobs).map(k=>k.split(":")[0]))).filter(t=> hidden || t!==artView);
    return [ ...(hidden ? [] : [artView]), ...jobTabs ];
  };
  assert.deepEqual(plan("props", false, {}), ["props"]);
  assert.deepEqual(plan("characters", false, { "props:read":{} }), ["characters","props"], "Props reads while Characters shows");
  assert.deepEqual(plan("props", false, { "props:read":{}, props:{} }), ["props"], "one pane per tab");
  assert.deepEqual(plan("props", true, { "props:read":{}, shots:{} }), ["props","shots"], "another room: only the working tabs");
  assert.deepEqual(plan("props", true, {}), []);
});

await test("5 the app keeps the Art Room mounted, hidden, in another room while work runs", ()=>{
  assert.ok(app.includes("const artJobs = (window.useArtJobs || (()=>({})))();"));
  // the art branch keeps only the empty-story canvas; the Art Room has its own slot, keyed by the film
  assert.ok(app.includes('? React.createElement("div",{className:"canvas"}, emptyCanvas())\n          : null)'));
  assert.ok(app.includes('scenes.length>0 && (room==="art" || Object.keys(artJobs).length>0) && React.createElement(ArtRoom,{key:(cloudMode?currentProjectId:"local"),hidden:room!=="art",artView,'));
  assert.equal((app.match(/React\.createElement\(ArtRoom,/g)||[]).length, 1, "one Art Room");
});

await test("6 where it shows: a dot on the working tab, a bar with Open in the other rooms", ()=>{
  assert.ok(app.includes("attnTabs:{ characters: wardrobeAttn },tabLocks:artTabLocks,jobTabs:artJobTabs,"));
  assert.ok(chrome.includes("const job = inArt && cur!==id && jobTabs && jobTabs[id];"));
  assert.ok(chrome.includes('job ? React.createElement("span",{className:"seg-job-dot","aria-label":"still working"})'));
  assert.ok(chrome.includes('job ? (lab+" \\u2014 still working: "+job)'));
  const bar = between(app, 'room!=="art" && scenes.length>0 && Object.keys(artJobTabs).length>0 && React.createElement("div",{className:"art-bg-jobs"', '"Open"))))),');
  assert.ok(bar.includes('"Art Room \\u00b7 "+'));
  assert.ok(bar.includes("onClick:()=>{ if(guardedSetRoom(\"art\")) setArtView(t); }"));
  assert.match(css, /\.seg-job-dot\{[^}]*animation:segAttnPulse/);
  assert.match(css, /\.art-bg-jobs\{position:fixed;left:16px;bottom:22px;/);
});

await test("7 Frances knows, without naming anything internal", ()=>{
  const entry = between(ai, '{ name:"Art Room work keeps running in the background"', '" },');
  for(const w of ["another tab or another room","pulsing dot","bottom left","Open","review waits on the Props tab","different film stops the work","Cancel"]) assert.ok(entry.includes(w), w);
  assert.ok(!/TURN|turnArtJobs|credit/i.test(entry.replace(/\bturns?\b/g,"")), "no internals or billing");
});

await test("cache keys moved for every changed file", ()=>{
  for(const f of ["artroom.jsx","props.jsx","lookbook.jsx","locations-ui.jsx","shots-ui.jsx","chrome.jsx","ai.jsx","app.jsx"])
    assert.ok(["20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20"].some(k=>html.includes("app/"+f+"?v="+k+'"')), f);
  assert.ok(["20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20"].some(k=>html.includes("app/styles.css?v="+k+'"')));
});

console.log(`\n${checks} passed, ${failed} failed`);
if(failed) process.exit(1);
