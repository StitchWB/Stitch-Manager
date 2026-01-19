"""
Модульные спуферы для обхода проверок браузера

Архитектура:
- profile.py: SpoofProfile dataclass с параметрами
- base.py: BaseSpoofModule - базовый класс
- Каждый модуль (automation.py, canvas.py, etc.) содержит свой JS
- cdp_spoofer.py: CDPSpoofer собирает JS из модулей и применяет через CDP
- behavior.py: Python-модуль для человеческого поведения (не JS!)

Использование:
    from autoreg.spoofers import apply_pre_navigation_spoofing, BehaviorSpoofModule
    
    # Спуфинг (до навигации)
    spoofer = apply_pre_navigation_spoofing(page)
    page.get('https://...')
    
    # Человеческое поведение
    behavior = BehaviorSpoofModule()
    behavior.human_delay()
"""

# Profile
from .profile import SpoofProfile, PROFILES, generate_random_profile

# Base
from .base import BaseSpoofModule

# JS Modules (consolidated)
from .automation import AutomationSpoofModule
from .navigator_spoofer import NavigatorSpoofModule
from .display_spoofer import DisplaySpoofModule
from .graphics_spoofer import GraphicsSpoofModule
from .media_spoofer import MediaSpoofModule
from .device_spoofer import DeviceSpoofModule
from .timezone import TimezoneSpoofModule
from .intl import IntlSpoofModule
from .webrtc import WebRTCSpoofModule
from .geolocation import GeolocationSpoofModule
from .cdp_hide import CDPHideSpoofModule
from .client_hints import ClientHintsSpoofModule
from .math import MathSpoofModule
from .history import HistorySpoofModule
from .storage import StorageSpoofModule

# CDP Spoofer (main entry point)
from .cdp_spoofer import (
    CDPSpoofer,
    apply_cdp_spoofing,
    apply_pre_navigation_spoofing,
)

# Behavior (Python module, not JS)
from .behavior import BehaviorSpoofModule


# Все JS-модули (consolidated to 15 modules)
ALL_JS_MODULES = [
    AutomationSpoofModule,
    CDPHideSpoofModule,
    NavigatorSpoofModule,
    DisplaySpoofModule,
    GraphicsSpoofModule,
    MediaSpoofModule,
    DeviceSpoofModule,
    TimezoneSpoofModule,
    IntlSpoofModule,
    WebRTCSpoofModule,
    GeolocationSpoofModule,
    ClientHintsSpoofModule,
    MathSpoofModule,
    HistorySpoofModule,
    StorageSpoofModule,
]


__all__ = [
    # Profile
    'SpoofProfile',
    'PROFILES',
    'generate_random_profile',
    # Base
    'BaseSpoofModule',
    # CDP Spoofer
    'CDPSpoofer',
    'apply_cdp_spoofing',
    'apply_pre_navigation_spoofing',
    # Behavior
    'BehaviorSpoofModule',
    # All modules
    'ALL_JS_MODULES',
]
