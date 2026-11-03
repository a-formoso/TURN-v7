// An expired signed storage link is refreshed before it's used as a render reference (2026-11-01: a beat's frame
// was rendered without its location view because the cached link had expired and the fetch failed quietly).
import { readFileSync } from "node:fs";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0;
const check=(ok,msg)=>{ checks++; if(!ok){ console.error("FAIL: "+msg); process.exit(1); } };

const img=read("app/imagegen.jsx"), shots=read("app/shots.jsx");
const start=img.indexOf("function nbSignedUrlStale(u){");
check(start>=0,"imagegen.jsx defines nbSignedUrlStale");
const end=img.indexOf("\nwindow.nbSignedUrlStale",start);
const nbSignedUrlStale=new Function("atob",img.slice(start,end)+"\nreturn nbSignedUrlStale;")(s=>Buffer.from(s,"base64").toString("binary"));

const b64url=o=>Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const link=exp=>"https://x.supabase.co/storage/v1/object/sign/turn-assets/a/b.png?token="+b64url({alg:"HS256"})+"."+b64url({url:"a/b.png",exp})+".sig";
const now=Math.floor(Date.now()/1000);
check(nbSignedUrlStale(link(now-1800))===true,"A link that expired half an hour ago is stale");
check(nbSignedUrlStale(link(now+30))===true,"A link with under a minute left is refreshed too");
check(nbSignedUrlStale(link(now+3600))===false,"A link with an hour left is used as it is");
check(nbSignedUrlStale("data:image/png;base64,AAAA")===false&&nbSignedUrlStale("blob:http://localhost/x")===false,"Data and blob URLs are never stale");
check(nbSignedUrlStale("https://x.supabase.co/storage/v1/object/sign/turn-assets/a.png?token=garbage")===false,"An unreadable token is left alone");

check(/const cached=_cloudUrlCache\.get\(id\);\s*if\(cached && nbSignedUrlStale\(cached\)\) return nbRefreshImage\(id, cached\);/.test(img),"nbLoadImage refreshes a stale cached link instead of returning it");
check(/if\(u && typeof nbSignedUrlStale==="function" && nbSignedUrlStale\(u\) && typeof nbRefreshImage==="function"\)\{\s*try\{ u = \(await nbRefreshImage\(id, u\)\) \|\| u; \}/.test(shots),"shotGrabImage (every shot reference) refreshes a stale link before the render uses it");
const html=read("TURN.html");
check(["20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1"].some(k=>html.includes('app/imagegen.jsx?v='+k+'"'))&&["20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1"].some(k=>html.includes('app/shots.jsx?v='+k+'"')),"The changed files have new cache keys");
console.log(`PASS signed url refresh: ${checks} checks`);
