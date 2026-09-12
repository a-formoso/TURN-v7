"""Main-thread Blender proof renderer.

No network operation belongs in this module.  The add-on's timer calls
``render_preview`` on Blender's main thread after the protocol worker has
validated and claimed a job.
"""

from __future__ import annotations

import base64
import math
import os
import stat
import tempfile
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple

from .protocol import (
    ProtocolError,
    canonical_json,
    encode_png,
    scene_hash,
    validate_actual_camera,
    validate_scene,
)


def _bpy():
    # Importing lazily keeps protocol-only tests usable on machines without
    # Blender and makes the main-thread boundary obvious.
    import bpy  # type: ignore

    return bpy


def _mathutils():
    from mathutils import Vector  # type: ignore

    return Vector


def _material(bpy: Any, name: str, color: Sequence[float], roughness: float = 0.72) -> Any:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    principled = nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = (*color, 1.0)
        principled.inputs["Roughness"].default_value = roughness
    return material


def _link_to_collection(obj: Any, collection: Any) -> None:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def _add_cube(
    bpy: Any,
    collection: Any,
    name: str,
    location: Sequence[float],
    dimensions: Sequence[float],
    material: Any,
) -> Any:
    half_x, half_y, half_z = (float(value) * 0.5 for value in dimensions)
    vertices = [
        (-half_x, -half_y, -half_z),
        (half_x, -half_y, -half_z),
        (half_x, half_y, -half_z),
        (-half_x, half_y, -half_z),
        (-half_x, -half_y, half_z),
        (half_x, -half_y, half_z),
        (half_x, half_y, half_z),
        (-half_x, half_y, half_z),
    ]
    faces = [
        (0, 3, 2, 1),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]
    mesh = bpy.data.meshes.new(name + " Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.location = tuple(location)
    obj.data.materials.append(material)
    return obj


def _add_cylinder(
    bpy: Any,
    collection: Any,
    name: str,
    location: Sequence[float],
    radius: float,
    depth: float,
    material: Any,
) -> Any:
    segments = 20
    vertices = []
    for z in (-depth * 0.5, depth * 0.5):
        vertices.extend(
            [
                (
                    radius * math.cos(2.0 * math.pi * index / segments),
                    radius * math.sin(2.0 * math.pi * index / segments),
                    z,
                )
                for index in range(segments)
            ]
        )
    faces = [(tuple(reversed(range(segments)))), tuple(range(segments, segments * 2))]
    faces.extend(
        (index, (index + 1) % segments, segments + (index + 1) % segments, segments + index)
        for index in range(segments)
    )
    mesh = bpy.data.meshes.new(name + " Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.location = tuple(location)
    obj.data.materials.append(material)
    return obj


def _add_uv_sphere(
    bpy: Any,
    collection: Any,
    name: str,
    location: Sequence[float],
    radius: float,
    material: Any,
) -> Any:
    segments = 20
    rings = 12
    vertices = [(0.0, 0.0, radius)]
    for ring in range(1, rings):
        theta = math.pi * ring / rings
        ring_radius = radius * math.sin(theta)
        ring_z = radius * math.cos(theta)
        vertices.extend(
            [
                (
                    ring_radius * math.cos(2.0 * math.pi * index / segments),
                    ring_radius * math.sin(2.0 * math.pi * index / segments),
                    ring_z,
                )
                for index in range(segments)
            ]
        )
    south = len(vertices)
    vertices.append((0.0, 0.0, -radius))
    faces = []
    for index in range(segments):
        faces.append((0, 1 + (index + 1) % segments, 1 + index))
    for ring in range(rings - 2):
        start = 1 + ring * segments
        next_start = start + segments
        for index in range(segments):
            next_index = (index + 1) % segments
            faces.append(
                (
                    start + index,
                    next_start + index,
                    next_start + next_index,
                    start + next_index,
                )
            )
    last = 1 + (rings - 2) * segments
    for index in range(segments):
        faces.append((last + index, last + (index + 1) % segments, south))
    mesh = bpy.data.meshes.new(name + " Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.location = tuple(location)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def _add_area_light(
    bpy: Any,
    collection: Any,
    name: str,
    location: Sequence[float],
    energy: float,
    size: float,
    color: Sequence[float],
) -> Any:
    data = bpy.data.lights.new(name + "Data", type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = tuple(color)
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = tuple(location)
    return obj


def _look_at(obj: Any, position: Sequence[float], target: Sequence[float]) -> None:
    Vector = _mathutils()
    obj.location = tuple(position)
    direction = Vector(target) - Vector(position)
    if direction.length <= 1e-9:
        raise ProtocolError("camera target must differ from camera position")
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _make_capsule(
    bpy: Any,
    collection: Any,
    number: int,
    position: Sequence[float],
    height: float,
    material: Any,
) -> Any:
    """Build a neutral capsule stand-in without using an actor's identity."""

    # Names are intentionally ordinal.  Character IDs and labels never enter
    # Blender object names, custom properties, or the image.
    root = bpy.data.objects.new("StandIn_%02d" % number, None)
    collection.objects.link(root)
    radius = min(height * 0.19, 0.35)
    cylinder_depth = max(height - (2.0 * radius), 0.05)
    x, y, z = position
    body = _add_cylinder(
        bpy,
        collection,
        "StandIn_%02d_Body" % number,
        (x, y, z + height * 0.5),
        radius,
        cylinder_depth,
        material,
    )
    lower = _add_uv_sphere(
        bpy,
        collection,
        "StandIn_%02d_Lower" % number,
        (x, y, z + radius),
        radius,
        material,
    )
    upper = _add_uv_sphere(
        bpy,
        collection,
        "StandIn_%02d_Upper" % number,
        (x, y, z + height - radius),
        radius,
        material,
    )
    for part in (body, lower, upper):
        part.parent = root
    root["cinemaMachineStandIn"] = True
    return root


def _set_render_settings(scene: Any, render_spec: Mapping[str, Any]) -> None:
    # The proof deliberately uses Cycles on CPU: this keeps the output
    # independent of a machine's GPU vendor or optional runtime packages.
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(render_spec["samples"])
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = True
    scene.render.resolution_x = int(render_spec["width"])
    scene.render.resolution_y = int(render_spec["height"])
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"


def _actual_camera(scene: Any) -> Dict[str, Any]:
    Vector = _mathutils()
    camera = scene.camera
    direction = camera.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0))
    direction.normalize()
    position = camera.matrix_world.translation
    return {
        "position": [float(value) for value in position],
        "direction": [float(value) for value in direction],
        "focalLength": float(camera.data.lens),
        "sensorWidth": float(camera.data.sensor_width),
        "width": int(scene.render.resolution_x),
        "height": int(scene.render.resolution_y),
    }


def _new_world(bpy: Any, scene: Any) -> None:
    world = bpy.data.worlds.new("CinemaMachine Proof World")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.055, 0.07, 0.09, 1.0)
        background.inputs["Strength"].default_value = 0.18
    scene.world = world


def _snapshot_user_context(bpy: Any) -> Dict[str, Any]:
    view_layer = bpy.context.view_layer
    return {
        "scene": bpy.context.scene,
        "window": getattr(bpy.context, "window", None),
        "mode": str(getattr(bpy.context, "mode", "OBJECT")),
        "active": view_layer.objects.active,
        "selected": [obj.name for obj in getattr(bpy.context, "selected_objects", [])],
    }


def _restore_user_context(bpy: Any, snapshot: Mapping[str, Any]) -> None:
    window = snapshot.get("window")
    old_scene = snapshot["scene"]
    if window is not None:
        window.scene = old_scene
    view_layer = bpy.context.view_layer
    selected = set(snapshot.get("selected", []))
    for obj in old_scene.objects:
        obj.select_set(obj.name in selected)
    active = snapshot.get("active")
    active_in_scene = active is not None and active.name in old_scene.objects
    view_layer.objects.active = active if active_in_scene else None
    old_mode = str(snapshot.get("mode", "OBJECT"))
    if old_mode != "OBJECT" and active_in_scene:
        # Blender reports EDIT_MESH/EDIT_CURVE/etc. in context.mode while the
        # operator accepts the shared EDIT enum.
        target_mode = "EDIT" if old_mode.startswith("EDIT") else old_mode.split("_", 1)[0]
        try:
            bpy.ops.object.mode_set(mode=target_mode)
        except RuntimeError:
            # A non-editable active object can only be restored as selected;
            # never leave the user's scene or selection changed.
            pass


def create_preview_scene(spec: Mapping[str, Any]) -> Tuple[Any, Any]:
    """Create and populate a new proof scene, returning ``(scene, camera)``."""

    bpy = _bpy()
    validated = validate_scene(spec)
    room = validated["room"]
    camera_spec = validated["camera"]
    scene = bpy.data.scenes.new("CinemaMachine Proof")
    # Switch the active context immediately after the unavoidable scene
    # allocation. Every operator and subsequent data API operation therefore
    # targets the new proof scene, not the user's active scene.
    window = getattr(bpy.context, "window", None)
    if window is not None:
        window.scene = scene
    geometry = bpy.data.collections.new("CinemaMachine Proof Geometry")
    scene.collection.children.link(geometry)
    _new_world(bpy, scene)

    floor_material = _material(bpy, "CM Proof Floor", (0.18, 0.2, 0.22))
    wall_material = _material(bpy, "CM Proof Walls", (0.34, 0.38, 0.43))
    landmark_material = _material(bpy, "CM Proof Landmarks", (0.78, 0.38, 0.12))
    prop_material = _material(bpy, "CM Proof Props", (0.16, 0.48, 0.66))
    standin_material = _material(bpy, "CM Proof Stand-ins", (0.7, 0.7, 0.72))

    width = float(room["width"])
    depth = float(room["depth"])
    height = float(room["height"])
    _add_cube(bpy, geometry, "ProofFloor", (0.0, 0.0, -0.06), (width, depth, 0.12), floor_material)
    _add_cube(
        bpy,
        geometry,
        "ProofBackWall",
        (0.0, depth * 0.5, height * 0.5),
        (width, 0.12, height),
        wall_material,
    )
    _add_cube(
        bpy,
        geometry,
        "ProofLeftWall",
        (-width * 0.5, 0.0, height * 0.5),
        (0.12, depth, height),
        wall_material,
    )
    _add_cube(
        bpy,
        geometry,
        "ProofRightWall",
        (width * 0.5, 0.0, height * 0.5),
        (0.12, depth, height),
        wall_material,
    )

    for index, landmark in enumerate(validated["landmarks"], start=1):
        _add_cube(
            bpy,
            geometry,
            "Landmark_%02d" % index,
            landmark["position"],
            landmark["scale"],
            landmark_material,
        )
    for index, prop in enumerate(validated["props"], start=1):
        _add_cube(
            bpy,
            geometry,
            "Prop_%02d" % index,
            prop["position"],
            prop["scale"],
            prop_material,
        )
    for index, actor in enumerate(validated["actors"], start=1):
        _make_capsule(
            bpy,
            geometry,
            index,
            actor["position"],
            float(actor["height"]),
            standin_material,
        )

    # A small, fixed lighting rig makes the proof legible while keeping all
    # source-dependent inputs limited to the approved geometry schema.
    key = _add_area_light(bpy, geometry, "ProofKey", (0.0, -2.0, height * 0.9), 850.0, 5.0, (1.0, 0.88, 0.74))
    fill = _add_area_light(bpy, geometry, "ProofFill", (-width * 0.35, -1.0, height * 0.55), 500.0, 4.0, (0.72, 0.82, 1.0))
    top = _add_area_light(bpy, geometry, "ProofTop", (0.0, depth * 0.15, height * 0.95), 400.0, 3.0, (1.0, 1.0, 1.0))
    for light in (key, fill, top):
        light.rotation_euler[0] = 0.0

    camera_data = bpy.data.cameras.new("CinemaMachine Proof Camera")
    camera = bpy.data.objects.new("CinemaMachine Proof Camera", camera_data)
    geometry.objects.link(camera)
    camera_data.type = "PERSP"
    camera_data.lens = float(camera_spec["focalLength"])
    camera_data.sensor_width = float(camera_spec["sensorWidth"])
    _look_at(camera, camera_spec["position"], camera_spec["target"])
    scene.camera = camera

    scene["cinemaMachineProof"] = True
    scene["cinemaMachineSpec"] = canonical_json(validated)
    scene["cinemaMachineSpecHash"] = scene_hash(validated)
    scene["cinemaMachineProjectId"] = validated["projectId"]
    scene["cinemaMachineShotId"] = validated["shotId"]
    return scene, camera


def render_preview(spec: Mapping[str, Any]) -> Dict[str, Any]:
    """Render one validated proof and return PNG bytes plus camera readback.

    The function creates exactly one new scene and never removes or resets an
    existing scene.  It restores the previous active scene even when Cycles
    or PNG output raises an exception.
    """

    bpy = _bpy()
    validated = validate_scene(spec)
    context_snapshot = _snapshot_user_context(bpy)
    proof_scene: Optional[Any] = None
    try:
        proof_scene, _camera = create_preview_scene(validated)
        _set_render_settings(proof_scene, validated["render"])
        # TemporaryDirectory is private (0700 by Python) and keeps the path
        # present for Blender's write_still call; there is no unlink-before-
        # render TOCTOU window and no caller-supplied output path.
        with tempfile.TemporaryDirectory(prefix="cinema_machine_proof_") as temp_dir:
            temp_path = os.path.join(temp_dir, "preview.png")
            proof_scene.render.filepath = temp_path
            if getattr(bpy.context, "window", None) is not None:
                bpy.ops.render.render(write_still=True)
            else:
                # Background Blender has no Window. A temporary operator
                # context keeps this render on the proof scene.
                with bpy.context.temp_override(
                    scene=proof_scene,
                    view_layer=proof_scene.view_layers[0],
                ):
                    bpy.ops.render.render(write_still=True)
            info = os.stat(temp_path, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode) or info.st_size <= 0:
                raise ProtocolError("Blender did not produce a regular PNG tempfile")
            with open(temp_path, "rb") as output:
                png_bytes = output.read()
            actual_camera = _actual_camera(proof_scene)
            actual_camera = validate_actual_camera(actual_camera, validated)
            encoded = encode_png(
                png_bytes,
                int(validated["render"]["width"]),
                int(validated["render"]["height"]),
            )
            return {
                "sceneName": proof_scene.name,
                "pngBytes": png_bytes,
                "pngBase64": encoded,
                "actualCamera": actual_camera,
                "specHash": scene_hash(validated),
            }
    finally:
        _restore_user_context(bpy, context_snapshot)
