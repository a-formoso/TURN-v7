#!/usr/bin/env node
/*
 * Voice design 422 (2026-10-25, live test film: "ElevenLabs error (422)" designing Ottavio's voice). The stable
 * design seed was an unsigned 32-bit hash — "ottavio" gave 4,120,027,253 — and the reason the service gave was
 * dropped (a validation 422 lists it under detail[].msg). The seed now stays in the signed 32-bit range (the
 * browser and the server), a seed already in it is unchanged, and the reason is passed on, naming no vendor.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const ui=readFileSync("app/voices-ui.jsx","utf8"), proxy=readFileSync("supabase/functions/image-proxy/index.ts","utf8");
const html=readFileSync("TURN.html","utf8");
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,300)); process.exit(1); } pass++; console.log("PASS "+name); };
const a=ui.indexOf("function vcStableSeed("), b=ui.indexOf("\n}",a)+2;
const box={}; vm.createContext(box); vm.runInContext(ui.slice(a,b)+";this.f=vcStableSeed;",box);
const old=(id)=>{ const s=String(id||"voice");let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return h>>>0; };

t("the design seed stays inside the signed 32-bit range", ()=>{
  ["ottavio","ornella","aurelio","nives","voice","x","a-very-long-character-id-0123456789"].forEach(id=>{
    const v=box.f(id); assert.ok(Number.isInteger(v)&&v>=0&&v<=2147483646, id+" → "+v); });
  assert.ok(old("ottavio")>2147483647);
});
t("a seed that was already in range is unchanged (earlier designs keep theirs)", ()=>{
  ["aurelio","nives"].forEach(id=>{ assert.ok(old(id)<2147483647); assert.equal(box.f(id),old(id)); });
});
t("the server keeps the seed in range too, and passes on a validation 422's reason with no vendor name", ()=>{
  assert.ok(proxy.includes("{ seed: Math.abs(Math.trunc(Number(body.seed))) % 2147483647 }"));
  assert.ok(proxy.includes("const list = Array.isArray(j?.detail) ? j.detail.map((x: any) => {"));
  assert.ok(proxy.includes("`The voice service returned an error (${r.status}).`"));
  assert.ok(!proxy.includes("`ElevenLabs error (${r.status}).`"));
});
t("saving a designed voice tells the provider a neutral description of at least 20 characters, nothing about the character", ()=>{
  const m=/const PROVIDER_VOICE_DESCRIPTION = "([^"]+)";/.exec(proxy);
  assert.ok(m && m[1].length>=20, "neutral description");
  assert.ok(!/ottavio|character's name/i.test(m[1]));
  assert.ok(proxy.includes("voice_description: ownElKey && ownDesc.length >= 20 ? ownDesc : PROVIDER_VOICE_DESCRIPTION,"));
  assert.ok(!proxy.includes('voice_description: ownElKey ? (body.description || "").toString() : ""'));
});
t("cache key", ()=>{ assert.ok(["20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs118", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/voices-ui.jsx?v="+k+'"'))); });
console.log(pass+" passed, 0 failed");
