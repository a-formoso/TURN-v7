#!/usr/bin/env node
/* ONE QA CHECK (owner 2026-10-27: "go ahead" — Script check folded into QA check): a character sheet's QA check reads
   the image against its own prompt AND against what the screenplay states about the character, in ONE image read.
   - aiImageQA with facts asks both in one call and parses the "script" answer (the Script check's rules and parser);
     without facts it's the plain QA check (script:null);
   - the report's "Against the screenplay" part: each mismatch with its quote, Apply to spec where the spec is wrong,
     Regenerate one render later; a note when the script hasn't been read; a retry note when the part didn't come back;
   - the cards: no Script check button; the sheet and each variant pass the character to the QA check.
   Run AFTER `npm run build`:   node scripts/test-qa-screenplay.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read = (f)=>readFileSync(new URL("../"+f, import.meta.url), "utf8");
const art = read("app/artroom.jsx"), ai = read("app/ai.jsx");
let pass = 0;
const t = async (name, fn)=>{ try{ await fn(); pass++; console.log("PASS "+name); }catch(e){ console.log("FAIL "+name+"\n    "+String(e && e.stack || e).split("\n").slice(0,6).join("\n    ")); process.exit(1); } };
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };

/* aiImageQA in a box */
const box = { console, JSON, Object, Array, String, Number, Math, Promise, RegExp, Error }; box.window = box; vm.createContext(box);
let sent = null, answer = null;
Object.assign(box, { turnDownscaleDataUrl:async ()=>"data:image/jpeg;base64,AAA", scrubBrand:(s)=>String(s||""), clipWords:(s,n)=>String(s||"").slice(0,n),
  extractJSON:(x)=>JSON.parse(x), aiVisionComplete:async (messages, images)=>{ sent = { prompt:messages[0].content, images }; return { vision:true, text:JSON.stringify(answer) }; } });
vm.runInContext(between(ai, "function _fidelityFactLines(facts){", "window.aiImageQA = aiImageQA;")+"\nwindow.aiImageQA = aiImageQA;", box);
const facts = [{ field:"build", value:"wiry", quote:"wiry", sceneNo:1 }, { field:"marks", value:"scar on the left cheek", quote:"A scar runs down his left cheek.", sceneNo:2 }];

await t("with the screenplay's facts: one read asks both, and the answer has both parts", async ()=>{
  answer = { verdict:"pass", deviations:[], inventions:[], action:"keep", editInstruction:"", promptFix:"",
    script:{ results:[{ n:1, status:"ok" }, { n:2, status:"mismatch", issue:"the scar is on his right cheek", specOk:true }] } };
  const r = await box.aiImageQA({ kind:"character sheet", name:"Ottavio", url:"https://x/s.png", prompt:"PROMPT", facts, spec:{ features:"scar" } });
  assert.equal(sent.images.length, 1);
  assert.match(sent.prompt, /GENERATION PROMPT:\nPROMPT/);
  assert.match(sent.prompt, /SECOND, SEPARATELY: the SCREENPLAY/);
  assert.match(sent.prompt, /2\. marks: scar on the left cheek — Sc 2: "A scar runs down his left cheek\."/);
  assert.match(sent.prompt, /Sides are the CHARACTER'S own left and right/);
  assert.match(sent.prompt, /"script":\{"results":\[/);
  assert.equal(r.verdict, "pass");
  assert.equal(r.script.checked, 2); assert.equal(r.script.ok, 1);
  assert.equal(r.script.mismatches.length, 1); assert.equal(r.script.mismatches[0].fact.field, "marks"); assert.equal(r.script.mismatches[0].specOk, true);
});
await t("no screenplay answer → the part says it didn't come back; no facts → the plain QA check", async ()=>{
  answer = { verdict:"minor", deviations:["a ring"], inventions:[], action:"keep" };
  let r = await box.aiImageQA({ kind:"character sheet", url:"https://x/s.png", prompt:"P", facts });
  assert.deepEqual(JSON.parse(JSON.stringify(r.script)), { failed:true, checked:2 });
  r = await box.aiImageQA({ kind:"prop sheet", url:"https://x/s.png", prompt:"P" });
  assert.equal(r.script, null);
  assert.ok(!/SCREENPLAY/.test(sent.prompt) && !/"script"/.test(sent.prompt));
});
await t("the Script check uses the same rules and parser", ()=>{
  const sc = between(ai, "async function aiCharacterFidelityCheck(item){", "window.aiCharacterFidelityCheck = aiCharacterFidelityCheck;");
  assert.ok(sc.includes("FIDELITY_RULES+") && sc.includes("_fidelityFactLines(facts)") && sc.includes("return _fidelityParse(j.results, facts, W);"));
});
await t("the report's screenplay part: quotes, Apply to spec, Regenerate, the not-read note, the retry note", ()=>{
  const part = between(art, "function QaScriptPart(", "function QaReport(");
  assert.ok(part.includes('"Against the screenplay \\u00b7 "+(script.checked||0)+" fact"'));
  assert.ok(part.includes('"The script says \\u201c"+String(m.fact.quote||"")'));
  assert.ok(part.includes('applied[i] ? "Applied to spec" : "Apply to spec"') && part.includes("charFidelityFixPatch(curRef.current, m.fact.field, value)"));
  assert.ok(part.includes("The screenplay part didn't come back this time. Run the QA check again to see it."));
  assert.ok(part.includes('onClick:()=>{ onRegen(); onClose(); }},') && part.includes('"Regenerate"'));
  const btn = between(art, "function QaCheckButton(", "window.QaCheckButton = QaCheckButton;");
  assert.ok(btn.includes('"Not checked: the script hasn\'t been read for "+(c.name||"this character")+" yet."'));
  assert.ok(btn.includes("...(sf.facts.length ? { facts:sf.facts, spec:sf.spec, variant:(script&&script.variantLabel)||\"\""));
  assert.ok(btn.includes("onRegen:()=>setPendingRegen(true) })"), "regenerate one render later, from the applied spec");
  assert.ok(art.includes("scriptPart && React.createElement(QaScriptPart,{ ...scriptPart, script:r.script, gening, noun, regenCost, onRegen, onClose }),"));
});
await t("the cards: no Script check button; the sheet and each variant give the QA check the character", ()=>{
  assert.ok(!art.includes("React.createElement(ScriptCheckButton,{"));
  assert.ok(art.includes('script:{ c, drafts, onUpdate:readOnly ? null : onUpdate } })'));
  assert.ok(art.includes('script:{ c, drafts, sceneId:st.sceneId||"", variantLabel:(st.label||vtag) } })'));
});
await t("Frances knows", ()=>{
  assert.ok(ai.includes("there is no separate 'Script check' button on a character's card"));
  assert.ok(ai.includes("There is no separate Script check button on the cards any more."));
});
console.log(pass+" passed, 0 failed");
