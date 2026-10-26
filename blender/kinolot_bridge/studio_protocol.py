"""Strict local mirror of the ``cm-studio-v1`` document contract.

The browser/server contract remains authoritative.  These checks exist so the
desktop never turns a network response or assistant text into arbitrary
Blender/Python operations.  In particular, only a bounded proposal vocabulary
can reach :mod:`studio_scene`.
"""

from __future__ import annotations

import base64
import copy
import json
import math
import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


STUDIO_SCHEMA = "cm-studio-v1"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
_SHA256 = re.compile(r"^[a-fA-F0-9]{64}$")


class StudioProtocolError(ValueError):
    """A studio request, response, or document violates the safe schema."""


def _mapping(value: Any, where: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise StudioProtocolError(where + " must be an object")
    return value


def _keys(value: Mapping[str, Any], expected: Iterable[str], where: str, optional: Iterable[str] = ()) -> None:
    allowed = set(expected) | set(optional)
    actual = set(value)
    if actual - allowed or set(expected) - actual:
        bits = []
        if actual - allowed:
            bits.append("unknown " + ", ".join(sorted(actual - allowed)))
        if set(expected) - actual:
            bits.append("missing " + ", ".join(sorted(set(expected) - actual)))
        raise StudioProtocolError(where + " has invalid fields (" + "; ".join(bits) + ")")


def _text(value: Any, where: str, maximum: int = 120) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or any(ord(char) < 32 for char in value):
        raise StudioProtocolError("%s must be 1-%d printable characters" % (where, maximum))
    return value


def _id(value: Any, where: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise StudioProtocolError(where + " must be a safe canonical ID")
    return value


def _optional_id(value: Any, where: str) -> Optional[str]:
    if value is None:
        return None
    return _id(value, where)


def _number(value: Any, where: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise StudioProtocolError(where + " must be a number")
    result = float(value)
    if not math.isfinite(result) or result < low or result > high:
        raise StudioProtocolError("%s must be between %g and %g" % (where, low, high))
    return result


def _vector(value: Any, where: str, low: float = -10000.0, high: float = 10000.0) -> List[float]:
    if not isinstance(value, list) or len(value) != 3:
        raise StudioProtocolError(where + " must be a three-number array")
    return [_number(item, where, low, high) for item in value]


def _integer(value: Any, where: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < low or value > high:
        raise StudioProtocolError("%s must be an integer between %d and %d" % (where, low, high))
    return value


def validate_camera(value: Any) -> Dict[str, Any]:
    source = _mapping(value, "camera")
    _keys(source, ("position", "target", "focalLength", "sensorWidth"), "camera")
    position = _vector(source["position"], "camera.position")
    target = _vector(source["target"], "camera.target")
    if math.dist(position, target) < 0.001:
        raise StudioProtocolError("camera target must differ from position")
    return {
        "position": position,
        "target": target,
        "focalLength": _number(source["focalLength"], "camera.focalLength", 8.0, 200.0),
        "sensorWidth": _number(source["sensorWidth"], "camera.sensorWidth", 1.0, 100.0),
    }


def validate_managed_object(value: Any) -> Dict[str, Any]:
    source = _mapping(value, "managed object")
    _keys(
        source,
        ("id", "name", "kind", "position", "rotation", "scale", "color"),
        "managed object",
        ("characterId", "assetId", "lightEnergy"),
    )
    kind = source["kind"]
    if kind not in {"box", "sphere", "cylinder", "plane", "actor", "mesh", "light"}:
        raise StudioProtocolError("managed object.kind is unsupported")
    result = {
        "id": _id(source["id"], "managed object.id"),
        "name": _text(source["name"], "managed object.name"),
        "kind": kind,
        "position": _vector(source["position"], "managed object.position"),
        "rotation": _vector(source["rotation"], "managed object.rotation", -math.pi * 8.0, math.pi * 8.0),
        "scale": _vector(source["scale"], "managed object.scale", 0.001, 10000.0),
        "color": _vector(source["color"], "managed object.color", 0.0, 1.0),
    }
    if "characterId" in source:
        result["characterId"] = _id(source["characterId"], "managed object.characterId")
    if "assetId" in source:
        result["assetId"] = _id(source["assetId"], "managed object.assetId")
    if "lightEnergy" in source:
        result["lightEnergy"] = _number(source["lightEnergy"], "managed object.lightEnergy", 0.0, 100000.0)
    return result


def validate_track(value: Any, object_ids: Optional[set] = None) -> Dict[str, Any]:
    source = _mapping(value, "track")
    _keys(source, ("objectId", "property", "keyframes"), "track")
    if source["property"] not in {"position", "rotation", "scale"}:
        raise StudioProtocolError("track.property is unsupported")
    if not isinstance(source["keyframes"], list) or len(source["keyframes"]) > 240:
        raise StudioProtocolError("track.keyframes cannot contain more than 240 keyframes")
    keyframes = []
    for index, item in enumerate(source["keyframes"]):
        frame = _mapping(item, "track.keyframes[%d]" % index)
        _keys(frame, ("frame", "value"), "track.keyframes[%d]" % index)
        frame_number = _integer(frame["frame"], "track.keyframes[%d].frame" % index, 1, 100000)
        keyframes.append({"frame": frame_number, "value": _vector(frame["value"], "track keyframe value")})
    object_id = _id(source["objectId"], "track.objectId")
    if object_ids is not None and object_id not in object_ids:
        raise StudioProtocolError("track object is not in this shot")
    return {"objectId": object_id, "property": source["property"], "keyframes": keyframes}


def validate_shot(value: Any) -> Dict[str, Any]:
    source = _mapping(value, "shot")
    _keys(source, ("id", "sceneId", "name", "camera", "objects", "tracks", "frameStart", "frameEnd", "fps"), "shot")
    if not isinstance(source["objects"], list) or len(source["objects"]) > 250:
        raise StudioProtocolError("shot.objects cannot contain more than 250 objects")
    if not isinstance(source["tracks"], list) or len(source["tracks"]) > 64:
        raise StudioProtocolError("shot.tracks cannot contain more than 64 tracks")
    start = _integer(source["frameStart"], "shot.frameStart", 1, 100000)
    end = _integer(source["frameEnd"], "shot.frameEnd", start, 100000)
    return {
        "id": _id(source["id"], "shot.id"),
        "sceneId": _id(source["sceneId"], "shot.sceneId"),
        "name": _text(source["name"], "shot.name"),
        "camera": validate_camera(source["camera"]),
        "objects": _unique_objects(source["objects"], "shot.objects"),
        "tracks": _unique_tracks(source["tracks"], {item["id"] for item in _unique_objects(source["objects"], "shot.objects")}),
        "frameStart": start,
        "frameEnd": end,
        "fps": _integer(source["fps"], "shot.fps", 1, 120),
    }


def _unique_objects(value: Sequence[Any], where: str) -> List[Dict[str, Any]]:
    result = [validate_managed_object(item) for item in value]
    if len({item["id"] for item in result}) != len(result):
        raise StudioProtocolError(where + " contains duplicate IDs")
    return result


def _unique_tracks(value: Sequence[Any], object_ids: Optional[set] = None) -> List[Dict[str, Any]]:
    result = [validate_track(item, object_ids) for item in value]
    identifiers = {(item["objectId"], item["property"]) for item in result}
    if len(identifiers) != len(result):
        raise StudioProtocolError("shot.tracks contains duplicate object/property tracks")
    return result


def validate_workspace(value: Any) -> Dict[str, Any]:
    source = _mapping(value, "workspace")
    _keys(
        source,
        ("schema", "projectId", "locationId", "name", "parentLocationId", "rootLocationId", "revision", "context", "objects", "shots", "references", "assets", "previews"),
        "workspace",
    )
    if source["schema"] != STUDIO_SCHEMA:
        raise StudioProtocolError("workspace.schema must be cm-studio-v1")
    context = _mapping(source["context"], "workspace.context")
    _keys(context, ("description", "architecture", "materials", "staging"), "workspace.context", optional=("productionPlan",))
    checked_context = {}
    for key in ("description", "architecture", "materials", "staging"):
        context_value = context[key]
        if not isinstance(context_value, str) or len(context_value) > 4000 or any(ord(char) < 32 for char in context_value):
            raise StudioProtocolError("workspace.context.%s must be up to 4000 printable characters" % key)
        checked_context[key] = context_value
    if "productionPlan" in context:
        production_plan = context["productionPlan"]
        if not isinstance(production_plan, str) or len(production_plan) > 16000 or any(ord(char) < 32 for char in production_plan):
            raise StudioProtocolError("workspace.context.productionPlan must be up to 16000 printable characters")
        checked_context["productionPlan"] = production_plan
    if not isinstance(source["objects"], list) or len(source["objects"]) > 500:
        raise StudioProtocolError("workspace.objects cannot contain more than 500 objects")
    if not isinstance(source["shots"], list) or len(source["shots"]) > 200:
        raise StudioProtocolError("workspace.shots cannot contain more than 200 shots")
    if not isinstance(source["references"], list) or len(source["references"]) > 200:
        raise StudioProtocolError("workspace.references cannot contain more than 200 references")
    if not isinstance(source["assets"], list) or len(source["assets"]) > 200:
        raise StudioProtocolError("workspace.assets cannot contain more than 200 assets")
    if not isinstance(source["previews"], list) or len(source["previews"]) > 200:
        raise StudioProtocolError("workspace.previews cannot contain more than 200 previews")
    objects = _unique_objects(source["objects"], "workspace.objects")
    shots = [validate_shot(item) for item in source["shots"]]
    if len({shot["id"] for shot in shots}) != len(shots):
        raise StudioProtocolError("workspace.shots contains duplicate IDs")
    result = {
        "schema": STUDIO_SCHEMA,
        "projectId": _id(source["projectId"], "workspace.projectId"),
        "locationId": _id(source["locationId"], "workspace.locationId"),
        "name": _text(source["name"], "workspace.name"),
        "parentLocationId": _optional_id(source["parentLocationId"], "workspace.parentLocationId"),
        "rootLocationId": _id(source["rootLocationId"], "workspace.rootLocationId"),
        "revision": _integer(source["revision"], "workspace.revision", 0, 1000000000),
        "context": checked_context,
        "objects": objects,
        "shots": shots,
        "references": _validate_references(source["references"]),
        "assets": _validate_assets(source["assets"]),
        "previews": _validate_previews(source["previews"]),
    }
    return copy.deepcopy(result)


def _validate_references(value: Sequence[Any]) -> List[Dict[str, Any]]:
    result = []
    for index, item in enumerate(value):
        source = _mapping(item, "reference[%d]" % index)
        _keys(source, ("entityId", "label", "kind"), "reference[%d]" % index, ("version",))
        if source["kind"] not in {"location", "character", "prop"}:
            raise StudioProtocolError("reference.kind is unsupported")
        entry = {"entityId": _id(source["entityId"], "reference.entityId"), "label": _text(source["label"], "reference.label"), "kind": source["kind"]}
        if "version" in source:
            entry["version"] = _text(str(source["version"]), "reference.version", 120)
        result.append(entry)
    return result


def _validate_assets(value: Sequence[Any]) -> List[Dict[str, Any]]:
    result = []
    for index, item in enumerate(value):
        source = _mapping(item, "asset[%d]" % index)
        _keys(source, ("id", "name", "kind", "sha256", "bytes", "modelId", "rigged", "animated"), "asset[%d]" % index, ("characterId",))
        if source["kind"] != "glb" or not isinstance(source["rigged"], bool) or not isinstance(source["animated"], bool):
            raise StudioProtocolError("asset must be a GLB with boolean rigged/animated metadata")
        sha = source["sha256"]
        if not isinstance(sha, str) or not _SHA256.fullmatch(sha):
            raise StudioProtocolError("asset.sha256 must be a SHA-256 hash")
        entry = {
            "id": _id(source["id"], "asset.id"),
            "name": _text(source["name"], "asset.name"),
            "kind": "glb",
            "sha256": sha,
            "bytes": _integer(source["bytes"], "asset.bytes", 12, 64 * 1024 * 1024),
            "modelId": _text(source["modelId"], "asset.modelId", 128),
            "rigged": source["rigged"],
            "animated": source["animated"],
        }
        if "characterId" in source:
            entry["characterId"] = _id(source["characterId"], "asset.characterId")
        result.append(entry)
    return result


def _validate_previews(value: Sequence[Any]) -> List[Dict[str, Any]]:
    result = []
    for index, item in enumerate(value):
        source = _mapping(item, "preview[%d]" % index)
        _keys(source, ("id", "sha256", "bytes", "actualCamera"), "preview[%d]" % index, ("shotId",))
        sha = source["sha256"]
        if not isinstance(sha, str) or not _SHA256.fullmatch(sha):
            raise StudioProtocolError("preview.sha256 must be a SHA-256 hash")
        entry = {
            "id": _id(source["id"], "preview.id"),
            "sha256": sha,
            "bytes": _integer(source["bytes"], "preview.bytes", 1, 8 * 1024 * 1024),
            "actualCamera": validate_camera(source["actualCamera"]),
        }
        if "shotId" in source:
            entry["shotId"] = _optional_id(source["shotId"], "preview.shotId")
        result.append(entry)
    return result


def validate_proposal(value: Any, workspace: Mapping[str, Any]) -> Dict[str, Any]:
    source = _mapping(value, "assistant proposal")
    _keys(source, ("summary", "ops"), "assistant proposal")
    if not isinstance(source["ops"], list) or len(source["ops"]) > 64:
        raise StudioProtocolError("assistant proposal.ops cannot contain more than 64 operations")
    shot_ids = {shot["id"] for shot in workspace["shots"]}
    operations = []
    for index, item in enumerate(source["ops"]):
        operation = _mapping(item, "proposal.ops[%d]" % index)
        kind = operation.get("op")
        if kind in {"upsert_object", "remove_object"}:
            _keys(operation, ("op", "scope", "object") if kind == "upsert_object" else ("op", "scope", "objectId"), "proposal operation", ("shotId",))
            scope = operation["scope"]
            if scope not in {"set", "shot"}:
                raise StudioProtocolError("proposal scope must be set or shot")
            if scope == "shot":
                shot_id = _id(operation.get("shotId"), "proposal shotId")
                if shot_id not in shot_ids:
                    raise StudioProtocolError("proposal refers to a shot outside this workspace")
            elif kind == "upsert_object" and "shotId" in operation and operation["shotId"] is not None:
                raise StudioProtocolError("set-scoped proposal cannot specify shotId")
            entry = {"op": kind, "scope": scope}
            if scope == "shot":
                entry["shotId"] = shot_id
            if kind == "upsert_object":
                entry["object"] = validate_managed_object(operation["object"])
            else:
                entry["objectId"] = _id(operation["objectId"], "proposal objectId")
            operations.append(entry)
        elif kind == "set_camera":
            _keys(operation, ("op", "shotId", "camera"), "proposal operation")
            shot_id = _id(operation["shotId"], "proposal shotId")
            if shot_id not in shot_ids:
                raise StudioProtocolError("proposal refers to a shot outside this workspace")
            operations.append({"op": kind, "shotId": shot_id, "camera": validate_camera(operation["camera"])})
        elif kind == "set_tracks":
            _keys(operation, ("op", "shotId", "tracks", "frameStart", "frameEnd", "fps"), "proposal operation")
            shot_id = _id(operation["shotId"], "proposal shotId")
            if shot_id not in shot_ids or not isinstance(operation["tracks"], list) or len(operation["tracks"]) > 64:
                raise StudioProtocolError("proposal has invalid shot tracks")
            start = _integer(operation["frameStart"], "proposal frameStart", 1, 100000)
            operations.append({
                "op": kind, "shotId": shot_id, "tracks": _unique_tracks(operation["tracks"]),
                "frameStart": start, "frameEnd": _integer(operation["frameEnd"], "proposal frameEnd", start, 100000),
                "fps": _integer(operation["fps"], "proposal fps", 1, 120),
            })
        else:
            raise StudioProtocolError("proposal contains an unsupported operation")
    return {"summary": _text(source["summary"], "assistant proposal.summary", 1000), "ops": operations}


def validate_image_data_url(value: str) -> str:
    """Validate a transient local PNG/JPEG attachment; return canonical input."""

    if not isinstance(value, str) or not value.startswith("data:image/") or len(value) > (MAX_IMAGE_BYTES * 4 // 3 + 128):
        raise StudioProtocolError("Reference must be a bounded PNG or JPEG data URL")
    match = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})", value)
    if not match:
        raise StudioProtocolError("Reference must be a PNG or JPEG base64 data URL")
    try:
        payload = base64.b64decode(match.group(2), validate=True)
    except ValueError as exc:
        raise StudioProtocolError("Reference image base64 is invalid") from exc
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise StudioProtocolError("Reference image exceeds 8 MB")
    if match.group(1) == "png" and not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise StudioProtocolError("Reference is not a PNG")
    if match.group(1) == "jpeg" and not payload.startswith(b"\xff\xd8\xff"):
        raise StudioProtocolError("Reference is not a JPEG")
    return value
