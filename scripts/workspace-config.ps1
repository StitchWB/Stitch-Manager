# Dot-sourced into the runtime session: strict mode breaks dev-lib helpers, so none here.
function Resolve-WorkspacePath([string]$Base, [string]$Path) {
    if ([IO.Path]::IsPathRooted($Path)) { return [IO.Path]::GetFullPath($Path) }
    return [IO.Path]::GetFullPath((Join-Path $Base $Path))
}

function Get-WorkspacePlan([string]$Config, [string]$Profile = 'local') {
    $configPath = (Resolve-Path -LiteralPath $Config).Path
    $base = Split-Path $configPath
    $document = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -AsHashtable
    if (-not $document.profiles.ContainsKey($Profile)) { throw "Unknown workspace profile: $Profile" }
    $settings = $document.profiles[$Profile]
    $allowed = @('appRoot', 'backendRoot', 'python', 'apiPort', 'webPort', 'plugins')
    foreach ($key in $settings.Keys) {
        if ($key -notin $allowed) { throw "Unknown workspace setting: $key" }
    }
    foreach ($key in @('appRoot', 'apiPort', 'webPort')) {
        if (-not $settings.ContainsKey($key)) { throw "Missing workspace setting: $key" }
    }
    $appRoot = Resolve-WorkspacePath $base $settings.appRoot
    $backendRoot = if ($settings['backendRoot']) { Resolve-WorkspacePath $base $settings['backendRoot'] } else { $appRoot }
    foreach ($entry in @((Join-Path $appRoot 'package.json'), (Join-Path $backendRoot 'python/stitch_backend/main.py'))) {
        if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw "Workspace source not found: $entry" }
    }
    foreach ($key in @('apiPort', 'webPort')) {
        if ($settings[$key] -isnot [long] -and $settings[$key] -isnot [int]) { throw "$key must be an integer" }
        if ($settings[$key] -lt 1024 -or $settings[$key] -gt 65535) { throw "$key must be between 1024 and 65535" }
    }
    if ($settings.apiPort -eq $settings.webPort) { throw 'API and web ports must differ' }
    $identity = "$configPath`n$Profile"
    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($identity)))
    $state = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "stitch-workspaces/$($digest.Substring(0, 16))"
    $python = if ($settings['python']) { Resolve-WorkspacePath $base $settings['python'] } else { Join-Path $state '.venv/Scripts/python.exe' }
    $plugins = @()
    $ids = @{}
    $pluginPaths = @()
    if ($settings['plugins']) { $pluginPaths += $settings['plugins'] }
    $sourcePlugins = Join-Path $backendRoot 'plugins-src'
    if (Test-Path -LiteralPath $sourcePlugins -PathType Container) {
        $pluginPaths += @(Get-ChildItem -LiteralPath $sourcePlugins -Directory | Sort-Object Name | Where-Object {
            Test-Path -LiteralPath (Join-Path $_.FullName 'plugin.json') -PathType Leaf
        } | ForEach-Object { $_.FullName })
    }
    foreach ($path in $pluginPaths) {
        $root = Resolve-WorkspacePath $base $path
        $manifestPath = Join-Path $root 'plugin.json'
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
        if ($manifest.id -notmatch '^[a-z0-9][a-z0-9_-]*$') { throw "Invalid plugin id in $manifestPath" }
        if ($ids.ContainsKey($manifest.id)) {
            if ($ids[$manifest.id] -eq $root) { continue }
            throw "Duplicate plugin id: $($manifest.id)"
        }
        $ids[$manifest.id] = $root
        $plugins += [pscustomobject]@{ Id = $manifest.id; Kind = $manifest.kind; Root = $root }
    }
    return [pscustomobject]@{
        Profile = $Profile; Config = $configPath; AppRoot = $appRoot; BackendRoot = $backendRoot
        Python = $python; ApiPort = [int]$settings.apiPort; WebPort = [int]$settings.webPort
        State = $state; Database = Join-Path $state 'stitch.db'; Logs = Join-Path $state 'logs'
        PluginHome = Join-Path $state 'plugins'; Plugins = $plugins
    }
}

function Show-WorkspacePlan($Plan) {
    Write-Host "Workspace : $($Plan.Profile)"
    foreach ($name in @('AppRoot', 'BackendRoot', 'Python', 'State', 'Database', 'Logs', 'PluginHome')) {
        Write-Host "$($name.PadRight(10)): $($Plan.$name)"
    }
    foreach ($root in @($Plan.AppRoot, $Plan.BackendRoot) | Select-Object -Unique) {
        $branch = & git -C $root branch --show-current 2>$null
        $sha = & git -C $root rev-parse --short HEAD 2>$null
        Write-Host "Source    : $root [$branch $sha; working tree used as-is]"
    }
    Write-Host "Frontend  : http://127.0.0.1:$($Plan.WebPort) (HMR)"
    Write-Host "Backend   : http://127.0.0.1:$($Plan.ApiPort)"
    foreach ($plugin in $Plan.Plugins) { Write-Host "Plugin    : $($plugin.Id) [$($plugin.Kind)] -> $($plugin.Root)" }
}

function Assert-WorkspacePortsFree($Plan) {
    foreach ($port in @($Plan.ApiPort, $Plan.WebPort)) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
        $listener.Server.ExclusiveAddressUse = $true
        try { $listener.Start() } finally { $listener.Stop() }
    }
}
