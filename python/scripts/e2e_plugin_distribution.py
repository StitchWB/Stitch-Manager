#!/usr/bin/env python3
"""End-to-end plugin distribution run for Phase 3.

Proves the full cycle WITHOUT any binary release:
  activate -> publish kiro-autoreg v1.0.0 -> client sync installs it
  -> publish v1.0.1 (one selector changed) -> client sync picks up the new version.

Real server process, real HTTP, real client sync code -- no mocking of the
distribution path.  All temp artifacts live outside the repo; the real
%LOCALAPPDATA%\\stitch-manager data and repo .env are never touched.

Exit code: 0 = PASS, 1 = FAIL.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import traceback
import zipfile
from datetime import UTC, datetime
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────

_SCRIPT_DIR = Path(__file__).resolve().parent
_PYTHON_DIR = _SCRIPT_DIR.parent  # python/
_REPO_ROOT = _PYTHON_DIR.parent  # repo root

if str(_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(_PYTHON_DIR))

# ── Imports (after sys.path setup) ─────────────────────────────────────────────

import httpx  # noqa: E402

from autoreg.plugin.crypto import generate_keypair  # noqa: E402
from autoreg.plugin.install import list_installed_versions  # noqa: E402
from autoreg.plugin.layout import plugin_cache_path  # noqa: E402
from stitch_backend.domains.plugin_distribution.activation import (  # noqa: E402
    ActivationService,
)
from stitch_backend.domains.plugin_distribution.sync import PluginSyncService  # noqa: E402
from stitch_plugin_tools.publish import publish_package  # noqa: E402
from stitch_plugin_tools.watermark import inject_watermark, marker_for  # noqa: E402

# ── Constants ───────────────────────────────────────────────────────────────────

_PACKAGES_SRC = _REPO_ROOT / "prepared_area" / "plugin_packages"
_KIRO_AUTOREG = "kiro-autoreg"
_AWS_BUILDER_ID = "aws-builder-id"
_SERVER_STARTUP_TIMEOUT = 30  # seconds


# ── Helpers ───────────────────────────────────────────────────────────────────


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_server(url: str, timeout: int = _SERVER_STARTUP_TIMEOUT) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = httpx.get(f"{url}/health", timeout=2)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def _insert_activation_code(db_path: Path, code: str) -> None:
    """Insert a one-time activation code directly into the server DB.

    The server uses WAL mode, so concurrent sqlite3 access is safe.
    Tables are created on server startup via create_all_tables().

    The ``code_hash`` column stores the sha256 of the raw code (mirroring
    :func:`stitch_server.auth.hash_code`) — the raw code is never persisted.
    """
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "INSERT INTO ss_activation_codes (code_hash, entitlements, used, created_at) "
            "VALUES (?, ?, 0, ?)",
            (code_hash, '["*"]', datetime.now(UTC).isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def _copy_package(src: Path, dst: Path) -> Path:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    return dst


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _save_json(path: Path, data: dict) -> None:
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def _assert_installed(plugin_id: str, version: str, label: str) -> bool:
    """Assert a plugin version is installed with a valid signed manifest."""
    installed = list_installed_versions(plugin_id)
    if version not in installed:
        print(
            f"  [FAIL] {label}: {plugin_id}@{version} NOT installed "
            f"(found: {installed})"
        )
        return False
    path = plugin_cache_path(plugin_id, version)
    manifest_path = path / "plugin.json"
    if not manifest_path.is_file():
        print(f"  [FAIL] {label}: {plugin_id}@{version} manifest missing")
        return False
    manifest = _load_json(manifest_path)
    actual_version = manifest.get("version", "")
    if actual_version != version:
        print(
            f"  [FAIL] {label}: {plugin_id}@{version} manifest version="
            f"{actual_version}"
        )
        return False
    sig = manifest.get("signature", "")
    if not sig.startswith("ed25519:"):
        print(
            f"  [FAIL] {label}: {plugin_id}@{version} signature missing/invalid"
        )
        return False
    print(
        f"  [OK] {label}: {plugin_id}@{version} installed, "
        f"manifest OK, signature present"
    )
    return True


# ── Main ───────────────────────────────────────────────────────────────────────


async def _run() -> int:
    steps: list[tuple[str, bool, str]] = []
    proc: subprocess.Popen | None = None
    tmpdir: Path | None = None

    def record(name: str, ok: bool, detail: str = "") -> None:
        steps.append((name, ok, detail))
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {name}{f' -- {detail}' if detail else ''}")

    try:
        # ── Step 0: Create temp workspace ───────────────────────────────────
        print("\n=== Step 0: Create temp workspace ===")
        tmpdir = Path(tempfile.mkdtemp(prefix="stitch-e2e-"))
        print(f"  temp dir: {tmpdir}")

        server_db_path = tmpdir / "server.db"
        server_db_url = (
            f"sqlite+aiosqlite:///{server_db_path.as_posix()}"
        )
        server_plugins_dir = tmpdir / "server_plugins"
        server_reports_dir = tmpdir / "server_reports"
        client_data_dir = tmpdir / "client_data"
        keys_dir = tmpdir / "keys"
        packages_work = tmpdir / "packages"

        for d in (
            server_plugins_dir,
            server_reports_dir,
            client_data_dir,
            keys_dir,
            packages_work,
        ):
            d.mkdir(parents=True, exist_ok=True)

        # ── Step 1: Generate dev keypair ───────────────────────────────────
        print("\n=== Step 1: Generate dev ed25519 keypair ===")
        priv_pem, pub_b64 = generate_keypair()
        (keys_dir / "private.key").write_bytes(priv_pem)
        (keys_dir / "public.key").write_text(
            pub_b64 + "\n", encoding="utf-8"
        )
        print(f"  public key (b64): {pub_b64[:12]}...")
        record("keygen", True, f"pubkey={pub_b64[:12]}...")

        # ── Step 2: Start stitch_server ────────────────────────────────────
        print("\n=== Step 2: Start stitch_server ===")
        port = _find_free_port()
        server_url = f"http://127.0.0.1:{port}"
        admin_key = secrets.token_hex(16)

        server_env = os.environ.copy()
        server_env.update(
            {
                "PYTHONPATH": str(_PYTHON_DIR),
                "STITCH_SERVER_HOST": "127.0.0.1",
                "STITCH_SERVER_PORT": str(port),
                "STITCH_SERVER_DATABASE_URL": server_db_url,
                "STITCH_SERVER_PUBKEY": pub_b64,
                "STITCH_SERVER_ADMIN_KEY": admin_key,
                "STITCH_SERVER_DEV_MODE": "false",
                "STITCH_SERVER_PLUGINS_DIR": str(server_plugins_dir),
                "STITCH_SERVER_REPORTS_DIR": str(server_reports_dir),
                "STITCH_SERVER_LOG_LEVEL": "WARNING",
            }
        )

        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "stitch_server.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--log-level",
                "warning",
            ],
            env=server_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        ready = _wait_for_server(
            server_url, timeout=_SERVER_STARTUP_TIMEOUT
        )
        if not ready:
            try:
                out = (
                    proc.stdout.read()
                    if proc.stdout
                    else b""
                )
                print(
                    f"  server output:\n{out.decode(errors='replace')}"
                )
            except Exception:
                pass
            record("server_start", False, "server did not become ready")
            return 1
        print(f"  server ready at {server_url}")
        record("server_start", True, f"port={port}")

        # ── Step 3: Create activation code ─────────────────────────────────
        print("\n=== Step 3: Create activation code ===")
        activation_code = secrets.token_hex(16)
        _insert_activation_code(server_db_path, activation_code)
        print(f"  activation code: {activation_code[:8]}...")
        record(
            "create_activation_code",
            True,
            f"code={activation_code[:8]}...",
        )

        # ── Step 4: Client activate ─────────────────────────────────────────
        print("\n=== Step 4: Client activate ===")
        os.environ["STITCH_SERVER_URL"] = server_url
        os.environ["STITCH_PLUGINS_DIR"] = str(client_data_dir)

        hwid = hashlib.sha256(secrets.token_bytes(32)).hexdigest()
        activation = ActivationService()
        state = await activation.activate(activation_code, hwid)
        activation_file = client_data_dir / ".activation"
        if not activation_file.is_file():
            record(
                "client_activate",
                False,
                "activation file not created",
            )
            return 1
        print(f"  token: {state.token[:8]}...")
        print(f"  pubkey: {state.pubkey[:12]}...")
        record(
            "client_activate",
            True,
            f"token={state.token[:8]}...",
        )

        # ── Step 5: Publish v1.0.0 ─────────────────────────────────────────
        print(
            "\n=== Step 5: Publish v1.0.0 "
            "(aws-builder-id + kiro-autoreg) ==="
        )
        aws_pkg = _copy_package(
            _PACKAGES_SRC / _AWS_BUILDER_ID,
            packages_work / f"{_AWS_BUILDER_ID}-1.0.0",
        )
        kiro_pkg = _copy_package(
            _PACKAGES_SRC / _KIRO_AUTOREG,
            packages_work / f"{_KIRO_AUTOREG}-1.0.0",
        )

        result_aws = await publish_package(
            aws_pkg,
            server_url=server_url,
            admin_key=admin_key,
            signing_key_pem=priv_pem,
            rollout_percent=100,
        )
        print(
            f"  published: {result_aws['plugin_id']}@"
            f"{result_aws['version']} rollout="
            f"{result_aws['rollout_percent']}%"
        )
        record(
            "publish_aws_v1.0.0",
            result_aws.get("stored", False),
            f"{result_aws['plugin_id']}@{result_aws['version']}",
        )

        result_kiro = await publish_package(
            kiro_pkg,
            server_url=server_url,
            admin_key=admin_key,
            signing_key_pem=priv_pem,
            rollout_percent=100,
        )
        print(
            f"  published: {result_kiro['plugin_id']}@"
            f"{result_kiro['version']} rollout="
            f"{result_kiro['rollout_percent']}%"
        )
        record(
            "publish_kiro_v1.0.0",
            result_kiro.get("stored", False),
            f"{result_kiro['plugin_id']}@{result_kiro['version']}",
        )

        # ── Step 6: Client sync #1 -> install v1.0.0 ───────────────────────
        print("\n=== Step 6: Client sync #1 (install v1.0.0) ===")
        sync1 = PluginSyncService(activation=activation)
        report1 = await sync1.sync()
        print(f"  updated: {report1.updated}")
        print(f"  skipped: {report1.skipped}")
        print(f"  errors: {report1.errors}")

        sync1_ok = (
            not report1.errors
            and any(
                f"{_AWS_BUILDER_ID}@1.0.0" in u
                for u in report1.updated
            )
            and any(
                f"{_KIRO_AUTOREG}@1.0.0" in u
                for u in report1.updated
            )
        )
        record("sync_1", sync1_ok, f"updated={report1.updated}")

        aws_ok = _assert_installed(
            _AWS_BUILDER_ID, "1.0.0", "sync1"
        )
        kiro_ok = _assert_installed(
            _KIRO_AUTOREG, "1.0.0", "sync1"
        )
        record(
            "v1.0.0_installed",
            aws_ok and kiro_ok,
            "both packages present",
        )

        # ── Step 7: Bump kiro-autoreg to v1.0.1 ─────────────────────────────
        print(
            "\n=== Step 7: Bump kiro-autoreg to v1.0.1 "
            "(one selector changed) ==="
        )
        kiro_pkg_v101 = _copy_package(
            _PACKAGES_SRC / _KIRO_AUTOREG,
            packages_work / f"{_KIRO_AUTOREG}-1.0.1",
        )

        # Bump version in plugin.json
        manifest_path = kiro_pkg_v101 / "plugin.json"
        manifest = _load_json(manifest_path)
        manifest["version"] = "1.0.1"
        _save_json(manifest_path, manifest)

        # Change ONE selector value in selectors.json
        selectors_path = kiro_pkg_v101 / "selectors.json"
        selectors = _load_json(selectors_path)
        original_weight = selectors["kiro_dev_signin"][0]["weight"]
        selectors["kiro_dev_signin"][0]["weight"] = 0.95
        _save_json(selectors_path, selectors)
        print(
            f"  changed: kiro_dev_signin[0].weight "
            f"{original_weight} -> 0.95"
        )
        record(
            "bump_v1.0.1",
            True,
            "version=1.0.1, selector weight changed",
        )

        # ── Step 8: Publish v1.0.1 ──────────────────────────────────────────
        print("\n=== Step 8: Publish kiro-autoreg v1.0.1 ===")
        result_kiro_v101 = await publish_package(
            kiro_pkg_v101,
            server_url=server_url,
            admin_key=admin_key,
            signing_key_pem=priv_pem,
            rollout_percent=100,
        )
        print(
            f"  published: {result_kiro_v101['plugin_id']}@"
            f"{result_kiro_v101['version']} rollout="
            f"{result_kiro_v101['rollout_percent']}%"
        )
        record(
            "publish_kiro_v1.0.1",
            result_kiro_v101.get("stored", False),
            f"{result_kiro_v101['plugin_id']}@"
            f"{result_kiro_v101['version']}",
        )

        # ── Step 9: Client sync #2 -> pick up v1.0.1 ────────────────────────
        print("\n=== Step 9: Client sync #2 (pick up v1.0.1) ===")
        # Small delay to ensure server_time is newer (anti-replay)
        await asyncio.sleep(1.0)

        sync2 = PluginSyncService(activation=activation)
        report2 = await sync2.sync()
        print(f"  updated: {report2.updated}")
        print(f"  skipped: {report2.skipped}")
        print(f"  errors: {report2.errors}")

        sync2_ok = (
            not report2.errors
            and any(
                f"{_KIRO_AUTOREG}@1.0.1" in u
                for u in report2.updated
            )
        )
        record("sync_2", sync2_ok, f"updated={report2.updated}")

        v101_ok = _assert_installed(
            _KIRO_AUTOREG, "1.0.1", "sync2"
        )
        v100_ok = _assert_installed(
            _KIRO_AUTOREG, "1.0.0", "LKG"
        )
        record(
            "v1.0.1_picked_up",
            v101_ok and v100_ok,
            "v1.0.1 active, v1.0.0 LKG",
        )

        # ── Step 10: Gated distribution — issue-code via admin API ───────
        print("\n=== Step 10: Issue activation code via admin API ===")
        admin_headers = {"X-Admin-Key": admin_key}
        issue_resp = httpx.post(
            f"{server_url}/admin/issue-code",
            json={"entitlements": [_KIRO_AUTOREG]},
            headers=admin_headers,
            timeout=30.0,
        )
        assert issue_resp.status_code == 200, issue_resp.text
        gated_code = issue_resp.json()["codes"][0]
        print(f"  issued code (limited to {_KIRO_AUTOREG}): {gated_code[:8]}...")
        record(
            "issue_code_via_admin_api",
            True,
            f"code={gated_code[:8]}..., ents=[{_KIRO_AUTOREG}]",
        )

        # ── Step 11: Activate with limited entitlements ──────────────────
        print("\n=== Step 11: Activate with limited entitlements ===")
        gated_hwid = hashlib.sha256(
            secrets.token_bytes(32)
        ).hexdigest()
        gated_client_data = tmpdir / "client_data_gated"
        gated_client_data.mkdir(parents=True, exist_ok=True)

        # Use a separate activation service with a different data dir
        gated_env = os.environ.copy()
        gated_env["STITCH_PLUGINS_DIR"] = str(gated_client_data)
        # Temporarily set env for the activation service
        orig_plugins_dir = os.environ.get("STITCH_PLUGINS_DIR")
        os.environ["STITCH_PLUGINS_DIR"] = str(gated_client_data)
        try:
            gated_activation = ActivationService()
            gated_state = await gated_activation.activate(
                gated_code, gated_hwid
            )
        finally:
            if orig_plugins_dir is not None:
                os.environ["STITCH_PLUGINS_DIR"] = orig_plugins_dir
            else:
                os.environ.pop("STITCH_PLUGINS_DIR", None)

        print(f"  token: {gated_state.token[:8]}...")
        print(f"  entitlements: {gated_state.entitlements}")
        record(
            "activate_limited_entitlements",
            gated_state.entitlements == [_KIRO_AUTOREG],
            f"ents={gated_state.entitlements}",
        )

        # ── Step 12: Manifest filtering — limited token sees only kiro ─
        print("\n=== Step 12: Manifest filtering (limited entitlements) ===")
        manifest_resp = httpx.get(
            f"{server_url}/manifest",
            headers={"Authorization": f"Bearer {gated_state.token}"},
            timeout=30.0,
        )
        assert manifest_resp.status_code == 200, manifest_resp.text
        manifest_plugins = manifest_resp.json()["plugins"]
        plugin_ids = [p["id"] for p in manifest_plugins]
        print(f"  visible plugins: {plugin_ids}")
        has_kiro = _KIRO_AUTOREG in plugin_ids
        no_aws = _AWS_BUILDER_ID not in plugin_ids
        record(
            "manifest_filters_limited",
            has_kiro and no_aws,
            f"visible={plugin_ids}",
        )

        # ── Step 13: 403 on non-entitled plugin ──────────────────────────
        print("\n=== Step 13: 403 on non-entitled plugin download ===")
        forbidden_resp = httpx.get(
            f"{server_url}/plugins/{_AWS_BUILDER_ID}/1.0.0",
            headers={"Authorization": f"Bearer {gated_state.token}"},
            timeout=30.0,
        )
        print(f"  status: {forbidden_resp.status_code}")
        record(
            "forbidden_non_entitled",
            forbidden_resp.status_code == 403,
            f"status={forbidden_resp.status_code}",
        )

        # ── Step 14: Watermarked variant publish + download ─────────────
        print(
            "\n=== Step 14: Publish watermarked variants + verify marker ==="
        )
        n_variants = 4
        variant_markers = []
        for idx in range(n_variants):
            variant_pkg = _copy_package(
                _PACKAGES_SRC / _KIRO_AUTOREG,
                packages_work / f"{_KIRO_AUTOREG}-variant-{idx}",
            )
            # Bump version to avoid collision with 1.0.0/1.0.1
            vmanifest = _load_json(variant_pkg / "plugin.json")
            vmanifest["version"] = "2.0.0"
            _save_json(variant_pkg / "plugin.json", vmanifest)

            inject_watermark(
                variant_pkg,
                plugin_id=_KIRO_AUTOREG,
                version="2.0.0",
                variant_idx=idx,
            )
            marker = marker_for(_KIRO_AUTOREG, "2.0.0", idx)
            variant_markers.append(marker)

            result_v = await publish_package(
                variant_pkg,
                server_url=server_url,
                admin_key=admin_key,
                signing_key_pem=priv_pem,
                rollout_percent=100,
                variant_index=idx,
            )
            assert result_v.get("stored"), f"variant {idx} publish failed"
            print(
                f"  published variant {idx}: marker={marker[:30]}..."
            )
        record(
            "publish_watermarked_variants",
            True,
            f"n={n_variants}",
        )

        # ── Step 15: Download variant and verify honeypot marker ─────────
        print("\n=== Step 15: Download variant + verify honeypot marker ===")
        # The gated token can access kiro-autoreg@2.0.0
        download_resp = httpx.get(
            f"{server_url}/plugins/{_KIRO_AUTOREG}/2.0.0",
            headers={"Authorization": f"Bearer {gated_state.token}"},
            timeout=30.0,
        )
        assert download_resp.status_code == 200, download_resp.text

        # Extract scenario.json from the downloaded zip
        with zipfile.ZipFile(io.BytesIO(download_resp.content)) as zf:
            scenario_data = json.loads(zf.read("scenario.json"))

        # Find the honeypot candidate in the scenario
        token_hash = hashlib.sha256(
            gated_state.token.encode("utf-8")
        ).hexdigest()
        expected_idx = int(token_hash, 16) % n_variants
        expected_marker = variant_markers[expected_idx]
        expected_value = f'[data-stitch="{expected_marker}"]'

        marker_found = False
        for step in scenario_data.get("steps", []):
            for cand in step.get("selector_candidates", []):
                if cand.get("value") == expected_value:
                    marker_found = True
                    break

        print(
            f"  expected variant idx={expected_idx}, marker={expected_marker[:30]}..."
        )
        print(f"  marker found in scenario: {marker_found}")
        record(
            "variant_honeypot_marker_present",
            marker_found,
            f"idx={expected_idx}, marker={expected_marker[:30]}...",
        )

    except Exception as exc:
        print(f"\n!!! EXCEPTION: {exc}")
        traceback.print_exc()
        steps.append(("exception", False, str(exc)))

    finally:
        # ── Teardown server ───────────────────────────────────────────────
        print("\n=== Teardown ===")
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
            print("  server stopped")
        elif proc is not None:
            print(
                f"  server already exited (code={proc.returncode})"
            )

        # Clean up env vars we set
        os.environ.pop("STITCH_SERVER_URL", None)
        os.environ.pop("STITCH_PLUGINS_DIR", None)

    # ── Summary ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    all_ok = True
    for name, ok, detail in steps:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}: {detail}")
        if not ok:
            all_ok = False
    print("=" * 60)
    if all_ok:
        print("RESULT: PASS -- full plugin distribution cycle verified")
    else:
        print("RESULT: FAIL -- see failures above")
    print("=" * 60)

    # Clean up temp dir on success; keep on failure for debugging
    if all_ok and tmpdir is not None:
        shutil.rmtree(tmpdir, ignore_errors=True)
    elif tmpdir is not None:
        print(f"  (temp dir kept for debugging: {tmpdir})")

    return 0 if all_ok else 1


def main() -> int:
    return asyncio.run(_run())


if __name__ == "__main__":
    raise SystemExit(main())
