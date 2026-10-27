#!/usr/bin/env node
/* HAIR AS ONE LINE THAT COVERS FOUR THINGS (2026-10-25, owner: "add hair style, hair colour, hair texture, and facial
   hair to our character sheet prompts" — then "instead of splitting it, have the different fields in one: hair"):
   the look draft writes hair as one labelled line — style; colour; texture; facial hair — the card keeps its one Hair
   row and the sheet prompt sends it as the hair line. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ai=readFileSync("app/ai.jsx","utf8"), art=readFileSync("app/artroom.jsx","utf8"), html=readFileSync("TURN.html","utf8");
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,300)); process.exit(1); } pass++; console.log("PASS "+name); };
t("the draft asks for one hair line covering style, colour, texture and facial hair, labelled and in order", ()=>{
  assert.ok(ai.includes("hair = ONE line that always covers all four, labelled and in this order: 'style: <the cut"));
  assert.ok(ai.includes("; facial hair: <the beard, moustache or stubble described concretely, or clean-shaven, or none>'"));
  assert.ok(ai.includes('"hair":"style: ...; colour: ...; texture: ...; facial hair: ..."'));
  assert.ok(!/hairStyle|hairColour|hairTexture|facialHair/.test(ai), "no separate fields");
});
t("the whole line is kept (480 characters) and the card and the sheet prompt keep one hair field", ()=>{
  assert.ok(ai.includes("hair:clean(e.hair,480)"));
  assert.ok(art.includes('Row("Hair",F.hair,v2=>setPhys("hair",v2),true,"hair"),'));
  assert.ok(art.includes("hair: (!_lk && clean(F.hair))||undefined,"));
});
t("Frances knows; keys", ()=>{
  assert.ok(ai.includes('name:"Hair on the character card and sheet"'));
  assert.ok(["20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261027-hs108", "20261027-hs109", "20261027-hs110"].some(k=>html.includes("app/ai.jsx?v="+k+'"')));
});
console.log(pass+" passed, 0 failed");
