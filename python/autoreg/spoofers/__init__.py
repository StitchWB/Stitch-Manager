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
# JS Modules (consolidated)
from .automation import AutomationSpoofModule

# Base
from .base import BaseSpoofModule

# Behavior (Python module, not JS)
from .behavior import BehaviorSpoofModule
from .cdp_hide import CDPHideSpoofModule

# CDP Spoofer (main entry point)
from .cdp_spoofer import (
    CDPSpoofer,
    apply_cdp_spoofing,
    apply_pre_navigation_spoofing,
)
from .client_hints import ClientHintsSpoofModule
from .device_spoofer import DeviceSpoofModule
from .display_spoofer import DisplaySpoofModule
from .geolocation import GeolocationSpoofModule
from .graphics_spoofer import GraphicsSpoofModule
from .history import HistorySpoofModule
from .intl import IntlSpoofModule
from .math import MathSpoofModule
from .media_spoofer import MediaSpoofModule
from .navigator_spoofer import NavigatorSpoofModule
from .profile import PROFILES, SpoofProfile, generate_random_profile
from .storage import StorageSpoofModule
from .timezone import TimezoneSpoofModule
from .webrtc import WebRTCSpoofModule

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
