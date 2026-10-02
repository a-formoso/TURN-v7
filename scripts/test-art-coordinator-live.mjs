/* Art Room fixes 3 and 4 (owner 2026-10-02):
   3. the Art Coordinator works each step from the film as it is NOW — it asks its context for a
      fresh one (built after the previous step's writes are committed) before every step after
      the first, instead of running all seven from the run-start snapshot;
   4. an Art Room run belongs to the film it started in: after a film switch it is cancelled,
      every state write still in flight is refused (and said once), and a refresh returns null.
   The Coordinator runs for real here with recording stand-ins for its seven steps; the context
   factory (deep inside App) is checked in its source, including a scan for unguarded writes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSync } from "@babel/core";

const read = (f) => readFileSync(f, "utf8");
let checks = 0, failed = 0;
const test = async (name, f) => {
  try { await f(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name); console.log(e); }
};

/* ---- 3. the Coordinator ---- */
const agents = read("app/agents.jsx"), ast = parseSync(agents, { sourceType: "script", presets: ["@babel/preset-react"] });
const node = ast.program.body.find((x) => x.type === "FunctionDeclaration" && x.id.name === "agentDepartmentCoordinator");
const STEPS = ["agentVisualResearcher", "agentCastingDirector", "agentPropsMaster", "agentWearProps", "agentLocationScout", "agentColorist", "agentShotDesigner"];
function harness({ refreshNullAt = -1, cancelAt = -1 } = {}) {
  const box = { console }; box.window = box; vm.createContext(box);
  const seen = [], log = [];
  let cancelled = false;
  STEPS.forEach((n, i) => {
    box[n] = async (c) => {
      seen.push({ step: i, film: c.film, gen: c.gen, autoApprove: c.autoApprove, approved: await c.propose({}) });
      c.emit({ k: "done", t: n + " done" });
      if (i === cancelAt) cancelled = true;
    };
  });
  vm.runInContext(agents.slice(node.start, node.end), box);
  let gen = 0;
  const make = () => ({
    film: "film-a", gen: gen++, emit: (e) => log.push(e), propose: async () => false,
    cancelled: () => cancelled,
    refresh: async () => (gen === refreshNullAt ? null : make()),
  });
  return { box, seen, log, ctx: make() };
}

await test("3a every step after the first gets a fresh context; the first uses the run's own", async () => {
  const h = harness();
  await h.box.agentDepartmentCoordinator(h.ctx);
  assert.deepEqual(h.seen.map((x) => x.step), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(h.seen.map((x) => x.gen), [0, 1, 2, 3, 4, 5, 6], "a new context per step");
  assert.ok(h.seen.every((x) => x.autoApprove === true && x.approved === true), "still hands-off");
  assert.equal(h.log.filter((e) => e.k === "done").length, 1, "only the Coordinator says done");
  assert.equal(h.log.at(-1).k, "done");
});

await test("3b a refresh that says the film was switched stops the run there", async () => {
  const h = harness({ refreshNullAt: 3 });   // the 3rd refresh (before step 4) finds another film open
  await h.box.agentDepartmentCoordinator(h.ctx);
  assert.deepEqual(h.seen.map((x) => x.step), [0, 1, 2]);
  assert.match(h.log.at(-1).t, /Stopped — completed 3 of 7 steps \(the film was switched\)/);
  assert.equal(h.log.filter((e) => e.k === "done").length, 0);
});

await test("3c stopping still works, and a step's context also reads the run's stop button", async () => {
  const h = harness({ cancelAt: 1 });
  await h.box.agentDepartmentCoordinator(h.ctx);
  assert.deepEqual(h.seen.map((x) => x.step), [0, 1]);
  assert.match(h.log.at(-1).t, /Stopped — completed 2 of 7 steps\./);
  assert.match(agents, /cancelled:\(\)=> ctx\.cancelled\(\) \|\| \(typeof base\.cancelled==="function" && base\.cancelled\(\)\),/);
});

await test("3d a context without refresh (an older caller) runs every step on itself", async () => {
  const h = harness(); delete h.ctx.refresh;
  await h.box.agentDepartmentCoordinator(h.ctx);
  assert.deepEqual(h.seen.map((x) => x.gen), [0, 0, 0, 0, 0, 0, 0]);
});

/* ---- 4. the context factory ---- */
const app = read("app/app.jsx");
const fa = app.indexOf("  const artAgentCtxFactory = ({ input, emit, propose, cancelled, agentName, force, owner, run:runIn })=>{");
const fb = app.indexOf("  const artAgentCtxFactoryRef = React.useRef(null);");
const factory = app.slice(fa, fb);
await test("4a the run keeps the film it started in, and a refreshed context keeps it too", () => {
  assert.ok(fa > 0 && fb > fa);
  assert.ok(factory.includes("const ownerProjectId = owner!==undefined ? owner : currentProjectId;"));
  assert.ok(factory.includes('const switchedFilms = ()=> String(ownerProjectId||"") !== String(projIdRef.current||"");'));
  assert.ok(factory.includes("const ctxArgs = { input, emit, propose, cancelled, agentName, force, owner:ownerProjectId, run };"));
  assert.ok(factory.includes("cancelled: ()=> cancelled() || switchedFilms(),"));
  assert.match(factory, /refresh: async \(\)=>\{\s*if\(switchedFilms\(\)\) return null;\s*await artNextCommit\(\);\s*const mk = artAgentCtxFactoryRef\.current \|\| artAgentCtxFactory;\s*return switchedFilms\(\) \? null : mk\(ctxArgs\);/);
});

await test("4b after a switch every write is refused, and said once", () => {
  assert.match(factory, /const inFilm = \(fn\)=> \(\.\.\.args\)=>\{\s*if\(switchedFilms\(\)\)\{\s*if\(!_switchFlagged\)\{ _switchFlagged = true;/);
  // run the guard itself: once switched, nothing is called and one flag is emitted
  const g = factory.slice(factory.indexOf("let _switchFlagged"), factory.indexOf("const _w = {"));
  const flags = [], calls = [];
  const proj = { current: "film-a" };
  // (no propose function: a background-style context, so the Art undo snapshot stays out of it)
  const make = new Function("emit", "projIdRef", "ownerProjectId", "runIn", "propose", "artUndoLiveRef", "agentFilmKey", "agentName", "setArtUndo",
    "const switchedFilms = ()=> String(ownerProjectId||\"\") !== String(projIdRef.current||\"\");\n" + g + "\nreturn inFilm;");
  const inFilm = make((e) => flags.push(e), proj, "film-a", undefined, undefined, { current: null }, () => "film-a", "Test", () => {});
  const setProps = inFilm((v) => calls.push(v));
  setProps(1);
  proj.current = "film-b";
  setProps(2); setProps(3);
  assert.deepEqual(calls, [1]);
  assert.equal(flags.length, 1);
  assert.match(flags[0].t, /You switched films while this ran, so it stopped/);
});

await test("4c no state write in the context goes around the guard", () => {
  const after = factory.slice(factory.indexOf("    const _w = {"));
  const guarded = after.slice(0, after.indexOf("    };\n") + 7);
  for (const n of ["setProps", "setPropsSeeded", "setLocations", "setLocsSeeded", "setLookbook", "setLookbookNote", "setCharacters",
    "updateCharacter", "commitBeatKeyframes", "applyStyleResult", "markApplied"]) assert.ok(guarded.includes(n + ":inFilm(" + n + ")"), n);
  const rest = after.slice(guarded.length);
  const bare = rest.match(/(^|[^_.A-Za-z$])(set[A-Z]\w*|update[A-Z]\w*|apply[A-Z]\w*)\(/g) || [];
  assert.deepEqual(bare, [], "every write goes through _w (the guarded setters)");
});

await test("4d the next-commit wait resolves after React commits, with a fallback", () => {
  assert.ok(app.includes("React.useEffect(()=>{ const w = artCommitWaitersRef.current.splice(0); w.forEach(f=>{ try{ f(); }catch(e){} }); });"));
  assert.ok(app.includes("artCommitWaitersRef.current.push(fin); setArtCommitTick(t=>t+1); setTimeout(fin, 1000);"));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
