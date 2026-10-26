#!/bin/sh
set -eu
VERSION=latest
INSTALL_ROOT="$HOME/.local/share/openmili-ip"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) VERSION=$2; shift 2;;
    --root) INSTALL_ROOT=$2; shift 2;;
    --yes) shift;;
    *) printf '%s\n' 'Usage: sh install.sh [--version vX.Y.Z] [--root DIR] [--yes]' >&2; exit 2;;
  esac
done
case "$(uname -s)" in Linux) PLATFORM=linux;; Darwin) PLATFORM=darwin;; *) printf '%s\n' 'Unsupported OS; use install.ps1 on Windows.' >&2; exit 2;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; *) printf '%s\n' 'Unsupported CPU' >&2; exit 2;; esac
if [ "$PLATFORM" = linux ] && ldd --version 2>&1 | grep -qi musl; then printf '%s\n' 'Alpine/musl: install distro Node.js/npm/curl and use the source/npx entry; glibc bundles cannot run here.' >&2; exit 2; fi
BASE=https://github.com/OpenMili/OpenMili-IP-Toolkit
if [ "$VERSION" = latest ]; then URL=$(curl -q -fsSL --proto '=https' --proto-redir '=https' -o /dev/null -w '%{url_effective}' "$BASE/releases/latest"); VERSION=${URL##*/}; fi
printf '%s\n' "$VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$' || exit 2
NAME="OpenMili-IP-Toolkit-$VERSION-$PLATFORM-$ARCH.tar.gz"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf -- "$TEMP_DIR"' EXIT HUP INT TERM
curl -q -fsSL --proto '=https' --proto-redir '=https' --max-time 180 -o "$TEMP_DIR/$NAME" "$BASE/releases/download/$VERSION/$NAME"
curl -q -fsSL --proto '=https' --proto-redir '=https' --max-time 60 -o "$TEMP_DIR/SHA256SUMS" "$BASE/releases/download/$VERSION/SHA256SUMS"
EXPECTED=$(awk -v name="$NAME" '$2==name {print $1}' "$TEMP_DIR/SHA256SUMS")
if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$TEMP_DIR/$NAME" | awk '{print $1}'); else ACTUAL=$(shasum -a 256 "$TEMP_DIR/$NAME" | awk '{print $1}'); fi
[ "$EXPECTED" = "$ACTUAL" ] || { printf '%s\n' 'SHA-256 mismatch; nothing executed.' >&2; exit 2; }
tar -tzf "$TEMP_DIR/$NAME" > "$TEMP_DIR/names"
if grep -Eq '(^/|(^|/)\.\.(/|$)|\\|:)' "$TEMP_DIR/names"; then printf '%s\n' 'Unsafe archive paths' >&2; exit 2; fi
tar -tvzf "$TEMP_DIR/$NAME" > "$TEMP_DIR/types"
if grep -Ev '^[-d]' "$TEMP_DIR/types"; then printf '%s\n' 'Links/special files rejected' >&2; exit 2; fi
mkdir "$TEMP_DIR/core"
tar -xzf "$TEMP_DIR/$NAME" -C "$TEMP_DIR/core"
"$TEMP_DIR/core/node" "$TEMP_DIR/core/bin/openmili.js" install --archive "$TEMP_DIR/$NAME" --checksum "$EXPECTED" --install-root "$INSTALL_ROOT" --yes
printf 'Run: "%s/openmili-ip"\n' "$INSTALL_ROOT"
