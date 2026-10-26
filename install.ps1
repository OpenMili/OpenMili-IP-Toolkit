param([string]$Version='latest',[string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'OpenMili-IP-Toolkit'),[switch]$Yes)
$ErrorActionPreference='Stop'
$arch=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}else{'x64'}
$base='https://github.com/OpenMili/OpenMili-IP-Toolkit'
if($Version -eq 'latest'){
    $release=(& curl.exe -q -fsSL --max-time 60 'https://api.github.com/repos/OpenMili/OpenMili-IP-Toolkit/releases/latest') -join "`n"
    if($LASTEXITCODE -ne 0){throw 'Cannot read latest release'}
    $Version=($release|ConvertFrom-Json).tag_name
}
if($Version -notmatch '^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$'){throw 'Invalid version'}
$name="OpenMili-IP-Toolkit-$Version-win32-$arch.tar.gz"
$stage=Join-Path ([IO.Path]::GetTempPath()) ('openmili-bootstrap-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stage)|Out-Null
try{
    $archive=Join-Path $stage $name
    & curl.exe -q -fsSL --proto '=https' --proto-redir '=https' --max-time 180 --output $archive "$base/releases/download/$Version/$name"
    if($LASTEXITCODE -ne 0){throw 'Download failed'}
    $sums=(& curl.exe -q -fsSL --proto '=https' --proto-redir '=https' --max-time 60 "$base/releases/download/$Version/SHA256SUMS")
    if($LASTEXITCODE -ne 0){throw 'Checksum download failed'}
    $line=$sums|Where-Object{$_ -match ('^[a-fA-F0-9]{64}  '+[regex]::Escape($name)+'$')}|Select-Object -First 1
    if(-not $line){throw 'Missing checksum'}
    $sha=($line -split '\s+')[0]
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $sha){throw 'SHA-256 mismatch; nothing executed'}
    $names=& tar.exe -tzf $archive
    if($LASTEXITCODE -ne 0 -or ($names|Where-Object{$_ -match '^[/\\]|(^|/)\.\.(/|$)|\\|:'})){throw 'Unsafe archive paths'}
    $types=& tar.exe -tvzf $archive
    if($LASTEXITCODE -ne 0 -or ($types|Where-Object{$_ -notmatch '^[-d]'})){throw 'Links/special files rejected'}
    $core=Join-Path $stage 'core';[IO.Directory]::CreateDirectory($core)|Out-Null
    & tar.exe -xzf $archive -C $core
    if($LASTEXITCODE -ne 0){throw 'Extraction failed'}
    & (Join-Path $core 'node.exe') (Join-Path $core 'bin/openmili.js') install --archive $archive --checksum $sha --install-root $InstallRoot --yes
    if($LASTEXITCODE -ne 0){throw 'Installation failed'}
    Write-Output ('Run: "'+(Join-Path $InstallRoot 'openmili-ip.cmd')+'"')
}finally{
    $resolved=[IO.Path]::GetFullPath($stage)
    if($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) -and (Split-Path $resolved -Leaf) -like 'openmili-bootstrap-*'){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
