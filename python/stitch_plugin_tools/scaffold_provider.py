"""kind=provider scaffold (ADR-005 package contract)."""


from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any

from autoreg.plugin.manifest import SCHEMA_ID_V2
from stitch_plugin_tools.scaffold_common import (
    CANONICAL_ENGINE,
    _validate_plugin_id,
    generated_by_field,
)

if TYPE_CHECKING:
    from pathlib import Path

_PROVIDER_PY_TEMPLATE = '''"""{display_name} registration provider (ADR-005 package contract)."""

from typing import Any

from autoreg.provider_sdk import CommonProvider, ProviderConfig

from .config import SIGNUP_URL, get_token_path


class {class_name}(CommonProvider):
    """{display_name} automated registration."""

    _config = ProviderConfig(
        id="{plugin_id}",
        name="{display_name}",
        auth_url=SIGNUP_URL,
        token_path=str(get_token_path()),
    )

    @property
    def config(self) -> ProviderConfig:
        return self._config

    def register(
        self,
        email: str | None = None,
        password: str | None = None,
        name: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        # Flow: email strategy -> browser automation -> token capture; see autoreg/providers/README.md for patterns.
        raise NotImplementedError("implement the registration flow")


__all__ = ["{class_name}"]
'''

_PROVIDER_CONFIG_TEMPLATE = '''"""{display_name} provider configuration."""

from pathlib import Path

from autoreg.core.paths import get_paths

SIGNUP_URL = "https://example.com/signup"


def get_token_path() -> Path:
    """Storage path for {display_name} tokens."""
    return get_paths().tokens_dir / "{plugin_id}"
'''

_PROVIDER_TEST_TEMPLATE = '''"""Contract test for the {display_name} provider package (ADR-005).

Runs without the SDK or a browser: validates the manifest shape and that
the entry class named in ``plugin.json`` is defined in ``provider.py``.
"""

import ast
import json
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent


def _manifest() -> dict:
    return json.loads((PKG / "plugin.json").read_text(encoding="utf-8"))


def test_manifest_contract() -> None:
    manifest = _manifest()
    assert manifest["kind"] == "provider"
    assert manifest["capabilities"] == ["autoreg.{plugin_id}"]
    entry = manifest["entry"]
    assert entry["module"] == "provider.py"
    assert (PKG / entry["module"]).is_file()
    meta = manifest["meta"]
    assert meta["display_name"]
    assert meta["category"] in ("ide", "git", "cloud", "ai")


def test_entry_class_defined() -> None:
    manifest = _manifest()
    tree = ast.parse((PKG / "provider.py").read_text(encoding="utf-8"))
    classes = {{n.name for n in tree.body if isinstance(n, ast.ClassDef)}}
    assert manifest["entry"]["class"] in classes
'''

_PROVIDER_README_TEMPLATE = '''# {display_name} provider

Registration method provider (ADR-005 package contract). Layout:

- `plugin.json` — manifest: `kind=provider`, `capabilities: ["autoreg.{plugin_id}"]`, entry point, `meta` block
- `provider.py` — provider class (entry point)
- `config.py` — URLs and storage paths
- `tests/` — contract test (no browser, no SDK needed)

## Dev loop

```bash
# install the SDK once (Zone-1, public):
pip install "autoreg @ git+https://github.com/StitchWB/Stitch-Manager.git#subdirectory=python"

# link the working copy into the app (edits are live, no re-install):
python -m stitch_plugin_tools dev-install --link .

# run the contract test:
python -m stitch_plugin_tools test .
```

## Publish

```bash
python -m stitch_plugin_tools pack-provider {plugin_id} <out>
python -m stitch_plugin_tools sign <out> --key <private.key>
```

Provider discovery, trust channels and the manual/server install model:
`docs/architecture/ADR-006-provider-install-channels.md` in the hub.
'''


def scaffold_provider_plugin(
    out_dir: Path,
    *,
    plugin_id: str,
    name: str = "",
    author: str = "",
    version: str = "0.1.0",
    description: str = "",
    category: str = "productivity",
    status: str = "beta",
    icon: str = "🧩",
) -> Path:
    """Scaffold a ``kind=provider`` package (ADR-005 contract) into ``out_dir``.

    Creates ``plugin.json`` (with the ``meta`` block the hub registry reads),
    ``provider.py`` (SDK-based skeleton), ``config.py``, ``__init__.py``,
    ``tests/test_provider_contract.py`` and ``README.md``.  The directory is
    created if absent; existing files are overwritten.

    Args:
        out_dir: Target directory for the package (created if absent).
        plugin_id: Provider id (``[A-Za-z0-9_-]``), e.g. ``"cursor"``.
        name: Human-readable name (defaults to ``plugin_id``).
        author: Optional author name.
        version: Semver version string (default ``"0.1.0"``).
        description: Short plain-text description (default: generated from
            the display name).
        category: Marketplace category (default ``"productivity"``).
        status: Marketplace status (default ``"beta"``).
        icon: Single emoji shown in the marketplace (default ``"🧩"``).

    Returns:
        The path to the assembled package directory (``out_dir``).
    """
    _validate_plugin_id(plugin_id)
    display_name = name or plugin_id
    class_name = (
        "".join(part.capitalize() for part in re.split(r"[-_]", plugin_id))
        + "Provider"
    )

    out_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, Any] = {
        "schema": SCHEMA_ID_V2,
        "id": f"{plugin_id.replace('_', '-')}-autoreg",
        "name": f"{display_name} provider",
        "description": description
        or f"Code plugin for the {display_name} registration provider.",
        "version": version,
        "service": plugin_id,
        "kind": "provider",
        "engine": dict(CANONICAL_ENGINE),
        "depends": [],
        "entry": {"module": "provider.py", "class": class_name},
        "capabilities": [f"autoreg.{plugin_id}"],
        "outputs": [],
        "category": category,
        "status": status,
        "icon": icon,
        "meta": {
            "display_name": display_name,
            "category": "ide",
            "has_autoreg": True,
            "is_ai_proxy": False,
            "aliases": [],
        },
        "generated_by": generated_by_field(),
        "signature": "",
    }
    if author:
        manifest["author"] = author
    (out_dir / "plugin.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    (out_dir / "provider.py").write_text(
        _PROVIDER_PY_TEMPLATE.format(
            display_name=display_name,
            class_name=class_name,
            plugin_id=plugin_id,
        ),
        encoding="utf-8",
    )
    (out_dir / "config.py").write_text(
        _PROVIDER_CONFIG_TEMPLATE.format(
            display_name=display_name, plugin_id=plugin_id
        ),
        encoding="utf-8",
    )
    (out_dir / "__init__.py").write_text(
        f'"""{display_name} provider package."""\n\n'
        f"# Deliberately empty: do not import the provider here.  The entry\n"
        f"# module needs the SDK (autoreg.provider_sdk); an eager import\n"
        f"# breaks test collection where the SDK is not installed.\n",
        encoding="utf-8",
    )

    tests_dir = out_dir / "tests"
    tests_dir.mkdir(exist_ok=True)
    (tests_dir / "__init__.py").write_text(
        f'"""Test package for the {plugin_id} provider plugin."""\n',
        encoding="utf-8",
    )
    (tests_dir / "test_provider_contract.py").write_text(
        _PROVIDER_TEST_TEMPLATE.format(
            display_name=display_name, plugin_id=plugin_id
        ),
        encoding="utf-8",
    )

    (out_dir / "README.md").write_text(
        _PROVIDER_README_TEMPLATE.format(
            display_name=display_name, plugin_id=plugin_id
        ),
        encoding="utf-8",
    )

    return out_dir
