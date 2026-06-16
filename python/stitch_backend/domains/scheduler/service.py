"""Scheduler service — task CRUD, execution, and worker loop.

Ports the Rust ``services/scheduler`` module (worker.rs + executor.rs + database/scheduler.rs)
to Python/SQLAlchemy.

Tables are created via raw SQL in :func:`ensure_tables` (called from lifespan).
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── Data classes (mirror Rust types) ──────────────────────────────────────────


@dataclass
class Schedule:
    type: str  # "once" | "interval" | "daily" | "afterTask"
    timestamp: int | None = None
    seconds: int | None = None
    hour: int | None = None
    minute: int | None = None
    task_id: int | None = None
    delay_seconds: int | None = None


@dataclass
class TaskType:
    type: str  # "registerProvider" | "loginAccount" | "refreshToken" | "customScript"
    provider: str | None = None
    account_id: int | None = None
    script_path: str | None = None


@dataclass
class ScheduledTask:
    id: int
    name: str
    task_type: TaskType
    enabled: bool
    schedule: Schedule
    config: str
    last_run: int | None
    next_run: int
    run_count: int
    success_count: int
    error_count: int
    last_error: str | None
    created_at: int
    updated_at: int


@dataclass
class TaskExecution:
    id: int
    task_id: int
    started_at: int
    completed_at: int | None
    status: str  # "Running" | "Success" | "Failed" | "Cancelled"
    result: str | None
    error: str | None


@dataclass
class SchedulerTemplate:
    id: int
    name: str
    description: str | None
    task_type: TaskType
    schedule: Schedule
    config: str
    created_at: int
    updated_at: int


# ── JSON (de)serialization ────────────────────────────────────────────────────


def _now_ts() -> int:
    return int(time.time())


def _serialize_schedule(s: Schedule) -> str:
    d: dict[str, Any] = {"type": s.type}
    if s.timestamp is not None:
        d["timestamp"] = s.timestamp
    if s.seconds is not None:
        d["seconds"] = s.seconds
    if s.hour is not None:
        d["hour"] = s.hour
    if s.minute is not None:
        d["minute"] = s.minute
    if s.task_id is not None:
        d["taskId"] = s.task_id
    if s.delay_seconds is not None:
        d["delaySeconds"] = s.delay_seconds
    return json.dumps(d)


def _deserialize_schedule(raw: str) -> Schedule:
    d = json.loads(raw)
    return Schedule(
        type=d.get("type", "once"),
        timestamp=d.get("timestamp"),
        seconds=d.get("seconds"),
        hour=d.get("hour"),
        minute=d.get("minute"),
        task_id=d.get("taskId"),
        delay_seconds=d.get("delaySeconds"),
    )


def _serialize_task_type(t: TaskType) -> str:
    d: dict[str, Any] = {"type": t.type}
    if t.provider is not None:
        d["provider"] = t.provider
    if t.account_id is not None:
        d["accountId"] = t.account_id
    if t.script_path is not None:
        d["scriptPath"] = t.script_path
    return json.dumps(d)


def _deserialize_task_type(raw: str) -> TaskType:
    d = json.loads(raw)
    return TaskType(
        type=d.get("type", "customScript"),
        provider=d.get("provider"),
        account_id=d.get("accountId"),
        script_path=d.get("scriptPath"),
    )


def _calculate_next_run(schedule: Schedule, from_time: int | None = None) -> int:
    now = from_time or _now_ts()
    if schedule.type == "once":
        return schedule.timestamp or now
    if schedule.type == "interval":
        return now + (schedule.seconds or 3600)
    if schedule.type == "daily":
        hour = schedule.hour or 0
        minute = schedule.minute or 0
        dt = datetime.fromtimestamp(now, tz=timezone.utc)
        target = dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target.timestamp() <= now:
            target += timedelta(days=1)
        return int(target.timestamp())
    if schedule.type == "afterTask":
        return now + (schedule.delay_seconds or 0)
    return now + 3600


def _row_to_task(row: dict[str, Any]) -> ScheduledTask:
    return ScheduledTask(
        id=row["id"],
        name=row["name"],
        task_type=_deserialize_task_type(row["task_type"]),
        enabled=bool(row["enabled"]),
        schedule=_deserialize_schedule(row["schedule"]),
        config=row["config"],
        last_run=row["last_run"],
        next_run=row["next_run"],
        run_count=row["run_count"],
        success_count=row["success_count"],
        error_count=row["error_count"],
        last_error=row["last_error"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_execution(row: dict[str, Any]) -> TaskExecution:
    return TaskExecution(
        id=row["id"],
        task_id=row["task_id"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        status=row["status"],
        result=row["result"],
        error=row["error"],
    )


def _row_to_template(row: dict[str, Any]) -> SchedulerTemplate:
    return SchedulerTemplate(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        task_type=_deserialize_task_type(row["task_type"]),
        schedule=_deserialize_schedule(row["schedule"]),
        config=row["config"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── Table creation ────────────────────────────────────────────────────────────


async def ensure_tables(db: AsyncSession) -> None:
    """Create scheduler tables if they don't exist."""
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            task_type TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            schedule TEXT NOT NULL,
            config TEXT NOT NULL DEFAULT '{}',
            last_run INTEGER,
            next_run INTEGER NOT NULL,
            run_count INTEGER NOT NULL DEFAULT 0,
            success_count INTEGER NOT NULL DEFAULT 0,
            error_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """))
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS task_executions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            started_at INTEGER NOT NULL,
            completed_at INTEGER,
            status TEXT NOT NULL,
            result TEXT,
            error TEXT,
            FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
        )
    """))
    await db.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON scheduled_tasks(next_run, enabled)"
    ))
    await db.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_executions_task_id ON task_executions(task_id)"
    ))
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS scheduler_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            task_type TEXT NOT NULL,
            schedule TEXT NOT NULL,
            config TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """))
    await db.commit()


# ── Task CRUD ─────────────────────────────────────────────────────────────────


async def get_tasks(db: AsyncSession) -> list[ScheduledTask]:
    rows = (await db.execute(text("SELECT * FROM scheduled_tasks ORDER BY next_run ASC"))).mappings().all()
    return [_row_to_task(dict(r)) for r in rows]


async def get_task_by_id(db: AsyncSession, task_id: int) -> ScheduledTask | None:
    row = (await db.execute(
        text("SELECT * FROM scheduled_tasks WHERE id = :id LIMIT 1"), {"id": task_id}
    )).mappings().first()
    return _row_to_task(dict(row)) if row else None


async def create_task(
    db: AsyncSession, name: str, task_type: TaskType, schedule: Schedule, config: str
) -> int:
    now = _now_ts()
    next_run = _calculate_next_run(schedule, now)
    result = await db.execute(text(
        "INSERT INTO scheduled_tasks (name, task_type, schedule, config, next_run, created_at, updated_at) "
        "VALUES (:name, :tt, :sched, :cfg, :nr, :now, :now)"
    ), {
        "name": name,
        "tt": _serialize_task_type(task_type),
        "sched": _serialize_schedule(schedule),
        "cfg": config,
        "nr": next_run,
        "now": now,
    })
    return int(result.lastrowid or 0)  # type: ignore[attr-defined]


async def update_task(db: AsyncSession, task: ScheduledTask) -> None:
    now = _now_ts()
    await db.execute(text(
        "UPDATE scheduled_tasks SET name=:name, task_type=:tt, enabled=:en, schedule=:sched, "
        "config=:cfg, next_run=:nr, updated_at=:now WHERE id=:id"
    ), {
        "name": task.name,
        "tt": _serialize_task_type(task.task_type),
        "en": 1 if task.enabled else 0,
        "sched": _serialize_schedule(task.schedule),
        "cfg": task.config,
        "nr": task.next_run,
        "now": now,
        "id": task.id,
    })


async def delete_task(db: AsyncSession, task_id: int) -> None:
    await db.execute(text("DELETE FROM scheduled_tasks WHERE id = :id"), {"id": task_id})


async def get_pending_tasks(db: AsyncSession) -> list[ScheduledTask]:
    now = _now_ts()
    rows = (await db.execute(
        text("SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run <= :now ORDER BY next_run ASC"),
        {"now": now},
    )).mappings().all()
    return [_row_to_task(dict(r)) for r in rows]


# ── Execution ─────────────────────────────────────────────────────────────────


async def start_execution(db: AsyncSession, task_id: int) -> int:
    now = _now_ts()
    result = await db.execute(
        text("INSERT INTO task_executions (task_id, started_at, status) VALUES (:tid, :now, 'Running')"),
        {"tid": task_id, "now": now},
    )
    return int(result.lastrowid or 0)  # type: ignore[attr-defined]


async def complete_execution(
    db: AsyncSession, exec_id: int, task_id: int,
    status: str, result: str | None, error: str | None,
) -> None:
    now = _now_ts()
    await db.execute(text(
        "UPDATE task_executions SET completed_at=:now, status=:st, result=:res, error=:err WHERE id=:eid"
    ), {"now": now, "st": status, "res": result, "err": error, "eid": exec_id})

    success_inc = 1 if status == "Success" else 0
    error_inc = 1 if status == "Failed" else 0
    await db.execute(text(
        "UPDATE scheduled_tasks SET last_run=:now, run_count=run_count+1, "
        "success_count=success_count+:si, error_count=error_count+:ei, "
        "last_error=:err, updated_at=:now WHERE id=:tid"
    ), {"now": now, "si": success_inc, "ei": error_inc, "err": error, "tid": task_id})


async def update_next_run(db: AsyncSession, task_id: int, schedule: Schedule) -> None:
    next_run = _calculate_next_run(schedule)
    await db.execute(
        text("UPDATE scheduled_tasks SET next_run = :nr WHERE id = :id"),
        {"nr": next_run, "id": task_id},
    )


async def get_executions(db: AsyncSession, task_id: int, limit: int) -> list[TaskExecution]:
    rows = (await db.execute(
        text("SELECT * FROM task_executions WHERE task_id = :tid ORDER BY started_at DESC LIMIT :lim"),
        {"tid": task_id, "lim": limit},
    )).mappings().all()
    return [_row_to_execution(dict(r)) for r in rows]


# ── Templates ─────────────────────────────────────────────────────────────────


async def get_templates(db: AsyncSession) -> list[SchedulerTemplate]:
    rows = (await db.execute(text("SELECT * FROM scheduler_templates ORDER BY name ASC"))).mappings().all()
    return [_row_to_template(dict(r)) for r in rows]


async def create_template(
    db: AsyncSession, name: str, description: str | None,
    task_type: TaskType, schedule: Schedule, config: str,
) -> int:
    now = _now_ts()
    result = await db.execute(text(
        "INSERT INTO scheduler_templates (name, description, task_type, schedule, config, created_at, updated_at) "
        "VALUES (:n, :desc, :tt, :sched, :cfg, :now, :now)"
    ), {
        "n": name, "desc": description,
        "tt": _serialize_task_type(task_type),
        "sched": _serialize_schedule(schedule),
        "cfg": config, "now": now,
    })
    return int(result.lastrowid or 0)  # type: ignore[attr-defined]


async def update_template(db: AsyncSession, tmpl: SchedulerTemplate) -> None:
    now = _now_ts()
    await db.execute(text(
        "UPDATE scheduler_templates SET name=:n, description=:desc, task_type=:tt, "
        "schedule=:sched, config=:cfg, updated_at=:now WHERE id=:id"
    ), {
        "n": tmpl.name, "desc": tmpl.description,
        "tt": _serialize_task_type(tmpl.task_type),
        "sched": _serialize_schedule(tmpl.schedule),
        "cfg": tmpl.config, "now": now, "id": tmpl.id,
    })


async def delete_template(db: AsyncSession, template_id: int) -> None:
    await db.execute(text("DELETE FROM scheduler_templates WHERE id = :id"), {"id": template_id})


# ── Serialization helpers for API ─────────────────────────────────────────────


def task_to_dict(t: ScheduledTask) -> dict[str, Any]:
    tt = asdict(t.task_type)
    tt = {k: v for k, v in tt.items() if v is not None}
    sc = asdict(t.schedule)
    sc = {k: v for k, v in sc.items() if v is not None}
    return {
        "id": t.id, "name": t.name, "taskType": tt, "enabled": t.enabled,
        "schedule": sc, "config": t.config, "lastRun": t.last_run,
        "nextRun": t.next_run, "runCount": t.run_count, "successCount": t.success_count,
        "errorCount": t.error_count, "lastError": t.last_error,
        "createdAt": t.created_at, "updatedAt": t.updated_at,
    }


def execution_to_dict(e: TaskExecution) -> dict[str, Any]:
    return {
        "id": e.id, "taskId": e.task_id, "startedAt": e.started_at,
        "completedAt": e.completed_at, "status": e.status,
        "result": e.result, "error": e.error,
    }


def template_to_dict(t: SchedulerTemplate) -> dict[str, Any]:
    tt = asdict(t.task_type)
    tt = {k: v for k, v in tt.items() if v is not None}
    sc = asdict(t.schedule)
    sc = {k: v for k, v in sc.items() if v is not None}
    return {
        "id": t.id, "name": t.name, "description": t.description,
        "taskType": tt, "schedule": sc, "config": t.config,
        "createdAt": t.created_at, "updatedAt": t.updated_at,
    }
