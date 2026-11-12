#!/usr/bin/env node
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const live=readFileSync("app/livevoice.js","utf8");
const story=readFileSync("app/newstory.jsx","utf8");
const ai=readFileSync("app/ai.jsx","utf8");
const proxy=readFileSync("supabase/functions/image-proxy/index.ts","utf8");
const html=readFileSync("TURN.html","utf8");
const protocol=readFileSync("docs/MUSE Protocol.md","utf8");

// Parse the buildless browser module as ordinary JavaScript before deeper checks.
new Function(live);

assert.match(live,/new RTCPeerConnection\(\)/);
assert.match(live,/createDataChannel\("oai-events"\)/);
assert.match(live,/getUserMedia\(\{audio:true\}\)/);
assert.match(live,/session\.input_transcript\.delta/);
assert.match(live,/session\.output_transcript\.delta/);
assert.match(live,/type:"session\.close"/);
assert.match(live,/task:"live"/);
assert.match(live,/turnApiKeysForProxy\(\["openai"\]\)/);
assert.match(live,/no prompt supplied/i);
assert.match(live,/live-voice backend is out of date/);
assert.doesNotMatch(live,/OPENAI_API_KEY/,
  "the browser transport must never contain or read the service API key");

assert.match(proxy,/if \(task === "live"\)/);
assert.match(proxy,/https:\/\/api\.openai\.com\/v1\/live\/sessions/);
assert.match(proxy,/model: "gpt-live-1"/);
assert.match(proxy,/transport: \{ type: "webrtc", sdp \}/);
assert.match(proxy,/store: false/);
assert.match(proxy,/Never reveal or speculate about providers/);
assert.match(proxy,/const sdp = typeof body\.sdp === "string" \? body\.sdp : ""/);
assert.doesNotMatch(proxy,/body\.sdp\.trim\(\)\s*:\s*""/,
  "the proxy must preserve the terminating SDP line break instead of forwarding a trimmed offer");

const livePos=html.indexOf('src="app/livevoice.js');
const storyPos=html.indexOf('src="app/newstory.jsx');
assert.ok(livePos>=0 && storyPos>livePos,"live transport must load before New Story");
// the live-voice file loads under its own key, or a later change's (the Kinolot rebrand re-keyed it: 20260928-brand1;
// the Frances daily limit's voice handling ships under 20260929-look1)
assert.match(html,/app\/livevoice\.js\?v=(?:20260911-gptlive2|20260928-brand1|20260929-look1|20260930-billing1)"/);   // billing repair 2026-09-30: the 15-minute session end
assert.match(story,/function NSLiveInterview/);
assert.match(story,/Finish & shape loglines/);
assert.match(story,/aiSeedToLoglines\("talk",transcript(?:,showCanon)?\)/);
assert.match(story,/function NSLegacyInterview/);
assert.match(story,/Use typed interview/);
// (2026-11-12, audit C5: every seed, the conversation included, is read up to STORY_SEED_MAX — 7,000 as before for a conversation)
assert.match(ai,/const STORY_SEED_MAX = 7000;/);assert.match(ai,/window\.storySeedText\(text\) : String\(text\|\|""\)\.slice\(0,7000\)\.trim\(\)/);
assert.match(ai,/talk:\s+"The writer talked the story through with Frances/);
assert.match(ai,/_newStoryLiveFeature/);
assert.match(protocol,/New Story voice uses a server-created GPT-Live session over WebRTC/);

console.log("PASS GPT-Live MUSE voice transport, lossless SDP proxying, stale-proxy diagnosis, transcript handoff, and fallback (31 assertions)");
