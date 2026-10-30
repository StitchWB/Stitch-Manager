"""Email strategy surface of the provider SDK (ADR-005).

Re-exports the email building blocks a provider is allowed to use.  In
open-core builds the closed email backends are absent, so every re-exported
name resolves to ``None``; compiled providers run against the full tree where
the imports succeed.
"""

from autoreg.shared.models import EmailStrategy

try:
    from autoreg.email_providers.base import (
        EmailContext,
        IEmailGenerator,
        IEmailVerifier,
    )
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
except ImportError:
    EmailContext = None
    IEmailGenerator = None
    IEmailVerifier = None
    AddyIoEmailGenerator = None
    CounterEmailGenerator = None
    StaticEmailGenerator = None
    ThirtyThreeMailGenerator = None
    AddyIoImapStrategy = None
    BaseStrategy = None
    CounterImapStrategy = None
    ICloudPoolStrategy = None
    MailTmStrategy = None
    StaticImapStrategy = None
    ImapVerifier = None
    MailTmConfig = None

__all__ = [
    "EmailStrategy",
    "EmailContext",
    "IEmailGenerator",
    "IEmailVerifier",
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
