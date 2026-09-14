/* Shared, data-only contract for the cm-studio-v1 extension. */
(function (root) {
  "use strict";
  var SCHEMA = "cm-studio-v1", ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  function fail(message) { throw new Error(message); }
  function plain(v, name) {
    if (!v || Object.getPrototypeOf(v) !== Object.prototype) fail(name + " must be an object.");
  }
  function keys(v, allowed, required, name) {
    plain(v, name);
    Object.keys(v).forEach(function (k) { if (allowed.indexOf(k) < 0) fail("Unsupported " + name + " field: " + k); });
    required.forEach(function (k) { if (!(k in v)) fail("Missing " + name + "." + k); });
  }
  function str(v, max, name, optional) {
    if (optional && v == null) return;
    if (typeof v !== "string" || !v.length || v.length > max || /[\u0000-\u001f]/.test(v)) fail("Invalid " + name + ".");
  }
  function id(v, name) { str(v, 128, name); if (!ID.test(v)) fail("Invalid " + name + "."); }
  function num(v, lo, hi, name) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) fail("Invalid " + name + ".");
  }
  function integer(v, lo, hi, name) { num(v, lo, hi, name); if (!Number.isInteger(v)) fail("Invalid " + name + "."); }
  function vec(v, lo, hi, name) {
    if (!Array.isArray(v) || v.length !== 3) fail("Invalid " + name + ".");
    v.forEach(function (n) { num(n, lo, hi, name); });
  }
  function object(v) {
    keys(v, ["id","name","kind","position","rotation","scale","color","characterId","assetId","lightEnergy"],
      ["id","name","kind","position","rotation","scale","color"], "managed object");
    id(v.id, "object id"); str(v.name, 120, "object name");
    if (["box","sphere","cylinder","plane","actor","mesh","light"].indexOf(v.kind) < 0) fail("Invalid object kind.");
    vec(v.position, -10000, 10000, "object position"); vec(v.rotation, -Math.PI * 8, Math.PI * 8, "object rotation");
    vec(v.scale, 0.001, 10000, "object scale"); vec(v.color, 0, 1, "object color");
    if (v.characterId != null) id(v.characterId, "character id");
    if (v.assetId != null) id(v.assetId, "asset id");
    if (v.lightEnergy != null) num(v.lightEnergy, 0, 100000, "light energy");
    return v;
  }
  function camera(v) {
    keys(v, ["position","target","focalLength","sensorWidth"], ["position","target","focalLength","sensorWidth"], "camera");
    vec(v.position, -10000, 10000, "camera position"); vec(v.target, -10000, 10000, "camera target");
    if (Math.hypot(v.target[0]-v.position[0],v.target[1]-v.position[1],v.target[2]-v.position[2]) < .001) fail("Camera target must differ.");
    num(v.focalLength, 8, 200, "focal length"); num(v.sensorWidth, 1, 100, "sensor width"); return v;
  }
  function track(v, ids) {
    keys(v, ["objectId","property","keyframes"], ["objectId","property","keyframes"], "track");
    id(v.objectId, "track object id"); if (ids && !ids.has(v.objectId)) fail("Track object is not in this shot.");
    if (["position","rotation","scale"].indexOf(v.property) < 0 || !Array.isArray(v.keyframes) || v.keyframes.length > 240) fail("Invalid track.");
    v.keyframes.forEach(function (k) { keys(k, ["frame","value"], ["frame","value"], "keyframe"); integer(k.frame, 1, 100000, "frame"); vec(k.value, -10000, 10000, "keyframe value"); });
  }
  function shot(v) {
    keys(v, ["id","sceneId","name","camera","objects","tracks","frameStart","frameEnd","fps"],
      ["id","sceneId","name","camera","objects","tracks","frameStart","frameEnd","fps"], "shot");
    id(v.id, "shot id"); id(v.sceneId, "scene id"); str(v.name, 120, "shot name"); camera(v.camera);
    if (!Array.isArray(v.objects) || v.objects.length > 250 || !Array.isArray(v.tracks) || v.tracks.length > 64) fail("Too many shot items.");
    var ids = new Set(); v.objects.forEach(function (o) { object(o); if (ids.has(o.id)) fail("Duplicate shot object."); ids.add(o.id); });
    integer(v.frameStart, 1, 100000, "frame start"); integer(v.frameEnd, v.frameStart, 100000, "frame end"); integer(v.fps, 1, 120, "fps");
    v.tracks.forEach(function (t) { track(t, ids); }); return v;
  }
  function context(v) {
    keys(v, ["description","architecture","materials","staging"], ["description","architecture","materials","staging"], "context");
    Object.keys(v).forEach(function (k) { if (typeof v[k] !== "string" || v[k].length > 4000 || /[\u0000-\u001f]/.test(v[k])) fail("Invalid context."); });
  }
  function workspace(v) {
    keys(v, ["schema","projectId","locationId","name","parentLocationId","rootLocationId","revision","context","objects","shots","references","assets","previews"],
      ["schema","projectId","locationId","name","parentLocationId","rootLocationId","revision","context","objects","shots","references","assets","previews"], "workspace");
    if (v.schema !== SCHEMA) fail("Unsupported studio schema.");
    id(v.projectId, "project id"); id(v.locationId, "location id"); str(v.name, 120, "workspace name");
    if (v.parentLocationId != null) id(v.parentLocationId, "parent location id"); id(v.rootLocationId, "root location id"); integer(v.revision, 0, 1000000000, "revision");
    context(v.context);
    if (!Array.isArray(v.objects) || v.objects.length > 500 || !Array.isArray(v.shots) || v.shots.length > 200 ||
      !Array.isArray(v.references) || v.references.length > 200 || !Array.isArray(v.assets) || v.assets.length > 200 || !Array.isArray(v.previews) || v.previews.length > 200) fail("Too many workspace items.");
    var ids = new Set(); v.objects.forEach(function (o) { object(o); if (ids.has(o.id)) fail("Duplicate object."); ids.add(o.id); });
    var shots = new Set(); v.shots.forEach(function (s) { shot(s); if (shots.has(s.id)) fail("Duplicate shot."); shots.add(s.id); });
    v.references.forEach(function (r) { keys(r, ["entityId","label","kind","version"], ["entityId","label","kind"], "reference"); id(r.entityId, "reference entity id"); str(r.label,120,"reference label"); if (["location","character","prop"].indexOf(r.kind)<0) fail("Invalid reference kind."); if (r.version != null) str(String(r.version),128,"reference version"); });
    v.assets.forEach(function (a) { keys(a, ["id","name","kind","sha256","bytes","modelId","rigged","animated","characterId"], ["id","name","kind","sha256","bytes","modelId","rigged","animated"], "asset"); id(a.id,"asset id"); str(a.name,120,"asset name"); if(a.kind!=="glb"||!/^[a-f0-9]{64}$/i.test(a.sha256)) fail("Invalid asset."); integer(a.bytes, 12, 67108864, "asset bytes"); str(a.modelId,128,"model id"); if(typeof a.rigged!=="boolean"||typeof a.animated!=="boolean") fail("Invalid asset flags."); if(a.characterId!=null) id(a.characterId,"character id"); });
    v.previews.forEach(function (p) { keys(p, ["id","shotId","sha256","bytes","actualCamera"], ["id","sha256","bytes","actualCamera"], "preview"); id(p.id,"preview id"); if(p.shotId!=null) id(p.shotId,"preview shot id"); if(!/^[a-f0-9]{64}$/i.test(p.sha256)) fail("Invalid preview."); integer(p.bytes,1,8388608,"preview bytes"); camera(p.actualCamera); });
    return v;
  }
  function proposal(v, workspaceValue) {
    keys(v, ["summary","ops"], ["summary","ops"], "proposal"); str(v.summary, 1000, "proposal summary");
    if (!Array.isArray(v.ops) || v.ops.length > 64) fail("Invalid proposal operations.");
    var shotIds = new Set((workspaceValue && workspaceValue.shots || []).map(function (s) { return s.id; }));
    v.ops.forEach(function (op) {
      plain(op); str(op.op, 32, "proposal operation");
      if (op.op === "upsert_object") { keys(op,["op","scope","shotId","object"],["op","scope","object"],"upsert operation"); if(["set","shot"].indexOf(op.scope)<0 || (op.scope==="shot" && (!op.shotId || !shotIds.has(op.shotId))) || (op.scope==="set" && op.shotId != null)) fail("Invalid proposal scope."); object(op.object); }
      else if (op.op === "remove_object") { keys(op,["op","scope","shotId","objectId"],["op","scope","objectId"],"remove operation"); if(["set","shot"].indexOf(op.scope)<0 || (op.scope==="shot" && (!op.shotId || !shotIds.has(op.shotId)))) fail("Invalid proposal scope."); id(op.objectId,"object id"); }
      else if (op.op === "set_camera") { keys(op,["op","shotId","camera"],["op","shotId","camera"],"camera operation"); if(!shotIds.has(op.shotId)) fail("Unknown shot."); camera(op.camera); }
      else if (op.op === "set_tracks") { keys(op,["op","shotId","tracks","frameStart","frameEnd","fps"],["op","shotId","tracks","frameStart","frameEnd","fps"],"tracks operation"); if(!shotIds.has(op.shotId)||!Array.isArray(op.tracks)||op.tracks.length>64) fail("Invalid tracks."); integer(op.frameStart,1,100000,"frame start"); integer(op.frameEnd,op.frameStart,100000,"frame end"); integer(op.fps,1,120,"fps"); op.tracks.forEach(function(t){track(t);}); }
      else fail("Unsupported proposal operation.");
    }); return v;
  }
  // Applying a proposal is deliberately a data operation, not an instruction
  // interpreter.  Clients still save the returned workspace with their
  // original baseRevision, so normal relay CAS protects local unsaved edits.
  function applyProposal(workspaceValue, proposalValue) {
    workspace(workspaceValue); proposal(proposalValue, workspaceValue);
    var next = JSON.parse(JSON.stringify(workspaceValue));
    proposalValue.ops.forEach(function (op) {
      var target, shot;
      if (op.scope === "set") target = next.objects;
      else if (op.scope === "shot") {
        shot = next.shots.find(function (item) { return item.id === op.shotId; });
        target = shot.objects;
      }
      if (op.op === "upsert_object") {
        var at = target.findIndex(function (item) { return item.id === op.object.id; });
        if (at < 0) target.push(JSON.parse(JSON.stringify(op.object)));
        else target[at] = JSON.parse(JSON.stringify(op.object));
      } else if (op.op === "remove_object") {
        var remove = target.findIndex(function (item) { return item.id === op.objectId; });
        if (remove >= 0) target.splice(remove, 1);
      } else if (op.op === "set_camera") {
        shot = next.shots.find(function (item) { return item.id === op.shotId; });
        shot.camera = JSON.parse(JSON.stringify(op.camera));
      } else if (op.op === "set_tracks") {
        shot = next.shots.find(function (item) { return item.id === op.shotId; });
        shot.tracks = JSON.parse(JSON.stringify(op.tracks));
        shot.frameStart = op.frameStart; shot.frameEnd = op.frameEnd; shot.fps = op.fps;
      }
    });
    workspace(next);
    return next;
  }
  var api = { schema:SCHEMA, validateWorkspace:workspace, validateObject:object, validateProposal:proposal, applyProposal:applyProposal, validateCamera:camera };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BlenderStudioContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this);