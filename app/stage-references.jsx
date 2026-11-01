/* Shared, synchronous Stage reference/continuity descriptors.
   This file deliberately resolves identities only. Stage remains responsible for
   loading/staging image bytes with nbLoadImage and for enforcing provider limits. */
(function(g){
  "use strict";

  const uniq = a=>Array.from(new Set((a||[]).filter(Boolean)));
  const arr = v=>Array.isArray(v)?v:[];
  const own = (o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
  const metaFor = (id,ctx)=>{
    if(!id)return null;
    if(ctx&&typeof ctx.getMeta==="function")return ctx.getMeta(id)||null;
    if(ctx&&ctx.metadata&&own(ctx.metadata,id))return ctx.metadata[id]||null;
    try{return typeof g.nbGetMeta==="function"?g.nbGetMeta(id)||null:null;}catch(e){return null;}
  };
  const isApproved = m=>{
    if(!m)return false;
    if(typeof g.nbAssetApproval==="function"){
      try{return !!g.nbAssetApproval(m);}catch(e){}
    }
    return !!(m.iso&&m.approval&&m.approval.approved===true&&m.approval.iso===m.iso);
  };
  const excluded = (ref,m)=>!!(
    (ref&&(ref.private===true||ref.deviceOnly===true||ref.localOnly===true||ref.excludeFromStage===true))||
    (m&&(m.private===true||m.deviceOnly===true||m.localOnly===true||m.excludeFromStage===true))
  );
  const currentSpecFor=(id,ctx)=>{
    if(ctx&&typeof ctx.currentSpecFor==="function")return ctx.currentSpecFor(id);
    return ctx&&ctx.currentSpecs&&own(ctx.currentSpecs,id)?ctx.currentSpecs[id]:undefined;
  };
  const currentReferenceFor=(id,ctx)=>{
    if(ctx&&typeof ctx.currentReferenceFor==="function")return ctx.currentReferenceFor(id);
    return ctx&&ctx.currentReferences&&own(ctx.currentReferences,id)?ctx.currentReferences[id]:null;
  };
  const currentReviewKeyFor=(id,ctx)=>{
    if(ctx&&typeof ctx.currentReviewKeyFor==="function")return ctx.currentReviewKeyFor(id);
    return ctx&&ctx.currentReviewKeys&&own(ctx.currentReviewKeys,id)?ctx.currentReviewKeys[id]:undefined;
  };

  /* Safe provenance snapshot: no URLs, prompts, screenplay text, notes or user data. */
  function stageReferenceSnapshot(imageId,meta,ctx){
    meta=meta||metaFor(imageId,ctx)||null;
    const approval=meta&&meta.approval;
    return {
      imageId:String(imageId||""),
      iso:String((meta&&meta.iso)||""),
      version:(meta&&meta.version)!=null?meta.version:null,
      approved:isApproved(meta),
      approvalIso:String((approval&&approval.iso)||""),
      approvalReviewKey:String((approval&&approval.reviewKey)||""),
      current:true
    };
  }

  /* Review a current asset or a reference captured in saved-take metadata.
     A saved ref may carry snapshot/snapshot.iso, iso, version and approved. */
  function stageReferenceStatus(ref,ctx){
    ref=ref||{};
    const imageId=String(ref.imageId||ref.assetId||ref.refId||ref.id||"");
    const current=metaFor(imageId,ctx);
    const used=ref.snapshot||ref;
    const reasons=[];
    if(!imageId)reasons.push("Reference has no image id");
    if(excluded(ref,current))reasons.push("Private or device-only reference is excluded");
    // Metadata can outlive the image bytes (or arrive before the cloud download).
    // When the caller supplies its loaded-image inventory it is authoritative.
    // Historical version-only reviews without that inventory remain unchecked.
    const availabilityKnown=!!(ctx&&(own(ctx,"images")||own(ctx,"availableImageIds")||own(ctx,"loadingImageIds")));
    const loaded=!!(ctx&&ctx.availableImageIds&&(
      typeof ctx.availableImageIds.has==="function"?ctx.availableImageIds.has(imageId):arr(ctx.availableImageIds).indexOf(imageId)>=0
    ))||!!(ctx&&ctx.images&&ctx.images[imageId]);
    const loading=!!(ctx&&ctx.loadingImageIds&&(
      typeof ctx.loadingImageIds.has==="function"?ctx.loadingImageIds.has(imageId):arr(ctx.loadingImageIds).indexOf(imageId)>=0
    ));
    const available=availabilityKnown?loaded:!!current;
    if(imageId&&!available&&!loading)reasons.push("Reference image is missing or has not finished loading");
    const usedIso=String(used.iso||used.imageIso||"");
    const currentIso=String((current&&current.iso)||"");
    if(usedIso&&currentIso&&usedIso!==currentIso)reasons.push("Reference version changed");
    else if(!usedIso&&used.version!=null&&current&&current.version!=null&&used.version!==current.version)
      reasons.push("Reference version changed");
    const spec=currentSpecFor(imageId,ctx);
    if(current&&current.specPrompt!=null&&spec!=null&&current.specPrompt!==spec)
      reasons.push("Specification changed since this image was generated");
    arr((ctx&&ctx.reviewReasonsById&&ctx.reviewReasonsById[imageId])||[]).forEach(x=>{
      if(typeof x==="string"&&x)reasons.push(x);
    });
    const refs=arr(current&&current.referenceSnapshots);
    refs.forEach(r=>{
      const now=currentReferenceFor(r.imageId||r.id,ctx);
      if(now&&r.iso&&now.iso&&r.iso!==now.iso)reasons.push("A generation reference changed");
      if(now&&r.version!=null&&now.version!=null&&r.version!==now.version)reasons.push("A generation reference changed");
      if(now&&now.missing)reasons.push("A generation reference is missing");
    });
    const expectedReviewKey=currentReviewKeyFor(imageId,ctx);
    const approvalReviewKey=String((current&&current.approval&&current.approval.reviewKey)||"");
    if(expectedReviewKey!==undefined&&approvalReviewKey!==String(expectedReviewKey||""))
      reasons.push("Approved review context changed");
    const unique=uniq(reasons);
    const contextChecked=(currentSpecFor(imageId,ctx)!==undefined)
      ||expectedReviewKey!==undefined
      ||!!(ctx&&ctx.reviewReasonsById&&own(ctx.reviewReasonsById,imageId))
      ||!!(ctx&&ctx.currentReferences&&own(ctx.currentReferences,imageId))
      ||!!(ctx&&typeof ctx.currentReferenceFor==="function");
    const assetApproved=isApproved(current);
    return {
      imageId,
      missing:!available&&!loading,
      loading:!available&&loading,
      availabilityKnown,
      excluded:excluded(ref,current),
      stale:unique.some(x=>/changed|missing/i.test(x)),
      approved:assetApproved,
      approvalReviewKey,
      contextChecked,
      currentApproval:assetApproved&&contextChecked&&!unique.length,
      currentSnapshot:stageReferenceSnapshot(imageId,current,ctx),
      reasons:unique
    };
  }

  const sceneFor=(sh,ctx)=>{
    if(ctx&&ctx.scene&&(!sh||!sh.sceneId||ctx.scene.id===sh.sceneId))return ctx.scene;
    return arr(ctx&&ctx.scenes).find(s=>s&&sh&&s.id===sh.sceneId)||null;
  };
  const charMap=ctx=>{
    if(ctx&&ctx.charById)return ctx.charById;
    const out={};arr(ctx&&ctx.characters).forEach(x=>{if(x&&x.id)out[x.id]=x;});return out;
  };
  const propMap=ctx=>{
    if(ctx&&ctx.propById)return ctx.propById;
    const out={};arr(ctx&&ctx.props).forEach(x=>{if(x&&x.id)out[x.id]=x;});return out;
  };
  const off=(sh,baseId,assetId)=>{
    const set=new Set(arr(sh&&sh.refOff));
    return set.has(baseId)||set.has(assetId);
  };
  const roleFor=(kind,derived)=>kind==="character"
    ?(derived?"appearance_state":"master")
    :kind==="location"?(derived?"coverage":"master")
    :(derived?"continuity_state":"master");
  const addUsage=(d,shotId,role,source)=>{
    if(!d.usages.some(u=>u.shotId===shotId&&u.role===role&&u.source===source))
      d.usages.push({shotId,role,source});
    if(d.shotIds.indexOf(shotId)<0)d.shotIds.push(shotId);
    if(d.roles.indexOf(role)<0)d.roles.push(role);
  };

  function stageShotReferencePackage(shots,context){
    const ctx=context||{};
    const chars=charMap(ctx),props=propMap(ctx),scenes=arr(ctx.scenes);
    const buckets={character:new Map(),location:new Map(),prop:new Map()};
    const byShot=[],warnings=[];
    const screenplayCast={opening:[],physical:[],remote:[],mentioned:[]};
    const warn=(shotId,imageId,code,message,severity)=>{
      const w={shotId:String(shotId||""),imageId:String(imageId||""),code,message,severity:severity||"warning"};
      if(!warnings.some(x=>x.shotId===w.shotId&&x.imageId===w.imageId&&x.code===w.code))warnings.push(w);
    };
    const put=(kind,spec,sh)=>{
      if(!spec||!spec.assetId||off(sh,spec.baseId,spec.assetId))return null;
      const m=metaFor(spec.assetId,ctx);
      const status=stageReferenceStatus({imageId:spec.assetId},ctx);
      const severity=spec.required?"error":"warning";
      if(status.excluded){warn(sh.id,spec.assetId,"excluded-reference","Private or device-only reference is excluded",severity);return null;}
      let d=buckets[kind].get(spec.assetId);
      if(!d){
        d={
          assetId:spec.assetId,baseId:spec.baseId||spec.assetId,entityId:spec.entityId||spec.baseId||spec.assetId,
          kind,stateId:spec.stateId||"",coverageId:spec.coverageId||"",
          snapshot:stageReferenceSnapshot(spec.assetId,m,ctx),status,
          required:!!spec.required,shotIds:[],roles:[],usages:[]
        };
        buckets[kind].set(spec.assetId,d);
      }
      if(spec.required)d.required=true;
      addUsage(d,String(sh.id||""),spec.role,spec.source);
      if(status.missing)warn(sh.id,spec.assetId,"missing-reference",
        (spec.required?"Required ":"Implicit ")+kind+" reference image is missing",severity);
      if(status.loading)warn(sh.id,spec.assetId,"loading-reference",
        (spec.required?"Required ":"Implicit ")+kind+" reference image is still loading",severity);
      /* Art Room master assets use their current saved version automatically.
         Availability, privacy and actual source/version drift remain actionable;
         a separate manual approval flag is not a Stage requirement. */
      status.reasons.forEach(r=>{
        // `missing-reference` above already reports absent bytes with the correct
        // required/implicit severity. Do not duplicate that same fact as a second
        // review-required warning for every shot.
        if(status.missing&&/reference image is missing or has not finished loading/i.test(String(r||"")))return;
        warn(sh.id,spec.assetId,"review-required",r);
      });
      return d.assetId;
    };

    arr(shots).filter(Boolean).forEach(sh=>{
      const scene=sceneFor(sh,ctx);
      const shotRow={shotId:String(sh.id||""),characters:[],locations:[],props:[],warnings:[]};
      let cast=[];
      let screenplay=null;
      try{
        // a moment of a split beat reads its own moment (2026-11-01)
        screenplay=typeof g.shotScreenplayFor==="function"
          ?g.shotScreenplayFor(scene,sh,{drafts:ctx.drafts||{},characters:Object.values(chars),beatsMap:ctx.beatsMap||{}})
          :typeof g.shotBeatScreenplay==="function"
          ?g.shotBeatScreenplay(scene,sh.beatN,{drafts:ctx.drafts||{},characters:Object.values(chars),beatsMap:ctx.beatsMap||{}})
          :null;
      }catch(e){screenplay=null;}
      /* Live screenplay source wins over stale subjects, including legacy shots
         whose old Daniel/phone participant was persisted as an in-frame subject.
         Beat-opening frames are strict first-state references; later legacy/manual
         shots may use physical cast from the authored beat, but never remote-only
         participants. */
      try{
        const missingCanonical=(sh.keyframeMode==="beat-opening"||sh.keyframeMode==="moment")&&(!screenplay||!screenplay.hasSource);
        cast=missingCanonical
          ?[]
          :screenplay&&screenplay.hasSource
          ?((sh.keyframeMode==="beat-opening"||sh.keyframeMode==="moment")
            ?arr(screenplay.openingCharacterIds)
            :(sh.referenceCharactersSet
              ?arr(sh.referenceCharacterIds).filter(id=>arr(screenplay.physicalCharacterIds).indexOf(id)>=0)
              :arr(screenplay.physicalCharacterIds)))
          :(typeof g.inFrameCast==="function"
            ?g.inFrameCast(sh,scene,Object.values(chars))
            :(sh.referenceCharactersSet?arr(sh.referenceCharacterIds):arr(sh.subjects)));
      }catch(e){cast=screenplay&&screenplay.hasSource
        ?((sh.keyframeMode==="beat-opening"||sh.keyframeMode==="moment")?arr(screenplay.openingCharacterIds):arr(screenplay.physicalCharacterIds))
        :((sh.keyframeMode==="beat-opening"||sh.keyframeMode==="moment")?[]:arr(sh.subjects));}
      if((sh.keyframeMode==="beat-opening"||sh.keyframeMode==="moment")&&(!screenplay||!screenplay.hasSource))
        warn(sh.id,"screenplay","missing-screenplay-helper",
          "Canonical screenplay source is unavailable for this beat-opening shot; stale subjects were not packaged","error");
      shotRow.openingCharacterIds=screenplay&&screenplay.hasSource?arr(screenplay.openingCharacterIds):[];
      shotRow.physicalCharacterIds=screenplay&&screenplay.hasSource?arr(screenplay.physicalCharacterIds):[];
      shotRow.remoteCharacterIds=screenplay&&screenplay.hasSource?arr(screenplay.remoteCharacterIds):[];
      shotRow.mentionedCharacterIds=screenplay&&screenplay.hasSource?arr(screenplay.mentionedCharacterIds):[];
      ["opening","physical","remote","mentioned"].forEach(k=>arr(shotRow[k+"CharacterIds"]).forEach(id=>{
        if(screenplayCast[k].indexOf(id)<0)screenplayCast[k].push(id);
      }));
      const overrideIds=sh&&sh.stageCharacterReferenceOverrides
        ?Object.keys(sh.stageCharacterReferenceOverrides):[];
      uniq(arr(cast).concat(overrideIds)).forEach(id=>{
        const c=chars[id];if(!c)return;
        const overrides=sh&&sh.stageCharacterReferenceOverrides;
        if(own(overrides,c.id)){
          if(overrides[c.id]!=="master"){
            warn(sh.id,c.id,"invalid-character-reference-override",
              'Character reference override must be "master"',"error");
            return;
          }
          const allowedIds=screenplay&&screenplay.hasSource
            ?((sh.keyframeMode==="beat-opening"||sh.keyframeMode==="moment")?arr(screenplay.openingCharacterIds):arr(screenplay.physicalCharacterIds))
            :[];
          if(screenplay&&screenplay.hasSource&&allowedIds.indexOf(c.id)<0){
            warn(sh.id,c.id,"offscreen-character-reference",
              "Manual character reference was filtered: this participant is not physical in the screenplay beat opening. Use the voice/VO reference instead, or revise the beat opening","error");
            return;
          }
          const got=put("character",{assetId:c.id,baseId:c.id,entityId:c.id,stateId:"",
            role:roleFor("character",false),source:"shot-master-override",required:true},sh);
          if(got)shotRow.characters.push(got);
          return;
        }
        let resolved=null;
        if(typeof g.shotCharacterReferenceSpec==="function"){
          try{resolved=g.shotCharacterReferenceSpec(c,scene,scenes,{required:!!sh.referenceCharactersSet});}catch(e){}
        }
        if(!resolved){
          let active={version:1,state:null};
          if(typeof g.activeStateForScene==="function"){
            try{active=g.activeStateForScene(c,scene,scenes)||active;}catch(e){}
          }
          const st=active.state||null;
          resolved={id:st?c.id+":"+st.id:c.id,baseId:c.id,entityId:c.id,
            stateId:st&&st.id||"",state:st,required:!!st||!!sh.referenceCharactersSet};
        }
        const st=resolved.state||null;
        const got=put("character",{assetId:resolved.id,baseId:resolved.baseId||c.id,
          entityId:resolved.entityId||c.id,stateId:resolved.stateId||"",
          role:roleFor("character",!!st),source:st?"active-state":"base",
          required:!!resolved.required},sh);
        if(got)shotRow.characters.push(got);
      });
      /* Keep an explicit offscreen selection actionable, but never promote a stale
         non-manual subject into the package. The branch above already retained
         manual selections; this warning explains why the filtered stale tag is gone. */
      if(screenplay&&screenplay.hasSource&&screenplay.remoteCharacterIds.length)
        screenplay.remoteCharacterIds.forEach(id=>{
          if(!sh.referenceCharactersSet && arr(sh.subjects).indexOf(id)>=0)
            warn(sh.id,id,"remote-character-not-in-frame",
              "This screenplay participant is remote/offscreen and is kept as voice/script only; no body or identity image is attached","warning");
        });
      /* inFrameCast correctly filters stale ids from its visual cast. Preserve the
         director's explicit selection as an error descriptor instead of losing it. */
      if(sh.referenceCharactersSet)uniq(sh.referenceCharacterIds).forEach(id=>{
        if(chars[id]||off(sh,id,id))return;
        const got=put("character",{assetId:id,baseId:id,entityId:id,
          role:"master",source:"manual-selection",required:true},sh);
        if(got)shotRow.characters.push(got);
        warn(sh.id,id,"missing-selected-character","Manually selected character no longer exists","error");
      });
      if(sh.referenceCharactersSet&&screenplay&&screenplay.hasSource)
        uniq(sh.referenceCharacterIds).forEach(id=>{
          const allowedIds=(sh.keyframeMode==="beat-opening"||sh.keyframeMode==="moment")
            ?arr(screenplay.openingCharacterIds):arr(screenplay.physicalCharacterIds);
          if(allowedIds.indexOf(id)<0)
            warn(sh.id,id,"offscreen-character-reference",
              "Manual character reference was filtered: this participant is outside the screenplay beat opening. Use the voice/VO reference instead, or revise the beat opening","error");
        });

      let loc=(ctx.location&&(!scene||arr(ctx.location.scenes).indexOf(scene.id)>=0))?ctx.location:null;
      if(!loc&&typeof g.locationForScene==="function"){
        try{loc=g.locationForScene(arr(ctx.locations),scene&&scene.id);}catch(e){}
      }
      if(!loc)loc=arr(ctx.locations).find(l=>l&&scene&&arr(l.scenes).indexOf(scene.id)>=0)||null;
      let locSpecs=[];
      if((loc||sh.referenceLocationsSet)&&typeof g.shotLocationCoverageSpecs==="function"){
        try{locSpecs=g.shotLocationCoverageSpecs(loc,sh,scene,ctx.drafts||{})||[];}catch(e){}
      }
      /* Preserve an explicit selection even when its image/card disappeared. The
         stale id becomes an honest missing requirement, never a master fallback. */
      if(sh.referenceLocationsSet){
        arr(sh.referenceLocationIds).forEach(id=>{
          if(id&&!locSpecs.some(s=>s&&s.id===id))locSpecs.push({
            id,baseId:(loc&&loc.id)||sh.locationId||"",source:"manual-selection"
          });
        });
      }
      /* No master fallback: a shot requiring a location must expose missing coverage. */
      if(loc&&!locSpecs.length&&!sh.referenceLocationsSet&&!arr(sh.refOff).includes(loc.id))
        warn(sh.id,loc.id,"missing-location-coverage","This shot's location camera view is missing");
      locSpecs.forEach(s=>{
        const manual=!!sh.referenceLocationsSet&&arr(sh.referenceLocationIds).includes(s.id);
        const ownerId=s.entityId||s.locationId||s.baseId||(loc&&loc.id)||sh.locationId||s.id;
        if(s.unavailable){
          if(!off(sh,s.baseId||s.id,s.id))
            warn(sh.id,s.id,"unavailable-location-selection",
              "Selected location reference is no longer in this film's location library. Restore it or choose another reference.","error");
          return;
        }
        const got=put("location",{assetId:s.id,baseId:s.baseId||ownerId,
          entityId:ownerId,coverageId:s.category==="place"?"":s.id,stateId:s.stateId||"",
          role:s.category==="place"?"master":s.category==="state"?"state":roleFor("location",true),
          source:s.source||"coverage",required:manual},sh);
        if(got)shotRow.locations.push(got);
      });

      let propIds=[];
      try{
        propIds=typeof g.inFrameProps==="function"?g.inFrameProps(sh,scene,chars,props):arr(sh.props);
      }catch(e){propIds=arr(sh.props);}
      uniq(propIds).forEach(id=>{
        const p=props[id];if(!p)return;
        // THE FRAME'S ATTACH RULE (owner 2026-10-08 — Props review): worn close-up sheets only on tight shots,
        // text-only objects never — the video got every in-frame prop, with "missing image" warnings
        if(typeof g.shotPropAttachable==="function"){ try{ if(!g.shotPropAttachable(p,sh,scene)) return; }catch(e){} }
        let resolved={id:p.id,state:null};
        if(typeof g.shotPropSheetId==="function"){
          try{resolved=g.shotPropSheetId(p,scene,scenes,sh.beatN,sh.microBeatId,sh.id,ctx)||resolved;}catch(e){}
        }
        const got=put("prop",{assetId:resolved.id||p.id,baseId:p.id,entityId:p.id,
          stateId:resolved.state&&resolved.state.id,role:roleFor("prop",!!resolved.state),
          source:resolved.state?"continuity-state":"base",required:!!resolved.state},sh);
        if(got)shotRow.props.push(got);
      });
      shotRow.characters=uniq(shotRow.characters);shotRow.locations=uniq(shotRow.locations);shotRow.props=uniq(shotRow.props);
      shotRow.warnings=warnings.filter(w=>w.shotId===shotRow.shotId).map(w=>w.code);
      byShot.push(shotRow);
    });

    /* Review references recorded on prior takes without retaining their URL/label/text. */
    arr(ctx.savedTakeReferences).forEach(r=>{
      const s=stageReferenceStatus(r,ctx);
      s.reasons.forEach(reason=>warn(r.shotId||"",s.imageId,"saved-take-review",reason));
    });
    const characters=Array.from(buckets.character.values());
    const locations=Array.from(buckets.location.values());
    const propList=Array.from(buckets.prop.values());
    const sigRows=[...characters,...locations,...propList].map(d=>[
      d.kind,d.assetId,d.snapshot.iso,d.snapshot.version,d.snapshot.approved,
      d.snapshot.approvalReviewKey,d.status.contextChecked,d.status.currentApproval,d.status.reasons,
      d.usages.map(u=>u.shotId+":"+u.role+":"+u.source).sort()
    ]);
    sigRows.sort((a,b)=>String(a[0]+a[1]).localeCompare(String(b[0]+b[1])));
    const raw=JSON.stringify(sigRows);let hash=2166136261;
    for(let i=0;i<raw.length;i++)hash=Math.imul(hash^raw.charCodeAt(i),16777619);
    return {characters,locations,props:propList,byShot,warnings,
      openingCharacterIds:screenplayCast.opening,physicalCharacterIds:screenplayCast.physical,
      remoteCharacterIds:screenplayCast.remote,mentionedCharacterIds:screenplayCast.mentioned,
      signature:(hash>>>0).toString(16)};
  }

  g.stageReferenceSnapshot=stageReferenceSnapshot;
  g.stageReferenceStatus=stageReferenceStatus;
  g.stageShotReferencePackage=stageShotReferencePackage;
})(typeof window!=="undefined"?window:globalThis);
