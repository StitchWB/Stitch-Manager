"""
Спуфинг для обхода детекции автоматизации

Скрывает признаки Selenium, Puppeteer, Playwright, PhantomJS.
Основано на проверках из AWS FWCIM app-min.js.
"""

from .base import BaseSpoofModule


class AutomationSpoofModule(BaseSpoofModule):
    """Скрытие признаков автоматизации браузера"""
    
    name = "automation"
    description = "Hide automation/webdriver detection"
    
    def get_js(self) -> str:
        return '''
(function() {
    'use strict';
    
    // ============================================
    // WEBDRIVER FLAG - handled by Proxy in cdp_spoofer.py
    // ============================================
    // НЕ трогаем webdriver здесь - Proxy уже установлен
    
    // ============================================
    // AUTOMATION PROPERTIES
    // Списки из app-min.js: WEBDRIVER_DOCUMENT_PROPERTIES, 
    // WEBDRIVER_WINDOW_PROPERTIES, WEBDRIVER_NAVIGATOR_PROPERTIES
    // ============================================
    
    const windowProps = [
        // WEBDRIVER_WINDOW_PROPERTIES
        '__webdriverFunc', 'domAutomation', 'domAutomationController',
        '__lastWatirAlert', '__lastWatirConfirm', '__lastWatirPrompt',
        '_WEBDRIVER_ELEM_CACHE',
        // PHANTOM_WINDOW_PROPERTIES
        '_phantom', 'callPhantom', 'phantom',
        // Puppeteer/Playwright
        '__puppeteer_evaluation_script__', '__playwright', '__nightmare',
        // Selenium
        'webdriver', '__webdriver_script_func', '__webdriver_script_function',
        // Others
        '_selenium', 'calledSelenium', '_Selenium_IDE_Recorder'
    ];
    
    const documentProps = [
        // WEBDRIVER_DOCUMENT_PROPERTIES
        '__selenium_evaluate', '__webdriver_evaluate', '__driver_evaluate',
        '__fxdriver_evaluate', '__driver_unwrapped', '__webdriver_unwrapped',
        '__selenium_unwrapped', '__fxdriver_unwrapped', '__webdriver_script_fn',
        '_Selenium_IDE_Recorder', '_selenium', 'calledSelenium',
        '$cdc_asdjflasutopfhvcZLmcfl_', '$chrome_asyncScriptInfo',
        '__$webdriverAsyncExecutor'
    ];
    
    const navigatorProps = [
        'webdriver', '__webdriver_evaluate', '__selenium_evaluate',
        '__webdriver_unwrapped', '__selenium_unwrapped'
    ];
    
    // Удаляем из window
    windowProps.forEach(prop => {
        try {
            if (prop in window) {
                Object.defineProperty(window, prop, { get: () => undefined, configurable: true });
            }
        } catch(e) {}
    });
    
    // Удаляем из document
    documentProps.forEach(prop => {
        try {
            if (prop in document) {
                Object.defineProperty(document, prop, { get: () => undefined, configurable: true });
            }
        } catch(e) {}
    });

    // Скрываем признаки headless в navigator.plugins и mimeTypes
    // (уже частично сделано в navigator.py, но здесь добавим общие проверки)
    if (navigator.plugins.length === 0) {
        // Если плагинов нет - это подозрительно (headless)
        // Но navigator.py должен был их добавить.
    }
    
    // ============================================
    // CHROME RUNTIME (headless detection)
    // ============================================
    if (!window.chrome) {
        Object.defineProperty(window, 'chrome', {
            get: () => ({
                runtime: {
                    connect: () => {},
                    sendMessage: () => {},
                    onMessage: { addListener: () => {}, removeListener: () => {} },
                    onConnect: { addListener: () => {}, removeListener: () => {} }
                },
                csi: () => ({
                    startE: Date.now(),
                    onloadT: Date.now(),
                    pageT: Date.now() + Math.random() * 1000,
                    tran: 15
                }),
                loadTimes: () => ({
                    commitLoadTime: Date.now() / 1000,
                    connectionInfo: 'h2',
                    finishDocumentLoadTime: Date.now() / 1000 + 0.5,
                    finishLoadTime: Date.now() / 1000 + 1.0,
                    firstPaintAfterFinishedLoadTime: 0,
                    firstPaintTime: Date.now() / 1000 + 0.1,
                    navigationType: 'Other',
                    npnNegotiatedProtocol: 'h2',
                    requestTime: Date.now() / 1000 - 0.1,
                    startLoadTime: Date.now() / 1000 - 0.2,
                    wasAlternateProtocolAvailable: false,
                    wasFetchedViaSpdy: true,
                    wasNpn: true
                })
            }),
            configurable: true
        });
    }
    
    // ============================================
    // Permissions Query
    // ============================================
    if (navigator.permissions && navigator.permissions.query) {
        const originalQuery = navigator.permissions.query;
        navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    }

    // ============================================
    // Avoid "Cloudflare" useragent check mentioned in report
    // ============================================
    // (UserAgent is handled by DrissionPage/CDP, but we can double check)
    
})();
'''
