# Shared helpers for dev launchers (Windows-only). Dot-source: . "$PSScriptRoot\dev-lib.ps1"

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
