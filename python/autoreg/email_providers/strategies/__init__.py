"""Email strategies combining generators and verifiers"""

from .base import BaseStrategy
from .static_imap import StaticImapStrategy
from .counter_imap import CounterImapStrategy
from .addyio_imap import AddyIoImapStrategy
from .custom import CustomStrategy
from .mailtm_strategy import MailTmStrategy
from .icloud_pool import ICloudPoolStrategy

__all__ = [
    'BaseStrategy',
    'StaticImapStrategy',
    'CounterImapStrategy',
    'AddyIoImapStrategy',
    'CustomStrategy',
    'MailTmStrategy',
    'ICloudPoolStrategy',
]
