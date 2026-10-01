"""Export/import of ``ai_proxy_accounts`` payloads (JSON or CSV)."""

from __future__ import annotations

import json
from datetime import UTC
from typing import Any

from .account_store import AiProxyAccountStore


async def export_accounts_payload(
    session: Any, fmt: str = "json", include_secrets: bool = False
) -> str:
    accounts = await AiProxyAccountStore.get_accounts(session)
    export_rows = []
    for a in accounts:
        row: dict[str, Any] = {
            "provider": a["provider"],
            "name": a["name"],
            "enabled": a["enabled"],
            "accountType": a["accountType"],
            "softQuotaTokensDaily": a["softQuotaTokensDaily"],
            "softQuotaRequestsDaily": a["softQuotaRequestsDaily"],
        }
        if include_secrets:
            row["oauthToken"] = a["oauthToken"]
            row["apiKey"] = a["apiKey"]
            row["sessionToken"] = a["sessionToken"]
        export_rows.append(row)

    payload = {
        "version": 1,
        "exportedAt": _iso_now(),
        "includeSecrets": include_secrets,
        "accounts": export_rows,
    }

    if fmt.lower() == "csv":
        lines = ["provider,name,enabled,account_type"]
        for a in export_rows:
            lines.append(
                f'"{a["provider"]}","{a["name"]}",{1 if a["enabled"] else 0},"{a.get("accountType", "")}"'
            )
        return "\n".join(lines)

    return json.dumps(payload, indent=2)


async def import_accounts_payload(session: Any, payload_str: str) -> int:
    data = json.loads(payload_str)
    accounts = data.get("accounts", [])
    existing = await AiProxyAccountStore.get_accounts(session)
    existing_keys = {
        f"{a['provider'].lower()}::{a['name'].lower()}" for a in existing
    }

    imported = 0
    for row in accounts:
        provider = row.get("provider", "").lower()
        name = row.get("name", "")
        dedupe_key = f"{provider}::{name.lower()}"
        if dedupe_key in existing_keys:
            continue
        account = {
            "provider": provider,
            "name": name,
            "enabled": row.get("enabled", True),
            "accountType": row.get("accountType"),
            "softQuotaTokensDaily": row.get("softQuotaTokensDaily"),
            "softQuotaRequestsDaily": row.get("softQuotaRequestsDaily"),
            "oauthToken": row.get("oauthToken"),
            "apiKey": row.get("apiKey"),
            "sessionToken": row.get("sessionToken"),
        }
        await AiProxyAccountStore.create_account(session, account)
        existing_keys.add(dedupe_key)
        imported += 1
    return imported


def _iso_now() -> str:
    from datetime import datetime
    return datetime.now(UTC).isoformat()
