#!/usr/bin/env bash
set -eu
if ! command -v bun >/dev/null 2>&1; then
  printf '%s\n' 'mob sign blocked: Bun is required to verify hook input and transcript' >&2
  exit 2
fi
guard_status=0
bun --no-env-file "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/sign-guard.ts" || guard_status=$?
case "$guard_status" in
  0|2) exit "$guard_status" ;;
  *) printf '%s\n' 'mob sign blocked: authorization guard failed' >&2; exit 2 ;;
esac
