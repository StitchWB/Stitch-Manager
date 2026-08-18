"""Stitch plugin distribution server — thin FastAPI app for VPS deployment.

Tokens are NOT tied to Telegram ids (privacy + replaceable activation channel).
The signing key is kept OFFLINE; packages and manifest signatures arrive
pre-signed via the admin publish endpoint. A VPS breach is DoS-at-most, never
injection (plan §3.1 item 4).
"""
