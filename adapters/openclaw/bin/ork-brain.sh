#!/bin/sh
# Same Brain API as other hosts; no authority inferred from the launcher.
set -eu
exec "{{ork_bin}}" brain "$@"
