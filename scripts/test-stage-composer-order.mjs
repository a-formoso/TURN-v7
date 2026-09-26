#!/usr/bin/env node
/* Source-level guard for the Create Video composer's visible control order. */
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../app/stage.jsx",import.meta.url),"utf8");
const start=source.indexOf("const createBody =");
const end=source.indexOf("// ---- EDIT VIDEO",start);
if(start<0||end<0) throw new Error("Could not find the Create Video body");
const createBody=source.slice(start,end);

const controls=[
  ["model", "modelPill"],
  ["aspect ratio", "createTask===\"extension\""],
  ["resolution", "resolutionPill"],
  ["duration", "durationPill"],
  ["sound", "createSoundChip"],
  ["bitrate", "bitratePill"],
];
let cursor=-1;
for(const [label,token] of controls){
  const next=createBody.indexOf(token,cursor+1);
  if(next<0) throw new Error(`Missing ${label} control (${token}) from Create Video composer`);
  if(next<=cursor) throw new Error(`${label} control is out of order`);
  cursor=next;
}

if(!/const modelPill = sdPill\("model","inline","Video model"/.test(source))
  throw new Error("Model picker is not using the existing inline pill style");
if(/heroCard\("GENERAL", model\.label, \{ action:/.test(createBody))
  throw new Error("Model picker is duplicated in the Create Video header");

console.log("PASS Stage Create Video controls: model, aspect ratio, resolution, duration, sound, bitrate");
