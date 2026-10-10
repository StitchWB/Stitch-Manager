"""Host-side keyring for service plugins: ``host.secrets.*`` reverse-RPC.

Namespace isolation invariant: the plugin identity is bound at wiring
time — :func:`register_secret_handlers` closes over the plugin's
manifest id — and is NEVER taken from request params.  A forged
``pluginId`` param cannot make one plugin read, write, or list another
plugin's names.

Values are encrypted at rest with the host's process-wide Fernet key
(:mod:`stitch_backend.security.fernet_at_rest` — ``TOKEN_ENCRYPTION_KEY``
env var or the auto-generated ``.db_key`` file); plugins never see the
key or the plaintext at rest.  Storage follows the plugin_runtime
domain's host-side persistence pattern (pending_reports): JSON files
under ``<data_dir>/plugin_secrets/``.

Every set/delete appends an audit log line with the plugin id and the
secret NAME only — values are never logged.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from typing import TYPE_CHECKING, Any

from stitch_backend.domains.plugin_distribution.config import data_dir
from stitch_backend.security.fernet_at_rest import decrypt, encrypt

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

_DIR_NAME = "plugin_secrets"

_NAME_RE = re.compile(r"[A-Za-z0-9_.-]{1,64}")

_MAX_VALUE_BYTES = 64 * 1024


def _secrets_dir() -> Path:
    return data_dir() / _DIR_NAME


def _validate_name(name: str) -> None:
    if not isinstance(name, str) or not _NAME_RE.fullmatch(name):
        raise ValueError(f"invalid secret name: {name!r}")


def _validate_value(value: str) -> None:
    if not isinstance(value, str):
        raise ValueError("secret value must be a string")
    if len(value.encode("utf-8")) > _MAX_VALUE_BYTES:
        raise ValueError(f"secret value exceeds {_MAX_VALUE_BYTES} bytes")


class PluginSecretStore:
    """Per-plugin secret store: one JSON file mapping name → Fernet token.

    File: ``<data_dir>/plugin_secrets/<plugin_id>.json``.  Names are
    stored in plaintext (they are returned by ``list`` and written to the
    audit log); values only as Fernet tokens.  A corrupt or non-dict
    file is treated as empty with a warning (tolerant reader, same as
    pending_reports); an undecryptable token raises on ``get`` (wrong
    key is explicit, never silent).
    """

    def __init__(self, plugin_id: str) -> None:
        self._plugin_id = plugin_id
        self._path = _secrets_dir() / f"{plugin_id}.json"
        self._lock = threading.Lock()

    def get(self, name: str) -> str | None:
        """Return the plaintext value for ``name``, or None when absent."""
        _validate_name(name)
        with self._lock:
            token = self._load().get(name)
        if token is None:
            return None
        return decrypt(token)

    def set(self, name: str, value: str) -> None:
        """Encrypt and store ``value`` under ``name`` (overwrites)."""
        _validate_name(name)
        _validate_value(value)
        token = encrypt(value)
        with self._lock:
            tokens = self._load()
            tokens[name] = token
            self._write(tokens)
        logger.info("host.secrets.set plugin=%s name=%s", self._plugin_id, name)

    def delete(self, name: str) -> None:
        """Remove ``name`` (idempotent: absent name is not an error)."""
        _validate_name(name)
        with self._lock:
            tokens = self._load()
            if name in tokens:
                del tokens[name]
                self._write(tokens)
        logger.info("host.secrets.delete plugin=%s name=%s", self._plugin_id, name)

    def list_names(self) -> list[str]:
        """Return all stored names for this plugin (sorted)."""
        with self._lock:
            return sorted(self._load())

    def _load(self) -> dict[str, str]:
        try:
            raw = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {}
        try:
            data = json.loads(raw)
        except ValueError:
            logger.warning(
                "host.secrets: corrupt store %s; treating as empty", self._path
            )
            return {}
        if not isinstance(data, dict):
            logger.warning(
                "host.secrets: non-dict store %s; treating as empty", self._path
            )
            return {}
        return {
            k: v for k, v in data.items()
            if isinstance(k, str) and isinstance(v, str)
        }

    def _write(self, tokens: dict[str, str]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_name(self._path.name + ".tmp")
        tmp.write_text(
            json.dumps(tokens, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        os.replace(tmp, self._path)


def register_secret_handlers(client: Any, plugin_id: str) -> None:
    """Wire the ``host.secrets.*`` reverse-RPC handlers on *client*.

    The namespace is bound to *plugin_id* here (closure at wiring time);
    request params never influence it — a forged ``pluginId`` param is
    ignored.  Handlers are sync (required by
    ``RpcPluginClient.set_request_handler``); invalid input raises
    ``ValueError``, which the RPC layer returns to the plugin as a
    JSON-RPC error (same convention as the other reverse-RPC handlers).
    """
    store = PluginSecretStore(plugin_id)

    def _get(params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("name")
        return {"name": name, "value": store.get(name)}

    def _set(params: dict[str, Any]) -> dict[str, Any]:
        store.set(params.get("name"), params.get("value"))
        return {"ok": True}

    def _delete(params: dict[str, Any]) -> dict[str, Any]:
        store.delete(params.get("name"))
        return {"ok": True}

    def _list(params: dict[str, Any]) -> dict[str, Any]:
        return {"names": store.list_names()}

    client.set_request_handler("host.secrets.get", _get)
    client.set_request_handler("host.secrets.set", _set)
    client.set_request_handler("host.secrets.delete", _delete)
    client.set_request_handler("host.secrets.list", _list)


__all__ = ["PluginSecretStore", "register_secret_handlers"]
