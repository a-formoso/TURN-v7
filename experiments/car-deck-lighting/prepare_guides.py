"""Derive a reference outline from the same scene's saved object-ID pass."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent
ref = root / "reference"
scene_hash = hashlib.sha256((root / "scene.json").read_bytes()).hexdigest()
report = json.loads((ref / "lighting-report.json").read_text())
assert scene_hash == report["sourceSha256"], "Scene differs from lighting reference"
ids = np.array(Image.open(ref / "id_TL.png").convert("RGB")).astype(np.int16)
assert ids.shape == (360, 640, 3)
# The ID pass is dithered by +-1 per channel, so one object's flat colour varies slightly. Only a change larger
# than TOLERANCE in some channel is a boundary between objects (an exact comparison marked ~64% of pixels).
TOLERANCE = 8
edge = np.zeros(ids.shape[:2], dtype=bool)
horizontal = np.abs(ids[:, 1:] - ids[:, :-1]).max(axis=2) > TOLERANCE
vertical = np.abs(ids[1:, :] - ids[:-1, :]).max(axis=2) > TOLERANCE
edge[:, 1:] |= horizontal
edge[:, :-1] |= horizontal
edge[1:, :] |= vertical
edge[:-1, :] |= vertical
Image.fromarray(edge.astype(np.uint8) * 255).save(ref / "outline_TL.png")
names = ["matched_TL.png", "depth_TL.png", "id_TL.png", "outline_TL.png"]
files = {}
for name in names:
    path = ref / name
    with Image.open(path) as img:
        img.load()
        assert img.size == (640, 360), name
    files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
# Recorded model runs are evidence: regenerating the guides keeps them.
previous = json.loads((root / "comparison-inputs.json").read_text()) if (root / "comparison-inputs.json").exists() else {}
manifest = {
    "sceneSha256": scene_hash,
    "panel": "TL",
    "size": [640, 360],
    "files": files,
    "depthAndIdSource": "Earlier cloud technical passes from the identical saved scene and camera; independent of lighting.",
    "outlineMethod": "White boundaries between object-ID pixels whose colours differ by more than 8 in a channel (the ID pass is dithered by +-1), on black. Object boundaries only; not every mesh edge.",
    "modelInputOrder": ["matched_TL.png", "outline_TL.png", "depth_TL.png"],
    "modelRuns": previous.get("modelRuns", []),
    **({"modelRunsNote": previous["modelRunsNote"]} if "modelRunsNote" in previous else {}),
    "note": "Reference images are guidance, not an enforced depth/edge conditioning mechanism.",
}
(root / "comparison-inputs.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("Verified scene hash and four reference images; outline regenerated (%.1f%% boundary pixels)." % (100 * edge.mean()))
