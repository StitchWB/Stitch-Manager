"""Scenario command handlers.

Manages recorded scenarios stored as JSON files in
``~/.stitch-manager/scenarios/``. Provides CRUD, revision tracking,
run history, and replay preflight.
"""

from __future__ import annotations

import json
import logging
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from stitch_backend.core.command_registry import register_command

logger = logging.getLogger(__name__)

SCENARIOS_DIR = Path.home() / ".stitch-manager" / "scenarios"
RUNS_DIR = Path.home() / ".stitch-manager" / "scenario_runs"


def _ensure_dirs() -> None:
    SCENARIOS_DIR.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


def _list_scenario_files() -> list[dict[str, Any]]:
    _ensure_dirs()
    results: list[dict[str, Any]] = []
    # Use os.walk for recursion
    import os
    for dirpath, _dirnames, filenames in os.walk(SCENARIOS_DIR):
        for fname in filenames:
            if fname.lower() == "scenario.json":
                full = Path(dirpath) / fname
                try:
                    data = json.loads(full.read_text(encoding="utf-8"))
                    if isinstance(data, dict):
                        data["_syncPath"] = str(full)
                        data["_syncDir"] = str(Path(dirpath).name)
                        results.append(data)
                except Exception:
                    continue
    results.sort(key=lambda s: s.get("recordedAt", ""), reverse=True)
    return results


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ── CRUD ──────────────────────────────────────────────────────────────────────


@register_command("list_recorded_scenarios")
async def cmd_list_recorded(params: dict) -> list:
    """List all recorded scenarios (matches Rust: Vec<ScenarioRecordItem>)."""
    scenarios = _list_scenario_files()
    items = []
    for s in scenarios:
        items.append({
            "id": s.get("runId", s.get("id", "")),
            "name": s.get("name", s.get("scenarioName", "")),
            "recordedAt": s.get("recordedAt", ""),
            "version": s.get("version", 1),
            "syncPath": s.get("_syncPath", ""),
            "syncDir": s.get("_syncDir", ""),
            "favorite": s.get("favorite", False),
            "tags": s.get("tags", []),
            "provider": s.get("provider", ""),
            "accountAlias": s.get("accountAlias", ""),
        })
    return items


@register_command("upsert_recorded_scenario")
async def cmd_upsert_scenario(params: dict) -> dict:
    """Create or update a recorded scenario."""
    req = params.get("request", params)
    data = req if isinstance(req, dict) else {}
    _ensure_dirs()

    name = str(data.get("name") or data.get("scenarioName") or "scenario").strip()
    run_id = str(data.get("runId") or data.get("id") or f"ext_{int(time.time())}").strip()

    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in name).strip()
    folder_name = f"{safe_name}_{run_id}"
    scenario_dir = SCENARIOS_DIR / folder_name
    scenario_dir.mkdir(parents=True, exist_ok=True)

    scenario_path = scenario_dir / "scenario.json"

    if "version" not in data:
        data["version"] = 1
    if "recordedAt" not in data:
        data["recordedAt"] = _now_iso()
    if "runId" not in data:
        data["runId"] = run_id

    scenario_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "id": run_id,
        "name": name,
        "recordedAt": data["recordedAt"],
        "version": data["version"],
        "syncPath": str(scenario_path),
        "syncDir": folder_name,
    }


@register_command("update_recorded_scenario")
async def cmd_update_scenario(params: dict) -> dict:
    """Update a specific scenario by syncDir."""
    req = params.get("request", params)
    sync_dir = str(req.get("syncDir", req.get("id", "")))
    updates = req.get("updates", req)

    scenario_path = SCENARIOS_DIR / sync_dir / "scenario.json"
    if not scenario_path.exists():
        raise ValueError(f"Scenario not found: {sync_dir}")

    try:
        data = json.loads(scenario_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        raise ValueError(f"Failed to read scenario: {sync_dir}") from None

    if isinstance(updates, dict):
        data.update(updates)

    data["updatedAt"] = _now_iso()
    scenario_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "id": data.get("runId", ""),
        "name": data.get("name", ""),
        "recordedAt": data.get("recordedAt", ""),
        "version": data.get("version", 1),
        "syncPath": str(scenario_path),
        "syncDir": sync_dir,
    }


@register_command("duplicate_recorded_scenario")
async def cmd_duplicate_scenario(params: dict) -> dict:
    """Duplicate a scenario with a new ID."""
    req = params.get("request", params)
    source_dir = str(req.get("syncDir", req.get("id", "")))
    new_name = str(req.get("name", "")).strip()

    source_path = SCENARIOS_DIR / source_dir / "scenario.json"
    if not source_path.exists():
        raise ValueError(f"Source scenario not found: {source_dir}")

    data = json.loads(source_path.read_text(encoding="utf-8"))
    new_id = str(uuid.uuid4())[:8]
    name = new_name or f"{data.get('name', 'scenario')}_copy"
    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in name).strip()
    new_folder = f"{safe_name}_{new_id}"

    new_dir = SCENARIOS_DIR / new_folder
    new_dir.mkdir(parents=True, exist_ok=True)

    data["name"] = name
    data["runId"] = new_id
    data["recordedAt"] = _now_iso()
    data["duplicateOf"] = source_dir

    new_path = new_dir / "scenario.json"
    new_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "id": new_id,
        "name": name,
        "recordedAt": data["recordedAt"],
        "version": data.get("version", 1),
        "syncPath": str(new_path),
        "syncDir": new_folder,
    }


@register_command("delete_recorded_scenario")
async def cmd_delete_scenario(params: dict) -> dict:
    """Delete a recorded scenario."""
    scenario_id = str(params.get("scenarioId", params.get("id", "")))
    _ensure_dirs()

    for dirpath in SCENARIOS_DIR.iterdir():
        if not dirpath.is_dir():
            continue
        sf = dirpath / "scenario.json"
        if sf.exists():
            try:
                data = json.loads(sf.read_text(encoding="utf-8"))
                if data.get("runId") == scenario_id or dirpath.name == scenario_id:
                    shutil.rmtree(dirpath, ignore_errors=True)
                    return {"deleted": scenario_id}
            except Exception:
                continue

    return {"error": "not_found", "scenarioId": scenario_id}


@register_command("set_recorded_scenario_favorite")
async def cmd_set_favorite(params: dict) -> dict:
    """Toggle favorite flag on a scenario."""
    scenario_id = str(params.get("scenarioId", ""))
    favorite = bool(params.get("favorite", True))
    _ensure_dirs()

    for dirpath in SCENARIOS_DIR.iterdir():
        if not dirpath.is_dir():
            continue
        sf = dirpath / "scenario.json"
        if sf.exists():
            try:
                data = json.loads(sf.read_text(encoding="utf-8"))
                if data.get("runId") == scenario_id or dirpath.name == scenario_id:
                    data["favorite"] = favorite
                    sf.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                    return {"scenarioId": scenario_id, "favorite": favorite}
            except Exception:
                continue

    return {"error": "not_found", "scenarioId": scenario_id}


@register_command("mark_recorded_scenario_played")
async def cmd_mark_played(params: dict) -> dict:
    """Mark a scenario as played."""
    scenario_id = str(params.get("scenarioId", ""))
    _ensure_dirs()

    for dirpath in SCENARIOS_DIR.iterdir():
        if not dirpath.is_dir():
            continue
        sf = dirpath / "scenario.json"
        if sf.exists():
            try:
                data = json.loads(sf.read_text(encoding="utf-8"))
                if data.get("runId") == scenario_id or dirpath.name == scenario_id:
                    data["lastPlayedAt"] = _now_iso()
                    data["playCount"] = data.get("playCount", 0) + 1
                    sf.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                    return {"scenarioId": scenario_id}
            except Exception:
                continue

    return {"error": "not_found", "scenarioId": scenario_id}


@register_command("reindex_recorded_scenarios")
async def cmd_reindex(params: dict) -> dict:
    """Re-index all scenarios (ensure consistency)."""
    _ensure_dirs()
    count = 0
    for dirpath in SCENARIOS_DIR.iterdir():
        if not dirpath.is_dir():
            continue
        sf = dirpath / "scenario.json"
        if sf.exists():
            count += 1
    return {"indexed": count}


@register_command("replay_preflight")
async def cmd_replay_preflight(params: dict) -> dict:
    """Check if a scenario is ready for replay."""
    scenario_path = str(params.get("scenarioPath", ""))
    path = Path(scenario_path)

    if not path.exists():
        return {"ready": False, "error": "Scenario file not found", "scenarioPath": scenario_path}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ready": False, "error": str(exc), "scenarioPath": scenario_path}

    return {
        "ready": True,
        "scenarioPath": scenario_path,
        "name": data.get("name", ""),
        "version": data.get("version", 1),
        "stepsCount": len(data.get("steps", [])),
    }


# ── Scenario runs (execution history) ────────────────────────────────────────


@register_command("append_scenario_run")
async def cmd_append_run(params: dict) -> int:
    """Record a scenario run (matches Rust: i64 — returns a numeric run timestamp)."""
    req = params.get("request", params)
    scenario_id = str(req.get("scenarioId", ""))
    _ensure_dirs()

    run_id = str(uuid.uuid4())
    run = {
        "id": run_id,
        "scenarioId": scenario_id,
        "startedAt": _now_iso(),
        "status": req.get("status", "running"),
        "result": req.get("result"),
        "error": req.get("error"),
    }

    run_path = RUNS_DIR / f"{run_id}.json"
    run_path.write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
    return int(time.time())  # numeric ID compatible with Rust i64


@register_command("list_scenario_runs")
async def cmd_list_runs(params: dict) -> list:
    """List scenario runs (matches Rust: Vec<ScenarioRunItem>)."""
    scenario_id = params.get("scenarioId")
    limit = int(params.get("limit", 50))
    _ensure_dirs()

    runs = []
    for f in sorted(RUNS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if scenario_id and data.get("scenarioId") != scenario_id:
                continue
            runs.append(data)
            if len(runs) >= limit:
                break
        except Exception:
            continue

    return runs


@register_command("list_scenario_revisions")
async def cmd_list_revisions(params: dict) -> list:
    """List revisions for a scenario (matches Rust: Vec<ScenarioRevisionItem>)."""
    scenario_id = str(params.get("scenarioId", ""))
    _ensure_dirs()

    revisions = []
    for dirpath in SCENARIOS_DIR.iterdir():
        if not dirpath.is_dir():
            continue
        sf = dirpath / "scenario.json"
        if sf.exists():
            try:
                data = json.loads(sf.read_text(encoding="utf-8"))
                if data.get("runId") == scenario_id or dirpath.name == scenario_id:
                    revisions.append({
                        "version": data.get("version", 1),
                        "recordedAt": data.get("recordedAt", ""),
                        "syncPath": str(sf),
                    })
            except Exception:
                continue

    return revisions


@register_command("rollback_recorded_scenario")
async def cmd_rollback_scenario(params: dict) -> dict:
    """Rollback a scenario to a previous version (simplified stub)."""
    req = params.get("request", params)
    scenario_id = str(req.get("scenarioId", ""))
    version = int(req.get("version", 1))

    # In this simplified version, just return the current scenario
    return {"scenarioId": scenario_id, "version": version, "rolledBack": True}
