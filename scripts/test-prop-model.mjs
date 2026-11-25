/* PROPS IN CODE (owner 2026-11-22: "the props need to be represented in code first ... take the code version of that
   prop and have it locked in frame"; 2026-11-24: "let's build props in code so we can have them referenced in code so
   that image previs captures the exact size and this is ultimately translated by image models into shots").
   app/prop-model.js builds a prop as a model: its true size and its shape from parts. app/shot-previs.js puts that
   model in every shot's drawing and says its size; the frame's prompt and its QA check hold the frame to it;
   app/prop-model-ui.jsx shows the model on the prop's card. No engine is called by any of it. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const src=read("app/prop-model.js"), previs=read("app/shot-previs.js"), ui=read("app/prop-model-ui.jsx"), props=read("app/props.jsx"),
  shots=read("app/shots.jsx"), ai=read("app/ai.jsx"), html=read("TURN.html"), css=read("app/styles.css"), previsUi=read("app/shot-previs-ui.jsx"), stage=read("app/stage.jsx");
const box={console}; box.window=box; box.globalThis=box; vm.createContext(box);
for(const f of ["app/scene-plan.js","app/prop-model.js","app/shot-previs.js"]) vm.runInContext(read(f),box,{filename:f});
const M=box.KinolotPropModel, V=box.ShotPrevis;
const plain=v=>JSON.parse(JSON.stringify(v));
let pass=0,fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n").slice(0,4).join(" | ")+" @ "+String(e&&e.stack||"").split("\n").filter(l=>/test-prop-model/.test(l)).slice(0,1).join("")); } };
const near=(a,b,eps=1e-3)=>Math.abs(a-b)<=eps;

// the owner's own film: the cards of Scene 5, as their size texts are written
const FILM=[
  ["Rinsed rice Tupperware","Base ~17 cm long × ~12 cm wide × ~7 cm deep (~1 L). Lid ~18 cm long × ~13 cm wide × ~1 cm thick.","tub",[0.17,0.12,0.07]],
  ["Pike’s warrant card","Closed: ~11 cm wide × ~7.5 cm tall × ~1 cm deep. Open: ~22 cm wide × ~7.5 cm tall. ID card: ~8.6 cm wide × ~5.4 cm tall.","badge",[0.11,0.075,0.01]],
  ["Mug of tea","Mug body ~9.5 cm tall × ~8 cm diameter. Handle projects ~3.5 cm, giving ~11.5 cm overall width.","mug",[0.1122,0.08,0.095]],
  ["Clear evidence bag","Bag ~15 cm wide × ~23 cm tall, flat, under 1 mm thick. Seal flap ~3 cm deep across the full width.","pouch",[0.15,0.23,0.02]],
  ["Eshita’s phone","Phone ~16.2 cm tall × ~7.6 cm wide × ~0.9 cm deep. In its case, ~16.6 cm tall × ~8.0 cm wide × ~1.2 cm deep.","phone",[0.076,0.162,0.009]],
  ["Threaded needle","Needle ~3.8 cm long × ~0.7 mm diameter, eye ~1.5 mm long. Thread strand ~60 cm long.","needle",[0.038,0.0007,0.0007]]];

test("1 the numbers of a size text: the first measured run is the thing itself, each number with its unit and its word", ()=>{
  assert.deepEqual(plain(M.numbers("20 x 14 x 8 cm")),[{v:0.2,label:""},{v:0.14,label:""},{v:0.08,label:""}]);
  assert.deepEqual(plain(M.numbers(FILM[0][1])),[{v:0.17,label:"long"},{v:0.12,label:"wide"},{v:0.07,label:"deep"}],"the base, not the lid");
  assert.deepEqual(plain(M.numbers("Mug body ~9,5 cm tall × ~8 cm diameter")),[{v:0.095,label:"tall"},{v:0.08,label:"dia"}],"a comma for a point");
  assert.deepEqual(plain(M.numbers("~1.2 m tall × 60 cm wide by 45 cm deep")),[{v:1.2,label:"tall"},{v:0.6,label:"wide"},{v:0.45,label:"deep"}],"mixed units");
  assert.deepEqual(plain(M.numbers("about 12 cm")),[{v:0.12,label:""}]);
  assert.deepEqual(plain(M.numbers("3.8 cm long × 0.7 mm diameter")),[{v:0.038,label:"long"},{v:0.0007,label:"dia"}]);
  assert.equal(near(M.numbers("6 inches long")[0].v,0.1524),true);
  for(const none of ["","a sharp no. 7 type","holds 1 L, about 300 ml","hangs from her shoulder to mid-thigh"]) assert.equal(M.numbers(none),null,none);
});

test("2 which shape a prop is: the words its name ends with, once what follows a 'with' or an 'of' is cut", ()=>{
  const is=(name,form,text)=>assert.equal(M.formOf(name,text),form,name);
  is("Rinsed rice Tupperware","tub"); is("Pike’s warrant card","badge"); is("Cab keys with Crystal Palace fob","keys"); is("Mug of tea","mug");
  is("Clear evidence bag","pouch"); is("Eshita’s phone","phone"); is("Threaded needle","needle"); is("Bottle of milk","bottle");
  is("Box of matches","matchbox"); is("Framed photograph of Amira","frame"); is("Liaqat’s lace-up shoes","shoes"); is("Bank card","card");
  is("Sealed Letter","sheet"); is("Old suitcase (brown)","suitcase"); is("Gym bag","holdall"); is("Handbag","handbag"); is("Kitchen knife","knife");
  // a word the catalogue knows in the middle of a name is not its shape: a phone charger is no phone
  is("Phone charger",""); is("Key hook",""); is("Table lamp",""); is("",""); is("The thing","");
  // when the name tells nothing, the first clause of the card's form text is read the same way
  is("Lunch","tub","A rectangular takeaway-style food box with rounded corners. Its lid is blue.");
  is("Lunch","","A modest bunch on one split ring: a black plastic car key.");
  // every shape: a usual size in metres, parts that are numbers, and words a name can end with
  assert.ok(M.FORMS.length>=70);
  const ids=new Set();
  for(const f of M.FORMS){
    assert.ok(!ids.has(f.id),f.id+" once"); ids.add(f.id);
    assert.ok(/^an? |^[a-z]/.test(f.label)&&f.size.length===3&&f.size.every(n=>n>0&&n<3),f.id);
    const parts=f.make(...f.size); assert.ok(parts.length>=1&&parts.length<=12,f.id+" parts");
    for(const p of parts){ assert.ok(["box","cylinder","torus","cushion","sphere"].includes(p[0]),f.id+" kind "+p[0]);
      assert.ok(p[1].length===3&&p[1].every(n=>Number.isFinite(n)&&n>0),f.id+" size"); assert.ok(p[2].length===3&&p[2].every(Number.isFinite),f.id+" place");
      assert.ok(["main","second","dark","light"].includes(p[3]),f.id+" material");
      // every part stays inside the thing's own box (a hand's breadth of slack for a handle that arcs or a part that leans)
      assert.ok(Math.abs(p[2][0])<=f.size[0]*0.75+0.01&&Math.abs(p[2][1])<=f.size[1]*0.75+0.01&&p[2][2]>=-0.001&&p[2][2]<=f.size[2]*1.15+0.002,f.id+" inside"); }
  }
  assert.equal(M.forms().length,M.FORMS.length); assert.ok(M.forms().every(f=>f.id&&f.label));
});

test("3 the model of a prop: the card's numbers, then its size text given to the shape's own proportions, then the usual size", ()=>{
  for(const [name,size,form,dims] of FILM){ const m=M.modelOf({name,size});
    assert.equal(m.form,form,name); assert.equal(m.basis,"text",name); dims.forEach((n,i)=>assert.ok(near(m.dims[i],n,2e-4),name+" "+m.dims)); }
  // a phone is written "tall": it rests flat; a tub is written "deep": that is its height. The shape decides, not the word.
  assert.deepEqual(plain(M.modelOf({name:"Eshita’s phone",size:FILM[4][1]}).dims),[0.076,0.162,0.009]);
  // a bunch of keys: its size text measures its pieces (the remote's head, the ring), never the bunch
  const keys=M.modelOf({name:"Cab keys with Crystal Palace fob",size:"Remote head ~5.5 cm long × ~3 cm wide × ~1.5 cm deep, blade ~4 cm; split ring ~2.5 cm dia"});
  assert.equal(keys.basis,"usual"); assert.deepEqual(plain(keys.dims),[0.11,0.06,0.014]); assert.equal(keys.parts.length,5);
  // three numbers set on the card are exact and win over everything
  const set=M.modelOf({name:"Mug of tea",size:FILM[2][1],dims:[0.12,0.09,0.1]}); assert.equal(set.basis,"set"); assert.deepEqual(plain(set.dims),[0.12,0.09,0.1]);
  // a shape picked by hand
  assert.equal(M.modelOf({name:"Lunch",modelForm:"tub"}).form,"tub");
  // no numbers: the usual size of such a thing; no shape either: a small box, and it says it is a guess
  const milk=M.modelOf({name:"Bottle of milk"}); assert.equal(milk.basis,"usual"); assert.deepEqual(plain(milk.dims),[0.075,0.075,0.26]);
  const what=M.modelOf({name:"Phone charger"}); assert.equal(what.basis,"guess"); assert.equal(what.form,""); assert.deepEqual(plain(what.dims),[0.15,0.1,0.1]); assert.equal(what.parts.length,1);
  // numbers on a thing of no known shape: a box by its words
  assert.deepEqual(plain(M.modelOf({name:"Odd device",size:"~30 cm wide × ~12 cm tall × ~8 cm deep"}).dims),[0.3,0.08,0.12]);
  // the scene plan's tracked thing with no card is read from its name
  assert.equal(M.modelOf(null,{name:"Kitchen knife"}).form,"knife");
  // one number, two numbers: the shape keeps its proportions
  const pen=M.modelOf({name:"Pen",size:"15 cm long"}); assert.ok(near(pen.dims[0],0.15)&&near(pen.dims[1],0.0118,3e-4));
  const plate=M.modelOf({name:"Dinner plate",size:"27 cm × 3 cm"}); assert.deepEqual(plain(plate.dims),[0.27,0.27,0.03]);
  const bottle=M.modelOf({name:"Wine bottle",size:"30 cm tall × 8 cm"}); assert.deepEqual(plain(bottle.dims),[0.08,0.08,0.3]);
  assert.equal(M.sizeWords([0.17,0.12,0.07]),"17 × 12 × 7 cm"); assert.equal(M.sizeWords([0.076,0.162,0.009]),"16 × 7.6 × 0.9 cm"); assert.equal(M.sizeWords([0.0173,0.0173,0.0041]),"17 × 17 × 4.1 mm");
});

test("4 a model put in a scene: every part in the box it fills, turned with it; hanging = long and flat to the wall", ()=>{
  const m=M.modelOf({name:"Rinsed rice Tupperware",size:FILM[0][1]});
  const put=M.place(m,{id:"prop-rice",name:"Rinsed rice Tupperware (prop stand-in)",centre:[2,3,1.035],rz:Math.PI/2});
  assert.deepEqual(plain(put.size),[0.17,0.12,0.07]); assert.equal(put.objects.length,2);
  assert.deepEqual(plain(put.objects.map(o=>o.id)),["prop-rice-1","prop-rice-2"]); assert.ok(put.objects.every(o=>o.name==="Rinsed rice Tupperware (prop stand-in)"));
  assert.deepEqual(plain(put.objects.map(o=>o.material)),["prop-standin","prop-standin-2"]);
  // the lid sits on the body, at the top of the box: 1.035 + 0.035 - half its own height
  const lid=put.objects[1]; assert.ok(near(lid.position[0],2)&&near(lid.position[1],3)&&near(lid.position[2],1.035+0.035-0.0056,1e-3));
  assert.ok(near(lid.rotation[2],Math.PI/2)&&near(lid.rotation[0],0)&&near(lid.rotation[1],0),"turned a quarter with the thing");
  // hanging: the longest side down the wall, the thinnest out from it
  const keys=M.modelOf({name:"Cab keys"}), h=M.place(keys,{id:"prop-keys",name:"Cab keys (prop stand-in)",centre:[1,2,1.2],rz:0,hang:true});
  assert.deepEqual(plain(h.size),[0.06,0.014,0.11]);
  for(const o of h.objects){ assert.ok(Math.abs(o.position[1]-2)<=0.014/2+1e-3,"flat to the wall "+o.position); assert.ok(Math.abs(o.position[2]-1.2)<=0.11/2+1e-3); assert.ok(o.rotation.every(Number.isFinite)); }
  // the three turns made from a rotation give the rotation back (the renderer applies x, then y, then z)
  const R=(x,y,z)=>{ const cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
    return [[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx],[sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx],[-sy,cy*sx,cy*cx]]; };
  for(const t of [[0.3,-0.7,1.9],[Math.PI/2,0,0.4],[0,Math.PI/2,0.5],[1.1,-Math.PI/2,0],[0,0,0]]){ const A=R(...t), B=R(...M.turnsFrom(A));
    A.forEach((row,i)=>row.forEach((n,j)=>assert.ok(near(n,B[i][j],1e-6),"turns "+t))); }
});

// a small set: one room, a table, a row of hooks; one person holding a mug, a tub on the table, keys on the hook
const SET={objects:[{id:"anchor-table",name:"Kitchen table",anchorId:"table",kind:"box",position:[2,2,0.375],rotation:[0,0,0],size:[1.2,0.8,0.75],material:"wood"},
  {id:"anchor-hooks",name:"Row of key hooks",anchorId:"hooks",kind:"box",position:[0.03,2,1.5],rotation:[0,0,0],size:[0.04,0.3,0.06],material:"wood"}],
  materials:{wood:{baseColor:[0.5,0.4,0.3],metallic:0,roughness:0.7,emissionStrength:0}},cameras:{}};
const PLAN={marks:[{id:"m1",name:"by the table",xy:[2,1]}],fixed:[{id:"table",name:"Kitchen table"},{id:"hooks",name:"Row of key hooks"}],
  things:[{key:"tea",name:"Mug of tea",kind:"prop",propId:"p-mug"},{key:"rice",name:"Rinsed rice Tupperware",kind:"prop",propId:"p-rice"},{key:"keys",name:"Cab keys",kind:"prop"},{key:"gizmo",name:"Phone charger",kind:"prop"}]};
const STATE={people:{ann:{where:"m1",pose:"standing",holding:["tea"]}},things:{rice:{at:"table"},keys:{at:"hooks",state:"hanging"},gizmo:{at:"table"}},doors:[]};
const CTX={cast:[{id:"ann",name:"Ann Lee",height:"165 cm"}],props:[{id:"p-mug",name:"Mug of tea",size:FILM[2][1]},{id:"p-rice",name:"Rinsed rice Tupperware",size:FILM[0][1]}],
  spaces:[{id:"s1",name:"Kitchen",footprint:[[0,0],[4,0],[4,4],[0,4]],floorZ:0}],plan:PLAN,beat:1};

test("5 a shot's drawing puts each prop's model in the set at its true size, and says the size", ()=>{
  const got=V.stateScene(SET,PLAN,STATE,CTX), by=k=>got.things.find(t=>t.key===k), parts=k=>got.scene.objects.filter(o=>String(o.id).indexOf("prop-"+k+"-")===0);
  assert.deepEqual(plain(by("rice").size),[0.17,0.12,0.07]); assert.equal(by("rice").form,"tub"); assert.equal(by("rice").basis,"text"); assert.equal(by("rice").measured,true);
  assert.equal(parts("rice").length,2,"a body and a lid, not one box"); assert.ok(near(by("rice").at[2],0.75),"on the table top");
  assert.ok(parts("rice").every(o=>o.position[2]>0.75&&o.position[2]<0.75+0.07+1e-3&&/\(prop stand-in\)$/.test(o.name)&&/^prop-standin/.test(o.material)));
  assert.equal(by("tea").form,"mug"); assert.equal(parts("tea").length,3); assert.equal(by("tea").held,"ann");
  assert.equal(by("keys").basis,"usual"); assert.equal(by("keys").hung,true); assert.deepEqual(plain(by("keys").size),[0.06,0.014,0.11]); assert.equal(by("keys").measured,true,"the usual size of a bunch of keys is no guess");
  assert.equal(by("gizmo").basis,"guess"); assert.equal(by("gizmo").measured,false); assert.equal(parts("gizmo").length,1);
  for(const m of ["prop-standin","prop-standin-2","prop-standin-3","prop-standin-4"]){ const c=got.scene.materials[m].baseColor; assert.ok(c[0]>c[1]*2&&c[0]>c[2]*2,m+" is a red"); }
  // nothing of the set itself is changed, and the checks that read it never count a prop
  assert.equal(got.base.objects.length,SET.objects.length);
  assert.ok(previs.includes('/^(fig|prop)-/.test(String(o.id||""))'),"a prop is never a wall to a camera");
  const lines=plain(V.legend(got.people,got.things));
  assert.ok(lines.includes("The red shape in Ann Lee’s hands is the Mug of tea, drawn at its true size (11 × 9.5 × 8 cm)."),lines.join(" | "));
  assert.ok(lines.includes("The red shape on the kitchen table is the Rinsed rice Tupperware, drawn at its true size (17 × 12 × 7 cm)."));
  assert.ok(lines.includes("The red shape hanging from the row of key hooks is the Cab keys, drawn at the usual size of such a thing (11 × 6 × 1.4 cm)."));
  assert.ok(lines.includes("The red shape on the kitchen table is the Phone charger."),"a guessed size is not said");
  // a size handed in for one drawing is a plain box of that size, as before
  const forced=V.stateScene(SET,PLAN,STATE,{...CTX,sizeFor:k=>k==="rice"?[0.3,0.2,0.1]:null});
  assert.deepEqual(plain(forced.things.find(t=>t.key==="rice").size),[0.3,0.2,0.1]); assert.equal(forced.scene.objects.filter(o=>o.id==="prop-rice").length,1);
});

test("6 the frame is held to the model: its prompt, its QA check, the Stage's layout, what a drawing is drawn from", ()=>{
  assert.ok(shots.includes("Draw each thing a red shape stands for from its prop sheet, where the shape is, turned as the shape is, and exactly as large in the frame as the shape: each red shape is that thing built at its true size, so never draw the thing larger or smaller than its shape. "));
  assert.ok(ai.includes("(d) each object a red shape stands for is where the shape is and about the same size in the frame as the shape: the shape is that object built at its true size (a clear difference, half as big again or more, or two thirds or less, is a size error). "));
  assert.ok(stage.includes("each prop is a red shape of its true size: they only mark position and size."));
  assert.ok(previsUi.includes('props.map(p=>[p.id,p.size||"",p.scale||"",(p.dims||[]).join("x"),p.name||"",p.detail||"",p.form||"",p.modelForm||"",(p.model&&p.model.at)||""])'),"a changed card, or a newly built model, redraws the shot");
  for(const f of [previs,shots,stage,previsUi]) assert.ok(!/red box/i.test(f));
});

test("7 the prop card: the fold 'Model in code', three drawings beside a ruler, the shape and the three numbers", ()=>{
  const st=M.stage(M.modelOf({name:"Mug of tea",size:FILM[2][1]}));
  assert.equal(st.tick,0.01,"a small thing: a ruler in centimetres"); assert.equal(M.stage(M.modelOf({name:"Old suitcase"})).tick,0.1);
  assert.ok(st.scene.objects.some(o=>o.id==="model-floor")&&st.scene.objects.filter(o=>/^model-ruler-/.test(o.id)).length===12&&st.scene.objects.filter(o=>/^prop-model-/.test(o.id)).length===3);
  for(const o of st.scene.objects){ assert.ok(st.scene.materials[o.material],o.material); assert.ok(o.size.every(n=>n>0)&&o.position.every(Number.isFinite)&&o.rotation.every(Number.isFinite)); }
  assert.deepEqual(plain(Object.keys(st.poses)),["front","side","quarter"]);
  assert.ok(ui.includes('const PROP_MODEL_VIEWS = [["quarter","Three-quarter"],["front","Front"],["side","Side"]];'),"three-quarter first: it is shown large");
  // a flat thing is not drawn from far away: the camera stands as near as holds it (a card wallet 11 cm wide: under half a metre)
  const flat=M.stage(M.modelOf({name:"Pike\u2019s warrant card",size:FILM[1][1]})); assert.ok(Math.hypot(...flat.poses.front.position)<0.5&&Math.hypot(...flat.poses.front.position)>0.2,String(flat.poses.front.position));
  for(const k of Object.keys(st.poses)){ const p=st.poses[k]; assert.ok(p.position.length===3&&p.position[2]>0&&p.lensMm===70&&Math.abs(p.pitch)<89,k);
    // the camera looks at the middle of the thing, from far enough to hold all of it
    const a=p.yaw*Math.PI/180, b=p.pitch*Math.PI/180, look=[Math.sin(a)*Math.cos(b),Math.cos(a)*Math.cos(b),Math.sin(b)], d=Math.hypot(p.position[0],p.position[1]);
    assert.ok(d>0.1&&near(p.position[0]/d,-look[0]/Math.hypot(look[0],look[1]),0.02),k+" faces the thing"); }
  assert.ok(st.poses.front.position[1]>0,"the front camera stands on the thing's front side");
  // the card
  assert.ok(props.includes('window.PropModelFold && p.kind!=="worn" && React.createElement(window.PropModelFold,{ p, onUpdate, onView, gen:genForFrame, modelBase:modelBaseRef }),'));
  // inside "The object", under the Physical design it is read from: the card keeps its three rows (The object, Continuity, Advanced)
  const obj_=props.slice(props.indexOf('React.createElement(window.CardGroup,{label:"The object"'),props.indexOf('React.createElement(CardFold,{label:"Continuity \\u00b7 story events"'));
  assert.ok(obj_.indexOf("window.PropModelFold &&")>obj_.indexOf('label:"Physical dimensions"')&&/modelBase:modelBaseRef \}\),\n\n      \),\n\s*$/.test(obj_),"the last thing in The object");
  for(const t of ['label:"Model in code"','"data-testid":"prop-model"','"data-testid":"prop-model-shape"','"True size, in cm"','[["Wide",0],["Deep",1],["High",2]]','"Use the card’s text again"',
    'onUpdate(p.id, { dims:next })','onUpdate(p.id,{ dims:null })','onUpdate(p.id,{ modelForm:e.target.value||"" })','"Each block of the ruler is "','Object.assign(window,{ PropModelFold, propModelDraw, propModelSig, propModelSheetBase });'])
    assert.ok(ui.includes(t),t);
  assert.ok(ui.includes("const turn = propModelLine.then(run, run);")&&ui.includes("finally{ view.dispose(); }"),"one 3D view at a time, always given back");
  assert.ok(!/nbCommit|proxyGenerate|localStorage|setProject/.test(ui+src),"nothing saved but what the person sets, no image engine called from here");
  assert.equal(src.split("claude.complete(").length-1,1,"one engine call in all of it: the model a person asks to be built (draft)");
  assert.ok(!/claude\.complete/.test(ui));
  assert.ok(!/claude|anthropic|gemini|gpt|three\.?js|\bTURN\b|\bMUSE\b|McKee/.test(ui.replace(/\/\*[\s\S]*?\*\//g,"")),"nothing internal in what people read");
  for(const c of [".prop-model-pics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}",".prop-model-pics > figure:first-child{grid-column:1/-1}",".prop-model-cm{"]) assert.ok(css.includes(c),c);
});

// ---- STAGE 2 (owner 2026-11-24: "yes, go on to stage 2") ----
const WALLET={what:"a bifold leather wallet",size:[11,7.5,1],colours:{main:"#1a1a1c",second:"#888c90",dark:"#0a0a0a",light:"e8e6e0",odd:"red"},parts:[
  {shape:"box",size:[11,7.5,0.45],at:[0,0,0.225],tone:"main",what:"back cover"},{shape:"box",size:[11,7.5,0.45],at:[0,0,0.775],tone:"main",what:"front cover"},
  {shape:"cylinder",size:[1,1,7.5],at:[-5.3,0,0.5],turn:[90,0,0],tone:"main",what:"spine"},{shape:"box",size:[4,5,0.2],at:[2,0,1.05],tone:"second",what:"crest"},
  {shape:"cone",size:[1,1,1],at:[0,0,0],what:"a cone"},{shape:"box",size:[1,"x",1],at:[0,0,0],what:"no size"},{shape:"ring",size:[2,2,0.2],at:[4,2,1.1],turn:45,tone:"shiny",what:"stud"}]};

test("9 a model built for one prop: the answer is read safely, set down on the table, brought to its stated size", ()=>{
  const got=M.built(WALLET), m=got.model;
  assert.equal(m.v,2); assert.equal(m.what,"a bifold leather wallet"); assert.equal(m.parts.length,5);
  assert.deepEqual(plain(got.left),["a cone: a shape a model cannot have","no size: no size or no place"]);
  assert.deepEqual(plain(m.parts.map(q=>q[0])),["box","box","cylinder","box","torus"]); assert.equal(m.parts[4][3],"main","a tone it does not know is the main one");
  assert.ok(near(Math.abs(m.parts[4][4][2]),Math.PI*3/4)&&near(Math.abs(m.parts[2][4][0]),Math.PI/2),"turns in degrees, then the whole model turned half round to face front");
  // the builder stands at -y: what it put on its left (the spine, x = -5.3) and its right (the crest, x = +2) is turned half round, so a model's front is +y
  assert.ok(m.parts[2][2][0]>0.04&&m.parts[3][2][0]<-0.01,"left and right as seen from the front: "+m.parts[2][2][0]+" "+m.parts[3][2][0]);
  // on the table, centred, its longest side as stated (11 cm), in metres
  const b=M.bounds(m.parts); assert.ok(near(b.lo[2],0,1e-4)&&near((b.lo[0]+b.hi[0])/2,0,1e-4)&&near((b.lo[1]+b.hi[1])/2,0,1e-4));
  assert.ok(near(Math.max(...m.dims),0.113,2e-3),String(m.dims)); assert.deepEqual(plain(m.colours.main),[0.102,0.102,0.11]); assert.deepEqual(plain(Object.keys(m.colours)),["main","second","dark","light"]);
  // built at another size than it states: brought to the stated size, and it says so
  const big=M.built({...WALLET,size:[22,15,2]}); assert.ok(near(Math.max(...big.model.dims),0.22,1e-3)); assert.ok(big.left.some(t=>/brought to it/.test(t)));
  // more parts than a model holds; nothing readable
  const many=M.built({size:[5,1,24],parts:Array.from({length:40},(_,i)=>({shape:"box",size:[1,1,1],at:[i%5,0,i]}))}); assert.equal(many.model.parts.length,24); assert.equal(many.left.length,16);
  assert.equal(M.built({parts:[{shape:"blob"}]}).model,null); assert.equal(M.built(null).model,null);
  // saved on the card with who built it and from what; read back safely
  const card={id:"p1",name:"Pike’s warrant card",form:"A bifold black leather wallet",size:FILM[1][1]}, kept=M.keep(m,card,{at:"2026-11-24T10:00:00.000Z"});
  assert.equal(kept.by,"claude-fable-5-2"); assert.equal(kept.from,M.sigOf(card)); assert.ok(M.saved(kept)&&M.saved(kept).parts.length===5);
  for(const bad of [null,{},{v:3,dims:[1,1,1],parts:kept.parts},{v:1,dims:[1,1],parts:kept.parts},{v:1,dims:[0.1,0.1,0.1],parts:[["cone",[1,1,1],[0,0,0],"main",[0,0,0]]]}]) assert.equal(M.saved(bad),null);
  // it IS the prop from then on: in the card's drawing and in every shot
  const mine=M.modelOf({...card,model:kept}); assert.equal(mine.basis,"built"); assert.equal(mine.form,"built"); assert.equal(mine.label,"a bifold leather wallet"); assert.equal(mine.parts.length,5); assert.equal(mine.built,true);
  const scene=V.stateScene(SET,{...PLAN,things:[{key:"card",name:"Pike’s warrant card",kind:"prop",propId:"p1"}]},{people:{},things:{card:{at:"table"}},doors:[]},{...CTX,props:[{...card,model:kept}]});
  assert.equal(scene.scene.objects.filter(o=>/^prop-card-/.test(o.id)).length,5); assert.equal(scene.things[0].basis,"built"); assert.equal(scene.things[0].measured,true);
  assert.ok(plain(V.legend([],scene.things))[0].endsWith("drawn at its true size (11 × 7.5 × 1.2 cm)."),V.legend([],scene.things)[0]);
  // the card's three numbers resize it; a shape picked by hand uses the standard shape; a changed description says so
  const sized=M.modelOf({...card,model:kept,dims:[0.12,0.08,0.012]}); assert.equal(sized.basis,"set"); assert.deepEqual(plain(sized.dims),[0.12,0.08,0.012]); assert.equal(sized.parts.length,5);
  assert.equal(M.modelOf({...card,model:kept,modelForm:"card"}).form,"card");
  assert.equal(M.stale({...card,model:kept}),false); assert.equal(M.stale({...card,form:"A trifold wallet",model:kept}),true); assert.equal(M.stale(card),false);
  // its own colours on the card's drawing; plain ones for a standard shape
  assert.deepEqual(plain(M.stage(mine).scene.materials["model-main"].baseColor),[0.102,0.102,0.11]);
  assert.deepEqual(plain(M.stage(M.modelOf({name:"Mug of tea"})).scene.materials["model-main"].baseColor),[0.5,0.52,0.56]);
});

await (async()=>{
  // the one writing call, with a stand-in engine
  let asked=null;
  box.claude={complete:async(o)=>{ asked=o; return {text:"Here it is:\n"+JSON.stringify(WALLET)}; }};
  const card={id:"p1",name:"Pike’s warrant card",form:"A bifold black leather wallet that opens like a book.",material:"Black leather, silver-tone crest",signatureFeature:"A worn corner",size:FILM[1][1]};
  const r=await M.draft(card);
  test("10 the writing pass: one call, on the card's own words, on its engine; an unreadable answer changes nothing", ()=>{
    assert.equal(asked.modelId,"claude-fable-5-2"); assert.equal(asked.effort,"low"); assert.equal(asked.timeoutMs,120000); assert.ok(asked.timeoutMs<150000,"under the server's time limit");
    const text=asked.messages[0].content;
    for(const t of ["Name: Pike’s warrant card","What it is: A bifold black leather wallet that opens like a book.","Material and finish: Black leather, silver-tone crest","Identifying details: A worn corner","Size as written: Closed: ~11 cm wide",
      "build it as it rests on a table","z = 0 is the table top","between 4 and 20 (never more than 24)","\"box\"","\"cylinder\"","\"ring\"","\"ball\"","\"pad\"","Every part lies inside the box of `size`","nothing floats","Return ONLY compact JSON"]) assert.ok(text.includes(t),t);
    assert.ok(!/kinolot|\bTURN\b|\bMUSE\b|McKee/.test(text));
    assert.equal(r.model.parts.length,5); assert.equal(r.model.by,"claude-fable-5-2"); assert.equal(r.model.from,M.sigOf(card)); assert.equal(r.left.length,2);
    const e=M.estimate(card); assert.ok(e.credits>=1&&e.credits<=20&&e.outputTokens===1500,JSON.stringify(e));
  });
  let threw="";
  box.claude={complete:async()=>"sorry, no"}; try{ await M.draft(card); }catch(e){ threw=e.message; }
  let empty="";
  try{ await M.draft({id:"p2",name:"Thing"}); }catch(e){ empty=e.message; }
  test("10b nothing readable, or nothing to build from: a plain sentence, and nothing is changed", ()=>{
    assert.equal(threw,"The model came back incomplete. Nothing was changed; try again.");
    assert.equal(empty,"Write what this prop looks like first (Physical design): the model is built from it. Nothing was changed.");
  });
})();

test("11 the sheet's layout from the model: front, side and close-up, each held inside the middle third of its frame", ()=>{
  // a thing that lies flat is stood up, its face to the camera; its side is turned 70 degrees, never a bare line
  const phone=M.sheet(M.modelOf({name:"Eshita’s phone",size:FILM[4][1]}));
  assert.equal(phone.stood,true); assert.equal(phone.thin,true); assert.deepEqual(plain(phone.size),[0.076,0.009,0.162]); assert.equal(phone.own,false);
  assert.equal(phone.poses.front.yaw,180); assert.equal(phone.poses.side.yaw,250); assert.equal(phone.poses.front.pitch,0);
  // a mug stands as it is; its side is a true quarter turn
  const mug=M.sheet(M.modelOf({name:"Mug of tea",size:FILM[2][1]}));
  assert.equal(mug.stood,false); assert.equal(mug.thin,false); assert.equal(mug.poses.side.yaw,270);
  for(const s of [phone,mug,M.sheet(M.modelOf({name:"Wine bottle"})),M.sheet(M.modelOf({name:"Old suitcase"}))]){
    // front and side from the same distance and height: the same size, one baseline
    const d=q=>Math.hypot(q.position[0],q.position[1]); assert.ok(near(d(s.poses.front),d(s.poses.side),1e-3)&&near(s.poses.front.position[2],s.poses.side.position[2],1e-4)&&near(s.poses.front.position[2],s.size[2]/2,1e-4));
    // the thing fits the middle third: 6 mm of a 36 mm frame each side of centre, 10.125 mm up and down (a 16:9 frame)
    const D=d(s.poses.front), lens=s.poses.front.lensMm; assert.equal(lens,100);
    assert.ok(s.size[0]/2<=D*6/lens&&s.size[2]/2<=D*10.125/lens,"front fits its panel"); assert.ok(s.size[0]/2>=D*6/lens*0.45||s.size[2]/2>=D*10.125/lens*0.45,"and fills a good part of it");
    assert.ok(d(s.poses.close)<D*0.75&&s.poses.close.pitch<0,"the close-up moves in, from above");
    assert.ok(s.scene.objects.length>=1&&s.scene.objects.every(o=>/^prop-model-/.test(o.id)&&s.scene.materials[o.material]),"the prop alone: no floor, no ruler");
  }
  // drawn by the card: three middle thirds side by side on off-white, thin lines between
  for(const t of ['const PROP_SHEET_PAPER = "#f1efea";','["front","side","close"].forEach((k,i)=>{','g.drawImage(c, third, 0, third, H, i*third, 0, third, H);','g.fillRect(third-1,0,2,H); g.fillRect(2*third-1,0,2,H);',
    'pics = { ...pics, layout:(await propModelSheetBase(model, 960)).url }','"data-testid":"prop-model-layout"','"Layout of its image"']) assert.ok(ui.includes(t),t);
});

test("12 the image made from the model: the layout is the base image and leads every prompt of that render", ()=>{
  // the card's image maker
  for(const t of ["const modelBaseRef = React.useRef(null);","referenceFallback: async (gopts)=> (gopts && gopts.modelBase && gopts.modelBase.url) || null,","buildFromBase: ()=> buildPropFromModelPrompt(p, project),",
    'buildSimple: ()=> (modelBaseRef.current ? propModelLayoutLead(p)+" " : "")+buildSimplePropPrompt(p),','fromModel:{ form:b.form||"", basis:b.basis||"", dims:b.dims||null }']) assert.ok(props.includes(t),t);
  assert.ok(props.includes('function buildPropFromModelPrompt(p, project){ return propModelLayoutLead(p)+"\\n\\n"+combinedPropPrompt(p, project); }'),"the sheet's own prompt follows, whole");
  const lead=props.slice(props.indexOf("function propModelLayoutLead(p){"),props.indexOf("function buildPropFromModelPrompt"));
  for(const t of ["IMAGE 1 IS THE LAYOUT: this object built in code as a plain 3D model at its true proportions","three equal panels, FRONT, SIDE, CLOSE-UP","Draw the SAME sheet, finished.",
    "the layout wins over any other words about shape or proportion","Do not add, remove or move a part, and do not make the object rounder, slimmer, taller, thicker or more elegant than the model.",
    "flat colours are the object\\u2019s own base colours","flat greys and blue are placeholders, never its colours: take every colour from the description","it gives style and world only, never shape"]) assert.ok(lead.includes(t),t);
  // the button: the layout drawn large at the press, held on the card for that one render, cleared after it whatever happens
  for(const t of ['"data-testid":"prop-model-image"','"Make the image from this model"',"const base = await propModelSheetBase(model, 1536);","if(modelBase) modelBase.current = sent;","await gen.generate({ modelBase:sent, baseMaxDim:1536 });",
    "finally{ if(modelBase) modelBase.current = null; setMaking(false); }","window.nbCostChip(1,{ refs:1 })","disabled:!!gen.gening || making || !pics"]) assert.ok(ui.includes(t),t);
  // the build button: its number, its progress where it was pressed, saved by the person's press only
  for(const t of ['"data-testid":"prop-model-build"','own ? "Build again" : "Build its own model"','"About "+est+" writing credit"','const r = await M.draft(p);','onUpdate(p.id, { model:r.model, modelForm:"" });',
    'work:{ text:"Building the model", since:build.since, est:45, engine:propModelEngine() }','"data-testid":"prop-model-drop"','"Use the standard shape"','title:"Drop this prop’s own model?"','if(ok) onUpdate(p.id, { model:null });',
    'if(PROP_MODEL_BUILDING[p.id] || !writable()) return;']) assert.ok(ui.includes(t),t);
  assert.ok(ui.includes("(window.WRITING_MODELS||[]).find(x=>x && x.id===(id||window.KinolotPropModel.MODEL)); return (m && m.label) || \"\";"),"the engine by its name in the engine list, never its id");
});

test("13 closed or open, and no part made only to round a corner (after the first image made from a model)", ()=>{
  const card={id:"p1",name:"Pike’s warrant card",form:"A bifold black leather wallet that opens like a book.",size:FILM[1][1]};
  // a prop whose card says it opens is offered the choice; a mug is not
  assert.equal(M.opens(card),true); assert.equal(M.opens({form:"Straight-sided tea mug with a handle",size:"9.5 cm tall"}),false); assert.equal(M.opens({form:"A notebook with a hinged cover"}),true);
  assert.equal(M.stateOf("open"),"open"); assert.equal(M.stateOf(""),"closed"); assert.equal(M.stateOf("ajar"),"closed");
  // the builder is told the state, and to build no part only for rounding; each part is named by what it is
  const closed=M.prompt(card), open=M.prompt({...card,modelState:"open"});
  assert.ok(closed.includes("STATE: CLOSED, as it is carried. Build its outside only: nothing that is inside it is built.")&&!closed.includes("STATE: OPEN"));
  assert.ok(open.includes("STATE: OPEN, as it is held out for someone to look at: opened fully and laid flat on the table, its inside facing up.")&&open.includes("Take the open measurements where the size text gives them.")&&!open.includes("STATE: CLOSED"));
  for(const t of ["NEVER add a part only to round, soften or finish an edge or a corner (no corner posts, no edge beads, no trim strips)","a plain box is right for a thing with rounded corners","Name each part by what it is on this prop"]) assert.ok(closed.includes(t),t);
  // the model keeps its state and its parts' names; a changed choice makes it older than the card
  const got=M.built({what:"an open bifold wallet",size:[22,7.5,0.5],parts:[{shape:"box",size:[11,7.5,0.5],at:[-5.5,0,0.25],what:"Left panel"},{shape:"box",size:[11,7.5,0.5],at:[5.5,0,0.25],what:"right panel"},
    {shape:"box",size:[4,5,0.3],at:[-5.5,0,0.6],tone:"light",what:"crest badge"},{shape:"box",size:[8,5,0.1],at:[5.5,0,0.55],tone:"light",what:"crest badge"}]});
  const kept=M.keep(got.model,{...card,modelState:"open"});
  // which way it faces: the builder's left panel (x = -5.5) is at +x here, so that from the front (+y) it is on the left; the sheet stands it up that way round
  assert.ok(kept.parts[0][2][0]>0.05&&kept.parts[1][2][0]<-0.05); assert.ok(M.prompt(card).includes("WHERE YOU STAND: at -y, looking towards +y.")&&M.prompt(card).includes("reads the right way up from where you stand"));
  // a model saved before this (v 1, as the builder wrote it) is turned when it is read; what is saved is not rewritten
  const old={...kept,v:1,parts:kept.parts.map(q=>[q[0],q[1],[-q[2][0],-q[2][1],q[2][2]],q[3],[0,0,0],q[5]])}, read=M.saved(old);
  assert.equal(read.v,2); read.parts.forEach((q,i)=>{ assert.ok(near(q[2][0],kept.parts[i][2][0],1e-4)&&near(q[2][1],kept.parts[i][2][1],1e-4)); }); assert.equal(old.parts[0][2][0]<0,true);
  assert.equal(M.built({what:"an open wallet lying flat,",size:[10,5,1],parts:[{shape:"box",size:[10,5,1],at:[0,0,0.5]}]}).model.what,"an open wallet lying flat");
  assert.equal(kept.state,"open"); assert.deepEqual(plain(M.partNames(kept)),["left panel","right panel","crest badge"]); assert.equal(M.saved(kept).state,"open"); assert.equal(M.saved(kept).parts[0][5],"Left panel");
  assert.equal(M.keep(got.model,card).state,"closed"); assert.equal(M.saved({...kept,state:undefined}).state,"closed","a model built before the choice existed was built closed");
  const mine=M.modelOf({...card,modelState:"open",model:kept}); assert.equal(mine.state,"open"); assert.deepEqual(plain(mine.dims),[0.22,0.075,0.0075]); assert.equal(mine.parts[2][5],"crest badge");
  assert.equal(M.stale({...card,modelState:"open",model:kept}),false); assert.equal(M.stale({...card,model:kept}),true,"built open, now asked closed");
  assert.notEqual(M.sigOf(card),M.sigOf({...card,modelState:"open"})); assert.equal(M.sigOf(card),M.sigOf({...card,modelState:"closed"}));
  // an open flat thing is stood up for its sheet, its inside to the camera
  const sh=M.sheet(mine); assert.equal(sh.stood,true); assert.deepEqual(plain(sh.size),[0.22,0.0075,0.075]);
  // the card: the choice, shown when the card says it opens; the line says how it was built
  for(const t of ['"data-testid":"prop-model-state"','PMU_E("option",{value:"closed"},"Closed, as it is carried")','PMU_E("option",{value:"open"},"Open, as it is shown")','onChange:e=>onUpdate(p.id,{ modelState:e.target.value==="open" ? "open" : "" })',
    '(M.opens(p) || p.modelState || (own && own.state==="open"))','"Its own model, built "+own.state+','" Build it again to have it "+M.stateOf(p.modelState)+"."','...(model.built ? { state:model.state||"closed" } : {})']) assert.ok(ui.includes(t),t);
  // the image's words: the parts the model has and no others; no fitting made of a corner; closed = its outside only
  const lead=props.slice(props.indexOf("function propModelLayoutLead(p){"),props.indexOf("function buildPropFromModelPrompt"));
  for(const t of ['"THE MODEL\\u2019S PARTS are these and no others: "+names.join("; ")+". "',"never turn a block\\u2019s corner, edge or join into a fitting, a stud, a rivet, a bracket, a cap or a metal corner that the description does not name",
    "THE OBJECT IS SHOWN OPEN, its inside to the camera, in every panel, as the model is.","THE OBJECT IS SHOWN CLOSED in every panel, as the model is: draw its outside only.","cannot be seen and is left out"]) assert.ok(lead.includes(t),t);
  const fact=ai.split("\n").find(l=>l.startsWith('APP_FEATURES.push({ name:"Props: the model in code"'));
  for(const t of ["'Built' offers 'Closed, as it is carried' or 'Open, as it is shown'","built closed, the image shows its outside only; built open, its inside"]) assert.ok(fact.includes(t),t);
  for(const f of ["app/prop-model.js","app/prop-model-ui.jsx","app/props.jsx","app/ai.jsx","app/script.jsx","app/styles.css"]) assert.ok(["20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1"].some(k=>html.includes(f+"?v="+k+'"')),f+" has this fix's key");
});

test("8 loaded in order, fresh keys, and Frances knows", ()=>{
  const i=s=>html.indexOf(s);
  assert.ok(i("app/prop-model.js?v=")>0&&i("app/prop-model.js?v=")<i("app/shot-previs.js?v="),"the model before the drawing that uses it");
  assert.ok(i("app/props.jsx?v=")<i("app/prop-model-ui.jsx?v=")&&i("app/artroom.jsx?v=")<i("app/prop-model-ui.jsx?v="));
  for(const f of ["app/prop-model.js","app/prop-model-ui.jsx","app/shot-previs.js","app/shot-previs-ui.jsx","app/props.jsx","app/shots.jsx","app/stage.jsx","app/ai.jsx","app/script.jsx","app/styles.css"])
    assert.ok(["20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1"].some(k=>html.includes(f+"?v="+k+'"')),f+" has a fresh key");
  for(const f of ["app/prop-model.js","app/prop-model-ui.jsx","app/props.jsx","app/shot-previs-ui.jsx","app/ai.jsx","app/script.jsx","app/styles.css"])
    assert.ok(["20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1"].some(k=>html.includes(f+"?v="+k+'"')),f+" has stage 2's key");
  const g=[]; new Function("APP_FEATURES",ai.split("\n").filter(l=>l.startsWith('APP_FEATURES.push({ name:"Props: the model in code"')).join("\n"))(g);
  assert.equal(g.length,1);
  const fact=g[0].what;
  for(const t of ["'The object', the fold 'Model in code'","Three-quarter (the large one), Front and Side","read from the card's 'Physical dimensions'","the usual size of such a thing","the line says it is a guess","'True size, in cm'","Wide, Deep and High",
    "'Use the card's text again'","pick another from the list","the prop is the same size in every drawing","to draw the prop exactly as large as its shape","A tracked thing of the scene plan that has no card","makes no image and changes nothing",
    "'Build its own model' is a writing step","a bar, a clock and the engine's name show while it works","'Build again'","'Use the standard shape' drops it, after asking","'Layout of its image'",
    "three equal panels, front, side and close-up","'Make the image from this model'","keeps the model's shape and proportions in each panel","the image you had stays in its versions"])
    assert.ok(fact.includes(t),t);
  assert.ok(!/credit|\$|claude|anthropic|fable|opus|gemini|gpt|three\.?js|\bTURN\b|\bMUSE\b|kinolot/i.test(fact),"no price, no engine, no internal name");
  assert.ok(!/\btab\b/i.test(g[0].name),"a fact's name with 'tab' in it answers for every tab");
});

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);
