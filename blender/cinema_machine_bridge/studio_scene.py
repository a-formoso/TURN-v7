"""Local, typed scene-building operations for Kinolot Studio.

This module intentionally has no HTTP client and does not interpret prompts.
It is the main-thread-only half of Studio: callers choose one of the bounded
operations below after an approved UI action.  Every operation appends tagged
data to a dedicated Studio collection; it never clears, renames, or replaces a
user scene, object, material, camera, or action.

Location sets are Blender collections, so one assembled location can be shared
by as many tagged shot cameras and blocking characters as a production needs.
GLB import is deliberately a local file-picker operation.  It preserves an
asset's armatures, actions, and NLA strips when the GLTF importer provides
them; this add-on never invents a walking animation for an unrigged asset.
"""

from __future__ import annotations

import math
import os
import re
import uuid
import copy
import json
import base64
import tempfile
from dataclasses import dataclass
from typing import Any, Dict, Optional, Sequence, Tuple


STUDIO_ROOT_KEY = "cinemaMachineStudioRoot"
STUDIO_LOCATION_KEY = "cinemaMachineStudioLocationId"
STUDIO_KIND_KEY = "cinemaMachineStudioKind"
STUDIO_SHOT_KEY = "cinemaMachineStudioShotId"
STUDIO_CHARACTER_KEY = "cinemaMachineStudioCharacter"
STUDIO_SOURCE_KEY = "cinemaMachineStudioSource"
STUDIO_PROJECT_KEY = "cinemaMachineStudioProjectId"
STUDIO_OBJECT_KEY = "cinemaMachineStudioObjectId"
STUDIO_SCOPE_KEY = "cinemaMachineStudioScope"
STUDIO_DOCUMENT_KEY = "cinemaMachineStudioDocument"
MAX_GLB_BYTES = 512 * 1024 * 1024
_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class StudioSceneError(ValueError):
    """A user-visible rejection of an unsafe or unsupported Studio operation."""


@dataclass(frozen=True)
class LocationSet:
    """A tagged, reusable Studio location collection."""

    location_id: str
    label: str
    collection: Any


def _bpy() -> Any:
    import bpy  # type: ignore

    return bpy


def _vector() -> Any:
    from mathutils import Vector  # type: ignore

    return Vector


def _identifier(value: Optional[str], prefix: str) -> str:
    if value is None:
        return prefix + "_" + uuid.uuid4().hex[:16]
    if not isinstance(value, str) or not _IDENTIFIER_RE.fullmatch(value):
        raise StudioSceneError("Studio IDs must use 1-64 letters, digits, hyphens, or underscores")
    return value


def _label(value: str, where: str = "Label") -> str:
    if not isinstance(value, str):
        raise StudioSceneError(where + " must be text")
    result = value.strip()
    if not result or len(result) > 120 or any(ord(character) < 32 for character in result):
        raise StudioSceneError(where + " must contain 1-120 printable characters")
    return result


def _number(value: Any, where: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise StudioSceneError(where + " must be a number")
    result = float(value)
    if not math.isfinite(result) or result < low or result > high:
        raise StudioSceneError("%s must be between %g and %g" % (where, low, high))
    return result


def _position(value: Sequence[float], where: str = "Position") -> Tuple[float, float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise StudioSceneError(where + " must have exactly three numbers")
    return tuple(_number(item, where, -1000.0, 1000.0) for item in value)  # type: ignore[return-value]


def _dimensions(value: Sequence[float]) -> Tuple[float, float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise StudioSceneError("Dimensions must have exactly three numbers")
    return tuple(_number(item, "Dimension", 0.05, 200.0) for item in value)  # type: ignore[return-value]


def _collection_in_scene(scene: Any, collection: Any) -> bool:
    """Return whether a collection is reachable from a scene's root."""

    if collection == scene.collection:
        return True
    pending = list(scene.collection.children)
    seen = set()
    while pending:
        current = pending.pop()
        pointer = current.as_pointer()
        if pointer in seen:
            continue
        seen.add(pointer)
        if current == collection:
            return True
        pending.extend(current.children)
    return False


def _studio_root(scene: Any) -> Any:
    bpy = _bpy()
    for child in scene.collection.children:
        if child.get(STUDIO_ROOT_KEY) is True:
            return child
    # found again by STUDIO_ROOT_KEY, never by name, so a scene saved while the
    # product was called Cinema Machine keeps working with its old collection name
    root = bpy.data.collections.new("Kinolot Studio")
    root[STUDIO_ROOT_KEY] = True
    scene.collection.children.link(root)
    return root


def _workspace_root(scene: Any, project_id: str, location_id: str, create: bool = False) -> Optional[Any]:
    """Find one stable managed collection for a project/location pair."""

    bpy = _bpy()
    for collection in bpy.data.collections:
        if (
            collection.get(STUDIO_ROOT_KEY) is True
            and collection.get(STUDIO_PROJECT_KEY) == project_id
            and collection.get(STUDIO_LOCATION_KEY) == location_id
        ):
            if not _collection_in_scene(scene, collection):
                scene.collection.children.link(collection)
            return collection
    if not create:
        return None
    root = bpy.data.collections.new("Kinolot Studio — " + location_id)
    root[STUDIO_ROOT_KEY] = True
    root[STUDIO_PROJECT_KEY] = project_id
    root[STUDIO_LOCATION_KEY] = location_id
    scene.collection.children.link(root)
    environment = bpy.data.collections.new("Environment")
    environment[STUDIO_SCOPE_KEY] = "set"
    shots = bpy.data.collections.new("Shots")
    shots[STUDIO_SCOPE_KEY] = "shots"
    root.children.link(environment)
    root.children.link(shots)
    return root


def _find_location(location_id: str) -> Optional[Any]:
    bpy = _bpy()
    for collection in bpy.data.collections:
        if collection.get(STUDIO_LOCATION_KEY) == location_id:
            return collection
    return None


def _require_location(location_id: str) -> LocationSet:
    safe_id = _identifier(location_id, "location")
    collection = _find_location(safe_id)
    if collection is None:
        raise StudioSceneError("The selected location set no longer exists")
    label = str(collection.get("cinemaMachineStudioLabel", collection.name))[:120]
    return LocationSet(safe_id, label, collection)


def _restore_selection(scene: Any, selected: Sequence[Any], active: Any) -> None:
    """Restore selection after an importer changes Blender's UI context."""

    selected_pointers = {object_.as_pointer() for object_ in selected}
    for object_ in scene.objects:
        object_.select_set(object_.as_pointer() in selected_pointers)
    scene.view_layers[0].objects.active = active if active in scene.objects[:] else None


def create_location_set(
    scene: Any,
    label: str,
    *,
    location_id: Optional[str] = None,
    dimensions: Sequence[float] = (12.0, 12.0, 4.0),
) -> LocationSet:
    """Append a reusable location collection and its editable room shell.

    Supplying an existing ``location_id`` returns the existing set unchanged.
    This idempotence makes a later approved request safe to reconcile without
    overwriting hand edits made in Blender.
    """

    bpy = _bpy()
    safe_label = _label(label, "Location name")
    safe_id = _identifier(location_id, "location")
    width, depth, height = _dimensions(dimensions)
    existing = _find_location(safe_id)
    if existing is not None:
        if not _collection_in_scene(scene, existing):
            _studio_root(scene).children.link(existing)
        return LocationSet(safe_id, str(existing.get("cinemaMachineStudioLabel", existing.name)), existing)

    root = _studio_root(scene)
    collection = bpy.data.collections.new("Kinolot Location — " + safe_label)
    collection[STUDIO_LOCATION_KEY] = safe_id
    collection["cinemaMachineStudioLabel"] = safe_label
    collection[STUDIO_KIND_KEY] = "location_set"
    root.children.link(collection)
    material = _new_material("Kinolot Studio Room")
    _add_box(collection, "Kinolot Floor — " + safe_label, (0.0, 0.0, -0.06), (width, depth, 0.12), material, "floor")
    _add_box(
        collection,
        "Kinolot Back Wall — " + safe_label,
        (0.0, depth * 0.5, height * 0.5),
        (width, 0.12, height),
        material,
        "wall",
    )
    _add_box(
        collection,
        "Kinolot Left Wall — " + safe_label,
        (-width * 0.5, 0.0, height * 0.5),
        (0.12, depth, height),
        material,
        "wall",
    )
    _add_box(
        collection,
        "Kinolot Right Wall — " + safe_label,
        (width * 0.5, 0.0, height * 0.5),
        (0.12, depth, height),
        material,
        "wall",
    )
    return LocationSet(safe_id, safe_label, collection)


def location_sets(scene: Any) -> Tuple[LocationSet, ...]:
    """Return Studio location sets currently linked to ``scene``."""

    result = []
    for collection in _studio_root(scene).children:
        location_id = collection.get(STUDIO_LOCATION_KEY)
        if isinstance(location_id, str) and _IDENTIFIER_RE.fullmatch(location_id):
            result.append(
                LocationSet(
                    location_id,
                    str(collection.get("cinemaMachineStudioLabel", collection.name))[:120],
                    collection,
                )
            )
    return tuple(result)


def add_primitive(
    location_id: str,
    primitive: str,
    label: str,
    *,
    position: Sequence[float] = (0.0, 0.0, 0.0),
    dimensions: Sequence[float] = (1.0, 1.0, 1.0),
) -> Any:
    """Append one editable bounded primitive to a location set."""

    location = _require_location(location_id)
    safe_label = _label(label)
    safe_position = _position(position)
    safe_dimensions = _dimensions(dimensions)
    if primitive not in {"box", "cylinder", "marker"}:
        raise StudioSceneError("Primitive must be box, cylinder, or marker")
    material = _new_material("Kinolot Studio Prop")
    if primitive == "box":
        return _add_box(location.collection, "Kinolot Prop — " + safe_label, safe_position, safe_dimensions, material, primitive)
    radius = max(safe_dimensions[0], safe_dimensions[1]) * 0.5
    return _add_cylinder(
        location.collection,
        "Kinolot %s — %s" % (primitive.title(), safe_label),
        safe_position,
        radius,
        safe_dimensions[2],
        material,
        primitive,
    )


def add_shot_camera(
    scene: Any,
    location_id: str,
    label: str,
    *,
    position: Sequence[float] = (0.0, -8.0, 2.4),
    target: Sequence[float] = (0.0, 0.0, 1.35),
    focal_length: float = 50.0,
    shot_id: Optional[str] = None,
) -> Any:
    """Append a tagged shot camera without changing the user's active camera."""

    bpy = _bpy()
    location = _require_location(location_id)
    safe_label = _label(label, "Shot name")
    safe_position = _position(position, "Camera position")
    safe_target = _position(target, "Camera target")
    if math.dist(safe_position, safe_target) < 0.01:
        raise StudioSceneError("Camera target must differ from its position")
    lens = _number(focal_length, "Focal length", 8.0, 200.0)
    safe_shot_id = _identifier(shot_id, "shot")
    data = bpy.data.cameras.new("Kinolot Shot Camera Data — " + safe_label)
    data.type = "PERSP"
    data.lens = lens
    data.sensor_width = 36.0
    camera = bpy.data.objects.new("Kinolot Shot — " + safe_label, data)
    _studio_root(scene).objects.link(camera)
    camera[STUDIO_KIND_KEY] = "shot_camera"
    camera[STUDIO_LOCATION_KEY] = location.location_id
    camera[STUDIO_SHOT_KEY] = safe_shot_id
    camera["cinemaMachineStudioLabel"] = safe_label
    _look_at(camera, safe_position, safe_target)
    return camera


def activate_shot_camera(scene: Any, camera: Any) -> None:
    """Make one Studio shot camera active after an explicit user action."""

    if camera is None or camera.type != "CAMERA" or camera.get(STUDIO_KIND_KEY) != "shot_camera":
        raise StudioSceneError("Select a Kinolot Studio shot camera")
    if camera not in scene.objects[:]:
        raise StudioSceneError("The selected shot camera is not in this scene")
    scene.camera = camera


def add_blocking_character(
    location_id: str,
    label: str,
    *,
    position: Sequence[float] = (0.0, 0.0, 0.0),
    height: float = 1.75,
) -> Any:
    """Append a simple unrigged blocking stand-in with a transform root."""

    bpy = _bpy()
    location = _require_location(location_id)
    safe_label = _label(label, "Character name")
    safe_position = _position(position)
    safe_height = _number(height, "Character height", 0.5, 3.0)
    root = bpy.data.objects.new("Kinolot Character — " + safe_label, None)
    location.collection.objects.link(root)
    root.location = safe_position
    root[STUDIO_KIND_KEY] = "blocking_character"
    root[STUDIO_LOCATION_KEY] = location.location_id
    root[STUDIO_CHARACTER_KEY] = True
    root["cinemaMachineStudioLabel"] = safe_label
    root["cinemaMachineStudioRigged"] = False
    material = _new_material("Kinolot Studio Character")
    radius = min(safe_height * 0.19, 0.35)
    body = _add_cylinder(
        location.collection,
        "Kinolot Character Body — " + safe_label,
        (0.0, 0.0, safe_height * 0.5),
        radius,
        max(0.05, safe_height - 2.0 * radius),
        material,
        "character_body",
    )
    head = _add_octahedron(
        location.collection,
        "Kinolot Character Head — " + safe_label,
        (0.0, 0.0, safe_height - radius),
        radius,
        material,
        "character_head",
    )
    for part in (body, head):
        part.parent = root
        part.matrix_parent_inverse = root.matrix_world.inverted()
    return root


def keyframe_blocking_transform(
    character: Any,
    frame: int,
    *,
    position: Optional[Sequence[float]] = None,
    rotation_degrees: Optional[Sequence[float]] = None,
) -> Any:
    """Set and keyframe an actual blocking transform on a Studio character.

    This creates location/rotation F-curves only.  It does not purport to
    create skeletal walking or other character performance on an unrigged
    stand-in.
    """

    if character is None or character.get(STUDIO_CHARACTER_KEY) is not True:
        raise StudioSceneError("Select a Kinolot Studio blocking character")
    if isinstance(frame, bool) or not isinstance(frame, int) or frame < 0 or frame > 100000:
        raise StudioSceneError("Frame must be an integer between 0 and 100000")
    if position is not None:
        character.location = _position(position)
        character.keyframe_insert(data_path="location", frame=frame)
    if rotation_degrees is not None:
        degrees = _position(rotation_degrees, "Rotation")
        if any(value < -360.0 or value > 360.0 for value in degrees):
            raise StudioSceneError("Rotation values must be between -360 and 360 degrees")
        character.rotation_mode = "XYZ"
        character.rotation_euler = tuple(math.radians(value) for value in degrees)
        character.keyframe_insert(data_path="rotation_euler", frame=frame)
    if position is None and rotation_degrees is None:
        raise StudioSceneError("Choose a position or rotation to keyframe")
    return character


def import_glb_character(
    scene: Any,
    location_id: str,
    filepath: str,
    *,
    label: Optional[str] = None,
) -> Dict[str, Any]:
    """Import a user-selected local GLB/GLTF as a Studio character.

    Blender's native importer performs the format parsing.  The function moves
    only objects created by that import into the selected location collection,
    retaining armature data, animation actions, and NLA tracks as supplied by
    the file.
    """

    bpy = _bpy()
    location = _require_location(location_id)
    if bpy.context.scene != scene:
        raise StudioSceneError("Activate the target scene before importing a character")
    if not isinstance(filepath, str) or not filepath:
        raise StudioSceneError("Choose a local GLB or GLTF file")
    resolved = os.path.abspath(os.path.expanduser(filepath))
    extension = os.path.splitext(resolved)[1].lower()
    if extension not in {".glb", ".gltf"}:
        raise StudioSceneError("Character import accepts only .glb or .gltf files")
    try:
        size = os.path.getsize(resolved)
    except OSError as exc:
        raise StudioSceneError("The selected character file cannot be read") from exc
    if size <= 0 or size > MAX_GLB_BYTES:
        raise StudioSceneError("Character file must be between 1 byte and 512 MB")
    before = {object_.as_pointer() for object_ in bpy.data.objects}
    selected_before = tuple(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active
    try:
        result = bpy.ops.import_scene.gltf(filepath=resolved)
    except (RuntimeError, TypeError) as exc:
        _restore_selection(scene, selected_before, active_before)
        raise StudioSceneError("Blender could not import the selected GLB/GLTF") from exc
    if "FINISHED" not in result:
        _restore_selection(scene, selected_before, active_before)
        raise StudioSceneError("Blender did not finish importing the selected GLB/GLTF")
    imported = [object_ for object_ in bpy.data.objects if object_.as_pointer() not in before]
    if not imported:
        _restore_selection(scene, selected_before, active_before)
        raise StudioSceneError("The selected GLB/GLTF did not create any objects")
    display_label = _label(label or os.path.splitext(os.path.basename(resolved))[0], "Character name")
    root = bpy.data.objects.new("Kinolot Imported Character — " + display_label, None)
    location.collection.objects.link(root)
    root[STUDIO_KIND_KEY] = "imported_character"
    root[STUDIO_LOCATION_KEY] = location.location_id
    root[STUDIO_CHARACTER_KEY] = True
    root[STUDIO_SOURCE_KEY] = "local_glb"
    root["cinemaMachineStudioLabel"] = display_label
    for object_ in imported:
        for collection in tuple(object_.users_collection):
            collection.objects.unlink(object_)
        location.collection.objects.link(object_)
    imported_pointers = {object_.as_pointer() for object_ in imported}
    roots = [
        object_
        for object_ in imported
        if object_.parent is None or object_.parent.as_pointer() not in imported_pointers
    ]
    for object_ in roots:
        object_.parent = root
        object_.matrix_parent_inverse = root.matrix_world.inverted()
    armatures = [object_ for object_ in imported if object_.type == "ARMATURE"]
    animated = [
        object_
        for object_ in imported
        if object_.animation_data is not None
        and (
            object_.animation_data.action is not None
            or len(object_.animation_data.nla_tracks) > 0
        )
    ]
    root["cinemaMachineStudioRigged"] = bool(armatures)
    root["cinemaMachineStudioHasAnimation"] = bool(animated)
    _restore_selection(scene, selected_before, active_before)
    return {
        "root": root,
        "objectCount": len(imported),
        "armatureCount": len(armatures),
        "animatedObjectCount": len(animated),
        "rigged": bool(armatures),
        "hasAnimation": bool(animated),
    }


def _new_material(base_name: str) -> Any:
    bpy = _bpy()
    material = bpy.data.materials.new(base_name)
    material.diffuse_color = (0.24, 0.47, 0.72, 1.0)
    return material


def _tag(object_: Any, kind: str) -> None:
    object_[STUDIO_KIND_KEY] = kind


def _add_box(
    collection: Any,
    name: str,
    location: Sequence[float],
    dimensions: Sequence[float],
    material: Any,
    kind: str,
) -> Any:
    bpy = _bpy()
    half_x, half_y, half_z = (float(value) * 0.5 for value in dimensions)
    vertices = [
        (-half_x, -half_y, -half_z), (half_x, -half_y, -half_z),
        (half_x, half_y, -half_z), (-half_x, half_y, -half_z),
        (-half_x, -half_y, half_z), (half_x, -half_y, half_z),
        (half_x, half_y, half_z), (-half_x, half_y, half_z),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 7, 6, 2)]
    mesh = bpy.data.meshes.new(name + " Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    object_ = bpy.data.objects.new(name, mesh)
    collection.objects.link(object_)
    object_.location = location
    mesh.materials.append(material)
    _tag(object_, kind)
    return object_


def _add_cylinder(
    collection: Any,
    name: str,
    location: Sequence[float],
    radius: float,
    depth: float,
    material: Any,
    kind: str,
) -> Any:
    bpy = _bpy()
    segments = 16
    vertices = []
    for z in (-depth * 0.5, depth * 0.5):
        vertices.extend(
            (
                radius * math.cos(2.0 * math.pi * index / segments),
                radius * math.sin(2.0 * math.pi * index / segments),
                z,
            )
            for index in range(segments)
        )
    faces = [tuple(reversed(range(segments))), tuple(range(segments, segments * 2))]
    faces.extend(
        (index, (index + 1) % segments, segments + (index + 1) % segments, segments + index)
        for index in range(segments)
    )
    mesh = bpy.data.meshes.new(name + " Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    object_ = bpy.data.objects.new(name, mesh)
    collection.objects.link(object_)
    object_.location = location
    mesh.materials.append(material)
    _tag(object_, kind)
    return object_


def _add_octahedron(
    collection: Any,
    name: str,
    location: Sequence[float],
    radius: float,
    material: Any,
    kind: str,
) -> Any:
    bpy = _bpy()
    vertices = [(radius, 0, 0), (-radius, 0, 0), (0, radius, 0), (0, -radius, 0), (0, 0, radius), (0, 0, -radius)]
    faces = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    mesh = bpy.data.meshes.new(name + " Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    object_ = bpy.data.objects.new(name, mesh)
    collection.objects.link(object_)
    object_.location = location
    mesh.materials.append(material)
    _tag(object_, kind)
    return object_


def _look_at(object_: Any, position: Sequence[float], target: Sequence[float]) -> None:
    Vector = _vector()
    object_.location = position
    direction = Vector(target) - Vector(position)
    if direction.length < 0.01:
        raise StudioSceneError("Camera target must differ from its position")
    object_.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


# Workspace document operations -------------------------------------------------
#
# These functions are kept below the small public primitive helpers above so
# older local callers remain usable.  New Studio UI/network code uses only this
# document-shaped API.


def open_workspace(scene: Any, workspace: Dict[str, Any]) -> Any:
    """Materialize a validated workspace once, without recreating an open set."""

    from .studio_protocol import validate_workspace

    document = validate_workspace(workspace)
    root = _workspace_root(scene, document["projectId"], document["locationId"], create=False)
    if root is not None:
        # Reopening cannot overwrite a user's un-saved transforms, but a
        # browser may have added another shot to this same reusable location.
        # Materialize only missing managed data; existing environment objects,
        # cameras, actors, and tracks remain exactly as Blender has them.
        _materialize_missing_workspace_data(root, document)
        return root
    root = _workspace_root(scene, document["projectId"], document["locationId"], create=True)
    assert root is not None
    _store_document(root, document)
    _materialize_workspace(root, document)
    return root


def replace_workspace(scene: Any, workspace: Dict[str, Any]) -> Any:
    """Explicitly replace only managed Studio data with a server workspace.

    This is never used for background polling: the calling UI must make the
    user confirm that local managed edits may be discarded.  Unmanaged objects
    a user put in a Studio collection are intentionally left untouched.
    """

    from .studio_protocol import validate_workspace

    document = validate_workspace(workspace)
    root = _workspace_root(scene, document["projectId"], document["locationId"], create=True)
    assert root is not None
    for collection in (root, *root.children_recursive):
        for object_ in tuple(collection.objects):
            if object_.get(STUDIO_OBJECT_KEY) is not None or object_.get(STUDIO_KIND_KEY) == "camera":
                _remove_owned_tree(object_)
    shots_parent = next((child for child in root.children if child.get(STUDIO_SCOPE_KEY) == "shots"), None)
    if shots_parent is not None:
        for collection in tuple(shots_parent.children):
            if not collection.objects and not collection.children:
                bpy = _bpy()
                bpy.data.collections.remove(collection)
    _store_document(root, document)
    _materialize_workspace(root, document)
    return root


def workspace_snapshot(scene: Any, workspace: Dict[str, Any]) -> Dict[str, Any]:
    """Capture managed Blender transforms after manual edits for save/AI input."""

    from .studio_protocol import validate_workspace

    baseline = validate_workspace(workspace)
    root = _workspace_root(scene, baseline["projectId"], baseline["locationId"], create=False)
    if root is None:
        return baseline
    result = copy.deepcopy(baseline)
    result["objects"] = _capture_objects(_environment_collection(root), "set", None)
    shots_by_id = {shot["id"]: shot for shot in result["shots"]}
    for shot_id, shot in shots_by_id.items():
        shot_collection = _shot_collection(root, shot_id, create=False)
        if shot_collection is None:
            continue
        shot["objects"] = _capture_objects(shot_collection, "shot", shot_id)
        camera = _find_tagged(shot_collection, "camera", "shot", shot_id)
        if camera is not None:
            shot["camera"] = _camera_document(camera)
        shot["tracks"] = _capture_tracks(shot_collection, shot["objects"])
    return validate_workspace(result)


def activate_workspace_shot(scene: Any, workspace: Dict[str, Any], shot_id: str) -> Any:
    """Explicitly choose a workspace shot's camera and timeline in this scene."""

    from .studio_protocol import validate_workspace

    document = validate_workspace(workspace)
    shot = _document_shot(document, shot_id)
    root = _workspace_root(scene, document["projectId"], document["locationId"], create=False)
    if root is None:
        raise StudioSceneError("Open this Studio workspace before activating a shot")
    collection = _shot_collection(root, shot_id, create=False)
    if collection is None:
        raise StudioSceneError("The selected Studio shot is not materialized")
    camera = _find_tagged(collection, "camera", "shot", shot_id)
    if camera is None:
        raise StudioSceneError("The selected Studio shot has no managed camera")
    # This is an explicit view/timeline command rather than an implicit change
    # made while opening a workspace.
    scene.camera = camera
    scene.frame_start = shot["frameStart"]
    scene.frame_end = shot["frameEnd"]
    scene.render.fps = shot["fps"]
    return camera


def render_auxiliary_preview(scene: Any) -> Dict[str, Any]:
    """Render the active local shot for explicit auxiliary preview publishing.

    This deliberately keeps the user's engine, resolution and scene intact;
    it only temporarily redirects the render output to a private tempfile.
    The caller decides whether the resulting PNG is sent to
    ``studio.preview.publish``.
    """

    bpy = _bpy()
    if scene.camera is None:
        raise StudioSceneError("Choose a camera before rendering a local preview")
    previous_path = scene.render.filepath
    try:
        with tempfile.TemporaryDirectory(prefix="cm_studio_preview_") as directory:
            path = os.path.join(directory, "preview.png")
            scene.render.filepath = path
            if getattr(bpy.context, "window", None) is None:
                with bpy.context.temp_override(scene=scene, view_layer=scene.view_layers[0]):
                    bpy.ops.render.render(write_still=True)
            else:
                bpy.ops.render.render(write_still=True)
            with open(path, "rb") as output:
                png = output.read()
    except (OSError, RuntimeError) as error:
        raise StudioSceneError("Blender could not render the local preview") from error
    finally:
        scene.render.filepath = previous_path
    if not png.startswith(b"\x89PNG\r\n\x1a\n") or len(png) > 8 * 1024 * 1024:
        raise StudioSceneError("Local preview must be a PNG no larger than 8 MB")
    Vector = _vector()
    camera = scene.camera
    direction = camera.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0))
    position = [float(value) for value in camera.matrix_world.translation]
    target = [position[index] + float(direction[index]) * 5.0 for index in range(3)]
    return {
        "pngBase64": base64.b64encode(png).decode("ascii"),
        "actualCamera": {
            "position": position,
            "target": target,
            "focalLength": float(camera.data.lens),
            "sensorWidth": float(camera.data.sensor_width),
        },
    }


def apply_proposal(scene: Any, workspace: Dict[str, Any], proposal: Dict[str, Any]) -> Dict[str, Any]:
    """Apply a reviewed typed proposal to managed data and return local state."""

    from .studio_protocol import validate_proposal, validate_workspace

    document = workspace_snapshot(scene, workspace)
    checked = validate_proposal(proposal, document)
    root = _workspace_root(scene, document["projectId"], document["locationId"], create=True)
    assert root is not None
    for operation in checked["ops"]:
        kind = operation["op"]
        if kind in {"upsert_object", "remove_object"}:
            collection = (
                _environment_collection(root)
                if operation["scope"] == "set"
                else _shot_collection(root, operation["shotId"], create=True)
            )
            assert collection is not None
            shot_id = operation.get("shotId")
            if kind == "remove_object":
                existing = _find_managed(collection, operation["objectId"], operation["scope"], shot_id)
                if existing is not None:
                    _remove_owned_tree(existing)
                _document_remove_object(document, operation)
            else:
                managed = operation["object"]
                existing = _find_managed(collection, managed["id"], operation["scope"], shot_id)
                if existing is None:
                    _create_managed_object(collection, managed, operation["scope"], shot_id)
                else:
                    _update_managed_object(existing, managed)
                _document_upsert_object(document, operation)
        elif kind == "set_camera":
            shot = _document_shot(document, operation["shotId"])
            collection = _shot_collection(root, operation["shotId"], create=True)
            assert collection is not None
            camera = _find_tagged(collection, "camera", "shot", operation["shotId"])
            if camera is None:
                camera = _create_workspace_camera(collection, shot, operation["camera"])
            else:
                _update_camera(camera, operation["camera"])
            shot["camera"] = operation["camera"]
        elif kind == "set_tracks":
            shot = _document_shot(document, operation["shotId"])
            collection = _shot_collection(root, operation["shotId"], create=True)
            assert collection is not None
            _apply_tracks(collection, operation["tracks"], shot["objects"], operation["shotId"])
            shot["tracks"] = operation["tracks"]
            shot["frameStart"] = operation["frameStart"]
            shot["frameEnd"] = operation["frameEnd"]
            shot["fps"] = operation["fps"]
    document = validate_workspace(document)
    _store_document(root, document)
    return workspace_snapshot(scene, document)


def import_workspace_asset(scene: Any, workspace: Dict[str, Any], asset: Dict[str, Any], glb_bytes: bytes) -> Dict[str, Any]:
    """Explicitly import authenticated GLB bytes into a managed set once."""

    import hashlib
    import tempfile

    from .studio_protocol import validate_workspace

    document = validate_workspace(workspace)
    matching = [entry for entry in document["assets"] if entry["id"] == asset.get("id")]
    if len(matching) != 1:
        raise StudioSceneError("Asset is not part of the current workspace")
    checked_asset = matching[0]
    if not isinstance(glb_bytes, bytes) or len(glb_bytes) != checked_asset["bytes"]:
        raise StudioSceneError("Authenticated GLB length does not match asset metadata")
    if hashlib.sha256(glb_bytes).hexdigest().lower() != checked_asset["sha256"].lower():
        raise StudioSceneError("Authenticated GLB hash does not match asset metadata")
    _validate_glb_bytes(glb_bytes)
    root = open_workspace(scene, document)
    existing = _find_asset_root(root, checked_asset["id"])
    if existing is not None:
        return {"root": existing, "imported": False, "rigged": bool(existing.get("cinemaMachineStudioRigged")), "animated": bool(existing.get("cinemaMachineStudioHasAnimation"))}
    with tempfile.TemporaryDirectory(prefix="cm_studio_asset_") as directory:
        filepath = os.path.join(directory, checked_asset["id"] + ".glb")
        with open(filepath, "wb") as output:
            output.write(glb_bytes)
        result = import_glb_character(
            scene,
            document["locationId"],
            filepath,
            label=checked_asset["name"],
        )
    asset_root = result["root"]
    environment = _environment_collection(root)
    for object_ in (asset_root, *asset_root.children_recursive):
        for collection in tuple(object_.users_collection):
            collection.objects.unlink(object_)
        environment.objects.link(object_)
    if _has_animation_drivers((asset_root, *asset_root.children_recursive)):
        _remove_owned_tree(asset_root)
        raise StudioSceneError("Authenticated GLB contains unsupported animation drivers")
    asset_root["cinemaMachineStudioAssetId"] = checked_asset["id"]
    asset_root[STUDIO_PROJECT_KEY] = document["projectId"]
    binding = _asset_binding(document, checked_asset["id"])
    if binding is None:
        binding = {
            "id": "asset_" + checked_asset["sha256"][:24],
            "name": checked_asset["name"],
            "kind": "mesh",
            "position": [0.0, 0.0, 0.0],
            "rotation": [0.0, 0.0, 0.0],
            "scale": [1.0, 1.0, 1.0],
            "color": [0.7, 0.7, 0.7],
            "assetId": checked_asset["id"],
        }
        scope, shot_id = "set", None
    else:
        scope, shot_id, binding = binding
        collection = _environment_collection(root) if scope == "set" else _shot_collection(root, shot_id, create=False)
        if collection is not None:
            placeholder = _find_managed(collection, binding["id"], scope, shot_id)
            if placeholder is not None:
                _remove_owned_tree(placeholder)
    asset_root.location = binding["position"]
    asset_root.rotation_mode = "XYZ"
    asset_root.rotation_euler = binding["rotation"]
    asset_root.scale = binding["scale"]
    _mark_managed(asset_root, binding, scope, shot_id)
    return dict(result, imported=True)


def _store_document(root: Any, document: Dict[str, Any]) -> None:
    root[STUDIO_DOCUMENT_KEY] = json.dumps(document, separators=(",", ":"), ensure_ascii=False)
    root["cinemaMachineStudioRevision"] = document["revision"]
    root["cinemaMachineStudioName"] = document["name"]


def _environment_collection(root: Any) -> Any:
    for child in root.children:
        if child.get(STUDIO_SCOPE_KEY) == "set":
            return child
    raise StudioSceneError("Studio workspace has no environment collection")


def _shot_collection(root: Any, shot_id: str, create: bool) -> Optional[Any]:
    bpy = _bpy()
    for parent in root.children:
        if parent.get(STUDIO_SCOPE_KEY) != "shots":
            continue
        for child in parent.children:
            if child.get(STUDIO_SHOT_KEY) == shot_id:
                return child
        if create:
            child = bpy.data.collections.new("Shot — " + shot_id)
            child[STUDIO_SCOPE_KEY] = "shot"
            child[STUDIO_SHOT_KEY] = shot_id
            parent.children.link(child)
            return child
    if create:
        raise StudioSceneError("Studio workspace has no shots collection")
    return None


def _materialize_workspace(root: Any, document: Dict[str, Any]) -> None:
    environment = _environment_collection(root)
    for managed in document["objects"]:
        _create_managed_object(environment, managed, "set", None)
    for shot in document["shots"]:
        collection = _shot_collection(root, shot["id"], create=True)
        assert collection is not None
        _create_workspace_camera(collection, shot, shot["camera"])
        for managed in shot["objects"]:
            _create_managed_object(collection, managed, "shot", shot["id"])
        _apply_tracks(collection, shot["tracks"], shot["objects"], shot["id"])


def _materialize_missing_workspace_data(root: Any, document: Dict[str, Any]) -> None:
    """Add new browser-authored objects/shots without touching existing data."""

    environment = _environment_collection(root)
    for managed in document["objects"]:
        if _find_managed(environment, managed["id"], "set", None) is None:
            _create_managed_object(environment, managed, "set", None)
    for shot in document["shots"]:
        collection = _shot_collection(root, shot["id"], create=False)
        if collection is None:
            collection = _shot_collection(root, shot["id"], create=True)
            assert collection is not None
            _create_workspace_camera(collection, shot, shot["camera"])
            for managed in shot["objects"]:
                _create_managed_object(collection, managed, "shot", shot["id"])
            _apply_tracks(collection, shot["tracks"], shot["objects"], shot["id"])
            continue
        # An interrupted initial materialization can leave a partial shot.
        # Fill its missing primitives/camera but never reset an already-present
        # transform, camera, armature action, or F-curve.
        if _find_tagged(collection, "camera", "shot", shot["id"]) is None:
            _create_workspace_camera(collection, shot, shot["camera"])
        for managed in shot["objects"]:
            if _find_managed(collection, managed["id"], "shot", shot["id"]) is None:
                _create_managed_object(collection, managed, "shot", shot["id"])


def _mark_managed(object_: Any, managed: Dict[str, Any], scope: str, shot_id: Optional[str]) -> None:
    object_[STUDIO_OBJECT_KEY] = managed["id"]
    object_[STUDIO_SCOPE_KEY] = scope
    object_[STUDIO_KIND_KEY] = managed["kind"]
    if shot_id:
        object_[STUDIO_SHOT_KEY] = shot_id
    if "characterId" in managed:
        object_["cinemaMachineStudioCharacterId"] = managed["characterId"]
    if "assetId" in managed:
        object_["cinemaMachineStudioAssetId"] = managed["assetId"]


def _create_managed_object(collection: Any, managed: Dict[str, Any], scope: str, shot_id: Optional[str]) -> Any:
    bpy = _bpy()
    material = _new_material("Kinolot Studio Managed")
    color = managed["color"]
    material.diffuse_color = (color[0], color[1], color[2], 1.0)
    name = "Kinolot " + managed["kind"].title() + " — " + managed["name"]
    if managed["kind"] == "cylinder":
        object_ = _add_cylinder(collection, name, managed["position"], 0.5, 1.0, material, managed["kind"])
    elif managed["kind"] in {"sphere", "actor"}:
        object_ = _add_octahedron(collection, name, managed["position"], 0.5, material, managed["kind"])
    elif managed["kind"] == "light":
        data = bpy.data.lights.new(name + " Data", type="POINT")
        data.energy = float(managed.get("lightEnergy", 1000.0))
        object_ = bpy.data.objects.new(name, data)
        collection.objects.link(object_)
        object_.location = managed["position"]
    elif managed["kind"] == "mesh":
        # Asset bytes are fetched/imported only after the explicit Import
        # action.  The managed empty is an honest editable placement root.
        object_ = bpy.data.objects.new(name + " (not imported)", None)
        collection.objects.link(object_)
        object_.location = managed["position"]
    else:
        dimensions = (1.0, 1.0, 0.01 if managed["kind"] == "plane" else 1.0)
        object_ = _add_box(collection, name, managed["position"], dimensions, material, managed["kind"])
    _mark_managed(object_, managed, scope, shot_id)
    _update_managed_object(object_, managed)
    return object_


def _update_managed_object(object_: Any, managed: Dict[str, Any]) -> None:
    object_.name = "Kinolot " + managed["kind"].title() + " — " + managed["name"]
    object_.location = managed["position"]
    object_.rotation_mode = "XYZ"
    object_.rotation_euler = managed["rotation"]
    object_.scale = managed["scale"]
    if object_.type == "LIGHT" and "lightEnergy" in managed:
        object_.data.energy = managed["lightEnergy"]


def _create_workspace_camera(collection: Any, shot: Dict[str, Any], camera_doc: Dict[str, Any]) -> Any:
    bpy = _bpy()
    data = bpy.data.cameras.new("Kinolot Camera Data — " + shot["name"])
    camera = bpy.data.objects.new("Kinolot Camera — " + shot["name"], data)
    collection.objects.link(camera)
    camera[STUDIO_KIND_KEY] = "camera"
    camera[STUDIO_SCOPE_KEY] = "shot"
    camera[STUDIO_SHOT_KEY] = shot["id"]
    _update_camera(camera, camera_doc)
    return camera


def _update_camera(camera: Any, camera_doc: Dict[str, Any]) -> None:
    camera.data.lens = camera_doc["focalLength"]
    camera.data.sensor_width = camera_doc["sensorWidth"]
    _look_at(camera, camera_doc["position"], camera_doc["target"])
    camera["cinemaMachineStudioCameraTarget"] = list(camera_doc["target"])


def _camera_document(camera: Any) -> Dict[str, Any]:
    Vector = _vector()
    position = [float(item) for item in camera.location]
    target = camera.get("cinemaMachineStudioCameraTarget")
    if not isinstance(target, (list, tuple)) or len(target) != 3:
        direction = camera.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0))
        target = [position[index] + float(direction[index]) * 5.0 for index in range(3)]
    return {
        "position": position,
        "target": [float(item) for item in target],
        "focalLength": float(camera.data.lens),
        "sensorWidth": float(camera.data.sensor_width),
    }


def _find_managed(collection: Any, object_id: str, scope: str, shot_id: Optional[str]) -> Optional[Any]:
    for object_ in collection.objects:
        if object_.get(STUDIO_OBJECT_KEY) != object_id or object_.get(STUDIO_SCOPE_KEY) != scope:
            continue
        if scope != "shot" or object_.get(STUDIO_SHOT_KEY) == shot_id:
            return object_
    return None


def _find_tagged(collection: Any, kind: str, scope: str, shot_id: Optional[str]) -> Optional[Any]:
    for object_ in collection.objects:
        if object_.get(STUDIO_KIND_KEY) == kind and object_.get(STUDIO_SCOPE_KEY) == scope:
            if scope != "shot" or object_.get(STUDIO_SHOT_KEY) == shot_id:
                return object_
    return None


def _remove_owned_tree(root: Any) -> None:
    bpy = _bpy()
    children = list(root.children_recursive)
    for object_ in reversed(children):
        bpy.data.objects.remove(object_, do_unlink=True)
    bpy.data.objects.remove(root, do_unlink=True)


def _capture_objects(collection: Any, scope: str, shot_id: Optional[str]) -> list:
    result = []
    for object_ in collection.objects:
        object_id = object_.get(STUDIO_OBJECT_KEY)
        if not isinstance(object_id, str) or object_.get(STUDIO_SCOPE_KEY) != scope:
            continue
        if scope == "shot" and object_.get(STUDIO_SHOT_KEY) != shot_id:
            continue
        kind = object_.get(STUDIO_KIND_KEY)
        if kind not in {"box", "sphere", "cylinder", "plane", "actor", "mesh", "light"}:
            continue
        color = [0.7, 0.7, 0.7]
        if object_.type == "MESH" and len(object_.data.materials):
            color = [float(item) for item in object_.data.materials[0].diffuse_color[:3]]
        entry = {
            "id": object_id, "name": object_.name.split(" — ", 1)[-1], "kind": kind,
            "position": [float(item) for item in object_.location],
            "rotation": [float(item) for item in object_.rotation_euler],
            "scale": [float(item) for item in object_.scale],
            "color": color,
        }
        if isinstance(object_.get("cinemaMachineStudioCharacterId"), str):
            entry["characterId"] = object_["cinemaMachineStudioCharacterId"]
        if isinstance(object_.get("cinemaMachineStudioAssetId"), str):
            entry["assetId"] = object_["cinemaMachineStudioAssetId"]
        if object_.type == "LIGHT":
            entry["lightEnergy"] = float(object_.data.energy)
        result.append(entry)
    return result


def _capture_tracks(collection: Any, objects: Sequence[Dict[str, Any]]) -> list:
    result = []
    for managed in objects:
        object_ = _find_managed(collection, managed["id"], "shot", collection.get(STUDIO_SHOT_KEY))
        if object_ is None or object_.animation_data is None or object_.animation_data.action is None:
            continue
        action = object_.animation_data.action
        for property_name, data_path in (("position", "location"), ("rotation", "rotation_euler"), ("scale", "scale")):
            curves = [curve for curve in action.fcurves if curve.data_path == data_path]
            if len(curves) != 3:
                continue
            frames = sorted({int(point.co.x) for curve in curves for point in curve.keyframe_points})
            keyframes = []
            for frame in frames:
                values = []
                for index in range(3):
                    curve = next((curve for curve in curves if curve.array_index == index), None)
                    if curve is None:
                        break
                    values.append(float(curve.evaluate(frame)))
                if len(values) == 3:
                    keyframes.append({"frame": frame, "value": values})
            if keyframes:
                result.append({"objectId": managed["id"], "property": property_name, "keyframes": keyframes})
    return result


def _apply_tracks(collection: Any, tracks: Sequence[Dict[str, Any]], objects: Sequence[Dict[str, Any]], shot_id: str) -> None:
    del objects
    mappings = {"position": "location", "rotation": "rotation_euler", "scale": "scale"}
    for track in tracks:
        object_ = _find_managed(collection, track["objectId"], "shot", shot_id)
        if object_ is None:
            raise StudioSceneError("Track refers to an unavailable managed shot object")
        data_path = mappings[track["property"]]
        if object_.animation_data and object_.animation_data.action:
            for curve in list(object_.animation_data.action.fcurves):
                if curve.data_path == data_path:
                    object_.animation_data.action.fcurves.remove(curve)
        for keyframe in track["keyframes"]:
            setattr(object_, data_path, keyframe["value"])
            object_.keyframe_insert(data_path=data_path, frame=keyframe["frame"])


def _document_shot(document: Dict[str, Any], shot_id: str) -> Dict[str, Any]:
    for shot in document["shots"]:
        if shot["id"] == shot_id:
            return shot
    raise StudioSceneError("Proposal refers to a shot outside this workspace")


def _document_upsert_object(document: Dict[str, Any], operation: Dict[str, Any]) -> None:
    values = document["objects"] if operation["scope"] == "set" else _document_shot(document, operation["shotId"])["objects"]
    values[:] = [entry for entry in values if entry["id"] != operation["object"]["id"]]
    values.append(copy.deepcopy(operation["object"]))


def _document_remove_object(document: Dict[str, Any], operation: Dict[str, Any]) -> None:
    values = document["objects"] if operation["scope"] == "set" else _document_shot(document, operation["shotId"])["objects"]
    values[:] = [entry for entry in values if entry["id"] != operation["objectId"]]


def _find_asset_root(root: Any, asset_id: str) -> Optional[Any]:
    environment = _environment_collection(root)
    for collection in (root, environment, *environment.children_recursive):
        for object_ in collection.objects:
            if object_.get("cinemaMachineStudioAssetId") == asset_id and object_.get(STUDIO_CHARACTER_KEY) is True:
                return object_
    return None


def _asset_binding(document: Dict[str, Any], asset_id: str) -> Optional[Tuple[str, Optional[str], Dict[str, Any]]]:
    for managed in document["objects"]:
        if managed.get("assetId") == asset_id:
            return ("set", None, managed)
    for shot in document["shots"]:
        for managed in shot["objects"]:
            if managed.get("assetId") == asset_id:
                return ("shot", shot["id"], managed)
    return None


def _validate_glb_bytes(payload: bytes) -> None:
    """Reject malformed/external-resource GLBs before invoking Blender import."""

    if len(payload) < 20 or payload[:4] != b"glTF":
        raise StudioSceneError("Authenticated asset is not a GLB")
    version = int.from_bytes(payload[4:8], "little")
    declared = int.from_bytes(payload[8:12], "little")
    if version != 2 or declared != len(payload):
        raise StudioSceneError("Authenticated GLB has an invalid header")
    offset = 12
    json_chunk = None
    while offset < len(payload):
        if offset + 8 > len(payload):
            raise StudioSceneError("Authenticated GLB has a truncated chunk")
        length = int.from_bytes(payload[offset:offset + 4], "little")
        chunk_type = payload[offset + 4:offset + 8]
        offset += 8
        if length > len(payload) - offset:
            raise StudioSceneError("Authenticated GLB has an invalid chunk length")
        chunk = payload[offset:offset + length]
        offset += length
        if chunk_type == b"JSON":
            if json_chunk is not None:
                raise StudioSceneError("Authenticated GLB has multiple JSON chunks")
            json_chunk = chunk
    if offset != len(payload) or json_chunk is None:
        raise StudioSceneError("Authenticated GLB is incomplete")
    try:
        document = json.loads(json_chunk.decode("utf-8").rstrip(" \t\r\n\0"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise StudioSceneError("Authenticated GLB has invalid JSON") from exc
    if not isinstance(document, dict):
        raise StudioSceneError("Authenticated GLB JSON must be an object")

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            if "uri" in value:
                raise StudioSceneError("Authenticated GLB cannot reference external resources")
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(document)


def _has_animation_drivers(objects: Sequence[Any]) -> bool:
    """GLTF normally cannot carry Blender drivers; reject rather than trust one."""

    for object_ in objects:
        animation = getattr(object_, "animation_data", None)
        if animation is not None and len(animation.drivers):
            return True
        data = getattr(object_, "data", None)
        animation = getattr(data, "animation_data", None)
        if animation is not None and len(animation.drivers):
            return True
        if object_.type == "ARMATURE":
            for bone in object_.pose.bones:
                animation = getattr(bone, "animation_data", None)
                if animation is not None and len(animation.drivers):
                    return True
    return False