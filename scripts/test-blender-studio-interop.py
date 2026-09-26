"""Headless packaged-add-on Studio interoperability runner.

Only this test process accepts its loopback URL.  It still uses the packaged
BridgeClient's request construction and urllib transport, plus StudioRuntime,
studio_protocol, and native studio_scene APIs against the actual JS relay.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import tempfile
import threading
import time
import zipfile
from typing import Any, Callable, Dict


def fail(message: str) -> None:
    raise RuntimeError(message)


def write_marker(path: str, value: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as output:
        json.dump(value, output)


def malicious_external_uri_glb() -> bytes:
    """A structurally complete GLB whose JSON tries to escape via ``uri``."""
    document = json.dumps({
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": 0, "uri": "https://attacker.test/mesh.bin"}],
    }, separators=(",", ":")).encode("utf-8")
    document += b" " * ((4 - len(document) % 4) % 4)
    total = 12 + 8 + len(document)
    return b"glTF" + (2).to_bytes(4, "little") + total.to_bytes(4, "little") + \
        len(document).to_bytes(4, "little") + b"JSON" + document


def wait_for(runtime: Any, condition: Callable[[Dict[str, Any]], bool], label: str, seconds: float = 30.0) -> Dict[str, Any]:
    deadline = time.time() + seconds
    last: Dict[str, Any] = runtime.snapshot()
    while time.time() < deadline:
        runtime.pump()
        last = runtime.snapshot()
        if last.get("status") == "Studio error":
            fail("%s: %s" % (label, last.get("detail", "unknown Studio protocol error")))
        if last.get("status") == "Studio task failed":
            task = last.get("task") or {}
            fail("%s: %s" % (label, task.get("error") or last.get("detail", "Studio task failed")))
        if condition(last):
            return last
        time.sleep(0.025)
    fail("%s timed out (status=%s detail=%s)" % (label, last.get("status"), last.get("detail")))


def main() -> int:
    endpoint = os.environ["CM_STUDIO_TEST_ENDPOINT"]
    marker = os.environ["CM_STUDIO_TEST_MARKER"]
    command = os.environ["CM_STUDIO_TEST_COMMAND"]
    pair_code = os.environ["CM_STUDIO_TEST_PAIR_CODE"]
    with tempfile.TemporaryDirectory(prefix="cinema-machine-studio-addon-") as extracted:
        with zipfile.ZipFile(os.environ["CM_STUDIO_TEST_ZIP"]) as archive:
            archive.extractall(extracted)
        sys.path.insert(0, extracted)
        import bpy  # type: ignore
        import cinema_machine_bridge.protocol as protocol  # type: ignore
        from cinema_machine_bridge import studio_scene  # type: ignore
        from cinema_machine_bridge.studio_runtime import StudioRuntime  # type: ignore

        def local_endpoint(value: str) -> str:
            if value != endpoint:
                raise protocol.ProtocolError("unexpected Studio interop endpoint")
            return value.rstrip("/")

        # This is the sole policy override: production source remains HTTPS
        # only and no test fixture replaces BridgeClient or urllib transport.
        protocol.endpoint_url = local_endpoint
        client = protocol.BridgeClient(endpoint)
        connected = client.device_connect(pair_code, "Studio Interop Blender")
        token, project_id = connected.get("deviceToken"), connected.get("projectId")
        if not isinstance(token, str) or not token or not isinstance(project_id, str) or not project_id:
            fail("v1 device.connect envelope omitted scoped device credentials")
        client.token = token

        class Bridge:
            def __init__(self) -> None:
                self.lock = threading.RLock()
                self.network_lock = threading.Lock()
                self.client = client
                self.project_id = project_id
                self.generation = 1

            def _current(self, generation: int) -> bool:
                return generation == self.generation and self.client is not None

        bridge = Bridge()
        runtime = StudioRuntime(bridge)
        try:
            runtime.request_capabilities()
            state = wait_for(runtime, lambda item: item.get("status") == "Studio capabilities ready", "native capabilities")
            if not any(item.get("modelId") == "claude-fable-5" and item.get("verified") for item in state["capabilities"].get("models", ())):
                fail("StudioRuntime capabilities omitted verified native assistant model")
            if state["capabilities"].get("billingReady") is not True:
                fail("real Studio capabilities did not advertise the fake atomic billing boundary")

            runtime.request_current()
            state = wait_for(runtime, lambda item: isinstance(item.get("workspace"), dict), "native current workspace")
            workspace = state["workspace"]
            if state.get("shotId") != "shot-arrival":
                fail("studio.workspace.current did not preserve browser canonical shot selection")
            studio_scene.open_workspace(bpy.context.scene, workspace)

            # The real DTO requires an explicit acknowledgement; verify that
            # omission is a native validation error before sending the
            # cost-approved request used by this free provider-bound test.
            runtime.request_assistant("scene", "claude-fable-5", "Add the reviewed reception blocking.", workspace)
            if runtime.snapshot().get("detail") != "Confirm the displayed cost before submitting":
                fail("StudioRuntime did not enforce explicit assistant cost acknowledgement")
            runtime.request_assistant("scene", "claude-fable-5", "Add the reviewed reception blocking.", workspace, acknowledge_cost=True)
            state = wait_for(runtime, lambda item: isinstance(item.get("proposal"), dict), "assistant proposal")
            proposal = state["proposal"]
            if not proposal.get("ops") or not state.get("history"):
                fail("StudioRuntime discarded real assistant proposal or history")
            local = studio_scene.apply_proposal(bpy.context.scene, workspace, proposal)
            tracked = next((item for shot in local["shots"] for item in shot["tracks"] if item["objectId"] == "arrival-marker"), None)
            if not tracked or [key["frame"] for key in tracked["keyframes"]] != [1, 12]:
                fail("native typed keyframe track was not applied and captured")
            arrival_camera = next((
                item for item in bpy.context.scene.objects
                if item.get(studio_scene.STUDIO_KIND_KEY) == "camera" and
                item.get(studio_scene.STUDIO_SHOT_KEY) == "shot-arrival"
            ), None)
            if arrival_camera is None:
                fail("first canonical shot did not materialize a managed camera")
            arrival_camera.location.x += .5  # A real local camera edit that a later browser open must retain.
            moved = next((item for item in bpy.context.scene.objects if item.get("cinemaMachineStudioObjectId") == "reception-box"), None)
            if moved is None:
                fail("assistant proposal did not create stable managed set object")
            moved.location.x = 3.25  # Actual local Blender edit, not a JSON fixture.
            local = studio_scene.workspace_snapshot(bpy.context.scene, local)
            if next(item for item in local["objects"] if item["id"] == "reception-box")["position"][0] != 3.25:
                fail("manual managed Blender edit was not captured for save")
            if next(shot for shot in local["shots"] if shot["id"] == "shot-arrival")["camera"]["position"][0] != 5.5:
                fail("manual first-shot camera edit was not captured for save")
            runtime.set_local_workspace(local)
            runtime.request_save(local)
            state = wait_for(runtime, lambda item: isinstance(item.get("workspace"), dict) and item["workspace"].get("revision", 0) > workspace["revision"], "native workspace save")
            write_marker(marker, {"ok": True, "stage": "saved-first-shot"})

            deadline = time.time() + 45
            while not os.path.exists(command) and time.time() < deadline:
                time.sleep(.05)
            if not os.path.exists(command):
                fail("browser did not select and save the second canonical shot")
            runtime.request_current()
            state = wait_for(runtime, lambda item: item.get("shotId") == "shot-reverse", "native reopen selected second shot")
            reopened = state["workspace"]
            studio_scene.open_workspace(bpy.context.scene, reopened)
            preserved = next((item for item in bpy.context.scene.objects if item.get("cinemaMachineStudioObjectId") == "reception-box"), None)
            if preserved is None or abs(preserved.location.x - 3.25) > .0001:
                fail("opening second shot recreated or lost local saved set geometry")
            if "shot-reverse" not in {shot["id"] for shot in reopened["shots"]}:
                fail("second canonical shot is absent after native reopen")
            studio_scene.activate_workspace_shot(bpy.context.scene, reopened, "shot-reverse")

            # Cancellation goes through StudioRuntime, rather than a hand-made
            # cancellation envelope.  The provider remains queued at its own
            # boundary until this real client asks to cancel it.
            runtime.request_mesh("meshy/v7/image-to-3d", "Cancelled mesh", prompt="cancel mesh", reference_id=workspace["locationId"], acknowledge_cost=True)
            wait_for(runtime, lambda item: item.get("task", {}).get("status") == "queued", "queued mesh task")
            runtime.request_cancel_task()
            wait_for(runtime, lambda item: item.get("task", {}).get("status") == "cancelled", "native mesh cancellation")
            runtime.request_mesh("meshy/v7/image-to-3d", "Interop triangle", prompt="make triangle", reference_id=workspace["locationId"], acknowledge_cost=True)
            pending = wait_for(runtime, lambda item: item.get("task", {}).get("status") == "settlement_pending",
                "validated Meshy stage awaiting settlement")
            pending_task_id = pending["task"].get("id")
            if not isinstance(pending_task_id, str):
                fail("settlement-pending mesh response omitted its existing task ID")
            # This is the native Retry credit settlement/Refresh action.  It
            # must reconcile the same staged task, not issue another paid mesh
            # submission or recreate the provider job.
            runtime.request_task()
            completed = wait_for(runtime, lambda item: item.get("task", {}).get("status") == "completed",
                "same-task Meshy credit settlement retry")
            if completed["task"].get("id") != pending_task_id:
                fail("credit settlement retry completed a different mesh task")
            asset_id = completed["task"].get("asset", {}).get("id")
            if not isinstance(asset_id, str):
                fail("completed mesh task omitted authenticated asset metadata")
            runtime.request_workspace(reopened["locationId"])
            state = wait_for(runtime, lambda item: any(asset["id"] == asset_id for asset in item.get("workspace", {}).get("assets", ())), "asset workspace refresh")
            runtime.request_asset(asset_id)
            state = wait_for(runtime, lambda item: isinstance(item.get("asset"), dict), "authenticated asset retrieval")
            asset_response = state["asset"]
            glb = base64.b64decode(asset_response["base64"], validate=True)
            if hashlib.sha256(glb).hexdigest() != asset_response["asset"]["sha256"]:
                fail("authenticated GLB bytes do not match real relay metadata")
            imported = studio_scene.import_workspace_asset(bpy.context.scene, state["workspace"], asset_response["asset"], glb)
            if not imported.get("imported") or not imported.get("root"):
                fail("native Blender GLB import did not create a managed asset")
            try:
                studio_scene._validate_glb_bytes(malicious_external_uri_glb())  # type: ignore[attr-defined]
            except studio_scene.StudioSceneError:
                pass
            else:
                fail("native GLB verifier accepted a GLB with an external URI")

            # Follow the actual desktop UI flow: bound the local scene first,
            # then use the native auxiliary-preview renderer and the public
            # StudioRuntime publish method.  No handwritten PNG is accepted.
            scene = bpy.context.scene
            scene.render.engine = "CYCLES"
            scene.cycles.device = "CPU"
            scene.cycles.samples = 1
            scene.render.resolution_x = 128
            scene.render.resolution_y = 128
            scene.render.resolution_percentage = 100
            preview = studio_scene.render_auxiliary_preview(scene)
            if not isinstance(preview.get("pngBase64"), str) or not isinstance(preview.get("actualCamera"), dict):
                fail("native auxiliary preview did not return publishable PNG/camera data")
            local = studio_scene.workspace_snapshot(scene, runtime.snapshot()["workspace"])
            runtime.set_local_workspace(local)
            runtime.request_preview(local, preview["pngBase64"], preview["actualCamera"])
            wait_for(runtime, lambda item: item.get("status") == "Auxiliary preview published", "native preview publish")
            write_marker(marker, {"ok": True, "stage": "finished"})
            return 0
        finally:
            try:
                client.connection_disconnect(project_id)
            except Exception:
                pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        try:
            write_marker(os.environ["CM_STUDIO_TEST_MARKER"], {"ok": False, "stage": "finished", "error": str(error)[:500]})
        except Exception:
            pass
        raise
