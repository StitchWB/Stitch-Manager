"""Best-effort child resource accounting and memory caps for plugin hosts."""

from __future__ import annotations

import logging
import sys
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import subprocess

    from stitch_backend.domains.plugin_runtime.host import ServicePluginHost

logger = logging.getLogger(__name__)


def apply_memory_caps_best_effort(
    host: ServicePluginHost, proc: subprocess.Popen[bytes]
) -> None:
    """Apply best-effort memory cap to the child process.

    - Windows: assign the process to a Job Object with
      ``JOB_OBJECT_LIMIT_PROCESS_MEMORY`` via ctypes.
    - POSIX (Linux): ``resource.prlimit`` RLIMIT_AS on the child pid.
    - Other platforms / failures: log a warning and continue.

    Called from ``_attach_rpc`` after the supervisor spawns the child.
    Best-effort — never raises.
    """
    if host.memory_limit_mb is None:
        return
    limit_bytes = host.memory_limit_mb * 1024 * 1024
    try:
        if sys.platform == "win32":
            apply_windows_job_memory_cap(host, proc, limit_bytes)
        elif sys.platform == "linux":
            import resource
            resource.prlimit(
                proc.pid,
                resource.RLIMIT_AS,
                (limit_bytes, limit_bytes),
            )
            logger.info(
                "[Plugin:%s] memory cap %dMB applied via prlimit",
                host.plugin_id, host.memory_limit_mb,
            )
        else:
            logger.warning(
                "[Plugin:%s] memory cap not supported on %s",
                host.plugin_id, sys.platform,
            )
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.warning(
            "[Plugin:%s] memory cap %dMB failed: %s",
            host.plugin_id, host.memory_limit_mb, exc,
        )


def apply_windows_job_memory_cap(
    host: ServicePluginHost, proc: subprocess.Popen[bytes], limit_bytes: int
) -> None:
    """Assign the child process to a Job Object with a memory limit.

    Handle lifecycle (leak fix): EVERY handle opened here is closed
    before returning — on success and on every failure path.  The job
    handle is closed AFTER ``AssignProcessToJobObject`` succeeds:
    closing it does NOT remove the process from the job.  A job object
    kernel object stays alive (with its limits enforced) while any
    process is a member, regardless of open handles — the assignment
    is what binds the process, not the handle.  Verified on Windows:
    ``IsProcessInJob`` still returns TRUE after the job handle is
    closed (see ``test_windows_job_cap_membership_survives_handle_close``
    in test_plugin_host.py).  Keeping the handle alive instead would
    leak one kernel handle per attach/restart until the cap silently
    stops applying.

    The child is assigned via a real process handle (``OpenProcess``)
    — ``AssignProcessToJobObject`` takes a HANDLE, not a PID.
    """
    import ctypes
    from ctypes import wintypes

    if sys.platform != "win32":
        # bare ctypes.windll raises AttributeError on POSIX; keep the same failure
        raise AttributeError("module 'ctypes' has no attribute 'windll'")
    kernel32 = ctypes.windll.kernel32

    # Win32 API constant names mirror the wrapped C symbols (hence noqa N806).
    JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100  # noqa: N806
    PROCESS_ALL_ACCESS = 0x1FFFFF  # noqa: N806

    # ctypes restype defaults to c_int which truncates handles on 64-bit Windows.
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [
        wintypes.DWORD, wintypes.BOOL, wintypes.DWORD,
    ]
    kernel32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
    ]
    kernel32.AssignProcessToJobObject.argtypes = [
        wintypes.HANDLE, wintypes.HANDLE,
    ]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

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
    try:
        info = _JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
        info.ProcessMemoryLimit = limit_bytes

        ok = kernel32.SetInformationJobObject(
            h_job, 9, ctypes.byref(info), ctypes.sizeof(info)
        )
        if not ok:
            raise ctypes.WinError()

        h_proc = kernel32.OpenProcess(PROCESS_ALL_ACCESS, False, proc.pid)
        if not h_proc:
            raise ctypes.WinError()
        try:
            ok = kernel32.AssignProcessToJobObject(h_job, h_proc)
            if not ok:
                raise ctypes.WinError()
        finally:
            kernel32.CloseHandle(h_proc)
    finally:
        # Assignment survives handle closure; failure paths release the job object.
        kernel32.CloseHandle(h_job)

    logger.info(
        "[Plugin:%s] memory cap %dMB applied via Job Object",
        host.plugin_id, host.memory_limit_mb,
    )


def snapshot_rusage_children() -> Any:
    """Snapshot POSIX ``RUSAGE_CHILDREN`` (best-effort, None if unavailable).

    Used as a baseline at attach time; the delta at child death gives
    this child's CPU time and (if it was the largest child) peak RSS.
    Returns None on non-POSIX platforms or if getrusage fails.
    """
    try:
        if sys.platform != "win32":
            import resource
            return resource.getrusage(resource.RUSAGE_CHILDREN)
    except (ImportError, OSError, AttributeError):
        return None
    return None


def read_resource_usage_at_death(
    host: ServicePluginHost, proc: subprocess.Popen[bytes]
) -> None:
    """Read peak memory + total CPU at child death (best-effort).

    Called from the ``_monitor`` death path after ``proc.wait()``
    returns.  Updates ``_peak_memory_mb`` (max of readings) and
    ``_total_cpu_s`` (cumulative).  Never raises — best-effort only.

    Platform paths:
      - Windows: ``GetProcessMemoryInfo`` (PeakWorkingSetSize) +
        ``GetProcessTimes`` (User+Kernel) via ctypes.  The Popen
        handle is still open after ``wait()`` so the kernel object
        is queryable.
      - POSIX: ``resource.getrusage(RUSAGE_CHILDREN)`` delta from
        the baseline taken at attach time.  ``ru_maxrss`` is the
        max RSS of the largest child — if the new value exceeds the
        baseline, the new value is this child's peak.  CPU time is
        the delta (cumulative across all children).
      - Other platforms: no-op (fields stay None).
    """
    try:
        if sys.platform == "win32":
            peak_mb, cpu_s = read_windows_resource_usage(host, proc)
        elif host._rusage_baseline is not None:
            peak_mb, cpu_s = read_posix_resource_usage(host)
        else:
            return
        if peak_mb is not None and peak_mb > 0:
            host._peak_memory_mb = max(
                host._peak_memory_mb or 0.0, peak_mb
            )
        if cpu_s is not None and cpu_s > 0:
            host._total_cpu_s = (host._total_cpu_s or 0.0) + cpu_s
    except Exception:  # noqa: BLE001 — best-effort, never crash the monitor
        logger.debug(
            "[Plugin:%s] resource accounting read failed",
            host.plugin_id,
            exc_info=True,
        )


def read_windows_resource_usage(
    host: ServicePluginHost, proc: subprocess.Popen[bytes]
) -> tuple[float | None, float | None]:
    """Read peak memory (MB) + total CPU (s) from a Windows process handle.

    The Popen handle is still open after ``wait()`` returns, so the
    kernel process object is queryable.  Returns (None, None) if the
    ctypes calls fail.
    """
    import ctypes
    from ctypes import wintypes

    if sys.platform != "win32":
        # bare ctypes.windll raises AttributeError on POSIX; keep the same failure
        raise AttributeError("module 'ctypes' has no attribute 'windll'")
    kernel32 = ctypes.windll.kernel32
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000  # noqa: N806 (Win32 name)

    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [
        wintypes.DWORD, wintypes.BOOL, wintypes.DWORD,
    ]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    class _PROCESS_MEMORY_COUNTERS_EX(  # noqa: N801 (Win32 struct name)
        ctypes.Structure
    ):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
            ("PrivateUsage", ctypes.c_size_t),
        ]

    kernel32.GetProcessMemoryInfo.argtypes = [
        wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
    ]
    kernel32.GetProcessMemoryInfo.restype = wintypes.BOOL

    kernel32.GetProcessTimes.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
    ]
    kernel32.GetProcessTimes.restype = wintypes.BOOL

    peak_mb: float | None = None
    cpu_s: float | None = None

    h_proc = kernel32.OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION, False, proc.pid
    )
    if not h_proc:
        return None, None
    try:
        # Peak memory
        counters = _PROCESS_MEMORY_COUNTERS_EX()
        counters.cb = ctypes.sizeof(counters)
        if kernel32.GetProcessMemoryInfo(
            h_proc, ctypes.byref(counters), counters.cb
        ):
            # PeakWorkingSetSize is in bytes
            peak_mb = counters.PeakWorkingSetSize / (1024.0 * 1024.0)

        # CPU time (User + Kernel, in 100-nanosecond intervals)
        creation = wintypes.FILETIME()
        exit_ft = wintypes.FILETIME()
        kernel = wintypes.FILETIME()
        user = wintypes.FILETIME()
        if kernel32.GetProcessTimes(
            h_proc,
            ctypes.byref(creation),
            ctypes.byref(exit_ft),
            ctypes.byref(kernel),
            ctypes.byref(user),
        ):
            # FILETIME is 100-nanosecond intervals; combine to seconds
            def _ft_to_100ns(ft: wintypes.FILETIME) -> int:
                return (ft.dwHighDateTime << 32) | ft.dwLowDateTime
            total_100ns = _ft_to_100ns(user) + _ft_to_100ns(kernel)
            cpu_s = total_100ns / 10_000_000.0
    finally:
        kernel32.CloseHandle(h_proc)

    return peak_mb, cpu_s


def read_posix_resource_usage(
    host: ServicePluginHost,
) -> tuple[float | None, float | None]:
    """Read peak memory (MB) + total CPU (s) via RUSAGE_CHILDREN delta.

    ``ru_maxrss`` in RUSAGE_CHILDREN is the max RSS of the largest
    child ever waited for.  If the new value exceeds the baseline,
    the new value is this child's peak.  CPU time is the delta
    (cumulative across all children — best-effort with multiple
    concurrent child deaths).
    """
    if sys.platform == "win32":
        # import below raises ModuleNotFoundError on Windows; keep it explicit
        raise ModuleNotFoundError("No module named 'resource'")
    import resource

    baseline = host._rusage_baseline
    if baseline is None:
        return None, None
    current = resource.getrusage(resource.RUSAGE_CHILDREN)

    # ru_maxrss: kilobytes on Linux, bytes on macOS
    rss_unit = 1024.0 if sys.platform == "linux" else 1.0
    if current.ru_maxrss > baseline.ru_maxrss:
        peak_mb = current.ru_maxrss / (rss_unit * 1024.0)
    else:
        peak_mb = None  # this child was not the largest — can't determine

    cpu_s = (
        (current.ru_utime + current.ru_stime)
        - (baseline.ru_utime + baseline.ru_stime)
    )
    if cpu_s < 0:
        cpu_s = None

    return peak_mb, cpu_s
