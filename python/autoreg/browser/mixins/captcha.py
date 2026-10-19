"""
CAPTCHA handling mixin for browser automation
Provides high-level CAPTCHA detection and solving capabilities
"""

from collections.abc import Callable


class CaptchaMixin:
    """
    Mixin for browser automation classes to handle CAPTCHA challenges

    Requires:
        - self.browser: DrissionPage ChromiumPage instance
        - self.log(message): Logging method
    """

    def detect_captcha(self) -> dict:
        """
        Detect if any CAPTCHA is present on the page

        Returns:
            dict with detection results:
                - type: str | None - CAPTCHA type ("turnstile", etc.) or None
                - present: bool - whether CAPTCHA is detected
                - solved: bool - whether it's already solved
                - details: dict - type-specific details
        """
        if not hasattr(self, "browser") or self.browser is None:
            return {"type": None, "present": False, "solved": False, "details": {}}

        # Check for Turnstile
        turnstile_result = self._detect_turnstile()
        if turnstile_result["present"]:
            return {
                "type": "turnstile",
                "present": True,
                "solved": turnstile_result["solved"],
                "details": turnstile_result,
            }

        # Add more CAPTCHA types here (reCAPTCHA, hCaptcha, etc.)

        return {"type": None, "present": False, "solved": False, "details": {}}

    def _get_turnstile_solver_class(self):
        """Resolve TurnstileSolver: engine-pack first, autoreg.captcha fallback.

        Returns ``None`` when both sources are unavailable — e.g. an
        open-core build without the turnstile solver plugin installed
        (``autoreg.captcha`` is Zone-2 and absent from the public export).
        """
        from autoreg.plugin.engine_pack import get_solver_class

        cls = get_solver_class("turnstile", "TurnstileSolver")
        if cls is not None:
            return cls
        try:
            from autoreg.captcha.turnstile import TurnstileSolver
        except ImportError:  # open-core: captcha module not installed
            return None

        return TurnstileSolver

    def _detect_turnstile(self) -> dict:
        """
        Detect Cloudflare Turnstile CAPTCHA

        Returns:
            dict with Turnstile detection results
        """
        try:
            solver_cls = self._get_turnstile_solver_class()
            solver = solver_cls(self.browser, log_callback=self._get_log_callback())
            return solver.detect()
        except Exception as e:
            self.log(f"[CAPTCHA] Turnstile detection error: {e}")
            return {"present": False, "solved": False}

    def _check_turnstile_solved(self) -> bool:
        """
        Check if Turnstile is solved

        Returns:
            bool: True if solved
        """
        try:
            solver_cls = self._get_turnstile_solver_class()
            solver = solver_cls(self.browser, log_callback=self._get_log_callback())
            return solver.is_solved()
        except Exception:
            return False

    def solve_turnstile(self, method: str = "auto", timeout: int = 60) -> bool:
        """
        Solve Turnstile CAPTCHA

        Args:
            method: Solving method - "auto", "opencv", "dom", or "manual"
            timeout: Maximum time to wait for solve (seconds)

        Returns:
            bool: True if solved successfully
        """
        try:
            solver_cls = self._get_turnstile_solver_class()
            solver = solver_cls(self.browser, log_callback=self._get_log_callback())
            return solver.solve(method=method, timeout=timeout)
        except Exception as e:
            self.log(f"[CAPTCHA] Turnstile solve error: {e}")
            return False

    def wait_for_captcha_solve(self, timeout: int = 60) -> bool:
        """
        Wait for any CAPTCHA to be solved (auto-detect type)

        Args:
            timeout: Maximum time to wait (seconds)

        Returns:
            bool: True if solved within timeout
        """
        detection = self.detect_captcha()

        if not detection["present"]:
            self.log("[CAPTCHA] No CAPTCHA detected")
            return True

        if detection["solved"]:
            self.log("[CAPTCHA] Already solved")
            return True

        captcha_type = detection["type"]
        self.log(f"[CAPTCHA] Detected {captcha_type}, attempting to solve...")

        if captcha_type == "turnstile":
            return self.solve_turnstile(method="auto", timeout=timeout)

        # Add more CAPTCHA types here

        self.log(f"[CAPTCHA] Unknown CAPTCHA type: {captcha_type}")
        return False

    def _get_log_callback(self) -> Callable[[str], None] | None:
        """
        Get log callback function for CAPTCHA solver

        Returns:
            Callable or None
        """
        if hasattr(self, "log") and callable(self.log):
            return self.log
        return None
