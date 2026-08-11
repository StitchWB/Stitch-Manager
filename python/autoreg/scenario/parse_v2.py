"""Tolerant reader for server-pushed ScenarioV2 payloads (plan §3.1 item 1).

Forward-compatible by design:
- Unknown top-level fields and unknown step fields are silently ignored.
- Unknown step ``kind`` values are kept as ``noop`` steps with the original
  kind string preserved in ``meta["original_kind"]``; the execution layer
  treats ``noop`` as a skip-in-place.
- Only structurally malformed input raises :class:`ScenarioParseError`
  (steps not a list, a step missing id/kind, wrong types on known fields).
"""

from __future__ import annotations

from typing import Any, get_args

from .schema import ScenarioStep, ScenarioV2, SelectorCandidate, StepKind

_KNOWN_STEP_KINDS: frozenset[str] = frozenset(get_args(StepKind))


class ScenarioParseError(ValueError):
    """Raised when a scenario payload is structurally malformed."""


def parse_scenario_v2(payload: dict[str, Any]) -> ScenarioV2:
    """Parse a server-pushed scenario payload into :class:`ScenarioV2`.

    Tolerant of unknown fields and unknown step kinds; strict about
    structural requirements (steps must be a list, each step must carry
    id and kind, known fields must have the expected type).
    """
    if not isinstance(payload, dict):
        raise ScenarioParseError("scenario payload must be a dict")

    version = payload.get("version")
    if version is None:
        version = 2
    elif not _is_int(version):
        raise ScenarioParseError("scenario 'version' must be an int")

    name = payload.get("name")
    if name is None:
        name = "scenario"
    elif not isinstance(name, str):
        raise ScenarioParseError("scenario 'name' must be a string")

    created_at = payload.get("created_at")
    if created_at is None:
        created_at = ""
    elif not isinstance(created_at, str):
        raise ScenarioParseError("scenario 'created_at' must be a string")

    steps_in = payload.get("steps")
    if steps_in is None:
        steps_in = []
    elif not isinstance(steps_in, list):
        raise ScenarioParseError("scenario 'steps' must be a list")

    steps = [_parse_step(raw, i) for i, raw in enumerate(steps_in)]

    return ScenarioV2(version=version, name=name, created_at=created_at, steps=steps)


def _parse_step(raw: Any, index: int) -> ScenarioStep:
    if not isinstance(raw, dict):
        raise ScenarioParseError(
            f"step {index}: must be a dict, got {type(raw).__name__}"
        )

    step_id = _require_str(raw, "id", index)
    kind_raw = _require_str(raw, "kind", index)
    kind = kind_raw.strip().lower()

    tab_id = raw.get("tab_id")
    if tab_id is None:
        tab_id = "main"
    elif not isinstance(tab_id, str):
        raise ScenarioParseError(f"step {index}: 'tab_id' must be a string")

    sensitive = raw.get("sensitive")
    if sensitive is None:
        sensitive = False
    elif not isinstance(sensitive, bool):
        raise ScenarioParseError(f"step {index}: 'sensitive' must be a bool")

    meta_raw = raw.get("meta")
    if meta_raw is not None and not isinstance(meta_raw, dict):
        raise ScenarioParseError(f"step {index}: 'meta' must be a dict")
    meta: dict[str, Any] | None = dict(meta_raw) if isinstance(meta_raw, dict) else None

    if kind not in _KNOWN_STEP_KINDS:
        # Unknown kind → noop, preserve the original kind string for debugging.
        meta = {**(meta or {}), "original_kind": kind_raw}
        return ScenarioStep(
            id=step_id,
            tab_id=tab_id,
            kind="noop",
            selector_candidates=[],
            sensitive=sensitive,
            meta=meta,
        )

    selector_candidates = _parse_selector_candidates(
        raw.get("selector_candidates"), raw.get("selector"), index
    )

    value = raw.get("value")
    if value is not None and not isinstance(value, str):
        raise ScenarioParseError(f"step {index}: 'value' must be a string or null")

    url = raw.get("url")
    if url is not None and not isinstance(url, str):
        raise ScenarioParseError(f"step {index}: 'url' must be a string or null")

    timeout_ms = raw.get("timeout_ms")
    if timeout_ms is None:
        timeout_ms = 15000
    elif not _is_int(timeout_ms):
        raise ScenarioParseError(f"step {index}: 'timeout_ms' must be an int")

    retry = raw.get("retry")
    if retry is None:
        retry = 0
    elif not _is_int(retry):
        raise ScenarioParseError(f"step {index}: 'retry' must be an int")

    return ScenarioStep(
        id=step_id,
        tab_id=tab_id,
        kind=kind,  # type: ignore[arg-type]
        selector_candidates=selector_candidates,
        value=value,
        url=url,
        timeout_ms=timeout_ms,
        retry=retry,
        sensitive=sensitive,
        meta=meta,
    )


def _parse_selector_candidates(
    raw: Any, legacy_selector: Any, index: int
) -> list[SelectorCandidate]:
    candidates: list[SelectorCandidate] = []

    if raw is not None:
        if not isinstance(raw, list):
            raise ScenarioParseError(
                f"step {index}: 'selector_candidates' must be a list"
            )
        for j, item in enumerate(raw):
            candidates.append(_parse_selector_candidate(item, index, j))

    if not candidates and isinstance(legacy_selector, str) and legacy_selector.strip():
        candidates.append(
            SelectorCandidate(kind="css", value=legacy_selector.strip(), weight=1.0)
        )

    return candidates


def _parse_selector_candidate(
    item: Any, step_index: int, cand_index: int
) -> SelectorCandidate:
    if not isinstance(item, dict):
        raise ScenarioParseError(
            f"step {step_index}: selector_candidates[{cand_index}] must be a dict"
        )

    value = item.get("value")
    if not isinstance(value, str):
        raise ScenarioParseError(
            f"step {step_index}: selector_candidates[{cand_index}] "
            "missing string 'value'"
        )

    kind = item.get("kind", "css")
    if not isinstance(kind, str):
        raise ScenarioParseError(
            f"step {step_index}: selector_candidates[{cand_index}] "
            "'kind' must be a string"
        )

    weight = item.get("weight", 1.0)
    if not isinstance(weight, int | float) or isinstance(weight, bool):
        raise ScenarioParseError(
            f"step {step_index}: selector_candidates[{cand_index}] "
            "'weight' must be a number"
        )

    return SelectorCandidate(kind=kind, value=value, weight=float(weight))


def _require_str(raw: dict[str, Any], field: str, index: int) -> str:
    value = raw.get(field)
    if value is None:
        raise ScenarioParseError(f"step {index}: missing '{field}'")
    if not isinstance(value, str):
        raise ScenarioParseError(f"step {index}: '{field}' must be a string")
    return value


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)
