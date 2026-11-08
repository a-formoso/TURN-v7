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
  function anchorShape(anchor){
    if(anchor?.renderShape)return anchor.renderShape;
    const name=String(anchor?.name||"");
    // Recognise named court nets, never a basketball hoop, a netball court or an object merely placed by a net.
    if(/\bnet\b/i.test(name)&&/\b(volleyball|badminton|tennis|sports|court|divider|dividing)\b/i.test(name)
      &&!/(basketball|hoop|netball|cabinet|storage|rack)/i.test(name))return "sports-net";
    // Match the object itself, not a neighbouring object in its placement description.
    const subject=name.split(/\b(?:beside|near|above|under|behind|in front of|next to|by)\b/i)[0];
    if(/\b(?:parcel|luggage) shelves\b/i.test(subject)
      &&/\b(?:each|both)(?:\s+[\w-]+){0,3}\s+(?:window|side|wall)\b/i.test(name+" "+(anchor?.placement||"")))return "side-shelves";
    if(/\b(?:bed|chair|desk|table|wardrobe)\b.*(?: and | \+ | \/ ).*\b(?:bed|chair|desk|table|wardrobe)\b/i.test(subject))return "box";
    if(/\b(?:bedside|nightstand|night stand)\b/i.test(subject))return "nightstand";
    if(/\b(?:wardrobe|armoire)\b/i.test(subject))return "wardrobe";
    if(/\b(?:pillow|pillows)\b/i.test(subject)&&(!/\bbed\b/i.test(subject)||/\bbed pillows?\b/i.test(subject)))return "pillow";
    if(/\bbed\b/i.test(subject)&&! /\b(?:bunk|sofa|folding|bedspread|bedroom|pet|dog|cat)\b/i.test(subject)
      &&(!/\bframe\b/i.test(subject)||/\bmattress\b/i.test(subject))
      &&(!/\bheadboard\b/i.test(subject)||/\b(?:no headboard|without (?:a )?headboard)\b/i.test(subject)))return "bed";
    if(/\b(?:desk|table)\b/i.test(subject)&&! /\b(?:lamp|light|cloth|tennis|pool|billiard|folding|wall|dressing)\b/i.test(subject))return "table";
    if(/\bchair\b/i.test(subject)&&! /\b(?:wheelchair|armchair|driver|office|folding|rocking)\b/i.test(subject))return "chair";
    return "box";
  }
  // A named pair's dimensions describe its overall envelope, not a board spanning the aisle.
  function buildSideShelves(source,anchors){
    const byId=new Map((anchors||[]).map(a=>[a.id,a]));
    const eligible=o=>o.kind==="box"&&o.anchorId&&anchorShape(byId.get(o.anchorId))==="side-shelves"
      &&Math.min(o.size[0],o.size[1])>=.6&&Math.max(o.size[0],o.size[1])>=Math.min(o.size[0],o.size[1])*1.5;
    if(!source.objects.some(eligible))return source;
    const scene=JSON.parse(JSON.stringify(source)),objects=[];
    for(const base of scene.objects){
      if(!eligible(base)){objects.push(base);continue;}
      const [w,d,h]=base.size,alongY=d>=w,cross=alongY?w:d,depth=Math.min(.3,cross*.16);
      const material="sideShelfBoard-"+base.material;scene.materials[material]={...scene.materials[base.material]};
      for(const [i,side] of [-1,1].entries()){
        const at=side*(cross-depth)/2;let x=alongY?at:0,y=alongY?0:at,z=0;
        const [rx,ry,rz]=base.rotation,y1=y*Math.cos(rx)-z*Math.sin(rx),z1=y*Math.sin(rx)+z*Math.cos(rx);
        const x1=x*Math.cos(ry)+z1*Math.sin(ry),z2=-x*Math.sin(ry)+z1*Math.cos(ry);
        x=x1*Math.cos(rz)-y1*Math.sin(rz);y=x1*Math.sin(rz)+y1*Math.cos(rz);
        objects.push({...base,id:(base.id+"-side-shelf-"+i).slice(0,100),name:(base.name+" · side shelf "+(i+1)).slice(0,160),
          material,position:[base.position[0]+x,base.position[1]+y,base.position[2]+z2].map(round),
          size:(alongY?[depth,d,h]:[w,depth,h]).map(round),basis:"design"});
      }
    }
    scene.objects=objects;
    scene.notes.push("Paired parcel shelves described above each side use two boards within their saved overall bounds and facing. Board depth is proposed design, up to 0.3 m; the centre is open. Lights, cameras and saved measurements are unchanged. Explicit Solid block overrides this assembly.");
    return root.KinolotRenderContract.validateScene(scene);
  }
  function buildBus(source,{space,anchors,brief,partPoses}={}){
    const bounds=rectangle(space),text=String(brief?.architecture||""),sizes=String(brief?.keySizes||"");
    if(!bounds||!/\bbus\b/i.test((brief?.name||space.name||"")+" "+text)||source.notes.some(n=>n.startsWith("Bus interior profile v1:")))return source;
    // Only expand a stated, measured row pattern. Do not infer counts from an inspiration image.
    const left=text.match(/\bL1(?:\s+to\s+|\s*[–—-]\s*)L(\d{1,2})\b/i),right=text.match(/\bR1(?:\s+to\s+|\s*[–—-]\s*)R(\d{1,2})\b/i);
    const numbers={two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
    const written=text.match(/\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+rows\b[^.;]{0,100}\b(?:each|both|per)\s+side(?:s)?\b/i);
    const pitchText=sizes.match(/\brow pitch\s+(?:(?:about|approximately|of)\s+)?(\d*\.?\d+)\s*m\b/i);
    if((!left||!right)&&(!written||/\b(?:not|without)\b[^.;]*\brows\b/i.test(text))||!pitchText)return source;
    const count=left&&right?Number(left[1]):Number(written[1])||numbers[written[1].toLowerCase()],pitch=Number(pitchText[1]);
    if(!Number.isInteger(count)||left&&count!==Number(left[1])||right&&count!==Number(right[1])||count<2||count>20||pitch<.3||pitch>1.5)throw Error("The bus needs matching left/right row counts and a valid saved row pitch.");
    const named=(anchors||[]).map(a=>{
      const id=a.id.match(/(?:^|-)bench-([LR])(\d+)$/i),name=String(a.name||"").match(/\b(west|east|left|right)\b[^.;]{0,30}\brow\s*(\d+)\b/i);
      return {anchor:a,match:id||name,side:id?id[1].toUpperCase():name?(/west|left/i.test(name[1])?"L":"R"):null,row:Number((id||name)?.[2])};
    }).filter(x=>x.match)
      .map(x=>{
        const a=x.anchor,base=source.objects.find(o=>o.anchorId===a.id);let z=a.z==null?space.floorZ+a.size[2]/2:a.z;
        if(a.zBasis==="base")z=Math.max(space.floorZ+a.size[2]/2,Math.min(z+a.size[2]/2,space.floorZ+space.ceilingH-a.size[2]/2));
        const usual={...base,id:base?.id||"bus-named-"+a.id,anchorId:a.id,name:a.name,kind:"box",material:base?.material||"dressing",position:[...a.xy,z],size:a.size.slice(),rotation:[0,0,-(a.facing||0)*Math.PI/180]};
        return {...x,base,usual};
      });
    const template=Object.fromEntries(["L","R"].map(side=>[side,named.find(x=>x.side===side)]));
    if(!template.L||!template.R)return source;
    const station=(t,row)=>{const delta=(t.row-row)*pitch,angle=t.usual.rotation[2];return [t.usual.position[0]-Math.sin(angle)*delta,t.usual.position[1]+Math.cos(angle)*delta,t.usual.position[2]];};
    for(const item of named){
      const at=station(template[item.side],item.row);
      if(item.row<1||item.row>count||Math.hypot(...item.usual.position.map((n,i)=>n-at[i]))>.05)
        throw Error("The named bus benches do not match the stated row pitch. Review their saved positions before building.");
    }
    const scene=JSON.parse(JSON.stringify(source)),parts=[],replace=new Set(named.filter(x=>x.base).map(x=>x.base.id)),rich=source.schema===root.KinolotRenderContract.MCP_SCHEMA;
    Object.assign(scene.materials,{
      busVinyl:{baseColor:[.22,.34,.27],roughness:.78},busMetal:{baseColor:[.34,.37,.35],metallic:.7,roughness:.42},
      busPaint:{baseColor:[.60,.57,.48],metallic:.08,roughness:.76},busRubber:{baseColor:[.08,.09,.09],roughness:.9},
      busLamp:{baseColor:[.93,.94,.85],roughness:.4,emissionStrength:3},busRed:{baseColor:[.5,.035,.02],roughness:.55}
    });
    const emit=(base,key,label,at,size,material,soft=false,extra={})=>{
      const angle=base.rotation[2],x=at[0]*Math.cos(angle)-at[1]*Math.sin(angle),y=at[0]*Math.sin(angle)+at[1]*Math.cos(angle);
      parts.push({...base,id:(base.id+"-"+key).slice(0,100),name:(base.name+" · "+label).slice(0,160),
        kind:soft&&rich?"cushion":"box",position:[base.position[0]+x,base.position[1]+y,base.position[2]+at[2]].map(round),size:size.map(round),
        material,basis:"design",...(!soft&&rich?{bevelMetres:Math.min(.006,...size.map(n=>n*.15))}:{}),...extra});
    };
    const bench=base=>{
      const [w,d,h]=base.size;
      emit(base,"seat","seat cushion",[0,d*.06,-h*.07],[w*.94,d*.72,h*.10],"busVinyl",true);
      emit(base,"back","back cushion",[0,-d*.42,h*.20],[w*.94,d*.12,h*.59],"busVinyl",true);
      emit(base,"rail","top rail",[0,-d*.43,h*.4875],[w*.98,d*.045,h*.025],"busMetal");
      for(const x of [-1,1]){
        emit(base,"post"+x,"back support",[x*w*.47,-d*.43,h*.19],[w*.03,d*.045,h*.60],"busMetal");
        for(const y of [-1,1])emit(base,"foot"+x+y,"seat leg",[x*w*.34,y*d*.28,-h*.29],[w*.055,d*.055,h*.42],"busMetal");
      }
    };
    for(const side of ["L","R"])for(let row=1;row<=count;row++){
      const saved=named.find(x=>x.side===side&&x.row===row),t=template[side];
      let base=saved?(scene.objects.find(o=>o.id===saved.base?.id)||saved.usual):{...t.usual,id:"bus-repeat-"+side+row,name:"Bench "+side+row+" (stated row pattern)",position:station(t,row),basis:"design"};
      if(!saved)delete base.anchorId;
      if(saved&&(saved.anchor.renderShape||partPoses?.[saved.anchor.id])){replace.delete(base.id);continue;}
      if(base.position[0]<bounds.x0-.02||base.position[0]>bounds.x1+.02||base.position[1]<bounds.y0||base.position[1]>bounds.y1)
        throw Error("The stated bus rows extend beyond the saved cabin. Review the row count, pitch or bench positions.");
      if(!saved&&Object.values(source.cameras).some(p=>{
        const dx=p.position[0]-base.position[0],dy=p.position[1]-base.position[1],a=base.rotation[2];
        return Math.abs(dx*Math.cos(a)+dy*Math.sin(a))<base.size[0]/2&&Math.abs(-dx*Math.sin(a)+dy*Math.cos(a))<base.size[1]/2&&Math.abs(p.position[2]-base.position[2])<base.size[2]/2;
      }))throw Error("A saved camera stands inside a repeated bus bench. Adjust that camera in step 3 before building.");
      bench(base);
    }
    const roomPrefix=(space.name||"Space")+" ",ceiling=space.floorZ+space.ceilingH;
    for(const o of scene.objects){if(o.name===roomPrefix+"floor")o.material="busRubber";if(o.name===roomPrefix+"wall")o.material="busPaint";}
    const roof=scene.objects.find(o=>o.name===roomPrefix+"ceiling");
    if(roof&&/\bcurved\b/i.test(text+" "+(anchors||[]).map(a=>a.name).join(" "))){
      const alongY=bounds.length>=bounds.width,cross=alongY?bounds.width:bounds.length,run=alongY?bounds.length:bounds.width;
      const windowTop=Math.max(space.floorZ,...(space.openings||[]).filter(o=>/window|glass/.test(o.kind)).map(o=>o.headZ));
      const shelfTop=Math.max(space.floorZ,...(anchors||[]).filter(a=>anchorShape(a)==="side-shelves"&&a.z!=null&&a.size).map(a=>a.z+a.size[2]/2));
      const rise=Math.min(.3,space.ceilingH*.15,ceiling-Math.max(windowTop+.05,shelfTop+.03));
      if(rise>.05){
        const thickness=.025,span=rise+thickness,outer=Array.from({length:13},(_,i)=>{const x=-.5+i/12;return [x,(-rise*4*x*x)/span+.5];});
        const inner=outer.map(([x,y])=>[x,y-thickness/span]).reverse();
        replace.add(roof.id);parts.push({...roof,name:roomPrefix+"curved ceiling",kind:"prism",material:"busPaint",basis:"design",
          position:[(bounds.x0+bounds.x1)/2,(bounds.y0+bounds.y1)/2,ceiling+thickness-span/2],size:[cross,span,run],rotation:[Math.PI/2,0,alongY?0:Math.PI/2],footprint:outer.concat(inner)});
      }
    }
    const driver=(anchors||[]).find(a=>/\bdriver\b/i.test(a.name)&&/\bdash\b/i.test(a.name));
    const driverBase=driver&&!driver.renderShape&&scene.objects.find(o=>o.anchorId===driver.id);
    if(driverBase){
      replace.add(driverBase.id);const [w,d,h]=driverBase.size;
      emit(driverBase,"seat","driver seat",[0,-d*.16,-h*.10],[w*.60,d*.42,h*.10],"busVinyl",true);
      emit(driverBase,"back","driver backrest",[0,-d*.39,h*.13],[w*.60,d*.09,h*.67],"busVinyl",true);
      emit(driverBase,"pedestal","seat pedestal",[0,-d*.16,-h*.32],[w*.18,d*.18,h*.34],"busMetal");
      emit(driverBase,"dash","dashboard",[0,d*.34,h*.10],[w,d*.32,h*.32],"busRubber");
      emit(driverBase,"panel","instrument panel",[0,d*.17,h*.18],[w*.82,d*.025,h*.15],"busMetal");
      emit(driverBase,"wheel","steering wheel",[w*.05,d*.06,h*.20],[w*.34,w*.34,h*.035],"busRubber",false,{kind:"torus",rotation:[Math.PI/2+.2,0,driverBase.rotation[2]]});
    }
    const rear=(anchors||[]).find(a=>/emergency.*door|rear.*door/i.test(a.name)),rearOpening=rear&&(space.openings||[]).find(o=>o.id===rear.id);
    if(rearOpening&&!rear.renderShape&&!partPoses?.[rear.id]){
      const poly=space.footprint,a=poly[rearOpening.edge],b=poly[(rearOpening.edge+1)%poly.length];
      const area=poly.reduce((n,p,i)=>{const q=poly[(i+1)%poly.length];return n+p[0]*q[1]-q[0]*p[1];},0);
      const height=rearOpening.headZ-rearOpening.sillZ,depth=Math.min(.08,rear.size?.[1]||.06);
      const base={id:"bus-rear-door",anchorId:rear.id,name:rear.name,position:[...rearOpening.centre,(rearOpening.sillZ+rearOpening.headZ)/2],size:[rearOpening.width,depth,height],rotation:[0,0,Math.atan2(b[1]-a[1],b[0]-a[0])+(area<0?Math.PI:0)]};
      emit(base,"leaf","door leaf",[0,0,0],base.size,"busPaint");
      emit(base,"release","release handle",[0,depth*.55,0],[rearOpening.width*.55,.015,.025],"busRed");
    }
    for(const side of ["L","R"]){
      const t=template[side],band=(anchors||[]).find(a=>/window/.test(a.id)&&new RegExp(side==="L"?"west":"east","i").test(a.id));
      if(!band?.xy||!band.size)continue;
      const opening=(space.openings||[]).find(o=>o.id===band.id);if(!opening)continue;
      const z=opening.sillZ,top=opening.headZ;
      for(let i=0;i<=count;i++){
        const at=station(t,i+.5),position=[...at];
        if(Math.abs(band.xy[0]-bounds.x0)<.2||Math.abs(band.xy[0]-bounds.x1)<.2)position[0]=band.xy[0];else position[1]=band.xy[1];
        const base={id:"bus-window-"+side+i,name:"Side window pillar",position:[position[0],position[1],(z+top)/2],rotation:[0,0,t.usual.rotation[2]]};
        emit(base,"frame","row division",[0,0,0],[.045,.045,top-z],"busPaint");
      }
    }
    const fitting=(anchors||[]).find(a=>/fluorescent|(?:light|lamp).*(?:strip|line)|(?:strip|line).*(?:light|lamp)/i.test(a.name)),lightBase=fitting&&!fitting.renderShape&&scene.objects.find(o=>o.anchorId===fitting.id);
    if(lightBase){
      replace.add(lightBase.id);const [w,d,h]=lightBase.size,alongY=d>=w,run=Math.max(w,d),modules=Math.max(1,Math.min(8,Math.ceil(run/1.75)));
      const original=scene.previewLights.filter(l=>Math.abs(l.position[0]-(bounds.x0+bounds.x1)/2)<.01&&Math.abs(l.position[1]-(bounds.y0+bounds.y1)/2)<.01&&Math.abs(l.position[2]-(ceiling-.15))<.01);
      scene.previewLights=scene.previewLights.filter(l=>!original.includes(l));const slots=Math.min(modules,16-scene.previewLights.length),power=original.reduce((n,l)=>n+l.powerWatts,0)||200;
      for(let i=0;i<modules;i++){
        const offset=(i-(modules-1)/2)*run/modules,at=alongY?[0,offset,0]:[offset,0,0],extent=run/modules*.88;
        emit(lightBase,"case"+i,"strip housing",[at[0],at[1],h*.225],alongY?[w,extent,h*.55]:[extent,d,h*.55],"busMetal");
        emit(lightBase,"diffuser"+i,"strip diffuser",[at[0],at[1],-h*.4],alongY?[w*.82,extent*.95,h*.18]:[extent*.95,d*.82,h*.18],"busLamp");
      }
      for(let i=0;i<slots;i++){
        const offset=(i-(slots-1)/2)*run/slots,angle=lightBase.rotation[2],x=alongY?0:offset,y=alongY?offset:0;
        scene.previewLights.push({position:[lightBase.position[0]+x*Math.cos(angle)-y*Math.sin(angle),lightBase.position[1]+x*Math.sin(angle)+y*Math.cos(angle),lightBase.position[2]-h*.6],
          colour:original[0]?.colour||[1,.92,.8],powerWatts:power/slots,sizeMetres:Math.min(.8,run/modules)});
      }
    }
    scene.objects=scene.objects.filter(o=>!replace.has(o.id)).concat(parts);
    scene.notes.push("Bus interior profile v1: "+count+" bench rows per side and "+pitch+" m row pitch come from the written brief. Named story benches retain their saved positions and bounds; remaining rows repeat that measured pattern. Footprint, openings and camera poses are retained.");
    scene.notes.push("Bench cushions, metal supports, driver controls, window pillars, curved roof drop and sections of the stated ceiling-light line are proposed construction detail. Background rows are not new saved anchors. The renderer does not recover geometry from an ideas image.");
    return root.KinolotRenderContract.validateScene(scene);
  }
  // Assemblies replace only an existing anchor. Every component stays inside its saved local envelope;
  // rooms, openings, other anchors and camera poses are never moved to make furniture fit.
  function buildFurniture(source,anchors){
    const byId=new Map((anchors||[]).map(a=>[a.id,a]));
    const supported=["bed","pillow","nightstand","wardrobe","table","chair"];
    const eligible=o=>o.anchorId&&supported.includes(anchorShape(byId.get(o.anchorId)));
    if(!source.objects.some(eligible))return source;
    const scene=JSON.parse(JSON.stringify(source)),objects=[],rich=source.schema===root.KinolotRenderContract.MCP_SCHEMA;
    Object.assign(scene.materials,{
      furnitureWood:{baseColor:[.44,.31,.18],roughness:.68},
      bedLinen:{baseColor:[.72,.73,.66],roughness:.94},
      mattressFabric:{baseColor:[.81,.8,.72],roughness:.94},
      furnitureMetal:{baseColor:[.16,.18,.19],metallic:.45,roughness:.4}
    });
    if(rich){scene.materials.furnitureWood.texture="wood";scene.materials.bedLinen.texture="fabric";scene.materials.mattressFabric.texture="fabric";}
    const roundedFootprint=[[-.4,-.5],[.4,-.5],[.5,-.4],[.5,.4],[.4,.5],[-.4,.5],[-.5,.4],[-.5,-.4]];
    const kinds=new Set();
    for(const base of scene.objects){
      if(!eligible(base)||Math.min(...base.size)<(anchorShape(byId.get(base.anchorId))==="pillow"?.001:.2)){objects.push(base);continue;}
      const shape=anchorShape(byId.get(base.anchorId)),[w,d,h]=base.size;
      kinds.add(shape);let n=0;
      // Fractional offsets are from the saved centre. Rotate offsets with the complete saved transform.
      const part=(label,at,size,material="furnitureWood",soft=false)=>{
        const local=at.map((v,i)=>v*base.size[i]);
        let [x,y,z]=local;const [rx,ry,rz]=base.rotation;
        const y1=y*Math.cos(rx)-z*Math.sin(rx),z1=y*Math.sin(rx)+z*Math.cos(rx);
        const x1=x*Math.cos(ry)+z1*Math.sin(ry),z2=-x*Math.sin(ry)+z1*Math.cos(ry);
        x=x1*Math.cos(rz)-y1*Math.sin(rz);y=x1*Math.sin(rz)+y1*Math.cos(rz);
        const dimensions=size.map((v,i)=>round(v*base.size[i]));
        objects.push({...base,id:(base.id+"-furniture-"+n++).slice(0,100),name:(base.name+" · "+label).slice(0,160),
          kind:soft?(rich?(label==="cover"?"cloth":"cushion"):"prism"):"box",material,position:[base.position[0]+x,base.position[1]+y,base.position[2]+z2].map(round),
          size:dimensions,basis:"design",...(soft&&!rich?{footprint:roundedFootprint.map(p=>p.slice())}:{}),
          ...(rich&&!soft?{bevelMetres:Math.min(.012,...dimensions.map(v=>v*.2))}:{})});
      };
      if(shape==="bed"){
        // The long saved axis is the bed's length; the head is at its negative end before facing rotation.
        const alongY=d>=w,bedPart=(label,at,size,material,soft)=>part(label,alongY?at:[at[1],at[0],at[2]],alongY?size:[size[1],size[0],size[2]],material,soft);
        bedPart("bed frame",[0,0,rich?-.25:-.29],[1,1,rich?.22:.42]);
        if(rich)for(const x of [-.42,.42])for(const y of [-.42,.42])bedPart("bed foot",[x,y,-.43],[.06,.06,.14]);
        bedPart("mattress",[0,.015,rich?-.03:.025],[.94,.94,rich?.22:.21],"mattressFabric",true);
        bedPart("cover",[0,.13,rich?.09:.145],[.95,.71,rich?.08:.03],"bedLinen",true);
        const description=(byId.get(base.anchorId)?.name||"")+" "+(byId.get(base.anchorId)?.placement||"");
        if(!/\b(?:no headboard|without (?:a )?headboard)\b/i.test(description))bedPart("headboard",[0,-.47,0],[1,.06,1]);
        const separatePillow=(anchors||[]).some(a=>{
          if(!a.xy||a.space!==byId.get(base.anchorId)?.space||anchorShape(a)!=="pillow")return false;
          const angle=base.rotation[2],x=a.xy[0]-base.position[0],y=a.xy[1]-base.position[1];
          return Math.abs(Math.cos(angle)*x+Math.sin(angle)*y)<=w/2&&Math.abs(-Math.sin(angle)*x+Math.cos(angle)*y)<=d/2;
        });
        const bare=/\b(?:no pillows?|without (?:a )?pillows?|bare bed)\b/i.test(description);
        if(!separatePillow&&!bare){
          const count=Math.min(w,d)>1.2?2:1;
          for(let i=0;i<count;i++)bedPart("pillow "+(i+1),[(i-(count-1)/2)*.45,-.3,rich?.17:.235],[count===2?.4:.72,.22,rich?.18:.15],"mattressFabric",true);
        }
      }else if(shape==="pillow")part("cushion",[0,0,0],[1,1,1],"mattressFabric",true);
      else if(shape==="table"){
        part("tabletop",[0,0,rich?.4775:.45],[1,1,rich?.045:.1]);
        for(const x of [-.42,.42])for(const y of [-.42,.42])part("leg",[x,y,rich?-.0225:-.05],[rich?Math.min(.10,.04/w):.10,rich?Math.min(.10,.04/d):.10,rich?.955:.90]);
      }else if(shape==="chair"){
        part("seat",[0,.025,-.015],[1,.95,.09]);
        part("backrest",[0,-.45,.25],[1,.10,.5]);
        for(const x of [-.4,.4])for(const y of [-.38,.38])part("leg",[x,y,-.265],[.10,.10,.47]);
      }else{
        // Cabinet shell and inset fronts: an identifiable cupboard/drawer, not an uninterrupted box.
        if(rich){
          for(const side of [-1,1])part("cabinet side",[side*.48,0,0],[.04,.94,1]);
          part("cabinet back",[0,-.45,0],[.92,.04,1]);
          for(const side of [-1,1])part("cabinet shelf",[0,0,side*.475],[.92,.94,.05]);
        }else part("cabinet body",[0,0,0],[1,.94,1]);
        const doors=shape==="wardrobe"?2:1;
        for(let i=0;i<doors;i++){
          const x=doors===2?(i===0?-.245:.245):0;
          part(doors===2?"door "+(i+1):"drawer front",[x,.48,shape==="nightstand"?.19:0],[doors===2?.475:.94,.04,shape==="nightstand"?.48:.94]);
          part("handle",[doors===2?(i===0?-.045:.045):0,.497,shape==="nightstand"?.19:0],[Math.min(.025,.018/w),.006,Math.min(.16,.12/h)],"furnitureMetal");
        }
      }
    }
    if(!kinds.size)return source;
    scene.objects=objects;
    scene.notes.push("Furniture assemblies ("+[...kinds].join(", ")+") follow saved object bounds and facing. Internal proportions, bedding and joinery are proposed design detail, not surveyed furniture. Unsupported or ambiguous objects remain blocks; an explicit Solid block choice disables automatic furniture shaping.");
    return root.KinolotRenderContract.validateScene(scene);
  }
  function buildNets(source,anchors){
    const byId=new Map((anchors||[]).map(a=>[a.id,a]));
    if(!source.objects.some(o=>o.anchorId&&anchorShape(byId.get(o.anchorId))==="sports-net"))return source;
    const scene=JSON.parse(JSON.stringify(source)),objects=[];
    scene.materials.netCord={baseColor:[.035,.045,.05],roughness:.82};
    scene.materials.netTape={baseColor:[.8,.8,.72],roughness:.78};
    for(const base of scene.objects){
      if(!base.anchorId||anchorShape(byId.get(base.anchorId))!=="sports-net"){objects.push(base);continue;}
      const [w,d,h]=base.size,alongX=w>=d,span=Math.max(w,d),depth=Math.min(w,d);
      const meshH=Math.min(h,byId.get(base.anchorId)?.netMeshHeight||.9),meshZ=h/2-meshH/2;
      const pole=Math.max(.001,Math.min(.06,depth,span*.04)),cord=Math.max(.001,Math.min(.012,depth,h*.05)),tape=Math.max(.001,Math.min(.04,h*.08));
      const countX=Math.max(2,Math.min(40,Math.ceil(span/.15))),countZ=Math.max(2,Math.min(16,Math.ceil(meshH/.15)));
      let n=0;
      const part=(label,u,z,width,height,thickness,material)=>{
        let x=alongX?u:0,y=alongX?0:u;
        const [rx,ry,rz]=base.rotation,y1=y*Math.cos(rx)-z*Math.sin(rx),z1=y*Math.sin(rx)+z*Math.cos(rx);
        const x1=x*Math.cos(ry)+z1*Math.sin(ry),z2=-x*Math.sin(ry)+z1*Math.cos(ry);
        x=x1*Math.cos(rz)-y1*Math.sin(rz);y=x1*Math.sin(rz)+y1*Math.cos(rz);
        objects.push({...base,id:(base.id+"-net-"+n++).slice(0,100),name:(base.name+" · "+label).slice(0,160),kind:"box",material,
          size:alongX?[width,thickness,height]:[thickness,width,height],
          position:[base.position[0]+x,base.position[1]+y,base.position[2]+z2].map(round)});
      };
      part("left support",-span/2+pole/2,0,pole,h,pole,"netTape");
      part("right support",span/2-pole/2,0,pole,h,pole,"netTape");
      part("top tape",0,h/2-tape/2,span,tape,cord,"netTape");
      part("bottom cord",0,h/2-meshH+cord/2,span,cord,cord,"netCord");
      for(let i=1;i<countX;i++)part("vertical mesh strand",-span/2+span*i/countX,meshZ,cord,meshH,cord,"netCord");
      for(let i=1;i<countZ;i++)part("horizontal mesh strand",0,h/2-meshH+meshH*i/countZ,span,cord,cord,"netCord");
    }
    scene.objects=objects;
    scene.notes.push("Sports nets use open mesh and supports within saved bounds. Unless Net mesh height is set, the mesh occupies the top 0.9 m (limited to overall height), a proposed design. Spacing and cord thickness are preview detail; review against the intended game.");
    return root.KinolotRenderContract.validateScene(scene);
  }
  function build(source,{space,anchors,allAnchors,brief,partPoses}={}){
    if(source.schema===root.KinolotRenderContract.MCP_SCHEMA){
      if(!root.KinolotSetKitchen)throw Error("The detailed set builder did not load. Refresh before building.");
      source=root.KinolotSetKitchen.build(source,{space,anchors:allAnchors||anchors});
    }
    source=buildBus(source,{space,anchors,brief,partPoses});
    source=buildSideShelves(source,allAnchors||anchors);
    source=buildNets(source,allAnchors||anchors);
    source=buildFurniture(source,allAnchors||anchors);
    const bounds=rectangle(space);
    if(!bounds||!/\b(car|vehicle)[ -]*deck\b/i.test(space.name||"")||bounds.width<6||bounds.length<10)return source;
    const names=new Map((anchors||[]).map(a=>[a.id,(a.id+" "+a.name).toLowerCase()]));
    const find=re=>source.objects.find(o=>o.anchorId&&re.test(names.get(o.anchorId)||""));
    const ramp=find(/stern.*ramp/),lanes=find(/lane.*(line|mark)/);
    if(!ramp||!lanes)return source;
    // The ramp assembly describes a raised ramp; a lowered one (a moving part's state, or a saved flat ramp) keeps its
    // plain slab and the hold keeps the rest of its detail.
    const rampRaised=ramp.size[2]>=1&&ramp.size[2]>ramp.size[1]*2;
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
    if(rampRaised){
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
    }else replace.set(ramp.id,{...ramp,material:"rampGreen"});

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
  root.KinolotSetDetail={build,anchorShape};
})(typeof window!=="undefined"?window:globalThis);
