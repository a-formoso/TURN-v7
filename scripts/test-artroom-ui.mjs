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
function frame(over={}){
  const gen={genUrl:"",genMeta:null,gening:false,generate:noop,cancelGen:noop,
    importSheet:noop,allModels:[],layers:0,...over};
  return s.SheetFrame({gen,slotId:"propref-test",name:"Test prop",drafted:true,dropToImport:true,noun:"prop sheet"});
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
assert.deepEqual(Array.from(s.sheetReviewReasons({specPrompt:"old"},"new",[{label:"Watch",usedIso:"v1",currentIso:"v2",usedVersion:1,currentVersion:2}])),
  ["Specification changed since this image was generated","Watch changed · v1 → v2"]);
assert.equal(s.sheetReviewKey("same",[],[]),s.sheetReviewKey("same",[],[]));
assert.notEqual(s.sheetReviewKey("old",[],[]),s.sheetReviewKey("new",[],[]));
assert.notEqual(s.sheetReviewKey("same",[{currentIso:"a"}],[]),s.sheetReviewKey("same",[{currentIso:"b"}],[]));
const image={id:"test",genUrl:"test:image",genMeta:{iso:"v1",size:"2K",version:1},setApproval:noop};
assert.equal(find(frame(image),n=>n.props.className==="sheet-approval-btn"),null);
canReview=true;
assert.ok(find(frame(image),n=>n.props.className==="sheet-approval-btn"));
tree=frame({pendingSave:{url:"data:image/png;base64,QQ=="},retrySave:noop,discardSave:noop});
assert.ok(find(tree,n=>n.props.className==="sheet-retry-save"));
assert.ok(find(tree,n=>n.type==="a"&&n.props.download==="Test prop-unsaved.png"));
console.log("PASS Art Room keyboard, review fingerprint, permissions, and recovery UI (16 assertions)");