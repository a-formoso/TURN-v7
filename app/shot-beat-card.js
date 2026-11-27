/* THE SHOTS TAB, BEAT FIRST (owner 2026-11-24, their design "Shots tab: a beat and its open shot").
   One card for each beat: its number, its name, where it plays, how many shots and seconds, what is planned, drawn,
   framed and approved, a small picture of every shot, and the beat's own actions. Under it, ONE shot open at a time:
   its picture (Previs, Clay, Depth, Frame), its name and camera words, then five numbered steps (What happens,
   Camera, Previs, Frame, Approve) and, folded away, everything else the card had.
   This file is the part with no screen: the words and the numbers. shot-beat-card-ui.jsx draws them.
     number(sh)             → "1.3" (beat . moment; a beat kept as one shot is "1.1")
     name(sh)               → "Two-shot", "Wide", "Insert", "Wide, moving": what the shot is, in two words
     chips(sh, o)           → ["Medium shot", "Eye level", "35 mm", "Static", "5 s"]
     state(o)               → the word under a shot's small picture
     counts(shots, o)       → {planned, drawn, frames, approved}
     beatTitle(row)         → the beat's name: its action word ("Disarms")
     beatMeta(o)            → "Hussain Flat · 3 shots · 15 seconds"
     order(shots)           → the beat's shots in the order they play
     steps(o)               → the five steps of an open shot, each done / next / later, with what to do
     planModel(...)         → the small floor plan of step 2: the camera, where it looks, and each person's mark
     cameraLine(res)        → "1.9 m from them · 1.5 m high · 35 mm lens"
     checkLine(res)         → "Both faces are seen. Nothing stands in the way." (or null when the checks said something) */
(function(root){
  "use strict";
  const arr=v=>Array.isArray(v)?v:[], obj=v=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
  const text=v=>String(v==null?"":v).replace(/\s+/g," ").trim();
  // the plan's own shot sizes, in two forms: the short name of a shot, and the full words of its chip
  const SHORT={EWS:"Extreme wide",WS:"Wide",FS:"Full",MWS:"Medium wide",MS:"Medium",MCU:"Medium close",CU:"Close",ECU:"Extreme close",INSERT:"Insert"};
  const FULL={EWS:"Extreme wide shot",WS:"Wide shot",FS:"Full shot",MWS:"Medium wide shot",MS:"Medium shot",MCU:"Medium close-up",CU:"Close-up",ECU:"Extreme close-up",INSERT:"Insert"};
  const ANGLE={eye:"Eye level",high:"High angle",low:"Low angle",top:"Top down",dutch:"Dutch angle",ots:"Over the shoulder",pov:"Point of view"};
  const MOVE={static:"Static",pan:"Pan",tilt:"Tilt",push:"Push in",pull:"Pull out",track:"Tracking",handheld:"Handheld",crane:"Crane",steadi:"Steadicam"};
  const COLOUR={blue:"#2E4FD6",pink:"#D2386C",green:"#2F9A45",yellow:"#C9A012",purple:"#7B3FC2",turquoise:"#1FA7A7",white:"#8A8A86",brown:"#6B4423"};
  const sizeKey=sh=>String(obj(sh).size||"").toUpperCase();
  const still=sh=>/^(|auto|static|locked|none)$/i.test(text(obj(sh).move));
  const momentOf=sh=>{ const n=Number(obj(obj(sh).moment).n); return Number.isFinite(n)&&n>0?n:1; };

  function number(sh){ const b=Number(obj(sh).beatN); return (Number.isFinite(b)&&b>0?b:0)+"."+momentOf(sh); }
  // what the shot is, in a word or two: an insert, a two-shot, or its size; ", moving" when the camera moves
  function name(sh){
    const k=sizeKey(sh), two=arr(obj(sh).subjects).length===2&&/^(FS|MWS|MS|MCU)$/.test(k);
    const base=k==="INSERT"?"Insert":two?"Two-shot":SHORT[k]||text(obj(sh).size)||"Shot";
    return base+(still(sh)?"":", moving");
  }
  function chips(sh,o){
    o=o||{}; const s=obj(sh), out=[];
    const k=sizeKey(s); if(k) out.push(FULL[k]||text(s.size));
    const a=text(s.angle).toLowerCase(); if(a&&a!=="auto") out.push(ANGLE[a]||text(s.angle));
    const lens=Number(o.lensMm)||Number((/(\d{1,3}(?:\.\d)?)/.exec(text(s.lens))||[])[1])||0; if(lens>0) out.push(Math.round(lens)+" mm");
    const m=text(s.move).toLowerCase(); out.push(still(s)?"Static":MOVE[m]||text(s.move));
    const sec=Number(o.seconds); if(sec>0) out.push((Math.round(sec*10)/10)+" s");
    return out.filter(Boolean);
  }
  // the word under a shot's small picture (the order is the order of what matters most to know)
  function state(o){
    o=o||{};
    if(o.open) return "Open below";
    if(o.making) return "Making…";
    if(o.approved&&o.frame) return "Approved";
    if(o.frame) return "Frame made";
    if(o.drawn) return "Drawn";
    if(o.planned) return "Planned";
    return "Not planned";
  }
  function counts(shots,o){
    o=o||{}; const has=(fn,sh)=>typeof fn==="function"?!!fn(sh):false, list=arr(shots).filter(Boolean);
    return {planned:list.filter(sh=>sh.planned&&sh.startState).length,drawn:list.filter(sh=>has(o.drawn,sh)).length,
      frames:list.filter(sh=>has(o.frame,sh)).length,approved:list.filter(sh=>!!sh.locked&&has(o.frame,sh)).length};
  }
  const countWords=c=>[c.planned+" planned",c.drawn+" drawn",c.frames+(c.frames===1?" frame":" frames"),c.approved+" approved"];
  // the beat's name is its action: what the one who drives the beat does ("Disarms"); none written = no name
  function beatTitle(row){ const r=obj(row); return text(obj(r.drive).a)||text(r.title)||text(r.name)||""; }
  function beatMeta(o){
    o=o||{}; const n=Number(o.shots)||0, s=Math.round(Number(o.seconds)||0), m=Math.round(Number(o.moments)||0);
    return [text(o.place),m>0?m+(m===1?" moment":" moments"):"",n+(n===1?" shot":" shots"),s>0?s+(s===1?" second":" seconds"):""].filter(Boolean).join(" · ");
  }
  // the beat's shots in the order they play: its moments first, in their order, then any other shot it holds
  function order(shots){
    const key=sh=>sh&&(sh.keyframeMode==="beat-opening"||sh.keyframeMode==="moment");
    return arr(shots).filter(Boolean).slice().sort((a,b)=>(key(a)?0:1)-(key(b)?0:1)||(key(a)&&key(b)?momentOf(a)-momentOf(b):0)||((a.order||0)-(b.order||0)));
  }
  // which shot is open when nothing was chosen: the first with no frame yet, else the first
  function firstOpen(shots,frame){ const list=order(shots); return (list.find(sh=>typeof frame==="function"&&!frame(sh))||list[0]||{}).id||""; }

  /* THE FIVE STEPS OF AN OPEN SHOT. o: {words (the action is written), camera (a size is chosen), previs ("" none yet,
     "ok", "notes", "none" = cannot be drawn), frame, approved, busy}. Each: {n, name, state:"done"|"next"|"later", note}.
     A shot that cannot be drawn (no scene plan, no floor plan) skips step 3: its frame is made the plain way. */
  function steps(o){
    o=o||{};
    const drawn=o.previs==="ok"||o.previs==="notes", noPrevis=o.previs==="none";
    const list=[
      {n:1,name:"What happens",done:!!o.words,todo:"write what we see"},
      {n:2,name:"Camera",done:!!o.camera,todo:"choose the size and the lens"},
      {n:3,name:"Previs",done:drawn||noPrevis,todo:"drawing…",skip:noPrevis},
      {n:4,name:"Frame",done:!!o.frame,todo:o.busy?"making…":"next"},
      {n:5,name:"Approve",done:!!(o.approved&&o.frame),todo:o.frame?"next":"after the frame"}];
    const next=list.find(s=>!s.done);
    return list.map(s=>({n:s.n,name:s.name,state:s.done?"done":s===next?"next":"later",
      note:s.skip?"no drawing here":s.done?(s.n===3&&o.previs==="notes"?"see the notes":"done"):s===next?(s.n===4&&o.busy?"making…":s.n===3?s.todo:"next"):s.n===5?"after the frame":"later"}));
  }

  /* THE SMALL FLOOR PLAN OF STEP 2: the place as the Locations tab draws it (KinolotSetCard.planModel), the shot's
     camera as a dot with the wedge it looks through, and each person on their mark with their initial.
     plan = locationFloorPlanScene(...); pose = {position, yaw, lensMm}; people = [{id, name, xy, colour}].
     → {W, H, rooms, doors, windows, wall, camera:{at, cone}, people:[{id, initial, name, at, css}]} or null */
  function planModel(plan,spaceId,pose,people,width){
    const K=root.KinolotSetCard; if(!K||typeof K.planModel!=="function"||!plan) return null;
    const p=obj(pose), at=arr(p.position);
    const cams=[];
    if(at.length>=2&&at.every(n=>typeof n==="number"&&Number.isFinite(n))){
      // the wedge: half the lens's width to each side of where it looks (36 mm frame), drawn 3 m long
      const yaw=(Number(p.yaw)||0)*Math.PI/180, half=Math.atan(18/Math.max(8,Number(p.lensMm)||35)), L=3;
      const ray=a=>[at[0]+Math.sin(a)*L,at[1]+Math.cos(a)*L];
      cams.push({spaceId:String(spaceId),panel:"shot",position:[at[0],at[1]],frustum:[[at[0],at[1]],ray(yaw-half),ray(yaw+half)]});
    }
    let m=null;
    try{ m=K.planModel({...plan,cameras:cams},{id:String(spaceId)},"shot",null,width||324); }catch(_){ m=null; }
    if(!m) return null;
    const px=xy=>[Math.round((m.W/2+(xy[0]-m.origin[0])*m.scale)*10)/10,Math.round((m.H/2-(xy[1]-m.origin[1])*m.scale)*10)/10];
    const used={};
    const who=arr(people).filter(q=>q&&arr(q.xy).length>=2).map(q=>{
      // an initial each; two people with the same one get their first two letters
      const nm=text(q.name), first=nm.charAt(0).toUpperCase()||"?", clash=arr(people).filter(x=>x&&text(x.name).charAt(0).toUpperCase()===first).length>1;
      let initial=clash?(nm.slice(0,2).charAt(0).toUpperCase()+nm.slice(1,2).toLowerCase()):first; if(used[initial]) initial=first+(Object.keys(used).length+1); used[initial]=1;
      // the colour the drawing gives this person (shot-previs.js PALETTE names), so the plan and the picture agree
      const css=COLOUR[text(q.colour).toLowerCase()]||"";
      return {id:String(q.id||nm),initial,name:nm,at:px(q.xy),css};
    });
    return {W:m.W,H:m.H,rooms:m.rooms,doors:m.doors,windows:m.windows,wall:m.wall,camera:m.camera?{at:m.camera.at,cone:m.camera.cone}:null,people:who,missing:m.missing};
  }
  const num=(n,d)=>{ const v=Number(n); if(!Number.isFinite(v)) return ""; const f=Math.pow(10,d||0); return String(Math.round(v*f)/f); };
  function cameraLine(res){
    const r=obj(res), pose=obj(r.pose), pos=arr(pose.position);
    if(!pos.length) return "";
    return [Number(r.distance)>0?num(r.distance,1)+" m from "+(arr(r.people).length>1?"them":arr(r.people).length===1?"who it frames":"what it frames"):"",
      num(pos[2],1)+" m high",num(pose.lensMm)+" mm lens"].filter(Boolean).join(" · ");
  }
  // one plain line when every check passed; null when a check said something (its notes are shown instead)
  function checkLine(res){
    const r=obj(res); if(!r.start||arr(r.notes).length||arr(r.missing).length||r.fits===false) return null;
    const seen=arr(r.people).filter(p=>p&&!p.unseen).length;
    return (seen>=3?"Every face is seen.":seen===2?"Both faces are seen.":seen===1?"The face is seen.":"Nobody is in this shot.")+" Nothing stands in the way.";
  }
  /* A BEAT'S MOMENTS AND THE SHOTS INSIDE EACH (owner 2026-11-27: "I want to be able to see each moment of a beat ...
     change moments and see the shots inside that moment with their respective cuts"; a moment holds one or more
     shots, numbered beat . moment . shot). moments(shots) → [{n, shots:[in order], cuts}]: a moment's shots are the
     shot the moment was split into, then any shot added to it; each shot after the first begins with a cut.
     shotNumber(sh, shots) → "1.3.1" (shots = the beat's shots). momentMeta({shots, seconds, steps}) → the line under
     a moment's name: "1 shot · no cut · 4 seconds". */
  function moments(shots){
    const by=new Map(); order(shots).forEach(sh=>{ const n=momentOf(sh); if(!by.has(n)) by.set(n,[]); by.get(n).push(sh); });
    return Array.from(by.keys()).sort((a,b)=>a-b).map(n=>({n,shots:by.get(n),cuts:Math.max(0,by.get(n).length-1)}));
  }
  function shotNumber(sh,shots){
    const s=obj(sh), b=Number(s.beatN), list=arr(shots).some(x=>x&&x.id===s.id)?shots:[s], m=moments(list).find(x=>x.n===momentOf(s)), i=m?m.shots.findIndex(x=>x.id===s.id):0;
    return (Number.isFinite(b)&&b>0?b:0)+"."+momentOf(s)+"."+(Math.max(0,i)+1);
  }
  function momentMeta(o){
    o=o||{}; const n=Math.max(1,Number(o.shots)||1), s=Math.round(Number(o.seconds)||0), k=Math.round(Number(o.steps)||0);
    return [n+(n===1?" shot":" shots"),n===1?"no cut":(n-1)+(n===2?" cut":" cuts"),s>0?s+(s===1?" second":" seconds"):"",k>1?k+" steps written":""].filter(Boolean).join(" · ");
  }
  root.KinolotBeatCard={SHORT,FULL,ANGLE,MOVE,COLOUR,number,name,chips,state,counts,countWords,beatTitle,beatMeta,order,firstOpen,steps,planModel,cameraLine,checkLine,moments,shotNumber,momentMeta};
})(typeof window!=="undefined"?window:globalThis);
