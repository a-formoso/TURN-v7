/* floor-plan-drag.js — THE FLOOR PLAN, CHANGED BY HAND (owner 2026-11-25: "being able to modify the floor plan simply
   by clicking and dragging"; step 1, "yes, start with the first step": a piece of furniture, a door or a window is
   dragged to where it should be; walls come later. And: "ensure The Place description updates also dynamically, as a
   consequence of the floor changes").

   The floor plan is numbers (locations.jsx normalizeLocationSpatialPlan): each object has its place in metres and a
   sentence that says where it stands; each door and window has its middle on a wall. This file is the part with no
   screen in it: what can be moved, where a move may end, and the sentence that says where a thing stands NOW, written
   from the numbers. Nothing here draws, saves or calls an engine.

     objects(plan)                 the things that can be dragged: [{id, name, xy, size, facing, space}]
     openings(plan)                the doors and windows: [{spaceId, id, name, kind, centre, width, run:{a, b}}]
                                   (run = the stretch of wall the opening can slide along)
     moveObject(plan, id, [x,y])   the plan with that thing there: in steps of 5 cm, kept inside its room, marked as
                                   placed by the user, its sentence rewritten; what stands on it goes with it
     moveOpening(plan, spaceId, id, [x,y])
                                   the plan with that door or window slid along its wall toward the point: never off
                                   the wall's ends, never over or past another opening of that wall. The same doorway
                                   seen from the room on its other side, and the door that hangs in it, move with it
     walls(plan)                   the walls of every room: [{id, spaceId, edge, a, b, length, n, side, name, locked}]
                                   (step 2, owner 2026-11-25: "yes, go on to step 2, the walls"). locked = why a wall
                                   cannot be moved yet (two rooms share it; it runs on into the next stretch), else ""
     slideWall(plan, spaceId, edge, [x,y])
                                   → {plan, why}: the plan with that wall moved square to itself toward the point, in
                                   steps of 5 cm, as far as it can go; why = what stopped it short, "" when nothing did.
                                   Its doors and windows go with it; what stands against it or hangs on it goes with
                                   it (and what stands on that); what it meets, it pushes ahead; the walls beside it
                                   get longer or shorter. See THE WALLS below for where it stops
     moveWall(plan, spaceId, edge, [x,y])     the same, the plan alone
     carry(before, after)          for what is NOT in the plan (a camera set by hand, a scene's mark, a piece of
                                   dressing): {any, edges, point(p, {space, ride, clear})} moves a point the way the
                                   walls moved: with a wall it stood beside, or ahead of a wall that reached it
     changed(before, after)        how many things and walls a change moved
     follow(C, locations, spaces, ownerId), sceneMoves(scenePlans, spaces, moved, C, shots, keyOf)
                                   what a save writes beside the plan when a wall moved (cameras set by hand, the
                                   set's dressing; a planned scene's marks and cameras): worked out, never saved, here
     moves(before, after)          what a change moved, by id: [{id, by:[dx, dy]}] (a scene's marks follow these)
     placementOf(plan, id)         where that object stands, in one sentence from the numbers
     where(plan)                   every object, door and window with its sentence: [{id, name, kind, text, byHand}]
     byHand(plan)                  how many of them were placed by hand
     commit(place, base, edited, locations)
                                   the change as it would be saved: confirmed, and checked as a confirm checks it

   Metres; +Y north, +X east, as the floor plan. */
(function(root){
  "use strict";
  const arr=v=>Array.isArray(v)?v:[], obj=v=>(v&&typeof v==="object"&&!Array.isArray(v))?v:{};
  const SNAP=0.05, GAP=0.05;
  const r2=v=>Math.round(v*100)/100, r3=v=>Math.round(v*1000)/1000, snap=v=>r2(Math.round(v/SNAP)*SNAP);
  const pt=v=>{ const a=arr(v); return a.length>=2&&Number.isFinite(Number(a[0]))&&Number.isFinite(Number(a[1]))?[Number(a[0]),Number(a[1])]:null; };
  const inside=(p,poly)=>{ let c=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const a=poly[i], b=poly[j];
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) c=!c; } return c; };
  const segDist=(p,a,b)=>{ const dx=b[0]-a[0], dy=b[1]-a[1], l=dx*dx+dy*dy||1, t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l));
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy); };
  const spacesOf=plan=>arr(obj(obj(plan).coordinates).spaces).filter(s=>s&&arr(s.footprint).length>=3);
  const low=v=>String(v==null?"":v).trim().toLowerCase();

  // the room an object stands in: the one its card names, else the smallest whose outline holds it
  function spaceOf(plan,anchor){
    const all=spacesOf(plan), a=obj(anchor), named=all.find(s=>low(s.name)&&low(s.name)===low(a.space));
    if(named) return named;
    const xy=pt(a.xy); if(!xy) return all[0]||null;
    const area=s=>{ const xs=s.footprint.map(p=>p[0]), ys=s.footprint.map(p=>p[1]); return (Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys)); };
    return all.filter(s=>inside(xy,s.footprint)).sort((x,y)=>area(x)-area(y))[0]||all[0]||null;
  }
  // the stretch of wall an opening stands in: a wall of its own inside the room (locations.jsx), else its outline edge
  function runOf(space,opening){
    const o=obj(opening), poly=arr(obj(space).footprint);
    let inner=null; try{ inner=typeof root.locationInnerWall==="function"?root.locationInnerWall(space,o):null; }catch(_){ inner=null; }
    if(inner&&pt(inner.a)&&pt(inner.b)) return {a:pt(inner.a),b:pt(inner.b),inner:true};
    const e=Number.isInteger(o.edge)&&o.edge>=0&&o.edge<poly.length?o.edge:-1;
    if(e<0) return null;
    return {a:pt(poly[e]),b:pt(poly[(e+1)%poly.length]),inner:false,edge:e};
  }
  const sameRun=(x,y)=>!!x&&!!y&&((Math.hypot(x.a[0]-y.a[0],x.a[1]-y.a[1])<0.03&&Math.hypot(x.b[0]-y.b[0],x.b[1]-y.b[1])<0.03)
    ||(Math.hypot(x.a[0]-y.b[0],x.a[1]-y.b[1])<0.03&&Math.hypot(x.b[0]-y.a[0],x.b[1]-y.a[1])<0.03));

  function openings(plan){
    const out=[];
    spacesOf(plan).forEach(s=>arr(s.openings).forEach(o=>{ const c=pt(o&&o.centre), w=Number(o&&o.width); if(!c||!(w>0)) return;
      const run=runOf(s,o); if(!run||!run.a||!run.b) return;
      out.push({spaceId:String(s.id),spaceName:String(s.name||""),id:String(o.id),name:String(o.name||"Opening"),kind:String(o.kind||"window"),centre:c,width:w,run,byHand:o.basis==="user"}); }));
    return out;
  }
  function objects(plan){
    const doors=openings(plan);
    return arr(obj(plan).anchors).filter(a=>a&&pt(a.xy)).map(a=>{ const xy=pt(a.xy), size=arr(a.size).map(Number);
        const sp=spaceOf(plan,a);
        return {id:String(a.id),name:String(a.name||"Object"),xy,size:size.length===3&&size.every(n=>n>0)?size:[0.4,0.4,0.4],facing:Number(a.facing)||0,
          space:sp?String(sp.name||""):String(a.space||""),spaceId:sp?String(sp.id):"",byHand:a.posBasis==="user",
          // a door that hangs in an opening is moved with its opening, never by itself
          door:doors.some(o=>o.id===String(a.id)||Math.hypot(o.centre[0]-xy[0],o.centre[1]-xy[1])<0.12&&Math.abs(o.width-Math.max(size[0]||0,size[1]||0))<0.35)}; });
  }

  /* ---- where a thing stands, in words ---- */
  const COMPASS=["north","north-east","east","south-east","south","south-west","west","north-west"];
  const compass=(dx,dy)=>COMPASS[((Math.round(Math.atan2(dx,dy)/(Math.PI/4))%8)+8)%8];
  const metres=d=>(Math.round(d*10)/10).toFixed(1).replace(/\.0$/,"")+" m";
  const sub=(p,q)=>[p[0]-q[0],p[1]-q[1]], dot=(p,q)=>p[0]*q[0]+p[1]*q[1], crs=(p,q)=>p[0]*q[1]-p[1]*q[0];
  const area2=poly=>{ let n=0; for(let i=0;i<poly.length;i++){ const a=poly[i], b=poly[(i+1)%poly.length]; n+=a[0]*b[1]-b[0]*a[1]; } return n; };
  /* a room's walls, in order: ends, length, the way along (u), the way OUT of the room (n) and its side by compass.
     Out is read from the way the outline runs, not from the room's middle: in an L-shaped room the walls of the
     inner corner face the room's middle, and were named by the wrong side (a hall's east wall as "west"). */
  function edgesOf(space){
    const poly=arr(obj(space).footprint).map(pt).filter(Boolean); if(poly.length<3) return [];
    const ccw=area2(poly)>0;
    return poly.map((a,i)=>{ const b=poly[(i+1)%poly.length], L=Math.hypot(b[0]-a[0],b[1]-a[1])||1e-9, u=[(b[0]-a[0])/L,(b[1]-a[1])/L];
      const n=ccw?[u[1],-u[0]]:[-u[1],u[0]];
      return {i,a,b,L,u,n,side:Math.abs(n[0])>=Math.abs(n[1])?(n[0]>0?"east":"west"):(n[1]>0?"north":"south")}; });
  }
  // the wall nearest a point: which side of the room it is, and how far
  function wallOf(space,p){
    let best=null;
    edgesOf(space).forEach(E=>{ const d=segDist(p,E.a,E.b); if(!best||d<best.d-1e-9) best={d,side:E.side,edge:E.i}; });
    return best;
  }
  function placementOf(plan,id){
    const list=objects(plan), me=list.find(x=>x.id===String(id)); if(!me) return "";
    const a=arr(obj(plan).anchors).find(x=>x&&String(x.id)===String(id))||{}, sp=spaceOf(plan,a), bits=[];
    const wall=sp?wallOf(sp,me.xy):null, room=sp&&sp.name?" of "+sp.name:"";
    if(wall) bits.push(wall.d<=0.3?"On the "+wall.side+" wall"+room:metres(wall.d)+" from the "+wall.side+" wall"+room);
    // the nearest other thing, door or window, within reach: "0.6 m north of Front door"
    const others=list.filter(x=>x.id!==me.id&&!x.door).map(x=>({name:x.name,at:x.xy}))
      .concat(openings(plan).filter((o,i,all)=>all.findIndex(q=>Math.hypot(q.centre[0]-o.centre[0],q.centre[1]-o.centre[1])<0.2)===i).map(o=>({name:o.name,at:o.centre})));
    let near=null; others.forEach(o=>{ const d=Math.hypot(o.at[0]-me.xy[0],o.at[1]-me.xy[1]); if(d>=0.1&&d<=2.5&&(!near||d<near.d)) near={d,o}; });
    if(near) bits.push(metres(near.d)+" "+compass(me.xy[0]-near.o.at[0],me.xy[1]-near.o.at[1])+" of "+near.o.name);
    const z=Number(a.z), h=me.size[2]||0;
    if(Number.isFinite(z)&&z-h/2>0.25) bits.push("its middle "+metres(z)+" above the floor");
    const text=bits.join(", ");
    return ((text?text+". ":"")+"Placed by hand on the floor plan.").slice(0,320);
  }
  function openingText(plan,o){
    const sp=spacesOf(plan).find(s=>String(s.id)===o.spaceId), wall=sp?wallOf(sp,o.centre):null;
    const L=Math.hypot(o.run.b[0]-o.run.a[0],o.run.b[1]-o.run.a[1]), t=Math.hypot(o.centre[0]-o.run.a[0],o.centre[1]-o.run.a[1]);
    const from=compass(o.run.a[0]-o.run.b[0],o.run.a[1]-o.run.b[1]);
    const word=o.kind==="door"?"door":o.kind==="arch"?"open doorway":o.kind==="glass"?"glass":"window";
    return (o.run.inner?"In a wall inside ":"In the "+(wall?wall.side:"")+" wall of ").replace("  "," ")+(o.spaceName||"the room")+", its middle "+metres(t)+" from the wall’s "+from+" end ("+metres(L)+" long); "+(/^[aeiou]/.test(word)?"an ":"a ")+word+" "+metres(o.width)+" wide.";
  }
  function where(plan){
    const seen=[], doors=openings(plan).filter(o=>{ const twin=seen.some(c=>Math.hypot(c[0]-o.centre[0],c[1]-o.centre[1])<0.2); seen.push(o.centre); return !twin; });
    return spacesOf(plan).map(sp=>({id:"room:"+sp.id,name:String(sp.name||"The room"),kind:"room",text:roomText(sp),byHand:sp.basis==="user"}))
      .concat(doors.map(o=>({id:o.id,name:o.name,kind:"opening",text:openingText(plan,o),byHand:o.byHand})))
      .concat(objects(plan).filter(x=>!x.door).map(x=>({id:x.id,name:x.name,kind:"object",byHand:x.byHand,
        text:placementOf(plan,x.id).replace(/ ?Placed by hand on the floor plan\.$/,"")})));
  }
  const byHand=plan=>where(plan).filter(x=>x.byHand&&x.kind!=="room").length;

  /* ---- the moves ---- */
  const clone=plan=>JSON.parse(JSON.stringify(obj(plan)));
  function moveObject(plan,id,to){
    const next=clone(plan), a=arr(next.anchors).find(x=>x&&String(x.id)===String(id)), want=pt(to), from=a&&pt(a.xy);
    if(!a||!want||!from) return plan;
    /* IN STEPS OF 5 CM FROM WHERE IT STANDS, not onto a grid of the room: a thing dragged along one wall keeps its
       distance from that wall to the centimetre, and a thing moved back by the same amount is exactly where it was. */
    const sp=spaceOf(next,a); let at=[r2(from[0]+snap(want[0]-from[0])),r2(from[1]+snap(want[1]-from[1]))];
    if(sp&&!inside(at,sp.footprint)){
      // outside its room: come back toward where it was, a step at a time, to the first spot inside
      let ok=null; for(let t=0.05;t<=1.0001;t+=0.05){ const q=[r2(from[0]+snap((at[0]-from[0])*(1-t))),r2(from[1]+snap((at[1]-from[1])*(1-t)))]; if(inside(q,sp.footprint)){ ok=q; break; } }
      at=ok||from;
    }
    if(Math.abs(at[0]-from[0])<1e-9&&Math.abs(at[1]-from[1])<1e-9) return plan;
    /* WHAT STANDS ON IT GOES WITH IT: a sewing machine on a table, a kettle on a worktop. A thing rides when its
       place is inside the moved thing's outline and its underside is at the moved thing's top (to 15 cm): a shelf on
       the wall above a worktop does not, and neither does a chair beside a table. */
    const size=arr(a.size).map(Number), top=Number(a.z)+(size[2]||0)/2, by=[at[0]-from[0],at[1]-from[1]];
    const t=(Number(a.facing)||0)*Math.PI/180, cs=Math.cos(t), sn=Math.sin(t), hw=(size[0]||0)/2+0.02, hd=(size[1]||0)/2+0.02;
    const riders=size.length===3&&Number.isFinite(top)?arr(next.anchors).filter(x=>{ const xy=pt(x&&x.xy), xs=arr(x&&x.size).map(Number); if(!xy||x===a||xs.length!==3) return false;
      const dx=xy[0]-from[0], dy=xy[1]-from[1], lx=dx*cs-dy*sn, ly=dx*sn+dy*cs;      // (in the moved thing's own frame: it is turned by -facing)
      return Math.abs(lx)<=hw&&Math.abs(ly)<=hd&&Math.abs(Number(x.z)-xs[2]/2-top)<=0.15; }):[];
    a.xy=at; a.posBasis="user";
    riders.forEach(x=>{ const xy=pt(x.xy); x.xy=[r2(xy[0]+by[0]),r2(xy[1]+by[1])]; x.posBasis="user"; });
    a.placement=placementOf(next,a.id); riders.forEach(x=>{ x.placement=placementOf(next,x.id); });
    return next;
  }
  function moveOpening(plan,spaceId,id,to){
    const next=clone(plan), all=spacesOf(next), sp=all.find(s=>String(s.id)===String(spaceId)), want=pt(to);
    const o=sp&&arr(sp.openings).find(x=>x&&String(x.id)===String(id)), c=o&&pt(o.centre), w=Number(o&&o.width);
    const run=o&&runOf(sp,o);
    if(!o||!c||!want||!(w>0)||!run) return plan;
    const L=Math.hypot(run.b[0]-run.a[0],run.b[1]-run.a[1]); if(!(L>w+2*GAP)) return plan;
    const u=[(run.b[0]-run.a[0])/L,(run.b[1]-run.a[1])/L], along=p=>(p[0]-run.a[0])*u[0]+(p[1]-run.a[1])*u[1];
    const t0=along(c); let lo=w/2+GAP, hi=L-w/2-GAP;
    // the other doors and windows of this wall: it stops beside them, on the side it started from
    arr(sp.openings).forEach(x=>{ if(!x||x===o) return; const xc=pt(x.centre), xw=Number(x.width), xr=runOf(sp,x); if(!xc||!(xw>0)||!sameRun(run,xr)) return;
      const tx=along(xc); if(tx<t0) lo=Math.max(lo,tx+xw/2+w/2+GAP); else hi=Math.min(hi,tx-xw/2-w/2-GAP); });
    if(lo>hi) return plan;
    // (in steps of 5 cm from where it stands, as an object is: moved back by the same amount, it is where it was)
    const t=Math.max(lo,Math.min(hi,t0+snap(along(want)-t0)));
    if(Math.abs(t-t0)<1e-6) return plan;
    const at=[r3(run.a[0]+u[0]*t),r3(run.a[1]+u[1]*t)], by=[at[0]-c[0],at[1]-c[1]];
    // the same doorway as the room on its other side has it, and the door that hangs in it, move with it
    all.forEach(s=>arr(s.openings).forEach(x=>{ const xc=pt(x&&x.centre); if(!xc||x===o) return;
      if(Math.hypot(xc[0]-c[0],xc[1]-c[1])<0.2&&Math.abs(Number(x.width)-w)<0.35){ x.centre=[r3(xc[0]+by[0]),r3(xc[1]+by[1])]; x.basis="user"; } }));
    o.centre=at; o.basis="user";
    arr(next.anchors).forEach(a=>{ const xy=pt(a&&a.xy); if(!xy) return;
      if(String(a.id)===String(o.id)||Math.hypot(xy[0]-c[0],xy[1]-c[1])<0.12){ a.xy=[r3(xy[0]+by[0]),r3(xy[1]+by[1])]; a.posBasis="user"; } });
    return next;
  }
  // what a change moved, by id (objects, and openings by their own ids): a scene's marks beside them follow
  function moves(before,after){
    const out=[], add=(id,p,q)=>{ if(p&&q&&(Math.abs(q[0]-p[0])>1e-6||Math.abs(q[1]-p[1])>1e-6)&&!out.some(x=>x.id===id)) out.push({id,by:[r3(q[0]-p[0]),r3(q[1]-p[1])]}); };
    arr(obj(before).anchors).forEach(a=>{ const b=arr(obj(after).anchors).find(x=>x&&a&&String(x.id)===String(a.id)); add(String(a&&a.id),pt(a&&a.xy),pt(b&&b.xy)); });
    spacesOf(before).forEach(s=>{ const s2=spacesOf(after).find(x=>String(x.id)===String(s.id));
      arr(s.openings).forEach(o=>{ const o2=arr(obj(s2).openings).find(x=>x&&o&&String(x.id)===String(o.id)); add(String(o&&o.id),pt(o&&o.centre),pt(o2&&o2.centre)); }); });
    return out;
  }

  /* ---- THE WALLS (step 2, owner 2026-11-25: "yes, go on to step 2, the walls") ----
     A wall is one side of a room's outline. It is moved square to itself, in steps of 5 cm; the room keeps its number
     of corners, and the walls beside it get longer or shorter along their own lines.
     - What is IN the wall goes with it: its doors and windows, and the doors that hang in them.
     - What stands AGAINST it or hangs ON it goes with it (its outline within 15 cm of the wall), on either side of
       the wall, and so does what stands on that.
     - What it MEETS, it pushes ahead: a table in the room when the wall comes in, a bin outside when it goes out.
     - A camera of the floor plan that stood beside it (60 cm) goes with it; one it reaches is kept 30 cm clear.
     It STOPS, and says why, where: a wall beside it would become shorter than 30 cm or lose the room a door or
     window needs; the walls would cross; a thing it pushes has no room left; a doorway's own wall inside the room
     would be reached; the room would run into another room, or out of the space it stands in, or over a room that
     stands in it. NOT MOVED YET: a wall two rooms share (or one with a doorway into another room on the plan), and a
     stretch of wall that runs straight on into the next stretch. */
  const MIN_WALL=0.3, AGAINST=0.15, CAM_RIDE=0.6, CAM_CLEAR=0.3, TOUCH=0.08, EDGE=0.03, FAR=15;
  const cap=t=>t.charAt(0).toUpperCase()+t.slice(1);
  const polyDist=(p,poly)=>{ let d=Infinity; for(let i=0;i<poly.length;i++) d=Math.min(d,segDist(p,poly[i],poly[(i+1)%poly.length])); return d; };
  const within=(p,poly)=>inside(p,poly)||polyDist(p,poly)<=EDGE, deep=(p,poly)=>inside(p,poly)&&polyDist(p,poly)>EDGE;
  // two stretches that truly cross (not ones that only touch or lie along each other)
  const cross=(a,b,c,d)=>{ const o=(p,q,r)=>crs(sub(q,p),sub(r,p)), e=1e-7, o1=o(a,b,c), o2=o(a,b,d), o3=o(c,d,a), o4=o(c,d,b);
    return ((o1>e&&o2<-e)||(o1<-e&&o2>e))&&((o3>e&&o4<-e)||(o3<-e&&o4>e)); };
  /* do two outlines lie over each other? A corner, the middle of a wall or the middle of the room of one, well
     inside the other (two rooms of the same depth side by side have every corner ON the other's walls: the middles
     of their walls tell); or walls that cross. Rooms that only touch do not. */
  const probes=A=>{ const mid=[A.reduce((n,p)=>n+p[0],0)/A.length,A.reduce((n,p)=>n+p[1],0)/A.length];
    return A.concat(A.map((a,i)=>{ const b=A[(i+1)%A.length]; return [(a[0]+b[0])/2,(a[1]+b[1])/2]; }),inside(mid,A)?[mid]:[]); };
  const overlap=(A,B)=>probes(A).some(p=>deep(p,B))||probes(B).some(p=>deep(p,A))
    ||A.some((a,i)=>B.some((c,j)=>cross(a,A[(i+1)%A.length],c,B[(j+1)%B.length])));
  const polyOf=s=>arr(obj(s).footprint).map(pt).filter(Boolean);
  // how two rooms lie: one in the other, apart, or already over each other (then nothing is asked of them)
  const lie=(S,T)=>S.every(p=>within(p,T))?"in":T.every(p=>within(p,S))?"holds":overlap(S,T)?"mixed":"apart";
  const simple=poly=>{ const N=poly.length; for(let i=0;i<N;i++) for(let j=i+1;j<N;j++){ if(j===i+1||(i===0&&j===N-1)) continue;
      const a=poly[i], b=poly[(i+1)%N], c=poly[j], d=poly[(j+1)%N];
      if(cross(a,b,c,d)||segDist(c,a,b)<1e-6||segDist(d,a,b)<1e-6||segDist(a,c,d)<1e-6||segDist(b,c,d)<1e-6) return false; } return true; };
  const onEdge=(space,o,e)=>{ const run=runOf(space,o); return !!run&&!run.inner&&run.edge===e; };
  // why a wall cannot be moved yet, "" when it can
  function lockOf(plan,space,e){
    const all=edgesOf(space), E=all[e]; if(!E) return "This wall is not on the floor plan.";
    const N=all.length, P=all[(e-1+N)%N], Q=all[(e+1)%N];
    if(Math.abs(crs(E.u,P.u))<0.02||Math.abs(crs(E.u,Q.u))<0.02) return "This stretch of wall runs straight on into the next one: it cannot be moved by itself yet.";
    const mine=arr(space.openings).filter(o=>o&&pt(o.centre)&&onEdge(space,o,e));
    for(const t of spacesOf(plan)){
      if(String(t.id)===String(space.id)) continue;
      const name=String(t.name||"another room"), said="It is shared with "+name+": a wall two rooms share cannot be moved yet.";
      for(const F of edgesOf(t)){
        if(Math.abs(crs(E.u,F.u))>0.02||Math.abs(dot(sub(F.a,E.a),E.n))>TOUCH) continue;
        const t0=dot(sub(F.a,E.a),E.u), t1=dot(sub(F.b,E.a),E.u);
        if(Math.min(E.L,Math.max(t0,t1))-Math.max(0,Math.min(t0,t1))>0.1) return said;
      }
      if(mine.some(o=>arr(t.openings).some(x=>{ const xc=pt(x&&x.centre), c=pt(o.centre); return !!xc&&Math.hypot(xc[0]-c[0],xc[1]-c[1])<0.2; }))) return said;
    }
    return "";
  }
  function walls(plan){
    const out=[];
    spacesOf(plan).forEach(s=>edgesOf(s).forEach(E=>out.push({id:"wall:"+s.id+":"+E.i,spaceId:String(s.id),spaceName:String(s.name||""),edge:E.i,
      a:E.a,b:E.b,length:r2(E.L),n:E.n,side:E.side,name:cap(E.side)+" wall"+(s.name?" of "+s.name:""),locked:lockOf(plan,s,E.i),byHand:s.basis==="user"})));
    return out;
  }
  // a room in words: how far across each way, its floor, and each wall's length, from the numbers
  function roomText(space){
    const E=edgesOf(space); if(!E.length) return "";
    const xs=E.map(e=>e.a[0]), ys=E.map(e=>e.a[1]), w=Math.max(...xs)-Math.min(...xs), d=Math.max(...ys)-Math.min(...ys), fl=Math.abs(area2(E.map(e=>e.a)))/2;
    return metres(w)+" east to west and "+metres(d)+" north to south"+(E.length>4?" at its widest":"")+", "+(fl>=10?Math.round(fl):Math.round(fl*10)/10)+" m² of "+(obj(space).openSky?"ground":"floor")+". "+(obj(space).openSky?"Sides":"Walls")+", in order: "
      +E.map(e=>e.side+" "+metres(e.L)).join(", ")+".";
  }
  /* where a wall that moves by s (out of its room when s > 0) takes a point: with it (the point stood beside it,
     within `ride` of its own half-depth h), ahead of it (the wall reached it: kept `clear`), or nowhere (null).
     isIn = the point stands in the wall's own room. */
  function taken(xy,E,s,isIn,h,ride,clear){
    const d=dot(sub(E.a,xy),E.n), along=dot(sub(xy,E.a),E.u);
    if(along<-0.05||along>E.L+0.05) return null;
    if(isIn){ if(d<-0.3) return null;
      if(d-h<=ride) return [E.n[0]*s,E.n[1]*s];
      const d1=d+s; return d1-h<clear?[-E.n[0]*(clear+h-d1),-E.n[1]*(clear+h-d1)]:null; }
    const o=-d; if(o<-0.05) return null;
    if(o-h<=ride) return [E.n[0]*s,E.n[1]*s];
    const d1=o-s; return d1-h<clear?[E.n[0]*(clear+h-d1),E.n[1]*(clear+h-d1)]:null;
  }
  // does x stand ON a (inside its outline, its underside at a's top)? (as moveObject reads it)
  function standsOn(x,a){
    const xy=pt(x&&x.xy), from=pt(a&&a.xy), xs=arr(x&&x.size).map(Number), size=arr(a&&a.size).map(Number); if(!xy||!from||x===a||xs.length!==3||size.length!==3) return false;
    const top=Number(a.z)+(size[2]||0)/2; if(!Number.isFinite(top)) return false;
    const t=(Number(a.facing)||0)*Math.PI/180, cs=Math.cos(t), sn=Math.sin(t), dx=xy[0]-from[0], dy=xy[1]-from[1], lx=dx*cs-dy*sn, ly=dx*sn+dy*cs;
    return Math.abs(lx)<=size[0]/2+0.02&&Math.abs(ly)<=size[1]/2+0.02&&Math.abs(Number(x.z)-xs[2]/2-top)<=0.15;
  }
  // the plan with wall E0 of room sp0 moved by s → {ok:true, plan} or {ok:false, why}
  function wallAt(base,sp0,E0,s){
    const next=clone(base), sp=spacesOf(next).find(x=>String(x.id)===String(sp0.id)), old=polyOf(sp0), poly=old.map(p=>p.slice()), N=poly.length, e=E0.i, n=E0.n;
    const iP=(e-1+N)%N, iN=(e+1)%N, iNN=(e+2)%N, room=String(sp0.name||"the room");
    // each end slides along the wall beside it, so that wall keeps its line
    const end=(P,from)=>{ const d=sub(P,from), k=dot(d,n); return Math.abs(k)<1e-9?[P[0]+n[0]*s,P[1]+n[1]*s]:[P[0]+d[0]*s/k,P[1]+d[1]*s/k]; };
    poly[e]=end(old[e],old[iP]).map(r3); poly[iN]=end(old[iN],old[iNN]).map(r3);
    for(const i of [iP,e,iN]){ const v0=sub(old[(i+1)%N],old[i]), v1=sub(poly[(i+1)%N],poly[i]);
      if(dot(v0,v1)<=0||Math.hypot(v1[0],v1[1])<Math.min(MIN_WALL,Math.hypot(v0[0],v0[1]))-1e-6) return {ok:false,why:"A wall of "+room+" would become shorter than "+metres(MIN_WALL)+"."}; }
    if(area2(old)*area2(poly)<=0||Math.abs(area2(poly))<0.5||!simple(poly)) return {ok:false,why:"The walls of "+room+" would cross."};
    sp.footprint=poly; sp.basis="user";
    const by=[n[0]*s,n[1]*s], after=edgesOf(sp), before=edgesOf(sp0);
    // its doors and windows go with it; every door and window of the three walls keeps the room it needs
    const opens0=arr(sp0.openings), opens=arr(sp.openings), gone=[];
    for(let j=0;j<opens0.length;j++){
      const o0=opens0[j], o=opens[j], c=pt(o0&&o0.centre), w=Number(o0&&o0.width), run=o0&&runOf(sp0,o0); if(!c||!(w>0)||!run) continue;
      if(run.inner){
        let now=null; try{ now=root.locationInnerWall(sp,o); }catch(_){ now=null; }
        const L0=Math.hypot(run.b[0]-run.a[0],run.b[1]-run.a[1]), t0=Math.hypot(c[0]-run.a[0],c[1]-run.a[1]), need=Math.min(GAP,t0-w/2,L0-t0-w/2);
        if(!now||!(now.at-w/2>=need-1e-6)||!(now.length-now.at-w/2>=need-1e-6)) return {ok:false,why:(o0.name||"A doorway")+" stands in a wall of its own inside "+room+": this wall cannot come that close to it."};
        continue;
      }
      if([iP,e,iN].indexOf(run.edge)<0) continue;
      const B=before[run.edge], A=after[run.edge], x0=dot(sub(c,B.a),B.u), need=Math.min(GAP,x0-w/2,B.L-x0-w/2);
      const at=run.edge===e?[r3(c[0]+by[0]),r3(c[1]+by[1])]:c, x=dot(sub(at,A.a),A.u);
      if(!(x-w/2>=need-1e-6)||!(A.L-x-w/2>=need-1e-6)) return {ok:false,why:(o0.name||"A door or window")+" needs its wall: the corner cannot come closer to it."};
      if(run.edge===e){ o.centre=at; o.basis="user"; gone.push({c,w,id:String(o0.id)}); }
    }
    // the things of the plan: with the wall, ahead of it, or left where they are
    const list=objects(base), all=arr(next.anchors), was=arr(base.anchors), delta=new Map();
    all.forEach((a,k)=>{ const xy=pt(a&&a.xy), info=xy&&list.find(x=>x.id===String(a.id)); if(!info) return;
      if(info.door){ if(gone.some(g=>g.id===String(a.id)||Math.hypot(g.c[0]-xy[0],g.c[1]-xy[1])<0.12)) delta.set(k,by); return; }
      const mine=info.spaceId===String(sp0.id); if(!mine&&inside(xy,old)) return;
      const t=-info.facing*Math.PI/180, h=(info.size[0]/2)*Math.abs(Math.cos(t)*n[0]+Math.sin(t)*n[1])+(info.size[1]/2)*Math.abs(-Math.sin(t)*n[0]+Math.cos(t)*n[1]);
      /* AGAINST THIS WALL means this wall is the one it stands at: a shelf on the east wall whose end is near the
         north wall hangs on the east wall, and stays when the north wall moves (it is pushed if that wall comes in). */
      const half=E=>(info.size[0]/2)*Math.abs(Math.cos(t)*E.n[0]+Math.sin(t)*E.n[1])+(info.size[1]/2)*Math.abs(-Math.sin(t)*E.n[0]+Math.cos(t)*E.n[1]);
      const gap=E=>{ const along=dot(sub(xy,E.a),E.u); return along<-0.05||along>E.L+0.05?Infinity:Math.abs(dot(sub(E.a,xy),E.n))-half(E); };
      const nearest=mine?Math.min(...before.map(gap)):Infinity, own=gap(E0);
      const d=taken(xy,E0,s,mine,h,mine&&own>nearest+0.03?-Infinity:AGAINST,0); if(d) delta.set(k,d); });
    // what stands on a thing that goes, goes with it (a kettle on a worktop; and what stands on that)
    for(let turn=0;turn<2;turn++) all.forEach((x,k)=>{ if(delta.has(k)||!pt(x&&x.xy)) return;
      for(const [j,d] of Array.from(delta)){ if(standsOn(was[k],was[j])){ delta.set(k,d); break; } } });
    for(const [k,d] of delta){ const a=all[k], xy=pt(a.xy); a.xy=[r2(xy[0]+d[0]),r2(xy[1]+d[1])]; a.posBasis="user"; }
    // nothing is left outside its room that was inside it
    for(let k=0;k<all.length;k++){ const a=all[k], xy0=pt(was[k]&&was[k].xy), xy=pt(a&&a.xy), info=xy0&&list.find(x=>x.id===String(a.id)); if(!info||info.door) continue;
      const home0=spacesOf(base).find(x=>String(x.id)===info.spaceId), home=spacesOf(next).find(x=>String(x.id)===info.spaceId); if(!home0||!home) continue;
      // (inside means clear of the outline too: a thing pushed onto the far wall's line has no room left. A thing
      //  that hangs at the outline, a calendar 1 cm from its wall, may stay as near as it was)
      const P0=polyOf(home0), P1=polyOf(home);
      if(inside(xy0,P0)&&!(inside(xy,P1)&&polyDist(xy,P1)>=Math.min(0.02,polyDist(xy0,P0))-1e-9)) return {ok:false,why:"There is no room left for "+info.name+"."}; }
    // the floor plan's own cameras
    arr(obj(next.coordinates).cameras).forEach(c=>{ const p=arr(c&&c.position).map(Number); if(p.length<2||!Number.isFinite(p[0])||!Number.isFinite(p[1])) return;
      const xy=[p[0],p[1]], mine=String(c.spaceId)===String(sp0.id); if(!mine&&inside(xy,old)) return;
      const d=taken(xy,E0,s,mine,0,CAM_RIDE,CAM_CLEAR); if(!d) return;
      // (a camera is never moved out of its own room: one that would be is left where it stands, for its card to flag)
      const home0=spacesOf(base).find(x=>String(x.id)===String(c.spaceId)), home=spacesOf(next).find(x=>String(x.id)===String(c.spaceId));
      const q=[r2(xy[0]+d[0]),r2(xy[1]+d[1])]; if(home0&&home&&inside(xy,polyOf(home0))&&!inside(q,polyOf(home))) return;
      c.position=[q[0],q[1]].concat(p.slice(2)); });
    // the other rooms: none run into, none left, none cut
    for(const t0 of spacesOf(base)){ if(String(t0.id)===String(sp0.id)) continue;
      const T=polyOf(t0), how=lie(old,T), name=String(t0.name||"another room");
      if(how==="in"&&!poly.every(p=>within(p,T))) return {ok:false,why:room+" has to stay inside "+name+"."};
      if(how==="holds"&&!T.every(p=>within(p,poly))) return {ok:false,why:name+" stands in "+room+" and has to stay inside it."};
      if(how==="apart"&&overlap(poly,T)) return {ok:false,why:room+" would run into "+name+"."}; }
    // the sentences: what moved, and what was already placed by hand in this room (its distances to the walls changed)
    all.forEach((a,k)=>{ if(!pt(a&&a.xy)) return; const info=list.find(x=>x.id===String(a.id)); if(!info||info.door) return;
      if(delta.has(k)||(info.spaceId===String(sp0.id)&&a.posBasis==="user"&&/Placed by hand on the floor plan\.$/.test(String(a.placement||"")))) a.placement=placementOf(next,a.id); });
    return {ok:true,plan:next};
  }
  function slideWall(plan,spaceId,edge,to){
    const base=obj(plan), sp=spacesOf(base).find(s=>String(s.id)===String(spaceId)), E=sp&&edgesOf(sp)[edge], want=pt(to);
    if(!sp||!E||!want) return {plan,why:""};
    const lock=lockOf(base,sp,edge); if(lock) return {plan,why:lock};
    const s0=Math.max(-FAR,Math.min(FAR,snap(dot(sub(want,E.a),E.n)))); if(Math.abs(s0)<1e-9) return {plan,why:""};
    let why="";
    for(let s=s0;Math.abs(s)>1e-9;s=r2(s-Math.sign(s0)*SNAP)){ const r=wallAt(base,sp,E,s); if(r.ok) return {plan:r.plan,why}; why=r.why; }   // (why = what stopped it right where it stands)
    return {plan,why};
  }
  const moveWall=(plan,spaceId,edge,to)=>slideWall(plan,spaceId,edge,to).plan;

  /* WHAT IS NOT IN THE PLAN FOLLOWS THE WALLS TOO: a camera set by hand, a scene's mark, a piece of the set's
     dressing. carry(before, after) reads which walls moved and by how much; point(p, {space, ride, clear}) gives a
     point's new place (p may carry a height: it is kept). space = the room the point belongs to (else the smallest
     room that held it); ride = how near a wall it must have stood to go with it; clear = how far a wall that reaches
     it keeps it. A point nothing touched comes back as it was (the same array). */
  function carry(before,after){
    const edges=[];
    spacesOf(before).forEach(s0=>{ const s1=spacesOf(after).find(x=>String(x.id)===String(s0.id)); if(!s1) return;
      const A=edgesOf(s0), B=edgesOf(s1); if(A.length!==B.length) return;
      A.forEach((E,i)=>{ const s=dot(sub(B[i].a,E.a),E.n), t=dot(sub(B[i].b,E.a),E.n); if(Math.abs(s)>1e-6&&Math.abs(s-t)<1e-3) edges.push({spaceId:String(s0.id),poly:polyOf(s0),E,s:r3(s)}); }); });
    const area=poly=>Math.abs(area2(poly));
    function point(p,opts){
      const v=arr(p).map(Number), o=obj(opts); if(v.length<2||!Number.isFinite(v[0])||!Number.isFinite(v[1])||!edges.length) return p;
      const xy=[v[0],v[1]], ride=Number(o.ride)||0, clear=Number(o.clear)||0;
      const home=o.space!=null&&o.space!==""?String(o.space):(spacesOf(before).filter(s=>inside(xy,polyOf(s))).sort((x,y)=>area(polyOf(x))-area(polyOf(y)))[0]||{}).id;
      let dx=0, dy=0;
      edges.forEach(g=>{ const mine=String(home)===g.spaceId; if(!mine&&inside(xy,g.poly)) return;
        const d=taken(xy,g.E,g.s,mine,0,ride,clear); if(d){ dx+=d[0]; dy+=d[1]; } });
      if(Math.abs(dx)<1e-9&&Math.abs(dy)<1e-9) return p;
      return [r2(xy[0]+dx),r2(xy[1]+dy)].concat(v.slice(2));
    }
    return {any:edges.length>0,edges:edges.map(g=>({spaceId:g.spaceId,edge:g.E.i,by:g.s})),point};
  }
  const changed=(before,after)=>moves(before,after).length+carry(before,after).edges.length;

  /* WHAT A SAVE WRITES BESIDE THE PLAN WHEN A WALL MOVED, worked out here so that it can be read before anything is
     saved (and tested): nothing in these two saves anything.
     follow(C, locations, spaces, ownerId, base, moved) → {patches:{locationId:{coverageViews?, previs?}}, cameras, pieces}:
       each card of the place whose cameras set by hand (coverageViews[].pose.position) or whose set dressing
       (previs.extras[].at, previs.light.lamps[].at) has to follow. A camera goes with a wall it stood within 60 cm
       of and is kept 30 cm clear of one that reaches it. A piece of dressing that stands ON a thing that moved (the
       clutter on a worktop, the mugs on a shelf: inside the thing's outline, at its top) goes with that thing, with
       or without a wall (base = the plan before, moved = moves()); else it goes with a wall it stood within 30 cm
       of (a picture rail, a radiator), and a wall that passes one pushes it ahead.
     sceneMoves(scenePlans, spaces, moved, C, shots, keyOf) → {next:{sceneId:plan}, count}: the planned scenes of
       these places: a mark beside a thing that moved goes with it (moved = moves()); with C, every other mark is
       kept 25 cm inside the room and each shot camera 30 cm (the cameras of the shots staged in these places; all of
       them when the scene has no other place). */
  function follow(C,locations,spaces,ownerId,base,moved){
    const out={patches:{},cameras:0,pieces:0}, ids=arr(spaces).map(String);
    const wallsMoved=C&&C.any&&typeof C.point==="function"?C:null;
    // the things that moved, as they stood before: outline, top, and how far each went
    const gone=arr(moved).map(m=>{ const a=arr(obj(base).anchors).find(x=>x&&String(x.id)===String(m&&m.id)), xy=pt(a&&a.xy), size=arr(a&&a.size).map(Number);
      return xy&&size.length===3&&Array.isArray(m.by)?{xy,size,top:Number(a.z)+size[2]/2,t:(Number(a.facing)||0)*Math.PI/180,by:m.by}:null; }).filter(Boolean)
      .sort((x,y)=>x.size[0]*x.size[1]-y.size[0]*y.size[1]);
    const onThing=v=>gone.find(g=>{ const dx=v[0]-g.xy[0], dy=v[1]-g.xy[1], cs=Math.cos(g.t), sn=Math.sin(g.t), lx=dx*cs-dy*sn, ly=dx*sn+dy*cs, z=Number(v[2]);
      return Math.abs(lx)<=g.size[0]/2+0.05&&Math.abs(ly)<=g.size[1]/2+0.05&&Number.isFinite(z)&&Number.isFinite(g.top)&&z>=g.top-0.15&&z<=g.top+0.5; });
    if(!wallsMoved&&!gone.length) return out;
    arr(locations).forEach(L=>{
      if(!L||(ids.indexOf(String(L.id))<0&&String(L.id)!==String(ownerId))) return;
      const space=ids.indexOf(String(L.id))>=0?String(L.id):"", patch={};
      if(wallsMoved&&Array.isArray(L.coverageViews)){ let n=0;
        const views=L.coverageViews.map(v=>{ const pos=v&&v.pose&&v.pose.position; if(!Array.isArray(pos)) return v;
          const q=C.point(pos,{space,ride:CAM_RIDE,clear:CAM_CLEAR}); if(q===pos) return v; n++; return {...v,pose:{...v.pose,position:q}}; });
        if(n){ patch.coverageViews=views; out.cameras+=n; } }
      const pv=L.previs;
      if(pv&&typeof pv==="object"&&pv.v===1){ let n=0;
        const at=(x,o)=>{ if(!x||!Array.isArray(x.at)) return x; const v=x.at.map(Number), g=v.length>=3?onThing(v):null;
          if(g){ n++; return {...x,at:[r2(v[0]+g.by[0]),r2(v[1]+g.by[1])].concat(v.slice(2))}; }
          if(!wallsMoved) return x;
          const q=wallsMoved.point(x.at,o); if(q===x.at) return x; n++; return {...x,at:q}; };
        const extras=Array.isArray(pv.extras)?pv.extras.map(x=>at(x,{ride:0.3,clear:0})):pv.extras;
        const lamps=pv.light&&Array.isArray(pv.light.lamps)?pv.light.lamps.map(x=>at(x,{ride:0.3,clear:0.2})):null;
        if(n){ patch.previs={...pv,extras,...(lamps?{light:{...pv.light,lamps}}:{})}; out.pieces+=n; } }
      if(Object.keys(patch).length) out.patches[String(L.id)]=patch; });
    return out;
  }
  function sceneMoves(scenePlans,spaces,moved,C,shots,keyOf){
    const ids=arr(spaces).map(String), by={}; arr(moved).forEach(m=>{ if(m&&m.id&&Array.isArray(m.by)) by[String(m.id)]=m.by; });
    const wallsMoved=C&&C.any&&typeof C.point==="function"?C:null, plans=obj(scenePlans), next={}; let count=0;
    Object.keys(plans).forEach(sceneId=>{ const plan=plans[sceneId]; if(!plan||!Array.isArray(plan.marks)) return;
      const here=arr(plan.sets).filter(x=>x&&ids.indexOf(String(x.locationId))>=0), sets=here.map(x=>String(x.id)); if(!sets.length) return;
      const roomOf=id=>{ const x=here.find(q=>String(q.id)===String(id)); return x?String(x.locationId):""; };
      let hit=false;
      const marks=plan.marks.map(m=>{ if(!m||sets.indexOf(String(m.set||""))<0||!Array.isArray(m.xy)||m.xy.length!==2) return m;
        const d=by[String(m.near||"")];
        if(d){ hit=true; count++; return {...m,xy:[r3(Number(m.xy[0])+d[0]),r3(Number(m.xy[1])+d[1])]}; }
        if(!wallsMoved) return m;
        const q=wallsMoved.point(m.xy,{space:roomOf(m.set),clear:0.25}); if(q===m.xy) return m;
        hit=true; count++; return {...m,xy:q}; });
      let cameras=plan.cameras;
      if(wallsMoved&&cameras&&typeof cameras==="object"&&!Array.isArray(cameras)){
        const all=arr(plan.sets).length===sets.length;
        const keys=all?null:arr(shots).filter(sh=>sh&&sh.sceneId===sceneId&&sets.indexOf(String(sh.planSet||""))>=0&&typeof keyOf==="function").map(sh=>String(keyOf(sh)));
        const out={}; let any=false;
        Object.keys(cameras).forEach(k=>{ const c=cameras[k];
          if(!c||!Array.isArray(c.at)||c.at.length!==2||(keys&&keys.indexOf(String(k))<0)){ out[k]=c; return; }
          const q=wallsMoved.point(c.at,{clear:CAM_CLEAR}); if(q===c.at){ out[k]=c; return; }
          any=true; count++; out[k]={...c,at:q}; });
        if(any){ cameras=out; hit=true; } }
      if(hit) next[sceneId]={...plan,marks,...(cameras!==plan.cameras?{cameras}:{})}; });
    return {next,count};
  }

  /* THE CHANGE, READY TO BE SAVED (the same road as Floor plan's own Confirm, locations-ui.jsx): the edited plan as a
     confirmed one, checked exactly as a confirm checks it, against the plan as it is saved NOW. Nothing is saved
     here. place = the card's location; base = the plan the edit started from; edited = the plan as moved;
     locations = the film's locations. Uses the app's own readers (locations.jsx, blender-render.js).
     → {ok:true, same:true} nothing moved · {ok:true, ownerId, plan, moved, spaces:[ids]} · {ok:false, error} */
  function commit(place,base,edited,locations){
    try{
      const state=root.locationSpatialPlanState, norm=root.normalizeLocationSpatialPlan;
      if(typeof state!=="function"||typeof norm!=="function") return {ok:false,error:"The floor plan reader did not load. Refresh this page."};
      const first=state(place), list=arr(locations), live=list.find(x=>x&&first&&first.owner&&x.id===first.owner.id)||(first&&first.owner);
      const now=state(live);
      if(JSON.stringify(now.plan)!==JSON.stringify(base)) return {ok:false,error:"The floor plan was changed elsewhere while you were moving things. Cancel and start again; nothing was overwritten."};
      const moved=moves(base,edited), wallsMoved=carry(base,edited).edges;
      if(!moved.length&&!wallsMoved.length) return {ok:true,same:true};
      /* CONFIRMED AGAINST THE IMAGE AS IT IS NOW, exactly as Floor plan's own Confirm stamps it (source = the
         location image's id and date). A plan whose image was made FROM it counts as current only while it is
         unchanged (locations.jsx: the image records the plan's signature); once a thing has moved, the signature no
         longer matches, and without today's stamp the plan reads "the parent image changed" and cannot be saved.
         (2026-11-25: the stamp was taken out for a few hours as "a field nobody touched", and Save then refused on
         every place that has a location image. It belongs here.) */
      const reviewed=norm({...edited,status:"reviewed",source:now.source});
      const checked=state({...now.owner,spatialPlan:reviewed});
      if(!checked.ready) return {ok:false,error:checked.reason||"The floor plan cannot be confirmed with this change."};
      const R=root.KinolotCloudRender;
      if(R&&typeof R.inputIssueList==="function"&&(typeof R.enabled!=="function"||R.enabled())){
        const next=list.map(x=>x&&x.id===now.owner.id?{...x,spatialPlan:reviewed}:x);
        const issues=arr(R.inputIssueList(place.id===now.owner.id?{...place,spatialPlan:reviewed}:place,next)).filter(i=>i&&i.step===2);
        if(issues.length) return {ok:false,error:issues[0].text||"The floor plan needs a measurement before it can be saved."};
      }
      return {ok:true,ownerId:now.owner.id,plan:reviewed,moved,walls:wallsMoved,spaces:spacesOf(reviewed).map(x=>String(x.id))};
    }catch(e){ return {ok:false,error:(e&&e.message)||"The floor plan could not be saved. Nothing was changed."}; }
  }

  root.KinolotPlanDrag={SNAP,objects,openings,spaceOf,runOf,wallOf,edgesOf,moveObject,moveOpening,walls,slideWall,moveWall,carry,changed,follow,sceneMoves,roomText,moves,placementOf,where,byHand,commit};
})(typeof window!=="undefined"?window:globalThis);
