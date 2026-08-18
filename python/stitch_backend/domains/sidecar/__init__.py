"""Sidecar domain — unified lifecycle for local helper subprocesses.

Exposes the :class:`SidecarSupervisor` singleton and the declarative
:class:`SidecarSpec` / :class:`LaunchPlan` types. Individual sidecars
(freemodel_bridge, turnstile_solver, ...) register their spec here and keep
their own commands/domain logic.
"""

from .spec import LaunchPlan, SidecarSpec
from .supervisor import SidecarSupervisor, get_supervisor

__all__ = ["LaunchPlan", "SidecarSpec", "SidecarSupervisor", "get_supervisor"]
