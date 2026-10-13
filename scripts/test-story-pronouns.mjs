#!/usr/bin/env node
/* test-story-pronouns.mjs — a new story's characters come with their pronouns (owner 2026-10-11: "every new story can
   come with their characters' pronouns defined so that we don't end up with issues in the art room").
     A the cast step asks for pronouns and keeps only he/him · she/her · they/them
     B the build saves them on the cards as set by the story, and the scene writer uses them
     C the safety net: a character still unset takes the ONE set the finished screenplay uses — never over a card's
       own value, a conflict, a they/them-only screenplay or a Show's canon character — and anyone left is named
     D it runs after the continuity ledger, before the build's last line; the pipeline doc and Frances say so
   node scripts/test-story-pronouns.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, f)=>{ try{ await f(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const ai = read("app/ai.jsx"), agents = read("app/agents.jsx");
const identityBox = ()=>{ const box = { console }; box.window = box; vm.createContext(box); vm.runInContext(read("app/character-identity.js"), box); return box; };

await test("A the cast step asks for pronouns and keeps only the three accepted sets", async ()=>{
  const box = identityBox();
  let prompt = "";
  const reply = { premise:"What if a lighthouse keeper stopped lying?", cast:[
    { id:"maren", name:"MAREN DOYLE", role:"Protagonist — a lighthouse keeper", pronouns:"she/her" },
    { id:"tomas", name:"TOMAS ULLA", role:"Antagonist — a harbour master", pronouns:"He / Him" },
    { id:"ash", name:"ASH KOVAC", role:"Ally — a radio operator", pronouns:"they/them" },
    { id:"pell", name:"PELL", role:"Mirror — a ferryman", pronouns:"xe/xem" },
    { id:"ivo", name:"IVO", role:"Wildcard — a smuggler" } ] };
  Object.assign(box, { inventionRules:()=>"", aiAvailable:()=>true, clipAtBoundary:(s)=>s, clipWords:(s)=>String(s), scrubBrand:(s)=>String(s),
    extractJSON:(t)=>JSON.parse(t), claude:{ complete:async (o)=>{ prompt = o.messages[0].content; return JSON.stringify(reply); } } });
  vm.runInContext(between(ai, "async function aiBuildStoryWorld(", "\nwindow.aiBuildStoryWorld")+";this.f=aiBuildStoryWorld;", box);
  const w = await box.f("A keeper", { title:"LIGHT", scenes:[{ no:1, title:"Dusk", driver:"maren" }] }, "film", null);
  assert.match(prompt, /PRONOUNS — give every cast member their pronouns, consistent with their IDENTITY: "he\/him" or "she\/her"; "they\/them" ONLY for a character the story itself makes non-binary\./);
  assert.match(prompt, /"cast":\[\{"id":"\.\.\.","name":"\.\.\.","role":"\.\.\.","pronouns":"he\/him","age":"early 30s","voice"/);   // (2026-10-12) the cast step also asks for an age range
  assert.doesNotMatch(prompt, /real subject's pronouns/);
  assert.deepEqual(w.cast.map(c=>c.pronouns||""), ["she/her", "he/him", "they/them", "", ""], "normalised; an unknown or missing value is left unset");
  await box.f("A portrait", { title:"DOC", scenes:[] }, "documentary", null);
  assert.match(prompt, /\(a real subject's pronouns are the ones that person uses\)/);
});

await test("B the build saves them as set by the story; the scene writer uses them", ()=>{
  const map = between(agents, "  let cast = ((world && world.cast) || []).map((c,i)=>({", "  }));");
  assert.ok(map.includes('...(c.pronouns ? { pronouns:c.pronouns, pronounProvenance:"story", pronounSource:"story" } : {}),'));
  assert.ok(agents.includes('if(!prev.pronouns && c.pronouns){ prev.pronouns = c.pronouns; prev.pronounProvenance = "story"; prev.pronounSource = "story"; }'), "a merged duplicate keeps them");
  const box = { console }; box.window = box; vm.createContext(box);
  vm.runInContext(between(ai, "function charPronouns(c){", "\nwindow.charPronouns")+";this.f=charPronouns;", box);
  assert.equal(box.f({ name:"MAREN", role:"a man of the sea", pronouns:"she/her", pronounProvenance:"story" }), "she/her", "the story's value wins over a guess");
});

await test("C the safety net fills from the screenplay only when it's clear, and names who's left", ()=>{
  const box = identityBox();
  vm.runInContext(between(agents, "function fillPronounsFromScreenplay(ctx){", "\nwindow.fillPronounsFromScreenplay")+";this.f=fillPronounsFromScreenplay;", box);
  const action = (t)=>({ type:"action", text:t });
  const scenes = [{ id:"s1", no:1 }, { id:"s2", no:2 }];
  const drafts = { s1:{ blocks:[action("GRETA HOLM (70s), a woman with salt in her hair, mends a net."), action("JUNO RASK, a man in oilskins, watches."), action("ODA, a woman, hums.")] },
    s2:{ blocks:[action("ODA, a man, steps in."), action("WREN, they shrug."), action("BRAM walks.")] } };
  const characters = [
    { id:"maren", name:"MAREN DOYLE", pronouns:"she/her", pronounProvenance:"story" },   // already set
    { id:"greta", name:"GRETA HOLM", role:"Supporting" },                                  // clear → she/her
    { id:"juno", name:"JUNO RASK", role:"Supporting" },                                    // a Show's canon: untouched
    { id:"oda", name:"ODA", role:"Supporting" },                                           // two sets → unset
    { id:"wren", name:"WREN", role:"Supporting" },                                         // they only → unset
    { id:"bram", name:"BRAM", role:"Supporting" } ];                                       // nothing → unset
  const log = []; let syncs = 0;
  const ctx = { model:{ characters, scenes, drafts }, sync:()=>syncs++, emit:(e)=>log.push(e), castCanon:(c)=>c.id==="juno" };
  const r = box.f(ctx);
  const by = (id)=>ctx.model.characters.find(c=>c.id===id);
  assert.deepEqual([by("greta").pronouns, by("greta").pronounProvenance, by("greta").pronounSource], ["she/her", "story", "screenplay"]);
  assert.equal(by("maren").pronouns, "she/her"); assert.equal(by("maren").pronounSource, undefined, "a set card is left as it is");
  for(const id of ["juno", "oda", "wren", "bram"]) assert.equal(by(id).pronouns, undefined, id);
  assert.equal(syncs, 1); assert.equal(r.filled, 1);
  assert.deepEqual(log.map(e=>e.k+": "+e.t), [
    "ok: Pronouns set from the screenplay for GRETA HOLM (she/her).",
    "flag: 4 characters still need pronouns: JUNO RASK, ODA, WREN, BRAM — set them on their cards (the Cast panel) before designing them in the Art Room."]);
  // everyone set: nothing said, nothing saved
  const log2 = []; let syncs2 = 0;
  box.f({ model:{ characters:[{ id:"a", name:"A", pronouns:"he/him" }], scenes, drafts }, sync:()=>syncs2++, emit:(e)=>log2.push(e) });
  assert.deepEqual([log2.length, syncs2], [0, 0]);
});

await test("D where it runs; the pipeline doc and Frances", ()=>{
  const build = between(agents, "async function agentAdaptation(ctx){", "\nfunction fillPronounsFromScreenplay(ctx){");
  const ledger = build.indexOf("await buildContinuityLedgerStep(ctx);"), fill = build.indexOf("fillPronounsFromScreenplay(ctx);"), done = build.lastIndexOf('ctx.emit({k:"done"');
  assert.ok(ledger>0 && fill>ledger && done>fill, "after the ledger, before the build's last line");
  assert.match(read("docs/Story Pipeline.md"), /\*\*Cast pronouns\*\* \*\(approved 2026-10-11 by owner\)\*/);
  const a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("let _museFactsMemo = null;");
  const fb = { console }; fb.window = fb; vm.createContext(fb); vm.runInContext(ai.slice(a, b)+";this.__F=APP_FEATURES;", fb);
  assert.ok(fb.__F.find(f=>String(f.name||"").startsWith("New Story (format")).what.includes("PRONOUNS COME WITH THE CAST"));
  const html = read("TURN.html");
  for(const f of ["ai", "script", "agents"]) assert.ok(html.includes('src="app/'+f+'.jsx?v=20261011-pron2"') || html.includes('src="app/'+f+'.jsx?v=20261011-rv1"') || html.includes('src="app/'+f+'.jsx?v=20261011-v4a"') || html.includes('src="app/'+f+'.jsx?v=20261012-art1"') || html.includes('src="app/'+f+'.jsx?v=20261013-fact1"') || html.includes('src="app/'+f+'.jsx?v=20261013-arc1"') || html.includes('src="app/'+f+'.jsx?v=20261013-cdx1"') || html.includes('src="app/'+f+'.jsx?v=20261013-loc1"'), f);   // (later passes re-key some)
});

console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);
