#!/usr/bin/env node
/* test-homepage-look.mjs — the homepage + sign-in refresh in the Kinolot identity (2026-09-29).

   What it pins (a visual pass: layouts, sections, flows and the owner's copy are unchanged):
   A. ONE website palette. The landing, the paper sign-in panel and Home read the same --lpw-* token
      set, whose only colour is the mark's amber (#F29A43 = the app's --accent) — a FILL with the
      app's dark ink; amber as text uses the AA shades. The landing's own green/red charge and the
      "Reel" orange are gone: the hero spine wears the app's grade (amber rises, teal falls).
   B. The app's buttons: the landing, Home and the paper sign-in primaries are the 9px-radius (--r-m)
      amber button with dark ink — no black pills — and Home's buttons name their font (no Arial).
   C. The sign-in window: the lockup + "by Infinite Studio AI" (Space Mono), a named close button,
      and the plan chip / notice in amber tints (not green).
   D. Home follows the theme (paper in light, the app's dark tokens in dark), its phone layout cannot
      be widened past the screen (minmax(0,…) columns, steps two by two), and its icon-only buttons
      are named.
   E. The Frances bubble no longer covers the landing footer's links below 1430px.

   Run: node scripts/test-homepage-look.mjs  (no browser, no network) */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const babel = require("@babel/core");
const read = (f)=>readFileSync(join(ROOT, f), "utf8");

let pass = 0, fail = 0;
function check(name, fn){
  let r; try{ r = fn(); }catch(e){ r = false; console.log("  ", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e)); }
  if(r!==false){ pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); }
}
const transform = (src, filename)=>babel.transformSync(src, { babelrc:false, configFile:false, filename,
  presets:[[require.resolve("@babel/preset-react"), { runtime:"classic" }]],
  plugins:[require.resolve("@babel/plugin-transform-block-scoping")] }).code;

const css = read("app/styles.css");
const rule = (sel)=>{ const i = css.indexOf("\n"+sel+"{"); if(i<0) return null; return css.slice(i+sel.length+2, css.indexOf("}", i)); };
/* the three website blocks of the stylesheet: the paper sign-in panel, the landing, Home */
const block = (from, to)=>{ const a = css.indexOf(from), b = css.indexOf(to, a+1); return a>=0 && b>a ? css.slice(a, b) : ""; };
const authCss = block("/* ---- the paper sign-in panel", "\n.acct-signin{");
const landingCss = block("/* ===================== Commercial landing page", "/* Screenplay preview modal");
const homeCss = block("   Home Dashboard (home-dashboard.jsx)", "/* centered progress overlay");
const OLD = /#13955E|#5AD398|#D2493E|#E2685C|#E0742B|#0E7A4D|rgba\(19,149,94|rgba\(90,211,152|rgba\(226,104,92|#1d6b45/i;

/* ── A. one palette ─────────────────────────────────────────────────────────────── */
check("A the website palette is shared by the landing, the paper sign-in panel and Home", ()=>{
  const r = rule(".landing, .auth-panel.light, .hd-root");
  return !!r && /--lpw-amber:#F29A43;/.test(r) && /--lpw-on-amber:#2C2722;/.test(r) && /--lpw-amber-ink:#9E5410;/.test(r)
    && /--lpw-rise:#F29A43;/.test(r) && /--lpw-fall:#5DB0D8;/.test(r) && /--lpw-black:#0E0F12;/.test(r);
});
check("A no landing green/red or 'Reel' orange left in the landing, sign-in or Home styles", ()=>
  authCss.length>500 && landingCss.length>2000 && homeCss.length>2000
  && ![authCss, landingCss, homeCss].some(b=>OLD.test(b)) && !/--lpw-accent/.test(css)
  && !/\.auth-panel\.light\{[^}]*--pos:/.test(css) && !/\n\.landing\{[^}]*--pos:/.test(css));
check("A the hero spine wears the app's grade (amber rises, teal falls) with readable labels", ()=>{
  const s = read("app/landing.jsx");
  return s.includes('stopColor:"var(--lpw-rise)"') && s.includes('stopColor:"var(--lpw-fall)"') && !/pos-bright|neg-bright|90,211,152|226,104,92/.test(s)
    && s.includes('fill:"rgba(255,255,255,.55)",\n        fontSize:11') && s.includes('textAnchor:edge,fill:"rgba(255,255,255,.62)"');
});
check("A amber text on paper uses the AA shades (hero word, chips, checks)", ()=>
  /color:var\(--lpw-amber\)/.test(rule(".lp-rotate") || "") && /color:var\(--lpw-amber-ink\)/.test(rule(".lp-room-status") || "")
  && rule(".lp-tier-feats li svg").includes("color:var(--lpw-amber-ink)") && /color:var\(--lpw-amber-display\)/.test(rule(".hd-accent-text") || ""));

/* ── B. the app's buttons ───────────────────────────────────────────────────────── */
check("B landing, Home and paper sign-in primaries: 9px radius, amber fill, dark ink — no pills", ()=>{
  const btn = rule(".lp-btn"), prim = rule(".lp-btn.primary"), hb = rule(".hd-btn"), hp = rule(".hd-btn-accent"), tb = rule(".hd-tbtn"), ta = rule(".hd-tbtn.hd-accent");
  const amber = (r)=> !!r && /background:var\(--lpw-amber\)/.test(r) && /color:var\(--lpw-on-amber\)/.test(r);
  return /border-radius:var\(--r-m\)/.test(btn) && /height:38px/.test(btn) && amber(prim) && /border-radius:var\(--r-m\)/.test(hb) && amber(hp)
    && /border-radius:var\(--r-m\)/.test(tb) && amber(ta) && /font:600 13\.5px var\(--f-ui\)/.test(tb)
    && /\.auth-panel\.light \.auth-submit\{background:var\(--lpw-amber\);color:var\(--lpw-on-amber\)\}/.test(css)
    && /border-radius:var\(--r-m\)/.test(rule(".auth-submit") || "")
    && ![btn, prim, hb, hp, tb, ta].some(r=>/border-radius:999px/.test(r)) && !/\.lp-tier\.featured \.lp-btn\.primary\{/.test(css);
});

/* ── C. the sign-in window ──────────────────────────────────────────────────────── */
const kids = (n)=> (n && n.children) || [];
const flat = (n, out=[])=>{ if(n && typeof n==="object"){ out.push(n); kids(n).forEach(c=>flat(c, out)); } return out; };
const textOf = (n)=> typeof n==="string" ? n : (n && typeof n==="object") ? kids(n).map(textOf).join("") : "";
const hasClass = (c)=>(n)=> n && n.props && String(n.props.className||"").split(" ").includes(c);
const box = ()=>{
  const b = { window:null, console, Icon:new Proxy({}, { get:(_, k)=>function Icn(){ return null; } }), CINEMA_PLANS:[{ tier:"director", name:"Director", price:"$49" }] };
  b.window = b;
  b.React = { useState:(v)=>[typeof v==="function" ? v() : v, ()=>{}], useRef:()=>({ current:null }), useEffect:()=>{}, Fragment:"frag",
    createElement:(type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity).filter(c=>c!==null && c!==undefined && c!==false) }) };
  b.BrandMark = function BrandMark(){ return null; };
  vm.createContext(b); return b;
};
const ab = box(); vm.runInContext(transform(read("app/auth-ui.jsx"), "auth-ui.jsx"), ab, { filename:"app/auth-ui.jsx" });
/* (review 2026-09-29) the lockup alone: "by Infinite Studio AI" was new copy on the sign-in panel,
   which the brief keeps to the owner's words — it stays in the footers, where the company was shown */
check("C both panel themes: the lockup alone (no new endorsement copy); the close button is named", ()=>[true, false].every(light=>["signin", "signup"].every(mode=>{
  const all = flat(ab.AuthModal({ onClose:()=>{}, onAuthed:()=>{}, initialMode:mode, plan:"director", light }));
  const brand = all.find(hasClass("auth-brand")), close = all.find(hasClass("auth-close"));
  return brand && brand.children.length===1 && hasClass("auth-mark")(brand.children[0]) && textOf(brand.children[0])==="Kinolot"
    && !all.some(hasClass("auth-by")) && !all.some(n=>/Infinite Studio/.test(textOf(n)))
    && close && close.props["aria-label"]==="Close" && close.props.type==="button";
})));
check("C the chosen plan and the notice wear amber tints on paper", ()=>
  !rule(".auth-by")
  && /\.auth-panel\.light \.auth-plan\{color:var\(--lpw-amber-ink\);background:var\(--lpw-amber-soft\)/.test(css)
  && /\.auth-panel\.light \.auth-notice\{color:var\(--lpw-amber-ink\)/.test(css)
  && /color:var\(--txt-2\)/.test(rule(".auth-lab") || ""));

/* ── D. Home ────────────────────────────────────────────────────────────────────── */
check("D Home follows the theme: the dark theme re-points the palette at the app's dark tokens", ()=>{
  const r = rule('html[data-theme="dark"] .hd-root');
  return !!r && /--lpw-bg:var\(--bg-1\)/.test(r) && /--lpw-ink:var\(--txt-0\)/.test(r) && /--lpw-card:var\(--bg-2\)/.test(r)
    && /color-scheme:dark/.test(r) && !/--lpw-bg:#/.test(rule(".hd-root") || "x");
});
check("D Home's phone layout: minmax(0,…) hero column, steps two by two, New Project on one line", ()=>
  /@media \(max-width:1080px\)\{ \.hd-hero\{ grid-template-columns:minmax\(0,1fr\); \}/.test(css)
  && /\.hd-steps\{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/.test(css)
  && /white-space:nowrap/.test(rule(".hd-tbtn") || ""));
check("D Home's icon-only buttons are named (play, pagers, poster actions, viewer close)", ()=>{
  const s = read("app/home-dashboard.jsx");
  return s.includes('"aria-label":"Go to The Stage"') && s.includes('"aria-label":"Previous projects"') && s.includes('"aria-label":"Next shared projects"')
    && s.includes('"aria-label":"Download poster"') && s.includes('"aria-label":(p.cover?"Regenerate":"Generate")+" poster"')
    && s.includes('title:"Close (Esc)", "aria-label":"Close"');
});

/* ── E. the Frances bubble and the landing footer ───────────────────────────────── */
check("E below 1430px the one-row landing footer keeps its links clear of the Frances bubble", ()=>
  /@media \(min-width:561px\) and \(max-width:1429\.98px\)\{\n  \.lp-foot-in\{padding-right:92px\}\n\}/.test(css));

console.log(pass+" passed, "+fail+" failed");
process.exit(fail ? 1 : 0);
