"""OpenCode API tester — discover models from a base URL + API key."""

from __future__ import annotations

import json

import httpx


class OpenCodeApiTester:
    """Test an OpenAI-compatible API and discover available models."""

    @staticmethod
    async def test_api(base_url: str, api_key: str) -> dict:
        """GET {base_url}/v1/models with Bearer auth, return model list or error.

        Returns:
            {"success": True, "models": ["model1", ...]} on success.
            {"success": False, "error": "message"} on failure.
        """
        url = f"{base_url.rstrip('/')}/v1/models"
        headers = {"Authorization": f"Bearer {api_key}"}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()
                models = [item["id"] for item in data.get("data", [])]
                return {"success": True, "models": models}
        except httpx.HTTPStatusError as exc:
            return {
                "success": False,
                "error": f"HTTP {exc.response.status_code}: {exc.response.text}",
            }
        except httpx.TimeoutException:
            return {"success": False, "error": "Request timed out"}
        except httpx.ConnectError:
            return {"success": False, "error": "Connection failed"}
        except (json.JSONDecodeError, ValueError, KeyError):
            return {"success": False, "error": "Invalid response format"}