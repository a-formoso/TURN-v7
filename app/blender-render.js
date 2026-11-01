/* Cloud set previews use one explicit metric scene. No model infers positions here. */
(function(root){
  "use strict";
  const C=()=>root.KinolotRenderContract;
  const requestCache=new Map();
  const local=()=>!!root.location&&["localhost","127.0.0.1","::1"].includes(root.location.hostname);
  function enabled(){return local()&&root.turnIsAdmin===true;}
  const tidy=(s,max=160)=>String(s||"").replace(/[\u0000-\u001f]/g," ").trim().slice(0,max);
  const finite=(n)=>typeof n==="number"&&Number.isFinite(n);
  function savedOpening(anchor,space){
    return (space?.openings||[]).find(o=>o.id===anchor.id||tidy(o.name).toLowerCase()===tidy(anchor.name).toLowerCase());
  }
  function isOpening(anchor,space){
    // A saved window/glass aperture is authoritative even when its descriptive name is ambiguous.
    const opening=savedOpening(anchor,space);
    return root.locationAnchorIsOpening(anchor)||!!opening&&["window","glass"].includes(opening.kind);
  }
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
  // Per camera: what is wrong with where it stands (no entry = fine). Step 3 · Cameras shows these beside each camera.
  function cameraProblemsIn(location,list,plan,spaces,family,owner){
    // Only a location with its own room on the floor plan places cameras in it (a whole location's plate doesn't).
    const out={},poses=root.locationPanelPoses(location,list);
    const sp=spaces.find(s=>s.id===location.id);if(!sp||!(sp.footprint||[]).length)return out;
    for(const p of poses)if(!p.pose.position)out[p.key]="It has no position yet.";
    let poly;try{poly=C().polygon(sp.footprint);}catch(_){return out;}
    const room=sp.name||location.name||"this room";
    const inside=(x,y)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
      if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
    const wall=(x,y)=>Math.min(...poly.map((a,i)=>{const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);}));
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
  function cameraProblems(location,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    const state=root.locationSpatialPlanState(location,list);if(!state.ready)return {};
    const spaces=renderSpaces(state.plan);
    return cameraProblemsIn(location,list,state.plan,spaces,root.locationSpatialFamily(state.owner,list),state.owner);
  }
  // Each issue names the card step that fixes it: 2 · Floor plan or 3 · Cameras.
  function inputIssueList(location,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    const state=root.locationSpatialPlanState(location,list);
    if(!state.ready)return [{step:2,text:state.reason}];
    const {owner,plan}=state,spaces=renderSpaces(plan),issues=[];
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
        const a=poly[o.edge],b=poly[(o.edge+1)%poly.length];
        if(!a||!b){issues.push("Check the wall placement of "+(o.name||"this opening")+".");continue;}
        const length=Math.hypot(b[0]-a[0],b[1]-a[1]),u=[(b[0]-a[0])/length,(b[1]-a[1])/length];
        const x=(o.centre[0]-a[0])*u[0]+(o.centre[1]-a[1])*u[1],distance=Math.abs((o.centre[0]-a[0])*u[1]-(o.centre[1]-a[1])*u[0]);
        if(o.sillZ<s.floorZ||o.headZ>s.floorZ+s.ceilingH||o.headZ<=o.sillZ)
          issues.push("Check the sill and head heights for "+(o.name||"this opening")+" in "+(s.name||"its room")+"; heights are measured above the main floor.");
        if(distance>0.25||x-o.width/2<0||x+o.width/2>length)
          issues.push("Check the dimensions and wall placement of "+(o.name||"this opening")+".");
      }
    }
    const family=root.locationSpatialFamily(owner,list);
    for(const a of plan.anchors){
      const room=root.locationAnchorSpaceOf(a,family)||owner,space=spaces.find(s=>s.id===room.id);
      if(!space){issues.push("Add the footprint for "+(room.name||"each object's room")+".");continue;}
      if(isOpening(a,space)){
        if(!savedOpening(a,space))issues.push("Add "+a.name+" to its room's floor-plan openings, with its dimensions.");
      }else if(!a.xy||!a.size)issues.push("Set the floor plan position and width, depth and height for "+(a.name||"each fixed object")+".");
    }
    if(spaces.filter(s=>!s.openSky).length>16)issues.push("This preview supports up to sixteen spaces.");
    const tagged=Array.from(new Set(issues)).map(text=>({step:2,text}));
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
      return {position:[best.P[0]+n[0]*out,best.P[1]+n[1]*out,sp.floorZ+down],size:[w,h,d],rotation:[-fall,0,yaw]};
    }
    const r0=-(anchor.facing||0)*Math.PI/180,left=[anchor.xy[0]-Math.cos(r0)*w/2,anchor.xy[1]-Math.sin(r0)*w/2];
    const swing=r=>[left[0]+Math.cos(r)*w/2,left[1]+Math.sin(r)*w/2];
    const a=swing(r0+Math.PI/2),b=swing(r0-Math.PI/2);
    const r1=(a[0]-cx)**2+(a[1]-cy)**2<=(b[0]-cx)**2+(b[1]-cy)**2?r0+Math.PI/2:r0-Math.PI/2;
    return {position:[...swing(r1),z],size:anchor.size,rotation:[0,0,r1]};
  }
  function buildScene(location,list,at){
    list=list||((root.turnContinuity||{}).locations)||[];
    const poses=partPoses(location,at);
    const issues=inputIssues(location,list);if(issues.length)throw new Error(issues[0]);
    const state=root.locationSpatialPlanState(location,list),owner=state.owner,plan=state.plan;
    if(!state.ready)throw new Error(state.reason);
    const coords=plan.coordinates;
    if(!coords||!coords.spaces.length)throw new Error("Add the location's footprint to the floor plan first.");
    const spaces=renderSpaces(plan),objects=[],lights=[],notes=["Floor plan dimensions are estimates, not a survey.","Wall and floor thicknesses are proposed at 0.15 m. Materials and lighting are a preview treatment."];
    if(plan.anchors.some(a=>a.sizeBasis==="design"))notes.push("Object sizes marked proposed design are working estimates. Grouped dressing is represented by a single simplified proxy; repeated units and fine details are not modelled in this preview.");
    if(!spaces.some(s=>s.id===location.id&&s.footprint.length>=3))throw new Error("Add this space's footprint to the floor plan first.");
    const family=root.locationSpatialFamily(owner,list);let baseNote=false;
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
      for(let ei=0;ei<poly.length;ei++){
        const a=poly[ei],b=poly[(ei+1)%poly.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]),u=[(b[0]-a[0])/length,(b[1]-a[1])/length];
        const openings=(s.openings||[]).filter(o=>o.edge===ei).map(o=>{
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
            add(`wall-${si}-${ei}-${ci}-${zi}`,(s.name||"Space")+" wall",[a[0]+u[0]*middle,a[1]+u[1]*middle,s.floorZ+z],
              [right-left,0.15,top-bottom],[0,0,Math.atan2(u[1],u[0])]);
          }
        }
      }
      add("ceiling-"+si,(s.name||"Space")+" ceiling",[(low[0]+high[0])/2,(low[1]+high[1])/2,s.floorZ+height+0.075],size,[0,0,0],
        {kind:"prism",footprint:poly.map(p=>[(p[0]-low[0])/size[0]-0.5,(p[1]-low[1])/size[1]-0.5])});
      lights.push({position:[(low[0]+high[0])/2,(low[1]+high[1])/2,s.floorZ+height-0.15],colour:[1,0.92,0.8],powerWatts:Math.min(4000,Math.max(200,size[0]*size[1]*8)),sizeMetres:Math.min(15,Math.max(0.5,Math.min(size[0],size[1])/2))});
    });
    plan.anchors.forEach((anchor,i)=>{
      const room=root.locationAnchorSpaceOf(anchor,family)||owner,sp=spaces.find(s=>s.id===room.id);
      if(!sp)throw new Error("Add the footprint for "+(room.name||"each object's room")+".");
      if(isOpening(anchor,sp)){
        if(!savedOpening(anchor,sp))throw new Error("Add "+anchor.name+" to its room's floor-plan openings, with its dimensions.");
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
      add("anchor-"+i,anchor.name,shape.position,shape.size,shape.rotation,
        {anchorId:anchor.id,material:"dressing",basis:anchor.sizeBasis||"design"});
    });
    if(baseNote)notes.push("This floor plan saves objects' base heights; the preview stands each object on its saved height.");
    if(lights.length>16)throw new Error("This preview supports up to sixteen spaces.");
    const cameras={};
    root.locationPanelPoses(location,list).forEach(p=>{
      if(!p.pose.position)throw new Error("The "+(p.label||p.key)+" camera has no position yet.");
      cameras[p.key]={position:p.pose.position,yaw:p.pose.yaw,pitch:p.pose.pitch,lensMm:p.pose.lensMm};
      if(p.source==="suggested")notes.push(p.label+" uses the suggested camera position; edit it under Camera views.");
    });
    const scene={schema:C().SCHEMA,name:tidy(location.name||"Location preview"),units:"metres",axes:"+Z up; +Y north; +X east",
      status:"development blockout",notes,objects,cameras,previewLights:lights,materials:{
        floor:{baseColor:[0.22,0.25,0.28],metallic:0.1,roughness:0.65},
        wall:{baseColor:[0.55,0.58,0.6],metallic:0.05,roughness:0.7},
        dressing:{baseColor:[0.46,0.34,0.2],metallic:0.05,roughness:0.6},
      }};
    if(!root.KinolotSetDetail)throw new Error("The set detail builder did not load. Refresh this page before building.");
    return root.KinolotSetDetail.build(C().validateScene(scene),{space:spaces.find(s=>s.id===location.id),
      anchors:plan.anchors.filter(a=>(root.locationAnchorSpaceOf(a,family)||owner).id===location.id)});
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
  root.KinolotCloudRender={enabled,inputIssues,inputIssueList,cameraProblems,noteJob,jobState,buildScene,request,requestIdentity,estimateSeconds,
    buildMoments,setBuildMoment,buildMoment};
})(typeof window!=="undefined"?window:globalThis);
