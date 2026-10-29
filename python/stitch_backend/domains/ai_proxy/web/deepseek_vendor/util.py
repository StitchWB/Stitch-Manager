"""Pure helpers: token normalization and WAF challenge classification."""
import json


def _normalize_token(token: str) -> str:
    """Accept either a bare token or DeepSeek's localStorage JSON wrapper.

    DeepSeek stores its token in localStorage as
        {"value":"<bare-token>","__version":"0"}
    but the network layer sends only the bare value as `Authorization:
    Bearer <bare-token>`. Users sometimes copy the localStorage form by
    mistake. Auto-unwrap it so the adapter accepts either form.
    """
    if not token:
        return token
    s = token.strip()
    if s.startswith("Bearer "):
        s = s[len("Bearer "):].strip()
    if s.startswith("{") and s.endswith("}"):
        try:
            obj = json.loads(s)
            if isinstance(obj, dict) and "value" in obj and isinstance(obj["value"], str):
                return obj["value"]
        except (ValueError, TypeError):
            pass
    return s


def _detect_waf_challenge(status: int, headers) -> str | None:
    """Return the challenge kind if the response is a WAF/CDN challenge."""
    get = headers.get if hasattr(headers, "get") else lambda k, d=None: dict(headers).get(k, d)
    waf_action = (get("x-amzn-waf-action") or "").lower()
    cf_mitigated = (get("cf-mitigated") or "").lower()
    if status == 405 and waf_action == "captcha":
        return "aws-waf-captcha"
    if status == 202 and waf_action == "challenge":
        return "aws-waf-challenge"
    if status in (403, 429) and cf_mitigated == "challenge":
        return "cloudflare-challenge"
    return None
