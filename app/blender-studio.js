/* Browser client for the reusable Blender Studio workspace.  Transport stays in
   BlenderPreview so Studio uses the existing cloud scope and session token. */
(function(root){
  "use strict";
  function fail(message,code){ var e=new Error(message); e.code=code||"BLENDER_STUDIO_ERROR"; return e; }
  function copy(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function bridge(){
    if(!root.BlenderPreview || typeof root.BlenderPreview.request!=="function")
      throw fail("The Blender connection has not loaded.","BLENDER_STUDIO_UNAVAILABLE");
    return root.BlenderPreview;
  }
  function currentScope(){
    var b=bridge(), s=b.scope();
    if(!s || !s.projectId || !s.uid) throw fail("Open a saved cloud film and sign in to use Blender Studio.","BLENDER_SCOPE_REQUIRED");
    return s;
  }
  function sameScope(scope){
    try { return !!bridge().isCurrent(scope); } catch(_){ return false; }
  }
  function assertScope(scope,guard){
    if(!sameScope(scope) || (guard && !guard()))
      throw fail("The film or your access changed. This Blender Studio result was not used.","BLENDER_STALE");
  }
  function contract(){
    return root.BlenderStudioContract || root.BlenderStudioWorkspaceContract || null;
  }
  function validate(workspace){
    var c=contract();
    if(c && typeof c.validateWorkspace==="function") c.validateWorkspace(workspace);
    return workspace;
  }
  function location(location){
    if(!location || !location.id) throw fail("Choose a saved canonical location before opening Blender Studio.","BLENDER_LOCATION_REQUIRED");
    var id=String(location.id);
    function contextText(value,max){
      max=max||4000;
      if(typeof value==="string") return value.slice(0,max);
      if(value==null) return "";
      try{var encoded=JSON.stringify(value);return encoded.length<=max?encoded:"";}catch(_){return "";}
    }
    function productionPlanText(value){
      if(value==null)return "";
      if(typeof value==="string"){
        if(value.length<=16000)return value;
        try{value=JSON.parse(value);}catch(_){return "";}
      }
      try{
        var raw=JSON.stringify(value);if(raw.length<=16000)return raw;
        var compact={schema:value.schema||"cm-location-plan-v1",canonicalSet:value.canonicalSet||{},
          sharedSetLayout:value.sharedSetLayout,continuityRoot:value.continuityRoot,
          coordinates:value.coordinates,
          screenplaySpaces:(value.screenplaySpaces||[]).map(function(x){return {key:x.key,name:x.name,intExt:x.intExt,time:x.time,source:x.source,scenes:x.scenes};}),
          appearanceStates:(value.appearanceStates||[]).map(function(x){return {id:x.id,unitKey:x.unitKey,time:x.time,state:x.state,scenes:x.scenes};}),
          requiredSpacePlates:(value.requiredSpacePlates||[]).map(function(x){return {id:x.id,name:x.name,role:x.role,scenes:x.scenes};}),
          coverageViews:(value.coverageViews||[]).map(function(x){return {id:x.id,name:x.name,purpose:x.purpose,cameraPosition:x.cameraPosition,target:x.target,visibleAnchors:x.visibleAnchors,lens:x.lens};}),
          sceneSetups:(value.sceneSetups||[]).map(function(x){return {id:x.id,unitKey:x.unitKey,sceneId:x.sceneId,sceneNo:x.sceneNo,spaceName:x.spaceName,sourceKind:x.sourceKind,sourceSlug:x.sourceSlug,screenplayExcerpt:x.screenplayExcerpt,temporaryDressing:x.temporaryDressing,blocking:x.blocking,handledProps:x.handledProps,objectStates:x.objectStates};})};
        raw=JSON.stringify(compact);if(raw.length<=16000)return raw;
        raw=JSON.stringify({schema:compact.schema,canonicalSet:compact.canonicalSet,sharedSetLayout:compact.sharedSetLayout,continuityRoot:compact.continuityRoot,summary:{
          screenplaySpaces:compact.screenplaySpaces.length,appearanceStates:compact.appearanceStates.length,
          requiredSpacePlates:compact.requiredSpacePlates.length,coverageViews:compact.coverageViews.length,
          sceneSetups:compact.sceneSetups.length}});
        if(raw.length<=16000)return raw;
        raw=JSON.stringify({schema:compact.schema,sharedSetLayout:compact.sharedSetLayout,summary:{
          screenplaySpaces:compact.screenplaySpaces.length,appearanceStates:compact.appearanceStates.length,
          requiredSpacePlates:compact.requiredSpacePlates.length,coverageViews:compact.coverageViews.length,
          sceneSetups:compact.sceneSetups.length}});
        if(raw.length<=16000)return raw;
        throw fail("The shared set layout is too large to send intact. Shorten it before opening Blender Studio.","BLENDER_LAYOUT_TOO_LARGE");
      }catch(e){if(e&&e.code==="BLENDER_LAYOUT_TOO_LARGE")throw e;return "";}
    }
    return {id:id,name:String(location.name||"Untitled location"),
      parentLocationId:location.parentLocationId==null ? (location.parentLocation&&location.parentLocation.id||null) : String(location.parentLocationId),
      rootLocationId:location.rootLocationId==null ? (location.continuityRootId||location.continuityRootKey||id) : String(location.rootLocationId),
      context:{description:contextText(location.context&&location.context.description||location.description),
        architecture:contextText(location.context&&location.context.architecture||location.architecture),
        materials:contextText(location.context&&location.context.materials||location.materials),
        staging:contextText(location.context&&location.context.staging||location.staging),
        productionPlan:productionPlanText(location.context&&location.context.productionPlan||location.productionPlan)}};
  }
  async function request(action,payload,scope,guard){
    scope=scope||currentScope(); assertScope(scope,guard);
    var body=Object.assign({projectId:scope.projectId},payload||{});
    var data=await bridge().request(action,body,scope,function(){ return sameScope(scope)&&(!guard||guard()); });
    assertScope(scope,guard); return data||{};
  }
  function mutationId(){ return "studio-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2); }
  var opened=new Set();
  function openedKey(id,scope){return scope.uid+":"+scope.projectId+":"+id;}
  function wasOpened(id){try{return opened.has(openedKey(id,currentScope()));}catch(_){return false;}}
  function rememberOpened(id,scope){opened.add(openedKey(id,scope));
    if(root.dispatchEvent&&root.CustomEvent)root.dispatchEvent(new root.CustomEvent("studio-workspace-opened"));}
  function generatedReference(entityId,kind,label){
    var meta=typeof root.nbGetMeta==="function"&&root.nbGetMeta(entityId);
    if(!meta||meta.uploaded||!meta.iso||!Number.isFinite(Date.parse(meta.iso))||
      /upload/i.test(String(meta.modelId||"")+String(meta.requestedModel||""))||
      !(meta.modelId||meta.requestedModel))return null;
    return {entityId:String(entityId),kind:kind||"location",label:String(label||entityId),version:String(meta.iso)};
  }
  async function requireImage(entityId,scope,guard){
    scope=scope||currentScope();assertScope(scope,guard);
    var before=generatedReference(entityId);
    var url=typeof root.nbLoadImage==="function"?await root.nbLoadImage(entityId):null;
    assertScope(scope,guard);
    var reference=generatedReference(entityId);
    if(before&&reference&&before.version!==reference.version)
      throw fail("The source image changed while loading. Reopen Studio to use the current version.","BLENDER_SOURCE_CHANGED");
    if(!reference||!url)throw fail("Generate this location's image first, then open Blender Studio. Uploaded images alone do not unlock it.","BLENDER_IMAGE_REQUIRED");
    return {reference:reference,url:url};
  }
  async function capabilities(scope,guard){ return request("studio.capabilities",{},scope,guard); }
  async function open(input,scope,guard){
    var loc=location(input&&input.location), shot=input&&input.shot;
    scope=scope||currentScope();
    var source=await requireImage(loc.id,scope,guard);
    var references=[Object.assign({},source.reference,{label:loc.name})];
    (input&&input.references||[]).forEach(function(r){
      var ref=r&&generatedReference(r.entityId,r.kind,r.label);
      if(ref&&!references.some(function(x){return x.entityId===ref.entityId;}))references.push(ref);
    });
    var result=await request("studio.workspace.open",{location:loc,shot:shot?copy(shot):undefined,references:references},scope,guard);
    if(!result.workspace) throw fail("Blender Studio returned no workspace.","BLENDER_STUDIO_RESPONSE");
    validate(result.workspace);rememberOpened(loc.id,scope); return result.workspace;
  }
  async function get(locationId,scope,guard){
    if(!locationId) throw fail("A location is required.","BLENDER_LOCATION_REQUIRED");
    scope=scope||currentScope();await requireImage(locationId,scope,guard);
    var result=await request("studio.workspace.get",{locationId:String(locationId)},scope,guard);
    if(!result.workspace) throw fail("This Blender Studio workspace was not found.","BLENDER_STUDIO_RESPONSE");
    validate(result.workspace);rememberOpened(locationId,scope); return result.workspace;
  }
  async function current(scope,guard){ return request("studio.workspace.current",{},scope,guard); }
  async function save(workspace,baseRevision,scope,guard,id){
    validate(workspace);
    var result=await request("studio.workspace.save",{locationId:String(workspace.locationId),baseRevision:baseRevision,
      mutationId:id||mutationId(),workspace:copy(workspace)},scope,guard);
    if(!result.workspace) throw fail("Blender Studio did not confirm the save.","BLENDER_STUDIO_RESPONSE");
    validate(result.workspace); return result.workspace;
  }
  function applyProposal(workspace,proposal){
    var c=contract();
    if(!c || typeof c.applyProposal!=="function") throw fail("The shared Blender Studio contract has not loaded.","BLENDER_STUDIO_CONTRACT_REQUIRED");
    var next=c.applyProposal(copy(workspace),copy(proposal));
    validate(next); return next;
  }
  async function task(action,payload,scope,guard){ return request(action,payload,scope,guard); }
  root.BlenderStudio={
    generatedReference:generatedReference,requireImage:requireImage,wasOpened:wasOpened,
    scope:currentScope,isCurrent:sameScope,request:request,capabilities:capabilities,open:open,get:get,current:current,save:save,
    applyProposal:applyProposal,assistantSubmit:function(p,s,g){return task("studio.assistant.submit",p,s,g);},
    assistantGet:function(id,s,g){return task("studio.assistant.get",{taskId:id},s,g);},
    assistantCancel:function(id,s,g){return task("studio.assistant.cancel",{taskId:id},s,g);},
    meshSubmit:function(p,s,g){return task("studio.mesh.submit",p,s,g);},
    meshGet:function(id,s,g){return task("studio.mesh.get",{taskId:id},s,g);},
    meshCancel:function(id,s,g){return task("studio.mesh.cancel",{taskId:id},s,g);},
    assetGet:function(locationId,assetId,s,g){return task("studio.asset.get",{locationId:locationId,assetId:assetId},s,g);},
    referenceGet:function(locationId,entityId,s,g){return task("studio.reference.get",{locationId:locationId,entityId:entityId},s,g);},
    previewGet:function(locationId,previewId,s,g){return task("studio.preview.get",{locationId:locationId,previewId:previewId},s,g);},
    previewPublish:function(p,s,g){return task("studio.preview.publish",p,s,g);},
    mutationId:mutationId
  };
})(typeof window!=="undefined"?window:globalThis);
