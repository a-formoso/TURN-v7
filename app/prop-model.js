/* PROPS IN CODE (owner 2026-11-22: "the props need to be represented in code first ... take the code version of that
   prop and have it locked in frame"; 2026-11-24: "let's build props in code so we can have them referenced in code so
   that image previs captures the exact size and this is ultimately translated by image models into shots").
   Until now a prop in a shot's drawing was one red box, and its size came from a loose read of the card's size text:
   "Phone ~16.2 cm tall x ~7.6 cm wide x ~0.9 cm deep" was drawn as a block 16 x 10 x 10 cm, a mug as a box.
   Here a prop is A MODEL: its true size in metres and its shape built from parts, as the furniture kit builds a chair.
     numbers(text)            the first measured run of a size text: [{v (metres), label}] or null
     formOf(name, formText)   which shape of the catalogue a prop is, from its name (then its form text); "" when none
     modelOf(card, thing)     {form, label, dims:[w, d, h], basis, parts} — basis: "set" (numbers set on the card),
                              "text" (read from its size text), "usual" (the usual size of such a thing), "guess"
     place(model, o)          the model as scene objects at o.centre, turned o.rz about Z; o.hang = it hangs, long and
                              flat to the wall. → {objects, size:[w, d, h] as it stands}
     sizeWords(dims)          "17 x 12 x 7 cm" (with the true multiplication sign)
     stage(model)             the model alone on a plain floor beside a ruler, with three cameras (the prop card)
     draft(card) / built(raw) a model BUILT for one prop by one writing pass, read safely (stage 2); saved(model), keep
     sheet(model)             the model as its reference sheet shows it: front, side, close-up (the layout of the sheet)
   A PART is the furniture kit's: [kind, [width, depth, height], [x, y, z], material, turn] — x across, y along its
   depth, z up from what it rests on, [x, y, z] its centre; material "main", "second", "dark" or "light"; turn a turn
   about Z or [x, y, z] turns. A model RESTS as such a thing rests on a table: a phone lies flat, a mug stands.
   Plain numbers only: the same model on every draw and every device. Nothing is saved here; the one engine call is
   draft(), which the person asks for on the prop's card. */
(function(root){
  "use strict";
  const arr=v=>Array.isArray(v)?v:[], obj=v=>v&&typeof v==="object"?v:{};
  const Q=Math.PI/2, r4=n=>Math.round(n*10000)/10000;
  const DEFAULT=[0.15,0.1,0.1];
  const TONES=["main","second","dark","light"];

  /* ---- parts ---- */
  const box=(s,p,m,t)=>["box",s,p,m||"main",t||0];
  const cyl=(w,d,h,p,m)=>["cylinder",[w,d,h],p,m||"main",0];
  const rod=(len,dia,p,m,turn)=>["cylinder",[dia,dia,len],p,m||"main",[0,Q,turn||0]];      // lying along x, turned about Z
  const ring=(wide,tall,thick,p,m,turn)=>["torus",[wide,tall,thick],p,m||"main",[Q,0,turn||0]]; // standing up, across x
  const hoop=(w,d,thick,p,m)=>["torus",[w,d,thick],p,m||"main",0];                         // lying flat
  const soft=(s,p,m,t)=>["cushion",s,p,m||"main",t||0];
  const ball=(s,p,m)=>["sphere",s,p,m||"main",0];
  const solid=(w,d,h)=>[box([w,d,h],[0,0,h/2])];
  const tube=(w,d,h)=>[cyl(w,d,h,[0,0,h/2])];
  const pad=(w,d,h)=>[soft([w,d,h],[0,0,h/2])];
  // a thing with a face on top: a phone and its screen, a tablet
  const slab=(w,d,h)=>[box([w,d,h*0.86],[0,0,h*0.43]),box([w*0.92,d*0.95,h*0.14],[0,0,h*0.93],"dark")];
  // a tub and its lid
  const lidded=(w,d,h)=>[box([w*0.93,d*0.9,h*0.84],[0,0,h*0.42]),box([w,d,h*0.16],[0,0,h*0.92],"second")];
  // a round thing in tiers, bottom to top: [[width share, height share, material]]
  const tiers=list=>(w,d,h)=>{ let z=0; return list.map(t=>{ const hh=h*t[1], p=cyl(w*t[0],d*t[0],hh,[0,0,z+hh/2],t[2]); z+=hh; return p; }); };
  // a long thing lying along x: a grip and the rest
  const shaft=(grip,m)=>(w,d,h)=>[rod(w*grip,Math.min(d,h),[-w*(1-grip)/2,0,h/2],"second"),rod(w*(1-grip),Math.min(d,h)*0.8,[w*grip/2,0,h/2],m||"main")];
  function mug(w,d,h){
    const out=w-d, x=-out/2;   // the body is as wide as the mug is deep; its handle takes the rest of the width
    return [cyl(d,d,h,[x,0,h/2]),cyl(d*0.84,d*0.84,h*0.03,[x,0,h*0.99],"dark"),ring(out*2,h*0.66,Math.max(0.006,d*0.12),[x+d/2,0,h*0.5])];
  }
  function keys(w,d,h){
    const r=Math.min(d*0.5,w*0.28), t=Math.max(0.0015,h*0.18);
    return [hoop(r,r,t,[0,0,t/2],"light"),
      box([w*0.42,d*0.16,t],[w*0.27,d*0.18,t/2],"light",0.38),box([w*0.4,d*0.15,t],[w*0.28,-d*0.14,t/2],"light",-0.3),   // two keys, fanned
      box([w*0.26,d*0.34,h*0.9],[w*0.05,-d*0.02,h*0.45],"dark",0.1),                                                     // the car key's head
      box([w*0.3,d*0.62,h*0.5],[-w*0.33,0,h*0.25],"second",-0.12)];                                                      // the fob
  }
  function book(w,d,h){
    return [box([w,d,h*0.1],[0,0,h*0.05]),box([w*0.95,d*0.96,h*0.8],[w*0.02,0,h*0.5],"light"),box([w,d,h*0.1],[0,0,h*0.95]),box([w*0.05,d,h],[-w*0.475,0,h/2])];
  }
  function bag(w,d,h){ return [soft([w,d,h*0.86],[0,0,h*0.43]),ring(w*0.5,h*0.3,Math.max(0.008,d*0.08),[0,0,h*0.85],"second")]; }
  function pack(w,d,h){ return [soft([w,d,h*0.9],[0,0,h*0.45]),soft([w*0.7,d*0.35,h*0.4],[0,d*0.42,h*0.3],"second"),ring(w*0.3,h*0.14,0.012,[0,-d*0.2,h*0.92],"dark")]; }
  function suitcase(w,d,h){ return [box([w,d,h*0.9],[0,0,h*0.45]),box([w*0.3,d*0.14,h*0.1],[0,0,h*0.95],"dark"),box([w*1.0,d*1.02,h*0.02],[0,0,h*0.45],"second")]; }
  function carrier(w,d,h){ return [soft([w,d,h*0.8],[0,0,h*0.4]),ring(w*0.34,h*0.36,0.006,[0,d*0.2,h*0.82],"second"),ring(w*0.34,h*0.36,0.006,[0,-d*0.2,h*0.82],"second")]; }
  function parcel(w,d,h){ return [box([w,d,h],[0,0,h/2]),box([w*0.14,d*1.005,h*0.01],[0,0,h*1.0],"second")]; }
  function envelope(w,d,h){ return [box([w,d,h],[0,0,h/2],"light"),box([w*0.98,d*0.42,h*0.3],[0,d*0.28,h*1.1],"second")]; }
  function frame(w,d,h){ return [box([w,d,h],[0,0,h/2]),box([w*0.8,d*0.3,h*0.8],[0,d*0.4,h/2],"light")]; }
  function knife(w,d,h){ return [box([w*0.38,d*0.7,h],[-w*0.31,0,h/2],"dark"),box([w*0.62,d,h*0.25],[w*0.19,0,h/2],"light")]; }
  function gun(w,d,h){ return [box([w,d*0.3,h],[0,d*0.35,h/2]),box([w*0.26,d*0.72,h*0.9],[-w*0.3,-d*0.14,h/2],"second",0.2),hoop(w*0.2,d*0.24,h*0.4,[-w*0.08,d*0.1,h/2],"dark")]; }
  function rifle(w,d,h){ return [rod(w*0.62,h*0.5,[w*0.19,d*0.2,h/2],"dark"),box([w*0.4,d*0.6,h],[-w*0.3,-d*0.05,h/2],"second",0.12),box([w*0.2,d*0.3,h*0.9],[-w*0.02,d*0.05,h/2])]; }
  function torch(w,d,h){ return [rod(w*0.72,Math.min(d,h)*0.7,[-w*0.14,0,h/2]),rod(w*0.28,Math.min(d,h),[w*0.36,0,h/2],"second")]; }
  function camera(w,d,h){ return [box([w,d*0.55,h*0.85],[0,-d*0.2,h*0.425]),["cylinder",[h*0.6,h*0.6,d*0.5],[0,d*0.24,h*0.42],"dark",[Q,0,0]],box([w*0.3,d*0.4,h*0.15],[-w*0.2,-d*0.2,h*0.925],"second")]; }
  function radio(w,d,h){ return [box([w,d,h*0.92],[0,0,h*0.46]),box([w*0.55,d*0.1,h*0.6],[-w*0.16,d*0.5,h*0.46],"dark"),rod(w*0.5,0.008,[w*0.1,-d*0.3,h*0.96],"light")]; }
  function shoes(w,d,h){
    const one=x=>[box([w*0.42,d,h*0.2],[x,0,h*0.1],"dark"),soft([w*0.4,d*0.6,h*0.8],[x,-d*0.19,h*0.6]),soft([w*0.4,d*0.5,h*0.42],[x,d*0.24,h*0.38])];
    return one(-w*0.27).concat(one(w*0.27));
  }
  function hat(w,d,h){ return [cyl(w,d,h*0.14,[0,0,h*0.07]),soft([w*0.66,d*0.66,h*0.9],[0,0,h*0.55])]; }
  function pan(w,d,h){ const x=-(w-d)/2; return [cyl(d,d,h*0.8,[x,0,h*0.4]),cyl(d*0.9,d*0.9,h*0.06,[x,0,h*0.8],"dark"),rod(w-d,Math.max(0.015,h*0.35),[x+d/2+(w-d)/2,0,h*0.7],"second")]; }
  function pot(w,d,h){ return [cyl(d,d,h*0.82,[0,0,h*0.41]),cyl(d*1.02,d*1.02,h*0.1,[0,0,h*0.87],"second"),ball([d*0.14,d*0.14,h*0.14],[0,0,h*0.95],"dark"),
    box([(w-d)/2,d*0.16,h*0.1],[-(d/2+(w-d)/4),0,h*0.7],"dark"),box([(w-d)/2,d*0.16,h*0.1],[d/2+(w-d)/4,0,h*0.7],"dark")]; }
  function kettle(w,d,h){ const x=-(w-d)/2; return [cyl(d,d,h*0.78,[x,0,h*0.39]),cyl(d*0.6,d*0.6,h*0.08,[x,0,h*0.82],"second"),
    ring(d*0.8,h*0.36,Math.max(0.012,d*0.1),[x,0,h*0.82],"dark"),box([w-d,d*0.2,h*0.16],[x+d/2+(w-d)/2-0.004,0,h*0.62],"main",[0,-0.5,0])]; }
  function toy(w,d,h){ return [soft([w*0.8,d,h*0.55],[0,0,h*0.3]),ball([w*0.62,d*0.9,h*0.4],[0,0,h*0.76]),ball([w*0.2,d*0.3,h*0.14],[-w*0.26,0,h*0.95],"second"),ball([w*0.2,d*0.3,h*0.14],[w*0.26,0,h*0.95],"second"),
    soft([w*0.22,d*0.5,h*0.3],[-w*0.38,d*0.1,h*0.38],"second"),soft([w*0.22,d*0.5,h*0.3],[w*0.38,d*0.1,h*0.38],"second")]; }
  function tool(w,d,h){ return [rod(w*0.72,Math.min(d*0.3,h),[-w*0.14,0,h/2],"second"),box([w*0.24,d,h],[w*0.38,0,h/2],"dark")]; }
  function plate(w,d,h){ return [cyl(w*0.55,d*0.55,h*0.4,[0,0,h*0.2]),cyl(w,d,h*0.6,[0,0,h*0.7]),cyl(w*0.7,d*0.7,h*0.05,[0,0,h*1.0],"second")]; }
  function bowl(w,d,h){ return [cyl(w*0.5,d*0.5,h*0.3,[0,0,h*0.15]),cyl(w,d,h*0.7,[0,0,h*0.65]),cyl(w*0.86,d*0.86,h*0.04,[0,0,h*0.99],"dark")]; }
  function clock(w,d,h){ return [["cylinder",[w,h,d],[0,0,h/2],"main",[Q,0,0]],["cylinder",[w*0.84,h*0.84,d*0.2],[0,d*0.5,h/2],"light",[Q,0,0]]]; }
  function bucket(w,d,h){ return [cyl(w*0.8,d*0.8,h*0.5,[0,0,h*0.25]),cyl(w,d,h*0.5,[0,0,h*0.75]),ring(w*0.9,h*0.5,0.008,[0,0,h*0.98],"dark")]; }
  function umbrella(w,d,h){ return [rod(w*0.8,Math.min(d,h)*0.8,[w*0.1,0,h/2]),rod(w*0.2,Math.min(d,h)*0.3,[-w*0.4,0,h/2],"dark")]; }
  function candle(w,d,h){ return [cyl(w,d,h*0.94,[0,0,h*0.47],"light"),cyl(w*0.12,d*0.12,h*0.06,[0,0,h*0.97],"dark")]; }
  function wallet(w,d,h){ return [soft([w,d,h],[0,0,h/2]),box([w*0.02,d*0.9,h*0.5],[w*0.3,0,h/2],"dark")]; }
  function badge(w,d,h){ return [box([w,d,h*0.8],[0,0,h*0.4]),box([w*0.36,d*0.62,h*0.2],[-w*0.22,0,h*0.9],"light")]; }
  function sign(w,d,h){ return [box([w,d,h],[0,0,h/2],"light"),box([w*0.9,d*1.2,h*0.7],[0,0,h/2],"dark")]; }

  /* ---- the catalogue ----
     {id, label (what it is, for people), size: its usual [w, d, h] as it rests, end: words the name ENDS with,
      any: words anywhere in the name, make(w, d, h), loose: its size text measures its pieces, never the whole}.
     The first form that fits wins, so the narrow ones stand before the wide ones. */
  const F=(id,label,size,end,make,o)=>({id,label,size,end,make,...(o||{})});
  const FORMS=[
    F("matchbox","a matchbox",[0.053,0.036,0.015],"matchbox|matches",solid,{any:"box of matches|matchbox"}),
    F("cigarette-pack","a cigarette packet",[0.055,0.088,0.022],"cigarettes|fags",solid,{any:"(?:packet|pack|box) of (?:cigarettes|fags)|cigarette (?:packet|pack|box)"}),
    F("ring-box","a small jewellery box",[0.055,0.055,0.045],"ring box|jewellery box|jewelry box",lidded),
    F("number-plate","a number plate",[0.52,0.012,0.11],"number ?plate|licen[cs]e plate",sign),
    F("frame","a framed picture",[0.2,0.03,0.25],"frame|portrait|painting|mirror",frame,{any:"framed"}),
    F("badge","a card wallet",[0.11,0.075,0.012],"warrant card|badge|id wallet|badge wallet|police id|credentials",badge),
    F("passport","a passport",[0.088,0.125,0.006],"passport",solid),
    F("card","a card",[0.086,0.054,0.002],"card|licen[cs]e|ticket|pass|permit|voucher",solid),
    F("keys","a bunch of keys",[0.11,0.06,0.014],"keys?|key ?ring|fob|keychain",keys,{loose:true}),
    F("phone","a phone",[0.076,0.162,0.009],"phone|mobile|handset|smartphone|iphone|cellphone",slab),
    F("tablet","a tablet",[0.18,0.25,0.008],"tablet|ipad|e-?reader|kindle",slab),
    F("laptop","a laptop",[0.32,0.22,0.02],"laptop|macbook",(w,d,h)=>[box([w,d,h*0.55],[0,0,h*0.275]),box([w,d,h*0.42],[0,0,h*0.79],"second")]),
    F("remote","a remote control",[0.05,0.2,0.02],"remote|remote control|controller|walkie-?talkie",slab),
    F("pouch","a flat bag",[0.15,0.23,0.02],"evidence bag|zip ?lock bag|ziplock|sandwich bag|freezer bag|pouch|sachet|packet",pad),
    F("carrier","a carrier bag",[0.35,0.14,0.42],"carrier bag|shopping bag|plastic bag|paper bag|tote bag|tote|bag for life|shopping",carrier),
    F("backpack","a backpack",[0.3,0.18,0.45],"backpack|rucksack|school ?bag|knapsack",pack),
    F("suitcase","a suitcase",[0.45,0.25,0.65],"suitcase|luggage|trunk",suitcase),
    F("briefcase","a briefcase",[0.42,0.1,0.31],"briefcase|attache case|laptop bag",suitcase),
    F("holdall","a holdall",[0.55,0.28,0.28],"holdall|duffel bag|duffle bag|duffel|duffle|gym bag|kit ?bag|sports bag|bin bag|sack",bag),
    F("handbag","a bag",[0.32,0.13,0.24],"handbag|shoulder bag|satchel|clutch|bag",bag),
    F("wallet","a wallet",[0.11,0.09,0.02],"wallet|purse|billfold",wallet),
    F("tub","a food tub",[0.19,0.13,0.08],"tupperware|tub|container|lunch ?box|food box|takeaway box|takeaway|tin|casserole dish",lidded,{any:"tupperware"}),
    F("mug","a mug",[0.115,0.082,0.095],"mug|cup|teacup|tea|coffee|cuppa",mug,{round:true}),
    F("glass","a glass",[0.07,0.07,0.12],"glass|tumbler|pint|beaker",tiers([[1,0.97,"light"],[0.88,0.03,"dark"]]),{round:true}),
    F("can","a can",[0.066,0.066,0.122],"can|lager|cola|soda",tiers([[1,0.95],[0.86,0.05,"light"]]),{round:true}),
    F("pills","a pill bottle",[0.05,0.05,0.09],"pills|pill bottle|tablets|medicine|medication|painkillers",tiers([[1,0.76],[1.04,0.24,"light"]]),{round:true}),
    F("jar","a jar",[0.085,0.085,0.13],"jar|pot of jam|jam|honey|pickle",tiers([[1,0.85,"light"],[1.03,0.15,"second"]]),{round:true}),
    F("bottle","a bottle",[0.075,0.075,0.26],"bottle|flask|thermos|wine|beer|whisky|whiskey|vodka|milk|water",tiers([[1,0.66],[0.7,0.08],[0.38,0.2],[0.42,0.06,"second"]]),{round:true}),
    F("vase","a jug or vase",[0.14,0.14,0.26],"vase|urn|jug|pitcher|carafe",tiers([[0.7,0.12],[1,0.5],[0.6,0.3],[0.72,0.08]]),{round:true}),
    F("plate","a plate",[0.26,0.26,0.025],"plate|dish|saucer",plate,{round:true}),
    F("bowl","a bowl",[0.16,0.16,0.07],"bowl",bowl,{round:true}),
    F("tray","a tray",[0.42,0.3,0.03],"tray",(w,d,h)=>[box([w,d,h*0.4],[0,0,h*0.2]),box([w,d*0.04,h],[0,d*0.48,h/2]),box([w,d*0.04,h],[0,-d*0.48,h/2])]),
    F("pan","a pan",[0.45,0.26,0.06],"pan|frying pan|skillet|wok",pan),
    F("kettle","a kettle",[0.22,0.16,0.24],"kettle|teapot",kettle),
    F("pot","a cooking pot",[0.3,0.22,0.13],"pot|saucepan|casserole|stockpot",pot),
    F("knife","a knife",[0.3,0.035,0.02],"knife|blade|dagger|cleaver|machete|scalpel|razor",knife),
    F("cutlery","a spoon or fork",[0.2,0.03,0.01],"spoon|fork|cutlery|chopsticks|ladle|spatula",(w,d,h)=>[box([w*0.7,d*0.3,h],[-w*0.15,0,h/2],"light"),soft([w*0.3,d,h],[w*0.35,0,h/2],"light")]),
    F("folder","a folder",[0.24,0.32,0.02],"folder|file|clipboard|binder|dossier",book),
    F("newspaper","a newspaper",[0.3,0.38,0.012],"newspaper|magazine|tabloid",(w,d,h)=>[box([w,d,h],[0,0,h/2],"light"),box([w*0.9,d*0.16,h*0.1],[0,d*0.36,h*1.02],"dark")]),
    F("book","a book",[0.15,0.21,0.025],"book|notebook|diary|journal|bible|quran|koran|ledger|logbook|album|paperback|novel|sketchbook|notepad|pad",book),
    F("envelope","an envelope",[0.22,0.11,0.004],"envelope",envelope),
    F("photo","a photograph",[0.15,0.1,0.001],"photo|photograph|polaroid|snapshot|picture|print|postcard",(w,d,h)=>[box([w,d,h],[0,0,h/2],"light")]),
    F("sheet","a sheet of paper",[0.21,0.297,0.001],"letter|page|document|note|form|leaflet|flyer|receipt|map|list|contract|bill|invoice|certificate|drawing|sheet|paper|papers|warrant|summons|menu|script|printout|poster|statement|report",(w,d,h)=>[box([w,d,h],[0,0,h/2],"light")]),
    F("money","a wad of notes",[0.147,0.077,0.012],"cash|money|notes|banknotes?|wad|fiver|tenner|fare",(w,d,h)=>[box([w,d,h],[0,0,h/2],"light"),box([w*0.08,d*1.01,h*1.05],[0,0,h/2],"second")]),
    F("coins","coins",[0.027,0.027,0.008],"coins?|change|penny|pennies",tiers([[1,0.4,"light"],[0.96,0.3,"light"],[1,0.3,"light"]]),{round:true}),
    F("box","a box",[0.35,0.25,0.2],"box|crate|parcel|package|carton|delivery|toolbox|chest",parcel),
    F("rifle","a long gun",[1,0.18,0.06],"rifle|shotgun",rifle),
    F("gun","a handgun",[0.19,0.135,0.032],"gun|pistol|revolver|firearm|handgun|taser",gun),
    F("torch","a torch",[0.16,0.04,0.04],"torch|flashlight",torch),
    F("needle","a needle",[0.038,0.001,0.001],"needle|pin",(w,d,h)=>[rod(w,Math.min(d,h),[0,0,h/2],"light")]),
    F("syringe","a syringe",[0.12,0.016,0.016],"syringe|injection",shaft(0.3,"light")),
    F("pen","a pen",[0.14,0.011,0.011],"pen|pencil|biro|marker|stylus",shaft(0.3)),
    F("cigarette","a cigarette",[0.084,0.008,0.008],"cigarette|fag|joint|cigar|vape",shaft(0.3,"light")),
    F("lighter","a lighter",[0.025,0.08,0.012],"lighter",(w,d,h)=>[box([w,d*0.78,h],[0,-d*0.11,h/2]),box([w,d*0.22,h],[0,d*0.39,h/2],"light")]),
    F("camera","a camera",[0.13,0.07,0.09],"camera|camcorder",camera),
    F("radio","a radio",[0.24,0.08,0.14],"radio|speaker|recorder",radio),
    F("ring","a ring",[0.021,0.021,0.005],"ring|band",(w,d,h)=>[hoop(w,d,h,[0,0,h/2],"light")],{round:true}),
    F("chain","a chain",[0.14,0.14,0.004],"necklace|chain|bracelet|bangle|rosary|beads",(w,d,h)=>[hoop(w,d,h,[0,0,h/2],"light")],{round:true}),
    F("rope","a coil",[0.3,0.3,0.06],"rope|cable|hose|wire|lead|leash|tape",(w,d,h)=>[hoop(w,d,h,[0,0,h/2])],{round:true}),
    F("umbrella","an umbrella",[0.9,0.06,0.06],"umbrella|brolly",umbrella),
    F("stick","a stick",[0.9,0.03,0.03],"stick|cane|baton|truncheon|pole|rod|crowbar|bat|club|broom|mop",shaft(0.18)),
    F("tool","a hand tool",[0.3,0.1,0.03],"hammer|spanner|wrench|pliers|screwdriver|tool|mallet",tool),
    F("shoes","a pair of shoes",[0.24,0.29,0.11],"shoes?|boots?|trainers?|sneakers?|sandals?|slippers?|heels|loafers",shoes),
    F("helmet","a helmet",[0.25,0.3,0.25],"helmet",(w,d,h)=>[soft([w,d,h],[0,0,h/2]),box([w*0.8,d*0.1,h*0.3],[0,d*0.46,h*0.45],"dark")]),
    F("hat","a hat",[0.28,0.3,0.12],"hat|cap|beanie|turban",hat),
    F("clothes","folded clothes",[0.38,0.3,0.08],"coat|jacket|shirt|jumper|sweater|dress|uniform|scarf|towel|cloth|rag|blanket|apron|vest|gown|hoodie|trousers|jeans|sari|shawl|hijab|handkerchief|tissue|laundry",pad),
    F("ball","a ball",[0.22,0.22,0.22],"ball|football|globe",(w,d,h)=>[ball([w,d,h],[0,0,h/2])],{round:true}),
    F("toy","a soft toy",[0.2,0.14,0.3],"teddy|teddy bear|doll|toy|bear",toy),
    F("loaf","a loaf",[0.25,0.12,0.11],"loaf|bread",pad),
    F("fruit","a piece of fruit",[0.075,0.075,0.07],"apple|orange|fruit|egg|onion|potato|tomato|lemon|mango",(w,d,h)=>[ball([w,d,h],[0,0,h/2])],{round:true}),
    F("snack","a snack",[0.12,0.12,0.05],"sandwich|toast|samosa|pastry|cake|biscuit|roti|chapati",pad),
    F("flowers","a bunch of flowers",[0.25,0.25,0.45],"flowers|bouquet|roses|plant",(w,d,h)=>[cyl(w*0.16,d*0.16,h*0.55,[0,0,h*0.275],"second"),soft([w,d,h*0.5],[0,0,h*0.75])]),
    F("candle","a candle",[0.03,0.03,0.18],"candle",candle,{round:true}),
    F("clock","a clock",[0.25,0.05,0.25],"clock",clock),
    F("bucket","a bucket",[0.3,0.3,0.28],"bucket|bin|basket|pail",bucket,{round:true}),
    F("sign","a sign",[0.5,0.02,0.3],"sign|placard|board",sign)
  ];
  FORMS.forEach(f=>{ f.endRe=new RegExp("(?:^|[\\s-])(?:"+f.end+")$"); f.anyRe=f.any?new RegExp("(?:^|[\\s-])(?:"+f.any+")(?:$|[\\s,.])"):null; });
  const formById=id=>FORMS.find(f=>f.id===String(id||""))||null;
  const forms=()=>FORMS.map(f=>({id:f.id,label:f.label,size:f.size.slice()})).sort((a,b)=>a.label.replace(/^an? /,"").localeCompare(b.label.replace(/^an? /,"")));

  /* WHICH SHAPE A PROP IS, from its name: the words its name ENDS with, once what follows a "with", "of", "for", a
     comma or a bracket is cut ("Mug of tea" is a mug, "Cab keys with Crystal Palace fob" keys, "Pike's warrant card"
     a card wallet). A "phone charger" ends with a word the catalogue does not know, so it is no phone: none. When the
     name tells nothing, the first clause of the card's form text is read the same way. */
  const CUT=/\s*(?:\(|,|;|:|\s[—–-]\s|\s(?:with|of|for|in|on|from|under|inside|by|and|that|which|at|around)\s)/;
  const plainWords=t=>String(t||"").toLowerCase().replace(/[’']s\b/g,"").replace(/[’'"“”]/g,"").replace(/\s+/g," ").trim();
  function read(text){
    const all=plainWords(text); if(!all) return null;
    const hit=FORMS.find(f=>f.anyRe&&f.anyRe.test(all)); if(hit) return hit;
    const head=all.split(CUT)[0].replace(/[^a-z0-9 -]/g," ").replace(/\s+/g," ").trim(); if(!head) return null;
    return FORMS.find(f=>f.endRe.test(head))||null;
  }
  function formOf(name,formText){ const f=read(name)||read(String(formText||"").split(/[.!?]/)[0]); return f?f.id:""; }

  /* THE NUMBERS OF A SIZE TEXT. A card's size is written for people: "Base ~17 cm long x ~12 cm wide x ~7 cm deep
     (~1 L). Lid ~18 cm long ...". The first measured run is the thing itself (its lid, its screen, how it opens come
     after): numbers joined by x, each with its unit or sharing the run's, each with its word when it has one.
     → [{v: metres, label: "long" | "wide" | "tall" | "deep" | "dia" | ""}], or null when no number has a unit. */
  const UNIT={mm:0.001,cm:0.01,m:1,"in":0.0254,inch:0.0254,inches:0.0254};
  const NUM="(\\d+(?:\\.\\d+)?)(?:\\s*[\\u2013-]\\s*\\d+(?:\\.\\d+)?)?\\s*(mm|cm|m|inches|inch|in)?\\b(?:\\s*(?:in\\s+)?(long|length|wide|width|across|tall|high|height|deep|depth|thick|diameter|dia)\\b)?";
  const JOIN="\\s*(?:\\u00d7|\\bx\\b|\\bby\\b)\\s*(?:~|\\u2248|about\\s+|approx\\.?\\s+|c\\.\\s*)?";
  const LABEL={long:"long",length:"long",wide:"wide",width:"wide",across:"dia",tall:"tall",high:"tall",height:"tall",deep:"deep",depth:"deep",thick:"deep",diameter:"dia",dia:"dia"};
  function numbers(text){
    const t=String(text||"").toLowerCase().replace(/(\d),(\d)/g,"$1.$2");
    const run=new RegExp(NUM+"(?:"+JOIN+NUM+")?(?:"+JOIN+NUM+")?","g");
    let m;
    while((m=run.exec(t))){
      if(m[0]==="") { run.lastIndex++; continue; }
      const got=[];
      for(let i=1;i<m.length;i+=3) if(m[i]!=null) got.push({n:Number(m[i]),u:m[i+1]||"",label:LABEL[m[i+2]||""]||""});
      const unit=(got.slice().reverse().find(g=>g.u)||{}).u; if(!unit) continue;          // "no. 7", "1 L": not a length
      let last=""; for(let i=got.length-1;i>=0;i--){ if(got[i].u) last=got[i].u; else got[i].u=last||unit; }
      const out=got.map(g=>({v:g.n*UNIT[g.u],label:g.label})).filter(g=>g.v>0&&g.v<20);
      if(out.length) return out;
    }
    return null;
  }
  /* A RUN OF NUMBERS ON A KNOWN SHAPE. The words of a size text follow how the thing was described (a phone "tall",
     a tub "deep"), not how it rests, so the numbers are given to the shape's own proportions: its largest to the axis
     the shape is largest on, and so on. A round thing takes its diameter across and its other number as its height. */
  function fit(form,run){
    const s=form.size, order=[0,1,2].sort((a,b)=>s[b]-s[a]), out=[0,0,0];
    const dia=run.find(t=>t.label==="dia");
    if(form.round&&dia){ const other=run.find(t=>t!==dia); out[1]=dia.v; out[0]=dia.v*s[0]/s[1]; out[2]=other?other.v:dia.v*s[2]/s[1]; return out; }
    const v=run.map(t=>t.v).sort((a,b)=>b-a), near=(a,b)=>Math.abs(s[a]-s[b])<=Math.max(s[a],s[b])*0.03;
    if(v.length>=3){ order.forEach((axis,i)=>{ out[axis]=v[i]; }); return out; }
    if(v.length===2){
      if(near(order[0],order[1])){ out[order[0]]=v[0]; out[order[1]]=v[0]*s[order[1]]/s[order[0]]; out[order[2]]=v[1]; }        // flat and round: a plate
      else if(near(order[1],order[2])){ out[order[0]]=v[0]; out[order[1]]=v[1]; out[order[2]]=v[1]*s[order[2]]/s[order[1]]; }   // long and round: a bottle, a pen
      else { out[order[0]]=v[0]; out[order[1]]=v[1]; out[order[2]]=v[1]*s[order[2]]/s[order[1]]; }
      return out; }
    const k=v[0]/s[order[0]]; return s.map(n=>n*k);
  }
  // a run of numbers on a thing of no known shape: a box, by the words it has
  function plain(run){
    const out=[0,0,0], free=[];
    run.forEach(t=>{ const axis=t.label==="tall"?2:t.label==="wide"?0:t.label==="deep"?1:t.label==="long"?(out[0]?1:0):-1;
      if(t.label==="dia"&&!out[0]&&!out[1]){ out[0]=t.v; out[1]=t.v; } else if(axis>=0&&!out[axis]) out[axis]=t.v; else free.push(t.v); });
    free.sort((a,b)=>b-a); [0,2,1].forEach(axis=>{ if(!out[axis]&&free.length) out[axis]=free.shift(); });
    const given=out.filter(n=>n>0), small=Math.min(...given);
    if(given.length===1) return out.map(n=>n||small*0.6);
    return out.map(n=>n||Math.min(small,0.02));
  }

  /* THE MODEL OF A PROP. card = its prop card ({name, size, dims, form, modelForm, detail}), thing = the scene plan's
     tracked thing when it has no card ({name, size, detail}). A model built for this prop (card.model) is the prop:
     its parts and its size (the card's three numbers, when set, resize it). Else: the card's own numbers (dims) are exact and win; then
     its size text; then the usual size of such a thing; a thing of no known shape and no numbers is a small box and
     says it is a guess. */
  function modelOf(card,thing){
    const c=obj(card), t=obj(thing), name=String(c.name||t.name||"");
    const form=formById(c.modelForm)||formById(formOf(name,c.form))||null;
    const own=arr(c.dims).map(Number).filter(n=>n>0&&n<20);
    let dims, basis;
    // a model BUILT for this prop (stage 2: saved on its card) is the prop itself; a shape picked by hand still wins
    const mine=!formById(c.modelForm)&&saved(c.model);
    if(mine){
      if(own.length!==3) return {form:"built",label:mine.what||"its own model",dims:mine.dims.slice(),basis:"built",parts:mine.parts,colours:mine.colours,built:true};
      const k=own.map((n,i)=>n/mine.dims[i]);
      return {form:"built",label:mine.what||"its own model",dims:own.map(r4),basis:"set",colours:mine.colours,built:true,
        parts:mine.parts.map(q=>{ const M=turnOf(q[4]); return [q[0],[0,1,2].map(j=>r4(q[1][j]*(Math.abs(M[0][j])*k[0]+Math.abs(M[1][j])*k[1]+Math.abs(M[2][j])*k[2])/((Math.abs(M[0][j])+Math.abs(M[1][j])+Math.abs(M[2][j]))||1))),q[2].map((n,i)=>r4(n*k[i])),q[3],q[4]]; })};
    }
    if(own.length===3){ dims=own; basis="set"; }
    else{
      const run=form&&form.loose?null:(numbers(c.size)||numbers(c.detail)||numbers(t.size)||numbers(t.detail));
      if(run){ dims=form?fit(form,run):plain(run); basis="text"; }
      else if(form){ dims=form.size.slice(); basis="usual"; }
      else{ dims=DEFAULT.slice(); basis="guess"; }
    }
    dims=dims.map(n=>r4(Math.max(0.0005,Math.min(20,Number(n)||0.0005))));
    const parts=(form?form.make(dims[0],dims[1],dims[2]):solid(dims[0],dims[1],dims[2])).filter(p=>p&&p[1].every(n=>Number.isFinite(n))&&p[2].every(n=>Number.isFinite(n)));
    return {form:form?form.id:"",label:form?form.label:"a plain box",dims,basis,parts};
  }

  /* ---- putting a model in a scene ---- */
  const mul=(A,B)=>A.map(r=>[0,1,2].map(j=>r[0]*B[0][j]+r[1]*B[1][j]+r[2]*B[2][j]));
  const Rx=a=>{ const c=Math.cos(a), s=Math.sin(a); return [[1,0,0],[0,c,-s],[0,s,c]]; };
  const Ry=a=>{ const c=Math.cos(a), s=Math.sin(a); return [[c,0,s],[0,1,0],[-s,0,c]]; };
  const Rz=a=>{ const c=Math.cos(a), s=Math.sin(a); return [[c,-s,0],[s,c,0],[0,0,1]]; };
  const turnOf=t=>{ const r=typeof t==="number"?[0,0,t]:arr(t); return mul(Rz(Number(r[2])||0),mul(Ry(Number(r[1])||0),Rx(Number(r[0])||0))); };
  // the three turns [x, y, z] (applied x, then y, then z) that make a rotation
  function turnsFrom(M){
    const sy=-M[2][0];
    if(Math.abs(sy)>0.99999) return [Math.atan2(sy>0?M[0][1]:-M[0][1],M[1][1]),sy>0?Q:-Q,0];
    return [Math.atan2(M[2][1],M[2][2]),Math.asin(sy),Math.atan2(M[1][0],M[0][0])];
  }
  const apply=(M,p)=>M.map(r=>r[0]*p[0]+r[1]*p[1]+r[2]*p[2]);
  /* HANGING: long and flat to the wall. The model's longest side goes down the wall, its thinnest sticks out from it
     (+y of the placed thing), the third lies across. */
  function hung(dims){
    const order=[0,1,2].sort((a,b)=>dims[b]-dims[a]), O=[[0,0,0],[0,0,0],[0,0,0]];
    O[2][order[0]]=1; O[0][order[1]]=1; O[1][order[2]]=1;
    const det=O[0][0]*(O[1][1]*O[2][2]-O[1][2]*O[2][1])-O[0][1]*(O[1][0]*O[2][2]-O[1][2]*O[2][0])+O[0][2]*(O[1][0]*O[2][1]-O[1][1]*O[2][0]);
    if(det<0) O[0][order[1]]=-1;
    return {O,size:[dims[order[1]],dims[order[2]],dims[order[0]]]};
  }
  const MATERIALS={main:"prop-standin",second:"prop-standin-2",dark:"prop-standin-3",light:"prop-standin-4"};
  /* o: {id, name, centre:[x, y, z] (the middle of the box it fills), rz (its turn about Z), hang (it hangs),
     materials:{main, second, dark, light} (the scene's own names)}. → {objects, size:[w, d, h] as it stands} */
  function place(model,o){
    o=obj(o);
    // o.stand: a thing that lies flat stood up on its far edge, its top face to the front (+y): how a sheet shows a phone
    const m=obj(model), dims=arr(m.dims).length===3?m.dims:DEFAULT, h=o.hang?hung(dims):o.stand?{O:[[1,0,0],[0,0,1],[0,-1,0]],size:[dims[0],dims[2],dims[1]]}:null, O=h?h.O:[[1,0,0],[0,1,0],[0,0,1]];
    const W=mul(Rz(Number(o.rz)||0),O), c=arr(o.centre).length===3?o.centre:[0,0,dims[2]/2], names={...MATERIALS,...obj(o.materials)};
    const objects=arr(m.parts).map((p,i)=>{
      const at=apply(W,[p[2][0],p[2][1],p[2][2]-dims[2]/2]);
      return {id:String(o.id||"prop")+"-"+(i+1),name:String(o.name||"Prop"),kind:p[0],position:[r4(c[0]+at[0]),r4(c[1]+at[1]),r4(c[2]+at[2])],
        rotation:turnsFrom(mul(W,turnOf(p[4]))).map(r4),size:p[1].map(n=>r4(Math.max(0.0005,Math.abs(n)))),material:names[p[3]]||names.main};
    });
    return {objects,size:h?h.size:dims.slice()};
  }

  // "17 × 12 × 7 cm": the three sizes, largest first; millimetres for a thing under two centimetres
  function sizeWords(dims){
    const d=arr(dims).map(Number).filter(n=>n>0).sort((a,b)=>b-a); if(!d.length) return "";
    const mm=d[0]<0.02, k=mm?1000:100, show=n=>{ const v=n*k; return String(v>=10?Math.round(v):Math.round(v*10)/10); };
    return d.map(show).join(" × ")+(mm?" mm":" cm");
  }

  /* THE MODEL ALONE (the prop card): on a plain floor, beside a ruler whose blocks are one centimetre (a thing under
     25 cm) or ten, with three cameras that hold all of it: front (its +y face), side, and three-quarter from above. */
  function stage(model){
    const m=obj(model), dims=arr(m.dims).length===3?m.dims:DEFAULT, big=Math.max(...dims), tick=big<0.25?0.01:0.1;
    const put=place(m,{id:"prop-model",name:"The prop",centre:[0,0,dims[2]/2],rz:0,materials:{main:"model-main",second:"model-second",dark:"model-dark",light:"model-light"}});
    const span=Math.max(0.6,big*6), floor={id:"model-floor",name:"Floor",kind:"box",position:[0,0,-0.005],rotation:[0,0,0],size:[span,span,0.01],material:"model-floor"};
    const blocks=Math.max(1,Math.min(40,Math.ceil(Math.max(dims[0],tick)/tick))), y=dims[1]/2+Math.max(0.012,big*0.12), th=Math.max(0.002,tick*0.25), ruler=[];
    for(let i=0;i<blocks;i++) ruler.push({id:"model-ruler-"+(i+1),name:"Ruler",kind:"box",position:[r4(-dims[0]/2+tick*(i+0.5)),r4(y),r4(th/2)],rotation:[0,0,0],
      size:[tick,Math.max(0.006,tick*0.6),th],material:i%2?"model-ruler-b":"model-ruler-a"});
    /* each camera stands as near as still holds the whole thing and its ruler in a 16:9 frame (lens 70 mm): what it
       sees across and up decides, never a ball drawn round the thing (a card wallet is wide and one centimetre high) */
    const lens=70, across=Math.atan(18/lens), up=Math.atan(36/(2*lens*16/9)), edge=Math.max(0.012,big*0.12), rule=edge+Math.max(0.006,tick*0.6);
    const cam=(yaw,pitch,wide,tall,deep)=>{ const a=yaw*Math.PI/180, p=pitch*Math.PI/180, look=[Math.sin(a)*Math.cos(p),Math.cos(a)*Math.cos(p),Math.sin(p)];
      const dist=Math.max((wide/2+edge)*1.15/Math.tan(across),(tall/2+edge)*1.3/Math.tan(up))+deep/2;
      return {position:[r4(-look[0]*dist),r4(-look[1]*dist),r4(Math.max(0.02,dims[2]/2-look[2]*dist))],yaw,pitch,lensMm:lens}; };
    const flat=Math.hypot(dims[0],dims[1]+2*rule), tilt=28*Math.PI/180;
    return {tick,
      scene:{objects:[floor].concat(put.objects,ruler),cameras:{},
        materials:{"model-floor":{baseColor:[0.86,0.85,0.82],metallic:0,roughness:0.9,emissionStrength:0},
          ...tones(m.colours),
          "model-ruler-a":{baseColor:[0.95,0.6,0.2],metallic:0,roughness:0.7,emissionStrength:0},"model-ruler-b":{baseColor:[0.15,0.15,0.16],metallic:0,roughness:0.7,emissionStrength:0}}},
      poses:{front:cam(180,-8,dims[0],dims[2]+rule*0.3,dims[1]+2*rule),side:cam(-90,-8,dims[1]+2*rule,dims[2],dims[0]),quarter:cam(145,-28,flat,dims[2]*Math.cos(tilt)+flat*Math.sin(tilt),0)}};
  }

  /* THE FOUR TONES OF A MODEL as materials: its own colours when it was built for the prop, plain ones otherwise */
  const PLAIN_TONES={main:[0.5,0.52,0.56],second:[0.25,0.38,0.62],dark:[0.1,0.1,0.11],light:[0.88,0.87,0.84]};
  function tones(colours){ const c=obj(colours), out={};
    TONES.forEach(t=>{ const v=arr(c[t]); out["model-"+t]={baseColor:v.length===3&&v.every(n=>Number.isFinite(n)&&n>=0&&n<=1)?v.slice():PLAIN_TONES[t],metallic:0,roughness:0.6,emissionStrength:0}; });
    return out; }

  /* ---- A MODEL BUILT FOR ONE PROP (stage 2, owner 2026-11-24: "yes, go on to stage 2") ----
     The catalogue knows common things. A prop it does not know (or one whose own shape matters: a bifold wallet, a
     tapered tub) is BUILT: one short writing pass reads the card (what it is, its material, its marks, its size) and
     writes the prop as 4 to 24 plain parts in centimetres, with its four colours. built() reads the answer safely:
     shapes it knows only, numbers only, the model set down on the table and centred, brought to its stated size.
     The model is saved on the prop's own card (card.model) by the person's press, and is then the prop everywhere. */
  const MODEL="claude-fable-5-2";
  const CALL={effort:"low",ms:120000,maxTokens:6000};
  const LIMITS={parts:24};
  const SHAPES={box:"box",cylinder:"cylinder",ring:"torus",ball:"sphere",pad:"cushion"};
  const tidy=(v,n)=>String(v==null?"":v).replace(/\s+/g," ").trim().slice(0,n||200);
  const hex=v=>{ const m=String(v||"").trim().match(/^#?([0-9a-f]{6})$/i); if(!m) return null; const n=parseInt(m[1],16); return [(n>>16)&255,(n>>8)&255,n&255].map(x=>Math.round(x/255*1000)/1000); };
  // the box a set of parts fills (a turned part by the box its turn gives it)
  function bounds(parts){
    const lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
    arr(parts).forEach(q=>{ const M=turnOf(q[4]); for(let i=0;i<3;i++){ const e=(Math.abs(M[i][0])*q[1][0]+Math.abs(M[i][1])*q[1][1]+Math.abs(M[i][2])*q[1][2])/2; lo[i]=Math.min(lo[i],q[2][i]-e); hi[i]=Math.max(hi[i],q[2][i]+e); } });
    return {lo,hi};
  }
  // what a model was built from: when the card's words change, the model says it is older than they are
  function sigOf(card){ const c=obj(card), t=[c.name,c.form,c.material,c.signatureFeature,c.size].map(x=>tidy(x,2000)).join("|"); let h=2166136261; for(let i=0;i<t.length;i++){ h^=t.charCodeAt(i); h=Math.imul(h,16777619); } return (h>>>0).toString(36); }
  /* raw = the engine's answer: {what, size:[w, d, h] cm, colours:{main, second, dark, light}, parts:[{shape, size, at, turn, tone, what}]}
     → {model:{v, what, dims (metres), parts, colours} | null, left:[what was left out and why]} */
  function built(raw){
    const r=obj(raw), left=[];
    let parts=[];
    arr(r.parts).slice(0,LIMITS.parts*3).forEach((q,i)=>{
      const o=obj(q), kind=SHAPES[String(o.shape||"").toLowerCase()], size=arr(o.size).map(Number), at=arr(o.at).map(Number), what=tidy(o.what,40)||("part "+(i+1));
      if(!kind){ left.push(what+": a shape a model cannot have"); return; }
      if(size.length!==3||!size.every(n=>Number.isFinite(n)&&n>0&&n<2000)||at.length!==3||!at.every(n=>Number.isFinite(n)&&Math.abs(n)<2000)){ left.push(what+": no size or no place"); return; }
      if(parts.length>=LIMITS.parts){ left.push(what+": more parts than a model holds"); return; }
      const t=arr(o.turn).map(Number), one=Number(o.turn), turn=(t.length===3&&t.every(Number.isFinite))?t.map(d=>r4(d*Math.PI/180)):[0,0,Number.isFinite(one)&&!Array.isArray(o.turn)?r4(one*Math.PI/180):0];
      parts.push([kind,size.map(n=>n/100),at.map(n=>n/100),TONES.indexOf(o.tone)>=0?o.tone:"main",turn]);
    });
    if(!parts.length) return {model:null,left};
    // set down on the table, centred
    const b=bounds(parts), cx=(b.lo[0]+b.hi[0])/2, cy=(b.lo[1]+b.hi[1])/2;
    parts.forEach(q=>{ q[2]=[q[2][0]-cx,q[2][1]-cy,q[2][2]-b.lo[2]]; });
    let dims=[0,1,2].map(i=>b.hi[i]-b.lo[i]);
    // its true size: the longest side as stated; the shape as built keeps its proportions
    const stated=arr(r.size).map(Number).filter(n=>Number.isFinite(n)&&n>0&&n<2000), want=stated.length===3?Math.max(...stated)/100:0, have=Math.max(...dims);
    if(want>0&&have>0&&Math.abs(want/have-1)>0.03){ const k=want/have;
      parts.forEach(q=>{ q[1]=q[1].map(n=>n*k); q[2]=q[2].map(n=>n*k); }); dims=dims.map(n=>n*k);
      if(Math.abs(k-1)>0.25) left.push("built "+(k<1?"larger":"smaller")+" than its stated size, and brought to it"); }
    parts=parts.map(q=>[q[0],q[1].map(n=>r4(Math.max(0.0005,n))),q[2].map(r4),q[3],q[4]]);
    const colours={}; TONES.forEach(t=>{ const c=hex(obj(r.colours)[t]); if(c) colours[t]=c; });
    return {model:{v:1,what:tidy(r.what,60),dims:dims.map(n=>r4(Math.max(0.0005,Math.min(20,n)))),parts,colours},left};
  }
  // a model as saved on a card, read safely: null when it is not one
  function saved(m){
    const o=obj(m); if(o.v!==1||arr(o.dims).length!==3||!o.dims.every(n=>Number.isFinite(n)&&n>0&&n<=20)) return null;
    const kinds=Object.keys(SHAPES).map(k=>SHAPES[k]);
    const parts=arr(o.parts).filter(q=>Array.isArray(q)&&kinds.indexOf(q[0])>=0&&arr(q[1]).length===3&&q[1].every(n=>Number.isFinite(n)&&n>0)&&arr(q[2]).length===3&&q[2].every(Number.isFinite)
      &&TONES.indexOf(q[3])>=0&&arr(q[4]).length===3&&q[4].every(Number.isFinite)).slice(0,LIMITS.parts);
    if(!parts.length) return null;
    const colours={}; TONES.forEach(t=>{ const c=arr(obj(o.colours)[t]); if(c.length===3&&c.every(n=>Number.isFinite(n)&&n>=0&&n<=1)) colours[t]=c.slice(); });
    return {v:1,what:tidy(o.what,60),dims:o.dims.slice(),parts,colours,by:tidy(o.by,60),at:tidy(o.at,40),from:tidy(o.from,20)};
  }
  // what is saved on the card: the model, the engine that built it, when, and what it was built from
  const keep=(model,card,o)=>({...model,by:tidy(obj(o).engine||MODEL,60),at:tidy(obj(o).at||new Date().toISOString(),40),from:sigOf(card)});
  const stale=card=>{ const m=saved(obj(card).model); return !!(m&&m.from&&m.from!==sigOf(card)); };
  function prompt(card){
    const c=obj(card), line=(k,v)=>tidy(v,900)?k+": "+tidy(v,900)+"\n":"";
    return "You build a film prop as a simple 3D model made of plain parts, the way a prop maker blocks out a shape before detailing it. "
      +"The model places the prop in every shot at its true size, and its reference sheet is drawn over it, so its outline and proportions must be right.\n\n"
      +"THE PROP\n"+line("Name",c.name)+line("What it is",c.form)+line("Material and finish",c.material)+line("Identifying details",c.signatureFeature)+line("Size as written",c.size)
      +"\nHOW IT RESTS: build it as it rests on a table when nobody holds it: a phone or a wallet lies flat, a mug or a bottle stands, a bag stands on its base, keys lie in a loose bunch. A thing shown closed in the story is built closed.\n"
      +"THE FRAME: centimetres. x is across it (its width), y is front to back (its depth; +y is its front), z is up from the table (z = 0 is the table top). The whole prop fits a box of `size` [wide, deep, high] centred on x = 0 and y = 0.\n"
      +"PARTS: between 4 and 20 (never more than "+LIMITS.parts+"). Each is {shape, size:[x, y, z] (the part's own box, before any turn), at:[x, y, z] (its centre), turn:[x, y, z] (degrees, turned about x, then y, then z; leave it out when there is none), tone, what (two or three words)}.\n"
      +"- shapes: \"box\"; \"cylinder\" (a round bar, tube or disc whose axis is z: its x and y sizes are its diameters, its z size its length; turn [0, 90, 0] lays it along x, turn [90, 0, 0] along y); "
      +"\"ring\" (a ring lying flat, its axis z: x and y are its outer diameters, z the thickness of its wire; turn [90, 0, 0] stands it upright across x, as a mug's handle); \"ball\" (a sphere or an egg); \"pad\" (a soft block with rounded sides: a bag's body, a cushion, folded cloth).\n"
      +"- tones: \"main\" (its main colour), \"second\" (its second colour), \"dark\" (its darkest parts: a screen, rubber, a handle), \"light\" (its lightest: paper, steel, a label).\n"
      +"COLOURS: the four tones as hex colours, read from the material and details above.\n"
      +"RULES:\n"
      +"- True size. The first measurement of 'Size as written' is the whole prop unless it names a part; measurements of a part size that part. With no size written, the usual size of such an object.\n"
      +"- Every part lies inside the box of `size`. Each part touches or overlaps what it is fixed to: nothing floats.\n"
      +"- Build the outline first (the big masses), then the parts that make it THIS prop and no other: a lid, a handle, a clasp, a spout, a strap, a hinge, a label panel, a badge, a row of buttons.\n"
      +"- No lettering, no surface texture, nothing thinner than 1 mm unless the prop itself is (a sheet of paper, a needle). A hollow thing (a mug, a bowl, an open box) is solid, with a thin dark disc or panel just inside its rim.\n"
      +"Return ONLY compact JSON: {\"what\":\"a ...\",\"size\":[17,12,7],\"colours\":{\"main\":\"#c8d4d0\",\"second\":\"#4f8f8a\",\"dark\":\"#222222\",\"light\":\"#f2f0ea\"},"
      +"\"parts\":[{\"shape\":\"box\",\"size\":[16,11,6],\"at\":[0,0,3],\"tone\":\"main\",\"what\":\"tub body\"}]}";
  }
  // about how many writing credits building one model costs (the number on the button); the rate is the set dressing's, which a test keeps equal to the server's
  function estimate(card){
    const rate=obj(obj(root.KinolotSetDressing).RATE), inputTokens=Math.ceil(prompt(card).length/3.5), outputTokens=1500;
    const usd=(inputTokens*(Number(rate.input)||8)+outputTokens*(Number(rate.output)||40))/1e6;
    return {credits:typeof root.turnCreditCost==="function"?root.turnCreditCost(usd):Math.max(1,Math.ceil(usd/0.01-1e-9)),usd:Math.round(usd*1000)/1000,inputTokens,outputTokens};
  }
  function readJSON(raw){ const text=String(raw&&typeof raw==="object"&&typeof raw.text==="string"?raw.text:raw||""), a=text.indexOf("{"), b=text.lastIndexOf("}"); if(a<0||b<=a) return null; try{ return JSON.parse(text.slice(a,b+1)); }catch(_){ return null; } }
  /* One writing call. → {model (as it will be saved, with who built it and from what), left}. Saves nothing. */
  async function draft(card,ctx){
    ctx=ctx||{};
    if(!card||!card.id) throw new Error("Choose a prop first.");
    if(!root.claude||typeof root.claude.complete!=="function") throw new Error("Sign in to build this model.");
    if(!tidy(card.form)&&!tidy(card.size)&&!tidy(card.material)) throw new Error("Write what this prop looks like first (Physical design): the model is built from it. Nothing was changed.");
    const epoch=typeof root.nbEpoch==="function"?root.nbEpoch():null, text=prompt(card);
    const raw=await root.claude.complete({messages:[{role:"user",content:text}],modelId:ctx.modelId||MODEL,maxTokens:ctx.maxTokens||CALL.maxTokens,effort:ctx.effort||CALL.effort,timeoutMs:ctx.timeoutMs||CALL.ms});
    if(epoch!==null&&root.nbEpoch()!==epoch) throw new Error("The film changed. The model was not built.");
    let parsed=readJSON(raw);
    if(parsed&&typeof root.scrubBrand==="function"){ try{ parsed=JSON.parse(root.scrubBrand(JSON.stringify(parsed))); }catch(_){} }
    const got=parsed&&typeof parsed==="object"?built(parsed):{model:null,left:[]};
    if(!got.model||got.model.parts.length<2) throw new Error("The model came back incomplete. Nothing was changed; try again.");
    return {model:keep(got.model,card,{engine:ctx.modelId||MODEL}),left:got.left};
  }

  /* THE SHEET'S LAYOUT, FROM THE MODEL (stage 2: "the prop sheet is made from the model's drawing, so the image engine
     only adds texture and light"). The prop's reference sheet is three equal panels: front, side, close-up. Here the
     model is shown the same way: a thing that lies flat is stood up with its face to the camera; the front and the
     side are drawn level, from the same distance (the same size, one baseline), a thin thing's side turned 70 degrees
     so it is never a bare line; the close-up moves in on its upper front from three-quarter. Each camera holds the
     thing inside the MIDDLE THIRD of its 16:9 frame: the three middle thirds, side by side, are the sheet.
     → {scene, poses:{front, side, close}, size:[w, d, h] as shown, stood, thin, own (it has its own colours)} */
  function sheet(model){
    const m=obj(model), dims=arr(m.dims).length===3?m.dims:DEFAULT, stood=dims[2]<0.35*Math.min(dims[0],dims[1]);
    const shown=stood?[dims[0],dims[2],dims[1]]:dims.slice();
    const put=place(m,{id:"prop-model",name:"The prop",centre:[0,0,shown[2]/2],rz:0,stand:stood,materials:{main:"model-main",second:"model-second",dark:"model-dark",light:"model-light"}});
    const thin=shown[1]<0.18*shown[0], swing=(thin?70:90)*Math.PI/180, lens=100, edge=1.3;
    const seen=shown[0]*Math.abs(Math.cos(swing))+shown[1]*Math.abs(Math.sin(swing));   // how wide the side view is
    const dist=Math.max(shown[0],seen)/2*edge*lens/6, far=Math.max(dist,shown[2]/2*edge*lens/10.125);
    const at=(deg,pitch,d,aim)=>{ const a=deg*Math.PI/180, q=pitch*Math.PI/180, look=[Math.sin(a)*Math.cos(q),Math.cos(a)*Math.cos(q),Math.sin(q)];
      return {position:[r4(aim[0]-look[0]*d),r4(aim[1]-look[1]*d),r4(aim[2]-look[2]*d)],yaw:deg,pitch,lensMm:lens}; };
    const mid=[0,0,shown[2]/2];
    return {scene:{objects:put.objects,cameras:{},materials:tones(m.colours)},size:shown,stood,thin,own:Object.keys(obj(m.colours)).length>0,
      poses:{front:at(180,0,far,mid),side:at(180+(thin?70:90),0,far,mid),close:at(215,-16,far*0.62,[shown[0]*0.08,0,shown[2]*0.6])}};
  }

  const api={FORMS,DEFAULT,MATERIALS,MODEL,CALL,LIMITS,forms,formById,formOf,numbers,fit,plain,modelOf,hung,place,turnsFrom,sizeWords,stage,
    built,saved,keep,stale,sigOf,bounds,prompt,estimate,draft,sheet,tones};
  root.KinolotPropModel=api;
  if(typeof module!=="undefined"&&module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
