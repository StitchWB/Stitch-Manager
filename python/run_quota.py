#!/usr/bin/env python3
"""
Fetch Kiro quota via CodeWhisperer API or local cache.

Usage:
  python run_quota.py                    # Use local cache (current account)
  python run_quota.py --token <token>    # Use specific token via CW API
  python run_quota.py --token <token> --region eu-central-1

Called from backend (AccountStatusService::check_kiro_status).
"""

import json
import sys
import os
import argparse

# Ensure autoreg package is on sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'autoreg'))

from autoreg.services.quota_service import QuotaService, QuotaInfo, UsageInfo


def quota_info_to_dict(info: QuotaInfo | None) -> dict:
    if info is None:
        return {"error": "NO_QUOTA"}

    data: dict = {
        "email": info.email,
        "user_id": info.user_id,
        "subscription_type": info.subscription_type,
        "subscription_title": info.subscription_title,
        "days_until_reset": info.days_until_reset,
        "error": info.error,
        "raw_response": None,  # Don't include raw response to keep output small
    }

    if info.usage is not None:
        usage: UsageInfo = info.usage
        
        # Kiro shows both "Bonus Credits" (trial) and "Credits" (base)
        # We need to SUM them: total_limit = trial_limit + base_limit
        # and total_used = trial_used + base_used
        
        # Calculate total quota (bonus + balance)
        total_limit = usage.limit + (usage.trial_limit if usage.trial_status == "ACTIVE" else 0)
        total_used = usage.used + (usage.trial_used if usage.trial_status == "ACTIVE" else 0)
        
        if total_limit > 0:
            # Use combined quota (bonus + balance)
            data["usage"] = {
                "limit": total_limit,
                "used": total_used,
                "type": "combined",
                "display_name": usage.display_name or "Credits",
            }
        else:
            # No quota limit - unlimited plan
            data["usage"] = {
                "limit": -1,  # -1 means unlimited
                "used": total_used,
                "type": "unlimited",
                "display_name": usage.display_name,
            }
        
        # Also include trial info separately if active
        if usage.trial_status == "ACTIVE":
            data["trial"] = {
                "limit": usage.trial_limit,
                "used": usage.trial_used,
                "status": usage.trial_status,
                "expiry": usage.trial_expiry.isoformat() if usage.trial_expiry else None,
            }
    else:
        data["usage"] = None

    return data


def main() -> int:
    parser = argparse.ArgumentParser(description='Fetch Kiro quota')
    parser.add_argument('--token', help='Access token for CodeWhisperer API')
    parser.add_argument('--region', default='us-east-1', help='AWS region')
    args = parser.parse_args()
    
    try:
        service = QuotaService()
        
        if args.token:
            # Use CodeWhisperer API with provided token
            info = service.get_quota_from_cw_api(args.token, args.region)
        else:
            # Use local cache or fallback
            info = service.get_current_quota()
        
        result = quota_info_to_dict(info)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e)}))
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
