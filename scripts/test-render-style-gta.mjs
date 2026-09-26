/* GTA Loading-Screen Art render style + the shared style cap raised to 100 (owner,
   2026-09-25). The style works on every tab (characters, locations, props), lives in the
   Illustration / Concept Art group, and its PROMPT text never names the franchise. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=(name,f)=>{f();checks++;console.log("PASS",name);};
const art=read("app/artroom.jsx"), loc=read("app/locations.jsx"), prop=read("app/props.jsx"), chrome=read("app/chrome.jsx"), ai=read("app/ai.jsx");
const entry=art.slice(art.indexOf("  gtaLoadingScreen: {"),art.indexOf("  whimsicalwatercolor: {"));

test("the style is a full built-in with a label, a description and a group",()=>{
  for(const k of ["rendering","linework","shading","color_grade","background","rules"]) assert.ok(entry.includes('"'+k+'"'),k);
  assert.ok(art.includes('gtaLoadingScreen:"GTA Loading-Screen Art"'));
  assert.ok(/gtaLoadingScreen:"For the GTA loading-screen/.test(art));
  assert.ok(/\{ id:"Illustration \/ Concept Art", keys:\[[^\]]*"gtaLoadingScreen"/.test(art));
});
test("locations and props render it in-style",()=>{
  assert.ok(/\n  gtaLoadingScreen:"open-world crime-game loading-screen poster environment/.test(loc));
  assert.ok(/\n  gtaLoadingScreen:"open-world crime-game loading-screen poster object/.test(prop));
});
test("the prompt text describes the look and never names the franchise",()=>{
  const lines=[entry, loc.match(/\n  gtaLoadingScreen:"[^"]+"/)[0], prop.match(/\n  gtaLoadingScreen:"[^"]+"/)[0]];
  for(const l of lines){ assert.ok(!/grand theft|\bGTA\b|rockstar/i.test(l.replace(/\/\/[^\n]*/g,"")),l.slice(0,80)); assert.ok(/no text|typography/.test(l)); }
});
test("the shared style cap is 100 everywhere it is read",()=>{
  assert.ok(art.includes("const MAX_GLOBAL_STYLES = 100;")&&art.includes("const MAX_TOTAL_STYLES = 110;"));
  assert.ok(chrome.includes("window.turnGlobalStyleCap || 100"));
  const m=ai.slice(ai.indexOf("const APP_FEATURES"),ai.indexOf("function appBrief"));
  assert.ok(!/\[global count\] \/ 40|up to 40\b|capped at 40/.test(m)&&m.includes("GTA Loading-Screen Art"));
});
console.log(checks+" checks passed");
