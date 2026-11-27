"""pywebview + uvicorn launcher for Stitch Manager v2.

Usage::

    # Production (serves static build from dist/)
    python run_gui.py

    # Development with an already-running reloadable backend
    python run_gui.py --dev --external-backend

By default this launcher starts the backend on port 25584.  In dev mode the
webview loads the Vite dev-server URL.  ``--external-backend`` makes the
launcher use an existing backend instead, which is used by the dev workspace
launcher (dev.ps1).
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import sys
import threading
import time
from typing import Any, NoReturn

# Make sure the python/ directory is on sys.path so stitch_backend is importable.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# RU-Windows consoles are cp1251: printing '→' or '⚠' would crash the launcher.
if sys.stdout is not None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr is not None:
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Windowed (frozen) builds have no console — mirror all output to a log file,
# otherwise launcher/uvicorn errors vanish and the app dies silently.
if getattr(sys, "frozen", False) and sys.platform == "win32":
    _log_dir = os.path.join(
        os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "stitch-manager"
    )
    os.makedirs(_log_dir, exist_ok=True)
    _log_file = open(  # noqa: SIM115 (process-lifetime handle)
        os.path.join(_log_dir, "launcher.log"), "a", encoding="utf-8", buffering=1
    )
    sys.stdout = _log_file
    sys.stderr = _log_file

import requests  # noqa: E402 (available after sys.path fix)
import uvicorn  # noqa: E402

# ── Constants ──────────────────────────────────────────────────────────────────

API_PORT = int(os.environ.get("STITCH_API_PORT", "25584"))
VITE_DEV_PORT = int(os.environ.get("STITCH_WEB_PORT", "5174"))
HEALTH_URL = f"http://127.0.0.1:{API_PORT}/health"
# The clock starts when this Python process reaches _wait_for_server, so it
# covers uvicorn startup + DB init + provider discovery. Measured at ~4-5s on
# a warm developer machine against a large production stitch.db — but sqlite
# lock contention with a second live instance, first-run DB creation, or AV
# scanning of the fresh onefile extraction can multiply that. 20s was too
# tight; a startup timeout kills the app silently (window never opens).
# 60s default, overridable.
HEALTH_TIMEOUT = float(os.environ.get("STITCH_HEALTH_TIMEOUT", "60"))
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
                        print(f"[run_gui] Killing PID {pid} that holds port {port}", flush=True)
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
                    print(f"[run_gui] Killing PID {pid} that holds port {port}", flush=True)
                    os.kill(pid, signal.SIGTERM)
        except Exception:
            pass


def _port_in_use(port: int) -> bool:
    """Check if a TCP port is already bound."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def _probe_port_owner() -> str:
    """Classify whatever occupies API_PORT by probing it over HTTP.

    Returns one of:
      - ``"stitch"``       — a healthy Stitch backend answers /health
      - ``"foreign"``      — something answers HTTP but is not Stitch-shaped
      - ``"unresponsive"`` — port is bound but no valid HTTP reply comes back
        (the classic zombie instance: process alive, event loop wedged)
    """
    try:
        resp = requests.get(HEALTH_URL, timeout=3)
    except requests.RequestException:
        return "unresponsive"
    if resp.status_code != 200:
        return "foreign"
    try:
        payload = resp.json()
    except ValueError:
        return "foreign"
    if isinstance(payload, dict) and payload.get("status") == "ok":
        return "stitch"
    return "foreign"


def _resolve_port_conflict(port: int, probe=_probe_port_owner) -> str:
    """Decide how to handle an occupied API port.

    Returns ``"attach"`` (reuse the healthy instance), ``"kill"`` (zombie —
    safe to terminate) or ``"abort"`` (foreign service — never kill other
    people's processes).

    Rationale: the previous design killed whatever held the port
    unconditionally.  On machines where a dev backend and the release app
    coexist, each side murdered the other in a loop (the dev workspace
    launcher force-frees the port too).  Additionally, a healthy Stitch
    backend on the port almost always means the app is already running —
    attaching is the correct single-instance behaviour and is non-destructive
    even when the classification is wrong.
    """
    owner = probe()
    if owner == "stitch":
        return "attach"
    if owner == "foreign":
        return "abort"
    return "kill"


def _icon_path() -> str | None:
    """Locate the app icon in a PyInstaller bundle or the dev repo tree."""
    candidates = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(os.path.join(meipass, "resources", "icons", "app-icon.ico"))
    candidates.append(
        os.path.join(os.path.dirname(_HERE), "resources", "icons", "app-icon.ico")
    )
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _instance_lock_refusal_message(
    database_url: str | None = None, *, ignore_own_pid: bool = False
) -> str | None:
    """Actionable single-instance refusal text when the DB lock is held.

    Uvicorn reports lifespan startup exceptions only in its own log and then
    exits the server thread, so the GUI launcher cannot rely on catching
    ``InstanceLockHeldError`` directly.  The lock file payload is intentionally
    readable; probing the byte range first avoids mistaking stale payload bytes
    (the file is never deleted) for a live holder.
    """
    try:
        if database_url is None:
            from stitch_backend.config import get_settings  # noqa: PLC0415

            database_url = get_settings().database_url
        from stitch_backend.instance_lock import probe_instance_lock  # noqa: PLC0415

        refusal = probe_instance_lock(database_url)
    except Exception:  # noqa: BLE001 — startup diagnostics must never be fatal
        logging.getLogger(__name__).debug("instance-lock probe unavailable", exc_info=True)
        return None
    if refusal is None:
        return None
    if (
        ignore_own_pid
        and refusal.holder is not None
        and refusal.holder.pid == os.getpid()
    ):
        # During a slow embedded startup the launcher's own uvicorn thread is
        # the lock holder.  That is not a multi-instance refusal; reporting it
        # as one would send the user hunting for a nonexistent other app.
        return None
    return str(refusal)


def _show_error_messagebox(message: str) -> None:
    """Best-effort fatal-error dialog for windowed builds (which have no console)."""
    if sys.platform == "win32":
        try:
            import ctypes  # noqa: PLC0415

            ctypes.windll.user32.MessageBoxW(
                0,
                message,
                "Stitch Account Manager",
                0x10,  # MB_ICONERROR
            )
            return
        except Exception:  # noqa: BLE001 — fall through to tkinter/print-only
            pass
    try:
        import tkinter  # noqa: PLC0415
        from tkinter import messagebox  # noqa: PLC0415

        root = None
        try:
            root = tkinter.Tk()
            root.withdraw()
            messagebox.showerror("Stitch Account Manager", message)
        finally:
            if root is not None:
                root.destroy()
    except Exception:  # noqa: BLE001 — console output above is the fallback
        pass


def _surface_fatal_error(message: str) -> None:
    """Surface a startup-fatal error both as text and as a GUI dialog."""
    print(f"ERROR: {message}", file=sys.stderr, flush=True)
    _show_error_messagebox(message)


def _exit_backend_startup_failed(fallback_message: str | None = None) -> NoReturn:
    """Exit after backend startup failure, preferring lock-refusal specifics."""
    refusal = _instance_lock_refusal_message(ignore_own_pid=True) or fallback_message
    if refusal is not None:
        _surface_fatal_error(refusal)
    else:
        _surface_fatal_error("Backend did not start in time. Aborting.")
    raise SystemExit(1)


def _start_uvicorn() -> None:
    """Run uvicorn in the current thread (blocks)."""
    uvicorn.run(
        "stitch_backend.main:app",
        host="127.0.0.1",
        port=API_PORT,
        log_level="info",
    )


def _wait_for_server(
    timeout: float = HEALTH_TIMEOUT,
    server_thread: threading.Thread | None = None,
) -> bool:
    """Block until /health responds, the timeout expires, or our backend dies."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if server_thread is not None and not server_thread.is_alive():
            return False
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
            # Try to restart.  Known limitation: the replacement uvicorn runs
            # in this same process, so if the wedged lifespan never released
            # the DB instance lock, the new lifespan may refuse and point at
            # our own pid.  That case was already unrecoverable here because
            # the wedged server still owns the API port, so a port rebind was
            # doomed too — restarting the app is the correct user action.
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

class _DesktopApi:
    """Bridge exposed to the webview as window.pywebview.api.

    Must stay attribute-free except methods: pywebview recursively walks every
    non-callable attribute of the js_api object to build the JS surface.
    """

    def pick_folder(self) -> str | None:
        import webview  # noqa: PLC0415 (optional dependency)

        if _DESKTOP_WINDOW is None:
            return None
        result = _DESKTOP_WINDOW.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        return str(result[0])


_DESKTOP_WINDOW: Any = None


def main() -> None:
    global _DESKTOP_WINDOW
    # Mark this backend as desktop: a guest session on the local machine is
    # the owner (admin caller context).  Never set on the VDS.
    os.environ.setdefault("STITCH_DESKTOP_MODE", "1")

    parser = argparse.ArgumentParser(description="Stitch Manager v2 GUI launcher")
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Development mode: webview connects to Vite dev server (port 5174)",
    )
    parser.add_argument(
        "--external-backend",
        action="store_true",
        help="Use an already-running backend instead of starting an embedded one",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Kill any existing process on the API port before starting",
    )
    args = parser.parse_args()

    if args.external_backend and args.force:
        parser.error("--force cannot be used with --external-backend")

    server_thread: threading.Thread | None = None
    initial_lock_refusal: str | None = None

    if args.external_backend:
        print(f"[run_gui] Using external backend at {HEALTH_URL}", flush=True)
    else:
        # Single-instance desktop app.  A busy port can mean three very
        # different things — a live Stitch instance (attach to it), a zombie
        # Stitch instance (kill it), or somebody else's service (leave it
        # alone).  Blindly killing the owner made coexisting dev/release
        # instances murder each other in a loop.
        attach_existing = False
        if _port_in_use(API_PORT):
            decision = _resolve_port_conflict(API_PORT)
            if decision == "attach":
                print(
                    f"[run_gui] Port {API_PORT} already serves a healthy Stitch "
                    "backend — attaching to it instead of starting a second instance",
                    flush=True,
                )
                attach_existing = True
            elif decision == "abort":
                print(
                    f"ERROR: Port {API_PORT} is held by a service that is not a "
                    "Stitch backend. Refusing to kill a foreign process.\n"
                    "       Free the port yourself or point Stitch elsewhere:  "
                    "set STITCH_API_PORT=<port>",
                    file=sys.stderr,
                    flush=True,
                )
                sys.exit(2)
            else:
                print(
                    f"[run_gui] Port {API_PORT} is occupied by an unresponsive "
                    "(zombie) instance — killing it",
                    flush=True,
                )
                _kill_port_hog(API_PORT)
                time.sleep(1)

        if not attach_existing:
            # A backend on another port may already own this database.  The
            # port-conflict logic above cannot see that case.  Capture the
            # actionable holder details before starting; the lock can be gone
            # again by the time uvicorn gives up, but the backend will still
            # have died from the original refusal.  Do not fail fast here: a
            # just-killed zombie may release its kernel lock a moment later,
            # in which case the embedded backend can legitimately take over.
            initial_lock_refusal = _instance_lock_refusal_message()
            server_thread = threading.Thread(target=_start_uvicorn, daemon=True)
            server_thread.start()

    # 2. Decide what URL the webview will load
    if args.dev:
        target_url = f"http://localhost:{VITE_DEV_PORT}"
        print(f"[DEV]  Webview → {target_url}   |   API → http://127.0.0.1:{API_PORT}", flush=True)
    else:
        target_url = f"http://127.0.0.1:{API_PORT}"
        print(f"[PROD] Webview + API → {target_url}", flush=True)

    # 3. Wait for the backend to be ready
    if not _wait_for_server(server_thread=server_thread):
        _exit_backend_startup_failed(initial_lock_refusal)

    # 4. Launch pywebview
    try:
        import webview  # noqa: PLC0415 (optional dependency)
    except ImportError:
        print(
            "ERROR: pywebview is not installed.\n"
            "       pip install pywebview   (or run without GUI for API-only mode)",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)

    # Disable unnecessary features to speed up startup
    webview.settings['REMOTE_DEBUGGING_PORT'] = None
    webview.settings['OPEN_DEVTOOLS_IN_DEBUG'] = False

    # pywebview logs lifecycle INFO to stderr by default; split like the backend.
    pv_stdout = logging.StreamHandler(sys.stdout)
    pv_stdout.setLevel(logging.DEBUG)
    pv_stdout.addFilter(lambda record: record.levelno < logging.WARNING)
    pv_stderr = logging.StreamHandler(sys.stderr)
    pv_stderr.setLevel(logging.WARNING)
    pv_logger = logging.getLogger("pywebview")
    pv_logger.handlers.clear()
    pv_logger.addHandler(pv_stdout)
    pv_logger.addHandler(pv_stderr)
    pv_logger.propagate = False

    # Get icon path early for Win32 API calls
    icon = _icon_path()

    api = _DesktopApi()
    window = webview.create_window(
        "Stitch Account Manager",
        target_url,
        width=1280,
        height=800,
        min_size=(1024, 768),
        background_color="#1a1a2e",  # Match app theme for instant visual feedback
        text_select=True,
        js_api=api,
    )
    _DESKTOP_WINDOW = window

    # Windows: set taskbar icon via Win32 API
    if sys.platform == "win32" and icon:
        def _on_loaded():
            try:
                import ctypes
                user32 = ctypes.windll.user32
                hwnd = user32.FindWindowW(None, "Stitch Account Manager")
                if hwnd:
                    LR_LOADFROMFILE = 0x00000010  # noqa: N806 — Win32 API constant
                    WM_SETICON = 0x0080  # noqa: N806 — Win32 API constant
                    hicon = user32.LoadImageW(None, icon, 1, 32, 32, LR_LOADFROMFILE)
                    if hicon:
                        user32.SendMessageW(hwnd, WM_SETICON, 0, hicon)  # ICON_SMALL
                        user32.SendMessageW(hwnd, WM_SETICON, 1, hicon)  # ICON_BIG
            except Exception:
                pass

        window.events.loaded += _on_loaded

    # Monitor only a backend owned by this process. The canonical dev launcher
    # supervises its external reloadable backend separately.
    if server_thread is not None:
        watchdog_thread = threading.Thread(
            target=_backend_watchdog,
            args=(server_thread, window),
            daemon=True,
        )
        watchdog_thread.start()

    # Use EdgeChromium on Windows for faster startup (4-6s vs 20-30s with CEF)
    # private_mode=False: persist cookies/localStorage across restarts,
    # otherwise the TG session cookie dies with the process and the app asks
    # to log in on every launch.
    start_kwargs: dict = {"debug": args.dev, "private_mode": False}
    if sys.platform == "win32":
        # Try EdgeChromium first (uses system WebView2, much faster)
        try:
            import clr  # noqa: F401 — pythonnet availability test (import itself is the check)
            start_kwargs["gui"] = "edgechromium"
            # WebView2 defaults to a temp user-data dir that Windows may clear
            storage_dir = os.path.join(
                os.environ.get(
                    "LOCALAPPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Local")
                ),
                "stitch-manager",
                "webview",
            )
            os.makedirs(storage_dir, exist_ok=True)
            start_kwargs["storage_path"] = storage_dir
            print("[run_gui] Using EdgeChromium (WebView2) for fast startup", flush=True)
        except ImportError:
            print("[run_gui] WARNING: pythonnet not installed, falling back to CEF (slow)", flush=True)
            print("[run_gui] Install with: pip install pythonnet", flush=True)

    if icon:
        start_kwargs["icon"] = icon  # taskbar/window icon on Windows

    print(f"[run_gui] Starting webview with: {start_kwargs}", flush=True)

    # Add timing to understand where the delay is
    start_time = time.time()
    has_loaded = False

    def on_loaded():
        nonlocal has_loaded
        if has_loaded:
            return
        has_loaded = True
        elapsed = time.time() - start_time
        print(f"[run_gui] Window loaded in {elapsed:.2f}s", flush=True)

    window.events.loaded += on_loaded

    try:
        webview.start(**start_kwargs)
    except Exception as e:
        print(f"[run_gui] ERROR: webview.start() failed: {e}", flush=True)
        print("[run_gui] Falling back to default GUI...", flush=True)
        webview.start(debug=args.dev, private_mode=False)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        # Normal Ctrl+C — pywebview/pythonnet may raise this on exit.
        # Suppress the traceback; the process exits cleanly.
        pass
