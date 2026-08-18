"""
Спуфинг SpeechSynthesis API (speechSynthesis.getVoices)

Реальный Chrome на каждой ОС возвращает характерный список голосов
(на Windows — Microsoft-голоса, в Chrome дополнительно "Google …").
Пустой или не соответствующий платформе/локали список голосов — известный
фингерпринт-сигнал (speechSynthesis.getVoices() используется FingerprintJS
и подобными). Этот модуль возвращает правдоподобный список голосов,
согласованный с платформой (Windows) и локалью профиля.
"""

import json

from .base import BaseSpoofModule

# Microsoft-голоса по локалям (как их отдаёт Chrome на Windows).
# localService=True — десктопные TTS, False — Online (Natural) голоса.
_MS_VOICES = {
    "en-US": [
        ("Microsoft Aria Online (Natural) - English (United States)", False),
        ("Microsoft David - English (United States)", True),
        ("Microsoft Zira - English (United States)", True),
    ],
    "en-GB": [
        ("Microsoft Sonia Online (Natural) - English (United Kingdom)", False),
        ("Microsoft George - English (United Kingdom)", True),
        ("Microsoft Hazel - English (United Kingdom)", True),
    ],
    "de-DE": [
        ("Microsoft Conrad Online (Natural) - German (Germany)", False),
        ("Microsoft Stefan - German (Germany)", True),
        ("Microsoft Katja - German (Germany)", True),
    ],
    "ja-JP": [
        ("Microsoft Mayu Online (Natural) - Japanese (Japan)", False),
        ("Microsoft Haruka - Japanese (Japan)", True),
        ("Microsoft Ichiro - Japanese (Japan)", True),
    ],
    "ru-RU": [
        ("Microsoft Svetlana - Russian (Russia)", True),
        ("Microsoft Dmitry - Russian (Russia)", True),
    ],
}

# Google-голос, добавляемый Chrome (язык берётся из локали)
_GOOGLE_VOICE_NAME = {
    "en": "Google US English",
    "de": "Google Deutsch",
    "ja": "Google 日本語",
    "ru": "Google русский",
}


def _voices_for_locale(locale: str) -> list:
    """Возвращает список голосов (name, lang, localService) под локаль."""
    base = locale.split("-")[0]
    ms = _MS_VOICES.get(locale) or _MS_VOICES.get(
        next((k for k in _MS_VOICES if k.startswith(base)), "en-US")
    )
    voices = [(name, locale, local) for (name, local) in ms]
    gname = _GOOGLE_VOICE_NAME.get(base)
    if gname:
        voices.append((gname, base + "-US" if base == "en" else locale, False))
    return voices


class SpeechSpoofModule(BaseSpoofModule):
    """Спуфинг speechSynthesis.getVoices под платформу/локаль"""

    name = "speech"
    description = "Spoof speechSynthesis.getVoices (platform/locale-coherent)"

    def get_js(self) -> str:
        voices = [
            {"name": n, "lang": lang, "localService": local, "default": i == 0,
             "voiceURI": n}
            for i, (n, lang, local) in enumerate(_voices_for_locale(self.profile.locale))
        ]
        voices_json = json.dumps(voices)

        return """
(function() {
    'use strict';
    if (typeof speechSynthesis === 'undefined' || !window.SpeechSynthesis) return;

    const VOICES = __VOICES__.map(v => {
        const obj = Object.create(SpeechSynthesisVoice.prototype);
        Object.defineProperties(obj, {
            voiceURI:     { get: () => v.voiceURI, enumerable: true },
            name:         { get: () => v.name, enumerable: true },
            lang:         { get: () => v.lang, enumerable: true },
            localService: { get: () => v.localService, enumerable: true },
            default:      { get: () => v.default, enumerable: true }
        });
        return obj;
    });

    try {
        Object.defineProperty(SpeechSynthesis.prototype, 'getVoices', {
            value: function() { return VOICES; },
            configurable: true, writable: true
        });
        if (speechSynthesis.onvoiceschanged === null) {
            // не дёргаем — просто чтобы не было обращения к реальному API
        }
    } catch(e) {}
})();
""".replace("__VOICES__", voices_json)
