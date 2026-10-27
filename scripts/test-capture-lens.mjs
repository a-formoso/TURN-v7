#!/usr/bin/env node
/*
 * The lens conflict (2026-10-25, owner: "fix the lens conflict"): a clip prompt carried the film's Capture
 * ("Shot on 35mm with vintage anamorphic lenses, 2.39:1 …") AND the scene look's lens ("Spherical 35mm at T2.8")
 * in a 16:9 film. Capture is now the one lens source in clip prompts; a ratio that isn't the film's format is left
 * out of them; the Color tab says where Capture disagrees with the looks or the format.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const box={console}; box.window=box; vm.createContext(box);
vm.runInContext(readFileSync("app/formats.jsx","utf8"),box);
vm.runInContext(readFileSync("app/stylebible.jsx","utf8"),box);
const stage=readFileSync("app/stage.jsx","utf8"), ui=readFileSync("app/stylebible-ui.jsx","utf8");
const ai=readFileSync("app/ai.jsx","utf8"), html=readFileSync("TURN.html","utf8");
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,300)); process.exit(1); } pass++; console.log("PASS "+name); };
const look={id:"p1",name:"Manifest Sodium",grade:"hard contrast",lens:"Spherical 35mm at T2.8, clean geometry"};
const film=(capture,extra)=>({format:"short",styleBible:{capture,presets:[look],sceneStyles:{s1:"p1"}},...(extra||{})});

t("with a Capture, the look's lens is left out of clip prompts; without one it stays", ()=>{
  assert.ok(!/lens character/.test(box.turnVideoLookText(look, film("Shot on 35mm, fine grain."))));
  assert.ok(/lens character: Spherical 35mm at T2\.8/.test(box.turnVideoLookText(look, film(""))));
});
t("a ratio that isn't the film's format is left out of the prompt; the film's own ratio and other numbers stay", ()=>{
  assert.equal(box.turnCaptureForPrompt(film("Shot on 35mm with vintage anamorphic lenses, 2.39:1. Halation around practicals.")),
    "Shot on 35mm with vintage anamorphic lenses. Halation around practicals.");
  assert.equal(box.turnCaptureForPrompt(film("Spherical 35mm, 16:9, T2.8.")),"Spherical 35mm, 16:9, T2.8.");
  assert.equal(box.turnCaptureForPrompt(film("Handheld on a 4x4 rig, 1.78:1.")),"Handheld on a 4x4 rig, 1.78:1.");
  assert.equal(box.turnCaptureForPrompt(film("")),"");
});
t("the Color tab is told where Capture disagrees with the looks or the format", ()=>{
  const c=box.turnCaptureConflicts(film("Shot on 35mm with vintage anamorphic lenses, 2.39:1."));
  assert.equal(c.map(x=>x.kind).join(","),"lens,ratio");
  assert.ok(/Capture says anamorphic, but this film's looks say spherical/.test(c[0].text));
  assert.ok(/Capture names 2\.39:1, but this film is 16:9/.test(c[1].text));
  assert.equal(box.turnCaptureConflicts(film("Spherical 35mm, 16:9.")).length,0);
  assert.equal(box.turnCaptureConflicts(film("")).length,0);
});
t("the Stage reads the prompt version; the Color tab shows the conflicts; Frances knows", ()=>{
  assert.ok(stage.includes("const capture = (typeof turnCaptureForPrompt===\"function\") ? turnCaptureForPrompt(ctx.project)"));
  assert.ok(ui.includes('captureIssues.length>0 && React.createElement("div",{className:"sb-capture-warn",role:"status"},'));
  assert.ok(ai.includes("ONE LENS SOURCE (2026-10-25)"));
  ["stylebible.jsx","stylebible-ui.jsx","stage.jsx"].forEach(f=>assert.ok(["20261025-hs81", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f));
});
console.log(pass+" passed, 0 failed");
