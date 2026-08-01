"""
Kiro Web Portal API Client (CBOR RPC).

Использует AWS Smithy RPC v2 protocol с CBOR encoding.
Это ЛЕГИТИМНЫЙ способ взаимодействия с Kiro API, который не детектится как bot.

TODO: Временно скопировано из kiro-extension.
      В будущем можно переписать клиент на Rust и вызывать напрямую из backend.
"""

import logging
import os
import sys
from pathlib import Path
from typing import Any

import requests

# Ensure autoreg is in path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.cbor_utils import cbor_decode, cbor_encode
from core.kiro_config import get_kiro_user_agent

logger = logging.getLogger(__name__)

# Default endpoint
DEFAULT_WEBPORTAL_URL = "https://prod.us-east-1.webportal.kiro.dev"


class KiroWebPortalClient:
    """Клиент для Kiro Web Portal API.

    Особенности:
    - CBOR encoding/decoding (не JSON!)
    - Cookie-based authentication (как браузер)
    - Smithy RPC v2 protocol
    - Автоматическая обработка банов (423 status)

    Endpoints:
    - GetUserUsageAndLimits - получить квоту
    - GetUserInfo - получить инфо о пользователе
    - RefreshToken - обновить токены
    """

    def __init__(self, timeout: int = 30, endpoint: str | None = None, proxy: str | None = None):
        """Args:
        timeout: Таймаут запросов в секундах
        endpoint: Custom endpoint URL (defaults to config/env)
        proxy: Optional proxy URL (e.g. socks5h://user:pass@host:port) to route requests through
        """
        self.timeout = timeout
        self.session = requests.Session()

        if proxy:
            self.session.proxies = {"http": proxy, "https": proxy}

        # Get endpoint from: parameter > env > default
        if endpoint:
            self.endpoint = endpoint
        else:
            self.endpoint = os.getenv("KIRO_WEBPORTAL_URL", DEFAULT_WEBPORTAL_URL)

    def _make_request(
        self,
        operation: str,
        request_data: dict[str, Any],
        access_token: str,
        idp: str = "Google",
        csrf_token: str | None = None,
        session_token: str | None = None,
    ) -> dict[str, Any]:
        """Выполняет CBOR RPC запрос к Web Portal.

        Args:
            operation: Имя операции (например, "GetUserUsageAndLimits")
            request_data: Данные запроса (будут закодированы в CBOR)
            access_token: Access token
            idp: Identity Provider (Google/Github)
            csrf_token: CSRF token (опционально)
            session_token: Session/Refresh token (опционально)

        Returns:
            Декодированный CBOR ответ

        Raises:
            ValueError: Если запрос не удался или аккаунт забанен
        """
        url = f"{self.endpoint}/service/KiroWebPortalService/operation/{operation}"

        # CBOR encode request
        try:
            body = cbor_encode(request_data)
        except Exception as e:  # noqa: BLE001
            raise ValueError(f"Failed to encode request: {e}") from e

        # Headers (имитируем Kiro IDE)
        headers = {
            "Content-Type": "application/cbor",
            "Accept": "application/cbor",
            "smithy-protocol": "rpc-v2-cbor",  # КРИТИЧНО!
            "authorization": f"Bearer {access_token}",
            "User-Agent": get_kiro_user_agent(),  # ВАЖНО для anti-detection!
        }

        # Cookie auth (как браузер!)
        cookies = [f"Idp={idp}", f"AccessToken={access_token}"]

        if csrf_token:
            headers["x-csrf-token"] = csrf_token
            cookies.append(f"csrfToken={csrf_token}")

        if session_token:
            cookies.append(f"RefreshToken={session_token}")

        headers["Cookie"] = "; ".join(cookies)

        logger.info("[WebPortal] %s Request", operation)
        logger.debug("URL: %s", url)
        logger.debug("Idp: %s", idp)
        logger.debug("Request data: %s", request_data)

        try:
            response = self.session.post(
                url,
                data=body,
                headers=headers,
                timeout=self.timeout,
            )

            status = response.status_code
            logger.info(
                "[WebPortal] %s Response: %s (%d bytes)",
                operation,
                status,
                len(response.content),
            )

            # Проверка на ошибки
            if not response.ok:
                # Пытаемся декодировать CBOR ошибку
                try:
                    error_data = cbor_decode(response.content)
                    error_msg = str(error_data)
                    logger.debug("[WebPortal] Error data: %s", error_data)
                except Exception:  # noqa: BLE001
                    error_msg = response.text

                logger.error("[WebPortal] Error (%s): %s", status, error_msg)

                # Проверка на бан (423 Locked = AccountSuspendedException)
                if status == 423 or "AccountSuspendedException" in error_msg:
                    raise ValueError("BANNED: Account suspended")

                # Проверка на невалидный токен
                if status == 401:
                    raise ValueError("UNAUTHORIZED: Token expired or invalid")

                raise ValueError(f"{operation} failed ({status}): {error_msg}")

            # CBOR decode response
            try:
                result = cbor_decode(response.content)
                if isinstance(result, dict):
                    logger.debug("[WebPortal] Response data keys: %s", list(result.keys()))
                    return result  # type: ignore[return-value]
                else:
                    logger.debug("[WebPortal] Response is not a dict: %r", type(result))
                    # Convert to dict if possible, otherwise return empty dict
                    return dict(result) if result else {}
            except Exception as e:  # noqa: BLE001
                logger.error("[WebPortal] Failed to decode response: %s", e)
                raise ValueError(f"Failed to decode response: {e}") from e

        except requests.RequestException as e:  # noqa: BLE001
            logger.error("[WebPortal] Network error: %s", e)
            raise ValueError(f"Network error: {e}") from e

    def get_user_usage_and_limits(
        self,
        access_token: str,
        idp: str = "Google",
    ) -> dict[str, Any]:
        """Получает информацию о квоте и использовании.

        Returns структура как у CodeWhisperer GetUsageLimits.
        """
        request_data = {
            "isEmailRequired": True,
            "origin": "KIRO_IDE",
        }

        return self._make_request("GetUserUsageAndLimits", request_data, access_token, idp)

    def get_user_info(
        self,
        access_token: str,
        idp: str = "Google",
    ) -> dict[str, Any]:
        """Получает информацию о пользователе."""
        request_data = {"origin": "KIRO_IDE"}

        return self._make_request("GetUserInfo", request_data, access_token, idp)

    def refresh_token(
        self,
        access_token: str,
        csrf_token: str,
        session_token: str,
        idp: str = "Google",
    ) -> dict[str, Any]:
        """Обновляет токены через RefreshToken."""
        request_data = {"csrfToken": csrf_token}

        return self._make_request(
            "RefreshToken",
            request_data,
            access_token,
            idp,
            csrf_token,
            session_token,
        )
