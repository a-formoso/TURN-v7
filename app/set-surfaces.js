/* SURFACES FOR THE SET IN 3D (owner 2026-11-23: "make it look much better, more realistic, so it doesn't look like a
   lazy, boring 3D set that people can't picture ... I don't want just a bunch of boxes ... they should be able to
   see what they're looking at without guessing"). The owner's own demo of the location card drew one house by hand
   with painted surfaces; our sets are built for any place from its floor plan and dressing, so each shape here gets
   the surface its own material names: brick with mortar, planks, tile, carpet, grass, tarmac, paving, slate, glass
   that mirrors the sky, metal, painted walls with a grain. Every surface is painted in code from the material's own
   colour (no image file, no model call) and laid at its real size in metres, whatever the shape's size.
   Used by every Colour drawing of a set since 2026-11-24 (the location card, the Previs sheet, a shot's drawing):
   set-previs.js build(); {surfaces:false} asks for flat colours. Clay and Depth never use them.
     kindOf(id, name)                 → which surface a material is, from its id and the object's name
     material(T, id, m, env)          → a three.js material for one of the set's materials
     layUV(T, geometry, size)         → lays the surface at real size on a shape (its size in metres)
     sky(T, renderer, colour)         → {texture (what glass and metal mirror), dome (the sky itself), dispose()}
     mannequin(T, height, colour)     → a jointed stand-in person, standing at the origin, Z up
   Painted canvases are kept for the whole tab (they are the slow part); textures and materials belong to one view. */
(function(root){
  "use strict";
  /* ---- deterministic random: a surface looks the same every time it is drawn ---- */
  const rng=seed=>()=>{ seed=(seed+0x6D2B79F5)|0; let t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
  const hash=s=>{ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h|0; };

  /* WHICH SURFACE: the first rule the material's id matches (the dressing names its materials: d_brick, d2_lam,
     d_upvc ...), then the object's own name for the builder's plain "floor" and "wall". */
  const RULES=[
    // the furniture kit's own materials (set-kit.js): bedding, book spines, a worktop, a dark plinth
    [/^kit_(linen|cover)/,"fabric"],[/^kit_book/,"paper"],[/^kit_worktop/,"gloss"],[/^kit_dark/,"plain"],
    [/lampglass|shade|bulb/,"lamp"],[/glass|glaz/,"glass"],
    [/brick|stock/,"brick"],[/slate|rooftile|roof/,"slate"],[/asphalt|tarmac|road/,"asphalt"],
    [/slab|pav|flag/,"slab"],[/conc|coping|kerb|stone|cement|render/,"concrete"],
    [/grass|lawn|turf/,"grass"],[/privet|hedge|leaf|foliage|bush|ivy|shrub/,"hedge"],[/mud|soil|earth|dirt/,"mud"],
    [/lino|vinyl|tile/,"tile"],[/lam$|lam_|laminate|parquet|plank|floorboard|decking/,"planks"],
    [/wicker|rattan|basket/,"wicker"],[/oak|wood|pine|timber|walnut|mahog|teak|beech|ply/,"wood"],
    [/carpet|rug|runner|mat$|_mat_|hallf/,"carpet"],[/net$|voile|lace/,"net"],
    [/silk|linen|fabric|shirt|cloth|cotton|wool|velvet|curtain|denim|blanket|towel|cushion|sofa|upholst/,"fabric"],
    [/chrome|steel|metal|alu|brass|iron|copper|zinc/,"metal"],
    [/upvc|gloss|enamel|plastic|rad$|white|door|bin|car$/,"gloss"],
    [/magnolia|wall|hallw|cream|ceil|paint|plaster|oat/,"paint"],[/paper|card|photo|board/,"paper"]];
  function kindOf(id,name){
    // (a kit piece's darker tone of a material, "<material>_kitshade", is that material's own surface)
    const s=String(id||"").toLowerCase().replace(/_kitshade$/,"").replace(/^d\d*_/,"");
    for(const r of RULES) if(r[0].test(s)) return r[1];
    const n=String(name||"").toLowerCase();
    if(/\bfloor\b/.test(n)) return "planks";
    if(/\b(wall|ceiling)\b/.test(n)) return "paint";
    return "plain";
  }

  /* ---- painting ---- */
  const canvases=new Map();
  function canvas(key,w,h,draw){
    let c=canvases.get(key); if(c) return c;
    c=root.document.createElement("canvas"); c.width=w; c.height=h; draw(c.getContext("2d"),w,h,rng(hash(key))); canvases.set(key,c); return c;
  }
  // a colour of the set (linear r, g, b) as hue, saturation and lightness on screen
  function hsl(T,rgb){ const o={}; new T.Color(rgb[0],rgb[1],rgb[2]).getHSL(o,T.SRGBColorSpace); return {h:o.h*360,s:o.s*100,l:o.l*100}; }
  const css=(c,dl,ds,dh)=>"hsl("+((c.h+(dh||0)+360)%360).toFixed(1)+","+Math.max(0,Math.min(100,c.s+(ds||0))).toFixed(1)+"%,"+Math.max(2,Math.min(97,c.l+(dl||0))).toFixed(1)+"%)";
  const speckle=(g,w,h,r,n,a,max)=>{ for(let i=0;i<n;i++){ const v=r()<0.5?0:255; g.fillStyle="rgba("+v+","+v+","+v+","+(r()*a)+")"; const s=1+r()*(max||2); g.fillRect(r()*w,r()*h,s,s); } };
  const between=(r,a,b)=>a+(b-a)*r();
  /* Each painter returns {map: [canvas, metres across, metres up], bump?: [canvas, m, m, strength], rough, metal,
     mirror (how much it mirrors the sky), glow?}. c = the material's own colour. */
  const PAINT={
    brick(c,key){ const W=1024,H=608,bw=128,bh=38;
      const bump=canvas(key+"#b",W,H,(b,w,h,r)=>{ b.fillStyle="#4a4a4a"; b.fillRect(0,0,w,h);
        for(let row=0;row<16;row++){ const off=row%2?bw/2:0; for(let i=0;i<8;i++){ const lv=Math.floor(between(r,170,215)), x=i*bw+off;
          [x,x-W].forEach(px=>{ b.fillStyle="rgb("+lv+","+lv+","+lv+")"; b.fillRect(px+3,row*bh+3,bw-6,bh-6); }); } } speckle(b,w,h,r,12000,0.2,2); });
      const map=canvas(key,W,H,(g,w,h,r)=>{ g.fillStyle=css({h:38,s:8,l:Math.max(46,Math.min(66,c.l+18))},0); g.fillRect(0,0,w,h);
        for(let row=0;row<16;row++){ const off=row%2?bw/2:0; for(let i=0;i<8;i++){ const k=r(), x=i*bw+off;
          const fill=k<0.06?css(c,-9,-6,-4):k<0.14?css(c,8,-4,6):css(c,between(r,-4,4),between(r,-5,5),between(r,-3,3));
          [x,x-W].forEach(px=>{ g.fillStyle=fill; g.fillRect(px+2.5,row*bh+2.5,bw-5,bh-5); }); } }
        speckle(g,w,h,r,26000,0.16,2.5);
        for(let i=0;i<40;i++){ g.fillStyle="rgba(30,26,22,"+between(r,0.02,0.07)+")"; g.fillRect(r()*w,r()*h,between(r,40,220),between(r,20,120)); } });
      return {map:[map,1.8,1.2],bump:[bump,1.8,1.2,1.2],rough:0.95}; },
    slate(c,key){ const map=canvas(key,512,512,(g,w,h,r)=>{ g.fillStyle=css(c,-6); g.fillRect(0,0,w,h); const th=h/6,tw=w/5;
        for(let row=0;row<6;row++) for(let i=-1;i<5;i++){ const x=i*tw+(row%2?tw/2:0); g.fillStyle=css(c,between(r,-4,5),between(r,-4,4));
          g.fillRect(x+1,row*th+1,tw-2,th-3); if(x+tw>w) g.fillRect(x-w+1,row*th+1,tw-2,th-3); g.fillStyle="rgba(0,0,0,0.3)"; g.fillRect(x,row*th+th-5,tw,5); }
        speckle(g,w,h,r,9000,0.2,3); });
      return {map:[map,1.5,1.9],rough:0.85}; },
    asphalt(c,key){ const map=canvas(key,1024,1024,(g,w,h,r)=>{ g.fillStyle=css(c,6); g.fillRect(0,0,w,h); speckle(g,w,h,r,60000,0.22,3);
        for(let i=0;i<14;i++){ g.fillStyle="rgba("+(r()<0.5?"20,20,22":"120,120,120")+","+between(r,0.05,0.14)+")"; g.fillRect(r()*w,r()*h,between(r,60,320),between(r,40,200)); }
        g.strokeStyle="rgba(20,20,20,0.35)"; g.lineWidth=1.5;
        for(let i=0;i<6;i++){ let x=r()*w,y=r()*h; g.beginPath(); g.moveTo(x,y); for(let k=0;k<8;k++){ x+=between(r,-40,60); y+=between(r,-30,40); g.lineTo(x,y); } g.stroke(); } });
      const bump=canvas("noise#30000",512,512,(g,w,h,r)=>{ g.fillStyle="#808080"; g.fillRect(0,0,w,h); speckle(g,w,h,r,30000,0.6,2.5); });
      return {map:[map,6,6],bump:[bump,1.5,1.5,0.8],rough:0.95}; },
    slab(c,key){ const map=canvas(key,1024,682,(g,w,h,r)=>{ g.fillStyle=css(c,-10); g.fillRect(0,0,w,h); const sw=w/3,sh=h/2;
        for(let row=0;row<2;row++) for(let i=-1;i<3;i++){ const x=i*sw+(row?sw/2:0); g.fillStyle=css(c,between(r,-3,4));
          g.fillRect(x+2,row*sh+2,sw-4,sh-4); if(x+sw>w) g.fillRect(x-w+2,row*sh+2,sw-4,sh-4); }
        speckle(g,w,h,r,30000,0.14,3);
        for(let i=0;i<18;i++){ g.fillStyle="rgba(40,38,34,"+between(r,0.03,0.09)+")"; g.beginPath(); g.ellipse(r()*w,r()*h,between(r,10,60),between(r,8,40),r()*3,0,6.3); g.fill(); } });
      return {map:[map,1.8,1.2],rough:0.95}; },
    concrete(c,key){ const map=canvas(key,512,512,(g,w,h,r)=>{ g.fillStyle=css(c,0); g.fillRect(0,0,w,h); speckle(g,w,h,r,26000,0.26,3);
        for(let i=0;i<10;i++){ g.fillStyle="rgba(30,30,28,"+between(r,0.02,0.06)+")"; g.beginPath(); g.ellipse(r()*w,r()*h,between(r,20,90),between(r,14,60),r()*3,0,6.3); g.fill(); } });
      return {map:[map,1.4,1.4],rough:0.97}; },
    grass(c,key){ const map=canvas(key,512,512,(g,w,h,r)=>{ g.fillStyle=css(c,2); g.fillRect(0,0,w,h);
        for(let i=0;i<60;i++){ g.fillStyle=css(c,between(r,-5,6),between(r,-10,8),between(r,-8,10)).replace("hsl","hsla").replace(")",",0.25)"); g.beginPath(); g.ellipse(r()*w,r()*h,between(r,20,80),between(r,14,60),r()*3,0,6.3); g.fill(); }
        for(let i=0;i<9000;i++){ g.strokeStyle=css(c,between(r,-8,14),between(r,-10,12),between(r,-10,14)); g.lineWidth=between(r,0.6,1.6);
          const x=r()*w,y=r()*h,a=between(r,-0.6,0.6)-1.57,l=between(r,3,9); g.beginPath(); g.moveTo(x,y); g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l); g.stroke(); } });
      const bump=canvas("noise#grass",256,256,(g,w,h,r)=>{ g.fillStyle="#808080"; g.fillRect(0,0,w,h); speckle(g,w,h,r,16000,0.7,3); });
      return {map:[map,1.6,1.6],bump:[bump,0.5,0.5,1.4],rough:1}; },
    hedge(c,key){ const map=canvas(key,512,512,(g,w,h,r)=>{ g.fillStyle=css(c,-4); g.fillRect(0,0,w,h);
        for(let i=0;i<5200;i++){ g.fillStyle=css(c,between(r,-7,16),between(r,-10,14),between(r,-10,12)); g.beginPath(); g.ellipse(r()*w,r()*h,between(r,3,7),between(r,1.5,3.5),r()*3.14,0,6.3); g.fill(); } });
      const bump=canvas("noise#hedge",256,256,(g,w,h,r)=>{ g.fillStyle="#707070"; g.fillRect(0,0,w,h); for(let i=0;i<1400;i++){ const v=Math.floor(between(r,90,255)); g.fillStyle="rgb("+v+","+v+","+v+")"; g.beginPath(); g.ellipse(r()*w,r()*h,between(r,3,8),between(r,2,5),r()*3.14,0,6.3); g.fill(); } });
      return {map:[map,0.9,0.9],bump:[bump,0.5,0.5,3],rough:1}; },
    mud(c,key){ const map=canvas(key,512,512,(g,w,h,r)=>{ g.fillStyle=css(c,2); g.fillRect(0,0,w,h);
        for(let i=0;i<90;i++){ g.fillStyle=css(c,between(r,-6,7),between(r,-8,6)).replace("hsl","hsla").replace(")",",0.5)"); g.beginPath(); g.ellipse(r()*w,r()*h,between(r,10,70),between(r,8,40),r()*3,0,6.3); g.fill(); }
        speckle(g,w,h,r,20000,0.2,3); });
      return {map:[map,1.5,1.5],rough:0.85}; },
    tile(c,key){ const map=canvas(key,256,256,(g,w,h,r)=>{ g.fillStyle=css(c,-14,-6); g.fillRect(0,0,w,h);
        for(let i=0;i<2;i++) for(let j=0;j<2;j++){ g.fillStyle=css(c,between(r,-1.5,2.5)); g.fillRect(i*128+2,j*128+2,124,124); } speckle(g,w,h,r,2500,0.06,2); });
      return {map:[map,0.6,0.6],rough:0.3,mirror:0.25}; },
    planks(c,key){ const map=canvas(key,1024,1024,(g,w,h,r)=>{ const ph=h/8;
        for(let row=0;row<8;row++){ const off=r()*w;
          for(let s=0;s<2;s++){ const x0=off+s*w/2, dl=between(r,-5,5), dh=between(r,-3,3);
            [x0,x0-w].forEach(x=>{ g.fillStyle=css(c,dl,between(r,-2,2),dh); g.fillRect(x,row*ph,w/2,ph);
              g.save(); g.beginPath(); g.rect(x,row*ph,w/2,ph); g.clip();
              for(let i=0;i<46;i++){ g.strokeStyle="rgba("+(r()<0.5?"60,40,20":"235,215,180")+","+between(r,0.03,0.12)+")"; g.lineWidth=between(r,0.5,2.2); const y=row*ph+r()*ph;
                g.beginPath(); g.moveTo(x,y); g.bezierCurveTo(x+w/6,y+between(r,-5,5),x+w/3,y+between(r,-5,5),x+w/2,y+between(r,-3,3)); g.stroke(); }
              g.restore(); g.fillStyle="rgba(25,16,8,0.55)"; g.fillRect(x,row*ph,2,ph); }); }
          g.fillStyle="rgba(25,16,8,0.5)"; g.fillRect(0,row*ph,w,2); } });
      return {map:[map,2.4,1.52],rough:0.55,mirror:0.12}; },
    wood(c,key){ const map=canvas(key,512,512,(g,w,h,r)=>{ g.fillStyle=css(c,0); g.fillRect(0,0,w,h);
        for(let i=0;i<260;i++){ g.strokeStyle="rgba("+(r()<0.5?"70,45,20":"240,215,170")+","+between(r,0.04,0.14)+")"; g.lineWidth=between(r,0.6,2.5); const y=r()*h;
          g.beginPath(); g.moveTo(0,y); g.bezierCurveTo(w/3,y+between(r,-8,8),2*w/3,y+between(r,-8,8),w,y); g.stroke(); } });
      return {map:[map,1.2,0.6],rough:0.6}; },
    wicker(c,key){ const map=canvas(key,256,256,(g,w,h,r)=>{ g.fillStyle=css(c,-8); g.fillRect(0,0,w,h);
        for(let y=0;y<h;y+=16) for(let x=0;x<w;x+=32){ const o=(y/16)%2?16:0; g.fillStyle=css(c,between(r,0,8)); g.fillRect(x+o+1,y+1,28,13); g.fillStyle="rgba(0,0,0,0.25)"; g.fillRect(x+o+1,y+11,28,3); } });
      return {map:[map,0.16,0.16],rough:0.9}; },
    carpet(c,key){ const map=canvas(key,512,512,(g,w,h,r)=>{ g.fillStyle=css(c,0); g.fillRect(0,0,w,h); speckle(g,w,h,r,60000,0.2,2); });
      const bump=canvas("noise#carpet",256,256,(g,w,h,r)=>{ g.fillStyle="#808080"; g.fillRect(0,0,w,h); speckle(g,w,h,r,30000,0.8,2); });
      return {map:[map,0.9,0.9],bump:[bump,0.25,0.25,1.2],rough:1}; },
    fabric(c,key){ const map=canvas(key,256,256,(g,w,h,r)=>{ g.fillStyle=css(c,0); g.fillRect(0,0,w,h);
        for(let i=0;i<w;i+=4){ g.fillStyle="rgba(255,255,255,"+between(r,0.02,0.07)+")"; g.fillRect(i,0,2,h); g.fillStyle="rgba(0,0,0,"+between(r,0.02,0.08)+")"; g.fillRect(0,i,w,2); } });
      return {map:[map,0.12,0.12],rough:0.98}; },
    net(c,key){ const map=canvas(key,512,256,(g,w,h,r)=>{ for(let x=0;x<w;x++){ const f=0.5+0.5*Math.sin(x*0.118)*Math.cos(x*0.031+1.3); g.fillStyle=css(c,8+16*(1-f)-8*f,-10); g.fillRect(x,0,1,h); }
        g.fillStyle="rgba(255,255,255,0.4)"; for(let row=0;row<7;row++) for(let i=0;i<22;i++){ g.beginPath(); g.ellipse(i*24+(row%2?12:0),20+row*34,2.5,4.5,0,0,6.3); g.fill(); } });
      return {map:[map,1.2,0.9],rough:1}; },
    paint(c,key){ const bump=canvas("noise#woodchip",512,512,(g,w,h,r)=>{ g.fillStyle="#808080"; g.fillRect(0,0,w,h);
        for(let i=0;i<1500;i++){ g.fillStyle=r()<0.7?"rgba(255,255,255,0.5)":"rgba(0,0,0,0.3)"; g.save(); g.translate(r()*w,r()*h); g.rotate(r()*3.14); g.fillRect(0,0,between(r,3,9),between(r,2,4)); g.restore(); } });
      const map=canvas(key,256,256,(g,w,h,r)=>{ g.fillStyle=css(c,0); g.fillRect(0,0,w,h); speckle(g,w,h,r,2600,0.03,2); });
      return {map:[map,0.9,0.9],bump:[bump,0.9,0.9,0.5],rough:0.95}; },
    paper(c,key){ const map=canvas(key,128,128,(g,w,h,r)=>{ g.fillStyle=css(c,0); g.fillRect(0,0,w,h); speckle(g,w,h,r,900,0.05,2); }); return {map:[map,0.5,0.5],rough:0.9}; },
    plain(c,key){ const map=canvas(key,128,128,(g,w,h,r)=>{ g.fillStyle=css(c,0); g.fillRect(0,0,w,h); speckle(g,w,h,r,700,0.05,2); }); return {map:[map,0.6,0.6],rough:null}; },
    gloss(){ return {rough:0.36,mirror:0.35}; },
    metal(){ return {rough:0.3,metal:1,mirror:1.1}; },
    glass(){ return {glass:true}; },
    lamp(){ return {glow:0.9}; }};

  function tex(T,spec,colour,owned){
    const t=new T.CanvasTexture(spec[0]); t.wrapS=t.wrapT=T.RepeatWrapping; t.repeat.set(1/spec[1],1/spec[2]);
    if(colour) t.colorSpace=T.SRGBColorSpace; t.anisotropy=4; owned.push(t); return t;
  }
  /* ONE MATERIAL OF THE SET, WITH ITS SURFACE. m = {baseColor (linear), roughness, metallic, emissionStrength};
     name = an object that wears it (for the builder's plain "floor" and "wall"); env = what it mirrors.
     owned collects what must be disposed with the view. */
  function material(T,id,m,name,env,owned){
    const base=m.baseColor||[0.5,0.5,0.5], kind=kindOf(id,name), c=hsl(T,base);
    const colour=new T.Color(base[0],base[1],base[2]);
    let made;
    if(kind==="glass"){
      // a pane mirrors the sky; what is behind it is not built, so it is not see-through
      made=new T.MeshStandardMaterial({color:new T.Color(0.035,0.045,0.055),roughness:0.04,metalness:0,envMap:env||null,envMapIntensity:1.9,side:T.DoubleSide});
    }else{
      const p=PAINT[kind](c,kind+"|"+Math.round(c.h/3)*3+"|"+Math.round(c.s/3)*3+"|"+Math.round(c.l/2)*2);
      const o={side:T.DoubleSide,roughness:p.rough!=null?p.rough:(m.roughness==null?0.8:m.roughness),metalness:p.metal!=null?p.metal:(m.metallic||0)};
      if(p.map){ o.map=tex(T,p.map,true,owned); o.color=new T.Color(1,1,1); } else o.color=colour;
      if(p.bump){ o.bumpMap=tex(T,p.bump,false,owned); o.bumpScale=p.bump[3]; }
      if(p.mirror&&env){ o.envMap=env; o.envMapIntensity=p.mirror; }
      const glow=p.glow||(m.emissionStrength?Math.min(2.5,m.emissionStrength*0.35):0);
      if(glow){ o.emissive=colour; o.emissiveIntensity=glow; }
      made=new T.MeshStandardMaterial(o);
    }
    made.userData.surface=kind; owned.push(made); return made;
  }
  /* A SURFACE AT ITS REAL SIZE: every point of the shape gets its place on the surface in metres (the shape is a
     unit shape scaled to `size`), read across the face it lies on: a floor by x and y, a wall by its run and its
     height, so bricks lie in level courses and planks run straight whatever the shape. */
  function layUV(T,geometry,size){
    const p=geometry.attributes.position, n=geometry.attributes.normal; if(!p) return;
    let uv=geometry.attributes.uv;
    if(!uv||uv.count!==p.count){ uv=new T.BufferAttribute(new Float32Array(p.count*2),2); geometry.setAttribute("uv",uv); }
    const sx=size[0]||1, sy=size[1]||1, sz=size[2]||1;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i)*sx, y=p.getY(i)*sy, z=p.getZ(i)*sz;
      // the face's direction on the real shape (a unit shape's normal, un-squashed)
      const nx=n?Math.abs(n.getX(i)/sx):0, ny=n?Math.abs(n.getY(i)/sy):0, nz=n?Math.abs(n.getZ(i)/sz):1;
      if(nz>=nx&&nz>=ny) uv.setXY(i,x,y); else if(nx>ny) uv.setXY(i,y,z); else uv.setXY(i,x,z);
    }
    uv.needsUpdate=true;
  }
  /* THE SKY: what glass and metal mirror, and a dome behind the set that is lighter toward the horizon. colour = the
     set's own sky colour for its hour (a hex string or a three.js Color). Z is up. */
  function sky(T,renderer,colour){
    const base=new T.Color(colour||"#c8ccce"), o={}; base.getHSL(o,T.SRGBColorSpace);
    const at=(dl)=>"hsl("+(o.h*360).toFixed(0)+","+(o.s*100).toFixed(0)+"%,"+Math.max(3,Math.min(97,o.l*100+dl)).toFixed(0)+"%)";
    const paint=(g,w,h,stops)=>{ const gr=g.createLinearGradient(0,0,0,h); stops.forEach(s=>gr.addColorStop(s[0],s[1])); g.fillStyle=gr; g.fillRect(0,0,w,h); };
    const mk=(stops)=>{ const c=root.document.createElement("canvas"); c.width=16; c.height=256; paint(c.getContext("2d"),16,256,stops); const t=new T.CanvasTexture(c); t.colorSpace=T.SRGBColorSpace; return t; };
    const mirrorMap=mk([[0,at(-6)],[0.5,at(10)],[0.52,"#77736b"],[1,"#3d3a36"]]), domeMap=mk([[0,at(-9)],[0.42,at(2)],[0.5,at(8)],[1,at(8)]]);
    // spheres are painted pole to pole along their own Y: turned so that pole is up (Z)
    const es=new T.Scene(), ball=new T.Mesh(new T.SphereGeometry(50,32,16),new T.MeshBasicMaterial({map:mirrorMap,side:T.BackSide}));
    ball.rotation.x=Math.PI/2; es.add(ball);
    let texture=null;
    try{ const pm=new T.PMREMGenerator(renderer), rt=pm.fromScene(es,0.03); pm.dispose(); texture=rt.texture; }catch(_){ texture=null; }
    const dome=new T.Mesh(new T.SphereGeometry(400,32,16),new T.MeshBasicMaterial({map:domeMap,side:T.BackSide,fog:false,depthWrite:false}));
    dome.rotation.x=Math.PI/2; dome.userData.sky=true;
    return {texture,dome,dispose(){ [mirrorMap,domeMap,ball.geometry,ball.material,dome.geometry,dome.material].forEach(x=>x.dispose()); if(texture) texture.dispose(); }};
  }
  /* A STAND-IN PERSON (the demo's jointed figure): hips, torso, neck, head with a nose that shows which way it
     faces, arms and legs in two parts, feet. Built standing at the origin facing -Y, Z up, `height` metres tall.
     Returns a group; every mesh in it is marked userData.actor. dispose with disposeMannequin. */
  function mannequin(T,height,colour){
    const outer=new T.Group(), fig=new T.Group(); fig.rotation.x=Math.PI/2; fig.scale.setScalar((height||1.7)/1.8); outer.add(fig);
    const m=new T.MeshStandardMaterial({color:colour,roughness:0.85}), dark=new T.MeshStandardMaterial({color:new T.Color(colour).multiplyScalar(0.55),roughness:0.8});
    const owned=[m,dark];
    const add=(parent,geo,mat,x,y,z)=>{ const q=new T.Mesh(geo,mat||m); q.position.set(x||0,y||0,z||0); q.castShadow=q.receiveShadow=true; q.userData.actor=true; parent.add(q); owned.push(geo); return q; };
    const capsule=(r,len)=>T.CapsuleGeometry?new T.CapsuleGeometry(r,Math.max(0.01,len-2*r),6,12):new T.CylinderGeometry(r,r,len,12);
    const limb=(parent,len,r)=>{ add(parent,capsule(r,len),m,0,-len/2,0); const j=new T.Group(); j.position.y=-len; parent.add(j); return j; };
    const hips=new T.Group(); hips.position.y=0.95; fig.add(hips);
    const pel=add(hips,new T.SphereGeometry(0.15,16,12),m,0,0.02,0); pel.scale.set(1.15,0.8,0.85);
    const torso=add(hips,capsule(0.15,0.56),m,0,0.28,0); torso.scale.set(1.2,1,0.8);
    add(hips,new T.CylinderGeometry(0.05,0.055,0.1,12),m,0,0.55,0);
    const head=new T.Group(); head.position.set(0,0.6,0); hips.add(head);
    const skull=add(head,new T.SphereGeometry(0.12,16,12),m,0,0.115,0.01); skull.scale.set(0.88,1.06,1);
    add(head,new T.SphereGeometry(0.028,10,8),dark,0,0.1,0.125);
    [-1,1].forEach(s=>{
      const sh=new T.Group(); sh.position.set(s*0.21,0.47,0); sh.rotation.set(-0.05,0,s*0.06); hips.add(sh);
      const el=limb(sh,0.3,0.05); el.rotation.x=-0.2; const wr=limb(el,0.27,0.042); add(wr,new T.SphereGeometry(0.05,10,8),m,0,-0.05,0);
      const hp=new T.Group(); hp.position.set(s*0.1,0,0); hips.add(hp);
      const kn=limb(hp,0.45,0.075), an=limb(kn,0.42,0.055); add(an,new T.BoxGeometry(0.1,0.08,0.26),dark,0,-0.04,0.07);
    });
    outer.userData.owned=owned;
    return outer;
  }
  const disposeMannequin=g=>{ ((g&&g.userData&&g.userData.owned)||[]).forEach(x=>x.dispose()); };
  // turn a stand-in to face a point of the floor plan (it is built facing -Y)
  function face(group,from,to){ const dx=to[0]-from[0], dy=to[1]-from[1]; if(Math.hypot(dx,dy)>0.01) group.rotation.z=Math.atan2(dy,dx)+Math.PI/2; }

  root.KinolotSetSurfaces={RULES,kindOf,material,layUV,sky,mannequin,disposeMannequin,face};
})(typeof window!=="undefined"?window:globalThis);
