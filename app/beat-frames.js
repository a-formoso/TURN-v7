/* beat-frames.js — A BEAT, BROKEN DOWN IN CODE (owner 2026-11-26, with their pack "Scene 06, beat 1, built in code":
   "let's use this structure to breakdown each beat in a scene using code, treating each moment as a shot. let's use
   the first frame of each moment as our shot keyframe or starting frame").

   The levels are: scene, beat, moment, frame. ONE room, ONE state that goes on: `start` is the state the scene opens
   in, and each frame says only what CHANGED since the frame before it (`set`), which camera looks at it (`cam`), how
   long it takes to get there (`into`) and how long it rests (`hold`). A frame's id is beat.moment.frame (1.3.2).
   A MOMENT IS A SHOT: its first frame is the shot's starting frame (its keyframe), its last frame is how it ends, and
   the frames between are the steps of the action inside the shot.

   This file is the part with nothing drawn in it (pure, plain JS; scripts/test-beat-frames.mjs runs it):
     fromPack(SCENE)   the pack's own file (x east, z south, y up, radians) in the app's terms: metres on the floor
                       plan (x east, y north, z up), degrees clockwise from north, a camera as position / yaw / pitch /
                       lens, as every camera of the app is
     normalize(raw)    a breakdown made safe: ids renumbered beat.moment.frame, unknown cameras, poses and places
                       dropped (and said in `report`), times kept between 0 and 30 s
     frames(b)         every frame in order, each with its beat and its moment
     states(b)         the whole state at each frame (the changes applied one after another)
     timeline(b)       when each frame starts, arrives and ends; how long each moment and each beat lasts
     at(b, t)          the state at any instant: every picture in between, worked out from the frames
     shots(b)          each moment as a shot: its starting frame, its length, its cameras and cuts, what moves in
                       it, and whether its blockout (the frames played in clay) is worth giving to the video engine
   Poses are ten numbers, always in this order: lean, twist, head down, head turn, right arm forward, right arm out,
   right elbow, left arm forward, left arm out, left elbow (radians). */
(function(root){
  "use strict";
  const arr=v=>Array.isArray(v)?v:[], obj=v=>(v&&typeof v==="object"&&!Array.isArray(v))?v:{};
  const num=(v,d)=>{ const n=Number(v); return Number.isFinite(n)?n:d; };
  const r1=v=>Math.round(v*10)/10, r2=v=>Math.round(v*100)/100, r3=v=>Math.round(v*1000)/1000;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), text=(v,max)=>String(v==null?"":v).replace(/\s+/g," ").trim().slice(0,max||400);
  const DEG=180/Math.PI, POSE_N=10, MAX_SECONDS=30;
  /* THE VIDEO ENGINE'S OWN LIMITS (Seedance 2.5, as the Stage and the server hold them: stage.jsx, image-proxy
     seedance-capabilities.mjs): a clip is 4 to 30 seconds, and the reference videos of one clip may add up to 30.2. */
  const CLIP={min:4,max:30,referenceMax:30.2};
  // a lens (36 mm wide sensor, 16:9 picture) from an up-and-down field of view in degrees, and back
  const lensOf=fov=>r1(10.125/Math.tan(clamp(num(fov,40),4,120)/2/DEG));
  const turn=d=>((d+540)%360)-180, yawOf=d=>((d%360)+360)%360;
  // an angle on the compass, to a tenth of a degree (359.98 is north: 0, never 360)
  const deg=v=>{ const d=r1(yawOf(v)); return d>=360?0:d; };

  /* THE PACK'S FILE IN THE APP'S TERMS. The pack: x west to east, z north to south, y up; a figure's `at` is [x, z],
     its `face` an angle in radians (0 = south, pi = north); a camera is pos / look / fov. A place's offset, rot and
     scale are in the figure's or the prop's own frame and are kept as written. */
  function fromPack(scene){
    const s=obj(scene), xy=p=>[r3(num(arr(p)[0],0)),r3(-num(arr(p)[1],0))], xyz=p=>[r3(num(arr(p)[0],0)),r3(-num(arr(p)[2],0)),r3(num(arr(p)[1],0))];
    const face=f=>deg(180-num(f,0)*DEG);
    const person=p=>{ const o=obj(p), out={}; if(o.at) out.at=xy(o.at); if(o.face!=null) out.face=face(o.face); if(o.pose!=null) out.pose=String(o.pose); if(o.stride!=null) out.stride=num(o.stride,0); return out; };
    const place=p=>{ if(p==null) return null; const o={...obj(p)}; if(o.at) o.at=xyz(o.at); if(o.minY!=null){ o.minZ=num(o.minY,0); delete o.minY; } return o; };
    const cast={}, ids=Object.keys(obj(s.cast)); ids.forEach(id=>{ const c=obj(s.cast[id]); cast[id]={name:text(c.name,60)||id,height:num(c.height,1.75),...(c.colours?{colours:{...c.colours}}:{}),...(c.swing?{swing:arr(c.swing).slice(0,2)}:{}),...(c.pen?{pen:true}:{})}; });
    const cameras={}; Object.keys(obj(s.cameras)).forEach(k=>{ const c=obj(s.cameras[k]), from=xyz(c.pos), to=xyz(c.look), dx=to[0]-from[0], dy=to[1]-from[1], dz=to[2]-from[2];
      cameras[k]={position:from,yaw:deg(Math.atan2(dx,dy)*DEG),pitch:r2(Math.atan2(dz,Math.hypot(dx,dy))*DEG),lensMm:lensOf(c.fov),far:num(c.far,10),role:text(c.role,120)}; });
    const props={}; Object.keys(obj(s.props)).forEach(k=>{ const p=obj(s.props[k]), places={}; Object.keys(obj(p.places)).forEach(n=>{ places[n]=place(p.places[n]); }); props[k]={shape:text(p.shape,40)||k,places}; });
    const change=set=>{ const o=obj(set), people={}; ids.forEach(id=>{ if(o[id]) people[id]=person(o[id]); }); return {people,props:{...obj(o.props)}}; };
    const st=obj(s.start), first=change(st);
    return {v:1,id:text(s.id,60),heading:text(s.heading,160),fps:num(s.fps,12),cast,poses:JSON.parse(JSON.stringify(obj(s.poses))),idle:JSON.parse(JSON.stringify(obj(s.idle))),cameras,props,
      start:{people:first.people,props:first.props},
      beats:arr(s.beats).map(b=>({n:num(obj(b).n,0),name:text(obj(b).name,80),moments:arr(obj(b).moments).map(m=>({n:num(obj(m).n,0),name:text(obj(m).name,80),
        frames:arr(obj(m).frames).map(f=>{ const o=obj(f); return {id:String(o.id||""),cam:String(o.cam||""),into:num(o.into,0),hold:num(o.hold,0),says:text(o.says,400),...(o.glide?{glide:true}:{}),set:change(o.set)}; })}))}))};
  }

  /* A BREAKDOWN MADE SAFE (an engine wrote it): the frames are numbered again in order; a camera, a pose, a person or
     a place the breakdown does not define is dropped and said in report.dropped; a frame with no camera keeps the one
     before it; times are kept between 0 and 30 seconds. */
  function normalize(raw){
    const b=obj(raw), report={dropped:[],frames:0,moments:0};
    const cast=obj(b.cast), ids=Object.keys(cast), cameras=obj(b.cameras), props=obj(b.props), poses=obj(b.poses);
    const drop=(why)=>{ if(report.dropped.length<40) report.dropped.push(why); };
    const person=(id,p,where)=>{ const o=obj(p), out={};
      if(Array.isArray(o.at)&&o.at.length>=2&&Number.isFinite(Number(o.at[0]))&&Number.isFinite(Number(o.at[1]))) out.at=[r3(Number(o.at[0])),r3(Number(o.at[1]))];
      if(o.face!=null&&Number.isFinite(Number(o.face))) out.face=deg(Number(o.face));
      if(o.pose!=null){ if(arr(obj(poses[id])[o.pose]).length===POSE_N) out.pose=String(o.pose); else drop(where+": "+id+" has no pose called "+o.pose); }
      if(o.stride!=null&&Number.isFinite(Number(o.stride))) out.stride=clamp(Number(o.stride),0,1);
      return out; };
    const change=(set,where)=>{ const o=obj(set), people={}, things={};
      Object.keys(obj(o.people)).forEach(id=>{ if(ids.indexOf(id)<0){ drop(where+": nobody is called "+id); return; } const p=person(id,o.people[id],where); if(Object.keys(p).length) people[id]=p; });
      Object.keys(obj(o.props)).forEach(k=>{ const p=props[k], name=o.props[k]; if(!p||!Object.prototype.hasOwnProperty.call(obj(p.places),name)){ drop(where+": "+k+" has no place called "+name); return; } things[k]=String(name); });
      return {people,props:things}; };
    const start=change(b.start,"The opening state");
    let last="";
    const beats=arr(b.beats).map((bt,bi)=>({n:bi+1,name:text(obj(bt).name,80),moments:arr(obj(bt).moments).filter(m=>arr(obj(m).frames).length).map((m,mi)=>{ report.moments++;
      return {n:mi+1,name:text(obj(m).name,80),frames:arr(obj(m).frames).map((f,fi)=>{ const o=obj(f), id=(bi+1)+"."+(mi+1)+"."+(fi+1); report.frames++;
        let cam=String(o.cam||""); if(!cameras[cam]){ if(cam) drop(id+": there is no camera called "+cam); cam=last||Object.keys(cameras)[0]||""; } last=cam;
        return {id,cam,into:r2(clamp(num(o.into,0),0,MAX_SECONDS)),hold:r2(clamp(num(o.hold,0),0,MAX_SECONDS)),says:text(o.says,400),...(o.glide?{glide:true}:{}),set:change(o.set,id)}; })}; })})).filter(bt=>bt.moments.length);
    return {breakdown:{v:1,id:text(b.id,60),heading:text(b.heading,160),fps:clamp(Math.round(num(b.fps,12)),6,30),cast,poses,idle:obj(b.idle),cameras,props,start,beats},report};
  }

  function frames(b){
    const out=[]; arr(obj(b).beats).forEach(bt=>arr(bt.moments).forEach(m=>arr(m.frames).forEach((f,i)=>out.push({...f,beat:bt.n,moment:m.n,momentName:m.name,beatName:bt.name,first:i===0,last:i===arr(m.frames).length-1}))));
    return out;
  }
  const copy=v=>JSON.parse(JSON.stringify(v));
  const apply=(state,set)=>{ const next=copy(state), s=obj(set);
    Object.keys(obj(s.people)).forEach(id=>{ next.people[id]={...(next.people[id]||{}),...copy(s.people[id])}; });
    Object.keys(obj(s.props)).forEach(k=>{ next.props[k]=s.props[k]; });
    return next; };
  // the whole state at each frame: [{id, beat, moment, cam, people:{id:{at, face, pose, stride}}, props:{id:place}}]
  function states(b){
    let state={people:copy(obj(obj(obj(b).start).people)),props:copy(obj(obj(obj(b).start).props))};
    return frames(b).map(f=>{ state=apply(state,f.set); return {id:f.id,beat:f.beat,moment:f.moment,cam:f.cam,people:copy(state.people),props:copy(state.props)}; });
  }
  /* WHEN: a frame starts moving at t0, is reached at t1 (t0 + into) and rests until t2 (t1 + hold); the next frame
     starts at this one's t2. → {frames:[{id, beat, moment, t0, t1, t2}], moments:[{beat, n, name, from, to,
     seconds}], beats:[{n, name, from, to, seconds}], seconds} */
  function timeline(b){
    let t=0; const fr=frames(b).map(f=>{ const t0=t, t1=t0+f.into, t2=t1+f.hold; t=t2; return {id:f.id,beat:f.beat,moment:f.moment,t0:r2(t0),t1:r2(t1),t2:r2(t2)}; });
    const span=list=>({from:list.length?list[0].t0:0,to:list.length?list[list.length-1].t2:0});
    const moments=[], beats=[];
    arr(obj(b).beats).forEach(bt=>{ const mine=fr.filter(f=>f.beat===bt.n), s=span(mine); beats.push({n:bt.n,name:bt.name,from:s.from,to:s.to,seconds:r2(s.to-s.from)});
      arr(bt.moments).forEach(m=>{ const own=mine.filter(f=>f.moment===m.n), q=span(own); moments.push({beat:bt.n,n:m.n,name:m.name,from:q.from,to:q.to,seconds:r2(q.to-q.from)}); }); });
    return {frames:fr,moments,beats,seconds:r2(t)};
  }
  /* THE STATE AT ANY INSTANT (every picture in between). Between two frames a person's place, the way they face and
     each of the ten numbers of their pose move smoothly from one to the other; a camera cuts, unless the frame says
     `glide` (then it travels). A prop is given as {from, to, k}: where it was, where it goes, and how far along
     (the drawing decides how a thing travels from a counter to a hand). → {id, cam | {from, to, k}, k, people, props} */
  function at(b,t){
    const tl=timeline(b), st=states(b), fr=frames(b); if(!fr.length) return null;
    const time=clamp(num(t,0),0,tl.seconds);
    let i=tl.frames.findIndex(f=>time<f.t2); if(i<0) i=fr.length-1;
    const T=tl.frames[i], now=st[i], f=fr[i];
    const before=i>0?st[i-1]:{cam:f.cam,people:copy(obj(obj(b.start).people)),props:copy(obj(obj(b.start).props))};
    const raw=f.into>0?clamp((time-T.t0)/f.into,0,1):1, k=raw*raw*(3-2*raw);
    const mix=(a,c)=>a+(c-a)*k, poseOf=(id,name)=>arr(obj(obj(b.poses)[id])[name]);
    const people={}; Object.keys(now.people).forEach(id=>{ const p1=now.people[id], p0=obj(before.people[id]);
      const a0=arr(p0.at).length===2?p0.at:p1.at, a1=p1.at, n0=poseOf(id,p0.pose), n1=poseOf(id,p1.pose);
      people[id]={...(a1?{at:[r3(mix(a0[0],a1[0])),r3(mix(a0[1],a1[1]))]}:{}),
        ...(p1.face!=null?{face:deg((p0.face==null?p1.face:p0.face)+turn(p1.face-(p0.face==null?p1.face:p0.face))*k)}:{}),
        pose:p1.pose,...(n1.length===POSE_N?{joints:n1.map((v,j)=>r3(mix(n0.length===POSE_N?n0[j]:v,v)))}:{}),
        stride:r3(mix(num(p0.stride,num(p1.stride,0)),num(p1.stride,0)))}; });
    const props={}; Object.keys(now.props).forEach(id=>{ const from=before.props[id]===undefined?now.props[id]:before.props[id]; props[id]=from===now.props[id]||k>=1?{from:now.props[id],to:now.props[id],k:1}:{from,to:now.props[id],k:r3(k)}; });
    const cam=f.glide&&before.cam&&before.cam!==f.cam&&k<1?{from:before.cam,to:f.cam,k:r3(k)}:f.cam;
    return {id:f.id,beat:f.beat,moment:f.moment,cam,k:r3(k),people,props};
  }
  /* EACH MOMENT AS A SHOT. Its starting frame is the moment's first frame (the shot's keyframe); its ending frame the
     last. → [{key "beat.moment", beat, moment, name, start, end, frames:[ids], from, to, seconds, clipSeconds, long,
     cameras:[names in order], cuts, walk (the furthest anyone goes, in metres), handled:[props that change place],
     glides, lines:[what each frame says], blockout:{send, why}}]
     THE BLOCKOUT (the shot's frames played in clay) IS WORTH GIVING TO THE VIDEO ENGINE WHEN SOMETHING TRAVELS: someone
     walks, a thing changes place, the camera moves or cuts inside the shot. A shot in which people only change their
     pose where they stand (a line, a nod) starts from its frame and is told in words: the blockout would add cost
     (its seconds are charged with the clip's) and nothing the starting frame does not already say. */
  function shots(b){
    const tl=timeline(b), st=states(b), fr=frames(b), out=[];
    tl.moments.forEach(m=>{ const idx=fr.map((f,i)=>f.beat===m.beat&&f.moment===m.n?i:-1).filter(i=>i>=0); if(!idx.length) return;
      const cameras=[]; let cuts=0, glides=0;
      idx.forEach((i,k)=>{ const f=fr[i]; if(cameras[cameras.length-1]!==f.cam){ if(k>0){ if(f.glide) glides++; else cuts++; } cameras.push(f.cam); } });
      const before=idx[0]>0?st[idx[0]-1]:{people:obj(obj(b.start).people),props:obj(obj(b.start).props)};
      let walk=0; const handled=[];
      Object.keys(st[idx[0]].people).forEach(id=>{ let d=0, p=arr(obj(before.people[id]).at); idx.forEach(i=>{ const q=arr(obj(st[i].people[id]).at); if(p.length===2&&q.length===2) d+=Math.hypot(q[0]-p[0],q[1]-p[1]); if(q.length===2) p=q; }); walk=Math.max(walk,d); });
      Object.keys(st[idx[0]].props).forEach(id=>{ let p=before.props[id]; if(idx.some(i=>{ const q=st[i].props[id], moved=p!==undefined&&q!==p; p=q; return moved; })) handled.push(id); });
      const why=[]; if(walk>=0.5) why.push("someone walks "+r1(walk)+" m"); if(handled.length) why.push(handled.length===1?"one thing changes place":handled.length+" things change place");
      if(glides) why.push("the camera moves"); if(cuts) why.push(cuts===1?"the camera cuts once":"the camera cuts "+cuts+" times");
      out.push({key:m.beat+"."+m.n,beat:m.beat,moment:m.n,name:m.name,start:fr[idx[0]].id,end:fr[idx[idx.length-1]].id,frames:idx.map(i=>fr[i].id),from:m.from,to:m.to,seconds:m.seconds,
        clipSeconds:r1(clamp(Math.ceil(m.seconds*10)/10,CLIP.min,CLIP.max)),long:m.seconds>CLIP.max,cameras,cuts,walk:r2(walk),handled,glides,lines:idx.map(i=>fr[i].says).filter(Boolean),
        blockout:{send:why.length>0&&m.seconds<=CLIP.referenceMax,why:why.length?(m.seconds>CLIP.referenceMax?"It is longer than the "+CLIP.referenceMax+" seconds of reference video a clip may carry.":"In this shot "+why.join(", ")+"."):"Nobody leaves their place and nothing changes hands: the starting frame and the words are enough."}}); });
    return out;
  }

  /* THE FRAME BOARD OF A BEAT, FROM WHAT ITS PLAN ALREADY HOLDS (stage 1, owner 2026-11-26: "put your frame board on
     the beat card"). Until a beat's frames are written out one by one, each of its shots (a moment is a shot) is
     drawn as it STARTS, MIDWAY when someone crosses the room, and as it ENDS: those are its frames. A moment's
     seconds are shared out among them: it rests on how it starts, travels, and rests on how it ends.
     moments = [{n, name, seconds, says, cam, shotId, steps:["start","mid","end"]}] (steps = the drawings it has)
     → {frames:[{id "beat.moment.frame", step, shotId, beat, moment, momentName, cam, says, first, last, t0, t1, t2}],
        moments:[{beat, n, name, from, to, seconds}], seconds} */
  const STEP_WORD={start:"Starts",mid:"Midway",end:"Ends"};
  function board(beatN,beatName,moments){
    const bn=Math.max(1,Math.round(num(beatN,1)));
    const beat={n:bn,name:text(beatName,80),moments:arr(moments).map((m,mi)=>{ const o=obj(m), steps=arr(o.steps).filter(s=>STEP_WORD[s]), list=steps.length?steps:["start"];
      const D=clamp(num(o.seconds,4),0.5,MAX_SECONDS), k=list.length, n=Math.max(1,Math.round(num(o.n,mi+1)));
      const time=i=>k===1?[0,D]:i===0?[0,D*(k===2?0.3:0.25)]:i===k-1?[D*(k===2?0.5:0.6/(k-1)),D*(k===2?0.2:0.15)]:[D*0.6/(k-1),0];
      return {n,name:text(o.name,80),frames:list.map((s,i)=>({id:bn+"."+n+"."+(i+1),cam:text(o.cam,120),into:r2(time(i)[0]),hold:r2(time(i)[1]),says:text(o.says,400),set:{},step:s,stepWord:STEP_WORD[s],shotId:String(o.shotId||"")}))}; })};
    const b={beats:[beat]}, tl=timeline(b);
    return {frames:frames(b).map((f,i)=>({...f,...tl.frames[i]})),moments:tl.moments,seconds:tl.seconds};
  }

  root.KinolotBeatFrames={CLIP,POSE_N,STEP_WORD,lensOf,fromPack,normalize,frames,states,timeline,at,shots,board};
})(typeof window!=="undefined"?window:globalThis);
