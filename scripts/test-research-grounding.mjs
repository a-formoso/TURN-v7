/* New Story research (2026-10-02, owner-approved items 1 and 4):
   4. the research call searches the web on an engine that can — the proxy holds the most the
      searches can cost (fee + the pages read as input), settles on the searches the provider
      reports, never searches for Frances or a non-Claude engine, and hands back the pages used;
      the review step shows those sources or says the Fact pillar was not checked.
   1. the whole research is saved with the film and read by the world build and the cast's
      inner-life pass (researchReservoir), and follows the brief it was gathered for. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSync } from "@babel/core";
import * as P from "../supabase/functions/image-proxy/billing-pricing.mjs";

const read = (f) => readFileSync(f, "utf8");
let checks = 0, failed = 0;
const test = async (name, f) => {
  try { await f(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name); console.log(e); }
};
const msgs = [{ role: "user", content: "Research this logline about Belfast in 2024." }];

/* ---- A. pricing ---- */
await test("A1 only Claude Opus 5 / 5.5 and Sonnet 5 / 5.5 search, on web_search_20260209", () => {
  for (const m of ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-sonnet-5"]) assert.equal(P.textWebSearchTool(m), "web_search_20260209", m);
  for (const m of ["claude-fable-5-1", "claude-haiku-4-5", "gpt-6-astra", "kimi-k3", "gemini-3.8-flash", "", "claude-opus-50"]) assert.equal(P.textWebSearchTool(m), "", m);
});

await test("A2 the hold adds each search's fee and the pages it reads, at the model's input rate", () => {
  const base = P.textHoldEstimate({ model: "claude-opus-5-5", messages: msgs, outputCap: 16000, unit: 0.01 });
  const searching = P.textHoldEstimate({ model: "claude-opus-5-5", messages: msgs, outputCap: 16000, webSearches: 5, unit: 0.01 });
  const rates = P.textRates("claude-opus-5-5");
  const extra = 5 * P.TEXT_WEB_SEARCH_USD + (5 * P.TEXT_WEB_SEARCH_INPUT_TOKENS * rates.input) / 1e6;
  assert.ok(Math.abs(searching.providerCostUsd - base.providerCostUsd - extra) < 1e-9);
  assert.ok(searching.credits > base.credits);
});

await test("A3 a small balance shrinks the answer, never the searches' share of the hold", () => {
  const full = P.textHoldEstimate({ model: "claude-opus-5-5", messages: msgs, outputCap: 32768, webSearches: 5, unit: 0.01 });
  const avail = full.credits - 20;
  const cap = P.affordableOutputCap({ model: "claude-opus-5-5", messages: msgs, wantedCap: 32768, minCap: 16000, availableCredits: avail, webSearches: 5, unit: 0.01 });
  assert.ok(cap >= 16000 && cap < 32768, String(cap));
  assert.ok(P.textHoldEstimate({ model: "claude-opus-5-5", messages: msgs, outputCap: cap, webSearches: 5, unit: 0.01 }).credits <= avail);
});

await test("A4 the settle bills the searches the provider reports", () => {
  const tokens = P.normaliseTextUsage("anthropic", { usage: { input_tokens: 30000, output_tokens: 3000, server_tool_use: { web_search_requests: 3 } } });
  assert.equal(tokens.webSearches, 3);
  const withSearch = P.textActualCost("claude-opus-5-5", tokens, { unit: 0.01 });
  const without = P.textActualCost("claude-opus-5-5", { ...tokens, webSearches: 0 }, { unit: 0.01 });
  assert.ok(Math.abs(withSearch.providerCostUsd - without.providerCostUsd - 0.03) < 1e-9);
  assert.equal(P.normaliseTextUsage("anthropic", { usage: { input_tokens: 1 } }).webSearches, 0);
  assert.equal(P.textActualCost("claude-opus-5-5", tokens, { free: true }).credits, 0, "a free call stays free");
});

/* ---- B. the proxy wiring ---- */
const proxy = read("supabase/functions/image-proxy/index.ts");
const textRoute = proxy.slice(proxy.indexOf('if (task === "text") {'), proxy.indexOf("// ── task: VOICE"));
await test("B1 search is asked for explicitly, only on Claude, never on Frances's free path", () => {
  assert.match(textRoute, /const searchTool = body\.webSearch === true && provider === "anthropic" && textKind !== "muse" \? textWebSearchTool\(model\) : "";/);
  assert.match(textRoute, /const est = \{ model: priceKey, messages, imageCount: images\.length, vision, promptCache, webSearches, unit \};/);
  assert.match(textRoute, /tools: \[\{ type: searchTool, name: "web_search", max_uses: TEXT_WEB_SEARCH_MAX_USES \}\]/);
});
await test("B2 a paused searching turn resumes once with the paused turn appended (no 'continue' message), usage summed", () => {
  assert.match(textRoute, /if \(data\.stop_reason === "pause_turn"\) \{\s*const r2 = await callClaude\(\[\.\.\.sendTurns, \{ role: "assistant", content: data\.content \|\| \[\] \}\]\);/);
  assert.match(textRoute, /usage\.server_tool_use = \{ web_search_requests:/);
  assert.doesNotMatch(textRoute, /content: "[Cc]ontinue/);
});
await test("B3 the reply says whether the engine could search and which pages it used", () => {
  assert.match(textRoute, /\{ webSearch: \{ available: true, searches \}, sources \}/);
  assert.match(textRoute, /if \(body\.webSearch === true && !\("webSearch" in extra\)\) extra = \{ \.\.\.extra, webSearch: \{ available: false, searches: 0 \} \};/);
  // the sources helper runs: cited pages first, then the other results, http(s) only, one per URL
  const src = proxy.slice(proxy.indexOf("function webSearchSources"), proxy.indexOf("\n}\n", proxy.indexOf("function webSearchSources")) + 2);
  const js = src.replace(/\(blocks: any\[\]\): \{ url: string; title: string; cited: boolean \}\[\]/, "(blocks)")
    .replace(/const out: \{ url: string; title: string; cited: boolean \}\[\] = \[\];/, "const out = [];")
    .replace(/new Set<string>\(\)/, "new Set()").replace(/\(url: any, title: any, cited: boolean\)/, "(url, title, cited)");
  const fn = new Function(js + "\nreturn webSearchSources;")();
  const out = fn([
    { type: "web_search_tool_result", content: [{ url: "https://a.example/1", title: "A" }, { url: "javascript:alert(1)", title: "x" }, { url: "https://b.example/2", title: "B" }] },
    { type: "text", text: "...", citations: [{ url: "https://b.example/2", title: "B" }] },
  ]);
  assert.deepEqual(out, [{ url: "https://b.example/2", title: "B", cited: true }, { url: "https://a.example/1", title: "A", cited: false }]);
});

/* ---- C. the app ---- */
const ai = read("app/ai.jsx"), ast = parseSync(ai, { sourceType: "script" });
const box = { console, URL }; box.window = box; vm.createContext(box);
vm.runInContext("function clipAtBoundary(s,n){ s=String(s||''); return s.length>n ? s.slice(0,n) : s; } function scrubBrand(s){ return String(s); }", box);
for (const n of ["normaliseResearch", "researchSources", "researchReservoir", "researchToKeep"]) {
  const node = ast.program.body.find((x) => x.type === "FunctionDeclaration" && x.id.name === n);
  assert.ok(node, "missing " + n); vm.runInContext(ai.slice(node.start, node.end), box);
}
const research = { memory: "The fear of losing your place.", imagination: "He reads case files at the kitchen island.",
  fact: { world: "Belfast, August 2024.", role: "A senior public prosecutor.", whatHappens: "Files of CCTV stills every morning.",
    howItFeels: "Holding the line and being the line.", frustrating: "Witnesses withdraw.", lovely: "A shop owner finally testifies." },
  grounded: true, sources: [{ url: "https://news.example/riots", title: "Riots", cited: true }] };

await test("C1 the research call asks for search and keeps the pages it used", () => {
  assert.match(ai, /webSearch:true, onMeta:\(m\)=>\{ searchMeta = m; \} \}\);/);
  assert.match(ai, /research\.grounded = !!\(searchMeta && searchMeta\.webSearch && Number\(searchMeta\.webSearch\.searches\)>0 && research\.sources\.length\);/);
  assert.match(ai, /\.\.\.\(opts\.webSearch \? \{ webSearch:true \} : \{\}\),/);
  const s = box.researchSources({ sources: [{ url: "https://www.bbc.example/x", title: "BBC", cited: true }, { url: "ftp://x", title: "no" }, { url: "https://www.bbc.example/x", title: "dup" }] });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), [{ url: "https://www.bbc.example/x", host: "bbc.example", title: "BBC", cited: true }]);
});

await test("C2 the world build gets the real world and role's work; the cast pass gets all three pillars", () => {
  const world = box.researchReservoir(research, "world");
  assert.match(world, /THE WORLD AS IT REALLY WORKS \(checked against the web\)/);
  assert.ok(world.includes("Belfast, August 2024.") && world.includes("Witnesses withdraw.") && !world.includes("kitchen island"));
  const cast = box.researchReservoir(research, "cast");
  for (const t of ["The fear of losing your place.", "kitchen island", "Holding the line", "A shop owner finally testifies.", "Witnesses withdraw."]) assert.ok(cast.includes(t), t);
  assert.equal(box.researchReservoir(null, "cast"), "");
  assert.match(box.researchReservoir({ ...research, grounded: false }, "cast"), /^RESEARCH RESERVOIR \u2014/);
});

await test("C3 the prompts read the reservoir: the world build, and the cast's inner life before the script", () => {
  // (2026-11-12, audit B7: the brief is read up to STORY_BRIEF_MAX, no longer 4,000)
  assert.ok(ai.includes('|| 12000)+"\\n"+((typeof researchReservoir==="function") ? researchReservoir(research,"world") : "")+"SCENES'));
  assert.ok(ai.includes('(mode==="before" && typeof researchReservoir==="function" ? researchReservoir(P.research,"cast") : "");'));
});

await test("C4 the film keeps its research, and it follows the brief it was gathered for", () => {
  const kept = JSON.parse(JSON.stringify(box.researchToKeep(research)));
  assert.equal(kept.grounded, true);
  assert.equal(kept.sources[0].host, "news.example");
  assert.equal(JSON.parse(JSON.stringify(box.researchToKeep({ ...research, grounded: false }))).sources.length, 0, "unchecked research keeps no sources");
  assert.equal(box.researchToKeep({ memory: "", fact: {} }), undefined, "nothing found is not research");
  const app = read("app/app.jsx"), agents = read("app/agents.jsx");
  assert.ok(app.includes('research: (typeof researchToKeep==="function") ? researchToKeep(synopsis && synopsis.research) : undefined,'));
  assert.ok(app.includes('(project && project.research && String(project.sourceBrief||"").trim()===String(b||"").trim()) ? project.research : null'));
  assert.ok(agents.includes('research: (base.research && String(base.sourceBrief||"").trim()===brief) ? base.research : undefined,'));
});

await test("C5 the review shows the sources, or says the Fact pillar was not checked", () => {
  const ns = read("app/newstory.jsx");
  assert.ok(ns.includes('"Checked against the web \\u00b7 sources"'));
  assert.ok(ns.includes('"From general knowledge \\u2014 not checked against the web. Verify real people, places and events before you rely on them."'));
  assert.ok(ns.includes('rel:"noopener noreferrer"'));
});

/* ---- D. items 2, 3 and 5 (owner 2026-10-02): every principal, two moments, the logline check ---- */
const D = { console, URL, JSON }; D.window = D; vm.createContext(D);
for (const n of ["extractJSON", "clipWords", "clipAtBoundary", "normaliseResearch", "researchBriefText", "researchSources",
  "researchReservoir", "researchToKeep", "aiResearch", "aiSynopsisFromResearch", "aiResearchSynopsis", "aiSeedToLoglines"]) {
  const node = ast.program.body.find((x) => x.type === "FunctionDeclaration" && x.id.name === n);
  assert.ok(node, "missing " + n); vm.runInContext(ai.slice(node.start, node.end), D);
}
vm.runInContext("function scrubBrand(s){ return String(s); } function aiAvailable(){ return true; } function formatPlanLine(){ return ''; }", D);
D.FORMATS = [{ id: "film", label: "Short Film" }]; D.FRAMEWORKS = [{ id: "threeact", label: "Three-Act Turns" }];
const sent = [];
const reply = (fn) => { D.claude = { complete: async (o) => { sent.push(o); return fn(o.messages[0].content, o); } }; };

await test("D1 every principal gets the Fact lenses; the protagonist's are mirrored for older readers", () => {
  const n = JSON.parse(JSON.stringify(D.normaliseResearch({ memory: "m", fact: { world: "w", roles: [
    { who: "Neil Harkness", role: "prosecutor", frustrating: "witnesses withdraw" },
    { who: "Niamh Doherty", role: "constable", lovely: "the night her street is quiet" },
    { who: "", role: "" }, { who: "a", role: "b" }, { who: "c", role: "d" }, { who: "e", role: "f" }] } })));
  assert.equal(n.fact.roles.length, 4, "empty roles dropped, at most four");
  assert.equal(n.fact.role, "prosecutor"); assert.equal(n.fact.frustrating, "witnesses withdraw");
  const old = JSON.parse(JSON.stringify(D.normaliseResearch({ fact: { world: "w", role: "nurse", lovely: "x" } })));
  assert.deepEqual(old.fact.roles.map((r) => r.role), ["nurse"], "a one-role reply becomes roles[0]");
  const brief = D.researchBriefText(n);
  assert.ok(brief.includes("FACT \u2014 Neil Harkness: role: prosecutor") && brief.includes("FACT \u2014 Niamh Doherty: role: constable"), brief);
  const cast = D.researchReservoir(n, "cast");
  assert.ok(cast.includes("Niamh Doherty \u2014 role: constable") && cast.includes("the night her street is quiet"), cast);
  assert.ok(D.researchReservoir({ ...n, grounded: true, edited: true }, "world").includes("(checked against the web, then edited by the writer)"));
  assert.equal(JSON.parse(JSON.stringify(D.researchToKeep({ ...n, edited: true }))).edited, true);
});

await test("D2 research is its own call: it asks for every principal, carries the writer's steer, and searches", async () => {
  reply(() => JSON.stringify({ title: "Locals Only", research: { memory: "m", imagination: "i", fact: { world: "Belfast", roles: [{ who: "Neil", role: "prosecutor" }, { who: "Niamh", role: "constable" }] } } }));
  sent.length = 0;
  const r = await D.aiResearch("A prosecutor and a constable in riot summer.", "", "threeact", "film", "go deeper on the officer");
  const p = sent[0].messages[0].content;
  assert.ok(p.includes("for EACH PRINCIPAL character") && p.includes("THE WRITER'S STEER FOR THIS RESEARCH (follow it):\ngo deeper on the officer"), p.slice(0, 400));
  assert.equal(sent[0].webSearch, true);
  assert.equal(r.title, "Locals Only");
  assert.deepEqual(JSON.parse(JSON.stringify(r.research.fact.roles.map((x) => x.who))), ["Neil", "Niamh"]);
  assert.equal(sent.length, 1, "no synopsis call yet");
  reply(() => "not json"); assert.equal(await D.aiResearch("x", "", "threeact", "film"), null);
  reply(() => { throw new Error("billing: add credits"); });
  await assert.rejects(D.aiResearch("x", "", "threeact", "film"), /add credits/, "a provider error reaches the screen");
});

await test("D3 the synopsis is written from the research as the writer edited it", async () => {
  reply((c) => /write the SYNOPSIS/.test(c) ? JSON.stringify({ synopsis: { setup: "a", confrontation: "b", resolution: "c" } }) : "{}");
  sent.length = 0;
  const edited = D.normaliseResearch({ memory: "EDITED MEMORY", fact: { world: "Derry, 1969", roles: [{ who: "Niamh", role: "constable" }] } });
  const s = await D.aiSynopsisFromResearch("A constable in riot summer.", "", "threeact", "film", edited);
  const p = sent[0].messages[0].content;
  assert.ok(p.includes("EDITED MEMORY") && p.includes("Derry, 1969") && p.includes("FACT \u2014 Niamh: role: constable"));
  assert.deepEqual(JSON.parse(JSON.stringify(s.paras.map((x) => x.text))), ["a", "b", "c"]);
  assert.equal(sent.length, 1, "no research call");
  assert.equal(s.setup, "a", "legacy keys ride along");
});

await test("D4 the logline check rides in the logline call, for the writer's own logline only", async () => {
  reply(() => JSON.stringify({ loglines: ["One", "Two", "Three"].map((x) => x + " sharpened logline about a constable in Belfast."),
    check: { protagonist: false, want: false, obstacle: true } }));
  sent.length = 0;
  const outs = await D.aiSeedToLoglines("logline", "Tension rises and people hate each other.");
  assert.ok(sent[0].messages[0].content.includes("ALSO check the WRITER'S OWN logline exactly as written"));
  assert.deepEqual(JSON.parse(JSON.stringify(outs.check)), { missing: ["protagonist", "want"] });
  reply(() => JSON.stringify({ loglines: ["A long enough logline about a nurse and a secret."], check: { protagonist: true, want: true, obstacle: true } }));
  assert.equal((await D.aiSeedToLoglines("logline", "A nurse hides a secret.")).check, undefined, "a complete logline: no note");
  sent.length = 0;
  reply(() => JSON.stringify({ loglines: ["A long enough logline about a nurse and a secret."], check: { protagonist: false } }));
  const w = await D.aiSeedToLoglines("whatif", "What if nurses could read minds?");
  assert.ok(!sent[0].messages[0].content.includes("ALSO check"), "other seeds aren't the writer's logline");
  assert.equal(w.check, undefined);
});

const ns = read("app/newstory.jsx"), nsAst = parseSync(ns, { sourceType: "script", presets: ["@babel/preset-react"] });
await test("D5 the logline note names what's missing, points to the sharpened versions, and never blocks", () => {
  const N = {}; vm.createContext(N);
  for (const n of ["NS_CHECK_PARTS", "nsLoglineCheckText"]) {
    const node = nsAst.program.body.find((x) => (x.type === "FunctionDeclaration" && x.id.name === n) || (x.type === "VariableDeclaration" && x.declarations[0].id.name === n));
    vm.runInContext(ns.slice(node.start, node.end).replace(/^const /, "var "), N);
  }
  assert.equal(N.nsLoglineCheckText(["protagonist", "want"]),
    "Your logline doesn\u2019t yet name one protagonist the story follows or what they want. The spine builds best from one protagonist with a clear want and something in their way \u2014 the sharpened versions below each have all three. You can still build from yours.");
  assert.ok(N.nsLoglineCheckText(["protagonist", "want", "obstacle"]).includes("one protagonist the story follows, what they want or what stands in their way"));
  assert.equal(N.nsLoglineCheckText([]), "");
  // shown only while the chosen logline is still the writer's own words
  assert.ok(ns.includes("loglineCheck && nsNorm(chosen)===nsNorm(loglineCheck.text) && React.createElement(\"div\",{className:\"ns-loglinecheck\",role:\"note\"}"));
});

await test("D6 the flow: Logline \u2192 Research (edit, steer) \u2192 Synopsis (written from it, rewritable)", () => {
  assert.ok(/\{ id:"loglines", label:"Logline" \},\s*\{ id:"research", label:"Research" \},[^\n]*\n\s*\{ id:"synopsis", label:"Synopsis" \},/.test(ns));
  // (2026-11-12, audit B12: both calls also carry the Show's cast when New Story builds an episode)
  assert.ok(ns.includes('await aiResearch(l, text, frameworkRef.current, formatRef.current, again ? steer : "", showCanon)'));
  assert.ok(ns.includes("await aiSynopsisFromResearch(l, text, frameworkRef.current, formatRef.current, research, showCanon)"));
  assert.ok(ns.includes('"Rewrite synopsis from research"') && ns.includes('"Research again"') && ns.includes('"Write synopsis"'));
  assert.ok(ns.includes("The research has changed since this synopsis was written"));
  // the edited research is what the film keeps
  assert.ok(ns.includes("...(researchEdited ? { edited:true } : {})") && ns.includes("...(kept ? { research:kept } : {})"));
  assert.ok(!/aiResearchSynopsis\(/.test(ns), "the intake no longer runs both at once");
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
