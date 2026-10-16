#!/usr/bin/env node
/* A question asked during a run must never open behind the run's own progress card (2026-10-16, owner:
   "Redraft seems to be going on infinite loop"). The Shots tab's Re-draft put its busy card up, then asked
   "Re-draft Scene 01's keyframes?" — the confirm (z 9990) opened under the card (z 9996), so nothing could
   answer it and the card stayed up for ever.
   A. every confirm sits above the centered progress card;
   B. the scene re-draft asks first and only then shows its card, and a second click while it asks does nothing;
   C. no busy state that raises the progress card is set before a confirm in the same handler (unless the
      confirm is the run's own mid-run question, which A now keeps visible). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p)=> readFileSync(new URL("../"+p, import.meta.url), "utf8");
const css = read("app/styles.css"), app = read("app/app.jsx");
let n = 0; const check = (name, fn)=>{ fn(); n++; console.log("PASS "+name); };

const zOf = (sel)=>{ const m = new RegExp("\\n"+sel.replace(/[.]/g,"\\.")+"\\{[^}]*?z-index:(\\d+)").exec(css); assert.ok(m, sel); return Number(m[1]); };

check("A a confirm sits above the progress card", ()=>{
  assert.ok(zOf(".appconfirm-scrim") > zOf(".redraft-overlay"), "appconfirm "+zOf(".appconfirm-scrim")+" vs card "+zOf(".redraft-overlay"));
  assert.ok(zOf(".appconfirm-scrim") < 99999, "toasts stay on top");
});

check("B the scene re-draft asks first, then shows its card", ()=>{
  const a = app.indexOf("const draftSceneShots = async (scene)=>{"), b = app.indexOf("out = await draftOneSceneShots(scene, true);", a);
  assert.ok(a > 0 && b > a);
  const body = app.slice(a, b);
  const ask = body.indexOf("window.appConfirm({title:\"Re-draft Scene "), busy = body.indexOf("setDraftingSceneShots(scene.id)");
  assert.ok(ask > 0 && busy > ask, "the card goes up after the question");
  assert.ok(body.includes("if(draftingSceneShots || sceneShotsAskingRef.current) return;") && body.includes("sceneShotsAskingRef.current = true;")
    && body.includes("}finally{ sceneShotsAskingRef.current = false; }"), "a second click while it asks does nothing");
});

check("C no progress-card state is set before a confirm in its own handler", ()=>{
  // the states that raise StudioProgressOverlay (app.jsx studioProgress)
  const states = ["setDraftingSceneShots","setDraftingAllShots","setDeletingShotReference","setRefiningBeat",
    "setDraftingAllProps","setDraftingAllLocs","setDraftingAllVisuals"];
  const bad = [];
  for(const st of states){
    const re = new RegExp(st.replace(/[$]/g,"\\$")+"\\(([^)]{0,60})\\)", "g"); let m;
    while((m = re.exec(app))){
      const arg = m[1].trim();
      if(/^(null|false|0|undefined)$/.test(arg) || /=>/.test(arg)) continue;
      const tail = app.slice(m.index + m[0].length, m.index + 4000);
      const reset = new RegExp(st+"\\((null|false)\\)").exec(tail), conf = tail.indexOf("appConfirm");
      if(conf >= 0 && (!reset || conf < reset.index)) bad.push(st+"("+arg+") at line "+app.slice(0, m.index).split("\n").length);
    }
  }
  assert.deepEqual(bad, []);
});

console.log(`test-busy-card-confirm: ${n} checks passed`);
