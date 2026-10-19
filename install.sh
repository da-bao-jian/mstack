#!/bin/sh
# Standalone so that curl .../install.sh | sh needs no checkout or runtime.
set -eu

fail() { printf 'mob install: %s\n' "$*" >&2; exit 1; }
version=''
cache_only=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) [ "$#" -ge 2 ] || fail '--version needs a value'; version=$2; shift 2 ;;
    --cache-only) cache_only=1; shift ;;
    *) fail "unknown option: $1" ;;
  esac
done

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  MINGW*|MSYS*|CYGWIN*) os=windows ;;
  *) fail 'unsupported OS; use a supported GitHub release or build with Bun' ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) fail 'unsupported architecture; build with Bun' ;;
esac
asset="mob-$os-$arch"
if [ "$os" = windows ]; then
  [ "$arch" = x64 ] || fail 'Windows releases require x64'
  asset="$asset.exe"
fi
command -v curl >/dev/null 2>&1 || fail 'curl is required'
if command -v shasum >/dev/null 2>&1; then
  checksum=shasum
elif command -v sha256sum >/dev/null 2>&1; then
  checksum=sha256sum
else
  fail 'shasum or sha256sum is required to verify the download'
fi
base=${MSTACK_RELEASE_BASE_URL:-https://github.com/da-bao-jian/mstack/releases/download}
base=${base%/}
# Releases come over https, redirects included; plain http only reaches a loopback test server.
proto='=https'
case "$base" in
  https://*) ;;
  http://127.0.0.1:*|http://127.0.0.1/*|http://localhost:*|http://localhost/*|'http://[::1]:'*|'http://[::1]/'*) proto='=http' ;;
  *) fail 'MSTACK_RELEASE_BASE_URL must be an https URL (http only for a loopback test server)' ;;
esac
fetch() { curl --proto "$proto" --proto-redir "$proto" --tlsv1.2 -fSL --connect-timeout 10 --max-time 180 --silent --show-error "$1" -o "$2"; }
umask 077
cache="$HOME/.mob/bin"
local_bin="$HOME/.local/bin"
if [ "$cache_only" -eq 0 ] && { [ -e "$local_bin/mob" ] || [ -L "$local_bin/mob" ]; }; then
  [ -L "$local_bin/mob" ] || fail "$local_bin/mob already exists and is not a mob cache link"
  case "$(readlink "$local_bin/mob")" in
    "$cache"/mob-*) ;;
    *) fail "$local_bin/mob is not a mob cache link" ;;
  esac
fi
mkdir -p "$cache"
chmod 0700 "$cache"
staging=$(mktemp -d "$cache/.download.XXXXXX")
trap 'rm -rf "$staging"' 0
trap 'exit 1' HUP INT TERM
if [ -z "$version" ]; then
  # GitHub's latest asset route; fixture overrides use the same /download suffix.
  fetch "${base%/download}/latest/download/VERSION" "$staging/VERSION" || fail 'cannot fetch the latest release version'
  version=$(cat "$staging/VERSION")
fi
case "$version" in *[!0-9.]*) fail 'invalid release version' ;; esac
printf '%s\n' "$version" | LC_ALL=C grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || fail 'invalid release version'
printf 'mob: downloading %s v%s\n' "$asset" "$version" >&2
fetch "$base/v$version/$asset" "$staging/$asset" || fail 'binary download failed'
fetch "$base/v$version/SHA256SUMS" "$staging/SHA256SUMS" || fail 'checksum download failed'
expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' "$staging/SHA256SUMS")
[ "${#expected}" -eq 64 ] || fail "missing or duplicate checksum for $asset"
case "$expected" in *[!0-9a-fA-F]*) fail "invalid checksum for $asset" ;; esac
if [ "$checksum" = shasum ]; then
  actual=$(shasum -a 256 "$staging/$asset")
else
  actual=$(sha256sum "$staging/$asset")
fi
actual=${actual%% *}
expected=$(printf '%s' "$expected" | tr 'A-F' 'a-f')
[ "$actual" = "$expected" ] || fail "SHA-256 mismatch for $asset; nothing installed"
chmod 0755 "$staging/$asset"
target="$cache/mob-$version"
mv -f "$staging/$asset" "$target"
printf 'mob: verified SHA-256 and installed %s\n' "$target" >&2
if [ "$cache_only" -eq 1 ]; then exit 0; fi

mkdir -p "$local_bin"
[ ! -d "$local_bin/mob" ] || fail "$local_bin/mob is a directory"
ln -sf "$target" "$local_bin/mob"
printf 'Installed mob %s: %s\n' "$version" "$local_bin/mob"
case ":${PATH:-}:" in
  *":$local_bin:"*) ;;
  *) printf '%s\n' 'Add this line to your shell profile, then run it here:' "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac
printf '%s\n' '' 'Next steps:' \
  '  mob                         # open the home screen' \
  '  In Claude Code:' \
  '    /plugin marketplace add da-bao-jian/mstack' \
  '    /plugin install mstack' \
  '  Alternative: clone the repository and run ./setup --host claude or ./setup --host codex.'
