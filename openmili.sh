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
om_cleanup() {
    for OM_CHILD in ${OM_ROUTE_PIDS:-} $(jobs -p); do kill "$OM_CHILD" 2>/dev/null || :; done
    for OM_CHILD in ${OM_ROUTE_PIDS:-}; do wait "$OM_CHILD" 2>/dev/null || :; done
    rm -rf "$OM_TEMP"
}
trap 'om_cleanup' 0
trap 'printf "\n已中止。\n"; exit 130' INT TERM
om_clock() { if [ -r /proc/uptime ]; then awk '{printf "%d",$1}' /proc/uptime; else date +%s; fi; }
OM_START=$(om_clock)
OM_WIDTH=${COLUMNS:-96}
if [ -t 1 ] && command -v stty >/dev/null 2>&1; then
    OM_SIZE=$(stty size 2>/dev/null || :)
    [ -z "$OM_SIZE" ] || OM_WIDTH=${OM_SIZE##* }
fi
case "$OM_WIDTH" in ''|*[!0-9]*) OM_WIDTH=96;; esac
[ "$OM_WIDTH" -ge 32 ] || OM_WIDTH=32
[ "$OM_WIDTH" -le 96 ] || OM_WIDTH=96
OM_ESC=$(printf '\033')
OM_RESET='' OM_GREEN='' OM_YELLOW='' OM_RED='' OM_GRAY='' OM_CYAN=''
if [ "$OM_COLOR" -eq 1 ] && [ -t 1 ] && [ "${NO_COLOR+x}" != x ] && [ "${TERM:-}" != dumb ]; then
    OM_RESET="${OM_ESC}[0m" OM_GREEN="${OM_ESC}[32m" OM_YELLOW="${OM_ESC}[33m"
    OM_RED="${OM_ESC}[31m" OM_GRAY="${OM_ESC}[90m" OM_CYAN="${OM_ESC}[36m"
fi
om_rule() { awk -v n="$1" 'BEGIN{for(i=0;i<n;i++)printf "-"}'; }
om_width() {
    printf '%s' "$1" | LC_ALL=C awk '{for(i=1;i<=length($0);i++){c=substr($0,i,1);if(c~/[\360-\367]/){n+=2;i+=3}else if(c~/[\340-\357]/){n+=2;i+=2}else if(c~/[\300-\337]/){n++;i++}else n++}}END{print n+0}'
}
om_pad() {
    printf '%s' "$1"
    OM_PAD_WIDTH=$(om_width "$1")
    [ "$OM_PAD_WIDTH" -ge "$2" ] || printf '%*s' "$(( $2 - OM_PAD_WIDTH ))" ''
}
om_lines() {
    printf '%s\n' "$1" | LC_ALL=C awk -v w="$2" '
    {for(i=1;i<=length($0);i++){c=substr($0,i,1);b=1;n=1;if(c~/[\360-\367]/){b=4;n=2}else if(c~/[\340-\357]/){b=3;n=2}else if(c~/[\300-\337]/)b=2;if(size+n>w){printf "\n";size=0}printf "%s",substr($0,i,b);size+=n;i+=b-1}}END{printf "\n"}'
}
om_wrap() { om_lines "$1" "$((OM_WIDTH-${2:-2}))" | awk -v n="${2:-2}" '{printf "%*s%s\n",n,"",$0}'; }
om_field() { om_wrap "$(om_pad "$1" 12): $2"; }
om_section() {
    printf '\n%b' "$OM_CYAN"; om_rule "$OM_WIDTH"; printf '\n'; om_wrap "$1" 0; om_rule "$OM_WIDTH"; printf '%b\n' "$OM_RESET"
}
om_clean() { tr '\000-\010\013\014\016-\037\177' ' ' | tr '\r\n' '  ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
om_json() { sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"\\]*\)".*/\1/p' "$2" | head -n 1 | om_clean; }
om_public() {
    case "$1" in
        4) printf '%s\n' "$2" | awk -F. 'NF!=4{exit 1} {for(i=1;i<=4;i++)if($i!~/^[0-9]+$/||$i>255)exit 1; if($1==0||$1==10||$1==127||$1>=224||($1==169&&$2==254)||($1==172&&$2>=16&&$2<=31)||($1==192&&($2==168||($2==0&&($3==0||$3==2))))||($1==100&&$2>=64&&$2<=127)||($1==198&&($2==18||$2==19||($2==51&&$3==100)))||($1==203&&$2==0&&$3==113))exit 1}' ;;
        6) case "$2" in [23][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]:*) case "$2" in *[!0-9a-fA-F:]*|2001:[dD][bB]8:*) return 1;; esac;; *) return 1;; esac
           printf '%s\n' "$2" | awk '{s=$0;if(index(s,":::"))exit 1;c=gsub(/::/,"@",s);if(c>1)exit 1;n=split($0,a,":");if(tolower(a[1])=="2001"&&tolower(a[2])~/^0?db8$/)exit 1;k=0;for(i=1;i<=n;i++)if(a[i]!=""){if(length(a[i])>4||a[i]!~/^[0-9a-fA-F]+$/)exit 1;k++}if(c==1){if(k>=8||k<1)exit 1}else if(k!=8||n!=8)exit 1}' ;;
    esac
}
om_canonical() {
    printf '%s\n' "$2" | awk -v f="$1" '
    f==4 {n=split($0,a,".");for(i=1;i<=n;i++)printf "%s%d",i==1?"":".",a[i]+0;next}
    {s=tolower($0);k=index(s,"::");if(k){l=substr(s,1,k-1);r=substr(s,k+2);nl=l==""?0:split(l,a,":");nr=r==""?0:split(r,b,":");for(i=1;i<=nl;i++)v[i]=a[i];for(i=nl+1;i<=8-nr;i++)v[i]="0";for(i=1;i<=nr;i++)v[8-nr+i]=b[i]}else split(s,v,":");for(i=1;i<=8;i++){sub(/^0+/,"",v[i]);printf "%s%s",i==1?"":":",v[i]==""?"0":v[i]}}'
}
om_same_ip() { om_public "$1" "$3" && [ "$(om_canonical "$1" "$2")" = "$(om_canonical "$1" "$3")" ]; }
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
    curl "$@" > "$OM_TEMP/meta" 2>/dev/null; OM_RC=$?
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
om_label() {
    case "$1" in
        pass) OM_LABEL='通过'; OM_TONE=$OM_GREEN;;
        captcha) OM_LABEL='验证'; OM_TONE=$OM_YELLOW;;
        js) OM_LABEL='需JS'; OM_TONE=$OM_YELLOW;;
        login) OM_LABEL='登录'; OM_TONE=$OM_YELLOW;;
        partial) OM_LABEL='可达?'; OM_TONE=$OM_YELLOW;;
        empty) OM_LABEL='空白'; OM_TONE=$OM_YELLOW;;
        redirect) OM_LABEL='跳转待核'; OM_TONE=$OM_YELLOW;;
        region) OM_LABEL='地区限制'; OM_TONE=$OM_RED;;
        block) OM_LABEL='阻断'; OM_TONE=$OM_RED;;
        rate) OM_LABEL='限流'; OM_TONE=$OM_RED;;
        dns) OM_LABEL='DNS失败'; OM_TONE=$OM_RED;;
        tls) OM_LABEL='TLS失败'; OM_TONE=$OM_RED;;
        timeout) OM_LABEL='超时'; OM_TONE=$OM_RED;;
        fail) OM_LABEL='失败'; OM_TONE=$OM_RED;;
        noaddr) OM_LABEL='无DNS'; OM_TONE=$OM_GRAY;;
        source) OM_LABEL='解析失败'; OM_TONE=$OM_GRAY;;
        *) OM_LABEL='未知'; OM_TONE=$OM_GRAY;;
    esac
}
om_probe_record() {
    case "$OM_KIND" in source|noaddr) printf '%s|unknown\n' "$OM_PF";; *) printf '%s|%s\n' "$OM_PF" "$OM_KIND";; esac >> "$OM_TEMP/results"
}
om_probe() {
    OM_PF=$1 OM_PURL=$2 OM_MARKER=$3
    OM_PPIN=''
    if [ -n "$OM_PROXY" ]; then
        OM_HOST=${OM_PURL#https://}; OM_HOST=${OM_HOST%%/*}; OM_TYPE=1; [ "$OM_PF" = 4 ] || OM_TYPE=28
        OM_DOH_OK=0
        for OM_DOH_BASE in 'https://dns.google/resolve' 'https://cloudflare-dns.com/dns-query'; do
            om_fetch 4 "$OM_DOH_BASE?name=$OM_HOST&type=$OM_TYPE" '' 5 'application/dns-json'
            if [ "$OM_RC" -eq 0 ] && [ "$OM_CODE" = 200 ] && grep -Eq '"Status"[[:space:]]*:[[:space:]]*[0-9]+([[:space:]]*[,}])' "$OM_TEMP/body"; then OM_DOH_OK=1; break; fi
        done
        if [ "$OM_DOH_OK" -ne 1 ]; then OM_KIND=source OM_CODE=000; om_probe_record; return; fi
        if ! grep -Eq '"Status"[[:space:]]*:[[:space:]]*0([[:space:]]*[,}])' "$OM_TEMP/body"; then OM_KIND=dns OM_CODE=000; om_probe_record; return; fi
        OM_ADDR=$(tr '{' '\n' < "$OM_TEMP/body" | awk -v t="$OM_TYPE" '$0 ~ "\"type\"[[:space:]]*:[[:space:]]*"t"[[:space:]]*," {s=$0;sub(/.*"data"[[:space:]]*:[[:space:]]*"/,"",s);sub(/".*/,"",s);print s;exit}')
        if ! om_public "$OM_PF" "$OM_ADDR"; then OM_KIND=noaddr OM_CODE=000; om_probe_record; return; fi
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
    elif printf '%s' "$OM_FINAL" | grep -Eiq '^https://accounts\.google\.com/|^https://[^/]+/(login|signin)([/?#]|$)'; then OM_KIND=login
    elif [ "${OM_FINAL#https://}" = "$OM_FINAL" ]; then OM_KIND=redirect
    elif [ "$(printf '%s' "${OM_FINAL#https://}" | cut -d/ -f1)" != "$(printf '%s' "${OM_PURL#https://}" | cut -d/ -f1)" ]; then OM_KIND=redirect
    elif grep -Eiq 'enable JavaScript|JavaScript is (disabled|required)|requires JavaScript|please turn on JavaScript' "$OM_TEMP/body"; then OM_KIND=js
    elif grep -Eiq '<title>[^<]*(log in|login|sign in)' "$OM_TEMP/body"; then OM_KIND=login
    elif grep -Eiq '<(title|h1)[^>]*>[[:space:]]*(access denied|forbidden|request (blocked|rejected)|you have been blocked)' "$OM_TEMP/body"; then OM_KIND=block
    elif grep -Eiq "$OM_MARKER" "$OM_TEMP/body"; then OM_KIND=pass
    fi
    om_probe_record
}
om_info() {
    OM_IF=$1 OM_IP=$2
    [ -n "$OM_IP" ] || return
    OM_LOOKUP_FAMILY=4; [ -n "${OM_V4:-}" ] || OM_LOOKUP_FAMILY=6
    for OM_PROVIDER in ipwho.is ipinfo.io ip.sb; do
        case "$OM_PROVIDER" in
            ipwho.is) OM_INFO_URL="https://ipwho.is/$OM_IP" ;;
            ipinfo.io) OM_INFO_URL="https://ipinfo.io/$OM_IP/json" ;;
            ip.sb) OM_INFO_URL="https://api.ip.sb/geoip/$OM_IP" ;;
        esac
        om_fetch "$OM_LOOKUP_FAMILY" "$OM_INFO_URL" '' 4 'application/json'
        [ "$OM_RC" -eq 0 ] && [ "$OM_CODE" = 200 ] || continue
        OM_RETURNED_IP=$(om_json ip "$OM_TEMP/body")
        om_same_ip "$OM_IF" "$OM_IP" "$OM_RETURNED_IP" || continue
        OM_ORG='' OM_ASN=''
        if [ "$OM_PROVIDER" = ipwho.is ]; then
            grep -Eq '"success"[[:space:]]*:[[:space:]]*true' "$OM_TEMP/body" || continue
            OM_ORG=$(om_json org "$OM_TEMP/body")
        elif [ "$OM_PROVIDER" = ipinfo.io ]; then
            OM_ORG=$(om_json org "$OM_TEMP/body")
            OM_ASN=$(printf '%s' "$OM_ORG" | sed -n 's/^AS\([0-9][0-9]*\).*/\1/p')
            OM_ORG=$(printf '%s' "$OM_ORG" | sed 's/^AS[0-9][0-9]*[[:space:]]*//')
        else
            OM_ORG=$(om_json asn_organization "$OM_TEMP/body")
            [ -n "$OM_ORG" ] || OM_ORG=$(om_json organization "$OM_TEMP/body")
            [ -n "$OM_ORG" ] || OM_ORG=$(om_json isp "$OM_TEMP/body")
        fi
        [ -n "$OM_ASN" ] || OM_ASN=$(sed -n 's/.*"asn"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$OM_TEMP/body" | head -n 1)
        OM_COUNTRY=$(om_json country_code "$OM_TEMP/body")
        [ -n "$OM_COUNTRY" ] || OM_COUNTRY=$(om_json country "$OM_TEMP/body")
        OM_CITY=$(om_json city "$OM_TEMP/body")
        [ -n "$OM_ASN$OM_ORG$OM_COUNTRY" ] || continue
        om_field "IPv$OM_IF ASN" "${OM_ASN:+AS}${OM_ASN:-未知 ASN} · ${OM_ORG:-归属未返回}"
        om_field '地区' "${OM_COUNTRY:-未知}${OM_CITY:+ / }$OM_CITY  [$OM_PROVIDER]"
        if printf '%s' "$OM_ORG" | grep -Eiq 'Cloud|Hosting|Datacenter|Data Center|DMIT|RackNerd|Amazon|Google|Microsoft|DigitalOcean|OVH|Hetzner|Vultr|Linode|Akamai|Oracle'; then
            om_field 'IP 属性' '机房倾向 (ASN归属)'
        else om_field 'IP 属性' '未知 (仅凭ASN不能确认住宅)'; fi
        return
    done
    printf '%b' "$OM_GRAY"; om_field "IPv$OM_IF ASN" '归属查询暂不可用'; om_field 'IP 属性' '未知'; printf '%b' "$OM_RESET"
}
om_hints() {
    # Preserve hop order; the specific international line replaces its common trunk.
    awk '$1~/^[0-9]+[.:]?$/ {for(i=2;i<=NF;i++){s=$i;k="";if(s~/^59\.43\./)k="电信 CN2";else if(s~/^202\.97\./)k="电信 163";else if(s~/^(218\.105|210\.51)\./)k="联通 9929";else if(s~/^219\.158\./)k="联通 4837";else if(s~/^223\.120\.(16|17|19)\./)k="移动 CMIN2";else if(s~/^223\.(118|119|120|121)\./)k="移动 CMI";if(k!=""&&!seen[k]++){order[++n]=k}}}
        END{sep="";for(i=1;i<=n;i++){k=order[i];if((k=="移动 CMI"&&seen["移动 CMIN2"])||(k=="电信 163"&&seen["电信 CN2"])||(k=="联通 4837"&&seen["联通 9929"]))continue;printf "%s%s",sep,k;sep=" / "}}' "$1"
}
om_trace_ping() {
    # Like backtrace, send ICMP at successive TTLs without waiting on each silent hop.
    OM_PING_IP=$1 OM_PING_FILE=$2 OM_PING_PREFIX="$OM_TEMP/ping-$1"
    OM_PING_CHILDREN=''
    trap 'for OM_PID in $OM_PING_CHILDREN; do kill "$OM_PID" 2>/dev/null || :; done; exit 130' INT TERM
    : > "$OM_PING_FILE"
    OM_TTL=1
    while [ "$OM_TTL" -le 30 ]; do
        OM_PING_CHILDREN=''; OM_WAVE=0
        while [ "$OM_WAVE" -lt 6 ] && [ "$OM_TTL" -le 30 ]; do
            LC_ALL=C ping -n -c 1 -W 1 -w 1 -t "$OM_TTL" "$OM_PING_IP" > "$OM_PING_PREFIX-$OM_TTL" 2>&1 &
            OM_PING_CHILDREN="$OM_PING_CHILDREN $!"
            OM_TTL=$((OM_TTL+1)); OM_WAVE=$((OM_WAVE+1))
        done
        for OM_PID in $OM_PING_CHILDREN; do wait "$OM_PID" || :; done
        OM_PING_CHILDREN=''
        OM_READ_TTL=$((OM_TTL-OM_WAVE))
        while [ "$OM_READ_TTL" -lt "$OM_TTL" ]; do
            awk -v ttl="$OM_READ_TTL" -v target="$OM_PING_IP" 'tolower($0)~/from/ {line=tolower($0);echo=line~/bytes from/;ok=echo||line~/time to live exceeded|ttl (expired|exceeded)/;for(i=1;i<NF;i++)if(tolower($i)=="from"){s=$(i+1);gsub(/[():]/,"",s);if(s~/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/){if(!echo&&s==target)print ttl,s,"!E";else if(ok)print ttl,s;else print ttl,s,"!E";break}}}' "$OM_PING_PREFIX-$OM_READ_TTL" >> "$OM_PING_FILE"
            grep -Ei 'permission|not permitted|invalid option|unrecognized option|socket:' "$OM_PING_PREFIX-$OM_READ_TTL" >> "$OM_PING_FILE" || :
            OM_READ_TTL=$((OM_READ_TTL+1))
        done
        awk -v ip="$OM_PING_IP" '$2==ip&&!index($0,"!"){found=1}END{exit !found}' "$OM_PING_FILE" && break
        grep -Eiq 'permission|not permitted|invalid option|unrecognized option|socket:' "$OM_PING_FILE" && break
    done
}
om_trace_collect() {
    OM_PING_SESSION=''
    trap '[ -z "$OM_PING_SESSION" ] || kill "$OM_PING_SESSION" 2>/dev/null || :; exit 130' INT TERM
    OM_METHOD=$1 OM_TIP=$2 OM_TFILE=$3
    : > "$OM_TFILE"
    if [ "$OM_METHOD" = TCP ]; then
        if [ -z "${OM_TCP_TOOL:-}" ]; then printf 'OPENMILI_NO_TOOL\n' > "$OM_TFILE"; return; fi
        om_trace_run traceroute -4 -n -T -p 443 -q 1 -w 1 -m 30 "$OM_TIP" > "$OM_TFILE" 2>&1 || printf 'OPENMILI_TRACE_FAILED\n' >> "$OM_TFILE"
    elif [ "$OM_TOOL" = traceroute ]; then
        om_trace_run traceroute -4 -n -I -q 1 -w 1 -m 30 "$OM_TIP" > "$OM_TFILE" 2>&1 || printf 'OPENMILI_TRACE_FAILED\n' >> "$OM_TFILE"
    elif [ "$OM_TOOL" = ping ]; then
        om_trace_ping "$OM_TIP" "$OM_TFILE" & OM_PING_SESSION=$!
        wait "$OM_PING_SESSION" || :
    else printf 'OPENMILI_NO_TOOL\n' > "$OM_TFILE"; fi
}
om_trace_status() {
    OM_TFILE=$1 OM_TIP=$2
    OM_HINT=$(om_hints "$OM_TFILE")
    # Arrival requires a hop line: the banner also contains the destination IP.
    OM_REACHED=$(awk -v ip="$OM_TIP" '$1~/^[0-9]+[.:]?$/&&!index($0,"!") {for(i=2;i<=NF;i++)if($i==ip){print 1;exit}}' "$OM_TFILE")
    OM_HOPS=$(awk '$1~/^[0-9]+[.:]?$/ {for(i=2;i<=NF;i++)if($i~/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/){n++;break}} END{print n+0}' "$OM_TFILE")
    if [ "$OM_REACHED" = 1 ]; then OM_STATE='已到达'; OM_TONE=$OM_GREEN
    elif [ "$OM_HOPS" -gt 0 ]; then OM_STATE='部分可见'; OM_TONE=$OM_YELLOW
    elif grep -Eiq 'permission|not permitted|privilege|must be root|socket:' "$OM_TFILE"; then OM_STATE='权限受限'; OM_TONE=$OM_GRAY
    elif grep -Eiq 'unrecognized|invalid option|not found|unknown option' "$OM_TFILE"; then OM_STATE='工具不兼容'; OM_TONE=$OM_GRAY
    elif grep -Eiq 'unreachable|no route|network is down' "$OM_TFILE"; then OM_STATE='路由不可达'; OM_TONE=$OM_GRAY
    elif grep -q 'OPENMILI_TRACE_TIMEOUT' "$OM_TFILE"; then OM_STATE='探测超时'; OM_TONE=$OM_GRAY
    elif grep -q 'OPENMILI_NO_TOOL' "$OM_TFILE"; then OM_STATE='未安装'; OM_TONE=$OM_GRAY
    elif grep -q 'OPENMILI_TRACE_FAILED' "$OM_TFILE"; then OM_STATE='探测失败'; OM_TONE=$OM_GRAY
    else OM_STATE='无响应'; OM_TONE=$OM_GRAY; fi
}
om_trace() {
    OM_TNAME=$1 OM_NODE_IP=$2 OM_NODE_PREFIX="$OM_TEMP/trace-$2"
    OM_ICMP_PID='' OM_TCP_PID=''
    trap 'for OM_PID in "$OM_ICMP_PID" "$OM_TCP_PID"; do [ -z "$OM_PID" ] || kill "$OM_PID" 2>/dev/null || :; done; for OM_PID in "$OM_ICMP_PID" "$OM_TCP_PID"; do [ -z "$OM_PID" ] || wait "$OM_PID" 2>/dev/null || :; done; exit 130' INT TERM
    om_trace_collect ICMP "$OM_NODE_IP" "$OM_NODE_PREFIX.icmp" & OM_ICMP_PID=$!
    om_trace_collect TCP "$OM_NODE_IP" "$OM_NODE_PREFIX.tcp" & OM_TCP_PID=$!
    wait "$OM_ICMP_PID" || :; wait "$OM_TCP_PID" || :
    OM_ICMP_PID='' OM_TCP_PID=''
    om_trace_status "$OM_NODE_PREFIX.icmp" "$OM_NODE_IP"
    OM_ITONE=$OM_TONE OM_ITEXT="$OM_STATE${OM_HINT:+ · }$OM_HINT"
    om_trace_status "$OM_NODE_PREFIX.tcp" "$OM_NODE_IP"
    OM_TTONE=$OM_TONE OM_TTEXT="$OM_STATE${OM_HINT:+ · }$OM_HINT"
    if [ "${OM_WIDTH:-76}" -lt 70 ]; then
        printf '  %s\n' "$OM_TNAME"
        printf '%b' "$OM_ITONE"; om_wrap "ICMP  $OM_ITEXT" 4; printf '%b' "$OM_RESET"
        printf '%b' "$OM_TTONE"; om_wrap "TCP   $OM_TTEXT" 4; printf '%b' "$OM_RESET"
    else
        OM_ROUTE_WIDTH=$(((OM_WIDTH-18)/2))
        om_lines "$OM_ITEXT" "$OM_ROUTE_WIDTH" > "$OM_NODE_PREFIX.icmp-lines"
        om_lines "$OM_TTEXT" "$OM_ROUTE_WIDTH" > "$OM_NODE_PREFIX.tcp-lines"
        OM_FIRST_LINE=1
        paste -d '|' "$OM_NODE_PREFIX.icmp-lines" "$OM_NODE_PREFIX.tcp-lines" | while IFS='|' read -r OM_ILINE OM_TLINE; do
            printf '  '
            if [ "$OM_FIRST_LINE" -eq 1 ]; then om_pad "$OM_TNAME" 12; else om_pad '' 12; fi
            printf '%b| %b' "$OM_GRAY" "$OM_ITONE"; om_pad "$OM_ILINE" "$OM_ROUTE_WIDTH"
            printf '%b| %b' "$OM_GRAY" "$OM_TTONE"; om_pad "$OM_TLINE" "$OM_ROUTE_WIDTH"
            printf '%b\n' "$OM_RESET"; OM_FIRST_LINE=0
        done
    fi
}
om_trace_run() {
    OM_WATCH_PID=''
    if command -v timeout >/dev/null 2>&1; then LC_ALL=C timeout 12 "$@" & OM_TRACE_PID=$!
    else
        LC_ALL=C "$@" & OM_TRACE_PID=$!
        ( sleep 12 & OM_SLEEP_PID=$!; trap 'kill "$OM_SLEEP_PID" 2>/dev/null || :; exit 0' INT TERM; wait "$OM_SLEEP_PID" && kill "$OM_TRACE_PID" 2>/dev/null || : ) & OM_WATCH_PID=$!
    fi
    trap 'kill "$OM_TRACE_PID" 2>/dev/null || :; [ -z "$OM_WATCH_PID" ] || kill "$OM_WATCH_PID" 2>/dev/null || :; exit 130' INT TERM
    wait "$OM_TRACE_PID"; OM_TRACE_RC=$?
    case "$OM_TRACE_RC" in 124|137|143) printf 'OPENMILI_TRACE_TIMEOUT\n' >&2;; esac
    if [ -n "$OM_WATCH_PID" ]; then kill "$OM_WATCH_PID" 2>/dev/null || :; wait "$OM_WATCH_PID" 2>/dev/null || :; fi
    trap '[ -z "${OM_PING_SESSION:-}" ] || kill "$OM_PING_SESSION" 2>/dev/null || :; exit 130' INT TERM
    return "$OM_TRACE_RC"
}
om_center() {
    OM_CENTER_SIZE=$(om_width "$1")
    if [ "$OM_CENTER_SIZE" -le "$OM_WIDTH" ]; then printf '%*s%s\n' "$(((OM_WIDTH-OM_CENTER_SIZE)/2))" '' "$1"
    else om_wrap "$1" 0; fi
}
om_hardware() {
    OM_CPU=$(awk '/^processor[[:space:]]*:/ {n++}END{if(n)print n}' /proc/cpuinfo 2>/dev/null || :)
    OM_RAM=$(awk '/^MemTotal:/ {printf "%.1f GiB",$2/1048576}' /proc/meminfo 2>/dev/null || :)
    OM_DISK=$(LC_ALL=C df -Pk / 2>/dev/null | awk 'NR==2&&$2~/^[0-9]+$/ {printf "%.1f GiB",$2/1048576}')
    om_wrap "$(uname -s) $(uname -m) | CPU: ${OM_CPU:-未知}${OM_CPU:+ 核} | RAM: ${OM_RAM:-未知} | 系统盘: ${OM_DISK:-未知}" 0
    om_wrap "检测时间: $(date '+%Y-%m-%d %H:%M:%S %Z')" 0
}
om_catalog() {
    cat <<'OM_SITES'
AI|1|ChatGPT|https://chatgpt.com/|<title>[^<]*ChatGPT
AI|2|Claude|https://claude.ai/|<title>[^<]*Claude
AI|3|Gemini|https://gemini.google.com/|<title>[^<]*Gemini
AI|4|Grok|https://grok.com/|<title>[^<]*Grok
AI|5|Perplexity|https://www.perplexity.ai/|<title>[^<]*Perplexity
Media|1|Netflix|https://www.netflix.com/|<title>[^<]*Netflix
Media|2|Disney+|https://www.disneyplus.com/|<title>[^<]*Disney
Media|3|YouTube|https://www.youtube.com/|<title>[^<]*YouTube|ytInitialData
Media|4|Spotify|https://open.spotify.com/|<title>[^<]*Spotify
Media|5|TikTok|https://www.tiktok.com/|<title>[^<]*TikTok|__UNIVERSAL_DATA_FOR_REHYDRATION__
Community|1|GitHub|https://github.com/|<title>[^<]*GitHub
Community|2|X|https://x.com/|<title>[^<]*( / X|Twitter|X[[:space:]]*<)
Community|3|Reddit|https://www.reddit.com/|<title>[^<]*Reddit
Community|4|Scholar|https://scholar.google.com/|<title>[^<]*Google Scholar|gs_res_ccl
Community|5|Hugging Face|https://huggingface.co/|<title>[^<]*Hugging Face
Community|6|Google|https://www.google.com/search?q=openmili|<title>[^<]*Google|id="search"|id="rso"
OM_SITES
}
om_site_entry() {
    OM_SITE_TEXT='' OM_SITE_TONE=''
    OM_ENTRY=$(awk -F'|' -v g="$2" -v n="$3" '$1==g&&$2==n{print;exit}' "$OM_TEMP/sites")
    [ -n "$OM_ENTRY" ] || return 0
    IFS='|' read -r OM_CATEGORY OM_ORDER OM_NAME OM_SITE OM_PATTERN <<OM_ENTRY_DATA
$OM_ENTRY
OM_ENTRY_DATA
    om_probe "$1" "$OM_SITE" "$OM_PATTERN"
    om_label "$OM_KIND"
    OM_SITE_TEXT="$(om_pad "$OM_NAME" 12) : $OM_LABEL"
    case "$OM_CODE" in [1-5][0-9][0-9]) OM_SITE_TEXT="$OM_SITE_TEXT ($OM_CODE)";; esac
    OM_SITE_TONE=$OM_TONE
}
om_site_row() {
    om_lines "$1" "$7" > "$OM_TEMP/site-col-1"
    om_lines "$3" "$7" > "$OM_TEMP/site-col-2"
    om_lines "$5" "$7" > "$OM_TEMP/site-col-3"
    paste -d '|' "$OM_TEMP/site-col-1" "$OM_TEMP/site-col-2" "$OM_TEMP/site-col-3" | while IFS='|' read -r OM_C1 OM_C2 OM_C3; do
        printf '  %b' "$2"; om_pad "$OM_C1" "$7"
        printf '%b  %b' "$OM_RESET" "$4"; om_pad "$OM_C2" "$7"
        printf '%b  %b' "$OM_RESET" "$6"; om_pad "$OM_C3" "$7"
        printf '%b\n' "$OM_RESET"
    done
}
om_show_sites() {
    OM_REPORT_FAMILY=$1
    printf '\n  %b[IPv%s]%b\n' "$OM_CYAN" "$OM_REPORT_FAMILY" "$OM_RESET"
    if [ "$OM_WIDTH" -ge 90 ]; then
        OM_SITE_WIDTH=$(((OM_WIDTH-6)/3))
        om_site_row '[人工智能 AI]' "$OM_CYAN" '[海外流媒体]' "$OM_CYAN" '[常用社区/平台]' "$OM_CYAN" "$OM_SITE_WIDTH"
        OM_SITE_DASH=$(om_rule "$OM_SITE_WIDTH")
        om_site_row "$OM_SITE_DASH" "$OM_GRAY" "$OM_SITE_DASH" "$OM_GRAY" "$OM_SITE_DASH" "$OM_GRAY" "$OM_SITE_WIDTH"
        OM_SITE_ROW=1
        while [ "$OM_SITE_ROW" -le 6 ]; do
            om_site_entry "$OM_REPORT_FAMILY" AI "$OM_SITE_ROW"; OM_S1=$OM_SITE_TEXT OM_T1=$OM_SITE_TONE
            om_site_entry "$OM_REPORT_FAMILY" Media "$OM_SITE_ROW"; OM_S2=$OM_SITE_TEXT OM_T2=$OM_SITE_TONE
            om_site_entry "$OM_REPORT_FAMILY" Community "$OM_SITE_ROW"; OM_S3=$OM_SITE_TEXT OM_T3=$OM_SITE_TONE
            om_site_row "$OM_S1" "$OM_T1" "$OM_S2" "$OM_T2" "$OM_S3" "$OM_T3" "$OM_SITE_WIDTH"
            OM_SITE_ROW=$((OM_SITE_ROW+1))
        done
    else
        for OM_GROUP in AI Media Community; do
            case "$OM_GROUP" in AI) OM_GROUP_TITLE='[人工智能 AI]';; Media) OM_GROUP_TITLE='[海外流媒体]';; *) OM_GROUP_TITLE='[常用社区/平台]';; esac
            printf '\n  %b%s%b\n' "$OM_CYAN" "$OM_GROUP_TITLE" "$OM_RESET"
            printf '  %b' "$OM_GRAY"; om_rule 30; printf '%b\n' "$OM_RESET"
            OM_SITE_ROW=1
            while [ "$OM_SITE_ROW" -le 6 ]; do
                om_site_entry "$OM_REPORT_FAMILY" "$OM_GROUP" "$OM_SITE_ROW"
                if [ -n "$OM_SITE_TEXT" ]; then printf '%b' "$OM_SITE_TONE"; om_wrap "$OM_SITE_TEXT"; printf '%b' "$OM_RESET"; fi
                OM_SITE_ROW=$((OM_SITE_ROW+1))
            done
        done
    fi
}
om_nodes() {
    cat <<'OM_ROUTE_NODES'
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
}
om_latency_probe() {
    OM_LAT_IP=$1 OM_LAT_FILE=$2 OM_LAT_PID=''
    trap '[ -z "$OM_LAT_PID" ] || kill "$OM_LAT_PID" 2>/dev/null || :; exit 130' INT TERM
    LC_ALL=C ping -n -c 2 -i 0.2 -W 1 -w 2 "$OM_LAT_IP" > "$OM_LAT_FILE.raw" 2>&1 & OM_LAT_PID=$!
    wait "$OM_LAT_PID" || :; OM_LAT_PID=''
    OM_LAT_RESULT=$(awk -v target="$OM_LAT_IP" 'tolower($0)~/bytes from/ {source="";for(i=1;i<NF;i++)if(tolower($i)=="from"){source=$(i+1);gsub(/[():]/,"",source);break}if(source!=target)next;for(i=1;i<=NF;i++)if($i~/^time[=<][0-9.]+/){s=$i;if(s~/^time</)less++;sub(/^time[=<]/,"",s);total+=s;n++;break}}END{if(n){if(less==n)printf "<%g ms",total/n;else printf "%s%.1f ms",less?"~":"",total/n;if(n==1)printf " (1/2)"}}' "$OM_LAT_FILE.raw")
    if [ -n "$OM_LAT_RESULT" ]; then printf '%s\n' "$OM_LAT_RESULT"
    elif grep -Eiq 'permission|not permitted|privilege|must be root|socket:' "$OM_LAT_FILE.raw"; then printf '权限受限\n'
    elif grep -Eiq 'invalid option|unrecognized|unknown option' "$OM_LAT_FILE.raw"; then printf '工具不兼容\n'
    elif grep -Eiq 'unreachable|no route|network is down' "$OM_LAT_FILE.raw"; then printf '不可达\n'
    else printf '超时\n'; fi > "$OM_LAT_FILE"
}
om_show_latency() {
    OM_ROUTE_PIDS='' OM_LAT_INDEX=0
    while IFS='|' read -r OM_LAT_NAME OM_LAT_TARGET; do
        OM_LAT_INDEX=$((OM_LAT_INDEX+1))
        om_latency_probe "$OM_LAT_TARGET" "$OM_TEMP/latency-$OM_LAT_INDEX" & OM_ROUTE_PIDS="$OM_ROUTE_PIDS $!"
    done < "$OM_TEMP/nodes"
    for OM_PID in $OM_ROUTE_PIDS; do wait "$OM_PID" || :; done
    OM_ROUTE_PIDS=''
    if [ "$OM_WIDTH" -ge 60 ]; then
        OM_LAT_WIDTH=$(((OM_WIDTH-10)/3))
        printf '  %b' "$OM_GRAY"; om_pad '城市' 8; om_pad '电信' "$OM_LAT_WIDTH"; om_pad '联通' "$OM_LAT_WIDTH"; printf '移动%b\n' "$OM_RESET"
    fi
    OM_LAT_INDEX=1
    for OM_CITY_NAME in 北京 上海 广州 成都; do
        if [ "$OM_WIDTH" -ge 60 ]; then printf '  '; om_pad "$OM_CITY_NAME" 8; else printf '  %s\n' "$OM_CITY_NAME"; fi
        for OM_CARRIER in 电信 联通 移动; do
            OM_LAT_VALUE=$(cat "$OM_TEMP/latency-$OM_LAT_INDEX")
            if [ "$OM_WIDTH" -ge 60 ]; then om_pad "$OM_LAT_VALUE" "$OM_LAT_WIDTH"; else om_wrap "$OM_CARRIER : $OM_LAT_VALUE" 4; fi
            OM_LAT_INDEX=$((OM_LAT_INDEX+1))
        done
        [ "$OM_WIDTH" -lt 60 ] || printf '\n'
    done
}
om_score() {
    awk -F'|' -v f="$1" '$1==f{if($2=="pass")p++;else if($2~/^(captcha|js|login|partial|redirect|empty)$/)y++;else if($2=="unknown")u++;else r++}END{k=p+y+r;if(k<8)s="证据不足";else s=int(100*(p+0.5*y)/k+0.5)"/100";printf "%s|%d|%d|%d|%d|%d\n",s,k,p,y,r,u}' "$2"
}
# Source-only guard used by the external fixture checks.
[ "${OPENMILI_TEST_ONLY:-0}" != 1 ] || return 0 2>/dev/null || exit 0
printf '\n%b' "$OM_CYAN"; om_rule "$OM_WIDTH"; printf '\n'
om_center 'OPENMILI IP TOOLKIT - IP 综合探测报告'
om_center 'GitHub: https://github.com/OpenMili/OpenMili-IP-Toolkit'
om_rule "$OM_WIDTH"; printf '%b\n' "$OM_RESET"
om_hardware
om_section '一、IP 基础网络信息'
OM_SAVED_PROXY=$OM_PROXY; OM_PROXY=''
OM_V4=$(om_exit 4); OM_V6=$(om_exit 6); OM_PROXY=$OM_SAVED_PROXY
om_field '公网 IPv4' "${OM_V4:-未取得}"
om_field '公网 IPv6' "${OM_V6:-未启用或不可达}"
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
    printf '\n'; om_field '代理 IPv4' "${OM_V4:-未取得}"; om_field '代理 IPv6' "${OM_V6:-未启用或不可达}"
fi
if [ -z "$OM_V4$OM_V6" ]; then printf '\n未取得有效公网出口，停止检测。\n' >&2; exit 1; fi
om_info 4 "$OM_V4"; om_info 6 "$OM_V6"
om_nodes > "$OM_TEMP/nodes"
om_catalog > "$OM_TEMP/sites"
: > "$OM_TEMP/results"
om_section '二、国内三网节点延迟 (ICMP)'
if [ "$OM_ROUTES" -eq 0 ]; then om_wrap '已跳过'
elif [ -n "$OM_PROXY" ]; then om_wrap '代理模式跳过 · 请在目标 VPS 本机直连运行'
elif [ -z "$OM_V4" ]; then om_wrap '无 IPv4 出口 · 当前节点仅支持 IPv4'
elif ! command -v ping >/dev/null 2>&1; then om_wrap '未安装 ping · 请安装 iputils-ping'
else om_show_latency; fi
om_section '三、网站风控检测 (浏览器请求头)'
[ -z "$OM_V4" ] || om_show_sites 4
[ -z "$OM_V6" ] || om_show_sites 6
om_section '四、三网回程 (ICMP / TCP :443)'
if [ "$OM_ROUTES" -eq 0 ]; then om_wrap '已跳过'
elif [ -n "$OM_PROXY" ]; then om_wrap '代理模式跳过 · 请在目标 VPS 本机直连运行'
elif [ -z "$OM_V4" ]; then om_wrap '无 IPv4 出口 · 原版节点仅支持 IPv4'
else
    OM_TOOL='' OM_TCP_TOOL=''
    if command -v traceroute >/dev/null 2>&1; then OM_TOOL=traceroute; OM_TCP_TOOL=traceroute; fi
    if command -v ping >/dev/null 2>&1; then OM_TOOL=ping; fi
    printf '%b' "$OM_GRAY"; om_wrap 'IPv4 · ICMP / TCP :443 · 12 节点'; printf '%b' "$OM_RESET"
    if [ -z "$OM_TCP_TOOL" ]; then
        om_wrap 'TCP 未安装 · apt install traceroute / dnf install traceroute / apk add traceroute'
    fi
    if [ -z "$OM_TOOL$OM_TCP_TOOL" ]; then
        om_wrap 'ICMP 未安装 · 请安装 iputils-ping'
    else
        if [ "$OM_WIDTH" -ge 70 ]; then
            printf '  %b' "$OM_GRAY"; om_pad '节点' 12; printf '| '; om_pad 'ICMP' "$(((OM_WIDTH-18)/2))"; printf '| TCP :443%b\n' "$OM_RESET"
        fi
        OM_BATCH=0 OM_ROUTE_INDEX=0 OM_ROUTE_FIRST=1 OM_ROUTE_PIDS=''
        while IFS='|' read -r OM_RNAME OM_RIP; do
            OM_ROUTE_INDEX=$((OM_ROUTE_INDEX+1))
            om_trace "$OM_RNAME" "$OM_RIP" > "$OM_TEMP/route-row-$OM_ROUTE_INDEX" &
            OM_ROUTE_PIDS="$OM_ROUTE_PIDS $!"
            OM_BATCH=$((OM_BATCH+1))
            if [ "$OM_BATCH" -eq 3 ]; then
                wait
                OM_ROUTE_PIDS=''
                while [ "$OM_ROUTE_FIRST" -le "$OM_ROUTE_INDEX" ]; do cat "$OM_TEMP/route-row-$OM_ROUTE_FIRST"; OM_ROUTE_FIRST=$((OM_ROUTE_FIRST+1)); done
                OM_BATCH=0
            fi
        done < "$OM_TEMP/nodes"
        wait
        OM_ROUTE_PIDS=''
        while [ "$OM_ROUTE_FIRST" -le "$OM_ROUTE_INDEX" ]; do cat "$OM_TEMP/route-row-$OM_ROUTE_FIRST"; OM_ROUTE_FIRST=$((OM_ROUTE_FIRST+1)); done
    fi
fi
om_section '五、综合评估与使用建议'
for OM_SUM_F in 4 6; do
    if [ "$OM_SUM_F" = 4 ]; then OM_BEFORE=$OM_V4; else OM_BEFORE=$OM_V6; fi
    [ -n "$OM_BEFORE" ] || continue
    OM_SCORE_LINE=$(om_score "$OM_SUM_F" "$OM_TEMP/results")
    IFS='|' read -r OM_SCORE OM_KNOWN OM_PASS OM_PENDING OM_FAILED OM_UNKNOWN <<OM_SCORE_DATA
$OM_SCORE_LINE
OM_SCORE_DATA
    om_wrap "IPv$OM_SUM_F 访问参考分 : $OM_SCORE ($OM_KNOWN/16 明确观测)"
    om_wrap "通过 $OM_PASS | 待核 $OM_PENDING | 失败 $OM_FAILED | 未知 $OM_UNKNOWN"
    om_wrap "建议 : $OM_FAILED 项受限 / 网络失败；$OM_PENDING 项验证 / 登录等待核"
    OM_AFTER=$(om_exit "$OM_SUM_F")
    if [ -n "$OM_AFTER" ] && om_same_ip "$OM_SUM_F" "$OM_BEFORE" "$OM_AFTER"; then OM_STABLE='出口一致'; OM_TONE=$OM_GREEN
    elif [ -n "$OM_AFTER" ]; then OM_STABLE='出口变化'; OM_TONE=$OM_YELLOW
    else OM_STABLE='出口复核失败'; OM_TONE=$OM_YELLOW; fi
    printf '%b' "$OM_TONE"; om_wrap "出口复核 : $OM_STABLE"; printf '%b' "$OM_RESET"
done
printf '\n%b' "$OM_GRAY"
om_wrap '计分: 通过 1 / 待核 0.5 / 失败 0；未知不计。'
om_wrap '页面访问不代表账号 / 播放解锁；线路为逐跳特征。'
OM_ELAPSED=$(( $(om_clock) - OM_START ))
[ "$OM_ELAPSED" -ge 0 ] || OM_ELAPSED=0
om_wrap "总耗时: $OM_ELAPSED 秒" 0
om_rule "$OM_WIDTH"; printf '%b\n' "$OM_RESET"
