/* A blank canvas is not a film (owner, 2026-09-26): the working row the app keeps when there
   is no story yet used to be listed as a film called "Untitled film". Now it is never listed
   (switcher or Home), the chip reads "No project yet" with no format badge, the switcher's
   "New Story" opens the New Story window (no blank rows are minted), and a deletion opens a real film first. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const ui=read("app/auth-ui.jsx"), app=read("app/app.jsx"), cloud=read("app/cloud.jsx"), home=read("app/home-dashboard.jsx");
const box={console}; box.window=box; vm.createContext(box);
vm.runInContext(ui.slice(ui.indexOf("function turnFilmIsBlank("),ui.indexOf("window.turnFilmIsBlank = turnFilmIsBlank;")),box);
const blank=box.turnFilmIsBlank;

await test("what counts as a blank canvas",()=>{
  assert.equal(blank({id:"a",title:"Untitled film"}),true);
  assert.equal(blank({id:"a",title:""}),true);
  assert.equal(blank({id:"a",title:"Untitled film",hasScenes:"s1"}),false,"a scene makes it a film");
  assert.equal(blank({id:"a",title:"Untitled film",hasChars:"c1"}),false);
  assert.equal(blank({id:"a",title:"Untitled film",hasShots:"x"}),false);
  assert.equal(blank({id:"a",title:"Untitled film",hasLocs:"x"}),false);
  assert.equal(blank({id:"a",title:"Untitled film",logline:"A diver finds…"}),false);
  assert.equal(blank({id:"a",title:"My idea"}),false,"a film you named is a film");
  assert.equal(blank({id:"a",title:"Untitled film",showId:"s"}),false,"episodes are never hidden");
  assert.equal(blank({id:"a",title:"Untitled film",project_kind:"show"}),false);
  assert.equal(blank({id:"a",title:"Untitled film",isShared:true}),false,"a shared film is never hidden");
});

await test("the switcher never lists a blank canvas and says 'No project yet'",()=>{
  assert.ok(ui.includes('const standalone = (grouped.standalone||[]).filter(p=>!turnFilmIsBlank(p))'));
  assert.ok(ui.includes('const title = current ? (currentBlank ? "No project yet" : current.title) : "Loading\\u2026";'));
  assert.ok(ui.includes('"No projects yet \\u2014 start one with New Story."'));
  assert.ok(!ui.includes("a fresh blank one opens in its place"));
  assert.ok(read("app/styles.css").includes(".proj-empty{"));
});

await test("the switcher's 'New Story' opens the New Story window instead of minting a blank row",()=>{
  assert.ok(ui.includes('busyIs("new-film")?"Creating…":"New Story")'),"the button reads New Story, like the orange CTA");
  assert.ok(app.includes('"empty-canvas-title"},"Start your story")'),"the empty canvas says story, not film");
  assert.ok(ui.includes('"proj-menu-lab"},"Projects")')&&!/No films? yet|"New film"|Switch film|Delete film/.test(ui),"projects, not films");
  assert.ok(ui.includes('if(typeof onNewStory==="function"){ setOpen(false); onNewStory(); return; }'));
  assert.ok(app.includes('onNewStory:()=>{ setRoom("writers"); setView("spine"); startNewStory(); },'));
});

await test("no format badge on a blank canvas; Home shows no blank cards",()=>{
  assert.ok(app.includes('formatLabel:(typeof formatOf==="function" && !currentFilmBlank) ? formatOf(project).label : null,'));
  assert.ok(app.includes("const currentFilmBlank = !!_projRow && typeof window.turnFilmIsBlank===\"function\" && window.turnFilmIsBlank(_projRow)"));
  assert.ok(home.includes('.filter(p=>!(typeof window.turnFilmIsBlank==="function" && window.turnFilmIsBlank(p)));'));
});

await test("the list knows enough to tell, and the open film's row stays live",()=>{
  assert.equal((cloud.match(/hasScenes:doc->scenes->0->>id,hasChars:doc->characters->0->>id/g)||[]).length,2,"current and legacy list queries");
  const eff=app.slice(app.indexOf("The open film's list row carries LIVE facts"),app.indexOf("const agentLiveRef = React.useRef(null);"));
  assert.ok(eff.includes("if(!currentProjectId || projectLoading) return;")&&eff.includes("return { ...p, hasScenes, hasChars, logline };"));
});

await test("a deletion opens a real film first, and reuses a blank canvas before creating one",()=>{
  const d=app.slice(app.indexOf("const _openAfterCommittedDeletion=async"),app.indexOf("const deleteShow = async"));
  const sortAt=d.indexOf("ordered.sort((a,b)=> (_blank(a)?1:0)-(_blank(b)?1:0));"), loopAt=d.indexOf("for(const row of ordered)"), createAt=d.indexOf('cloudCreateProject("Untitled film"');
  assert.ok(sortAt>0 && loopAt>sortAt && createAt>loopAt);
  // the sort: real films first, blank canvases after (stable otherwise)
  const b={console,window:{turnFilmIsBlank:blank}}; vm.createContext(b);
  const rows=[{id:"blank1",title:"Untitled film"},{id:"real",title:"Neon Tide",hasScenes:"s"},{id:"blank2",title:""}];
  const _blank=(r)=>blank(r); rows.sort((x,y)=>(_blank(x)?1:0)-(_blank(y)?1:0));
  assert.equal(rows[0].id,"real");
});

await test("MUSE knows",()=>{
  const m=read("app/ai.jsx"); const s=m.slice(m.indexOf("const APP_FEATURES"),m.indexOf("function appBrief"));
  assert.ok(s.includes('name:"Projects switcher (no project yet)"')&&s.includes("There is never a placeholder project called 'Untitled film'")&&!s.includes("Films & shows"));
});

console.log(checks+" checks passed");
