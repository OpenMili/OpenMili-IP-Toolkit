#!/usr/bin/env bash
# OpenMili IP Toolkit · Linux / macOS 启动器
set -e

command -v node >/dev/null 2>&1 || {
    echo "错误: 系统未检测到 Node.js (需要 Node.js 18+)。请访问 https://nodejs.org/ 安装。" >&2
    exit 1
}

SCRIPT_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo "")
LOCAL_SCRIPT="$SCRIPT_DIR/openmili.js"

if [ -f "$LOCAL_SCRIPT" ]; then
    TARGET="$LOCAL_SCRIPT"
else
    # 远程一键运行模式：下载单文件脚本至临时目录
    TARGET="/tmp/openmili-$$.js"
    URL="https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/openmili.js"
    if ! curl -fsSL --connect-timeout 5 "$URL" -o "$TARGET" 2>/dev/null; then
        MIRROR="https://ghproxy.net/$URL"
        curl -fsSL --connect-timeout 8 "$MIRROR" -o "$TARGET"
    fi
    trap 'rm -f "$TARGET"' EXIT
fi

node "$TARGET" "$@"
