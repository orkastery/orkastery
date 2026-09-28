#!/usr/bin/env sh
# Abre uma thread do Orkastery a partir do pedido cru do builder, no OpenClaw.
#
# Existe para o host nao reimplementar o parse da #TAG: o modo sai de `ork modos --do-pedido`,
# que usa a mesma funcao do nucleo, e `conduction.allowed_modes` e validado pelo `ork thread new`.
#
# Uso: ork-abrir-thread.sh "<nome curto>" "<pedido inteiro do builder>" [argumentos extras]

set -eu

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
