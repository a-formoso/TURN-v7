/* THE FURNITURE KIT (owner 2026-11-23, the Previs look brief, step 4; plan agreed 2026-11-24, stop 1: chair, table,
   door, window, kitchen units, chosen by name).
   What must stay true:
     - a piece makes the whole object from its parts, in metres, inside the box it is given, the same every time;
     - a thing is one of the five only when its name plainly says so, and only when its box is that kind of box;
     - NOTHING IN THE SET'S DATA CHANGES: expand() returns what to draw and what not to draw, and touches nothing;
     - what the dressing drew on a thing stays (a hob, a letter plate, a pane, a framed window, a round table);
     - a chair's back is where the set's tall shapes are, a unit's doors face away from where its carcass is pushed;
     - only the drawing uses the kit: the checks that read the set never see it. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const src=read("app/set-kit.js"), previs=read("app/set-previs.js"), html=read("TURN.html"), ai=read("app/ai.jsx");
const box={};box.window=box;vm.createContext(box);vm.runInContext(src,box,{filename:"set-kit.js"});
const K=box.KinolotSetKit, plain=v=>JSON.parse(JSON.stringify(v));
let pass=0, fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n")[0]); } };
const near=(a,b,by=0.011)=>Math.abs(a-b)<=by;
const shape=(id,name,size,position,material,more)=>({id,name,kind:"box",size,position,rotation:[0,0,0],material,...(more||{})});
// a dressed chair standing at [x, y]: seat, four legs and a backrest on one side ("-y", "+y", "-x", "+x")
function chair(anchor,x,y,back){
  const at={"-y":[0,-0.2],"+y":[0,0.2],"-x":[-0.2,0],"+x":[0.2,0]}[back], along=back[1]==="y";
  const out=[shape(anchor+"-0","Chair · seat",[0.45,0.45,0.06],[x,y,0.43],"wood",{anchorId:anchor}),
    shape(anchor+"-1","Chair · backrest",along?[0.45,0.04,0.44]:[0.04,0.45,0.44],[x+at[0],y+at[1],0.68],"wood",{anchorId:anchor})];
  [[1,1],[1,-1],[-1,1],[-1,-1]].forEach((k,i)=>out.push(shape(anchor+"-leg"+i,"Chair · leg",[0.04,0.04,0.4],[x+k[0]*0.2,y+k[1]*0.2,0.2],"wood",{anchorId:anchor})));
  return out;
}
const topRail=(r,name)=>r.parts.filter(p=>p.name===name).sort((a,b)=>b.position[2]-a.position[2]).find(p=>near(p.size[2],0.07,0.001));

test("1 the five pieces: a whole object from its parts, inside its box, the same every time", ()=>{
  assert.deepEqual(Object.keys(K.PIECES).sort(),["chair","door","table","units","window"]);
  const made={chair:K.PIECES.chair(0.45,0.45,0.9),table:K.PIECES.table(1.2,0.75,0.74),door:K.PIECES.door(0.8,0.05,2),window:K.PIECES.window(1,0.1,1.4),units:K.PIECES.units(2,0.6,0.9)};
  assert.deepEqual(Object.fromEntries(Object.entries(made).map(([k,v])=>[k,v.length])),{chair:10,table:9,door:9,window:8,units:11},"a chair is ten parts, not a block");
  assert.equal(K.PIECES.door(0.8,0.05,2,{glazed:true}).length,8,"a glazed door: one pane in place of the two upper panels");
  assert.equal(K.PIECES.window(0.6,0.1,1).length,7,"a narrow window has no glazing bar");
  assert.equal(K.PIECES.units(1,0.6,0.9).length,7,"a door about every half metre");
  const boxes={chair:[0.45,0.45,0.9],table:[1.2,0.75,0.74],units:[2,0.6,0.9]};
  Object.keys(boxes).forEach(k=>made[k].forEach(p=>{
    assert.ok(Math.abs(p[2][0])+p[1][0]/2<=boxes[k][0]/2+0.001&&Math.abs(p[2][1])+p[1][1]/2<=boxes[k][1]/2+0.001,k+": no part reaches past its box");
    assert.ok(p[2][2]-p[1][2]/2>=-0.001&&p[2][2]+p[1][2]/2<=boxes[k][2]+0.03,k+": from the floor to its height");
  }));
  assert.ok(made.chair.every(p=>p[0]==="box"&&["main","second"].includes(p[3])));
  assert.deepEqual(plain(K.PIECES.chair(0.45,0.45,0.9)),plain(made.chair),"nothing random");
  assert.ok(near(K.PIECES.chair(0.45,0.45,0.9,{seat:0.46}).find(p=>near(p[1][0],0.45,0.001)&&near(p[1][2],0.03,0.001))[2][2],0.445),"the seat stays at the height the set gives it");
  assert.ok(made.units.some(p=>p[3]==="dark")&&made.units.some(p=>p[3]==="steel")&&made.units.at(-1)[3]==="second","a plinth, bar handles, a worktop");
  assert.ok(made.door.filter(p=>p[3]==="steel").length===4&&made.door.filter(p=>p[3]==="shade").length===4,"a lever and its plate on each face; panels a little darker than the leaf");
});

test("2 which piece a thing is: only what its name plainly says", ()=>{
  const is={"Small kitchen table":"table","Mismatched chair (west, window)":"chair","front door leaf":"door","bedroom door":"door","sash window":"window",
    "Galley run of units":"units","Kitchen base units":"units","Coffee table":"table","Dining chair":"chair","Fitted cupboards":"units","Front door (frosted panel)":"door","flats door":"door","Hussain front door (white uPVC, frosted panel)":"door"};
  Object.keys(is).forEach(n=>assert.equal(K.pieceOf(n),is[n],n));
  ["wall cabinets","Ellis windows","Table lamp","Fridge","Armchair","Office chair","Wheelchair","Chairs","Door frame","Doormat","Car door","Wardrobe door",
    "Window sill","Window box","Shop window","Tablecloth","Pool table","Kitchen wall units","Sofa","",null,
    "Radiator under window","door surround and lamp","boarded shop next door","hall window surround","Driver door","Rear left door","Kitchen table and chairs","Table with lamp","Chair, table"].forEach(n=>assert.equal(K.pieceOf(n),"",String(n)));
});

test("3 a box that is not that kind of thing is left alone", ()=>{
  const e=(w,d,h,base=0)=>({w,d,h,base});
  assert.ok(K.FITS.chair(e(0.45,0.45,0.9))&&!K.FITS.chair(e(1.6,0.5,0.9))&&!K.FITS.chair(e(0.45,0.45,0.3)));
  assert.ok(K.FITS.table(e(1.2,0.75,0.74))&&K.FITS.table(e(0.5,0.5,0.4))&&!K.FITS.table(e(1.2,0.75,4)));
  assert.ok(K.FITS.units(e(2,0.6,0.9))&&!K.FITS.units(e(2,0.6,0.9,1.4))&&!K.FITS.units(e(2,0.6,2.1)),"units stand on the floor");
  assert.ok(K.FITS.door(e(0.8,0.05,2))&&!K.FITS.door(e(0.8,0.6,2))&&!K.FITS.door(e(2.4,0.05,2)));
  assert.ok(K.FITS.window(e(1,0.02,1.4))&&!K.FITS.window(e(5,0.02,1.4)));
  const r=K.expand({materials:{},objects:[shape("a","Dining table",[1.2,0.75,4],[0,0,2],"wood",{anchorId:"t"})]});
  assert.equal(r.parts.length,0); assert.equal(r.hide.size,0);
});

test("4 the box a thing's shapes fill: turned as the thing is turned", ()=>{
  const quarter=Math.PI/2;
  const items=[{...shape("a","T · 1",[1.2,0.75,0.03],[2,1,0.73],"w"),rotation:[0,0,quarter]},{...shape("b","T · 2",[0.04,0.04,0.72],[2.3,1.5,0.36],"w"),rotation:[0,0,quarter]}];
  const e=K.envelope(items,false);
  assert.ok(near(e.w,1.2)&&near(e.d,0.75)&&near(e.h,0.745)&&near(e.base,0)&&near(e.turn,quarter,0.001)&&near(e.centre[0],2)&&near(e.centre[1],1));
  const leaf=K.envelope([shape("l","Door · 1",[0.05,0.8,2],[1,3,1],"d"),shape("f","Door · 2",[0.1,0.05,2.05],[1,3.43,1.02],"g")],true);
  assert.ok(near(leaf.w,0.8)&&near(leaf.d,0.05)&&near(leaf.turn,quarter,0.001)&&near(leaf.h,2),"a door is its leaf, its width its long side");
});

test("5 expand: what to draw and what not to draw; the set itself is not touched", ()=>{
  const scene={materials:{wood:{baseColor:[0.4,0.3,0.2],roughness:0.7}},objects:[
    shape("floor-0","Kitchen table floor",[4,4,0.1],[2,2,-0.05],"wood"),shape("wall-0","Chair wall",[4,0.1,2.4],[2,4,1.2],"wood"),
    shape("fig-ana-torso","ANA chair",[0.4,0.3,0.6],[1,1,1],"wood"),shape("prop-1","Table (prop stand-in)",[0.6,0.6,0.5],[3,3,0.25],"wood"),
    shape("opening-0","Front door",[0.8,0.05,2],[0,2,1],"wood"),
    shape("anchor-1-furniture-0","Kitchen table · tabletop",[1.2,0.75,0.03],[2,1,0.73],"wood",{anchorId:"table"}),
    shape("anchor-1-furniture-1","Kitchen table · leg",[0.04,0.04,0.72],[1.5,0.7,0.36],"wood",{anchorId:"table"}),
    ...chair("c1",2,0.2,"-y"),
    shape("extra-1","bedroom door · 1",[0.8,0.05,2],[0,3.5,1],"gloss"),
    shape("extra-2","bedroom door · 1",[0.8,0.05,2],[3,3.5,1],"gloss"),
    shape("extra-3","Fridge · 1",[0.6,0.6,1.7],[3.5,0.4,0.85],"white")]};
  const before=JSON.stringify(scene), r=K.expand(scene);
  assert.equal(JSON.stringify(scene),before,"the set's data is exactly as it was");
  assert.deepEqual(plain(r.pieces.map(p=>[p.name,p.piece,p.parts])),[["Kitchen table","table",9],["Chair","chair",10],["bedroom door","door",9],["bedroom door","door",9]],"two doors of one name are two doors");
  assert.deepEqual([...r.hide].sort(),["anchor-1-furniture-0","anchor-1-furniture-1","c1-0","c1-1","c1-leg0","c1-leg1","c1-leg2","c1-leg3","extra-1","extra-2"].sort(),"never the room, a person, a prop or a thing the kit does not know");
  assert.equal(r.parts.length,37); assert.ok(r.parts.every((p,i)=>p.id==="kit-"+i&&p.kind==="box"&&p.size.length===3&&p.position.every(Number.isFinite)));
  assert.ok(r.parts.filter(p=>p.kit==="table").every(p=>p.material==="wood"),"a thing keeps its own colour");
  assert.ok(r.materials.kit_steel&&r.materials.gloss_kitshade===undefined,"a colour the set does not hold is not guessed");
  assert.deepEqual(plain(K.expand(scene)),plain({...r,hide:{}}),"the same every time");
  assert.deepEqual(plain(K.expand(null).parts),[]); assert.deepEqual(plain(K.expand({objects:[{id:"x"}]}).parts),[]);
});

test("6 what the dressing drew on a thing stays", ()=>{
  const units=[shape("u1","Galley run of units · 1",[0.56,2,0.86],[3.42,1.9,0.43],"cream",{anchorId:"u"}),shape("u2","Galley run of units · 2",[0.6,2,0.04],[3.4,1.9,0.88],"oak",{anchorId:"u"}),
    shape("u3","Galley run of units · 3",[0.01,0.01,0.7],[3.13,1.4,0.45],"brown",{anchorId:"u"}),shape("u7","Galley run of units · 7",[0.4,0.5,0.01],[3.4,2.2,0.9],"steel",{anchorId:"u"})];
  let r=K.expand({materials:{},objects:units});
  assert.deepEqual([...r.hide].sort(),["u1","u2","u3"],"the hob set in the worktop is still drawn");
  assert.equal(r.pieces[0].kept,1); assert.equal(r.parts.at(-1).material,"oak","the worktop keeps its own colour");
  assert.ok(near(r.parts.at(-1).position[2],0.88)&&near(r.parts.at(-1).size[2],0.04,0.001),"and its own height: the hob still lies on it");
  const door=[shape("extra-39","front door leaf · 1",[0.8,0.05,2],[0,0,1],"dark"),shape("extra-40","front door leaf · 2",[0.3,0.07,0.5],[0,0,1.5],"net"),
    shape("extra-41","front door leaf · 3",[0.05,0.1,2.05],[-0.43,0,1.02],"gloss"),shape("extra-44","front door leaf · 6",[0.2,0.02,0.04],[0,0.04,1],"steel")];
  r=K.expand({materials:{dark:{baseColor:[0.1,0.2,0.2],roughness:0.5}},objects:door});
  assert.deepEqual([...r.hide],["extra-39"],"only the leaf is redrawn: its pane, frame and letter plate stay");
  assert.equal(r.parts.length,7,"no panel over the pane; the lower panels and a lever each side are added");
  assert.ok(r.parts.filter(p=>p.material==="dark_kitshade").every(p=>p.position[2]<1)&&near(r.materials.dark_kitshade.baseColor[1],0.16,0.001),"panels in the leaf's own colour, a little darker");
  r=K.expand({materials:{},objects:[...door.slice(0,1),shape("extra-45","front door leaf · 2",[0.1,0.04,0.03],[0.3,-0.04,1],"steel")]});
  assert.equal(r.parts.filter(p=>p.material==="kit_steel").length,0,"a door that has its handle gets no second one");
  const win=n=>Array.from({length:n},(_,i)=>shape("extra-"+(50+i),"sash window · "+(i+1),i?[1.1,0.1,0.05]:[1,0.02,1.4],[2,0,i?0.8+i*0.2:1.5],i?"gloss":"glass"));
  assert.equal(K.expand({materials:{},objects:win(8)}).parts.length,0,"a window the dressing has framed is left as it is");
  r=K.expand({materials:{},objects:win(1)}); assert.equal(r.pieces[0].piece,"window"); assert.equal(r.parts.length,8,"a bare pane gets its frame, rail, bar, glass and sill");
  const round={...shape("r0","Dining table · top",[1.1,1.1,0.04],[1,1,0.72],"wood",{anchorId:"r"}),kind:"cylinder"};
  assert.equal(K.expand({materials:{},objects:[round,shape("r1","Dining table · foot",[0.1,0.1,0.7],[1,1,0.35],"wood",{anchorId:"r"})]}).parts.length,0,"a round table is not squared");
  const fallen=chair("f",1,1,"-y").map((o,i)=>i?o:{...o,rotation:[1.57,0,0]});
  assert.equal(K.expand({materials:{},objects:fallen}).parts.length,0,"something lying on its side is left as it is");
});

test("7 which way a thing faces: read from the set's own shapes", ()=>{
  [["-y",0,-1],["+y",0,1],["-x",-1,0],["+x",1,0]].forEach(([back,x,y])=>{
    const r=K.expand({materials:{},objects:chair("c",2,2,back)}), rail=topRail(r,"Chair");
    assert.equal(r.pieces[0].parts,10);
    assert.ok((rail.position[0]-2)*x+(rail.position[1]-2)*y>0.15,"the back is on the "+back+" side, as the set has it");
    assert.ok(near(r.parts.find(p=>near(p.size[2],0.03,0.001)&&p.size[0]>0.4).position[2],0.445),"its seat at the set's own height");
  });
  // a chair that is one plain block faces the nearest table
  const block=(x,y)=>({materials:{},objects:[shape("b","Dining chair",[0.45,0.45,0.9],[x,y,0.45],"wood",{anchorId:"b"}),shape("t","Dining table",[1.2,0.8,0.74],[2,2,0.37],"wood",{anchorId:"t"})]});
  [[1,2,-1,0],[3,2,1,0],[2,1.1,0,-1],[2,2.9,0,1]].forEach(([x,y,bx,by])=>{
    const rail=topRail(K.expand(block(x,y)),"Dining chair");
    assert.ok((rail.position[0]-x)*bx+(rail.position[1]-y)*by>0.15,"its back is away from the table");
  });
  // kitchen units: the doors are on the side the carcass is NOT pushed to
  const run=side=>K.expand({materials:{},objects:[shape("u1","Kitchen units · 1",[2,0.56,0.86],[1,1+side*0.02,0.43],"cream",{anchorId:"u"}),shape("u2","Kitchen units · 2",[2,0.6,0.04],[1,1,0.88],"oak",{anchorId:"u"})]});
  [1,-1].forEach(side=>{ const doors=run(side).parts.filter(p=>near(p.size[1],0.018,0.001)); assert.equal(doors.length,4); assert.ok(doors.every(p=>(p.position[1]-1)*side<-0.2),"doors on the open side"); });
});

test("8 only the drawing uses the kit; the checks never see it", ()=>{
  const at=s=>html.indexOf(s);
  assert.ok(at("app/set-kit.js?v=")>0&&at("app/set-kit.js?v=")<at("app/set-previs.js?v="),"loaded before the drawing that uses it");
  assert.ok(["20261124-kit1"].some(k=>html.includes('app/set-kit.js?v='+k+'"')),"its cache key");
  assert.ok(/fitted=root\.KinolotSetKit\?root\.KinolotSetKit\.expand\(scene\):null/.test(previs)&&/scene=\{\.\.\.scene,objects:scene\.objects\.filter\(o=>!fitted\.hide\.has\(o\.id\)\)\.concat\(fitted\.parts\)/.test(previs),"build() draws a copy; the scene it was given is not changed");
  assert.ok(/catch\(_\)\{fitted=null;\}/.test(previs),"a fault in the kit leaves the set as it was drawn before");
  ["app/shot-previs.js","app/set-dressing.js","app/scene-plan.js","app/camera-angle-preview.js","app/location-set-card.js","app/shot-previs-ui.jsx","app/set-previs-ui.jsx"].forEach(f=>assert.ok(!/KinolotSetKit/.test(read(f)),f+" does not know the kit"));
  assert.ok(!/Math\.random|Date\.now/.test(src),"nothing random in these five");
  const fact=ai.split("\n").filter(l=>l.startsWith("APP_FEATURES.push")&&/FURNITURE IN FULL/.test(l));
  assert.equal(fact.length,2,"the help assistant knows, on the location card and on a shot's Previs");
  fact.forEach(l=>{ assert.ok(/chair/.test(l)&&/kitchen units/.test(l)&&/stays/.test(l)); });
  assert.ok(!/claude|anthropic|openai|gemini|three\.?js|\bTURN\b|\bMUSE\b|credit/i.test(fact.map(l=>l.slice(l.indexOf("FURNITURE IN FULL"),l.indexOf("FURNITURE IN FULL")+900)).join(" ")),"no vendor, codename or billing word in it");
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
