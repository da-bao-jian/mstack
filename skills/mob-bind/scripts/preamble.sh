#!/bin/sh
set -eu
# Resolve directory symlinks before walking up to the plugin or checkout root.
MOB_SKILL_SCRIPTS="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
exec "$MOB_SKILL_SCRIPTS/../../../bin/mob-preamble" "$@"
