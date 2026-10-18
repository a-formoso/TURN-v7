#!/usr/bin/env node
/* Home, third pass (owner 2026-10-09: "go ahead with all of it"; decision A: posters ask once, with the price)
   A  posters: nothing is painted on its own — an offer with the price, "Not now" remembered, no batch for
      draft-only accounts, a failure stops the batch; Regenerate asks with its price; no model name in the copy
   B  Download keeps the title's letters and saves the file; shared cards name the owner, never their email
   C  the room buttons never make a blank film; "Back to <film>" only when one is open
   D  a real button per card, a stepper that says where you are, the poster viewer is a dialog
   E  the feature strip, Frances and keys
     node scripts/test-home-third-pass.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, f)=>{ try{ await f(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };

const home = read("app/home-dashboard.jsx"), app = read("app/app.jsx"), css = read("app/styles.css"),
  ai = read("app/ai.jsx"), html = read("TURN.html");

/* ═══ A ═══ */
await test("A1 Home paints nothing on its own: the old effect is gone, an offer with the price takes its place", ()=>{
  assert.ok(!/useEffect\([^]*?onGeneratePoster\(/.test(between(home, "function HomeDashboard(props){", "// ----- full-screen poster preview")));
  const o = between(home, "const [genBusy, setGenBusy]", "// ----- full-screen poster preview");
  assert.ok(o.includes("const noPoster = mine.filter(p=> !p.cover && String(p.logline||\"\").trim());"));
  assert.ok(o.includes("(typeof onGeneratePoster===\"function\" && !draftOnly) ? noPoster.filter(p=> skip.indexOf(p.id)<0) : []"));
  assert.ok(o.includes("window.turnDraftImagesOnly()"));
  assert.ok(o.includes("const ok = await window.appConfirm({ title:\"Paint \"+n+\" poster\"") && o.includes("if(!ok) return;"));
  assert.ok(o.includes("about \"+price+\" credits in all"));
  assert.ok(/catch\(err\)\{[^]*?break;/.test(o), "a failure stops the batch");
  assert.ok(o.includes("if(painting || !offer.length) return;"), "no double batch");
});
await test("A2 'Not now' is remembered on this device for those films", ()=>{
  assert.ok(home.includes('const POSTER_SKIP_KEY = "turn_home_poster_skip";'));
  const n = between(home, "const notNow = ()=>{", "const paintAll");
  assert.ok(n.includes("skip.concat(offer.map(p=>p.id))") && n.includes("localStorage.setItem(POSTER_SKIP_KEY"));
  assert.ok(between(home, "const readSkip = ()=>{", "\n").includes("try{"));
});
await test("A3 the offer line: count, price on the button, Not now; shared films never offered", ()=>{
  const r = between(home, "const recentSection", "mine.length > PER");
  assert.ok(r.includes("offer.length>0 && h(\"div\",{className:\"hd-poster-offer\",role:\"status\"}"));
  assert.ok(r.includes("\" no poster\"") && r.includes("\"Not now\"") && r.includes("posterCost(offer.length)"));
  assert.ok(home.includes("const mine = films.filter(p=> !p.isShared);"));
  assert.ok(/\.hd-poster-offer\{[^}]*display:flex/.test(css));
});
await test("A4 Regenerate asks first, with the price; the current poster stays restorable", ()=>{
  const g = between(home, "const doRegen = async (p,e)=>{", "const doRestore");
  assert.ok(g.indexOf("window.appConfirm") >= 0 && g.indexOf("window.appConfirm") < g.indexOf("onRegenPoster(p)"));
  assert.ok(g.includes("posterCost(1)") && g.includes("if(!ok) return;") && g.includes("stays restorable"));
});
await test("A5 the price is the poster's own (GPT Image 2.5 Sunburst, high quality, 2K, 9:16 — 2026-10-11) and no model name reaches the copy", ()=>{
  assert.ok(home.includes('window.nbImageCostText(Math.max(1, n||1), { model:"gpt-image-2.5-sunburst", quality:"high", res:"2K", aspect:"9:16" })'));
  const ui = between(home, "const paintAll", "// ----- top bar");
  assert.ok(!/GPT|OpenAI/.test(ui.replace(/\/\/[^\n]*/g, "")), "no model or vendor name in the confirms");
});

/* ═══ B ═══ */
await test("B1 a poster's file name keeps the title's letters in any language", ()=>{
  const src = between(home, "function posterFileName(title){", "\n  }\n")+"\n  }";
  const box = {}; vm.createContext(box); vm.runInContext(src+";this.f=posterFileName;", box);
  assert.equal(box.f("東京物語"), "東京物語-poster.jpg");
  assert.equal(box.f("Amélie: Part 2!"), "Amélie-Part-2-poster.jpg");
  assert.equal(box.f("   "), "poster-poster.jpg");
  assert.equal(box.f("?!"), "poster-poster.jpg");
});
await test("B2 Download fetches and saves the file (a cloud poster's link would only open a tab)", ()=>{
  const d = between(home, "async function downloadPoster(url, title){", "window.turnPosterFileName");
  assert.ok(d.includes("await (await fetch(url)).blob()") && d.includes("URL.createObjectURL(blob)") && d.includes("a.download = name"));
  assert.ok(d.includes("URL.revokeObjectURL(href)") && d.includes('a.target = "_blank"'));
  assert.ok(home.includes("downloadPoster(p.cover, p.title); };") && home.includes("onClick:()=>downloadPoster(viewer.url, viewer.title)"));
});
await test("B3 a shared card names the owner, never their email address", ()=>{
  assert.ok(home.includes('p.ownerEmail ? ("Shared by "+ownerName(p.ownerEmail)) : "Shared with you"'));
  assert.ok(!home.includes('"Shared by "+p.ownerEmail'));
  const o = between(home, "const ownerName = (email)=>{", "const posterCost");
  assert.ok(o.includes("cloudHandleName(e)") && o.includes('e.split("@")[0].split("+")[0]'));
});

/* ═══ C ═══ */
await test("C1 with no film open a room button opens your most recent film, or New Story — never a blank film", ()=>{
  const g = between(app, "onGoRoom: async (rid)=>{", "onClose: ()=>setHomeOpen(false),");
  assert.ok(!g.includes("createProject"), "no new film");
  assert.ok(g.includes("!p.isShared") && g.includes("isShowDoc(p)") && g.includes("turnFilmIsBlank(p)"));
  assert.ok(g.includes("await switchProject(recentFilm.id);"));
  assert.ok(g.includes('if(!recentFilm){ setHomeOpen(false); setRoom("writers"); setView("spine"); startNewStory(); return; }'));
  assert.ok(g.includes('if(rid==="writers") setView("spine"); guardedSetRoom(rid);'));
});
await test("C2 'Back to <film>' replaces 'Open Project' and shows only when a film is open", ()=>{
  assert.ok(home.includes('current && h("button",{className:"hd-btn hd-btn-ghost", onClick:onClose}, "Back to "+(current.title||"Untitled film"))'));
  assert.ok(!home.replace(/\/\/[^\n]*/g, "").includes('"Open Project"'));
});

/* ═══ D ═══ */
await test("D1 every card opens from a real button (owned and shared), above the art, with a focus ring", ()=>{
  assert.ok(home.includes('h("button",{className:"hd-card-open",type:"button","aria-label":"Open "+(p.title||"Untitled film"),'));
  assert.ok(home.includes('"aria-label":"Open "+(p.title||"Untitled film")+", shared with you as "+roleLabel(p.shareRole)'));
  assert.ok(!/className:"hd-card[^"]*",\s*role:"button"/.test(home));
  assert.ok(/\.hd-card-open\{[^}]*position:absolute[^}]*inset:0/.test(css) && css.includes(".hd-card-open:focus-visible{"));
});
await test("D2 the stepper names each step and marks the current one", ()=>{
  assert.ok(home.includes('"aria-current":st.id===activeRoom ? "step" : undefined'));
  assert.ok(/"aria-label":[^\n]*coming soon/.test(between(home, "const STEPS", "const FEATURES")+between(home, "aria-current", "\n")) || home.includes("coming soon"));
});
await test("D3 the poster viewer is a modal dialog that takes focus", ()=>{
  const v = between(home, "const posterViewer = viewer && h(", "\n    ");
  assert.ok(v.includes('role:"dialog","aria-modal":"true"'));
  assert.ok(/ref:[^\n]*focus\(\)/.test(between(home, "const posterViewer", "lb-dl")));
});

/* ═══ E ═══ */
await test("E1 the feature strip states the reference limit honestly", ()=>{
  assert.ok(home.includes("up to 50 references steer each render (the limit follows the video model)"));
});
await test("E2 Frances knows the pass; keys", ()=>{
  const a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("let _museFactsMemo = null;");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(ai.slice(a, b)+";this.__F=APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>/^Home/.test(f.name))||{}).what || "";
  for(const gone of ["generated AUTOMATICALLY", "owner@email", "a format pill", "up to five of your films", "auto-paint", "automatic posters", "retries on the next visit"])
    assert.ok(!w.includes(gone), gone);
  for(const now of ["PAINTED WHEN YOU SAY SO", "'Not now' (remembered on this device)", "asks first with its price", "never their email", "never create a blank film", "'Back to ‹film›'", "a phase pill"])
    assert.ok(w.includes(now), now);
  for(const f of ["home-dashboard.jsx", "app.jsx", "ai.jsx", "script.jsx"])
    assert.ok(["20261009-home3", "20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18"].some(k=>html.includes('src="app/'+f+'?v='+k+'"')), f);   // (later passes re-key some)
  assert.ok(["20261009-home3", "20261009-teamrv1", "20261009-bd4", "20261009-stageed1", "20261009-sb4", "20261010-pose2", "20261010-voice1", "20261010-del1", "20261010-pron1", "20261010-like1", "20261010-nb21", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18"].some(k=>html.includes('href="app/styles.css?v='+k+'"')));
});

console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);
