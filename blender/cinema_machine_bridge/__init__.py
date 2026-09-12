"""Cinema Machine Blender Bridge desktop add-on.

The add-on is intentionally a legacy-installable package (rather than a
Blender extension manifest).  It supports Blender 4.2 and newer, makes only
outbound HTTPS requests, and keeps its device token in this process's memory.
"""

from __future__ import annotations

import datetime as _datetime
import queue
import threading
import time
from typing import Any, Dict, Mapping, Optional

import bpy  # type: ignore
from bpy.props import BoolProperty, StringProperty  # type: ignore

from . import renderer
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


bl_info = {
    "name": "Cinema Machine Bridge",
    "author": "Cinema Machine",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "3D View > Sidebar > CinemaMachine",
    "description": "Render an approved editable Blender proof through the Cinema Machine bridge",
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
            name="CinemaMachineConnect",
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
                name="CinemaMachineDisconnect",
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
            name="CinemaMachineCancel",
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
                        name="CinemaMachineValidationFailure",
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
                name="CinemaMachineComplete",
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
                    name="CinemaMachineRenderFailure",
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
_TIMER_RUNNING = False


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
    bl_idname = "cinema_machine.connect"
    bl_label = "Connect"
    bl_description = "Pair this Blender desktop using a one-time code"

    def execute(self, context: Any) -> set:
        preferences = context.preferences.addons[__package__].preferences
        pair_code = context.window_manager.cm_pair_code
        if not context.window_manager.cm_pair_acknowledged:
            self.report({"ERROR"}, "Confirm the project and one-time code before connecting")
            return {"CANCELLED"}
        if not pair_code.strip():
            self.report({"ERROR"}, "Enter the one-time pairing code")
            return {"CANCELLED"}
        assert _RUNTIME is not None
        _RUNTIME.request_connect(preferences.edge_function_url, pair_code, preferences.device_name)
        return {"FINISHED"}


class CM_OT_disconnect(bpy.types.Operator):
    bl_idname = "cinema_machine.disconnect"
    bl_label = "Disconnect"
    bl_description = "Clear the in-memory device token and disconnect"

    def execute(self, _context: Any) -> set:
        assert _RUNTIME is not None
        _RUNTIME.request_disconnect()
        return {"FINISHED"}


class CM_OT_cancel(bpy.types.Operator):
    bl_idname = "cinema_machine.cancel"
    bl_label = "Cancel Job"
    bl_description = "Ask the relay to cancel the current proof job"

    def execute(self, _context: Any) -> set:
        assert _RUNTIME is not None
        _RUNTIME.request_cancel()
        return {"FINISHED"}


class VIEW3D_PT_cinema_machine(bpy.types.Panel):
    bl_label = "Cinema Machine"
    bl_idname = "VIEW3D_PT_cinema_machine_bridge"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "CinemaMachine"

    def draw(self, context: Any) -> None:
        layout = self.layout
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
        connection.prop(context.window_manager, "cm_pair_code", text="Pair code")
        connection.prop(context.window_manager, "cm_pair_acknowledged", text="I approve this project")
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


_CLASSES = (
    CMPreferences,
    CM_OT_connect,
    CM_OT_disconnect,
    CM_OT_cancel,
    VIEW3D_PT_cinema_machine,
)


def _timer_callback() -> Optional[float]:
    if _RUNTIME is None:
        return None
    _RUNTIME.pump()
    return 0.25


def register() -> None:
    global _RUNTIME, _TIMER_RUNNING
    for cls in _CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.WindowManager.cm_pair_code = StringProperty(
        name="One-time pairing code",
        description="Code generated by the approved browser project",
        subtype="PASSWORD",
    )
    bpy.types.WindowManager.cm_pair_acknowledged = BoolProperty(
        name="I approve this project",
        description="Explicitly acknowledge the project before pairing",
        default=False,
    )
    _RUNTIME = BridgeRuntime()
    if not _TIMER_RUNNING:
        bpy.app.timers.register(_timer_callback, first_interval=0.25, persistent=True)
        _TIMER_RUNNING = True


def unregister() -> None:
    global _RUNTIME, _TIMER_RUNNING
    if _RUNTIME is not None:
        _RUNTIME.request_disconnect()
    if _TIMER_RUNNING:
        try:
            bpy.app.timers.unregister(_timer_callback)
        except ValueError:
            pass
        _TIMER_RUNNING = False
    if hasattr(bpy.types.WindowManager, "cm_pair_code"):
        del bpy.types.WindowManager.cm_pair_code
    if hasattr(bpy.types.WindowManager, "cm_pair_acknowledged"):
        del bpy.types.WindowManager.cm_pair_acknowledged
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
    _RUNTIME = None


if __name__ == "__main__":
    register()
