#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
command -v node >/dev/null 2>&1 || { printf '%s\n' 'Node.js 20+ required: https://nodejs.org/' >&2; exit 2; }
node -e 'if (+process.versions.node.split(".")[0] < 20) process.exit(1)' || exit 2
if [ ! -f "$SCRIPT_DIR/node_modules/yaml/package.json" ]; then
  for arg in "$@"; do
    case "$arg" in --no-install|--offline) printf '%s\n' 'Dependencies missing; run npm ci before offline/no-install.' >&2; exit 2;; esac
  done
  (cd "$SCRIPT_DIR" && npm ci --no-audit --no-fund >&2)
fi
exec node "$SCRIPT_DIR/bin/openmili.js" "$@"
