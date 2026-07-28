"""API endpoints for key metrics."""
from __future__ import annotations

from fastapi import APIRouter

from .key_metrics import get_metrics_tracker
from .cost_tracker import get_cost_tracker

router = APIRouter(prefix="/metrics", tags=["Key Metrics"])


@router.get("/keys")
async def get_all_key_metrics():
    """Получить метрики для всех ключей."""
    tracker = get_metrics_tracker()
    return {"metrics": tracker.get_all_metrics()}


@router.get("/keys/{provider}")
async def get_provider_key_metrics(provider: str):
    """Получить метрики для провайдера."""
    tracker = get_metrics_tracker()
    return {"metrics": tracker.get_provider_metrics(provider)}


@router.get("/costs")
async def get_all_costs():
    """Получить стоимость для всех ключей."""
    tracker = get_cost_tracker()
    return {
        "costs": tracker.get_all_costs(),
        "total": tracker.get_total_cost(),
    }


@router.get("/summary")
async def get_metrics_summary():
    """Получить сводку метрик."""
    metrics_tracker = get_metrics_tracker()
    cost_tracker = get_cost_tracker()

    all_metrics = metrics_tracker.get_all_metrics()

    total_requests = sum(m["usageCount"] for m in all_metrics)
    total_success = sum(m["successCount"] for m in all_metrics)
    total_errors = sum(m["errorCount"] for m in all_metrics)
    avg_success_rate = (total_success / total_requests) if total_requests > 0 else 1.0

    return {
        "totalKeys": len(all_metrics),
        "totalRequests": total_requests,
        "totalSuccess": total_success,
        "totalErrors": total_errors,
        "avgSuccessRate": round(avg_success_rate, 3),
        "totalCost": cost_tracker.get_total_cost(),
    }