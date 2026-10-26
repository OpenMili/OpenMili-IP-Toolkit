param(
    [ValidateSet('auto', 'direct', 'proxy')]
    [string]$Mode = 'auto',
    [string]$Proxy = '',
    [ValidateRange(0, 2147483647)][int]$Limit = 0,
    [string]$Urls = 'domains.yaml',
    [ValidateRange(1, 3600)][int]$TimeoutSec = 5,
    [ValidateRange(0, 60000)][int]$MinDelayMs = 422,
    [ValidateRange(0, 60000)][int]$MaxDelayMs = 453,
    [string]$TargetsUrl = '',
    [switch]$Lookup,
    [string]$LookupIP = '',
    [switch]$OnlyLookup,
    [switch]$ReturnRoutes,
    [string[]]$RouteTargets = @('电信=202.96.209.133', '联通=123.125.81.6', '移动=211.136.112.50'),
    [switch]$SkipIP,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$DefaultUrls = Join-Path $ScriptDir 'domains.yaml'
$UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

function Write-ColorLine([string]$Text, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
    Write-Host $Text -ForegroundColor $Color
    [Console]::Out.Flush()
}

function Get-CurlPath {
    $cmd = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { throw '未找到 curl.exe。Windows 10/11 通常自带 curl，请先安装 curl 后重试。' }
    return $cmd.Source
}

function ConvertFrom-DomainScalar([string]$Value) {
    $value = $Value.Trim()
    if ($value.StartsWith("'")) {
        if ($value -notmatch "^'((?:[^']|'')*)'\s*(?:#.*)?$") { throw '单引号字符串格式错误' }
        $value = $Matches[1].Replace("''", "'")
    } elseif ($value.StartsWith('"')) {
        if ($value -notmatch '^("(?:[^"\\]|\\["\\])*")\s*(?:#.*)?$') { throw '双引号字符串只支持转义引号及反斜杠' }
        $value = $Matches[1] | ConvertFrom-Json
    } else {
        if ($value.StartsWith('#')) { throw '字段不能为空' }
        $value = ($value -replace '\s+#.*$', '').Trim()
        if ($value -match ':\s|^[\[\]{}&*!|>@`%]') { throw '请为特殊字符串加引号' }
    }
    if ([string]::IsNullOrWhiteSpace($value) -or $value -match '[\x00-\x1f\x7f]') { throw '字段不能为空或包含控制字符' }
    return $value
}

function Get-Targets([string]$Path) {
    $targets = @(); $item = $null; $rootSeen = $false; $lineNumber = 0
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $rows = @(Get-Content -LiteralPath $Path -Encoding UTF8) + @('  - name: __end__')
    foreach ($row in $rows) {
        $lineNumber++
        if ($row -match '^\s*(#.*)?$') { continue }
        if (-not $rootSeen) {
            if ($row -notmatch '^domains:\s*(?:#.*)?$') { throw "第 $lineNumber 行必须是 domains:" }
            $rootSeen = $true; continue
        }
        if ($row -match '^  - (name|url):\s*(.*)$') {
            $key = $Matches[1]; $value = $Matches[2]
            if ($null -ne $item) {
                if ($item.Count -ne 2) { throw "第 $lineNumber 行前的目标缺少 name 或 url" }
                $uri = $null
                if ($item.url -notmatch '^https?://[^\s]+$' -or -not [uri]::TryCreate($item.url, [UriKind]::Absolute, [ref]$uri) -or -not $uri.Host) { throw "无效 URL: $($item.url)" }
                if ($seen.Add($item.url)) { $targets += [pscustomobject]@{ Name = $item.name; Url = $item.url } }
            }
            $item = @{}
        } elseif ($row -match '^    (name|url):\s*(.*)$' -and $null -ne $item) {
            $key = $Matches[1]; $value = $Matches[2]
        } else { throw "第 $lineNumber 行格式错误（使用两格列表缩进、四格字段缩进）" }
        if ($item.ContainsKey($key)) { throw "第 $lineNumber 行字段重复: $key" }
        $item[$key] = ConvertFrom-DomainScalar $value
    }
    return $targets
}

function Get-HeaderValue([string]$Headers, [string]$Name) {
    $m = [System.Text.RegularExpressions.Regex]::Match($Headers, "(?im)^$([regex]::Escape($Name)):\s*(.+)$")
    if ($m.Success) { return $m.Groups[2].Value.Trim() }
    return ''
}

function ConvertTo-ValidIP([string]$Value, [ValidateSet('4', '6')][string]$Family) {
    $parsed = $null
    if (-not [System.Net.IPAddress]::TryParse($Value.Trim(), [ref]$parsed)) { return '' }
    if ($Family -eq '4' -and $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) { return $parsed.ToString() }
    if ($Family -eq '6' -and $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) { return $parsed.ToString() }
    return ''
}

function Invoke-CurlProbe($Target, [string]$CurlPath) {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('openmili-' + [guid]::NewGuid().ToString('N'))
    $headerPath = "$root.headers"
    $bodyPath = "$root.body"
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    New-Item -ItemType File -Path $headerPath -Force | Out-Null
    New-Item -ItemType File -Path $bodyPath -Force | Out-Null
    $started = Get-Date
    try {
        $curlArgs = @('-sS', '-L', '--max-time', [string]$TimeoutSec,
            '-A', $UserAgent,
            '-H', 'Accept: text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
            '-D', $headerPath, '-o', $bodyPath,
            '-w', '%{http_code}|%{url_effective}|%{time_total}', $Target.Url)
        if ($Mode -eq 'proxy') { $curlArgs = @('--proxy', $Proxy) + $curlArgs }
        else { $curlArgs = @('--noproxy', '*') + $curlArgs }
        $meta = (& $CurlPath @curlArgs 2>$null | Out-String).Trim()
        $exitCode = $LASTEXITCODE
        $match = [regex]::Match($meta, '(?s)(\d{3})\|([^|\r\n]*)\|([0-9.]+)')
        $status = 0; $finalUrl = $Target.Url; $duration = 0
        if ($match.Success) {
            $status = [int]$match.Groups[1].Value
            $finalUrl = $match.Groups[2].Value
            $duration = [math]::Round(([double]$match.Groups[3].Value) * 1000)
        }
        if ($duration -eq 0) { $duration = [math]::Round(((Get-Date) - $started).TotalMilliseconds) }
        $body = [IO.File]::ReadAllText($bodyPath)
        $headers = [IO.File]::ReadAllText($headerPath)
        $error = if ($exitCode -ne 0) { "curl exit code $exitCode" } else { '' }
        return [pscustomobject]@{ Status = $status; FinalUrl = $finalUrl; Duration = $duration; Body = $body; Headers = $headers; Error = $error }
    } catch {
        $duration = [math]::Round(((Get-Date) - $started).TotalMilliseconds)
        return [pscustomobject]@{ Status = 0; FinalUrl = $Target.Url; Duration = $duration; Body = ''; Headers = ''; Error = $_.Exception.Message }
    } finally {
        Remove-Item -LiteralPath $headerPath, $bodyPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $root -Force -ErrorAction SilentlyContinue
    }
}

function Get-Judgment($Target, $Response) {
    $status = [int]$Response.Status
    if ($Response.Error) { return @('!', '网络错误', $Response.Error, 'network') }
    $body = ([string]$Response.Body).ToLowerInvariant()
    $hostname = ([uri]$Target.Url).Host.ToLowerInvariant()
    $cfHeader = (Get-HeaderValue $Response.Headers 'Cf-Mitigated').ToLowerInvariant()
    if ($status -eq 403 -or $status -eq 503) {
        if ($cfHeader.Contains('challenge') -or $body.Contains('challenges.cloudflare.com') -or $body.Contains('just a moment') -or $body.Contains('turnstile')) {
            return @('🛡️', 'CF 浏览器盾', "$status Challenge", 'challenge')
        }
    }
    if (($status -eq 200 -or $status -eq 429) -and ($body -match 'recaptcha|g-recaptcha|geetest|verify you are human|gs_captcha')) {
        return @('🧩', '人机验证', "$status Captcha", 'captcha')
    }
    if ($status -eq 451 -or $status -eq 1020 -or ($status -eq 403 -and ($body.Contains('access denied') -or $body.Contains('cloudflare ray id'))) ) {
        return @('!', '访问受限', "$status", 'restricted')
    }
    if ($body -match 'not available in your country|geographic restriction|unavailable in your region') {
        return @('🌐', '地区限制', "$status Region", 'region')
    }
    $final = ([string]$Response.FinalUrl).ToLowerInvariant()
    if (($hostname.Contains('claude.ai') -and $status -eq 403 -and $body.Contains('appunavailable')) -or
        (($hostname.Contains('netflix.com') -or $hostname.Contains('disneyplus.com')) -and ($final.Contains('/unsupported') -or $body.Contains('not-available') -or $body.Contains('not available')))) {
        return @('🌐', '地区限制', "$status Region", 'region')
    }
    if ($hostname.Contains('scholar.google.com') -and ($body.Contains('/sorry/index?continue=') -or $body.Contains('gs_captcha'))) {
        return @('🧩', '人机验证', "$status Captcha", 'captcha')
    }
    if ($hostname.Contains('tiktok.com') -and $status -eq 200 -and ($body.Contains('"itemlist":[]') -or $Response.Body.Trim().Length -eq 0)) {
        return @('⚠️', '软封/空内容', "$status Empty Feed", 'soft-ban')
    }
    if ($status -ge 200 -and $status -lt 400) {
        if ($status -ne 204 -and $Response.Body.Trim().Length -eq 0) { return @('!', '响应为空', "$status", 'empty') }
        return @('✓', '服务可达', "$status", 'reachable')
    }
    if ($status -eq 403 -or $status -eq 429) { return @('!', '访问受限', "$status", 'restricted') }
    return @('!', '服务异常', "$status", 'http-error')
}

function Get-PublicIP([string]$CurlPath, [string[]]$Endpoints, [ValidateSet('4', '6')][string]$Family, [bool]$UseProxy) {
    foreach ($Endpoint in $Endpoints) {
        try {
            $curlArgs = @('-sS', '-f', '-L', "-$Family", '--connect-timeout', '1', '--max-time', '3', $Endpoint)
            if ($UseProxy) { $curlArgs = @('--proxy', $Proxy) + $curlArgs }
            else { $curlArgs = @('--noproxy', '*') + $curlArgs }
            $value = ((& $CurlPath @curlArgs 2>$null | Out-String).Trim())
            if ($LASTEXITCODE -ne 0) { continue }
            $valid = ConvertTo-ValidIP $value $Family
            if (-not [string]::IsNullOrWhiteSpace($valid)) { return $valid }
        } catch { }
    }
    return ''
}

function Get-IPDatabase([string]$IP, [string]$CurlPath) {
    if (-not $IP -or $IP -eq '未获取') { return '未测试（出口 IP 未获取）' }
    try {
        $args = @('-fsS', '--max-time', '8', '--noproxy', '*', "https://ipwho.is/$IP")
        if ($Mode -eq 'proxy') { $args = @('-fsS', '--max-time', '8', '--proxy', $Proxy, "https://ipwho.is/$IP") }
        $raw = & $CurlPath @args 2>$null
        if ($LASTEXITCODE -ne 0) { return '未测试（查询服务不可用）' }
        $data = ($raw -join "`n") | ConvertFrom-Json
        if (-not $data.success) { return '未测试（查询服务拒绝）' }
        $network = if ($data.connection.isp) { $data.connection.isp } else { $data.connection.org }
        return ("{0} {1} | {2} | AS{3}" -f $data.country, $data.city, $network, $data.connection.asn).Trim()
    } catch { return '未测试（响应无效）' }
}

function Show-ReturnRoutes {
    if ($Mode -eq 'proxy') { Write-ColorLine '三网回程: 未测试（系统路由跟踪无法经过 HTTP/SOCKS 代理）'; return }
    $trace = Get-Command tracert.exe -ErrorAction SilentlyContinue
    if (-not $trace) { Write-ColorLine '三网回程: 未测试（未找到 tracert）'; return }
    foreach ($entry in $RouteTargets) {
        if ($entry -notmatch '^([^=]+)=([^=]+)$') { throw "无效回程目标: $entry，应为 名称=IP" }
        $label = $Matches[1]; $ip = ConvertTo-ValidIP $Matches[2] '4'
        if (-not $ip) { throw "无效回程目标 IP: $entry" }
        $lines = @(& $trace.Source -4 -d -h 20 -w 300 $ip 2>&1)
        $hops = @($lines | Where-Object { $_ -match '^\s*\d+\s+' })
        $last = if ($hops.Count) { ($hops[-1] -replace '\s+', ' ').Trim() } else { '无响应' }
        $state = if ($last -match [regex]::Escape($ip)) { '到达目标' } else { '未到达目标' }
        Write-ColorLine ("回程 {0}: {1} | {2}" -f $label, $state, $last)
    }
}

if ($Urls -eq 'domains.yaml') { $Urls = $DefaultUrls }
if ($MaxDelayMs -lt $MinDelayMs) { throw 'MaxDelayMs 不能小于 MinDelayMs' }
$curlPath = Get-CurlPath
if ($Mode -eq 'direct' -and $Proxy) { throw '直连模式不能同时指定代理' }
if ($LookupIP) {
    $parsedIP = $null
    if (-not [System.Net.IPAddress]::TryParse($LookupIP, [ref]$parsedIP)) { throw 'LookupIP 必须是有效的 IPv4 或 IPv6' }
    $LookupIP = $parsedIP.ToString()
    $Lookup = $true
}
if ($OnlyLookup) {
    if ($TargetsUrl) { throw 'OnlyLookup 不能同时指定 TargetsUrl' }
    $Lookup = $true
    if ($LookupIP) { $SkipIP = $true }
    if ($LookupIP -and $Mode -eq 'auto' -and -not $Proxy) { $Mode = 'direct' }
}

Write-ColorLine 'OpenMili IP 检测 | Windows' Cyan
$directV4 = '未获取'; $directV6 = '未获取'
if (-not $SkipIP) {
    $directV4Value = Get-PublicIP $curlPath @('https://api4.ipify.org', 'https://ip4.seeip.org', 'https://ip.sb') '4' $false
    $directV6Value = Get-PublicIP $curlPath @('https://ip.sb', 'https://api6.ipify.org', 'https://api-ipv6.ip.sb/ip') '6' $false
    if (-not [string]::IsNullOrWhiteSpace($directV4Value)) { $directV4 = $directV4Value }
    if (-not [string]::IsNullOrWhiteSpace($directV6Value)) { $directV6 = $directV6Value }
    Write-ColorLine "直连出口: IPv4 $directV4 | IPv6 $directV6"
}

if (-not [string]::IsNullOrWhiteSpace($Proxy)) { $Mode = 'proxy' }
if ($Mode -eq 'auto') {
    $choice = '1'
    if (-not $NoPause -and -not [Console]::IsInputRedirected) {
        $choice = Read-Host '模式 1=直连 2=代理（默认 1）'
    }
    if ($choice.Trim() -eq '2') {
        $Mode = 'proxy'
        $Proxy = Read-Host '请输入代理地址（默认 127.0.0.1:10808，可填 192.168.1.10:7890）'
        if ([string]::IsNullOrWhiteSpace($Proxy)) { $Proxy = '127.0.0.1:10808' }
    } else {
        $Mode = 'direct'
    }
}
if ($Mode -eq 'proxy') {
    if ([string]::IsNullOrWhiteSpace($Proxy)) { $Proxy = 'http://127.0.0.1:10808' }
    if ($Proxy -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') { $Proxy = "http://$Proxy" }
    if ($Proxy -notmatch '^(https?|socks5h?)://') { throw '代理只支持 HTTP、HTTPS、SOCKS5' }
    Write-ColorLine "模式: 代理 $Proxy"
    if (-not $SkipIP) {
        $proxyV4 = Get-PublicIP $curlPath @('https://api4.ipify.org', 'https://ip4.seeip.org', 'https://ip.sb') '4' $true
        $proxyV6 = Get-PublicIP $curlPath @('https://ip.sb', 'https://api6.ipify.org', 'https://api-ipv6.ip.sb/ip') '6' $true
        if ([string]::IsNullOrWhiteSpace($proxyV4)) { $proxyV4 = '未获取' }
        if ([string]::IsNullOrWhiteSpace($proxyV6)) { $proxyV6 = '未获取' }
        Write-ColorLine "代理出口: IPv4 $proxyV4 | IPv6 $proxyV6"
    }
} else {
    Write-ColorLine '模式: 直连'
}
if ($TargetsUrl) {
    $source = $null
    if (-not [uri]::TryCreate($TargetsUrl, [UriKind]::Absolute, [ref]$source) -or $source.Scheme -ne 'https') { throw 'TargetsUrl 必须是 HTTPS 地址' }
    $downloadedTargets = Join-Path ([IO.Path]::GetTempPath()) ("openmili-targets-$([guid]::NewGuid().ToString('N')).yaml")
    try {
        $downloadArgs = @('-fsSL', '--max-time', '15', '--max-filesize', '102400', '-o', $downloadedTargets, $TargetsUrl)
        if ($Mode -eq 'proxy') { $downloadArgs = @('--proxy', $Proxy) + $downloadArgs }
        else { $downloadArgs = @('--noproxy', '*') + $downloadArgs }
        & $curlPath @downloadArgs 2>$null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $downloadedTargets)) { throw '目标清单下载失败' }
        $Urls = $downloadedTargets
    } catch {
        Remove-Item -LiteralPath $downloadedTargets -Force -ErrorAction SilentlyContinue
        throw
    }
}
try {
$targets = @()
if (-not $OnlyLookup) {
    $urlPath = (Resolve-Path -LiteralPath $Urls).Path
    $targets = @(Get-Targets $urlPath)
    if ($Limit -gt 0 -and $Limit -lt $targets.Count) { $targets = @($targets | Select-Object -First $Limit) }
    if ($targets.Count -eq 0) { throw "没有从 $Urls 读取到目标 URL" }
}

$started = Get-Date; $ok = 0; $index = 0
foreach ($target in $targets) {
    if ($index -gt 0) { Start-Sleep -Milliseconds (Get-Random -Minimum $MinDelayMs -Maximum ($MaxDelayMs + 1)) }
    $index++
    $response = Invoke-CurlProbe $target $curlPath
    $judgment = Get-Judgment $target $response
    if ($judgment[3] -eq 'reachable') { $ok++ }
    $name = if ($target.Name.Length -gt 20) { $target.Name.Substring(0, 20) } else { $target.Name }
    Write-ColorLine (('[{0}/{1}] {2}: {3} {4} {5}ms' -f $index, $targets.Count, $name, $judgment[1], $judgment[2], $response.Duration))
}
$elapsed = ((Get-Date) - $started).TotalSeconds
if (-not $OnlyLookup) { Write-ColorLine ("完成 {0:N1}s | 服务可达 {1}/{2}" -f $elapsed, $ok, $targets.Count) Green }
if ($Lookup) {
    $checkedIP = if ($LookupIP) { $LookupIP } elseif ($Mode -eq 'proxy') { $proxyV4 } else { $directV4 }
    if (-not $checkedIP) { $checkedIP = '未获取' }
    Write-ColorLine ("IP 数据库: {0} | {1}" -f $checkedIP, (Get-IPDatabase $checkedIP $curlPath))
}
if ($ReturnRoutes) { Show-ReturnRoutes }
if (-not $NoPause -and -not [Console]::IsInputRedirected) {
    Read-Host '结果已全部打印，按回车键退出' | Out-Null
}
} finally {
    if ($downloadedTargets) { Remove-Item -LiteralPath $downloadedTargets -Force -ErrorAction SilentlyContinue }
}
