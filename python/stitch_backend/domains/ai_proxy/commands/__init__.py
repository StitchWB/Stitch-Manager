"""AI Proxy command handlers — 35 commands.

Covers account CRUD, export/import, model management, IDE config,
quotas, auth flows, analytics, and utility operations.
"""

from stitch_backend.domains.ai_proxy.commands.accounts import (
    cmd_create_ai_proxy_account,
    cmd_delete_ai_proxy_account,
    cmd_export_ai_proxy_accounts_payload,
    cmd_get_ai_proxy_accounts,
    cmd_import_ai_proxy_accounts_payload,
    cmd_update_ai_proxy_account,
)
from stitch_backend.domains.ai_proxy.commands.analytics import (
    cmd_get_ai_proxy_account_daily_usage,
    cmd_get_cost_estimate,
    cmd_get_daily_stats,
    cmd_get_model_usage,
    cmd_get_weekly_stats,
)
from stitch_backend.domains.ai_proxy.commands.auth_files import (
    cmd_auto_import_ai_proxy_auth_files,
    cmd_scan_auth_files,
)
from stitch_backend.domains.ai_proxy.commands.auth_flow import (
    cmd_provider_auth_flow_cancel,
    cmd_provider_auth_flow_start,
    cmd_provider_auth_flow_status,
)
from stitch_backend.domains.ai_proxy.commands.discovery import (
    build_inference_providers,
)
from stitch_backend.domains.ai_proxy.commands.ide_config import (
    cmd_configure_ai_proxy_ide,
    cmd_detect_ai_proxy_ides,
    cmd_get_ai_proxy_ide_config_preview,
    cmd_restore_ai_proxy_ide_config,
)
from stitch_backend.domains.ai_proxy.commands.models import (
    _models_cache,
    cmd_get_available_models,
    cmd_get_enabled_models,
    cmd_get_local_chat_token,
    cmd_get_provider_capabilities,
    cmd_get_provider_model_mappings,
    cmd_set_enabled_models,
    cmd_set_provider_model_mappings,
)
from stitch_backend.domains.ai_proxy.commands.quotas import (
    cmd_fetch_all_quotas,
    cmd_fetch_kiro_account_quotas,
    cmd_fetch_openai_account_quotas,
)
from stitch_backend.domains.ai_proxy.commands.utility import (
    cmd_debug_run_ai_proxy_migration,
    cmd_open_url_in_browser,
    cmd_test_provider_connection,
)

__all__ = [
    "_models_cache",
    "build_inference_providers",
    "cmd_auto_import_ai_proxy_auth_files",
    "cmd_configure_ai_proxy_ide",
    "cmd_create_ai_proxy_account",
    "cmd_debug_run_ai_proxy_migration",
    "cmd_delete_ai_proxy_account",
    "cmd_detect_ai_proxy_ides",
    "cmd_export_ai_proxy_accounts_payload",
    "cmd_fetch_all_quotas",
    "cmd_fetch_kiro_account_quotas",
    "cmd_fetch_openai_account_quotas",
    "cmd_get_ai_proxy_account_daily_usage",
    "cmd_get_ai_proxy_accounts",
    "cmd_get_ai_proxy_ide_config_preview",
    "cmd_get_available_models",
    "cmd_get_cost_estimate",
    "cmd_get_daily_stats",
    "cmd_get_enabled_models",
    "cmd_get_local_chat_token",
    "cmd_get_model_usage",
    "cmd_get_provider_capabilities",
    "cmd_get_provider_model_mappings",
    "cmd_get_weekly_stats",
    "cmd_import_ai_proxy_accounts_payload",
    "cmd_open_url_in_browser",
    "cmd_provider_auth_flow_cancel",
    "cmd_provider_auth_flow_start",
    "cmd_provider_auth_flow_status",
    "cmd_restore_ai_proxy_ide_config",
    "cmd_scan_auth_files",
    "cmd_set_enabled_models",
    "cmd_set_provider_model_mappings",
    "cmd_test_provider_connection",
    "cmd_update_ai_proxy_account",
]
