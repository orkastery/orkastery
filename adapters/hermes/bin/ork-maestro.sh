#!/bin/sh
# Somente leitura; cwd é o projeto do host. Argumentos continuam dados.
set -eu
# I-36 (D6): o adaptador declara o canal de conducao do Hermes; descreve a porta, nao da autoridade.
export ORK_CANAL="${ORK_CANAL:-hermes}"
exec "${ORK_BIN:-{{ork_bin}}}" maestro --json "$@"
