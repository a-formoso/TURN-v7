#!/usr/bin/env node
/* test-brand-guard.mjs — the Kinolot rebrand GUARD (owner decisions 2026-09-28).

   Fails when user-facing text says a name the owner retired:
     • "TURN" as the product (TURN is the internal codename only; the craft verb in MODEL
       prompts — "each scene must TURN its value" — may stay),
     • "Cinema Machine" (the old product name; the product is Kinolot),
     • "MUSE" as the assistant's name (the assistant is Frances; the writing actions carry
       no persona),
     • "Consistency Check", "Continuity Repair", "Art Department Coordinator" (now Script
       Supervisor, Setups & Payoffs, Art Coordinator),
     • "Infinite Studio" not followed by " AI" (the company is always "Infinite Studio AI"),
   plus two display rules of decision 4: one apostrophe style ("Writers' Room", straight) and
   the top plan shown as "Producer" (never "Studio plan").

   What is scanned (the surfaces users — or the models and the assistant — see):
     A. every string literal, template-literal chunk and JSX text in app/*.jsx and app/*.js
        (React text children, title / aria-label / placeholder attributes, toasts, confirms,
        alerts, banners, errors, prompts, export templates are all such literals), in serve.js,
        and in every Supabase Edge Function source (their error text reaches the page). Comments,
        identifiers and regex literals are never user-facing, so they are not read.
     B. what Frances actually receives, built at runtime by the REAL app/ai.jsx in node:vm:
        APP_FEATURES, museFacts(), museSystemPrompt() and museBrief() (so a name glued together
        by concatenation is caught too).
     C. TURN.html (title, meta description, og: tags, page text), privacy.html and terms.html.
     D. the screenplay / outline / CSV export templates, run for real (app/export.jsx): they
        credit the writer and never the company, and carry no retired name.
     E. the display-time mappings that must still MENTION the old names (stored data is never
        migrated — decision 6): each one really turns an old saved label into today's name.
     F. the guard bites: synthetic leaks of every kind are flagged; allowlisted internals are not.
     G. the Blender add-on (blender/cinema_machine_bridge/*.py): every Python string literal —
        panel labels, tooltips, reports, errors, property names, and the names of the scenes,
        worlds, collections, objects and materials a proof render or a Studio workspace adds to the
        user's .blend file — says no retired name and uses no "CM " data-name prefix.

   ALLOWLIST (below, each entry commented): internal identifiers that must keep an old name.
   Identifiers such as TURN.html, TURN_* globals, turn_* tables, the turn-assets bucket,
   localStorage keys and file names (app/muse.jsx, docs/MUSE Protocol.md) never trip the scan in
   the first place: "TURN_" / "MUSE_" are one word to \b, lower-case keys are not the name, file
   names are not string literals shown to users. The allowlist therefore only needs the few
   literals below, and every entry must still match something — a stale entry fails too.

   BRAND_GUARD_ROOT=<dir> runs the same checks against a copy of the repo (used to prove the
   guard fails on a reintroduced leak without touching the real files).

   node scripts/test-brand-guard.mjs */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.BRAND_GUARD_ROOT ? resolve(process.env.BRAND_GUARD_ROOT) : join(HERE, "..");
const require = createRequire(join(HERE, "..", "package.json"));   // tooling always from this checkout
const babel = require("@babel/core");
const PRESET_REACT = require.resolve("@babel/preset-react");

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if(cond){ pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra!==undefined ? "\n     "+JSON.stringify(extra, null, 1).slice(0, 2400) : ""); }
}
function safely(name, fn){ try{ fn(); }catch(e){ ok(name, false, String((e && e.stack) || e).split("\n").slice(0, 5).join(" | ")); } }
const read = (f)=>readFileSync(join(ROOT, f), "utf8");

/* ───────────────────────── the rules ───────────────────────── */
const RULES = [
  { id:"TURN",    what:"the internal codename TURN shown as the product", re:/\bTURN\b/ },
  { id:"CINEMA",  what:"the old product name Cinema Machine",             re:/cinema[\s_-]?machine/i },
  { id:"MUSE",    what:"MUSE as the assistant's name (she is Frances)",   re:/\bMUSE\b|\bMuse\b/ },
  { id:"AGENT",   what:"a retired Story Editor / Department Head name",   re:/Consistency Check|Continuity Repair|Art Department Coordinator/ },
  { id:"COMPANY", what:"'Infinite Studio' without ' AI' (or the credit line with a comma)", re:/Infinite Studio(?! AI)|Kinolot, by Infinite Studio AI/ },
  { id:"ROOM",    what:"a curly or missing apostrophe in Writers' Room",  re:/Writers’ Room|Writers Room\b|Writer's Room/ },
  { id:"PLAN",    what:"the top plan shown as 'Studio' (it is Producer)", re:/\bStudio plan\b/ },
];

/* The craft VERB, not the product (decision 5: "The method's verb in MODEL prompts may stay").
   Only these phrasings, and only in the files that hold the method's prompts / the method
   facts — a bare "TURN" anywhere else is still a leak. */
const CRAFT_TURN_FILES = new Set(["app/ai.jsx", "app/frameworks.jsx", "runtime:ai.jsx"]);
const CRAFT_TURN = [
  // whole craft phrases only (review, 2026-09-28): a bare "to TURN" is NOT excused — "Welcome to
  // TURN", "Sign in to TURN" are the product name, whatever file they sit in
  /\bmust TURN (?:a|its) value\b/g,             // "each scene must TURN its value", "every scene must TURN a value"
  /\bmake it TURN\b/g,                          // the Story Doctor's "Propose how to make it TURN"
  /\bTHE TURN LIVES IN RHYTHM\b/g,              // prose-rhythm rule in the drafting prompt
  /\bthe TURN carried by prose rhythm\b/g,      // the same rule as Frances's fact states it
  /(?:^|\s)NO-TURN\b/g,                         // the spine digest's per-scene flag for the model
];
function stripCraft(file, text){
  if(!CRAFT_TURN_FILES.has(file)) return text;
  let t = text; for(const re of CRAFT_TURN) t = t.replace(re, " ");
  return t;
}

/* ALLOWLIST — internal literals that must keep an old name. { file, rule, text, why }:
   `text` must equal the literal exactly (no substring slack), and each entry must be used. */
const ALLOW = [
  // dev-console tags, never shown on the page (console.warn prefixes)
  { file:"app/app.jsx",   rule:"TURN", text:"[TURN] save conflict:", why:"dev-console tag" },
  { file:"app/cloud.jsx", rule:"TURN", text:"[TURN storage] ",      why:"dev-console tag" },
  // the admin Storage page matches the SERVER's status key as the server writes it, and shows it
  // as "outside the Kinolot asset layout" (serverText / OUTSIDE_LAYOUT; section E proves the mapping)
  { file:"app/admin-storage.jsx", rule:"TURN", text:"outside the TURN asset layout", why:"server status key, renamed when shown" },
  // …and the server that writes it (admin-only, needs a deploy to change; the page renames it)
  { file:"supabase/functions/admin-storage/core.mjs", rule:"TURN", text:"outside the TURN asset layout", why:"server status key (admin-only), renamed when shown" },
  { file:"supabase/functions/admin-storage/core.mjs", rule:"TURN", text:"path outside the TURN asset layout; review by hand", why:"server detail text (admin-only), renamed when shown", count:2 },
  // the signed-out teaser still UNDERSTANDS a visitor who types the old name (input matcher, never shown)
  { file:"app/muse.jsx",  rule:"CINEMA", text:"cinema machine", why:"visitor input keyword" },
  // legacy hosts keep working (decision 1): hostnames, never shown
  { file:"app/plans.jsx", rule:"CINEMA", text:"cinema-machine.replit.app", why:"legacy host (LIVE_HOSTS)" },
  { file:"app/plans.jsx", rule:"CINEMA", text:"cinemamachine.ai",          why:"legacy host (LIVE_HOSTS)" },
  // the add-on bundle's own filename (an id the download checks); the SAVED file is kinolot-blender.zip
  { file:"app/blender-preview-ui.jsx", rule:"CINEMA", text:"cinema-machine-blender.zip", why:"packaged bundle id" },
  // the dev server serves the packaged path (the saved name is Kinolot's) and logs to the terminal
  { file:"serve.js", rule:"CINEMA", text:"/app/downloads/cinema-machine-blender.zip", why:"packaged path" },
  { file:"serve.js", rule:"TURN",   text:"TURN serving on port ", why:"dev-server terminal log" },
  // the dev entry file's NAME (users get "/", served from TURN.html; the build writes dist/index.html)
  { file:"serve.js", rule:"TURN",   text:"TURN.html",  why:"file name" },
  { file:"serve.js", rule:"TURN",   text:"/TURN.html", why:"file name" },
  // Stripe product metadata: the webhook grants credits only for products with app="kinolot" or the
  // pre-rebrand app="cinema-machine" (plan-metadata.mjs, 2026-09-29) — an internal id, never shown.
  { file:"supabase/functions/stripe-webhook/plan-metadata.mjs", rule:"CINEMA", text:"cinema-machine", why:"Stripe metadata id (pre-rebrand products; kinolot is the new label, 2026-09-29)", count:1 },
  // a key-derivation namespace for the Blender relay's stored state — changing it orphans saved state
  { file:"supabase/functions/blender-bridge/relay-core.mjs", rule:"CINEMA", text:"cinema-machine/blender-bridge/state-key/v1", why:"crypto namespace id" },
  // server-side reasons for the free-assistant check: logged, never returned to the page
  { file:"supabase/functions/image-proxy/muse-billing.mjs", rule:"MUSE", text:"not MUSE's model",               why:"internal reason, never sent" },
  { file:"supabase/functions/image-proxy/muse-billing.mjs", rule:"MUSE", text:"over MUSE's input size",         why:"internal reason, never sent" },
  { file:"supabase/functions/image-proxy/muse-billing.mjs", rule:"MUSE", text:"over today's free MUSE allowance", why:"internal reason, never sent" },
  // the price-watch fetches vendors' public pricing pages with this User-Agent (never shown to users)
  { file:"supabase/functions/pricing-watch/index.ts", rule:"CINEMA", text:"Mozilla/5.0 (compatible; CinemaMachine-PricingWatch/1.0; admin price audit)", why:"outbound User-Agent" },
];
/* Files not scanned in A, and why. */
const SKIP_FILES = new Set([
  "app/blender-addon-data.js",   // GENERATED: the add-on ZIP as base64 + its packaged filename (test-rebrand-shell checks it)
]);

/* ───────────────────────── A. literals in source ───────────────────────── */
function parseFile(f, src){
  const ts = f.endsWith(".ts");
  return babel.parseSync(src, { filename:f, babelrc:false, configFile:false,
    sourceType: (ts || f.endsWith(".mjs") || /\bimport\s|\bexport\s/.test(src) && f.startsWith("supabase/")) ? "module" : "script",
    presets: ts ? [] : [PRESET_REACT], parserOpts: ts ? { plugins:["typescript"] } : {} });
}
function literalsOf(f, src){
  const out = [];
  const ast = parseFile(f, src);
  babel.traverse(ast, { enter(p){
    const n = p.node; let t = null;
    if(n.type==="StringLiteral") t = n.value;
    else if(n.type==="TemplateElement") t = n.value.cooked;
    else if(n.type==="JSXText") t = n.value;
    if(t!=null && t.trim()) out.push({ text:t, line:n.loc ? n.loc.start.line : 0 });
  }});
  return out;
}
const allowUsed = new Map(ALLOW.map((a,i)=>[i, 0]));
function isAllowed(file, rule, text){
  const i = ALLOW.findIndex(a=>a.file===file && a.rule===rule && a.text===text);
  if(i<0) return false;
  allowUsed.set(i, allowUsed.get(i)+1);
  return true;
}
/* the hits in one piece of text: [{ rule, snippet }] */
function hitsIn(file, text){
  const hits = [];
  for(const r of RULES){
    const t = r.id==="TURN" ? stripCraft(file, text) : text;
    const m = r.re.exec(t);
    if(m) hits.push({ rule:r.id, what:r.what, snippet:t.slice(Math.max(0, m.index-50), m.index+70).replace(/\s+/g, " ") });
  }
  return hits;
}
function scanSource(file, src){
  const found = [];
  for(const { text, line } of literalsOf(file, src))
    for(const h of hitsIn(file, text))
      if(!isAllowed(file, h.rule, text)) found.push(file+":"+line+" ["+h.rule+"] "+h.snippet);
  return found;
}
function listFiles(dir, test){
  const out = [];
  if(!existsSync(join(ROOT, dir))) return out;
  for(const name of readdirSync(join(ROOT, dir))){
    const rel = dir+"/"+name, abs = join(ROOT, rel);
    if(statSync(abs).isDirectory()){ if(name!=="node_modules") out.push(...listFiles(rel, test)); }
    else if(test(rel)) out.push(rel);
  }
  return out.sort();
}
const APP_FILES = listFiles("app", f=>/^app\/[^/]+\.(jsx|js)$/.test(f) && !SKIP_FILES.has(f));
const FN_FILES = listFiles("supabase/functions", f=>/\.(ts|mjs|js)$/.test(f) && !/(^|\/)(tests?|__tests__)\/|\.test\.(ts|mjs|js)$/.test(f));
const SCAN = [...APP_FILES, "serve.js", ...FN_FILES].filter(f=>existsSync(join(ROOT, f)));

safely("A scan", ()=>{
  ok("A the scan covers the whole app (every app/*.jsx|js), serve.js and the Edge Functions (.ts, .mjs and .js)",
    APP_FILES.length>=70 && FN_FILES.some(f=>f==="supabase/functions/image-proxy/index.ts") && FN_FILES.some(f=>f==="supabase/functions/blender-bridge/shared-contract.js"),
    { app:APP_FILES.length, functions:FN_FILES.length });
  const perRule = {};
  for(const f of SCAN){
    let found;
    try{ found = scanSource(f, read(f)); }
    catch(e){ ok("A "+f+" parses", false, e.message); continue; }
    for(const line of found){ const r = /\[(\w+)\]/.exec(line)[1]; (perRule[r] = perRule[r] || []).push(line); }
  }
  for(const r of RULES) ok("A no user-facing literal says "+r.what, !(perRule[r.id]||[]).length, perRule[r.id]);
});

/* ───────────────────────── B. what Frances receives (runtime) ───────────────────────── */
function aiSandbox(){
  const noop = ()=>{};
  const store = new Map();
  const box = {
    console:{ ...console, warn:noop, info:noop, log:noop }, setTimeout:(f)=>setTimeout(f, 0), clearTimeout, setInterval, clearInterval,
    React:new Proxy({ createElement:(t,p,...c)=>({ t, p, c }), useState:(x)=>[x, noop], useRef:(x)=>({ current:x }), useEffect:noop, useMemo:(f)=>f() }, { get:(t,k)=> (k in t) ? t[k] : noop }),
    localStorage:{ getItem:(k)=>store.has(k) ? store.get(k) : null, setItem:(k,v)=>store.set(k, String(v)), removeItem:(k)=>store.delete(k) },
    sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
    navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"", hostname:"localhost" },
    CustomEvent:class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
    document:{ createElement:()=>({ style:{}, setAttribute:noop, appendChild:noop }), getElementById:()=>null, addEventListener:noop,
      removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
    addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, requestAnimationFrame:noop,
    matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
    fetch:()=>{ throw new Error("network disabled in the brand guard"); },
    claude:{ complete: async ()=>"" },
  };
  box.window = box; box.globalThis = box; box.self = box;
  vm.createContext(box);
  for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/ai.jsx"])
    vm.runInContext(read(f), box, { filename:f });
  return box;
}
function runtimeHits(label, text){
  return hitsIn("runtime:ai.jsx", text).map(h=>label+" ["+h.rule+"] "+h.snippet);
}
safely("B runtime", ()=>{
  const box = aiSandbox();
  const F = box.APP_FEATURES;
  ok("B APP_FEATURES loads", Array.isArray(F) && F.length>50, F && F.length);
  const manifest = [];
  F.forEach(f=>{ manifest.push(...runtimeHits("APP_FEATURES « "+f.name+" »", [f.name, f.what, f.muse||""].join(" \n "))); });
  ok("B APP_FEATURES (the manifest Frances answers from) says no retired name", !manifest.length, manifest);
  const facts = [];
  box.museFacts().forEach(f=>facts.push(...runtimeHits("museFacts « "+f.name+" »", f.name+" \n "+f.what)));
  ok("B museFacts() (what actually reaches Frances) says no retired name", !facts.length, facts);
  const qs = ["What is this app?", "How do the Story Editors work?", "Who are you?", "How do I export my screenplay?", "What plan do I need for 4K?"];
  const prompts = [];
  qs.forEach(q=>{
    const p = box.museSystemPrompt({ now:q }, null);
    prompts.push(...runtimeHits("museSystemPrompt(\""+q+"\")", p));
    prompts.push(...runtimeHits("museBrief(\""+q+"\")", box.museBrief(q, null)));
  });
  ok("B museSystemPrompt() and museBrief() say no retired name", !prompts.length, [...new Set(prompts)]);
  const p = box.museSystemPrompt({ now:"hi" }, null);
  ok("B …and name today's identity: Frances, inside Kinolot by Infinite Studio AI, the Infinite Studio AI method",
    /You are Frances\b/.test(p) && p.includes("Kinolot by Infinite Studio AI") && p.includes("Infinite Studio AI method"));
});

/* ───────────────────────── C. the HTML pages ───────────────────────── */
function pageText(html){
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&mdash;/g, "—").replace(/&rsquo;/g, "’")
    .replace(/&#(\d+);/g, (m, n)=>String.fromCharCode(+n)).replace(/\s+/g, " ");
}
safely("C pages", ()=>{
  for(const f of ["TURN.html", "privacy.html", "terms.html"]){
    const html = read(f);
    const title = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "";
    const metas = [...html.matchAll(/<meta\s+(?:name|property)="(description|og:[\w:]+|twitter:[\w:]+)"\s+content="([^"]*)"/gi)].map(m=>m[1]+": "+m[2]);
    const hits = [...hitsIn(f, title).map(h=>"title ["+h.rule+"] "+h.snippet),
      ...metas.flatMap(m=>hitsIn(f, m).map(h=>"meta ["+h.rule+"] "+h.snippet)),
      ...hitsIn(f, pageText(html)).map(h=>"text ["+h.rule+"] "+h.snippet)];
    ok("C "+f+": title, meta / og: tags and page text say no retired name", !hits.length, hits);
    ok("C "+f+": the page names Kinolot in its title", /Kinolot/.test(title), title);
  }
  const main = read("TURN.html");
  ok("C TURN.html carries a description and share tags that name Kinolot by Infinite Studio AI",
    /<meta name="description" content="Kinolot by Infinite Studio AI[^"]*"/.test(main) && /<meta property="og:title" content="Kinolot[^"]*"/.test(main));
});

/* ───────────────────────── D. export templates, run ───────────────────────── */
safely("D exports", ()=>{
  const src = babel.transformSync(read("app/export.jsx"), { filename:"export.jsx", babelrc:false, configFile:false, presets:[PRESET_REACT] }).code;
  const win = { FORMATS:[], FRAMEWORKS:[] };
  const box = { window:win, React:{ createElement:()=>null }, document:{ createElement:()=>({ style:{} }) }, console, Blob:class{}, URL:{ createObjectURL:()=>"" } };
  box.window = Object.assign(win, box);
  vm.createContext(box);
  vm.runInContext(src, box, { filename:"app/export.jsx" });
  const scenes = [{ id:"s1", no:1, title:"The Offer", loc:"INT. HOTEL - NIGHT", summary:"Neo is offered a choice.", act:1 }];
  const drafts = { s1:{ blocks:[{ type:"scene", text:"INT. HOTEL - NIGHT" }, { type:"action", text:"Rain on glass." }, { type:"char", text:"MORPHEUS" }, { type:"dia", text:"Choose." }] } };
  const outputs = (project, who, film=null)=>{ box.window.turnUserDisplayName = who; box.window.turnOpenFilmCredit = film;
    return { fountain:box.buildFountain(project, scenes, drafts), html:box.screenplayHTML(project, scenes, drafts) }; };
  const signed = outputs({ title:"The Matrix", genre:"Sci-fi" }, "Jane Doe");
  const own = outputs({ title:"The Matrix", author:"Ada Lovelace" }, "Jane Doe");
  const none = outputs({ title:"The Matrix" }, "");
  // a film SHARED with the signed-in user (a View-only reader, Co-writer or Art director exporting it)
  const shared = outputs({ title:"The Matrix" }, "Bob Smith", { shared:true, owner:"Ana" });
  const sharedNoOwner = outputs({ title:"The Matrix" }, "Bob Smith", { shared:true, owner:"" });
  const hits = [];
  for(const [k, o] of Object.entries({ signed, own, none, shared, sharedNoOwner }))
    for(const [kind, text] of Object.entries(o)) hits.push(...hitsIn("export", text).map(h=>k+"/"+kind+" ["+h.rule+"] "+h.snippet));
  try{ const outline = box.buildOutline({ title:"The Matrix", logline:"x" }, scenes); hits.push(...hitsIn("export", outline).map(h=>"outline ["+h.rule+"] "+h.snippet)); }catch(e){ /* outline needs the full app; its literals are scanned in A */ }
  ok("D the screenplay exports (Fountain, PDF / HTML) carry no retired name", !hits.length, hits);
  ok("D the company is never credited as the screenplay's author", ![signed, own, none].some(o=>/Infinite Studio/.test(o.fountain) || /Infinite Studio/.test(o.html)));
  ok("D the signed-in writer is credited: Fountain Author: and the title page's written by",
    /\nCredit: written by\nAuthor: Jane Doe\n/.test(signed.fountain) && /<div class="by">written by<\/div><div class="auth">Jane Doe<\/div>/.test(signed.html));
  ok("D the film's own author wins over the account name", /\nAuthor: Ada Lovelace\n/.test(own.fountain) && own.html.includes(">Ada Lovelace<") && !own.fountain.includes("Jane Doe"));
  ok("D with no name at all the credit line is left out (never invented)",
    !/Author:|Credit:/.test(none.fountain) && !/written by/.test(none.html));
  ok("D a film shared with the exporter credits its OWNER, never the collaborator who pressed Export",
    /\nAuthor: Ana\n/.test(shared.fountain) && shared.html.includes('<div class="auth">Ana</div>')
      && !shared.fountain.includes("Bob Smith") && !shared.html.includes("Bob Smith"));
  ok("D …and with no owner name known the credit is left out (the collaborator is still never credited)",
    !/Author:|Credit:/.test(sharedNoOwner.fountain) && !/written by/.test(sharedNoOwner.html) && !sharedNoOwner.html.includes("Bob Smith"));
  box.window.turnOpenFilmCredit = null;
  const app = read("app/app.jsx");
  ok("D app.jsx sets the shared-film credit from the open film's row (its owner's handle), null on the user's own film",
    app.includes("window.turnOpenFilmCredit = (_projRow && _projRow.isShared)")
      && app.includes('{ shared:true, owner:(typeof cloudHandleName==="function" ? cloudHandleName(_projRow.ownerEmail) : "") }'));
});

/* ───────────────────────── E. display-time mappings (stored data, decision 6) ───────────────────────── */
function fnSource(file, name, { alsoConst=[] }={}){
  const src = read(file), ast = parseFile(file, src);
  const parts = [];
  babel.traverse(ast, { enter(p){
    const n = p.node;
    if(n.type==="FunctionDeclaration" && n.id && n.id.name===name) parts.push(src.slice(n.start, n.end));
    if(n.type==="VariableDeclaration" && n.declarations.some(d=>d.id && alsoConst.includes(d.id.name))) parts.unshift(src.slice(n.start, n.end));
  }});
  return parts.join("\n");
}
safely("E mappings", ()=>{
  const ctx = vm.createContext({ window:{} });
  vm.runInContext(fnSource("app/agents.jsx", "turnDisplayNames", { alsoConst:["LEGACY_DISPLAY_NAMES"] }), ctx);
  const dn = vm.runInContext("turnDisplayNames", ctx);
  const saved = "Continuity Repair planted a line · MUSE draft · MUSE polish · Consistency Check found 2 · Art Department Coordinator done · Draft with MUSE · TURN prompt compiler";
  const shown = dn(saved);
  ok("E turnDisplayNames(): old names saved in a log / label are SHOWN with today's names",
    shown==="Setups & Payoffs planted a line · AI draft · AI polish · Script Supervisor found 2 · Art Coordinator done · Draft · Kinolot prompt compiler", shown);
  ok("E …whole phrases only (story words stay)", dn("a muse named Draft; the TURN of Act II")==="a muse named Draft; the TURN of Act II");

  const c2 = vm.createContext({ window:{} });
  vm.runInContext(fnSource("app/artroom.jsx", "promptCompilerLabel"), c2);
  ok("E promptCompilerLabel(): an image saved with 'TURN prompt compiler' shows 'Kinolot prompt compiler'",
    vm.runInContext("promptCompilerLabel('TURN prompt compiler')", c2)==="Kinolot prompt compiler");

  const c3 = vm.createContext({ window:{} });
  vm.runInContext(fnSource("app/admin-storage.jsx", "serverText"), c3);
  ok("E serverText(): the server's 'outside the TURN asset layout' is shown as Kinolot (error codes kept)",
    vm.runInContext("serverText('path outside the TURN asset layout; review by hand')", c3)==="path outside the Kinolot asset layout; review by hand"
      && vm.runInContext("serverText('TURN_ROLE_SCOPE')", c3)==="TURN_ROLE_SCOPE");

  const c4 = vm.createContext({ window:{} });
  vm.runInContext(fnSource("app/plans.jsx", "planDisplayName", { alsoConst:["PLANS", "PLAN_DISPLAY"] })+"\n"+fnSource("app/plans.jsx", "legacyPlanName"), c4);
  ok("E planDisplayName(): the plan id 'studio' (and a saved 'Studio' name) shows as 'Producer'; other plans keep theirs",
    vm.runInContext("[planDisplayName('studio'), planDisplayName('Studio'), planDisplayName('writer'), planDisplayName('director')].join('|')", c4)==="Producer|Producer|Writer|Director");

  const c5 = vm.createContext({ window:{} });
  vm.runInContext(fnSource("app/team.jsx", "teamRoleLabel", { alsoConst:["TEAM_ROLES"] }), c5);
  ok("E teamRoleLabel(): the stored role 'writer' shows as 'Co-writer' (the Writer PLAN keeps its name)",
    vm.runInContext("teamRoleLabel('writer')", c5)==="Co-writer");
});

/* ───────────────────────── F. the guard bites ───────────────────────── */
safely("F bites", ()=>{
  const snapshot = new Map(allowUsed);
  const leaks = [
    ["TURN",    "app/app.jsx",    'window.appToast("TURN lost the cloud connection.","error");'],
    ["TURN",    "app/stage.jsx",  'a.download = "TURN-film-"+date+".webm";'],
    ["TURN",    "app/ai.jsx",     'const r = "(b) HOW TO USE TURN, using ONLY the capability facts";'],
    ["CINEMA",  "app/landing.jsx",'React.createElement("span",null,"Cinema Machine");'],
    ["MUSE",    "app/muse.jsx",   'React.createElement("button",{title:"Ask MUSE","aria-label":"MUSE help assistant"});'],
    ["MUSE",    "app/script.jsx", 'const el = <div className="lbl">MUSE is drafting</div>;'],
    ["MUSE",    "app/inspector.jsx", 'const el = <input placeholder="Auto — MUSE picks per draft" />;'],
    ["AGENT",   "app/agents.jsx", 'const A = { id:"continuity", name:"Continuity Repair" };'],
    ["AGENT",   "app/chrome.jsx", 'const t = `Art Department Coordinator — runs pre-production`;'],
    ["COMPANY", "app/ai.jsx",     'const p = "You are a story architect working in the Infinite Studio method.";'],
    ["ROOM",    "app/chrome.jsx", 'const l = "Writers’ Room";'],
    ["PLAN",    "app/stage.jsx",  'const t = "4K needs the Studio plan";'],
    ["TURN",    "supabase/functions/image-proxy/index.ts", 'const m = (x: string): string => `add it in TURN\'s API Keys modal ${x}`;'],
    // "to TURN" is the product, not the craft verb — even in the files that may say "must TURN its value"
    ["TURN",    "app/ai.jsx",     'const w = "New to TURN? Welcome to TURN \u2014 ask Frances anything.";'],
    ["TURN",    "app/ai.jsx",     'throw new Error("Sign in to TURN to chat.");'],
    ["TURN",    "app/frameworks.jsx", 'const t = "Invite a co-writer to TURN";'],
    ["TURN",    "supabase/functions/blender-bridge/shared-contract.js", 'var e = "TURN could not read this package";'],
    ["COMPANY", "app/plans.jsx",  'React.createElement("div",{className:"plans-foot"},"Secure checkout by Stripe \u00b7 Kinolot, by Infinite Studio AI");'],
  ];
  const missed = leaks.filter(([rule, file, src])=>!scanSource(file, src).some(l=>l.includes("["+rule+"]")));
  ok("F every kind of leak is caught (toast, file name, prompt, JSX text, title/aria-label, template, TS)", !missed.length, missed);
  const clean = [
    ["app/ai.jsx", 'const p = "Each scene must TURN its value: the closing charge has the OPPOSITE sign.";'],
    ["app/app.jsx", 'console.warn("[TURN] save conflict:", e); const k = window.TURN_SUPABASE; localStorage.getItem("turn-theme");'],
    ["app/agents.jsx", 'const LEGACY = [[/\\bContinuity Repair\\b/g, "Setups & Payoffs"]]; // regex literal: a matcher, never shown'],
    ["app/ai.jsx", '// MUSE (codename) — comments are internal\nconst MUSE_LIMITS = 1; function museBrief(){ return "Frances"; }'],
  ];
  const falsePos = clean.filter(([file, src])=>scanSource(file, src).length);
  ok("F internals stay quiet (craft verb in prompts, console tags, TURN_* / turn-* ids, regex mapping tables, comments)", !falsePos.length, falsePos.map(([f, s])=>[f, scanSource(f, s)]));
  ok("F the craft verb is only excused in the method's prompt files", scanSource("app/app.jsx", 'appToast("each scene must TURN its value");').length===1);
  ok("F …and only as a whole craft phrase: 'Welcome to TURN' beside 'must TURN its value' in one prompt is still caught",
    scanSource("app/ai.jsx", 'const p = "Each scene must TURN its value. Welcome to TURN.";').some(l=>l.includes("[TURN]")));
  // what Frances receives at runtime: a product-name TURN slipped into her facts (APP_FEATURES) is caught
  // by the runtime scan of museFacts(), even though the craft verb elsewhere in the same text is excused
  const leakBox = aiSandbox();
  const fr = leakBox.APP_FEATURES.find(f=>f && f.name==="Frances (help assistant)");
  if(fr) fr.what = "New to TURN? Welcome to TURN \u2014 every scene must TURN its value. "+fr.what;
  const leakFacts = [];
  leakBox.museFacts().forEach(f=>leakFacts.push(...runtimeHits("museFacts « "+f.name+" »", f.name+" \n "+f.what)));
  ok("F a 'Welcome to TURN' slipped into APP_FEATURES is caught in what Frances actually receives",
    !!fr && leakFacts.some(l=>l.includes("Frances (help assistant)") && l.includes("[TURN]")), leakFacts.slice(0, 3));
  for(const [k, v] of snapshot) allowUsed.set(k, v);   // the synthetic runs never count toward the allowlist check
});

/* ───────────────────────── G. the Blender add-on's strings ───────────────────────── */
/* Every Python string literal in the add-on (comments are skipped; docstrings are read too — Blender
   shows an operator's docstring as its tooltip when it has no bl_description). Blender-specific rules:
   the internal ids keep the product's former name in lower case (the package cinema_machine_bridge,
   operator ids cinema_machine.*, custom properties cinemaMachine*), so only the SHOWN spellings trip. */
const PY_RULES = [
  { id:"CINEMA", what:"Cinema Machine / CinemaMachine", re:/Cinema ?Machine/ },
  { id:"TURN",   what:"TURN as the product",            re:/\bTURN\b/ },
  { id:"MUSE",   what:"MUSE as a name",                 re:/\bMUSE\b|\bMuse\b/ },
  { id:"COMPANY",what:"'Infinite Studio' without ' AI'", re:/Infinite Studio(?! AI)/ },
  { id:"CM",     what:"the old 'CM ' prefix on a data-block name (scene / collection / object / material)", re:/^CM\s/ },
];
/* thread names: Python's own diagnostics, never shown in Blender's UI */
const PY_ALLOW = new Map([["CinemaMachineConnect",0], ["CinemaMachineDisconnect",0], ["CinemaMachineCancel",0],
  ["CinemaMachineValidationFailure",0], ["CinemaMachineComplete",0], ["CinemaMachineRenderFailure",0], ["CinemaMachineStudio",0]]);
function pyStrings(src){
  const out = []; let i = 0, line = 1; const n = src.length;
  while(i < n){
    const c = src[i];
    if(c === "\n"){ line++; i++; continue; }
    if(c === "#"){ while(i < n && src[i] !== "\n") i++; continue; }
    if(c === '"' || c === "'"){
      const triple = src.startsWith(c+c+c, i), q = triple ? c+c+c : c, start = line;
      let j = i + q.length, text = "";
      while(j < n && !src.startsWith(q, j)){
        if(src[j] === "\\"){ text += src.slice(j, j+2); j += 2; continue; }
        if(src[j] === "\n"){ if(!triple) break; line++; }
        text += src[j]; j++;
      }
      out.push({ text, line:start });
      i = j + q.length; continue;
    }
    i++;
  }
  return out;
}
safely("G blender", ()=>{
  const dir = "blender/cinema_machine_bridge";
  const files = existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter(f=>f.endsWith(".py")).sort() : [];
  ok("G the scan reads every add-on module", files.includes("__init__.py") && files.includes("renderer.py") && files.includes("studio_scene.py"), files);
  const hits = []; let literals = 0;
  for(const f of files) for(const { text, line } of pyStrings(read(dir+"/"+f))){
    literals++;
    if(PY_ALLOW.has(text)){ PY_ALLOW.set(text, PY_ALLOW.get(text)+1); continue; }
    for(const r of PY_RULES) if(r.re.test(text)) hits.push(f+":"+line+" ["+r.id+"] "+text.slice(0, 120));
  }
  ok("G no string the add-on shows or writes into the user's .blend says a retired name or uses the 'CM ' prefix (labels, tooltips, reports, errors, property names, proof scene / world / camera, Studio collections and objects)",
    literals > 300 && !hits.length, hits);
  const stale = [...PY_ALLOW].filter(([, used])=>!used).map(([t])=>t);
  ok("G every allowlisted thread name is still in use (no stale excuses)", !stale.length, stale);
  const renderer = read(dir+"/renderer.py");
  ok("G a proof render names its scene, world, geometry and camera Kinolot Proof…",
    ['scenes.new("Kinolot Proof")', 'worlds.new("Kinolot Proof World")', 'collections.new("Kinolot Proof Geometry")', 'objects.new("Kinolot Proof Camera"']
      .every(s=>renderer.includes(s)));
  // the scan bites: synthetic Python leaks of each kind are flagged; the allowlisted thread name is not
  const probe = (s)=>pyStrings(s).filter(x=>!PY_ALLOW.has(x.text)).some(x=>PY_RULES.some(r=>r.re.test(x.text)));
  const pyLeaks = ['layout.operator("cinema_machine.connect", text="Open in Cinema Machine")', 'scene = bpy.data.scenes.new("CinemaMachine Proof")',
    'name: StringProperty(name="TURN URL", description="x")', 'root = bpy.data.collections.new("CM Studio — " + loc)', "self.report({'ERROR'}, 'Ask MUSE')",
    'class X(bpy.types.Operator):\n    """Send the shot to Cinema Machine"""'];
  const missed = pyLeaks.filter(s=>!probe(s));
  ok("G the Python scan bites (button text=, a data-block name, a property name, the CM prefix, a report, a docstring tooltip)", !missed.length, missed);
  ok("G …and stays quiet on internals (ids, custom properties, thread names, comments)",
    !probe('bl_idname = "cinema_machine.studio_open"\nobj["cinemaMachineProof"] = True\nthreading.Thread(name="CinemaMachineConnect")\n# product was called Cinema Machine'));
});

/* ───────────────────────── the allowlist stays honest ───────────────────────── */
if(!process.env.BRAND_GUARD_ROOT || process.env.BRAND_GUARD_CHECK_ALLOW){
  const stale = ALLOW.filter((a, i)=>allowUsed.get(i) < (a.count || 1)).map(a=>a.file+" ["+a.rule+"] "+a.text);
  ok("ALLOW every allowlist entry still matches a literal it excuses (no stale excuses)", !stale.length, stale);
}

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);
