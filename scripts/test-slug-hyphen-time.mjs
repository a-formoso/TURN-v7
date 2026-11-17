/* A HYPHENATED TIME OF DAY STAYS WHOLE (2026-11-12). parseSlug (app/script.jsx) splits a slugline into
   { intext, place, time } for the Script view's hinge between two scenes and its "Location / Time" cells. It took what
   follows the LAST separator of any kind, so "INT. NEWSROOM - PRE-DAWN" read as the place "NEWSROOM - PRE" at "DAWN".
   Now the time is what follows the last separator that has a space before it (or the last comma); a slug typed without
   spaces ("INT. SHOP-DAWN") still reads through the old rule.
   Runs the REAL parseSlug / sceneTransition / sceneCarry (the head of app/script.jsx, as written).
   Nothing saved in a film depends on parseSlug: it is read by the Script view only, which this test also pins. The Art
   Room's location cards read sluglines with their own parseSlugline (app/locations.jsx), which this change leaves alone.
   node scripts/test-slug-hyphen-time.mjs */
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import vm from "node:vm";
const read = f=>readFileSync(new URL("../"+f, import.meta.url), "utf8");
let checks = 0, failed = 0;
const test = (name, fn)=>{ try{ fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String(e && e.stack || e).split("\n").slice(0,6).join("\n    ")); } };

const src = read("app/script.jsx");
const end = src.indexOf("/* AUTO-DRAFT:");
assert.ok(end>0, "the head of script.jsx ends where the auto-draft engine starts");
const box = { React:{ createElement:(t, p, ...kids)=>({ t, p, kids }), Fragment:"f" },
  chargeStr:v=> v>0 ? "+"+v : String(v) };
box.window = box; vm.createContext(box);
vm.runInContext(src.slice(0, end)+"\nwindow.parseSlug = parseSlug; window.sceneTransition = sceneTransition; window.sceneCarry = sceneCarry;",
  box, { filename:"app/script.jsx" });
const slug = (loc)=>{ const r = box.parseSlug(loc); return [r.intext, r.place, r.time]; };
const is = (loc, intext, place, time)=>assert.deepEqual(slug(loc), [intext, place, time], loc);

test("a hyphenated time of day stays whole: PRE-DAWN, MID-MORNING", ()=>{
  is("INT. NEWSROOM - PRE-DAWN", "INT", "NEWSROOM", "PRE-DAWN");
  is("EXT. PIER - MID-MORNING", "EXT", "PIER", "MID-MORNING");
  is("INT. DINER - LATE-NIGHT", "INT", "DINER", "LATE-NIGHT");
  is("INT/EXT. CAR - EARLY-MORNING", "INT/EXT", "CAR", "EARLY-MORNING");
});

test("an en dash, an em dash and the app's own middle dot, plain or with a hyphenated time", ()=>{
  is("INT. SHOP – NIGHT", "INT", "SHOP", "NIGHT");
  is("INT. NEWSROOM – PRE-DAWN", "INT", "NEWSROOM", "PRE-DAWN");
  is("EXT. PIER — MID-MORNING", "EXT", "PIER", "MID-MORNING");
  is("INT. HEART O' THE CITY HOTEL · NIGHT", "INT", "HEART O' THE CITY HOTEL", "NIGHT");
  is("INT. NEWSROOM · PRE-DAWN", "INT", "NEWSROOM", "PRE-DAWN");
});

test("a slug typed without spaces still reads: the old rule is the fallback", ()=>{
  is("INT. SHOP-DAWN", "INT", "SHOP", "DAWN");
  is("INT. SHOP–NIGHT", "INT", "SHOP", "NIGHT");
  is("EXT. ROOFTOP·DUSK", "EXT", "ROOFTOP", "DUSK");
});

test("a comma before the time, alone or after a dashed place", ()=>{
  is("EXT. BEACH, DAY", "EXT", "BEACH", "DAY");
  is("EXT. BEACH,NIGHT", "EXT", "BEACH", "NIGHT");
  is("EXT. PARIS - LEFT BANK, NIGHT", "EXT", "PARIS - LEFT BANK", "NIGHT");
  is("EXT. ROAD, TEXAS - DAY", "EXT", "ROAD, TEXAS", "DAY");
});

test("a hyphen that belongs to the place stays in the place", ()=>{
  is("INT. CO-OP - NIGHT", "INT", "CO-OP", "NIGHT");
  is("INT. CO-OP - PRE-DAWN", "INT", "CO-OP", "PRE-DAWN");
  is("INT. CO-OP", "INT", "CO-OP", "");
  is("EXT. DRIVE-IN – DUSK", "EXT", "DRIVE-IN", "DUSK");
});

test("what already read correctly still does", ()=>{
  is("INT. SHOP - DAWN", "INT", "SHOP", "DAWN");
  is("INT. HOUSE - KITCHEN - NIGHT", "INT", "HOUSE - KITCHEN", "NIGHT");
  is("INT. HOUSE - KITCHEN", "INT", "HOUSE - KITCHEN", "");
  is("INT. SHOP - MOMENTS LATER", "INT", "SHOP", "MOMENTS LATER");
  is("EXT. FIELD - MAGIC HOUR", "EXT", "FIELD", "MAGIC HOUR");
  is("INT. HALL - CONTINUOUS", "INT", "HALL", "CONTINUOUS");
  is("INT. THE CONSTRUCT", "INT", "THE CONSTRUCT", "");
  is("", "INT", "", "");
  assert.deepEqual(slug(undefined), ["INT", "", ""]);
});

test("the Script view's hinge names the place and the whole time", ()=>{
  const sc = (loc)=>({ act:1, loc, closeCharge:0, openCharge:0, closeValue:"", openValue:"" });
  const hard = box.sceneTransition(sc("INT. NEWSROOM - PRE-DAWN"), sc("EXT. PIER - PRE-DAWN"));
  assert.equal(hard.type, "HARD CUT");
  assert.equal(hard.gloss, "New location — PIER.");
  const time = box.sceneTransition(sc("INT. NEWSROOM - PRE-DAWN"), sc("EXT. PIER - MID-MORNING"));
  assert.equal(time.type, "TIME CUT");
  assert.equal(time.gloss, "Time moves: PRE-DAWN → MID-MORNING.");
  // the same room is the same room, whatever the hour is called
  assert.equal(box.sceneTransition(sc("INT. NEWSROOM - PRE-DAWN"), sc("INT. NEWSROOM - DAY")).type, "CONTINUOUS");
  assert.equal(box.sceneTransition(sc("INT. NEWSROOM - NIGHT"), sc("INT. NEWSROOM - DAY")).type, "CONTINUOUS");
});

test("the carry cells show Location NEWSROOM and Time PRE-DAWN", ()=>{
  const cells = box.sceneCarry(null, { loc:"INT. NEWSROOM - PRE-DAWN" }, {});
  assert.deepEqual(JSON.parse(JSON.stringify(cells)), [{ lab:"Location", val:"NEWSROOM" }, { lab:"Time", val:"PRE-DAWN" }]);
});

test("nothing saved depends on parseSlug: only the Script view's hinge and cells read it", ()=>{
  const files = readdirSync(new URL("../app/", import.meta.url)).filter(f=>/\.(jsx|js)$/.test(f));
  const users = files.filter(f=>/\bparseSlug\b(?!line)/.test(read("app/"+f)));
  assert.deepEqual(users, ["script.jsx"]);
  const calls = src.match(/\bparseSlug\(/g) || [];
  assert.equal(calls.length, 4, "the definition, two reads in sceneTransition's line, one in sceneCarry");
  assert.match(src, /const a = parseSlug\(prev\.loc\), b = parseSlug\(cur\.loc\);/);
  assert.match(src, /function sceneCarry\(prev, cur, project\)\{\s*const b = parseSlug\(cur\.loc\);/);
});

test("the page loads the new script.jsx (it shares ai.jsx's key)", ()=>{
  const html = read("TURN.html");
  for(const f of ["script", "ai"])
    assert.ok(["20261112-slug1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2"].some(k=>html.includes('src="app/'+f+'.jsx?v='+k+'"')), f+".jsx key");
});

console.log("\n"+checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
process.exit(failed ? 1 : 0);
