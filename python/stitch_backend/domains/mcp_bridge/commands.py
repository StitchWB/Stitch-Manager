"""MCP Bridge command handlers — 10 commands.

Ports Rust ``commands/mcp_bridge.rs``.  All write actions go through
the safety guard (kill-switch + dry-run + journal).
"""

from __future__ import annotations

import json
import logging

from sqlalchemy import text as sql_text

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session
from stitch_backend.domains.mcp_bridge.service import (
    account_persist_allowed,
    append_critical_journal,
    autonomy_enabled,
    critical_journal_path,
    dry_run_enabled,
    ensure_write_allowed,
    kill_switch_path,
    scenario_roots,
    validate_scenario_path,
)

logger = logging.getLogger(__name__)


# ── Scenarios ───────────────────────────────────────────────────────────────

@register_command("mcp_list_recorded_scenarios")
async def cmd_mcp_list_recorded_scenarios(params: dict) -> list:
    """List recorded scenarios (delegates to scenarios command)."""
    from stitch_backend.core.command_registry import get_command_handler
    handler = get_command_handler("list_recorded_scenarios")
    result = await handler(params)
    items = result.get("items", []) if isinstance(result, dict) else result
    return items


@register_command("mcp_read_scenario_file_json")
async def cmd_mcp_read_scenario_file_json(params: dict) -> dict:
    """Read a scenario JSON file with path validation."""
    raw_path = params.get("scenarioPath", params.get("scenario_path", ""))
    path = validate_scenario_path(raw_path)

    if not path.exists():
        raise ValueError(f"Scenario not found: {path}")

    raw = path.read_text(encoding="utf-8")
    return json.loads(raw)


@register_command("mcp_write_scenario_file_json")
async def cmd_mcp_write_scenario_file_json(params: dict) -> bool:
    """Write a scenario JSON file with safety guards."""
    ensure_write_allowed("mcp_write_scenario_file_json")

    raw_path = params.get("scenarioPath", params.get("scenario_path", ""))
    scenario_json = params.get("scenarioJson", params.get("scenario_json", {}))
    path = validate_scenario_path(raw_path)

    if dry_run_enabled():
        append_critical_journal("mcp_write_scenario_file_json", params, {"written": False, "dryRun": True})
        return True

    payload = json.dumps(scenario_json, indent=2) if isinstance(scenario_json, (dict, list)) else str(scenario_json)
    path.write_text(payload, encoding="utf-8")
    append_critical_journal("mcp_write_scenario_file_json", params, {"written": True, "dryRun": False})
    return True


# ── Composed Flows ──────────────────────────────────────────────────────────

@register_command("mcp_list_composed_flows")
async def cmd_mcp_list_composed_flows(params: dict) -> list:
    """List composed flows (delegates to composed_flows command)."""
    from stitch_backend.core.command_registry import get_command_handler
    handler = get_command_handler("list_composed_flows")
    return await handler(params)


@register_command("mcp_upsert_composed_flow")
async def cmd_mcp_upsert_composed_flow(params: dict) -> dict:
    """Create or update a composed flow with safety guards."""
    from stitch_backend.core.command_registry import get_command_handler

    ensure_write_allowed("mcp_upsert_composed_flow")

    if dry_run_enabled():
        result = {
            "id": params.get("id") or f"dryrun_flow_{id(params)}",
            "alias": params.get("alias", ""),
            "name": params.get("name", ""),
            "flowJson": params.get("flowJson", ""),
            "dryRun": True,
        }
        append_critical_journal("mcp_upsert_composed_flow", params, result)
        return result

    handler = get_command_handler("upsert_composed_flow")
    result = await handler(params)
    append_critical_journal("mcp_upsert_composed_flow", params, result)
    return result


@register_command("mcp_start_composed_flow_run")
async def cmd_mcp_start_composed_flow_run(params: dict) -> dict:
    """Start a composed flow execution with safety guards."""
    from stitch_backend.config import REPO_ROOT
    from stitch_backend.domains.python_jobs.service import get_job_manager

    ensure_write_allowed("mcp_start_composed_flow_run")

    persist = params.get("persistAccounts", True) and account_persist_allowed()
    plan_json = params.get("planJson", params.get("plan_json", ""))

    if dry_run_enabled():
        import uuid
        result = {"jobId": f"dryrun_job_{uuid.uuid4().hex[:8]}"}
        append_critical_journal("mcp_start_composed_flow_run", params, result)
        return result

    script_path = str(REPO_ROOT / "python" / "run_composed_flow.py")
    job = await get_job_manager().start(
        script_path=script_path,
        args=["--plan", plan_json, "--persist" if persist else "--no-persist"],
    )
    result = {"jobId": job.id}
    append_critical_journal("mcp_start_composed_flow_run", params, result)
    return result


# ── Python Job delegation ───────────────────────────────────────────────────

@register_command("mcp_get_python_job_status")
async def cmd_mcp_get_python_job_status(params: dict) -> dict | None:
    """Get Python job status (delegates to python_jobs)."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    job_id = params.get("jobId", params.get("job_id", ""))
    job = get_job_manager().get_status(job_id)
    if not job:
        return None
    return {
        "jobId": job.id,
        "state": job.state,
        "startedAt": job.started_at,
        "finishedAt": job.finished_at,
        "exitCode": job.exit_code,
        "error": job.error,
    }


@register_command("mcp_cancel_python_job")
async def cmd_mcp_cancel_python_job(params: dict) -> bool:
    """Cancel a Python job with safety guards."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    ensure_write_allowed("mcp_cancel_python_job")

    job_id = params.get("jobId", params.get("job_id", ""))

    if dry_run_enabled():
        append_critical_journal("mcp_cancel_python_job", params, {"cancelled": False, "dryRun": True})
        return False

    result = await get_job_manager().cancel(job_id)
    append_critical_journal("mcp_cancel_python_job", params, {"cancelled": result, "dryRun": False})
    return result


# ── Aggregation / Info ─────────────────────────────────────────────────────

@register_command("mcp_list_aliases", readonly=True)
async def cmd_mcp_list_aliases(params: dict) -> list:
    """List alias summaries (scenario count + flow count)."""
    limit = min(max(int(params.get("limit", 200)), 1), 1000)

    async def _op(session):
        result = await session.execute(sql_text(
            "SELECT alias, SUM(scenario_count) AS scenario_count, SUM(flow_count) AS flow_count"
            " FROM ("
            "   SELECT alias, COUNT(*) AS scenario_count, 0 AS flow_count FROM scenarios GROUP BY alias"
            "   UNION ALL"
            "   SELECT alias, 0 AS scenario_count, COUNT(*) AS flow_count FROM composed_flows GROUP BY alias"
            " ) grouped GROUP BY alias ORDER BY alias ASC LIMIT :lim"
        ), {"lim": limit})
        return [
            {"alias": r.alias, "scenarioCount": r.scenario_count, "flowCount": r.flow_count}
            for r in result.fetchall()
        ]

    try:
        return await run_in_read_session(_op)
    except Exception:
        return []


# -- Python Job Wait -------------------------------------------------------

@register_command("mcp_wait_python_job")
async def cmd_mcp_wait_python_job(params: dict) -> dict | None:
    """Poll a Python job until terminal state or timeout.

    Mirrors Rust ``mcp_wait_python_job`` — polls at configurable intervals.
    """
    import asyncio as _asyncio

    from stitch_backend.domains.python_jobs.service import get_job_manager

    job_id = params.get("jobId", params.get("job_id", ""))
    timeout_ms = min(max(int(params.get("timeoutMs", params.get("timeout_ms", 120_000))), 1_000), 86_400_000)
    poll_ms = min(max(int(params.get("pollIntervalMs", params.get("poll_interval_ms", 500))), 100), 10_000)

    deadline = _asyncio.get_event_loop().time() + timeout_ms / 1000.0
    mgr = get_job_manager()

    while True:
        job = mgr.get_status(job_id)
        if job is None:
            return None
        terminal = job.state in ("succeeded", "failed", "cancelled", "timed_out")
        if terminal or _asyncio.get_event_loop().time() >= deadline:
            return {
                "jobId": job.id,
                "state": job.state,
                "startedAt": job.started_at,
                "finishedAt": job.finished_at,
                "exitCode": job.exit_code,
                "error": job.error,
            }
        await _asyncio.sleep(poll_ms / 1000.0)


@register_command("mcp_get_server_info")
async def cmd_mcp_get_server_info(params: dict) -> dict:
    """Return MCP server configuration info."""
    roots = [str(r) for r in scenario_roots()]
    return {
        "name": "stitch-mcp-bridge",
        "version": "0.2.0",
        "autonomyEnabled": autonomy_enabled(),
        "dryRun": dry_run_enabled(),
        "allowAccountPersist": account_persist_allowed(),
        "killSwitchPath": str(kill_switch_path()),
        "criticalJournalPath": str(critical_journal_path()),
        "scenarioRoots": roots,
    }
