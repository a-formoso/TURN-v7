#!/usr/bin/env node
/* The Color tab, second pass (owner 2026-10-05: "go ahead with all of it") — does the look reach the film?
   A  the video gets the whole look: grade, 60/30/10 palette, lens character, texture and film stock
      (turnVideoLookText), in the Stage's prompts, the director brief, the Shots video text and the
      prompt's recompile signature
   B  the look signature also covers the look's name and colour names ("look2-"); frames stamped
      before keep their old check, so nothing is flagged all at once
   C  takes remember their look: stamped at render (References + Extend); 'Earlier look' in Takes,
      the Timeline and Shoot — a note, never a block
   D  copy: the info tip's reach is true; Color's Lookbook banner offers "Light the film again" with
      its own question; the film-strip cells work from the keyboard
   E  reference stills: a 384px copy is kept, and the Colorist LOOKS at it (the vision call) —
      without stills it stays a plain writing call
   F  Frances knows
     node scripts/test-color-second-pass.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const sbSrc = read("app/stylebible.jsx"), shots = read("app/shots.jsx"), stage = read("app/stage.jsx"), brief = read("app/stage-director-brief.js"),
  ui = read("app/stylebible-ui.jsx"), app = read("app/app.jsx"), look = read("app/lookbook.jsx"), ai = read("app/ai.jsx"), css = read("app/styles.css");

const box = { console, Object, Array, String, JSON, Math, Set, Number }; box.window = box; vm.createContext(box);
vm.runInContext(sbSrc, box);
const ember = { id:"ember", name:"Ember Night", grade:"warm tungsten, crushed blacks", palette:["#1a0f0a","#b5562a","#f2c14e"],
  dominantLabel:"soot", secondaryLabel:"rust", accentLabel:"sodium gold", lighting:"practicals only", lens:"anamorphic 40mm", texture:"heavy grain" };
const film = (stock)=>({ styleBible:{ filmStock:stock } });

/* ═══ A ═══ */
await test("A1 the video look line: grade, palette with names, lens character, texture, film stock", ()=>{
  const t = box.turnVideoLookText(ember, film("trix"));
  assert.ok(t.startsWith("Ember Night — warm tungsten, crushed blacks; colour 60/30/10: soot #1a0f0a, rust #b5562a, sodium gold #f2c14e; lens character: anamorphic 40mm; texture: heavy grain; "), t);
  assert.match(t, /Kodak Tri-X 400 black-and-white film: monochrome \(no colour\)/);
  assert.equal(box.turnVideoLookText(null, film("none")), "", "no look, no stock → nothing");
  assert.match(box.turnVideoLookText(null, film("portra")), /^Shot on Kodak Portra/, "a stock alone still reaches the video");
});
await test("A2 every Stage look line goes through it; the director brief, the Shots video text and the recompile signature too", ()=>{
  assert.equal((stage.match(/d\.preset\.name\+" — "\+d\.preset\.grade/g)||[]).length, 0, "no name — grade only line left");
  assert.equal(stage.split("\n").filter(l=>/_stageLook\(d\)/.test(l) && !/function _stageLook/.test(l)).length, 7, "seven look lines");
  assert.ok(stage.includes("const lookText = (typeof turnVideoLookText===\"function\") ? turnVideoLookText(preset, ctx.project)"));
  assert.ok(/return \{ shots, promptShots,[^\n]*preset, lookText, camera,/.test(stage));
  assert.ok(stage.includes('d.preset&&[d.preset.name,d.preset.grade,d.preset.lighting], d.lookText||"",'), "a stock change recompiles an untouched prompt");
  assert.ok(brief.includes('typeof d.lookText==="string" ? text(d.lookText)'));
  const sb = { console, Array, Set, String }; sb.window = sb; vm.createContext(sb);
  vm.runInContext(sbSrc + "\n" + between(shots, "function sceneVideoPromptText(scene, sceneShots, opts){", "\n}\n") + "\n}", sb);
  sb.scenePreset = ()=>ember;
  const txt = sb.sceneVideoPromptText({ id:"s1" }, [{ id:"a", action:"Mara crosses" }], { project:film("cinestill800t") });
  assert.match(txt, /Style: Ember Night — warm tungsten[^\n]*CineStill 800T[^\n]*\.$/);
});
await test("A3 the clip's fallback (a clip built elsewhere) is the old name — grade", ()=>{
  const b = {}; vm.createContext(b);
  vm.runInContext(between(stage, "function _stageLook(d){", "\n}\n")+"\n}", b);
  assert.equal(b._stageLook({ lookText:"" }), "", "an empty look stays empty");
  assert.equal(b._stageLook({ preset:{ name:"Noir", grade:"hard" } }), "Noir — hard");
});

/* ═══ B ═══ */
const sh = { console, Object, Array, String, JSON, Math, Set }; sh.window = sh; vm.createContext(sh);
vm.runInContext(between(shots, "function _lookHash(raw){", "window.shotLookSig"), sh);
const P = (preset, stock)=>({ __p:preset, styleBible:{ filmStock:stock||"none" } });
sh.scenePreset = (project)=>project.__p;
await test("B1 the look now includes its name and colour names; an old signature is checked the old way", ()=>{
  const now = sh.shotLookSig(P(ember, "trix"), "s1");
  assert.match(now, /^look2-/);
  assert.notEqual(now, sh.shotLookSig(P({ ...ember, name:"Ember" }, "trix"), "s1"), "a rename is a new look");
  assert.notEqual(now, sh.shotLookSig(P({ ...ember, accentLabel:"amber" }, "trix"), "s1"), "a colour rename too");
  assert.equal(sh.shotLookIsEarlier(now, P(ember, "trix"), "s1"), false);
  assert.equal(sh.shotLookIsEarlier(now, P({ ...ember, name:"Ember" }, "trix"), "s1"), true);
  const legacy = sh.shotLookSigLegacy(P(ember, "trix"), "s1");
  assert.match(legacy, /^look-/);
  assert.equal(sh.shotLookIsEarlier(legacy, P(ember, "trix"), "s1"), false, "an existing frame isn't flagged by the new formula");
  assert.equal(sh.shotLookIsEarlier(legacy, P({ ...ember, grade:"cold" }, "trix"), "s1"), true, "a real change still flags it");
  assert.equal(sh.shotLookIsEarlier(legacy, P(ember, "none"), "s1"), true);
  assert.equal(sh.shotLookIsEarlier("", P(ember, "trix"), "s1"), false, "no stored look → never flagged");
});
await test("B2 every frame check uses it (Shots, Storyboards, the frame state)", ()=>{
  assert.ok(shots.includes("const oldLook = !!(m && project && sh && shotLookIsEarlier(m.lookSig, project, sh.sceneId));"));
  assert.ok(read("app/storyboard.jsx").includes("shotLookIsEarlier(m.lookSig, ctx.project, scene.id)) h.oldLook++;"));
  assert.ok(read("app/shots-ui.jsx").includes("shotLookIsEarlier(m.lookSig, ctx.project, scene.id)) oldLook++;"));
  for(const f of ["app/shots.jsx", "app/storyboard.jsx", "app/shots-ui.jsx", "app/stage.jsx", "app/breakdown.jsx"])
    assert.ok(!/m\.lookSig!==lookNow/.test(read(f)), f+": no direct comparison left");
});

/* ═══ C ═══ */
await test("C1 takes are stamped with the look at render (References + Extend)", ()=>{
  assert.ok(stage.includes('const clipLookSig = (typeof shotLookSig==="function") ? shotLookSig(ctx.project, scene.id) : "";'));
  assert.ok(stage.includes('takeMeta:{ lookSig:clipLookSig, source:referenceFree?"text-only":sourceMode,'));
  assert.ok(stage.includes('takeMeta:{ lookSig:clipLookSig, screenplayReference, screenplayImages:includedScreenplayImages, source:"extend",'));
});
await test("C2 an earlier-look take: 'Earlier look' in Takes, a ring + count in the Timeline, a note in Shoot — never left out", ()=>{
  const view = between(stage, "function StageView({", "window.StageView = StageView;");
  assert.ok(view.includes("shotLookIsEarlier(m.lookSig, project, c.scene.id)) oldLookVids[c.id] = true;"));
  assert.ok(view.includes("takeOldLook:!!oldLookVids[clip.id]") && view.includes("auds, characters, oldLookVids,"));
  assert.ok(stage.includes('"Earlier look"') && stage.includes("shotLookIsEarlier(m.lookSig, window.turnProject, clip.scene.id)"));
  const tl = between(stage, "function StageTimelineView({", "\n}\n");
  assert.ok(tl.includes('(has && (oldLookVids||{})[c.id]?" old-look":"")') && tl.includes('" with an earlier look"'));
  assert.ok(tl.includes("made with an earlier look (still in the film;"));
  assert.ok(css.includes(".stage2-tl-clip.old-look .stage2-tl-dot.ok{background:transparent;box-shadow:inset 0 0 0 2px var(--accent)}"));
  assert.ok(stage.includes('const takeOldLookNotice = !takeStale && takeOldLook && _stEl("div",{key:"take-old-look",className:"stage2-hint"},'));
  assert.ok(stage.includes("readinessNotice, takeStaleNotice, takeOldLookNotice,"));
  assert.ok(!/oldLookVids/.test(between(stage, "function stageExportSkipped(", "\n}\n")), "an earlier look never drops a clip from the export");
});

/* ═══ D ═══ */
await test("D1 the info tip says what really reads the look", ()=>{
  assert.ok(ui.includes("Shot frames and the Stage's video renders use each scene's look and the film stock; character sheets and location plates stay neutral on purpose"));
  assert.ok(!ui.includes("Characters, locations and shots read the assigned look"));
});
await test("D2 Color's Lookbook banner: 'Light the film again', its own question, never 'regenerates its sheets'", ()=>{
  assert.ok(ui.includes('applyLabel:"Light the film again"'));
  assert.ok(look.includes('applyLabel||"Re-draft & regenerate"') && look.includes("title:applyTitle||"));
  const apply = between(app, "const applyLookbook = async (dept, mode)=>{", "const draftOnly = mode===\"draft\";");
  const c = between(apply, 'if(dept==="colorist"){', "return;\n    }");
  assert.ok(c.includes('title:"Light the film again from the updated Lookbook?"') && c.includes("scenes you set by hand") && c.includes("setColoristOpen(true)"));
  assert.ok(!/regenerates its sheets/.test(c));
});
await test("D3 film-strip scenes work from the keyboard", ()=>{
  const strip = between(ui, "function StyleFilmStrip(", "\n}\n");
  assert.ok(strip.includes('role: editable ? "button" : undefined, tabIndex: editable ? 0 : undefined,'));
  assert.ok(strip.includes('if(e.key==="Enter" || e.key===" "){ e.preventDefault(); setPick(open?null:s.id); }'));
  assert.ok(strip.includes('"aria-expanded": editable ? (open?"true":"false") : undefined,'));
});

/* ═══ E: the real Colorist call ═══ */
const runColorist = async (refImages)=>{
  const bodies = [];
  const sbx = { console, localStorage:{ getItem:()=>null, setItem(){}, removeItem(){} }, setTimeout, clearTimeout, performance:{ now:()=>0 },
    CustomEvent:function(t, i){ this.type = t; this.detail = i && i.detail; } };
  sbx.window = sbx; sbx.dispatchEvent = ()=>{}; vm.createContext(sbx);
  const reply = JSON.stringify({ presets:[{ id:"a", name:"A", grade:"g", palette:["#111111","#222222","#333333"], dominantLabel:"x", secondaryLabel:"y", accentLabel:"z", lighting:"l", lens:"n", texture:"t" }],
    sceneStyles:{ s1:"a" }, filmStock:"none", paletteWhy:"why", sceneWhy:{ s1:"because" } });
  sbx.sbClient = ()=>({ functions:{ invoke:async (fn, o)=>{ bodies.push(o.body); return { data:{ text:reply, usage:{} }, error:null }; } } });
  sbx.TURN_SUPABASE = { imageProxyFn:"image-proxy" };
  sbx.scenesInStoryOrder = (s)=>(s||[]).slice();
  vm.runInContext(ai, sbx);
  const project = { title:"T", styleBible:{ refs:"", refImages } };
  const out = await sbx.aiAssignSceneStyles([{ id:"s1", no:1, title:"One", charge:1 }], [], {}, project);
  return { bodies, out };
};
const still = "data:image/jpeg;base64,"+Buffer.from("\xff\xd8\xff\xe0 fake jpeg bytes").toString("base64");
await test("E1 with stills, the Colorist LOOKS at them (a vision call carrying each 384px copy) and is told so", async ()=>{
  const { bodies, out } = await runColorist([{ id:"r1", thumb:"t", view:still, colors:["#112233"] }, { id:"r2", thumb:"t", colors:["#445566"] }]);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].usageKind, "vision");
  assert.deepEqual(Array.from(bodies[0].images), [still], "only stills that have a copy (an older one keeps its colours)");
  const prompt = bodies[0].messages[0].content;
  assert.match(prompt, /REFERENCE STILLS ATTACHED \(1\)/); assert.match(prompt, /#112233, #445566/);
  assert.ok(out && out.presets && out.presets.length, "the reply is read as before");
});
await test("E2 without stills it stays a plain writing call", async ()=>{
  const { bodies } = await runColorist([{ id:"r2", thumb:"t", colors:["#445566"] }]);
  assert.equal(bodies.length, 1); assert.notEqual(bodies[0].usageKind, "vision"); assert.equal(bodies[0].images, undefined);
  assert.ok(!/REFERENCE STILLS ATTACHED/.test(bodies[0].messages[0].content));
});
await test("E3 an upload keeps a ≤384px copy; the thumbnail says whether the Colorist sees it", ()=>{
  const ex = between(ui, "function extractImageRef(file){", "\n}\n");
  assert.ok(ex.includes("const vs=Math.min(1,384/Math.max(W,H))") && ex.includes('const view=vc.toDataURL("image/jpeg",0.72);') && ex.includes("thumb, view, colors"));
  assert.ok(ui.includes("the Colorist looks at it and its sampled palette when it lights the film") && ui.includes("remove it and add it again to let it see the image"));
  assert.ok(ui.includes("(a little more when it looks at your reference stills)"));
});

/* ═══ F ═══ */
await test("F1 Frances: the video's whole look, takes' earlier look, the stills, the banner, the keyboard", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Color / scene looks (Art Room)")||{}).what || "";
  for(const re of [/THE VIDEO GETS THE WHOLE LOOK/, /a black-and-white stock stays black-and-white/, /'Earlier look' in Takes/, /stays in the film/,
    /LOOKS AT each uploaded still/, /'Light the film again'/, /Tab, then Enter or Space/]) assert.ok(re.test(w), String(re));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);
