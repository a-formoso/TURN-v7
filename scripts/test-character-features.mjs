#!/usr/bin/env node
/* ============================================================================
   CHARACTER FIDELITY, step 1 (owner-approved 2026-10-12): DISTINGUISHING FEATURES.
   The Production check's approved screenplay details (a forearm maintenance panel, a scar…) used to be appended to
   `coreBody` — which the sheet prompt ignores once a physique exists, and which a physique-row edit rebuilt away.
   Now they live in their own field, `scriptFeatures` (a sibling of `physique`):
     A  the helpers (artroom.jsx): the field, older films' details read from coreBody without migrating, the
        likeness rule (face / head / hair marks drop while a likeness gives the face; body marks stay)
     B  the sheet prompt always sends them (with or without a physique, with a likeness: body marks only)
     C  a physique-row edit, a re-draft and the QA check's "Apply to spec" never lose them; QA fixes land in a
        field the prompt reads
     D  variants, the simplified retry, a dropped photo, the scale sheet and shot frames carry them
     E  the Production check writes approved details to the field, never to coreBody
     F  the card row + note, Frances, the exports
   Run AFTER `npm run build`:   node scripts/test-character-features.mjs
   ============================================================================ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
let passes = 0, failures = 0;
const test = async (name, fn)=>{ try{ await fn(); passes++; console.log("PASS", name); }
  catch(e){ failures++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));

const art = read("app/artroom.jsx"), app = read("app/app.jsx"), agentsSrc = read("app/agents.jsx"), ai = read("app/ai.jsx"),
  imagegen = read("app/imagegen.jsx"), shots = read("app/shots.jsx"), breakdown = read("app/breakdown.jsx"), css = read("app/styles.css");

/* ---------------- the sandbox: dist/app/artroom.js ---------------- */
const noop = ()=>{};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
  React: { createElement:(type, props, ...children)=>({ type, props:props||{}, children }), useState:(v)=>[typeof v==="function"?v():v, noop],
    useEffect:noop, useRef:(v)=>({ current:v }), useMemo:(f)=>f(), useCallback:(f)=>f, Fragment:"Fragment" },
  localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
  CustomEvent: class { constructor(type, opts){ this.type = type; this.detail = opts && opts.detail; } },
  Image: class {},
  document:{ createElement:()=>({ getContext:()=>null, style:{}, setAttribute:noop, appendChild:noop }), getElementById:()=>null,
    addEventListener:noop, removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], body:{ appendChild:noop, removeChild:noop } },
  requestAnimationFrame:noop, cancelAnimationFrame:noop, addEventListener:noop, removeEventListener:noop, dispatchEvent:noop,
  matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read("dist/app/artroom.js"), sandbox, { filename:"dist/app/artroom.js" });
const W = sandbox;
for(const fn of ["charScriptFeatures","charScriptFeaturesRaw","charLegacyBodySplit","charBodyText","charBodyWithFeatures",
  "charFeaturesForRender","charFeaturesKeepClause","charFeaturesPatch","charPhysPatch","charQaSpecFields","charQaSpecPatch",
  "charPhysiqueSentences","charLikenessGivesFace","buildCharRefPrompt","turnLikenessVariantPrompt","buildSimpleCharPromptFor","buildRefFromPhotoPrompt"])
  if(typeof W[fn]!=="function"){ console.log("FAIL "+fn+" missing from dist/app/artroom.js — run npm run build"); process.exit(1); }
let cameo = null;   // the likeness the store reports for "kai"
W.nbCameoInfo = (id)=> (id==="kai" && cameo) ? cameo : null;
const USABLE = { locked:true, available:true, angleCount:3, capturedAt:"2026-10-05T10:00:00.000Z", mine:true };

const PHYS = { age:"early 30s", ethnicity:"Filipino", skin:"warm brown", eyes:"dark brown", hair:"cropped black", face:"square jaw",
  build:"compact, muscular", arms:"scarred knuckles", legs:"steel-toe boots" };
/* the coreBody the look drafter writes (ai.jsx mapBibleEntry) — the same labelled sentences */
const LABELLED = "Apparent age: early 30s. Ethnicity: Filipino. Skin tone: warm brown. Eye colour: dark brown. Hair: cropped black. "
  +"Face shape: square jaw. Body type: compact, muscular. Arms & hands: scarred knuckles. Legs & feet: steel-toe boots.";
/* an older film: the Production check appended two approved details after it */
const LEGACY = { id:"kai", name:"Kai Reyes", role:"Lead", renderStyleKey:"photoreal", physique:{ ...PHYS },
  coreBody:LABELLED+" Forearm maintenance panel. A thin scar through the left eyebrow.",
  wardrobeMask:"grey mechanic's coveralls", accessories:"a steel wristwatch" };
const NEW = { ...LEGACY, coreBody:LABELLED, scriptFeatures:"Forearm maintenance panel. A thin scar through the left eyebrow." };
const specOf = (prompt)=> JSON.parse(String(prompt).slice(String(prompt).indexOf("{")));

/* ═══ A — the helpers ═══ */
await test("A1 the labelled sentences match the look drafter's coreBody", ()=>{
  assert.equal(W.charPhysiqueSentences(PHYS), LABELLED);
  // the drafter's own composition, read from ai.jsx (same labels, same order)
  for(const lab of ["Apparent age: ","Ethnicity: ","Skin tone: ","Eye colour: ","Hair: ","Face shape: ","Body type: ","Arms & hands: ","Legs & feet: "])
    assert.ok(ai.includes('("'+lab+'"+F.'), "drafter label "+lab);
});
await test("A2 the field wins; an older film's appended details are read from coreBody — nothing is migrated", ()=>{
  assert.equal(W.charScriptFeatures(NEW), "Forearm maintenance panel. A thin scar through the left eyebrow.");
  const before = J(LEGACY);
  assert.equal(W.charScriptFeaturesRaw(LEGACY), "Forearm maintenance panel. A thin scar through the left eyebrow.");
  assert.equal(W.charScriptFeatures(LEGACY), "Forearm maintenance panel. A thin scar through the left eyebrow.");
  assert.equal(W.charBodyText(LEGACY), LABELLED, "the body without the appended copy");
  assert.deepEqual(J(LEGACY), before, "reading never rewrites the saved card");
  // a cleared field stays cleared (the writer removed the legacy details)
  assert.equal(W.charScriptFeatures({ ...LEGACY, scriptFeatures:"" }), "");
  assert.equal(W.charBodyText({ ...LEGACY, scriptFeatures:"" }), LABELLED);
});
await test("A3 legacy detection is careful: a hand-typed Body, labelled sentences, a coreBody written slightly differently", ()=>{
  // no physique: the Body is the description, sent whole — nothing is split off
  const typed = { id:"x", name:"X", coreBody:"Tall and wiry. A burn scar up the left arm." };
  assert.equal(W.charScriptFeatures(typed), ""); assert.equal(W.charBodyText(typed), typed.coreBody);
  // only labelled sentences after the physique: not features
  const lab = { id:"y", name:"Y", physique:{ age:"mid 40s", build:"stooped and thick" }, coreBody:"Apparent age: mid 40s. Build: stooped and thick." };
  assert.equal(W.charScriptFeatures(lab), "");
  assert.equal(W.charLegacyBodySplit(lab).base, lab.coreBody);
  // a coreBody that doesn't start with the exact sentences: everything after the last labelled one found
  const odd = { id:"z", name:"Z", physique:{ age:"20s", build:"lean" }, coreBody:"Apparent age: 20s. Body type: lean.  Missing ring finger on the right hand." };
  assert.equal(W.charScriptFeatures(odd), "Missing ring finger on the right hand.");
  // a physique-matching body with nothing appended
  assert.equal(W.charScriptFeatures({ ...LEGACY, coreBody:LABELLED }), "");
});
await test("A4 the likeness rule: face / head / hair marks drop, body marks stay", ()=>{
  const c = { ...NEW, scriptFeatures:"Forearm maintenance panel; a thin scar through the left eyebrow; a tattoo of a koi on the neck; a shaved head; burn scars across the back" };
  assert.equal(W.charScriptFeatures(c, { likeness:true }), "Forearm maintenance panel. a tattoo of a koi on the neck. burn scars across the back.");
  assert.equal(W.charScriptFeatures(c).split(". ").length, 5, "without a likeness every feature is sent");
  cameo = null; assert.equal(W.charLikenessGivesFace(c), false);
  cameo = { ...USABLE }; assert.equal(W.charLikenessGivesFace(c), true);
  assert.ok(!/eyebrow/.test(W.charFeaturesForRender(c)) && /koi/.test(W.charFeaturesForRender(c)));
  cameo = { ...USABLE, available:false, why:"someone else's" };   // can't be used here → the text spec carries the face
  assert.equal(W.charLikenessGivesFace(c), false); assert.match(W.charFeaturesForRender(c), /eyebrow/);
  cameo = null;
});

/* ═══ B — the sheet prompt ═══ */
await test("B1 with a physique the features are ALWAYS sent (they used to be dropped with coreBody)", ()=>{
  for(const c of [NEW, LEGACY]){
    const s = specOf(W.buildCharRefPrompt(c, {}, []));
    assert.equal(s.character.distinguishing_features, "Forearm maintenance panel. A thin scar through the left eyebrow");
    assert.ok(s.character.physique && !s.character.description, "the physique is the description");
    assert.match(s.continuity.distinguishing_features_rule, /every distinguishing feature/);
  }
  const none = specOf(W.buildCharRefPrompt({ ...LEGACY, coreBody:LABELLED }, {}, []));
  assert.equal(none.character.distinguishing_features, undefined); assert.equal(none.continuity.distinguishing_features_rule, undefined);
});
await test("B2 without a physique: the Body is the description and the features ride beside it", ()=>{
  const c = { id:"h", name:"Hal", coreBody:"Tall and wiry.", scriptFeatures:"A hook for a left hand.", wardrobeMask:"coat" };
  const s = specOf(W.buildCharRefPrompt(c, {}, []));
  assert.equal(s.character.description, "Tall and wiry"); assert.equal(s.character.distinguishing_features, "A hook for a left hand");
  // a hand-held aid in the features is put in hand (the cane rule reads them too)
  const cane = specOf(W.buildCharRefPrompt({ ...c, scriptFeatures:"Walks with a cane." }, {}, []));
  assert.match(cane.wardrobe.hands, /cane/);
});
await test("B3 a locked likeness: face fields AND face marks left out; body marks still sent", ()=>{
  const p = W.buildCharRefPrompt(NEW, {}, [], { likeness:true });
  const s = specOf(p);
  assert.equal(s.character.distinguishing_features, "Forearm maintenance panel");
  assert.ok(!/eyebrow|Filipino|cropped black|square jaw/.test(p), "no written face");
  // the legacy film, the same
  assert.equal(specOf(W.buildCharRefPrompt(LEGACY, {}, [], { likeness:true })).character.distinguishing_features, "Forearm maintenance panel");
});

/* ═══ C — never lost ═══ */
await test("C1 editing a physique row keeps them: an older card's appended details move to the field", ()=>{
  const p = W.charPhysPatch(LEGACY, "build", "wiry");
  assert.equal(p.physique.build, "wiry");
  assert.ok(!/maintenance/.test(p.coreBody), "coreBody is the labelled physique, as before");
  assert.equal(p.scriptFeatures, "Forearm maintenance panel. A thin scar through the left eyebrow.");
  const after = { ...LEGACY, ...p };
  assert.equal(W.charScriptFeatures(after), "Forearm maintenance panel. A thin scar through the left eyebrow.");
  // a card with the field: the field isn't touched
  const p2 = W.charPhysPatch(NEW, "hair", "buzzed");
  assert.equal(p2.scriptFeatures, undefined);
  assert.equal(W.charScriptFeatures({ ...NEW, ...p2 }), W.charScriptFeatures(NEW));
  // the card uses it
  assert.ok(art.includes("const setPhys=(k,val)=>{ const pp=charPhysPatch(c,k,val);"));
});
await test("C2 saving the row: the field, and an older card's appended copy leaves coreBody (the writer's own edit)", ()=>{
  const p = W.charFeaturesPatch(LEGACY, "Forearm maintenance panel.");
  assert.deepEqual(J(p), { scriptFeatures:"Forearm maintenance panel.", coreBody:LABELLED });
  assert.deepEqual(J(W.charFeaturesPatch(NEW, "  A limp.  ")), { scriptFeatures:"A limp." });
});
await test("C3 a re-draft ('Draft details') carries an older card's details into the field; the draft never sets it", ()=>{
  assert.ok(app.includes('const _legacyFeats = (res && typeof ch.scriptFeatures!=="string" && typeof window.charLegacyBodySplit==="function")'));
  assert.ok(app.includes("updateCharacter(ch.id, _legacyFeats ? { ...res, scriptFeatures:_legacyFeats } : res);"));
  const mapStart = ai.indexOf("function mapBibleEntry("), mapEnd = ai.indexOf("\n}\n", mapStart);
  assert.ok(mapStart>0 && !/scriptFeatures/.test(ai.slice(mapStart, mapEnd)), "the look drafter never writes the field");
});
await test("C4 QA 'Apply to spec' offers the fields the prompt reads and writes each fix there", ()=>{
  const f = W.charQaSpecFields(LEGACY);
  assert.deepEqual(Object.keys(f), ["apparent_age","ethnicity","skin","eyes","hair","face","build","arms_hands","legs_feet",
    "distinguishing_features","wardrobe","accessories"]);
  assert.equal(f.distinguishing_features, "Forearm maintenance panel. A thin scar through the left eyebrow.");
  assert.ok(!("body" in f), "no coreBody once a physique exists");
  // with a likeness only the body rows
  assert.deepEqual(Object.keys(W.charQaSpecFields(NEW, { likeness:true })), ["build","arms_hands","legs_feet","distinguishing_features","wardrobe","accessories"]);
  // a body fix → the physique row (+ its labelled coreBody); the legacy details move to the field, not lost
  const up = W.charQaSpecPatch(LEGACY, { build:"compact, muscular, a slight stoop" });
  assert.equal(up.physique.build, "compact, muscular, a slight stoop");
  assert.match(up.coreBody, /Body type: compact, muscular, a slight stoop\./);
  assert.equal(up.scriptFeatures, "Forearm maintenance panel. A thin scar through the left eyebrow.");
  // a feature fix → the field
  const up2 = W.charQaSpecPatch(NEW, { distinguishing_features:"Forearm maintenance panel on the RIGHT forearm." });
  assert.deepEqual(J(up2), { scriptFeatures:"Forearm maintenance panel on the RIGHT forearm." });
  const sent = specOf(W.buildCharRefPrompt({ ...NEW, ...up2 }, {}, []));
  assert.equal(sent.character.distinguishing_features, "Forearm maintenance panel on the RIGHT forearm");
  // no physique: the Body is what's sent, so a body fix goes there
  const typed = { id:"t", name:"T", coreBody:"Tall.", wardrobeMask:"coat" };
  assert.deepEqual(Object.keys(W.charQaSpecFields(typed)), ["body","distinguishing_features","wardrobe","accessories"]);
  assert.deepEqual(J(W.charQaSpecPatch(typed, { body:"Tall, stooped.", wardrobe:"long coat" })), { coreBody:"Tall, stooped.", wardrobeMask:"long coat" });
  // the card uses them
  assert.ok(art.includes("specFields:()=> charQaSpecFields(c, { likeness:charLikenessGivesFace(c) }),"));
  assert.ok(art.includes("onApplySpec:(patch)=>{ const up = charQaSpecPatch(c, patch);"));
  assert.ok(!art.includes("if(patch.body!=null) up.coreBody=patch.body;"), "the old coreBody-only write is gone");
});

/* ═══ D — every render that describes the look ═══ */
await test("D1 appearance variants: from the master they keep the features; the full-spec path includes them", ()=>{
  cameo = null;
  assert.match(W.charFeaturesKeepClause(NEW), /^ Keep every distinguishing feature exactly as on the master, in every view where that part of the body shows: Forearm maintenance panel\. A thin scar through the left eyebrow\.$/);
  assert.equal(W.charFeaturesKeepClause({ ...NEW, scriptFeatures:"" }), "");
  // the card's edit-from-the-master variant
  assert.ok(art.includes("+\"Maintain the reference sheet's EXISTING layout, panel arrangement, render style and framing. Do not re-imagine the character.\"\n    +charFeaturesKeepClause(c);"));
  // with a likeness, from the master: body marks only
  const v = W.turnLikenessVariantPrompt(NEW, { label:"Bloodied", change:"a cut lip" }, {}, [], { likeness:true, masterImage:4, faceImages:"images 1–3" });
  assert.match(v, /distinguishing feature[^]*Forearm maintenance panel/); assert.ok(!/eyebrow/.test(v));
  // no master yet: the full face-free spec carries them
  const v0 = W.turnLikenessVariantPrompt(NEW, { label:"Bloodied", change:"a cut lip" }, {}, [], { likeness:true, masterImage:0, faceImages:"images 1–3" });
  assert.equal(specOf(v0.split(" APPEARANCE STATE")[0].split("\n\nCANONICAL")[0]).character.distinguishing_features, "Forearm maintenance panel");
  // the Casting Director's variants use combinedImagePrompt / turnLikenessSheetRequest — both built on the sheet spec
  assert.ok(app.includes("const base = (typeof combinedImagePrompt===\"function\") ? combinedImagePrompt(c, project, props) : \"\";"));
});
await test("D2 the simplified retry (likeness), a dropped photo and the plain retry carry them", ()=>{
  const r = W.buildSimpleCharPromptFor(NEW, { likeness:true });
  assert.match(r, /distinguishing features: Forearm maintenance panel/); assert.ok(!/eyebrow/.test(r));
  const ph = W.buildRefFromPhotoPrompt(NEW, {});
  assert.match(ph, /Distinguishing features \(from the script\)[^.]*: Forearm maintenance panel\./); assert.ok(!/eyebrow/.test(ph));
  assert.equal(W.charBodyWithFeatures(LEGACY), LABELLED.replace(/\.$/,"")+". distinguishing features: Forearm maintenance panel. A thin scar through the left eyebrow");
  assert.ok(imagegen.includes('window.charBodyWithFeatures(c) : ((c.coreBody||c.look)||"")'), "imagegen's buildSimpleCharPrompt");
});
await test("D3 the scale sheet and shot frames: the sheet label names the features (face marks drop with a likeness)", ()=>{
  assert.ok(shots.includes("window.charBodyWithFeatures(c, { likeness:(typeof window.charLikenessGivesFace===\"function\") && window.charLikenessGivesFace(c) })"));
  assert.ok(shots.includes("+(feats ? (\"; keep their distinguishing features wherever that part of the body is visible: \"+feats) : \"\")"));
  assert.ok(shots.includes("String(window.charFeaturesForRender(c)||\"\")"));
});

/* ═══ E — the Production check ═══ */
await test("E1 approved script details go to the field — coreBody is untouched; an older film's details are kept", async ()=>{
  const box = { console, setTimeout, clearTimeout }; box.window = box; vm.createContext(box);
  for(const f of ["app/frameworks.jsx","app/scene-order.js","app/agents.jsx","app/beat-keyframe-merge.js"]) vm.runInContext(read(f), box, { filename:f });
  box.charScriptFeaturesRaw = W.charScriptFeaturesRaw;
  box.turnProject = { framework:"threeact" };
  box.charPronouns = c=>String(c.pronouns||""); box.scaleClassOf = ()=>"A";
  box.turnIdentityReport = ()=>({ status:"ok", issues:[] });
  box.screenplayPronounEvidence = ()=>({ pronouns:"he/him", quote:"Kai wipes his hands." });
  box.realignBlockBeats = (bs)=>bs; box.findImpliedSpaces = ()=>[]; box.beatContinuityLint = ()=>[];
  box.aiScriptBreakdown = async ()=>({ characters:[{ name:"Kai Reyes", gender_used:"unclear", scale_used:"unclear", emotion:"",
    features:["forearm maintenance panel","a missing left ring finger"], states:[], voice_cues:[] }] });
  const run = async (ch)=>{
    const model = { characters:[{ ...ch, pronouns:"he/him" }], scenes:[{ id:"s1", no:1, act:1, title:"Garage", loc:"INT. GARAGE - DAY", driver:"kai" }],
      drafts:{ s1:{ blocks:[{ type:"scene", beat:1, text:"INT. GARAGE - DAY" },{ type:"action", beat:1, text:"Kai Reyes wipes his hands. He opens the panel on his forearm." }] } },
      beats:{ s1:{ rows:[{ id:"b1", n:1, drive:{ a:"opens" }, react:{ a:"" } }] } } };
    const cards = [];
    const ctx = { model, bible:{ props:[], locations:[], shots:[], patchProp:()=>{}, patchLocation:()=>{} }, emit:()=>{}, cancelled:()=>false,
      sync:()=>{}, ai:{ available:true }, propose:async (c)=>{ cards.push(c); return true; } };
    await box.agentProductionCheck(ctx);
    return { model, cards:cards.filter(c=>/^Add to /.test(c.title)) };
  };
  // a new card: the features already hold the panel → only the new detail is proposed, and it lands in the field
  const a = await run(NEW);
  assert.deepEqual(a.cards.map(c=>c.after), ["a missing left ring finger"]);
  assert.match(a.cards[0].rationale, /distinguishing features so every sheet, appearance variant and shot includes it/);
  assert.equal(a.cards[0].before, "Forearm maintenance panel. A thin scar through the left eyebrow.");
  assert.equal(a.model.characters[0].coreBody, LABELLED, "coreBody untouched");
  assert.equal(a.model.characters[0].scriptFeatures, "Forearm maintenance panel. A thin scar through the left eyebrow. a missing left ring finger.");
  // an older film: its appended details are carried into the field with the new one, coreBody untouched
  const b = await run(LEGACY);
  assert.equal(b.model.characters[0].coreBody, LEGACY.coreBody);
  assert.equal(b.model.characters[0].scriptFeatures, "Forearm maintenance panel. A thin scar through the left eyebrow. a missing left ring finger.");
  // a card with nothing yet
  const c = await run({ ...NEW, scriptFeatures:undefined, coreBody:LABELLED });
  assert.equal(c.cards.length, 2); assert.equal(c.cards[0].before, "(no distinguishing features yet)");
  assert.equal(c.model.characters[0].scriptFeatures, "forearm maintenance panel. a missing left ring finger.");
  // the sheet prompt now sends what was approved
  assert.match(specOf(W.buildCharRefPrompt(c.model.characters[0], {}, [])).character.distinguishing_features, /maintenance panel\. a missing left ring finger$/);
  assert.ok(!/coreBody:\(cb\+\(cb\?" ":""\)\+f/.test(agentsSrc), "the old coreBody append is gone");
});

/* ═══ F — the card, Frances, the exports ═══ */
await test("F1 the card shows its own editable row with a note, in both the physique list and the plain Body view", ()=>{
  assert.ok(art.includes('React.createElement("span",{className:"phys-lab"},"Distinguishing features")'));
  assert.ok(art.includes("React.createElement(EditText,{value:charScriptFeaturesRaw(c)||\"\",multiline:true,"));
  assert.ok(art.includes("onCommit:val=>onUpdate(c.id, charFeaturesPatch(c, val))"));
  assert.ok(art.includes("\"From the screenplay — added when you approve a Production check or a sheet check, or typed here. Sent with every sheet, appearance variant and shot.\""));
  assert.ok(art.includes("\" While a likeness is locked, marks on the face, head or hair are left out — the face comes from the likeness photos.\""));
  assert.ok(art.includes("Row(\"Legs & feet\",F.legs,v2=>setPhys(\"legs\",v2),true),\n            featuresRow,"));
  assert.ok(art.includes("React.createElement(\"div\",{className:\"char-phys\"}, featuresRow));"));
  assert.ok(/\.phys-features\{/.test(css) && /\.phys-note\{/.test(css));
});
await test("F2 Frances knows (a dated block before the public view)", ()=>{
  const i = ai.indexOf("CHARACTER FIDELITY, step 1 (owner 2026-10-12)"), j = ai.indexOf("/* the public view of every entry, memoised");
  assert.ok(i>0 && j>i, "the block sits just before the public view");
  const block = ai.slice(i, j);
  assert.match(block, /'Distinguishing features' row/);
  assert.match(block, /x\.name==="Character Sheets \(Art Room\)"/);
  assert.match(block, /x\.name==="Production check \(Art Room\)"/);
  assert.match(block, /x\.name==="QA check \(per-card image QC, Art Room\)"/);
  for(const n of ["Character Sheets (Art Room)","Production check (Art Room)","QA check (per-card image QC, Art Room)"])
    assert.ok(ai.includes('name:"'+n+'"'), "the entry exists: "+n);
  assert.ok(!/\bTURN\b|McKee|Anthropic|Claude/.test(block.replace(/\/\*[^]*?\*\//g,"")), "no internal or vendor names");
});
await test("F3 the art bible and the production bible list them", ()=>{
  assert.ok(breakdown.includes('+field("Distinguishing features", (typeof window.charScriptFeaturesRaw==="function") ? window.charScriptFeaturesRaw(c) : c.scriptFeatures)'));
  assert.ok(breakdown.includes('field("Body", (typeof window.charLegacyBodySplit==="function") ? window.charLegacyBodySplit(c).base : c.coreBody)'));
  assert.ok(app.includes('distinguishing_features: undef(typeof window.charScriptFeatures==="function" ? window.charScriptFeatures(c) : c.scriptFeatures),'));
});

console.log("\n"+passes+" passed, "+failures+" failed");
if(failures) process.exit(1);
