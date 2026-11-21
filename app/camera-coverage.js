/* Automatic camera coverage for a built set (2026-11-11). One method for every location: no per-room camera recipes.
   Works on the exact numerical scene that the preview and the cloud build use, by casting rays at its real meshes.
     assess(): grades any four cameras — a view filled by one nearby surface, or showing no set object, fails.
     plan():   proposes four views — two complementary wide views, then two details chosen by what they ADD: each
               detail is the frame that shows the most story-relevant objects more clearly than the views already chosen.
   No model, account or renderer calls. It never moves an object and never saves a camera; the caller decides. */
(function(root){
  "use strict";
  const KEYS=["TL","TR","BL","BR"],RAD=Math.PI/180;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),r2=n=>Math.round(n*100)/100,r1=n=>Math.round(n*10)/10;
  const finite=n=>typeof n==="number"&&Number.isFinite(n);
  function insidePolygon(x,y,poly){
    let hit=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
      if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}
    return hit;
  }
  function wallDistance(x,y,poly){
    return Math.min(...poly.map((a,i)=>{const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy),0,1);return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);}));
  }
  // The saved pose convention: yaw clockwise from +Y (north), pitch positive upward, 36 mm sensor, 16:9 frame.
  function basis(pose){
    const yaw=pose.yaw*RAD,pitch=pose.pitch*RAD,s=Math.sin(yaw),c=Math.cos(yaw),p=Math.sin(pitch),q=Math.cos(pitch);
    return {o:pose.position,f:[s*q,c*q,p],r:[c,-s,0],u:[-s*p,-c*p,q],tx:18/pose.lensMm,ty:10.125/pose.lensMm};
  }
  function direction(b,u,v){
    const x=(2*u-1)*b.tx,y=(1-2*v)*b.ty,d=[0,1,2].map(i=>b.f[i]+b.r[i]*x+b.u[i]*y),n=Math.hypot(...d);
    return d.map(k=>k/n);
  }
  function project(b,point){
    const v=point.map((n,i)=>n-b.o[i]),dot=a=>a[0]*v[0]+a[1]*v[1]+a[2]*v[2],depth=dot(b.f);
    if(depth<=.05)return null;
    return [(dot(b.r)/(depth*b.tx)+1)/2,(1-dot(b.u)/(depth*b.ty))/2,depth];
  }
  function aim(position,target,lensMm,limits=[-40,25]){
    const dx=target[0]-position[0],dy=target[1]-position[1];
    return {position:position.map(r2),yaw:r1((Math.atan2(dx,dy)/RAD+360)%360)%360,
      pitch:r2(clamp(Math.atan2(target[2]-position[2],Math.hypot(dx,dy))/RAD,...limits)),lensMm,basis:"design"};
  }
  /* The set, ready for ray queries. `subjects` (optional) carries what the floor plan knows about each saved object:
     {id,name,weight}. Every mesh still blocks rays, whether or not it belongs to a saved object. */
  function survey(T,preview,scene,space,{subjects=[]}={}){
    if(!space||!Array.isArray(space.footprint)||space.footprint.length<3)throw Error("This room's footprint is needed to place cameras.");
    const rig=preview.sceneFor(T,scene),known=new Map(subjects.map(s=>[s.id,s])),groups=new Map();
    const entries=rig.meshes.map((mesh,index)=>{
      const box=new T.Box3().setFromObject(mesh),item=scene.objects[index],id=mesh.userData.anchorId||"";
      // Every primitive is a unit shape scaled and turned into place, so a ray is tested in the part's own frame:
      // exact for boxes at any angle, and a tight first test for the other shapes before their real mesh.
      const inv=new T.Matrix4().copy(mesh.matrixWorld).invert().elements;
      const e={mesh,id,name:mesh.name,min:box.min.toArray(),max:box.max.toArray(),inv,
        // The room's own surfaces, by the ids the set builder gives them.
        bare:/^(?:wall|floor|ceiling)-/.test(item.id),
        // A cushion or a draped cloth nearly fills its bounds: for sight lines it is its box.
        exact:["box","cushion","cloth"].includes(item.kind)};
      if(!e.exact){
        // The real surface of every other shape, as world-space triangles.
        const g=mesh.geometry,pos=g.getAttribute("position"),index=g.getIndex(),v=new T.Vector3(),count=index?index.count:pos.count;
        e.tris=new Float64Array(count*3);
        for(let i=0;i<count;i++){v.fromBufferAttribute(pos,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);e.tris[i*3]=v.x;e.tris[i*3+1]=v.y;e.tris[i*3+2]=v.z;}
      }
      if(id){
        const g=groups.get(id)||{id,name:known.get(id)?.name||mesh.name.split(" · ")[0],weight:known.get(id)?.weight??1,
          min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],entries:[]};
        for(let i=0;i<3;i++){g.min[i]=Math.min(g.min[i],e.min[i]);g.max[i]=Math.max(g.max[i],e.max[i]);}
        g.entries.push(e);groups.set(id,g);
      }
      return e;
    });
    const poly=space.footprint,xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]);
    const min=[Math.min(...xs),Math.min(...ys)],max=[Math.max(...xs),Math.max(...ys)],w=max[0]-min[0],d=max[1]-min[1];
    const floor=finite(space.floorZ)?space.floorZ:0,open=!!space.openSky||!finite(space.ceilingH),height=open?6:space.ceilingH;
    const diag=Math.hypot(w,d),nearLimit=clamp(diag*.035,.3,1);
    for(const g of groups.values()){
      g.centre=g.min.map((n,i)=>(n+g.max[i])/2);g.size=g.max.map((n,i)=>n-g.min[i]);
      g.corners=[];for(const x of [g.min[0],g.max[0]])for(const y of [g.min[1],g.max[1]])for(const z of [g.min[2],g.max[2]])g.corners.push([x,y,z]);
      // A detail needs something that stands up in the room: floor markings and thin ceiling fittings are shown by the
      // wider views, and can still add to a detail of something beside them.
      g.flat=g.size[2]<.1;g.overhead=!open&&g.min[2]>floor+height*.7&&g.size[2]<.35;
      // …and it frames something of furniture scale or larger: a small prop is shown beside what it sits on.
      g.detail=!g.flat&&!g.overhead&&Math.max(...g.size)>=.6&&!known.get(g.id)?.opening;
      // Objects saved with the same dimensions are the same kind of thing (a row of benches, a pair of hoops).
      g.kind=known.get(g.id)?.kind||[Math.min(g.size[0],g.size[1]),Math.max(g.size[0],g.size[1]),g.size[2]].map(n=>Math.round(n*20)/20).join("x");
    }
    // Distance along a world ray to a part's unit bounds in its own frame (-1 = missed). The ray keeps its world
    // length under the part's transform, so the distance needs no conversion.
    function slab(e,o,dv){
      const m=e.inv;let lo=0,hi=Infinity;
      for(let i=0;i<3;i++){
        const p=m[i]*o[0]+m[4+i]*o[1]+m[8+i]*o[2]+m[12+i],q=m[i]*dv[0]+m[4+i]*dv[1]+m[8+i]*dv[2];
        if(Math.abs(q)<1e-12){if(p<-.5||p>.5)return -1;continue;}
        const a=(-.5-p)/q,b=(.5-p)/q;
        if(a<b){if(a>lo)lo=a;if(b<hi)hi=b;}else{if(b>lo)lo=b;if(a<hi)hi=a;}
        if(lo>hi)return -1;
      }
      return lo;
    }
    // Nearest crossing of a part's triangles (both faces count), or Infinity.
    function precise(e,o,dv,limit){
      const t=e.tris;let best=Infinity;
      for(let i=0;i<t.length;i+=9){
        const ax=t[i],ay=t[i+1],az=t[i+2],e1x=t[i+3]-ax,e1y=t[i+4]-ay,e1z=t[i+5]-az,e2x=t[i+6]-ax,e2y=t[i+7]-ay,e2z=t[i+8]-az;
        const px=dv[1]*e2z-dv[2]*e2y,py=dv[2]*e2x-dv[0]*e2z,pz=dv[0]*e2y-dv[1]*e2x,det=e1x*px+e1y*py+e1z*pz;
        if(det>-1e-12&&det<1e-12)continue;
        const f=1/det,sx=o[0]-ax,sy=o[1]-ay,sz=o[2]-az,u=f*(sx*px+sy*py+sz*pz);if(u<0||u>1)continue;
        const qx=sy*e1z-sz*e1y,qy=sz*e1x-sx*e1z,qz=sx*e1y-sy*e1x,w=f*(dv[0]*qx+dv[1]*qy+dv[2]*qz);if(w<0||u+w>1)continue;
        const d=f*(e2x*qx+e2y*qy+e2z*qz);if(d>1e-6&&d<best&&d<limit)best=d;
      }
      return best;
    }
    // The parts in a tree of bounding boxes, so a ray meets only the few parts near its path.
    function tree(list){
      const node={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
      for(const e of list)for(let i=0;i<3;i++){node.min[i]=Math.min(node.min[i],e.min[i]-1e-6);node.max[i]=Math.max(node.max[i],e.max[i]+1e-6);}
      if(list.length<=4){node.items=list;return node;}
      const mid=e=>[0,1,2].map(i=>(e.min[i]+e.max[i])/2),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(const e of list){const c=mid(e);for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],c[i]);hi[i]=Math.max(hi[i],c[i]);}}
      const axis=[0,1,2].sort((a,b)=>(hi[b]-lo[b])-(hi[a]-lo[a]))[0],sorted=list.slice().sort((a,b)=>mid(a)[axis]-mid(b)[axis]),half=sorted.length>>1;
      node.a=tree(sorted.slice(0,half));node.b=tree(sorted.slice(half));return node;
    }
    const top=tree(entries),stack=[];
    function reach(n,o,inv,limit){
      let lo=0,hi=limit;
      for(let i=0;i<3;i++){
        const a=(n.min[i]-o[i])*inv[i],b=(n.max[i]-o[i])*inv[i];
        if(a<b){if(a>lo)lo=a;if(b<hi)hi=b;}else{if(b>lo)lo=b;if(a<hi)hi=a;}
        if(!(lo<=hi))return false;
      }
      return true;
    }
    const inverse=dv=>dv.map(n=>1/(Math.abs(n)<1e-12?1e-12:n));
    // Nearest surface along a ray (`only`: among one object's own parts).
    function cast(o,dv,only){
      let best=null,distance=Infinity;
      const test=e=>{
        let t=slab(e,o,dv);if(t<0||t>=distance)return;
        if(!e.exact){t=precise(e,o,dv,distance);if(t>=distance)return;}
        best=e;distance=t;
      };
      if(only)only.forEach(test);
      else{
        const inv=inverse(dv);stack.length=0;stack.push(top);
        while(stack.length){
          const n=stack.pop();if(!reach(n,o,inv,distance))continue;
          if(n.items)n.items.forEach(test);else{stack.push(n.a);stack.push(n.b);}
        }
      }
      return best?{entry:best,distance}:null;
    }
    // Is anything other than this object in front of a point on it?
    function hidden(o,dv,limit,g){
      const inv=inverse(dv),end=limit-.01;stack.length=0;stack.push(top);
      while(stack.length){
        const n=stack.pop();if(!reach(n,o,inv,end))continue;
        if(!n.items){stack.push(n.a);stack.push(n.b);continue;}
        for(const e of n.items){
          if(g&&e.id===g.id)continue;
          const t=slab(e,o,dv);if(t<0||t>=end)continue;
          if(e.exact||precise(e,o,dv,end)<end)return true;
        }
      }
      return false;
    }
    // The room's own shell (floor, ceiling) spans the whole footprint; only parts inside it obstruct a camera.
    const shell=e=>e.min[0]<=min[0]+.2&&e.max[0]>=max[0]-.2&&e.min[1]<=min[1]+.2&&e.max[1]>=max[1]-.2;
    // Things a person could not stand in: anything resting in the room that rises above knee height.
    const tall=entries.filter(e=>!shell(e)&&e.max[2]>floor+.45&&e.min[2]<floor+1.2&&e.max[0]-e.min[0]>=.15&&e.max[1]-e.min[1]>=.15);
    const standable=(x,y)=>insidePolygon(x,y,poly)&&!tall.some(e=>x>e.min[0]&&x<e.max[0]&&y>e.min[1]&&y<e.max[1]);
    // Where a camera may be: inside the room, off the walls, between floor and ceiling, outside every built part, and
    // within arm's reach (0.3 m) of somewhere its operator could stand.
    function clear(position){
      const [x,y,z]=position;
      if(!insidePolygon(x,y,poly)||wallDistance(x,y,poly)<Math.min(.35,Math.min(w,d)*.12))return false;
      if(z<floor+.3||(!open&&z>floor+height-.2))return false;
      if(entries.some(e=>!shell(e)&&e.max[2]-e.min[2]>.05&&x>e.min[0]-.12&&x<e.max[0]+.12&&y>e.min[1]-.12&&y<e.max[1]+.12&&z>e.min[2]-.1&&z<e.max[2]+.1))return false;
      if(standable(x,y))return true;
      for(let k=0;k<8;k++)if(standable(x+.3*Math.cos(k*Math.PI/4),y+.3*Math.sin(k*Math.PI/4)))return true;
      return false;
    }
    // How much of the room itself a view takes in: sample points through its volume, in frame and unobstructed.
    const samples=[];
    for(let i=0;i<8;i++)for(let j=0;j<8;j++){
      const x=min[0]+w*(i+.5)/8,y=min[1]+d*(j+.5)/8;if(!insidePolygon(x,y,poly))continue;
      for(const h of [.25,1,1.7])samples.push([x,y,floor+(open?h:Math.min(h,height-.15))]);
    }
    function roomSeen(pose){
      const b=basis(pose),seen=new Uint8Array(samples.length);
      samples.forEach((p,i)=>{
        const q=project(b,p);if(!q||q[0]<0||q[0]>1||q[1]<0||q[1]>1)return;
        const v=p.map((n,k)=>n-b.o[k]),far=Math.hypot(...v);
        if(!hidden(b.o,v.map(n=>n/far),far-.05,null))seen[i]=1;
      });
      return seen;
    }
    // What a view shows: a grid of rays over the frame.
    // `subject` + `within`: also measure how much of the frame is taken by other things in front of that object.
    function look(pose,{subject=null,within=0,nx=16,ny=9}={}){
      const b=basis(pose),share=new Map(),dist=[];let near=0,sky=0,front=0,plain=0,nearName="";const nearBy=new Map();
      for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
        const hit=cast(b.o,direction(b,(i+.5)/nx,(j+.5)/ny));
        if(!hit){sky++;dist.push(diag);continue;}
        dist.push(hit.distance);if(hit.entry.bare)plain++;
        if(subject&&hit.distance<within&&hit.entry.id!==subject.id)front++;
        const key=hit.entry.id||"#"+hit.entry.name;share.set(key,(share.get(key)||0)+1);
        if(hit.distance<nearLimit){near++;nearBy.set(key,(nearBy.get(key)||0)+1);}
      }
      const total=nx*ny,sorted=dist.slice().sort((a,b)=>a-b);
      let topKey="",top=0;for(const [k,n] of share)if(n>top){top=n;topKey=k;}
      let nearTop=0;for(const [k,n] of nearBy)if(n>nearTop){nearTop=n;nearName=k;}
      // What a person would call the thing in the way: the saved object's name, or the room surface's.
      const called=k=>k?(k[0]==="#"?k.slice(1):groups.get(k)?.name||k):"";
      topKey=called(topKey);nearName=called(nearName);
      return {near:near/total,sky:sky/total,front:front/total,plain:plain/total,topShare:top/total,topKey,nearName,
        depthRange:clamp((sorted[Math.floor(total*.9)]-sorted[Math.floor(total*.1)])/Math.max(diag,.1),0,1)};
    }
    /* How clearly one saved object reads in a view, 0..1: unobstructed × in frame × large enough.
       Rays through its projected outline count only where the object really is, so a net or a frame is not
       marked hidden for the gaps between its parts. */
    function clarity(pose,g){
      const b=basis(pose),pts=g.corners.map(c=>project(b,c)).filter(Boolean);
      if(pts.length<5)return {value:0,span:0,retained:0,visible:0};
      const raw=[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
      const rect=raw.map(n=>clamp(n,0,1)),cw=rect[2]-rect[0],ch=rect[3]-rect[1];
      // Too small in this frame to read: no rays needed.
      if(Math.max(cw,ch*9/16)<.04)return {value:0,span:Math.max(cw,ch*9/16),retained:0,visible:0};
      const retained=cw*ch/Math.max(1e-6,(raw[2]-raw[0])*(raw[3]-raw[1]));
      let present=0,seen=0;
      for(let j=0;j<4;j++)for(let i=0;i<4;i++){
        const dv=direction(b,rect[0]+cw*(i+.5)/4,rect[1]+ch*(j+.5)/4),own=cast(b.o,dv,g.entries);
        if(!own)continue;present++;
        if(!hidden(b.o,dv,own.distance,g))seen++;
      }
      const visible=present?seen/present:0,span=Math.max(cw,ch*9/16);
      // Readable from about an eighth of the frame; a featured subject fills two fifths or more.
      const size=span<.04?0:span<.12?(span-.04)/.08*.6:.6+clamp((span-.12)/.28,0,1)*.4;
      const kept=clamp((retained-.25)/.5,0,1);
      return {value:present<2?0:visible*kept*size,span,retained,visible,rect,centre:[(rect[0]+rect[2])/2,(rect[1]+rect[3])/2]};
    }
    // A view passes when it is a usable picture of the set. The reason is written for the person looking at the card.
    function gate(pose,seen,v){
      if(!clear(pose.position))return "It stands inside or against part of the set.";
      v=v||look(pose);
      if(v.near>=.4)return "It is too close to "+(v.nearName||"a surface")+", which fills the frame.";
      if(v.topShare>=.9&&v.depthRange<.05)return "It faces one flat surface: "+(v.topKey||"a wall")+".";
      if(groups.size){
        const values=seen||[...groups.values()].map(g=>clarity(pose,g).value);
        if(!values.some(n=>n>=.12))return "No object of the set is clearly visible in it.";
      }
      return "";
    }
    return {T,rig,entries,groups,poly,min,max,w,d,diag,floor,height,open,nearLimit,cast,clear,look,clarity,gate,
      wall:(x,y)=>wallDistance(x,y,poly),roomSeen,samples,
      dispose:()=>rig.dispose()};
  }
  // Grade any four cameras against the set. → {TL:"",TR:"reason",…}: an empty string is a usable view.
  function assess(T,preview,scene,space,poses,options){
    const s=survey(T,preview,scene,space,options);
    try{return Object.fromEntries(KEYS.map(k=>[k,poses[k]?s.gate(poses[k]):"It has no position yet."]));}
    finally{s.dispose();}
  }
  /* Four views of the set. `keep` holds cameras that must stay exactly as they are (set by hand, or already good):
     they count as coverage, and only the other panels are placed. */
  function plan(T,preview,scene,space,{subjects=[],keep={}}={}){
    const s=survey(T,preview,scene,space,{subjects});
    try{
      const groups=[...s.groups.values()],total=groups.reduce((n,g)=>n+g.weight,0)||1;
      const step=clamp(Math.min(s.w,s.d)/10,.2,1.5),odd=n=>{const k=Math.max(3,Math.ceil(n));return k%2?k:k+1;};
      const nx=Math.min(41,odd(s.w/step)),ny=Math.min(41,odd(s.d/step));
      const eye=h=>r2(s.open?s.floor+h:clamp(s.floor+h,s.floor+.5,s.floor+s.height-.3));
      const stations=heights=>{
        const out=[];
        for(let i=0;i<nx;i++)for(let j=0;j<ny;j++)for(const h of heights){
          const p=[r2(s.min[0]+s.w*(i+.5)/nx),r2(s.min[1]+s.d*(j+.5)/ny),h];
          if(s.clear(p))out.push(p);
        }
        return out;
      };
      const measure=pose=>{const c=new Map();for(const g of groups)c.set(g.id,s.clarity(pose,g));return c;};
      const coverage=c=>groups.reduce((n,g)=>n+g.weight*c.get(g.id).value,0)/total;
      // One reading of a candidate view; the cheap checks run first so a poor candidate costs little.
      const view=(pose,subject)=>{
        if(!s.clear(pose.position))return null;
        let far=0;
        if(subject){
          const own=s.clarity(pose,subject);if(own.visible<.5||own.value<.45)return null;
          far=Math.hypot(...subject.centre.map((n,i)=>n-pose.position[i]));
        }
        const v=s.look(pose,subject?{subject,within:far*.8}:{});
        if(v.near>=.4||(v.topShare>=.9&&v.depthRange<.05))return null;
        const c=measure(pose);if(s.gate(pose,[...c.values()].map(x=>x.value),v))return null;
        return {pose,c,v,cover:coverage(c)};
      };
      const roomBest=new Uint8Array(s.samples.length),count=a=>a.reduce((n,x)=>n+x,0)/Math.max(1,a.length);
      const roomGain=item=>item.room.reduce((n,x,i)=>n+(x&&!roomBest[i]?1:0),0)/Math.max(1,item.room.length);
      const apart=(a,b)=>Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1]);
      const turn=(a,b)=>Math.cos((a.yaw-b.yaw)*RAD);
      const chosen={},best=new Map(groups.map(g=>[g.id,0]));
      const take=(key,item,role,label,target)=>{
        chosen[key]={key,role,label,pose:item.pose,...(target?{targetId:target.id}:{}),
          shows:groups.filter(g=>item.c.get(g.id).value>=.3).sort((a,b)=>item.c.get(b.id).value-item.c.get(a.id).value).map(g=>g.name)};
        for(const g of groups)best.set(g.id,Math.max(best.get(g.id),item.c.get(g.id).value));
        (item.room||s.roomSeen(item.pose)).forEach((x,i)=>{if(x)roomBest[i]=1;});
      };
      for(const key of KEYS)if(keep[key]){
        const pose=keep[key],c=measure(pose);
        chosen[key]={key,role:"kept",label:"Kept as set",pose,shows:groups.filter(g=>c.get(g.id).value>=.3).map(g=>g.name)};
        for(const g of groups)best.set(g.id,Math.max(best.get(g.id),c.get(g.id).value));
        s.roomSeen(pose).forEach((x,i)=>{if(x)roomBest[i]=1;});
      }
      // ── wide views: from every clear station, toward the set's weighted centre and the room's centre
      const centroid=groups.length?[0,1].map(i=>groups.reduce((n,g)=>n+g.weight*g.centre[i],0)/total):[s.min[0]+s.w/2,s.min[1]+s.d/2];
      const middle=[s.min[0]+s.w/2,s.min[1]+s.d/2],aimZ=s.floor+Math.min(1.2,s.height*.45);
      const wideHeights=!s.open&&s.height<2.6?[eye(1.55)]:[eye(1.6),eye(2)];
      const rough=[];
      for(const p of stations(wideHeights))for(const target of [centroid,middle]){
        const far=Math.hypot(target[0]-p[0],target[1]-p[1]);if(far<Math.max(.6,s.diag*.12))continue;
        for(const offset of [-18,0,18])for(const lensMm of [18,24]){
          const pose=aim(p,[...target,aimZ],lensMm,[-25,5]);pose.yaw=r1(((pose.yaw+offset)%360+360)%360);
          // Cheap first pass: how many weighted object centres fall inside the frame, and how much room lies ahead.
          const b=basis(pose);let inFrame=0;
          for(const g of groups){const q=project(b,g.centre);if(q&&q[0]>.04&&q[0]<.96&&q[1]>.04&&q[1]<.96)inFrame+=g.weight;}
          rough.push({pose,score:inFrame/total+.35*far/s.diag});
        }
      }
      // Shortlist the best two rough poses from every station, so every part of the room stays in the running,
      // then thin the stations evenly if the room is large.
      rough.sort((a,b)=>b.score-a.score);
      const perStation=new Map(),seenPose=new Set();
      for(const c of rough){
        const k=JSON.stringify(c.pose);if(seenPose.has(k))continue;seenPose.add(k);
        const at=c.pose.position.join(),list=perStation.get(at)||[];if(list.length<2){list.push(c);perStation.set(at,list);}
      }
      const groupsOfTwo=[...perStation.values()],thin=Math.max(1,Math.ceil(groupsOfTwo.length/90)),wides=[];
      groupsOfTwo.forEach((list,i)=>{
        if(i%thin)return;
        for(const c of list){
          const item=view(c.pose);if(!item)continue;
          item.room=s.roomSeen(c.pose);
          // A wide view is worth what it shows of the room and of its saved objects, with depth and a clear foreground.
          item.score=.5*count(item.room)+.5*item.cover+.15*item.v.depthRange-1.5*Math.max(0,item.v.near-.05)-.8*Math.max(0,item.v.topShare-.45)-(c.pose.lensMm===18?.02:0);
          wides.push(item);
        }
      });
      if(!wides.length)throw Error("No clear wide view of this room could be found. Check the footprint and object sizes in Floor plan.");
      const gain=item=>groups.reduce((n,g)=>n+g.weight*Math.max(0,item.c.get(g.id).value-best.get(g.id)),0)/total;
      const free=KEYS.filter(k=>!chosen[k]);
      const others=()=>Object.values(chosen).map(c=>c.pose);
      if(free.includes("TL")){
        const pick=wides.slice().sort((a,b)=>(b.score+gain(b)+roomGain(b))-(a.score+gain(a)+roomGain(a)))[0];
        take("TL",pick,"wide","Wide room view");
      }
      if(free.includes("TR")){
        const first=chosen.TL.pose;
        const value=c=>gain(c)*1.2+roomGain(c)*1.2+c.score*.6;
        const rank=list=>list.sort((a,b)=>value(b)-value(a))[0];
        const pick=rank(wides.filter(c=>apart(c.pose,first)>=s.diag*.3&&turn(c.pose,first)<=.2))
          ||rank(wides.filter(c=>apart(c.pose,first)>=s.diag*.2&&turn(c.pose,first)<=.7))
          ||rank(wides.filter(c=>apart(c.pose,first)>=s.diag*.12||turn(c.pose,first)<=.5));
        if(!pick)throw Error("This room has no second clear wide view. Check the footprint and object sizes in Floor plan.");
        take("TR",pick,"reverse","Reverse room view");
      }
      // ── details: for each standing object, the frames that feature it; choose by what a frame adds overall
      const detailStations=stations(!s.open&&s.height<2.2?[eye(1.3)]:[eye(1.25),eye(1.55)]);
      const options=[];
      for(const g of groups.filter(g=>g.detail)){
        const radius=Math.hypot(...g.size)/2,list=[];
        for(const p of detailStations){
          const far=Math.hypot(g.centre[0]-p[0],g.centre[1]-p[1]);
          // A detail is taken from nearer than a wide view of the room.
          if(far<Math.max(.55,radius*.8)||far>Math.min(Math.max(3,radius*7),Math.max(3,s.diag*.5)))continue;
          for(const lensMm of [21,28,35]){
            const pose=aim(p,g.centre,lensMm,[-40,25]),b=basis(pose),pts=g.corners.map(c=>project(b,c));
            if(pts.some(q=>!q))continue;
            const x=pts.map(q=>q[0]),y=pts.map(q=>q[1]),x0=Math.min(...x),x1=Math.max(...x),y0=Math.min(...y),y1=Math.max(...y);
            // The subject fills a third to all of the frame; in a cramped space its edges may run a little out of it.
            const span=Math.max(x1-x0,y1-y0);if(span<.3||span>1.15)continue;
            const inFrame=(clamp(x1,0,1)-clamp(x0,0,1))*(clamp(y1,0,1)-clamp(y0,0,1))/Math.max(1e-6,(x1-x0)*(y1-y0));
            if(inFrame<.7)continue;
            list.push({pose,score:-Math.abs(span-.5)*.6-(1-inFrame)*.6});
          }
        }
        list.sort((a,b)=>b.score-a.score);
        let kept=0;
        // Keep looking down the list until enough frames show the subject clearly (a cramped space rejects many).
        for(const c of list.slice(0,80)){
          const item=view(c.pose,g);if(!item)continue;
          // Other things nearer than the subject (a wall beside the lens, an object in the way) spoil a detail, and so
          // does a camera pressed against a wall or one looking along the wall the subject stands against.
          const front=item.v.front;
          const toRoom=[middle[0]-g.centre[0],middle[1]-g.centre[1]],toCam=[c.pose.position[0]-g.centre[0],c.pose.position[1]-g.centre[1]];
          const facing=(toRoom[0]*toCam[0]+toRoom[1]*toCam[1])/Math.max(1e-6,Math.hypot(...toRoom)*Math.hypot(...toCam));
          const cramped=Math.max(0,1-s.wall(c.pose.position[0],c.pose.position[1])/Math.min(1,Math.min(s.w,s.d)*.25));
          options.push({...item,primary:g,front,facing:Math.hypot(...toRoom)<.3?1:facing,cramped});if(++kept>=8)break;
        }
      }
      // A detail is judged first by its own subject (how much better it shows it than the views already chosen), then
      // by what else it adds, then by composition.
      const detailScore=o=>{
        const own=o.primary.weight*Math.max(0,o.c.get(o.primary.id).value-best.get(o.primary.id))/total;
        return own+.4*(gain(o)-own)+.2*o.primary.weight*o.c.get(o.primary.id).value/total
          // …a subject alone against bare wall and floor makes a poor picture: prefer the angle with the room behind it
          +.05*o.v.depthRange+.04*o.facing-.5*Math.max(0,o.front-.1)-.06*o.cramped-1.2*Math.max(0,o.v.near-.08)
          -.3*Math.max(0,o.v.plain-.55)*o.primary.weight/total;
      };
      const distinct=o=>others().every(p=>apart({position:p.position},o.pose)>=Math.min(.6,s.diag*.08)||turn(p,o.pose)<=.75);
      // The second detail shows a different part of the room, and a different kind of object where there is one.
      const taken=[],zone=Math.max(1,s.diag*.15);
      const fresh=o=>taken.every(g=>g.id!==o.primary.id&&Math.hypot(g.centre[0]-o.primary.centre[0],g.centre[1]-o.primary.centre[1])>=zone);
      const ranked=o=>detailScore(o)*(taken.some(g=>g.kind===o.primary.kind)?.35:1);
      for(const key of ["BL","BR"]){
        if(!free.includes(key))continue;
        const pick=options.filter(o=>fresh(o)&&distinct(o)).sort((a,b)=>ranked(b)-ranked(a)||a.primary.id.localeCompare(b.primary.id))[0];
        if(pick){taken.push(pick.primary);take(key,pick,"detail",pick.primary.name+" detail",pick.primary);continue;}
        // A sparse room: the next most useful different view of the room, rather than a forced close-up.
        const extra=wides.filter(distinct).sort((a,b)=>(gain(b)*2+b.score*.4)-(gain(a)*2+a.score*.4))[0];
        if(!extra)throw Error("Four different clear views could not be found in this room. Check the footprint and object sizes in Floor plan.");
        take(key,extra,"wide","Another room view");
      }
      const unseen=groups.filter(g=>best.get(g.id)<.3).map(g=>g.name);
      return {panels:KEYS.map(k=>chosen[k]),unseen,
        coverage:r2(groups.reduce((n,g)=>n+g.weight*best.get(g.id),0)/total)};
    }finally{s.dispose();}
  }
  root.KinolotCameraCoverage={KEYS,survey,assess,plan,basis,project};
})(typeof window!=="undefined"?window:globalThis);
