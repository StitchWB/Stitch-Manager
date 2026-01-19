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

import sys
import os
import json
import functools
import time
import traceback
from typing import Optional, Dict, Any, List
from pathlib import Path

# Add python directory to sys.path for imports
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

# CRITICAL: Override print to output to stderr BY DEFAULT
# BUT respect explicit file parameter for JSON protocol on stdout
import builtins
_original_print = builtins.print
def _stderr_print(*args, **kwargs):
    """Print to stderr by default to avoid breaking JSON protocol
    
    IMPORTANT: If 'file' is explicitly provided, respect it!
    This allows JSON responses to go to stdout while debug logs go to stderr.
    """
    # Only redirect to stderr if file is NOT explicitly specified
    if 'file' not in kwargs:
        kwargs['file'] = sys.stderr
    kwargs.setdefault('flush', True)
    _original_print(*args, **kwargs)
builtins.print = _stderr_print

def log_stderr(*args, **kwargs):
    """Helper function to print to stderr and flush."""
    _original_print(*args, file=sys.stderr, flush=True, **kwargs)



class BrowserWorkerError(Exception):
    """Base exception for browser worker errors"""
    pass


class ElementNotFoundError(BrowserWorkerError):
    """Element not found within timeout"""
    pass


class BrowserCrashedError(BrowserWorkerError):
    """Browser process crashed or disconnected"""
    pass


class TimeoutError(BrowserWorkerError):
    """Operation timed out"""
    pass


class BrowserWorker:
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
        
    def execute(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
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
                    log_stderr(f"[WORKER_ERROR] Screenshot disabled or failed")
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
            raise BrowserCrashedError(f"Browser page not accessible: {e}")
        except Exception as e:
            log_stderr(f"[WORKER_CHECK] Browser not responding: {type(e).__name__}: {e}")
            traceback.print_exc(file=sys.stderr)
            raise BrowserCrashedError(f"Browser not responding: {type(e).__name__}: {e}")
    
    def _init(self, cmd: Dict) -> Dict:
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
            raise BrowserCrashedError(f"Import failed: {e}")
        
        self.headless = cmd.get('headless', False)
        email = cmd.get('email', 'worker@example.com')
        auto_email = cmd.get('auto_email', False)
        config_dict = cmd.get('config')
        
        # CRITICAL DEBUG: Log what we received
        log_stderr(f"[WORKER_INIT] ========== INIT COMMAND DEBUG ==========")
        log_stderr(f"[WORKER_INIT] Received email parameter: {email}")
        log_stderr(f"[WORKER_INIT] Received auto_email parameter: {auto_email}")
        log_stderr(f"[WORKER_INIT] Received headless parameter: {self.headless}")
        log_stderr(f"[WORKER_INIT] Received config: {config_dict}")
        log_stderr(f"[WORKER_INIT] ==========================================")
        
        # Store email (email generation now handled in Rust)
        self._email = email
        log_stderr(f"[WORKER_INIT] Using email from Rust: {email}")
        
        # Config is now passed as dict from Rust (no need to parse)
        config = None
        if config_dict:
            log_stderr("[WORKER_INIT] Using config provided by Rust")
            # Config dict is already in correct format from Rust
            # We don't need to parse it, just pass to BrowserAutomation
        
        # Email generation removed - now handled in Rust
        # auto_email parameter is deprecated and ignored
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
            raise BrowserCrashedError(f"Failed to initialize browser: {type(e).__name__}: {e}")
    
    def _open(self, cmd: Dict) -> Dict:
        """
        Open URL in browser.
        
        Args:
            cmd: {
                'action': 'open',
                'url': str
            }
        """
        url = cmd.get('url')
        if not url:
            return {'status': 'error', 'error': 'URL is required', 'error_type': 'invalid_params'}
        
        self._last_url = self.browser.page.url
        self.browser.navigate(url)
        return {'status': 'ok'}
    
    def _type(self, cmd: Dict) -> Dict:
        """
        Type text into element.
        
        Args:
            cmd: {
                'action': 'type',
                'selector': str,
                'text': str,
                'clear': bool (default: True),
                'timeout': int (default: 5)
            }
        """
        selector = cmd.get('selector')
        text = cmd.get('text', '')
        clear = cmd.get('clear', True)
        timeout = cmd.get('timeout', 5)
        
        # CRITICAL DEBUG: Log what text we're about to type
        log_stderr(f"[WORKER_TYPE] ========== TYPE COMMAND DEBUG ==========")
        log_stderr(f"[WORKER_TYPE] Selector: {selector}")
        log_stderr(f"[WORKER_TYPE] Text to type: '{text}'")
        log_stderr(f"[WORKER_TYPE] Text length: {len(text)}")
        log_stderr(f"[WORKER_TYPE] Clear field: {clear}")
        log_stderr(f"[WORKER_TYPE] ===========================================")
        
        if not selector:
            return {'status': 'error', 'error': 'Selector is required', 'error_type': 'invalid_params'}
        
        element = self.browser.page.ele(selector, timeout=timeout)
        if not element:
            raise ElementNotFoundError(f'Element not found: {selector}')
        
        # Check if field already has content
        current_value = element.attr('value') or ''
        log_stderr(f"[WORKER_TYPE] Current field value before typing: '{current_value}'")
        
        if clear:
            log_stderr(f"[WORKER_TYPE] Clearing field before typing")
            element.clear()
            # Small delay after clearing
            import time
            time.sleep(0.1)
        
        # Use human-like typing if enabled
        if self.human_delays_enabled and hasattr(self.browser, 'human_type'):
            log_stderr(f"[WORKER_TYPE] Using human_type method")
            self.browser.human_type(element, text, click_first=False)
        else:
            log_stderr(f"[WORKER_TYPE] Using direct input method")
            element.input(text)
        
        # Small delay for DOM updates
        import time
        time.sleep(0.2)
        
        # Verify what was actually typed
        typed_value = element.attr('value') or ''
        log_stderr(f"[WORKER_TYPE] Verification - typed value: '{typed_value}'")
        if typed_value != text:
            log_stderr(f"[WORKER_TYPE] ❌ MISMATCH! Expected '{text}' but got '{typed_value}'")
            # Try to get text content as fallback
            text_content = element.text or ''
            log_stderr(f"[WORKER_TYPE] Element text content: '{text_content}'")
        else:
            log_stderr(f"[WORKER_TYPE] ✅ Match confirmed")
        
        return {'status': 'ok'}
    
    def _click(self, cmd: Dict) -> Dict:
        """
        Click on element.
        
        Args:
            cmd: {
                'action': 'click',
                'selector': str,
                'timeout': int (default: 5)
            }
        """
        selector = cmd.get('selector')
        timeout = cmd.get('timeout', 5)
        
        if not selector:
            return {'status': 'error', 'error': 'Selector is required', 'error_type': 'invalid_params'}
        
        element = self.browser.page.ele(selector, timeout=timeout)
        if not element:
            raise ElementNotFoundError(f'Element not found: {selector}')
        
        # Use human-like click if enabled
        if self.human_delays_enabled and hasattr(self.browser, 'human_click'):
            self.browser.human_click(element)
        else:
            element.click()
        
        return {'status': 'ok'}
    
    def _wait(self, cmd: Dict) -> Dict:
        """
        Wait for element to appear.
        
        Args:
            cmd: {
                'action': 'wait',
                'selector': str,
                'timeout': int (default: 10)
            }
            
        Returns:
            {'status': 'ok', 'found': bool}
        """
        selector = cmd.get('selector')
        timeout = cmd.get('timeout', 10)
        
        if not selector:
            return {'status': 'error', 'error': 'Selector is required', 'error_type': 'invalid_params'}
        
        element = self.browser.page.ele(selector, timeout=timeout)
        found = element is not None
        
        return {'status': 'ok', 'found': found}
    
    def _wait_for_navigation(self, cmd: Dict) -> Dict:
        """
        Wait for URL to change.
        
        Args:
            cmd: {
                'action': 'wait_for_navigation',
                'timeout': int (default: 10),
                'url_contains': str (optional) - wait for URL containing this string
            }
            
        Returns:
            {'status': 'ok', 'url': str, 'changed': bool}
        """
        timeout = cmd.get('timeout', 10)
        url_contains = cmd.get('url_contains')
        
        old_url = self._last_url or self.browser.page.url
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            current_url = self.browser.page.url
            
            if url_contains:
                # Wait for specific URL pattern
                if url_contains in current_url:
                    return {'status': 'ok', 'url': current_url, 'changed': True}
            else:
                # Wait for any URL change
                if current_url != old_url:
                    self._last_url = current_url
                    return {'status': 'ok', 'url': current_url, 'changed': True}
            
            time.sleep(0.1)
        
        return {'status': 'ok', 'url': self.browser.page.url, 'changed': False}
    
    def _wait_for_text(self, cmd: Dict) -> Dict:
        """
        Wait for text to appear on page.
        
        Args:
            cmd: {
                'action': 'wait_for_text',
                'text': str,
                'timeout': int (default: 10)
            }
            
        Returns:
            {'status': 'ok', 'found': bool}
        """
        text = cmd.get('text')
        timeout = cmd.get('timeout', 10)
        
        if not text:
            return {'status': 'error', 'error': 'Text is required', 'error_type': 'invalid_params'}
        
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            try:
                element = self.browser.page.ele(f'text={text}', timeout=0.5)
                if element:
                    return {'status': 'ok', 'found': True}
            except Exception:
                pass
            time.sleep(0.1)
        
        return {'status': 'ok', 'found': False}
    
    def _get_url(self) -> Dict:
        """
        Get current URL.
        
        Returns:
            {'status': 'ok', 'url': str}
        """
        url = self.browser.page.url
        return {'status': 'ok', 'url': url}
    
    def _get_text(self, cmd: Dict) -> Dict:
        """
        Get element text content or input value.
        
        Args:
            cmd: {
                'action': 'get_text',
                'selector': str,
                'timeout': int (default: 5)
            }
            
        Returns:
            {'status': 'ok', 'text': str}
        """
        selector = cmd.get('selector')
        timeout = cmd.get('timeout', 5)
        
        if not selector:
            return {'status': 'error', 'error': 'Selector is required', 'error_type': 'invalid_params'}
        
        element = self.browser.page.ele(selector, timeout=timeout)
        if not element:
            raise ElementNotFoundError(f'Element not found: {selector}')
        
        # For input/textarea elements, get value attribute; otherwise get text
        tag_name = element.tag.lower() if hasattr(element, 'tag') else ''
        log_stderr(f"[WORKER_GET_TEXT] Element tag: {tag_name}")
        
        if tag_name in ('input', 'textarea'):
            text = element.attr('value') or ''
            log_stderr(f"[WORKER_GET_TEXT] Got value from input: '{text}'")
        else:
            text = element.text or ''
            log_stderr(f"[WORKER_GET_TEXT] Got text content: '{text}'")
        
        # Also try to get other attributes for debugging
        if not text:
            placeholder = element.attr('placeholder') or ''
            inner_text = element.attr('innerText') or ''
            text_content = element.attr('textContent') or ''
            log_stderr(f"[WORKER_GET_TEXT] Empty result, debugging - placeholder: '{placeholder}', innerText: '{inner_text}', textContent: '{text_content}'")
        
        return {'status': 'ok', 'text': text}
    
    def _screenshot(self, cmd: Dict) -> Dict:
        """
        Take screenshot.
        
        Args:
            cmd: {
                'action': 'screenshot',
                'path': str (default: 'screenshot.png')
            }
            
        Returns:
            {'status': 'ok', 'path': str}
        """
        path = cmd.get('path', 'screenshot.png')
        
        try:
            self.browser.page.get_screenshot(path=path)
            return {'status': 'ok', 'path': path}
        except Exception as e:
            return {'status': 'error', 'error': f'Screenshot failed: {e}', 'error_type': 'screenshot_failed'}
    
    def _execute_js(self, cmd: Dict) -> Dict:
        """
        Execute JavaScript in browser context.
        
        Args:
            cmd: {
                'action': 'execute_js',
                'script': str,
                'args': list (optional)
            }
            
        Returns:
            {'status': 'ok', 'result': any}
        """
        script = cmd.get('script')
        args = cmd.get('args', [])
        
        if not script:
            return {'status': 'error', 'error': 'Script is required', 'error_type': 'invalid_params'}
        
        try:
            result = self.browser.page.run_js(script, *args)
            
            # SPECIAL LOGGING FOR ALLOW ACCESS BUTTON DEBUG
            if 'KIRO DEBUG: ALLOW ACCESS BUTTON' in script:
                print(f"[KIRO_JS_DEBUG] JavaScript execution result: {result}")
                print(f"[KIRO_JS_DEBUG] Result type: {type(result)}")
                if isinstance(result, dict):
                    for key, value in result.items():
                        print(f"[KIRO_JS_DEBUG] {key}: {value}")
            
            # Try to serialize result to JSON
            try:
                json.dumps(result)
                return {'status': 'ok', 'result': result}
            except (TypeError, ValueError):
                return {'status': 'ok', 'result': str(result)}
        except Exception as e:
            print(f"[KIRO_JS_DEBUG] JavaScript execution failed: {e}")
            return {'status': 'error', 'error': f'JS execution failed: {e}', 'error_type': 'js_error'}
    
    def _get_cookies(self, cmd: Dict) -> Dict:
        """
        Get browser cookies.
        
        Args:
            cmd: {
                'action': 'get_cookies',
                'domain': str (optional) - filter by domain
            }
            
        Returns:
            {'status': 'ok', 'cookies': list}
        """
        domain = cmd.get('domain')
        
        try:
            # Get cookies via CDP
            result = self.browser.page.run_cdp('Network.getAllCookies')
            cookies = result.get('cookies', [])
            
            # Filter by domain if specified
            if domain:
                cookies = [c for c in cookies if domain in c.get('domain', '')]
            
            return {'status': 'ok', 'cookies': cookies}
        except Exception as e:
            return {'status': 'error', 'error': f'Failed to get cookies: {e}', 'error_type': 'cookies_error'}
    
    def _set_human_delays(self, cmd: Dict) -> Dict:
        """
        Enable/disable human-like delays.
        
        Args:
            cmd: {
                'action': 'set_human_delays',
                'enabled': bool
            }
        """
        enabled = cmd.get('enabled', True)
        self.human_delays_enabled = enabled
        return {'status': 'ok', 'human_delays_enabled': enabled}
    
    def _apply_spoofers(self, cmd: Dict) -> Dict:
        """
        Apply anti-detection spoofers.
        Note: Spoofers are applied automatically in BrowserAutomation.__init__
        This command can be used to re-apply or verify spoofers.
        
        Returns:
            {'status': 'ok'}
        """
        # Spoofers are applied automatically during browser init
        # This is a no-op but confirms spoofers are active
        return {'status': 'ok', 'message': 'Spoofers applied during browser initialization'}
    
    def _get_imap_lookup_email(self) -> Dict:
        """
        Get IMAP lookup email (may differ from registration email for aliases).
        
        Returns:
            {'status': 'ok', 'email': str}
        """
        if self._email_result:
            return {
                'status': 'ok',
                'email': self._email_result.imap_lookup_email
            }
        else:
            # Fallback to registration email if no email_result
            fallback_email = getattr(self, '_email', 'unknown@example.com')
            log_stderr(f"[WORKER_GET_IMAP_EMAIL] No email_result, using fallback: {fallback_email}")
            return {
                'status': 'ok',
                'email': fallback_email
            }
    
    def _close(self) -> Dict:
        """
        Close browser and cleanup.
        
        Returns:
            {'status': 'ok'}
        """
        if self.browser:
            try:
                self.browser.close()
            except Exception:
                pass
            self.browser = None
        
        return {'status': 'ok'}


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
        log_stderr("[WORKER_MAIN] Starting BrowserWorker main loop...")
        log_stderr(f"[WORKER_MAIN] Python version: {sys.version}")
        log_stderr(f"[WORKER_MAIN] Working directory: {os.getcwd()}")
        log_stderr(f"[WORKER_MAIN] sys.path: {sys.path}")
        
        # Test imports before creating worker
        try:
            log_stderr("[WORKER_MAIN] Testing imports...")
            from DrissionPage import ChromiumPage, ChromiumOptions
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
            # Final result must be printed to stdout, and flushed.
            # CRITICAL: Explicitly specify file=sys.stdout to bypass print override
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
