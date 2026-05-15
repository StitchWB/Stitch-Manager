"""
Addy.io Email Alias Service

Provides email alias generation using addy.io API.
This service creates temporary email aliases for registration purposes.
"""

from dataclasses import dataclass
from typing import Any

import requests


@dataclass
class AddyIoConfig:
    """Configuration for addy.io API"""
    api_token: str
    base_url: str = "https://app.addy.io"
    alias_format: str = "uuid"  # Alias format: uuid, random_words, random_characters
    auto_delete: bool = False   # Auto-delete aliases after use
    domain: str = ""            # Default domain for aliases
    template: str | None = None  # Optional template for description (e.g. "{name}-{rnd8}")


class AddyIoService:
    """Service for managing addy.io email aliases"""

    def __init__(self, config: AddyIoConfig):
        """
        Initialize addy.io service.

        Args:
            config: AddyIoConfig with API token
        """
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {config.api_token}',
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        })

    def get_account_details(self) -> dict[str, Any]:
        """
        Get account details including available domains and limits.

        Returns:
            Dict with account information

        Raises:
            requests.HTTPError: If API request fails
        """
        response = self.session.get(f'{self.config.base_url}/api/v1/account-details')
        response.raise_for_status()
        return response.json()

    def get_domain_options(self) -> dict[str, Any]:
        """
        Get available domains for alias creation.

        Returns:
            Dict with 'data' (list of domains), 'defaultAliasDomain', 'defaultAliasFormat'

        Raises:
            requests.HTTPError: If API request fails
        """
        response = self.session.get(f'{self.config.base_url}/api/v1/domain-options')
        response.raise_for_status()
        return response.json()

    def get_recipients(self, verified_only: bool = True) -> list[dict[str, Any]]:
        """
        Get all recipients (email addresses that receive forwarded emails).

        Args:
            verified_only: Only return verified recipients

        Returns:
            List of recipient dicts with 'id', 'email', 'email_verified_at', etc.

        Raises:
            requests.HTTPError: If API request fails
        """
        params = {}
        if verified_only:
            params['filter[verified]'] = 'true'

        response = self.session.get(
            f'{self.config.base_url}/api/v1/recipients',
            params=params
        )
        response.raise_for_status()
        return response.json().get('data', [])

    def get_api_token_details(self) -> dict[str, Any]:
        """
        Get details about the current API token.

        Returns:
            Dict with 'name', 'created_at', 'expires_at'

        Raises:
            requests.HTTPError: If API request fails (e.g., invalid token)
        """
        response = self.session.get(f'{self.config.base_url}/api/v1/api-token-details')
        response.raise_for_status()
        return response.json()

    def create_alias(
        self,
        domain: str | None = None,
        description: str | None = None,
        format: str = 'uuid',
        local_part: str | None = None,
        recipient_ids: list[str] | None = None,
        from_name: str | None = None
    ) -> dict[str, Any]:
        """
        Create a new email alias.

        Args:
            domain: Domain for the alias (uses default if not provided)
            description: Description for the alias
            format: Alias format - 'random_characters', 'uuid', 'random_words', 'custom'
            local_part: Local part for custom format
            recipient_ids: List of recipient IDs (uses default if not provided)
            from_name: Custom "From" name for emails sent from this alias

        Returns:
            Dict with alias data including 'email', 'id', 'active', etc.

        Raises:
            requests.HTTPError: If API request fails
            ValueError: If custom format is used without local_part
        """
        if format == 'custom' and not local_part:
            raise ValueError("local_part is required when format is 'custom'")

        # Use config domain if not provided
        if not domain and self.config.domain:
            domain = self.config.domain

        # Get default domain if still not provided
        if not domain:
            account = self.get_account_details()
            domain = account['data'][0]['default_alias_domain']

        payload: dict[str, Any] = {
            'domain': domain,
            'format': format
        }

        if description:
            payload['description'] = description

        if local_part:
            payload['local_part'] = local_part

        if recipient_ids:
            payload['recipient_ids'] = recipient_ids

        if from_name:
            payload['from_name'] = from_name

        response = self.session.post(
            f'{self.config.base_url}/api/v1/aliases',
            json=payload
        )
        response.raise_for_status()
        return response.json()['data']

    def get_alias(self, alias_id: str) -> dict[str, Any]:
        """
        Get details of a specific alias.

        Args:
            alias_id: UUID of the alias

        Returns:
            Dict with alias data

        Raises:
            requests.HTTPError: If API request fails
        """
        response = self.session.get(f'{self.config.base_url}/api/v1/aliases/{alias_id}')
        response.raise_for_status()
        return response.json()['data']

    def activate_alias(self, alias_id: str) -> dict[str, Any]:
        """
        Activate an alias.

        Args:
            alias_id: UUID of the alias

        Returns:
            Dict with updated alias data

        Raises:
            requests.HTTPError: If API request fails
        """
        response = self.session.post(
            f'{self.config.base_url}/api/v1/active-aliases',
            json={'id': alias_id}
        )
        response.raise_for_status()
        return response.json()['data']

    def deactivate_alias(self, alias_id: str) -> None:
        """
        Deactivate an alias.

        Args:
            alias_id: UUID of the alias

        Raises:
            requests.HTTPError: If API request fails
        """
        response = self.session.delete(
            f'{self.config.base_url}/api/v1/active-aliases/{alias_id}'
        )
        response.raise_for_status()

    def delete_alias(self, alias_id: str) -> None:
        """
        Delete an alias.

        Args:
            alias_id: UUID of the alias

        Raises:
            requests.HTTPError: If API request fails
        """
        response = self.session.delete(
            f'{self.config.base_url}/api/v1/aliases/{alias_id}'
        )
        response.raise_for_status()

    def list_aliases(
        self,
        page: int = 1,
        page_size: int = 100,
        active_only: bool = True,
        search: str | None = None
    ) -> dict[str, Any]:
        """
        List all aliases with pagination.

        Args:
            page: Page number (default: 1)
            page_size: Items per page (default: 100, max: 100)
            active_only: Only return active aliases
            search: Search term for email/description

        Returns:
            Dict with 'data' (list of aliases), 'links', and 'meta' (pagination)

        Raises:
            requests.HTTPError: If API request fails
        """
        params: dict[str, Any] = {
            'page[number]': page,
            'page[size]': min(page_size, 100)
        }

        if active_only:
            params['filter[active]'] = 'true'

        if search:
            params['filter[search]'] = search

        response = self.session.get(
            f'{self.config.base_url}/api/v1/aliases',
            params=params
        )
        response.raise_for_status()
        return response.json()

    def close(self):
        """Close the session"""
        self.session.close()


def create_email_alias(
    api_token: str,
    description: str | None = None,
    domain: str | None = None,
    format: str = 'uuid'
) -> str:
    """
    Convenience function to create an email alias.

    Args:
        api_token: Addy.io API token
        description: Description for the alias
        domain: Domain to use (uses account default if not provided)
        format: Alias format (default: 'uuid')

    Returns:
        Generated email address

    Raises:
        requests.HTTPError: If API request fails

    Example:
        >>> email = create_email_alias(
        ...     api_token="your_token_here",
        ...     description="GitHub registration",
        ...     format="random_words"
        ... )
        >>> print(email)
        'happy-elephant-123@yourdomain.anonaddy.me'
    """
    config = AddyIoConfig(api_token=api_token)
    service = AddyIoService(config)

    try:
        alias_data = service.create_alias(
            domain=domain,
            description=description,
            format=format
        )
        return alias_data['email']
    finally:
        service.close()


__all__ = ['AddyIoService', 'AddyIoConfig', 'create_email_alias']
