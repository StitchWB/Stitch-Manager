"""Email strategies combining generators and verifiers"""

from .addyio_imap import AddyIoImapStrategy
from .base import BaseStrategy
from .counter_imap import CounterImapStrategy
from .custom import CustomStrategy
from .icloud_pool import ICloudPoolStrategy
from .mailtm_strategy import MailTmStrategy
from .static_imap import StaticImapStrategy

__all__ = [
    'BaseStrategy',
    'StaticImapStrategy',
    'CounterImapStrategy',
    'AddyIoImapStrategy',
    'CustomStrategy',
    'MailTmStrategy',
    'ICloudPoolStrategy',
]
