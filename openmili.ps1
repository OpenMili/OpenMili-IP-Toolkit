# Pass the same CLI tokens as openmili.sh. No PowerShell named parameter translation.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20+ is required: https://nodejs.org/' }
& node -e 'if (parseInt(process.versions.node) < 20) process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 20+ is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/yaml/package.json'))) {
    if ($args -contains '--no-install' -or $args -contains '--offline') { throw 'Dependencies missing; offline/no-install forbids installation. Run npm ci.' }
    Push-Location $PSScriptRoot
    try { & npm.cmd ci --no-audit --no-fund | ForEach-Object { [Console]::Error.WriteLine($_) }; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
    finally { Pop-Location }
}
& node (Join-Path $PSScriptRoot 'bin/openmili.js') @args
exit $LASTEXITCODE
