"""Run connection HTTP smoke tests against an owned backend and temporary database."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def run_smoke(post):
    marker = uuid.uuid4().hex
    created = set()
    try:
        for auth in ({"type": "none"}, {"type": "api_key", "secrets": ["synthetic-e2e-key"]}):
            body = {
                "name": f"e2e-{auth['type']}-{marker}",
                "adapterType": "openai_compatible",
                "baseUrl": f"http://127.0.0.1:9/{marker}/{auth['type']}",
                "auth": auth,
            }
            first = post("save_connection", body)
            endpoint_id = first["endpoint"]["id"]
            created.add(endpoint_id)
            if first["credentialsCreated"] != 1:
                raise AssertionError("first save must create one credential")
            repeat = post("save_connection", body)
            created.add(repeat["endpoint"]["id"])
            if repeat["endpoint"]["id"] != endpoint_id:
                raise AssertionError("save_connection did NOT dedup endpoint")
            if repeat["credentialsCreated"] != 0 or repeat["credentialsExisting"] != 1:
                raise AssertionError("save_connection did NOT dedup credential")
            rows = post("list_provider_endpoints", {})
            matching = [row for row in rows if row["baseUrl"] == body["baseUrl"]]
            created.update(row["id"] for row in matching)
            if len(matching) != 1:
                raise AssertionError(f"endpoint appeared {len(matching)} times")
            fetched = post("get_provider_endpoint", {"id": endpoint_id})
            if fetched["name"] != body["name"] or fetched["baseUrl"] != body["baseUrl"]:
                raise AssertionError("saved endpoint did not round-trip")
            credentials = post("list_credentials", {"providerEndpointId": endpoint_id})
            if len(credentials) != 1 or credentials[0]["authType"] != auth["type"]:
                raise AssertionError("saved authorization did not round-trip")
            if "synthetic-e2e-key" in json.dumps(credentials):
                raise AssertionError("credential listing leaked secret")
    finally:
        for endpoint_id in created:
            post("delete_provider_endpoint", {"id": endpoint_id})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--python", default=sys.executable)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="stitch-e2e-") as directory:
        state = Path(directory)
        database = state / "smoke.db"
        env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{database.as_posix()}",
               "PYTHONPATH": str(args.backend_root.resolve() / "python"),
               "LOCALAPPDATA": str(state / "local"), "APPDATA": str(state / "roaming"),
               "XDG_DATA_HOME": str(state / "data"), "XDG_CACHE_HOME": str(state / "cache"),
               "STITCH_PLUGINS_DIR": str(state / "plugins"), "STITCH_AUTH_ENABLED": "0",
               "STITCH_DESKTOP_MODE": "1", "PYTHONUTF8": "1"}
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        base = f"http://127.0.0.1:{port}"

        def post(name, body):
            request = urllib.request.Request(f"{base}/api/{name}",
                data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.load(response)

        with (state / "backend.log").open("w+", encoding="utf-8") as log:
            process = subprocess.Popen([args.python, "-m", "uvicorn", "stitch_backend.main:app",
                "--host", "127.0.0.1", "--port", str(port), "--timeout-graceful-shutdown", "2"],
                cwd=args.backend_root.resolve() / "python", env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 60
                while True:
                    if process.poll() is not None:
                        raise RuntimeError("isolated backend exited during startup")
                    try:
                        with urllib.request.urlopen(f"{base}/health", timeout=2):
                            break
                    except (urllib.error.URLError, TimeoutError):
                        if time.monotonic() >= deadline:
                            raise RuntimeError("isolated backend readiness timeout") from None
                        time.sleep(0.2)
                if Path(post("get_database_path", {})).resolve() != database.resolve():
                    raise RuntimeError("backend database identity mismatch; refusing writes")
                run_smoke(post)
                print("[OK] Real HTTP: save_connection, endpoint/key dedup, round-trip, cleanup")
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read(), file=sys.stderr)
                raise
            finally:
                if os.name == "nt" and process.poll() is None:
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        check=True, capture_output=True)
                elif process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()
