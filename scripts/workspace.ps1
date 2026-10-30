#Requires -Version 7.0
param(
    [string]$Config = (Join-Path $PSScriptRoot '../stitch-workspace.local.json'),
    [string]$Profile = 'local',
    [ValidateSet('Start', 'Check', 'Setup', 'Restart', 'Stop')][string]$Action = 'Start',
    [string]$Plugin,
    [switch]$NoDesktop
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/workspace-config.ps1"
$plan = Get-WorkspacePlan $Config $Profile
Show-WorkspacePlan $plan
$pluginIds = @($plan.Plugins | ForEach-Object { $_.Id })
$stopFile = Join-Path $plan.State 'stop.request'
if ($Action -eq 'Stop') {
    if (-not (Test-Path -LiteralPath $plan.State)) { throw 'This workspace has not been started' }
    [IO.File]::WriteAllText($stopFile, '')
    exit 0
}
if ($Action -eq 'Check') {
    Assert-WorkspacePortsFree $plan
    if (-not (Test-Path -LiteralPath $plan.Python)) { throw "Python environment missing. Run -Action Setup: $($plan.Python)" }
    if (-not (Test-Path -LiteralPath (Join-Path $plan.AppRoot 'node_modules/vite/bin/vite.js'))) { throw 'Run npm install in AppRoot first' }
    exit 0
}
if ($Action -eq 'Restart') {
    if ($Plugin -notin $pluginIds) { throw 'Select a plugin id declared in this profile with -Plugin' }
    Invoke-RestMethod -Uri "http://127.0.0.1:$($plan.ApiPort)/api/restart_service_plugin" `
        -Method Post -ContentType 'application/json' -Body (@{ plugin_id = $Plugin } | ConvertTo-Json) -TimeoutSec 30
    exit 0
}

New-Item -ItemType Directory -Path $plan.State -Force | Out-Null
try {
    $lock = [IO.File]::Open((Join-Path $plan.State 'instance.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch [IO.IOException] {
    [Console]::Error.WriteLine("Workspace '$Profile' is already running. Stop it first: dev.ps1 -Action Stop -Profile $Profile")
    exit 1
}
$previous = @{}
try {
    Assert-WorkspacePortsFree $plan
    if ($Action -eq 'Setup') {
        $venv = Join-Path $plan.State '.venv'
        $expectedPython = Join-Path $venv 'Scripts/python.exe'
        if ($plan.Python -ne $expectedPython) { throw 'Setup only manages the workspace-owned environment. Remove python from the profile to use it.' }
        & uv venv $venv --python 3.12 --allow-existing
        if ($LASTEXITCODE -ne 0) { throw 'uv venv failed' }
        & uv pip install --python $plan.Python -r (Join-Path $plan.BackendRoot 'python/requirements-dev.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
        exit 0
    }
    if (-not (Test-Path -LiteralPath $plan.Python)) { throw 'Python environment missing; run -Action Setup' }
    Remove-Item -LiteralPath $stopFile -ErrorAction SilentlyContinue
    $environment = @{
        STITCH_PLUGINS_DIR = $plan.PluginHome
        LOCALAPPDATA = Join-Path $plan.State 'appdata/local'
        APPDATA = Join-Path $plan.State 'appdata/roaming'
        XDG_DATA_HOME = Join-Path $plan.State 'appdata/data'
        XDG_CACHE_HOME = Join-Path $plan.State 'appdata/cache'
        STITCH_DEV_API_PORT = "$($plan.ApiPort)"
        STITCH_DEV_WEB_PORT = "$($plan.WebPort)"
        STITCH_CORS_ORIGINS = "http://127.0.0.1:$($plan.WebPort),http://localhost:$($plan.WebPort)"
        PYTHONUTF8 = '1'; PYTHONIOENCODING = 'utf-8'; GIT_MASTER = '1'
    }
    foreach ($name in $environment.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name)
        [Environment]::SetEnvironmentVariable($name, $environment[$name])
    }
    $localPlugins = Join-Path $plan.PluginHome 'plugins-local'
    New-Item -ItemType Directory -Path $localPlugins -Force | Out-Null
    foreach ($entry in Get-ChildItem -LiteralPath $localPlugins -Directory) {
        if ($entry.Name -notin $pluginIds) { Remove-Item -LiteralPath $entry.FullName -Recurse -Force }
    }
    Push-Location (Join-Path $plan.BackendRoot 'python')
    try {
        foreach ($entry in $plan.Plugins) {
            & $plan.Python -m stitch_plugin_tools dev-install $entry.Root --link
            if ($LASTEXITCODE -ne 0) { throw "dev-install failed: $($entry.Id)" }
        }
    } finally { Pop-Location }
    & "$PSScriptRoot/workspace-runtime.ps1" -BackendRoot $plan.BackendRoot -WebRoot $plan.AppRoot `
        -PythonPath $plan.Python -LogRoot $plan.Logs -DbPath $plan.Database `
        -ApiPort $plan.ApiPort -WebPort $plan.WebPort -NoDesktop:$NoDesktop -WorkspaceMode -StopFile $stopFile
    exit $LASTEXITCODE
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name]) }
    $lock.Dispose()
}
