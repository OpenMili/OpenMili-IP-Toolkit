param(
    [ValidateSet('auto','direct','proxy')][string]$Mode = 'auto',
    [string]$Proxy = '', [int]$Port = 0, [int]$Limit = 0,
    [string]$Urls = '', [int]$TimeoutSec = 12,
    [int]$MinDelayMs = 300, [int]$MaxDelayMs = 500,
    [string]$TargetsUrl = '', [switch]$Lookup, [string]$LookupIP = '',
    [switch]$OnlyLookup, [switch]$ReturnRoutes, [string[]]$RouteTargets = @(),
    [switch]$SkipIP, [switch]$NoPause, [switch]$NoBrowser,
    [switch]$NoRoutes, [switch]$NoHistory, [switch]$NoLookup,
    [switch]$NoInstallBrowser, [switch]$Headed, [switch]$Screenshots,
    [string]$Output = '', [ValidateSet(4,6)][int]$Family = 4
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 20+ is required: https://nodejs.org/' }
$nodeMajor = ((& $node.Source --version) -replace '^v','').Split('.')[0]
if ([int]$nodeMajor -lt 20) { throw 'Node.js 20+ is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/yaml/package.json'))) {
    Push-Location $PSScriptRoot
    try { & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
    finally { Pop-Location }
}
$cli = @((Join-Path $PSScriptRoot 'bin/openmili.js'), '--mode', $Mode, '--limit', [string]$Limit,
    '--timeout', [string]$TimeoutSec, '--min-delay-ms', [string]$MinDelayMs, '--max-delay-ms', [string]$MaxDelayMs)
foreach ($pair in @(@('--proxy',$Proxy), @('--port',$(if($Port){[string]$Port}else{''})), @('--urls',$Urls), @('--targets-url',$TargetsUrl), @('--lookup-ip',$LookupIP), @('--output',$Output))) {
    if ($pair[1]) { $cli += $pair }
}
if ($PSBoundParameters.ContainsKey('Family')) { $cli += @('--family',[string]$Family) }
if ($RouteTargets.Count) { $cli += @('--route-targets',($RouteTargets -join ' ')) }
foreach ($pair in @(@('--only-lookup',$OnlyLookup), @('--skip-ip',$SkipIP), @('--no-pause',$NoPause), @('--no-browser',$NoBrowser), @('--no-routes',$NoRoutes), @('--no-history',$NoHistory), @('--no-lookup',$NoLookup), @('--no-install-browser',$NoInstallBrowser), @('--headed',$Headed), @('--screenshots',$Screenshots))) {
    if ($pair[1]) { $cli += $pair[0] }
}
& $node.Source @cli
exit $LASTEXITCODE
