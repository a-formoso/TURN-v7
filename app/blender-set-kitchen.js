/* Data-only kitchen assemblies. Saved anchors remain authoritative; no image or executable input. */
(function(root){
  "use strict";
  const kind=a=>{
    if(a?.renderShape)return null; // An explicit shape choice wins.
    const n=String(a?.name||"").split(/\b(?:beside|near|above|under|behind|next to)\b/i)[0];
    if(/\bfolding station\b/i.test(n))return "fold";
    if(/\b(?:counter|countertop)\b/i.test(n)&&!/\b(?:light|lamp)\b/i.test(n))return "counter";
    if(/\bsink\b/i.test(n)&&!/\b(?:light|lamp|counter|run)\b/i.test(n))return "sink";
    if(/\b(?:fridge|refrigerator)\b/i.test(n))return "fridge";
    if(/\bdish\s*rack\b/i.test(n))return "rack";
    if(/\bkettle\b/i.test(n)&&/\bmug\b/i.test(n))return "kettle-tree";
    if(/\bkettle\b/i.test(n))return "kettle";
    if(/\bhamper\b/i.test(n))return "hamper";
    if(/\bcharging dock\b/i.test(n))return "dock";
    if(/\bfluorescent\b/i.test(n)&&/\b(?:tube|light|fitting)\b/i.test(n))return "fluorescent";
    return null;
  };
  function build(source,{anchors=[],space}={}){
    if(source.schema!==root.KinolotRenderContract.MCP_SCHEMA)return source;
    const byId=new Map(anchors.map(a=>[a.id,a])),profile=o=>kind(byId.get(o.anchorId));
    if(!source.objects.some(o=>profile(o))&&!space?.openings?.length)return source;
    const scene=JSON.parse(JSON.stringify(source)),parts=[],used=new Set(),lights=[];
    Object.assign(scene.materials,{
      kitchenFront:{baseColor:[.36,.44,.40],roughness:.73,texture:"laminate"},
      kitchenCounter:{baseColor:[.56,.50,.39],roughness:.72,texture:"laminate"},
      kitchenSteel:{baseColor:[.45,.48,.47],metallic:.75,roughness:.4,texture:"steel"},
      kitchenOat:{baseColor:[.59,.55,.44],roughness:.6},
      kitchenDark:{baseColor:[.06,.065,.06],roughness:.65},
      kitchenCloth:{baseColor:[.45,.42,.34],roughness:.95,texture:"fabric"},
      kitchenCeramic:{baseColor:[.73,.71,.63],roughness:.5,texture:"ceramic"},
      kitchenDiffuser:{baseColor:[.88,.90,.85],roughness:.35,emissionStrength:4}
    });
    const bases=scene.objects,emitted=[];
    const emit=(base,label,at,size,material="kitchenFront",type="box",rotation=[0,0,0],radius=.006)=>{
      if(size.some(n=>!Number.isFinite(n)||n<.001))return;
      let [x,y,z]=at;const [rx,ry,rz]=base.rotation;
      const y1=y*Math.cos(rx)-z*Math.sin(rx),z1=y*Math.sin(rx)+z*Math.cos(rx),x1=x*Math.cos(ry)+z1*Math.sin(ry),z2=-x*Math.sin(ry)+z1*Math.cos(ry);
      x=x1*Math.cos(rz)-y1*Math.sin(rz);y=x1*Math.sin(rz)+y1*Math.cos(rz);
      emitted.push({id:(base.id+"-kitchen-"+emitted.length).slice(0,100),anchorId:base.anchorId,name:(base.name+" · "+label).slice(0,160),
        basis:"design",position:[base.position[0]+x,base.position[1]+y,base.position[2]+z2].map(n=>Math.round(n*1e6)/1e6),
        rotation:[rx+rotation[0],ry+rotation[1],rz+rotation[2]],size,kind:type,material,
        bevelMetres:Math.min(radius,...size.map(n=>n*.2))});
    };
    const localBounds=(base,other)=>{
      const points=[],a=base.rotation[2],b=other.rotation[2];
      for(const u of [-.5,.5])for(const v of [-.5,.5]){
        const x=other.position[0]+Math.cos(b)*u*other.size[0]-Math.sin(b)*v*other.size[1]-base.position[0];
        const y=other.position[1]+Math.sin(b)*u*other.size[0]+Math.cos(b)*v*other.size[1]-base.position[1];
        points.push([Math.cos(a)*x+Math.sin(a)*y,-Math.sin(a)*x+Math.cos(a)*y]);
      }
      return [Math.min(...points.map(p=>p[0])),Math.max(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[1]))];
    };
    for(const base of bases){
      const shape=profile(base),[w,d,h]=base.size;
      if(!shape||Math.min(w,d,h)<.05||Math.abs(base.rotation[0])>.001||Math.abs(base.rotation[1])>.001){parts.push(base);continue;}
      const start=emitted.length,top=h/2;
      if(shape==="counter"){
        const cuts=[];
        for(const other of bases){
          if(other===base)continue;
          const p=profile(other);
          if(!["sink","fold","counter"].includes(p)||p==="counter"&&bases.indexOf(other)>bases.indexOf(base))continue;
          if(Math.abs(other.position[2]+other.size[2]/2-(base.position[2]+top))>.10)continue;
          const [a,b,c,e]=localBounds(base,other),rect=[Math.max(-w/2,a),Math.min(w/2,b),Math.max(-d/2,c),Math.min(d/2,e)];
          if(rect[1]-rect[0]>.001&&rect[3]-rect[2]>.001)cuts.push({rect,lower:p!=="sink"});
        }
        const xs=[...new Set([-w/2,w/2,...cuts.flatMap(c=>c.rect.slice(0,2))])].sort((a,b)=>a-b);
        const ys=[...new Set([-d/2,d/2,...cuts.flatMap(c=>c.rect.slice(2))])].sort((a,b)=>a-b);
        const contains=(r,x,y)=>x>r[0]-.00001&&x<r[1]+.00001&&y>r[2]-.00001&&y<r[3]+.00001;
        const thick=Math.min(.035,h*.08),doorBottom=-h/2+.10,carcassTop=top-thick;
        for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++){
          const x=(xs[i-1]+xs[i])/2,y=(ys[j-1]+ys[j])/2;
          if(!cuts.some(c=>contains(c.rect,x,y)))emit(base,"countertop",[x,y,top-thick/2],[xs[i]-xs[i-1],ys[j]-ys[j-1],thick],"kitchenCounter");
        }
        const count=Math.max(1,Math.min(24,Math.ceil(w/.55))),step=w/count;
        for(let i=0;i<count;i++){
          const a=-w/2+i*step,b=a+step,x=(a+b)/2;
          // Leave a saved folding kneespace and occupied L-corner open.
          if(cuts.some(c=>c.lower&&c.rect[0]<b-.001&&c.rect[1]>a+.001))continue;
          const doorTop=carcassTop-.003,height=doorTop-doorBottom;
          emit(base,"cabinet bottom",[x,0,-h/2+.065],[step-.006,d-.025,.025]);
          emit(base,"cabinet back",[x,-d/2+.012,(carcassTop-h/2+.05)/2],[step-.006,.018,carcassTop+h/2-.05]);
          for(const side of [-1,1])emit(base,"cabinet side",[x+side*(step/2-.012),0,(carcassTop-h/2+.05)/2],[.018,d-.025,carcassTop+h/2-.05]);
          emit(base,"backed front reveal",[x,d/2-.025,carcassTop-.02],[step-.006,.03,.04]);
          emit(base,"cabinet door",[x,d/2-.0125,(doorTop+doorBottom)/2],[step-.018,.025,height]);
          emit(base,"bar pull",[x,d/2-.002,doorTop-.135],[Math.min(.12,step*.5),.004,.012],"kitchenSteel");
        }
      }else if(shape==="sink"){
        const t=Math.min(.012,w*.04,d*.04);
        emit(base,"basin bottom",[0,0,-top+t/2],[w,d,t],"kitchenSteel");
        for(const x of [-1,1])emit(base,"basin side",[x*(w-t)/2,0,0],[t,d,h],"kitchenSteel");
        for(const y of [-1,1])emit(base,"basin end",[0,y*(d-t)/2,0],[w,t,h],"kitchenSteel");
        for(const x of [-1,1])emit(base,"rim",[x*(w-t)/2,0,top-t/2],[t*2,d,t],"kitchenSteel");
        for(const y of [-1,1])emit(base,"rim",[0,y*(d-t)/2,top-t/2],[w,t*2,t],"kitchenSteel");
        emit(base,"tap upright",[0,-d*.36,top+.10],[.024,.024,.20],"kitchenSteel","cylinder");
        emit(base,"tap neck",[0,-d*.20,top+.20],[.024,d*.32,.024],"kitchenSteel");
        for(const x of [-1,1])emit(base,"tap control",[x*w*.17,-d*.36,top+.02],[.045,.045,.04],"kitchenSteel","cylinder");
      }else if(shape==="fold"){
        emit(base,"clear folding top",[0,0,top-.0175],[w,d,.035],"kitchenCounter");
        for(const side of [-1,1])emit(base,"support",[side*(w/2-.02),d/2-.03,-.0175],[.025,.04,h-.035],"kitchenDark");
      }else if(shape==="fridge"){
        emit(base,"fridge body",[0,-d*.02,0],[w,d*.96,h],"kitchenOat","box",[0,0,0],.025);
        for(const [lo,hi] of [[-.49,.19],[.20,.49]]){
          emit(base,"fridge door",[0,d*.48,(lo+hi)*h/2],[w*.98,d*.04,(hi-lo)*h],"kitchenOat","box",[0,0,0],.018);
          emit(base,"handle",[w*.32,d*.495,(lo+.16)*h],[Math.min(.016,w*.04),d*.01,Math.min(.20,(hi-lo)*h*.4)],"kitchenDark");
        }
      }else if(shape==="rack"){
        for(const side of [-1,1])emit(base,"rack rail",[0,side*d*.40,-h*.40],[w,.005,.005],"kitchenSteel");
        for(let i=0;i<4;i++){
          const x=(i-1.5)*w*.22;
          emit(base,"plate "+(i+1),[x,0,0],[h*.9,h*.9,.009],"kitchenCeramic","cylinder",[0,Math.PI/2,0]);
          emit(base,"rack wire",[x,0,-h*.4],[.004,d*.9,.004],"kitchenSteel");
        }
      }else if(shape==="kettle"||shape==="kettle-tree"){
        const kw=shape==="kettle-tree"?w*.45:w,kx=shape==="kettle-tree"?-w*.25:0,kh=h*.8;
        emit(base,"kettle body",[kx,0,-top+kh/2],[kw*.75,d*.75,kh],"kitchenSteel","cylinder");
        emit(base,"kettle lid",[kx,0,-top+kh],[kw*.72,d*.72,.012],"kitchenDark","cylinder");
        emit(base,"kettle handle",[kx,d*.36,0],[kw*.6,.018,h*.5],"kitchenDark","torus",[Math.PI/2,0,0]);
        if(shape==="kettle-tree"){
          emit(base,"mug stand",[w*.25,0,-top+.01],[w*.4,d*.8,.02],"dressing","cylinder");
          emit(base,"mug stem",[w*.25,0,0],[.012,.012,h],"dressing","cylinder");
          for(let i=0;i<4;i++)emit(base,"mug "+(i+1),[w*.25+(i%2?1:-1)*w*.12,(i<2?1:-1)*d*.20,(i%2?-.1:.15)*h],[w*.14,w*.14,h*.22],"kitchenCeramic","cylinder");
        }
      }else if(shape==="hamper"){
        emit(base,"hamper base",[0,0,-top+.01],[w,d,.02],"kitchenCloth");
        for(const side of [-1,1]){
          emit(base,"fabric side",[side*(w/2-.006),0,0],[.012,d,h],"kitchenCloth");
          emit(base,"fabric end",[0,side*(d/2-.006),0],[w,.012,h],"kitchenCloth");
        }
      }else if(shape==="dock"){
        emit(base,"dock body",[0,0,0],[w,d,h],"kitchenOat","box",[0,0,0],.02);
        emit(base,"contacts",[0,d*.30,top-.003],[w*.5,d*.10,.006],"kitchenDark");
      }else if(shape==="fluorescent"){
        emit(base,"light housing",[0,0,h*.10],[w,d,h*.8],"kitchenOat");
        emit(base,"diffuser",[0,0,-h*.40],[w*.94,d*.75,h*.20],"kitchenDiffuser");
        lights.push({position:[base.position[0],base.position[1],base.position[2]-h/2-.01],colour:[.86,.90,1],powerWatts:160,sizeMetres:Math.max(.1,Math.min(3,w*.75))});
      }
      if(emitted.length===start)parts.push(base);else used.add(shape);
    }
    if(space?.footprint?.length)for(const [index,opening] of (space.openings||[]).entries()){
      if(!["window","glass","door","arch"].includes(opening.kind))continue;
      const a=space.footprint[opening.edge],b=space.footprint[(opening.edge+1)%space.footprint.length];
      if(!a||!b||!opening.centre)continue;
      const width=opening.width,height=opening.headZ-opening.sillZ;
      if(!(width>.08&&height>.08))continue;
      const base={id:"opening-detail-"+index,anchorId:opening.id||"opening-"+index,name:opening.name||"Opening",
        position:[...opening.centre,(opening.sillZ+opening.headZ)/2],rotation:[0,0,Math.atan2(b[1]-a[1],b[0]-a[0])]};
      for(const side of [-1,1])emit(base,"frame jamb",[side*(width/2+.02),0,0],[.04,.08,height+.04],"kitchenOat");
      emit(base,"frame head",[0,0,height/2+.02],[width+.08,.08,.04],"kitchenOat");
      if(["window","glass"].includes(opening.kind)){
        emit(base,"window sill",[0,0,-height/2-.02],[width+.12,.18,.04],"kitchenOat");
        emit(base,"window crossbar",[0,0,0],[width,.04,.025],"kitchenOat");
      }
    }
    scene.objects=parts.concat(emitted);
    const referenced=new Set(scene.objects.map(o=>o.material));
    for(const name of ["kitchenFront","kitchenCounter","kitchenSteel","kitchenOat","kitchenDark","kitchenCloth","kitchenCeramic","kitchenDiffuser"])
      if(!referenced.has(name))delete scene.materials[name];
    if(lights.length){
      if(space){const xs=space.footprint.map(p=>p[0]),ys=space.footprint.map(p=>p[1]);scene.previewLights=scene.previewLights.filter(l=>!(l.position[0]>=Math.min(...xs)&&l.position[0]<=Math.max(...xs)&&l.position[1]>=Math.min(...ys)&&l.position[1]<=Math.max(...ys)));}
      scene.previewLights.push(...lights);
    }
    if(used.size)scene.notes.push("Kitchen assemblies ("+[...used].join(", ")+") derive from saved anchor transforms. Tap height, cabinet modules, four plates and four mugs are proposed construction detail. Unspecified appliances and visible light fittings are not added. Review saved dimensions and facing; this does not adopt the isolated trial's layout.");
    if(space?.openings?.length)scene.notes.push("Opening frames follow saved wall apertures; casing thickness and window crossbars are proposed detail. An open doorway remains open; no door leaf or exterior scenery is inferred.");
    return root.KinolotRenderContract.validateScene(scene);
  }
  root.KinolotSetKitchen={build,kind};
})(typeof window!=="undefined"?window:globalThis);
