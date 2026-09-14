"""Headless runner used by test-blender-addon-relay.mjs.

The endpoint is deliberately an HTTP test URL.  The test patches only the
packaged client's URL-policy function so urllib still performs the real
request/response transport; production add-on policy remains HTTPS-only.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import zipfile


def main() -> int:
    endpoint = os.environ["CM_TEST_ENDPOINT"]
    pair_code = os.environ["CM_TEST_PAIR_CODE"]
    marker_path = os.environ["CM_TEST_MARKER"]
    release_path = os.environ["CM_TEST_RELEASE"]
    command_dir = os.environ["CM_TEST_COMMAND_DIR"]
    with tempfile.TemporaryDirectory(prefix="cinema-machine-addon-") as extracted:
        with zipfile.ZipFile(os.environ["CM_TEST_ZIP"]) as archive:
            archive.extractall(extracted)
        sys.path.insert(0, extracted)
        import cinema_machine_bridge as addon  # type: ignore
        from cinema_machine_bridge import protocol  # type: ignore

        def local_endpoint(value: str) -> str:
            if value != endpoint:
                raise protocol.ProtocolError("unexpected test endpoint")
            return value.rstrip("/")

        # Keep the packaged BridgeClient, Request construction, urllib opener,
        # worker thread, runtime event pump, renderer, and response validation.
        protocol.endpoint_url = local_endpoint
        addon.endpoint_url = local_endpoint
        runtime = addon.BridgeRuntime()
        runtime.request_connect(endpoint, pair_code, "Interop Blender")
        deadline = time.time() + 170
        success = False
        snapshot = runtime.snapshot()
        while time.time() < deadline:
            runtime.pump()
            snapshot = runtime.snapshot()
            if (
                snapshot["status"] == "Connected"
                and snapshot["detail"] == "Proof completed"
                and snapshot["activeJob"] is None
            ):
                success = True
                break
            if snapshot["status"] == "Error":
                break
            time.sleep(0.05)
        if success:
            # The Node side performs its response-shape checks while this
            # process remains paired, but the poll worker must not claim them.
            runtime.stop_event.set()
        with open(marker_path, "w", encoding="utf-8") as marker:
            json.dump({"ok": success}, marker)
        if not success:
            runtime.request_disconnect()
            return 1

        client = runtime.client
        if client is None:
            return 1
        cancel_command = os.path.join(command_dir, "cancel.json")
        cancel_result = os.path.join(command_dir, "cancel-result.json")
        while not os.path.exists(cancel_command):
            if os.path.exists(release_path):
                runtime.request_disconnect()
                return 1
            time.sleep(0.05)
        try:
            with open(cancel_command, "r", encoding="utf-8") as command:
                cancel_job_id = json.load(command)["jobId"]
            result = client.job_cancel(runtime.project_id, cancel_job_id)
            cancel_ok = isinstance(result.get("job"), dict) and result["job"].get("status") == "cancelled"
        except Exception:
            cancel_ok = False
        with open(cancel_result, "w", encoding="utf-8") as result_file:
            json.dump({"ok": cancel_ok, "status": "cancelled" if cancel_ok else "invalid"}, result_file)

        fail_command = os.path.join(command_dir, "fail.json")
        fail_result = os.path.join(command_dir, "fail-result.json")
        while not os.path.exists(fail_command):
            time.sleep(0.05)
        try:
            claimed = client.device_claim()
            lease = claimed.get("leaseToken")
            nested_lease = isinstance(claimed.get("job"), dict) and claimed["job"].get("leaseToken")
            failed = client.device_fail(
                claimed["job"]["id"], lease,
                {"code": "render_error", "message": "fixture failure"},
            )
            failure_job = failed.get("job")
            result = {
                "ok": isinstance(lease, str) and bool(lease),
                "leaseInEnvelope": isinstance(lease, str) and bool(lease),
                "leaseInJob": nested_lease == lease,
                "status": failure_job.get("status") if isinstance(failure_job, dict) else "invalid",
                "error": failure_job.get("error") if isinstance(failure_job, dict) else None,
            }
        except Exception:
            result = {"ok": False, "leaseInEnvelope": False, "leaseInJob": False}
        with open(fail_result, "w", encoding="utf-8") as result_file:
            json.dump(result, result_file)
        while not os.path.exists(release_path):
            time.sleep(0.05)
        runtime.request_disconnect()
        time.sleep(0.4)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())