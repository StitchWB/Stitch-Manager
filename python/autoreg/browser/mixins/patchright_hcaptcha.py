"""hCaptcha mixin for PatchrightEngine."""
from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)


class PatchrightHCaptchaMixin:
    """Handles hCaptcha checkbox interaction using Patchright."""

    def _click_hcaptcha_checkbox(self, page: Any) -> bool:
        """Find and click hCaptcha checkbox via recursive iframe search."""
        logger.info("[hCaptcha] Searching for checkbox...")

        def find_and_click_in_frame(frame, depth=0):
            if depth > 10:
                return False

            # Try checkbox in current frame
            try:
                cb = frame.query_selector('#checkbox')
                if cb:
                    cb.click()
                    logger.info(f"[hCaptcha] Clicked checkbox at depth {depth}")
                    return True
            except Exception:
                pass

            # Search child iframes
            time.sleep(0.5)
            child_frames = frame.child_frames
            if not child_frames:
                return False

            for child in child_frames:
                if find_and_click_in_frame(child, depth + 1):
                    return True
            return False

        try:
            # Try top-level first
            if find_and_click_in_frame(page.main_frame):
                return True

            # Retry with delays
            for attempt in range(4):
                time.sleep(3.0)
                if find_and_click_in_frame(page.main_frame):
                    return True

            logger.warning("[hCaptcha] Checkbox not found after retries")
            return False
        except Exception as e:
            logger.warning(f"[hCaptcha] Error: {e}")
            return False

    def _is_hcaptcha_present(self, page: Any) -> bool:
        """Check if hCaptcha iframe is present."""
        try:
            return page.query_selector('iframe[src*="hcaptcha"]') is not None
        except Exception:
            return False


__all__ = ["PatchrightHCaptchaMixin"]
