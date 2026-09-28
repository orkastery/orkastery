#!/bin/sh
# Host routing only. Authenticated principal and grants belong to the transport.
set -eu
exec "{{ork_bin}}" brain "$@"
