#!/usr/bin/env node
/* test-cast-pronouns.mjs — Design the cast and characters without pronouns (owner 2026-10-10: every sheet failed with
   "has an unresolved character identity", after a paid writing call, and the run said "Cast designed").
     A turnIdentityBlock: null when pronouns are set; "unset" with the screenplay's pronouns as the suggestion
     B the preview names them with a one-click fix and leaves them out of the run
     C the Casting Director skips them before drafting anything, and says plainly what wasn't made
   node scripts/test-cast-pronouns.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, f)=>{ try{ await f(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const art = read("app/artroom.jsx"), agents = read("app/agents.jsx"), app = read("app/app.jsx"), html = read("TURN.html");

await test("A the block: set pronouns pass; none set → 'unset' with what the screenplay says", ()=>{
  const box = { console }; box.window = box; vm.createContext(box);
  vm.runInContext(read("app/character-identity.js"), box);
  vm.runInContext(between(art, "function turnIdentityBlock(c, cast){", "\nwindow.turnIdentityBlock")+";this.f=turnIdentityBlock;", box);
  // the screenplay's own introduction of the character is the only evidence (a name never is)
  box.turnIdentityContext = { scenes:[{ id:"s1", no:1 }], drafts:{ s1:{ blocks:[{ type:"action", text:"LUCA FIORIN (60s), a man worn by the sea, wipes the counter." }] } } };
  const luca = { id:"luca", name:"LUCA FIORIN", role:"lead" };
  const b = box.f(luca, [luca]);
  assert.deepEqual({ kind:b.kind, suggest:b.suggest }, { kind:"unset", suggest:"he/him" });
  assert.equal(box.f({ ...luca, pronouns:"he/him" }, [luca]), null, "set → fine");
  box.turnIdentityContext = { scenes:[{ id:"s1", no:1 }], drafts:{ s1:{ blocks:[{ type:"action", text:"LUCA FIORIN wipes the counter." }] } } };
  assert.equal(box.f(luca, [luca]).suggest, "", "no introduction → no suggestion (you choose)");
});
await test("B the preview: named with a fix, left out of the run, the button counts who runs", ()=>{
  const cc = between(art, "function CastConfirm(", "window.CastConfirm = CastConfirm;");
  assert.ok(cc.includes("const blocked = planChars.map(c=>({ c, b:turnIdentityBlock(c, C) })).filter(x=>x.b);"));
  assert.ok(cc.includes("const runIds = plan.ids.filter(id=>!blockedIds.has(id));"));
  assert.ok(cc.includes('"Use "+b.suggest+" (from the screenplay)"') && cc.includes('"Use the screenplay\'s pronouns for all "+suggestable.length'));
  assert.ok(cc.includes("onConfirm({ only: (scope===\"all\" && !blocked.length) ? null : runIds, variants:withVariants, fidelity:checking })"));   // + the optional Script check (2026-10-12)
  assert.ok(cc.includes('disabled:nothing || !runIds.length,') && cc.includes('"Design "+runIds.length+" character"'));
  assert.ok(app.includes('onSetPronouns:(id,p)=>updateCharacter(id,{ pronouns:p, pronounProvenance:"user",'));
});
await test("C the run: skipped before any spending; the summary says what wasn't made", ()=>{
  const run = between(agents, "  const needPronouns = [], failedSheets = [];", "/* =========================================================");
  const skip = run.indexOf("const b = window.turnIdentityBlock(c, cast.list);");
  assert.ok(skip>0 && skip < run.indexOf("cast.draftSpec(c)") && skip < run.indexOf("cast.suggestStates(c)"), "checked before drafting");
  assert.ok(run.includes("needs pronouns before a sheet can be made") && run.includes("still need"));
  assert.ok(run.includes('nothingMade ? "Finished \\u2014 nothing was made. See the notes above."'));
});
await test("D keys", ()=>{
  const ai = read("app/ai.jsx"), a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("let _museFactsMemo = null;");
  const fb = { console }; fb.window = fb; vm.createContext(fb); vm.runInContext(ai.slice(a, b)+";this.__F=APP_FEATURES;", fb);
  assert.ok(fb.__F.find(f=>f.name==="Character Sheets (Art Room)").what.includes("Use the screenplay's pronouns for all"), "Frances");
  for(const f of ["artroom", "app", "agents", "ai", "script"]) assert.ok(["20261010-pron1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69"].some(k=>html.includes('src="app/'+f+'.jsx?v='+k+'"')), f);   // (later passes re-key some)
  assert.ok(["20261010-pron1", "20261010-voice1", "20261010-pose2", "20261010-del1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69"].some(k=>html.includes('href="app/styles.css?v='+k+'"')));
});
console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);
