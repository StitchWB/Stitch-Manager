"""
Pydantic models for type validation in autoreg.

All configuration models use Pydantic for runtime type validation,
providing type safety, automatic validation, and clear error messages.
"""

from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Optional, Literal, Dict, Any


class ImapConfig(BaseModel):
    """IMAP configuration for email verification"""
    
    model_config = ConfigDict(frozen=False)  # Allow modification
    
    host: str = Field(..., description="IMAP server address (e.g., imap.gmail.com)")
    port: int = Field(993, ge=1, le=65535, description="IMAP port (default: 993)")
    user: str = Field(..., description="IMAP username/email")
    password: str = Field(..., description="IMAP password")
    
    @field_validator('host')
    @classmethod
    def validate_host(cls, v: str) -> str:
        """Validate IMAP host is not empty"""
        if not v or not v.strip():
            raise ValueError('IMAP host cannot be empty')
        return v.strip()
    
    @field_validator('user')
    @classmethod
    def validate_user(cls, v: str) -> str:
        """Validate IMAP user is not empty"""
        if not v or not v.strip():
            raise ValueError('IMAP user cannot be empty')
        return v.strip()


class PythonAutoregConfig(BaseModel):
    """Configuration for Python browser automation"""
    
    model_config = ConfigDict(frozen=False, extra='allow')  # Allow extra fields
    
    # Basic registration fields
    email: Optional[str] = Field(None, description="Registration email address")
    name: Optional[str] = Field(None, description="Display name")
    password: Optional[str] = Field(None, description="Account password")
    
    # Browser settings
    headless: bool = Field(True, description="Run browser in headless mode")
    device_flow: bool = Field(False, description="Use device flow for OAuth")
    auto_generate: bool = Field(False, description="Auto-generate credentials")
    
    # IMAP settings (required for email verification)
    imap_server: str = Field(..., description="IMAP server address")
    imap_port: int = Field(993, ge=1, le=65535, description="IMAP port")
    imap_user: str = Field(..., description="IMAP username")
    imap_password: str = Field(..., description="IMAP password")
    
    # Advanced settings with validation
    speed_multiplier: Optional[float] = Field(
        None, ge=0.1, le=10.0,
        description="Speed multiplier for automation (0.1-10.0)"
    )
    verification_code_timeout: Optional[int] = Field(
        None, ge=10, le=600,
        description="Timeout for verification code retrieval (10-600 seconds)"
    )
    oauth_callback_timeout: Optional[int] = Field(
        None, ge=10, le=600,
        description="Timeout for OAuth callback (10-600 seconds)"
    )
    allow_access_wait: Optional[int] = Field(
        None, ge=10, le=600,
        description="Wait time for allow access page (10-600 seconds)"
    )
    page_load_timeout: Optional[int] = Field(
        None, ge=5, le=300,
        description="Page load timeout (5-300 seconds)"
    )
    element_wait_timeout: Optional[int] = Field(
        None, ge=1, le=60,
        description="Element wait timeout (1-60 seconds)"
    )
    imap_poll_interval: Optional[int] = Field(
        None, ge=1, le=60,
        description="IMAP polling interval (1-60 seconds)"
    )
    password_length: Optional[int] = Field(
        None, ge=8, le=128,
        description="Generated password length (8-128 characters)"
    )
    
    # Feature flags
    realistic_typing: Optional[bool] = Field(
        None, description="Use realistic typing simulation"
    )
    human_delays: Optional[bool] = Field(
        None, description="Add human-like delays"
    )
    screenshots_on_error: Optional[bool] = Field(
        None, description="Take screenshots on errors"
    )
    
    @field_validator('email')
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        """Validate email format if provided"""
        if v and '@' not in v:
            raise ValueError('Invalid email format: must contain @')
        return v
    
    @field_validator('imap_server')
    @classmethod
    def validate_imap_server(cls, v: str) -> str:
        """Validate IMAP server is not empty"""
        if not v or not v.strip():
            raise ValueError('IMAP server cannot be empty')
        return v.strip()
    
    @field_validator('imap_user')
    @classmethod
    def validate_imap_user(cls, v: str) -> str:
        """Validate IMAP user is not empty"""
        if not v or not v.strip():
            raise ValueError('IMAP user cannot be empty')
        return v.strip()
    
    def to_imap_config(self) -> Dict[str, Any]:
        """Convert to IMAP config dict for legacy code"""
        return {
            'host': self.imap_server,
            'port': self.imap_port,
            'user': self.imap_user,
            'password': self.imap_password
        }


class AutoregResult(BaseModel):
    """Result of auto-registration"""
    
    model_config = ConfigDict(frozen=False, extra='allow')  # Allow extra fields
    
    success: bool = Field(..., description="Whether registration succeeded")
    email: Optional[str] = Field(None, description="Registered email address")
    password: Optional[str] = Field(None, description="Account password")
    name: Optional[str] = Field(None, description="Display name")
    username: Optional[str] = Field(None, description="Username (for GitHub, etc.)")
    
    # Token data
    token: Optional[str] = Field(None, description="Access token")
    refresh_token: Optional[str] = Field(None, description="Refresh token")
    token_data: Optional[Dict[str, Any]] = Field(None, description="Full token data")
    
    # Provider info
    provider: Optional[str] = Field(None, description="Provider name (kiro, github, etc.)")
    
    # Error info
    error: Optional[str] = Field(None, description="Error message if failed")
    
    # Additional flags
    requires_verification: Optional[bool] = Field(
        None, description="Whether manual verification is required"
    )
    verification_url: Optional[str] = Field(
        None, description="URL for manual verification"
    )
    
    @field_validator('success')
    @classmethod
    def validate_success_error(cls, v: bool, info: Any) -> bool:
        """Ensure error is provided when success is False"""
        # Note: info.data contains the raw data being validated
        if not v and 'error' in info.data and not info.data.get('error'):
            raise ValueError('Error message must be provided when success is False')
        return v


class KiroRegistrationConfig(PythonAutoregConfig):
    """Kiro-specific registration configuration"""
    
    # OAuth settings
    callback_port: Optional[int] = Field(
        43210, ge=1024, le=65535,
        description="OAuth callback server port (1024-65535)"
    )
    oauth_timeout: Optional[int] = Field(
        300, ge=10, le=600,
        description="OAuth flow timeout (10-600 seconds)"
    )


class GithubRegistrationConfig(PythonAutoregConfig):
    """GitHub-specific registration configuration"""
    
    username: Optional[str] = Field(
        None, description="GitHub username (generated from email if not provided)"
    )
    verification_code: Optional[str] = Field(
        None, description="Manual verification code (if not using IMAP)"
    )
    
    @field_validator('username')
    @classmethod
    def validate_username(cls, v: Optional[str]) -> Optional[str]:
        """Validate GitHub username format"""
        if v:
            # GitHub username requirements:
            # - Alphanumeric and hyphens only
            # - Cannot start or end with hyphen
            # - Max 39 characters
            if len(v) > 39:
                raise ValueError('GitHub username cannot exceed 39 characters')
            if v.startswith('-') or v.endswith('-'):
                raise ValueError('GitHub username cannot start or end with hyphen')
            if not all(c.isalnum() or c == '-' for c in v):
                raise ValueError('GitHub username can only contain alphanumeric characters and hyphens')
        return v


class TraeRegistrationConfig(PythonAutoregConfig):
    """Trae-specific registration configuration"""
    
    pass  # Uses base config for now


class WindsurfRegistrationConfig(PythonAutoregConfig):
    """Windsurf-specific registration configuration"""
    
    first_name: Optional[str] = Field(None, description="First name")
    last_name: Optional[str] = Field(None, description="Last name")
    collect_scripts: bool = Field(False, description="Collect JavaScript files for analysis")


__all__ = [
    'ImapConfig',
    'PythonAutoregConfig',
    'AutoregResult',
    'KiroRegistrationConfig',
    'GithubRegistrationConfig',
    'TraeRegistrationConfig',
    'WindsurfRegistrationConfig',
]
