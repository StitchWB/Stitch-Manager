"""Scheduler command handlers.

Exposes scheduled task CRUD, execution, and scheduler service control
to the frontend via the command registry.
"""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session
from stitch_backend.domains.scheduler.service import (
    Schedule,
    TaskType,
    _calculate_next_run,
    create_task,
    create_template,
    delete_task,
    delete_template,
    execution_to_dict,
    get_executions,
    get_task_by_id,
    get_tasks,
    get_templates,
    task_to_dict,
    template_to_dict,
    update_task,
    update_template,
)
from stitch_backend.domains.scheduler.worker import execute_task_now, get_worker

logger = logging.getLogger(__name__)


def _parse_schedule(d: dict[str, Any] | Any) -> Schedule:
    """Build a Schedule from a frontend dict."""
    if isinstance(d, Schedule):
        return d
    if not isinstance(d, dict):
        return Schedule(type="once", timestamp=int(d) if d else None)
    return Schedule(
        type=d.get("type", "once"),
        timestamp=d.get("timestamp"),
        seconds=d.get("seconds"),
        hour=d.get("hour"),
        minute=d.get("minute"),
        task_id=d.get("taskId"),
        delay_seconds=d.get("delaySeconds"),
    )


def _parse_task_type(d: dict[str, Any] | Any) -> TaskType:
    """Build a TaskType from a frontend dict."""
    if isinstance(d, TaskType):
        return d
    if not isinstance(d, dict):
        return TaskType(type="customScript")
    return TaskType(
        type=d.get("type", "customScript"),
        provider=d.get("provider"),
        account_id=d.get("accountId"),
        script_path=d.get("scriptPath"),
    )


# ── Task CRUD ─────────────────────────────────────────────────────────────────


@register_command("get_scheduled_tasks")
async def cmd_get_tasks(params: dict) -> list[dict]:
    """Get all scheduled tasks."""
    async def _op(db):
        tasks = await get_tasks(db)
        return [task_to_dict(t) for t in tasks]
    return await run_in_session(_op)


@register_command("create_scheduled_task")
async def cmd_create_task(params: dict) -> int:
    """Create a new scheduled task."""
    name = str(params.get("name", ""))
    task_type = _parse_task_type(params.get("taskType", params.get("task_type", {})))
    schedule = _parse_schedule(params.get("schedule", {}))
    config = str(params.get("config", "{}"))

    async def _op(db):
        return await create_task(db, name, task_type, schedule, config)
    return await run_in_session(_op)


@register_command("update_scheduled_task")
async def cmd_update_task(params: dict) -> dict:
    """Update an existing scheduled task."""
    task_data = params.get("task", params)

    async def _op(db):
        task_id = int(task_data.get("id", 0))
        existing = await get_task_by_id(db, task_id)
        if not existing:
            raise ValueError(f"Task {task_id} not found")

        existing.name = task_data.get("name", existing.name)
        existing.enabled = bool(task_data.get("enabled", existing.enabled))
        if "taskType" in task_data or "task_type" in task_data:
            existing.task_type = _parse_task_type(task_data.get("taskType", task_data.get("task_type")))
        if "schedule" in task_data:
            existing.schedule = _parse_schedule(task_data["schedule"])
            existing.next_run = _calculate_next_run(existing.schedule)
        if "config" in task_data:
            existing.config = str(task_data["config"])

        await update_task(db, existing)
        return task_to_dict(existing)

    return await run_in_session(_op)


@register_command("delete_scheduled_task")
async def cmd_delete_task(params: dict) -> dict:
    """Delete a scheduled task."""
    task_id = int(params.get("taskId", params.get("task_id", 0)))

    async def _op(db):
        await delete_task(db, task_id)
        return {"deleted": task_id}
    return await run_in_session(_op)


@register_command("toggle_scheduled_task")
async def cmd_toggle_task(params: dict) -> dict:
    """Toggle a task's enabled state."""
    task_id = int(params.get("taskId", params.get("task_id", 0)))
    enabled = bool(params.get("enabled", True))

    async def _op(db):
        task = await get_task_by_id(db, task_id)
        if not task:
            raise ValueError(f"Task {task_id} not found")
        task.enabled = enabled
        await update_task(db, task)
        return task_to_dict(task)
    return await run_in_session(_op)


# ── Execution ─────────────────────────────────────────────────────────────────


@register_command("execute_task_now")
async def cmd_execute_now(params: dict) -> str:
    """Execute a task immediately."""
    task_id = int(params.get("taskId", params.get("task_id", 0)))

    async def _op(db):
        task = await get_task_by_id(db, task_id)
        if not task:
            raise ValueError(f"Task {task_id} not found")
        return await execute_task_now(db, task)
    return await run_in_session(_op)


@register_command("get_task_executions")
async def cmd_get_executions(params: dict) -> list[dict]:
    """Get execution history for a task."""
    task_id = int(params.get("taskId", params.get("task_id", 0)))
    limit = int(params.get("limit", 50))

    async def _op(db):
        execs = await get_executions(db, task_id, limit)
        return [execution_to_dict(e) for e in execs]
    return await run_in_session(_op)


# ── Scheduler service control ─────────────────────────────────────────────────


@register_command("start_scheduler")
async def cmd_start_scheduler(params: dict) -> dict:
    """Start the scheduler worker."""
    worker = get_worker()
    await worker.start()
    return {"running": True}


@register_command("stop_scheduler")
async def cmd_stop_scheduler(params: dict) -> dict:
    """Stop the scheduler worker."""
    worker = get_worker()
    await worker.stop()
    return {"running": False}


@register_command("get_scheduler_status")
async def cmd_scheduler_status(params: dict) -> bool:
    """Check if the scheduler is running."""
    return get_worker().is_running


# ── Templates ─────────────────────────────────────────────────────────────────


@register_command("get_scheduler_templates")
async def cmd_get_templates(params: dict) -> list[dict]:
    """Get all scheduler templates."""
    async def _op(db):
        templates = await get_templates(db)
        return [template_to_dict(t) for t in templates]
    return await run_in_session(_op)


@register_command("create_scheduler_template")
async def cmd_create_template(params: dict) -> int:
    """Create a new scheduler template."""
    name = str(params.get("name", ""))
    description = params.get("description")
    task_type = _parse_task_type(params.get("taskType", params.get("task_type", {})))
    schedule = _parse_schedule(params.get("schedule", {}))
    config = str(params.get("config", "{}"))

    async def _op(db):
        return await create_template(db, name, description, task_type, schedule, config)
    return await run_in_session(_op)


@register_command("update_scheduler_template")
async def cmd_update_template(params: dict) -> dict:
    """Update an existing scheduler template."""
    tmpl_data = params.get("template", params)

    async def _op(db):
        tmpl_id = int(tmpl_data.get("id", 0))
        templates = await get_templates(db)
        existing = next((t for t in templates if t.id == tmpl_id), None)
        if not existing:
            raise ValueError(f"Template {tmpl_id} not found")

        existing.name = tmpl_data.get("name", existing.name)
        existing.description = tmpl_data.get("description", existing.description)
        if "taskType" in tmpl_data or "task_type" in tmpl_data:
            existing.task_type = _parse_task_type(tmpl_data.get("taskType", tmpl_data.get("task_type")))
        if "schedule" in tmpl_data:
            existing.schedule = _parse_schedule(tmpl_data["schedule"])
        if "config" in tmpl_data:
            existing.config = str(tmpl_data["config"])

        await update_template(db, existing)
        return template_to_dict(existing)

    return await run_in_session(_op)


@register_command("delete_scheduler_template")
async def cmd_delete_template(params: dict) -> dict:
    """Delete a scheduler template."""
    template_id = int(params.get("templateId", params.get("template_id", 0)))

    async def _op(db):
        await delete_template(db, template_id)
        return {"deleted": template_id}
    return await run_in_session(_op)


@register_command("create_scheduled_task_from_template")
async def cmd_create_from_template(params: dict) -> int:
    """Create a scheduled task from a template."""
    template_id = int(params.get("templateId", params.get("template_id", 0)))
    name_override = params.get("nameOverride")

    async def _op(db):
        templates = await get_templates(db)
        tmpl = next((t for t in templates if t.id == template_id), None)
        if not tmpl:
            raise ValueError(f"Template {template_id} not found")

        name = (name_override or "").strip() or tmpl.name
        return await create_task(db, name, tmpl.task_type, tmpl.schedule, tmpl.config)

    return await run_in_session(_op)
