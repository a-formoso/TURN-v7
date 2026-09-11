/* Explicit, non-destructive conversion of existing coverage into beat keyframes.
   The caller confirms first, persists archived shots in the existing Trash, and
   keeps all image/take assets. Never run this as a hydration/migration effect. */
(function(root){
  function mergeBeatKeyframes(previous, prepared){
    const old=Array.isArray(previous)?previous:[];
    const incoming=Array.isArray(prepared)?prepared:[];
    const seen=new Set(), used=new Set(), touched=new Set(), updates=[];
    const key=sh=>String(sh.sceneId)+"#"+String(sh.beatN);
    incoming.forEach(next=>{
      const k=key(next);
      if(seen.has(k)) return;
      seen.add(k); touched.add(k);
      const candidates=old.filter(sh=>key(sh)===k)
        .sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
      const prior=candidates.find(sh=>sh.keyframeMode==="beat-opening")||candidates[0];
      if(prior) used.add(prior.id);
      const merged={...(prior||{}),...next,id:prior?prior.id:next.id,
        keyframeMode:"beat-opening",covers:[],beatPlan:null,
        referenceCharactersSet:false,referenceCharacterIds:[]};
      const fingerprint=typeof root.shotSpecFingerprint==="function"?root.shotSpecFingerprint:null;
      const changed=!!prior && (prior.keyframeMode!=="beat-opening"
        || prior.sourceScreenplayRev!==merged.sourceScreenplayRev
        || (fingerprint ? fingerprint(prior)!==fingerprint(merged)
          : JSON.stringify([prior.action,prior.composition,prior.subjects,prior.dialogue])
            !==JSON.stringify([merged.action,merged.composition,merged.subjects,merged.dialogue])));
      merged.specRev=prior ? (Number(prior.specRev)||1)+(changed?1:0) : 1;
      if(fingerprint) merged.specHash=fingerprint(merged);
      if(changed){
        merged.locked=false; merged.approved=false;
        if(prior.dialogue!==merged.dialogue) merged.lineAudio=null;
      }
      updates.push(merged);
    });
    const archived=old.filter(sh=>touched.has(key(sh))&&!used.has(sh.id));
    const shots=old.filter(sh=>!touched.has(key(sh))).concat(updates);
    return {shots,archived,updated:updates};
  }
  root.mergeBeatKeyframes=mergeBeatKeyframes;
})(typeof window!=="undefined"?window:globalThis);