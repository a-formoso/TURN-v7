"""The provider-independent Blender Bridge protocol.

This module deliberately does not import :mod:`bpy`.  It is used by the
network worker as well as by the main-thread add-on code, and keeping scene
validation here makes it possible to test the security boundary without
starting Blender.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import re
import ssl
import struct
import zlib
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Mapping, Optional, Sequence, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse


PROTOCOL_VERSION = 1
MAX_LABEL_LENGTH = 120
MAX_ID_LENGTH = 128
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_FORBIDDEN_KEY_RE = re.compile(
    r"(?:^|_)(?:exec|executable|script|shell|command|python|url|path|file)(?:$|_)",
    re.IGNORECASE,
)
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class ProtocolError(ValueError):
    """A locally rejected protocol value."""


class BridgeError(RuntimeError):
    """A bridge request failed with a server or transport error."""

    def __init__(self, message: str, code: str = "bridge_error", status: int = 0):
        super().__init__(message)
        self.code = code
        self.status = status


class BridgeHTTPError(BridgeError):
    """A non-2xx response returned by the edge function."""


class BridgeNetworkError(BridgeError):
    """A request whose outcome is not known (usually a timeout)."""


def _require_mapping(value: Any, where: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ProtocolError(f"{where} must be an object")
    return value


def _require_keys(value: Mapping[str, Any], keys: Iterable[str], where: str) -> None:
    expected = set(keys)
    actual = set(value.keys())
    if actual != expected:
        unknown = sorted(actual - expected)
        missing = sorted(expected - actual)
        details = []
        if unknown:
            details.append("unknown " + ", ".join(unknown))
        if missing:
            details.append("missing " + ", ".join(missing))
        raise ProtocolError(f"{where} has invalid fields ({'; '.join(details)})")


def _text(value: Any, where: str, *, identifier: bool = False) -> str:
    if not isinstance(value, str):
        raise ProtocolError(f"{where} must be a string")
    if not value or len(value) > (MAX_ID_LENGTH if identifier else MAX_LABEL_LENGTH):
        raise ProtocolError(f"{where} has an invalid length")
    if any(ord(char) < 32 for char in value):
        raise ProtocolError(f"{where} contains a control character")
    # Scene strings are descriptive identifiers only.  In particular, a
    # remote scene can never smuggle a URL or executable/path value into the
    # renderer.  The endpoint URL is validated separately by BridgeClient.
    if identifier and not _ID_RE.match(value):
        raise ProtocolError(f"{where} is not a safe identifier")
    return value


def _finite_number(value: Any, where: str) -> float:
    # bool is an int subclass, but accepting it in geometry is surprising and
    # makes malformed JSON harder to spot.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProtocolError(f"{where} must be a number")
    result = float(value)
    if not math.isfinite(result):
        raise ProtocolError(f"{where} must be finite")
    return result


def _integer(value: Any, where: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ProtocolError(f"{where} must be an integer")
    if value < low or value > high:
        raise ProtocolError(f"{where} must be between {low} and {high}")
    return value


def _vector(
    value: Any,
    where: str,
    *,
    low: float = -100.0,
    high: float = 100.0,
) -> Tuple[float, float, float]:
    if not isinstance(value, list) or len(value) != 3:
        raise ProtocolError(f"{where} must be a three-number array")
    result = tuple(_finite_number(item, f"{where}[{index}]") for index, item in enumerate(value))
    if any(item < low or item > high for item in result):
        raise ProtocolError(f"{where} is outside the permitted range")
    return result  # type: ignore[return-value]


def _dimensions(value: Any, where: str) -> Tuple[float, float, float]:
    result = _vector(value, where, low=0.001, high=50.0)
    return result


def _validate_object(value: Any, where: str, *, actor: bool = False) -> str:
    mapping = _require_mapping(value, where)
    if actor:
        _require_keys(mapping, ("id", "label", "position", "height"), where)
    else:
        _require_keys(mapping, ("id", "label", "position", "scale"), where)
    object_id = _text(mapping["id"], f"{where}.id", identifier=True)
    _text(mapping["label"], f"{where}.label")
    _vector(mapping["position"], f"{where}.position")
    if actor:
        height = _finite_number(mapping["height"], f"{where}.height")
        if height < 0.5 or height > 3.0:
            raise ProtocolError(f"{where}.height must be between 0.5 and 3")
    else:
        dimensions = _dimensions(mapping["scale"], f"{where}.scale")
        if any(item < 0.05 for item in dimensions):
            raise ProtocolError(f"{where}.scale values must be at least 0.05")
    return object_id


def validate_scene(scene: Any) -> Dict[str, Any]:
    """Validate and return a deep-copied scene specification.

    The returned value contains only JSON values and cannot alias a caller's
    mutable object.  Unknown fields are rejected at every schema level.
    """

    root = _require_mapping(scene, "scene")
    _require_keys(
        root,
        (
            "version",
            "projectId",
            "shotId",
            "sceneId",
            "locationId",
            "label",
            "room",
            "landmarks",
            "actors",
            "props",
            "camera",
            "render",
        ),
        "scene",
    )
    if root["version"] != PROTOCOL_VERSION:
        raise ProtocolError("scene.version must be 1")
    for field in ("projectId", "shotId", "sceneId", "locationId"):
        _text(root[field], f"scene.{field}", identifier=True)
    _text(root["label"], "scene.label")

    room = _require_mapping(root["room"], "scene.room")
    _require_keys(room, ("width", "depth", "height"), "scene.room")
    for field, low, high in (
        ("width", 2.0, 50.0),
        ("depth", 2.0, 50.0),
        ("height", 2.0, 12.0),
    ):
        number = _finite_number(room[field], f"scene.room.{field}")
        if number < low or number > high:
            raise ProtocolError(f"scene.room.{field} must be between {low:g} and {high:g}")

    seen_ids = set()
    for field, limit, actor in (
        ("landmarks", 8, False),
        ("actors", 4, True),
        ("props", 8, False),
    ):
        values = root[field]
        if not isinstance(values, list):
            raise ProtocolError(f"scene.{field} must be an array")
        if len(values) > limit:
            raise ProtocolError(f"scene.{field} cannot contain more than {limit} items")
        for index, item in enumerate(values):
            object_id = _validate_object(item, f"scene.{field}[{index}]", actor=actor)
            if object_id in seen_ids:
                raise ProtocolError(f"duplicate object id: {object_id}")
            seen_ids.add(object_id)

    camera = _require_mapping(root["camera"], "scene.camera")
    _require_keys(camera, ("position", "target", "focalLength", "sensorWidth"), "scene.camera")
    position = _vector(camera["position"], "scene.camera.position")
    target = _vector(camera["target"], "scene.camera.target")
    deltas = tuple(target[index] - position[index] for index in range(3))
    if math.hypot(*deltas) < 0.01:
        raise ProtocolError("scene.camera must look at a different position")
    focal_length = _finite_number(camera["focalLength"], "scene.camera.focalLength")
    if focal_length < 8.0 or focal_length > 200.0:
        raise ProtocolError("scene.camera.focalLength must be between 8 and 200")
    sensor_width = _finite_number(camera["sensorWidth"], "scene.camera.sensorWidth")
    # The proof uses the standard 36 mm full-frame sensor.  Keeping this
    # explicit prevents a caller from quietly changing the camera model.
    if abs(sensor_width - 36.0) > 1e-9:
        raise ProtocolError("scene.camera.sensorWidth must be 36")

    render = _require_mapping(root["render"], "scene.render")
    _require_keys(render, ("width", "height", "samples"), "scene.render")
    _integer(render["width"], "scene.render.width", 128, 768)
    _integer(render["height"], "scene.render.height", 128, 768)
    _integer(render["samples"], "scene.render.samples", 1, 32)

    # JSON round-tripping ensures callers cannot retain references into the
    # validated value and also rejects non-standard Python scalar objects.
    try:
        frozen = json.loads(canonical_json(root))
    except (TypeError, ValueError) as exc:
        raise ProtocolError(f"scene is not canonical JSON: {exc}") from exc
    return frozen


def _js_number(value: float) -> str:
    """Serialize one finite Python float like JSON.stringify."""

    if value == 0.0:
        return "0"
    negative = value < 0
    unsigned = -value if negative else value
    raw = repr(unsigned).lower()
    if raw.endswith(".0"):
        raw = raw[:-2]
    mantissa, separator, exponent_text = raw.partition("e")
    exponent = int(exponent_text) if separator else 0
    if "." in mantissa:
        whole, fraction = mantissa.split(".", 1)
        digits = whole + fraction
        decimal_index = len(whole) + exponent
    else:
        digits = mantissa
        decimal_index = len(mantissa) + exponent
    leading_zeroes = len(digits) - len(digits.lstrip("0"))
    digits = digits.lstrip("0") or "0"
    decimal_index -= leading_zeroes
    # JSON.stringify uses fixed notation for 1e-6 <= abs(x) < 1e21.
    if 1e-6 <= unsigned < 1e21:
        if decimal_index <= 0:
            result = "0." + ("0" * (-decimal_index)) + digits
        elif decimal_index >= len(digits):
            result = digits + ("0" * (decimal_index - len(digits)))
        else:
            result = digits[:decimal_index] + "." + digits[decimal_index:]
    else:
        # Scientific notation keeps one digit before the decimal and uses a
        # signed exponent only when it is positive, matching JS output.
        scientific_exponent = decimal_index - 1
        coefficient = digits[0]
        if len(digits) > 1:
            coefficient += "." + digits[1:]
        sign = "+" if scientific_exponent >= 0 else "-"
        result = coefficient + "e" + sign + str(abs(scientific_exponent))
        if scientific_exponent < 0:
            result = coefficient + "e-" + str(abs(scientific_exponent))
    return ("-" if negative else "") + result


def canonical_json(value: Any) -> str:
    """Return the exact compact, recursively key-sorted JSON representation."""

    def canonical_value(current: Any) -> Any:
        # JSON.stringify (used by the browser contract) writes integral
        # numbers without a trailing ".0".  Normalize those values so a
        # browser-created 50 and Python-read 50.0 have the same scene hash.
        if isinstance(current, float):
            if not math.isfinite(current):
                raise ProtocolError("value contains a non-finite number")
            return current
        if isinstance(current, list):
            return [canonical_value(item) for item in current]
        if isinstance(current, dict):
            return {key: canonical_value(current[key]) for key in sorted(current)}
        return current

    def serialize(current: Any) -> str:
        current = canonical_value(current)
        if current is None:
            return "null"
        if current is True:
            return "true"
        if current is False:
            return "false"
        if isinstance(current, float):
            return _js_number(current)
        if isinstance(current, int):
            return str(current)
        if isinstance(current, str):
            return json.dumps(current, ensure_ascii=False, separators=(",", ":"))
        if isinstance(current, list):
            return "[" + ",".join(serialize(item) for item in current) + "]"
        if isinstance(current, dict):
            # JS Array#sort compares UTF-16 code units. This matters only for
            # unusual non-ASCII property names, but keeps corpus hashes exact.
            keys = sorted(current.keys(), key=lambda key: str(key).encode("utf-16-be", "surrogatepass"))
            if any(not isinstance(key, str) for key in keys):
                raise ProtocolError("object keys must be strings")
            return "{" + ",".join(
                serialize(str(key)) + ":" + serialize(current[key]) for key in keys
            ) + "}"
        raise ProtocolError(f"value is not canonical JSON: {type(current).__name__}")

    try:
        return serialize(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ProtocolError(f"value is not canonical JSON: {exc}") from exc


def scene_hash(scene: Any) -> str:
    validated = validate_scene(scene)
    return hashlib.sha256(canonical_json(validated).encode("utf-8")).hexdigest()


def _close_enough(left: float, right: float, tolerance: float = 1e-4) -> bool:
    return abs(float(left) - float(right)) <= tolerance


def validate_actual_camera(actual: Any, requested: Mapping[str, Any]) -> Dict[str, Any]:
    """Validate Blender's camera readback against the frozen request."""

    actual_mapping = _require_mapping(actual, "actualCamera")
    _require_keys(
        actual_mapping,
        ("position", "direction", "focalLength", "sensorWidth", "width", "height"),
        "actualCamera",
    )
    position = _vector(actual_mapping["position"], "actualCamera.position")
    direction = _vector(
        actual_mapping["direction"],
        "actualCamera.direction",
        low=-1.001,
        high=1.001,
    )
    direction_length = math.sqrt(sum(component * component for component in direction))
    if not 0.98 <= direction_length <= 1.02:
        raise ProtocolError("actualCamera.direction must be normalized")
    focal_length = _finite_number(actual_mapping["focalLength"], "actualCamera.focalLength")
    sensor_width = _finite_number(actual_mapping["sensorWidth"], "actualCamera.sensorWidth")
    width = _integer(actual_mapping["width"], "actualCamera.width", 128, 768)
    height = _integer(actual_mapping["height"], "actualCamera.height", 128, 768)
    requested_camera = _require_mapping(requested["camera"], "scene.camera")
    requested_render = _require_mapping(requested["render"], "scene.render")
    requested_position = _vector(requested_camera["position"], "scene.camera.position")
    requested_target = _vector(requested_camera["target"], "scene.camera.target")
    target_delta = tuple(
        requested_target[index] - requested_position[index] for index in range(3)
    )
    target_length = math.sqrt(sum(component * component for component in target_delta))
    expected_direction = tuple(component / target_length for component in target_delta)
    if any(not _close_enough(position[index], requested_position[index], 1e-3) for index in range(3)):
        raise ProtocolError("actualCamera.position does not match the requested camera")
    if any(not _close_enough(direction[index], expected_direction[index], 1e-3) for index in range(3)):
        raise ProtocolError("actualCamera.direction does not match the requested camera")
    if not _close_enough(focal_length, float(requested_camera["focalLength"]), 1e-3):
        raise ProtocolError("actualCamera.focalLength does not match the requested camera")
    if not _close_enough(sensor_width, float(requested_camera["sensorWidth"]), 1e-3):
        raise ProtocolError("actualCamera.sensorWidth does not match the requested camera")
    if width != requested_render["width"] or height != requested_render["height"]:
        raise ProtocolError("actualCamera dimensions do not match the requested render")
    return {
        "position": list(position),
        "direction": list(direction),
        "focalLength": focal_length,
        "sensorWidth": sensor_width,
        "width": width,
        "height": height,
    }


def validate_png_bytes(
    png_bytes: bytes,
    width: Optional[int] = None,
    height: Optional[int] = None,
) -> None:
    """Validate the bounded, non-animated PNG form accepted by the relay."""

    if not isinstance(png_bytes, bytes) or len(png_bytes) < 57:
        raise ProtocolError("renderer did not produce a PNG")
    if not png_bytes.startswith(_PNG_SIGNATURE):
        raise ProtocolError("renderer did not produce a PNG")
    if len(png_bytes) > 2 * 1024 * 1024:
        raise ProtocolError("PNG result is too large")
    position = 8
    saw_header = False
    saw_data = False
    saw_end = False
    found_width = found_height = 0
    while position + 12 <= len(png_bytes):
        chunk_length = struct.unpack(">I", png_bytes[position : position + 4])[0]
        end = position + 12 + chunk_length
        if end > len(png_bytes):
            raise ProtocolError("PNG chunk is truncated")
        chunk_type = png_bytes[position + 4 : position + 8]
        chunk_data = png_bytes[position + 8 : position + 8 + chunk_length]
        expected_crc = struct.unpack(">I", png_bytes[position + 8 + chunk_length : end])[0]
        if (zlib.crc32(png_bytes[position + 4 : position + 8 + chunk_length]) & 0xFFFFFFFF) != expected_crc:
            raise ProtocolError("PNG checksum failed")
        if position == 8 and chunk_type != b"IHDR":
            raise ProtocolError("PNG is missing its header")
        if chunk_type == b"IHDR":
            if saw_header or chunk_length != 13:
                raise ProtocolError("PNG has an invalid header")
            found_width, found_height = struct.unpack(">II", chunk_data[:8])
            bit_depth, color_type, compression, filtering, interlace = chunk_data[8:13]
            if (
                not 128 <= found_width <= 768
                or not 128 <= found_height <= 768
                or bit_depth != 8
                or color_type not in (2, 6)
                or compression != 0
                or filtering != 0
                or interlace != 0
            ):
                raise ProtocolError("PNG has unsupported dimensions or format")
            saw_header = True
        if chunk_type == b"acTL":
            raise ProtocolError("animated PNGs are not supported")
        if chunk_type == b"IDAT" and chunk_length:
            saw_data = True
        if chunk_type == b"IEND":
            if chunk_length or end != len(png_bytes) or not saw_data:
                raise ProtocolError("PNG has an invalid ending")
            saw_end = True
        position = end
    if not saw_header or not saw_end:
        raise ProtocolError("PNG is incomplete")
    if width is not None and found_width != width:
        raise ProtocolError("PNG width does not match the requested render")
    if height is not None and found_height != height:
        raise ProtocolError("PNG height does not match the requested render")


def encode_png(
    png_bytes: bytes,
    width: Optional[int] = None,
    height: Optional[int] = None,
) -> str:
    validate_png_bytes(png_bytes, width, height)
    return base64.b64encode(png_bytes).decode("ascii")


def parse_expiry(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def endpoint_url(value: str) -> str:
    """Validate a user-entered HTTPS edge-function URL.

    Blender is a client only; local HTTP/listener URLs are intentionally
    rejected so pairing cannot turn the add-on into a local service.
    """

    if not isinstance(value, str):
        raise ProtocolError("edge function URL must be a string")
    parsed = urlparse(value.strip())
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise ProtocolError("edge function URL must use HTTPS")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.params:
        raise ProtocolError("edge function URL cannot contain credentials, query, or fragment")
    host = (parsed.hostname or "").lower()
    if not re.match(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co$", host):
        raise ProtocolError("edge function URL must be a Supabase Edge Function")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ProtocolError("edge function URL has an invalid port") from exc
    if port not in (None, 443):
        raise ProtocolError("edge function URL must use the standard HTTPS port")
    if parsed.path != "/functions/v1/blender-bridge":
        raise ProtocolError("edge function URL must target blender-bridge")
    return value.strip().rstrip("/")


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, _request: Any, _fp: Any, _code: int, _msg: str, _headers: Any, _newurl: str):
        # A user-entered endpoint may not redirect credentials to another
        # origin. Redirects are surfaced as ordinary HTTP errors instead.
        return None


def _open_https(opener: Any, request: Request, timeout: float) -> Any:
    """Indirection used by transport tests without bypassing header creation."""

    return opener.open(request, timeout=timeout)


def _json_response(raw: bytes) -> Dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BridgeError("bridge returned invalid JSON", "invalid_json") from exc
    if not isinstance(value, dict):
        raise BridgeError("bridge returned a non-object response", "invalid_response")
    return value


class BridgeClient:
    """Small HTTPS-only client for the documented edge-function actions."""

    def __init__(self, base_url: str, token: Optional[str] = None, timeout: float = 30.0):
        self.base_url = endpoint_url(base_url)
        self.token = token
        self.timeout = max(2.0, min(float(timeout), 60.0))
        self._ssl_context = ssl.create_default_context()
        self._opener = build_opener(
            _NoRedirectHandler(),
            HTTPSHandler(context=self._ssl_context),
        )

    def _request(self, method: str, payload: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        body = None
        headers = {"Accept": "application/json"}
        if self.token:
            # The relay distinguishes scoped desktop tokens from browser
            # Supabase access tokens.  A browser token is never accepted here
            # and is never available to this package.
            headers["Authorization"] = "Device " + self.token
        if method == "POST":
            body = json.dumps(dict(payload or {}), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(self.base_url, data=body, headers=headers, method=method)
        try:
            with _open_https(self._opener, request, self.timeout) as response:
                return _json_response(response.read())
        except HTTPError as exc:
            try:
                details = _json_response(exc.read())
                message = str(details.get("error", "bridge request failed"))
                code = str(details.get("code", "http_error"))
            except BridgeError:
                message, code = "bridge request failed", "http_error"
            raise BridgeHTTPError(message, code, exc.code) from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise BridgeNetworkError("bridge network request outcome is unknown", "network_error") from exc

    def capabilities(self) -> Dict[str, Any]:
        return self._request("GET")

    def post(self, action: str, **fields: Any) -> Dict[str, Any]:
        payload = {"action": action}
        payload.update(fields)
        return self._request("POST", payload)

    def device_connect(self, pair_code: str, device_name: str) -> Dict[str, Any]:
        return self.post("device.connect", pairCode=pair_code, deviceName=device_name)

    def connection_get(self, project_id: str) -> Dict[str, Any]:
        return self.post("connection.get", projectId=project_id)

    def connection_disconnect(self, project_id: str) -> Dict[str, Any]:
        return self.post("connection.disconnect", projectId=project_id)

    def device_claim(self) -> Dict[str, Any]:
        return self.post("device.claim")

    def job_get(self, project_id: str, job_id: str) -> Dict[str, Any]:
        return self.post("job.get", projectId=project_id, jobId=job_id)

    def job_cancel(self, project_id: str, job_id: str) -> Dict[str, Any]:
        return self.post("job.cancel", projectId=project_id, jobId=job_id)

    def device_fail(self, job_id: str, lease_token: str, error: Mapping[str, Any]) -> Dict[str, Any]:
        return self.post("device.fail", jobId=job_id, leaseToken=lease_token, error=dict(error))

    def device_complete(
        self,
        job_id: str,
        lease_token: str,
        png_base64: str,
        actual_camera: Mapping[str, Any],
    ) -> Dict[str, Any]:
        return self.post(
            "device.complete",
            jobId=job_id,
            leaseToken=lease_token,
            pngBase64=png_base64,
            actualCamera=dict(actual_camera),
        )


def is_ambiguous_network_error(error: BaseException) -> bool:
    """Whether a completion may have reached the relay despite an error."""

    return isinstance(error, BridgeNetworkError)
