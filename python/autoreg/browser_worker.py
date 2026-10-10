#!/usr/bin/env python3
"""
Browser Worker - принимает команды от Rust, выполняет в браузере.
Протокол: JSON через stdin/stdout

Команды:
- init: Инициализация браузера
- open: Открыть URL
- type: Ввести текст в элемент
- click: Кликнуть по элементу
- wait: Ждать появления элемента
- wait_for_navigation: Ждать смены URL
- wait_for_text: Ждать появления текста на странице
- get_url: Получить текущий URL
- get_text: Получить текст элемента
- screenshot: Сделать скриншот
- execute_js: Выполнить JavaScript
- get_cookies: Получить cookies
- set_human_delays: Включить/выключить человеческие задержки
- apply_spoofers: Применить anti-detection спуферы
- close: Закрыть браузер
"""

import json
import os
import sys
import traceback
from typing import Any

try:
    from .browser_worker_handlers import BrowserWorkerHandlersMixin
    from .browser_worker_protocol import (
        BrowserCrashedError,
        BrowserWorkerError,
        ElementNotFoundError,
        TimeoutError,
        install_stderr_print,
        log_stderr,
    )
except ImportError:
    from browser_worker_handlers import BrowserWorkerHandlersMixin
    from browser_worker_protocol import (
        BrowserCrashedError,
        BrowserWorkerError,
        ElementNotFoundError,
        TimeoutError,
        install_stderr_print,
        log_stderr,
    )

__all__ = [
    'BrowserWorker',
    'BrowserWorkerError',
    'ElementNotFoundError',
    'BrowserCrashedError',
    'TimeoutError',
    'log_stderr',
    'main',
]


class BrowserWorker(BrowserWorkerHandlersMixin):
    """
    Browser Worker - executes browser commands received via stdin.
    Returns results via stdout in JSON format.
    """

    def __init__(self):
        log_stderr("[WORKER_INIT] BrowserWorker initialized.")
        self.browser = None  # BrowserAutomation instance
        self.headless = False
        self.human_delays_enabled = True
        self._last_url = None
        self._email_result = None  # Store EmailResult for IMAP lookup
        self._email = None  # Store email for fallback

    def execute(self, cmd: dict[str, Any]) -> dict[str, Any]:
        """
        Execute command and return result.

        Args:
            cmd: Command dictionary with 'action' and parameters

        Returns:
            Result dictionary with 'status' and optional data/error
        """
        action = cmd.get('action')
        log_stderr(f"[WORKER_EXEC] Received action: {action}")

        try:
            # Check if browser is alive for commands that need it
            if action not in ('init', 'close', 'set_human_delays'):
                self._check_browser_alive()

            if action == 'init':
                return self._init(cmd)
            elif action == 'open':
                return self._open(cmd)
            elif action == 'type':
                return self._type(cmd)
            elif action == 'click':
                return self._click(cmd)
            elif action == 'wait':
                return self._wait(cmd)
            elif action == 'wait_for_navigation':
                return self._wait_for_navigation(cmd)
            elif action == 'wait_for_text':
                return self._wait_for_text(cmd)
            elif action == 'get_url':
                return self._get_url()
            elif action == 'get_text':
                return self._get_text(cmd)
            elif action == 'screenshot':
                return self._screenshot(cmd)
            elif action == 'execute_js':
                return self._execute_js(cmd)
            elif action == 'get_cookies':
                return self._get_cookies(cmd)
            elif action == 'set_human_delays':
                return self._set_human_delays(cmd)
            elif action == 'apply_spoofers':
                return self._apply_spoofers(cmd)
            elif action == 'get_imap_lookup_email':
                return self._get_imap_lookup_email()
            elif action == 'close':
                return self._close()
            else:
                return {'status': 'error', 'error': f'Unknown action: {action}', 'error_type': 'unknown_action'}

        except ElementNotFoundError as e:
            self._take_error_screenshot(f"element_not_found_{action}")
            return {'status': 'error', 'error': str(e), 'error_type': 'element_not_found'}
        except TimeoutError as e:
            self._take_error_screenshot(f"timeout_{action}")
            return {'status': 'error', 'error': str(e), 'error_type': 'timeout'}
        except BrowserCrashedError as e:
            self._take_error_screenshot(f"browser_crashed_{action}")
            return {'status': 'error', 'error': str(e), 'error_type': 'browser_crashed'}
        except Exception as e:
            # Log full traceback to stderr for debugging
            traceback.print_exc(file=sys.stderr)
            self._take_error_screenshot(f"exception_{action}")
            return {'status': 'error', 'error': str(e), 'error_type': 'exception'}

    def _take_error_screenshot(self, error_type: str):
        """Take screenshot on error if enabled"""
        try:
            if self.browser and hasattr(self.browser, 'screenshot'):
                import time
                timestamp = int(time.time())
                screenshot_name = f"error_{error_type}_{timestamp}"
                screenshot_path = self.browser.screenshot(screenshot_name)
                if screenshot_path:
                    log_stderr(f"[WORKER_ERROR] 📸 Screenshot saved: {screenshot_path}")
                else:
                    log_stderr("[WORKER_ERROR] Screenshot disabled or failed")
        except Exception as e:
            log_stderr(f"[WORKER_ERROR] Failed to take screenshot: {e}")

    def _check_browser_alive(self):
        """Check if browser is still alive and responding"""
        if not self.browser:
            log_stderr("[WORKER_CHECK] Browser not initialized")
            raise BrowserCrashedError("Browser not initialized")

        try:
            # Try to get URL - this will fail if browser crashed
            url = self.browser.page.url
            log_stderr(f"[WORKER_CHECK] Browser alive, current URL: {url}")
        except AttributeError as e:
            log_stderr(f"[WORKER_CHECK] Browser page not accessible: {e}")
            raise BrowserCrashedError(f"Browser page not accessible: {e}") from e
        except Exception as e:
            log_stderr(f"[WORKER_CHECK] Browser not responding: {type(e).__name__}: {e}")
            traceback.print_exc(file=sys.stderr)
            raise BrowserCrashedError(f"Browser not responding: {type(e).__name__}: {e}") from e

    def _init(self, cmd: dict) -> dict:
        """
        Initialize browser.

        Args:
            cmd: {
                'action': 'init',
                'headless': bool (default: False),
                'email': str (for profile storage),
                'auto_email': bool (default: False) - auto-generate email using strategy,
                'config': dict (optional) - configuration override
            }
        """
        # Import using absolute path from 'python' root
        try:
            log_stderr("[WORKER_INIT] Starting import of BrowserAutomation...")
            from autoreg.providers.kiro.browser import BrowserAutomation
            log_stderr("[WORKER_INIT] BrowserAutomation imported successfully")
        except ImportError as e:
            log_stderr(f"[WORKER_INIT_ERROR] Failed to import: {e}")
            traceback.print_exc(file=sys.stderr)
            raise BrowserCrashedError(f"Import failed: {e}") from e

        self.headless = cmd.get('headless', False)
        email = cmd.get('email', 'worker@example.com')
        auto_email = cmd.get('auto_email', False)
        config_dict = cmd.get('config')

        # CRITICAL DEBUG: Log what we received
        log_stderr("[WORKER_INIT] ========== INIT COMMAND DEBUG ==========")
        log_stderr(f"[WORKER_INIT] Received email parameter: {email}")
        log_stderr(f"[WORKER_INIT] Received auto_email parameter: {auto_email}")
        log_stderr(f"[WORKER_INIT] Received headless parameter: {self.headless}")
        log_stderr(f"[WORKER_INIT] Received config: {config_dict}")
        log_stderr("[WORKER_INIT] ==========================================")

        # Store email (email generation now handled in Rust)
        self._email = email
        log_stderr(f"[WORKER_INIT] Using email from Rust: {email}")

        config = None
        if config_dict:
            log_stderr("[WORKER_INIT] Using config provided by Rust")

        self._email_result = None
        if auto_email:
            log_stderr("[WORKER_INIT_WARNING] auto_email=True is deprecated - email generation now in Rust")

        # Pre-initialization validation checks
        log_stderr("[WORKER_INIT] Running pre-initialization checks...")

        # Check Chrome path
        try:
            from autoreg.providers.kiro.browser import find_chrome_path
            chrome_path = find_chrome_path()
            if chrome_path:
                log_stderr(f"[WORKER_INIT] Chrome found at: {chrome_path}")
                if not os.path.exists(chrome_path):
                    log_stderr(f"[WORKER_INIT_ERROR] Chrome path does not exist: {chrome_path}")
            else:
                log_stderr("[WORKER_INIT_WARNING] Chrome path not found, DrissionPage will try to find it")
        except Exception as e:
            log_stderr(f"[WORKER_INIT_WARNING] Chrome path check failed: {e}")

        # Check temp directory
        try:
            import tempfile
            temp_dir = tempfile.gettempdir()
            log_stderr(f"[WORKER_INIT] Temp directory: {temp_dir}")
            if not os.path.exists(temp_dir):
                log_stderr(f"[WORKER_INIT_ERROR] Temp directory does not exist: {temp_dir}")
            elif not os.access(temp_dir, os.W_OK):
                log_stderr(f"[WORKER_INIT_ERROR] Temp directory not writable: {temp_dir}")
        except Exception as e:
            log_stderr(f"[WORKER_INIT_WARNING] Temp directory check failed: {e}")

        # Initialize browser with detailed error handling
        try:
            log_stderr(f"[WORKER_INIT_BROWSER] Initializing BrowserAutomation (headless={self.headless}, email={email})...")
            self.browser = BrowserAutomation(email=email, headless=self.headless, config=config)
            log_stderr("[WORKER_INIT_BROWSER] BrowserAutomation initialized successfully.")

            # Return success
            return {'status': 'ok'}
        except Exception as e:
            log_stderr(f"[WORKER_INIT_ERROR] Browser initialization failed: {type(e).__name__}: {e}")
            log_stderr("[WORKER_INIT_ERROR] Full traceback:")
            traceback.print_exc(file=sys.stderr)
            raise BrowserCrashedError(f"Failed to initialize browser: {type(e).__name__}: {e}") from e


def main():
    """
    Main entry point - reads commands from stdin, writes responses to stdout.

    Protocol:
        Input (stdin): One JSON command per line
        Output (stdout): One JSON response per line

    Example:
        Input:  {"action": "init", "headless": false}
        Output: {"status": "ok"}
    """
    try:
        install_stderr_print()
        log_stderr("[WORKER_MAIN] Starting BrowserWorker main loop...")
        log_stderr(f"[WORKER_MAIN] Python version: {sys.version}")
        log_stderr(f"[WORKER_MAIN] Working directory: {os.getcwd()}")
        log_stderr(f"[WORKER_MAIN] sys.path: {sys.path}")

        # Test imports before creating worker
        try:
            log_stderr("[WORKER_MAIN] Testing imports...")
            from DrissionPage import ChromiumOptions, ChromiumPage  # noqa: F401
            log_stderr("[WORKER_MAIN] DrissionPage imported successfully")
        except ImportError as e:
            log_stderr(f"[WORKER_MAIN_ERROR] Failed to import DrissionPage: {e}")
            traceback.print_exc(file=sys.stderr)
            print(json.dumps({
                'status': 'error',
                'error': f'Failed to import DrissionPage: {e}',
                'error_type': 'import_error'
            }), file=sys.stdout, flush=True)
            return

        worker = BrowserWorker()
        log_stderr("[WORKER_MAIN] BrowserWorker instance created")

        # Read commands from stdin, write responses to stdout
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                cmd = json.loads(line)
            except json.JSONDecodeError as e:
                print(json.dumps({
                    'status': 'error',
                    'error': f'Invalid JSON: {e}',
                    'error_type': 'json_parse_error'
                }), file=sys.stdout, flush=True)
                continue

            result = worker.execute(cmd)
            print(json.dumps(result), file=sys.stdout, flush=True)
            log_stderr(f"[WORKER_LOOP] Action '{cmd.get('action')}' executed. Result status: {result.get('status')}")

            # Exit after close command
            if cmd.get('action') == 'close':
                break

    except Exception as e:
        log_stderr(f"[WORKER_MAIN_ERROR] Fatal error in main loop: {type(e).__name__}: {e}")
        log_stderr("[WORKER_MAIN_ERROR] Full traceback:")
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({
            'status': 'error',
            'error': f'Fatal error: {type(e).__name__}: {e}',
            'error_type': 'fatal_error'
        }), file=sys.stdout, flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
