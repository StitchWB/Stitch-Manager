# Isolated dev instance for agent-driven UI testing: own ports, throwaway DB, no desktop window.

param(
    [switch]$Stop,
    [int]$ApiPort = 0,
    [int]$WebPort = 0,
    [int]$TimeoutSec = 90
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\dev-lib.ps1"

$STATE_DIR = Join-Path $env:TEMP "stitch-dev-test"
$LOCK_PATH = Join-Path $STATE_DIR "instance.lock"
$REPO_ROOT = (Resolve-Path "$PSScriptRoot\..").Path

if ($Stop) {
    if (-not (Test-Path -LiteralPath $LOCK_PATH)) { throw "No test instance recorded at $LOCK_PATH" }
    $pid_ = [int](Get-Content -LiteralPath $LOCK_PATH -Raw).Trim()
    Stop-ProcessTree -ProcessId $pid_
    Remove-Item -LiteralPath $LOCK_PATH -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Stopped test instance (pid $pid_)."
    exit 0
}

function Find-FreePort {
    param([int]$From, [int]$To)
    for ($p = $From; $p -le $To; $p++) {
        if (Test-PortFree -Port $p) { return $p }
    }
    throw "No free port in $From..$To"
}

if ($ApiPort -eq 0) { $ApiPort = Find-FreePort -From 25590 -To 25699 }
if ($WebPort -eq 0) { $WebPort = Find-FreePort -From 5190 -To 5229 }

New-Item -ItemType Directory -Path $STATE_DIR -Force | Out-Null
$DbPath = Join-Path $STATE_DIR ("dev-{0}.db" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

$child = Start-Process `
    -FilePath "pwsh" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $REPO_ROOT "scripts\start-dev.ps1"),
        "-NoDesktop", "-ApiPort", "$ApiPort", "-WebPort", "$WebPort", "-DbPath", "$DbPath") `
    -WorkingDirectory $REPO_ROOT `
    -WindowStyle Hidden `
    -PassThru

Set-Content -LiteralPath $LOCK_PATH -Value $child.Id

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    if ($child.HasExited) { throw "start-dev exited with code $($child.ExitCode) - see %LOCALAPPDATA%\stitch-manager\dev-logs" }
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/health" -TimeoutSec 2 -SkipHttpErrorCheck
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
}
if (-not $healthy) {
    Stop-ProcessTree -ProcessId $child.Id
    throw "Test backend did not become healthy within $TimeoutSec seconds."
}

Write-Host "FRONT=http://127.0.0.1:$WebPort"
Write-Host "API=http://127.0.0.1:$ApiPort"
Write-Host "DB=$DbPath"
Write-Host "LOCK=$LOCK_PATH (stop: pwsh scripts/dev-test-instance.ps1 -Stop)"
