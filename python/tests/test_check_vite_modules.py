"""Sabotage tests for scripts/check-vite-modules.mjs.

Each test stands up a tiny HTTP server that mimics Vite's dev transform
endpoint, then runs the gate against it.  The server deliberately serves
some modules with empty bodies, missing exports, or non-JS content types
to prove the gate catches the failure class.
"""
from __future__ import annotations

import http.server
import json
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

NODE = "node"
GATE = Path(__file__).resolve().parents[2] / "scripts" / "check-vite-modules.mjs"


class _FixtureServer:
    """Tiny loopback HTTP server that serves a fixed body map.

    ``routes`` maps URL path -> dict with keys ``status``, ``content_type``,
    ``body`` (str/bytes).  Defaults to 404 for any path not in the map.
    """

    def __init__(self, routes: dict[str, dict]):
        self.routes = routes
        self.requests: list[str] = []

        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args, **_kwargs):  # silence stderr
                pass

            def do_GET(self):  # noqa: N802
                outer.requests.append(self.path.split("?", 1)[0])
                if self.path.startswith("/__status__"):
                    payload = json.dumps({"hits": len(outer.requests)}).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                matched = outer.routes.get(self.path.split("?", 1)[0])
                if matched is None:
                    self.send_response(404)
                    self.send_header("Content-Type", "text/plain")
                    self.end_headers()
                    self.wfile.write(b"not found")
                    return
                body = matched["body"]
                if isinstance(body, str):
                    body = body.encode("utf-8")
                self.send_response(matched.get("status", 200))
                self.send_header("Content-Type", matched.get("content_type", "application/javascript"))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self._httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
        self._httpd.timeout = 0.2
        self.port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self):
        self._httpd.serve_forever()

    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()


@pytest.fixture
def workspace(tmp_path: Path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "Good.tsx").write_text(
        "export function good(): number { return 1; }\n",
        encoding="utf-8",
    )
    yield tmp_path


def _run_gate(base: str, src_root: Path, *, paths: list[str] | None = None) -> subprocess.CompletedProcess:
    args = [NODE, str(GATE), "--base", base, "--root", str(src_root), "--retries", "1"]
    if paths:
        args += ["--paths", ",".join(paths)]
    return subprocess.run(args, capture_output=True, text=True, timeout=30)


def _write_broken(workspace: Path, source: str) -> None:
    (workspace / "src" / "Broken.tsx").write_text(source, encoding="utf-8")


def test_passes_when_all_modules_valid(workspace: Path):
    server = _FixtureServer({
        "/src/Good.tsx": {"body": "export function good() { return 1; }\n"},
    })
    try:
        result = _run_gate(server.url(), workspace / "src")
        assert result.returncode == 0, result.stdout + result.stderr
        assert "/src/Broken.tsx" not in result.stderr
    finally:
        server.close()


def test_fails_on_empty_body(workspace: Path):
    _write_broken(workspace, "export function broken(): number { return 1; }\n")
    server = _FixtureServer({
        "/src/Good.tsx": {"body": "export function good() { return 1; }\n"},
        "/src/Broken.tsx": {"body": ""},
    })
    try:
        result = _run_gate(server.url(), workspace / "src")
        assert result.returncode == 1, result.stdout
        assert "/src/Broken.tsx" in result.stderr
        assert "body" in result.stderr.lower()
    finally:
        server.close()


def test_identifier_without_export_is_rejected(workspace: Path):
    _write_broken(workspace, "export function broken(): number { return 1; }\n")
    server = _FixtureServer({
        "/src/Good.tsx": {"body": "export function good() { return 1; }\n"},
        "/src/Broken.tsx": {"body": "function broken() { return 1; }\nexport const other = 1;\n"},
    })
    try:
        result = _run_gate(server.url(), workspace / "src")
        assert result.returncode == 1
        assert "missing exports: broken" in result.stderr
    finally:
        server.close()


def test_erased_type_exports_do_not_require_a_response(workspace: Path):
    (workspace / "src" / "Types.ts").write_text("interface T { x: number }; export type { T };", encoding="utf-8")
    server = _FixtureServer({"/src/Good.tsx": {"body": "export function good() { return 1; }\n"}})
    try:
        result = _run_gate(server.url(), workspace / "src")
        assert result.returncode == 0, result.stderr
        assert "/src/Types.ts" not in server.requests
    finally:
        server.close()


def test_fails_on_missing_named_export(workspace: Path):
    """Transform served a body that lacks the named export the source declares."""
    _write_broken(workspace, "export function broken(): number { return 1; }\n")
    server = _FixtureServer({
        "/src/Good.tsx": {"body": "export function good() { return 1; }\n"},
        "/src/Broken.tsx": {"body": "const x = 1;\nexport default x;\n"},
    })
    try:
        result = _run_gate(server.url(), workspace / "src")
        assert result.returncode == 1, result.stdout
        assert "/src/Broken.tsx" in result.stderr
        assert "broken" in result.stderr
    finally:
        server.close()


def test_fails_on_non_js_content_type(workspace: Path):
    _write_broken(workspace, "export function broken(): number { return 1; }\n")
    server = _FixtureServer({
        "/src/Good.tsx": {"body": "export function good() { return 1; }\n"},
        "/src/Broken.tsx": {
            "body": "export function broken() { return 1; }\n",
            "content_type": "text/html",
        },
    })
    try:
        result = _run_gate(server.url(), workspace / "src")
        assert result.returncode == 1
        assert "content-type" in result.stderr.lower()
    finally:
        server.close()


def test_fails_on_non_200_status(workspace: Path):
    _write_broken(workspace, "export function broken(): number { return 1; }\n")
    server = _FixtureServer({
        "/src/Good.tsx": {"body": "export function good() { return 1; }\n"},
        "/src/Broken.tsx": {"body": "export function broken() { return 1; }\n", "status": 500},
    })
    try:
        result = _run_gate(server.url(), workspace / "src")
        assert result.returncode == 1
        assert "500" in result.stderr
    finally:
        server.close()


def test_paths_filter_limits_targets(workspace: Path):
    """--paths should target only listed modules; the walker ignores everything else."""
    (workspace / "src" / "Other.tsx").write_text(
        "export function other(): number { return 1; }\n",
        encoding="utf-8",
    )
    server = _FixtureServer({
        "/src/Good.tsx": {"body": "export function good() { return 1; }\n"},
    })
    try:
        result = _run_gate(server.url(), workspace / "src", paths=["/src/Good.tsx"])
        assert result.returncode == 0, result.stderr
        assert "/src/Other.tsx" not in result.stderr
    finally:
        server.close()


def test_excluded_dirs_ignored(workspace: Path):
    nested = workspace / "src" / "node_modules" / "evil"
    nested.mkdir(parents=True)
    (nested / "Trap.tsx").write_text(
        "export function trap(): number { return 1; }\n",
        encoding="utf-8",
    )
    (workspace / "src" / "Good.tsx").write_text(
        "export function good(): number { return 1; }\n",
        encoding="utf-8",
    )
    server = _FixtureServer({
        "/src/Good.tsx": {"body": "export function good() { return 1; }\n"},
        "/src/node_modules/evil/Trap.tsx": {"body": ""},
    })
    try:
        result = _run_gate(server.url(), workspace / "src")
        assert result.returncode == 0
        assert "Trap.tsx" not in result.stderr
    finally:
        server.close()


def test_reproduces_add_provider_menu_crash(tmp_path: Path):
    """Replays the screenshot bug: Vite served an empty module body for a real file."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "AddProviderMenu.tsx").write_text(
        "export function AddProviderMenu(): JSX.Element { return null; }\n",
        encoding="utf-8",
    )
    (src / "Other.tsx").write_text(
        "export function Other(): JSX.Element { return null; }\n",
        encoding="utf-8",
    )
    server = _FixtureServer({
        "/src/AddProviderMenu.tsx": {"body": ""},
        "/src/Other.tsx": {"body": "export function Other() { return null; }\n"},
    })
    try:
        result = _run_gate(server.url(), src)
        assert result.returncode == 1, result.stdout
        assert "AddProviderMenu" in result.stderr
    finally:
        server.close()
