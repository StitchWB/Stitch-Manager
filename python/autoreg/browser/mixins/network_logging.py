"""
Network logging mixin for browser automation.

Provides methods to capture and analyze network traffic.
"""

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from DrissionPage import ChromiumPage

logger = logging.getLogger(__name__)


class NetworkLoggingMixin:
    """Mixin providing network traffic logging for browser automation."""

    def __init__(self):
        """Initialize network logging state."""
        self._network_logs: list[dict[str, Any]] = []
        self._network_logging_enabled = False

    def enable_network_logging(self, page: "ChromiumPage") -> bool:
        """
        Enable network request/response logging via CDP.

        Args:
            page: ChromiumPage instance

        Returns:
            True if logging enabled successfully
        """
        try:
            # Enable Network domain
            page.run_cdp("Network.enable")
            self._network_logging_enabled = True
            logger.info("Network logging enabled")
            return True

        except RuntimeError as e:
            logger.error(f"Failed to enable network logging: {e}")
            return False

    def disable_network_logging(self, page: "ChromiumPage") -> bool:
        """
        Disable network logging.

        Args:
            page: ChromiumPage instance

        Returns:
            True if logging disabled successfully
        """
        try:
            page.run_cdp("Network.disable")
            self._network_logging_enabled = False
            logger.info("Network logging disabled")
            return True

        except RuntimeError as e:
            logger.error(f"Failed to disable network logging: {e}")
            return False

    def get_network_logs(self) -> list[dict[str, Any]]:
        """
        Get captured network logs.

        Returns:
            List of network log entries
        """
        return self._network_logs.copy()

    def save_network_logs(
        self, output_dir: Path, filename: str = "network_logs.json"
    ) -> Optional[Path]:
        """
        Save network logs to JSON file.

        Args:
            output_dir: Directory to save logs
            filename: Output filename

        Returns:
            Path to saved file or None if failed
        """
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            filepath = output_dir / filename

            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(self._network_logs, f, indent=2, ensure_ascii=False)

            logger.info(f"Network logs saved: {filepath}")
            return filepath

        except Exception as e:
            logger.error(f"Failed to save network logs: {e}")
            return None

    def clear_network_logs(self) -> None:
        """Clear captured network logs."""
        self._network_logs.clear()
        logger.debug("Network logs cleared")

    def _capture_performance_logs(self, page: "ChromiumPage") -> list[dict[str, Any]]:
        """
        Capture network logs via Performance API.

        Args:
            page: ChromiumPage instance

        Returns:
            List of performance entries
        """
        try:
            perf_logs = page.run_js("""
                return performance.getEntriesByType('resource')
                    .filter(e => e.name.includes('api/') || e.name.includes('send-otp'))
                    .map(e => ({
                        url: e.name,
                        duration: e.duration,
                        startTime: e.startTime,
                        transferSize: e.transferSize,
                        type: e.initiatorType
                    }));
            """)

            if perf_logs:
                self._network_logs.extend(perf_logs)
                logger.debug(f"Captured {len(perf_logs)} performance entries")
                return perf_logs

        except RuntimeError as e:
            logger.warning(f"Failed to capture performance logs: {e}")

        return []

    def filter_logs_by_url(self, pattern: str) -> list[dict[str, Any]]:
        """
        Filter network logs by URL pattern.

        Args:
            pattern: URL pattern to match

        Returns:
            Filtered log entries
        """
        return [log for log in self._network_logs if pattern in log.get("url", "")]

    def get_api_requests(self) -> list[dict[str, Any]]:
        """
        Get all API request logs.

        Returns:
            List of API request entries
        """
        return [
            log
            for log in self._network_logs
            if log.get("type") == "request" and "api/" in log.get("url", "")
        ]

    def get_api_responses(self) -> list[dict[str, Any]]:
        """
        Get all API response logs.

        Returns:
            List of API response entries
        """
        return [
            log
            for log in self._network_logs
            if log.get("type") == "response" and "api/" in log.get("url", "")
        ]
