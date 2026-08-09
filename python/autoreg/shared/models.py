"""
Pydantic models for type validation in autoreg.

All configuration models use Pydantic for runtime type validation,
providing type safety, automatic validation, and clear error messages.
"""

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class EmailStrategy(StrEnum):
    """Email generation strategies"""

    STATIC = "static"  # Use single email
    COUNTER = "counter"  # email+1@, email+2@
    ADDYIO = "addyio"  # Generate addy.io aliases
    ADDYIO_COUNTER = "addyio_counter"  # Combine addy.io with counter
    THIRTY_THREE_MAIL = "33mail"  # Use 33mail.com wildcard
    MAILTM = "mailtm"  # Use Mail.tm temporary emails
    ICLOUD_POOL = "icloud_pool"  # iCloud Hide My Email pool


class ImapConfig(BaseModel):
    """IMAP configuration for email verification"""

    model_config = ConfigDict(frozen=False)  # Allow modification

    host: str = Field(..., description="IMAP server address (e.g., imap.gmail.com)")
    port: int = Field(993, ge=1, le=65535, description="IMAP port (default: 993)")
    user: str = Field(..., description="IMAP username/email")
    password: str = Field(..., description="IMAP password")

    @field_validator("host")
    @classmethod
    def validate_host(cls, v: str) -> str:
        """Validate IMAP host is not empty"""
        if not v or not v.strip():
            raise ValueError("IMAP host cannot be empty")
        return v.strip()

    @field_validator("user")
    @classmethod
    def validate_user(cls, v: str) -> str:
        """Validate IMAP user is not empty"""
        if not v or not v.strip():
            raise ValueError("IMAP user cannot be empty")
        return v.strip()


class AddyIoConfig(BaseModel):
    """Addy.io configuration for email alias generation"""

    model_config = ConfigDict(frozen=False)

    api_token: str = Field(..., description="Addy.io API token")
    base_url: str = Field("https://app.addy.io", description="Addy.io API base URL")
    default_domain: str | None = Field(None, description="Default domain for aliases")
    alias_format: str = Field(
        "uuid", description="Alias format: uuid, random_words, random_characters"
    )
    description_template: str | None = Field(None, description="Template for alias descriptions")
    auto_delete: bool = Field(False, description="Auto-delete aliases after use")

    @field_validator("api_token")
    @classmethod
    def validate_token(cls, v: str) -> str:
        """Validate API token is not empty"""
        if not v or not v.strip():
            raise ValueError("Addy.io API token cannot be empty")
        return v.strip()


class ICloudConfig(BaseModel):
    """iCloud Hide My Email pool configuration."""

    model_config = ConfigDict(frozen=False)

    apple_id: str = Field(..., description="Apple ID (e.g. user@icloud.com)")
    app_specific_password: str = Field(
        ..., description="App-specific password from appleid.apple.com"
    )
    cookie_directory: str = Field(
        "", description="Directory for pyicloud session cookies (empty = ~/.pyicloud)"
    )
    imap_password: str = Field(
        "", description="iCloud IMAP password (usually same as app_specific_password)"
    )
    min_pool_size: int = Field(
        50, ge=1, le=700, description="Minimum pool size before auto-refill triggers"
    )
    label_prefix: str = Field(
        "Auto-registration", description="Prefix for Hide My Email alias labels"
    )

    @field_validator("apple_id")
    @classmethod
    def validate_apple_id(cls, v: str) -> str:
        if not v or "@" not in v:
            raise ValueError("apple_id must be a valid email address")
        return v.strip()

    @field_validator("app_specific_password")
    @classmethod
    def validate_app_password(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("app_specific_password cannot be empty")
        return v.strip()


class PythonAutoregConfig(BaseModel):
    """Configuration for Python browser automation"""

    model_config = ConfigDict(frozen=False, extra="allow")  # Allow extra fields

    # Basic registration fields
    email: str | None = Field(None, description="Registration email address")
    name: str | None = Field(None, description="Display name")
    password: str | None = Field(None, description="Account password")

    # Browser settings
    headless: bool = Field(True, description="Run browser in headless mode")
    device_flow: bool = Field(False, description="Use device flow for OAuth")
    auto_generate: bool = Field(False, description="Auto-generate credentials")

    # Email strategy
    email_strategy: EmailStrategy = Field(
        EmailStrategy.STATIC, description="Email generation strategy"
    )

    # IMAP settings (required for email verification)
    imap_server: str = Field(..., description="IMAP server address")
    imap_port: int = Field(993, ge=1, le=65535, description="IMAP port")
    imap_user: str = Field(..., description="IMAP username")
    imap_password: str = Field(..., description="IMAP password")

    # Addy.io settings (optional, only for addyio strategies)
    addyio_config: AddyIoConfig | None = Field(None, description="Addy.io configuration")

    # iCloud Hide My Email pool settings
    icloud_config: ICloudConfig | None = Field(
        None, description="iCloud Hide My Email pool configuration"
    )

    # 33mail settings
    thirty_three_mail_username: str | None = Field(
        None, description="33mail username (e.g. whitebite)"
    )
    thirty_three_mail_domain: str | None = Field("33mail.com", description="33mail domain")

    # Logging settings
    log_verbosity: str = Field(
        "normal", description="Log verbosity level (minimal, normal, verbose, debug)"
    )

    # Advanced settings with validation
    speed_multiplier: float | None = Field(
        None, ge=0.1, le=10.0, description="Speed multiplier for automation (0.1-10.0)"
    )
    verification_code_timeout: int | None = Field(
        None, ge=10, le=600, description="Timeout for verification code retrieval (10-600 seconds)"
    )
    oauth_callback_timeout: int | None = Field(
        None, ge=10, le=600, description="Timeout for OAuth callback (10-600 seconds)"
    )
    allow_access_wait: int | None = Field(
        None, ge=10, le=600, description="Wait time for allow access page (10-600 seconds)"
    )
    page_load_timeout: int | None = Field(
        None, ge=5, le=300, description="Page load timeout (5-300 seconds)"
    )
    element_wait_timeout: int | None = Field(
        None, ge=1, le=60, description="Element wait timeout (1-60 seconds)"
    )
    imap_poll_interval: int | None = Field(
        None, ge=1, le=60, description="IMAP polling interval (1-60 seconds)"
    )
    password_length: int | None = Field(
        None, ge=8, le=128, description="Generated password length (8-128 characters)"
    )

    # Feature flags
    realistic_typing: bool | None = Field(None, description="Use realistic typing simulation")
    human_delays: bool | None = Field(None, description="Add human-like delays")
    screenshots_on_error: bool | None = Field(None, description="Take screenshots on errors")

    # Proxy configuration
    proxy_enabled: bool = Field(False, description="Enable proxy for browser")
    proxy_type: str = Field('http', description="Proxy type: http or socks5")
    proxy_url: str | None = Field(None, description="Proxy URL (host:port)")
    proxy_username: str | None = Field(None, description="Proxy username")
    proxy_password: str | None = Field(None, description="Proxy password")

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str | None) -> str | None:
        """Validate email format if provided"""
        if v and "@" not in v:
            raise ValueError("Invalid email format: must contain @")
        return v

    @field_validator("imap_server")
    @classmethod
    def validate_imap_server(cls, v: str) -> str:
        """Validate IMAP server is not empty"""
        if not v or not v.strip():
            raise ValueError("IMAP server cannot be empty")
        return v.strip()

    @field_validator("imap_user")
    @classmethod
    def validate_imap_user(cls, v: str) -> str:
        """Validate IMAP user is not empty"""
        if not v or not v.strip():
            raise ValueError("IMAP user cannot be empty")
        return v.strip()

    def to_imap_config(self) -> dict[str, Any]:
        """Convert to IMAP config dict for legacy code"""
        return {
            "host": self.imap_server,
            "port": self.imap_port,
            "user": self.imap_user,
            "password": self.imap_password,
        }


class AutoregResult(BaseModel):
    """Result of auto-registration"""

    model_config = ConfigDict(frozen=False, extra="allow")  # Allow extra fields

    success: bool = Field(..., description="Whether registration succeeded")
    email: str | None = Field(None, description="Registered email address")
    password: str | None = Field(None, description="Account password")
    name: str | None = Field(None, description="Display name")
    username: str | None = Field(None, description="Username (for GitHub, etc.)")

    # Token data
    token: str | None = Field(None, description="Access token")
    refresh_token: str | None = Field(None, description="Refresh token")
    token_data: dict[str, Any] | None = Field(None, description="Full token data")

    # Provider info
    provider: str | None = Field(None, description="Provider name (kiro, github, etc.)")

    # Error info
    error: str | None = Field(None, description="Error message if failed")

    # Additional flags
    requires_verification: bool | None = Field(
        None, description="Whether manual verification is required"
    )
    verification_url: str | None = Field(None, description="URL for manual verification")

    @field_validator("success")
    @classmethod
    def validate_success_error(cls, v: bool, info: Any) -> bool:
        """Ensure error is provided when success is False"""
        # Note: info.data contains the raw data being validated
        if not v and "error" in info.data and not info.data.get("error"):
            raise ValueError("Error message must be provided when success is False")
        return v


class KiroRegistrationConfig(PythonAutoregConfig):
    """Kiro-specific registration configuration"""

    # OAuth settings
    callback_port: int | None = Field(
        43210, ge=1024, le=65535, description="OAuth callback server port (1024-65535)"
    )
    oauth_timeout: int | None = Field(
        300, ge=10, le=600, description="OAuth flow timeout (10-600 seconds)"
    )


class GithubRegistrationConfig(PythonAutoregConfig):
    """GitHub-specific registration configuration"""

    username: str | None = Field(
        None, description="GitHub username (generated from email if not provided)"
    )
    verification_code: str | None = Field(
        None, description="Manual verification code (if not using IMAP)"
    )

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str | None) -> str | None:
        """Validate GitHub username format"""
        if v:
            # GitHub username requirements:
            # - Alphanumeric and hyphens only
            # - Cannot start or end with hyphen
            # - Max 39 characters
            if len(v) > 39:
                raise ValueError("GitHub username cannot exceed 39 characters")
            if v.startswith("-") or v.endswith("-"):
                raise ValueError("GitHub username cannot start or end with hyphen")
            if not all(c.isalnum() or c == "-" for c in v):
                raise ValueError(
                    "GitHub username can only contain alphanumeric characters and hyphens"
                )
        return v


class TraeRegistrationConfig(PythonAutoregConfig):
    """Trae-specific registration configuration"""

    pass  # Uses base config for now


class BitbucketRegistrationConfig(PythonAutoregConfig):
    """Bitbucket-specific registration configuration"""

    pass  # Uses base config for now


class WindsurfRegistrationConfig(PythonAutoregConfig):
    """Windsurf-specific registration configuration"""

    first_name: str | None = Field(None, description="First name")
    last_name: str | None = Field(None, description="Last name")
    collect_scripts: bool = Field(False, description="Collect JavaScript files for analysis")


__all__ = [
    "EmailStrategy",
    "ImapConfig",
    "AddyIoConfig",
    "ICloudConfig",
    "PythonAutoregConfig",
    "AutoregResult",
    "KiroRegistrationConfig",
    "GithubRegistrationConfig",
    "TraeRegistrationConfig",
    "BitbucketRegistrationConfig",
    "WindsurfRegistrationConfig",
]
