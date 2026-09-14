import "./studio-contract.js";
const contract = globalThis.BlenderStudioContract;
// The deploy-side mirror is compacted, so keep this small data-only helper in
// the ESM wrapper as well.  It intentionally has no Blender/Python execution
// surface and leaves revision ownership to workspace.save CAS.
if (typeof contract.applyProposal !== "function") {
  contract.applyProposal = (workspace, proposal) => {
    contract.validateWorkspace(workspace);
    contract.validateProposal(proposal, workspace);
    const next = structuredClone(workspace);
    for (const op of proposal.ops) {
      let shot;
      const objects = op.scope === "set" ? next.objects :
        op.scope === "shot" ? (shot = next.shots.find(item => item.id === op.shotId)).objects : null;
      if (op.op === "upsert_object") {
        const index = objects.findIndex(item => item.id === op.object.id);
        if (index < 0) objects.push(structuredClone(op.object));
        else objects[index] = structuredClone(op.object);
      } else if (op.op === "remove_object") {
        const index = objects.findIndex(item => item.id === op.objectId);
        if (index >= 0) objects.splice(index, 1);
      } else if (op.op === "set_camera") {
        next.shots.find(item => item.id === op.shotId).camera = structuredClone(op.camera);
      } else if (op.op === "set_tracks") {
        shot = next.shots.find(item => item.id === op.shotId);
        shot.tracks = structuredClone(op.tracks);
        shot.frameStart = op.frameStart; shot.frameEnd = op.frameEnd; shot.fps = op.fps;
      }
    }
    contract.validateWorkspace(next);
    return next;
  };
}
export default contract;