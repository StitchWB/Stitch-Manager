"""Google OAuth 2.0 configuration for Google Sheets integration.

Values can be overridden via environment variables (GOOGLE_OAUTH_CLIENT_ID,
GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI) so secrets stay out of
the repo.  Defaults are placeholders — set real values in .env or Google Cloud
Console.
"""

from __future__ import annotations

import os

# ponytail: module-level dict — simplest config. Upgrade to pydantic Settings if validation matters.
#
# OAuth Loopback Configuration:
# - client_id: hardcoded for Desktop app (safe to bundle, Google-approved)
# - client_secret: empty for Desktop apps (not required with PKCE)
# - redirect_uri: dynamic port on localhost (loopback flow)
#
# To get a client_id:
# 1. Go to https://console.cloud.google.com/apis/credentials
# 2. Create OAuth Client ID → Application type: "Desktop app"
# 3. Copy the Client ID and paste it below
GOOGLE_OAUTH_CONFIG: dict[str, object] = {
    "client_id": os.environ.get(
        "GOOGLE_OAUTH_CLIENT_ID",
        "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",  # ← Replace with your Desktop app client_id
    ),
    "client_secret": os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", ""),  # Empty for Desktop apps
    "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_url": "https://oauth2.googleapis.com/token",
    "userinfo_url": "https://www.googleapis.com/oauth2/v2/userinfo",
    # openid + email needed to fetch the connected user's email address.
    "scopes": ["openid", "email", "https://www.googleapis.com/auth/spreadsheets"],
    # Dynamic port will be set at runtime (loopback flow)
    "redirect_uri": os.environ.get(
        "GOOGLE_OAUTH_REDIRECT_URI",
        "http://localhost:{port}/oauth/google/callback",  # {port} replaced at runtime
    ),
}

# Settings table keys for persisted OAuth tokens.
GOOGLE_OAUTH_SETTINGS_KEYS = {
    "refresh_token": "google_oauth_refresh_token",
    "access_token": "google_oauth_access_token",
    "token_expiry": "google_oauth_token_expiry",
    "email": "google_oauth_email",
}
