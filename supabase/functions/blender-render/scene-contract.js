/* Data-only cloud set contract. Shared by the browser and render service. */
(function(root){
  "use strict";
  const PANELS=["TL","TR","BL","BR"], SCHEMA="kinolot-blockout-test-v1",MCP_SCHEMA="kinolot-cloud-set-v2";
  function fail(message){throw new Error(message);}
  function obj(v,allowed,label){
    if(!v||typeof v!=="object"||Array.isArray(v))fail("Invalid "+label+".");
    Object.keys(v).forEach(k=>{if(!allowed.includes(k))fail("Unsupported "+label+" field.");});
  }
  function text(v,max,label){if(typeof v!=="string"||!v.length||v.length>max||/[\u0000-\u001f]/.test(v))fail("Invalid "+label+".");}
  function num(v,lo,hi,label){if(typeof v!=="number"||!Number.isFinite(v)||v<lo||v>hi)fail("Invalid "+label+".");}
  function vec(v,n,lo,hi,label){if(!Array.isArray(v)||v.length!==n)fail("Invalid "+label+".");v.forEach(x=>num(x,lo,hi,label));}
  function canonical(v){return Array.isArray(v)?"["+v.map(canonical).join(",")+"]":v&&typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}":JSON.stringify(v);}
  async function hash(v){const bytes=await root.crypto.subtle.digest("SHA-256",new TextEncoder().encode(typeof v==="string"?v:canonical(v)));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,"0")).join("");}
  function polygon(points){
    if(!Array.isArray(points)||points.length<3||points.length>32)fail("A footprint needs 3–32 corners.");
    points.forEach(p=>vec(p,2,-10000,10000,"footprint corner"));
    let area=0;
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];area+=a[0]*b[1]-b[0]*a[1];
      if(Math.hypot(a[0]-b[0],a[1]-b[1])<0.001)fail("A footprint has repeated corners.");
      for(let j=i+2;j<points.length;j++){
        if(i===0&&j===points.length-1)continue;
        const c=points[j],d=points[(j+1)%points.length];
        if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&
          Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&
          Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1])))fail("A footprint crosses itself.");
      }
    }
    if(Math.abs(area)<0.01)fail("A footprint has no usable area.");
    return points;
  }
  function validateScene(s){
    obj(s,["schema","name","units","axes","status","notes","objects","cameras","materials","previewLights","authoring"],"set");
    const detailed=s.schema===MCP_SCHEMA;
    if(![SCHEMA,MCP_SCHEMA].includes(s.schema)||s.units!=="metres")fail("Unsupported set format.");
    if(detailed?s.authoring!=="mcp-procedural-v1":s.authoring!=null)fail("Unsupported set authoring version.");
    text(s.name,160,"set name");
    if(!Array.isArray(s.objects)||s.objects.length<1||s.objects.length>500)fail("A set needs 1–500 shapes.");
    if(!Array.isArray(s.notes)||s.notes.length>40||s.notes.some(x=>typeof x!=="string"||x.length>500))fail("Invalid set notes.");
    obj(s.materials,Object.keys(s.materials||{}),"materials");
    if(Object.keys(s.materials).length>32)fail("Too many materials.");
    Object.values(s.materials).forEach(m=>{obj(m,["baseColor","metallic","roughness","emissionStrength",...(detailed?["texture"]:[])],"material");vec(m.baseColor,3,0,1,"material colour");["metallic","roughness"].forEach(k=>{if(m[k]!=null)num(m[k],0,1,k);});if(m.emissionStrength!=null)num(m.emissionStrength,0,20,"emission");if(m.texture!=null&&!["wood","fabric","plaster","ceramic","laminate","steel"].includes(m.texture))fail("Unsupported material texture.");});
    const ids=new Set();
    s.objects.forEach(o=>{
      obj(o,["id","name","anchorId","basis","position","rotation","size","kind","material","footprint",...(detailed?["bevelMetres"]:[])],"shape");
      text(o.id,100,"shape identity");text(o.name,160,"shape name");
      if(ids.has(o.id))fail("Duplicate shape identity.");ids.add(o.id);
      vec(o.position,3,-10000,10000,"position");vec(o.rotation,3,-8*Math.PI,8*Math.PI,"rotation");vec(o.size,3,0.001,10000,"dimensions");
      if(!["box","cylinder","torus","wedge","prism",...(detailed?["cushion","cloth"]:[])].includes(o.kind))fail("Unsupported shape.");
      if(o.bevelMetres!=null)num(o.bevelMetres,0,Math.min(.1,...o.size.map(n=>n*.3)),"edge radius");
      if(!Object.prototype.hasOwnProperty.call(s.materials,o.material))fail("Unknown material.");
      if(o.kind==="prism"){
        polygon(o.footprint);
        o.footprint.forEach(p=>p.forEach(x=>num(x,-0.5,0.5,"normalised footprint")));
        for(let axis=0;axis<2;axis++)if(Math.abs(Math.min(...o.footprint.map(p=>p[axis]))+0.5)>0.00001||Math.abs(Math.max(...o.footprint.map(p=>p[axis]))-0.5)>0.00001)fail("Footprint bounds must match its dimensions.");
      }else if(o.footprint!=null)fail("Only a floor shape can have a footprint.");
    });
    if(detailed&&s.objects.filter(o=>["cloth","cushion"].includes(o.kind)).length>64)fail("Too many soft furniture parts.");
    obj(s.cameras,PANELS,"cameras");
    if(Object.keys(s.cameras).length!==4)fail("Four camera views are required.");
    PANELS.forEach(k=>{const c=s.cameras[k];obj(c,["position","yaw","pitch","lensMm"],"camera");vec(c.position,3,-10000,10000,"camera position");num(c.yaw,-360,360,"camera facing");num(c.pitch,-89,89,"camera tilt");num(c.lensMm,8,200,"camera lens");});
    if(!Array.isArray(s.previewLights)||s.previewLights.length>16)fail("Too many lights.");
    s.previewLights.forEach(l=>{obj(l,["position","colour","powerWatts","sizeMetres"],"light");vec(l.position,3,-10000,10000,"light position");vec(l.colour,3,0,1,"light colour");num(l.powerWatts,0,5000,"light power");num(l.sizeMetres,0.01,20,"light size");});
    if(new TextEncoder().encode(canonical(s)).length>131072)fail("The set exceeds this preview's size limit.");
    return s;
  }
  root.KinolotRenderContract={PANELS,SCHEMA,MCP_SCHEMA,canonical,hash,validateScene,polygon};
})(typeof window!=="undefined"?window:globalThis);
