/* THE FURNITURE KIT (owner 2026-11-23, the Previs look brief, step 4: "the biggest difference ... build a furniture
   kit in code: one function per piece that makes the whole object from its parts, sized in metres"; plan agreed
   2026-11-24, stop 1: chair, table, door, window, kitchen units, chosen by name).
   A set here was about a hundred plain shapes: a chair was a box or a few boxes. A KIT PIECE makes the whole object
   from its parts (a chair: two front legs, two back posts, a seat with its pad, two back rails, two stretchers) at
   the size the set already gives it, in metres.
   HOW IT IS USED. Nothing in the set's data changes: its objects, boxes and dressing stay exactly as saved, and every
   check that reads them (where a camera may stand, what a camera sees, what sits on a shelf, how a door swings) reads
   them as before. Only the DRAWING swaps a thing for its kit piece: expand(scene) finds each thing the kit knows by
   its name, measures the box its shapes fill (its envelope), and returns the piece's parts to draw in place of them.
     pieceOf(name)          → which piece a thing is, from its name ("" when the kit has none for it)
     expand(scene)          → {hide:Set of object ids not to draw, parts:[objects to draw instead], materials:{}, pieces:[{name, piece, parts}]}
     PIECES[piece](w, d, h, o) → the piece's parts in its own frame (below)
   A PART is [kind, [width, depth, height], [x, y, z], material, turn]: x across the piece, y along its depth with +y
   its front, z up from the floor it stands on; [x, y, z] is the part's centre; material is "main" (the thing's own
   colour), "second" (its other colour: a seat pad, a worktop), "shade" (its own colour a little darker: a door's
   panels) or one of the kit's own (steel, glass, dark, worktop).
   Everything is plain numbers, the same on every draw; nothing is random in these five. */
(function(root){
  "use strict";
  const arr=v=>Array.isArray(v)?v:[];
  const r3=n=>Math.round(n*1000)/1000;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  /* ---- the pieces ---- */
  const PIECES={
    // a dining or kitchen chair: it faces +y, its back is at -y
    chair(w,d,h,o){
      const t=clamp(Math.min(w,d)*0.085,0.03,0.045), seat=o&&o.seat?clamp(o.seat,0.3,0.6):clamp(h*0.5,0.3,0.5), x=w/2-t/2, y=d/2-t/2, parts=[];
      [-1,1].forEach(s=>{
        parts.push(["box",[t,t,seat],[s*x,y,seat/2],"main"]);                 // front leg
        parts.push(["box",[t,t,h],[s*x,-y,h/2],"main"]);                      // back post, up to the top rail
        parts.push(["box",[0.02,d-2*t,0.02],[s*x,0,seat*0.36],"main"]);       // side stretcher
      });
      parts.push(["box",[w,d,0.03],[0,0,seat-0.015],"main"]);                 // seat
      parts.push(["box",[w-0.04,d-0.04,0.03],[0,0.005,seat+0.012],"second"]); // its pad
      parts.push(["box",[w-2*t,0.02,0.07],[0,-y,h-0.045],"main"]);            // top rail
      parts.push(["box",[w-2*t,0.02,0.05],[0,-y,seat+(h-seat)*0.55],"main"]); // middle rail
      return parts;
    },
    // a table of any height (a kitchen table, a coffee table, a bedside table): a top, four legs, four aprons under it
    table(w,d,h){
      const top=clamp(h*0.05,0.025,0.045), leg=clamp(Math.min(w,d)*0.07,0.035,0.07), inset=Math.min(0.06,Math.min(w,d)*0.12);
      const x=w/2-inset-leg/2, y=d/2-inset-leg/2, apron=clamp(h*0.11,0.04,0.09), parts=[["box",[w,d,top],[0,0,h-top/2],"main"]];
      [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(k=>parts.push(["box",[leg,leg,h-top],[k[0]*x,k[1]*y,(h-top)/2],"main"]));
      [-1,1].forEach(s=>{
        parts.push(["box",[2*x-leg,0.02,apron],[0,s*y,h-top-apron/2],"main"]);
        parts.push(["box",[0.02,2*y-leg,apron],[s*x,0,h-top-apron/2],"main"]);
      });
      return parts;
    },
    // a door leaf: the leaf, two raised panels on each face (the upper one glass when the door is glazed), a lever
    // handle and its plate on each face, on the +x side. w = its width, d = its thickness.
    door(w,d,h,o){
      const glazed=!!(o&&o.glazed), parts=[["box",[w,d,h],[0,0,h/2],"main"]], face=d/2+0.004, pw=w*0.64;
      [-1,1].forEach(s=>{
        parts.push(["box",[pw,0.012,h*0.3],[0,s*face,h*0.25],"shade"]);
        if(!glazed) parts.push(["box",[pw,0.012,h*0.38],[0,s*face,h*0.71],"shade"]);
        parts.push(["box",[0.045,0.01,0.16],[w/2-0.075,s*(d/2+0.005),h*0.5],"steel"]);     // plate
        parts.push(["box",[0.12,0.018,0.02],[w/2-0.115,s*(d/2+0.04),h*0.5+0.02],"steel"]); // lever
      });
      if(glazed) parts.push(["box",[pw,d+0.012,h*0.38],[0,0,h*0.71],"glass"]);
      return parts;
    },
    // a window: its frame, a meeting rail across the middle (a sash), a glazing bar down each sash when it is wide,
    // the glass, and a sill. w = its width, d = how deep its frame is.
    window(w,d,h){
      const f=clamp(Math.min(w,h)*0.07,0.035,0.06), deep=clamp(d,0.07,0.12), parts=[];
      [-1,1].forEach(s=>parts.push(["box",[f,deep,h],[s*(w/2-f/2),0,h/2],"main"]));
      parts.push(["box",[w,deep,f],[0,0,h-f/2],"main"]); parts.push(["box",[w,deep,f],[0,0,f/2],"main"]);
      parts.push(["box",[w-2*f,deep*0.8,f*0.8],[0,0,h/2],"main"]);                                   // meeting rail
      if(w>=0.8) parts.push(["box",[f*0.5,deep*0.5,h-2*f],[0,0,h/2],"main"]);                       // glazing bar
      parts.push(["box",[w-2*f,0.012,h-2*f],[0,0,h/2],"glass"]);
      parts.push(["box",[w+0.1,deep+0.1,0.035],[0,0,-0.0175],"main"]);                              // sill
      return parts;
    },
    // a run of kitchen base units: a recessed plinth, the carcass, a door about every half metre with its bar handle,
    // and a worktop that oversails the doors. Its front is +y.
    units(w,d,h){
      const plinth=clamp(h*0.11,0.08,0.12), top=0.04, body=h-plinth-top, n=Math.max(1,Math.round(w/0.5)), dw=w/n, parts=[];
      parts.push(["box",[w,d-0.07,plinth],[0,-0.035,plinth/2],"dark"]);
      parts.push(["box",[w,d-0.04,body],[0,-0.02,plinth+body/2],"main"]);
      for(let i=0;i<n;i++){
        const x=-w/2+dw*(i+0.5);
        parts.push(["box",[dw-0.006,0.018,body-0.012],[x,d/2-0.031,plinth+body/2],"main"]);
        parts.push(["box",[Math.min(0.16,dw*0.5),0.012,0.012],[x,d/2-0.012,plinth+body-0.06],"steel"]);
      }
      parts.push(["box",[w,d,top],[0,0,h-top/2],"second"]);
      return parts;
    }};
  // the kit's own materials (the thing's own colours are "main" and "second")
  const MATERIALS={
    kit_steel:{baseColor:[0.42,0.44,0.45],metallic:0.85,roughness:0.32},
    kit_glass:{baseColor:[0.02,0.03,0.04],metallic:0,roughness:0.08},
    kit_dark:{baseColor:[0.018,0.018,0.02],metallic:0,roughness:0.8},
    kit_worktop:{baseColor:[0.07,0.07,0.075],metallic:0,roughness:0.45}};

  /* WHICH PIECE A THING IS, from its name. Only what is plainly one of the five: "chairs" (several in one object), a
     car door, a table lamp or a window box are left as they are. */
  function pieceOf(name){
    // a note in brackets says where a thing is, not what it is: "chair (west, window)" is a chair
    const said=String(name||"").toLowerCase().replace(/\([^)]*\)/g," ");
    const n=" "+said.replace(/[^a-z0-9]+/g," ")+" ";
    // two things in one name, or a thing named by what it is next to, is not one of the five:
    // "table and chairs", "radiator under window", "shop next door", "door surround and lamp"
    if(/[,&+\/]/.test(said)||/ (and|with|under|above|below|beside|behind|near|by|next|over|on|in|for|at|to) /.test(n)) return "";
    if(/ (lamp|cloth|leg|top|mat|runner|setting|football|tennis|pool|snooker) /.test(n)&&/ table /.test(n)) return "";
    if(/ (base|kitchen|galley|fitted|floor) (units?|cupboards?|cabinets?) /.test(n)||/ run of units /.test(n)||(/ units /.test(n)&&/ (kitchen|galley) /.test(n))) return / wall /.test(n)?"":"units";
    if(/ chair /.test(n)&&!/ (arm|wheel|high|deck|rocking|office|swivel) ?chair /.test(n)&&!/ (lift|leg|back|cushion|cover) /.test(n)) return "chair";
    if(/ table /.test(n)) return "table";
    if(/ window /.test(n)&&!/ (sill|ledge|box|seat|curtain|blind|shutter|display|shop|car|cab|bus|van|train|frame|surround|driver|passenger|rear) /.test(n)) return "window";
    if(/ door( leaf)? /.test(n)&&!/ (frame|surround|bell|handle|knob|mat|step|way|cupboard|wardrobe|fridge|oven|cabinet|car|cab|van|bus|train|garage|sliding|revolving|trap|hatch|shutter|lift|driver|passenger|rear|boot) /.test(n)) return "door";
    return "";
  }
  // is the box a piece's kind of box? (a "table" 4 m high is something else)
  const FITS={
    chair:e=>e.w>=0.3&&e.w<=0.8&&e.d>=0.3&&e.d<=0.8&&e.h>=0.6&&e.h<=1.3,
    table:e=>e.w>=0.3&&e.d>=0.3&&e.h>=0.25&&e.h<=1.2&&Math.max(e.w,e.d)<=5,
    units:e=>e.w>=0.5&&e.d>=0.35&&e.d<=0.9&&e.h>=0.7&&e.h<=1.1&&e.base<1,
    door:e=>e.w>=0.5&&e.w<=1.3&&e.d<=0.14&&e.h>=1.6&&e.h<=2.6,
    window:e=>e.w>=0.3&&e.w<=3.2&&e.d<=0.3&&e.h>=0.3&&e.h<=2.7};

  /* THE BOX A THING'S SHAPES FILL, in its own frame: its turn about Z (the turn most of its bulk has), then how far
     its shapes reach across, along and up. whole = one shape alone is the thing (a door's leaf, a window's pane):
     its own box. → {centre:[x,y], base, w, d, h, turn} */
  const volume=o=>Math.abs(o.size[0]*o.size[1]*o.size[2]);
  function envelope(items,whole){
    const big=items.slice().sort((a,b)=>volume(b)-volume(a))[0];
    if(whole){
      let w=Math.abs(big.size[0]), d=Math.abs(big.size[1]), turn=Number(arr(big.rotation)[2])||0;
      if(d>w){ const t=w; w=d; d=t; turn+=Math.PI/2; }                 // its width is its long side
      return {centre:[big.position[0],big.position[1]],base:big.position[2]-Math.abs(big.size[2])/2,w,d,h:Math.abs(big.size[2]),turn};
    }
    const turn=Number(arr(big.rotation)[2])||0, c=Math.cos(-turn), s=Math.sin(-turn);
    let lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
    items.forEach(o=>{
      const own=(Number(arr(o.rotation)[2])||0)-turn, oc=Math.cos(own), os=Math.sin(own);
      const px=o.position[0]*c-o.position[1]*s, py=o.position[0]*s+o.position[1]*c;
      [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(k=>{
        const x=k[0]*Math.abs(o.size[0])/2, y=k[1]*Math.abs(o.size[1])/2, q=[px+x*oc-y*os,py+x*os+y*oc];
        lo[0]=Math.min(lo[0],q[0]); hi[0]=Math.max(hi[0],q[0]); lo[1]=Math.min(lo[1],q[1]); hi[1]=Math.max(hi[1],q[1]);
      });
      lo[2]=Math.min(lo[2],o.position[2]-Math.abs(o.size[2])/2); hi[2]=Math.max(hi[2],o.position[2]+Math.abs(o.size[2])/2);
    });
    const mx=(lo[0]+hi[0])/2, my=(lo[1]+hi[1])/2, bc=Math.cos(turn), bs=Math.sin(turn);
    return {centre:[mx*bc-my*bs,mx*bs+my*bc],base:lo[2],w:hi[0]-lo[0],d:hi[1]-lo[1],h:hi[2]-lo[2],turn};
  }
  // a thing's own colours: the material most of its bulk wears, and the next one
  function colours(items){
    const by={}; items.forEach(o=>{ by[o.material]=(by[o.material]||0)+volume(o); });
    const order=Object.keys(by).sort((a,b)=>by[b]-by[a]);
    return {main:order[0]||"dressing",second:order[1]||""};
  }
  const baseName=o=>String(o.name||"").split(" · ")[0].split(" - part ")[0].replace(/ \((?:door )?stand-in\)$/,"").trim();
  const foot=o=>Math.abs(o.size[0]*o.size[1]);
  const topOf=o=>o.position[2]+Math.abs(o.size[2])/2, bottomOf=o=>o.position[2]-Math.abs(o.size[2])/2;
  // a point of the set in a thing's own frame (x across it, y along its depth), and a quarter turn of that frame
  const local=(e,p)=>{ const c=Math.cos(-e.turn), s=Math.sin(-e.turn), x=p[0]-e.centre[0], y=p[1]-e.centre[1]; return [x*c-y*s,x*s+y*c]; };
  const turned=(e,by)=>by===0?e:{...e,turn:e.turn+by,w:Math.abs(Math.abs(by)-Math.PI)<0.01?e.w:e.d,d:Math.abs(Math.abs(by)-Math.PI)<0.01?e.d:e.w};
  // the quarter turn that points a thing's front (+y) along a direction given in its own frame
  const frontTo=v=>Math.abs(v[1])>=Math.abs(v[0])?(v[1]>=0?0:Math.PI):(v[0]>0?-Math.PI/2:Math.PI/2);

  /* WHAT OF A THING THE KIT REDRAWS, AND WHAT IT LEAVES. The dressing has often drawn more than the kit knows: a hob
     set in a worktop, a letter plate and a pane in a front door, a net curtain at a window. Those stay exactly as they
     are; the kit redraws the thing's STRUCTURE only.
       units   the worktop is the widest shape in its upper part; what stands on it or is set in it stays
       door    the leaf is redrawn; its frame, pane, plate and handle stay, and the kit adds no panel or handle on
               top of one of them
       window  a window the dressing has framed (more than two shapes) is left alone; a bare pane gets the kit's frame
       table   a round top is left alone (the kit's table is square-cornered)
     → {structure, kept, options} or null to leave the thing as it is */
  function split(piece,items){
    const big=items.slice().sort((a,b)=>volume(b)-volume(a))[0];
    if(piece==="door") return {structure:[big],kept:items.filter(o=>o!==big),options:{}};
    if(piece==="window") return items.length>2?null:{structure:[big],kept:items.filter(o=>o!==big),options:{}};
    if(items.some(o=>Math.abs(Number(arr(o.rotation)[0])||0)>0.02||Math.abs(Number(arr(o.rotation)[1])||0)>0.02)) return null;   // lying or leaning
    const wide=items.slice().sort((a,b)=>foot(b)-foot(a))[0];
    if(piece==="table") return wide.kind==="cylinder"||wide.kind==="torus"?null:{structure:items,kept:[],options:{}};
    if(piece==="chair"){
      const all=envelope(items,false), seat=topOf(wide)-all.base;
      return {structure:items,kept:[],options:items.length>1&&seat>=0.3&&seat<=0.6?{seat}:{}};
    }
    if(piece==="units"){
      const all=envelope(items,false), work=items.filter(o=>o.position[2]>all.base+0.6*all.h).sort((a,b)=>foot(b)-foot(a))[0];
      if(!work) return {structure:items,kept:[],options:{}};
      const kept=items.filter(o=>o!==work&&bottomOf(o)>=topOf(work)-0.02);
      return {structure:items.filter(o=>kept.indexOf(o)<0),kept,options:{second:work.material}};
    }
    return {structure:items,kept:[],options:{}};
  }
  /* WHICH WAY A THING FACES. A piece has a front (+y): a chair's seat, a unit's doors. The set's shapes say which
     side that is: a chair's back is where its tall shapes are; a unit's doors, handles and oversailing worktop are on
     the side its carcass is NOT pushed to. A chair that is one plain block faces the nearest table. → the box, turned */
  function facing(piece,e,items,tables){
    if(piece==="chair"){
      const tall=items.filter(o=>topOf(o)>=e.base+0.8*e.h&&foot(o)<0.6*e.w*e.d);
      let v=null;
      if(tall.length){
        let x=0,y=0,m=0; tall.forEach(o=>{ const q=local(e,o.position), k=volume(o); x+=q[0]*k; y+=q[1]*k; m+=k; });
        x/=m||1; y/=m||1;
        if(Math.max(Math.abs(x)/(e.w/2),Math.abs(y)/(e.d/2))>=0.3) v=[-x/(e.w/2),-y/(e.d/2)];      // the front is away from the back
      }
      if(!v){
        const near=tables.map(t=>({t,far:Math.hypot(t[0]-e.centre[0],t[1]-e.centre[1])})).sort((a,b)=>a.far-b.far)[0];
        if(near&&near.far<=1.6&&near.far>0.05) v=local(e,near.t);
      }
      return v?turned(e,frontTo(v)):e;
    }
    if(piece==="units"){
      const big=items.slice().sort((a,b)=>volume(b)-volume(a))[0], q=local(e,big.position);
      return Math.abs(q[1])>=0.003&&q[1]>0?turned(e,Math.PI):e;                                     // the carcass sits to the back
    }
    return e;
  }
  // does a kit part of a door lie over something the dressing drew on that door? (across the leaf and up it)
  function covers(e,part,kept){
    const x0=part[2][0]-part[1][0]/2, x1=part[2][0]+part[1][0]/2, z0=e.base+part[2][2]-part[1][2]/2, z1=e.base+part[2][2]+part[1][2]/2;
    return kept.some(o=>{
      const q=local(e,o.position), own=(Number(arr(o.rotation)[2])||0)-e.turn;
      const half=(Math.abs(Math.cos(own))*Math.abs(o.size[0])+Math.abs(Math.sin(own))*Math.abs(o.size[1]))/2;
      return q[0]-half<x1&&q[0]+half>x0&&bottomOf(o)<z1&&topOf(o)>z0;
    });
  }
  // a thing's own colour, a little darker: the panels of a door read against its leaf
  function shade(scene,name,out){
    const m=scene&&scene.materials&&scene.materials[name], key=name+"_kitshade";
    if(!m||!Array.isArray(m.baseColor)) return name;
    out.materials[key]={...m,baseColor:m.baseColor.map(v=>r3(v*0.8))};
    return key;
  }

  function expand(scene){
    const out={hide:new Set(),parts:[],materials:{},pieces:[]};
    const objects=arr(scene&&scene.objects), groups=[], byAnchor=new Map();
    let open=null;
    objects.forEach(o=>{
      if(!o||!Array.isArray(o.position)||!Array.isArray(o.size)) return;
      const id=String(o.id||"");
      // never the room itself, an opening's own frame, a person or a prop
      if(/^(floor|wall|ceiling|opening|fig|prop)-/.test(id)){ open=null; return; }
      if(o.anchorId){ open=null;
        let g=byAnchor.get(o.anchorId); if(!g){ g={name:baseName(o),anchor:true,items:[]}; byAnchor.set(o.anchorId,g); groups.push(g); }
        g.items.push(o); return; }
      if(/^(extra|door)-/.test(id)){
        // the shapes of one extra follow each other, numbered from 1: a new 1 (or a new name) is a new thing
        const name=baseName(o), n=Number((String(o.name||"").match(/ · (\d+)$/)||[])[1]||0);
        if(!open||open.name!==name||n<=open.last){ open={name,anchor:false,items:[],last:0}; groups.push(open); }
        open.items.push(o); open.last=n||1; return; }
      open=null;
    });
    const found=[];
    groups.forEach(g=>{
      const piece=pieceOf(g.name); if(!piece||!PIECES[piece]) return;
      const flat=piece==="door"||piece==="window";
      if(flat&&g.anchor) return;                                   // an opening's own anchor is its frame, not a leaf
      const cut=split(piece,g.items); if(!cut||!cut.structure.length) return;
      let e=envelope(cut.structure,flat);
      if(piece==="units"&&e.d>e.w) e=turned(e,Math.PI/2);          // a run's width is its long side
      if(!FITS[piece](e)) return;
      found.push({g,piece,flat,cut,e});
    });
    const tables=found.filter(f=>f.piece==="table").map(f=>f.e.centre);
    let count=0;
    found.forEach(f=>{
      const g=f.g, piece=f.piece, cut=f.cut, e=facing(piece,f.e,cut.structure,tables);
      const tone=f.flat?{main:cut.structure[0].material,second:""}:colours(cut.structure), c=Math.cos(e.turn), s=Math.sin(e.turn);
      const glazed=piece==="door"&&!cut.kept.length&&(/\b(glass|glazed|frosted|pane)\b/i.test(g.name));
      const made=PIECES[piece](e.w,e.d,e.h,{...cut.options,glazed}).filter((p,i)=>!(piece==="door"&&i>0&&covers(e,p,cut.kept)));
      const second=cut.options.second||tone.second;
      const pick=m=>m==="main"?tone.main:m==="second"?(second&&second!==tone.main?second:(piece==="units"?"kit_worktop":tone.main)):m==="shade"?shade(scene,tone.main,out):"kit_"+m;
      made.forEach(p=>{
        const material=pick(p[3]); if(MATERIALS[material]) out.materials[material]=MATERIALS[material];
        out.parts.push({id:"kit-"+(count++),name:g.name,kind:p[0],size:p[1].map(r3),
          position:[r3(e.centre[0]+p[2][0]*c-p[2][1]*s),r3(e.centre[1]+p[2][0]*s+p[2][1]*c),r3(e.base+p[2][2])],
          rotation:[0,0,r3(e.turn+(p[4]||0))],material,kit:piece});
      });
      cut.structure.forEach(o=>out.hide.add(o.id));
      out.pieces.push({name:g.name,piece,parts:made.length,kept:cut.kept.length});
    });
    return out;
  }

  root.KinolotSetKit={PIECES,MATERIALS,FITS,pieceOf,envelope,split,facing,expand};
})(typeof window!=="undefined"?window:globalThis);
