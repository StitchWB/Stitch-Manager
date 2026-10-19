# Canonical entry point; implementation lives in scripts/start-dev.ps1 so root and scripts usage cannot drift.

param(
    [Alias("NoBrowser")]
    [switch]$NoDesktop,
    [int]$ApiPort = 25584,
    [int]$WebPort = 5174,
    [string]$SeedFromHub,
    [string]$WebRoot,
    [switch]$ForceSeed
)

& "$PSScriptRoot\scripts\start-dev.ps1" @PSBoundParameters
exit $LASTEXITCODE
