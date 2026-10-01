"""BrowserWorker action handlers (stdin command implementations)."""

import json
import time

try:
    from .browser_worker_protocol import ElementNotFoundError, log_stderr
except ImportError:
    from browser_worker_protocol import ElementNotFoundError, log_stderr


class BrowserWorkerHandlersMixin:
    """Action handlers mixed into BrowserWorker (attributes live on the worker)."""

    def _open(self, cmd: dict) -> dict:
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

        assert self.browser is not None, "Browser not initialized"
        self._last_url = self.browser.page.url
        self.browser.navigate(url)
        return {'status': 'ok'}

    def _type(self, cmd: dict) -> dict:
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
        log_stderr("[WORKER_TYPE] ========== TYPE COMMAND DEBUG ==========")
        log_stderr(f"[WORKER_TYPE] Selector: {selector}")
        log_stderr(f"[WORKER_TYPE] Text to type: '{text}'")
        log_stderr(f"[WORKER_TYPE] Text length: {len(text)}")
        log_stderr(f"[WORKER_TYPE] Clear field: {clear}")
        log_stderr("[WORKER_TYPE] ===========================================")

        if not selector:
            return {'status': 'error', 'error': 'Selector is required', 'error_type': 'invalid_params'}

        assert self.browser is not None, "Browser not initialized"
        element = self.browser.page.ele(selector, timeout=timeout)
        if not element:
            raise ElementNotFoundError(f'Element not found: {selector}')

        # Check if field already has content
        current_value = element.attr('value') or ''
        log_stderr(f"[WORKER_TYPE] Current field value before typing: '{current_value}'")

        if clear:
            log_stderr("[WORKER_TYPE] Clearing field before typing")
            element.clear()
            # Small delay after clearing
            import time
            time.sleep(0.1)

        # Use human-like typing if enabled
        if self.human_delays_enabled and hasattr(self.browser, 'human_type'):
            log_stderr("[WORKER_TYPE] Using human_type method")
            assert self.browser is not None
            self.browser.human_type(element, text, click_first=False)
        else:
            log_stderr("[WORKER_TYPE] Using direct input method")
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
            log_stderr("[WORKER_TYPE] ✅ Match confirmed")

        return {'status': 'ok'}

    def _click(self, cmd: dict) -> dict:
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

        assert self.browser is not None, "Browser not initialized"
        element = self.browser.page.ele(selector, timeout=timeout)
        if not element:
            raise ElementNotFoundError(f'Element not found: {selector}')

        # Use human-like click if enabled
        if self.human_delays_enabled and hasattr(self.browser, 'human_click'):
            self.browser.human_click(element)
        else:
            element.click()

        return {'status': 'ok'}

    def _wait(self, cmd: dict) -> dict:
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

        assert self.browser is not None, "Browser not initialized"
        element = self.browser.page.ele(selector, timeout=timeout)
        found = element is not None

        return {'status': 'ok', 'found': found}

    def _wait_for_navigation(self, cmd: dict) -> dict:
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

        assert self.browser is not None, "Browser not initialized"
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

    def _wait_for_text(self, cmd: dict) -> dict:
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

        assert self.browser is not None, "Browser not initialized"
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

    def _get_url(self) -> dict:
        """
        Get current URL.

        Returns:
            {'status': 'ok', 'url': str}
        """
        assert self.browser is not None, "Browser not initialized"
        url = self.browser.page.url
        return {'status': 'ok', 'url': url}

    def _get_text(self, cmd: dict) -> dict:
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

        assert self.browser is not None, "Browser not initialized"
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

    def _screenshot(self, cmd: dict) -> dict:
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

        assert self.browser is not None, "Browser not initialized"
        try:
            self.browser.page.get_screenshot(path=path)
            return {'status': 'ok', 'path': path}
        except Exception as e:
            return {'status': 'error', 'error': f'Screenshot failed: {e}', 'error_type': 'screenshot_failed'}

    def _execute_js(self, cmd: dict) -> dict:
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

        assert self.browser is not None, "Browser not initialized"
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

    def _get_cookies(self, cmd: dict) -> dict:
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

        assert self.browser is not None, "Browser not initialized"
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

    def _set_human_delays(self, cmd: dict) -> dict:
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

    def _apply_spoofers(self, cmd: dict) -> dict:
        """
        Apply anti-detection spoofers.
        Note: Spoofers are applied automatically in BrowserAutomation.__init__
        This command can be used to re-apply or verify spoofers.

        Returns:
            {'status': 'ok'}
        """
        # Spoofers are applied during browser init; this no-op confirms they are active
        return {'status': 'ok', 'message': 'Spoofers applied during browser initialization'}

    def _get_imap_lookup_email(self) -> dict:
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

    def _close(self) -> dict:
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
