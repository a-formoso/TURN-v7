/* Full-scene screenplay context for shot-opening keyframes.
 *
 * This module is intentionally independent of React and of the image provider.
 * It freezes the screenplay text before a render, gives the prompt a complete
 * scene context (rather than a beat excerpt), and asks Locations' screenplay
 * page renderer for optional, ephemeral page images.  The page images are
 * reference material only: they are never the visual authority for identity,
 * location, props, framing, or the target beat's opening action.
 */
(function(root){
  "use strict";

  const clean = v => String(v == null ? "" : v).replace(/\s+/g," ").trim();
  const blocksOf = draft => Array.isArray(draft) ? draft
    : (draft && Array.isArray(draft.blocks) ? draft.blocks : []);
  const draftOf = (scene, drafts) => {
    if(!scene || !drafts) return null;
    return drafts[scene.id] || drafts[String(scene.id)] || null;
  };
  const beatOf = b => {
    const n = Number(b && b.beat);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const meaningful = b => !!clean(b && b.text);
  const hash = value => {
    if(typeof root.storyRevisionOf === "function"){
      try{ return String(root.storyRevisionOf(value)); }catch(e){}
    }
    const s = JSON.stringify(value == null ? null : value);
    let h = 2166136261;
    for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,16777619); }
    return (h >>> 0).toString(36);
  };
  const filmKeyOf = (ctx, scene) => {
    ctx = ctx || {};
    const tc = root.turnContinuity || {};
    return String(ctx.filmId || ctx.projectId || (ctx.project && (ctx.project.id || ctx.project.projectId))
      || tc.filmId || tc.projectId || tc.projectKey || "local-film");
  };
  const epochOf = ctx => {
    if(ctx && ctx.filmEpoch != null) return ctx.filmEpoch;
    if(typeof root.nbEpoch === "function"){
      try{ return root.nbEpoch(); }catch(e){}
    }
    return null;
  };
  const sourceDraftsOf = ctx => {
    if(ctx && Object.prototype.hasOwnProperty.call(ctx,"drafts")) return ctx.drafts || {};
    return (root.turnContinuity && root.turnContinuity.drafts) || {};
  };

  function shotSceneContextOptedOut(sh, context){
    const off = (sh && Array.isArray(sh.refOff)) ? sh.refOff.map(String) : [];
    const ids = [
      "screenplay-context", "scene-screenplay-context", "shot-scene-context",
      "full-scene-context", context && context.refId
    ].filter(Boolean).map(String);
    return !!(sh && (sh.sceneContextOff || sh.screenplayContextOff))
      || !!(context && (context.off || context.refOff || context.enabled === false))
      || off.some(id => ids.indexOf(id)>=0 || /^screenplay-context(?::|$)/i.test(id));
  }

  /* A deliberately lossless scene serialization.  The labels make the
     target/remote rules legible to an image model, while every block's exact
     authored text remains present verbatim after the label. */
  function formatSceneBlocks(scene, blocks){
    const out = [];
    (blocks || []).forEach((b,i)=>{
      if(!meaningful(b)) return;
      const beat = beatOf(b);
      const type = String(b.type || "action").toUpperCase();
      const label = beat != null ? "[BEAT "+beat+" · "+type+"]" : "["+type+"]";
      out.push(label+" "+String(b.text));
    });
    return out.join("\n");
  }

  function sceneContextPlan(sh, ctx, options){
    ctx = ctx || {};
    options = options || {};
    const scene = options.scene || ctx.scene || null;
    if(!scene) return null;
    const drafts = sourceDraftsOf(ctx);
    const draft = draftOf(scene,drafts);
    const blocks = blocksOf(draft).map(b=>({...b}));
    const fullText = formatSceneBlocks(scene,blocks);
    const exactText = blocks.filter(meaningful).map(b=>String(b.text)).join("\n");
    const targetBeat = sh && sh.beatN != null && sh.beatN !== "" ? Number(sh.beatN) : null;
    const targetBlocks = blocks.filter(b=>targetBeat != null && beatOf(b)===targetBeat);
    const targetText = formatSceneBlocks(scene,targetBlocks);
    const sceneSourceRev = hash({
      sceneId:scene.id || "", sceneNo:scene.no == null ? "" : scene.no,
      loc:scene.loc || "", blocks:blocks.map(b=>({type:b.type||"",text:String(b.text||""),beat:beatOf(b)}))
    });
    const filmKey = filmKeyOf(ctx,scene);
    const filmEpoch = epochOf(ctx);
    const refId = "screenplay-context:"+filmKey+":"+String(scene.id||"scene")+":"+sceneSourceRev
      +":beat-"+(targetBeat == null ? "none" : targetBeat)
      +":epoch-"+(filmEpoch == null ? "none" : filmEpoch);
    const callerDisabled = options.images === false || options.includeImages === false
      || ctx.sceneContextImages === false || ctx.screenplayContextImages === false
      || ctx.sceneContextRefs === false;
    const optedOut = callerDisabled || shotSceneContextOptedOut(sh,{refId});
    const canvasAvailable = !!(root.document && typeof root.document.createElement==="function");
    return {
      kind:"screenplay-context",
      role:"screenplay_context",
      refId,
      filmKey,
      filmEpoch,
      sceneId:scene.id || "",
      sceneNo:scene.no == null ? "" : scene.no,
      sceneHeading:scene.loc || "",
      targetBeat,
      fullText,
      exactText,
      sceneText:exactText,
      targetText,
      blocks,
      sourceRev:sceneSourceRev,
      sceneSourceRev,
      hasSource:blocks.some(b=>String(b.type||"").toLowerCase()!=="scene" && meaningful(b)),
      enabled:true,
      imagesEnabled:!optedOut && canvasAvailable,
      optedOut,
      maxPages: options.maxPages == null ? null : Math.max(0,Number(options.maxPages)||0),
      pageLimitReason: callerDisabled ? "screenplay-page refs disabled by caller"
        : (optedOut ? "user opted out via sh.refOff" : ""),
      screenshotMode:"ephemeral",
      pages:0,
      renderedPages:0,
      omittedPages:0,
      omissions: callerDisabled ? ["screenplay-page refs disabled by caller"]
        : (optedOut ? ["user opted out via sh.refOff"]
        : (!canvasAvailable ? ["browser canvas unavailable; text-only full-scene context"] : [])),
      inputLimit: options.inputLimit != null ? Number(options.inputLimit)
        : (ctx.sceneContextMaxChars != null ? Number(ctx.sceneContextMaxChars) : null)
    };
  }

  function contextStillCurrent(snapshot, sh, ctx){
    if(!snapshot) return {ok:true};
    const now = sceneContextPlan(sh,ctx);
    if(!now) return {ok:false,reason:"scene screenplay context is no longer available"};
    if(String(now.filmKey)!==String(snapshot.filmKey))
      return {ok:false,reason:"film changed while preparing screenplay context"};
    if(String(now.sceneId)!==String(snapshot.sceneId))
      return {ok:false,reason:"scene changed while preparing screenplay context"};
    if(String(now.sourceRev)!==String(snapshot.sourceRev))
      return {ok:false,reason:"scene screenplay changed while preparing screenplay context"};
    const epoch = epochOf(ctx);
    if(snapshot.filmEpoch != null && epoch != null && String(snapshot.filmEpoch)!==String(epoch))
      return {ok:false,reason:"film generation scope changed while preparing screenplay context"};
    return {ok:true};
  }

  function capacityOf(ctx, fallback){
    ctx = ctx || {};
    const candidates = [
      ctx.referenceBudget, ctx.imageReferenceBudget,
      (typeof root.nbReferenceBudget === "function" ? root.nbReferenceBudget(ctx.project) : null),
      root.SHOT_IMAGE_REFERENCE_BUDGET
    ];
    for(const v of candidates){
      const n = Number(v);
      if(Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
    /* Nano Banana 2.1 documents fourteen input images; keep one conservative,
       model-independent cap for older image routes.  The target's canon refs
       are reserved before this function is used, so context can never displace
       a real identity/location/prop sheet. */
    return Number.isFinite(Number(fallback)) && Number(fallback)>0 ? Math.floor(Number(fallback)) : 14;
  }

  /* opts (2026-10-14, owner — "go ahead with all of it"; the prompt budget):
       pagesAttached — how many of this scene's screenplay page images ride with THIS request. The screenplay goes as
         page images OR as text, never both: when the pages carry the whole scene, its text becomes a short pointer
         to them (sceneContextReferences attaches pages only when they carry all of it).
       fit — "excerpt" (the target beat with the blocks either side) or "omit" (the scene's own text left out): only
         when the whole prompt is longer than its engine takes (shots.jsx buildShotPrompt), in that order.
     The TARGET BEAT OPENING is never cut. */
  function excerptAround(snapshot){
    const blocks = (snapshot.blocks || []).filter(meaningful);
    const tb = snapshot.targetBeat;
    const idx = blocks.map((b,i)=>beatOf(b)===tb ? i : -1).filter(i=>i>=0);
    if(!idx.length) return "";
    return formatSceneBlocks(null, blocks.slice(Math.max(0, idx[0]-1), Math.min(blocks.length, idx[idx.length-1]+2)));
  }
  function contextPrompt(snapshot, opts){
    if(!snapshot || !snapshot.enabled || !snapshot.hasSource || !snapshot.fullText) return "";
    opts = opts || {};
    if(snapshot.inputLimit != null && Number.isFinite(snapshot.inputLimit)
      && snapshot.fullText.length > snapshot.inputLimit)
      throw new Error("Full scene screenplay context exceeds the configured input limit ("
        +snapshot.fullText.length+" > "+snapshot.inputLimit+" characters); no excerpt was used.");
    const target = snapshot.targetText || "(target beat has no authored screenplay blocks)";
    const omitted = snapshot.omissions && snapshot.omissions.length
      ? "\nSCENE CONTEXT REFERENCE NOTE: "+snapshot.omissions.join("; ")+"."
      : "";
    const pages = Math.max(0, Math.floor(Number(opts.pagesAttached)||0));
    const excerpt = opts.fit==="excerpt" ? excerptAround(snapshot) : "";
    const sceneText = pages
      ? "(the entire scene is attached as "+pages+" screenplay page image"+(pages===1 ? "" : "s")
        +(snapshot.targetBeat != null ? ", target beat highlighted" : "")+" — read it there; it is not repeated here)"
      : opts.fit==="omit" || (opts.fit==="excerpt" && !excerpt)
        ? "(the scene's own text is left out here to fit this engine's prompt limit; the TARGET BEAT OPENING below is the authority)"
        : excerpt
          ? "(an excerpt to fit this engine's prompt limit — the target beat and the lines either side)\n"+excerpt
          : snapshot.fullText;
    return [
      "FULL SCENE CONTEXT (background only; exact screenplay text for the entire selected scene):",
      "SCREENPLAY SOURCE REVISION: "+snapshot.sourceRev,
      sceneText,
      "",
      "TARGET BEAT OPENING (the only action/cast authority for this first frame):",
      target,
      "Use FULL SCENE CONTEXT to understand continuity, setup, geography, and what the scene is about. "
        +"Use TARGET BEAT OPENING to decide the first-frame cast, action, and moment. "
        +"Later or non-target beats, remote voices, phone/text mentions, and other scene references "
        +"must not override the target beat's opening cast or action. "
        +"Canonical identity, location, prop, camera, and seed references always outrank screenplay text "
        +"and any screenplay-page image. The screenplay-page image is reference text only — not a style, "
        +"composition, layout, or image-to-copy instruction."+omitted
    ].join("\n");
  }

  /* Build pages only when a browser canvas exists.  Locations owns the actual
     Courier/page layout; this wrapper adds the shot-specific scene selection,
     target highlight, and honest omission metadata. */
  async function sceneContextReferences(snapshot, ctx, options){
    options = options || {};
    if(!snapshot || !snapshot.enabled || !snapshot.imagesEnabled || !snapshot.hasSource)
      return { refs:[], pages:0, renderedPages:0, omittedPages:0,
        omissions:(snapshot && snapshot.omissions)||[] };
    if(typeof root.locationScreenplayReferenceImages!=="function" || typeof root.document==="undefined"
      || !root.document || typeof root.document.createElement!=="function"){
      return { refs:[], pages:0, renderedPages:0, omittedPages:0,
        omissions:["browser canvas unavailable; text-only full-scene context"] };
    }
    const limit = snapshot.maxPages == null ? (options.maxPages == null ? 2 : Math.max(0,Number(options.maxPages)||0))
      : Math.max(0,Number(snapshot.maxPages)||0);
    let result;
    try{
      result = root.locationScreenplayReferenceImages(
        ctx && ctx.location || null,
        { sceneId:snapshot.sceneId, id:"shot-scene-context", sceneNo:snapshot.sceneNo },
        [ctx && ctx.scene || {id:snapshot.sceneId,no:snapshot.sceneNo,loc:snapshot.sceneHeading}],
        { [snapshot.sceneId]:{ blocks:snapshot.blocks.map(b=>({...b})) } },
        { sceneId:snapshot.sceneId, scene:snapshot.scene, targetBeat:snapshot.targetBeat,
          pageLimit:limit, returnMeta:true, contextLabel:"SHOT SCENE CONTEXT",
          targetLabel:"TARGET BEAT OPENING" }
      );
    }catch(e){
      return { refs:[], pages:0, renderedPages:0, omittedPages:0,
        omissions:["screenplay-page canvas failed: "+(e && e.message || "unknown error")] };
    }
    /* Backward-compatible Locations implementations return only the image
       array; current ones return a metadata envelope when returnMeta is set. */
    const images = Array.isArray(result) ? result : ((result && result.images)||[]);
    const total = Array.isArray(result) ? images.length : Number(result && result.pageCount)||images.length;
    let rendered = images.length;
    const omitted = Math.max(0,total-rendered);
    const omissions = [];
    if(omitted) omissions.push(omitted+" screenplay page"+(omitted===1?"":"s")+" omitted due reference capacity");
    /* PAGES OR TEXT, NEVER BOTH (2026-10-14): pages that carry only part of the scene are not attached — the scene
       goes as text (contextPrompt), the free reference slots stay free */
    let asText = false;
    if(omitted && rendered){
      omissions.push("screenplay pages left out: the scene needs more pages than the free reference slots, so it goes as text");
      images.length = 0; rendered = 0; asText = true;
    }
    if(!limit && !omissions.length)
      omissions.push("screenplay pages omitted: reference capacity reserved for canonical identity/location/prop assets");
    if(!rendered && total && !asText) omissions.push("screenplay pages unavailable; full scene remains in text");
    const refs = images.map((url,i)=>({
      url, kind:"screenplay-context", refId:snapshot.refId+":page-"+(i+1),
      note:"SCREENPLAY PAGE REFERENCE — full scene "+(i+1)+" of "+total
        +(snapshot.targetBeat != null ? "; target beat "+snapshot.targetBeat+" highlighted" : ""),
      assetRole:"screenplay_context", assetRoleLabel:"Screenplay context (low priority)",
      assetRolePriority:1, assetSourceQuality:"ephemeral_screenplay_page",
      sourceRev:snapshot.sourceRev, sceneId:snapshot.sceneId, targetBeat:snapshot.targetBeat,
      persist:false, ephemeral:true
    }));
    return { refs, pages:total, renderedPages:rendered, omittedPages:asText ? total : omitted, omissions };
  }

  root.shotSceneContextPlan = sceneContextPlan;
  root.buildShotSceneContext = sceneContextPlan;
  root.shotSceneContextPrompt = contextPrompt;
  root.shotSceneContextReferences = sceneContextReferences;
  root.renderShotSceneContextPages = sceneContextReferences;
  root.shotSceneContextStillCurrent = contextStillCurrent;
  root.shotSceneContextCapacity = capacityOf;
  root.shotSceneContextOptedOut = shotSceneContextOptedOut;
})(typeof window!=="undefined" ? window : globalThis);