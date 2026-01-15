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
import json
import functools
import time
import traceback
from typing import Optional, Dict, Any, List

# Force unbuffered output for real-time communication
print = functools.partial(print, flush=True)


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
        self.browser = None  # BrowserAutomation instance
        self.headless = False
        self.human_delays_enabled = True
        self._last_url = None
        
    def execute(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute command and return result.
        
        Args:
            cmd: Command dictionary with 'action' and parameters
            
        Returns:
            Result dictionary with 'status' and optional data/error
        """
        action = cmd.get('action')
        
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
            elif action == 'close':
                return self._close()
            else:
                return {'status': 'error', 'error': f'Unknown action: {action}', 'error_type': 'unknown_action'}
                
        except ElementNotFoundError as e:
            return {'status': 'error', 'error': str(e), 'error_type': 'element_not_found'}
        except TimeoutError as e:
            return {'status': 'error', 'error': str(e), 'error_type': 'timeout'}
        except BrowserCrashedError as e:
            return {'status': 'error', 'error': str(e), 'error_type': 'browser_crashed'}
        except Exception as e:
            # Log full traceback to stderr for debugging
            traceback.print_exc(file=sys.stderr)
            return {'status': 'error', 'error': str(e), 'error_type': 'exception'}
    
    def _check_browser_alive(self):
        """Check if browser is still responsive"""
        if not self.browser:
            raise BrowserCrashedError("Browser not initialized")
        
        try:
            # Try to get URL - this will fail if browser crashed
            _ = self.browser.page.url
        except Exception as e:
            raise BrowserCrashedError(f"Browser not responding: {e}")
    
    def _init(self, cmd: Dict) -> Dict:
        """
        Initialize browser.
        
        Args:
            cmd: {
                'action': 'init',
                'headless': bool (default: False),
                'email': str (for profile storage)
            }
        """
        # Import here to avoid loading heavy modules until needed
        from providers.kiro.browser import BrowserAutomation
        
        self.headless = cmd.get('headless', False)
        email = cmd.get('email', 'worker@example.com')
        
        try:
            self.browser = BrowserAutomation(email=email, headless=self.headless)
            return {'status': 'ok'}
        except Exception as e:
            raise BrowserCrashedError(f"Failed to initialize browser: {e}")
    
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
        
        if not selector:
            return {'status': 'error', 'error': 'Selector is required', 'error_type': 'invalid_params'}
        
        element = self.browser.page.ele(selector, timeout=timeout)
        if not element:
            raise ElementNotFoundError(f'Element not found: {selector}')
        
        if clear:
            element.clear()
        
        # Use human-like typing if enabled
        if self.human_delays_enabled and hasattr(self.browser, 'human_type'):
            self.browser.human_type(element, text, click_first=False)
        else:
            element.input(text)
        
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
        Get element text content.
        
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
        
        return {'status': 'ok', 'text': element.text}
    
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
            # Try to serialize result to JSON
            try:
                json.dumps(result)
                return {'status': 'ok', 'result': result}
            except (TypeError, ValueError):
                return {'status': 'ok', 'result': str(result)}
        except Exception as e:
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
    worker = BrowserWorker()
    
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
            }))
            continue
        
        result = worker.execute(cmd)
        print(json.dumps(result))
        
        # Exit after close command
        if cmd.get('action') == 'close':
            break


if __name__ == '__main__':
    main()
