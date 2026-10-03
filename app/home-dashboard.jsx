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
    { icon:"layers",   title:"Multi-Modal Inputs",   body:"Frames, storyboards, voices and character sheets — up to 12 references steer each render." },
    { icon:"camera",   title:"Director-Level Control",body:"Camera, lighting and performance, specified shot by shot — never left to chance." },
    { icon:"film",     title:"From Shot to Sequence", body:"Shots pack into clips, clips into scenes — extend and refine take by take." },
  ];

  function Ic(name, s){ const I = (window.Icon && (Icon[name]||Icon.grid)); return I ? h(I,{s:s||16}) : null; }

  function HomeDashboard(props){
    const { projects, currentId, room,
            onOpen, onCreate, onGeneratePoster, onRegenPoster, onRestorePoster,
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
    // Recent Projects is a PAGED window (‹ › arrows) over the owned films — FOUR
    // film cards a page; the fifth column is always the New Project card
    const PER = 4;
    const [start, setStart] = React.useState(0);
    const maxStart = Math.max(0, mine.length - PER);
    const from = Math.min(start, maxStart);
    const recent = mine.slice(from, from + PER);
    // the shared strip pages too (five per page — no New card in this row)
    const SPER = 5;
    const [sStart, setSStart] = React.useState(0);
    const sMax = Math.max(0, shared.length - SPER);
    const sFrom = Math.min(sStart, sMax);
    const sharedPage = shared.slice(sFrom, sFrom + SPER);
    const current = films.find(p=> p.id===currentId) || null;
    const hero = current || films.find(p=> p.cover) || films[0] || null;
    const activeRoom = room || "writers";

    // ----- auto-poster: any recent film without key art gets one minted for it -------
    // Generated covers are persisted (onGeneratePoster writes doc.cover) so a film is
    // only ever painted ONCE — on the next open it already has p.cover and is skipped.
    const [genBusy, setGenBusy] = React.useState({});   // id -> true while its poster renders
    const attempted = React.useRef({});                 // id -> true once tried this mount (no retry loops)
    const missing = recent.filter(p=> !p.cover).map(p=> p.id).join(",");
    const ledgerKey = window.turnCreditBalance ? String(window.turnCreditBalance.plan||"none") : "";
    React.useEffect(()=>{
      if(typeof onGeneratePoster!=="function") return;
      // a free-trial / no-plan account's credits are theirs to spend: no automatic posters
      // (billing fixes, 2026-09-30) — they can still paint one by hand. A signed-in account
      // waits for its ledger first (the effect re-runs when it loads: ledgerKey).
      if(window.turnUserId && !window.turnCreditBalance && !window.turnIsAdmin) return;
      if(typeof window.turnDraftImagesOnly==="function" && window.turnDraftImagesOnly()) return;
      let cancelled = false;
      (async ()=>{
        for(const p of recent){
          if(cancelled) break;
          if(p.cover || attempted.current[p.id]) continue;   // already has art, or already tried
          // no story yet → nothing to ground a poster in (a blank "Untitled film"
          // would get generic junk art and burn credits) — wait for a logline
          if(!String(p.logline||"").trim()) continue;
          attempted.current[p.id] = true;
          setGenBusy(b=> ({ ...b, [p.id]:true }));
          try{ await onGeneratePoster(p); }
          catch(err){
            // stop the batch on failure (e.g. out of image credits) so we don't burn attempts
            if(window.appToast) window.appToast(String((err&&err.message)||"Couldn't paint a poster."),"error");
            if(!cancelled) setGenBusy(b=>{ const n={ ...b }; delete n[p.id]; return n; });
            break;
          }
          finally{ if(!cancelled) setGenBusy(b=>{ const n={ ...b }; delete n[p.id]; return n; }); }
        }
      })();
      return ()=>{ cancelled = true; };
    }, [missing, ledgerKey]);   // re-run when the set of cover-less films changes (or the ledger loads)

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
      const a = document.createElement("a"); a.href = p.cover;
      a.download = (p.title||"poster").replace(/[^\w-]+/g,"-")+"-poster.jpg"; a.click(); };
    const doRegen = async (p,e)=>{ e.stopPropagation();
      if(genBusy[p.id] || typeof onRegenPoster!=="function") return;
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
          h("button",{className:"hd-tbtn hd-accent", onClick:onCreate}, Ic("plus",15), "New Project"),
          accountSlot ? h("div",{className:"hd-acct"}, accountSlot) : null)));

    // ----- hero -------------------------------------------------------------
    const stepper = h("div",{className:"hd-steps"},
      STEPS.map(st=> h("button",{ key:st.id,
        className:"hd-step"+(st.id===activeRoom?" on":"")+(st.live?"":" soon"),
        disabled:!st.live,
        onClick:()=> st.live && onGoRoom && onGoRoom(st.id)},
        h("span",{className:"hd-step-no"}, st.no),
        h("span",{className:"hd-step-phase"}, st.phase),
        h("span",{className:"hd-step-name"}, st.name))));

    const activeStep = STEPS.find(s=>s.id===activeRoom) || STEPS[0];
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
      hero && h("div",{className:"hd-hero-media-cap"}, hero.title||"Untitled film"));

    const heroSection = h("section",{className:"hd-hero"},
      h("div",{className:"hd-hero-left"},
        h("h1",{className:"hd-hero-title"}, "From idea to",h("br",null),
          h("span",{className:"hd-accent-text"},"final frame.")),
        h("p",{className:"hd-hero-sub"},"Your studio is open. Develop the story, design the world, and shoot the film"),
        stepper,
        h("div",{className:"hd-hero-cta"},
          h("button",{className:"hd-btn hd-btn-accent", onClick:()=> onGoRoom && onGoRoom(activeStep.live?activeStep.id:"stage")},
            "Go to "+(activeStep.live?activeStep.name:"The Stage"), Ic("arrowR",16)),
          h("button",{className:"hd-btn hd-btn-ghost", onClick:onClose}, "Open Project"))),
      h("div",{className:"hd-hero-right"}, hero_panel));

    // ----- recent projects --------------------------------------------------
    const recentSection = h("section",{className:"hd-recent"},
      h("div",{className:"hd-sec-head"},
        h("h2",{className:"hd-sec-title"},"Recent Projects"),
        mine.length > PER && h("div",{className:"hd-nav"},
          h("button",{className:"hd-navbtn", disabled:from<=0, title:"Previous", "aria-label":"Previous projects",
            onClick:()=> setStart(Math.max(0, from - PER))}, Ic("chevL",15)),
          h("button",{className:"hd-navbtn", disabled:from>=maxStart, title:"Next", "aria-label":"Next projects",
            onClick:()=> setStart(Math.min(maxStart, from + PER))}, Ic("chevR",15)))),
      h("div",{className:"hd-recent-row"},
        recent.map(p=> h("div",{ key:p.id, className:"hd-card"+(p.id===currentId?" current":""),
            role:"button", tabIndex:0, onClick:()=> onOpen && onOpen(p.id),
            onKeyDown:(e)=>{ if(e.key==="Enter") onOpen && onOpen(p.id); }},
          h("div",{className:"hd-card-art",
              style: p.cover ? { backgroundImage:'url("'+p.cover+'")' } : null},
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
        h("h2",{className:"hd-sec-title"},"Shared with me"),
        shared.length > SPER && h("div",{className:"hd-nav"},
          h("button",{className:"hd-navbtn", disabled:sFrom<=0, title:"Previous", "aria-label":"Previous shared projects",
            onClick:()=> setSStart(Math.max(0, sFrom - SPER))}, Ic("chevL",15)),
          h("button",{className:"hd-navbtn", disabled:sFrom>=sMax, title:"Next", "aria-label":"Next shared projects",
            onClick:()=> setSStart(Math.min(sMax, sFrom + SPER))}, Ic("chevR",15)))),
      h("div",{className:"hd-recent-row"},
        sharedPage.map(p=> h("div",{ key:p.id, className:"hd-card hd-card-shared"+(p.id===currentId?" current":""),
            role:"button", tabIndex:0, onClick:()=> onOpen && onOpen(p.id),
            onKeyDown:(e)=>{ if(e.key==="Enter") onOpen && onOpen(p.id); },
            title: roleBlurb(p.shareRole)},
          h("div",{className:"hd-card-art",
              style: p.cover ? { backgroundImage:'url("'+p.cover+'")' } : null},
            !p.cover && h("span",{className:"hd-card-initials"}, initials(p.title)),
            h("span",{className:"hd-card-pill hd-pill-shared"},
              ("SHARED · "+roleLabel(p.shareRole)).toUpperCase()),
            h("div",{className:"hd-card-shade"},
              h("div",{className:"hd-card-name"}, p.title||"Untitled film"),
              h("div",{className:"hd-card-sub hd-card-owner"},
                p.ownerEmail ? ("Shared by "+p.ownerEmail) : "Shared with you"),
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
    const posterViewer = viewer && h("div",{className:"lb-overlay",
        onMouseDown:(e)=>{ if(e.target===e.currentTarget) setViewer(null); }},
      h("div",{className:"lb-panel"},
        h("div",{className:"lb-head"},
          h("span",{className:"lb-title"}, viewer.title),
          h("button",{className:"ag-x", onClick:()=>setViewer(null), title:"Close (Esc)", "aria-label":"Close"}, Ic("x",17))),
        h("div",{className:"lb-imgwrap",
            onMouseDown:(e)=>{ if(e.target===e.currentTarget) setViewer(null); }},
          h("img",{className:"lb-img", src:viewer.url, alt:viewer.title+" — poster"})),
        h("div",{className:"lb-foot"},
          h("button",{className:"lb-dl", onClick:()=>{
              const a=document.createElement("a"); a.href=viewer.url;
              a.download=(viewer.title||"poster").replace(/[^\w-]+/g,"-")+"-poster.jpg"; a.click(); }},
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
          recentSection,
          sharedSection,
          featureSection,
          footer)),
      posterViewer);
  }

  window.HomeDashboard = HomeDashboard;
})();
