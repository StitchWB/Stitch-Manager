# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for Stitch Manager backend.
# Bundles run_gui.py (pywebview + uvicorn launcher) and all Python sources
# into a single-file executable.
#
# Windows:  stitch-backend.exe
# Linux:    stitch-backend
#
import sys
from pathlib import Path

ROOT = Path(SPECPATH)  # python/

a = Analysis(
    [str(ROOT / 'run_gui.py')],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # Include all stitch_backend package files
        (str(ROOT / 'stitch_backend'), 'stitch_backend'),
        # Include autoreg package
        (str(ROOT / 'autoreg'), 'autoreg'),
    ],
    hiddenimports=[
        # SQLAlchemy async drivers
        'sqlalchemy.dialects.sqlite',
        'aiosqlite',
        # FastAPI / uvicorn internals
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # Pydantic
        'pydantic.deprecated.class_validators',
        # pywebview backends
        'webview.platforms.winforms',
        'webview.platforms.gtk',
        'webview.platforms.cocoa',
        # stitch_backend
        'stitch_backend.main',
        'stitch_backend.database',
        'stitch_backend.config',
        'stitch_backend.domains.accounts.service',
        'stitch_backend.domains.registration.service',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'numpy',
        'scipy',
        'PIL',
        'cv2',
    ],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='stitch-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,       # Keep console so users can see logs / errors
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
