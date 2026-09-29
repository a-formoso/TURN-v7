/* build-dist.mjs — production build for the buildless app.
   DEV stays buildless (TURN.html + raw .jsx via Babel standalone). This script
   runs only in the deploy build step and assembles dist/:
     • every app/*.jsx  → transpiled (preset-react) + minified .js
                          (comments stripped, names mangled; TOP-LEVEL names
                          kept — files talk to each other via globals)
     • every other app/ asset (css, plain .js) → copied (plain .js minified)
     • TURN.html → dist/index.html with type="text/babel" tags rewritten to
       plain .js tags and the Babel-standalone CDN tag removed
   Why: (1) the deployed site no longer ships raw commented source — the
   casual read-the-cookbook leak is closed (string literals do survive
   minification; server-side prompt assembly is the real fix, on the roadmap);
   (2) no in-browser transpile in production — boot goes from ~25s to ~instant.
   Deps (installed by the deploy build command, never committed):
     @babel/core @babel/preset-react terser */
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { transformSync } from "@babel/core";
import { minify } from "terser";

const ROOT = process.cwd();
const APP  = join(ROOT, "app");
const DIST = join(ROOT, "dist");
// Keep the downloadable desktop add-on and relay's scene schema in sync with
// source. This does not run Blender or contact the relay.
await import("./build-blender-addon.mjs");
cpSync(join(APP, "blender-contract.js"), join(ROOT, "supabase", "functions", "blender-bridge", "shared-contract.js"));
// One storage-key parser for the app and the three Edge Functions that build or
// check object keys (readable folders, 2026-09-27). Byte-for-byte copies;
// scripts/test-storage-keys.mjs fails if one drifts.
for (const fn of ["image-proxy", "blender-bridge", "admin-storage"])
  cpSync(join(APP, "storage-keys.js"), join(ROOT, "supabase", "functions", fn, "storage-keys.js"));
mkdirSync(join(DIST, "app"), { recursive: true });

async function minifyJs(code, label){
  const out = await minify(code, {
    compress: { passes: 2 },
    mangle: true,                      // toplevel:false (default) — globals survive
    format: { comments: false },
  });
  if (out.error) throw new Error(label + ": " + out.error);
  return out.code;
}

let built = 0, copied = 0;
for (const f of readdirSync(APP)) {
  const src = join(APP, f);
  if (statSync(src).isDirectory()) { cpSync(src, join(DIST, "app", f), { recursive: true }); copied++; continue; }
  const ext = extname(f);
  if (ext === ".jsx") {
    const t = transformSync(readFileSync(src, "utf8"), {
      // classic runtime → JSX compiles to React.createElement against the global
      // React UMD (no "react/jsx-runtime" imports, which a classic <script> can't use).
      presets: [["@babel/preset-react", { runtime: "classic" }]],
      // lower top-level const/let → var, matching what Babel-standalone does in the
      // buildless dev app: files are separate classic <script>s sharing one global
      // scope, so block-scoped top-level names would throw on any cross-file or
      // re-exec collision. var redeclaration is harmless — this keeps prod identical
      // to the semantics the app already ships under.
      plugins: ["@babel/plugin-transform-block-scoping"],
      comments: false, compact: false, babelrc: false, configFile: false,
      filename: f,
    });
    writeFileSync(join(DIST, "app", f.replace(/\.jsx$/, ".js")), await minifyJs(t.code, f));
    built++;
  } else if (ext === ".js") {
    writeFileSync(join(DIST, "app", f), await minifyJs(readFileSync(src, "utf8"), f));
    built++;
  } else {
    cpSync(src, join(DIST, "app", f));
    copied++;
  }
}

let html = readFileSync(join(ROOT, "TURN.html"), "utf8");
// Studio's browser client must see both the shared workspace contract and the
// existing authenticated BlenderPreview transport before its React surface.
// Keep this assertion here because production preserves the source tag order.
const studioOrder=["app/blender-preview.js","app/blender-studio-contract.js","app/blender-studio.js","app/blender-preview-ui.jsx","app/blender-studio-setup.jsx","app/blender-studio-ui.jsx"];
let prior=-1;
for(const name of studioOrder){
  const at=html.indexOf(name);
  if(at<0||at<=prior) throw new Error("Blender Studio script order is incomplete: "+name);
  prior=at;
}
// The screenplay contract is evaluated lazily by videogen, after startup. Its
// source readers and UI must nevertheless load in order before Stage mounts.
const screenplayOrder=["app/shot-screenplay.js","app/shot-scene-context.js","app/stage-screenplay.js","app/stage-screenplay-images.js","app/stage-screenplay-ui.jsx","app/stage-director-brief.js","app/stage.jsx"];
prior=-1;
for(const name of screenplayOrder){
  const at=html.indexOf(name);
  if(at<0||at<=prior) throw new Error("Stage screenplay script order is incomplete: "+name);
  prior=at;
}
// The installer changes independently of UI code. Invalidate its production
// script URL whenever the generated bytes change, not only on a UI release.
const addonHash = createHash("sha256").update(readFileSync(join(APP, "blender-addon-data.js"))).digest("hex").slice(0, 16);
html = html.replace(/src="app\/blender-addon-data\.js(?:\?[^"]*)?"/,
  `src="app/blender-addon-data.js?v=${addonHash}"`);
const before = html.length;
html = html.replace(/<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"[^>]*><\/script>\s*\n?/, "");
html = html.replace(/<script type="text\/babel" src="(app\/[^"?]+)\.jsx(\?[^"]*)?"><\/script>/g,
                    '<script src="$1.js$2"></script>');
if (html.includes("text/babel") || html.includes("@babel/standalone"))
  throw new Error("index.html rewrite incomplete — babel references remain");
if (html.length === before) throw new Error("index.html rewrite made no changes");
writeFileSync(join(DIST, "index.html"), html);

// standalone legal pages — self-contained static HTML, copied verbatim so the
// footer links (/privacy.html, /terms.html) work on the deployed site
for (const page of ["privacy.html", "terms.html"]) {
  cpSync(join(ROOT, page), join(DIST, page));
  copied++;
}
// the identity files TURN.html links from the site root: the browser-tab icon, the app icon and
// the share image (og:image points at https://kinolot.infinitestudioai.com/og-image.png)
for (const file of ["favicon.svg", "apple-touch-icon.png", "og-image.png"]) {
  cpSync(join(ROOT, file), join(DIST, file));
  copied++;
}

console.log(`dist/ built: ${built} js files transpiled+minified, ${copied} assets copied, index.html rewritten (no Babel).`);
