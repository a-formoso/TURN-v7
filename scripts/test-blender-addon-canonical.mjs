/*
 * Cross-language canonical JSON regression. The browser contract remains the
 * authority for hashes; this compares Python's independent serializer against
 * that exact UMD implementation for edge-case numbers and a real scene.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const contract = require(path.join(root, "app", "blender-contract.js"));
const corpus = [
  1e-7,
  1e-6,
  0,
  -0,
  1e-24,
  1e21,
  0.7,
  0.07,
  3.3333333333333335,
  { unicode: "café 🎬", exponent: 1e-7, zero: -0, fraction: 3.3333333333333335 },
  {
    version: 1,
    projectId: "_project",
    shotId: "-shot",
    sceneId: "scene_1",
    locationId: "location-1",
    label: "https://labels.example/are-text-only 🎬",
    room: { width: 3.3333333333333335, depth: 12, height: 4 },
    landmarks: [],
    actors: [],
    props: [],
    camera: {
      position: [0, -6, 1.65],
      target: [0, 0, 1.4],
      focalLength: 50,
      sensorWidth: 36,
    },
    render: { width: 640, height: 360, samples: 16 },
  },
];
const expected = corpus.map((value) => contract.canonical(value));
const python = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("cinema_machine_bridge_protocol", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
values = json.loads(sys.argv[2])
print(json.dumps([module.canonical_json(value) for value in values], ensure_ascii=False))
`;
const result = spawnSync("python3", ["-c", python, path.join(root, "blender", "cinema_machine_bridge", "protocol.py"), JSON.stringify(corpus)], {
  cwd: root,
  encoding: "utf8",
  timeout: 30000,
});
if (result.status !== 0) {
  throw new Error(result.stderr || result.stdout || "Python canonical corpus failed");
}
const actual = JSON.parse(result.stdout);
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  fs.writeFileSync("/tmp/cinema-machine-canonical-mismatch.json", JSON.stringify({ expected, actual }, null, 2));
  throw new Error("Python canonical JSON differs from the browser contract");
}
process.stdout.write(`Canonical corpus passed (${corpus.length} values)\n`);

const baseScene = corpus[corpus.length - 1];
const schemaCorpus = [
  {
    name: "diagonal distance above threshold",
    scene: { ...baseScene, camera: { ...baseScene.camera, position: [0, 0, 0], target: [0.009, 0.009, 0.009] } },
  },
  {
    name: "euclidean distance below threshold",
    scene: { ...baseScene, camera: { ...baseScene.camera, position: [0, 0, 0], target: [0.005, 0, 0] } },
  },
  {
    name: "distance exactly threshold",
    scene: { ...baseScene, camera: { ...baseScene.camera, position: [0, 0, 0], target: [0.01, 0, 0] } },
  },
  {
    name: "DEL remains valid text",
    scene: { ...baseScene, label: `text${String.fromCharCode(127)}label` },
  },
];
const javascriptAccepted = schemaCorpus.map(({ scene }) => {
  try {
    contract.validateSpec(scene);
    return true;
  } catch (_error) {
    return false;
  }
});
const expectedSchemaAcceptance = [true, false, true, true];
if (JSON.stringify(javascriptAccepted) !== JSON.stringify(expectedSchemaAcceptance)) {
  throw new Error(`Unexpected JS schema corpus result: ${JSON.stringify(javascriptAccepted)}`);
}
const schemaPython = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("cinema_machine_bridge_protocol_schema", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
values = json.loads(sys.argv[2])
accepted = []
for value in values:
    try:
        module.validate_scene(value["scene"])
        accepted.append(True)
    except Exception:
        accepted.append(False)
print(json.dumps(accepted))
`;
const schemaResult = spawnSync("python3", [
  "-c",
  schemaPython,
  path.join(root, "blender", "cinema_machine_bridge", "protocol.py"),
  JSON.stringify(schemaCorpus),
], { cwd: root, encoding: "utf8", timeout: 30000 });
if (schemaResult.status !== 0) {
  throw new Error(schemaResult.stderr || schemaResult.stdout || "Python schema corpus failed");
}
const pythonAccepted = JSON.parse(schemaResult.stdout);
if (JSON.stringify(javascriptAccepted) !== JSON.stringify(pythonAccepted)) {
  throw new Error(
    `Python/JS schema acceptance differs: JS ${JSON.stringify(javascriptAccepted)} Python ${JSON.stringify(pythonAccepted)}`,
  );
}
process.stdout.write(`Schema acceptance corpus passed (${schemaCorpus.length} cases)\n`);
