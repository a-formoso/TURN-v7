#!/usr/bin/env node
/* The Lookbook reaches Shots; Storyboards stop being flagged for references they never read
   (owner 2026-10-05: "go ahead with the Shots and Storyboards fixes").
   A  the shot drafter's prompt carries the Lookbook's Lens & format, Composition and Lighting notes
      (+ the visual statement) — every Shots call site already passed them, the drafter never read them
   B  routing: Shots gets exactly its three categories; Storyboards is out of the routing and never stale
   C  the Shots banner says what follows the Lookbook (new and re-drafted shots) and offers "Mark reviewed"
      only (the Shot Designer re-plans only scenes with coverage issues); Storyboards has no banner
   D  Frances says the same
     node scripts/test-lookbook-shots.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const noop = ()=>{};
const ai = read("app/ai.jsx"), app = read("app/app.jsx"), look = read("app/lookbook.jsx"), art = read("app/artroom.jsx"),
  shotsUi = read("app/shots-ui.jsx"), sb = read("app/storyboard.jsx");

/* the real Lookbook helpers */
const lb = { console, React:{ createElement:()=>null }, Icon:{} }; lb.window = lb; vm.createContext(lb);
vm.runInContext(transformSync(look, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, lb);
const cards = [
  { id:"1", source:"Roger Deakins", category:"Lens & format", note:"wide anamorphic, deep focus" },
  { id:"2", source:"Gordon Willis", category:"Lighting", note:"top light, faces falling into shadow" },
  { id:"3", source:"Kubrick", category:"Composition", note:"one-point symmetry" },
  { id:"4", source:"Wong Kar-wai", category:"Palette", note:"saturated reds and greens" },
  { id:"5", source:"Fog studies", category:"Atmosphere", note:"low haze" },
];
const statement = "A cold, watchful film.";

/* ═══ A: the real drafter ═══ */
const calls = [];
const sbx = { console, localStorage:{ removeItem(){} }, setTimeout, clearTimeout, performance:{ now:()=>0 },
  CustomEvent:function(t, i){ this.type = t; this.detail = i && i.detail; } };
sbx.window = sbx; sbx.dispatchEvent = ()=>{}; vm.createContext(sbx);
sbx.shotBeatScreenplay = ()=>({ hasSource:true, sourceRev:"r1", text:"Mara crosses to the desk.", openingAction:"Mara crosses to the desk.",
  openingCharacterIds:["mara"], physicalCharacterIds:["mara"], remoteCharacterIds:[], mentionedCharacterIds:["mara"], dialogue:[] });
sbx.writingLoglineOf = ()=>"A letter changes hands.";
sbx.window.claude = { async complete(o){ calls.push(o); return '{"shots":[]}'; } };
vm.runInContext(ai, sbx);
const scene = { id:"s1", no:1, title:"The Letter", summary:"Mara takes the letter." };
const beats = { s1:{ rows:[{ n:1, drive:{ d:"Takes it" }, react:{ d:"Waits" } }] } };
const chars = [{ id:"mara", name:"Mara", pronouns:"she/her" }];
const draftPrompt = async (project)=>{ calls.length = 0; await sbx.aiDraftShots(scene, beats, { s1:{ blocks:[] } }, [], [], chars, project); return calls[0].messages[0].content; };
await test("A1 the shot drafter's prompt carries the Lookbook's Shots notes and the statement", async ()=>{
  const brief = lb.lookbookBriefFor("shots", cards, statement);
  const p = await draftPrompt({ title:"The Letter", _lookbookBrief:brief });
  assert.match(p, /LOOKBOOK — honour these visual references in each keyframe's lens, framing, composition and light/);
  assert.ok(p.includes("Overall look: A cold, watchful film.") && p.includes("Roger Deakins — wide anamorphic, deep focus")
    && p.includes("Gordon Willis — top light") && p.includes("Kubrick — one-point symmetry"));
  assert.ok(!p.includes("saturated reds") && !p.includes("low haze"), "Palette and Atmosphere aren't Shots' notes");
});
await test("A2 no Lookbook → no block; every Shots call site passes the Shots brief", async ()=>{
  assert.ok(!/LOOKBOOK/.test(await draftPrompt({ title:"The Letter" })));
  assert.equal((app.match(/aiDraftShots\([^)]*lbProject\("shots"\)/g)||[]).length, 3, "beat refine, scene draft, Shot Designer");
  assert.equal((app.match(/aiDraftShots\(/g)||[]).length, 3, "no Shots draft without it");
});

/* ═══ B ═══ */
await test("B1 routing: Shots = Lens & format, Composition, Lighting; no Storyboards department", ()=>{
  assert.deepEqual(Array.from(lb.LOOKBOOK_ROUTING.shots), ["Lens & format", "Composition", "Lighting"]);
  assert.equal(lb.LOOKBOOK_ROUTING.storyboard, undefined); assert.equal(lb.LOOKBOOK_DEPT_AFFECT.storyboard, undefined);
  const st = lb.lookbookStaleDepts(cards, statement, { shots:"old", storyboard:"old" }, { shots:true, storyboard:true });
  assert.equal(st.shots, true); assert.equal(st.storyboard, undefined, "never stale, even with an old applied brief saved");
  const flags = between(app, "const lbContentFlags = {", "};");
  assert.ok(!/storyboard/.test(flags) && !app.includes("t.storyboard = true"));
});

/* ═══ C ═══ */
await test("C1 the Shots banner: what follows the Lookbook, and only 'Mark reviewed'", ()=>{
  const notice = between(shotsUi, "const lookbookNotice = lookbookStale && ", "// ---- empty state ----");
  assert.ok(notice.includes("New and re-drafted shots follow them; the shots you have stay as they are until you re-draft their scene"));
  assert.ok(!notice.includes("Open Shot Designer") && notice.includes('"Mark reviewed"'));
  assert.ok(!art.includes('onApplyLookbook&&onApplyLookbook("shots")'));
  const apply = between(app, "const applyLookbook = async (dept, mode)=>{", "const draftOnly = mode===\"draft\";");
  assert.ok(apply.includes('if(dept==="shots") return;') && !apply.includes("setShotDesignerOpen(true)"));
});
await test("C2 Storyboards: no Lookbook banner and no stale prop", ()=>{
  const view = between(sb, "function StoryboardView({", "\n}\n");
  assert.ok(!/lb-stale-notice|Lookbook review needed|onReviewLookbook/.test(view));
  assert.ok(art.includes("React.createElement(window.StoryboardView,{project,scenes,shots,characters,props,locations,beatsMap,setArtView,onUpdateShot})"));
});

/* ═══ D ═══ */
await test("D1 Frances: Shots follow the Lookbook from their next draft; Storyboards take no references of their own", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Lookbook (References) (Art Room)")||{}).what || "";
  assert.ok(w.includes("Lens & format / Composition / Lighting → Shots (every new or re-drafted shot follows them;"));
  assert.ok(w.includes("Storyboards take no references of their own"));
  assert.ok(!/Composition \/ Atmosphere → the Storyboards tab/.test(fb.__F.map(f=>f.what||"").join(" ")));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);
