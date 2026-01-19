"""
Consolidated Display Spoofer

Combines:
- screen.py: Screen properties (width, height, colorDepth, deviceXDPI)
- performance.py: Performance timing API
"""

from .base import BaseSpoofModule
from .js_utils import wrap_iife, define_properties


class DisplaySpoofModule(BaseSpoofModule):
    """Consolidated screen and performance spoofing"""
    
    name = "display"
    description = "Spoof screen properties and performance timing"
    
    def get_js(self) -> str:
        p = self.profile
        
        # Screen properties
        screen_props = {
            'width': str(p.screen_width),
            'height': str(p.screen_height),
            'availWidth': str(p.avail_width),
            'availHeight': str(p.avail_height),
            'colorDepth': str(p.color_depth),
            'pixelDepth': str(p.color_depth),
            'deviceXDPI': '96',
            'logicalXDPI': '96',
            'fontSmoothingEnabled': 'true',
        }
        
        # Window dimensions
        window_props = {
            'innerWidth': str(p.screen_width),
            'innerHeight': str(p.avail_height),
            'outerWidth': str(p.screen_width),
            'outerHeight': str(p.screen_height),
            'devicePixelRatio': str(p.pixel_ratio),
        }
        
        screen_props_js = define_properties('screen', screen_props)
        window_props_js = define_properties('window', window_props)
        
        return wrap_iife(f'''
// ============================================
// SCREEN PROPERTIES
// app-min.js collects: width-height-availHeight-colorDepth-deviceXDPI-logicalXDPI-fontSmoothing
// ============================================
{screen_props_js}

// ============================================
// WINDOW DIMENSIONS
// ============================================
{window_props_js}

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
