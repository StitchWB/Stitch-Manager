# Dev mode with hot reload: Vite HMR (default 5174) + uvicorn reload (default 25584).

param(
    [Alias("NoBrowser")]
    [switch]$NoDesktop,
    [int]$ApiPort = 25584,
    [int]$WebPort = 5174,
    [string]$SeedFromHub,
    [string]$WebRoot,
    [switch]$ForceSeed
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

. "$PSScriptRoot\dev-lib.ps1"

$VITE_PORT = $WebPort
$API_PORT = $ApiPort
$VITE_URL = "http://127.0.0.1:$VITE_PORT"
$HEALTH_URL = "http://127.0.0.1:$API_PORT/health"
$REPO_ROOT = (Resolve-Path "$PSScriptRoot\..").Path
$PYTHON_ROOT = Join-Path $REPO_ROOT "python"
$VITE_ROOT = $REPO_ROOT
if ($WebRoot) {
    $resolvedWebRoot = Resolve-Path -LiteralPath $WebRoot -ErrorAction SilentlyContinue
    if (-not $resolvedWebRoot) { throw "WebRoot path not found: $WebRoot" }
    $VITE_ROOT = $resolvedWebRoot.Path
}
$VITE_ENTRY = Join-Path $VITE_ROOT "node_modules\vite\bin\vite.js"
$DEV_DB_PATH = Join-Path $REPO_ROOT "stitch.db"
# Outside the repo: uvicorn --reload watches the checkout and restarts on log writes.
$LOG_ROOT = Join-Path $env:LOCALAPPDATA "stitch-manager\dev-logs"
$script:devLogStreams = @()

function Add-DevLogStream {
    param(
        [string]$Path,
        [string]$Prefix,
        [ConsoleColor]$Color
    )

    $script:devLogStreams += [pscustomobject]@{
        Path = $Path
        Prefix = $Prefix
        Color = $Color
        Offset = 0
    }
}

function Show-NewDevLogs {
    foreach ($stream in $script:devLogStreams) {
        if (-not (Test-Path $stream.Path)) { continue }

        try {
            $fileStream = [System.IO.FileStream]::new(
                $stream.Path,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::ReadWrite
            )
            try {
                $reader = [System.IO.StreamReader]::new(
                    $fileStream,
                    [System.Text.Encoding]::UTF8,
                    $true
                )
                try {
                    $content = $reader.ReadToEnd()
                } finally {
                    $reader.Dispose()
                }
            } finally {
                $fileStream.Dispose()
            }
        } catch {
            # A writer may briefly rotate or recreate the file.
            continue
        }

        if ($content.Length -lt $stream.Offset) {
            $stream.Offset = 0
        }
        if ($content.Length -eq $stream.Offset) { continue }

        $chunk = $content.Substring($stream.Offset)
        $stream.Offset = $content.Length
        foreach ($line in ($chunk -split "`r?`n")) {
            if ($line.Length -gt 0) {
                Write-Host "$($stream.Prefix) $line" -ForegroundColor $stream.Color
            }
        }
    }
}

function Wait-PortWithLogs {
    param(
        [int]$Port,
        [int]$TimeoutSec = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Show-NewDevLogs
        if (Test-DevCtrlC) { throw "Ctrl+C received during startup." }
        if ((Get-PortOwners -Port $Port).Count -gt 0) { return $true }
        Start-Sleep -Milliseconds 200
    }
    Show-NewDevLogs
    return $false
}

function Test-DevCtrlC {
    if (-not $script:ctrlCCaptured) { return $false }
    try {
        while ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq [ConsoleKey]::C -and ([int]$key.Modifiers -band [int][ConsoleModifiers]::Control) -ne 0) {
                return $true
            }
        }
    } catch {
        return $false
    }
    return $false
}

function Add-DevJobMember {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Name
    )

    if ($devKillJob -eq [IntPtr]::Zero) { return }
    if (-not $Process -or $Process.HasExited) { return }
    try {
        [StitchDev.KillJob]::Assign($devKillJob, $Process.Id)
    } catch {
        Write-Host "      [WARN] job-object assign failed for ${Name}: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}

function Stop-TrackedProcess {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Name
    )

    if (-not $Process) { return }

    try { $Process.Refresh() } catch { return }
    if ($Process.HasExited) { return }

    Write-Host "      Terminating $Name process tree..." -ForegroundColor DarkYellow
    Stop-ProcessTree -ProcessId $Process.Id
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
# uv auto-discovers .venv from cwd; check/install/boot must share one interpreter
$venvPython = Join-Path $REPO_ROOT ".venv\Scripts\python.exe"
if (Test-Path $venvPython) { $pythonCommand = Get-Command $venvPython }
if (-not $nodeCommand) { throw "Node.js was not found in PATH." }
if (-not $pythonCommand) { throw "Python was not found in PATH." }
$pythonwPath = Join-Path (Split-Path $pythonCommand.Source) "pythonw.exe"
$desktopPythonCommand = if (Test-Path $pythonwPath) { $pythonwPath } else { $pythonCommand.Source }
if (-not (Test-Path $VITE_ENTRY)) { throw "Vite is not installed in $VITE_ROOT. Run 'npm install' there first." }

Write-Host "[CHECK] Verifying Python dev dependencies..." -ForegroundColor DarkCyan
$reqDevFile = Join-Path $PYTHON_ROOT "requirements-dev.txt"
if (-not (Test-Path $reqDevFile)) {
    Write-Host "      Warning: requirements-dev.txt not found" -ForegroundColor Yellow
} else {
    # Quick check: try importing critical packages
    & $pythonCommand.Source -c "import fastapi, uvicorn, sqlalchemy, pydantic, patchright, pytest" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      Python dev dependencies missing or incomplete" -ForegroundColor Yellow
        Write-Host "      Installing from requirements-dev.txt..." -ForegroundColor Cyan

        # Try uv first (much faster), fallback to pip
        $uvExe = Get-Command uv -ErrorAction SilentlyContinue
        if ($uvExe) {
            Write-Host "      Using uv for faster installation..." -ForegroundColor Green
            & $uvExe pip install --python $pythonCommand.Source -r $reqDevFile
        } else {
            & $pythonCommand.Source -m pip install -r $reqDevFile
        }

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install Python dev dependencies. Try running: python scripts/bootstrap.py"
        }
        Write-Host "      Dependencies installed successfully" -ForegroundColor Green
    } else {
        Write-Host "      Python dev dependencies OK" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "  Stitch Manager - Dev Mode" -ForegroundColor Green
Write-Host "  Frontend : $VITE_URL  (Vite HMR)" -ForegroundColor Cyan
Write-Host "  Backend  : http://127.0.0.1:$API_PORT  (uvicorn reload: stitch_backend + autoreg)" -ForegroundColor Magenta
Write-Host "  Dev DB   : $DEV_DB_PATH" -ForegroundColor Gray
if ($WebRoot) {
    Write-Host "  WebRoot  : $VITE_ROOT" -ForegroundColor Gray
}
Write-Host "  Shutdown : Ctrl+C" -ForegroundColor Gray
Write-Host ""

$viteProcess = $null
$apiProcess = $null
$desktopProcess = $null
$devKillJob = [IntPtr]::Zero
$script:ctrlCCaptured = $false
$exitCode = 0
$previousPythonUtf8 = $env:PYTHONUTF8
$previousPythonIoEncoding = $env:PYTHONIOENCODING

New-Item -ItemType Directory -Path $LOG_ROOT -Force | Out-Null
$viteStdoutLog = Join-Path $LOG_ROOT "vite.stdout.log"
$viteStderrLog = Join-Path $LOG_ROOT "vite.stderr.log"
$apiStdoutLog = Join-Path $LOG_ROOT "api.stdout.log"
$apiStderrLog = Join-Path $LOG_ROOT "api.stderr.log"
$desktopStdoutLog = Join-Path $LOG_ROOT "desktop.stdout.log"
$desktopStderrLog = Join-Path $LOG_ROOT "desktop.stderr.log"
$allLogPaths = @(
    $viteStdoutLog, $viteStderrLog,
    $apiStdoutLog, $apiStderrLog,
    $desktopStdoutLog, $desktopStderrLog
)
Remove-Item $allLogPaths -Force -ErrorAction SilentlyContinue
Add-DevLogStream -Path $viteStdoutLog -Prefix "[VITE]" -Color Cyan
Add-DevLogStream -Path $viteStderrLog -Prefix "[VITE:STDERR]" -Color Red
Add-DevLogStream -Path $apiStdoutLog -Prefix "[API]" -Color Magenta
Add-DevLogStream -Path $apiStderrLog -Prefix "[API:STDERR]" -Color Red
Add-DevLogStream -Path $desktopStdoutLog -Prefix "[DESKTOP]" -Color Blue
Add-DevLogStream -Path $desktopStderrLog -Prefix "[DESKTOP:STDERR]" -Color Red

Write-Host "  Logs     : $LOG_ROOT" -ForegroundColor Gray
Write-Host ""

# Backstop: if this script dies by any path, the OS closes the job handle and kills every member tree.
try {
    $devKillJob = [StitchDev.KillJob]::Create()
} catch {
    Write-Host "[WARN] Job-object kill switch unavailable ($($_.Exception.Message)); relying on the finally cleanup alone." -ForegroundColor Yellow
}

try {
    if (-not [Console]::IsInputRedirected) {
        [Console]::TreatControlCAsInput = $true
        $script:ctrlCCaptured = $true
    }
} catch { }

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
try {
    # A live parent can be an interactive run of this very script; only orphaned supervisors are provably stale.
    try {
        $staleSupervisors = @(Get-CimInstance Win32_Process -Filter "Name LIKE '%python%'" | Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf("stitch_backend.dev_supervise", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $_.CommandLine.IndexOf($REPO_ROOT, [StringComparison]::OrdinalIgnoreCase) -ge 0
        })
    } catch {
        $staleSupervisors = @()
    }
    foreach ($stale in $staleSupervisors) {
        $parentAlive = $null -ne (Get-Process -Id ([int]$stale.ParentProcessId) -ErrorAction SilentlyContinue)
        if ($parentAlive) { continue }
        Write-Host "[SWEEP] Killing stale dev supervisor pid $($stale.ProcessId) from a previous crashed run..." -ForegroundColor Yellow
        Stop-ProcessTree -ProcessId $stale.ProcessId
    }

    foreach ($port in @($VITE_PORT, $API_PORT)) {
        $owners = @(Get-PortOwners -Port $port)
        if ($owners.Count -gt 0) {
            Write-Host "[FREE] Port $port held by PID(s) $($owners -join ', ') - terminating..." -ForegroundColor Yellow
            Free-Port $port
            Start-Sleep -Milliseconds 300
            if (-not (Test-PortFree -Port $port)) {
                throw "Port $port is still bound after cleanup. Close the process holding it manually."
            }
            Write-Host "      Port $port released" -ForegroundColor Green
        }
    }

    Write-Host "[VITE] Starting frontend dev server..." -ForegroundColor Cyan
    # vite.config.ts reads STITCH_API_PORT for the /api proxy target so the frontend follows -ApiPort.
    $previousStitchApiPort = $env:STITCH_API_PORT
    $env:STITCH_API_PORT = "$API_PORT"
    try {
        $viteProcess = Start-Process `
            -FilePath $nodeCommand.Source `
            -ArgumentList @($VITE_ENTRY, "--host", "127.0.0.1", "--port", $VITE_PORT) `
            -WorkingDirectory $VITE_ROOT `
            -RedirectStandardOutput $viteStdoutLog `
            -RedirectStandardError $viteStderrLog `
            -PassThru `
            -WindowStyle Hidden
        Add-DevJobMember -Process $viteProcess -Name "Vite"
    } finally {
        if ($null -eq $previousStitchApiPort) {
            Remove-Item Env:STITCH_API_PORT -ErrorAction SilentlyContinue
        } else {
            $env:STITCH_API_PORT = $previousStitchApiPort
        }
    }

    Write-Host "      Waiting for port $VITE_PORT..." -ForegroundColor Gray -NoNewline
    if (-not (Wait-PortWithLogs -Port $VITE_PORT -TimeoutSec 20)) {
        throw "Vite did not start within 20 seconds."
    }
    Write-Host " ready" -ForegroundColor Green

    # Pre-transform the module graph so the WebView skips the cold waterfall (vite.config.ts warmup).
    try {
        Invoke-WebRequest -Uri "$VITE_URL/" -UseBasicParsing -TimeoutSec 10 | Out-Null
        Invoke-WebRequest -Uri "$VITE_URL/src/main.tsx" -UseBasicParsing -TimeoutSec 10 | Out-Null
    } catch {
        Write-Host "      (warmup request failed - Vite will transform on demand)" -ForegroundColor DarkYellow
    }

    if ($SeedFromHub) {
        Write-Host "[SEED] Resolving hub dev database..." -ForegroundColor DarkCyan
        $seedSource = $null
        if (-not (Test-Path -LiteralPath $SeedFromHub -PathType Container)) {
            Write-Host "      Warning: SeedFromHub path not found: $SeedFromHub" -ForegroundColor Yellow
        } else {
            # Same precedence as stitch_backend.config._default_db_url: canonical dir first, repo root next.
            $seedCandidates = @(
                (Join-Path $env:LOCALAPPDATA "stitch-manager\stitch.db"),
                (Join-Path $SeedFromHub "stitch.db")
            )
            foreach ($candidate in $seedCandidates) {
                if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and ((Get-Item -LiteralPath $candidate).Length -gt 0)) {
                    $seedSource = $candidate
                    break
                }
            }
            if (-not $seedSource) {
                Write-Host "      Warning: no hub dev database found in $SeedFromHub - continuing without seeding" -ForegroundColor Yellow
            }
        }
        if ($seedSource) {
            if ($seedSource -eq $DEV_DB_PATH) {
                Write-Host "      Warning: seed source is this checkout's own dev database - skipping" -ForegroundColor Yellow
            } elseif ((Test-Path -LiteralPath $DEV_DB_PATH) -and (-not $ForceSeed)) {
                Write-Host "      Dev database already present: $DEV_DB_PATH (pass -ForceSeed to overwrite)" -ForegroundColor Yellow
            } else {
                Remove-Item -LiteralPath "$DEV_DB_PATH-wal", "$DEV_DB_PATH-shm" -Force -ErrorAction SilentlyContinue
                Copy-Item -LiteralPath $seedSource -Destination $DEV_DB_PATH -Force
                Write-Host "      Copied $seedSource -> $DEV_DB_PATH" -ForegroundColor Green
                $seedSourceWal = "$seedSource-wal"
                if (Test-Path -LiteralPath $seedSourceWal) {
                    Copy-Item -LiteralPath $seedSourceWal -Destination "$DEV_DB_PATH-wal" -Force
                    Write-Host "      Copied $seedSourceWal -> $DEV_DB_PATH-wal" -ForegroundColor Green
                }
            }
        }
    }

    # present only in hub checkouts (Zone-2/3 stub providers)
    $devPluginsScript = Join-Path $PSScriptRoot "install-dev-plugins.ps1"
    if (Test-Path -LiteralPath $devPluginsScript) {
        Write-Host "[dev-plugins] Installing stub provider packages..." -ForegroundColor DarkCyan
        & $devPluginsScript -Force 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    }

    Write-Host "[API] Starting backend with polling watchfiles supervisor..." -ForegroundColor Magenta
    $previousForcePolling = $env:WATCHFILES_FORCE_POLLING
    $previousPollDelay = $env:WATCHFILES_POLL_DELAY_MS
    $previousDesktopMode = $env:STITCH_DESKTOP_MODE
    $previousDevMode = $env:STITCH_DEV_MODE
    $previousDatabaseUrl = $env:DATABASE_URL
    $env:WATCHFILES_FORCE_POLLING = "true"
    $env:WATCHFILES_POLL_DELAY_MS = "250"
    # Desktop dev backend: guest = the machine owner (admin caller context).
    $env:STITCH_DESKTOP_MODE = "1"
    # Dev mode: unsigned service plugins from plugins-local/ are loadable.
    $env:STITCH_DEV_MODE = "1"
    # Checkout-local dev DB: never the installed app's canonical DB under %LOCALAPPDATA%.
    $env:DATABASE_URL = "sqlite+aiosqlite:///" + ($DEV_DB_PATH -replace "\\", "/")
    # Graceful drain 0: WS sockets would otherwise hold the API port across reloads (Errno 10048).
    $backendCommand = "$($pythonCommand.Source) -m uvicorn stitch_backend.main:app --host 127.0.0.1 --port $API_PORT --timeout-graceful-shutdown 0"
    try {
        $apiProcess = Start-Process `
            -FilePath $pythonCommand.Source `
            -ArgumentList @(
                "-m", "stitch_backend.dev_supervise",
                "`"$backendCommand`"",
                "stitch_backend", "autoreg"
            ) `
            -WorkingDirectory $PYTHON_ROOT `
            -RedirectStandardOutput $apiStdoutLog `
            -RedirectStandardError $apiStderrLog `
            -PassThru `
            -WindowStyle Hidden
        Add-DevJobMember -Process $apiProcess -Name "backend supervisor"
    } finally {
        if ($null -eq $previousForcePolling) {
            Remove-Item Env:WATCHFILES_FORCE_POLLING -ErrorAction SilentlyContinue
        } else {
            $env:WATCHFILES_FORCE_POLLING = $previousForcePolling
        }
        if ($null -eq $previousPollDelay) {
            Remove-Item Env:WATCHFILES_POLL_DELAY_MS -ErrorAction SilentlyContinue
        } else {
            $env:WATCHFILES_POLL_DELAY_MS = $previousPollDelay
        }
        if ($null -eq $previousDesktopMode) {
            Remove-Item Env:STITCH_DESKTOP_MODE -ErrorAction SilentlyContinue
        } else {
            $env:STITCH_DESKTOP_MODE = $previousDesktopMode
        }
        if ($null -eq $previousDevMode) {
            Remove-Item Env:STITCH_DEV_MODE -ErrorAction SilentlyContinue
        } else {
            $env:STITCH_DEV_MODE = $previousDevMode
        }
        if ($null -eq $previousDatabaseUrl) {
            Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
        } else {
            $env:DATABASE_URL = $previousDatabaseUrl
        }
    }

    Write-Host "      Waiting for backend health..." -ForegroundColor Gray -NoNewline
    $healthOk = $false
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        Show-NewDevLogs
        if (Test-DevCtrlC) { throw "Ctrl+C received during startup." }
        if ($apiProcess.HasExited) { break }
        try {
            $response = Invoke-WebRequest -Uri $HEALTH_URL -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -eq 200) { $healthOk = $true; break }
        } catch {
            # The service is still starting or restarting.
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $healthOk) {
        Show-NewDevLogs
        if ($apiProcess.HasExited) {
            throw "Backend exited during startup (code $($apiProcess.ExitCode)). Port $API_PORT likely already in use - see $apiStderrLog."
        }
        throw "Backend did not answer $HEALTH_URL within 45 seconds. Port $API_PORT may be held by a stale process - see $apiStderrLog."
    }
    Write-Host " ready" -ForegroundColor Green

    if (-not $NoDesktop) {
        Write-Host "[DESKTOP] Starting Stitch Manager window..." -ForegroundColor Blue
        $desktopProcess = Start-Process `
            -FilePath $desktopPythonCommand `
            -ArgumentList @("run_gui.py", "--dev", "--external-backend") `
            -WorkingDirectory $PYTHON_ROOT `
            -RedirectStandardOutput $desktopStdoutLog `
            -RedirectStandardError $desktopStderrLog `
            -PassThru
        Add-DevJobMember -Process $desktopProcess -Name "desktop shell"

        Start-Sleep -Milliseconds 750
        $desktopProcess.Refresh()
        if ($desktopProcess.HasExited) {
            throw "Desktop shell exited during startup with code $($desktopProcess.ExitCode)."
        }
    }

    Write-Host ""
    if ($NoDesktop) {
        Write-Host "[READY] Dev servers are running without the desktop shell. Press Ctrl+C once to stop." -ForegroundColor Green
    } else {
        Write-Host "[READY] Desktop and dev servers are running. Close the window or press Ctrl+C to stop." -ForegroundColor Green
    }
    Write-Host ""

    while ($true) {
        Show-NewDevLogs
        if (Test-DevCtrlC) {
            Write-Host "`n[INFO] Ctrl+C received." -ForegroundColor Yellow
            break
        }
        Start-Sleep -Milliseconds 250
        $viteProcess.Refresh()
        $apiProcess.Refresh()

        if ($desktopProcess) {
            $desktopProcess.Refresh()
            if ($desktopProcess.HasExited) {
                Write-Host "`n[INFO] Desktop window closed." -ForegroundColor Yellow
                break
            }
        }
        if ($viteProcess.HasExited) {
            Write-Host "`n[ERROR] Vite exited with code $($viteProcess.ExitCode)." -ForegroundColor Red
            $exitCode = 1
            break
        }
        if ($apiProcess.HasExited) {
            Write-Host "`n[ERROR] Backend supervisor exited with code $($apiProcess.ExitCode)." -ForegroundColor Red
            $exitCode = 1
            break
        }
    }
} catch {
    Write-Host "`n[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
} finally {
    Show-NewDevLogs
    Write-Host "`n[STOP] Shutting down dev services..." -ForegroundColor Yellow

    Stop-TrackedProcess -Process $desktopProcess -Name "desktop shell"
    Stop-TrackedProcess -Process $apiProcess -Name "backend supervisor"
    Stop-TrackedProcess -Process $viteProcess -Name "Vite"
    if ($devKillJob -ne [IntPtr]::Zero) {
        try { [StitchDev.KillJob]::Close($devKillJob) } catch { }
        $devKillJob = [IntPtr]::Zero
    }
    Start-Sleep -Milliseconds 250
    Show-NewDevLogs

    # Remove stale listeners left by an interrupted reloader or Node child.
    Free-Port $API_PORT
    Free-Port $VITE_PORT

    if ($null -eq $previousPythonUtf8) {
        Remove-Item Env:PYTHONUTF8 -ErrorAction SilentlyContinue
    } else {
        $env:PYTHONUTF8 = $previousPythonUtf8
    }
    if ($null -eq $previousPythonIoEncoding) {
        Remove-Item Env:PYTHONIOENCODING -ErrorAction SilentlyContinue
    } else {
        $env:PYTHONIOENCODING = $previousPythonIoEncoding
    }

    if ($script:ctrlCCaptured) {
        try { [Console]::TreatControlCAsInput = $false } catch { }
        $script:ctrlCCaptured = $false
    }

    Write-Host "[OK] Dev services stopped." -ForegroundColor Green
    Write-Host "[LOGS] $LOG_ROOT" -ForegroundColor Gray
    Write-Host ""
}

exit $exitCode
