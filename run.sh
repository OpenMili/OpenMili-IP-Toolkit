#!/usr/bin/env bash
# OpenMili IP & Network Probe - native curl implementation for Linux/macOS.
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
URL_FILE="$SCRIPT_DIR/domains.yaml"
MODE="auto"
PROXY=""
LIMIT=0
TIMEOUT="5"
MIN_DELAY="0.422"
MAX_DELAY="0.453"
TARGETS_URL=""
LOOKUP=0
LOOKUP_IP=""
ONLY_LOOKUP=0
RETURN_ROUTES=0
ROUTE_TARGETS='电信=202.96.209.133 联通=123.125.81.6 移动=211.136.112.50'
SKIP_IP=0
NO_PAUSE=0
NO_COLOR=${NO_COLOR:-}

usage() {
  cat <<'EOF'
用法: ./run.sh [选项]

选项:
  --mode direct|proxy       直连或代理模式；不填写时启动交互选择
  --proxy 地址              HTTP/SOCKS5 代理，例如 127.0.0.1:10808
  --urls 文件               从 YAML 清单读取目标，默认 domains.yaml
  --limit N                 只检测前 N 个目标，0 表示全部
  --timeout 时间            单请求超时，默认 5s
  --min-delay 时间          最小间隔，默认 422ms
  --max-delay 时间          最大间隔，默认 453ms
  --targets-url HTTPS地址   临时下载目标清单，完成后自动清理
  --lookup                 查询出口 IP 数据库
  --lookup-ip IP           查询指定 IPv4/IPv6，自动启用 --lookup
  --only-lookup            只做 IP 数据库查询，不检测网站
  --return-routes          测试本机到电信/联通/移动的路由
  --route-targets 列表     用空格分隔的 名称=IPv4 列表
  --skip-ip                 跳过 IPv4/IPv6 出口 IP 检测
  --no-pause                检测完成后不等待，适合自动化调用
  -h, --help                显示帮助

示例:
  ./run.sh --limit 5 --skip-ip
  ./run.sh --mode proxy --proxy socks5://127.0.0.1:10808 --limit 10
EOF
}

die() { printf '[!] %s\n' "$*" >&2; exit 2; }

duration_seconds() {
  value=$1
  case "$value" in
    *ms) awk -v v="${value%ms}" 'BEGIN { printf "%.3f", v / 1000 }' ;;
    *s)  awk -v v="${value%s}" 'BEGIN { printf "%.3f", v }' ;;
    *)   awk -v v="$value" 'BEGIN { printf "%.3f", v }' ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode) [ "$#" -ge 2 ] || die "--mode 缺少参数"; MODE=$2; shift 2 ;;
    --proxy) [ "$#" -ge 2 ] || die "--proxy 缺少参数"; PROXY=$2; shift 2 ;;
    --urls) [ "$#" -ge 2 ] || die "--urls 缺少参数"; URL_FILE=$2; shift 2 ;;
    --limit) [ "$#" -ge 2 ] || die "--limit 缺少参数"; LIMIT=$2; shift 2 ;;
    --timeout) [ "$#" -ge 2 ] || die "--timeout 缺少参数"; TIMEOUT=$2; shift 2 ;;
    --min-delay) [ "$#" -ge 2 ] || die "--min-delay 缺少参数"; MIN_DELAY=$2; shift 2 ;;
    --max-delay) [ "$#" -ge 2 ] || die "--max-delay 缺少参数"; MAX_DELAY=$2; shift 2 ;;
    --targets-url) [ "$#" -ge 2 ] || die "--targets-url 缺少参数"; TARGETS_URL=$2; shift 2 ;;
    --lookup) LOOKUP=1; shift ;;
    --lookup-ip) [ "$#" -ge 2 ] || die "--lookup-ip 缺少参数"; LOOKUP_IP=$2; LOOKUP=1; shift 2 ;;
    --only-lookup) ONLY_LOOKUP=1; LOOKUP=1; shift ;;
    --return-routes) RETURN_ROUTES=1; shift ;;
    --route-targets) [ "$#" -ge 2 ] || die "--route-targets 缺少参数"; ROUTE_TARGETS=$2; shift 2 ;;
    --skip-ip) SKIP_IP=1; shift ;;
    --no-pause) NO_PAUSE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $1（使用 --help 查看帮助）" ;;
  esac
done

if [ -n "$PROXY" ] && [ "$MODE" = direct ]; then die "直连模式不能同时指定代理"; fi
if [ -n "$PROXY" ]; then
  MODE=proxy
fi
if [ "$ONLY_LOOKUP" -eq 1 ] && [ -n "$LOOKUP_IP" ] && [ "$MODE" = auto ]; then MODE=direct; fi
case "$MODE" in
  auto|direct|proxy) ;;
  *) die "--mode 只能是 auto、direct 或 proxy" ;;
esac

command -v curl >/dev/null 2>&1 || die "找不到 curl，请先安装系统 curl"
if [ "$ONLY_LOOKUP" -eq 0 ]; then [ -f "$URL_FILE" ] || [ -n "$TARGETS_URL" ] || die "找不到 URL 文件: $URL_FILE"; fi
[ "$ONLY_LOOKUP" -eq 0 ] || [ -z "$TARGETS_URL" ] || die "--only-lookup 不能同时指定 --targets-url"
if [ "$ONLY_LOOKUP" -eq 1 ] && [ -n "$LOOKUP_IP" ]; then SKIP_IP=1; fi
case "$LIMIT" in ''|*[!0-9]*) die "--limit 必须是非负整数" ;; esac
if [ -n "$LOOKUP_IP" ]; then
  printf '%s' "$LOOKUP_IP" | grep -Eq '^[0-9A-Fa-f:.]+$' || die "--lookup-ip 必须是 IPv4/IPv6"
fi
for value in "$TIMEOUT" "$MIN_DELAY" "$MAX_DELAY"; do
  printf '%s' "$value" | grep -Eq '^[0-9]+([.][0-9]+)?(ms|s)?$' || die "时间参数必须为非负数字，可带 ms 或 s"
done
TIMEOUT_SEC=$(duration_seconds "$TIMEOUT")
MIN_DELAY_SEC=$(duration_seconds "$MIN_DELAY")
MAX_DELAY_SEC=$(duration_seconds "$MAX_DELAY")
awk -v t="$TIMEOUT_SEC" -v a="$MIN_DELAY_SEC" -v b="$MAX_DELAY_SEC" 'BEGIN { exit !(t > 0 && b >= a) }' || die "超时必须大于 0，最大间隔不能小于最小间隔"

if [ -t 1 ] && [ -z "$NO_COLOR" ]; then
  C_CYAN=$(printf '\033[36m'); C_GREEN=$(printf '\033[32m'); C_YELLOW=$(printf '\033[33m')
  C_BLUE=$(printf '\033[34m'); C_RED=$(printf '\033[31m'); C_RESET=$(printf '\033[0m')
else
  C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_RED=""; C_RESET=""
fi

TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t openmili)
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
TARGET_FILE="$TMP_DIR/targets"
PROXY_ARGS=(--noproxy '*')
USER_AGENT='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

fetch_ip() {
  family=$1
  shift
  for endpoint in "$@"; do
    value=$(curl "${PROXY_ARGS[@]}" -$family -L -fsS --connect-timeout 1 --max-time 3 -A "$USER_AGENT" "$endpoint" 2>/dev/null | tr -d '[:space:]' || true)
    if [ "$family" = 4 ] && printf '%s' "$value" | awk -F. 'NF==4 { for(i=1;i<=4;i++) if($i !~ /^[0-9]+$/ || $i>255) exit 1; exit 0 } {exit 1}'; then printf '%s' "$value"; return; fi
    if [ "$family" = 6 ] && printf '%s' "$value" | grep -Eq '^[0-9A-Fa-f:]+$' && printf '%s' "$value" | grep -Eq '.*:.*:'; then printf '%s' "$value"; return; fi
  done
}

printf '%sOpenMili IP 检测 | %s%s\n' "$C_CYAN" "$(uname -s)" "$C_RESET"
DIRECT_IPV4='未获取'; DIRECT_IPV6='未获取'
if [ "$SKIP_IP" -eq 0 ]; then
  DIRECT_IPV4=$(fetch_ip 4 'https://api4.ipify.org' 'https://ip4.seeip.org' 'https://ip.sb'); [ -n "$DIRECT_IPV4" ] || DIRECT_IPV4='未获取'
  DIRECT_IPV6=$(fetch_ip 6 'https://ip.sb' 'https://api6.ipify.org' 'https://api-ipv6.ip.sb/ip'); [ -n "$DIRECT_IPV6" ] || DIRECT_IPV6='未获取'
  printf '直连出口: IPv4 %s | IPv6 %s\n' "$DIRECT_IPV4" "$DIRECT_IPV6"
fi

if [ "$MODE" = auto ]; then
  if [ -t 0 ] && [ "$NO_PAUSE" -eq 0 ]; then
    printf '请选择测试模式：1=使用当前直连IP，2=切换代理（默认 1）: '
    IFS= read -r choice || choice=""
    if [ "$choice" = 2 ]; then
      MODE=proxy
      printf '请输入代理地址（默认 127.0.0.1:10808，可填 192.168.1.10:7890）: '
      IFS= read -r PROXY || PROXY=""
      [ -n "$PROXY" ] || PROXY='http://127.0.0.1:10808'
    else
      MODE=direct
    fi
  else
    MODE=direct
  fi
fi
if [ "$MODE" = proxy ]; then
  [ -n "$PROXY" ] || PROXY='http://127.0.0.1:10808'
  case "$PROXY" in *://*) ;; *) PROXY="http://$PROXY" ;; esac
  case "$PROXY" in http://*|https://*|socks5://*|socks5h://*) ;; *) die "代理只支持 HTTP、HTTPS、SOCKS5" ;; esac
  PROXY_ARGS=(--proxy "$PROXY")
  printf '模式: 代理 %s\n' "$PROXY"
  if [ "$SKIP_IP" -eq 0 ]; then
    PROXY_IPV4=$(fetch_ip 4 'https://api4.ipify.org' 'https://ip4.seeip.org' 'https://ip.sb'); [ -n "$PROXY_IPV4" ] || PROXY_IPV4='未获取'
    PROXY_IPV6=$(fetch_ip 6 'https://ip.sb' 'https://api6.ipify.org' 'https://api-ipv6.ip.sb/ip'); [ -n "$PROXY_IPV6" ] || PROXY_IPV6='未获取'
    printf '代理出口: IPv4 %s | IPv6 %s\n' "$PROXY_IPV4" "$PROXY_IPV6"
  fi
else
  printf '模式: 直连\n'
fi
if [ -n "$TARGETS_URL" ]; then
  case "$TARGETS_URL" in https://*) ;; *) die "--targets-url 必须是 HTTPS 地址" ;; esac
  URL_FILE="$TMP_DIR/download.yaml"
  curl "${PROXY_ARGS[@]}" -fsSL --max-time 15 --max-filesize 102400 -o "$URL_FILE" "$TARGETS_URL" || die "目标清单下载失败"
fi
if [ "$ONLY_LOOKUP" -eq 0 ]; then
  [ -f "$URL_FILE" ] || die "找不到 URL 文件: $URL_FILE"
  # Parse the documented domains/name/url YAML schema without extra runtimes.
  awk '
  function fail(message) { print "YAML 第 " NR " 行: " message > "/dev/stderr"; bad=1; exit 2 }
  function trim(value) { sub(/^[[:space:]]+/, "", value); sub(/[[:space:]]+$/, "", value); return value }
  function scalar(value, quote, result, i, c, tail, closed) {
    value=trim(value); quote=substr(value,1,1); result=""; closed=0
    if (quote == "\"" || quote == sprintf("%c",39)) {
      for (i=2; i<=length(value); i++) {
        c=substr(value,i,1)
        if (c == quote) {
          if (quote != "\"" && substr(value,i+1,1) == quote) { result=result quote; i++; continue }
          tail=trim(substr(value,i+1))
          if (tail != "" && substr(tail,1,1) != "#") fail("引号后有多余内容")
          closed=1; break
        }
        if (quote == "\"" && c == "\\") {
          c=substr(value,++i,1)
          if (c != "\"" && c != "\\") fail("双引号只支持转义引号及反斜杠")
        }
        result=result c
      }
      if (!closed) fail("引号未闭合")
    } else {
      if (substr(value,1,1) == "#") fail("字段为空")
      sub(/[[:space:]]+#.*$/, "", value); result=trim(value)
      if (result ~ /:[[:space:]]|^[\[\]{}&*!|>@`%]/) fail("请为特殊字符串加引号")
    }
    if (trim(result) == "" || result ~ /[[:cntrl:]]/) fail("字段为空或含控制字符")
    return result
  }
  function flush() {
    if (!active) return
    if (!hasName || !hasUrl) fail("目标缺少 name 或 url")
    if (url !~ /^https?:\/\/[^\/?#[:space:]]+([\/?#][^[:space:]]*)?$/) fail("无效 HTTP URL")
    if (!seen[url]++) print name "\t" url
  }
  {
    sub(/\r$/, "")
    if (NR == 1) sub(/^\357\273\277/, "")
    if ($0 ~ /^[[:space:]]*(#.*)?$/) next
    if (!root) {
      if ($0 !~ /^domains:[[:space:]]*(#.*)?$/) fail("首行必须是 domains:")
      root=1; next
    }
    if ($0 ~ /^  - (name|url):[[:space:]]*/) {
      flush(); active=1; hasName=0; hasUrl=0; row=substr($0,5)
    } else if (active && $0 ~ /^    (name|url):[[:space:]]*/) {
      row=substr($0,5)
    } else fail("使用两格列表缩进、四格字段缩进")
    key=row; sub(/:.*/, "", key); sub(/^[^:]+:/, "", row)
    value=scalar(row)
    if (key == "name") { if (hasName++) fail("name 重复"); name=value }
    else { if (hasUrl++) fail("url 重复"); url=value }
  }
  END { if (!bad) { if (!root) fail("缺少 domains:"); flush() } }
' "$URL_FILE" > "$TARGET_FILE" || die "目标清单格式错误"
  TOTAL=$(wc -l < "$TARGET_FILE" | tr -d '[:space:]')
  [ "$TOTAL" -gt 0 ] || die "URL 文件中没有可检测目标"
  if [ "$LIMIT" -gt 0 ] && [ "$LIMIT" -lt "$TOTAL" ]; then TOTAL=$LIMIT; fi
else
  : > "$TARGET_FILE"
  TOTAL=0
fi

contains_body() { grep -Eqi "$1" "$BODY_FILE" 2>/dev/null; }
contains_header() { grep -Eqi "$1" "$HEADER_FILE" 2>/dev/null; }

classify() {
  ICON='💀'; LABEL='网络错误'; DETAIL="${STATUS:-000} ${CURL_ERROR:-请求失败}"; COLOR="$C_RED"; KIND='network'
  [ -n "${CURL_OK:-}" ] || return
  if { [ "$STATUS" = 403 ] || [ "$STATUS" = 503 ]; } && { contains_header '^[[:space:]]*cf-mitigated:[[:space:]]*challenge' || contains_body 'challenges\.cloudflare\.com|just a moment|turnstile'; }; then
    ICON='🛡️'; LABEL='CF 浏览器盾'; DETAIL="$STATUS Challenge"; COLOR="$C_YELLOW"; KIND='challenge'; return
  fi
  if { [ "$STATUS" = 200 ] || [ "$STATUS" = 429 ]; } && contains_body 'recaptcha|g-recaptcha|geetest|verify you are human|gs_captcha'; then
    ICON='🧩'; LABEL='人机验证'; DETAIL="$STATUS Captcha"; COLOR="$C_YELLOW"; KIND='captcha'; return
  fi
  if [ "$STATUS" = 451 ] || [ "$STATUS" = 1020 ] || { [ "$STATUS" = 403 ] && contains_body 'access denied|cloudflare ray id'; }; then
    ICON='!'; LABEL='访问受限'; DETAIL="$STATUS"; COLOR="$C_RED"; KIND='restricted'; return
  fi
  if contains_body 'not available in your country|geographic restriction|unavailable in your region' || { echo "$FINAL_URL" | grep -Eqi '/unsupported'; }; then
    ICON='🌐'; LABEL='地区限制'; DETAIL="$STATUS Region"; COLOR="$C_BLUE"; KIND='region'; return
  fi
  body_size=$(wc -c < "$BODY_FILE" | tr -d '[:space:]')
  if echo "$URL" | grep -Eqi 'tiktok\.com' && [ "$STATUS" = 200 ] && { [ "$body_size" -eq 0 ] || contains_body '"itemlist":[[:space:]]*\[\]'; }; then
    ICON='⚠️'; LABEL='软封/空内容'; DETAIL="$STATUS Empty Feed"; COLOR="$C_YELLOW"; KIND='soft-ban'; return
  fi
  if [ "$STATUS" -ge 200 ] 2>/dev/null && [ "$STATUS" -lt 400 ] 2>/dev/null; then
    if [ "$STATUS" != 204 ] && [ "$body_size" -eq 0 ]; then ICON='!'; LABEL='响应为空'; DETAIL="$STATUS"; COLOR="$C_YELLOW"; KIND='empty'; return; fi
    ICON='✓'; LABEL='服务可达'; DETAIL="$STATUS"; COLOR="$C_GREEN"; KIND='reachable'; return
  fi
  if [ "$STATUS" = 403 ] || [ "$STATUS" = 429 ]; then ICON='!'; LABEL='访问受限'; DETAIL="$STATUS"; COLOR="$C_RED"; KIND='restricted'; return; fi
  ICON='!'; LABEL='服务异常'; DETAIL="$STATUS"; COLOR="$C_RED"; KIND='http-error'
}

INDEX=0; SUCCESS=0; STARTED=$(date +%s)
while IFS="$(printf '\t')" read -r NAME URL; do
  [ "$INDEX" -lt "$TOTAL" ] || break
  INDEX=$((INDEX + 1))
  HEADER_FILE="$TMP_DIR/headers"; BODY_FILE="$TMP_DIR/body"; ERROR_FILE="$TMP_DIR/error"
  META=$(curl "${PROXY_ARGS[@]}" -L -sS --max-time "$TIMEOUT_SEC" -A "$USER_AGENT" \
    -H 'Accept: text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' \
    -H 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8' -D "$HEADER_FILE" -o "$BODY_FILE" \
    -w '%{http_code}\t%{time_total}\t%{url_effective}' "$URL" 2>"$ERROR_FILE")
  CURL_EXIT=$?; CURL_OK=""; CURL_ERROR=$(tr '\r\n' '  ' < "$ERROR_FILE" | cut -c1-80)
  IFS="$(printf '\t')" read -r STATUS ELAPSED FINAL_URL <<EOF
$META
EOF
  STATUS=${STATUS:-000}; ELAPSED=${ELAPSED:-0}; FINAL_URL=${FINAL_URL:-$URL}
  if [ "$CURL_EXIT" -eq 0 ]; then CURL_OK=1; fi
  STATUS_TEXT=$(awk -v s="$STATUS" 'BEGIN { if (s==200) print "OK"; else if (s==301) print "Moved"; else if (s==302) print "Found"; else if (s==403) print "Forbidden"; else if (s==429) print "Too Many"; else if (s==503) print "Unavailable"; else print "" }')
  classify
  MS=$(awk -v t="$ELAPSED" 'BEGIN { printf "%d", t * 1000 }')
  printf '[%d/%d] %s: %s%s%s %s %sms\n' "$INDEX" "$TOTAL" "${NAME:0:20}" "$COLOR" "$LABEL" "$C_RESET" "$DETAIL" "$MS"
  [ "$KIND" = reachable ] && SUCCESS=$((SUCCESS + 1))
  if [ "$INDEX" -lt "$TOTAL" ]; then
    if awk -v a="$MAX_DELAY_SEC" -v b="$MIN_DELAY_SEC" 'BEGIN { exit !(a > b) }'; then
      delay=$(awk -v min="$MIN_DELAY_SEC" -v max="$MAX_DELAY_SEC" -v r="$RANDOM" 'BEGIN { printf "%.3f", min + (r / 32767) * (max - min) }')
    else delay="$MIN_DELAY_SEC"; fi
    sleep "$delay"
  fi
done < "$TARGET_FILE"

FINISHED=$(date +%s); ELAPSED_TOTAL=$((FINISHED - STARTED))
if [ "$ONLY_LOOKUP" -eq 0 ]; then printf '完成 %ss | 服务可达 %d/%d\n' "$ELAPSED_TOTAL" "$SUCCESS" "$TOTAL"; fi
if [ "$LOOKUP" -eq 1 ]; then
  if [ -z "$LOOKUP_IP" ]; then
    if [ "$MODE" = proxy ]; then LOOKUP_IP=${PROXY_IPV4:-未获取}; else LOOKUP_IP=$DIRECT_IPV4; fi
  fi
  if [ "$LOOKUP_IP" = 未获取 ]; then
    printf 'IP 数据库: 未测试（出口 IP 未获取）\n'
  else
    DB_COUNTRY=$(curl "${PROXY_ARGS[@]}" -fsS --max-time 5 "https://ipinfo.io/$LOOKUP_IP/country" 2>/dev/null | tr -d '\r\n' || true)
    DB_CITY=$(curl "${PROXY_ARGS[@]}" -fsS --max-time 5 "https://ipinfo.io/$LOOKUP_IP/city" 2>/dev/null | tr -d '\r\n' || true)
    DB_ORG=$(curl "${PROXY_ARGS[@]}" -fsS --max-time 5 "https://ipinfo.io/$LOOKUP_IP/org" 2>/dev/null | tr -d '\r\n' || true)
    if printf '%s' "$DB_COUNTRY" | grep -Eq '^[A-Z]{2}$' && printf '%s' "$DB_ORG" | grep -Eq '^AS[0-9]+ '; then
      printf 'IP 数据库: %s | %s %s | %s\n' "$LOOKUP_IP" "$DB_COUNTRY" "$DB_CITY" "$DB_ORG"
    else
      printf 'IP 数据库: %s | 未测试（查询失败）\n' "$LOOKUP_IP"
    fi
  fi
fi
if [ "$RETURN_ROUTES" -eq 1 ]; then
  if [ "$MODE" = proxy ]; then
    printf '三网回程: 未测试（系统路由跟踪无法经过 HTTP/SOCKS 代理）\n'
  elif ! command -v traceroute >/dev/null 2>&1; then
    printf '三网回程: 未测试（请安装 traceroute）\n'
  else
    for entry in $ROUTE_TARGETS; do
      case "$entry" in *=*) label=${entry%%=*}; dest=${entry#*=} ;; *) die "无效回程目标: $entry" ;; esac
      printf '%s' "$dest" | awk -F. 'NF==4 { for(i=1;i<=4;i++) if($i !~ /^[0-9]+$/ || $i>255) exit 1; exit 0 } {exit 1}' || die "无效回程目标 IP: $entry"
      route=$(traceroute -n -m 20 -q 1 -w 1 "$dest" 2>&1 | tail -n 1)
      case "$route" in *"$dest"*) state='到达目标' ;; *) state='未到达目标' ;; esac
      printf '回程 %s: %s | %s\n' "$label" "$state" "$route"
    done
  fi
fi
if [ "$NO_PAUSE" -eq 0 ] && [ -t 0 ] && [ -t 1 ]; then
  printf '结果已全部打印，按回车键退出...'
  IFS= read -r _ || true
fi
