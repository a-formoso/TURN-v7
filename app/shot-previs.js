/* shot-previs.js — A SHOT DRAWN IN CODE FROM THE 3D SET (owner 2026-11-22, after the first real frames of Scene 5:
   "the setting is not consistent from shot to shot … we need to start with code … pull out the actual 3D set … lock
   in the cameras considering the composition for the shot … then … bring image model to support with rendering").

   The image engine alone drew a different hall in every frame (a second door, props of another size). Here nothing
   is guessed: the place is the location's own 3D set (set-previs.js: one model for every shot), each person is a
   stand-in of their own height on the mark the scene plan put them on, each thing is its own model at its true size (prop-model.js) where
   the plan says it is, and the camera is a real one that has to fit inside the room and see the people it frames.
   The same camera draws how the shot STARTS and how it ENDS, so the two differ only by what moved.

     heightOf(character)                     their height in metres (the card's own words, e.g. "168 cm tall")
     sizeOf(prop | thing)                    [w, d, h] in metres: its measured size, or read from its size text
     poseDoors(set, doors, ctx)              each door of a state swung open or left shut (the leaf the set already has)
     stateScene(set, plan, state, ctx)       the set with the doors, the people and the things of one state put in;
                                             nobody stands in a shut doorway, and what hangs on a hook hangs under it
     restsOn(set, plan, things)              what sits on each fixed thing of the set (its dressing, the tracked things)
     dressingWords(surfaces)                 the same in sentences: what is on each, and that nothing else is
     planCamera(cam, shot, placed, …)        the camera the scene plan gave in numbers, CHECKED: it must stand in the
                                             room, outside every wall and piece of furniture, and see the people it
                                             frames; else it is moved to the spot that does and keeps the shot best, and the lens is
                                             set to the one that shows the planned shot size from there
     camera(shot, people, spaces, o)         with no planned camera: a spot found by the app that fits and sees them
     pair(location, list, plan, shot, o)     the shot DRAWN: how it starts and how it ends, from one camera
     frame(location, list, plan, shot, o)    one drawn frame; o.which = "start" | "end"

   Pure geometry except pair() / frame() (which draw) and the sight lines (which need the set's meshes). Free: no
   engine is called and nothing is saved. Metres, +Z up, +Y north, +X east, as the floor plan. */
(function(root){
  "use strict";
  const arr=v=>Array.isArray(v)?v:[], obj=v=>(v&&typeof v==="object"&&!Array.isArray(v))?v:{}, num=v=>Number.isFinite(Number(v))?Number(v):null;
  const DEG=180/Math.PI;

  /* ---- people ---- */
  const DEFAULT_HEIGHT=1.7;
  function heightOf(c){
    const t=String((c&&(c.height||c.heightCm))||"");
    let m=t.match(/(\d{2,3}(?:\.\d+)?)\s*cm/i); if(m){ const v=Number(m[1])/100; if(v>=0.4&&v<=2.5) return v; }
    m=t.match(/(\d(?:\.\d+)?)\s*m\b/i); if(m){ const v=Number(m[1]); if(v>=0.4&&v<=2.5) return v; }
    m=t.match(/(\d)\s*(?:ft|['′])\s*(\d{1,2})?/i); if(m){ const v=Number(m[1])*0.3048+(Number(m[2])||0)*0.0254; if(v>=0.4&&v<=2.5) return v; }
    const n=num(c&&c.heightCm); if(n&&n>=40&&n<=250) return n/100;
    return DEFAULT_HEIGHT;
  }
  // a colour that stays the same for the same person (linear rgb), so a stand-in can be told from another
  function colourOf(id){ let h=0; const s=String(id||""); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0;
    const hue=(h%360)/360, f=n=>{ const k=(n+hue*12)%12; return 0.5-0.32*Math.max(-1,Math.min(k-3,9-k,1)); };
    return [f(0),f(8),f(4)].map(v=>Math.round(Math.pow(v,2.2)*1000)/1000); }
  /* A NAMED COLOUR FOR EACH PERSON, THE SAME IN EVERY SHOT OF A SCENE (2026-11-23: the image engine is told "the blue
     figure is Pike"). Never red or orange: those are the props' boxes. By the person's place among everyone
     the scene plan blocks, in id order; someone the blocking does not name takes the next free colour. */
  const PALETTE=[["blue",[0.05,0.09,0.72]],["pink",[0.78,0.08,0.3]],["green",[0.06,0.42,0.1]],["yellow",[0.85,0.62,0.03]],
    ["purple",[0.3,0.06,0.6]],["turquoise",[0.02,0.5,0.5]],["white",[0.82,0.82,0.82]],["brown",[0.22,0.11,0.04]]];
  function paletteFor(plan,ids){
    const order=[]; arr(obj(plan).blocking).forEach(b=>arr(b&&b.people).forEach(x=>{ if(x&&x.id&&order.indexOf(String(x.id))<0) order.push(String(x.id)); }));
    order.sort();
    arr(ids).map(String).sort().forEach(id=>{ if(order.indexOf(id)<0) order.push(id); });
    const out={}; order.forEach((id,i)=>{ const c=PALETTE[i%PALETTE.length]; out[id]={name:c[0],rgb:c[1].slice()}; });
    return out;
  }
  /* A PERSON AS A JOINTED FIGURE of their own height (owner 2026-11-23, the Previs look brief, step 3; they were a
     block of legs, a block of torso and a block of head): pelvis, torso, neck, head with a nose on the side they look
     to, upper and lower arms, hands, thighs, shins and shoes, in one flat colour (nose and shoes darker). The figure
     is built 1.80 m tall and scaled to the person's height. A pose word seats, kneels or lays them down, and what
     they hold brings their hands to it. turn = radians about +Z; 0 looks north (+Y).
     EVERY RULE THE CAMERA USES IS KEPT: head, chest, height, turn and front are the numbers the block figure had (a
     pose word lowers them: lying 0.22, kneeling 0.62, sitting 0.74 of the height), so the checks that place a camera
     and see a face read the same person in the same place. o.holding = how many things they hold (0, 1 or 2). */
  const turnTo=(from,to)=>{ const dx=to[0]-from[0], dy=to[1]-from[1]; return Math.hypot(dx,dy)<0.02 ? null : Math.atan2(-dx,dy); };
  const frontOf=turn=>[-Math.sin(turn||0),Math.cos(turn||0)];
  const V={add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],mul:(a,k)=>[a[0]*k,a[1]*k,a[2]*k],
    mix:(...t)=>{ const o=[0,0,0]; for(let i=0;i<t.length;i+=2){ o[0]+=t[i][0]*t[i+1]; o[1]+=t[i][1]*t[i+1]; o[2]+=t[i][2]*t[i+1]; } return o; },
    unit:a=>{ const l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; },cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]};
  const r3=v=>v.map(n=>Math.round(n*1000)/1000);
  // the turn of a part whose own height (+Z) lies along d: about X, then about Z (the scene's order of turns)
  const along=d=>{ const tilt=Math.acos(Math.max(-1,Math.min(1,d[2]))); return [tilt,0,tilt<1e-4?0:Math.atan2(d[0],-d[1])]; };
  const POSTURE=pose=>{ const p=String(pose||"").toLowerCase();
    return /\b(lying|on the floor|prone)\b/.test(p)?"lying":/\b(kneel|crouch|squat)/.test(p)?"kneeling":/\b(sit|sits|sitting|sat|seated)\b/.test(p)?"sitting":"standing"; };
  const LOWERS={lying:0.22,kneeling:0.62,sitting:0.74,standing:1};
  function figure(id,name,xy,floorZ,height,pose,turn,rgb,o){
    const posture=POSTURE(pose), k=LOWERS[posture];
    const h=height*k, mat="standin-"+id, dark=mat+"-dark", z=floorZ||0, x=xy[0], y=xy[1], label=String(name||id)+" (stand-in)";
    const rz=Number.isFinite(turn)?turn:0, f=frontOf(rz), s=height/1.8;
    const head=[x,y,z+h-0.115], chest=[x,y,z+h*0.72];
    const objects=[], n=()=>objects.length;
    const add=(part,kind,centre,size,rot,m)=>objects.push({id:"fig-"+id+"-"+part,name:label,kind,position:r3(centre),rotation:r3(rot||[0,0,rz]),size:r3(size),material:m||mat});
    // a rod from a to b, r thick; a ball at c
    const rod=(part,a,b,r)=>{ const d=V.add(b,V.mul(a,-1)), l=Math.hypot(d[0],d[1],d[2])||0.001; add(part,"capsule",V.mul(V.add(a,b),0.5),[2*r,2*r,l+2*r*0.3],along(V.unit(d))); };
    const ball=(part,c,size,m)=>add(part,"sphere",c,size,[0,0,rz],m);
    /* the body's own directions: U up its spine, F the way its chest faces, R to its right. Standing, sitting and
       kneeling: U is straight up and F is the way the person looks. Lying: the spine lies along the way they were
       facing, on the floor, and the chest faces up. */
    const F2=[f[0],f[1],0], UP=[0,0,1], lying=posture==="lying";
    const U=lying?F2:UP, F=lying?UP:F2, R=V.unit(V.cross(F,U));
    /* A POSE IN TEN NUMBERS (owner 2026-11-26, a beat broken down in code: each frame poses its people). o.joints, in
       radians, always in this order: lean (forward from the hips), twist (the shoulders, to their right), head down,
       head turn (to their right), then for the right arm and for the left arm: forward (0 hangs down, 1.57 points
       straight ahead, less than 0 goes behind), out (0 at the side, 1.57 straight out sideways), elbow (0 straight,
       1.57 a right angle). The spine, the shoulders, the head and the arms follow them; the legs keep the posture.
       Not for someone lying down. The numbers the camera's checks read (head, chest, height) stay the posture's. */
    const cl=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
    const J=(!lying&&arr(obj(o).joints).length===10&&obj(o).joints.every(v=>Number.isFinite(Number(v))))?obj(o).joints.map(Number):null;
    const lean=J?cl(J[0],-0.4,1.1):0, twist=J?cl(J[1],-1,1):0;
    const S=J?V.unit(V.mix(U,Math.cos(lean),F,Math.sin(lean))):U, Fb=J?V.unit(V.mix(F,Math.cos(lean),U,-Math.sin(lean))):F;
    const Ft=J?V.unit(V.mix(Fb,Math.cos(twist),R,Math.sin(twist))):F, Rt=J?V.unit(V.mix(R,Math.cos(twist),Fb,-Math.sin(twist))):R;
    const dotv=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2], handsAt={};
    // where the hips are: so that the head is where the camera's checks have it
    const skull=0.715*s;   // from the hips up the spine to the middle of the head
    // (standing: feet on the floor; lying: the head over the mark, the body behind it)
    const hips=lying?[x-f[0]*skull,y-f[1]*skull,z+0.13*s]:posture==="standing"?[x,y,z+0.95*s]:[x,y,Math.max(z+0.2*s,head[2]-skull)];
    const up=d=>V.add(hips,V.mul(S,d*s));
    ball("pelvis",up(0.02),lying?[0.24*s,0.3*s,0.26*s]:[0.345*s,0.255*s,0.24*s]);
    rod("torso",up(0.06),up(0.5),0.15*s); objects[n()-1].size=r3(lying?[0.24*s,0.36*s,0.56*s]:[0.36*s,0.24*s,0.56*s]);
    if(!lying&&!(J&&Math.abs(lean)>0.03)) objects[n()-1].rotation=[0,0,rz-twist];
    rod("neck",up(0.5),up(0.6),0.052*s);
    const mid=up(0.715);
    ball("head",mid,[0.21*s,0.24*s,0.255*s]);
    // (the way the head looks: the chest's way, turned and tipped by the pose)
    const hturn=J?cl(J[3],-1.3,1.3):0, hdown=J?cl(J[2],-0.6,0.9):0, Fh0=J?V.unit(V.mix(Ft,Math.cos(hturn),Rt,Math.sin(hturn))):F, Fh=J?V.unit(V.mix(Fh0,Math.cos(hdown),S,-Math.sin(hdown))):F;
    ball("nose",V.add(up(0.7),V.mul(Fh,0.125*s)),[0.056*s,0.056*s,0.056*s],dark);
    // what they hold sits 22 cm in front of them at this height (stateScene, hands): the hands go to it
    const holds=Math.max(0,Math.min(2,Number(obj(o).holding)||0)), holdAt=i=>[x+f[0]*0.22+(holds>1?(i?0.09:-0.09):0)*f[1],y+f[1]*0.22-(holds>1?(i?0.09:-0.09):0)*f[0],chest[2]-h*0.16];
    [-1,1].forEach(side=>{
      const tag=side<0?"l":"r", shoulder=V.add(up(0.47),V.mul(Rt,side*0.21*s));
      // arms: down by the sides; on the lap when sitting; to what is held
      const bend=posture==="sitting"?0.3:0.05, elbow=V.add(shoulder,V.mul(V.unit(V.mix(U,-Math.cos(bend),F,Math.sin(bend),R,side*0.06)),0.3*s));
      let toHand=V.unit(V.mix(U,-Math.cos(posture==="sitting"?1.15:0.25),F,Math.sin(posture==="sitting"?1.15:0.25)));
      if(holds&&!lying){ const at=holdAt(holds>1?(side<0?0:1):0), d=V.add(at,V.mul(elbow,-1)); toHand=V.unit(d); }
      let elbowAt=elbow;
      if(J){ // the pose's own arm: the upper arm from its two angles, the forearm bent at the elbow toward the front
        const a=cl(J[side>0?4:7],-1.2,3.1), b=cl(J[side>0?5:8],-0.3,1.8), e=cl(J[side>0?6:9],0,2.6);
        const d=V.unit(V.mix(S,-Math.cos(a)*Math.cos(b),Ft,Math.sin(a)*Math.cos(b),Rt,side*Math.sin(b)));
        let g=V.add(Ft,V.mul(d,-dotv(Ft,d))); if(Math.hypot(g[0],g[1],g[2])<0.05) g=V.add(S,V.mul(d,-dotv(S,d)));
        elbowAt=V.add(shoulder,V.mul(d,0.3*s)); toHand=V.unit(V.mix(d,Math.cos(e),V.unit(g),Math.sin(e))); }
      const wrist=V.add(elbowAt,V.mul(toHand,0.27*s));
      rod("arm-"+tag,shoulder,elbowAt,0.05*s); rod("forearm-"+tag,elbowAt,wrist,0.042*s);
      handsAt[tag]=r3(V.add(wrist,V.mul(toHand,0.05*s)));
      ball("hand-"+tag,V.add(wrist,V.mul(toHand,0.05*s)),[0.1*s,0.1*s,0.1*s]);
      // legs: straight when standing or lying; thighs forward and shins down when sitting; knees on the floor when kneeling
      const hip=V.add(hips,V.mul(R,side*0.1*s));
      let knee, ankle, toe=F2;
      if(posture==="sitting"){ knee=V.add(hip,V.mul(V.unit(V.mix(F,1,U,-0.08)),0.45*s)); ankle=[knee[0],knee[1],Math.max(z+0.08*s,knee[2]-0.42*s)]; }
      else if(posture==="kneeling"){ const drop=Math.max(0,Math.min(0.44*s,hips[2]-(z+0.08*s))), reach=Math.sqrt(Math.max(0,0.45*s*0.45*s-drop*drop));
        knee=[hip[0]+f[0]*reach,hip[1]+f[1]*reach,hip[2]-drop]; ankle=[knee[0]-f[0]*0.42*s,knee[1]-f[1]*0.42*s,z+0.07*s]; toe=[-f[0],-f[1],0]; }
      else{ knee=V.add(hip,V.mul(U,-0.45*s)); ankle=V.add(knee,V.mul(U,-0.42*s)); if(lying) toe=UP; }
      rod("thigh-"+tag,hip,knee,0.075*s); rod("shin-"+tag,knee,ankle,0.055*s);
      // a shoe: its length the way the toes point
      const sole=lying?V.add(ankle,V.mul(U,-0.04*s)):[ankle[0],ankle[1],Math.max(z+0.04*s,ankle[2]-0.04*s)];
      const shoe=V.add(sole,V.mul(toe,0.07*s));
      add("shoe-"+tag,"box",shoe,lying?[0.1*s,0.08*s,0.26*s]:[0.1*s,0.26*s,0.08*s],[0,0,rz],dark);
    });
    const col=arr(rgb).length===3?rgb:colourOf(id);
    return {height:h,turn:rz,front:f,head,chest,posture,objects,hands:handsAt,jointed:!!J,
      material:[mat,{baseColor:col,metallic:0,roughness:0.85,emissionStrength:0}],
      // the nose and the shoes: the same colour, darker (0.55), so the face reads which way it looks
      shade:[dark,{baseColor:col.map(v=>Math.round(v*0.55*1000)/1000),metallic:0,roughness:0.8,emissionStrength:0}]};
  }

  /* ---- things ---- */
  const DEFAULT_SIZE=[0.15,0.1,0.1];
  // "22 x 15 x 9 cm", "30cm long", "about 12 cm" … → [w, d, h] in metres, largest first; null when no number is given
  function sizeFromText(text){
    const t=String(text||"").toLowerCase().replace(/,/g,".");
    const unit=u=>u==="mm"?0.001:u==="cm"?0.01:u==="m"?1:u==="in"||u==="inch"||u==="inches"||u==="″"?0.0254:0.01;
    let m=t.match(/(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)(?:\s*(?:x|×|by)\s*(\d+(?:\.\d+)?))?\s*(mm|cm|m|in|inch|inches)\b/);
    if(m){ const k=unit(m[4]), v=[m[1],m[2],m[3]].filter(x=>x!=null).map(x=>Number(x)*k).sort((a,b)=>b-a);
      return v.length===3?[v[0],v[2],v[1]]:[v[0],Math.min(v[1],0.02),v[1]]; }
    m=t.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m|in|inch|inches)\b/);
    if(m){ const v=Number(m[1])*unit(m[2]); if(v>0&&v<10) return [v,Math.max(0.01,v*0.6),Math.max(0.01,v*0.6)]; }
    return null;
  }
  function sizeOf(thing){
    const t=obj(thing), d=arr(t.dims).map(Number).filter(n=>n>0&&n<20);
    if(d.length===3) return d;
    return sizeFromText(t.size)||sizeFromText(t.scale)||sizeFromText(t.detail)||null;
  }

  /* ---- the room ---- */
  function inside(poly,x,y){ let c=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const a=poly[i],b=poly[j];
      if(((a[1]>y)!==(b[1]>y)) && (x<(b[0]-a[0])*(y-a[1])/((b[1]-a[1])||1e-9)+a[0])) c=!c; } return c; }
  function edgeDistance(poly,x,y){ let best=Infinity; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const a=poly[i],b=poly[j];
      const dx=b[0]-a[0],dy=b[1]-a[1],L=dx*dx+dy*dy||1e-9,t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/L));
      best=Math.min(best,Math.hypot(x-(a[0]+t*dx),y-(a[1]+t*dy))); } return best; }
  // the spaces of a place, from its floor plan: [{id, name, footprint, floorZ}]
  function spacesOf(contract){
    return arr(obj(obj(contract).coordinates).spaces).filter(s=>arr(s.footprint).length>=3)
      .map(s=>({id:String(s.id||""),name:String(s.name||""),footprint:s.footprint.map(p=>[Number(p[0]),Number(p[1])]),floorZ:num(s.floorZ)||0}));
  }
  function spaceAt(spaces,x,y){ return arr(spaces).find(s=>inside(s.footprint,x,y))||null; }

  /* ---- one state of the scene plan, put into the set ---- */
  function markXY(plan,id){ const m=arr(obj(plan).marks).find(x=>x&&String(x.id)===String(id)); const xy=m&&arr(m.xy); return xy&&xy.length===2&&xy.every(n=>Number.isFinite(Number(n)))?[Number(xy[0]),Number(xy[1])]:null; }
  const partsOf=(set,id)=>arr(obj(set).objects).filter(o=>o&&o.position&&o.size&&(String(o.anchorId||"")===String(id)||String(o.id||"")==="anchor-"+id));
  // where a fixed object of the set is, and how high its top is (a thing put "at" it sits on top)
  function fixedTop(set,id){
    const hit=partsOf(set,id);
    if(!hit.length) return null;
    const top=hit.reduce((a,o)=>(o.position[2]+o.size[2]/2>a.position[2]+a.size[2]/2)?o:a,hit[0]);
    return [top.position[0],top.position[1],top.position[2]+top.size[2]/2];
  }
  // the middle of a fixed object or an opening of the set: [x, y, z]
  function fixedCentre(set,id){
    const hit=partsOf(set,id); if(!hit.length) return null;
    return [0,1,2].map(k=>hit.reduce((s,o)=>s+o.position[k],0)/hit.length);
  }
  const STOP=new Set(["the","and","his","her","their","its","with","from","into","onto","that","this","two","both","near","over","down","back","side","who","what"]);
  const words=v=>String(v==null?"":v).toLowerCase().replace(/[‘’']/g,"").replace(/[^a-z0-9]+/g," ").trim().split(" ").filter(w=>w.length>2&&!STOP.has(w));

  /* WHO OR WHAT A PERSON FACES: [x, y] or null. said = an id (a person, a fixed object, an opening, a mark) from the
     camera pass, or the blocking's own words ("Pike at the front door"): a person named in them first (someone not
     in frame is where the beat's blocking puts them), then a fixed object or a mark named whole, then the fixed
     object that shares the most words with them (two at least). o: {block (the beat's blocking row), cast}. */
  function faceTarget(said,me,people,set,plan,o){
    o=o||{};
    const t=String(said==null?"":said).trim(); if(!t) return null;
    if(t==="camera") return arr(o.lookAt).length===2?o.lookAt:null;
    const other=arr(people).find(p=>p.id!==me.id&&String(p.id)===t); if(other) return other.xy;
    const m=markXY(plan,t); if(m) return m;
    const f=fixedCentre(set,t); if(f) return [f[0],f[1]];
    const W=words(t), has=new Set(W), line=" "+W.join(" ")+" ";
    const named=arr(people).find(p=>p.id!==me.id&&words(p.name).some(w=>has.has(w))); if(named) return named.xy;
    const away=arr(o.cast).find(c=>c&&c.id!==me.id&&(String(c.id)===t||words(c.name).some(w=>has.has(w))));
    if(away){ const row=arr(o.block&&o.block.people).find(x=>x&&x.id===away.id), xy=row&&markXY(plan,row.where); if(xy) return xy; }
    const whole=list=>arr(list).find(x=>{ const n=words(x&&x.name); return n.length&&line.indexOf(" "+n.join(" ")+" ")>=0; });
    const fx=whole(obj(plan).fixed); if(fx){ const c=fixedCentre(set,fx.id); if(c) return [c[0],c[1]]; }
    const mk=whole(obj(plan).marks); if(mk){ const xy=markXY(plan,mk.id); if(xy) return xy; }
    let best=null;
    arr(obj(plan).fixed).forEach(x=>{ if(!x) return; const n=new Set(words(x.name+" "+String(x.id).replace(/-/g," "))), hit=W.filter(w=>n.has(w)).length;
      if(hit>=2&&(!best||hit>best.hit)){ const c=fixedCentre(set,x.id); if(c) best={hit,xy:[c[0],c[1]]}; } });
    return best?best.xy:null;
  }

  /* ---- the doors of a state ----
     The set has each door once, shut, as its dressing drew it (a leaf in the opening). A state that says a door is
     OPEN swings that leaf a quarter turn on one jamb: into the smaller of the two rooms it stands between (a front
     door opens into the house), or, when only one side is on the floor plan, into the other; on the jamb where the
     open leaf meets fewer things. A door with no leaf in the set gets a plain one. Nothing else in the set moves. */
  const area=poly=>Math.abs(arr(poly).reduce((s,p,i)=>{ const q=poly[(i+1)%poly.length]; return s+p[0]*q[1]-q[0]*p[1]; },0))/2;
  const jambs=(set,id)=>partsOf(set,id).filter(o=>o.size[2]>=1.5&&Math.max(o.size[0],o.size[1])<=0.2);
  // the opening a state's door id means: the floor plan's own id, or a tracked part of the set ("front-door") by its words
  function openingId(set,id,plan){
    if(jambs(set,id).length>=2) return String(id);
    const w=words(String(id||"").replace(/-/g," ")); if(!w.length) return "";
    const hit=arr(obj(plan).fixed).filter(f=>f&&f.kind==="opening").find(f=>{ const n=new Set(words(f.name+" "+String(f.id).replace(/-/g," "))); return w.every(x=>n.has(x))&&jambs(set,f.id).length>=2; });
    return hit?String(hit.id):"";
  }
  const prefixOf=o=>String(o&&o.name||"").split(" · ")[0];
  // a point of the floor inside a thing's footprint (its box turned about Z), m metres of margin round it
  const footIn=(o,x,y,m)=>{ const rz=(o.rotation&&o.rotation[2])||0, c=Math.cos(-rz), s=Math.sin(-rz), dx=x-o.position[0], dy=y-o.position[1];
    return Math.abs(dx*c-dy*s)<=o.size[0]/2+m&&Math.abs(dx*s+dy*c)<=o.size[1]/2+m; };
  // a door of the set as a line on the floor: {J (its jambs), far (its width), c (its middle), u (along it), n (across it)}
  function doorLine(scene,id){
    const J=jambs(scene,id); let a=J[0],b=J[1],far=0;
    J.forEach(p=>J.forEach(q=>{ const L=Math.hypot(p.position[0]-q.position[0],p.position[1]-q.position[1]); if(L>far){ far=L; a=p; b=q; } }));
    if(far<0.5||far>1.7) return null;                                // a door, not a shop front
    const c=[(a.position[0]+b.position[0])/2,(a.position[1]+b.position[1])/2], u=[(b.position[0]-a.position[0])/far,(b.position[1]-a.position[1])/far];
    return {J,far,c,u,n:[-u[1],u[0]]};
  }
  function poseDoors(scene,doors,ctx){
    ctx=ctx||{};
    const done=[];
    arr(doors).forEach(d=>{
      if(!d||typeof d.open!=="boolean") return;
      const id=openingId(scene,d.id,ctx.plan); if(!id||done.indexOf(id)>=0) return;
      const line=doorLine(scene,id); if(!line) return;
      const J=line.J, far=line.far, c=line.c, u=line.u, n=line.n;
      const floor=Math.min(...J.map(o=>o.position[2]-o.size[2]/2)), top=Math.max(...J.map(o=>o.position[2]+o.size[2]/2));
      const along=o=>(o.position[0]-c[0])*u[0]+(o.position[1]-c[1])*u[1], off=o=>(o.position[0]-c[0])*n[0]+(o.position[1]-c[1])*n[1];
      const isFrame=o=>String(o.anchorId||"")===id, own=o=>/^(fig|prop)-/.test(String(o.id||""));
      let leaf=null;
      scene.objects.forEach(o=>{ if(!o||!o.size||!o.position||isFrame(o)||own(o)||o.kind!=="box") return;
        const L=o.size[0];
        if(o.size[2]<1.6||o.size[1]>0.09||L<far*0.55||L>far*1.1) return;
        if(Math.abs(along(o))>0.15||Math.abs(off(o))>0.15) return;
        const rz=(o.rotation&&o.rotation[2])||0; if(Math.abs(Math.cos(rz)*u[0]+Math.sin(rz)*u[1])<0.9) return;   // lies in the wall
        if(!leaf||L>leaf.size[0]) leaf=o; });
      if(!leaf){
        const fx=arr(obj(ctx.plan).fixed).find(f=>f&&String(f.id)===id), name=String((fx&&fx.name)||prefixOf(J[0])||"");
        if(!/door/i.test(name)||/doorway|arch|opening\b/i.test(name)) return;      // an open doorway has no leaf to draw
        scene.materials=scene.materials||{};
        scene.materials["door-standin"]={baseColor:[0.33,0.27,0.22],metallic:0,roughness:0.7,emissionStrength:0};
        const h=Math.min(2.02,top-floor-0.04);
        leaf={id:"door-"+id,name:(name||"door")+" (door stand-in)",kind:"box",position:[c[0],c[1],floor+h/2],rotation:[0,0,Math.atan2(u[1],u[0])],size:[far-0.06,0.045,h],material:"door-standin"};
        scene.objects.push(leaf);
      }
      done.push(id);
      if(!d.open) return;
      const L=leaf.size[0], lc=[leaf.position[0],leaf.position[1]], ltop=leaf.position[2]+leaf.size[2]/2;
      const group=[leaf].concat(scene.objects.filter(o=>o&&o!==leaf&&o.size&&o.position&&!isFrame(o)&&!own(o)&&prefixOf(o)===prefixOf(leaf)
        &&Math.abs(along(o))<=L/2-0.005&&Math.abs(off(o))<=0.2&&o.position[2]+o.size[2]/2<=ltop+0.005));
      const spaces=arr(ctx.spaces), sideSpace=k=>spaceAt(spaces,c[0]+n[0]*0.4*k,c[1]+n[1]*0.4*k), A=sideSpace(1), B=sideSpace(-1);
      let k=1;
      if(A&&B&&A!==B) k=area(A.footprint)<=area(B.footprint)?1:-1;
      else if(A&&!B) k=-1;
      const into=[n[0]*k,n[1]*k];
      /* how many things the open leaf would pass through on that jamb (2026-11-23: the front door of Scene 5 was drawn
         swung through the hall shelf; things NEAR the leaf were counted, walls among them, and the two jambs tied).
         The leaf is walked from hinge to tip; a thing counts when the leaf enters its footprint at its own height.
         A wall never counts: a leaf folds back flat against it. */
      const meets=h=>{ const H=[lc[0]+u[0]*h*L/2,lc[1]+u[1]*h*L/2], pts=[]; for(let t=0.06;t<=L+0.001;t+=0.04) pts.push([H[0]+into[0]*t,H[1]+into[1]*t]);
        return scene.objects.filter(o=>o&&o.size&&o.position&&o.kind!=="cloth"&&group.indexOf(o)<0&&!isFrame(o)&&!own(o)&&!/^wall-/.test(String(o.id||""))
          &&o.position[2]+o.size[2]/2>floor+0.1&&o.position[2]-o.size[2]/2<Math.min(ltop,floor+2)
          &&pts.some(q=>footIn(o,q[0],q[1],0.02))).length; };
      const h=meets(-1)<=meets(1)?-1:1, H=[lc[0]+u[0]*h*L/2,lc[1]+u[1]*h*L/2];
      const from=[-u[0]*h,-u[1]*h], th=Math.atan2(from[0]*into[1]-from[1]*into[0],from[0]*into[0]+from[1]*into[1]), cs=Math.cos(th), sn=Math.sin(th);
      group.forEach(o=>{ const rx=o.position[0]-H[0], ry=o.position[1]-H[1], r=o.rotation||[0,0,0];
        o.position=[H[0]+rx*cs-ry*sn,H[1]+rx*sn+ry*cs,o.position[2]]; o.rotation=[r[0]||0,r[1]||0,(r[2]||0)+th]; });
    });
    return scene;
  }

  /* ---- what hangs, and what sits on what ---- */
  const HOOKY=/\b(hooks?|pegs?)\b/i;
  const volOf=o=>o.size[0]*o.size[1]*o.size[2];
  // the hook of a fixed thing a tracked thing hangs from: {xy, z (the hook's height: the thing's top), out (off the wall, into the room), reach}
  function hangOn(set,id,spaces){
    const parts=partsOf(set,id); if(!parts.length) return null;
    const c=fixedCentre(set,id), big=parts.reduce((a,o)=>volOf(o)>volOf(a)?o:a,parts[0]);
    const small=parts.filter(o=>o!==big&&volOf(o)<volOf(big)*0.5), from=small.length?small:[big], near=o=>Math.hypot(o.position[0]-c[0],o.position[1]-c[1]);
    const hook=from.reduce((a,o)=>near(o)<near(a)-1e-6?o:a,from[0]);
    const rz=(big.rotation&&big.rotation[2])||0;
    let out=big.size[1]<=big.size[0]?[-Math.sin(rz),Math.cos(rz)]:[Math.cos(rz),Math.sin(rz)];
    const room=k=>{ const x=hook.position[0]+out[0]*k*0.25, y=hook.position[1]+out[1]*k*0.25, sp=spaceAt(spaces,x,y); return sp?edgeDistance(sp.footprint,x,y):-1; };
    if(room(-1)>room(1)) out=[-out[0],-out[1]];
    return {xy:[hook.position[0],hook.position[1]],z:hook.position[2],out,reach:Math.min(hook.size[0],hook.size[1])/2+0.005};
  }
  /* WHAT SITS ON EACH FIXED THING OF THE SET (2026-11-23, after moment 2 of Scene 5 came back with a stack of tubs on
     the hall shelf that no drawing and no page has: nothing had told the image engine what is on the shelf, so it
     dressed it itself). Read from the set: what its dressing put on each fixed thing the scene plan names (another
     fixture by its name, loose dressing by its shape, colour and size), the tracked things that are on it or hang
     from it now, and how many hooks a row of hooks has. Only fixed things that hold something, or are hooks. set = the
     set as built (its doors as drawn: a leaf swung open is no dressing of the shelf it passes).
     → [{id, name, centre:[x,y,z], hooks, own:[{name, fixture} | {name, items:[words]}], things:[{name, hung}]}] */
  const PLAIN=/^(paper|card|brown|steel|black|blue|mustard|oak|red|green|white|grey|gray|cream|brass|glass|wood|pink|yellow|orange|purple|tan|silver|gold|copper|chrome|plastic|cloth|beige|navy|teal|olive|pine|tin|clay|wicker)$/;
  function describe(o){
    const m=String(o.material||"").replace(/^d_/,"").toLowerCase(), big=Math.max(o.size[0],o.size[1],o.size[2]), round=o.kind==="cylinder"||o.kind==="sphere";
    const shape=round?"round":o.kind==="cushion"?"soft":o.size[2]<=0.03?"flat":"";
    return ["a",shape,PLAIN.test(m)?m:"","thing"].filter(Boolean).join(" ")+" about "+Math.max(1,Math.round(big*100))+" cm "+(round&&o.size[2]<big?"across":o.size[2]>=big?"tall":"long");
  }
  function restsOn(set,plan,things){
    const out=[], objs=arr(obj(set).objects).filter(o=>o&&o.size&&o.position&&!/^(fig|prop|wall|door)-/.test(String(o.id||"")));
    arr(obj(plan).fixed).forEach(fx=>{ if(!fx||fx.kind==="opening") return;
      const id=String(fx.id), parts=partsOf(set,id); if(!parts.length) return;
      const mine=o=>String(o.anchorId||"")===id||String(o.id||"")==="anchor-"+id;
      const rest=objs.filter(o=>!mine(o)&&parts.some(pt=>{ const top=pt.position[2]+pt.size[2]/2, gap=(o.position[2]-o.size[2]/2)-top;
        if(top<0.1||gap<-0.02||gap>0.08) return false;                 // (a floor or a rug holds the whole room: not a shelf)
        return footIn(pt,o.position[0],o.position[1],0.03); }));
      const groups=new Map();
      rest.forEach(o=>{ const k=o.anchorId?"a:"+o.anchorId:"l:"+prefixOf(o); if(!groups.has(k)) groups.set(k,o.anchorId?{name:prefixOf(o),fixture:true}:{name:prefixOf(o),items:[]});
        if(!o.anchorId) groups.get(k).items.push(describe(o)); });
      const hooks=HOOKY.test(String(fx.name||""))?Math.max(1,parts.length-1):0, on=arr(things).filter(t=>t.onId===id);
      if(!groups.size&&!on.length&&!hooks) return;
      const c=fixedCentre(set,id);
      out.push({id,name:String(fx.name||id),centre:[c[0],c[1],Math.max(...parts.map(pt=>pt.position[2]+pt.size[2]/2))],hooks,own:Array.from(groups.values()),things:on.map(t=>({name:t.name,hung:!!t.hung}))});
    });
    return out;
  }
  const lowName=n=>String(n||"").replace(/\s+/g," ").trim().replace(/^the /i,"").replace(/^[A-Z](?=[a-z])/,c=>c.toLowerCase());
  const listed=a=>a.length<3?a.join(" and "):a.slice(0,-1).join(", ")+" and "+a[a.length-1];
  // the same, in sentences for the image engine and the check: what is on each, and that nothing else is
  function dressingWords(surfaces){
    return arr(surfaces).map(s=>{
      const boxes=arr(s.things).map(t=>"the red shape that is the "+lowName(t.name));
      if(s.hooks) return boxes.length ? "On the "+lowName(s.name)+(s.hooks>1?" ("+s.hooks+" hooks)":"")+" hang"+(boxes.length===1?"s":"")+" only "+listed(boxes)+(s.hooks>boxes.length?": every other hook is empty.":".")
        : "Nothing hangs on the "+lowName(s.name)+(s.hooks>1?": all "+s.hooks+" hooks are empty.":".");
      const own=[]; arr(s.own).forEach(g=>{ if(g.fixture){ own.push("the "+lowName(g.name)); return; }
        const it=arr(g.items); it.slice(0,4).forEach(x=>own.push(x)); if(it.length>4) own.push((it.length-4)+" more small things like them"); });
      const all=own.concat(boxes);
      return "On the "+lowName(s.name)+" "+(all.length===1?"sits":"sit")+" only "+listed(all)+": nothing else is on it.";
    });
  }

  /* ctx: {cast:[{id,name,height}], props:[prop cards], spaces, plan, beat, faces:{person id → who or what they face},
     lookAt:[x,y] (where a person with nobody to face looks: the camera), sizeFor(key, thing, card)}. Returns the set
     with the state in: {scene, base (the set with its doors as the state has them, nobody in it), people:[{id, name,
     xy, head, chest, height, turn, front}], things:[{key, name, at, size, held, measured}], worn:[{key, by, name}] (what a
     person has on: no box, but a camera can look at it), missing:[…what could not be placed]} */
  function stateScene(set,plan,state,ctx){
    ctx=ctx||{};
    const scene=JSON.parse(JSON.stringify(set)), st=obj(state), missing=[], people=[], things=[], worn=[];
    scene.materials=scene.materials||{};
    poseDoors(scene,st.doors,{plan,spaces:ctx.spaces});
    const base=JSON.parse(JSON.stringify(scene));
    scene.materials["prop-standin"]={baseColor:[0.72,0.09,0.06],metallic:0,roughness:0.6,emissionStrength:0};
    // a prop built from parts (prop-model.js) is all red too: three more reds tell its parts apart (a lid, a screen, a blade)
    scene.materials["prop-standin-2"]={baseColor:[0.5,0.05,0.04],metallic:0,roughness:0.6,emissionStrength:0};
    scene.materials["prop-standin-3"]={baseColor:[0.3,0.03,0.03],metallic:0,roughness:0.6,emissionStrength:0};
    scene.materials["prop-standin-4"]={baseColor:[0.9,0.32,0.26],metallic:0,roughness:0.6,emissionStrength:0};
    const castOf=id=>arr(ctx.cast).find(c=>c&&String(c.id)===String(id))||{id};
    const spaces=arr(ctx.spaces);
    const here=[];
    Object.keys(obj(st.people)).forEach(id=>{
      const p=obj(st.people[id]), c=castOf(id);
      // (a state may put someone between two marks: the middle picture of a walk across the room)
      const off=arr(p.xy).map(Number), xy=(off.length===2&&off.every(Number.isFinite))?off:markXY(plan,p.where);
      if(!xy){ missing.push((c.name||id)+" has no place on the floor plan"+(p.where?" ("+p.where+")":"")); return; }
      here.push({id,name:c.name||id,xy,pose:p.pose,card:c,holding:arr(p.holding).slice(),
        // (a frame written out for a beat says which way they face, in degrees from north, and their pose in ten numbers)
        face:(p.face!=null&&Number.isFinite(Number(p.face)))?Number(p.face):null,joints:arr(p.joints).length===10?arr(p.joints).map(Number):null});
    });
    /* A PERSON AT A DOOR THAT IS SHUT (2026-11-23, after moment 2 of Scene 5: the plan put Pike "on the threshold",
       "standing outside the shut door", and the floor plan has that mark 10 cm inside the door; he was drawn in the
       hall, in front of a shut door, and the image engine opened the door to make sense of it). Nobody stands in a
       shut doorway. Someone whose mark is on the line of a shut door stands clear of its leaf, on the side their mark
       is on; when the door leads outdoors and the plan's own words put them out there (outside, on the step,
       knocking), on the outdoor side. They keep the door (person.door) so a camera on the other side knows a shut
       door is between them: it does not have to see them, and the picture's words say they are not in it. */
    const outdoors=new Set(arr(ctx.outdoors).map(String)), out=sp=>!sp||outdoors.has(String(sp.id));
    arr(st.doors).forEach(d=>{
      if(!d||d.open!==false||!spaces.length) return;
      const id=openingId(scene,d.id,plan), L=id?doorLine(scene,id):null; if(!L) return;
      const A=spaceAt(spaces,L.c[0]+L.n[0]*0.4,L.c[1]+L.n[1]*0.4), B=spaceAt(spaces,L.c[0]-L.n[0]*0.4,L.c[1]-L.n[1]*0.4);
      if(!A&&!B) return;
      const fx=arr(obj(plan).fixed).find(f=>f&&String(f.id)===id), name=String((fx&&fx.name)||prefixOf(L.J[0])||"door");
      here.forEach(me=>{
        const dx=me.xy[0]-L.c[0], dy=me.xy[1]-L.c[1], along=dx*L.u[0]+dy*L.u[1], off=dx*L.n[0]+dy*L.n[1];
        if(Math.abs(along)>L.far/2+0.1||Math.abs(off)>=0.3) return;
        const said=String(me.pose||"").toLowerCase();
        let k=off>=0?1:-1;
        if(out(A)!==out(B)&&/\b(outside|outdoors|doorstep|on the step|on the porch|knock\w*|rings? the bell|ringing the bell)\b/.test(said)&&!/\b(inside|indoors)\b/.test(said)) k=out(A)?1:-1;
        me.xy=[L.c[0]+L.u[0]*along+L.n[0]*k*0.4,L.c[1]+L.u[1]*along+L.n[1]*k*0.4];
        me.door={id,name,c:L.c.slice(),n:L.n.slice(),k};
      });
    });
    // two people the plan put on ONE mark stand side by side on it (half a metre apart), never inside each other
    here.forEach((me,i)=>{ const same=here.filter(p=>Math.hypot(p.xy[0]-me.xy[0],p.xy[1]-me.xy[1])<0.05);
      if(same.length>1&&same[0]===me) same.forEach((p,k)=>{ p.xy=[p.xy[0]+(k-(same.length-1)/2)*0.5,p.xy[1]]; }); });
    const colours=paletteFor(plan,here.map(p=>p.id));
    // who or what each faces: the camera pass's answer, else the blocking's words for this beat, else the others, else the camera
    const block=arr(obj(plan).blocking).find(b=>b&&Number(b.beat)===Number(ctx.beat));
    here.forEach(me=>{
      const said=[obj(ctx.faces)[me.id],((arr(block&&block.people).find(x=>x&&x.id===me.id))||{}).facing];
      let to=null; said.forEach(v=>{ if(!to) to=faceTarget(v,me,here,set,plan,{block,cast:ctx.cast,lookAt:ctx.lookAt}); });
      if(!to){ const rest=here.filter(p=>p.id!==me.id); if(rest.length) to=[rest.reduce((s,p)=>s+p.xy[0],0)/rest.length,rest.reduce((s,p)=>s+p.xy[1],0)/rest.length]; }
      if(!to&&arr(ctx.lookAt).length===2) to=ctx.lookAt;
      const turn=me.face!=null?-me.face*Math.PI/180:(to?turnTo(me.xy,to):null);
      const col=colours[me.id]||null;
      const sp=spaceAt(spaces,me.xy[0],me.xy[1]), fig=figure(me.id,me.name,me.xy,sp?sp.floorZ:0,heightOf(me.card),me.pose,turn==null?0:turn,col&&col.rgb,{holding:arr(me.holding).length,joints:me.joints});
      fig.objects.forEach(o=>scene.objects.push(o)); scene.materials[fig.material[0]]=fig.material[1]; scene.materials[fig.shade[0]]=fig.shade[1];
      people.push({id:me.id,name:me.name,xy:me.xy,head:fig.head,chest:fig.chest,height:fig.height,turn:fig.turn,front:fig.front,holding:me.holding,...(fig.jointed?{hands:fig.hands}:{}),
        pose:String(me.pose||""),colour:col?col.name:"",door:me.door||null});
    });
    const thingOf=key=>arr(obj(plan).things).find(t=>t&&String(t.key)===String(key))||{key};
    const propOf=t=>arr(ctx.props).find(c=>c&&((t.propId&&String(c.id)===String(t.propId))||String(c.name||"").toLowerCase()===String(t.name||"").toLowerCase()))||null;
    // on = {id, name} of the fixed thing it is on; hang = {xy, z, out, reach}: it hangs from that hook, long and flat to the wall
    /* A PROP IN CODE (owner 2026-11-24: "props in code ... so that image previs captures the exact size"). Each prop is
       its MODEL (prop-model.js): its true size, read from its card's numbers or size text, or the usual size of such
       a thing, and its shape built from parts. A thing of no known shape and no numbers is still one small box, and
       the drawing says it is a guess (measured:false). ctx.sizeFor, when given, sets a plain box of that size. */
    const PM=root.KinolotPropModel||null;
    const put=(key,centre,held,turn,on,hang)=>{ const t=thingOf(key); if(t.kind&&t.kind!=="prop") return; if(things.some(x=>x.key===key)) return;
      const card=propOf(t), known=sizeOf(card)||sizeOf(t), forced=(typeof ctx.sizeFor==="function"&&ctx.sizeFor(key,t,card))||null;
      const model=!forced&&PM?PM.modelOf(card,t):null, name=t.name||String(key).replace(/-/g," ");
      let size=forced||(model&&model.dims.slice())||known||DEFAULT_SIZE.slice();
      let pos=[centre[0],centre[1],centre[2]+size[2]/2], rz=turn||0;
      if(hang){ const d=size.slice().sort((a,b)=>a-b), far=hang.reach+d[0]/2; size=[d[1],d[0],d[2]];
        pos=[hang.xy[0]+hang.out[0]*far,hang.xy[1]+hang.out[1]*far,hang.z-size[2]/2]; rz=Math.atan2(-hang.out[0],hang.out[1]); }
      if(model) PM.place(model,{id:"prop-"+key,name:name+" (prop stand-in)",centre:pos,rz,hang:!!hang}).objects.forEach(o=>scene.objects.push(o));
      else scene.objects.push({id:"prop-"+key,name:name+" (prop stand-in)",kind:"box",position:pos,rotation:[0,0,rz],size,material:"prop-standin"});
      things.push({key,name,at:[pos[0],pos[1],pos[2]-size[2]/2],size,held:held||"",on:(on&&on.name)||"",onId:(on&&on.id)||"",hung:!!hang,
        measured:model?model.basis!=="guess":!!known,...(model?{form:model.form,shape:model.label,basis:model.basis}:{})}); };
    // what a person holds sits at their hands, in front of them; two things sit side by side
    const hands=(p,i,n)=>{
      // (posed in ten numbers: a thing is in the hand itself, the first in the right; one thing between two hands held close is in both)
      if(p.hands&&p.hands.r&&p.hands.l){ const a=p.hands.r, b=p.hands.l, both=n===1&&Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])<0.32, c=both?[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2]:(i?b:a); return [c[0],c[1],c[2]-0.03]; }
      const r=[p.front[1],-p.front[0]], s=n>1?(i?0.09:-0.09):0; return [p.xy[0]+p.front[0]*0.22+r[0]*s,p.xy[1]+p.front[1]*0.22+r[1]*s,p.chest[2]-p.height*0.16]; };
    people.forEach(p=>p.holding.forEach((key,i)=>put(key,hands(p,i,p.holding.length),p.id,p.turn)));
    Object.keys(obj(st.things)).forEach(key=>{
      const v=st.things[key]; if(!v||typeof v!=="object") return;
      if(v.heldBy){ const p=people.find(x=>x.id===v.heldBy); if(p) put(key,hands(p,0,1),p.id,p.turn); return; }
      if(v.worn){ const p=people.find(x=>x.id===v.worn); if(p) worn.push({key,by:p.id,name:thingOf(key).name||String(key).replace(/-/g," ")}); return; }
      if(v.in) return;
      if(v.at){ const xy=markXY(plan,v.at); if(xy){ const sp=spaceAt(spaces,xy[0],xy[1]); put(key,[xy[0],xy[1],sp?sp.floorZ:0]); return; }
        const top=fixedTop(set,v.at); if(top){ const fx=arr(obj(plan).fixed).find(f=>f&&String(f.id)===String(v.at)), on={id:String(v.at),name:(fx&&fx.name)||""};
          // keys on a hook hang under it (2026-11-23: they sat on top of the hook board as a box on a shelf would)
          const hangs=/\b(hang\w*|hung|hook\w*)\b/i.test(String(v.state||""))||HOOKY.test(on.name);
          put(key,top,"",0,on,hangs?hangOn(set,v.at,spaces):null); return; }
        const t=thingOf(key); if(!t.kind||t.kind==="prop") missing.push((t.name||key)+" is somewhere the floor plan does not hold"); }
    });
    return {scene,base,people,things,worn,missing,surfaces:restsOn(set,plan,things)};
  }

  /* ---- the camera ---- */
  // how much height a frame of each size shows (metres), and where on a standing person it is centred (share of height)
  const FRAME={ECU:[0.22,0.94],CU:[0.42,0.92],MCU:[0.68,0.86],MS:[1.05,0.74],MWS:[1.5,0.6],FS:[2.1,0.5],WS:[3.2,0.5],EWS:[5.5,0.5],INSERT:[0.35,0.5]};
  const SIZE_WORD={ECU:"extreme close-up",CU:"close-up",MCU:"medium close-up",MS:"medium shot",MWS:"medium wide shot",FS:"full shot",WS:"wide shot",EWS:"extreme wide shot",INSERT:"insert"};
  const EYE={eye:1.5,high:2.15,low:0.75,top:2.6,dutch:1.5,ots:1.55,pov:1.55};
  const vfovOf=lens=>2*Math.atan(10.125/lens);          // a 36 mm-wide frame at 16:9 is 20.25 mm high
  const lensFor=(frameH,dist)=>10.125/((frameH/2)/dist);
  const clampLens=v=>Math.max(14,Math.min(135,Math.round(Number(v)||35)));
  const sizeKey=sh=>{ const k=String(obj(sh).size||"MS").toUpperCase(); return FRAME[k]?k:"MS"; };
  const baseOf=p=>p.head[2]-p.height+0.115;
  function aim(from,to,lens){ const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2];
    return {position:from.map(n=>Math.round(n*1000)/1000),yaw:Math.round(Math.atan2(dx,dy)*DEG*100)/100,
      pitch:Math.max(-89,Math.min(89,Math.round(Math.atan2(dz,Math.hypot(dx,dy))*DEG*100)/100)),lensMm:Math.round(lens)}; }
  // a person standing between the camera and what it looks at hides it
  function hides(from,to,person){
    const ax=to[0]-from[0], ay=to[1]-from[1], L=ax*ax+ay*ay; if(L<1e-6) return false;
    const t=((person.xy[0]-from[0])*ax+(person.xy[1]-from[1])*ay)/L; if(t<=0.04||t>=0.94) return false;
    if(Math.hypot(person.xy[0]-(from[0]+t*ax),person.xy[1]-(from[1]+t*ay))>=0.2) return false;
    return from[2]+t*(to[2]-from[2])<person.head[2]+0.13;
  }
  // a person at a shut door, seen from the other side of it: the door is between them and the camera
  const beyond=(p,x,y)=>!!(p&&p.door)&&((((x-p.door.c[0])*p.door.n[0]+(y-p.door.c[1])*p.door.n[1])>=0?1:-1)!==p.door.k);
  // a point inside a wall, a door or a piece of furniture of the set (each as its box, turned about Z)
  function solidAt(set,p,margin){
    const m=margin==null?0.08:margin;
    return arr(obj(set).objects).some(o=>{ if(!o||!o.size||!o.position||o.kind==="cloth"||/^(fig|prop)-/.test(String(o.id||""))) return false;
      const r=o.rotation||[0,0,0]; if(Math.abs(r[0]||0)>0.01||Math.abs(r[1]||0)>0.01) return false;
      if(Math.abs(p[2]-o.position[2])>o.size[2]/2) return false;
      const c=Math.cos(-(r[2]||0)), s=Math.sin(-(r[2]||0)), dx=p[0]-o.position[0], dy=p[1]-o.position[1];
      return Math.abs(dx*c-dy*s)<=o.size[0]/2+m&&Math.abs(dx*s+dy*c)<=o.size[1]/2+m; });
  }
  /* Where the camera stands for a shot, FOUND BY THE APP (a plan with no camera numbers). people = the stand-ins in
     frame; spaces = the place's rooms; opts.clear(from,to) says whether a sight line is free (the set's own meshes);
     opts.set = the set (no camera inside a wall); opts.all = everyone in the room (nobody may hide a face);
     opts.point = [x,y,z] what to look at when nobody is in frame (an insert); opts.side = +1 | -1, the side of the
     line to keep. Tries the planned lens at the distance that frames the shot, all round; then closer with a wider
     lens. Returns {pose, lensPlanned, distance, side, notes[], fits} — fits:false with a pose of last resort. */
  function camera(shot,people,spaces,opts){
    opts=opts||{};
    const sh=obj(shot), notes=[], point=arr(opts.point).length===3?opts.point:null;
    const who=point?[]:arr(people).filter(Boolean);
    const lensPlanned=clampLens(String(sh.lens||"").replace(/[^\d.]/g,""));
    const fr=FRAME[sizeKey(sh)];
    if(!who.length&&!point) return {pose:null,lensPlanned,notes:["Nobody is placed in this frame, so the camera has nothing to aim at."],fits:false};
    // what the frame is centred on: the people's middle, at the height the shot size looks at
    const cx=point?point[0]:who.reduce((s,p)=>s+p.xy[0],0)/who.length, cy=point?point[1]:who.reduce((s,p)=>s+p.xy[1],0)/who.length;
    const baseZ=point?point[2]:who.reduce((s,p)=>s+baseOf(p),0)/who.length, tall=point?0:who.reduce((s,p)=>s+p.height,0)/who.length;
    const spread=who.length>1?Math.max(...who.map(p=>Math.hypot(p.xy[0]-cx,p.xy[1]-cy)))*2:0;
    const frameH=Math.max(fr[0],spread*0.62+ (who.length>1?fr[0]*0.5:0));
    const target=point?point.slice():[cx,cy,baseZ+tall*fr[1]];
    const eye=point?point[2]+0.3:baseZ+(EYE[String(sh.angle||"eye").toLowerCase()]||EYE.eye)*(tall/1.7);
    // the line between the two people furthest apart: the camera keeps to one side of it for the whole scene
    let axis=null; if(who.length>1){ let best=0; who.forEach(a=>who.forEach(b=>{ const d=Math.hypot(a.xy[0]-b.xy[0],a.xy[1]-b.xy[1]); if(d>best){ best=d; axis=[b.xy[0]-a.xy[0],b.xy[1]-a.xy[1]]; } })); }
    const sideOf=(x,y)=>axis?Math.sign(axis[0]*(y-cy)-axis[1]*(x-cx))||1:1;
    const room=(x,y)=>{ const sp=spaceAt(spaces,x,y); return sp&&edgeDistance(sp.footprint,x,y)>=0.22?sp:null; };
    const everyone=arr(opts.all).length?arr(opts.all):who, look=point?[point]:who.map(p=>p.head);
    // how many of the faces a spot sees (a wall, a shut door, a piece of furniture or another person can hide one)
    const seen=(from)=>(opts.set&&solidAt(opts.set,from))?-1:point?((typeof opts.clear!=="function"||opts.clear(from,point))?1:0)
      :who.filter(p=>beyond(p,from[0],from[1])||((typeof opts.clear!=="function"||opts.clear(from,p.head))&&!everyone.some(q=>q.id!==p.id&&!beyond(q,from[0],from[1])&&hides(from,p.head,q)))).length;
    const all=point?1:who.length;
    const want=(frameH/2)/Math.tan(vfovOf(lensPlanned)/2);
    let best=null;
    // first a spot that sees everyone; when a face is hidden from everywhere (a person behind a shut door), the most it can
    [all,1].forEach(need=>{
      if(best) return;
      [1,0.8,0.62,0.48,0.36].forEach(k=>{
        if(best&&best.k===1&&best.n===all) return;
        for(let i=0;i<32;i++){
          const a=i/32*Math.PI*2, dist=Math.max(0.55,want*k), x=cx+Math.sin(a)*dist, y=cy+Math.cos(a)*dist;
          if(!room(x,y)) continue;
          const from=[x,y,eye], n=seen(from); if(n<need) continue;
          const side=sideOf(x,y);
          // people side by side read better than one behind the other: favour a view across the line
          const across=axis?Math.abs(axis[0]*Math.cos(a)-axis[1]*Math.sin(a))/Math.hypot(axis[0],axis[1]):1;
          const score=n*40+k*10+across*3+(opts.side&&side===opts.side?4:0)+(opts.side&&side!==opts.side?-6:0);
          if(!best||score>best.score) best={score,k,from,dist,side,n};
        }
      });
    });
    if(best&&best.n<all) notes.push("Not everyone in this shot can be seen from any spot in the room as it starts: someone is behind a wall or a shut door.");
    if(!best){
      const sp=spaceAt(spaces,cx,cy)||arr(spaces)[0];
      const from=[cx,cy+0.9,eye];
      return {pose:aim(from,target,Math.min(lensPlanned,24)),lensPlanned,distance:0.9,side:opts.side||1,fits:false,
        notes:["No camera position inside "+(sp&&sp.name||"the room")+" frames this shot and sees everyone in it. Move a mark, or change the shot's size."]};
    }
    const lens=clampLens(lensFor(frameH,best.dist));
    if(best.k<1) notes.push("The room is too tight for a "+lensPlanned+" mm lens at this size: the camera stands "+best.dist.toFixed(1)+" m back with a "+lens+" mm lens.");
    if(opts.side&&best.side!==opts.side) notes.push("This camera is on the other side of the line from the scene's earlier shots.");
    return {pose:aim(best.from,target,best.k<1?lens:lensPlanned),lensPlanned,distance:Math.round(best.dist*100)/100,side:best.side,notes,fits:true};
  }

  /* WHAT A PLANNED CAMERA LOOKS AT. cam.aim = ids (people, tracked things, fixed objects, openings, marks); with none,
     the people in frame. People are framed at the height the shot size looks at (a close-up at the face, a full shot
     at the waist). Returns {target:[x,y,z], who:[people], frameH} or null when there is nothing to look at. */
  function aimOf(cam,shot,placed,set,plan){
    const sh=obj(shot), key=sizeKey(sh), fr=FRAME[key], ids=arr(obj(cam).aim).map(String);
    const P=arr(placed.people), T=arr(placed.things), pts=[];
    let who=P.filter(p=>ids.indexOf(p.id)>=0);
    ids.forEach(id=>{ if(who.some(p=>p.id===id)) return;
      const t=T.find(x=>x.key===id); if(t){ pts.push([t.at[0],t.at[1],t.at[2]+t.size[2]/2]); return; }
      // what someone has on is looked at where it is worn: shoes at the floor, a hat at the head
      const w=arr(placed.worn).find(x=>x.key===id), on=w&&P.find(p=>p.id===w.by);
      if(on){ const n=String(w.name+" "+w.key).toLowerCase(), k=/shoe|boot|lace|sock|trainer|slipper|sandal/.test(n)?0.05:/trouser|jean|belt|skirt|pocket/.test(n)?0.5:/hat|cap|glasses|scarf|collar|tie\b|earring|hijab|veil|hood/.test(n)?0.9:0.66;
        pts.push([on.xy[0]+on.front[0]*0.12,on.xy[1]+on.front[1]*0.12,baseOf(on)+on.height*k]); return; }
      const f=fixedCentre(set,id); if(f){ pts.push(f); return; }
      const m=markXY(plan,id); if(m) pts.push([m[0],m[1],1.1]); });
    if(!who.length&&!pts.length){ who=P.filter(p=>arr(sh.subjects).indexOf(p.id)>=0);
      if(!who.length){ const keys=arr(sh.planThings), seen=T.filter(t=>keys.indexOf(t.key)>=0); (seen.length?seen:[]).forEach(t=>pts.push([t.at[0],t.at[1],t.at[2]+t.size[2]/2])); }
      if(!who.length&&!pts.length) who=P.slice(); }
    who.forEach(p=>pts.push([p.xy[0],p.xy[1],baseOf(p)+p.height*fr[1]]));
    if(!pts.length) return null;
    return {target:[0,1,2].map(k=>pts.reduce((s,p)=>s+p[k],0)/pts.length),who,frameH:fr[0],size:key};
  }
  /* THE CAMERA THE SCENE PLAN GAVE IN NUMBERS, CHECKED. cam = {at:[x,y], height, aim:[ids], lens}; placed = the shot's
     start state in the set (stateScene); set = that set with nobody in it. The camera must stand on the floor plan,
     outside every wall and piece of furniture, clear of the people, and see every face it frames (no wall, no other
     person in the way). When it does not, it goes to the spot within 2 m that does and keeps the shot best (the one that keeps
     the planned direction best), and the note says why and how far. The lens is then checked against the shot size:
     when it would show much more or much less than planned from there, it is set to the lens that shows it.
     Returns {pose, lensPlanned, distance, notes[], fits, source:"plan"|"moved"|"app"} or null when cam has no numbers. */
  const WHY={outside:"The planned camera stood off the floor plan.",solid:"The planned camera stood inside a wall or a piece of furniture.",
    person:"The planned camera stood where a person stands.",hidden:"From the planned camera something in the set hid who the shot is of.",
    behind:"From the planned camera one person hid another."};
  /* A CAMERA SET BY HAND (owner 2026-11-24, step 5: "a camera set by hand keeps its own direction and is never
     moved. Every check still runs and its notes are shown"). It stands and looks exactly as it was chosen in the
     location's camera tool; the checks say what they find and change nothing. */
  const HAND_WHY={outside:"Your angle stands off this place\u2019s floor plan.",solid:"Your angle stands inside a wall or a piece of furniture.",
    person:"Your angle stands where a person stands as this shot starts.",hidden:"From your angle something in the set hides someone this shot frames.",
    behind:"From your angle one person hides another."};
  // is a point inside the picture a camera takes? (16:9; a little slack at the edges)
  function inFrame(pose,pt){
    const p=obj(pose), at=arr(p.position), yaw=Number(p.yaw)/DEG, pitch=Number(p.pitch)/DEG;
    const f=[Math.sin(yaw)*Math.cos(pitch),Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch)], r=[Math.cos(yaw),-Math.sin(yaw),0];
    const u=[r[1]*f[2]-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]-r[1]*f[0]], d=[pt[0]-at[0],pt[1]-at[1],pt[2]-at[2]];
    const z=d[0]*f[0]+d[1]*f[1]+d[2]*f[2]; if(z<=0.05) return false;
    const tv=Math.tan(vfovOf(Number(p.lensMm)||35)/2), th=tv*16/9;
    return Math.abs(d[0]*r[0]+d[1]*r[1]+d[2]*r[2])/z<=th*1.02&&Math.abs(d[0]*u[0]+d[1]*u[1]+d[2]*u[2])/z<=tv*1.02;
  }
  function handCamera(cam,shot,placed,set,plan,spaces,opts){
    opts=opts||{};
    const c=obj(cam), pose=obj(c.pose), from=arr(pose.position).map(Number), sh=obj(shot);
    if(from.length!==3||!from.every(Number.isFinite)) return null;
    const lens=Math.max(8,Math.min(200,Math.round(Number(pose.lensMm)||35))), notes=[], P=arr(placed.people);
    const a=aimOf(c,sh,placed,set,plan), framed=a?a.who.concat(P.filter(p=>arr(sh.subjects).indexOf(p.id)>=0&&a.who.indexOf(p)<0)):[];
    const x=from[0], y=from[1], sp=spaceAt(spaces,x,y), own=String(sh.angle||"").toLowerCase()==="pov";
    const out={position:from.map(n=>Math.round(n*1000)/1000),yaw:Number(pose.yaw)||0,pitch:Math.max(-89,Math.min(89,Number(pose.pitch)||0)),lensMm:lens};
    // the same checks as a planned camera, in the same order; each one only says what it finds
    if(!sp) notes.push(HAND_WHY.outside);
    else if(edgeDistance(sp.footprint,x,y)<0.1||solidAt(set,from)) notes.push(HAND_WHY.solid);
    else if(!own&&P.some(q=>!beyond(q,x,y)&&Math.hypot(q.xy[0]-x,q.xy[1]-y)<0.3)) notes.push(HAND_WHY.person);
    const seen=framed.filter(p=>!beyond(p,x,y)), cut=seen.filter(p=>!inFrame(out,p.head)), inside=seen.filter(p=>cut.indexOf(p)<0);
    if(cut.length) notes.push(cut.map(p=>p.name||"Someone").join(" and ")+(cut.length>1?" are":" is")+" outside the picture from your angle as this shot starts.");
    if(typeof opts.clear==="function"&&inside.some(p=>!opts.clear(from,p.head))) notes.push(HAND_WHY.hidden);
    else if(inside.some(w=>P.some(q=>q.id!==w.id&&!beyond(q,x,y)&&hides(from,w.head,q)))) notes.push(HAND_WHY.behind);
    const dist=a?Math.hypot(a.target[0]-from[0],a.target[1]-from[1],a.target[2]-from[2])||0.01:0;
    if(a&&inside.length){
      const shows=2*dist*Math.tan(vfovOf(lens)/2);
      if(shows<a.frameH*0.72||shows>a.frameH*1.5) notes.push("From "+dist.toFixed(1)+" m your "+lens+" mm lens shows "+(shows<a.frameH?"less":"more")+" than the "+SIZE_WORD[a.size]+" this shot was planned as.");
    }
    P.forEach(q=>{ const d=[q.xy[0]-x,q.xy[1]-y], l=Math.hypot(d[0],d[1]), f=[Math.sin(out.yaw/DEG),Math.cos(out.yaw/DEG)];
      if(l>0.01&&l<0.5&&(d[0]*f[0]+d[1]*f[1])/l>0.7&&!own&&!beyond(q,x,y)) notes.push((q.name||"Someone")+" stands "+l.toFixed(1)+" m in front of the camera and fills much of the frame."); });
    return {pose:out,lensPlanned:lens,distance:Math.round(dist*100)/100,side:opts.side||1,notes,fits:true,source:"hand",from:obj(c.from)};
  }
  function planCamera(cam,shot,placed,set,plan,spaces,opts){
    opts=opts||{};
    // (a camera set by hand is never moved)
    if(obj(cam).hand===true&&obj(cam).pose){ const mine=handCamera(cam,shot,placed,set,plan,spaces,opts); if(mine) return mine; }
    const c=obj(cam), at=arr(c.at).map(Number);
    if(at.length!==2||!at.every(Number.isFinite)) return null;
    const sh=obj(shot), a=aimOf(c,sh,placed,set,plan); if(!a) return null;
    const notes=[], angle=String(sh.angle||"eye").toLowerCase();
    const lensPlanned=clampLens(c.lens||String(sh.lens||"").replace(/[^\d.]/g,""));
    const h=Math.max(0.12,Math.min(3.2,Number(c.height)>0?Number(c.height):(EYE[angle]||EYE.eye)));
    const P=arr(placed.people);
    /* EVERY FACE THE SHOT FRAMES MUST BE SEEN, not only the one the camera is centred on (2026-11-23: the first frame
       made from a previs had Pike hidden behind Liaqat; the camera was aimed at Liaqat alone, and the image engine
       moved Liaqat aside to show Pike). framed = who the camera aims at and who the shot says is in frame. */
    const framed=a.who.concat(P.filter(p=>arr(sh.subjects).indexOf(p.id)>=0&&a.who.indexOf(p)<0));
    const look=framed.length?framed.map(p=>p.head):[a.target];
    // over the shoulder: the person the camera stands behind is in the frame on purpose, and never counts as in the way
    const ots=angle==="ots", own=angle==="pov";
    const nearest=(x,y)=>{ let b=null,bd=1.3; if(ots) P.forEach(q=>{ if(beyond(q,x,y)) return; const d=Math.hypot(q.xy[0]-x,q.xy[1]-y); if(d<bd){ bd=d; b=q; } }); return b; };
    const why=(x,y)=>{ const sp=spaceAt(spaces,x,y); if(!sp) return "outside";
      const p=[x,y,sp.floorZ+h], over=nearest(x,y);
      if(edgeDistance(sp.footprint,x,y)<0.1||solidAt(set,p)) return "solid";
      // (someone behind a shut door from here is not in the picture: nothing to see, and nobody they could hide)
      if(!own&&P.some(q=>!beyond(q,x,y)&&Math.hypot(q.xy[0]-x,q.xy[1]-y)<(ots?0.22:0.3))) return "person";
      if(typeof opts.clear==="function"&&!look.every((pt,i)=>(over&&framed[i]===over)||beyond(framed[i],x,y)||opts.clear(p,pt))) return "hidden";
      if(framed.some(w=>w!==over&&!beyond(w,x,y)&&P.some(q=>q.id!==w.id&&q!==over&&!beyond(q,x,y)&&hides(p,w.head,q)))) return "behind";
      return ""; };
    let x=at[0], y=at[1], source="plan";
    const bad=why(x,y);
    if(bad){
      /* THE SPOT THAT KEEPS THE SHOT, not only the nearest one (2026-11-23: the nearest spot that saw both men stood
         0.4 m from one of them). Every spot within 2 m that works is weighed: it looks from much the same direction,
         stands about as far from what it frames as the planned camera did, and is not moved further than it must be. */
      const d0=[a.target[0]-x,a.target[1]-y], l0=Math.hypot(d0[0],d0[1])||1; let best=null;
      for(let r=0.15;r<=2.01;r+=0.15){
        for(let i=0;i<16;i++){ const an=i/16*Math.PI*2, nx=x+Math.sin(an)*r, ny=y+Math.cos(an)*r; if(why(nx,ny)) continue;
          const d=[a.target[0]-nx,a.target[1]-ny], l=Math.hypot(d[0],d[1])||1;
          // a spot that would stand at well under two thirds of the planned distance, or nearly twice as far, is another shot
          if((bad==="hidden"||bad==="behind")&&(l/l0<0.62||l/l0>1.8)) continue;
          const score=(d[0]*d0[0]+d[1]*d0[1])/(l*l0)-Math.abs(l-l0)/l0-r*0.3;
          if(!best||score>best.score) best={x:nx,y:ny,score,r}; }
      }
      if(!best&&(bad==="hidden"||bad==="behind")){
        // it can stand there, and nowhere near sees more (a person behind a shut door as the shot starts): it stays
        notes.push(bad==="hidden"?"As this shot starts, something in the set hides someone it frames (a wall or a shut door), from the planned camera and from every spot near it that keeps the shot."
          :"As this shot starts, one person hides another from the planned camera and from every spot near it that keeps the shot.");
      }else if(!best){
        const found=camera(sh,framed,spaces,{clear:opts.clear,set,all:P,point:framed.length?null:a.target,side:opts.side});
        return {...found,source:"app",notes:[WHY[bad]+" No spot near it works, so the app placed the camera."].concat(found.notes||[])};
      }else{
        notes.push(WHY[bad]+" It was moved "+best.r.toFixed(2).replace(/0$/,"")+" m, to the spot that works and keeps the shot best.");
        x=best.x; y=best.y; source="moved";
      }
    }
    const from=[x,y,spaceAt(spaces,x,y).floorZ+h], dist=Math.hypot(a.target[0]-from[0],a.target[1]-from[1],a.target[2]-from[2])||0.01;
    // what the frame must show: the shot size, and everyone it frames, side by side as the camera sees them
    const v=[a.target[0]-from[0],a.target[1]-from[1]], vl=Math.hypot(v[0],v[1])||1, right=[v[1]/vl,-v[0]/vl];
    const across=a.who.map(p=>p.xy[0]*right[0]+p.xy[1]*right[1]), lat=across.length>1?Math.max(...across)-Math.min(...across):0;
    const wantH=Math.max(a.frameH,(lat+0.5)*9/16), shows=2*dist*Math.tan(vfovOf(lensPlanned)/2);
    let lens=lensPlanned;
    if(shows<wantH*0.72||shows>wantH*1.5){
      lens=clampLens(lensFor(wantH,dist));
      if(Math.abs(lens-lensPlanned)>=3) notes.push("From "+dist.toFixed(1)+" m a "+lensPlanned+" mm lens shows "+(shows<wantH?"less":"more")+" than the "+SIZE_WORD[a.size]+" planned, so the lens is "+lens+" mm.");
      else lens=lensPlanned;
    }
    // someone right in front of the lens fills the frame: said, never hidden (the plan may mean it, over a shoulder)
    P.forEach(q=>{ const d=[q.xy[0]-from[0],q.xy[1]-from[1]], l=Math.hypot(d[0],d[1]);
      if(l>0.01&&l<0.5&&(d[0]*v[0]+d[1]*v[1])/(l*vl)>0.7&&!own&&!beyond(q,from[0],from[1])) notes.push((q.name||"Someone")+" stands "+l.toFixed(1)+" m in front of the camera and fills much of the frame."); });
    return {pose:aim(from,a.target,lens),lensPlanned,distance:Math.round(dist*100)/100,side:opts.side||1,notes,fits:true,source};
  }
  /* WHAT EACH STAND-IN IS, in plain sentences (for the image engine that renders over the previs, and for the check
     that compares the frame with it): who each coloured figure is, and what each red shape is, where, and its true
     size (a prop is drawn in code at the size its card gives it: the frame must keep that size). */
  function legend(people,things){
    const P=arr(people), lines=[];
    // someone behind a shut door from this camera (p.unseen, set by pair) is not in the picture, and neither is what they hold
    P.forEach(p=>lines.push(p.unseen ? p.name+" is on the other side of the shut "+lowName(obj(p.door).name||"door")+" and is NOT in this picture: no figure stands for them"+(p.pose?" ("+p.pose+")":"")+"."
      : "The "+(p.colour||"coloured")+" figure is "+p.name+(p.pose?" ("+p.pose+")":"")+"."));
    arr(things).forEach(t=>{ const h=t.held&&P.find(p=>p.id===t.held); if(h&&h.unseen) return;
      // its size in the drawing is its size: said, so the frame keeps it (a guessed size is not said)
      const cm=t.measured&&t.basis&&root.KinolotPropModel?root.KinolotPropModel.sizeWords(t.size):"";
      lines.push("The red shape "+(h?"in "+h.name+"\u2019s hands":t.on?(t.hung?"hanging from the ":"on the ")+String(t.on).replace(/^the /i,"").replace(/^./,c=>c.toLowerCase()):"standing on its own")
        +" is the "+String(t.name).replace(/^the /i,"")+(cm?(t.basis==="usual"?", drawn at the usual size of such a thing (":", drawn at its true size (")+cm+")":"")+"."); });
    return lines;
  }
  // the scene plan keeps one camera a shot, by beat and moment
  function cameraKey(shot){ const sh=obj(shot), b=Number(sh.beatN!=null?sh.beatN:sh.beat), m=Number(sh.moment&&typeof sh.moment==="object"?sh.moment.n:sh.moment);
    return (Number.isFinite(b)&&b>0?b:0)+"."+(Number.isFinite(m)&&m>0?m:1); }

  /* ---- drawing ---- */
  // sight lines through the set (walls and furniture, never the stand-ins): {clear(from, to), dispose()}
  async function sight(set){
    const A=root.KinolotAnglePreview; if(!A) throw new Error("The 3D view did not load. Refresh this page.");
    const T=await A.load(), meshes=[], bin=[];
    arr(set.objects).forEach(item=>{ if(item.kind==="cloth") return;
      const g=A.geometry(T,item), m=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide})); bin.push(g); bin.push(m.material);
      m.position.set(...item.position); m.scale.set(...item.size);
      const [x,y,z]=item.rotation||[0,0,0];
      m.quaternion.setFromRotationMatrix(new T.Matrix4().makeRotationZ(z).multiply(new T.Matrix4().makeRotationY(y)).multiply(new T.Matrix4().makeRotationX(x)));
      m.updateMatrixWorld(true); meshes.push(m); });
    const ray=new T.Raycaster();
    return { clear(from,to){ const a=new T.Vector3(...from), d=new T.Vector3(...to).sub(a), len=d.length(); if(len<0.05) return true;
        ray.set(a,d.normalize()); ray.near=0.02; ray.far=len-0.06; return ray.intersectObjects(meshes,false).length===0; },
      dispose(){ bin.forEach(g=>g.dispose()); } };
  }
  /* WHAT A CAMERA'S FRAME HOLDS, read from the set with its stand-ins in (2026-11-23: the first frame made from a
     previs did not follow it; nothing had told the image engine which plain shape is which thing, as the location
     card's own previs does). Rays through the frame name what is seen, where in the frame and how near:
     [{name, side, depth, share}], largest first. Never throws: a frame that cannot be read is an empty list. */
  const SIDES=["far left","left","centre","right","far right"], COMPASS=["north","north-east","east","south-east","south","south-west","west","north-west"];
  async function seenIn(scene,pose){
    try{
      const A=root.KinolotAnglePreview, T=await A.load(), meshes=[], bin=[];
      arr(scene.objects).forEach(item=>{ if(!item||!item.size||!item.position) return;
        const g=A.geometry(T,item), m=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide})); bin.push(g); bin.push(m.material);
        m.position.set(...item.position); m.scale.set(...item.size);
        const [x,y,z]=item.rotation||[0,0,0];
        m.quaternion.setFromRotationMatrix(new T.Matrix4().makeRotationZ(z).multiply(new T.Matrix4().makeRotationY(y)).multiply(new T.Matrix4().makeRotationX(x)));
        m.updateMatrixWorld(true); m.userData.name=String(item.name||""); meshes.push(m); });
      const cam=A.cameraFor(T,pose); cam.updateMatrixWorld(true);
      const ray=new T.Raycaster(), hits=new Map(), COLS=16, ROWS=9, reach=[];
      for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
        ray.setFromCamera(new T.Vector2((c+0.5)/COLS*2-1,1-(r+0.5)/ROWS*2),cam);
        const hit=ray.intersectObjects(meshes,false)[0]; if(!hit) continue;
        reach.push(hit.distance);
        const name=String(hit.object.userData.name||"").split(/ \u00b7 | - part /)[0].replace(/ \((?:prop |door )?stand-in\)$/,"").replace(/\s+/g," ").trim().slice(0,70); if(!name) continue;
        const e=hits.get(name)||{name,n:0,x:0,d:Infinity}; e.n++; e.x+=(c+0.5)/COLS; e.d=Math.min(e.d,hit.distance); hits.set(name,e); }
      bin.forEach(g=>g.dispose());
      const list=Array.from(hits.values()).sort((a,b)=>b.n-a.n).slice(0,10).map(e=>({name:e.name,share:Math.round(e.n/(COLS*ROWS)*100),
        side:SIDES[Math.min(4,Math.floor(e.x/e.n*5))],depth:e.d<1.2?"very close":e.d<2.5?"close":e.d<8?"middle distance":"far"}));
      // how deep the picture is: the furthest thing any part of the frame reaches (list.far, metres; 0 when it could not be read)
      reach.sort((a,b)=>a-b); list.far=reach.length>=COLS*ROWS*0.6?Math.round(reach[Math.floor(reach.length*0.97)]*10)/10:0;
      return list;
    }catch(_){ return []; }
  }
  // the camera and its frame in words: "camera 1.5 m high, facing south-west, 24 mm lens (wide). In its frame: …"
  function frameWords(pose,list){
    const p=obj(pose), lens=Number(p.lensMm)||35, tilt=Number(p.pitch)||0;
    return "camera "+(Math.round(arr(p.position)[2]*10)/10)+" m high, facing "+COMPASS[Math.round((((Number(p.yaw)||0)%360)+360)%360/45)%8]
      +(tilt<=-12?", looking down":tilt>=12?", looking up":"")+", "+lens+" mm lens ("+(lens<=22?"very wide":lens<=32?"wide":lens<=60?"normal":"long")+")."
      +(arr(list).length?" In its frame: "+list.map(v=>v.name+" ("+v.side+", "+v.depth+")").join("; ")+".":"");
  }
  /* WHICH OF THE SET'S DRESSED SURFACES A CAMERA HAS IN ITS FRAME: inside the picture, within 8 m, and with no wall
     between (the line is tried to a point just short of the surface, so the surface and what is on it never count as
     in the way). The nearest four. Never throws: a frame that cannot be read holds none. */
  async function inView(surfaces,pose,set){
    if(!arr(surfaces).length) return [];
    let lines=null;
    try{
      const A=root.KinolotAnglePreview, T=await A.load(), cam=A.cameraFor(T,pose); cam.updateMatrixWorld(true);
      lines=await sight(set);
      const from=pose.position, hit=[];
      arr(surfaces).forEach(s=>{ const c=[s.centre[0],s.centre[1],s.centre[2]+0.08], d=Math.hypot(c[0]-from[0],c[1]-from[1],c[2]-from[2]); if(d>8) return;
        const v=new T.Vector3(c[0],c[1],c[2]).project(cam); if(!(Math.abs(v.x)<=0.98&&Math.abs(v.y)<=0.98&&v.z>-1&&v.z<1)) return;
        const k=Math.max(0,(d-0.35)/Math.max(d,0.01)), near=[from[0]+(c[0]-from[0])*k,from[1]+(c[1]-from[1])*k,from[2]+(c[2]-from[2])*k];
        if(d>0.5&&!lines.clear(from,near)) return;
        hit.push({s,d}); });
      return hit.sort((a,b)=>a.d-b.d).slice(0,4).map(x=>x.s);
    }catch(_){ return []; }
    finally{ if(lines) lines.dispose(); }
  }
  /* THE FRAME, MEASURED (owner 2026-11-24: "fix the framing so the frame matches the drawing"). The first frame made
     from a drawing after props were built in code held their sizes and lost the picture: the drawing looked across a
     hall at a flat wall, through a doorway, looking down; the image engine made a level view along the hall. Words
     like "left, very close" leave room for that. So the drawing is measured, in code: where each head is in the
     frame and how big, where the lower edge cuts each person, where each thing is and how wide, what stands left to
     right, who is nearest, how deep the picture goes, which size of shot it really is and whether the camera looks
     down or up. Plain numbers through the same camera the drawing was made with (36 mm wide, 16:9); nothing is drawn.
       project(pose, [x, y, z])  → {across, down (parts of the frame, from its left and top edges), depth (m)} | null
       measure(pose, people, things, surfaces) → {size, pitch, people[], things[], fixed[], order[], nearest[]}
                                 (a thing a person stands in front of from this camera is marked hidden, and said so)
       frameMap(m, far)          → the same, in sentences for the image engine and for the check */
  function project(pose,point){
    const q=obj(pose), c=arr(q.position), a=(Number(q.yaw)||0)*Math.PI/180, t=(Number(q.pitch)||0)*Math.PI/180, lens=Number(q.lensMm)||35;
    if(c.length!==3||arr(point).length!==3) return null;
    const look=[Math.sin(a)*Math.cos(t),Math.cos(a)*Math.cos(t),Math.sin(t)], right=[Math.cos(a),-Math.sin(a),0];
    const up=[right[1]*look[2]-right[2]*look[1],right[2]*look[0]-right[0]*look[2],right[0]*look[1]-right[1]*look[0]];
    const d=[point[0]-c[0],point[1]-c[1],point[2]-c[2]], dot=v=>d[0]*v[0]+d[1]*v[1]+d[2]*v[2], depth=dot(look);
    if(!(depth>0.05)) return null;
    return {across:(dot(right)/(depth*18/lens)+1)/2,down:(1-dot(up)/(depth*10.125/lens))/2,depth};
  }
  // how much height shows at a distance, and the size of shot that is (the heights the cameras are placed by)
  const SIZE_BY_HEIGHT=[["ECU",0.32],["CU",0.55],["MCU",0.865],["MS",1.275],["MWS",1.8],["FS",2.65],["WS",Infinity]];
  const SIZE_NAME={ECU:"an extreme close-up",CU:"a close-up",MCU:"a medium close-up (from the chest up)",MS:"a medium shot (from the waist or the thighs up)",MWS:"a medium wide shot (from about the knees up)",FS:"a full shot (the whole figure)",WS:"a wide shot"};
  const SIZE_BY_CUT={"the shoulders":"CU","the chest":"MCU","the waist":"MS","the hips":"MS","mid-thigh":"MS","the knees":"MWS","the shins":"MWS","the ankles":"FS"};
  const BODY=[["the shoulders",0.82],["the chest",0.72],["the waist",0.6],["the hips",0.52],["mid-thigh",0.4],["the knees",0.28],["the shins",0.13],["the ankles",0.04]];
  const pct=n=>Math.round(Math.max(0,Math.min(1,n))*100);
  function measure(pose,people,things,surfaces){
    const lens=Number(obj(pose).lensMm)||35, out={size:"",pitch:Math.round(Number(obj(pose).pitch)||0),people:[],things:[],fixed:[],order:[],nearest:[]}, bodies=[];
    const inFrame=v=>v&&v.across>-0.02&&v.across<1.02&&v.down>-0.05&&v.down<1.05;
    arr(people).forEach(p=>{ if(!p||p.unseen||arr(p.head).length!==3) return;
      const mid=project(pose,p.head), top=project(pose,[p.head[0],p.head[1],p.head[2]+0.115]), chin=project(pose,[p.head[0],p.head[1],p.head[2]-0.115]);
      if(!mid||!top||!chin||!(mid.across>-0.1&&mid.across<1.1&&chin.down>0&&top.down<1)) return;
      const posture=POSTURE(p.pose), tall=(Number(p.height)||DEFAULT_HEIGHT)*LOWERS[posture], floor=p.head[2]+0.115-tall;
      // where the lower edge of the frame cuts them (standing): the part of the body it passes nearest to
      let cut="", feet=project(pose,[p.head[0],p.head[1],floor]);
      if(posture==="standing"){
        if(feet&&feet.down<=1) cut="whole";
        else{ let at=1; for(let i=0;i<=50;i++){ const f=1-i/50, v=project(pose,[p.head[0],p.head[1],floor+tall*f]); if(v&&v.down>=1){ at=f; break; } at=f; }
          cut=BODY.reduce((best,b)=>Math.abs(b[1]-at)<Math.abs(best[1]-at)?b:best,BODY[0])[0]; } }
      out.people.push({id:p.id,name:p.name,across:pct(mid.across),down:pct(mid.down),head:Math.round((chin.down-top.down)*100),room:top.down<0?-1:pct(top.down),cut,
        feet:cut==="whole"&&feet?pct(feet.down):0,depth:Math.round(mid.depth*10)/10,shows:mid.depth*20.25/lens});
      // (the part of the frame their body surely covers: a metre across the frame at their distance, from the top of the head down)
      bodies.push({id:p.id,name:p.name,x:mid.across,metre:1/(mid.depth*36/lens),top:top.down,depth:mid.depth}); });
    /* what a person stands in front of, from this camera: further away than they are, behind the middle of their body
       (within `reach` metres of its centre line: 0.17 for a small thing, 0.1 for a fixture, which is wider than its
       middle and shows either side of them), and not in their own hands */
    const behind=(v,holder,reach)=>{ const b=bodies.find(b=>b.id!==holder&&v.depth>b.depth+0.1&&Math.abs(v.across-b.x)<reach*b.metre&&v.down>b.top); return b?b.name:""; };
    arr(things).forEach(t=>{ if(!t||arr(t.at).length!==3||arr(t.size).length!==3) return;
      const holder=t.held&&arr(people).find(p=>p.id===t.held); if(holder&&holder.unseen) return;
      const v=project(pose,[t.at[0],t.at[1],t.at[2]+t.size[2]/2]); if(!inFrame(v)) return;
      out.things.push({key:t.key,name:t.name,across:pct(v.across),down:pct(v.down),wide:Math.max(1,Math.round(Math.max(t.size[0],t.size[1])/(v.depth*36/lens)*100)),held:t.held||"",on:t.on||"",hung:!!t.hung,depth:Math.round(v.depth*10)/10,hidden:behind(v,t.held||"",0.17)}); });
    arr(surfaces).forEach(f=>{ if(!f||arr(f.centre).length!==3) return; const v=project(pose,f.centre); if(!inFrame(v)) return;
      out.fixed.push({id:f.id,name:f.name,across:pct(v.across),down:pct(v.down),depth:Math.round(v.depth*10)/10,hidden:behind(v,"",0.1)}); });
    // left to right: the people, what holds things, and things that stand on their own
    out.order=out.people.map(p=>({name:p.name,across:p.across})).concat(out.fixed.filter(f=>!f.hidden).map(f=>({name:"the "+lowName(f.name),across:f.across})),
      out.things.filter(t=>!t.held&&!t.on&&!t.hidden).map(t=>({name:"the "+lowName(t.name),across:t.across}))).sort((a,b)=>a.across-b.across).map(x=>x.name);
    out.nearest=out.people.slice().sort((a,b)=>a.depth-b.depth).map(p=>({name:p.name,depth:p.depth}));
    /* the size of shot it really is, by the person nearest the middle of the frame: where the lower edge cuts them
       when they stand (a wide lens close up and tilted shows more of a body than its distance says), else by how
       much height shows where they are */
    const lead=out.people.slice().sort((a,b)=>Math.abs(a.across-50)-Math.abs(b.across-50))[0];
    if(lead) out.size=lead.cut==="whole"?(lead.head<6?"WS":"FS"):(SIZE_BY_CUT[lead.cut]||SIZE_BY_HEIGHT.find(x=>lead.shows<x[1])[0]);
    out.people.forEach(p=>{ delete p.shows; });
    return out;
  }
  function frameMap(m,far){
    const f=obj(m); if(!arr(f.people).length&&!arr(f.things).length) return "";
    const s=["THE FRAME, MEASURED ON IMAGE 1 (the finished picture measures the same; \"across\" is from the left edge, \"down\" from the top edge, as parts of the frame)."];
    if(f.size) s.push("It is "+SIZE_NAME[f.size]+(Math.abs(f.pitch)>=6?", and the camera looks "+(f.pitch<0?"DOWN":"UP")+" about "+Math.abs(f.pitch)+" degrees: it is not a level view":", from a level camera")+".");
    if(arr(f.order).length>1) s.push("From left to right the frame holds: "+f.order.join(", then ")+". Keep that order.");
    arr(f.people).forEach(p=>s.push(p.name+": the head is "+p.across+"% across and "+p.down+"% down and is "+p.head+"% of the frame’s height"
      +(p.room<0?"; the top edge of the frame cuts through the head":"; "+(p.room<=3?"the head almost touches the top edge":p.room+"% of the frame is above the head"))
      +(p.cut==="whole"?"; the whole figure is in frame, the feet "+p.feet+"% down":p.cut?"; the lower edge of the frame cuts them at "+p.cut:"")+"."));
    arr(f.fixed).forEach(x=>s.push(x.hidden?"The "+lowName(x.name)+" is behind "+x.hidden+" from this camera: it is not seen.":"The "+lowName(x.name)+" is "+x.across+"% across and "+x.down+"% down."));
    arr(f.things).forEach(t=>s.push(t.hidden?"The "+String(t.name).replace(/^the /i,"")+" is behind "+t.hidden+" from this camera: it is not seen."
      :"The "+String(t.name).replace(/^the /i,"")+" is "+t.across+"% across and "+t.down+"% down, about "+t.wide+"% of the frame’s width."));
    if(arr(f.nearest).length>1) s.push("Nearest the camera is "+f.nearest[0].name+" ("+f.nearest[0].depth+" m), then "+f.nearest.slice(1).map(x=>x.name+" ("+x.depth+" m)").join(", then ")+".");
    const deep=Number(far)||0;
    if(deep>0&&deep<4.5) s.push("Nothing in this picture is further than about "+deep+" m from the camera: it is a close view against what stands behind the people, with NO view along a corridor and no far room.");
    else if(deep>=4.5) s.push("The furthest thing in this picture is about "+Math.round(deep)+" m from the camera.");
    return s.join(" ");
  }
  const sameState=(a,b)=>JSON.stringify(a||null)===JSON.stringify(b||null);
  /* A PLANNED SHOT, DRAWN: how it starts and how it ends, from ONE camera. o: {cam (the plan's camera for this shot,
     in numbers), cast, props, width, side, look ("clay" | "depth": the same drawing in that look)}. The camera is worked out from how the shot STARTS and kept for how it
     ends, so the two pictures differ only by what moved. Returns {start:{dataUrl}, end:{dataUrl}|null (null when the
     shot ends as it starts; with o.words each also has words: the camera and what its frame holds, read from the
     set), width, height, pose, source ("plan" | "moved" | "app"), fits, notes[], missing[],
     rough[] (things drawn at a guessed size), lensPlanned, distance, people, things}. Throws the set builder's own
     sentence when the place has no floor plan or the 3D view cannot start. */
  async function pair(location,list,plan,shot,o){
    o=o||{};
    const P=root.KinolotPrevis; if(!P) throw new Error("The 3D view did not load. Refresh this page.");
    if(typeof root.locationSpatialContract!=="function") throw new Error("The floor plan reader did not load. Refresh this page.");
    const built=P.scene(location,list), spaces=spacesOf(root.locationSpatialContract(location));
    // (a beat staged once hands in the whole room as the shot starts and ends: o.startState / o.endState; o.midState = a walk's middle)
    const sh=obj(shot), startState=o.startState||sh.startState||sh.endState||{}, endState=o.endState||sh.endState||null;
    const cam=o.cam&&typeof o.cam==="object"?o.cam:null;
    // (which of the place's spaces are out of doors: a front door that is shut has an outdoor side)
    const outdoors=arr(list).concat([location]).filter(l=>l&&/ext/i.test(String(l.intExt||""))&&!/int/i.test(String(l.intExt||""))).map(l=>String(l.id));
    const ctx={cast:o.cast,props:o.props,spaces,plan,beat:Number(sh.beatN!=null?sh.beatN:sh.beat)||0,faces:cam&&cam.faces,lookAt:cam&&arr(cam.at).length===2?cam.at:null,outdoors};
    const first=stateScene(built.scene,plan,startState,ctx);
    let found=o.pose?{pose:o.pose,notes:[],fits:true,source:o.source||"plan",side:o.side||1}:null;
    if(!found){
      const lines=await sight(first.base);
      try{
        found=cam?planCamera(cam,sh,first,first.base,plan,spaces,{clear:lines.clear,side:o.side}):null;
        if(!found){
          const inFrame=arr(sh.subjects).length?first.people.filter(p=>arr(sh.subjects).indexOf(p.id)>=0):first.people;
          const a=inFrame.length?null:aimOf({},sh,first,first.base,plan);
          found={...camera(sh,inFrame,spaces,{clear:lines.clear,set:first.base,all:first.people,point:a&&!a.who.length?a.target:null,side:o.side}),source:"app"};
        }
      }finally{ lines.dispose(); }
    }
    const rough=first.things.filter(t=>!t.measured).map(t=>t.name);
    const out={start:null,end:null,width:0,height:0,pose:found.pose||null,source:found.source||"app",from:found.from||null,fits:!!found.fits,notes:arr(found.notes).slice(),
      missing:first.missing.slice(),rough,lensPlanned:found.lensPlanned,distance:found.distance,side:found.side,people:first.people,things:first.things};
    if(!found.pose) return out;
    // who a shut door hides from this camera: said, and left out of what the picture is told it holds
    const at=found.pose.position, unseen=list=>arr(list).forEach(p=>{ p.unseen=beyond(p,at[0],at[1]); });
    unseen(first.people);
    first.people.filter(p=>p.unseen).forEach(p=>out.notes.push(p.name+" is on the other side of the shut "+lowName(p.door.name)+" as this shot starts, so the picture starts without them."));
    const width=Math.max(320,Math.min(1920,Math.round(o.width||1280))), height=Math.round(width*9/16);
    out.width=width; out.height=height;
    // o.look: the same drawing as "clay" or "depth" (KinolotPrevis); none = the Colour drawing, which a frame is made from
    const draw=async(scene)=>{ const view=await P.viewer(scene,built.light,{look:o.look}), canvas=root.document.createElement("canvas");
      try{ view.render(canvas,found.pose,width,height); }finally{ view.dispose(); }
      return canvas.toDataURL("image/jpeg",0.9); };
    out.start={dataUrl:await draw(first.scene)};
    if(o.words){ const seen=await seenIn(first.scene,found.pose); out.start.words=frameWords(found.pose,seen); out.start.dressing=dressingWords(await inView(first.surfaces,found.pose,first.base));
      out.start.frame=measure(found.pose,first.people,first.things,first.surfaces); out.start.map=frameMap(out.start.frame,seen.far); }
    out.mid=o.midState?{dataUrl:await draw(stateScene(built.scene,plan,o.midState,ctx).scene)}:null;
    // (a beat written out frame by frame, owner 2026-11-26: every frame's state through this same camera; o.steps = [state])
    if(Array.isArray(o.steps)&&o.steps.length){ out.steps=[]; for(const st of o.steps) out.steps.push({dataUrl:await draw(stateScene(built.scene,plan,st,ctx).scene)}); }
    if(endState&&!sameState(startState,endState)){
      const last=stateScene(built.scene,plan,endState,ctx);
      unseen(last.people);
      out.end={dataUrl:await draw(last.scene),people:last.people,things:last.things};
      if(o.words){ const seen=await seenIn(last.scene,found.pose); out.end.words=frameWords(found.pose,seen); out.end.dressing=dressingWords(await inView(last.surfaces,found.pose,last.base));
        out.end.frame=measure(found.pose,last.people,last.things,last.surfaces); out.end.map=frameMap(out.end.frame,seen.far); }
      last.missing.forEach(m=>{ if(out.missing.indexOf(m)<0) out.missing.push(m); });
      last.things.filter(t=>!t.measured).forEach(t=>{ if(out.rough.indexOf(t.name)<0) out.rough.push(t.name); });
    }
    return out;
  }
  /* ---- A WHOLE BEAT, STAGED ONCE (owner 2026-11-23: "render an entire beat in code and then extract shots from
     that beat ... it is important to show each shot inside each scene beat") ----
     The scene plan writes each shot's start and end by who is IN ITS FRAME. A beat staged once is one room that goes
     on: everyone a shot of the beat has named is still there in the next shot, where they were last left, and so is
     every thing and every door. beatStates walks the beat's shots in order and gives each its start and end as that
     whole room. A shot starts EXACTLY where the one before it ended (the same instant, by construction); the plan's own
     start counts only for who and what appears for the first time, or after a time-cut or a change of set, where the
     plan's start is the new truth. Where the plan wrote a different start for someone already placed, `differs` says
     so. Pure. shots: [{id, startState, endState, handoff, planSet}] in order.
     → [{id, start, end, joins (starts where the last one ended), cut ("" | "time-cut" | "set"), differs:[ids]}] */
  const stateCopy=s=>{ const o=obj(s); return JSON.parse(JSON.stringify({people:obj(o.people),things:obj(o.things),doors:arr(o.doors)})); };
  const samePlace=(a,b)=>String(obj(a).where||"")===String(obj(b).where||"")&&JSON.stringify(arr(obj(a).holding).slice().sort())===JSON.stringify(arr(obj(b).holding).slice().sort());
  function layer(world,state,keep){
    // the state's own people, things and doors laid over the room as it stands; keep = what the room's own version wins for
    const w=stateCopy(world), st=stateCopy(state), kept=new Set(arr(keep)), newPeople=[], newThings=[];
    Object.keys(st.people).forEach(id=>{ if(kept.has(id)&&w.people[id]) return; w.people[id]=st.people[id]; newPeople.push(id); });
    Object.keys(st.things).forEach(k=>{ if(kept.has("thing:"+k)&&w.things[k]) return; w.things[k]=st.things[k]; newThings.push(k); });
    st.doors.forEach(d=>{ if(!d||!d.id) return; const i=w.doors.findIndex(x=>x&&x.id===d.id);
      if(i<0) w.doors.push(d); else if(!kept.has("door:"+d.id)) w.doors[i]=d; });
    // ONE FACT, SAID ONCE: the newer word about who holds what is the truth, and the room's older word gives way
    const drop=(k,but)=>Object.keys(w.people).forEach(id=>{ if(id!==but) w.people[id].holding=arr(w.people[id].holding).filter(x=>x!==k); });
    newPeople.forEach(id=>{ const mine=arr(w.people[id].holding);
      // what they held before and no longer do is out of their hands (where it went is the state's to say, or nobody's)
      Object.keys(w.things).forEach(k=>{ if(obj(w.things[k]).heldBy===id&&mine.indexOf(k)<0&&newThings.indexOf(k)<0) delete w.things[k]; });
      mine.forEach(k=>{ if(newThings.indexOf(k)>=0&&obj(w.things[k]).heldBy!==id) return;   // the state's own word on the thing wins
        w.things[k]={heldBy:id,...(obj(w.things[k]).state?{state:w.things[k].state}:{})}; drop(k,id); }); });
    newThings.forEach(k=>{ const h=obj(w.things[k]).heldBy;
      if(h&&w.people[h]){ if(arr(w.people[h].holding).indexOf(k)<0) w.people[h].holding=arr(w.people[h].holding).concat([k]); drop(k,h); }
      else drop(k,""); });
    Object.keys(w.people).forEach(id=>{ w.people[id].holding=arr(w.people[id].holding).filter(k=>!w.things[k]||w.things[k].heldBy===id); });
    return w;
  }
  function beatStates(shots){
    const out=[]; let world=null, prev=null;
    arr(shots).forEach(sh=>{
      sh=obj(sh);
      const planned=stateCopy(sh.startState||sh.endState), last=stateCopy(sh.endState||sh.startState);
      const cut=!prev?"":(String(obj(prev.handoff).type||"")==="time-cut"?"time-cut":(String(prev.planSet||"")!==String(sh.planSet||"")?"set":""));
      let start, differs=[];
      if(!world||cut==="set") start=planned;                           // the first shot, or another place: the plan's own start
      else if(cut==="time-cut") start=layer(world,planned,[]);        // time passed: the plan's start is the new truth for whom it names
      else{
        differs=Object.keys(planned.people).filter(id=>world.people[id]&&!samePlace(world.people[id],planned.people[id]));
        start=layer(world,planned,Object.keys(world.people).concat(Object.keys(world.things).map(k=>"thing:"+k),world.doors.map(d=>"door:"+d.id)));
      }
      const end=layer(start,last,[]);
      out.push({id:sh.id,start,end,joins:!!world&&!cut,cut,differs});
      world=end; prev=sh;
    });
    return out;
  }
  /* THE MIDDLE OF A SHOT, when someone crosses the room in it (more than about a metre between two marks): everything
     as the shot ends, with whoever walks drawn halfway. null when nobody does: start and end say it all. */
  function midState(start,end,plan){
    const a=stateCopy(start), b=stateCopy(end); let moved=false;
    Object.keys(b.people).forEach(id=>{ const from=a.people[id]&&markXY(plan,a.people[id].where), to=markXY(plan,b.people[id].where);
      if(!from||!to||Math.hypot(to[0]-from[0],to[1]-from[1])<1.2) return;
      moved=true; b.people[id]={...b.people[id],xy:[(from[0]+to[0])/2,(from[1]+to[1])/2],pose:"walking",holding:arr(a.people[id].holding).slice()}; });
    if(!moved) return null;
    // what a walker still carries has not been put down yet
    Object.keys(b.people).forEach(id=>arr(b.people[id].holding).forEach(k=>{ b.things[k]={heldBy:id}; }));
    return b;
  }
  /* THE BEAT DRAWN: each of its shots through its own camera, as that one room goes on. o: {list (the film's
     locations), locationOf(shot) → its place, cameraOf(shot) → the plan's camera, cast, props, width, states}.
     → [{id, start:{dataUrl}, mid:{dataUrl}|null, end:{dataUrl}|null, pose, source, fits, notes[], missing[], rough[],
         joins, cut, differs:[names], people, error (a shot that could not be drawn says why; the others still are)}] */
  async function beat(plan,shots,o){
    o=o||{};
    // (o.states: the room as each shot starts and ends, by shot id, when the WHOLE SCENE was staged once; else this beat alone)
    const own=o.states?null:beatStates(shots), states=arr(shots).map((sh,i)=>own?own[i]:(obj(o.states)[sh.id]||beatStates([sh])[0])), out=[];
    for(let i=0;i<arr(shots).length;i++){
      const sh=shots[i], st=states[i], row={id:sh.id,joins:st.joins,cut:st.cut,differs:[],notes:[],missing:[],rough:[]};
      try{
        const loc=typeof o.locationOf==="function"?o.locationOf(sh):null;
        if(!loc) throw new Error("This shot has no location card yet.");
        const mid=midState(st.start,st.end,plan);
        const got=await pair(loc,o.list||[],plan,sh,{cam:typeof o.cameraOf==="function"?o.cameraOf(sh):null,cast:o.cast,props:o.props,width:o.width||640,
          startState:st.start,endState:st.end,midState:mid,look:o.look,steps:typeof o.stepsOf==="function"?o.stepsOf(sh,st):null});
        Object.assign(row,got);
        row.differs=st.differs.map(id=>((arr(o.cast).find(c=>c&&String(c.id)===String(id))||{}).name)||id);
      }catch(e){ row.error=String((e&&e.message)||"This shot could not be drawn."); }
      out.push(row);
    }
    return out;
  }
  // one drawn frame of a planned shot; o.which = "start" | "end" (the end is the start when nothing moved)
  async function frame(location,list,plan,shot,o){
    o=o||{};
    const got=await pair(location,list,plan,shot,o), pick=(o.which==="end"&&got.end)||got.start;
    return {...got,dataUrl:pick?pick.dataUrl:"",people:(o.which==="end"&&got.end&&got.end.people)||got.people,things:(o.which==="end"&&got.end&&got.end.things)||got.things};
  }

  root.ShotPrevis={DEFAULT_HEIGHT,DEFAULT_SIZE,FRAME,PALETTE,paletteFor,heightOf,colourOf,figure,turnTo,sizeFromText,sizeOf,inside,edgeDistance,spacesOf,spaceAt,markXY,fixedTop,fixedCentre,
    faceTarget,openingId,doorLine,poseDoors,hangOn,restsOn,dressingWords,stateScene,hides,solidAt,camera,aimOf,planCamera,handCamera,inFrame,cameraKey,legend,seenIn,frameWords,project,measure,frameMap,beatStates,midState,beat,aim,vfovOf,lensFor,sight,pair,frame};
})(typeof window!=="undefined"?window:globalThis);
