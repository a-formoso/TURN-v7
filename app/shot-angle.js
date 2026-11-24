/* FROM A LOCATION'S CAMERA TO A SHOT (owner 2026-11-24, the Previs look brief, step 5: "On a location card, I move
   the camera until I like the view. I press Use this angle in a shot. I pick where it goes: the scene, then the
   beat, then the shot inside that beat. That shot now holds my angle").
   This file is the part with no screen: which shots an angle of a place can go to, and the words for each choice.
   The camera tool (camera-angle-preview-ui.jsx) draws the picker; the plan keeps the camera (scene-plan.js
   handCamera / setHandCamera); the app saves it and opens the shot (app.jsx turnUseAngleInShot).
     family(location, list)      → the ids of the place and its rooms (one set, one system of coordinates)
     targets(location, ctx)      → [{id, no, title, planned, beats:[{n, shots:[{id, key, label, hand}]}], waiting}]
                                    the scenes that play in this place, each with its beats and their planned shots.
                                    planned = the scene has a scene plan (a camera can only be written into one);
                                    waiting = shots here that are not planned yet. ctx: {locations, scenes, shots, plans}
     floorAt(location, list, x, y) → the floor height where a camera stands (0 when unknown)
     angleName(scene, beat)      → the name an angle gets when it is saved without one */
(function(root){
  "use strict";
  const arr=v=>Array.isArray(v)?v:[], obj=v=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
  const tidy=(s,n)=>String(s==null?"":s).replace(/\s+/g," ").trim().slice(0,n||200);
  function family(location,list){
    const ids=[String(obj(location).id||"")];
    try{
      const D=root.KinolotSetDressing, where=D&&typeof D.place==="function"?D.place(location,list):null;
      arr(where&&where.family).forEach(m=>{ const id=String(obj(m).id||""); if(id&&ids.indexOf(id)<0) ids.push(id); });
      if(where&&where.owner&&where.owner.id&&ids.indexOf(String(where.owner.id))<0) ids.push(String(where.owner.id));
    }catch(_){}
    return ids.filter(Boolean);
  }
  // where a shot plays: the plan's own set for it, else the shot's location
  function placeOf(sh,plan){
    const set=arr(obj(plan).sets).find(x=>x&&x.id===obj(sh).planSet);
    return String((set&&set.locationId)||obj(sh).locationId||"");
  }
  // the plan's own shot sizes (scene-plan.js SIZES), in words
  const SIZE={EWS:"extreme wide shot",WS:"wide shot",FS:"full shot",MWS:"medium wide shot",MS:"medium shot",MCU:"medium close-up",CU:"close-up",ECU:"extreme close-up",INSERT:"insert"};
  function targets(location,ctx){
    ctx=ctx||{};
    const SP=root.ScenePlan, here=family(location,ctx.locations), plans=obj(ctx.plans), out=[];
    if(!SP) return out;
    arr(ctx.scenes).forEach(scene=>{
      if(!scene||!scene.id) return;
      const plan=plans[scene.id]||null, ok=!!(plan&&typeof SP.exact==="function"&&SP.exact(plan));
      const mine=arr(ctx.shots).filter(sh=>sh&&sh.sceneId===scene.id&&here.indexOf(placeOf(sh,plan))>=0);
      if(!mine.length) return;
      // a shot the plan knows: it has a state to start from, and its own place in the plan's camera list
      const known=mine.filter(sh=>ok&&sh.planned&&sh.startState&&SP.isKeyShot(sh));
      const byBeat=new Map();
      known.slice().sort((a,b)=>(Number(a.beatN)-Number(b.beatN))||(SP.momentOf(a)-SP.momentOf(b))||((a.order||0)-(b.order||0))).forEach(sh=>{
        const n=Number(sh.beatN)||0, key=SP.shotCameraKey(sh); if(!byBeat.has(n)) byBeat.set(n,[]);
        const list=byBeat.get(n); if(list.some(x=>x.key===key)) return;                     // one camera a moment
        const of=Number(obj(sh.moment).of)||0, m=SP.momentOf(sh), does=tidy(sh.action||sh.purpose||sh.composition,70);
        list.push({id:String(sh.id),key,hand:SP.isHandCamera(obj(plan.cameras)[key]),
          label:(of>1?"Moment "+m+" of "+of:"The beat’s shot")+" · "+(SIZE[String(sh.size||"").toUpperCase()]||tidy(sh.size,20)||"shot")+(does?" · "+does:"")});
      });
      out.push({id:String(scene.id),no:scene.no,title:tidy(scene.title||scene.name,80),planned:ok,
        beats:[...byBeat.entries()].sort((a,b)=>a[0]-b[0]).map(([n,shots])=>({n,shots})),waiting:mine.length-known.length});
    });
    return out;
  }
  function floorAt(location,list,x,y){
    try{
      const plan=root.locationSpatialContract(location,list), spaces=arr(obj(obj(plan).coordinates).spaces);
      const inside=(poly,p)=>{ let c=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const a=poly[i],b=poly[j];
        if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) c=!c; } return c; };
      const area=poly=>Math.abs(poly.reduce((n,a,i)=>{ const b=poly[(i+1)%poly.length]; return n+a[0]*b[1]-b[0]*a[1]; },0))/2;
      const at=spaces.filter(sp=>sp&&arr(sp.footprint).length>=3&&inside(sp.footprint,[x,y])).sort((a,b)=>area(a.footprint)-area(b.footprint))[0];
      const z=Number(at&&at.floorZ); return Number.isFinite(z)?z:0;
    }catch(_){ return 0; }
  }
  const angleName=(scene,beat)=>"Angle for Scene "+String(obj(scene).no==null?"":obj(scene).no).padStart(2,"0")+", beat "+(Number(beat)||1);
  root.KinolotShotAngle={family,placeOf,targets,floorAt,angleName};
})(typeof window!=="undefined"?window:globalThis);
