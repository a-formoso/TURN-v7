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
  ["stylebible.jsx","stylebible-ui.jsx","stage.jsx"].forEach(f=>assert.ok(["20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f));
});
console.log(pass+" passed, 0 failed");
