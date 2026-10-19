# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for Stitch Manager backend.
# Bundles run_gui.py (pywebview + uvicorn launcher) and all Python sources
# into a single-file executable.
#
# Windows:  stitch-backend.exe
# Linux:    stitch-backend
#
# Autoreg handling — two modes:
#
#   1. PRIVATE build (autoreg_compiled/ exists):
#      Nuitka-compiled native extensions (.pyd/.so) are included as binaries;
#      no readable .py sources end up in the EXE.
#
#   2. OPEN-CORE build (autoreg_compiled/ absent):
#      Raw python/autoreg/*.py sources are collected as data files so the
#      app runs from source.  This is the public release path — the open-core
#      tree has no compiled extensions by design (source is public).
#
# vendor/turnstile-solver and resources/icons are conditional: skipped with
# a warning when absent (open-core export omits the vendored solver).
#
import sys
from pathlib import Path

ROOT = Path(SPECPATH)  # python/

# Compiled native extension modules for autoreg (.pyd on Windows, .so on Linux).
# These replace the raw autoreg/ source tree — no readable Python in the release.
AUTOREG_COMPILED = ROOT / 'autoreg_compiled'

# Raw autoreg source tree (used as fallback when autoreg_compiled/ is absent).
AUTOREG_SRC = ROOT / 'autoreg'


def _collect_autoreg_binaries():
    """Return [(src_path, dest_dir)] for every compiled autoreg extension.

    Returns [] when autoreg_compiled/ is absent — the open-core build falls
    back to raw sources via _collect_autoreg_source_data().
    """
    entries = []
    if not AUTOREG_COMPILED.exists():
        print("WARNING: python/autoreg_compiled/ not found — falling back to "
              "raw autoreg sources (open-core build).", file=sys.stderr)
        return entries
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


def _collect_autoreg_source_data():
    """Return [(src, dest_dir)] for raw autoreg .py sources (open-core fallback).

    Used when autoreg_compiled/ is absent.  Collects the entire autoreg/ tree
    as data files so the app runs from source.
    """
    entries = []
    if not AUTOREG_SRC.is_dir():
        return entries
    for f in AUTOREG_SRC.rglob('*'):
        if not f.is_file():
            continue
        if '__pycache__' in f.parts or f.suffix == '.pyc':
            continue
        rel_dir = str(f.relative_to(AUTOREG_SRC).parent)
        dest_dir = f'autoreg/{rel_dir}'.rstrip('/.')
        entries.append((str(f), dest_dir))
    return entries


def _conditional_data(src_path, dest_dir, label):
    """Return [(src, dest)] if src_path exists, else warn and return []."""
    p = Path(src_path)
    if p.exists():
        return [(str(p), dest_dir)]
    print(f"WARNING: {label} not found at {p} — skipping (open-core build).",
          file=sys.stderr)
    return []


# ── Build datas list ──────────────────────────────────────────────────────────

_datas = [
    # Include all stitch_backend package files (FastAPI app, DB models, etc.)
    (str(ROOT / 'stitch_backend'), 'stitch_backend'),
    # Runtime data assets from compiled autoreg (configs, templates, etc.)
    *_collect_autoreg_data(),
    # Frontend build output (Vite dist/)
    (str(ROOT.parent / 'dist'), 'dist'),
    # HoloNe rules for security inspector (bundled in package)
    (str(ROOT / 'stitch_backend' / 'domains' / 'ai_proxy' / 'holone_rules'),
     'stitch_backend/domains/ai_proxy/holone_rules'),
]

# Autoreg: compiled binaries (private) or raw sources (open-core fallback).
if not AUTOREG_COMPILED.exists():
    _datas.extend(_collect_autoreg_source_data())

# Conditional: vendored D3-vin turnstile solver (Zone 2 — absent in open-core).
_datas.extend(_conditional_data(
    ROOT.parent / 'vendor' / 'turnstile-solver',
    'vendor/turnstile-solver',
    'vendor/turnstile-solver',
))

# Conditional: app icon for pywebview window/taskbar.
_datas.extend(_conditional_data(
    ROOT.parent / 'resources' / 'icons',
    'resources/icons',
    'resources/icons',
))

# Icon for the EXE itself (None if absent — PyInstaller uses default).
_icon_path = ROOT.parent / 'resources' / 'icons' / 'app-icon.ico'
_icon = str(_icon_path) if _icon_path.exists() else None


a = Analysis(
    [str(ROOT / 'run_gui.py')],
    pathex=[str(ROOT)],
    binaries=_collect_autoreg_binaries(),
    datas=_datas,
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
    icon=_icon,
)
