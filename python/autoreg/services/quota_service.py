"""
Quota Service - мониторинг квот Kiro.

ИСТОЧНИКИ ДАННЫХ (в порядке приоритета):
1. CodeWhisperer API (с токеном аккаунта) - для любого аккаунта
2. Локальный кэш Kiro (state.vscdb) - только для активного аккаунта
3. Web Portal API (CBOR) - fallback

CodeWhisperer API:
- Endpoint: codewhisperer.{region}.amazonaws.com/getUsageLimits
- Auth: Bearer token
- Возвращает usageBreakdownList с freeTrialInfo
"""

import json
import time
import sqlite3
import logging
import requests
from datetime import datetime
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.paths import get_paths
from .webportal_client import KiroWebPortalClient

logger = logging.getLogger(__name__)

# Retry configuration
MAX_RETRIES = 3
RETRY_DELAY_SEC = 1.0


@dataclass
class UsageInfo:
    """Информация об использовании"""
    limit: int = 0
    used: int = 0
    display_name: str = ""
    resource_type: str = ""
    next_reset: Optional[datetime] = None
    
    # Trial
    trial_limit: int = 0
    trial_used: int = 0
    trial_status: str = ""
    trial_expiry: Optional[datetime] = None
    
    # Bonuses
    bonuses: List[Dict] = field(default_factory=list)
    
    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)
    
    @property
    def percent_used(self) -> float:
        return (self.used / self.limit * 100) if self.limit > 0 else 0
    
    @property
    def trial_remaining(self) -> int:
        return max(0, self.trial_limit - self.trial_used)
    
    @property
    def total_remaining(self) -> int:
        """Всего осталось (основные + trial + бонусы)"""
        bonus_remaining = sum(
            b.get('limit', 0) - b.get('usage', 0) 
            for b in self.bonuses 
            if b.get('status') == 'ACTIVE'
        )
        return self.remaining + self.trial_remaining + int(bonus_remaining)


@dataclass
class QuotaInfo:
    """Полная информация о квотах"""
    email: str = ""
    user_id: str = ""
    subscription_type: str = "Free"
    subscription_title: str = ""
    days_until_reset: int = 0
    
    usage: Optional[UsageInfo] = None
    raw_response: Optional[Dict] = None
    error: str = None
    
    @property
    def is_pro(self) -> bool:
        return 'PRO' in self.subscription_type.upper()
    
    @property
    def is_banned(self) -> bool:
        return self.error and 'BANNED' in self.error


# CodeWhisperer API config
CW_API_TIMEOUT = 30


class QuotaService:
    """
    Сервис для мониторинга квот Kiro.
    
    ПРИОРИТЕТ ИСТОЧНИКОВ:
    1. CodeWhisperer API (с токеном) - для любого аккаунта
    2. Локальный кэш Kiro (state.vscdb) - только для активного
    3. Web Portal API (CBOR) - fallback
    """
    
    def __init__(self):
        self.paths = get_paths()
        self.client = KiroWebPortalClient()
    
    def get_quota_from_cw_api(self, access_token: str, region: str = 'us-east-1') -> Optional[QuotaInfo]:
        """
        Получает квоту через CodeWhisperer API.
        
        Args:
            access_token: Bearer token для авторизации
            region: AWS region (default: us-east-1)
        
        Returns:
            QuotaInfo или None при ошибке
        """
        url = f"https://codewhisperer.{region}.amazonaws.com/getUsageLimits"
        
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "Kiro/1.0.0",
        }
        
        try:
            response = requests.get(url, headers=headers, timeout=CW_API_TIMEOUT)
            
            if response.status_code == 401:
                # 401 = Token expired or invalid - can be refreshed
                return QuotaInfo(error="UNAUTHORIZED: Token expired or invalid. Please refresh token.")
            
            if response.status_code == 403:
                # 403 = Account banned/suspended - cannot be fixed by refresh
                return QuotaInfo(error="BANNED: Account suspended or access denied (403)")
            
            if response.status_code == 423:
                # 423 = Account locked
                return QuotaInfo(error="BANNED: Account locked (423)")
            
            if not response.ok:
                return QuotaInfo(error=f"API error: {response.status_code}")
            
            data = response.json()
            return self._parse_cw_api_response(data)
            
        except requests.Timeout:
            logger.warning("[Quota] CodeWhisperer API timeout")
            return None
        except Exception as e:
            logger.error(f"[Quota] CodeWhisperer API error: {e}")
            return None
    
    def _parse_cw_api_response(self, data: Dict) -> QuotaInfo:
        """Парсит ответ CodeWhisperer GetUsageLimits API."""
        info = QuotaInfo(raw_response=data)
        
        # User info
        user_info = data.get('userInfo', {})
        info.email = user_info.get('email') or ''
        info.user_id = user_info.get('userId', '')
        
        # Subscription
        sub_info = data.get('subscriptionInfo', {})
        info.subscription_type = sub_info.get('type', 'Free')
        info.subscription_title = sub_info.get('subscriptionTitle', '')
        
        info.days_until_reset = data.get('daysUntilReset', 0)
        
        # Usage breakdowns
        breakdowns = data.get('usageBreakdownList', [])
        if breakdowns:
            bd = breakdowns[0]
            
            # Use precision values if available
            base_limit = bd.get('usageLimitWithPrecision') or bd.get('usageLimit', 0)
            base_used = bd.get('currentUsageWithPrecision') or bd.get('currentUsage', 0)
            
            usage = UsageInfo(
                limit=int(base_limit),
                used=int(base_used),
                display_name=bd.get('displayName', 'Credit'),
                resource_type=bd.get('resourceType', 'CREDIT')
            )
            
            # Next reset
            if bd.get('nextDateReset'):
                try:
                    usage.next_reset = datetime.fromtimestamp(bd['nextDateReset'])
                except Exception:
                    pass
            
            # Free trial info (this is what Kiro shows as "Free Bonus")
            trial = bd.get('freeTrialInfo', {})
            if trial and trial.get('freeTrialStatus') == 'ACTIVE':
                usage.trial_limit = int(trial.get('usageLimitWithPrecision') or trial.get('usageLimit', 0))
                usage.trial_used = int(trial.get('currentUsageWithPrecision') or trial.get('currentUsage', 0))
                usage.trial_status = 'ACTIVE'
                
                if trial.get('freeTrialExpiry'):
                    try:
                        usage.trial_expiry = datetime.fromtimestamp(trial['freeTrialExpiry'])
                    except Exception:
                        pass
                
                info.subscription_title = f"Free Trial ({usage.trial_remaining} remaining)"
            
            # Bonuses
            for bonus in bd.get('bonuses', []):
                usage.bonuses.append({
                    'code': bonus.get('bonusCode', ''),
                    'name': bonus.get('displayName', ''),
                    'limit': bonus.get('usageLimit', 0),
                    'usage': bonus.get('currentUsage', 0),
                    'status': bonus.get('status', ''),
                })
            
            info.usage = usage
        
        logger.info(f"[Quota] CW API: trial {info.usage.trial_used if info.usage else 0}/{info.usage.trial_limit if info.usage else 0}")
        
        return info
    
    def _get_current_email(self) -> str:
        """
        Получает email текущего аккаунта из разных источников.
        
        Приоритет:
        1. Token file (kiro-auth-token.json) - если есть email
        2. Accounts.json - ищем активный аккаунт по token_file
        """
        try:
            # 1. Пробуем из токена
            if self.paths.kiro_token_file.exists():
                token_data = json.loads(self.paths.kiro_token_file.read_text())
                if token_data.get('email'):
                    return token_data['email']
            
            # 2. Пробуем из accounts.json
            if self.paths.accounts_file.exists():
                accounts = json.loads(self.paths.accounts_file.read_text())
                # Ищем активный аккаунт
                for acc in accounts:
                    if acc.get('status') == 'active':
                        return acc.get('email', '')
                # Если нет активного, берём первый
                if accounts:
                    return accounts[0].get('email', '')
        except Exception:
            pass
        
        return ''
    
    def get_quota_from_local_cache(self) -> Optional[QuotaInfo]:
        """
        Читает квоты из локального кэша Kiro (state.vscdb).
        
        Kiro IDE сохраняет данные о квотах в SQLite базу:
        - Путь: %APPDATA%/Kiro/User/globalStorage/state.vscdb
        - Таблица: ItemTable (key TEXT, value BLOB)
        - Ключ: 'kiro.kiroAgent'
        - Данные: JSON с 'kiro.resourceNotifications.usageState'
        
        Returns:
            QuotaInfo или None если кэш недоступен
        """
        try:
            db_path = self.paths.kiro_state_db
            if not db_path or not db_path.exists():
                logger.warning("[Quota] Kiro state.vscdb not found")
                return None
            
            conn = sqlite3.connect(str(db_path))
            cursor = conn.cursor()
            
            cursor.execute("SELECT value FROM ItemTable WHERE key = ?", ('kiro.kiroAgent',))
            result = cursor.fetchone()
            conn.close()
            
            if not result:
                logger.warning("[Quota] kiro.kiroAgent key not found in state.vscdb")
                return None
            
            value = result[0]
            if isinstance(value, bytes):
                value = value.decode('utf-8')
            
            data = json.loads(value)
            usage_state = data.get('kiro.resourceNotifications.usageState', {})
            
            if not usage_state:
                logger.warning("[Quota] No usageState in kiro.kiroAgent")
                return None
            
            return self._parse_local_cache(usage_state)
            
        except Exception as e:
            logger.error(f"[Quota] Error reading local cache: {e}")
            return None
    
    def _parse_local_cache(self, usage_state: Dict) -> QuotaInfo:
        """
        Парсит данные из локального кэша Kiro.
        
        Формат usage_state:
        {
            "usageBreakdowns": [{
                "currency": {"code": "USD", "symbol": "$"},
                "currentOverages": 0,
                "currentUsage": 0,
                "displayName": "Credit",
                "displayNamePlural": "Credits",
                "percentageUsed": 0,
                "overageCap": 10000,
                "overageCharges": 0,
                "overageRate": 0.04,
                "resetDate": "2026-02-01T00:00:00.000Z",
                "type": "CREDIT",
                "unit": "INVOCATIONS",
                "usageLimit": 50,
                "freeTrialUsage": {
                    "currentUsage": 220.91,
                    "usageLimit": 500,
                    "percentageUsed": 44.182,
                    "expiryDate": "2026-02-12T06:22:01.109Z",
                    "daysRemaining": 30
                }
            }],
            "timestamp": 1768291597273
        }
        """
        info = QuotaInfo(raw_response=usage_state)
        
        # Получаем email из разных источников
        info.email = self._get_current_email()
        
        breakdowns = usage_state.get('usageBreakdowns', [])
        if not breakdowns:
            return info
        
        bd = breakdowns[0]
        
        usage = UsageInfo(
            limit=int(bd.get('usageLimit', 0)),
            used=int(bd.get('currentUsage', 0)),
            display_name=bd.get('displayName', 'Credit'),
            resource_type=bd.get('type', 'CREDIT')
        )
        
        # Reset date
        reset_date_str = bd.get('resetDate')
        if reset_date_str:
            try:
                usage.next_reset = datetime.fromisoformat(reset_date_str.replace('Z', '+00:00'))
                # Calculate days until reset
                now = datetime.now(usage.next_reset.tzinfo)
                delta = usage.next_reset - now
                info.days_until_reset = max(0, delta.days)
            except Exception:
                pass
        
        # Free trial / bonus usage
        trial_info = bd.get('freeTrialUsage', {})
        if trial_info:
            usage.trial_limit = int(trial_info.get('usageLimit', 0))
            usage.trial_used = int(trial_info.get('currentUsage', 0))
            usage.trial_status = 'ACTIVE' if trial_info.get('daysRemaining', 0) > 0 else 'EXPIRED'
            
            expiry_str = trial_info.get('expiryDate')
            if expiry_str:
                try:
                    usage.trial_expiry = datetime.fromisoformat(expiry_str.replace('Z', '+00:00'))
                except Exception:
                    pass
        
        info.usage = usage
        
        # Determine subscription type
        if usage.trial_status == 'ACTIVE':
            info.subscription_type = 'Free Trial'
            info.subscription_title = f"Free Trial ({trial_info.get('daysRemaining', 0)} days left)"
        elif usage.limit > 0:
            info.subscription_type = 'Free'
            info.subscription_title = 'Free Tier'
        else:
            info.subscription_type = 'Pro'
            info.subscription_title = 'Pro'
        
        logger.info(f"[Quota] From cache: {info.email} - trial {usage.trial_used}/{usage.trial_limit}, base {usage.used}/{usage.limit}")
        
        return info
    
    def get_quota(self, access_token: str, idp: str = 'Google') -> QuotaInfo:
        """
        Получить квоты для токена через Web Portal API (CBOR).
        
        Args:
            access_token: Access token
            idp: Identity Provider (Google/Github)
        
        Returns:
            QuotaInfo с информацией о квотах
        """
        last_error = ""
        
        for attempt in range(MAX_RETRIES):
            if attempt > 0:
                logger.info(f"[Quota] Retry {attempt}/{MAX_RETRIES}")
                time.sleep(RETRY_DELAY_SEC)
            
            try:
                # Используем Web Portal API вместо CodeWhisperer!
                response = self.client.get_user_usage_and_limits(access_token, idp)
                return self._parse_webportal_response(response)
                
            except ValueError as e:
                error_msg = str(e)
                
                # Проверяем на бан (не ретраим)
                if 'BANNED' in error_msg or 'UNAUTHORIZED' in error_msg:
                    logger.error(f"[Quota] {error_msg}")
                    return QuotaInfo(error=error_msg)
                
                last_error = error_msg
                logger.warning(f"[Quota] Attempt {attempt + 1} failed: {error_msg}")
                continue
            
            except Exception as e:
                last_error = f"Unexpected error: {e}"
                logger.error(f"[Quota] {last_error}")
                continue
        
        return QuotaInfo(error=f"Failed after {MAX_RETRIES} retries: {last_error}")
    
    def get_current_quota(self) -> Optional[QuotaInfo]:
        """
        Получить квоты для текущего активного аккаунта.
        
        ПРИОРИТЕТ:
        1. Локальный кэш Kiro (state.vscdb) - мгновенно
        2. Web Portal API - fallback если кэш недоступен/устарел
        """
        # Сначала пробуем локальный кэш - это быстро и надёжно
        cached_quota = self.get_quota_from_local_cache()
        if cached_quota and not cached_quota.error:
            logger.info("[Quota] Using cached quota from state.vscdb")
            return cached_quota
        
        # Fallback: Web Portal API
        logger.info("[Quota] Cache unavailable, trying Web Portal API...")
        
        if not self.paths.kiro_token_file.exists():
            return None
        
        try:
            data = json.loads(self.paths.kiro_token_file.read_text())
            access_token = data.get('accessToken')
            idp = data.get('idp', 'Google')  # ВАЖНО: нужен idp для Web Portal!
            
            if not access_token:
                return None
            
            # Проверяем не истёк ли токен
            expires_at = data.get('expiresAt')
            if expires_at:
                try:
                    exp = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                    if exp <= datetime.now(exp.tzinfo):
                        # Токен истёк - нужно обновить
                        from .token_service import TokenService
                        token_service = TokenService()
                        token_info = token_service.get_current_token()
                        
                        if token_info and token_info.has_refresh_token:
                            try:
                                new_data = token_service.refresh_token(token_info)
                                access_token = new_data['accessToken']
                                
                                # Сохраняем обновлённый токен
                                data['accessToken'] = access_token
                                data['expiresAt'] = new_data['expiresAt']
                                if new_data.get('refreshToken'):
                                    data['refreshToken'] = new_data['refreshToken']
                                
                                self.paths.kiro_token_file.write_text(
                                    json.dumps(data, indent=2)
                                )
                            except Exception:
                                return QuotaInfo(error="Token expired and refresh failed")
                except Exception:
                    pass
            
            return self.get_quota(access_token, idp)
            
        except Exception as e:
            logger.error(f"[Quota] Error getting current quota: {e}")
            return QuotaInfo(error=str(e))
    
    def _parse_webportal_response(self, data: Dict) -> QuotaInfo:
        """
        Парсит ответ Web Portal API (CBOR).
        
        Формат ответа такой же как у CodeWhisperer API,
        но приходит через CBOR вместо JSON.
        """
        info = QuotaInfo(raw_response=data)
        
        # User info
        user_info = data.get('userInfo', {})
        info.email = user_info.get('email', '')
        info.user_id = user_info.get('userId', '')
        
        # Subscription
        sub_info = data.get('subscriptionInfo', {})
        info.subscription_type = sub_info.get('type', 'Free')
        info.subscription_title = sub_info.get('subscriptionTitle', '')
        
        info.days_until_reset = data.get('daysUntilReset', 0)
        
        # Usage breakdowns
        breakdowns = data.get('usageBreakdownList', [])
        if breakdowns:
            bd = breakdowns[0]
            
            usage = UsageInfo(
                limit=bd.get('usageLimit', 0),
                used=bd.get('currentUsage', 0),
                display_name=bd.get('displayName', ''),
                resource_type=bd.get('resourceType', '')
            )
            
            # Next reset (timestamp в секундах)
            if bd.get('nextDateReset'):
                usage.next_reset = datetime.fromtimestamp(bd['nextDateReset'])
            
            # Trial
            trial = bd.get('freeTrialInfo', {})
            if trial:
                usage.trial_limit = trial.get('usageLimit', 0)
                usage.trial_used = trial.get('currentUsage', 0)
                usage.trial_status = trial.get('freeTrialStatus', '')
                if trial.get('freeTrialExpiry'):
                    usage.trial_expiry = datetime.fromtimestamp(trial['freeTrialExpiry'])
            
            # Bonuses
            for bonus in bd.get('bonuses', []):
                usage.bonuses.append({
                    'code': bonus.get('bonusCode', ''),
                    'name': bonus.get('displayName', ''),
                    'limit': bonus.get('usageLimit', 0),
                    'usage': bonus.get('currentUsage', 0),
                    'status': bonus.get('status', ''),
                    'expires_at': bonus.get('expiresAt')
                })
            
            info.usage = usage
        
        logger.info(f"[Quota] Parsed: {info.email} - {info.usage.used if info.usage else 0}/{info.usage.limit if info.usage else 0}")
        
        return info
    
    def print_quota(self, info: QuotaInfo):
        """Красиво выводит информацию о квотах"""
        if info.error:
            print(f"[X] {info.error}")
            return
        
        print(f"\n{'='*60}")
        print(f"[STATS] Kiro Quota Information")
        print(f"{'='*60}")
        
        if info.email:
            print(f"\n[U] User: {info.email}")
        
        sub_icon = "[*]" if info.is_pro else "🆓"
        print(f"{sub_icon} Subscription: {info.subscription_title or info.subscription_type}")
        print(f"[D] Days until reset: {info.days_until_reset}")
        
        if info.usage:
            u = info.usage
            print(f"\n[+] {u.display_name or 'Usage'}:")
            
            # Progress bar
            bar_width = 30
            filled = int(bar_width * u.percent_used / 100)
            bar = '█' * filled + '░' * (bar_width - filled)
            
            print(f"   [{bar}] {u.percent_used:.1f}%")
            print(f"   Used: {u.used} / {u.limit}")
            print(f"   Remaining: {u.remaining}")
            
            if u.next_reset:
                print(f"   Next reset: {u.next_reset.strftime('%Y-%m-%d %H:%M')}")
            
            if u.trial_limit > 0:
                print(f"\n[GIFT] Trial:")
                print(f"   Used: {u.trial_used} / {u.trial_limit}")
                print(f"   Status: {u.trial_status}")
                if u.trial_expiry:
                    print(f"   Expires: {u.trial_expiry.strftime('%Y-%m-%d')}")
            
            if u.bonuses:
                print(f"\n[!] Bonuses:")
                for b in u.bonuses:
                    remaining = b['limit'] - b['usage']
                    print(f"   • {b['name']}: {remaining:.0f} remaining ({b['status']})")
            
            print(f"\n[STATS] Total remaining: {u.total_remaining}")
        
        print(f"\n{'='*60}")
