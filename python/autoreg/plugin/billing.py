"""Billing-skip helpers for the plugin provider adapter."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..scenario.schema import ScenarioV2


def _should_skip_billing(kwargs: dict[str, Any]) -> bool:
    """Check if billing should be skipped (env var or kwargs flag)."""
    return (
        os.environ.get("KIRO_SKIP_BILLING", "0") == "1"
        or os.environ.get("KIRO_V2_SKIP_BILLING", "0") == "1"
        or bool(kwargs.get("skipBilling") or kwargs.get("skip_billing"))
    )


def _strip_billing_steps(scenario: ScenarioV2) -> ScenarioV2:
    """Remove stripe.fill_checkout steps from a scenario (billing skip)."""
    from dataclasses import replace

    filtered = [s for s in scenario.steps if s.kind != "stripe.fill_checkout"]
    if len(filtered) == len(scenario.steps):
        return scenario
    return replace(scenario, steps=filtered)
