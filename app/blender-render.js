/* Cloud set previews use one explicit metric scene. No model infers positions here. */
(function(root){
  "use strict";
  const C=()=>root.KinolotRenderContract;
  const requestCache=new Map();
  const local=()=>!!root.location&&["localhost","127.0.0.1","::1"].includes(root.location.hostname);
  // Build the set (owner 2026-11-05): open to paying plans when the app's config says so (supabase-config.js setBuild) —
  // the Art Room itself is Director's, and the server decides who builds and charges it; otherwise the owner-only pilot
  function enabled(){return (root.TURN_SUPABASE||{}).setBuild===true||local()&&root.turnIsAdmin===true;}
  const detailedEnabled=()=>root.TURN_SUPABASE?.setBuildMcp===true;
  const tidy=(s,max=160)=>String(s||"").replace(/[\u0000-\u001f]/g," ").trim().slice(0,max);
  const finite=(n)=>typeof n==="number"&&Number.isFinite(n);
  function savedOpening(anchor,space){
    return (space?.openings||[]).find(o=>o.id===anchor.id||tidy(o.name).toLowerCase()===tidy(anchor.name).toLowerCase());
  }
  /* A NAMED DOORWAY BEYOND THE OUTLINE (2026-11-21, a paid run on the street "Hussain Terrace"). The floor plan draft
     of a street listed "Kitchen doorway at far end of hall": a door 6 m inside the house, glimpsed through the front
     door. It is an opening by its name, it has no opening on the street's own outline and it never can have one, so the
     plan was refused ("Add ... to its room's floor-plan openings") and the free fixes found nothing: a dead end on a
     brand-new place. An opening-named object with no saved opening that stands more than half a metre OUTSIDE its
     space's outline belongs to a space this plan does not hold: it is not asked for and not built (the set says so). */
  function beyondOutline(anchor,space){
    const p=anchor&&anchor.xy,fp=space&&space.footprint;
    if(!Array.isArray(p)||!finite(p[0])||!finite(p[1])||!Array.isArray(fp)||fp.length<3)return false;
    let inside=false,near=Infinity;
    for(let i=0,j=fp.length-1;i<fp.length;j=i++){
      const a=fp[i],b=fp[j];
      if(!Array.isArray(a)||!Array.isArray(b))return false;
      if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
      near=Math.min(near,segDist(p[0],p[1],a,b));
    }
    return !inside&&near>0.5;
  }
  function isOpening(anchor,space){
    // Explicit floor-plan apertures are authoritative even when their descriptive names are ambiguous.
    const opening=savedOpening(anchor,space);
    return root.locationAnchorIsOpening(anchor)||!!opening&&["window","glass","door","arch"].includes(opening.kind);
  }
  // INNER WALLS (2026-11-17, locations.jsx locationInnerWall): an opening that stands inside its room's outline stands in
  // a wall of its own, straight across the room. Its solid stretches are walls to cameras as the outline's are.
  const innerWallOf=(space,opening)=>typeof root.locationInnerWall==="function"?root.locationInnerWall(space,opening):null;
  const innerSolids=space=>typeof root.locationInnerWallSolids==="function"?root.locationInnerWallSolids(space):[];
  const segDist=(x,y,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1e-9)));
    return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);};
  const segCross=(p,q,a,b)=>{const o=(u,v,w)=>(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
    return o(p,q,a)*o(p,q,b)<0&&o(a,b,p)*o(a,b,q)<0;};
  // Saved heights are read through the floor plan's conventions (locations.jsx), never rewritten.
  function renderSpaces(plan){
    return (plan.coordinates?.spaces||[]).map(s=>({...s,openings:(s.openings||[]).map(o=>root.locationOpeningHeights(o,s,plan))}));
  }
  // An object's centre height in the preview, read through the floor plan's height conventions.
  function anchorCentreZ(anchor,sp,plan){
    const h=anchor.size[2];
    if(!finite(anchor.z))return {z:sp.floorZ+h/2,missing:true};
    if(root.locationAnchorHeightBasis(anchor,plan)!=="base")return {z:anchor.z};
    // An older plan's base height: the object stands on it, and never rises through its room's ceiling.
    let z=anchor.z+h/2;
    if(!sp.openSky&&finite(sp.ceilingH))z=Math.max(sp.floorZ+h/2,Math.min(z,sp.floorZ+sp.ceilingH-h/2));
    return {z,base:true};
  }
  // Each camera must stand inside its own room, clear of the walls (0.15 m thick, centred on the footprint edge),
  // between floor and ceiling, and outside every object, or the frame shows the inside of a wall or a box.
  const CAMERA_WALL_CLEARANCE=0.25;
  // Per camera: what is wrong with where it stands (no entry = fine). Step Cameras shows these beside each camera.
  function cameraProblemsIn(location,list,plan,spaces,family,owner,proposed){
    // Only a location with its own room on the floor plan places cameras in it (a whole location's plate doesn't).
    const out={},poses=proposed||root.locationPanelPoses(location,list);
    const sp=spaces.find(s=>s.id===location.id);if(!sp||!(sp.footprint||[]).length)return out;
    for(const p of poses)if(!p.pose.position)out[p.key]="It has no position yet.";
    let poly;try{poly=C().polygon(sp.footprint);}catch(_){return out;}
    const room=sp.name||location.name||"this room";
    const inside=(x,y)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
      if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
    const inner=innerSolids(sp);
    const wall=(x,y)=>Math.min(...poly.map((a,i)=>{const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);}),
      ...inner.map(seg=>segDist(x,y,seg[0],seg[1])));
    const objects=plan.anchors.filter(a=>a.xy&&a.size&&(root.locationAnchorSpaceOf(a,family)||owner).id===sp.id&&!isOpening(a,sp));
    for(const p of poses){
      const pos=p.pose.position;if(!pos)continue;
      const [x,y,z]=pos;
      if(!inside(x,y)){out[p.key]="It stands outside "+room+". Move it inside the room.";continue;}
      if(wall(x,y)<CAMERA_WALL_CLEARANCE){out[p.key]="It is within "+Math.round(CAMERA_WALL_CLEARANCE*100)+" cm of a wall of "+room+", so it sees the inside of the wall. Move it further into the room.";continue;}
      if(z<sp.floorZ+0.2||(!sp.openSky&&finite(sp.ceilingH)&&z>sp.floorZ+sp.ceilingH-0.1)){out[p.key]="It is not between the floor and the ceiling of "+room+". Check its height.";continue;}
      const hit=objects.find(a=>{const r=-(a.facing||0)*Math.PI/180,dx=x-a.xy[0],dy=y-a.xy[1];
        const u=dx*Math.cos(r)+dy*Math.sin(r),v=-dx*Math.sin(r)+dy*Math.cos(r),cz=anchorCentreZ(a,sp,plan).z;
        return Math.abs(u)<a.size[0]/2&&Math.abs(v)<a.size[1]/2&&Math.abs(z-cz)<a.size[2]/2;});
      if(hit)out[p.key]="It stands inside "+tidy(hit.name,80)+". Move it clear of the object.";
    }
    return out;
  }
  function cameraProblems(location,list,proposed){
    list=list||((root.turnContinuity||{}).locations)||[];
    const state=root.locationSpatialPlanState(location,list);if(!state.ready)return {};
    const spaces=renderSpaces(state.plan);
    return cameraProblemsIn(location,list,state.plan,spaces,root.locationSpatialFamily(state.owner,list),state.owner,proposed);
  }
  function cameraProposalKey(location,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    const state=root.locationSpatialPlanState(location,list);
    return C().canonical({locationId:location.id,plan:state.plan,views:location.coverageViews||[],brief:{name:location.name||"",architecture:location.architecture||"",keySizes:location.keySizes||""},
      family:root.locationSpatialFamily(state.owner,list).map(l=>({id:l.id,name:l.name})),
      epoch:typeof root.nbEpoch==="function"?root.nbEpoch():0});
  }
  // Bounded, deterministic placement. This creates a proposal only; the card explicitly applies it later.
  function proposeCameras(location,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    const state=root.locationSpatialPlanState(location,list);
    if(!state.ready)throw Error(state.reason||"Review the floor plan first.");
    const {owner,plan}=state,spaces=renderSpaces(plan),sp=spaces.find(s=>s.id===location.id);
    if(!sp)throw Error("Add this room's footprint in Floor plan first.");
    const poly=C().polygon(sp.footprint),family=root.locationSpatialFamily(owner,list);
    if(!sp.openSky&&!finite(sp.ceilingH))throw Error("Set this room's ceiling height in Floor plan first.");
    const xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,d=Math.max(...ys)-y0;
    const inside=(x,y)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
    const rounded=n=>Math.round(n*100)/100;
    const clampHeight=h=>sp.floorZ+(sp.openSky?Math.min(6,h):Math.max(.25,Math.min(sp.ceilingH-.25,h)));
    const eye=clampHeight(1.6);
    const seeds=[];
    for(let i=1;i<20;i++)for(let j=1;j<20;j++)seeds.push([x0+w*i/20,y0+d*j/20]);
    // Edge samples also find narrow arms of a concave footprint that a coarse box grid could miss.
    poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      for(const t of [.2,.5,.8])for(const inset of [.35,.75])for(const sign of [-1,1])
        seeds.push([a[0]+dx*t-sign*dy/len*inset,a[1]+dy*t+sign*dx/len*inset]);});
    const used=[],panels=[],spacing=Math.min(.6,Math.max(.15,Math.min(w,d)*.15));
    const keys=["TL","TR","BL","BR"],centre=[x0+w/2,y0+d/2];
    const roomAnchors=plan.anchors.filter(a=>a.xy&&a.size&&!isOpening(a,sp)&&(root.locationAnchorSpaceOf(a,family)||owner).id===sp.id);
    // A linear vehicle needs aisle coverage from both ends and a clear view beside the driver.
    const busBench=roomAnchors.find(a=>/bench-L\d+$/i.test(a.id)||/\b(?:west|left)\b.*\brow\s*\d+/i.test(a.name)),busDriver=roomAnchors.find(a=>/\bdriver\b/i.test(a.name)&&/\bdash\b/i.test(a.name));
    if(/\bbus\b/i.test(location.name||"")&&busBench&&busDriver&&Math.max(w,d)>Math.min(w,d)*2){
      const angle=(busBench.facing||0)*Math.PI/180,forward=[Math.sin(angle),Math.cos(angle)],right=[forward[1],-forward[0]];
      const dot=(p,v)=>(p[0]-centre[0])*v[0]+(p[1]-centre[1])*v[1],ends=poly.map(p=>dot(p,forward));
      const across=-Math.sign(dot(busDriver.xy,right)||-1)*Math.min(.45,Math.min(w,d)*.2);
      const station=(t,c,z)=>[centre[0]+forward[0]*t+right[0]*c,centre[1]+forward[1]*t+right[1]*c,clampHeight(z)].map(rounded);
      const aim=(at,point,lensMm,target)=>root.normalizeLocationCameraPose({position:at,yaw:Math.atan2(point[0]-at[0],point[1]-at[1])*180/Math.PI,pitch:Math.atan2(point[2]-at[2],Math.hypot(point[0]-at[0],point[1]-at[1]))*180/Math.PI,lensMm,target,basis:"design"});
      const front=(sp.openings||[]).find(o=>/windshield/i.test(o.name||o.id)),rear=(sp.openings||[]).find(o=>/rear|emergency/i.test(o.name||o.id));
      const a=station(Math.min(...ends)+.55,0,1.5),b=station(Math.max(...ends)-Math.max(1.25,busDriver.size[1]),0,1.5);
      const c=station(dot(busBench.xy,forward)-.9,across,1.25),e=station(dot(busDriver.xy,forward)-1.5,across,1.5);
      const options=[
        {key:"TL",role:"wide",label:"Front along the aisle",pose:{position:a,yaw:(busBench.facing||0),pitch:-7,lensMm:24,target:front?.id||busDriver.id,basis:"design"}},
        {key:"TR",role:"reverse",label:"Rear along the aisle",pose:{position:b,yaw:((busBench.facing||0)+180)%360,pitch:-7,lensMm:24,target:rear?.id||busBench.id,basis:"design"}},
        {key:"BL",role:"detail",label:"Bench detail",pose:aim(c,[busBench.xy[0]-forward[0]*busBench.size[1]*.4,busBench.xy[1]-forward[1]*busBench.size[1]*.4,anchorCentreZ(busBench,sp,plan).z+busBench.size[2]*.28],28,busBench.id)},
        {key:"BR",role:"detail",label:"Driver controls",pose:aim(e,[front?.centre?.[0]??busDriver.xy[0]+forward[0]*busDriver.size[1]*.4,front?.centre?.[1]??busDriver.xy[1]+forward[1]*busDriver.size[1]*.4,anchorCentreZ(busDriver,sp,plan).z+busDriver.size[2]*.4],28,busDriver.id)}
      ];
      if(!Object.keys(cameraProblemsIn(location,list,plan,spaces,family,owner,options)).length)return {key:cameraProposalKey(location,list),panels:options,warnings:["Bus coverage: front and rear aisle views, a bench detail and the driver's controls. Review the proposed 3D views before saving; your existing cameras are unchanged."]};
    }
    const shape=a=>root.KinolotSetKitchen?.kind(a)||root.KinolotSetDetail?.anchorShape(a)||"";
    const bed=roomAnchors.filter(a=>shape(a)==="bed").sort((a,b)=>b.size[0]*b.size[1]-a.size[0]*a.size[1])[0];
    const blocked=(at,target,skip)=>roomAnchors.some(a=>{
      if(a.id===skip)return false;
      const angle=(a.facing||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),centreZ=anchorCentreZ(a,sp,plan).z;
      const local=p=>{const x=p[0]-a.xy[0],y=p[1]-a.xy[1];return [c*x-s*y,s*x+c*y,p[2]-centreZ];};
      const p=local(at),q=local(target);let lo=0,hi=1;
      for(let axis=0;axis<3;axis++){
        const delta=q[axis]-p[axis],half=a.size[axis]/2;
        if(Math.abs(delta)<1e-8){if(Math.abs(p[axis])>half)return false;continue;}
        const u=(-half-p[axis])/delta,v=(half-p[axis])/delta;
        lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));if(lo>hi)return false;
      }
      return hi>.001&&lo<.999;
    });
    const innerWalls=innerSolids(sp);
    const sight=(at,target)=>Array.from({length:19},(_,j)=>(j+1)/20)
      .every(t=>inside(at[0]+(target[0]-at[0])*t,at[1]+(target[1]-at[1])*t))
      &&!innerWalls.some(seg=>segCross(at,target,seg[0],seg[1]));
    const featureKind=a=>{
      const n=String(a.name||"");
      if(/\bsink\b/i.test(n)&&!/\b(?:counter|run|light)\b/i.test(n))return "sink";
      if(/\b(?:fridge|refrigerator)\b/i.test(n)&&!/\b(?:counter|run)\b/i.test(n))return "fridge";
      if(/\bdesk\b/i.test(n))return "desk";
      if(/\b(?:bookcase|bookshelf|shelves)\b/i.test(n))return "shelves";
      if(/\b(?:shower|bath|bathtub)\b/i.test(n))return "bath";
      return shape(a)||"object";
    };
    const priority={sink:100,bed:90,desk:80,fridge:75,wardrobe:70,shelves:65,bath:60,table:50,nightstand:35,chair:25,counter:5};
    const features=roomAnchors.map(a=>{
      const kind=featureKind(a),cz=anchorCentreZ(a,sp,plan).z;
      // A sink's centre sits inside its counter proxy. Aim above the rim instead of treating it as hidden.
      const z=["sink","desk","table","counter"].includes(kind)?cz+a.size[2]/2+.025:kind==="fridge"?cz:cz+a.size[2]*.1;
      return {anchor:a,kind,point:[...a.xy,z],rank:priority[kind]||10};
    }).filter(f=>f.anchor.size[2]>.04&&!/\b(?:light|lamp|tube|wall|floor|ceiling)\b/i.test(f.anchor.name||""))
      .sort((a,b)=>b.rank-a.rank||String(a.anchor.id).localeCompare(String(b.anchor.id)));
    const detailUses=new Set(),warnings=[];
    const landmarks=features.map(f=>({id:f.anchor.id,point:f.kind==="sink"?f.point:[...f.anchor.xy,anchorCentreZ(f.anchor,sp,plan).z]}));
    for(const o of sp.openings||[])if(Array.isArray(o.centre)&&o.centre.length===2&&o.centre.every(finite)&&finite(o.sillZ)&&finite(o.headZ))
      landmarks.push({id:o.id,point:[...o.centre,(o.sillZ+o.headZ)/2]});
    // Detail sampling stays close to its subject even in a large room with a coarse coverage grid.
    for(const f of features){
      const a=(f.anchor.facing||0)*Math.PI/180;
      for(const offset of [-70,-35,0,35,70])for(const distance of [.8,1.2,1.8,2.2]){
        const angle=a+offset*Math.PI/180;seeds.push([f.point[0]+Math.sin(angle)*distance,f.point[1]+Math.cos(angle)*distance]);
      }
    }
    const extraDetails=[];
    for(const f of features.filter(f=>f.kind==="fridge")){
      const angle=(f.anchor.facing||0)*Math.PI/180;
      for(const offset of [-35,0,35])for(const distance of [2.6,2.8,3]){
        const a=angle+offset*Math.PI/180;extraDetails.push([f.point[0]+Math.sin(a)*distance,f.point[1]+Math.cos(a)*distance]);
      }
    }
    for(let i=0;i<4;i++){
      const wide=i<2;
      const z=rounded(wide?(i===0?eye:clampHeight(1.8)):clampHeight(i===2?1.5:1.45)),seen=new Set();
      const clear=(wide?seeds:seeds.concat(extraDetails)).map(p=>[rounded(p[0]),rounded(p[1]),z]).filter(p=>{
        const k=p.join(",");if(seen.has(k)||!inside(p[0],p[1]))return false;seen.add(k);
        return !Object.keys(cameraProblemsIn(location,list,plan,spaces,family,owner,[{key:keys[i],pose:{position:p}}])).length;
      });
      let candidates=clear.filter(p=>used.every(a=>Math.hypot(a[0]-p[0],a[1]-p[1])>=spacing));
      if(!candidates.length)throw Error("There isn't enough clear space for four camera positions. Check the room footprint and object sizes in Floor plan.");
      let feature=null,preferred=[x0+Math.min(.65,Math.max(.35,w*.1)),y0+Math.min(.65,Math.max(.35,d*.1))];
      if(i===1){
        preferred=d>=w?[used[0][0],y0+d*(used[0][1]<centre[1]?.8:.2)]
          :[x0+w*(used[0][0]<centre[0]?.8:.2),used[0][1]];
        const sameSide=candidates.filter(p=>d>=w?(p[0]-centre[0])*(used[0][0]-centre[0])>=0:(p[1]-centre[1])*(used[0][1]-centre[1])>=0);
        if(sameSide.length)candidates=sameSide;
      }
      if(!wide){
        // Two different saved landmarks, with sink/fridge as the default kitchen pair.
        const ranked=[...features].sort((a,b)=>{
          const score=f=>f.rank-(detailUses.has(f.anchor.id)?1000:0)+(i===3&&f.kind==="fridge"?100:0);
          return score(b)-score(a);
        });
        for(const f of ranked){
          const visible=candidates.filter(p=>Math.hypot(p[0]-f.point[0],p[1]-f.point[1])>.45&&sight(p,f.point)&&!blocked(p,f.point,f.anchor.id));
          if(visible.length){feature=f;candidates=visible;break;}
        }
        if(feature){
          const a=feature.anchor,angle=(a.facing||0)*Math.PI/180;
          let normal=[Math.sin(angle),Math.cos(angle)];
          if(feature.kind==="fridge")normal=[Math.sin(angle+40*Math.PI/180),Math.cos(angle+40*Math.PI/180)];
          if(!finite(a.facing)){
            const dx=centre[0]-a.xy[0],dy=centre[1]-a.xy[1],length=Math.hypot(dx,dy)||1;normal=[dx/length,dy/length];
          }
          if(detailUses.has(a.id))normal=[(normal[0]+normal[1])/Math.SQRT2,(normal[1]-normal[0])/Math.SQRT2];
          const distance=feature.kind==="fridge"?2.5:feature.kind==="sink"?1.7
            :Math.max(.8,Math.min(2.2,Math.max(a.size[0],a.size[2]*.6)*1.8));
          preferred=[a.xy[0]+normal[0]*distance,a.xy[1]+normal[1]*distance];
          detailUses.add(a.id);
        }else warnings.push("A clear detail view of a saved feature could not be found for "+keys[i]+"; inspect that frame before building.");
      }
      const score=p=>{
        let penalty=0;
        if(i===0&&bed){
          const angle=(bed.facing||0)*Math.PI/180,dx=p[0]-bed.xy[0],dy=p[1]-bed.xy[1];
          const local=[Math.cos(angle)*dx-Math.sin(angle)*dy,Math.sin(angle)*dx+Math.cos(angle)*dy];
          const along=bed.size[1]>=bed.size[0]?1:0,across=1-along;
          if(local[along]<-Math.abs(local[across]))penalty=1;
          const distance=Math.hypot(...local),minimum=Math.min(Math.max(...bed.size.slice(0,2))*1.25,Math.max(w,d)*.7);
          penalty+=Math.max(0,(minimum-distance)/minimum)*2;
        }
        return ((p[0]-preferred[0])/w)**2+((p[1]-preferred[1])/d)**2+penalty;
      };
      candidates.sort((a,b)=>score(a)-score(b));let at=candidates[0],wideYaw=null;
      if(wide){
        const pitch=(i===0?-12:-18)*Math.PI/180,lens=18,options=[];
        for(const position of candidates.slice(0,64)){
          let aim=centre;
          if(!inside(...centre)||!sight(position,centre)){
            const reachable=clear.filter(p=>Math.hypot(p[0]-position[0],p[1]-position[1])>.1&&sight(position,p));
            reachable.sort((a,b)=>Math.hypot((a[0]-centre[0])/w,(a[1]-centre[1])/d)-Math.hypot((b[0]-centre[0])/w,(b[1]-centre[1])/d));
            if(!reachable.length)continue;aim=reachable[0];
          }
          const base=Math.atan2(aim[0]-position[0],aim[1]-position[1]);
          for(const offset of [-25,-12.5,0,12.5,25]){
            const yaw=base+offset*Math.PI/180,s=Math.sin(yaw),c=Math.cos(yaw),p=Math.sin(pitch),q=Math.cos(pitch);
            const forward=[s*q,c*q,p],right=[c,-s,0],up=[-s*p,-c*p,q];
            const visible=landmarks.filter(f=>{
              const v=f.point.map((n,j)=>n-position[j]),dot=a=>a.reduce((sum,n,j)=>sum+n*v[j],0),depth=dot(forward);
              return depth>.1&&Math.abs(dot(right))<depth*18/lens&&Math.abs(dot(up))<depth*10.125/lens
                &&sight(position,f.point)&&!blocked(position,f.point,f.id);
            });
            options.push({position,yaw:(yaw*180/Math.PI+360)%360,visible:visible.length,
              score:visible.length*10+(bed&&visible.some(f=>f.id===bed.id)?3:0)-score(position)-Math.abs(offset)*.005});
          }
        }
        let choices=options;
        if(i===1){
          const first=panels[0].pose.yaw*Math.PI/180;
          const reverse=options.filter(v=>Math.cos(v.yaw*Math.PI/180-first)<=.5
            &&(d>=w?Math.cos(v.yaw*Math.PI/180)*Math.cos(first):Math.sin(v.yaw*Math.PI/180)*Math.sin(first))<=0);
          if(reverse.some(v=>v.visible>0))choices=reverse;
          else warnings.push("The room's obstructions limit a full reverse view; inspect the proposed room coverage.");
        }
        choices.sort((a,b)=>b.score-a.score);
        if(choices.length){at=choices[0].position;wideYaw=choices[0].yaw;
          if(!choices[0].visible)warnings.push("A wide frame has no clear saved landmarks; review its camera before building.");}
      }
      const targets=clear.filter(p=>Math.hypot(p[0]-at[0],p[1]-at[1])>.1&&sight(at,p));
      if(!targets.length)throw Error("A clear view across this room couldn't be proposed. Check the footprint in Floor plan.");
      const aimScore=p=>Math.hypot((p[0]-centre[0])/w,(p[1]-centre[1])/d)-.12*Math.hypot((p[0]-at[0])/w,(p[1]-at[1])/d);
      targets.sort((a,b)=>aimScore(a)-aimScore(b));const aim=feature?.point||targets[0];
      const distance=Math.hypot(aim[0]-at[0],aim[1]-at[1]);
      // Match the saved pose's tenth-degree facing precision so preview and accepted views agree.
      const yaw=(Math.round((wideYaw==null?(Math.atan2(aim[0]-at[0],aim[1]-at[1])*180/Math.PI+360)%360:wideYaw)*10)/10)%360;
      const pitch=wide?(i===0?-12:-18):rounded(Math.max(-35,Math.min(15,Math.atan2((feature?.point[2]||clampHeight(.9))-at[2],distance)*180/Math.PI)));
      const lensMm=wide?18:feature?.kind==="fridge"?28:35;
      used.push(at);
      panels.push({key:keys[i],role:i===0?"wide":i===1?"reverse":"detail",
        label:i===0?"Wide room view":i===1?"Reverse room view":feature?tidy(feature.anchor.name,70)+" detail":"Feature detail",
        ...(feature?{targetId:feature.anchor.id}:{}),pose:{position:at,yaw,pitch,lensMm,basis:"design"}});
    }
    if(detailUses.size<2)warnings.push("This room has fewer than two distinct visible detail targets; review the proposed details.");
    warnings.push("Default coverage: a wide room view, a reverse room view and two different feature details. Positions avoid saved walls and sized objects; review the four camera previews before saving.");
    return {key:cameraProposalKey(location,list),panels,warnings};
  }
  /* AUTOMATIC COVERAGE (2026-11-11, owner: a useful first result for any location, no per-room camera recipes).
     The four cameras are fitted to the set exactly as it will be built (camera-coverage.js): two wide views that
     complement each other, then two details chosen by what they add, every frame checked for a clear, unobstructed
     view. What the floor plan knows about each object steers it: one the screenplay names counts for more, and
     objects saved with the same dimensions are one kind. No model, account or render call. */
  function coverageInputs(location,list){
    const state=root.locationSpatialPlanState(location,list);
    if(!state.ready)throw Error(state.reason||"Review the floor plan first.");
    const {owner,plan}=state,spaces=renderSpaces(plan),space=spaces.find(s=>s.id===location.id);
    if(!space||(space.footprint||[]).length<3)throw Error("Add this room's footprint in Floor plan first.");
    if(!space.openSky&&!finite(space.ceilingH))throw Error("Set this room's ceiling height in Floor plan first.");
    const family=root.locationSpatialFamily(owner,list);
    const centre=[0,1].map(i=>space.footprint.reduce((n,p)=>n+p[i],0)/space.footprint.length);
    const hold={position:[centre[0],centre[1],space.floorZ+1.5],yaw:0,pitch:0,lensMm:24};
    const scene=buildScene(location,list,undefined,{cameras:{TL:hold,TR:hold,BL:hold,BR:hold}});
    const subjects=plan.anchors.filter(a=>(root.locationAnchorSpaceOf(a,family)||owner).id===space.id).map(a=>({id:a.id,name:tidy(a.name,80),
      weight:/\b(?:script|screenplay)\b/i.test(a.evidence||"")?3:a.basis==="script"||a.basis==="observed"?2:1,opening:isOpening(a,space),
      kind:a.size?[Math.min(a.size[0],a.size[1]),Math.max(a.size[0],a.size[1]),a.size[2]].join("x"):""}));
    return {scene,space,subjects,plan,spaces,family,owner};
  }
  const savedPoses=(location,list)=>Object.fromEntries(root.locationPanelPoses(location,list).map(p=>[p.key,p.pose.position?p.pose:null]));
  // Each saved camera's view of the built set: "" = a usable picture, otherwise why not (camera-coverage.js gate).
  async function assessCameras(location,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    const T=await root.KinolotAnglePreview.load(),input=coverageInputs(location,list);
    return root.KinolotCameraCoverage.assess(T,root.KinolotAnglePreview,input.scene,input.space,savedPoses(location,list),{subjects:input.subjects});
  }
  // A proposal like proposeCameras's. `keep`: panel keys whose saved cameras stay exactly as they are.
  async function proposeCamerasAuto(location,list,{keep=[]}={}){
    list=list||((root.turnContinuity||{}).locations)||[];
    const key=cameraProposalKey(location,list),T=await root.KinolotAnglePreview.load();
    // The fit takes about a second of solid work: let the card show that it has started first.
    // (saving re-checks that the film, floor plan and cameras are still the ones this was fitted to: cameraProposalViews)
    if(typeof root.setTimeout==="function")await new Promise(done=>root.setTimeout(done,30));
    const input=coverageInputs(location,list),saved=savedPoses(location,list),kept={};
    for(const k of keep)if(saved[k])kept[k]=saved[k];
    /* A SPACE TOO TIGHT FOR THE CHECKED FIT STILL GETS FOUR CAMERAS (2026-11-21: "make this work for any location").
       The checked fit wants a clear, unobstructed wide view; a car's cabin (1.4 m by 2.3 m under a 1.2 m roof, full of
       seats) has none, so it gave up, and every road that sets a whole place's cameras (after Confirm, Prepare this
       place, Previs) left such a card with no camera at all: its set could not be drawn. Only step 3's own button
       fell back. Now the simpler placement (clear of walls and sized objects, inside the room's height) answers
       whenever the checked fit cannot, on every road, and says so. A camera someone set by hand is still kept. */
    const tight=(first)=>{
      let simple;try{simple=proposeCameras(location,list);}catch(_){throw first;}
      const panels=simple.panels.map(p=>({key:p.key,role:p.role||"",label:tidy(p.label||"a view of the space",90),...(p.pose&&p.pose.target?{targetId:p.pose.target}:{}),pose:kept[p.key]||p.pose}));
      if(Object.keys(cameraProblemsIn(location,list,input.plan,input.spaces,input.family,input.owner,panels)).length)throw first;
      return {key,panels,auto:false,simple:true,warnings:[
        "This space is too tight for a checked, unobstructed fit, so the four cameras were placed by the simpler rule: inside the room, clear of its walls and its sized objects. Review the four previews before saving; your current cameras are unchanged."]};
    };
    let result;
    try{result=root.KinolotCameraCoverage.plan(T,root.KinolotAnglePreview,input.scene,input.space,{subjects:input.subjects,keep:kept});}
    catch(first){return tight(first);}
    const panels=result.panels.map(p=>({key:p.key,role:p.role,label:tidy(p.label,90),...(p.targetId?{targetId:p.targetId}:{}),
      pose:kept[p.key]||{position:p.pose.position,yaw:p.pose.yaw,pitch:p.pose.pitch,lensMm:p.pose.lensMm,...(p.targetId?{target:p.targetId}:{}),basis:"design"}}));
    const problems=cameraProblemsIn(location,list,input.plan,input.spaces,input.family,input.owner,panels);
    if(Object.keys(problems).length)return tight(Error("A proposed camera did not fit the room. Check the footprint and object sizes in Floor plan."));
    const placed=panels.filter(p=>!kept[p.key]);
    return {key,panels,auto:true,warnings:[
      "Automatic coverage: "+placed.map(p=>p.label).join(", ")+". Each view was checked against the set as it will be built, for a clear and unobstructed frame. Review the four previews before saving; your current cameras are unchanged."]};
  }
  function cameraProposalViews(location,proposal,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    if(!proposal||proposal.key!==cameraProposalKey(location,list))throw Error("The film, floor plan or cameras changed. Suggest 4 cameras again.");
    if(!Array.isArray(proposal.panels)||proposal.panels.length!==4||["TL","TR","BL","BR"].some(k=>proposal.panels.filter(p=>p.key===k).length!==1))
      throw Error("Four proposed camera views are required.");
    const state=root.locationSpatialPlanState(location,list);
    if(!state.ready||Object.keys(cameraProblemsIn(location,list,state.plan,renderSpaces(state.plan),root.locationSpatialFamily(state.owner,list),state.owner,proposal.panels)).length)
      throw Error("These camera positions no longer fit the room. Suggest 4 cameras again.");
    let next=location;
    for(const p of proposal.panels)next={...next,coverageViews:root.locationCoverageViewsWithPose(next,p.key,p.pose)};
    return next.coverageViews;
  }
  /* THE WHOLE PLACE AT ONCE (owner 2026-11-16, the whole place first: "use camera to capture the subspaces"). Every
     card of a place stands in the place's one floor plan, so their cameras can be set together. camerasMissingForPlace
     names the cards that have a room on the plan but not four usable cameras (none yet, or one that cannot stand where
     it is); proposeCamerasForPlace fits clear views for exactly those, leaving every usable camera as it is. One row a
     card: {id, name, views, set:[panel keys]} to save | {kept:true} | {outside:true} (no room on the plan) | {error}.
     Nothing is saved here: the card saves each row's views. Free: no model call. */
  const PANEL_KEYS=["TL","TR","BL","BR"];
  // not usable: never set by anyone (only the app's stand-in position), without a position, or standing where it cannot
  function unusableCameras(member,list){
    const rows=root.locationPanelPoses(member,list),problems=cameraProblems(member,list)||{};
    return PANEL_KEYS.filter(k=>{const row=rows.find(p=>p.key===k);return !row||!row.pose.position||row.source==="suggested"||!!problems[k];});
  }
  function camerasMissingForPlace(location,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    const state=root.locationSpatialPlanState(location,list);if(!state.ready)return [];
    const spaces=renderSpaces(state.plan);
    return root.locationSpatialFamily(state.owner,list).filter(m=>m&&spaces.some(s=>s.id===m.id&&(s.footprint||[]).length>=3)).map(m=>{
      let bad=PANEL_KEYS;try{bad=unusableCameras(m,list);}catch(_){bad=PANEL_KEYS;}
      return bad.length?{id:m.id,name:m.name||"Room",missing:bad}:null;}).filter(Boolean);
  }
  async function proposeCamerasForPlace(location,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    const state=root.locationSpatialPlanState(location,list);
    if(!state.ready)throw Error(state.reason||"Review the floor plan first.");
    const spaces=renderSpaces(state.plan),rows=[];
    for(const m of root.locationSpatialFamily(state.owner,list)){
      if(!m)continue;
      const row={id:m.id,name:m.name||"Room"};
      if(!spaces.some(s=>s.id===m.id&&(s.footprint||[]).length>=3)){rows.push({...row,outside:true});continue;}
      try{
        let bad=unusableCameras(m,list);
        // a camera the app placed whose view is now blocked is fitted again; one set by hand is only ever reported
        if(bad.length<4)try{
          const faults=await assessCameras(m,list),poses=root.locationPanelPoses(m,list);
          bad=PANEL_KEYS.filter(k=>bad.includes(k)||(faults[k]&&((poses.find(p=>p.key===k)||{}).pose||{}).basis!=="user"));
        }catch(_){}
        if(!bad.length){rows.push({...row,kept:true});continue;}
        const proposal=await proposeCamerasAuto(m,list,{keep:PANEL_KEYS.filter(k=>!bad.includes(k))});
        rows.push({...row,views:cameraProposalViews(m,proposal,list),set:bad});
      }catch(e){rows.push({...row,error:tidy(e&&e.message||"The cameras could not be fitted.",200)});}
    }
    return rows;
  }
  // What a whole-place fit did, in one line for the card.
  function placeCamerasText(rows){
    rows=rows||[];
    const set=rows.filter(r=>r.views),failed=rows.filter(r=>r.error),outside=rows.filter(r=>r.outside);
    if(!set.length&&!failed.length)return "";
    return [set.length?"Cameras set, free: "+set.map(r=>r.name+" ("+r.set.length+(r.set.length===1?" view":" views")+")").join(", ")+". See them in Previs; change any in Cameras.":"",
      failed.length?"Could not be set: "+failed.map(r=>r.name+" ("+r.error.replace(/[.]+$/,"")+")").join("; ")+".":"",
      outside.length?"Not on the floor plan yet: "+outside.map(r=>r.name).join(", ")+".":""].filter(Boolean).join(" ");
  }
  // Each issue names the card step that fixes it: Floor plan or Cameras.
  function inputIssueList(location,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    const state=root.locationSpatialPlanState(location,list);
    if(!state.ready)return [{step:2,text:state.reason}];
    const {owner,plan}=state,spaces=renderSpaces(plan),issues=[],objectIssues=[];
    if(!spaces.length)return [{step:2,text:"Add the location's footprint to the floor plan first."}];
    if(!spaces.some(s=>s.id===location.id&&s.footprint.length>=3))issues.push("Add this space's footprint to the floor plan first.");
    for(const s of spaces){
      let poly;try{poly=C().polygon(s.footprint);}catch(e){issues.push((s.name||"Space")+": "+e.message);continue;}
      if(s.openSky)continue;
      if(!finite(s.ceilingH)){issues.push("Set the ceiling height for "+(s.name||"this space")+" in the floor plan.");continue;}
      for(const o of s.openings||[]){
        if(!o.centre||!finite(o.width)||!finite(o.sillZ)||!finite(o.headZ)){
          issues.push("Set the centre, width, sill and head for "+(o.name||"each opening")+".");continue;
        }
        // an opening inside the outline stands in a wall of its own (an inner wall): it has no outline wall to sit on
        const own=innerWallOf(s,o);
        const a=own?own.a:poly[o.edge],b=own?own.b:poly[(o.edge+1)%poly.length];
        if(!a||!b){issues.push("Check the wall placement of "+(o.name||"this opening")+".");continue;}
        const length=Math.hypot(b[0]-a[0],b[1]-a[1]),u=[(b[0]-a[0])/length,(b[1]-a[1])/length];
        const x=(o.centre[0]-a[0])*u[0]+(o.centre[1]-a[1])*u[1],distance=Math.abs((o.centre[0]-a[0])*u[1]-(o.centre[1]-a[1])*u[0]);
        const metres=n=>Math.round(n*100)/100+" m";
        if(o.sillZ<s.floorZ)issues.push((o.name||"This opening")+": its bottom is at "+metres(o.sillZ)+", below the room floor at "+metres(s.floorZ)+". Correct Opening bottom in Floor plan.");
        if(o.headZ>s.floorZ+s.ceilingH)issues.push((o.name||"This opening")+": its top is at "+metres(o.headZ)+", above the ceiling at "+metres(s.floorZ+s.ceilingH)+". Correct Opening top or the room ceiling height in Floor plan.");
        if(o.headZ<=o.sillZ)issues.push((o.name||"This opening")+": its top must be higher than its bottom. Correct Opening top and Opening bottom in Floor plan.");
        if(distance>0.25||x-o.width/2<0||x+o.width/2>length)
          issues.push("Check the dimensions and wall placement of "+(o.name||"this opening")+".");
      }
    }
    const family=root.locationSpatialFamily(owner,list);
    for(const a of plan.anchors){
      const room=root.locationAnchorSpaceOf(a,family)||owner,space=spaces.find(s=>s.id===room.id);
      if(!space){issues.push("Add the footprint for "+(room.name||"each object's room")+".");continue;}
      if(isOpening(a,space)){
        if(!savedOpening(a,space)&&!beyondOutline(a,space))issues.push("Add "+a.name+" to its room's floor-plan openings, with its dimensions.");
      }else{
        const missing=[!a.xy&&{key:"xy",label:"Floor plan position"},!a.size&&{key:"size",label:"Object dimensions (width, depth, height)"}].filter(Boolean);
        if(missing.length)objectIssues.push({step:2,anchorId:a.id,fields:missing.map(f=>f.key),
          text:"Set "+missing.map(f=>f.label).join(" and ")+" for "+(a.name||"this fixed object")+"."});
      }
      if(root.KinolotSetDetail?.anchorShape(a)==="sports-net"&&a.size&&a.netMeshHeight>a.size[2])
        issues.push("Net mesh height for "+a.name+" must not exceed its overall object height.");
    }
    if(spaces.filter(s=>!s.openSky).length>16)issues.push("This preview supports up to sixteen spaces.");
    const tagged=Array.from(new Set(issues)).map(text=>({step:2,text})).concat(objectIssues);
    const labels=Object.fromEntries(root.locationPanelPoses(location,list).map(p=>[p.key,p.label||p.key]));
    for(const [key,problem] of Object.entries(cameraProblemsIn(location,list,plan,spaces,family,owner)))
      tagged.push({step:3,panel:key,text:"The "+labels[key]+" camera: "+problem.charAt(0).toLowerCase()+problem.slice(1)});
    return tagged;
  }
  function inputIssues(location,list){return inputIssueList(location,list).map(i=>i.text);}
  /* MOVING PARTS (2026-11-01): a part linked to a floor-plan object can be built in its state at a story moment —
     lowered (hinged at its base on the nearest wall, laid outward with an 8° fall), swung open (90° about one side,
     into the room) or not there. `at` = {sceneId, beatN, moment}; none = the usual state the floor plan describes. */
  function partPoses(location,at){
    if(!at||typeof root.locationMovingPartsAt!=="function")return {};
    const out={};
    root.locationMovingPartsAt(location,at).forEach(p=>{if(p.anchorId&&p.state&&p.state.pose!=="as-built")out[p.anchorId]={pose:p.state.pose,label:p.name+" "+p.state.label.toLowerCase()};});
    return out;
  }
  // The story moments a set can be built at: the usual state, then each moment that leaves a different set of states.
  function buildMoments(location){
    const parts=typeof root.normalizeLocationMovingParts==="function"?root.normalizeLocationMovingParts(location&&location.movingParts):[];
    const out=[{key:"",at:null,label:"Usual state"}],seen=new Set(["[]"]);
    parts.forEach(p=>p.changes.forEach(c=>{
      const at={sceneId:c.sceneId,beatN:c.beatN,moment:c.moment+(c.during?1:0)};
      const poses=partPoses(location,at),sig=JSON.stringify(Object.keys(poses).sort().map(k=>[k,poses[k].pose]));
      if(seen.has(sig))return;seen.add(sig);
      const sc=((root.turnContinuity||{}).scenes||[]).find(x=>x.id===c.sceneId);
      out.push({key:[c.sceneId,at.beatN,at.moment].join(":"),at,
        label:"Scene "+(sc?sc.no:"?")+" · beat "+at.beatN+" · moment "+at.moment+" — "+Object.values(poses).map(v=>v.label).join(", ")});
    }));
    return out;
  }
  const chosen=new Map();
  function setBuildMoment(locationId,key){
    if(key)chosen.set(locationId,key);else chosen.delete(locationId);
    root.dispatchEvent?.(new CustomEvent("kinolot-set-moment",{detail:{locationId}}));
  }
  function buildMoment(location){
    const key=chosen.get(location&&location.id)||"";
    return (buildMoments(location).find(m=>m.key===key)||{at:null}).at;
  }
  function posedAnchor(anchor,sp,z,pose){
    const [w,d,h]=anchor.size,poly=C().polygon(sp.footprint);
    const cx=poly.reduce((n,p)=>n+p[0],0)/poly.length,cy=poly.reduce((n,p)=>n+p[1],0)/poly.length;
    if(pose==="lowered"){
      let best=null;
      poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((anchor.xy[0]-a[0])*dx+(anchor.xy[1]-a[1])*dy)/(dx*dx+dy*dy)));
        const P=[a[0]+t*dx,a[1]+t*dy],dist=Math.hypot(anchor.xy[0]-P[0],anchor.xy[1]-P[1]);
        if(!best||dist<best.dist)best={P,dist,dx,dy};});
      const len=Math.hypot(best.dx,best.dy);let n=[best.dy/len,-best.dx/len];
      if((best.P[0]+n[0]-cx)**2+(best.P[1]+n[1]-cy)**2<(best.P[0]-cx)**2+(best.P[1]-cy)**2)n=[-n[0],-n[1]];
      const fall=8*Math.PI/180,yaw=Math.atan2(-n[0],n[1]);
      const out=(h/2)*Math.cos(fall)-(d/2)*Math.sin(fall),down=-(h/2)*Math.sin(fall)-(d/2)*Math.cos(fall);
      return {position:[best.P[0]+n[0]*out,best.P[1]+n[1]*out,sp.floorZ+down],size:[w,h,d],rotation:[-fall,0,yaw],
        outside:{P:best.P,n,yaw,reach:h*Math.cos(fall),dropZ:sp.floorZ-h*Math.sin(fall)}};
    }
    const r0=-(anchor.facing||0)*Math.PI/180,left=[anchor.xy[0]-Math.cos(r0)*w/2,anchor.xy[1]-Math.sin(r0)*w/2];
    const swing=r=>[left[0]+Math.cos(r)*w/2,left[1]+Math.sin(r)*w/2];
    const a=swing(r0+Math.PI/2),b=swing(r0-Math.PI/2);
    const r1=(a[0]-cx)**2+(a[1]-cy)**2<=(b[0]-cx)**2+(b[1]-cy)**2?r0+Math.PI/2:r0-Math.PI/2;
    return {position:[...swing(r1),z],size:anchor.size,rotation:[0,0,r1]};
  }
  function buildScene(location,list,at,options){
    list=list||((root.turnContinuity||{}).locations)||[];
    const poses=partPoses(location,at);
    // With other cameras given (camera planning), the saved cameras' own problems do not stop the set being built.
    const issues=inputIssueList(location,list).filter(i=>!(options&&options.cameras&&i.step===3)).map(i=>i.text);if(issues.length)throw new Error(issues[0]);
    const state=root.locationSpatialPlanState(location,list),owner=state.owner,plan=state.plan;
    if(!state.ready)throw new Error(state.reason);
    const coords=plan.coordinates;
    if(!coords||!coords.spaces.length)throw new Error("Add the location's footprint to the floor plan first.");
    const spaces=renderSpaces(plan),objects=[],lights=[],notes=["Floor plan dimensions are estimates, not a survey.","Wall and floor thicknesses are proposed at 0.15 m. Materials and lighting are a preview treatment."];
    if(plan.anchors.some(a=>a.sizeBasis==="design"))notes.push("Object sizes marked proposed design are working estimates. Unsupported grouped dressing is represented by a single simplified proxy; its repeated units and fine details are not modelled in this preview.");
    if(!spaces.some(s=>s.id===location.id&&s.footprint.length>=3))throw new Error("Add this space's footprint to the floor plan first.");
    const family=root.locationSpatialFamily(owner,list);let baseNote=false;const outsides=[];
    const movingIds=new Set((typeof root.normalizeLocationMovingParts==="function"?root.normalizeLocationMovingParts(location&&location.movingParts):[]).map(p=>p.anchorId).filter(Boolean));
    const add=(id,name,position,size,rotation=[0,0,0],extra={})=>objects.push({id,name:tidy(name),position,size,rotation,kind:"box",material:"wall",...extra});
    spaces.forEach((s,si)=>{
      const poly=C().polygon(s.footprint),xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]);
      const low=[Math.min(...xs),Math.min(...ys)],high=[Math.max(...xs),Math.max(...ys)],size=[high[0]-low[0],high[1]-low[1],0.15];
      if(size[0]<0.01||size[1]<0.01)throw new Error("A floor footprint is too narrow.");
      add("floor-"+si,(s.name||"Space")+" floor",[(low[0]+high[0])/2,(low[1]+high[1])/2,s.floorZ-0.075],size,[0,0,0],
        {kind:"prism",material:"floor",footprint:poly.map(p=>[(p[0]-low[0])/size[0]-0.5,(p[1]-low[1])/size[1]-0.5])});
      if(s.openSky)return;
      if(!finite(s.ceilingH))throw new Error("Set the ceiling height for "+(s.name||"this space")+" in the floor plan.");
      const height=s.ceilingH;
      // One wall from a to b, built in pieces around its openings. `key` names the wall in its pieces' ids.
      const wallRun=(key,a,b,list)=>{
        const length=Math.hypot(b[0]-a[0],b[1]-a[1]),u=[(b[0]-a[0])/length,(b[1]-a[1])/length];
        const openings=list.map(o=>{
          if(!o.centre||!finite(o.width)||!finite(o.sillZ)||!finite(o.headZ))throw new Error("Set the centre, width, sill and head for "+(o.name||"each opening")+".");
          const x=(o.centre[0]-a[0])*u[0]+(o.centre[1]-a[1])*u[1],distance=Math.abs((o.centre[0]-a[0])*u[1]-(o.centre[1]-a[1])*u[0]);
          const bottom=o.sillZ-s.floorZ,top=o.headZ-s.floorZ;
          if(distance>0.25||x-o.width/2<0||x+o.width/2>length||bottom<0||top>height||top<=bottom)throw new Error("Check the dimensions and wall placement of "+(o.name||"this opening")+".");
          return {left:x-o.width/2,right:x+o.width/2,bottom,top};
        });
        const cuts=Array.from(new Set([0,length,...openings.flatMap(o=>[o.left,o.right])])).sort((x,y)=>x-y);
        for(let ci=1;ci<cuts.length;ci++){
          const left=cuts[ci-1],right=cuts[ci],middle=(left+right)/2;
          const holes=openings.filter(o=>o.left<middle&&o.right>middle);
          const zs=Array.from(new Set([0,height,...holes.flatMap(o=>[o.bottom,o.top])])).sort((x,y)=>x-y);
          for(let zi=1;zi<zs.length;zi++){
            const bottom=zs[zi-1],top=zs[zi],z=(bottom+top)/2;
            if(right-left<0.001||top-bottom<0.001||holes.some(o=>o.bottom<z&&o.top>z))continue;
            add(`wall-${si}-${key}-${ci}-${zi}`,(s.name||"Space")+" wall",[a[0]+u[0]*middle,a[1]+u[1]*middle,s.floorZ+z],
              [right-left,0.15,top-bottom],[0,0,Math.atan2(u[1],u[0])]);
          }
        }
      };
      // the openings that stand inside the outline: each in a wall of its own (two on one line share it)
      const innerRuns=typeof root.locationInnerWalls==="function"?root.locationInnerWalls(s):[],innerSet=new Set(innerRuns.flatMap(r=>r.openings.map(x=>x.opening)));
      for(let ei=0;ei<poly.length;ei++)wallRun(ei,poly[ei],poly[(ei+1)%poly.length],(s.openings||[]).filter(o=>o.edge===ei&&!innerSet.has(o)));
      innerRuns.forEach((run,ri)=>wallRun("in"+ri,run.a,run.b,run.openings.map(x=>x.opening)));
      add("ceiling-"+si,(s.name||"Space")+" ceiling",[(low[0]+high[0])/2,(low[1]+high[1])/2,s.floorZ+height+0.075],size,[0,0,0],
        {kind:"prism",footprint:poly.map(p=>[(p[0]-low[0])/size[0]-0.5,(p[1]-low[1])/size[1]-0.5])});
      lights.push({position:[(low[0]+high[0])/2,(low[1]+high[1])/2,s.floorZ+height-0.15],colour:[1,0.92,0.8],powerWatts:Math.min(4000,Math.max(200,size[0]*size[1]*8)),sizeMetres:Math.min(15,Math.max(0.5,Math.min(size[0],size[1])/2))});
    });
    plan.anchors.forEach((anchor,i)=>{
      const room=root.locationAnchorSpaceOf(anchor,family)||owner,sp=spaces.find(s=>s.id===room.id);
      if(!sp)throw new Error("Add the footprint for "+(room.name||"each object's room")+".");
      /* A MOVING PART IS A THING, EVEN WHEN IT CLOSES AN OPENING (2026-11-21). A ramp, a shutter or a door that the story
         moves is saved as an object AND, often, under the same name as the opening it closes ("Stern ramp"). Since the
         floor plan's openings became authoritative (d3c144f6) such an object was taken for the opening alone and left
         out of the set: the ramp was never raised, never lowered. A part the card lists under Moving parts, with a
         position and a size, is built; its opening stays an opening in the wall behind it. */
      const movingThing=movingIds.has(anchor.id)&&!!anchor.xy&&!!anchor.size;
      if(isOpening(anchor,sp)&&!movingThing){
        if(!savedOpening(anchor,sp)){
          if(!beyondOutline(anchor,sp))throw new Error("Add "+anchor.name+" to its room's floor-plan openings, with its dimensions.");
          notes.push(tidy(anchor.name,80)+" stands beyond this place's outline (seen through an opening): it is not built.");
        }
        return;
      }
      if(!anchor.xy||!anchor.size)throw new Error("Set the floor plan position and width, depth and height for "+(anchor.name||"each fixed object")+".");
      const {z,missing,base}=anchorCentreZ(anchor,sp,plan);
      if(missing)notes.push(tidy(anchor.name,80)+" has no saved centre height; it stands on its room's floor in this preview.");
      if(base)baseNote=true;
      const posed=poses[anchor.id];
      if(posed&&posed.pose==="hidden"){notes.push(tidy(posed.label,120)+": not built at this moment.");return;}
      const shape=posed?posedAnchor(anchor,sp,z,posed.pose):{position:[anchor.xy[0],anchor.xy[1],z],size:anchor.size,rotation:[0,0,-(anchor.facing||0)*Math.PI/180]};
      if(posed)notes.push(tidy(posed.label,120)+" at this moment (a moving part).");
      if(shape.outside)outsides.push(shape.outside);
      add("anchor-"+i,anchor.name,shape.position,shape.size,shape.rotation,
        {anchorId:anchor.id,material:"dressing",basis:anchor.sizeBasis||"design"});
    });
    if(baseNote)notes.push("This floor plan saves objects' base heights; the preview stands each object on its saved height.");
    // a lowered part opens the room: a plain quay to land on and a dark night backdrop, so the opening reads as outside
    outsides.forEach((o,k)=>{
      const at=d=>[o.P[0]+o.n[0]*d,o.P[1]+o.n[1]*d];
      add("outside-ground-"+k,"Quay beyond the lowered part (stand-in)",[...at(o.reach+12.5),o.dropZ-0.15],[60,25,0.3],[0,0,o.yaw],{material:"quay",basis:"design"});
      add("outside-backdrop-"+k,"Night beyond the opening (stand-in)",[...at(o.reach+40),o.dropZ+12],[120,0.3,30],[0,0,o.yaw],{material:"night",basis:"design"});
    });
    if(outsides.length)notes.push("Beyond the lowered part: a plain quay and a dark night backdrop stand in for the outside.");
    if(lights.length>16)throw new Error("This preview supports up to sixteen spaces.");
    const cameras={};
    // options.cameras: the set as it is built, seen from other cameras (camera planning) — geometry never depends on them
    if(options&&options.cameras)Object.assign(cameras,options.cameras);
    else root.locationPanelPoses(location,list).forEach(p=>{
      if(!p.pose.position)throw new Error("The "+(p.label||p.key)+" camera has no position yet.");
      cameras[p.key]={position:p.pose.position,yaw:p.pose.yaw,pitch:p.pose.pitch,lensMm:p.pose.lensMm};
      if(p.source==="suggested")notes.push(p.label+" uses the suggested camera position; edit it under Camera views.");
    });
    const scene={schema:detailedEnabled()?C().MCP_SCHEMA:C().SCHEMA,...(detailedEnabled()?{authoring:"mcp-procedural-v1"}:{}),name:tidy(location.name||"Location preview"),units:"metres",axes:"+Z up; +Y north; +X east",
      status:"development blockout",notes,objects,cameras,previewLights:lights,materials:{
        floor:{baseColor:[0.22,0.25,0.28],metallic:0.1,roughness:0.65},
        wall:{baseColor:[0.55,0.58,0.6],metallic:0.05,roughness:0.7},
        dressing:{baseColor:[0.46,0.34,0.2],metallic:0.05,roughness:0.6},
        ...(outsides.length?{quay:{baseColor:[0.07,0.07,0.075],metallic:0.05,roughness:0.9},night:{baseColor:[0.008,0.01,0.018],metallic:0,roughness:1}}:{}),
      }};
    if(!root.KinolotSetDetail)throw new Error("The set detail builder did not load. Refresh this page before building.");
    const detailed=root.KinolotSetDetail.build(C().validateScene(scene),{space:spaces.find(s=>s.id===location.id),
      anchors:plan.anchors.filter(a=>(root.locationAnchorSpaceOf(a,family)||owner).id===location.id),allAnchors:plan.anchors,
      brief:{name:location.name||"",architecture:location.architecture||"",keySizes:location.keySizes||""},partPoses:poses});
    const proxies=detailed.objects.filter(o=>o.anchorId&&o.kind==="box"&&o.material==="dressing"
      &&!plan.anchors.find(a=>a.id===o.anchorId)?.renderShape);
    if(proxies.length)detailed.notes.push("Simplified solid blocks: "+proxies.slice(0,4).map(o=>tidy(o.name,65)).join(", ")
      +(proxies.length>4?" and "+(proxies.length-4)+" more":"")+". These show object bounds, not confirmed shapes. Review Set shape in Floor plan; a block cannot represent mesh, openings or detailed furniture.");
    return C().validateScene(detailed);
  }
  function endpoint(){
    if(local()&&root.KINOLOT_RENDER_DEV_ENDPOINT){
      const u=new URL(root.KINOLOT_RENDER_DEV_ENDPOINT);
      if(u.protocol!=="http:"||!["127.0.0.1","localhost"].includes(u.hostname))throw new Error("The development connection must be local.");
      return u.href;
    }
    return root.BlenderPreview.endpoint().replace(/\/blender-bridge$/,"/blender-render");
  }
  async function request(action,body,scope){
    const api=root.BlenderPreview,s=scope||api.scope();
    if(!api.isCurrent(s))throw new Error("The open film changed. Reopen the preview.");
    if(body?.projectId&&body.projectId!==s.projectId)throw new Error("The request belongs to another film.");
    const sb=typeof root.sbClient==="function"?root.sbClient():root._sbClient;
    if(!sb?.auth)throw new Error("Sign in before rendering this set.");
    const session=await sb.auth.getSession(),value=session?.data?.session;
    if(session.error||!value?.access_token||value.user?.id!==s.uid||!api.isCurrent(s))throw new Error("Sign in again before rendering this set.");
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),30000);
    let response,data;
    try{
      response=await root.fetch(endpoint(),{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+value.access_token,apikey:(root.TURN_SUPABASE||{}).anonKey||""},
        body:JSON.stringify({...body,action}),signal:abort.signal});data=await response.json();
    }catch(_){throw new Error("The cloud set service could not be reached. Check the request status before submitting again.");}
    finally{clearTimeout(timer);}
    if(!api.isCurrent(s))throw new Error("The open film changed. Reopen the preview.");
    if(!response.ok)throw new Error(String(data.error||"The cloud set request was rejected.").replace(/https?:\/\/\S+/g,"[link]").slice(0,300));
    if(data.job&&data.job.projectId!==s.projectId)throw new Error("The returned render belongs to another film.");
    return data;
  }
  function requestIdentity(scope,locationId,sceneHash,previousJobId=""){
    const key="kinolot-render-request:"+scope.uid+":"+scope.projectId+":"+locationId;
    let old=requestCache.get(key);try{old=JSON.parse(root.localStorage.getItem(key)||"null")||old;}catch(_){}
    if(old?.sceneHash===sceneHash&&old.previousJobId===previousJobId&&old.requestId)return old.requestId;
    const requestId=root.crypto.randomUUID();
    const value={sceneHash,requestId,previousJobId};requestCache.set(key,value);
    try{root.localStorage.setItem(key,JSON.stringify(value));}catch(_){}
    return requestId;
  }
  // Render time from the pilot worker's measured runs (2 CPU cores, 640 x 360, four cameras): 58 shapes took 78 s and
  // 236 shapes took 244 s. A location's own last render, when known, is the better guess.
  function estimateSeconds(objects,lastSeconds){
    if(finite(lastSeconds)&&lastSeconds>0)return Math.round(lastSeconds);
    return Math.max(60,Math.round(25+0.93*(Number(objects)||0)));
  }
  // The location card's step guide reads each location's latest build (set by the build and style steps).
  const jobs=new Map();
  function noteJob(locationId,state){
    const before=JSON.stringify(jobs.get(locationId)||null);
    if(state)jobs.set(locationId,state);else jobs.delete(locationId);
    if(JSON.stringify(state||null)!==before)root.dispatchEvent?.(new CustomEvent("kinolot-cloud-job",{detail:{locationId}}));
  }
  const jobState=locationId=>jobs.get(locationId)||null;
  root.KinolotCloudRender={enabled,inputIssues,inputIssueList,cameraProblems,cameraProposalKey,proposeCameras,proposeCamerasAuto,assessCameras,cameraProposalViews,camerasMissingForPlace,proposeCamerasForPlace,placeCamerasText,noteJob,jobState,buildScene,request,requestIdentity,estimateSeconds,
    buildMoments,setBuildMoment,buildMoment};
})(typeof window!=="undefined"?window:globalThis);
