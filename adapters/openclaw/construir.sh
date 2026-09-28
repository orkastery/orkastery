#!/usr/bin/env sh
# Compila o entry TS do plugin para dist/ usando o tsc do core.
#
# Script de DESENVOLVIMENTO, rodado no repositorio do Orkastery; o dist/ gerado
# fica commitado porque o `ork adapter install openclaw` copia arquivos do
# repo, nao roda build. No diretorio instalado este script nao funciona (nao ha
# core/ do lado) e nao precisa: o que roda la e o dist/index.js.

set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
TSC="$DIR/../../core/node_modules/.bin/tsc"

if [ ! -x "$TSC" ]; then
  echo "tsc nao encontrado em $TSC; rode npm ci em core/ antes" >&2
  exit 2
fi

exec "$TSC" -p "$DIR/tsconfig.json"
