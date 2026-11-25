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
  // the wall nearest a point: which side of the room it is, and how far
  function wallOf(space,p){
    const poly=arr(obj(space).footprint); if(poly.length<3) return null;
    const cx=poly.reduce((n,q)=>n+q[0],0)/poly.length, cy=poly.reduce((n,q)=>n+q[1],0)/poly.length;
    let best=null;
    for(let i=0;i<poly.length;i++){ const a=poly[i], b=poly[(i+1)%poly.length], d=segDist(p,a,b);
      if(!best||d<best.d-1e-9){ const mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2; let nx=-(b[1]-a[1]), ny=b[0]-a[0];
        if(nx*(mx-cx)+ny*(my-cy)<0){ nx=-nx; ny=-ny; }
        best={d,side:Math.abs(nx)>=Math.abs(ny)?(nx>0?"east":"west"):(ny>0?"north":"south"),edge:i}; } }
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
    return doors.map(o=>({id:o.id,name:o.name,kind:"opening",text:openingText(plan,o),byHand:o.byHand}))
      .concat(objects(plan).filter(x=>!x.door).map(x=>({id:x.id,name:x.name,kind:"object",byHand:x.byHand,
        text:placementOf(plan,x.id).replace(/ ?Placed by hand on the floor plan\.$/,"")})));
  }
  const byHand=plan=>where(plan).filter(x=>x.byHand).length;

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
      const moved=moves(base,edited);
      if(!moved.length) return {ok:true,same:true};
      /* THE PLAN KEEPS ITS OWN SOURCE: a move by hand is no new reading of the image, so only what moved changes
         (found on the first real save, 2026-11-25: stamping the image's date changed a field nobody touched). */
      const reviewed=norm({...edited,status:"reviewed"});
      const checked=state({...now.owner,spatialPlan:reviewed});
      if(!checked.ready) return {ok:false,error:checked.reason||"The floor plan cannot be confirmed with this change."};
      const R=root.KinolotCloudRender;
      if(R&&typeof R.inputIssueList==="function"&&(typeof R.enabled!=="function"||R.enabled())){
        const next=list.map(x=>x&&x.id===now.owner.id?{...x,spatialPlan:reviewed}:x);
        const issues=arr(R.inputIssueList(place.id===now.owner.id?{...place,spatialPlan:reviewed}:place,next)).filter(i=>i&&i.step===2);
        if(issues.length) return {ok:false,error:issues[0].text||"The floor plan needs a measurement before it can be saved."};
      }
      return {ok:true,ownerId:now.owner.id,plan:reviewed,moved,spaces:spacesOf(reviewed).map(x=>String(x.id))};
    }catch(e){ return {ok:false,error:(e&&e.message)||"The floor plan could not be saved. Nothing was changed."}; }
  }

  root.KinolotPlanDrag={SNAP,objects,openings,spaceOf,runOf,wallOf,moveObject,moveOpening,moves,placementOf,where,byHand,commit};
})(typeof window!=="undefined"?window:globalThis);
