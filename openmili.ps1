# OpenMili IP Toolkit - Windows PowerShell Launcher
param([string]$Proxy, [switch]$Direct, [switch]$NoPause)
$ErrorActionPreference = 'Stop'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Node.js 18+ is required: https://nodejs.org/" -ForegroundColor Red
    exit 1
}

$localScript = Join-Path $PSScriptRoot 'openmili.js'
if (Test-Path -LiteralPath $localScript) {
    $scriptToRun = $localScript
} else {
    $tempName = 'openmili-' + [guid]::NewGuid().ToString('N') + '.js'
    $scriptToRun = Join-Path ([IO.Path]::GetTempPath()) $tempName
    $remoteUrl = 'https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/openmili.js'
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $remoteUrl -OutFile $scriptToRun -TimeoutSec 8
    } catch {
        $mirrorUrl = 'https://ghproxy.net/https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/openmili.js'
        Invoke-WebRequest -UseBasicParsing -Uri $mirrorUrl -OutFile $scriptToRun -TimeoutSec 8
    }
}

try {
    $nodeArgs = @($scriptToRun)
    if ($Direct) { $nodeArgs += '-d' }
    elseif ($Proxy) { $nodeArgs += @('-p', $Proxy) }
    $nodeArgs += $args
    & $node.Source @nodeArgs
} finally {
    if ($scriptToRun -ne $localScript -and (Test-Path -LiteralPath $scriptToRun)) {
        Remove-Item -LiteralPath $scriptToRun -Force -ErrorAction SilentlyContinue
    }
}
