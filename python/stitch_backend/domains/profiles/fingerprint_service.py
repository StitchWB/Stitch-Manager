"""Fingerprint profile service — file-based browser fingerprint management.

Ports ``src-tauri/src/services/profile_generator.rs`` and the file-based
commands from ``profile.rs`` (save, load, delete, list, get_or_create).

Profiles are stored as JSON files in ``~/.stitch/tokens/profiles/``.
Each file is keyed by a "safe" version of the email address.
"""

from __future__ import annotations

import json
import logging
import random
import string
from pathlib import Path

from stitch_backend.domains.profiles.schemas import BrowserFingerprintProfile

logger = logging.getLogger(__name__)


# ── Data pools for random generation ──────────────────────────────────────────

_CHROME_VERSIONS = list(range(120, 136))
_SCREEN_RESOLUTIONS = [
    (1920, 1080), (2560, 1440), (1366, 768), (1440, 900),
    (1536, 864), (1680, 1050), (1920, 1200), (3840, 2160),
]
_WEBGL_VENDORS = [
    "Google Inc. (NVIDIA)", "Google Inc. (Intel)", "Google Inc. (AMD)",
    "Google Inc. (NVIDIA Corporation)", "Google Inc. (ATI Technologies)",
]
_WEBGL_RENDERERS = [
    "ANGLE (NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)",
    "ANGLE (NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)",
    "ANGLE (Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)",
    "ANGLE (AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)",
    "ANGLE (NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0)",
    "ANGLE (Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)",
]
_COMMON_FONTS = [
    "Arial", "Arial Black", "Calibri", "Cambria", "Comic Sans MS",
    "Consolas", "Courier New", "Georgia", "Helvetica", "Impact",
    "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana",
]
_TIMEZONE_LOCALES = [
    ("America/New_York", -300, "en-US"),
    ("America/Chicago", -360, "en-US"),
    ("America/Los_Angeles", -480, "en-US"),
    ("Europe/London", 0, "en-GB"),
    ("Europe/Berlin", 60, "de-DE"),
    ("Europe/Moscow", 180, "ru-RU"),
    ("Asia/Tokyo", 540, "ja-JP"),
    ("Asia/Shanghai", 480, "zh-CN"),
    ("Australia/Sydney", 660, "en-AU"),
]


def _profiles_dir() -> Path:
    return Path.home() / ".stitch" / "tokens" / "profiles"


def _safe_name(email: str) -> str:
    return email.replace("@", "_at_").replace(".", "_")


def _from_safe(stem: str) -> str:
    return stem.replace("_at_", "@").replace("_", ".")


# ── Generation ────────────────────────────────────────────────────────────────

def generate_random_profile() -> BrowserFingerprintProfile:
    """Generate a realistic random browser fingerprint profile."""
    rng = random.SystemRandom()
    ver = rng.choice(_CHROME_VERSIONS)
    sw, sh = rng.choice(_SCREEN_RESOLUTIONS)
    tz_info = rng.choice(_TIMEZONE_LOCALES)
    font_count = rng.randint(6, len(_COMMON_FONTS))

    return BrowserFingerprintProfile.model_validate({
        "userAgent": (
            f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            f"AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{ver}.0.0.0 Safari/537.36"
        ),
        "platform": "Win32",
        "vendor": "Google Inc.",
        "screenWidth": sw,
        "screenHeight": sh,
        "availWidth": sw,
        "availHeight": sh - (40 if sh >= 1080 else 30),
        "colorDepth": 24,
        "pixelRatio": 1.0,
        "hardwareConcurrency": rng.choice([2, 4, 8, 16]),
        "deviceMemory": rng.choice([2, 4, 8, 16]),
        "maxTouchPoints": 0,
        "webglVendor": rng.choice(_WEBGL_VENDORS),
        "webglRenderer": rng.choice(_WEBGL_RENDERERS),
        "timezone": tz_info[0],
        "timezoneOffset": tz_info[1],
        "locale": tz_info[2],
        "latitude": round(rng.uniform(-90, 90), 4),
        "longitude": round(rng.uniform(-180, 180), 4),
        "accuracy": round(rng.uniform(10, 100), 1),
        "noiseSeed": rng.randint(0, 2**31 - 1),
        "fonts": sorted(rng.sample(_COMMON_FONTS, font_count)),
    })


# ── File I/O ──────────────────────────────────────────────────────────────────

class FingerprintService:
    """Stateless file-based fingerprint profile operations.

    All methods are ``@staticmethod`` — no DB session required.
    """

    @staticmethod
    def generate() -> BrowserFingerprintProfile:
        logger.info("[Profiles] Generating random fingerprint profile")
        return generate_random_profile()

    @staticmethod
    def save(email: str, profile: BrowserFingerprintProfile) -> None:
        d = _profiles_dir()
        d.mkdir(parents=True, exist_ok=True)
        path = d / f"{_safe_name(email)}.json"
        data = profile.model_dump(mode="json", by_alias=True)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        logger.info("[Profiles] Saved fingerprint for %s", email)

    @staticmethod
    def load(email: str) -> BrowserFingerprintProfile | None:
        path = _profiles_dir() / f"{_safe_name(email)}.json"
        if not path.exists():
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        return BrowserFingerprintProfile.model_validate(raw)

    @staticmethod
    def get_or_create(email: str | None) -> BrowserFingerprintProfile:
        if email:
            existing = FingerprintService.load(email)
            if existing:
                return existing
        return generate_random_profile()

    @staticmethod
    def delete(email: str) -> None:
        path = _profiles_dir() / f"{_safe_name(email)}.json"
        if path.exists():
            path.unlink()
            logger.info("[Profiles] Deleted fingerprint for %s", email)

    @staticmethod
    def list_aliases() -> list[str]:
        d = _profiles_dir()
        if not d.exists():
            return []
        aliases = []
        for f in d.iterdir():
            if f.suffix == ".json":
                aliases.append(_from_safe(f.stem))
        aliases.sort()
        return aliases
