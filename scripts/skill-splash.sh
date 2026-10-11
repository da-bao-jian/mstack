# Router-only, once per hour. The directory lock also covers concurrent sessions.
mob_splash() (
  umask 077
  MOB_SPLASH_HOME="${MOB_HOME:-$HOME/.mob}"
  mkdir -p "$MOB_SPLASH_HOME" || return 0
  mkdir "$MOB_SPLASH_HOME/hello.lock" 2>/dev/null || return 0
  trap 'rmdir "$MOB_SPLASH_HOME/hello.lock" 2>/dev/null || true' EXIT
  MOB_SPLASH_NOW="$(date +%s)" || return 0
  MOB_SPLASH_LAST=0
  if [ -f "$MOB_SPLASH_HOME/hello-stamp" ]; then
    read -r MOB_SPLASH_LAST < "$MOB_SPLASH_HOME/hello-stamp" || return 0
  fi
  case "$MOB_SPLASH_LAST" in ''|*[!0-9]*) MOB_SPLASH_LAST=0 ;; esac
  [ "$((MOB_SPLASH_NOW - MOB_SPLASH_LAST))" -ge 3600 ] || return 0
  MOB_SPLASH="$("$MOB" hello --compact --ascii)" || return 0
  printf '%s\n' "$MOB_SPLASH_NOW" > "$MOB_SPLASH_HOME/hello-stamp" || return 0
  printf '%s\n' '<<<MOB' "$MOB_SPLASH" 'MOB>>>'
)
mob_splash
