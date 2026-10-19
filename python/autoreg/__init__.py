"""
Kiro Batch Login - Autoreg Module
=================================

Модуль для автоматизации работы с аккаунтами Kiro.

Структура:
    core/           - Базовые компоненты (config, paths, exceptions)
    services/       - Бизнес-логика (tokens, quota, machine_id, kiro)
    registration/   - Авторегистрация аккаунтов
    _legacy/        - Устаревший код (для справки)

Использование:
    # CLI
    python cli.py status
    python cli.py tokens list
    python cli.py quota
    python cli.py machine reset

    # Или через kiro_switch.py
    python kiro_switch.py switch <account>
    python kiro_switch.py quota
"""

__version__ = '2.0.0'

# Lazy singletons: state written to a service must survive across calls
# (gate: .ast-grep/rules/no-fresh-instance-getter.yml).
_TOKEN_SERVICE = None
_QUOTA_SERVICE = None
_MACHINE_ID_SERVICE = None
_KIRO_SERVICE = None


def get_token_service():
    global _TOKEN_SERVICE
    if _TOKEN_SERVICE is None:
        from .services.token_service import TokenService
        _TOKEN_SERVICE = TokenService()
    return _TOKEN_SERVICE

def get_quota_service():
    global _QUOTA_SERVICE
    if _QUOTA_SERVICE is None:
        from .services.quota_service import QuotaService
        _QUOTA_SERVICE = QuotaService()
    return _QUOTA_SERVICE

def get_machine_id_service():
    global _MACHINE_ID_SERVICE
    if _MACHINE_ID_SERVICE is None:
        from .services.machine_id_service import MachineIdService
        _MACHINE_ID_SERVICE = MachineIdService()
    return _MACHINE_ID_SERVICE

def get_kiro_service():
    global _KIRO_SERVICE
    if _KIRO_SERVICE is None:
        from .services.kiro_service import KiroService
        _KIRO_SERVICE = KiroService()
    return _KIRO_SERVICE
