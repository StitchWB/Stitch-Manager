"""Entry-file loading and plan §8 override channels for PluginScenarioProvider."""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from ..scenario.parse_v2 import parse_scenario_v2
from ..scenario.schema import SelectorCandidate

if TYPE_CHECKING:
    from ..scenario.schema import ScenarioStep
    from .provider_adapter import PluginScenarioProvider

logger = logging.getLogger("autoreg.plugin.provider_adapter")


def load_entry_files(self: PluginScenarioProvider) -> None:
    """Read scenario / selectors / profile from the package dir.

    Scenario parse failures propagate (so the dispatch can fall back
    to built-in).  Selectors/profile failures are non-fatal warnings.
    """
    entry = self._manifest.entry

    # scenario parse failure propagates so the dispatch can fall back to built-in (plan §3.3 decision 9)
    scenario_rel = entry.get("scenario", "scenario.json")
    scenario_path = self._package_dir / scenario_rel
    scenario_raw = json.loads(scenario_path.read_text(encoding="utf-8"))
    self._scenario = parse_scenario_v2(scenario_raw)

    # merge selectors_overlay.json into the scenario, replacing per-step selector candidates (plan §8)
    self._apply_selector_overlay()

    # apply a user-edited override scenario from <data_dir>/overrides/<manifest.id>/ when present (plan §8 v1.1)
    self._apply_local_override()

    # selectors.json is read for the selector-pack channel; inline scenario candidates stay primary in v1
    selectors_rel = entry.get("selectors", "selectors.json")
    selectors_path = self._package_dir / selectors_rel
    if selectors_path.is_file():
        try:
            self._selectors = json.loads(
                selectors_path.read_text(encoding="utf-8")
            )
        except (OSError, ValueError):
            logger.warning(
                "selectors.json unreadable in %s", self._package_dir
            )

    # profile.json holds spoofer persona hints; read for future use, not applied in v1
    profile_rel = entry.get("profile", "profile.json")
    profile_path = self._package_dir / profile_rel
    if profile_path.is_file():
        try:
            self._profile = json.loads(
                profile_path.read_text(encoding="utf-8")
            )
        except (OSError, ValueError):
            logger.warning(
                "profile.json unreadable in %s", self._package_dir
            )


def apply_selector_overlay(self: PluginScenarioProvider) -> None:
    """Merge ``selectors_overlay.json`` into the parsed scenario (plan §8).

    Overlay shape: ``{step_id: [{kind, value, weight?}, ...]}``.  For each
    step id present in the overlay, the scenario step's
    ``selector_candidates`` are REPLACED with the overlay list.  Steps
    absent from the overlay keep their inline candidates.  Invalid
    candidate entries (missing kind or value) are skipped with a warning;
    if a step's overlay list has zero valid candidates, that step's
    override is skipped entirely (inline candidates kept).

    Parse failure of the overlay file is non-fatal — the scenario is
    left with its inline candidates and a warning is logged.
    """
    if self._scenario is None:
        return
    overlay_path = self._package_dir / "selectors_overlay.json"
    if not overlay_path.is_file():
        return
    try:
        overlay_raw = json.loads(overlay_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning(
            "selectors_overlay.json unreadable in %s: %s",
            self._package_dir, exc,
        )
        return
    if not isinstance(overlay_raw, dict) or not overlay_raw:
        return

    from dataclasses import replace

    new_steps: list[ScenarioStep] = []
    for step in self._scenario.steps:
        override = overlay_raw.get(step.id)
        if not isinstance(override, list):
            new_steps.append(step)
            continue

        candidates: list[SelectorCandidate] = []
        for idx, item in enumerate(override):
            cand = _parse_overlay_candidate(item, step.id, idx)
            if cand is None:
                continue
            candidates.append(cand)

        if not candidates:
            logger.warning(
                "overlay for step %s has zero valid candidates — "
                "keeping inline candidates",
                step.id,
            )
            new_steps.append(step)
            continue

        new_steps.append(
            replace(step, selector_candidates=candidates)
        )

    self._scenario = replace(self._scenario, steps=new_steps)


def apply_local_override(self: PluginScenarioProvider) -> None:
    """Apply a user-edited local override scenario (plan §8 v1.1).

    If ``<data_dir>/overrides/<manifest.id>/scenario.json`` exists AND
    parses → replace ``self._scenario`` with the override and mark
    provenance ``"override"``.  Parse failure → warn + keep package
    scenario (provenance stays ``"package"``).  No override file →
    no-op.
    """
    if self._scenario is None:
        return
    from .layout import _base_dir

    override_path = _base_dir() / "overrides" / self._manifest.id / "scenario.json"
    if not override_path.is_file():
        return
    try:
        override_raw = json.loads(override_path.read_text(encoding="utf-8"))
        override_scenario = parse_scenario_v2(override_raw)
    except (OSError, ValueError) as exc:
        logger.warning(
            "override scenario for %s unreadable at %s: %s — keeping package scenario",
            self._manifest.id, override_path, exc,
        )
        return
    self._scenario = override_scenario
    self._scenario_source = "override"
    logger.warning("override active for %s", self._manifest.id)


def _parse_overlay_candidate(
    item: Any, step_id: str, idx: int
) -> SelectorCandidate | None:
    """Parse one overlay candidate entry into a SelectorCandidate.

    Returns None (and logs a warning) when the entry is missing ``kind``
    or ``value`` — a tolerant variant of the ``parse_v2`` parse so one
    bad entry does not abort the whole merge.
    """
    if not isinstance(item, dict):
        logger.warning(
            "overlay step %s: candidate[%d] not a dict — skipped",
            step_id, idx,
        )
        return None
    value = item.get("value")
    if not isinstance(value, str):
        logger.warning(
            "overlay step %s: candidate[%d] missing string 'value' — skipped",
            step_id, idx,
        )
        return None
    kind = item.get("kind", "css")
    if not isinstance(kind, str):
        logger.warning(
            "overlay step %s: candidate[%d] 'kind' not a string — skipped",
            step_id, idx,
        )
        return None
    weight = item.get("weight", 1.0)
    if not isinstance(weight, int | float) or isinstance(weight, bool):
        weight = 1.0
    return SelectorCandidate(kind=kind, value=value, weight=float(weight))
