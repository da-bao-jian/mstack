#!/bin/bash
# SessionStart's synchronous systemMessage is shown to the user (Claude hooks docs).
set -eu
umask 077
[ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || exit 0
MOB_NOTICE_HOME="${MOB_HOME:-$HOME/.mob}"
mkdir -p "$MOB_NOTICE_HOME"
MOB_INSTALL_ID="$(printf '%s' "$CLAUDE_PLUGIN_ROOT" | cksum | cut -d ' ' -f 1)"
# noclobber is atomic across sessions and will not overwrite an existing marker.
if (set -C; printf '%s\n' "$CLAUDE_PLUGIN_ROOT" > "$MOB_NOTICE_HOME/installed-$MOB_INSTALL_ID") 2>/dev/null; then
  printf '%s\n' '{"systemMessage":"mstack installed — type /mob to start"}'
fi
