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
    scenes:[{c:0.5,m:"Ordinary World"},{c:-1.0},{c:1.8,m:"Call to Adventure"},{c:-1.3},{c:1.6,m:"Crossing the Threshold"},
            {c:-2.8,m:"The Ordeal"},{c:1.9,m:"The Reward"},{c:-2.2,m:"Resurrection"},{c:2.3,m:"Return with the Elixir"}] },
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

/* the three rooms — titles as the app's room switcher names them (chrome.jsx) */
const LP_ROOMS = [
  { no:"01", icon:"script", title:"Writers' Room",
    body:"Turn an idea into a structured screenplay: logline, synopsis, a story spine charting every scene's value, beats and script — with Story Editors to test it. Everything stays editable.",
    cta:"Start with Writers' Room", plan:"writer" },
  { no:"02", icon:"palette", title:"The Art Room",
    body:"Design the film from the script: lookbook, characters and their voices, props, locations, color, shots and storyboards — drafted with your Department Heads, ready for production.",
    cta:"Start with the Art Room", plan:"director" },
  { no:"03", icon:"clapper", title:"The Stage",
    body:"Once the film is designed, shoot it as video, beat by beat, with voiced lines — then choose takes, assemble them on the timeline and export the film.",
    cta:"Start with the Stage", plan:"studio" },
];
/* (the room cards' plan chips — "Every plan", "Director and Producer plans", "Producer plan" — were
   removed 2026-10-03, owner request; the plan cards in Act III say which plan opens which room) */

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
  { n:"01", t:"Bring an idea", d:"A logline, a “what if” — or talk it through out loud with Frances." },
  // the structures (frameworks.jsx) and the formats in the Shape step's display order (formats.jsx)
  { n:"02", t:"Choose how it’s told", d:"Kinolot suggests a structure and a format for your idea, and you can keep them or pick your own: Three-Act Turns, Hero’s Journey or Kishōtenketsu, as a Feature Film, TV Series, Short Film, Micro Short, Micro-drama, Music Video, Documentary or Commercial." },
  { n:"03", t:"Build the film", d:"Research, synopsis, spine and script, then cast, places, shots and video — it all grows in one place." },
];

/* Pricing — derived from the SINGLE source of truth (plans.jsx CINEMA_PLANS), so
   the homepage and the in-app checkout can never drift. Update tiers in one place. */
function lpTiers(){
  return (window.CINEMA_PLANS || []).map(p=>({
    id:p.tier, name:p.name, price:p.price, per:"/ month", blurb:p.blurb,
    feats:(typeof window.turnPlanCardFeatures==="function" ? window.turnPlanCardFeatures(p) : p.features), featured:!!p.popular, tag:p.popular?"Most popular":null,
    cta:"Choose "+p.name,
  }));
}

/* the 14-day note behind the ⓘ right after each plan card's name (plans.jsx checkoutTip; owner request
   2026-10-02, R2), or null without plans.jsx */
function lpTipFn(){
  return (typeof window.turnCheckoutTip==="function") ? window.turnCheckoutTip : null;
}
/* the trial sentence of the line under the plan cards (owner request 2026-10-02, R1: "New accounts get
   50 free credits after confirming their email."). Shown only while the trial is offered (the same gate
   as the Plans window's trial line: plans.jsx turnTrialCopy); the number is the live regime's trial
   credits (app/pricing.jsx turnCreditRegime), else the trial's 50. The Plans window and the Terms keep
   the longer TRIAL_COPY. */
function lpTrialLine(){
  const offered = (typeof window.turnTrialCopy==="function") ? !!window.turnTrialCopy() : false;
  if(!offered) return "";
  const r = (typeof window.turnCreditRegime==="function") ? window.turnCreditRegime() : null;
  const live = Number(r && r.trialCredits);
  const n = (Number.isFinite(live) && live > 0) ? live : (Number(window.TURN_TRIAL_CREDITS) || 50);
  return "New accounts get "+n.toLocaleString("en-US")+" free credits after confirming their email.";
}
window.lpTrialLine = lpTrialLine;

/* the line under the plan cards (billing fixes 2026-09-30, both regimes 2026-10-01): the free
   trial and the credit packs ON SALE right now, read from the same sources as the in-app Plans
   window (plans.jsx). The trial starts on the credit switch day (supabase/billing-switch.sql);
   the packs are the old ones (from $9) before it and the new ones (from $10) after it, and a pack
   without a checkout link here isn't on sale. While the live credit unit isn't known yet the line
   names nothing ("" — hidden), since either offer could be the wrong one. */
/* the line's sentences, each on its own line under the cards (owner 2026-10-02: the packs sentence
   on a new line; the price-terms line removed — the Terms still say prices are in US dollars and
   include any VAT or sales tax) */
function lpPricingLines(){
  if(typeof window.turnCreditRegimeKnownForPlans==="function" && !window.turnCreditRegimeKnownForPlans()) return [];
  const trial = lpTrialLine();
  const packs = (typeof window.turnActiveCreditPacks==="function") ? window.turnActiveCreditPacks() : (window.CINEMA_CREDIT_PACKS || []);
  const onSale = (typeof window.turnPackOnSale==="function") ? packs.filter(p=>window.turnPackOnSale(p)) : packs;
  const usd = p=>parseFloat(String(p.price).replace(/[^\d.]/g,""));
  const from = onSale.length ? onSale.slice().sort((a,b)=>usd(a)-usd(b))[0].price : "";
  const packLine = from ? "Credit packs from "+from+" for any account — pack credits last 12 months." : "";
  if(!trial) return packLine ? [packLine] : [];
  return packLine ? [trial, "Need more? "+packLine] : [trial];
}
window.lpPricingLines = lpPricingLines;
function lpPricingNote(){ return lpPricingLines().join(" "); }
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
          React.createElement("button",{className:"lp-btn primary",onClick:()=>onStart("writer")},"Start with Writers' Room")),
        // mobile-only hamburger (the inline buttons hide below 560px)
        React.createElement("button",{className:"lp-burger"+(menuOpen?" open":""),"aria-label":"Menu",
          "aria-expanded":menuOpen?"true":"false",onClick:()=>setMenuOpen(o=>!o)},
          React.createElement("span",null),React.createElement("span",null),React.createElement("span",null))),
      menuOpen && React.createElement("div",{className:"lp-menu"},
        React.createElement("button",{className:"lp-menu-item",onClick:()=>{ setMenuOpen(false); onSignIn(); }},"Sign in"),
        React.createElement("button",{className:"lp-menu-item primary",onClick:()=>{ setMenuOpen(false); onStart("writer"); }},"Start with Writers' Room"))),

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
          "Start with the room you need. Write the screenplay now, design the film when you are ready, then shoot it on the Stage — one project, one story spine, every department connected."))),

    // hero media — the 21:9 short-film placeholder, still outside the frame
    React.createElement("section",{className:"lp-hero-media"},
      React.createElement(HeroSpine,{structure:LP_STRUCTURES[structIdx]})),

    // the hairline-framed column starts BELOW the hero (features onward)
    React.createElement("div",{className:"lp-frame"},

      React.createElement("section",{className:"lp-section"},
        React.createElement("div",{className:"lp-sec-head"},
          React.createElement("div",{className:"lp-act"},"Act I · Choose your room"),
          React.createElement("h2",{className:"lp-h2"},"Start with the room ",React.createElement("em",null,"you need."))),
        React.createElement("div",{className:"lp-grid"},
          LP_ROOMS.map((f,i)=>React.createElement("div",{key:i,className:"lp-card lp-room-card"},
            React.createElement("div",{className:"lp-card-top"},
              React.createElement("div",{className:"lp-card-ic"}, Icn(f.icon,20)),
              React.createElement("span",{className:"lp-card-no"}, f.no)),
            React.createElement("div",{className:"lp-card-t"}, f.title),
            React.createElement("div",{className:"lp-card-b"}, f.body),
            React.createElement("button",{className:"lp-btn ghost full lp-room-cta",onClick:()=>onStart(f.plan)}, f.cta))))),

      React.createElement("section",{className:"lp-section steps"},
        React.createElement("div",{className:"lp-sec-head"},
          React.createElement("div",{className:"lp-act"},"Act II · The process"),
          React.createElement("h2",{className:"lp-h2"},"How it ",React.createElement("em",null,"works."))),
        React.createElement("div",{className:"lp-steps"},
          LP_STEPS.map((s,i)=>React.createElement("div",{key:i,className:"lp-step"},
            React.createElement("div",{className:"lp-step-n"}, s.n),
            React.createElement("div",{className:"lp-step-t"}, s.t),
            React.createElement("div",{className:"lp-step-d"}, s.d))))),

      React.createElement("section",{className:"lp-section pricing"},
        React.createElement("div",{className:"lp-sec-head"},
          React.createElement("div",{className:"lp-act"},"Act III · Plans"),
          React.createElement("h2",{className:"lp-h2"},"Pricing follows ",React.createElement("em",null,"the rooms."))),
        React.createElement("div",{className:"lp-tiers"},
          lpTiers().map((t,i)=>React.createElement("div",{key:i,className:"lp-tier"+(t.featured?" featured":"")},
            t.tag && React.createElement("div",{className:"lp-tier-tag"}, t.tag),
            // the plan's name, then the ⓘ with the 14-day note (owner request 2026-10-02, R2): this
            // card's button leads to the plan's checkout (it opens by itself after sign-up), so it goes
            // with the same note as the Plans window's buttons (plans.jsx checkoutTip)
            React.createElement("div",{className:"lp-tier-name-row checkout-tip-row"},
              React.createElement("div",{className:"lp-tier-name"}, t.name),
              lpTipFn() && lpTipFn()("lp-checkout-note-"+t.id, "lp-checkout-tip")),
            React.createElement("div",{className:"lp-tier-price"},
              React.createElement("span",{className:"lp-tier-amt"}, t.price),
              React.createElement("span",{className:"lp-tier-per"}, t.per)),
            React.createElement("div",{className:"lp-tier-blurb"}, t.blurb),
            React.createElement("ul",{className:"lp-tier-feats"},
              t.feats.map((f,j)=>React.createElement("li",{key:j},
                React.createElement(Icon.check,{s:13}), React.createElement("span",null,f)))),
            React.createElement("button",{className:"lp-btn "+(t.featured?"primary":"ghost")+" full",onClick:()=>onStart(t.id),
              "aria-describedby": lpTipFn() ? "lp-checkout-note-"+t.id : undefined}, t.cta)))),
        // one note under the cards: the trial sentence, then the packs on a line of their own (owner
        // 2026-10-02); nothing to name, no note
        lpPricingLines().length ? React.createElement("p",{className:"lp-tier-note"},
          ...lpPricingLines().flatMap((line,i)=> i ? [React.createElement("br",{key:"br"+i}), line] : [line])) : null),

      // closing band — heading left, actions right (like a product-platform strip)
      React.createElement("section",{className:"lp-final"},
        React.createElement("div",{className:"lp-final-copy"},
          React.createElement("div",{className:"lp-act"},"Epilogue"),
          React.createElement("h2",{className:"lp-h2"},"Start building ",React.createElement("em",null,"your film."))),
        React.createElement("div",{className:"lp-final-cta"},
          React.createElement("button",{className:"lp-btn ghost big",onClick:onSignIn},"Sign in"),
          React.createElement("button",{className:"lp-btn primary big",onClick:()=>onStart("free")},"Create a free account")))),

    React.createElement("footer",{className:"lp-foot"},
      React.createElement("div",{className:"lp-foot-in"},
        React.createElement(LandingFootBrand,null),
        React.createElement("nav",{className:"lp-foot-links","aria-label":"Legal"},
          React.createElement("a",{className:"lp-foot-link",href:"/privacy.html",target:"_blank",rel:"noopener"},"Privacy"),
          React.createElement("a",{className:"lp-foot-link",href:"/terms.html",target:"_blank",rel:"noopener"},"Terms"))))));
}
window.Landing = Landing;
