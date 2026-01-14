"""
Core module - базовые компоненты системы
"""

from .config import Config, get_config
from .paths import Paths
from .exceptions import (
    KiroError,
    TokenError,
    AuthError,
    QuotaError,
    MachineIdError
)
from .constants import *
from .process_utils import (
    is_process_running,
    wait_for_process_exit,
    kill_process,
    is_kiro_running,
    kill_kiro
)
from .validators import (
    # Models
    PasswordValidator,
    ImapConfig as ImapConfigValidator,
    RegistrationRequest,
    EmailPoolEntry,
    EmailStrategyConfig,
    ProxyConfig,
    VerificationCode,
    # Helper functions
    validate_email,
    validate_password,
    validate_imap_config,
    validate_registration_request,
    validate_verification_code,
)

__all__ = [
    'Config',
    'get_config',
    'Paths',
    'KiroError',
    'TokenError',
    'AuthError',
    'QuotaError',
    'MachineIdError',
    # Process utilities
    'is_process_running',
    'wait_for_process_exit',
    'kill_process',
    'is_kiro_running',
    'kill_kiro',
    # Validators
    'PasswordValidator',
    'ImapConfigValidator',
    'RegistrationRequest',
    'EmailPoolEntry',
    'EmailStrategyConfig',
    'ProxyConfig',
    'VerificationCode',
    'validate_email',
    'validate_password',
    'validate_imap_config',
    'validate_registration_request',
    'validate_verification_code',
]
