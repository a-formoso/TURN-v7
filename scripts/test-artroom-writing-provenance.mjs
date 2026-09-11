import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file)=>fs.readFileSync(path.join(root,file),"utf8");
const ai = read("app/ai.jsx");
const art = read("app/artroom.jsx");
const app = read("app/app.jsx");
const lookbook = read("app/lookbook.jsx");
const locations = read("app/locations.jsx");
const shots = read("app/shots.jsx");
const shotsUi = read("app/shots-ui.jsx");

const checks = [
  ["writing stamp accepts a task", ai.includes("function writingStamp(task)") && ai.includes("...(task?{task}:{})")],
  ["character specs are stamped", ai.includes('writingStamp("Character specification")')],
  ["prop specs are stamped", ai.includes('writingStamp("Prop specification")')],
  ["location specs are stamped", ai.includes('writingStamp("Location specification")')],
  ["location staging is stamped", ai.includes('writingStamp("Staging & composition")')],
  ["lookbook research is stamped", ai.includes('writingStamp("Lookbook research")')],
  ["style bible is stamped", ai.includes('writingStamp("Style bible")') && app.includes("res.writingProvenance?{writingProvenance")],
  ["appearance states are stamped", ai.includes('writingStamp("Appearance state")')],
  ["shot specs are stamped", ai.includes('writingStamp("Shot specification")')],
  ["lookbook cards persist research provenance", app.includes("r.writingProvenance?{writingProvenance")],
  ["shot normalization preserves provenance", shots.includes("writingProvenance: raw.writingProvenance")],
  ["shared generation snapshots writing sources", art.includes("writingSources = nbWritingSourcesFor(sourceEntity)")],
  ["shared generation records the prompt compiler", art.includes('promptCompiler:"TURN prompt compiler"')],
  ["details separates writing and prompt provenance", art.includes("Writing & prompt provenance") && art.includes("Render prompt")],
  ["lookbook card generation supplies the source entity", /id: c\.id, slotId: "lookref-"\+c\.id,\s*entity: c/.test(lookbook)],
  ["headless lookbook preserves provenance", lookbook.includes("writingSources:(c.writingProvenance&&c.writingProvenance.model)")],
  ["headless locations preserve provenance", locations.includes("window.nbWritingSourcesFor(entity)")],
  ["shot prompts snapshot all written inputs", shots.includes("function shotWritingSources(sh,ctx)") && shots.includes("shotWritingSources(sh,ctx)")],
  ["shot card generation supplies the source entity", /id: sh\.id, slotId: "shot-"\+sh\.id,\s*entity: sh/.test(shotsUi)],
];

let failed = 0;
for(const [name,ok] of checks){
  if(ok) console.log("PASS",name);
  else { failed++; console.error("FAIL",name); }
}
if(failed) process.exit(1);
console.log(`${checks.length} passed, 0 failed`);
