/* Pure, bounded opening repair proposals. No saved data, service call or camera changes. */
(function(root){
  const finite=n=>typeof n==='number'&&Number.isFinite(n),round=n=>Math.round(n*1000)/1000;
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function propose(location,list){
    list=list||((root.turnContinuity||{}).locations)||[];
    const state=root.locationSpatialPlanState(location,list),owner=state.owner,original=root.normalizeLocationSpatialPlan(state.plan);
    const plan=JSON.parse(JSON.stringify(original)),changes=[],unresolved=[],family=root.locationSpatialFamily(owner,list);
    if(!plan.coordinates?.spaces?.length)throw Error('Add a room outline before suggesting opening measurements.');
    let spaceName='';
    function update(o,key,value,label,reason){
      if(equal(o[key],value))return;
      changes.push({space:spaceName,opening:o.name||'Unnamed opening',field:label,before:o[key]??null,after:value,reason});o[key]=value;o.basis='design';
    }
    for(const sp of plan.coordinates.spaces){
      spaceName=sp.name||sp.id;
      let poly;try{poly=root.KinolotRenderContract.polygon(sp.footprint);}catch(_){unresolved.push((sp.name||'This room')+': a valid room outline is needed first.');continue;}
      if(sp.openSky)continue;
      if(!finite(sp.ceilingH)){unresolved.push((sp.name||'This room')+': set or draft its ceiling height first.');continue;}
      const floor=sp.floorZ,ceiling=floor+sp.ceilingH;
      const anchors=plan.anchors.filter(a=>(root.locationAnchorSpaceOf(a,family)||owner).id===sp.id);
      const matched=new Set();
      for(const o of sp.openings){const a=anchors.find(a=>a.id===o.id||a.name.trim().toLowerCase()===o.name.trim().toLowerCase());if(a)matched.add(a.id);}
      const missing=anchors.filter(a=>root.locationAnchorIsOpening(a)&&!matched.has(a.id));
      const entries=sp.openings.slice();
      const placeholders=entries.filter(o=>!o.name.trim()&&!o.centre&&!finite(o.width)&&!finite(o.sillZ)&&!finite(o.headZ)&&o.edge==null&&!anchors.some(a=>a.id===o.id));
      if(!(placeholders.length===1&&missing.length===1)){
        for(const a of missing.slice())if(a.xy||finite(a.facing)||root.locWallYawFromText?.(a.placement||'')){
          if(entries.length>=16){unresolved.push((a.name||'This opening')+': this room already has sixteen openings.');continue;}
          const kind=/door/i.test(a.name)?'door':/arch|opening/i.test(a.name)?'arch':/glass|glaz|porthole/i.test(a.name)?'glass':'window';
          entries.push({id:a.id,name:a.name,kind,edge:null,centre:null,width:null,sillZ:null,headZ:null,yaw:null,connectsTo:'',basis:'design'});
          changes.push({space:spaceName,opening:a.name,field:'Opening entry',before:null,after:'Added from the saved layout landmark',reason:'The named opening already exists in the saved layout.'});
          const used=missing.findIndex(x=>x.id===a.id);if(used>=0)missing.splice(used,1);
        }
      }
      const kept=[];
      for(const o of entries){
        const blank=!o.name.trim()&&!o.centre&&!finite(o.width)&&!finite(o.sillZ)&&!finite(o.headZ)&&o.edge==null&&!o.connectsTo;
        let anchor=anchors.find(a=>a.id===o.id||o.name.trim()&&a.name.trim().toLowerCase()===o.name.trim().toLowerCase());
        if(blank&&anchor){update(o,'name',anchor.name,'Opening name','Matched the existing opening ID to its saved landmark.');}
        else if(!anchor&&blank&&missing.length===1){anchor=missing.pop();update(o,'name',anchor.name,'Opening name','Matched the only opening landmark missing from this room.');}
        else if(blank){changes.push({space:spaceName,opening:'Unnamed opening',field:'Empty placeholder',before:'No name, position or dimensions',after:'Removed from proposed plan',reason:'An entirely empty editor row defines no geometry.'});continue;}
        kept.push(o);
        const effective=root.locationOpeningHeights(o,sp,plan);
        const needsHeight=!finite(effective.sillZ)||!finite(effective.headZ)||effective.sillZ<floor||effective.headZ>ceiling||effective.headZ<=effective.sillZ;
        if(needsHeight){
          const door=o.kind==='door'||o.kind==='arch';
          let bottom=finite(effective.sillZ)?Math.max(floor,Math.min(ceiling-.2,effective.sillZ)):floor+(door?0:Math.min(.9,sp.ceilingH*.4));
          let top=finite(effective.headZ)?Math.max(bottom+.1,Math.min(ceiling,effective.headZ)):Math.min(ceiling,floor+(door?2.1:Math.min(2.1,sp.ceilingH-.1)));
          if(top<=bottom)top=Math.min(ceiling,bottom+.1);
          update(o,'sillZ',round(bottom),'Opening bottom','Proposed blockout height within the saved room floor and ceiling.');
          update(o,'headZ',round(top),'Opening top','Proposed blockout height within the saved room floor and ceiling.');
        }
        let edge=Number.isInteger(o.edge)&&poly[o.edge]?o.edge:null;
        const point=o.centre||anchor?.xy;
        function project(i,p){const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),u=[dx/length,dy/length];const x=Math.max(0,Math.min(length,(p[0]-a[0])*u[0]+(p[1]-a[1])*u[1]));const q=[a[0]+x*u[0],a[1]+x*u[1]];return {i,a,u,length,x,q,distance:Math.hypot(p[0]-q[0],p[1]-q[1])};}
        if(edge==null&&point)edge=poly.map((_,i)=>project(i,point)).sort((a,b)=>a.distance-b.distance)[0].i;
        if(edge==null){
          const direction=finite(o.yaw)?o.yaw:finite(anchor?.facing)?anchor.facing:root.locWallYawFromText?.(anchor?.placement||'')?.yaw;
          if(finite(direction))edge=poly.map((_,i)=>({i,distance:Math.abs(root.locYawDiff(root.locationFootprintEdgeYaw(poly,i),direction))})).sort((a,b)=>a.distance-b.distance)[0]?.i;
        }
        if(edge==null){unresolved.push((o.name||'This opening')+': its wall cannot be determined from the saved layout.');continue;}
        const a=poly[edge],b=poly[(edge+1)%poly.length],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],p=project(edge,point||mid);
        if(p.length<.15){unresolved.push((o.name||'This opening')+': its wall is too short for an opening.');continue;}
        let width=finite(o.width)?o.width:anchor?.size?Math.max(anchor.size[0],anchor.size[1]):(o.kind==='door'||o.kind==='arch') ? .9 : 1.2;
        width=Math.max(.05,Math.min(width,p.length-.02));
        const along=Math.max(width/2+.005,Math.min(p.length-width/2-.005,p.x)),centre=[round(p.a[0]+along*p.u[0]),round(p.a[1]+along*p.u[1])];
        if(!finite(o.width)||width!==o.width)update(o,'width',round(width),'Opening width',finite(o.width)?'Fits the existing opening within its saved wall.':'Estimated from its landmark size or a standard blockout opening size.');
        if(edge!==o.edge||!o.centre||p.distance>.25||p.x-width/2<0||p.x+width/2>p.length){update(o,'centre',centre,'Opening centre',point?'Projected the saved opening or landmark position onto its wall.':'Estimated at the midpoint of its explicitly selected wall.');update(o,'edge',edge,'Wall index','Uses the saved wall or the nearest wall to the saved landmark.');}
      }
      sp.openings=kept;
    }
    plan.status='draft';plan.source=state.source;
    const reviewed={...plan,status:'reviewed'},next=list.map(l=>l.id===owner.id?{...l,spatialPlan:reviewed}:l);
    const remaining=root.KinolotCloudRender.inputIssueList(location.id===owner.id?{...location,spatialPlan:reviewed}:location,next).filter(i=>i.step===2);
    return {ownerId:owner.id,plan,changes,unresolved,remaining};
  }
  root.KinolotMeasurementRepair={propose};
})(typeof window!=='undefined'?window:globalThis);
