"""In-process bridge transport integration for the built add-on ZIP.

This is not a live request. It replaces only the HTTPS transport function with
a recorder that receives urllib Request objects produced by BridgeClient.
Consequently Authorization headers are tested as constructed by the actual
add-on, rather than manually injected into a fake protocol call.

Run:
    blender --background --factory-startup --python scripts/test-blender-addon-integration.py
"""

from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import time
import zipfile

import bpy  # type: ignore


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP_PATH = os.path.join(ROOT, "app", "downloads", "cinema-machine-blender.zip")


def spec():
    return {
        "version": 1,
        "projectId": "_project",
        "shotId": "-shot",
        "sceneId": "scene_1",
        "locationId": "location_1",
        "label": "https://labels.example/are-text-only",
        "room": {"width": 3.3333333333333335, "depth": 12, "height": 4},
        "landmarks": [],
        "actors": [],
        "props": [],
        "camera": {
            "position": [0, -6, 1.65],
            "target": [0, 0, 1.4],
            "focalLength": 50,
            "sensorWidth": 36,
        },
        "render": {"width": 640, "height": 360, "samples": 16},
    }


class Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def main():
    if not os.path.isfile(ZIP_PATH):
        raise AssertionError("build the add-on ZIP before running integration")
    with tempfile.TemporaryDirectory(prefix="cinema-machine-addon-") as extracted:
        with zipfile.ZipFile(ZIP_PATH) as archive:
            archive.extractall(extracted)
        sys.path.insert(0, extracted)
        import cinema_machine_bridge as addon  # type: ignore
        from cinema_machine_bridge import protocol  # type: ignore

        validated = protocol.validate_scene(spec())
        records = []
        token = "bbd1.test-device-token"

        def transport(_opener, request, timeout):
            del timeout
            body = {}
            if request.data:
                body = json.loads(request.data.decode("utf-8"))
            action = body.get("action", "GET")
            authorization = request.headers.get("Authorization")
            records.append(
                {
                    "action": action,
                    "authorization": authorization,
                    "body": body,
                    "url": request.full_url,
                }
            )
            if action == "device.connect":
                return Response(
                    {
                        "deviceToken": token,
                        "projectId": "_project",
                        "expiresAt": "2999-01-01T00:00:00Z",
                    }
                )
            if action == "device.claim":
                return Response(
                    {
                        "job": {
                            "id": "job-1",
                            "status": "running",
                            "spec": validated,
                            "specHash": protocol.scene_hash(validated),
                        },
                        "leaseToken": "lease-1",
                    }
                )
            if action == "job.get":
                return Response({"job": {"id": "job-1", "status": "running"}})
            if action == "device.complete":
                return Response({"job": {"id": "job-1", "status": "completed"}})
            if action == "connection.disconnect":
                return Response({"disconnected": True})
            raise AssertionError("unexpected bridge action: " + str(action))

        original_transport = protocol._open_https
        protocol._open_https = transport
        original_render = addon.renderer.render_preview
        delta = [
            validated["camera"]["target"][index] - validated["camera"]["position"][index]
            for index in range(3)
        ]
        length = sum(value * value for value in delta) ** 0.5
        direction = [value / length for value in delta]

        def fake_render(_spec):
            return {
                "sceneName": "Kinolot Proof",
                "pngBytes": b"",
                "pngBase64": base64.b64encode(b"test-png").decode("ascii"),
                "actualCamera": {
                    "position": list(validated["camera"]["position"]),
                    "direction": direction,
                    "focalLength": 50,
                    "sensorWidth": 36,
                    "width": 640,
                    "height": 360,
                },
                "specHash": protocol.scene_hash(validated),
            }

        addon.renderer.render_preview = fake_render
        runtime = addon.BridgeRuntime()
        try:
            endpoint = "https://project.supabase.co/functions/v1/blender-bridge"
            runtime.request_connect(endpoint, "opaque pair code / not numeric", "Integration Desktop")
            deadline = time.time() + 8
            while time.time() < deadline:
                runtime.pump()
                if any(record["action"] == "device.complete" for record in records):
                    break
                time.sleep(0.02)
            if not any(record["action"] == "device.complete" for record in records):
                raise AssertionError("BridgeRuntime did not reach device.complete")
            runtime.request_disconnect()
            deadline = time.time() + 3
            while time.time() < deadline:
                runtime.pump()
                if any(record["action"] == "connection.disconnect" for record in records):
                    break
                time.sleep(0.02)
        finally:
            runtime.request_disconnect()
            addon.renderer.render_preview = original_render
            protocol._open_https = original_transport

        actions = [record["action"] for record in records]
        if actions[:4] != ["device.connect", "device.claim", "job.get", "device.complete"]:
            raise AssertionError("unexpected integration action order: " + repr(actions))
        for record in records[1:]:
            if record["authorization"] != "Device " + token:
                raise AssertionError("scoped Device authorization was not constructed by the client")
        if records[0]["authorization"] is not None:
            raise AssertionError("pairing request unexpectedly sent an Authorization header")
        if not any(record["action"] == "connection.disconnect" for record in records):
            raise AssertionError("disconnect did not use the recorded HTTPS transport")
        if runtime.token is not None or runtime.client is not None:
            raise AssertionError("disconnect did not clear the in-memory token")
        print("BLENDER_ADDON_RUNTIME_INTEGRATION_OK", " ".join(actions))


if __name__ == "__main__":
    main()
