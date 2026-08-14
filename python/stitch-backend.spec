# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for Stitch Manager backend.
# Bundles run_gui.py (pywebview + uvicorn launcher) and all Python sources
# into a single-file executable.
#
# Windows:  stitch-backend.exe
# Linux:    stitch-backend
#
# NOTE: autoreg is NOT included as raw Python source.
# It must be pre-compiled to native extensions via:
#   python scripts/compile_autoreg.py
# The compiled output lands in python/autoreg_compiled/ and is included
# as binaries below, so no .py files end up in the distributed EXE.
#
import sys
from pathlib import Path

ROOT = Path(SPECPATH)  # python/

# Compiled native extension modules for autoreg (.pyd on Windows, .so on Linux).
# These replace the raw autoreg/ source tree — no readable Python in the release.
AUTOREG_COMPILED = ROOT / 'autoreg_compiled'

def _collect_autoreg_binaries():
    """Return [(src_path, dest_dir)] for every compiled autoreg extension."""
    entries = []
    if not AUTOREG_COMPILED.exists():
        import sys as _sys
        print(
            "ERROR: python/autoreg_compiled/ not found.\n"
            "       Run:  python scripts/compile_autoreg.py\n"
            "       before invoking PyInstaller.",
            file=_sys.stderr,
        )
        raise SystemExit(1)
    for ext in list(AUTOREG_COMPILED.rglob('*.pyd')) + list(AUTOREG_COMPILED.rglob('*.so')):
        rel_dir = str(ext.relative_to(AUTOREG_COMPILED).parent)
        dest_dir = f'autoreg/{rel_dir}'.rstrip('/.')
        entries.append((str(ext), dest_dir))
    return entries

def _collect_autoreg_data():
    """Return [(src, dest_dir)] for non-code runtime assets in autoreg_compiled/."""
    entries = []
    if not AUTOREG_COMPILED.exists():
        return entries
    asset_suffixes = {'.json', '.yaml', '.yml', '.txt', '.png', '.html', '.css', '.js'}
    for f in AUTOREG_COMPILED.rglob('*'):
        if f.is_file() and f.suffix.lower() in asset_suffixes:
            rel_dir = str(f.relative_to(AUTOREG_COMPILED).parent)
            dest_dir = f'autoreg/{rel_dir}'.rstrip('/.')
            entries.append((str(f), dest_dir))
    return entries

a = Analysis(
    [str(ROOT / 'run_gui.py')],
    pathex=[str(ROOT)],
    binaries=_collect_autoreg_binaries(),
    datas=[
        # Include all stitch_backend package files (FastAPI app, DB models, etc.)
        (str(ROOT / 'stitch_backend'), 'stitch_backend'),
        # Runtime data assets from compiled autoreg (configs, templates, etc.)
        *_collect_autoreg_data(),
        # Frontend build output (Vite dist/)
        (str(ROOT.parent / 'dist'), 'dist'),
        # App icon for pywebview window/taskbar (webview.start(icon=...))
        (str(ROOT.parent / 'resources' / 'icons' / 'app-icon.ico'), 'resources/icons'),
        # HoloNe rules for security inspector (bundled in package)
        (str(ROOT / 'stitch_backend' / 'domains' / 'ai_proxy' / 'holone_rules'), 'stitch_backend/domains/ai_proxy/holone_rules'),
        # Vendored D3-vin turnstile solver service (launched as a subprocess by
        # autoreg.captcha.turnstile_api / turnstile_solver supervisor).
        (str(ROOT.parent / 'vendor' / 'turnstile-solver'), 'vendor/turnstile-solver'),
        # NOTE: src-tauri/binaries (holone/stitch-cli-proxy-api sidecars, ~96 MB)
        # are intentionally NOT bundled — the native gateway replaced them and
        # the UI's start_ai_proxy command no longer touches the sidecars.
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
        # Optional litellm telemetry; its PyInstaller hook runs
        # json.loads(exec_statement(...)) and crashes when the subprocess
        # returns an empty string. Loaded only if callbacks=["sentry"].
        'sentry_sdk',
        # ── Local-ML stack pulled by litellm for LOCAL model inference.
        # The gateway only calls REMOTE provider APIs. ~300 MB saved.
        'torch',
        'torchvision',
        'transformers',
        'sklearn',
        'pandas',
        'sympy',
        'networkx',
        'pyarrow',
        'openpyxl',
        'nltk',
        'joblib',
        'tensorboard',
        'onnxruntime',
        'safetensors',
        # ── pywebview Qt backend — Windows uses winforms, Qt never loads.
        # Measured: 83.7 MB of Qt5 DLLs.
        'PyQt5',
        'PySide2',
        'PySide6',
        # ── Dev/doc tooling pulled transitively (sphinx 11.9 MB,
        # babel 30.3 MB of locale data, mypy).
        'sphinx',
        'babel',
        'mypy',
        # ── litellm Proxy DB driver — we run the Router SDK on SQLite.
        'psycopg2',
        # ── HF tokenizers: litellm falls back to tiktoken.
        'tokenizers',
        # ── gRPC: only Vertex/Bedrock enterprise providers need it;
        # Gemini AI Studio (google-genai) talks plain REST.
        'grpc',
        'grpc_tools',
        # NOTE: boto3/botocore intentionally KEPT — Kiro AWS SSO OIDC
        # registration (autoreg/providers/kiro/oauth_pkce.py) uses them.
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
    console=False,      # Desktop app: no console window next to the webview
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT.parent / 'resources' / 'icons' / 'app-icon.ico'),
)
