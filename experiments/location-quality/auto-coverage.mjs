/* Offline scene-aware coverage experiment. No account, image-model or renderer requests. */
const RAD=Math.PI/180;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const rounded=n=>Math.round(n*100)/100;
const panels=['TL','TR','BL','BR'];
function inside(point,polygon){
  let hit=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return hit;
}
function edgeDistance(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy),0,1);
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}
function aim(position,target,lensMm){
  const dx=target[0]-position[0],dy=target[1]-position[1];
  return {position:position.map(rounded),yaw:rounded((Math.atan2(dx,dy)/RAD+360)%360),
    pitch:rounded(clamp(Math.atan2(target[2]-position[2],Math.hypot(dx,dy))/RAD,-40,30)),lensMm,basis:'design'};
}
function rectFor(T,api,pose,box){
  const camera=api.cameraFor(T,pose),points=[];
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const point=new T.Vector3(x,y,z).project(camera);
    if(point.z>=-1&&point.z<1)points.push([(point.x+1)/2,(1-point.y)/2]);
  }
  if(points.length<4)return null;
  const raw=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
  const clipped=raw.map(v=>clamp(v,0,1));
  const area=(clipped[2]-clipped[0])*(clipped[3]-clipped[1]);
  if(area<.002)return null;
  return {rect:clipped,area,retained:area/Math.max(.0001,(raw[2]-raw[0])*(raw[3]-raw[1]))};
}
export function planCoverage(T,previewApi,scene,space,{priorities={}}={}){
  const rig=previewApi.sceneFor(T,scene),byId=new Map();
  try{
    for(const mesh of rig.meshes){
      const id=mesh.userData.anchorId;if(!id)continue;
      const group=byId.get(id)||{id,name:mesh.name.split(' · ')[0],box:new T.Box3(),meshes:[]};
      group.box.union(new T.Box3().setFromObject(mesh));group.meshes.push(mesh);byId.set(id,group);
    }
    const features=[...byId.values()].map(f=>{
      const size=f.box.getSize(new T.Vector3()),point=f.box.getCenter(new T.Vector3()).toArray();
      return {...f,size,point,weight:priorities[f.id]??1};
    }).filter(f=>f.weight>0&&!/\b(?:ceiling|light|lamp|clerestory|window|door|tape|line|markings)\b/i.test(f.name));
    if(features.length<2)throw Error('The set needs at least two modelled subjects for distinct detail coverage.');
    const xs=space.footprint.map(p=>p[0]),ys=space.footprint.map(p=>p[1]);
    const min=[Math.min(...xs),Math.min(...ys)],max=[Math.max(...xs),Math.max(...ys)],span=Math.hypot(max[0]-min[0],max[1]-min[1]);
    const centre=[(min[0]+max[0])/2,(min[1]+max[1])/2,space.floorZ+1.1];
    const boxes=rig.meshes.map(mesh=>new T.Box3().setFromObject(mesh)),positions=[];
    const ceiling=space.openSky?space.floorZ+5:space.floorZ+space.ceilingH;
    for(let i=0;i<=10;i++)for(let j=0;j<=10;j++)for(const height of [1.5,2.0]){
      const position=[min[0]+.4+(max[0]-min[0]-.8)*i/10,min[1]+.4+(max[1]-min[1]-.8)*j/10,Math.min(ceiling-.3,space.floorZ+height)].map(rounded);
      if(!inside(position,space.footprint)||space.footprint.some((a,k)=>edgeDistance(position,a,space.footprint[(k+1)%space.footprint.length])<.25))continue;
      if(position[2]<space.floorZ+.3)continue;
      const point=new T.Vector3(...position);
      // Conservative clearance against every constructed part, not a group proxy or a saved camera seed.
      if(boxes.some(box=>box.clone().expandByScalar(.08).containsPoint(point)))continue;
      positions.push(position);
    }
    if(!positions.length)throw Error('No clear camera stations were found in the assembled set.');
    const ray=new T.Raycaster();
    function visibility(pose,feature,rect){
      const camera=previewApi.cameraFor(T,pose);let hits=0,total=0;
      for(const u of [.2,.5,.8])for(const v of [.2,.5,.8]){
        const x=rect[0]+(rect[2]-rect[0])*u,y=rect[1]+(rect[3]-rect[1])*v;
        ray.setFromCamera(new T.Vector2(x*2-1,1-y*2),camera);
        const first=ray.intersectObjects(rig.meshes,false)[0];total++;
        if(first?.object.userData.anchorId===feature.id)hits++;
      }
      return hits/total;
    }
    const wide=[];
    for(const position of positions)for(const lens of [18,21,24]){
      const pose=aim(position,centre,lens),subjects=features.map(feature=>({feature,projection:rectFor(T,previewApi,pose,feature.box)})).filter(s=>s.projection&&s.projection.retained>.65);
      if(subjects.length<2)continue;
      const sum=subjects.reduce((score,s)=>score+s.feature.weight*Math.sqrt(s.projection.area),0);
      const largest=Math.max(...subjects.map(s=>s.projection.area));
      const score=sum+subjects.length*.12-Math.max(0,largest-.55)*3+Math.hypot(position[0]-centre[0],position[1]-centre[1])/Math.max(span,1)*.5;
      wide.push({pose,subjects,score});
    }
    wide.sort((a,b)=>b.score-a.score);
    const clearWide=[];
    // Spread the expensive checks across different stations; a lens variant must not exhaust the shortlist.
    const stations=new Set();
    for(const candidate of wide){
      const station=candidate.pose.position.join();if(stations.has(station))continue;stations.add(station);
      const visible=candidate.subjects.filter(s=>visibility(candidate.pose,s.feature,s.projection.rect)>=2/9);
      if(visible.length>=2)clearWide.push({...candidate,visible,score:visible.reduce((n,s)=>n+s.feature.weight*Math.sqrt(s.projection.area),0)+visible.length*.12});
      if(stations.size>=50)break;
    }
    clearWide.sort((a,b)=>b.score-a.score);
    const first=clearWide[0];if(!first)throw Error('The assembled set has no clear establishing view.');
    const other=clearWide.filter(c=>Math.hypot(c.pose.position[0]-first.pose.position[0],c.pose.position[1]-first.pose.position[1])>span*.22
      &&Math.cos((c.pose.yaw-first.pose.yaw)*RAD)<.5).sort((a,b)=>{
        const gain=c=>c.score+c.visible.filter(s=>!first.visible.some(x=>x.feature.id===s.feature.id)).length*.5;
        return gain(b)-gain(a);
      })[0];
    if(!other)throw Error('The assembled set has no complementary wide view.');
    const details=[];
    for(const feature of features){
      if(feature.size.z<.25||feature.box.getSize(new T.Vector3()).length()<.3)continue;
      const candidates=[];
      for(const position of positions)for(const lens of [24,28,35]){
        const pose=aim(position,feature.point,lens),projection=rectFor(T,previewApi,pose,feature.box);
        if(!projection||projection.retained<.8||projection.area<.06||projection.area>.7)continue;
        const centreError=Math.hypot((projection.rect[0]+projection.rect[2])/2-.5,(projection.rect[1]+projection.rect[3])/2-.5);
        candidates.push({pose,projection,score:feature.weight-Math.abs(projection.area-.3)-centreError*.5});
      }
      candidates.sort((a,b)=>b.score-a.score);
      for(const candidate of candidates.slice(0,30)){
        const visible=visibility(candidate.pose,feature,candidate.projection.rect);
        if(visible<3/9)continue;
        details.push({...candidate,feature,visible,score:candidate.score+visible*.4});break;
      }
    }
    details.sort((a,b)=>b.score-a.score||a.feature.id.localeCompare(b.feature.id));
    if(details.length<2)throw Error('Two distinct subjects could not be framed clearly in this assembled set.');
    const chosen=[first,other,details[0],details.find(d=>d.feature.id!==details[0].feature.id)];
    if(!chosen[3])throw Error('Distinct detail coverage is unavailable.');
    return {status:'geometry-proposal',readyForFinalRender:false,semanticIntentValidated:false,
      method:'same-scene-search-and-mesh-visibility',panels:chosen.map((c,i)=>({key:panels[i],role:i<2?'wide':'detail',pose:c.pose,
      ...(c.feature?{subjectId:c.feature.id,subject:c.feature.name,visibleSamples:c.visible}:{subjects:c.visible.map(s=>s.feature.name)})})),
      limitations:['Geometric framing only; unsupported geometry and natural-language intent are not repaired.','No guarantee of photographic finish or subjective shot preference.','Not integrated into the app.']};
  }finally{rig.dispose();}
}
