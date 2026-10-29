"""Email strategy surface of the provider SDK (ADR-005).

Re-exports the Zone-1 email building blocks a provider is allowed to use.
"""

from autoreg.email_providers.generators import (
    AddyIoEmailGenerator,
    CounterEmailGenerator,
    StaticEmailGenerator,
    ThirtyThreeMailGenerator,
)
from autoreg.email_providers.strategies import (
    AddyIoImapStrategy,
    BaseStrategy,
    CounterImapStrategy,
    ICloudPoolStrategy,
    MailTmStrategy,
    StaticImapStrategy,
)
from autoreg.email_providers.verifiers import ImapVerifier
from autoreg.services.mailtm import MailTmConfig
from autoreg.shared.models import EmailStrategy

__all__ = [
    "EmailStrategy",
    "StaticEmailGenerator",
    "CounterEmailGenerator",
    "AddyIoEmailGenerator",
    "ThirtyThreeMailGenerator",
    "BaseStrategy",
    "StaticImapStrategy",
    "CounterImapStrategy",
    "AddyIoImapStrategy",
    "MailTmStrategy",
    "ICloudPoolStrategy",
    "ImapVerifier",
    "MailTmConfig",
]
