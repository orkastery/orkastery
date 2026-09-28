#!/usr/bin/env sh
# Abre uma thread do Orkastery a partir do pedido cru do builder.
#
# Zero regra de negocio: o modo sai de `ork modos --do-pedido`, que usa a mesma funcao do
# nucleo, e a validacao contra `conduction.allowed_modes` acontece dentro do `ork thread new`.
# Este script existe para o host nao ser tentado a reimplementar o parse da #TAG.
#
# Uso: ork-abrir-thread.sh "<nome curto>" "<pedido inteiro do builder>" [--worktree auto]

set -eu
# I-36 (D6): o adaptador declara o canal de conducao do Hermes; descreve a porta, nao da autoridade.
export ORK_CANAL="${ORK_CANAL:-hermes}"

if [ "$#" -lt 2 ]; then
  echo "uso: ork-abrir-thread.sh \"<nome curto>\" \"<pedido do builder>\" [argumentos extras]" >&2
  exit 2
fi

ORK="${ORK_BIN:-ork}"
NOME="$1"
PEDIDO="$2"
shift 2

MODO="$("$ORK" modos --do-pedido "$PEDIDO")"
echo "modo de conducao lido do pedido: $MODO" >&2

exec "$ORK" thread new "$NOME" --mode "$MODO" "$@"
