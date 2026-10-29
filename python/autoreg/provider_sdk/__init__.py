"""Public SDK for registration providers (ADR-005).

Providers (methods) import ONLY from this facade.  Everything outside
``autoreg.provider_sdk`` is hub-internal and may change without notice; this
facade is stable within an ``ENGINE_API`` version.

Contents:
- base classes: ``BaseProvider``, ``CommonProvider``, ``ProviderConfig``
- identity: ``ProviderId`` (legacy enum, ADR-005 §3 moves to plain strings)
- result models: ``AutoregResult``
- ``autoreg.provider_sdk.browser``: ``BaseBrowser`` + mixins
- ``autoreg.provider_sdk.email``: email generators/strategies/verifiers
"""

from autoreg.provider_ids import ProviderId
from autoreg.shared.models import AutoregResult

from .base import BaseProvider, ProviderConfig
from .common import CommonProvider

__all__ = [
    "BaseProvider",
    "CommonProvider",
    "ProviderConfig",
    "ProviderId",
    "AutoregResult",
]
