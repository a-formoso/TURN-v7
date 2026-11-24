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
   A part's turn is a turn about Z, or [x, y, z] turns for a part that lies down (a handle bar, a curtain pole).
   STOP 2 (owner 2026-11-24): sofa, bed, shelves with books, cooker, fridge, skirting, radiator, lamp, rug, curtains.
   Everything is plain numbers, the same on every draw. The one thing that varies, the books on a bookcase, comes
   from a seeded generator fed by the thing's own name and place: the same books on every draw and every device. */
(function(root){
  "use strict";
  const arr=v=>Array.isArray(v)?v:[];
  const r3=n=>Math.round(n*1000)/1000;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // a seeded generator: the same numbers for the same seed, on every device (never the browser's own dice)
  function seeded(text){
    let h=2166136261; const t=String(text||"");
    for(let i=0;i<t.length;i++){ h^=t.charCodeAt(i); h=Math.imul(h,16777619); }
    let a=h>>>0;
    return ()=>{ a=(a+0x6D2B79F5)>>>0; let x=a; x=Math.imul(x^(x>>>15),x|1); x^=x+Math.imul(x^(x>>>7),x|61); return ((x^(x>>>14))>>>0)/4294967296; };
  }
  const QUARTER=Math.PI/2;

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
    },
    // a sofa: four feet, the base, two arms, the back, a seat cushion and a back cushion for each place. It faces +y.
    sofa(w,d,h,o){
      const foot=0.08, arm=clamp(w*0.09,0.12,0.22), back=clamp(d*0.24,0.16,0.26), seat=o&&o.seat?clamp(o.seat,0.34,0.52):clamp(h*0.5,0.36,0.46);
      const armH=clamp(h*0.74,seat+0.1,0.68), inner=w-2*arm, n=clamp(Math.round(inner/0.72),1,4), cw=inner/n, pad=0.15, parts=[];
      [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(k=>parts.push(["box",[0.06,0.06,foot],[k[0]*(w/2-0.07),k[1]*(d/2-0.07),foot/2],"dark"]));
      parts.push(["box",[w,d,seat-pad-foot],[0,0,foot+(seat-pad-foot)/2],"main"]);
      [-1,1].forEach(s=>parts.push(["box",[arm,d,armH-foot],[s*(w/2-arm/2),0,foot+(armH-foot)/2],"main"]));
      parts.push(["box",[inner,back,h-foot],[0,-d/2+back/2,foot+(h-foot)/2],"main"]);
      for(let i=0;i<n;i++){
        const x=-inner/2+cw*(i+0.5);
        parts.push(["cushion",[cw-0.015,d-back-0.02,pad+0.03],[x,back/2,seat-pad/2],"main"]);
        parts.push(["cushion",[cw-0.03,0.17,h-seat-0.02],[x,-d/2+back+0.07,seat+(h-seat)/2+0.01],"main",[0.14,0,0]]);
      }
      return parts;
    },
    // a bed: four legs, the frame, a mattress, a headboard when the bed is tall enough to have one, pillows, a
    // duvet with its sheet turned down. w = across it, d = its length; its head is at -y.
    bed(w,d,h,o){
      const top=o&&o.top?clamp(o.top,0.35,0.75):(h<=0.75?clamp(h,0.35,0.75):0.55), head=h>top+0.2, leg=top*0.3, rail=top*0.25, parts=[];
      [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(k=>parts.push(["box",[0.06,0.06,leg],[k[0]*(w/2-0.04),k[1]*(d/2-0.04),leg/2],"frame"]));
      parts.push(["box",[w,d,rail],[0,0,leg+rail/2],"frame"]);
      parts.push(["cushion",[w-0.03,d-0.05,top-leg-rail+0.02],[0,0,(leg+rail+top)/2],"linen"]);
      if(head) parts.push(["box",[w,0.06,h],[0,-d/2+0.03,h/2],"frame"]);
      const n=w>=1.3?2:1, pw=Math.min(0.72,(w-0.12)/n-0.04);
      for(let i=0;i<n;i++) parts.push(["cushion",[pw,0.42,0.14],[(i-(n-1)/2)*(pw+0.06),-d/2+0.3+(head?0.04:0),top+0.06],"linen"]);
      parts.push(["cushion",[w+0.03,d*0.66,0.11],[0,d/2-d*0.33,top+0.035],"cover"]);
      parts.push(["cushion",[w+0.03,0.2,0.13],[0,d/2-d*0.66-0.04,top+0.045],"linen"]);
      return parts;
    },
    // shelves: two sides, a top, a bottom over a kick board, a back, a shelf about every third of a metre and,
    // for a bookcase, its books. Its front is +y.
    shelves(w,d,h,o){
      const t=0.022, kick=0.06, n=Math.max(1,Math.round((h-kick-t)/0.34)), pitch=(h-kick-t)/n, inner=w-2*t, parts=[];
      [-1,1].forEach(s=>parts.push(["box",[t,d,h],[s*(w/2-t/2),0,h/2],"main"]));
      parts.push(["box",[w,d,t],[0,0,h-t/2],"main"]);
      parts.push(["box",[inner,0.015,kick],[0,d/2-0.03,kick/2],"main"]);
      parts.push(["box",[inner,0.008,h-kick],[0,-d/2+0.004,kick+(h-kick)/2],"shade"]);
      for(let i=0;i<n;i++) parts.push(["box",[inner,d-0.01,t],[0,0.005,kick+i*pitch+t/2],"main"]);
      if(o&&o.books){
        const next=seeded(o.seed), clear=pitch-t-0.02, run=inner-0.02, wide=0.04*Math.max(1,(run*n)/(72*0.045));
        for(let i=0;i<n;i++){
          const fill=0.62+0.33*next(); let x=-run/2;
          while(x<-run/2+run*fill){
            const bw=wide*(0.6+0.8*next()), bh=Math.min(clear,0.3)*(0.68+0.3*next()), bd=Math.min(d-0.05,0.13+0.07*next()), tone=1+Math.floor(next()*6);
            if(next()<0.08){ x+=wide*1.5; continue; }                                  // a gap where a book is out
            if(x+bw>run/2) break;
            parts.push(["box",[bw-0.003,bd,bh],[x+bw/2,d/2-0.03-bd/2,kick+i*pitch+t+bh/2],"book"+tone]);
            x+=bw;
          }
        }
      }
      return parts;
    },
    // a freestanding cooker: a plinth, the body, an oven door with its window and bar handle, a control strip with
    // five knobs, a hob with four rings. Its front is +y.
    cooker(w,d,h){
      const plinth=0.07, strip=0.1, hob=0.015, door=h-plinth-hob-strip-0.04, parts=[];
      parts.push(["box",[w-0.02,d-0.06,plinth],[0,-0.03,plinth/2],"dark"]);
      parts.push(["box",[w,d-0.03,h-plinth-hob],[0,-0.015,plinth+(h-plinth-hob)/2],"main"]);
      parts.push(["box",[w-0.03,0.025,door],[0,d/2-0.0175,plinth+0.02+door/2],"main"]);
      parts.push(["box",[w*0.62,0.008,door*0.5],[0,d/2-0.002,plinth+0.02+door*0.5],"glass"]);
      parts.push(["cylinder",[0.022,0.022,w*0.7],[0,d/2+0.03,plinth+0.02+door-0.05],"steel",[0,QUARTER,0]]);
      parts.push(["box",[w,0.02,strip-0.01],[0,d/2-0.02,h-hob-strip/2],"shade"]);
      for(let i=0;i<5;i++) parts.push(["cylinder",[0.035,0.035,0.022],[(i-2)*w*0.17,d/2,h-hob-strip/2],"steel",[QUARTER,0,0]]);
      parts.push(["box",[w,d,hob],[0,0,h-hob/2],"dark"]);
      [[1,1,0.17],[1,-1,0.13],[-1,1,0.13],[-1,-1,0.17]].forEach(k=>parts.push(["cylinder",[k[2],k[2],0.012],[k[0]*w*0.23,k[1]*d*0.2,h+0.004],"steel"]));
      return parts;
    },
    // a fridge: the body on its feet, a door (two for a tall fridge freezer, with the seam between them), a handle
    // on each. Its front is +y.
    fridge(w,d,h,o){
      const foot=0.04, door=0.05, H=h-foot, y=d/2-door/2, side=o&&o.hand<0?-1:1, parts=[];
      parts.push(["box",[w-0.04,d-door-0.04,foot],[0,-door/2,foot/2],"dark"]);
      parts.push(["box",[w,d-door,H],[0,-door/2,foot+H/2],"main"]);
      if(h>1.3){
        const low=o&&o.seam>foot+0.3&&o.seam<h-0.3?o.seam-foot-0.006:H*0.4, up=H-low-0.012;
        parts.push(["box",[w-0.006,door,low-0.006],[0,y,foot+low/2],"main"]);
        parts.push(["box",[w-0.006,door,up-0.006],[0,y,foot+low+0.012+up/2],"main"]);
        parts.push(["box",[w-0.01,door-0.01,0.012],[0,y-0.005,foot+low+0.006],"dark"]);
        parts.push(["box",[0.022,0.03,Math.min(0.32,up*0.5)],[side*(w/2-0.05),d/2+0.015,foot+low+0.012+Math.min(0.2,up*0.3)],"steel"]);
        parts.push(["box",[0.022,0.03,Math.min(0.26,low*0.5)],[side*(w/2-0.05),d/2+0.015,foot+low-Math.min(0.17,low*0.3)],"steel"]);
      }else{
        parts.push(["box",[w-0.006,door,H-0.006],[0,y,foot+H/2],"main"]);
        parts.push(["box",[0.022,0.03,Math.min(0.3,H*0.4)],[side*(w/2-0.05),d/2+0.015,foot+H*0.72],"steel"]);
      }
      return parts;
    },
    // a skirting board: the board and the narrower moulding along its top
    skirting(w,d,h){
      return [["box",[w,d,h*0.82],[0,0,h*0.41],"main"],["box",[w,d*0.55,h*0.18],[0,0,h*0.91],"main"]];
    },
    // a panel radiator: the panel against the wall, a fin about every five centimetres, a top grille, a valve and
    // (when it hangs off the floor) its pipe down. Its front is +y.
    radiator(w,d,h,o){
      const n=clamp(Math.round(w/0.05),6,32), pitch=w/n, base=Math.max(0,o&&o.base||0), parts=[["box",[w,d*0.35,h],[0,-d*0.325,h/2],"main"]];
      for(let i=0;i<n;i++) parts.push(["box",[pitch*0.62,d*0.6,h-0.03],[-w/2+pitch*(i+0.5),d*0.15,h/2],"main"]);
      parts.push(["box",[w,d,0.014],[0,0,h-0.007],"shade"]);
      parts.push(["cylinder",[0.035,0.035,0.06],[w/2+0.035,0,0.05],"steel"]);
      if(base>0.04) parts.push(["cylinder",[0.016,0.016,base],[w/2+0.035,0,-base/2],"steel"]);
      return parts;
    },
    // a lamp: a pendant (its shade, the flex and the ceiling rose), a floor lamp (base, pole, shade) or a table
    // lamp (base, neck, shade), each with its bulb; o.type says which
    lamp(w,d,h,o){
      const type=o&&o.type||"table", across=Math.max(w,d), parts=[];
      const shade=(wide,tall,z)=>{
        parts.push(["cylinder",[wide,wide,tall],[0,0,z+tall/2],"main"]);
        parts.push(["cylinder",[wide*1.03,wide*1.03,0.012],[0,0,z+0.006],"shade"]);
        parts.push(["cylinder",[wide*1.03,wide*1.03,0.012],[0,0,z+tall-0.006],"shade"]);
        parts.push(["sphere",[0.07,0.07,0.09],[0,0,z+tall*0.4],"bulb"]);
      };
      if(type==="pendant"){
        const tall=clamp(Math.min(h*0.55,across*0.75),Math.min(h,0.1),0.4);
        shade(across,tall,0);
        if(h-tall>0.03){ parts.push(["cylinder",[0.008,0.008,h-tall],[0,0,tall+(h-tall)/2],"dark"]); parts.push(["cylinder",[0.09,0.09,0.02],[0,0,h-0.01],"linen"]); }
      }else if(type==="floor"){
        const tall=clamp(h*0.2,0.2,0.32), wide=clamp(across,0.25,0.5);
        parts.push(["cylinder",[0.26,0.26,0.03],[0,0,0.015],"dark"]);
        parts.push(["cylinder",[0.024,0.024,h-tall-0.03],[0,0,0.03+(h-tall-0.03)/2],"steel"]);
        shade(wide,tall,h-tall);
      }else{
        const tall=h*0.42, wide=clamp(across,0.14,0.45);
        parts.push(["cylinder",[wide*0.42,wide*0.42,h*0.46],[0,0,h*0.23],"second"]);
        parts.push(["cylinder",[0.02,0.02,h*0.12],[0,0,h*0.52],"steel"]);
        shade(wide,tall,h-tall);
      }
      return parts;
    },
    // a rug: the field, a border line set in from its edge, a fringe at its two short ends
    rug(w,d,h){
      const b=clamp(Math.min(w,d)*0.09,0.04,0.12), parts=[["box",[w,d,h],[0,0,h/2],"main"]];
      [-1,1].forEach(s=>{
        parts.push(["box",[w-2*b,0.025,0.003],[0,s*(d/2-b),h+0.0015],"shade"]);
        parts.push(["box",[0.025,d-2*b,0.003],[s*(w/2-b),0,h+0.0015],"shade"]);
      });
      [-1,1].forEach(s=>parts.push(d>=w?["box",[w,0.035,h*0.6],[0,s*(d/2+0.0175),h*0.3],"linen"]:["box",[0.035,d,h*0.6],[s*(w/2+0.0175),0,h*0.3],"linen"]));
      return parts;
    },
    // curtains: a pole with its two ends, and a drape at each side hanging in folds (drawn across when o.closed)
    curtains(w,d,h,o){
      const side=o&&o.closed?w/2:clamp(w*0.2,0.18,0.5), k=clamp(Math.round(side/0.07),3,9), fold=side/k, deep=clamp(d,0.06,0.12), parts=[];
      parts.push(["cylinder",[0.028,0.028,w+0.16],[0,0,h-0.02],"dark",[0,QUARTER,0]]);
      [-1,1].forEach(s=>parts.push(["sphere",[0.05,0.05,0.05],[s*(w/2+0.08),0,h-0.02],"dark"]));
      [-1,1].forEach(s=>{ for(let i=0;i<k;i++) parts.push(["capsule",[fold*1.15,deep,h-0.07],[s*(w/2-fold*(i+0.5)),(i%2?1:-1)*0.012,(h-0.07)/2],"main"]); });
      return parts;
    }};
  // the kit's own materials (the thing's own colours are "main" and "second")
  const MATERIALS={
    kit_steel:{baseColor:[0.42,0.44,0.45],metallic:0.85,roughness:0.32},
    kit_glass:{baseColor:[0.02,0.03,0.04],metallic:0,roughness:0.08},
    kit_dark:{baseColor:[0.018,0.018,0.02],metallic:0,roughness:0.8},
    kit_worktop:{baseColor:[0.07,0.07,0.075],metallic:0,roughness:0.45},
    kit_linen:{baseColor:[0.78,0.77,0.72],metallic:0,roughness:0.9},
    kit_cover:{baseColor:[0.2,0.26,0.34],metallic:0,roughness:0.9},
    kit_bulb:{baseColor:[0.95,0.9,0.75],metallic:0,roughness:0.4},
    kit_book1:{baseColor:[0.03,0.1,0.2],metallic:0,roughness:0.75},kit_book2:{baseColor:[0.45,0.08,0.03],metallic:0,roughness:0.75},
    kit_book3:{baseColor:[0.6,0.45,0.08],metallic:0,roughness:0.75},kit_book4:{baseColor:[0.08,0.2,0.1],metallic:0,roughness:0.75},
    kit_book5:{baseColor:[0.72,0.69,0.58],metallic:0,roughness:0.8},kit_book6:{baseColor:[0.2,0.03,0.03],metallic:0,roughness:0.75}};

  /* WHICH PIECE A THING IS, from its name. Only what is plainly one of them: "chairs" (several in one object), a
     car door, a street lamp or a window box are left as they are. A name that holds two things ("table and chairs",
     "door surround and lamp") is none; a thing named by where it is ("radiator under window", "chair by the door")
     is the thing before that word. */
  function pieceOf(name){
    // a note in brackets says where a thing is, not what it is: "chair (west, window)" is a chair
    const said=String(name||"").toLowerCase().replace(/\([^)]*\)/g," ").replace(/\bwith (an? )?([a-z]+ )?shades?\b/," ");   // "pendant with paper shade" is one lamp
    if(/[,&+\/]/.test(said)) return "";
    let n=" "+said.replace(/[^a-z0-9]+/g," ").replace(/ +/g," ").trim()+" ";
    if(/ (and|with) /.test(n)) return "";
    if(!/ run of (kitchen |base )?units /.test(n)){
      const cut=n.search(/ (under|above|below|beside|behind|near|by|next|over|on|in|at|to|for|of|from|against|along|across|between) /);
      if(cut===0) return ""; if(cut>0) n=n.slice(0,cut)+" ";
    }
    if(/ (lamp|pendant|lampshade) /.test(n)||/ (ceiling|pendant|hanging) light /.test(n))
      return / (street|post|column|head|tail|dome|strip|porch|wall|sodium|traffic|signal|oil|lava|desk|anglepoise|spot|torch|heat|sun) /.test(n)?"":"lamp";
    if(/ (cloth|leg|top|mat|runner|setting|football|tennis|pool|snooker) /.test(n)&&/ table /.test(n)) return "";
    if(/ (base|kitchen|galley|fitted|floor) (units?|cupboards?|cabinets?) /.test(n)||/ run of (kitchen |base )?units /.test(n)||(/ units /.test(n)&&/ (kitchen|galley) /.test(n))) return / wall /.test(n)?"":"units";
    if(/ (cooker|stove|oven) /.test(n)) return / (microwave|toaster|hood|glove|gloves|mitt|dutch|door|camping|wood|log) /.test(n)?"":"cooker";
    if(/ (fridge|refrigerator|freezer) /.test(n)) return / (magnets?|door|chest|drinks|display|mini) /.test(n)?"":"fridge";
    if(/ radiator /.test(n)) return / (shelf|cover|valve|pipe|car|grille|towel) /.test(n)?"":"radiator";
    if(/ (sofa|settee|couch) /.test(n)) return / (cushions?|arm|table|throw|corner) /.test(n)?"":"sofa";
    if(/ (bed|divan) /.test(n)) return / (bunk|flower|frame|head|side|linen|sheets?|river|truck|hospital|camp|dog|cat|day|sun) /.test(n)?"":"bed";
    if(/ (bookcase|bookcases|bookshelf|bookshelves) /.test(n)||/ book (case|shelf|shelves) /.test(n)||/ (shelving|shelves) /.test(n)) return / (wall|floating|corner) /.test(n)?"":"shelves";
    if(/ skirting( boards?)? /.test(n)) return "skirting";
    if(/ (rug|runner) /.test(n)) return / (table|bean|rail|road|stair) /.test(n)?"":"rug";
    if(/ (curtains?|drapes) /.test(n)) return / (net|shower|rail|pole|rod|strip|wall|tie|hooks?|rings?|track|pelmet|bead) /.test(n)?"":"curtains";
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
    window:e=>e.w>=0.3&&e.w<=3.2&&e.d<=0.3&&e.h>=0.3&&e.h<=2.7,
    sofa:e=>e.w>=1&&e.w<=3.4&&e.d>=0.6&&e.d<=1.25&&e.h>=0.55&&e.h<=1.15&&e.base<0.3,
    bed:e=>e.w>=0.7&&e.w<=2.3&&e.d>=1.6&&e.d<=2.4&&e.h>=0.3&&e.h<=1.6&&e.base<0.3,
    shelves:e=>e.w>=0.3&&e.w<=3.6&&e.d>=0.15&&e.d<=0.6&&e.h>=0.5&&e.h<=2.7&&e.base<0.3,
    cooker:e=>e.w>=0.45&&e.w<=1.1&&e.d>=0.45&&e.d<=0.75&&e.h>=0.8&&e.h<=1&&e.base<0.2,
    fridge:e=>e.w>=0.45&&e.w<=1&&e.d>=0.45&&e.d<=0.85&&e.h>=0.75&&e.h<=2.1&&e.base<0.2,
    skirting:e=>e.w>=0.3&&e.d<=0.06&&e.h>=0.04&&e.h<=0.3&&e.base<0.3,
    radiator:e=>e.w>=0.3&&e.w<=3&&e.d>=0.03&&e.d<=0.2&&e.h>=0.25&&e.h<=1&&e.base<=0.5,
    lamp:e=>Math.max(e.w,e.d)>=0.08&&Math.max(e.w,e.d)<=0.8&&e.h>=0.12&&e.h<=2.1,
    rug:e=>e.h<=0.05&&e.w>=0.4&&e.d>=0.4&&e.base<0.5,
    curtains:e=>e.w>=0.4&&e.w<=5&&e.d<=0.45&&e.h>=0.8&&e.h<=3.2};
  // a thing whose width is its long side whichever way its shapes were drawn; a bed's length is its long side
  const LONG={units:1,sofa:1,radiator:1,skirting:1,curtains:1,shelves:1};

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
       cooker, fridge   what stands on top of it stays
       sofa    a loose cushion or a throw in another colour stays
       rug     the rug is redrawn; anything else drawn with it stays
       shelves, lamp, curtains, skirting   one the dressing has already built in detail is left alone
     → {structure, kept, options} or null to leave the thing as it is */
  function split(piece,items){
    const big=items.slice().sort((a,b)=>volume(b)-volume(a))[0];
    if(piece==="door") return {structure:[big],kept:items.filter(o=>o!==big),options:{}};
    if(piece==="window") return items.length>2?null:{structure:[big],kept:items.filter(o=>o!==big),options:{}};
    if(piece==="rug") return {structure:[big],kept:items.filter(o=>o!==big),options:{}};
    if(items.some(o=>Math.abs(Number(arr(o.rotation)[0])||0)>0.02||Math.abs(Number(arr(o.rotation)[1])||0)>0.02)) return null;   // lying or leaning
    const wide=items.slice().sort((a,b)=>foot(b)-foot(a))[0], all=envelope(items,false);
    if(piece==="table") return wide.kind==="cylinder"||wide.kind==="torus"?null:{structure:items,kept:[],options:{}};
    if(piece==="chair"){
      const seat=topOf(wide)-all.base;
      return {structure:items,kept:[],options:items.length>1&&seat>=0.3&&seat<=0.6?{seat}:{}};
    }
    if(piece==="units"){
      const work=items.filter(o=>o.position[2]>all.base+0.6*all.h).sort((a,b)=>foot(b)-foot(a))[0];
      if(!work) return {structure:items,kept:[],options:{}};
      const kept=items.filter(o=>o!==work&&bottomOf(o)>=topOf(work)-0.02);
      return {structure:items.filter(o=>kept.indexOf(o)<0),kept,options:{second:work.material}};
    }
    if(piece==="cooker"||piece==="fridge"){
      const kept=items.filter(o=>o!==big&&bottomOf(o)>=topOf(big)-0.02), structure=items.filter(o=>kept.indexOf(o)<0), options={};
      if(piece==="fridge"){
        // where the dressing drew the line between its two doors, and the side its handle is on, stay
        const turn=Number(arr(big.rotation)[2])||0, own={centre:[big.position[0],big.position[1]],turn};
        const line=structure.find(o=>o!==big&&Math.abs(o.size[2])<=0.03&&Math.max(Math.abs(o.size[0]),Math.abs(o.size[1]))>=0.6*Math.min(Math.abs(big.size[0]),Math.abs(big.size[1])));
        const bar=structure.find(o=>o!==big&&Math.abs(o.size[2])>=0.15&&Math.max(Math.abs(o.size[0]),Math.abs(o.size[1]))<=0.06);
        if(line) options.seam=line.position[2]-all.base;
        if(bar) options.handle=[bar.position[0],bar.position[1]];
      }
      return {structure,kept,options};
    }
    if(piece==="sofa"){
      const tone=colours(items), seat=topOf(wide)-all.base;
      const kept=items.filter(o=>(o.kind==="cushion"||o.kind==="cloth")&&o.material!==tone.main&&o.position[2]>all.base+0.35&&volume(o)<0.08*volume(big));
      return {structure:items.filter(o=>kept.indexOf(o)<0),kept,options:items.length>1&&seat>=0.3&&seat<=0.55?{seat}:{}};
    }
    if(piece==="bed"){
      if(items.length<2) return {structure:items,kept:[],options:{roles:{cover:big.material}}};
      // a made bed: its frame is the colour of its headboard (or of its lowest shape), its cover that of its widest upper shape
      const tall=items.slice().sort((a,b)=>topOf(b)-topOf(a))[0], low=items.slice().sort((a,b)=>bottomOf(a)-bottomOf(b))[0];
      const frame=topOf(tall)-all.base>0.75&&foot(tall)<0.4*all.w*all.d?tall:low, top=topOf(wide)-all.base;
      const upper=items.filter(o=>o!==frame&&o.position[2]>all.base+0.3).sort((a,b)=>foot(b)-foot(a))[0];
      return {structure:items,kept:[],options:{roles:{frame:frame.material,...(upper?{cover:upper.material}:{})},...(top>=0.35&&top<=0.75?{top}:{})}};
    }
    if(piece==="shelves") return items.length>3?null:{structure:items,kept:[],options:{}};
    if(piece==="lamp") return items.length>4?null:{structure:items,kept:[],options:{}};
    if(piece==="curtains") return items.length>6||items.some(o=>o.kind==="cloth")?null:{structure:items,kept:[],options:{}};
    if(piece==="skirting") return items.length>1?null:{structure:items,kept:[],options:{}};
    return {structure:items,kept:[],options:{}};
  }
  // from a point to the nearest wall of the set: how far, and which way the wall lies (in the set's own axes)
  function wallNear(walls,p){
    let best=null;
    walls.forEach(o=>{
      const t=Number(arr(o.rotation)[2])||0, c=Math.cos(-t), s=Math.sin(-t), x=p[0]-o.position[0], y=p[1]-o.position[1];
      const lx=x*c-y*s, ly=x*s+y*c, qx=clamp(lx,-Math.abs(o.size[0])/2,Math.abs(o.size[0])/2), qy=clamp(ly,-Math.abs(o.size[1])/2,Math.abs(o.size[1])/2);
      const dx=qx-lx, dy=qy-ly, far=Math.hypot(dx,dy);
      if(!best||far<best.far) best={far,to:[dx*Math.cos(t)-dy*Math.sin(t),dx*Math.sin(t)+dy*Math.cos(t)]};
    });
    return best;
  }
  /* WHICH WAY A THING FACES. A piece has a front (+y): a chair's seat, a unit's doors. The set's shapes say which
     side that is: the back of a chair, a sofa or a bed is where its tall shapes are; the doors, handles and fins of
     a unit, a fridge, a cooker, a radiator or a bookcase are on the side its bulk is NOT pushed to. With no such
     sign, a chair that is one plain block faces the nearest table, and a thing that stands against a wall has its
     back to that wall. With no sign at all it stays as the set has it. → the box, turned */
  const BACKED={chair:1,sofa:1,bed:1}, FRONTED={units:1,fridge:1,cooker:1,radiator:1,shelves:1}, WALLED={units:1,fridge:1,cooker:1,radiator:1,shelves:1,sofa:1,bed:1};
  function facing(piece,e,items,tables,walls){
    let v=null;
    if(BACKED[piece]){
      const tall=items.filter(o=>topOf(o)>=e.base+0.8*e.h&&foot(o)<0.6*e.w*e.d);
      if(tall.length){
        let x=0,y=0,m=0; tall.forEach(o=>{ const q=local(e,o.position), k=volume(o); x+=q[0]*k; y+=q[1]*k; m+=k; });
        x/=m||1; y/=m||1;
        if(piece==="bed") x=0;                                                                       // a bed's head is at one of its ends
        if(Math.max(Math.abs(x)/(e.w/2),Math.abs(y)/(e.d/2))>=0.3) v=[-x/(e.w/2),-y/(e.d/2)];      // the front is away from the back
      }
      if(!v&&piece==="chair"){
        const near=arr(tables).map(t=>({t,far:Math.hypot(t[0]-e.centre[0],t[1]-e.centre[1])})).sort((a,b)=>a.far-b.far)[0];
        if(near&&near.far<=1.6&&near.far>0.05) v=local(e,near.t);
      }
    }
    if(!v&&FRONTED[piece]&&items.length>1){
      const big=items.slice().sort((a,b)=>volume(b)-volume(a))[0], q=local(e,big.position);
      // the bulk sits to the back; a long thing has only two sides to choose from
      if(LONG[piece]){ if(Math.abs(q[1])>=0.003) v=[0,-q[1]]; }
      else if(Math.max(Math.abs(q[0]),Math.abs(q[1]))>=0.003) v=[-q[0],-q[1]];
    }
    if(!v&&WALLED[piece]&&arr(walls).length){
      const near=wallNear(walls,e.centre);
      if(near&&near.far<=e.d/2+0.35&&near.far>0.001){
        const c=Math.cos(-e.turn), s=Math.sin(-e.turn), to=[near.to[0]*c-near.to[1]*s,near.to[0]*s+near.to[1]*c];
        // its back to the wall: a long thing or a bed only if the wall is along its length or at its end
        if(LONG[piece]||piece==="bed"){ if(Math.abs(to[1])>Math.abs(to[0])) v=[0,-to[1]]; }
        else v=[-to[0],-to[1]];
      }
    }
    return v?turned(e,frontTo(v)):e;
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
      if((LONG[piece]&&e.d>e.w)||(piece==="bed"&&e.w>e.d)) e=turned(e,Math.PI/2);
      if(!FITS[piece](e)) return;
      found.push({g,piece,flat,cut,e});
    });
    const tables=found.filter(f=>f.piece==="table").map(f=>f.e.centre);
    const walls=objects.filter(o=>o&&/^wall-/.test(String(o.id||""))&&Array.isArray(o.position)&&Array.isArray(o.size));
    let count=0;
    found.forEach(f=>{
      const g=f.g, piece=f.piece, cut=f.cut, e=facing(piece,f.e,cut.structure,tables,walls);
      const tone=f.flat?{main:cut.structure[0].material,second:""}:colours(cut.structure), c=Math.cos(e.turn), s=Math.sin(e.turn);
      const glazed=piece==="door"&&!cut.kept.length&&(/\b(glass|glazed|frosted|pane)\b/i.test(g.name));
      const more={base:e.base,seed:g.name+"@"+Math.round(e.centre[0]*10)+","+Math.round(e.centre[1]*10),books:piece==="shelves"&&/book/i.test(g.name),
        closed:/\b(closed|drawn|shut)\b/i.test(g.name),type:piece!=="lamp"?"":e.base>=1.2?"pendant":e.h>=1.1&&e.base<0.2?"floor":"table"};
      if(cut.options.handle) more.hand=local(e,cut.options.handle)[0]<0?-1:1;
      const made=PIECES[piece](e.w,e.d,e.h,{...more,...cut.options,glazed}).filter((p,i)=>!(piece==="door"&&i>0&&covers(e,p,cut.kept)));
      const second=cut.options.second||tone.second, roles=cut.options.roles||{}, plain=cut.structure.length<2;
      const pick=m=>roles[m]?roles[m]:m==="main"?tone.main:m==="second"?(second&&second!==tone.main?second:(piece==="units"?"kit_worktop":piece==="lamp"?shade(scene,tone.main,out):tone.main))
        :m==="shade"?shade(scene,tone.main,out):m==="frame"?(plain?shade(scene,tone.main,out):tone.main):/^book\d$/.test(m)?"kit_"+m:"kit_"+m;
      made.forEach(p=>{
        const material=pick(p[3]); if(MATERIALS[material]) out.materials[material]=MATERIALS[material];
        out.parts.push({id:"kit-"+(count++),name:g.name,kind:p[0],size:p[1].map(r3),
          position:[r3(e.centre[0]+p[2][0]*c-p[2][1]*s),r3(e.centre[1]+p[2][0]*s+p[2][1]*c),r3(e.base+p[2][2])],
          rotation:Array.isArray(p[4])?[p[4][0],p[4][1],r3(e.turn+p[4][2])]:[0,0,r3(e.turn+(p[4]||0))],material,kit:piece});
      });
      cut.structure.forEach(o=>out.hide.add(o.id));
      out.pieces.push({name:g.name,piece,parts:made.length,kept:cut.kept.length});
    });
    return out;
  }

  root.KinolotSetKit={PIECES,MATERIALS,FITS,pieceOf,envelope,split,facing,wallNear,seeded,expand};
})(typeof window!=="undefined"?window:globalThis);
