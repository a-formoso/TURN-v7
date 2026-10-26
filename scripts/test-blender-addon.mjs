/*
 * Static/AST checks for the desktop add-on.  A real Blender render is kept in
 * test-blender-addon-render.py so CI can run it only when Blender is present.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const addon = path.join(root, "blender", "kinolot_bridge");
const files = ["__init__.py", "protocol.py", "renderer.py"].map((name) => path.join(addon, name));

for (const file of files) {
  if (!fs.existsSync(file)) throw new Error(`Missing add-on source: ${file}`);
}

const astScript = String.raw`
import ast, pathlib, sys
for raw in sys.argv[1:]:
    path = pathlib.Path(raw)
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in {"eval", "exec", "compile", "__import__"}:
                raise SystemExit(f"forbidden dynamic execution in {path}")
        if isinstance(node, ast.Import):
            for item in node.names:
                if item.name in {"subprocess", "ctypes"}:
                    raise SystemExit(f"forbidden process import in {path}")
        if isinstance(node, ast.ImportFrom) and node.module in {"subprocess", "ctypes"}:
            raise SystemExit(f"forbidden process import in {path}")
`;

const python = spawnSync("python3", ["-c", astScript, ...files], {
  cwd: root,
  encoding: "utf8",
  timeout: 30000,
});
if (python.error && python.error.code !== "ENOENT") {
  throw python.error;
}
if (!python.error && python.status !== 0) {
  process.stderr.write(python.stderr || python.stdout || "Python AST validation failed\n");
  process.exit(python.status || 1);
}
if (python.error?.code === "ENOENT") {
  process.stdout.write("python3 unavailable; performed source checks only\n");
}

const initSource = fs.readFileSync(files[0], "utf8");
const protocolSource = fs.readFileSync(files[1], "utf8");
const rendererSource = fs.readFileSync(files[2], "utf8");
if (!initSource.includes("bl_info") || !initSource.includes('"blender": (4, 2, 0)')) {
  throw new Error("legacy Blender 4.2 bl_info is missing");
}
if (!initSource.includes("bpy.app.timers.register") || !initSource.includes("threading.Thread")) {
  throw new Error("main-thread timer and network worker boundary is missing");
}
if (!protocolSource.includes("https") || !protocolSource.includes("device.claim")) {
  throw new Error("HTTPS/device.claim protocol implementation is missing");
}
if (protocolSource.includes("import bpy") || protocolSource.includes("from bpy")) {
  throw new Error("protocol.py must remain importable without Blender");
}
if (!rendererSource.includes('scene.render.engine = "CYCLES"') || !rendererSource.includes('scene.cycles.device = "CPU"')) {
  throw new Error("renderer is not fixed to CPU Cycles");
}

const build = spawnSync(process.execPath, [path.join(root, "scripts", "build-blender-addon.mjs")], {
  cwd: root,
  encoding: "utf8",
  timeout: 30000,
});
if (build.status !== 0) {
  process.stderr.write(build.stderr || build.stdout || "add-on build failed\n");
  process.exit(build.status || 1);
}
const zip = path.join(root, "app", "downloads", "cinema-machine-blender.zip");
if (!fs.existsSync(zip) || fs.statSync(zip).size < 1000) {
  throw new Error("add-on ZIP was not produced");
}
const addonDataPath=path.join(root,"app","blender-addon-data.js");
if(!fs.existsSync(addonDataPath)) throw new Error("generated app/blender-addon-data.js is missing");
const packageBytes=fs.readFileSync(zip);
const evaluateBundle=(bundlePath,label)=>{
  const sandbox={window:{}};
  vm.runInNewContext(fs.readFileSync(bundlePath,"utf8"),sandbox,{filename:bundlePath});
  const bundle=sandbox.window.CinemaMachineBlenderAddon;
  if(!bundle || !Object.isFrozen(bundle)) throw new Error(`${label} add-on data is missing or not frozen`);
  if(bundle.filename!=="cinema-machine-blender.zip" || bundle.byteLength!==packageBytes.length)
    throw new Error(`${label} add-on metadata does not match the packaged ZIP`);
  if(!Buffer.from(bundle.base64,"base64").equals(packageBytes))
    throw new Error(`${label} add-on bytes do not match the packaged ZIP`);
  return fs.readFileSync(bundlePath,"utf8");
};
const sourceBundle=evaluateBundle(addonDataPath,"source");
const sourceHtml=fs.readFileSync(path.join(root,"TURN.html"),"utf8");
const sourceAddon=sourceHtml.indexOf('src="app/blender-addon-data.js');
const sourceUi=sourceHtml.indexOf('src="app/blender-preview-ui.jsx');
if(sourceAddon<0 || sourceUi<sourceAddon) throw new Error("source HTML loads Blender UI before add-on data");
const distDataPath=path.join(root,"dist","app","blender-addon-data.js");
if(fs.existsSync(distDataPath)){
  const distBundle=evaluateBundle(distDataPath,"production");
  const distHtmlPath=path.join(root,"dist","index.html");
  if(!fs.existsSync(distHtmlPath)) throw new Error("dist bundle exists without dist/index.html");
  const distHtml=fs.readFileSync(distHtmlPath,"utf8");
  const distAddon=distHtml.indexOf('src="app/blender-addon-data.js');
  const distUi=Math.max(distHtml.indexOf('src="app/blender-preview-ui.jsx'),distHtml.indexOf('src="app/blender-preview-ui.js'));
  if(distAddon<0 || distUi<distAddon) throw new Error("production HTML loads Blender UI before add-on data");
  const expectedTag=crypto.createHash("sha256").update(sourceBundle).digest("hex").slice(0,16);
  const actualTag=distHtml.match(/src="app\/blender-addon-data\.js\?v=([^"]+)"/)?.[1];
  if(actualTag!==expectedTag) throw new Error("production add-on cache tag is not content-derived");
}
process.stdout.write("Blender add-on source, AST, and ZIP checks passed\n");
