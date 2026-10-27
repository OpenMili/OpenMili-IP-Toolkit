param([string]$ScriptUrl='https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/simple-ip-check.js',[switch]$NoPause)
$ErrorActionPreference='Stop'
$file=Join-Path ([IO.Path]::GetTempPath()) ('openmili-simple-'+[guid]::NewGuid().ToString('N')+'.js')
try {
    $node=Get-Command node -ErrorAction SilentlyContinue
    if(-not $node){throw 'Node.js 20+ with npm is required: https://nodejs.org/'}
    [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
    Invoke-WebRequest -UseBasicParsing -Uri $ScriptUrl -OutFile $file
    & $node.Source $file --no-pause @args
    if($LASTEXITCODE -ne 0){throw "Check failed (exit $LASTEXITCODE). See the message above."}
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $global:LASTEXITCODE=1
} finally {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    if(-not $NoPause -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected){
        [void](Read-Host (-join [char[]](0x6309,0x56de,0x8f66,0x952e,0x7ed3,0x675f,0x2026)))
    }
}
# Do not call exit: this script also runs in the user's existing shell via irm | iex.
