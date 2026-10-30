#Requires -Version 7.0
param(
    [string]$Config = (Join-Path $PSScriptRoot 'stitch-workspace.local.json'),
    [string]$Profile = 'local',
    [ValidateSet('Start', 'Check', 'Setup', 'Restart', 'Stop')][string]$Action = 'Start',
    [string]$Plugin,
    [switch]$NoDesktop
)

$ErrorActionPreference = 'Stop'
$configPath = (Resolve-Path -LiteralPath $Config).Path
$settings = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -AsHashtable).profiles[$Profile]
if (-not $settings) { throw "Unknown workspace profile: $Profile" }
$appRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path $configPath) $settings.appRoot))
$launcher = Join-Path $appRoot 'scripts/workspace.ps1'
if (-not (Test-Path -LiteralPath $launcher)) { throw "Workspace launcher not found in selected app checkout: $launcher" }
& $launcher -Config $configPath -Profile $Profile -Action $Action -Plugin $Plugin -NoDesktop:$NoDesktop
exit $LASTEXITCODE
