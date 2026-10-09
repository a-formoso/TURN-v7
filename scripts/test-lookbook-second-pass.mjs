#!/usr/bin/env node
/* The Lookbook, second pass (owner 2026-10-06: "go ahead with all of it") — does it keep its promises?
   A  "The Lookbook changed" is decided PER CARD: a drafted card records its brief (lookbookBrief); an older
      stamp = out of date; a card drafted before stamps follows the department record; a hand-written
      card is never flagged; Color / Shots keep the department rule
   B  the three drafters stamp every card they write; the Shots-side prop draft carries the brief
   C  single-card / missing-only / failed drafts never mark a whole department; agents mark only after
      real re-drafts; forced re-drafts keep a picked render style; the banner's re-drafts are priced
   D  Color: your own references → its own banner (use the Lookbook's notes / keep mine); approving a
      palette lit from your text doesn't mark the Lookbook applied
   E  research reads the story (summaries, turns, screenplay excerpts); from scratch replaces only on
      success; research card ids never reuse a deleted card's; Run pre-production never trims and says
      it applies the render style
   F  copy and dead code; Frances
     node scripts/test-lookbook-second-pass.mjs */
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
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};
const look = read("app/lookbook.jsx"), app = read("app/app.jsx"), ai = read("app/ai.jsx"), ag = read("app/agents.jsx");

const lb = { console, Object, Array, String, Set, React:{ createElement:()=>null }, Icon:{} }; lb.window = lb; vm.createContext(lb);
vm.runInContext(read("app/scene-order.js"), lb);
vm.runInContext(transformSync(look, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, lb);
const cards = [{ id:"w", source:"Costume Lab", category:"Wardrobe", note:"worn wool" }];
const briefNow = lb.lookbookBriefFor("characters", cards, "Cold film.");
const stampNow = lb.lookbookBriefStamp(briefNow);

/* ═══ A ═══ */
await test("A1 per card: an older stamp is out of date; a current one isn't; the rest of the cast doesn't hide it", ()=>{
  const st = (chars, applied)=> J(lb.lookbookStaleDepts(cards, "Cold film.", applied||{}, { characters:true }, { characters:chars }));
  assert.deepEqual(st([{ id:"a", lookbookBrief:stampNow }]), {});
  assert.deepEqual(st([{ id:"a", lookbookBrief:stampNow }, { id:"b", lookbookBrief:"lb-old" }]), { characters:true }, "one card still on the old brief");
  // the old rule would have cleared it once ANY card was drafted and the department marked
  assert.deepEqual(st([{ id:"b", lookbookBrief:"lb-old" }], { characters:briefNow }), { characters:true });
});
await test("A2 drafted before stamps: the department record decides; a hand-written card is never flagged", ()=>{
  const st = (chars, applied)=> J(lb.lookbookStaleDepts(cards, "Cold film.", applied||{}, { characters:true }, { characters:chars }));
  assert.deepEqual(st([{ id:"a", writingProvenance:{ model:"m" } }]), { characters:true }, "applied '' vs a brief");
  assert.deepEqual(st([{ id:"a", writingProvenance:{ model:"m" } }], { characters:briefNow }), {});
  assert.deepEqual(st([{ id:"h" }]), {}, "written by hand");
  assert.deepEqual(st([]), {});
});
await test("A3 Color and Shots keep the department rule; the stamp is stable and content-based", ()=>{
  const all = [{ id:"p", source:"Wong", category:"Palette", note:"reds" }];
  assert.deepEqual(J(lb.lookbookStaleDepts(all, "", {}, { colorist:true }, {})), { colorist:true });
  assert.deepEqual(J(lb.lookbookStaleDepts(all, "", { colorist:lb.lookbookBriefFor("colorist", all, "") }, { colorist:true }, {})), {});
  assert.equal(lb.lookbookBriefStamp("x"), lb.lookbookBriefStamp(" x ")); assert.notEqual(lb.lookbookBriefStamp("x"), lb.lookbookBriefStamp("y"));
  assert.ok(app.includes("lookbookStaleDepts(lookbook, lookbookNote, lookbookApplied, lbContentFlags, lbCards)"));
  assert.ok(app.includes("locations:(locations||[]).filter(l=>l && (typeof locVisualsDrafted===\"function\" ? locVisualsDrafted(l) : false)),"), "a location only pulled isn't drafted");
});

/* ═══ B ═══ */
await test("B1 the three drafters stamp every card; the stamp is undefined without a brief", ()=>{
  assert.equal((ai.match(/writingProvenance:by, \.\.\.\(_lookbookStamp\(project\)!==undefined \? \{ lookbookBrief:_lookbookStamp\(project\) \} : \{\}\)/g)||[]).length, 3);
  const b = { console, Object }; b.window = b; vm.createContext(b);
  b.lookbookBriefStamp = lb.lookbookBriefStamp;
  vm.runInContext(between(ai, "function _lookbookStamp(project){", "\nfunction _lookbookBlock("), b);
  assert.equal(b._lookbookStamp({ title:"T" }), undefined);
  assert.equal(b._lookbookStamp({ _lookbookBrief:briefNow }), stampNow);
  assert.ok(read("app/shots.jsx").includes('_lookbookBrief:lbBrief } : project);') && app.includes('window.turnLookbookBriefFor = (dept)=>'));
});

/* ═══ C ═══ */
await test("C1 no single-card, missing-only or failed draft marks a department; agents mark only after real re-drafts", ()=>{
  const calls = (app.match(/markApplied\(/g)||[]).length;
  assert.ok(!/markApplied\("(characters|props|locations)"\)/.test(app), "the app's draft paths never mark a card department");
  assert.ok(app.includes("if(ok) markApplied(dept);") && calls <= 5, "only the review, the Color 'keep mine', the agent bridge and its definition remain ("+calls+")");
  assert.ok(ag.includes("if(ctx.art.markApplied && ctx.force && specs>0) ctx.art.markApplied(\"characters\");"));
  assert.equal((ag.match(/ctx\.force && drafted>0\) ctx\.art\.markApplied\("props"\)/g)||[]).length, 2);
  assert.ok(ag.includes('if(ctx.art.markApplied && drafted>0) ctx.art.markApplied("props");') && ag.includes('if(ctx.art.markApplied && specs>0) ctx.art.markApplied("locations");'));
});
await test("C2 forced re-drafts keep a picked render style; the banner's re-drafts say what they'll cost", ()=>{
  assert.ok(app.includes("{...p, ...keepPickedStyle(p, map[p.id])}") && app.includes("{...l, ...keepPickedStyle(l, map[l.id])}"));
  const apply = between(app, "const applyLookbook = async (dept, mode)=>{", "const [researchOpen");
  assert.ok(apply.includes('const costLine = " Cost: writing credits for "+draftedN+" spec"') && apply.includes("note:costLine.trim(), confirmLabel:\"Re-draft only\"") && apply.includes("note:costLine.trim(), confirmLabel:\"Re-draft & regenerate\""));
  assert.ok(!apply.includes('else if(dept==="colorist"){ coloristRedoManualRef'), "the unreachable Color branch is gone");
  assert.ok(ag.includes("(a place without depth-grid staging gets it; staging you already have stays)"));
});

/* ═══ D ═══ */
await test("D1 Color with your own references: its own banner; approving doesn't mark the Lookbook applied", ()=>{
  const ui = read("app/stylebible-ui.jsx");
  assert.ok(ui.includes("lookbookStale && refsOwned && React.createElement(\"div\",{className:\"lb-stale-notice\",role:\"status\"},"));
  assert.ok(ui.includes('"Use the Lookbook\\u2019s colour notes"') && ui.includes('"Keep mine"') && ui.includes("!refsOwned && window.LookbookStaleNotice"));
  assert.ok(app.includes("refs:brief, lookbookSynced:brief } })); };") && app.includes('const keepOwnColorRefs = ()=>{ if(!canMutateSharedFilm()) return; markApplied("colorist"); };'));
  assert.ok(app.includes('markApplied: (dept)=>{ if(dept==="colorist" && typeof colorRefsFor==="function"') && app.includes(".owned) return;"));
  assert.ok(read("app/artroom.jsx").includes("refsOwned:!!colorRefsOwned,onUseLookbookRefs:readOnly?null:onUseLookbookColorRefs,onKeepRefs:readOnly?null:onKeepColorRefs})"));
});

/* ═══ E: the real research call ═══ */
const runResearch = async (existing, opts, scenes, drafts)=>{
  const bodies = [];
  const sbx = { console, localStorage:{ getItem:()=>null, setItem(){}, removeItem(){} }, setTimeout, clearTimeout, performance:{ now:()=>0 },
    CustomEvent:function(t, i){ this.type = t; this.detail = i && i.detail; } };
  sbx.window = sbx; sbx.dispatchEvent = ()=>{}; vm.createContext(sbx);
  sbx.sbClient = ()=>({ functions:{ invoke:async (fn, o)=>{ bodies.push(o.body); return { data:{ text:'{"statement":"S","refs":[]}', usage:{} }, error:null }; } } });
  sbx.TURN_SUPABASE = { imageProxyFn:"image-proxy" };
  vm.runInContext(read("app/scene-order.js"), sbx);
  vm.runInContext(ai, sbx);
  sbx.turnContinuity = { drafts: drafts||{} };
  await sbx.aiResearchLookbook(scenes, { title:"T", logline:"A letter changes hands." }, existing, opts);
  return bodies[0].messages[0].content;
};
const scenes = [{ id:"s1", no:1, title:"The Letter", summary:"Mara finds a sealed letter under the floorboards." },
  { id:"s2", no:2, title:"Dawn", summary:"She reads it at the window as the sun rises." }];
const drafts = { s1:{ blocks:[{ type:"scene", text:"INT. ATTIC - NIGHT" }, { type:"action", text:"Dust hangs in a single shaft of moonlight." }, { type:"dialogue", text:"Who left this?" }] } };
await test("E1 research reads the story: summaries and screenplay action (never the dialogue)", async ()=>{
  const p = await runResearch([], {}, scenes, drafts);
  assert.match(p, /SCENES \(in story order\):\n#1 The Letter — Mara finds a sealed letter/);
  assert.match(p, /SCREENPLAY EXCERPTS[^\n]*\n#1: INT\. ATTIC - NIGHT Dust hangs in a single shaft of moonlight\./);
  assert.ok(!p.includes("Who left this?"));
  assert.ok(!/Beats: /.test(p), "no longer just the titles");
});
await test("E2 from scratch asks for the full brief even with your own noted cards (it used to gap-fill)", async ()=>{
  const mine = [{ id:"m", source:"My Ref", category:"Palette", note:"teal", manual:true }];
  const fresh = await runResearch(mine, { fresh:true }, scenes, {});
  assert.match(fresh, /Give 8 reference TOUCHSTONES/); assert.match(fresh, /Your own cards stay in the lookbook \(do NOT repeat these sources\): My Ref \(Palette\)/);
  const gap = await runResearch(mine, {}, scenes, {});
  assert.ok(!/Give 8 reference TOUCHSTONES/.test(gap), "a normal re-run still fills gaps");
});
await test("E3 from scratch replaces only on success; ids never reuse a deleted card's; the Coordinator never trims", ()=>{
  const fresh = between(app, "const researchLookbookFresh = async ()=>{", "const purgeLookbookCard");
  assert.ok(fresh.includes("lookbookFreshRef.current = true;") && !fresh.includes("deletedAt:at"));
  const surf = between(app, "const fresh = !!lookbookFreshRef.current; lookbookFreshRef.current = false;", "// keep an existing statement");
  assert.ok(surf.indexOf("return { statement:\"\", added:0, failed:fresh };") < surf.indexOf("deletedAt:at"));
  assert.ok(app.includes('id:"look-"+slug(e.source).slice(0,24)+"-"+i+"-"+Date.now().toString(36)'));
  assert.ok(ag.includes("if(res && res.failed){") && ag.includes("your Lookbook is unchanged"));
  assert.ok(ag.includes("if(plan && plan.drop && plan.drop.length && ctx.autoApprove){") && ag.includes("Run pre-production doesn't trim it"));
  assert.ok(ag.includes("the Lookbook's render-style pick (it sets the style on every character, prop and location)"));
});

/* ═══ F ═══ */
await test("F1 copy, purge, Shots notice, dead comment; Frances", ()=>{
  assert.ok(!/Generate all frames/.test(ag) && !/clear the look statement in the Lookbook and run again/.test(ag));
  const art = read("app/artroom.jsx");
  assert.ok(art.includes('(kind==="reference" ? "mood frame" : kind==="shot" ? "frame and its earlier versions" : kind==="location" ? "plates" : "reference sheet")'));
  assert.ok(app.includes("Couldn't delete that mood frame just now"));
  assert.ok(read("app/shots-ui.jsx").includes("its visual statement or its Lens & format, Composition or Lighting notes changed"));
  assert.ok(!app.includes("// Remove the whole Lookbook (references + statement + their mood frames)."));
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Lookbook (References) (Art Room)")||{}).what || "";
  for(const re of [/EACH CARD REMEMBERS ITS LOOKBOOK/, /a card you wrote by hand is never flagged/, /RESEARCH READS THE STORY/, /replaces the statement and the researched cards only when the new ones arrive/,
    /never trims the Lookbook/, /say what they'll cost before they run/, /'Keep mine'/]) assert.ok(re.test(w), String(re));
  assert.ok(!/fast-follow|Nano Banana or GPT Image|both clear the flag/.test(w));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);
