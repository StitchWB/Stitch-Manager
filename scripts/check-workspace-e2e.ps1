#Requires -Version 7.0
param(
    [string]$StitchManagerRoot = (Join-Path $PSScriptRoot '..'),
    [string]$PythonPath = 'python'
)
$ErrorActionPreference = 'Stop'
& $PythonPath (Join-Path $PSScriptRoot 'e2e-ai-connection.py') --backend-root $StitchManagerRoot --python $PythonPath
if ($LASTEXITCODE -ne 0) { throw "Isolated connection smoke failed (exit $LASTEXITCODE)" }
