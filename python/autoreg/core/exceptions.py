"""
Кастомные исключения для всей системы.

Иерархия исключений:
- KiroError (базовое)
  - ValidationError (ошибки валидации)
    - EmailValidationError
    - PasswordValidationError
    - NameValidationError
  - TokenError (ошибки токенов)
  - AuthError (ошибки авторизации)
  - QuotaError (ошибки квот)
  - RegistrationError (ошибки регистрации)
"""


class KiroError(Exception):
    """Базовое исключение для всех ошибок Kiro"""
    pass


# =============================================================================
# Validation Errors
# =============================================================================

class ValidationError(KiroError):
    """Базовое исключение для ошибок валидации"""
    
    def __init__(self, message: str, field: str = None, value: str = None):
        self.field = field
        self.value = value
        super().__init__(message)


class EmailValidationError(ValidationError):
    """Ошибка валидации email"""
    
    def __init__(self, email: str, reason: str = "Invalid email format"):
        super().__init__(
            message=f"Email validation failed for '{email}': {reason}",
            field="email",
            value=email
        )
        self.reason = reason


class PasswordValidationError(ValidationError):
    """Ошибка валидации пароля"""
    
    def __init__(self, reason: str):
        super().__init__(
            message=f"Password validation failed: {reason}",
            field="password",
            value="[REDACTED]"
        )
        self.reason = reason


class NameValidationError(ValidationError):
    """Ошибка валидации имени"""
    
    def __init__(self, name: str, reason: str):
        super().__init__(
            message=f"Name validation failed for '{name}': {reason}",
            field="name",
            value=name
        )
        self.reason = reason


class ImapConfigValidationError(ValidationError):
    """Ошибка валидации IMAP конфигурации"""
    
    def __init__(self, reason: str, field: str = None):
        super().__init__(
            message=f"IMAP configuration validation failed: {reason}",
            field=field or "imap_config",
            value=None
        )
        self.reason = reason


class ProxyValidationError(ValidationError):
    """Ошибка валидации прокси"""
    
    def __init__(self, proxy_url: str, reason: str):
        super().__init__(
            message=f"Proxy validation failed for '{proxy_url}': {reason}",
            field="proxy",
            value=proxy_url
        )
        self.reason = reason


class TokenError(KiroError):
    """Ошибки связанные с токенами"""
    pass


class TokenExpiredError(TokenError):
    """Токен истёк"""
    pass


class TokenRefreshError(TokenError):
    """Ошибка обновления токена"""
    pass


class TokenNotFoundError(TokenError):
    """Токен не найден"""
    pass


class AuthError(KiroError):
    """Ошибки авторизации"""
    pass


class AuthBannedError(AuthError):
    """Аккаунт забанен"""
    def __init__(self, reason: str = "Unknown"):
        self.reason = reason
        super().__init__(f"Account banned: {reason}")


class QuotaError(KiroError):
    """Ошибки связанные с квотами"""
    pass


class QuotaExceededError(QuotaError):
    """Квота исчерпана"""
    pass


class MachineIdError(KiroError):
    """Ошибки связанные с Machine ID"""
    pass


class KiroNotInstalledError(KiroError):
    """Kiro IDE не установлен"""
    pass


class KiroRunningError(KiroError):
    """Kiro IDE запущен (нужно закрыть для операции)"""
    pass


class RegistrationError(KiroError):
    """Ошибки регистрации аккаунта"""
    pass


class EmailVerificationError(RegistrationError):
    """Ошибка верификации email"""
    pass
