#!/usr/bin/env node
/*
 * While a clip renders (2026-10-25, live test film — owner: "it's rendering … I don't see that in the player; I see
 * beat 1's video", "Connection blip — reconnecting to the render … if it's a bug, investigate it"):
 *  1 the player follows the picked clip: useSeedanceGen's url follows its id (the console stays mounted across a
 *    scene's clips, so 01B showed 01A's take and hid its own progress); a re-render shows progress over the take;
 *  2 the blip was a finished render whose video fal refused to hand over (422, likeness) — answered "poll again"
 *    for ever. A definitive refusal now ends it with the reason and releases the hold, in the poll and in the
 *    reconciliation; the app stops on a policy refusal even from an older server; the wording keeps the %.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {videoResultRefused} from "../supabase/functions/image-proxy/video-reconcile.mjs";

const vg=readFileSync("app/videogen.jsx","utf8"), stage=readFileSync("app/stage.jsx","utf8");
const proxy=readFileSync("supabase/functions/image-proxy/index.ts","utf8"), rec=readFileSync("supabase/functions/image-proxy/video-reconcile.mjs","utf8");
const css=readFileSync("app/styles.css","utf8"), ai=readFileSync("app/ai.jsx","utf8"), html=readFileSync("TURN.html","utf8");
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,300)); process.exit(1); } pass++; console.log("PASS "+name); };

t("1a the clip's video follows its id (no other clip's take in the player)", ()=>{
  const a=vg.indexOf("function useSeedanceGen(id){"), b=vg.indexOf("const generate = React.useCallback",a);
  const hook=vg.slice(a,b);
  assert.ok(hook.indexOf('setVideoUrl(vidGetVideo(id)||"");')>0 && hook.indexOf('setVideoUrl(vidGetVideo(id)||"");')<hook.indexOf("},[id]);"));
});
t("1b a re-render shows its progress over the take on screen", ()=>{
  assert.ok(stage.includes('gening && _stEl("div",{className:"stage2-player-genbadge",role:"status"},'));
  assert.ok(css.includes(".stage2-player-genbadge{position:absolute;"));
});
t("2a a definitive refusal of a finished video is final; 404 / 408 / 425 / 429 / 5xx stay temporary", ()=>{
  [400,403,410,422].forEach(n=>assert.equal(videoResultRefused(n),true,String(n)));
  [404,408,425,429,500,502,503].forEach(n=>assert.equal(videoResultRefused(n),false,String(n)));
});
t("2b the poll ends it with the provider's reason and releases the hold; the reconciliation releases it too", ()=>{
  assert.ok(proxy.includes('if (videoResultRefused(rr.status)) return await refunded(say(detail || `The video service refused to deliver this render (${rr.status}).`,'));
  assert.ok(proxy.includes('import { RECONCILE_OP, finishedVideoCharge, reconcileVideoHolds, videoResultRefused } from "./video-reconcile.mjs";'));
  assert.ok(proxy.includes("console.warn(`[image-proxy] video result ${job.rid} unavailable (${rr.status}): ${String(detail).slice(0, 300)}`);"));
  assert.ok(rec.includes("if (videoResultRefused(rr.status)) return await release(`the video service refused to deliver the finished video (${rr.status})`);"));
});
t("2c the app stops on a policy refusal even when an older server says to poll again; the % stays", ()=>{
  assert.ok(vg.includes('if(_vidPollRetryable(e) && !vidPolicyError(e)){ pollMiss = 0; statusHiccup = false; emit(lastPct ? "RECONNECTING · "+lastPct+"%" : "RECONNECTING"); continue; }'));
  assert.ok(stage.includes('.replace(/\\bRECONNECTING\\b/g,"Still rendering \\u2014 checking again")'));
  assert.ok(!stage.includes("\"Connection blip"));
});
t("2d Render settings says a refusal short, what it was sent with, what to change, and offers the text-only retry", ()=>{
  assert.ok(stage.includes('genErr && providerPolicyFailure && _stEl("div",{className:"stage2-err sd-gen-err policy"}'));
  assert.ok(stage.includes('"Video engines can mistake photoreal faces for real people. Untick "'));
  assert.ok(stage.includes('or set Workflow to Image to Video (the shot frame only), and Generate again'));
  assert.ok(stage.includes('canTextOnlyRecovery && _stEl("button",{type:"button",className:"sd-gen-err-act",'));
});
t("3 full screen that always works: every Stage player hides the video's own button and carries one that falls back to the window", ()=>{
  assert.ok(stage.includes("function _stageFsButton(getVideo, open){"));
  assert.equal((stage.match(/controlsList:"nofullscreen"/g)||[]).length, 5);   // Shoot, Takes, Timeline, Mix and the window view
  assert.equal((stage.match(/_stageFsButton\(/g)||[]).length, 5);            // the helper + four players
  assert.ok(stage.includes('vid.setAttribute("controlslist","nofullscreen");'));
  assert.ok(stage.includes("setTimeout(()=>{ if(!document.fullscreenElement && !document.webkitFullscreenElement) overlay(); }, 600);"));
  assert.ok(css.includes(".stage2-player-fs{position:absolute;bottom:58px;right:12px;"));
  // (2026-10-25) in a Chromium browser the button sits in the control bar's own full-screen slot, between volume and ⋮
  assert.ok(css.includes(".stage2-fs-wrap:not(.cr) video::-webkit-media-controls-fullscreen-button{display:none!important}"));
  assert.ok(css.includes(".stage2-fs-wrap.cr video::-webkit-media-controls-fullscreen-button{display:block!important;visibility:hidden!important}"));
  assert.ok(css.includes(".stage2-fs-wrap.cr .stage2-player-fs{bottom:32px;right:52px;"));
  assert.equal((stage.match(/className:"stage2-fs-wrap"\+\(STAGE_FS_SLOT\?" cr":""\)/g)||[]).length, 5);   // four players + the window view
  assert.ok(stage.includes('box.className = "stage2-fs-wrap"+(STAGE_FS_SLOT?" cr":"");'));
  assert.ok(stage.includes('className:"stage2-player-fs exit",title:"Exit full screen (Esc)"'));
  assert.ok(css.includes("video.stage2-lightbox-media{width:96vw;max-width:96vw;max-height:90vh;height:auto}"));
});
t("4 an admin's render is never blocked on the balance (the server never charges an admin)", ()=>{
  const fn=(name)=>{ const a=stage.indexOf("function "+name+"("); let i=stage.indexOf("{",a),d=0; for(;i<stage.length;i++){ if(stage[i]==="{")d++; else if(stage[i]==="}"){ d--; if(!d) break; } } return stage.slice(a,i+1); };
  const W={}; const box={window:W}; vm.createContext(box);
  vm.runInContext([fn("stageOwnerPaysInfo"),fn("stageAdminInfo"),fn("stageCreditInfo"),"this.f=stageCreditInfo;"].join("\n"),box);
  W.turnIsAdmin=true;
  const a=box.f({remaining:645},1183);
  assert.equal(a.empty,false); assert.equal(a.short,false); assert.equal(a.admin,true);
  assert.ok(/1,183 credits · not charged on an admin account/.test(a.label));
  W.turnIsAdmin=false;
  const u=box.f({remaining:645},1183);
  assert.equal(u.empty,true); assert.ok(!u.admin);
});
t("Frances knows; keys", ()=>{
  assert.ok(ai.includes("While a clip renders (Stage, 2026-10-25 fixes)"));
  ["videogen.jsx","stage.jsx"].forEach(f=>assert.ok(["20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f));
  assert.ok(["20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/styles.css?v="+k+'"')));
});
console.log(pass+" passed, 0 failed");
