# OpenMili-IP-Toolkit: native Windows / PowerShell 5.1+ script.
[CmdletBinding()]
param([string]$Proxy = '', [switch]$Direct, [switch]$NoRoutes,
    [ValidateRange(1, 60)][int]$Timeout = 8,
    [switch]$NoColor, [switch]$NoPause, [switch]$Help)

function ConvertTo-OpenMiliSafeText([object]$Value) {
    ([string]$Value -replace '[\x00-\x1f\x7f\x1b]', ' ' -replace '\s+', ' ').Trim()
}

function Test-OpenMiliPublicIP([string]$Value, [int]$Family) {
    $address = $null
    if (-not [Net.IPAddress]::TryParse($Value, [ref]$address)) { return $false }
    $bytes = $address.GetAddressBytes()
    if ($Family -eq 6) {
        return $bytes.Length -eq 16 -and ($bytes[0] -band 0xe0) -eq 0x20 -and -not ($bytes[0] -eq 0x20 -and $bytes[1] -eq 1 -and $bytes[2] -eq 0x0d -and $bytes[3] -eq 0xb8)
    }
    if ($bytes.Length -ne 4 -or $Value -notmatch '^\d+\.\d+\.\d+\.\d+$') { return $false }
    $a = $bytes[0]; $b = $bytes[1]; $c = $bytes[2]
    return -not ($a -eq 0 -or $a -eq 10 -or $a -eq 127 -or $a -ge 224 -or
        ($a -eq 169 -and $b -eq 254) -or ($a -eq 172 -and $b -ge 16 -and $b -le 31) -or
        ($a -eq 192 -and ($b -eq 168 -or ($b -eq 0 -and ($c -eq 0 -or $c -eq 2)))) -or
        ($a -eq 100 -and $b -ge 64 -and $b -le 127) -or
        ($a -eq 198 -and ($b -eq 18 -or $b -eq 19 -or ($b -eq 51 -and $c -eq 100))) -or
        ($a -eq 203 -and $b -eq 0 -and $c -eq 113))
}

function ConvertTo-OpenMiliProxy([string]$Value) {
    $value = $Value.Trim()
    if ($value -match '^\d+$') {
        $port = 0
        if (-not [int]::TryParse($value, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { throw '代理端口应为 1–65535。' }
        return "http://127.0.0.1:$port"
    }
    $uri = $null
    if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -notin @('http','https','socks5','socks5h') -or -not $uri.Host -or
        $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -notin @('','/')) { throw '请输入端口，或 http:// / socks5h:// 代理地址。' }
    return $value
}

function Invoke-OpenMiliProcess([string]$File, [string[]]$Arguments, [int]$WaitMilliseconds = 12000) {
    # Explicit Windows quoting preserves empty arguments on PowerShell 5.1.
    $quoted = foreach ($item in $Arguments) {
        '"' + ([regex]::Replace(([regex]::Replace([string]$item, '(\\*)"', '$1$1\"')), '(\\+)$', '$1$1')) + '"'
    }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $File; $info.Arguments = $quoted -join ' '
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [Text.Encoding]::UTF8
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $expired = -not $process.WaitForExit($WaitMilliseconds)
        if ($expired) { $process.Kill(); $process.WaitForExit() }
        $out = $stdout.GetAwaiter().GetResult(); $err = $stderr.GetAwaiter().GetResult()
        return [pscustomobject]@{ Code = $(if ($expired) { 28 } else { $process.ExitCode }); Out = $out; Error = $err; TimedOut = $expired }
    } catch { return [pscustomobject]@{ Code = 127; Out = ''; Error = $_.Exception.Message; TimedOut = $false } }
    finally {
        try { if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() } } catch {}
        $process.Dispose()
    }
}

function Invoke-OpenMiliCurl {
    param([string]$Url, [int]$Family = 0, [string]$Via = '', [int]$Seconds = 8,
        [switch]$BrowserHeaders, [string]$ConnectTo = '', [switch]$NoRedirect)
    $marker = '__OPENMILI_' + [guid]::NewGuid().ToString('N') + '__'
    $curlArgs = @('-q','-sS','--connect-timeout','3','--max-time',"$Seconds",'--max-filesize','2097152',
        '--proto','=https','--proto-redir','=https','--compressed')
    if ($Via) { $curlArgs += @('--proxy',$Via,'--noproxy','') }
    else { $curlArgs += @('--proxy','','--noproxy','*') }
    # Proxy transport family is different from the destination's address family.
    if ($Family -in @(4,6) -and -not $Via) { $curlArgs += "-$Family" }
    if ($ConnectTo) { $curlArgs += @('--connect-to',$ConnectTo) }
    if (-not $NoRedirect) { $curlArgs += @('-L','--max-redirs','4') }
    if ($BrowserHeaders) {
        $curlArgs += @('-A','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
            '-H','Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            '-H','Accept-Language: en-US,en;q=0.9','-H','Upgrade-Insecure-Requests: 1',
            '-H','Sec-Fetch-Dest: document','-H','Sec-Fetch-Mode: navigate','-H','Sec-Fetch-Site: none','-H','Sec-Fetch-User: ?1')
    }
    elseif ($Url -match '^https://(?:dns\.google/resolve|cloudflare-dns\.com/dns-query)\?') {
        $curlArgs += @('-H','Accept: application/dns-json')
    }
    $bodyPath = [IO.Path]::GetTempFileName()
    $headerPath = [IO.Path]::GetTempFileName()
    try {
        $curlArgs += @('-o',$bodyPath,'-D',$headerPath,'-w',"`n${marker}%{http_code}|%{time_total}|%{url_effective}", $Url)
        $native = Invoke-OpenMiliProcess 'curl.exe' $curlArgs (($Seconds + 3) * 1000)
        $at = $native.Out.LastIndexOf("`n$marker")
        $code = 0; $duration = ''; $finalUrl = $Url
        if ($at -ge 0) {
            $parts = $native.Out.Substring($at + $marker.Length + 1).Split('|',3)
            [void][int]::TryParse($parts[0], [ref]$code)
            if ($parts.Length -ge 3) { $duration = $parts[1]; $finalUrl = $parts[2].Trim() }
        }
        $stream = [IO.File]::OpenRead($bodyPath)
        try {
            $buffer = New-Object byte[] ([Math]::Min(2097152,$stream.Length))
            $read = $stream.Read($buffer,0,$buffer.Length)
            $body = [Text.Encoding]::UTF8.GetString($buffer,0,$read)
            if ($stream.Length -gt 2097152) { $native.Code = 63 }
        } finally { $stream.Dispose() }
        $location = ''
        foreach ($line in [IO.File]::ReadLines($headerPath)) { if ($line -match '(?i)^location:\s*(.+)$') { $location = $Matches[1].Trim() } }
        [pscustomobject]@{ Code = $code; ExitCode = $native.Code; Body = $body; Duration = $duration; FinalUrl = $finalUrl; RequestUrl = $Url; Location = $location; Error = $native.Error }
    } finally { Remove-Item -LiteralPath $bodyPath,$headerPath -Force -ErrorAction SilentlyContinue }
}

function Get-OpenMiliExit([int]$Family, [string]$Via = '', [int]$Seconds = 5) {
    $sources = if ($Family -eq 4) { @('https://api4.ipify.org','https://ipv4.icanhazip.com','https://api-ipv4.ip.sb/ip') }
        else { @('https://api6.ipify.org','https://ipv6.icanhazip.com','https://api-ipv6.ip.sb/ip') }
    foreach ($url in $sources) {
        $response = Invoke-OpenMiliCurl -Url $url -Family $Family -Via $Via -Seconds $Seconds
        $ip = $response.Body.Trim()
        if ($response.ExitCode -eq 0 -and $response.Code -eq 200 -and (Test-OpenMiliPublicIP $ip $Family)) { return $ip }
    }
    return ''
}

function Get-OpenMiliPinnedIP([string]$Hostname, [int]$Family, [string]$Via, [int]$Seconds) {
    $type = if ($Family -eq 4) { 'A' } else { 'AAAA' }
    foreach ($base in @('https://dns.google/resolve','https://cloudflare-dns.com/dns-query')) {
        $answer = Invoke-OpenMiliCurl -Url ($base + '?name=' + [Uri]::EscapeDataString($Hostname) + "&type=$type") -Via $Via -Seconds $Seconds
        if ($answer.ExitCode -ne 0 -or $answer.Code -ne 200) { continue }
        try {
            $json = $answer.Body | ConvertFrom-Json
            if ($null -eq $json.Status -or $json.Status -ne 0) { continue }
            foreach ($record in $json.Answer) {
                if ($record.type -eq $(if ($Family -eq 4) { 1 } else { 28 }) -and (Test-OpenMiliPublicIP ([string]$record.data) $Family)) { return [pscustomobject]@{ IP = [string]$record.data; Label = '' } }
            }
            return [pscustomobject]@{ IP = ''; Label = "无$type" }
        } catch {}
    }
    return [pscustomobject]@{ IP = ''; Label = '解析源失败' }
}

function Invoke-OpenMiliWebsite([string]$Url, [string]$Marker, [int]$Family, [string]$Via, [int]$Seconds) {
    if (-not $Via) {
        $response = Invoke-OpenMiliCurl -Url $Url -Family $Family -Seconds $Seconds -BrowserHeaders
        return Get-OpenMiliVerdict $response $Marker
    }
    # Every redirect is pinned separately, preserving SNI/Host and destination family.
    $current = $Url
    for ($hop=0; $hop -le 4; $hop++) {
        $target = [Uri]$current
        if ($target.Scheme -ne 'https' -or $target.Port -ne 443 -or $target.UserInfo) { return [pscustomobject]@{ Kind = 'limited'; Label = '跳转待核'; Code = 0 } }
        $resolved = Get-OpenMiliPinnedIP $target.DnsSafeHost $Family $Via $Seconds
        if (-not $resolved.IP) { return [pscustomobject]@{ Kind = 'skipped'; Label = $resolved.Label; Code = 0 } }
        $remote = if ($Family -eq 6) { "[$($resolved.IP)]" } else { $resolved.IP }
        $connectTo = "$($target.DnsSafeHost):443:${remote}:443"
        $response = Invoke-OpenMiliCurl -Url $current -Family $Family -Via $Via -Seconds $Seconds -BrowserHeaders -ConnectTo $connectTo -NoRedirect
        if ($response.ExitCode -ne 0 -or $response.Code -notin @(301,302,303,307,308) -or -not $response.Location) {
            $response.RequestUrl = $Url
            return Get-OpenMiliVerdict $response $Marker
        }
        try { $current = ([Uri]::new($target,$response.Location)).AbsoluteUri }
        catch { return [pscustomobject]@{ Kind = 'limited'; Label = '跳转待核'; Code = $response.Code } }
    }
    return [pscustomobject]@{ Kind = 'failure'; Label = '跳转过多'; Code = $response.Code }
}

function Get-OpenMiliVerdict($Response, [string]$Marker) {
    $body = $Response.Body; $status = $Response.Code
    $kind = 'limited'; $label = '可达?'
    if ($Response.ExitCode -ne 0) {
        $kind = 'failure'
        $label = switch ($Response.ExitCode) { 5 { '代理DNS失败' } 6 { 'DNS失败' } 7 { '连接失败' } 28 { '超时' } 35 { 'TLS失败' } 47 { '跳转过多' } 60 { '证书错误' } 63 { '响应过大' } default { "网络错误($($Response.ExitCode))" } }
    } elseif ($body -match '(?is)<title>\s*(just a moment|attention required|security check|verify you are human)|id=["''](?:cf-chl|challenge-running)|checking your browser|verify (that )?you are human|complete the security check|unusual traffic from your computer|our systems have detected unusual traffic|<form[^>]+(?:captcha|challenge)|id=["''](?:captcha|g-recaptcha|hcaptcha)|class=["''][^"'']*(?:g-recaptcha|h-captcha)|recaptcha/api2/anchor') { $label = '验证码' }
    elseif ($body -match '(?is)unsupported_country_region_territory|not available in (your|this) (country|region|location)|not supported in your country|service is not available in your|access to this service is not available in your|unavailable in your region') { $kind = 'failure'; $label = '地区限制' }
    elseif ($status -eq 429) { $kind = 'failure'; $label = '限流' }
    elseif ($status -in @(403,451)) { $kind = 'failure'; $label = '阻断' }
    elseif ($status -eq 401 -or $Response.FinalUrl -match '(?i)(/login|/signin|accounts\.google\.com)' -or $body -match '(?is)<title>[^<]*(sign in|log in|login)') { $label = '需登录' }
    elseif ($status -ge 400) { $kind = 'failure'; $label = 'HTTP异常' }
    elseif ($body -match '(?i)(please )?(enable|turn on|requires?) javascript|javascript (is )?(required|disabled)|you need to enable javascript') { $label = '需JS' }
    elseif ($status -ge 300 -and $status -lt 400) { $label = '跳转待核' }
    elseif ($status -ge 200 -and $status -lt 300) {
        if ([string]::IsNullOrWhiteSpace($body)) { $label = '空白响应' }
        else {
            $requestHost = ''; $finalHost = ''
            try { $requestHost = ([Uri]$Response.RequestUrl).DnsSafeHost -replace '^www\.',''; $finalHost = ([Uri]$Response.FinalUrl).DnsSafeHost -replace '^www\.','' } catch {}
            if ($requestHost -and $finalHost -and $requestHost -ne $finalHost) { $label = '跳转待核' }
            elseif ($body -match $Marker) { $kind = 'pass'; $label = '通过' }
        }
    } else { $kind = 'failure'; $label = '无响应' }
    [pscustomobject]@{ Kind = $kind; Label = $label; Code = $status }
}

function Get-OpenMiliRouteHint([string]$IP) {
    switch -Regex ($IP) {
        '^59\.43\.' { return '电信 CN2' }; '^202\.97\.' { return '电信 163' }
        '^(218\.105|210\.51)\.' { return '联通 9929' }; '^219\.158\.' { return '联通 4837' }
        '^223\.120\.(19|17|16)\.' { return '移动 CMIN2' }; '^223\.(118|119|120|121)\.' { return '移动 CMI' }
    }
    return ''
}

function Write-OpenMiliText([string]$Text, [string]$Tone = '', [switch]$Inline) {
    $colors = @{ pass = 'Green'; limited = 'Yellow'; failure = 'Red'; skipped = 'DarkGray'; muted = 'DarkGray'; title = 'Cyan' }
    if ($script:OpenMiliColor -and $colors.ContainsKey($Tone)) { Write-Host $Text -ForegroundColor $colors[$Tone] -NoNewline:$Inline }
    else { Write-Host $Text -NoNewline:$Inline }
}

function Get-OpenMiliPad([string]$Text, [int]$Width) {
    $text = ConvertTo-OpenMiliSafeText $Text; $length = 0
    foreach ($ch in $text.ToCharArray()) { $length += $(if ([int]$ch -ge 0x2e80 -and [int]$ch -le 0xffef) { 2 } else { 1 }) }
    return $text + (' ' * [Math]::Max(1, $Width - $length))
}

function Write-OpenMiliSection([string]$Title) {
    Write-Host ''
    Write-OpenMiliText ("── " + $Title + ' ' + ('─' * [Math]::Max(1, $script:OpenMiliWidth - 5 - $Title.Length * 2))) 'title'
}

function Show-OpenMiliRoutes([string]$Via, [string]$IPv4) {
    Write-OpenMiliSection '三网路径 · IPv4'
    if ($Via) { Write-OpenMiliText '代理模式跳过；系统路由不能穿过 HTTP / SOCKS 代理。' 'muted'; return }
    if (-not $IPv4) { Write-OpenMiliText '未取得 IPv4 出口，跳过。' 'muted'; return }
    # Nodes/prefix hints: zhanghanyun/backtrace (MIT); see THIRD_PARTY_NOTICES.md.
    $nodes = @(
        @('北京电信','219.141.140.10'), @('北京联通','202.106.195.68'), @('北京移动','221.179.155.161'),
        @('上海电信','202.96.209.133'), @('上海联通','210.22.97.1'), @('上海移动','211.136.112.200'),
        @('广州电信','58.60.188.222'), @('广州联通','210.21.196.6'), @('广州移动','120.196.165.24'),
        @('成都电信','61.139.2.69'), @('成都联通','119.6.6.6'), @('成都移动','211.137.96.205'))
    Write-OpenMiliText '检测端 → 原版 12 节点；逐跳实测，线路特征不等于 GIA。' 'muted'
    # Three concurrent ICMP sessions per batch; each TTL is bounded at 400ms.
    for ($batch = 0; $batch -lt $nodes.Count; $batch += 3) {
        $sessions = @()
        for ($n = $batch; $n -lt [Math]::Min($batch + 3,$nodes.Count); $n++) {
            $sessions += [pscustomobject]@{ Name = $nodes[$n][0]; IP = $nodes[$n][1]; Ping = (New-Object Net.NetworkInformation.Ping); Seen = 0; Reached = $false; Error = ''; Hints = (New-Object 'System.Collections.Generic.List[string]') }
        }
        try {
            for ($ttl = 1; $ttl -le 24; $ttl++) {
                $pending = @()
                foreach ($session in $sessions) {
                    if ($session.Reached -or $session.Error) { continue }
                    try {
                        $options = New-Object Net.NetworkInformation.PingOptions($ttl, $false)
                        $pending += [pscustomobject]@{ Session = $session; Task = $session.Ping.SendPingAsync($session.IP,400,([Text.Encoding]::ASCII.GetBytes('OpenMili')),$options) }
                    } catch { $session.Error = 'ICMP 不可用' }
                }
                if (-not $pending.Count) { break }
                foreach ($probe in $pending) {
                    $session = $probe.Session
                    try {
                        $reply = $probe.Task.GetAwaiter().GetResult()
                        if ($reply.Address -and $reply.Status -in @([Net.NetworkInformation.IPStatus]::Success,[Net.NetworkInformation.IPStatus]::TtlExpired)) {
                            $session.Seen++
                            $hint = Get-OpenMiliRouteHint $reply.Address.ToString()
                            if ($hint -and -not $session.Hints.Contains($hint)) { $session.Hints.Add($hint) }
                        }
                        if ($reply.Status -eq [Net.NetworkInformation.IPStatus]::Success -and $reply.Address.ToString() -eq $session.IP) { $session.Reached = $true }
                    } catch { $session.Error = 'ICMP 不可用' }
                }
            }
            foreach ($session in $sessions) {
                $state = if ($session.Reached) { '已到达' } elseif ($session.Seen) { '部分可见' } elseif ($session.Error) { $session.Error } else { '无回应' }
                $tone = if ($session.Reached) { 'pass' } elseif ($session.Seen) { 'limited' } else { 'muted' }
                $line = (Get-OpenMiliPad $session.Name 10) + (Get-OpenMiliPad $session.IP 18) + $state
                if ($session.Hints.Count) { $line += ' · ' + ($session.Hints -join ' → ') }
                Write-OpenMiliText $line $tone
            }
        } finally { foreach ($session in $sessions) { $session.Ping.Dispose() } }
    }
}

function Start-OpenMiliCheck {
    param([string]$Proxy = '', [switch]$Direct, [switch]$NoRoutes, [int]$Timeout = 8, [switch]$NoColor, [switch]$NoPause, [switch]$Help)
    $ErrorActionPreference = 'Stop'
    $script:OpenMiliColor = -not $NoColor -and -not (Test-Path Env:NO_COLOR) -and -not [Console]::IsOutputRedirected
    $script:OpenMiliWidth = 76
    try { if ([Console]::WindowWidth -ge 30) { $script:OpenMiliWidth = [Math]::Min(80,[Console]::WindowWidth) } } catch {}
    if ($Help) { Write-Host 'OpenMili-IP-Toolkit · Windows 原生脚本'; Write-Host '.\openmili.ps1 [-Direct | -Proxy 7890] [-NoRoutes] [-Timeout 8] [-NoColor] [-NoPause]'; return }
    $interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
    try {
        if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw '需要 curl.exe；Windows 10/11 通常自带。' }
        if ($Direct -and $Proxy) { throw '-Direct 与 -Proxy 不能同时指定。' }
        $started = [Diagnostics.Stopwatch]::StartNew()
        Write-Host ''
        Write-OpenMiliText ('╭' + ('─' * ($script:OpenMiliWidth - 2)) + '╮') 'title'
        Write-OpenMiliText '  OPENMILI / IP TOOLKIT · IP 检测' 'title'
        Write-OpenMiliText '  github.com/OpenMili/OpenMili-IP-Toolkit' 'muted'
        Write-OpenMiliText ("  Windows · " + $env:PROCESSOR_ARCHITECTURE) 'muted'
        Write-OpenMiliText ('╰' + ('─' * ($script:OpenMiliWidth - 2)) + '╯') 'title'
        $direct4 = Get-OpenMiliExit 4 '' 4; $direct6 = Get-OpenMiliExit 6 '' 4
        Write-OpenMiliText ("  IPv4  " + $(if ($direct4) { $direct4 } else { '未取得' })) $(if ($direct4) { 'pass' } else { 'muted' })
        Write-OpenMiliText ("  IPv6  " + $(if ($direct6) { $direct6 } else { '未取得' })) $(if ($direct6) { 'pass' } else { 'muted' })
        if ($Proxy) { $Proxy = ConvertTo-OpenMiliProxy $Proxy }
        elseif (-not $Direct -and $interactive) {
            Write-Host "`n  [1] 开始检测    [2] 自定义端口`n"
            $choice = Read-Host '  选择 [1]'
            if ($choice -eq '2') {
                $port = Read-Host '  代理端口或地址 [7890]'
                if (-not $port.Trim()) { $port = '7890' }
                $Proxy = ConvertTo-OpenMiliProxy $port
            } elseif ($choice -and $choice -ne '1') { throw '请输入 1 或 2。' }
        }
        $exit4 = $direct4; $exit6 = $direct6
        if ($Proxy) { $exit4 = Get-OpenMiliExit 4 $Proxy 5; $exit6 = Get-OpenMiliExit 6 $Proxy 5 }
        Write-OpenMiliSection $(if ($Proxy) { '代理出口' } else { '直连检测' })
        if ($Proxy) {
            Write-OpenMiliText ('IPv4  ' + $(if ($exit4) { $exit4 } else { '未取得' })) $(if ($exit4) { 'pass' } else { 'muted' })
            Write-OpenMiliText ('IPv6  ' + $(if ($exit6) { $exit6 } else { '未取得' })) $(if ($exit6) { 'pass' } else { 'muted' })
        }
        if (-not $exit4 -and -not $exit6) { throw '未取得公网出口，请检查网络或代理。' }
        foreach ($family in @(4,6)) {
            $ip = if ($family -eq 4) { $exit4 } else { $exit6 }
            if (-not $ip) { continue }
            $gotInfo = $false
            $info = Invoke-OpenMiliCurl -Url "https://ipwho.is/$ip" -Via $Proxy -Seconds 4
            if ($info.ExitCode -eq 0 -and $info.Code -eq 200) {
                try {
                    $data = $info.Body | ConvertFrom-Json
                    if ($data.success -and $data.ip -eq $ip -and $data.connection.asn -and $data.connection.org) {
                        Write-OpenMiliText ("IPv$family · AS$($data.connection.asn) · $(ConvertTo-OpenMiliSafeText $data.connection.org) · $(ConvertTo-OpenMiliSafeText $data.country_code) · ipwho.is")
                        $gotInfo = $true
                    }
                } catch {}
            }
            if (-not $gotInfo) { Write-OpenMiliText "IPv$family · ASN/归属 未取得 · ipwho.is" 'muted' }
        }
        $sites = @(
            @('ChatGPT','https://chatgpt.com/','(?is)<title>[^<]*chatgpt'), @('Claude','https://claude.ai/','(?is)<title>[^<]*claude'),
            @('Gemini','https://gemini.google.com/','(?is)<title>[^<]*gemini'), @('Grok','https://grok.com/','(?is)<title>[^<]*grok'),
            @('Perplexity','https://www.perplexity.ai/','(?is)<title>[^<]*perplexity'), @('Google','https://www.google.com/search?q=openmili','(?is)<title>[^<]*google'),
            @('YouTube','https://www.youtube.com/','(?is)<title>[^<]*youtube'), @('Netflix','https://www.netflix.com/','(?is)<title>[^<]*netflix'),
            @('Disney+','https://www.disneyplus.com/','(?is)<title>[^<]*disney'), @('Spotify','https://open.spotify.com/','(?is)<title>[^<]*spotify'),
            @('TikTok','https://www.tiktok.com/','(?is)<title>[^<]*tiktok'), @('GitHub','https://github.com/','(?is)<title>[^<]*github'),
            @('X','https://x.com/','(?is)<title>[^<]*( / x|x /|twitter)'), @('Reddit','https://www.reddit.com/','(?is)<title>[^<]*reddit'),
            @('Hugging Face','https://huggingface.co/','(?is)<title>[^<]*(hugging face|huggingface)'), @('Scholar','https://scholar.google.com/','(?is)<title>[^<]*google scholar'))
        Write-OpenMiliSection '网站实测 · curl 浏览器标头'
        Write-OpenMiliText '绿 通过 · 黄 验证/待核 · 红 阻断/失败 · 灰 跳过' 'muted'
        Write-OpenMiliText '通过表示页面可达；不代表账号可用或流媒体可播放。' 'muted'
        $wide = $script:OpenMiliWidth -ge 68
        if ($wide) { Write-Host ((Get-OpenMiliPad '网站' 18) + (Get-OpenMiliPad 'IPv4' 24) + 'IPv6') }
        $counts = @{
            '4' = @{ pass = 0; limited = 0; failure = 0; skipped = 0 }
            '6' = @{ pass = 0; limited = 0; failure = 0; skipped = 0 }
        }
        foreach ($site in $sites) {
            $cells = @()
            foreach ($family in @(4,6)) {
                $ip = if ($family -eq 4) { $exit4 } else { $exit6 }
                if (-not $ip) { $cells += [pscustomobject]@{ Kind = 'skipped'; Label = '无出口'; Code = 0 }; continue }
                $cells += Invoke-OpenMiliWebsite $site[1] $site[2] $family $Proxy $Timeout
            }
            if ($wide) { Write-OpenMiliText (Get-OpenMiliPad $site[0] 18) '' -Inline } else { Write-Host $site[0] }
            for ($n=0; $n -lt 2; $n++) {
                $cell = $cells[$n]; $counts[[string](@(4,6)[$n])][$cell.Kind]++
                $text = $cell.Label + $(if ($cell.Code) { " $($cell.Code)" } else { '' })
                if ($wide) { Write-OpenMiliText (Get-OpenMiliPad $text 24) $cell.Kind -Inline }
                else { Write-OpenMiliText ("  IPv$(@(4,6)[$n])  $text") $cell.Kind }
            }
            if ($wide) { Write-Host '' }
        }
        Write-OpenMiliSection '出口复核'
        foreach ($family in @(4,6)) {
            $before = if ($family -eq 4) { $exit4 } else { $exit6 }
            if (-not $before) { continue }
            $after = Get-OpenMiliExit $family $Proxy 4
            if ($after -and $after -eq $before) { Write-OpenMiliText "IPv$family  $before · 起止一致" 'pass' }
            elseif ($after) { Write-OpenMiliText "IPv$family  $before → $after · 出口变化，结果不能归属于单一 IP" 'limited' }
            else { Write-OpenMiliText "IPv$family  复核失败，出口稳定性未确认" 'limited' }
        }
        if (-not $NoRoutes) { Show-OpenMiliRoutes $Proxy $exit4 }
        Write-OpenMiliSection '完成'
        foreach ($family in @(4,6)) {
            $count = $counts[[string]$family]
            Write-Host ("IPv{0}  通过 {1}  待核 {2}  失败 {3}  跳过 {4}" -f $family,$count.pass,$count.limited,$count.failure,$count.skipped)
        }
        Write-OpenMiliText ("耗时 {0:N1}s" -f $started.Elapsed.TotalSeconds) 'muted'
    } catch { Write-OpenMiliText (ConvertTo-OpenMiliSafeText $_.Exception.Message) 'failure' }
    finally { if ($interactive -and -not $NoPause) { [void](Read-Host "`n按回车键结束") } }
}

# Dot-source to import functions for local validation; iex and -File run normally.
if ($MyInvocation.InvocationName -ne '.' -and $env:OPENMILI_TEST_ONLY -ne '1') {
    Start-OpenMiliCheck -Proxy $Proxy -Direct:$Direct -NoRoutes:$NoRoutes -Timeout $Timeout -NoColor:$NoColor -NoPause:$NoPause -Help:$Help
}
