"""Headless Blender regression test for native add-on status redraws.

Run from the repository root with:

    blender --background --factory-startup --python scripts/test-blender-addon-status.py

The test uses Blender's real ``bpy`` module and timer registry, but replaces
network-facing runtimes with bounded in-process fakes.  It does not connect to
the relay, generate Studio work, or build the add-on package.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from types import SimpleNamespace

import bpy  # type: ignore


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "blender"))

import kinolot_bridge as addon  # noqa: E402


def fail(message: str) -> None:
    raise AssertionError(message)


class FakeBridgeRuntime:
    def __init__(self, statuses=()):
        self.status = "Connecting"
        self.detail = "Waiting for bridge response"
        self._statuses = list(statuses)
        self.pump_calls = 0

    def snapshot(self):
        return {
            "status": self.status,
            "detail": self.detail,
            "projectId": "",
            "expiresAt": None,
            "activeJob": None,
            "connected": self.status in {"Connected", "Completed"},
        }

    def pump(self):
        self.pump_calls += 1
        if self._statuses:
            self.status = self._statuses.pop(0)
            self.detail = self.status

    def _set_status(self, status, detail=""):
        self.status, self.detail = status, detail


class ExplodingRuntime(FakeBridgeRuntime):
    def pump(self):
        self.pump_calls += 1
        raise RuntimeError("deliberate timer boundary failure")


class FakeStudioRuntime:
    def __init__(self, workspace=None):
        self.status = "Studio disconnected"
        self.detail = ""
        self.workspace = workspace
        self.pump_calls = 0

    def snapshot(self):
        return {
            "workspace": self.workspace,
            "shotId": None,
            "capabilities": {},
            "task": None,
            "proposal": None,
            "asset": None,
            "preview": None,
            "referenceDataUrl": None,
            "localAttachment": None,
            "attachmentName": "",
            "history": (),
            "status": self.status,
            "detail": self.detail,
            "conflict": False,
            "hasReloadedWorkspace": False,
        }

    def pump(self):
        self.pump_calls += 1

    def _set_status(self, status, detail=""):
        self.status, self.detail = status, detail


class ExplodingStudioRuntime(FakeStudioRuntime):
    def pump(self):
        self.pump_calls += 1
        raise RuntimeError("deliberate Studio timer boundary failure")


class NoSpendBridgeClient:
    """Actual BridgeRuntime worker boundary with no HTTP or paid operation."""

    instances = []

    def __init__(self, endpoint):
        self.endpoint = endpoint
        self.token = None
        self.connect_calls = 0
        self.claim_calls = 0
        self.disconnect_calls = 0
        self.instances.append(self)

    def device_connect(self, pair_code, device_name):
        self.connect_calls += 1
        if pair_code != "real-worker-pair" or device_name != "Status Worker":
            raise AssertionError("real worker test passed unexpected pairing fields")
        return {
            "deviceToken": "worker-test-token",
            "projectId": "worker-test-project",
            "expiresAt": "2999-01-01T00:00:00Z",
        }

    def device_claim(self):
        self.claim_calls += 1
        return {"job": None}

    def connection_disconnect(self, project_id):
        self.disconnect_calls += 1
        if project_id != "worker-test-project":
            raise AssertionError("real worker disconnect used the wrong project")


def assert_area_redraw_helper():
    calls = []
    area = SimpleNamespace(type="VIEW_3D", tag_redraw=lambda: calls.append("redraw"))
    screen = SimpleNamespace(areas=[area])
    window = SimpleNamespace(screen=screen)
    original_bpy = addon.bpy
    addon.bpy = SimpleNamespace(
        context=SimpleNamespace(window_manager=SimpleNamespace(windows=[window]))
    )
    try:
        addon._tag_kinolot_areas()
    finally:
        addon.bpy = original_bpy
    if calls != ["redraw"]:
        fail("VIEW_3D area redraw helper did not tag the sidebar area")


def main():
    addon.register()
    original_runtime = addon._RUNTIME
    original_studio = addon._STUDIO_RUNTIME
    original_redraw = addon._tag_kinolot_areas
    redraws = []
    addon._tag_kinolot_areas = lambda: redraws.append("redraw")
    original_open_workspace = addon.studio_scene.open_workspace
    try:
        addon._tag_kinolot_areas = original_redraw
        assert_area_redraw_helper()
        addon._tag_kinolot_areas = lambda: redraws.append("redraw")
        if not bpy.app.timers.is_registered(addon._timer_callback):
            fail("register() did not install the persistent Blender timer")

        # A stale bookkeeping flag must not suppress re-enabling the actual
        # timer registry.
        bpy.app.timers.unregister(addon._timer_callback)
        addon._TIMER_RUNNING = True
        if addon._timer_registered():
            fail("timer registry still reported an unregistered callback")
        addon._ensure_timer_registered()
        if not bpy.app.timers.is_registered(addon._timer_callback):
            fail("timer was not re-enabled from a stale running flag")

        # Explicit Connect re-enables a stopped timer without making a
        # network request in this test.
        bpy.app.timers.unregister(addon._timer_callback)
        addon._TIMER_RUNNING = True
        connect_runtime = addon._RUNTIME
        original_connect = connect_runtime.request_connect
        connect_runtime.request_connect = lambda *_args: None
        window_manager = bpy.context.window_manager
        window_manager.kinolot_pair_code = "status-test-pair-code"
        window_manager.kinolot_pair_acknowledged = True
        connect_context = SimpleNamespace(
            preferences=SimpleNamespace(
                addons={
                    "kinolot_bridge": SimpleNamespace(
                        preferences=SimpleNamespace(
                            edge_function_url="https://status-test.invalid",
                            device_name="Status Test Blender",
                        )
                    )
                }
            ),
            window_manager=window_manager,
        )
        addon.CM_OT_connect.execute(SimpleNamespace(), connect_context)
        connect_runtime.request_connect = original_connect
        if not bpy.app.timers.is_registered(addon._timer_callback):
            fail("explicit Connect did not restore the actual timer")

        # Explicit Studio Open follows the same recovery path.  Its dialog
        # context is local and does not perform transport in this test.
        bpy.app.timers.unregister(addon._timer_callback)
        addon._TIMER_RUNNING = True
        original_current = addon._STUDIO_RUNTIME.request_current
        original_capabilities = addon._STUDIO_RUNTIME.request_capabilities
        addon._STUDIO_RUNTIME.request_current = lambda: None
        addon._STUDIO_RUNTIME.request_capabilities = lambda: None

        class DialogWindowManager:
            def invoke_props_dialog(self, *_args, **_kwargs):
                return {"RUNNING_MODAL"}

        addon.CM_OT_studio_open.invoke(
            SimpleNamespace(),
            SimpleNamespace(window_manager=DialogWindowManager()), None
        )
        addon._STUDIO_RUNTIME.request_current = original_current
        addon._STUDIO_RUNTIME.request_capabilities = original_capabilities
        if not bpy.app.timers.is_registered(addon._timer_callback):
            fail("explicit Studio Open did not restore the actual timer")

        # A successful relay event, completion, and error each redraw exactly
        # once; an idle callback is not a redraw storm.
        addon._RUNTIME = FakeBridgeRuntime(("Connected", "Completed", "Error"))
        addon._STUDIO_RUNTIME = None
        redraws.clear()
        for expected in ("Connected", "Completed", "Error"):
            if addon._timer_callback() != 0.25:
                fail("timer did not stay alive after a bridge state change")
            if addon._RUNTIME.status != expected:
                fail("bridge fake did not reach expected status")
        if len(redraws) != 3:
            fail("bridge state changes did not produce one redraw each")
        addon._timer_callback()
        if len(redraws) != 3:
            fail("idle bridge timer caused a redraw storm")

        # Worker threads may enqueue relay events, but cannot redraw.  The
        # main-thread timer is the only path that consumes the event and tags.
        worker_runtime = addon.BridgeRuntime()
        worker_runtime.generation = 1
        worker_runtime.token = "in-memory-test-token"
        worker_runtime.client = object()

        def enqueue_error():
            worker_runtime.events.put(
                {"kind": "connect_error", "generation": 1, "error": "worker event"}
            )

        redraws.clear()
        worker = threading.Thread(target=enqueue_error)
        worker.start()
        worker.join()
        if redraws:
            fail("worker thread touched the redraw path")
        addon._RUNTIME = worker_runtime
        addon._STUDIO_RUNTIME = None
        addon._LAST_BRIDGE_VISIBLE_STATE = worker_runtime.snapshot()
        addon._LAST_STUDIO_VISIBLE_STATE = None
        addon._timer_callback()
        if worker_runtime.status != "Error" or len(redraws) != 1:
            fail("main-thread timer did not surface the worker event")

        # Exercise the actual request_connect/_connect_worker boundary.  The
        # client is a no-spend transport stub; only the real worker, queue,
        # generation checks, and main-thread timer are under test.
        original_client_class = addon.BridgeClient
        real_worker_runtime = addon.BridgeRuntime()
        addon.BridgeClient = NoSpendBridgeClient
        addon._RUNTIME = real_worker_runtime
        addon._STUDIO_RUNTIME = None
        addon._LAST_BRIDGE_VISIBLE_STATE = real_worker_runtime.snapshot()
        addon._LAST_STUDIO_VISIBLE_STATE = None
        redraws.clear()
        try:
            real_worker_runtime.request_connect(
                "https://status-test.supabase.co/functions/v1/blender-bridge",
                "real-worker-pair",
                "Status Worker",
            )
            deadline = time.time() + 3.0
            while real_worker_runtime.events.empty() and time.time() < deadline:
                time.sleep(0.01)
            if real_worker_runtime.events.empty():
                fail("real BridgeRuntime worker did not enqueue completion")
            if redraws:
                fail("real BridgeRuntime worker called the redraw path")
            if real_worker_runtime.client is None or real_worker_runtime.token is None:
                fail("real BridgeRuntime worker did not transfer its in-memory client")
            if addon._timer_callback() != 0.25:
                fail("timer did not remain alive after real worker completion")
            if real_worker_runtime.status != "Connected" or len(redraws) != 1:
                fail("main-thread timer did not redraw real worker completion")
            if (
                len(NoSpendBridgeClient.instances) != 1
                or NoSpendBridgeClient.instances[0].connect_calls != 1
                or NoSpendBridgeClient.instances[0].claim_calls < 1
            ):
                fail("real worker test used an unexpected transport path")
        finally:
            real_worker_runtime.request_disconnect()
            addon.BridgeClient = original_client_class

        # Stale events are ignored without stopping the timer; current
        # connected, expired, and relay-cancelled events each remain visible.
        event_runtime = addon.BridgeRuntime()
        event_runtime.generation = 2
        event_runtime.token = "event-test-token"
        event_runtime.client = object()
        addon._RUNTIME = event_runtime
        addon._STUDIO_RUNTIME = None
        addon._LAST_BRIDGE_VISIBLE_STATE = event_runtime.snapshot()
        addon._LAST_STUDIO_VISIBLE_STATE = None
        redraws.clear()
        event_runtime.events.put({
            "kind": "connected",
            "generation": 1,
            "projectId": "stale-project",
            "expiresAt": "2999-01-01T00:00:00Z",
        })
        if addon._timer_callback() != 0.25:
            fail("stale-generation event stopped the timer")
        if event_runtime.status != "Disconnected" or redraws:
            fail("stale-generation event changed status or redrew")

        event_runtime.events.put({
            "kind": "connected",
            "generation": 2,
            "projectId": "current-project",
            "expiresAt": "2999-01-01T00:00:00Z",
        })
        if addon._timer_callback() != 0.25 or event_runtime.status != "Connected":
            fail("current-generation connected event was not surfaced")
        if len(redraws) != 1:
            fail("current-generation connected event did not redraw")

        event_runtime.events.put({"kind": "expired", "generation": 2})
        if addon._timer_callback() != 0.25:
            fail("expired event stopped the timer")
        if event_runtime.status != "Expired" or event_runtime.client is not None or len(redraws) != 2:
            fail("expired event was not surfaced with one redraw")

        event_runtime.client = object()
        event_runtime.token = "event-test-token"
        event_runtime.active_job = {
            "jobId": "cancel-job", "leaseToken": "lease", "generation": 2, "cancelled": False
        }
        event_runtime.status = "Connected"
        addon._LAST_BRIDGE_VISIBLE_STATE = event_runtime.snapshot()
        event_runtime.events.put({
            "kind": "job_status",
            "generation": 2,
            "job": {"id": "cancel-job", "status": "cancelled"},
        })
        if addon._timer_callback() != 0.25:
            fail("cancel event stopped the timer")
        if event_runtime.status != "Cancelled" or len(redraws) != 3:
            fail("cancel event was not surfaced with one redraw")

        # Unexpected bridge and Studio timer failures are surfaced while the
        # persistent callback remains alive.
        addon._RUNTIME = ExplodingRuntime()
        addon._STUDIO_RUNTIME = None
        addon._LAST_BRIDGE_VISIBLE_STATE = addon._RUNTIME.snapshot()
        addon._LAST_STUDIO_VISIBLE_STATE = None
        redraws.clear()
        if addon._timer_callback() != 0.25 or addon._RUNTIME.status != "Error":
            fail("unexpected bridge timer error was not contained")
        if len(redraws) != 1:
            fail("contained bridge timer error did not redraw its status")

        addon._RUNTIME = FakeBridgeRuntime()
        addon._STUDIO_RUNTIME = ExplodingStudioRuntime()
        addon._LAST_BRIDGE_VISIBLE_STATE = addon._RUNTIME.snapshot()
        addon._LAST_STUDIO_VISIBLE_STATE = addon._STUDIO_RUNTIME.snapshot()
        redraws.clear()
        if addon._timer_callback() != 0.25 or addon._STUDIO_RUNTIME.status != "Studio error":
            fail("unexpected Studio timer error was not contained")
        if len(redraws) != 1:
            fail("contained Studio timer error did not redraw its status")

        # A scene failure is attempted once for a workspace revision, not
        # every 250 ms.  A changed revision remains eligible for one attempt.
        workspace = {"projectId": "status-test", "locationId": "set", "revision": 1}
        studio = FakeStudioRuntime(workspace)
        studio.generation = 4
        addon._RUNTIME = FakeBridgeRuntime()
        addon._RUNTIME.generation = 9
        addon._STUDIO_RUNTIME = studio
        addon._LAST_BRIDGE_VISIBLE_STATE = addon._RUNTIME.snapshot()
        addon._LAST_STUDIO_VISIBLE_STATE = studio.snapshot()
        attempts = []

        def fail_open(_scene, _workspace):
            attempts.append(_workspace["revision"])
            raise RuntimeError("deliberate scene recovery failure")

        addon.studio_scene.open_workspace = fail_open
        redraws.clear()
        if addon._timer_callback() != 0.25:
            fail("scene error stopped the timer")
        if addon._timer_callback() != 0.25:
            fail("second scene-error timer callback did not stay alive")
        if attempts != [1]:
            fail("same failing workspace was applied repeatedly")
        studio.workspace = dict(workspace, revision=2)
        addon._timer_callback()
        if attempts != [1, 2]:
            fail("changed workspace revision was not eligible for recovery")

        # Successful materialization is deliberately not cached: the same
        # revision is still opened on the next tick for another scene/file.
        successful_attempts = []

        def successful_open(_scene, _workspace):
            successful_attempts.append(_workspace["revision"])

        addon.studio_scene.open_workspace = successful_open
        studio.workspace = dict(workspace, revision=3)
        addon._timer_callback()
        addon._timer_callback()
        if successful_attempts != [3, 3]:
            fail("successful workspace materialization was incorrectly cached")
        first_key = addon._workspace_failure_key(
            studio.workspace, bpy.context.scene, studio, addon._RUNTIME
        )
        other_scene = SimpleNamespace(as_pointer=lambda: 987654321)
        other_key = addon._workspace_failure_key(
            studio.workspace, other_scene, studio, addon._RUNTIME
        )
        if first_key == other_key:
            fail("workspace failure cache was not scoped to Blender scene identity")

        # A stopped/unavailable runtime removes the timer naturally, while
        # explicit registration remains available for the next user action.
        if bpy.app.timers.is_registered(addon._timer_callback):
            bpy.app.timers.unregister(addon._timer_callback)
        addon._TIMER_RUNNING = True
        addon._RUNTIME = None
        addon._STUDIO_RUNTIME = None
        if addon._timer_callback() is not None:
            fail("unavailable runtime did not stop its timer callback")
        addon._ensure_timer_registered()
        if not bpy.app.timers.is_registered(addon._timer_callback):
            fail("timer could not be re-enabled after unavailable runtime")
    finally:
        addon.studio_scene.open_workspace = original_open_workspace
        addon._tag_kinolot_areas = original_redraw
        addon._RUNTIME = original_runtime
        addon._STUDIO_RUNTIME = original_studio
        addon.unregister()
        if bpy.app.timers.is_registered(addon._timer_callback):
            fail("unregister() left the persistent timer registered")

    print("BLENDER_ADDON_STATUS_OK redraws=state-change-only timer-recovery=ok")


if __name__ == "__main__":
    main()