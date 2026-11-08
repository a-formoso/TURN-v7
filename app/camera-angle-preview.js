/* Interactive layout preview from the exact bounded Blender scene. No account, worker or model calls. */
(function(root){
  "use strict";
  let modulePromise;
  const background=[.28,.43,.57]; // Inspection-only: distinguish unmodelled space from solid surfaces.
  const load=()=>modulePromise||(modulePromise=import(new URL("app/vendor/three/r180/three.module.min.js",root.document.baseURI).href).catch(e=>{modulePromise=null;throw e;}));
  function geometry(T,item){
    let g;
    if(item.kind==="box")g=new T.BoxGeometry(1,1,1);
    else if(item.kind==="cylinder"){g=new T.CylinderGeometry(.5,.5,1,24);g.rotateX(Math.PI/2);}
    else if(item.kind==="torus")g=new T.TorusGeometry(.36,.07,8,24);
    else if(item.kind==="cushion"){
      g=new T.SphereGeometry(.5,32,16);g.rotateX(Math.PI/2);
      const p=g.getAttribute("position");
      for(let i=0;i<p.count;i++){
        const soft=(v,power)=>.5*Math.sign(v)*Math.pow(Math.abs(v*2),power);
        p.setXYZ(i,soft(p.getX(i),.35),soft(p.getY(i),.35),soft(p.getZ(i),.65));
      }
    }else if(item.kind==="cloth"){
      const nx=24,ny=32,positions=[],indices=[];
      for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
        const x=-.5+i/nx,y=-.5+j/ny;
        positions.push(x,y,-.24*Math.pow(Math.abs(x)*2,12)-.24*Math.pow(Math.max(0,-y)*2,12)+.035*Math.sin(x*37+y*19)+.025*Math.sin(y*41-x*12));
      }
      for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i;indices.push(a,a+1,a+nx+2,a,a+nx+2,a+nx+1);}
      g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(positions,3));g.setIndex(indices);
    }
    else if(item.kind==="prism"){
      const shape=new T.Shape(item.footprint.map(p=>new T.Vector2(...p)));
      g=new T.ExtrudeGeometry(shape,{depth:1,steps:1,bevelEnabled:false});
    }else if(item.kind==="wedge"){
      const verts=[[-.5,-.5,-.5],[.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[-.5,.5,.5],[.5,.5,.5]];
      const faces=[[0,2,3,1],[2,4,5,3],[0,4,2],[1,3,5],[0,1,5,4]],positions=[];
      faces.forEach(f=>{for(let i=1;i<f.length-1;i++)for(const k of [f[0],f[i],f[i+1]])positions.push(...verts[k]);});
      g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(positions,3));
    }else throw Error("This shape cannot be previewed.");
    // Match the worker: normalise every primitive's local bounds before applying saved dimensions.
    g.computeBoundingBox();const min=g.boundingBox.min.clone(),span=g.boundingBox.max.clone().sub(min),p=g.getAttribute("position");
    for(let i=0;i<p.count;i++)p.setXYZ(i,(p.getX(i)-min.x)/span.x-.5,(p.getY(i)-min.y)/span.y-.5,(p.getZ(i)-min.z)/span.z-.5);
    p.needsUpdate=true;g.computeBoundingBox();g.computeVertexNormals();return g;
  }
  function sceneFor(T,spec){
    root.KinolotRenderContract.validateScene(spec);
    const scene=new T.Scene(),meshes=[],materials=new Map();scene.background=new T.Color(...background);
    for(const [id,m] of Object.entries(spec.materials))materials.set(id,new T.MeshLambertMaterial({color:new T.Color(...m.baseColor),side:T.DoubleSide,
      emissive:new T.Color(...m.baseColor),emissiveIntensity:m.emissionStrength?Math.min(.6,m.emissionStrength*.1):0}));
    for(const item of spec.objects){
      const mesh=new T.Mesh(geometry(T,item),materials.get(item.material));mesh.name=item.name;
      mesh.position.set(...item.position);mesh.scale.set(...item.size);
      // Blender's XYZ Euler matrix applies Rx, then Ry, then Rz to local coordinates.
      const [x,y,z]=item.rotation,rotation=new T.Matrix4().makeRotationZ(z).multiply(new T.Matrix4().makeRotationY(y)).multiply(new T.Matrix4().makeRotationX(x));
      mesh.quaternion.setFromRotationMatrix(rotation);mesh.userData={id:item.id,anchorId:item.anchorId||""};scene.add(mesh);meshes.push(mesh);
    }
    // Neutral inspection lighting: final light, shadows and material finish remain Blender's job.
    scene.add(new T.AmbientLight(0xffffff,1.5));const key=new T.DirectionalLight(0xffffff,1.2);key.position.set(3,-5,8);scene.add(key);
    scene.updateMatrixWorld(true);
    return {scene,meshes,dispose:()=>{meshes.forEach(m=>m.geometry.dispose());materials.forEach(m=>m.dispose());}};
  }
  function cameraFor(T,pose){
    const finite=n=>typeof n==="number"&&Number.isFinite(n);
    if(!Array.isArray(pose?.position)||pose.position.length!==3||!pose.position.every(finite)
      ||!finite(pose.yaw)||!finite(pose.pitch)||Math.abs(pose.pitch)>89||!finite(pose.lensMm)||pose.lensMm<8||pose.lensMm>200)
      throw Error("Set a valid camera position, direction, tilt and lens.");
    const aspect=16/9,fov=2*Math.atan(36/(2*pose.lensMm*aspect))*180/Math.PI;
    const camera=new T.PerspectiveCamera(fov,aspect,.05,200);camera.filmGauge=36;camera.up.set(0,0,1);camera.position.set(...pose.position);
    const yaw=pose.yaw*Math.PI/180,pitch=pose.pitch*Math.PI/180;
    camera.lookAt(camera.position.clone().add(new T.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch))));
    camera.updateMatrixWorld(true);return camera;
  }
  function openingGuides(plan){
    const spaces=plan?.coordinates?.spaces||[],guides=[];
    for(const space of spaces){
      if(space.openSky)continue;
      for(const saved of space.openings||[]){
        const o=root.locationOpeningHeights?root.locationOpeningHeights(saved,space,plan):saved;
        const a=space.footprint?.[o.edge],b=space.footprint?.[(o.edge+1)%space.footprint.length];
        if(!a||!b||!o.centre||![o.width,o.sillZ,o.headZ].every(Number.isFinite)||o.width<=0||o.headZ<=o.sillZ)continue;
        const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue;
        guides.push({name:o.name||'Unnamed opening',type:o.kind||'opening',room:space.name||'Unnamed room',centre:[...o.centre],
          along:[(b[0]-a[0])/length,(b[1]-a[1])/length],width:o.width,bottom:o.sillZ,top:o.headZ,
          beyond:o.connectsTo?(spaces.find(s=>s.id===o.connectsTo)?.name||'Another space, not modelled here'):'Outside or adjoining space not specified in the floor plan'});
      }
    }
    return guides;
  }
  function imagePoint(canvas,clientX,clientY){
    const r=canvas.getBoundingClientRect(),aspect=canvas.width/canvas.height;
    const w=Math.min(r.width,r.height*aspect),h=w/aspect,left=r.left+(r.width-w)/2,top=r.top+(r.height-h)/2;
    if(!w||!h||clientX<left||clientX>left+w||clientY<top||clientY>top+h)return null;
    return {x:(clientX-left)/w,y:(clientY-top)/h};
  }
  function inspect(T,rig,spec,openings,anchors,pose,x,y){
    const camera=cameraFor(T,pose),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(x*2-1,1-y*2),camera);
    const visible=point=>{const z=point.clone().project(camera).z;return z>=-1&&z<=1;};
    const solid=ray.intersectObjects(rig.meshes,false).find(h=>visible(h.point));
    const holes=[];
    for(const opening of openings){
      const [dx,dy]=opening.along,centre=new T.Vector3(...opening.centre,opening.bottom);
      const plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(-dy,dx,0),centre);
      const point=ray.ray.intersectPlane(plane,new T.Vector3());if(!point||!visible(point))continue;
      const along=(point.x-centre.x)*dx+(point.y-centre.y)*dy;
      if(Math.abs(along)>opening.width/2||point.z<opening.bottom||point.z>opening.top)continue;
      holes.push({opening,distance:point.distanceTo(camera.position)});
    }
    holes.sort((a,b)=>a.distance-b.distance);
    const through=holes.find(h=>!solid||h.distance<solid.distance-.01)?.opening;
    if(solid){const item=spec.objects.find(o=>o.id===solid.object.userData.id),anchor=anchors.find(a=>a.id===item.anchorId);
      return {kind:'object',name:anchor?.name||item.name,part:anchor?.name&&anchor.name!==item.name?item.name:null,type:item.kind,
        dimensions:[...(anchor?.size||item.size)],dimensionsSource:anchor?.size?'saved':'preview',through:through||null,
        description:item.anchorId?'Saved set object; its preview shape may be simplified.':'Modelled set surface.'};}
    if(through)return {kind:'opening',name:through.name,type:through.type,room:through.room,dimensions:[through.width,through.top-through.bottom],beyond:through.beyond};
    return {kind:'background',name:'Unmodelled space',description:'No modelled surface is visible here. The blue background is a preview guide, not an object or a finished exterior.'};
  }
  // Small depth-buffer renderer for devices where WebGL is disabled or unavailable.
  // It uses the same meshes and camera projection; only the inspection shading differs.
  function software(T,rig){
    const vertices=[],colour=new T.Color(),normal=new T.Vector3(),ab=new T.Vector3(),ac=new T.Vector3();
    const key=new T.Vector3(3,-5,8).normalize();
    for(const mesh of rig.meshes){
      const points=mesh.geometry.getAttribute("position"),index=mesh.geometry.index;
      const count=index?index.count:points.count;
      for(let i=0;i<count;i+=3){
        const tri=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(points,index?index.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld));
        normal.crossVectors(ab.subVectors(tri[1],tri[0]),ac.subVectors(tri[2],tri[0])).normalize();
        colour.copy(mesh.material.color).multiplyScalar(.65+.35*Math.abs(normal.dot(key))).convertLinearToSRGB();
        vertices.push({tri:tri.map(v=>new T.Vector4(v.x,v.y,v.z,1)),rgb:[colour.r,colour.g,colour.b].map(v=>Math.round(Math.max(0,Math.min(1,v))*255))});
      }
    }
    const planes=[v=>v.w+v.x,v=>v.w-v.x,v=>v.w+v.y,v=>v.w-v.y,v=>v.w+v.z,v=>v.w-v.z];
    const edge=(a,b,x,y)=>(x-a.x)*(b.y-a.y)-(y-a.y)*(b.x-a.x);
    return {render(canvas,pose,width,height){
      const ctx=canvas.getContext("2d");if(!ctx)throw Error("This browser cannot display the layout preview.");
      // Cap software resolution; the canvas scales to the same panel dimensions.
      const w=Math.min(width,480),h=Math.round(w*height/width),camera=cameraFor(T,pose);
      const matrix=new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      canvas.width=w;canvas.height=h;const frame=ctx.createImageData(w,h),depth=new Float32Array(w*h);depth.fill(Infinity);
      const bg=new T.Color(...background).convertLinearToSRGB();
      for(let i=0;i<w*h;i++){frame.data[i*4]=Math.round(bg.r*255);frame.data[i*4+1]=Math.round(bg.g*255);frame.data[i*4+2]=Math.round(bg.b*255);frame.data[i*4+3]=255;}
      for(const item of vertices){
        let polygon=item.tri.map(v=>v.clone().applyMatrix4(matrix));
        for(const distance of planes){
          const clipped=[];
          for(let i=0;i<polygon.length;i++){
            const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a),db=distance(b);
            if(da>=0)clipped.push(a);
            if((da>=0)!==(db>=0))clipped.push(a.clone().lerp(b,da/(da-db)));
          }
          polygon=clipped;if(polygon.length<3)break;
        }
        if(polygon.length<3)continue;
        const screen=polygon.map(v=>({x:(v.x/v.w+1)*w/2,y:(1-v.y/v.w)*h/2,z:v.z/v.w}));
        for(let i=1;i<screen.length-1;i++){
          const [a,b,c]=[screen[0],screen[i],screen[i+1]],area=edge(a,b,c.x,c.y);if(Math.abs(area)<1e-9)continue;
          const x0=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),x1=Math.min(w-1,Math.ceil(Math.max(a.x,b.x,c.x)));
          const y0=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),y1=Math.min(h-1,Math.ceil(Math.max(a.y,b.y,c.y)));
          for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
            const u=edge(b,c,x+.5,y+.5)/area,v=edge(c,a,x+.5,y+.5)/area,t=1-u-v;
            if(u<0||v<0||t<0)continue;const z=u*a.z+v*b.z+t*c.z,j=y*w+x;
            if(z>=depth[j])continue;depth[j]=z;const at=j*4;frame.data[at]=item.rgb[0];frame.data[at+1]=item.rgb[1];frame.data[at+2]=item.rgb[2];
          }
        }
      }
      ctx.putImageData(frame,0,0);
    }};
  }
  function create(T,spec,{softwareOnly=false,openings=[],anchors=[]}={}){
    const rig=sceneFor(T,spec);let renderer=null,cpu=null,disposed=false;
    function releaseGPU(){if(!renderer)return;renderer.dispose();renderer.forceContextLoss();renderer=null;}
    if(softwareOnly)cpu=software(T,rig);
    else try{
      renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
      renderer.outputColorSpace=T.SRGBColorSpace;renderer.setPixelRatio(1);
    }catch(e){releaseGPU();cpu=software(T,rig);}
    return {
      get mode(){return cpu?"software":"gpu";},
      inspect(pose,x,y){if(disposed)throw Error('This preview was closed.');return inspect(T,rig,spec,openings,anchors,pose,x,y);},
      landmarkVisible(pose,point){
        if(disposed)throw Error('This preview was closed.');
        const camera=cameraFor(T,pose),target=new T.Vector3(...point),delta=target.clone().sub(camera.position),distance=delta.length();
        if(distance<.02)return false;
        const ray=new T.Raycaster(camera.position,delta.normalize(),.01,distance+.025);
        const hit=ray.intersectObjects(rig.meshes,false)[0];
        return !hit||hit.distance>=distance-.025;
      },
      render(canvas,pose,width=640,height=360){
        if(disposed)throw Error("This preview was closed.");
        if(renderer?.getContext?.()?.isContextLost?.()){releaseGPU();cpu=software(T,rig);}
        if(cpu)return cpu.render(canvas,pose,width,height);
        const camera=cameraFor(T,pose);renderer.setSize(width,height,false);renderer.render(rig.scene,camera);
        if(renderer.getContext?.()?.isContextLost?.()){releaseGPU();cpu=software(T,rig);return cpu.render(canvas,pose,width,height);}
        const ctx=canvas.getContext("2d");if(!ctx)throw Error("This browser cannot display the layout preview.");
        canvas.width=width;canvas.height=height;ctx.drawImage(renderer.domElement,0,0,width,height);
      },
      dispose(){if(disposed)return;disposed=true;rig.dispose();releaseGPU();cpu=null;}
    };
  }
  root.KinolotAnglePreview={load,geometry,sceneFor,cameraFor,create,openingGuides,imagePoint};
})(typeof window!=="undefined"?window:globalThis);
