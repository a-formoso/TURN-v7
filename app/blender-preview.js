/* Browser-side Blender proof. No image/video generation provider is invoked. */
(function (root) {
  "use strict";
  function error(message, code) {
    var e = new Error(message); e.code = code || "BLENDER_PREVIEW_ERROR"; return e;
  }
  function contract() {
    if (!root.BlenderContract) throw error("The Blender scene tools have not loaded.");
    return root.BlenderContract;
  }
  function scope() {
    var s = typeof root.nbCloudScope === "function" ? root.nbCloudScope() : null;
    if (!s || !s.projectId || !s.uid) throw error("Open a saved cloud film and sign in to connect Blender.", "BLENDER_SCOPE_REQUIRED");
    return {projectId:String(s.projectId), uid:String(s.uid), epoch:s.epoch};
  }
  function isCurrent(s) {
    try {
      var live = scope();
      return !!s && live.projectId === s.projectId && live.uid === s.uid && live.epoch === s.epoch;
    } catch (_) { return false; }
  }
  function assertCurrent(s, guard) {
    if (!isCurrent(s) || (guard && !guard())) throw error("The film or shot settings changed. This preview was not saved.", "BLENDER_STALE");
  }
  function endpoint() {
    var cfg = root.TURN_SUPABASE || {};
    if (!cfg.url) throw error("The cloud connection is not configured.");
    var url = new URL(cfg.url);
    if (url.protocol !== "https:") throw error("The Blender connection requires HTTPS.");
    return url.origin + "/functions/v1/blender-bridge";
  }
  function client() {
    return typeof root.sbClient === "function" ? root.sbClient() : root._sbClient;
  }
  async function request(action, body, s, guard) {
    var url = endpoint(), options = {method:"GET", headers:{}};
    if (action !== "capabilities") {
      s = s || scope(); assertCurrent(s, guard);
      var sb = client();
      if (!sb || !sb.auth) throw error("Sign in to connect Blender.", "BLENDER_AUTH_REQUIRED");
      var session = await sb.auth.getSession();
      assertCurrent(s, guard);
      var value = session && session.data && session.data.session;
      if (session.error || !value || !value.access_token || !value.user || String(value.user.id) !== s.uid)
        throw error("Your sign-in changed. Reopen the Blender panel.", "BLENDER_AUTH_REQUIRED");
      if (body && body.projectId && body.projectId !== s.projectId)
        throw error("The preview belongs to another film.", "BLENDER_STALE");
      options = {method:"POST",headers:{"Content-Type":"application/json",
        "Authorization":"Bearer " + value.access_token},body:JSON.stringify(Object.assign({}, body || {}, {action:action}))};
    }
    // An authenticated call must never be automatically resubmitted.
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 20000);
    options.signal = controller.signal;
    if (root.TURN_SUPABASE && root.TURN_SUPABASE.anonKey)
      options.headers.apikey = root.TURN_SUPABASE.anonKey;
    var response, data;
    try {
      response = await root.fetch(url, options);
      if (s) assertCurrent(s, guard);
      data = await response.json();
      if (s) assertCurrent(s, guard);
    } catch (e) {
      if (e.code === "BLENDER_STALE") throw e;
      throw error(e.name === "AbortError" ? "The Blender connection timed out. Check its status before retrying." :
        "The Blender service could not be reached. No automatic retry was made.", "BLENDER_NETWORK");
    } finally { clearTimeout(timer); }
    if (!response.ok) {
      var message = data && typeof data.error === "string" ? data.error : "The Blender request was rejected.";
      // Never surface signed URLs or credentials in server/provider error text.
      var failure = error(message.replace(/https?:\/\/[^\s"'<>]+/gi, "[link]").slice(0, 400),
        data && data.code || "BLENDER_HTTP_" + response.status);
      failure.status = response.status;
      throw failure;
    }
    return data;
  }
  function id(value, name) {
    if (value == null || value === "") throw error("This shot needs a saved " + name + ".");
    return String(value);
  }
  function label(value, fallback) {
    return String(value || fallback).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) || fallback;
  }
  function lensOf(shot) {
    var advanced = shot.cameraSettings && shot.cameraSettings.focalLength;
    var raw = advanced && advanced !== "auto" ? advanced : shot.lens;
    if (raw === "imax70") return 70;
    if (raw === "vhs") return 35;
    var mm = Number(String(raw || "50").replace(/mm$/i, "").trim());
    return Number.isFinite(mm) && mm >= 8 && mm <= 200 ? mm : 50;
  }
  function buildSpec(input, overrides) {
    var shot = input.shot || {}, scene = input.scene || {}, loc = input.location;
    if (!loc) throw error("This shot needs a location before a Blender blockout can be prepared.");
    var s = input.scope || scope(), o = overrides || {};
    var room = Object.assign({width:12,depth:12,height:4}, o.room || {});
    var subjects = input.subjects || [], props = input.props || [];
    if (subjects.length > 4) throw error("This proof supports up to four visible characters. Choose a simpler shot.");
    if (props.length > 8) throw error("This proof supports up to eight visible props. Choose a simpler shot.");
    var grid = loc.staging || {}, landmarks = [];
    [["bg","left",-1,1],["bg","center",0,1],["bg","right",1,1],
      ["mid","left",-1,0],["mid","right",1,0],["fg","left",-1,-1],["fg","right",1,-1]
    ].forEach(function (cell) {
      var value = grid[cell[0]] && grid[cell[0]][cell[1]];
      if (typeof value !== "string" || !value.trim()) return;
      landmarks.push({id:"landmark-" + cell[0] + "-" + cell[1],label:label(value, "Landmark"),
        position:[cell[2]*room.width/3,cell[3]*room.depth/3,1],scale:[1.5,0.5,2]});
    });
    var distance = ({EWS:14,WS:8,MWS:6,MS:4,MCU:2.8,CU:1.8,ECU:1.1})[shot.size] || 6;
    var elevation = shot.angle === "high" ? 4 : shot.angle === "low" ? 0.6 : shot.angle === "top" ? 8 : 1.65;
    var camera = Object.assign({position:shot.angle === "top" ? [0,-0.1,elevation] : [0,-distance,elevation],
      target:[0,0,shot.size === "CU" || shot.size === "ECU" ? 1.6 : 1.4],
      focalLength:lensOf(shot),sensorWidth:36}, o.camera || {});
    var spec = {
      version:1,projectId:s.projectId,shotId:id(shot.id,"shot"),sceneId:id(scene.id || shot.sceneId,"scene"),
      locationId:id(loc.id || loc.baseId,"location"),label:label(shot.title || shot.name || scene.title, "Shot " + shot.id),
      room:room,landmarks:landmarks,
      actors:subjects.map(function (c, i) {
        return {id:"actor-" + id(c.id,"character"),label:label(c.name,"Stand-in"),
          position:[(i-(subjects.length-1)/2)*1.2,0,0],height:1.75};
      }),
      props:props.map(function (p, i) {
        return {id:"prop-" + id(p.id,"prop"),label:label(p.name,"Prop"),position:[(i-(props.length-1)/2)*0.8,1.5,0.5],scale:[0.5,0.5,1]};
      }),
      camera:camera,render:{width:640,height:360,samples:16}
    };
    contract().validateSpec(spec);
    return JSON.parse(JSON.stringify(spec));
  }
  function slotId(shotId) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(String(shotId))) throw error("Invalid shot identity.");
    return "blender-preview-" + shotId;
  }
  async function loadPreview(shotId, s) {
    s = s || scope(); assertCurrent(s);
    if (typeof root.nbLoadImage !== "function") throw error("Image storage has not loaded.");
    var slot = slotId(shotId), url = await root.nbLoadImage(slot);
    assertCurrent(s);
    if (!url) return null;
    var meta = typeof root.nbGetMeta === "function" ? root.nbGetMeta(slot) : null;
    if (meta && (meta.kind !== "blender-preview" || meta.projectId !== s.projectId || meta.shotId !== String(shotId)))
      throw error("The saved preview does not belong to this shot.", "BLENDER_STALE");
    return {url:url,meta:meta || null};
  }
  async function savePreview(job, s, guard) {
    assertCurrent(s, guard);
    if (!job || job.status !== "completed" || !job.spec || job.spec.projectId !== s.projectId)
      throw error("Only a completed preview for this film can be saved.");
    var spec = JSON.parse(JSON.stringify(job.spec)), jobId = String(job.id || "");
    var hash = await contract().hashSpec(spec);
    assertCurrent(s, guard);
    if (hash !== job.specHash) throw error("The returned scene signature does not match this preview.");
    contract().validateCameraResult(job.actualCamera, spec);
    contract().decodePNG(job.pngBase64, spec.render.width, spec.render.height);
    var dataUrl = "data:image/png;base64," + job.pngBase64;
    var meta = {kind:"blender-preview",projectId:s.projectId,shotId:spec.shotId,
      jobId:jobId,specHash:hash,sourceSpec:spec,actualCamera:JSON.parse(JSON.stringify(job.actualCamera)),
      label:"Blender blockout — not finished artwork",source:"blender",renderedAt:new Date().toISOString()};
    try {
      if (typeof root.nbCommit !== "function") throw error("Image storage has not loaded.");
      var result = await root.nbCommit(slotId(spec.shotId), dataUrl, meta, [], "shot", s.epoch,
        function () { return !isCurrent(s) || !!(guard && !guard()); });
      assertCurrent(s, guard);
      if (!result || !["cloud","idb","local","indexeddb","localStorage"].includes(result.tier))
        throw error("The preview was rendered but its save was not confirmed. Download it or retry saving.");
      return {url:result.url || dataUrl,meta:meta};
    } catch (e) {
      if (e.code !== "BLENDER_STALE") e.previewDataUrl = dataUrl;
      throw e;
    }
  }
  root.BlenderPreview = {scope:scope,isCurrent:isCurrent,endpoint:endpoint,request:request,
    buildSpec:buildSpec,canonical:function (value) { return contract().canonical(value); },
    hashSpec:function (spec) { return contract().hashSpec(spec); },
    loadPreview:loadPreview,savePreview:savePreview,slotId:slotId};
})(typeof window !== "undefined" ? window : globalThis);