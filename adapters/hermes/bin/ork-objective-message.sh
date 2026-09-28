#!/usr/bin/env sh
# Acrescenta uma mensagem do canal ao mesmo histórico durável visto no Kanban.
set -eu
# I-36 (D6): o adaptador declara o canal de conducao do Hermes; descreve a porta, nao da autoridade.
export ORK_CANAL="${ORK_CANAL:-hermes}"

if [ "$#" -lt 3 ]; then
  echo "uso: ork-objective-message.sh <objective-id> <autor-do-canal> <texto>" >&2
  exit 2
fi

OBJECTIVE="$1"
AUTHOR="$2"
shift 2

exec "${ORK_BIN:-ork}" objective message "$OBJECTIVE" \
  --text "$*" --por "$AUTHOR" --role human
