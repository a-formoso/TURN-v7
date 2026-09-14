"""Headless regression test for local Cinema Machine Studio operations.

Run from the repository root with:

    blender --background --factory-startup --python scripts/test-blender-studio-native.py

The test intentionally exercises Blender's native GLB exporter/importer.  No
network transport, browser, or generated prompt is involved.
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
import time

import bpy  # type: ignore


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "blender"))

from cinema_machine_bridge import studio_scene  # noqa: E402
from cinema_machine_bridge.studio_runtime import StudioRuntime  # noqa: E402


def _remove_objects(objects):
    for object_ in objects:
        if object_.name in bpy.data.objects:
            bpy.data.objects.remove(object_, do_unlink=True)


def _write_rigged_animated_glb(filepath):
    """Create a real skinned, animated GLB using Blender's native exporter."""

    if not hasattr(bpy.ops.export_scene, "gltf"):
        raise AssertionError("Blender GLTF exporter is unavailable")
    before = {object_.as_pointer() for object_ in bpy.data.objects}
    selected_before = tuple(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.object.armature_add(enter_editmode=True, location=(40.0, 40.0, 0.0))
    armature = bpy.context.object
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.mesh.primitive_cube_add(location=(40.0, 40.0, 1.0))
    mesh = bpy.context.object
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    pose_bone = armature.pose.bones[0]
    pose_bone.rotation_mode = "XYZ"
    pose_bone.rotation_euler = (0.0, 0.0, 0.0)
    pose_bone.keyframe_insert(data_path="rotation_euler", frame=1)
    pose_bone.rotation_euler = (0.0, 0.0, 0.5)
    pose_bone.keyframe_insert(data_path="rotation_euler", frame=12)
    bpy.context.scene.frame_set(1)
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_frame_range=True,
    )
    source_objects = [
        object_ for object_ in bpy.data.objects if object_.as_pointer() not in before
    ]
    _remove_objects(source_objects)
    for object_ in bpy.context.scene.objects:
        object_.select_set(object_ in selected_before)
    bpy.context.view_layer.objects.active = active_before


def _assert_paid_ai_is_nonspending_when_billing_is_disabled():
    """A capability denial must stop paid requests before worker transport."""

    class NonspendingBridge:
        def __init__(self):
            self.lock = threading.RLock()
            self.network_lock = threading.Lock()
            self.client = object()
            self.project_id = "native_test_project"
            self.generation = 1

        def _current(self, generation):
            return generation == self.generation

    runtime = StudioRuntime(NonspendingBridge())
    runtime.capabilities = {"billingReady": False}
    runtime.request_assistant(
        "scene", "configured-unverified-model", "Do not submit this",
        {}, acknowledge_cost=True,
    )
    expected = "Paid AI is disabled pending approval of the atomic credit update"
    if runtime.snapshot()["detail"] != expected or not runtime.events.empty():
        raise AssertionError("disabled paid assistant request attempted transport")
    runtime.request_mesh(
        "configured-unverified-mesh", "Do not submit this",
        acknowledge_cost=True,
    )
    if runtime.snapshot()["detail"] != expected or not runtime.events.empty():
        raise AssertionError("disabled paid mesh request attempted transport")


def _assert_settlement_pending_retries_same_task(workspace):
    """Settlement refreshes are task reads, never a new cost-approved submit."""

    pending = {
        "id": "settlement_task", "status": "settlement_pending",
        "modelId": "configured-unverified-model", "locationId": workspace["locationId"],
        "message": "Provider result is awaiting credit settlement.",
    }
    completed = dict(pending, status="completed", message="Credit settlement completed.")

    class FakeClient:
        def __init__(self):
            self.actions = []

        def post(self, action, **fields):
            self.actions.append((action, fields))
            if action != "studio.assistant.get" or fields.get("taskId") != pending["id"]:
                raise AssertionError("settlement retry made an unexpected network request")
            return {"task": completed}

    class FakeBridge:
        def __init__(self):
            self.lock = threading.RLock()
            self.network_lock = threading.Lock()
            self.client = FakeClient()
            self.project_id = workspace["projectId"]
            self.generation = 1

        def _current(self, generation):
            return generation == self.generation

    bridge = FakeBridge()
    runtime = StudioRuntime(bridge)
    runtime.workspace = workspace
    generation = runtime.generation
    runtime.events.put({
        "kind": "task", "scopeGeneration": generation, "bridgeGeneration": bridge.generation,
        "response": {"task": pending},
    })
    runtime.pump()
    if runtime.snapshot()["task"]["status"] != "settlement_pending" or runtime.proposal is not None:
        raise AssertionError("settlement-pending task was not safely retained without a proposal")
    runtime.request_task()
    deadline = time.time() + 1.0
    while runtime.events.empty() and time.time() < deadline:
        time.sleep(.005)
    runtime.pump()
    state = runtime.snapshot()
    if state["task"]["id"] != pending["id"] or state["task"]["status"] != "completed":
        raise AssertionError("settlement retry did not complete the same task")
    if runtime.generation != generation or [item[0] for item in bridge.client.actions] != ["studio.assistant.get"]:
        raise AssertionError("settlement retry created a new generation or generation submission")
    runtime.task = pending
    runtime.request_cancel_task()
    if len(bridge.client.actions) != 1:
        raise AssertionError("settlement-pending task was incorrectly cancellable")


def main():
    _assert_paid_ai_is_nonspending_when_billing_is_disabled()
    scene = bpy.context.scene
    bpy.ops.mesh.primitive_cube_add(location=(20.0, 20.0, 20.0))
    sentinel = bpy.context.object
    sentinel.name = "ExistingUserSentinel"
    sentinel.select_set(True)
    bpy.context.view_layer.objects.active = sentinel
    selected_before = {object_.as_pointer() for object_ in bpy.context.selected_objects}
    original_camera = scene.camera
    original_objects = {object_.as_pointer() for object_ in scene.objects}

    office = studio_scene.create_location_set(
        scene,
        "Office",
        location_id="office_set",
        dimensions=(10.0, 8.0, 3.2),
    )
    repeated = studio_scene.create_location_set(scene, "Ignored replacement", location_id="office_set")
    if repeated.collection != office.collection:
        raise AssertionError("location set creation was not idempotent")
    alley = studio_scene.create_location_set(scene, "Alley", location_id="alley_set")
    if len(studio_scene.location_sets(scene)) != 2:
        raise AssertionError("location sets were not independently retained")

    prop = studio_scene.add_primitive(
        office.location_id,
        "box",
        "Desk",
        position=(0.0, 1.0, 0.5),
        dimensions=(2.0, 1.0, 1.0),
    )
    if prop.get(studio_scene.STUDIO_KIND_KEY) != "box":
        raise AssertionError("editable primitive was not tagged")
    camera_a = studio_scene.add_shot_camera(
        scene, office.location_id, "Wide", shot_id="office_wide"
    )
    camera_b = studio_scene.add_shot_camera(
        scene,
        office.location_id,
        "Close",
        position=(2.0, -5.0, 1.7),
        target=(0.0, 1.0, 1.25),
        shot_id="office_close",
    )
    if camera_a.get(studio_scene.STUDIO_LOCATION_KEY) != office.location_id:
        raise AssertionError("shot camera did not retain its shared location set")
    if camera_a == camera_b or scene.camera != original_camera:
        raise AssertionError("creating a shot unexpectedly changed the active camera")
    studio_scene.activate_shot_camera(scene, camera_b)
    if scene.camera != camera_b:
        raise AssertionError("explicit shot activation failed")

    blocker = studio_scene.add_blocking_character(
        office.location_id, "Performer", position=(-1.0, 0.0, 0.0)
    )
    studio_scene.keyframe_blocking_transform(blocker, 1, position=(-1.0, 0.0, 0.0))
    studio_scene.keyframe_blocking_transform(
        blocker, 24, position=(1.0, 2.0, 0.0), rotation_degrees=(0.0, 0.0, 45.0)
    )
    if blocker.animation_data is None or blocker.animation_data.action is None:
        raise AssertionError("blocking transform did not create an action")
    fcurves = blocker.animation_data.action.fcurves
    if not any(curve.data_path == "location" for curve in fcurves):
        raise AssertionError("blocking location was not keyframed")
    if not any(curve.data_path == "rotation_euler" for curve in fcurves):
        raise AssertionError("blocking rotation was not keyframed")

    with tempfile.TemporaryDirectory(prefix="cm-studio-glb-") as directory:
        filepath = os.path.join(directory, "animated-character.glb")
        _write_rigged_animated_glb(filepath)
        imported = studio_scene.import_glb_character(
            scene, alley.location_id, filepath, label="Imported Performer"
        )
    if not imported["rigged"] or imported["armatureCount"] < 1:
        raise AssertionError("rigged GLB import lost its armature")
    if not imported["hasAnimation"] or imported["animatedObjectCount"] < 1:
        raise AssertionError("animated GLB import lost its animation")
    if imported["root"].get(studio_scene.STUDIO_LOCATION_KEY) != alley.location_id:
        raise AssertionError("imported character did not retain its location set")

    if sentinel.as_pointer() not in {object_.as_pointer() for object_ in scene.objects}:
        raise AssertionError("Studio changed an existing user object")
    if not original_objects.issubset({object_.as_pointer() for object_ in scene.objects}):
        raise AssertionError("Studio removed an existing scene object")
    if {object_.as_pointer() for object_ in bpy.context.selected_objects} != selected_before:
        raise AssertionError("Studio import did not restore user selection")

    workspace = {
        "schema": "cm-studio-v1",
        "projectId": "test_project",
        "locationId": "reception",
        "name": "Reception",
        "parentLocationId": None,
        "rootLocationId": "reception",
        "revision": 4,
        "context": {"description": "", "architecture": "", "materials": "", "staging": ""},
        "objects": [
            {
                "id": "desk", "name": "Desk", "kind": "box",
                "position": [0.0, 1.0, 0.5], "rotation": [0.0, 0.0, 0.0],
                "scale": [2.0, 1.0, 1.0], "color": [0.2, 0.3, 0.4],
            }
        ],
        "shots": [
            {
                "id": "wide", "sceneId": "scene_one", "name": "Wide",
                "camera": {"position": [0.0, -7.0, 2.0], "target": [0.0, 1.0, 1.0], "focalLength": 40.0, "sensorWidth": 36.0},
                "objects": [
                    {
                        "id": "actor_one", "name": "Blocking actor", "kind": "actor",
                        "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0],
                        "scale": [1.0, 1.0, 1.7], "color": [0.7, 0.7, 0.7],
                    }
                ],
                "tracks": [], "frameStart": 1, "frameEnd": 120, "fps": 24,
            }
        ],
        "references": [], "assets": [], "previews": [],
    }
    _assert_settlement_pending_retries_same_task(workspace)
    root = studio_scene.open_workspace(scene, workspace)
    if studio_scene.open_workspace(scene, workspace) != root:
        raise AssertionError("workspace reopening recreated its reusable environment")
    workspace_camera = studio_scene.activate_workspace_shot(scene, workspace, "wide")
    if scene.camera != workspace_camera or scene.frame_start != 1 or scene.frame_end != 120 or scene.render.fps != 24:
        raise AssertionError("explicit workspace shot activation did not set camera/timeline")
    captured = studio_scene.workspace_snapshot(scene, workspace)
    if captured["objects"][0]["scale"] != [2.0, 1.0, 1.0]:
        raise AssertionError("workspace snapshot lost managed object scale")
    proposal = {
        "summary": "Move the actor and set a short blocking beat.",
        "ops": [
            {
                "op": "upsert_object", "scope": "shot", "shotId": "wide",
                "object": {
                    "id": "actor_one", "name": "Blocking actor", "kind": "actor",
                    "position": [1.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.7], "color": [0.7, 0.7, 0.7],
                },
            },
            {
                "op": "set_tracks", "shotId": "wide", "frameStart": 1, "frameEnd": 24, "fps": 24,
                "tracks": [
                    {"objectId": "actor_one", "property": "position", "keyframes": [
                        {"frame": 1, "value": [1.0, 0.0, 0.0]},
                        {"frame": 24, "value": [2.0, 0.0, 0.0]},
                    ]}
                ],
            },
        ],
    }
    updated = studio_scene.apply_proposal(scene, captured, proposal)
    track = updated["shots"][0]["tracks"][0]
    if track["keyframes"][-1]["value"] != [2.0, 0.0, 0.0]:
        raise AssertionError("reviewed typed proposal did not create real keyframes")
    print("BLENDER_STUDIO_NATIVE_OK", office.location_id, alley.location_id)


if __name__ == "__main__":
    main()