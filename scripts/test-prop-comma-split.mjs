#!/usr/bin/env node
/* One item keeps its commas (owner 2026-10-05: "fix the prop comma split").
   Oreste's accessories — "a navy knitted wool watch cap pushed back on the head; a steel wristwatch
   with a cracked, heat-fogged crystal on a worn leather strap" — became THREE prop cards ("A steel
   wristwatch with a cracked", "Heat-fogged crystal on a worn leather strap"): the splitters cut at
   every comma even when the list is separated by semicolons.
   A  splitPropItems / splitListItems: semicolons / bullets / lines separate items when present;
      comma-only lists still split, and a piece that ends mid-phrase rejoins its continuation
   B  lists are written back with "; " when an item has a comma, so they read back the same
   C  the worn/carried tidy-up keeps whole items
   D  cards the old split already made are repaired (renamed to the whole item; leftover pieces
      without an image go to Recently Deleted); a second pass changes nothing
     node scripts/test-prop-comma-split.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};

const box = { console, Object, Array, String, Number, Math, JSON, Set, Map, RegExp,
  React:{ createElement:()=>null, useState:(v)=>[typeof v==="function"?v():v, noop], useEffect:noop, useRef:(v)=>({ current:v }), useMemo:(f)=>f() },
  document:{ addEventListener:noop, removeEventListener:noop, querySelector:()=>null }, addEventListener:noop, removeEventListener:noop };
box.window = box; vm.createContext(box);
const tx = (src)=> transformSync(src, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code;
vm.runInContext(read("app/prop-screenplay.js"), box);
vm.runInContext(tx(read("app/props.jsx")), box);
const insp = read("app/inspector.jsx");
vm.runInContext(between(insp, "function splitListItems(value){", "/* capitalise just the first letter"), box);
vm.runInContext(between(insp, "/* write a list back:", "/* The character `role` string"), box);

const ORESTE = "a navy knitted wool watch cap pushed back on the head; a steel wristwatch with a cracked, heat-fogged crystal on a worn leather strap";
const WATCH = "a steel wristwatch with a cracked, heat-fogged crystal on a worn leather strap";

/* ═══ A ═══ */
await test("A1 Oreste: two items, the watch whole (the old split made three)", ()=>{
  assert.deepEqual(J(box.splitPropItems(ORESTE)), ["a navy knitted wool watch cap pushed back on the head", WATCH]);
  assert.equal(box.splitPropItems(ORESTE, { legacyComma:true }).length, 3);
  assert.deepEqual(J(box.splitListItems(ORESTE)), ["a navy knitted wool watch cap pushed back on the head", WATCH]);
});
await test("A2 comma-only lists still split; a piece ending mid-phrase rejoins; a new item never does", ()=>{
  const both = (t)=> [J(box.splitPropItems(t)), J(box.splitListItems(t))];
  for(const [got1, got2] of [both("a pen, a cup")]){ assert.deepEqual(got1, ["a pen","a cup"]); assert.deepEqual(got2, ["a pen","a cup"]); }
  assert.deepEqual(J(box.splitPropItems(WATCH)), [WATCH], "one item, comma-only, ending 'with a cracked'");
  assert.deepEqual(J(box.splitPropItems("a mug of tea, a pen")), ["a mug of tea","a pen"], "'a pen' starts a new item");
  assert.deepEqual(J(box.splitPropItems("a thin, unpolished silver band")), ["a thin, unpolished silver band"], "the older dangling rule still holds");
  assert.deepEqual(J(box.splitPropItems("a ring (gold, engraved); a scarf")), ["a ring (gold, engraved)","a scarf"]);
  assert.deepEqual(J(box.splitPropItems("glasses · a belt with a brass, dented buckle")), ["glasses","a belt with a brass, dented buckle"]);
});

/* ═══ B ═══ */
await test("B1 written back with '; ' when an item has a comma, else ', ' — and it reads back the same", ()=>{
  const items = ["a navy watch cap", WATCH];
  const joined = box.joinListItems(items);
  assert.equal(joined, "a navy watch cap; "+WATCH);
  assert.deepEqual(J(box.splitListItems(joined)), items);
  assert.equal(box.joinListItems(["a pen","a cup"]), "a pen, a cup");
  assert.ok(insp.includes("const joined = joinListItems(next);"), "the bullet editor saves through it");
  assert.ok(read("app/app.jsx").includes('return changed ? ((typeof joinListItems==="function") ? joinListItems(next) : next.join(", ")) : null;'), "the prop → bullet rename sync too");
});

/* ═══ C ═══ */
await test("C1 the worn/carried tidy-up keeps whole items", ()=>{
  const ai = read("app/ai.jsx");
  const rb = { console, String, Array, RegExp, splitListItems:box.splitListItems, joinListItems:box.joinListItems }; rb.window = rb; vm.createContext(rb);
  vm.runInContext(ai.split("\n").find(l=>/^const _CARRIED_RX\s*=/.test(l)) || "const _CARRIED_RX=/\\b(phone|bag)\\b/i;", rb);
  vm.runInContext(between(ai, "window.turnReclassifyWornCarried = function(accText, propText){", "function _wornCarriedSplit("), rb);
  const r = rb.turnReclassifyWornCarried(WATCH+"; a cracked phone in a worn, taped case", "keys");
  assert.equal(r.acc, WATCH);
  assert.equal(r.props, "keys; a cracked phone in a worn, taped case");
  assert.equal(rb.turnReclassifyWornCarried(ORESTE, "").changed, false);
});

/* ═══ D: the real repair effect ═══ */
const app = read("app/app.jsx");
const effect = between(app, "  React.useEffect(()=>{\n    // silent gates (never a \"read-only\" notice from a background repair)", "  },[characters, props, hydrationTick, castAutoDraftWritable]);");
const runRepair = (characters, props, images)=>{
  const st = { props:props.slice(), trash:{ props:[] }, toasts:[] };
  const rb = { console, Object, Array, String, Set, Date, JSON,
    splitPropItems:box.splitPropItems, nbGetImage:(id)=> images.has(id) ? "blob:"+id : "",
    appToast:(m)=>st.toasts.push(m) };
  rb.window = rb; vm.createContext(rb);
  vm.runInContext(`const hydratingRef={current:false}, projectLoadingRef={current:false}, castAutoDraftWritable=true;
    const _trashStamp=(o)=>({ ...o, _deletedAt:"now" });
    this.run=(characters, props, setProps, setTrash)=>{ const React={ useEffect:(f)=>f() }; ${effect} },[]); };`, rb);
  rb.run(characters, st.props, (f)=>{ st.props = f(st.props); }, (f)=>{ st.trash = f(st.trash); });
  return st;
};
const oreste = { id:"oreste", name:"ORESTE", accessories:ORESTE };
const card = (id, name, extra)=>({ id, name, ownerId:"oreste", fromCast:true, kind:"worn", ...(extra||{}) });
const fragments = ()=>[ card("cap","A navy knitted wool watch cap pushed back on the head"), card("w1","A steel wristwatch with a cracked",{ form:"round steel case" }),
  card("w2","Heat-fogged crystal on a worn leather strap"), { id:"pen", name:"Pen", ownerId:"other" } ];
await test("D1 the first piece's card becomes the whole watch (spec kept); the leftover piece goes to Recently Deleted", ()=>{
  const st = runRepair([oreste], fragments(), new Set());
  assert.deepEqual(J(st.props.map(p=>p.id)), ["cap","w1","pen"]);
  const w = st.props.find(p=>p.id==="w1");
  assert.equal(w.name, "A steel wristwatch with a cracked, heat-fogged crystal on a worn leather strap"); assert.equal(w.form, "round steel case");
  assert.deepEqual(J(st.trash.props.map(p=>p.id)), ["w2"]);
  assert.match(st.toasts[0], /Repaired 1 prop card that was split at a comma — 1 leftover piece moved to Props › Recently Deleted/);
  const again = runRepair([oreste], st.props, new Set());
  assert.equal(again.toasts.length, 0, "a second pass changes nothing");
});
await test("D2 a leftover piece WITH an image is kept (the user decides); hand-added cards are never touched", ()=>{
  let st = runRepair([oreste], fragments(), new Set(["w2"]));
  assert.ok(st.props.some(p=>p.id==="w2")); assert.equal(st.trash.props.length, 0);
  const hand = fragments().map(p=> p.id==="w1"||p.id==="w2" ? { ...p, fromCast:false } : p);
  st = runRepair([oreste], hand, new Set());
  assert.equal(st.toasts.length, 0);
});
await test("D3 new cast pulls make one card per whole item", ()=>{
  const out = box.propsFromCast([{ id:"oreste", name:"ORESTE", accessories:ORESTE }], [], [], {});
  assert.deepEqual(J(out.map(p=>p.name)), ["A navy knitted wool watch cap pushed back on the head", "A steel wristwatch with a cracked, heat-fogged crystal on a worn leather strap"]);
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);
