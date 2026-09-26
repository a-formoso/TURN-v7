#!/usr/bin/env node
/* Browser-client coverage for the bounded, versioned location production plan. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("app/blender-studio.js", "utf8");
const requests = [];
const scope = { projectId: "project-1", uid: "user-1" };
const box = {
  console,
  nbGetMeta: () => ({modelId:"gpt-image-2",iso:"2026-09-24T10:00:00.000Z"}),
  nbLoadImage: async () => "data:image/png;base64,AA==",
  BlenderPreview: {
    scope: () => scope,
    isCurrent: candidate => candidate === scope,
    request: async (_action, body) => {
      requests.push(body);
      return { workspace: {
        schema: "cm-studio-v1", locationId: body.location.id, revision: 1,
        context: body.location.context, shots: [], objects: [], tracks: [], references: [],
      } };
    },
  },
  BlenderStudioContract: { validateWorkspace: () => {} },
};
box.window = box;
box.globalThis = box;
vm.createContext(box);
vm.runInContext(source, box, { filename: "app/blender-studio.js" });

const plan = {
  schema: "cm-location-plan-v1",
  canonicalSet: { id: "house", name: "Father's House" },
  sharedSetLayout:{schema:"cm-spatial-layout-v1",ownerId:"house",status:"reviewed",
    anchors:[{id:"table",space:"Kitchen",placement:"In front of fridge"}]},
  screenplaySpaces: [{ key: "kitchen|int|night", name: "Kitchen", assetId: "loc-unit-kitchen" }],
  appearanceStates: [{ id: "dawn", state: "Dawn", assetId: "house-dawn" }],
  requiredSpacePlates: [{ id: "threshold", name: "Kitchen threshold", assetId: "house-threshold" }],
  coverageViews: [{ id: "principal", name: "Principal", lens: "35mm" }],
  sceneSetups: [{ id: "kitchen@scene-1#1", sceneId: "scene-1", temporaryDressing: ["eulogy pages"] }],
};
await box.BlenderStudio.open({ location: { id: "house", name: "Father's House", productionPlan: plan } });
let encoded = requests.at(-1).location.context.productionPlan;
assert.equal(typeof encoded, "string");
assert.deepEqual(JSON.parse(encoded), plan, "a normal production package reaches the relay losslessly");

const enormous = structuredClone(plan);
enormous.sceneSetups = Array.from({ length: 900 }, (_, i) => ({
  id: `room@scene-${i}#1`, sceneId: `scene-${i}`, blocking: "x".repeat(300),
  temporaryDressing: ["y".repeat(300)],
}));
await box.BlenderStudio.open({ location: { id: "house", name: "Father's House", productionPlan: enormous } });
encoded = requests.at(-1).location.context.productionPlan;
assert.ok(encoded.length <= 16000, "an oversized production package is bounded by the relay contract");
const compact = JSON.parse(encoded);
assert.equal(compact.schema, "cm-location-plan-v1");
assert.deepEqual(compact.sharedSetLayout,plan.sharedSetLayout,"compaction cannot discard physical layout");
assert.ok(compact.summary || Array.isArray(compact.sceneSetups), "the bounded fallback remains valid, useful JSON");
await box.BlenderStudio.open({location:{id:"house",name:"House",productionPlan:JSON.stringify(enormous)}});
assert.deepEqual(JSON.parse(requests.at(-1).location.context.productionPlan).sharedSetLayout,plan.sharedSetLayout);
await assert.rejects(box.BlenderStudio.open({location:{id:"house",productionPlan:{...plan,
  sharedSetLayout:{anchors:"x".repeat(18000)}}}}),/too large to send intact/);

console.log("Blender Studio location production plan tests passed.");
