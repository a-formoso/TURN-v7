/* Storage tidy (owner, 2026-09-26): new files land in readable folders below the two
   security folders — storyboard, lookbook and location plates get their own folders,
   appearance states nest inside their character, names lead with one shared timestamp,
   the extension is the real file type, cameo angles read as words.
   Readable top folders (owner, 2026-09-27): the two security folders themselves may now
   read "{name}--{uuid}" (account, then project), handed out by the server; the uuid is the
   only thing the server checks, and old "{uid}/{projectId}/…" keys keep working. The
   uploader resolves the folders once per save, and the only key parsers (the Show
   deletion scope check and the imagegen scope check) read the id through
   app/storage-keys.js. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const cloud=read("app/cloud.jsx");
const box={console,crypto:{randomUUID:()=>"abcd1234-0000-4000-8000-000000000000"}}; box.window=box; vm.createContext(box);
vm.runInContext(read("app/storage-keys.js"),box);
const a=cloud.indexOf("function turnSafeSeg("), b=cloud.indexOf("window.turnAssetFolder = turnAssetFolder;");
vm.runInContext(cloud.slice(a,b),box);
const K=box.TurnStorageKeys;
const U="8d3e4f10-0000-4000-8000-000000000001", P="5a7b1c22-0000-4000-8000-000000000002", S="20260926-101500";

await test("each kind of asset gets its own readable folder",()=>{
  const f=(kind,id)=>box.turnAssetFolder(kind,id);
  assert.equal(f("character","adem"),"character");
  assert.equal(f(undefined,"sbsheet-sbpage-gmrjwja0"),"storyboard","storyboards used to land in character/");
  assert.equal(f(undefined,"sbsheet-p1:half-top"),"storyboard");
  assert.equal(f("asset","look-k3j2"),"lookbook","lookbook frames used to land in asset/");
  assert.equal(f("asset","charscale-adem"),"character");
  assert.equal(f("asset","loc-harbor-0-cov1"),"location","location coverage used to land in asset/");
  assert.equal(f("locunit","locunit-harbor-7f3a"),"location","slugline units used to have their own locunit/");
  assert.equal(f("prop","prop-knife"),"prop"); assert.equal(f("shot","shot-s3-2"),"shot"); assert.equal(f("cameo","adem"),"cameo");
  assert.equal(f("asset","mystery-1"),"other"); assert.equal(f(undefined,"adem"),"character","a commit with no kind stays a character sheet");
});

await test("appearance states nest inside their character; names lead with one timestamp and the real extension",()=>{
  const p=box.turnStoragePath(U,P,"adem:st-mrnfi0nm-0","character","sheet","jpg",3,S);
  assert.equal(p,U+"/"+P+"/character/adem/states/st-mrnfi0nm-0/"+S+"-sheet-v3-abcd1234.jpg");
  assert.equal(box.turnStoragePath(U,P,"sbsheet-p1:half-top",undefined,"sheet","png",1,S),U+"/"+P+"/storyboard/sbsheet-p1/half-top/"+S+"-sheet-v1-abcd1234.png");
  assert.equal(box.turnStoragePath(U,P,"neo","character","ref-owner","webp",undefined,S),U+"/"+P+"/character/neo/"+S+"-ref-owner-abcd1234.webp");
  // legacy form: uploader id first, project id second, at least 4 folders
  const parts=p.split("/"); assert.equal(parts[0],U); assert.equal(parts[1],P); assert.ok(parts.length-1>=4);
  assert.equal(K.uid(p),U); assert.equal(K.projectId(p),P);
  assert.ok(!p.includes(":"),"no colons in new keys");
  assert.equal(box.turnExtForMime("image/jpeg"),"jpg"); assert.equal(box.turnExtForMime("image/webp"),"webp"); assert.equal(box.turnExtForMime("image/png"),"png"); assert.equal(box.turnExtForMime(""),"png");
  assert.equal(box.turnReadableSeg("¾ Left","angle"),"three-quarter-left"); assert.equal(box.turnReadableSeg("Front","angle"),"front"); assert.equal(box.turnReadableSeg("","angle"),"angle");
});

await test("readable top folders: name first, full id last; everything below folder 2 is unchanged",()=>{
  const acct="wai-suk-ying--"+U, proj="pine-soot--"+P;
  const p=box.turnStoragePath(acct,proj,"wai-suk-ying","character","sheet","png",1,"20260927-101500");
  assert.equal(p,acct+"/"+proj+"/character/wai-suk-ying/20260927-101500-sheet-v1-abcd1234.png");
  assert.equal(K.uid(p),U,"the server reads only the uuid of folder 1");
  assert.equal(K.projectId(p),P,"and of folder 2");
  const legacy=box.turnStoragePath(U,P,"wai-suk-ying","character","sheet","png",1,"20260927-101500");
  assert.equal(p.split("/").slice(2).join("/"),legacy.split("/").slice(2).join("/"),"positions below folder 2 never moved");
  assert.equal(K.parse(p).area,"asset");
  assert.ok(p.length<=1024,"far below the reservation's 1024-character cap");
});

await test("the uploader resolves the folders once per save and checks every readable key before reserving it",()=>{
  assert.ok(cloud.includes("turnStoragePath(useFolders.account, useFolders.project, entityId, assetType, role, turnExtForMime(blob.type), version, stamp)"));
  assert.ok(cloud.includes("turnStoragePath(uid, projectId, entityId, assetType, role, turnExtForMime(blob.type), version, stamp)"),"the legacy rebuild");
  assert.ok(/useFolders\.readable && !_turnPathInScope\(path, uid, projectId\)/.test(cloud),"a readable key must parse back to this uploader and project");
  assert.ok(cloud.includes('const saveStamp = turnStamp();')&&cloud.includes('const saveFolders = await turnStorageFolders(activeClient, uid, projectId);'));
  assert.ok(cloud.includes('"sheet", ver, false, uploadDiagnostics, saveStamp, saveFolders)')&&cloud.includes(',undefined,true,undefined,saveStamp,refFolders)'));
  assert.ok(cloud.includes('const refFolders = _turnFoldersOfPath(newPath, uid, projectId) || saveFolders;'),"references follow the sheet's real prefix");
  assert.ok(cloud.includes('"cameo", turnReadableSeg(a.label, "angle"),')&&cloud.includes("let cameoFolders = await turnStorageFolders(sb, uid, projectId);"));
  assert.ok(/async function cloudRenameProject[\s\S]{0,900}?turnStorageFoldersForget\(id\)/.test(cloud),"a rename asks the server again");
  assert.ok(/sb\.rpc\("turn_storage_folders",\{p_project_id:projectId\}\)/.test(cloud),"the RPC argument name matches the SQL");
  assert.ok(/cfg\.readableStorageKeys===false/.test(cloud)&&/readableStorageKeys: true/.test(read("app/supabase-config.js")),"the client kill switch");
});

await test("the only key parsers read folder ids through app/storage-keys.js",()=>{
  const img=read("app/imagegen.jsx");
  const scope=img.slice(img.indexOf("async function cloudLatestBytesForScope"),img.indexOf("let _byteQueue"));
  assert.ok(/keys\.projectId\(recPath\)/.test(scope)&&/recScope===String\(scope\|\|""\)/.test(scope),"imagegen validates the project scope by its id");
  const scoped=cloud.slice(cloud.indexOf("function _seriesScopedStoragePath"),cloud.indexOf("function _seriesReferencedPaths"));
  assert.ok(/keys\.segmentId\(parts\[0\]\)/.test(scoped)&&/keys\.segmentId\(parts\[1\]\)/.test(scoped)&&/projectIds\.has\(project\)/.test(scoped));
  assert.ok(!/\[1-5\]\[0-9a-f\]\{3\}/.test(scoped),"the v1-5 uuid regex is gone");
  const html=read("TURN.html");
  const keys=html.indexOf('src="app/storage-keys.js?v='), cl=html.indexOf('src="app/cloud.jsx?v='), ig=html.indexOf('src="app/imagegen.jsx?v='), adm=html.indexOf('src="app/admin-storage.jsx?v=');
  assert.ok(keys>0&&keys<cl&&keys<ig&&keys<adm,"TURN.html loads the parser before its users");
  assert.ok(!/type="text\/babel" src="app\/storage-keys/.test(html),"a plain script");
});

await test("executed: the Show-deletion scope check reads both folders' ids and keeps anything else as unsafe",()=>{
  const sbox={console}; sbox.window=sbox; vm.createContext(sbox);
  vm.runInContext(read("app/storage-keys.js"),sbox);
  const slice=(from,to)=>{ const i=cloud.indexOf(from), j=cloud.indexOf(to,i+1); assert.ok(i>=0&&j>i,from); return cloud.slice(i,j); };
  vm.runInContext(slice("function _turnStorageKeys(","/* the server refused a readable key")
    +slice("function _seriesScopedStoragePath(","function _seriesReferencedPaths(")+"\nthis.scoped=_seriesScopedStoragePath;",sbox);
  const OTHER="0de1e7ed-0000-4000-8000-000000000005", scope=new Set([P]);
  const f=(path)=>JSON.parse(JSON.stringify(sbox.scoped(path,scope)));
  const tail="/character/adem/20260927-101500-sheet-v1-abcd1234.png";
  assert.deepEqual(f(U+"/"+P+tail),{path:U+"/"+P+tail,safe:true,inScope:true},"legacy key in the Show");
  assert.deepEqual(f("alex--"+U+"/pine-soot--"+P+tail),{path:"alex--"+U+"/pine-soot--"+P+tail,safe:true,inScope:true},"readable key in the Show");
  assert.deepEqual(f("alex--"+U+"/other--"+OTHER+tail).inScope,false,"readable key of another project: safe but out of scope");
  assert.equal(f(U+"/"+OTHER+tail).inScope,false);
  const unsafe=["not-an-id/"+P+tail,"Alex--"+U+"/"+P+tail,U.toUpperCase()+"/"+P+tail,"b2444e18a-5133-4155-bb2f-d2719dcdb442--"+U+"/"+P+tail,
    "_internal/"+P+tail,U+"/Pine--"+P+tail,U+"/"+P.toUpperCase()+tail,U+"/stage-tmp/1759000000000-video-a.mp4",U+"/"+P,U+"/"+P+"/../x.png","alex--"+U+"/"+P+"//x.png"];
  for(const path of unsafe) assert.equal(f(path).safe,false,"unsafe: "+path);
  for(const path of unsafe) assert.equal(f(path).inScope,false,"never in scope: "+path);
  assert.equal(sbox.scoped("/"+U+"/"+P+tail,scope),null); assert.equal(sbox.scoped("",scope),null);
  // without the parser nothing is safe (the fail-safe direction: files are kept)
  const nbox={console}; nbox.window=nbox; vm.createContext(nbox);
  vm.runInContext(slice("function _turnStorageKeys(","/* the server refused a readable key")
    +slice("function _seriesScopedStoragePath(","function _seriesReferencedPaths(")+"\nthis.scoped=_seriesScopedStoragePath;",nbox);
  assert.equal(nbox.scoped(U+"/"+P+tail,scope).safe,false,"parser missing → unsafe → kept");
});

await test("executed: imagegen's entity-cache scope check matches readable and legacy records by project id",async()=>{
  const img=read("app/imagegen.jsx");
  const i=img.indexOf("function nbCloudKey("), j=img.indexOf("let _byteQueue");
  assert.ok(i>0&&j>i);
  const run=async(withParser,rec,scope)=>{
    const ibox={console,Map,URL:{createObjectURL:()=> "blob:cached",revokeObjectURL(){}},
      idbGet:async()=>rec};
    ibox.window=ibox; vm.createContext(ibox);
    if(withParser) vm.runInContext(read("app/storage-keys.js"),ibox);
    vm.runInContext(img.slice(i,j)+"\nthis.latest=cloudLatestBytesForScope;",ibox);
    return ibox.latest("adem",scope);
  };
  const OTHER="0de1e7ed-0000-4000-8000-000000000005", blob={size:1};
  const readable={path:"alex--"+U+"/pine-soot--"+P+"/character/adem/x.png",blob};
  const legacy={path:U+"/"+P+"/character/adem/x.png",blob};
  assert.equal(await run(true,readable,P),"blob:cached","a readable cached record serves its own project");
  assert.equal(await run(true,readable,OTHER),"","…never another project's (entity ids repeat across films)");
  assert.equal(await run(true,legacy,P),"blob:cached","legacy records keep matching");
  assert.equal(await run(true,legacy,OTHER),"");
  assert.equal(await run(true,{path:"alex--"+U+"/Pine-Soot--"+P+"/character/adem/x.png",blob},P),"","a malformed project folder never matches");
  assert.equal(await run(true,{path:"alex--"+U+"/"+P.toUpperCase()+"/character/adem/x.png",blob},P),"","nor an uppercase one");
  assert.equal(await run(true,{path:readable.path},P),"","no blob, no hit");
  assert.equal(await run(false,legacy,P),"blob:cached","parser missing: the pre-2026-09-27 legacy check");
  assert.equal(await run(false,readable,P),"","parser missing: a readable record is simply re-downloaded");
});

console.log(checks+" checks passed");
