#!/usr/bin/env sh
set -eu
command -v node >/dev/null 2>&1 || { echo '需要 Node.js 18+：https://nodejs.org/' >&2; exit 2; }
URL="${OPENMILI_SIMPLE_SCRIPT_URL:-https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/simple-ip-check.js}"
TMP="${TMPDIR:-/tmp}/openmili-simple-ip-check.js"
curl -fsSL --proto '=https' --proto-redir '=https' "$URL" -o "$TMP"
if [ -e /dev/tty ]; then exec node "$TMP" "$@" </dev/tty; fi
exec node "$TMP" "$@"
