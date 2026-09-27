#!/usr/bin/env node
/* Upload error redaction (app/cloud.jsx _seriesSafeUploadMessage). User-visible upload
   errors keep the actionable reason but never echo a URL, token, object key or scoped id.
   2026-09-27: the keyword groups were non-capturing, so "$1" printed literally
   ("the caller $1 [redacted]", "$1=[redacted]"), and an object key that began with a
   uuid kept its tail ("[redacted-id]/[redacted-id]/character/…png", or a readable
   folder's handle and project name). Dependency-free: runs the real function in a vm. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

let passed=0, failed=0;
const ok=(name, condition, detail)=>{
  if(condition) passed++;
  else{ failed++; console.error("FAIL "+name+(detail!==undefined?" — "+JSON.stringify(detail):"")); }
};

const src=readFileSync("app/cloud.jsx","utf8");
const a=src.indexOf("function _seriesSafeUploadMessage("), b=src.indexOf("function _seriesUploadErrorMeta(");
ok("the function is found in app/cloud.jsx", a>0 && b>a);
const box={}; vm.createContext(box); vm.runInContext(src.slice(a,b),box);
const safe=(m)=>box._seriesSafeUploadMessage(m);

const UID="8d3e4f10-0000-4000-8000-000000000001", PID="5a7b1c22-0000-4000-8000-000000000002";
const RUID="b2444e18-5133-4155-bb2f-d2719dcdb442", RPID="0a02f906-6f1a-4ec8-b4b6-55f79e44c872";
const UUID_RE=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const cases=[
  { in:"TURN_ASSET_UPLOAD: path is outside the caller project scope",
    want:"TURN_ASSET_UPLOAD: path is outside the caller project [redacted]", gone:[] },
  { in:"token=abc123 password: hunter2 refresh_token: r3fr3sh",
    want:"token=[redacted] password=[redacted] refresh_token=[redacted]", gone:["abc123","hunter2","r3fr3sh"] },
  { in:"p_path='"+UID+"/"+PID+"/character/x/y.png'", gone:[UID,PID,"character/x/y.png"], has:"p_path=[redacted]" },
  { in:"project_id: "+PID+", user_id="+UID, gone:[PID,UID], has:"project_id=[redacted]" },
  { in:"new row violates row-level security policy for "+UID+"/"+PID+"/character/neo/20260927-101500-sheet-v1-abcd1234.png",
    want:"new row violates row-level security policy for [redacted-object]", gone:["character/neo","sheet-v1"] },
  { in:"denied for admin--"+RUID+"/sample-short-film--"+RPID+"/character/wai/20260927-101500-sheet-v1-ab12cd34.png",
    want:"denied for [redacted-object]", gone:["admin--","sample-short-film","character/wai"] },
  { in:"see https://example.supabase.co/storage/v1/object/sign/turn-assets/"+UID+"/x.png?token=abc",
    want:"see [redacted-url]", gone:["supabase.co","abc"] },
  { in:"owner id 12345 not allowed; user: bob", want:"owner [redacted] not allowed; user [redacted]", gone:["12345","bob"] },
  { in:"entity "+UID+" missing", want:"entity [redacted-id] missing", gone:[UID] },
];
for(const c of cases){
  const out=safe(c.in);
  ok("no literal $1 — "+c.in.slice(0,48), !/\$\d/.test(out), out);
  ok("no uuid survives — "+c.in.slice(0,48), !UUID_RE.test(out), out);
  for(const g of c.gone) ok("'"+g+"' is redacted — "+c.in.slice(0,40), !out.includes(g), out);
  if(c.want!==undefined) ok("exact text — "+c.in.slice(0,48), out===c.want, out);
  if(c.has!==undefined) ok("keeps the label '"+c.has+"'", out.includes(c.has), out);
}
// the actionable reason survives; an empty error falls back
ok("the database reason is kept", safe("TURN_ASSET_UPLOAD: upload reservation expired").includes("upload reservation expired"));
ok("fallback text when there is no error text", safe(null)==="Cloud upload failed." && safe("")==="Cloud upload failed.");

console.log(failed ? `${passed} passed, ${failed} failed` : `${passed} checks passed`);
if(failed) process.exit(1);
