"""pywebview + uvicorn launcher for Stitch Manager v2.

Usage::

    # Production (serves static build from dist/)
    python run_gui.py

    # Development (pywebview points to Vite dev server on port 5174)
    python run_gui.py --dev

The backend always starts on port 25584.  In dev mode the webview loads
the Vite dev-server URL so hot-reload works; in prod mode it loads the
backend itself which serves the Vite build output via StaticFiles.
"""

from __future__ import annotations

import argparse
import os
import signal
import socket
import sys
import threading
import time

# Make sure the python/ directory is on sys.path so stitch_backend is importable.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import requests  # noqa: E402 (available after sys.path fix)
import uvicorn  # noqa: E402

# ── Constants ──────────────────────────────────────────────────────────────────

API_PORT = 25584
VITE_DEV_PORT = 5174
HEALTH_URL = f"http://127.0.0.1:{API_PORT}/health"
HEALTH_TIMEOUT = 20  # seconds
WATCHDOG_INTERVAL = 5  # seconds between health checks


# ── Helpers ────────────────────────────────────────────────────────────────────

def _kill_port_hog(port: int) -> None:
    """Kill whatever process is holding *port* (Windows & Linux)."""
    if sys.platform == "win32":
        import subprocess as _sp
        try:
            out = _sp.check_output(
                ["netstat", "-ano"], text=True, stderr=_sp.DEVNULL,
            )
            for line in out.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    pid = int(line.strip().split()[-1])
                    if pid != os.getpid():
                        print(f"[run_gui] Killing PID {pid} that holds port {port}")
                        os.kill(pid, signal.SIGTERM)
        except Exception:
            pass
    else:
        import subprocess as _sp
        try:
            pids = _sp.check_output(
                ["lsof", "-ti", f":{port}"], text=True, stderr=_sp.DEVNULL,
            ).strip().split()
            for pid_str in pids:
                pid = int(pid_str)
                if pid != os.getpid():
                    print(f"[run_gui] Killing PID {pid} that holds port {port}")
                    os.kill(pid, signal.SIGTERM)
        except Exception:
            pass


def _port_in_use(port: int) -> bool:
    """Check if a TCP port is already bound."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def _start_uvicorn() -> None:
    """Run uvicorn in the current thread (blocks)."""
    uvicorn.run(
        "stitch_backend.main:app",
        host="127.0.0.1",
        port=API_PORT,
        log_level="info",
    )


def _wait_for_server(timeout: float = HEALTH_TIMEOUT) -> bool:
    """Block until the backend /health endpoint responds or timeout expires."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            resp = requests.get(HEALTH_URL, timeout=2)
            if resp.status_code == 200:
                return True
        except requests.ConnectionError:
            pass
        time.sleep(0.5)
    return False


def _backend_watchdog(
    server_thread: threading.Thread,
    window,
) -> None:
    """Monitor backend health.  If the uvicorn thread dies, notify the user."""
    consecutive_failures = 0
    while server_thread.is_alive():
        time.sleep(WATCHDOG_INTERVAL)
        if not server_thread.is_alive():
            break
        try:
            resp = requests.get(HEALTH_URL, timeout=3)
            if resp.status_code == 200:
                consecutive_failures = 0
                continue
        except Exception:
            pass
        consecutive_failures += 1
        if consecutive_failures >= 2:
            print(
                f"\n[WATCHDOG] Backend unresponsive ({consecutive_failures} checks).\n"
                f"           uvicorn thread alive={server_thread.is_alive()}\n"
                f"           Restarting backend...",
                file=sys.stderr,
                flush=True,
            )
            # Try to restart
            new_thread = threading.Thread(target=_start_uvicorn, daemon=True)
            new_thread.start()
            if _wait_for_server(timeout=15):
                print("[WATCHDOG] Backend restarted successfully.", flush=True)
                # Switch to monitoring the new thread
                server_thread = new_thread
                consecutive_failures = 0
            else:
                print(
                    "[WATCHDOG] Backend restart FAILED. "
                    "Please restart the application.",
                    file=sys.stderr,
                    flush=True,
                )
                # Inject JS notification into the webview
                try:
                    window.evaluate_js(
                        'document.title = "⚠ Backend offline — restart app";'
                    )
                except Exception:
                    pass
    # Thread died
    print(
        "\n[WATCHDOG] Backend thread died! "
        "The application may not work correctly.\n"
        "           Please restart the application.",
        file=sys.stderr,
        flush=True,
    )
    try:
        window.evaluate_js(
            'document.title = "⚠ Backend crashed — restart app";'
        )
    except Exception:
        pass


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Stitch Manager v2 GUI launcher")
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Development mode: webview connects to Vite dev server (port 5174)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Kill any existing process on the API port before starting",
    )
    args = parser.parse_args()

    # 0. Clear port if --force or port is occupied
    if _port_in_use(API_PORT):
        if args.force:
            print(f"[run_gui] Port {API_PORT} is occupied, killing old process (--force)")
            _kill_port_hog(API_PORT)
            time.sleep(1)
        else:
            print(
                f"WARNING: Port {API_PORT} is already in use.\n"
                f"         Use --force to kill the old process, or stop it manually.\n"
                f"         Trying to start anyway...",
                file=sys.stderr,
            )

    # 1. Start the FastAPI backend in a daemon thread
    server_thread = threading.Thread(target=_start_uvicorn, daemon=True)
    server_thread.start()

    # 2. Decide what URL the webview will load
    if args.dev:
        target_url = f"http://localhost:{VITE_DEV_PORT}"
        print(f"[DEV]  Webview → {target_url}   |   API → http://127.0.0.1:{API_PORT}")
    else:
        target_url = f"http://127.0.0.1:{API_PORT}"
        print(f"[PROD] Webview + API → {target_url}")

    # 3. Wait for the backend to be ready
    if not _wait_for_server():
        print("ERROR: Backend did not start in time. Aborting.", file=sys.stderr)
        sys.exit(1)

    # 4. Launch pywebview
    try:
        import webview  # noqa: PLC0415 (optional dependency)
    except ImportError:
        print(
            "ERROR: pywebview is not installed.\n"
            "       pip install pywebview   (or run without GUI for API-only mode)",
            file=sys.stderr,
        )
        sys.exit(1)

    window = webview.create_window(
        "Stitch Account Manager",
        target_url,
        width=1280,
        height=800,
        min_size=(1024, 768),
        background_color="#000000",
    )

    # 5. Start backend watchdog in a daemon thread
    watchdog_thread = threading.Thread(
        target=_backend_watchdog,
        args=(server_thread, window),
        daemon=True,
    )
    watchdog_thread.start()

    webview.start(debug=args.dev)


if __name__ == "__main__":
    main()
