set -uo pipefail
# Honor a caller-supplied root; skill wrappers also put their own bin on PATH.
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  export PATH="$PATH:$CLAUDE_PLUGIN_ROOT/bin"
fi
if command -v mob >/dev/null 2>&1; then
  MOB="$(command -v mob)"
elif [ -x "$HOME/.claude/skills/mstack/bin/mob" ]; then
  MOB="$HOME/.claude/skills/mstack/bin/mob"
elif [ -x "$HOME/.agents/skills/mstack/bin/mob" ]; then
  MOB="$HOME/.agents/skills/mstack/bin/mob"
elif [ -x "$HOME/.codex/skills/mstack/bin/mob" ]; then
  MOB="$HOME/.codex/skills/mstack/bin/mob"
else
  printf '%s\n' 'MOB_MISSING' 'Install: cd <mstack-checkout> && ./setup --host auto (Bun >= 1.3 required)'
  exit 1
fi
printf 'MOB_BIN: %s\n' "$MOB"
if [ "${1:-}" = --router ]; then
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/skill-splash.sh"
fi
if MOB_VERSION="$("$MOB" --version)"; then printf 'MOB_VERSION: %s\n' "$MOB_VERSION"; else printf 'MOB_VERSION: fail\n'; fi
if API_BASE="$("$MOB" config get api_base)"; then printf 'API_BASE: %s\n' "$API_BASE"; else API_BASE=''; printf 'API_BASE: fail\n'; fi
# Advisory only: this result never gates a venue read or changes scan filters.
if [ -n "$API_BASE" ] && MOB_HTTP="$(curl -m 15 -s -o /dev/null -w '%{http_code} %{time_total}' -H "X-Mobius-Client: mstack/$MOB_VERSION" -A "mstack/$MOB_VERSION" "$API_BASE/api/client-ip")"; then
  read -r MOB_STATUS MOB_SECONDS <<< "$MOB_HTTP"
  case "$MOB_STATUS" in
    2[0-9][0-9]) awk -v seconds="${MOB_SECONDS:-0}" 'BEGIN { if (seconds >= 3) { printf "API_REACHABLE: slow · %.1f s\n", seconds; print "API slow; venue reads are unaffected" } else if (seconds >= 1) printf "API_REACHABLE: ok · %.1f s\n", seconds; else printf "API_REACHABLE: ok · %.0f ms\n", seconds * 1000 }' ;;
    *) printf '%s\n' 'API_REACHABLE: unreachable' 'API unreachable; venue reads are unaffected' ;;
  esac
else
  printf '%s\n' 'API_REACHABLE: unreachable' 'API unreachable; venue reads are unaffected'
fi
if MOB_OWNER="$("$MOB" config get owner)"; then
  if [ -n "$MOB_OWNER" ]; then printf 'OWNER: set\n'; else printf 'OWNER: unset\n'; fi
else
  printf 'OWNER: fail\n'
fi
if MOB_POLICY=$("$MOB" config get policy); then
  printf 'POLICY: %s\n' "$MOB_POLICY"
else
  printf 'POLICY: fail\n'
fi
if MOB_SIGNER=$("$MOB" config get signer); then
  case "$MOB_SIGNER" in
    keystore|browser|walletconnect) printf 'SIGNER: %s\n' "$MOB_SIGNER" ;;
    '') printf 'SIGNER: unset\n' ;;
    *) printf 'SIGNER: fail (unsupported backend: %s)\n' "$MOB_SIGNER" ;;
  esac
else
  printf 'SIGNER: fail\n'
fi
MOB_UPDATE_REASON='cannot read checkout or update-check state'
mob_update_check() {
  MOB_BIN_DIR="$(cd "$(dirname "$MOB")" && pwd -P)" || return 1
  MOB_REPO="$(git -C "$MOB_BIN_DIR" rev-parse --show-toplevel 2>/dev/null)" || return 0
  git -C "$MOB_REPO" remote get-url origin >/dev/null 2>&1 || return 0
  MOB_STATE_HOME="${MOB_HOME:-$HOME/.mob}"
  mkdir -p -m 700 "$MOB_STATE_HOME" || return 1
  MOB_REPO_ID="$(printf '%s' "$MOB_REPO" | cksum | cut -d ' ' -f 1)" || return 1
  MOB_STAMP="$MOB_STATE_HOME/upgrade-check-$MOB_REPO_ID"
  MOB_NOW="$(date +%s)" || return 1
  MOB_LAST=0
  MOB_CHECK=ok
  MOB_CACHED_REASON=''
  if [ -f "$MOB_STAMP" ]; then read -r MOB_LAST MOB_CHECK MOB_CACHED_REASON < "$MOB_STAMP" || return 1; fi
  case "$MOB_LAST" in ''|*[!0-9]*) return 1 ;; esac
  if [ "$((MOB_NOW - MOB_LAST))" -ge 3600 ]; then
    (umask 077; printf '%s pending\n' "$MOB_NOW" > "$MOB_STAMP") || return 1
    if MOB_FETCH_ERROR="$(GIT_TERMINAL_PROMPT=0 git -C "$MOB_REPO" fetch -q origin 2>&1)"; then
      printf '%s ok\n' "$MOB_NOW" > "$MOB_STAMP" || return 1
      MOB_CHECK=ok
    else
      # Keep remote URLs and credential-helper diagnostics out of skill context.
      case "$MOB_FETCH_ERROR" in
        *'could not read Username'*|*'could not read Password'*|*'Authentication failed'*|*'Permission denied'*|*'terminal prompts disabled'*)
          MOB_CACHED_REASON='git fetch credentials unavailable or rejected' ;;
        *'Could not resolve host'*|*'Could not resolve proxy'*)
          MOB_CACHED_REASON='git fetch could not resolve host or proxy' ;;
        *) MOB_CACHED_REASON='git fetch origin failed; check repository access and network' ;;
      esac
      printf '%s fail %s\n' "$MOB_NOW" "$MOB_CACHED_REASON" > "$MOB_STAMP" || return 1
      MOB_CHECK=fail
    fi
  fi
  if [ "$MOB_CHECK" != ok ]; then
    MOB_UPDATE_REASON="${MOB_CACHED_REASON:-previous update check failed or did not complete; retry after the hourly interval}"
    return 1
  fi
  MOB_UPDATE_REASON='cannot resolve HEAD or origin/main'
  MOB_LOCAL="$(git -C "$MOB_REPO" rev-parse HEAD)" || return 1
  MOB_REMOTE="$(git -C "$MOB_REPO" rev-parse origin/main)" || return 1
  if [ "$MOB_LOCAL" != "$MOB_REMOTE" ]; then printf 'UPGRADE_AVAILABLE %s %s\n' "$MOB_LOCAL" "$MOB_REMOTE"; fi
  return 0
}
if mob_update_check 2>/dev/null; then printf 'UPGRADE_CHECK: ok\n'; else printf 'UPGRADE_CHECK: fail (%s)\n' "$MOB_UPDATE_REASON"; fi
true
