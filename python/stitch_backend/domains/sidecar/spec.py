"""Sidecar domain — declarative spec + launch plan for local helper processes.

A *sidecar* is a local helper subprocess (FreeModel bridge, Turnstile solver,
...). It is NOT an "AI provider" (a source of LLM inference) and NOT a
"registration provider" (a method to register accounts) — those are separate
concepts. A sidecar only needs process lifecycle management, which the
:class:`~stitch_backend.domains.sidecar.supervisor.SidecarSupervisor` owns.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable


@dataclass
class LaunchPlan:
    """Concrete, fully-resolved instructions to launch one sidecar.

    Produced by a :class:`SidecarSpec`'s ``prepare`` hook from optional caller
    settings, so all path / port / env resolution happens at call time.
    """

    command: list[str]
    cwd: str | None = None
    env: dict[str, str] = field(default_factory=dict)
    port: int | None = None
    # Absolute health URL polled for readiness (already port-formatted).
    health_url: str | None = None
    # Predicate on the HTTP status code that counts as "ready". Default: <500.
    health_ok: Callable[[int], bool] = field(default=lambda code: code < 500)
    readiness_timeout: float = 15.0
    # Extra values surfaced via status()/get_endpoint() (e.g. api_key presence).
    config: dict[str, Any] = field(default_factory=dict)
    # stdio mode: "devnull" (default, current behavior — stdout/stderr to
    # DEVNULL) or "pipes" (stdin/stdout/stderr as PIPE handles for RPC plugins;
    # the caller retrieves them via ``SidecarSupervisor.get_process``).
    stdio: str = "devnull"


@dataclass(frozen=True)
class SidecarSpec:
    """Declarative registration of a sidecar with the supervisor.

    ``prepare`` turns optional caller settings into a concrete
    :class:`LaunchPlan`. ``on_stop`` is an extra cleanup hook run after the
    process is stopped (e.g. the turnstile solver also shuts down instances
    that ``autoreg.captcha.turnstile_api`` launched on its own).
    """

    name: str
    display_name: str
    prepare: Callable[[dict | None], LaunchPlan]
    on_stop: Callable[[], None] | None = None
