"""Browser initialization and configuration utilities."""

import os
import tempfile
import uuid

from DrissionPage import ChromiumOptions, ChromiumPage


def create_browser_options(
    headless: bool = False,
    incognito: bool = True,
    user_data_dir: str | None = None,
    proxy: str | None = None,
    user_agent: str | None = None,
    disable_automation: bool = True,
) -> ChromiumOptions:
    """
    Create configured ChromiumOptions for DrissionPage browser.

    Args:
        headless: Run in headless mode (no GUI)
        incognito: Use incognito/private mode
        user_data_dir: Custom user data directory (creates temp if None)
        proxy: Proxy server URL (e.g., "http://proxy:8080")
        user_agent: Custom user agent string
        disable_automation: Hide automation indicators

    Returns:
        Configured ChromiumOptions instance

    Example:
        >>> options = create_browser_options(headless=True, incognito=True)
        >>> browser = ChromiumPage(options)
    """
    co = ChromiumOptions()

    # User data directory - use temp if not specified
    if user_data_dir:
        profile_path = user_data_dir
    else:
        profile_path = os.path.join(
            tempfile.gettempdir(),
            f'autoreg_chrome_{uuid.uuid4().hex[:8]}'
        )

    co.set_user_data_path(profile_path)
    co.auto_port()  # Automatically find free port

    # Headless mode
    if headless:
        # CRITICAL: Use --headless=new instead of deprecated --headless
        co.set_argument('--headless=new')
        co.set_argument('--disable-gpu')
        co.set_argument('--no-sandbox')
        co.set_argument('--disable-dev-shm-usage')
        co.set_argument('--disable-software-rasterizer')
        co.set_argument('--disable-extensions')
        co.set_argument('--remote-debugging-port=0')

    # Hide automation indicators
    if disable_automation:
        co.set_argument('--disable-blink-features=AutomationControlled')

    # Common arguments
    co.set_argument('--disable-infobars')
    co.set_argument('--no-first-run')
    co.set_argument('--no-default-browser-check')

    # Reduce Chrome logs
    co.set_argument('--disable-logging')
    co.set_argument('--log-level=3')  # Only fatal errors

    # Force English language
    co.set_argument('--lang=en-US')
    co.set_argument('--accept-lang=en-US,en')

    # Window size
    co.set_argument('--window-size=1920,1080')
    co.set_argument('--start-maximized')

    # Incognito mode
    if incognito:
        co.set_argument('--incognito')

    # Proxy configuration
    if proxy:
        # Remove protocol prefix for Chrome proxy format
        proxy_server = proxy.replace('http://', '').replace('https://', '')
        co.set_argument(f'--proxy-server={proxy_server}')
        co.set_argument('--ignore-certificate-errors')
        co.set_argument('--ignore-ssl-errors')

    # Custom user agent
    if user_agent:
        co.set_user_agent(user_agent)

    return co


def create_browser(
    headless: bool = False,
    incognito: bool = True,
    user_data_dir: str | None = None,
    proxy: str | None = None,
    user_agent: str | None = None,
) -> ChromiumPage:
    """
    Create configured DrissionPage browser instance.

    This is a convenience function that combines create_browser_options()
    and ChromiumPage initialization.

    Args:
        headless: Run in headless mode
        incognito: Use incognito mode
        user_data_dir: Custom user data directory
        proxy: Proxy server URL
        user_agent: Custom user agent

    Returns:
        Configured ChromiumPage browser instance

    Example:
        >>> browser = create_browser(headless=True)
        >>> browser.get("https://example.com")
        >>> browser.quit()
    """
    options = create_browser_options(
        headless=headless,
        incognito=incognito,
        user_data_dir=user_data_dir,
        proxy=proxy,
        user_agent=user_agent,
    )

    return ChromiumPage(options)


def wait_for_cdp_ready(page: ChromiumPage, timeout: float = 3.0) -> bool:
    """
    Wait for Chrome DevTools Protocol (CDP) connection to be ready.

    This is critical before sending CDP commands to avoid errors.

    Args:
        page: ChromiumPage instance
        timeout: Maximum wait time in seconds

    Returns:
        True if CDP is ready, False if timeout

    Example:
        >>> browser = create_browser()
        >>> if wait_for_cdp_ready(browser):
        ...     browser.run_cdp('Network.clearBrowserCookies')
    """
    import time

    start_time = time.time()
    poll_interval = 0.1

    while time.time() - start_time < timeout:
        try:
            page.run_cdp('Browser.getVersion')
            return True
        except Exception:
            time.sleep(poll_interval)

    return False


def clear_browser_data(page: ChromiumPage, origins: list[str] | None = None):
    """
    Clear browser cookies, cache, and storage.

    Args:
        page: ChromiumPage instance
        origins: List of origins to clear (e.g., ['https://example.com'])
                If None, clears all data

    Example:
        >>> browser = create_browser()
        >>> clear_browser_data(browser, ['https://github.com'])
    """
    try:
        # Clear cookies and cache
        page.run_cdp('Network.clearBrowserCookies')
        page.run_cdp('Network.clearBrowserCache')

        # Clear storage for specific origins
        if origins:
            for origin in origins:
                try:
                    page.run_cdp('Storage.clearDataForOrigin',
                               origin=origin,
                               storageTypes='all')
                except RuntimeError:
                    pass  # CDP command may not be supported
    except RuntimeError:
        pass  # CDP not ready or not supported
