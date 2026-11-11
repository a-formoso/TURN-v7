/* AN UNFINISHED FILM SAYS SO (owner 2026-11-11, Writers' Room audit item 1).
   A story build runs in the browser. When the page is reloaded, closed or the computer sleeps, the build ends with
   scenes left unwritten — and the film used to look finished ("Half Strength": 6 of 16 scenes written, no sign).
   This module is the one place that decides:
     - which scenes are unwritten (the same rule as Story Editors' "Finish writing this film");
     - what the build wrote down about itself on the film (`project.build`: when it started, how far it got, its log);
     - the notice the Writers' Room shows, with "Continue writing";
     - keeping the screen awake while a build runs.
   Stored data is never migrated: a film built before this has no `project.build`, and the notice is still shown from
   its scenes alone (a built film with unwritten scenes). */
(function(root){
  "use strict";
  var LOG_MAX = 60, LINE_MAX = 280;
  var LOG_KINDS = { act:1, ok:1, flag:1, done:1, observe:1 };

  function rowsOf(b){ return (b && Array.isArray(b.rows)) ? b.rows : []; }
  function blocksOf(d){ return (d && Array.isArray(d.blocks)) ? d.blocks : []; }

  /* what "unwritten" means, per scene: no screenplay; a rough stand-in built from the beat cards; or a real
     screenplay whose beat map is missing */
  function counts(scenes, drafts, beatsMap, isStandIn){
    var list = Array.isArray(scenes) ? scenes : [], D = drafts || {}, B = beatsMap || {};
    var standIn = typeof isStandIn==="function" ? isStandIn : function(){ return false; };
    var out = { total:list.length, n:0, blank:0, standIns:0, beatMaps:0, placeholders:0, ids:[], firstNo:null };
    list.forEach(function(s, i){
      if(!s) return;
      var d = D[s.id], kind = "";
      if(!blocksOf(d).length) kind = "blank";
      else if(standIn(d)) kind = "standIns";
      else if(!rowsOf(B[s.id]).length) kind = "beatMaps";
      if(!kind) return;
      out.n++; out[kind]++; out.ids.push(String(s.id));
      // a scene the writer has just added by hand and not described yet ("New Scene") is theirs to write: it is
      // still unwritten (Finish writing offers it), but it never raises the notice by itself
      if(kind==="blank" && !rowsOf(B[s.id]).length && isPlaceholder(s)) out.placeholders++;
      if(out.firstNo==null) out.firstNo = (s.no!=null ? s.no : i+1);
    });
    return out;
  }

  function isPlaceholder(s){
    var sum = String((s && s.summary) || "").trim();
    return !sum || /^A new scene\b/.test(sum);
  }

  function trimLog(steps){
    var keep = (Array.isArray(steps) ? steps : []).filter(function(s){ return s && LOG_KINDS[s.k] && String(s.t||"").trim(); })
      .map(function(s){ var t = String(s.t).replace(/\s+/g," ").trim();
        return { k:String(s.k), t: t.length>LINE_MAX ? t.slice(0, LINE_MAX-1)+"…" : t }; });
    return keep.slice(-LOG_MAX);
  }

  /* the build's own record on the film. `patch` wins over what is there; the log is replaced when given. */
  function mark(project, patch, log){
    var P = project || {}, prev = (P.build && typeof P.build==="object") ? P.build : {};
    var next = {};
    Object.keys(prev).forEach(function(k){ next[k] = prev[k]; });
    Object.keys(patch||{}).forEach(function(k){ if(patch[k]===undefined) delete next[k]; else next[k] = patch[k]; });
    if(log) next.log = trimLog(log);
    var out = {};
    Object.keys(P).forEach(function(k){ out[k] = P[k]; });
    out.build = next;
    return out;
  }

  function fmtWhen(iso){
    var d = new Date(iso);
    if(!iso || isNaN(d.getTime())) return "";
    try{ return d.toLocaleString(undefined, { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }); }
    catch(e){ return d.toISOString().slice(0,16).replace("T"," "); }
  }

  function plural(n, one, many){ return n+" "+(n===1 ? one : many); }

  /* the Writers' Room notice, or null. `running` = a build is writing this film right now. */
  function notice(opts){
    var o = opts || {}, P = o.project || {}, c = o.counts || { n:0, total:0 };
    if(o.running || !c.total || !c.n) return null;
    if(c.n - (c.placeholders||0) <= 0) return null;   // only scenes the writer just added by hand
    var b = (P.build && typeof P.build==="object") ? P.build : null;
    // a film the app built (it has the brief it was built from, or the build's own record); a film written by hand
    // or imported keeps its own tools
    var built = !!(b || String(P.sourceBrief||"").trim());
    if(!built) return null;
    if(P.importedFrom && !b) return null;
    var what;
    if(c.beatMaps && !c.blank && !c.standIns)
      what = plural(c.beatMaps, "scene has", "scenes have")+" a screenplay but no beat map.";
    else{
      var noScript = c.blank + c.standIns;
      what = noScript+" of "+c.total+" scenes "+(noScript===1 ? "has" : "have")+" no screenplay yet"
        + (c.standIns ? " ("+(c.standIns===1 ? "1 is a rough stand-in" : c.standIns+" are rough stand-ins")+")" : "")
        + (c.beatMaps ? ", and "+plural(c.beatMaps, "more has", "more have")+" a screenplay but no beat map" : "")+".";
    }
    var interrupted = !!(b && b.status==="writing");
    var whenIso = b && (b.updatedAt || b.startedAt), when = whenIso ? fmtWhen(whenIso) : "";
    var why = interrupted
      ? "The build stopped before it finished"+(when ? " (last progress "+when+")" : "")+". Everything already written is kept."
      : "Everything already written is kept.";
    return {
      n:c.n, total:c.total, interrupted:interrupted,
      headline:"This film isn’t fully written",
      what:what, why:why,
      action:"Continue writing",
      actionHint:"Writes just the "+(c.n===1 ? "unwritten scene" : c.n+" unwritten scenes")+" — nothing already written is redone.",
      log:(b && Array.isArray(b.log)) ? b.log.slice() : [],
      key:[String(P.title||""), c.ids.join(",")].join("|")
    };
  }

  /* KEEP THE SCREEN AWAKE while a build runs (a sleeping computer ends the build). Best effort: browsers without
     the Wake Lock API, or a hidden tab, simply don't get it. Returns the function that lets go. */
  function keepAwake(){
    var nav = (typeof navigator!=="undefined") ? navigator : null, doc = (typeof document!=="undefined") ? document : null;
    var lock = null, off = false;
    function get(){
      if(off || !nav || !nav.wakeLock || typeof nav.wakeLock.request!=="function") return;
      if(doc && doc.visibilityState && doc.visibilityState!=="visible") return;
      try{
        nav.wakeLock.request("screen").then(function(l){
          if(off){ try{ l.release(); }catch(e){} return; }
          lock = l;
        }, function(){});
      }catch(e){}
    }
    function vis(){ if(doc && doc.visibilityState==="visible") get(); }
    get();
    if(doc && doc.addEventListener) doc.addEventListener("visibilitychange", vis);
    return function(){
      off = true;
      if(doc && doc.removeEventListener) doc.removeEventListener("visibilitychange", vis);
      if(lock){ try{ var p = lock.release(); if(p && p.catch) p.catch(function(){}); }catch(e){} lock = null; }
    };
  }

  var api = { counts:counts, mark:mark, trimLog:trimLog, notice:notice, keepAwake:keepAwake, fmtWhen:fmtWhen,
    LOG_MAX:LOG_MAX, LINE_MAX:LINE_MAX };
  root.KinolotBuildState = api;
  if(typeof module!=="undefined" && module.exports) module.exports = api;
})(typeof window!=="undefined" ? window : globalThis);
