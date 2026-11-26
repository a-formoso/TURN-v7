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
      // (a moment whose frames were written out one by one: its own frames, times and lines; o.written = [{says, into, hold}])
      const own=arr(o.written).filter(f=>f&&typeof f==="object");
      if(own.length>=2) return {n,name:text(o.name,80),frames:own.map((f,i)=>({id:bn+"."+n+"."+(i+1),cam:text(o.cam,120),into:r2(clamp(num(f.into,0),0,MAX_SECONDS)),hold:r2(clamp(num(f.hold,0),0,MAX_SECONDS)),
        says:text(f.says,400)||text(o.says,400),set:{},step:i,stepWord:i===0?"Starts":i===own.length-1?"Ends":"",shotId:String(o.shotId||""),written:true}))};
      const time=i=>k===1?[0,D]:i===0?[0,D*(k===2?0.3:0.25)]:i===k-1?[D*(k===2?0.5:0.6/(k-1)),D*(k===2?0.2:0.15)]:[D*0.6/(k-1),0];
      return {n,name:text(o.name,80),frames:list.map((s,i)=>({id:bn+"."+n+"."+(i+1),cam:text(o.cam,120),into:r2(time(i)[0]),hold:r2(time(i)[1]),says:text(o.says,400),set:{},step:s,stepWord:STEP_WORD[s],shotId:String(o.shotId||"")}))}; })};
    const b={beats:[beat]}, tl=timeline(b);
    return {frames:frames(b).map((f,i)=>({...f,...tl.frames[i]})),moments:tl.moments,seconds:tl.seconds};
  }

  /* A BEAT'S FRAMES, WRITTEN OUT BY THE WRITING ENGINE AND MADE SAFE (stage 2, owner 2026-11-26). Each shot of the
     beat (a moment is a shot) gets two to six frames. A frame is a STATE IN THE SCENE PLAN'S OWN FORM (people on a
     mark or at a place of the floor plan, what they hold, the things, the doors), so the app draws it as it draws how
     a shot starts; plus, for a person, the way they face (degrees clockwise from north) and their pose in ten numbers.
     raw = {moments:[{beat, moment, name, frames:[{says, into, hold, people:{id:{at, where, face, joints, pose,
            holding}}, things:{key:{...}}, doors:[{id, open}]}]}]}; each frame says only what CHANGED.
     ctx = {shots:[{key "beat.moment", beat, moment, seconds, start, end}], marks:{id:[x, y]}, cast:[ids],
            things:[keys], doors:[ids], inside(xy) → is this place on the floor (optional)}
     THE RULES KEPT HERE, WHATEVER WAS WRITTEN: the first frame is how the shot starts and the last how it ends
     (the plan's own states: only a pose and the way someone faces are taken from the written frame); what someone
     holds and where the things are agree; an unknown person, thing, mark or door is dropped and said; a place off
     the floor is dropped; the times are fitted to the shot's own seconds.
     → {frames:{key:{name, sig, frames:[{says, into, hold, state}]}}, report:{moments, frames, dropped:[...]}} */
  const MAX_FRAMES=6, JOINT_RANGE=[[-0.4,1.1],[-1,1],[-0.6,0.9],[-1.3,1.3],[-1.2,3.1],[-0.3,1.8],[0,2.6],[-1.2,3.1],[-0.3,1.8],[0,2.6]];
  const stateSig=(start,end)=>{ const str=JSON.stringify([obj(start).people||{},obj(start).things||{},obj(start).doors||[],obj(end).people||{},obj(end).things||{},obj(end).doors||[]]); let h=5381; for(let i=0;i<str.length;i++) h=((h<<5)+h+str.charCodeAt(i))|0; return (h>>>0).toString(36)+":"+str.length; };
  function written(raw,ctx){
    const c=obj(ctx), marks=obj(c.marks), cast=arr(c.cast).map(String), things=arr(c.things).map(String), doors=arr(c.doors).map(String), rows=arr(obj(raw).moments), out={}, report={moments:0,frames:0,dropped:[]};
    const drop=why=>{ if(report.dropped.length<40) report.dropped.push(why); };
    const base=s=>({people:copy(obj(obj(s).people)),things:copy(obj(obj(s).things)),doors:copy(arr(obj(s).doors))});
    const joints=v=>{ const a=arr(v).map(Number); return a.length===POSE_N&&a.every(Number.isFinite)?a.map((n,i)=>r2(clamp(n,JOINT_RANGE[i][0],JOINT_RANGE[i][1]))):null; };
    // what someone holds and where the things are say the same
    const tidy=st=>{ Object.keys(st.people).forEach(id=>{ const p=st.people[id]; p.holding=arr(p.holding).map(String).filter(k=>things.indexOf(k)>=0);
        p.holding.forEach(k=>{ const t={...obj(st.things[k])}; delete t.at; delete t.on; delete t.worn; t.heldBy=id; st.things[k]=t; }); });
      Object.keys(st.things).forEach(k=>{ const t=st.things[k], who=t&&t.heldBy; if(who&&(!st.people[who]||arr(st.people[who].holding).indexOf(k)<0)){ if(st.people[who]) st.people[who].holding=arr(st.people[who].holding).concat([k]); else delete t.heldBy; } });
      return st; };
    const pose=(p,cur,where)=>{ const q=obj(p); if(q.face!=null&&Number.isFinite(Number(q.face))) cur.face=deg(Number(q.face));
      if(q.joints!=null){ const j=joints(q.joints); if(j) cur.joints=j; else drop(where+": a pose is ten numbers"); }
      if(q.pose!=null&&text(q.pose,80)) cur.pose=text(q.pose,80); return cur; };
    arr(c.shots).forEach(sh=>{ const key=String(sh.key), row=rows.find(r=>r&&Number(r.beat)===Number(sh.beat)&&Number(r.moment)===Number(sh.moment)); if(!row) return;
      const list=arr(row.frames).filter(f=>f&&typeof f==="object"); if(list.length<2){ drop(key+": a shot needs at least two frames"); return; }
      if(list.length>MAX_FRAMES) drop(key+": only the first "+MAX_FRAMES+" frames are kept");
      const use=list.slice(0,MAX_FRAMES), last=use.length-1; let state=base(sh.start);
      const frames=use.map((f,i)=>{ const where=key+"."+(i+1);
        if(i===0||i===last){ // how the shot starts, how it ends: the plan's own state, with the written pose
          const st=base(i===0?sh.start:(sh.end||sh.start));
          // (how it ends: someone keeps the way they faced and the pose they had in the frame before, unless this frame gives another.
          //  The first real pass, 2026-11-26, left the last frame's facing out, and the figure turned back to the plan's own guess.)
          if(i===last) Object.keys(st.people).forEach(id=>{ const was=obj(state.people[id]); if(was.face!=null) st.people[id].face=was.face; if(arr(was.joints).length===POSE_N) st.people[id].joints=was.joints.slice(); });
          Object.keys(obj(f.people)).forEach(id=>{ if(st.people[id]) pose(f.people[id],st.people[id],where); else drop(where+": "+id+" is not in this shot as it "+(i===0?"starts":"ends")); });
          if(i===0) state=copy(st);
          return {says:text(f.says,300),into:i===0?0:Math.max(0,num(f.into,0)),hold:Math.max(0,num(f.hold,0)),state:tidy(st)}; }
        Object.keys(obj(f.people)).forEach(id=>{ if(cast.indexOf(id)<0){ drop(where+": nobody is called "+id); return; }
          const q=obj(f.people[id]), cur={...obj(state.people[id])};
          if(q.where!=null){ if(marks[q.where]){ cur.where=String(q.where); delete cur.xy; } else drop(where+": there is no mark called "+q.where); }
          if(q.at!=null){ const a=arr(q.at).map(Number); if(a.length===2&&a.every(Number.isFinite)&&(typeof c.inside!=="function"||c.inside(a))) cur.xy=[r2(a[0]),r2(a[1])]; else drop(where+": "+id+" would stand off the floor"); }
          if(Array.isArray(q.holding)) cur.holding=q.holding.map(String);
          state.people[id]=pose(q,cur,where); });
        Object.keys(obj(f.things)).forEach(k=>{ if(things.indexOf(k)<0){ drop(where+": there is no thing called "+k); return; }
          const t=obj(f.things[k]), next={}; ["at","on","heldBy","worn","state"].forEach(n=>{ if(t[n]!=null&&text(t[n],80)) next[n]=text(t[n],80); });
          if(next.heldBy&&cast.indexOf(next.heldBy)<0) delete next.heldBy;
          // (set down or handed over: whoever held it lets go)
          if(!next.heldBy||next.heldBy!==obj(state.things[k]).heldBy) Object.keys(state.people).forEach(id=>{ const p=state.people[id]; if(arr(p.holding).indexOf(k)>=0&&next.heldBy!==id) p.holding=p.holding.filter(x=>x!==k); });
          if(next.heldBy&&state.people[next.heldBy]) state.people[next.heldBy].holding=arr(state.people[next.heldBy].holding).filter(x=>x!==k).concat([k]);
          state.things[k]=next; });
        arr(f.doors).forEach(d=>{ const id=String(obj(d).id||""); if(doors.indexOf(id)<0){ if(id) drop(where+": there is no door called "+id); return; }
          const at=state.doors.findIndex(x=>x&&String(x.id)===id); if(at>=0) state.doors[at]={...state.doors[at],open:!!d.open}; else state.doors.push({id,open:!!d.open}); });
        state=tidy(state);
        return {says:text(f.says,300),into:Math.max(0,num(f.into,0)),hold:Math.max(0,num(f.hold,0)),state:copy(state)}; });
      // the times, fitted to the shot's own seconds
      const D=clamp(num(sh.seconds,4),0.5,MAX_SECONDS), total=frames.reduce((n,f)=>n+f.into+f.hold,0), k=total>0?D/total:0;
      if(k>=0.4&&k<=2.5) frames.forEach(f=>{ f.into=r2(f.into*k); f.hold=r2(f.hold*k); });
      else frames.forEach((f,i)=>{ const part=D/frames.length; f.into=i===0?0:r2(part*0.6); f.hold=i===0?r2(part):r2(part*0.4); });
      out[key]={name:text(row.name,60),sig:stateSig(sh.start,sh.end||sh.start),frames}; report.moments++; report.frames+=frames.length; });
    return {frames:out,report};
  }
  // the written frames of a shot that still fit it (the shot's start and end are the ones they were written for)
  const writtenFor=(saved,key,start,end)=>{ const m=obj(obj(saved)[key]); return arr(m.frames).length>=2&&m.sig===stateSig(start,end||start)?m:null; };

  root.KinolotBeatFrames={CLIP,POSE_N,STEP_WORD,MAX_FRAMES,JOINT_RANGE,lensOf,fromPack,normalize,frames,states,timeline,at,shots,board,written,writtenFor,stateSig};
})(typeof window!=="undefined"?window:globalThis);
