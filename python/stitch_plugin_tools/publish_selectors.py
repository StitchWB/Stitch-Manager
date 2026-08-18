"""``publish-selectors`` CLI subcommand — v1.1 SELECTOR-PACK channel (plan §8).

Reads ``<package_dir>/scenario.json``, extracts per-step
``selector_candidates`` as an overlay ``{step_id: [candidates...]}``, and
POSTs it to ``POST /admin/selectors`` on the server.  The server stores
the overlay with a monotonic ``selectors_version`` per plugin@version and
the sha256 of the canonical-JSON payload; the manifest exposes the latest
pack's version + sha so clients can fetch a hot update WITHOUT a plugin
version bump.

This subcommand is the publish-side companion to ``drift --apply``: the
owner re-weights scenario.json locally (drift), then publishes the
selector overlay here (no re-sign, no plugin version bump, no package
re-upload).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from collections.abc import Mapping

# Env var names — mirror publish.py / drift.py conventions.
ENV_SERVER_URL = "STITCH_PUBLISH_URL"
ENV_ADMIN_KEY = "STITCH_ADMIN_KEY"


def resolve_publish_selectors_config(
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


def extract_overlay_from_scenario(scenario: Mapping[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Extract per-step selector_candidates from a scenario payload.

    Returns ``{step_id: [candidate, ...]}`` for every step that has a
    non-empty ``selector_candidates`` list.  Steps with no candidates are
    omitted (the client only overrides steps present in the overlay).
    """
    overlay: dict[str, list[dict[str, Any]]] = {}
    steps = scenario.get("steps", [])
    if not isinstance(steps, list):
        return overlay
    for step in steps:
        if not isinstance(step, dict):
            continue
        step_id = step.get("id")
        if not isinstance(step_id, str) or not step_id:
            continue
        candidates = step.get("selector_candidates")
        if not isinstance(candidates, list) or not candidates:
            continue
        # Keep only structurally valid candidate dicts (kind + value present).
        clean: list[dict[str, Any]] = []
        for cand in candidates:
            if not isinstance(cand, dict):
                continue
            if not isinstance(cand.get("value"), str):
                continue
            if not isinstance(cand.get("kind", "css"), str):
                continue
            clean.append(dict(cand))
        if clean:
            overlay[step_id] = clean
    return overlay


async def publish_selectors(
    *,
    server_url: str,
    admin_key: str,
    plugin_id: str,
    plugin_version: str,
    selectors: dict[str, list[dict[str, Any]]],
    note: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """POST /admin/selectors and return the parsed JSON response.

    Raises :class:`httpx.HTTPStatusError` on a non-2xx response and
    :class:`httpx.HTTPError` on transport failure.
    """
    url = f"{server_url.rstrip('/')}/admin/selectors"
    body: dict[str, Any] = {
        "plugin_id": plugin_id,
        "version": plugin_version,
        "selectors": selectors,
    }
    if note is not None:
        body["note"] = note
    headers = {"X-Admin-Key": admin_key}

    own_client = client is None
    http = client or httpx.AsyncClient(timeout=30.0)
    try:
        resp = await http.post(url, json=body, headers=headers)
        resp.raise_for_status()
        result: dict[str, Any] = resp.json()
        return result
    finally:
        if own_client:
            await http.aclose()


def run_publish_selectors(
    *,
    server_url: str | None,
    admin_key: str | None,
    plugin_id: str,
    plugin_version: str,
    package_dir: str,
    note: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> int:
    """Run the publish-selectors CLI.

    Returns process exit code (0 success, 1 fetch error, 2 config error).
    """
    import asyncio

    try:
        url, key = resolve_publish_selectors_config(server_url, admin_key)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    pkg = Path(package_dir)
    if not pkg.is_dir():
        print(f"error: package dir not found: {pkg}", file=sys.stderr)
        return 2

    scenario_path = pkg / "scenario.json"
    if not scenario_path.is_file():
        print(f"error: scenario.json not found in {pkg}", file=sys.stderr)
        return 2

    try:
        scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"error: cannot read scenario.json: {exc}", file=sys.stderr)
        return 2

    overlay = extract_overlay_from_scenario(scenario)
    if not overlay:
        print("error: no steps with selector_candidates found in scenario.json", file=sys.stderr)
        return 2

    async def _run() -> dict[str, Any]:
        return await publish_selectors(
            server_url=url,
            admin_key=key,
            plugin_id=plugin_id,
            plugin_version=plugin_version,
            selectors=overlay,
            note=note,
            client=client,
        )

    try:
        result = asyncio.run(_run())
    except httpx.HTTPStatusError as exc:
        print(
            f"error: publish-selectors failed: "
            f"{exc.response.status_code} {exc.response.text}",
            file=sys.stderr,
        )
        return 1
    except httpx.HTTPError as exc:
        print(f"error: publish-selectors failed: {exc}", file=sys.stderr)
        return 1

    print(
        f"published selectors for {result.get('plugin_id')}@{result.get('version')} "
        f"v{result.get('selectors_version')} sha={result.get('sha256', '')[:12]}..."
    )
    return 0
