/* Shared Stage screenplay reference.
 *
 * Stage needs the same screenplay authority as the shot renderer, but a video
 * prompt needs the whole scene and the complete set of beats in one clip.  This
 * module is deliberately pure: it only reads its arguments and the two shared
 * screenplay helpers, and it never renders pages, loads images, calls a
 * provider, or persists anything.
 */
(function(root){
  "use strict";

  const own = (value,key) => Object.prototype.hasOwnProperty.call(value||{},key);
  const clean = value => String(value == null ? "" : value).replace(/\s+/g," ").trim();
  const hasValue = value => value !== null && value !== undefined && String(value) !== "";
  const asArray = value => Array.isArray(value) ? value : [];

  function charsOf(ctx){
    ctx = ctx || {};
    if(Array.isArray(ctx.characters)) return ctx.characters;
    if(ctx.charById && typeof ctx.charById === "object") return Object.values(ctx.charById);
    if(Array.isArray(ctx.cast)) return ctx.cast;
    return [];
  }

  /*
   * shotBeatScreenplay expects a scene-keyed draft map.  Render callers
   * occasionally carry the legacy bare array (or a single {blocks: []}
   * draft), so put that one draft under the selected scene without changing
   * the caller's object.  An explicit empty ctx.drafts remains empty: it must
   * never fall through to another film's turnContinuity draft.
   */
  function draftsFor(scene, ctx){
    ctx = ctx || {};
    if(!own(ctx,"drafts")) return undefined;
    const drafts = ctx.drafts;
    if(Array.isArray(drafts)) return {[scene && scene.id]:drafts};
    if(drafts && Array.isArray(drafts.blocks)) return {[scene && scene.id]:drafts};
    return drafts || {};
  }

  function contextForPlan(scene, ctx){
    ctx = ctx || {};
    if(!own(ctx,"drafts") || (!Array.isArray(ctx.drafts)
      && !(ctx.drafts && Array.isArray(ctx.drafts.blocks)))) return ctx;
    return {...ctx,drafts:{[scene && scene.id]:ctx.drafts}};
  }

  function matchingShots(scene, shots){
    const id = scene && scene.id;
    return asArray(shots).filter(shot => shot && hasValue(shot.sceneId)
      && String(shot.sceneId) === String(id));
  }

  function positiveBeat(value){
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function uniqueBeats(shots){
    const seen = new Set(), out = [];
    asArray(shots).forEach(shot => {
      const n = positiveBeat(shot && shot.beatN);
      if(n == null || seen.has(n)) return;
      seen.add(n);
      out.push(n);
    });
    return out.sort((a,b)=>a-b);
  }

  function hash(value){
    const text = JSON.stringify(value == null ? null : value);
    let h = 2166136261;
    for(let i=0;i<text.length;i++){
      h ^= text.charCodeAt(i);
      h = Math.imul(h,16777619);
    }
    return (h >>> 0).toString(36);
  }

  function addError(errors, message){
    const text = String(message || "").trim();
    if(text && errors.indexOf(text)<0) errors.push(text);
  }

  function sceneLabel(scene, plan){
    const id = scene && hasValue(scene.id) ? String(scene.id) : "unknown";
    const no = plan && hasValue(plan.sceneNo) ? " (scene "+plan.sceneNo+")" : "";
    return id+no;
  }

  function screenplayBeat(scene, beat, ctx, drafts){
    if(typeof root.shotBeatScreenplay !== "function")
      throw new Error("Stage screenplay requires the shared shotBeatScreenplay helper.");
    /*
     * With no explicit render context, retain shotBeatScreenplay's documented
     * legacy turnContinuity fallback.  Once ctx.drafts exists (including an
     * explicitly empty map), always pass that authority through.
     */
    if(drafts === undefined && !own(ctx,"drafts"))
      return root.shotBeatScreenplay(scene,beat);
    const options = {
      drafts,
      characters:charsOf(ctx),
      beatsMap:(ctx && ctx.beatsMap) || {}
    };
    return root.shotBeatScreenplay(scene,beat,options);
  }

  function stageScreenplayReference(scene, shots, ctx){
    ctx = ctx || {};
    const errors = [];
    if(!scene || !hasValue(scene.id)){
      addError(errors,"A scene with an id is required to build a Stage screenplay reference.");
      return {
        schema:"cm-stage-screenplay-v1", kind:"screenplay", delivery:"prompt-text",
        sceneId:"", sceneNo:"", sceneTitle:"", sourceRev:"", fullText:"",
        targetBeats:[], targetText:"", hasSource:false, errors,
        signature:"stage-screenplay:"+hash(["invalid-scene"])
      };
    }
    if(typeof root.shotSceneContextPlan !== "function"){
      addError(errors,"Stage screenplay requires the shared shotSceneContextPlan helper.");
      return {
        schema:"cm-stage-screenplay-v1", kind:"screenplay", delivery:"prompt-text",
        sceneId:scene.id, sceneNo:hasValue(scene.no) ? scene.no : "",
        sceneTitle:String(scene.title || ""), sourceRev:"", fullText:"",
        targetBeats:uniqueBeats(matchingShots(scene,shots)), targetText:"",
        hasSource:false, errors,
        signature:"stage-screenplay:"+hash(["missing-scene-context",String(scene.id)])
      };
    }

    /*
     * No shot is needed to make the scene plan: omitting it keeps this
     * snapshot target-neutral while retaining the real helper's lossless
     * serialization and scene-wide revision.
     */
    let plan;
    try{
      plan = root.shotSceneContextPlan(null,contextForPlan(scene,ctx),
        {scene,images:false,includeImages:false});
    }catch(error){
      addError(errors,"Could not read screenplay context for scene "+scene.id+": "
        +(error && error.message || "unknown error")+".");
      plan = null;
    }
    if(!plan){
      addError(errors,"No screenplay context is available for scene "+scene.id
        +". Write or import this scene's screenplay before building a Stage clip.");
    }

    const selectedShots = matchingShots(scene,shots);
    const targetBeats = uniqueBeats(selectedShots);
    if(!selectedShots.length){
      addError(errors,"No Stage shots match scene "+scene.id
        +"; target beats cannot be selected for this screenplay reference.");
    }else if(!targetBeats.length){
      addError(errors,"Stage shots match scene "+scene.id
        +" but none has a positive beatN; target screenplay mapping is unavailable.");
    }

    const drafts = draftsFor(scene,ctx);
    const targetParts = [];
    let targetHasSource = true;
    targetBeats.forEach(beat => {
      let source;
      try{
        source = screenplayBeat(scene,beat,ctx,drafts);
        // the moments of a split beat this clip films, not the whole beat (2026-11-01)
        const beatShots = selectedShots.filter(sh => positiveBeat(sh && sh.beatN) === beat);
        if(source && source.hasSource && typeof root.shotScreenplayForShots === "function"
          && beatShots.length && beatShots.every(sh => typeof root.shotMomentNumber === "function" && root.shotMomentNumber(sh))){
          const scoped = drafts === undefined && !own(ctx,"drafts")
            ? root.shotScreenplayForShots(scene,beatShots)
            : root.shotScreenplayForShots(scene,beatShots,{drafts,characters:charsOf(ctx),beatsMap:(ctx && ctx.beatsMap) || {}});
          if(scoped && scoped.hasSource) source = scoped;
        }
      }catch(error){
        targetHasSource = false;
        addError(errors,"Could not map target beat "+beat+" in scene "+scene.id+": "
          +(error && error.message || "unknown error")+".");
        return;
      }
      if(!source || !source.hasSource){
        targetHasSource = false;
        addError(errors,"No screenplay source is mapped to target beat "+beat
          +" in scene "+scene.id+"; Stage will not substitute another beat.");
        return;
      }
      /*
       * The helper's text is the authored block text, including exact cue,
       * parenthetical, dialogue, and remote-delivery markers.  Do not use
       * openingAction here: Stage performs the complete target beat.
       */
      const text = String(source.text == null ? "" : source.text);
      if(text) targetParts.push(text);
      else{
        targetHasSource = false;
        addError(errors,"Target beat "+beat+" in scene "+scene.id
          +" has no authored screenplay text; Stage will not invent a substitute.");
      }
    });

    const fullText = plan ? String(plan.fullText == null ? "" : plan.fullText) : "";
    const hasSource = !!(plan && plan.hasSource);
    if(!hasSource){
      addError(errors,"No screenplay draft/source blocks were found for scene "+scene.id
        +". Write or import the scene screenplay before building a Stage clip.");
    }
    if(targetBeats.length && !targetHasSource){
      /* The specific beat errors above are intentionally retained. */
    }

    const sourceRev = plan ? String(plan.sourceRev == null ? "" : plan.sourceRev) : "";
    const targetText = targetParts.join("\n");
    const sceneId = scene.id;
    const sceneNo = plan && hasValue(plan.sceneNo) ? plan.sceneNo
      : (hasValue(scene.no) ? scene.no : "");
    const sceneTitle = String(scene.title || "");
    /*
     * Keep the source revision visible to callers through the signature's
     * input.  Including the ordered target list makes two clips that share a
     * scene snapshot but film different beats independently identifiable.
     */
    const signature = "stage-screenplay:"+hash({
      schema:"cm-stage-screenplay-v1",
      sceneId:String(sceneId),
      sourceRev,
      targetBeats:targetBeats.slice(),
      fullText,
      targetText
    });
    return {
      schema:"cm-stage-screenplay-v1",
      kind:"screenplay",
      delivery:"prompt-text",
      sceneId,
      sceneNo,
      sceneTitle,
      sourceRev,
      fullText,
      targetBeats:targetBeats.slice(),
      targetText,
      hasSource,
      errors,
      signature
    };
  }

  function malformed(message){
    throw new Error("Invalid Stage screenplay reference: "+message);
  }

  function validateReference(reference){
    if(!reference || typeof reference !== "object" || Array.isArray(reference))
      malformed("expected the object returned by stageScreenplayReference.");
    if(reference.schema !== "cm-stage-screenplay-v1")
      malformed("schema must be cm-stage-screenplay-v1.");
    if(reference.kind !== "screenplay" || reference.delivery !== "prompt-text")
      malformed("kind must be screenplay and delivery must be prompt-text.");
    if(!hasValue(reference.sceneId))
      malformed("sceneId is required.");
    if(typeof reference.sourceRev !== "string")
      malformed("sourceRev must be a string.");
    if(typeof reference.fullText !== "string")
      malformed("fullText must be a string.");
    if(typeof reference.targetText !== "string")
      malformed("targetText must be a string.");
    if(!Array.isArray(reference.targetBeats)
      || reference.targetBeats.some(beat=>typeof beat!=="number"
        || !Number.isFinite(beat) || beat<=0)){
      malformed("targetBeats must be an array of positive numbers.");
    }
    if(!Array.isArray(reference.errors))
      malformed("errors must be an array.");
    if(typeof reference.signature !== "string" || !reference.signature)
      malformed("signature is required.");
    if(typeof reference.hasSource !== "boolean")
      malformed("hasSource must be boolean.");
    return reference;
  }

  function usableReference(reference, operation){
    const ref = validateReference(reference);
    const action = operation || "build a Stage screenplay prompt";
    if(!ref.hasSource)
      throw new Error("Cannot "+action+": the screenplay reference has no source text. "
        +(ref.errors.length ? ref.errors.join(" ") : "Write or import the selected scene screenplay first."));
    if(!ref.targetBeats.length)
      throw new Error("Cannot "+action+": the reference has no target beats. "
        +"Provide matching Stage shots with positive beatN values.");
    if(!ref.targetText)
      throw new Error("Cannot "+action+": no authored screenplay text is mapped to target beat"
        +(ref.targetBeats.length===1 ? "" : "s")+" "
        +ref.targetBeats.join(", ")+"; Stage will not substitute another beat.");
    if(ref.errors.length)
      throw new Error("Cannot "+action+": "+ref.errors.join(" "));
    return ref;
  }

  function stageScreenplayPrompt(reference){
    const ref = usableReference(reference,"build a Stage screenplay prompt");
    const scope = ref.renderScope && typeof ref.renderScope==="object"
      ? String(ref.renderScope.instruction||"").trim() : "";
    /*
     * fullText and targetText are concatenated as-is.  In particular, this
     * function never trims, folds, clips, summarizes, or turns the source into
     * an image/page instruction.
     */
    return [
      "STAGE SCREENPLAY REFERENCE — IMMUTABLE SOURCE",
      "REFERENCE SIGNATURE: "+ref.signature,
      "SCENE "+(hasValue(ref.sceneNo) ? ref.sceneNo+" — " : "")
        +(ref.sceneTitle || ref.sceneId),
      "",
      "FULL SCENE SCREENPLAY (read the complete scene for continuity and geography; "
        +"do not perform beats outside the target boundary):",
      ref.fullText,
      "",
      "TARGET BEAT(S) TO FILM (perform the full authored target beat, including all "
        +"of its action and dialogue — not merely the opening. If Stage supplies a "
        +"narrower shot/part scope below, use the complete text for reading and "
        +"dialogue fidelity but perform only that selected scope):",
      "Target beat numbers: "+ref.targetBeats.join(", "),
      ref.targetText,
      "",
      scope,
      scope && "The selected render scope above overrides any implication that an omitted "
        +"shot or part should be replayed in this render.",
      "",
      "TARGET BOUNDARY:",
      "With no narrower selected render scope, perform only the complete target beat "
        +"text above. Do not enact, add, or speak "
        +"action or dialogue belonging to any other beat in the full scene, even when "
        +"it appears nearby or would make a plausible continuation. When the render "
        +"prompt identifies a narrower selected shot or part, do not replay omitted "
        +"portions of this target beat in every shot.",
      "A remote, off-screen, voice-over, phone, radio, intercom, or text/message voice "
        +"is audio or represented communication only; it does not become an onscreen "
        +"body unless the target beat explicitly places that person physically in frame.",
      "The screenplay reference is text for reading and continuity. It is not a "
        +"photographed screenplay page, page layout, caption, subtitle, watermark, "
        +"or visual element to reproduce."
    ].join("\n");
  }

  function stageAppendScreenplayReference(prompt, reference){
    if(typeof prompt !== "string")
      throw new Error("Cannot append a Stage screenplay reference: prompt must be a string.");
    const ref = usableReference(reference,"append a Stage screenplay reference");
    const block = stageScreenplayPrompt(ref);
    /*
     * Exact substring matching is intentional.  It preserves a user's edited
     * prompt byte-for-byte and only suppresses a block that is already exactly
     * present; a similar-looking or edited block is not silently replaced.
     */
    if(prompt.indexOf(block)>=0) return prompt;
    return prompt+(prompt ? "\n\n" : "")+block;
  }

  root.stageScreenplayReference = stageScreenplayReference;
  root.stageScreenplayPrompt = stageScreenplayPrompt;
  root.stageAppendScreenplayReference = stageAppendScreenplayReference;
})(typeof window!=="undefined" ? window : globalThis);