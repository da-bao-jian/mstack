#!/usr/bin/env bash
set -eu
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
exec "$ROOT/bin/mob" hook sign-guard
