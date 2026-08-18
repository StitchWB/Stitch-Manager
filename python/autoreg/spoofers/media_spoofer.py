"""
Consolidated Media Spoofer

Combines:
- audio.py: AudioContext fingerprint spoofing
- media.py: MediaDevices enumeration spoofing
"""

from .base import BaseSpoofModule
from .js_utils import mulberry32_prng, wrap_iife


class MediaSpoofModule(BaseSpoofModule):
    """Consolidated audio and media devices spoofing"""

    name = "media"
    description = "Spoof AudioContext and MediaDevices"

    def get_js(self) -> str:
        p = self.profile

        return wrap_iife(f'''
const NOISE_SEED = {p.noise_seed};

{mulberry32_prng()}

// ============================================
// AUDIOCONTEXT SPOOFING
// Add noise to AudioContext to change audio fingerprint
// ============================================
if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {{
    const AC = AudioContext || webkitAudioContext;
    const originalGetChannelData = AudioBuffer.prototype.getChannelData;

    AudioBuffer.prototype.getChannelData = function(channel) {{
        const data = originalGetChannelData.call(this, channel);

        // Add minimal noise to first 100 samples
        for (let i = 0; i < Math.min(data.length, 100); i++) {{
            data[i] += (rng() - 0.5) * 0.0001;
        }}

        return data;
    }};

    // Spoof createAnalyser
    const originalCreateAnalyser = AC.prototype.createAnalyser;
    AC.prototype.createAnalyser = function() {{
        const analyser = originalCreateAnalyser.call(this);
        const originalGetFloatFrequencyData = analyser.getFloatFrequencyData.bind(analyser);

        analyser.getFloatFrequencyData = function(array) {{
            originalGetFloatFrequencyData(array);
            for (let i = 0; i < Math.min(array.length, 10); i++) {{
                array[i] += (rng() - 0.5) * 0.1;
            }}
        }};

        return analyser;
    }};
}}

// ============================================
// MEDIADEVICES ENUMERATION
// Return realistic device data
// ============================================
if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {{
    const originalEnumerate = navigator.mediaDevices.enumerateDevices;

    const mockDevices = [
        {{
            deviceId: "",
            kind: "audioinput",
            label: "Internal Microphone",
            groupId: "mock-group-1"
        }},
        {{
            deviceId: "",
            kind: "videoinput",
            label: "Integrated Camera",
            groupId: "mock-group-2"
        }},
        {{
            deviceId: "",
            kind: "audiooutput",
            label: "Internal Speakers",
            groupId: "mock-group-1"
        }}
    ];

    navigator.mediaDevices.enumerateDevices = function() {{
        return Promise.resolve(mockDevices);
    }};
}}
''')
