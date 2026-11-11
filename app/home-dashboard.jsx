/* home-dashboard.jsx — the Home dashboard (the studio's front door).

   A top bar (brand + current-project chip + actions + account), a hero that
   pitches the studio and drops you straight into the production pipeline, a
   "Recent Projects" strip built from the user's real films, and a feature strip.

   Everything here is wired to REAL app state — projects come from the live list,
   the pipeline steps open the actual rooms (through the app's guarded room
   switch), "New Project" creates a film, and project cards open that film.

   DESIGN: the signed-out landing page's (landing.jsx) page grid and identity —
   the Kinolot lockup, Spectral serif headlines, the app's 9px-radius buttons with
   the amber primary, the Kinolot amber as the single warm accent. Theme-aware:
   paper in the light theme, the app's charcoal in the dark (styles.css .hd-root).

   Gating (in app.jsx): this dashboard is the ONLY Home. It shows once the user
   has >=2 films OR any film shared with them (so someone whose only film is a
   share still gets a front door that explains it); below that, opening Home
   lands straight in the Writers' Room instead.

   SHARED FILMS get their own "Shared with me" section: owned films keep their
   ordering/poster behaviour in Recent Projects untouched, while shared cards
   name the owner and the viewer's role — and never auto-paint posters (the key
   art belongs to the owner; a viewer shouldn't spend credits on it). */

(function(){
  const h = React.createElement;

  // The format registry's own labels (formats.jsx). A local display map here went stale when
  // the lineup changed on 2026-09-25 — it showed every Short Film as "Feature Film".
  function displayType(p){
    if(typeof formatOf==="function" && p && p.fmt){
      try{ const f=formatOf({ format:p.fmt }); if(f&&f.label) return f.label; }catch(e){}
    }
    return "Film";
  }

  function updatedAgo(ts){
    if(!ts) return "";
    const diff = Date.now() - new Date(ts).getTime();
    if(!(diff>=0)) return "Updated just now";
    const m=Math.floor(diff/60000), hr=Math.floor(m/60), d=Math.floor(hr/24);
    if(d>0)  return "Updated "+d+"d ago";
    if(hr>0) return "Updated "+hr+"h ago";
    if(m>0)  return "Updated "+m+"m ago";
    return "Updated just now";
  }

  const initials = (t)=> (t||"Untitled").trim().split(/\s+/).slice(0,2).map(w=>w[0]||"").join("").toUpperCase() || "·";

  /* A POSTER'S FILE NAME keeps the title's letters in any language (2026-10-09 — "東京物語" came out "-poster.jpg") */
  function posterFileName(title){
    const raw = String(title||"").trim();
    let slug = "";
    try{ slug = raw.normalize("NFC").replace(new RegExp("[^\\p{L}\\p{M}\\p{N}\\-]+","gu"),"-"); }catch(e){ slug = raw.replace(/[^\w-]+/g,"-"); }
    slug = slug.replace(/-+/g,"-").replace(/^-+|-+$/g,"").slice(0,80);
    return (slug || "poster")+"-poster.jpg";
  }
  /* the poster is FETCHED, then saved: a cloud poster lives on another address, where the browser ignores the
     download name and opens the image in a tab instead (2026-10-09) */
  async function downloadPoster(url, title){
    const name = posterFileName(title);
    try{
      const blob = await (await fetch(url)).blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = href; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(()=>{ try{ document.body.removeChild(a); URL.revokeObjectURL(href); }catch(e){} }, 1000);
    }catch(e){
      const a = document.createElement("a"); a.href = url; a.download = name; a.target = "_blank"; a.rel = "noopener"; a.click();
    }
  }
  window.turnPosterFileName = posterFileName;
  // the owner's name, never their email address (the Team rule: names, not emails — 2026-10-09)
  const ownerName = (email)=>{ const e = String(email||""); if(!e) return "";
    if(typeof cloudHandleName==="function"){ try{ const n = cloudHandleName(e); if(n) return n; }catch(_e){} }
    return e.split("@")[0].split("+")[0]; };
  // a poster's price: GPT Image 2.5 Sunburst, high quality, 2K, 9:16 (what generatePoster paints), per poster
  // (2026-10-11, owner — image engines: it was GPT Image 2). Its reference images aren't known here, so this is the
  // price without them — the server holds the real cost of each poster
  const posterCost = (n)=> (typeof window.nbImageCostText==="function")
    ? window.nbImageCostText(Math.max(1, n||1), { model:"gpt-image-2.6-sunburst", quality:"high", res:"2K", aspect:"9:16" }) : "";
  const POSTER_SKIP_KEY = "turn_home_poster_skip";
  const readSkip = ()=>{ try{ return JSON.parse(localStorage.getItem(POSTER_SKIP_KEY)||"[]")||[]; }catch(e){ return []; } };

  // Honest pipeline phase from the cheap list-row probes (cloudListProjects):
  // a shot list means the film is shooting; location cards mean the Art Room
  // has begun; otherwise it's still being written.
  const phaseOf = (p)=> (p && p.hasShots) ? "In Production" : (p && p.hasLocs) ? "Pre-Production" : "Development";

  // Pipeline steps mirror window.ROOMS but with the landing-page phrasing.
  const STEPS = [
    { id:"writers", no:"01", phase:"Development",    name:"Writers' Room",  live:true },
    { id:"art",     no:"02", phase:"Pre-production", name:"The Art Room",   live:true },
    { id:"stage",   no:"03", phase:"Production",     name:"The Stage",      live:true },
    { id:"cutting", no:"04", phase:"Post",           name:"Coming soon",    live:false },
  ];

  const FEATURES = [
    { icon:"sparkles", title:"Cinematic Generation", body:"Film-grade video with native audio — every take arrives with its sound." },
    { icon:"layers",   title:"Multi-Modal Inputs",   body:"Frames, storyboards, voices and character sheets — up to 50 references steer each render (the limit follows the video model)." },
    { icon:"camera",   title:"Director-Level Control",body:"Camera, lighting and performance, specified shot by shot — never left to chance." },
    { icon:"film",     title:"From Shot to Sequence", body:"Shots pack into clips, clips into scenes — extend and refine take by take." },
  ];

  function Ic(name, s){ const I = (window.Icon && (Icon[name]||Icon.grid)); return I ? h(I,{s:s||16}) : null; }

  function HomeDashboard(props){
    const { projects, currentId, room,
            onOpen, onCreate, onImportScript, onGeneratePoster, onRegenPoster, onRestorePoster,
            onGoRoom, onClose, accountSlot, noticesSlot, notifySlot } = props;

    // real films only (shows are containers), newest-updated first (list already sorted)
    const films = (projects||[]).filter(p=>!(window.turnSeries&&typeof window.turnSeries.isShowDoc==="function"
      ? window.turnSeries.isShowDoc(p)
      : p&&(String(p.project_kind||"").toLowerCase()==="show"||String(p.isShow).toLowerCase()==="true")))
      // a blank canvas (no story yet) is not a film — never a card called "Untitled film"
      .filter(p=>!(typeof window.turnFilmIsBlank==="function" && window.turnFilmIsBlank(p)));
    // owned vs shared-with-me: Recent Projects stays OWNED films only (ordering,
    // paging and poster behaviour unchanged); shared films get their own section
    const mine = films.filter(p=> !p.isShared);
    const shared = films.filter(p=> !!p.isShared);
    // Recent Projects is a PAGED window (‹ › arrows) over the owned films — THREE
    // film cards a page; the fourth column is always the New Project card (owner 2026-10-16: bigger cards)
    const PER = 3;
    const [start, setStart] = React.useState(0);
    const maxStart = Math.max(0, mine.length - PER);
    const from = Math.min(start, maxStart);
    const recent = mine.slice(from, from + PER);
    // the shared strip pages too (four per page, the same card size — no New card in this row)
    const SPER = 4;
    const [sStart, setSStart] = React.useState(0);
    const sMax = Math.max(0, shared.length - SPER);
    const sFrom = Math.min(sStart, sMax);
    const sharedPage = shared.slice(sFrom, sFrom + SPER);
    const current = films.find(p=> p.id===currentId) || null;
    const hero = current || films.find(p=> p.cover) || films[0] || null;
    const activeRoom = room || "writers";

    /* ----- POSTERS ASK FIRST (2026-10-09, owner — Home review) -------------------------------
       Home used to paint a poster for every owned film without one the moment it opened (a paid
       poster image at high quality, 2K, with reference images) — and four more on each page.
       Now it OFFERS: "N films have no poster — Paint posters · price", and paints nothing until you
       say yes; "Not now" is remembered on this device for those films. A film without a logline is
       never offered (no story, no poster). Trial / no-plan accounts aren't offered a batch. */
    const [genBusy, setGenBusy] = React.useState({});   // id -> true while its poster renders
    const [skip, setSkip] = React.useState(readSkip);
    const [painting, setPainting] = React.useState(false);
    // no offer for a trial / no-plan account, nor before the credit ledger has loaded (it can't know yet)
    const draftOnly = (typeof window.turnDraftImagesOnly==="function" && window.turnDraftImagesOnly())
      || !!(window.turnUserId && !window.turnCreditBalance && !window.turnIsAdmin);
    const noPoster = mine.filter(p=> !p.cover && String(p.logline||"").trim());
    const offer = (typeof onGeneratePoster==="function" && !draftOnly) ? noPoster.filter(p=> skip.indexOf(p.id)<0) : [];
    const notNow = ()=>{ const ids = Array.from(new Set(skip.concat(offer.map(p=>p.id))));
      setSkip(ids); try{ localStorage.setItem(POSTER_SKIP_KEY, JSON.stringify(ids.slice(-500))); }catch(e){} };
    const paintAll = async ()=>{
      if(painting || !offer.length) return;
      const n = offer.length, price = posterCost(n);
      if(typeof window.appConfirm==="function"){
        const ok = await window.appConfirm({ title:"Paint "+n+" poster"+(n!==1?"s":"")+"?",
          body:"Each poster is painted from the film's own cast, world and look, at high quality and 2K"
            +(price ? " \u2014 about "+price+" credits in all, plus about 1 credit for each reference image a poster uses." : ".")
            +" A poster that fails isn't charged.",
          confirmLabel:"Paint "+n+" poster"+(n!==1?"s":""), cancelLabel:"Not now" });
        if(!ok) return;
      }
      setPainting(true);
      try{
        for(const p of offer){
          setGenBusy(b=> ({ ...b, [p.id]:true }));
          try{ await onGeneratePoster(p); }
          catch(err){
            // stop the batch on failure (e.g. out of image credits) so nothing more is spent
            if(window.appToast) window.appToast(String((err&&err.message)||"Couldn't paint a poster."),"error");
            break;
          }
          finally{ setGenBusy(b=>{ const n2={ ...b }; delete n2[p.id]; return n2; }); }
        }
      } finally { setPainting(false); }
    };

    // ----- full-screen poster preview (the app's shared immersive lightbox) --
    const [viewer, setViewer] = React.useState(null);   // {url, title} | null
    React.useEffect(()=>{
      if(!viewer) return;
      const onKey = (e)=>{ if(e.key==="Escape") setViewer(null); };
      window.addEventListener("keydown", onKey);
      return ()=> window.removeEventListener("keydown", onKey);
    },[viewer]);

    // ----- manual poster actions (per card, on hover) -------------------------
    const doView = (p,e)=>{ e.stopPropagation();
      if(p.cover) setViewer({ url:p.cover, title:p.title||"Untitled film" }); };
    const doDownload = (p,e)=>{ e.stopPropagation();
      if(!p.cover) return;
      downloadPoster(p.cover, p.title); };
    // a new poster asks first, with its price (2026-10-09 — one hover click painted a paid image)
    const doRegen = async (p,e)=>{ e.stopPropagation();
      if(genBusy[p.id] || typeof onRegenPoster!=="function") return;
      if(typeof window.appConfirm==="function"){
        const price = posterCost(1);
        const ok = await window.appConfirm({ title:(p.cover?"Paint a new poster":"Paint a poster")+" for \u201c"+(p.title||"Untitled film")+"\u201d?",
          body:(price ? "About "+price+" credits, plus about 1 credit for each reference image it uses. " : "")
            +(p.cover ? "The current poster stays restorable (Restore previous poster)." : "It's painted from the film's own cast, world and look."),
          confirmLabel:p.cover?"Paint a new poster":"Paint the poster", cancelLabel:"Cancel" });
        if(!ok) return;
      }
      setGenBusy(b=>({ ...b, [p.id]:true }));
      try{ await onRegenPoster(p); }
      catch(err){ if(window.appToast) window.appToast(String((err&&err.message)||"Couldn't paint a poster."),"error"); }
      finally{ setGenBusy(b=>{ const n={ ...b }; delete n[p.id]; return n; }); } };
    const doRestore = async (p,e)=>{ e.stopPropagation();
      if(typeof onRestorePoster==="function") await onRestorePoster(p); };

    // ----- top bar ----------------------------------------------------------
    // Mirrors the landing nav (.lp-nav): frosted full-width bar, content constrained
    // to the SAME 1280px column as the rails below, the lockup = the landing logo.
    const topbar = h("header",{className:"hd-topbar"},
      h("div",{className:"hd-topbar-in"},
        h("div",{className:"hd-topbar-l"},
          h("button",{className:"hd-brand", onClick:onClose, title:"Back to your film"},
            (typeof BrandMark!=="undefined") && h(BrandMark,null),
            h("span",{className:"hd-brand-name"},"Kinolot"))),
        h("div",{className:"hd-top-actions"},
          notifySlot || null,
          // white, as every top-bar button in the rooms (homepage style, 2026-10-16): the amber is the page's
          // own primary — the hero's "Go to …" button
          // a finished screenplay comes in word for word (phase 3, 2026-10-18)
          typeof onImportScript==="function" && h("button",{className:"hd-tbtn hd-import", onClick:onImportScript, title:"Import a screenplay \u2014 Fountain, Final Draft, Highland, PDF, Word or plain text"}, Ic("script",15), "Import a script"),
          h("button",{className:"hd-tbtn hd-newproj", onClick:onCreate}, Ic("plus",15), "New Project"),
          accountSlot ? h("div",{className:"hd-acct"}, accountSlot) : null)));

    // ----- THE HERO (owner 2026-10-16: the "take by take" mockup is Home's design) — on the left the eyebrow, the
    // title, what the studio does, the four rooms as tiles (the room you were in in amber; a click goes there),
    // the open film's logline, and the two actions; on the right the open film's premiere screen ---------------
    const activeStep = STEPS.find(s=>s.id===activeRoom) || STEPS[0];
    const nowFilm = current || hero;
    const roomTabs = h("nav",{className:"hd-rooms hd-room-tiles","aria-label":"The rooms"},
      STEPS.map(st=> h("button",{ key:st.id, type:"button",
        className:"hd-step hd-room-tile"+(st.id===activeRoom?" on":"")+(st.live?"":" soon"),
        disabled:!st.live, "aria-label":st.no+" "+st.phase+" — "+(st.live ? st.name : "coming soon"),
        "aria-current":st.id===activeRoom ? "step" : undefined,
        onClick:()=> st.live && onGoRoom && onGoRoom(st.id)},
        h("span",{className:"hd-step-no"}, st.no+" "+st.phase),
        h("span",{className:"hd-step-name"}, st.live ? st.name : "Post · soon"))));
    // THE PREMIERE SCREEN — a video placeholder for the current film once it's
    // fully assembled (the Post room will play it here). Until then: a dark
    // cinema screen with the play button into The Stage. Poster previews live
    // on the project cards, not here — a 9:16 poster crops badly at 16:10.
    const hero_panel = h("div",{className:"hd-hero-media"},
      h("div",{className:"hd-hero-media-fallback"}),
      h("span",{className:"lp-video-badge"},"PREMIERE · COMING SOON"),
      h("button",{className:"hd-play", onClick:()=> onGoRoom && onGoRoom("stage"), title:"Go to The Stage", "aria-label":"Go to The Stage"},
        Ic("play",26)),
      h("div",{className:"hd-hero-media-note"},"Your finished film will play here"),
      nowFilm && h("div",{className:"hd-hero-media-cap"}, nowFilm.title||"Untitled film"),
      nowFilm && h("div",{className:"hd-hero-media-meta"},
        [displayType(nowFilm), updatedAgo(nowFilm.updated_at||nowFilm.created_at)].filter(Boolean).join(" · ")));
    const logline = nowFilm ? String(nowFilm.logline||"").replace(/\s+/g," ").trim() : "";
    const heroSection = h("section",{className:"hd-head"},
      h("div",{className:"hd-head-in"},
        h("div",{className:"hd-head-copy"},
          h("div",{className:"hd-eyebrow"}, "Home · Your studio"+(films.length ? " · "+films.length+" film"+(films.length!==1?"s":"") : "")),
          h("h1",{className:"hd-hero-title"}, "From idea to ", h("span",{className:"hd-accent-text"},"final frame.")),
          h("p",{className:"hd-hero-sub"},"Your studio is open. Develop the story, design the world, and shoot the film."),
          roomTabs,
          logline && h("blockquote",{className:"hd-hero-line"}, "“"+logline.replace(/[“”"]/g,"")+"”",
            h("cite",null,(nowFilm.title||"Untitled film")+" · "+phaseOf(nowFilm))),
          h("div",{className:"hd-hero-cta"},
            h("button",{className:"hd-btn hd-btn-accent", onClick:()=> onGoRoom && onGoRoom(activeStep.live?activeStep.id:"stage")},
              "Go to "+(activeStep.live?activeStep.name:"The Stage"), Ic("arrowR",16)),
            // back to the film that's open — named, and only when there is one (2026-10-09: "Open Project" only closed Home)
            current && h("button",{className:"hd-btn hd-btn-ghost", onClick:onClose}, "Back to "+(current.title||"Untitled film")))),
        hero_panel));

    // ----- recent projects --------------------------------------------------
    const recentSection = h("section",{className:"hd-recent"},
      h("div",{className:"hd-sec-head"},
        h("div",{className:"hd-sec-titles"},
          h("h2",{className:"hd-sec-title"},"Recent Projects"),
          mine.length>0 && h("span",{className:"hd-sec-count"}, mine.length+" film"+(mine.length!==1?"s":""))),
        // the poster offer (nothing is painted until you say yes)
        offer.length>0 && h("div",{className:"hd-poster-offer",role:"status"},
          h("span",null, offer.length+" film"+(offer.length!==1?"s have":" has")+" no poster"),
          h("button",{className:"hd-tbtn hd-accent",type:"button",disabled:painting,onClick:paintAll},
            painting ? "Painting\u2026" : ("Paint poster"+(offer.length!==1?"s":"")+(posterCost(offer.length) ? " \u00b7 \u2248"+posterCost(offer.length)+" credits" : ""))),
          !painting && h("button",{className:"hd-tbtn",type:"button",onClick:notNow},"Not now")),
        mine.length > PER && h("div",{className:"hd-nav"},
          h("button",{className:"hd-navbtn", disabled:from<=0, title:"Previous", "aria-label":"Previous projects",
            onClick:()=> setStart(Math.max(0, from - PER))}, Ic("chevL",15)),
          h("button",{className:"hd-navbtn", disabled:from>=maxStart, title:"Next", "aria-label":"Next projects",
            onClick:()=> setStart(Math.min(maxStart, from + PER))}, Ic("chevR",15)))),
      h("div",{className:"hd-recent-row"},
        recent.map(p=> h("div",{ key:p.id, className:"hd-card"+(p.id===currentId?" current":"")},
          // a real button opens the film (Enter and Space; the poster buttons beside it are their own) — 2026-10-09
          h("div",{className:"hd-card-art",
              style: p.cover ? { backgroundImage:'url("'+p.cover+'")' } : null},
            h("button",{className:"hd-card-open",type:"button","aria-label":"Open "+(p.title||"Untitled film"),
              onClick:()=> onOpen && onOpen(p.id)}),
            !p.cover && h("span",{className:"hd-card-initials"}, initials(p.title)),
            genBusy[p.id] && h("div",{className:"hd-card-gen"},
              h("span",{className:"hd-card-spin"}),
              h("span",{className:"hd-card-gen-lab"},"Painting poster…")),
            h("span",{className:"hd-card-pill"}, phaseOf(p).toUpperCase()),
            // poster actions (hover): view full screen / download / regenerate / restore
            h("div",{className:"hd-card-actions"},
              p.cover && h("button",{className:"hd-cact", title:"View poster full screen", "aria-label":"View poster full screen",
                onClick:(e)=>doView(p,e)}, Ic("maximize",13)),
              p.cover && h("button",{className:"hd-cact", title:"Download poster", "aria-label":"Download poster",
                onClick:(e)=>doDownload(p,e)}, Ic("download",13)),
              h("button",{className:"hd-cact", title:(p.cover?"Regenerate":"Generate")+" poster", "aria-label":(p.cover?"Regenerate":"Generate")+" poster",
                disabled:!!genBusy[p.id], onClick:(e)=>doRegen(p,e)}, Ic("redo",13)),
              p.coverPrev && h("button",{className:"hd-cact", title:"Restore previous poster", "aria-label":"Restore previous poster",
                onClick:(e)=>doRestore(p,e)}, Ic("undo",13))),
            h("div",{className:"hd-card-shade"},
              h("div",{className:"hd-card-name"}, p.title||"Untitled film"),
              h("div",{className:"hd-card-sub"}, displayType(p)),
              h("div",{className:"hd-card-meta"}, Ic("history",12), updatedAgo(p.updated_at||p.created_at)))))),
        // the New Project card is ALWAYS the fifth column
        h("button",{className:"hd-card hd-card-new", onClick:onCreate},
          h("div",{className:"hd-card-art hd-card-new-art"},
            Ic("plus",26),
            h("div",{className:"hd-card-new-lab"},"New Project")))));

    // ----- shared with me -----------------------------------------------------
    // Films OTHER people own and shared with this account. Every card says who
    // shared it and what the viewer may do (View-only / Co-writer / Art director).
    // No poster actions and no auto-painting here — the key art is the owner's.
    const roleLabel = (r)=> (typeof teamRoleLabel==="function") ? teamRoleLabel(r) : (r||"");
    const roleBlurb = (r)=> (typeof teamRoleBlurb==="function") ? (teamRoleBlurb(r)||"") : "";
    const sharedSection = shared.length ? h("section",{className:"hd-recent hd-shared"},
      h("div",{className:"hd-sec-head"},
        h("div",{className:"hd-sec-titles"},
          h("h2",{className:"hd-sec-title"},"Shared with me"),
          h("span",{className:"hd-sec-count"}, shared.length+" film"+(shared.length!==1?"s":""))),
        shared.length > SPER && h("div",{className:"hd-nav"},
          h("button",{className:"hd-navbtn", disabled:sFrom<=0, title:"Previous", "aria-label":"Previous shared projects",
            onClick:()=> setSStart(Math.max(0, sFrom - SPER))}, Ic("chevL",15)),
          h("button",{className:"hd-navbtn", disabled:sFrom>=sMax, title:"Next", "aria-label":"Next shared projects",
            onClick:()=> setSStart(Math.min(sMax, sFrom + SPER))}, Ic("chevR",15)))),
      h("div",{className:"hd-recent-row"},
        sharedPage.map(p=> h("div",{ key:p.id, className:"hd-card hd-card-shared"+(p.id===currentId?" current":""),
            title: roleBlurb(p.shareRole)},
          h("div",{className:"hd-card-art",
              style: p.cover ? { backgroundImage:'url("'+p.cover+'")' } : null},
            h("button",{className:"hd-card-open",type:"button","aria-label":"Open "+(p.title||"Untitled film")+", shared with you as "+roleLabel(p.shareRole),
              onClick:()=> onOpen && onOpen(p.id)}),
            !p.cover && h("span",{className:"hd-card-initials"}, initials(p.title)),
            h("span",{className:"hd-card-pill hd-pill-shared"},
              ("SHARED · "+roleLabel(p.shareRole)).toUpperCase()),
            h("div",{className:"hd-card-shade"},
              h("div",{className:"hd-card-name"}, p.title||"Untitled film"),
              h("div",{className:"hd-card-sub hd-card-owner"},
                p.ownerEmail ? ("Shared by "+ownerName(p.ownerEmail)) : "Shared with you"),
              h("div",{className:"hd-card-meta"}, Ic("history",12), updatedAgo(p.updated_at||p.created_at)))))))) : null;

    // ----- feature strip ----------------------------------------------------
    const featureSection = h("section",{className:"hd-features"},
      FEATURES.map((f,i)=> h("div",{key:i, className:"hd-feat"},
        h("span",{className:"hd-feat-ic"}, Ic(f.icon,18)),
        h("div",{className:"hd-feat-t"},
          h("div",{className:"hd-feat-title"}, f.title),
          h("div",{className:"hd-feat-body"}, f.body)))));

    // ----- footer — EXACTLY the landing footer: the same .lp-foot-in inner block
    // (1280px column + its own padding), full-bleed band, flush at the bottom.
    const footer = h("footer",{className:"hd-foot"},
      h("div",{className:"lp-foot-in"},
        (typeof LandingFootBrand==="function") ? h(LandingFootBrand,null) : h("span",{className:"lp-logo sm"},"Kinolot"),
        h("nav",{className:"lp-foot-links","aria-label":"Legal"},
          h("a",{className:"lp-foot-link",href:"/privacy.html",target:"_blank",rel:"noopener"},"Privacy"),
          h("a",{className:"lp-foot-link",href:"/terms.html",target:"_blank",rel:"noopener"},"Terms"))));

    // full-screen poster preview — the app's shared immersive lightbox chrome
    // (.lb-overlay/.lb-panel, same as the Art Room's sheet viewer)
    const posterViewer = viewer && h("div",{className:"lb-overlay",role:"dialog","aria-modal":"true","aria-label":viewer.title+" \u2014 poster",
        onMouseDown:(e)=>{ if(e.target===e.currentTarget) setViewer(null); }},
      h("div",{className:"lb-panel"},
        h("div",{className:"lb-head"},
          h("span",{className:"lb-title"}, viewer.title),
          h("button",{className:"ag-x", onClick:()=>setViewer(null), title:"Close (Esc)", "aria-label":"Close",
            ref:(el)=>{ if(el && !el.__focused){ el.__focused = true; try{ el.focus(); }catch(e){} } }}, Ic("x",17))),
        h("div",{className:"lb-imgwrap",
            onMouseDown:(e)=>{ if(e.target===e.currentTarget) setViewer(null); }},
          h("img",{className:"lb-img", src:viewer.url, alt:viewer.title+" — poster"})),
        h("div",{className:"lb-foot"},
          h("button",{className:"lb-dl", onClick:()=>downloadPoster(viewer.url, viewer.title)},
            Ic("download",14), "Download poster"))));

    return h("div",{className:"hd-root"},
      h("div",{className:"hd-main"},
        // full-height vertical rails at the 1280px column edges — the landing's
        // structural signature (.lp-rails), crossing each section rule in a "+"
        h("div",{className:"hd-rails","aria-hidden":"true"}),
        // THE BILLING NOTICES (billing repair 2026-09-30): Home covers the studio as a fixed overlay, so
        // the studio's banners (payment failed, account on hold, low balance) were hidden behind it —
        // app.jsx hands the same banners in here, at the very top
        noticesSlot ? h("div",{className:"hd-notices"}, noticesSlot) : null,
        topbar,
        h("div",{className:"hd-scroll"},
          heroSection,
                // the films under the hero, in the page column
          h("div",{className:"hd-body no-side"},
            h("div",{className:"hd-body-main"}, recentSection, sharedSection)),
          h("div",{className:"hd-feature-band"}, featureSection),
          footer)),
      posterViewer);
  }

  window.HomeDashboard = HomeDashboard;
})();
