#!/bin/sh
# OpenMili-IP-Toolkit: native curl checks; no Node, browser or package manager.
# Route targets/prefix hints: zhanghanyun/backtrace, MIT, Copyright 2022 zhy.
set -u
OM_PROXY='' OM_DIRECT=0 OM_ROUTES=1 OM_TIMEOUT=8 OM_COLOR=1
while [ "$#" -gt 0 ]; do
    case "$1" in
        -d|--direct) OM_DIRECT=1 ;;
        -p|--proxy) [ "$#" -ge 2 ] || exit 2; OM_PROXY=$2; OM_DIRECT=1; shift ;;
        --no-routes) OM_ROUTES=0 ;;
        --timeout) [ "$#" -ge 2 ] || exit 2; OM_TIMEOUT=$2; shift ;;
        --no-color|--plain) OM_COLOR=0 ;;
        -h|--help) printf '%s\n' '用法: sh openmili.sh [--direct | --proxy 7890] [--no-routes] [--timeout 8] [--no-color]'; exit 0 ;;
        *) printf '未知参数: %s\n' "$1" >&2; exit 2 ;;
    esac
    shift
done
case "$OM_TIMEOUT" in ''|*[!0-9]*) printf '%s\n' '超时必须为 1–60 秒' >&2; exit 2;; esac
[ "$OM_TIMEOUT" -ge 1 ] && [ "$OM_TIMEOUT" -le 60 ] || exit 2
command -v curl >/dev/null 2>&1 || { printf '%s\n' '缺少 curl。Debian/Ubuntu: apt install curl；Alpine: apk add curl' >&2; exit 2; }
OM_TEMP=$(mktemp -d "${TMPDIR:-/tmp}/openmili.XXXXXX") || exit 2
om_cleanup() { for OM_CHILD in $(jobs -p); do kill "$OM_CHILD" 2>/dev/null || :; done; rm -rf "$OM_TEMP"; }
trap 'om_cleanup' 0
trap 'printf "\n已中止。\n"; exit 130' INT TERM
OM_START=$(date +%s)
OM_ESC=$(printf '\033')
OM_RESET='' OM_GREEN='' OM_YELLOW='' OM_RED='' OM_GRAY='' OM_CYAN=''
if [ "$OM_COLOR" -eq 1 ] && [ -t 1 ] && [ "${NO_COLOR+x}" != x ] && [ "${TERM:-}" != dumb ]; then
    OM_RESET="${OM_ESC}[0m" OM_GREEN="${OM_ESC}[32m" OM_YELLOW="${OM_ESC}[33m"
    OM_RED="${OM_ESC}[31m" OM_GRAY="${OM_ESC}[90m" OM_CYAN="${OM_ESC}[36m"
fi
om_section() { printf '\n%b── %s ─────────────────────────────────────%b\n' "$OM_CYAN" "$1" "$OM_RESET"; }
om_clean() { tr '\000-\010\013\014\016-\037\177' ' ' | tr '\r\n' '  '; }
om_json() { sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"\\]*\)".*/\1/p' "$2" | head -n 1 | om_clean; }
om_public() {
    case "$1" in
        4) printf '%s\n' "$2" | awk -F. 'NF!=4{exit 1} {for(i=1;i<=4;i++)if($i!~/^[0-9]+$/||$i>255)exit 1; if($1==0||$1==10||$1==127||$1>=224||($1==169&&$2==254)||($1==172&&$2>=16&&$2<=31)||($1==192&&($2==168||($2==0&&($3==0||$3==2))))||($1==100&&$2>=64&&$2<=127)||($1==198&&($2==18||$2==19||($2==51&&$3==100)))||($1==203&&$2==0&&$3==113))exit 1}' ;;
        6) case "$2" in [23][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]:*) case "$2" in *[!0-9a-fA-F:]*|2001:[dD][bB]8:*) return 1;; esac;; *) return 1;; esac
           printf '%s\n' "$2" | awk '{s=$0;if(index(s,":::"))exit 1;c=gsub(/::/,"@",s);if(c>1)exit 1;n=split($0,a,":");if(tolower(a[1])=="2001"&&tolower(a[2])~/^0?db8$/)exit 1;k=0;for(i=1;i<=n;i++)if(a[i]!=""){if(length(a[i])>4||a[i]!~/^[0-9a-fA-F]+$/)exit 1;k++}if(c==1){if(k>=8||k<1)exit 1}else if(k!=8||n!=8)exit 1}' ;;
    esac
}
# Bodies remain in a private temporary directory; remote content is never executed.
om_fetch() {
    OM_FAMILY=$1 OM_URL=$2 OM_PIN=${3:-} OM_LIMIT=${4:-$OM_TIMEOUT} OM_ACCEPT=${5:-text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8}
    set -- -q -sS --connect-timeout 3 --max-time "$OM_LIMIT" --proto '=https' --proto-redir '=https' --compressed --max-filesize 2097152
    if [ -n "$OM_PROXY" ]; then
        set -- "$@" --noproxy '' --proxy "$OM_PROXY"
        [ -z "$OM_PIN" ] || set -- "$@" --connect-to "$OM_PIN"
    else
        set -- "$@" --noproxy '*' --proxy '' "-$OM_FAMILY" -L --max-redirs 4
    fi
    set -- "$@" -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' \
        -H "Accept: $OM_ACCEPT" -H 'Accept-Language: en-US,en;q=0.9' \
        -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Site: none' -H 'Upgrade-Insecure-Requests: 1' \
        -D "$OM_TEMP/headers" -o "$OM_TEMP/body" -w '%{http_code}\n%{time_total}\n%{url_effective}\n' "$OM_URL"
    : > "$OM_TEMP/body"; : > "$OM_TEMP/headers"
    curl "$@" > "$OM_TEMP/meta" 2> "$OM_TEMP/error"; OM_RC=$?
    OM_CODE=$(sed -n '1p' "$OM_TEMP/meta"); OM_TIME=$(sed -n '2p' "$OM_TEMP/meta")
    OM_FINAL=$(sed -n '3p' "$OM_TEMP/meta")
    OM_CODE=${OM_CODE:-000}; OM_TIME=$(awk -v t="${OM_TIME:-0}" 'BEGIN{printf "%.1f",t}')
}
om_exit() {
    OM_EF=$1
    if [ "$OM_EF" = 4 ]; then OM_ENDPOINTS='https://api4.ipify.org https://ipv4.icanhazip.com https://api-ipv4.ip.sb/ip'
    else OM_ENDPOINTS='https://api6.ipify.org https://ipv6.icanhazip.com https://api-ipv6.ip.sb/ip'; fi
    for OM_ENDPOINT in $OM_ENDPOINTS; do
        om_fetch "$OM_EF" "$OM_ENDPOINT" '' 4
        OM_CANDIDATE=$(tr -d '\r\n ' < "$OM_TEMP/body")
        if [ "$OM_RC" -eq 0 ] && [ "$OM_CODE" = 200 ] && om_public "$OM_EF" "$OM_CANDIDATE"; then printf '%s' "$OM_CANDIDATE"; return; fi
    done
}
om_normalize_proxy() {
    case "$OM_PROXY" in
        '' ) return;;
        *[!0-9]* ) case "$OM_PROXY" in http://*|https://*|socks5://*|socks5h://*) ;; *) printf '%s\n' '代理需为端口或 http://、socks5h:// 地址' >&2; return 1;; esac ;;
        *) [ "${#OM_PROXY}" -le 5 ] && [ "$OM_PROXY" -ge 1 ] && [ "$OM_PROXY" -le 65535 ] || return 1; OM_PROXY="http://127.0.0.1:$OM_PROXY" ;;
    esac
    case "$OM_PROXY" in *' '*|*'?'*|*'#'*) return 1;; esac
}
om_cell() {
    case "$1" in
        pass) OM_LABEL='通过    '; OM_TONE=$OM_GREEN;;
        captcha) OM_LABEL='验证    '; OM_TONE=$OM_YELLOW;;
        js) OM_LABEL='需JS    '; OM_TONE=$OM_YELLOW;;
        login) OM_LABEL='登录    '; OM_TONE=$OM_YELLOW;;
        partial) OM_LABEL='可达?   '; OM_TONE=$OM_YELLOW;;
        empty) OM_LABEL='空白    '; OM_TONE=$OM_YELLOW;;
        redirect) OM_LABEL='跳转待核'; OM_TONE=$OM_YELLOW;;
        region) OM_LABEL='地区限制'; OM_TONE=$OM_RED;;
        block) OM_LABEL='阻断    '; OM_TONE=$OM_RED;;
        rate) OM_LABEL='限流    '; OM_TONE=$OM_RED;;
        dns) OM_LABEL='DNS失败 '; OM_TONE=$OM_RED;;
        tls) OM_LABEL='TLS失败 '; OM_TONE=$OM_RED;;
        timeout) OM_LABEL='超时    '; OM_TONE=$OM_RED;;
        fail) OM_LABEL='失败    '; OM_TONE=$OM_RED;;
        noip) OM_LABEL='未启用  '; OM_TONE=$OM_GRAY;;
        noaddr) OM_LABEL='无DNS   '; OM_TONE=$OM_GRAY;;
        source) OM_LABEL='解析源失败'; OM_TONE=$OM_GRAY;;
        *) OM_LABEL='待核    '; OM_TONE=$OM_GRAY;;
    esac
    [ "$1" = source ] || OM_LABEL="$OM_LABEL  "
    if [ "$3" = - ]; then OM_SECONDS='    —'; else OM_SECONDS=$(printf '%4ss' "$3"); fi
    printf '%b%s%b %3s %s' "$OM_TONE" "$OM_LABEL" "$OM_RESET" "$2" "$OM_SECONDS"
}
om_probe() {
    OM_PF=$1 OM_PNAME=$2 OM_PURL=$3 OM_MARKER=$4 OM_AVAILABLE=$5
    if [ -z "$OM_AVAILABLE" ]; then om_cell noip --- -; return; fi
    OM_PPIN=''
    if [ -n "$OM_PROXY" ]; then
        OM_HOST=${OM_PURL#https://}; OM_HOST=${OM_HOST%%/*}; OM_TYPE=1; [ "$OM_PF" = 4 ] || OM_TYPE=28
        OM_DOH_OK=0
        for OM_DOH_BASE in 'https://dns.google/resolve' 'https://cloudflare-dns.com/dns-query'; do
            om_fetch 4 "$OM_DOH_BASE?name=$OM_HOST&type=$OM_TYPE" '' 5 'application/dns-json'
            if [ "$OM_RC" -eq 0 ] && [ "$OM_CODE" = 200 ] && grep -Eq '"Status"[[:space:]]*:[[:space:]]*[0-9]+([[:space:]]*[,}])' "$OM_TEMP/body"; then OM_DOH_OK=1; break; fi
        done
        if [ "$OM_DOH_OK" -ne 1 ]; then om_cell source --- -; printf '%s|unknown\n' "$OM_PF" >> "$OM_TEMP/results"; return; fi
        if ! grep -Eq '"Status"[[:space:]]*:[[:space:]]*0([[:space:]]*[,}])' "$OM_TEMP/body"; then om_cell dns --- -; printf '%s|fail\n' "$OM_PF" >> "$OM_TEMP/results"; return; fi
        OM_ADDR=$(tr '{' '\n' < "$OM_TEMP/body" | awk -v t="$OM_TYPE" '$0 ~ "\"type\"[[:space:]]*:[[:space:]]*"t"[[:space:]]*," {s=$0;sub(/.*"data"[[:space:]]*:[[:space:]]*"/,"",s);sub(/".*/,"",s);print s;exit}')
        if ! om_public "$OM_PF" "$OM_ADDR"; then om_cell noaddr --- -; printf '%s|unknown\n' "$OM_PF" >> "$OM_TEMP/results"; return; fi
        [ "$OM_PF" = 4 ] || OM_ADDR="[$OM_ADDR]"
        OM_PPIN="$OM_HOST:443:$OM_ADDR:443"
    fi
    om_fetch "$OM_PF" "$OM_PURL" "$OM_PPIN"
    # Follow same-host HTTPS redirects with the same pinned family; other hosts remain pending.
    OM_JUMPS=0
    if [ -n "$OM_PROXY" ]; then
        while [ "$OM_RC" -eq 0 ] && [ "$OM_JUMPS" -lt 4 ]; do
            case "$OM_CODE" in 301|302|303|307|308) ;; *) break;; esac
            OM_LOCATION=$(awk 'tolower($0)~/^location:/ {s=$0;sub(/^[^:]*:[[:space:]]*/,"",s);sub(/[\r[:space:]]*$/,"",s);v=s}END{print v}' "$OM_TEMP/headers")
            case "$OM_LOCATION" in
                "https://$OM_HOST"|"https://$OM_HOST/"*) OM_REDIRECT_URL=$OM_LOCATION ;;
                //*) break ;;
                /*) OM_REDIRECT_URL="https://$OM_HOST$OM_LOCATION" ;;
                *) break ;;
            esac
            OM_JUMPS=$((OM_JUMPS+1))
            om_fetch "$OM_PF" "$OM_REDIRECT_URL" "$OM_PPIN"
        done
    fi
    OM_KIND=partial
    if [ "$OM_RC" -ne 0 ]; then
        case "$OM_RC" in 5|6) OM_KIND=dns;; 28) OM_KIND=timeout;; 35|51|58|60|77|80|83|90|91) OM_KIND=tls;; 63) OM_KIND=partial;; *) OM_KIND=fail;; esac
    elif grep -Eiq 'unsupported_country|country[^<]{0,45}(not supported|not available)|not available in your (country|region)|not supported in your (country|region)|unavailable in your (country|region)|geo.?blocked|region_not_supported' "$OM_TEMP/body"; then OM_KIND=region
    elif grep -Eiq 'cf-chl-|verify you are human|verify that you are human|checking your browser|unusual traffic|<form[^>]*action="[^"]*/sorry/|<(div|iframe)[^>]*(g-recaptcha|h-captcha|captcha-container|data-sitekey=)|<title>[^<]*(just a moment|attention required)' "$OM_TEMP/body"; then OM_KIND=captcha
    elif [ "$OM_CODE" = 403 ] || [ "$OM_CODE" = 451 ]; then OM_KIND=block
    elif [ "$OM_CODE" = 429 ]; then OM_KIND=rate
    elif [ "$OM_CODE" = 401 ]; then OM_KIND=login
    elif [ "$OM_CODE" -ge 300 ] && [ "$OM_CODE" -lt 400 ]; then OM_KIND=redirect
    elif [ "$OM_CODE" -ge 400 ] || [ "$OM_CODE" -lt 200 ]; then OM_KIND=fail
    elif [ ! -s "$OM_TEMP/body" ]; then OM_KIND=empty
    elif [ "${OM_FINAL#https://}" = "$OM_FINAL" ]; then OM_KIND=redirect
    elif [ "$(printf '%s' "${OM_FINAL#https://}" | cut -d/ -f1)" != "$(printf '%s' "${OM_PURL#https://}" | cut -d/ -f1)" ]; then OM_KIND=redirect
    elif grep -Eiq 'enable JavaScript|JavaScript is (disabled|required)|requires JavaScript|please turn on JavaScript' "$OM_TEMP/body"; then OM_KIND=js
    elif grep -Eiq '<title>[^<]*(log in|login|sign in)|<form[^>]*(login|signin)|accounts.google.com/ServiceLogin' "$OM_TEMP/body"; then OM_KIND=login
    elif grep -Eiq "$OM_MARKER" "$OM_TEMP/body"; then OM_KIND=pass
    fi
    om_cell "$OM_KIND" "$OM_CODE" "$OM_TIME"
    printf '%s|%s\n' "$OM_PF" "$OM_KIND" >> "$OM_TEMP/results"
}
om_info() {
    OM_IF=$1 OM_IP=$2
    [ -n "$OM_IP" ] || return
    om_fetch "$OM_IF" "https://ipwho.is/$OM_IP" '' 5
    OM_RETURNED_IP=$(om_json ip "$OM_TEMP/body")
    if [ "$OM_RC" -eq 0 ] && [ "$OM_CODE" = 200 ] && grep -Eq '"success"[[:space:]]*:[[:space:]]*true' "$OM_TEMP/body" && [ "$(printf '%s' "$OM_RETURNED_IP" | tr A-F a-f)" = "$(printf '%s' "$OM_IP" | tr A-F a-f)" ]; then
        OM_COUNTRY=$(om_json country "$OM_TEMP/body"); OM_ORG=$(om_json org "$OM_TEMP/body")
        OM_ASN=$(sed -n 's/.*"asn"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$OM_TEMP/body")
        [ -z "$OM_ASN$OM_ORG$OM_COUNTRY" ] || printf '  IPv%s  %s%s · %s · %s\n' "$OM_IF" "${OM_ASN:+AS}" "$OM_ASN" "$OM_ORG" "$OM_COUNTRY"
    else printf '  IPv%s  归属未取得\n' "$OM_IF"; fi
}
om_hints() {
    awk '{for(i=1;i<=NF;i++){s=$i; if(s~/^59\.43\./)a["电信 CN2"]=1;else if(s~/^202\.97\./)a["电信 163"]=1;else if(s~/^(218\.105|210\.51)\./)a["联通 9929"]=1;else if(s~/^219\.158\./)a["联通 4837"]=1;else if(s~/^223\.120\.(16|17|19)\./)a["移动 CMIN2"]=1;else if(s~/^223\.(118|119|120|121)\./)a["移动 CMI"]=1}} END{sep="";for(k in a){printf "%s%s",sep,k;sep=" / "}}' "$1"
}
om_trace() {
    OM_TNAME=$1 OM_TIP=$2 OM_TFILE="$OM_TEMP/trace-$2"
    if [ "$OM_TOOL" = traceroute ]; then
        om_trace_run traceroute -4 -n -I -q 1 -w 1 -m 20 "$OM_TIP" > "$OM_TFILE" 2>&1
        OM_HINT=$(om_hints "$OM_TFILE")
        if [ -z "$OM_HINT" ]; then
            om_trace_run traceroute -4 -n -T -p 443 -q 1 -w 1 -m 20 "$OM_TIP" > "$OM_TFILE.tcp" 2>&1
            cat "$OM_TFILE.tcp" >> "$OM_TFILE"
        fi
        if ! awk '$1~/^[0-9]+[.:]?$/ {for(i=2;i<=NF;i++)if($i~/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/)n++}END{exit !n}' "$OM_TFILE"; then
            om_trace_run traceroute -4 -n -q 1 -w 1 -m 20 "$OM_TIP" > "$OM_TFILE.udp" 2>&1
            cat "$OM_TFILE.udp" >> "$OM_TFILE"
        fi
    else om_trace_run tracepath -4 -n -m 20 "$OM_TIP" > "$OM_TFILE" 2>&1; fi
    OM_HINT=$(om_hints "$OM_TFILE")
    # Arrival requires a hop line: the banner also contains the destination IP.
    OM_REACHED=$(awk -v ip="$OM_TIP" '$1~/^[0-9]+[.:]?$/ {for(i=2;i<=NF;i++)if($i==ip){print 1;exit}}' "$OM_TFILE")
    OM_HOPS=$(awk '$1~/^[0-9]+[.:]?$/ {for(i=2;i<=NF;i++)if($i~/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/){n++;break}} END{print n+0}' "$OM_TFILE")
    if [ "$OM_REACHED" = 1 ]; then OM_STATE='到达'; OM_TONE=$OM_GREEN
    elif [ "$OM_HOPS" -gt 0 ]; then OM_STATE='部分路径'; OM_TONE=$OM_YELLOW
    elif grep -Eiq 'permission|not permitted|not found|unrecognized|invalid option|Operation not|socket:' "$OM_TFILE"; then OM_STATE='工具/权限受限'; OM_TONE=$OM_GRAY
    else OM_STATE='无应答'; OM_TONE=$OM_GRAY; fi
    printf '  %s  %-15s  %b%s%b  %s\n' "$OM_TNAME" "$OM_TIP" "$OM_TONE" "$OM_STATE" "$OM_RESET" "${OM_HINT:-未见线路特征}"
}
om_trace_run() {
    OM_WATCH_PID=''
    if command -v timeout >/dev/null 2>&1; then timeout 12 "$@" & OM_TRACE_PID=$!
    else
        "$@" & OM_TRACE_PID=$!
        ( sleep 12 & OM_SLEEP_PID=$!; trap 'kill "$OM_SLEEP_PID" 2>/dev/null || :; exit 0' INT TERM; wait "$OM_SLEEP_PID" && kill "$OM_TRACE_PID" 2>/dev/null || : ) & OM_WATCH_PID=$!
    fi
    trap 'kill "$OM_TRACE_PID" 2>/dev/null || :; [ -z "$OM_WATCH_PID" ] || kill "$OM_WATCH_PID" 2>/dev/null || :; exit 130' INT TERM
    wait "$OM_TRACE_PID"; OM_TRACE_RC=$?
    if [ -n "$OM_WATCH_PID" ]; then kill "$OM_WATCH_PID" 2>/dev/null || :; wait "$OM_WATCH_PID" 2>/dev/null || :; fi
    trap 'printf "\n已中止。\n"; exit 130' INT TERM
    return "$OM_TRACE_RC"
}
# Source-only guard used by the external fixture checks.
[ "${OPENMILI_TEST_ONLY:-0}" != 1 ] || return 0 2>/dev/null || exit 0
printf '\n%b╭─ OPENMILI / IP TOOLKIT ─────────────────────────╮%b\n' "$OM_CYAN" "$OM_RESET"
printf '  IP 检测 · %s %s\n' "$(uname -s)" "$(uname -m)"
printf '  https://github.com/OpenMili/OpenMili-IP-Toolkit\n'
printf '%b╰───────────────────────────────────────────────╯%b\n' "$OM_CYAN" "$OM_RESET"
OM_SAVED_PROXY=$OM_PROXY; OM_PROXY=''
OM_V4=$(om_exit 4); OM_V6=$(om_exit 6); OM_PROXY=$OM_SAVED_PROXY
printf '\n  直连 IPv4  %s\n  直连 IPv6  %s\n' "${OM_V4:-未取得}" "${OM_V6:-未启用或不可达}"
if [ "$OM_DIRECT" -eq 0 ] && ( : </dev/tty ) 2>/dev/null; then
    printf '\n  [1] 开始检测    [2] 自定义端口\n\n  请选择 [1]: '
    IFS= read -r OM_CHOICE </dev/tty || OM_CHOICE=1
    case "${OM_CHOICE:-1}" in
        1) ;;
        2) printf '  代理端口或地址 [7890]: '; IFS= read -r OM_PROXY </dev/tty || OM_PROXY=''; OM_PROXY=${OM_PROXY:-7890} ;;
        *) printf '\n只能输入 1 或 2。\n' >&2; exit 2 ;;
    esac
fi
om_normalize_proxy || { printf '\n代理地址或端口无效。\n' >&2; exit 2; }
if [ -n "$OM_PROXY" ]; then
    OM_V4=$(om_exit 4); OM_V6=$(om_exit 6)
    printf '\n  代理出口 IPv4  %s\n  代理出口 IPv6  %s\n' "${OM_V4:-未取得}" "${OM_V6:-未启用或不可达}"
fi
if [ -z "$OM_V4$OM_V6" ]; then printf '\n未取得有效公网出口，停止检测。\n' >&2; exit 1; fi
om_section '出口归属'
om_info 4 "$OM_V4"; om_info 6 "$OM_V6"
printf '  来源 ipwho.is · 未返回的属性保留未知\n'
om_section '网站实测 · 浏览器标头 / 响应内容'
printf '  %-16s %-21s %s\n' 'SITE' 'IPv4' 'IPv6'
: > "$OM_TEMP/results"
while IFS='|' read -r OM_NAME OM_SITE OM_PATTERN; do
    printf '  %-16s ' "$OM_NAME"
    om_probe 4 "$OM_NAME" "$OM_SITE" "$OM_PATTERN" "$OM_V4"
    printf '  '
    om_probe 6 "$OM_NAME" "$OM_SITE" "$OM_PATTERN" "$OM_V6"
    printf '\n'
done <<'OM_SITES'
ChatGPT|https://chatgpt.com/|<title>[^<]*ChatGPT
Claude|https://claude.ai/|<title>[^<]*Claude
Gemini|https://gemini.google.com/|<title>[^<]*Gemini
Grok|https://grok.com/|<title>[^<]*Grok
Perplexity|https://www.perplexity.ai/|<title>[^<]*Perplexity
Google|https://www.google.com/search?q=openmili|<title>[^<]*Google|id="search"|id="rso"
YouTube|https://www.youtube.com/|<title>[^<]*YouTube|ytInitialData
Netflix|https://www.netflix.com/|<title>[^<]*Netflix
Disney+|https://www.disneyplus.com/|<title>[^<]*Disney
Spotify|https://open.spotify.com/|<title>[^<]*Spotify
TikTok|https://www.tiktok.com/|<title>[^<]*TikTok|__UNIVERSAL_DATA_FOR_REHYDRATION__
GitHub|https://github.com/|<title>[^<]*GitHub
X|https://x.com/|<title>[^<]*( / X|Twitter|X[[:space:]]*<)
Reddit|https://www.reddit.com/|<title>[^<]*Reddit
Hugging Face|https://huggingface.co/|<title>[^<]*Hugging Face
Scholar|https://scholar.google.com/|<title>[^<]*Google Scholar|gs_res_ccl
OM_SITES
printf '\n  %b通过%b 页面特征符合  %b验证/待核%b  %b阻断/失败%b\n' "$OM_GREEN" "$OM_RESET" "$OM_YELLOW" "$OM_RESET" "$OM_RED" "$OM_RESET"
printf '  HTTP 访问结果；不执行 JS，不代表登录、播放或完整解锁。\n'
om_section '三网路径 · IPv4'
if [ "$OM_ROUTES" -eq 0 ]; then printf '  已跳过\n'
elif [ -n "$OM_PROXY" ]; then printf '  代理模式跳过：请在目标 VPS 本机运行。\n'
elif [ -z "$OM_V4" ]; then printf '  无 IPv4 出口；原版 backtrace 节点仅支持 IPv4。\n'
else
    OM_TOOL=''
    if command -v traceroute >/dev/null 2>&1; then OM_TOOL=traceroute
    elif command -v tracepath >/dev/null 2>&1; then OM_TOOL=tracepath; fi
    if [ -z "$OM_TOOL" ]; then
        printf '  缺少路由工具：apt install traceroute / dnf install traceroute / apk add traceroute\n'
    else
        printf '  逐跳探测 · 12 节点 · 工具 %s\n' "$OM_TOOL"
        OM_BATCH=0
        while IFS='|' read -r OM_RNAME OM_RIP; do
            om_trace "$OM_RNAME" "$OM_RIP" &
            OM_BATCH=$((OM_BATCH+1)); [ "$OM_BATCH" -lt 3 ] || { wait; OM_BATCH=0; }
        done <<'OM_ROUTE_NODES'
北京电信|219.141.140.10
北京联通|202.106.195.68
北京移动|221.179.155.161
上海电信|202.96.209.133
上海联通|210.22.97.1
上海移动|211.136.112.200
广州电信|58.60.188.222
广州联通|210.21.196.6
广州移动|120.196.165.24
成都电信|61.139.2.69
成都联通|119.6.6.6
成都移动|211.137.96.205
OM_ROUTE_NODES
        wait
        printf '  线路特征为 backtrace 前缀提示；不据此保证 GIA 或线路质量。\n'
    fi
fi
om_section '本次结果'
for OM_SUM_F in 4 6; do
    if [ "$OM_SUM_F" = 4 ]; then OM_BEFORE=$OM_V4; else OM_BEFORE=$OM_V6; fi
    [ -n "$OM_BEFORE" ] || continue
    OM_AFTER=$(om_exit "$OM_SUM_F")
    if [ "$OM_AFTER" = "$OM_BEFORE" ]; then OM_STABLE='起止出口一致'; OM_TONE=$OM_GREEN
    else OM_STABLE='出口变化/复核失败，结果不能归属于单一 IP'; OM_TONE=$OM_YELLOW; fi
    OM_COUNTS=$(awk -F'|' -v f="$OM_SUM_F" '$1==f{n++;if($2=="pass")p++;else if($2~/^(captcha|js|login|partial|redirect|empty)$/)y++;else if($2=="unknown")u++;else r++}END{printf "通过 %d · 待核 %d · 失败 %d · 不支持 %d / %d",p,y,r,u,n}' "$OM_TEMP/results")
    printf '  IPv%s  %s\n         %b%s%b\n' "$OM_SUM_F" "$OM_COUNTS" "$OM_TONE" "$OM_STABLE" "$OM_RESET"
done
printf '  总耗时 %ss\n\n' "$(( $(date +%s) - OM_START ))"
