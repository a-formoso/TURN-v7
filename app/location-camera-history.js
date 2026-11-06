/* Bounded camera-action provenance. Data only; never infers historical actors or triggers rendering. */
(function(root){
  const labels={"camera-edit":"Edited camera settings","camera-reset":"Returned to the planned camera","suggested-cameras":"Applied suggested cameras","angle-assigned":"Assigned a previewed camera angle","floor-plan-edit":"Edited the floor plan","layout-proposal":"Confirmed a proposed floor plan","reference-cameras":"Updated reference camera settings","view-settings":"Edited view settings","location-settings":"Updated location settings"};
  const pose=p=>({position:Array.isArray(p?.position)?p.position.slice(0,3):null,yaw:p?.yaw??0,pitch:p?.pitch??0,lensMm:p?.lensMm??24,target:String(p?.target||"").slice(0,160)});
  const near=(a,b,e)=>a==null&&b==null||typeof a==="number"&&typeof b==="number"&&Math.abs(a-b)<=e;
  function same(a,b){if(!a||!b)return a===b;
    const pos=!a.position&&!b.position||a.position&&b.position&&a.position.every((n,i)=>near(n,b.position[i],.05));
    const angle=Math.abs(((a.yaw-b.yaw+540)%360+360)%360-180);
    return !!pos&&angle<=.5&&near(a.pitch,b.pitch,.5)&&near(a.lensMm,b.lensMm,.5)&&a.target===b.target;
  }
  const snapshot=(l,list)=>Object.fromEntries(root.locationPanelPoses(l,list).map(p=>[p.key,pose(p.pose)]));
  const valid=p=>p&&["yaw","pitch","lensMm"].every(k=>typeof p[k]==="number"&&Number.isFinite(p[k]))&&(!p.position||Array.isArray(p.position)&&p.position.length===3&&p.position.every(Number.isFinite));
  function history(l){return (Array.isArray(l?.cameraChangeHistory)?l.cameraChangeHistory:[])
    .filter(e=>e?.v===1&&Object.hasOwn(labels,e.cause)&&typeof e.at==="string"&&Number.isFinite(Date.parse(e.at))&&Array.isArray(e.changes))
    .map(e=>({...e,changes:e.changes.filter(c=>c&&["TL","TR","BL","BR"].includes(c.panel)&&valid(c.after)&&(!c.before||valid(c.before)))})).filter(e=>e.changes.length).slice(-12);}
  function apply(list,id,patch,action,at=new Date().toISOString()){
    const target=list.find(l=>l.id===id);if(!target)return list;
    const {cameraChangeHistory:ignored,...data}=patch||{};
    let next=list.map(l=>l.id===id?{...l,...data}:l);
    const keys=Object.keys(data),influence=["spatialPlan","coverageViews","staging","plateCameras","name","intExt","drawnAt","worldScale","architecture","topology","continuityAnchors"];
    if(!keys.some(k=>influence.includes(k)))return next;
    const cause=Object.hasOwn(labels,action?.kind)?action.kind:data.spatialPlan?"floor-plan-edit":data.coverageViews||data.staging?"view-settings":Object.hasOwn(data,"plateCameras")?"reference-cameras":"location-settings";
    try{
      const owner=root.locationSpatialOwner(target,list).id;
      next=next.map(l=>{
        if(l.id!==id&&root.locationSpatialOwner(l,list).id!==owner)return l;
        const previous=list.find(x=>x.id===l.id),before=snapshot(previous,list),after=snapshot(l,next);
        const changes=Object.keys(after).filter(k=>!same(before[k],after[k])).map(panel=>({panel,before:before[panel],after:after[panel]}));
        return changes.length?{...l,cameraChangeHistory:history(previous).concat({v:1,at,cause,changes}).slice(-12)}:l;
      });
    }catch(_){/* A provenance failure must never prevent the user's actual edit. Unknown remains unknown. */}
    return next;
  }
  function differences(meta,l){
    if(!meta?.platePanels?.panels)return [];
    const now=snapshot(l,((root.turnContinuity||{}).locations)||[l]),events=history(l);
    return Object.keys(now).flatMap(panel=>{
      const previous=meta.platePanels.panels[panel],before=previous?pose(previous):null,after=now[panel];
      if(same(before,after))return [];
      const event=[...events].reverse().find(e=>e.changes.some(c=>c.panel===panel&&same(c.after,after)));
      return [{panel,before,after,cause:event?labels[event.cause]:"Cause not recorded",at:event?.at||""}];
    });
  }
  root.KinolotCameraHistory={labels,pose,same,history,apply,differences};
})(typeof window!=="undefined"?window:globalThis);
