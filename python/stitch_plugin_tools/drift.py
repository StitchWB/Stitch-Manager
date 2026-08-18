"""``drift`` CLI subcommand — v1.1 selector drift tooling (plan §3.4.11, §8).

Fetches /admin/drift from the server, prints a human-readable table of
failing steps, and produces a conservative rerank proposal: for each
failing step that exists in the package's ``scenario.json``, candidates
whose index never appears in the matched_candidate_histogram get their
weight multiplied by 0.5 (floor 0.1). The proposal is printed as a
unified diff; with ``--apply`` the updated scenario.json is written back
to ``--package-dir``.

The owner reviews the diff, then re-signs and re-publishes the package
via the existing ``sign`` + ``publish`` subcommands. This tool never
signs or publishes — it only proposes and (optionally) writes.
"""

from __future__ import annotations

import difflib
import json
import logging
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from collections.abc import Mapping

logger = logging.getLogger(__name__)

# Env var names — mirror publish.py conventions.
ENV_SERVER_URL = "STITCH_PUBLISH_URL"
ENV_ADMIN_KEY = "STITCH_ADMIN_KEY"

WEIGHT_HALVE_FACTOR = 0.5
WEIGHT_FLOOR = 0.1


# ── Config resolution ──────────────────────────────────────────────────────────


def resolve_drift_config(
    server_url: str | None,
    admin_key: str | None,
) -> tuple[str, str]:
    """Resolve server URL + admin key from CLI flags, then env vars.

    Raises ValueError if either cannot be resolved.
    """
    url = (server_url or os.environ.get(ENV_SERVER_URL, "")).strip()
    key = (admin_key or os.environ.get(ENV_ADMIN_KEY, "")).strip()
    if not url:
        raise ValueError(f"no server url (--server-url or {ENV_SERVER_URL})")
    if not key:
        raise ValueError(f"no admin key (--admin-key or {ENV_ADMIN_KEY})")
    return url, key


# ── Fetch ─────────────────────────────────────────────────────────────────────


async def fetch_drift(
    server_url: str,
    admin_key: str,
    *,
    plugin_id: str,
    version: str | None = None,
    window_hours: int | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """GET /admin/drift and return the parsed JSON response.

    Raises httpx.HTTPStatusError on non-2xx, httpx.HTTPError on transport
    failure.
    """
    params: dict[str, str] = {"plugin_id": plugin_id}
    if version is not None:
        params["version"] = version
    if window_hours is not None:
        params["window_hours"] = str(window_hours)

    url = f"{server_url.rstrip('/')}/admin/drift"
    headers = {"X-Admin-Key": admin_key}

    own_client = client is None
    http = client or httpx.AsyncClient(timeout=30.0)
    try:
        resp = await http.get(url, params=params, headers=headers)
        resp.raise_for_status()
        return resp.json()
    finally:
        if own_client:
            await http.aclose()


# ── Table printing ────────────────────────────────────────────────────────────


def print_drift_table(payload: Mapping[str, Any], *, file: Any = None) -> None:
    """Print a human-readable table of failing steps."""
    if file is None:
        file = sys.stdout
    groups = payload.get("groups", [])
    if not groups:
        print("No drift data for the given filters.", file=file)
        return

    window = payload.get("window_hours", "?")
    plugin = payload.get("plugin_filter") or "(all)"
    version = payload.get("version_filter") or "(all)"
    print(
        f"Drift report — plugin={plugin} version={version} window={window}h",
        file=file,
    )
    print(
        f"Total reports: {payload.get('total_reports', 0)}  "
        f"Corrupt skipped: {payload.get('corrupt_bundles_skipped', 0)}",
        file=file,
    )
    print(file=file)
    # Header
    print(
        f"{'STEP':<30} {'FAILS':>5}  {'TOP ERROR':<50} {'HISTOGRAM'}",
        file=file,
    )
    print("-" * 100, file=file)
    for g in groups:
        top_err = ""
        top_errors = g.get("top_errors", [])
        if top_errors:
            top_err = top_errors[0].get("error", "")[:50]
        hist = g.get("matched_candidate_histogram", {})
        hist_str = ", ".join(f"{k}:{v}" for k, v in sorted(hist.items()))
        print(
            f"{g['step']:<30} {g['fail_count']:>5}  {top_err:<50} {hist_str}",
            file=file,
        )


# ── Rerank proposal ───────────────────────────────────────────────────────────


def load_scenario(package_dir: Path) -> dict[str, Any]:
    """Load scenario.json from a package directory."""
    path = package_dir / "scenario.json"
    if not path.is_file():
        raise FileNotFoundError(f"scenario.json not found in {package_dir}")
    return json.loads(path.read_text(encoding="utf-8"))


def propose_rerank(
    scenario: dict[str, Any],
    drift_payload: Mapping[str, Any],
) -> tuple[dict[str, Any], str]:
    """Produce a reranked scenario and a unified diff string.

    For each failing step in drift_payload that exists in the scenario,
    candidates whose index never appears as a non-null key in the
    matched_candidate_histogram get weight * WEIGHT_HALVE_FACTOR
    (floor WEIGHT_FLOOR).

    Returns (new_scenario, diff_text). diff_text is empty if no changes.
    """
    new_scenario = json.loads(json.dumps(scenario))  # deep copy via JSON
    steps: list[dict[str, Any]] = new_scenario.get("steps", [])
    steps_by_id = {s.get("id"): s for s in steps if isinstance(s, dict)}

    for group in drift_payload.get("groups", []):
        step_id = group.get("step", "")
        if step_id not in steps_by_id:
            continue

        step = steps_by_id[step_id]
        candidates: list[dict[str, Any]] = step.get("selector_candidates", [])
        if not candidates:
            continue

        hist = group.get("matched_candidate_histogram", {})
        # Non-null keys = candidate indices that were tried/matched.
        tried_indices = {
            int(k) for k in hist if k != "null" and _is_int(k)
        }

        fail_count = group.get("fail_count", 0)
        if fail_count == 0:
            continue

        for idx, cand in enumerate(candidates):
            if idx in tried_indices:
                continue
            old_weight = cand.get("weight", 1.0)
            new_weight = max(old_weight * WEIGHT_HALVE_FACTOR, WEIGHT_FLOOR)
            if new_weight != old_weight:
                cand["weight"] = round(new_weight, 4)

    old_text = json.dumps(scenario, indent=2, ensure_ascii=False) + "\n"
    new_text = json.dumps(new_scenario, indent=2, ensure_ascii=False) + "\n"
    diff = "".join(
        difflib.unified_diff(
            old_text.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile="scenario.json (current)",
            tofile="scenario.json (proposed)",
        )
    )
    return new_scenario, diff


def _is_int(s: str) -> bool:
    try:
        int(s)
    except ValueError:
        return False
    return True


def apply_rerank(package_dir: Path, new_scenario: Mapping[str, Any]) -> Path:
    """Write the reranked scenario.json back to package_dir.

    Returns the path written. The owner must re-sign + re-publish.
    """
    path = package_dir / "scenario.json"
    path.write_text(
        json.dumps(new_scenario, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return path


# ── CLI entry ─────────────────────────────────────────────────────────────────


def run_drift(
    *,
    server_url: str | None,
    admin_key: str | None,
    plugin_id: str,
    version: str | None,
    window_hours: int | None,
    package_dir: str | None,
    apply: bool,
    client: httpx.AsyncClient | None = None,
) -> int:
    """Run the drift CLI: fetch, print, propose, optionally apply.

    Returns process exit code (0 success, 1 fetch error, 2 config error).
    """
    import asyncio

    try:
        url, key = resolve_drift_config(server_url, admin_key)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    async def _run() -> dict[str, Any]:
        return await fetch_drift(
            url,
            key,
            plugin_id=plugin_id,
            version=version,
            window_hours=window_hours,
            client=client,
        )

    try:
        payload = asyncio.run(_run())
    except httpx.HTTPStatusError as exc:
        print(
            f"error: drift fetch failed: "
            f"{exc.response.status_code} {exc.response.text}",
            file=sys.stderr,
        )
        return 1
    except httpx.HTTPError as exc:
        print(f"error: drift fetch failed: {exc}", file=sys.stderr)
        return 1

    print_drift_table(payload)

    if package_dir is None:
        return 0

    pkg = Path(package_dir)
    if not pkg.is_dir():
        print(f"error: package dir not found: {pkg}", file=sys.stderr)
        return 2

    try:
        scenario = load_scenario(pkg)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    new_scenario, diff = propose_rerank(scenario, payload)

    if not diff:
        print("\nNo rerank changes proposed (all candidates already tried).")
        return 0

    print("\n=== RERANK PROPOSAL (scenario.json diff) ===\n")
    print(diff, end="" if diff.endswith("\n") else "\n")

    if apply:
        path = apply_rerank(pkg, new_scenario)
        print(f"\nApplied rerank to {path}")
        print("Re-sign and re-publish with:")
        print(
            f"  python -m stitch_plugin_tools sign {pkg} "
            f"--key <private.key>"
        )
        print(
            f"  python -m stitch_plugin_tools publish {pkg} "
            f"--server-url {url} --admin-key <key>"
        )
    else:
        print("\nReview the diff above. Apply with --apply.")

    return 0
