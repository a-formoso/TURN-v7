/* Cloud set previews use one explicit metric scene. No model infers positions here. */
(function(root){
  "use strict";
  const C=()=>root.KinolotRenderContract;
  const requestCache=new Map();
  const local=()=>!!root.location&&["localhost","127.0.0.1","::1"].includes(root.location.hostname);
  function enabled(){return local()&&root.turnIsAdmin===true;}
  const tidy=(s,max=160)=>String(s||"").replace(/[\u0000-\u001f]/g," ").trim().slice(0,max);
  const finite=(n)=>typeof n==="number"&&Number.isFinite(n);
  function buildScene(location,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    const state=root.locationSpatialPlanState(location,list),owner=state.owner,plan=state.plan;
    if(!state.ready)throw new Error(state.reason);
    const coords=plan.coordinates;
    if(!coords||!coords.spaces.length)throw new Error("Add the location's footprint to the floor plan first.");
    const spaces=coords.spaces,objects=[],lights=[],notes=["Floor plan dimensions are estimates, not a survey.","Wall and floor thicknesses are proposed at 0.15 m. Materials and lighting are a preview treatment."];
    if(!spaces.some(s=>s.id===location.id&&s.footprint.length>=3))throw new Error("Add this space's footprint to the floor plan first.");
    const family=root.locationSpatialFamily(owner,list);
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
      if(root.locationAnchorIsOpening(anchor)){
        if(!(sp.openings||[]).some(o=>o.id===anchor.id||tidy(o.name).toLowerCase()===tidy(anchor.name).toLowerCase()))throw new Error("Add "+anchor.name+" to its room's floor-plan openings, with its dimensions.");
        return;
      }
      if(!anchor.xy||!anchor.size)throw new Error("Set the floor plan position and width, depth and height for "+(anchor.name||"each fixed object")+".");
      const z=finite(anchor.z)?anchor.z:sp.floorZ+anchor.size[2]/2;
      if(!finite(anchor.z))notes.push(tidy(anchor.name,80)+" has no saved centre height; it stands on its room's floor in this preview.");
      add("anchor-"+i,anchor.name,[anchor.xy[0],anchor.xy[1],z],anchor.size,[0,0,-(anchor.facing||0)*Math.PI/180],
        {anchorId:anchor.id,material:"dressing",basis:anchor.sizeBasis||"design"});
    });
    if(lights.length>16)throw new Error("This preview supports up to sixteen spaces.");
    const cameras={};
    root.locationPanelPoses(location,list).forEach(p=>{
      if(!p.pose.position)throw new Error("Set all four camera positions in the floor plan.");
      cameras[p.key]={position:p.pose.position,yaw:p.pose.yaw,pitch:p.pose.pitch,lensMm:p.pose.lensMm};
      if(p.source==="suggested")notes.push(p.label+" uses the suggested camera position; edit it under Camera views.");
    });
    const scene={schema:C().SCHEMA,name:tidy(location.name||"Location preview"),units:"metres",axes:"+Z up; +Y north; +X east",
      status:"development blockout",notes,objects,cameras,previewLights:lights,materials:{
        floor:{baseColor:[0.22,0.25,0.28],metallic:0.1,roughness:0.65},
        wall:{baseColor:[0.55,0.58,0.6],metallic:0.05,roughness:0.7},
        dressing:{baseColor:[0.46,0.34,0.2],metallic:0.05,roughness:0.6},
      }};
    return C().validateScene(scene);
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
  root.KinolotCloudRender={enabled,buildScene,request,requestIdentity};
})(typeof window!=="undefined"?window:globalThis);
