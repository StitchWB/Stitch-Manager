"""Nuitka compilation of staged provider packages into native extensions.

``compile_provider_package`` takes the output of
:func:`stitch_plugin_tools.publish.pack_provider` and replaces the Python
sources with a single compiled extension module.  Re-exported from
:mod:`stitch_plugin_tools.publish`.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from autoreg.plugin.manifest import MANIFEST_FILENAME


def compile_provider_package(package_dir: Path, provider_id: str) -> Path:
    """Compile a staged provider plugin package into one native extension.

    Takes the output of :func:`pack_provider` (a directory of ``.py`` files +
    ``plugin.json``) and replaces the Python sources with a single
    Nuitka-compiled extension module, then rewrites the manifest entry to the
    compiled form.  This is what keeps the method source code out of the
    distributed artifact — only machine code ships.

    The package is compiled under the module name ``<provider_id>_provider``
    (identifier-safe; matches the ``PyInit_`` export the loader resolves).  The
    compiled ``--mode=package`` output bundles every package module yet leaves
    host imports (``autoreg.shared``, ``pydantic``, ...) as runtime imports
    resolved from the host app — verified empirically.

    Requires a C compiler reachable by Nuitka (MSVC on Windows, gcc/cc on
    Linux) and ``nuitka`` installed in the running interpreter.

    Args:
        package_dir: Staged package directory (from :func:`pack_provider`).
        provider_id: Provider id (e.g. ``"trae"``).

    Returns the path of the compiled extension module inside ``package_dir``.

    Raises:
        FileNotFoundError: ``provider.py`` missing from the staged package.
        ValueError: the ``Provider = <Class>`` alias cannot be detected.
        RuntimeError: Nuitka failed or produced no binary.
    """
    import json
    import subprocess
    import sys
    import tempfile

    base_name = f"{provider_id.replace('-', '_')}_provider"

    # ── 1. Detect the real provider class (exported by the package __init__) ─
    provider_py = package_dir / "provider.py"
    if not provider_py.is_file():
        raise FileNotFoundError(f"provider.py not found in {package_dir}")
    match = re.search(
        r"^Provider\s*=\s*(\w+)", provider_py.read_text(encoding="utf-8"), re.MULTILINE
    )
    if not match:
        raise ValueError(
            f"could not detect 'Provider = <Class>' alias in {provider_py}"
        )
    class_name = match.group(1)

    with tempfile.TemporaryDirectory(prefix="stitch-nuitka-") as tmp:
        # Nuitka derives the compiled module name from the directory name.
        src_dir = Path(tmp) / base_name
        src_dir.mkdir()
        for py_file in package_dir.rglob("*.py"):
            dst = src_dir / py_file.relative_to(package_dir)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(py_file, dst)

        # ── 3. Compile the whole package into one extension module ─────────
        build_out = Path(tmp) / "build"
        cmd = [
            sys.executable,
            "-m",
            "nuitka",
            "--mode=package",
            "--remove-output",   # clean intermediate C build artefacts
            "--no-pyi-file",     # no type stubs in the distributed package
            f"--output-dir={build_out}",
            str(src_dir),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(
                f"Nuitka compile failed for {provider_id} "
                f"(rc={proc.returncode}):\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}"
            )

        # ── 4. Move the produced binary into the package dir ───────────────
        binaries = [
            b
            for b in build_out.glob(f"{base_name}.*")
            if b.is_file() and not b.name.endswith((".pyi", ".json"))
        ]
        if not binaries:
            raise RuntimeError(
                f"Nuitka reported success but no {base_name}.* binary in {build_out}"
            )
        binary = sorted(binaries)[0]
        target = package_dir / binary.name
        shutil.copy2(binary, target)

    # ── 5. Strip the Python sources — only the binary must ship ──────────
    for py_file in list(package_dir.rglob("*.py")):
        py_file.unlink()
    for pyc_file in list(package_dir.rglob("*.pyc")):
        pyc_file.unlink()
    for cache_dir in list(package_dir.rglob("__pycache__")):
        shutil.rmtree(cache_dir, ignore_errors=True)

    # ── 6. Rewrite the manifest entry to the compiled form ───────────────
    manifest_path = package_dir / MANIFEST_FILENAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entry"] = {
        "module": base_name,
        "class": class_name,
        "compiled": True,
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return target
