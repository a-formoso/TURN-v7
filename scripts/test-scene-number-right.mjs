#!/usr/bin/env node
/* THE SCENE NUMBER ON THE RIGHT ONLY (2026-10-26, owner: "can you remove the number from the Writers' Room screenplays
   and keep it on the right side only?"): a "1" in front of "INT." reads, in the screenplay page images the image models
   get, as part of the place's name. The Writers' Room slugline (read and edit) and the Locations page images put the
   number at the right edge of the heading line only. Run: node scripts/test-scene-number-right.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const script = readFileSync("app/script.jsx", "utf8"), loc = readFileSync("app/locations.jsx", "utf8"), ai = readFileSync("app/ai.jsx", "utf8");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("PASS " + name); };
t("the Writers' Room slugline carries its number once, after the heading (reading and editing)", () => {
  const blocks = [...script.matchAll(/\{className:\(?BLOCK_CLASS\.scene\)?\+" numbered"[\s\S]*?\)\);/g)].map(m => m[0]);
  assert.equal(blocks.length, 2);
  blocks.forEach(b => {
    assert.equal((b.match(/spb-scnum/g) || []).length, 1, b);
    assert.ok(b.indexOf("spb-sctext") < b.indexOf("spb-scnum"), "the number comes after the heading text");
  });
});
t("the Locations screenplay page puts the number at the right edge of the heading, never in front of INT./EXT.", () => {
  assert.ok(!loc.includes('String(scene.no)+"  ")+String(slug.text||"")'));
  assert.ok(loc.includes('if(u && scene && scene.no!=null && u.rows.length) u.rows[0].rightNo = String(scene.no);'));
  assert.ok(loc.includes('if(r.rightNo){ ctx.textAlign = "right"; ctx.fillText(r.rightNo, W-padX, y+baseline); ctx.textAlign = "left"; }'));
  const strip = new RegExp(String(/^\s*\d+[A-Z]?\.?\s+(?=(?:INT|EXT|I\/E|EST)\b)/i).slice(1, -2), "i");
  assert.equal("1 INT. MARMORICA - CAR DECK - NIGHT".replace(strip, ""), "INT. MARMORICA - CAR DECK - NIGHT");
  assert.equal("12A. EXT. PIER - DAY".replace(strip, ""), "EXT. PIER - DAY");
  assert.equal("INT. ROOM 101 - NIGHT".replace(strip, ""), "INT. ROOM 101 - NIGHT");
});
t("Frances knows", () => assert.ok(ai.includes("SCENE NUMBERS ON THE RIGHT (2026-10-26)")));
console.log(n + " passed, 0 failed");
