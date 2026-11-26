"""Evidence-derived model quality tier helpers for rb/* chain refill.

Tier assignment is deliberately probe-evidence-dominant.  Model-name hints may
order the cheap candidate probe queue, but they never admit a model here: the
inputs are only exact-probe coherence, the level-2 instruction-following
canary, measured latency, and usage-accounting sanity.
"""

from __future__ import annotations

from collections.abc import Mapping

# Latency boundaries are policy constants, not measurements.  They mirror the
# rb/* latency-contract scale: a model slower than the mid/strong control-plane
# budget can still be valuable as a final emergency tail, but must not occupy a
# nominal tier merely because it is coherent.
EVIDENCE_STRONG_MAX_LATENCY_MS = 45_000
EVIDENCE_MID_MAX_LATENCY_MS = 50_000
EVIDENCE_FAST_MAX_LATENCY_MS = 30_000

TIER_RANKS = {"fast": 1, "mid": 2, "strong": 3}


def derive_evidence_tier(
    *,
    coherence_passed: bool,
    level2_passed: bool | None,
    latency_ms: int | None,
    usage_sane: bool | None,
) -> str | None:
    """Derive the evidence tier for one upstream model.

    ``strong`` requires the level-2 instruction-following canary, sane usage
    accounting, and latency inside the strong-role budget.  Fabricated usage is
    a supplier-integrity red flag that vetoes only ``strong`` admission; it does
    not contradict coherence and therefore does not veto fast/mid rescue use.
    A coherent but slow model is never discarded: it becomes ``emergency_tail``.
    """
    if not coherence_passed:
        return None
    if latency_ms is None:
        # Coherence without usable latency is still evidence, but conservatively
        # treats the model as a tail rather than as a preferred tier candidate.
        return "emergency_tail"
    if latency_ms > EVIDENCE_MID_MAX_LATENCY_MS:
        return "emergency_tail"
    if (
        level2_passed is True
        and usage_sane is not False
        and latency_ms <= EVIDENCE_STRONG_MAX_LATENCY_MS
    ):
        return "strong"
    if level2_passed is True and latency_ms <= EVIDENCE_MID_MAX_LATENCY_MS:
        return "mid"
    if latency_ms <= EVIDENCE_FAST_MAX_LATENCY_MS:
        return "fast"
    return "mid"


def tier_rank(tier: str | None) -> int:
    """Capability rank used for minimum-tier role matching."""
    if tier is None or tier == "emergency_tail":
        return 0
    return TIER_RANKS.get(tier, 0)


# Display states for operator-facing trust labeling.  The labels are
# deliberately observability vocabulary, not routing vocabulary: trust never
# gates or demotes anything by itself.
TRUST_VERIFIED_COHERENT = "verified_coherent"
TRUST_UNTESTED = "untested"
TRUST_DEGRADED = "degraded"
TRUST_USAGE_FABRICATION_SUSPECT = "usage_fabrication_suspect"


def derive_trust_state(caps: Mapping[str, object] | None) -> str:
    """Derive the operator-facing trust display state for one upstream model.

    Consumes only the capability keys written by exact-probe evidence merges
    (``_merge_probe_capabilities``).  Priority order:

    1. negative semantic/verification evidence → ``degraded``
    2. fabricated usage arithmetic on a coherent model →
       ``usage_fabrication_suspect`` (the more specific, more alarming signal
       wins over the generic coherent label)
    3. positive coherence evidence → ``verified_coherent``
    4. no probe evidence at all → ``untested``
    """
    if not isinstance(caps, Mapping):
        return TRUST_UNTESTED
    if caps.get("coherence_passed") is False or caps.get("verification_status") == "failed":
        return TRUST_DEGRADED
    if caps.get("usage_sane") is False:
        return TRUST_USAGE_FABRICATION_SUSPECT
    if caps.get("coherence_passed") is True:
        return TRUST_VERIFIED_COHERENT
    return TRUST_UNTESTED
