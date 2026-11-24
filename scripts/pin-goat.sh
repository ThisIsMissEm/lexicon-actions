#!/usr/bin/env bash
# Maintainer tool: fetch a goat release's checksums, verify the GPG signature
# against the pinned signing subkey, and print the lines to append to
# .github/actions/setup-goat/goat-checksums.txt. Never used by the action at runtime; never edits repo files.
#
# Usage: scripts/pin-goat.sh v0.2.10 >> .github/actions/setup-goat/goat-checksums.txt
set -euo pipefail

SIGNING_FPR="0C8E4A0DA8E9990872952B3B084425E080357D53"
REPO_URL="https://github.com/bluesky-social/goat/releases/download"

die() {
  echo "pin-goat: $*" >&2
  exit 1
}

[ "$#" -eq 1 ] || die "usage: scripts/pin-goat.sh vX.Y.Z"
version="$1"
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: scripts/pin-goat.sh vX.Y.Z (got '$version')"
bare="${version#v}"

for tool in curl gpg; do
  command -v "$tool" >/dev/null 2>&1 || die "required tool not found: $tool"
done

key_file="$(dirname "${BASH_SOURCE[0]}")/../keys/goat-release.asc"
[ -f "$key_file" ] || die "key file not found: $key_file"

work="$(mktemp -d "${TMPDIR:-/tmp}/pin-goat.XXXXXX")"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"

sums="$work/checksums.txt"
sig="$work/checksums.txt.sig"
asset="goat_${bare}_checksums.txt"

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$sums" "${REPO_URL}/${version}/${asset}" \
  || die "failed to download ${asset}"
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$sig" "${REPO_URL}/${version}/${asset}.sig" \
  || die "failed to download ${asset}.sig"

gnupg="$work/gnupg"
mkdir -m 700 "$gnupg"
# Import can exit non-zero over harmless agent/trustdb warnings (e.g. no gpg-agent
# socket in a sandbox); a failed import shows up below as no good signature.
gpg --homedir "$gnupg" --batch --quiet --import "$key_file" 2>/dev/null || true

# gpg exits non-zero on a bad signature; capture status either way and judge it ourselves.
status="$(gpg --homedir "$gnupg" --batch --status-fd 1 --verify "$sig" "$sums" 2>/dev/null || true)"

good=0
signer=""
while IFS= read -r line; do
  case "$line" in
    "[GNUPG:] GOODSIG "*) good=1 ;;
    "[GNUPG:] BADSIG "* | "[GNUPG:] EXPKEYSIG "* | "[GNUPG:] REVKEYSIG "* | "[GNUPG:] ERRSIG "*)
      die "signature check failed: ${line#\[GNUPG:\] }"
      ;;
    "[GNUPG:] VALIDSIG "*)
      read -r -a f <<<"$line"
      signer="${f[2]:-}"
      ;;
  esac
done <<<"$status"

[ "$good" -eq 1 ] || die "no good signature on ${asset}"
[ -n "$signer" ] || die "no VALIDSIG line from gpg"
[ "$signer" = "$SIGNING_FPR" ] \
  || die "signed by unexpected key ${signer} (expected ${SIGNING_FPR})"

# Exact filename match; each asset must appear exactly once with a valid hash.
extract() {
  local want="$1" hash name rest count=0 found=""
  while read -r hash name rest; do
    if [ "$name" = "$want" ] && [ -z "$rest" ]; then
      count=$((count + 1))
      found="$hash"
    fi
  done <"$sums"
  [ "$count" -eq 1 ] || die "expected exactly one entry for ${want}, found ${count}"
  [[ "$found" =~ ^[0-9a-f]{64}$ ]] || die "malformed sha256 for ${want}"
  printf '%s' "$found"
}

x86="$(extract goat_Linux_x86_64.tar.gz)"
arm="$(extract goat_Linux_arm64.tar.gz)"

echo "pin-goat: signature OK (key ${signer})" >&2
printf '%s x86_64 %s\n' "$version" "$x86"
printf '%s arm64 %s\n' "$version" "$arm"
