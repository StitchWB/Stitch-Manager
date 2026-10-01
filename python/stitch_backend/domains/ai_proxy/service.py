"""AI Proxy service — DB operations, analytics, auth flows, IDE detection.

Ports Rust ``database/ai_proxy.rs`` and ``services/ai_proxy/*.rs`` to Python.
Uses raw SQL via SQLAlchemy ``text()`` since ``ai_proxy_accounts`` is a flat
table without an ORM model.
"""

from .account_store import AiProxyAccountStore as AiProxyAccountStore
from .account_store import _now_ts as _now_ts
from .account_store import _row_to_account as _row_to_account
from .accounts_transfer import _iso_now as _iso_now
from .accounts_transfer import export_accounts_payload as export_accounts_payload
from .accounts_transfer import import_accounts_payload as import_accounts_payload
from .analytics import AiProxyAnalytics as AiProxyAnalytics
from .auth_flow import _TTL_SECONDS as _TTL_SECONDS
from .auth_flow import AuthFlowSession as AuthFlowSession
from .auth_flow import AuthFlowSessionManager as AuthFlowSessionManager
from .auth_flow import get_auth_flow_manager as get_auth_flow_manager
from .local_scan import AuthFile as AuthFile
from .local_scan import AuthFileScanner as AuthFileScanner
from .local_scan import DetectedIde as DetectedIde
from .local_scan import IdeDetector as IdeDetector
from .settings_kv import WEB_DEEPSEEK_ENABLED_KEY as WEB_DEEPSEEK_ENABLED_KEY
from .settings_kv import WEB_GEMINI_ANONYMOUS_ALLOWED_KEY as WEB_GEMINI_ANONYMOUS_ALLOWED_KEY
from .settings_kv import WEB_GEMINI_ENABLED_KEY as WEB_GEMINI_ENABLED_KEY
from .settings_kv import WEB_QWEN_ENABLED_KEY as WEB_QWEN_ENABLED_KEY
from .settings_kv import ZAI_TOKEN_DB_PATH_KEY as ZAI_TOKEN_DB_PATH_KEY
from .settings_kv import _ensure_settings_table as _ensure_settings_table
from .settings_kv import _ensure_settings_table_sync as _ensure_settings_table_sync
from .settings_kv import _parse_bool as _parse_bool
from .settings_kv import get_settings_kv as get_settings_kv
from .settings_kv import get_settings_kv_sync as get_settings_kv_sync
from .settings_kv import get_web_deepseek_settings as get_web_deepseek_settings
from .settings_kv import get_web_gemini_settings as get_web_gemini_settings
from .settings_kv import get_web_qwen_settings as get_web_qwen_settings
from .settings_kv import get_zai_token_db_path as get_zai_token_db_path
from .settings_kv import get_zai_token_db_path_sync as get_zai_token_db_path_sync
from .settings_kv import set_settings_kv as set_settings_kv
from .settings_kv import set_settings_kv_sync as set_settings_kv_sync
from .settings_kv import set_zai_token_db_path as set_zai_token_db_path
from .settings_kv import set_zai_token_db_path_sync as set_zai_token_db_path_sync
