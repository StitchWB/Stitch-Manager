"""Fail when a tracked public file is outside the hub mirror surface.

The public repository is the Zone-1 source of truth, but the hub's
``sync_from_public.py`` imports only the hub exporter's allow-list
(``ZONE_DIRS`` + ``ZONE_FILES``).  A newly added public file outside that
surface otherwise looks committed and green here while never reaching the hub.

This script is deliberately self-contained: the public repo cannot import the
private hub exporter.  ``ZONE_DIRS`` and ``ZONE_FILES`` below are a read-only
mirror of the hub contract as of 2026-11-26.  Extending the mirror surface is a
coordinated hub+public change; adding repo-local files here only requires an
explicit ``PUBLIC_ONLY_FILES`` entry with a reason.

Exit 0 when every tracked file is classified, 1 when any file is unclassified
or an exclusion is stale/contradictory, 2 for invocation/environment errors.
Stdlib only.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

# Mirror of hub scripts/export_public_zone.py ZONE_DIRS.  Keep exact: this is
# the closed-world contract used to catch silent public -> hub divergence.
ZONE_DIRS = (
    "src",
    "extension",
    "bridge",
    "eslint-plugin-ui-kit",
    "python/stitch_backend",
    "python/stitch_plugin_tools",
    "python/autoreg/scenario",
    "python/autoreg/scenario_runner",
    "python/autoreg/pipeline",
    "python/autoreg/plugin",
    "python/autoreg/browser",
    "python/autoreg/core",
    "python/autoreg/shared",
    "python/autoreg/debugger",
    "python/autoreg/provider_sdk",
    "python/scripts",
    "resources/icons",
)

# Mirror of hub scripts/export_public_zone.py ZONE_FILES.  Do not add a file
# here merely to make this gate green: the hub sync will still ignore it until
# the hub exporter allow-list is updated in the coordinated closed-side change.
ZONE_FILES = frozenset(
    {
        "python/autoreg/__init__.py",
        "python/autoreg/provider_ids.py",
        "python/autoreg/pyproject.toml",
        "python/autoreg/README.md",
        "python/autoreg/browser_worker.py",
        "python/autoreg/browser_worker_handlers.py",
        "python/autoreg/browser_worker_protocol.py",
        "python/autoreg/stitch_backend_bridge.py",
        "python/autoreg/version.py",
        "python/run_gui.py",
        "python/run_scenario_replay.py",
        "python/run_scenario_record.py",
        "python/run_browser_worker.py",
        "python/run_composed_flow.py",
        "python/run_extension_record.py",
        "python/run_extension_replay.py",
        "python/run_quota.py",
        "python/pyproject.toml",
        "python/requirements.txt",
        "python/requirements-dev.txt",
        "python/setup.py",
        "python/stitch-backend.spec",
        "python/scripts/check_zone_boundary.py",
        "scripts/generate_version.py",
        "scripts/workspace-runtime.ps1",
        "scripts/workspace.ps1",
        "scripts/workspace-config.ps1",
        "scripts/check_command_contract.py",
        "scripts/check-vite-modules.mjs",
        "scripts/check-workspace-e2e.ps1",
        "scripts/e2e-ai-connection.py",
        "scripts/check-browser-smoke.mjs",
        "python/tests/test_check_command_contract.py",
        "python/tests/test_check_vite_modules.py",
        "python/tests/test_e2e_ai_connection.py",
        "python/tests/test_patcher_delete_backup.py",
        "python/tests/test_startup_command_registry.py",
        "python/tests/test_check_browser_smoke.py",
        "python/tests/test_rb_health_integration.py",
        "python/tests/test_run_gui_launch.py",
        "scripts/dev-lib.ps1",
        "installer.nsi",
        "package.json",
        "package-lock.json",
        "vite.config.ts",
        "dev.ps1",
        "stitch-workspace.example.json",
        "tsconfig.json",
        "tsconfig.node.json",
        "postcss.config.js",
        "tailwind.config.js",
        ".eslintrc.cjs",
        "index.html",
        "README.md",
        "LICENSE",
        "docs/service-plugins.md",
        "docs/plugin-authoring.md",
    }
)

# Explicit public-repo-only files.  Entries are files, not directories, so a
# newly added sibling cannot slip through silently.  Keep reasons to one line.
PUBLIC_ONLY_FILES = {
    ".ast-grep/fixtures/bare-python-invalid.py.txt": "public CI fixture for the ast-grep spawn gate",
    ".ast-grep/fixtures/bare-python-valid.py.txt": "public CI fixture for the ast-grep spawn gate",
    ".ast-grep/rules/no-bare-python-spawn.yml": "public CI lint rule configuration",
    ".gitattributes": "repository-local line-ending and metadata policy",
    ".github/ISSUE_TEMPLATE/bug_report.md": "public collaboration template, not runtime source",
    ".github/ISSUE_TEMPLATE/feature_request.md": "public collaboration template, not runtime source",
    ".github/PULL_REQUEST_TEMPLATE.md": "public collaboration template, not runtime source",
    ".github/release.yml": "public release-note configuration, not runtime source",
    ".github/workflows/ci.yml": "public CI wiring, not hub runtime source",
    ".gitignore": "repository-local ignore policy",
    "AGENTS.md": "public contributor agent instructions",
    "CONTRIBUTING.md": "public contributor documentation",
    "DESIGN.md": "public design documentation not in the hub mirror contract",
    "SECURITY.md": "public security policy",
    "docs/MCP.md": "public MCP documentation not in the hub mirror contract",
    "jest.config.mjs": "public frontend test harness configuration",
    "jest/transformers/ts-jest-import-meta.cjs": "public frontend test harness transformer",
    "public/app-icon.png": "web dev-server static asset outside the current mirror contract",
    "public/stitchwb-mark.png": "web dev-server static asset outside the current mirror contract",
    "python/tests/__init__.py": "public-only pytest package marker",
    "python/tests/plugin_distribution/__init__.py": "public-only pytest package marker",
    "python/tests/plugin_distribution/test_marketplace_update_flags.py": "public-only regression test",
    "python/tests/plugin_distribution/test_release_preview.py": "public-only regression test",
    "python/tests/plugin_tools/__init__.py": "public-only pytest package marker",
    "python/tests/plugin_tools/test_ui_manifest.py": "public-only regression test",
    "python/tests/test_api_middleware.py": "public-only regression test",
    "python/tests/test_check_vendor_drift.py": "public-only regression test",
    "python/tests/test_check_zone_coverage.py": "public-only regression test for a public CI gate",
    "python/tests/test_chain_autorefill.py": "public-only regression test",
    "python/tests/test_db_cancellation.py": "public-only regression test",
    "python/tests/test_discovery_verification_gate.py": "public-only regression test",
    "python/tests/test_gateway_integration_phase2.py": "public-only regression test",
    "python/tests/test_gateway_owner_isolation.py": "public-only regression test",
    "python/tests/test_inference_integrity.py": "public-only regression test",
    "python/tests/test_install_proxy_keys.py": "public-only regression test",
    "python/tests/test_instance_lock.py": "public-only regression test (hub mirror follow-up pending)",
    "python/tests/test_key_inflight_models.py": "public-only regression test",
    "python/tests/test_logging_unicode_safety.py": "public-only regression test",
    "python/tests/test_mcp_server.py": "public-only regression test",
    "python/tests/test_model_health.py": "public-only regression test",
    "python/tests/test_model_sync_apply.py": "public-only regression test",
    "python/tests/test_model_sync_atomic.py": "public-only regression test",
    "python/tests/test_model_sync_detection.py": "public-only regression test",
    "python/tests/test_model_sync_key_material.py": "public-only regression test",
    "python/tests/test_model_sync_legacy.py": "public-only regression test",
    "python/tests/test_model_sync_omp.py": "public-only regression test",
    "python/tests/test_model_sync_opencode.py": "public-only regression test",
    "python/tests/test_model_sync_opencode_credentials.py": "public-only regression test",
    "python/tests/test_opencode_config.py": "public-only regression test",
    "python/tests/test_opencode_config_writes.py": "public-only regression test",
    "python/tests/test_opencode_import_config.py": "public-only regression test",
    "python/tests/test_opencode_models_report.py": "public-only regression test",
    "python/tests/test_plugin_bridge.py": "public-only regression test",
    "python/tests/test_plugin_crypto.py": "public-only regression test",
    "python/tests/test_plugin_runtime_controls.py": "public-only regression test",
    "python/tests/test_probe_endpoint.py": "public-only regression test",
    "python/tests/test_probe_models.py": "public-only regression test",
    "python/tests/test_python_spawn_defaults.py": "public-only regression test",
    "python/tests/test_refresh_endpoint_models.py": "public-only regression test",
    "python/tests/test_role_catalog_service.py": "public-only regression test",
    "python/tests/test_ttft_watchdog.py": "public-only regression test",
    "resources/branding/stitch-ide-logo.png": "branding asset outside resources/icons mirror surface",
    "scripts/dev-test-instance.ps1": "local development helper, not hub runtime source",
    "scripts/start-dev.ps1": "local development helper, not hub runtime source",
    "scripts/test-python-spawn-gate.mjs": "public CI fixture runner for the ast-grep spawn gate",
    "sgconfig.yml": "public ast-grep project configuration",
    "start-dev.ps1": "local development helper, not hub runtime source",
}


def default_repo_root() -> Path:
    """Repo root from this script's location (python/scripts/ -> up 3)."""
    return Path(__file__).resolve().parent.parent.parent


def is_in_mirror_surface(rel: str) -> bool:
    """Return True when the current hub sync contract mirrors ``rel``."""
    return rel in ZONE_FILES or any(
        rel == zone_dir or rel.startswith(f"{zone_dir}/") for zone_dir in ZONE_DIRS
    )


def coverage_errors(tracked_files: list[str]) -> list[str]:
    """Return actionable coverage errors for a sorted list of tracked paths."""
    errors: list[str] = []
    tracked = set(tracked_files)

    for rel in sorted(PUBLIC_ONLY_FILES):
        reason = PUBLIC_ONLY_FILES[rel].strip()
        if not reason:
            errors.append(f"{rel}: PUBLIC_ONLY_FILES reason is empty")
        if rel not in tracked:
            errors.append(f"{rel}: stale PUBLIC_ONLY_FILES entry; file is not tracked")
        elif is_in_mirror_surface(rel):
            errors.append(
                f"{rel}: remove contradictory PUBLIC_ONLY_FILES entry; mirror surface already covers it"
            )

    for rel in sorted(tracked):
        if is_in_mirror_surface(rel) or rel in PUBLIC_ONLY_FILES:
            continue
        errors.append(
            f"{rel}: unclassified file; either coordinate a hub export_public_zone.py "
            "allow-list update (and mirror it here) or add a PUBLIC_ONLY_FILES entry with a reason"
        )
    return errors


def git_tracked_files(repo_root: Path) -> list[str]:
    """Return tracked paths using the index, so staged new files are covered."""
    proc = subprocess.run(
        ["git", "-C", str(repo_root), "ls-files", "-z"],
        check=False,
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", errors="replace").strip())
    return sorted(
        item.decode("utf-8", errors="replace")
        for item in proc.stdout.split(b"\0")
        if item
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Public -> hub Zone-1 coverage gate.")
    parser.add_argument("--repo-root", default=str(default_repo_root()))
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    if not repo_root.is_dir():
        print(f"ERROR: repo root not found: {repo_root}", file=sys.stderr)
        return 2
    try:
        tracked = git_tracked_files(repo_root)
    except RuntimeError as exc:
        print(f"ERROR: git ls-files failed: {exc}", file=sys.stderr)
        return 2

    errors = coverage_errors(tracked)
    if errors:
        print("ZONE COVERAGE VIOLATIONS DETECTED:")
        for error in errors:
            print(f"  {error}")
        print(
            "\nEvery tracked public file must either be inside the mirrored Zone-1 "
            "surface or be an explicit public-only exception."
        )
        print(f"Total violations: {len(errors)} ({len(tracked)} tracked files)")
        return 1

    print(
        "ZONE COVERAGE CLEAN "
        f"({len(tracked)} tracked files; {len(PUBLIC_ONLY_FILES)} public-only exceptions)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
