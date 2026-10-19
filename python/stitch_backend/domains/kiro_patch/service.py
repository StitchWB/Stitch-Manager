"""Kiro Patch V3 service — config CRUD + patch operations.

Ported from Rust ``commands/kiro_patch.rs``.
Config lives in ``~/.stitch-manager/kiro-patch-config.json``.
Patch injection/removal delegates to a helper module.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import uuid
from pathlib import Path
from typing import Any, cast

from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

# ── Defaults ──────────────────────────────────────────────────────────────────

_DEFAULT_CONFIG: dict[str, Any] = {
    "version": 4,
    "modules": {
        "proxyInjection": True,
    },
    "machineId": "",
    "accountBindings": {},
    "currentAccountId": None,
    "logLevel": "info",
    "proxyPort": 5580,
    "outboundProxy": "",  # Format: host:port:user:pass or socks5://user:pass@host:port
    "constants": {
        "writeLimit": "500 lines",
        "iterationLimit": 1000,
        "agentIterationLimit": 1000,
        "defaultMaxTokens": 4096,
        "defaultContextLength": 16384,
        "maxSnippetPercentage": 0.6,
    },
    "promptsPath": None,
}

# ── Config file helpers ───────────────────────────────────────────────────────

def _config_dir() -> Path:
    """Get config directory, creating it if needed.

    Caches the result to avoid repeated mkdir() calls.
    """
    if not hasattr(_config_dir, '_cache'):
        home = Path.home()
        d = home / ".stitch-manager"
        d.mkdir(parents=True, exist_ok=True)
        cast("Any", _config_dir)._cache = d
    return cast("Path", cast("Any", _config_dir)._cache)


def _config_path() -> Path:
    return _config_dir() / "kiro-patch-config.json"


# ── Proxy credential encryption ───────────────────────────────────────────────
# Strategy: outbound proxy credentials (user:pass@host:port) are encrypted at
# rest in the JSON config using Fernet symmetric encryption. The key is derived
# via SHA-256 from the config's machineId (a per-installation UUID). This
# prevents casual inspection of the config file but not a determined attacker
# with machine access. Backward compat: plaintext proxies (no "gAAAA" prefix)
# pass through unchanged on read, and are encrypted on next save.

def _get_encryption_key(machine_id: str) -> bytes:
    """Derive a Fernet key from the machine ID (deterministic per installation)."""
    key = hashlib.sha256(machine_id.encode()).digest()
    return base64.urlsafe_b64encode(key)


def _encrypt_proxy(proxy: str, machine_id: str) -> str:
    """Encrypt proxy credentials. Returns plaintext if no credentials or already encrypted."""
    # No proxy, or no @ (no credentials, or already a Fernet token — those have no @)
    if not proxy or "@" not in proxy:
        return proxy
    if not machine_id:
        return proxy  # Cannot encrypt without a machine ID
    key = _get_encryption_key(machine_id)
    return Fernet(key).encrypt(proxy.encode()).decode()


def _decrypt_proxy(encrypted: str, machine_id: str) -> str:
    """Decrypt proxy credentials. Returns plaintext if not encrypted (backward compat)."""
    if not encrypted or not encrypted.startswith("gAAAA"):
        return encrypted  # Not encrypted — plaintext from old config
    if not machine_id:
        return encrypted  # Cannot decrypt without a machine ID
    try:
        key = _get_encryption_key(machine_id)
        return Fernet(key).decrypt(encrypted.encode()).decode()
    except Exception:
        return encrypted  # Decryption failed, return as-is


def get_config() -> dict[str, Any]:
    """Read config from disk or return defaults."""
    path = _config_path()
    if not path.exists():
        cfg = dict(_DEFAULT_CONFIG)
        cfg["machineId"] = str(uuid.uuid4())
        return cfg
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        # Ensure machineId exists
        if not data.get("machineId"):
            data["machineId"] = str(uuid.uuid4())
        # Decrypt outbound proxy if encrypted (backward compat: plaintext passes through)
        data["outboundProxy"] = _decrypt_proxy(
            data.get("outboundProxy", ""), data["machineId"]
        )
        return cast("dict[str, Any]", data)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to read kiro config: %s", exc)
        cfg = dict(_DEFAULT_CONFIG)
        cfg["machineId"] = str(uuid.uuid4())
        return cfg


def save_config(config: dict[str, Any]) -> None:
    """Write config to disk."""
    path = _config_path()
    # Encrypt outbound proxy credentials at rest; work on a copy so the
    # caller's dict retains plaintext for runtime use.
    to_write = dict(config)
    machine_id = config.get("machineId", "")
    to_write["outboundProxy"] = _encrypt_proxy(
        config.get("outboundProxy", ""), machine_id
    )
    path.write_text(json.dumps(to_write, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Machine ID ────────────────────────────────────────────────────────────────

def generate_machine_id() -> str:
    return str(uuid.uuid4())


def bind_machine_id(account_id: str, machine_id: str) -> None:
    """Bind a machine ID to an account and set it as current."""
    config = get_config()
    bindings = config.setdefault("accountBindings", {})
    bindings[account_id] = machine_id
    config["currentAccountId"] = account_id
    config["machineId"] = machine_id
    save_config(config)


def unbind_account(account_id: str) -> None:
    """Remove an account binding."""
    config = get_config()
    bindings = config.get("accountBindings", {})
    bindings.pop(account_id, None)
    config["accountBindings"] = bindings
    save_config(config)


def get_account_bindings() -> dict[str, str]:
    config = get_config()
    return cast("dict[str, str]", config.get("accountBindings", {}))


# ── Patch operations ──────────────────────────────────────────────────────────

# Patch marker strings (V2 and V3)
_PATCH_MARKERS = [
    "/* STITCH_PATCHED - V3 WITH CONFIGURATION */",
    "/* STITCH_PATCHED - V3 */",
    "/* STITCH_PATCHED - V2 WITH CONFIGURATION */",
    "/* STITCH_PATCHED - V2 */",
    "/* STITCH_PATCHED - V1 */",
]


def _generate_proxy_inject_code(proxy_port: int = 5580) -> str:
    """Generate proxy injection code with HTTP error handling."""
    return f"""/* STITCH_PROXY_INJECT - V3 */
(function() {{
  try {{
    const http = require('http');
    const https = require('https');
    const PROXY_HOST = '127.0.0.1';
    const PROXY_PORT = {proxy_port};

    const origHttpRequest = http.request;
    const origHttpsRequest = https.request;

    function createProxyWrapper(originalFn, defaultProtocol) {{
      return function(opts, cb) {{
        // Normalize options
        if (typeof opts === 'string') opts = new URL(opts);
        if (opts instanceof URL) {{
          opts = {{
            hostname: opts.hostname,
            port: opts.port,
            path: opts.pathname + opts.search,
            protocol: opts.protocol,
            headers: {{}}
          }};
        }}

        // Skip WebSocket upgrade requests — proxy can't handle them
        const reqHeaders = opts.headers || {{}};
        if (reqHeaders.Upgrade || reqHeaders.upgrade) {{
          return originalFn.call(this, opts, cb);
        }}

        const targetHost = opts.hostname || opts.host;
        const targetPort = opts.port || (defaultProtocol === 'https:' ? 443 : 80);
        const targetProtocol = opts.protocol || defaultProtocol;

        // Try proxy first
        const proxyOpts = {{
          ...opts,
          hostname: PROXY_HOST,
          port: PROXY_PORT,
          protocol: 'http:',
          headers: {{
            ...(opts.headers || {{}}),
            'X-Forwarded-Host': targetHost,
            'X-Forwarded-Proto': targetProtocol.replace(':', ''),
            'X-Forwarded-Port': String(targetPort)
          }}
        }};

        if (targetProtocol === 'https:') {{
          proxyOpts.path = `https://${{targetHost}}:${{targetPort}}${{opts.path}}`;
        }}

        // Make request through proxy with retry
        let attempt = 0;
        const maxAttempts = 3;
        let firstReq = null;
        let aborted = false;
        const safeCb = typeof cb === 'function' ? cb : function() {{}};
        const boundTryProxy = tryProxy.bind(this);

        function tryProxy() {{
          if (aborted) return;
          attempt++;
          var req;
          try {{
            req = originalFn.call(this, proxyOpts, function(res) {{
              if (aborted) return;
              if (res.statusCode >= 400) {{
                if (attempt < maxAttempts) {{
                  var delay = 500 * Math.pow(2, attempt - 1);
                  console.log('[Stitch] Proxy returned ' + res.statusCode + ', retrying in ' + delay + 'ms (attempt ' + attempt + '/' + maxAttempts + ')');
                  setTimeout(boundTryProxy, delay);
                }} else {{
                  console.error('[Stitch] Proxy failed after ' + maxAttempts + ' attempts, status ' + res.statusCode);
                  safeCb(res);
                }}
              }} else {{
                aborted = true;
                if (attempt > 1) console.log('[Stitch] Proxy connected on attempt ' + attempt);
                safeCb(res);
              }}
            }});
          }} catch (e) {{
            if (aborted) return;
            console.error('[Stitch] originalFn threw: ' + (e && e.message));
            if (attempt < maxAttempts) {{
              setTimeout(boundTryProxy, 500);
            }} else {{
              safeCb(null);
            }}
            return;
          }}

          if (!firstReq) firstReq = req;

          // ponytail: 5s timeout prevents infinite hangs
          req.setTimeout(5000, function() {{
            if (!aborted) {{
              aborted = true;
              console.error('[Stitch] Request timed out after 5000ms');
              req.destroy();
              safeCb(null);
            }}
          }});

          req.on('error', function(err) {{
            if (aborted) return;
            if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {{
              if (attempt < maxAttempts) {{
                var delay = 500 * Math.pow(2, attempt - 1);
                console.log('[Stitch] Proxy unavailable (' + err.code + '), retrying in ' + delay + 'ms (attempt ' + attempt + '/' + maxAttempts + ')');
                setTimeout(boundTryProxy, delay);
              }} else {{
                aborted = true;
                console.error('[Stitch] Proxy failed after ' + maxAttempts + ' attempts: ' + err.code);
                safeCb(null);
              }}
            }} else {{
              // ponytail: unknown errors still call cb — don't hang caller
              aborted = true;
              console.error('[Stitch] Proxy error: ' + err.code);
              safeCb(null);
            }}
          }});
        }}

        tryProxy.call(this);
        return firstReq;
      }};
    }}

    http.request = createProxyWrapper(origHttpRequest, 'http:');
    https.request = createProxyWrapper(origHttpsRequest, 'https:');

    console.log('[Stitch] HTTP/HTTPS proxy enabled: 127.0.0.1:{proxy_port}');
  }} catch (e) {{
    console.error('[Stitch] Proxy injection failed:', e);
  }}
}})();
"""


def _find_kiro_target_file() -> Path | None:
    """Locate the Kiro IDE main JS file to patch.

    Search strategy:
    - Windows: ``%LOCALAPPDATA%/Programs/Kiro/resources/app/out/vs/workbench/workbench.desktop.main.js``
    - Windows (extension): ``S:/Kiro/resources/app/extensions/kiro.kiro-agent/dist/extension.js``
    - macOS: ``/Applications/Kiro.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js``
    - macOS (extension): ``/Applications/Kiro.app/Contents/Resources/app/extensions/kiro.kiro-agent/dist/extension.js``

    Priority: extension.js (for proxy injection) > workbench.desktop.main.js (legacy)
    """
    import os
    candidates: list[Path] = []

    # Windows paths
    local_app = os.environ.get("LOCALAPPDATA", "")
    if local_app:
        # Extension path (priority for proxy injection)
        candidates.append(
            Path(local_app) / "Programs" / "Kiro" / "resources" / "app"
            / "extensions" / "kiro.kiro-agent" / "dist" / "extension.js"
        )
        # Legacy workbench path
        candidates.append(
            Path(local_app) / "Programs" / "Kiro" / "resources" / "app" / "out"
            / "vs" / "workbench" / "workbench.desktop.main.js"
        )

    # Custom Windows path (S:\Kiro)
    candidates.append(
        Path("S:/Kiro/resources/app/extensions/kiro.kiro-agent/dist/extension.js")
    )

    # macOS paths
    candidates.append(
        Path("/Applications/Kiro.app/Contents/Resources/app/extensions/kiro.kiro-agent/dist/extension.js")
    )
    candidates.append(
        Path("/Applications/Kiro.app/Contents/Resources/app/out/vs/workbench"
             "/workbench.desktop.main.js")
    )

    for c in candidates:
        if c.is_file():
            return c
    return None


def apply_patch_with_config(config: dict[str, Any]) -> str:
    """Save config then inject patch marker + optional proxy injection into Kiro's main JS file."""
    save_config(config)

    target = _find_kiro_target_file()
    if target is None:
        raise RuntimeError("Kiro IDE not found. Please install Kiro first.")

    content = target.read_text(encoding="utf-8")

    # Check if any patch marker already exists
    for m in _PATCH_MARKERS:
        if m in content:
            return f"Kiro patch is already applied ({m})."

    # Check if proxy injection is enabled (default: True)
    modules = config.get("modules", {})
    proxy_enabled = modules.get("proxyInjection", True)

    # Get proxy port from config (default: 5580)
    proxy_port = config.get("proxyPort", 5580)

    # Build injection code
    patch_marker = "/* STITCH_PATCHED - V3 WITH CONFIGURATION */"
    injection_parts = [patch_marker]
    if proxy_enabled:
        injection_parts.append(_generate_proxy_inject_code(proxy_port))

    injection = "\n".join(injection_parts) + "\n"

    # Find "use strict"; and inject after it
    strict_prefix = '"use strict";\n'
    if content.startswith(strict_prefix):
        patched = f'{strict_prefix}{injection}{content[len(strict_prefix):]}'
    else:
        # Fallback: inject at the very top
        patched = f"{injection}{content}"

    target.write_text(patched, encoding="utf-8")
    logger.info("Kiro patch applied to %s (proxy: %s)", target, "enabled" if proxy_enabled else "disabled")
    return f"Kiro patch applied successfully to {target.name} (proxy: {'enabled' if proxy_enabled else 'disabled'})"


def check_patch_status() -> dict[str, bool]:
    """Return patch status: marker found + proxy injection found."""
    target = _find_kiro_target_file()
    if target is None:
        return {"patched": False, "proxy_injected": False}
    try:
        # Read only first 5KB for speed (proxy injection is ~2KB)
        with open(target, encoding="utf-8") as f:
            head = f.read(5120)

        marker_found = any(m in head for m in _PATCH_MARKERS)

        # Check all proxy injection versions
        proxy_markers = [
            "/* STITCH_PROXY_INJECT - V1 */",
            "/* STITCH_PROXY_INJECT - V2 */",
            "/* STITCH_PROXY_INJECT - V3 */",
        ]
        proxy_found = any(m in head for m in proxy_markers)

        return {
            "patched": marker_found,
            "proxy_injected": proxy_found,
        }
    except OSError:
        return {"patched": False, "proxy_injected": False}


def remove_patch() -> str:
    """Remove patch markers and proxy injection from Kiro's main JS file."""
    target = _find_kiro_target_file()
    if target is None:
        raise RuntimeError("Kiro IDE not found.")

    content = target.read_text(encoding="utf-8")
    changed = False

    # Remove all version markers
    for marker in _PATCH_MARKERS:
        if marker in content:
            content = content.replace(marker + "\n", "")
            content = content.replace(marker, "")
            changed = True

    # Remove proxy injection code (all versions: V1, V2, V3)
    proxy_markers = [
        "/* STITCH_PROXY_INJECT - V1 */",
        "/* STITCH_PROXY_INJECT - V2 */",
        "/* STITCH_PROXY_INJECT - V3 */",
    ]

    for proxy_marker in proxy_markers:
        if proxy_marker in content:
            # Find and remove the entire proxy injection block
            start_marker = proxy_marker
            end_marker = "})();\n"

            start_idx = content.find(start_marker)
            if start_idx != -1:
                # Find the closing })();
                end_idx = content.find(end_marker, start_idx)
                if end_idx != -1:
                    end_idx += len(end_marker)
                    content = content[:start_idx] + content[end_idx:]
                    changed = True

    if changed:
        target.write_text(content, encoding="utf-8")
        logger.info("Kiro patch removed from %s", target)
        return "Kiro patch removed successfully."
    return "No Kiro patch found to remove."


if __name__ == "__main__":
    # ponytail: self-check for encrypt/decrypt round-trip + backward compat
    mid = "test-machine-id-1234"
    proxy = "socks5://user:p@ss@host:1080"
    enc = _encrypt_proxy(proxy, mid)
    assert enc != proxy and enc.startswith("gAAAA"), "encryption failed"
    assert _decrypt_proxy(enc, mid) == proxy, "decryption failed"
    # Backward compat: plaintext passes through unchanged
    assert _decrypt_proxy(proxy, mid) == proxy, "plaintext should pass through"
    # No credentials (no @) — not encrypted
    assert _encrypt_proxy("host:1080", mid) == "host:1080", "no-cred should not encrypt"
    # Empty / no machine_id — returned as-is
    assert _encrypt_proxy("", mid) == ""
    assert _encrypt_proxy(proxy, "") == proxy
    print("OK: proxy encryption round-trip + backward compat")
