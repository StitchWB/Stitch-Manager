"""
Спуфинг Intl API и локализации

Подменяет Intl.DateTimeFormat, Intl.NumberFormat, Intl.PluralRules и Intl.RelativeTimeFormat.
Гарантирует, что по умолчанию используется локаль и таймзона из профиля.
"""

from .base import BaseSpoofModule


class IntlSpoofModule(BaseSpoofModule):
    """Спуфинг Intl API"""
    
    name = "intl"
    description = "Spoof Intl API (locales and timezones)"
    
    def get_js(self) -> str:
        p = self.profile
        return f'''
(function() {{
    'use strict';
    
    const PROFILE_LOCALE = '{p.locale}';
    const PROFILE_TIMEZONE = '{p.timezone}';
    
    // ============================================
    // Intl.DateTimeFormat
    // ============================================
    const OriginalDTF = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function(locales, options) {{
        const finalLocales = locales || PROFILE_LOCALE;
        const finalOptions = options || {{}};
        if (!finalOptions.timeZone) {{
            finalOptions.timeZone = PROFILE_TIMEZONE;
        }}
        
        // Handle call without 'new'
        if (!(this instanceof Intl.DateTimeFormat)) {{
            return OriginalDTF(finalLocales, finalOptions);
        }}
        return new OriginalDTF(finalLocales, finalOptions);
    }};
    Intl.DateTimeFormat.prototype = OriginalDTF.prototype;
    Intl.DateTimeFormat.supportedLocalesOf = OriginalDTF.supportedLocalesOf;

    // ============================================
    // Intl.NumberFormat
    // ============================================
    const OriginalNF = Intl.NumberFormat;
    Intl.NumberFormat = function(locales, options) {{
        const finalLocales = locales || PROFILE_LOCALE;
        if (!(this instanceof Intl.NumberFormat)) {{
            return OriginalNF(finalLocales, options);
        }}
        return new OriginalNF(finalLocales, options);
    }};
    Intl.NumberFormat.prototype = OriginalNF.prototype;
    Intl.NumberFormat.supportedLocalesOf = OriginalNF.supportedLocalesOf;

    // ============================================
    // Intl.PluralRules
    // ============================================
    const OriginalPR = Intl.PluralRules;
    Intl.PluralRules = function(locales, options) {{
        const finalLocales = locales || PROFILE_LOCALE;
        if (!(this instanceof Intl.PluralRules)) {{
            return OriginalPR(finalLocales, options);
        }}
        return new OriginalPR(finalLocales, options);
    }};
    Intl.PluralRules.prototype = OriginalPR.prototype;
    Intl.PluralRules.supportedLocalesOf = OriginalPR.supportedLocalesOf;

    // ============================================
    // Intl.RelativeTimeFormat
    // ============================================
    if (Intl.RelativeTimeFormat) {{
        const OriginalRTF = Intl.RelativeTimeFormat;
        Intl.RelativeTimeFormat = function(locales, options) {{
            const finalLocales = locales || PROFILE_LOCALE;
            if (!(this instanceof Intl.RelativeTimeFormat)) {{
                return OriginalRTF(finalLocales, options);
            }}
            return new OriginalRTF(finalLocales, options);
        }};
        Intl.RelativeTimeFormat.prototype = OriginalRTF.prototype;
        Intl.RelativeTimeFormat.supportedLocalesOf = OriginalRTF.supportedLocalesOf;
    }}
    
    // ============================================
    // Intl.DisplayNames
    // ============================================
    if (Intl.DisplayNames) {{
        const OriginalDN = Intl.DisplayNames;
        Intl.DisplayNames = function(locales, options) {{
            const finalLocales = locales || PROFILE_LOCALE;
            if (!(this instanceof Intl.DisplayNames)) {{
                return OriginalDN(finalLocales, options);
            }}
            return new OriginalDN(finalLocales, options);
        }}
        Intl.DisplayNames.prototype = OriginalDN.prototype;
        Intl.DisplayNames.supportedLocalesOf = OriginalDN.supportedLocalesOf;
    }}

    // Фикс для существующих экземпляров через prototype (если кто-то вызывает .resolvedOptions())
    const originalResolvedOptions = OriginalDTF.prototype.resolvedOptions;
    OriginalDTF.prototype.resolvedOptions = function() {{
        const options = originalResolvedOptions.call(this);
        // Всегда возвращаем спуфленные значения, если они не были явно заданы
        options.timeZone = options.timeZone || PROFILE_TIMEZONE;
        options.locale = options.locale || PROFILE_LOCALE;
        return options;
    }};

}})();
'''
