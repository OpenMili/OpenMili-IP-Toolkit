$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'openmili.ps1') uninstall @args
exit $LASTEXITCODE
