"""
Human behavior simulation mixin for browser automation.

Provides methods to simulate realistic human interactions with web pages.
"""

import logging
import random
import time
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from DrissionPage import ChromiumPage

from autoreg.spoofers.behavior import BehaviorSpoofModule

logger = logging.getLogger(__name__)


class HumanBehaviorMixin:
    """Mixin providing human-like behavior simulation for browser automation."""

    def __init__(self):
        """Initialize behavior module."""
        self._behavior = BehaviorSpoofModule()
        self._realistic_typing = True

    def human_type(
        self,
        page: "ChromiumPage",
        element,
        text: str,
        field_type: str = "default",
        fast: Optional[bool] = None,
    ) -> None:
        """
        Type text with human-like delays and patterns.

        Args:
            page: ChromiumPage instance
            element: Element to type into
            text: Text to type
            field_type: Type of field (email, password, name, default)
            fast: Override realistic typing setting
        """
        use_fast = fast if fast is not None else not self._realistic_typing

        try:
            self._behavior.fwcim_type(page, element, text, field_type=field_type, fast=use_fast)
            logger.debug(f"Typed text into {field_type} field")
        except Exception as e:
            logger.error(f"Failed to type text: {e}")
            raise

    def human_click(self, page: "ChromiumPage", element, with_delay: bool = True) -> None:
        """
        Click element with human-like delay.

        Args:
            page: ChromiumPage instance
            element: Element to click
            with_delay: Whether to add delay before click
        """
        try:
            if with_delay:
                self._behavior.human_delay(0.15, 0.4)

            self._behavior.fwcim_click(page, element)
            logger.debug("Clicked element")
        except Exception as e:
            logger.error(f"Failed to click element: {e}")
            raise

    def random_mouse_movement(self, page: "ChromiumPage", count: int = 3) -> None:
        """
        Simulate random mouse movements.

        Args:
            page: ChromiumPage instance
            count: Number of movements to perform
        """
        try:
            for _ in range(count):
                x = random.randint(100, 800)
                y = random.randint(100, 600)

                page.run_cdp(
                    "Input.dispatchMouseEvent",
                    type="mouseMoved",
                    x=x,
                    y=y,
                )

                time.sleep(random.uniform(0.1, 0.3))

            logger.debug(f"Performed {count} random mouse movements")
        except Exception as e:
            logger.warning(f"Failed to perform mouse movements: {e}")

    def scroll_page(
        self, page: "ChromiumPage", direction: str = "down", amount: int = 300
    ) -> None:
        """
        Scroll page in specified direction.

        Args:
            page: ChromiumPage instance
            direction: 'up' or 'down'
            amount: Pixels to scroll
        """
        try:
            delta_y = amount if direction == "down" else -amount

            page.run_js(f"window.scrollBy(0, {delta_y})")

            time.sleep(random.uniform(0.2, 0.5))
            logger.debug(f"Scrolled {direction} by {amount}px")
        except Exception as e:
            logger.warning(f"Failed to scroll page: {e}")

    def simulate_human_activity(self, page: "ChromiumPage") -> None:
        """
        Simulate realistic human activity (mouse movements, scrolling).

        Args:
            page: ChromiumPage instance
        """
        try:
            # Random mouse movements
            self.random_mouse_movement(page, count=random.randint(1, 3))

            # Random scrolling
            if random.random() < 0.3:
                direction = random.choice(["up", "down"])
                self.scroll_page(page, direction=direction)

            logger.debug("Simulated human activity")
        except Exception as e:
            logger.warning(f"Failed to simulate human activity: {e}")

    def _get_typing_delay(self, fast: bool = False) -> tuple[float, float]:
        """
        Get typing delay range based on mode.

        Args:
            fast: Whether to use fast typing

        Returns:
            Tuple of (min_delay, max_delay)
        """
        if fast:
            return (0.02, 0.05)
        else:
            return (0.05, 0.2)

    def _get_action_delay(self, fast: bool = False) -> tuple[float, float]:
        """
        Get action delay range based on mode.

        Args:
            fast: Whether to use fast actions

        Returns:
            Tuple of (min_delay, max_delay)
        """
        if fast:
            return (0.05, 0.15)
        else:
            return (0.2, 0.6)

    def set_realistic_typing(self, enabled: bool) -> None:
        """
        Enable or disable realistic typing mode.

        Args:
            enabled: Whether to enable realistic typing
        """
        self._realistic_typing = enabled
        logger.info(f"Realistic typing: {'enabled' if enabled else 'disabled'}")

    def set_speed_multiplier(self, multiplier: float) -> None:
        """
        Set speed multiplier for all delays.

        Args:
            multiplier: Speed multiplier (higher = faster, e.g., 2.0 = 2x speed)
        """
        if multiplier <= 0:
            multiplier = 1.0

        # Invert for delay calculation (higher speed = lower delay)
        delay_multiplier = 1.0 / multiplier

        # Update behavior module delays
        self._behavior.typing_delay_range = (
            0.05 * delay_multiplier,
            0.2 * delay_multiplier,
        )
        self._behavior.action_delay_range = (
            0.2 * delay_multiplier,
            0.6 * delay_multiplier,
        )

        logger.info(f"Speed multiplier set to {multiplier}x")
