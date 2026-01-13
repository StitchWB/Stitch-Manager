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

# JS Modules
from .automation import AutomationSpoofModule
from .navigator import NavigatorSpoofModule
from .screen import ScreenSpoofModule
from .webgl import WebGLSpoofModule
from .canvas import CanvasSpoofModule
from .timezone import TimezoneSpoofModule
from .intl import IntlSpoofModule
from .audio import AudioSpoofModule
from .battery import BatterySpoofModule
from .network import NetworkSpoofModule
from .webrtc import WebRTCSpoofModule
from .fonts import FontsSpoofModule
from .sensors import SensorsSpoofModule
from .geolocation import GeolocationSpoofModule
from .cdp_hide import CDPHideSpoofModule
from .client_hints import ClientHintsSpoofModule
from .performance import PerformanceSpoofModule
from .math import MathSpoofModule
from .history import HistorySpoofModule
from .capabilities import CapabilitiesSpoofModule
from .storage import StorageSpoofModule
from .media import MediaDevicesSpoofModule

# CDP Spoofer (main entry point)
from .cdp_spoofer import (
    CDPSpoofer,
    apply_cdp_spoofing,
    apply_pre_navigation_spoofing,
)

# Behavior (Python module, not JS)
from .behavior import BehaviorSpoofModule


# Все JS-модули (22 модуля)
ALL_JS_MODULES = [
    AutomationSpoofModule,
    CDPHideSpoofModule,
    NavigatorSpoofModule,
    ScreenSpoofModule,
    WebGLSpoofModule,
    CanvasSpoofModule,
    TimezoneSpoofModule,
    IntlSpoofModule,
    AudioSpoofModule,
    BatterySpoofModule,
    NetworkSpoofModule,
    WebRTCSpoofModule,
    FontsSpoofModule,
    SensorsSpoofModule,
    GeolocationSpoofModule,
    ClientHintsSpoofModule,
    PerformanceSpoofModule,
    MathSpoofModule,
    HistorySpoofModule,
    CapabilitiesSpoofModule,
    StorageSpoofModule,
    MediaDevicesSpoofModule,
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
