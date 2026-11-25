/* THE SET CARD: what it shows, worked out from the place's own data (owner 2026-11-23: "build the card ... keep this
   exact same structure and design and layout used in the demo", a card the owner designed: one card per set, the
   chosen camera's view on top, the place and its rooms as chips, the four views, the plan, what it connects to, and
   a reference pack). Nothing here draws or saves: location-set-card-ui.jsx draws what these functions return.
   Everything is read from what the app already has: the place and its rooms (one set), each card's four cameras,
   the floor plan and the marks of the film's scene plans. */
(function(root){
  "use strict";
  const arr=v=>Array.isArray(v)?v:[], obj=v=>v&&typeof v==="object"?v:{};
  const KEYS=["TL","TR","BL","BR"];
  const cap=s=>{ s=String(s||"").trim(); return s?s.charAt(0).toUpperCase()+s.slice(1):""; };
  const fn=name=>typeof root[name]==="function"?root[name]:null;

  /* THE SPACES OF A CARD: the place first (its own name), then each room by the short name the app already uses
     ("Ellis Kitchen" inside "Ellis House" stays whole; "House - Kitchen" becomes "Kitchen"). */
  function spaces(place,rooms){
    const short=fn("locationRoomShortName");
    return [{id:place.id,name:place.name||"This place",chip:place.name||"This place",location:place,whole:true}]
      .concat(arr(rooms).filter(r=>r&&r.id!==place.id).map(r=>({id:r.id,name:r.name||"Room",chip:short?short(r,place):(r.name||"Room"),location:r,whole:false})));
  }
  /* THE FOUR VIEWS OF A SPACE, in the sheet's order: [{key, n, role, lensMm, placed}]. role = what the camera is for,
     in the card's own words; placed = it has a position on the floor plan. */
  function views(space,list){
    const poses=fn("locationPanelPoses"); if(!poses||!space) return [];
    let got=[]; try{ got=arr(poses(space,list)); }catch(_){ got=[]; }
    return KEYS.map((key,i)=>{ const p=got.find(x=>x&&x.key===key); if(!p) return null;
      const pose=obj(p.pose);
      return {key,n:i+1,role:cap(p.purpose)||cap(p.label)+" view",lensMm:Math.round(Number(pose.lensMm)||0)||null,placed:!!(arr(pose.position).length>=2&&pose.yaw!=null)};
    }).filter(Boolean);
  }
  // "CAM 2 · 28 MM" (the lens is left out when the camera has none yet)
  const camTag=v=>v?"CAM "+v.n+(v.lensMm?" · "+v.lensMm+" MM":""):"";

  /* ---- sizes ---- */
  const boundsOf=pts=>{ pts=arr(pts).filter(p=>arr(p).length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
    return pts.length?{minX:Math.min(...pts.map(p=>p[0])),maxX:Math.max(...pts.map(p=>p[0])),minY:Math.min(...pts.map(p=>p[1])),maxY:Math.max(...pts.map(p=>p[1]))}:null; };
  const metres=n=>(Math.round(n*10)/10).toFixed(1);
  // "6.0 × 4.2 m" from a footprint (its width east to west, then its depth)
  function sizeText(footprint){ const b=boundsOf(footprint); return b?metres(b.maxX-b.minX)+" × "+metres(b.maxY-b.minY)+" m":""; }
  /* THE LINE OF FACTS under the name. A room: its size and its ceiling. The place: its own size, how many rooms it
     holds and how many cameras look at it. plan = the floor plan as locationFloorPlanScene gives it; coords = the
     plan's own numbers (ceiling heights). */
  function facts(space,all,plan,coords){
    const fp=arr(obj(plan).spaces).find(s=>s.id===space.id), c=arr(obj(coords).spaces).find(s=>s&&s.id===space.id);
    const bits=[];
    if(fp){ const size=sizeText(fp.footprint); if(size) bits.push(size+(space.whole&&arr(all).length>1?" footprint":"")); }
    if(c&&c.openSky) bits.push("open sky");
    else if(c&&Number.isFinite(Number(c.ceilingH))&&Number(c.ceilingH)>0) bits.push(metres(Number(c.ceilingH))+" m ceiling");
    if(space.whole&&arr(all).length>1){
      const rooms=arr(all).length-1, cams=arr(obj(plan).cameras).length;
      bits.push(rooms+(rooms===1?" room":" rooms"));
      if(cams) bits.push(cams+(cams===1?" camera":" cameras"));
    }
    return bits.join(" · ");
  }

  /* ---- what a space connects to ---- */
  const inside=(pt,poly)=>{ let hit=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const a=poly[i],b=poly[j];
      if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/((b[1]-a[1])||1e-9)+a[0]) hit=!hit; } return hit; };
  const segDist=(p,a,b)=>{ const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy||1e-9, t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l));
    return Math.hypot(p[0]-(a[0]+dx*t),p[1]-(a[1]+dy*t)); };
  // how far a point is from a footprint's own edge (an opening sits ON the edge of the rooms it joins)
  const edgeDist=(pt,poly)=>{ let d=Infinity; for(let i=0;i<poly.length;i++) d=Math.min(d,segDist(pt,poly[i],poly[(i+1)%poly.length])); return d; };
  const KIND={door:"door",window:"window",glass:"window",arch:"open archway"};
  const NEAR=0.35;
  /* [{name, kinds:[words]}]: every room this one opens onto and how (door, window, open archway), then each door that
     leads off the plan by its own name, then "Outside" for its windows. An opening counts for a room when it is that
     room's own, or stands on that room's edge. Rooms that share no opening are not listed. */
  function connections(spaceId,plan){
    const P=obj(plan), all=arr(P.spaces), me=all.find(s=>s.id===spaceId); if(!me) return [];
    const by=new Map(), seen=new Set(), rooms=new Set();
    const add=(name,kind)=>{ const k=KIND[kind]||"opening", list=by.get(name)||[]; if(list.indexOf(k)<0) list.push(k); by.set(name,list); };
    arr(P.openings).forEach(o=>{
      if(!o||!arr(o.centre).length||o.outlier) return;
      const mine=o.spaceId===spaceId, onMe=edgeDist(o.centre,me.footprint)<=NEAR;
      if(!mine&&!onMe) return;
      const key=(o.kind||"")+"@"+Math.round(o.centre[0]*4)+","+Math.round(o.centre[1]*4); if(seen.has(key)) return; seen.add(key);
      const other=all.filter(s=>s.id!==spaceId).map(s=>({s,d:edgeDist(o.centre,s.footprint)})).filter(x=>x.d<=NEAR).sort((a,b)=>a.d-b.d)[0];
      const owner=!mine?all.find(s=>s.id===o.spaceId):null;
      const next=owner||(other&&other.s)||null;
      // nothing of the plan on the other side: a window looks outside; a door or an archway leads somewhere the plan
      // does not draw (the bedrooms, the street), so it is listed by its own name
      const glass=o.kind==="window"||o.kind==="glass";
      add(next?(next.name||"Room"):glass?"Outside":cap(o.name)||"Outside",o.kind);
      if(next) rooms.add(next.name||"Room");
    });
    const out=Array.from(by.entries()).map(([name,kinds])=>({name,kinds}));
    // the rooms of the plan first, then the doors that lead off it, then the outside
    const rank=x=>rooms.has(x.name)?0:x.name==="Outside"?2:1;
    return out.map((x,i)=>({x,i})).sort((a,b)=>rank(a.x)-rank(b.x)||a.i-b.i).map(q=>q.x);
  }

  /* ---- marks ---- */
  /* THE MARKS PEOPLE STAND ON HERE, from the film's scene plans (the card places nobody itself: a mark belongs to a
     scene). ids = the spaces to look in (a room: itself; the place: itself and its rooms). The first scene, in story
     order, that has marks there: {sceneId, sceneNo, marks:[{letter, name, xy}]} (eight at most), or null. */
  function marks(project,ids,scenes){
    const plans=obj(obj(project).scenePlans), want=new Set(arr(ids).map(String));
    const order=arr(scenes).map(s=>s&&s.id).filter(Boolean);
    Object.keys(plans).forEach(id=>{ if(order.indexOf(id)<0) order.push(id); });
    for(const sceneId of order){
      const plan=obj(plans[sceneId]), sets=arr(plan.sets).filter(s=>s&&want.has(String(s.locationId))).map(s=>String(s.id));
      if(!sets.length) continue;
      const here=arr(plan.marks).filter(m=>m&&sets.indexOf(String(m.set||""))>=0&&arr(m.xy).length===2&&m.xy.every(n=>Number.isFinite(Number(n))));
      if(!here.length) continue;
      const scene=arr(scenes).find(s=>s&&s.id===sceneId);
      return {sceneId,sceneNo:scene&&scene.no!=null?scene.no:null,
        marks:here.slice(0,8).map((m,i)=>({letter:String.fromCharCode(65+i),name:cap(m.name||m.near||"Mark"),xy:[Number(m.xy[0]),Number(m.xy[1])]}))};
    }
    return null;
  }
  // "A Front door · B Hall shelf", or the line that says there are none yet
  function marksLine(found){
    return found&&found.marks.length?found.marks.map(m=>m.letter+" "+m.name).join("  ·  "):"No marks yet. Plan a scene set here, in Shots, and its marks show on this plan.";
  }

  /* ---- the two stand-ins ---- */
  /* WHERE A AND B STAND in a space, in metres (the demo's two people, who show the scale of a room and what a camera
     really holds): on the first two marks a scene plan has inside this space, else a step either side of the room's
     middle, along its longer side. {A:[x,y], B:[x,y], names:{A,B} (the marks' names, when they are marks)}, or null
     for a space that is not on the plan. They are tried out on the card and never saved. */
  const PEOPLE=[{id:"A",colour:0xD08A2E,css:"#D08A2E",height:1.66},{id:"B",colour:0x3E73B8,css:"#3E73B8",height:1.72}];
  function keepInside(footprint,xy,from){
    if(inside(xy,footprint)&&edgeDist(xy,footprint)>=0.2) return [xy[0],xy[1]];
    // not inside: come back toward a point that is, a little at a time
    const b=boundsOf(footprint), home=from||[(b.minX+b.maxX)/2,(b.minY+b.maxY)/2];
    for(let t=0.1;t<=1.001;t+=0.1){ const q=[xy[0]+(home[0]-xy[0])*t,xy[1]+(home[1]-xy[1])*t]; if(inside(q,footprint)&&edgeDist(q,footprint)>=0.2) return q; }
    return home;
  }
  function interior(footprint){
    // a point well inside the room: its middle when that is inside (an L-shaped room's middle may not be), else the
    // best of a grid of its points
    const b=boundsOf(footprint), mid=[(b.minX+b.maxX)/2,(b.minY+b.maxY)/2];
    let best=null;
    for(let i=1;i<10;i++) for(let j=1;j<10;j++){ const q=[b.minX+(b.maxX-b.minX)*i/10,b.minY+(b.maxY-b.minY)*j/10]; if(!inside(q,footprint)) continue;
      const d=edgeDist(q,footprint)-Math.hypot(q[0]-mid[0],q[1]-mid[1])*0.15; if(!best||d>best.d) best={q,d}; }
    return best?best.q:mid;
  }
  function standIns(space,plan,found,coords){
    const fp=arr(obj(plan).spaces).find(s=>s.id===space.id); if(!fp||arr(fp.footprint).length<3) return null;
    // nobody stands in a space too low or too small to stand in (the inside of a car)
    const c=arr(obj(coords).spaces).find(s=>s&&s.id===space.id), box=boundsOf(fp.footprint);
    if(c&&!c.openSky&&Number(c.ceilingH)>0&&Number(c.ceilingH)<1.85) return null;
    if(Math.min(box.maxX-box.minX,box.maxY-box.minY)<0.8) return null;
    const here=arr(obj(found).marks).filter(m=>inside(m.xy,fp.footprint)).slice(0,2);
    const home=interior(fp.footprint), b=boundsOf(fp.footprint), wide=(b.maxX-b.minX)>=(b.maxY-b.minY);
    const step=Math.max(0.35,Math.min(0.9,(wide?b.maxX-b.minX:b.maxY-b.minY)*0.18));
    const dflt=k=>keepInside(fp.footprint,wide?[home[0]+k*step,home[1]]:[home[0],home[1]+k*step],home);
    const A=here[0]?here[0].xy.slice():dflt(-1);
    let B=here[1]?here[1].xy.slice():dflt(1);
    if(Math.hypot(A[0]-B[0],A[1]-B[1])<0.3) B=keepInside(fp.footprint,[A[0]+(wide?0.6:0),A[1]+(wide?0:0.6)],home);
    return {A,B,names:{A:here[0]?here[0].name:"",B:here[1]?here[1].name:""},floorZ:Number(fp.floorZ)||0,sceneNo:here.length&&found?found.sceneNo:null,footprint:fp.footprint};
  }
  // "A  x 3.72, y 2.80 m   ·   B  x 2.40, y 3.70 m" (with a mark's name while a stand-in is still on it)
  function peopleLine(at,names){
    if(!at) return "No stand-ins here: this space is too low or too small to stand in, or it is not on the floor plan yet.";
    const one=k=>k+"  "+(names&&names[k]?names[k]+" · ":"")+"x "+at[k][0].toFixed(2)+", y "+at[k][1].toFixed(2)+" m";
    return one("A")+"   ·   "+one("B");
  }

  /* ---- the plan, ready to draw ----
     The floor plan in picture coordinates (north up): {W, H, scale (px per metre), origin (the metres at the
     picture's middle), rooms:[{id, name, size, points, lit, at}], doors:[{a, b}], windows:[{a, b}],
     camera:{at, n, cone}|null, people:[{id, at, css}], wall (px), missing}.
     THE WHOLE PLACE, WITH THE CHOSEN SPACE LIT (owner 2026-11-23: "when a user clicks on one of the subspaces ... we
     should be able to see that area highlighted on the floor plan, so it is clearly visible which part of the
     location is currently in view"): the picture holds every space of the place when the chosen one still shows
     well at that size; when the place is far bigger than the room (a hallway in a street), it comes in on the room
     until the room is a good part of the picture, with as much of the place around it as fits. Only the chosen space
     is lit; a space that is not on the plan yet lights nothing (missing). Every wall is drawn at its thickness, a
     door is a gap in it and a window a pane of glass. width = the picture's width in px; its height follows what is
     shown, 170 to 380 px. */
  function planModel(plan,space,cameraKey,people,width){
    const P=obj(plan), all=arr(P.spaces); if(!all.length) return null;
    const me=all.find(s=>s.id===space.id)||null;
    const whole=boundsOf([].concat(...all.map(s=>s.footprint))), fit=me?boundsOf(me.footprint):whole; if(!fit||!whole) return null;
    const W=Math.max(200,Math.round(width||440)), TALL=380;
    const bw=Math.max(0.5,fit.maxX-fit.minX), bh=Math.max(0.5,fit.maxY-fit.minY), aw=Math.max(0.5,whole.maxX-whole.minX), ah=Math.max(0.5,whole.maxY-whole.minY);
    const m=Math.max(0.6,0.08*Math.max(aw,ah)), mine=Math.max(0.9,0.17*Math.max(bw,bh));
    // the whole place in the picture; the chosen space alone; and the least the chosen space may be (half of it)
    const sAll=Math.min(W/(aw+2*m),TALL/(ah+2*m)), sMine=Math.min(W/(bw+2*mine),TALL/(bh+2*mine)), sLeast=Math.min(0.5*W/bw,0.5*TALL/bh);
    const s=me?Math.min(sMine,Math.max(sAll,sLeast)):sAll;
    const H=Math.round(Math.max(170,Math.min(TALL,(ah+2*m)*s)));
    // centred on the whole place when all of it shows; else on the chosen space, kept inside the place
    const vw=W/s, vh=H/s, mid=(lo,hi,want,view)=>hi-lo+2*m<=view?(lo+hi)/2:Math.max(lo-m+view/2,Math.min(hi+m-view/2,want));
    const cx=mid(whole.minX,whole.maxX,(fit.minX+fit.maxX)/2,vw), cy=mid(whole.minY,whole.maxY,(fit.minY+fit.maxY)/2,vh);
    const X=x=>Math.round((W/2+(x-cx)*s)*10)/10, Y=y=>Math.round((H/2-(y-cy)*s)*10)/10, at=p=>[X(p[0]),Y(p[1])];
    const lit=id=>!!me&&id===space.id;
    const area=b=>(b.maxX-b.minX)*(b.maxY-b.minY);
    const rooms=all.map(r=>{ const b=boundsOf(r.footprint), c=r.centre||[(b.minX+b.maxX)/2,(b.minY+b.maxY)/2], isLit=lit(r.id);
        // a name sits inside the picture: a big neighbour (a street, a garden) is named where it shows
        const p=at(isLit?interior(r.footprint):c), shown=[Math.max(40,Math.min(W-40,p[0])),Math.max(13,Math.min(H-13,p[1]))];
        // (in the picture when its outline's box and the picture's overlap: a street is far bigger than the picture)
        const lo=at([b.minX,b.maxY]), hi=at([b.maxX,b.minY]), visible=lo[0]<W&&hi[0]>0&&lo[1]<H&&hi[1]>0;
        return {id:r.id,name:r.name||"",size:isLit?sizeText(r.footprint):"",points:r.footprint.map(at),lit:isLit,at:isLit?p:shown,visible,area:area(b)}; })
      .filter(r=>r.visible)
      // the biggest first, so a room inside a larger space (a hallway in a house) is drawn over it
      .sort((a,b)=>b.area-a.area);
    const open=arr(P.openings).filter(o=>o&&!o.outlier&&arr(o.a).length&&arr(o.b).length).map(o=>({a:at(o.a),b:at(o.b),glass:o.kind==="window"||o.kind==="glass"}));
    const cam=arr(P.cameras).find(c=>c&&c.spaceId===space.id&&c.panel===cameraKey&&arr(c.position).length>=2&&!c.outlier);
    let camera=null;
    if(cam){
      const p=at(cam.position), L=Math.min(92,Math.max(46,W*0.19));
      const ray=e=>{ const q=at(e), dx=q[0]-p[0], dy=q[1]-p[1], l=Math.hypot(dx,dy)||1; return [Math.round((p[0]+dx/l*L)*10)/10,Math.round((p[1]+dy/l*L)*10)/10]; };
      const f=arr(cam.frustum);
      camera={at:p,n:KEYS.indexOf(cameraKey)+1,cone:f.length===3?[p,ray(f[1]),ray(f[2])]:null};
    }
    const who=people?PEOPLE.map(k=>({id:k.id,css:k.css,at:at(people[k.id])})):[];
    return {W,H,scale:s,origin:[cx,cy],wall:Math.max(2.5,Math.min(7,0.14*s)),rooms,doors:open.filter(o=>!o.glass),windows:open.filter(o=>o.glass),camera,people:who,missing:!me};
  }
  // a point of the plan's picture, back in metres (for a stand-in that is dragged)
  const planMetres=(model,px,py)=>[model.origin[0]+(px-model.W/2)/model.scale,model.origin[1]-(py-model.H/2)/model.scale];

  // The three pictures of a reference pack, in order: what each is called, its look in the viewer and its one line.
  // The three looks of a view (KinolotPrevis: colour, clay, depth) and the three pictures of a reference pack.
  /* (owner 2026-11-25: the same four words as a shot's picture has, "Previs", "Clay", "Depth" and "Frame". The first,
     the set with its surfaces, was called "Colour"; its id stays. "Frame" is no drawing: it is the place's finished
     picture, its location image.) */
  const LOOKS=[
    {id:"colour",look:"",name:"Previs",title:"The set with its surfaces: brick, floor, glass, furniture"},
    {id:"clay",look:"clay",name:"Clay",title:"The set in one matt white: only shape and light. The stand-ins keep their colours."},
    {id:"depth",look:"depth",name:"Depth",title:"How far each thing is from the camera: near is light, far is dark"},
    {id:"frame",look:"",name:"Frame",title:"The location image: the finished picture of this place",frame:true}];
  const PACK=[
    {id:"colour",look:"",name:"Previs",text:"This camera, the set with its surfaces and the two stand-ins."},
    {id:"clay",look:"clay",name:"Clay",text:"The set in one matt white, so only shape and light are left. The stand-ins keep their colours."},
    {id:"depth",look:"depth",name:"Depth",text:"How far each thing is from the camera. Near is light."}];

  root.KinolotSetCard={KEYS,PACK,LOOKS,PEOPLE,spaces,views,camTag,sizeText,facts,connections,marks,marksLine,standIns,keepInside,peopleLine,planModel,planMetres};
})(typeof window!=="undefined"?window:globalThis);
