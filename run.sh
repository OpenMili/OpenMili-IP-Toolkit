#!/usr/bin/env bash
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
command -v node >/dev/null 2>&1 || { printf '%s\n' 'Please install Node.js 20+: https://nodejs.org/' >&2; exit 2; }
node -e 'if (+process.versions.node.split(".")[0] < 20) process.exit(1)' || { printf '%s\n' 'Node.js 20+ is required.' >&2; exit 2; }
if [ ! -f "$SCRIPT_DIR/node_modules/yaml/package.json" ]; then
  (cd "$SCRIPT_DIR" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
fi
exec node "$SCRIPT_DIR/bin/openmili.js" "$@"
