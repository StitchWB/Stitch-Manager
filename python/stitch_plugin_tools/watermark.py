"""Per-variant honeypot selector watermarking (plan §3.2 item 7).

The publish pipeline generates N package variants.  Each variant gets a
unique honeypot ``SelectorCandidate`` injected into up to 5 steps that
already carry ``selector_candidates``.  The candidate is schema-valid
(``{kind, value, weight}``), minimal weight (0.01 — never selected by the
engine), and embeds a marker string ``hp-<plugin>-<ver>-<idx>-<8 hex>`` in
a plausible-looking CSS attribute selector value.

The injection is deterministic per ``(plugin_id, version, variant_idx)``:
``random.Random`` is seeded with a sha256 of those three values, so the
same variant always gets the same marker and the same step selection.
This lets the server identify which variant (and thus which token) a
leaked scenario.json originated from, by grepping for the marker.

The watermark does NOT change the client protocol: the scenario still
parses cleanly via ``parse_scenario_v2``, the manifest still validates via
``validate_manifest``, and the package is signed normally with the offline
ed25519 key.  The client sees a normally-signed zip — it has no idea a
honeypot candidate is sitting at weight 0.01 in a few steps.
"""

from __future__ import annotations

import hashlib
import json
import random
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

# Maximum number of steps to inject the honeypot into.
_MAX_INJECT_STEPS = 5

# Honeypot candidate weight — minimal so the engine never selects it.
_HP_WEIGHT = 0.01


def _seed_hash(plugin_id: str, version: str, variant_idx: int) -> int:
    """Return a deterministic int seed from (plugin_id, version, variant_idx)."""
    raw = f"{plugin_id}\0{version}\0{variant_idx}"
    return int(hashlib.sha256(raw.encode("utf-8")).hexdigest(), 16)


def _marker(plugin_id: str, version: str, variant_idx: int) -> str:
    """Return the honeypot marker string ``hp-<plugin>-<ver>-<idx>-<8hex>``.

    The 8-hex suffix is derived from the seed so it is deterministic per
    variant but unique across variants.
    """
    seed = _seed_hash(plugin_id, version, variant_idx)
    suffix = f"{seed & 0xFFFFFFFF:08x}"
    # Sanitize plugin_id and version for CSS-class-safe characters.
    safe_plugin = plugin_id.replace("_", "-")
    safe_version = version.replace(".", "-").replace("+", "-")
    return f"hp-{safe_plugin}-{safe_version}-{variant_idx}-{suffix}"


def _honeypot_candidate(plugin_id: str, version: str, variant_idx: int) -> dict[str, Any]:
    """Build a schema-valid SelectorCandidate with the honeypot marker.

    The value is a CSS attribute selector that looks plausible but will
    never match a real element: ``[data-stitch="<marker>"]``.
    """
    marker = _marker(plugin_id, version, variant_idx)
    return {
        "kind": "css",
        "value": f'[data-stitch="{marker}"]',
        "weight": _HP_WEIGHT,
    }


def inject_watermark(
    package_dir: Path,
    *,
    plugin_id: str,
    version: str,
    variant_idx: int,
) -> bool:
    """Inject the honeypot candidate into the package's scenario.json.

    Reads ``scenario.json`` from ``package_dir``, finds steps with non-empty
    ``selector_candidates``, picks up to ``_MAX_INJECT_STEPS`` of them
    (deterministic via seeded RNG), appends the honeypot candidate to each,
    and writes the modified scenario back.

    Returns ``True`` if the scenario was modified, ``False`` if the scenario
    has no steps with selector_candidates (nothing to watermark).
    """
    scenario_path = package_dir / "scenario.json"
    if not scenario_path.is_file():
        return False

    raw = json.loads(scenario_path.read_text(encoding="utf-8"))
    steps = raw.get("steps")
    if not isinstance(steps, list):
        return False

    # Collect indices of steps that have non-empty selector_candidates.
    candidate_steps = [
        i
        for i, s in enumerate(steps)
        if isinstance(s, dict)
        and isinstance(s.get("selector_candidates"), list)
        and len(s["selector_candidates"]) > 0
    ]
    if not candidate_steps:
        return False

    rng = random.Random(_seed_hash(plugin_id, version, variant_idx))
    # Pick up to _MAX_INJECT_STEPS steps deterministically.
    n_pick = min(_MAX_INJECT_STEPS, len(candidate_steps))
    chosen = rng.sample(candidate_steps, n_pick)

    hp = _honeypot_candidate(plugin_id, version, variant_idx)
    for idx in chosen:
        steps[idx]["selector_candidates"].append(dict(hp))

    raw["steps"] = steps
    scenario_path.write_text(
        json.dumps(raw, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return True


def marker_for(plugin_id: str, version: str, variant_idx: int) -> str:
    """Return the honeypot marker string for a variant (for test assertions)."""
    return _marker(plugin_id, version, variant_idx)
