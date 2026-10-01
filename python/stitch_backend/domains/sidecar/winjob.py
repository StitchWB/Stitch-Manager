"""Windows kill-tree Job Object primitives.

No Windows process-group kill survives the direct child: taskkill /T walks
the tree by parent pid, so once a cooperative child exits (plugin.shutdown)
its grandchildren are unreachable — and walking a recycled pid is dangerous.
A Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE is the correct
primitive: every descendant a child spawns joins the job, and closing the
supervisor's (last) handle terminates all members atomically, alive or
orphaned.
"""

from __future__ import annotations

import sys
from typing import Any


def _win_kernel32() -> Any:
    import ctypes

    if sys.platform == "win32":
        return ctypes.windll.kernel32
    # bare ctypes.windll raises AttributeError on POSIX; keep the same failure
    raise AttributeError("module 'ctypes' has no attribute 'windll'")


def _create_kill_job() -> Any:
    """Create a Job Object whose members die when the last handle closes."""
    import ctypes
    from ctypes import wintypes

    if sys.platform != "win32":
        # same failure as _win_kernel32() on POSIX
        raise AttributeError("module 'ctypes' has no attribute 'windll'")
    kernel32 = _win_kernel32()
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    kernel32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
    ]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000  # noqa: N806 (Win32 name)

    class _IO_COUNTERS(ctypes.Structure):  # noqa: N801 (Win32 struct name)
        _fields_ = [
            ("ReadOperationCount", ctypes.c_uint64),
            ("WriteOperationCount", ctypes.c_uint64),
            ("OtherOperationCount", ctypes.c_uint64),
            ("ReadTransferCount", ctypes.c_uint64),
            ("WriteTransferCount", ctypes.c_uint64),
            ("OtherTransferCount", ctypes.c_uint64),
        ]

    class _JOBOBJECT_BASIC_LIMIT_INFORMATION(  # noqa: N801 (Win32 struct name)
        ctypes.Structure
    ):
        _fields_ = [
            ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
            ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_void_p),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class _JOBOBJECT_EXTENDED_LIMIT_INFORMATION(  # noqa: N801 (Win32 struct name)
        ctypes.Structure
    ):
        _fields_ = [
            ("BasicLimitInformation", _JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", _IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    h_job = kernel32.CreateJobObjectW(None, None)
    if not h_job:
        raise ctypes.WinError()
    info = _JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    ok = kernel32.SetInformationJobObject(
        h_job, 9, ctypes.byref(info), ctypes.sizeof(info)
    )
    if not ok:
        kernel32.CloseHandle(h_job)
        raise ctypes.WinError()
    return h_job


def _assign_to_kill_job(h_job: Any, pid: int) -> None:
    """Assign a spawned child to the kill-job via a process handle.

    The process handle is always closed before returning; the assignment
    survives handle closure (the process stays a job member).
    """
    import ctypes
    from ctypes import wintypes

    if sys.platform != "win32":
        # same failure as _win_kernel32() on POSIX
        raise AttributeError("module 'ctypes' has no attribute 'windll'")
    kernel32 = _win_kernel32()
    PROCESS_ALL_ACCESS = 0x1FFFFF  # noqa: N806 (Win32 name)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    h_proc = kernel32.OpenProcess(PROCESS_ALL_ACCESS, False, pid)
    if not h_proc:
        raise ctypes.WinError()
    try:
        ok = kernel32.AssignProcessToJobObject(h_job, h_proc)
        if not ok:
            raise ctypes.WinError()
    finally:
        kernel32.CloseHandle(h_proc)


def _close_kill_job(h_job: Any) -> None:
    """Close the supervisor's job handle — kills every remaining member."""
    from ctypes import wintypes

    kernel32 = _win_kernel32()
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle(h_job)
