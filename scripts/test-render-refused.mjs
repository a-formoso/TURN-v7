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
  assert.ok(css.includes(".stage2-player-fs{position:absolute;top:10px;right:10px;"));
  assert.ok(css.includes("video.stage2-lightbox-media{width:96vw;max-width:96vw;max-height:90vh;height:auto}"));
});
t("Frances knows; keys", ()=>{
  assert.ok(ai.includes("While a clip renders (Stage, 2026-10-25 fixes)"));
  ["videogen.jsx","stage.jsx"].forEach(f=>assert.ok(["20261025-hs78", "20261025-hs79", "20261025-hs80"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f));
  assert.ok(["20261025-hs78", "20261025-hs79", "20261025-hs80"].some(k=>html.includes("app/styles.css?v="+k+'"')));
});
console.log(pass+" passed, 0 failed");
