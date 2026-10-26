#!/usr/bin/env node
/* Source-level guard for the Create Video composer's order (2026-10-24, owner — Stage console option A):
   references → prompt (outline or text) → notices → the Generate row (aspect ratio, Sound, Generate).
   The engine, resolution, duration and bitrate live in Render settings; since 2026-10-26 (owner) the Generate row also
   leads with the clip's length — a clock chip that opens "Choose duration", a box you type into. */
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../app/stage.jsx",import.meta.url),"utf8");
const start=source.indexOf("const createBody =");
const end=source.indexOf("// ---- EDIT VIDEO",start);
if(start<0||end<0) throw new Error("Could not find the Create Video body");
const createBody=source.slice(start,end);

const order=[
  ["create mode", 'segmented("Create mode"'],
  ["references", "referenceStrip"],
  ["prompt", "promptBlock"],
  ["notices", "composerNotices"],
  ["duration", "chooseDurationPill"],
  ["aspect ratio", "aspectPill"],
  ["sound", "createSoundChip"],
  ["generate", "createGenerate"],
];
let cursor=-1;
for(const [label,token] of order){
  const next=createBody.indexOf(token,cursor+1);
  if(next<0) throw new Error(`Missing ${label} (${token}) from the Create Video composer`);
  if(next<=cursor) throw new Error(`${label} is out of order`);
  cursor=next;
}
for(const gone of ["modelPill","resolutionPill","durationPill","bitratePill",'heroCard("VIDEO MODEL"'])
  if(createBody.includes(gone)) throw new Error(`${gone} is back in the Create Video composer — Render settings holds it`);
if(!/const promptBlock = showOutline\s*\?/.test(source)) throw new Error("the prompt no longer offers the outline view");
if(!/composerModeTabs\),\s*\/\/ THE MONITOR/.test(source)) throw new Error("the mode switch is not on the clip's header line");

if(!/function StageDurationField\(/.test(source)||!source.includes('_stEl("label",{htmlFor:"stage-choose-duration"},"Choose duration")'))
  throw new Error("the duration chip no longer opens the Choose duration box");
if(!source.includes('_stEl("input",{type:"range",min,max,step:1,value:Math.max(min,Math.min(max,v)),"aria-label":"Clip duration"'))
  throw new Error("the Choose duration box lost its drag bar");
console.log("PASS Stage Create Video composer: references, prompt, notices, then duration, aspect ratio, Sound and Generate");
