"""Email generators for creating email addresses"""

from .addyio import AddyIoEmailGenerator
from .base import EmailContext, IEmailGenerator
from .counter import CounterEmailGenerator
from .icloud import ICloudPoolEmailGenerator
from .mailtm import MailTmEmailGenerator
from .static import StaticEmailGenerator
from .template_utils import TemplateState, render_template
from .thirtythreemail import ThirtyThreeMailGenerator

__all__ = [
    'IEmailGenerator',
    'EmailContext',
    'StaticEmailGenerator',
    'CounterEmailGenerator',
    'AddyIoEmailGenerator',
    'ThirtyThreeMailGenerator',
    'MailTmEmailGenerator',
    'ICloudPoolEmailGenerator',
    'render_template',
    'TemplateState',
]
