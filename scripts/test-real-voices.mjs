#!/usr/bin/env node
/* test-real-voices.mjs — REAL VOICES, the app side (2026-10-11, owner — "every user can give a character their own
   voice or another person's"; approved design "go ahead with all of it"). Runs the REAL app sources in node:vm
   (app/voicegen.jsx, app/voices-ui.jsx through Babel, app/pricing.jsx) with a tiny hooks harness and a stubbed proxy:
     A voicegen: clone sends the consent / removeNoise / meName; delete + attach; the list with realVoices; the
       interviewer only ever picks a STOCK voice; the clone's price follows the credit unit
     B the server's own refusal sentences for every voice code (403 / 400 / 200), billing still first
     C consent: Me / Someone else + name, 18 or over, the attestation word for word (= the server's text)
     D the recordings: length / count / size rules (= the server's limits), the level check, the recorder format
     E the add window: consent → request shape, appended uploads, the noise toggle, Clone · price → the test line →
       "Try again" deletes the try (ticks asked again) / "Use this voice" locks it (source cloned) and links it
     F the Voice popup: the Real voice tab ("3 of 5 real voices", Add off with its reason at the limit), Clone mode
       hides the description, the Library groups, the likeness pairing offered first, Remove asks first
     G the Voices window: Delete asks, deletes for good, unlinks this film's characters (their lines go stale)
     H a pronoun change never forces a re-clone (voicegen + the Stage's line check)
     I the card says which face and which voice; roles that can't add a real voice don't get the button
     J Frances knows (APP_FEATURES), no vendor names in the copy, the cache keys
   node scripts/test-real-voices.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const require = createRequire(new URL("../package.json", import.meta.url));
const babel = require("@babel/core");
const compile = (f)=>babel.transformSync(read(f), { presets:[require.resolve("@babel/preset-react")], filename:f, babelrc:false, configFile:false }).code;
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a.slice(0,80)); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b.slice(0,80)); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, f)=>{ try{ await f(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const tick = ()=>new Promise(r=>setTimeout(r, 0));
const R = await import(new URL("../supabase/functions/image-proxy/voice-registry.mjs", import.meta.url).href);

/* ── a tiny hooks harness: renders ONE component function, runs its effects, re-renders on setState ── */
let CUR = null;
const React = {
  Fragment:"Fragment",
  createElement(type, props, ...children){ return { type, props:{ ...(props||{}), children:children.flat(Infinity) } }; },
  useState(init){ const h = CUR, i = h.idx++; if(!(i in h.hooks)) h.hooks[i] = { v: typeof init==="function" ? init() : init };
    const slot = h.hooks[i]; return [slot.v, (nv)=>{ slot.v = typeof nv==="function" ? nv(slot.v) : nv; h.dirty = true; }]; },
  useRef(v){ const h = CUR, i = h.idx++; if(!(i in h.hooks)) h.hooks[i] = { current:v }; return h.hooks[i]; },
  useCallback(f){ CUR.idx++; return f; },
  useMemo(f){ CUR.idx++; return f(); },
  useEffect(f, deps){ const h = CUR, i = h.idx++, prev = h.hooks[i];
    const changed = !prev || !deps || deps.length!==prev.deps.length || deps.some((d,k)=>!Object.is(d, prev.deps[k]));
    if(!changed) return;
    h.hooks[i] = { deps:deps||[], cleanup:prev && prev.cleanup };
    h.pending.push(()=>{ const slot = h.hooks[i]; if(typeof slot.cleanup==="function") slot.cleanup(); slot.cleanup = f(); }); },
};
function mount(Comp, props){
  const h = { Comp, props, hooks:[], idx:0, pending:[], dirty:false, tree:null };
  h.render = ()=>{ for(let n=0; n<30; n++){ CUR = h; h.idx = 0; h.dirty = false; h.pending = []; h.tree = h.Comp(h.props); CUR = null;
    h.pending.forEach(f=>f()); if(!h.dirty) break; } return h.tree; };
  h.settle = async ()=>{ for(let n=0; n<12; n++){ await tick(); if(h.dirty) h.render(); } return h.tree; };
  h.render();
  return h;
}
const kids = (el)=> (el && el.props && el.props.children) || [];
function findAll(el, pred, out=[]){
  if(el==null || el===false || typeof el!=="object") return out;
  if(Array.isArray(el)){ el.forEach(x=>findAll(x, pred, out)); return out; }
  if(pred(el)) out.push(el);
  kids(el).forEach(x=>findAll(x, pred, out));
  return out;
}
const textOf = (el)=> el==null || el===false || el===true ? "" : (typeof el!=="object" ? String(el) : Array.isArray(el) ? el.map(textOf).join("") : kids(el).map(textOf).join(""));
const byRole = (tree, role)=> findAll(tree, el=>el.props && el.props["data-role"]===role);
const one = (tree, role)=>{ const r = byRole(tree, role); assert.ok(r.length, "no data-role="+role); return r[0]; };
const buttonsWith = (tree, text)=> findAll(tree, el=>el.type==="button" && textOf(el).includes(text));

/* ── the sandbox: pricing.jsx + voicegen.jsx + voices-ui.jsx ── */
function sandbox(){
  const store = {};
  const box = { console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date, Object, Array, Number, String,
    React, events:[],
    localStorage:{ getItem:(k)=>(k in store ? store[k] : null), setItem:(k,v)=>{ store[k] = String(v); }, removeItem:(k)=>{ delete store[k]; } },
    CustomEvent: class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
    Blob: class { constructor(parts, o){ this.parts = parts; this.type = (o && o.type) || ""; this.size = 0; } },
    requestAnimationFrame:()=>0, cancelAnimationFrame:()=>{},
    navigator:{ userAgent:"node-test" },
  };
  box.window = box; box.globalThis = box;
  box.dispatchEvent = (e)=>{ box.events.push(e); return true; };
  box.addEventListener = ()=>{}; box.removeEventListener = ()=>{};
  // audio: a src's length comes from box.durations; play() resolves
  box.durations = {};
  box.played = [];
  box.Audio = class { constructor(url){ this.l = {}; this.paused = true; if(url) this.src = url; }
    addEventListener(t, f){ this.l[t] = f; }
    set src(u){ this._src = u; setTimeout(()=>{ this.duration = box.durations[u] || 0; if(this.l.loadedmetadata) this.l.loadedmetadata(); }, 0); }
    get src(){ return this._src; }
    play(){ box.played.push(this._src); this.paused = false; return Promise.resolve(); } pause(){ this.paused = true; } };
  box.FileReader = class { readAsDataURL(b){ this.result = b.__dataUrl || ""; setTimeout(()=>this.onload && this.onload(), 0); } };
  box.Icon = new Proxy({}, { get:(_t, k)=>function IconStub(){ return null; } });
  vm.createContext(box);
  vm.runInContext(compile("app/pricing.jsx"), box, { filename:"app/pricing.jsx" });
  vm.runInContext(compile("app/voicegen.jsx"), box, { filename:"app/voicegen.jsx" });
  vm.runInContext(compile("app/voices-ui.jsx"), box, { filename:"app/voices-ui.jsx" });
  box.useVoiceGen = ()=>({ audioUrl:"", meta:null, durationMs:0 });
  box.voiceProxyReady = ()=>true;
  box.appToast = ()=>{};
  return box;
}

/* a proxy that answers like image-proxy's voice route */
function proxyBox(answer){
  const box = sandbox();
  box.TURN_SUPABASE = { imageProxy:true, imageProxyFn:"image-proxy" };
  box.bodies = [];
  box.sbClient = ()=>({ functions:{ invoke: async (_fn, req)=>{ box.bodies.push(J(req.body)); return answer(req.body); } } });
  box.vgAssertIdentity = ()=>true;
  return box;
}
const refusal = (status, body)=>{ const ctx = { status, json:async ()=>body }; ctx.clone = ()=>ctx; return { data:null, error:{ message:"non-2xx", context:ctx } }; };

/* ════════ A: voicegen ════════ */
await test("A clone sends the consent, removeNoise and meName; returns whose voice it is", async ()=>{
  const box = proxyBox((b)=> b.op==="clone" ? { data:{ voiceId:"rv-1", name:"Sam", kind:"cloned", personKind:"someone", personName:"Sam", usage:{ credits:10 } }, error:null } : { data:{}, error:null });
  const r = await box.elCloneVoice(["data:audio/webm;base64,AA"], { consent:{ personKind:"someone", personName:"  Sam  ", adult:true, attest:true }, removeNoise:true, meName:"Alex Doe" });
  const b = box.bodies[0];
  assert.equal(b.task, "voice"); assert.equal(b.op, "clone");
  assert.deepEqual(b.samples, ["data:audio/webm;base64,AA"]);
  assert.deepEqual(b.consent, { personKind:"someone", personName:"Sam", adult:true, attest:true });
  assert.equal(b.removeNoise, true); assert.equal(b.meName, "Alex Doe");
  assert.deepEqual(J(r), { voiceId:"rv-1", name:"Sam", kind:"cloned", personKind:"someone", personName:"Sam" });
  assert.ok(box.events.some(e=>e.type==="turn-credits-changed" && e.detail.reason==="voice-clone"), "the balance refreshes");
  // "me": no name sent; noise off by default
  await box.elCloneVoice(["data:audio/webm;base64,AA"], { consent:{ personKind:"me", personName:"ignored", adult:true, attest:true } });
  assert.deepEqual(box.bodies[1].consent, { personKind:"me", personName:"", adult:true, attest:true });
  assert.equal(box.bodies[1].removeNoise, false); assert.ok(!("meName" in box.bodies[1]));
});
await test("A delete + attach (free): the bodies, the film context, no film → nothing linked", async ()=>{
  const box = proxyBox((b)=> b.op==="deleteVoice" ? { data:{ ok:true, deleted:true }, error:null }
    : b.op==="attachVoice" ? { data:{ ok:true, linked:true }, error:null } : { data:{}, error:null });
  box.turnFilmContext = ()=>({ projectId:"film-1" });
  assert.deepEqual(J(await box.elDeleteVoice("rv-1")), { ok:true, deleted:true });
  assert.deepEqual(box.bodies[0], { context:{ projectId:"film-1" }, task:"voice", op:"deleteVoice", voiceId:"rv-1" });
  assert.deepEqual(J(await box.elAttachVoice("rv-1")), { ok:true, linked:true });
  assert.equal(box.bodies[1].op, "attachVoice"); assert.equal(box.bodies[1].context.projectId, "film-1");
  box.turnFilmContext = ()=>null;
  const r = await box.elAttachVoice("rv-1");
  assert.equal(r.linked, false); assert.equal(r.skipped, true); assert.equal(box.bodies.length, 2, "no film open: no call");
  assert.equal(box.events.filter(e=>e.type==="turn-credits-changed").length, 0, "free ops don't refresh the balance");
});
await test("A the list: voices + realVoices; elListVoices still returns the list; the header's count is remembered", async ()=>{
  const voices = [{ voiceId:"s1", name:"Stock", category:"premade" }, { voiceId:"rv-1", name:"Sam", own:true, kind:"cloned", personKind:"someone", personName:"Sam" }];
  const box = proxyBox(()=>({ data:{ voices, customVoices:{ used:2, limit:3 }, realVoices:{ used:1, limit:3 } }, error:null }));
  const r = await box.elListVoicesFull({});
  assert.deepEqual(J(r.customVoices), { used:2, limit:3 }, "designed + real together");
  assert.deepEqual(J(r.realVoices), { used:1, limit:3 }); assert.equal(r.voices.length, 2);
  assert.equal((await box.elListVoices({})).length, 2, "an array, as before");
  assert.deepEqual([box.vgRealVoicesSeen().used, box.vgRealVoicesSeen().real, box.vgRealVoicesSeen().limit], [2, 1, 3]);
  const old = proxyBox(()=>({ data:{ voices, realVoices:{ used:1, limit:5 } }, error:null }));
  assert.equal((await old.elListVoicesFull({})).customVoices, null, "an older server: no customVoices");
  const admin = proxyBox(()=>({ data:{ voices, realVoices:{ used:1, limit:null } }, error:null }));
  assert.equal((await admin.elListVoicesFull({})).realVoices.limit, null, "no limit stays null");
});
await test("A the New Story interviewer speaks with a STOCK voice only (it read r.voices of an array before)", async ()=>{
  const box = proxyBox((b)=> b.op==="listVoices" ? { data:{ voices:[
      { voiceId:"mine", name:"Me", own:true, kind:"cloned", personKind:"me", category:"cloned" },
      { voiceId:"film", name:"Teammate", onFilm:true, kind:"designed", category:"generated" },
      { voiceId:"someone-else", name:"x", category:"cloned" },
      { voiceId:"pro", name:"Pro", category:"professional" },
      { voiceId:"stock-1", name:"Stock", category:"premade" } ] }, error:null } : { data:{}, error:null });
  assert.equal(await box.elInterviewVoiceId(), "stock-1");
  assert.equal(box.vgPickStockVoice([{ voiceId:"a", own:true, kind:"designed" }]), null);
  assert.equal(box.vgPickStockVoice([{ voiceId:"p", category:"professional" }]).voiceId, "p");
  assert.ok(!/r\.voices\[0\]/.test(read("app/voicegen.jsx")), "the old bug is gone");
});
await test("A the clone's price follows the live credit unit (never hard-coded)", ()=>{
  const box = sandbox();
  assert.equal(box.vgVoiceOpCredits("clone"), 10, "$0.10 at $0.01 a credit");
  assert.equal(box.vgVoiceOpCredits("design"), 10);
  box.turnApplyCreditRegime({ switched:false, usd_per_credit:0.03 }, "test");
  assert.equal(box.vgVoiceOpCredits("clone"), box.turnCreditCost(0.10), "the unit moves, the price follows");
  const pricing = read("supabase/functions/image-proxy/billing-pricing.mjs");
  assert.ok(/clone:\s*0\.10/.test(pricing) && /design:\s*0\.10/.test(pricing), "the same flat table as the server");
  assert.ok(read("app/voices-ui.jsx").includes('window.vgVoiceOpCredits("clone")'));
});

/* ════════ B: the server's own sentences ════════ */
await test("B every voice refusal code shows the server's plain message (403 / 400 / 200), billing still handled first", async ()=>{
  const cases = [
    [400, "consent_required", "Add the name of the person whose voice this is."],
    [400, "samples_invalid", "That's only 12 seconds of audio. Record at least 30 seconds — about 1 to 2 minutes of clear speech works best."],
    [403, "voice_limit", "This account already has 3 voices, the most its plan holds. Delete one in Voices to add another."],
    [403, "voice_library_full", "New voices can't be added right now — the studio's voice library is full. Please try again later."],
    [403, "voice_not_allowed", "This voice isn't available to this account. Choose another voice for this character."],
    [403, "voice_deleted", "This voice was deleted. Choose another voice for this character."],
  ];
  for(const [status, code, error] of cases){
    const box = proxyBox(()=>refusal(status, { error, code }));
    box.turnBillingError = ()=>null;
    await assert.rejects(box.vgProxy("clone", {}), (e)=>{ assert.equal(e.message, error, code); assert.equal(e.code, code); assert.equal(e.status, status); return true; });
  }
  for(const [code, error] of [["voice_verification", "This voice couldn't be cloned. The voice service asked to verify the speaker, which can happen when a voice sounds like a public figure. Try another recording of the person's own voice."],
      ["VOICE_SLOTS_FULL", "New voices can't be added right now. Please try again later."]]){
    const box = proxyBox(()=>({ data:{ error, code }, error:null }));
    await assert.rejects(box.vgProxy("clone", {}), (e)=>e.message===error && e.code===code);
  }
  // a 403 with a voice code and no sentence still reads as one
  const bare = proxyBox(()=>refusal(403, { code:"voice_deleted" })); bare.turnBillingError = ()=>null;
  await assert.rejects(bare.vgProxy("tts", {}), (e)=>/deleted/.test(e.message) && e.code==="voice_deleted");
  // billing refusals keep their own path (the Plans window)
  const bill = proxyBox(()=>refusal(402, { error:"no_plan" }));
  let opened = 0;
  bill.turnBillingError = (b, s)=> s===402 ? { code:"no_plan", message:"Choose a plan.", openPlans:true } : null;
  bill.turnHandleBillingError = (i)=>{ opened++; return i.message; };
  await assert.rejects(bill.vgProxy("clone", {}), (e)=>e.message==="Choose a plan." && e.billing==="no_plan");
  assert.equal(opened, 1);
  // the same codes the server refuses with
  const idx = read("supabase/functions/image-proxy/index.ts");
  for(const c of ["consent_required","samples_invalid","voice_limit","voice_library_full","voice_not_allowed","voice_deleted","voice_verification","VOICE_SLOTS_FULL"])
    assert.ok(sandbox().VG_VOICE_REFUSAL_CODES.includes(c), c);
  for(const c of ["consent_required","samples_invalid","voice_limit","voice_not_allowed","voice_deleted","voice_verification","VOICE_SLOTS_FULL"])
    assert.ok(idx.includes(c) || read("supabase/functions/image-proxy/voice-registry.mjs").includes(c), "server has "+c);
  // saveVoice (Design's lock) gets the same sentences
  const sv = proxyBox(()=>refusal(403, { error:"This account already has 3 voices, the most its plan holds. Delete one in Voices to add another.", code:"voice_limit" }));
  sv.turnBillingError = ()=>null;
  await assert.rejects(sv.elSaveVoice("gen-1", {}), (e)=>/already has 3 voices/.test(e.message) && e.code==="voice_limit");
});

/* ════════ C + D: consent and recordings ════════ */
const W = sandbox();
await test("C consent: Me / Someone else (name required), 18 or over, the attestation — the server's exact text", ()=>{
  assert.equal(W.VC_RV_ATTEST, R.VOICE_CONSENT_TEXT, "word for word");
  assert.equal(W.vcRvConsentValid({ personKind:"me", adult:true, attest:false }), false);
  assert.equal(W.vcRvConsentValid({ personKind:"me", adult:false, attest:true }), false);
  assert.equal(W.vcRvConsentValid({ personKind:"someone", personName:"  ", adult:true, attest:true }), false, "their name is required");
  assert.equal(W.vcRvConsentValid({ personKind:"", adult:true, attest:true }), false);
  assert.equal(W.vcRvConsentValid({ personKind:"me", adult:true, attest:true }), true);
  assert.deepEqual(J(W.vcRvConsentPayload({ personKind:"someone", personName:"  Sam Reyes ", adult:true, attest:true })), { personKind:"someone", personName:"Sam Reyes", adult:true, attest:true });
  assert.equal(W.vcRvConsentPayload({ personKind:"me", personName:"x", adult:true, attest:true }).personName, "");
  // what the server accepts
  assert.equal(R.cloneConsent(W.vcRvConsentPayload({ personKind:"someone", personName:"Sam", adult:true, attest:true })).ok, true);
});
await test("D the recordings: the server's limits, the length rules, the level check, the recorder format", ()=>{
  assert.equal(W.VC_RV_LIMITS.minSeconds, R.CLONE_SAMPLE_LIMITS.minSeconds);
  assert.equal(W.VC_RV_LIMITS.maxSeconds, R.CLONE_SAMPLE_LIMITS.maxSeconds);
  assert.equal(W.VC_RV_LIMITS.maxFiles, R.CLONE_SAMPLE_LIMITS.maxFiles);
  assert.equal(W.VC_RV_LIMITS.maxBytes, R.CLONE_SAMPLE_LIMITS.maxBytes);
  const s = (seconds, bytes=1000)=>({ seconds, bytes });
  const c = (list)=>W.vcRvSamplesCheck(list);
  assert.deepEqual([c([]).ok, c([]).state], [false, "empty"]);
  assert.deepEqual([c([s(20)]).ok, c([s(20)]).state], [false, "short"]); assert.match(c([s(20)]).message, /only 20 seconds/);
  assert.deepEqual([c([s(20), s(15)]).ok, c([s(20), s(15)]).state], [true, "fair"], "takes add up: 35 s");
  assert.match(c([s(45)]).message, /At least a minute is recommended/);
  assert.deepEqual([c([s(92)]).ok, c([s(92)]).state], [true, "good"]);
  assert.deepEqual([c([s(200), s(120)]).ok, c([s(200), s(120)]).state], [false, "long"], "over 5 minutes");
  assert.deepEqual([c([s(0)]).ok, c([s(0)]).state], [true, "unknown"], "an unreadable length is the server's to check");
  assert.equal(c(Array.from({ length:26 }, ()=>s(5))).state, "toomany");
  assert.equal(c([s(90, 31*1024*1024)]).state, "toobig");
  assert.equal(W.vcRvLevelVerdict(0.004, 0.02), "quiet");
  assert.equal(W.vcRvLevelVerdict(0.2, 0.995), "clip");
  assert.equal(W.vcRvLevelVerdict(0.1, 0.6), "ok");
  assert.equal(W.vcRvPickMime((m)=>m==="audio/mp4"), "audio/mp4", "Safari records MP4");
  assert.equal(W.vcRvPickMime((m)=>m.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(W.vcRvPickMime(null), "");
  // ~90 seconds to read aloud (about 150 words a minute), no brand names
  const words = W.VC_RV_SCRIPT.join(" ").split(/\s+/).length;
  assert.ok(words>=180 && words<=260, "a ~90 s passage ("+words+" words)");
  assert.ok(W.VC_RV_SCRIPT.some(p=>p.includes("?")) && W.VC_RV_SCRIPT.some(p=>p.includes("!") || /laughed|grateful|love/.test(p)), "questions and feelings");
});

/* ════════ E: the add window ════════ */
function addWindow(over){
  const box = sandbox();
  box.turnUserDisplayName = "Alex Doe";
  box.calls = [];
  box.elCloneVoice = async (samples, opts)=>{ box.calls.push(["clone", samples, J(opts)]); if(box.cloneFail) throw box.cloneFail;
    return { voiceId:"rv-"+box.calls.length, name:"Sam", kind:"cloned", personKind:"someone", personName:"Sam" }; };
  box.elGenerate = async (id, text, opts)=>{ box.calls.push(["tts", id, text, J(opts)]); return { audioUrl:"data:audio/mpeg;base64,TEST" }; };
  box.elDeleteVoice = async (id)=>{ box.calls.push(["delete", id]); return { ok:true, deleted:true }; };
  const used = [], closed = [];
  const h = mount(box.RealVoiceModal, { character:{ id:"c1", name:"MARA" }, modelId:"eleven_v3",
    onClose:()=>closed.push(1), onUse:async (v)=>{ used.push(v); }, ...(over||{}) });
  return { box, h, used, closed };
}
const setConsent = (h, v)=>{ const f = findAll(h.tree, el=>el.props && typeof el.props.onChange==="function" && el.props.value && "personKind" in el.props.value)[0];
  assert.ok(f, "the consent fields"); f.props.onChange(v); h.render(); };
const record = (h, seconds)=>{ const rec = findAll(h.tree, el=>el.props && typeof el.props.onRecorded==="function")[0];
  assert.ok(rec, "the recorder"); rec.props.onRecorded({ id:"rec-"+seconds+"-"+Math.random(), kind:"recording", name:"Recording", dataUrl:"data:audio/webm;base64,R"+seconds, seconds, bytes:4000 }); h.render(); };
await test("E the consent step renders Me / Someone else, their name, both ticks with the exact attestation", ()=>{
  const box = sandbox();
  let v = { personKind:"", personName:"", adult:false, attest:false };
  const F = mount(box.RealVoiceModal, { character:{ name:"MARA" }, onClose:()=>{}, onUse:null });
  const fields = findAll(F.tree, el=>el.props && el.props.value && "personKind" in el.props.value)[0];
  assert.equal(fields.type, box.VcRvConsentFields);
  const inner = mount(fields.type, { value:{ personKind:"someone", personName:"", adult:true, attest:true }, onChange:(x)=>{ v = x; } });
  assert.ok(textOf(inner.tree).includes("Whose voice is this?"));
  assert.deepEqual(findAll(inner.tree, el=>el.props && el.props.role==="radio").map(textOf), ["Me", "Someone else"]);
  assert.ok(byRole(inner.tree, "rv-name").length, "their name");
  assert.ok(textOf(inner.tree).includes("They're 18 or over") && textOf(inner.tree).includes(R.VOICE_CONSENT_TEXT));
  findAll(inner.tree, el=>el.props && el.props["data-person"]==="me")[0].props.onClick();
  assert.deepEqual([v.personKind, v.adult, v.attest], ["me", false, false], "another answer: both ticks asked again");
  const me = mount(fields.type, { value:{ personKind:"me", adult:false, attest:false }, onChange:()=>{} });
  assert.ok(textOf(me.tree).includes("I'm 18 or over") && !byRole(me.tree, "rv-name").length);
});
await test("E consent + recordings → the request; Clone shows its price; the test line plays; Try again deletes the try", async ()=>{
  const { box, h, used, closed } = addWindow();
  const cloneBtn = ()=>one(h.tree, "rv-clone");
  assert.equal(cloneBtn().props.disabled, true, "nothing yet");
  assert.equal(textOf(cloneBtn()), "Clone voice · 10 credits");
  setConsent(h, { personKind:"someone", personName:"Sam", adult:true, attest:true });
  assert.equal(cloneBtn().props.disabled, true, "no recording yet");
  record(h, 20);
  assert.equal(cloneBtn().props.disabled, true, "20 s is too short");
  assert.match(textOf(findAll(h.tree, el=>/vc-rv-check/.test(el.props.className||""))[0]), /only 20 seconds/);
  record(h, 75);
  assert.equal(cloneBtn().props.disabled, false, "95 s in all");
  assert.ok(textOf(h.tree).includes("reads a short test line") && textOf(h.tree).includes("about 1 credit"), "the test line's price is said first");
  // the noise toggle is off by default, then on
  assert.equal(one(h.tree, "rv-noise").props.checked, false);
  one(h.tree, "rv-noise").props.onChange({ target:{ checked:true } }); h.render();
  await cloneBtn().props.onClick(); await h.settle();
  const [, samples, opts] = box.calls[0];
  assert.deepEqual(J(samples), ["data:audio/webm;base64,R20", "data:audio/webm;base64,R75"]);
  assert.deepEqual(opts.consent, { personKind:"someone", personName:"Sam", adult:true, attest:true });
  assert.equal(opts.removeNoise, true); assert.equal(opts.meName, "Alex Doe");
  // the preview: the test line was spoken with the new voice
  const tts = box.calls.find(c=>c[0]==="tts");
  assert.ok(tts, "a test line"); assert.equal(tts[2], box.VC_RV_TEST_LINE); assert.equal(tts[3].voiceId, "rv-1"); assert.equal(tts[3].modelId, "eleven_v3");
  assert.ok(box.played.includes("data:audio/mpeg;base64,TEST"), "and played");
  assert.ok(byRole(h.tree, "rv-use").length && byRole(h.tree, "rv-retry").length && byRole(h.tree, "rv-replay").length);
  assert.ok(box.vcRvAddedAt("rv-1"), "remembered when it was added");
  // Try again: the try is deleted, back to recording with no samples and the ticks asked again
  await one(h.tree, "rv-retry").props.onClick(); await h.settle();
  assert.deepEqual(box.calls.find(c=>c[0]==="delete"), ["delete", "rv-1"]);
  assert.ok(byRole(h.tree, "rv-clone").length, "back to recording");
  assert.ok(!findAll(h.tree, el=>/(^| )vc-rv-sample( |$)/.test(el.props.className||"")).length, "no recordings left");
  const fields = findAll(h.tree, el=>el.props && el.props.value && "personKind" in el.props.value)[0].props.value;
  assert.deepEqual([fields.personKind, fields.personName, fields.adult, fields.attest], ["someone", "Sam", false, false], "the ticks clear after each clone");
  assert.equal(used.length, 0); assert.equal(closed.length, 0);
});
await test("E Use this voice hands the new voice back and closes; a refusal shows the server's sentence", async ()=>{
  const { box, h, used, closed } = addWindow();
  setConsent(h, { personKind:"me", personName:"", adult:true, attest:true });
  record(h, 90);
  await one(h.tree, "rv-clone").props.onClick(); await h.settle();
  await one(h.tree, "rv-use").props.onClick(); await h.settle();
  assert.equal(used.length, 1); assert.equal(used[0].voiceId, "rv-1"); assert.equal(used[0].kind, "cloned"); assert.equal(closed.length, 1);
  assert.ok(!box.calls.some(c=>c[0]==="delete"), "a used voice is kept");
  // the server refuses (say, the recordings): its own sentence, back on the add step
  const w2 = addWindow();
  w2.box.cloneFail = Object.assign(new Error("That's only 12 seconds of audio. Record at least 30 seconds — about 1 to 2 minutes of clear speech works best."), { code:"samples_invalid" });
  setConsent(w2.h, { personKind:"me", adult:true, attest:true }); record(w2.h, 0);   // an unreadable length: sent to the server
  await one(w2.h.tree, "rv-clone").props.onClick(); await w2.h.settle();
  assert.ok(textOf(w2.h.tree).includes("That's only 12 seconds of audio."), "the server's message");
  assert.ok(byRole(w2.h.tree, "rv-clone").length);
});
await test("E uploading files ADDS them (never replaces), 25 at most; each can be removed", async ()=>{
  const { box, h } = addWindow();
  const tab = findAll(h.tree, el=>el.props && el.props.role==="tab" && textOf(el)==="Upload files")[0];
  tab.props.onClick(); h.render();
  const file = (n, sec)=>{ const url = "data:audio/mpeg;base64,F"+n; box.durations[url] = sec; return { name:"take"+n+".mp3", size:1000, type:"audio/mpeg", __dataUrl:url }; };
  const input = ()=>one(h.tree, "rv-files");
  assert.ok(String(input().props.accept).includes(".flac") && String(input().props.accept).includes(".m4a") && input().props.multiple);
  await input().props.onChange({ target:{ files:[file(1, 40)], value:"x" } }); await h.settle();
  await input().props.onChange({ target:{ files:[file(2, 35)], value:"x" } }); await h.settle();
  let rows = findAll(h.tree, el=>/(^| )vc-rv-sample( |$)/.test(el.props.className||""));
  assert.equal(rows.length, 2, "appended");
  assert.ok(textOf(h.tree).includes("1:15 in all"));
  findAll(rows[0], el=>el.type==="button" && textOf(el)==="Remove")[0].props.onClick(); h.render();
  rows = findAll(h.tree, el=>/(^| )vc-rv-sample( |$)/.test(el.props.className||""));
  assert.equal(rows.length, 1); assert.ok(textOf(rows[0]).includes("take2.mp3"));
  await input().props.onChange({ target:{ files:Array.from({ length:30 }, (_, i)=>file(10+i, 5)), value:"x" } }); await h.settle();
  assert.equal(findAll(h.tree, el=>/(^| )vc-rv-sample( |$)/.test(el.props.className||"")).length, 25, "25 at most");
  assert.ok(textOf(h.tree).includes("weren't added"));
});

/* ════════ F: the Voice popup ════════ */
const SAM = { voiceId:"rv-sam", name:"Sam", own:true, kind:"cloned", personKind:"someone", personName:"Sam" };
const ME = { voiceId:"rv-me", name:"Alex Doe", own:true, kind:"cloned", personKind:"me", personName:"" };
const DESIGNED = { voiceId:"dv-1", name:"Gravel", own:true, kind:"designed" };
const FILM = { voiceId:"rv-film", name:"Jo", onFilm:true, kind:"cloned", personKind:"someone", personName:"Jo" };
const STOCK = { voiceId:"stock-1", name:"Rachel", category:"premade", previewUrl:"https://x/p.mp3" };
const OTHERS = { voiceId:"other-user", name:"x", category:"cloned" };   // never offered
function card(o){
  o = o || {};
  const box = sandbox();
  box.calls = [];
  box.elListVoicesFull = async ()=>{ box.calls.push(["list"]); return { voices:o.voices || [SAM, ME, DESIGNED, FILM, STOCK, OTHERS],
    customVoices:o.customVoices===undefined ? { used:2, limit:3 } : o.customVoices, realVoices:o.realVoices===undefined ? { used:2, limit:3 } : o.realVoices }; };
  box.elAttachVoice = async (id)=>{ box.calls.push(["attach", id]); if(o.attachFail) throw o.attachFail; return { ok:true, linked:true }; };
  box.turnLikenessInfo = ()=>o.likeness || null;
  box.appConfirm = async (q)=>{ box.calls.push(["confirm", q]); return o.confirm!==false; };
  const updates = [];
  const c = { id:"c1", name:"MARA", pronouns:"she/her", voiceLock:o.lock || null, ...(o.c||{}) };
  const h = mount(box.VoiceCard ? box.VoiceCard : null, { c, project:{ id:"film-1" }, speaks:true, readOnly:!!o.readOnly, cast:o.cast || [c],
    onUpdate:(id, patch)=>updates.push([id, patch]) });
  return { box, h, updates, c };
}
await test("F the Real voice tab: the count, the account's real voices to use, Add a real voice, Manage voices", async ()=>{
  const { box, h } = card(); await h.settle();
  assert.ok(box.calls.some(c=>c[0]==="list"), "the voices load when the popup opens (free)");
  findAll(h.tree, el=>el.props && el.props["data-mode"]==="clone")[0].props.onClick(); h.render();
  assert.deepEqual(findAll(h.tree, el=>el.props && el.props["data-mode"]).map(textOf), ["Design", "Library", "Real voice"]);
  assert.equal(textOf(one(h.tree, "rv-count")), "2 of 3 voices used", "designed + real together, up front");
  assert.deepEqual(byRole(h.tree, "rv-use-existing").map(textOf), ["Use Sam's voice", "Use your voice", "Use Jo's voice"], "own + the film's real voices");
  assert.equal(one(h.tree, "rv-add").props.disabled, false);
  assert.ok(byRole(h.tree, "rv-manage").length);
  // Clone mode hides the description and "From character"
  assert.ok(!findAll(h.tree, el=>el.type==="textarea").length && !textOf(h.tree).includes("From character"));
  findAll(h.tree, el=>el.props && el.props["data-mode"]==="design")[0].props.onClick(); h.render();
  assert.ok(findAll(h.tree, el=>el.type==="textarea").length && textOf(h.tree).includes("From character"), "Design keeps them");
  // opening the add window
  findAll(h.tree, el=>el.props && el.props["data-mode"]==="clone")[0].props.onClick(); h.render();
  one(h.tree, "rv-add").props.onClick(); h.render();
  assert.ok(findAll(h.tree, el=>el.type===box.RealVoiceModal).length, "Add a real voice opens the window");
});
await test("F at the plan's number of voices (designed + real) Design and Add are off and say why, up front", async ()=>{
  const full = card({ customVoices:{ used:3, limit:3 } }); await full.h.settle();
  // Design: the count, no designing, the reason
  assert.equal(textOf(one(full.h.tree, "design-count")), "3 of 3 voices used");
  assert.equal(one(full.h.tree, "design-voices").props.disabled, true);
  assert.equal(textOf(one(full.h.tree, "design-why")), "3 of 3 voices used — delete one in Voices to add another.");
  findAll(full.h.tree, el=>el.props && el.props["data-mode"]==="clone")[0].props.onClick(); full.h.render();
  assert.equal(one(full.h.tree, "rv-add").props.disabled, true);
  assert.equal(textOf(one(full.h.tree, "rv-why")), "3 of 3 voices used — delete one in Voices to add another.");
  const room = card(); await room.h.settle();
  assert.equal(textOf(one(room.h.tree, "design-count")), "2 of 3 voices used");
  assert.ok(!byRole(room.h.tree, "design-why").length);
  const none = card({ customVoices:{ used:0, limit:0 } }); await none.h.settle();
  findAll(none.h.tree, el=>el.props && el.props["data-mode"]==="clone")[0].props.onClick(); none.h.render();
  assert.equal(one(none.h.tree, "rv-add").props.disabled, true);
  assert.match(textOf(one(none.h.tree, "rv-why")), /Director or Producer plan/);
  const W2 = sandbox();
  assert.equal(W2.vcRvAddState({ ready:true, customVoices:{ used:2, limit:null } }).count, "2 voices used", "no limit (admins)");
  assert.equal(W2.vcRvAddState({ ready:true, realVoices:{ used:1, limit:3 } }).count, "1 of 3 voices used", "an older server's realVoices");
  assert.equal(W2.vcRvAddState({ ready:false }).can, false);
  // the design's lock is off at the limit too
  const vu = read("app/voices-ui.jsx");
  assert.ok(vu.includes('onClick:()=>lockPreview(p),disabled:busy||!addState.can,title:addState.can?undefined:addState.why,"data-role":"design-lock"'));
});
await test("F using a real voice links it to the film and locks it (source cloned, whose voice); a refusal doesn't lock", async ()=>{
  const { box, h, updates } = card(); await h.settle();
  findAll(h.tree, el=>el.props && el.props["data-mode"]==="clone")[0].props.onClick(); h.render();
  await byRole(h.tree, "rv-use-existing")[0].props.onClick(); await h.settle();
  assert.deepEqual(box.calls.find(c=>c[0]==="attach"), ["attach", "rv-sam"]);
  const [id, patch] = updates[updates.length-1];
  assert.equal(id, "c1"); assert.equal(patch.voiceLock.voiceId, "rv-sam"); assert.equal(patch.voiceLock.source, "cloned");
  assert.deepEqual(J(patch.voiceLock.real), { personKind:"someone", personName:"Sam", label:"Sam" });
  assert.equal(patch.voiceLock.voiceName, "Sam"); assert.equal(patch.voiceLock.specSnapshot, "");
  assert.ok(!("voiceSpec" in patch), "a real voice doesn't touch the character's voice description");
  const refused = card({ attachFail:Object.assign(new Error("This voice was deleted."), { code:"voice_deleted" }) }); await refused.h.settle();
  findAll(refused.h.tree, el=>el.props && el.props["data-mode"]==="clone")[0].props.onClick(); refused.h.render();
  await byRole(refused.h.tree, "rv-use-existing")[0].props.onClick(); await refused.h.settle();
  assert.equal(refused.updates.length, 0, "not locked");
  assert.ok(textOf(refused.h.tree).includes("This voice was deleted."));
  const flaky = card({ attachFail:new Error("network") }); await flaky.h.settle();
  findAll(flaky.h.tree, el=>el.props && el.props["data-mode"]==="clone")[0].props.onClick(); flaky.h.render();
  await byRole(flaky.h.tree, "rv-use-existing")[0].props.onClick(); await flaky.h.settle();
  assert.equal(flaky.updates.length, 1, "any other failure still locks");
});
await test("F the Library groups: Your voices, On this film, the voice library — never another account's voice", async ()=>{
  const { box, h, updates } = card(); await h.settle();
  findAll(h.tree, el=>el.props && el.props["data-mode"]==="library")[0].props.onClick(); h.render();
  await buttonsWith(h.tree, "Browse library")[0].props.onClick(); await h.settle();
  const groups = findAll(h.tree, el=>el.props && el.props["data-group"]);
  assert.deepEqual(groups.map(g=>g.props["data-group"]), ["own", "film", "stock"]);
  assert.deepEqual(groups.map(g=>textOf(findAll(g, el=>/vc-lab/.test(el.props.className||""))[0])), ["Your voices", "On this film", "Voice library"]);
  const ids = findAll(h.tree, el=>el.props && el.props["data-voice"]).map(el=>el.props["data-voice"]);
  assert.deepEqual(ids, ["rv-sam", "rv-me", "dv-1", "rv-film", "stock-1"]);
  assert.ok(!ids.includes("other-user"), "someone else's voice is never offered");
  // a stock voice locks as "library" without a link; a designed own voice as "designed" with one
  const stockRow = findAll(h.tree, el=>el.props && el.props["data-voice"]==="stock-1")[0];
  await findAll(stockRow, el=>el.type==="button" && textOf(el)==="Lock")[0].props.onClick(); await h.settle();
  assert.equal(updates[updates.length-1][1].voiceLock.source, "library");
  assert.ok(!box.calls.some(c=>c[0]==="attach" && c[1]==="stock-1"));
  const W3 = sandbox();
  assert.equal(W3.vcLockSourceFor(DESIGNED), "designed"); assert.equal(W3.vcLockSourceFor(SAM), "cloned"); assert.equal(W3.vcLockSourceFor(STOCK), "library");
});
await test("F the likeness pairing: the person's real voice is offered FIRST (Someone else by name; Me with your own voice)", async ()=>{
  const other = card({ likeness:{ locked:true, available:true, mine:true, consent:{ subject:"other", name:"  sam " } } }); await other.h.settle();
  const offer = findAll(other.h.tree, el=>el.props && el.props["data-testid"]==="voice-pair-offer")[0];
  assert.ok(offer, "offered");
  assert.equal(textOf(one(offer, "rv-pair-use")), "Use sam's voice");
  assert.ok(textOf(offer).includes("MARA has sam's likeness — sam's real voice is in your voices."));
  const top = kids(other.h.tree).filter(Boolean);
  assert.equal(top.indexOf(offer), 1, "right under the head, before the tabs");
  await one(offer, "rv-pair-use").props.onClick(); await other.h.settle();
  assert.equal(other.updates[0][1].voiceLock.voiceId, "rv-sam");
  const self = card({ likeness:{ locked:true, available:true, mine:true, consent:{ subject:"self", name:"" } } }); await self.h.settle();
  assert.equal(textOf(one(self.h.tree, "rv-pair-use")), "Use your voice");
  const W4 = sandbox();
  assert.equal(W4.vcPairedRealVoice({ consent:{ subject:"self" } }, [FILM, SAM]), null, "a Me likeness pairs only with this account's Me voice");
  assert.equal(W4.vcPairedRealVoice({ consent:{ subject:"other", name:"Kim" } }, [SAM]), null);
  assert.equal(W4.vcPairedRealVoice({ available:false, consent:{ subject:"other", name:"Sam" } }, [SAM]), null, "a likeness not usable here");
  assert.equal(W4.vcPairedRealVoice({ consent:{ subject:"other", name:"Jo" } }, [FILM]).voiceId, "rv-film", "the film's voice too");
  // already on the character: not offered again
  const done = card({ likeness:{ locked:true, consent:{ subject:"other", name:"Sam" } }, lock:{ voiceId:"rv-sam", source:"cloned", real:{ personKind:"someone", personName:"Sam" } } }); await done.h.settle();
  assert.ok(!findAll(done.h.tree, el=>el.props && el.props["data-testid"]==="voice-pair-offer").length);
});
await test("F Remove only unlinks — and asks first", async ()=>{
  const lock = { voiceId:"rv-sam", voiceName:"Sam", source:"cloned", real:{ personKind:"someone", personName:"Sam", label:"Sam" }, modelId:"eleven_v3" };
  const no = card({ lock, confirm:false }); await no.h.settle();
  assert.equal(findAll(no.h.tree, el=>/vc-src/.test(el.props.className||"")).map(textOf)[0], "Real voice");
  assert.ok(textOf(no.h.tree).includes("Sam's real voice — it doesn't change with the character's description or pronouns."));
  await one(no.h.tree, "voice-remove").props.onClick(); await no.h.settle();
  const q = no.box.calls.find(c=>c[0]==="confirm")[1];
  assert.equal(q.title, "Take this voice off MARA?");
  assert.equal(q.body, "MARA will need another voice, and lines already voiced with it are marked to revoice. Sam's real voice stays in your voices — delete it for good in Voices.");
  assert.equal(no.updates.length, 0, "cancelled: nothing changes");
  const yes = card({ lock }); await yes.h.settle();
  await one(yes.h.tree, "voice-remove").props.onClick(); await yes.h.settle();
  assert.deepEqual(J(yes.updates), [["c1", { voiceLock:null }]]);
  assert.ok(!yes.box.calls.some(c=>c[0]==="delete"), "the voice itself isn't deleted");
});

/* ════════ G: the Voices window ════════ */
await test("G Voices: the account's real voices, who uses them here; Delete asks, deletes for good, unlinks this film's characters", async ()=>{
  const box = sandbox();
  box.calls = [];
  let list = [SAM, ME, FILM, DESIGNED, STOCK];
  box.elListVoicesFull = async ()=>({ voices:list, customVoices:{ used:list.filter(v=>v.own).length, limit:3 }, realVoices:{ used:2, limit:3 } });
  box.elDeleteVoice = async (id)=>{ box.calls.push(["delete", id]); list = list.filter(v=>v.voiceId!==id); return { ok:true, deleted:true }; };
  box.appConfirm = async (q)=>{ box.calls.push(["confirm", q]); return box.answer!==false; };
  box.vcRvRememberAdded("rv-sam");
  const chars = [{ id:"a", name:"MARA", voiceLock:{ voiceId:"rv-sam", source:"cloned" } }, { id:"b", name:"OTTO", voiceLock:{ voiceId:"rv-me", source:"cloned" } },
    { id:"c", name:"LENA", voiceLock:{ voiceId:"rv-sam", source:"cloned" } }, { id:"d", name:"NOBODY" }];
  const updates = [];
  const h = mount(box.VoicesManager, { characters:chars, onUpdate:(id, p)=>updates.push([id, p]), onClose:()=>{} });
  await h.settle();
  const rows = findAll(h.tree, el=>el.props && el.props["data-voice"]);
  assert.deepEqual(rows.map(r=>r.props["data-voice"]), ["rv-sam", "rv-me", "dv-1"], "only this account's own voices");
  assert.deepEqual(findAll(h.tree, el=>el.props && el.props["data-group"]).map(g=>[g.props["data-group"], textOf(findAll(g, x=>/cameo-mgr-sec-t/.test(x.props.className||""))[0])]),
    [["real", "Real voices"], ["designed", "Designed voices"]]);
  assert.ok(textOf(rows[2]).includes("Gravel") && textOf(rows[2]).includes("Designed"));
  assert.ok(textOf(rows[0]).includes("Someone else") && textOf(rows[0]).includes("added ") && textOf(rows[0]).includes("In this film: MARA, LENA"));
  assert.ok(textOf(rows[1]).includes("Me") && textOf(rows[1]).includes("In this film: OTTO"));
  assert.equal(textOf(one(h.tree, "vm-count")), "3 of 3 voices used · your own voices, kept privately with your account");
  box.answer = false;
  await one(rows[0], "rv-delete").props.onClick(); await h.settle();
  assert.ok(!box.calls.some(c=>c[0]==="delete"), "cancelled: nothing deleted");
  const q = box.calls.find(c=>c[0]==="confirm")[1];
  assert.equal(q.title, "Delete Sam's real voice for good?");
  assert.ok(/deleted everywhere and can't be undone/.test(q.body) && /Every film that uses it will need another voice/.test(q.body) && /marked to revoice/.test(q.body));
  assert.deepEqual(q.items, ["MARA", "LENA"]); assert.equal(q.danger, true);
  box.answer = true;
  await one(findAll(h.tree, el=>el.props && el.props["data-voice"]==="rv-sam")[0], "rv-delete").props.onClick(); await h.settle();
  assert.deepEqual(box.calls.filter(c=>c[0]==="delete"), [["delete", "rv-sam"]]);
  assert.deepEqual(J(updates), [["a", { voiceLock:null }], ["c", { voiceLock:null }]], "only its characters lose it");
  assert.deepEqual(findAll(h.tree, el=>el.props && el.props["data-voice"]).map(r=>r.props["data-voice"]), ["rv-me", "dv-1"], "the list reloads");
  assert.equal(textOf(one(h.tree, "vm-count")).split(" · ")[0], "2 of 3 voices used", "room freed");
  // a designed voice: the same confirm, delete and unlink
  chars.push({ id:"e", name:"GRAVEL MAN", voiceLock:{ voiceId:"dv-1", source:"designed" } });
  await one(findAll(h.tree, el=>el.props && el.props["data-voice"]==="dv-1")[0], "rv-delete").props.onClick(); await h.settle();
  const q2 = box.calls.filter(c=>c[0]==="confirm").pop()[1];
  assert.equal(q2.title, "Delete the designed voice “Gravel” for good?"); assert.deepEqual(q2.items, ["GRAVEL MAN"]);
  assert.deepEqual(box.calls.filter(c=>c[0]==="delete").pop(), ["delete", "dv-1"]);
  assert.deepEqual(J(updates.pop()), ["e", { voiceLock:null }]);
  // unlinking marks those characters' voiced lines stale — the app's own rule for a removed voice
  const upd = between(read("app/app.jsx"), "const updateCharacter = (id,patch)=>{", "const merge=c=>{");
  assert.ok(upd.includes('Object.prototype.hasOwnProperty.call(patch,"voiceLock")') && upd.includes("The character's canonical voice was removed; lock a voice and revoice this line."));
  // the Characters header opens it
  const art = read("app/artroom.jsx");
  assert.ok(art.includes('React.createElement(window.VoicesManager,{characters,onUpdate,onClose:()=>setVoicesMgrOpen(false)})'));
  assert.ok(art.includes('"Voices"+(realSeen && realSeen.used>0 ? " \\u00b7 "+realSeen.used : "")'));
});

/* ════════ H: pronouns ════════ */
await test("H a pronoun change never forces a re-clone (voicegen) — and the Stage's line check agrees; other locks still do", ()=>{
  const box = sandbox();
  box.nbAssertMediaIdentity = ()=>true;
  const c = { id:"c1", name:"MARA", pronouns:"they/them", identityRevision:"r2" };
  const cloned = { voiceId:"rv-sam", source:"cloned", identityRevision:"", identityPronouns:"she/her" };
  assert.doesNotThrow(()=>box.vgAssertIdentity({ identityCharacter:c, voiceLock:cloned }, "t"));
  assert.throws(()=>box.vgAssertIdentity({ identityCharacter:c, voiceLock:{ ...cloned, source:"designed" } }, "t"), /predates a character identity change/);
  const stage = read("app/stage.jsx");
  const fn = between(stage, "function _shotAudioState(sh,auds,characters){", "function _shotAudioReady(");
  const S = { window:{} }; vm.createContext(S); vm.runInContext(fn+";this.f=_shotAudioState;", S);
  const sh = { id:"sh1", dialogue:"Hi.", lineAudio:{ speakerId:"c1" } };
  assert.notEqual(S.f(sh, { sh1:"data:x" }, [{ ...c, voiceLock:cloned }]).state, "stale-identity");
  assert.equal(S.f(sh, { sh1:"data:x" }, [{ ...c, voiceLock:{ ...cloned, source:"library" } }]).state, "stale-identity");
});

/* ════════ I: the card line + roles ════════ */
await test("I the card says which face and which voice — each its own", ()=>{
  const f = W.vcFaceVoiceLine;
  const sam = { locked:true, mine:true, consent:{ subject:"other", name:"Sam" } };
  assert.equal(f(sam, { voiceId:"rv", source:"cloned", real:{ personKind:"someone", personName:"Sam" } }), "Face: Sam (likeness) · Voice: Sam (real voice)");
  assert.equal(f(null, { voiceId:"dv", source:"designed" }), "Voice: designed");
  assert.equal(f(null, { voiceId:"s", source:"library" }), "Voice: from the library");
  assert.equal(f({ locked:true, mine:true, consent:{ subject:"self" } }, { voiceId:"rv", source:"cloned", real:{ personKind:"someone", personName:"Jo" } }), "Face: you (likeness) · Voice: Jo (real voice)", "mix and match");
  assert.equal(f(sam, null), "Face: Sam (likeness) · Voice: not cast yet");
  assert.equal(f(null, null), "");
  const art = read("app/artroom.jsx");
  assert.ok(art.includes('window.vcFaceVoiceLine(lkInfo, c.voiceLock)') && art.includes('"data-testid":"char-face-voice"'));
});
await test("I roles: the owner and an Art director may add a real voice; Co-writer, View-only and Stage editor can't", async ()=>{
  const team = read("app/team.jsx");
  const T = {}; vm.createContext(T);
  vm.runInContext(between(team, "const TEAM_ROLE_SECTIONS = {", "/* plain-language name for what a role may NOT touch")+";this.room=teamCanWriteRoom;", T);
  const can = (role)=>T.room(role, "art");
  assert.deepEqual(["owner", "art_director", "writer+art_director", "writer", "view_only", "stage_editor"].map(can), [true, true, true, false, false, false]);
  assert.equal(T.room(null, "art"), true, "a film that's simply yours");
  // the app's Art Room gate is that rule, and it reaches the Voice popup
  const app = read("app/app.jsx"), art = read("app/artroom.jsx");
  assert.ok(app.includes('const artRoomReadOnly = !_sharedCanWriteRoom("art");'));
  assert.ok(art.includes("React.createElement(window.VoiceModal,{character:c,project,speaks,onUpdate,readOnly:!!readOnly,cast:cast||[c],"));
  const ro = card({ readOnly:true, likeness:{ locked:true, consent:{ subject:"other", name:"Sam" } } }); await ro.h.settle();
  findAll(ro.h.tree, el=>el.props && el.props["data-mode"]==="clone")[0].props.onClick(); ro.h.render();
  assert.equal(one(ro.h.tree, "rv-add").props.disabled, true);
  assert.match(textOf(one(ro.h.tree, "rv-why")), /film's owner or an Art director can/);
  assert.ok(!findAll(ro.h.tree, el=>el.props && el.props["data-testid"]==="voice-pair-offer").length, "no offer to a role that can't change the cast");
});

/* ════════ J: Frances, copy, keys ════════ */
await test("J Frances knows: real voices, consent, recording, preview, pairing, the Voices window; billing stays out of her answers", ()=>{
  const ai = read("app/ai.jsx");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(between(ai, "const APP_FEATURES = [", "function appBrief(){")+"\n;this.__F = APP_FEATURES; this.__pub = musePublicFeature;", fb);
  const rv = fb.__F.find(f=>f.name==="Real voices (Art Room)");
  assert.ok(rv, "the entry");
  for(const s of [R.VOICE_CONSENT_TEXT, "'Me' or 'Someone else'", "Record here", "Upload files", "about 1:30", "Remove background noise", "Try again", "Use this voice",
      "Use Sam's voice", "Face: Sam (likeness)", "Voices window", "Art directors", "pronouns"]) assert.ok(rv.what.includes(s), s);
  const pub = fb.__pub(rv).what;
  assert.ok(!/credit|Director plan|Producer 15/.test(pub), "billing and plan sentences never reach Frances");
  assert.ok(pub.includes("Use this voice") && pub.includes(R.VOICE_CONSENT_TEXT));
  assert.ok(/billing|credit/i.test(rv.what), "the billing facts are in the manifest");
  const vf = fb.__F.find(f=>f.name==="Voice (on the character card)").what;
  assert.ok(!vf.includes("explicit checkbox required") && !vf.includes("play a Test line") && !vf.includes("from your account)"), "the old Clone / Library / Test line copy is gone");
  assert.ok(vf.includes("REAL VOICE (a real person's voice") && vf.includes("'Your voices', 'On this film'") && vf.includes("Design, Library and Real voice"));
  for(const f of fb.__F.map(fb.__pub).filter(Boolean)) assert.ok(!/\b(?:ElevenLabs|fal|Claude|Anthropic)\b/.test(f.what), "no vendor names: "+f.name);
});
await test("J the copy names no vendor and no codename; the keys", ()=>{
  const vu = read("app/voices-ui.jsx");
  const strings = (vu.match(/"(?:[^"\\\n]|\\.)*"/g)||[]).filter(x=>/[a-z] [a-z]/i.test(x));
  assert.deepEqual(strings.filter(x=>/ElevenLabs|fal\.ai|\bfal\b|Claude|Anthropic|OpenAI|\bTURN\b|Cinema Machine/.test(x)), []);
  const vg = read("app/voicegen.jsx");
  const block = between(vg, "const VG_VOICE_REFUSAL_CODES", "window.VG_VOICE_REFUSAL_CODES");
  assert.ok(!/ElevenLabs|fal/.test(block));
  const html = read("TURN.html");
  for(const f of ["app/voicegen.jsx", "app/voices-ui.jsx", "app/artroom.jsx", "app/stage.jsx", "app/ai.jsx", "app/script.jsx"])
    assert.ok(["20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24"].some(k=>html.includes('src="'+f+'?v='+k+'"')), f);
  assert.ok(["20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24"].some(k=>html.includes('href="app/styles.css?v='+k+'"')));
  const css = read("app/styles.css");
  for(const k of [".vc-rv-meter{", ".vc-rv-level{", ".vc-pair{", ".char-cast-line{", ".vc-rv-script{"]) assert.ok(css.includes(k), k);
});

console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);
