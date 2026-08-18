"""
Профиль спуфинга - единый источник данных для всех модулей

Все модули используют этот профиль для консистентного спуфинга.
"""

import json
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Cross-platform file locking
if sys.platform != 'win32':
    pass

from .ip_timezone import detect_ip_geo


def _detect_chrome_major_version() -> int:
    """Detect the real Chrome major version of the bundled CloakBrowser.

    The UA string MUST match the engine that actually sends the requests:
    CloakBrowser leaks its real version into ``sec-ch-ua`` /
    ``navigator.userAgentData`` / the TLS fingerprint regardless of any CDP
    override, so claiming a different major in the UA string produces an
    instant inconsistency signal for anti-bot (AWS FWCIM). Reading the
    version from the bundled manifest keeps the two in sync automatically.

    Falls back to a known-good constant when the manifest is absent
    (e.g. running outside the repo layout).
    """
    try:
        # python/autoreg/spoofers/profile.py -> repo root = parents[3]
        repo_root = Path(__file__).resolve().parents[3]
        manifests = list((repo_root / "resources" / "cloakbrowser").glob("*.manifest"))
        if manifests:
            # e.g. "146.0.7680.177.manifest" -> 146
            return int(manifests[0].name.split(".")[0])
    except Exception:  # noqa: BLE001
        pass
    return 146  # keep in sync with resources/cloakbrowser/*.manifest


def _build_user_agent(chrome_major: int) -> str:
    return (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        f"(KHTML, like Gecko) Chrome/{chrome_major}.0.0.0 Safari/537.36"
    )


# ── Когерентные hardware-персоны ────────────────────────────────────────────
# GPU + RAM + логические ядра + экран + color depth подбираются ВМЕСТЕ как
# реальные популярные конфигурации (подход CloakBrowser 148+ "coherent
# hardware personas"). Это закрывает cross-API корреляцию: детектор не увидит
# невозможных связок вида "Intel UHD + 32GB RAM + 32 ядра" или
# "RTX 3080 + 2GB RAM". Значения device_memory/hardware_concurrency — как их
# реально отдаёт Chrome (capped: 2/4/8/16/32; логические потоки CPU).
_HARDWARE_PERSONAS: list[dict] = [
    # Бюджет / офис, интегрированная графика
    {'gpu_vendor': "Google Inc. (Intel)",
         'gpu_renderer': "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
         'device_memory': 8, 'hardware_concurrency': 4, 'screen': (1366, 768),
         'color_depth': 32, 'pixel_ratio': 1.25},
    {'gpu_vendor': "Google Inc. (Intel)",
         'gpu_renderer': "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
         'device_memory': 8, 'hardware_concurrency': 8, 'screen': (1536, 864),
         'color_depth': 32, 'pixel_ratio': 1.25},
    # Средний десктоп
    {'gpu_vendor': "Google Inc. (NVIDIA)",
         'gpu_renderer': "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
         'device_memory': 8, 'hardware_concurrency': 6, 'screen': (1920, 1080),
         'color_depth': 32, 'pixel_ratio': 1.0},
    {'gpu_vendor': "Google Inc. (AMD)",
         'gpu_renderer': "ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)",
         'device_memory': 8, 'hardware_concurrency': 8, 'screen': (1920, 1080),
         'color_depth': 32, 'pixel_ratio': 1.0},
    # Игровой десктоп
    {'gpu_vendor': "Google Inc. (NVIDIA)",
         'gpu_renderer': "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
         'device_memory': 16, 'hardware_concurrency': 12, 'screen': (1920, 1080),
         'color_depth': 32, 'pixel_ratio': 1.0},
    {'gpu_vendor': "Google Inc. (NVIDIA)",
         'gpu_renderer': "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
         'device_memory': 16, 'hardware_concurrency': 16, 'screen': (2560, 1440),
         'color_depth': 32, 'pixel_ratio': 1.0},
]


def _random_hardware() -> dict:
    """Возвращает одну когерентную hardware-персону (GPU+RAM+ядра+экран)."""
    return random.choice(_HARDWARE_PERSONAS)


@dataclass
class SpoofProfile:
    """Профиль для спуфинга - все параметры в одном месте"""

    # Browser - версия должна совпадать с реальным движком CloakBrowser,
    # иначе sec-ch-ua / userAgentData / TLS разойдутся с UA-строкой.
    # Вычисляется один раз при импорте (версия движка за процесс не меняется).
    # Важно: оставляем обычным классовым атрибутом, а не field(default_factory),
    # потому что from_dict() читает ``cls.user_agent`` как fallback.
    user_agent: str = _build_user_agent(_detect_chrome_major_version())
    platform: str = "Win32"
    vendor: str = "Google Inc."

    # Screen
    screen_width: int = 1920
    screen_height: int = 1080
    avail_width: int = 1920
    avail_height: int = 1040  # height - taskbar
    color_depth: int = 24
    pixel_ratio: float = 1.0

    # Hardware
    hardware_concurrency: int = 8
    device_memory: int = 8
    max_touch_points: int = 0

    # WebGL
    webgl_vendor: str = "Google Inc. (NVIDIA)"
    webgl_renderer: str = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)"

    # Timezone
    timezone: str = "America/New_York"
    timezone_offset: int = 300  # минуты от UTC
    locale: str = "en-US"

    # Geolocation
    latitude: float = 40.7128
    longitude: float = -74.0060
    accuracy: float = 50.0

    # Canvas/Audio noise seed (для консистентного fingerprint)
    noise_seed: int = field(default_factory=lambda: random.randint(1, 1000000))

    # Fonts
    fonts: list = field(default_factory=lambda: [
        'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS',
        'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console',
        'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'
    ])

    def to_dict(self) -> dict:
        """Сериализует профиль в словарь для сохранения"""
        return {
            'user_agent': self.user_agent,
            'platform': self.platform,
            'vendor': self.vendor,
            'screen_width': self.screen_width,
            'screen_height': self.screen_height,
            'avail_width': self.avail_width,
            'avail_height': self.avail_height,
            'color_depth': self.color_depth,
            'pixel_ratio': self.pixel_ratio,
            'hardware_concurrency': self.hardware_concurrency,
            'device_memory': self.device_memory,
            'max_touch_points': self.max_touch_points,
            'webgl_vendor': self.webgl_vendor,
            'webgl_renderer': self.webgl_renderer,
            'timezone': self.timezone,
            'timezone_offset': self.timezone_offset,
            'locale': self.locale,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'accuracy': self.accuracy,
            'noise_seed': self.noise_seed,
            'fonts': self.fonts,
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'SpoofProfile':
        """Создаёт профиль из словаря"""
        return cls(
            user_agent=data.get('user_agent', cls.user_agent),
            platform=data.get('platform', cls.platform),
            vendor=data.get('vendor', cls.vendor),
            screen_width=data.get('screen_width', 1920),
            screen_height=data.get('screen_height', 1080),
            avail_width=data.get('avail_width', 1920),
            avail_height=data.get('avail_height', 1040),
            color_depth=data.get('color_depth', 24),
            pixel_ratio=data.get('pixel_ratio', 1.0),
            hardware_concurrency=data.get('hardware_concurrency', 8),
            device_memory=data.get('device_memory', 8),
            max_touch_points=data.get('max_touch_points', 0),
            webgl_vendor=data.get('webgl_vendor', ''),
            webgl_renderer=data.get('webgl_renderer', ''),
            timezone=data.get('timezone', 'America/New_York'),
            timezone_offset=data.get('timezone_offset', 300),
            locale=data.get('locale', 'en-US'),
            latitude=data.get('latitude', 40.7128),
            longitude=data.get('longitude', -74.0060),
            accuracy=data.get('accuracy', 50.0),
            noise_seed=data.get('noise_seed', random.randint(1, 1000000)),
            fonts=data.get('fonts', []),
        )


# Предустановленные профили для разных локаций
# ВАЖНО: timezone_offset - это минуты ЗАПАДНЕЕ UTC (положительное = запад)
# getTimezoneOffset() возвращает положительное для западных таймзон
PROFILES = {
    'new_york': SpoofProfile(
        timezone='America/New_York',
        timezone_offset=300,  # UTC-5 = +300 минут
        locale='en-US',
        latitude=40.7128,
        longitude=-74.0060,
    ),
    'los_angeles': SpoofProfile(
        timezone='America/Los_Angeles',
        timezone_offset=480,  # UTC-8 = +480 минут
        locale='en-US',
        latitude=34.0522,
        longitude=-118.2437,
    ),
    'chicago': SpoofProfile(
        timezone='America/Chicago',
        timezone_offset=360,  # UTC-6 = +360 минут
        locale='en-US',
        latitude=41.8781,
        longitude=-87.6298,
    ),
    'london': SpoofProfile(
        timezone='Europe/London',
        timezone_offset=0,  # UTC+0 = 0 минут
        locale='en-GB',
        latitude=51.5074,
        longitude=-0.1278,
    ),
    'berlin': SpoofProfile(
        timezone='Europe/Berlin',
        timezone_offset=-60,  # UTC+1 = -60 минут (зима)
        locale='de-DE',
        latitude=52.5200,
        longitude=13.4050,
    ),
    'tokyo': SpoofProfile(
        timezone='Asia/Tokyo',
        timezone_offset=-540,  # UTC+9 = -540 минут
        locale='ja-JP',
        latitude=35.6762,
        longitude=139.6503,
    ),
}


def generate_profile_from_ip() -> SpoofProfile | None:
    """
    Генерирует профиль на основе IP геолокации.

    Timezone и координаты берутся из IP, остальное рандомизируется.
    Это важно чтобы timezone совпадал с IP!
    """
    geo = detect_ip_geo()
    if not geo:
        return None

    print(f"[PROFILE] Detected IP geo: {geo.city}, {geo.country} ({geo.timezone})")

    # Когерентная hardware-персона: GPU+RAM+ядра+экран+color depth вместе,
    # чтобы не было невозможных cross-API комбинаций.
    hw = _random_hardware()
    screen_width, screen_height = hw["screen"]
    taskbar_height = random.choice([40, 48, 30])

    # Версия Chrome = реальная версия движка CloakBrowser (иначе UA-строка
    # разойдётся с sec-ch-ua / userAgentData / TLS, которые движок отдаёт
    # сам и которые нельзя переопределить через CDP).
    user_agent = _build_user_agent(_detect_chrome_major_version())

    return SpoofProfile(
        user_agent=user_agent,
        platform="Win32",
        vendor="Google Inc.",
        screen_width=screen_width,
        screen_height=screen_height,
        avail_width=screen_width,
        avail_height=screen_height - taskbar_height,
        color_depth=hw["color_depth"],
        pixel_ratio=hw["pixel_ratio"],
        hardware_concurrency=hw["hardware_concurrency"],
        device_memory=hw["device_memory"],
        max_touch_points=0,
        webgl_vendor=hw["gpu_vendor"],
        webgl_renderer=hw["gpu_renderer"],
        timezone=geo.timezone,
        timezone_offset=geo.timezone_offset,
        locale=geo.locale,
        latitude=geo.latitude + random.uniform(-0.05, 0.05),
        longitude=geo.longitude + random.uniform(-0.05, 0.05),
        accuracy=random.uniform(20, 100),
    )


def generate_random_profile() -> SpoofProfile:
    """
    Генерирует профиль спуфинга.

    Приоритет:
    1. По IP геолокации (timezone совпадает с IP)
    2. Fallback на случайный US профиль
    """
    # Сначала пробуем по IP
    profile = generate_profile_from_ip()
    if profile:
        return profile

    # IP geo failed - silent fallback

    # Fallback на случайный US профиль
    us_profiles = ['new_york', 'los_angeles', 'chicago']
    base = PROFILES[random.choice(us_profiles)]

    # Когерентная hardware-персона (GPU+RAM+ядра+экран+color depth вместе).
    hw = _random_hardware()
    screen_width, screen_height = hw["screen"]
    taskbar_height = random.choice([40, 48, 30])

    # Версия Chrome = реальная версия движка CloakBrowser (иначе UA-строка
    # разойдётся с sec-ch-ua / userAgentData / TLS, которые движок отдаёт
    # сам и которые нельзя переопределить через CDP).
    user_agent = _build_user_agent(_detect_chrome_major_version())

    return SpoofProfile(
        user_agent=user_agent,
        platform=base.platform,
        vendor=base.vendor,
        screen_width=screen_width,
        screen_height=screen_height,
        avail_width=screen_width,
        avail_height=screen_height - taskbar_height,
        color_depth=hw["color_depth"],
        pixel_ratio=hw["pixel_ratio"],
        hardware_concurrency=hw["hardware_concurrency"],
        device_memory=hw["device_memory"],
        max_touch_points=0,
        webgl_vendor=hw["gpu_vendor"],
        webgl_renderer=hw["gpu_renderer"],
        timezone=base.timezone,
        timezone_offset=base.timezone_offset,
        locale=base.locale,
        latitude=base.latitude + random.uniform(-0.05, 0.05),
        longitude=base.longitude + random.uniform(-0.05, 0.05),
        accuracy=random.uniform(20, 100),
    )


# === Сохранение/загрузка профиля ===


def get_profile_path(email: str) -> Path:
    """Возвращает путь к файлу профиля для email"""
    from autoreg.core.paths import get_paths
    profiles_dir = get_paths().tokens_dir / 'profiles'
    profiles_dir.mkdir(parents=True, exist_ok=True)
    # Используем email как имя файла (заменяем @ и .)
    safe_name = email.replace('@', '_at_').replace('.', '_')
    return profiles_dir / f'{safe_name}.json'


def save_profile(email: str, profile: SpoofProfile) -> bool:
    """
    Сохраняет профиль спуфинга для аккаунта.

    Вызывается после успешной регистрации.
    """
    try:
        path = get_profile_path(email)
        data = profile.to_dict()
        data['email'] = email
        data['saved_at'] = __import__('datetime').datetime.now().isoformat()

        with open(path, 'w', encoding='utf-8') as f:
            # Use platform-specific file locking
            if sys.platform != 'win32':
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                try:
                    json.dump(data, f, indent=2)
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            else:
                # Windows: simple write without locking (for now)
                json.dump(data, f, indent=2)

        print(f"[PROFILE] Saved fingerprint for {email}")
        return True
    except Exception as e:
        print(f"[PROFILE] Failed to save: {e}")
        return False


def load_profile(email: str) -> SpoofProfile | None:
    """
    Загружает сохранённый профиль для аккаунта.

    Используется при работе с токеном для консистентности fingerprint.
    """
    try:
        path = get_profile_path(email)
        if not path.exists():
            return None

        with open(path, encoding='utf-8') as f:
            # Use platform-specific file locking
            if sys.platform != 'win32':
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_SH)
                try:
                    data = json.load(f)
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            else:
                # Windows: simple read without locking (for now)
                data = json.load(f)

        profile = SpoofProfile.from_dict(data)
        print(f"[PROFILE] Loaded fingerprint for {email}")
        return profile
    except Exception as e:
        print(f"[PROFILE] Failed to load: {e}")
        return None


def get_or_create_profile(email: str | None = None) -> SpoofProfile:
    """
    Получает профиль для email или создаёт новый.

    Если email указан и профиль существует - загружает его.
    Иначе генерирует новый.
    """
    if email:
        profile = load_profile(email)
        if profile:
            return profile

    return generate_random_profile()
