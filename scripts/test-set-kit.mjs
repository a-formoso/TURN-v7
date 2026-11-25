/* THE FURNITURE KIT (owner 2026-11-23, the Previs look brief, step 4; plan agreed 2026-11-24, stop 1: chair, table,
   door, window, kitchen units, chosen by name; stop 2: sofa, bed, shelves with books, cooker, fridge, skirting,
   radiator, lamp, rug, curtains).
   What must stay true:
     - a piece makes the whole object from its parts, in metres, inside the box it is given, the same every time;
     - a thing is one of the five only when its name plainly says so, and only when its box is that kind of box;
     - NOTHING IN THE SET'S DATA CHANGES: expand() returns what to draw and what not to draw, and touches nothing;
     - what the dressing drew on a thing stays (a hob, a letter plate, a pane, a framed window, a round table);
     - a chair's back is where the set's tall shapes are, a unit's doors face away from where its carcass is pushed;
     - a thing with nothing to show its front has its back to the wall it stands against;
     - the books of a bookcase come from a seeded generator: the same books on every draw and every device;
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

test("1 the first five pieces: a whole object from its parts, inside its box, the same every time", ()=>{
  assert.deepEqual(Object.keys(K.PIECES).sort(),["bed","chair","cooker","curtains","door","fridge","lamp","radiator","rug","shelves","skirting","sofa","table","units","window"]);
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
    "Galley run of units":"units","Kitchen base units":"units","Coffee table":"table","Dining chair":"chair","Fitted cupboards":"units","Bedside table":"table",
    "Fridge":"fridge","Fridge freezer":"fridge","Hall radiator":"radiator","Radiator under window":"radiator","Low Qur'an bookshelves":"shelves","Bookcase":"shelves",
    "hall runner":"rug","Persian rug":"rug","pendant with paper shade":"lamp","kitchen pendant":"lamp","Table lamp":"lamp","Bedside lamp":"lamp","Floor lamp":"lamp",
    "skirting kitchen north":"skirting","Double bed":"bed","Sofa bed":"sofa","Three-seat sofa":"sofa","Gas cooker":"cooker","Curtains (closed)":"curtains","Chair by the window":"chair","Front door (frosted panel)":"door","flats door":"door","Hussain front door (white uPVC, frosted panel)":"door"};
  Object.keys(is).forEach(n=>assert.equal(K.pieceOf(n),is[n],n));
  ["wall cabinets","Ellis windows","Armchair","Office chair","Wheelchair","Chairs","Door frame","Doormat","Car door","Wardrobe door",
    "Window sill","Window box","Shop window","Tablecloth","Pool table","Kitchen wall units","Wardrobe","",null,
    "door surround and lamp","boarded shop next door","hall window surround","Driver door","Rear left door","Kitchen table and chairs","Table with lamp","Chair, table",
    "Dome lamp","Street lamp near west","sodium street lamp","streetlamp","strip lights","Lamp post","Doormat","lobby door mat","hall carpet","Table runner","Stair runner",
    "Narrow shelf above radiator","Open shelf of mismatched mugs","Wooden multi-tier shoe rack","Three-seat rear bench, charcoal cloth","Net curtains","Shower curtain","Curtain pole",
    "Sofa cushions","Bed frame","Bunk bed","Flower bed","Oven gloves","Microwave oven","Fridge magnets","Radiator shelf","Coat pegs with heaped coats"].forEach(n=>assert.equal(K.pieceOf(n),"",String(n)));
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
    shape("extra-3","Wardrobe · 1",[0.6,0.6,1.7],[3.5,0.4,0.85],"white")]};
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
  assert.ok(["20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1"].some(k=>html.includes('app/set-kit.js?v='+k+'"')),"its cache key");
  assert.ok(/fitted=root\.KinolotSetKit\?root\.KinolotSetKit\.expand\(scene,\(opts&&opts\.kit\)\|\|\(light&&light\.kit\)\|\|null\):null/.test(previs)&&/scene=\{\.\.\.scene,objects:scene\.objects\.filter\(o=>!fitted\.hide\.has\(o\.id\)\)\.concat\(fitted\.parts\)/.test(previs),"build() draws a copy; the scene it was given is not changed");
  assert.ok(/catch\(_\)\{fitted=null;\}/.test(previs),"a fault in the kit leaves the set as it was drawn before");
  ["app/shot-previs.js","app/scene-plan.js","app/camera-angle-preview.js","app/location-set-card.js","app/shot-previs-ui.jsx","app/set-previs-ui.jsx"].forEach(f=>assert.ok(!/KinolotSetKit/.test(read(f)),f+" does not know the kit"));
  assert.ok(!/Math\.random|Date\.now/.test(src),"nothing left to chance: the one thing that varies is seeded");
  const fact=ai.split("\n").filter(l=>l.startsWith("APP_FEATURES.push")&&/FURNITURE IN FULL/.test(l));
  assert.equal(fact.length,2,"the help assistant knows, on the location card and on a shot's Previs");
  fact.forEach(l=>{ assert.ok(/chair/.test(l)&&/kitchen units/.test(l)&&/stays/.test(l)); assert.ok(["sofa","bed","bookcase","cooker","fridge","radiator","lamp","rug","curtains","skirting"].every(w=>l.slice(l.indexOf("FURNITURE IN FULL")).includes(w)),"the ten of stop 2 are named"); assert.ok(/WHEN A SET IS DRESSED, the dressing names such a thing as the piece it is/.test(l),"stop 3"); });
  assert.ok(!/claude|anthropic|openai|gemini|three\.?js|\bTURN\b|\bMUSE\b|credit/i.test(fact.map(l=>l.slice(l.indexOf("FURNITURE IN FULL"),l.indexOf("FURNITURE IN FULL")+2200)).join(" ")),"no vendor, codename or billing word in it");
});

test("9 the ten pieces of stop 2: each a whole object, the same every time", ()=>{
  const n=(k,...a)=>K.PIECES[k](...a).length;
  assert.equal(n("sofa",2,0.9,0.85),12,"feet, base, two arms, back, and a seat and a back cushion for each of two places");
  assert.equal(n("sofa",3,0.95,0.85),16,"a longer sofa seats more"); assert.equal(n("sofa",1.2,0.9,0.85),10);
  assert.equal(n("bed",1.4,1.9,1),11,"a double bed with a headboard and two pillows"); assert.equal(n("bed",0.9,1.9,0.5),9,"a low single bed has no headboard and one pillow");
  assert.equal(n("cooker",0.6,0.6,0.9),16); assert.equal(n("fridge",0.6,0.63,1.7),7,"two doors, a seam, two handles"); assert.equal(n("fridge",0.6,0.6,0.85),4,"an under-counter fridge has one door");
  assert.equal(n("skirting",2,0.02,0.1),2); assert.equal(n("radiator",1,0.08,0.5,{base:0.3}),24,"a fin every five centimetres, a grille, a valve and its pipe");
  assert.equal(n("radiator",1,0.08,0.5),23,"no pipe for a radiator that stands on the floor"); assert.equal(n("radiator",3,0.08,0.5),35,"never more than 32 fins");
  ["pendant","floor","table"].forEach(type=>assert.equal(n("lamp",0.3,0.3,type==="floor"?1.6:0.45,{type}),6,type));
  assert.equal(n("rug",1.5,2.2,0.012),7); assert.equal(n("curtains",1.4,0.1,2.2),11); assert.equal(n("curtains",1.4,0.1,2.2,{closed:true}),21,"drawn across, the folds meet in the middle");
  ["sofa","bed","cooker","fridge","radiator","rug","curtains"].forEach(k=>assert.deepEqual(plain(K.PIECES[k](1.4,0.7,0.9)),plain(K.PIECES[k](1.4,0.7,0.9)),k));
  // a fridge keeps the door line and the handle side it is given
  const f=K.PIECES.fridge(0.6,0.63,1.7,{seam:1.15,hand:-1});
  assert.ok(near(f.find(p=>p[3]==="dark"&&near(p[1][2],0.012,0.001))[2][2],1.15)&&f.filter(p=>p[3]==="steel").every(p=>p[2][0]<0));
  // the fringe of a rug is at its two short ends
  assert.ok(K.PIECES.rug(1.5,2.2,0.012).filter(p=>p[3]==="linen").every(p=>Math.abs(p[2][1])>1.1)&&K.PIECES.rug(2.2,1.5,0.012).filter(p=>p[3]==="linen").every(p=>Math.abs(p[2][0])>1.1));
  // a part that lies down carries all three turns: the cooker's handle bar, the curtain pole
  assert.ok(Array.isArray(K.PIECES.cooker(0.6,0.6,0.9).find(p=>p[0]==="cylinder"&&p[1][2]>0.3)[4])&&Array.isArray(K.PIECES.curtains(1.4,0.1,2.2)[0][4]));
});

test("10 the books of a bookcase: seeded, inside their shelves, the same on every draw", ()=>{
  const a=K.PIECES.shelves(1,0.3,1.9,{books:true,seed:"Bookcase@35,48"}), b=K.PIECES.shelves(1,0.3,1.9,{books:true,seed:"Bookcase@35,48"}), c=K.PIECES.shelves(1,0.3,1.9,{books:true,seed:"Bookcase@10,10"});
  assert.deepEqual(plain(a),plain(b),"the same bookcase has the same books every time");
  assert.notDeepEqual(plain(a),plain(c),"another bookcase has its own");
  const bare=K.PIECES.shelves(1,0.3,1.9,{}), books=a.filter(p=>/^book\d$/.test(p[3])), boards=bare.filter(p=>near(p[1][2],0.022,0.001)).map(p=>p[2][2]).sort((x,y)=>x-y);
  assert.equal(bare.length,10,"two sides, a top, a kick board, a back and five shelves"); assert.ok(!bare.some(p=>/^book/.test(p[3])),"shelves that are not a bookcase get no books");
  assert.ok(books.length>=25&&books.length<=80,"enough to read as books, few enough to draw: "+books.length);
  books.forEach(p=>{
    assert.ok(Math.abs(p[2][0])+p[1][0]/2<=0.5-0.022,"between the two sides");
    const under=boards.filter(z=>z<p[2][2]).pop(), over=boards.find(z=>z>p[2][2]);
    assert.ok(near(p[2][2]-p[1][2]/2,under+0.011,0.002)&&p[2][2]+p[1][2]/2<over-0.011,"standing on a shelf, under the next one");
    assert.ok(p[2][1]+p[1][1]/2<=0.15&&p[2][1]-p[1][1]/2>=-0.15,"inside the case");
  });
  assert.ok(new Set(books.map(p=>p[3])).size>=4,"spines of several colours"); assert.ok(K.PIECES.shelves(3.4,0.35,2.4,{books:true,seed:"x"}).length<=110,"a wall of books is drawn in wider blocks, not thousands of shapes");
  const next=K.seeded("a"), again=K.seeded("a"), seq=Array.from({length:50},()=>next());
  assert.deepEqual(seq,Array.from({length:50},()=>again())); assert.ok(seq.every(v=>v>=0&&v<1)&&new Set(seq).size>45);
});

test("11 plain blocks against the walls of a room: each piece found, and its back to its wall", ()=>{
  const B=(id,name,size,position,material)=>shape(id,name,size,position,material,{anchorId:id});
  const scene={materials:{blue:{baseColor:[0.1,0.2,0.3],roughness:0.9}},objects:[
    shape("floor-0","Room floor",[6,5,0.1],[3,2.5,-0.05],"floor"),shape("wall-0","Room wall",[6,0.15,2.5],[3,5.075,1.25],"wall"),
    shape("wall-1","Room wall",[0.15,5,2.5],[-0.075,2.5,1.25],"wall"),shape("wall-2","Room wall",[0.15,5,2.5],[6.075,2.5,1.25],"wall"),
    B("sofa","Three-seat sofa",[2,0.9,0.85],[1.7,4.5,0.425],"blue"),B("book","Bookcase",[1,0.3,1.9],[3.5,4.85,0.95],"wood"),B("curt","Curtains",[1.6,0.1,2.2],[5,4.93,1.1],"green"),
    B("fl","Floor lamp",[0.35,0.35,1.6],[0.4,4.5,0.8],"cream"),B("bed","Double bed",[1.9,1.4,0.55],[1.05,1.6,0.275],"blue"),B("bt","Bedside table",[0.45,0.4,0.5],[0.3,2.65,0.25],"wood"),
    B("tl","Table lamp",[0.25,0.25,0.4],[0.3,2.65,0.7],"cream"),B("pl","Ceiling light",[0.3,0.3,0.5],[3,2.5,2.25],"cream"),B("rug","Persian rug",[1.6,2.3,0.012],[3.4,2.6,0.006],"red"),
    B("cook","Gas cooker",[0.6,0.6,0.9],[5.7,1.6,0.45],"white"),B("fr","Fridge",[0.6,0.65,1.75],[5.675,2.5,0.875],"white"),B("rad","Radiator",[0.06,1,0.6],[5.95,3.8,0.45],"white"),
    B("sk","Skirting",[6,0.02,0.12],[3,4.99,0.06],"white")]};
  const kept=JSON.stringify(scene), r=K.expand(scene), of=name=>r.parts.filter(p=>p.name===name);
  assert.equal(JSON.stringify(scene),kept);
  assert.deepEqual(plain(r.pieces.map(p=>[p.name,p.piece])),[["Three-seat sofa","sofa"],["Bookcase","shelves"],["Curtains","curtains"],["Floor lamp","lamp"],["Double bed","bed"],["Bedside table","table"],
    ["Table lamp","lamp"],["Ceiling light","lamp"],["Persian rug","rug"],["Gas cooker","cooker"],["Fridge","fridge"],["Radiator","radiator"],["Skirting","skirting"]]);
  assert.equal(r.hide.size,13);
  // the sofa's back is at the north wall, its seats towards the room
  assert.ok(of("Three-seat sofa").filter(p=>p.kind==="cushion").every(p=>p.position[1]<4.75)&&of("Three-seat sofa").find(p=>near(p.size[0],1.64,0.01)&&p.size[2]>0.7).position[1]>4.75);
  // the books show to the room
  assert.ok(of("Bookcase").filter(p=>/^kit_book/.test(p.material)).length>20&&of("Bookcase").find(p=>near(p.size[1],0.008,0.001)).position[1]>4.95,"the bookcase's back board is at the wall");
  // the bed lies along its length, its pillows at the west wall
  const pillows=of("Double bed").filter(p=>p.kind==="cushion"&&near(p.size[1],0.42,0.001));
  assert.equal(pillows.length,2); assert.ok(pillows.every(p=>p.position[0]<0.6),"its head to the wall"); assert.ok(of("Double bed").some(p=>p.material==="blue")&&r.materials.blue_kitshade,"its cover in the block's colour, its frame a little darker");
  // the cooker, the fridge and the radiator face west, into the room
  assert.ok(of("Gas cooker").find(p=>p.kind==="cylinder"&&p.size[2]>0.3).position[0]<5.45,"the oven's handle"); assert.ok(of("Fridge").filter(p=>p.material==="kit_steel").every(p=>p.position[0]<5.4),"the fridge's handles");
  assert.ok(of("Radiator").filter(p=>near(p.size[2],0.57,0.001)).every(p=>p.position[0]<5.95)&&of("Radiator").length===24,"the radiator's fins; its pipe goes down to the floor");
  // three lamps: on the floor, on the table, from the ceiling
  assert.ok(of("Floor lamp").some(p=>near(p.size[0],0.26,0.001))&&!of("Table lamp").some(p=>near(p.size[0],0.26,0.001))&&of("Ceiling light").some(p=>near(p.size[0],0.09,0.001)),"a base plate, none, a ceiling rose");
  assert.ok(of("Table lamp").every(p=>p.position[2]>=0.5),"the table lamp still stands on its table");
});

test("12 stop 2: what the dressing drew stays, and its own signs say which way a thing faces", ()=>{
  const A=(id,name,size,position,material,more)=>shape(id,name,size,position,material,{anchorId:name.split(" · ")[0],...(more||{})});
  // the flat's fridge: a body, the line between its doors, a handle on one side, and a box standing on top
  let r=K.expand({materials:{},objects:[A("f1","Fridge · 1",[0.63,0.6,1.7],[3.38,3.25,0.85],"gloss"),A("f2","Fridge · 2",[0.01,0.58,0.01],[3.06,3.25,1.15],"steel"),
    A("f3","Fridge · 3",[0.03,0.03,0.3],[3.05,3.01,1.35],"steel"),A("f4","Fridge · 4",[0.3,0.2,0.15],[3.4,3.25,1.775],"card")]});
  assert.deepEqual([...r.hide].sort(),["f1","f2","f3"],"the box on top of it stays"); assert.equal(r.pieces[0].kept,1);
  assert.ok(near(r.parts.find(p=>p.material==="kit_dark"&&near(p.size[2],0.012,0.001)).position[2],1.15),"the line between its doors where the dressing drew it");
  assert.ok(r.parts.filter(p=>p.material==="kit_steel").every(p=>p.position[0]<3.1&&p.position[1]<3.25),"its handles on the dressing's side, on its front");
  // a radiator the dressing drew: its fins say which side is the room
  r=K.expand({materials:{},objects:[A("r1","Hall radiator · 1",[0.05,1,0.5],[-0.84,2.2,0.58],"rad"),A("r2","Hall radiator · 2",[0.02,0.02,0.46],[-0.81,2.6,0.58],"rad"),A("r3","Hall radiator · 3",[0.02,0.02,0.46],[-0.81,1.8,0.58],"rad")]});
  assert.equal(r.pieces[0].piece,"radiator"); assert.ok(r.parts.filter(p=>near(p.size[2],0.47,0.001)).every(p=>p.position[0]>-0.835),"fins on the side the dressing had them");
  // left alone: a bookcase, a lamp or curtains the dressing has already built; a skirting of several shapes
  const many=(name,n,size)=>Array.from({length:n},(_,i)=>A(name+i,name+" · "+(i+1),size,[1,1+i*0.01,1],"m"));
  assert.equal(K.expand({materials:{},objects:many("Bookcase",4,[1,0.3,1.9])}).parts.length,0); assert.equal(K.expand({materials:{},objects:many("Floor lamp",5,[0.3,0.3,1.5])}).parts.length,0);
  assert.equal(K.expand({materials:{},objects:many("Curtains",7,[1.4,0.1,2.2])}).parts.length,0); assert.equal(K.expand({materials:{},objects:many("Skirting",2,[2,0.02,0.1])}).parts.length,0);
  assert.equal(K.expand({materials:{},objects:[{...A("c1","Curtains",[1.4,0.1,2.2],[1,1,1.1],"m"),kind:"cloth"}]}).parts.length,0,"a curtain already hung as cloth");
  // a rug: only the rug is redrawn; a sofa: a loose cushion in another colour stays; a cooker: the pan on it stays
  r=K.expand({materials:{},objects:[shape("extra-1","hall runner · 1",[0.6,2.4,0.01],[0,3,0.15],"carpet"),shape("extra-2","hall runner · 2",[0.06,0.8,0.02],[0.3,1.2,0.16],"steel")]});
  assert.deepEqual([...r.hide],["extra-1"]); assert.equal(r.parts.length,7);
  r=K.expand({materials:{},objects:[A("s1","Sofa · 1",[2,0.9,0.45],[2,2,0.225],"blue"),A("s2","Sofa · 2",[2,0.2,0.85],[2,1.65,0.425],"blue"),{...A("s3","Sofa · 3",[0.4,0.15,0.4],[1.4,1.85,0.65],"mustard"),kind:"cushion"}]});
  assert.deepEqual([...r.hide].sort(),["s1","s2"]); assert.ok(r.parts.filter(p=>p.kind==="cushion"&&p.size[1]>0.5).every(p=>p.position[1]>1.9),"its seats away from its tall back");
  r=K.expand({materials:{},objects:[A("k1","Gas cooker · 1",[0.6,0.6,0.9],[1,1,0.45],"white"),A("k2","Gas cooker · 2",[0.2,0.2,0.1],[1,1,0.95],"steel")]});
  assert.deepEqual([...r.hide],["k1"]); assert.equal(r.parts.length,16);
  // a thing that is the wrong size for its name is left as it is
  assert.equal(K.expand({materials:{},objects:[A("x","Sofa",[0.8,0.8,0.85],[1,1,0.425],"blue"),A("y","Radiator",[0.5,0.5,1.8],[3,1,0.9],"w"),A("z","Persian rug",[1,1,0.4],[2,2,0.2],"r")]}).parts.length,0);
});

test("13 stop 3, the dressing names the piece: a named box is that piece, whatever it is called", ()=>{
  const scene={materials:{oak:{baseColor:[0.4,0.25,0.1],roughness:0.6}},objects:[
    shape("wall-0","Room wall",[6,0.15,2.5],[3,5.075,1.25],"wall"),
    // a block the floor plan calls "Seat by the stove": no name of the kit, but the dressing said chair
    shape("anchor-4","Seat by the stove",[0.45,0.45,0.9],[1,1,0.45],"oak",{anchorId:"seat"}),
    // a run of units the dressing named, with the sink it drew on the worktop
    shape("anchor-5","Counter",[2,0.6,0.9],[3,4.7,0.45],"cream",{anchorId:"counter"}),
    shape("dress-0","Counter · 1",[0.5,0.4,0.02],[3,4.7,0.91],"steel",{anchorId:"counter"}),
    // an extra the dressing named: its box first, then what it drew on it, numbered from 2
    shape("extra-0","Way out",[0.9,0.05,2],[0,2,1],"green"),shape("extra-1","Way out · 2",[0.3,0.02,0.4],[0,2,1.5],"glass"),
    // a thing whose name the kit knows, that nobody named: still read by its name
    shape("anchor-6","Kitchen table",[1.2,0.75,0.74],[4,2,0.37],"oak",{anchorId:"table"}),
    // a bed the dressing named, with its cover's colour
    shape("anchor-7","Mattress on the floor",[0.9,1.9,0.5],[5.4,1.2,0.25],"pine",{anchorId:"mat"})]};
  const named={"anchor-4":{piece:"chair",second:"",faces:90},"anchor-5":{piece:"units",second:"oak"},"extra-0":{piece:"door",second:""},"anchor-7":{piece:"bed",second:"blue"},"anchor-9":{piece:"sofa"},"anchor-6":{piece:"spaceship"}};
  const kept=JSON.stringify(scene), r=K.expand(scene,named), of=n=>r.parts.filter(p=>p.name===n);
  assert.equal(JSON.stringify(scene),kept);
  assert.deepEqual(plain(r.pieces.map(p=>[p.name,p.piece,p.kept])),[["Seat by the stove","chair",0],["Counter","units",1],["Way out","door",1],["Kitchen table","table",0],["Mattress on the floor","bed",0]]);
  assert.deepEqual([...r.hide].sort(),["anchor-4","anchor-5","anchor-6","anchor-7","extra-0"],"what the dressing drew on a piece is still drawn");
  // faces 90 = east: the chair's back rail is on its west side
  assert.ok(topRail(r,"Seat by the stove").position[0]<0.85,"its front looks the way the dressing said");
  assert.equal(of("Counter").at(-1).material,"oak","second is its other colour: the worktop"); assert.ok(of("Counter").filter(p=>near(p.size[1],0.018,0.001)).every(p=>p.position[1]<4.5),"with no word on its front, its back is to the wall");
  assert.equal(of("Way out").length,7,"no panel over the pane the dressing drew");
  assert.ok(of("Mattress on the floor").some(p=>p.material==="blue")&&of("Mattress on the floor").filter(p=>p.kind==="box").every(p=>p.material==="pine"),"a bed: colour is its frame, second its cover");
  // with nothing named, the same set is read by its names alone
  assert.deepEqual(plain(K.expand(scene).pieces.map(p=>p.piece)),["table"]);
  // the size check the dressing asks before it keeps a kit piece
  assert.ok(K.fitsBox("chair",[0.45,0.45,0.9],0)&&!K.fitsBox("chair",[3,0.45,0.9],0)&&K.fitsBox("units",[0.6,2,0.9],0)&&K.fitsBox("door",[0.05,0.9,2],0)&&K.fitsBox("bed",[1.9,1.4,0.5],0));
  assert.ok(!K.fitsBox("spaceship",[1,1,1],0)&&!K.fitsBox("chair",null,0)&&!K.fitsBox("units",[2,0.6,0.9],1.5));
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
