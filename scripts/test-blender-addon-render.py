"""Headless Blender regression test for the editable Cinema Machine proof.

Run from the repository root with:

    blender --background --factory-startup --python scripts/test-blender-addon-render.py

The two output PNGs are test-owned temporary artifacts in /tmp.  The add-on
itself still writes only its own tempfile and removes it after each upload
payload is read.
"""

from __future__ import annotations

import os
import sys

import bpy  # type: ignore


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "blender"))

from kinolot_bridge.protocol import scene_hash, validate_actual_camera, validate_scene  # noqa: E402
from kinolot_bridge.renderer import render_preview  # noqa: E402


def proof_spec(focal_length):
    return {
        "version": 1,
        "projectId": "test-project",
        "shotId": "test-shot",
        "sceneId": "test-scene",
        "locationId": "test-location",
        "label": "Headless editable proof",
        "room": {"width": 12, "depth": 12, "height": 4},
        "landmarks": [
            {
                "id": "back-door",
                "label": "Door",
                "position": [0, 5.7, 1.2],
                "scale": [2.0, 0.2, 2.4],
            }
        ],
        "actors": [
            {"id": "actor-one", "label": "Stand-in", "position": [-2.0, 1.0, 0], "height": 1.75},
            {"id": "actor-two", "label": "Stand-in", "position": [-0.7, 1.3, 0], "height": 1.65},
            {"id": "actor-three", "label": "Stand-in", "position": [0.7, 1.7, 0], "height": 1.8},
            {"id": "actor-four", "label": "Stand-in", "position": [2.0, 2.1, 0], "height": 1.7},
        ],
        "props": [
            {
                "id": "table",
                "label": "Table",
                "position": [0, 3.0, 0.5],
                "scale": [2.0, 1.0, 1.0],
            }
        ],
        "camera": {
            "position": [0, -8, 2.4],
            "target": [0, 2.0, 1.35],
            "focalLength": focal_length,
            "sensorWidth": 36,
        },
        "render": {"width": 640, "height": 360, "samples": 16},
    }


def main():
    old_scene = bpy.context.scene
    existing_scene_count = len(bpy.data.scenes)
    bpy.ops.mesh.primitive_cube_add(location=(20, 20, 20))
    sentinel = bpy.context.object
    sentinel.name = "ExistingUserSentinel"
    sentinel.select_set(True)
    bpy.context.view_layer.objects.active = sentinel
    bpy.ops.object.mode_set(mode="EDIT")
    old_mode = bpy.context.mode
    old_selected_names = {obj.name for obj in bpy.context.selected_objects}
    old_object_count = len(old_scene.objects)
    old_sentinel_vertex_count = len(sentinel.data.vertices)
    outputs = []

    for focal_length in (35, 85):
        spec = validate_scene(proof_spec(focal_length))
        result = render_preview(spec)
        actual = validate_actual_camera(result["actualCamera"], spec)
        if abs(actual["focalLength"] - focal_length) > 0.001:
            raise AssertionError("camera focal length was not read back from Blender")
        if actual["width"] != 640 or actual["height"] != 360:
            raise AssertionError("render dimensions were not read back from Blender")
        if bpy.context.scene != old_scene:
            raise AssertionError("renderer did not restore the previous active scene")
        if sentinel.name not in old_scene.objects:
            raise AssertionError("existing sentinel object disappeared")
        if len(old_scene.objects) != old_object_count:
            raise AssertionError("renderer modified the existing scene")
        if len(sentinel.data.vertices) != old_sentinel_vertex_count:
            raise AssertionError("renderer modified the existing sentinel mesh")
        if bpy.context.view_layer.objects.active != sentinel:
            raise AssertionError("renderer did not restore the user's active object")
        if {obj.name for obj in bpy.context.selected_objects} != old_selected_names:
            raise AssertionError("renderer did not restore the user's selection")
        if bpy.context.mode != old_mode:
            raise AssertionError("renderer did not restore the user's mode")
        proof_scenes = [
            scene
            for scene in bpy.data.scenes
            if scene.get("cinemaMachineProof") is True
            and scene.get("cinemaMachineSpecHash") == scene_hash(spec)
        ]
        if not proof_scenes:
            raise AssertionError("editable proof scene was not left available")
        proof_objects = proof_scenes[-1].objects
        if len([obj for obj in proof_objects if obj.name.startswith("StandIn_") and "_" not in obj.name[8:]]) != 4:
            raise AssertionError("proof scene did not contain four neutral stand-ins")
        if not any(obj.name.startswith("Prop_01") for obj in proof_objects):
            raise AssertionError("proof scene did not contain its approved prop")
        for index, expected_x in enumerate((-2.0, -0.7, 0.7, 2.0), start=1):
            body = next(obj for obj in proof_objects if obj.name.startswith("StandIn_%02d_Body" % index))
            if abs(body.location.x - expected_x) > 0.001:
                raise AssertionError("stand-in body was mutated by the user's edit mode")
        path = "/tmp/blender-preview-%d.png" % focal_length
        with open(path, "wb") as output:
            output.write(result["pngBytes"])
        outputs.append(path)

    if len(bpy.data.scenes) != existing_scene_count + 2:
        raise AssertionError("renderer did not create one separate scene per job")
    if sentinel.name not in old_scene.objects:
        raise AssertionError("existing sentinel object was not preserved")
    print("BLENDER_ADDON_RENDER_OK", " ".join(outputs))


if __name__ == "__main__":
    main()
