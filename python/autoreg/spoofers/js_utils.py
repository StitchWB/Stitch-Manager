"""
JavaScript utility functions for spoofer modules

Provides helper functions to generate common JavaScript patterns:
- IIFE wrapping
- Object.defineProperty generation
- Try-catch wrapping
- PRNG (Mulberry32) for consistent noise
"""


def wrap_iife(code: str) -> str:
    """
    Wrap JavaScript code in an IIFE (Immediately Invoked Function Expression)

    Args:
        code: JavaScript code to wrap

    Returns:
        Code wrapped in (function() { 'use strict'; ... })();
    """
    return f"""(function() {{
    'use strict';

{code}
}})();"""


def define_property(obj: str, prop: str, value: str, enumerable: bool = True, configurable: bool = True) -> str:
    """
    Generate Object.defineProperty call

    Args:
        obj: Object name (e.g., 'navigator', 'screen')
        prop: Property name (e.g., 'platform', 'width')
        value: Property value as JavaScript expression (e.g., "'Win32'", "1920")
        enumerable: Whether property is enumerable
        configurable: Whether property is configurable

    Returns:
        Object.defineProperty JavaScript code
    """
    return f"""Object.defineProperty({obj}, '{prop}', {{
    get: () => {value},
    enumerable: {str(enumerable).lower()},
    configurable: {str(configurable).lower()}
}});"""


def define_properties(obj: str, props_dict: dict, enumerable: bool = True, configurable: bool = True) -> str:
    """
    Generate multiple Object.defineProperty calls

    Args:
        obj: Object name
        props_dict: Dictionary of {property_name: value_expression}
        enumerable: Whether properties are enumerable
        configurable: Whether properties are configurable

    Returns:
        Multiple Object.defineProperty calls joined with newlines
    """
    return '\n'.join(
        define_property(obj, prop, value, enumerable, configurable)
        for prop, value in props_dict.items()
    )


def safe_try_catch(code: str, error_handler: str = "{}") -> str:
    """
    Wrap code in try-catch block

    Args:
        code: JavaScript code to wrap
        error_handler: Code to execute in catch block (default: empty)

    Returns:
        Code wrapped in try { ... } catch(e) { ... }
    """
    return f"""try {{
{code}
}} catch(e) {{
{error_handler}
}}"""


def mulberry32_prng(seed_var: str = "NOISE_SEED") -> str:
    """
    Generate Mulberry32 PRNG implementation

    Args:
        seed_var: Name of the seed variable

    Returns:
        JavaScript code for Mulberry32 PRNG
    """
    return f"""// Mulberry32 PRNG for consistent noise
const mulberry32 = (seed) => {{
    return () => {{
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }};
}};
const rng = mulberry32({seed_var});"""


def add_noise_function() -> str:
    """
    Generate addNoise helper function for element metrics

    Returns:
        JavaScript function that adds micro-noise to values
    """
    return """const addNoise = (value) => {
    if (typeof value !== 'number') return value;
    const noise = (rng() - 0.5) * 0.001; // +/- 0.0005
    return value + noise;
};"""
