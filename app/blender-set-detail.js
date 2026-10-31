/* Metric detail assemblies for the cloud pilot. Produces bounded scene data only. */
(function(root){
  "use strict";
  const round=n=>Math.round(n*1000000)/1000000;
  const palette={
    deckSteel:{baseColor:[0.075,0.095,0.10],metallic:0.4,roughness:0.56},
    bulkhead:{baseColor:[0.36,0.41,0.37],metallic:0.28,roughness:0.60},
    paintBlue:{baseColor:[0.055,0.12,0.15],metallic:0.3,roughness:0.48},
    steel:{baseColor:[0.15,0.19,0.18],metallic:0.65,roughness:0.40},
    edgeMetal:{baseColor:[0.32,0.36,0.34],metallic:0.8,roughness:0.32},
    rampGreen:{baseColor:[0.10,0.19,0.15],metallic:0.45,roughness:0.52},
    safetyYellow:{baseColor:[0.72,0.43,0.035],metallic:0.05,roughness:0.48},
    safetyBlack:{baseColor:[0.014,0.018,0.017],metallic:0.1,roughness:0.6},
    fireRed:{baseColor:[0.48,0.025,0.016],metallic:0.25,roughness:0.38},
    whiteMark:{baseColor:[0.72,0.73,0.61],roughness:0.62},
    rubber:{baseColor:[0.017,0.021,0.019],roughness:0.84},
    lampWarm:{baseColor:[1,0.57,0.19],roughness:0.25,emissionStrength:3},
    ventShadow:{baseColor:[0.025,0.038,0.035],metallic:0.25,roughness:0.7},
  };
  function rectangle(space){
    const p=space?.footprint;if(!p||p.length!==4||space.openSky||!Number.isFinite(space.ceilingH))return null;
    const xs=p.map(v=>v[0]),ys=p.map(v=>v[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    if(p.some(v=>![x0,x1].includes(v[0])||![y0,y1].includes(v[1])))return null;
    return {x0,x1,y0,y1,width:x1-x0,length:y1-y0};
  }
  function build(source,{space,anchors}={}){
    const bounds=rectangle(space);
    if(!bounds||!/\b(car|vehicle)[ -]*deck\b/i.test(space.name||"")||bounds.width<6||bounds.length<10)return source;
    const names=new Map((anchors||[]).map(a=>[a.id,(a.id+" "+a.name).toLowerCase()]));
    const find=re=>source.objects.find(o=>o.anchorId&&re.test(names.get(o.anchorId)||""));
    const ramp=find(/stern.*ramp/),lanes=find(/lane.*(line|mark)/);
    // This assembly describes a raised ramp; never turn a saved lowered ramp upright.
    if(!ramp||!lanes||ramp.size[2]<1||ramp.size[2]<=ramp.size[1]*2)return source;
    const scene=JSON.parse(JSON.stringify(source)),parts=[],replace=new Map();
    Object.assign(scene.materials,palette);
    const part=(base,key,label,offset,size,material,rotation=[0,0,0],kind="box",extra={})=>{
      const angle=base.rotation[2],c=Math.cos(angle),s=Math.sin(angle);
      const item={id:(base.id+"-"+key).slice(0,100),name:label.slice(0,160),kind,material,
        position:[base.position[0]+c*offset[0]-s*offset[1],base.position[1]+s*offset[0]+c*offset[1],base.position[2]+offset[2]].map(round),
        rotation:[rotation[0],rotation[1],angle+rotation[2]].map(round),size:size.map(round),
        basis:"design",...(base.anchorId?{anchorId:base.anchorId}:{}),...extra};
      parts.push(item);return item;
    };
    const base=(id,position)=>({id,position,rotation:[0,0,0]});
    const {x0,x1,y0,y1,width,length}=bounds,z0=space.floorZ,ceiling=z0+space.ceilingH;
    const winding=space.footprint.reduce((sum,a,i)=>{const b=space.footprint[(i+1)%4];return sum+a[0]*b[1]-b[0]*a[1];},0)>0?1:-1;
    const roomPrefix=(space.name||"Space")+" ";
    for(const object of scene.objects){
      if(!object.name.startsWith(roomPrefix))continue;
      if(object.name===roomPrefix+"floor")object.material="deckSteel";
      if(object.name===roomPrefix+"ceiling")object.material="steel";
      if(object.name!==roomPrefix+"wall")continue;
      object.material="bulkhead";
      const bottom=object.position[2]-object.size[2]/2,top=Math.min(z0+1.15,object.position[2]+object.size[2]/2);
      if(top>bottom+.01)part(object,"dado","Lower painted bulkhead",[0,winding*(object.size[1]/2+.009),(top+bottom)/2-object.position[2]],
        [object.size[0],.016,top-bottom],"paintBlue");
    }
    // All structural repeats are constrained to the saved room, not a second room model.
    const fixture=find(/sodium.*(light|fitting)/),seed=fixture?.position[1]??(y0+length/2);
    const beamYs=[];
    for(let n=-24;n<=24;n++){
      const y=round(seed+n*4);if(y<y0+1||y>y1-1)continue;beamYs.push(y);
      const b=base("detail-beam-"+n,[(x0+x1)/2,y,ceiling-.16]);
      part(b,"web","Transverse steel beam web",[0,0,0],[width-.15,.07,.25],"steel");
      for(const side of [-1,1])part(b,"flange"+side,"Steel beam flange",[0,0,side*.11],[width-.15,.25,.035],"edgeMetal");
      for(const side of [-1,1]){
        const x=side<0?x0+.14:x1-.14;
        const blocked=(space.openings||[]).some(o=>Math.abs(o.centre[0]-(side<0?x0:x1))<.25&&Math.abs(o.centre[1]-y)<o.width/2+.18);
        if(!blocked)part(b,"rib"+side,"Bulkhead stiffener",[x-b.position[0],0,(z0+ceiling)/2-b.position[2]],
          [.14,.12,space.ceilingH-.12],"steel");
      }
      part(base("detail-deck-seam-"+n,[(x0+x1)/2,y,z0+.0015]),"joint","Deck plating seam",[0,0,0],[width-.3,.012,.002],"safetyBlack");
    }
    // A frame follows the saved aperture. The opening remains open; no new exit is invented.
    for(const [index,opening] of (space.openings||[]).entries()){
      if(opening.id===ramp.anchorId||opening.kind!=="door")continue;
      const a=space.footprint[opening.edge],b=space.footprint[(opening.edge+1)%4],angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
      const door={id:"detail-door-"+index,position:[...opening.centre,(opening.sillZ+opening.headZ)/2],rotation:[0,0,angle],anchorId:opening.id};
      const h=opening.headZ-opening.sillZ,w=opening.width;
      for(const side of [-1,1])part(door,"jamb"+side,"Weathertight door jamb",[side*(w/2+.035),winding*.095,0],[.07,.10,h+.12],"edgeMetal");
      part(door,"header","Weathertight door header",[0,winding*.095,h/2+.025],[w+.14,.10,.07],"edgeMetal");
      part(door,"threshold","Raised door threshold",[0,winding*.095,-h/2+.025],[w,.15,.05],"safetyYellow");
      part(door,"grab","Door grab rail",[w/2+.18,winding*.16,-.1],[.04,.04,Math.min(.7,h*.5)],"edgeMetal",[0,0,0],"cylinder");
    }
    // Ramp body and assemblies retain its saved transform and full closed-height silhouette.
    const [rw,rd,rh]=ramp.size;
    replace.set(ramp.id,{...ramp,material:"rampGreen",size:[rw,rd*.30,rh]});
    for(const side of [-1,1]){
      part(ramp,"frame"+side,"Ramp side frame",[side*rw*.475,0,0],[rw*.05,rd*.95,rh],"steel");
      part(ramp,"cross"+side,"Ramp cross frame",[0,0,side*rh*.46],[rw,rd*.95,rh*.08],"steel");
      part(ramp,"ram"+side,"Ramp hydraulic cylinder",[side*rw*.43,-rd*.28,-rh*.12],[.10,.10,rh*.46],"steel",[0,0,0],"cylinder");
      part(ramp,"rod"+side,"Exposed hydraulic rod",[side*rw*.43,-rd*.28,rh*.20],[.055,.055,rh*.22],"edgeMetal",[0,0,0],"cylinder");
      for(let n=0;n<6;n++)part(ramp,"chain"+side+"-"+n,"Ramp chain link",[side*rw*.39,-rd*.44,-rh*.28+n*rh*.07],
        [rw*.022,rh*.075,rd*.09],"edgeMetal",[Math.PI/2,0,0],"torus");
    }
    for(let n=-4;n<=4;n++)part(ramp,"rib"+n,"Raised ramp rib",[n*rw*.085,-rd*.30,0],[rw*.025,rd*.35,rh*.78],"edgeMetal");
    part(ramp,"hinge","Ramp hinge barrel",[0,-rd*.2,-rh/2+.075],[.12,.12,rw*.90],"edgeMetal",[0,Math.PI/2,0],"cylinder");
    for(let n=0;n<20;n++)part(ramp,"hazard"+n,"Ramp hazard stripe",[(n-9.5)*rw*.044,-rd*.46,-rh*.375],
      [rw*.035,.012,rh*.055],n%2?"safetyBlack":"safetyYellow",[0,.55,0]);

    const hose=find(/hose.*(cabinet|reel)/);
    if(hose){
      const [w,d,h]=hose.size;
      replace.set(hose.id,{...hose,material:"fireRed",size:[w,d*.82,h]});
      part(hose,"gasket","Hose cabinet door gasket",[0,d*.425,0],[w*.82,d*.04,h*.86],"safetyBlack");
      part(hose,"door","Red hose cabinet door",[0,d*.46,0],[w*.76,d*.06,h*.80],"fireRed");
      part(hose,"reel","Hose reel emblem",[0,d*.493,-h*.10],[w*.34,h*.28,d*.01],"whiteMark",[Math.PI/2,0,0],"torus");
      part(hose,"handle","Hose cabinet handle",[w*.29,d*.49,0],[w*.035,d*.02,h*.16],"edgeMetal");
      for(const side of [-1,1])part(hose,"letter"+side,"Fire equipment marker",[side*w*.09,d*.495,h*.22],[w*.035,d*.008,h*.18],"whiteMark");
      part(hose,"letterbar","Fire equipment marker",[0,d*.495,h*.22],[w*.20,d*.008,h*.035],"whiteMark");
    }
    const vent=find(/vent.*trunk/);
    if(vent){
      const [w,d,h]=vent.size;
      replace.set(vent.id,{...vent,material:"bulkhead",size:[w,d*.90,h]});
      part(vent,"intake","Dark ventilation intake",[0,d*.465,-h*.27],[w*.80,d*.025,h*.24],"ventShadow");
      for(let n=0;n<7;n++)part(vent,"louvre"+n,"Ventilation louvre",[0,d*.49,-h*.37+n*h*.032],[w*.83,d*.018,h*.014],"edgeMetal");
      for(const offset of [-.43,0,.43])part(vent,"seam"+offset,"Duct joint band",[0,0,h*offset],[w*1.002,d*.94,.025],"steel");
    }
    const number=find(/deck.*number/);
    if(number){
      const [w,d,h]=number.size,front=.15/2+d/2+.004;
      replace.set(number.id,{...number,material:"bulkhead"});
      part(number,"stem","Deck number one stem",[w*.03,front,0],[w*.15,.005,h*.80],"whiteMark");
      part(number,"foot","Deck number one foot",[0,front,-h*.40],[w*.57,.005,h*.08],"whiteMark");
      part(number,"flag","Deck number one flag",[-w*.08,front,h*.29],[w*.30,.005,h*.10],"whiteMark",[0,-.5,0]);
    }
    const chock=find(/wheel.*chock/);
    if(chock)replace.set(chock.id,{...chock,material:"rubber",kind:"wedge"});

    // The saved line remains centred at its anchor. Lane spacing/arrows are proposed inside the footprint.
    const [lw,ll,lh]=lanes.size;
    replace.set(lanes.id,{...lanes,material:"safetyYellow",size:[lw,Math.min(1.4,ll),lh]});
    for(let n=-24;n<=24;n++){
      const y=n*3;if(Math.abs(y)+.7>ll/2||n===0)continue;
      part(lanes,"dash"+n,"Dashed lane marking",[0,y,0],[lw,1.4,lh],"safetyYellow");
    }
    for(const side of [-1,1]){
      const x=side*width*.25;
      part(lanes,"edge"+side,"Proposed lane edge",[x,0,0],[lw*.7,ll,lh*.7],"safetyYellow");
      for(let n=-1;n<=1;n++)part(lanes,"arrow"+side+"-"+n,"Forward lane arrow",[x/2,n*ll*.30,lh*.15],[.65,1.8,lh*.7],"whiteMark",[0,0,0],"prism",
        {footprint:[[-.11,-.5],[.11,-.5],[.11,0],[.5,0],[0,.5],[-.5,0],[-.11,0]]});
    }
    if(fixture){
      const [w,d,h]=fixture.size,lights=[];
      const fixtureYs=beamYs.filter(y=>Math.abs((y-seed)/8-Math.round((y-seed)/8))<.001);
      for(const y of fixtureYs){
        const current={...fixture,id:Math.abs(y-seed)<.001?fixture.id:"detail-lamp-"+round(y),position:[fixture.position[0],y,fixture.position[2]]};
        if(current.id===fixture.id)replace.set(fixture.id,{...current,material:"steel"});
        else parts.push({...current,material:"steel",basis:"design"});
        part(current,"glass","Warm practical lamp diffuser",[0,0,-h*.43],[w*.82,d*.80,h*.12],"lampWarm");
        for(const side of [-1,1])part(current,"cage"+side,"Lamp protective cage",[side*w*.43,0,-h*.38],[.016,d*.95,.025],"edgeMetal");
        lights.push({position:[current.position[0],y,current.position[2]-h*.55],colour:[1,.72,.43],powerWatts:600,sizeMetres:2.5});
      }
      const cx=(x0+x1)/2,cy=(y0+y1)/2;
      scene.previewLights=scene.previewLights.filter(l=>!(Math.abs(l.position[0]-cx)<.001&&Math.abs(l.position[1]-cy)<.001&&Math.abs(l.position[2]-(ceiling-.15))<.001));
      scene.previewLights.push(...lights);
    }
    scene.objects=scene.objects.map(o=>replace.get(o.id)||o).concat(parts);
    scene.status="development detailed set";
    scene.notes=scene.notes.filter(n=>!n.startsWith("Object sizes marked proposed design"));
    scene.notes.push("Car-deck detail profile v1: saved footprints, openings, anchor centres and cameras are retained. Ramp ribs, door frames, steelwork, colours and lighting are proposed design detail, not surveyed construction.");
    scene.notes.push("Lane spacing and repeated beams/lamp fittings are proposed within the saved deck. Wall signs sit on the inner face of the proposed 0.15 m bulkhead. Other grouped dressing remains simplified.");
    return root.KinolotRenderContract.validateScene(scene);
  }
  root.KinolotSetDetail={build};
})(typeof window!=="undefined"?window:globalThis);
