#!/usr/bin/env bash
# Install a pinned, SHA-256-verified goat release and add it to PATH.
# Used by the internal setup-goat action (.github/actions/setup-goat).
#
# Env: GOAT_VERSION, RUNNER_OS, RUNNER_ARCH, RUNNER_TEMP,
#      GOAT_CHECKSUMS_FILE (path to goat-checksums.txt),
#      GITHUB_OUTPUT, GITHUB_PATH.
set -euo pipefail

GOAT_VERSION="${GOAT_VERSION:?GOAT_VERSION is required}"
RUNNER_OS_NAME="${RUNNER_OS:?RUNNER_OS is required}"
RUNNER_ARCH_NAME="${RUNNER_ARCH:?RUNNER_ARCH is required}"
table="${GOAT_CHECKSUMS_FILE:?GOAT_CHECKSUMS_FILE is required}"

# Validate before any other use of the version.
if [[ ! "$GOAT_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::goat-version must match ^v[0-9]+\.[0-9]+\.[0-9]+$ (for example v0.2.9)"
  exit 1
fi

if [[ "$RUNNER_OS_NAME" != "Linux" ]]; then
  echo "::error::setup-goat supports Linux runners only"
  exit 1
fi

case "$RUNNER_ARCH_NAME" in
  X64) arch="x86_64" ;;
  ARM64) arch="arm64" ;;
  *)
    echo "::error::setup-goat supports X64 and ARM64 runners only"
    exit 1
    ;;
esac

# Look up the pinned hash: lines of "<version> <arch> <sha256>".
expected=""
supported=()
while read -r v a s _; do
  [[ -z "${v:-}" || "$v" == \#* ]] && continue
  if [[ "$a" == "$arch" ]]; then
    supported+=("$v")
    if [[ "$v" == "$GOAT_VERSION" ]]; then
      expected="$s"
    fi
  fi
done < "$table"

if [[ -z "$expected" ]]; then
  echo "::error::goat $GOAT_VERSION ($arch) isn't in goat-checksums.txt. Supported: ${supported[*]:-none}"
  exit 1
fi

asset="goat_Linux_${arch}.tar.gz"
url="https://github.com/bluesky-social/goat/releases/download/${GOAT_VERSION}/${asset}"
work="$(mktemp -d)"
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$work/$asset" "$url"
(cd "$work" && printf '%s  %s\n' "$expected" "$asset" | sha256sum --check --strict -)

bindir="$RUNNER_TEMP/goat-bin"
mkdir -p "$bindir"
tar -xzf "$work/$asset" -C "$bindir" goat
chmod +x "$bindir/goat"
rm -rf "$work"

echo "$bindir" >> "$GITHUB_PATH"
echo "goat-path=$bindir/goat" >> "$GITHUB_OUTPUT"
