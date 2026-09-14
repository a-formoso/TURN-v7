"""Asynchronous desktop transport state for Cinema Machine Studio.

Workers only perform HTTPS through the already-paired bridge client.  Blender
scene mutation is deliberately left to the add-on timer/UI after events have
passed generation, project, and workspace scope checks.
"""

from __future__ import annotations

import queue
import threading
import uuid
from typing import Any, Dict, Mapping, Optional

from .protocol import BridgeError, BridgeHTTPError
from .studio_protocol import StudioProtocolError, validate_proposal, validate_workspace


def _error(error: BaseException) -> str:
    text = str(error).replace("\n", " ").replace("\r", " ")
    return (text[:237] + "...") if len(text) > 240 else (text or error.__class__.__name__)


def _checked_task(value: Any, workspace: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("id"), str) or not value["id"]:
        raise StudioProtocolError("Studio task response is invalid")
    if value.get("status") not in {"queued", "running", "completed", "failed", "cancelled"}:
        raise StudioProtocolError("Studio task has an invalid status")
    if not isinstance(value.get("modelId"), str) or not value["modelId"]:
        raise StudioProtocolError("Studio task has an invalid model")
    if workspace is not None and value.get("locationId") != workspace["locationId"]:
        raise StudioProtocolError("Studio task does not belong to the selected workspace")
    return dict(value)


class StudioRuntime:
    """Owns Studio request state but never calls ``bpy`` from a worker."""

    def __init__(self, bridge: Any) -> None:
        self._bridge = bridge
        self._lock = threading.RLock()
        self.events: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        self.generation = 0
        self.workspace: Optional[Dict[str, Any]] = None
        self.shot_id: Optional[str] = None
        self.capabilities: Dict[str, Any] = {}
        self.task: Optional[Dict[str, Any]] = None
        self.proposal: Optional[Dict[str, Any]] = None
        self.asset_response: Optional[Dict[str, Any]] = None
        self.preview: Optional[Dict[str, Any]] = None
        self.reference_data_url: Optional[str] = None
        self.local_attachment: Optional[str] = None
        self.local_attachment_name: str = ""
        self.history = []
        self.status = "Studio disconnected"
        self.detail = ""
        self.conflict = False
        self.pending_workspace: Optional[Dict[str, Any]] = None
        self._inflight_task_get = False
        self._reloading_after_conflict = False

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "workspace": self.workspace,
                "shotId": self.shot_id,
                "capabilities": dict(self.capabilities),
                "task": dict(self.task) if self.task else None,
                "proposal": dict(self.proposal) if self.proposal else None,
                "asset": dict(self.asset_response) if self.asset_response else None,
                "preview": dict(self.preview) if self.preview else None,
                "referenceDataUrl": self.reference_data_url,
                "localAttachment": self.local_attachment,
                "attachmentName": self.local_attachment_name,
                "history": tuple(self.history[-12:]),
                "status": self.status,
                "detail": self.detail,
                "conflict": self.conflict,
                "hasReloadedWorkspace": self.pending_workspace is not None,
            }

    def _request(self, kind: str, action: str, fields: Mapping[str, Any]) -> None:
        with self._bridge.lock:
            client = self._bridge.client
            project_id = self._bridge.project_id
            bridge_generation = self._bridge.generation
        if client is None or not project_id:
            self._set_status("Studio disconnected", "Pair this desktop before using Studio")
            return
        with self._lock:
            scope_generation = self.generation
        payload = dict(fields)
        payload["projectId"] = project_id

        def worker() -> None:
            try:
                with self._bridge.network_lock:
                    if not self._bridge._current(bridge_generation):
                        return
                    response = client.post(action, **payload)
                if not isinstance(response, dict):
                    raise StudioProtocolError("Studio returned an invalid response envelope")
                self.events.put(
                    {
                        "kind": kind,
                        "scopeGeneration": scope_generation,
                        "bridgeGeneration": bridge_generation,
                        "response": response,
                    }
                )
            except Exception as error:
                self.events.put(
                    {
                        "kind": "error",
                        "requestKind": kind,
                        "scopeGeneration": scope_generation,
                        "bridgeGeneration": bridge_generation,
                        "error": _error(error),
                        "conflict": isinstance(error, BridgeHTTPError)
                        and getattr(error, "code", "") in {"revision_conflict", "conflict"},
                    }
                )

        threading.Thread(target=worker, name="CinemaMachineStudio" + kind.title(), daemon=True).start()

    def _set_status(self, status: str, detail: str = "") -> None:
        with self._lock:
            self.status, self.detail = status, detail

    def request_capabilities(self) -> None:
        self._set_status("Checking Studio capabilities")
        self._request("capabilities", "studio.capabilities", {})

    def request_current(self) -> None:
        self._set_status("Opening selected Studio workspace")
        self._request("current", "studio.workspace.current", {})

    def request_workspace(self, location_id: str) -> None:
        self._set_status("Opening Studio workspace")
        self._request("workspace", "studio.workspace.get", {"locationId": location_id})

    def request_save(self, local_workspace: Dict[str, Any]) -> None:
        try:
            checked = validate_workspace(local_workspace)
        except StudioProtocolError as error:
            self._set_status("Studio error", _error(error))
            return
        with self._lock:
            current = self.workspace
            if current is None or checked["projectId"] != current["projectId"] or checked["locationId"] != current["locationId"]:
                self._set_status("Studio error", "The local workspace is no longer selected")
                return
            self.pending_workspace = checked
            self.conflict = False
        self._set_status("Saving Studio workspace")
        self._request(
            "save",
            "studio.workspace.save",
            {
                "locationId": checked["locationId"],
                "baseRevision": checked["revision"],
                "mutationId": "desktop_" + uuid.uuid4().hex,
                "workspace": checked,
            },
        )

    def request_assistant(
        self,
        mode: str,
        model_id: str,
        prompt: str,
        local_workspace: Dict[str, Any],
        image_data_url: Optional[str] = None,
        acknowledge_cost: bool = False,
    ) -> None:
        with self._lock:
            billing_disabled = self.capabilities.get("billingReady") is False
        if billing_disabled:
            self._set_status(
                "Studio error",
                "Paid AI is disabled pending approval of the atomic credit update",
            )
            return
        if mode not in {"scene", "animation"} or not isinstance(model_id, str) or not model_id:
            self._set_status("Studio error", "Choose a supported mode and model")
            return
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 4000:
            self._set_status("Studio error", "Prompt must contain 1-4000 characters")
            return
        if acknowledge_cost is not True:
            self._set_status("Studio error", "Confirm the displayed cost before submitting")
            return
        try:
            checked = validate_workspace(local_workspace)
        except StudioProtocolError as error:
            self._set_status("Studio error", _error(error))
            return
        fields: Dict[str, Any] = {
            "locationId": checked["locationId"],
            "baseRevision": checked["revision"],
            "requestId": "desktop_" + uuid.uuid4().hex,
            "modelId": model_id,
            "mode": mode,
            "prompt": prompt.strip(),
            "snapshot": checked,
            "acknowledgeCost": True,
        }
        with self._lock:
            if self.shot_id:
                fields["shotId"] = self.shot_id
            if image_data_url:
                fields["imageDataUrl"] = image_data_url
            self.proposal = None
            self.history.append({"role": "You", "text": prompt.strip()[:240]})
        self._set_status("Submitting reviewed Studio request")
        self._request("assistant", "studio.assistant.submit", fields)

    def set_local_attachment(self, data_url: Optional[str], name: str = "") -> None:
        """Keep device-origin reference pixels only in this desktop process."""

        with self._lock:
            self.local_attachment = data_url
            self.local_attachment_name = name if data_url else ""

    def set_local_workspace(self, workspace: Dict[str, Any]) -> None:
        """Adopt an explicit main-thread Blender snapshot without saving it."""

        checked = validate_workspace(workspace)
        with self._lock:
            if self.workspace is None:
                raise StudioProtocolError("No Studio workspace is selected")
            if checked["projectId"] != self.workspace["projectId"] or checked["locationId"] != self.workspace["locationId"]:
                raise StudioProtocolError("Snapshot does not belong to the selected workspace")
            self.workspace = checked
            self.proposal = None
            self.status, self.detail = "Local Studio edits ready", "Use Save to publish this revision"

    def request_mesh(
        self,
        model_id: str,
        name: str,
        *,
        prompt: Optional[str] = None,
        image_data_url: Optional[str] = None,
        reference_id: Optional[str] = None,
        character_id: Optional[str] = None,
        rigged: bool = False,
        animated: bool = False,
        acknowledge_cost: bool = False,
    ) -> None:
        with self._lock:
            workspace = self.workspace
            billing_disabled = self.capabilities.get("billingReady") is False
        if billing_disabled:
            self._set_status(
                "Studio error",
                "Paid AI is disabled pending approval of the atomic credit update",
            )
            return
        if workspace is None:
            self._set_status("Studio error", "Open a workspace before requesting a model")
            return
        if not isinstance(model_id, str) or not model_id or not isinstance(name, str) or not name.strip():
            self._set_status("Studio error", "Choose a supported mesh model and asset name")
            return
        if acknowledge_cost is not True:
            self._set_status("Studio error", "Confirm the displayed cost before submitting")
            return
        fields: Dict[str, Any] = {
            "locationId": workspace["locationId"], "requestId": "desktop_" + uuid.uuid4().hex,
            "modelId": model_id, "name": name.strip()[:120], "rigged": bool(rigged),
            "animated": bool(animated), "acknowledgeCost": True,
        }
        if prompt:
            fields["prompt"] = prompt[:4000]
        if image_data_url:
            fields["imageDataUrl"] = image_data_url
        if reference_id:
            fields["referenceId"] = reference_id
        if character_id:
            fields["characterId"] = character_id
        self._set_status("Submitting mesh request")
        self._request("mesh", "studio.mesh.submit", fields)

    def request_asset(self, asset_id: str) -> None:
        with self._lock:
            workspace = self.workspace
        if workspace is None:
            self._set_status("Studio error", "Open a workspace before importing an asset")
            return
        self._set_status("Fetching authenticated asset")
        self._request("asset", "studio.asset.get", {"locationId": workspace["locationId"], "assetId": asset_id})

    def request_preview(self, local_workspace: Dict[str, Any], png_base64: str, actual_camera: Dict[str, Any]) -> None:
        checked = validate_workspace(local_workspace)
        with self._lock:
            shot_id = self.shot_id
        fields: Dict[str, Any] = {
            "locationId": checked["locationId"], "baseRevision": checked["revision"],
            "requestId": "desktop_" + uuid.uuid4().hex, "pngBase64": png_base64,
            "actualCamera": actual_camera,
        }
        if shot_id:
            fields["shotId"] = shot_id
        self._set_status("Publishing auxiliary preview")
        self._request("preview", "studio.preview.publish", fields)

    def request_reference(self, entity_id: str) -> None:
        with self._lock:
            workspace = self.workspace
        if workspace is None:
            self._set_status("Studio error", "Open a workspace before attaching a reference")
            return
        self._set_status("Fetching approved project reference")
        self._request("reference", "studio.reference.get", {"locationId": workspace["locationId"], "entityId": entity_id})

    def request_cancel_task(self) -> None:
        with self._lock:
            task = self.task
        if not task or not isinstance(task.get("id"), str):
            self._set_status("Studio error", "There is no Studio task to cancel")
            return
        action = "studio.mesh.cancel" if task.get("type") == "mesh" else "studio.assistant.cancel"
        self._set_status("Cancelling Studio task")
        self._request("cancel", action, {"taskId": task["id"]})

    def request_task(self) -> None:
        with self._lock:
            task = self.task
        if not task or not isinstance(task.get("id"), str):
            self._set_status("Studio error", "There is no Studio task to refresh")
            return
        action = "studio.mesh.get" if task.get("type") == "mesh" else "studio.assistant.get"
        self._set_status("Refreshing Studio task")
        self._request("task", action, {"taskId": task["id"]})

    def reload_after_conflict(self) -> None:
        """Discard no local data; caller decides whether to apply this reload."""

        with self._lock:
            workspace = self.workspace
        if workspace:
            with self._lock:
                self._reloading_after_conflict = True
            self.request_workspace(workspace["locationId"])

    def accept_reloaded_workspace(self) -> Optional[Dict[str, Any]]:
        """Adopt a server revision only after the user explicitly discards local state."""

        with self._lock:
            if self.pending_workspace is None:
                return None
            self.workspace = self.pending_workspace
            self.pending_workspace = None
            self.conflict = False
            self.generation += 1
            self.status, self.detail = "Server workspace selected", "Local managed edits were explicitly replaced"
            return dict(self.workspace)

    def pump(self) -> None:
        for _ in range(32):
            try:
                event = self.events.get_nowait()
            except queue.Empty:
                return
            with self._lock:
                # Capabilities are project-scoped (not workspace-scoped), so
                # opening a workspace while its capability request is in
                # flight must not make the model picker silently disappear.
                project_scoped = event.get("kind") == "capabilities" or event.get("requestKind") == "capabilities"
                if not project_scoped and event.get("scopeGeneration") != self.generation:
                    continue
            with self._bridge.lock:
                if event.get("bridgeGeneration") != self._bridge.generation:
                    continue
            self._handle(event)

    def _handle(self, event: Mapping[str, Any]) -> None:
        kind = event["kind"]
        if kind == "error":
            with self._lock:
                self.conflict = bool(event.get("conflict"))
                self.status = "Studio conflict" if self.conflict else "Studio error"
                self.detail = str(event["error"])
            return
        response = event.get("response")
        if not isinstance(response, dict):
            self._set_status("Studio error", "Studio returned an invalid response")
            return
        try:
            if kind in {"current", "workspace", "save"}:
                workspace = response.get("workspace")
                if workspace is None and kind == "current":
                    with self._lock:
                        self.workspace, self.shot_id = None, None
                        self.status, self.detail = "No Studio workspace selected", "Open a location from the browser first"
                    return
                checked = validate_workspace(workspace)
                shot_id = response.get("shotId")
                if shot_id is not None and not isinstance(shot_id, str):
                    raise StudioProtocolError("workspace response has an invalid shot ID")
                with self._lock:
                    if kind == "workspace" and self._reloading_after_conflict and self.workspace is not None:
                        self.pending_workspace = checked
                        self._reloading_after_conflict = False
                        self.status, self.detail = "Server revision loaded", "Choose Replace local workspace to discard managed local edits"
                        return
                    self.workspace = checked
                    if kind == "current" or shot_id is not None:
                        self.shot_id = shot_id
                    self.pending_workspace = None
                    self.conflict = False
                    self.generation += 1
                    self.status, self.detail = "Studio workspace ready", checked["name"]
            elif kind == "capabilities":
                if response.get("schema") != "cm-studio-v1" or not isinstance(response.get("models"), list):
                    raise StudioProtocolError("Studio capabilities response is invalid")
                with self._lock:
                    self.capabilities = dict(response)
                    self.status, self.detail = "Studio capabilities ready", ""
            elif kind in {"assistant", "mesh", "task", "cancel"}:
                with self._lock:
                    task = _checked_task(response.get("task"), self.workspace)
                    self.task = dict(task)
                    self.status, self.detail = "Studio task " + str(task.get("status", "queued")), str(task.get("message", ""))[:240]
                    message = str(task.get("message", "")).strip()
                    if message:
                        self.history.append({"role": "Studio", "text": message[:240]})
                    proposal = task.get("proposal")
                    if proposal is not None and self.workspace is not None:
                        self.proposal = validate_proposal(proposal, self.workspace)
            elif kind == "asset":
                if not isinstance(response.get("asset"), dict) or not isinstance(response.get("base64"), str):
                    raise StudioProtocolError("Asset response is invalid")
                with self._lock:
                    self.asset_response = dict(response)
                    self.status, self.detail = "Asset ready to import", "Use Import asset to make a local managed copy"
            elif kind == "reference":
                if not isinstance(response.get("entityId"), str) or not isinstance(response.get("dataUrl"), str):
                    raise StudioProtocolError("Reference response is invalid")
                with self._lock:
                    self.reference_data_url = response["dataUrl"]
                    self.status, self.detail = "Approved reference attached", ""
            elif kind == "preview":
                if not isinstance(response.get("preview"), dict):
                    raise StudioProtocolError("Preview response is invalid")
                with self._lock:
                    self.preview = dict(response["preview"])
                    self.status, self.detail = "Auxiliary preview published", "This preview is not finished art"
        except StudioProtocolError as error:
            self._set_status("Studio error", _error(error))