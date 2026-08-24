"""Shared GitHub PR submission flow for plugin catalog contributions.

Extracted from ``community_commands._submit_pr_flow`` so both the community
submit-for-review path and the local-override patch-candidate path reuse the
same fork → branch → upload → PR sequence against
``StitchWB/stitch-plugin-catalog``.

Token is never logged or persisted — it lives only in the ``AsyncClient``
headers for the duration of the request and is dropped when the client
closes.
"""

from __future__ import annotations

import base64
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable

    import httpx

logger = logging.getLogger(__name__)

_GH_API = "https://api.github.com"
_CATALOG_OWNER = "StitchWB"
_CATALOG_REPO = "stitch-plugin-catalog"


async def submit_catalog_pr(
    client: httpx.AsyncClient,
    files: Iterable[tuple[str, bytes]],
    branch: str,
    pr_title: str,
    pr_body: str,
) -> dict[str, Any]:
    """Open a PR against ``StitchWB/stitch-plugin-catalog``.

    Flow: GET /user → ensure fork → branch from catalog main → PUT each
    file → POST pulls.  Token is in ``client`` headers.

    Args:
        client: authenticated ``httpx.AsyncClient`` (Bearer token in headers).
        files: iterable of ``(rel_path, content_bytes)`` to upload to the
            branch.  ``rel_path`` is the path inside the catalog repo.
        branch: target branch name (without ``refs/heads/`` prefix).
        pr_title: PR title.
        pr_body: PR body markdown.

    Returns ``{"success": True, "pr_url": ...}`` or
    ``{"success": False, "error": ...}``.
    """
    # 1. GET /user → login
    resp = await client.get(f"{_GH_API}/user")
    if resp.status_code != 200:
        return {"success": False, "error": f"invalid token (status {resp.status_code})"}
    login = resp.json().get("login", "")
    if not login:
        return {"success": False, "error": "could not determine github user"}

    # 2. Ensure fork exists
    fork_resp = await client.get(f"{_GH_API}/repos/{login}/{_CATALOG_REPO}")
    if fork_resp.status_code == 404:
        create = await client.post(
            f"{_GH_API}/repos/{_CATALOG_OWNER}/{_CATALOG_REPO}/forks"
        )
        if create.status_code not in (200, 202):
            return {"success": False, "error": f"fork failed (status {create.status_code})"}
    elif fork_resp.status_code != 200:
        return {"success": False, "error": f"fork check failed (status {fork_resp.status_code})"}

    # 3. Get catalog main head + create branch
    refs = await client.get(
        f"{_GH_API}/repos/{login}/{_CATALOG_REPO}/git/refs/heads/main"
    )
    if refs.status_code != 200:
        return {"success": False, "error": f"catalog main head fetch failed (status {refs.status_code})"}
    main_sha = refs.json().get("object", {}).get("sha", "")
    if not main_sha:
        return {"success": False, "error": "catalog main head sha missing"}

    create_branch = await client.post(
        f"{_GH_API}/repos/{login}/{_CATALOG_REPO}/git/refs",
        json={"ref": f"refs/heads/{branch}", "sha": main_sha},
    )
    if create_branch.status_code not in (200, 201, 422):
        return {"success": False, "error": f"branch create failed (status {create_branch.status_code})"}

    # 4. PUT each file
    for rel_path, content in files:
        encoded = base64.b64encode(content).decode("ascii")
        put = await client.put(
            f"{_GH_API}/repos/{login}/{_CATALOG_REPO}/contents/{rel_path}",
            json={
                "message": f"add {rel_path} to {branch}",
                "content": encoded,
                "branch": branch,
            },
        )
        if put.status_code not in (200, 201):
            return {"success": False, "error": f"upload {rel_path} failed (status {put.status_code})"}

    # 5. Open PR
    pr = await client.post(
        f"{_GH_API}/repos/{_CATALOG_OWNER}/{_CATALOG_REPO}/pulls",
        json={
            "title": pr_title,
            "head": f"{login}:{branch}",
            "base": "main",
            "body": pr_body,
        },
    )
    if pr.status_code not in (200, 201):
        return {"success": False, "error": f"pr create failed (status {pr.status_code})"}
    pr_url = pr.json().get("html_url", "")
    if not pr_url:
        return {"success": False, "error": "pr created but url missing"}
    return {"success": True, "pr_url": pr_url}
