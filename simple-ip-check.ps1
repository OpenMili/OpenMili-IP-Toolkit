param([string]$ScriptUrl='https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/simple-ip-check.js')
$ErrorActionPreference='Stop'
$node=Get-Command node -ErrorAction SilentlyContinue
if(-not $node){throw '需要 Node.js 18+：https://nodejs.org/'}
$file=Join-Path $env:TEMP 'openmili-simple-ip-check.js'
Invoke-WebRequest -UseBasicParsing -Uri $ScriptUrl -OutFile $file
& $node.Source $file @args
exit $LASTEXITCODE
