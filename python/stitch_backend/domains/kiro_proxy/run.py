"""Kiro Proxy — standalone entry point.

Run the reverse proxy server:

    python -m stitch_backend.domains.kiro_proxy.run

Or via the installed script:

    kiro-proxy

The proxy port is read from ~/.stitch-manager/kiro-patch-config.json
(default: 5580 if not configured).
"""

from __future__ import annotations

import logging
import sys

import uvicorn

from stitch_backend.domains.kiro_proxy.server import app

logger = logging.getLogger(__name__)


def _configure_logging() -> None:
    """Configure logging for the proxy server."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
        datefmt="%H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )


def _get_proxy_port() -> int:
    """Read proxy port from config file."""
    try:
        from stitch_backend.domains.kiro_patch.service import get_config
        config = get_config()
        return config.get("proxyPort", 5580)
    except Exception:
        return 5580


def _ensure_socksio() -> None:
    """Auto-install socksio if SOCKS5 proxy is configured but package is missing."""
    try:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        outbound = _get_outbound_proxy()
        if outbound and outbound.startswith(("socks5://", "socks5h://")):
            try:
                import socksio  # noqa: F401
            except ImportError:
                import subprocess
                import sys
                logger.info("Auto-installing socksio for SOCKS5 support...")
                subprocess.check_call(
                    [sys.executable, "-m", "pip", "install", "socksio>=1.0.0", "-q"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                logger.info("socksio installed")
    except Exception as exc:
        logger.warning("Could not check/install socksio: %s", exc)


def main() -> None:
    """Entry point for the Kiro proxy server."""
    _configure_logging()
    _ensure_socksio()

    port = _get_proxy_port()

    logger.info("Kiro Proxy starting on port %d", port)
    logger.info("Forwarding requests to upstream based on X-Forwarded-* headers")

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
        access_log=True,
    )


if __name__ == "__main__":
    main()
