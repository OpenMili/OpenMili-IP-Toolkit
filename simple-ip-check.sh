#!/usr/bin/env sh
set -eu
command -v node >/dev/null 2>&1 || { echo '需要 Node.js 20+（含 npm）：https://nodejs.org/' >&2; exit 2; }
URL="${OPENMILI_SIMPLE_SCRIPT_URL:-https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/simple-ip-check.js}"
OPENMILI_TMP=$(mktemp "${TMPDIR:-/tmp}/openmili-simple-XXXXXX")
trap 'rm -f "$OPENMILI_TMP"' 0
curl -fsSL --proto '=https' --proto-redir '=https' "$URL" -o "$OPENMILI_TMP"
if ( : </dev/tty ) 2>/dev/null; then node "$OPENMILI_TMP" "$@" </dev/tty; else node "$OPENMILI_TMP" "$@"; fi
