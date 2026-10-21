# Shared hourly greeting, compact. The router bypasses the age check and
# shows the full welcome: it is the menu, so every You can row and the Chat
# line must be there.
mob_splash() (
  umask 077
  MOB_SPLASH_HOME="${MOB_HOME:-$HOME/.mob}"
  mkdir -p "$MOB_SPLASH_HOME" || return 0
  MOB_SPLASH_OWNER="${1:-}"
  MOB_SPLASH_KIND="${2:-}"
  MOB_SPLASH_ID='home'
  if [ -n "$MOB_SPLASH_OWNER" ]; then
    MOB_SPLASH_ID="owner-$(printf '%s' "$MOB_SPLASH_OWNER" | cksum | cut -d ' ' -f 1)" || return 0
  fi
  MOB_SPLASH_STAMP="$MOB_SPLASH_HOME/hello-$MOB_SPLASH_ID-stamp"
  MOB_SPLASH_LOCK="$MOB_SPLASH_HOME/hello-$MOB_SPLASH_ID.lock"
  mkdir "$MOB_SPLASH_LOCK" 2>/dev/null || return 0
  trap 'rmdir "$MOB_SPLASH_LOCK" 2>/dev/null || true' EXIT
  MOB_SPLASH_NOW="$(date +%s)" || return 0
  MOB_SPLASH_LAST=0
  if [ -f "$MOB_SPLASH_STAMP" ]; then
    read -r MOB_SPLASH_LAST < "$MOB_SPLASH_STAMP" || return 0
  fi
  case "$MOB_SPLASH_LAST" in ''|*[!0-9]*) MOB_SPLASH_LAST=0 ;; esac
  if [ "$MOB_SPLASH_KIND" != --router ]; then
    [ "$((MOB_SPLASH_NOW - MOB_SPLASH_LAST))" -ge 3600 ] || return 0
  fi
  if [ "$MOB_SPLASH_KIND" = --router ]; then
    MOB_SPLASH="$("$MOB" hello --ascii)" || return 0
  else
    MOB_SPLASH="$("$MOB" hello --compact --ascii)" || return 0
  fi
  printf '%s\n' "$MOB_SPLASH_NOW" > "$MOB_SPLASH_STAMP" || return 0
  printf '%s\n' "$MOB_SPLASH"
)
