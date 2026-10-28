#!/usr/bin/env node
/* The Characters review (owner 2026-10-03: "go ahead with all of it").
   A  nothing drafts on its own: the silent cast draft is off unless window.TURN_CAST_AUTO_DRAFT;
      Draft all is the draft stage's main button; the hint no longer promises a silent draft
   B  "Design the cast" shows a preview first: scope (without a sheet / everyone / one scene's cast),
      appearance variants on or off, the counts and the image price; the agent honours the scope
   C  "Focus a scene" also counts the scenes whose script names the character
   D  "Generate N missing sheets" (all + per scene) prices exactly the missing ones;
      "Regenerate sheets…" only once nothing is missing
   E  the card: they/them pronouns, "Likeness", delete asks first, orphaned / removed props go to
      Recently deleted, the dead prop-sheet warning is gone, the sheet prompt is behind the ⋯ menu,
      one render-style control (the photo-based sheet follows the picker)
   F  Frances knows all of it; the prompts let a they/them character keep their pronouns
     node scripts/test-characters-review.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename)=>transformSync(src, { presets:[["@babel/preset-react",{ runtime:"classic" }]],
  plugins:["@babel/plugin-transform-block-scoping"], babelrc:false, configFile:false, filename }).code;
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};

const el = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const hasClass = (c)=>(n)=> String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const buttons = (tree)=> findAll(tree, n=>n.type==="button");
const R = { Fragment:"fragment", createElement:el, state:null, calls:[],
  useState(init){ const i = R.calls.length; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init); R.calls.push(v); return [v, noop]; },
  useEffect:noop, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f,
  reset(st){ R.state = st || null; R.calls = []; } };
const icon = new Proxy({}, { get:()=>()=>null });

const art = read("app/artroom.jsx"), app = read("app/app.jsx"), agents = read("app/agents.jsx"), ai = read("app/ai.jsx");
const insp = read("app/inspector.jsx"), css = read("app/styles.css"), pipe = read("docs/Story Pipeline.md"), html = read("TURN.html");

let images = new Set();
const box = { console, React:R, Icon:icon, Set, Map, Object, Array, String, Number, Math, JSON,
  document:{ addEventListener:noop, removeEventListener:noop, querySelector:()=>null },
  addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true, CustomEvent:class {}, requestAnimationFrame:noop,
  nbCostChip:(count)=>({ type:"chip", props:{ count }, children:[] }), nbGetImage:(id)=> images.has(id) ? "blob:"+id : "",
  useBatchGen:()=>({ activeId:null, begin:(ids, skipped)=>{ box.__begun = { ids, skipped }; }, setMsg:(m)=>{ box.__msg = m; }, advance:noop }),
  usePager:()=>({ slice:(a)=>a }), PagerBar:"PagerBar", CharacterSheet:"CharacterSheet", CameoManager:"CameoManager",
  NbKeyBar:"NbKeyBar", NbControls:"NbControls", BatchBar:"BatchBar", ImageLightbox:"ImageLightbox", InfoTip:"InfoTip",
  RecentlyDeleted:"RecentlyDeleted", RenderStylePicker:"RenderStylePicker",
  scenesInStoryOrder:(s)=>s||[], speakingCharIds:()=>new Set(), nbListCameos:()=>[], roomCopy:()=>({}),
  lookbookHasLook:(lb, note)=> !!String(note||"").trim() || (lb||[]).length>0,
  // the script names a character → scenesWhereCharacterAppears (the real one is in ai.jsx)
  scenesWhereCharacterAppears:(id, name, scenes, drafts)=> (scenes||[]).filter(s=> new RegExp("\\b"+name+"\\b","i").test((drafts||{})[s.id]||"")).map(s=>s.id),
};
box.window = box; vm.createContext(box);
box.usePreviewDialog = ()=>{}; box._previewFocus = ()=>{};   // (2026-10-09) the preview is a dialog (Escape, focus)
vm.runInContext(art.split("\n").find(l => l.startsWith("function vfield(")), box);
vm.runInContext(transform(between(art, "function charVisualsDrafted(c){", "/* prompt for image-to-image"), "a.jsx"), box);
vm.runInContext(transform(between(art, "function charLookbookFirstHint(", "/* ---- pre-production readiness"), "a.jsx"), box);
vm.runInContext(transform(between(art, "/* DESIGN THE CAST — what the Casting Director will make", "/* shown only when a tab's component hasn't loaded"), "a.jsx"), box);
const D = (id, name, extra)=>({ id, name, coreBody:"lean", wardrobeMask:"coat", ...(extra||{}) });
const U = (id, name)=>({ id, name });

/* ═══ A ═══ */
await test("A1 the silent cast draft waits unless window.TURN_CAST_AUTO_DRAFT is on", ()=>{
  const step = between(app, "function turnCastAutoDraftStep(s){", "/* The reverse gate:");
  assert.ok(step.includes('if(s.autoDraft===false) return "wait";'));
  assert.ok(step.indexOf('if(s.autoDraft===false)') > step.indexOf('return s.latched ? "wait" : "latch";'), "a drafted cast still latches");
  assert.ok(app.includes("autoDraft:window.TURN_CAST_AUTO_DRAFT===true"));
  assert.ok(!/TURN_CAST_AUTO_DRAFT\s*=\s*true/.test(app + html), "nothing turns it on");
});
await test("A2 Draft all is the draft stage's main button; the hint no longer says the cast drafts itself", ()=>{
  const sheets = between(art, "function CharacterSheets(", "/* ---- pre-production readiness");
  assert.ok(sheets.includes('someUndrafted && React.createElement("button",{className:"art-draftall",disabled:draftingAll,onClick:onDraftAll,'));
  assert.ok(!/drafts itself/.test(sheets));
  assert.ok(sheets.includes("drafting the cast after it gives every character the film's look"));
  assert.ok(sheets.includes("Nothing is drafted or generated until you press a button."));
});
await test("A3 the pipeline doc records the switch-off (owner-approved)", ()=>{
  assert.ok(/\*Switched off 2026-10-03 \(owner, Characters review:/.test(pipe) && /window\.TURN_CAST_AUTO_DRAFT/.test(pipe));
});

/* ═══ B ═══ */
// (2026-10-06) states are PINNED to a scene — an unpinned one is never made or priced (no shot uses it)
const cast = ()=>[ D("a","Ana",{ states:[{ id:"w", label:"Wounded", sceneId:"s1" }, { id:"u", label:"Unpinned" }] }), D("b","Ben"), U("c","Cal"), D("d","Dee",{ states:[{ id:"x", label:"Wet", sceneId:"s1" }] }) ];
await test("B1 the plan: 'without a sheet' skips finished characters; 'everyone' adds their missing variants", ()=>{
  images = new Set(["a", "d", "d:x"]);
  const m = box.castDesignPlan(cast(), "missing", null, true);
  assert.deepEqual(J(m.ids), ["b", "c"]);
  assert.equal(m.specs, 1); assert.equal(m.sheets, 2); assert.equal(m.variants, 0); assert.equal(m.noStates, 2); assert.equal(m.images, 2);
  const all = box.castDesignPlan(cast(), "all", null, true);
  assert.equal(all.n, 4); assert.equal(all.sheets, 2); assert.equal(all.variants, 1, "Ana's Wounded"); assert.equal(all.images, 3);
  const noVar = box.castDesignPlan(cast(), "all", null, false);
  assert.equal(noVar.variants, 0); assert.equal(noVar.noStates, 0); assert.equal(noVar.images, 2);
  const sc = box.castDesignPlan(cast(), "scene", ["a", "c"], true);
  assert.deepEqual(J(sc.ids), ["a", "c"]); assert.equal(sc.images, 2, "Cal's sheet + Ana's variant");
});
await test("B2 the preview: scopes with counts, the price chip is the image total, the button names the count", ()=>{
  images = new Set(["a"]);
  let got = null;
  R.reset();
  const tree = box.CastConfirm({ characters:cast(), onCancel:noop, onConfirm:(s)=>{ got = s; } });
  const t = textOf(tree);
  assert.ok(/Characters without a sheet/.test(t) && /Every character/.test(t) && !/Scene/.test(t));
  const chips = findAll(tree, n=>n.type==="chip");
  // without a sheet: Ben, Cal, Dee → 3 sheets + Dee's Wet variant = 4
  assert.equal(chips.length, 1); assert.equal(chips[0].props.count, 4);
  const go = buttons(tree).find(b=>/Design 3 characters/.test(textOf(b)));
  assert.ok(go && !go.props.disabled);
  go.props.onClick();
  assert.deepEqual(J(got), { only:["b","c","d"], variants:true, fidelity:false });
});
await test("B3 a focused scene opens on that scene's cast; 'Every character' passes no list; variants can be left out", ()=>{
  images = new Set();
  let got = null;
  R.reset();
  let tree = box.CastConfirm({ characters:cast(), sceneId:"s2", sceneNo:2, sceneIds:["b"], onCancel:noop, onConfirm:(s)=>{ got = s; } });
  assert.ok(/Scene 02's cast/.test(textOf(tree)));
  buttons(tree).find(b=>/Design 1 character$/.test(textOf(b))).props.onClick();
  assert.deepEqual(J(got), { only:["b"], variants:true, fidelity:false });
  R.reset([ "all", false ]);
  tree = box.CastConfirm({ characters:cast(), onCancel:noop, onConfirm:(s)=>{ got = s; } });
  buttons(tree).find(b=>/Design 4 characters/.test(textOf(b))).props.onClick();
  assert.deepEqual(J(got), { only:null, variants:false, fidelity:false });
});
await test("B4 nothing to make → says so and the button is off", ()=>{
  images = new Set(["a", "a:w", "b", "d", "d:x"]);
  R.reset([ "scene", true ]);
  const tree = box.CastConfirm({ characters:cast(), sceneId:"s1", sceneNo:1, sceneIds:["a"], onCancel:noop, onConfirm:noop });
  assert.ok(/already exists/.test(textOf(tree)));
  assert.ok(buttons(tree).find(b=>/Design 1 character/.test(textOf(b))).props.disabled);
});
await test("B5 the app: Design the cast opens the preview; its button starts the run with the scope", ()=>{
  assert.ok(app.includes('if(!turnCastDraftingBlocksAgent(draftingAllVisualsRef.current, "Design the cast")) setCastConfirm(opts||{}); },'));
  assert.ok(app.includes("setCastingForce({ only:(scope&&scope.only)||null, variants:!(scope && scope.variants===false), fidelity:!!(scope && scope.fidelity) });"));   // + the optional Script check (2026-10-12)
  assert.ok(app.includes('runOnOpen: !!(castingForce && typeof castingForce==="object"),'));
  assert.ok(app.includes("castOnly: castScope && Array.isArray(castScope.only) ? castScope.only.slice() : null,"));
  assert.ok(app.includes('castVariants: !(castScope && castScope.variants===false),'));
  assert.ok(app.includes('const forceImages = force===true;'), "a scope object never forces regeneration");
});
await test("B6 the agent works only on the chosen characters, and skips variants when asked", async ()=>{
  const ab = { console, Set }; ab.window = ab; vm.createContext(ab);
  vm.runInContext(between(agents, "async function agentCastingDirector(ctx){", "/* =========================================================\n   WEAR PROPS"), ab);
  const run = async (only, variants)=>{
    const log = [];
    const list = [ D("a","Ana",{ states:[{ id:"w", label:"Wounded", sceneId:"s1" }] }), D("b","Ben"), U("c","Cal") ];   // pinned: made
    const ctx = { castOnly:only, castVariants:variants, force:false, ai:{ available:true }, emit:noop, cancelled:()=>false,
      art:{ markApplied:noop, cast:{ list,
        isDrafted:(c)=>!!c.coreBody, draftSpec:async (c)=>{ log.push("draft:"+c.id); return { coreBody:"x", wardrobeMask:"y" }; },
        suggestStates:async (c)=>{ log.push("states:"+c.id); return [{ id:"s", label:"S", sceneId:"s1" }]; },
        imageOf:async ()=>"", generateMaster:async (c)=>{ log.push("master:"+c.id); return "u"; },
        generateState:async (c, st)=>{ log.push("var:"+c.id+":"+st.id); } } } };
    await ab.agentCastingDirector(ctx);
    return log;
  };
  assert.deepEqual(await run(["c"], true), ["draft:c", "states:c", "master:c", "var:c:s"]);
  assert.deepEqual(await run(["a", "c"], false), ["master:a", "draft:c", "master:c"]);
  assert.equal((await run(null, true)).filter(x=>x.startsWith("master:")).length, 3, "no scope → everyone");
  assert.deepEqual(await run([], true), [], "an empty selection makes nothing");
});

/* ═══ C + D: the header ═══ */
vm.runInContext(transform(between(art, "function CharacterSheets(", "/* ---- pre-production readiness"), "cs.jsx"), box);
const renderSheets = (props, state)=>{ R.reset(state); return box.CharacterSheets({ project:{}, scenes:[], props:[], drafts:{}, shots:[], beatsMap:{},
  onUpdate:noop, onDraft:noop, onDraftAll:noop, onCast:(o)=>{ box.__cast = o; }, lookbook:[], lookbookNote:"look", ...props }); };
await test("C1 'Focus a scene' counts characters the scene's script names, not just its driver and shots", ()=>{
  images = new Set();
  const scenes = [{ id:"s1", no:1, title:"Dock", driver:"a" }, { id:"s2", no:2, title:"Bar" }];
  const tree = renderSheets({ characters:[D("a","Ana"), D("b","Ben")], scenes, drafts:{ s1:"ANA waits. BEN arrives.", s2:"BEN drinks." } });
  const opts = findAll(tree, n=>n.type==="option").map(textOf);
  assert.ok(opts.some(o=>/Scene 01 · Dock\s+\(2 characters\)/.test(o)), opts.join(" | "));
  assert.ok(opts.some(o=>/Scene 02 · Bar\s+\(1 character\)/.test(o)));
});
await test("D1 'Generate N missing sheets' prices exactly the missing drafted ones and queues only them", ()=>{
  images = new Set(["a"]);
  box.__begun = null;
  const tree = renderSheets({ characters:[D("a","Ana"), D("b","Ben"), D("d","Dee"), U("c","Cal")] });
  const b = buttons(tree).find(x=>/Generate 2 missing sheets/.test(textOf(x)));
  assert.ok(b, buttons(tree).map(textOf).join(" | "));
  assert.equal(findAll(b, n=>n.type==="chip")[0].props.count, 2);
  assert.ok(hasClass("ghost")(b), "a quiet button while someone still needs a spec (Draft all leads)");
  b.props.onClick();
  assert.deepEqual(J(box.__begun), { ids:["b","d"], skipped:0 });
  assert.ok(!buttons(tree).some(x=>/Regenerate sheets/.test(textOf(x))));
});
await test("D2 everyone drafted → the missing button leads; nothing missing → only a quiet 'Regenerate sheets…'", ()=>{
  images = new Set(["a"]);
  let tree = renderSheets({ characters:[D("a","Ana"), D("b","Ben")] });
  const b = buttons(tree).find(x=>/Generate 1 missing sheet$/.test(textOf(x).replace(/\s+$/,"")));
  assert.ok(b && !hasClass("ghost")(b));
  images = new Set(["a", "b"]);
  tree = renderSheets({ characters:[D("a","Ana"), D("b","Ben")] });
  assert.ok(!buttons(tree).some(x=>/missing/.test(textOf(x))));
  const re = buttons(tree).find(x=>/Regenerate sheets/.test(textOf(x)));
  assert.ok(re && hasClass("ghost")(re));
  box.__begun = null; re.props.onClick();
  assert.deepEqual(J(box.__begun), { ids:["a","b"], skipped:0 }, "the batch asks before redoing (its own prompt)");
});
await test("D3 a focused scene: 'Generate N missing in Scene NN' and 'Design this scene's cast'", ()=>{
  images = new Set(["a"]);
  const scenes = [{ id:"s1", no:3, title:"Dock", driver:"a" }];
  // useState order: view, openVoiceIds, mgrOpen, sceneFilter…
  const tree = renderSheets({ characters:[D("a","Ana"), D("b","Ben"), D("c","Cal")], scenes, drafts:{ s1:"ANA and BEN." } }, { 3:"s1" });
  const g = buttons(tree).find(x=>/Generate 1 missing in Scene 03/.test(textOf(x)));
  assert.ok(g, buttons(tree).map(textOf).join(" | "));
  assert.equal(findAll(g, n=>n.type==="chip")[0].props.count, 1);
  box.__begun = null; g.props.onClick();
  assert.deepEqual(J(box.__begun), { ids:["b"], skipped:0 });
  buttons(tree).find(x=>/Design this scene's cast/.test(textOf(x))).props.onClick();
  assert.deepEqual(J(box.__cast), { sceneId:"s1", sceneNo:3, sceneIds:["a","b"] });
  buttons(tree).find(x=>/^Design the cast$/.test(textOf(x))).props.onClick();
  assert.deepEqual(J(box.__cast), {});
});

/* ═══ E: the card ═══ */
const card = between(art, "function CharacterSheet({", "function CharacterSheets(");
await test("E1 pronouns offer they/them (like the Writers' Room's Character panel)", ()=>{
  assert.ok(card.includes('[["","set pronouns\\u2026"],["he/him","he/him"],["she/her","she/her"],["they/them","they/them"]]'));
  assert.ok(card.includes('c.pronouns==="they/them") ? c.pronouns : ""'));
});
await test("E2 the face-capture button reads 'Likeness'", ()=>{
  assert.ok(card.includes('React.createElement(Icon.userScan,{s:12}), "Likeness",'))   // (2026-10-27) then its locked tick;
  assert.ok(!card.includes('cameoMeta?"Cameo":"Cast"'));
});
await test("E3 deleting a character asks first and says it goes to Recently Deleted", ()=>{
  const frame = between(art, "function SheetFrame({", "function activeStateForScene(");
  assert.ok(frame.includes('else if(/character/i.test(deleteLabel||"")){'));
  assert.ok(frame.includes('confirmLabel:"Delete character", cancelLabel:"Cancel", danger:true'));
  assert.ok(app.includes("setTrash(t=>({ ...t, characters:[ _trashStamp(c), ...(t.characters||[]).filter(x=>x.id!==id) ] }));"), "the delete stays soft");
});
await test("E4 removed / orphaned props go to Recently deleted with their sheets (never cleared)", ()=>{
  const fn = between(app, "  const removeOwnedProp = (charId, itemText)=>{", "  const _normPropName =");
  assert.ok(!/nbClearAsset/.test(fn));
  assert.ok(fn.includes("setTrash(t=>({ ...t, props:[ ...victims.map(_trashStamp), ...(t.props||[]).filter(x=>!ids.has(x.id)) ] }));"));
  assert.ok(card.includes("Their prop cards move to the Props tab's Recently Deleted"));
  assert.ok(!card.includes("This deletes their prop cards and reference sheets. This can't be undone."));
  assert.ok(insp.includes("Recently Deleted, where it can be restored.") && !insp.includes("This also deletes its prop card"));
});
await test("E5 the dead 'linked props have no sheet' warning is gone", ()=>{
  assert.ok(!/missingPropSheets|preparingRef|setPrepProps/.test(card));
  // (2026-10-10, owner — Likeness review) the card's only pre-generate step is the likeness one: a likeness this person
  // can't use here is said before anything is spent
  assert.deepEqual(card.match(/beforeGenerate:[^\n]*/g), ["beforeGenerate: ()=> (window.turnLikenessUnavailableGate||(async()=>true))(c, cardGenerateRefs()),"]);
});
// (owner 2026-10-28) a folded section of the card, no longer behind its ⋯ menu
await test("E6 the sheet prompt is a folded section of the card", ()=>{
  assert.ok(!card.includes('"Show the sheet prompt"'));
  assert.ok(card.includes('React.createElement(CardFold,{label:"Master reference prompt",defaultOpen:false},'));
});
await test("E7 one render-style control: Look dev has no free-text style; the photo-based sheet follows the picker", ()=>{
  assert.ok(!card.includes('label:"Render style",value:c.renderStyle'));
  const pb = { console, window:null, RENDER_STYLE_LABELS:{ ghibli:"Studio Ghibli" } }; pb.window = pb; vm.createContext(pb);
  vm.runInContext(`const CHAR_RENDER_STYLES = { photoreal:{ rendering:"hyperrealistic photography", lighting:"soft key" },
    ghibli:{ rendering:"hand-painted watercolour animation", lighting:"warm daylight", color_grade:"pastel" } };
    function paletteFromGradient(){ return []; }
    function inferCharacterRenderStyleKey(c){ return (c && c.renderStyleKey) || "photoreal"; }`, pb);
  vm.runInContext(between(art, "function charVisualDefaults(c){", "window.charVisualDefaults"), pb);
  vm.runInContext(between(art, "const RENDER_STYLE_PROMPT_NAMES", "\n") + "\n" + art.split("\n").find(l=>l.startsWith("function renderStylePromptName(")), pb);
  vm.runInContext(between(art, "function charRenderBlock(c){", "window.charRenderBlock"), pb);
  // (2026-10-12, Character fidelity) the photo-based sheet also sends the body's distinguishing features
  vm.runInContext(between(art, "const CHAR_PHYS_LABELS", "/* the features a render of this character sends"), pb);
  // (2026-10-27) every character sheet's plain mid-grey background, shared by both sheet prompts
  vm.runInContext(art.split("\n").find(l=>l.startsWith("const CHAR_SHEET_BACKGROUND = ")), pb);
  vm.runInContext(between(art, "function buildRefFromPhotoPrompt(c, project){", "window.buildRefFromPhotoPrompt"), pb);
  assert.match(pb.buildRefFromPhotoPrompt({ name:"Ana", scriptFeatures:"A scar on the chin. A forearm panel." }, {}),
    /Distinguishing features \(from the script\), shown in every view where that part of the body is visible: A forearm panel\. /);
  const g = pb.buildRefFromPhotoPrompt({ name:"Ana", renderStyleKey:"ghibli" }, {});
  assert.ok(/RENDER STYLE: Studio Ghibli; hand-painted watercolour animation; warm daylight; pastel\./.test(g), g);
  const legacy = pb.buildRefFromPhotoPrompt({ name:"Ana", renderStyleKey:"ghibli", renderStyle:"ink outlines." }, {});
  assert.ok(/pastel; ink outlines\./.test(legacy), "an older card's free-text style is kept as extra notes");
  assert.ok(/RENDER STYLE: hyperrealistic photography; soft key\./.test(pb.buildRefFromPhotoPrompt({ name:"Ana" }, {})));
});

/* ═══ F ═══ */
await test("F1 Frances: no silent drafting, the preview and its scopes, missing sheets, the card changes", ()=>{
  const src = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(src + "\n;this.__F = APP_FEATURES;", fb);
  const F = fb.__F, all = F.map(f=>f.what).join("\n");
  const cs = (F.find(f=>f.name==="Character Sheets (Art Room)")||{}).what || "";
  assert.ok(!/AUTO-DRAFTED silently|AUTO-DRAFTS|auto-drafted once|silent draft designs|drafts itself from it/.test(all));
  assert.ok(/'Design the cast' runs the CASTING DIRECTOR agent, but FIRST shows a preview/.test(cs));
  assert.ok(/characters without a sheet \(the default\), every character/.test(cs) && /Design this scene's cast/.test(cs) && /Also make appearance variants/.test(cs));
  assert.ok(/'Generate N missing sheets' renders only the drafted characters that have no sheet yet/.test(cs));
  assert.ok(/he\/him, she\/her or they\/them/.test(cs));
  assert.ok(/moves that item's matching prop card \(with any generated reference sheet\) to the Props tab's Recently Deleted/.test(cs));
  const cards = (F.find(f=>f.name==="Character Sheets (Art Room)")||{}).what || "";
  assert.ok(/ONE RENDER-STYLE CONTROL/.test(cards) && /folded 'Master reference prompt' section/.test(cards) && /'LIKENESS' \(was 'Cast'\)/.test(cards) && /DELETING A CHARACTER asks first/.test(cards));
  assert.ok(/'Likeness' locks a real person's face/.test(all))   // (2026-10-10, Likeness review: the entry was rewritten);
  assert.ok(!/TURN|McKee|Claude|Anthropic/.test(cards));
});
await test("F2 a character set to they/them keeps their pronouns in the writing prompts", ()=>{
  assert.equal((ai.match(/unless (this|the cast) list gives that person they\/them/g)||[]).length, 3);
});
await test("F3 styles for the preview use theme tokens only", ()=>{
  const rules = css.match(/\.cc-scope[^{]*\{[^}]*\}|\.cc-check[^{]*\{[^}]*\}/g) || [];
  assert.ok(rules.length >= 5);
  assert.ok(rules.every(r=>!/#[0-9a-f]{3,6}\b|rgb\(/i.test(r)));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);
