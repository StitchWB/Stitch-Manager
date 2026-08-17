"""Auth domain — optional app-level authentication + roles.

Off by default (desktop single-user mode unchanged).  Enabled via
``STITCH_AUTH_ENABLED=1`` for the VDS web deployment.  See
:mod:`stitch_backend.domains.auth.service` for the password hashing +
session token contract.
"""
