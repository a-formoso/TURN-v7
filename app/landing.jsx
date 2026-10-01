/* landing.jsx — the commercial landing page shown to signed-out visitors INSTEAD of the
   app. Sells what Kinolot is (the departments / the Infinite Studio AI method) and drives sign-up.
   The product is Kinolot by Infinite Studio AI; "TURN" is only the internal codename.
   The actual app (spine, Writers' Room, Art Room, Story Editors) is never exposed until sign-in.
   The floating Frances teaser still rides on top (mounted by app.jsx) for a live taste.
   DESIGN: a paper editorial page — near-black ink, a hairline-framed content column — in
   the Kinolot identity and the app's own controls: the mark + Spectral wordmark, 9px-radius
   buttons with the amber primary, the app's eyebrow labels. Always paper, whatever the app
   theme (styles.css: the shared --lpw-* website palette). */

/* hero media — the Value-Charge Spine, the product's visual signature, drawn as
   an animated SVG inside the film frame (corner brackets kept). A deliberate
   ABSTRACTION, not a screenshot: a BASIC version of whichever narrative structure
   the headline is showing (Three-Act Turns, Hero's Journey, Kishōtenketsu), with
   its act bands and a few named beats. The line wears the app's value-charge grade
   (amber above the midline, teal below — the same colours as the in-app spine),
   scenes land as halo'd nodes, and a playhead of light reads the spine once it's
   drawn. It redraws each time the headline turns. */
const LP_STRUCTURES = [
  { word:"Three-Act Turns",
    bands:["Act I \u00b7 Setup","Act II \u00b7 Complication","Act III \u00b7 Resolution"], breaks:[3,6],
    scenes:[{c:0.5},{c:-1.1},{c:1.9,m:"Inciting Incident"},{c:-1.8,m:"Act Climax"},
            {c:1.3},{c:-2.4,m:"Mid-Act Climax"},{c:1.0},{c:-2.8,m:"Crisis"},{c:2.3,m:"Story Climax"}] },
  { word:"a Hero\u2019s Journey",
    bands:["Departure","Initiation","Return"], breaks:[4,6],
    scenes:[{c:0.5,m:"Ordinary World"},{c:-1.0},{c:1.8,m:"Call to Adventure"},{c:-1.3},{c:1.6,m:"Threshold"},
            {c:-2.8,m:"The Ordeal"},{c:1.9,m:"Reward"},{c:-2.2,m:"Resurrection"},{c:2.3,m:"Return with the Elixir"}] },
  { word:"Kish\u014dtenketsu",
    bands:["Ki","Sh\u014d","Ten","Ketsu"], breaks:[1,4,6],
    scenes:[{c:0.5,m:"Planting"},{c:-0.4},{c:0.7},{c:-0.5},{c:1.1,m:"Deepening"},
            {c:-2.7,m:"The Twist"},{c:1.4},{c:-0.6},{c:1.3,m:"Reconciliation"}] },
];
function HeroSpine({ structure }){
  const S = structure || LP_STRUCTURES[0];
  const W=1260, H=540, MID=H/2, AMP=64, X0=76, X1=W-52;
  const pts=S.scenes.map((sc,i)=>({ ...sc, up:sc.c>=0, x:X0+(X1-X0)*i/(S.scenes.length-1), y:MID-sc.c*AMP }));
  // Catmull-rom → cubic beziers; TENSION ~4.4 gives soft, organic crests
  const TENSION = 4.4;
  let d="M"+pts[0].x.toFixed(1)+" "+pts[0].y.toFixed(1);
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[Math.max(0,i-1)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(pts.length-1,i+2)];
    d+=" C"+[p1.x+(p2.x-p0.x)/TENSION, p1.y+(p2.y-p0.y)/TENSION,
             p2.x-(p3.x-p1.x)/TENSION, p2.y-(p3.y-p1.y)/TENSION, p2.x, p2.y]
             .map(n=>n.toFixed(1)).join(" ");
  }
  const area = d+" L"+X1+" "+MID+" L"+X0+" "+MID+" Z";
  // act breaks land between a band's last scene and the next band's first
  const actX = S.breaks.map(i=>(pts[i].x+pts[i+1].x)/2);
  const edges = [X0-26].concat(actX, [X1+26]);
  const mono={fontFamily:"var(--f-mono)",letterSpacing:".14em"};
  const runStyle={offsetPath:'path("'+d+'")'};
  return React.createElement("div",{className:"lp-video","aria-label":"The value-charge spine of "+S.word.replace(/^a /,"")+" \u2014 every scene plotted by its emotional charge"},
    React.createElement("div",{className:"lp-video-corners","aria-hidden":"true"}),
    React.createElement("div",{className:"lp-video-corners b","aria-hidden":"true"}),
    React.createElement("svg",{key:S.word,className:"lp-spine",viewBox:"0 0 "+W+" "+H,preserveAspectRatio:"xMidYMid meet","aria-hidden":"true"},
      React.createElement("defs",null,
        React.createElement("linearGradient",{id:"lpgLine",gradientUnits:"userSpaceOnUse",x1:0,y1:MID-3*AMP,x2:0,y2:MID+3*AMP},
          React.createElement("stop",{offset:"0",stopColor:"var(--lpw-rise)"}),
          React.createElement("stop",{offset:".5",stopColor:"rgba(255,255,255,.95)"}),
          React.createElement("stop",{offset:"1",stopColor:"var(--lpw-fall)"})),
        React.createElement("linearGradient",{id:"lpgFill",gradientUnits:"userSpaceOnUse",x1:0,y1:MID-3*AMP,x2:0,y2:MID+3*AMP},
          React.createElement("stop",{offset:"0",stopColor:"rgba(242,154,67,.22)"}),
          React.createElement("stop",{offset:".5",stopColor:"rgba(255,255,255,0)"}),
          React.createElement("stop",{offset:"1",stopColor:"rgba(93,176,216,.22)"})),
        React.createElement("filter",{id:"lpgBlur",x:"-40%",y:"-40%",width:"180%",height:"180%"},
          React.createElement("feGaussianBlur",{stdDeviation:6}))),
      // charge gridlines + the neutral midline
      [-2,-1,1,2].map(c=>React.createElement("line",{key:"g"+c,x1:X0-26,y1:MID-c*AMP,x2:X1+26,y2:MID-c*AMP,
        stroke:"rgba(255,255,255,.05)",strokeWidth:1})),
      React.createElement("line",{x1:X0-26,y1:MID,x2:X1+26,y2:MID,stroke:"rgba(255,255,255,.18)",strokeWidth:1}),
      React.createElement("text",{x:X0-26,y:92,fill:"rgba(255,255,255,.55)",fontSize:44,style:mono},"+"),
      React.createElement("text",{x:X0-26,y:H-58,fill:"rgba(255,255,255,.55)",fontSize:44,style:mono},"-"),
      // act bands: dashed breaks + a centred name over each band
      actX.map((x,i)=>React.createElement("line",{key:"ax"+i,x1:x,y1:64,x2:x,y2:H-48,
        stroke:"rgba(255,255,255,.12)",strokeWidth:1,strokeDasharray:"3 6"})),
      S.bands.map((b,i)=>React.createElement("text",{key:"b"+i,x:(edges[i]+edges[i+1])/2,y:46,fill:"rgba(255,255,255,.55)",
        fontSize:11,textAnchor:"middle",style:mono},b.toUpperCase())),
      // charge-tinted area under the wave, then the glow pass, then the line
      React.createElement("path",{className:"lp-spine-area",d:area,fill:"url(#lpgFill)"}),
      React.createElement("path",{className:"lp-spine-path glow",d,pathLength:1,stroke:"url(#lpgLine)",
        strokeWidth:7,opacity:.3,filter:"url(#lpgBlur)"}),
      React.createElement("path",{className:"lp-spine-path",d,pathLength:1,stroke:"url(#lpgLine)",strokeWidth:2.5}),
      // scene nodes: soft halo + core, colored by where the scene CLOSES
      pts.map((p,i)=>React.createElement("circle",{key:"h"+i,className:"lp-spine-halo",cx:p.x,cy:p.y,r:12,
        fill:p.c>=0?"var(--lpw-rise)":"var(--lpw-fall)",opacity:.14,
        style:{animationDelay:(0.35+i*0.16)+"s"}})),
      pts.map((p,i)=>React.createElement("circle",{key:"n"+i,className:"lp-spine-node",cx:p.x,cy:p.y,r:5.5,
        fill:p.c>=0?"var(--lpw-rise)":"var(--lpw-fall)",stroke:"var(--lpw-black)",strokeWidth:2.5,
        style:{animationDelay:(0.35+i*0.16)+"s"}})),
      // named beats with a short leader tick to their node (like the in-app spine)
      pts.filter(p=>p.m).map((p,i)=>React.createElement("line",{key:"mt"+i,className:"lp-spine-lab",
        x1:p.x,y1:p.up?p.y-12:p.y+12,x2:p.x,y2:p.up?p.y-20:p.y+20,
        stroke:"rgba(255,255,255,.28)",strokeWidth:1,style:{animationDelay:(1.2+i*0.1)+"s"}})),
      // edge labels anchor inward so a long name never runs off the frame
      pts.filter(p=>p.m).map((p,i)=>{ const at = pts.indexOf(p), edge = at===0 ? "start" : at===pts.length-1 ? "end" : "middle";
        return React.createElement("text",{key:"m"+i,className:"lp-spine-lab",
          x:p.x+(edge==="start"?-10:edge==="end"?10:0),y:p.up?p.y-28:p.y+36,textAnchor:edge,fill:"rgba(255,255,255,.62)",fontSize:11,
          style:{...mono,animationDelay:(1.2+i*0.1)+"s"}},p.m); }),
      // the playhead — a dot of light reading this structure once it's drawn
      React.createElement("circle",{className:"lp-spine-run halo",r:10,fill:"rgba(255,255,255,.35)",
        filter:"url(#lpgBlur)",style:runStyle}),
      React.createElement("circle",{className:"lp-spine-run",r:3.5,fill:"#fff",style:runStyle})));
}

const LP_ROOMS = [
  { no:"01", icon:"script", title:"Writers' Room", status:"Available now",
    body:"Turn an idea into a structured screenplay: story spine, beat maps and script drafts that stay editable.",
    cta:"Start with Writers' Room", plan:"writer" },
  { no:"02", icon:"palette", title:"Art Room", status:"Available now",
    body:"Design the film from the script: characters, props, locations, style, shots and storyboards prepared for production.",
    cta:"Start with Art Room", plan:"director" },
  { no:"03", icon:"clapper", title:"Stage", status:"Available now",
    body:"Generate video, voice, timeline passes and final production assets once the film is designed and ready to shoot.",
    cta:"Start with Stage", plan:"studio" },
];

/* the hero's rotating phrase — the THREE narrative structures a film can be told in
   (one idea, three ways). The phrase and the hero diagram turn together: Landing
   owns the index, the word remounts so its entrance replays, and the spine redraws
   as that structure. ~5.2s per structure, time for the diagram to draw and be read. */
const LP_WORDS = LP_STRUCTURES.map(x=>x.word);
const LP_TURN_MS = 5200;
function RotatingWord({ word }){
  return React.createElement("span",{className:"lp-rotate",key:word}, word);
}

const LP_STEPS = [
  { n:"1", t:"Bring an idea", d:"A logline, a “what if” — or just talk it through out loud." },
  { n:"2", t:"Choose how it’s told", d:"Three-Act Turns, Hero’s Journey or Kishōtenketsu — for a feature, a series, a short or a music video." },
  { n:"3", t:"Build the film", d:"Story, script, cast, places, shots — it all grows in one place." },
];

/* Pricing — derived from the SINGLE source of truth (plans.jsx CINEMA_PLANS), so
   the homepage and the in-app checkout can never drift. Update tiers in one place. */
function lpTiers(){
  return (window.CINEMA_PLANS || []).map(p=>({
    id:p.tier, name:p.name, price:p.price, per:"/ month", blurb:p.blurb,
    feats:p.features, featured:!!p.popular, tag:p.popular?"Most popular":null,
    cta:"Choose "+p.name,
  }));
}

/* the line under the plan cards (billing fixes, 2026-09-30): the free trial and the packs.
   Reads the same sources as the in-app Plans window (plans.jsx), with a fallback. Both start on
   the credit switch day (supabase/billing-switch.sql): before it the line is empty and hidden. */
function lpPricingNote(){
  if(typeof window.turnTrialCopy==="function" && !window.turnTrialCopy()) return "";
  const trial = (typeof window.turnTrialCopy==="function" && window.turnTrialCopy()) || window.TURN_TRIAL_COPY || "New accounts get 50 free credits after confirming their email — enough to try the Writers' Room on the lighter writing engine (a logline, a synopsis, the spine and its first scenes), plus draft images.";
  const packs = (window.CINEMA_CREDIT_PACKS || []);
  const from = packs.length ? packs.map(p=>p.price).sort((a,b)=>parseFloat(String(a).replace(/[^\d.]/g,""))-parseFloat(String(b).replace(/[^\d.]/g,"")))[0] : "$10";
  return trial+" Need more? Credit packs from "+from+" for any account — pack credits last 12 months.";
}
window.lpPricingNote = lpPricingNote;

/* footer brand: "Kinolot by Infinite Studio AI", the company name linking to its site
   (shared with the Home dashboard footer, app/home-dashboard.jsx) */
function LandingFootBrand(){
  return React.createElement("span",{className:"lp-foot-brand"},
    React.createElement("span",{className:"lp-logo sm"},(typeof BrandMark==="function") && React.createElement(BrandMark,null),"Kinolot"),
    React.createElement("span",{className:"lp-foot-by"},"by ",
      React.createElement("a",{className:"lp-foot-link",href:"https://infinitestudioai.com",target:"_blank",rel:"noopener"},"Infinite Studio AI")));
}
window.LandingFootBrand = LandingFootBrand;

function Landing({ onStart, onSignIn }){
  if(typeof window.usePlansVersion==="function") window.usePlansVersion();   // reflect admin plan-copy edits
  const Icn = (name, s)=> React.createElement(Icon[name] || Icon.sparkles, {s:s||18});
  const [menuOpen, setMenuOpen] = React.useState(false);   // mobile hamburger menu
  const [structIdx, setStructIdx] = React.useState(0);     // which structure the hero shows
  React.useEffect(()=>{
    const t = setInterval(()=> setStructIdx(x=>(x+1)%LP_STRUCTURES.length), LP_TURN_MS);
    return ()=> clearInterval(t);
  },[]);
  return React.createElement("div",{className:"landing"},
    React.createElement("div",{className:"lp-page"},

    // full-height vertical rails at the column edges — they run through the hero,
    // sections, and footer, crossing every horizontal rule in a "+" intersection
    React.createElement("div",{className:"lp-rails","aria-hidden":"true"}),

    // nav content is constrained to the SAME centered column as the page content,
    // so the logo and buttons align with the headline / frame edges below
    React.createElement("header",{className:"lp-nav"},
      React.createElement("div",{className:"lp-nav-in"},
        React.createElement("div",{className:"lp-brand"},
          React.createElement("span",{className:"lp-logo"},(typeof BrandMark==="function") && React.createElement(BrandMark,null),"Kinolot")),
        React.createElement("div",{className:"lp-nav-cta"},
          React.createElement("button",{className:"lp-btn ghost",onClick:onSignIn},"Sign in"),
          React.createElement("button",{className:"lp-btn primary",onClick:()=>onStart("writer")},"Start with a room")),
        // mobile-only hamburger (the inline buttons hide below 560px)
        React.createElement("button",{className:"lp-burger"+(menuOpen?" open":""),"aria-label":"Menu",
          "aria-expanded":menuOpen?"true":"false",onClick:()=>setMenuOpen(o=>!o)},
          React.createElement("span",null),React.createElement("span",null),React.createElement("span",null))),
      menuOpen && React.createElement("div",{className:"lp-menu"},
        React.createElement("button",{className:"lp-menu-item",onClick:()=>{ setMenuOpen(false); onSignIn(); }},"Sign in"),
        React.createElement("button",{className:"lp-menu-item primary",onClick:()=>{ setMenuOpen(false); onStart("writer"); }},"Start with a room"))),

    // hero — UNFRAMED (no hairlines), headline + CTAs left, supporting copy right
    React.createElement("section",{className:"lp-hero"},
      React.createElement("div",{className:"lp-hero-copy"},
        React.createElement("h1",{className:"lp-h1"},"Your film, told",React.createElement("br",null),
          "as ",React.createElement(RotatingWord,{word:LP_WORDS[structIdx]}),"."),
        React.createElement("div",{className:"lp-hero-cta"},
          React.createElement("button",{className:"lp-btn primary big",onClick:()=>onStart("writer")},"Start with Writers' Room"),
          React.createElement("button",{className:"lp-btn ghost big",onClick:onSignIn},"Sign in"))),
      React.createElement("div",{className:"lp-hero-aside"},
        React.createElement("p",{className:"lp-lede"},
          "Start with the room you need. Write the screenplay now, design the film when you are ready, and move into Stage for production — one project, one story spine, every department connected."))),

    // hero media — the 21:9 short-film placeholder, still outside the frame
    React.createElement("section",{className:"lp-hero-media"},
      React.createElement(HeroSpine,{structure:LP_STRUCTURES[structIdx]})),

    // the hairline-framed column starts BELOW the hero (features onward)
    React.createElement("div",{className:"lp-frame"},

      React.createElement("section",{className:"lp-section"},
        React.createElement("div",{className:"lp-sec-head"},
          React.createElement("div",{className:"lp-act"},"Act I · Choose your room"),
          React.createElement("h2",{className:"lp-h2"},"Start with the room you need")),
        React.createElement("div",{className:"lp-grid"},
          LP_ROOMS.map((f,i)=>React.createElement("div",{key:i,className:"lp-card lp-room-card"},
            React.createElement("div",{className:"lp-card-top"},
              React.createElement("div",{className:"lp-card-ic"}, Icn(f.icon,20)),
              React.createElement("span",{className:"lp-card-no"}, f.no)),
            React.createElement("div",{className:"lp-room-status"}, f.status),
            React.createElement("div",{className:"lp-card-t"}, f.title),
            React.createElement("div",{className:"lp-card-b"}, f.body),
            React.createElement("button",{className:"lp-btn ghost full lp-room-cta",onClick:()=>onStart(f.plan)}, f.cta))))),

      React.createElement("section",{className:"lp-section steps"},
        React.createElement("div",{className:"lp-sec-head"},
          React.createElement("div",{className:"lp-act"},"Act II · The process"),
          React.createElement("h2",{className:"lp-h2"},"How it works")),
        React.createElement("div",{className:"lp-steps"},
          LP_STEPS.map((s,i)=>React.createElement("div",{key:i,className:"lp-step"},
            React.createElement("div",{className:"lp-step-n"}, s.n),
            React.createElement("div",{className:"lp-step-t"}, s.t),
            React.createElement("div",{className:"lp-step-d"}, s.d))))),

      React.createElement("section",{className:"lp-section pricing"},
        React.createElement("div",{className:"lp-sec-head"},
          React.createElement("div",{className:"lp-act"},"Act III · Plans"),
          React.createElement("h2",{className:"lp-h2"},"Pricing follows the rooms")),
        React.createElement("div",{className:"lp-tiers"},
          lpTiers().map((t,i)=>React.createElement("div",{key:i,className:"lp-tier"+(t.featured?" featured":"")},
            t.tag && React.createElement("div",{className:"lp-tier-tag"}, t.tag),
            React.createElement("div",{className:"lp-tier-name"}, t.name),
            React.createElement("div",{className:"lp-tier-price"},
              React.createElement("span",{className:"lp-tier-amt"}, t.price),
              React.createElement("span",{className:"lp-tier-per"}, t.per)),
            React.createElement("div",{className:"lp-tier-blurb"}, t.blurb),
            React.createElement("ul",{className:"lp-tier-feats"},
              t.feats.map((f,j)=>React.createElement("li",{key:j},
                React.createElement(Icon.check,{s:13}), React.createElement("span",null,f)))),
            React.createElement("button",{className:"lp-btn "+(t.featured?"primary":"ghost")+" full",onClick:()=>onStart(t.id)}, t.cta)))),
        lpPricingNote() && React.createElement("p",{className:"lp-tier-note"}, lpPricingNote())),

      // closing band — heading left, actions right (like a product-platform strip)
      React.createElement("section",{className:"lp-final"},
        React.createElement("div",{className:"lp-final-copy"},
          React.createElement("div",{className:"lp-act"},"Epilogue"),
          React.createElement("h2",{className:"lp-h2"},"Start building your film.")),
        React.createElement("div",{className:"lp-final-cta"},
          React.createElement("button",{className:"lp-btn ghost big",onClick:onSignIn},"Sign in"),
          React.createElement("button",{className:"lp-btn primary big",onClick:()=>onStart("free")},"Start creating")))),

    React.createElement("footer",{className:"lp-foot"},
      React.createElement("div",{className:"lp-foot-in"},
        React.createElement(LandingFootBrand,null),
        React.createElement("nav",{className:"lp-foot-links","aria-label":"Legal"},
          React.createElement("a",{className:"lp-foot-link",href:"/privacy.html",target:"_blank",rel:"noopener"},"Privacy"),
          React.createElement("a",{className:"lp-foot-link",href:"/terms.html",target:"_blank",rel:"noopener"},"Terms"))))));
}
window.Landing = Landing;
