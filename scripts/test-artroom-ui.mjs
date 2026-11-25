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
const nodeText=n=>n==null||n===false?"":typeof n!=="object"?String(n):(n.children||[]).map(nodeText).join("");
{
  const originalMeta={modelLabel:"GPT Image 2.5 Sunburst",modelId:"gpt-image-2.5-sunburst",
    aspect:"16:9",size:"2K",date:"Sep 24, 2026",time:"10:30 AM",iso:"2026-09-24T09:30:00.000Z",version:3};
  for(const slotId of ["charref-c","propref-p","locref-l","locref-room","locvar-l-night","loccov-l-ext","locunit-l-night","lookref-c","shot-s"]){
    for(const meta of [originalMeta,{...originalMeta,date:"",time:""},{...originalMeta,uploaded:true,modelId:"uploaded"}]){
      const before=JSON.stringify(meta);
      const caption=find(frame({genUrl:"image.png",genMeta:meta},{slotId}),n=>n.props.className==="sheet-frame-meta");
      assert.match(nodeText(caption),/GPT Image 2.5 Sunburst/);
      assert.match(nodeText(caption),/16:9/);assert.match(nodeText(caption),/2K/);
      assert.doesNotMatch(nodeText(caption),/Sep|2026|10:30/);
      assert.equal(caption.children.length,3,"compact caption contains only model, aspect and resolution");
      assert.equal(JSON.stringify(meta),before,"dates are hidden, never deleted from metadata");
    }
  }
  const details=meta=>s.SheetDetails({gen:{genUrl:"image.png",genMeta:meta,loadDetails:noop},name:"Test image",onClose:noop});
  const generated=t=>find(t,n=>n.props.className==="dt-field"&&nodeText(n.children[0])==="Generated");
  assert.equal(nodeText(generated(details(originalMeta))),"GeneratedSep 24, 2026 · 10:30 AM");
  assert.match(nodeText(generated(details({...originalMeta,date:"",time:""}))),/GeneratedSep 24, 2026 · /,
    "legacy ISO-only assets still show a generated date in Details");
  const historyMeta={...originalMeta,date:"Sep 10, 2026",time:"8:00 PM",version:2};
  const oldUseState=s.React.useState;
  let index=0;
  s.React.useState=init=>{const i=index++;return [i===0?{meta:originalMeta,history:[{url:"old.png",meta:historyMeta}]}:
    i===4?{url:"old.png",meta:historyMeta,idx:0}:init,noop];};
  const historyView=details(originalMeta);
  assert.equal(nodeText(generated(historyView)),"GeneratedSep 10, 2026 · 8:00 PM");
  assert.match(nodeText(find(historyView,n=>n.props.className==="dt-hist-meta")),/Sep 10, 2026 8:00 PM/);
  // (2026-11-25) each earlier version names its engine as the engine list does, never by its saved id
  assert.equal(nodeText(find(historyView,n=>n.props.className==="dt-hist-meta")),"GPT Image 2.5 Sunburst \u00b7 Sep 10, 2026 8:00 PM");
  assert.doesNotMatch(nodeText(historyView),/gpt-image-2\.5-sunburst/,"the saved id is nowhere in the Details window");
  s.React.useState=oldUseState;

  const sb={window:{},React:{createElement:noop}};vm.createContext(sb);
  const storyboard=readFileSync("app/storyboard.jsx","utf8");vm.runInContext(storyboard,sb);
  const halves={top:{meta:originalMeta},bottom:{meta:{iso:originalMeta.iso}}},before=JSON.stringify(halves);
  const rows=sb.sbHalfDateDetails(halves);
  assert.equal(rows.length,2);assert.equal(rows[0].k,"Current top half saved");
  assert.equal(rows[0].v,"Sep 24, 2026 · 10:30 AM");assert.match(rows[1].v,/Sep 24, 2026/);
  assert.equal(JSON.stringify(halves),before);
  assert.equal(sb.sbHalfDateDetails({top:{meta:{iso:"bad"}}}).length,0);
  const halfCaption=storyboard.slice(storyboard.indexOf('className:"sb-half-meta"'),storyboard.indexOf('// per-panel repair'));
  assert.doesNotMatch(halfCaption,/meta\.date/);
  assert.match(storyboard,/extraMeta:sbHalfDateDetails\(halves\)/);
}
let tree=frame(),clicks=0,prevented=0;
{
  let reviews=0,generations=0,drafts=0;
  const genButton=t=>find(t,n=>n.props.className?.split(" ").includes("sheet-gen-btn"));
  const blocked={generateDisabled:true,generateDisabledLabel:"Review floor plan",
    onResolveGenerationBlock:()=>reviews++,onDraft:()=>drafts++,drafted:false,specGate:{ready:false}};
  const gen={generate:()=>generations++};
  let button=genButton(frame(gen,blocked));
  assert.equal(button.props.disabled,false,"review navigation is available even when the spec is incomplete");
  assert.match(button.props.className,/needs-review/);
  button.props.onClick();
  assert.equal(reviews,1);assert.equal(generations,0);assert.equal(drafts,0);
  button=genButton(frame(gen,{...blocked,onResolveGenerationBlock:undefined}));
  assert.equal(button.props.disabled,true,"other prerequisite gates remain disabled");
  button.props.onClick();assert.equal(generations,0);
  button=genButton(frame({...gen,gening:true},blocked));
  assert.equal(button.props.disabled,true);button.props.onClick();assert.equal(reviews,1);
  button=genButton(frame(gen,{...blocked,generateDisabled:false}));
  assert.equal(button.props.disabled,true,"specification gate still applies after layout review");
  button=genButton(frame(gen,{...blocked,generateDisabled:false,drafted:true,specGate:{ready:true}}));
  button.props.onClick();assert.equal(generations,1);assert.equal(reviews,1);
}
find(tree,n=>n.type==="input"&&n.props.type==="file").props.ref.current={click:()=>clicks++};
let zone=find(tree,n=>n.props.className?.startsWith("sheet-dropzone"));
assert.equal(zone.props.role,"button");assert.equal(zone.props.tabIndex,0);
for(const key of ["Enter"," "])zone.props.onKeyDown({key,preventDefault:()=>prevented++});
assert.equal(clicks,2);assert.equal(prevented,2);
tree=frame({gening:true});zone=find(tree,n=>n.props.className?.startsWith("sheet-dropzone"));
assert.equal(zone.props["aria-disabled"],true);assert.equal(zone.props.tabIndex,-1);
assert.ok(find(tree,n=>n.props.className==="sheet-gen-stop"));
assert.equal(find(tree,n=>n.props.className==="sheet-status-bar"),null);
// (the sheet-review helpers were never used by the app — removed 2026-10-06)
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
// the agent header NAMES the model (read-only; the Writing dock changes it) on a quiet
// neutral surface with an amber edge — never the filled amber badge
const agentModelStyle=styles.slice(styles.indexOf("span.ag-runner-model{"),styles.indexOf(".ns-model-sel{"));
assert.ok(agentModelStyle.length>0,"the read-only agent model label has its own rule");
assert.match(agentModelStyle,/background:color-mix\(in oklab,var\(--bg-3\),var\(--accent\) 10%\)/);
assert.match(agentModelStyle,/border:1px solid var\(--accent-line\)/);
assert.doesNotMatch(agentModelStyle,/background-color:var\(--pos\)/);
const locationPickerStyle=styles.slice(styles.indexOf(".shot-location-picker-summary{"),styles.indexOf(".shot-location-picker-panel{"));
assert.match(locationPickerStyle,/\.shot-location-picker-summary:after\{[^}]*margin-left:auto;[^}]*flex:0 0 auto;/,
  "the location picker disclosure stays at the far-right edge");
assert.match(locationPickerStyle,/\.shot-location-picker-summary small\{[^}]*flex:1 1 auto;[^}]*min-width:0;/,
  "long location-reference hints shrink before displacing the disclosure");
const locationPickerPanelStyle=styles.slice(styles.indexOf(".shot-location-picker-panel{"),styles.indexOf(".shot-location-picker-section{"));
assert.match(locationPickerPanelStyle,/\.shot-location-picker-panel\{[^}]*right:0;[^}]*left:auto;[^}]*transform:none;/,
  "the expanded location picker aligns its right edge with the summary field");
console.log("PASS Art Room master-card controls and recovery UI");
