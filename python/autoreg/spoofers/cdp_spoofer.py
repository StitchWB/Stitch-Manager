"""
CDP-based спуфинг для DrissionPage

Использует Chrome DevTools Protocol для надёжного спуфинга.
Собирает JS из всех модулей и инжектит через CDP.
"""

import sys
from typing import Dict, List, Optional, Type

from .profile import SpoofProfile, PROFILES, generate_random_profile
from .base import BaseSpoofModule
from .automation import AutomationSpoofModule
from .navigator_spoofer import NavigatorSpoofModule  # Consolidated: navigator + capabilities
from .display_spoofer import DisplaySpoofModule      # Consolidated: screen + performance
from .graphics_spoofer import GraphicsSpoofModule    # Consolidated: webgl + canvas + fonts
from .media_spoofer import MediaSpoofModule          # Consolidated: audio + media
from .device_spoofer import DeviceSpoofModule        # Consolidated: battery + network + sensors
from .timezone import TimezoneSpoofModule
from .intl import IntlSpoofModule
from .webrtc import WebRTCSpoofModule
from .geolocation import GeolocationSpoofModule
from .cdp_hide import CDPHideSpoofModule
from .client_hints import ClientHintsSpoofModule
from .math import MathSpoofModule
from .history import HistorySpoofModule
from .storage import StorageSpoofModule


# All JS modules in order of application
JS_MODULES: List[Type[BaseSpoofModule]] = [
    AutomationSpoofModule,   # First hide automation
    CDPHideSpoofModule,      # Hide CDP traces
    NavigatorSpoofModule,    # Navigator properties + capabilities (consolidated)
    DisplaySpoofModule,      # Screen properties + performance (consolidated)
    GraphicsSpoofModule,     # WebGL + Canvas + Fonts (consolidated)
    MediaSpoofModule,        # Audio + MediaDevices (consolidated)
    DeviceSpoofModule,       # Battery + Network + Sensors (consolidated)
    TimezoneSpoofModule,     # Timezone offset
    IntlSpoofModule,         # Intl API (locales/timezones)
    WebRTCSpoofModule,       # WebRTC IP leak
    GeolocationSpoofModule,  # Geolocation (JS fallback)
    ClientHintsSpoofModule,  # Client Hints API (userAgentData)
    MathSpoofModule,         # Math fingerprint (sin/cos/tan)
    HistorySpoofModule,      # History length
    StorageSpoofModule,      # Storage quota and DBs
]


class CDPSpoofer:
    """
    Спуфер на основе Chrome DevTools Protocol.
    
    Использует CDP для надёжного спуфинга + собирает JS из модулей.
    
    Использование:
        spoofer = CDPSpoofer()
        spoofer.apply(page)  # Применить к DrissionPage
    """
    
    def __init__(self, profile: Optional[SpoofProfile] = None):
        self.profile = profile or generate_random_profile()
        self._modules = [ModuleClass(self.profile) for ModuleClass in JS_MODULES]
    
    def _collect_js(self) -> str:
        """Собирает JS из всех модулей в один скрипт"""
        js_parts = [
            "// === AWS FWCIM Bypass - Auto-generated ===",
            "'use strict';",
            "",
            "// === WEBDRIVER PROXY (must be first!) ===",
            """
(function() {
    // Храним спуфленные свойства которые модули переопределят позже
    const spoofedProps = new Map();
    
    // Функция для регистрации спуфленных свойств (вызывается модулями)
    window.__registerSpoofedProp = function(prop, getter) {
        spoofedProps.set(prop, getter);
    };
    
    // Proxy для полного скрытия webdriver
    const originalNavigator = window.navigator;
    const navigatorProxy = new Proxy(originalNavigator, {
        has: function(target, prop) {
            if (prop === 'webdriver') return false;
            return prop in target;
        },
        get: function(target, prop) {
            // Скрываем webdriver
            if (prop === 'webdriver') return undefined;
            
            // Проверяем спуфленные свойства
            if (spoofedProps.has(prop)) {
                return spoofedProps.get(prop)();
            }
            
            const value = target[prop];
            if (typeof value === 'function') {
                return value.bind(target);
            }
            return value;
        },
        getOwnPropertyDescriptor: function(target, prop) {
            if (prop === 'webdriver') return undefined;
            return Object.getOwnPropertyDescriptor(target, prop);
        }
    });
    
    try {
        Object.defineProperty(window, 'navigator', {
            get: () => navigatorProxy,
            configurable: true
        });
    } catch(e) {}
})();
""",
        ]
        
        for module in self._modules:
            js = module.get_js()
            if js:
                js_parts.append(f"\n// === {module.name}: {module.description} ===")
                js_parts.append(js)
        
        js_parts.append("\nconsole.log('[SPOOF] All modules applied');")
        return '\n'.join(js_parts)
    
    def _fmt_err(self, e) -> str:
        """Безопасно форматирует ошибку для вывода (удаляет китайские символы)"""
        return str(e).encode('ascii', 'replace').decode('ascii')

    def apply(self, page) -> Dict[str, bool]:
        """
        Применяет все спуфинги к DrissionPage.
        
        Args:
            page: DrissionPage ChromiumPage instance
        
        Returns:
            Dict с результатами применения
        """
        results = {}
        p = self.profile
        
        # Silent - no output to avoid breaking JSON protocol
        
        # 0. Отключаем webdriver через Proxy (КРИТИЧНО!)
        try:
            page.run_cdp('Page.addScriptToEvaluateOnNewDocument', source='''
                const originalNavigator = window.navigator;
                const navigatorProxy = new Proxy(originalNavigator, {
                    has: function(target, prop) {
                        if (prop === 'webdriver') return false;
                        return prop in target;
                    },
                    get: function(target, prop) {
                        if (prop === 'webdriver') return undefined;
                        const value = target[prop];
                        if (typeof value === 'function') {
                            return value.bind(target);
                        }
                        return value;
                    }
                });
                Object.defineProperty(window, 'navigator', {
                    get: () => navigatorProxy,
                    configurable: true
                });
            ''')
            results['webdriver_hide'] = True
            # OK: WebDriver flag hidden via CDP")
        except Exception as e:
            results['webdriver_hide'] = False
            # FAIL: WebDriver hide: {self._fmt_err(e)}")
        
        # 1. User-Agent через CDP
        try:
            page.run_cdp('Emulation.setUserAgentOverride', 
                userAgent=p.user_agent,
                platform=p.platform,
                acceptLanguage=f"{p.locale},en;q=0.9"
            )
            results['user_agent'] = True
            # OK: User-Agent: {p.user_agent[:50]}...")
        except Exception as e:
            results['user_agent'] = False
            # FAIL: User-Agent: {self._fmt_err(e)}")
        
        # 2. Timezone через CDP
        try:
            page.run_cdp('Emulation.setTimezoneOverride', timezoneId=p.timezone)
            results['timezone'] = True
            # OK: Timezone: {p.timezone}")
        except Exception as e:
            results['timezone'] = False
            # FAIL: Timezone: {self._fmt_err(e)}")
        
        # 3. Geolocation через CDP
        try:
            page.run_cdp('Emulation.setGeolocationOverride',
                latitude=p.latitude,
                longitude=p.longitude,
                accuracy=p.accuracy
            )
            results['geolocation'] = True
            # OK: Geolocation: {p.latitude:.4f}, {p.longitude:.4f}")
        except Exception as e:
            results['geolocation'] = False
            # FAIL: Geolocation: {self._fmt_err(e)}")
        
        # 4. Device metrics через CDP
        try:
            page.run_cdp('Emulation.setDeviceMetricsOverride',
                width=p.screen_width,
                height=p.screen_height,
                deviceScaleFactor=p.pixel_ratio,
                mobile=False
            )
            results['device_metrics'] = True
            # OK: Screen: {p.screen_width}x{p.screen_height}")
        except Exception as e:
            results['device_metrics'] = False
            # FAIL: Device metrics: {self._fmt_err(e)}")
        
        # 5. Locale через CDP (опционально)
        try:
            page.run_cdp('Emulation.setLocaleOverride', locale=p.locale)
            results['locale'] = True
        except Exception:
            results['locale'] = False
        
        # 6. Персистентный JS-инжект (выполнится на каждой странице)
        try:
            js_code = self._collect_js()
            page.run_cdp('Page.addScriptToEvaluateOnNewDocument', source=js_code)
            results['js_persistent'] = True
            # OK: Persistent JS injection ({len(self._modules)} modules)")
        except Exception as e:
            results['js_persistent'] = False
            # FAIL: Persistent JS: {self._fmt_err(e)}")
        
        # 7. Также выполняем JS сразу для текущей страницы
        try:
            page.run_js(self._collect_js())
            results['js_immediate'] = True
        except Exception as e:
            results['js_immediate'] = False
            print(f"   [WARN] Immediate JS: {self._fmt_err(e)}")
        
        success = sum(results.values())
        total = len(results)
        print(f"[SPOOF] Applied {success}/{total} spoofings")
        
        return results
    
    def apply_pre_navigation(self, page) -> bool:
        """
        Применяет спуфинг ДО навигации на страницу.
        
        ВАЖНО: Вызывать ПЕРЕД page.get(url)!
        
        Args:
            page: DrissionPage ChromiumPage instance
        
        Returns:
            True если успешно
        """
        p = self.profile
        success = True
        
        # Silent - no output to avoid breaking JSON protocol
        
        # 0. Отключаем webdriver через Proxy (КРИТИЧНО!)
        # Proxy нужен чтобы 'webdriver' in navigator возвращал false
        try:
            page.run_cdp('Page.addScriptToEvaluateOnNewDocument', source='''
                // Используем Proxy чтобы полностью скрыть webdriver
                const originalNavigator = window.navigator;
                const navigatorProxy = new Proxy(originalNavigator, {
                    has: function(target, prop) {
                        if (prop === 'webdriver') return false;
                        return prop in target;
                    },
                    get: function(target, prop) {
                        if (prop === 'webdriver') return undefined;
                        const value = target[prop];
                        if (typeof value === 'function') {
                            return value.bind(target);
                        }
                        return value;
                    }
                });
                
                Object.defineProperty(window, 'navigator', {
                    get: () => navigatorProxy,
                    configurable: true
                });
            ''')
            # OK: WebDriver hidden")
        except Exception as e:
            print(f"   [WARN] WebDriver hide: {self._fmt_err(e)}")
            success = False
        
        # CDP настройки
        try:
            page.run_cdp('Emulation.setUserAgentOverride', 
                userAgent=p.user_agent,
                platform=p.platform,
                acceptLanguage=f"{p.locale},en;q=0.9"
            )
            # OK: User-Agent")
        except Exception as e:
            print(f"   [WARN] User-Agent: {self._fmt_err(e)}")
            success = False
        
        try:
            page.run_cdp('Emulation.setTimezoneOverride', timezoneId=p.timezone)
            # OK: Timezone: {p.timezone}")
        except Exception as e:
            print(f"   [WARN] Timezone: {self._fmt_err(e)}")
        
        try:
            page.run_cdp('Emulation.setGeolocationOverride', 
                latitude=p.latitude,
                longitude=p.longitude,
                accuracy=p.accuracy
            )
            # OK: Geolocation: {p.latitude}, {p.longitude}")
        except Exception as e:
            print(f"   [WARN] Geolocation: {self._fmt_err(e)}")
        
        try:
            page.run_cdp('Emulation.setDeviceMetricsOverride', 
                width=p.screen_width,
                height=p.screen_height,
                deviceScaleFactor=p.pixel_ratio,
                mobile=False
            )
            # OK: Screen: {p.screen_width}x{p.screen_height}")
        except Exception as e:
            print(f"   [WARN] Device metrics: {self._fmt_err(e)}")
        
        # Permission override через CDP (для Notification.permission)
        try:
            # Устанавливаем notifications permission в 'prompt' для всех origins
            page.run_cdp('Browser.setPermission',
                permission={'name': 'notifications'},
                setting='prompt'
            )
            # OK: Notification permission: prompt")
        except Exception as e:
            # Fallback: пробуем через Emulation
            try:
                page.run_cdp('Emulation.setPermissionOverride',
                    permission={'name': 'notifications'},
                    setting='prompt'
                )
                # OK: Notification permission (emulation): prompt")
            except Exception as e:
                print(f"   [WARN] Notification permission: {self._fmt_err(e)}")
        
        # Персистентный JS-инжект
        try:
            js_code = self._collect_js()
            page.run_cdp('Page.addScriptToEvaluateOnNewDocument', source=js_code)
            # OK: Persistent JS ({len(self._modules)} modules)")
        except Exception as e:
            # FAIL: Persistent JS: {self._fmt_err(e)}")
            success = False
        
        # Silent - spoofing ready
        return success
    
    def get_modules_info(self) -> List[Dict]:
        """Возвращает информацию о всех модулях"""
        return [
            {"name": m.name, "description": m.description}
            for m in self._modules
        ]


# === Удобные функции ===

def apply_cdp_spoofing(page, profile: Optional[SpoofProfile] = None) -> Dict[str, bool]:
    """Применяет CDP спуфинг к странице"""
    spoofer = CDPSpoofer(profile)
    return spoofer.apply(page)


def apply_pre_navigation_spoofing(page, profile: Optional[SpoofProfile] = None) -> CDPSpoofer:
    """
    Применяет спуфинг ДО навигации.
    
    Использование:
        spoofer = apply_pre_navigation_spoofing(page)
        page.get('https://...')
    
    Returns:
        CDPSpoofer instance
    """
    spoofer = CDPSpoofer(profile)
    spoofer.apply_pre_navigation(page)
    return spoofer

