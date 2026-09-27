/* art-tab-locks.js — THE ART ROOM TABS UNLOCK IN ORDER (2026-09-27, owner-approved —
   docs/Story Pipeline.md step 9, "The tabs unlock in that order").

   Every tab stays visible; a locked tab shows what it is waiting for and a button to the step
   that unlocks it:
     Lookbook      always open
     Characters    once the Lookbook has a look (lookbookHasLook: a visual statement, or a reference
                   card with a note, a named touchstone or an image)
     Props         once every character has a written spec (charVisualsDrafted; generated sheets are
                   not required)
     Locations     once every prop has a written spec (propVisualsDrafted), or, with no props at all,
                   once the user marks "No props in this story" (project.noPropsConfirmed)
     Color         once every location has a written spec (locVisualsDrafted)
     Shots         once the Color tab has a look (turnColorHasLook: the colour system / film stock)
     Storyboards   once shot coverage exists
     Breakdown     always open (Production check and Blender Studio are view-bar buttons: never locked)

   THE STEPS ARE A CHAIN: a tab's rule is judged once the step before it is itself open — a locked
   step can't unlock anything. So "a step with nothing to do unlocks the next one by itself" applies
   once that step is reached: no characters → Props opens with the Lookbook's look (the Characters
   gate), not before it; no props, once confirmed → Locations; no locations (the script names no
   place to pull in) → Color, once Locations is open.

   ANYTHING ALREADY BUILT STAYS REACHABLE: a tab that already has content is never locked. Content is
   what the tab holds or can restore: its cards (with a spec or an image, for the cast), the cards in
   its "Recently deleted" bin (the restore lives inside the tab), and for Props the "No props in this
   story" mark itself (so its Undo is always reachable where it was set).

   A LOCKED TAB POINTS AT THE FIRST STEP YOU CAN ACT ON: when the step before it is locked too, its
   card names that step and sends you to the first OPEN step in the chain (never to another lock card).

   NAMES: every mention of a tab starts with the label the tab bar shows ("Props"); when the film's
   FORMAT renames the department (formats.jsx rooms.title — a documentary's "Artifacts & Archive",
   a commercial's "Talent") the format's name follows in brackets: "Props (Artifacts & Archive)".

   Run pre-production is unchanged — the tabs simply unlock as its content lands.
   A TV Series episode hands in the state App already merged from the Show's Bible (the shared cast,
   props, locations, their bins and the Lookbook), so it unlocks from those.

   WHY "No props in this story" LIVES ON `project`: the database enforces the role allow-lists
   section by section (supabase/enforce-role-scopes.sql); a new top-level doc section would be
   rejected for an Art director and the rejection reloads the film, discarding their other unsaved
   edits. `project` is already saved per film/episode, merged key by key, and writable by the
   owner and the Art director (the Art Room is read-only for Writers and View-only members).

   ONE PURE FUNCTION (no React, no storage, no network): App computes it and hands the result to the
   tab bar, the phone ⋮ menu and the Art Room's lock card. The predicates it reads (lookbookHasLook,
   charVisualsDrafted, …) come from `s.helpers` or window; one that hasn't loaded fails OPEN, so a
   load-order hiccup never locks anyone out of their work. */
(function(){
  var ORDER = ["lookbook","characters","props","locations","stylebible","shots","storyboard"];
  var ALL = ORDER.concat(["breakdown"]);
  // the tab bar's labels (artroom.jsx ART_TABS) — what the user sees and clicks
  var BASE = { lookbook:"Lookbook", characters:"Characters", props:"Props", locations:"Locations",
    stylebible:"Color", shots:"Shots", storyboard:"Storyboards", breakdown:"Breakdown" };

  function objs(v){ return Array.isArray(v) ? v.filter(function(x){ return !!x && typeof x==="object"; }) : []; }
  function helper(s, name){
    var h = s && s.helpers;
    if(h && typeof h[name]==="function") return h[name];
    return (typeof window!=="undefined" && typeof window[name]==="function") ? window[name] : null;
  }
  function txt(v){ return String(v==null ? "" : v).trim(); }

  /* the department names this film's FORMAT uses (formats.jsx rooms.title): a documentary's
     Characters are "Subjects" and its Props "Artifacts & Archive", a commercial's "Talent" and
     "Product & Props". The "(Casting)" tail of a department title is dropped — it names the job. */
  function turnArtTabNames(project, roomCopyFn){
    var rc = typeof roomCopyFn==="function" ? roomCopyFn
      : ((typeof window!=="undefined" && typeof window.roomCopy==="function") ? window.roomCopy : null);
    var out = {};
    ALL.forEach(function(id){
      var t = "";
      try{ t = rc ? txt((rc(project, id)||{}).title) : ""; }catch(e){ t = ""; }
      t = t.replace(/\s*\([^)]*\)\s*$/,"").trim();
      out[id] = t || BASE[id];
    });
    return out;
  }
  /* how a tab is NAMED in lock copy: the tab bar's label first, the format's name in brackets
     when it differs — "Props (Artifacts & Archive)", "Characters (Subjects)", plain "Locations" */
  function turnArtTabDisplayNames(project, roomCopyFn){
    var N = turnArtTabNames(project, roomCopyFn), out = {};
    ALL.forEach(function(id){ out[id] = N[id]===BASE[id] ? BASE[id] : BASE[id]+" ("+N[id]+")"; });
    return out;
  }

  /* the Color tab "has a look" once the colour system or the film stock exists: a palette designed
     for this film (the Colorist replaces the starter presets), a scene assigned a look, or a film
     stock other than none. The Lookbook-synced reference text alone is not a look. */
  function turnColorHasLook(project){
    var sb = (project && project.styleBible) || {};
    var styles = (sb.sceneStyles && typeof sb.sceneStyles==="object") ? sb.sceneStyles : {};
    var styled = Object.keys(styles).some(function(k){ return !!styles[k]; });
    var bespoke = Array.isArray(sb.presets) && sb.presets.length>0;
    var stock = txt(sb.filmStock).toLowerCase();
    return !!(styled || bespoke || (stock && stock!=="none"));
  }
  /* anything the user already put in the Color tab — a look, references they typed (not the
     Lookbook's auto-fill), or uploaded reference images */
  function turnColorHasContent(project){
    if(turnColorHasLook(project)) return true;
    var sb = (project && project.styleBible) || {};
    var refs = txt(sb.refs);
    if(refs && refs!==txt(sb.lookbookSynced)) return true;
    return objs(sb.refImages).length>0;
  }
  function turnNoPropsConfirmed(project){ return !!(project && project.noPropsConfirmed===true); }

  /* does this card have an image? App's image caches, read synchronously: the bytes (local memory /
     localStorage, or the cloud URL cache) or, failing that, the asset's metadata — local metadata
     is in localStorage from the first paint, while the bytes may still sit in IndexedDB. A purged
     asset's tombstone metadata (deleted:true) is not an image. App re-checks when the caches fill
     (nb-prefetched / nb-gen-done), so a late cache never keeps a built tab locked. */
  function turnArtHasImage(id){
    if(!id || typeof window==="undefined") return false;
    try{ if(typeof window.nbGetImage==="function" && window.nbGetImage(id)) return true; }catch(e){}
    try{
      var m = typeof window.nbGetMeta==="function" ? window.nbGetMeta(id) : null;
      if(m && typeof m==="object" && !m.deleted) return true;
    }catch(e){}
    return false;
  }

  function count(items, test){
    var done = items.filter(test).length;
    return { done:done, total:items.length };
  }
  function soFar(p){ return p.done+" of "+p.total+" so far"; }

  function turnArtTabLocks(s){
    s = s || {};
    var project = s.project || {};
    var rcFn = s.helpers && s.helpers.roomCopy;
    var N = turnArtTabNames(project, rcFn), D = turnArtTabDisplayNames(project, rcFn);
    var chars = objs(s.characters), props = objs(s.props), locs = objs(s.locations), shots = objs(s.shots);
    var bin = (s.trash && typeof s.trash==="object") ? s.trash : {};
    var hasImage = typeof s.hasImage==="function" ? s.hasImage : turnArtHasImage;
    var img = function(id){ try{ return !!(id && hasImage(id)); }catch(e){ return false; } };
    // a predicate that throws counts as satisfied — fail open, never lock work away
    var test = function(fn){ return function(x){ if(!fn) return true; try{ return !!fn(x); }catch(e){ return true; } }; };
    var lookFn = helper(s, "lookbookHasLook");
    var charOk = test(helper(s, "charVisualsDrafted"));
    var propOk = test(helper(s, "propVisualsDrafted"));
    var locOk = test(helper(s, "locVisualsDrafted"));
    var scriptLocsFn = helper(s, "scriptHasLocations");
    var hasLook = true;
    if(lookFn){ try{ hasLook = !!lookFn(s.lookbook, s.lookbookNote); }catch(e){ hasLook = true; } }
    var scriptHasPlaces = false;
    if(scriptLocsFn){ try{ scriptHasPlaces = !!scriptLocsFn(s.scenes||[]); }catch(e){ scriptHasPlaces = false; } }
    var noProps = turnNoPropsConfirmed(project);
    var cp = count(chars, charOk), pp = count(props, propOk), lp = count(locs, locOk);

    /* each gated step: `gate` = the work of the step before it is done; `content` = the tab holds
       (or can restore) something; `own` = what it waits for, said from its own lock card while the
       step before it is open; `todo` = the same need phrased as the next thing to do, for the card
       of a LATER tab whose chain stops here; `progress` = the counted wait, if any */
    var STEP = {
      characters: { gate:hasLook,
        content: chars.some(function(c){ return charOk(c) || img(c.id)
          || objs(c.states).some(function(st){ return img(c.id+":"+st.id); }); }) || objs(bin.characters).length>0,
        own:"Waiting for the "+D.lookbook+" to have a look — a visual statement, or a reference card with a note, a named touchstone or an image.",
        todo:"give the "+D.lookbook+" a look — a visual statement, or a reference card with a note, a named touchstone or an image.",
        progress:null },
      props: { gate:cp.done===cp.total,
        content: props.length>0 || objs(bin.props).length>0 || noProps,
        own:"Waiting for every card in "+D.characters+" to have a written spec ("+soFar(cp)+"). Generated sheets aren't required.",
        todo:"give every card in "+D.characters+" a written spec ("+soFar(cp)+"). Generated sheets aren't required.",
        progress:cp.total ? cp : null },
      locations: props.length
        ? { gate:pp.done===pp.total,
            content: locs.length>0 || objs(bin.locations).length>0,
            own:"Waiting for every card in "+D.props+" to have a written spec ("+soFar(pp)+").",
            todo:"give every card in "+D.props+" a written spec ("+soFar(pp)+").",
            progress:pp }
        : { gate:noProps,
            content: locs.length>0 || objs(bin.locations).length>0,
            own:"Waiting for "+D.props+" — give the story’s objects a written spec there, or mark “No props in this story” if it has none.",
            todo:"in "+D.props+", give the story’s objects a written spec, or mark “No props in this story” if it has none.",
            progress:null },
      stylebible: locs.length
        ? { gate:lp.done===lp.total, content:turnColorHasContent(project),
            own:"Waiting for every card in "+D.locations+" to have a written spec ("+soFar(lp)+").",
            todo:"give every card in "+D.locations+" a written spec ("+soFar(lp)+").",
            progress:lp }
        : { gate:!scriptHasPlaces, content:turnColorHasContent(project),
            own:"Waiting for "+D.locations+" — open it to pull the script's places in, then give each one a written spec.",
            todo:"open "+D.locations+" to pull the script's places in, then give each one a written spec.",
            progress:null },
      shots: { gate:turnColorHasLook(project),
        content: shots.length>0 || objs(bin.shots).length>0,
        own:"Waiting for the "+D.stylebible+" tab to have a look — a colour system (a palette with per-scene grades) or a film stock.",
        todo:"give the "+D.stylebible+" tab a look — a colour system (a palette with per-scene grades) or a film stock.",
        progress:null },
      storyboard: { gate:shots.length>0, content:shots.length>0,
        own:"Waiting for shot coverage — draft the shots in "+D.shots+" first.",
        todo:"draft the shots in "+D.shots+".",
        progress:null },
    };

    // walk the chain: a step is READY when the step before it is open and its work is done
    var open = { lookbook:true }, ready = { lookbook:true };
    for(var i=1;i<ORDER.length;i++){
      var id = ORDER[i], st = STEP[id];
      ready[id] = !!(open[ORDER[i-1]] && st.gate);
      open[id] = ready[id] || !!st.content;
    }

    var out = {};
    function base(id, isOpen, isReady, content){
      return { id:id, name:N[id], label:BASE[id], display:D[id], locked:!isOpen, ready:!!isReady, hasContent:!!content,
        after:null, afterLabel:"", unlockTab:null, unlockLabel:"", waitingFor:"", progress:null, chained:false };
    }
    out.lookbook = base("lookbook", true, true, true);
    for(var j=1;j<ORDER.length;j++){
      var tid = ORDER[j], step = STEP[tid], e = base(tid, open[tid], ready[tid], step.content);
      if(e.locked){
        var prev = ORDER[j-1];
        // the first locked step of this chain: its predecessor is open, so the user can act there
        var k = j; while(k>1 && !open[ORDER[k-1]]) k--;
        var root = ORDER[k], rootStep = STEP[root];
        e.after = prev; e.afterLabel = D[prev];
        e.unlockTab = ORDER[k-1]; e.unlockLabel = D[ORDER[k-1]];
        e.chained = root!==tid;
        e.waitingFor = e.chained
          ? "Waiting for "+D[prev]+", which is still locked. Next step: "+rootStep.todo
          : step.own;
        e.progress = rootStep.progress || null;
      }
      out[tid] = e;
    }
    out.breakdown = base("breakdown", true, true, true);
    return out;
  }

  window.turnArtTabLocks = turnArtTabLocks;
  window.turnArtTabNames = turnArtTabNames;
  window.turnArtTabDisplayNames = turnArtTabDisplayNames;
  window.turnArtHasImage = turnArtHasImage;
  window.turnColorHasLook = turnColorHasLook;
  window.turnColorHasContent = turnColorHasContent;
  window.turnNoPropsConfirmed = turnNoPropsConfirmed;
  window.TURN_ART_TAB_ORDER = ORDER.slice();
})();
