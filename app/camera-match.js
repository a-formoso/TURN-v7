/* Reviewable image-to-camera fit. The image supplies observations, never set geometry. */
(function(root){
  "use strict";
  const KEYS=["TL","TR","BL","BR"],active=new Set(),D=Math.PI/180;
  const panelName=key=>({TL:"top-left",TR:"top-right",BL:"bottom-left",BR:"bottom-right"}[key]||"selected");
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
    const objects=plan.anchors.filter(a=>included.has(a.id)&&a.xy&&a.size&&!(sp.openings||[]).some(o=>o.id===a.id)
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
          (z===heights.headZ?"top":"bottom")+" edge "+(side>0?"end":"start"),o.id);
    }
    // Wide views often expose room structure more clearly than furniture. Match the actual inner wall faces,
    // inset from the saved wall centre lines by half the renderer's 0.15 m wall thickness.
    if(sp&&!sp.openSky&&finite(sp.floorZ)&&finite(sp.ceilingH)){
      const poly=root.KinolotRenderContract.polygon(sp.footprint),area=poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p[0]*q[1]-q[0]*p[1];},0),sign=Math.sign(area);
      poly.forEach((p,i)=>{
        const before=poly[(i+poly.length-1)%poly.length],after=poly[(i+1)%poly.length];
        const normal=(a,b)=>{const len=Math.hypot(b[0]-a[0],b[1]-a[1]);return [-sign*(b[1]-a[1])/len,sign*(b[0]-a[0])/len];};
        const a=normal(before,p),b=normal(p,after),det=a[0]*b[1]-a[1]*b[0];if(Math.abs(det)<1e-6)return;
        const xy=[p[0]+.075*(b[1]-a[1])/det,p[1]+.075*(a[0]-b[0])/det];
        for(const [label,z] of [["floor",sp.floorZ],["ceiling",sp.floorZ+sp.ceilingH]])
          add([...xy,z],(sp.name||"Room")+" structure",label+" / inner wall corner "+(i+1),"");
      });
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
      if(points.length<6)throw Object.assign(Error("Couldn't identify enough shared features in the "+panelName(key)+" image to match this set. Your saved cameras are unchanged. Try another ideas image or adjust the 3D cameras."),
        {code:"camera_match_landmarks",panel:key,identified:points.length,required:6});
      const spans=[0,1].map(i=>Math.max(...points.map(p=>p.uv[i]))-Math.min(...points.map(p=>p.uv[i])));
      if(spans[0]<.18||spans[1]<.18)throw Error("The shared features identified in the "+panelName(key)+" image are too closely grouped to fit a camera. Your saved cameras are unchanged.");
      const centre=[0,1,2].map(i=>points.reduce((s,p)=>s+p.point[i]/points.length,0));
      const cov=centre.map((_,i)=>centre.map((_,j)=>points.reduce((s,p)=>s+(p.point[i]-centre[i])*(p.point[j]-centre[j])/points.length,0)));
      const [a,b,c]=cov,det=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
      if(det<1e-7*Math.pow(a[0]+b[1]+c[2],3))throw Error("The features identified in the "+panelName(key)+" image need different depths, not only one flat surface. Your saved cameras are unchanged.");
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
  async function sameSource(id,s,stamp){const now=await root.KinolotCameraInspiration.load(id,s);scopeGuard(s);if(!now||sourceKey(now)!==stamp)throw Error("The ideas image changed. Match the current image again.");return now;}
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
  function readPrompt(landmarks,refs,features=[]){
    return "Match camera compositions to a FIXED set. Image 1 is the desired 2x2 ideas grid: TL, TR, BL, BR. Images 2-5 are labelled reference renders of the saved set in that order. They are orientation guides, not desired compositions. The ideas image may have extra detail or different proportions. First describe each panel's intended framing: wide, medium or detail; choose 1-3 EXISTING subject IDs from the saved feature inventory, primary subject first, and give their approximate VISIBLE rectangles [left,top,right,bottom] in panel-local coordinates 0..1. Use recognizable driver/windshield/rear-door or equivalent features to distinguish view direction. For a wide interior choose a distinctive far-end opening or area as the primary subject, with near furniture or a side feature secondary. Do not use a long floor or ceiling strip as primary unless that is the actual detail shot. Use a side window or other secondary subject when useful to distinguish sides. For repeated similar furnishings, choose a suitable saved example for that composition; do not claim to identify a particular story row in an unlabelled image. Never add set objects, dimensions or camera coordinates. If no saved subject is recognizable, return subjects:[], not an invented identity.\nAdditionally, if exact corresponding corners can be identified confidently, provide points using the yellow landmark IDs and panel-local [u,v]. Never invent correspondences, infer hidden corners or fabricate points to reach six. A points:[] list is valid when only approximate composition can be read.\nReturn JSON only: {panels:[{key:'TL',framing:{mode:'wide',subjects:[{id:'existing-subject-id',rect:[0.1,0.2,0.8,0.9]}]},points:[]},...exactly TR,BL,BR]}. No explanatory prose or geometry. Subject inventory: "+JSON.stringify(features.map(f=>({id:f.id,name:f.name,type:f.type,position:f.point})))+". Reference landmark IDs: "+JSON.stringify(refs.map(r=>({panel:r.key,ids:r.visible})))+". Corner catalogue: "+JSON.stringify(landmarks);
  }
  async function match(id,s,{onPhase}={}){
    scopeGuard(s);const k=[s.uid,s.projectId,id].join(":");if(active.has(k))throw Error("Camera matching is already in progress for this location.");
    active.add(k);
    try{
      const api=root.KinolotCloudRender,{l,list}=location(id),state=root.locationSpatialPlanState(l,list);
      if(!state.ready)throw Error("Confirm the floor plan in step 2 before matching cameras.");
      const key=api.cameraProposalKey(l,list),source=await root.KinolotCameraInspiration.load(id,s);
      scopeGuard(s);if(!source)throw Error("Generate view ideas before matching cameras.");
      const stamp=sourceKey(source),defaults=api.proposeCameras(l,list),views=api.cameraProposalViews(l,defaults,list),proposed={...l,coverageViews:views};
      const scene=api.buildScene(proposed,list.map(x=>x.id===id?proposed:x)),landmarks=catalogue(scene,state.plan,id),bounds=boundsFor(state.plan,id);
      const framing=root.KinolotCameraFraming,features=framing?.inventory(landmarks,scene)||[];
      if(landmarks.length<6&&!features.length)throw Error("There are too few saved set features to match. Use the 3D camera controls.");
      const guard=()=>{scopeGuard(s);const now=location(id);if(api.cameraProposalKey(now.l,now.list)!==key)throw Error("The floor plan or cameras changed. Match the views again.");};
      onPhase?.("Preparing fixed-set references…");const refs=await references(scene,state.plan,landmarks);guard();
      if(new Set(refs.flatMap(r=>r.visible)).size<6&&!features.length)throw Error("Too few visible set corners could be labelled. Use the 3D camera controls.");
      const image=await root.turnDownscaleDataUrl(source.url,1536);guard();if(!image)throw Error("The ideas image could not be opened. Reopen the card and try again.");
      await sameSource(id,s,stamp);guard();onPhase?.("Reading image subjects and framing…");
      const result=await root.aiVisionComplete([{role:"user",content:readPrompt(landmarks,refs,features)}],[image,...refs.map(r=>r.url)],{maxTokens:5000,beforeSubmit:async()=>{await sameSource(id,s,stamp);guard();}});
      guard();await sameSource(id,s,stamp);guard();if(!result.vision)throw Error("The selected model could not read the image. No cameras were changed.");
      let raw;try{raw=JSON.parse(result.text.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/, ""));}catch(_){throw Error("The image read did not return usable landmark data. No cameras were changed.");}
      let observed=null,preciseError=null;try{observed=observations(raw,landmarks);}catch(e){preciseError=e;}
      let panels=[];onPhase?.("Matching framing inside the fixed set…");
      const seeds=Object.values(scene.cameras).concat(root.locationPanelPoses(l,list).map(p=>p.pose).filter(p=>p.position));
      try{if(observed)for(const panel of observed){
        await new Promise(resolve=>root.setTimeout(resolve,0));guard();
        const points=panel.points,aim=points.reduce((p,c)=>p.map((v,i)=>v+c.point[i]/points.length),[0,0,0]);
        const starts=[];
        for(const seed of seeds){
          const v=aim.map((x,i)=>x-seed.position[i]),yaw=Math.atan2(v[0],v[1])/D,pitch=Math.atan2(v[2],Math.hypot(v[0],v[1]))/D;
          for(const lensMm of [18,28,45])starts.push({...seed,yaw,pitch,lensMm});
          starts.push(seed);
        }
        const valid=pose=>{try{return !api.cameraProblems(l,list,[{key:panel.key,pose}])[panel.key];}catch(_){return false;}};
        let fitted;try{fitted=fit(points,starts,bounds,valid);}catch(e){throw Error(panel.key+": "+e.message);}
        // Saved-pose normalization rounds some values. Verify the exact pose that Step Four will consume.
        const next={...l,coverageViews:root.locationCoverageViewsWithPose(l,panel.key,fitted.pose)},pose=root.locationPanelPoses(next,list.map(x=>x.id===id?next:x)).find(p=>p.key===panel.key).pose;
        const errors=points.map(p=>{const uv=project(pose,p.point);return uv?Math.hypot(uv[0]-p.uv[0],(uv[1]-p.uv[1])*9/16):Infinity;});
        const rms=Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),max=Math.max(...errors);
        if(rms>.018||max>.045)throw Error(panel.key+": The saved camera precision does not retain this fit. No cameras were changed.");
        panels.push({key:panel.key,role:"image-match",label:"Matched ideas view",pose,fit:{count:points.length,rms,max}});
      }}catch(e){preciseError=e;panels=[];}
      guard();await sameSource(id,s,stamp);guard();
      const preview=root.KinolotAnglePreview,T=await preview.load(),check=preview.create(T,scene,{softwareOnly:true,anchors:state.plan.anchors,openings:preview.openingGuides(state.plan)});
      try{
        if(panels.length&&panels.some(panel=>observed.find(p=>p.key===panel.key).points.some(p=>!check.landmarkVisible(panel.pose,p.point)))){
          preciseError=Error("A matched feature is hidden behind the saved set.");panels=[];
        }
        if(!panels.length){
          if(!framing||!raw.panels?.every(p=>p.framing))throw preciseError||Error("The image views could not be matched.");
          const goals=framing.goals(raw,features),used=[];
          for(const goal of goals){
            await new Promise(resolve=>root.setTimeout(resolve,0));guard();
            const valid=pose=>{try{return !api.cameraProblems(l,list,[{key:goal.key,pose}])[goal.key];}catch(_){return false;}};
            let fit;try{fit=framing.choose(goal,features,seeds,bounds,valid,(pose,subject,rect)=>framing.visible(check,pose,subject,rect),used,root.normalizeLocationCameraPose);}
            catch(e){throw Error("The "+panelName(goal.key)+" view could not be matched: "+e.message);}
            const next={...l,coverageViews:root.locationCoverageViewsWithPose(l,goal.key,fit.pose)},pose=root.locationPanelPoses(next,list.map(x=>x.id===id?next:x)).find(p=>p.key===goal.key).pose;
            const subject=features.find(f=>f.id===fit.subjectId),rect=framing.rectangle(pose,subject);
            if(!valid(pose)||!rect||!framing.visible(check,pose,subject,rect))throw Error("The "+panelName(goal.key)+" camera could not keep "+subject.name+" visible at its saved settings. Your cameras are unchanged.");
            used.push(pose);panels.push({key:goal.key,role:"image-match",label:"Approximate "+goal.mode+" framing",pose,fit:{method:"composition",subjectId:fit.subjectId,centreError:fit.centreError}});
          }
        }
      }finally{check.dispose();}
      guard();
      const proposal={key,panels,warnings:["Approximate image framing keeps the saved set fixed. Appearance and geometry can differ from the ideas image; saved cameras remain editable in the 3D preview."],
        imageMatch:{sourceKey:stamp,iso:source.meta.iso,scope:{...s},method:panels.some(p=>p.fit.method==="composition")?"composition":"landmarks"},referenceUrl:source.url};
      api.cameraProposalViews(l,proposal,list);return proposal;
    }finally{active.delete(k);}
  }
  root.KinolotCameraMatch={project,catalogue,observations,fit,readPrompt,match,confirm};
})(window);
