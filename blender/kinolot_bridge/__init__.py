"""Kinolot Bridge: the Blender desktop add-on for Kinolot by Infinite Studio AI.

Shown in Blender as "Kinolot Bridge" (sidebar tab "Kinolot"). Since 1.1.0 (owner
2026-10-26) the Python package is ``kinolot_bridge`` and the operator ids
``kinolot.*``; Blender sees it as a new add-on, so on enable it switches off an
older install still named ``cinema_machine_bridge`` (``_retire_old_addon``) and
its panel says to remove it. The custom properties it stores in .blend files keep
their ``cinemaMachine*`` keys, so scenes saved with the older add-on still open.

The add-on is intentionally a legacy-installable package (rather than a
Blender extension manifest).  It supports Blender 4.2 and newer, makes only
outbound HTTPS requests, and keeps its device token in this process's memory.
"""

from __future__ import annotations

import datetime as _datetime
import base64
import os
import queue
import threading
import time
from typing import Any, Dict, Mapping, Optional

import bpy  # type: ignore
from bpy.props import BoolProperty, EnumProperty, StringProperty  # type: ignore

from . import renderer
from . import studio_scene
from .protocol import (
    BridgeClient,
    BridgeError,
    BridgeNetworkError,
    ProtocolError,
    endpoint_url,
    is_ambiguous_network_error,
    parse_expiry,
    scene_hash,
    validate_actual_camera,
    validate_scene,
)
from .studio_protocol import StudioProtocolError, validate_image_data_url
from .studio_runtime import StudioRuntime


bl_info = {
    "name": "Kinolot Bridge",
    "author": "Infinite Studio AI",
    "version": (1, 1, 0),
    "blender": (4, 2, 0),
    "location": "3D View > Sidebar > Kinolot",
    "description": "Render an approved editable Blender proof through the Kinolot bridge",
    "category": "3D View",
}


def _now_utc() -> _datetime.datetime:
    return _datetime.datetime.now(_datetime.timezone.utc)


def _safe_error(error: BaseException) -> str:
    # Error text is user-visible, but never expose an Authorization header or
    # a full request URL.  The relay's error/code is still displayed honestly.
    message = str(error).replace("\r", " ").replace("\n", " ")
    if len(message) > 240:
        message = message[:237] + "..."
    return message or error.__class__.__name__


def _result_text(value: Any, where: str, max_length: int = 256) -> str:
    if not isinstance(value, str) or not value or len(value) > max_length:
        raise ProtocolError(f"bridge response has invalid {where}")
    return value


class BridgeRuntime:
    """Coordinates worker-thread HTTPS and main-thread Blender work."""

    def __init__(self) -> None:
        self.events: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        self.lock = threading.RLock()
        self.network_lock = threading.Lock()
        self.stop_event = threading.Event()
        self.poll_thread: Optional[threading.Thread] = None
        self.client: Optional[BridgeClient] = None
        self.endpoint: str = ""
        self.token: Optional[str] = None
        self.project_id: str = ""
        self.expires_at: Optional[str] = None
        self.status: str = "Disconnected"
        self.detail: str = ""
        self.active_job: Optional[Dict[str, Any]] = None
        self.generation = 0
        self._timer_registered = False

    def snapshot(self) -> Dict[str, Any]:
        with self.lock:
            active = dict(self.active_job) if self.active_job else None
            return {
                "status": self.status,
                "detail": self.detail,
                "projectId": self.project_id,
                "expiresAt": self.expires_at,
                "activeJob": active,
                "connected": bool(self.token and self.client),
            }

    def _set_status(self, status: str, detail: str = "") -> None:
        with self.lock:
            self.status = status
            self.detail = detail

    def _current(self, generation: int) -> bool:
        with self.lock:
            return generation == self.generation and bool(self.token and self.client)

    def request_connect(self, endpoint: str, pair_code: str, device_name: str) -> None:
        try:
            endpoint = endpoint_url(endpoint)
        except ProtocolError as error:
            self._set_status("Error", _safe_error(error))
            return
        if not isinstance(pair_code, str) or not pair_code.strip() or len(pair_code) > 512:
            self._set_status("Error", "Enter a valid one-time pairing code")
            return
        if not isinstance(device_name, str) or not device_name.strip() or len(device_name) > 120:
            self._set_status("Error", "Enter a device name")
            return
        with self.lock:
            self.stop_event.set()
            self.generation += 1
            generation = self.generation
            self.stop_event = threading.Event()
            self.endpoint = endpoint
            self.token = None
            self.client = None
            self.project_id = ""
            self.expires_at = None
            self.active_job = None
            self.status = "Connecting"
            self.detail = "Waiting for bridge response"
            self.poll_thread = None
            stop_event = self.stop_event
        thread = threading.Thread(
            target=self._connect_worker,
            # Pair codes are opaque relay values; do not normalize or assume
            # a numeric format. Device names are intentionally trimmed.
            args=(generation, endpoint, pair_code, device_name.strip(), stop_event),
            name="KinolotConnect",
            daemon=True,
        )
        thread.start()

    def _connect_worker(
        self,
        generation: int,
        endpoint: str,
        pair_code: str,
        device_name: str,
        stop_event: threading.Event,
    ) -> None:
        try:
            client = BridgeClient(endpoint)
            result = client.device_connect(pair_code, device_name)
            token = _result_text(result.get("deviceToken"), "device token", 4096)
            project_id = _result_text(result.get("projectId"), "project ID", 96)
            expires_at = _result_text(result.get("expiresAt"), "expiry", 128)
            if parse_expiry(expires_at) is None:
                raise ProtocolError("bridge response has invalid expiry")
            # BridgeClient owns the Authorization header for every request.
            # Pairing starts unauthenticated, so explicitly transfer the
            # returned scoped device token to that in-memory client before
            # polling or completing any job.
            client.token = token
        except Exception as error:
            self.events.put({"kind": "connect_error", "generation": generation, "error": _safe_error(error)})
            return
        with self.lock:
            if generation != self.generation or stop_event.is_set():
                return
            # This token is deliberately assigned only to the in-memory
            # runtime.  It is never a Blender preference or a .blend property.
            self.client = client
            self.token = token
            self.project_id = project_id
            self.expires_at = expires_at
        self.events.put(
            {
                "kind": "connected",
                "generation": generation,
                "projectId": project_id,
                "expiresAt": expires_at,
            }
        )
        self._poll_worker(generation, client, project_id, expires_at, stop_event)

    def _wait(self, stop_event: threading.Event, seconds: float) -> bool:
        return stop_event.wait(timeout=max(0.05, seconds))

    def _poll_worker(
        self,
        generation: int,
        client: BridgeClient,
        project_id: str,
        expires_at: str,
        stop_event: threading.Event,
    ) -> None:
        current_job_id: Optional[str] = None
        while not stop_event.is_set() and self._current(generation):
            expiry = parse_expiry(expires_at)
            if expiry is not None and expiry <= _now_utc():
                self.events.put({"kind": "expired", "generation": generation})
                return
            try:
                claim = client.device_claim()
                job = claim.get("job")
                if job is not None and not isinstance(job, dict):
                    raise ProtocolError("device.claim returned an invalid job")
                if isinstance(job, dict):
                    current_job_id = _result_text(job.get("id"), "job ID", 128)
                    self.events.put(
                        {
                            "kind": "claim",
                            "generation": generation,
                            "job": job,
                            "leaseToken": _result_text(claim.get("leaseToken"), "lease token", 4096),
                        }
                    )
                    # Keep observing this one job until the relay reports a
                    # terminal status.  Completion itself is idempotent, but
                    # a new claim is never an automatic retry.
                    while not stop_event.is_set() and self._current(generation):
                        if self._wait(stop_event, 3.0):
                            return
                        try:
                            observed = client.job_get(project_id, current_job_id)
                            observed_job = observed.get("job", observed)
                            if not isinstance(observed_job, dict):
                                raise ProtocolError("job.get returned an invalid job")
                            status = observed_job.get("status")
                            self.events.put(
                                {
                                    "kind": "job_status",
                                    "generation": generation,
                                    "job": observed_job,
                                }
                            )
                            if status in {"completed", "failed", "cancelled"}:
                                current_job_id = None
                                break
                        except Exception as error:
                            self.events.put(
                                {
                                    "kind": "job_status_error",
                                    "generation": generation,
                                    "error": _safe_error(error),
                                }
                            )
                    continue
            except Exception as error:
                # A transient claim failure is shown and retried; it is not a
                # fake disconnect and never creates a duplicate job.
                self.events.put(
                    {
                        "kind": "poll_error",
                        "generation": generation,
                        "error": _safe_error(error),
                    }
                )
            if self._wait(stop_event, 3.0):
                return

    def request_disconnect(self) -> None:
        with self.lock:
            old_client = self.client
            old_project = self.project_id
            old_generation = self.generation
            self.generation += 1
            self.stop_event.set()
            self.token = None
            self.client = None
            self.active_job = None
            self.project_id = ""
            self.expires_at = None
            self.status = "Disconnected"
            self.detail = "Device token cleared from memory"
        if old_client and old_project:
            thread = threading.Thread(
                target=self._disconnect_worker,
                args=(old_client, old_project, old_generation),
                name="KinolotDisconnect",
                daemon=True,
            )
            thread.start()

    def _disconnect_worker(self, client: BridgeClient, project_id: str, generation: int) -> None:
        try:
            with self.network_lock:
                # The generation check prevents a late disconnect response
                # from changing a newer connection's state.
                client.connection_disconnect(project_id)
        except Exception as error:
            self.events.put(
                {"kind": "disconnect_error", "generation": generation, "error": _safe_error(error)}
            )

    def request_cancel(self) -> None:
        with self.lock:
            active = dict(self.active_job) if self.active_job else None
            client = self.client
            project_id = self.project_id
            generation = self.generation
        if not active or not client or not project_id:
            self._set_status("Error", "There is no active bridge job")
            return
        self._set_status("Cancelling", "Requesting cancellation")
        thread = threading.Thread(
            target=self._cancel_worker,
            args=(generation, client, project_id, active["jobId"]),
            name="KinolotCancel",
            daemon=True,
        )
        thread.start()

    def _cancel_worker(self, generation: int, client: BridgeClient, project_id: str, job_id: str) -> None:
        try:
            with self.network_lock:
                if not self._current(generation):
                    return
                result = client.job_cancel(project_id, job_id)
            self.events.put({"kind": "cancel_result", "generation": generation, "result": result})
        except Exception as error:
            self.events.put({"kind": "cancel_error", "generation": generation, "error": _safe_error(error)})

    def _send_failure(self, generation: int, client: BridgeClient, job: Mapping[str, Any], error: str) -> None:
        try:
            with self.network_lock:
                if not self._current(generation):
                    return
                # A user cancellation can race a local render exception. Do
                # not overwrite the relay's honest cancelled state with a
                # failure; read it before sending device.fail.
                observed = client.job_get(self.project_id, str(job["jobId"]))
                observed_job = observed.get("job", observed)
                if isinstance(observed_job, dict) and observed_job.get("status") == "cancelled":
                    self.events.put({"kind": "cancelled_before_failure", "generation": generation})
                    return
                client.device_fail(
                    str(job["jobId"]),
                    str(job["leaseToken"]),
                    {"code": "render_error", "message": error[:240]},
                )
            self.events.put({"kind": "failure_sent", "generation": generation})
        except Exception as failure_error:
            self.events.put(
                {"kind": "failure_error", "generation": generation, "error": _safe_error(failure_error)}
            )

    def _send_completion(
        self,
        generation: int,
        client: BridgeClient,
        project_id: str,
        job: Mapping[str, Any],
        png_base64: str,
        actual_camera: Mapping[str, Any],
    ) -> None:
        """Complete once, reconciling an ambiguous response without rerendering."""

        try:
            with self.network_lock:
                if not self._current(generation):
                    return
                # A cancellation can arrive while Blender is rendering.  A
                # final read prevents an upload after the relay has cancelled.
                observed = client.job_get(project_id, str(job["jobId"]))
                observed_job = observed.get("job", observed)
                if isinstance(observed_job, dict) and observed_job.get("status") == "cancelled":
                    self.events.put({"kind": "cancelled_before_upload", "generation": generation})
                    return
                if isinstance(observed_job, dict) and observed_job.get("status") == "failed":
                    self.events.put(
                        {
                            "kind": "complete_error",
                            "generation": generation,
                            "error": "Relay marked the job failed before upload",
                        }
                    )
                    return
                if isinstance(observed_job, dict) and observed_job.get("status") == "completed":
                    self.events.put({"kind": "complete_result", "generation": generation, "result": observed})
                    return
                result = client.device_complete(
                    str(job["jobId"]),
                    str(job["leaseToken"]),
                    png_base64,
                    actual_camera,
                )
        except Exception as error:
            if is_ambiguous_network_error(error):
                # Read the relay before attempting the exact same completion
                # payload.  There is never a second render or a new lease.
                try:
                    with self.network_lock:
                        if not self._current(generation):
                            return
                        observed = client.job_get(project_id, str(job["jobId"]))
                        observed_job = observed.get("job", observed)
                        if isinstance(observed_job, dict) and observed_job.get("status") == "completed":
                            self.events.put(
                                {"kind": "complete_result", "generation": generation, "result": observed}
                            )
                            return
                        if isinstance(observed_job, dict) and observed_job.get("status") in {
                            "queued",
                            "running",
                        }:
                            result = client.device_complete(
                                str(job["jobId"]),
                                str(job["leaseToken"]),
                                png_base64,
                                actual_camera,
                            )
                        else:
                            raise BridgeError("completion outcome is not safely retryable", "ambiguous_completion")
                except Exception as retry_error:
                    self.events.put(
                        {
                            "kind": "complete_error",
                            "generation": generation,
                            "error": _safe_error(retry_error),
                        }
                    )
                    return
            else:
                self.events.put({"kind": "complete_error", "generation": generation, "error": _safe_error(error)})
                return
        self.events.put({"kind": "complete_result", "generation": generation, "result": result})

    def _handle_claim(self, event: Mapping[str, Any]) -> None:
        generation = int(event["generation"])
        with self.lock:
            if generation != self.generation or not self.token or self.active_job:
                return
            job = event.get("job")
            if not isinstance(job, dict):
                return
            try:
                job_id = _result_text(job.get("id"), "job ID", 128)
                lease_token = _result_text(event.get("leaseToken"), "lease token", 4096)
                status = job.get("status")
                if status not in {"queued", "running"}:
                    raise ProtocolError("device.claim returned a non-runnable job")
                spec = validate_scene(job.get("spec"))
                expected_hash = _result_text(job.get("specHash"), "spec hash", 128)
                if scene_hash(spec) != expected_hash:
                    raise ProtocolError("job scene hash does not match its frozen scene")
                self.active_job = {
                    "jobId": job_id,
                    "leaseToken": lease_token,
                    "generation": generation,
                    "cancelled": False,
                }
                client = self.client
                project_id = self.project_id
            except Exception as error:
                self.status = "Error"
                self.detail = _safe_error(error)
                client = self.client
                project_id = self.project_id
                if client and isinstance(job.get("id"), str) and isinstance(event.get("leaseToken"), str):
                    failure_job = {
                        "jobId": job["id"],
                        "leaseToken": event["leaseToken"],
                    }
                    threading.Thread(
                        target=self._send_failure,
                        args=(generation, client, failure_job, _safe_error(error)),
                        name="KinolotValidationFailure",
                        daemon=True,
                    ).start()
                return
        self._set_status("Rendering", "Rendering approved proof")
        # This is the only place that enters Blender rendering, and pump() is
        # invoked solely by bpy.app.timers.
        try:
            result = renderer.render_preview(spec)
            with self.lock:
                active = dict(self.active_job) if self.active_job else None
                still_current = (
                    generation == self.generation
                    and bool(self.token and self.client)
                    and active is not None
                    and not active.get("cancelled")
                    and self.expires_at
                    and parse_expiry(self.expires_at) is not None
                    and parse_expiry(self.expires_at) > _now_utc()
                )
                client = self.client
                project_id = self.project_id
            if not still_current or not client or not project_id:
                return
            # renderer.render_preview already validates this readback; repeat
            # the check at the upload boundary so no untrusted result can pass.
            validate_actual_camera(result["actualCamera"], spec)
            self._set_status("Uploading", "Uploading rendered proof")
            threading.Thread(
                target=self._send_completion,
                args=(generation, client, project_id, active, result["pngBase64"], result["actualCamera"]),
                name="KinolotComplete",
                daemon=True,
            ).start()
        except Exception as error:
            with self.lock:
                active = dict(self.active_job) if self.active_job else None
                client = self.client
            self._set_status("Error", _safe_error(error))
            if active and client:
                threading.Thread(
                    target=self._send_failure,
                    args=(generation, client, active, _safe_error(error)),
                    name="KinolotRenderFailure",
                    daemon=True,
                ).start()

    def _handle_event(self, event: Mapping[str, Any]) -> None:
        kind = event.get("kind")
        generation = int(event.get("generation", -1))
        with self.lock:
            if generation != self.generation:
                return
        if kind == "connected":
            self._set_status("Connected", "Polling for jobs")
            try:
                preferences = bpy.context.preferences.addons[__package__].preferences
                preferences.project_id = str(event["projectId"])
            except (KeyError, AttributeError):
                pass
        elif kind == "connect_error":
            self._set_status("Error", str(event.get("error", "Connection failed")))
        elif kind == "claim":
            self._handle_claim(event)
        elif kind == "job_status":
            job = event.get("job")
            if isinstance(job, dict) and job.get("status") == "cancelled":
                with self.lock:
                    if self.active_job and self.active_job.get("jobId") == job.get("id"):
                        self.active_job["cancelled"] = True
                self._set_status("Cancelled", "Relay cancelled the job; no upload was sent")
        elif kind == "job_status_error":
            self._set_status("Error", str(event.get("error", "Unable to read job status")))
        elif kind == "poll_error":
            self._set_status("Error", str(event.get("error", "Unable to claim a job; retrying")))
        elif kind == "expired":
            with self.lock:
                self.token = None
                self.client = None
                self.active_job = None
                self.stop_event.set()
                self.status = "Expired"
                self.detail = "Device token expired; connect again"
        elif kind == "cancel_result":
            self._set_status("Cancelling", "Cancellation requested; waiting for relay status")
        elif kind == "cancel_error":
            self._set_status("Error", str(event.get("error", "Cancellation failed")))
        elif kind == "cancelled_before_upload":
            with self.lock:
                self.active_job = None
            self._set_status("Cancelled", "Relay cancelled the job; no upload was sent")
        elif kind == "cancelled_before_failure":
            with self.lock:
                self.active_job = None
            self._set_status("Cancelled", "Relay cancelled the job; render failure was not overwritten")
        elif kind == "complete_result":
            result = event.get("result")
            result_job = result.get("job", result) if isinstance(result, dict) else None
            if not isinstance(result_job, dict) or result_job.get("status") != "completed":
                self._set_status("Error", "Relay returned an uncompleted proof result")
            else:
                with self.lock:
                    self.active_job = None
                self._set_status("Connected", "Proof completed")
        elif kind == "complete_error":
            self._set_status("Error", str(event.get("error", "Proof completion failed")))
        elif kind == "failure_sent":
            with self.lock:
                self.active_job = None
            self._set_status("Error", "Render failed; relay marked the job failed")
        elif kind == "failure_error":
            self._set_status("Error", "Render failed and relay failure was not acknowledged")
        elif kind == "disconnect_error":
            # The token has already been cleared locally.  Surface the relay
            # error without pretending the device is still paired.
            self._set_status("Disconnected", "Disconnected locally; relay response failed")

    def pump(self) -> None:
        # Called on Blender's main thread by the app timer.
        for _ in range(32):
            try:
                event = self.events.get_nowait()
            except queue.Empty:
                break
            try:
                self._handle_event(event)
            except Exception as error:
                self._set_status("Error", _safe_error(error))


_RUNTIME: Optional[BridgeRuntime] = None
# The add-on's package before 1.1.0. True once this session switched it off.
OLD_ADDON_MODULE = "cinema_machine_bridge"
_OLD_ADDON_RETIRED = False
_STUDIO_RUNTIME: Optional[StudioRuntime] = None
_TIMER_RUNNING = False
_STUDIO_WORKSPACE_FAILURE_KEY: Optional[tuple] = None
_LAST_BRIDGE_VISIBLE_STATE: Optional[Dict[str, Any]] = None
_LAST_STUDIO_VISIBLE_STATE: Optional[Dict[str, Any]] = None


class CMPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    edge_function_url: StringProperty(
        name="Supabase Edge Function URL",
        description="HTTPS URL for the blender-bridge Edge Function",
        default="",
    )
    project_id: StringProperty(
        name="Project ID",
        description="Project selected by the approved browser job",
        default="",
    )
    device_name: StringProperty(
        name="Device name",
        description="Name shown to the paired project",
        default="Blender Desktop",
    )

    def draw(self, _context: Any) -> None:
        layout = self.layout
        layout.prop(self, "edge_function_url")
        layout.prop(self, "project_id")
        layout.prop(self, "device_name")
        layout.label(text="The device token is kept in memory only.")


class CM_OT_connect(bpy.types.Operator):
    bl_idname = "kinolot.connect"
    bl_label = "Connect"
    bl_description = "Pair this Blender desktop using a one-time code"

    def execute(self, context: Any) -> set:
        _ensure_timer_registered()
        preferences = context.preferences.addons[__package__].preferences
        pair_code = context.window_manager.kinolot_pair_code
        if not context.window_manager.kinolot_pair_acknowledged:
            self.report({"ERROR"}, "Confirm the project and one-time code before connecting")
            return {"CANCELLED"}
        if not pair_code.strip():
            self.report({"ERROR"}, "Enter the one-time pairing code")
            return {"CANCELLED"}
        assert _RUNTIME is not None
        _RUNTIME.request_connect(preferences.edge_function_url, pair_code, preferences.device_name)
        _tag_kinolot_areas()
        return {"FINISHED"}


class CM_OT_disconnect(bpy.types.Operator):
    bl_idname = "kinolot.disconnect"
    bl_label = "Disconnect"
    bl_description = "Clear the in-memory device token and disconnect"

    def execute(self, _context: Any) -> set:
        assert _RUNTIME is not None
        _RUNTIME.request_disconnect()
        _tag_kinolot_areas()
        return {"FINISHED"}


class CM_OT_cancel(bpy.types.Operator):
    bl_idname = "kinolot.cancel"
    bl_label = "Cancel Job"
    bl_description = "Ask the relay to cancel the current proof job"

    def execute(self, _context: Any) -> set:
        assert _RUNTIME is not None
        _RUNTIME.request_cancel()
        _tag_kinolot_areas()
        return {"FINISHED"}


class VIEW3D_PT_kinolot(bpy.types.Panel):
    bl_label = "Kinolot"
    bl_idname = "VIEW3D_PT_kinolot_bridge"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Kinolot"

    def draw(self, context: Any) -> None:
        layout = self.layout
        if _OLD_ADDON_RETIRED or OLD_ADDON_MODULE in context.preferences.addons:
            notice = layout.box()
            notice.label(text="The older Kinolot add-on was switched off.", icon="INFO")
            notice.label(text="Remove it in Preferences > Add-ons.")
        preferences = context.preferences.addons[__package__].preferences
        runtime = _RUNTIME
        snapshot = runtime.snapshot() if runtime else {
            "status": "Disconnected",
            "detail": "",
            "projectId": "",
            "expiresAt": None,
            "activeJob": None,
            "connected": False,
        }
        connection = layout.box()
        connection.label(text="Outbound HTTPS bridge")
        connection.prop(preferences, "edge_function_url", text="Function URL")
        connection.prop(preferences, "project_id", text="Project ID")
        connection.prop(preferences, "device_name", text="Device name")
        connection.prop(context.window_manager, "kinolot_pair_code", text="Pair code")
        connection.prop(context.window_manager, "kinolot_pair_acknowledged", text="I approve this project")
        row = connection.row(align=True)
        if snapshot["connected"]:
            row.operator(CM_OT_disconnect.bl_idname, text="Disconnect")
        else:
            row.operator(CM_OT_connect.bl_idname, text="Connect")
        status = layout.box()
        status.label(text="Status: " + str(snapshot["status"]))
        if snapshot["detail"]:
            status.label(text=str(snapshot["detail"])[:120])
        if snapshot["expiresAt"]:
            status.label(text="Token expiry: " + str(snapshot["expiresAt"]))
        active = snapshot.get("activeJob")
        if active:
            status.label(text="Job: " + str(active.get("jobId", ""))[:60])
            status.operator(CM_OT_cancel.bl_idname, text="Cancel Job")
        layout.label(text="Proof uses editable stand-ins, not character identity.")


def _studio_model_items(_self: Any, _context: Any) -> list:
    runtime = _STUDIO_RUNTIME
    snapshot = runtime.snapshot() if runtime else {}
    capabilities = snapshot.get("capabilities", {})
    values = capabilities.get("models", []) if isinstance(capabilities, dict) else []
    items = []
    for value in values:
        if isinstance(value, str) and value:
            items.append((value, value[:80], "Server-authorized Studio model"))
        elif isinstance(value, dict) and isinstance(value.get("modelId"), str) and value["modelId"] and value.get("selectable") is True:
            warning = " (provider access unverified)" if value.get("verified") is not True else ""
            items.append((value["modelId"], (value["modelId"] + warning)[:120], "Server-authorized Studio model"))
    return items or [("unavailable", "Load capabilities first", "No model is selected")]


def _studio_mesh_model_items(_self: Any, _context: Any) -> list:
    runtime = _STUDIO_RUNTIME
    snapshot = runtime.snapshot() if runtime else {}
    capabilities = snapshot.get("capabilities", {})
    values = capabilities.get("meshModels", []) if isinstance(capabilities, dict) else []
    items = []
    for value in values:
        if isinstance(value, str) and value:
            items.append((value, value[:80], "Server-authorized mesh model"))
        elif isinstance(value, dict) and isinstance(value.get("modelId"), str) and value["modelId"] and value.get("selectable") is True:
            warning = " (provider access unverified)" if value.get("verified") is not True else ""
            items.append((value["modelId"], (value["modelId"] + warning)[:120], "Server-authorized mesh model"))
    return items or [("unavailable", "Load mesh capabilities first", "No mesh model is selected")]


def _studio_runtime() -> StudioRuntime:
    if _STUDIO_RUNTIME is None:
        raise StudioProtocolError("Studio runtime is unavailable")
    return _STUDIO_RUNTIME


def _studio_reset_cost_ack(self: Any, _context: Any) -> None:
    # Acknowledgement is deliberately specific to the currently displayed
    # request.  Changing its mode/model/prompt/reference requires a fresh
    # explicit confirmation.
    if hasattr(self, "kinolot_studio_cost_ack"):
        self.kinolot_studio_cost_ack = False


class CM_OT_studio_open(bpy.types.Operator):
    bl_idname = "kinolot.studio_open"
    bl_label = "Open Kinolot Studio"
    bl_description = "Open the native Studio dialog and fetch the browser-selected workspace"

    def invoke(self, context: Any, _event: Any) -> set:
        _ensure_timer_registered()
        _reset_studio_workspace_failure()
        _studio_runtime().request_current()
        _studio_runtime().request_capabilities()
        _tag_kinolot_areas()
        return context.window_manager.invoke_props_dialog(self, width=720)

    def execute(self, _context: Any) -> set:
        _ensure_timer_registered()
        return {"FINISHED"}

    def draw(self, context: Any) -> None:
        _draw_studio_dialog(self.layout, context)


class CM_OT_studio_capabilities(bpy.types.Operator):
    bl_idname = "kinolot.studio_capabilities"
    bl_label = "Refresh models"

    def execute(self, _context: Any) -> set:
        _studio_runtime().request_capabilities()
        return {"FINISHED"}


class CM_OT_studio_workspace_current(bpy.types.Operator):
    bl_idname = "kinolot.studio_workspace_current"
    bl_label = "Open selected workspace"

    def execute(self, _context: Any) -> set:
        _ensure_timer_registered()
        _reset_studio_workspace_failure()
        _studio_runtime().request_current()
        _tag_kinolot_areas()
        return {"FINISHED"}


class CM_OT_studio_generate(bpy.types.Operator):
    bl_idname = "kinolot.studio_generate"
    bl_label = "Generate"

    @classmethod
    def poll(cls, _context: Any) -> bool:
        runtime = _STUDIO_RUNTIME
        if runtime is None:
            return True
        capabilities = runtime.snapshot().get("capabilities", {})
        return not (isinstance(capabilities, dict) and capabilities.get("billingReady") is False)

    def execute(self, context: Any) -> set:
        runtime = _studio_runtime()
        snapshot = runtime.snapshot()
        workspace = snapshot.get("workspace")
        if not isinstance(workspace, dict):
            self.report({"ERROR"}, "Open a browser-selected workspace first")
            return {"CANCELLED"}
        try:
            local = studio_scene.workspace_snapshot(context.scene, workspace)
            runtime.set_local_workspace(local)
            tab = context.window_manager.kinolot_studio_tab
            if tab == "MODEL":
                runtime.request_mesh(
                    context.window_manager.kinolot_studio_mesh_model,
                    context.window_manager.kinolot_studio_asset_name,
                    prompt=context.window_manager.kinolot_studio_prompt,
                    reference_id=context.window_manager.kinolot_studio_reference_id.strip() or workspace["locationId"],
                    rigged=context.window_manager.kinolot_studio_mesh_rigged,
                    animated=context.window_manager.kinolot_studio_mesh_animated,
                    acknowledge_cost=context.window_manager.kinolot_studio_cost_ack,
                )
            else:
                runtime.request_assistant(
                    "animation" if tab == "ANIMATION" else "scene",
                    context.window_manager.kinolot_studio_model,
                    context.window_manager.kinolot_studio_prompt,
                    local,
                    acknowledge_cost=context.window_manager.kinolot_studio_cost_ack,
                    reference_id=context.window_manager.kinolot_studio_reference_id.strip() or workspace["locationId"],
                )
            context.window_manager.kinolot_studio_cost_ack = False
        except (StudioProtocolError, studio_scene.StudioSceneError) as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class CM_OT_studio_apply(bpy.types.Operator):
    bl_idname = "kinolot.studio_apply"
    bl_label = "Apply reviewed proposal"
    bl_description = "Apply only the displayed typed Studio proposal to managed data"

    def execute(self, context: Any) -> set:
        runtime = _studio_runtime()
        snapshot = runtime.snapshot()
        workspace, proposal, task = snapshot.get("workspace"), snapshot.get("proposal"), snapshot.get("task")
        if not isinstance(workspace, dict) or not isinstance(proposal, dict):
            self.report({"ERROR"}, "There is no reviewed assistant proposal to apply")
            return {"CANCELLED"}
        if not isinstance(task, dict) or task.get("status") != "completed":
            self.report({"ERROR"}, "A Studio proposal can be applied only after task completion")
            return {"CANCELLED"}
        try:
            local = studio_scene.apply_proposal(context.scene, workspace, proposal)
            runtime.set_local_workspace(local)
        except (StudioProtocolError, studio_scene.StudioSceneError) as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class CM_OT_studio_save(bpy.types.Operator):
    bl_idname = "kinolot.studio_save"
    bl_label = "Save workspace"
    bl_description = "Capture managed local edits and save with revision conflict protection"

    def execute(self, context: Any) -> set:
        runtime = _studio_runtime()
        workspace = runtime.snapshot().get("workspace")
        if not isinstance(workspace, dict):
            self.report({"ERROR"}, "There is no open Studio workspace")
            return {"CANCELLED"}
        try:
            local = studio_scene.workspace_snapshot(context.scene, workspace)
            runtime.set_local_workspace(local)
            runtime.request_save(local)
        except (StudioProtocolError, studio_scene.StudioSceneError) as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class CM_OT_studio_attach_file(bpy.types.Operator):
    bl_idname = "kinolot.studio_attach_file"
    bl_label = "Attach local PNG/JPEG"
    bl_description = "Attach a transient local reference to the next request"

    filepath: StringProperty(subtype="FILE_PATH")
    filter_glob: StringProperty(default="*.png;*.jpg;*.jpeg", options={"HIDDEN"})

    def invoke(self, context: Any, _event: Any) -> set:
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, _context: Any) -> set:
        try:
            size = os.path.getsize(self.filepath)
            if size <= 0 or size > 8 * 1024 * 1024:
                raise StudioProtocolError("Reference image must be between 1 byte and 8 MB")
            with open(self.filepath, "rb") as source:
                payload = source.read()
            suffix = os.path.splitext(self.filepath)[1].lower()
            media_type = "png" if suffix == ".png" else "jpeg" if suffix in {".jpg", ".jpeg"} else ""
            if not media_type:
                raise StudioProtocolError("Reference must be a PNG or JPEG")
            data_url = "data:image/%s;base64,%s" % (media_type, base64.b64encode(payload).decode("ascii"))
            _studio_runtime().set_local_attachment(validate_image_data_url(data_url), os.path.basename(self.filepath))
            _context.window_manager.kinolot_studio_cost_ack = False
        except (OSError, StudioProtocolError) as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class CM_OT_studio_get_reference(bpy.types.Operator):
    bl_idname = "kinolot.studio_get_reference"
    bl_label = "Attach approved reference"

    def execute(self, context: Any) -> set:
        entity_id = context.window_manager.kinolot_studio_reference_id.strip()
        if not entity_id:
            self.report({"ERROR"}, "Enter an approved project reference ID")
            return {"CANCELLED"}
        _studio_runtime().request_reference(entity_id)
        context.window_manager.kinolot_studio_cost_ack = False
        return {"FINISHED"}


class CM_OT_studio_task_refresh(bpy.types.Operator):
    bl_idname = "kinolot.studio_task_refresh"
    bl_label = "Refresh task"

    def execute(self, _context: Any) -> set:
        _studio_runtime().request_task()
        return {"FINISHED"}


class CM_OT_studio_task_cancel(bpy.types.Operator):
    bl_idname = "kinolot.studio_task_cancel"
    bl_label = "Cancel task"

    @classmethod
    def poll(cls, _context: Any) -> bool:
        runtime = _STUDIO_RUNTIME
        task = runtime.snapshot().get("task") if runtime else None
        return not (isinstance(task, dict) and task.get("status") == "settlement_pending")

    def execute(self, _context: Any) -> set:
        _studio_runtime().request_cancel_task()
        return {"FINISHED"}


class CM_OT_studio_asset_fetch(bpy.types.Operator):
    bl_idname = "kinolot.studio_asset_fetch"
    bl_label = "Fetch selected asset"

    def execute(self, context: Any) -> set:
        asset_id = context.window_manager.kinolot_studio_asset_id.strip()
        if not asset_id:
            self.report({"ERROR"}, "Enter an asset ID from this workspace")
            return {"CANCELLED"}
        _studio_runtime().request_asset(asset_id)
        return {"FINISHED"}


class CM_OT_studio_asset_import(bpy.types.Operator):
    bl_idname = "kinolot.studio_asset_import"
    bl_label = "Import fetched GLB"
    bl_description = "Explicitly import the authenticated GLB into the managed collection"

    def execute(self, context: Any) -> set:
        runtime = _studio_runtime()
        snapshot = runtime.snapshot()
        workspace, asset_response = snapshot.get("workspace"), snapshot.get("asset")
        if not isinstance(workspace, dict) or not isinstance(asset_response, dict):
            self.report({"ERROR"}, "Fetch an authenticated Studio asset first")
            return {"CANCELLED"}
        try:
            payload = base64.b64decode(asset_response["base64"], validate=True)
            studio_scene.import_workspace_asset(context.scene, workspace, asset_response["asset"], payload)
            local = studio_scene.workspace_snapshot(context.scene, workspace)
            runtime.set_local_workspace(local)
        except (KeyError, ValueError, StudioProtocolError, studio_scene.StudioSceneError) as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class CM_OT_studio_conflict_reload(bpy.types.Operator):
    bl_idname = "kinolot.studio_conflict_reload"
    bl_label = "Reload server workspace"
    bl_description = "Fetch the server revision; unsaved local edits are not discarded automatically"

    def execute(self, _context: Any) -> set:
        _studio_runtime().reload_after_conflict()
        return {"FINISHED"}


class CM_OT_studio_replace_local(bpy.types.Operator):
    bl_idname = "kinolot.studio_replace_local"
    bl_label = "Replace local managed workspace"
    bl_description = "Explicitly discard local managed Studio edits and use the fetched server revision"

    def execute(self, context: Any) -> set:
        runtime = _studio_runtime()
        workspace = runtime.accept_reloaded_workspace()
        if workspace is None:
            self.report({"ERROR"}, "No fetched server revision is waiting")
            return {"CANCELLED"}
        try:
            studio_scene.replace_workspace(context.scene, workspace)
        except (StudioProtocolError, studio_scene.StudioSceneError) as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class CM_OT_studio_activate_shot(bpy.types.Operator):
    bl_idname = "kinolot.studio_activate_shot"
    bl_label = "Use selected shot"
    bl_description = "Use the selected workspace shot camera and timeline in this Blender scene"

    def execute(self, context: Any) -> set:
        snapshot = _studio_runtime().snapshot()
        workspace, shot_id = snapshot.get("workspace"), snapshot.get("shotId")
        if not isinstance(workspace, dict) or not isinstance(shot_id, str):
            self.report({"ERROR"}, "Select a shot in Kinolot before activating it")
            return {"CANCELLED"}
        try:
            studio_scene.activate_workspace_shot(context.scene, workspace, shot_id)
        except (StudioProtocolError, studio_scene.StudioSceneError) as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class CM_OT_studio_play_preview(bpy.types.Operator):
    bl_idname = "kinolot.studio_play_preview"
    bl_label = "Play local preview"
    bl_description = "Play the active Blender timeline locally; no preview is published"

    def execute(self, _context: Any) -> set:
        try:
            bpy.ops.screen.animation_play()
        except RuntimeError as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class CM_OT_studio_render_preview(bpy.types.Operator):
    bl_idname = "kinolot.studio_render_preview"
    bl_label = "Render local preview"
    bl_description = "Render the active Blender scene locally; no preview is published"

    def execute(self, _context: Any) -> set:
        try:
            bpy.ops.render.render("INVOKE_DEFAULT")
        except RuntimeError as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class CM_OT_studio_publish_preview(bpy.types.Operator):
    bl_idname = "kinolot.studio_publish_preview"
    bl_label = "Render and publish auxiliary preview"
    bl_description = "Render the active local camera and publish an auxiliary Studio preview"

    def execute(self, context: Any) -> set:
        runtime = _studio_runtime()
        workspace = runtime.snapshot().get("workspace")
        if not isinstance(workspace, dict):
            self.report({"ERROR"}, "Open a Studio workspace before publishing a preview")
            return {"CANCELLED"}
        try:
            local = studio_scene.workspace_snapshot(context.scene, workspace)
            preview = studio_scene.render_auxiliary_preview(context.scene)
            runtime.set_local_workspace(local)
            runtime.request_preview(local, preview["pngBase64"], preview["actualCamera"])
        except (RuntimeError, StudioProtocolError, studio_scene.StudioSceneError) as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class CM_OT_studio_key_selected_blocking(bpy.types.Operator):
    bl_idname = "kinolot.studio_key_selected_blocking"
    bl_label = "Key selected blocking transform"
    bl_description = "Insert real location, rotation, and scale keyframes for the selected managed actor"

    def execute(self, context: Any) -> set:
        object_ = context.view_layer.objects.active
        if object_ is None or (
            object_.get(studio_scene.STUDIO_KIND_KEY) != "actor"
            and object_.get(studio_scene.STUDIO_CHARACTER_KEY) is not True
        ):
            self.report({"ERROR"}, "Select a managed Studio actor or imported character root")
            return {"CANCELLED"}
        frame = context.scene.frame_current
        try:
            object_.keyframe_insert(data_path="location", frame=frame)
            object_.keyframe_insert(data_path="rotation_euler", frame=frame)
            object_.keyframe_insert(data_path="scale", frame=frame)
            runtime = _studio_runtime()
            workspace = runtime.snapshot().get("workspace")
            if isinstance(workspace, dict):
                runtime.set_local_workspace(studio_scene.workspace_snapshot(context.scene, workspace))
        except (RuntimeError, StudioProtocolError, studio_scene.StudioSceneError) as error:
            self.report({"ERROR"}, _safe_error(error))
            return {"CANCELLED"}
        return {"FINISHED"}


def _draw_studio_dialog(layout: Any, context: Any) -> None:
    runtime = _studio_runtime()
    snapshot = runtime.snapshot()
    wm = context.window_manager
    tabs = layout.row(align=True)
    tabs.prop(wm, "kinolot_studio_tab", expand=True)
    status = layout.box()
    status.label(text=str(snapshot["status"]))
    if snapshot["detail"]:
        status.label(text=str(snapshot["detail"])[:160])
    workspace = snapshot.get("workspace")
    if not isinstance(workspace, dict):
        row = layout.row(align=True)
        row.operator(CM_OT_studio_workspace_current.bl_idname, text="Open selected workspace")
        row.operator(CM_OT_studio_capabilities.bl_idname, text="Refresh models")
        layout.label(text="Select a location/shot in Kinolot first.")
        return
    layout.label(text="Workspace: %s  •  revision %s" % (workspace["name"], workspace["revision"]))
    if snapshot.get("shotId"):
        shot_row = layout.row(align=True)
        shot_row.label(text="Shot: " + str(snapshot["shotId"]))
        shot_row.operator(CM_OT_studio_activate_shot.bl_idname, text="Use shot")
        shot_row.operator(CM_OT_studio_play_preview.bl_idname, text="Play")
        shot_row.operator(CM_OT_studio_render_preview.bl_idname, text="Render local")
        shot_row.operator(CM_OT_studio_publish_preview.bl_idname, text="Publish preview")
        shot_row.operator(CM_OT_studio_key_selected_blocking.bl_idname, text="Key selected")
    row = layout.row(align=True)
    row.operator(CM_OT_studio_capabilities.bl_idname, text="Refresh model access")
    row.operator(CM_OT_studio_save.bl_idname, text="Save")
    if snapshot.get("conflict"):
        conflict = layout.box()
        conflict.alert = True
        conflict.label(text="Revision conflict: local edits remain in Blender.")
        conflict.operator(CM_OT_studio_conflict_reload.bl_idname, text="Reload server revision")
    if snapshot.get("hasReloadedWorkspace"):
        replacement = layout.box()
        replacement.alert = True
        replacement.label(text="A server revision is waiting; local managed edits remain unchanged.")
        replacement.operator(CM_OT_studio_replace_local.bl_idname, text="Replace local managed workspace")
    history = snapshot.get("history", ())
    if history:
        box = layout.box()
        box.label(text="Chat history")
        for item in history[-4:]:
            box.label(text="%s: %s" % (item.get("role", "Studio"), str(item.get("text", ""))[:110]))
    prompt = layout.box()
    prompt.prop(wm, "kinolot_studio_prompt", text="")
    if wm.kinolot_studio_tab == "MODEL":
        prompt.prop(wm, "kinolot_studio_mesh_model", text="Mesh model")
        prompt.prop(wm, "kinolot_studio_asset_name", text="Asset name")
        prompt.prop(wm, "kinolot_studio_mesh_rigged", text="Request rigged asset")
        prompt.prop(wm, "kinolot_studio_mesh_animated", text="Request animation")
    else:
        prompt.prop(wm, "kinolot_studio_model", text="Model")
    reference = prompt.row(align=True)
    if wm.kinolot_studio_tab != "SCENE":
        reference.prop(wm, "kinolot_studio_reference_id", text="Generated image ID")
        reference.operator(CM_OT_studio_get_reference.bl_idname, text="Preview source")
    prompt.label(text="Derived from the location image unless another generated asset is selected.")
    if snapshot.get("referenceDataUrl"):
        prompt.label(text="Generated project reference preview loaded")
    capabilities = snapshot.get("capabilities", {})
    if isinstance(capabilities, dict):
        if capabilities.get("billingReady") is not True:
            prompt.label(text="Billing is not ready; generation will be refused.", icon="ERROR")
        elif wm.kinolot_studio_tab == "MODEL":
            estimate = capabilities.get("meshEstimate")
            if isinstance(estimate, dict):
                prompt.label(text="Advertised mesh estimate: %s" % str(estimate.get("credits", "provider-priced")))
        selected_models = capabilities.get("meshModels" if wm.kinolot_studio_tab == "MODEL" else "models", [])
        selected_id = wm.kinolot_studio_mesh_model if wm.kinolot_studio_tab == "MODEL" else wm.kinolot_studio_model
        if isinstance(selected_models, list):
            selected = next((item for item in selected_models if isinstance(item, dict) and item.get("modelId") == selected_id), None)
            if isinstance(selected, dict) and selected.get("verified") is not True and selected.get("selectable") is True:
                prompt.label(text=str(selected.get("warning", "Provider may refuse this exact model."))[:150], icon="ERROR")
    prompt.prop(wm, "kinolot_studio_cost_ack", text="I approve this generation's advertised cost")
    generate = prompt.row()
    generate.enabled = not (isinstance(capabilities, dict) and capabilities.get("billingReady") is False)
    generate.operator(CM_OT_studio_generate.bl_idname, text="Generate", icon="PLAY")
    task = snapshot.get("task")
    if task:
        task_box = layout.box()
        pending_settlement = task.get("status") == "settlement_pending"
        task_box.label(text="Task: %s" % str(task.get("status", "unknown")))
        if pending_settlement:
            task_box.label(text="Provider work is complete; awaiting credit settlement.", icon="INFO")
        buttons = task_box.row(align=True)
        buttons.operator(
            CM_OT_studio_task_refresh.bl_idname,
            text="Retry credit settlement" if pending_settlement else "Refresh",
        )
        cancel = buttons.row(align=True)
        cancel.enabled = not pending_settlement
        cancel.operator(CM_OT_studio_task_cancel.bl_idname, text="Cancel")
    proposal = snapshot.get("proposal")
    if proposal:
        reviewed = layout.box()
        reviewed.label(text="Reviewed proposal: " + str(proposal.get("summary", ""))[:150])
        reviewed.label(text="%d typed operation(s); no generated Python will run." % len(proposal.get("ops", [])))
        completed = isinstance(task, dict) and task.get("status") == "completed"
        apply_row = reviewed.row()
        apply_row.enabled = completed
        apply_row.operator(CM_OT_studio_apply.bl_idname, text="Apply reviewed proposal", icon="CHECKMARK")
    if wm.kinolot_studio_tab == "ASSETS":
        assets = layout.box()
        assets.prop(wm, "kinolot_studio_asset_id", text="Asset ID")
        row = assets.row(align=True)
        row.operator(CM_OT_studio_asset_fetch.bl_idname, text="Fetch authenticated GLB")
        if snapshot.get("asset"):
            row.operator(CM_OT_studio_asset_import.bl_idname, text="Import GLB")
    layout.label(text="Native Blender dialog styling is limited; this is not a web panel.")


class VIEW3D_PT_kinolot_studio(bpy.types.Panel):
    bl_label = "Kinolot Studio"
    bl_idname = "VIEW3D_PT_kinolot_studio"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Kinolot"

    def draw(self, _context: Any) -> None:
        layout = self.layout
        layout.operator(CM_OT_studio_open.bl_idname, text="Open Studio", icon="WINDOW")
        runtime = _STUDIO_RUNTIME
        if runtime is not None:
            state = runtime.snapshot()
            layout.label(text=str(state["status"])[:120])


_CLASSES = (
    CMPreferences,
    CM_OT_connect,
    CM_OT_disconnect,
    CM_OT_cancel,
    VIEW3D_PT_kinolot,
    CM_OT_studio_open,
    CM_OT_studio_capabilities,
    CM_OT_studio_workspace_current,
    CM_OT_studio_generate,
    CM_OT_studio_apply,
    CM_OT_studio_save,
    CM_OT_studio_get_reference,
    CM_OT_studio_task_refresh,
    CM_OT_studio_task_cancel,
    CM_OT_studio_asset_fetch,
    CM_OT_studio_asset_import,
    CM_OT_studio_conflict_reload,
    CM_OT_studio_replace_local,
    CM_OT_studio_activate_shot,
    CM_OT_studio_play_preview,
    CM_OT_studio_render_preview,
    CM_OT_studio_publish_preview,
    CM_OT_studio_key_selected_blocking,
    VIEW3D_PT_kinolot_studio,
)


def _tag_kinolot_areas() -> None:
    """Redraw visible Kinolot panels from Blender's main thread.

    This function is called only by operators and ``_timer_callback``.  Worker
    threads communicate through runtime event queues and never enter ``bpy``.
    Tagging the whole VIEW_3D area is intentional: Blender owns the sidebar
    region and will repaint the Kinolot tab if it is currently visible.
    """

    try:
        window_manager = bpy.context.window_manager
        windows = tuple(getattr(window_manager, "windows", ()))
    except Exception:
        return
    seen = set()
    for window in windows:
        screen = getattr(window, "screen", None)
        for area in tuple(getattr(screen, "areas", ())):
            if getattr(area, "type", None) != "VIEW_3D":
                continue
            identity = id(area)
            if identity in seen:
                continue
            seen.add(identity)
            try:
                area.tag_redraw()
            except Exception:
                # A window can disappear while Blender is changing screens.
                # It is safe to wait for the next timer tick.
                continue


def _timer_registered() -> bool:
    """Ask Blender's timer registry rather than trusting our bookkeeping flag."""

    timers = getattr(getattr(bpy, "app", None), "timers", None)
    checker = getattr(timers, "is_registered", None)
    if not callable(checker):
        return False
    try:
        return bool(checker(_timer_callback))
    except Exception:
        return False


def _ensure_timer_registered() -> None:
    """Restore the persistent timer after an interrupted/stale registration."""

    global _TIMER_RUNNING
    if not _timer_registered():
        bpy.app.timers.register(_timer_callback, first_interval=0.25, persistent=True)
    _TIMER_RUNNING = True


def _reset_studio_workspace_failure() -> None:
    """Allow one explicit Studio open action to retry materialization."""

    global _STUDIO_WORKSPACE_FAILURE_KEY
    _STUDIO_WORKSPACE_FAILURE_KEY = None


def _scene_identity(scene: Any) -> Any:
    try:
        pointer = scene.as_pointer()
        if pointer:
            return ("pointer", int(pointer))
    except Exception:
        pass
    return ("python", id(scene))


def _runtime_generation(runtime: Any) -> Any:
    generation = getattr(runtime, "generation", None)
    return generation if isinstance(generation, (int, str)) else None


def _workspace_failure_key(
    workspace: Any,
    scene: Any,
    studio_runtime: Any,
    bridge_runtime: Any,
) -> Optional[tuple]:
    if not isinstance(workspace, dict):
        return None
    return (
        _scene_identity(scene),
        workspace.get("projectId"),
        workspace.get("locationId"),
        workspace.get("revision"),
        _runtime_generation(studio_runtime),
        _runtime_generation(bridge_runtime),
    )


def _set_timer_error(runtime: Any, status: str, prefix: str, error: BaseException) -> None:
    try:
        runtime._set_status(status, prefix + ": " + _safe_error(error))
    except Exception:
        # The timer must remain alive even if a damaged runtime cannot accept
        # its own error state.
        return


def _runtime_snapshot(runtime: Any) -> Optional[Dict[str, Any]]:
    try:
        snapshot = runtime.snapshot()
    except Exception as error:
        _set_timer_error(runtime, "Error", "Bridge timer error", error)
        return None
    if not isinstance(snapshot, dict):
        _set_timer_error(runtime, "Error", "Bridge timer error", RuntimeError("runtime snapshot is invalid"))
        return None
    return snapshot


def _studio_snapshot(runtime: Any) -> Optional[Dict[str, Any]]:
    try:
        snapshot = runtime.snapshot()
    except Exception as error:
        _set_timer_error(runtime, "Studio error", "Studio timer error", error)
        return None
    if not isinstance(snapshot, dict):
        _set_timer_error(runtime, "Studio error", "Studio timer error", RuntimeError("Studio snapshot is invalid"))
        return None
    return snapshot


def _timer_callback() -> Optional[float]:
    global _TIMER_RUNNING
    global _STUDIO_WORKSPACE_FAILURE_KEY
    global _LAST_BRIDGE_VISIBLE_STATE, _LAST_STUDIO_VISIBLE_STATE

    runtime = _RUNTIME
    if runtime is None:
        _TIMER_RUNNING = False
        _LAST_BRIDGE_VISIBLE_STATE = None
        _LAST_STUDIO_VISIBLE_STATE = None
        return None

    studio_runtime = _STUDIO_RUNTIME

    try:
        runtime.pump()
    except Exception as error:
        # A malformed event or unexpected Blender boundary error must not
        # unregister the poll timer or leave the sidebar stale.
        _set_timer_error(runtime, "Error", "Bridge timer error", error)

    after_studio = None
    if studio_runtime is not None:
        try:
            studio_runtime.pump()
        except Exception as error:
            _set_timer_error(studio_runtime, "Studio error", "Studio timer error", error)

        after_studio = _studio_snapshot(studio_runtime)
        workspace = after_studio.get("workspace") if after_studio else None
        if workspace is None:
            # A later explicit workspace response can retry this workspace
            # after the user has cleared the selected workspace.
            _STUDIO_WORKSPACE_FAILURE_KEY = None
        else:
            failure_key = None
            try:
                scene = bpy.context.scene
                failure_key = _workspace_failure_key(
                    workspace, scene, studio_runtime, runtime
                )
                already_failed = failure_key == _STUDIO_WORKSPACE_FAILURE_KEY
                if not already_failed:
                    # Successful materialization is intentionally not cached.
                    # Reopening the same revision must still be allowed to
                    # reconcile a different Blender scene/file.
                    studio_scene.open_workspace(scene, workspace)
            except Exception as error:
                # Cache only the failed materialization, scoped to this scene,
                # workspace revision, and available runtime generations.
                _STUDIO_WORKSPACE_FAILURE_KEY = failure_key
                _set_timer_error(studio_runtime, "Studio error", "Studio scene error", error)
            after_studio = _studio_snapshot(studio_runtime)

    after_bridge = _runtime_snapshot(runtime)
    bridge_changed = after_bridge != _LAST_BRIDGE_VISIBLE_STATE
    studio_changed = after_studio != _LAST_STUDIO_VISIBLE_STATE
    _LAST_BRIDGE_VISIBLE_STATE = after_bridge
    _LAST_STUDIO_VISIBLE_STATE = after_studio
    if bridge_changed or studio_changed:
        # This call is deliberately after all worker events and scene work
        # have crossed the main-thread timer boundary.
        _tag_kinolot_areas()
    return 0.25


def _retire_old_addon() -> None:
    """Switch off the pre-1.1.0 install (package ``cinema_machine_bridge``) if it is enabled.

    Both would otherwise poll the same pairing and draw two Kinolot panels. Runs once
    at register and again from a timer, because Blender may enable the older add-on
    after this one at startup. Never raises: an add-on that can't be switched off is
    left for the user to remove (the panel says so).
    """

    global _OLD_ADDON_RETIRED
    try:
        if OLD_ADDON_MODULE not in bpy.context.preferences.addons:
            return None
        import addon_utils  # type: ignore

        addon_utils.disable(OLD_ADDON_MODULE, default_set=True)
        _OLD_ADDON_RETIRED = True
        _tag_kinolot_areas()
    except Exception:
        pass
    return None


def register() -> None:
    global _RUNTIME, _STUDIO_RUNTIME, _TIMER_RUNNING
    global _LAST_BRIDGE_VISIBLE_STATE, _LAST_STUDIO_VISIBLE_STATE
    for cls in _CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.WindowManager.kinolot_pair_code = StringProperty(
        name="One-time pairing code",
        description="Code generated by the approved browser project",
        subtype="PASSWORD",
    )
    bpy.types.WindowManager.kinolot_pair_acknowledged = BoolProperty(
        name="I approve this project",
        description="Explicitly acknowledge the project before pairing",
        default=False,
    )
    bpy.types.WindowManager.kinolot_studio_tab = EnumProperty(
        name="Studio task",
        items=(
            ("SCENE", "Scene builder", "Create a reviewed scene proposal"),
            ("MODEL", "3D Model", "Request an allowlisted server mesh model"),
            ("ANIMATION", "Character animation", "Create reviewed root-motion tracks"),
            ("ASSETS", "Assets", "Fetch and explicitly import authenticated GLBs"),
        ),
        default="SCENE",
        update=_studio_reset_cost_ack,
    )
    bpy.types.WindowManager.kinolot_studio_prompt = StringProperty(
        name="Prompt",
        description="Prompt sent only to the selected server-authorized Studio model",
        default="",
        maxlen=4000,
        update=_studio_reset_cost_ack,
    )
    bpy.types.WindowManager.kinolot_studio_model = EnumProperty(name="Model", items=_studio_model_items, update=_studio_reset_cost_ack)
    bpy.types.WindowManager.kinolot_studio_mesh_model = EnumProperty(name="Mesh model", items=_studio_mesh_model_items, update=_studio_reset_cost_ack)
    bpy.types.WindowManager.kinolot_studio_asset_name = StringProperty(name="Asset name", default="New asset", maxlen=120, update=_studio_reset_cost_ack)
    bpy.types.WindowManager.kinolot_studio_mesh_rigged = BoolProperty(name="Rigged", default=False, update=_studio_reset_cost_ack)
    bpy.types.WindowManager.kinolot_studio_mesh_animated = BoolProperty(name="Animated", default=False, update=_studio_reset_cost_ack)
    bpy.types.WindowManager.kinolot_studio_cost_ack = BoolProperty(
        name="Approve generation cost",
        description="Required for this one Studio assistant or Meshy submission",
        default=False,
    )
    bpy.types.WindowManager.kinolot_studio_reference_id = StringProperty(name="Reference ID", default="", maxlen=128)
    bpy.types.WindowManager.kinolot_studio_asset_id = StringProperty(name="Asset ID", default="", maxlen=128)
    _RUNTIME = BridgeRuntime()
    _STUDIO_RUNTIME = StudioRuntime(_RUNTIME)
    _LAST_BRIDGE_VISIBLE_STATE = _RUNTIME.snapshot()
    _LAST_STUDIO_VISIBLE_STATE = _STUDIO_RUNTIME.snapshot()
    _reset_studio_workspace_failure()
    _ensure_timer_registered()
    _retire_old_addon()
    try:
        bpy.app.timers.register(_retire_old_addon, first_interval=2.0)
    except Exception:
        pass


def unregister() -> None:
    global _RUNTIME, _STUDIO_RUNTIME, _TIMER_RUNNING
    global _LAST_BRIDGE_VISIBLE_STATE, _LAST_STUDIO_VISIBLE_STATE
    if _RUNTIME is not None:
        _RUNTIME.request_disconnect()
    try:
        if bpy.app.timers.is_registered(_retire_old_addon):
            bpy.app.timers.unregister(_retire_old_addon)
    except Exception:
        pass
    if _timer_registered() or _TIMER_RUNNING:
        try:
            bpy.app.timers.unregister(_timer_callback)
        except ValueError:
            pass
        _TIMER_RUNNING = False
    if hasattr(bpy.types.WindowManager, "kinolot_pair_code"):
        del bpy.types.WindowManager.kinolot_pair_code
    if hasattr(bpy.types.WindowManager, "kinolot_pair_acknowledged"):
        del bpy.types.WindowManager.kinolot_pair_acknowledged
    for name in (
        "kinolot_studio_tab", "kinolot_studio_prompt", "kinolot_studio_model", "kinolot_studio_mesh_model",
        "kinolot_studio_asset_name", "kinolot_studio_mesh_rigged", "kinolot_studio_mesh_animated", "kinolot_studio_cost_ack",
        "kinolot_studio_reference_id", "kinolot_studio_asset_id",
    ):
        if hasattr(bpy.types.WindowManager, name):
            delattr(bpy.types.WindowManager, name)
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
    _RUNTIME = None
    _STUDIO_RUNTIME = None
    _LAST_BRIDGE_VISIBLE_STATE = None
    _LAST_STUDIO_VISIBLE_STATE = None
    _reset_studio_workspace_failure()


if __name__ == "__main__":
    register()
