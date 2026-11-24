/* THE SET CARD (owner 2026-11-23). The owner designed a location card elsewhere ("one card per set") and asked for it
   here: "build the card with your four picks ... keep this exact same structure and design and layout used in the
   demo. All we have to change is the colors, the button sizes, the spacing ... and the font type", and then, having
   seen it: "create sections on the card that allow us to fold each section as we are able to do for other tab cards
   ... a floor plan section ... the exact same level of detail we have on the demo ... make it look much better,
   more realistic, so it doesn't look like a lazy, boring 3D set ... I don't want just a bunch of boxes".
   So a place's card opens with the set card: the chosen camera's view (MASTER SET, CAM n), the name and a chip per
   space, the facts and what the camera is for, Colour / Clay / Depth; then sections that fold like the other
   cards': Location sheet, Floor plan (walls, doors, windows, the chosen room lit with its size, the camera and what
   it takes in, two stand-ins to drag, their place in metres, and the plan's own tools), Connects to, Reference
   pack, Location image. The set is drawn with painted surfaces and two jointed stand-ins (set-surfaces.js), for
   this card only. It reads only what the app already has and saves nothing. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const data=read("app/location-set-card.js"), face=read("app/location-set-card-ui.jsx"), ui=read("app/locations-ui.jsx");
const previs=read("app/set-previs.js"), surf=read("app/set-surfaces.js"), css=read("app/styles.css"), html=read("TURN.html"), ai=read("app/ai.jsx");
let pass=0, fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n")[0]); } };

// (what the sandbox returns is compared as plain data: its arrays are another realm's)
const plain=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const wrap=k=>{ const out={}; Object.keys(k).forEach(n=>{ out[n]=typeof k[n]==="function"?(...a)=>plain(k[n](...a)):plain(k[n]); }); return out; };
const load=(extra)=>{ const box={console,...(extra||{})}; box.window=box; vm.createContext(box); vm.runInContext(data,box); return wrap(box.KinolotSetCard); };
const K=load();

/* a small place: a flat (4 x 3 m) with a hall beside it (1 x 3 m), a door between them, a window to the south, a door
   that leads off the plan, and one camera */
const PLAN={spaces:[{id:"flat",name:"Flat",footprint:[[0,0],[4,0],[4,3],[0,3]],centre:[2,1.5]},{id:"hall",name:"Hall",footprint:[[4,0],[5,0],[5,3],[4,3]],centre:[4.5,1.5]}],
  openings:[{spaceId:"flat",kind:"door",name:"hall door",centre:[4,1.5],a:[4,1],b:[4,2]},
    {spaceId:"flat",kind:"window",name:"sash window",centre:[2,0],a:[1,0],b:[3,0]},
    {spaceId:"flat",kind:"door",name:"door to the bedrooms",centre:[0,1.5],a:[0,1],b:[0,2]},
    {spaceId:"hall",kind:"arch",name:"arch to the yard",centre:[5,1],a:[5,0.5],b:[5,1.5]},
    {spaceId:"flat",kind:"door",name:"far away",centre:[40,40],a:[40,39],b:[40,41],outlier:true}],
  cameras:[{spaceId:"flat",panel:"TL",position:[1,1,1.5],frustum:[[1,1],[3,2],[3,0]]},{spaceId:"hall",panel:"TL",position:[4.5,2,1.5],frustum:[[4.5,2],[4.2,0],[4.8,0]]}]};
const FLAT={id:"flat",name:"Flat",whole:true}, HALL={id:"hall",name:"Hall",whole:false};

test("1 the spaces of a card: the place first, then each room by the short name the app already uses", ()=>{
  const short=(room,place)=>room.name.replace(place.name+" - ","");
  const k=load({locationRoomShortName:short});
  const got=k.spaces({id:"p",name:"House"},[{id:"p",name:"House"},{id:"r1",name:"House - Kitchen"},{id:"r2",name:"Yard"}]);
  assert.deepEqual(got.map(s=>[s.id,s.chip,s.whole]),[["p","House",true],["r1","Kitchen",false],["r2","Yard",false]]);
  assert.equal(got[1].name,"House - Kitchen","the full name is kept for tooltips");
  assert.deepEqual(K.spaces({id:"p",name:""},[]).map(s=>s.chip),["This place"]);
});

test("2 the four views of a space, in the sheet's order, each with what the camera is for and its lens", ()=>{
  const poses=()=>[{key:"BR",label:"Bottom-right",purpose:"from the window, back to the door",pose:{position:[1,1,1.5],yaw:10,lensMm:35}},
    {key:"TL",label:"Top-left",purpose:"",pose:{position:[0,0,1.5],yaw:90,lensMm:18}},{key:"TR",label:"Top-right",purpose:"across the room",pose:{yaw:0}}];
  const k=load({locationPanelPoses:poses}), v=k.views({id:"x"});
  assert.deepEqual(v.map(x=>x.key),["TL","TR","BR"],"sheet order; a camera that is not there is left out");
  assert.deepEqual(v.map(x=>x.n),[1,2,4],"a view keeps its own number on the sheet");
  assert.equal(v[0].role,"Top-left view","no purpose written: the panel's own name");
  assert.equal(v[2].role,"From the window, back to the door");
  assert.equal(v[1].placed,false); assert.equal(v[0].placed,true);
  assert.equal(k.camTag(v[2]),"CAM 4 · 35 MM"); assert.equal(k.camTag(v[1]),"CAM 2"); assert.equal(k.camTag(null),"");
  assert.deepEqual(K.views({id:"x"}),[],"no camera reader: no views, and nothing throws");
  assert.deepEqual(load({locationPanelPoses:()=>{throw new Error("no plan");}}).views({id:"x"}),[]);
});

test("3 the facts: a room's size and ceiling; the place adds its rooms and cameras", ()=>{
  assert.equal(K.sizeText(PLAN.spaces[1].footprint),"1.0 × 3.0 m");
  assert.equal(K.sizeText([]),"");
  const coords={spaces:[{id:"flat",ceilingH:2.4},{id:"hall",openSky:true}]};
  assert.equal(K.facts(FLAT,[FLAT,HALL],PLAN,coords),"4.0 × 3.0 m footprint · 2.4 m ceiling · 1 room · 2 cameras");
  assert.equal(K.facts(HALL,[FLAT,HALL],PLAN,coords),"1.0 × 3.0 m · open sky");
  assert.equal(K.facts(FLAT,[FLAT],PLAN,null),"4.0 × 3.0 m","a place with no rooms is a room like any other");
  assert.equal(K.facts({id:"gone"},[FLAT],PLAN,coords),"","a space that is not on the plan has no facts");
});

test("4 connects to: the rooms it opens onto, then each door that leads off the plan by its name, then Outside", ()=>{
  assert.deepEqual(K.connections("flat",PLAN),[{name:"Hall",kinds:["door"]},{name:"Door to the bedrooms",kinds:["door"]},{name:"Outside",kinds:["window"]}]);
  // the hall owns one opening and stands on the edge of the flat's door
  assert.deepEqual(K.connections("hall",PLAN),[{name:"Flat",kinds:["door"]},{name:"Arch to the yard",kinds:["open archway"]}]);
  assert.deepEqual(K.connections("nowhere",PLAN),[]);
  // two openings of one kind to the same room are said once
  const twice={...PLAN,openings:PLAN.openings.concat([{spaceId:"flat",kind:"door",centre:[4,2.6],a:[4,2.4],b:[4,2.8]},{spaceId:"flat",kind:"glass",centre:[4,0.4],a:[4,0.2],b:[4,0.6]}])};
  assert.deepEqual(K.connections("flat",twice)[0],{name:"Hall",kinds:["door","window"]});
});

test("5 marks come from the film's scene plans: the first scene, in story order, that has marks in these spaces", ()=>{
  const project={scenePlans:{
    s9:{sets:[{id:"a",locationId:"flat"}],marks:[{id:"m",set:"a",name:"late mark",xy:[1,1]}]},
    s5:{sets:[{id:"a",locationId:"flat"},{id:"b",locationId:"street"}],marks:[{id:"m1",set:"a",name:"front door",xy:[0,0.1]},{id:"m2",set:"a",near:"the shelf",xy:[0.05,0.55]},
      {id:"m3",set:"b",name:"kerb",xy:[9,9]},{id:"m4",set:"a",name:"no numbers"}]},
    s2:{sets:[{id:"z",locationId:"elsewhere"}],marks:[{id:"q",set:"z",name:"x",xy:[0,0]}]}}};
  const scenes=[{id:"s2",no:2},{id:"s5",no:5},{id:"s9",no:9}];
  const got=K.marks(project,["flat"],scenes);
  assert.equal(got.sceneId,"s5"); assert.equal(got.sceneNo,5);
  assert.deepEqual(got.marks,[{letter:"A",name:"Front door",xy:[0,0.1]},{letter:"B",name:"The shelf",xy:[0.05,0.55]}],"only this set's marks that have a place on the plan");
  assert.equal(K.marksLine(got),"A Front door  ·  B The shelf");
  assert.equal(K.marks(project,["hall"],scenes),null);
  assert.ok(K.marksLine(null).startsWith("No marks yet. Plan a scene set here, in Shots"));
  assert.equal(K.marks({},["flat"],scenes),null); assert.equal(K.marks(null,null,null),null);
  const many={scenePlans:{s:{sets:[{id:"a",locationId:"flat"}],marks:Array.from({length:12},(_,i)=>({id:"m"+i,set:"a",name:"m"+i,xy:[i,0]}))}}};
  assert.equal(K.marks(many,["flat"],[]).marks.length,8,"eight at most");
});

test("6 the two stand-ins: on a scene's first marks in the space, else either side of the room's middle; none where nobody can stand", ()=>{
  const st=K.standIns(FLAT,PLAN,null,null);
  assert.deepEqual([st.A,st.B].map(p=>p.map(n=>+n.toFixed(2))),[[1.28,1.5],[2.72,1.5]],"along the longer side, either side of the middle");
  assert.deepEqual(st.names,{A:"",B:""}); assert.equal(st.sceneNo,null);
  const found={sceneNo:5,marks:[{letter:"A",name:"Door",xy:[1,1]},{letter:"B",name:"Shelf",xy:[3,2]},{letter:"C",name:"Hooks",xy:[2,2]}]};
  const on=K.standIns(FLAT,PLAN,found,null);
  assert.deepEqual([on.A,on.B],[[1,1],[3,2]]); assert.deepEqual(on.names,{A:"Door",B:"Shelf"}); assert.equal(on.sceneNo,5);
  assert.equal(K.peopleLine(on,on.names),"A  Door \u00b7 x 1.00, y 1.00 m   \u00b7   B  Shelf \u00b7 x 3.00, y 2.00 m");
  assert.equal(K.peopleLine(on,{A:"",B:""}),"A  x 1.00, y 1.00 m   \u00b7   B  x 3.00, y 2.00 m");
  // one mark only: B takes the default place; a mark outside this space does not count
  const one=K.standIns(FLAT,PLAN,{sceneNo:5,marks:[{letter:"A",name:"Door",xy:[1,1]},{letter:"B",name:"Kerb",xy:[40,40]}]},null);
  assert.deepEqual(one.A,[1,1]); assert.equal(one.names.B,"");
  // the inside of a car (a ceiling too low to stand under), a sliver of a space, a space that is not on the plan
  assert.equal(K.standIns(FLAT,PLAN,null,{spaces:[{id:"flat",ceilingH:1.2}]}),null);
  assert.ok(K.standIns(FLAT,PLAN,null,{spaces:[{id:"flat",ceilingH:1.2,openSky:true}]}),"open sky is never too low");
  assert.equal(K.standIns({id:"s"},{spaces:[{id:"s",footprint:[[0,0],[0.5,0],[0.5,6],[0,6]]}]},null,null),null);
  assert.equal(K.standIns({id:"gone"},PLAN,null,null),null);
  assert.ok(K.peopleLine(null,null).startsWith("No stand-ins here"));
  // a stand-in that is dragged out of the room comes back inside it, 20 cm clear of the wall
  const back=K.keepInside(PLAN.spaces[0].footprint,[9,1.5],[2,1.5]);
  assert.ok(back[0]<=3.8&&back[0]>=2&&back[1]===1.5,"it stops inside, on its way back");
  assert.deepEqual(K.keepInside(PLAN.spaces[0].footprint,[2,1],[0,0]),[2,1],"a point inside stays");
});

test("6b the plan, ready to draw: the whole place with the chosen space lit, walls, doors and windows, its camera, the stand-ins", ()=>{
  const st=K.standIns(FLAT,PLAN,null,null), m=K.planModel(PLAN,FLAT,"TL",st,440);
  assert.equal(m.W,440); assert.ok(m.H>=170&&m.H<=380); assert.equal(m.missing,false);
  // a compact place: every room is in the picture, the chosen one alone lit and sized (the bigger room drawn first)
  assert.deepEqual(m.rooms.map(r=>r.id+":"+r.lit+":"+r.size),["flat:true:4.0 \u00d7 3.0 m","hall:false:"]);
  m.rooms.forEach(r=>r.points.forEach(q=>assert.ok(q[0]>=0&&q[0]<=m.W&&q[1]>=0&&q[1]<=m.H,r.id+" is whole in the picture")));
  const other=K.planModel(PLAN,HALL,"TL",null,440);
  assert.deepEqual(other.rooms.map(r=>r.id+":"+r.lit),["flat:false","hall:true"],"pressing another room lights that room, in the same picture");
  assert.equal(other.scale,m.scale,"the place does not jump when another of its rooms is chosen");
  assert.ok(m.wall>=2.5&&m.wall<=7,"a wall is drawn at its thickness");
  assert.equal(m.doors.length,3,"a door is a gap; one far off the plan is left out"); assert.equal(m.windows.length,1);
  assert.equal(m.camera.n,1); assert.equal(m.camera.cone.length,3);
  assert.deepEqual(m.people.map(k=>k.id+k.css),["A#D08A2E","B#3E73B8"],"the demo's orange and blue");
  // a point of the picture goes back to metres (a stand-in that is dragged)
  const back=K.planMetres(m,m.people[0].at[0],m.people[0].at[1]);
  assert.ok(Math.abs(back[0]-st.A[0])<0.02&&Math.abs(back[1]-st.A[1])<0.02);
  // the hall has its own camera; a camera that is not this space's is not drawn; nobody placed, nobody drawn
  assert.equal(other.camera.n,1);
  assert.equal(K.planModel(PLAN,HALL,"BR",null,440).camera,null);
  assert.deepEqual(other.people,[]);
  // a place far bigger than the room (a hallway off a street): the picture comes in on the room until it is half of
  // it, and the street still shows around it, drawn first and named where it shows
  const street={spaces:[{id:"street",name:"Street",footprint:[[-15,-17],[15,-17],[15,0],[-15,0]]},{id:"hw",name:"Hallway",footprint:[[-0.9,0],[0.9,0],[0.9,5],[-0.9,5]]}],openings:[],cameras:[]};
  const ms=K.planModel(street,{id:"hw"},"TL",null,440), hw=ms.rooms.find(r=>r.id==="hw"), row=ms.rooms.find(r=>r.id==="street");
  assert.deepEqual(ms.rooms.map(r=>r.id+":"+r.lit),["street:false","hw:true"]);
  const ys=hw.points.map(q=>q[1]); assert.ok(Math.abs((Math.max(...ys)-Math.min(...ys))-0.5*380)<2,"the hallway is half the picture's height");
  assert.ok(row.at[0]>=40&&row.at[0]<=ms.W-40&&row.at[1]>=13&&row.at[1]<=ms.H-13);
  // the street itself chosen: all of it, the hallway drawn over it
  const whole=K.planModel(street,{id:"street"},"TL",null,440);
  assert.deepEqual(whole.rooms.map(r=>r.id+":"+r.lit),["street:true","hw:false"]);
  // a space that is not on the plan yet: the whole plan, nothing lit, and said so
  const gone=K.planModel(PLAN,{id:"kitchen",whole:false},"TL",null,440);
  assert.deepEqual(gone.rooms.map(r=>r.lit),[false,false]); assert.equal(gone.missing,true);
  assert.ok(face.includes('model.missing ? (space.name||"This space")+" is not on the floor plan yet, so it cannot be shown on it. Add it in Edit the floor plan, below."'));
  assert.ok(face.includes('model.rooms.filter(r=>r.lit).map(r=>LSC_E("polygon",{ key:"lit"+r.id, points:pts(r.points), className:"lsc-room-lit" })),'),"the chosen space is outlined over its walls");
  assert.equal(K.planModel({spaces:[]},FLAT,"TL",null,440),null); assert.equal(K.planModel(null,FLAT,"TL",null,440),null);
});

test("7 the looks and the pack: Colour, Clay, Depth, drawn by the viewer's own looks; the stand-ins stand in the view", ()=>{
  assert.deepEqual(K.LOOKS.map(x=>x.name),["Colour","Clay","Depth"]); assert.deepEqual(K.LOOKS.map(x=>x.look),["","clay","depth"]);
  assert.deepEqual(K.PACK.map(x=>x.name),["Colour","Clay","Depth"]); assert.deepEqual(K.PACK.map(x=>x.look),["","clay","depth"]);
  assert.deepEqual(K.PEOPLE.map(k=>[k.id,k.colour,k.height]),[["A",0xD08A2E,1.66],["B",0x3E73B8,1.72]]);
  // the viewer: surfaces on request, a look and a cast per drawing; the set itself is put back as it was
  // (the looks themselves are tested in test-previs-looks.mjs)
  assert.ok(previs.includes("async function viewer(scene,light,options){")&&previs.includes("const rig=build(T,scene,light||null,{look:options&&options.look,surfaces:options&&options.surfaces,renderer});"));
  assert.ok(previs.includes("render(canvas,pose,width,height,look,cast){"));
  assert.ok(previs.includes("rig.meshes.forEach(m=>{if(m.userData.own)return;swapped.push([m,m.material]);m.material=clay;});"),"clay: the set in white, what stands in it as it is");
  assert.ok(previs.includes("rig.three.overrideMaterial=depth;"));
  assert.ok(previs.includes("finally{rig.three.overrideMaterial=null;rig.three.background=sky;renderer.toneMappingExposure=exposure;"));
  assert.ok(previs.includes("renderer.shadowMap.needsUpdate=true;"),"a stand-in that moved casts its shadow again");
  assert.ok(previs.includes("renderer.render(rig.three,root.KinolotAnglePreview.cameraFor(T,pose));"),"the plain view is drawn as it always was");
  assert.ok(previs.includes("if(clay)clay.dispose();if(depth)depth.dispose();")&&previs.includes("actors.forEach(g=>root.KinolotSetSurfaces.disposeMannequin(g));"));
  // since 2026-11-24 every Colour drawing has painted surfaces; {surfaces:false} asks for flat colours
  assert.ok(previs.includes('const kit=root.KinolotSetSurfaces||null;let S=!look&&!(opts&&opts.surfaces===false)&&kit&&typeof kit.material==="function"&&kit||null;'));
});

/* the surfaces: which one a material gets, and where it is laid */
test("7b surfaces: each material gets the surface its own name says, laid at real size", ()=>{
  const box={console,document:{}}; box.window=box; vm.createContext(box); vm.runInContext(surf,box);
  const S=box.KinolotSetSurfaces, kind=(id,name)=>S.kindOf(id,name||"");
  const want={d_brick:"brick",d1_stock:"brick",d_slate:"slate",d_asphalt:"asphalt",d1_tarmac:"asphalt",d_slab:"slab",d_concrete:"concrete",d1_coping:"concrete",
    d_grass:"grass",d_privet2:"hedge",d_mud:"mud",d_lino:"tile",d2_lam:"planks",d_oak:"wood",furnitureWood:"wood",d_wicker:"wicker",d_carpet:"carpet",d2_mat:"carpet",
    d_net:"net",d_redsilk:"fabric",d2_shirt:"fabric",d_steel:"metal",d2_chrome:"metal",d_upvc:"gloss",d_gloss:"gloss",d2_rad:"gloss",d_darkdoor:"gloss",
    d_magnolia:"paint",d2_wall:"paint",d_ceiling:"paint",kitchenOat:"paint",d_paper:"paper",d_glass:"glass",d_lampglass:"lamp",d_joint:"plain",d_blue:"plain"};
  Object.keys(want).forEach(id=>assert.equal(kind(id),want[id],id));
  // the builder's plain materials are told apart by what wears them
  assert.equal(kind("floor","Hussain Flat floor"),"planks"); assert.equal(kind("wall","Hall wall"),"paint"); assert.equal(kind("dressing","Kettle"),"plain");
  // a surface is laid in metres: a floor by x and y, a wall by its run and its height
  const attr=(n,vals)=>({count:vals.length/n,getX:i=>vals[i*n],getY:i=>vals[i*n+1],getZ:i=>vals[i*n+2],set:[],setXY(i,u,v){ this.set[i]=[u,v]; }});
  const g={attributes:{position:attr(3,[0.5,0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,-0.5]),normal:attr(3,[0,0,1, 1,0,0, 0,1,0])}};
  g.attributes.uv=attr(2,[0,0,0,0,0,0]);
  S.layUV({BufferAttribute:function(){}},g,[4,2,3]);
  assert.deepEqual(JSON.parse(JSON.stringify(g.attributes.uv.set)),[[2,1],[-1,1.5],[2,-1.5]],"top face x,y; a wall facing east y,z; a wall facing north x,z");
  for(const fn of ["material","layUV","sky","mannequin","disposeMannequin","face"]) assert.equal(typeof S[fn],"function",fn);
  assert.ok(surf.includes("made=new T.MeshStandardMaterial({color:new T.Color(0.035,0.045,0.055),roughness:0.04,metalness:0,envMap:env||null,envMapIntensity:1.9,side:T.DoubleSide});"),"glass mirrors the sky");
  assert.ok(!/fetch\(|\.png|\.jpg|new Image\(/.test(surf),"painted in code: no image file, no call");
});

/* the face itself, run with a stand-in React */
const tree=(props,extra)=>{
  const noop=()=>{};
  const React={createElement:(type,p,...children)=>({type,props:p||{},children:children.flat(Infinity)}),Fragment:"Fragment",forwardRef:fn=>fn,
    useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v===undefined?null:v}),useEffect:noop};
  const box={React,console,...(extra||{})}; box.window=box; vm.createContext(box); vm.runInContext(data,box);
  vm.runInContext(transformSync(face,{presets:["@babel/preset-react"],plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false,filename:"location-set-card-ui.jsx"}).code,box);
  return {box,el:plain(box.LocationSetCard(props))};
};
const flat=n=>{ const out=[]; const walk=x=>{ if(!x||typeof x!=="object") return; out.push(x); (x.children||[]).forEach(walk); }; walk(n); return out; };
const text=n=>flat(n).map(x=>(x.children||[]).filter(c=>typeof c==="string"||typeof c==="number").join("")).join("|");

test("8 the card is laid out top to bottom as designed, then in sections that fold", ()=>{
  const {el}=tree({place:{id:"p",name:"House"},rooms:[{id:"r",name:"Kitchen"}],project:{},scenes:[]},
    {locationPanelPoses:()=>[{key:"TL",label:"Top-left",purpose:"whole room",pose:{position:[0,0,1.5],yaw:0,lensMm:18}}]});
  assert.equal(el.props.className,"lsc"); assert.equal(el.props["data-set-card"],"p");
  const order=flat(el).map(x=>x.props.className).filter(Boolean).map(c=>c.split(" ")[0]);
  const want=["lsc-stage","lsc-badge","lsc-camtag","lsc-body","lsc-head","lsc-name","lsc-chips","lsc-info","lsc-seg","lsc-folds"];
  let at=-1; want.forEach(c=>{ const i=order.indexOf(c,at+1); assert.ok(i>at,c+" comes after "+(want[want.indexOf(c)-1]||"the top")); at=i; });
  // the sections, in order, each a fold (the stand-in React does not open them: their names and state are props)
  const folds=flat(el).filter(x=>x.props&&x.props.testid&&String(x.props.testid).indexOf("set-card-fold-")===0);
  assert.deepEqual(folds.map(f=>[f.props.label,f.props.defaultOpen]),[["Location sheet",true],["Floor plan",true],["Reference pack",true]]);
  // what the space connects to is part of Location sheet, under the views (owner 2026-11-23: one section, not two)
  const sheetFold=folds[0], inSheet=flat(sheetFold).map(x=>x.props&&x.props["data-testid"]).filter(Boolean);
  assert.deepEqual(inSheet,["set-card-sheet","set-card-connects"]);
  assert.ok(text(sheetFold).includes("Connects to"));
  const t=text(el);
  assert.ok(t.includes("MASTER SET")&&t.includes("CAM 1 \u00b7 18 MM")&&t.includes("Whole room"));
  assert.ok(t.includes("Build reference pack for House, camera 1"));
  assert.deepEqual(flat(el).filter(x=>x.props.className==="lsc-chip").map(x=>[x.children.join(""),x.props["aria-pressed"]]),[["House","true"],["Kitchen","false"]]);
  assert.deepEqual(flat(el).find(x=>x.props.className==="lsc-seg").children.map(b=>b.children.join("")),["Colour","Clay","Depth"]);
  // a place with no rooms has no chips; with no floor plan the plan says so
  const alone=tree({place:{id:"p",name:"Cab"},rooms:[],project:{},scenes:[]}).el;
  assert.ok(!flat(alone).some(x=>x.props.className==="lsc-chips"));
  assert.ok(text(alone).includes("No floor plan yet."));
});

test("8b the card's own parts take their place in it: the name row, The place, the Floor plan section with its tools, the location image", ()=>{
  const slots={nameRow:{type:"div",props:{className:"sheet-head"},children:["NAME ROW"]},
    plan:{type:"CardFold",props:{label:"Floor plan",foldId:"loc-layout-p",count:"2 rooms to add",children:["PLAN TOOLS"]}},
    place:{type:"CardFold",props:{label:"The place",testid:"set-card-fold-place-slot"},children:["PLACE"]},
    image:{type:"div",props:{className:"loc-viewer"},children:["IMAGE"]}};
  const {el}=tree({place:{id:"p",name:"House"},rooms:[],project:{},scenes:[],slots,planReady:false});
  assert.ok(!flat(el).some(x=>x.props.className==="lsc-name"),"the card's own name row stands in for the plain name");
  assert.ok(text(el).includes("NAME ROW"));
  const folds=flat(el).filter(x=>x.props&&x.props.testid&&String(x.props.testid).indexOf("set-card-fold-")===0);
  // The place, the card's own section, comes right after the views and before the floor plan
  assert.deepEqual(folds.map(f=>f.props.label),["Location sheet","The place","Floor plan","Reference pack","Location image"]);
  const plan=folds[2]; assert.equal(plan.props.foldId,"loc-layout-p","links to Floor plan open this section"); assert.equal(plan.props.count,"2 rooms to add");
  const tools=flat(plan).find(x=>x.props&&x.props["data-testid"]==="set-card-plan-tools");
  assert.equal(tools.props.open,true,"open until the floor plan is confirmed"); assert.ok(text(tools).includes("Draft and confirm the floor plan"));
  const done=tree({place:{id:"p",name:"House"},rooms:[],project:{},scenes:[],slots,planReady:true}).el;
  const shut=flat(done).find(x=>x.props&&x.props["data-testid"]==="set-card-plan-tools");
  assert.equal(shut.props.open,undefined); assert.ok(text(shut).includes("Edit the floor plan"));
  const image=folds[4]; assert.equal(image.props.keep,true,"the location image stays on the page while its section is shut"); assert.equal(image.props.defaultOpen,false);
  // the section itself: the other cards' fold, by its classes; shut with keep, its inside is hidden, not removed
  assert.ok(face.includes('LSC_E("div",{ className:"sheet-fold lsc-fold "+(open?"open":""), ref, "data-testid":testid, "data-fold":label },'));
  assert.ok(face.includes('(open || keep) && LSC_E("div",{ className:"sheet-fold-body", hidden:!open }, children)'));
  assert.ok(face.includes('window.addEventListener("nb-open-fold", h);'));
});

test("8c the chips are the rooms: a chip changes the whole card when the card says which space it is", ()=>{
  const calls=[]; const props={place:{id:"p",name:"House"},rooms:[{id:"r",name:"Kitchen"}],space:"r",project:{},scenes:[]};
  const {el}=tree(props,{locationPanelPoses:l=>[{key:"TL",label:"Top-left",purpose:l.id==="r"?"the kitchen":"the house",pose:{position:[0,0,1.5],yaw:0,lensMm:18}}]});
  assert.deepEqual(flat(el).filter(x=>x.props.className==="lsc-chip").map(x=>[x.children.join(""),x.props["aria-pressed"]]),[["House","false"],["Kitchen","true"]]);
  assert.ok(text(el).includes("The kitchen")&&text(el).includes("Build reference pack for Kitchen, camera 1"));
  assert.ok(face.includes('const choose = id=>{ if(typeof onSpace==="function") onSpace(id); else setPick(p=>({ ...p, space:id, cam:0 })); };'));
  assert.ok(face.includes("const kept = lscKept[place.id] || (lscKept[place.id] = { look:\"colour\", moved:{} });"),"the look and the stand-ins are kept from one space's card to the next");
  // the workspace: the chosen space's own card is the one shown
  assert.ok(ui.includes("const shown=group.members.find(l=>l.id===view.chosen)||root;"));
  assert.ok(ui.includes('renderLocation(shown,{...common,initialSection:view.sections[shown.id]||"",faceGroup:{place:root,rooms,select:id=>select(id)}}));'));
  assert.ok(ui.includes("setView(v=>({...v,chosen:to.id,sections:{...v.sections,[to.id]:section}}));"),"a link to a room's section brings that room's card");
});

test("9 it draws from the place's own 3D set, with surfaces and the stand-ins, one view for the whole tab, only on screen, and saves nothing", ()=>{
  assert.ok(face.includes("const built = P.scene(space);")&&face.includes("const view = await P.viewer(built.scene, built.light, { surfaces:true });"));
  assert.ok(face.includes("if(lscLive && lscLive.key!==key) lscClose();")&&face.includes("lscLive.timer = setTimeout(lscClose, 30000);"),"one 3D view, closed after a rest");
  assert.ok(face.includes("const turn = lscLine.then(run, run);"),"one drawing at a time");
  assert.ok(face.includes('if(typeof stale==="function" && stale()) return null;'),"a drawing nobody waits for is skipped");
  assert.ok(face.includes('view.render(cv, pose, j.w, j.h, j.look||"", cast||[]);'));
  assert.ok(face.includes("if(!onScreen || !view) return undefined;")&&face.includes('new IntersectionObserver('));
  assert.ok(face.includes("K.PACK.map(p=>({ key:view.key, w:1280, h:720, look:p.look })), cast)"));
  assert.ok(face.includes("const at = K.keepInside(start.footprint, xy, people[id]);"),"a dragged stand-in stays in its room");
  for(const never of ["nbSetImage","nbStore","fetch(","localStorage","JSON.stringify(","onUpdate("]) assert.ok(!face.includes(never),"the face never uses "+never);
  // the one thing it starts: the dressing of a set that was never dressed, which Previs's own runner does and saves
  assert.ok(face.includes('if(drewIt && undressed && typeof window.previsAutoDress==="function") window.previsAutoDress(space.location, project, onUpdate, readOnly);'));
  assert.ok(face.includes("undressed && window.PrevisAutoLine && LSC_E(window.PrevisAutoLine,{ location:space.location, project, onUpdate, readOnly }),"));
  // a place whose floor plan is not confirmed says the one thing to do, in plain words
  assert.ok(face.includes('ready ? pics.error : "The set is built from the floor plan. Check the floor plan and confirm it first."'));
  assert.ok(face.includes('"Make the location image in Previs"')&&face.includes("onClick:go(4)"));
  // dragging: a finger or the mouse, or the arrow keys 10 cm at a time
  assert.ok(face.includes("ArrowLeft:[-0.1,0], ArrowRight:[0.1,0], ArrowUp:[0,0.1], ArrowDown:[0,-0.1]")&&face.includes("onPointerDown:down, onPointerMove:move, onPointerUp:up"));
});

test("10 the card shown for a place opens with the set card, which takes its name row, picture, The place and Floor plan", ()=>{
  assert.ok(ui.includes("const facedCardNow=!asSection&&!!faceGroup&&!!(window.LocationSetCard&&window.KinolotSetCard);"));
  assert.ok(ui.includes("const slot=(name,el)=>{ if(!setFace) return el; faceSlots[name]=el; return null; };"));
  assert.ok(ui.includes("setFace&&React.createElement(window.LocationSetCard,{place:facePlace,rooms:faceGroup.rooms,space:l.id,onSpace:faceGroup.select,project,scenes,readOnly,onUpdate,slots:faceSlots,"));
  assert.ok(ui.includes('slot("image",React.createElement("div",{className:"loc-viewer","data-testid":"location-viewer","data-mode":modeNow},'));
  assert.ok(ui.includes('slot("nameRow",React.createElement("div",{className:"sheet-head"},'));
  assert.ok(ui.includes('slot("place",React.createElement(CardFold,{label:"The place",foldId:locationStepFoldId(l,1),'));
  assert.ok(ui.includes('slot("plan",React.createElement(CardFold,{label:"Floor plan",foldId:layoutFoldId,defaultOpen:initialSection==="layout",'));
  // the card's own picture is the image alone on such a card, and the workspace's row of rooms is the set card's chips
  assert.ok(ui.includes('.concat(showPrevis&&!facedCard?[{id:"set",name:"3D set",')&&ui.includes('.concat(facedCard?[]:[{id:"plan",name:"Floor plan",'));
  assert.ok(ui.includes('rooms.length>0&&!(window.LocationSetCard&&window.KinolotSetCard)&&E("div",{className:"loc-workspace-nav","data-testid":"location-spaces"},'));
});

test("10b The set in 3D is Previs alone, with the render style beside the image engine; no Cameras, no Rooms, no dress button", ()=>{
  const step=read("app/set-previs-ui.jsx");
  // one section, no Cameras part: a camera is moved with Move a camera, and a link to Cameras opens this section
  assert.ok(ui.includes('setFace&&showPrevis&&React.createElement(CardFold,{label:"The set in 3D",foldId:locationStepFoldId(l,4),'));
  assert.ok(ui.includes('imageMeta:gen.genUrl?gen.genMeta:null,onSelectLocation,styleRow})),'));
  assert.ok(ui.includes('!setFace&&React.createElement(CardGroup,{label:"The set in 3D",foldIds:[locationStepFoldId(l,3),locationStepFoldId(l,4)],'),"the earlier layout keeps its own");
  assert.ok(ui.includes('const h=e=>{ if(e&&e.detail===from) window.dispatchEvent(new CustomEvent("nb-open-fold",{detail:to})); };'));
  // the render style: built once, placed in the card's body only without the set card
  assert.ok(ui.includes('const styleRow=React.createElement("div",{className:"char-style-row"},')&&ui.includes("!setFace&&styleRow,"));
  assert.ok(step.includes('styleRow&&E("div",{className:"previs-style","data-testid":"previs-style"},styleRow),'));
  assert.ok(step.indexOf('"data-testid":"previs-style"')<step.indexOf('"data-testid":"previs-engine"'),"above the image engine");
  assert.ok(step.includes("const own=E(LocationPrevisStep,{location:l,project,readOnly,onUpdate,hasImage,imageMeta,imageN,styleRow});"));
  // Rooms: the chips are the rooms; extra spaces whose images are kept stay
  assert.ok(ui.includes('!(setFace&&hasRooms)&&showSubspaces&&React.createElement(CardFold,{label:hasRooms?"Rooms":"Extra spaces",foldId:"loc-subspaces-"+l.id,'));
  assert.ok(ui.includes('setFace&&hasRooms&&shownExtras.length>0&&React.createElement(CardFold,{label:"Extra spaces",foldId:"loc-subspaces-"+l.id},'));
  // dressing: no button at all (owner 2026-11-23, options 1 and 2): it runs by itself, and adds nothing loose or invented
  assert.ok(step.includes("!l.previs&&E(PrevisAutoLine,{location:l,project,onUpdate,readOnly}),"));
  for(const gone of ['"Dress the set"','"Dress it again"','"Remove dressing"','"data-testid":"previs-dress"']) assert.ok(!step.includes(gone),gone+" is gone");
  const dressing=read("app/set-dressing.js");
  assert.ok(dressing.includes("NOTHING LOOSE AND NOTHING INVENTED: no furniture, ornaments, crockery, papers, books, screens, bags, clothes, cushions, rugs, pictures, plants or clutter of any kind."));
  assert.ok(dressing.includes("Redraw every one of them: an object left out stays a plain block, which reads as nothing."));
  assert.ok(!step.includes('"Go to Cameras"')&&!step.includes("in Cameras."),"Previs sends nobody to a Cameras section");
  assert.ok(step.includes('"The set in 3D, drawn in your browser from the floor plan and its four cameras. It is free and redraws at once. Check where everything stands, then make the location image from it."'));
  // the set card's own empty view offers the floor plan, and The set in 3D once the plan is confirmed
  assert.ok(face.includes('ready && LSC_E("button",{ type:"button", className:"char-draft-btn ghost", onClick:go(4) },"Open The set in 3D")')&&!face.includes('"Open Cameras"'));
});

test("11 the look is the app's own (its tokens and type), and the files are on the page in order", ()=>{
  const block=css.slice(css.indexOf("THE SET CARD (owner 2026-11-23)"));
  for(const t of [".lsc-stage{position:relative;aspect-ratio:16/9;",".lsc-body{padding:15px;display:flex;flex-direction:column;gap:15px}",
    ".lsc-name{margin:0;font:600 20px/1.25 var(--f-display);",".lsc-thumbs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}",
    ".lsc-room-lit{fill:none;stroke:var(--hs-amber,var(--pos));stroke-width:2;stroke-linejoin:miter;pointer-events:none}",".lsc-window{stroke:var(--hs-fall,#5DB0D8);stroke-linecap:butt}",
    ".lsc-person.can-move{cursor:grab;touch-action:none}",".lsc-fold .sheet-fold-body[hidden]{display:none !important}"])
    assert.ok(block.includes(t),t);
  assert.ok(!/#1B1A19|#252422|#F0B255|Inter\b/.test(block),"none of the demo's own colours or type");
  const i=s=>html.indexOf(s);
  assert.ok(i("app/set-surfaces.js?v=")>0&&i("app/set-surfaces.js?v=")<i("app/set-previs.js?v=")&&i("app/set-previs.js?v=")<i("app/location-set-card.js?v=")
    &&i("app/location-set-card.js?v=")<i("app/location-set-card-ui.jsx?v=")&&i("app/location-set-card-ui.jsx?v=")<i("app/locations-ui.jsx?v="));
  for(const f of ["app/set-surfaces.js","app/location-set-card.js","app/location-set-card-ui.jsx","app/set-previs.js","app/locations-ui.jsx","app/styles.css","app/ai.jsx","app/script.jsx"])
    assert.ok(["20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1"].some(k=>html.includes(f+"?v="+k+'"')),f+" has a fresh key");
});

test("12 Frances knows the set card, in plain words", ()=>{
  const at=ai.indexOf('name:"Location card: the set card on top (one card per set)"'); assert.ok(at>0);
  const fact=ai.slice(at,ai.indexOf("\n",at));
  for(const s of ["THE SET CARD is the top of every place's card","COLOUR, CLAY, DEPTH","THEN SECTIONS THAT FOLD","LOCATION SHEET","THE PLACE","FLOOR PLAN","Drag A or B","Connects to","REFERENCE PACK","LOCATION IMAGE",
    "pressing a chip turns the whole card into that space's","There is no Rooms section and no Cameras section","The render style is chosen there too","DRESSING RUNS BY ITSELF","It adds nothing loose and nothing invented",
    "nothing is saved and nothing is sent anywhere","a space too low to stand in, like the inside of a car, has none","every Colour drawing of a set is painted the same way, on the set card, on the Previs sheet and on a shot's drawing"]) assert.ok(fact.includes(s),s);
  assert.ok(!/credit|\bTURN\b|MUSE|Claude|Anthropic|three\.js|WebGL/i.test(fact));
});

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);
