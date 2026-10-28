# OpenMili-IP-Toolkit: native Windows / PowerShell 5.1+ script.
[CmdletBinding()]
param([string]$Proxy = '', [switch]$Direct, [switch]$NoRoutes,
    [ValidateRange(1, 60)][int]$Timeout = 8,
    [switch]$NoColor, [switch]$NoPause, [switch]$Help)

function ConvertTo-OpenMiliSafeText([object]$Value) {
    ([string]$Value -replace '[\x00-\x1f\x7f\x1b]', ' ' -replace '\s', ' ').Trim()
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
        $out = $stdout.GetAwaiter().GetResult(); [void]$stderr.GetAwaiter().GetResult()
        return [pscustomobject]@{ Code = $(if ($expired) { 28 } else { $process.ExitCode }); Out = $out }
    } catch { return [pscustomobject]@{ Code = 127; Out = '' } }
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
        [pscustomobject]@{ Code = $code; ExitCode = $native.Code; Body = $body; Duration = $duration; FinalUrl = $finalUrl; RequestUrl = $Url; Location = $location }
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

function Test-OpenMiliSameIP([string]$Left, [string]$Right) {
    $a = $null; $b = $null
    return [Net.IPAddress]::TryParse($Left,[ref]$a) -and [Net.IPAddress]::TryParse($Right,[ref]$b) -and $a.Equals($b)
}

function Get-OpenMiliInfo([string]$IP, [int]$Family, [string]$Via = '', [int]$Seconds = 4) {
    if (-not (Test-OpenMiliPublicIP $IP $Family)) { return $null }
    $sources = @(
        @('ipwho.is',"https://ipwho.is/$IP"),
        @('ipinfo.io',"https://ipinfo.io/$IP/json"),
        @('ip.sb',"https://api.ip.sb/geoip/$IP"))
    foreach ($source in $sources) {
        $response = Invoke-OpenMiliCurl -Url $source[1] -Via $Via -Seconds $Seconds
        if ($response.ExitCode -ne 0 -or $response.Code -ne 200) { continue }
        try {
            $data = $response.Body | ConvertFrom-Json
            if (-not (Test-OpenMiliSameIP ([string]$data.ip) $IP)) { continue }
            $asn = ''; $org = ''; $country = ''; $city = ''
            switch ($source[0]) {
                'ipwho.is' {
                    if ($data.success -ne $true) { continue }
                    $asn = [string]$data.connection.asn; $org = [string]$data.connection.org
                    $country = [string]$data.country_code; $city = [string]$data.city
                }
                'ipinfo.io' {
                    if ([string]$data.org -match '^AS([0-9]+)\s+(.+)$') { $asn = $Matches[1]; $org = $Matches[2] }
                    $country = [string]$data.country; $city = [string]$data.city
                }
                'ip.sb' {
                    $asn = [string]$data.asn; $org = [string]$data.asn_organization
                    if (-not $org) { $org = [string]$data.organization }
                    $country = [string]$data.country_code; $city = [string]$data.city
                }
            }
            $asn = $asn -replace '^AS',''
            if ($asn -notmatch '^[0-9]+$' -or -not $org) { continue }
            return [pscustomobject]@{ ASN = "AS$asn"; Org = (ConvertTo-OpenMiliSafeText $org); Country = (ConvertTo-OpenMiliSafeText $country); City = (ConvertTo-OpenMiliSafeText $city); Source = $source[0] }
        } catch {}
    }
    return $null
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
    $loginForm = $body -notmatch $Marker -and $body -match '(?is)<form\b[^>]*action=["''][^"'']*/(?:login|signin)(?:[/?#"''])' -and $body -match '(?is)<input\b[^>]*type=["'']password["'']'
    if ($Response.ExitCode -ne 0) {
        $kind = 'failure'
        $label = switch ($Response.ExitCode) { 5 { '代理DNS失败' } 6 { 'DNS失败' } 7 { '连接失败' } 28 { '超时' } 35 { 'TLS失败' } 47 { '跳转过多' } 60 { '证书错误' } 63 { '响应过大' } default { "网络错误($($Response.ExitCode))" } }
    } elseif ($body -match '(?is)<title>\s*(just a moment|attention required|security check|verify you are human)|id=["''](?:cf-chl|challenge-running)|checking your browser|verify (that )?you are human|complete the security check|unusual traffic from your computer|our systems have detected unusual traffic|<form[^>]+(?:captcha|challenge)|id=["''](?:captcha|g-recaptcha|hcaptcha)|class=["''][^"'']*(?:g-recaptcha|h-captcha)|recaptcha/api2/anchor') { $label = '验证码' }
    elseif ($body -match '(?is)unsupported_country_region_territory|not available in (your|this) (country|region|location)|not supported in your country|service is not available in your|access to this service is not available in your|unavailable in your region') { $kind = 'failure'; $label = '地区限制' }
    elseif ($status -eq 429) { $kind = 'failure'; $label = '限流' }
    elseif ($status -in @(403,451)) { $kind = 'failure'; $label = '阻断' }
    elseif ($status -eq 401 -or $Response.FinalUrl -match '(?i)^https://(?:accounts\.google\.com/|[^/]+/(?:login|signin)(?:[/?#]|$))' -or $body -match '(?is)<title>[^<]*(sign in|log in|login)' -or $loginForm) { $label = '需登录' }
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
    [pscustomobject]@{ Kind = $kind; Label = $label; Code = $status; Duration = $Response.Duration }
}

function Get-OpenMiliRouteHint([string]$IP) {
    switch -Regex ($IP) {
        '^59\.43\.' { return '电信 CN2' }; '^202\.97\.' { return '电信 163' }
        '^(218\.105|210\.51)\.' { return '联通 9929' }; '^219\.158\.' { return '联通 4837' }
        '^223\.120\.(19|17|16)\.' { return '移动 CMIN2' }; '^223\.(118|119|120|121)\.' { return '移动 CMI' }
    }
    return ''
}

function Get-OpenMiliTcpHop([byte[]]$Packet, [int]$Length = 0) {
    if (-not $Length) { $Length = $Packet.Length }
    if ($Length -gt $Packet.Length -or $Length -lt 48 -or ($Packet[0] -shr 4) -ne 4) { return $null }
    $outer = ($Packet[0] -band 15) * 4
    $total = ([int]$Packet[2] -shl 8) + $Packet[3]
    if ($outer -lt 20 -or $outer + 28 -gt $Length -or $total -lt $outer + 28 -or $total -gt $Length -or $Packet[9] -ne 1 -or ($Packet[6] -band 31) -or $Packet[7]) { return $null }
    $type = $Packet[$outer]; $code = $Packet[$outer + 1]
    if (($type -ne 11 -or $code -ne 0) -and $type -ne 3) { return $null }
    $inner = $outer + 8
    if (($Packet[$inner] -shr 4) -ne 4 -or $Packet[$inner + 9] -ne 6 -or ($Packet[$inner + 6] -band 31) -or $Packet[$inner + 7]) { return $null }
    $tcp = $inner + (($Packet[$inner] -band 15) * 4)
    if ($tcp -lt $inner + 20 -or $tcp + 8 -gt $total) { return $null }
    [pscustomobject]@{
        IP = ([Net.IPAddress]::new([byte[]]$Packet[12..15])).ToString()
        Target = ([Net.IPAddress]::new([byte[]]$Packet[($inner + 16)..($inner + 19)])).ToString()
        LocalPort = ([int]$Packet[$tcp] -shl 8) + $Packet[$tcp + 1]
        Port = ([int]$Packet[$tcp + 2] -shl 8) + $Packet[$tcp + 3]
        Type = [int]$type; Code = [int]$code
    }
}

function Get-OpenMiliRouteAddress([string]$Target) {
    $route = [Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork,[Net.Sockets.SocketType]::Dgram,[Net.Sockets.ProtocolType]::Udp)
    try { $route.Connect([Net.IPAddress]::Parse($Target),443); return $route.LocalEndPoint.Address }
    finally { $route.Dispose() }
}

function New-OpenMiliTcpReceiver([string]$RouteTarget = '219.141.140.10') {
    # IPLEVEL receives host IP traffic without enabling promiscuous mode; Windows requires admin.
    $local = Get-OpenMiliRouteAddress $RouteTarget
    $socket = [Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork,[Net.Sockets.SocketType]::Raw,[Net.Sockets.ProtocolType]::IP)
    try {
        $socket.Bind([Net.IPEndPoint]::new($local,0))
        [void]$socket.IOControl([Net.Sockets.IOControlCode]::ReceiveAll,[BitConverter]::GetBytes([int]3),$null)
        $socket.ReceiveBufferSize = 262144
        $socket.Blocking = $false
        return $socket
    } catch { $socket.Dispose(); throw }
}

function New-OpenMiliTcpProbe([string]$IP, [ValidateRange(1,255)][int]$Ttl, [ValidateRange(1,65535)][int]$Port = 443, $UsedPorts = $null) {
    $address = [Net.IPAddress]::Parse($IP)
    if ($address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'TCP 回程仅支持 IPv4。' }
    for ($attempt = 0; $attempt -lt 32; $attempt++) {
        $socket = [Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork,[Net.Sockets.SocketType]::Stream,[Net.Sockets.ProtocolType]::Tcp)
        try {
            $socket.SetSocketOption([Net.Sockets.SocketOptionLevel]::IP,[Net.Sockets.SocketOptionName]::IpTimeToLive,$Ttl)
            $socket.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Any,0))
            $localPort = $socket.LocalEndPoint.Port
            # Do not reuse a source port: a late ICMP quote must not become a newer TTL's hop.
            if ($null -ne $UsedPorts -and -not $UsedPorts.Add($localPort)) { $socket.Dispose(); continue }
            $async = $socket.BeginConnect($address,$Port,$null,$null)
            return [pscustomobject]@{ Socket=$socket; Async=$async; IP=$IP; LocalPort=$localPort; Port=$Port; Answered=$false; Unreachable=$false }
        } catch { $socket.Dispose(); throw }
    }
    throw '无法分配独立 TCP 探测端口。'
}

function Complete-OpenMiliTcpProbe($Probe) {
    if (-not $Probe.Async.IsCompleted) { return '' }
    try { $Probe.Socket.EndConnect($Probe.Async); return 'connected' }
    catch {
        $errorCode = $_.Exception.GetBaseException()
        if ($errorCode -is [Net.Sockets.SocketException]) {
            if ($errorCode.SocketErrorCode -eq [Net.Sockets.SocketError]::ConnectionRefused) { return 'refused' }
            if ($errorCode.SocketErrorCode -in @([Net.Sockets.SocketError]::NetworkUnreachable,[Net.Sockets.SocketError]::HostUnreachable)) { return 'unreachable' }
        }
        return ''
    }
}

function Get-OpenMiliRouteCell($State) {
    $hints = @($State.Hints)
    if ($hints -contains '移动 CMIN2') { $hints = @($hints | Where-Object { $_ -ne '移动 CMI' }) }
    if ($hints -contains '电信 CN2') { $hints = @($hints | Where-Object { $_ -ne '电信 163' }) }
    if ($hints -contains '联通 9929') { $hints = @($hints | Where-Object { $_ -ne '联通 4837' }) }
    $label = if ($State.Reached) { '已到达' } elseif ($State.Seen) { '部分可见' } elseif ($State.Error) { $State.Error } elseif ($State.Refused) { '连接拒绝' } else { '无响应' }
    $tone = if ($State.Reached) { 'pass' } elseif ($State.Seen -or $State.Refused) { 'limited' } else { 'muted' }
    [pscustomobject]@{ Text=($label + $(if($hints.Count){' · '+($hints -join ' / ')})); Tone=$tone }
}

function Split-OpenMiliRouteCell([string]$Text, [int]$Width) {
    $line = ''; $size = 0
    foreach ($ch in $Text.ToCharArray()) {
        $amount = if ([int]$ch -ge 0x2e80 -and [int]$ch -le 0xffef) { 2 } else { 1 }
        if ($size + $amount -gt $Width) { $line; $line = ''; $size = 0 }
        $line += $ch; $size += $amount
    }
    if ($line) { $line }
}

function Write-OpenMiliText([string]$Text, [string]$Tone = '', [switch]$Inline) {
    $colors = @{ pass = 'Green'; limited = 'Yellow'; failure = 'Red'; skipped = 'DarkGray'; muted = 'DarkGray'; title = 'Cyan' }
    if ($script:OpenMiliColor -and $colors.ContainsKey($Tone)) { Write-Host $Text -ForegroundColor $colors[$Tone] -NoNewline:$Inline }
    else { Write-Host $Text -NoNewline:$Inline }
}

function Get-OpenMiliPad([string]$Text, [int]$Width) {
    $text = ConvertTo-OpenMiliSafeText $Text
    return $text + (' ' * [Math]::Max(0, $Width - (Get-OpenMiliWidth $text)))
}

function Get-OpenMiliWidth([string]$Text) {
    $length = 0
    foreach ($ch in (ConvertTo-OpenMiliSafeText $Text).ToCharArray()) { $length += $(if ([int]$ch -ge 0x2e80 -and [int]$ch -le 0xffef) { 2 } else { 1 }) }
    return $length
}

function Write-OpenMiliHeader {
    Write-Host ''
    Write-OpenMiliText ('-' * $script:OpenMiliWidth) 'muted'
    foreach ($text in @('OPENMILI IP TOOLKIT - IP 综合探测报告','GitHub: https://github.com/OpenMili/OpenMili-IP-Toolkit')) {
        foreach ($line in @(Split-OpenMiliRouteCell $text $script:OpenMiliWidth)) {
            $padding = [Math]::Max(0,[int][Math]::Floor(($script:OpenMiliWidth - (Get-OpenMiliWidth $line)) / 2))
            Write-OpenMiliText ((' ' * $padding) + $line) 'title'
        }
    }
    Write-OpenMiliText ('-' * $script:OpenMiliWidth) 'muted'
    $ram = '未知'; $disk = '未知'
    try { $ram = ([Math]::Round((Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).TotalVisibleMemorySize / 1024)).ToString() + ' MB RAM' } catch {}
    try { $disk = ([Math]::Round(([IO.DriveInfo]::new($env:SystemDrive + '\')).TotalSize / 1GB)).ToString() + ' GB 系统盘' } catch {}
    Write-OpenMiliWrapped ("硬件环境: Windows $env:PROCESSOR_ARCHITECTURE | " + [Environment]::ProcessorCount + " vCPU | $ram | $disk") '' 0
    Write-OpenMiliWrapped ('检测时间: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')) 'muted' 0
}

function Write-OpenMiliWrapped([string]$Text, [string]$Tone = '', [int]$Indent = 2) {
    $text = ConvertTo-OpenMiliSafeText $Text
    $line = ''; $size = 0; $available = [Math]::Max(12,$script:OpenMiliWidth - $Indent)
    foreach ($ch in $text.ToCharArray()) {
        $amount = $(if ([int]$ch -ge 0x2e80 -and [int]$ch -le 0xffef) { 2 } else { 1 })
        if ($size + $amount -gt $available) { Write-OpenMiliText ((' ' * $Indent) + $line) $Tone; $line = ''; $size = 0 }
        $line += $ch; $size += $amount
    }
    if ($line) { Write-OpenMiliText ((' ' * $Indent) + $line) $Tone }
}

function Write-OpenMiliField([string]$Name, [string]$Value, [string]$Tone = '') {
    Write-OpenMiliWrapped ((Get-OpenMiliPad $Name 12) + ': ' + $Value) $Tone
}

function Format-OpenMiliCell($Cell) {
    $code = if ($Cell.Code) { [string]$Cell.Code } else { '---' }
    return $Cell.Label + ' (' + $code + ')'
}

function Write-OpenMiliSection([string]$Title) {
    Write-Host ''
    Write-OpenMiliText ('-' * $script:OpenMiliWidth) 'muted'
    Write-OpenMiliWrapped $Title 'title' 0
    Write-OpenMiliText ('-' * $script:OpenMiliWidth) 'muted'
}

function Get-OpenMiliAttribute([string]$Owner) {
    if ($Owner -match '(?i)cloud|hosting|datacenter|data center|DMIT|RackNerd|Amazon|Google|Microsoft|DigitalOcean|OVH|Hetzner|Vultr|Linode|Akamai|Oracle') { return '机房倾向 (ASN 归属)' }
    return '未知 (仅凭 ASN 不能确认住宅)'
}

function Get-OpenMiliAssessment($Count) {
    $known = $Count.pass + $Count.limited + $Count.failure
    $score = if ($known -ge 8) { [int][Math]::Round(100 * ($Count.pass + 0.5 * $Count.limited) / $known,0,[MidpointRounding]::AwayFromZero) } else { $null }
    $advice = if ($known -lt 8) { '有效观测不足，建议检查网络后复测。' }
        elseif ($Count.failure -gt $Count.pass) { '受限或网络失败较多，建议更换出口后对比。' }
        elseif ($Count.limited) { '优先使用通过项；验证、登录等待核项需人工确认。' }
        else { '按通过项选择服务，账号与播放仍需实际验证。' }
    [pscustomobject]@{ Known=$known; Score=$score; Advice=$advice }
}

function Get-OpenMiliRouteNodes {
    # Original backtrace targets, shared by endpoint latency and both trace methods.
    foreach ($node in @(
        @('北京','电信','219.141.140.10'), @('北京','联通','202.106.195.68'), @('北京','移动','221.179.155.161'),
        @('上海','电信','202.96.209.133'), @('上海','联通','210.22.97.1'), @('上海','移动','211.136.112.200'),
        @('广州','电信','58.60.188.222'), @('广州','联通','210.21.196.6'), @('广州','移动','120.196.165.24'),
        @('成都','电信','61.139.2.69'), @('成都','联通','119.6.6.6'), @('成都','移动','211.137.96.205'))) {
        [pscustomobject]@{ City=$node[0]; Carrier=$node[1]; Name=($node[0]+$node[1]); IP=$node[2] }
    }
}

function Show-OpenMiliLatency([string]$Via, [string]$IPv4) {
    Write-OpenMiliSection '二、国内三网节点延迟 (ICMP)'
    if ($Via) { Write-OpenMiliWrapped '代理模式跳过 · ICMP 仅测本机直连' 'muted'; return }
    if (-not $IPv4) { Write-OpenMiliWrapped '无 IPv4 出口 · 原版节点仅支持 IPv4' 'muted'; return }
    $sessions = @()
    try {
        foreach ($node in Get-OpenMiliRouteNodes) {
            $sessions += [pscustomobject]@{ Node=$node; Ping=(New-Object Net.NetworkInformation.Ping); Times=(New-Object 'System.Collections.Generic.List[long]'); Error='' }
        }
        # One outstanding echo per Ping instance; all twelve targets run concurrently in each round.
        for ($round = 0; $round -lt 2; $round++) {
            $pending = @()
            foreach ($session in $sessions) {
                try { $pending += [pscustomobject]@{ Session=$session; Task=$session.Ping.SendPingAsync($session.Node.IP,1000) } }
                catch { $session.Error = 'ICMP 不可用' }
            }
            foreach ($probe in $pending) {
                $session = $probe.Session
                try {
                    $reply = $probe.Task.GetAwaiter().GetResult()
                    if ($reply.Status -eq [Net.NetworkInformation.IPStatus]::Success) {
                        if ($reply.Address -and $reply.Address.ToString() -eq $session.Node.IP) { $session.Times.Add([long]$reply.RoundtripTime) }
                        else { $session.Error = '响应不匹配' }
                    } elseif ($reply.Status -ne [Net.NetworkInformation.IPStatus]::TimedOut) { $session.Error = '目标不可达' }
                } catch { $session.Error = 'ICMP 不可用' }
            }
        }
        $results = @{}
        foreach ($session in $sessions) {
            $text = ''; $tone = 'muted'
            if ($session.Times.Count) {
                $average = ($session.Times | Measure-Object -Average).Average
                $text = $average.ToString('0.0',[Globalization.CultureInfo]::InvariantCulture)+' ms'
                if ($session.Times.Count -eq 1) { $text += ' (1/2)'; $tone = 'limited' } else { $tone = 'pass' }
            } else { $text = if($session.Error){$session.Error}else{'无响应'} }
            $results[$session.Node.Name] = [pscustomobject]@{ Text=$text; Tone=$tone }
        }
        if ($script:OpenMiliWidth -ge 70) {
            $cellWidth = [int][Math]::Floor(($script:OpenMiliWidth - 18)/3)
            Write-OpenMiliText ('  '+(Get-OpenMiliPad '地区' 10)+'│ '+(Get-OpenMiliPad '电信' $cellWidth)+'│ '+(Get-OpenMiliPad '联通' $cellWidth)+'│ 移动') 'muted'
            foreach ($city in @('北京','上海','广州','成都')) {
                Write-OpenMiliText ('  '+(Get-OpenMiliPad $city 10)+'│ ') '' -Inline
                foreach ($carrier in @('电信','联通','移动')) {
                    $cell = $results[$city+$carrier]
                    Write-OpenMiliText (Get-OpenMiliPad $cell.Text $cellWidth) $cell.Tone -Inline
                    if ($carrier -ne '移动') { Write-OpenMiliText '│ ' '' -Inline }
                }
                Write-Host ''
            }
        } else {
            foreach ($city in @('北京','上海','广州','成都')) {
                Write-OpenMiliText ('  '+$city)
                foreach ($carrier in @('电信','联通','移动')) { $cell = $results[$city+$carrier]; Write-OpenMiliWrapped ($carrier+'  '+$cell.Text) $cell.Tone 4 }
            }
        }
    } finally { foreach ($session in $sessions) { $session.Ping.Dispose() } }
}

function Show-OpenMiliRoutes([string]$Via, [string]$IPv4) {
    Write-OpenMiliSection '四、三网回程 (ICMP / TCP :443)'
    if ($Via) { Write-OpenMiliWrapped '代理模式跳过 · 请在目标 VPS 本机直连运行' 'muted'; return }
    if (-not $IPv4) { Write-OpenMiliWrapped '无 IPv4 出口 · 原版节点仅支持 IPv4' 'muted'; return }
    # Nodes/prefix hints: zhanghanyun/backtrace (MIT); see THIRD_PARTY_NOTICES.md.
    $nodes = @(Get-OpenMiliRouteNodes)
    Write-OpenMiliWrapped 'IPv4 · 12 节点 · ICMP / TCP :443' 'muted'
    $receivers = @{}; $tcpError = ''; $usedPorts = New-Object 'System.Collections.Generic.HashSet[int]'
    try { $firstReceiver = New-OpenMiliTcpReceiver; $receivers[$firstReceiver.LocalEndPoint.Address.ToString()] = $firstReceiver }
    catch {
        $nativeError = $_.Exception.GetBaseException()
        $tcpError = if ($nativeError -is [Net.Sockets.SocketException] -and $nativeError.SocketErrorCode -eq [Net.Sockets.SocketError]::AccessDenied) { '需管理员' } else { 'TCP 不可用' }
        Write-OpenMiliWrapped $(if($tcpError -eq '需管理员'){'TCP 逐跳需要管理员权限；ICMP 继续。'}else{'TCP 逐跳接收不可用；ICMP 继续。'}) 'muted'
    }
    $wide = $script:OpenMiliWidth -ge 70
    if ($wide) { Write-OpenMiliText ('  '+(Get-OpenMiliPad '节点' 12)+'│ '+(Get-OpenMiliPad 'ICMP' 26)+'│ TCP :443') 'muted' }
    $packet = New-Object byte[] 4096
    try {
        # Both protocols share each 400ms round; source ports remain unique for the full run.
        for ($batch = 0; $batch -lt $nodes.Count; $batch += 3) {
            $sessions = @(); $tcpPending = @()
            for ($n = $batch; $n -lt [Math]::Min($batch + 3,$nodes.Count); $n++) {
                $states = @{}
                foreach ($method in @('Icmp','Tcp')) { $states[$method] = [pscustomobject]@{ Seen=0; Reached=$false; Error=''; Refused=$false; Hints=(New-Object 'System.Collections.Generic.List[string]') } }
                $states.Tcp.Error = $tcpError; $nodeReceiver = $null
                if (-not $tcpError) {
                    try {
                        $address = (Get-OpenMiliRouteAddress $nodes[$n].IP).ToString()
                        if (-not $receivers.ContainsKey($address)) {
                            try { $receivers[$address] = New-OpenMiliTcpReceiver $nodes[$n].IP }
                            catch { $receivers[$address] = $null }
                        }
                        $nodeReceiver = $receivers[$address]
                        if (-not $nodeReceiver) { $states.Tcp.Error = 'TCP 不可用' }
                    } catch { $states.Tcp.Error = '网络不可达' }
                }
                $sessions += [pscustomobject]@{ Name=$nodes[$n].Name; IP=$nodes[$n].IP; Ping=(New-Object Net.NetworkInformation.Ping); Icmp=$states.Icmp; Tcp=$states.Tcp; Receiver=$nodeReceiver }
            }
            try {
                for ($ttl = 1; $ttl -le 24; $ttl++) {
                    $icmpPending = @(); $tcpPending = @(); $clock = [Diagnostics.Stopwatch]::StartNew()
                    foreach ($session in $sessions) {
                        if (-not $session.Icmp.Reached -and -not $session.Icmp.Error) {
                            try {
                                $options = New-Object Net.NetworkInformation.PingOptions($ttl,$false)
                                $icmpPending += [pscustomobject]@{ Session=$session; Task=$session.Ping.SendPingAsync($session.IP,400,([Text.Encoding]::ASCII.GetBytes('OpenMili')),$options) }
                            } catch { $session.Icmp.Error = 'ICMP 不可用' }
                        }
                        if ($session.Receiver -and -not $session.Tcp.Reached -and -not $session.Tcp.Refused -and -not $session.Tcp.Error) {
                            try { $tcpPending += [pscustomobject]@{ Session=$session; Probe=(New-OpenMiliTcpProbe $session.IP $ttl 443 $usedPorts) } }
                            catch { $session.Tcp.Error = 'TCP 不可用' }
                        }
                    }
                    if (-not $icmpPending.Count -and -not $tcpPending.Count) { break }
                    try {
                        foreach ($pending in $icmpPending) {
                            $session = $pending.Session
                            try {
                                $reply = $pending.Task.GetAwaiter().GetResult()
                                if ($reply.Address -and $reply.Status -in @([Net.NetworkInformation.IPStatus]::Success,[Net.NetworkInformation.IPStatus]::TtlExpired)) {
                                    $session.Icmp.Seen++
                                    $hint = Get-OpenMiliRouteHint $reply.Address.ToString()
                                    if ($hint -and -not $session.Icmp.Hints.Contains($hint)) { $session.Icmp.Hints.Add($hint) }
                                }
                                if ($reply.Status -eq [Net.NetworkInformation.IPStatus]::Success -and $reply.Address.ToString() -eq $session.IP) { $session.Icmp.Reached = $true }
                            } catch { $session.Icmp.Error = 'ICMP 不可用' }
                        }
                        if ($tcpPending.Count) {
                            do {
                                # Only quoted TCP probes with this target and both ports belong to this round.
                                $listening = $false
                                foreach ($receiver in @($receivers.Values)) {
                                    if (-not $receiver) { continue }
                                    $listening = $true
                                    try {
                                        $readCount = 0
                                        while ($receiver.Poll(0,[Net.Sockets.SelectMode]::SelectRead) -and $readCount -lt 256) {
                                            $length = $receiver.Receive($packet); $readCount++
                                            $hop = Get-OpenMiliTcpHop $packet $length
                                            if (-not $hop) { continue }
                                            foreach ($pending in $tcpPending) {
                                                $probe = $pending.Probe; $state = $pending.Session.Tcp
                                                if ($probe.Answered -or $hop.Target -ne $probe.IP -or $hop.LocalPort -ne $probe.LocalPort -or $hop.Port -ne $probe.Port) { continue }
                                                $probe.Answered = $true; $probe.Unreachable = $hop.Type -eq 3
                                                $state.Seen++
                                                $hint = Get-OpenMiliRouteHint $hop.IP
                                                if ($hint -and -not $state.Hints.Contains($hint)) { $state.Hints.Add($hint) }
                                            }
                                        }
                                    } catch [Net.Sockets.SocketException] {
                                        $receivers[$receiver.LocalEndPoint.Address.ToString()] = $null
                                        foreach ($session in $sessions) { if ($session.Receiver -eq $receiver) { $session.Tcp.Error = 'TCP 不可用'; $session.Receiver = $null } }
                                        $receiver.Dispose()
                                    }
                                }
                                if (-not $listening -or $clock.ElapsedMilliseconds -ge 400) { break }
                                [Threading.Thread]::Sleep(5)
                            } while ($true)
                            foreach ($pending in $tcpPending) {
                                $result = Complete-OpenMiliTcpProbe $pending.Probe
                                if ($result -eq 'connected') { $pending.Session.Tcp.Reached = $true; $pending.Session.Tcp.Seen++ }
                                elseif ($result -eq 'refused' -and -not $pending.Probe.Unreachable) { $pending.Session.Tcp.Refused = $true }
                                elseif ($result -eq 'unreachable' -and -not $pending.Probe.Answered) { $pending.Session.Tcp.Error = '网络不可达' }
                            }
                        }
                    } finally { foreach ($pending in $tcpPending) { $pending.Probe.Socket.Dispose() }; $tcpPending = @() }
                }
                foreach ($session in $sessions) {
                    $icmp = Get-OpenMiliRouteCell $session.Icmp; $tcp = Get-OpenMiliRouteCell $session.Tcp
                    if ($wide) {
                        $left = @(Split-OpenMiliRouteCell $icmp.Text 26); $right = @(Split-OpenMiliRouteCell $tcp.Text 26)
                        for ($row = 0; $row -lt [Math]::Max($left.Count,$right.Count); $row++) {
                            Write-OpenMiliText ('  '+(Get-OpenMiliPad $(if($row -eq 0){$session.Name}else{''}) 12)+'│ ') '' -Inline
                            Write-OpenMiliText (Get-OpenMiliPad $(if($row -lt $left.Count){$left[$row]}else{''}) 26) $icmp.Tone -Inline
                            Write-OpenMiliText '│ ' '' -Inline
                            Write-OpenMiliText $(if($row -lt $right.Count){$right[$row]}else{''}) $tcp.Tone
                        }
                    } else {
                        Write-OpenMiliText ('  '+$session.Name)
                        Write-OpenMiliWrapped ('ICMP  '+$icmp.Text) $icmp.Tone 4
                        Write-OpenMiliWrapped ('TCP   '+$tcp.Text) $tcp.Tone 4
                    }
                }
            } finally {
                foreach ($pending in $tcpPending) { $pending.Probe.Socket.Dispose() }
                foreach ($session in $sessions) { $session.Ping.Dispose() }
            }
        }
    } finally { foreach ($receiver in $receivers.Values) { if ($receiver) { $receiver.Dispose() } } }
}

function Start-OpenMiliCheck {
    param([string]$Proxy = '', [switch]$Direct, [switch]$NoRoutes, [int]$Timeout = 8, [switch]$NoColor, [switch]$NoPause, [switch]$Help)
    $ErrorActionPreference = 'Stop'
    $script:OpenMiliColor = -not $NoColor -and -not (Test-Path Env:NO_COLOR) -and -not [Console]::IsOutputRedirected
    $script:OpenMiliWidth = 96
    try { if ([Console]::WindowWidth -ge 32) { $script:OpenMiliWidth = [Math]::Min(96,[Console]::WindowWidth) } } catch {}
    if ($Help) { Write-Host 'OpenMili-IP-Toolkit · Windows 原生脚本'; Write-Host '.\openmili.ps1 [-Direct | -Proxy 7890] [-NoRoutes] [-Timeout 8] [-NoColor] [-NoPause]'; return }
    $interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
    try {
        if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw '需要 curl.exe；Windows 10/11 通常自带。' }
        if ($Direct -and $Proxy) { throw '-Direct 与 -Proxy 不能同时指定。' }
        $started = [Diagnostics.Stopwatch]::StartNew()
        Write-OpenMiliHeader
        Write-OpenMiliSection '一、IP 基础网络信息'
        $direct4 = Get-OpenMiliExit 4 '' 4; $direct6 = Get-OpenMiliExit 6 '' 4
        Write-OpenMiliField '公网 IPv4' $(if ($direct4) { $direct4 } else { '未取得' }) $(if ($direct4) { 'pass' } else { 'muted' })
        Write-OpenMiliField '公网 IPv6' $(if ($direct6) { $direct6 } else { '未启用 / 不可达' }) $(if ($direct6) { 'pass' } else { 'muted' })
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
        if (-not $exit4 -and -not $exit6) { throw '未取得公网出口，请检查网络或代理。' }
        $families = @()
        if ($exit4) { $families += 4 }; if ($exit6) { $families += 6 }
        foreach ($family in $families) {
            $ip = if ($family -eq 4) { $exit4 } else { $exit6 }
            if ($Proxy) { Write-OpenMiliField "代理 IPv$family" $ip 'pass' }
            $info = Get-OpenMiliInfo $ip $family $Proxy 4
            $suffix = if ($families.Count -gt 1) { " v$family" } else { '' }
            if ($info) {
                $place = (@($info.Country,$info.City) | Where-Object { $_ }) -join ' - '
                Write-OpenMiliField ('所属地区'+$suffix) $(if($place){$place}else{'未知'})
                Write-OpenMiliField ('ASN'+$suffix) ($info.ASN + ' (' + $info.Org + ') [' + $info.Source + ']')
                Write-OpenMiliField ('IP 属性'+$suffix) (Get-OpenMiliAttribute $info.Org) 'muted'
            } else { Write-OpenMiliField ("IPv$family 归属") '未知 (查询源暂不可用)' 'muted' }
        }
        if ($NoRoutes) { Write-OpenMiliSection '二、国内三网节点延迟 (ICMP)'; Write-OpenMiliText '  已跳过' 'muted' }
        else { Show-OpenMiliLatency $Proxy $exit4 }
        $sites = @(
            @('ChatGPT','https://chatgpt.com/','(?is)<title>[^<]*chatgpt'), @('Claude','https://claude.ai/','(?is)<title>[^<]*claude'),
            @('Gemini','https://gemini.google.com/','(?is)<title>[^<]*gemini'), @('Grok','https://grok.com/','(?is)<title>[^<]*grok'),
            @('Perplexity','https://www.perplexity.ai/','(?is)<title>[^<]*perplexity'), @('Google','https://www.google.com/search?q=openmili','(?is)<title>[^<]*google|id=["''](?:search|rso)["'']'),
            @('YouTube','https://www.youtube.com/','(?is)<title>[^<]*youtube|ytInitialData'), @('Netflix','https://www.netflix.com/','(?is)<title>[^<]*netflix'),
            @('Disney+','https://www.disneyplus.com/','(?is)<title>[^<]*disney'), @('Spotify','https://open.spotify.com/','(?is)<title>[^<]*spotify'),
            @('TikTok','https://www.tiktok.com/','(?is)<title>[^<]*tiktok|__UNIVERSAL_DATA_FOR_REHYDRATION__'), @('GitHub','https://github.com/','(?is)<title>[^<]*github'),
            @('X','https://x.com/','(?is)<title>[^<]*( / x|x /|twitter)|<title>\s*X\s*</title>'), @('Reddit','https://www.reddit.com/','(?is)<title>[^<]*reddit'),
            @('Hugging Face','https://huggingface.co/','(?is)<title>[^<]*(hugging face|huggingface)'), @('Scholar','https://scholar.google.com/','(?is)<title>[^<]*google scholar|gs_res_ccl'))
        Write-OpenMiliSection '三、网站风控检测 (浏览器请求头)'
        $groups = @(
            [pscustomobject]@{ Name='人工智能 AI'; Index=@(0,1,2,3,4) },
            [pscustomobject]@{ Name='海外流媒体'; Index=@(7,8,6,9,10) },
            [pscustomobject]@{ Name='常用社区/平台'; Index=@(11,12,13,15,14,5) })
        $wide = $script:OpenMiliWidth -ge 90
        $columnWidth = [int][Math]::Floor(($script:OpenMiliWidth - 6) / 3)
        $counts = @{ '4' = @{ pass=0; limited=0; failure=0; skipped=0 }; '6' = @{ pass=0; limited=0; failure=0; skipped=0 } }
        foreach ($family in $families) {
            Write-OpenMiliWrapped "[IPv$family]" 'title'
            if ($wide) {
                Write-OpenMiliText ('  ' + ((@($groups | ForEach-Object { Get-OpenMiliPad ('['+$_.Name+']') $columnWidth })) -join '  ')) 'muted'
                Write-OpenMiliText ('  ' + ((@($groups | ForEach-Object { '-' * $columnWidth })) -join '  ')) 'muted'
                for ($row=0; $row -lt 6; $row++) {
                    $cells=@()
                    foreach ($group in $groups) {
                        if ($row -ge $group.Index.Count) { $cells += [pscustomobject]@{ Lines=@(''); Tone='' }; continue }
                        $site=$sites[$group.Index[$row]]
                        $cell=Invoke-OpenMiliWebsite $site[1] $site[2] $family $Proxy $Timeout
                        $counts[[string]$family][$cell.Kind]++
                        $text=(Get-OpenMiliPad ($site[0] -replace '^Hugging Face$','HuggingFace') 12)+' : '+(Format-OpenMiliCell $cell)
                        $cells += [pscustomobject]@{ Lines=@(Split-OpenMiliRouteCell $text $columnWidth); Tone=$cell.Kind }
                    }
                    $height=($cells | ForEach-Object {$_.Lines.Count} | Measure-Object -Maximum).Maximum
                    for($line=0;$line -lt $height;$line++) {
                        Write-OpenMiliText '  ' '' -Inline
                        for($col=0;$col -lt 3;$col++) {
                            if($col){Write-OpenMiliText '  ' '' -Inline}
                            $text=if($line -lt $cells[$col].Lines.Count){$cells[$col].Lines[$line]}else{''}
                            Write-OpenMiliText (Get-OpenMiliPad $text $columnWidth) $cells[$col].Tone -Inline
                        }
                        Write-Host ''
                    }
                }
            } else {
                foreach ($group in $groups) {
                    Write-OpenMiliWrapped ('['+$group.Name+']') 'muted'
                    foreach ($index in $group.Index) {
                        $site=$sites[$index]
                        $cell=Invoke-OpenMiliWebsite $site[1] $site[2] $family $Proxy $Timeout
                        $counts[[string]$family][$cell.Kind]++
                        Write-OpenMiliWrapped ((Get-OpenMiliPad $site[0] 12)+' : '+(Format-OpenMiliCell $cell)) $cell.Kind
                    }
                }
            }
        }
        if (-not $NoRoutes) { Show-OpenMiliRoutes $Proxy $exit4 }
        else { Write-OpenMiliSection '四、三网回程 (ICMP / TCP :443)'; Write-OpenMiliText '  已跳过' 'muted' }
        $identity = @{}
        foreach ($family in $families) {
            $before = if ($family -eq 4) { $exit4 } else { $exit6 }
            $after = Get-OpenMiliExit $family $Proxy 4
            if ($after -and (Test-OpenMiliSameIP $after $before)) { $identity[[string]$family] = '出口一致' }
            elseif ($after) { $identity[[string]$family] = '出口变化' }
            else { $identity[[string]$family] = '出口复核失败' }
        }
        Write-OpenMiliSection '五、综合评估与使用建议'
        foreach ($family in $families) {
            $count = $counts[[string]$family]
            $assessment=Get-OpenMiliAssessment $count
            $score=if($null -ne $assessment.Score){[string]$assessment.Score+'/100'}else{'证据不足'}
            Write-OpenMiliField "IPv$family 访问分" ($score+" (明确观测 $($assessment.Known)/16)") $(if($null -ne $assessment.Score -and $assessment.Score -ge 80){'pass'}else{'limited'})
            Write-OpenMiliWrapped ("通过 $($count.pass) · 待核 $($count.limited) · 失败 $($count.failure) · 未知 $($count.skipped)；"+$identity[[string]$family]) 'muted' 4
            Write-OpenMiliField '使用建议' $assessment.Advice
        }
        Write-OpenMiliField '耗时' ($started.Elapsed.TotalSeconds.ToString('0.0',[Globalization.CultureInfo]::InvariantCulture) + 's') 'muted'
        Write-OpenMiliWrapped '访问参考分：通过=1，待核=0.5，失败=0；未知不计。' 'muted'
        Write-OpenMiliWrapped '页面访问不代表账号 / 播放解锁，也不能证明是否被列入风险库。' 'muted'
        Write-OpenMiliText ('-' * $script:OpenMiliWidth) 'muted'
        Write-Host ''
    } catch { Write-OpenMiliText ('  ' + (ConvertTo-OpenMiliSafeText $_.Exception.Message)) 'failure' }
    finally { if ($interactive -and -not $NoPause) { [void](Read-Host '按回车键结束') } }
}
# Dot-source to import functions for local validation; iex and -File run normally.
if ($MyInvocation.InvocationName -ne '.' -and $env:OPENMILI_TEST_ONLY -ne '1') {
    Start-OpenMiliCheck -Proxy $Proxy -Direct:$Direct -NoRoutes:$NoRoutes -Timeout $Timeout -NoColor:$NoColor -NoPause:$NoPause -Help:$Help
}
