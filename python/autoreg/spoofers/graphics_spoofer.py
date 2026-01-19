"""
Consolidated Graphics Spoofer

Combines:
- webgl.py: WebGL vendor/renderer spoofing
- canvas.py: Canvas fingerprint with noise
- fonts.py: Font fingerprint and element metrics
"""

from .base import BaseSpoofModule
from .js_utils import wrap_iife, mulberry32_prng, add_noise_function


class GraphicsSpoofModule(BaseSpoofModule):
    """Consolidated WebGL, Canvas, and Font spoofing"""
    
    name = "graphics"
    description = "Spoof WebGL, Canvas, and Font fingerprints"
    
    def get_js(self) -> str:
        p = self.profile
        fonts_js = ', '.join(f'"{f}"' for f in p.fonts)
        
        return wrap_iife(f'''
const NOISE_SEED = {p.noise_seed};
const WEBGL_VENDOR = '{p.webgl_vendor}';
const WEBGL_RENDERER = '{p.webgl_renderer}';
const ALLOWED_FONTS = [{fonts_js}];

{mulberry32_prng()}

// ============================================
// WEBGL PARAMETERS
// app-min.js checks: UNMASKED_VENDOR_WEBGL (37445), UNMASKED_RENDERER_WEBGL (37446)
// ============================================

const spoofWebGL = (proto) => {{
    const originalGetParameter = proto.getParameter;
    proto.getParameter = function(param) {{
        // Vendor/Renderer
        if (param === 37445) return WEBGL_VENDOR;   // UNMASKED_VENDOR_WEBGL
        if (param === 37446) return WEBGL_RENDERER; // UNMASKED_RENDERER_WEBGL
        if (param === 7936) return WEBGL_VENDOR;    // VENDOR
        if (param === 7937) return WEBGL_RENDERER;  // RENDERER
        
        // Common limits often used for fingerprinting
        if (param === 34921) return new Float32Array([1, 1024]); // ALIASED_LINE_WIDTH_RANGE
        if (param === 34930) return 16384;  // MAX_RENDERBUFFER_SIZE
        if (param === 35660) return 32;     // MAX_COMBINED_TEXTURE_IMAGE_UNITS
        if (param === 3379) return 16384;   // MAX_TEXTURE_SIZE
        if (param === 3386) return new Int32Array([16384, 16384]); // MAX_VIEWPORT_DIMS
        if (param === 36347) return 4096;   // MAX_VERTEX_UNIFORM_VECTORS
        if (param === 36348) return 4096;   // MAX_FRAGMENT_UNIFORM_VECTORS
        
        return originalGetParameter.call(this, param);
    }};
    
    // Spoof getExtension for WEBGL_debug_renderer_info
    const originalGetExtension = proto.getExtension;
    proto.getExtension = function(name) {{
        const ext = originalGetExtension.call(this, name);
        if (name === 'WEBGL_debug_renderer_info' && ext) {{
            return {{
                UNMASKED_VENDOR_WEBGL: 37445,
                UNMASKED_RENDERER_WEBGL: 37446
            }};
        }}
        return ext;
    }};
}};

try {{
    spoofWebGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') {{
        spoofWebGL(WebGL2RenderingContext.prototype);
    }}
}} catch(e) {{}}

// ============================================
// CANVAS FINGERPRINT
// Add consistent noise to toDataURL and getImageData
// ============================================

// toDataURL - add noise
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type, quality) {{
    if (this.width > 0 && this.height > 0) {{
        try {{
            const ctx = this.getContext('2d');
            if (ctx) {{
                const w = Math.min(this.width, 4);
                const h = Math.min(this.height, 4);
                const imageData = ctx.getImageData(0, 0, w, h);
                const data = imageData.data;
                
                for (let i = 0; i < data.length; i += 4) {{
                    const noise = Math.floor(rng() * 3) - 1;
                    data[i] = Math.max(0, Math.min(255, data[i] + noise));
                }}
                ctx.putImageData(imageData, 0, 0);
            }}
        }} catch(e) {{}}
    }}
    return originalToDataURL.call(this, type, quality);
}};

// getImageData - add noise
const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {{
    const imageData = originalGetImageData.call(this, sx, sy, sw, sh);
    const data = imageData.data;
    
    for (let i = 0; i < Math.min(data.length, 64); i += 4) {{
        const noise = Math.floor(rng() * 3) - 1;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
    }}
    return imageData;
}};

// ============================================
// FONT FINGERPRINT
// Limit detectable fonts and add noise to element metrics
// ============================================

// FontFace API
if (typeof FontFace !== 'undefined') {{
    const originalFontFace = FontFace;
    window.FontFace = function(family, source, descriptors) {{
        return new originalFontFace(family, source, descriptors);
    }};
}}

// document.fonts.check
if (document.fonts && document.fonts.check) {{
    const originalCheck = document.fonts.check.bind(document.fonts);
    document.fonts.check = function(font, text) {{
        const fontFamily = font.split(' ').pop().replace(/['"]/g, '');
        if (!ALLOWED_FONTS.includes(fontFamily) && !fontFamily.includes('sans-serif')) {{
            return false;
        }}
        return originalCheck(font, text);
    }};
}}

// ============================================
// ELEMENT METRICS (getBoundingClientRect / getClientRects)
// Add micro-noise (0.0001 - 0.0009) which is invisible to the eye
// but changes the fingerprint hash
// ============================================

{add_noise_function()}

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function() {{
    const rect = originalGetBoundingClientRect.call(this);
    
    const res = {{
        x: addNoise(rect.x),
        y: addNoise(rect.y),
        top: addNoise(rect.top),
        left: addNoise(rect.left),
        right: addNoise(rect.right),
        bottom: addNoise(rect.bottom),
        width: addNoise(rect.width),
        height: addNoise(rect.height),
    }};

    // Try to return DOMRect if possible
    if (typeof DOMRect !== 'undefined') {{
        try {{
            return new DOMRect(res.left, res.top, res.width, res.height);
        }} catch (e) {{
            return res;
        }}
    }}
    return res;
}};

const originalGetClientRects = Element.prototype.getClientRects;
Element.prototype.getClientRects = function() {{
    const list = originalGetClientRects.call(this);
    const newList = [];
    for (let i = 0; i < list.length; i++) {{
        const rect = list[i];
        const res = {{
            x: addNoise(rect.x),
            y: addNoise(rect.y),
            top: addNoise(rect.top),
            left: addNoise(rect.left),
            right: addNoise(rect.right),
            bottom: addNoise(rect.bottom),
            width: addNoise(rect.width),
            height: addNoise(rect.height)
        }};
        if (typeof DOMRect !== 'undefined') {{
            try {{
                newList.push(new DOMRect(res.left, res.top, res.width, res.height));
            }} catch (e) {{
                newList.push(res);
            }}
        }} else {{
            newList.push(res);
        }}
    }}
    return newList;
}};

// ============================================
// offsetWidth / offsetHeight
// ============================================
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {{
    get: function() {{
        return Math.round(addNoise(originalGetBoundingClientRect.call(this).width));
    }}
}});

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {{
    get: function() {{
        return Math.round(addNoise(originalGetBoundingClientRect.call(this).height));
    }}
}});
''')
