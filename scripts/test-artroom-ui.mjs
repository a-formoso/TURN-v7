#!/usr/bin/env node
import {readFileSync} from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const noop=()=>{};
let canReview=false;
const s={console,React:{
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  createContext:()=>({Provider:"provider"}),useContext:()=>canReview,
  useState:init=>[typeof init==="function"?init():init,noop],useEffect:noop,
  useRef:()=>({current:null}),useMemo:f=>f(),useCallback:f=>f,Fragment:"fragment"
},Icon:new Proxy({},{get:()=>()=>null}),localStorage:{getItem:()=>null},document:{},
  setTimeout:noop,setInterval:noop,addEventListener:noop,removeEventListener:noop};
s.window=s;vm.createContext(s);vm.runInContext(readFileSync("dist/app/artroom.js","utf8"),s);
function find(n,p){if(!n||typeof n!=="object")return null;if(p(n))return n;for(const c of n.children||[]){const found=find(c,p);if(found)return found;}return null;}
function frame(over={},frameProps={}){
  const gen={genUrl:"",genMeta:null,gening:false,generate:noop,cancelGen:noop,
    importSheet:noop,allModels:[],layers:0,...over};
  return s.SheetFrame({gen,slotId:"propref-test",name:"Test prop",drafted:true,dropToImport:true,noun:"prop sheet",...frameProps});
}
let tree=frame(),clicks=0,prevented=0;
find(tree,n=>n.type==="input"&&n.props.type==="file").props.ref.current={click:()=>clicks++};
let zone=find(tree,n=>n.props.className?.startsWith("sheet-dropzone"));
assert.equal(zone.props.role,"button");assert.equal(zone.props.tabIndex,0);
for(const key of ["Enter"," "])zone.props.onKeyDown({key,preventDefault:()=>prevented++});
assert.equal(clicks,2);assert.equal(prevented,2);
tree=frame({gening:true});zone=find(tree,n=>n.props.className?.startsWith("sheet-dropzone"));
assert.equal(zone.props["aria-disabled"],true);assert.equal(zone.props.tabIndex,-1);
assert.ok(find(tree,n=>n.props.className==="sheet-gen-stop"));
assert.equal(find(tree,n=>n.props.className==="sheet-status-bar"),null);
assert.deepEqual(Array.from(s.sheetReviewReasons({specPrompt:"old"},"new",[{label:"Watch",usedIso:"v1",currentIso:"v2",usedVersion:1,currentVersion:2}])),
  ["Specification changed since this image was generated","Watch changed · v1 → v2"]);
assert.equal(s.sheetReviewableReference({kind:"script",refId:"script-main-location-1-1-0"}),false);
assert.equal(s.sheetReviewableReference({refId:"script-location-unit-0"}),false);
assert.equal(s.sheetReviewableReference({kind:"location",refId:"location-1"}),true);
assert.equal(s.sheetReviewKey("same",[],[]),s.sheetReviewKey("same",[],[]));
assert.notEqual(s.sheetReviewKey("old",[],[]),s.sheetReviewKey("new",[],[]));
assert.notEqual(s.sheetReviewKey("same",[{currentIso:"a"}],[]),s.sheetReviewKey("same",[{currentIso:"b"}],[]));
const image={id:"test",genUrl:"test:image",genMeta:{iso:"v1",size:"2K",version:1},setApproval:noop};
assert.equal(find(frame(image),n=>n.props.className==="sheet-approval-btn"),null);
canReview=true;
assert.equal(find(frame(image),n=>n.props.className==="sheet-approval-btn"),null);
assert.equal(find(frame(image),n=>n.props.className==="sheet-status-bar"),null);
tree=frame(image,{reviewReasons:["Specification changed"]});
assert.equal(find(tree,n=>n.props.className==="sheet-status-bar"),null);
assert.equal(find(tree,n=>n.props.className==="sheet-review-details"),null);
tree=frame(image,{reviewReasons:["Specification changed"],hideSourceReview:true});
assert.equal(find(tree,n=>n.props.className==="sheet-status-bar"),null);
assert.equal(find(tree,n=>n.props.className==="sheet-review-details"),null);
tree=frame({saving:true});
assert.equal(find(tree,n=>n.props.className==="sheet-status-bar"),null);
tree=frame({}, {specGate:"Draft the specification first"});
assert.equal(find(tree,n=>n.props.className==="sheet-gen-gate"),null);
tree=frame({pendingSave:{url:"data:image/png;base64,QQ=="},retrySave:noop,discardSave:noop});
assert.ok(find(tree,n=>n.props.className==="sheet-retry-save"));
assert.ok(find(tree,n=>n.type==="a"&&n.props.download==="Test prop-unsaved.png"));
const artSource=readFileSync("app/artroom.jsx","utf8");
const styles=readFileSync("app/styles.css","utf8");
const propSource=readFileSync("app/props.jsx","utf8");
const locationSource=readFileSync("app/locations-ui.jsx","utf8");
const characterMaster=artSource.slice(artSource.indexOf("function CharacterSheet("),artSource.indexOf("function NbKeyBar("));
/* Every identifier an appearance-state row forwards into its identity context must be a
   prop it receives: a free `drafts` crashed Art Room → Characters (Sept 2026) for any
   character that had an appearance state. Render the row with the hook stubbed. */
{
  let genOpts=null;
  const prevGen=s.useImageGen;
  s.useImageGen=(o)=>{genOpts=o;return {genUrl:"",genMeta:null,gening:false,generate:noop,cancelGen:noop,importSheet:noop,allModels:[],layers:0};};
  s.EditText=s.EditText||(()=>null); // lives in inspector.jsx, not loaded here
  const drafts={"scene-1":{blocks:[]}};
  const c={id:"char-1",name:"Marcus",color:"#000",states:[{id:"st-1",label:"Rehearsal night clothes",change:"Loose rehearsal clothes",suggested:true}]};
  const row=s.StateRow({c,st:c.states[0],index:0,project:{},scenes:[{id:"scene-1",no:1,title:"Open"}],props:[],drafts,
    baseGenUrl:"",onView:noop,onChange:noop,onDelete:noop});
  assert.equal(row.props.className,"state-row");
  assert.equal(genOpts.identityContext.drafts,drafts,"an appearance-state row forwards the drafts it was given");
  assert.equal(JSON.stringify(genOpts.identityContext.characterIds),'["char-1"]'); // vm realm arrays: compare by value
  const stateRowCall=characterMaster.slice(characterMaster.indexOf("React.createElement(StateRow,"));
  assert.match(stateRowCall.slice(0,stateRowCall.indexOf("})")),/\bdrafts\b/,"the character sheet passes drafts to each state row");
  s.useImageGen=prevGen;
}
const propMaster=propSource.slice(propSource.indexOf("function PropSheet("),propSource.indexOf("function PropSheets("));
for(const source of [characterMaster,propMaster,locationSource]){
  assert.doesNotMatch(source,/sheet-status-bar|sheet-gen-gate|sheet-undrafted|char-drafting-strip|prompt-drift-banner|prompt-drift-note/);
}
const agentModelStyle=styles.slice(styles.indexOf(".ag-runner-model-sel{"),styles.indexOf(".ns-model-sel:disabled"));
assert.match(agentModelStyle,/background-color:color-mix\(in oklab,var\(--bg-3\),var\(--accent\) 10%\)/);
assert.match(agentModelStyle,/border:1px solid var\(--accent-line\)/);
assert.doesNotMatch(agentModelStyle,/background-color:var\(--pos\)/);
console.log("PASS Art Room master-card controls and recovery UI");
