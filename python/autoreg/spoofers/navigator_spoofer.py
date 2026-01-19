"""
Consolidated Navigator Spoofer

Combines:
- navigator.py: Basic navigator properties (platform, vendor, languages, plugins, mimeTypes)
- capabilities.py: JS/CSS capabilities (audio, video, geolocation, localStorage, touch, webWorker)
"""

from .base import BaseSpoofModule
from .js_utils import wrap_iife, define_properties


class NavigatorSpoofModule(BaseSpoofModule):
    """Consolidated navigator properties and capabilities spoofing"""
    
    name = "navigator"
    description = "Spoof navigator properties, plugins, and JS capabilities"
    
    def get_js(self) -> str:
        p = self.profile
        
        # Basic navigator properties
        nav_props = {
            'platform': f"'{p.platform}'",
            'vendor': f"'{p.vendor}'",
            'hardwareConcurrency': str(p.hardware_concurrency),
            'deviceMemory': str(p.device_memory),
            'maxTouchPoints': str(p.max_touch_points),
            'language': f"'{p.locale}'",
            'userLanguage': f"'{p.locale}'",
            'languages': f"['{p.locale}', 'en']",
            'doNotTrack': 'null',
            'msDoNotTrack': 'undefined',
        }
        
        nav_props_js = define_properties('navigator', nav_props)
        
        return wrap_iife(f'''
// ============================================
// BASIC NAVIGATOR PROPERTIES
// ============================================
{nav_props_js}

Object.defineProperty(window, 'doNotTrack', {{
    get: () => undefined,
    configurable: true
}});

// ============================================
// PROTOTYPE FIX FOR PLUGINARRAY/PLUGIN/MIMETYPEARRAY
// CRITICAL: AWS FWCIM checks constructor.name!
// ============================================

// Save original prototypes
const originalPluginArray = window.PluginArray;
const originalPlugin = window.Plugin;
const originalMimeTypeArray = window.MimeTypeArray;
const originalMimeType = window.MimeType;

// Fix Symbol.toStringTag for proper Object.prototype.toString.call()
try {{
    if (originalPluginArray && originalPluginArray.prototype) {{
        Object.defineProperty(originalPluginArray.prototype, Symbol.toStringTag, {{
            value: 'PluginArray',
            configurable: true
        }});
    }}
}} catch(e) {{}}

try {{
    if (originalPlugin && originalPlugin.prototype) {{
        Object.defineProperty(originalPlugin.prototype, Symbol.toStringTag, {{
            value: 'Plugin',
            configurable: true
        }});
    }}
}} catch(e) {{}}

try {{
    if (originalMimeTypeArray && originalMimeTypeArray.prototype) {{
        Object.defineProperty(originalMimeTypeArray.prototype, Symbol.toStringTag, {{
            value: 'MimeTypeArray',
            configurable: true
        }});
    }}
}} catch(e) {{}}

try {{
    if (originalMimeType && originalMimeType.prototype) {{
        Object.defineProperty(originalMimeType.prototype, Symbol.toStringTag, {{
            value: 'MimeType',
            configurable: true
        }});
    }}
}} catch(e) {{}}

// ============================================
// PLUGINS (app-min.js iterates through item(r))
// Use original prototypes!
// ============================================

// Create MimeType with proper prototype
const createMimeType = (type, suffixes, description, enabledPlugin) => {{
    const mt = Object.create(originalMimeType ? originalMimeType.prototype : Object.prototype);
    Object.defineProperties(mt, {{
        type: {{ value: type, enumerable: true }},
        suffixes: {{ value: suffixes, enumerable: true }},
        description: {{ value: description, enumerable: true }},
        enabledPlugin: {{ value: enabledPlugin, enumerable: true }}
    }});
    return mt;
}};

// Create Plugin with proper prototype
const createPlugin = (name, filename, description, mimeTypes = []) => {{
    const plugin = Object.create(originalPlugin ? originalPlugin.prototype : Object.prototype);
    
    Object.defineProperties(plugin, {{
        name: {{ value: name, enumerable: true }},
        filename: {{ value: filename, enumerable: true }},
        description: {{ value: description, enumerable: true }},
        version: {{ value: '', enumerable: true }},
        length: {{ value: mimeTypes.length, enumerable: true }}
    }});
    
    // Add methods
    plugin.item = function(i) {{ return mimeTypes[i]; }};
    plugin.namedItem = function(n) {{ return mimeTypes.find(m => m.type === n); }};
    plugin[Symbol.iterator] = function* () {{
        for (let i = 0; i < mimeTypes.length; i++) yield mimeTypes[i];
    }};
    
    // Add indexed access
    mimeTypes.forEach((mt, i) => {{
        Object.defineProperty(plugin, i, {{ value: mt, enumerable: true }});
    }});
    
    return plugin;
}};

// Create PDF MimeType
const pdfMimeType = createMimeType('application/pdf', 'pdf', 'Portable Document Format', null);

// Create plugins
const plugin1 = createPlugin('Chrome PDF Plugin', 'internal-pdf-viewer', 'Portable Document Format', [pdfMimeType]);
const plugin2 = createPlugin('Chrome PDF Viewer', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', '', [pdfMimeType]);
const plugin3 = createPlugin('Native Client', 'internal-nacl-plugin', '', []);

// Update enabledPlugin
Object.defineProperty(pdfMimeType, 'enabledPlugin', {{ value: plugin1, enumerable: true }});

const fakePlugins = [plugin1, plugin2, plugin3];

// Create PluginArray with proper prototype
const pluginArray = Object.create(originalPluginArray ? originalPluginArray.prototype : Object.prototype);

Object.defineProperty(pluginArray, 'length', {{ value: fakePlugins.length, enumerable: true }});

pluginArray.item = function(i) {{ return fakePlugins[i]; }};
pluginArray.namedItem = function(name) {{ return fakePlugins.find(p => p.name === name); }};
pluginArray.refresh = function() {{}};
pluginArray[Symbol.iterator] = function* () {{
    for (let i = 0; i < fakePlugins.length; i++) yield fakePlugins[i];
}};

fakePlugins.forEach((p, i) => {{
    Object.defineProperty(pluginArray, i, {{ value: p, enumerable: true }});
}});

Object.defineProperty(navigator, 'plugins', {{
    get: () => pluginArray,
    configurable: true
}});

// ============================================
// MIME TYPES with proper prototype
// ============================================
const mimeTypeArray = Object.create(originalMimeTypeArray ? originalMimeTypeArray.prototype : Object.prototype);

Object.defineProperty(mimeTypeArray, 'length', {{ value: 1, enumerable: true }});
Object.defineProperty(mimeTypeArray, 0, {{ value: pdfMimeType, enumerable: true }});

mimeTypeArray.item = function(i) {{ return i === 0 ? pdfMimeType : undefined; }};
mimeTypeArray.namedItem = function(name) {{ return name === 'application/pdf' ? pdfMimeType : undefined; }};
mimeTypeArray[Symbol.iterator] = function* () {{ yield pdfMimeType; }};

Object.defineProperty(navigator, 'mimeTypes', {{
    get: () => mimeTypeArray,
    configurable: true
}});

// ============================================
// PERMISSIONS API FIX
// Headless browsers often have 'denied' for notifications
// ============================================
if (navigator.permissions && navigator.permissions.query) {{
    const originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(params) {{
        // For notifications return 'prompt' instead of 'denied'
        if (params.name === 'notifications') {{
            return Promise.resolve({{
                state: 'prompt',
                onchange: null,
                addEventListener: function() {{}},
                removeEventListener: function() {{}},
                dispatchEvent: function() {{ return true; }}
            }});
        }}
        return originalQuery(params);
    }};
}}

// Also spoof Notification.permission
try {{
    Object.defineProperty(Notification, 'permission', {{
        get: () => 'default',
        configurable: true
    }});
}} catch(e) {{}}

// ============================================
// JS CAPABILITIES
// Amazon checks: audio, video, geolocation, localStorage, touch, webWorker
// ============================================

// 1. Audio/Video canPlayType should return proper values
const audioElement = document.createElement('audio');
const videoElement = document.createElement('video');

if (!audioElement.canPlayType) {{
    HTMLAudioElement.prototype.canPlayType = function(type) {{
        const supported = {{
            'audio/mpeg': 'probably',
            'audio/mp3': 'probably',
            'audio/ogg': 'probably',
            'audio/wav': 'probably',
            'audio/webm': 'probably',
            'audio/aac': 'probably',
            'audio/mp4': 'probably'
        }};
        return supported[type.split(';')[0]] || '';
    }};
}}

if (!videoElement.canPlayType) {{
    HTMLVideoElement.prototype.canPlayType = function(type) {{
        const supported = {{
            'video/mp4': 'probably',
            'video/webm': 'probably',
            'video/ogg': 'probably',
            'video/mpeg': 'probably'
        }};
        return supported[type.split(';')[0]] || '';
    }};
}}

// 2. Ensure localStorage is available
if (!window.localStorage) {{
    try {{
        Object.defineProperty(window, 'localStorage', {{
            value: {{
                getItem: () => null,
                setItem: () => {{}},
                removeItem: () => {{}},
                clear: () => {{}},
                length: 0
            }},
            configurable: true
        }});
    }} catch(e) {{}}
}}

// 3. Touch - DON'T add ontouchend for desktop
// Amazon checks 'ontouchend' in window
// For desktop this should be false
if ('ontouchend' in window && !navigator.maxTouchPoints) {{
    try {{
        delete window.ontouchend;
    }} catch(e) {{}}
}}

// 4. Geolocation should exist
if (!navigator.geolocation) {{
    Object.defineProperty(navigator, 'geolocation', {{
        value: {{
            getCurrentPosition: (success, error) => {{
                if (error) error({{ code: 1, message: 'Permission denied' }});
            }},
            watchPosition: () => 0,
            clearWatch: () => {{}}
        }},
        configurable: true
    }});
}}
''')
