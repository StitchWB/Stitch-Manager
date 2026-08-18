"""
Mail.tm API Service

Provides interface to Mail.tm temporary email service.
API Documentation: https://api.mail.tm/
"""

import logging
from dataclasses import dataclass

import requests

logger = logging.getLogger(__name__)


@dataclass
class MailTmConfig:
    """Configuration for Mail.tm service"""

    base_url: str = "https://api.mail.tm"
    timeout: int = 30


class MailTmService:
    """Service for interacting with Mail.tm API"""

    def __init__(self, config: MailTmConfig | None = None):
        """
        Initialize Mail.tm service

        Args:
            config: MailTmConfig object (uses defaults if None)
        """
        self.config = config or MailTmConfig()
        self.session = requests.Session()
        self.session.headers.update(
            {"Content-Type": "application/json", "Accept": "application/json"}
        )
        self.token: str | None = None
        self.account_id: str | None = None

    def get_domains(self) -> list[dict]:
        """
        Get available domains for email creation

        Returns:
            List of domain objects with 'id' and 'domain' fields

        Raises:
            requests.HTTPError: If API request fails
        """
        url = f"{self.config.base_url}/domains"
        response = self.session.get(url, timeout=self.config.timeout)
        response.raise_for_status()

        data = response.json()

        # Handle both response formats:
        # 1. Hydra format: {"hydra:member": [...]}
        # 2. Direct array: [...]
        if isinstance(data, list):
            domains = data
        elif isinstance(data, dict):
            domains = data.get("hydra:member", [])
        else:
            logger.error(f"Unexpected response format: {type(data)}")
            domains = []

        logger.info(f"Retrieved {len(domains)} available domains")
        return domains

    def create_account(self, address: str, password: str) -> dict:
        """
        Create new Mail.tm account

        Args:
            address: Full email address (e.g., user@domain.com)
            password: Account password

        Returns:
            Account object with 'id', 'address', etc.

        Raises:
            requests.HTTPError: If API request fails
        """
        url = f"{self.config.base_url}/accounts"
        payload = {"address": address, "password": password}

        response = self.session.post(url, json=payload, timeout=self.config.timeout)
        response.raise_for_status()

        account = response.json()
        self.account_id = account.get("id")
        logger.info(f"Created Mail.tm account: {address}")
        return account

    def login(self, address: str, password: str) -> str:
        """
        Login to Mail.tm account and get JWT token

        Args:
            address: Email address
            password: Account password

        Returns:
            JWT token string

        Raises:
            requests.HTTPError: If login fails
        """
        url = f"{self.config.base_url}/token"
        payload = {"address": address, "password": password}

        response = self.session.post(url, json=payload, timeout=self.config.timeout)
        response.raise_for_status()

        data = response.json()
        self.token = data.get("token")
        if not self.token:
            raise ValueError("Mail.tm token missing in response")

        # Update session headers with token
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})

        logger.info(f"Logged in to Mail.tm: {address}")
        # self.token is guaranteed to be set by the check above
        return self.token  # type: ignore[return-value]

    def get_messages(self, page: int = 1) -> list[dict]:
        """
        Get messages for authenticated account

        Args:
            page: Page number (default: 1)

        Returns:
            List of message objects

        Raises:
            requests.HTTPError: If API request fails
        """
        if not self.token:
            raise ValueError("Not authenticated. Call login() first.")

        url = f"{self.config.base_url}/messages"
        params = {"page": page}

        response = self.session.get(url, params=params, timeout=self.config.timeout)
        response.raise_for_status()

        data = response.json()
        # Handle both response formats:
        # 1. Hydra format: {"hydra:member": [...]}
        # 2. Direct array: [...]
        if isinstance(data, list):
            messages = data
        elif isinstance(data, dict):
            messages = data.get("hydra:member", [])
        else:
            logger.error(f"Unexpected messages response format: {type(data)}")
            messages = []

        # Defensive: ensure list
        if not isinstance(messages, list):
            logger.error(f"Unexpected messages container type: {type(messages)}")
            messages = []
        logger.debug(f"Retrieved {len(messages)} messages (page {page})")
        return messages

    def get_message(self, message_id: str) -> dict:
        """
        Get full message details including body

        Args:
            message_id: Message ID

        Returns:
            Full message object with 'text', 'html', etc.

        Raises:
            requests.HTTPError: If API request fails
        """
        if not self.token:
            raise ValueError("Not authenticated. Call login() first.")

        url = f"{self.config.base_url}/messages/{message_id}"
        response = self.session.get(url, timeout=self.config.timeout)
        response.raise_for_status()

        message = response.json()
        logger.debug(f"Retrieved message: {message_id}")
        return message

    def delete_account(self, account_id: str) -> None:
        """
        Delete Mail.tm account

        Args:
            account_id: Account ID to delete

        Raises:
            requests.HTTPError: If API request fails
        """
        if not self.token:
            raise ValueError("Not authenticated. Call login() first.")

        url = f"{self.config.base_url}/accounts/{account_id}"
        response = self.session.delete(url, timeout=self.config.timeout)
        response.raise_for_status()

        logger.info(f"Deleted Mail.tm account: {account_id}")

    def close(self):
        """Close session"""
        self.session.close()
