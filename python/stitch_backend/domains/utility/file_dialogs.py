"""File dialog and file I/O commands — replaces legacy plugin dialog.

Uses tkinter (stdlib on Windows) for native file dialogs in a background
thread so the asyncio event loop is not blocked.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from stitch_backend.core.command_registry import register_command

logger = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _run_tk_dialog(dialog_fn, **kwargs) -> Any:
    """Run a tkinter dialog in a thread (tkinter must run in its own event loop)."""
    import tkinter as tk  # noqa: PLC0415
    from tkinter import filedialog  # noqa: PLC0415

    result: Any = None

    def _open():
        nonlocal result
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        try:
            result = dialog_fn(parent=root, **kwargs)
        finally:
            root.destroy()

    thread = asyncio.get_event_loop().run_in_executor(None, _open)
    return thread


# ── Commands ───────────────────────────────────────────────────────────────────

@register_command("open_file_dialog")
async def cmd_open_file_dialog(params: dict) -> dict:
    """Open a file picker dialog.

    Params:
        title       – dialog title
        multiple    – allow multi-select (default: False)
        filters     – [{name, extensions}] e.g. [{name: "JSON", extensions: ["json"]}]
        directory   – if True, pick a folder instead of a file
    """
    from tkinter import filedialog  # noqa: PLC0415

    title = params.get("title", "Open")
    multiple = params.get("multiple", False)
    filters_raw = params.get("filters", [])
    is_directory = params.get("directory", False)

    filetypes = [(f.get("name", "*"), " ".join(f".{e}" for e in f.get("extensions", ["*"])))
                 for f in filters_raw] or [("All files", "*.*")]

    def _do():
        import tkinter as tk  # noqa: PLC0415

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        try:
            if is_directory:
                return filedialog.askdirectory(title=title, parent=root)
            elif multiple:
                return filedialog.askopenfilenames(title=title, filetypes=filetypes, parent=root)
            else:
                return filedialog.askopenfilename(title=title, filetypes=filetypes, parent=root)
        finally:
            root.destroy()

    result = await asyncio.get_event_loop().run_in_executor(None, _do)

    # Normalize result
    if not result:
        return {"selected": None}
    if isinstance(result, tuple):
        paths = list(result)
        return {"selected": paths if multiple else (paths[0] if paths else None)}
    return {"selected": result}


@register_command("save_file_dialog")
async def cmd_save_file_dialog(params: dict) -> dict:
    """Open a save-file picker dialog.

    Params:
        title        – dialog title
        defaultPath  – suggested filename
        filters      – [{name, extensions}]
    """
    from tkinter import filedialog  # noqa: PLC0415

    title = params.get("title", "Save")
    default_path = params.get("defaultPath", "")
    filters_raw = params.get("filters", [])

    filetypes = [(f.get("name", "*"), " ".join(f".{e}" for e in f.get("extensions", ["*"])))
                 for f in filters_raw] or [("All files", "*.*")]

    initial_dir = ""
    initial_file = ""
    if default_path:
        p = Path(default_path)
        initial_dir = str(p.parent) if p.parent != p else ""
        initial_file = p.name

    def _do():
        import tkinter as tk  # noqa: PLC0415

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        try:
            return filedialog.asksaveasfilename(
                title=title,
                filetypes=filetypes,
                initialdir=initial_dir or None,
                initialfile=initial_file or None,
                parent=root,
            )
        finally:
            root.destroy()

    result = await asyncio.get_event_loop().run_in_executor(None, _do)
    return {"selected": result or None}


@register_command("read_file_text")
async def cmd_read_file_text(params: dict) -> dict:
    """Read a text file by path. Replaces `convertFileSrc(path)` + fetch.

    Params:
        path – absolute file path
    """
    path = params.get("path", "")
    if not path:
        raise ValueError("Missing 'path' parameter")

    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")
    if not p.is_file():
        raise ValueError(f"Not a file: {path}")

    # Security: limit file size to 50 MB
    size = p.stat().st_size
    if size > 50 * 1024 * 1024:
        raise ValueError(f"File too large ({size} bytes), max 50 MB")

    content = await asyncio.get_event_loop().run_in_executor(
        None, p.read_text, "utf-8"
    )
    return {"content": content, "size": size, "path": str(p)}


@register_command("emit_event")
async def cmd_emit_event(params: dict) -> dict:
    """Forward a frontend emit to the Python EventBus (for WS broadcast).

    Used when frontend calls `emit('SETTINGS_UPDATED', data)` so that
    other WS-connected tabs also receive the event.
    """
    from stitch_backend.core.event_bus import event_bus

    event_name = params.get("event", "")
    data = params.get("data", {})
    if not event_name:
        raise ValueError("Missing 'event' parameter")

    await event_bus.emit(event_name, data)
    return {"ok": True}
