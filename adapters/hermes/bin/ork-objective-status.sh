#!/usr/bin/env sh
# Lê o ticket canônico para que o Hermes continue a conversa iniciada no Kanban.
set -eu
# I-36 (D6): o adaptador declara o canal de conducao do Hermes; descreve a porta, nao da autoridade.
export ORK_CANAL="${ORK_CANAL:-hermes}"

if [ "$#" -ne 1 ]; then
  echo "uso: ork-objective-status.sh <objective-id>" >&2
  exit 2
fi

exec "${ORK_BIN:-ork}" objective status "$1" --json
