/* Reviewable image-to-camera fit. The image supplies observations, never set geometry. */
(function(root){
  "use strict";
  const KEYS=["TL","TR","BL","BR"],active=new Set(),D=Math.PI/180;
  const finite=n=>typeof n==="number"&&Number.isFinite(n),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const canonical=x=>root.KinolotRenderContract.canonical(x);
  function project(pose,point){
    const y=pose.yaw*D,p=pose.pitch*D,s=Math.sin(y),c=Math.cos(y),a=Math.sin(p),b=Math.cos(p);
    const v=point.map((x,i)=>x-pose.position[i]),dot=q=>q.reduce((n,x,i)=>n+x*v[i],0),z=dot([s*b,c*b,a]);
    if(z<=.05)return null;
    return [.5+dot([c,-s,0])*pose.lensMm/(36*z),.5-dot([-s*a,-c*a,b])*pose.lensMm*16/(36*9*z)];
  }
  function catalogue(scene,plan,roomId){
    const points=[];
    const add=(point,name,corner,objectId)=>{if(point.every(finite))points.push({id:"L"+(points.length+1),point,name,corner,objectId});};
    // Only saved, named objects. These are bounding corners, not invented detailed furniture geometry.
    const sp=plan.coordinates.spaces.find(x=>x.id===roomId),included=new Set(scene.objects.map(x=>x.anchorId).filter(Boolean));
    const objects=plan.anchors.filter(a=>included.has(a.id)&&a.xy&&a.size
      &&(root.locationAnchorSpaceOf(a,root.turnContinuity?.locations||[])?.id||roomId)===roomId).slice(0,20).map(a=>{
      const z=finite(a.z)?a.z:sp.floorZ,base=root.locationAnchorHeightBasis(a,plan)==="base";
      let centre=finite(a.z)&&!base?z:z+a.size[2]/2;
      if(base&&!sp.openSky&&finite(sp.ceilingH))centre=clamp(centre,sp.floorZ+a.size[2]/2,sp.floorZ+sp.ceilingH-a.size[2]/2);
      return {id:a.id,name:a.name,position:[...a.xy,centre],size:a.size,rotation:[0,0,-(a.facing||0)*D]};
    });
    for(const o of objects){
      const r=o.rotation[2],c=Math.cos(r),s=Math.sin(r);
      for(const z of [-1,1])for(const y of [-1,1])for(const x of [-1,1]){
        const dx=x*o.size[0]/2,dy=y*o.size[1]/2;
        add([o.position[0]+c*dx-s*dy,o.position[1]+s*dx+c*dy,o.position[2]+z*o.size[2]/2],o.name,
          (z>0?"top":"bottom")+" local "+(x>0?"+X":"-X")+" / "+(y>0?"+Y":"-Y")+" bounding corner",o.id);
      }
    }
    for(const o of sp?.openings||[]){
      const heights=root.locationOpeningHeights(o,sp,plan),poly=root.KinolotRenderContract.polygon(sp.footprint),a=poly[o.edge],b=poly[(o.edge+1)%poly.length];
      if(!a||!b||!o.centre)continue;const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      for(const z of [heights.sillZ,heights.headZ])for(const side of [-1,1])
        add([o.centre[0]+side*(b[0]-a[0])*o.width/(2*length),o.centre[1]+side*(b[1]-a[1])*o.width/(2*length),z],o.name||o.kind,
          (z===heights.headZ?"top":"bottom")+" edge "+(side>0?"end":"start"),"");
    }
    return points;
  }
  function observations(raw,landmarks){
    if(!raw||!Array.isArray(raw.panels)||raw.panels.length!==4)throw Error("The image read did not identify four panels. No cameras were changed.");
    const known=new Map(landmarks.map(p=>[p.id,p]));
    return KEYS.map(key=>{
      const panels=raw.panels.filter(p=>p.key===key);if(panels.length!==1)throw Error("The image read repeated or omitted a panel. No cameras were changed.");
      const panel=panels[0],seen=new Set();
      if(!Array.isArray(panel.points)||panel.points.length>landmarks.length)throw Error("The image read returned invalid landmarks.");
      const points=panel.points.map(p=>{
        if(!known.has(p.id)||seen.has(p.id)||!Array.isArray(p.uv)||p.uv.length!==2||!p.uv.every(n=>finite(n)&&n>=0&&n<=1))
          throw Error("The image read returned an unknown, repeated or invalid landmark. No cameras were changed.");
        seen.add(p.id);return {...known.get(p.id),uv:p.uv};
      });
      if(points.length<6||new Set(points.map(p=>p.name)).size<2)throw Error(key+" needs at least six clear landmarks across two saved features. Try another ideas image or adjust the 3D cameras.");
      const spans=[0,1].map(i=>Math.max(...points.map(p=>p.uv[i]))-Math.min(...points.map(p=>p.uv[i])));
      if(spans[0]<.18||spans[1]<.18)throw Error(key+" has too little visible landmark spread for a reliable camera fit.");
      const centre=[0,1,2].map(i=>points.reduce((s,p)=>s+p.point[i]/points.length,0));
      const cov=centre.map((_,i)=>centre.map((_,j)=>points.reduce((s,p)=>s+(p.point[i]-centre[i])*(p.point[j]-centre[j])/points.length,0)));
      const [a,b,c]=cov,det=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
      if(det<1e-7*Math.pow(a[0]+b[1]+c[2],3))throw Error(key+" needs visible landmarks at different depths, not only one flat surface.");
      return {key,points};
    });
  }
  function solveLinear(A,b){
    const a=A.map((r,i)=>[...r,b[i]]),n=b.length;
    for(let i=0;i<n;i++){
      let k=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;
      if(Math.abs(a[k][i])<1e-14)return null;[a[i],a[k]]=[a[k],a[i]];
      const d=a[i][i];for(let j=i;j<=n;j++)a[i][j]/=d;
      for(let j=0;j<n;j++)if(j!==i){const q=a[j][i];for(let c=i;c<=n;c++)a[j][c]-=q*a[i][c];}
    }
    return a.map(r=>r[n]);
  }
  function fit(points,seeds,bounds,valid=()=>true){
    const scale=Math.max(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1],1);
    const encode=p=>[...p.position.map(x=>x/scale),p.yaw*D,p.pitch*D,Math.log(p.lensMm)];
    const decode=q=>({position:q.slice(0,3).map(x=>x*scale),yaw:((q[3]/D)%360+360)%360,pitch:q[4]/D,lensMm:Math.exp(q[5]),basis:"design"});
    const limit=q=>q.map((x,i)=>i<3?clamp(x,bounds.min[i]/scale,bounds.max[i]/scale):i===4?clamp(x,-60*D,45*D):i===5?clamp(x,Math.log(12),Math.log(100)):x);
    const residual=q=>{
      const pose=decode(q),out=[];
      for(const p of points){const uv=project(pose,p.point);if(!uv)return null;out.push(uv[0]-p.uv[0],(uv[1]-p.uv[1])*9/16);}
      return out;
    };
    const cost=r=>r?r.reduce((s,x)=>s+x*x,0):Infinity;
    const candidates=[];
    for(const seed of seeds){
      if(!Array.isArray(seed.position)||seed.position.length!==3||!seed.position.every(finite)||![seed.yaw,seed.pitch,seed.lensMm].every(finite)||seed.lensMm<=0)continue;
      let q=limit(encode(seed)),r=residual(q),score=cost(r),lambda=.001;if(!r)continue;
      for(let iter=0;iter<85;iter++){
        const cols=q.map((_,j)=>{const a=q.slice(),h=1e-5;a[j]+=h;const rr=residual(a);return rr?rr.map((x,i)=>(x-r[i])/h):r.map(()=>0);});
        const A=cols.map((a,i)=>cols.map((b,j)=>a.reduce((n,x,k)=>n+x*b[k],0)+(i===j?lambda:0)));
        const g=cols.map(a=>-a.reduce((n,x,k)=>n+x*r[k],0)),step=solveLinear(A,g);if(!step)break;
        const next=limit(q.map((x,i)=>x+clamp(step[i],-.4,.4))),nr=residual(next),ns=cost(nr);
        if(ns<score){const improvement=score-ns;q=next;r=nr;score=ns;lambda=Math.max(1e-9,lambda*.3);if(improvement<1e-12)break;}
        else{lambda*=8;if(lambda>1e8)break;}
      }
      const pose=decode(q);if(!valid(pose))continue;
      const errors=points.map(p=>{const v=project(pose,p.point);return v?Math.hypot(v[0]-p.uv[0],(v[1]-p.uv[1])*9/16):Infinity;});
      candidates.push({pose,rms:Math.sqrt(score/points.length),max:Math.max(...errors)});
    }
    candidates.sort((a,b)=>a.rms-b.rms);const best=candidates[0];
    if(!best||best.rms>.018||best.max>.045)throw Error("The image's landmarks do not fit this fixed set closely enough. No cameras were changed.");
    // Near-equivalent projections from materially different stations are ambiguous, not a confident recovery.
    const ambiguous=candidates.some(c=>c!==best&&c.rms<=Math.max(.002,best.rms*1.15)
      &&Math.hypot(...c.pose.position.map((x,i)=>x-best.pose.position[i]))>scale*.12);
    if(ambiguous)throw Error("More than one camera position fits these landmarks. Try clearer views or adjust the 3D cameras.");
    return best;
  }
  function scopeGuard(s){
    if(!root.BlenderPreview.isCurrent(s))throw Error("The open film or sign-in changed. Match the views again.");
    if(typeof root.turnArtRoomWritable==="function"&&!root.turnArtRoomWritable())throw Error("This film is read-only.");
  }
  function location(id){const list=root.turnContinuity.locations,l=list.find(l=>l.id===id);if(!l)throw Error("The location is no longer in this film.");return {l,list};}
  const sourceKey=d=>canonical({iso:d.meta.iso,inputKey:d.meta.inputKey,modelId:d.meta.modelId});
  async function sameSource(id,s,stamp){const now=await root.KinolotCameraInspiration.load(id,s);scopeGuard(s);if(!now||now.stale||sourceKey(now)!==stamp)throw Error("The ideas image or location changed. Match the current image again.");return now;}
  async function confirm(id,s,proposal){
    scopeGuard(s);if(canonical(proposal.imageMatch.scope)!==canonical(s))throw Error("The open film or sign-in changed. Match the views again.");
    await sameSource(id,s,proposal.imageMatch.sourceKey);scopeGuard(s);
    const {l,list}=location(id);return root.KinolotCloudRender.cameraProposalViews(l,proposal,list);
  }
  function boundsFor(plan,id){
    const sp=plan.coordinates.spaces.find(s=>s.id===id),poly=root.KinolotRenderContract.polygon(sp.footprint);
    if(!finite(sp.floorZ)||!finite(sp.ceilingH))throw Error("Camera matching currently needs an enclosed room with a saved floor and ceiling height.");
    return {min:[Math.min(...poly.map(p=>p[0]))+.25,Math.min(...poly.map(p=>p[1]))+.25,sp.floorZ+.25],
      max:[Math.max(...poly.map(p=>p[0]))-.25,Math.max(...poly.map(p=>p[1]))-.25,sp.floorZ+sp.ceilingH-.15]};
  }
  async function references(scene,plan,landmarks){
    const preview=root.KinolotAnglePreview,T=await preview.load(),instance=preview.create(T,scene,{anchors:plan.anchors,openings:preview.openingGuides(plan),softwareOnly:true});
    try{
      return KEYS.map(key=>{
        const canvas=root.document.createElement("canvas"),ctx=canvas.getContext("2d");instance.render(canvas,scene.cameras[key],768,432);
        const visible=[];
        for(const p of landmarks){
          const uv=project(scene.cameras[key],p.point);if(!uv||uv.some(n=>n<.025||n>.975))continue;
          // Rendered geometry can be more detailed than the saved bounding box. Only label actual visible corners.
          if(!instance.landmarkVisible(scene.cameras[key],p.point))continue;
          const x=uv[0]*768,y=uv[1]*432;
          if(visible.some(v=>Math.hypot(v.x-x,v.y-y)<20))continue;
          visible.push({id:p.id,x,y});ctx.fillStyle="#ffd65a";ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();
          ctx.font="bold 13px sans-serif";ctx.lineWidth=3;ctx.strokeStyle="#101820";ctx.strokeText(p.id,x+5,y-5);ctx.fillText(p.id,x+5,y-5);
        }
        return {key,url:canvas.toDataURL("image/png"),visible:visible.map(v=>v.id)};
      });
    }finally{instance.dispose();}
  }
  function readPrompt(landmarks,refs){
    return "Match compositions to a FIXED measured 3D set. Image 1 is the desired four-view 2x2 ideas grid: TL, TR, BL, BR. Images 2-5 are labelled reference renders of the SAME fixed set, in that order. They are orientation guides, not desired compositions. Yellow dots locate the exact labelled 3D bounding/opening corners in the catalogue. The ideas image may contradict the set. Never invent correspondences, infer hidden points, alter dimensions, or estimate a new layout. Read only visible, clearly corresponding corners in each desired panel. UV coordinates must be normalized within THAT PANEL, left to right and top to bottom. Use only exact catalogue landmark IDs. Omit uncertain, occluded, cropped, changed or ambiguous corners, and return an empty points list if too few can be identified. At least six spread-out points across two saved features are needed; never fabricate them to meet this requirement. Return JSON only: {panels:[{key:'TL',points:[{id:'L1',uv:[0.1,0.2]}]},...all four keys]}. No camera guesses, prose or geometry. Reference labels visible by image: "+JSON.stringify(refs.map(r=>({panel:r.key,ids:r.visible})))+". Saved landmark catalogue: "+JSON.stringify(landmarks);
  }
  async function match(id,s,{onPhase}={}){
    scopeGuard(s);const k=[s.uid,s.projectId,id].join(":");if(active.has(k))throw Error("Camera matching is already in progress for this location.");
    active.add(k);
    try{
      const api=root.KinolotCloudRender,{l,list}=location(id),state=root.locationSpatialPlanState(l,list);
      if(!state.ready)throw Error("Confirm the floor plan in step 2 before matching cameras.");
      const key=api.cameraProposalKey(l,list),source=await root.KinolotCameraInspiration.load(id,s);
      scopeGuard(s);if(!source||source.stale)throw Error("Generate current view ideas before matching cameras.");
      const stamp=sourceKey(source),defaults=api.proposeCameras(l,list),views=api.cameraProposalViews(l,defaults,list),proposed={...l,coverageViews:views};
      const scene=api.buildScene(proposed,list.map(x=>x.id===id?proposed:x)),landmarks=catalogue(scene,state.plan,id),bounds=boundsFor(state.plan,id);
      if(landmarks.length<6)throw Error("There are too few measured set features to match. Use the 3D camera controls.");
      const guard=()=>{scopeGuard(s);const now=location(id);if(api.cameraProposalKey(now.l,now.list)!==key)throw Error("The floor plan or cameras changed. Match the views again.");};
      onPhase?.("Preparing fixed-set references…");const refs=await references(scene,state.plan,landmarks);guard();
      if(refs.reduce((n,r)=>n+r.visible.length,0)<6)throw Error("Too few visible set corners could be labelled. Use the 3D camera controls.");
      const image=await root.turnDownscaleDataUrl(source.url,1536);guard();if(!image)throw Error("The ideas image could not be opened. Reopen the card and try again.");
      await sameSource(id,s,stamp);guard();onPhase?.("Reading shared landmarks · one writing call…");
      const result=await root.aiVisionComplete([{role:"user",content:readPrompt(landmarks,refs)}],[image,...refs.map(r=>r.url)],{maxTokens:5000,beforeSubmit:async()=>{await sameSource(id,s,stamp);guard();}});
      guard();await sameSource(id,s,stamp);guard();if(!result.vision)throw Error("The selected model could not read the image. No cameras were changed.");
      let raw;try{raw=JSON.parse(result.text.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/, ""));}catch(_){throw Error("The image read did not return usable landmark data. No cameras were changed.");}
      const observed=observations(raw,landmarks),panels=[];onPhase?.("Fitting cameras against the fixed set…");
      const seeds=Object.values(scene.cameras).concat(root.locationPanelPoses(l,list).map(p=>p.pose).filter(p=>p.position));
      for(const panel of observed){
        await new Promise(resolve=>root.setTimeout(resolve,0));guard();
        const points=panel.points,aim=points.reduce((p,c)=>p.map((v,i)=>v+c.point[i]/points.length),[0,0,0]);
        const starts=[];
        for(const seed of seeds){
          const v=aim.map((x,i)=>x-seed.position[i]),yaw=Math.atan2(v[0],v[1])/D,pitch=Math.atan2(v[2],Math.hypot(v[0],v[1]))/D;
          for(const lensMm of [18,28,45])starts.push({...seed,yaw,pitch,lensMm});
          starts.push(seed);
        }
        const valid=pose=>{try{const next={...l,coverageViews:root.locationCoverageViewsWithPose(l,panel.key,pose)},liveList=list.map(x=>x.id===id?next:x);return !api.cameraProblems(next,liveList)[panel.key];}catch(_){return false;}};
        let fitted;try{fitted=fit(points,starts,bounds,valid);}catch(e){throw Error(panel.key+": "+e.message);}
        // Saved-pose normalization rounds some values. Verify the exact pose that Step Four will consume.
        const next={...l,coverageViews:root.locationCoverageViewsWithPose(l,panel.key,fitted.pose)},pose=root.locationPanelPoses(next,list.map(x=>x.id===id?next:x)).find(p=>p.key===panel.key).pose;
        const errors=points.map(p=>{const uv=project(pose,p.point);return uv?Math.hypot(uv[0]-p.uv[0],(uv[1]-p.uv[1])*9/16):Infinity;});
        const rms=Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),max=Math.max(...errors);
        if(rms>.018||max>.045)throw Error(panel.key+": The saved camera precision does not retain this fit. No cameras were changed.");
        panels.push({key:panel.key,role:"image-match",label:"Matched ideas view",pose,fit:{count:points.length,rms,max}});
      }
      guard();await sameSource(id,s,stamp);guard();
      const preview=root.KinolotAnglePreview,T=await preview.load(),check=preview.create(T,scene,{softwareOnly:true});
      try{for(const panel of panels){const points=observed.find(p=>p.key===panel.key).points;
        if(points.some(p=>!check.landmarkVisible(panel.pose,p.point)))throw Error(panel.key+": The fitted view hides a matched feature behind the set. Review the layout or use the 3D camera controls.");
      }}finally{check.dispose();}
      guard();
      const proposal={key,panels,warnings:["Experimental image match: landmark agreement is not proof of an exact visual match. Compare every reference panel with its fixed-set 3D preview before accepting. The set's dimensions and objects have not changed."],
        imageMatch:{sourceKey:stamp,iso:source.meta.iso,scope:{...s}},referenceUrl:source.url};
      api.cameraProposalViews(l,proposal,list);return proposal;
    }finally{active.delete(k);}
  }
  root.KinolotCameraMatch={project,catalogue,observations,fit,readPrompt,match,confirm};
})(window);
