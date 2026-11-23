/* shot-previs.js — A SHOT DRAWN IN CODE FROM THE 3D SET (owner 2026-11-22, after the first real frames of Scene 5:
   "the setting is not consistent from shot to shot … we need to start with code … pull out the actual 3D set … lock
   in the cameras considering the composition for the shot … then … bring image model to support with rendering").

   The image engine alone drew a different hall in every frame (a second door, props of another size). Here nothing
   is guessed: the place is the location's own 3D set (set-previs.js: one model for every shot), each person is a
   stand-in of their own height on the mark the scene plan put them on, each thing is a box of its own size where
   the plan says it is, and the camera is a real one that has to fit inside the room and see the people it frames.
   The same camera draws how the shot STARTS and how it ENDS, so the two differ only by what moved.

     heightOf(character)                     their height in metres (the card's own words, e.g. "168 cm tall")
     sizeOf(prop | thing)                    [w, d, h] in metres: its measured size, or read from its size text
     poseDoors(set, doors, ctx)              each door of a state swung open or left shut (the leaf the set already has)
     stateScene(set, plan, state, ctx)       the set with the doors, the people and the things of one state put in
     planCamera(cam, shot, placed, …)        the camera the scene plan gave in numbers, CHECKED: it must stand in the
                                             room, outside every wall and piece of furniture, and see the people it
                                             frames; else it is moved to the nearest spot that does, and the lens is
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
     block figure is Pike"). Never red or orange: those are the props' boxes. By the person's place among everyone
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
  // a person as blocks of their own height: legs, torso, head, and a pale face on the side they look to (a pose word
  // lowers them: sitting, kneeling, lying). turn = radians about +Z; 0 looks north (+Y).
  const turnTo=(from,to)=>{ const dx=to[0]-from[0], dy=to[1]-from[1]; return Math.hypot(dx,dy)<0.02 ? null : Math.atan2(-dx,dy); };
  const frontOf=turn=>[-Math.sin(turn||0),Math.cos(turn||0)];
  function figure(id,name,xy,floorZ,height,pose,turn,rgb){
    const p=String(pose||"").toLowerCase();
    const k=/\b(lying|on the floor|prone)\b/.test(p)?0.22:/\b(kneel|crouch|squat)/.test(p)?0.62:/\b(sit|sits|sitting|sat|seated)\b/.test(p)?0.74:1;
    const h=height*k, mat="standin-"+id, z=floorZ||0, x=xy[0], y=xy[1], label=String(name||id)+" (stand-in)";
    const rz=Number.isFinite(turn)?turn:0, f=frontOf(rz), rot=[0,0,rz];
    return {height:h,turn:rz,front:f,head:[x,y,z+h-0.115],chest:[x,y,z+h*0.72],
      objects:[
        {id:"fig-"+id+"-legs",name:label,kind:"cylinder",position:[x,y,z+h*0.24],rotation:rot,size:[0.30,0.22,h*0.48],material:mat},
        {id:"fig-"+id+"-torso",name:label,kind:"box",position:[x,y,z+h*0.66],rotation:rot,size:[0.44,0.24,h*0.36],material:mat},
        {id:"fig-"+id+"-head",name:label,kind:"cylinder",position:[x,y,z+h-0.115],rotation:rot,size:[0.19,0.21,0.23],material:mat},
        {id:"fig-"+id+"-face",name:label,kind:"box",position:[x+f[0]*0.095,y+f[1]*0.095,z+h-0.12],rotation:rot,size:[0.13,0.04,0.15],material:"standin-face"}],
      material:[mat,{baseColor:arr(rgb).length===3?rgb:colourOf(id),metallic:0,roughness:0.9,emissionStrength:0}]};
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
  function poseDoors(scene,doors,ctx){
    ctx=ctx||{};
    const done=[];
    arr(doors).forEach(d=>{
      if(!d||typeof d.open!=="boolean") return;
      const id=openingId(scene,d.id,ctx.plan); if(!id||done.indexOf(id)>=0) return;
      const J=jambs(scene,id); let a=J[0],b=J[1],far=0;
      J.forEach(p=>J.forEach(q=>{ const L=Math.hypot(p.position[0]-q.position[0],p.position[1]-q.position[1]); if(L>far){ far=L; a=p; b=q; } }));
      if(far<0.5||far>1.7) return;                                   // a door, not a shop front
      const c=[(a.position[0]+b.position[0])/2,(a.position[1]+b.position[1])/2], u=[(b.position[0]-a.position[0])/far,(b.position[1]-a.position[1])/far], n=[-u[1],u[0]];
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
      const meets=h=>{ const H=[lc[0]+u[0]*h*L/2,lc[1]+u[1]*h*L/2], mid=[H[0]+into[0]*L/2,H[1]+into[1]*L/2];
        return scene.objects.filter(o=>o&&o.size&&o.position&&group.indexOf(o)<0&&!isFrame(o)&&Math.max(o.size[0],o.size[1])<=2.5
          &&o.position[2]+o.size[2]/2>floor+0.1&&o.position[2]-o.size[2]/2<floor+2
          &&Math.hypot(o.position[0]-mid[0],o.position[1]-mid[1])<L/2+Math.max(o.size[0],o.size[1])*0.3).length; };
      const h=meets(-1)<=meets(1)?-1:1, H=[lc[0]+u[0]*h*L/2,lc[1]+u[1]*h*L/2];
      const from=[-u[0]*h,-u[1]*h], th=Math.atan2(from[0]*into[1]-from[1]*into[0],from[0]*into[0]+from[1]*into[1]), cs=Math.cos(th), sn=Math.sin(th);
      group.forEach(o=>{ const rx=o.position[0]-H[0], ry=o.position[1]-H[1], r=o.rotation||[0,0,0];
        o.position=[H[0]+rx*cs-ry*sn,H[1]+rx*sn+ry*cs,o.position[2]]; o.rotation=[r[0]||0,r[1]||0,(r[2]||0)+th]; });
    });
    return scene;
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
    scene.materials["standin-face"]={baseColor:[0.86,0.8,0.72],metallic:0,roughness:0.9,emissionStrength:0};
    const castOf=id=>arr(ctx.cast).find(c=>c&&String(c.id)===String(id))||{id};
    const spaces=arr(ctx.spaces);
    const here=[];
    Object.keys(obj(st.people)).forEach(id=>{
      const p=obj(st.people[id]), xy=markXY(plan,p.where), c=castOf(id);
      if(!xy){ missing.push((c.name||id)+" has no place on the floor plan"+(p.where?" ("+p.where+")":"")); return; }
      here.push({id,name:c.name||id,xy,pose:p.pose,card:c,holding:arr(p.holding).slice()});
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
      const turn=to?turnTo(me.xy,to):null;
      const col=colours[me.id]||null;
      const sp=spaceAt(spaces,me.xy[0],me.xy[1]), fig=figure(me.id,me.name,me.xy,sp?sp.floorZ:0,heightOf(me.card),me.pose,turn==null?0:turn,col&&col.rgb);
      fig.objects.forEach(o=>scene.objects.push(o)); scene.materials[fig.material[0]]=fig.material[1];
      people.push({id:me.id,name:me.name,xy:me.xy,head:fig.head,chest:fig.chest,height:fig.height,turn:fig.turn,front:fig.front,holding:me.holding,
        pose:String(me.pose||""),colour:col?col.name:""});
    });
    const thingOf=key=>arr(obj(plan).things).find(t=>t&&String(t.key)===String(key))||{key};
    const propOf=t=>arr(ctx.props).find(c=>c&&((t.propId&&String(c.id)===String(t.propId))||String(c.name||"").toLowerCase()===String(t.name||"").toLowerCase()))||null;
    const put=(key,centre,held,turn,on)=>{ const t=thingOf(key); if(t.kind&&t.kind!=="prop") return; if(things.some(x=>x.key===key)) return;
      const card=propOf(t), known=sizeOf(card)||sizeOf(t), size=(typeof ctx.sizeFor==="function"&&ctx.sizeFor(key,t,card))||known||DEFAULT_SIZE.slice();
      scene.objects.push({id:"prop-"+key,name:(t.name||String(key).replace(/-/g," "))+" (prop stand-in)",kind:"box",position:[centre[0],centre[1],centre[2]+size[2]/2],rotation:[0,0,turn||0],size,material:"prop-standin"});
      things.push({key,name:t.name||String(key).replace(/-/g," "),at:[centre[0],centre[1],centre[2]],size,held:held||"",on:on||"",measured:!!known}); };
    // what a person holds sits at their hands, in front of them; two things sit side by side
    const hands=(p,i,n)=>{ const r=[p.front[1],-p.front[0]], s=n>1?(i?0.09:-0.09):0; return [p.xy[0]+p.front[0]*0.22+r[0]*s,p.xy[1]+p.front[1]*0.22+r[1]*s,p.chest[2]-p.height*0.16]; };
    people.forEach(p=>p.holding.forEach((key,i)=>put(key,hands(p,i,p.holding.length),p.id,p.turn)));
    Object.keys(obj(st.things)).forEach(key=>{
      const v=st.things[key]; if(!v||typeof v!=="object") return;
      if(v.heldBy){ const p=people.find(x=>x.id===v.heldBy); if(p) put(key,hands(p,0,1),p.id,p.turn); return; }
      if(v.worn){ const p=people.find(x=>x.id===v.worn); if(p) worn.push({key,by:p.id,name:thingOf(key).name||String(key).replace(/-/g," ")}); return; }
      if(v.in) return;
      if(v.at){ const xy=markXY(plan,v.at); if(xy){ const sp=spaceAt(spaces,xy[0],xy[1]); put(key,[xy[0],xy[1],sp?sp.floorZ:0]); return; }
        const top=fixedTop(set,v.at); if(top){ const fx=arr(obj(plan).fixed).find(f=>f&&String(f.id)===String(v.at)); put(key,top,"",0,(fx&&fx.name)||""); return; }
        const t=thingOf(key); if(!t.kind||t.kind==="prop") missing.push((t.name||key)+" is somewhere the floor plan does not hold"); }
    });
    return {scene,base,people,things,worn,missing};
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
      :who.filter(p=>(typeof opts.clear!=="function"||opts.clear(from,p.head))&&!everyone.some(q=>q.id!==p.id&&hides(from,p.head,q))).length;
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
     person in the way). When it does not, it goes to the nearest spot that does (rings of 15 cm, the one that keeps
     the planned direction best), and the note says why and how far. The lens is then checked against the shot size:
     when it would show much more or much less than planned from there, it is set to the lens that shows it.
     Returns {pose, lensPlanned, distance, notes[], fits, source:"plan"|"moved"|"app"} or null when cam has no numbers. */
  const WHY={outside:"The planned camera stood off the floor plan.",solid:"The planned camera stood inside a wall or a piece of furniture.",
    person:"The planned camera stood where a person stands.",hidden:"From the planned camera something in the set hid who the shot is of.",
    behind:"From the planned camera one person hid another."};
  function planCamera(cam,shot,placed,set,plan,spaces,opts){
    opts=opts||{};
    const c=obj(cam), at=arr(c.at).map(Number);
    if(at.length!==2||!at.every(Number.isFinite)) return null;
    const sh=obj(shot), a=aimOf(c,sh,placed,set,plan); if(!a) return null;
    const notes=[], angle=String(sh.angle||"eye").toLowerCase();
    const lensPlanned=clampLens(c.lens||String(sh.lens||"").replace(/[^\d.]/g,""));
    const h=Math.max(0.12,Math.min(3.2,Number(c.height)>0?Number(c.height):(EYE[angle]||EYE.eye)));
    const look=a.who.length?a.who.map(p=>p.head):[a.target], P=arr(placed.people);
    // over the shoulder: the person the camera stands behind is in the frame on purpose, and never counts as in the way
    const ots=angle==="ots", own=angle==="pov";
    const nearest=(x,y)=>{ let b=null,bd=1.3; if(ots) P.forEach(q=>{ const d=Math.hypot(q.xy[0]-x,q.xy[1]-y); if(d<bd){ bd=d; b=q; } }); return b; };
    const why=(x,y)=>{ const sp=spaceAt(spaces,x,y); if(!sp) return "outside";
      const p=[x,y,sp.floorZ+h], over=nearest(x,y);
      if(edgeDistance(sp.footprint,x,y)<0.1||solidAt(set,p)) return "solid";
      if(!own&&P.some(q=>Math.hypot(q.xy[0]-x,q.xy[1]-y)<(ots?0.22:0.3))) return "person";
      if(typeof opts.clear==="function"&&!look.every((pt,i)=>(over&&a.who[i]===over)||opts.clear(p,pt))) return "hidden";
      if(a.who.some(w=>w!==over&&P.some(q=>q.id!==w.id&&q!==over&&hides(p,w.head,q)))) return "behind";
      return ""; };
    let x=at[0], y=at[1], source="plan";
    const bad=why(x,y);
    if(bad){
      const d0=[a.target[0]-x,a.target[1]-y], l0=Math.hypot(d0[0],d0[1])||1; let best=null;
      for(let r=0.15;r<=2.01&&!best;r+=0.15){
        for(let i=0;i<16;i++){ const an=i/16*Math.PI*2, nx=x+Math.sin(an)*r, ny=y+Math.cos(an)*r; if(why(nx,ny)) continue;
          const d=[a.target[0]-nx,a.target[1]-ny], l=Math.hypot(d[0],d[1])||1, score=(d[0]*d0[0]+d[1]*d0[1])/(l*l0);
          if(!best||score>best.score) best={x:nx,y:ny,score,r}; }
      }
      if(!best&&(bad==="hidden"||bad==="behind")){
        // it can stand there, and nowhere near sees more (a person behind a shut door as the shot starts): it stays
        notes.push(bad==="hidden"?"As this shot starts, something in the set hides someone it frames (a wall or a shut door), from the planned camera and from every spot near it."
          :"As this shot starts, one person hides another from the planned camera and from every spot near it.");
      }else if(!best){
        const found=camera(sh,a.who,spaces,{clear:opts.clear,set,all:P,point:a.who.length?null:a.target,side:opts.side});
        return {...found,source:"app",notes:[WHY[bad]+" No spot near it works, so the app placed the camera."].concat(found.notes||[])};
      }else{
        notes.push(WHY[bad]+" It was moved "+best.r.toFixed(2).replace(/0$/,"")+" m, to the nearest spot that works.");
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
      if(l>0.01&&l<0.5&&(d[0]*v[0]+d[1]*v[1])/(l*vl)>0.7&&!own) notes.push((q.name||"Someone")+" stands "+l.toFixed(1)+" m in front of the camera and fills much of the frame."); });
    return {pose:aim(from,a.target,lens),lensPlanned,distance:Math.round(dist*100)/100,side:opts.side||1,notes,fits:true,source};
  }
  /* WHAT EACH STAND-IN IS, in plain sentences (for the image engine that renders over the previs, and for the check
     that compares the frame with it): who each coloured block figure is, and what each red box is and where. */
  function legend(people,things){
    const P=arr(people), lines=[];
    P.forEach(p=>lines.push("The "+(p.colour||"coloured")+" block figure is "+p.name+(p.pose?" ("+p.pose+")":"")+"."));
    arr(things).forEach(t=>{ const h=t.held&&P.find(p=>p.id===t.held);
      lines.push("The red box "+(h?"in "+h.name+"\u2019s hands":t.on?"on the "+String(t.on).replace(/^the /i,"").replace(/^./,c=>c.toLowerCase()):"standing on its own")
        +" is the "+String(t.name).replace(/^the /i,"")+"."); });
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
  const sameState=(a,b)=>JSON.stringify(a||null)===JSON.stringify(b||null);
  /* A PLANNED SHOT, DRAWN: how it starts and how it ends, from ONE camera. o: {cam (the plan's camera for this shot,
     in numbers), cast, props, width, side}. The camera is worked out from how the shot STARTS and kept for how it
     ends, so the two pictures differ only by what moved. Returns {start:{dataUrl}, end:{dataUrl}|null (null when the
     shot ends as it starts), width, height, pose, source ("plan" | "moved" | "app"), fits, notes[], missing[],
     rough[] (things drawn at a guessed size), lensPlanned, distance, people, things}. Throws the set builder's own
     sentence when the place has no floor plan or the 3D view cannot start. */
  async function pair(location,list,plan,shot,o){
    o=o||{};
    const P=root.KinolotPrevis; if(!P) throw new Error("The 3D view did not load. Refresh this page.");
    if(typeof root.locationSpatialContract!=="function") throw new Error("The floor plan reader did not load. Refresh this page.");
    const built=P.scene(location,list), spaces=spacesOf(root.locationSpatialContract(location));
    const sh=obj(shot), startState=sh.startState||sh.endState||{}, endState=sh.endState||null;
    const cam=o.cam&&typeof o.cam==="object"?o.cam:null;
    const ctx={cast:o.cast,props:o.props,spaces,plan,beat:Number(sh.beatN!=null?sh.beatN:sh.beat)||0,faces:cam&&cam.faces,lookAt:cam&&arr(cam.at).length===2?cam.at:null};
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
    const out={start:null,end:null,width:0,height:0,pose:found.pose||null,source:found.source||"app",fits:!!found.fits,notes:arr(found.notes).slice(),
      missing:first.missing.slice(),rough,lensPlanned:found.lensPlanned,distance:found.distance,side:found.side,people:first.people,things:first.things};
    if(!found.pose) return out;
    const width=Math.max(320,Math.min(1920,Math.round(o.width||1280))), height=Math.round(width*9/16);
    out.width=width; out.height=height;
    const draw=async(scene)=>{ const view=await P.viewer(scene,built.light), canvas=root.document.createElement("canvas");
      try{ view.render(canvas,found.pose,width,height); }finally{ view.dispose(); }
      return canvas.toDataURL("image/jpeg",0.9); };
    out.start={dataUrl:await draw(first.scene)};
    if(endState&&!sameState(startState,endState)){
      const last=stateScene(built.scene,plan,endState,ctx);
      out.end={dataUrl:await draw(last.scene),people:last.people,things:last.things};
      last.missing.forEach(m=>{ if(out.missing.indexOf(m)<0) out.missing.push(m); });
      last.things.filter(t=>!t.measured).forEach(t=>{ if(out.rough.indexOf(t.name)<0) out.rough.push(t.name); });
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
    faceTarget,openingId,poseDoors,stateScene,hides,solidAt,camera,aimOf,planCamera,cameraKey,legend,aim,vfovOf,lensFor,sight,pair,frame};
})(typeof window!=="undefined"?window:globalThis);
