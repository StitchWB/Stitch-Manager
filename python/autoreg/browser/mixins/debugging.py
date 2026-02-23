"""
Debugging mixin for browser automation.

Provides methods for debugging, screenshots, and error analysis.
"""

import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from DrissionPage import ChromiumPage

logger = logging.getLogger(__name__)


class DebuggingMixin:
    """Mixin providing debugging capabilities for browser automation."""

    def __init__(self):
        """Initialize debugging state."""
        self._screenshots_on_error = True
        self._debug_mode = False

    def screenshot(
        self, page: "ChromiumPage", name: str, output_dir: Path
    ) -> Optional[Path]:
        """
        Save screenshot for debugging.

        Args:
            page: ChromiumPage instance
            name: Screenshot name (without extension)
            output_dir: Directory to save screenshot

        Returns:
            Path to saved screenshot or None if failed
        """
        if not self._screenshots_on_error:
            return None

        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            filename = output_dir / f"{name}_{int(time.time())}.png"

            page.get_screenshot(path=str(filename))
            logger.info(f"Screenshot saved: {filename}")

            return filename

        except Exception as e:
            logger.error(f"Screenshot failed: {e}")
            return None

    def save_debug_screenshot(
        self, page: "ChromiumPage", error_context: str, output_dir: Path
    ) -> Optional[Path]:
        """
        Save screenshot with error context.

        Args:
            page: ChromiumPage instance
            error_context: Description of error
            output_dir: Directory to save screenshot

        Returns:
            Path to saved screenshot or None if failed
        """
        safe_name = error_context.replace(" ", "_").replace("/", "_")[:50]
        return self.screenshot(page, f"error_{safe_name}", output_dir)

    def pause_for_debug(self, message: str = "Paused for debugging") -> None:
        """
        Pause execution for manual debugging.

        Args:
            message: Message to display
        """
        if self._debug_mode:
            print(f"\n⏸️  {message}")
            print("   Press Enter to continue...")
            input()

    def _debug_inputs(self, page: "ChromiumPage") -> None:
        """
        Print debug information about input elements on page.

        Args:
            page: ChromiumPage instance
        """
        logger.debug("Searching for input elements...")

        try:
            inputs = page.eles("tag:input")

            if not inputs:
                logger.debug("No input elements found")
                return

            for i, inp in enumerate(inputs[:5]):
                try:
                    input_type = inp.attr("type") or "text"
                    placeholder = inp.attr("placeholder") or "none"
                    name = inp.attr("name") or "none"
                    data_testid = inp.attr("data-testid") or "none"

                    logger.debug(
                        f"Input {i}: type={input_type}, placeholder={placeholder}, "
                        f"name={name}, data-testid={data_testid}"
                    )
                except Exception as e:
                    logger.debug(f"Input {i}: Error reading attributes - {e}")

        except RuntimeError as e:
            logger.error(f"Failed to debug inputs: {e}")

    def enable_screenshots(self, enabled: bool = True) -> None:
        """
        Enable or disable automatic screenshots on errors.

        Args:
            enabled: Whether to enable screenshots
        """
        self._screenshots_on_error = enabled
        logger.info(f"Screenshots on error: {'enabled' if enabled else 'disabled'}")

    def enable_debug_mode(self, enabled: bool = True) -> None:
        """
        Enable or disable debug mode (pauses, verbose logging).

        Args:
            enabled: Whether to enable debug mode
        """
        self._debug_mode = enabled
        logger.info(f"Debug mode: {'enabled' if enabled else 'disabled'}")

    def get_page_info(self, page: "ChromiumPage") -> dict:
        """
        Get current page information for debugging.

        Args:
            page: ChromiumPage instance

        Returns:
            Dict with page info (url, title, body text)
        """
        info = {
            "url": "",
            "title": "",
            "body_text": "",
            "error": None,
        }

        try:
            info["url"] = page.url or ""
        except Exception as e:
            info["error"] = f"Failed to get URL: {e}"

        try:
            info["title"] = page.title or ""
        except Exception as e:
            if not info["error"]:
                info["error"] = f"Failed to get title: {e}"

        try:
            body = page.ele("tag:body")
            if body:
                info["body_text"] = (body.text or "")[:200]
        except Exception as e:
            if not info["error"]:
                info["error"] = f"Failed to get body text: {e}"

        return info

    def log_page_state(self, page: "ChromiumPage", context: str = "") -> None:
        """
        Log current page state for debugging.

        Args:
            page: ChromiumPage instance
            context: Context description
        """
        info = self.get_page_info(page)

        prefix = f"[{context}] " if context else ""
        logger.debug(f"{prefix}Page state:")
        logger.debug(f"  URL: {info['url'][:80]}")
        logger.debug(f"  Title: {info['title'][:80]}")

        if info["body_text"]:
            logger.debug(f"  Body: {info['body_text'][:100]}")

        if info["error"]:
            logger.warning(f"  Error: {info['error']}")
