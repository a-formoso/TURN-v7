/* Approximate composition transfer inside a fixed set. No image-derived geometry or calibrated-camera claim. */
(function(root){
  "use strict";
  const KEYS=["TL","TR","BL","BR"],D=Math.PI/180,finite=n=>typeof n==="number"&&Number.isFinite(n),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function inventory(landmarks,scene){
    const ids=new Set(scene.objects.map(o=>o.anchorId).filter(Boolean)),groups=new Map();
    for(const p of landmarks)if(p.objectId){const g=groups.get(p.objectId)||{id:p.objectId,name:p.name,type:/ edge (?:start|end)$/.test(p.corner)||!ids.has(p.objectId)?"opening":"object",points:[]};g.points.push(p.point);groups.set(p.objectId,g);}
    return [...groups.values()].map(g=>({...g,point:[0,1,2].map(i=>g.points.reduce((s,p)=>s+p[i]/g.points.length,0))}));
  }
  function goals(raw,features){
    if(!Array.isArray(raw?.panels)||raw.panels.length!==4)throw Error("Four image panels are needed to match camera framing.");
    const known=new Set(features.map(f=>f.id));
    return KEYS.map(key=>{
      const panels=raw.panels.filter(p=>p.key===key);if(panels.length!==1)throw Error("The image read omitted or repeated a panel.");
      const f=panels[0].framing;
      if(!f||!["wide","medium","detail"].includes(f.mode)||!Array.isArray(f.subjects)||!f.subjects.length||f.subjects.length>3)
        throw Error("The image read could not recognise a saved set subject in every panel. Your cameras are unchanged.");
      const seen=new Set(),subjects=f.subjects.map(s=>{
        if(!known.has(s.id)||seen.has(s.id)||!Array.isArray(s.rect)||s.rect.length!==4||!s.rect.every(n=>finite(n)&&n>=0&&n<=1)||s.rect[2]-s.rect[0]<.03||s.rect[3]-s.rect[1]<.03)
          throw Error("An image subject could not be linked to this fixed set. Your cameras are unchanged.");
        seen.add(s.id);return {id:s.id,rect:s.rect.slice()};
      });
      return {key,mode:f.mode,subjects};
    });
  }
  function rectangle(pose,feature){
    const p=feature.points.map(x=>root.KinolotCameraMatch.project(pose,x)).filter(Boolean);if(!p.length)return null;
    const rect=[Math.min(...p.map(p=>p[0])),Math.min(...p.map(p=>p[1])),Math.max(...p.map(p=>p[0])),Math.max(...p.map(p=>p[1]))];
    if(rect[0]>=1||rect[1]>=1||rect[2]<=0||rect[3]<=0)return null;
    return rect.map(n=>clamp(n,0,1));
  }
  function errors(rect,wanted){
    return {centre:Math.hypot((rect[0]+rect[2]-wanted[0]-wanted[2])/2,(rect[1]+rect[3]-wanted[1]-wanted[3])*9/32),
      width:Math.abs(rect[2]-rect[0]-wanted[2]+wanted[0]),height:Math.abs(rect[3]-rect[1]-wanted[3]+wanted[1]),
      scale:Math.abs(Math.log(Math.max(.01,rect[2]-rect[0])/(wanted[2]-wanted[0])))+Math.abs(Math.log(Math.max(.01,rect[3]-rect[1])/(wanted[3]-wanted[1])))};
  }
  function choose(goal,features,seeds,bounds,valid,visible,used=[]){
    const known=new Map(features.map(f=>[f.id,f])),subject=known.get(goal.subjects[0].id),wanted=goal.subjects[0].rect;
    const positions=[],seen=new Set(),span=Math.hypot(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1]);
    const add=p=>{if(p?.length!==3||!p.every(finite))return;const k=p.map(n=>n.toFixed(3)).join();if(!seen.has(k)){seen.add(k);positions.push(p);}};
    seeds.forEach(s=>add(s.position));
    const nx=Math.max(3,Math.min(9,Math.ceil((bounds.max[0]-bounds.min[0])/.4))),ny=Math.max(3,Math.min(21,Math.ceil((bounds.max[1]-bounds.min[1])/.5)));
    const floor=bounds.min[2]-.25,heights=[1.15,1.35,1.5,1.65].map(h=>clamp(floor+h,bounds.min[2],bounds.max[2]));
    for(let x=0;x<nx;x++)for(let y=0;y<ny;y++)for(const z of heights)add([bounds.min[0]+x*(bounds.max[0]-bounds.min[0])/(nx-1),bounds.min[1]+y*(bounds.max[1]-bounds.min[1])/(ny-1),z]);
    const lenses=goal.mode==="wide"?[18,21,24]:goal.mode==="medium"?[24,28,35]:[28,35,50],ranked=[];
    for(const position of positions){
      const base={position,yaw:0,pitch:0,lensMm:24,basis:"design"};if(!valid(base))continue;
      const v=subject.point.map((n,i)=>n-position[i]),distance=Math.hypot(v[0],v[1]);if(distance<.25)continue;
      for(const lensMm of lenses){
        const yaw=Math.atan2(v[0],v[1])/D-Math.atan(((wanted[0]+wanted[2])/2-.5)*36/lensMm)/D;
        const pitch=Math.atan2(v[2],distance)/D+Math.atan(((wanted[1]+wanted[3])/2-.5)*36*9/(16*lensMm))/D;
        for(const dy of [-5,0,5])for(const dp of [-5,0,5]){
          const pose={position,yaw:((yaw+dy)%360+360)%360,pitch:clamp(pitch+dp,-45,30),lensMm,basis:"design",target:subject.id};
          const rect=rectangle(pose,subject);if(!rect)continue;const main=errors(rect,wanted);
          if(main.centre>.2||main.width>.5||main.height>.5)continue;
          let score=main.centre*3+main.scale*.035;
          for(const extra of goal.subjects.slice(1)){const r=rectangle(pose,known.get(extra.id));score+=r?errors(r,extra.rect).centre*.7:.5;}
          if(goal.mode==="wide")score+=.11*(1-Math.min(1,distance/Math.max(span,.1)))+.01*(lensMm-18)/6;
          score+=.02*Math.abs(position[2]-clamp(floor+1.5,bounds.min[2],bounds.max[2]));
          if(used.some(p=>Math.hypot(...p.position.map((n,i)=>n-position[i]))<.2&&Math.cos((p.yaw-pose.yaw)*D)>.94))score+=.03;
          ranked.push({pose,rect,score,main});
        }
      }
    }
    ranked.sort((a,b)=>a.score-b.score);
    for(const candidate of ranked.slice(0,600))if(visible(candidate.pose,subject,candidate.rect))
      return {pose:candidate.pose,method:"composition",centreError:candidate.main.centre,subjectId:subject.id};
    throw Error("The main subject for this image view could not be framed clearly inside the saved set. Your cameras are unchanged.");
  }
  function visible(instance,pose,subject,rect){
    const p=root.KinolotCameraMatch.project(pose,subject.point),samples=p?[p]:[];
    for(const x of [.2,.5,.8])for(const y of [.2,.5,.8])samples.push([rect[0]+(rect[2]-rect[0])*x,rect[1]+(rect[3]-rect[1])*y]);
    let hits=0;
    for(const uv of samples){if(uv.some(n=>n<0||n>1))continue;const hit=instance.inspect(pose,...uv);
      if(hit?.name===subject.name||subject.type==="opening"&&hit?.through?.name===subject.name)hits++;
    }
    return hits>=(subject.type==="opening"?6:2);
  }
  root.KinolotCameraFraming={inventory,goals,rectangle,choose,visible};
})(window);
