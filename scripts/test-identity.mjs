#!/usr/bin/env node
/* test-identity.mjs — the Kinolot identity (owner decisions 2026-09-28: logo direction B "The Lot").

   What it pins:
   A. ONE mark. app/chrome.jsx KINOLOT_MARK is the owner's reference geometry (three soundstage bays
      with arched roofs on a baseline, 64-unit box, stroke 3.5, round joins); BrandMark draws exactly
      it — the amber middle bay (filled) first, the outer bays and baseline in currentColor on top —
      decorative (aria-hidden). The wordmark is "Kinolot" in ONE colour, Spectral 600 at -0.01em;
      the old gradient tile, the zig-zag logo and the two-tone "Kino"+"lot" are gone.
   B. The mark is used everywhere the logo shows: the top bar (both branches), Home, the landing nav
      and footer, the sign-in panel, the boot splash, the legal pages' header and footer — and every
      one of those wordmarks is the same Spectral 600 / -0.01em rule. The company is endorsed as
      "by Infinite Studio AI" in Space Mono.
   C. favicon.svg is the 16/32px cut of the SAME mark: the app icon's dark tile (#0E0F12, 25% radius),
      three equal arched bays with the reference's 0.5 gaps, the amber middle bay drawn first, the
      baseline past the walls — with strokes thick enough for 16px and the mark filling the tile.
   D. TURN.html's head: the icon links, og:image (+ width / height / alt), og:url, twitter:card
      summary_large_image and twitter:image — ABSOLUTE https://kinolot.infinitestudioai.com/ URLs;
      the title and description unchanged; the changed files' cache keys bumped.
   E. The raster files exist at the root with the right pixel sizes, are opaque, and are drawn in the
      identity's colours (decoded here: dark ground, amber bay, warm-white ink); the render script
      builds them from KINOLOT_MARK (the app icon and the share image carry its exact paths, the
      tagline and the endorsement).
   F. They ship: serve.js serves them in dev, scripts/build-dist.mjs copies them into dist/, and — when
      dist/ was built after them — dist/ holds byte-identical copies and index.html keeps the tags.

   Run: node scripts/test-identity.mjs  (no browser, no network) */
import { readFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import zlib from "node:zlib";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const babel = require("@babel/core");
const read = (f)=>readFileSync(join(ROOT, f), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if(cond){ pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra!==undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
}
function check(name, fn){
  try{ const r = fn(); ok(name, r!==false, r===false ? "returned false" : undefined); }
  catch(e){ ok(name, false, e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e)); }
}
const transform = (src, filename)=>babel.transformSync(src, { babelrc:false, configFile:false, filename,
  presets:[[require.resolve("@babel/preset-react"), { runtime:"classic" }]],
  plugins:[require.resolve("@babel/plugin-transform-block-scoping")] }).code;

/* the owner's reference geometry (decision 2026-09-28), written out here on purpose */
const REF = {
  outer:["M9 46 V31 A7.5 7.5 0 0 1 24 31 V46", "M40 46 V31 A7.5 7.5 0 0 1 55 31 V46"],
  middle:"M24.5 46 V31 A7.5 7.5 0 0 1 39.5 31 V46 Z",
  base:"M6 47.5 H58", stroke:3.5, amber:"#F29A43",
};
const HOST = "https://kinolot.infinitestudioai.com/";
const KEY = "20260929-look1";
const LATER = ["20260929-look2", "20260929-look3", "20260929-look4", "20260930-portal1", "20260930-billing1", "20261001-tax1", "20261002-consent1", "20261002-tip1", "20261002-btn1", "20261002-team1", "20261002-scene1", "20261002-research1", "20261002-research2", "20261002-artlive1", "20261002-artundo1", "20261002-stagefilm1", "20261002-attrib1", "20261002-planpick2", "20261002-planpick3", "20261002-trialwelcome1", "20261003-room1", "20261003-login1", "20261003-login2", "20261003-team2", "20261003-team3", "20261003-team4", "20261003-team5", "20261003-team6", "20261003-team7", "20261003-team8", "20261003-lookbook1", "20261003-cast1", "20261004-props1", "20261004-locs1", "20261004-color1", "20261004-shots1", "20261005-sb1", "20261005-bd1", "20261005-comma1", "20261005-stage1", "20261005-stage2", "20261005-prompts1", "20261005-lbshots1", "20261005-color2", "20261005-shots2", "20261005-sb2", "20261005-bd2", "20261006-lb2", "20261006-chars2", "20261008-props2", "20261008-locs2", "20261008-color3", "20261009-shots3", "20261009-sb3", "20261009-bd3", "20261009-stage3", "20261009-tl3", "20261009-mix3", "20261009-wr3", "20261009-art3", "20261009-home3", "20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3"];   // a later change that re-keys one of these files adds its key here (Manage plan 2026-09-30: styles.css, auth-ui.jsx) (billing fixes 2026-09-30: styles.css, auth-ui.jsx, app.jsx and more) (consumer rights + tax 2026-10-01: styles.css, auth-ui.jsx) (the 14-day note by the purchase buttons 2026-10-02: styles.css, auth-ui.jsx, landing.jsx) (the note behind an ⓘ 2026-10-02: styles.css, landing.jsx) (Team "Coming soon" 2026-10-02: styles.css, team.jsx, chrome.jsx, landing.jsx, app.jsx and more: 20261002-team1)

/* ── a tiny React stand-in that renders function components (so nested marks are visible) ── */
const el = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const hasClass = (c)=>(n)=> String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n) : (!n || typeof n!=="object") ? ""
  : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const deep = (n)=>{ if(!n || typeof n!=="object") return n; if(Array.isArray(n)) return n.map(deep);
  if(typeof n.type==="function") return deep(n.type({ ...n.props, children:n.children }));
  return { ...n, children:(n.children||[]).map(deep) }; };
const noop = ()=>{};
function box(extra){
  const React = { Fragment:"fragment", createElement:el, calls:0,
    useState:(init)=>[typeof init==="function" ? init() : init, noop], useEffect:noop, useLayoutEffect:noop,
    useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f };
  const b = { console, React, Icon:new Proxy({}, { get:()=>()=>null }), ReactDOM:{ createRoot:()=>({ render:noop, unmount:noop }) },
    document:{ addEventListener:noop, removeEventListener:noop, createElement:()=>({}), body:{ appendChild:noop } },
    localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop }, sessionStorage:{ getItem:()=>null, setItem:noop },
    CustomEvent:class { constructor(t){ this.type = t; } }, addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true,
    setTimeout, clearTimeout, setInterval:()=>0, clearInterval:noop, location:{ hostname:"localhost" }, ...(extra||{}) };
  b.window = b; vm.createContext(b); return b;
}
const run = (b, f)=> vm.runInContext(transform(read(f), f), b, { filename:f });
/* the mark's drawing, as [tag, d, fill, stroke] in paint order, from a rendered <svg> */
const paint = (svg)=>{ const out = []; const go = (n, inh)=>{ if(!n || typeof n!=="object") return;
  const p = n.props || {}; const st = { stroke:p.stroke || inh.stroke, fill:p.fill || inh.fill, sw:p.strokeWidth || inh.sw };
  if(n.type==="path") out.push([p.d, st.fill, st.stroke, st.sw, p.strokeLinejoin || inh.join]);
  (n.children||[]).forEach(c=>go(c, { ...st, join:p.strokeLinejoin || inh.join })); }; go(svg, {}); return out; };
const REF_PAINT = JSON.stringify([[REF.middle, REF.amber, REF.amber, REF.stroke, "round"],
  [REF.outer[0], "none", "currentColor", REF.stroke, "round"], [REF.outer[1], "none", "currentColor", REF.stroke, "round"],
  [REF.base, "none", "currentColor", REF.stroke, "round"]]);
const isMark = (n)=> n && n.type==="svg" && hasClass("brand-mark")(n) && JSON.stringify(paint(n))===REF_PAINT;

/* ── A. one mark, one wordmark ──────────────────────────────────────────────────── */
const cb = box(); run(cb, "app/team.jsx"); run(cb, "app/chrome.jsx");
check("A KINOLOT_MARK is the owner's reference geometry (three bays, baseline, stroke 3.5, amber)", ()=>{
  const M = cb.KINOLOT_MARK;
  return Object.isFrozen(M) && JSON.stringify(M.outer)===JSON.stringify(REF.outer) && M.middle===REF.middle && M.base===REF.base
    && M.stroke===REF.stroke && M.amber===REF.amber && M.box==="0 0 64 64" && M.crop==="4 20 56 29.25";
});
check("A the crop holds the whole mark (strokes and round caps included) and ENDS at the ground line, so the roofs stand on the text baseline", ()=>{
  // bounds: baseline caps x 6-1.75 … 58+1.75; roof tops 31-7.5-1.75; baseline bottom 47.5+1.75
  const [x, y, w, h] = cb.KINOLOT_MARK.crop.split(" ").map(Number);
  return x <= 4.25 && x+w >= 59.75 && y <= 21.75 && y+h === 49.25 && w===56;
});
check("A BrandMark draws exactly the mark: amber bay first, outer bays + baseline in currentColor on top; decorative", ()=>{
  const svg = cb.BrandMark();
  return isMark(svg) && svg.props.viewBox==="4 20 56 29.25" && svg.props.preserveAspectRatio==="xMidYMax meet" && svg.props["aria-hidden"]==="true" && svg.props.focusable==="false"
    && svg.children[1].props.strokeLinecap==="round" && JSON.stringify(svg).indexOf("M4 16l5-9 6 11 5-7")<0;
});
check("A the wordmark is 'Kinolot' in one colour (no accent 'lot')", ()=>{
  const wm = cb.BrandWordmark();
  return hasClass("brand-name")(wm) && wm.children.length===1 && wm.children[0]==="Kinolot";
});
const css = read("app/styles.css");
const rule = (sel)=>{ const i = css.indexOf("\n"+sel+"{"); if(i<0) return null; return css.slice(i+sel.length+2, css.indexOf("}", i)); };
const spectral = (r)=> !!r && /font-family:"Spectral",Georgia,serif/.test(r) && /font-weight:600/.test(r) && /letter-spacing:-\.01em/.test(r);
check("A the stylesheet: Spectral 600 / -0.01em wordmark, the mark in the text colour, no gradient tile or accent 'lot'", ()=>{
  const mark = rule(".brand-mark"), name = rule(".brand-name");
  return spectral(name) && /color:var\(--txt-0\)/.test(name) && /color:var\(--txt-0\)/.test(mark) && !/gradient|border-radius/.test(mark)
    && !css.includes(".brand-name b") && !css.includes(".hd-brand-name b") && !css.includes(".brand-mark svg");
});
check("A no logo still draws the old zig-zag (the value-charge glyph stays the story graph's, not the brand's)", ()=>{
  const files = ["app/chrome.jsx", "app/landing.jsx", "app/home-dashboard.jsx", "app/auth-ui.jsx", "favicon.svg", "privacy.html", "terms.html"];
  return files.every(f=>!/M4 16l5-9 6 11 5-7|M14\.4 39\.7L25\.4 19\.9/.test(read(f)));
});

/* ── B. the mark wherever the logo shows ────────────────────────────────────────── */
check("B the top bar: the mark + wordmark in both branches (Home button and plain brand), the button named", ()=>{
  const props = { room:"writers", setRoom:noop, project:{ title:"F" }, scenes:[], drafts:{}, onNewStory:noop, theme:"dark", onTheme:noop };
  const withHome = deep(cb.TopBar({ ...props, onHome:noop })), plain = deep(cb.TopBar(props));
  const brand = (t)=> findAll(t, hasClass("brand"))[0];
  return [withHome, plain].every(t=>{ const b = brand(t); return b && isMark(b.children[0]) && textOf(b)==="Kinolot"; })
    && brand(withHome).type==="button" && brand(withHome).props["aria-label"]==="Kinolot — Home";
});
const lb = box({ CINEMA_PLANS:[], usePlansVersion:()=>0 }); run(lb, "app/chrome.jsx"); run(lb, "app/landing.jsx");
check("B the landing: nav logo and footer brand are the mark + 'Kinolot'; the footer endorses 'by Infinite Studio AI'", ()=>{
  const page = deep(lb.Landing({ onStart:noop, onSignIn:noop }));
  const logos = findAll(page, hasClass("lp-logo"));
  const by = findAll(page, hasClass("lp-foot-by"))[0];
  return logos.length===2 && logos.every(l=>isMark(l.children[0]) && textOf(l)==="Kinolot") && textOf(by)==="by Infinite Studio AI";
});
const ab = box({ cloudConfigured:()=>true, CREDIT_SCALE:10 }); run(ab, "app/plans.jsx"); run(ab, "app/chrome.jsx"); run(ab, "app/auth-ui.jsx");
check("B sign-in and sign-up show the mark + 'Kinolot' (both panel themes)", ()=>[true, false].every(light=>["signin", "signup"].every(mode=>{
  const m = deep(ab.AuthModal({ onClose:noop, onAuthed:noop, initialMode:mode, light }));
  const mark = findAll(m, hasClass("auth-mark"))[0];
  return mark && isMark(mark.children[0]) && textOf(mark)==="Kinolot";
})));
check("B Home: the mark + the one-colour wordmark; its footer is the landing's brand", ()=>{
  const s = read("app/home-dashboard.jsx");
  return /h\("button",\{className:"hd-brand"[^\n]*\n\s*\(typeof BrandMark!=="undefined"\) && h\(BrandMark,null\),\n\s*h\("span",\{className:"hd-brand-name"\},"Kinolot"\)\)/.test(s)
    && s.includes("h(LandingFootBrand,null)");
});
check("B the boot splash (session check and cloud load) shows the mark + 'Kinolot'", ()=>{
  const s = read("app/app.jsx");
  const splashes = s.split('React.createElement("div",{className:"lp-splash",role:"status","aria-live":"polite"},').slice(1);
  return splashes.length===2 && splashes.every(x=>x.trimStart().startsWith('React.createElement("span",{className:"lp-logo"},(typeof BrandMark==="function") && React.createElement(BrandMark,null),"Kinolot")'));
});
const markSvgPaths = (svg)=> [...svg.matchAll(/<path d="([^"]+)"/g)].map(m=>m[1]);
for(const f of ["privacy.html", "terms.html"]){
  check("B "+f+": header and footer logos are the inline mark (same paths, amber bay first) + 'Kinolot', in Spectral", ()=>{
    const s = read(f);
    const logos = [...s.matchAll(/<(?:a class="logo" href="\/"|span class="foot-logo")>(<svg class="mark" [^>]*>[\s\S]*?<\/svg>)Kinolot<\/(?:a|span)>/g)].map(m=>m[1]);
    const want = JSON.stringify([REF.middle, ...REF.outer, REF.base]);
    return logos.length===2 && logos.every(svg=>JSON.stringify(markSvgPaths(svg))===want && svg.includes('viewBox="4 20 56 29.25" preserveAspectRatio="xMidYMax meet"')
      && svg.includes('aria-hidden="true"') && svg.includes('fill="#F29A43" stroke="#F29A43" stroke-width="3.5"') && svg.includes('stroke="currentColor" stroke-width="3.5"'))
      && /\.logo,\.foot-logo\{[^}]*font-family:"Spectral",Georgia,serif;font-weight:600;[^}]*letter-spacing:-\.01em/.test(s) && !/Space Grotesk",sans-serif;font-weight:700;font-size:19px/.test(s);
  });
}
check("B every surface's wordmark is the same Spectral 600 / -0.01em rule; the endorsement is Space Mono", ()=>
  [".lp-logo", ".auth-mark", ".hd-brand-name"].every(sel=>{ const r = css.match(new RegExp("\\n\\"+sel+"\\{[^}]*\\}")); return r && spectral(r[0]); })
  && !/\.lp-splash \.lp-logo\{[^}]*font-family/.test(css) && !/\.auth-panel\.light \.auth-mark\{[^}]*font-family/.test(css)
  && /\n\.lp-foot-by\{font-family:var\(--f-mono\);/.test(css));

/* ── C. the favicon: the 16/32px cut of the same mark ───────────────────────────── */
const fav = read("favicon.svg");
check("C favicon.svg: the app icon's dark tile (#0E0F12, 25% radius), the amber bay drawn first, ink bays and baseline", ()=>{
  const body = fav.replace(/<!--[\s\S]*?-->/g, "");
  const order = [...body.matchAll(/<(rect|path|g)\b/g)].map(m=>m[1]).join(",");
  return body.includes('<rect width="64" height="64" rx="16" fill="#0E0F12"/>') && order==="rect,path,g,path,path,path"
    && /<path d="[^"]+ Z" fill="#F29A43" stroke="#F29A43" stroke-width="[\d.]+" stroke-linejoin="round"\/>/.test(body)
    && /<g fill="none" stroke="#F3F1EC" stroke-width="[\d.]+" stroke-linejoin="round" stroke-linecap="round">/.test(body) && !/gradient|stop-color/.test(body);
});
check("C favicon.svg: three equal arched bays with the reference's 0.5 gaps, a baseline past the walls — legible at 16px", ()=>{
  const bay = /M([\d.]+) ([\d.]+) V([\d.]+) A([\d.]+) \4 0 0 1 ([\d.]+) \3 V\2( Z)?/;
  const ds = [...fav.matchAll(/<path d="([^"]+)"/g)].map(m=>m[1]);
  const [mid, o1, o3, base] = ds.map(d=>d);
  const B = [o1, mid, o3].map(d=>{ const m = bay.exec(d); return m && { x:+m[1], b:+m[2], s:+m[3], r:+m[4], x2:+m[5], closed:!!m[6] }; });
  if(ds.length!==4 || B.some(x=>!x)) return false;
  const w = B[0].x2-B[0].x, sw = +/stroke-width="([\d.]+)"/.exec(fav.split("<g")[1])[1], swMid = +/stroke-width="([\d.]+)"/.exec(fav)[1];
  const bm = /^M([\d.]+) ([\d.]+) H([\d.]+)$/.exec(base);
  const left = +bm[1] - sw/2, right = +bm[3] + sw/2;
  return B.every(x=>Math.abs((x.x2-x.x)-w)<1e-9 && Math.abs(x.r-w/2)<1e-9 && x.b===B[0].b && x.s===B[0].s) && B[1].closed && !B[0].closed && !B[2].closed
    && Math.abs(B[1].x-(B[0].x2+0.5))<1e-9 && Math.abs(B[2].x-(B[1].x2+0.5))<1e-9            // the reference's 0.5 gaps
    && +bm[1] < B[0].x && +bm[3] > B[2].x2 && +bm[2] > B[0].b                                  // baseline past the walls, under the bays
    && sw===swMid && sw >= 5                                                                    // ≥1.25px at 16px (the full mark's 3.5 → 0.9px)
    && (right-left)/64 >= 0.8 && Math.abs((left+right)/2-32) < 0.01                             // fills and centres the tile
    && Math.abs(((B[0].s-B[0].r-sw/2)+(+bm[2]+sw/2))/2-32) < 0.6;                               // centred vertically
});

/* ── D. the page head ───────────────────────────────────────────────────────────── */
const html = read("TURN.html");
const head = html.slice(0, html.indexOf("</head>"));
const meta = (attr, name)=>{ const m = new RegExp('<meta '+attr+'="'+name.replace(/[:.]/g, "\\$&")+'" content="([^"]*)" />').exec(head); return m ? m[1] : null; };
check("D the icons: SVG favicon and a 180px apple-touch-icon, both cache-keyed", ()=>
  head.includes('<link rel="icon" type="image/svg+xml" href="favicon.svg?v='+KEY+'" />')
  && head.includes('<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png?v='+KEY+'" />'));
check("D the share preview: og:image (1200×630, alt), og:url, twitter summary_large_image — absolute kinolot.infinitestudioai.com URLs", ()=>{
  const img = meta("property", "og:image");
  return img===HOST+"og-image.png?v="+KEY && meta("property", "og:image:width")==="1200" && meta("property", "og:image:height")==="630"
    && meta("property", "og:image:alt")==="Kinolot by Infinite Studio AI — From first idea to finished film."
    && meta("property", "og:url")===HOST && meta("name", "twitter:card")==="summary_large_image" && meta("name", "twitter:image")===img
    && [...head.matchAll(/<meta [^>]*content="([^"]*\.(?:png|jpg|svg)[^"]*)"/g)].every(m=>m[1].startsWith(HOST));
});
check("D the title and description are unchanged", ()=>
  head.includes("<title>Kinolot — Story architecture for AI filmmakers</title>")
  && meta("name", "description")==="Kinolot by Infinite Studio AI: story architecture for AI filmmakers. Turn an idea into a story spine and a screenplay, design the film, then shoot it — one project, every department connected."
  && meta("property", "og:title")==="Kinolot — Story architecture for AI filmmakers"
  && meta("property", "og:description")==="Turn an idea into a story spine and a screenplay, design the film, then shoot it — one project, every department connected. By Infinite Studio AI.");
check("D the legal pages link the same icons (root paths, the same key)", ()=>["privacy.html", "terms.html"].every(f=>{ const s = read(f);
  return s.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg?v='+KEY+'" />') && s.includes('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v='+KEY+'" />'); }));
check("D the files this change touched are re-keyed "+KEY, ()=>{
  const key = (f)=>{ const m = new RegExp(f.replace(/[.]/g, "\\.")+"\\?v=([\\w-]+)").exec(html); return m && m[1]; };
  const bad = ["app/styles.css", "app/chrome.jsx", "app/landing.jsx", "app/home-dashboard.jsx", "app/auth-ui.jsx", "app/app.jsx"]
    .filter(f=>!(key(f)===KEY || LATER.includes(key(f)))).map(f=>f+" "+key(f));
  if(bad.length) console.log("  ", bad);
  return bad.length===0;
});

/* ── E. the raster files ────────────────────────────────────────────────────────── */
function decodePng(buf){
  if(buf.readUInt32BE(0)!==0x89504e47 || buf.readUInt32BE(4)!==0x0d0a1a0a) throw new Error("not a PNG");
  let off = 8, w, h, depth, type, interlace; const idat = [];
  while(off < buf.length){
    const len = buf.readUInt32BE(off), tag = buf.toString("ascii", off+4, off+8), data = buf.subarray(off+8, off+8+len);
    if(tag==="IHDR"){ w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if(tag==="IDAT") idat.push(data); else if(tag==="IEND") break;
    off += 12+len;
  }
  if(depth!==8 || interlace!==0 || (type!==2 && type!==6)) throw new Error("unsupported PNG: depth "+depth+" type "+type);
  const bpp = type===6 ? 4 : 3, stride = w*bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h*stride);
  for(let y = 0; y < h; y++){
    const f = raw[y*(stride+1)], line = raw.subarray(y*(stride+1)+1, (y+1)*(stride+1));
    for(let i = 0; i < stride; i++){
      const a = i>=bpp ? px[y*stride+i-bpp] : 0, b = y>0 ? px[(y-1)*stride+i] : 0, c = (i>=bpp && y>0) ? px[(y-1)*stride+i-bpp] : 0;
      const p = a+b-c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
      const pred = f===0 ? 0 : f===1 ? a : f===2 ? b : f===3 ? ((a+b)>>1) : (pa<=pb && pa<=pc ? a : pb<=pc ? b : c);
      px[y*stride+i] = (line[i]+pred) & 255;
    }
  }
  const at = (x, y)=>{ const i = y*stride+x*bpp; return [px[i], px[i+1], px[i+2], bpp===4 ? px[i+3] : 255]; };
  return { w, h, type, at };
}
const near = (p, hex, tol = 12)=>{ const c = [1, 3, 5].map(i=>parseInt(hex.slice(i, i+2), 16)); return c.every((v, i)=>Math.abs(p[i]-v)<=tol); };
const count = (img, hex, tol)=>{ let n = 0; for(let y = 0; y < img.h; y++) for(let x = 0; x < img.w; x++) if(near(img.at(x, y), hex, tol)) n++; return n; };
for(const [f, w, h] of [["apple-touch-icon.png", 180, 180], ["og-image.png", 1200, 630]]){
  check("E "+f+" exists at the site root, "+w+"×"+h+", opaque, in the identity's colours", ()=>{
    if(!existsSync(join(ROOT, f))) return false;
    const img = decodePng(readFileSync(join(ROOT, f)));
    const corners = [[0, 0], [img.w-1, 0], [0, img.h-1], [img.w-1, img.h-1]].map(([x, y])=>img.at(x, y));
    const area = img.w*img.h, amber = count(img, REF.amber, 10), ink = count(img, "#F3F1EC", 8);
    if(!(amber > area*0.004 && ink > area*0.008)) console.log("  ", f, { amber, ink, area });
    return img.w===w && img.h===h && (img.type===2 || corners.every(p=>p[3]===255))
      && near(corners[0], "#0E0F12", 3) && near(corners[1], "#0E0F12", 3) && corners.every(p=>p[0] < 48 && p[1] < 48 && p[2] < 48)
      && amber > area*0.004 && ink > area*0.008;
  });
}
const R = await import(join(ROOT, "scripts/render-identity.mjs"));
check("E the render script draws both files from KINOLOT_MARK: the app icon and the share image carry its exact paths", ()=>{
  const M = R.readMark();
  const icon = R.appIconSvg(M), share = R.shareHtml(M);
  const has = (s)=> [REF.middle, ...REF.outer, REF.base].every(d=>s.includes('d="'+d+'"')) && s.includes('stroke-width="3.5"');
  return JSON.stringify(M)===JSON.stringify(cb.KINOLOT_MARK) && has(icon) && has(share) && icon.includes('fill="#0E0F12"')
    && share.indexOf('d="'+REF.middle+'"') < share.indexOf('d="'+REF.outer[0]+'"');
});
check("E the share image says 'Kinolot' (Spectral 600), the tagline, and 'by Infinite Studio AI' (Space Mono), on the dark ground", ()=>{
  const s = R.shareHtml(R.readMark());
  return s.includes('<div class="word">Kinolot</div>') && s.includes('<div class="tag">From first idea to finished film.</div>')
    && s.includes('<div class="by">by Infinite Studio AI</div>') && /\.word\{font-family:"Spectral",serif;font-weight:600;[^}]*letter-spacing:-\.01em/.test(s)
    && /\.by\{[^}]*font-family:"Space Mono",monospace/.test(s) && s.includes("background:#0E0F12");
});

/* ── F. they ship ───────────────────────────────────────────────────────────────── */
const FILES = ["favicon.svg", "apple-touch-icon.png", "og-image.png"];
check("F serve.js serves them in dev (its root allowlist)", ()=>{
  const s = read("serve.js"), set = /const PUBLIC_ROOT_FILES = new Set\(\[([\s\S]*?)\]\);/.exec(s)[1];
  return FILES.every(f=>set.includes('"'+f+'"')) && s.includes('".png": "image/png"') && s.includes('".svg": "image/svg+xml"');
});
check("F scripts/build-dist.mjs copies them into dist/", ()=>{
  const s = read("scripts/build-dist.mjs");
  return s.includes('for (const file of ["favicon.svg", "apple-touch-icon.png", "og-image.png"]) {\n  cpSync(join(ROOT, file), join(DIST, file));');
});
{
  const dist = join(ROOT, "dist");
  const newest = Math.max(...[...FILES, "TURN.html"].map(f=>statSync(join(ROOT, f)).mtimeMs));
  const fresh = existsSync(join(dist, "index.html")) && statSync(join(dist, "index.html")).mtimeMs >= newest;
  if(!fresh) console.log("SKIP F dist/ contents — dist/ is absent or older than the identity files (run node scripts/build-dist.mjs)");
  else check("F the built dist/ holds byte-identical copies and index.html keeps the icon and share tags", ()=>{
    const idx = readFileSync(join(dist, "index.html"), "utf8");
    return FILES.every(f=>existsSync(join(dist, f)) && readFileSync(join(dist, f)).equals(readFileSync(join(ROOT, f))))
      && idx.includes('href="apple-touch-icon.png?v='+KEY+'"') && idx.includes('<meta property="og:image" content="'+HOST+'og-image.png?v='+KEY+'" />')
      && idx.includes('<meta name="twitter:card" content="summary_large_image" />') && idx.includes('href="favicon.svg?v='+KEY+'"');
  });
}

/* ── G. the wider lockup at narrow widths (review 2026-09-29) ─────────────────────────
   The lockup (mark + 23px-class Spectral wordmark) is wider than the old wordmark. Measured in the
   app (the screenshot harness, dark theme, sample film): at 820px the room chip ran 8px under the
   Appearance toggle, at 800 28px, at 768 18px over Team, and 701–760 deeper still. The fix is
   pinned here from the cascade: at ≤900px the TOP BAR shows the mark alone, and at 701–900 the
   right-hand buttons keep their size while the film chip yields (its title ellipsizes). The phone
   rule that hides the wordmark is scoped to the top bar, so the post-checkout cards keep theirs. */
const mediaBlocks = (q)=>{ const out = []; let i = 0; const head = "@media "+q+"{";
  while((i = css.indexOf(head, i))>=0){ let d = 0, j = i+head.length-1;
    for(; j < css.length; j++){ if(css[j]==="{") d++; else if(css[j]==="}"){ d--; if(d===0) break; } }
    out.push(css.slice(i+head.length, j)); i = j; }
  return out; };
check("G ≤900px: the top bar shows the mark alone; the rule is scoped to the top bar (no bare .brand-name hide anywhere)", ()=>
  mediaBlocks("(max-width:900px)").some(b=>/\n\s*\.topbar \.brand-name\{display:none\}/.test(b))
  && !/(^|[\s,{}])\.brand-name\{display:none\}/.test(css.replace(/\.topbar \.brand-name\{display:none\}/g, "")));
check("G 701–900px: the right-hand buttons keep their size and the film chip can shrink (its title ellipsizes)", ()=>
  mediaBlocks("(min-width:701px) and (max-width:900px)").some(b=>/\.tb-right\{flex:0 0 auto\}/.test(b) && /\.tb-left \.proj-wrap\{display:flex;min-width:0\}/.test(b))
  && /\.proj-btn \.proj-name\{[^}]*min-width:0;[^}]*overflow:hidden;text-overflow:ellipsis\}/.test(css));
check("G the welcome cards (after checkout, and the trial welcome) keep the whole lockup on a phone (the mark + 'Kinolot')", ()=>{
  const s = read("app/plans.jsx");
  return (s.match(/React\.createElement\("span",\{className:"brand-name"\},"Kinolot"\)/g) || []).length===3
    && /\n\.welcome-brand \.brand-name\{/.test(css);
});
/* the same review's other narrow-width fixes (measured in the harness; pinned from the source) */
check("G 641–960px: the Art Room's view tabs go icon-only so its eight tabs + three actions fit (nothing off-screen)", ()=>
  read("app/chrome.jsx").includes('className:"viewnav"+(inArt?" viewnav-art":"")')
  && mediaBlocks("(min-width:641px) and (max-width:960px)").some(b=>/\.viewnav-art \.seg \.seg-lab\{display:none\}/.test(b)));
check("G phone: the room menu is pinned to the viewport at the desktop width (room names on one line)", ()=>
  mediaBlocks("(max-width:700px)").some(b=>/\.context-group \.room-menu\{position:fixed;top:54px;left:8px;right:auto;\s*min-width:0;width:min\(304px,calc\(100vw - 16px\)\)/.test(b)));
check("G phone: the sign-up plan chip's note takes its own line without an orphaned '·'", ()=>{
  const s = read("app/auth-ui.jsx");
  return s.includes('React.createElement("span",{className:"auth-plan-sep","aria-hidden":"true"},"·")') && s.includes('React.createElement("span",{className:"auth-plan-note"}, !planObj ? "choose a plan any time"')
    && s.includes(': mode==="signup" ? "checkout opens after signup" : "checkout opens after sign-in")')
    && mediaBlocks("(max-width:440px)").some(b=>/\.auth-plan-sep\{display:none\}/.test(b) && /\.auth-plan-note\{flex-basis:100%;padding-left:17px\}/.test(b));
});
for(const f of ["privacy.html", "terms.html"]) check("G "+f+": at ≤400px the header lockup steps down (as Home's) and the back link never wraps", ()=>{
  const s = read(f);
  return s.includes(".back{white-space:nowrap}") && /@media \(max-width:400px\)\{ \.logo\{font-size:20px;gap:8px\} \.logo \.mark\{width:27px;height:15px\} \}/.test(s)
    && /@media \(max-width:360px\)\{[^\n]*\.back\{padding:8px 12px;/.test(s);
});

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);
