"""
Consolidated Display Spoofer

Combines:
- screen.py: Screen properties (width, height, colorDepth, deviceXDPI)
- performance.py: Performance timing API
"""

from .base import BaseSpoofModule
from .js_utils import define_properties, wrap_iife


class DisplaySpoofModule(BaseSpoofModule):
    """Consolidated screen and performance spoofing"""

    name = "display"
    description = "Spoof screen properties and performance timing"

    def get_js(self) -> str:
        p = self.profile

        # Static screen properties that are safe constants (identical on the
        # vast majority of desktop displays) and don't cross-correlate with
        # anything the layout exposes.
        screen_props = {
            'colorDepth': str(p.color_depth),
            'pixelDepth': str(p.color_depth),
            'deviceXDPI': '96',
            'logicalXDPI': '96',
            'fontSmoothingEnabled': 'true',
        }
        screen_props_js = define_properties('screen', screen_props)

        return wrap_iife(f'''
// ============================================
// SCREEN / WINDOW DIMENSION RE-ALIGNMENT
// --------------------------------------------
// CloakBrowser spoofs screen.* and outerWidth/outerHeight at the ENGINE level
// to its own profile (e.g. 1920x1080) but does NOT adjust window.innerWidth/
// innerHeight, which stay at the real monitor size. On a maximized window that
// produces physically impossible states anti-bot (AWS FWCIM) treats as a strong
// automation signal:
//     innerWidth(2560) > screen.width(1920)
//     innerWidth(2560) > outerWidth(1920)
// visualViewport, matchMedia and layout all expose the real size anyway, so the
// fix is to pull screen.* / outer* UP to the real layout viewport (top frame
// only — screen is a shared object, one correction covers every frame).
// ============================================
try {{
    if (window.self === window.top) {{
        const _rw = window.innerWidth;
        const _rh = window.innerHeight;
        if (_rw > 0 && _rh > 0) {{
            const _title = 36;    // window title bar (maximized)
            const _taskbar = 48;  // OS taskbar
            try {{
                Object.defineProperty(screen, 'width',      {{ get: () => _rw, configurable: true }});
                Object.defineProperty(screen, 'height',     {{ get: () => _rh + _title + _taskbar, configurable: true }});
                Object.defineProperty(screen, 'availWidth', {{ get: () => _rw, configurable: true }});
                Object.defineProperty(screen, 'availHeight',{{ get: () => _rh + _title, configurable: true }});
            }} catch(e) {{}}
            try {{
                Object.defineProperty(window, 'outerWidth',  {{ get: () => _rw, configurable: true }});
                Object.defineProperty(window, 'outerHeight', {{ get: () => _rh + _title, configurable: true }});
            }} catch(e) {{}}
        }}
    }}
}} catch(e) {{}}

// ============================================
// STATIC SCREEN PROPERTIES (colorDepth / DPI)
// app-min.js collects: width-height-availHeight-colorDepth-deviceXDPI-logicalXDPI-fontSmoothing
// ============================================
{screen_props_js}

// ============================================
// PERFORMANCE TIMING
// Amazon FWCIM collects performance.timing.toJSON()
// ============================================

// Spoof performance.timing for consistency
const originalTiming = window.performance.timing;

if (originalTiming && originalTiming.toJSON) {{
    const originalToJSON = originalTiming.toJSON.bind(originalTiming);

    // Add minimal noise to timing values
    Object.defineProperty(originalTiming, 'toJSON', {{
        value: function() {{
            const data = originalToJSON();
            // Don't modify, just return original
            // Important that timing looks realistic
            return data;
        }},
        configurable: true
    }});
}}

// Ensure performance.now() works correctly
// and doesn't reveal too precise values (fingerprint protection)
const originalNow = performance.now.bind(performance);
Object.defineProperty(performance, 'now', {{
    value: function() {{
        // Round to 0.1ms for protection from timing attacks
        return Math.round(originalNow() * 10) / 10;
    }},
    configurable: true
}});
''')
