# Shared helpers for dev launchers (Windows-only). Dot-source: . "$PSScriptRoot\dev-lib.ps1"

# KILL_ON_JOB_CLOSE, no BREAKAWAY_OK: descendants inherit the job; breakaway spawns fail back into it.
if (-not ('StitchDev.KillJob' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace StitchDev
{
    public static class KillJob
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(
            IntPtr hJob, int JobObjectInfoClass,
            ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInfo, int cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(int dwDesiredAccess, bool bInheritHandle, int dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
        private const int JobObjectExtendedLimitInformationClass = 9;
        private const int PROCESS_ALL_ACCESS = 0x1FFFFF;

        public static IntPtr Create()
        {
            IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero)
            {
                throw new InvalidOperationException("CreateJobObjectW failed with Win32 error " + Marshal.GetLastWin32Error());
            }
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformationClass, ref info, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
            {
                CloseHandle(job);
                throw new InvalidOperationException("SetInformationJobObject failed with Win32 error " + Marshal.GetLastWin32Error());
            }
            return job;
        }

        public static void Assign(IntPtr job, int processId)
        {
            IntPtr proc = OpenProcess(PROCESS_ALL_ACCESS, false, processId);
            if (proc == IntPtr.Zero)
            {
                throw new InvalidOperationException("OpenProcess failed for pid " + processId + " with Win32 error " + Marshal.GetLastWin32Error());
            }
            try
            {
                if (!AssignProcessToJobObject(job, proc))
                {
                    throw new InvalidOperationException("AssignProcessToJobObject failed for pid " + processId + " with Win32 error " + Marshal.GetLastWin32Error());
                }
            }
            finally
            {
                CloseHandle(proc);
            }
        }

        public static void Close(IntPtr job)
        {
            if (job != IntPtr.Zero)
            {
                CloseHandle(job);
            }
        }
    }
}
"@
}

function Stop-ProcessTree {
    # /T /F: plain Stop-Process orphans npm->node and uvicorn --reload children holding their ports.
    param([int]$ProcessId)

    if (-not $ProcessId -or $ProcessId -le 0) { return }
    try {
        & taskkill /PID $ProcessId /T /F 2>$null | Out-Null
    } catch {
        # The process may exit between port discovery and taskkill; cleanup stays idempotent.
    }
}

function Get-PortOwners {
    param([int]$Port)

    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    }
    if (-not $conns) { return @() }
    return @($conns | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -and $_ -ne 0 })
}

function Free-Port {
    # Kill whatever process tree is holding $Port.
    param([int]$Port)

    foreach ($processId in (Get-PortOwners -Port $Port)) {
        Stop-ProcessTree -ProcessId $processId
    }
}

function Test-PortFree {
    param([int]$Port)
    return (Get-PortOwners -Port $Port).Count -eq 0
}

function Wait-PortListening {
    # Block until $Port is in LISTEN state or timeout.
    param([int]$Port, [int]$TimeoutSec = 20)

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ((Get-PortOwners -Port $Port).Count -gt 0) { return $true }
        Start-Sleep -Milliseconds 200
    }
    return $false
}
