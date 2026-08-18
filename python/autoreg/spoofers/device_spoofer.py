"""
Consolidated Device Spoofer

Combines:
- battery.py: Battery API spoofing
- network.py: Network Information API spoofing
- sensors.py: Device sensors (motion, orientation) spoofing
"""

from .base import BaseSpoofModule
from .js_utils import wrap_iife


class DeviceSpoofModule(BaseSpoofModule):
    """Consolidated device hardware spoofing"""

    name = "device"
    description = "Spoof battery, network, and sensor APIs"

    def get_js(self) -> str:
        return wrap_iife('''
// ============================================
// BATTERY API
// Return fake battery data
// ============================================
if (navigator.getBattery) {
    const fakeBattery = {
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1.0,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true
    };

    navigator.getBattery = () => Promise.resolve(fakeBattery);
}

// ============================================
// NETWORK INFORMATION API
// Spoof navigator.connection
// ============================================
const fakeConnection = {
    effectiveType: '4g',
    rtt: 50,
    downlink: 10,
    saveData: false,
    addEventListener: () => {},
    removeEventListener: () => {}
};

Object.defineProperty(navigator, 'connection', {
    get: () => fakeConnection,
    configurable: true
});

// Also for webkit
Object.defineProperty(navigator, 'webkitConnection', {
    get: () => fakeConnection,
    configurable: true
});

// ============================================
// DEVICE SENSORS
// Block DeviceMotionEvent and DeviceOrientationEvent
// ============================================

// Block DeviceMotionEvent
if (typeof DeviceMotionEvent !== 'undefined') {
    Object.defineProperty(DeviceMotionEvent, 'requestPermission', {
        value: () => Promise.resolve('denied'),
        configurable: true
    });
}

// Block DeviceOrientationEvent
if (typeof DeviceOrientationEvent !== 'undefined') {
    Object.defineProperty(DeviceOrientationEvent, 'requestPermission', {
        value: () => Promise.resolve('denied'),
        configurable: true
    });
}

// Return null for events
window.addEventListener('devicemotion', (e) => e.stopImmediatePropagation(), true);
window.addEventListener('deviceorientation', (e) => e.stopImmediatePropagation(), true);
''')
