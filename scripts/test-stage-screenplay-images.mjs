#!/usr/bin/env node
/* Focused local tests for the canonical Stage screenplay PNG renderer. */
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const calls = [];
function makeCanvas(){
  const context = {
    font:"15px Courier New, monospace",
    fillStyle:"",
    textAlign:"left",
    measureText(text){ return {width:String(text).length*9}; },
    fillRect(...args){ calls.push(["rect",...args]); },
    fillText(text,...args){ calls.push(["text",String(text),...args]); }
  };
  return {
    width:0,height:0,
    getContext(kind){ return kind==="2d" ? context : null; },
    toDataURL(type){
      assert.equal(type,"image/png");
      return "data:image/png;base64,LOCAL-"+calls.length;
    }
  };
}

const box = {
  console, Date, Set, Map, Math, JSON, Number, String, Object, Array, RegExp,
  document:{createElement(kind){
    assert.equal(kind,"canvas");
    return makeCanvas();
  }},
  window:null, globalThis:null
};
box.window=box;
box.globalThis=box;
vm.createContext(box);
vm.runInContext(readFileSync("app/stage-screenplay-images.js","utf8"),box,{
  filename:"app/stage-screenplay-images.js"
});

/* (2026-10-14) one page per scene when it fits — 13 px on a 1000×1500 page holds ~80 rows of this fake 9 px measure,
   so the unbroken token is long enough (~145 rows) to need two pages at any size */
const longToken = "UNBROKEN-TOKEN-".repeat(900);
const reference = {
  schema:"cm-stage-screenplay-v1",
  kind:"screenplay",
  delivery:"prompt-text",
  sceneId:"scene-images",
  sceneNo:4,
  sceneTitle:"The Handoff",
  sourceRev:"source-v1",
  fullText:[
    "[BEAT 1 · SCENE] INT. ARCHIVE — NIGHT",
    "[BEAT 1 · ACTION] MARCUS enters the archive.",
    "[BEAT 1 · CHAR] MARCUS",
    "[BEAT 1 · DIA] I have the ledger.",
    "[BEAT 2 · ACTION] RHEA crosses to the door.",
    "[BEAT 2 · ACTION] "+longToken,
    "[BEAT 3 · ACTION] The final authored block survives."
  ].join("\n"),
  targetBeats:[2],
  targetText:"[BEAT 2 · ACTION] RHEA crosses to the door.\n[BEAT 2 · ACTION] "+longToken,
  hasSource:true,
  errors:[],
  signature:"stage-screenplay:test-images"
};

const result = box.stageScreenplayImages(reference);
assert.equal(result.signature,reference.signature);
assert.equal(result.errors.length,0);
assert.ok(result.images.length>1,"long canonical source should paginate");
assert.equal(result.images.length,result.images[result.images.length-1].totalPages);
assert.deepEqual(Array.from(result.images.map(image=>image.page)),
  Array.from({length:result.images.length},(_,index)=>index+1));
result.images.forEach(image=>{
  assert.match(image.id,/stage-screenplay:stage-screenplay:test-images:page-\d+/);
  assert.match(image.url,/^data:image\/png;base64,/);
  assert.equal(image.sourceSignature,reference.signature);
  assert.deepEqual(Array.from(image.targetBeats),[2]);
  assert.match(image.label,/SCREENPLAY PAGE/);
});
const drawn = calls.filter(call=>call[0]==="text").map(call=>call[1]).join("\n");
/* the beat labels sit in the margin beside their block's first line — never a row of their own (2026-10-14) */
assert.ok(!calls.some(call=>call[0]==="text" && /^\[BEAT /.test(call[1])),"no [BEAT n · TYPE] label rows");
const margin = calls.filter(call=>call[0]==="text" && /^BEAT \d+$/.test(call[1]));
assert.ok(margin.length>=3 && margin.every(call=>call[2]===60),"BEAT 1, 2 and 3 in the left margin");
assert.ok(margin.every(label=>calls.some(call=>call[0]==="text" && call[3]===label[3] && call[2]>=78 && !/^BEAT /.test(call[1]))),
  "each beside its block's first line");
// ~150 rows: 3 pages at 15 px even on the taller page, 2 at 14 px — so 14 px (13 px would also make 2, less legibly)
assert.ok(result.images.length===2 && result.images.every(image=>image.layout==="14px" && image.height===1500),
  "a scene no layout fits on one page: the fewest pages any layout allows (2), on the most legible one that allows them");
assert.match(drawn,/MARCUS enters the archive/);
assert.match(drawn,/The final authored block survives/);
assert.match(drawn,/UNBROKEN-TOKEN-/,"long tokens are drawn rather than truncated");
assert.ok(calls.some(call=>call[0]==="rect"),"target beat has a visible highlight");

calls.length=0;
const multiline = {
  ...reference,
  fullText:[
    "[BEAT 2 · DIA] MARA",
    "The first authored dialogue line stays in this beat.",
    "The second authored dialogue line is still target text.",
    "[BEAT 3 · ACTION] RHEA crosses to the door.",
    "The action continuation remains highlighted and laid out as action."
  ].join("\n"),
  targetBeats:[2,3],
  targetText:"[BEAT 2 · DIA] MARA\nThe first authored dialogue line stays in this beat."
};
const multilineResult = box.stageScreenplayImages(multiline);
assert.equal(multilineResult.errors.length,0);
const multilineDrawn = calls.filter(call=>call[0]==="text").map(call=>call[1]).join("\n");
assert.match(multilineDrawn,/The second authored dialogue line is still/);
assert.match(multilineDrawn,/target text/);
assert.match(multilineDrawn,/The action continuation remains highlighted and laid out as action/);
assert.equal(calls.find(call=>call[0]==="text"
  && call[1].startsWith("The second authored dialogue line is still"))[2],252,
  "dialogue continuation retains the dialogue column");
assert.equal(calls.find(call=>call[0]==="text"
  && call[1].startsWith("The action continuation remains"))[2],78,
  "action continuation retains the action column");
assert.ok(calls.filter(call=>call[0]==="rect").length>=5,
  "multiline target dialogue/action rows retain beat highlighting");

const missingSource = box.stageScreenplayImages({
  ...reference, hasSource:false, fullText:"", errors:["Writer source is missing."]
});
assert.deepEqual(Array.from(missingSource.images),[]);
assert.match(missingSource.errors.join(" "),/Writer source is missing|source is unavailable/);

const oldDocument = box.document;
box.document = {createElement(){ return {getContext(){ return null; }};}};
const noCanvas = box.stageScreenplayImages(reference);
assert.deepEqual(Array.from(noCanvas.images),[]);
assert.match(noCanvas.errors.join(" "),/2D context is unavailable/);
box.document = oldDocument;

console.log(`PASS Stage screenplay images: ${result.images.length} pages and error paths`);