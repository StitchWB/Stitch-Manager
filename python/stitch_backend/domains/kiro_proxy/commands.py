"""Kiro Proxy command handlers."""

from __future__ import annotations

import logging
import subprocess
import sys

from stitch_backend.core.command_registry import register_command

logger = logging.getLogger(__name__)


def _ensure_socksio() -> bool:
    """Ensure socksio is installed for SOCKS5 proxy support.
    
    Auto-installs if missing.
    
    Returns:
        True if socksio is available, False otherwise.
    """
    try:
        import socksio  # noqa: F401
        return True
    except ImportError:
        logger.info("socksio not found — installing for SOCKS5 proxy support...")
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "socksio>=1.0.0", "-q"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            logger.info("socksio installed successfully")
            return True
        except subprocess.CalledProcessError as exc:
            logger.error("Failed to install socksio: %s", exc)
            return False


def _get_proxy_port() -> int:
    """Read proxy port from config file."""
    try:
        from stitch_backend.domains.kiro_patch.service import get_config
        config = get_config()
        return config.get("proxyPort", 5580)
    except Exception:
        return 5580


@register_command("start_kiro_proxy")
async def cmd_start_kiro_proxy(params: dict) -> dict:
    """Start the Kiro proxy server.
    
    This is a reverse proxy that intercepts Kiro IDE traffic (injected via
    extension.js patch) and forwards it to the original upstream servers.
    
    Port is read from ~/.stitch-manager/kiro-patch-config.json (default: 5580).
    
    Returns:
        Status dict with port and running state.
    """
    import asyncio
    import threading
    
    port = _get_proxy_port()
    
    # Check if outbound proxy is SOCKS5 — ensure socksio is installed
    from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
    outbound = _get_outbound_proxy()
    if outbound and outbound.startswith(("socks5://", "socks5h://")):
        if not _ensure_socksio():
            return {
                "success": False,
                "port": port,
                "running": False,
                "message": "Failed to install socksio — SOCKS5 proxy not supported. Install manually: pip install socksio",
            }
    
    from stitch_backend.domains.kiro_proxy.run import main as run_proxy
    
    # Run proxy in a separate thread so it doesn't block the main backend
    def _run_in_thread():
        try:
            run_proxy()
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error("Kiro proxy failed: %s", exc)
    
    thread = threading.Thread(target=_run_in_thread, daemon=True, name="kiro-proxy")
    thread.start()
    
    # Give it a moment to start
    await asyncio.sleep(0.5)
    
    return {
        "success": True,
        "port": port,
        "running": thread.is_alive(),
        "message": f"Kiro proxy started on port {port}",
    }


@register_command("stop_kiro_proxy")
async def cmd_stop_kiro_proxy(params: dict) -> dict:
    """Stop the Kiro proxy server.
    
    Note: Currently not implemented — the proxy runs as a daemon thread
    and stops when the main backend stops.
    
    Returns:
        Status dict.
    """
    return {
        "success": False,
        "message": "Stop not implemented — proxy stops with main backend",
    }


@register_command("kiro_proxy_status")
@register_command("get_proxy_status")
async def cmd_kiro_proxy_status(params: dict) -> dict:
    """Check if the Kiro proxy server is running.
    
    Returns:
        Status dict with running state and port.
    """
    import threading
    
    port = _get_proxy_port()
    
    # Check if our thread is alive
    proxy_thread = None
    for thread in threading.enumerate():
        if thread.name == "kiro-proxy":
            proxy_thread = thread
            break
    
    return {
        "running": proxy_thread is not None and proxy_thread.is_alive(),
        "port": port,
    }
