"""Entry point for running the stitch backend as a standalone process.

Usage::

    python -m stitch_backend

Or via the bundled PyInstaller executable::

    stitch-backend.exe
"""

from stitch_backend.main import run

if __name__ == "__main__":
    run()
